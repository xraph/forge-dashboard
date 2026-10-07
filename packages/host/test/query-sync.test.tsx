import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { QueryStore } from "@forge-go/dashboard-plugin"
import {
  QUERY_SYNC_CHANNEL,
  QUERY_SYNC_STORAGE_KEY,
  REVALIDATE_MIN_INTERVAL_MS,
  clearQueries,
  createQuerySync,
  useQuerySync,
} from "../src/host/query-sync"
import type { ClearMessage, QuerySync, TransportFactory } from "../src/host/query-sync"

/** Drives document.visibilityState, which is a getter and not writable. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  })
  document.dispatchEvent(new Event("visibilitychange"))
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
  return { factory, posted, handlers }
}

function fakeStore() {
  return { clear: vi.fn(), revalidate: vi.fn() }
}

describe("query sync across tabs", () => {
  const open: QuerySync[] = []
  function sync(...args: Parameters<typeof createQuerySync>) {
    const created = createQuerySync(...args)
    open.push(created)
    return created
  }

  beforeEach(() => setHidden(false))
  afterEach(() => {
    for (const created of open.splice(0)) created.dispose()
    setHidden(false)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

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

  it("does not pass on a clear it received, so two tabs cannot bounce one forever", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync({ store: fakeStore(), transport: channel.factory })
    sync({ store: there, transport: channel.factory })

    sender.clear()

    expect(there.clear).toHaveBeenCalledOnce()
    expect(channel.posted).toHaveLength(1)
  })

  it("holds a clear for a hidden tab until it is visible again", () => {
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

  it("does not pass on the clear a visible tab makes in reaction to another tab's", () => {
    let now = 1_000_000
    const channel = bus()
    const sender = sync({ store: fakeStore(), transport: channel.factory, now: () => now })
    const receiver = sync({ store: fakeStore(), transport: channel.factory, now: () => now })

    sender.clear()
    expect(channel.posted).toHaveLength(1)

    // The receiver's routed page saw the server disagree with its URL and
    // switched back. Telling the sender would have it switch back too, and so
    // on for as long as both windows are open.
    now += 2_000
    receiver.clear()
    expect(channel.posted).toHaveLength(1)

    // Only the one reaction is swallowed. The next switch is the operator's.
    now += 1_000
    receiver.clear()
    expect(channel.posted).toHaveLength(2)
  })

  it("passes on a clear made long after the last one it received", () => {
    let now = 1_000_000
    const channel = bus()
    const sender = sync({ store: fakeStore(), transport: channel.factory, now: () => now })
    const receiver = sync({ store: fakeStore(), transport: channel.factory, now: () => now })

    sender.clear()
    now += 60_000
    receiver.clear()
    expect(channel.posted).toHaveLength(2)
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
  const open: QuerySync[] = []
  let now = 1_000_000
  function sync(store: ReturnType<typeof fakeStore>, transport = bus().factory) {
    const created = createQuerySync({ store, transport, now: () => now })
    open.push(created)
    return created
  }

  beforeEach(() => {
    now = 1_000_000
    setHidden(false)
  })
  afterEach(() => {
    for (const created of open.splice(0)) created.dispose()
    setHidden(false)
  })

  it("revalidates every watched query once when a hidden tab becomes visible", () => {
    const store = fakeStore()
    sync(store)

    setHidden(true)
    now += REVALIDATE_MIN_INTERVAL_MS
    setHidden(false)
    // A browser can repeat the event. Only a return from hidden counts.
    document.dispatchEvent(new Event("visibilitychange"))

    expect(store.revalidate).toHaveBeenCalledOnce()
    expect(store.clear).not.toHaveBeenCalled()
  })

  it("does not revalidate on a quick hide and show inside the interval", () => {
    const store = fakeStore()
    sync(store)

    setHidden(true)
    now += REVALIDATE_MIN_INTERVAL_MS
    setHidden(false)
    expect(store.revalidate).toHaveBeenCalledOnce()

    // Flipping back and forth costs nothing until the interval has passed
    // since the last revalidation, then costs exactly one more.
    for (let flip = 0; flip < 5; flip++) {
      now += 1_000
      setHidden(true)
      setHidden(false)
    }
    expect(store.revalidate).toHaveBeenCalledOnce()

    now += REVALIDATE_MIN_INTERVAL_MS
    setHidden(true)
    setHidden(false)
    expect(store.revalidate).toHaveBeenCalledTimes(2)
  })

  it("counts a clear as a refresh, so a return just after one does not revalidate", () => {
    const store = fakeStore()
    const here = sync(store)

    now += REVALIDATE_MIN_INTERVAL_MS
    here.clear()
    now += 1_000
    setHidden(true)
    setHidden(false)
    expect(store.revalidate).not.toHaveBeenCalled()
  })

  it("applies a held clear on return instead of revalidating", () => {
    const channel = bus()
    const there = fakeStore()
    const sender = sync(fakeStore(), channel.factory)
    sync(there, channel.factory)

    setHidden(true)
    now += REVALIDATE_MIN_INTERVAL_MS
    sender.clear()
    setHidden(false)

    expect(there.clear).toHaveBeenCalledOnce()
    expect(there.revalidate).not.toHaveBeenCalled()
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
