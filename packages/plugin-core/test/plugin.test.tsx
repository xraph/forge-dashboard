import { describe, expect, it } from "vitest"
import { corePlugin } from "../src/index"

describe("corePlugin", () => {
  it("keeps the join key the server answers to", () => {
    expect(corePlugin.extension).toBe("core-contract")
  })

  it("claims the dashboard root", () => {
    expect(corePlugin.root).toBe(true)
  })

  it("keeps its switcher label", () => {
    expect(corePlugin.label).toBe("System")
  })
})
