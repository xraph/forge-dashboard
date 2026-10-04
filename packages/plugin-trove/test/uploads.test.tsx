import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { UploadDropZone, UploadTray } from "../src/components/upload-tray"
import { enqueueUploads } from "../src/uploads"
import "./harness"

class FakeXHR {
  static instances: FakeXHR[] = []
  method = ""
  url = ""
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  responseText = ""
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  aborted = false
  constructor() {
    FakeXHR.instances.push(this)
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true })
  }
  finish(status: number, body: unknown) {
    this.status = status
    this.responseText = typeof body === "string" ? body : JSON.stringify(body)
    this.onload?.()
  }
}

const TICKET = { url: "/dashboard/trove/content", ticket: "tk1", expiresAt: "2026-09-30T12:15:00Z" }
const ROW = { key: "2026/q3.csv", storedSize: 10, etag: "e", lastModified: null, contentType: "text/csv", storageClass: null }

function client(commands: (intent: string, payload: Record<string, unknown>, n: number) => unknown) {
  const sent: { intent: string; payload: Record<string, unknown> }[] = []
  const c = {
    extension: "trove",
    query: async () => {
      throw new ContractError("NOT_FOUND", "no queries here")
    },
    command: async (intent: string, payload: Record<string, unknown>) => {
      sent.push({ intent, payload })
      const answer = commands(intent, payload, sent.filter((s) => s.intent === intent).length)
      if (answer instanceof Error) throw answer
      return answer
    },
  } as unknown as ScopedClient
  return { client: c, sent }
}

function file(name: string, size = 10, type = "text/csv") {
  return new File(["x".repeat(size)], name, { type })
}

function renderTray(c: ScopedClient) {
  return render(
    <PluginProvider client={c}>
      <UploadTray />
    </PluginProvider>,
  )
}

beforeEach(() => {
  FakeXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", FakeXHR)
})
afterEach(() => vi.unstubAllGlobals())

describe("uploads", () => {
  it("begins, PUTs with the ticket in the header, reports progress, then completes", async () => {
    const { client: c, sent } = client((intent) => (intent === "objects.beginUpload" ? TICKET : ROW))
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "2026/", maxBytes: null }, [file("q3.csv")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "objects.beginUpload", payload: { bucket: "reports", key: "2026/q3.csv", size: 10, contentType: "text/csv", overwrite: false } })
    const xhr = FakeXHR.instances[0]
    expect(xhr.method).toBe("PUT")
    expect(xhr.url).toBe("/dashboard/trove/content")
    expect(xhr.headers["X-Trove-Ticket"]).toBe("tk1")
    expect(xhr.url).not.toContain("?")
    act(() => xhr.progress(5, 10))
    expect((await screen.findByRole("progressbar", { name: "Uploading 2026/q3.csv" })).getAttribute("aria-valuenow")).toBe("50")
    act(() => xhr.finish(200, { key: "2026/q3.csv", storedSize: 10, etag: "e" }))
    await waitFor(() => expect(sent[1]).toEqual({ intent: "objects.completeUpload", payload: { bucket: "reports", key: "2026/q3.csv" } }))
    expect(await screen.findByText("Uploaded")).toBeTruthy()
  })

  it("leaves contentType out when the browser did not fill it in", async () => {
    const { client: c, sent } = client(() => TICKET)
    act(() => enqueueUploads(c, { store: "archive", bucket: "b", folder: "", maxBytes: null }, [file("x.bin", 3, "")]))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ store: "archive", bucket: "b", key: "x.bin", size: 3, overwrite: false })
  })

  it("refuses a file over the limit before asking the server", async () => {
    const { client: c, sent } = client(() => TICKET)
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: 5 }, [file("big.csv", 10)]))
    expect(await screen.findByText(/larger than the 5 B upload limit/)).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("asks before replacing an existing object, and sends overwrite when told to", async () => {
    const { client: c, sent } = client((intent, _p, n) =>
      intent === "objects.beginUpload" && n === 1 ? new ContractError("CONFLICT", "an object with this key already exists", { exists: true }) : intent === "objects.beginUpload" ? TICKET : ROW,
    )
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("q3.csv")]))
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }))
    await waitFor(() => expect(sent.filter((s) => s.intent === "objects.beginUpload").map((s) => s.payload.overwrite)).toEqual([false, true]))
  })

  it("keeps a scan block on its own row", async () => {
    const { client: c } = client(() => TICKET)
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("eicar.txt")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    act(() => FakeXHR.instances[0].finish(422, { error: "A content scan blocked this upload." }))
    expect(await screen.findByText("A content scan blocked this upload.")).toBeTruthy()
  })

  it("cancels an upload in flight", async () => {
    const { client: c, sent } = client(() => TICKET)
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("q3.csv")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(FakeXHR.instances[0].aborted).toBe(true)
    expect(await screen.findByText("Cancelled")).toBeTruthy()
    expect(sent.some((s) => s.intent === "objects.completeUpload")).toBe(false)
  })

  it("runs two at a time", async () => {
    const { client: c } = client((intent) => (intent === "objects.beginUpload" ? TICKET : ROW))
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("a"), file("b"), file("c")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2))
    act(() => FakeXHR.instances[0].finish(200, { key: "a", storedSize: 10, etag: "e" }))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(3))
  })

  it("keeps going, and stays visible, when the tray unmounts and comes back", async () => {
    const { client: c } = client((intent) => (intent === "objects.beginUpload" ? TICKET : ROW))
    const first = renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("q3.csv")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    first.unmount()
    act(() => FakeXHR.instances[0].finish(200, { key: "q3.csv", storedSize: 10, etag: "e" }))
    renderTray(c)
    expect(await screen.findByText("Uploaded")).toBeTruthy()
  })

  it("refuses a dropped folder and names the destination while dragging", async () => {
    const { client: c, sent } = client(() => TICKET)
    render(
      <PluginProvider client={c}>
        <UploadDropZone store="" bucket="reports" folder="2026/09/" maxBytes={67108864} disabled={false}>
          <p>listing</p>
        </UploadDropZone>
      </PluginProvider>,
    )
    const zone = screen.getByText("listing").parentElement!
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } })
    expect(screen.getByText("reports/2026/09/").className).toContain("font-mono")
    const folderItem = { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => null }
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], items: [folderItem], files: [] } })
    expect(await screen.findByText(/Folders can't be uploaded here/)).toBeTruthy()
    expect(sent).toEqual([])
  })
})
