import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionsPage } from "../src/pages/collections"
import { failingClient, renderPage, scriptedClient } from "./harness"

function collection(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-09-07T09:00:00Z",
    updated_at: "2026-09-07T09:00:00Z",
    id: "col_01k70000000000000000000001",
    name: "support-articles",
    description: "Help centre articles the support assistant answers from.",
    tenant_id: "acme",
    app_id: "acme-app",
    embedding_model: "text-embedding-3-small",
    embedding_dims: 1536,
    chunk_strategy: "recursive",
    chunk_size: 48,
    chunk_overlap: 8,
    metadata: {},
    document_count: 5,
    chunk_count: 21,
    ...over,
  }
}

const TWO = {
  items: [
    collection(),
    collection({
      id: "col_01k70000000000000000000002",
      name: "staff-handbook",
      description: undefined,
      document_count: 1,
      chunk_count: 2,
    }),
  ],
  total: 2,
  limit: 25,
  offset: 0,
}

function rowWith(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("CollectionsPage", () => {
  it("asks for the first page of your tenant's collections, naming no tenant", async () => {
    const { client, queried } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    expect(queried[0]).toEqual({
      intent: "collections.list",
      params: { limit: 25, offset: 0 },
    })
  })

  it("shows each collection with live counts and the five conventions", async () => {
    const { client } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    const name = await screen.findByText("support-articles")
    expect(name.className).toContain("font-medium")
    expect(screen.getByText("2 collections")).toBeTruthy()
    const support = rowWith("support-articles")
    expect(
      within(support).getByText("col_01k70000000000000000000001").className
    ).toContain("font-mono")
    expect(within(support).getByText("21")).toBeTruthy()
    expect(within(support).getByText("48 / 8")).toBeTruthy()
    expect(within(rowWith("staff-handbook")).getByText("2")).toBeTruthy()
  })

  it("has no tenant column, because every row is your tenant's", async () => {
    const { client } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    expect(screen.queryByRole("columnheader", { name: "Tenant" })).toBeNull()
    expect(screen.queryByText("acme")).toBeNull()
  })

  it("searches by name after typing stops, from the first page", async () => {
    const { client, queried } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    fireEvent.change(screen.getByLabelText("Search collections"), {
      target: { value: " staff " },
    })
    await waitFor(() =>
      expect(queried.at(-1)?.params).toEqual({
        limit: 25,
        offset: 0,
        search: "staff",
      })
    )
  })

  it("offers no tenant filter and never sends a tenant", async () => {
    const { client, queried } = scriptedClient({
      "collections.list": (input: Record<string, unknown>) => ({
        ...TWO,
        total: 30,
        offset: input.offset as number,
      }),
    })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    expect(screen.queryByLabelText("Tenant")).toBeNull()
    expect(screen.queryByLabelText("Tenant ID")).toBeNull()
    expect(screen.queryByText("All tenants")).toBeNull()
    fireEvent.change(screen.getByLabelText("Search collections"), {
      target: { value: "staff" },
    })
    await waitFor(() =>
      expect(queried.at(-1)?.params).toMatchObject({ search: "staff" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(queried.at(-1)?.params).toMatchObject({ offset: 25 })
    )
    for (const q of queried) expect(q.params).not.toHaveProperty("tenant")
  })

  it("pages with the limit the server applied", async () => {
    const { client, queried } = scriptedClient({
      "collections.list": (input: Record<string, unknown>) => ({
        ...TWO,
        total: 30,
        offset: input.offset as number,
      }),
    })
    renderPage(CollectionsPage, client)
    await screen.findByText("Page 1 of 2, 30 total")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 25 })
    )
  })

  it("says nothing exists yet, and offers to create one", async () => {
    const { client } = scriptedClient({
      "collections.list": { items: [], total: 0, limit: 25, offset: 0 },
    })
    renderPage(CollectionsPage, client)
    expect(await screen.findByText("0 collections")).toBeTruthy()
    expect(screen.getByText(/No collections yet/)).toBeTruthy()
  })

  it("says the filters matched nothing when it was filtered", async () => {
    const { client } = scriptedClient({
      "collections.list": { items: [], total: 0, limit: 25, offset: 0 },
    })
    renderPage(CollectionsPage, client)
    await screen.findByText("0 collections")
    fireEvent.change(screen.getByLabelText("Search collections"), {
      target: { value: "nothing" },
    })
    expect(
      await screen.findByText(/No collections match these filters/)
    ).toBeTruthy()
  })

  it("links to the create form", async () => {
    const { client } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    expect(
      screen.getByRole("link", { name: "New collection" }).getAttribute("href")
    ).toBe("/collections/new")
  })

  it("shows an error card when the list cannot be read", async () => {
    renderPage(
      CollectionsPage,
      failingClient(
        new ContractError("BAD_REQUEST", "limit and offset cannot be negative")
      )
    )
    expect(await screen.findByText(/cannot be negative/)).toBeTruthy()
  })
})
