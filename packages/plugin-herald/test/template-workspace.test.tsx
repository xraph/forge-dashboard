import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TemplateWorkspacePage } from "../src/pages/template-workspace"
import type { TemplatesDetailResponse, VariableWire, VersionWire } from "../src/wire"
import { engine, templateDetail } from "./data"
import { invalidatingClient, renderPage, stubClient } from "./harness"

vi.mock("../src/components/editor/code-editor", async () => ({ default: (await import("./editor-stand-in")).EditorStandIn }))
vi.mock("../src/components/editor/field-diff", async () => ({ default: (await import("./editor-stand-in")).DiffStandIn }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const base = templateDetail()
const FR: VersionWire = { id: "htpv_01j00000000000000000000027", locale: "fr", subject: "Votre reçu", html: "", text: "Bonjour", title: "", active: false, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" }
const TEMPLATE = templateDetail({ versions: [...base.versions, FR] })
const EN = TEMPLATE.versions[1]
const DETAIL: TemplatesDetailResponse = { template: TEMPLATE, resolution: [] }
const VERSION_WRITE = ["templates.list", "templates.detail", "templates.resolve", "overview.stats"]
const TEMPLATE_WRITE = [...VERSION_WRITE, "preferences.get"]
const SENDER = { provider: { id: "hpvd_01j00000000000000000000001", name: "Primary SMTP", driver: "smtp", enabled: true }, via: "app", from: { email: "hello@example.com", name: "Example" } }

const withVersion = (d: TemplatesDetailResponse, v: VersionWire): TemplatesDetailResponse => ({ ...d, template: { ...d.template, versions: d.template.versions.map((x) => (x.id === v.id ? v : x)) } })
const withVariables = (d: TemplatesDetailResponse, variables: VariableWire[]): TemplatesDetailResponse => ({ ...d, template: { ...d.template, variables } })

type Detail = (input: Record<string, unknown>, call: number) => unknown

function open(detail: Detail = () => DETAIL, commands: Parameters<typeof invalidatingClient>[1] = {}) {
  const harness = invalidatingClient({ "engine.info": engine(), "templates.detail": detail, "templates.render": { fields: [], diagnostics: [] }, "send.resolve": SENDER }, commands)
  renderPage(TemplateWorkspacePage, harness.client, { id: TEMPLATE.id })
  return harness
}

const review = () => screen.getByRole("button", { name: /^Review/ })
const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
async function htmlEditor() {
  fireEvent.click(await screen.findByRole("tab", { name: "HTML" }))
  return screen.findByLabelText("HTML (en)")
}
const renders = (queried: { intent: string; params: Record<string, unknown> }[]) => queried.filter((q) => q.intent === "templates.render")

describe("TemplateWorkspacePage", () => {
  it("says there's nothing to show without an ID, under the app line", async () => {
    renderPage(TemplateWorkspacePage, stubClient({ "engine.info": engine() }), {})
    expect(screen.getByText("No template ID in the address, so there is nothing to show.")).toBeTruthy()
    expect(await screen.findByText("app_demo")).toBeTruthy()
  })

  it("names the template, its slug, channel and origin, and opens on the default locale's version", async () => {
    open()
    expect(await screen.findByRole("heading", { name: "Receipt" })).toBeTruthy()
    expect(screen.getByText("billing.receipt").className).toContain("font-mono")
    expect(screen.getByText("Custom")).toBeTruthy()
    expect(await screen.findByLabelText("Subject (en)")).toBeTruthy()
    expect(within(screen.getByRole("complementary", { name: "Locales" })).getByRole("button", { name: /^en/ }).getAttribute("aria-current")).toBe("true")
  })

  it("shows the sender the routing rules pick above the rendered email", async () => {
    open()
    expect(await screen.findByText("Example <hello@example.com>")).toBeTruthy()
  })

  it("saves only the changed field of the changed version, then says so", async () => {
    const saved = { ...EN, html: "<p>New</p>" }
    const { sent } = open((_i, call) => (call === 0 ? DETAIL : withVersion(DETAIL, saved)), { "versions.update": { answer: { version: saved }, invalidates: VERSION_WRITE } })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>New</p>" } })
    expect(review().textContent).toBe("Review 1 change")
    fireEvent.click(save())
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.update", payload: { templateId: TEMPLATE.id, versionId: EN.id, html: "<p>New</p>" } }]))
    expect(await screen.findByText("Saved.")).toBeTruthy()
    expect((review() as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps an unsaved edit when another version goes live and the template reloads", async () => {
    const live = { ...FR, active: true }
    const { sent } = open((_i, call) => (call === 0 ? DETAIL : withVersion(DETAIL, live)), { "versions.update": { answer: { version: live }, invalidates: VERSION_WRITE } })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>Mine</p>" } })
    fireEvent.click(screen.getByRole("switch", { name: "Live: fr version" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Put live" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.update", payload: { templateId: TEMPLATE.id, versionId: FR.id, active: true } }]))
    await waitFor(() => expect(within(screen.getByRole("complementary", { name: "Locales" })).getAllByText("Live")).toHaveLength(3))
    expect((screen.getByLabelText("HTML (en)") as HTMLTextAreaElement).value).toBe("<p>Mine</p>")
    expect(review().textContent).toBe("Review 1 change")
  })

  it("says what was saved when a save stops partway, and keeps the rest unsaved", async () => {
    const saved = { ...EN, html: "<p>New</p>" }
    const { sent } = open((_i, call) => (call === 0 ? DETAIL : withVersion(DETAIL, saved)), {
      "versions.update": { answer: { version: saved }, invalidates: VERSION_WRITE },
      "templates.update": new ContractError("BAD_REQUEST", "category must be auth, transactional, marketing or system"),
    })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>New</p>" } })
    fireEvent.click(screen.getByRole("tab", { name: /Settings/ }))
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Receipts" } })
    fireEvent.click(save())
    expect(await screen.findByText("Saved the en version. The rest is still unsaved.")).toBeTruthy()
    expect(screen.getByText(/category must be auth/)).toBeTruthy()
    expect(screen.queryByText("Saved.")).toBeNull()
    expect(sent.map((s) => s.intent)).toEqual(["versions.update", "templates.update"])
    await waitFor(() => expect(review().textContent).toBe("Review 1 change"))
    expect(save().disabled).toBe(false)
  })

  it("keeps rendering with the last sample data that parsed", async () => {
    const { queried } = open()
    fireEvent.change(await screen.findByLabelText("Sample data"), { target: { value: "{nope" } })
    expect(await screen.findByText(/^Not valid JSON: .* The preview uses the last sample data that parsed\.$/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Subject (en)"), { target: { value: "Changed" } })
    await waitFor(() => expect((renders(queried).at(-1)?.params.content as { subject: string }).subject).toBe("Changed"))
    expect(renders(queried).at(-1)?.params.data).toEqual({ customer_name: "example customer name", amount: "example amount", invoice_url: "https://example.com/" })
  })

  it("sends edited variables to the preview at once and saves them", async () => {
    const edited: VariableWire[] = [
      { name: "customer_name", type: "string", required: true, default: "", description: "" },
      { name: "total", type: "string", required: true, default: "", description: "" },
      { name: "invoice_url", type: "url", required: false, default: "", description: "" },
    ]
    const { sent, queried } = open((_i, call) => (call === 0 ? DETAIL : withVariables(DETAIL, edited)), { "templates.update": { answer: { template: TEMPLATE }, invalidates: TEMPLATE_WRITE } })
    await screen.findByLabelText("Subject (en)")
    fireEvent.click(screen.getByRole("tab", { name: /Variables/ }))
    fireEvent.change(await screen.findByLabelText("Name of variable 2"), { target: { value: "total" } })
    expect(screen.getByRole("tab", { name: /Variables/ }).textContent).toContain("edited")
    fireEvent.click(screen.getByRole("tab", { name: /Content/ }))
    await waitFor(() => expect(renders(queried).at(-1)?.params.variables).toEqual(expect.arrayContaining([expect.objectContaining({ name: "total" })])))
    fireEvent.click(save())
    await waitFor(() => expect(sent).toEqual([{ intent: "templates.update", payload: { id: TEMPLATE.id, variables: edited } }]))
    expect(await screen.findByText("Saved.")).toBeTruthy()
  })

  it("holds Save while a variable name is invalid and says why", async () => {
    open()
    await screen.findByLabelText("Subject (en)")
    fireEvent.click(screen.getByRole("tab", { name: /Variables/ }))
    fireEvent.change(await screen.findByLabelText("Name of variable 1"), { target: { value: "1st" } })
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Fix the variables before saving.")).toBeTruthy()
  })

  it("asks before leaving only while there are unsaved edits", async () => {
    open()
    const editor = await htmlEditor()
    const clean = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(editor, { target: { value: "<p>Unsaved</p>" } })
    const dirty = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const link = document.createElement("a")
    link.href = "/elsewhere"
    document.body.appendChild(link)
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledWith("This template has edits that aren't saved. Leave the page and lose them?")
    link.remove()
  })

  it("keeps the page and its edits when a reload fails, and says so", async () => {
    open((_i, call) => (call === 0 ? DETAIL : new ContractError("UNAVAILABLE", "store is down")), { "versions.update": { answer: { version: { ...FR, active: true } }, invalidates: VERSION_WRITE } })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>Mine</p>" } })
    fireEvent.click(screen.getByRole("switch", { name: "Live: fr version" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Put live" }))
    expect(await screen.findByText(/This template didn't reload: UNAVAILABLE: store is down\. Your edits are still on the page\./)).toBeTruthy()
    expect((screen.getByLabelText("HTML (en)") as HTMLTextAreaElement).value).toBe("<p>Mine</p>")
    expect(review().textContent).toBe("Review 1 change")
  })
})
