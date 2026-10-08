import { describe, expect, it } from "vitest"
import {
  changesBetween,
  draftOf,
  normaliseVariables,
  rebase,
  sameVariables,
  templatePatch,
  variableProblems,
  versionPatch,
} from "../src/workspace/draft"
import type { Draft } from "../src/workspace/draft"
import { templateDetail } from "./data"

const FALLBACK = "htpv_01j00000000000000000000025"
const EN = "htpv_01j00000000000000000000026"

const base = (): Draft => draftOf(templateDetail())
const edit = (
  d: Draft,
  id: string,
  field: "subject" | "html" | "text" | "title",
  value: string
): Draft => ({
  ...d,
  versions: { ...d.versions, [id]: { ...d.versions[id], [field]: value } },
})

describe("draftOf", () => {
  it("copies settings, variables and each version's content, keyed by version ID", () => {
    const d = base()
    expect(d.settings).toEqual({
      name: "Receipt",
      category: "transactional",
      enabled: true,
    })
    expect(d.variables.map((v) => v.name)).toEqual([
      "customer_name",
      "amount",
      "invoice_url",
    ])
    expect(Object.keys(d.versions)).toEqual([FALLBACK, EN])
    expect(d.versions[EN]).toEqual({
      subject: "Your {{.amount}} receipt",
      html: "<p>Thanks {{.customer_name}}</p>",
      text: "Thanks {{.customer_name}}",
      title: "",
    })
  })
})

describe("changesBetween", () => {
  it("finds nothing in an untouched draft", () => {
    expect(changesBetween(base(), base())).toEqual([])
  })

  it("names each changed field, the variables, and each changed setting", () => {
    const saved = base()
    let d = edit(saved, EN, "html", "<p>New</p>")
    d = {
      ...d,
      settings: { ...d.settings, name: "Receipts" },
      variables: [...d.variables].reverse(),
    }
    expect(changesBetween(saved, d)).toEqual([
      { kind: "field", versionId: EN, field: "html" },
      { kind: "variables" },
      { kind: "setting", key: "name" },
    ])
  })

  it("treats an absent default and an empty one as the same", () => {
    const saved = base()
    const d = {
      ...saved,
      variables: saved.variables.map((v) => ({
        ...v,
        default: "",
        description: "",
      })),
    }
    expect(changesBetween(saved, d)).toEqual([])
    expect(sameVariables(saved.variables, d.variables)).toBe(true)
  })
})

describe("versionPatch", () => {
  it("sends only the fields that changed", () => {
    const saved = base()
    const d = edit(saved, EN, "text", "Hello")
    expect(versionPatch(saved.versions[EN], d.versions[EN])).toEqual({
      text: "Hello",
    })
    expect(versionPatch(saved.versions[EN], saved.versions[EN])).toBeNull()
  })
})

describe("templatePatch", () => {
  it("sends changed settings, the name trimmed, and the whole variable list when it changed", () => {
    const saved = base()
    const d: Draft = {
      ...saved,
      settings: { ...saved.settings, name: "  Receipts ", enabled: false },
      variables: saved.variables.slice(0, 1),
    }
    expect(templatePatch(saved, d)).toEqual({
      name: "Receipts",
      enabled: false,
      variables: [
        {
          name: "customer_name",
          type: "string",
          required: true,
          default: "",
          description: "",
        },
      ],
    })
  })

  it("is null when nothing at template level changed", () => {
    const saved = base()
    expect(templatePatch(saved, edit(saved, EN, "html", "x"))).toBeNull()
  })
})

describe("rebase", () => {
  it("keeps every edit and takes the server's answer for everything not edited", () => {
    const prev = base()
    const draft = edit(prev, EN, "html", "<p>Mine</p>")
    // Someone else changed the fallback's text and the en subject.
    const next = edit(
      edit(prev, FALLBACK, "text", "Theirs"),
      EN,
      "subject",
      "Their subject"
    )
    const out = rebase(prev, next, draft)
    expect(out.versions[EN].html).toBe("<p>Mine</p>")
    expect(out.versions[EN].subject).toBe("Their subject")
    expect(out.versions[FALLBACK].text).toBe("Theirs")
  })

  it("adds a version that's new on the server and drops one that's gone", () => {
    const prev = base()
    const next: Draft = {
      ...prev,
      versions: {
        [EN]: prev.versions[EN],
        v_new: { subject: "", html: "", text: "", title: "" },
      },
    }
    const out = rebase(prev, next, edit(prev, EN, "text", "Mine"))
    expect(Object.keys(out.versions).sort()).toEqual([EN, "v_new"].sort())
    expect(out.versions[EN].text).toBe("Mine")
  })

  it("keeps edited settings and variables and follows the server for the rest", () => {
    const prev = base()
    const draft: Draft = {
      ...prev,
      settings: { ...prev.settings, name: "Mine" },
    }
    const next: Draft = {
      ...prev,
      settings: { ...prev.settings, category: "marketing" },
      variables: prev.variables.slice(1),
    }
    const out = rebase(prev, next, draft)
    expect(out.settings).toEqual({
      name: "Mine",
      category: "marketing",
      enabled: true,
    })
    expect(out.variables.map((v) => v.name)).toEqual(["amount", "invoice_url"])
  })
})

describe("variableProblems", () => {
  it("flags empty, malformed and duplicate names by row", () => {
    const problems = variableProblems([
      { name: "ok_name", type: "string", required: false },
      { name: "", type: "string", required: false },
      { name: "1st", type: "string", required: false },
      { name: "ok_name", type: "string", required: false },
    ])
    expect([...problems.entries()]).toEqual([
      [1, "A variable needs a name."],
      [
        2,
        "Use up to 64 letters, digits and underscores, starting with a letter or an underscore.",
      ],
      [3, "ok_name is declared twice."],
    ])
  })
})

describe("normaliseVariables", () => {
  it("trims names and fills absent strings, the shape Save sends", () => {
    expect(
      normaliseVariables([{ name: " a ", type: "url", required: true }])
    ).toEqual([
      { name: "a", type: "url", required: true, default: "", description: "" },
    ])
  })
})
