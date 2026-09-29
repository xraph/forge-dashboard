import { useCallback, useEffect, useSyncExternalStore } from "react"
import { queryStore, usePluginClient } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import type { FlagEvaluation } from "./flag-types"

/** The pair an operator asked about. Empty ids are already dropped. */
export interface EvaluationRequest {
  tenantId?: string
  userId?: string
  /**
   * Bumped on each press of Evaluate, so pressing it again for the same pair
   * asks the engine again rather than replaying what the store holds.
   */
  run: number
}

export interface EvaluationState {
  data?: FlagEvaluation
  error?: ContractError
  loading: boolean
}

const IDLE_KEY = "vault|flags.evaluate|idle"

/** An id that was not given is absent from the request, not sent empty. */
function paramsFor(flagKey: string, tenantId?: string, userId?: string) {
  return {
    key: flagKey,
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(userId === undefined ? {} : { userId }),
  }
}

/**
 * `flags.evaluate`, asked only once there is a request.
 *
 * `useQuery` fires on mount and a hook cannot be skipped, so a page that
 * wants "only after a button" would have to mount and unmount a child, which
 * takes the button's focus with it. This reads the same store `useQuery` does,
 * under the same key, so an invalidation reissues it and the marks follow the
 * data, without a fetch of its own.
 */
export function useEvaluation(
  flagKey: string,
  request: EvaluationRequest | null,
): EvaluationState | null {
  const client = usePluginClient()
  const tenantId = request?.tenantId
  const userId = request?.userId
  const run = request?.run
  const asked = request !== null

  const key = asked
    ? queryStore.keyOf(client.extension, "flags.evaluate", paramsFor(flagKey, tenantId, userId))
    : IDLE_KEY

  const entry = useSyncExternalStore(
    useCallback((listener) => queryStore.subscribe(key, listener), [key]),
    useCallback(() => queryStore.snapshot<FlagEvaluation>(key), [key]),
    useCallback(() => queryStore.snapshot<FlagEvaluation>(key), [key]),
  )

  useEffect(() => {
    if (!asked) return
    const params = paramsFor(flagKey, tenantId, userId)
    // Forced: each press asks the engine, and a still-fresh entry from the
    // last press must not answer for it.
    queryStore.read<FlagEvaluation>(
      queryStore.keyOf(client.extension, "flags.evaluate", params),
      () => client.query<FlagEvaluation>("flags.evaluate", params),
      0,
      { force: true },
    )
  }, [client, asked, flagKey, tenantId, userId, run])

  return asked ? entry : null
}
