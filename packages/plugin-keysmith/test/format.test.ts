import { describe, expect, it } from "vitest"
import { formatDuration, keyPath, maskedKey } from "../src/format"

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

describe("formatDuration", () => {
  it("uses whole days when the seconds divide into days", () => {
    expect(formatDuration(90 * 86400)).toBe("90 days")
    expect(formatDuration(86400)).toBe("1 day")
  })

  it("uses whole hours when they do not divide into days", () => {
    expect(formatDuration(24 * 3600 + 3600)).toBe("25 hours")
    expect(formatDuration(3600)).toBe("1 hour")
    expect(formatDuration(36 * 3600)).toBe("36 hours")
  })

  it("uses minutes, then seconds", () => {
    expect(formatDuration(90 * 60)).toBe("90 minutes")
    expect(formatDuration(60)).toBe("1 minute")
    expect(formatDuration(90)).toBe("90 seconds")
    expect(formatDuration(1)).toBe("1 second")
  })

  it("says 0 seconds for zero", () => {
    expect(formatDuration(0)).toBe("0 seconds")
  })
})
