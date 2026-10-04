import { describe, expect, it } from "vitest"

/**
 * The browser carries a virtualiser and, behind a second boundary, CodeMirror.
 * Neither may reach the shell's entry chunk, and every page test would still
 * pass if one did. So this reads the sources and checks how they import each
 * other. Read through import.meta.glob, not node:fs, because this package's
 * tsconfig has no Node types.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", eager: true })

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

function namingFiles(needle: string): string[] {
  return Object.entries(modules)
    .filter(([, mod]) => sourceOf(mod).includes(needle))
    .map(([path]) => path)
    .sort()
}

describe("the browser's heavy code stays out of the entry", () => {
  it("found the sources", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10)
    expect(modules["../src/pages/browser.tsx"]).toBeDefined()
  })

  it("reaches the browser page from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/browser"\)\)/)
    expect(entry).not.toMatch(/^import (?!type)[^\n]*["']\.\/pages\/browser["']/m)
  })

  it("imports the browser page from nowhere else", () => {
    const importers = Object.entries(modules)
      .filter(([path]) => path !== "../src/index.tsx")
      .filter(([, mod]) => /from\s+["'][./]*pages\/browser["']/.test(sourceOf(mod)))
      .map(([path]) => path)
    expect(importers).toEqual([])
  })

  it("names the virtualiser only in the listing, which only the browser page imports", () => {
    expect(namingFiles("@tanstack/react-virtual")).toEqual(["../src/components/object-listing.tsx"])
    const importers = Object.entries(modules)
      .filter(([, mod]) => /from\s+["'][./]*components\/object-listing["']/.test(sourceOf(mod)))
      .map(([path]) => path)
    expect(importers).toEqual(["../src/pages/browser.tsx"])
  })

  it("names CodeMirror in no file yet", () => {
    expect(namingFiles("@codemirror")).toEqual([])
  })
})
