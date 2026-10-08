import { useEffect } from "react"
import { queryStore } from "@forge-go/dashboard-plugin"
import type { QueryStore } from "@forge-go/dashboard-plugin"

/**
 * Keeps every tab of one origin from showing answers about a context it has
 * left.
 *
 * The context lives server side, in a cookie or in the session (keysmith's
 * tenant follows the session's org), so it is shared by every tab. The query
 * store is not: each tab has its own. When one tab switches app or org, or
 * sees a different person signed in, it clears its store and its pages
 * refetch. The other tabs used to keep showing the old org's rows until
 * something happened to refetch them. Now the tab that clears says so, and
 * every other tab clears too, once it is the one in front of the operator.
 *
 * "In front" means visible and focused. A tab that is hidden, or sits in a
 * window that does not have focus, holds the clear until it gets focus (or
 * until the operator presses a key or a pointer in it, whichever comes
 * first). Clearing at once would refetch pages nobody is using, and a routed
 * page there would read the new context, see that it disagrees with its own
 * URL and switch the server back, undoing the switch the operator just made
 * in the window they are actually using. Only the window in front ever
 * reconciles the server to its URL.
 *
 * A change made outside the dashboard (an org switched in another tool) sends
 * no message, so a tab that comes back to the front also revalidates:
 * everything watched refetches with its rows left on screen.
 */

/** What one tab tells the others. `seq` makes each write unique, which the storage fallback needs. */
export interface ClearMessage {
  kind: "clear"
  source: string
  seq: number
}

export interface TabTransport {
  post(message: ClearMessage): void
  close(): void
}

/**
 * Opens a transport that hands every message from another tab to `onMessage`.
 * Undefined means this environment has no way to reach other tabs, and the
 * sync then clears locally only.
 */
export type TransportFactory = (
  onMessage: (message: ClearMessage) => void
) => TabTransport | undefined

export const QUERY_SYNC_CHANNEL = "forge-dashboard:query-store"
export const QUERY_SYNC_STORAGE_KEY = "forge-dashboard:query-store-cleared"

/**
 * The least time between two revalidations on return, counted from the last
 * time this tab refreshed everything (a revalidation or a clear).
 *
 * Without it, flicking between tabs would refetch every watched query on
 * each flick. Ten seconds lets a glance at another tab cost nothing. A return
 * inside the interval is not ignored, though: it schedules one revalidation
 * for when the interval runs out, so a change made in another tool just
 * after the last refresh still shows up without another flick. A switch made
 * in another dashboard tab never waits on this: it arrives as a message.
 */
export const REVALIDATE_MIN_INTERVAL_MS = 10_000

function isClearMessage(value: unknown): value is ClearMessage {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<ClearMessage>
  return candidate.kind === "clear" && typeof candidate.source === "string"
}

/**
 * BroadcastChannel where the browser has it, and a `storage` event where it
 * does not.
 *
 * The fallback writes a fresh value under one key and removes it straight
 * away. A `storage` event fires in every other document of the origin on
 * each change and never in the one that wrote, so the write is the message
 * and the removal (a `null` newValue) is ignored.
 */
export const browserTransport: TransportFactory = (onMessage) => {
  if (typeof globalThis.BroadcastChannel === "function") {
    const channel = new globalThis.BroadcastChannel(QUERY_SYNC_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      if (isClearMessage(event.data)) onMessage(event.data)
    }
    return {
      post: (message) => channel.postMessage(message),
      close: () => channel.close(),
    }
  }

  if (typeof window === "undefined") return undefined

  const onStorage = (event: StorageEvent) => {
    if (event.key !== QUERY_SYNC_STORAGE_KEY || !event.newValue) return
    let parsed: unknown
    try {
      parsed = JSON.parse(event.newValue)
    } catch {
      return
    }
    if (isClearMessage(parsed)) onMessage(parsed)
  }
  window.addEventListener("storage", onStorage)
  return {
    post: (message) => {
      // Storage can be full, disabled or blocked outright. The local clear
      // has already happened by the time this runs; failing to tell the
      // other tabs is no reason to fail that.
      try {
        window.localStorage.setItem(
          QUERY_SYNC_STORAGE_KEY,
          JSON.stringify(message)
        )
        window.localStorage.removeItem(QUERY_SYNC_STORAGE_KEY)
      } catch {
        // Nothing to do. The other tabs catch up when they are next shown.
      }
    },
    close: () => window.removeEventListener("storage", onStorage),
  }
}

export interface QuerySyncOptions {
  store?: Pick<QueryStore, "clear" | "revalidate">
  transport?: TransportFactory
  now?: () => number
  /**
   * Whether this tab is the one in front of the operator. Defaults to
   * visible and focused. Tests pass their own to stand two windows up in one
   * document, which has only one focus.
   */
  inFront?: () => boolean
}

export interface QuerySync {
  /** Clears this tab's store and tells the other tabs to clear theirs. */
  clear(): void
  dispose(): void
}

function sourceId(): string {
  // Not crypto.randomUUID: browsers only offer it on a secure context, and a
  // dashboard served over plain http on a LAN address is not one.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createQuerySync(options: QuerySyncOptions = {}): QuerySync {
  const store = options.store ?? queryStore
  const now = options.now ?? Date.now
  const source = sourceId()
  let seq = 0
  let pending = false
  let lastRefreshAt = now()
  let trailing: ReturnType<typeof setTimeout> | undefined

  const inFront =
    options.inFront ??
    (() => document.visibilityState !== "hidden" && document.hasFocus())

  const refreshed = () => {
    lastRefreshAt = now()
    if (trailing !== undefined) {
      clearTimeout(trailing)
      trailing = undefined
    }
  }

  /**
   * Applies a held clear if this tab is now the one in front, or `used` says
   * the operator just pressed something in it. True when it did.
   */
  const applyPending = (used = false): boolean => {
    if (!pending || !(used || inFront())) return false
    pending = false
    store.clear()
    refreshed()
    return true
  }

  const transport = (options.transport ?? browserTransport)((message) => {
    // A tab never reacts to itself. BroadcastChannel already skips the
    // posting object, but a second sync in the same document (or a transport
    // that echoes) would not.
    if (message.source === source) return
    // Usually this tab is not in front (the operator is in the one that
    // sent the message) and the clear waits for focus. See the module docs.
    pending = true
    applyPending()
  })

  const revalidate = () => {
    const wait = lastRefreshAt + REVALIDATE_MIN_INTERVAL_MS - now()
    if (wait <= 0) {
      store.revalidate()
      refreshed()
      return
    }
    if (trailing !== undefined) return
    trailing = setTimeout(() => {
      trailing = undefined
      if (!inFront()) {
        // Gone again. The interval is spent, so the next return revalidates
        // straight away.
        away = true
        return
      }
      store.revalidate()
      refreshed()
    }, wait)
  }

  // Set on the way out (hidden or blurred), so only a real return counts. A
  // browser that fires "visible" and "focus" together, or either one twice,
  // gets one revalidation, not two.
  let away = !inFront()

  const onReturn = () => {
    // Visible but not focused yet. The focus event that follows does the
    // work; doing it now would let a window behind the operator's reconcile.
    if (!inFront()) return
    if (applyPending()) {
      // A known change beats a guess, and a clear refetches everything a
      // revalidation would.
      away = false
      return
    }
    if (!away) return
    away = false
    revalidate()
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") away = true
    else onReturn()
  }
  const onBlur = () => {
    away = true
  }
  // Belt and braces for the write path. Clicking into a window focuses it
  // before the click lands, but the order of window focus against pointer
  // events is the browser's business. A capturing pointerdown or keydown
  // runs before any click or submit handler on the page, so a held clear is
  // always applied before the operator's first action in this tab. It does
  // not wait on hasFocus: an operator pressing something here is using this
  // tab whatever the focus bookkeeping says.
  const onInput = () => {
    // The clear stands in for this return's revalidation, as in onReturn.
    if (applyPending(true)) away = false
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("focus", onReturn)
  window.addEventListener("blur", onBlur)
  window.addEventListener("pointerdown", onInput, true)
  window.addEventListener("keydown", onInput, true)

  return {
    clear() {
      store.clear()
      refreshed()
      // This clear covers whatever another tab asked for while we were away.
      pending = false
      // Always told. Whatever made this clear (a picker, a different person
      // signed in, a routed page reconciling the server to its URL) happened
      // in the tab in front, or was this tab's own business, and the server
      // has moved for every tab either way.
      transport?.post({ kind: "clear", source, seq: ++seq })
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onReturn)
      window.removeEventListener("blur", onBlur)
      window.removeEventListener("pointerdown", onInput, true)
      window.removeEventListener("keydown", onInput, true)
      if (trailing !== undefined) clearTimeout(trailing)
      transport?.close()
    },
  }
}

let active: QuerySync | undefined

/**
 * Drops every cached answer because the context or the identity changed.
 *
 * Call this, never `queryStore.clear()` directly, from anything that changes
 * what every read in the dashboard means. With a host mounted it also tells
 * the other tabs. Without one (a component rendered alone in a test) it is the
 * plain local clear.
 */
export function clearQueries(): void {
  if (active) active.clear()
  else queryStore.clear()
}

/** Installs the cross-tab sync and the revalidation on return for as long as the calling component is mounted. */
export function useQuerySync(): void {
  useEffect(() => {
    const sync = createQuerySync()
    active = sync
    return () => {
      sync.dispose()
      if (active === sync) active = undefined
    }
  }, [])
}
