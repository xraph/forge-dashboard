import { describe, expect, it } from "vitest"
import { aroundSeq, defaultWindow, exceedsCap, parseRangeParams, wholeChain } from "../../src/verification/window"

describe("window", () => {
  it("defaults to the most recent 10,000 sequences", () => {
    expect(defaultWindow(61004)).toEqual({ fromSeq: 51005, toSeq: 61004 })
  })
  it("covers a short chain from its start", () => {
    expect(defaultWindow(3000)).toEqual({ fromSeq: 1, toSeq: 3000 })
  })
  it("has no window for an empty chain", () => {
    expect(defaultWindow(0)).toBeNull()
    expect(wholeChain(0)).toBeNull()
  })
  it("knows when a whole-chain check is over the server's cap", () => {
    expect(exceedsCap({ fromSeq: 1, toSeq: 100_000 })).toBe(false)
    expect(exceedsCap({ fromSeq: 1, toSeq: 100_001 })).toBe(true)
  })
  it("builds a window around one event, clamped to the chain", () => {
    expect(aroundSeq(2780, 5000)).toEqual({ fromSeq: 2730, toSeq: 2830 })
    expect(aroundSeq(10, 5000)).toEqual({ fromSeq: 1, toSeq: 60 })
    expect(aroundSeq(4990, 5000)).toEqual({ fromSeq: 4940, toSeq: 5000 })
  })
  it("reads range route params and refuses nonsense", () => {
    expect(parseRangeParams("2730", "2830")).toEqual({ fromSeq: 2730, toSeq: 2830 })
    expect(parseRangeParams(undefined, undefined)).toBeNull()
    expect(parseRangeParams("x", "10")).toBeNull()
    expect(parseRangeParams("0", "10")).toBeNull()
    expect(parseRangeParams("20", "10")).toBeNull()
  })
})
