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
 * every other tab clears too.
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
export type TransportFactory = (onMessage: (message: ClearMessage) => void) => TabTransport | undefined

export const QUERY_SYNC_CHANNEL = "forge-dashboard:query-store"
export const QUERY_SYNC_STORAGE_KEY = "forge-dashboard:query-store-cleared"

/**
 * How long after applying another tab's clear a clear of our own counts as a
 * reaction to it, and is kept local.
 *
 * The reaction is real. A routed page whose URL names app B, told that the
 * server now says app A, switches the server back to B and clears. If that
 * clear went out, the first tab (whose URL says A) would switch back to A,
 * and two visible windows on different apps would trade switches until one
 * closed. The reaction is two round trips (re-read the context, send the
 * switch), so ten seconds covers a slow server, and only the first clear in
 * the window is swallowed: the operator's next switch goes out as usual.
 */
const ECHO_WINDOW_MS = 10_000

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
        window.localStorage.setItem(QUERY_SYNC_STORAGE_KEY, JSON.stringify(message))
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
  let echoUntil = 0

  const hidden = () => document.visibilityState === "hidden"

  const transport = (options.transport ?? browserTransport)((message) => {
    // A tab never reacts to itself. BroadcastChannel already skips the
    // posting object, but a second sync in the same document (or a transport
    // that echoes) would not.
    if (message.source === source) return

    // A hidden tab holds the clear until it is shown. Clearing now would
    // refetch pages nobody is looking at, and worse, a routed page in that
    // tab would reconcile the server back to its own URL's app, undoing the
    // switch the operator just made in the tab they are actually using.
    if (hidden()) {
      pending = true
      return
    }
    store.clear()
    echoUntil = now() + ECHO_WINDOW_MS
  })

  const onVisibilityChange = () => {
    if (hidden() || !pending) return
    pending = false
    // Not marked as an echo. This tab is the one in front of the operator
    // now, and whatever it does next (its URL reconciling the server, say)
    // is news the other tabs should hear.
    store.clear()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)

  return {
    clear() {
      store.clear()
      // This clear covers whatever another tab asked for while we were away.
      pending = false
      const echo = now() < echoUntil
      echoUntil = 0
      if (echo) return
      transport?.post({ kind: "clear", source, seq: ++seq })
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibilityChange)
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

/** Installs the cross-tab sync for as long as the calling component is mounted. */
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
