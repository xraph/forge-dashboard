import { describe, expect, it } from "vitest"

/**
 * CodeMirror is heavy, so the shell's entry chunk must not hold it. The plugin
 * entry reaches the prompt version page and the comparison page only through
 * `lazy()`, each reaches the diff the same way, and only the diff may name
 * `@codemirror`. A static import of any of them, from anywhere the entry can
 * reach, would fold the lot into the entry chunk and nothing else would
 * notice: every page test would still pass.
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
const COMPARE = "../src/pages/compare.tsx"
const OUTPUTS = "../src/components/output-diff.tsx"

describe("CodeMirror loads only with the prompt version and comparison pages", () => {
  it("found the sources", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10)
    expect(modules[DIFF]).toBeDefined()
    expect(modules[PAGE]).toBeDefined()
    expect(modules[COMPARE]).toBeDefined()
    expect(modules[OUTPUTS]).toBeDefined()
  })

  it("is named by no file under src except the diff", () => {
    const offenders = Object.entries(modules)
      .filter(([path]) => path !== DIFF)
      .filter(([, mod]) => sourceOf(mod).includes("@codemirror"))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it("reaches both pages from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/prompt-version"\)\)/)
    expect(entry).not.toMatch(/^import[^\n]*["']\.\/pages\/prompt-version["']/m)
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/compare"\)\)/)
    expect(entry).not.toMatch(/^import[^\n]*["']\.\/pages\/compare["']/m)
  })

  it("reaches the comparison page's diff only through lazy(), from the output diff", () => {
    const outputs = sourceOf(modules[OUTPUTS])
    expect(outputs).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/prompt-diff"\)\)/)
    expect(outputs).not.toMatch(/^import (?!type)[^\n]*prompt-diff"/m)
    // The output diff is imported only by the comparison page, itself lazy.
    const importers = Object.entries(modules)
      .filter(([path]) => path !== OUTPUTS)
      .filter(([, mod]) => sourceOf(mod).includes("output-diff"))
      .map(([path]) => path)
    expect(importers).toEqual([COMPARE])
  })

  it("reaches the diff from the page through lazy(), not a static import", () => {
    const page = sourceOf(modules[PAGE])
    expect(page).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\.\/components\/prompt-diff"\)\)/)
    expect(page).not.toMatch(/^import (?!type)[^\n]*components\/prompt-diff"/m)
  })

  it("is reached from no other file", () => {
    const importers = Object.entries(modules)
      .filter(([path]) => path !== PAGE && path !== DIFF && path !== OUTPUTS)
      .filter(([, mod]) => sourceOf(mod).includes("prompt-diff"))
      .map(([path]) => path)
    expect(importers).toEqual([])
  })
})
