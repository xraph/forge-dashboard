import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { IngestPage } from "../src/pages/ingest"
import { renderPage, scriptedClient } from "./harness"

const ID = "col_01k70000000000000000000001"
const DOC = "doc_01k70000000000000000001001"

const DETAIL = {
  created_at: "2026-09-07T09:00:00Z", updated_at: "2026-09-07T09:00:00Z", id: ID, name: "support-articles",
  tenant_id: "", app_id: "", embedding_model: "text-embedding-3-small", embedding_dims: 1536, chunk_strategy: "recursive",
  chunk_size: 48, chunk_overlap: 8, metadata: {}, document_count: 5, chunk_count: 21,
  documents_by_state: { pending: 0, processing: 0, ready: 5, failed: 0 }, stalled: 0,
}

const COMPONENTS = {
  components: {
    loader: { kind: "text", configured: true, content_types: ["text/plain", "text/markdown", "text/html"] },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true, dimensions: 1536 },
    vector_store: { kind: "memory", configured: true },
    retriever: { kind: "mmr", configured: true },
    score: "mmr_relevance",
    tenant_filter: "verified",
  },
  config: { default_chunk_size: 512, default_chunk_overlap: 50, default_embedding_model: "m", default_chunk_strategy: "recursive", default_top_k: 10, shutdown_timeout_seconds: 30 },
  extensions: [],
}

function queries() {
  return { "collections.get": DETAIL, "system.components": COMPONENTS }
}

async function paste(text: string) {
  fireEvent.change(await screen.findByLabelText("Content"), { target: { value: text } })
}

describe("IngestPage", () => {
  it("names the collection and the content types the loader reads", async () => {
    const { client, queried } = scriptedClient(queries(), {})
    renderPage(IngestPage, client, { id: ID })
    expect(await screen.findByText(/into support-articles/)).toBeTruthy()
    expect(queried).toContainEqual({ intent: "collections.get", params: { id: ID } })
    // Once in the content type picker and once in the list of what the loader reads.
    expect(screen.getAllByText("text/markdown").length).toBe(2)
  })

  it("sends pasted text with its title, source, type and metadata", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 3 } })
    renderPage(IngestPage, client, { id: ID })
    await paste("Refunds take 14 days.")
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Refunds" } })
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText("Ready: 3 chunks.")).toBeTruthy()
    expect(sent).toEqual([
      { intent: "documents.ingest", payload: { collection_id: ID, title: "Refunds", source: "", source_type: "text/plain", content: "Refunds take 14 days.", metadata: {} } },
    ])
    expect(screen.getByRole("link", { name: "Open the document" }).getAttribute("href")).toBe(`/documents/${DOC}`)
  })

  it("reads a picked file as text and takes its type from the name", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 1 } })
    renderPage(IngestPage, client, { id: ID })
    const file = new File(["# Shipping\nThree to five days."], "shipping.md", { type: "text/markdown" })
    fireEvent.change(await screen.findByLabelText("Pick a text file"), { target: { files: [file] } })
    await waitFor(() => expect((screen.getByLabelText("Content") as HTMLTextAreaElement).value).toBe("# Shipping\nThree to five days."))
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("shipping.md")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as Record<string, unknown>).source_type).toBe("text/markdown")
    expect((sent[0].payload as Record<string, unknown>).source).toBe("shipping.md")
  })

  it("shows a failed ingest as an answer, with the stored error and a link", async () => {
    const { client } = scriptedClient(queries(), {
      "documents.ingest": { document_id: DOC, state: "failed", chunk_count: 0, error: "embed: provider answered 503 Service Unavailable" },
    })
    renderPage(IngestPage, client, { id: ID })
    await paste("Some text.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText(/provider answered 503/)).toBeTruthy()
    expect(screen.getByText("Ingest failed")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open the document" }).getAttribute("href")).toBe(`/documents/${DOC}`)
  })

  it("explains a duplicate and links to the copies you might delete", async () => {
    const message = "this collection already has a document with exactly the same content (including a failed or stalled one; delete it to ingest again)"
    const { client } = scriptedClient(queries(), { "documents.ingest": new ContractError("CONFLICT", message) })
    renderPage(IngestPage, client, { id: ID })
    await paste("Refunds take 14 days.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Failed documents in this collection" }).getAttribute("href")).toBe(`/@weave/documents?collection_id=${ID}&state=failed`)
    expect(screen.getByRole("link", { name: "Processing documents in this collection" }).getAttribute("href")).toBe(`/@weave/documents?collection_id=${ID}&state=processing`)
  })

  it("warns that the encoded request is over the default transport limit, and sends only when asked", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 1 } })
    renderPage(IngestPage, client, { id: ID })
    await paste("a\n".repeat(400_000))
    expect(screen.getByText(/contract_max_body_bytes/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Ingest" })).toBeNull()
    const button = screen.getByRole("button", { name: "Send anyway" }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(sent).toEqual([])
    fireEvent.click(button)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("documents.ingest")
  })

  it("refuses content over Weave's own cap, before sending", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 1 } })
    renderPage(IngestPage, client, { id: ID })
    await paste("a".repeat(1024 * 1024 + 1))
    expect(screen.getByText(/Weave ingests up to 1 MiB of text/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Ingest" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("explains the transport's own refusal and where the limit lives", async () => {
    const { client } = scriptedClient(queries(), {
      "documents.ingest": new ContractError("BAD_REQUEST", "request body exceeds 1048576 bytes"),
    })
    renderPage(IngestPage, client, { id: ID })
    await paste("Text.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText("request body exceeds 1048576 bytes")).toBeTruthy()
    expect(screen.getByText(/The dashboard's request limit refused this/)).toBeTruthy()
  })

  it("does not blame the request limit for other bad requests", async () => {
    const { client } = scriptedClient(queries(), { "documents.ingest": new ContractError("BAD_REQUEST", "title is too long") })
    renderPage(IngestPage, client, { id: ID })
    await paste("Text.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText("title is too long")).toBeTruthy()
    expect(screen.queryByText(/The dashboard's request limit refused this/)).toBeNull()
  })

  it("waits for content before it can ingest", async () => {
    const { client } = scriptedClient(queries(), {})
    renderPage(IngestPage, client, { id: ID })
    await screen.findByText(/into support-articles/)
    expect((screen.getByRole("button", { name: "Ingest" }) as HTMLButtonElement).disabled).toBe(true)
    await paste("   ")
    expect((screen.getByRole("button", { name: "Ingest" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows a missing embedder as the server says it", async () => {
    const { client } = scriptedClient(queries(), {
      "documents.ingest": new ContractError("UNAVAILABLE", "Weave has no embedder configured, so it cannot ingest or search"),
    })
    renderPage(IngestPage, client, { id: ID })
    await paste("Text.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText(/no embedder configured/)).toBeTruthy()
  })
})
