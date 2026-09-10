import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { usePoll } from "../src/use-poll"

function Poller({ refetch, interval }: { refetch: () => void; interval?: number }) {
  usePoll(refetch, interval)
  return null
}

/** Drives document.visibilityState, which is a getter and not writable. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  })
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("usePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setHidden(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    setHidden(false)
  })

  it("does not refetch on mount, only on the interval", () => {
    const refetch = vi.fn()
    render(<Poller refetch={refetch} interval={1000} />)
    expect(refetch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3000)
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it("defaults to ten seconds when no interval is given", () => {
    const refetch = vi.fn()
    render(<Poller refetch={refetch} />)
    vi.advanceTimersByTime(9999)
    expect(refetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("stops entirely while the tab is hidden", () => {
    const refetch = vi.fn()
    render(<Poller refetch={refetch} interval={1000} />)

    vi.advanceTimersByTime(2000)
    expect(refetch).toHaveBeenCalledTimes(2)

    setHidden(true)
    vi.advanceTimersByTime(5000)
    // Five intervals passed with nobody looking. None of them should have run.
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it("refetches immediately on becoming visible again, then resumes the interval", () => {
    // The data on screen is exactly as stale as the time the tab was
    // hidden, so the moment it becomes visible again is itself a tick -
    // not a reason to wait out however much of the old interval remains.
    const refetch = vi.fn()
    render(<Poller refetch={refetch} interval={1000} />)

    vi.advanceTimersByTime(2000)
    expect(refetch).toHaveBeenCalledTimes(2)

    setHidden(true)
    vi.advanceTimersByTime(5000)
    expect(refetch).toHaveBeenCalledTimes(2)

    setHidden(false)
    // No timer advance at all here: the refetch on return is immediate.
    expect(refetch).toHaveBeenCalledTimes(3)

    // And the interval resumes cleanly from the moment of return.
    vi.advanceTimersByTime(1000)
    expect(refetch).toHaveBeenCalledTimes(4)
  })

  it("starts nothing when mounted while already hidden, until the tab is shown", () => {
    setHidden(true)
    const refetch = vi.fn()
    render(<Poller refetch={refetch} interval={1000} />)
    vi.advanceTimersByTime(5000)
    expect(refetch).not.toHaveBeenCalled()

    setHidden(false)
    expect(refetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it("stops entirely once unmounted", () => {
    const refetch = vi.fn()
    const { unmount } = render(<Poller refetch={refetch} interval={1000} />)
    vi.advanceTimersByTime(1000)
    expect(refetch).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(5000)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("tears down the old interval and starts a fresh one when intervalMs changes", () => {
    const refetch = vi.fn()
    const { rerender } = render(<Poller refetch={refetch} interval={1000} />)
    vi.advanceTimersByTime(1000)
    expect(refetch).toHaveBeenCalledTimes(1)

    rerender(<Poller refetch={refetch} interval={500} />)
    // If the old 1000ms timer were still alive alongside a new 500ms one,
    // this would fire twice; if the old timer were merely left running
    // uncleared and the new one never started, it would fire zero times.
    vi.advanceTimersByTime(500)
    expect(refetch).toHaveBeenCalledTimes(2)

    // And the leaked old timer, if there were one, would still be due at
    // the 2000ms mark from mount (1000 + 1000). Prove it is gone.
    vi.advanceTimersByTime(500)
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it("uses the latest refetch without restarting the interval", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Poller refetch={first} interval={1000} />)

    vi.advanceTimersByTime(900)
    rerender(<Poller refetch={second} interval={1000} />)
    // The interval must not have been torn down and restarted by the new
    // function identity, or a page whose refetch changes every render never
    // reaches its own interval and never polls at all.
    vi.advanceTimersByTime(100)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })
})
