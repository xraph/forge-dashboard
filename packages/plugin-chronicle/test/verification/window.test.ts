import { describe, expect, it } from "vitest"
import {
  aroundSeq,
  clampToHead,
  defaultWindow,
  exceedsCap,
  parseRangeParams,
  verifyInput,
  wholeChain,
} from "../../src/verification/window"

describe("window", () => {
  it("defaults to the most recent 10,000 sequences", () => {
    expect(defaultWindow(61004)).toEqual({ fromSeq: 51005, toSeq: 61004 })
  })
  it("covers a short chain from its start", () => {
    expect(defaultWindow(3000)).toEqual({ fromSeq: 1, toSeq: 3000 })
  })
  it("has no window for an empty chain", () => {
    expect(defaultWindow(0)).toBeNull()
  })
  it("still checks a chain at head zero, from genesis to head with no range named", () => {
    expect(wholeChain(0)).toEqual({ fromSeq: 0, toSeq: 0 })
    expect(verifyInput("stream_acme", wholeChain(0))).toEqual({
      streamId: "stream_acme",
    })
    expect(verifyInput("stream_acme", wholeChain(3000))).toEqual({
      streamId: "stream_acme",
      fromSeq: 1,
      toSeq: 3000,
    })
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
    expect(parseRangeParams("2730", "2830")).toEqual({
      fromSeq: 2730,
      toSeq: 2830,
    })
    expect(parseRangeParams(undefined, undefined)).toBeNull()
    expect(parseRangeParams("x", "10")).toBeNull()
    expect(parseRangeParams("0", "10")).toBeNull()
    expect(parseRangeParams("20", "10")).toBeNull()
  })
  it("holds a range to the head and refuses one that starts past it", () => {
    expect(clampToHead({ fromSeq: 100, toSeq: 200 }, 5000)).toEqual({
      fromSeq: 100,
      toSeq: 200,
    })
    expect(clampToHead({ fromSeq: 4900, toSeq: 9000 }, 5000)).toEqual({
      fromSeq: 4900,
      toSeq: 5000,
    })
    expect(clampToHead({ fromSeq: 5001, toSeq: 9000 }, 5000)).toBeNull()
  })
})
