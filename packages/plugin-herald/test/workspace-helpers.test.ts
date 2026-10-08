import { describe, expect, it } from "vitest"
import { LOCALE_PATTERN, SLUG_PATTERN, VARIABLE_PATTERN } from "../src/format"
import { FIELD_LABEL, SINGLE_LINE, fieldsFor } from "../src/workspace/fields"
import {
  answerText,
  answersFor,
  explainLocale,
  versionName,
  withActive,
  without,
} from "../src/workspace/resolve"
import type { VersionState } from "../src/workspace/resolve"
import {
  parseSample,
  placeholderFor,
  sampleDataFor,
  sampleTextFor,
} from "../src/workspace/sample-data"

const V: VersionState[] = [
  { id: "v-fallback", locale: "", active: true },
  { id: "v-en", locale: "en", active: true },
  { id: "v-fr", locale: "fr", active: false },
  { id: "v-ptbr", locale: "pt-BR", active: true },
]

describe("explainLocale mirrors Herald's template.Explain", () => {
  it("answers an exact live locale on the first step", () => {
    expect(explainLocale(V, "en")).toEqual({
      steps: [{ try: "en", match: "exact", found: true, versionId: "v-en" }],
      versionId: "v-en",
    })
  })

  it("tries the language, then the fallback, and skips an inactive version", () => {
    expect(explainLocale(V, "fr-CA")).toEqual({
      steps: [
        { try: "fr-CA", match: "exact", found: false },
        { try: "fr", match: "language", found: false },
        { try: "", match: "default", found: true, versionId: "v-fallback" },
      ],
      versionId: "v-fallback",
    })
  })

  it("answers en-GB with en through the language step", () => {
    expect(explainLocale(V, "en-GB").versionId).toBe("v-en")
    expect(explainLocale(V, "en-GB").steps.map((s) => s.match)).toEqual([
      "exact",
      "language",
    ])
  })

  it("fails when nothing live answers", () => {
    const none = withActive(V, "v-fallback", false)
    expect(explainLocale(none, "de")).toEqual({
      steps: [
        { try: "de", match: "exact", found: false },
        { try: "", match: "default", found: false },
      ],
      versionId: null,
    })
  })

  it("tries only the fallback itself for the empty locale", () => {
    expect(explainLocale(V, "").steps).toEqual([
      { try: "", match: "exact", found: true, versionId: "v-fallback" },
    ])
  })
})

describe("answerText and versionName", () => {
  it("names the version a locale would get, in words", () => {
    expect(versionName("")).toBe("the fallback version")
    expect(versionName("en")).toBe("the en version")
    expect(answerText(V, "en")).toBe("the en version")
    expect(answerText(withActive(V, "v-en", false), "en")).toBe(
      "the fallback version"
    )
    expect(answerText(without(without(V, "v-en"), "v-fallback"), "en")).toBe(
      "nothing, so a send in that locale fails"
    )
  })
})

describe("answersFor", () => {
  it("says what each live version answers and nothing for an inactive one", () => {
    expect(answersFor(V[0])).toEqual({ kind: "fallback" })
    expect(answersFor(V[1])).toEqual({
      kind: "locale",
      locale: "en",
      wildcard: "en-*",
    })
    expect(answersFor(V[2])).toBeNull()
    expect(answersFor(V[3])).toEqual({
      kind: "locale",
      locale: "pt-BR",
      wildcard: null,
    })
  })
})

describe("fieldsFor", () => {
  it("orders each channel's fields the way they're read, and folds the rest", () => {
    expect(fieldsFor("email")).toEqual({
      primary: ["subject", "html", "text"],
      other: ["title"],
    })
    expect(fieldsFor("sms")).toEqual({
      primary: ["text"],
      other: ["subject", "html", "title"],
    })
    expect(fieldsFor("push")).toEqual({
      primary: ["title", "text"],
      other: ["subject", "html"],
    })
    expect(fieldsFor("inapp")).toEqual({
      primary: ["title", "text"],
      other: ["subject", "html"],
    })
    expect(fieldsFor("webhook")).toEqual({
      primary: ["subject", "text"],
      other: ["html", "title"],
    })
    expect(fieldsFor("chat")).toEqual({
      primary: ["subject", "text"],
      other: ["html", "title"],
    })
  })

  it("shows every field for a channel it doesn't know", () => {
    expect(fieldsFor("pager")).toEqual({
      primary: ["subject", "html", "text", "title"],
      other: [],
    })
  })

  it("labels fields and keeps subject and title on one line", () => {
    expect(FIELD_LABEL.html).toBe("HTML")
    expect([...SINGLE_LINE].sort()).toEqual(["subject", "title"])
  })
})

describe("sample data", () => {
  it("prefills from each variable's default, else a placeholder for its type", () => {
    expect(
      placeholderFor({
        name: "expires_in",
        type: "string",
        required: false,
        default: "1 hour",
      })
    ).toBe("1 hour")
    expect(
      placeholderFor({ name: "customer_name", type: "string", required: true })
    ).toBe("example customer name")
    expect(
      placeholderFor({ name: "invoice_url", type: "url", required: false })
    ).toBe("https://example.com/")
    expect(
      placeholderFor({ name: "count", type: "number", required: false })
    ).toBe(1)
    expect(
      placeholderFor({ name: "vip", type: "boolean", required: false })
    ).toBe(true)
  })

  it("builds an object and its pretty JSON, skipping unnamed rows", () => {
    const vars = [
      { name: "customer_name", type: "string", required: true },
      { name: " ", type: "string", required: false },
    ]
    expect(sampleDataFor(vars)).toEqual({
      customer_name: "example customer name",
    })
    expect(sampleTextFor(vars)).toBe(
      '{\n  "customer_name": "example customer name"\n}'
    )
  })

  it("parses an object, treats empty text as no data, and refuses anything else", () => {
    expect(parseSample('{"a": 1}')).toEqual({ ok: true, data: { a: 1 } })
    expect(parseSample("  ")).toEqual({ ok: true, data: {} })
    expect(parseSample("[1]")).toEqual({
      ok: false,
      message: 'Sample data must be a JSON object, like {"name": "Ada"}.',
    })
    expect(parseSample("null")).toEqual({
      ok: false,
      message: 'Sample data must be a JSON object, like {"name": "Ada"}.',
    })
    const bad = parseSample("{nope")
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toMatch(/^Not valid JSON: /)
  })
})

describe("shared patterns match Herald's handlers_templates.go", () => {
  it("accepts and refuses what the server does", () => {
    expect(SLUG_PATTERN.test("billing.receipt")).toBe(true)
    expect(SLUG_PATTERN.test("Billing")).toBe(false)
    expect(LOCALE_PATTERN.test("pt-BR")).toBe(true)
    expect(LOCALE_PATTERN.test("e")).toBe(false)
    expect(VARIABLE_PATTERN.test("customer_name")).toBe(true)
    expect(VARIABLE_PATTERN.test("1st")).toBe(false)
    expect(VARIABLE_PATTERN.test("a".repeat(65))).toBe(false)
  })
})
