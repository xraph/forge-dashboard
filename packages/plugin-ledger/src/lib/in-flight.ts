import { useCallback, useRef } from "react"

/**
 * Runs a write at most once at a time, from the moment it starts.
 *
 * A disabled submit button reads `command.loading` from the last render, so a
 * second submit in the same tick (a double click, or Enter twice) slips past
 * it and sends the write twice. A ref is set before React re-renders, so it
 * does not. This matters most where the engine has no duplicate rule of its
 * own: a second subscriptions.create for one tenant and plan is a second
 * billed subscription. Resolves undefined when it refused to start.
 */
export function useInFlight(): <T>(run: () => Promise<T>) => Promise<T | undefined> {
  const busy = useRef(false)
  return useCallback(async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined
    busy.current = true
    try {
      return await run()
    } finally {
      busy.current = false
    }
  }, [])
}
