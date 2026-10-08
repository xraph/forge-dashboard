// Base UI dispatches pointer clicks; jsdom does not supply PointerEvent.
if (!window.PointerEvent) {
  Object.defineProperty(window, "PointerEvent", {
    value: MouseEvent,
    configurable: true,
  })
}
if (!window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    value: ResizeObserverStub,
    configurable: true,
  })
}
