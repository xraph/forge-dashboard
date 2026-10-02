import { describe, expect, it } from "vitest"
import { act, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import { setActiveStore } from "../src/store"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"

function status(over: Record<string, unknown> = {}) {
  return {
    store: "primary",
    driver: "local",
    health: { ok: true, error: null },
    capabilities: {
      multipart: false, presign: false, range: false, serverCopy: false,
      versioning: false, notification: false, lifecycle: false, folders: true,
    },
    config: { defaultBucket: "reports", chunkSize: 8388608, poolSize: 16, maxUploadBytes: 67108864 },
    flags: [
      { name: "encryption", configured: true, applied: false, note: "enable_encryption is set, but the extension never registers the encrypt middleware. Nothing is encrypted." },
      { name: "compression", configured: true, applied: true, note: null },
      { name: "scanning", configured: false, applied: false, note: "No scan middleware is registered, so uploads are not scanned." },
      { name: "cas", configured: true, applied: true, note: null },
    ],
    etagIsContentHash: false,
    contentSecret: "configured",
    backends: [],
    routingNote: null,
    ...over,
  }
}

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("OverviewPage", () => {
  it("asks system.status for the default store without a store field", async () => {
    const { client, sent } = recordingQueryClient({ "system.status": status(), "stores.list": SINGLE })
    renderPage(OverviewPage, client)
    await screen.findByText("Encryption")
    expect(sent.find((s) => s.intent === "system.status")?.params).toEqual({})
  })

  it("sends the picked store", async () => {
    act(() => setActiveStore("archive"))
    const { client, sent } = recordingQueryClient({
      "system.status": status({ store: "archive" }),
      "stores.list": { mode: "multi", stores: [{ name: "primary", driver: "local", isDefault: true }, { name: "archive", driver: "s3", isDefault: false }] },
    })
    renderPage(OverviewPage, client)
    await screen.findByText("Encryption")
    expect(sent.find((s) => s.intent === "system.status")?.params).toEqual({ store: "archive" })
  })

  it("says plainly that configured encryption is not applied", async () => {
    renderPage(OverviewPage, stubClient({ "system.status": status(), "stores.list": SINGLE }))
    await screen.findByText("Encryption")
    const row = rowFor("Encryption")
    expect(within(row).getByText("Configured, not applied")).toBeTruthy()
    expect(within(row).getByText(/Nothing is encrypted/)).toBeTruthy()
    expect(screen.getByText("4 protections")).toBeTruthy()
  })

  it("shows the scope note next to an applied flag", async () => {
    const scoped = status({
      flags: [{ name: "encryption", configured: true, applied: true, note: "Applies only where its scope matches: bucket(reports). Objects outside that scope are not encrypted." }],
    })
    renderPage(OverviewPage, stubClient({ "system.status": scoped, "stores.list": SINGLE }))
    await screen.findByText("Encryption")
    const row = rowFor("Encryption")
    expect(within(row).getByText("Applied")).toBeTruthy()
    expect(within(row).getByText(/Objects outside that scope are not encrypted/)).toBeTruthy()
    expect(screen.getByText("1 protection")).toBeTruthy()
  })

  it("names the driver, its health and what it cannot do", async () => {
    renderPage(
      OverviewPage,
      stubClient({ "system.status": status({ health: { ok: false, error: "The driver did not answer a ping." } }), "stores.list": SINGLE }),
    )
    expect((await screen.findByText("local")).className).toContain("font-mono")
    expect(screen.getByText("Unhealthy")).toBeTruthy()
    expect(screen.getByText("The driver did not answer a ping.")).toBeTruthy()
    expect(screen.getByText(/this driver cannot sign one/)).toBeTruthy()
  })

  it("shows no object counts or storage totals", async () => {
    renderPage(OverviewPage, stubClient({ "system.status": status(), "stores.list": SINGLE }))
    await screen.findByText("Encryption")
    expect(screen.queryByText(/objects/i)).toBeNull()
    expect(screen.queryByText(/storage used/i)).toBeNull()
  })

  it("marks a missing default bucket as none and explains a per-process key", async () => {
    renderPage(
      OverviewPage,
      stubClient({
        "system.status": status({ config: { defaultBucket: null, chunkSize: 1024, poolSize: 4, maxUploadBytes: 1024 }, contentSecret: "per-process" }),
        "stores.list": SINGLE,
      }),
    )
    expect(await screen.findByLabelText("no default bucket")).toBeTruthy()
    expect(screen.getByText(/set dashboard_content_secret/)).toBeTruthy()
  })

  it("warns when the store routes keys to other backends", async () => {
    renderPage(
      OverviewPage,
      stubClient({
        "system.status": status({
          backends: ["cold"],
          routingNote: "This store routes some keys to other backends. Listings, bucket operations and health describe the default backend only.",
        }),
        "stores.list": SINGLE,
      }),
    )
    expect(await screen.findByText(/describe the default backend only/)).toBeTruthy()
    expect(screen.getByText("cold")).toBeTruthy()
  })

  it("shows an error card when the status cannot be read", async () => {
    renderPage(OverviewPage, failingClient(new ContractError("UNAVAILABLE", "store offline")))
    expect(await screen.findByText(/store offline/)).toBeTruthy()
  })
})
