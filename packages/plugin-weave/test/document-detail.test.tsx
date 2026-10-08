import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { DocumentDetailPage } from "../src/pages/document-detail"
import { renderWithNavigate, scriptedClient } from "./harness"

const DOC = "doc_01k70000000000000000000002"
const COL = "col_01k70000000000000000000001"
const HASH = "9f2c".repeat(16)

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T09:00:00Z",
    id: DOC, collection_id: COL, tenant_id: "", title: "Shipping FAQ",
    source: "https://help.example.com/shipping.html", source_type: "text/html",
    content_hash: HASH, content_length: 9000, chunk_count: 3, metadata: { lang: "en" },
    state: "ready", collection_name: "support-articles", stalled: false, ...over,
  }
}

const SPANS = {
  document_id: DOC,
  content_length: 9000,
  spans: [
    { id: "chk_01k70000000000000000000110", index: 0, start_offset: 0, end_offset: 192, token_count: 48 },
    { id: "chk_01k70000000000000000000111", index: 1, start_offset: 160, end_offset: 352, token_count: 48 },
    { id: "chk_01k70000000000000000000112", index: 2, start_offset: 368, end_offset: 448, token_count: 20 },
  ],
  total: 3,
  complete: true,
}

const CHUNKS = {
  items: [
    { id: "chk_01k70000000000000000000110", document_id: DOC, collection_id: COL, tenant_id: "", content: "Standard shipping takes three to five working days.", index: 0, start_offset: 0, end_offset: 192, token_count: 48, metadata: {}, created_at: "2026-10-05T09:00:00Z" },
    { id: "chk_01k70000000000000000000111", document_id: DOC, collection_id: COL, tenant_id: "", content: "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and express arrives the next working day.", index: 1, start_offset: 160, end_offset: 352, token_count: 48, metadata: {}, created_at: "2026-10-05T09:00:00Z" },
    { id: "chk_01k70000000000000000000112", document_id: DOC, collection_id: COL, tenant_id: "", content: "Orders over 50 euros ship free.", index: 2, start_offset: 368, end_offset: 448, token_count: 20, metadata: {}, created_at: "2026-10-05T09:00:00Z" },
  ],
  total: 3,
  limit: 100,
  offset: 0,
}

function queries(over: Record<string, unknown> = {}) {
  return { "documents.get": doc(), "documents.spans": SPANS, "chunks.list": CHUNKS, ...over }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DocumentDetailPage", () => {
  it("reads the document, its spans and its first page of chunks", async () => {
    const { client, queried } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    await screen.findByRole("heading", { name: "Shipping FAQ" })
    expect(queried).toContainEqual({ intent: "documents.get", params: { id: DOC } })
    expect(queried).toContainEqual({ intent: "documents.spans", params: { id: DOC } })
    await waitFor(() => expect(queried).toContainEqual({ intent: "chunks.list", params: { document_id: DOC, limit: 100, offset: 0 } }))
  })

  it("shows the full hash and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect((await screen.findByText(HASH)).className).toContain("font-mono")
    fireEvent.click(screen.getByRole("button", { name: "Copy the content hash" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH))
    expect(await screen.findByText("Copied")).toBeTruthy()
  })

  it("links its collection and names its size as the raw input", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect((await screen.findByRole("link", { name: "support-articles" })).getAttribute("href")).toBe(`/collections/${COL}`)
    expect(screen.getByText("9,000 B")).toBeTruthy()
  })

  it("shows a failed document's stored error in an alert", async () => {
    const { client } = scriptedClient(queries({ "documents.get": doc({ state: "failed", chunk_count: 0, error: "vector upsert: connection refused" }) }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Ingest failed")).toBeTruthy()
    expect(screen.getByText("vector upsert: connection refused")).toBeTruthy()
  })

  it("says a stalled document looks stalled, with its age, and does not call it dead", async () => {
    const { client } = scriptedClient(queries({ "documents.get": doc({ state: "processing", stalled: true, updated_at: "2020-01-01T00:00:00Z" }) }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Looks stalled")).toBeTruthy()
    expect(screen.queryByText(/dead/i)).toBeNull()
  })

  it("draws each chunk as a byte range linked to the chunk, and names the gap", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    const map = await screen.findByRole("img", { name: /3 chunks over 448 B/ })
    expect(within(map).getByRole("link", { name: "Chunk 1, bytes 160 to 352" }).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000111")
    expect(screen.getByText("Bytes 352 to 368 are in no chunk.")).toBeTruthy()
  })

  it("says the raw input and the chunk offsets don't share a scale when a loader changed the text", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText(/a loader changed the text/)).toBeTruthy()
  })

  it("says when it shows only the first spans", async () => {
    const { client } = scriptedClient(queries({ "documents.spans": { ...SPANS, total: 7000, complete: false } }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Showing the first 3 of 7,000 chunks.")).toBeTruthy()
  })

  it("reads every chunk in order with its overlap marked", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Standard shipping takes three to five working days.")).toBeTruthy()
    const mark = await screen.findByTitle("Overlaps the previous chunk")
    expect(mark.textContent).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
  })

  it("deletes after confirming, then leaves for the documents list", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.delete": { id: DOC } })
    const { navigate } = renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete document" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/documents", { replace: true }))
    expect(sent).toEqual([{ intent: "documents.delete", payload: { id: DOC } }])
  })

  it("keeps a failed delete inside the dialog", async () => {
    const { client } = scriptedClient(queries(), { "documents.delete": new ContractError("NOT_FOUND", "document not found") })
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete document" }))
    expect(await within(dialog).findByText("document not found")).toBeTruthy()
  })

  it("shows an error card for a document that doesn't exist", async () => {
    const { client } = scriptedClient(queries({ "documents.get": new ContractError("NOT_FOUND", "document not found") }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText(/document not found/)).toBeTruthy()
  })
})
