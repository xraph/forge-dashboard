import { describe, expect, it } from "vitest"

/*
 * Rules about the sources themselves. They are read through import.meta.glob,
 * not node:fs: this package's tsconfig has no Node types, so fs passes vitest
 * and fails tsc.
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
const source = (mod: { default: string } | string) =>
  typeof mod === "string" ? mod : mod.default
const files = Object.entries(modules).map(
  ([path, mod]) => [path, source(mod)] as const
)
const naming = (pattern: RegExp) =>
  files
    .filter(([, text]) => pattern.test(text))
    .map(([path]) => path)
    .sort()

describe("plugin-herald sources", () => {
  it("found the sources", () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it("never uses a success colour: a badge's colour is an attention budget", () => {
    expect(
      naming(/\b(text|bg|border|fill|stroke|ring)-(green|emerald|lime|teal)-/)
    ).toEqual([])
  })

  it("never writes the /@herald sigil: links are scope-relative", () => {
    expect(naming(/["'`]\/@herald/)).toEqual([])
  })

  it("never imports another plugin package", () => {
    expect(naming(/from\s+["']@forge-go\/dashboard-plugin-/)).toEqual([])
  })

  it("renders every page header through HeraldHeader, so every page names its app", () => {
    expect(naming(/components\/page-header/)).toEqual([
      "../src/components/herald-header.tsx",
    ])
  })

  it("keeps password inputs in the secret-field helper, uncontrolled", () => {
    expect(naming(/type="password"/)).toEqual([
      "../src/components/secret-fields.tsx",
    ])
  })

  it("reaches the provider forms only through lazy()", () => {
    const entry = source(modules["../src/index.tsx"])
    for (const page of ["provider-create", "provider-edit"]) {
      expect(entry).toMatch(
        new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\("\\./pages/${page}"\\)\\)`)
      )
      expect(naming(new RegExp(`from\\s+["'][./]*pages/${page}["']`))).toEqual(
        []
      )
    }
  })

  it("never says delivered outside the status mapping and the messages note that says it is never recorded", () => {
    expect(naming(/\bdelivered\b/i)).toEqual([
      "../src/badges.tsx",
      "../src/format.ts",
      "../src/pages/messages.tsx",
      "../src/wire.ts",
    ])
  })
})
