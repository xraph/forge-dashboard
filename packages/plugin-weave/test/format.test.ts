import { describe, expect, it } from "vitest"
import { ageSeconds, formatAge, formatBytes, formatCount, formatMs, formatScore, isRealTime, plural, utf8Length } from "../src/format"

describe("format", () => {
  it("groups counts and bytes", () => {
    expect(formatCount(4096)).toBe("4,096")
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1048576)).toBe("1,048,576 B")
  })

  it("gives scores three decimals", () => {
    expect(formatScore(0.8312)).toBe("0.831")
    expect(formatScore(1)).toBe("1.000")
  })

  it("rounds milliseconds, with a decimal under ten", () => {
    expect(formatMs(412.4)).toBe("412 ms")
    expect(formatMs(1234.5)).toBe("1,235 ms")
    expect(formatMs(3.25)).toBe("3.3 ms")
  })

  it("pluralises with a grouped count", () => {
    expect(plural(1, "chunk", "chunks")).toBe("1 chunk")
    expect(plural(0, "chunk", "chunks")).toBe("0 chunks")
    expect(plural(1200, "chunk", "chunks")).toBe("1,200 chunks")
  })

  it("states an age in whole minutes, hours or days", () => {
    expect(formatAge(30)).toBe("1 min")
    expect(formatAge(47 * 60)).toBe("47 min")
    expect(formatAge(3 * 3600 + 59)).toBe("3 h")
    expect(formatAge(2 * 86400 + 5)).toBe("2 d")
  })

  it("measures an age against the clock it is given", () => {
    const now = Date.parse("2026-10-07T12:00:00Z")
    expect(ageSeconds("2026-10-07T09:00:00Z", now)).toBe(3 * 3600)
    expect(ageSeconds("2026-10-07T13:00:00Z", now)).toBe(0)
  })

  it("treats Go's zero time and an absent value as no time at all", () => {
    expect(isRealTime("0001-01-01T00:00:00Z")).toBe(false)
    expect(isRealTime("")).toBe(false)
    expect(isRealTime(undefined)).toBe(false)
    expect(isRealTime("2026-10-07T09:00:00Z")).toBe(true)
  })

  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8Length("abc")).toBe(3)
    expect(utf8Length("é")).toBe(2)
    expect(utf8Length("€")).toBe(3)
  })
})
