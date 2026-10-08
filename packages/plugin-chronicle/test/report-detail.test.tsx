import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ReportDetailPage } from "../src/pages/report-detail"
import { saveFile } from "../src/download"
import { renderPage, scriptedClient } from "./harness"
import { mixed } from "./verification/fixtures"
import type { EventSummary, ReportDetail, ReportSection } from "../src/types"

vi.mock("../src/download")

beforeEach(() => {
  vi.mocked(saveFile).mockClear()
})

const event = (n: number, over: Partial<EventSummary> = {}): EventSummary => ({
  id: `evt_${n}`,
  timestamp: "2026-08-01T10:00:00Z",
  sequence: 1000 + n,
  action: `login.${n}`,
  resource: "session",
  category: "auth",
  outcome: "success",
  severity: "info",
  userId: "user_ada",
  erased: false,
  ...over,
})

const section = (over: Partial<ReportSection> = {}): ReportSection => ({
  title: "Access control",
  notes: "Logical access to systems.",
  events: [event(1), event(2)],
  matchedEvents: 2,
  eventsTruncated: false,
  ...over,
})

const detail = (over: Partial<ReportDetail> = {}): ReportDetail => ({
  id: "report_soc2",
  title: "SOC 2 evidence, Q3",
  type: "soc2",
  period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
  generatedBy: "user_admin",
  format: "json",
  createdAt: "2026-09-29T10:00:00Z",
  stats: {
    totalEvents: 12431,
    criticalEvents: 7,
    failedEvents: 42,
    deniedEvents: 3,
  },
  sections: [section()],
  ...over,
})

const exported = (format: string, content: string) => ({
  filename: `report-report_soc2.${format}`,
  contentType: `text/${format}; charset=utf-8`,
  content,
})

describe("ReportDetailPage", () => {
  it("shows the header, type, period and generator, with the id and generator in mono", async () => {
    const c = scriptedClient({ "reports.detail": detail() })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "SOC 2 evidence, Q3",
      })
    ).toBeTruthy()
    expect(c.queried[0]).toEqual({
      intent: "reports.detail",
      params: { id: "report_soc2" },
    })
    expect(screen.getByText("SOC 2")).toBeTruthy()
    expect(screen.getByText("user_admin").className).toContain("font-mono")
    expect(screen.getByText("report_soc2").className).toContain("font-mono")
    expect(screen.getByText("Period")).toBeTruthy()
  })

  it("shows the stats tiles when the report carries them, and none when it does not", async () => {
    const c = scriptedClient({ "reports.detail": detail() })
    const { unmount } = renderPage(ReportDetailPage, c.client, {
      id: "report_soc2",
    })
    await screen.findByText("12,431")
    expect(screen.getByText("Total events")).toBeTruthy()
    expect(screen.getByText("Critical")).toBeTruthy()
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.getByText("Denied")).toBeTruthy()
    unmount()
    const d = scriptedClient({ "reports.detail": detail({ stats: undefined }) })
    renderPage(ReportDetailPage, d.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    expect(screen.queryByText("Total events")).toBeNull()
  })

  it("shows each section with its notes, its events, and a live caption", async () => {
    const c = scriptedClient({
      "reports.detail": detail({
        sections: [
          section(),
          section({
            title: "Change management",
            notes: undefined,
            events: [],
            matchedEvents: 0,
          }),
        ],
      }),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByRole("heading", { name: "Access control" })
    expect(screen.getByText("Logical access to systems.")).toBeTruthy()
    expect(screen.getByText("2 of 2 matching events")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "login.1" }).getAttribute("href")
    ).toBe("/events/evt_1")
    expect(
      screen.getByRole("heading", { name: "Change management" })
    ).toBeTruthy()
    expect(screen.getByText("0 of 0 matching events")).toBeTruthy()
  })

  it("says how many matching events a truncated section leaves out", async () => {
    const events = Array.from({ length: 1000 }, (_, i) => event(i + 1))
    const c = scriptedClient({
      "reports.detail": detail({
        sections: [
          section({ events, matchedEvents: 5321, eventsTruncated: true }),
        ],
      }),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    expect(
      await screen.findByText(/Showing 1,000 of 5,321 matching events/)
    ).toBeTruthy()
  })

  it("does not claim a truncation for a whole section", async () => {
    const c = scriptedClient({ "reports.detail": detail() })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("2 of 2 matching events")
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it("ends with the integrity section, and never leaves it out", async () => {
    const c = scriptedClient({ "reports.detail": detail() })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    expect(screen.getByRole("heading", { name: "Integrity" })).toBeTruthy()
    expect(
      screen.getByText("This report contains no integrity verification.")
    ).toBeTruthy()
  })

  it("shows the embedded verification with the scope it covered", async () => {
    const c = scriptedClient({
      "reports.detail": detail({
        verification: { ...mixed, retentionPolicies: -1 },
        verificationScope: {
          status: "verified",
          streamId: "stream_app",
          headSeq: 61004,
          fromSeq: 1,
          toSeq: 61004,
          window: 50000,
          capped: false,
          checkpointsConfigured: true,
          notes: [
            "This report has no tenant, so only the app's untenanted chain was verified.",
          ],
        },
      }),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    expect(
      await screen.findByText(/only the app's untenanted chain was verified/)
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: /No alteration detected/ })
    ).toBeTruthy()
  })

  it("offers the four downloads and queries nothing for an export until one is clicked", async () => {
    const c = scriptedClient({ "reports.detail": detail() })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    for (const name of [
      "Download JSON",
      "Download CSV",
      "Download Markdown",
      "Download HTML",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy()
    }
    expect(c.queried.map((q) => q.intent)).toEqual(["reports.detail"])
    expect(saveFile).not.toHaveBeenCalled()
  })

  it("exports on click with the id and format, and saves the file the server named", async () => {
    const c = scriptedClient({
      "reports.detail": detail(),
      "reports.export": (input) =>
        exported(String(input.format), "the content"),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    fireEvent.click(screen.getByRole("button", { name: "Download HTML" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce())
    expect(saveFile).toHaveBeenCalledWith(
      "report-report_soc2.html",
      "text/html; charset=utf-8",
      "the content"
    )
    expect(c.queried.filter((q) => q.intent === "reports.export")).toEqual([
      {
        intent: "reports.export",
        params: { id: "report_soc2", format: "html" },
      },
    ])
  })

  it("can download the same format twice, asks the server each time, and saves what each answer held", async () => {
    let n = 0
    const c = scriptedClient({
      "reports.detail": detail(),
      "reports.export": (input) =>
        exported(String(input.format), `content ${++n}`),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Download JSON",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2))
    expect(c.queried.filter((q) => q.intent === "reports.export")).toHaveLength(
      2
    )
    expect(vi.mocked(saveFile).mock.calls.map((call) => call[2])).toEqual([
      "content 1",
      "content 2",
    ])
  })

  it("never puts the HTML export in the page", async () => {
    const html =
      '<html><body><script>window.__pwned = 1</script><h2 id="injected">Injected</h2></body></html>'
    const c = scriptedClient({
      "reports.detail": detail(),
      "reports.export": exported("html", html),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    fireEvent.click(screen.getByRole("button", { name: "Download HTML" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce())
    expect(document.getElementById("injected")).toBeNull()
    expect(document.body.innerHTML).not.toContain("window.__pwned")
    expect(document.body.innerHTML).not.toContain("Injected")
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it("never renders the markdown export, so a pipe in an action does not become a table", async () => {
    const md =
      "| Action | Outcome |\n|---|---|\n| rm -rf \\| pipe-marker | success |\n\n# Heading marker"
    const c = scriptedClient({
      "reports.detail": detail(),
      "reports.export": exported("md", md),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce())
    expect(saveFile).toHaveBeenCalledWith(
      "report-report_soc2.md",
      "text/md; charset=utf-8",
      md
    )
    expect(screen.queryByText(/pipe-marker/)).toBeNull()
    expect(screen.queryByRole("heading", { name: "Heading marker" })).toBeNull()
    for (const table of Array.from(document.querySelectorAll("table"))) {
      expect(table.textContent).not.toContain("pipe-marker")
    }
    expect(within(document.body).queryByText(/Outcome \|/)).toBeNull()
  })

  it("says the export failed, and lets the operator try again", async () => {
    let calls = 0
    const c = scriptedClient({
      "reports.detail": detail(),
      "reports.export": (input) =>
        ++calls === 1
          ? new ContractError(
              "UNAVAILABLE",
              "the report engine is not configured"
            )
          : exported(String(input.format), "ok"),
    })
    renderPage(ReportDetailPage, c.client, { id: "report_soc2" })
    await screen.findByText("Access control")
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("UNAVAILABLE")
    expect(saveFile).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Download CSV",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce())
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows a missing report as an error card", async () => {
    const c = scriptedClient({
      "reports.detail": new ContractError("NOT_FOUND", "report not found"),
    })
    renderPage(ReportDetailPage, c.client, { id: "nope" })
    expect(await screen.findByText(/NOT_FOUND/)).toBeTruthy()
  })

  it("agrees a section's caption with one matching event", async () => {
    renderPage(
      ReportDetailPage,
      scriptedClient({
        "reports.detail": detail({
          sections: [section({ events: [event(1)], matchedEvents: 1 })],
        }),
      }).client,
      { id: "report_soc2" }
    )
    expect(await screen.findByText("1 of 1 matching event")).toBeTruthy()
  })

  it("names the report's tenant, and says app level for a report with none", async () => {
    const view = renderPage(
      ReportDetailPage,
      scriptedClient({ "reports.detail": detail({ tenantId: "globex" }) })
        .client,
      { id: "report_soc2" }
    )
    await waitFor(() =>
      expect(screen.getByText("globex").className).toContain("font-mono")
    )
    view.unmount()
    renderPage(
      ReportDetailPage,
      scriptedClient({ "reports.detail": detail({ tenantId: "" }) }).client,
      { id: "report_soc2" }
    )
    await waitFor(() => expect(screen.getByText("App level")).toBeTruthy())
  })
})
