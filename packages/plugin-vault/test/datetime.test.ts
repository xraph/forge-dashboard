import { afterEach, describe, expect, it, vi } from "vitest"
import { scheduleTime, toRFC3339, toUTCInput, utcInputToRFC3339 } from "../src/datetime"

// The browser's zone, changed under a running test. No Node types in this
// package, so it goes through vitest's own env stub rather than `process`.
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("datetime helpers", () => {
  it("reads a schedule's fields as UTC whatever zone the browser is in", () => {
    for (const tz of ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
      vi.stubEnv("TZ", tz)
      expect(utcInputToRFC3339("2026-03-01T09:00")).toBe("2026-03-01T09:00:00.000Z")
      expect(utcInputToRFC3339("2026-03-01T09:00:30")).toBe("2026-03-01T09:00:30.000Z")
    }
  })

  it("keeps the secret expiry's reading in the operator's zone", () => {
    vi.stubEnv("TZ", "America/New_York")
    // 09:00 in New York in March (before the change of clocks) is 14:00 UTC.
    expect(toRFC3339("2026-03-01T09:00")).toBe("2026-03-01T14:00:00.000Z")
    expect(toRFC3339("")).toBeUndefined()
    expect(toRFC3339("nonsense")).toBeUndefined()
  })

  it("refuses anything a datetime-local control would not produce", () => {
    expect(utcInputToRFC3339("")).toBeUndefined()
    expect(utcInputToRFC3339("2026-03-01")).toBeUndefined()
    expect(utcInputToRFC3339("2026-03-01T09:00Z")).toBeUndefined()
    expect(utcInputToRFC3339("2026-13-01T09:00")).toBeUndefined()
  })

  it("writes an instant as its UTC fields, with seconds only when they matter", () => {
    vi.stubEnv("TZ", "Asia/Kolkata")
    expect(toUTCInput("2026-03-01T09:00:00Z")).toBe("2026-03-01T09:00")
    expect(toUTCInput("2026-03-01T09:00:30Z")).toBe("2026-03-01T09:00:30")
    expect(toUTCInput("2026-03-01T09:00:00+02:00")).toBe("2026-03-01T07:00")
    expect(toUTCInput("garbage")).toBe("")
  })

  it("sends an untouched time as it was read, and an edited one as UTC", () => {
    expect(scheduleTime("2026-03-01T09:00", "2026-03-01T09:00:00.250Z")).toBe("2026-03-01T09:00:00.250Z")
    expect(scheduleTime("2026-03-01T09:00", "2026-03-01T11:00:00+02:00")).toBe("2026-03-01T11:00:00+02:00")
    expect(scheduleTime("2026-03-02T09:00", "2026-03-01T09:00:00Z")).toBe("2026-03-02T09:00:00.000Z")
    expect(scheduleTime("", "2026-03-01T09:00:00Z")).toBeUndefined()
    expect(scheduleTime("2026-03-02T09:00", undefined)).toBe("2026-03-02T09:00:00.000Z")
  })
})
