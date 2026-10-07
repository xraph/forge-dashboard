import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { ResultsSection } from "../src/components/results-section"
import { RunDetailPage } from "../src/pages/run-detail"
import {
  baselineDetail,
  regressed,
  regression,
  resultRow,
  run,
  RUN_ID,
  runDetail,
  runningRun,
  SUITE_ID,
  VERSION_2,
} from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"
import type { RunDetail } from "../src/types"

const NEW_CASE = "tcase_01j9se00000000000000000199"

function answers(detail: RunDetail = runDetail()) {
  return {
    "runs.detail": detail,
    "runs.results": {
      items: [
        resultRow(),
        resultRow({ id: "result_01j9se00000000000000000061", caseId: NEW_CASE, caseName: "Refund policy", status: "pass", score: 1 }),
      ],
      counts: { pass: 3, fail: 1, error: 0 },
    },
    "baselines.detail": baselineDetail(),
    "redteam.report": null,
  }
}

async function band() {
  return screen.findByRole("region", { name: "Verdict" })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("RunDetailPage verdict band", () => {
  it("says a run regressed, against which baseline, at what threshold and from where, with the evidence", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    const text = (await band()).textContent ?? ""
    expect(text).toContain(`Regressed against "Release 1.4" (current baseline), threshold 0.05 recorded by the run`)
    expect(text).toContain("Pass rate 0.88 to 0.75")
    expect(text).toContain("1 case regressed")
    expect(text).toContain("trait not measured")
  })

  it("says within threshold when the comparison holds, and never says passed", async () => {
    const detail = runDetail({
      regression: regressed({ hasRegression: false, regressedCases: [], missingDimensions: [], thresholdSource: "config" }),
    })
    renderNavPage(RunDetailPage, stubClient(answers(detail)), { id: RUN_ID })
    const text = (await band()).textContent ?? ""
    expect(text).toContain(`Within threshold of "Release 1.4" (current baseline), threshold 0.05 from the engine's configuration`)
    expect(text).toContain("No case fell past the threshold")
    expect(text.toLowerCase()).not.toContain("passed")
  })

  it("offers Save as baseline inside the band when the suite has no baseline", async () => {
    renderNavPage(RunDetailPage, stubClient(answers(runDetail({ regression: regression() }))), { id: RUN_ID })
    const verdict = await band()
    expect(within(verdict).getByText("No baseline to compare against")).toBeTruthy()
    expect(within(verdict).getByRole("button", { name: "Save as baseline" })).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Save as baseline" })).toHaveLength(1)
  })

  it("names why a cancelled run is not compared, and offers neither save nor cancel", async () => {
    const detail = runDetail({
      run: run({ state: "cancelled", completedCases: 2 }),
      regression: regression({ state: "notComparable", reason: "runCancelled" }),
    })
    renderNavPage(RunDetailPage, stubClient(answers(detail)), { id: RUN_ID })
    expect(within(await band()).getByText("This run was cancelled after 2 of 4 cases, so it is not compared with a baseline")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Save as baseline" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull()
  })

  it("names why a failed run is not compared, with the run's own error", async () => {
    const detail = runDetail({
      run: run({ state: "failed", error: "target support-bot is not registered" }),
      regression: regression({ state: "notComparable", reason: "runFailed" }),
    })
    renderNavPage(RunDetailPage, stubClient(answers(detail)), { id: RUN_ID })
    const verdict = await band()
    expect(within(verdict).getByText("This run failed, so it is not compared with a baseline")).toBeTruthy()
    expect(within(verdict).getByText("target support-bot is not registered")).toBeTruthy()
  })

  it("shows progress and no verdict while the run is running, with partial stats and a cancel", async () => {
    const detail = runDetail({ run: runningRun(), regression: regression({ state: "running" }) })
    renderNavPage(RunDetailPage, stubClient(answers(detail)), { id: runningRun().id })
    const verdict = await band()
    expect(within(verdict).getByText("2 of 4 cases scored")).toBeTruthy()
    expect(within(verdict).getByRole("progressbar", { name: "Cases scored" }).getAttribute("aria-valuetext")).toBe("2 of 4")
    expect(verdict.textContent).toMatch(/Last progress \d+ (s|min|h) ago\. There is no verdict until the run finishes\./)
    expect(screen.getByText("So far: 2 of 2 scored")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Save as baseline" })).toBeNull()
  })
})

describe("RunDetailPage", () => {
  it("says which suite, target, model and prompt the run used, and how long it took", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    expect(await screen.findByRole("heading", { level: 1, name: "Run run_…000050" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Support assistant" }).getAttribute("href")).toBe(`/suites/${SUITE_ID}`)
    expect(screen.getByText("support-bot").className).toContain("font-mono")
    expect(screen.getByRole("link", { name: "The prompt version it used" }).getAttribute("href")).toBe(
      `/suites/${SUITE_ID}/prompts/${VERSION_2}`,
    )
    expect(screen.getByText("Took 4m 12s")).toBeTruthy()
    expect(screen.getByText(RUN_ID)).toBeTruthy()
    expect(screen.getByText("Scored with pass threshold 0.70, regression threshold 0.05, concurrency 4", { exact: false })).toBeTruthy()
  })

  it("says so when the run recorded no settings", async () => {
    renderNavPage(RunDetailPage, stubClient(answers(runDetail({ run: run({ settings: {} }) }))), { id: RUN_ID })
    expect(
      await screen.findByText(
        "This run did not record its settings, so its regression threshold comes from the engine's configuration.",
      ),
    ).toBeTruthy()
    expect(screen.getByText("Target not recorded")).toBeTruthy()
    expect(screen.getByText("The suite's own prompt")).toBeTruthy()
  })

  it("reads as a sentence when the run recorded only its scorers", async () => {
    renderNavPage(RunDetailPage, stubClient(answers(runDetail({ run: run({ settings: { scorers: ["contains"] } }) }))), {
      id: RUN_ID,
    })
    const line = await screen.findByText("Scored with", { exact: false })
    expect(line.textContent).toBe("Scored with the run's scorers contains.")
  })

  it("labels the cost as what the target reported", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    expect(await screen.findByText("Cost reported by target")).toBeTruthy()
    expect(screen.getByText("$0.0123")).toBeTruthy()
    expect(screen.getByText("LLM judge calls are not metered")).toBeTruthy()
  })

  it("lists the results with counts per status and each case's change against the baseline", async () => {
    renderNavPage(RunDetailPage, stubClient(answers()), { id: RUN_ID })
    const table = await screen.findByRole("region", { name: "4 results" })
    expect(screen.getByRole("button", { name: "Fail 1" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "All 4", pressed: true })).toBeTruthy()
    const rows = within(table).getAllByRole("row")
    // The baseline scored this case 1, the run 0.6: past the 0.05 threshold.
    expect(within(rows[1]).getByText("−0.40 regressed")).toBeTruthy()
    expect(within(rows[1]).getByRole("link", { name: "Reset password" }).getAttribute("href")).toBe(
      `/runs/${RUN_ID}/results/result_01j9se00000000000000000060`,
    )
    // The baseline never scored this one.
    expect(within(rows[2]).getByLabelText("no baseline score")).toBeTruthy()
  })

  it("lists each case's scorers with their verdicts, in words as well as colour", async () => {
    const items = [
      resultRow(),
      resultRow({ id: "result_01j9se00000000000000000061", caseId: NEW_CASE, caseName: "Refund policy", status: "pass", score: 1, scorers: [] }),
    ]
    renderNavPage(RunDetailPage, stubClient({ ...answers(), "runs.results": { items, counts: { pass: 3, fail: 1, error: 0 } } }), {
      id: RUN_ID,
    })
    const table = await screen.findByRole("region", { name: "4 results" })
    expect(within(table).getByRole("columnheader", { name: "Scorers" })).toBeTruthy()
    const rows = within(table).getAllByRole("row")
    const verdicts = within(rows[1]).getByRole("list", { name: "Scorer verdicts" })
    const items1 = within(verdicts).getAllByRole("listitem")
    expect(items1.map((li) => li.textContent)).toEqual(["✗ contains failed", "✓ judge passed"])
    expect(items1[0].querySelector("[data-slot=badge]")?.className).toContain("destructive")
    expect(within(rows[2]).getByLabelText("no scorer verdicts")).toBeTruthy()
  })

  it("asks for one status when its chip is pressed, and for all again when it is pressed twice", async () => {
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    fireEvent.click(await screen.findByRole("button", { name: "Fail 1" }))
    await waitFor(() =>
      expect(queries.some((q) => q.intent === "runs.results" && q.params?.status === "fail")).toBe(true),
    )
    fireEvent.click(await screen.findByRole("button", { name: "Fail 1", pressed: true }))
    await screen.findByRole("button", { name: "All 4", pressed: true })
    const last = queries.filter((q) => q.intent === "runs.results").at(-1)
    expect(last?.params).toEqual({ runId: RUN_ID })
  })

  it("refuses a baseline with no name, then saves one with the run's id", async () => {
    const detail = runDetail({ regression: regression() })
    const { client, sent } = recordingFullClient(answers(detail), { "baselines.save": { id: "base_new" } })
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    fireEvent.click(await screen.findByRole("button", { name: "Save as baseline" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save baseline" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("a baseline needs a name")
    expect(sent).toHaveLength(0)
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Release 1.5 " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save baseline" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(sent).toEqual([{ intent: "baselines.save", payload: { runId: RUN_ID, name: "Release 1.5" } }])
  })

  it("keeps the save dialog open with the server's refusal", async () => {
    const client = {
      ...stubClient(answers(runDetail({ regression: regression() }))),
      command: async () => {
        throw new ContractError("BAD_REQUEST", "only a completed run can become a baseline")
      },
    }
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    fireEvent.click(await screen.findByRole("button", { name: "Save as baseline" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "x" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save baseline" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("only a completed run can become a baseline")
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("cancels a running run after saying what is kept", async () => {
    const live = runningRun()
    const { client, sent } = recordingFullClient(
      answers(runDetail({ run: live, regression: regression({ state: "running" }) })),
      { "runs.cancel": { ...live, state: "cancelled" } },
    )
    renderNavPage(RunDetailPage, client, { id: live.id })
    fireEvent.click(await screen.findByRole("button", { name: "Cancel run" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("2 of 4 cases are scored", { exact: false })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel run" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "runs.cancel", payload: { runId: live.id } }]))
  })

  it("asks again every three seconds while the run is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const live = runningRun()
    const { client, queries } = recordingFullClient(answers(runDetail({ run: live, regression: regression({ state: "running" }) })))
    renderNavPage(RunDetailPage, client, { id: live.id })
    await band()
    const before = queries.filter((q) => q.intent === "runs.detail").length
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(queries.filter((q) => q.intent === "runs.detail").length).toBeGreaterThan(before)
    expect(queries.filter((q) => q.intent === "runs.results").length).toBeGreaterThan(1)
  })

  it("stops asking once the run has finished", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    await band()
    await screen.findByRole("region", { name: "4 results" })
    const before = queries.length
    await act(async () => {
      vi.advanceTimersByTime(9000)
    })
    expect(queries.length).toBe(before)
  })

  it("shows a missing run as an error with its code, and no results", async () => {
    const { client } = recordingFullClient((intent) =>
      intent === "runs.detail" ? new ContractError("NOT_FOUND", "run not found") : undefined,
    )
    renderNavPage(RunDetailPage, client, { id: "run_missing" })
    expect((await screen.findByText("NOT_FOUND: run not found")).getAttribute("role")).toBe("alert")
    expect(screen.queryByRole("heading", { name: "Results" })).toBeNull()
  })

  it("reads the baseline the run was compared with, for the change column", async () => {
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    await screen.findByRole("region", { name: "4 results" })
    expect(queries.find((q) => q.intent === "baselines.detail")?.params).toEqual({
      baselineId: regressed().baseline?.id,
    })
  })
})

describe("ResultsSection", () => {
  it("reads the results once more when the run stops, so a case that finished between polls shows", async () => {
    const { client, queries } = recordingFullClient(answers())
    const props = { runId: RUN_ID, status: "" as const, onStatusChange: () => {} }
    const view = render(
      <PluginProvider client={client}>
        <ResultsSection {...props} running />
      </PluginProvider>,
    )
    await screen.findByRole("region", { name: "4 results" })
    const before = queries.filter((q) => q.intent === "runs.results").length
    view.rerender(
      <PluginProvider client={client}>
        <ResultsSection {...props} running={false} />
      </PluginProvider>,
    )
    await waitFor(() => expect(queries.filter((q) => q.intent === "runs.results").length).toBe(before + 1))
  })

  it("has no change column for a run compared with no baseline", async () => {
    renderNavPage(RunDetailPage, stubClient(answers(runDetail({ regression: regression() }))), { id: RUN_ID })
    const table = await screen.findByRole("region", { name: "4 results" })
    expect(within(table).queryByRole("columnheader", { name: "Change vs baseline" })).toBeNull()
  })

  it("does not claim the baseline never scored a case while its scores load", async () => {
    const inner = stubClient(answers())
    const client = {
      ...inner,
      // The baseline's scores never arrive.
      query: (intent: string, params?: Record<string, unknown>) =>
        intent === "baselines.detail" ? new Promise<never>(() => {}) : inner.query(intent, params),
    } as typeof inner
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    const table = await screen.findByRole("region", { name: "4 results" })
    expect(within(table).getAllByLabelText("no baseline score loaded yet")).toHaveLength(2)
    expect(within(table).queryByLabelText("no baseline score")).toBeNull()
  })

  it("says the baseline's scores could not be read, and does not claim it never scored a case", async () => {
    const { client } = recordingFullClient((intent) =>
      intent === "baselines.detail"
        ? new ContractError("INTERNAL", "store unavailable")
        : answers()[intent as keyof ReturnType<typeof answers>],
    )
    renderNavPage(RunDetailPage, client, { id: RUN_ID })
    expect(
      (await screen.findByText("The baseline's saved scores could not be read", { exact: false })).getAttribute("role"),
    ).toBe("alert")
    expect(screen.getByText("The scores could not be read. store unavailable").getAttribute("role")).toBe("alert")
    const table = screen.getByRole("region", { name: "4 results" })
    expect(within(table).getAllByLabelText("no readable baseline score")).toHaveLength(2)
    expect(within(table).queryByLabelText("no baseline score")).toBeNull()
  })
})
