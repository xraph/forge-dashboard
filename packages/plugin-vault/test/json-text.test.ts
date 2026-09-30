import { describe, expect, it } from "vitest"
import { parseJsonText, prettyJson, sameJson } from "../src/json-text"

function failure(text: string) {
  const r = parseJsonText(text)
  if (r.ok) throw new Error(`expected ${JSON.stringify(text)} not to parse`)
  return r.error
}

describe("parseJsonText", () => {
  it("returns the value of text that parses, including null and falsy values", () => {
    expect(parseJsonText('{"a": [1, 2]}')).toEqual({ ok: true, value: { a: [1, 2] } })
    expect(parseJsonText("null")).toEqual({ ok: true, value: null })
    expect(parseJsonText(" false ")).toEqual({ ok: true, value: false })
    expect(parseJsonText("0")).toEqual({ ok: true, value: 0 })
    expect(parseJsonText('""')).toEqual({ ok: true, value: "" })
  })

  it("says where a missing comma is, by line and column", () => {
    const err = failure('{\n  "a": 1\n  "b": 2\n}')
    expect(err.line).toBe(3)
    expect(err.column).toBe(3)
    expect(err.message).toMatch(/expected/i)
  })

  it("puts an error at the end of the text on the last line", () => {
    const err = failure('{"a": 1')
    expect(err.line).toBe(1)
    expect(err.column).toBe(8)
  })

  it("refuses text with nothing in it, at the start", () => {
    for (const text of ["", "  \n "]) {
      const err = failure(text)
      expect(err.message).toMatch(/nothing|empty|enter/i)
    }
    expect(failure("").line).toBe(1)
    expect(failure("").column).toBe(1)
  })

  it("refuses a trailing comma, a single-quoted string and trailing text", () => {
    expect(failure("[1, 2,]").column).toBe(7)
    expect(failure("{'a': 1}").column).toBe(2)
    const tail = failure('{"a": 1} x')
    expect(tail.column).toBe(10)
  })

  it("refuses a bad escape and a raw newline in a string", () => {
    expect(failure('"a\\qb"').column).toBe(4)
    expect(failure('"a\nb"').message).toMatch(/control|newline|escape/i)
  })

  it("refuses a number too large to hold, where the number starts", () => {
    const err = failure('[1, 1e400]')
    expect(err.message).toMatch(/too large/i)
    expect(err.column).toBe(5)
  })

  it("agrees with JSON.parse on what parses", () => {
    const samples = [
      "1e5",
      "-0.5",
      "01",
      "1.",
      ".5",
      "[]",
      "{}",
      '{"a":{"b":[true,false,null]}}',
      "tru",
      '"\\u00e9"',
      '"\\u00zz"',
      "[1 2]",
      '{"a" 1}',
      "NaN",
    ]
    for (const s of samples) {
      let expected = true
      try {
        JSON.parse(s)
      } catch {
        expected = false
      }
      expect({ s, ok: parseJsonText(s).ok }).toEqual({ s, ok: expected })
    }
  })
})

describe("prettyJson and sameJson", () => {
  it("pretty prints with two spaces", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(prettyJson(null)).toBe("null")
  })

  it("compares by value, not by key order", () => {
    expect(sameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(sameJson(1, "1")).toBe(false)
    expect(sameJson(null, undefined)).toBe(false)
    expect(sameJson("", "")).toBe(true)
  })
})
