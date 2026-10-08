import { configure } from "@testing-library/react"

// findBy* and waitFor give up after 1s by default. `pnpm test` runs every
// package's suite at once, and under that load a page that renders well
// inside a second alone has taken longer.
configure({ asyncUtilTimeout: 5_000 })

// jsdom 25 has no PointerEvent, and base-ui's checkbox, radio and switch build
// one on click. MouseEvent carries every field they read. This file runs after
// the shared jsdom setup, which this package must not edit.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", {
    value: window.MouseEvent,
    configurable: true,
  })
}

// jsdom 25 has no layout, so Range has no geometry. CodeMirror measures a
// range when it scrolls a selection into view, which the workspace does when
// a problem is clicked. Empty geometry is what a hidden element reports.
if (
  typeof Range !== "undefined" &&
  typeof Range.prototype.getClientRects !== "function"
) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

// react-resizable-panels and @tanstack/react-virtual both observe element
// sizes. jsdom has no ResizeObserver, so give them one that never fires.
// Layout in jsdom is all zeros anyway; tests that need a size pass one in.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver
}
