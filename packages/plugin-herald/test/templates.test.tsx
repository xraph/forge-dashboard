import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { TemplatesPage, TemplatesWithoutFallbackPage } from "../src/pages/templates"
import { engine, templateSummary } from "./data"
import { invalidatingClient, recordingQueryClient, renderPage, scriptedClient } from "./harness"

const LIST = {
  templates: [
    templateSummary(),
    templateSummary({ id: "htpl_01j00000000000000000000011", slug: "auth.welcome", name: "Welcome Email", category: "auth", isSystem: true, hasFallback: false, locales: [{ locale: "en", active: true }] }),
    templateSummary({ id: "htpl_01j00000000000000000000016", slug: "ops.digest", name: "Daily digest", category: "system", enabled: false, locales: [] }),
  ],
}

describe("TemplatesPage", () => {
  it("asks for every template first, sending no empty filters", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "templates.list": LIST })
    renderPage(TemplatesPage, client)
    await screen.findByText("3 templates")
    expect(sent.find((s) => s.intent === "templates.list")?.params).toEqual({})
  })

  it("sends only the filters you set", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "templates.list": LIST })
    renderPage(TemplatesPage, client)
    await screen.findByText("3 templates")
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sms" } })
    fireEvent.change(screen.getByLabelText("Fallback"), { target: { value: "missing" } })
    await waitFor(() => expect(sent.filter((s) => s.intent === "templates.list").map((s) => s.params)).toContainEqual({ channel: "sms", noFallback: true }))
  })

  it("shows slugs in mono, locales as tags with the inactive ones marked, and the fallback named", async () => {
    renderPage(TemplatesPage, recordingQueryClient({ "engine.info": engine(), "templates.list": LIST }).client)
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("Receipt"))!
    expect(within(row).getByText("billing.receipt").closest("td")?.className).toMatch(/font-mono text-xs/)
    expect(within(row).getByText("fallback")).toBeTruthy()
    expect(within(row).getByText("fr (inactive)")).toBeTruthy()
    const digest = screen.getAllByRole("row").find((r) => within(r).queryByText("Daily digest"))!
    expect(within(digest).getByLabelText("no versions")).toBeTruthy()
    expect(within(digest).getByText("Disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
    const welcome = screen.getAllByRole("row").find((r) => within(r).queryByText("Welcome Email"))!
    expect(within(welcome).getByText("System")).toBeTruthy()
    expect(within(welcome).getByRole("link", { name: "Welcome Email" }).getAttribute("href")).toBe("/templates/htpl_01j00000000000000000000011")
  })

  it("tells nothing-here from nothing-matching", async () => {
    renderPage(TemplatesPage, recordingQueryClient({ "engine.info": engine(), "templates.list": { templates: [] } }).client)
    expect(await screen.findByText(/No templates yet/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "auth" } })
    expect(await screen.findByText("No templates match these filters.")).toBeTruthy()
  })

  it("names the app and keeps the header when the list fails", async () => {
    renderPage(TemplatesPage, scriptedClient({ "engine.info": engine() }).client)
    expect(await screen.findByRole("heading", { level: 1, name: "Templates" })).toBeTruthy()
    expect(await screen.findByText("app_demo")).toBeTruthy()
    expect(await screen.findByRole("alert")).toBeTruthy()
  })

  it("resets the system templates behind a confirm that says custom ones are kept", async () => {
    const c = scriptedClient({ "engine.info": engine(), "templates.list": LIST }, { "templates.resetDefaults": { deleted: 4, seeded: 4 } })
    renderPage(TemplatesPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Reset system templates" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/Custom templates are kept/)
    expect(dialog.textContent).toMatch(/edits you made to system templates are lost/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "templates.resetDefaults", payload: {} }]))
    expect(await screen.findByText("Removed 4 system templates and seeded 4.")).toBeTruthy()
  })

  it("keeps the result note mounted and empty until the reset lands, so a screen reader announces it", async () => {
    const c = scriptedClient({ "engine.info": engine(), "templates.list": LIST }, { "templates.resetDefaults": { deleted: 4, seeded: 4 } })
    const { container } = renderPage(TemplatesPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Reset system templates" }))
    const note = container.querySelector('p[role="status"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toBe("")
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reset" }))
    await screen.findByText("Removed 4 system templates and seeded 4.")
    expect(container.querySelector('p[role="status"]')).toBe(note)
  })

  it("keeps the reset's result on screen through the list's own refetch", async () => {
    const { client, queried } = invalidatingClient(
      { "engine.info": engine(), "templates.list": (_input, call) => (call === 0 ? LIST : { templates: [templateSummary({ id: "htpl_01j00000000000000000000099", slug: "auth.reset", name: "Reseeded" })] }) },
      { "templates.resetDefaults": { answer: { deleted: 1, seeded: 1 }, invalidates: ["templates.list", "templates.detail", "templates.resolve", "overview.stats", "preferences.get"] } },
    )
    renderPage(TemplatesPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Reset system templates" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(queried.filter((q) => q.intent === "templates.list")).toHaveLength(2))
    expect(await screen.findByText("Reseeded")).toBeTruthy()
    expect(screen.getByText("Removed 1 system template and seeded 1.")).toBeTruthy()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})

describe("TemplatesWithoutFallbackPage", () => {
  it("opens filtered to templates without a fallback and says why that matters", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "templates.list": LIST })
    renderPage(TemplatesWithoutFallbackPage, client)
    expect(await screen.findByText(/fails for any locale it doesn't list/)).toBeTruthy()
    expect(sent.find((s) => s.intent === "templates.list")?.params).toEqual({ noFallback: true })
  })

  it("says every template has a fallback, not that a search failed, when none is missing one", async () => {
    const list = (p: Record<string, unknown>) => (p.noFallback ? { templates: [] } : LIST)
    renderPage(TemplatesWithoutFallbackPage, scriptedClient({ "engine.info": engine(), "templates.list": list }).client)
    expect(await screen.findByText("Every template has a fallback version.")).toBeTruthy()
    expect(screen.queryByText("No templates match these filters.")).toBeNull()
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sms" } })
    expect(await screen.findByText("No templates match these filters.")).toBeTruthy()
  })

  it("does not call an app with no templates fully covered", async () => {
    renderPage(TemplatesWithoutFallbackPage, scriptedClient({ "engine.info": engine(), "templates.list": { templates: [] } }).client)
    expect(await screen.findByText("This app has no templates yet.")).toBeTruthy()
    expect(screen.queryByText("Every template has a fallback version.")).toBeNull()
  })

  it("takes its title from the filter as it stands now: Any brings back Templates, and the filter brings the other back", async () => {
    renderPage(TemplatesWithoutFallbackPage, scriptedClient({ "engine.info": engine(), "templates.list": LIST }).client)
    expect(await screen.findByRole("heading", { level: 1, name: "Templates without a fallback" })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Fallback"), { target: { value: "" } })
    expect(screen.getByRole("heading", { level: 1, name: "Templates" })).toBeTruthy()
    expect(screen.getByText(/What Herald renders for each channel/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Fallback"), { target: { value: "missing" } })
    expect(screen.getByRole("heading", { level: 1, name: "Templates without a fallback" })).toBeTruthy()
    expect(screen.getByText(/fails for any locale it doesn't list/)).toBeTruthy()
  })

  it("titles the plain page for the filter too, once you pick the missing-fallback one", async () => {
    renderPage(TemplatesPage, scriptedClient({ "engine.info": engine(), "templates.list": LIST }).client)
    await screen.findByText("3 templates")
    fireEvent.change(screen.getByLabelText("Fallback"), { target: { value: "missing" } })
    expect(screen.getByRole("heading", { level: 1, name: "Templates without a fallback" })).toBeTruthy()
  })
})
