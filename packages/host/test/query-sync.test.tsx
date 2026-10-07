import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryStore } from "@forge-go/dashboard-plugin"
import {
  QUERY_SYNC_CHANNEL,
  QUERY_SYNC_STORAGE_KEY,
  REVALIDATE_MIN_INTERVAL_MS,
  clearQueries,
  createQuerySync,
  useQuerySync,
} from "../src/host/query-sync"
import type {
  ClearMessage,
  QuerySync,
  QuerySyncOptions,
  TransportFactory,
} from "../src/host/query-sync"

/** Drives document.visibilityState, which is a getter and not writable. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  })
  document.dispatchEvent(new Event("visibilitychange"))
}

/**
 * Drives document.hasFocus(). jsdom answers false until an element has been
 * focused, which is not what a window the operator is using looks like.
 */
let focused = true
function setFocused(next: boolean) {
  focused = next
  window.dispatchEvent(new Event(next ? "focus" : "blur"))
}

/**
 * An in-memory channel that hands every message to every tab on it,
 * the sender included. BroadcastChannel never delivers to the posting object
 * itself, so this is stricter than the real thing: it is what proves a tab
 * ignores its own message rather than relying on the browser not to send it.
 */
function bus() {
  const handlers = new Set<(message: ClearMessage) => void>()
  const posted: ClearMessage[] = []
  const factory: TransportFactory = (onMessage) => {
    handlers.add(onMessage)
    return {
      post: (message) => {
        posted.push(message)
        for (const handler of [...handlers]) handler(message)
      },
      close: () => handlers.delete(onMessage),
    }
  }
  return { factory, posted }
}

function fakeStore() {
  return { clear: vi.fn(), revalidate: vi.fn() }
}

const open: QuerySync[] = []
function sync(options: QuerySyncOptions) {
  const created = createQuerySync(options)
  open.push(created)
  return created
}

beforeEach(() => {
  focused = true
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused)
  setHidden(false)
})
afterEach(() => {
  for (const created of open.splice(0)) created.dispose()
  setHidden(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("query sync across tabs", () => {
  it("clears its own store and tells the other tabs, which clear theirs", () => {
    const channel = bus()
    const here = fakeStore()
    const there = fakeStore()
    const sender = sync({ store: here, transport: channel.factory })
    sync({ store: there, transport: channel.factory })

    sender.clear()

    expect(here.clear).toHaveBeenCalledOnce()
    expect(there.clear).toHaveBeenCalledOnce()
    expect(channel.posted).toHaveLength(1)
  })

  it("ignores its own message", () => {
    const channel = bus()
    const here = fakeStore()
    const sender = sync({ store: here, transport: channel.factory })

    sender.clear()

    // Once for the clear itself. The bus handed the message straight back
    // to the sender, and a second clear here would refetch every page twice.
    expect(here.clear).toHaveBeenCalledOnce()
  })

  it("does not pass on a clear it received", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory })
    sync({ store: there, transport: channel.factory })

    sender.clear()

    expect(there.clear).toHaveBeenCalledOnce()
    expect(channel.posted).toHaveLength(1)
  })

  it("holds a clear for a hidden tab until it is back in front", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory })
    sync({ store: there, transport: channel.factory })

    setHidden(true)
    sender.clear()
    sender.clear()
    expect(there.clear).not.toHaveBeenCalled()

    setHidden(false)
    // One clear for however many arrived while it was away.
    expect(there.clear).toHaveBeenCalledOnce()
  })

  it("holds a clear for a visible window without focus until it gets focus", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory })
    sync({ store: there, transport: channel.factory })

    setFocused(false)
    sender.clear()
    expect(there.clear).not.toHaveBeenCalled()

    // Shown, but still behind the operator's window. Not yet.
    setHidden(true)
    setHidden(false)
    expect(there.clear).not.toHaveBeenCalled()

    setFocused(true)
    expect(there.clear).toHaveBeenCalledOnce()
  })

  it("tells the other tabs about every clear it makes, even straight after applying one", () => {
    // Two windows, both visible. The operator switches org in the first,
    // then goes to the second and switches org there too, within seconds.
    // The second switch must reach the first window, or it keeps the first
    // org's rows for good.
    const channel = bus()
    let w1Front = true
    const w1 = fakeStore()
    const w2 = fakeStore()
    const one = sync({ store: w1, transport: channel.factory, inFront: () => w1Front })
    const two = sync({ store: w2, transport: channel.factory, inFront: () => !w1Front })

    one.clear()
    w1Front = false
    window.dispatchEvent(new Event("focus"))
    expect(w2.clear).toHaveBeenCalledOnce()

    two.clear()
    expect(channel.posted).toHaveLength(2)
    w1Front = true
    window.dispatchEvent(new Event("focus"))
    expect(w1.clear).toHaveBeenCalledTimes(2)
  })

  it("lets only the window in front reconcile, so two windows on different apps never trade switches", () => {
    // Window 1's URL names app A, window 2's names app B. A clear makes a
    // routed page re-read the context, and when the server disagrees with
    // its URL it switches the server back and clears again: that clear is
    // `reconcile` here.
    const channel = bus()
    let w1Front = true
    const w1 = fakeStore()
    const w2 = fakeStore()
    const one = sync({ store: w1, transport: channel.factory, inFront: () => w1Front })
    const two = sync({ store: w2, transport: channel.factory, inFront: () => !w1Front })

    // The operator switches the server to A in window 1. Window 2 is behind
    // and must not touch the server, so it must not even refetch.
    one.clear()
    expect(w2.clear).not.toHaveBeenCalled()
    expect(channel.posted).toHaveLength(1)

    // The operator moves to window 2. It applies the held clear, finds the
    // server on A, and switches it back to B. That is a real switch for the
    // window in front, so it goes out, and window 1 (now behind) holds it.
    w1Front = false
    window.dispatchEvent(new Event("focus"))
    expect(w2.clear).toHaveBeenCalledOnce()
    two.clear()
    expect(channel.posted).toHaveLength(2)
    expect(w1.clear).toHaveBeenCalledOnce()

    // Nothing else happens until the operator moves again.
    expect(channel.posted).toHaveLength(2)
  })

  it("applies a held clear before a click handler in that tab runs", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory })
    sync({ store: there, transport: channel.factory })

    const clearsSeenByClick: number[] = []
    const clearsSeenByKey: number[] = []
    render(
      <>
        <button onClick={() => clearsSeenByClick.push(there.clear.mock.calls.length)}>
          revoke
        </button>
        <input onKeyDown={() => clearsSeenByKey.push(there.clear.mock.calls.length)} aria-label="name" />
      </>,
    )

    // jsdom never moves window focus on a click, which makes it the worst
    // case: the click lands while hasFocus still says no.
    setFocused(false)
    sender.clear()
    expect(there.clear).not.toHaveBeenCalled()
    const button = screen.getByRole("button", { name: "revoke" })
    fireEvent.pointerDown(button)
    fireEvent.mouseDown(button)
    fireEvent.mouseUp(button)
    fireEvent.click(button)
    expect(clearsSeenByClick).toEqual([1])

    sender.clear()
    fireEvent.keyDown(screen.getByRole("textbox", { name: "name" }), { key: "a" })
    expect(clearsSeenByKey).toEqual([2])
  })

  it("stops listening once disposed", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory })
    const receiver = sync({ store: there, transport: channel.factory })

    receiver.dispose()
    sender.clear()
    expect(there.clear).not.toHaveBeenCalled()
  })

  it("reaches another tab over a real BroadcastChannel", async () => {
    expect(typeof globalThis.BroadcastChannel).toBe("function")
    const there = new QueryStore()
    const key = there.keyOf("keysmith", "keys.list")
    there.read(key, () => Promise.resolve({ org: "a" }), 60_000)
    await vi.waitFor(() => expect(there.snapshot(key).data).toBeTruthy())

    const sender = sync({ store: new QueryStore() })
    sync({ store: there })
    sender.clear()

    await vi.waitFor(() => expect(there.snapshot(key).data).toBeUndefined())
  })

  it("falls back to storage events where BroadcastChannel is missing", () => {
    vi.stubGlobal("BroadcastChannel", undefined)
    const written: string[] = []
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === QUERY_SYNC_STORAGE_KEY) written.push(value)
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {})

    const here = fakeStore()
    const there = fakeStore()
    const sender = sync({ store: here })
    sync({ store: there })
    sender.clear()
    expect(written).toHaveLength(1)

    // A storage event only ever fires in the *other* documents of the origin,
    // so jsdom never delivers one for our own write. Hand it over by hand,
    // which also reaches the sender's listener and proves it ignores itself.
    window.dispatchEvent(
      new StorageEvent("storage", { key: QUERY_SYNC_STORAGE_KEY, newValue: written[0] }),
    )
    expect(there.clear).toHaveBeenCalledOnce()
    expect(here.clear).toHaveBeenCalledOnce()

    // The removal that follows every write, and anything that is not ours.
    window.dispatchEvent(new StorageEvent("storage", { key: QUERY_SYNC_STORAGE_KEY, newValue: null }))
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: written[0] }))
    window.dispatchEvent(new StorageEvent("storage", { key: QUERY_SYNC_STORAGE_KEY, newValue: "{" }))
    expect(there.clear).toHaveBeenCalledOnce()
  })

  it("still clears locally where neither transport exists", () => {
    vi.stubGlobal("BroadcastChannel", undefined)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled")
    })

    const here = fakeStore()
    sync({ store: here }).clear()
    expect(here.clear).toHaveBeenCalledOnce()
  })
})

describe("revalidating when a tab comes back", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  function local(store: ReturnType<typeof fakeStore>) {
    return sync({ store, transport: bus().factory, now: () => Date.now() })
  }

  it("revalidates every watched query once when a hidden tab becomes visible", () => {
    const store = fakeStore()
    local(store)

    setHidden(true)
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    setHidden(false)
    // A browser can repeat the event, or follow it with focus. Only one
    // return from hidden counts.
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event("focus"))

    expect(store.revalidate).toHaveBeenCalledOnce()
    expect(store.clear).not.toHaveBeenCalled()
  })

  it("waits for focus before revalidating a window that is visible but behind", () => {
    const store = fakeStore()
    local(store)

    setFocused(false)
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    setHidden(true)
    setHidden(false)
    expect(store.revalidate).not.toHaveBeenCalled()

    setFocused(true)
    expect(store.revalidate).toHaveBeenCalledOnce()
  })

  it("does not revalidate on a quick hide and show, and catches up once when the interval runs out", () => {
    const store = fakeStore()
    local(store)

    setHidden(true)
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    setHidden(false)
    expect(store.revalidate).toHaveBeenCalledOnce()

    // Flipping back and forth inside the interval costs nothing now...
    for (let flip = 0; flip < 5; flip++) {
      vi.advanceTimersByTime(1_000)
      setHidden(true)
      setHidden(false)
    }
    expect(store.revalidate).toHaveBeenCalledOnce()

    // ...and exactly one revalidation when the interval runs out, so a
    // change made in another tool during those flips still shows up.
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    expect(store.revalidate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS * 3)
    expect(store.revalidate).toHaveBeenCalledTimes(2)
  })

  it("schedules a trailing revalidation for a return just after a clear", () => {
    const store = fakeStore()
    const here = local(store)

    here.clear()
    vi.advanceTimersByTime(1_000)
    setHidden(true)
    setHidden(false)
    expect(store.revalidate).not.toHaveBeenCalled()

    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS - 1_000)
    expect(store.revalidate).toHaveBeenCalledOnce()
  })

  it("skips the trailing revalidation if the tab has gone, and revalidates on the next return", () => {
    const store = fakeStore()
    local(store)

    vi.advanceTimersByTime(1_000)
    setHidden(true)
    setHidden(false)
    setHidden(true)
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    expect(store.revalidate).not.toHaveBeenCalled()

    setHidden(false)
    expect(store.revalidate).toHaveBeenCalledOnce()
  })

  it("applies a held clear on return instead of revalidating", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory, now: () => Date.now() })
    sync({ store: there, transport: channel.factory, now: () => Date.now() })

    setHidden(true)
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    sender.clear()
    setHidden(false)

    expect(there.clear).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS * 2)
    expect(there.revalidate).not.toHaveBeenCalled()
  })

  it("cancels a scheduled revalidation when disposed", () => {
    const store = fakeStore()
    const here = local(store)

    vi.advanceTimersByTime(1_000)
    setHidden(true)
    setHidden(false)
    here.dispose()
    vi.advanceTimersByTime(REVALIDATE_MIN_INTERVAL_MS)
    expect(store.revalidate).not.toHaveBeenCalled()
  })
})

describe("clearQueries", () => {
  function Host() {
    useQuerySync()
    return null
  }

  it("broadcasts through the sync a mounted host installed", async () => {
    const received: unknown[] = []
    const listener = new BroadcastChannel(QUERY_SYNC_CHANNEL)
    listener.onmessage = (event) => received.push(event.data)

    const { unmount } = render(<Host />)
    clearQueries()
    await vi.waitFor(() => expect(received).toHaveLength(1))

    // Unmounted, a clear is the plain local one and tells nobody.
    unmount()
    clearQueries()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(received).toHaveLength(1)
    listener.close()
  })
})
