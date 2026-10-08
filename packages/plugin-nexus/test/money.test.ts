import { describe, expect, it } from "vitest"
import {
  compareMoney,
  moneyParts,
  sharePercent,
  validBudget,
} from "../src/money"

describe("exact money", () => {
  it("groups cents and preserves every sub-cent digit", () => {
    expect(moneyParts("1284.370219")).toEqual({
      main: "$1,284.37",
      tail: "0219",
      exact: "$1284.370219",
    })
    expect(moneyParts("0.000000001")).toEqual({
      main: "$0.00",
      tail: "0000001",
      exact: "$0.000000001",
    })
    expect(moneyParts("0")).toEqual({ main: "$0.00", tail: "", exact: "$0" })
    expect(moneyParts("-23.009")).toEqual({
      main: "-$23.00",
      tail: "9",
      exact: "-$23.009",
    })
  })
  it("keeps integers above floating-point precision and long tails", () => {
    expect(moneyParts("900719925474099312345.9876543210123456789")).toEqual({
      main: "$900,719,925,474,099,312,345.98",
      tail: "76543210123456789",
      exact: "$900719925474099312345.9876543210123456789",
    })
    expect(
      compareMoney("9007199254740993.0000000001", "9007199254740993")
    ).toBe(1)
    expect(compareMoney("1.00", "1")).toBe(0)
    expect(compareMoney("-2", "-1.9")).toBe(-1)
  })
  it("computes bounded meter geometry without floating-point money", () => {
    expect(sharePercent("85", "100")).toBe("85")
    expect(sharePercent("0.1", "0.3")).toBe("33.33")
    expect(sharePercent("101", "100")).toBe("100")
    expect(sharePercent("1", "0")).toBe(null)
    expect(sharePercent("-1", "100")).toBe("0")
  })
  it("rejects invalid monetary input", () => {
    for (const value of ["", " 1", "NaN", "1e3", "1,000", ".1", "-2", "1."])
      expect(validBudget(value)).toBe(false)
    for (const value of ["0", "0.0001", "999999999999999999.01"])
      expect(validBudget(value)).toBe(true)
    expect(() => moneyParts("broken")).toThrow()
  })
})
