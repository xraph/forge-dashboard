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

  it("offers one chain picker, not two, when the app has no chain of its own", async () => {
    const globex: StreamSummary = { ...acme, id: "stream_globex", tenantId: "globex", headSeq: 5000 }
    renderPage(
      ChainPage,
      client({ "streams.mine": {}, "streams.list": { streams: [acme, globex], total: 2, hasMore: false } }).client,
    )
    await waitFor(() => expect(screen.getByText(/This app has no app-level chain/)).toBeTruthy())
    expect(screen.getAllByRole("combobox", { name: "Chain" })).toHaveLength(1)
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

  it("never calls a checkpoint that reaches past the head at the head", async () => {
    // initech's shape: the chain was cut back after its last checkpoint was signed.
    const initech: StreamSummary = {
      ...acme,
      id: "stream_initech",
      tenantId: "initech",
      headSeq: 3000,
      latestCheckpoint: { id: "ckpt_initech_2", fromSeq: 1501, toSeq: 3400, eventCount: 1900, createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09" },
    }
    renderPage(ChainPage, client({ "streams.mine": { stream: initech } }).client)
    await waitFor(() => expect(screen.getByText(/400 sequences past the head/)).toBeTruthy())
    expect(screen.queryByText(/at the head/)).toBeNull()
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

describe("ChainPage, a chain wiped to head zero", () => {
  const wiped: StreamSummary = { ...acme, headSeq: 0, headHash: "", latestCheckpoint: { id: "ckpt_acme_6", fromSeq: 50001, toSeq: 60000, eventCount: 10000, createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09" } }
  // What the verifier answers when the head is zero but a signed checkpoint survives.
  const wipeReport = report({
    valid: false,
    verified: 0,
    firstEvent: 0,
    lastEvent: 0,
    headSeq: 0,
    headChecked: false,
    headMatch: false,
    coverage: undefined,
    checkpointsChecked: false,
    checkpointHeadChecked: true,
    checkpointHeadOk: false,
  })

  it("still offers the whole-chain check and asks for genesis to head with the stream alone", async () => {
    const c = client({ "streams.mine": { stream: wiped }, "verify.run": { noChain: false, report: wipeReport } })
    renderPage(ChainPage, c.client)
    const button = await screen.findByRole("button", { name: "Check the whole chain" })
    expect(button.hasAttribute("disabled")).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText(/a signed checkpoint says the chain once reached further/)).toBeTruthy())
    expect(c.queried.filter((q) => q.intent === "verify.run").map((q) => q.params)).toEqual([{ streamId: "stream_acme" }])
    expect(screen.getByRole("heading", { level: 2 }).className).toContain("text-destructive")
  })

  it("says the gap check did not run when nothing was examined", async () => {
    const c = client({ "streams.mine": { stream: wiped }, "verify.run": { noChain: false, report: wipeReport } })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check the whole chain" }))
    await waitFor(() => expect(screen.getByText("Gaps")).toBeTruthy())
    expect(screen.queryByText("No unexplained gaps")).toBeNull()
  })

  it("keeps the typed-range check closed at head zero", async () => {
    renderPage(ChainPage, client({ "streams.mine": { stream: wiped } }).client)
    expect((await screen.findByRole("button", { name: "Check this range" })).hasAttribute("disabled")).toBe(true)
  })
})

describe("ChainPage, never a cached verification", () => {
  const rangeA = report({ ...plainNoCheckpoints, verified: 10000, firstEvent: 2432, lastEvent: 12431, partial: true, headChecked: false, coverage: [{ fromSeq: 2432, toSeq: 12431, level: "unkeyed" }] })
  const rangeB = report({ ...plainNoCheckpoints, verified: 101, firstEvent: 100, lastEvent: 200, partial: true, headChecked: false, coverage: [{ fromSeq: 100, toSeq: 200, level: "unkeyed" }] })
  const setRange = (from: string, to: string) => {
    fireEvent.change(screen.getByLabelText("From sequence"), { target: { value: from } })
    fireEvent.change(screen.getByLabelText("To sequence"), { target: { value: to } })
  }

  it("does not show range A's old certificate while A is checked again after B", async () => {
    let aCalls = 0
    const c = client({
      "verify.run": (p: Record<string, unknown>) => {
        if (p.fromSeq === 100) return { noChain: false, report: rangeB }
        aCalls += 1
        return aCalls === 1 ? { noChain: false, report: rangeA } : new Promise(() => {})
      },
    })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("2,432"))
    setRange("100", "200")
    fireEvent.click(screen.getByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("100 to 200"))
    setRange("2432", "12431")
    fireEvent.click(screen.getByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(aCalls).toBe(2))
    expect(screen.getByText("Checking the chain...")).toBeTruthy()
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
  })

  it("shows the check running, not the last answer, when the same range is asked again", async () => {
    let calls = 0
    const c = client({
      "verify.run": () => {
        calls += 1
        return calls === 1 ? { noChain: false, report: plainNoCheckpoints } : new Promise(() => {})
      },
    })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/No corruption detected/)).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByText("Checking the chain...")).toBeTruthy()
    expect(screen.queryByText(/No corruption detected/)).toBeNull()
  })
})

describe("ChainPage, the chain list behind an app with no chain of its own", () => {
  it("says nothing about the scope's chains while they are still loading", async () => {
    const c = client({ "streams.mine": {}, "streams.list": () => new Promise(() => {}) })
    renderPage(ChainPage, c.client)
    await waitFor(() => expect(c.queried.some((q) => q.intent === "streams.list")).toBe(true))
    await screen.findByRole("status", { name: "Loading chains" })
    expect(screen.queryByText(/has not recorded any events/)).toBeNull()
    expect(screen.queryByText(/This app has no app-level chain/)).toBeNull()
  })

  it("shows the list's failure, not an empty scope, when the chains cannot be read", async () => {
    renderPage(ChainPage, client({ "streams.mine": {}, "streams.list": new ContractError("INTERNAL", "the stream store is down") }).client)
    await waitFor(() => expect(screen.getByText(/the stream store is down/)).toBeTruthy())
    expect(screen.queryByText(/has not recorded any events/)).toBeNull()
    expect(screen.queryByText(/This app has no app-level chain/)).toBeNull()
  })

  it("says the picker holds only the first 200 chains when there are more", async () => {
    const list = { streams: [own, acme], total: 250, hasMore: true }
    const first = renderPage(ChainPage, client({ "streams.list": list }).client)
    expect(await screen.findByText("Showing the first 200 chains.")).toBeTruthy()
    first.unmount()
    renderPage(ChainPage, client({ "streams.mine": {}, "streams.list": { ...list, hasMore: false } }).client)
    expect(await screen.findByText("Showing the first 200 chains.")).toBeTruthy()
  })

  it("says nothing about a limit when every chain is listed", async () => {
    renderPage(ChainPage, client({ "streams.list": { streams: [own, acme], total: 2, hasMore: false } }).client)
    await screen.findByLabelText("Chain")
    expect(screen.queryByText(/Showing the first/)).toBeNull()
  })
})

