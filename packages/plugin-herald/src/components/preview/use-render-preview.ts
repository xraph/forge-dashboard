import { useEffect, useRef, useState } from "react"
import { ContractError, usePluginClient } from "@forge-go/dashboard-plugin"
import { useDebounced } from "../../use-debounced"
import type { PreviewResult, TemplatesRenderRequest } from "../../wire"

interface Settled {
  key: string
  result?: PreviewResult
  error?: ContractError
}

/**
 * templates.render, 400ms after the last change to the request.
 *
 * It goes through the client directly rather than useQuery: a query's params
 * are its cache key, and a key holding the whole editor buffer would leave one
 * store entry per settled edit. The last answer stays on screen, marked stale
 * while a newer request is waiting or in flight, so nobody reads a preview of
 * text they have already changed without being told. An answer that arrives
 * after a newer request was sent is dropped.
 */
export function useRenderPreview(request: TemplatesRenderRequest | null, delayMs = 400) {
  const client = usePluginClient()
  const key = request === null ? "" : JSON.stringify(request)
  const settledKey = useDebounced(key, delayMs)
  const [settled, setSettled] = useState<Settled>({ key: "" })
  const latest = useRef("")

  useEffect(() => {
    latest.current = settledKey
    if (settledKey === "") return
    const params = JSON.parse(settledKey) as Record<string, unknown>
    client
      .query<PreviewResult>("templates.render", params)
      .then((result) => {
        if (latest.current === settledKey) setSettled({ key: settledKey, result })
      })
      .catch((err: unknown) => {
        if (latest.current !== settledKey) return
        const error = err instanceof ContractError ? err : new ContractError("TRANSPORT", String(err))
        setSettled((prev) => ({ key: settledKey, result: prev.result, error }))
      })
  }, [client, settledKey])

  return { result: settled.result, error: key === settled.key ? settled.error : undefined, stale: key !== settled.key }
}
