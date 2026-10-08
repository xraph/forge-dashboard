import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { PipelinePage } from "../src/pages/pipeline"
import { failingClient, renderPage, stubClient } from "./harness"

function output(over: Record<string, unknown> = {}) {
  return {
    components: {
      loader: { kind: "text", type: "*loader.TextLoader", configured: true, content_types: ["text/plain", "text/html"] },
      chunker: { kind: "semantic", params: { offsets: "approximate" }, type: "*chunker.SemanticChunker", configured: true },
      embedder: { kind: "openai", params: { model: "text-embedding-3-small" }, type: "*embedder.OpenAIEmbedder", configured: true, dimensions: 1536 },
      vector_store: { kind: "fabriq", score: "vector_similarity", tenant_filter: "unverified", configured: true },
      retriever: { kind: "", configured: false },
      score: "vector_similarity",
      tenant_filter: "unverified",
    },
    config: {
      default_chunk_size: 512,
      default_chunk_overlap: 50,
      default_embedding_model: "text-embedding-3-small",
      default_chunk_strategy: "recursive",
      default_top_k: 10,
      shutdown_timeout_seconds: 30,
    },
    extensions: [
      { name: "audit-trail", hooks: ["ingest_completed", "ingest_failed"] },
      { name: "metrics", hooks: [] },
    ],
    ...over,
  }
}

function rowWith(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("PipelinePage", () => {
  it("asks system.components with no parameters", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("Loader")).toBeTruthy()
  })

  it("shows each stage's kind, parameters and Go type", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    await screen.findByText("Loader")
    const embedder = rowWith("Embedder")
    expect(within(embedder).getByText("openai").className).toContain("font-mono")
    expect(within(embedder).getByText("model=text-embedding-3-small")).toBeTruthy()
    expect(within(embedder).getByText("dimensions=1536")).toBeTruthy()
    expect(within(rowWith("Chunker")).getByText("offsets=approximate")).toBeTruthy()
  })

  it("says what an absent retriever means rather than calling it inactive", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    await screen.findByText("Loader")
    expect(within(rowWith("Retriever")).getByText(/returns the vector search as it is/)).toBeTruthy()
  })

  it("says tenant filtering on this store is unverified", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText(/can't check tenant filtering on this vector store/)).toBeTruthy()
  })

  it("lists the content types the loader actually supports", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("text/html")).toBeTruthy()
  })

  it("shows the engine config and says the recorded defaults are never read back", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("512 tokens")).toBeTruthy()
    expect(screen.getAllByText(/never read back/).length).toBeGreaterThan(0)
  })

  it("lists extensions with their hooks, and none for an extension with none", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("2 extensions")).toBeTruthy()
    expect(within(rowWith("metrics")).getByLabelText("no hooks")).toBeTruthy()
    expect(within(rowWith("audit-trail")).getByText("ingest_failed")).toBeTruthy()
  })

  it("shows an error card when the report cannot be read", async () => {
    renderPage(PipelinePage, failingClient(new ContractError("INTERNAL", "an internal error occurred")))
    expect(await screen.findByText(/an internal error occurred/)).toBeTruthy()
  })
})
