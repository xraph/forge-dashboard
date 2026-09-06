import { useCallback, useEffect, useRef, useState } from "react"
import { usePluginClient } from "./context"
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
 * Deliberately minimal. This is not a cache and does not deduplicate. Putting
 * react-query behind the same signature is possible later, and the trigger is
 * a second consumer telling us what the caching policy should be, not a
 * particular wave. (This comment used to say W3. W3 shipped without it.)
 */
export function useQuery<T = unknown>(
  intent: string,
  params?: Record<string, unknown>,
): QueryState<T> {
  const client = usePluginClient()
  const [state, setState] = useState<{ data?: T; error?: ContractError; loading: boolean }>({
    loading: true,
  })
  const key = JSON.stringify(params ?? {})
  // Bumped at the start of every run(), whether that run is the automatic
  // one below or a caller's own refetch(). A settlement only applies its
  // result when it still owns the latest generation, so whichever request
  // was issued last always wins the state, regardless of which one's promise
  // settles last. This is what lets refetch() supersede an in-flight
  // automatic request (and vice versa) instead of racing it.
  const generationRef = useRef(0)

  const run = useCallback(() => {
    const generation = ++generationRef.current
    setState({ loading: true })

    client
      .query<T>(intent, params)
      .then((data) => {
        if (generationRef.current === generation) setState({ data, loading: false })
      })
      .catch((error) => {
        if (generationRef.current === generation) {
          setState({ error: error as ContractError, loading: false })
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key])

  // This hook body is specified verbatim by the plan. run() does call
  // setState synchronously when invoked from this effect (the setState({
  // loading: true }) at the top of run(), not anything in the async
  // .then/.catch below) which is exactly the extra-render-pass cost the rule
  // warns about. That cost is accepted, not fixed, here. The cleanup below
  // bumps the same generation counter run() uses, so on unmount (or before a
  // dependency change reruns this effect) any request still in flight loses
  // its claim on the latest generation and its settlement becomes a no-op,
  // the same way a newer run() or refetch() supersedes it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run()
    return () => {
      generationRef.current += 1
    }
  }, [run])

  return { ...state, refetch: run }
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
