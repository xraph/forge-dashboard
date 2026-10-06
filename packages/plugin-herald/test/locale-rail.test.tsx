import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { LocaleRail } from "../src/workspace/locale-rail"
import type { LocaleRailProps } from "../src/workspace/locale-rail"
import type { TemplatesResolveResponse, VersionWire } from "../src/wire"
import { templateDetail } from "./data"
import { scriptedClient } from "./harness"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const FR: VersionWire = { id: "htpv_01j00000000000000000000027", locale: "fr", subject: "Votre reçu", html: "", text: "Bonjour", title: "", active: false, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" }
const base = templateDetail()
const detail = templateDetail({ versions: [...base.versions, FR] })
const [FALLBACK, EN] = detail.versions

function setup(over: Partial<LocaleRailProps> = {}, commands: Record<string, object> = {}, queries: Record<string, object> = {}) {
  const onSelect = vi.fn()
  const onCreated = vi.fn()
  const { client, sent, queried } = scriptedClient(
    { ...queries },
    { "versions.update": { version: EN }, "versions.delete": { ok: true, id: EN.id }, "versions.create": { version: { ...FR, id: "htpv_new", locale: "de" } }, ...commands },
  )
  render(
    <PluginProvider client={client}>
      <LocaleRail template={detail} selectedId={EN.id} onSelect={onSelect} dirtyIds={new Set()} copyFrom={{ subject: "S", html: "H", text: "T", title: "" }} copyName="the en version" onCreated={onCreated} {...over} />
    </PluginProvider>
  )
  return { onSelect, onCreated, sent, queried }
}

const rail = () => screen.getByRole("complementary", { name: "Locales" })
const dialog = () => screen.getByRole("alertdialog")

describe("LocaleRail", () => {
  it("lists each version with its state and what a live one answers", () => {
    setup()
    const items = within(rail()).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText("Fallback")).toBeTruthy()
    expect(within(items[0]).getByText("Live").getAttribute("data-variant")).toBe("outline")
    expect(within(items[0]).getByText("Answers any locale no other live version takes")).toBeTruthy()
    expect(items[1].textContent).toContain("Answers en, and en-* without a live version of its own")
    expect(within(items[2]).getByText("Inactive").getAttribute("data-variant")).toBe("secondary")
    expect(items[2].textContent).not.toContain("Answers")
  })

  it("marks the selected version and selects another on click", () => {
    const { onSelect } = setup()
    expect(within(rail()).getByRole("button", { name: /^en/ }).getAttribute("aria-current")).toBe("true")
    fireEvent.click(within(rail()).getByRole("button", { name: /^fr/ }))
    expect(onSelect).toHaveBeenCalledWith(FR.id)
  })

  it("marks a version with unsaved edits", () => {
    setup({ dirtyIds: new Set([EN.id]) })
    expect(within(rail()).getByRole("button", { name: /^en/ }).textContent).toContain("edited")
  })

  it("says what will answer en before taking it offline, then sends only the switch", async () => {
    const { sent } = setup()
    fireEvent.click(screen.getByRole("switch", { name: "Live: en version" }))
    expect(within(dialog()).getByText("Take en offline?")).toBeTruthy()
    expect(within(dialog()).getByText("A request for en will then get the fallback version.")).toBeTruthy()
    expect(within(dialog()).getByRole("button", { name: "Take offline" }).className.split(/\s+/)).toContain("text-destructive")
    fireEvent.click(within(dialog()).getByRole("button", { name: "Take offline" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.update", payload: { templateId: detail.id, versionId: EN.id, active: false } }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("puts a version live without painting the confirm as destructive", () => {
    setup()
    fireEvent.click(screen.getByRole("switch", { name: "Live: fr version" }))
    expect(within(dialog()).getByText("Put fr live?")).toBeTruthy()
    expect(within(dialog()).getByText("A request for fr will then get the fr version.")).toBeTruthy()
    // The kit Button has no data-variant; the destructive variant is its text-destructive class.
    expect(within(dialog()).getByRole("button", { name: "Put live" }).className.split(/\s+/)).not.toContain("text-destructive")
  })

  it("says sends will fail before taking the fallback offline", () => {
    setup()
    fireEvent.click(screen.getByRole("switch", { name: "Live: fallback version" }))
    expect(within(dialog()).getByText("A send in a locale with no live version of its own will then fail.")).toBeTruthy()
  })

  it("names what answers after a delete and that unsaved edits go too", async () => {
    const { sent } = setup({ dirtyIds: new Set([EN.id]) })
    fireEvent.click(screen.getByRole("button", { name: "Delete en version" }))
    expect(within(dialog()).getByText("Delete the en version?")).toBeTruthy()
    expect(within(dialog()).getByText("A request for en will then get the fallback version. Its content is deleted and can't be brought back. Its unsaved edits go with it.")).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete version" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.delete", payload: { templateId: detail.id, versionId: EN.id } }]))
  })

  it("keeps the dialog open with the refusal when a delete fails", async () => {
    setup({}, { "versions.delete": new ContractError("NOT_FOUND", "template version not found") })
    fireEvent.click(screen.getByRole("button", { name: "Delete en version" }))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete version" }))
    expect(await within(dialog()).findByText("template version not found")).toBeTruthy()
  })

  it("adds an inactive locale from the selected version's content", async () => {
    const { sent, onCreated } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "de" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add locale" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.create", payload: { templateId: detail.id, locale: "de", subject: "S", html: "H", text: "T", title: "", active: false } }]))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "htpv_new", locale: "de" })))
  })

  it("starts a new locale empty when asked to", async () => {
    const { sent } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.click(within(form).getByRole("checkbox", { name: "Start from the en version's content" }))
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "de" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add locale" }))
    await waitFor(() => expect(sent[0]?.payload).toEqual({ templateId: detail.id, locale: "de", subject: "", html: "", text: "", title: "", active: false }))
  })

  it("refuses a malformed or taken locale before the round trip", async () => {
    const { sent } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "e" } })
    expect(within(form).getByText("A locale is a tag like en or pt-BR.")).toBeTruthy()
    expect((within(form).getByRole("button", { name: "Add locale" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "fr" } })
    expect(within(form).getByText("This template already has a fr version.")).toBeTruthy()
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "" } })
    expect(within(form).getByText("This template already has a fallback version.")).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("shows the server's refusal inside the add dialog", async () => {
    setup({}, { "versions.create": new ContractError("CONFLICT", "this template already has a version for that locale") })
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "de" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add locale" }))
    expect(await within(form).findByText("this template already has a version for that locale")).toBeTruthy()
  })
})

describe("Test a locale", () => {
  const FALLS_BACK: TemplatesResolveResponse = {
    locale: "fr-CA",
    steps: [
      { try: "fr-CA", match: "exact", found: false },
      { try: "fr", match: "language", found: false },
      { try: "", match: "default", found: true, versionId: FALLBACK.id },
    ],
    versionId: FALLBACK.id,
    match: "default",
  }

  it("asks the server 300ms after typing stops and draws each step", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { queried } = setup({}, {}, { "templates.resolve": FALLS_BACK })
    fireEvent.change(screen.getByLabelText("Test a locale"), { target: { value: "fr-CA" } })
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(queried.filter((q) => q.intent === "templates.resolve")).toEqual([])
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await waitFor(() => expect(queried.filter((q) => q.intent === "templates.resolve").map((q) => q.params)).toEqual([{ id: detail.id, locale: "fr-CA" }]))
    const ladder = await screen.findByRole("list", { name: "How fr-CA resolves" })
    const steps = within(ladder).getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual([
      "Tries fr-CANo live version.",
      "Tries fr (its language)No live version.",
      "Tries the fallbackA live version answers.",
      "Answered by the fallback version.",
    ])
  })

  it("ends in a failure when nothing answers", async () => {
    setup({}, {}, { "templates.resolve": { locale: "de", steps: [{ try: "de", match: "exact", found: false }, { try: "", match: "default", found: false }], versionId: null, match: "none" } })
    fireEvent.change(screen.getByLabelText("Test a locale"), { target: { value: "de" } })
    expect(await screen.findByText(/Nothing answers it, so a send in/)).toBeTruthy()
  })

  it("says a malformed locale is malformed and asks nothing", async () => {
    const { queried } = setup({}, {}, { "templates.resolve": FALLS_BACK })
    fireEvent.change(screen.getByLabelText("Test a locale"), { target: { value: "f" } })
    expect(await screen.findByText("A locale is a tag like en or pt-BR.")).toBeTruthy()
    expect(queried.filter((q) => q.intent === "templates.resolve")).toEqual([])
  })
})
