import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type {
  NavigateOptions,
  PluginLinkProps,
  ScopedClient,
} from "@forge-go/dashboard-plugin"
import { ChunksPage } from "../src/pages/chunks"
import { scriptedClient } from "./harness"

const COL = "col_01k70000000000000000000001"

const COLLECTIONS = {
  items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }],
  total: 1,
  limit: 100,
  offset: 0,
}

const CHUNKS = {
  items: [
    {
      id: "chk_01k70000000000000000000100",
      document_id: "doc_01k70000000000000000000001",
      collection_id: COL,
      tenant_id: "",
      content:
        "Refunds are issued within 14 days of the return reaching our warehouse.",
      index: 0,
      start_offset: 0,
      end_offset: 192,
      token_count: 48,
      metadata: {},
      created_at: "2026-10-04T09:00:00Z",
    },
  ],
  total: 21,
  limit: 25,
  offset: 0,
}

function renderAt(url: string, client: ScopedClient) {
  window.history.replaceState(null, "", url)
  const calls: { to: string; options?: NavigateOptions }[] = []
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }: PluginLinkProps): ReactNode => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate: (to: string, options?: NavigateOptions) => {
            calls.push({ to, options })
            window.history.replaceState(null, "", to)
          },
        }}
      >
        <ChunksPage params={{}} />
      </NavigationProvider>
    </PluginProvider>
  )
  return calls
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("ChunksPage", () => {
  it("asks for a collection first and lists nothing until it has one", async () => {
    const { client, queried } = scriptedClient({
      "collections.list": COLLECTIONS,
      "chunks.list": CHUNKS,
    })
    renderAt("/@weave/chunks", client)
    expect(await screen.findByText("Pick a collection")).toBeTruthy()
    expect(queried.some((q) => q.intent === "chunks.list")).toBe(false)
  })

  it("pages the chunks of the collection in the address, in reading order", async () => {
    const { client, queried } = scriptedClient({
      "collections.list": COLLECTIONS,
      "chunks.list": CHUNKS,
    })
    renderAt(`/@weave/chunks?collection_id=${COL}`, client)
    await screen.findByText(/Refunds are issued within 14 days/)
    expect(queried.find((q) => q.intent === "chunks.list")?.params).toEqual({
      collection_id: COL,
      limit: 25,
      offset: 0,
    })
    expect(screen.getByText("21 chunks")).toBeTruthy()
    const row = screen
      .getAllByRole("row")
      .find((r) => within(r).queryByText(/Refunds are issued/))!
    expect(
      within(row).getByText("chk_01k70000000000000000000100").className
    ).toContain("font-mono")
    expect(within(row).getByText("0 to 192")).toBeTruthy()
  })

  it("writes a picked collection to the address", async () => {
    const { client } = scriptedClient({
      "collections.list": COLLECTIONS,
      "chunks.list": CHUNKS,
    })
    const calls = renderAt("/@weave/chunks", client)
    await screen.findByText("Pick a collection")
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: COL },
    })
    expect(calls).toEqual([
      { to: `/@weave/chunks?collection_id=${COL}`, options: { replace: true } },
    ])
    expect(
      await screen.findByText(/Refunds are issued within 14 days/)
    ).toBeTruthy()
  })

  it("says a collection has no chunks yet", async () => {
    const { client } = scriptedClient({
      "collections.list": COLLECTIONS,
      "chunks.list": { items: [], total: 0, limit: 25, offset: 0 },
    })
    renderAt(`/@weave/chunks?collection_id=${COL}`, client)
    expect(await screen.findByText("0 chunks")).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByText(/This collection has no chunks yet/)).toBeTruthy()
    )
  })
})
