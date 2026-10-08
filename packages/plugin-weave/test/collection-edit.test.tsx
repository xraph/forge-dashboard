import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionEditPage } from "../src/pages/collection-edit"
import { renderWithNavigate, scriptedClient } from "./harness"

const ID = "col_01k70000000000000000000001"

const DETAIL = {
  created_at: "2026-09-07T09:00:00Z",
  updated_at: "2026-09-07T09:00:00Z",
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

describe("CollectionEditPage", () => {
  it("reads the collection it was opened for", async () => {
    const { client, queried } = scriptedClient({ "collections.get": DETAIL }, {})
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    expect(await screen.findByDisplayValue("support-articles")).toBeTruthy()
    expect(queried[0]).toEqual({ intent: "collections.get", params: { id: ID } })
  })

  it("sends only the fields that changed, then opens the collection", async () => {
    const { client, sent } = scriptedClient({ "collections.get": DETAIL }, { "collections.update": { ...DETAIL, name: "help-articles" } })
    const { navigate } = renderWithNavigate(CollectionEditPage, client, { id: ID })
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: " help-articles " } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/collections/${ID}`))
    expect(sent).toEqual([{ intent: "collections.update", payload: { id: ID, name: "help-articles" } }])
  })

  it("sends the whole metadata map when it changed, because it replaces rather than merges", async () => {
    const { client, sent } = scriptedClient({ "collections.get": DETAIL }, { "collections.update": DETAIL })
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    fireEvent.change(await screen.findByLabelText("Metadata value 1"), { target: { value: "help" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "collections.update", payload: { id: ID, metadata: { team: "help" } } }]))
  })

  it("waits for a change before it can save", async () => {
    const { client } = scriptedClient({ "collections.get": DETAIL }, {})
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    await screen.findByDisplayValue("support-articles")
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the chunk settings read-only and says why", async () => {
    const { client } = scriptedClient({ "collections.get": DETAIL }, {})
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    expect(await screen.findByText(/Fixed at creation. Weave can't re-chunk existing documents/)).toBeTruthy()
    expect(screen.queryByLabelText("Chunk size")).toBeNull()
  })

  it("shows a refused rename and keeps the edit", async () => {
    const { client } = scriptedClient(
      { "collections.get": DETAIL },
      { "collections.update": new ContractError("CONFLICT", "a collection with this name already exists") },
    )
    const { navigate } = renderWithNavigate(CollectionEditPage, client, { id: ID })
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "acme-handbook" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(await screen.findByText("a collection with this name already exists")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })
})
