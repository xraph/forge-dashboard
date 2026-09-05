import { useCallback, useEffect, useState } from "react"
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

  const run = useCallback(() => {
    let cancelled = false
    setState({ loading: true })

    client
      .query<T>(intent, params)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false })
      })
      .catch((error) => {
        if (!cancelled) setState({ error: error as ContractError, loading: false })
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key])

  // run() calls setState synchronously to kick off the fetch as soon as the
  // intent or params change; the request itself resolves later, out of this
  // effect body, so the rule's cascading-render concern does not apply here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => run(), [run])

  return { ...state, refetch: run }
}
