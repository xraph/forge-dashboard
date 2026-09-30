import { describe, expect, it } from "vitest"
import { durationLabel, formatSeq, shortHash } from "../src/format"

describe("formatSeq", () => {
  it("groups thousands the way the spec's copy does", () => {
    expect(formatSeq(12431)).toBe("12,431")
    expect(formatSeq(1)).toBe("1")
    expect(formatSeq(0)).toBe("0")
  })
})

describe("shortHash", () => {
  it("keeps the first 12 characters of a long hash", () => {
    expect(shortHash("a1b2c3d4e5f6a7b8c9d0")).toBe("a1b2c3d4e5f6")
  })
  it("leaves a short value alone", () => {
    expect(shortHash("abc")).toBe("abc")
  })
})

describe("durationLabel", () => {
  it("reads whole days", () => expect(durationLabel("720h0m0s")).toBe("30 days"))
  it("reads one day", () => expect(durationLabel("24h0m0s")).toBe("1 day"))
  it("reads hours that are not whole days", () => expect(durationLabel("36h0m0s")).toBe("36 hours"))
  it("reads minutes and seconds as written", () => expect(durationLabel("1m30s")).toBe("1m30s"))
  it("returns an unparseable value unchanged", () => expect(durationLabel("soon")).toBe("soon"))
})
