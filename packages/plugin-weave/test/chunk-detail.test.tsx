import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ChunkDetailPage } from "../src/pages/chunk-detail"
import { renderPage, scriptedClient } from "./harness"

const CHUNK = "chk_01k70000000000000000000111"
const DOC = "doc_01k70000000000000000000001"
const COL = "col_01k70000000000000000000001"

function detail(over: Record<string, unknown> = {}) {
  return {
    chunk: {
      id: CHUNK, document_id: DOC, collection_id: COL, tenant_id: "",
      content: "The money goes back to the card or account you paid with.\nIf you paid with a gift card, the refund arrives as store credit.",
      index: 1, start_offset: 160, end_offset: 352, token_count: 48,
      metadata: { section: "refunds", lang: "en" }, created_at: "2026-10-04T09:00:00Z",
    },
    document_title: "Refund policy",
    previous_id: "chk_01k70000000000000000000110",
    next_id: "chk_01k70000000000000000000112",
    ...over,
  }
}

describe("ChunkDetailPage", () => {
  it("reads the chunk it was opened for and shows its full text", async () => {
    const { client, queried } = scriptedClient({ "chunks.get": detail() })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByText(/arrives as store credit/)).toBeTruthy()
    expect(queried[0]).toEqual({ intent: "chunks.get", params: { id: CHUNK } })
  })

  it("names its document, its offsets and its token estimate", async () => {
    const { client } = scriptedClient({ "chunks.get": detail() })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect((await screen.findByRole("link", { name: "Refund policy" })).getAttribute("href")).toBe(`/documents/${DOC}`)
    expect(screen.getByText("160 to 352")).toBeTruthy()
    expect(screen.getByText(/about 48 tokens \(characters ÷ 4\)/)).toBeTruthy()
    expect(screen.getByText("section")).toBeTruthy()
  })

  it("links the chunks either side", async () => {
    const { client } = scriptedClient({ "chunks.get": detail() })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect((await screen.findByRole("link", { name: "Previous chunk" })).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000110")
    expect(screen.getByRole("link", { name: "Next chunk" }).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000112")
  })

  it("marks the first chunk as having none before it", async () => {
    const { client } = scriptedClient({ "chunks.get": detail({ previous_id: "" }) })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByLabelText("no previous chunk")).toBeTruthy()
  })

  it("opens a chunk whose document is gone, and says so rather than linking it", async () => {
    const { client } = scriptedClient({ "chunks.get": detail({ document_title: "" }) })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByText("document deleted")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Refund policy" })).toBeNull()
    expect(screen.getByText(DOC).className).toContain("font-mono")
  })

  it("shows an error card for a chunk that doesn't exist", async () => {
    const { client } = scriptedClient({ "chunks.get": new ContractError("NOT_FOUND", "chunk not found") })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByText(/chunk not found/)).toBeTruthy()
  })
})
