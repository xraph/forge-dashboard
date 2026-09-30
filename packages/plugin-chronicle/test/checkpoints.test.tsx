import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { CheckpointsPage } from "../src/pages/checkpoints"
import { renderPage, scriptedClient } from "./harness"
import type { CheckpointSummary, StreamSummary } from "../src/types"

const stream: StreamSummary = {
  id: "stream_acme", appId: "app_chronicle", tenantId: "acme", headHash: "ab", headSeq: 61004,
  scheme: "chronicle/v5", schemeSince: 48201, coverageCeiling: "signed", checkpointingConfigured: true,
}
const cp = (n: number): CheckpointSummary => ({
  id: `ckpt_acme_${n}`, fromSeq: (n - 1) * 10000 + 1, toSeq: n * 10000, eventCount: 10000,
  createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09",
})

function client(over: Record<string, unknown> = {}) {
  return scriptedClient(
    {
      "streams.mine": { stream },
      "streams.list": { streams: [stream], total: 1, hasMore: false },
      "checkpoints.list": { checkpoints: [cp(6), cp(5)], hasMore: false, supported: true },
      ...over,
    },
    { "checkpoints.take": { checkpoint: cp(7), upToDate: false } },
  )
}

describe("CheckpointsPage", () => {
  it("lists the chain's checkpoints with ids and ranges in mono and a live caption", async () => {
    renderPage(CheckpointsPage, client().client)
    await waitFor(() => expect(screen.getByText("ckpt_acme_6")).toBeTruthy())
    expect(screen.getByText("ckpt_acme_6").className).toContain("font-mono")
    expect(screen.getByText(/2 checkpoints shown/)).toBeTruthy()
  })

  it("says a deployment with no checkpoint store stores none, even when the list is null", async () => {
    renderPage(CheckpointsPage, client({ "checkpoints.list": { checkpoints: null, hasMore: false, supported: false } }).client)
    await waitFor(() => expect(screen.getByText(/This deployment stores no checkpoints/)).toBeTruthy())
    expect(screen.queryByRole("button", { name: "Take a checkpoint" })).toBeNull()
  })

  it("says a chain with none yet has none yet", async () => {
    renderPage(CheckpointsPage, client({ "checkpoints.list": { checkpoints: [], hasMore: false, supported: true } }).client)
    await waitFor(() => expect(screen.getByText(/This chain has no checkpoints yet/)).toBeTruthy())
    expect(screen.getByText(/0 checkpoints shown/)).toBeTruthy()
  })

  it("reads a null list on a supporting deployment as an empty one", async () => {
    renderPage(CheckpointsPage, client({ "checkpoints.list": { checkpoints: null, hasMore: false, supported: true } }).client)
    await waitFor(() => expect(screen.getByText(/This chain has no checkpoints yet/)).toBeTruthy())
    expect(screen.getByText(/0 checkpoints shown/)).toBeTruthy()
  })

  it("asks for the selected chain's checkpoints", async () => {
    const c = client()
    renderPage(CheckpointsPage, c.client, { streamId: "stream_acme" })
    await waitFor(() => expect(screen.getByText("ckpt_acme_6")).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "checkpoints.list")?.params).toEqual({ streamId: "stream_acme", limit: 50, offset: 0 })
  })

  it("pages forward with hasMore and no invented total", async () => {
    const c = client({ "checkpoints.list": { checkpoints: [cp(6)], hasMore: true, supported: true } })
    renderPage(CheckpointsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "checkpoints.list").pop()?.params).toMatchObject({ offset: 50 }))
    expect(screen.queryByText(/of \d/)).toBeNull()
  })

  it("takes a checkpoint of the chain being shown and reports it", async () => {
    const c = client()
    renderPage(CheckpointsPage, c.client, { streamId: "stream_acme" })
    fireEvent.click(await screen.findByRole("button", { name: "Take a checkpoint" }))
    // The id sits in its own mono span, so the sentence is read off the status region, not one text node.
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Checkpoint ckpt_acme_7 signed/))
    expect(screen.getByText("ckpt_acme_7").className).toContain("font-mono")
    expect(c.sent).toEqual([{ intent: "checkpoints.take", payload: { streamId: "stream_acme" } }])
  })

  it("says the chain is already checkpointed to its head when there is nothing new", async () => {
    const c = scriptedClient(
      { "streams.mine": { stream }, "streams.list": { streams: [stream], total: 1, hasMore: false }, "checkpoints.list": { checkpoints: [], hasMore: false, supported: true } },
      { "checkpoints.take": { upToDate: true } },
    )
    renderPage(CheckpointsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Take a checkpoint" }))
    await waitFor(() => expect(screen.getByText(/Nothing new since the last checkpoint/)).toBeTruthy())
  })

  it("shows a refused take where the operator is looking", async () => {
    const c = scriptedClient(
      { "streams.mine": { stream }, "streams.list": { streams: [stream], total: 1, hasMore: false }, "checkpoints.list": { checkpoints: [], hasMore: false, supported: true } },
      { "checkpoints.take": new ContractError("PERMISSION_DENIED", "") },
    )
    renderPage(CheckpointsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Take a checkpoint" }))
    await waitFor(() => expect(within(screen.getByRole("alert")).getByText(/PERMISSION_DENIED/)).toBeTruthy())
  })

  it("offers the chain picker only when there is a choice, on the checkpoints route", async () => {
    const other: StreamSummary = { ...stream, id: "stream_globex", tenantId: "globex" }
    renderPage(CheckpointsPage, client({ "streams.list": { streams: [stream, other], total: 2, hasMore: false } }).client, { streamId: "stream_acme" })
    expect(await screen.findByRole("combobox", { name: "Chain" })).toBeTruthy()
  })

  it("starts again from the first page when the chain being shown changes", async () => {
    const c = client({ "checkpoints.list": { checkpoints: [cp(6)], hasMore: true, supported: true } })
    const view = renderPage(CheckpointsPage, c.client, { streamId: "stream_acme" })
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "checkpoints.list").pop()?.params).toMatchObject({ offset: 50 }))
    view.rerender(
      <PluginProvider client={c.client}>
        <CheckpointsPage params={{ streamId: "stream_globex" }} />
      </PluginProvider>,
    )
    await waitFor(() =>
      expect(c.queried.filter((q) => q.intent === "checkpoints.list").pop()?.params).toEqual({ streamId: "stream_globex", limit: 50, offset: 0 }),
    )
  })

  it("offers the tenant chains, and no take, when the app has no chain of its own", async () => {
    renderPage(CheckpointsPage, client({ "streams.mine": {} }).client)
    expect(await screen.findByText(/This app has no app-level chain: its events are recorded under its tenants\. Choose a tenant's chain to see its checkpoints\./)).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Chain" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Take a checkpoint" })).toBeNull()
    expect(screen.queryByText(/has no checkpoints yet/)).toBeNull()
  })

  it("says there are no checkpoints when the scope has recorded nothing at all", async () => {
    renderPage(CheckpointsPage, client({ "streams.mine": {}, "streams.list": { streams: [], total: 0, hasMore: false } }).client)
    expect(await screen.findByText(/This scope has not recorded any events yet, so there are no checkpoints\./)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Take a checkpoint" })).toBeNull()
    expect(screen.queryByText(/has no checkpoints yet/)).toBeNull()
  })

  it("does not say a chain has no checkpoints before it knows whether there is a chain", async () => {
    const c = client({ "streams.mine": {} })
    renderPage(CheckpointsPage, c.client)
    expect(screen.queryByText(/has no checkpoints yet/)).toBeNull()
    await screen.findByText(/This app has no app-level chain/)
    expect(c.queried.some((q) => q.intent === "checkpoints.list")).toBe(false)
  })
})
