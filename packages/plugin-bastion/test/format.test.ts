import { describe, expect, it } from "vitest"
import { formatCount, formatMs, formatPercent, formatUptime } from "../src/format"
import { routePath } from "../src/keys"

describe("format", () => {
  it("renders null as null so the page can say not measured", () => {
    expect(formatPercent(null)).toBeNull()
    expect(formatMs(undefined)).toBeNull()
  })
  it("keeps a real zero", () => {
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatMs(0)).toBe("0.0 ms")
  })
  it("switches to seconds at a thousand milliseconds", () => {
    expect(formatMs(212)).toBe("212.0 ms")
    expect(formatMs(1200)).toBe("1.20 s")
  })
  it("groups counts and reads uptime in its two largest units", () => {
    expect(formatCount(1840)).toBe("1,840")
    expect(formatUptime(45)).toBe("45s")
    expect(formatUptime(7500)).toBe("2h 5m")
    expect(formatUptime(273600)).toBe("3d 4h")
  })
  it("encodes a config route id's slash into one path segment", () => {
    expect(routePath("manual-/users")).toBe("/routes/manual-%2Fusers")
  })
})
