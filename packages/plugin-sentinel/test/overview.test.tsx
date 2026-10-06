import { afterEach, describe, expect, it, vi } from "vitest"
import { act, screen, within } from "@testing-library/react"
import { OverviewPage } from "../src/pages/overview"
import { overview, runningRun, SUITE_ID } from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"

afterEach(() => {
  vi.useRealTimers()
})

describe("OverviewPage", () => {
  it("shows the counts, recent regressions and recent runs", async () => {
    renderNavPage(OverviewPage, stubClient({ "overview.stats": overview() }), {})
    expect(await screen.findByText("27")).toBeTruthy()
    const regressions = screen.getByRole("region", { name: "1 regressed run among the twenty newest completed" })
    const row = within(regressions).getAllByRole("row")[1]
    expect(within(row).getByRole("link", { name: "Support assistant" }).getAttribute("href")).toBe(`/suites/${SUITE_ID}`)
    expect(within(row).getByText("Release 1.4")).toBeTruthy()
    expect(within(row).getByText("−0.40")).toBeTruthy()
    expect(within(regressions).getByRole("columnheader", { name: "Worst drop" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "1 run, newest first" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Every run" }).getAttribute("href")).toBe("/runs")
    expect(screen.queryByRole("region", { name: "No target" })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Running now" })).toBeNull()
  })

  it("leads with a notice and a way to Setup when no target is registered", async () => {
    renderNavPage(OverviewPage, stubClient({ "overview.stats": overview({ targetsRegistered: false }) }), {})
    const notice = await screen.findByRole("region", { name: "No target" })
    expect(within(notice).getByText("No target is registered, so no run can start")).toBeTruthy()
    expect(within(notice).getByRole("link", { name: "Setup" }).getAttribute("href")).toBe("/setup")
  })

  it("says plainly when no recent run regressed", async () => {
    renderNavPage(OverviewPage, stubClient({ "overview.stats": overview({ recentRegressions: [] }) }), {})
    expect(
      await screen.findByText(
        "None of the twenty newest completed runs fell past its suite's threshold. Suites without a baseline are not compared.",
      ),
    ).toBeTruthy()
  })

  it("lists active runs with their progress and refreshes while any is active", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingFullClient({ "overview.stats": overview({ activeRuns: [runningRun()] }) })
    renderNavPage(OverviewPage, client, {})
    const active = await screen.findByRole("region", { name: "1 run in flight" })
    expect(within(active).getByRole("progressbar", { name: "Cases scored" })).toBeTruthy()
    const before = queries.length
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(queries.length).toBe(before + 1)
  })

  it("does not refresh when nothing is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingFullClient({ "overview.stats": overview() })
    renderNavPage(OverviewPage, client, {})
    await screen.findByRole("region", { name: "1 run, newest first" })
    const before = queries.length
    await act(async () => {
      vi.advanceTimersByTime(9000)
    })
    expect(queries.length).toBe(before)
  })
})
