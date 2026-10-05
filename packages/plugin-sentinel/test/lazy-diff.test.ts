import { describe, expect, it } from "vitest"

/**
 * CodeMirror is heavy, so the shell's entry chunk must not hold it. The plugin
 * entry reaches the prompt version page only through `lazy()`, the page
 * reaches the diff the same way, and only the diff may name `@codemirror`. A
 * static import of either, from anywhere the entry can reach, would fold the
 * lot into the entry chunk and nothing else would notice: every page test
 * would still pass.
 *
 * The sources are read through `import.meta.glob`, not `node:fs`: this
 * package's tsconfig carries no Node types, so `fs` passes vitest and fails
 * `tsc`. `ImportMeta` is widened locally for the same reason.
 */
interface GlobbingImportMeta {
  glob: (
    pattern: string,
    options: { query?: string; eager?: boolean },
  ) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", {
  query: "?raw",
  eager: true,
})

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

const DIFF = "../src/components/prompt-diff.tsx"
const PAGE = "../src/pages/prompt-version.tsx"

describe("CodeMirror loads only with the prompt version page", () => {
  it("found the sources", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10)
    expect(modules[DIFF]).toBeDefined()
    expect(modules[PAGE]).toBeDefined()
  })

  it("is named by no file under src except the diff", () => {
    const offenders = Object.entries(modules)
      .filter(([path]) => path !== DIFF)
      .filter(([, mod]) => sourceOf(mod).includes("@codemirror"))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it("reaches the page from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/prompt-version"\)\)/)
    expect(entry).not.toMatch(/^import[^\n]*["']\.\/pages\/prompt-version["']/m)
  })

  it("reaches the diff from the page through lazy(), not a static import", () => {
    const page = sourceOf(modules[PAGE])
    expect(page).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\.\/components\/prompt-diff"\)\)/)
    expect(page).not.toMatch(/^import (?!type)[^\n]*components\/prompt-diff"/m)
  })

  it("is reached from no other file", () => {
    const importers = Object.entries(modules)
      .filter(([path]) => path !== PAGE && path !== DIFF)
      .filter(([, mod]) => sourceOf(mod).includes("prompt-diff"))
      .map(([path]) => path)
    expect(importers).toEqual([])
  })
})
