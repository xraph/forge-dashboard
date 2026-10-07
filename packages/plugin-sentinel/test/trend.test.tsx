import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { config, run, suite, SUITE_ID, trend, trendPoint } from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"
import type { Trend } from "../src/types"

function answers(t: Trend = trend()) {
  return {
    "suites.detail": suite(),
    "config.get": config(),
    "runs.list": { items: [run()], hasMore: false },
    "runs.trend": t,
  }
}

function open(t?: Trend) {
  return renderNavPage(SuiteDetailPage, stubClient(answers(t)), { id: SUITE_ID, tab: "runs" })
}

describe("Runs tab trend", () => {
  it("asks for the suite's trend", async () => {
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "runs" })
    await screen.findByRole("heading", { name: "Pass rate over runs" })
    expect(queries.find((q) => q.intent === "runs.trend")?.params).toEqual({ suiteId: SUITE_ID })
  })

  it("draws a marker per run that opens it, by click or by keyboard", async () => {
    const { navigate } = open()
    const markers = await screen.findAllByRole("link", { name: /^Run run_…/ })
    expect(markers).toHaveLength(3)
    expect(markers[2].getAttribute("aria-label")).toBe("Run run_…000225, 25 Sep, pass rate 0.50")
    fireEvent.click(markers[0])
    expect(navigate).toHaveBeenCalledWith("/runs/run_01j9se00000000000000000221")
    fireEvent.keyDown(markers[1], { key: "Enter" })
    expect(navigate).toHaveBeenCalledWith("/runs/run_01j9se00000000000000000223")
  })

  it("names the baseline the line across stands for, and keys every line", async () => {
    open()
    expect(
      await screen.findByText(
        `The line across is "Release 1.4", the current baseline, at 0.88. Each marker opens its run.`,
      ),
    ).toBeTruthy()
    expect(screen.getByText(`Baseline "Release 1.4"`)).toBeTruthy()
    expect(screen.getByText("Avg score")).toBeTruthy()
  })

  it("offers the same numbers as a table", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Show pass rate over runs as a table" }))
    const table = screen.getByRole("region", { name: "3 completed runs, oldest first" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[3]).getByRole("link", { name: "run_…000225" }).getAttribute("href")).toBe(
      "/runs/run_01j9se00000000000000000225",
    )
    expect(within(rows[3]).getByText("0.50")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show pass rate over runs as a chart" }))
    expect(screen.getAllByRole("link", { name: /^Run run_…/ })).toHaveLength(3)
  })

  it("says the suite has no baseline when it has none", async () => {
    open(trend({ baseline: undefined }))
    expect(await screen.findByText("This suite has no current baseline. Each marker opens its run.")).toBeTruthy()
  })

  it("draws each measured dimension on its own, in the fixed order, and names the rest", async () => {
    open()
    await screen.findByRole("heading", { name: "Dimensions over runs" })
    const multiples = screen.getAllByRole("img", { name: /over 3 runs/ })
    expect(multiples.map((m) => m.getAttribute("aria-label"))).toEqual([
      "trait over 3 runs, not measured in 1",
      "persona over 3 runs",
    ])
    expect(screen.getByText("latest 0.60")).toBeTruthy()
    expect(screen.getByText("latest 0.70")).toBeTruthy()
    expect(screen.getByText("Not measured in these runs: skill, behavior, cognition, communication, perception.")).toBeTruthy()
  })

  it("draws a dot for a score with no measured neighbour, so it is not an empty strip", async () => {
    open(
      trend({
        points: [
          trendPoint(21, { dimensionScores: { persona: 0.8 } }),
          trendPoint(23, { dimensionScores: { persona: 0.7, skill: 0.4 } }),
          trendPoint(25, { dimensionScores: { persona: 0.6 } }),
        ],
      }),
    )
    const skill = await screen.findByRole("img", { name: "skill over 3 runs, not measured in 2" })
    await waitFor(() => expect(skill.querySelectorAll("circle")).toHaveLength(1))
    const persona = screen.getByRole("img", { name: "persona over 3 runs" })
    expect(persona.querySelectorAll("circle")).toHaveLength(0)
  })

  it("shows a missing dimension score as none in the table", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Show dimensions over runs as a table" }))
    const rows = within(screen.getByRole("region", { name: "3 completed runs, oldest first" })).getAllByRole("row")
    expect(within(rows[3]).getByLabelText("no trait score")).toBeTruthy()
  })

  it("waits for a second completed run before drawing a trend", async () => {
    open(trend({ points: [trendPoint(21)] }))
    expect(await screen.findByText("One completed run so far. The trend starts with the second.")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Pass rate over runs" })).toBeNull()
  })

  it("says there is no trend before any run completes", async () => {
    open(trend({ points: [], baseline: undefined }))
    expect(await screen.findByText("No completed run yet, so there is no trend.")).toBeTruthy()
  })
})
