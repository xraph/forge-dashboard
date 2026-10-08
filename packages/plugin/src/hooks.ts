import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { usePluginClient } from "./context"
import { useHostAccess } from "./slots"
import { queryStore } from "./store"
import type { CommandOptions, ContractError } from "./client"
import type { Entry } from "./store"

export interface QueryState<T> {
  data?: T
  error?: ContractError
  loading: boolean
  refetch: () => void
}

export interface QueryOptions {
  /**
   * `false` makes the query wait: no request, no store entry read, no
   * subscription, so an invalidation issues nothing for it. Turning it `true`
   * issues the read. Defaults to `true`.
   */
  enabled?: boolean
}

// What a disabled query holds. One object, so the snapshot is stable.
const DISABLED: Entry<never> = { loading: false }
const noUnsubscribe = () => {}

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
 *
 * With `{ enabled: false }` it asks nothing and watches nothing until it is
 * turned on, which suits a costly read that should run only when the operator
 * asks.
 */
export function useQuery<T = unknown>(
  intent: string,
  params?: Record<string, unknown>,
  options?: QueryOptions
): QueryState<T> {
  const client = usePluginClient()
  const enabled = options?.enabled ?? true
  const key = queryStore.keyOf(client.extension, intent, params)

  // A disabled query is not a reader. It does not subscribe, because
  // invalidation reissues exactly the keys somebody listens to, and it does
  // not read the entry, because that entry belongs to whoever did ask.
  const entry = useSyncExternalStore(
    useCallback(
      (listener) =>
        enabled ? queryStore.subscribe(key, listener) : noUnsubscribe,
      [key, enabled]
    ),
    useCallback(
      () => (enabled ? queryStore.snapshot<T>(key) : (DISABLED as Entry<T>)),
      [key, enabled]
    ),
    useCallback(
      () => (enabled ? queryStore.snapshot<T>(key) : (DISABLED as Entry<T>)),
      [key, enabled]
    )
  )

  // Reads what the server said about this intent last time. Unknown intents
  // answer 0, so a first read always goes out.
  const staleMs = queryStore.staleTimeFor(client.extension, intent)

  useEffect(() => {
    if (!enabled) return
    queryStore.read<T>(key, () => client.query<T>(intent, params), staleMs)
    // params is compared by the key it produced, which is what `key` is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, staleMs, enabled])

  const refetch = useCallback(() => {
    // A query that was told to wait has not been asked yet, so there is
    // nothing to reload.
    if (!enabled) return
    // staleMs 0 forces the request. A refetch that honoured the cache would
    // be a button that sometimes does nothing, which is worse than no button.
    queryStore.read<T>(key, () => client.query<T>(intent, params), 0, {
      force: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, enabled])

  return { ...entry, refetch }
}

export interface CommandState<T> {
  /** The result of the most recently *issued* command, once it settles. */
  data?: T
  /** The failure of the most recently issued command, if it failed. */
  error?: ContractError
  loading: boolean
  /**
   * Sends the command. Resolves with the result, or with `undefined` when the
   * command failed - it never rejects.
   */
  execute: (payload?: unknown, opts?: CommandOptions) => Promise<T | undefined>
  /**
   * Forgets the last result and the last error.
   *
   * A page usually holds ONE command hook and points it at whichever row the
   * operator is acting on. That is the right shape: a hook per row would mean
   * a hook count that changes with the data. But it means a failure sticks to
   * the hook rather than to the row, so opening a confirmation dialog for a
   * different row shows the previous row's error, attributed to this one. The
   * operator reads "this already failed" about something they have not
   * touched.
   *
   * So call `reset` when the dialog opens, not when it closes: closing is not
   * the only way a dialog goes away, and the state that matters is the state
   * the operator is looking at now.
   *
   * Superseding: a reset raises the generation, so a command still in flight
   * settles into nothing rather than repainting the state that was just
   * cleared.
   */
  reset: () => void
}

/**
 * Sends one command intent to this plugin's own extension.
 *
 * The shape is `useQuery`'s with the trigger inverted. `useQuery` fires on
 * mount because reading is free; a command writes, so firing one because a
 * component rendered would submit a form the user has not filled in yet.
 * Nothing happens until `execute` is called.
 *
 * The split of arguments follows what is known when. The intent is fixed for
 * the life of the component, so it belongs on the hook, exactly as it does on
 * `useQuery`. The payload is only known at the moment the user acts, so it
 * belongs on `execute`, along with the per-call idempotency key.
 *
 * `execute` resolves rather than rejects on failure. The error is already in
 * `error` by then, and a rejected promise that nobody awaited (`onClick={() =>
 * execute(form)}` is the common case) is an unhandled rejection in the console
 * for a failure this hook has already handled. Callers that need the value
 * check the resolved result; callers that need the failure read `error`.
 */
export function useCommand<T = unknown>(intent: string): CommandState<T> {
  const client = usePluginClient()
  const [state, setState] = useState<{
    data?: T
    error?: ContractError
    loading: boolean
  }>({
    loading: false,
  })
  // Same guard as useQuery, for the same reason with a worse failure mode: two
  // overlapping commands (a double-clicked button) must leave the state
  // showing the one issued last, not the one that happened to settle last.
  const generationRef = useRef(0)

  // No dependencies: this runs only on unmount. Any command still in flight
  // then loses its claim on the latest generation, so its settlement becomes a
  // no-op instead of a setState aimed at a fiber that is gone.
  //
  // useQuery's equivalent cleanup has `[run]` deps, and the divergence is
  // deliberate. There, a dependency change reruns the effect, which reissues
  // the request, so the cleanup must supersede the old one. Here nothing
  // reissues on a dependency change - only an event handler starts a command -
  // so unmount is the only moment a supersede is owed.
  useEffect(
    () => () => {
      generationRef.current += 1
    },
    []
  )

  const execute = useCallback(
    async (
      payload?: unknown,
      opts?: CommandOptions
    ): Promise<T | undefined> => {
      const generation = ++generationRef.current
      setState({ loading: true })

      try {
        const data = await client.command<T>(intent, payload, opts)
        if (generationRef.current === generation)
          setState({ data, loading: false })
        return data
      } catch (error) {
        if (generationRef.current === generation) {
          setState({ error: error as ContractError, loading: false })
        }
        // Each caller still learns its own outcome from what it gets back.
        // Only the shared state is generation-guarded.
        return undefined
      }
    },
    [client, intent]
  )

  const reset = useCallback(() => {
    // Raise the generation so an in-flight command cannot repaint what this
    // just cleared.
    generationRef.current += 1
    setState({ loading: false })
  }, [])

  return { ...state, execute, reset }
}

/**
 * Reads one of the host plugin's intents, from a sub-plugin.
 *
 * Same signature and same store as `useQuery`, so a settings panel written
 * against one works against the other. The only difference is which client
 * answers, and that the intent has to be on the sub-plugin's `hostIntents`
 * allowlist. It takes the same `enabled` option, with the same meaning: `false`
 * sends nothing and watches nothing until it is turned on.
 */
export function useHostQuery<T = unknown>(
  intent: string,
  params?: Record<string, unknown>,
  options?: QueryOptions
): QueryState<T> {
  const client = useHostAccess(intent)
  const enabled = options?.enabled ?? true
  const key = queryStore.keyOf(client.extension, intent, params)

  // Disabled means not a reader, for the reasons `useQuery` gives.
  const entry = useSyncExternalStore(
    useCallback(
      (listener) =>
        enabled ? queryStore.subscribe(key, listener) : noUnsubscribe,
      [key, enabled]
    ),
    useCallback(
      () => (enabled ? queryStore.snapshot<T>(key) : (DISABLED as Entry<T>)),
      [key, enabled]
    ),
    useCallback(
      () => (enabled ? queryStore.snapshot<T>(key) : (DISABLED as Entry<T>)),
      [key, enabled]
    )
  )

  const staleMs = queryStore.staleTimeFor(client.extension, intent)

  useEffect(() => {
    if (!enabled) return
    queryStore.read<T>(key, () => client.query<T>(intent, params), staleMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, staleMs, enabled])

  const refetch = useCallback(() => {
    if (!enabled) return
    // Forced for the same reason useQuery's is: staleMs 0 defeats the
    // freshness check, but only `force` skips the "already pending, join it"
    // return. Without it a reload pressed during an in-flight request does
    // nothing at all.
    queryStore.read<T>(key, () => client.query<T>(intent, params), 0, {
      force: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, enabled])

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
  const [state, setState] = useState<{
    data?: T
    error?: ContractError
    loading: boolean
  }>({
    loading: false,
  })
  const generationRef = useRef(0)

  useEffect(
    () => () => {
      generationRef.current += 1
    },
    []
  )

  const execute = useCallback(
    async (
      payload?: unknown,
      opts?: CommandOptions
    ): Promise<T | undefined> => {
      const generation = ++generationRef.current
      setState({ loading: true })
      try {
        const data = await client.command<T>(intent, payload, opts)
        if (generationRef.current === generation)
          setState({ data, loading: false })
        return data
      } catch (error) {
        if (generationRef.current === generation) {
          setState({ error: error as ContractError, loading: false })
        }
        return undefined
      }
    },
    [client, intent]
  )

  const reset = useCallback(() => {
    // Raise the generation so an in-flight command cannot repaint what this
    // just cleared.
    generationRef.current += 1
    setState({ loading: false })
  }, [])

  return { ...state, execute, reset }
}
