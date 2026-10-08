import { describe, expect, it } from "vitest"
import {
  wardenLanguage,
  wardenKeywords,
} from "../src/components/warden-language"

/**
 * A sample from warden's own `dsl/testdata/multi-file/documents/roles.warden`,
 * with a string that holds an escape and a block comment added so every class
 * the tokenizer marks appears once.
 */
const SAMPLE = `warden config 1 // header

/* a block
   comment */
role editor : viewer {
    name = "Editor \\"one\\""
    max_members = 12
    is_default = true
    grants += ["document:write"]
}
`

interface Token {
  name: string
  text: string
}

/** What the language marks, as (class, text) in document order. */
function tokens(src: string): Token[] {
  const out: Token[] = []
  wardenLanguage.parser.parse(src).iterate({
    enter(node) {
      if (node.from < node.to && node.name !== "Document") {
        out.push({ name: node.name, text: src.slice(node.from, node.to) })
      }
    },
  })
  return out
}

function classOf(src: string, text: string): string | undefined {
  return tokens(src).find((t) => t.text === text)?.name
}

describe("wardenLanguage", () => {
  it("marks a keyword as a keyword", () => {
    expect(classOf(SAMPLE, "role")).toBe("keyword")
    expect(classOf(SAMPLE, "grants")).toBe("keyword")
    expect(classOf(SAMPLE, "max_members")).toBe("keyword")
  })

  it("marks a double-quoted string, escapes included, as one string", () => {
    expect(classOf(SAMPLE, '"Editor \\"one\\""')).toBe("string")
    expect(classOf(SAMPLE, '"document:write"')).toBe("string")
  })

  it("marks a line comment to the end of the line, and a block comment across lines", () => {
    expect(classOf(SAMPLE, "// header")).toBe("comment")
    expect(classOf(SAMPLE, "/* a block")).toBe("comment")
    expect(classOf(SAMPLE, "   comment */")).toBe("comment")
  })

  it("marks an identifier that is not a keyword as a name, not a keyword", () => {
    expect(classOf(SAMPLE, "editor")).toBe("variableName")
    expect(classOf(SAMPLE, "viewer")).toBe("variableName")
  })

  it("marks numbers and true/false", () => {
    expect(classOf(SAMPLE, "12")).toBe("number")
    expect(classOf(SAMPLE, "1")).toBe("number")
    expect(classOf(SAMPLE, "true")).toBe("bool")
    expect(classOf("x = false", "false")).toBe("bool")
    expect(classOf("x = 1.5", "1.5")).toBe("number")
  })

  it("marks punctuation", () => {
    expect(classOf(SAMPLE, "{")).toBe("punctuation")
    expect(classOf(SAMPLE, "[")).toBe("punctuation")
    expect(classOf("a: b", ":")).toBe("punctuation")
  })

  it("does not take a comment marker inside a string for a comment", () => {
    const src = 'name = "a // b"'
    expect(classOf(src, '"a // b"')).toBe("string")
    expect(tokens(src).some((t) => t.name === "comment")).toBe(false)
  })

  it("keeps a hyphenated name whole, but ends a name at an arrow", () => {
    expect(classOf("role billing-admin {", "billing-admin")).toBe(
      "variableName"
    )
    expect(classOf("parent->read", "parent")).toBe("variableName")
    expect(classOf("parent->read", "read")).toBe("variableName")
  })

  it("ends an unterminated string at the end of its line", () => {
    const src = 'name = "open\nrole x'
    expect(classOf(src, '"open')).toBe("string")
    expect(classOf(src, "role")).toBe("keyword")
  })

  it("knows the 44 keywords in dsl/token.go, and the two booleans are separate", () => {
    // `keywords` in token.go holds 46 spellings: these 44 and true/false.
    expect(wardenKeywords.size).toBe(44)
    expect(wardenKeywords.has("subjects")).toBe(true)
    expect(wardenKeywords.has("true")).toBe(false)
    for (const kw of wardenKeywords)
      expect(classOf(`${kw} x`, kw), kw).toBe("keyword")
  })
})
