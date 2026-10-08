import { describe, expect, it } from "vitest"
import { findActions, inAction } from "../src/editor/actions"
import { diagnosticRange, offsetOf } from "../src/editor/positions"

const actionsIn = (text: string) =>
  findActions(text).map((a) => text.slice(a.from, a.to))

describe("findActions", () => {
  it("finds each action from {{ to its }}", () => {
    expect(actionsIn("Hi {{.name}}, {{ upper .x }}!")).toEqual([
      "{{.name}}",
      "{{ upper .x }}",
    ])
  })

  it("keeps trim markers inside the action", () => {
    expect(actionsIn("a {{- .x -}} b")).toEqual(["{{- .x -}}"])
  })

  it("doesn't end an action at a }} inside a string, a raw string or a comment", () => {
    expect(actionsIn('{{ printf "}}" .x }} tail')).toEqual([
      '{{ printf "}}" .x }}',
    ])
    expect(actionsIn("{{ printf `}}` }} tail")).toEqual(["{{ printf `}}` }}"])
    expect(actionsIn("{{/* }} */}} tail")).toEqual(["{{/* }} */}}"])
    expect(actionsIn('{{ printf "a\\"}}" }}')).toEqual([
      '{{ printf "a\\"}}" }}',
    ])
  })

  it("runs an unclosed action to the end of the text", () => {
    const text = "Hi {{ .name"
    expect(findActions(text)).toEqual([
      { from: 3, to: text.length, closed: false },
    ])
  })

  it("finds nothing in text without actions", () => {
    expect(findActions("Hello { not } an action")).toEqual([])
  })
})

describe("inAction", () => {
  it("is true between {{ and }} and false outside", () => {
    const text = "Hi {{ .na }} there"
    expect(inAction(text, 0)).toBe(false)
    expect(inAction(text, 3)).toBe(false)
    expect(inAction(text, 5)).toBe(true)
    expect(inAction(text, 9)).toBe(true)
    expect(inAction(text, text.length)).toBe(false)
  })

  it("is true at the end of an unclosed action", () => {
    const text = "Hi {{ .cu"
    expect(inAction(text, text.length)).toBe(true)
  })
})

describe("offsetOf", () => {
  it("counts a 1-based line and column into a document offset", () => {
    expect(offsetOf("ab\nhello world", 2, 7)).toBe(9)
    expect(offsetOf("ab\nhello world", 1, 1)).toBe(0)
  })

  it("counts columns in characters, so an emoji before the column is one column but two units", () => {
    // "👋" is 2 UTF-16 units. Column 6 is the "." after "👋 {{ ".
    expect(offsetOf("👋 {{ .x }}", 1, 6)).toBe(6)
  })

  it("clamps a line past the end to the last line, and a column past the end to the line's end", () => {
    expect(offsetOf("one\ntwo", 9, 1)).toBe(4)
    expect(offsetOf("abc", 1, 10)).toBe(3)
  })
})

describe("diagnosticRange", () => {
  it("underlines the token at the column", () => {
    const text = "ab\nhello world"
    const r = diagnosticRange(text, 2, 7)
    expect(text.slice(r.from, r.to)).toBe("world")
  })

  it("lands on the right character after a non-ASCII one", () => {
    const text = "line one\né {{ nosuch }}"
    // é is column 1, so "nosuch" starts at column 6 on line 2.
    const r = diagnosticRange(text, 2, 6)
    expect(text.slice(r.from, r.to)).toBe("nosuch")
  })

  it("lands on the right character after an emoji", () => {
    const text = "👋 {{ .x }}"
    const r = diagnosticRange(text, 1, 6)
    expect(text.slice(r.from, r.to)).toBe(".x")
  })

  it("marks the whole line when there is no column, as for a parse error", () => {
    const text = "a\nbad {{ line\nc"
    const r = diagnosticRange(text, 2, 0)
    expect(text.slice(r.from, r.to)).toBe("bad {{ line")
  })

  it("marks one character when no token starts at the column", () => {
    const text = "x {{ }}"
    const r = diagnosticRange(text, 1, 3)
    expect(text.slice(r.from, r.to)).toBe("{")
  })

  it("marks the character before the end when the column is past the line", () => {
    const text = "abc"
    const r = diagnosticRange(text, 1, 10)
    expect(text.slice(r.from, r.to)).toBe("c")
  })
})
