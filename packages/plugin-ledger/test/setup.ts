import { configure } from "@testing-library/react"

// findBy* and waitFor give up after 1s by default. `pnpm test` runs every
// package's suite at once, and under that load a page that renders well
// inside a second alone has taken longer.
configure({ asyncUtilTimeout: 5_000 })

// jsdom has no ResizeObserver, and Recharts' ResponsiveContainer measures
// through one. This reports a fixed 640 by 240 box as soon as something is
// observed, so charts lay out and nothing warns about a zero-size container.
class SizedResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    const entry = {
      target,
      contentRect: {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: 640,
        height: 240,
        right: 640,
        bottom: 240,
      },
    }
    this.callback(
      [entry as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  SizedResizeObserver
