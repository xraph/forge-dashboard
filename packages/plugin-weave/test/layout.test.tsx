import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { ChunkDetailPage } from "../src/pages/chunk-detail"
import { ChunksPage } from "../src/pages/chunks"
import { CollectionCreatePage } from "../src/pages/collection-create"
import { CollectionDetailPage } from "../src/pages/collection-detail"
import { CollectionEditPage } from "../src/pages/collection-edit"
import { CollectionsPage } from "../src/pages/collections"
import { DocumentDetailPage } from "../src/pages/document-detail"
import { DocumentsPage } from "../src/pages/documents"
import { IngestPage } from "../src/pages/ingest"
import { OverviewPage } from "../src/pages/overview"
import { PipelinePage } from "../src/pages/pipeline"
import { RetrievalPage } from "../src/pages/retrieval"
import type { RunOutput } from "../src/types"
import { renderWithNavigate, scriptedClient } from "./harness"

const COL = "col_01k70000000000000000000001"
const DOC = "doc_01k70000000000000000000001"
const CHUNK = "chk_01k70000000000000000000111"

afterEach(() => {
  cleanup()
  window.history.replaceState(null, "", "/")
})

const COMPONENTS = {
  components: {
    loader: {
      kind: "text",
      type: "*loader.TextLoader",
      configured: true,
      content_types: ["text/plain", "text/html"],
    },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true, dimensions: 1536 },
    vector_store: {
      kind: "memory",
      score: "cosine",
      tenant_filter: "verified",
      configured: true,
    },
    retriever: {
      kind: "mmr",
      score: "mmr_relevance",
      params: { lambda: "0.70" },
      configured: true,
    },
    score: "mmr_relevance",
    tenant_filter: "verified",
  },
  config: {
    default_chunk_size: 512,
    default_chunk_overlap: 50,
    default_embedding_model: "text-embedding-3-small",
    default_chunk_strategy: "recursive",
    default_top_k: 10,
    shutdown_timeout_seconds: 30,
  },
  extensions: [{ name: "audit-trail", hooks: ["ingest_completed"] }],
}

function collection(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-09-07T09:00:00Z",
    updated_at: "2026-09-08T09:00:00Z",
    id: COL,
    name: "support-articles",
    description: "Help centre articles.",
    tenant_id: "",
    app_id: "",
    embedding_model: "text-embedding-3-small",
    embedding_dims: 1536,
    chunk_strategy: "recursive",
    chunk_size: 48,
    chunk_overlap: 8,
    metadata: { team: "support" },
    document_count: 5,
    chunk_count: 21,
    documents_by_state: { pending: 1, processing: 1, ready: 2, failed: 1 },
    stalled: 1,
    ...over,
  }
}

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-07T09:00:00Z",
    updated_at: "2026-10-07T09:00:00Z",
    id: DOC,
    collection_id: COL,
    tenant_id: "",
    title: "Refund policy",
    source: "https://help.example.com/refunds.html",
    source_type: "text/html",
    content_hash: "ab".repeat(32),
    content_length: 812,
    chunk_count: 3,
    metadata: { lang: "en" },
    state: "ready",
    collection_name: "support-articles",
    stalled: false,
    ...over,
  }
}

function chunk(over: Record<string, unknown> = {}) {
  return {
    id: CHUNK,
    document_id: DOC,
    collection_id: COL,
    tenant_id: "",
    content: "Refunds are issued within 14 days of the return arriving.",
    index: 1,
    start_offset: 160,
    end_offset: 352,
    token_count: 48,
    metadata: { section: "refunds" },
    created_at: "2026-10-04T09:00:00Z",
    ...over,
  }
}

const COLLECTIONS = {
  items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }],
  total: 1,
  limit: 100,
  offset: 0,
}

const SPANS = {
  document_id: DOC,
  content_length: 9000,
  spans: [
    {
      id: CHUNK,
      index: 0,
      start_offset: 0,
      end_offset: 192,
      token_count: 48,
    },
  ],
  total: 1,
  complete: true,
}

const RUN: RunOutput = {
  result: {
    hits: [
      {
        chunk: chunk(),
        score: 0.8312,
        hydrated: true,
        rank: 1,
        vector_rank: 1,
        vector_score: 0.8312,
      },
      {
        chunk: chunk({ id: "chk_01k70000000000000000000120", index: 3 }),
        score: 0.802,
        hydrated: true,
        rank: 2,
        vector_rank: 7,
        vector_score: 0.802,
      },
    ],
    left_out: [
      {
        chunk: chunk({ id: "chk_01k70000000000000000000101", index: 2 }),
        score: 0.8,
        hydrated: true,
        rank: 0,
        vector_rank: 3,
        vector_score: 0.8,
      },
    ],
    window: 50,
    vector_matches: 23,
    best_vector_score: 0.8312,
    reordered: true,
    same_search: false,
    score: "mmr_relevance",
    retriever_ms: 412.4,
    vector_ms: 120.2,
  },
  context: {
    context: "Relevant context:\n\n[1] Refunds are issued within 14 days.",
    total_tokens: 20,
    max_tokens: 4096,
    included: [0, 1],
    first_excluded: -1,
    token_counter: "chars/4",
  },
}

/**
 * The page is rendered with its data on screen. The layout check comes first,
 * so a bare h2 or table is what fails; the named regions then pin the
 * sections a page with no h2 or table (a form) would otherwise get away with.
 */
function expectLayout(regions: string[] = []) {
  expect(layoutViolations(document.body)).toEqual([])
  for (const name of regions)
    expect(screen.getByRole("region", { name })).toBeTruthy()
}

describe("weave pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { client } = scriptedClient({
      "system.overview": {
        collections: 3,
        documents: 6,
        documents_by_state: { pending: 1, processing: 1, ready: 3, failed: 1 },
        chunks: 21,
        stalled: 1,
        stalled_after_seconds: 900,
        newest_documents: [doc()],
        components: COMPONENTS.components,
        scope: "all",
      },
    })
    renderWithNavigate(OverviewPage, client)
    await screen.findByText("Refund policy")
    expectLayout(["What runs", "Newest documents"])
  })

  it("Pipeline follows the shared layout", async () => {
    const { client } = scriptedClient({ "system.components": COMPONENTS })
    renderWithNavigate(PipelinePage, client)
    await screen.findByText("audit-trail")
    expectLayout([
      "Stages",
      "Content types the loader reads",
      "Engine config",
      "What Weave doesn't do",
      "Extensions",
    ])
  })

  it("Collections follows the shared layout", async () => {
    const { client } = scriptedClient({
      "collections.list": {
        items: [collection()],
        total: 1,
        limit: 25,
        offset: 0,
      },
    })
    renderWithNavigate(CollectionsPage, client)
    await screen.findByText("Help centre articles.")
    expectLayout(["Collection list"])
  })

  it("Collection detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "collections.get": collection(),
      "documents.list": { items: [doc()], total: 1, limit: 10, offset: 0 },
    })
    renderWithNavigate(CollectionDetailPage, client, { id: COL })
    await screen.findByText("Refund policy")
    expectLayout([
      "Details",
      "Embedding model, dimensions and strategy",
      "Metadata",
      "Newest documents",
    ])
  })

  it("New collection follows the shared layout", async () => {
    const { client } = scriptedClient({ "system.components": COMPONENTS })
    renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Weave never reads them back/)
    expectLayout(["Collection details", "Recorded, not used"])
  })

  it("Edit collection follows the shared layout", async () => {
    const { client } = scriptedClient({ "collections.get": collection() })
    renderWithNavigate(CollectionEditPage, client, { id: COL })
    await screen.findByDisplayValue("support-articles")
    expectLayout(["Collection details", "Chunk settings"])
  })

  it("Ingest follows the shared layout", async () => {
    const { client } = scriptedClient({
      "collections.get": collection(),
      "system.components": COMPONENTS,
    })
    renderWithNavigate(IngestPage, client, { id: COL })
    await screen.findByRole("heading", { level: 1, name: "Ingest" })
    await screen.findByLabelText("Content")
    expectLayout(["Document to ingest"])
  })

  it("Documents follows the shared layout", async () => {
    const { client } = scriptedClient({
      "collections.list": COLLECTIONS,
      "documents.list": { items: [doc()], total: 1, limit: 25, offset: 0 },
    })
    renderWithNavigate(DocumentsPage, client)
    await screen.findByText("Refund policy")
    expectLayout(["Document list"])
  })

  it("Document detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "documents.get": doc(),
      "documents.spans": SPANS,
      "chunks.list": { items: [chunk()], total: 1, limit: 100, offset: 0 },
    })
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    await screen.findByRole("heading", { level: 1, name: "Refund policy" })
    await screen.findByText(/Refunds are issued within 14 days/)
    expectLayout([
      "Details",
      "Metadata",
      "Where the chunks fall",
      "Read the chunks",
    ])
  })

  it("Chunks follows the shared layout", async () => {
    window.history.replaceState(null, "", `/@weave/chunks?collection_id=${COL}`)
    const { client } = scriptedClient({
      "collections.list": COLLECTIONS,
      "chunks.list": { items: [chunk()], total: 1, limit: 25, offset: 0 },
    })
    renderWithNavigate(ChunksPage, client)
    await screen.findByText(/Refunds are issued within 14 days/)
    expectLayout(["Chunk list"])
  })

  it("Chunk detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "chunks.get": {
        chunk: chunk(),
        document_title: "Refund policy",
        previous_id: "chk_01k70000000000000000000110",
        next_id: "",
      },
    })
    renderWithNavigate(ChunkDetailPage, client, { id: CHUNK })
    await screen.findByText("Refund policy")
    expectLayout(["Text", "Details", "Metadata"])
  })

  it("Retrieval follows the shared layout", async () => {
    const { client } = scriptedClient(
      { "system.components": COMPONENTS, "collections.list": COLLECTIONS },
      { "retrieval.run": RUN }
    )
    renderWithNavigate(RetrievalPage, client)
    fireEvent.change(await screen.findByLabelText("Query"), {
      target: { value: "how long do refunds take" },
    })
    // Before a run there is a form and nothing else to place.
    expectLayout(["Retrieval query"])

    fireEvent.click(screen.getByRole("button", { name: "Run query" }))
    await screen.findByText(/hits in/)
    // The ranking table is the workspace, and it sits in the results section.
    expectLayout(["Retrieval query", "Results"])

    fireEvent.click(screen.getByRole("tab", { name: /Context sent/ }))
    await screen.findByLabelText("Token budget")
    expectLayout(["Results"])

    fireEvent.click(screen.getByRole("tab", { name: /Left out/ }))
    await waitFor(() =>
      expect(screen.getByText("1 match left out")).toBeTruthy()
    )
    expectLayout(["Results"])
  })
})
