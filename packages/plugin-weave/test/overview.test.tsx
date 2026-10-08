import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"

const COMPONENTS = {
  loader: { kind: "text", configured: true, content_types: ["text/plain"] },
  chunker: { kind: "recursive", configured: true },
  embedder: { kind: "", configured: false },
  vector_store: { kind: "memory", score: "cosine", tenant_filter: "verified", configured: true },
  retriever: { kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, configured: true },
  score: "mmr_relevance",
  tenant_filter: "verified",
}

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-07T09:00:00Z",
    updated_at: "2026-10-07T09:00:00Z",
    id: "doc_01k70000000000000000000001",
    collection_id: "col_01k70000000000000000000001",
    tenant_id: "",
    title: "Refund policy",
    content_hash: "ab".repeat(32),
    content_length: 4812,
    chunk_count: 6,
    metadata: {},
    state: "ready",
    collection_name: "support-articles",
    stalled: false,
    ...over,
  }
}

function overview(over: Record<string, unknown> = {}) {
  return {
    collections: 3,
    documents: 6,
    documents_by_state: { pending: 1, processing: 1, ready: 3, failed: 1 },
    chunks: 21,
    stalled: 1,
    stalled_after_seconds: 900,
    newest_documents: [
      doc(),
      doc({ id: "doc_01k70000000000000000000004", title: "Returns archive 2019", state: "processing", stalled: true, updated_at: "2026-10-07T06:00:00Z" }),
      doc({ id: "doc_01k70000000000000000000003", title: undefined, state: "failed", collection_name: "" }),
    ],
    components: COMPONENTS,
    scope: "all",
    ...over,
  }
}

function rowWith(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("OverviewPage", () => {
  it("asks system.overview with no tenant, because the dashboard sees every tenant", async () => {
    const { client, sent } = recordingQueryClient({ "system.overview": overview() })
    renderPage(OverviewPage, client)
    await screen.findByText("Refund policy")
    expect(sent.find((s) => s.intent === "system.overview")?.params).toEqual({})
    expect(screen.getByText(/sees every tenant's data/)).toBeTruthy()
  })

  it("counts collections, documents by state, chunks and stalled documents", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview() }))
    await screen.findByText("Refund policy")
    expect(screen.getByText("Looks stalled")).toBeTruthy()
    expect(screen.getByText(/processing with no update for 15 min/)).toBeTruthy()
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.getByText("21")).toBeTruthy()
  })

  it("lists the newest documents with the five conventions", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview() }))
    const title = await screen.findByText("Refund policy")
    expect(title.className).toContain("font-medium")
    expect(screen.getByText("doc_01k70000000000000000000001").className).toContain("font-mono")
    expect(screen.getByText("3 newest documents")).toBeTruthy()
    expect(within(rowWith("Returns archive 2019")).getByText(/no update for/)).toBeTruthy()
    const failed = rowWith("failed")
    expect(within(failed).getByLabelText("no title")).toBeTruthy()
    expect(within(failed).getByText("deleted collection")).toBeTruthy()
  })

  it("says so when there are no documents yet", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview({ newest_documents: [], documents: 0 }) }))
    expect(await screen.findByText("0 newest documents")).toBeTruthy()
    expect(screen.getByText(/No documents yet/)).toBeTruthy()
  })

  it("names each stage it runs and says which are not configured", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview() }))
    await screen.findByText("Refund policy")
    expect(screen.getByText("mmr").className).toContain("font-mono")
    expect(screen.getByLabelText("no embedder")).toBeTruthy()
    expect(screen.getByRole("link", { name: /pipeline/i }).getAttribute("href")).toBe("/pipeline")
  })

  it("shows an error card when the overview cannot be read", async () => {
    renderPage(OverviewPage, failingClient(new ContractError("UNAVAILABLE", "Weave has no metadata store configured")))
    expect(await screen.findByText(/no metadata store configured/)).toBeTruthy()
  })
})
