import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ChainPage } from "../src/pages/chain"
import { renderPage, scriptedClient } from "./harness"
import type { StreamSummary } from "../src/types"
import { broken, plainNoCheckpoints, report } from "./verification/fixtures"

const own: StreamSummary = {
  id: "stream_app",
  appId: "app_chronicle",
  headHash: "9f2c61a04be7d85c3a1e0f47b6d29c85e1a3f0b7c4d2e6a8f9b0c1d2e3f4a5b6",
  headSeq: 12431,
  scheme: "chronicle/v4",
  schemeSince: 1,
  coverageCeiling: "unkeyed",
  checkpointingConfigured: false,
}
const acme: StreamSummary = { ...own, id: "stream_acme", tenantId: "acme", headSeq: 61004, scheme: "chronicle/v5", schemeSince: 48201, coverageCeiling: "signed", checkpointingConfigured: true }

function client(over: Record<string, unknown> = {}) {
  return scriptedClient({
    "streams.mine": (p) => (p.streamId === "stream_acme" ? { stream: acme } : { stream: own }),
    "streams.list": { streams: [own], total: 1, hasMore: false },
    "verify.run": { noChain: false, report: plainNoCheckpoints },
    ...over,
  })
}

describe("ChainPage", () => {
  it("shows the posture and runs nothing until asked", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    await waitFor(() => expect(screen.getByText("chronicle/v4")).toBeTruthy())
    expect(screen.getByText("12,431")).toBeTruthy()
    expect(c.queried.some((q) => q.intent === "verify.run")).toBe(false)
  })

  it("verifies the most recent 10,000 sequences by default", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/No corruption detected/)).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_app", fromSeq: 2432, toSeq: 12431 })
  })

  it("sends the range the operator typed", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    fireEvent.change(await screen.findByLabelText("From sequence"), { target: { value: "100" } })
    fireEvent.change(screen.getByLabelText("To sequence"), { target: { value: "200" } })
    fireEvent.click(screen.getByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_app", fromSeq: 100, toSeq: 200 }))
  })

  it("offers the whole chain when it fits under the cap, and says why not when it does not", async () => {
    const first = renderPage(ChainPage, client().client)
    expect((await screen.findByRole("button", { name: "Check the whole chain" })).hasAttribute("disabled")).toBe(false)
    first.unmount()
    renderPage(ChainPage, client({ "streams.mine": { stream: { ...own, headSeq: 250_000 } } }).client)
    expect((await screen.findByRole("button", { name: "Check the whole chain" })).hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(/checks at most 100,000 sequences at a time/)).toBeTruthy()
  })

  it("shows the server's refusal of an oversized range and offers a bounded window", async () => {
    const c = client({
      "verify.run": new ContractError("BAD_REQUEST", "requested range covers 200000 events, which exceeds the 100000-event limit on a single verification"),
    })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/exceeds the 100000-event limit/)).toBeTruthy())
    expect(screen.getByRole("button", { name: "Check the most recent 10,000 instead" })).toBeTruthy()
  })

  it("runs at once with the range a deep link names", async () => {
    const c = client({ "verify.run": { noChain: false, report: broken } })
    renderPage(ChainPage, c.client, { streamId: "stream_acme", fromSeq: "2730", toSeq: "2830" })
    await waitFor(() => expect(screen.getByText(/Breaks found/)).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_acme", fromSeq: 2730, toSeq: 2830 })
  })

  it("offers a tenant's chain to an app-wide operator whose app-level scope has none", async () => {
    renderPage(
      ChainPage,
      client({ "streams.mine": {}, "streams.list": { streams: [acme], total: 1, hasMore: false } }).client,
    )
    await waitFor(() => expect(screen.getByText(/This app has no app-level chain/)).toBeTruthy())
    expect(screen.getByLabelText("Chain")).toBeTruthy()
    expect(screen.queryByText(/has not recorded any events/)).toBeNull()
  })

  it("says the scope has recorded nothing when there are no chains at all", async () => {
    renderPage(ChainPage, client({ "streams.mine": {}, "streams.list": { streams: [], total: 0, hasMore: false } }).client)
    await waitFor(() => expect(screen.getByText(/has not recorded any events yet/)).toBeTruthy())
  })

  it("shows no picker to an operator with exactly one chain", async () => {
    renderPage(ChainPage, client().client)
    await waitFor(() => expect(screen.getByText("chronicle/v4")).toBeTruthy())
    expect(screen.queryByLabelText("Chain")).toBeNull()
  })

  it("shows the picker when there is more than one chain", async () => {
    renderPage(ChainPage, client({ "streams.list": { streams: [own, acme], total: 2, hasMore: false } }).client)
    expect(await screen.findByLabelText("Chain")).toBeTruthy()
  })

  it("never reads nothing verified as a pass", async () => {
    const c = client({ "verify.run": { noChain: false, report: report({ verified: 0, firstEvent: 0, lastEvent: 0, headSeq: 0, coverage: undefined, checkpointsChecked: false, checkpointHeadChecked: false, headChecked: false }) } })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText("No events verified.")).toBeTruthy())
  })

  it("shows how far the latest checkpoint sits behind the head", async () => {
    renderPage(
      ChainPage,
      client({ "streams.mine": { stream: { ...acme, latestCheckpoint: { id: "ckpt_acme_6", fromSeq: 50001, toSeq: 60000, eventCount: 10000, createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09" } } } }).client,
    )
    await waitFor(() => expect(screen.getByText(/1,004 events behind the head/)).toBeTruthy())
  })

  it("says checkpointing is off rather than that the chain has no checkpoints", async () => {
    renderPage(ChainPage, client().client)
    await waitFor(() => expect(screen.getByText(/This deployment takes no checkpoints/)).toBeTruthy())
  })

  it("refuses a To sequence above the head and says where the head is", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    fireEvent.change(await screen.findByLabelText("To sequence"), { target: { value: "12432" } })
    expect(screen.getByText("The chain's head is at sequence 12,431.")).toBeTruthy()
    const button = screen.getByRole("button", { name: "Check this range" })
    expect(button.hasAttribute("disabled")).toBe(true)
    fireEvent.click(button)
    expect(c.queried.some((q) => q.intent === "verify.run")).toBe(false)
    fireEvent.change(screen.getByLabelText("To sequence"), { target: { value: "12431" } })
    expect(screen.queryByText(/The chain's head is at sequence/)).toBeNull()
    expect(screen.getByRole("button", { name: "Check this range" }).hasAttribute("disabled")).toBe(false)
  })

  it("clamps a deep link's range to the head before it runs", async () => {
    const c = client({ "verify.run": { noChain: false, report: broken } })
    renderPage(ChainPage, c.client, { streamId: "stream_acme", fromSeq: "60000", toSeq: "99999" })
    await waitFor(() => expect(screen.getByText(/Breaks found/)).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_acme", fromSeq: 60000, toSeq: 61004 })
  })

  it("runs nothing for a deep link that starts past the head, and says why", async () => {
    const c = client()
    renderPage(ChainPage, c.client, { streamId: "stream_acme", fromSeq: "70000", toSeq: "70100" })
    await waitFor(() => expect(screen.getByText("The chain's head is at sequence 61,004.")).toBeTruthy())
    expect(c.queried.some((q) => q.intent === "verify.run")).toBe(false)
    expect(screen.getByRole("button", { name: "Check this range" }).hasAttribute("disabled")).toBe(true)
  })

  it("passes the deployment's checkpoint setting to the certificate", async () => {
    renderPage(ChainPage, client().client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getAllByText("Not checked, this deployment stores no checkpoints").length).toBeGreaterThan(0))
  })

  it("runs the same range again after a failure instead of doing nothing", async () => {
    let calls = 0
    const c = client({
      "verify.run": () => {
        calls += 1
        if (calls === 1) return new ContractError("INTERNAL", "the store timed out")
        return { noChain: false, report: plainNoCheckpoints }
      },
    })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/the store timed out/)).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/No corruption detected/)).toBeTruthy())
    expect(c.queried.filter((q) => q.intent === "verify.run")).toHaveLength(2)
  })
})
