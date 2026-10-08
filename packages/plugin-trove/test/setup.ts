import { configure } from "@testing-library/react"

// findBy* and waitFor give up after 1s by default. `pnpm test` runs every
// package's suite at once, and under that load a page that renders well
// inside a second alone has taken longer.
configure({ asyncUtilTimeout: 5_000 })

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
// jsdom 25 has no PointerEvent, and base-ui's checkbox builds one on click.
// MouseEvent carries every field it reads.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", {
    value: window.MouseEvent,
    configurable: true,
  })
}
