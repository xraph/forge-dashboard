import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { EditorView } from "@codemirror/view"
import { forEachDiagnostic } from "@codemirror/lint"
import { EditorState } from "@codemirror/state"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenSchemaPage } from "../src/pages/schema"
import { diagnosticOffset } from "../src/components/schema-editor"
import { renderPage } from "./harness"

// jsdom 25 ships no PointerEvent constructor. The kit Switch's click handler
// re-dispatches the click it receives as a `new PointerEvent(...)`, only to
// carry the modifier keys, so a MouseEvent satisfies every property it reads.
// Scoped to this file, as in packages/plugin-authsome/test/features.test.tsx.
if (typeof window.PointerEvent === "undefined") {
  // @ts-expect-error - MouseEvent covers every field dispatchClickWithModifiers reads.
  window.PointerEvent = window.MouseEvent
}

const EXPORT = 'warden config 1\ntenant tenant_fixture\n\nrole viewer {\n    name = "Viewer"\n}\n'
const EXPORT_AFTER = 'warden config 1\ntenant tenant_fixture\n\nrole viewer {\n    name = "Viewer"\n}\nrole editor {\n    name = "Editor"\n}\n'
const DIGEST = "d".repeat(64)

interface Plan {
  valid: boolean
  diagnostics: { line: number; col: number; message: string }[]
  created: string[]
  updated: string[]
  deleted: string[]
  noOps: number
  digest: string
}

interface Applied {
  created: string[]
  updated: string[]
  deleted: string[]
  noOps: number
  diverged: boolean
}

const VALID: Plan = {
  valid: true,
  diagnostics: [],
  created: ["+ role//editor"],
  updated: ["~ role//viewer (grants)"],
  deleted: ["- policy//old"],
  noOps: 4,
  digest: DIGEST,
}

const EMPTY: Plan = { ...VALID, created: [], updated: [], deleted: [], noOps: 6 }

const INVALID: Plan = {
  valid: false,
  diagnostics: [
    { line: 4, col: 6, message: "expected a name" },
    { line: 5, col: 1, message: "unexpected }" },
  ],
  created: [],
  updated: [],
  deleted: [],
  noOps: 0,
  digest: "",
}

const APPLIED: Applied = {
  created: ["+ role//editor"],
  updated: ["~ role//viewer (grants)"],
  deleted: ["- policy//old"],
  noOps: 4,
  diverged: false,
}

type Sent = { intent: string; payload: unknown }

interface Script {
  exports?: string[]
  plan?: (p: { source: string; prune: boolean }) => Plan
  apply?: (p: { source: string; prune: boolean; digest: string }) => Applied
  exportError?: ContractError
}

/** Answers schema.export in turn (the last answer repeats), plan and apply from the script. */
function scripted(script: Script) {
  const sent: Sent[] = []
  let exported = 0
  const client = {
    extension: "warden",
    query: async (intent: string, params?: Record<string, unknown>) => {
      sent.push({ intent, payload: params })
      if (intent === "schema.export") {
        if (script.exportError) throw script.exportError
        const list = script.exports ?? [EXPORT]
        return { source: list[Math.min(exported++, list.length - 1)] }
      }
      if (intent === "schema.plan" && script.plan) {
        return script.plan(params as { source: string; prune: boolean })
      }
      throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
    },
    command: async (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      if (intent === "schema.apply" && script.apply) {
        return script.apply(payload as { source: string; prune: boolean; digest: string })
      }
      throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
    },
  } as ScopedClient
  return { client, sent }
}

function view(): EditorView {
  const dom = document.querySelector(".cm-editor") as HTMLElement
  return EditorView.findFromDOM(dom) as EditorView
}

async function mount(script: Script) {
  const made = scripted(script)
  renderPage(WardenSchemaPage, made.client)
  await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
  return made
}

function setText(text: string) {
  act(() => {
    view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text } })
  })
}

const docText = () => view().state.doc.toString()
const button = (name: string | RegExp) => screen.getByRole("button", { name })
const pruneSwitch = () =>
  screen.getByRole("switch", { name: "Delete entities this source does not declare" })

async function plan() {
  fireEvent.click(button("Plan"))
  await waitFor(() => expect(button("Plan")).toHaveProperty("disabled", false))
}

function diagnosticsOf(state: EditorState) {
  const out: { from: number; to: number; message: string }[] = []
  forEachDiagnostic(state, (d, from, to) => out.push({ from, to, message: d.message }))
  return out
}

describe("WardenSchemaPage: loading", () => {
  it("reads schema.export into the editor", async () => {
    const { sent } = await mount({})
    expect(docText()).toBe(EXPORT)
    expect(sent.filter((s) => s.intent === "schema.export").length).toBeGreaterThan(0)
  })

  it("names the editing area for a screen reader", async () => {
    await mount({})
    expect(screen.getByLabelText("Warden schema source")).toBeTruthy()
  })

  it("loads the export again on Load current schema, without asking when nothing was edited", async () => {
    await mount({ exports: [EXPORT, EXPORT_AFTER] })
    fireEvent.click(button("Load current schema"))
    await waitFor(() => expect(docText()).toBe(EXPORT_AFTER))
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("asks before replacing edits, and keeps them when you cancel", async () => {
    await mount({ exports: [EXPORT, EXPORT_AFTER] })
    setText("my edits")
    fireEvent.click(button("Load current schema"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Replace your edits with the current schema?")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(docText()).toBe("my edits")
  })

  it("replaces edits with the current schema once you confirm", async () => {
    await mount({ exports: [EXPORT, EXPORT_AFTER] })
    setText("my edits")
    fireEvent.click(button("Load current schema"))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace" }))
    await waitFor(() => expect(docText()).toBe(EXPORT_AFTER))
  })

  it("does not ask when the edits were undone back to the loaded text", async () => {
    await mount({ exports: [EXPORT, EXPORT_AFTER] })
    setText("my edits")
    setText(EXPORT)
    fireEvent.click(button("Load current schema"))
    await waitFor(() => expect(docText()).toBe(EXPORT_AFTER))
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("says so when the first load fails, and offers to try again", async () => {
    const { client } = scripted({ exportError: new ContractError("INTERNAL", "store is down") })
    renderPage(WardenSchemaPage, client)
    expect(await screen.findByText("Schema unavailable")).toBeTruthy()
    expect(screen.getByText(/store is down/)).toBeTruthy()
    expect(document.querySelector(".cm-editor")).toBeNull()
  })

  it("keeps your edits and says so when a later load fails", async () => {
    let fail = false
    const made = scripted({})
    const inner = made.client
    const client = {
      ...inner,
      query: (intent: string, params?: Record<string, unknown>) => {
        if (fail && intent === "schema.export") {
          return Promise.reject(new ContractError("INTERNAL", "store is down"))
        }
        return inner.query(intent, params)
      },
    } as ScopedClient
    renderPage(WardenSchemaPage, client)
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
    setText("my edits")
    fail = true
    fireEvent.click(button("Load current schema"))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Replace" }))
    expect(await screen.findByText("Could not load the current schema")).toBeTruthy()
    expect(screen.getByText("store is down")).toBeTruthy()
    expect(docText()).toBe("my edits")
  })
})

describe("WardenSchemaPage: plan", () => {
  it("sends the editor text and the prune value", async () => {
    const { sent } = await mount({ plan: () => VALID })
    setText("edited source")
    await plan()
    expect(sent.filter((s) => s.intent === "schema.plan")).toEqual([
      { intent: "schema.plan", payload: { source: "edited source", prune: false } },
    ])
    fireEvent.click(pruneSwitch())
    await plan()
    expect(sent.filter((s) => s.intent === "schema.plan").at(-1)).toEqual({
      intent: "schema.plan",
      payload: { source: "edited source", prune: true },
    })
  })

  it("lists created, changed and deleted lines verbatim in mono, with counts, and the unchanged count", async () => {
    await mount({ plan: () => VALID })
    await plan()
    const region = await screen.findByRole("region", { name: "Plan result" })
    for (const [heading, line] of [
      ["Will create", "+ role//editor"],
      ["Will change", "~ role//viewer (grants)"],
      ["Will delete", "- policy//old"],
    ] as const) {
      const h = within(region).getByRole("heading", { name: new RegExp(`^${heading}`) })
      expect(h.textContent).toBe(`${heading} 1`)
      const el = within(region).getByText(line)
      expect(el.className).toContain("font-mono")
    }
    expect(within(region).getByText("4 unchanged")).toBeTruthy()
    expect(within(region).queryByText("Applying this changes nothing.")).toBeNull()
  })

  it("leaves out a section with nothing in it", async () => {
    await mount({ plan: () => ({ ...VALID, updated: [], deleted: [] }) })
    await plan()
    const region = await screen.findByRole("region", { name: "Plan result" })
    expect(within(region).getByRole("heading", { name: /^Will create/ })).toBeTruthy()
    expect(within(region).queryByRole("heading", { name: /^Will change/ })).toBeNull()
    expect(within(region).queryByRole("heading", { name: /^Will delete/ })).toBeNull()
  })

  it("says an empty diff changes nothing, and leaves Apply disabled", async () => {
    await mount({ plan: () => EMPTY })
    await plan()
    expect(await screen.findByText("Applying this changes nothing.")).toBeTruthy()
    expect(screen.getByText("6 unchanged")).toBeTruthy()
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("comes back stale, with Apply disabled, when the text was edited while the plan was in flight", async () => {
    let release: (p: Plan) => void = () => {}
    const made = scripted({})
    const client = {
      ...made.client,
      query: (intent: string, params?: Record<string, unknown>) =>
        intent === "schema.plan"
          ? new Promise<Plan>((resolve) => (release = resolve))
          : made.client.query(intent, params),
    } as ScopedClient
    renderPage(WardenSchemaPage, client)
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
    fireEvent.click(button("Plan"))
    await waitFor(() => expect(button("Planning…")).toHaveProperty("disabled", true))
    setText(docText() + "\n// edited while planning\n")
    await act(async () => release(VALID))
    await waitFor(() => expect(button("Plan")).toHaveProperty("disabled", false))
    expect(
      screen.getByText("The source has changed since this plan. Plan again before applying.")
    ).toBeTruthy()
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("shows a failed plan request and leaves Apply disabled", async () => {
    await mount({
      plan: () => {
        throw new ContractError("PERMISSION_DENIED", "missing permission read on warden:policy")
      },
    })
    await plan()
    expect(await screen.findByText("Could not plan the schema")).toBeTruthy()
    expect(screen.getByText("missing permission read on warden:policy")).toBeTruthy()
    expect(button("Apply")).toHaveProperty("disabled", true)
  })
})

describe("WardenSchemaPage: diagnostics", () => {
  it("marks each diagnostic in the editor at its line and column, and lists them all", async () => {
    await mount({ plan: () => INVALID })
    await plan()
    const region = await screen.findByRole("region", { name: "Plan result" })
    expect(within(region).getByText("Line 4, column 6: expected a name")).toBeTruthy()
    expect(within(region).getByText("Line 5, column 1: unexpected }")).toBeTruthy()

    const state = view().state
    const marks = diagnosticsOf(state)
    expect(marks.map((m) => m.message)).toEqual(["expected a name", "unexpected }"])
    // Line 4 is `role viewer {`, column 6 the `v`; line 5 is `    name = ...`.
    expect(marks[0].from).toBe(state.doc.line(4).from + 5)
    expect(marks[1].from).toBe(state.doc.line(5).from)
    expect(document.querySelector(".cm-lintRange")).not.toBeNull()
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("shows every diagnostic when a parse error cascades", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      line: (i % 6) + 1,
      col: 1,
      message: `problem ${i + 1}`,
    }))
    await mount({ plan: () => ({ ...INVALID, diagnostics: many }) })
    await plan()
    const region = await screen.findByRole("region", { name: "Plan result" })
    expect(within(region).getAllByText(/^Line \d+, column 1: problem \d+$/)).toHaveLength(40)
    expect(diagnosticsOf(view().state)).toHaveLength(40)
  })

  it("clears the markers when the source is planned again and is valid", async () => {
    let answer = INVALID
    await mount({ plan: () => answer })
    await plan()
    await waitFor(() => expect(diagnosticsOf(view().state)).toHaveLength(2))
    answer = VALID
    await plan()
    await waitFor(() => expect(diagnosticsOf(view().state)).toHaveLength(0))
  })
})

describe("WardenSchemaPage: when Apply is enabled", () => {
  it("is disabled before any plan", async () => {
    await mount({})
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("is enabled for a valid, non-empty plan made for the current text and prune value", async () => {
    await mount({ plan: () => VALID })
    await plan()
    expect(button("Apply")).toHaveProperty("disabled", false)
    expect(screen.queryByText(/The source has changed since this plan/)).toBeNull()
  })

  it("is disabled after any edit, and says to plan again", async () => {
    await mount({ plan: () => VALID })
    await plan()
    setText(docText() + "\n")
    expect(button("Apply")).toHaveProperty("disabled", true)
    expect(
      screen.getByText("The source has changed since this plan. Plan again before applying.")
    ).toBeTruthy()
  })

  it("is enabled again when the edit is undone to the planned text", async () => {
    await mount({ plan: () => VALID })
    await plan()
    const planned = docText()
    setText(planned + "x")
    setText(planned)
    expect(button("Apply")).toHaveProperty("disabled", false)
  })

  it("is disabled when only the prune value changed, and says that, not that the source changed", async () => {
    await mount({ plan: () => VALID })
    await plan()
    fireEvent.click(pruneSwitch())
    expect(button("Apply")).toHaveProperty("disabled", true)
    expect(
      screen.getByText("The prune setting has changed since this plan. Plan again before applying.")
    ).toBeTruthy()
    expect(screen.queryByText(/The source has changed/)).toBeNull()
  })

  it("is enabled again by planning the new text", async () => {
    await mount({ plan: () => VALID })
    await plan()
    setText("new text")
    await plan()
    expect(button("Apply")).toHaveProperty("disabled", false)
  })
})

describe("WardenSchemaPage: prune", () => {
  it("is a switch labelled for what it does, off at first, and not in the region Apply is in", async () => {
    await mount({ plan: () => VALID })
    await plan()
    expect(pruneSwitch().getAttribute("aria-checked")).toBe("false")
    const region = screen.getByRole("region", { name: "Plan result" })
    expect(within(region).getByRole("button", { name: "Apply" })).toBeTruthy()
    expect(within(region).queryByRole("switch")).toBeNull()
  })

  it("explains what it covers", async () => {
    await mount({})
    expect(
      screen.getByText(
        "Only namespaces this source names, including by an empty namespace block, are pruned."
      )
    ).toBeTruthy()
  })

  it("adds a destructive warning and a second checkbox to the confirmation when a pruning plan deletes", async () => {
    const deleted = Array.from({ length: 7 }, (_, i) => `- role//r${i + 1}`)
    await mount({ plan: () => ({ ...VALID, deleted }) })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    const warning = within(dialog).getByText(/^This deletes 7 entities/)
    expect(warning.textContent).toBe(
      "This deletes 7 entities in the namespaces this source covers: - role//r1, - role//r2, - role//r3, - role//r4, - role//r5, and 2 more. Deleting a role also deletes its assignments and grants."
    )
    expect(warning.className).toContain("text-destructive")
    const confirm = within(dialog).getByRole("button", { name: "Apply changes" })
    expect(confirm).toHaveProperty("disabled", true)
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "I have read the deletions" }))
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false))
  })

  it("names all the deletions and no 'and n more' when there are five or fewer", async () => {
    const deleted = ["- role//a", "- role//b"]
    await mount({ plan: () => ({ ...VALID, deleted }) })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/^This deletes 2 entities/).textContent).toBe(
      "This deletes 2 entities in the namespaces this source covers: - role//a, - role//b. Deleting a role also deletes its assignments and grants."
    )
  })

  it("says entity, not entities, for one deletion", async () => {
    await mount({ plan: () => ({ ...VALID, deleted: ["- role//a"] }) })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/^This deletes 1 entity/).textContent).toBe(
      "This deletes 1 entity in the namespaces this source covers: - role//a. Deleting a role also deletes its assignments and grants."
    )
  })

  it("does not say a role's assignments go when no deleted line is a role", async () => {
    await mount({ plan: () => ({ ...VALID, deleted: ["- policy//old", "- permission//doc:read"] }) })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/^This deletes 2 entities/).textContent).toBe(
      "This deletes 2 entities in the namespaces this source covers: - policy//old, - permission//doc:read."
    )
    expect(within(dialog).queryByText(/Deleting a role/)).toBeNull()
  })

  it("says a role's assignments go when a deleted line past the first five is a role", async () => {
    const deleted = [...Array.from({ length: 5 }, (_, i) => `- policy//p${i + 1}`), "- role//late"]
    await mount({ plan: () => ({ ...VALID, deleted }) })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/^This deletes 6 entities/).textContent).toBe(
      "This deletes 6 entities in the namespaces this source covers: - policy//p1, - policy//p2, - policy//p3, - policy//p4, - policy//p5, and 1 more." +
        " Deleting a role also deletes its assignments and grants."
    )
  })

  it("asks for no second checkbox and warns of nothing when the plan deletes nothing", async () => {
    await mount({ plan: () => ({ ...VALID, deleted: [] }) })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByRole("checkbox")).toBeNull()
    expect(within(dialog).queryByText(/This deletes/)).toBeNull()
    expect(within(dialog).getByRole("button", { name: "Apply changes" })).toHaveProperty("disabled", false)
  })

  it("asks for no second checkbox when the plan was not a pruning plan", async () => {
    await mount({ plan: () => VALID })
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByRole("checkbox")).toBeNull()
    expect(within(dialog).queryByText(/This deletes/)).toBeNull()
  })

  it("unticks the second checkbox each time the dialog opens", async () => {
    await mount({ plan: () => VALID })
    fireEvent.click(pruneSwitch())
    await plan()
    fireEvent.click(button("Apply"))
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "I have read the deletions" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(button("Apply"))
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByRole("button", { name: "Apply changes" })).toHaveProperty("disabled", true)
  })
})

describe("WardenSchemaPage: apply", () => {
  it("asks with the planned counts, and sends the text, prune value and digest on confirm", async () => {
    const { sent } = await mount({ plan: () => VALID, apply: () => APPLIED })
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Apply 1 creation, 1 change and 1 deletion to your tenant?")
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }))
    await waitFor(() => expect(sent.some((s) => s.intent === "schema.apply")).toBe(true))
    expect(sent.find((s) => s.intent === "schema.apply")?.payload).toEqual({
      source: EXPORT,
      prune: false,
      digest: DIGEST,
    })
  })

  it("pluralises the counts", async () => {
    await mount({
      plan: () => ({ ...VALID, created: ["+ a", "+ b"], updated: [], deleted: [] }),
      apply: () => APPLIED,
    })
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Apply 2 creations, 0 changes and 0 deletions to your tenant?")
    ).toBeTruthy()
  })

  it("does nothing on Cancel", async () => {
    const { sent } = await mount({ plan: () => VALID, apply: () => APPLIED })
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent.some((s) => s.intent === "schema.apply")).toBe(false)
  })

  it("is pending while the apply is in flight", async () => {
    let release: (a: Applied) => void = () => {}
    const made = scripted({ plan: () => VALID })
    const client = {
      ...made.client,
      command: () => new Promise<Applied>((resolve) => (release = resolve)),
    } as ScopedClient
    renderPage(WardenSchemaPage, client)
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }))
    expect(await within(dialog).findByRole("button", { name: "Working…" })).toHaveProperty(
      "disabled",
      true
    )
    await act(async () => release(APPLIED))
  })
})

describe("WardenSchemaPage: results", () => {
  it("says what was written, lists it, and reloads the export", async () => {
    const { sent } = await mount({
      exports: [EXPORT, EXPORT_AFTER],
      plan: () => VALID,
      apply: () => APPLIED,
    })
    await plan()
    fireEvent.click(button("Apply"))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply changes" })
    )
    expect(await screen.findByText("Applied: 1 created, 1 changed, 1 deleted.")).toBeTruthy()
    const result = screen.getByRole("region", { name: "Apply result" })
    for (const line of APPLIED.created.concat(APPLIED.updated, APPLIED.deleted)) {
      expect(within(result).getByText(line).className).toContain("font-mono")
    }
    await waitFor(() => expect(docText()).toBe(EXPORT_AFTER))
    expect(sent.filter((s) => s.intent === "schema.export")).toHaveLength(2)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    // The plan was spent by the apply, so the page does not offer it again.
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("does not say the store diverged when it did not", async () => {
    await mount({ plan: () => VALID, apply: () => APPLIED })
    await plan()
    fireEvent.click(button("Apply"))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply changes" })
    )
    await screen.findByText("Applied: 1 created, 1 changed, 1 deleted.")
    expect(screen.queryByText(/The store changed while this apply ran/)).toBeNull()
  })

  it("says so, and what was written, when the store diverged from the plan", async () => {
    await mount({
      plan: () => VALID,
      apply: () => ({ ...APPLIED, created: [], updated: ["~ role//viewer (name)"], deleted: [], diverged: true }),
    })
    await plan()
    fireEvent.click(button("Apply"))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply changes" })
    )
    expect(await screen.findByText("Applied: 0 created, 1 changed, 0 deleted.")).toBeTruthy()
    const result = screen.getByRole("region", { name: "Apply result" })
    expect(within(result).getByText("~ role//viewer (name)")).toBeTruthy()
    expect(
      within(result).getByText(
        "The store changed while this apply ran, so what was written differs from the plan. The lines above are what was written."
      )
    ).toBeTruthy()
  })
})

describe("WardenSchemaPage: results, diverged with nothing written", () => {
  it("says nothing was written, not that the lines above were", async () => {
    await mount({
      plan: () => VALID,
      apply: () => ({ created: [], updated: [], deleted: [], noOps: 6, diverged: true }),
    })
    await plan()
    fireEvent.click(button("Apply"))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply changes" })
    )
    expect(await screen.findByText("Applied: 0 created, 0 changed, 0 deleted.")).toBeTruthy()
    const result = screen.getByRole("region", { name: "Apply result" })
    expect(
      within(result).getByText(
        "The store changed while this apply ran, so what was written differs from the plan. Nothing was written."
      )
    ).toBeTruthy()
    expect(within(result).queryByText(/The lines above/)).toBeNull()
  })

  it("drops the result when you load the current schema", async () => {
    await mount({ exports: [EXPORT, EXPORT_AFTER, EXPORT_AFTER], plan: () => VALID, apply: () => APPLIED })
    await plan()
    fireEvent.click(button("Apply"))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply changes" })
    )
    await screen.findByText("Applied: 1 created, 1 changed, 1 deleted.")
    await waitFor(() => expect(docText()).toBe(EXPORT_AFTER))
    fireEvent.click(button("Load current schema"))
    await waitFor(() => expect(screen.queryByText(/^Applied:/)).toBeNull())
    expect(screen.queryByRole("region", { name: "Apply result" })).toBeNull()
  })
})

describe("WardenSchemaPage: refusals stay in the dialog", () => {
  async function refused(error: ContractError) {
    const made = await mount({
      plan: () => VALID,
      apply: () => {
        throw error
      },
    })
    await plan()
    fireEvent.click(button("Apply"))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }))
    return { dialog, ...made }
  }

  it("CONFLICT says the schema changed and to plan again", async () => {
    const { dialog } = await refused(new ContractError("CONFLICT", "the schema changed since you planned: plan again"))
    expect(
      await within(dialog).findByText("The schema changed since you planned. Plan again to see the current diff.")
    ).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBe(dialog)
  })

  it("INTERNAL from a half apply says the apply stopped, and that what was written is kept", async () => {
    const { dialog } = await refused(
      new ContractError("INTERNAL", "the apply stopped part way: delete role r1: store unavailable")
    )
    expect(
      await within(dialog).findByText(
        "The apply stopped with an error: delete role r1: store unavailable. Changes written before the error are kept; plan again to see what remains."
      )
    ).toBeTruthy()
  })

  it("any other error shows its own message", async () => {
    const { dialog } = await refused(
      new ContractError("PERMISSION_DENIED", "missing permission manage on warden:policy")
    )
    expect(await within(dialog).findByText("missing permission manage on warden:policy")).toBeTruthy()
    expect(within(dialog).queryByText(/The apply stopped with an error/)).toBeNull()
  })

  it("an INTERNAL that is not a half apply shows its own message, not the half-apply sentence", async () => {
    const { dialog } = await refused(new ContractError("INTERNAL", "boom"))
    expect(await within(dialog).findByText("boom")).toBeTruthy()
    expect(within(dialog).queryByText(/The apply stopped with an error/)).toBeNull()
  })

  it("does not reload the export or show a result after a refusal", async () => {
    const { dialog, sent } = await refused(new ContractError("CONFLICT", "x"))
    await within(dialog).findByText("The schema changed since you planned. Plan again to see the current diff.")
    expect(sent.filter((s) => s.intent === "schema.export")).toHaveLength(1)
    expect(screen.queryByText(/^Applied:/)).toBeNull()
  })

  it("spends the plan after a conflict", async () => {
    const { dialog } = await refused(new ContractError("CONFLICT", "x"))
    await within(dialog).findByText(/^The schema changed since you planned/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("spends the plan after a half apply", async () => {
    const { dialog } = await refused(new ContractError("INTERNAL", "the apply stopped part way: boom"))
    await within(dialog).findByText(/^The apply stopped with an error/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("spends the plan after a bad request, so Apply does not repeat the same refusal", async () => {
    const { dialog } = await refused(new ContractError("BAD_REQUEST", "the source has an error at line 1, column 1: x"))
    await within(dialog).findByText(/^the source has an error/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(button("Apply")).toHaveProperty("disabled", true)
  })

  it("keeps the plan after a refusal that says nothing changed", async () => {
    const { dialog } = await refused(new ContractError("PERMISSION_DENIED", "no"))
    await within(dialog).findByText("no")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(button("Apply")).toHaveProperty("disabled", false)
  })
})

describe("diagnosticOffset", () => {
  const doc = (text: string) => EditorState.create({ doc: text }).doc

  it("takes line and column, both 1-based, to a document offset", () => {
    const d = doc("abc\ndef ghi\n")
    expect(diagnosticOffset(d, 1, 1)).toBe(0)
    expect(diagnosticOffset(d, 2, 5)).toBe(4 + 4)
  })

  it("counts the column in UTF-8 bytes, not UTF-16 units", () => {
    // "é" is two bytes and one unit; "日" is three bytes and one unit;
    // "😀" is four bytes and two units.
    const d = doc('x = "é日😀" y')
    const line = d.line(1).text
    // Bytes before `y`: x, space, =, space, quote (5) + é (2) + 日 (3) + 😀 (4) + quote, space (2) = 16.
    expect(diagnosticOffset(d, 1, 17)).toBe(line.indexOf("y"))
    // The column of the `=` is unaffected by what follows it.
    expect(diagnosticOffset(d, 1, 3)).toBe(2)
  })

  it("rounds a column inside a character down to the start of that character", () => {
    const d = doc("é日x")
    expect(diagnosticOffset(d, 1, 2)).toBe(0)
    expect(diagnosticOffset(d, 1, 3)).toBe(1)
    expect(diagnosticOffset(d, 1, 4)).toBe(1)
    expect(diagnosticOffset(d, 1, 6)).toBe(2)
  })

  it("clamps a column past the end of the line to the end of that line", () => {
    const d = doc("abc\ndef")
    expect(diagnosticOffset(d, 1, 99)).toBe(3)
    expect(diagnosticOffset(d, 2, 99)).toBe(7)
  })

  it("clamps a line past the end of the document to the last line", () => {
    const d = doc("abc\ndef")
    expect(diagnosticOffset(d, 9, 1)).toBe(4)
    expect(diagnosticOffset(d, 0, 1)).toBe(0)
  })

  it("marks the diagnostic where a multi-byte character comes first on the line", async () => {
    const src = 'name = "é" oops\n'
    await mount({ exports: [src], plan: () => ({ ...INVALID, diagnostics: [{ line: 1, col: 13, message: "bad" }] }) })
    await plan()
    const marks = diagnosticsOf(view().state)
    expect(marks).toHaveLength(1)
    expect(view().state.sliceDoc(marks[0].from, marks[0].to)).toBe("oops")
  })
})

describe("the schema page is loaded lazily", () => {
  interface GlobbingImportMeta {
    glob: (
      pattern: string,
      options: { query?: string; eager?: boolean }
    ) => Record<string, { default: string } | string>
  }
  const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/index.tsx", {
    query: "?raw",
    eager: true,
  })
  const entry = (() => {
    const mod = modules["../src/index.tsx"]
    return typeof mod === "string" ? mod : mod.default
  })()

  it("reaches the page from the plugin entry through lazy(), not a static import", () => {
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/schema"\)\)/)
    expect(entry).not.toMatch(/^import[^\n]*["']\.\/pages\/schema["']/m)
  })
})
