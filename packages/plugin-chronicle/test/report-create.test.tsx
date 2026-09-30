import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ReportCreatePage } from "../src/pages/report-create"
import { scriptedClient } from "./harness"

const generated = {
  id: "report_new",
  report: { id: "report_new", title: "SOC 2", type: "soc2", period: { from: "", to: "" }, generatedBy: "user_admin", format: "json", createdAt: "2026-09-29T10:00:00Z" },
}

function renderCreate(client: ScopedClient) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate }}>
        <ReportCreatePage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const from = (v: string) => fireEvent.change(screen.getByLabelText("Period start"), { target: { value: v } })
const to = (v: string) => fireEvent.change(screen.getByLabelText("Period end"), { target: { value: v } })
const go = () => screen.getByRole("button", { name: "Generate report" }) as HTMLButtonElement

describe("ReportCreatePage", () => {
  it("offers the three types the server generates, sent as it spells them", () => {
    renderCreate(scriptedClient({}).client)
    const select = screen.getByLabelText("Report type") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["soc2", "SOC 2"],
      ["hipaa", "HIPAA"],
      ["euaiact", "EU AI Act"],
    ])
  })

  it("sends the type alone when no period is given, which means the last 90 days", async () => {
    const c = scriptedClient({}, { "reports.generate": generated })
    renderCreate(c.client)
    fireEvent.change(screen.getByLabelText("Report type"), { target: { value: "euaiact" } })
    expect(screen.getByText("Leave both empty for the last 90 days.")).toBeTruthy()
    fireEvent.click(go())
    await waitFor(() => expect(c.sent).toEqual([{ intent: "reports.generate", payload: { type: "euaiact" } }]))
  })

  it("sends a period as RFC3339 covering both whole days", async () => {
    const c = scriptedClient({}, { "reports.generate": generated })
    renderCreate(c.client)
    from("2026-07-01")
    to("2026-09-30")
    fireEvent.click(go())
    await waitFor(() =>
      expect(c.sent).toEqual([
        { intent: "reports.generate", payload: { type: "soc2", period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T23:59:59Z" } } },
      ]),
    )
  })

  it("refuses one date without the other", () => {
    renderCreate(scriptedClient({}).client)
    from("2026-07-01")
    expect(screen.getByText("Give both dates, or neither for the last 90 days.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    from("")
    to("2026-09-30")
    expect(screen.getByText("Give both dates, or neither for the last 90 days.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    from("2026-07-01")
    expect(go().disabled).toBe(false)
  })

  it("refuses an end before the start, and allows a single day", () => {
    renderCreate(scriptedClient({}).client)
    from("2026-09-30")
    to("2026-07-01")
    expect(screen.getByText("The end date cannot be before the start date.")).toBeTruthy()
    expect(go().disabled).toBe(true)
    to("2026-09-30")
    expect(go().disabled).toBe(false)
  })

  it("sends nothing when Enter submits a form that is not ready", async () => {
    const c = scriptedClient({}, { "reports.generate": generated })
    renderCreate(c.client)
    from("2026-07-01")
    fireEvent.submit(go().closest("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 10))
    expect(c.sent).toEqual([])
  })

  it("goes to the new report's page after generating it", async () => {
    const c = scriptedClient({}, { "reports.generate": generated })
    const { navigate } = renderCreate(c.client)
    fireEvent.click(go())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/reports/report_new"))
  })

  it.each([
    ["PERMISSION_DENIED", "requires scope chronicle.write"],
    ["UNAVAILABLE", "report generation is not configured on this deployment"],
  ])("shows %s with its message and stays put", async (code, message) => {
    const c = scriptedClient({}, { "reports.generate": new ContractError(code as "UNAVAILABLE", message) })
    const { navigate } = renderCreate(c.client)
    fireEvent.click(go())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain(code)
    expect(alert.textContent).toContain(message)
    expect(navigate).not.toHaveBeenCalled()
    // Nothing was lost, so the operator can try again.
    expect((screen.getByLabelText("Report type") as HTMLSelectElement).value).toBe("soc2")
  })
})
