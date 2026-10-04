import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ObjectListing } from "../src/components/object-listing"
import { listingCaption, mergePage } from "../src/listing"
import type { ObjectRow, ObjectsList } from "../src/types"
import "./harness"

function o(key: string, extra: Partial<ObjectRow> = {}): ObjectRow {
  return { key, storedSize: 10, etag: "e1", lastModified: "2026-09-30T12:00:00Z", contentType: null, storageClass: null, ...extra }
}

function page(objects: ObjectRow[], prefixes: string[] | null, nextCursor: string | null = null, routed = false): ObjectsList {
  return { objects, prefixes, nextCursor, foldersSupported: prefixes !== null, routed }
}

/** Answers objects.list by cursor, and records every call's params. */
function listClient(pages: Record<string, ObjectsList>): { client: ScopedClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    client: {
      extension: "trove",
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent !== "objects.list") throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
        calls.push(params ?? {})
        const cursor = typeof params?.cursor === "string" ? params.cursor : ""
        if (!(cursor in pages)) throw new ContractError("BAD_REQUEST", "cursor does not decode")
        return pages[cursor]
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands here")
      },
    } as ScopedClient,
  }
}

function renderListing(client: ScopedClient, props: Partial<{ store: string; bucket: string; prefix: string; selectedKey: string }> = {}) {
  return render(
    <PluginProvider client={client}>
      <ObjectListing store={props.store ?? ""} bucket={props.bucket ?? "reports"} prefix={props.prefix ?? ""} selectedKey={props.selectedKey ?? ""} />
    </PluginProvider>,
  )
}

describe("mergePage and listingCaption", () => {
  it("merges folders and objects into one key order", () => {
    const rows = mergePage(page([o("a.txt"), o("c.txt")], ["b/", "d/"]))
    expect(rows.map((r) => `${r.kind}:${r.key}`)).toEqual(["object:a.txt", "folder:b/", "object:c.txt", "folder:d/"])
  })

  it("counts what is shown and never claims a total while there is more", () => {
    expect(listingCaption(12, 3, false)).toBe("12 objects, 3 folders")
    expect(listingCaption(1, 0, false)).toBe("1 object")
    expect(listingCaption(0, 1, false)).toBe("0 objects, 1 folder")
    expect(listingCaption(200, 14, true)).toBe("214 shown, more under this prefix")
  })
})

describe("ObjectListing", () => {
  it("sends no prefix or store for the root of the default store", async () => {
    const { client, calls } = listClient({ "": page([o("a.txt")], []) })
    renderListing(client)
    await screen.findByText("a.txt")
    expect(calls[0]).toEqual({ bucket: "reports" })
  })

  it("lists folders as links into the prefix and objects as links that select them", async () => {
    const { client } = listClient({ "": page([o("2026/summary.json", { storedSize: 4812 })], ["2026/09/"]) })
    renderListing(client, { prefix: "2026/" })
    const folder = await screen.findByRole("link", { name: "09/" })
    expect(folder.getAttribute("href")).toBe("/@trove/buckets/reports?prefix=2026%2F09%2F")
    const file = screen.getByRole("link", { name: "summary.json" })
    expect(file.getAttribute("href")).toBe("/@trove/buckets/reports?prefix=2026%2F&key=2026%2Fsummary.json")
    expect(screen.getByText("4,812 B").className).toContain("font-mono")
  })

  it("marks the selected object's row", async () => {
    const { client } = listClient({ "": page([o("a.txt"), o("b.txt")], []) })
    renderListing(client, { selectedKey: "b.txt" })
    const row = (await screen.findByText("b.txt")).closest("tr")!
    expect(row.getAttribute("data-state")).toBe("selected")
    expect(row.getAttribute("aria-selected")).toBe("true")
  })

  it("says so above the table when the store routes keys elsewhere", async () => {
    const { client } = listClient({ "": page([o("a.txt")], [], null, true) })
    renderListing(client)
    expect(await screen.findByText(/can miss objects/)).toBeTruthy()
  })

  it("shows the three empty states", async () => {
    const empty = listClient({ "": page([], []) })
    const { unmount } = renderListing(empty.client)
    expect(await screen.findByText("This bucket is empty")).toBeTruthy()
    unmount()
    queryStore.clear()

    const none = listClient({ "": page([], []) })
    const second = renderListing(none.client, { prefix: "2027/" })
    expect(await screen.findByText("Nothing under this prefix")).toBeTruthy()
    second.unmount()
    queryStore.clear()

    const folded = listClient({ "": page([], [], "c1"), c1: page([o("z.txt")], []) })
    renderListing(folded.client)
    expect(await screen.findByText("Nothing on this page")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(await screen.findByText("z.txt")).toBeTruthy()
  })

  it("appends the next page on Load more and keeps the caption honest", async () => {
    const { client, calls } = listClient({
      "": page([o("a.txt")], ["f/"], "c1"),
      c1: page([o("b.txt")], [], null),
    })
    renderListing(client)
    expect(await screen.findByText("2 shown, more under this prefix")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(await screen.findByText("b.txt")).toBeTruthy()
    expect(calls[1]).toEqual({ bucket: "reports", cursor: "c1" })
    expect(screen.getByText("2 objects, 1 folder")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("keeps a failed Load more on the page with what it already shows", async () => {
    const { client } = listClient({ "": page([o("a.txt")], [], "broken") })
    renderListing(client)
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
    expect(await screen.findByText("Could not load more")).toBeTruthy()
    expect(screen.getByText("a.txt")).toBeTruthy()
  })

  it("reloads the pages it had loaded when the listing is invalidated", async () => {
    const pages: Record<string, ObjectsList> = {
      "": page([o("a.txt")], [], "c1"),
      c1: page([o("b.txt")], [], null),
    }
    const { client } = listClient(pages)
    renderListing(client)
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
    await screen.findByText("b.txt")
    pages[""] = page([o("a.txt")], [], "c2")
    pages.c2 = page([o("b2.txt")], [], null)
    act(() => queryStore.invalidate("trove", ["objects.list"]))
    expect(await screen.findByText("b2.txt")).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull())
    expect(screen.getByText("a.txt")).toBeTruthy()
  })

  it("drops a Load more that was still loading when the listing was invalidated", async () => {
    const pages: Record<string, ObjectsList> = {
      "": page([o("a.txt")], [], "c1"),
      c1: page([o("b.txt")], [], "c2"),
    }
    let releaseStale: () => void = () => {}
    const stale = page([o("stale.txt")], [], null)
    const client = {
      extension: "trove",
      query: async (_intent: string, params?: Record<string, unknown>) => {
        const cursor = typeof params?.cursor === "string" ? params.cursor : ""
        if (cursor === "c2") {
          await new Promise<void>((resolve) => {
            releaseStale = resolve
          })
          return stale
        }
        return pages[cursor]
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands here")
      },
    } as ScopedClient
    renderListing(client)
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
    await screen.findByText("b.txt")
    // The second Load more starts and is left pending.
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Loading…" })).toBeTruthy())

    pages[""] = page([o("a.txt")], [], "n1")
    pages.n1 = page([o("c.txt")], [], null)
    act(() => queryStore.invalidate("trove", ["objects.list"]))
    expect(await screen.findByText("c.txt")).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull())

    await act(async () => {
      releaseStale()
    })
    expect(screen.queryByText("stale.txt")).toBeNull()
    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("link").map((l) => l.textContent)).toEqual(["a.txt", "c.txt"])
    expect(screen.getByText("2 objects")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("drops a first Load more that was still loading when the listing was invalidated", async () => {
    const pages: Record<string, ObjectsList> = { "": page([o("a.txt")], [], "c1") }
    let releaseStale: () => void = () => {}
    const client = {
      extension: "trove",
      query: async (_intent: string, params?: Record<string, unknown>) => {
        if (params?.cursor === "c1") {
          await new Promise<void>((resolve) => {
            releaseStale = resolve
          })
          return page([o("stale.txt")], [], null)
        }
        return pages[typeof params?.cursor === "string" ? params.cursor : ""]
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands here")
      },
    } as ScopedClient
    renderListing(client)
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Loading…" })).toBeTruthy())
    pages[""] = page([o("a2.txt")], [], "n1")
    act(() => queryStore.invalidate("trove", ["objects.list"]))
    await screen.findByText("a2.txt")
    await act(async () => {
      releaseStale()
    })
    expect(screen.queryByText("stale.txt")).toBeNull()
    expect(screen.getByText("1 shown, more under this prefix")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy()
  })

  it("renders a window of rows, not every row, past the threshold", async () => {
    const many = Array.from({ length: 250 }, (_, i) => o(`k${String(i).padStart(3, "0")}`))
    const { client } = listClient({ "": page(many, []) })
    renderListing(client)
    expect(await screen.findByText("250 objects")).toBeTruthy()
    const table = screen.getByRole("table")
    const rendered = within(table).getAllByRole("link").length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
  })
})
