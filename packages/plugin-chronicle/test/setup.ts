import { vi } from "vitest"
import { createElement } from "react"

// CodeMirror measures layout jsdom does not have. Pages are tested against
// the text they show, so the lazy editor renders as the same <pre> its
// Suspense fallback does. The editor itself is checked in the browser.
vi.mock("../src/components/json-editor", () => ({
  default: ({ text, label }: { text: string; label: string }) =>
    createElement("pre", { "aria-label": label }, text),
}))
