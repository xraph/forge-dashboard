import { vi } from "vitest"
import { createElement } from "react"

// jsdom 25 has no PointerEvent, and base-ui's checkbox builds one on click.
// MouseEvent carries every field it reads. This file runs after the shared
// jsdom setup, which this package must not edit.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", {
    value: window.MouseEvent,
    configurable: true,
  })
}

// CodeMirror measures layout jsdom does not have. Pages are tested against
// what they show, so the lazy diff renders both texts in labelled <pre>s.
// The diff itself is checked in the browser.
vi.mock("../src/components/prompt-diff", () => ({
  default: ({ was, now, label }: { was: string; now: string; label: string }) =>
    createElement(
      "div",
      { role: "region", "aria-label": label },
      createElement("pre", { "data-testid": "diff-was" }, was),
      createElement("pre", { "data-testid": "diff-now" }, now),
    ),
}))
