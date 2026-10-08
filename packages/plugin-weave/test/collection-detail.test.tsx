import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, queryStore } from "@forge-go/dashboard-plugin"
import { CollectionDetailPage } from "../src/pages/collection-detail"
import {
  invalidatingClient,
  renderWithNavigate,
  scriptedClient,
} from "./harness"

const ID = "col_01k70000000000000000000001"

const DETAIL = {
  created_at: "2026-09-07T09:00:00Z",
  updated_at: "2026-09-08T09:00:00Z",
  id: ID,
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
}

const DOCS = {
  items: [
    {
      created_at: "2026-10-07T09:00:00Z",
      updated_at: "2026-10-07T09:00:00Z",
      id: "doc_01k70000000000000000000001",
      collection_id: ID,
      tenant_id: "",
      title: "Refund policy",
      content_hash: "ab".repeat(32),
      content_length: 812,
      chunk_count: 6,
      metadata: {},
      state: "ready",
      collection_name: "support-articles",
      stalled: false,
    },
  ],
  total: 5,
  limit: 10,
  offset: 0,
}

function queries(over: Record<string, unknown> = {}) {
  return { "collections.get": DETAIL, "documents.list": DOCS, ...over }
}

async function openDialog(button: string) {
  fireEvent.click(await screen.findByRole("button", { name: button }))
  return screen.findByRole("alertdialog")
}

describe("CollectionDetailPage", () => {
  it("reads the collection and its ten newest documents", async () => {
    const { client, queried } = scriptedClient(queries())
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await screen.findByRole("heading", { name: "support-articles" })
    expect(queried).toContainEqual({
      intent: "collections.get",
      params: { id: ID },
    })
    expect(queried).toContainEqual({
      intent: "documents.list",
      params: { collection_id: ID, limit: 10 },
    })
  })

  it("shows its stats, its identity and what it recorded but does not use", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await screen.findByRole("heading", { name: "support-articles" })
    expect(screen.getByText("Looks stalled")).toBeTruthy()
    expect(screen.getByText(ID).className).toContain("font-mono")
    expect(screen.getByLabelText("no tenant")).toBeTruthy()
    expect(
      screen.getByText(/Recorded when the collection was made and never used/)
    ).toBeTruthy()
    expect(screen.getByText("team")).toBeTruthy()
    expect(screen.getByText("1 newest of 5 documents")).toBeTruthy()
  })

  it("links to ingest, edit, and the full document and chunk lists", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await screen.findByRole("heading", { name: "support-articles" })
    expect(
      screen.getByRole("link", { name: "Ingest" }).getAttribute("href")
    ).toBe(`/collections/${ID}/ingest`)
    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href")
    ).toBe(`/collections/${ID}/edit`)
    expect(
      screen
        .getByRole("link", { name: "All documents in this collection" })
        .getAttribute("href")
    ).toBe(`/@weave/documents?collection_id=${ID}`)
    expect(
      screen.getByRole("link", { name: "Its chunks" }).getAttribute("href")
    ).toBe(`/@weave/chunks?collection_id=${ID}`)
  })

  it("says what reindex does before it runs, then reports what it did", async () => {
    const { client, sent } = scriptedClient(queries(), {
      "collections.reindex": {
        id: ID,
        reindexed_documents: 2,
        elapsed_ms: 812.5,
      },
    })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Reindex")
    expect(
      within(dialog).getByText(/deletes every vector in this collection first/)
    ).toBeTruthy()
    expect(
      within(dialog).getByText(/leaves the collection partly indexed/)
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    expect(
      await screen.findByText("Re-embedded 2 documents in 813 ms.")
    ).toBeTruthy()
    expect(sent).toEqual([
      { intent: "collections.reindex", payload: { id: ID } },
    ])
  })

  it("keeps a failed reindex inside the dialog and says the collection may be partly indexed", async () => {
    const { client } = scriptedClient(queries(), {
      "collections.reindex": new ContractError(
        "INTERNAL",
        "an internal error occurred"
      ),
    })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Reindex")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    expect(
      await within(dialog).findByText("an internal error occurred")
    ).toBeTruthy()
    expect(within(dialog).getByText(/may now be partly indexed/)).toBeTruthy()
    expect(
      within(dialog).getByRole("button", { name: "Run reindex again" })
    ).toBeTruthy()
  })

  it("does not call a missing embedder a partial reindex", async () => {
    const { client } = scriptedClient(queries(), {
      "collections.reindex": new ContractError(
        "UNAVAILABLE",
        "Weave has no embedder configured, so it cannot ingest or search"
      ),
    })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Reindex")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    expect(
      await within(dialog).findByText(/no embedder configured/)
    ).toBeTruthy()
    expect(within(dialog).queryByText(/may now be partly indexed/)).toBeNull()
  })

  it("clears an earlier failure when the dialog opens again", async () => {
    const { client } = scriptedClient(queries(), {
      "collections.reindex": new ContractError(
        "INTERNAL",
        "an internal error occurred"
      ),
    })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    let dialog = await openDialog("Reindex")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    await within(dialog).findByText("an internal error occurred")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    dialog = await openDialog("Reindex")
    expect(within(dialog).queryByText("an internal error occurred")).toBeNull()
  })

  it("deletes after confirming what goes with it, then leaves for the list", async () => {
    const { client, sent } = scriptedClient(queries(), {
      "collections.delete": { id: ID },
    })
    const { navigate } = renderWithNavigate(CollectionDetailPage, client, {
      id: ID,
    })
    const dialog = await openDialog("Delete")
    expect(
      within(dialog).getByText(/5 documents and 21 chunks, and their vectors/)
    ).toBeTruthy()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete collection" })
    )
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/collections", { replace: true })
    )
    expect(sent).toEqual([
      { intent: "collections.delete", payload: { id: ID } },
    ])
  })

  it("keeps a failed delete inside the dialog", async () => {
    const { client } = scriptedClient(queries(), {
      "collections.delete": new ContractError(
        "NOT_FOUND",
        "collection not found"
      ),
    })
    const { navigate } = renderWithNavigate(CollectionDetailPage, client, {
      id: ID,
    })
    const dialog = await openDialog("Delete")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete collection" })
    )
    expect(await within(dialog).findByText("collection not found")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  it("keeps an open dialog through a refetch of the collection", async () => {
    const { client } = invalidatingClient({
      "collections.get": (_input, call) =>
        call === 0 ? DETAIL : new Promise(() => {}),
      "documents.list": DOCS,
    })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await openDialog("Reindex")
    act(() => {
      queryStore.invalidate("weave", ["collections.get"])
    })
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    // The open dialog marks the page behind it aria-hidden, so look past that.
    expect(
      screen.getByRole("heading", { name: "support-articles", hidden: true })
    ).toBeTruthy()
    expect(
      screen.queryByRole("status", { name: "Loading Collection", hidden: true })
    ).toBeNull()
  })

  it("shows an error card for a collection that doesn't exist", async () => {
    const { client } = scriptedClient(
      queries({
        "collections.get": new ContractError(
          "NOT_FOUND",
          "collection not found"
        ),
      })
    )
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    expect(await screen.findByText(/collection not found/)).toBeTruthy()
  })
})
