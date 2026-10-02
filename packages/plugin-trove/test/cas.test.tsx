import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { CasPage } from "../src/pages/cas"
import { recordingCommandClient, recordingQueryClient, renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }
const ON = { enabled: true, algorithm: "sha256", bucket: "cas", index: "memory", resetsOnRestart: true, releaseSupported: false }
const OFF = { enabled: false, algorithm: null, bucket: null, index: null, resetsOnRestart: false, releaseSupported: false }
const A = "sha256:aaaa1111"
const B = "sha256:bbbb2222"
const ORPHAN = "sha256:dead0000"
const PAGE1 = {
  entries: [
    { hash: A, storedSize: 4812, lastModified: "2026-09-29T08:00:00Z", indexed: true, refCount: 2, pinned: false },
    { hash: B, storedSize: 120, lastModified: null, indexed: true, refCount: 1, pinned: true },
    { hash: ORPHAN, storedSize: 9, lastModified: null, indexed: false, refCount: null, pinned: null },
  ],
  nextCursor: "Y3Vyc29yMg",
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("CasPage", () => {
  it("does not ask for cas.list when CAS is off", async () => {
    const { client, sent } = recordingQueryClient({ "cas.status": OFF, "stores.list": SINGLE })
    renderPage(CasPage, client)
    expect(await screen.findByText(/CAS is not enabled on this store/)).toBeTruthy()
    expect(sent.some((s) => s.intent === "cas.list")).toBe(false)
  })

  it("states the index ceiling before the table", async () => {
    renderPage(CasPage, stubClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE }))
    expect(await screen.findByText(/forgets every reference count and pin/)).toBeTruthy()
    expect(screen.getByText(/never finds anything to collect/)).toBeTruthy()
  })

  it("shows each entry's state, refs and size, with null refs as none", async () => {
    renderPage(CasPage, stubClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE }))
    expect((await screen.findByText(A)).className).toContain("font-mono")
    expect(within(rowFor(A)).getByText("Indexed")).toBeTruthy()
    expect(within(rowFor(B)).getByText("Pinned")).toBeTruthy()
    expect(within(rowFor(ORPHAN)).getByText("Not indexed")).toBeTruthy()
    expect(within(rowFor(ORPHAN)).getByLabelText("no reference count")).toBeTruthy()
    expect(within(rowFor(A)).getByText("4,812 B")).toBeTruthy()
    expect(screen.getByText("3 on this page, more after it")).toBeTruthy()
  })

  it("truncates a long hash in the cell and keeps the full hash in its title", async () => {
    renderPage(CasPage, stubClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE }))
    const hash = await screen.findByText(A)
    expect(hash.className).toContain("truncate")
    expect(hash.className).toContain("max-w-48")
    expect(hash.getAttribute("title")).toBe(A)
    expect(within(rowFor(A)).getByRole("button", { name: `Pin ${A}` })).toBeTruthy()
  })

  it("does not read the last page of a listing as a total", async () => {
    const LAST = { entries: [PAGE1.entries[0], PAGE1.entries[1]], nextCursor: null }
    const client = {
      extension: "trove",
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent === "cas.status") return ON
        if (intent === "stores.list") return SINGLE
        if (intent === "cas.list") return params?.cursor ? LAST : PAGE1
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands")
      },
    } as ScopedClient
    renderPage(CasPage, client)
    await screen.findByText("3 on this page, more after it")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    const caption = await screen.findByText("2 on this page, the last one")
    expect(caption.textContent).not.toMatch(/^\d+ entr/)
  })

  it("calls a complete first page by its count", async () => {
    renderPage(
      CasPage,
      stubClient({ "cas.status": ON, "cas.list": { entries: [PAGE1.entries[0]], nextCursor: null }, "stores.list": SINGLE }),
    )
    expect(await screen.findByText("1 entry")).toBeTruthy()
  })

  it("pages with the cursor it was given", async () => {
    const { client, sent } = recordingQueryClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE })
    renderPage(CasPage, client)
    await screen.findByText(A)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(sent.filter((s) => s.intent === "cas.list").map((s) => s.params)).toContainEqual({ cursor: "Y3Vyc29yMg", limit: 100 }),
    )
  })

  it("offers pin and unpin only on indexed rows", async () => {
    const { client, sent } = recordingCommandClient(
      { "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE },
      { "cas.pin": PAGE1.entries[0], "cas.unpin": PAGE1.entries[1] },
    )
    renderPage(CasPage, client)
    await screen.findByText(A)
    expect(within(rowFor(ORPHAN)).queryByRole("button")).toBeNull()
    fireEvent.click(within(rowFor(A)).getByRole("button", { name: `Pin ${A}` }))
    fireEvent.click(within(rowFor(B)).getByRole("button", { name: `Unpin ${B}` }))
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "cas.pin", payload: { hash: A } },
        { intent: "cas.unpin", payload: { hash: B } },
      ]),
    )
  })

  it("runs GC behind a confirmation and reports what it did", async () => {
    const { client, sent } = recordingCommandClient(
      { "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE },
      { "cas.gc": { scanned: 0, deleted: 0, freedBytes: 0, errors: 0 } },
    )
    renderPage(CasPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Run garbage collection" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Blobs the index does not know are never touched/)).toBeTruthy()
    // Deleting is what it does, so the confirm is painted as destructive.
    // The base class mentions destructive for aria-invalid, so pin the variant's own fill.
    expect(within(dialog).getByRole("button", { name: "Run" }).className.split(" ")).toContain("bg-destructive/10")
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "cas.gc", payload: {} }]))
    expect(await screen.findByText(/Found 0 entries with no references and no pin, deleted 0, freed 0 B/)).toBeTruthy()
  })

  it("keeps the GC result and the table on screen while the host refetches", async () => {
    const { client } = recordingCommandClient(
      { "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE },
      { "cas.gc": { scanned: 1, deleted: 1, freedBytes: 2048, errors: 0 } },
    )
    renderPage(CasPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Run garbage collection" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }))
    expect(await screen.findByText(/Found 1 entry with no references and no pin, deleted 1, freed 2,048 B/)).toBeTruthy()

    // What the host does when cas.gc settles: cas.gc declares invalidates.
    act(() => queryStore.invalidate("trove", ["cas.list", "cas.status"]))

    expect(screen.getByText(/Found 1 entry with no references and no pin, deleted 1/)).toBeTruthy()
    expect(screen.getByText(A)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull())
    expect(screen.getByText(/Found 1 entry with no references and no pin, deleted 1/)).toBeTruthy()
    expect(screen.getByText(A)).toBeTruthy()
  })
})
