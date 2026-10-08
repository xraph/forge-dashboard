import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionCreatePage } from "../src/pages/collection-create"
import { renderWithNavigate, scriptedClient } from "./harness"

const COMPONENTS = {
  components: {
    loader: { kind: "text", configured: true },
    chunker: { kind: "recursive", configured: true },
    embedder: {
      kind: "openai",
      params: { model: "text-embedding-3-small" },
      configured: true,
      dimensions: 1536,
    },
    vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever: { kind: "mmr", configured: true },
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
  extensions: [],
}

const CREATED = { id: "col_01k70000000000000000001000", name: "faq" }

function fill(name: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } })
}

describe("CollectionCreatePage", () => {
  it("sends the trimmed name and zeros for empty chunk settings, then opens the new collection", async () => {
    const { client, sent } = scriptedClient(
      { "system.components": COMPONENTS },
      { "collections.create": CREATED }
    )
    const { navigate } = renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Recorded, not used/)
    fill("  faq  ")
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/collections/col_01k70000000000000000001000"
      )
    )
    expect(sent).toEqual([
      {
        intent: "collections.create",
        payload: {
          name: "faq",
          description: "",
          chunk_size: 0,
          chunk_overlap: 0,
          metadata: {},
        },
      },
    ])
  })

  it("shows the defaults it will use and says an overlap of 0 means the default", async () => {
    const { client } = scriptedClient({ "system.components": COMPONENTS }, {})
    renderWithNavigate(CollectionCreatePage, client)
    expect(
      await screen.findByText(
        /Leave it empty or 0 for the default \(50 tokens\)/
      )
    ).toBeTruthy()
    expect(
      (screen.getByLabelText("Chunk size") as HTMLInputElement).placeholder
    ).toBe("512")
  })

  it("refuses an effective overlap at or above the effective size before sending", async () => {
    const { client, sent } = scriptedClient(
      { "system.components": COMPONENTS },
      { "collections.create": CREATED }
    )
    renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Recorded, not used/)
    fill("tiny")
    fireEvent.change(screen.getByLabelText("Chunk size"), {
      target: { value: "40" },
    })
    expect(
      screen.getByText(
        "chunk overlap 50 (the default) must be smaller than chunk size 40"
      )
    ).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Create collection",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(sent).toEqual([])
  })

  it("says what is recorded and what actually runs", async () => {
    const { client } = scriptedClient({ "system.components": COMPONENTS }, {})
    renderWithNavigate(CollectionCreatePage, client)
    const box = await screen.findByText(/Recorded, not used/)
    expect(box.closest("section")?.textContent).toMatch(/never reads them back/)
    expect(box.closest("section")?.textContent).toMatch(/openai/)
  })

  it("shows the server's refusal and stays on the form", async () => {
    const { client } = scriptedClient(
      { "system.components": COMPONENTS },
      {
        "collections.create": new ContractError(
          "CONFLICT",
          "a collection with this name already exists"
        ),
      }
    )
    const { navigate } = renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Recorded, not used/)
    fill("support-articles")
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }))
    expect(
      await screen.findByText("a collection with this name already exists")
    ).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "support-articles"
    )
  })
})
