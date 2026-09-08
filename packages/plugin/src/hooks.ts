import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { usePluginClient } from "./context"
import { useHostAccess } from "./slots"
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
    queryStore.read<T>(key, () => client.query<T>(intent, params), 0, { force: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key])

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
  const [state, setState] = useState<{ data?: T; error?: ContractError; loading: boolean }>({
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
        // Each caller still learns its own outcome from what it gets back.
        // Only the shared state is generation-guarded.
        return undefined
      }
    },
    [client, intent],
  )

  return { ...state, execute }
}

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
