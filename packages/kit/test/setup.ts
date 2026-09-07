/**
 * Shared vitest setup for @forge-go/dashboard-kit.
 *
 * jsdom performs no real layout: every element's `getBoundingClientRect()`
 * returns an all-zero rect, and it does not implement `ResizeObserver` or
 * `IntersectionObserver` at all. Base UI's floating-ui-based positioning
 * (used by DropdownMenu, Select, Popover, ...) computes placement from those
 * APIs, and opening one under jsdom is measured to stall for anywhere from
 * under a second to ~90s wall-clock before it settles (see
 * task-5-report.md for the measurements; this reproduces with a bare
 * DropdownMenu, so it is not specific to any one component).
 *
 * Stubbing a fixed, non-zero rect and no-op observers was an attempt to
 * remove the stall outright, on the theory that positioning was spinning on
 * jsdom's degenerate zero-size layout. Measured effect: it turns the stall
 * from wildly variable (up to ~90s) into a *bounded, repeatable* range
 * (roughly 10-50s across back-to-back runs) rather than eliminating it, so
 * the exact loop is still open — this stub is a genuine improvement, not a
 * confirmed fix. It changes no test's assertions either way.
 */

const stubRect: DOMRect = {
  width: 200,
  height: 40,
  top: 0,
  left: 0,
  right: 200,
  bottom: 40,
  x: 0,
  y: 0,
  toJSON() {
    return this
  },
}

Element.prototype.getBoundingClientRect = () => ({ ...stubRect })

// Cast to `unknown` rather than `implements ResizeObserver`/`IntersectionObserver`:
// these are no-op test doubles, not full implementations, and pinning them to
// the DOM lib's exact shape would break every time TypeScript's lib.dom.d.ts
// adds a member (as it did with `IntersectionObserver.scrollMargin`).
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  class IntersectionObserverStub {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ""
    readonly thresholds: ReadonlyArray<number> = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
}
