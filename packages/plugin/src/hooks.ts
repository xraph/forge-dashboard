import { useCallback, useEffect, useRef, useState } from "react"
import { usePluginClient } from "./context"
import type { ContractError } from "./client"

export interface QueryState<T> {
  data?: T
  error?: ContractError
  loading: boolean
  refetch: () => void
}

/**
 * Reads one query intent from this plugin's own extension.
 *
 * Deliberately minimal. This is not a cache and does not deduplicate; W3 can
 * put react-query behind the same signature once there is a second consumer to
 * tell us what the caching policy should be.
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
  // warns about. That cost is accepted, not fixed, here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => run(), [run])

  return { ...state, refetch: run }
}
