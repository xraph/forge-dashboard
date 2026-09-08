import { describe, expect, it } from "vitest"
import * as host from "../src/index"

describe("package entry", () => {
  it("is importable", () => {
    expect(host).toBeTypeOf("object")
  })
})
