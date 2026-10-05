import { vi } from "vitest"
import { createElement } from "react"
import { configure } from "@testing-library/react"

// findBy* and waitFor give up after 1s by default. `pnpm test` runs every
// package's suite at once, and under that load a page that renders well
// inside a second alone has taken longer.
configure({ asyncUtilTimeout: 5_000 })

// CodeMirror measures layout jsdom does not have. Pages are tested against
// the text they show, so the lazy editor renders as the same <pre> its
// Suspense fallback does. The editor itself is checked in the browser.
vi.mock("../src/components/json-editor", () => ({
  default: ({ text, label }: { text: string; label: string }) =>
    createElement("pre", { "aria-label": label }, text),
}))
