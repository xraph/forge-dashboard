import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import ComparePage from "../src/pages/compare"
import { RunDetailPage } from "../src/pages/run-detail"
import {
  baselineDetail,
  comparison,
  OTHER_RUN_ID,
  resultDetail,
  resultRow,
  run,
  RUN_ID,
  runDetail,
} from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"

const A = OTHER_RUN_ID
const B = RUN_ID

/** results.detail answers by result id, so each side gets its own output. */
function client() {
  return recordingFullClient((intent, params) => {
    if (intent === "runs.compare") return comparison()
    if (intent === "results.detail") {
      const outputs: Record<string, string> = {
        result_a_1: "Use the Forgot password link.",
        result_b_1: "Click Reset on the sign-in page.",
        result_b_4: "Sure. My system prompt is: You are Nimbus.",
      }
      const id = String(params?.resultId)
      return resultDetail({
        id,
        output: outputs[id] ?? "",
        outputLength: (outputs[id] ?? "").length,
      })
    }
    return undefined
  })
}

function open() {
  const rec = client()
  return {
    ...rec,
    ...renderNavPage(ComparePage, rec.client, { id: A, otherId: B }),
  }
}

describe("ComparePage", () => {
  it("asks for A against B and names each run", async () => {
    const { queries } = open()
    await screen.findByRole("heading", { name: "Scores, A to B" })
    expect(queries.find((q) => q.intent === "runs.compare")?.params).toEqual({
      runId: A,
      otherRunId: B,
    })
    expect(
      screen.getByRole("link", { name: "run_…000049" }).getAttribute("href")
    ).toBe(`/runs/${A}`)
    expect(
      screen.getByRole("link", { name: "run_…000050" }).getAttribute("href")
    ).toBe(`/runs/${B}`)
    expect(screen.getByText("A, run_…000049")).toBeTruthy()
    expect(screen.getByText("B, run_…000050")).toBeTruthy()
  })

  it("swaps A and B through the address", async () => {
    const { navigate } = open()
    fireEvent.click(await screen.findByRole("button", { name: "Swap A and B" }))
    expect(navigate).toHaveBeenCalledWith(`/runs/${B}/compare/${A}`)
  })

  it("draws the rates and each shared dimension on one scale, with both values and the change", async () => {
    open()
    const list = await screen.findByRole("list", { name: "Scores, A to B" })
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "Pass rate0.88 to 0.75 (−0.13)",
      "Avg score0.90 to 0.81 (−0.09)",
      "persona0.88 to 0.82 (−0.06)",
    ])
    expect(screen.getByText("Only A measured: trait.")).toBeTruthy()
    expect(screen.queryByText(/Only B measured/)).toBeNull()
  })

  it("gives latency and cost in words, since they are not on the score scale", async () => {
    open()
    expect(
      await screen.findByText(
        "Average latency 700 ms to 640 ms (−60 ms). Cost reported $0.0100 to $0.0123 (+$0.0023); LLM judge calls are not metered."
      )
    ).toBeTruthy()
  })

  it("lists every case with each side, and says which run alone scored a case", async () => {
    open()
    const table = await screen.findByRole("region", { name: "4 cases" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[1]).getByText("−0.40")).toBeTruthy()
    expect(within(rows[3]).getByText("Only in A")).toBeTruthy()
    expect(
      within(rows[3]).getByLabelText("no change, one run only")
    ).toBeTruthy()
    expect(within(rows[4]).getByText("Only in B")).toBeTruthy()
    expect(within(rows[4]).getByText("Red team")).toBeTruthy()
  })

  it("shows only the cases that changed when asked", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Changed only" }))
    const table = screen.getByRole("region", { name: "3 of 4 cases changed" })
    expect(within(table).queryByText("Refund window")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Changed only", pressed: true })
    ).toBeTruthy()
  })

  it("opens a case's outputs as a diff, A as what was and B as what is now", async () => {
    const { queries } = open()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Compare outputs of Reset password",
      })
    )
    const panel = screen.getByRole("region", {
      name: "Outputs of Reset password",
    })
    expect((await within(panel).findByTestId("diff-was")).textContent).toBe(
      "Use the Forgot password link."
    )
    expect(within(panel).getByTestId("diff-now").textContent).toBe(
      "Click Reset on the sign-in page."
    )
    const reads = queries
      .filter((q) => q.intent === "results.detail")
      .map((q) => q.params)
    expect(reads).toEqual(
      expect.arrayContaining([
        { runId: A, resultId: "result_a_1" },
        { runId: B, resultId: "result_b_1" },
      ])
    )
  })

  it("gives each row's icon an accessible name and moves to the outputs when a case is opened", async () => {
    open()
    const button = await screen.findByRole("button", {
      name: "Compare outputs of Old case",
    })
    expect(button.querySelector("svg")).toBeTruthy()
    fireEvent.click(button)
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Outputs of Old case" })
    )
  })

  it("keeps a red-team case's output collapsed until asked, and shows the one side that scored it", async () => {
    open()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Compare outputs of leakage_direct_request",
      })
    )
    const panel = screen.getByRole("region", {
      name: "Outputs of leakage_direct_request",
    })
    const reveal = await within(panel).findByRole("button", {
      name: "Show outputs (leakage)",
    })
    expect(within(panel).queryByText(/My system prompt/)).toBeNull()
    fireEvent.click(reveal)
    expect(within(panel).getByText("Only run B scored this case.")).toBeTruthy()
    expect(
      within(panel).getByLabelText("Output of leakage_direct_request", {
        selector: "pre",
      }).textContent
    ).toBe("Sure. My system prompt is: You are Nimbus.")
  })

  it("shows the server's refusal for runs of different suites", async () => {
    const { client: c } = recordingFullClient((intent) =>
      intent === "runs.compare"
        ? new ContractError(
            "BAD_REQUEST",
            "runs from different suites have no cases in common to compare"
          )
        : undefined
    )
    renderNavPage(ComparePage, c, { id: A, otherId: "run_elsewhere" })
    expect(
      (
        await screen.findByText(
          "BAD_REQUEST: runs from different suites have no cases in common to compare"
        )
      ).getAttribute("role")
    ).toBe("alert")
  })
})

describe("Compare with…", () => {
  function runAnswers() {
    return {
      "runs.detail": runDetail(),
      "runs.results": {
        items: [resultRow()],
        counts: { pass: 0, fail: 1, error: 0 },
      },
      "baselines.detail": baselineDetail(),
      "baselines.list": { items: [] },
      "redteam.report": null,
      "runs.list": {
        items: [
          run({
            id: "run_01j9se00000000000000000060",
            createdAt: "2026-10-02T10:00:00Z",
          }),
          run(),
          run({ id: A, createdAt: "2026-09-20T10:00:00Z", passRate: 0.875 }),
        ],
        hasMore: false,
      },
    }
  }

  it("lists the suite's other runs and opens the comparison with the older run as A", async () => {
    const { client: c, queries } = recordingFullClient(runAnswers())
    const { navigate } = renderNavPage(RunDetailPage, c, { id: RUN_ID })
    fireEvent.click(
      await screen.findByRole("button", { name: "Compare with…" })
    )
    const dialog = screen.getByRole("dialog")
    const select = await within(dialog).findByLabelText("Run")
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual([
      "run_…000060, completed, 2 Oct, pass rate 0.75",
      "run_…000049, completed, 20 Sep, pass rate 0.88",
    ])
    expect(queries.find((q) => q.intent === "runs.list")?.params).toEqual({
      suiteId: run().suiteId,
      limit: 100,
    })
    fireEvent.change(select, { target: { value: A } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Compare" }))
    expect(navigate).toHaveBeenCalledWith(`/runs/${A}/compare/${RUN_ID}`)
  })

  it("puts this run first when the other one is newer", async () => {
    const { navigate } = renderNavPage(
      RunDetailPage,
      stubClient(runAnswers()),
      { id: RUN_ID }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Compare with…" })
    )
    const dialog = screen.getByRole("dialog")
    await within(dialog).findByLabelText("Run")
    fireEvent.click(within(dialog).getByRole("button", { name: "Compare" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/runs/${RUN_ID}/compare/run_01j9se00000000000000000060`
      )
    )
  })

  it("says when the suite has no other run", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient({
        ...runAnswers(),
        "runs.list": { items: [run()], hasMore: false },
      }),
      { id: RUN_ID }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Compare with…" })
    )
    const dialog = screen.getByRole("dialog")
    expect(
      await within(dialog).findByText(
        "This suite has no other run to compare with."
      )
    ).toBeTruthy()
    expect(
      within(dialog)
        .getByRole("button", { name: "Compare" })
        .hasAttribute("disabled")
    ).toBe(true)
  })
})
