import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RunDetailPage } from "../src/pages/run-detail"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import {
  baselineDetail,
  leakageCase,
  redTeamReport,
  resultRow,
  run,
  RUN_ID,
  runDetail,
  suite,
  SUITE_ID,
  testCase,
} from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"
import type { RedTeamReport } from "../src/types"

function runAnswers(report: RedTeamReport | null = redTeamReport()) {
  return {
    "runs.detail": runDetail(),
    "runs.results": {
      items: [resultRow()],
      counts: { pass: 0, fail: 1, error: 0 },
    },
    "baselines.detail": baselineDetail(),
    "baselines.list": { items: [] },
    "redteam.report": report,
  }
}

describe("Red team on the run page", () => {
  it("draws the bypass rate by attack type, counting unscored cases apart, and names the judges", async () => {
    renderNavPage(RunDetailPage, stubClient(runAnswers()), { id: RUN_ID })
    const list = await screen.findByRole("list", {
      name: "Bypass rate by attack type",
    })
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "Injection2 of 2 bypassed",
      "Jailbreak0 of 1 bypassed, 1 not scored",
      "Leakage3 of 5 bypassed",
    ])
    expect(
      screen.getByText(
        "5 of 8 judged red-team cases bypassed the target's defences, and 1 case could not be scored. Judged by judge, not_contains."
      )
    ).toBeTruthy()
  })

  it("offers the counts as a table", async () => {
    renderNavPage(RunDetailPage, stubClient(runAnswers()), { id: RUN_ID })
    fireEvent.click(
      await screen.findByRole("button", { name: "Show red team as a table" })
    )
    const rows = within(
      screen.getByRole("region", { name: "3 attack types" })
    ).getAllByRole("row")
    expect(rows[2].textContent).toBe("Jailbreak201")
  })

  it("draws nothing for a suite with no red-team case", async () => {
    renderNavPage(RunDetailPage, stubClient(runAnswers(null)), { id: RUN_ID })
    await screen.findByRole("region", { name: "Verdict" })
    expect(screen.queryByRole("heading", { name: "Red team" })).toBeNull()
  })

  it("says so when no red-team case has a result yet", async () => {
    renderNavPage(
      RunDetailPage,
      stubClient(
        runAnswers(
          redTeamReport({ byType: [], total: 0, bypassed: 0, unscored: 0 })
        )
      ),
      {
        id: RUN_ID,
      }
    )
    expect(
      await screen.findByText("No red-team case has a result in this run yet.")
    ).toBeTruthy()
  })
})

function tabAnswers(overrides: Record<string, unknown> = {}) {
  return {
    "suites.detail": suite(),
    "cases.list": { items: [testCase(), leakageCase()] },
    "runs.list": { items: [run()], hasMore: false },
    "redteam.report": redTeamReport(),
    ...overrides,
  }
}

describe("Red team tab", () => {
  it("lists only the red-team cases, with their attack type", async () => {
    renderNavPage(SuiteDetailPage, stubClient(tabAnswers()), {
      id: SUITE_ID,
      tab: "redteam",
    })
    const table = await screen.findByRole("region", { name: "1 red-team case" })
    const row = within(table).getAllByRole("row")[1]
    expect(
      within(row).getByRole("link", { name: "leakage_direct_request" })
    ).toBeTruthy()
    expect(within(row).getByText("Leakage")).toBeTruthy()
    expect(within(table).queryByText("Reset password")).toBeNull()
  })

  it("shows how the newest completed run fared, and links to it", async () => {
    const { client, queries } = recordingFullClient(tabAnswers())
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "redteam" })
    expect(
      await screen.findByRole("heading", { name: "Newest completed run" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "run_…000050" }).getAttribute("href")
    ).toBe(`/runs/${RUN_ID}`)
    expect(queries.find((q) => q.intent === "runs.list")?.params).toEqual({
      suiteId: SUITE_ID,
      state: "completed",
      limit: 1,
    })
    expect(queries.find((q) => q.intent === "redteam.report")?.params).toEqual({
      runId: RUN_ID,
    })
  })

  it("says how to start when there are no red-team cases and no completed run", async () => {
    renderNavPage(
      SuiteDetailPage,
      stubClient(
        tabAnswers({
          "cases.list": { items: [testCase()] },
          "runs.list": { items: [], hasMore: false },
        })
      ),
      { id: SUITE_ID, tab: "redteam" }
    )
    expect(
      await screen.findByText(
        "No red-team cases yet. Generate some to see how the target holds up."
      )
    ).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: "Newest completed run" })
    ).toBeNull()
  })
})

describe("GenerateDialog", () => {
  async function openDialog(
    commands: Record<string, unknown> = {
      "redteam.generate": { created: 4, cap: 5 },
    }
  ) {
    const rec = recordingFullClient(tabAnswers(), commands)
    renderNavPage(SuiteDetailPage, rec.client, { id: SUITE_ID, tab: "redteam" })
    fireEvent.click(
      await screen.findByRole("button", { name: "Generate cases" })
    )
    return { ...rec, dialog: screen.getByRole("dialog") }
  }

  it("refuses to send without an attack type, in the server's words", async () => {
    const { dialog, sent } = await openDialog()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Generate cases" })
    )
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "choose at least one attack type"
    )
    expect(sent).toHaveLength(0)
  })

  it("says the most it will add, sends the types in the engine's order, and reports what was added", async () => {
    const { dialog, sent } = await openDialog()
    const boxes = within(dialog).getAllByRole("checkbox")
    expect(boxes).toHaveLength(5)
    fireEvent.click(boxes[4])
    fireEvent.click(boxes[2])
    fireEvent.change(within(dialog).getByLabelText("Cases per type"), {
      target: { value: "2" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Generate up to 4 cases" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(sent).toEqual([
      {
        intent: "redteam.generate",
        payload: {
          suiteId: SUITE_ID,
          attackTypes: ["leakage", "offtopic"],
          count: 2,
        },
      },
    ])
    expect(screen.getByRole("status").textContent).toBe(
      "Added 4 red-team cases. Start a run to score them."
    )
  })

  it("keeps the dialog open with the server's refusal", async () => {
    const rec = recordingFullClient(tabAnswers())
    const client = {
      ...rec.client,
      command: async () => {
        throw new ContractError(
          "BAD_REQUEST",
          "sentinel: invalid input: unknown attack type"
        )
      },
    }
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "redteam" })
    fireEvent.click(
      await screen.findByRole("button", { name: "Generate cases" })
    )
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0])
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Generate up to 5 cases" })
    )
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "unknown attack type"
    )
  })

  it("sends one command for a double click", async () => {
    let release: (v: unknown) => void = () => {}
    const rec = recordingFullClient(tabAnswers())
    const sent: string[] = []
    const client = {
      ...rec.client,
      command: (intent: string) => {
        sent.push(intent)
        return new Promise<unknown>((resolve) => {
          release = resolve
        })
      },
    } as typeof rec.client
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "redteam" })
    fireEvent.click(
      await screen.findByRole("button", { name: "Generate cases" })
    )
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0])
    const button = within(dialog).getByRole("button", {
      name: "Generate up to 5 cases",
    })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(sent).toEqual(["redteam.generate"])
    release({ created: 5, cap: 5 })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})
