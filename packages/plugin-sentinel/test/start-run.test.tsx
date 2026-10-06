import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { config, run, RUN_ID, suite, SUITE_ID } from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"

function answers(overrides: Record<string, unknown> = {}) {
  return {
    "suites.detail": suite(),
    "config.get": config(),
    "runs.list": { items: [run()], hasMore: false },
    ...overrides,
  }
}

/** The suite page on its Runs tab, with the start dialog opened. */
async function openDialog(client = stubClient(answers())) {
  const view = renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "runs" })
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }))
  return { ...view, dialog: screen.getByRole("dialog") }
}

describe("Runs tab", () => {
  it("lists the suite's own runs without a suite filter", async () => {
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "runs" })
    await screen.findByRole("region", { name: "1 run, newest first" })
    expect(queries.find((q) => q.intent === "runs.list")?.params).toEqual({ limit: 25, offset: 0, suiteId: SUITE_ID })
    expect(screen.queryByLabelText("Suite")).toBeNull()
  })

  it("has no start button without a target, and says where to register one", async () => {
    renderNavPage(SuiteDetailPage, stubClient(answers({ "config.get": config({ targets: [] }) })), { id: SUITE_ID, tab: "runs" })
    const setup = await screen.findByRole("link", { name: "Setup" })
    expect(setup.getAttribute("href")).toBe("/setup")
    expect(screen.getByText("No target is registered, so no run can start.", { exact: false })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull()
  })

  it("has no start button for a suite with no cases", async () => {
    renderNavPage(SuiteDetailPage, stubClient(answers({ "suites.detail": suite({ caseCount: 0 }) })), {
      id: SUITE_ID,
      tab: "runs",
    })
    expect(await screen.findByText("This suite has no cases, so a run would have nothing to score. Add a case first.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull()
  })
})

describe("StartRunDialog", () => {
  it("names the suite, its cases, the target and what it is, and the model", async () => {
    const { dialog } = await openDialog()
    expect(within(dialog).getByRole("heading", { name: "Run Support assistant" })).toBeTruthy()
    expect(within(dialog).getByText("Answers with the case input.")).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Target"), { target: { value: "support-bot" } })
    expect(within(dialog).getByText("The support assistant under test.")).toBeTruthy()
    expect(within(dialog).getByText("Leave it empty to use the suite's model, smart.")).toBeTruthy()
    const summary = within(dialog).getByRole("region", { name: "What this run uses" })
    expect(summary.textContent).toContain("2 cases to support-bot on smart, no scorer chosen yet.")
    expect(within(dialog).getByRole("button", { name: "Start run on 2 cases" })).toBeTruthy()
  })

  it("flags every scorer that calls an LLM and disables the ones that need config", async () => {
    const { dialog } = await openDialog()
    const boxes = within(dialog).getAllByRole("checkbox")
    expect(boxes).toHaveLength(4)
    // contains, judge, not_contains, regex: the engine's order.
    expect(boxes[3].hasAttribute("data-disabled") || boxes[3].getAttribute("aria-disabled") === "true").toBe(true)
    expect(within(dialog).getAllByText("Calls an LLM")).toHaveLength(1)
    expect(within(dialog).getAllByText("Needs config")).toHaveLength(1)
    fireEvent.click(boxes[1])
    const summary = within(dialog).getByRole("region", { name: "What this run uses" })
    expect(summary.textContent).toContain("judged by 1 scorer, some of which call an LLM.")
  })

  it("shows the last completed run's reported cost with its caveat", async () => {
    const { client, queries } = recordingFullClient(answers())
    const { dialog } = await openDialog(client)
    expect(
      await within(dialog).findByText(
        "The last completed run reported $0.0123. That is what the target reported; LLM judge calls are not metered and are not in it.",
      ),
    ).toBeTruthy()
    expect(queries.filter((q) => q.intent === "runs.list").at(-1)?.params).toEqual({
      suiteId: SUITE_ID,
      state: "completed",
      limit: 1,
    })
  })

  it("says when there is no completed run to take a cost from", async () => {
    const { client } = recordingFullClient((intent, params) => {
      if (intent === "runs.list") return { items: params?.state === "completed" ? [] : [run()], hasMore: false }
      return answers()[intent as keyof ReturnType<typeof answers>]
    })
    const { dialog } = await openDialog(client)
    expect(await within(dialog).findByText("This suite has no completed run yet, so there is no cost to go on.")).toBeTruthy()
  })

  it("refuses to start with no scorer, and sends nothing", async () => {
    const { client, sent } = recordingFullClient(answers(), { "runs.start": run() })
    const { dialog } = await openDialog(client)
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run on 2 cases" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("choose at least one scorer")
    expect(sent).toHaveLength(0)
  })

  it("starts the run with the scorers in the engine's order, then opens it", async () => {
    const started = run({ id: RUN_ID, state: "running" })
    const { client, sent } = recordingFullClient(answers(), { "runs.start": started })
    const { dialog, navigate } = await openDialog(client)
    const boxes = within(dialog).getAllByRole("checkbox")
    fireEvent.click(boxes[1])
    fireEvent.click(boxes[0])
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run on 2 cases" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/runs/${RUN_ID}`))
    // No model typed, so none is sent and the suite's applies.
    expect(sent).toEqual([
      { intent: "runs.start", payload: { suiteId: SUITE_ID, target: "echo", scorers: ["contains", "judge"] } },
    ])
  })

  it("sends a model when one is typed", async () => {
    const { client, sent } = recordingFullClient(answers(), { "runs.start": run() })
    const { dialog } = await openDialog(client)
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0])
    fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: " fast " } })
    expect(within(dialog).getByRole("region", { name: "What this run uses" }).textContent).toContain("on fast")
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run on 2 cases" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ suiteId: SUITE_ID, target: "echo", scorers: ["contains"], model: "fast" })
  })

  it("keeps the dialog open with the server's refusal", async () => {
    const client = {
      ...stubClient(answers()),
      command: async () => {
        throw new ContractError("BAD_REQUEST", "scorer regex needs config")
      },
    }
    const { dialog, navigate } = await openDialog(client)
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0])
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run on 2 cases" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("scorer regex needs config")
    expect(navigate).not.toHaveBeenCalled()
  })
})
