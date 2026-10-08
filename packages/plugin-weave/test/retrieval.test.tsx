import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RetrievalPage } from "../src/pages/retrieval"
import { pendingClient, renderPage, scriptedClient } from "./harness"
import type { RunOutput } from "../src/types"

const ZERO = "0001-01-01T00:00:00Z"
const COL = "col_01k70000000000000000000001"
const DOC_A = "doc_01k70000000000000000000001"
const DOC_B = "doc_01k70000000000000000000002"
const GONE = "doc_01k70000000000000000000099"

function chunk(id: string, document_id: string, index: number, content: string, extra: Record<string, unknown> = {}) {
  return {
    id, document_id, collection_id: COL, tenant_id: "", content, index,
    start_offset: index * 160, end_offset: index * 160 + 192, token_count: 48,
    metadata: { document_id, chunk_index: String(index) }, created_at: "2026-10-04T09:00:00Z", ...extra,
  }
}

const RUN: RunOutput = {
  result: {
    hits: [
      { chunk: chunk("chk_01k70000000000000000000100", DOC_A, 0, "Refunds are issued within 14 days of the return reaching our warehouse."), score: 0.8312, hydrated: true, rank: 1, vector_rank: 1, vector_score: 0.8312 },
      { chunk: chunk("chk_01k70000000000000000000120", DOC_B, 3, "If the order shipped in more than one parcel, each parcel is refunded on its own."), score: 0.802, hydrated: true, rank: 2, vector_rank: 7, vector_score: 0.802 },
      {
        chunk: chunk("chk_01k70000000000000000000901", "", 0, "Gift card refunds are paid as store credit within 14 days.", {
          collection_id: "", start_offset: 0, end_offset: 0, token_count: 0, created_at: ZERO, metadata: { document_id: GONE },
        }),
        score: 0.79, hydrated: false, orphaned: true, rank: 3, vector_rank: 2, vector_score: 0.79,
      },
      { chunk: null, score: 0.7, hydrated: false, rank: 4, vector_rank: 0, vector_score: 0 },
      { chunk: chunk("chk_01k70000000000000000000103", DOC_A, 3, "We email you when the refund is issued."), score: 0.744, hydrated: true, rank: 5, vector_rank: 4, vector_score: 0.744 },
    ],
    left_out: [
      { chunk: chunk("chk_01k70000000000000000000101", DOC_A, 1, "The money goes back to the card you paid with."), score: 0.8, hydrated: true, rank: 0, vector_rank: 3, vector_score: 0.8 },
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
    context:
      "Relevant context:\n\n[1] Refunds are issued within 14 days of the return reaching our warehouse.\n\n---\n\n[2] If the order shipped in more than one parcel, each parcel is refunded on its own.\n\n---\n\n[3] Gift card refunds are paid as store credit within 14 days.",
    total_tokens: 3980,
    max_tokens: 4096,
    included: [0, 1, 2],
    first_excluded: 3,
    token_counter: "chars/4",
  },
}

const COMPONENTS = {
  components: {
    loader: { kind: "text", configured: true },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true },
    vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever: { kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, configured: true },
    score: "mmr_relevance",
    tenant_filter: "verified",
  },
  config: { default_chunk_size: 512, default_chunk_overlap: 50, default_embedding_model: "m", default_chunk_strategy: "recursive", default_top_k: 10, shutdown_timeout_seconds: 30 },
  extensions: [],
}

const COLLECTIONS = { items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }], total: 1, limit: 100, offset: 0 }

function queries(components: object = COMPONENTS) {
  return { "system.components": components, "collections.list": COLLECTIONS }
}

async function ask(query = "how long do refunds take") {
  fireEvent.change(await screen.findByLabelText("Query"), { target: { value: query } })
  fireEvent.click(screen.getByRole("button", { name: "Run query" }))
}

function row(rank: number): HTMLElement {
  return screen.getAllByRole("row").find((r) => r.getAttribute("data-rank") === String(rank))!
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("RetrievalPage", () => {
  it("invites a question and runs nothing until asked", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    expect(await screen.findByText("Ask Weave a question")).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("sends the query with zeros for the defaults, and nothing it wasn't given", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    await waitFor(() => expect(sent).toEqual([{ intent: "retrieval.run", payload: { query: "how long do refunds take", top_k: 0, min_score: 0, max_tokens: 0 } }]))
  })

  it("adds a collection and a tenant only when they are picked", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await screen.findByRole("option", { name: "support-articles" })
    fireEvent.change(screen.getByLabelText("Collection"), { target: { value: COL } })
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "none" } })
    await ask()
    await waitFor(() => expect(sent[0]?.payload).toEqual({ query: "how long do refunds take", collection_id: COL, tenant: "", top_k: 0, min_score: 0, max_tokens: 0 }))
  })

  it("never puts the query in the address", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask("customer 4411 asked about a refund")
    await screen.findByText(/hits in/)
    expect(window.location.href).not.toMatch(/4411|refund/)
  })

  it("names the retriever from the component report and times both sides", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    expect(await screen.findByText(/MMR retriever \(λ 0.70\)/)).toBeTruthy()
    expect(screen.getByText(/5 hits in 412 ms\. Vector search returned 23 of a 50 window in 120 ms\./)).toBeTruthy()
  })

  it("ranks hits with the score named for its kind, three decimals and movement", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    await screen.findByText(/hits in/)
    expect(screen.getByRole("columnheader", { name: "Cosine" })).toBeTruthy()
    expect(within(row(1)).getByText("0.831").className).toContain("tabular-nums")
    expect(within(row(2)).getByText("↑5")).toBeTruthy()
    expect(within(row(3)).getByText("↓1")).toBeTruthy()
    expect(within(row(4)).getByLabelText("no place in the vector window")).toBeTruthy()
  })

  it("keeps orphaned and unidentified hits at their rank and says what they are", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    await screen.findByText(/hits in/)
    expect(within(row(3)).getByText("no chunk row")).toBeTruthy()
    expect(within(row(4)).getByText("no chunk")).toBeTruthy()
  })

  it("draws the budget line above the first hit that didn't make it, and dims what fell off", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    const line = await screen.findByText(/Context budget 4,096 tokens: 3 hits, 3,980 used/)
    const rows = screen.getAllByRole("row")
    const lineRow = line.closest("tr")!
    expect(rows.indexOf(lineRow)).toBe(rows.indexOf(row(4)) - 1)
    expect(row(5).getAttribute("data-in-context")).toBe("false")
    expect(within(row(5)).getByText("retrieved, over budget")).toBeTruthy()
    expect(row(1).getAttribute("data-in-context")).toBe("true")
  })

  it("inspects a hit with its full text, links, offsets and metadata", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hit 2" }))
    const inspector = screen.getByRole("region", { name: "Hit 2" })
    expect(within(inspector).getByText(/each parcel is refunded on its own/)).toBeTruthy()
    expect(within(inspector).getByRole("link", { name: "Open the chunk" }).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000120")
    expect(within(inspector).getByRole("link", { name: "Open the document" }).getAttribute("href")).toBe(`/documents/${DOC_B}`)
    expect(within(inspector).getByText("480 to 672")).toBeTruthy()
    expect(within(inspector).getByText("chunk_index")).toBeTruthy()
  })

  it("shows an orphaned hit without a date or a broken link", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hit 3" }))
    const inspector = screen.getByRole("region", { name: "Hit 3" })
    expect(within(inspector).getByText(/has no row for it/)).toBeTruthy()
    expect(within(inspector).queryByRole("link", { name: "Open the chunk" })).toBeNull()
    expect(within(inspector).queryByRole("link", { name: "Open the document" })).toBeNull()
    // The Document row and the metadata's document_id both show it.
    const gone = within(inspector).getAllByText(GONE)
    expect(gone).toHaveLength(2)
    for (const el of gone) expect(el.className).toContain("font-mono")
    expect(within(inspector).getByLabelText("no creation date")).toBeTruthy()
    expect(within(inspector).queryByText(/0001-01-01|Jan 1, 1\b/)).toBeNull()
    for (const link of within(inspector).queryAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/\/documents\/$|\/chunks\/$/)
  })

  it("shows the context exactly as built, and a marker takes you to its hit", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: "Context sent to the model" }))
    expect(await screen.findByText(/Built by Weave's default assembler/)).toBeTruthy()
    expect(screen.getByText(/each parcel is refunded on its own/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show hit 2" }))
    expect(await screen.findByRole("region", { name: "Hit 2" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Ranking" }).getAttribute("aria-selected")).toBe("true")
  })

  it("re-assembles with the run's hits, null content included, and a new budget", async () => {
    const smaller = { ...RUN.context, context: "Relevant context:\n\n[1] Refunds are issued within 14 days of the return reaching our warehouse.", total_tokens: 1800, max_tokens: 2000, included: [0], first_excluded: 1 }
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN, "retrieval.assemble": smaller })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: "Context sent to the model" }))
    fireEvent.change(await screen.findByLabelText("Token budget"), { target: { value: "2000" } })
    fireEvent.click(screen.getByRole("button", { name: "Re-assemble" }))
    await waitFor(() => expect(sent.at(-1)?.intent).toBe("retrieval.assemble"))
    const payload = sent.at(-1)?.payload as { hits: { chunk_id: string; content: string | null }[]; max_tokens: number }
    expect(payload.max_tokens).toBe(2000)
    expect(payload.hits).toHaveLength(5)
    expect(payload.hits[3]).toEqual({ chunk_id: "", content: null, score: 0.7 })
    expect(await screen.findByText(/1,800 of 2,000 tokens used/)).toBeTruthy()
  })

  it("lists strong matches the retriever left out, scored as vector scores", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: /Left out/ }))
    expect(await screen.findByRole("columnheader", { name: "Vector score" })).toBeTruthy()
    expect(screen.getByText(/back to the card you paid with/)).toBeTruthy()
  })

  it("says the deployment can't reorder when there is no retriever", async () => {
    const noRetriever = { ...COMPONENTS, components: { ...COMPONENTS.components, retriever: { kind: "", configured: false } } }
    const same = { ...RUN, result: { ...RUN.result, left_out: [], reordered: false, same_search: true } }
    const { client } = scriptedClient(queries(noRetriever), { "retrieval.run": same })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: /Left out/ }))
    expect(await screen.findByText("No reordering: this deployment returns the vector ranking as it is.")).toBeTruthy()
  })

  it("says only this query came back in vector order under MMR", async () => {
    const still = { ...RUN, result: { ...RUN.result, left_out: [], reordered: false } }
    const { client } = scriptedClient(queries(), { "retrieval.run": still })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: /Left out/ }))
    expect(await screen.findByText(/No reordering for this query/)).toBeTruthy()
  })

  it("says vector search found nothing", async () => {
    const none = { ...RUN, result: { ...RUN.result, hits: [], left_out: [], vector_matches: 0, best_vector_score: 0 }, context: { ...RUN.context, context: "Relevant context:\n\n", included: [], first_excluded: -1, total_tokens: 0 } }
    const { client } = scriptedClient(queries(), { "retrieval.run": none })
    renderPage(RetrievalPage, client)
    await ask()
    expect(await screen.findByText(/Vector search found nothing/)).toBeTruthy()
  })

  it("blames the min score when it removed every match", async () => {
    const none = { ...RUN, result: { ...RUN.result, hits: [], left_out: [] }, context: { ...RUN.context, context: "Relevant context:\n\n", included: [], first_excluded: -1, total_tokens: 0 } }
    const { client } = scriptedClient(queries(), { "retrieval.run": none })
    renderPage(RetrievalPage, client)
    fireEvent.change(await screen.findByLabelText("Min score"), { target: { value: "0.9" } })
    await ask()
    expect(await screen.findByText("Min score 0.9 removed all 23 vector matches; the best was 0.831.")).toBeTruthy()
  })

  it("shows the server's message for a missing embedder", async () => {
    const message = "retrieval needs Weave's own embedder and vector store; this deployment has no embedder configured"
    const { client } = scriptedClient(queries(), { "retrieval.run": new ContractError("UNAVAILABLE", message) })
    renderPage(RetrievalPage, client)
    await ask()
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it("keeps the last result on screen when the next run fails", async () => {
    let calls = 0
    const { client } = scriptedClient(queries(), {
      "retrieval.run": () => (calls++ === 0 ? RUN : new ContractError("INTERNAL", "an internal error occurred")),
    })
    renderPage(RetrievalPage, client)
    await ask()
    await screen.findByText(/hits in/)
    await ask("a second question")
    expect(await screen.findByText("an internal error occurred")).toBeTruthy()
    expect(within(row(1)).getByText("0.831")).toBeTruthy()
  })

  it("disables Run while a run is in flight", async () => {
    renderPage(RetrievalPage, pendingClient())
    await ask()
    const button = await screen.findByRole("button", { name: "Running…" })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it("refuses a query over 8 KiB before sending it", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    fireEvent.change(await screen.findByLabelText("Query"), { target: { value: "é".repeat(4097) } })
    expect(screen.getByText(/Queries are capped at 8 KiB/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Run query" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })
})
