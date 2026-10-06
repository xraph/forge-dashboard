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
const WRAPPER = "../src/components/editor/lazy.tsx"

// A module specifier that names either chunk, with or without an extension.
const CHUNK = String.raw`["'][^"']*\/(?:code-editor|field-diff)(?:\.tsx?)?["']`

/**
 * What a file does with the two chunk modules, other than reach them through
 * a type-only import: any `from "<chunk>"` (named, default, namespace, or an
 * export-from, across lines), a bare `import "<chunk>"`, and a dynamic
 * `import("<chunk>")`. Type-only statements are removed first, since they are
 * erased and pull nothing in. The repo writes no semicolons, so a statement
 * ends at its specifier, not at a `;`.
 */
function reachesChunks(text: string): string[] {
  const runtime = text.replace(/\b(?:import|export)\s+type\b[^"']*["'][^"']*["']/g, "")
  const found: string[] = []
  for (const re of [new RegExp(String.raw`\bfrom\s*${CHUNK}`, "g"), new RegExp(String.raw`\bimport\s*${CHUNK}`, "g"), new RegExp(String.raw`\bimport\s*\(\s*${CHUNK}`, "g")]) {
    for (const m of runtime.matchAll(re)) found.push(m[0].replace(/\s+/g, " "))
  }
  return found
}


describe("CodeMirror loads only on demand", () => {
  it("found the sources and both editor files", () => {
    expect(files.length).toBeGreaterThan(30)
    for (const path of EDITORS) expect(modules[path]).toBeDefined()
  })

  it("is named by no file except the editor and the diff", () => {
    expect(files.filter(([, text]) => text.includes("@codemirror")).map(([path]) => path).sort()).toEqual([...EDITORS].sort())
  })

  it("reaches the editor and the diff only through lazy() in components/editor/lazy.tsx", () => {
    const wrapper = source(modules[WRAPPER])
    expect(wrapper).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/code-editor"\)\)/)
    expect(wrapper).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/field-diff"\)\)/)
    const offenders = files.filter(([path]) => path !== WRAPPER).flatMap(([path, text]) => reachesChunks(text).map((hit) => `${path}: ${hit}`))
    expect(offenders).toEqual([])
  })
})

describe("the matcher that guards the boundary", () => {
  const hits = (text: string) => reachesChunks(text).length

  it("catches a multi-line named import", () => {
    expect(hits('import {\n  templateActions,\n  actionCompletions,\n} from "../components/editor/code-editor"\n')).toBe(1)
  })

  it("catches a default import and an import with a .tsx suffix", () => {
    expect(hits('import FieldDiff from "./field-diff"')).toBe(1)
    expect(hits('import CodeEditor from "./editor/code-editor.tsx"')).toBe(1)
  })

  it("catches export-from and export-star", () => {
    expect(hits('export { default } from "./code-editor"')).toBe(1)
    expect(hits('export * from "./field-diff.ts"')).toBe(1)
  })

  it("catches a bare import and a dynamic import", () => {
    expect(hits('import "./code-editor"')).toBe(1)
    expect(hits('const m = await import( "./field-diff" )')).toBe(1)
  })

  it("lets a type-only import through, one line or several", () => {
    expect(hits('import type { A } from "./code-editor"')).toBe(0)
    expect(hits('import type {\n  A,\n  B,\n} from "../editor/field-diff"\nconst x = 1\n')).toBe(0)
    expect(hits('export type { A } from "./code-editor"')).toBe(0)
  })

  it("does not trip on a type-only import hiding a real one after it", () => {
    expect(hits('import type { A } from "./types"\nimport CodeEditor from "./code-editor"\n')).toBe(1)
  })

  it("ignores other modules", () => {
    expect(hits('import { CodeEditor } from "./lazy"\nimport x from "./code-editor-helpers"')).toBe(0)
  })
})
