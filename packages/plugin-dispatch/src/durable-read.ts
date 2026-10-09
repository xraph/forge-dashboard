import { useEffect, useState } from "react"
import { useDispatchQuery } from "./read"

/** Keep shared invalidation, session clearing and stale-result semantics. */
export function useDurableRead<T extends { as_of: string }>(
  intent: string,
  params: Record<string, unknown>
) {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden"
  )
  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState !== "hidden")
    document.addEventListener("visibilitychange", visibility)
    return () => document.removeEventListener("visibilitychange", visibility)
  }, [])
  const query = useDispatchQuery<T>(intent, params, {
    enabled: visible,
    cancelOnUnused: true,
  })
  return {
    ...query,
    data: query.data ? { ...query.data, asOf: query.data.as_of } : undefined,
  }
}
