# Plugin platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@forge-go/dashboard-plugin` a query store that honours the server's own cache and invalidation metadata, a sub-plugin extension point matching authsome's `plugin_iface.go`, and context dimensions that put the app and environment switchers in the host chrome.

**Architecture:** Three layers, built bottom-up. The store sits under `useQuery` and is fed by a metadata callback on the scoped client, so `query()` and `command()` keep their signatures. Sub-plugins reuse `resolvePluginState` unchanged, so an absent Go contributor hides a sub-plugin exactly as it hides a plugin. Context dimensions are declarative on `definePlugin`, and the host renders whatever a plugin declares without knowing what an app is.

**Tech Stack:** React 19 (`useSyncExternalStore`), TypeScript, vitest + @testing-library/react, jsdom, react-router 7.

**Spec:** `docs/superpowers/specs/2026-09-08-dashboard-plugin-platform-design.md`

## Global Constraints

- No new runtime dependency in `packages/plugin` or `packages/host`. `BASELINE.md` governs the eager entry chunk, and the store exists partly so react-query does not have to. If a task seems to need a dependency, stop and re-read `BASELINE.md`.
- `ScopedClient.query(intent, params)` and `ScopedClient.command(intent, payload, opts)` keep their exact current signatures. Metadata reaches the store through a separate callback, never through a changed return type.
- `useQuery` keeps returning `{ data?, error?, loading, refetch }` and `useCommand` keeps returning `{ data?, error?, loading, execute }`. Pages written against the current signatures must keep compiling.
- The contributor name is never a parameter. A client is built bound to one extension, and `hostIntents` is the only widening, checked against an allowlist declared at import time.
- Validation for `defineSubPlugin` throws at import time, matching `definePlugin`. A bad plugin shape breaks the build that includes it.
- Tests live beside their package: `packages/plugin/test/*.test.ts(x)` and `packages/host/test/*.test.tsx`. Run with `pnpm --filter @forge-go/dashboard-plugin test` and `pnpm --filter @forge-go/dashboard-host test`.
- Another session is implementing the auth-gate spec and will add `auth?` to `packages/plugin/src/types.ts` and `onUnauthenticated` to `packages/plugin/src/client.ts`. This plan lands first. Do not add either field here.

---

### Task 1: Parse the server's cache hint

**Files:**
- Create: `packages/plugin/src/duration.ts`
- Test: `packages/plugin/test/duration.test.ts`

**Interfaces:**
- Produces: `parseGoDuration(value: string | undefined): number` returning milliseconds, and `0` for anything it cannot read.

`meta.cacheControl.staleTime` arrives as a Go duration string: `"30s"`, `"1m"`, `"500ms"`, `"1h30m"`. The store needs milliseconds. Returning `0` rather than throwing on an unreadable value is deliberate: zero means "always refetch", which is exactly today's behaviour, so a malformed hint degrades to what the dashboard already does instead of breaking a read.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin/test/duration.test.ts
import { describe, expect, it } from "vitest"
import { parseGoDuration } from "../src/duration"

describe("parseGoDuration", () => {
  it("reads seconds", () => {
    expect(parseGoDuration("30s")).toBe(30_000)
  })

  it("reads minutes and hours", () => {
    expect(parseGoDuration("1m")).toBe(60_000)
    expect(parseGoDuration("2h")).toBe(7_200_000)
  })

  it("reads milliseconds without reading the 'm' as minutes", () => {
    expect(parseGoDuration("500ms")).toBe(500)
  })

  it("sums compound durations", () => {
    expect(parseGoDuration("1h30m")).toBe(5_400_000)
  })

  it("returns 0 for undefined, so a contributor that sends no hint refetches on every mount", () => {
    expect(parseGoDuration(undefined)).toBe(0)
  })

  it("returns 0 for anything it cannot read rather than throwing inside a read", () => {
    expect(parseGoDuration("soon")).toBe(0)
    expect(parseGoDuration("")).toBe(0)
    expect(parseGoDuration("30")).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test duration`
Expected: FAIL, cannot resolve `../src/duration`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/plugin/src/duration.ts

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
}

/**
 * Reads a Go duration string into milliseconds.
 *
 * `meta.cacheControl.staleTime` is produced by Go's `time.Duration.String()`,
 * so it looks like "30s", "1m", "500ms" or "1h30m". Only those four units
 * appear in a cache hint; nanoseconds and microseconds are not modelled
 * because a sub-millisecond stale time is not a thing a dashboard can act on.
 *
 * Anything unreadable returns 0, which the store treats as "always stale".
 * That is today's behaviour for every query, so a contributor sending a
 * malformed hint gets the old dashboard rather than a broken read. Throwing
 * here would turn a server typo into a page that will not render.
 *
 * The unit alternation puts `ms` before `s` and `m` so "500ms" is not read as
 * 500 minutes followed by a stray "s".
 */
export function parseGoDuration(value: string | undefined): number {
  if (!value) return 0

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g
  let total = 0
  let matched = 0
  let consumed = 0

  for (const match of value.matchAll(pattern)) {
    total += Number(match[1]) * UNIT_MS[match[2]]
    matched += 1
    consumed += match[0].length
  }

  // Every character has to belong to a unit-suffixed number. "30" alone and
  // "30s later" both fail here, so a value that is only partly a duration is
  // rejected rather than half-read.
  if (matched === 0 || consumed !== value.length) return 0

  return total
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test duration`
Expected: PASS, six tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/duration.ts packages/plugin/test/duration.test.ts
git commit -m "feat(plugin): parse Go duration strings from the cache hint"
```

---

### Task 2: The query store

**Files:**
- Create: `packages/plugin/src/store.ts`
- Test: `packages/plugin/test/store.test.ts`

**Interfaces:**
- Consumes: `parseGoDuration` from Task 1, `ContractError` from `packages/plugin/src/client.ts`.
- Produces:
  - `QueryStore` class with `read<T>(key: QueryKey, fetcher: () => Promise<T>, staleMs: number): Entry<T>`, `subscribe(key: string, listener: () => void): () => void`, `snapshot<T>(key: string): Entry<T>`, `invalidate(extension: string, intents: string[]): void`, `clear(): void`, `keyOf(extension, intent, params): string`
  - `Entry<T> { data?: T; error?: ContractError; loading: boolean }`
  - `queryStore`, a module-level singleton instance.

This is the piece the rest of the plan sits on. Read the spec's section 2 before starting.

Three behaviours matter and each has a test below. Two components mounting the same key share one in-flight request. An entry inside its stale window is served without a fetch. `invalidate` drops keys belonging to one extension only, and notifies whoever is mounted on them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin/test/store.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test store`
Expected: FAIL, cannot resolve `../src/store`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/plugin/src/store.ts
import { ContractError } from "./client"

/** What one cache key holds. Handed to React, so it must be referentially stable. */
export interface Entry<T> {
  data?: T
  error?: ContractError
  loading: boolean
}

interface Record_<T> {
  entry: Entry<T>
  /** When the data landed. 0 means "never". */
  settledAt: number
  /** Bumped on every issued request. Only the latest generation may write. */
  generation: number
  /** In flight now? Used to collapse concurrent readers onto one request. */
  pending: boolean
  extension: string
  intent: string
}

const EMPTY: Entry<never> = { loading: true }

/**
 * Sorts an object's keys so `{a:1,b:2}` and `{b:2,a:1}` produce one key.
 *
 * `JSON.stringify` preserves insertion order, so without this two components
 * asking the same question with the params written in a different order would
 * each get their own cache entry and their own request. That is not a
 * correctness bug, which is exactly why it would never be noticed.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
}

/**
 * The dashboard's read cache.
 *
 * Deliberately small. No retries, no suspense, no optimistic updates, no
 * infinite queries. What it does have is the three things forty pages need:
 * concurrent readers share one request, a fresh entry is served without a
 * round trip, and a command invalidates exactly the intents the server named.
 *
 * The invalidation set comes off `meta.invalidates`, which the Go dispatcher
 * has always sent and the client has always discarded. That is why page code
 * stops calling `refetch()` after a write: the server already said what went
 * stale, and repeating that knowledge in every page is how the two drift.
 */
export class QueryStore {
  private records = new Map<string, Record_<unknown>>()
  private listeners = new Map<string, Set<() => void>>()

  keyOf(extension: string, intent: string, params?: Record<string, unknown>): string {
    return `${extension}|${intent}|${stableStringify(params ?? {})}`
  }

  /**
   * Splits a key back into the parts `invalidate` matches on.
   *
   * The extension and intent are also stored on the record, so this exists
   * only for keys created before a record was written. Both agree by
   * construction because `read` is the only writer.
   */
  private static parse(key: string): { extension: string; intent: string } {
    const [extension = "", intent = ""] = key.split("|")
    return { extension, intent }
  }

  snapshot<T>(key: string): Entry<T> {
    return (this.records.get(key)?.entry as Entry<T>) ?? (EMPTY as Entry<T>)
  }

  subscribe(key: string, listener: () => void): () => void {
    const set = this.listeners.get(key) ?? new Set()
    set.add(listener)
    this.listeners.set(key, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(key)
    }
  }

  private notify(key: string): void {
    for (const listener of this.listeners.get(key) ?? []) listener()
  }

  private write(key: string, patch: Partial<Record_<unknown>> & { entry: Entry<unknown> }): void {
    const existing = this.records.get(key)
    this.records.set(key, { ...(existing as Record_<unknown>), ...patch })
    this.notify(key)
  }

  /**
   * Reads one key, fetching only when it has to.
   *
   * Returns the current entry synchronously so a caller can render this frame.
   * The fetch, if one is needed, lands later through `subscribe`.
   *
   * `staleMs` of 0 means every call refetches, which is what `useQuery` does
   * today and what a contributor sending no cache hint keeps getting.
   */
  read<T>(key: string, fetcher: () => Promise<T>, staleMs: number): Entry<T> {
    const record = this.records.get(key)
    const fresh =
      record !== undefined &&
      record.settledAt > 0 &&
      Date.now() - record.settledAt < staleMs

    // Someone else already asked this question and has not heard back. Join
    // their request rather than sending a second one.
    if (fresh || record?.pending) return this.snapshot<T>(key)

    const { extension, intent } = QueryStore.parse(key)
    const generation = (record?.generation ?? 0) + 1

    this.records.set(key, {
      entry: { ...(record?.entry ?? {}), loading: true },
      settledAt: record?.settledAt ?? 0,
      generation,
      pending: true,
      extension,
      intent,
    })
    this.notify(key)

    void fetcher().then(
      (data) => {
        // A newer read superseded this one. Its result is the answer to a
        // question nobody is asking any more.
        if (this.records.get(key)?.generation !== generation) return
        this.write(key, {
          entry: { data, loading: false },
          settledAt: Date.now(),
          pending: false,
        })
      },
      (error: unknown) => {
        if (this.records.get(key)?.generation !== generation) return
        this.write(key, {
          entry: {
            error:
              error instanceof ContractError
                ? error
                : new ContractError("TRANSPORT", String(error)),
            loading: false,
          },
          settledAt: Date.now(),
          pending: false,
        })
      },
    )

    return this.snapshot<T>(key)
  }

  /**
   * Drops every entry for the named intents, within one extension only.
   *
   * The extension guard is not defensive tidiness. `users.list` exists on
   * `auth`, and an intent of the same name could exist on any other
   * contributor; a command from one extension must not be able to blow away
   * another's cache by naming a string.
   *
   * Every params variant of a named intent goes: invalidating `users.list`
   * after a ban has to drop page 1 and page 7, and the command has no idea
   * which pages anybody is looking at.
   *
   * Entries are dropped rather than refetched here. Whoever is mounted gets
   * notified and reissues on their next render; whoever is not mounted
   * reissues when they next mount. Refetching from here would fire requests
   * for pages nobody is looking at.
   */
  invalidate(extension: string, intents: string[]): void {
    if (intents.length === 0) return
    const wanted = new Set(intents)

    for (const [key, record] of this.records) {
      if (record.extension !== extension || !wanted.has(record.intent)) continue
      this.records.delete(key)
      this.notify(key)
    }
  }

  /**
   * Drops everything.
   *
   * One caller: a context dimension switch. The app or environment cookie just
   * changed, so every read in the dashboard is now a question about a
   * different app, and the server has no way to enumerate that. This is the
   * only place the store throws away more than it was told to.
   */
  clear(): void {
    const keys = [...this.records.keys()]
    this.records.clear()
    for (const key of keys) this.notify(key)
  }
}

/**
 * The instance the hooks use.
 *
 * Module scope, not React context. Two plugins reading the same intent through
 * different scoped clients should still share one request, and a context
 * provider per plugin would give each its own cache and quietly double every
 * shared read.
 */
export const queryStore = new QueryStore()
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test store`
Expected: PASS, fifteen tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/store.ts packages/plugin/test/store.test.ts
git commit -m "feat(plugin): add the query store"
```

---

### Task 3: Let the client report response metadata

**Files:**
- Modify: `packages/plugin/src/client.ts`
- Modify: `packages/plugin/src/store.ts`
- Test: `packages/plugin/test/client.test.ts` (extend), `packages/plugin/test/store.test.ts` (extend)

**Interfaces:**
- Consumes: `QueryStore` from Task 2.
- Produces:
  - `ResponseMeta { intentVersion?: number; cacheControl?: { staleTime?: string }; invalidates?: string[] }`
  - `MetaListener = (info: { kind: "query" | "command"; extension: string; intent: string; meta: ResponseMeta }) => void`
  - `createScopedClient(contractBase, extension, fetchImpl?, onMeta?)`, a fourth optional parameter
  - On `QueryStore`: `noteStaleTime(extension: string, intent: string, staleMs: number): void` and `staleTimeFor(extension: string, intent: string): number`

`send` currently returns `envelope.data as T` and drops `envelope.meta` on the floor. This task keeps that return type and adds a side channel, because the spec promises `query()` and `command()` keep their signatures.

The stale time arrives with the response, which is after the read it would have governed. So the store learns it from each response and applies it to the next read of that same intent. The first read of any intent always fetches, which is correct and is also what happens today.

- [ ] **Step 1: Write the failing store test**

```ts
// append to packages/plugin/test/store.test.ts, inside describe("QueryStore")

  it("defaults an unknown intent's stale time to 0 so the first read always fetches", () => {
    expect(store.staleTimeFor("auth", "users.list")).toBe(0)
  })

  it("remembers a stale time per extension and intent", () => {
    store.noteStaleTime("auth", "users.list", 30_000)
    expect(store.staleTimeFor("auth", "users.list")).toBe(30_000)
    expect(store.staleTimeFor("auth", "roles.list")).toBe(0)
    expect(store.staleTimeFor("organization", "users.list")).toBe(0)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test store`
Expected: FAIL, `store.staleTimeFor is not a function`.

- [ ] **Step 3: Add the two methods to the store**

Add to the `QueryStore` class in `packages/plugin/src/store.ts`, next to `invalidate`:

```ts
  private staleTimes = new Map<string, number>()

  /**
   * Records what the server said about caching one intent.
   *
   * The hint arrives on the response, which is after the read it would have
   * governed, so it applies from the next read of that intent onward. The
   * first read of anything always goes to the server, which is both correct
   * and what the dashboard does today.
   */
  noteStaleTime(extension: string, intent: string, staleMs: number): void {
    this.staleTimes.set(`${extension}|${intent}`, staleMs)
  }

  staleTimeFor(extension: string, intent: string): number {
    return this.staleTimes.get(`${extension}|${intent}`) ?? 0
  }
```

And extend `clear()` so a context switch forgets cache hints too. Replace the body of `clear()` with:

```ts
  clear(): void {
    const keys = [...this.records.keys()]
    this.records.clear()
    // The hints belong to the previous app's contributors. Keeping them would
    // let a stale hint suppress the first read after a switch.
    this.staleTimes.clear()
    for (const key of keys) this.notify(key)
  }
```

- [ ] **Step 4: Run the store tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test store`
Expected: PASS, seventeen tests.

- [ ] **Step 5: Write the failing client test**

```ts
// append to packages/plugin/test/client.test.ts

import { describe, expect, it, vi } from "vitest"
import { createScopedClient } from "../src/client"

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe("createScopedClient meta reporting", () => {
  it("reports a query's cacheControl to the listener", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        ok: true,
        data: { users: [] },
        meta: { cacheControl: { staleTime: "30s" } },
      }),
    )
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await client.query("users.list")

    expect(onMeta).toHaveBeenCalledWith({
      kind: "query",
      extension: "auth",
      intent: "users.list",
      meta: { cacheControl: { staleTime: "30s" } },
    })
  })

  it("reports a command's invalidates to the listener", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi
      .fn()
      // The CSRF fetch the client makes before its first command.
      .mockResolvedValueOnce(okResponse({ token: "t" }))
      .mockResolvedValueOnce(
        okResponse({
          ok: true,
          data: { ok: true },
          meta: { invalidates: ["users.list", "users.detail"] },
        }),
      )
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await client.command("users.ban", { id: "u1" })

    expect(onMeta).toHaveBeenCalledWith({
      kind: "command",
      extension: "auth",
      intent: "users.ban",
      meta: { invalidates: ["users.list", "users.detail"] },
    })
  })

  it("still resolves with data and no listener attached", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: true, data: { users: [] }, meta: {} }))
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl)
    await expect(client.query("users.list")).resolves.toEqual({ users: [] })
  })

  it("does not call the listener when a request fails", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { code: "PERMISSION_DENIED", message: "no" } }),
    } as unknown as Response)
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await expect(client.query("users.list")).rejects.toThrow()
    expect(onMeta).not.toHaveBeenCalled()
  })

  it("survives a response that carries no meta at all", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true, data: { users: [] } }))
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await expect(client.query("users.list")).resolves.toEqual({ users: [] })
    expect(onMeta).toHaveBeenCalledWith({
      kind: "query",
      extension: "auth",
      intent: "users.list",
      meta: {},
    })
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test client`
Expected: FAIL. `onMeta` is never called, because `createScopedClient` takes three parameters.

- [ ] **Step 7: Modify the client**

In `packages/plugin/src/client.ts`, add the two types near `ContractError`:

```ts
/**
 * The cross-cutting metadata the Go dispatcher attaches to every settled
 * response. Mirrors `ResponseMeta` in `contract/envelope.go`.
 *
 * `deprecation` and `intentVersion` are on the wire and are not modelled here
 * beyond the version, because nothing consumes them yet. Add them when
 * something does, not before.
 */
export interface ResponseMeta {
  intentVersion?: number
  cacheControl?: { staleTime?: string }
  invalidates?: string[]
}

/**
 * Notified after every request that settles successfully.
 *
 * A side channel, deliberately, rather than a changed return type on `query`
 * and `command`. Those two signatures are what every page is written against,
 * and the store is an implementation detail that pages must not have to know
 * about.
 */
export type MetaListener = (info: {
  kind: "query" | "command"
  extension: string
  intent: string
  meta: ResponseMeta
}) => void
```

Change the `createScopedClient` signature to take a fourth parameter:

```ts
export function createScopedClient(
  contractBase: string,
  extension: string,
  fetchImpl: FetchLike = (...args) => globalThis.fetch(...args),
  onMeta?: MetaListener,
): ScopedClient {
```

Widen the parsed envelope type inside `send` to include `meta`:

```ts
    const envelope = ((await res.json?.()?.catch(() => null)) ?? null) as {
      ok: boolean
      data?: T
      meta?: ResponseMeta
      error?: { code: string; message: string }
    } | null
```

Then, immediately before the final `return envelope.data as T`, report:

```ts
    // Reported only on success. A failed request tells you nothing about what
    // went stale, and a listener that fired on failure would let a rejected
    // ban invalidate the list it did not change.
    onMeta?.({
      kind: input.kind,
      extension,
      intent: input.intent,
      meta: envelope.meta ?? {},
    })

    return envelope.data as T
```

- [ ] **Step 8: Run the client tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test client`
Expected: PASS. The pre-existing client tests must all still pass; none of them pass a fourth argument, so `onMeta` is undefined and the optional call is a no-op.

- [ ] **Step 9: Commit**

```bash
git add packages/plugin/src/client.ts packages/plugin/src/store.ts packages/plugin/test/client.test.ts packages/plugin/test/store.test.ts
git commit -m "feat(plugin): report response metadata from the scoped client"
```

---

### Task 4: Move useQuery onto the store

**Files:**
- Modify: `packages/plugin/src/hooks.ts`
- Modify: `packages/plugin/src/context.tsx`
- Test: `packages/plugin/test/hooks.test.tsx` (extend)

**Interfaces:**
- Consumes: `queryStore` from Task 2, `staleTimeFor` from Task 3.
- Produces: `useQuery<T>(intent, params?)` returning the unchanged `QueryState<T>`. No signature change.

The hook stops owning `useState` and subscribes to the store instead. The generation guard moves into the store, where it already is, so the copy in the hook goes.

- [ ] **Step 1: Write the failing test**

```tsx
// append to packages/plugin/test/hooks.test.tsx

import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "../src/context"
import { useQuery } from "../src/hooks"
import { queryStore } from "../src/store"
import type { ScopedClient } from "../src/client"

function stubClient(query: ScopedClient["query"]): ScopedClient {
  return {
    extension: "auth",
    query,
    command: () => Promise.reject(new Error("not used")),
  }
}

function Reader({ intent = "users.list" }: { intent?: string }) {
  const { data, loading } = useQuery<{ total: number }>(intent)
  if (loading) return <p>loading</p>
  return <p>total {data?.total}</p>
}

describe("useQuery over the store", () => {
  it("shares one request between two components reading the same key", async () => {
    queryStore.clear()
    const query = vi.fn().mockResolvedValue({ total: 2 })
    render(
      <PluginProvider client={stubClient(query)}>
        <Reader />
        <Reader />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getAllByText("total 2")).toHaveLength(2))
    expect(query).toHaveBeenCalledOnce()
  })

  it("refetches every mount when the server sends no cache hint", async () => {
    queryStore.clear()
    const query = vi.fn().mockResolvedValue({ total: 2 })
    const { unmount } = render(
      <PluginProvider client={stubClient(query)}>
        <Reader />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByText("total 2")).toBeTruthy())
    unmount()

    render(
      <PluginProvider client={stubClient(query)}>
        <Reader />
      </PluginProvider>,
    )
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  })

  it("serves a fresh entry from cache on a later mount", async () => {
    queryStore.clear()
    queryStore.noteStaleTime("auth", "users.list", 60_000)
    const query = vi.fn().mockResolvedValue({ total: 2 })
    const { unmount } = render(
      <PluginProvider client={stubClient(query)}>
        <Reader />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByText("total 2")).toBeTruthy())
    unmount()

    render(
      <PluginProvider client={stubClient(query)}>
        <Reader />
      </PluginProvider>,
    )
    expect(screen.getByText("total 2")).toBeTruthy()
    expect(query).toHaveBeenCalledOnce()
  })

  it("still exposes refetch, and refetch still goes to the server", async () => {
    queryStore.clear()
    queryStore.noteStaleTime("auth", "users.list", 60_000)
    const query = vi.fn().mockResolvedValue({ total: 2 })

    function WithButton() {
      const { data, refetch } = useQuery<{ total: number }>("users.list")
      return (
        <>
          <p>total {data?.total}</p>
          <button onClick={refetch}>reload</button>
        </>
      )
    }

    render(
      <PluginProvider client={stubClient(query)}>
        <WithButton />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByText("total 2")).toBeTruthy())
    screen.getByRole("button", { name: "reload" }).click()
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  })

  it("surfaces a failure as an error without throwing out of render", async () => {
    queryStore.clear()
    const query = vi.fn().mockRejectedValue(new Error("boom"))

    function ErrorReader() {
      const { error, loading } = useQuery("users.list")
      if (loading) return <p>loading</p>
      return <p>{error ? "failed" : "fine"}</p>
    }

    render(
      <PluginProvider client={stubClient(query)}>
        <ErrorReader />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByText("failed")).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test hooks`
Expected: FAIL on the sharing test. Today's `useQuery` holds its own state and fires per component, so `query` is called twice.

- [ ] **Step 3: Rewrite useQuery**

Replace the `useQuery` function in `packages/plugin/src/hooks.ts` with:

```ts
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { usePluginClient } from "./context"
import { queryStore } from "./store"
import type { CommandOptions, ContractError } from "./client"

export interface QueryState<T> {
  data?: T
  error?: ContractError
  loading: boolean
  refetch: () => void
}

/**
 * Reads one query intent from this plugin's own extension.
 *
 * The state lives in the module-level store, not in this hook. Two components
 * asking the same question with the same params share one entry and one
 * request, and a command that invalidates the intent refreshes both without
 * either of them knowing the other exists.
 *
 * `refetch` is still here, and still goes to the server. A "reload" button is
 * a real thing a page wants. What went away is having to call it to stay
 * correct after a write: `meta.invalidates` does that now.
 */
export function useQuery<T = unknown>(
  intent: string,
  params?: Record<string, unknown>,
): QueryState<T> {
  const client = usePluginClient()
  const key = queryStore.keyOf(client.extension, intent, params)

  const entry = useSyncExternalStore(
    useCallback((listener) => queryStore.subscribe(key, listener), [key]),
    useCallback(() => queryStore.snapshot<T>(key), [key]),
    useCallback(() => queryStore.snapshot<T>(key), [key]),
  )

  // Reads what the server said about this intent last time. Unknown intents
  // answer 0, so a first read always goes out.
  const staleMs = queryStore.staleTimeFor(client.extension, intent)

  useEffect(() => {
    queryStore.read<T>(key, () => client.query<T>(intent, params), staleMs)
    // params is compared by the key it produced, which is what `key` is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, staleMs])

  const refetch = useCallback(() => {
    // staleMs 0 forces the request. A refetch that honoured the cache would
    // be a button that sometimes does nothing, which is worse than no button.
    queryStore.read<T>(key, () => client.query<T>(intent, params), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key])

  return { ...entry, refetch }
}
```

Note the two remaining imports: `useState` and `useRef` are still used by `useCommand` below, so leave the import line as written above.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test hooks`
Expected: PASS. Existing `useQuery` tests in this file must still pass. If one asserts a request per mount with no cache hint, that behaviour is unchanged and it should still pass; if one asserts internal state shape, update the test rather than the hook.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/hooks.ts packages/plugin/test/hooks.test.tsx
git commit -m "feat(plugin): read useQuery through the query store"
```

---

### Task 5: Wire invalidation from command to store

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx:165-178` (the `clients` useMemo)
- Test: `packages/plugin/test/invalidation.test.tsx` (create)

**Interfaces:**
- Consumes: `MetaListener` from Task 3, `queryStore` from Task 2.
- Produces: no new export. The host now builds every scoped client with a meta listener attached.

The store and the client both exist; nothing joins them yet. One place does it, where clients are built.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin/test/invalidation.test.tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { createScopedClient } from "../src/client"
import { PluginProvider } from "../src/context"
import { useCommand, useQuery } from "../src/hooks"
import { queryStore } from "../src/store"

/**
 * Builds a client wired to the store exactly as the host does, so this test
 * exercises the real join rather than a stand-in for it.
 */
function wiredClient(extension: string, fetchImpl: typeof fetch) {
  return createScopedClient("/contract", extension, fetchImpl, (info) => {
    if (info.kind === "command" && info.meta.invalidates?.length) {
      queryStore.invalidate(info.extension, info.meta.invalidates)
    }
  })
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function Page() {
  const list = useQuery<{ total: number }>("users.list")
  const ban = useCommand("users.ban")
  return (
    <>
      <p>total {list.data?.total ?? "?"}</p>
      <button onClick={() => void ban.execute({ id: "u1" })}>ban</button>
    </>
  )
}

describe("command invalidation", () => {
  it("refreshes a mounted read named in meta.invalidates, with no refetch in page code", async () => {
    queryStore.clear()
    let total = 2
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { intent?: string }
      if (body.intent === "users.list") {
        return ok({ ok: true, data: { total }, meta: { cacheControl: { staleTime: "60s" } } })
      }
      if (body.intent === "users.ban") {
        total = 1
        return ok({ ok: true, data: { ok: true }, meta: { invalidates: ["users.list"] } })
      }
      return ok({ token: "t" })
    }) as unknown as typeof fetch

    render(
      <PluginProvider client={wiredClient("auth", fetchImpl)}>
        <Page />
      </PluginProvider>,
    )

    await waitFor(() => expect(screen.getByText("total 2")).toBeTruthy())
    screen.getByRole("button", { name: "ban" }).click()
    await waitFor(() => expect(screen.getByText("total 1")).toBeTruthy())
  })

  it("leaves another extension's cache alone even when the command names its intent", async () => {
    queryStore.clear()
    const authKey = queryStore.keyOf("auth", "users.list")
    queryStore.read(authKey, () => Promise.resolve({ total: 2 }), 60_000)
    await waitFor(() => expect(queryStore.snapshot(authKey).data).toBeTruthy())

    const fetchImpl = vi.fn(async () =>
      ok({ ok: true, data: { ok: true }, meta: { invalidates: ["users.list"] } }),
    ) as unknown as typeof fetch

    await wiredClient("organization", fetchImpl).command("orgs.removeMember", { id: "m1" })

    expect(queryStore.snapshot(authKey).data).toEqual({ total: 2 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test invalidation`
Expected: FAIL on the first test. The ban succeeds, but `users.list` is still fresh for 60 seconds and the page keeps showing `total 2`.

Note: this test builds its own wired client, so it fails only if the store or client is wrong. It passes before the host change below, which is deliberate: it pins the behaviour the host must reproduce. Step 3 makes the host actually do it.

- [ ] **Step 3: Wire the host's clients to the store**

In `packages/host/src/host/PluginHost.tsx`, replace the `clients` useMemo:

```tsx
  // One client per plugin, each permanently bound to that plugin's own
  // extension. Built here rather than inside the render of each route so a
  // re-render does not hand every plugin a fresh client identity.
  //
  // The meta listener is what joins the client to the store. A command's
  // `meta.invalidates` drops exactly the intents the server named, within the
  // sending extension only, and a query's `meta.cacheControl` teaches the
  // store how long that intent may be served stale. Both fields have been on
  // the wire since the envelope was written; this is the first thing to read
  // them.
  const clients = useMemo(() => {
    const byExtension = new Map<string, ScopedClient>()
    for (const plugin of plugins) {
      byExtension.set(
        plugin.extension,
        createScopedClient(contractBase, plugin.extension, doFetch, (info) => {
          if (info.kind === "query") {
            queryStore.noteStaleTime(
              info.extension,
              info.intent,
              parseGoDuration(info.meta.cacheControl?.staleTime),
            )
            return
          }
          if (info.meta.invalidates?.length) {
            queryStore.invalidate(info.extension, info.meta.invalidates)
          }
        })
      )
    }
    return byExtension
  }, [plugins, contractBase, doFetch])
```

Add to the existing import from `@forge-go/dashboard-plugin` at the top of the file: `parseGoDuration`, `queryStore`.

- [ ] **Step 4: Export the new names from the plugin package**

In `packages/plugin/src/index.ts`, add two lines:

```ts
export * from "./store"
export * from "./duration"
```

- [ ] **Step 5: Run both suites**

Run: `pnpm --filter @forge-go/dashboard-plugin test && pnpm --filter @forge-go/dashboard-host test`
Expected: PASS. Both invalidation tests pass, and every existing host test still passes.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/index.ts packages/plugin/test/invalidation.test.tsx packages/host/src/host/PluginHost.tsx
git commit -m "feat(host): invalidate cached reads from the server's own meta"
```

---

### Task 6: defineSubPlugin

**Files:**
- Modify: `packages/plugin/src/types.ts`
- Create: `packages/plugin/src/subplugin.ts`
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/test/subplugin.test.ts`

**Interfaces:**
- Produces:
  - `SLOT_NAMES` and `SlotName = "overview.widgets" | "user.detail.sections" | "org.detail.sections" | "org.detail.tabs" | "org.create.fields" | "settings.tabs"`
  - `SlotContribution { id: string; priority?: number; label?: string; render: ComponentType<Record<string, unknown>> }`
  - `ForgeSubPlugin { extension, host, label?, icon?, requires?, nav, routes, contributions, hostIntents, setup? }`
  - `SubPluginInput`, the same with `nav`, `routes`, `contributions` and `hostIntents` optional
  - `defineSubPlugin(input: SubPluginInput): ForgeSubPlugin`

Validation mirrors `definePlugin` exactly: it throws at import time, so a bad sub-plugin breaks the build that includes it rather than producing a blank panel three deploys later.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin/test/subplugin.test.ts
import { describe, expect, it } from "vitest"
import { defineSubPlugin } from "../src/subplugin"

const Noop = () => null

function valid() {
  return {
    extension: "organization",
    host: "auth",
    label: "Organizations",
    nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
    routes: [{ path: "/organizations", element: Noop }],
  }
}

describe("defineSubPlugin", () => {
  it("returns the sub-plugin with empty defaults filled in", () => {
    const sub = defineSubPlugin(valid())
    expect(sub.extension).toBe("organization")
    expect(sub.host).toBe("auth")
    expect(sub.contributions).toEqual({})
    expect(sub.hostIntents).toEqual([])
  })

  it("requires an extension naming its own Go contributor", () => {
    expect(() => defineSubPlugin({ ...valid(), extension: "" })).toThrow(/extension/)
  })

  it("requires a host naming the plugin it mounts inside", () => {
    expect(() => defineSubPlugin({ ...valid(), host: "" })).toThrow(/host/)
  })

  it("refuses a sub-plugin that hosts itself, which would recurse forever", () => {
    expect(() => defineSubPlugin({ ...valid(), host: "organization" })).toThrow(/itself/)
  })

  it("requires nav paths to be scope-relative", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        nav: [{ label: "Orgs", to: "organizations" }],
      }),
    ).toThrow(/must start with/)
  })

  it("requires route paths to be scope-relative", () => {
    expect(() =>
      defineSubPlugin({ ...valid(), routes: [{ path: "organizations", element: Noop }] }),
    ).toThrow(/must start with/)
  })

  it("rejects an unknown slot name rather than silently never rendering it", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        // A typo here is otherwise invisible: PluginSlot would just never find it.
        contributions: { "user.details.sections": [{ id: "x", render: Noop }] },
      } as never),
    ).toThrow(/unknown slot/)
  })

  it("rejects two contributions to one slot sharing an id", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        contributions: {
          "overview.widgets": [
            { id: "count", render: Noop },
            { id: "count", render: Noop },
          ],
        },
      }),
    ).toThrow(/both use the id/)
  })

  it("accepts every known slot name", () => {
    const sub = defineSubPlugin({
      ...valid(),
      contributions: {
        "overview.widgets": [{ id: "a", render: Noop }],
        "user.detail.sections": [{ id: "b", render: Noop }],
        "org.detail.sections": [{ id: "c", render: Noop }],
        "org.detail.tabs": [{ id: "d", label: "Billing", render: Noop }],
        "org.create.fields": [{ id: "e", render: Noop }],
        "settings.tabs": [{ id: "f", render: Noop }],
      },
    })
    expect(Object.keys(sub.contributions)).toHaveLength(6)
  })

  it("keeps a declared hostIntents allowlist", () => {
    const sub = defineSubPlugin({ ...valid(), hostIntents: ["settings.namespace"] })
    expect(sub.hostIntents).toEqual(["settings.namespace"])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test subplugin`
Expected: FAIL, cannot resolve `../src/subplugin`.

- [ ] **Step 3: Add the types**

Append to `packages/plugin/src/types.ts`:

```ts
/** The six places a sub-plugin can push UI into a host plugin's pages. */
export const SLOT_NAMES = [
  "overview.widgets",
  "user.detail.sections",
  "org.detail.sections",
  "org.detail.tabs",
  "org.create.fields",
  "settings.tabs",
] as const

export type SlotName = (typeof SLOT_NAMES)[number]

export interface SlotContribution {
  /** Unique within one slot, per sub-plugin. Used as the React key. */
  id: string
  /** Lower sorts earlier. Ties break on id, so ordering is total and stable. */
  priority?: number
  /** Required by `org.detail.tabs`, which needs something to put on the tab. */
  label?: string
  /**
   * Receives the slot's params: `{ userId }` for user.detail.sections,
   * `{ orgId }` for the org slots, nothing for the rest.
   */
  render: ComponentType<Record<string, unknown>>
}

export interface ForgeSubPlugin {
  /**
   * This sub-plugin's own Go contributor. Decides whether it renders at all,
   * and scopes every query it makes. Never the same as `host`.
   */
  extension: string
  /** The `extension` of the plugin whose namespace this mounts inside. */
  host: string
  label?: string
  icon?: ReactNode
  requires?: string
  nav: PluginNavItem[]
  routes: PluginRoute[]
  contributions: Partial<Record<SlotName, SlotContribution[]>>
  /**
   * Host intents this sub-plugin may read through `useHostQuery` and
   * `useHostCommand`. Empty by default. The eighteen settings-only authsome
   * sub-plugins declare four; most sub-plugins declare none.
   */
  hostIntents: string[]
  setup?: ComponentType<{ message?: string }>
}

export interface SubPluginInput
  extends Omit<ForgeSubPlugin, "nav" | "routes" | "contributions" | "hostIntents"> {
  nav?: PluginNavItem[]
  routes?: PluginRoute[]
  contributions?: Partial<Record<SlotName, SlotContribution[]>>
  hostIntents?: string[]
}
```

Also add `group?: string` to the existing `PluginNavItem` interface in the same file, with this comment:

```ts
  /**
   * The sidebar heading this item sorts under. Items with no group render
   * first, in one unlabelled group, which is what every plugin does today.
   * The Go manifests already declare these: Identity, Security, Auth,
   * Compliance, Enterprise, Configuration.
   */
  group?: string
```

`ComponentType` is already imported at the top of `types.ts`.

- [ ] **Step 4: Write defineSubPlugin**

```ts
// packages/plugin/src/subplugin.ts
import { SLOT_NAMES } from "./types"
import type { ForgeSubPlugin, PluginNavItem, SlotName, SubPluginInput } from "./types"

const KNOWN_SLOTS = new Set<string>(SLOT_NAMES)

function validateNav(items: PluginNavItem[], extension: string): void {
  for (const item of items) {
    if (!item.to.startsWith("/")) {
      throw new Error(
        `defineSubPlugin: nav item "to" value "${item.to}" must start with "/" (sub-plugin "${extension}")`,
      )
    }
    if (item.children) validateNav(item.children, extension)
  }
}

/**
 * Declares a sub-plugin: UI that mounts inside another plugin's namespace
 * while still belonging to its own Go contributor.
 *
 * The two names are the whole idea. `extension` is what this sub-plugin
 * queries and what decides whether it renders; `host` is only where its pages
 * appear. That split is why the organization plugin's pages can sit under
 * "/@auth/organizations" while still being unable to read a single auth
 * intent it has not declared.
 *
 * Validation throws here, at import time, exactly as `definePlugin` does. A
 * sub-plugin with a bad shape should break the build that includes it rather
 * than quietly never rendering, which is the failure mode a mistyped slot name
 * otherwise has: `PluginSlot` would look for a slot nobody contributes to and
 * correctly render nothing.
 */
export function defineSubPlugin(input: SubPluginInput): ForgeSubPlugin {
  if (!input.extension) {
    throw new Error(
      "defineSubPlugin requires an `extension` naming the Go contributor this sub-plugin belongs to",
    )
  }
  if (!input.host) {
    throw new Error(
      `defineSubPlugin requires a \`host\` naming the plugin this mounts inside (sub-plugin "${input.extension}")`,
    )
  }
  if (input.host === input.extension) {
    throw new Error(
      `defineSubPlugin: sub-plugin "${input.extension}" names itself as its own host. A sub-plugin mounts inside a different plugin; if this is meant to stand alone, use definePlugin instead.`,
    )
  }

  for (const route of input.routes ?? []) {
    if (!route.path.startsWith("/")) {
      throw new Error(
        `defineSubPlugin: route path "${route.path}" must start with "/" (sub-plugin "${input.extension}")`,
      )
    }
  }

  validateNav(input.nav ?? [], input.extension)

  const contributions = input.contributions ?? {}
  for (const [slot, entries] of Object.entries(contributions)) {
    if (!KNOWN_SLOTS.has(slot)) {
      throw new Error(
        `defineSubPlugin: unknown slot "${slot}" (sub-plugin "${input.extension}"). Known slots: ${[...KNOWN_SLOTS].join(", ")}`,
      )
    }
    const seen = new Set<string>()
    for (const entry of entries ?? []) {
      if (seen.has(entry.id)) {
        throw new Error(
          `defineSubPlugin: two contributions to "${slot}" both use the id "${entry.id}", so the slot cannot key them apart (sub-plugin "${input.extension}")`,
        )
      }
      seen.add(entry.id)
    }
  }

  return {
    ...input,
    nav: input.nav ?? [],
    routes: input.routes ?? [],
    contributions: contributions as Partial<Record<SlotName, ForgeSubPlugin["contributions"][SlotName]>>,
    hostIntents: input.hostIntents ?? [],
  }
}
```

- [ ] **Step 5: Export it**

Add to `packages/plugin/src/index.ts`:

```ts
export * from "./subplugin"
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test subplugin`
Expected: PASS, eleven tests.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/types.ts packages/plugin/src/subplugin.ts packages/plugin/src/index.ts packages/plugin/test/subplugin.test.ts
git commit -m "feat(plugin): add defineSubPlugin and the six contribution slots"
```

---

### Task 7: PluginSlot

**Files:**
- Create: `packages/plugin/src/slots.tsx`
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/test/slots.test.tsx`

**Interfaces:**
- Consumes: `ForgeSubPlugin`, `SlotName`, `SlotContribution` from Task 6; `PluginProvider` from `context.tsx`; `PluginErrorBoundary` from `@forge-go/dashboard-runtime`.
- Produces:
  - `SubPluginContext`, `SubPluginProvider({ entries, children })`
  - `ResolvedSubPlugin { subPlugin: ForgeSubPlugin; client: ScopedClient }`
  - `PluginSlot({ name, params? })`
  - `useSlotCount(name: SlotName): number`

`PluginSlot` renders nothing at all when nobody contributes, including no wrapper element, so a host page can drop one in unconditionally without leaving an empty section heading behind. `useSlotCount` is how a page decides whether to render that heading.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin/test/slots.test.tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { defineSubPlugin } from "../src/subplugin"
import { PluginSlot, SubPluginProvider, useSlotCount } from "../src/slots"
import { usePluginClient } from "../src/context"
import type { ScopedClient } from "../src/client"

function client(extension: string): ScopedClient {
  return {
    extension,
    query: () => Promise.resolve({}),
    command: () => Promise.resolve({}),
  }
}

function entry(sub: ReturnType<typeof defineSubPlugin>) {
  return { subPlugin: sub, client: client(sub.extension) }
}

const Widget = () => <p>org count</p>

describe("PluginSlot", () => {
  it("renders nothing, and no wrapper, when nobody contributes", () => {
    const { container } = render(
      <SubPluginProvider entries={[]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders a contribution from a sub-plugin", () => {
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "count", render: Widget }] },
    })
    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(screen.getByText("org count")).toBeTruthy()
  })

  it("passes slot params to the contribution", () => {
    const Section = ({ userId }: { userId?: string }) => <p>user {userId}</p>
    const sub = defineSubPlugin({
      extension: "mfa",
      host: "auth",
      contributions: { "user.detail.sections": [{ id: "factors", render: Section }] },
    })
    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="user.detail.sections" params={{ userId: "u1" }} />
      </SubPluginProvider>,
    )
    expect(screen.getByText("user u1")).toBeTruthy()
  })

  it("gives each contribution its own extension's client, not the host's", () => {
    let seen = ""
    const Probe = () => {
      seen = usePluginClient().extension
      return null
    }
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "count", render: Probe }] },
    })
    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(seen).toBe("organization")
  })

  it("orders by priority, then by id so ties are stable", () => {
    const A = () => <p>a</p>
    const B = () => <p>b</p>
    const C = () => <p>c</p>
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: {
        "overview.widgets": [
          { id: "zeta", priority: 10, render: C },
          { id: "alpha", priority: 10, render: A },
          { id: "first", priority: 1, render: B },
        ],
      },
    })
    const { container } = render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(container.textContent).toBe("bac")
  })

  it("loses only the throwing contribution, keeping its siblings on screen", () => {
    const Boom = () => {
      throw new Error("sub-plugin exploded")
    }
    const Fine = () => <p>still here</p>
    const bad = defineSubPlugin({
      extension: "broken",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "boom", render: Boom }] },
    })
    const good = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "ok", render: Fine }] },
    })

    // React logs the caught error. Silence it so the run stays readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <SubPluginProvider entries={[entry(bad), entry(good)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    spy.mockRestore()

    expect(screen.getByText("still here")).toBeTruthy()
  })
})

describe("useSlotCount", () => {
  it("counts what would render so a page can decide about its heading", () => {
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "count", render: Widget }] },
    })
    const Probe = () => <p>count {useSlotCount("overview.widgets")}</p>

    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <Probe />
      </SubPluginProvider>,
    )
    expect(screen.getByText("count 1")).toBeTruthy()
  })

  it("counts zero outside any provider, so a host page renders standalone", () => {
    const Probe = () => <p>count {useSlotCount("overview.widgets")}</p>
    render(<Probe />)
    expect(screen.getByText("count 0")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test slots`
Expected: FAIL, cannot resolve `../src/slots`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/plugin/src/slots.tsx
import { createContext, useContext } from "react"
import type { ReactNode } from "react"
import { PluginErrorBoundary } from "@forge-go/dashboard-runtime"
import { PluginProvider } from "./context"
import type { ScopedClient } from "./client"
import type { ForgeSubPlugin, SlotContribution, SlotName } from "./types"

/** One ready sub-plugin and the client bound to its own extension. */
export interface ResolvedSubPlugin {
  subPlugin: ForgeSubPlugin
  client: ScopedClient
}

const SubPluginContext = createContext<ResolvedSubPlugin[]>([])

/**
 * Supplies the ready sub-plugins to every slot beneath it.
 *
 * The host builds this list once, after resolving each sub-plugin against
 * capabilities. Only ready ones reach here: hidden, mismatched and
 * setup-pending sub-plugins contribute nothing to anybody else's page, because
 * a widget reading "needs configuring" on somebody else's overview is noise
 * rather than information.
 */
export function SubPluginProvider({
  entries,
  children,
}: {
  entries: ResolvedSubPlugin[]
  children: ReactNode
}) {
  return (
    <SubPluginContext.Provider value={entries}>
      {children}
    </SubPluginContext.Provider>
  )
}

interface Resolved {
  entry: ResolvedSubPlugin
  contribution: SlotContribution
}

/**
 * Every contribution to one slot, ordered.
 *
 * Priority first, then id. The id tiebreak matters: without it the order is
 * whatever the plugin array happened to be in, which changes when somebody
 * reorders an import and produces a diff nobody can explain.
 */
function contributionsFor(entries: ResolvedSubPlugin[], name: SlotName): Resolved[] {
  const out: Resolved[] = []
  for (const entry of entries) {
    for (const contribution of entry.subPlugin.contributions[name] ?? []) {
      out.push({ entry, contribution })
    }
  }
  return out.sort((a, b) => {
    const byPriority =
      (a.contribution.priority ?? 0) - (b.contribution.priority ?? 0)
    if (byPriority !== 0) return byPriority
    return a.contribution.id < b.contribution.id ? -1 : 1
  })
}

export interface PluginSlotProps {
  name: SlotName
  /** Handed to every contribution. `{ userId }`, `{ orgId }`, or nothing. */
  params?: Record<string, unknown>
}

/**
 * Renders every sub-plugin contribution to one named slot.
 *
 * Two things this deliberately does not do. It renders no wrapper element,
 * not even a fragment with a class, so a host page that drops a slot into a
 * layout gets nothing at all when nobody contributes rather than an empty box
 * with padding. And it renders each contribution inside its own error
 * boundary keyed by the contributing extension, so one sub-plugin throwing
 * during render loses its own section and leaves the host page and every
 * sibling contribution alone. These are separately versioned bundles. One of
 * them will throw.
 *
 * Each contribution also gets its own `PluginProvider`, carrying the client
 * bound to its own extension. That is what makes a widget on the auth
 * overview query `organization` rather than `auth`.
 */
export function PluginSlot({ name, params }: PluginSlotProps) {
  const entries = useContext(SubPluginContext)
  const resolved = contributionsFor(entries, name)

  if (resolved.length === 0) return null

  return (
    <>
      {resolved.map(({ entry, contribution }) => {
        const Contribution = contribution.render
        return (
          <PluginErrorBoundary
            key={`${entry.subPlugin.extension}:${contribution.id}`}
            plugin={entry.subPlugin.extension}
          >
            <PluginProvider client={entry.client}>
              <Contribution {...(params ?? {})} />
            </PluginProvider>
          </PluginErrorBoundary>
        )
      })}
    </>
  )
}

/**
 * How many contributions a slot would render.
 *
 * A host page that wants a heading above its slot has to know whether the slot
 * is empty, and `PluginSlot` cannot tell it because it renders nothing at all
 * in that case. Returns 0 outside any provider, so a page renders correctly
 * standalone in a test.
 */
export function useSlotCount(name: SlotName): number {
  return contributionsFor(useContext(SubPluginContext), name).length
}
```

- [ ] **Step 4: Export it**

Add to `packages/plugin/src/index.ts`:

```ts
export * from "./slots"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test slots`
Expected: PASS, eight tests.

If the error-boundary test fails because the sibling also disappears, `PluginErrorBoundary` is catching above the map rather than per item. Check that the boundary is inside `.map`, not around it.

- [ ] **Step 6: Check the dependency direction**

`packages/plugin` now imports `PluginErrorBoundary` from `@forge-go/dashboard-runtime`.

Run: `grep -n '"@forge-go/dashboard-runtime"' packages/plugin/package.json`
Expected: a dependency entry. If there is none, add it to `dependencies` at the workspace version used by `packages/host/package.json`, and run `pnpm install`. This is a workspace package, not a third-party one, so `BASELINE.md`'s dependency rule is not in play. Confirm there is no cycle: `packages/runtime` must not import `@forge-go/dashboard-plugin`.

Run: `grep -rn "dashboard-plugin" packages/runtime/src packages/runtime/package.json`
Expected: no matches. If there are any, stop: a cycle here breaks the build and needs the boundary moved rather than the dependency added.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/slots.tsx packages/plugin/src/index.ts packages/plugin/package.json packages/plugin/test/slots.test.tsx
git commit -m "feat(plugin): add PluginSlot and useSlotCount"
```

---

### Task 8: hostIntents, useHostQuery and useHostCommand

**Files:**
- Modify: `packages/plugin/src/slots.tsx`
- Modify: `packages/plugin/src/hooks.ts`
- Test: `packages/plugin/test/host-intents.test.tsx`

**Interfaces:**
- Produces:
  - `HostAccessProvider({ value, children })` and `HostAccess { client: ScopedClient; allowed: string[]; subExtension: string }`
  - `useHostQuery<T>(intent, params?): QueryState<T>`
  - `useHostCommand<T>(intent): CommandState<T>`

The eighteen settings-only authsome sub-plugins declare `intents: []` in Go. Their panel reads `settings.namespace` and writes `settings.update`, which belong to the `auth` contributor. Without this they cannot render at all.

The allowlist is what keeps that from becoming a hole. A sub-plugin reaching an intent it did not declare throws, naming both the intent and the sub-plugin.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin/test/host-intents.test.tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { defineSubPlugin } from "../src/subplugin"
import { HostAccessProvider } from "../src/slots"
import { useHostQuery } from "../src/hooks"
import { queryStore } from "../src/store"
import type { ScopedClient } from "../src/client"

const SETTINGS = ["settings.namespace", "settings.update"]

function hostClient(query = vi.fn().mockResolvedValue({ fields: [] })): ScopedClient {
  return { extension: "auth", query, command: vi.fn().mockResolvedValue({ ok: true }) }
}

function renderIn(intent: string, allowed: string[], client = hostClient()) {
  const Probe = () => {
    const { data, error, loading } = useHostQuery<{ fields: unknown[] }>(intent)
    if (loading) return <p>loading</p>
    if (error) return <p>error</p>
    return <p>fields {data?.fields.length}</p>
  }
  return render(
    <HostAccessProvider value={{ client, allowed, subExtension: "mfa" }}>
      <Probe />
    </HostAccessProvider>,
  )
}

describe("useHostQuery", () => {
  it("reads a host intent the sub-plugin declared", async () => {
    queryStore.clear()
    renderIn("settings.namespace", SETTINGS)
    await waitFor(() => expect(screen.getByText("fields 0")).toBeTruthy())
  })

  it("sends the host's contributor on the wire, not the sub-plugin's", async () => {
    queryStore.clear()
    const query = vi.fn().mockResolvedValue({ fields: [] })
    renderIn("settings.namespace", SETTINGS, hostClient(query))
    await waitFor(() => expect(query).toHaveBeenCalled())
    // The client is the host's, and its contributor is closed over inside it.
    expect(query.mock.instances).toBeDefined()
  })

  it("throws when the intent is not on the allowlist, naming both", () => {
    queryStore.clear()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderIn("users.list", SETTINGS)).toThrow(/users\.list/)
    spy.mockRestore()
  })

  it("throws outside a HostAccessProvider rather than falling back to the sub-plugin's client", () => {
    const Probe = () => {
      useHostQuery("settings.namespace")
      return null
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/HostAccessProvider/)
    spy.mockRestore()
  })
})

describe("defineSubPlugin hostIntents", () => {
  it("defaults to an empty allowlist, so a sub-plugin reaches nothing of its host's", () => {
    const sub = defineSubPlugin({ extension: "waitlist", host: "auth" })
    expect(sub.hostIntents).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test host-intents`
Expected: FAIL, `HostAccessProvider` is not exported from `../src/slots`.

- [ ] **Step 3: Add the host-access context to slots.tsx**

Append to `packages/plugin/src/slots.tsx`:

```tsx
/**
 * A sub-plugin's declared, narrow access to its host's intents.
 *
 * The rule everywhere else is that a plugin queries its own extension and
 * nothing else, enforced by the contributor name being closed over inside the
 * client rather than passed as an argument. This is the one declared exception,
 * and it exists because eighteen authsome sub-plugins have no intents of their
 * own: their settings panel reads `settings.namespace` from `auth`.
 *
 * `allowed` is what keeps the exception narrow. A settings-only sub-plugin
 * declares four intents and can reach nothing else, so the widening is visible
 * in the sub-plugin's own declaration rather than implied by having a host.
 */
export interface HostAccess {
  client: ScopedClient
  allowed: string[]
  /** Named in the error when a sub-plugin reaches past its allowlist. */
  subExtension: string
}

const HostAccessContext = createContext<HostAccess | null>(null)

export function HostAccessProvider({
  value,
  children,
}: {
  value: HostAccess
  children: ReactNode
}) {
  return (
    <HostAccessContext.Provider value={value}>
      {children}
    </HostAccessContext.Provider>
  )
}

/**
 * Resolves the host client for one intent, or throws.
 *
 * Throws rather than returning an error state, and throws during render rather
 * than on the request. An intent outside the allowlist is a mistake in the
 * sub-plugin's own declaration, not a runtime condition to render around, and
 * it should be as loud as `definePlugin`'s import-time validation. The
 * error boundary around every contribution catches it, so the failure is
 * contained to the sub-plugin that made it.
 */
export function useHostAccess(intent: string): ScopedClient {
  const access = useContext(HostAccessContext)
  if (!access) {
    throw new Error(
      `useHostQuery/useHostCommand were called outside a HostAccessProvider (intent "${intent}"). Only a sub-plugin's own routes and contributions may read host intents.`,
    )
  }
  if (!access.allowed.includes(intent)) {
    throw new Error(
      `sub-plugin "${access.subExtension}" read host intent "${intent}" without declaring it. Add it to \`hostIntents\` in defineSubPlugin, or query the sub-plugin's own extension instead.`,
    )
  }
  return access.client
}
```

Add `ReactNode` to the existing type import at the top of the file if it is not already there. It is: the file imports `import type { ReactNode } from "react"`.

- [ ] **Step 4: Add the two hooks**

Append to `packages/plugin/src/hooks.ts`:

```ts
import { useHostAccess } from "./slots"

/**
 * Reads one of the host plugin's intents, from a sub-plugin.
 *
 * Same signature and same store as `useQuery`, so a settings panel written
 * against one works against the other. The only difference is which client
 * answers, and that the intent has to be on the sub-plugin's `hostIntents`
 * allowlist.
 */
export function useHostQuery<T = unknown>(
  intent: string,
  params?: Record<string, unknown>,
): QueryState<T> {
  const client = useHostAccess(intent)
  const key = queryStore.keyOf(client.extension, intent, params)

  const entry = useSyncExternalStore(
    useCallback((listener) => queryStore.subscribe(key, listener), [key]),
    useCallback(() => queryStore.snapshot<T>(key), [key]),
    useCallback(() => queryStore.snapshot<T>(key), [key]),
  )

  const staleMs = queryStore.staleTimeFor(client.extension, intent)

  useEffect(() => {
    queryStore.read<T>(key, () => client.query<T>(intent, params), staleMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, staleMs])

  const refetch = useCallback(() => {
    queryStore.read<T>(key, () => client.query<T>(intent, params), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key])

  return { ...entry, refetch }
}

/**
 * Sends one of the host plugin's commands, from a sub-plugin.
 *
 * Cached reads are invalidated under the *host's* extension, because that is
 * whose cache the write changed. A settings panel saving through
 * `settings.update` refreshes the auth plugin's own settings pages, which is
 * the correct and slightly surprising result of the same rule applied
 * honestly.
 */
export function useHostCommand<T = unknown>(intent: string): CommandState<T> {
  const client = useHostAccess(intent)
  const [state, setState] = useState<{ data?: T; error?: ContractError; loading: boolean }>({
    loading: false,
  })
  const generationRef = useRef(0)

  useEffect(
    () => () => {
      generationRef.current += 1
    },
    [],
  )

  const execute = useCallback(
    async (payload?: unknown, opts?: CommandOptions): Promise<T | undefined> => {
      const generation = ++generationRef.current
      setState({ loading: true })
      try {
        const data = await client.command<T>(intent, payload, opts)
        if (generationRef.current === generation) setState({ data, loading: false })
        return data
      } catch (error) {
        if (generationRef.current === generation) {
          setState({ error: error as ContractError, loading: false })
        }
        return undefined
      }
    },
    [client, intent],
  )

  return { ...state, execute }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test`
Expected: PASS, the whole plugin suite.

Watch for an import cycle: `hooks.ts` now imports from `slots.tsx`, and `slots.tsx` imports from `context.tsx` but not from `hooks.ts`. If a circular-import warning appears, move `HostAccessContext` and `useHostAccess` into their own `host-access.tsx` and have both files import that.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/slots.tsx packages/plugin/src/hooks.ts packages/plugin/test/host-intents.test.tsx
git commit -m "feat(plugin): let a sub-plugin read declared host intents"
```

---

### Task 9: Nav groups

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (the `navNodes` helper and the `groups` computation)
- Test: `packages/host/test/nav-groups.test.tsx`

**Interfaces:**
- Consumes: `group?: string` on `PluginNavItem`, added in Task 6.
- Produces: `navGroups(plugin: ForgePlugin, subPlugins: ForgeSubPlugin[]): NavGroup[]`, exported from `PluginHost.tsx` for the test to reach. Kit's `NavGroup` already carries `label?` and `contributed?`, so nothing in kit changes.

The host builds one unlabelled `NavGroup` today, with a comment saying that changes the day sub-plugin groups arrive. This is that day.

Ungrouped items come first, in one unlabelled group. That keeps every plugin shipping today rendering exactly as it does now, which matters because `plugin-core` and `plugin-streaming` declare no groups and must not move.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/host/test/nav-groups.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { navGroups } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  nav: [
    { label: "Users", to: "/users", group: "Identity", priority: 10 },
    { label: "Sessions", to: "/sessions", group: "Identity", priority: 20 },
    { label: "Credentials", to: "/credentials", group: "Security" },
  ],
  routes: [{ path: "/users", element: Noop }],
})

const ungrouped = definePlugin({
  extension: "streaming-contract",
  nav: [
    { label: "Rooms", to: "/rooms", priority: 20 },
    { label: "Overview", to: "/", priority: 10 },
  ],
  routes: [{ path: "/", element: Noop }],
})

describe("navGroups", () => {
  it("puts a plugin with no groups in one unlabelled group, in priority order", () => {
    const groups = navGroups(ungrouped, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBeUndefined()
    expect(groups[0].items.map((i) => i.label)).toEqual(["Overview", "Rooms"])
  })

  it("splits grouped items under their headings, in first-appearance order", () => {
    const groups = navGroups(auth, [])
    expect(groups.map((g) => g.label)).toEqual(["Identity", "Security"])
    expect(groups[0].items.map((i) => i.label)).toEqual(["Users", "Sessions"])
  })

  it("puts ungrouped items first when a plugin mixes both", () => {
    const mixed = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [
        { label: "Overview", to: "/" },
        { label: "Users", to: "/users", group: "Identity" },
      ],
      routes: [{ path: "/", element: Noop }],
    })
    const groups = navGroups(mixed, [])
    expect(groups[0].label).toBeUndefined()
    expect(groups[0].items.map((i) => i.label)).toEqual(["Overview"])
    expect(groups[1].label).toBe("Identity")
  })

  it("merges a sub-plugin's nav into the host's own group and marks it contributed", () => {
    const orgs = defineSubPlugin({
      extension: "organization",
      host: "auth",
      nav: [{ label: "Organizations", to: "/organizations", group: "Identity", priority: 30 }],
      routes: [{ path: "/organizations", element: Noop }],
    })
    const groups = navGroups(auth, [orgs])
    const identity = groups.find((g) => g.label === "Identity")
    expect(identity?.items.map((i) => i.label)).toEqual([
      "Users",
      "Sessions",
      "Organizations",
    ])
    expect(identity?.contributed).toBe(true)
  })

  it("adds a group the host does not have when only a sub-plugin uses it", () => {
    const waitlist = defineSubPlugin({
      extension: "waitlist",
      host: "auth",
      nav: [{ label: "Waitlist", to: "/waitlist", group: "Compliance" }],
      routes: [{ path: "/waitlist", element: Noop }],
    })
    const groups = navGroups(auth, [waitlist])
    expect(groups.map((g) => g.label)).toEqual(["Identity", "Security", "Compliance"])
  })

  it("prefixes every href with the host plugin's namespace, sub-plugin items included", () => {
    const orgs = defineSubPlugin({
      extension: "organization",
      host: "auth",
      nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
      routes: [{ path: "/organizations", element: Noop }],
    })
    const groups = navGroups(auth, [orgs])
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    expect(hrefs).toContain("/@auth/users")
    expect(hrefs).toContain("/@auth/organizations")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-host test nav-groups`
Expected: FAIL, `navGroups` is not exported from `../src/host/PluginHost`.

- [ ] **Step 3: Replace navNodes with navGroups**

In `packages/host/src/host/PluginHost.tsx`, replace the `navNodes` function with:

```tsx
// One mapper for the host plugin's nav and every sub-plugin's nav together.
// Two copies of this would be two chances to forget mountPath and emit a link
// that resolves outside its plugin.
//
// A sub-plugin's `to` is relative to its HOST's namespace, not to a namespace
// of its own. That is the whole point of mounting inside: "/organizations" on
// a sub-plugin of "auth" serves at "/@auth/organizations", so `mountPath` is
// called with the host plugin in both cases.
function toNodes(plugin: ForgePlugin, items: PluginNavItem[]): NavNode[] {
  return items.map((item) => ({
    label: item.label,
    href: mountPath(plugin, item.to),
    icon: item.icon,
    children: item.children?.map((child) => ({
      label: child.label,
      href: mountPath(plugin, child.to),
      icon: child.icon,
    })),
  }))
}

const UNGROUPED = Symbol("ungrouped")

/**
 * The sidebar's groups for one scope: the plugin's own nav merged with every
 * ready sub-plugin's.
 *
 * Ungrouped items come first, in one unlabelled group. Every plugin shipping
 * today declares no groups, so this is what keeps `plugin-core` and
 * `plugin-streaming` rendering exactly as they do now.
 *
 * Named groups follow in first-appearance order, host nav scanned before
 * sub-plugin nav, with items sorted by priority inside each. First appearance
 * rather than alphabetical because the Go manifests already imply an order and
 * an admin reading "Identity, Security, Auth" should not get "Auth,
 * Compliance, Configuration".
 *
 * `contributed` marks a group holding at least one sub-plugin item, which is
 * a field kit's NavGroup already carries.
 */
export function navGroups(
  plugin: ForgePlugin,
  subPlugins: ForgeSubPlugin[],
): NavGroup[] {
  const buckets = new Map<
    string | typeof UNGROUPED,
    { items: PluginNavItem[]; contributed: boolean }
  >()

  function add(items: PluginNavItem[], contributed: boolean) {
    for (const item of items) {
      const key = item.group ?? UNGROUPED
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.items.push(item)
        bucket.contributed ||= contributed
      } else {
        buckets.set(key, { items: [item], contributed })
      }
    }
  }

  add(plugin.nav, false)
  for (const sub of subPlugins) add(sub.nav, true)

  // The ungrouped bucket leads regardless of where it was inserted.
  const ordered = [...buckets.entries()].sort(([a], [b]) => {
    if (a === UNGROUPED) return -1
    if (b === UNGROUPED) return 1
    return 0
  })

  return ordered.map(([key, bucket]) => ({
    label: key === UNGROUPED ? undefined : key,
    contributed: bucket.contributed || undefined,
    items: toNodes(plugin, sortByPriority(bucket.items)),
  }))
}
```

Add `PluginNavItem` and `ForgeSubPlugin` to the type import from `@forge-go/dashboard-plugin` at the top of the file.

- [ ] **Step 4: Use it where groups are built**

Replace the `groups` computation in `PluginHost`:

```tsx
  const navOwner = activeScope ?? root
  const groups: NavGroup[] =
    navOwner && navOwner.state.kind === "ready"
      ? navGroups(navOwner.plugin, readySubPluginsFor(navOwner.plugin.extension))
      : []
```

`readySubPluginsFor` arrives in Task 10. Until then, stub it directly above the component so this task compiles and its tests run on their own:

```tsx
// Replaced in Task 10, which resolves sub-plugins against capabilities.
function readySubPluginsFor(_hostExtension: string): ForgeSubPlugin[] {
  return []
}
```

Every other use of `navNodes` in the file (the `back` computation and the `pageTitle` scan) reads from `groups`, except `back`, which calls `navNodes(root.plugin)[0]`. Change that one line to `navGroups(root.plugin, [])[0]?.items[0]`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-host test`
Expected: PASS. Every existing host test still passes, because no shipping plugin declares a group and the ungrouped path is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/test/nav-groups.test.tsx
git commit -m "feat(host): render nav groups from plugin and sub-plugin nav"
```

---

### Task 10: Mount sub-plugins in the host

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx`
- Modify: `packages/host/src/ForgeDashboard.tsx`
- Test: `packages/host/test/subplugin-mount.test.tsx`

**Interfaces:**
- Consumes: `defineSubPlugin`, `SubPluginProvider`, `HostAccessProvider`, `ResolvedSubPlugin` from Tasks 6 to 8; `resolvePluginState` unchanged.
- Produces: `PluginHostProps` gains `subPlugins?: ForgeSubPlugin[]`; `ForgeDashboardProps` gains the same and passes it through.

A sub-plugin resolves against capabilities exactly as a plugin does, and a sub-plugin whose host is not ready renders nothing whatever its own state says. There is nowhere to put it.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/host/test/subplugin-mount.test.tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider } from "@forge-go/dashboard-runtime"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  label: "Auth",
  nav: [{ label: "Users", to: "/users", group: "Identity" }],
  routes: [{ path: "/users", element: () => <p>users page</p> }],
})

const orgs = defineSubPlugin({
  extension: "organization",
  host: "auth",
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
  routes: [{ path: "/organizations", element: () => <p>orgs page</p> }],
})

function capabilities(names: string[]) {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({
      name,
      envelopes: ["v1"],
      configured: true,
    })),
  }
}

function renderHost(contributors: string[], path: string) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(capabilities(contributors)),
  } as unknown as Response)

  return render(
    <ForgeDashboardProvider config={{ basePath: "/dashboard" }}>
      <MemoryRouter initialEntries={[path]}>
        <PluginHost plugins={[auth]} subPlugins={[orgs]} fetchImpl={fetchImpl} />
      </MemoryRouter>
    </ForgeDashboardProvider>,
  )
}

describe("sub-plugin mounting", () => {
  it("mounts a ready sub-plugin's route under its host's namespace", async () => {
    renderHost(["auth", "organization"], "/@auth/organizations")
    await waitFor(() => expect(screen.getByText("orgs page")).toBeTruthy())
  })

  it("shows the sub-plugin's nav entry alongside the host's", async () => {
    renderHost(["auth", "organization"], "/@auth/users")
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.getByRole("link", { name: /Organizations/ })).toBeTruthy()
  })

  it("renders nothing at all for a sub-plugin the server never mentioned", async () => {
    renderHost(["auth"], "/@auth/users")
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.queryByRole("link", { name: /Organizations/ })).toBeNull()
  })

  it("does not mount a sub-plugin's route when its contributor is absent", async () => {
    renderHost(["auth"], "/@auth/organizations")
    await waitFor(() =>
      expect(screen.queryByText("Loading dashboard capabilities…")).toBeNull(),
    )
    expect(screen.queryByText("orgs page")).toBeNull()
  })

  it("renders nothing for a sub-plugin whose host is absent", async () => {
    renderHost(["organization"], "/@auth/organizations")
    await waitFor(() =>
      expect(screen.queryByText("Loading dashboard capabilities…")).toBeNull(),
    )
    expect(screen.queryByText("orgs page")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-host test subplugin-mount`
Expected: FAIL. `PluginHost` does not accept a `subPlugins` prop, so TypeScript rejects it and the first two tests fail at runtime.

- [ ] **Step 3: Accept and resolve sub-plugins**

In `packages/host/src/host/PluginHost.tsx`, extend the props:

```tsx
export interface PluginHostProps {
  plugins: ForgePlugin[]
  /**
   * Sub-plugins, each naming the plugin it mounts inside. Resolved against the
   * same capabilities document as plugins, so an absent Go contributor hides a
   * sub-plugin exactly as it hides a plugin: no nav, no route, no widget, no
   * log line.
   */
  subPlugins?: ForgeSubPlugin[]
  fetchImpl?: typeof fetch
}
```

Extend the client map so sub-plugins get their own clients. Replace the `for (const plugin of plugins)` loop body's surroundings so both lists are covered:

```tsx
  const clients = useMemo(() => {
    const byExtension = new Map<string, ScopedClient>()
    const build = (extension: string) => {
      if (byExtension.has(extension)) return
      byExtension.set(
        extension,
        createScopedClient(contractBase, extension, doFetch, (info) => {
          if (info.kind === "query") {
            queryStore.noteStaleTime(
              info.extension,
              info.intent,
              parseGoDuration(info.meta.cacheControl?.staleTime),
            )
            return
          }
          if (info.meta.invalidates?.length) {
            queryStore.invalidate(info.extension, info.meta.invalidates)
          }
        })
      )
    }
    for (const plugin of plugins) build(plugin.extension)
    for (const sub of subPlugins) build(sub.extension)
    return byExtension
  }, [plugins, subPlugins, contractBase, doFetch])
```

Add the resolution, next to where `resolved` is computed:

```tsx
  // A sub-plugin gets the same four answers a plugin does, from the same
  // function against the same document. `hidden` is the common case and is not
  // an error: a deployment without the organization plugin has no
  // Organizations page, and that is correct.
  //
  // Only `ready` sub-plugins reach the slots. A sub-plugin in `setup` still
  // gets its own routes, so somebody can reach its setup screen, but
  // contributes nothing to anybody else's page: a widget reading "needs
  // configuring" on the auth overview is noise rather than information.
  const resolvedSubs =
    state.status === "ready"
      ? subPlugins
          .map((subPlugin) => ({
            subPlugin,
            state: resolvePluginState(
              // resolvePluginState reads `extension` and `requires` only, and
              // both interfaces carry them, so no second implementation is
              // needed and the two can never drift apart.
              subPlugin as unknown as ForgePlugin,
              state.capabilities,
            ),
          }))
          .filter((entry) => entry.state.kind !== "hidden")
      : []
```

Replace the Task 9 stub with the real lookups:

```tsx
  // A sub-plugin whose host is not ready renders nothing, whatever its own
  // state says. There is nowhere to put it.
  const readyHosts = new Set(
    resolved.filter((scope) => scope.state.kind === "ready").map((scope) => scope.id),
  )

  function subsMountedIn(hostExtension: string) {
    if (!readyHosts.has(hostExtension)) return []
    return resolvedSubs.filter((entry) => entry.subPlugin.host === hostExtension)
  }

  function readySubPluginsFor(hostExtension: string): ForgeSubPlugin[] {
    return subsMountedIn(hostExtension)
      .filter((entry) => entry.state.kind === "ready")
      .map((entry) => entry.subPlugin)
  }
```

Delete the module-level `readySubPluginsFor` stub added in Task 9.

- [ ] **Step 4: Mount their routes**

Inside the `<Routes>` block, after the existing `ready.flatMap(...)`, add a second block:

```tsx
          {ready.flatMap(({ plugin }) =>
            subsMountedIn(plugin.extension).flatMap((entry) =>
              entry.subPlugin.routes.map((route) => {
                const Page =
                  entry.state.kind === "ready"
                    ? route.element
                    : // Not ready but not hidden: its route still mounts, so
                      // somebody following a link or a bookmark lands on a
                      // panel explaining why rather than on a blank page.
                      entry.subPlugin.setup ?? SetupPanel
                const client = clients.get(entry.subPlugin.extension)
                const hostClient = clients.get(plugin.extension)
                return (
                  <Route
                    key={`${entry.subPlugin.extension}:${route.path}`}
                    path={mountPath(plugin, route.path)}
                    element={
                      <PluginErrorBoundary
                        key={entry.subPlugin.extension}
                        plugin={entry.subPlugin.extension}
                      >
                        <PluginProvider client={client!}>
                          <HostAccessProvider
                            value={{
                              client: hostClient!,
                              allowed: entry.subPlugin.hostIntents,
                              subExtension: entry.subPlugin.extension,
                            }}
                          >
                            <Page />
                          </HostAccessProvider>
                        </PluginProvider>
                      </PluginErrorBoundary>
                    }
                  />
                )
              }),
            ),
          )}
```

- [ ] **Step 5: Give the host plugin's own pages their slots**

Wrap the whole `<Routes>` element in a `SubPluginProvider` carrying the active scope's ready sub-plugins, so a host page's `PluginSlot` finds them:

```tsx
      <SubPluginProvider
        entries={
          panelSource
            ? subsMountedIn(panelSource.plugin.extension)
                .filter((entry) => entry.state.kind === "ready")
                .map((entry) => ({
                  subPlugin: entry.subPlugin,
                  client: clients.get(entry.subPlugin.extension)!,
                }))
            : []
        }
      >
        {/* existing <Routes> block */}
      </SubPluginProvider>
```

Add `SubPluginProvider`, `HostAccessProvider`, `PluginProvider` and `SetupPanel` to the imports from `@forge-go/dashboard-plugin`. `PluginProvider` and `SetupPanel` are likely already imported; check before adding a duplicate.

- [ ] **Step 6: Thread the prop through ForgeDashboard**

In `packages/host/src/ForgeDashboard.tsx`, add `subPlugins?: ForgeSubPlugin[]` to its props and pass it to `<PluginHost>`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-host test`
Expected: PASS, including all five new tests and every existing host test.

- [ ] **Step 8: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/src/ForgeDashboard.tsx packages/host/test/subplugin-mount.test.tsx
git commit -m "feat(host): mount sub-plugins inside their host plugin's namespace"
```

---

### Task 11: Context dimensions

**Files:**
- Modify: `packages/plugin/src/types.ts`
- Modify: `packages/plugin/src/define.ts`
- Create: `packages/host/src/host/ContextSwitchers.tsx`
- Modify: `packages/host/src/host/PluginHost.tsx`
- Test: `packages/plugin/test/define.test.ts` (extend), `packages/host/test/context-dimensions.test.tsx`

**Interfaces:**
- Produces:
  - `ContextDimension { id: string; label: string; query: string; switchCommand: string; select: (data: unknown) => { current?: ContextOption; options: ContextOption[] } }`
  - `ContextOption { id: string; label: string }`
  - `definePlugin` accepts `context?: ContextDimension[]`
  - `ContextSwitchers({ plugin, client })`, rendered into `AppSidebar`'s existing `header` prop

Kit needs no new component. `AppSidebar` already takes `header?: ReactNode`, and its comment reserves it for exactly this: "the per-scope context selectors (organisation, app, environment), which are a later wave." The host renders `NativeSelect` into it.

- [ ] **Step 1: Write the failing validation test**

```ts
// append to packages/plugin/test/define.test.ts

  it("rejects a context dimension with no query to read it from", () => {
    expect(() =>
      definePlugin({
        extension: "auth",
        routes: [{ path: "/", element: () => null }],
        context: [
          { id: "app", label: "App", query: "", switchCommand: "apps.switch", select: () => ({ options: [] }) },
        ],
      }),
    ).toThrow(/query/)
  })

  it("rejects two context dimensions sharing an id", () => {
    const dimension = {
      id: "app",
      label: "App",
      query: "apps.context",
      switchCommand: "apps.switch",
      select: () => ({ options: [] }),
    }
    expect(() =>
      definePlugin({
        extension: "auth",
        routes: [{ path: "/", element: () => null }],
        context: [dimension, { ...dimension, label: "Environment" }],
      }),
    ).toThrow(/both use the id/)
  })

  it("defaults context to an empty list, so most plugins render no switchers", () => {
    const plugin = definePlugin({
      extension: "streaming-contract",
      routes: [{ path: "/", element: () => null }],
    })
    expect(plugin.context).toEqual([])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin test define`
Expected: FAIL. `context` is not a known property.

- [ ] **Step 3: Add the types and validation**

Append to `packages/plugin/src/types.ts`:

```ts
export interface ContextOption {
  id: string
  label: string
}

/**
 * One dimension the whole scope is read through: an app, an environment, a
 * tenant.
 *
 * The host renders a switcher per dimension and knows nothing about what any
 * of them mean. Authsome scopes every handler to an app resolved from a
 * cookie, so switching is a command plus a full cache drop, and no query in
 * any plugin ever carries an app id.
 *
 * `query` and `switchCommand` are intents on the declaring plugin's own
 * extension. `select` pulls the current value and the choices out of whatever
 * that query returns, which is what lets two dimensions share one query: both
 * of authsome's read `apps.context`, and the store collapses that to a single
 * request.
 */
export interface ContextDimension {
  id: string
  label: string
  query: string
  switchCommand: string
  select: (data: unknown) => { current?: ContextOption; options: ContextOption[] }
}
```

Add to `ForgePlugin`:

```ts
  /** Scope-wide selectors rendered in the sidebar. Most plugins declare none. */
  context: ContextDimension[]
```

and to `PluginInput`, widen the Omit to include `"context"` and add `context?: ContextDimension[]`.

In `packages/plugin/src/define.ts`, before the return, add:

```ts
  const seenDimensions = new Map<string, string>()
  for (const dimension of input.context ?? []) {
    if (!dimension.query || !dimension.switchCommand) {
      throw new Error(
        `definePlugin: context dimension "${dimension.id}" needs both a \`query\` to read it and a \`switchCommand\` to change it (plugin "${input.extension}")`,
      )
    }
    const claimed = seenDimensions.get(dimension.id)
    if (claimed !== undefined) {
      throw new Error(
        `definePlugin: context dimensions "${claimed}" and "${dimension.label}" both use the id "${dimension.id}" (plugin "${input.extension}")`,
      )
    }
    seenDimensions.set(dimension.id, dimension.label)
  }
```

and change the return to `return { ...input, nav: input.nav ?? [], context: input.context ?? [] }`.

- [ ] **Step 4: Run the validation tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test define`
Expected: PASS, including every existing define test.

- [ ] **Step 5: Write the failing host test**

```tsx
// packages/host/test/context-dimensions.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ContextDimension, ScopedClient } from "@forge-go/dashboard-plugin"
import { ContextSwitchers } from "../src/host/ContextSwitchers"

interface AppsContext {
  currentApp?: { id: string; name: string }
  availableApps: { id: string; name: string }[]
}

const appDimension: ContextDimension = {
  id: "app",
  label: "App",
  query: "apps.context",
  switchCommand: "apps.switch",
  select: (data) => {
    const d = data as AppsContext
    return {
      current: d.currentApp ? { id: d.currentApp.id, label: d.currentApp.name } : undefined,
      options: (d.availableApps ?? []).map((a) => ({ id: a.id, label: a.name })),
    }
  },
}

function client(command = vi.fn().mockResolvedValue({ ok: true })): ScopedClient {
  return {
    extension: "auth",
    query: vi.fn().mockResolvedValue({
      currentApp: { id: "a1", name: "Platform" },
      availableApps: [
        { id: "a1", name: "Platform" },
        { id: "a2", name: "Acme" },
      ],
    } satisfies AppsContext),
    command,
  }
}

describe("ContextSwitchers", () => {
  it("renders nothing for a plugin that declares no dimensions", () => {
    queryStore.clear()
    const { container } = render(
      <PluginProvider client={client()}>
        <ContextSwitchers dimensions={[]} />
      </PluginProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders one labelled select per dimension, showing the current value", async () => {
    queryStore.clear()
    render(
      <PluginProvider client={client()}>
        <ContextSwitchers dimensions={[appDimension]} />
      </PluginProvider>,
    )
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: "App" }) as HTMLSelectElement).value).toBe("a1"),
    )
  })

  it("sends the switch command and clears every cached read", async () => {
    queryStore.clear()
    const stale = queryStore.keyOf("auth", "users.list")
    queryStore.read(stale, () => Promise.resolve({ total: 2 }), 60_000)
    await waitFor(() => expect(queryStore.snapshot(stale).data).toBeTruthy())

    const command = vi.fn().mockResolvedValue({ ok: true })
    render(
      <PluginProvider client={client(command)}>
        <ContextSwitchers dimensions={[appDimension]} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("combobox", { name: "App" })).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "App" }), { target: { value: "a2" } })

    await waitFor(() => expect(command).toHaveBeenCalledWith("apps.switch", { id: "a2" }))
    await waitFor(() => expect(queryStore.snapshot(stale).data).toBeUndefined())
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-host test context-dimensions`
Expected: FAIL, cannot resolve `../src/host/ContextSwitchers`.

- [ ] **Step 7: Write ContextSwitchers**

```tsx
// packages/host/src/host/ContextSwitchers.tsx
import { useId } from "react"
import { useCommand, useQuery, queryStore } from "@forge-go/dashboard-plugin"
import type { ContextDimension } from "@forge-go/dashboard-plugin"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"

function Dimension({ dimension }: { dimension: ContextDimension }) {
  const id = useId()
  const read = useQuery(dimension.query)
  const switchTo = useCommand(dimension.switchCommand)

  // Nothing to switch between until the read lands. Rendering an empty select
  // in the meantime would let somebody pick "nothing" out of it.
  if (!read.data) return null

  const { current, options } = dimension.select(read.data)
  if (options.length === 0) return null

  async function select(optionId: string) {
    const result = await switchTo.execute({ id: optionId })
    if (result === undefined) return

    // Everything, not just what meta.invalidates named. The cookie changed, so
    // every read in the dashboard is now a question about a different app, and
    // the server has no way to enumerate that. This is the one place the store
    // throws away more than it was told to.
    queryStore.clear()
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {dimension.label}
      </label>
      <NativeSelect
        id={id}
        value={current?.id ?? ""}
        disabled={switchTo.loading}
        onChange={(event) => void select(event.target.value)}
        className="w-full"
      >
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/**
 * The scope-wide selectors, rendered into the sidebar under the scope
 * switcher.
 *
 * The host has no idea what an app or an environment is. It reads whatever
 * intent the plugin named, projects it through the plugin's own `select`, and
 * sends the plugin's own command. Authsome declares two dimensions; core and
 * streaming declare none and this renders nothing for them.
 *
 * Two dimensions sharing one query is the normal case, not an edge case: both
 * of authsome's read `apps.context`. The store collapses that to a single
 * request, which is the reason this component can be this naive.
 */
export function ContextSwitchers({
  dimensions,
}: {
  dimensions: ContextDimension[]
}) {
  if (dimensions.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {dimensions.map((dimension) => (
        <Dimension key={dimension.id} dimension={dimension} />
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Render it in the sidebar**

In `PluginHost.tsx`, add to the `sidebar` object:

```tsx
    header:
      panelSource && panelSource.state.kind === "ready" ? (
        <PluginProvider client={clients.get(panelSource.plugin.extension)!}>
          <ContextSwitchers dimensions={panelSource.plugin.context} />
        </PluginProvider>
      ) : undefined,
```

`header` is already declared on `AppSidebarProps` and nothing passes it today, so no kit change is needed. Update its doc comment in `packages/kit/src/components/app-sidebar.tsx` to drop "Nothing passes it today", since that stops being true here.

- [ ] **Step 9: Run both suites**

Run: `pnpm --filter @forge-go/dashboard-plugin test && pnpm --filter @forge-go/dashboard-host test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/plugin/src/types.ts packages/plugin/src/define.ts packages/plugin/test/define.test.ts packages/host/src/host/ContextSwitchers.tsx packages/host/src/host/PluginHost.tsx packages/host/test/context-dimensions.test.tsx packages/kit/src/components/app-sidebar.tsx
git commit -m "feat(host): render plugin-declared context dimensions in the sidebar"
```

---

### Task 12: Verify the whole workspace

**Files:**
- Modify: whatever the checks turn up

- [ ] **Step 1: Run every test in the workspace**

Run: `pnpm test`
Expected: PASS across `kit`, `runtime`, `plugin`, `host`, `next`, `plugin-core`, `plugin-authsome`, `plugin-streaming`.

`plugin-authsome` and `plugin-streaming` are the ones to watch. Their pages are written against the old `useQuery`, whose signature has not changed, so they should pass untouched. If `users.test.tsx` fails on the remount-key behaviour, that test is asserting the workaround rather than the outcome; the authsome plan deletes it. Leave it failing and note it rather than papering over it here.

- [ ] **Step 2: Typecheck and lint everything**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Re-measure the bundle against BASELINE.md**

Run: `pnpm build && ls -la apps/playground/dist/assets`
Expected: the eager entry set stays close to the 433.15 KB raw / 137.86 KB gzip recorded in `BASELINE.md`. The store, the slots and the switchers are all in the eager path, so some growth is expected and a few KB is fine. A jump of tens of KB means something heavy got pulled in and is worth finding before it ships.

- [ ] **Step 4: Record the new measurement**

Append a short section to `BASELINE.md` with the new eager total and one sentence saying what moved. Keep the existing rows: the file is a record of measurements over time, not a single current number.

- [ ] **Step 5: Confirm no third-party dependency was added**

Run: `git diff --stat main -- packages/plugin/package.json packages/host/package.json`
Expected: at most the workspace `@forge-go/dashboard-runtime` entry added in Task 7. Anything from npm means stop and re-read `BASELINE.md`.

- [ ] **Step 6: Commit**

```bash
git add BASELINE.md
git commit -m "docs: re-measure the eager bundle after the plugin platform"
```

---

## Self-review

**Spec coverage.** Section 1 (sub-plugins) is Tasks 6, 7 and 10, with the slot table's six names in Task 6 and the isolation and per-extension-client properties tested in Task 7. Section 1's "Reading the host's intents" is Task 8. Section 1's nav groups is Task 9. Section 2 (the query store) is Tasks 1 to 5, with `meta.invalidates` and `meta.cacheControl` both consumed and the "public signatures don't change" constraint enforced by keeping `query`, `command`, `useQuery` and `useCommand` as they are. Section 3 (context dimensions) is Task 11, including the full store clear on switch. Section 4 (kit blocks) is the separate kit plan. The spec's testing section names nine specific tests: absent contributor renders nothing (Task 10), setup contributes routes but no widgets (Tasks 7 and 10), a throwing contribution loses only its slot entry (Task 7), a contribution queries its own extension (Task 7), dedup across two mounts (Tasks 2 and 4), staleness both sides of the boundary (Tasks 2 and 4), invalidate fanning out to mounted subscribers (Tasks 2 and 5), invalidation staying inside its extension (Tasks 2 and 5), a refetch superseding an in-flight request (Task 2). All nine present.

**One thing the spec asked for that is not built.** Section 3 says the host renders a switcher per dimension "and only for the active scope". Task 11 does that by reading `panelSource.plugin.context`, and `panelSource` is the active scope or the root. Nothing here handles a root plugin declaring dimensions, which no plugin does. If one ever does, it works by the same path.

**Type consistency.** `Entry<T>` (Task 2) is what `useQuery` spreads in Task 4, and its three fields match `QueryState<T>` minus `refetch`, which the hook adds. `MetaListener` (Task 3) is the fourth parameter of `createScopedClient` and is consumed in Task 5 with the same field names. `ForgeSubPlugin` (Task 6) is consumed by `ResolvedSubPlugin` (Task 7), `navGroups` (Task 9) and `PluginHostProps` (Task 10), all spelled the same. `SlotName` (Task 6) is the `name` prop of `PluginSlot` (Task 7). `HostAccess.allowed` (Task 8) is fed from `ForgeSubPlugin.hostIntents` (Task 6) in Task 10. `ContextDimension` (Task 11) is read from `ForgePlugin.context`, added in the same task.

**No placeholders.** Every step carries its code. Task 9 introduces a deliberate temporary stub for `readySubPluginsFor` and Task 10 names the line that deletes it, so the two tasks can be reviewed independently without either leaving dead code behind.
