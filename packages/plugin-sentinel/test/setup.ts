// jsdom 25 has no PointerEvent, and base-ui's checkbox builds one on click.
// MouseEvent carries every field it reads. This file runs after the shared
// jsdom setup, which this package must not edit.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", {
    value: window.MouseEvent,
    configurable: true,
  })
}
