import { describe, expect, it } from "vitest"
import { parseGoDuration } from "../src/duration"

describe("parseGoDuration", () => {
  it("reads seconds", () => {
    expect(parseGoDuration("30s")).toBe(30_000)
  })

  it("reads minutes and hours", () => {
    expect(parseGoDuration("1m")).toBe(60_000)
    expect(parseGoDuration("2h")).toBe(7_200_000)
  })

  it("reads milliseconds without reading the 'm' as minutes", () => {
    expect(parseGoDuration("500ms")).toBe(500)
  })

  it("sums compound durations", () => {
    expect(parseGoDuration("1h30m")).toBe(5_400_000)
  })

  it("returns 0 for undefined, so a contributor that sends no hint refetches on every mount", () => {
    expect(parseGoDuration(undefined)).toBe(0)
  })

  it("returns 0 for anything it cannot read rather than throwing inside a read", () => {
    expect(parseGoDuration("soon")).toBe(0)
    expect(parseGoDuration("")).toBe(0)
    expect(parseGoDuration("30")).toBe(0)
  })
})
