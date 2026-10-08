import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { NavigateOptions, PluginLinkProps, ScopedClient } from "@forge-go/dashboard-plugin"
import { DocumentsPage } from "../src/pages/documents"
import { scriptedClient } from "./harness"

const COL = "col_01k70000000000000000000001"
const GONE = "col_01k70000000000000000000777"

const COLLECTIONS = {
  items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }],
  total: 1,
  limit: 100,
  offset: 0,
}

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-07T09:00:00Z", updated_at: "2026-10-07T09:00:00Z",
    id: "doc_01k70000000000000000000001", collection_id: COL, tenant_id: "",
    title: "Refund policy", content_hash: "ab".repeat(32), content_length: 812, chunk_count: 6,
    metadata: {}, state: "ready", collection_name: "support-articles", stalled: false, ...over,
  }
}

const PAGE = { items: [doc()], total: 1, limit: 25, offset: 0 }
const EMPTY = { items: [], total: 0, limit: 25, offset: 0 }

/** The page reads its filters from the address, so navigation here really moves it. */
function renderAt(url: string, client: ScopedClient) {
  window.history.replaceState(null, "", url)
  const calls: { to: string; options?: NavigateOptions }[] = []
  const nav = {
    Link: ({ to, children }: PluginLinkProps): ReactNode => <a href={to}>{children}</a>,
    navigate: (to: string, options?: NavigateOptions) => {
      calls.push({ to, options })
      window.history.replaceState(null, "", to)
    },
  }
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={nav}>
        <DocumentsPage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return calls
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("DocumentsPage", () => {
  it("asks for the newest documents of every tenant with no filters", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    expect(queried.find((q) => q.intent === "documents.list")?.params).toEqual({ limit: 25, offset: 0 })
    expect(screen.getByText("1 document")).toBeTruthy()
  })

  it("reads its collection and state from the address", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt(`/@weave/documents?collection_id=${COL}&state=failed`, client)
    await screen.findByText("Refund policy")
    expect(queried.find((q) => q.intent === "documents.list")?.params).toEqual({ limit: 25, offset: 0, collection_id: COL, state: "failed" })
    expect((screen.getByLabelText("State") as HTMLSelectElement).value).toBe("failed")
  })

  it("writes a changed filter to the address, replacing the entry", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    const calls = renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "processing" } })
    expect(calls).toEqual([{ to: "/@weave/documents?state=processing", options: { replace: true } }])
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, state: "processing" }))
  })

  it("sends tenant only when one is picked", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "named" } })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, tenant: "acme" }))
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "all" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0 }))
  })

  it("searches titles after typing stops", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "refund" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, search: "refund" }))
  })

  it("says the filters matched nothing and offers to clear them", async () => {
    const { client } = scriptedClient({ "documents.list": EMPTY, "collections.list": COLLECTIONS })
    const calls = renderAt(`/@weave/documents?collection_id=${GONE}`, client)
    expect(await screen.findByText("No documents match these filters.")).toBeTruthy()
    expect(screen.getByText("0 documents")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(calls.at(-1)).toEqual({ to: "/@weave/documents", options: { replace: true } })
  })

  it("keeps a collection from the address in the picker even when it isn't listed", async () => {
    const { client } = scriptedClient({ "documents.list": EMPTY, "collections.list": COLLECTIONS })
    renderAt(`/@weave/documents?collection_id=${GONE}`, client)
    await screen.findByText("No documents match these filters.")
    expect((screen.getByLabelText("Collection") as HTMLSelectElement).value).toBe(GONE)
  })

  it("says nothing exists yet when it was not filtered", async () => {
    const { client } = scriptedClient({ "documents.list": EMPTY, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    expect(await screen.findByText(/No documents yet/)).toBeTruthy()
  })

  it("marks a stalled row with its age", async () => {
    const { client } = scriptedClient({
      "documents.list": { ...PAGE, items: [doc({ state: "processing", stalled: true, updated_at: "2026-10-07T06:00:00Z" })] },
      "collections.list": COLLECTIONS,
    })
    renderAt("/@weave/documents", client)
    expect(await screen.findByText(/no update for/)).toBeTruthy()
  })
})
