import { describe, expect, it } from "vitest"

/**
 * CodeMirror is heavy, so the shell's entry chunk must not hold it. Only two
 * files may name the editor packages, and every other file reaches them
 * through lazy() in components/editor/lazy.tsx. A static import of either from
 * anywhere the entry can reach would fold CodeMirror into the entry chunk and
 * every page test would still pass.
 *
 * Read through import.meta.glob, not node:fs: this package's tsconfig has no
 * Node types, so fs passes vitest and fails tsc.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", eager: true })
const source = (mod: { default: string } | string) => (typeof mod === "string" ? mod : mod.default)
const files = Object.entries(modules).map(([path, mod]) => [path, source(mod)] as const)

const EDITORS = ["../src/components/editor/code-editor.tsx", "../src/components/editor/field-diff.tsx"]

describe("CodeMirror loads only on demand", () => {
  it("found the sources and both editor files", () => {
    expect(files.length).toBeGreaterThan(30)
    for (const path of EDITORS) expect(modules[path]).toBeDefined()
  })

  it("is named by no file except the editor and the diff", () => {
    expect(files.filter(([, text]) => text.includes("@codemirror")).map(([path]) => path).sort()).toEqual([...EDITORS].sort())
  })

  it("reaches the editor and the diff only through lazy() in components/editor/lazy.tsx", () => {
    const wrapper = source(modules["../src/components/editor/lazy.tsx"])
    expect(wrapper).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/code-editor"\)\)/)
    expect(wrapper).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/field-diff"\)\)/)
    const staticImports = files.filter(([, text]) => /^import (?!type)[^\n]*["'][^"']*\/(code-editor|field-diff)["']/m.test(text)).map(([path]) => path)
    expect(staticImports).toEqual([])
  })
})
