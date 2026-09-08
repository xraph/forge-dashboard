import { describe, expect, it } from "vitest"
import { formatTimestamp } from "../src/lib/format"

describe("formatTimestamp", () => {
  it("prints an en dash for the empty string authsome sends for 'never happened'", () => {
    expect(formatTimestamp("")).toBe("–")
  })

  it("prints an en dash for undefined", () => {
    expect(formatTimestamp(undefined)).toBe("–")
  })

  it("formats a valid RFC 3339 timestamp", () => {
    const out = formatTimestamp("2026-09-08T10:30:00Z")
    expect(out).not.toBe("–")
    expect(out).toContain("2026")
  })

  it("prints an unparseable value exactly as it arrived, never 'Invalid Date'", () => {
    expect(formatTimestamp("not a date")).toBe("not a date")
  })
})
