import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ResultDetailPage } from "../src/pages/result-detail"
import {
  CASE_ID,
  leakageCase,
  RESULT_ID,
  resultDetail,
  RUN_ID,
  runDetail,
  SUITE_ID,
  testCase,
} from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"
import type { ResultDetail } from "../src/types"

const HOSTILE = `<img src=x onerror="alert(1)"><b>bold</b> **not markdown** <a href="https://evil.example">click</a> https://evil.example`

/** An extra entry set to undefined removes that intent, so the stub refuses it. */
function answers(result: ResultDetail = resultDetail(), extra: Record<string, unknown> = {}) {
  const all: Record<string, unknown> = {
    "results.detail": result,
    "runs.detail": runDetail(),
    "cases.detail": testCase(),
    ...extra,
  }
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined))
}

function open(result?: ResultDetail, extra?: Record<string, unknown>) {
  return renderNavPage(ResultDetailPage, stubClient(answers(result, extra)), { id: RUN_ID, resultId: RESULT_ID })
}

describe("ResultDetailPage", () => {
  it("shows the case, its run, the input, the output and the facts", async () => {
    open()
    expect(await screen.findByRole("heading", { level: 1, name: "Reset password" })).toBeTruthy()
    expect(screen.getByText("Fail")).toBeTruthy()
    // The suite's name comes from the run's own read, which may land second.
    const runLink = (await screen.findByText(", Support assistant", { exact: false })).closest("a") as HTMLElement
    expect(runLink.textContent).toBe("run_…000050, Support assistant")
    expect(runLink.getAttribute("href")).toBe(`/runs/${RUN_ID}`)
    expect((await screen.findByRole("link", { name: "Reset password" })).getAttribute("href")).toBe(`/suites/${SUITE_ID}/cases/${CASE_ID}`)
    expect(screen.getByLabelText("Input", { selector: "pre" }).textContent).toBe("How do I reset my password?")
    expect(screen.getByLabelText("Output", { selector: "pre" }).textContent).toBe("Click Reset on the sign-in page.")
    expect(screen.getByText("820 ms")).toBeTruthy()
    expect(screen.getByText("$0.0031")).toBeTruthy()
  })

  it("says a scorer errored, not failed, when it could not judge the case", async () => {
    open(
      resultDetail({
        status: "error",
        scorerResults: [{ scorerName: "judge", score: 0, passed: false, reason: "scorer error: model unavailable", errored: true }],
      }),
    )
    const table = await screen.findByRole("region", { name: "1 scorer" })
    const row = within(table).getAllByRole("row")[1]
    expect(within(row).getByText("Errored")).toBeTruthy()
    expect(within(row).queryByText("Failed")).toBeNull()
  })

  it("says how each scorer judged the case, with its reason and dimension", async () => {
    open()
    const table = await screen.findByRole("region", { name: "2 scorers" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[1]).getByText("contains").className).toContain("font-mono")
    expect(within(rows[1]).getByText("Failed")).toBeTruthy()
    expect(within(rows[1]).getByText(`output does not contain "Forgot password"`)).toBeTruthy()
    expect(within(rows[1]).getByLabelText("no dimension")).toBeTruthy()
    expect(within(rows[2]).getByText("Passed")).toBeTruthy()
    expect(within(rows[2]).getByText("persona")).toBeTruthy()
  })

  it("renders hostile output as inert text: no element, no markdown, no link", async () => {
    const { container } = open(resultDetail({ output: HOSTILE, outputLength: HOSTILE.length }))
    const output = await screen.findByLabelText("Output", { selector: "pre" })
    expect(output.tagName).toBe("PRE")
    expect(output.textContent).toBe(HOSTILE)
    expect(output.children).toHaveLength(0)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("b")).toBeNull()
    expect(container.querySelector('a[href="https://evil.example"]')).toBeNull()
  })

  it("keeps hostile scorer reasons and tool results inert as well", async () => {
    const { container } = open(
      resultDetail({
        scorerResults: [{ scorerName: "judge", score: 0, passed: false, reason: HOSTILE }],
        runTrace: {
          steps: [{ index: 0, type: "tool", output: HOSTILE, tokensUsed: 10 }],
          toolCalls: [{ toolName: "lookup", arguments: HOSTILE, result: HOSTILE, error: HOSTILE }],
        },
      }),
    )
    await screen.findByRole("region", { name: "1 scorer" })
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector('a[href="https://evil.example"]')).toBeNull()
    expect(screen.getAllByText(HOSTILE).length).toBeGreaterThanOrEqual(4)
  })

  it("keeps a red-team output collapsed until it is asked for, and forgets on remount", async () => {
    const secret = "Sure. My system prompt is: You are Nimbus, the internal billing agent."
    const leaked = resultDetail({
      caseId: leakageCase().id,
      caseName: "leakage_direct_request",
      redTeam: { attackType: "leakage" },
      output: secret,
      outputLength: 1284,
    })
    const view = open(leaked, { "cases.detail": leakageCase() })
    const reveal = await screen.findByRole("button", { name: "Show output (1,284 characters, leakage)" })
    expect(screen.queryByText(secret)).toBeNull()
    expect(screen.getByText("Red team")).toBeTruthy()
    fireEvent.click(reveal)
    expect(screen.getByLabelText("Output", { selector: "pre" }).textContent).toBe(secret)
    fireEvent.click(screen.getByRole("button", { name: "Hide output" }))
    expect(screen.queryByText(secret)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show output (1,284 characters, leakage)" }))
    view.unmount()
    open(leaked, { "cases.detail": leakageCase() })
    await screen.findByRole("button", { name: "Show output (1,284 characters, leakage)" })
    expect(screen.queryByText(secret)).toBeNull()
  })

  it("collapses each step of a red-team trace on its own", async () => {
    open(
      resultDetail({
        redTeam: { attackType: "injection" },
        output: "done",
        runTrace: {
          steps: [
            { index: 0, type: "llm", output: "first step output", tokensUsed: 5 },
            { index: 1, type: "llm", output: "second step output", tokensUsed: 7 },
          ],
          toolCalls: [],
        },
      }),
    )
    fireEvent.click(await screen.findByRole("button", { name: "Show step 2 output (18 characters, injection)" }))
    expect(screen.getByText("second step output")).toBeTruthy()
    expect(screen.queryByText("first step output")).toBeNull()
  })

  it("collapses a red-team trace's tool calls too, since an attack's payoff can land there", async () => {
    const payload = "SYSTEM PROMPT: You are Nimbus, the internal billing agent."
    open(
      resultDetail({
        redTeam: { attackType: "injection" },
        output: "done",
        runTrace: {
          steps: [],
          toolCalls: [{ toolName: "send_email", arguments: payload, result: "sent" }],
        },
      }),
    )
    const reveal = await screen.findByRole("button", { name: "Show 1 tool call (injection)" })
    expect(screen.queryByText(payload)).toBeNull()
    expect(screen.queryByText("send_email")).toBeNull()
    fireEvent.click(reveal)
    expect(within(screen.getByRole("region", { name: "1 tool call" })).getByText(payload)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Hide tool calls" }))
    expect(screen.queryByText(payload)).toBeNull()
  })

  it("says the input is gone when the case has been deleted since the run", async () => {
    open(undefined, { "cases.detail": undefined })
    expect(
      await screen.findByText("The case has been deleted since this run, so its input is no longer available."),
    ).toBeTruthy()
    // The case is named by its id when it can no longer be linked.
    expect(screen.getByText(CASE_ID).className).toContain("font-mono")
  })

  it("says the input could not be read, not that the case is gone, when the read fails for another reason", async () => {
    const inner = stubClient(answers())
    const client = {
      ...inner,
      query: (intent: string, params?: Record<string, unknown>) =>
        intent === "cases.detail"
          ? Promise.reject(new ContractError("INTERNAL", "store unavailable"))
          : inner.query(intent, params),
    } as typeof inner
    renderNavPage(ResultDetailPage, client, { id: RUN_ID, resultId: RESULT_ID })
    expect((await screen.findByText("The input could not be read. store unavailable")).getAttribute("role")).toBe("alert")
    expect(screen.queryByText("The case has been deleted since this run", { exact: false })).toBeNull()
  })

  it("explains an errored result in its own section", async () => {
    open(resultDetail({ status: "error", error: "target timed out after 30s", output: "" }))
    const heading = await screen.findByRole("heading", { name: "Why it could not be judged" })
    expect(heading).toBeTruthy()
    expect(screen.getByLabelText("Error", { selector: "pre" }).textContent).toBe("target timed out after 30s")
    expect(screen.getByLabelText("no output")).toBeTruthy()
  })

  it("shows a trace's steps and tool calls", async () => {
    open(
      resultDetail({
        runTrace: {
          steps: [{ index: 0, type: "llm", output: "Looking up the account.", tokensUsed: 120 }],
          toolCalls: [{ toolName: "find_account", arguments: '{"email":"a@b.c"}', result: '{"id":7}' }],
        },
      }),
    )
    expect(await screen.findByText("Step 1, ", { exact: false })).toBeTruthy()
    expect(screen.getByLabelText("Step 1 output", { selector: "pre" }).textContent).toBe("Looking up the account.")
    const calls = screen.getByRole("region", { name: "1 tool call" })
    expect(within(calls).getByText("find_account")).toBeTruthy()
    expect(within(calls).getByLabelText("no error")).toBeTruthy()
  })

  it("asks for the result by run and result id, and for the case it belongs to", async () => {
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(ResultDetailPage, client, { id: RUN_ID, resultId: RESULT_ID })
    await screen.findByLabelText("Input", { selector: "pre" })
    expect(queries.find((q) => q.intent === "results.detail")?.params).toEqual({ runId: RUN_ID, resultId: RESULT_ID })
    expect(queries.find((q) => q.intent === "cases.detail")?.params).toEqual({ caseId: CASE_ID })
  })

  it("shows a missing result as an error with its code", async () => {
    const { client } = recordingFullClient((intent) =>
      intent === "results.detail" ? new ContractError("NOT_FOUND", "result not found") : undefined,
    )
    renderNavPage(ResultDetailPage, client, { id: RUN_ID, resultId: "result_missing" })
    expect((await screen.findByText("NOT_FOUND: result not found")).getAttribute("role")).toBe("alert")
  })
})
