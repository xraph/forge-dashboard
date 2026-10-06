import { describe, expect, it } from "vitest"
import {
  formatDuration,
  formatRateLimit,
  keyPath,
  maskedKey,
  policyPath,
  rotationMasked,
  splitDuration,
  toSeconds,
} from "../src/format"
import type { RotationItem } from "../src/types"

describe("maskedKey", () => {
  it("shows prefix and environment, then only the hint", () => {
    expect(maskedKey({ prefix: "sk", environment: "live", hint: "a3f8" })).toBe("sk_live_…a3f8")
  })
})

describe("rotationMasked", () => {
  const item: RotationItem = {
    id: "krot_1",
    keyId: "akey_1",
    keyName: "Billing service",
    prefix: "sk",
    environment: "live",
    oldHint: "9c1e",
    newHint: "a3f8",
    reason: "manual",
    graceSeconds: 86400,
    graceEnds: "2026-10-06T00:00:00Z",
    windowOpen: true,
    rotatedAt: "2026-10-05T00:00:00Z",
  }

  it("masks either key the way the key list does", () => {
    expect(rotationMasked(item, "new")).toBe("sk_live_…a3f8")
    expect(rotationMasked(item, "old")).toBe("sk_live_…9c1e")
  })

  it("shows only the hint when the key, and so its prefix, is gone", () => {
    const gone = { ...item, keyName: null, prefix: null, environment: null }
    expect(rotationMasked(gone, "new")).toBe("…a3f8")
    expect(rotationMasked(gone, "old")).toBe("…9c1e")
  })

  it("says there is no hint on a record written before hints existed", () => {
    const hintless = { ...item, oldHint: "", newHint: "" }
    expect(rotationMasked(hintless, "new")).toBe("(no hint)")
    expect(rotationMasked(hintless, "old")).toBe("(no hint)")
    expect(rotationMasked({ ...hintless, prefix: null }, "new")).toBe("(no hint)")
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

describe("policyPath", () => {
  it("encodes the id", () => {
    expect(policyPath("kpol_standard")).toBe("/policies/kpol_standard")
    expect(policyPath("a/b")).toBe("/policies/a%2Fb")
  })
})

describe("splitDuration", () => {
  const ALL = ["seconds", "minutes", "hours", "days"] as const

  it("leaves an unset duration blank, in the last unit offered", () => {
    expect(splitDuration(null, ["hours", "days"])).toEqual({ value: "", unit: "days" })
    expect(splitDuration(null, ["seconds", "minutes", "hours"])).toEqual({
      value: "",
      unit: "hours",
    })
  })

  it("uses the largest unit that divides the seconds exactly", () => {
    expect(splitDuration(90 * 86400, [...ALL])).toEqual({ value: "90", unit: "days" })
    expect(splitDuration(86400, ["hours", "days"])).toEqual({ value: "1", unit: "days" })
    expect(splitDuration(25 * 3600, ["hours", "days"])).toEqual({ value: "25", unit: "hours" })
    expect(splitDuration(60, ["seconds", "minutes", "hours"])).toEqual({
      value: "1",
      unit: "minutes",
    })
  })

  it("keeps 61 seconds in seconds rather than rounding to a minute", () => {
    expect(splitDuration(61, [...ALL])).toEqual({ value: "61", unit: "seconds" })
  })

  it("does not care what order the units are offered in", () => {
    expect(splitDuration(7200, ["days", "hours"])).toEqual({ value: "2", unit: "hours" })
  })

  it("says 0 in the smallest unit offered", () => {
    expect(splitDuration(0, ["hours", "days"])).toEqual({ value: "0", unit: "hours" })
  })

  it("falls back to exact seconds when no offered unit divides evenly", () => {
    // 90 minutes is not a whole number of hours or days. Never round it.
    expect(splitDuration(5400, ["hours", "days"])).toEqual({ value: "5400", unit: "seconds" })
  })
})

describe("toSeconds", () => {
  it("reads blank as unset", () => {
    expect(toSeconds("", "days")).toBeNull()
    expect(toSeconds("   ", "days")).toBeNull()
  })

  it("multiplies a whole number by the unit", () => {
    expect(toSeconds("0", "days")).toBe(0)
    expect(toSeconds("90", "days")).toBe(7776000)
    expect(toSeconds("1", "minutes")).toBe(60)
    expect(toSeconds("61", "seconds")).toBe(61)
    expect(toSeconds("24", "hours")).toBe(86400)
    expect(toSeconds(" 2 ", "hours")).toBe(7200)
  })

  it("answers NaN for anything that is not a whole non-negative number", () => {
    expect(toSeconds("1.5", "days")).toBeNaN()
    expect(toSeconds("-1", "days")).toBeNaN()
    expect(toSeconds("1e3", "seconds")).toBeNaN()
    expect(toSeconds("ten", "seconds")).toBeNaN()
    expect(toSeconds("99999999999999999999", "days")).toBeNaN()
  })
})

describe("formatRateLimit", () => {
  it("reads a limit and its window", () => {
    expect(formatRateLimit({ rateLimit: 100, rateLimitWindowSeconds: 60 })).toBe(
      "100 per 1 minute",
    )
    expect(formatRateLimit({ rateLimit: 5000, rateLimitWindowSeconds: 3600 })).toBe(
      "5000 per 1 hour",
    )
    expect(formatRateLimit({ rateLimit: 1, rateLimitWindowSeconds: 61 })).toBe(
      "1 per 61 seconds",
    )
  })

  it("is null when no rate limit is set", () => {
    expect(formatRateLimit({ rateLimit: null, rateLimitWindowSeconds: null })).toBeNull()
    expect(formatRateLimit({ rateLimit: null, rateLimitWindowSeconds: 60 })).toBeNull()
    // The engine reads 0 as unset.
    expect(formatRateLimit({ rateLimit: 0, rateLimitWindowSeconds: 60 })).toBeNull()
  })

  it("says so when a stored limit has no window", () => {
    // The contract refuses this now, but a row written before it can hold one.
    expect(formatRateLimit({ rateLimit: 100, rateLimitWindowSeconds: null })).toBe(
      "100 with no window",
    )
  })
})
