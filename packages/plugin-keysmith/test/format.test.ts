import { describe, expect, it } from "vitest"
import { keyPath, maskedKey } from "../src/format"

describe("maskedKey", () => {
  it("shows prefix and environment, then only the hint", () => {
    expect(maskedKey({ prefix: "sk", environment: "live", hint: "a3f8" })).toBe("sk_live_…a3f8")
  })
})

describe("keyPath", () => {
  it("encodes the id", () => {
    expect(keyPath("akey_01j8zq3k4m5n6p7q8r9s0t1v2w")).toBe("/keys/akey_01j8zq3k4m5n6p7q8r9s0t1v2w")
    expect(keyPath("a/b")).toBe("/keys/a%2Fb")
  })
})
