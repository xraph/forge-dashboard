import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { CustomReportCreatePage } from "../src/pages/custom-report-create"
import { scriptedClient } from "./harness"

const generated = {
  id: "report_custom",
  report: { id: "report_custom", title: "Access review", type: "custom", period: { from: "", to: "" }, generatedBy: "user_admin", format: "json", createdAt: "2026-09-29T10:00:00Z" },
}

function renderCreate(client: ScopedClient) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate }}>
        <CustomReportCreatePage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const go = () => screen.getByRole("button", { name: "Generate report" }) as HTMLButtonElement
const add = () => screen.getByRole("button", { name: "Add section" }) as HTMLButtonElement

function fillMinimum() {
  set("Title", "Access review")
  set("Section 1 title", "Sign-ins")
}

describe("CustomReportCreatePage", () => {
  it("cannot be sent without a title and a titled section", () => {
    renderCreate(scriptedClient({}).client)
    expect(go().disabled).toBe(true)
    set("Title", "Access review")
    expect(go().disabled).toBe(true)
    set("Section 1 title", "Sign-ins")
    expect(go().disabled).toBe(false)
    set("Section 1 title", "   ")
    expect(go().disabled).toBe(true)
  })

  it("holds a title to 200 characters, counting characters and not UTF-16 units", () => {
    renderCreate(scriptedClient({}).client)
    fillMinimum()
    set("Title", "x".repeat(201))
    expect(screen.getByText("A title is at most 200 characters.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    set("Title", "\u{1F600}".repeat(200))
    expect(screen.queryByText(/A title is at most/)).toBeNull()
    expect(go().disabled).toBe(false)
  })

  it("holds a section title to 200 and notes to 4,000 characters", () => {
    renderCreate(scriptedClient({}).client)
    fillMinimum()
    set("Section 1 title", "x".repeat(201))
    expect(screen.getByText("A section title is at most 200 characters.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    set("Section 1 title", "Sign-ins")
    set("Section 1 notes", "n".repeat(4001))
    expect(screen.getByText("Notes are at most 4000 characters.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    set("Section 1 notes", "n".repeat(4000))
    expect(go().disabled).toBe(false)
  })

  it("holds each filter list to 50 values of at most 128 characters", () => {
    renderCreate(scriptedClient({}).client)
    fillMinimum()
    const list = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`).join(", ")
    set("Section 1 categories", list(51))
    expect(screen.getByText("Filter on at most 50 categories.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    set("Section 1 categories", list(50))
    expect(go().disabled).toBe(false)
    set("Section 1 actions", `${"x".repeat(129)}, ok`)
    expect(screen.getByText("Each action can be at most 128 characters.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    set("Section 1 actions", "x".repeat(128))
    expect(go().disabled).toBe(false)
    set("Section 1 severity", list(51))
    expect(screen.getByText("Filter on at most 50 severity.")).toBeTruthy()
    expect(go().disabled).toBe(true)
  })

  it("does not count the empty values a trailing comma leaves", () => {
    renderCreate(scriptedClient({}).client)
    fillMinimum()
    set("Section 1 categories", Array.from({ length: 50 }, (_, i) => `a${i}`).join(",") + ", , ,")
    expect(go().disabled).toBe(false)
  })

  it("adds sections up to 20, then disables adding, and can remove one", () => {
    renderCreate(scriptedClient({}).client)
    expect(screen.getByText("1 of 20 sections.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Remove section 1" }) as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 19; i++) fireEvent.click(add())
    expect(screen.getByText("20 of 20 sections.")).toBeTruthy()
    expect(add().disabled).toBe(true)
    expect(screen.getByLabelText("Section 20 title")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Remove section 20" }))
    expect(screen.getByText("19 of 20 sections.")).toBeTruthy()
    expect(add().disabled).toBe(false)
    // Twenty full re-renders of the form. Under 1s alone, but past the 5s
    // default when `pnpm test` runs every package's suite at once.
  }, 20_000)

  it("keeps what was typed in the sections that stay when one is removed", () => {
    renderCreate(scriptedClient({}).client)
    set("Section 1 title", "First")
    fireEvent.click(add())
    set("Section 2 title", "Second")
    fireEvent.click(screen.getByRole("button", { name: "Remove section 1" }))
    expect((screen.getByLabelText("Section 1 title") as HTMLInputElement).value).toBe("Second")
  })

  it("needs every section titled, not just the first", () => {
    renderCreate(scriptedClient({}).client)
    fillMinimum()
    fireEvent.click(add())
    expect(go().disabled).toBe(true)
    set("Section 2 title", "Changes")
    expect(go().disabled).toBe(false)
  })

  it("sends the payload with empty lists and notes omitted", async () => {
    const c = scriptedClient({}, { "reports.generateCustom": generated })
    renderCreate(c.client)
    fillMinimum()
    fireEvent.click(go())
    await waitFor(() =>
      expect(c.sent).toEqual([{ intent: "reports.generateCustom", payload: { title: "Access review", sections: [{ title: "Sign-ins" }] } }]),
    )
    expect(Object.keys((c.sent[0].payload as { sections: object[] }).sections[0])).toEqual(["title"])
  })

  it("sends filters as trimmed lists, notes, sections in order, and a period", async () => {
    const c = scriptedClient({}, { "reports.generateCustom": generated })
    renderCreate(c.client)
    fillMinimum()
    set("Section 1 categories", " auth , data,, ")
    set("Section 1 actions", "login.failed")
    set("Section 1 severity", "warning, critical")
    set("Section 1 notes", "Failed and denied sign-ins.")
    fireEvent.click(add())
    set("Section 2 title", "Changes")
    fireEvent.change(screen.getByLabelText("Period start"), { target: { value: "2026-07-01" } })
    fireEvent.change(screen.getByLabelText("Period end"), { target: { value: "2026-09-30" } })
    fireEvent.click(go())
    await waitFor(() =>
      expect(c.sent).toEqual([
        {
          intent: "reports.generateCustom",
          payload: {
            title: "Access review",
            period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T23:59:59Z" },
            sections: [
              { title: "Sign-ins", categories: ["auth", "data"], actions: ["login.failed"], severity: ["warning", "critical"], notes: "Failed and denied sign-ins." },
              { title: "Changes" },
            ],
          },
        },
      ]),
    )
  })

  it("refuses one date without the other", () => {
    renderCreate(scriptedClient({}).client)
    fillMinimum()
    fireEvent.change(screen.getByLabelText("Period end"), { target: { value: "2026-09-30" } })
    expect(screen.getByText("Give both dates, or neither for the last 90 days.")).toBeTruthy()
    expect(go().disabled).toBe(true)
  })

  it("goes to the new report after generating it", async () => {
    const c = scriptedClient({}, { "reports.generateCustom": generated })
    const { navigate } = renderCreate(c.client)
    fillMinimum()
    fireEvent.click(go())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/reports/report_custom"))
  })

  it("shows the server's refusal with its message and code, and keeps the form", async () => {
    const c = scriptedClient({}, { "reports.generateCustom": new ContractError("BAD_REQUEST", "the title of section 1 can be at most 200 characters") })
    const { navigate } = renderCreate(c.client)
    fillMinimum()
    fireEvent.click(go())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("the title of section 1 can be at most 200 characters")
    expect(alert.textContent).toContain("BAD_REQUEST")
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Access review")
  })
})
