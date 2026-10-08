import { describe, expect, it } from "vitest"
import { currencyDivisor, formatMinorMoney } from "../../src/sub/money"

describe("billing minor units", () => {
  it("formats zero-decimal and two-decimal currencies", () => {
    expect(currencyDivisor("JPY")).toBe(1)
    expect(currencyDivisor("USD")).toBe(100)
    expect(formatMinorMoney(4900, "USD")).toContain("49.00")
  })
})
