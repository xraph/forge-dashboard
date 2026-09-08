import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueryStore } from "../src/store"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("QueryStore", () => {
  let store: QueryStore

  beforeEach(() => {
    store = new QueryStore()
  })

  it("keys on extension, intent and params together", () => {
    const a = store.keyOf("auth", "users.list", { page: 1 })
    const b = store.keyOf("auth", "users.list", { page: 2 })
    const c = store.keyOf("organization", "users.list", { page: 1 })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(store.keyOf("auth", "users.list", { page: 1 })).toBe(a)
  })

  it("keys the same regardless of the order params were written in", () => {
    expect(store.keyOf("auth", "users.list", { a: 1, b: 2 })).toBe(
      store.keyOf("auth", "users.list", { b: 2, a: 1 }),
    )
  })

  it("issues one request when two readers ask for the same key at once", async () => {
    const fetcher = vi.fn().mockResolvedValue({ users: [] })
    const key = store.keyOf("auth", "users.list")
    store.read(key, fetcher, 0)
    store.read(key, fetcher, 0)
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("serves a fresh entry without refetching", async () => {
    const fetcher = vi.fn().mockResolvedValue({ users: [] })
    const key = store.keyOf("auth", "users.list")
    store.read(key, fetcher, 60_000)
    await vi.waitFor(() => expect(store.snapshot(key).loading).toBe(false))

    store.read(key, fetcher, 60_000)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(store.snapshot(key).data).toEqual({ users: [] })
  })

  it("refetches a stale entry", async () => {
    const fetcher = vi.fn().mockResolvedValue({ users: [] })
    const key = store.keyOf("auth", "users.list")
    store.read(key, fetcher, 0)
    await vi.waitFor(() => expect(store.snapshot(key).loading).toBe(false))

    store.read(key, fetcher, 0)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("notifies subscribers when an entry settles", async () => {
    const listener = vi.fn()
    const key = store.keyOf("auth", "users.list")
    store.subscribe(key, listener)
    store.read(key, () => Promise.resolve({ users: [] }), 0)
    await vi.waitFor(() => expect(listener).toHaveBeenCalled())
  })

  it("stops notifying after unsubscribe", async () => {
    const listener = vi.fn()
    const key = store.keyOf("auth", "users.list")
    const unsubscribe = store.subscribe(key, listener)
    unsubscribe()
    store.read(key, () => Promise.resolve({ users: [] }), 0)
    await Promise.resolve()
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })

  it("records a failure as an error rather than throwing out of read", async () => {
    const key = store.keyOf("auth", "users.list")
    store.read(key, () => Promise.reject(new Error("boom")), 0)
    await vi.waitFor(() => expect(store.snapshot(key).loading).toBe(false))
    expect(store.snapshot(key).error).toBeTruthy()
  })

  it("lets a later read supersede an in-flight one whichever settles last", async () => {
    const key = store.keyOf("auth", "users.list")
    const first = deferred<{ tag: string }>()
    const second = deferred<{ tag: string }>()

    store.read(key, () => first.promise, 0)
    store.read(key, () => second.promise, 0)

    // The older request settles last and must not win.
    second.resolve({ tag: "second" })
    await vi.waitFor(() => expect(store.snapshot(key).data).toEqual({ tag: "second" }))
    first.resolve({ tag: "first" })
    await Promise.resolve()
    expect(store.snapshot(key).data).toEqual({ tag: "second" })
  })

  it("drops only the named intents when a command invalidates", async () => {
    const list = store.keyOf("auth", "users.list")
    const roles = store.keyOf("auth", "roles.list")
    store.read(list, () => Promise.resolve({ users: [] }), 60_000)
    store.read(roles, () => Promise.resolve({ roles: [] }), 60_000)
    await vi.waitFor(() => expect(store.snapshot(roles).data).toBeTruthy())

    store.invalidate("auth", ["users.list"])
    expect(store.snapshot(list).data).toBeUndefined()
    expect(store.snapshot(roles).data).toEqual({ roles: [] })
  })

  it("invalidates every params variant of one intent", async () => {
    const page1 = store.keyOf("auth", "users.list", { page: 1 })
    const page2 = store.keyOf("auth", "users.list", { page: 2 })
    store.read(page1, () => Promise.resolve({ users: [] }), 60_000)
    store.read(page2, () => Promise.resolve({ users: [] }), 60_000)
    await vi.waitFor(() => expect(store.snapshot(page2).data).toBeTruthy())

    store.invalidate("auth", ["users.list"])
    expect(store.snapshot(page1).data).toBeUndefined()
    expect(store.snapshot(page2).data).toBeUndefined()
  })

  it("cannot invalidate another extension's cache even when it names the intent", async () => {
    const authUsers = store.keyOf("auth", "users.list")
    store.read(authUsers, () => Promise.resolve({ users: [] }), 60_000)
    await vi.waitFor(() => expect(store.snapshot(authUsers).data).toBeTruthy())

    store.invalidate("organization", ["users.list"])
    expect(store.snapshot(authUsers).data).toEqual({ users: [] })
  })

  it("notifies subscribers of an invalidated key so a mounted reader can refetch", async () => {
    const key = store.keyOf("auth", "users.list")
    store.read(key, () => Promise.resolve({ users: [] }), 60_000)
    await vi.waitFor(() => expect(store.snapshot(key).data).toBeTruthy())

    const listener = vi.fn()
    store.subscribe(key, listener)
    store.invalidate("auth", ["users.list"])
    expect(listener).toHaveBeenCalled()
  })

  it("clear drops everything, which is what an app switch needs", async () => {
    const a = store.keyOf("auth", "users.list")
    const b = store.keyOf("streaming-contract", "stats")
    store.read(a, () => Promise.resolve({ users: [] }), 60_000)
    store.read(b, () => Promise.resolve({ totalRooms: 0 }), 60_000)
    await vi.waitFor(() => expect(store.snapshot(b).data).toBeTruthy())

    store.clear()
    expect(store.snapshot(a).data).toBeUndefined()
    expect(store.snapshot(b).data).toBeUndefined()
  })

  it("returns one stable snapshot object per key so useSyncExternalStore does not loop", async () => {
    const key = store.keyOf("auth", "users.list")
    store.read(key, () => Promise.resolve({ users: [] }), 60_000)
    await vi.waitFor(() => expect(store.snapshot(key).data).toBeTruthy())
    expect(store.snapshot(key)).toBe(store.snapshot(key))
  })
})
