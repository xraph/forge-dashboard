import { expect, it, vi } from "vitest"
import { createScopedClient } from "../src/client"
import { QueryStore } from "../src/store"
function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}
it("forwards query cancellation without serializing it or affecting commands", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: {} }) })
  const signal = new AbortController().signal
  const client = createScopedClient("/contract", "dispatch", fetcher)
  await client.query(
    "durable.execution",
    { namespace: "production" },
    { signal }
  )
  expect(fetcher.mock.calls[0][1].signal).toBe(signal)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("signal")
})
it("keeps a shared read until its last opted-in subscriber leaves and fences ignored abort", async () => {
  const store = new QueryStore(),
    key = store.keyOf("dispatch", "durable.execution")
  const task = deferred()
  let signal!: AbortSignal
  const first = store.subscribe(key, () => {})
  const second = store.subscribe(key, () => {})
  store.read(
    key,
    (s) => {
      signal = s!
      return task.promise
    },
    0,
    { cancelOnUnused: true }
  )
  first()
  expect(signal.aborted).toBe(false)
  second()
  expect(signal.aborted).toBe(true)
  task.resolve({ protected: true })
  await Promise.resolve()
  expect(store.snapshot(key)).toEqual({ loading: false })
})
it("preserves non-opted-in in-flight behavior", async () => {
  const store = new QueryStore(),
    key = store.keyOf("auth", "users.list"),
    task = deferred()
  let signal!: AbortSignal
  const stop = store.subscribe(key, () => {})
  store.read(
    key,
    (s) => {
      signal = s!
      return task.promise
    },
    0
  )
  stop()
  expect(signal.aborted).toBe(false)
  task.resolve("result")
  await Promise.resolve()
  expect(store.snapshot(key).data).toBe("result")
})
it("blanks changed clients and fences old data even when the fetch ignores abort", async () => {
  const store = new QueryStore(),
    key = store.keyOf("dispatch", "durable.execution"),
    old = deferred()
  const owner = {},
    replacement = {}
  let oldSignal!: AbortSignal
  store.read(
    key,
    (signal) => {
      oldSignal = signal!
      return old.promise
    },
    0,
    { owner, cancelOnUnused: true }
  )
  expect(store.snapshot(key, replacement).data).toBeUndefined()
  store.read(key, () => Promise.resolve("new"), 60_000, {
    owner: replacement,
    cancelOnUnused: true,
  })
  await Promise.resolve()
  old.resolve("protected old")
  await Promise.resolve()
  expect(oldSignal.aborted).toBe(true)
  expect(store.snapshot(key).data).toBe("new")
})
it("clear and invalidation abort opted-in work, refetch watched keys and retain proper blanking", async () => {
  const store = new QueryStore(),
    key = store.keyOf("dispatch", "durable.execution")
  const requests: { signal: AbortSignal; task: ReturnType<typeof deferred> }[] =
    []
  const fetcher = (signal?: AbortSignal) => {
    const task = deferred()
    requests.push({ signal: signal!, task })
    return task.promise
  }
  store.subscribe(key, () => {})
  store.read(key, fetcher, 0, { cancelOnUnused: true })
  requests[0].task.resolve("first")
  await Promise.resolve()
  store.invalidate("dispatch", ["durable.execution"])
  expect(store.snapshot(key).data).toBe("first")
  store.clear()
  expect(requests[1].signal.aborted).toBe(true)
  expect(store.snapshot(key).data).toBeUndefined()
  requests[1].task.resolve("ignored")
  requests[2].task.resolve("current")
  await Promise.resolve()
  expect(store.snapshot(key)).toEqual({ data: "current", loading: false })
})

it("replaces an unowned pending read before an opted-in owner can adopt it", async () => {
  const store = new QueryStore()
  const key = store.keyOf("dispatch", "durable.execution")
  const old = deferred(),
    current = deferred(),
    owner = {}
  const first = store.subscribe(key, () => {})
  const second = store.subscribe(key, () => {})
  store.read(key, () => old.promise, 60_000)
  expect(store.snapshot(key, owner).data).toBeUndefined()
  let signal!: AbortSignal
  const fetcher = vi.fn((s?: AbortSignal) => {
    signal = s!
    return current.promise
  })
  store.read(key, fetcher, 60_000, { owner, cancelOnUnused: true })
  expect(fetcher).toHaveBeenCalledOnce()
  const shared = vi.fn(() => Promise.resolve("unused"))
  store.read(key, shared, 60_000, { owner, cancelOnUnused: true })
  expect(shared).not.toHaveBeenCalled()
  old.resolve("protected old")
  await Promise.resolve()
  expect(store.snapshot(key, owner)).toEqual({ loading: true })
  first()
  expect(signal.aborted).toBe(false)
  second()
  expect(signal.aborted).toBe(true)
  current.resolve("late new")
  await Promise.resolve()
  expect(store.snapshot(key, owner)).toEqual({ loading: false })
})
it("blanks fresh unowned data and fetches for an opted-in owner without changing ordinary cache reuse", async () => {
  const store = new QueryStore()
  const key = store.keyOf("dispatch", "durable.execution")
  const owner = {},
    old = deferred(),
    current = deferred()
  store.read(key, () => old.promise, 60_000)
  old.resolve("protected old")
  await Promise.resolve()
  const ordinary = vi.fn(() => Promise.resolve("unused"))
  expect(store.read(key, ordinary, 60_000).data).toBe("protected old")
  expect(ordinary).not.toHaveBeenCalled()
  expect(store.snapshot(key, owner)).toEqual({ loading: true })
  const fetcher = vi.fn(() => current.promise)
  expect(
    store.read(key, fetcher, 60_000, { owner, cancelOnUnused: true })
  ).toEqual({ loading: true })
  expect(fetcher).toHaveBeenCalledOnce()
  current.resolve("current")
  await Promise.resolve()
  expect(store.snapshot(key, owner)).toEqual({
    data: "current",
    loading: false,
  })
})
