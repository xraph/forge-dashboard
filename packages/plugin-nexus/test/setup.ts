// Base UI dispatches pointer clicks; jsdom does not supply PointerEvent.
if (!window.PointerEvent) {
  Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true })
}
