import { describe, expect, it } from "vitest"

/** `ImportMeta` is widened locally: this package's tsconfig carries no vite client types. */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; import?: string; eager?: boolean }) => Record<string, string>
}
const index = (import.meta as unknown as GlobbingImportMeta).glob("../src/index.tsx", { query: "?raw", import: "default", eager: true })
const sources = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })

describe("the event detail chunk", () => {
  it("is imported lazily by the plugin", () => {
    const text = Object.values(index)[0]
    expect(text).toMatch(/lazy\(\(\) => import\("\.\/pages\/event-detail"\)\)/)
    expect(text).not.toMatch(/from "\.\/pages\/event-detail"/)
  })
  it("is the only way CodeMirror enters the plugin", () => {
    const eager = Object.entries(sources).filter(
      ([path, text]) => /@codemirror\//.test(text) && !path.endsWith("components/json-editor.tsx"),
    )
    expect(eager.map(([p]) => p)).toEqual([])
  })
})
