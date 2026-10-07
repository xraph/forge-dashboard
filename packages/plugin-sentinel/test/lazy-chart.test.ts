import { describe, expect, it } from "vitest"

/**
 * Recharts is large, and the shell's entry chunk must not hold it (BASELINE.md,
 * "Chronicle, and recharts off the entry"). The suite page is eager, so the
 * two line charts are reached only through `lazy()` from the trend section,
 * and only they may import the kit's chart module. A static import from
 * anywhere the entry can reach would fold Recharts into the entry, and every
 * page test would still pass.
 *
 * Sources are read through `import.meta.glob`, as in lazy-diff.test.ts, since
 * this package has no Node types.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", {
  query: "?raw",
  eager: true,
})

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

const CHARTS = ["../src/charts/trend-chart.tsx", "../src/charts/dimension-trends.tsx"]
const TREND = "../src/components/run-trend.tsx"

describe("Recharts loads only with the trend charts", () => {
  it("found the sources", () => {
    for (const path of [...CHARTS, TREND]) expect(modules[path]).toBeDefined()
  })

  it("is named by no file under src except the two line charts", () => {
    const offenders = Object.entries(modules)
      .filter(([path]) => !CHARTS.includes(path))
      .filter(([, mod]) => sourceOf(mod).includes("components/chart\""))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it("reaches each chart from the trend section through lazy(), and from nowhere else", () => {
    const trend = sourceOf(modules[TREND])
    for (const name of ["trend-chart", "dimension-trends"]) {
      expect(trend).toMatch(new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\("\\.\\./charts/${name}"\\)`))
      expect(trend).not.toMatch(new RegExp(`^import (?!type)[^\\n]*charts/${name}"`, "m"))
      const importers = Object.entries(modules)
        .filter(([path]) => path !== TREND && !CHARTS.includes(path))
        .filter(([, mod]) => sourceOf(mod).includes(`charts/${name}`))
        .map(([path]) => path)
      expect(importers).toEqual([])
    }
  })
})
