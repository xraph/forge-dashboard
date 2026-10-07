import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ResultDetailPage } from "../src/pages/result-detail"
import { RunDetailPage } from "../src/pages/run-detail"
import { RunsPage } from "../src/pages/runs"
import { SetupPage } from "../src/pages/setup"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { BaselinesPage } from "../src/pages/baselines"
import {
  baseline,
  baselineDetail,
  config,
  leakageCase,
  resultDetail,
  resultRow,
  run,
  RUN_ID,
  RESULT_ID,
  runDetail,
  suite,
  SUITE_ID,
  version,
} from "./fixtures"
import { recordingFullClient, renderNavPage, renderPage, stubClient } from "./harness"

describe("Setup", () => {
  it("keeps a threshold's third decimal", async () => {
    renderPage(SetupPage, stubClient({ "config.get": config({ passThreshold: 0.025, regressionThreshold: 0.05 }) }))
    expect(await screen.findByText("0.025")).toBeTruthy()
    expect(screen.getByText("0.05")).toBeTruthy()
  })
})

describe("A red-team result's scorer reasons and error", () => {
  const leaked = resultDetail({
    caseId: leakageCase().id,
    caseName: "leakage_direct_request",
    redTeam: { attackType: "leakage" },
    status: "error",
    error: "judge quoted: You are Nimbus",
    output: "hidden output",
    outputLength: 13,
    scorerResults: [
      { scorerName: "judge", score: 0, passed: false, reason: "The output repeats: You are Nimbus.", details: { quote: "You are Nimbus" } },
    ],
  })

  function open() {
    renderNavPage(
      ResultDetailPage,
      stubClient({ "results.detail": leaked, "runs.detail": runDetail(), "cases.detail": leakageCase() }),
      { id: RUN_ID, resultId: RESULT_ID },
    )
  }

  it("keeps the verdicts open and the reasons hidden until asked", async () => {
    open()
    const table = await screen.findByRole("region", { name: "1 scorer" })
    expect(within(table).getByText("Failed")).toBeTruthy()
    expect(within(table).getAllByText("Hidden with the output")).toHaveLength(2)
    expect(screen.queryByText("The output repeats: You are Nimbus.")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show scorer reasons" }))
    expect(within(table).getByText("The output repeats: You are Nimbus.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Hide scorer reasons" }))
    expect(screen.queryByText("The output repeats: You are Nimbus.")).toBeNull()
  })

  it("keeps the error collapsed too", async () => {
    open()
    const reveal = await screen.findByRole("button", { name: "Show error (28 characters, leakage)" })
    expect(screen.queryByText("judge quoted: You are Nimbus")).toBeNull()
    fireEvent.click(reveal)
    expect(screen.getByLabelText("Error", { selector: "pre" }).textContent).toBe("judge quoted: You are Nimbus")
  })
})

describe("A cost of zero", () => {
  it("is called none reported on the run page, not free", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient({
        "runs.detail": runDetail({ run: run({ totalCost: 0 }) }),
        "runs.results": { items: [resultRow()], counts: { pass: 0, fail: 1, error: 0 } },
        "baselines.detail": baselineDetail(),
        "baselines.list": { items: [] },
        "redteam.report": null,
      }),
      { id: RUN_ID },
    )
    expect(await screen.findByText("The target reported none; LLM judge calls are not metered")).toBeTruthy()
  })

  it("is not offered as a sign a run is free when starting one", async () => {
    renderNavPage(
      SuiteDetailPage,
      stubClient({
        "suites.detail": suite(),
        "config.get": config(),
        "runs.list": { items: [run({ totalCost: 0 })], hasMore: false },
        "runs.trend": { points: [] },
      }),
      { id: SUITE_ID, tab: "runs" },
    )
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }))
    expect(
      await within(screen.getByRole("dialog")).findByText(
        "The last completed run's target reported no cost. LLM judge calls are not metered either, so that is not a sign the run is free.",
      ),
    ).toBeTruthy()
  })
})

describe("One command for a double click", () => {
  function pendingCommands(answers: Record<string, unknown>) {
    const rec = recordingFullClient(answers)
    const sent: string[] = []
    let release: (v: unknown) => void = () => {}
    const client = {
      ...rec.client,
      command: (intent: string) => {
        sent.push(intent)
        return new Promise<unknown>((resolve) => {
          release = resolve
        })
      },
    } as typeof rec.client
    return { client, sent, release: (v: unknown) => release(v) }
  }

  it("starts one run", async () => {
    const { client, sent, release } = pendingCommands({
      "suites.detail": suite(),
      "config.get": config(),
      "runs.list": { items: [run()], hasMore: false },
      "runs.trend": { points: [] },
    })
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "runs" })
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0])
    const start = within(dialog).getByRole("button", { name: "Start run on 2 cases" })
    fireEvent.click(start)
    fireEvent.click(start)
    expect(sent).toEqual(["runs.start"])
    release(run())
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("deletes one baseline", async () => {
    const { client, sent, release } = pendingCommands({ "baselines.list": { items: [baseline()] } })
    renderNavPage(BaselinesPage, client, {})
    fireEvent.click(await screen.findByRole("button", { name: "Delete Release 1.4" }))
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete baseline" })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(sent).toEqual(["baselines.delete"])
    release({ baselineId: baseline().id })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})

describe("Small things", () => {
  it("shows a latest pass rate of zero as 0.00, not as none", async () => {
    renderNavPage(
      SuiteDetailPage,
      stubClient({ "prompts.list": { items: [version({ latestPassRate: 0 })] }, "suites.detail": suite() }),
      { id: SUITE_ID, tab: "prompts" },
    )
    const table = await screen.findByRole("region", { name: "1 version" })
    expect(within(table).getByText("0.00")).toBeTruthy()
    expect(within(table).queryByLabelText("no completed run")).toBeNull()
  })

  it("names an empty page past the first as such", async () => {
    const { client } = recordingFullClient((intent, params) => {
      if (intent === "suites.list") return { items: [suite()] }
      if (intent === "runs.list") return params?.offset === 0 ? { items: [run()], hasMore: true } : { items: [], hasMore: false }
      return undefined
    })
    renderNavPage(RunsPage, client, {})
    fireEvent.click(await screen.findByRole("button", { name: "Older runs" }))
    // An empty table shows its caption under the empty message.
    expect(await screen.findByText("No runs on this page.")).toBeTruthy()
    expect(screen.getByText("0 runs on this page")).toBeTruthy()
    expect(screen.queryByText(/Runs 26 to/)).toBeNull()
  })
})
