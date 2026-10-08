import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CheckpointDetailPage } from "../src/pages/checkpoint-detail"
import { failingClient, renderPage, scriptedClient } from "./harness"
import type { StreamSummary } from "../src/types"

const checkpoint = {
  id: "ckpt_acme_6",
  fromSeq: 50001,
  toSeq: 60000,
  eventCount: 10000,
  createdAt: "2026-09-29T10:00:00Z",
  signKeyId: "sk_2026_09",
}
const acme: StreamSummary = {
  id: "stream_acme",
  appId: "app_chronicle",
  tenantId: "acme",
  headHash: "ab",
  headSeq: 61004,
  scheme: "chronicle/v5",
  schemeSince: 48201,
  coverageCeiling: "signed",
  checkpointingConfigured: true,
}
const list = (...streams: StreamSummary[]) => ({
  streams,
  total: streams.length,
  hasMore: false,
})

describe("CheckpointDetailPage", () => {
  it("shows the range, the count, the key and a link to verify the range it covers", async () => {
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": list(acme),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    await waitFor(() => expect(screen.getByText("sk_2026_09")).toBeTruthy())
    expect(screen.getByText("10,000")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: /Verify sequences 50,001 to 60,000/ })
        .getAttribute("href")
    ).toContain("/chain/")
    expect(
      c.queried.find((q) => q.intent === "checkpoints.detail")?.params
    ).toEqual({ id: "ckpt_acme_6" })
  })

  it("links straight to the chain the checkpoint names, without listing chains", async () => {
    // The list would infer acme, the only chain reaching the checkpoint. The
    // record's own streamId wins, and the list is never asked for.
    const c = scriptedClient({
      "checkpoints.detail": {
        checkpoint: { ...checkpoint, streamId: "stream_globex" },
      },
      "streams.list": list(acme),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    const link = await screen.findByRole("link", {
      name: /Verify sequences 50,001 to 60,000/,
    })
    expect(link.getAttribute("href")).toBe("/chain/stream_globex/50001/60000")
    expect(c.queried.some((q) => q.intent === "streams.list")).toBe(false)
  })

  // Everything below answers without a streamId, the way a server from before
  // it existed does, so the owner still has to be inferred from the chains.

  it("links to the one chain that reaches the checkpoint, ignoring one that has not got that far", async () => {
    const short: StreamSummary = {
      ...acme,
      id: "stream_globex",
      tenantId: "globex",
      headSeq: 900,
    }
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": list(short, acme),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    const link = await screen.findByRole("link", {
      name: /Verify sequences 50,001 to 60,000/,
    })
    expect(link.getAttribute("href")).toBe("/chain/stream_acme/50001/60000")
  })

  it("names the owner outright when a chain's latest checkpoint is this one", async () => {
    const other: StreamSummary = {
      ...acme,
      id: "stream_globex",
      tenantId: "globex",
      headSeq: 70000,
    }
    const owner: StreamSummary = { ...acme, latestCheckpoint: checkpoint }
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": list(other, owner),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    const link = await screen.findByRole("link", {
      name: /Verify sequences 50,001 to 60,000/,
    })
    expect(link.getAttribute("href")).toBe("/chain/stream_acme/50001/60000")
  })

  it("falls back to the list rather than guess when more than one chain reaches the checkpoint", async () => {
    const other: StreamSummary = {
      ...acme,
      id: "stream_globex",
      tenantId: "globex",
      headSeq: 70000,
    }
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": list(acme, other),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    const link = await screen.findByRole("link", {
      name: "Back to checkpoints",
    })
    expect(link.getAttribute("href")).toBe("/checkpoints")
    expect(screen.queryByRole("link", { name: /Verify sequences/ })).toBeNull()
  })

  it("does not infer the owner from a truncated chain list", async () => {
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": { streams: [acme], total: 250, hasMore: true },
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    expect(
      await screen.findByRole("link", { name: "Back to checkpoints" })
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Verify sequences/ })).toBeNull()
  })

  it("keeps an exact latest-checkpoint match even on a truncated list", async () => {
    const owner: StreamSummary = { ...acme, latestCheckpoint: checkpoint }
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": { streams: [owner], total: 250, hasMore: true },
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    expect(
      (
        await screen.findByRole("link", { name: /Verify sequences/ })
      ).getAttribute("href")
    ).toBe("/chain/stream_acme/50001/60000")
  })

  it("does not count a chain that takes no checkpoints as the owner", async () => {
    const plain: StreamSummary = {
      ...acme,
      id: "stream_globex",
      tenantId: "globex",
      checkpointingConfigured: false,
    }
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": list(plain, acme),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    expect(
      (
        await screen.findByRole("link", { name: /Verify sequences/ })
      ).getAttribute("href")
    ).toBe("/chain/stream_acme/50001/60000")
  })

  it("still shows the checkpoint when the chains cannot be listed", async () => {
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint },
      "streams.list": new ContractError("TRANSPORT", "down"),
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    expect(await screen.findByText("sk_2026_09")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Back to checkpoints" })
    ).toBeTruthy()
  })

  it("answers a checkpoint that is not yours the same as one that does not exist", async () => {
    renderPage(
      CheckpointDetailPage,
      failingClient(new ContractError("NOT_FOUND", "not found")),
      { id: "ckpt_x" }
    )
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy())
  })
})
