import { describe, expect, it } from "vitest"
import { layoutSpans, overlapsByIndex, splitAtByte } from "../src/spans"

const span = (index: number, start: number, end: number) => ({ id: `chk_${index}`, index, start_offset: start, end_offset: end, token_count: Math.floor((end - start) / 4) })

describe("layoutSpans", () => {
  it("scales to the largest end offset and places each chunk as a percentage", () => {
    const layout = layoutSpans([span(0, 0, 100), span(1, 80, 200)])
    expect(layout.scale).toBe(200)
    expect(layout.segments.map((s) => [s.left, s.width])).toEqual([[0, 50], [40, 60]])
  })

  it("measures each chunk's overlap with the one before it", () => {
    const layout = layoutSpans([span(0, 0, 100), span(1, 80, 200), span(2, 200, 260)])
    expect(layout.segments.map((s) => s.overlap)).toEqual([0, 20, 0])
  })

  it("never reports more overlap than the chunk is long", () => {
    const layout = layoutSpans([span(0, 0, 100), span(1, 20, 50)])
    expect(layout.segments.map((s) => s.overlap)).toEqual([0, 30])
  })

  it("counts a chunk that starts before its predecessor as a fallback offset, not an overlap", () => {
    const layout = layoutSpans([span(0, 50, 100), span(1, 0, 40)])
    expect(layout.segments.map((s) => s.overlap)).toEqual([0, 0])
  })

  it("finds the bytes no chunk covers, including a leading gap", () => {
    const layout = layoutSpans([span(0, 10, 100), span(1, 120, 200)])
    expect(layout.gaps).toEqual([{ start: 0, end: 10 }, { start: 100, end: 120 }])
  })

  it("has nothing to draw for no spans", () => {
    expect(layoutSpans([])).toEqual({ scale: 0, segments: [], gaps: [] })
  })
})

describe("overlapsByIndex", () => {
  it("maps each chunk index to its overlap with the previous chunk", () => {
    const map = overlapsByIndex([span(0, 0, 100), span(1, 80, 200)])
    expect(map.get(0)).toBe(0)
    expect(map.get(1)).toBe(20)
  })
})

describe("splitAtByte", () => {
  it("splits on a byte count without cutting a character in two", () => {
    expect(splitAtByte("abcdef", 2)).toEqual(["ab", "cdef"])
    expect(splitAtByte("é€x", 3)).toEqual(["é", "€x"])
    expect(splitAtByte("abc", 0)).toEqual(["", "abc"])
    expect(splitAtByte("abc", 10)).toEqual(["abc", ""])
  })
})
