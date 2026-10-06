import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { RunsPage } from "../src/pages/runs"
import { run, RUN_ID, runningRun, suite, SUITE_ID } from "./fixtures"
import { recordingFullClient, renderNavPage, stubClient } from "./harness"
import type { Run } from "../src/types"

const OTHER_SUITE = "suite_01j9se00000000000000000009"

function answers(items: Run[] = [runningRun(), run()], hasMore = false) {
  return {
    "runs.list": { items, hasMore },
    "suites.list": { items: [suite(), suite({ id: OTHER_SUITE, name: "Sales assistant" })] },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("RunsPage", () => {
  it("lists runs newest first with their suite, state and progress", async () => {
    renderNavPage(RunsPage, stubClient(answers()), {})
    const table = await screen.findByRole("region", { name: "2 runs, newest first" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[1]).getByText("Running")).toBeTruthy()
    expect(within(rows[1]).getByText("2 of 4")).toBeTruthy()
    expect(within(rows[1]).getByRole("progressbar", { name: "Cases scored" })).toBeTruthy()
    expect(within(rows[2]).getByRole("link", { name: RUN_ID }).getAttribute("href")).toBe(`/runs/${RUN_ID}`)
    expect(within(rows[2]).getByRole("link", { name: "Support assistant" }).getAttribute("href")).toBe(`/suites/${SUITE_ID}`)
    expect(within(rows[2]).queryByRole("progressbar")).toBeNull()
    expect(within(rows[2]).getByText("$0.0123")).toBeTruthy()
  })

  it("leaves empty filters out of the request, and sends each one chosen", async () => {
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(RunsPage, client, {})
    await screen.findByRole("region", { name: "2 runs, newest first" })
    expect(queries.find((q) => q.intent === "runs.list")?.params).toEqual({ limit: 25, offset: 0 })
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "failed" } })
    fireEvent.change(screen.getByLabelText("Suite"), { target: { value: OTHER_SUITE } })
    await waitFor(() =>
      expect(queries.filter((q) => q.intent === "runs.list").at(-1)?.params).toEqual({
        limit: 25,
        offset: 0,
        suiteId: OTHER_SUITE,
        state: "failed",
      }),
    )
  })

  it("pages by offset and says which runs are showing", async () => {
    const { client, queries } = recordingFullClient(answers([run()], true))
    renderNavPage(RunsPage, client, {})
    await screen.findByRole("region", { name: "Runs 1 to 1, newest first" })
    expect(screen.getByRole("button", { name: "Newer runs" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Older runs" }))
    await waitFor(() => expect(queries.filter((q) => q.intent === "runs.list").at(-1)?.params).toMatchObject({ offset: 25 }))
    expect(await screen.findByRole("region", { name: "Runs 26 to 26, newest first" })).toBeTruthy()
  })

  it("says there are no runs yet, or that none match the filters", async () => {
    renderNavPage(RunsPage, stubClient(answers([])), {})
    expect(await screen.findByText("No runs yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "running" } })
    expect(await screen.findByText("No runs match these filters.")).toBeTruthy()
  })

  it("refreshes every three seconds while a run on the page is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingFullClient(answers())
    renderNavPage(RunsPage, client, {})
    await screen.findByRole("region", { name: "2 runs, newest first" })
    const before = queries.filter((q) => q.intent === "runs.list").length
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(queries.filter((q) => q.intent === "runs.list").length).toBe(before + 1)
  })

  it("does not refresh when nothing on the page is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingFullClient(answers([run()]))
    renderNavPage(RunsPage, client, {})
    await screen.findByRole("region", { name: "1 run, newest first" })
    const before = queries.length
    await act(async () => {
      vi.advanceTimersByTime(9000)
    })
    expect(queries.length).toBe(before)
  })
})
