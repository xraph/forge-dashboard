import { describe, expect, it } from "vitest"

/**
 * CodeMirror is heavy, so the shell's entry chunk must not hold it. The plugin
 * entry reaches the config page only through `lazy()`, and only two files may
 * name the editor packages. A static import of either, from anywhere the entry
 * can reach, would fold the lot into the entry chunk and nothing else would
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

const modules = (import.meta as unknown as GlobbingImportMeta).glob(
  "../src/**/*.{ts,tsx}",
  { query: "?raw", eager: true },
)

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

const ALLOWED = new Set([
  "../src/components/json-editor.tsx",
  "../src/components/json-diff.tsx",
])

describe("CodeMirror loads only with the config editor route", () => {
  it("found the sources", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10)
    for (const path of ALLOWED) expect(modules[path]).toBeDefined()
  })

  it("is named by no file under src except the editor and the diff", () => {
    const offenders = Object.entries(modules)
      .filter(([path]) => !ALLOWED.has(path))
      .filter(([, mod]) => sourceOf(mod).includes("@codemirror"))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it("reaches the config page from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/config-detail"\)\)/)
    expect(entry).not.toMatch(/^import[^\n]*["']\.\/pages\/config-detail["']/m)
  })

  it("reaches the editor and the diff from the page through lazy(), not a static import", () => {
    const page = sourceOf(modules["../src/pages/config-detail.tsx"])
    for (const name of ["json-editor", "json-diff"]) {
      expect(page).toMatch(new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\("\\.\\./components/${name}"\\)\\)`))
      // A type-only import is erased, so it may stay.
      expect(page).not.toMatch(new RegExp(`^import (?!type)[^\\n]*components/${name}"`, "m"))
    }
  })
})
