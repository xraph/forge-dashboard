import { describe, expect, it } from "vitest"
import { currencyDigits, formatMinor, formatMoney, parseMajor, toMajorInput } from "../src/lib/money"
import { pageCaption, pageParams, PAGE_SIZE } from "../src/lib/paging"
import { couponPath, invoicePath, planEditPath, planPath, subscriptionPath } from "../src/lib/paths"
import { formatDay, formatPeriod, toLocalInput, toRFC3339 } from "../src/lib/datetime"
import { couponState, describeDiscount } from "../src/lib/coupons"
import { aCoupon, usd } from "./fixtures"

describe("money", () => {
  it("knows how many decimals a currency has", () => {
    expect(currencyDigits("usd")).toBe(2)
    expect(currencyDigits("jpy")).toBe(0)
    expect(currencyDigits("kwd")).toBe(3)
    expect(currencyDigits("not-a-currency")).toBe(2)
  })

  it("formats minor units in the currency's own scale", () => {
    expect(formatMinor(4999, "usd")).toContain("49.99")
    expect(formatMinor(500, "jpy")).toContain("500")
    expect(formatMinor(500, "jpy")).not.toContain("5.00")
    expect(formatMinor(1500, "kwd")).toContain("1.500")
    expect(formatMoney(usd(-1000))).toContain("10.00")
  })

  it("parses a major-unit input into minor units without rounding", () => {
    expect(parseMajor("49.99", "usd")).toBe(4999)
    expect(parseMajor("49.9", "usd")).toBe(4990)
    expect(parseMajor("49", "usd")).toBe(4900)
    expect(parseMajor(" 0.5 ", "usd")).toBe(50)
    expect(parseMajor("500", "jpy")).toBe(500)
    expect(parseMajor("1.5", "kwd")).toBe(1500)
  })

  it("refuses what it cannot represent exactly", () => {
    expect(parseMajor("12.345", "usd")).toBeUndefined()
    expect(parseMajor("5.5", "jpy")).toBeUndefined()
    expect(parseMajor("-1", "usd")).toBeUndefined()
    expect(parseMajor("", "usd")).toBeUndefined()
    expect(parseMajor("1e3", "usd")).toBeUndefined()
    expect(parseMajor("99999999999999999", "usd")).toBeUndefined()
  })

  it("writes minor units back as the text an input shows", () => {
    expect(toMajorInput(4999, "usd")).toBe("49.99")
    expect(toMajorInput(5, "usd")).toBe("0.05")
    expect(toMajorInput(500, "jpy")).toBe("500")
    expect(toMajorInput(1500, "kwd")).toBe("1.500")
  })
})

describe("paging", () => {
  it("turns a one-based page into limit and offset", () => {
    expect(pageParams(1)).toEqual({ limit: PAGE_SIZE, offset: 0 })
    expect(pageParams(3)).toEqual({ limit: 50, offset: 100 })
  })

  it("states an exact count only when everything is on the first page", () => {
    expect(pageCaption({ page: 1, shown: 3, hasMore: false, singular: "plan", plural: "plans" })).toBe("3 plans")
    expect(pageCaption({ page: 1, shown: 1, hasMore: false, singular: "plan", plural: "plans" })).toBe("1 plan")
    expect(pageCaption({ page: 1, shown: 0, hasMore: false, singular: "plan", plural: "plans" })).toBe("0 plans")
  })

  it("states a range, and says when there is more, once paging starts", () => {
    expect(pageCaption({ page: 1, shown: 50, hasMore: true, singular: "plan", plural: "plans" })).toBe("Plans 1–50, more on the next page")
    expect(pageCaption({ page: 2, shown: 7, hasMore: false, singular: "plan", plural: "plans" })).toBe("Plans 51–57")
    expect(pageCaption({ page: 4, shown: 0, hasMore: false, singular: "plan", plural: "plans" })).toBe("No plans on page 4")
  })
})

describe("paths", () => {
  it("encodes every id it puts in a path", () => {
    expect(planPath("plan_1")).toBe("/plans/plan_1")
    expect(planEditPath("plan/1")).toBe("/plans/plan%2F1/edit")
    expect(subscriptionPath("sub_1")).toBe("/subscriptions/sub_1")
    expect(invoicePath("inv 1")).toBe("/invoices/inv%201")
    expect(couponPath("cpn_1")).toBe("/coupons/cpn_1")
  })
})

describe("datetime", () => {
  it("round-trips a datetime-local value through RFC3339", () => {
    const local = "2026-03-01T09:30"
    const rfc = toRFC3339(local)
    expect(rfc).toBe(new Date(local).toISOString())
    expect(toLocalInput(rfc)).toBe(local)
    expect(toRFC3339("")).toBeUndefined()
    expect(toLocalInput(undefined)).toBe("")
    expect(toLocalInput("garbage")).toBe("")
  })

  it("prints a billing day as the UTC date the engine cut it on", () => {
    // The engine cuts periods at UTC instants. Local formatting would print
    // the first as Sep 30 west of UTC and the second as Oct 2 east of it.
    const midnight = formatDay("2026-10-01T00:00:00Z")
    expect(midnight).toMatch(/Oct/)
    expect(midnight).toMatch(/\b1\b/)
    expect(midnight).not.toMatch(/Sep/)
    const lateEvening = formatDay("2026-10-01T23:30:00Z")
    expect(lateEvening).toMatch(/\b1\b/)
    expect(lateEvening).not.toMatch(/\b2\b/)
  })

  it("prints a period as two dates", () => {
    expect(formatPeriod("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).toMatch(/2026.*–.*2026/)
  })
})

describe("coupons", () => {
  const now = Date.parse("2026-09-29T12:00:00Z")

  it("reads a coupon's state from its window and cap", () => {
    expect(couponState(aCoupon(), now)).toBe("active")
    expect(couponState(aCoupon({ valid_from: "2026-10-01T00:00:00Z" }), now)).toBe("scheduled")
    expect(couponState(aCoupon({ valid_until: "2026-09-01T00:00:00Z" }), now)).toBe("expired")
    expect(couponState(aCoupon({ max_redemptions: 5, times_redeemed: 5 }), now)).toBe("exhausted")
    expect(couponState(aCoupon({ max_redemptions: 0, times_redeemed: 500 }), now)).toBe("active")
  })

  it("describes the discount a coupon gives", () => {
    expect(describeDiscount(aCoupon({ type: "percentage", percentage: 20 }))).toBe("20% off")
    expect(describeDiscount(aCoupon({ type: "amount", amount: usd(1000), percentage: undefined }))).toMatch(/10\.00 off$/)
  })
})
