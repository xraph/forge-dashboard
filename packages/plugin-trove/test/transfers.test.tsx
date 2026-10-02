import { describe, expect, it } from "vitest"
import { act, screen, within } from "@testing-library/react"
import { queryStore } from "@forge-go/dashboard-plugin"
import { TransfersPage } from "../src/pages/transfers"
import { renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }
const LIST = {
  streams: [
    { id: "str_01", direction: "upload", bucket: "reports", key: "2026/09/big.csv", state: "active", offset: 3145728, totalSize: 10485760 },
    { id: "str_02", direction: "download", bucket: "assets", key: "logo.png", state: "paused", offset: 2048, totalSize: null },
  ],
  active: 2,
  max: 16,
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("TransfersPage", () => {
  it("says the streams are not saved", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText(/not saved and are lost on restart/)).toBeTruthy()
  })

  it("lists each stream with its state, target and progress", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": LIST, "stores.list": SINGLE }))
    expect((await screen.findByText("reports/2026/09/big.csv")).className).toContain("font-mono")
    const up = rowFor("reports/2026/09/big.csv")
    expect(within(up).getByText("active")).toBeTruthy()
    expect(within(up).getByText("3,145,728 B")).toBeTruthy()
    expect(within(up).getByText("10,485,760 B")).toBeTruthy()
    expect(within(rowFor("assets/logo.png")).getByLabelText("no total size")).toBeTruthy()
    expect(screen.getByText("2 open streams, 16 allowed")).toBeTruthy()
  })

  it("counts zero and says so", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": { streams: [], active: 0, max: 16 }, "stores.list": SINGLE }))
    expect(await screen.findByText("0 open streams, 16 allowed")).toBeTruthy()
    expect(screen.getByText("No streams open.")).toBeTruthy()
  })

  // The 5 s poll refetches streams.list. QueryBoundary swaps its children for
  // a skeleton while `loading` is true, so a page on QueryBoundary would blank
  // the table on every tick.
  it("keeps the table on screen while the list refetches", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText("reports/2026/09/big.csv")).toBeTruthy()

    act(() => queryStore.invalidate("trove", ["streams.list"]))

    expect(screen.getByText("reports/2026/09/big.csv")).toBeTruthy()
    expect(screen.getByText("assets/logo.png")).toBeTruthy()
    expect(screen.queryByRole("status", { name: /Loading Transfers/ })).toBeNull()
  })
})
