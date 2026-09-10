import { useEffect, useRef } from "react"

/** Ten seconds. Slow enough to be cheap, fast enough that a count feels live. */
const DEFAULT_INTERVAL_MS = 10_000

/**
 * Calls `refetch` on an interval, and only while somebody is looking.
 *
 * Streaming counts move continuously, so a stale connection count is worse
 * than no connection count. The visibility half matters just as much: a
 * dashboard left open on a second monitor overnight would otherwise issue
 * eight thousand requests nobody reads.
 *
 * Coming back from hidden refetches immediately instead of waiting out the
 * rest of the interval. Whatever is on screen is exactly as stale as the time
 * the tab was hidden, so making the operator wait up to another `intervalMs`
 * after they look again would mean showing them a number that is wrong for
 * longer than it needs to be. Mounting while already visible does not get
 * this same immediate call: `useQuery` already issues its own read on mount,
 * so firing one here too would be a duplicate request on every page load.
 *
 * `refetch` is held in a ref rather than named in the effect's dependencies.
 * `useQuery` returns a new `refetch` identity whenever its inputs change, and
 * an effect that restarted on every new identity would clear the timer before
 * it ever fired, so a page that re-renders faster than its interval would
 * never poll at all. The ref keeps one timer and always calls the latest
 * function.
 */
export function usePoll(refetch: () => void, intervalMs: number = DEFAULT_INTERVAL_MS): void {
  const latest = useRef(refetch)
  latest.current = refetch

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer === undefined) {
        timer = setInterval(() => latest.current(), intervalMs)
      }
    }
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop()
        return
      }
      // The tab just came back. Refetch now rather than waiting out
      // whatever is left of the old interval, then resume ticking from
      // this moment.
      latest.current()
      start()
    }

    // Mounting is not a "became visible" transition, so it gets only the
    // interval, not an extra immediate call. A hidden mount (a background
    // tab restored from a previous session, say) starts nothing until the
    // first real visibilitychange says otherwise.
    if (document.visibilityState !== "hidden") start()

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      stop()
    }
  }, [intervalMs])
}
