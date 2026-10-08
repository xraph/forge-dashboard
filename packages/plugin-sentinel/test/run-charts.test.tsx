import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RunDetailPage } from "../src/pages/run-detail"
import {
  baseline,
  baselineDetail,
  regressed,
  regression,
  resultRow,
  run,
  RUN_ID,
  runDetail,
  runningRun,
} from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"
import type { Regression, RunDetail } from "../src/types"

const NEW_CASE = "tcase_01j9se00000000000000000199"
const OLD_BASELINE = "base_01j9se00000000000000000070"

function answers(detail: RunDetail = runDetail()) {
  return {
    "runs.detail": detail,
    "runs.results": {
      items: [
        resultRow(),
        resultRow({
          id: "result_01j9se00000000000000000061",
          caseId: NEW_CASE,
          caseName: "Refund policy",
          status: "pass",
          score: 1,
        }),
      ],
      counts: { pass: 3, fail: 1, error: 0 },
    },
    "baselines.detail": baselineDetail(),
    "redteam.report": null,
    "baselines.list": {
      items: [
        baseline(),
        baseline({ id: OLD_BASELINE, name: "Release 1.3", isCurrent: false }),
      ],
    },
  }
}

const dims = { trait: 0.7, communication: 0.65, persona: 0.82 }

describe("Change from baseline", () => {
  it("draws each compared case worst first, marks a regression in words, and says what was not compared", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    const list = await screen.findByRole("list", {
      name: "Change from baseline, by case",
    })
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain("Reset password")
    expect(items[0].textContent).toContain("regressed")
    expect(items[0].textContent).toContain("−0.40")
    expect(
      screen.getByText("Shaded: more than 0.05 below the baseline")
    ).toBeTruthy()
    expect(
      screen.getByText("1 case is new since the baseline and not compared.")
    ).toBeTruthy()
    expect(
      screen.getByText(
        `Each case's score against "Release 1.4", worst first. A case regresses when it falls more than 0.05 below.`
      )
    ).toBeTruthy()
  })

  it("offers the same numbers as a table", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Show change from baseline as a table",
      })
    )
    const table = screen.getByRole("region", {
      name: "1 case compared, worst first",
    })
    const row = within(table).getAllByRole("row")[1]
    expect(within(row).getByText("1.00")).toBeTruthy()
    expect(within(row).getByText("0.60")).toBeTruthy()
    expect(within(row).getByText("−0.40 regressed")).toBeTruthy()
  })

  it("is not drawn for a run with no baseline to compare against", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient(answers(runDetail({ regression: regression() }))),
      { id: RUN_ID }
    )
    await screen.findByRole("heading", { name: "Dimension scores" })
    expect(
      screen.queryByRole("heading", { name: "Change from baseline" })
    ).toBeNull()
  })
})

describe("Dimension scores", () => {
  it("draws the dimensions in the fixed order with the pass threshold, and names the ones not measured", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient(answers(runDetail({ run: run({ dimensionScores: dims }) }))),
      { id: RUN_ID }
    )
    const list = await screen.findByRole("list", { name: "Dimension scores" })
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["trait0.70", "communication0.65", "persona0.82"])
    expect(screen.getByText("Pass threshold 0.70")).toBeTruthy()
    expect(
      screen.getByText("Not measured: skill, behavior, cognition, perception.")
    ).toBeTruthy()
  })

  it("says one dimension's number instead of drawing a single bar", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    expect(await screen.findByText("persona 0.82")).toBeTruthy()
    expect(screen.queryByRole("list", { name: "Dimension scores" })).toBeNull()
  })

  it("says so when the run measured none", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient(answers(runDetail({ run: run({ dimensionScores: {} }) }))),
      { id: RUN_ID }
    )
    expect(
      await screen.findByText("This run measured no dimensions.")
    ).toBeTruthy()
  })

  it("calls a cancelled run's scores partial too", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient(
        answers(
          runDetail({
            run: run({ state: "cancelled", dimensionScores: dims }),
            regression: regression({
              state: "notComparable",
              reason: "runCancelled",
            }),
          })
        )
      ),
      { id: RUN_ID }
    )
    expect(
      await screen.findByText("From the cases scored before the run stopped.")
    ).toBeTruthy()
  })

  it("calls a running run's scores partial", async () => {
    const live = runningRun({ dimensionScores: dims })
    renderNavPage(
      RunDetailPage,
      stubClient(
        answers(
          runDetail({ run: live, regression: regression({ state: "running" }) })
        )
      ),
      {
        id: live.id,
      }
    )
    expect(
      await screen.findByText("So far, from the cases scored.")
    ).toBeTruthy()
  })
})

describe("View against", () => {
  function viewing(
    over: (params?: Record<string, unknown>) => Regression | Error
  ) {
    return recordingFullClient((intent, params) => {
      if (intent === "runs.regression") return over(params)
      return answers()[intent as keyof ReturnType<typeof answers>]
    })
  }

  it("compares at another threshold for this view, and says where the threshold came from", async () => {
    const { client, queries } = viewing(() =>
      regressed({
        threshold: 0.5,
        thresholdSource: "override",
        hasRegression: false,
        regressedCases: [],
        missingDimensions: [],
      })
    )
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    const form = await screen.findByRole("form", { name: "View against" })
    expect(
      within(form).getByLabelText("Threshold").getAttribute("placeholder")
    ).toBe("0.05")
    fireEvent.change(within(form).getByLabelText("Threshold"), {
      target: { value: "0.5" },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Compare" }))
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Verdict" }).textContent
      ).toContain(
        `Within threshold of "Release 1.4" (current baseline), threshold 0.50 set for this view`
      )
    )
    expect(queries.find((q) => q.intent === "runs.regression")?.params).toEqual(
      { runId: RUN_ID, threshold: 0.5 }
    )
    expect(
      screen.getByText("Shaded: more than 0.50 below the baseline")
    ).toBeTruthy()
    fireEvent.click(
      within(form).getByRole("button", { name: "Back to the run's own answer" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Verdict" }).textContent
      ).toContain(`Regressed against "Release 1.4"`)
    )
  })

  it("compares against another baseline, and says it was chosen for this view", async () => {
    const { client, queries } = viewing(() =>
      regressed({
        baseline: { id: OLD_BASELINE, name: "Release 1.3", passRate: 0.8 },
      })
    )
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    const form = await screen.findByRole("form", { name: "View against" })
    await within(form).findByRole("option", { name: "Release 1.3" })
    fireEvent.change(within(form).getByLabelText("Baseline"), {
      target: { value: OLD_BASELINE },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Compare" }))
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Verdict" }).textContent
      ).toContain(`Regressed against "Release 1.3" (chosen for this view)`)
    )
    expect(queries.find((q) => q.intent === "runs.regression")?.params).toEqual(
      { runId: RUN_ID, baselineId: OLD_BASELINE }
    )
    expect(
      within(form).getByRole("option", { name: "Release 1.4 (current)" })
    ).toBeTruthy()
  })

  it("refuses a threshold outside 0 to 1 before asking", async () => {
    const { client, queries } = viewing(() => regressed())
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    const form = await screen.findByRole("form", { name: "View against" })
    fireEvent.change(within(form).getByLabelText("Threshold"), {
      target: { value: "2" },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Compare" }))
    expect(within(form).getByRole("alert").textContent).toBe(
      "threshold must be between 0 and 1"
    )
    expect(queries.some((q) => q.intent === "runs.regression")).toBe(false)
  })

  it("shows the server's refusal and keeps the run's own answer", async () => {
    const { client } = viewing(
      () =>
        new ContractError(
          "BAD_REQUEST",
          "that baseline belongs to another suite"
        )
    )
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    const form = await screen.findByRole("form", { name: "View against" })
    await within(form).findByRole("option", { name: "Release 1.3" })
    fireEvent.change(within(form).getByLabelText("Baseline"), {
      target: { value: OLD_BASELINE },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Compare" }))
    expect((await within(form).findByRole("alert")).textContent).toContain(
      "that baseline belongs to another suite"
    )
    expect(
      screen.getByRole("region", { name: "Verdict" }).textContent
    ).toContain(`Regressed against "Release 1.4" (current baseline)`)
  })

  it("is not offered while the run is running", async () => {
    const live = runningRun()
    renderNavPage(
      RunDetailPage,
      stubClient(
        answers(
          runDetail({ run: live, regression: regression({ state: "running" }) })
        )
      ),
      {
        id: live.id,
      }
    )
    await screen.findByRole("region", { name: "Verdict" })
    expect(screen.queryByRole("form", { name: "View against" })).toBeNull()
  })
})
