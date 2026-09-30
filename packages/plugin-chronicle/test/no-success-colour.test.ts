import { describe, expect, it } from "vitest"

/**
 * The sources are read through `import.meta.glob`, not `node:fs`: this
 * package's tsconfig carries no Node types, so `fs` passes vitest and fails
 * `tsc`. `ImportMeta` is widened locally for the same reason.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; import?: string; eager?: boolean }) => Record<string, string>
}

const sources = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
})

describe("colour", () => {
  it("found the sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
  })

  it("uses no success colour anywhere: saturated colour means failure", () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => /\b(?:text|bg|border|fill|stroke|ring)-(?:green|emerald|lime|teal)-/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
