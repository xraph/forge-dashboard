// react-resizable-panels and @tanstack/react-virtual both observe element
// sizes. jsdom has no ResizeObserver, so give them one that never fires.
// Layout in jsdom is all zeros anyway; tests that need a size pass one in.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}
