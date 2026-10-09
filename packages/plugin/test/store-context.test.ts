import { expect, it, vi } from "vitest"
import { QueryStore } from "../src/store"
it("observes only context clear and releases reset subscriptions", () => {
  const store = new QueryStore(),
    listener = vi.fn()
  const stop = store.subscribeContext(listener)
  store.invalidate("dispatch", ["durable.history"])
  store.revalidate()
  expect(store.contextSnapshot()).toBe(0)
  expect(listener).not.toHaveBeenCalled()
  store.clear()
  expect(store.contextSnapshot()).toBe(1)
  expect(listener).toHaveBeenCalledOnce()
  stop()
  store.clear()
  expect(store.contextSnapshot()).toBe(2)
  expect(listener).toHaveBeenCalledOnce()
})
it("drops opted-in captured requests without replay and fences ignored abort while ordinary clear still reissues", async () => {
  const store = new QueryStore(),
    opted = store.keyOf("dispatch", "durable.history", { cursor: "old" }),
    ordinary = store.keyOf("auth", "users.list")
  let resolve!: (value: unknown) => void, signal!: AbortSignal
  const protectedRead = vi.fn((s?: AbortSignal) => {
    signal = s!
    return new Promise((r) => {
      resolve = r
    })
  })
  const ordinaryRead = vi.fn(() => Promise.resolve("ordinary"))
  store.subscribe(opted, () => {})
  store.subscribe(ordinary, () => {})
  store.read(opted, protectedRead, 0, {
    resetOnContextChange: true,
    cancelOnUnused: true,
  })
  store.read(ordinary, ordinaryRead, 0)
  store.clear()
  expect(protectedRead).toHaveBeenCalledOnce()
  expect(signal.aborted).toBe(true)
  expect(ordinaryRead).toHaveBeenCalledTimes(2)
  resolve("protected old")
  await Promise.resolve()
  expect(store.snapshot(opted).data).toBeUndefined()
  expect(store.snapshot(ordinary).data).toBe("ordinary")
})
it("adopts context reset before deduplicating a pending read", () => {
  const store = new QueryStore(),
    key = store.keyOf("dispatch", "durable.history")
  const read = vi.fn(() => new Promise(() => {}))
  store.subscribe(key, () => {})
  store.read(key, read, 0)
  store.read(key, read, 0, { resetOnContextChange: true })
  store.clear()
  expect(read).toHaveBeenCalledOnce()
})

it.each(["pending", "fresh"])(
  "installs context reset before a same-owner %s cache return",
  async (state) => {
    const store = new QueryStore(),
      key = store.keyOf("dispatch", "durable.history", { cursor: "old" }),
      owner = {}
    let resolve!: (value: unknown) => void
    const read = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    store.subscribe(key, () => {})
    store.read(key, read, 60_000, { owner, cancelOnUnused: true })
    if (state === "fresh") {
      resolve("old")
      await Promise.resolve()
    }
    store.read(key, read, 60_000, {
      owner,
      cancelOnUnused: true,
      resetOnContextChange: true,
    })
    expect(read).toHaveBeenCalledOnce()
    store.clear()
    expect(read).toHaveBeenCalledOnce()
    if (state === "pending") {
      resolve("ignored old")
      await Promise.resolve()
    }
    expect(store.snapshot(key, owner).data).toBeUndefined()
  }
)
