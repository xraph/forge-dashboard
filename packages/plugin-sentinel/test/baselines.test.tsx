import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { BaselineDetailPage } from "../src/pages/baseline-detail"
import { BaselinesPage } from "../src/pages/baselines"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { baseline, baselineDetail, BASELINE_ID, CASE_ID, suite, SUITE_ID } from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"

const OLD = "base_01j9se00000000000000000070"

function list() {
  return {
    "baselines.list": {
      items: [baseline(), baseline({ id: OLD, name: "Release 1.3", isCurrent: false, passRate: 0.8 })],
    },
  }
}

describe("BaselinesPage", () => {
  it("lists every suite's baselines with the current one marked", async () => {
    renderNavPage(BaselinesPage, stubClient(list()), {})
    const table = await screen.findByRole("region", { name: "2 baselines, newest first" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[1]).getByRole("link", { name: "Release 1.4" }).getAttribute("href")).toBe(`/baselines/${BASELINE_ID}`)
    expect(within(rows[1]).getByText("Current")).toBeTruthy()
    expect(within(rows[1]).getByRole("link", { name: "Support assistant" })).toBeTruthy()
    expect(within(rows[2]).queryByText("Current")).toBeNull()
  })

  it("asks for every suite when it has none to scope to", async () => {
    const { client, queries } = recordingFullClient(list())
    renderNavPage(BaselinesPage, client, {})
    await screen.findByRole("region", { name: "2 baselines, newest first" })
    expect(queries.find((q) => q.intent === "baselines.list")?.params).toBeUndefined()
  })

  it("says where a baseline comes from when there is none", async () => {
    renderNavPage(BaselinesPage, stubClient({ "baselines.list": { items: [] } }), {})
    expect(
      await screen.findByText("No baselines yet. Save one from a completed run's page, and later runs are compared with it."),
    ).toBeTruthy()
  })

  it("warns that deleting the current baseline leaves later runs with nothing to compare against", async () => {
    const { client, sent } = recordingFullClient(list(), { "baselines.delete": { baselineId: BASELINE_ID } })
    renderNavPage(BaselinesPage, client, {})
    fireEvent.click(await screen.findByRole("button", { name: "Delete Release 1.4" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Nothing takes its place", { exact: false })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete baseline" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "baselines.delete", payload: { baselineId: BASELINE_ID } }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("deletes a past baseline without the warning", async () => {
    renderNavPage(BaselinesPage, stubClient(list()), {})
    fireEvent.click(await screen.findByRole("button", { name: "Delete Release 1.3" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).queryByText("Nothing takes its place", { exact: false })).toBeNull()
    expect(within(dialog).getByText("The run it came from is kept. This cannot be undone.")).toBeTruthy()
  })

  it("shows a refused delete inside the dialog", async () => {
    const client = {
      ...stubClient(list()),
      command: async () => {
        throw new ContractError("NOT_FOUND", "baseline not found")
      },
    }
    renderNavPage(BaselinesPage, client, {})
    fireEvent.click(await screen.findByRole("button", { name: "Delete Release 1.3" }))
    const dialog = screen.getByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete baseline" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("baseline not found")
  })
})

describe("Baselines tab", () => {
  it("lists the suite's baselines, scoped to it, without a suite column", async () => {
    const { client, queries } = recordingFullClient({ "suites.detail": suite(), ...list() })
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID, tab: "baselines" })
    const table = await screen.findByRole("region", { name: "2 baselines, newest first" })
    expect(queries.find((q) => q.intent === "baselines.list")?.params).toEqual({ suiteId: SUITE_ID })
    expect(within(table).queryByRole("columnheader", { name: "Suite" })).toBeNull()
  })
})

describe("BaselineDetailPage", () => {
  it("shows the baseline, the run it came from and its saved results", async () => {
    renderNavPage(BaselineDetailPage, stubClient({ "baselines.detail": baselineDetail() }), { id: BASELINE_ID })
    expect(await screen.findByRole("heading", { level: 1, name: "Release 1.4" })).toBeTruthy()
    expect(screen.getByText("Support assistant's current baseline: its runs are compared with this one.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "run_…000040" }).getAttribute("href")).toBe("/runs/run_01j9se00000000000000000040")
    const results = screen.getByRole("region", { name: "2 results, errors included" })
    const rows = within(results).getAllByRole("row")
    expect(within(rows[1]).getByRole("link", { name: "Reset password" }).getAttribute("href")).toBe(
      `/suites/${SUITE_ID}/cases/${CASE_ID}`,
    )
    expect(within(rows[2]).getByText("Fail")).toBeTruthy()
    expect(screen.getByText("persona")).toBeTruthy()
  })

  it("leaves for the suite's baselines after a delete", async () => {
    const { client } = recordingFullClient(
      { "baselines.detail": baselineDetail() },
      { "baselines.delete": { baselineId: BASELINE_ID } },
    )
    const { navigate } = renderNavPage(BaselineDetailPage, client, { id: BASELINE_ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete baseline" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/suites/${SUITE_ID}/baselines`))
  })

  it("shows a missing baseline as an error with its code", async () => {
    const { client } = recordingFullClient(() => new ContractError("NOT_FOUND", "baseline not found"))
    renderNavPage(BaselineDetailPage, client, { id: "base_missing" })
    expect((await screen.findByText("NOT_FOUND: baseline not found")).getAttribute("role")).toBe("alert")
  })
})
