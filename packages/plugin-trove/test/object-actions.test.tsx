import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ObjectActions } from "../src/components/object-actions"
import type { ObjectHead } from "../src/types"
import { HEAD } from "./fixtures"
import { recordingCommandClient } from "./harness"

const BUCKETS = { buckets: [{ name: "reports", createdAt: null }, { name: "assets", createdAt: null }], createdAtMeaning: "modified" }

function renderActions(client: ScopedClient, head: ObjectHead = HEAD, casBucket: string | null = "cas", navigate = vi.fn()) {
  render(
    <NavigationProvider value={{ Link: ({ to, children }) => <a href={to}>{children}</a>, navigate }}>
      <PluginProvider client={client}>
        <ObjectActions store="" bucket="reports" prefix="2026/09/" head={head} casBucket={casBucket} />
      </PluginProvider>
    </NavigationProvider>,
  )
  return navigate
}

function throwing(intent: string, error: ContractError, answers: Record<string, unknown> = {}): ScopedClient {
  const sent: { intent: string; payload: unknown }[] = []
  return {
    extension: "trove",
    query: async (i: string) => {
      if (i in answers) return answers[i]
      throw new ContractError("NOT_FOUND", `no handler for intent "${i}"`)
    },
    command: async (i: string, payload: unknown) => {
      sent.push({ intent: i, payload })
      if (i === intent && sent.filter((s) => s.intent === intent).length === 1) throw error
      return { key: "2026/09/summary.json", storedSize: 1, etag: null, lastModified: null, contentType: null, storageClass: null }
    },
    sent,
  } as unknown as ScopedClient
}

describe("Share link", () => {
  it("gives the reason when the driver cannot sign", () => {
    renderActions(recordingCommandClient({}).client)
    expect(screen.queryByRole("button", { name: "Share link" })).toBeNull()
    expect(screen.getByText(/this driver cannot sign one/)).toBeTruthy()
  })

  it("creates a link for the chosen lifetime and shows when it expires", async () => {
    const { client, sent } = recordingCommandClient({}, { "objects.presign": { url: "https://s3.example/x?sig=1", expiresAt: "2026-09-30T13:00:00Z" } })
    renderActions(client, { ...HEAD, presign: { available: true, reason: null } })
    fireEvent.click(screen.getByRole("button", { name: "Share link" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/cannot revoke it/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "objects.presign", payload: { bucket: "reports", key: "2026/09/summary.json", expiresSeconds: 3600 } }]))
    expect(((await within(dialog).findByLabelText("Share link URL")) as HTMLInputElement).value).toBe("https://s3.example/x?sig=1")
  })
})

describe("Copy to", () => {
  it("copies to the chosen bucket and key", async () => {
    const { client, sent } = recordingCommandClient({ "buckets.list": BUCKETS }, { "objects.copy": { key: "copy.json", storedSize: 1, etag: null, lastModified: null, contentType: null, storageClass: null } })
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Copy to" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(await within(dialog).findByLabelText("Destination bucket"), { target: { value: "assets" } })
    fireEvent.change(within(dialog).getByLabelText("Destination key"), { target: { value: "copy.json" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "objects.copy", payload: { srcBucket: "reports", srcKey: "2026/09/summary.json", dstBucket: "assets", dstKey: "copy.json", overwrite: false } },
      ]),
    )
    const link = await screen.findByRole("link", { name: "assets/copy.json" })
    expect(link.getAttribute("href")).toBe("/@trove/buckets/assets?key=copy.json")
  })

  it("asks before replacing an existing object, then sends overwrite", async () => {
    const client = throwing("objects.copy", new ContractError("CONFLICT", "an object with this key already exists", { exists: true }), { "buckets.list": BUCKETS })
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Copy to" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Destination key"), { target: { value: "taken.json" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    const replace = await within(dialog).findByLabelText("Replace the existing object")
    fireEvent.click(replace)
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    const sent = (client as unknown as { sent: { intent: string; payload: { overwrite: boolean } }[] }).sent
    await waitFor(() => expect(sent.map((s) => s.payload.overwrite)).toEqual([false, true]))
  })

  it("will not copy an object onto itself", async () => {
    const { client } = recordingCommandClient({ "buckets.list": BUCKETS })
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Copy to" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByLabelText("Destination bucket")
    expect((within(dialog).getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("Delete", () => {
  it("deletes and goes back to the prefix", async () => {
    const { client, sent } = recordingCommandClient({}, { "objects.delete": { key: "2026/09/summary.json" } })
    const navigate = renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "objects.delete", payload: { bucket: "reports", key: "2026/09/summary.json" } }]))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/@trove/buckets/reports?prefix=2026%2F09%2F"))
  })

  it("says up front that the CAS bucket refuses, and does not send the command", async () => {
    const { client, sent } = recordingCommandClient({})
    render(
      <PluginProvider client={client}>
        <ObjectActions store="" bucket="cas" prefix="" head={HEAD} casBucket="cas" />
      </PluginProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/CAS manages this bucket/)).toBeTruthy()
    expect((within(dialog).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("keeps a refusal inside the dialog", async () => {
    const client = throwing("objects.delete", new ContractError("CONFLICT", "CAS manages the cas bucket."))
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByText("Could not delete the object")).toBeTruthy()
  })
})
