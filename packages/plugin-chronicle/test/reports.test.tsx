import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import { render } from "@testing-library/react"
import { ReportsPage } from "../src/pages/reports"
import { reportTypeLabel } from "../src/format"
import { renderPage, scriptedClient } from "./harness"
import type { ReportSummary } from "../src/types"

const summary = (
  n: number,
  over: Partial<ReportSummary> = {}
): ReportSummary => ({
  id: `report_${n}`,
  title: `SOC 2 evidence ${n}`,
  type: "soc2",
  period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
  generatedBy: "user_admin",
  format: "json",
  createdAt: "2026-09-29T10:00:00Z",
  ...over,
})

describe("reportTypeLabel", () => {
  it("names the four stored types", () => {
    expect(reportTypeLabel("soc2")).toBe("SOC 2")
    expect(reportTypeLabel("hipaa")).toBe("HIPAA")
    expect(reportTypeLabel("eu_ai_act")).toBe("EU AI Act")
    expect(reportTypeLabel("custom")).toBe("Custom")
  })

  it("shows a type it does not know exactly as sent", () => {
    expect(reportTypeLabel("pci_dss")).toBe("pci_dss")
  })
})

describe("ReportsPage", () => {
  it("lists reports in the order the server sent them, with a live caption and ids in mono", async () => {
    const c = scriptedClient({
      "reports.list": { reports: [summary(2), summary(1)], hasMore: false },
    })
    renderPage(ReportsPage, c.client)
    await screen.findByText("SOC 2 evidence 2")
    const titles = screen
      .getAllByRole("link")
      .map((l) => l.textContent)
      .filter((t) => t?.startsWith("SOC 2 evidence"))
    expect(titles).toEqual(["SOC 2 evidence 2", "SOC 2 evidence 1"])
    expect(screen.getByText("report_2").className).toContain("font-mono")
    expect(screen.getAllByText("user_admin")[0].className).toContain(
      "font-mono"
    )
    expect(screen.getByText("2 reports shown")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "SOC 2 evidence 2" })
        .getAttribute("href")
    ).toBe("/reports/report_2")
    expect(c.queried).toEqual([
      { intent: "reports.list", params: { limit: 50, offset: 0 } },
    ])
  })

  it("names every report type, eu_ai_act as EU AI Act", async () => {
    const c = scriptedClient({
      "reports.list": {
        reports: [
          summary(1, { type: "eu_ai_act" }),
          summary(2, { type: "hipaa" }),
          summary(3, { type: "custom" }),
          summary(4),
        ],
        hasMore: false,
      },
    })
    renderPage(ReportsPage, c.client)
    await screen.findByText("EU AI Act")
    expect(screen.getByText("HIPAA")).toBeTruthy()
    expect(screen.getByText("Custom")).toBeTruthy()
    expect(screen.getByText("SOC 2")).toBeTruthy()
    expect(screen.queryByText("eu_ai_act")).toBeNull()
  })

  it("says so when there are none, with a zero count", async () => {
    const c = scriptedClient({
      "reports.list": { reports: [], hasMore: false },
    })
    renderPage(ReportsPage, c.client)
    expect(
      await screen.findByText("No reports have been generated in this scope.")
    ).toBeTruthy()
    expect(screen.getByText("0 reports shown")).toBeTruthy()
  })

  it("pages forward with hasMore and invents no total", async () => {
    const c = scriptedClient({
      "reports.list": { reports: [summary(1)], hasMore: true },
    })
    renderPage(ReportsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(
        c.queried.filter((q) => q.intent === "reports.list").pop()?.params
      ).toEqual({ limit: 50, offset: 50 })
    )
    expect(screen.queryByText(/of \d/)).toBeNull()
    expect(screen.queryByText(/total/i)).toBeNull()
  })

  it("disables Next on the last page and Previous on the first", async () => {
    const c = scriptedClient({
      "reports.list": { reports: [summary(1)], hasMore: false },
    })
    renderPage(ReportsPage, c.client)
    await screen.findByText("report_1")
    expect(
      screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen
        .getByRole("button", { name: "Previous page" })
        .hasAttribute("disabled")
    ).toBe(true)
  })

  it("links to the standard and the custom report forms", async () => {
    const c = scriptedClient({
      "reports.list": { reports: [], hasMore: false },
    })
    render(
      <PluginProvider client={c.client}>
        <NavigationProvider
          value={{
            Link: ({ to, children, className }) => (
              <a href={to} className={className}>
                {children}
              </a>
            ),
            navigate: () => {},
          }}
        >
          <ReportsPage params={{}} />
        </NavigationProvider>
      </PluginProvider>
    )
    await screen.findByText("No reports have been generated in this scope.")
    expect(
      screen
        .getByRole("link", { name: "Generate a report" })
        .getAttribute("href")
    ).toBe("/new-report")
    expect(
      screen
        .getByRole("link", { name: "Build a custom report" })
        .getAttribute("href")
    ).toBe("/new-custom-report")
  })

  it("counts one report in the singular", async () => {
    renderPage(
      ReportsPage,
      scriptedClient({
        "reports.list": { reports: [summary(1)], hasMore: false },
      }).client
    )
    expect(await screen.findByText("1 report shown")).toBeTruthy()
  })
})
