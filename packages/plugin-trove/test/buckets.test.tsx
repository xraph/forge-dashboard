import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { BucketsPage } from "../src/pages/buckets"
import { setActiveStore } from "../src/store"
import {
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const SINGLE = {
  mode: "single",
  stores: [{ name: "default", driver: "local", isDefault: true }],
}
const MULTI = {
  mode: "multi",
  stores: [
    { name: "primary", driver: "local", isDefault: true },
    { name: "archive", driver: "s3", isDefault: false },
  ],
}
const LIST = {
  buckets: [
    { name: "assets", createdAt: "2026-09-20T10:00:00Z" },
    { name: "reports", createdAt: null },
  ],
  createdAtMeaning: "modified",
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("BucketsPage", () => {
  it("lists buckets with a live count, mono names and the right date header", async () => {
    renderPage(
      BucketsPage,
      stubClient({ "buckets.list": LIST, "stores.list": SINGLE })
    )
    expect(
      (await screen.findByText("reports")).closest("td")?.className
    ).toContain("font-mono")
    expect(screen.getByText("2 buckets")).toBeTruthy()
    expect(
      screen.getByRole("columnheader", { name: "Last modified" })
    ).toBeTruthy()
    expect(
      within(rowFor("reports")).getByLabelText("no modified time")
    ).toBeTruthy()
  })

  it("says Created where the driver reports creation times", async () => {
    renderPage(
      BucketsPage,
      stubClient({
        "buckets.list": { ...LIST, createdAtMeaning: "created" },
        "stores.list": SINGLE,
      })
    )
    expect(
      await screen.findByRole("columnheader", { name: "Created" })
    ).toBeTruthy()
  })

  it("counts zero and says what to do", async () => {
    renderPage(
      BucketsPage,
      stubClient({
        "buckets.list": { buckets: [], createdAtMeaning: "created" },
        "stores.list": SINGLE,
      })
    )
    expect(await screen.findByText("0 buckets")).toBeTruthy()
    expect(screen.getByText(/No buckets in this store yet/)).toBeTruthy()
  })

  it("sends the picked store with the list", async () => {
    act(() => setActiveStore("archive"))
    const { client, sent } = recordingQueryClient({
      "buckets.list": LIST,
      "stores.list": {
        mode: "multi",
        stores: [
          { name: "primary", driver: "local", isDefault: true },
          { name: "archive", driver: "s3", isDefault: false },
        ],
      },
    })
    renderPage(BucketsPage, client)
    await screen.findByText("reports")
    expect(sent.find((s) => s.intent === "buckets.list")?.params).toEqual({
      store: "archive",
    })
  })

  it("creates a bucket with the name as typed", async () => {
    const { client, sent } = recordingCommandClient(
      { "buckets.list": LIST, "stores.list": SINGLE },
      { "buckets.create": { name: "logs" } }
    )
    renderPage(BucketsPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Create bucket" })
    )
    const dialog = await screen.findByRole("dialog")
    const create = within(dialog).getByRole("button", {
      name: "Create",
    }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "logs" },
    })
    fireEvent.click(create)
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "buckets.create", payload: { name: "logs" } },
      ])
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows a create refusal inside the dialog", async () => {
    const client: ScopedClient = {
      ...stubClient({ "buckets.list": LIST, "stores.list": SINGLE }),
      command: async () => {
        throw new ContractError(
          "CONFLICT",
          "a bucket with this name already exists"
        )
      },
    } as ScopedClient
    renderPage(BucketsPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Create bucket" })
    )
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "assets" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }))
    expect(
      await within(dialog).findByText("a bucket with this name already exists")
    ).toBeTruthy()
  })

  it("keeps the delete dialog open and shows the refusal inside it", async () => {
    const client: ScopedClient = {
      ...stubClient({ "buckets.list": LIST, "stores.list": SINGLE }),
      command: async () => {
        throw new ContractError(
          "CONFLICT",
          "This bucket still holds objects. Delete them first."
        )
      },
    } as ScopedClient
    renderPage(BucketsPage, client)
    await screen.findByText("reports")
    fireEvent.click(
      within(rowFor("reports")).getByRole("button", { name: "Delete reports" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText(/Only an empty bucket can be deleted/)
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(
      await within(dialog).findByText(
        "This bucket still holds objects. Delete them first."
      )
    ).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("deletes with the bucket name and closes", async () => {
    const { client, sent } = recordingCommandClient(
      { "buckets.list": LIST, "stores.list": SINGLE },
      { "buckets.delete": { name: "assets" } }
    )
    renderPage(BucketsPage, client)
    await screen.findByText("assets")
    fireEvent.click(
      within(rowFor("assets")).getByRole("button", { name: "Delete assets" })
    )
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      })
    )
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "buckets.delete", payload: { name: "assets" } },
      ])
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("links each bucket into the browser", async () => {
    renderPage(
      BucketsPage,
      stubClient({ "buckets.list": LIST, "stores.list": SINGLE })
    )
    const link = await screen.findByRole("link", { name: "reports" })
    expect(link.getAttribute("href")).toBe("/@trove/buckets/reports")
  })

  it("carries a picked store into the browser link", async () => {
    act(() => setActiveStore("archive"))
    renderPage(
      BucketsPage,
      stubClient({ "buckets.list": LIST, "stores.list": MULTI })
    )
    const link = await screen.findByRole("link", { name: "reports" })
    expect(link.getAttribute("href")).toBe(
      "/@trove/buckets/reports?store=archive"
    )
  })
})
