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
  read<T>(key: string, fetcher: () => Promise<T>, staleMs: number, opts?: { force?: boolean }): Entry<T> {
    const record = this.records.get(key)
    const fresh =
      record !== undefined &&
      record.settledAt > 0 &&
      Date.now() - record.settledAt < staleMs

    // Join or supersede is the caller's intent, never a property of the
    // fetcher. `useQuery` builds its fetcher as an inline arrow inside an
    // effect, so every component instance and every re-render has a different
    // closure identity: comparing them would make two components mounting the
    // same key issue two requests, which is the exact thing this store exists
    // to prevent. A mount joins. Only an explicit refetch forces.
    if (!opts?.force) {
      if (fresh) return this.snapshot<T>(key)
      if (record?.pending) return this.snapshot<T>(key)
    }

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
    // The hints belong to the previous app's contributors. Keeping them would
    // let a stale hint suppress the first read after a switch.
    this.staleTimes.clear()
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
