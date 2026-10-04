import { useState } from "react"

/**
 * The last defined value this component has seen. A query whose refetch fails
 * drops its data, and a fact the page already learned (whether there is a
 * rate limiter) should not turn into "not known" because one read failed.
 */
export function useLastKnown<T>(value: T | undefined): T | undefined {
  const [last, setLast] = useState(value)
  if (value !== undefined && value !== last) setLast(value)
  return value ?? last
}
