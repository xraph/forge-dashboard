import { describe, expect, it } from "vitest"

/**
 * The chunk reader carries a virtualiser. It must not reach the shell's entry
 * chunk, and every page test would still pass if it did. So this reads the
 * sources and checks how they import each other. Read through
 * import.meta.glob, not node:fs, because this package's tsconfig has no Node
 * types.
 */
interface GlobbingImportMeta {
  glob: (
    pattern: string,
    options: { query?: string; eager?: boolean }
  ) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob(
  "../src/**/*.{ts,tsx}",
  { query: "?raw", eager: true }
)

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

function importersOf(pattern: RegExp): string[] {
  return Object.entries(modules)
    .filter(([, mod]) => pattern.test(sourceOf(mod)))
    .map(([path]) => path)
    .sort()
}

describe("the chunk reader stays out of the entry", () => {
  it("found the sources", () => {
    expect(modules["../src/pages/document-detail.tsx"]).toBeDefined()
    expect(modules["../src/components/chunk-reader.tsx"]).toBeDefined()
  })

  it("reaches the document page from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(
      /lazy\(\(\)\s*=>\s*import\("\.\/pages\/document-detail"\)\)/
    )
    expect(entry).not.toMatch(
      /^import (?!type)[^\n]*["']\.\/pages\/document-detail["']/m
    )
  })

  it("imports the document page from nowhere else", () => {
    const others = importersOf(
      /from\s+["'][./]*pages\/document-detail["']/
    ).filter((p) => p !== "../src/index.tsx")
    expect(others).toEqual([])
  })

  it("names the virtualiser only in the chunk reader, which only the document page imports", () => {
    expect(importersOf(/@tanstack\/react-virtual/)).toEqual([
      "../src/components/chunk-reader.tsx",
    ])
    expect(importersOf(/from\s+["'][./]*components\/chunk-reader["']/)).toEqual(
      ["../src/pages/document-detail.tsx"]
    )
  })
})
