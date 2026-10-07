import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import { RedTeamReportSection } from "../src/components/redteam-report"
import { RunDetailPage } from "../src/pages/run-detail"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { baselineDetail, config, redTeamReport, regression, resultRow, run, runDetail, runningRun, suite, SUITE_ID } from "./fixtures"
import { recordingFullClient, renderNavPage } from "./harness"

afterEach(() => {
  vi.useRealTimers()
})

const live = runningRun()

function runAnswer(intent: string, params?: Record<string, unknown>) {
  if (intent === "runs.results") {
    if (params?.status === "fail") return undefined
    return { items: [resultRow()], counts: { pass: 0, fail: 1, error: 0 } }
  }
  if (intent === "baselines.detail") return baselineDetail()
  if (intent === "redteam.report") return null
  return undefined
}

describe("A running run's page through a failed poll", () => {
  it("keeps what it showed, says the refresh failed, keeps polling, and recovers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let reads = 0
    const { client, queries } = recordingFullClient((intent, params) => {
      if (intent === "runs.detail") {
        reads += 1
        return reads === 2
          ? new ContractError("TRANSPORT", "network error")
          : runDetail({ run: live, regression: regression({ state: "running" }) })
      }
      return runAnswer(intent, params)
    })
    renderNavPage(RunDetailPage, client, { id: live.id })
    await screen.findByRole("heading", { level: 1, name: "Run run_…000051" })
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't refresh this run: network error. Showing what was last read.",
    )
    expect(screen.getByRole("heading", { level: 1, name: "Run run_…000051" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Results" })).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh this run/)).toBeNull())
    expect(queries.filter((q) => q.intent === "runs.detail").length).toBe(3)
  })

  it("tries again when asked", async () => {
    let reads = 0
    const { client, queries } = recordingFullClient((intent, params) => {
      if (intent === "runs.detail") {
        reads += 1
        return reads === 2 ? new ContractError("TRANSPORT", "network error") : runDetail()
      }
      return runAnswer(intent, params)
    })
    renderNavPage(RunDetailPage, client, { id: run().id })
    await screen.findByRole("heading", { level: 1, name: "Run run_…000050" })
    act(() => queryStore.invalidate("sentinel", ["runs.detail"]))
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh this run/)).toBeNull())
    expect(queries.filter((q) => q.intent === "runs.detail").length).toBe(3)
  })
})

describe("A suite's page through a failed refresh", () => {
  it("keeps its tabs and an open dialog when a refresh of the suite fails", async () => {
    let reads = 0
    const { client } = recordingFullClient((intent) => {
      if (intent === "suites.detail") {
        reads += 1
        return reads === 1 ? suite() : new ContractError("INTERNAL", "store unavailable")
      }
      if (intent === "config.get") return config()
      if (intent === "runs.list") return { items: [run()], hasMore: false }
      if (intent === "runs.trend") return { points: [] }
      return undefined
    })
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "runs" })
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }))
    const dialog = screen.getByRole("dialog")
    act(() => queryStore.invalidate("sentinel", ["suites.detail"]))
    expect((await screen.findByText(/Couldn't refresh this suite: store unavailable/)).closest("[role=alert]")).toBeTruthy()
    // Behind the open modal, so outside the accessibility tree, but mounted.
    expect(screen.getByRole("tablist", { hidden: true })).toBeTruthy()
    expect(screen.getByRole("dialog")).toBe(dialog)
    expect(within(dialog).getByRole("heading", { name: "Run Support assistant" })).toBeTruthy()
  })
})

describe("Result status chips", () => {
  it("stay, with the pressed one focused, while the chosen status loads", async () => {
    const { client } = recordingFullClient((intent, params) => {
      if (intent === "runs.detail") return runDetail()
      return runAnswer(intent, params)
    })
    const pending = {
      ...client,
      query: (intent: string, params?: Record<string, unknown>) =>
        intent === "runs.results" && params?.status === "fail" ? new Promise<never>(() => {}) : client.query(intent, params),
    } as typeof client
    renderNavPage(RunDetailPage, pending, { id: run().id })
    const fail = await screen.findByRole("button", { name: "Fail 1" })
    fail.focus()
    fireEvent.click(fail)
    const pressed = await screen.findByRole("button", { name: "Fail 1", pressed: true })
    expect(pressed).toBe(fail)
    expect(document.activeElement).toBe(fail)
    expect(screen.getByRole("button", { name: "All 1" })).toBeTruthy()
  })
})

describe("The red-team report through a failed poll", () => {
  it("keeps the report it had, says so, and recovers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let reads = 0
    const { client } = recordingFullClient((intent, params) => {
      if (intent === "runs.detail") return runDetail({ run: live, regression: regression({ state: "running" }) })
      if (intent === "redteam.report") {
        reads += 1
        return reads === 2 ? new ContractError("TRANSPORT", "network error") : redTeamReport()
      }
      return runAnswer(intent, params)
    })
    renderNavPage(RunDetailPage, client, { id: live.id })
    await screen.findByRole("list", { name: "Bypass rate by attack type" })
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(await screen.findByText(/Couldn't refresh the red-team report: network error/)).toBeTruthy()
    expect(screen.getByRole("list", { name: "Bypass rate by attack type" })).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh the red-team report/)).toBeNull())
  })

  it("says nothing about the newest run on the tab when the suite has no red-team case", async () => {
    const { client, queries } = recordingFullClient((intent) => {
      if (intent === "suites.detail") return suite()
      if (intent === "cases.list") return { items: [] }
      if (intent === "runs.list") return { items: [run()], hasMore: false }
      if (intent === "redteam.report") return null
      return undefined
    })
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "redteam" })
    expect(await screen.findByText("No red-team cases yet. Generate some to see how the target holds up.")).toBeTruthy()
    // Only once the report has answered null does its absence mean anything.
    await waitFor(() => expect(queries.some((q) => q.intent === "redteam.report")).toBe(true))
    await act(async () => {})
    expect(screen.queryByText(/From the newest completed run/)).toBeNull()
  })
})

describe("The red-team report when a watched run finishes", () => {
  it("reads once more when the run stops, so the finished run's tally is complete", async () => {
    const { client, queries } = recordingFullClient(() => redTeamReport())
    const view = render(
      <PluginProvider client={client}>
        <RedTeamReportSection runId={live.id} running />
      </PluginProvider>,
    )
    await screen.findByRole("list", { name: "Bypass rate by attack type" })
    const before = queries.filter((q) => q.intent === "redteam.report").length
    view.rerender(
      <PluginProvider client={client}>
        <RedTeamReportSection runId={live.id} running={false} />
      </PluginProvider>,
    )
    await waitFor(() => expect(queries.filter((q) => q.intent === "redteam.report").length).toBe(before + 1))
  })
})
