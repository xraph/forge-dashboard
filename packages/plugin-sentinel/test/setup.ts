import { vi } from "vitest"
import { createElement } from "react"
import { configure } from "@testing-library/react"

// findBy* and waitFor give up after 1s by default. `pnpm test` runs every
// package's suite at once, and under that load a page that renders well
// inside a second alone has taken longer.
configure({ asyncUtilTimeout: 5_000 })

// jsdom 25 has no PointerEvent, and base-ui's checkbox builds one on click.
// MouseEvent carries every field it reads. This file runs after the shared
// jsdom setup, which this package must not edit.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", {
    value: window.MouseEvent,
    configurable: true,
  })
}

// Page tests check what a page shows around the diff, so the lazy diff
// renders both texts in labelled <pre>s here. test/prompt-diff.test.tsx
// unmocks it and runs the real merge view, which jsdom can mount.
vi.mock("../src/components/prompt-diff", () => ({
  default: ({ was, now, label }: { was: string; now: string; label: string }) =>
    createElement(
      "div",
      { role: "region", "aria-label": label },
      createElement("pre", { "data-testid": "diff-was" }, was),
      createElement("pre", { "data-testid": "diff-now" }, now),
    ),
}))
