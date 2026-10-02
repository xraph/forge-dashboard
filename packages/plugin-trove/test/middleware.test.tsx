import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { MiddlewarePage } from "../src/pages/middleware"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }

function reg(over: Record<string, unknown> = {}) {
  return { name: "compress", direction: "readwrite", scope: "global", priority: 0, matchesWrite: null, matchesRead: null, ...over }
}

const LIST = {
  registrations: [reg(), reg({ name: "encrypt", scope: "bucket(reports)", priority: 10 })],
  warnings: [{ code: "bypass", message: "CAS, copy and streams move stored bytes without running any middleware." }],
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("MiddlewarePage", () => {
  it("lists registrations in run order with a live count", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText("2 registrations")).toBeTruthy()
    const rows = screen.getAllByRole("row").slice(1)
    expect(within(rows[0]!).getByText("compress")).toBeTruthy()
    expect(within(rows[1]!).getByText("encrypt")).toBeTruthy()
    expect(within(rowFor("encrypt")).getByText("bucket(reports)").className).toContain("font-mono")
  })

  it("lets a long scope expression wrap", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": LIST, "stores.list": SINGLE }))
    const scope = await screen.findByText("bucket(reports)")
    expect(scope.className).toContain("whitespace-normal")
    expect(scope.className).toContain("break-all")
  })

  it("shows every warning", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText(/move stored bytes without running any middleware/)).toBeTruthy()
  })

  it("says plainly when nothing is registered", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": { registrations: [], warnings: [] }, "stores.list": SINGLE }))
    expect(await screen.findByText("0 registrations")).toBeTruthy()
    expect(screen.getByText(/Objects are stored as they arrive/)).toBeTruthy()
  })

  it("does not test until both bucket and key are filled", async () => {
    const { client, sent } = recordingQueryClient({ "middleware.list": LIST, "stores.list": SINGLE })
    renderPage(MiddlewarePage, client)
    await screen.findByText("2 registrations")
    const test = screen.getByRole("button", { name: "Test" }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "reports" } })
    expect(test.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "2026/q3.csv" } })
    expect(test.disabled).toBe(false)
    fireEvent.click(test)
    await waitFor(() =>
      expect(sent.map((s) => s.params)).toContainEqual({ bucket: "reports", key: "2026/q3.csv" }),
    )
    expect(sent.filter((s) => s.intent === "middleware.list").every((s) => {
      const p = s.params as Record<string, unknown>
      return ("bucket" in p) === ("key" in p)
    })).toBe(true)
  })

  it("shows whether each registration runs for the tested key", async () => {
    const tested = {
      registrations: [
        reg({ matchesWrite: true, matchesRead: true }),
        reg({ name: "encrypt", scope: "bucket(reports)", priority: 10, matchesWrite: false, matchesRead: false }),
      ],
      warnings: [],
    }
    renderPage(MiddlewarePage, stubClient({ "middleware.list": tested, "stores.list": SINGLE }))
    fireEvent.change(await screen.findByLabelText("Bucket"), { target: { value: "logs" } })
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "a.txt" } })
    fireEvent.click(screen.getByRole("button", { name: "Test" }))
    await waitFor(() => expect(within(rowFor("compress")).getAllByText("Runs")).toHaveLength(2))
    expect(within(rowFor("encrypt")).getAllByText("Skipped")).toHaveLength(2)
    expect(screen.getByText(/tested against logs\/a\.txt/)).toBeTruthy()
  })
})
