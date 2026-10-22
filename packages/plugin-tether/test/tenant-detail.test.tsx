import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TenantDetailPage } from "../src/pages/tenant-detail"
import type { Stats, Tenant } from "../src/types"
import { recordingClient, renderPage, stubClient } from "./harness"

const GLOBEX: Tenant = {
  id: "ttnt_02globex",
  appId: "app_02other",
  externalId: "org_globex",
  name: "Globex",
  enabled: false,
  limits: {
    maxConnections: 500,
    messagesPerSecond: 50,
    burst: 0,
    maxSessionExpirySeconds: 86400,
  },
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-02T09:00:00Z",
}

const STATS: Stats = {
  scope: "tenant",
  tenantId: "ttnt_02globex",
  connected: 17,
  sessions: 20,
  subscriptions: 80,
  retained: 3,
  messagesIn: 1200,
  messagesOut: 3400,
}

// The Devices tab is open first, so every render reads the tenant's devices.
const DEVICES = { items: [], limit: 100, offset: 0 }

const PARAMS = { tenantId: "ttnt_02globex" }

describe("TenantDetailPage", () => {
  it("renders the tenant's header: name, IDs, limits and state", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": GLOBEX,
        "overview.stats": STATS,
        "devices.list": DEVICES,
      }),
      PARAMS
    )
    expect(await screen.findByRole("heading", { name: "Globex" })).toBeTruthy()
    for (const id of ["ttnt_02globex", "app_02other", "org_globex"]) {
      const cell = screen.getByText(id)
      expect(cell.className, id).toContain("font-mono")
      expect(cell.className, id).toContain("text-xs")
    }
    expect(screen.getByText("disabled")).toBeTruthy()
    expect(screen.getByText("500")).toBeTruthy()
    expect(screen.getByText("50 / s")).toBeTruthy()
    expect(screen.getByText("1 day")).toBeTruthy()
  })

  it("says default for a limit of zero", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": GLOBEX,
        "overview.stats": STATS,
        "devices.list": DEVICES,
      }),
      PARAMS
    )
    await screen.findByRole("heading", { name: "Globex" })
    // burst is 0
    const term = screen.getByText("Burst")
    expect(term.nextElementSibling?.textContent).toBe("Default")
  })

  it("reads the tenant and its stats by tenantId", async () => {
    const { client, queries } = recordingClient({
      "tenants.get": GLOBEX,
      "overview.stats": STATS,
      "devices.list": DEVICES,
    })
    renderPage(TenantDetailPage, client, PARAMS)
    await screen.findByRole("heading", { name: "Globex" })
    await screen.findByText("Connected clients")
    expect(queries).toContainEqual({
      intent: "tenants.get",
      params: { tenantId: "ttnt_02globex" },
    })
    expect(queries).toContainEqual({
      intent: "overview.stats",
      params: { tenantId: "ttnt_02globex" },
    })
  })

  it("renders that tenant's counters", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": GLOBEX,
        "overview.stats": STATS,
        "devices.list": DEVICES,
      }),
      PARAMS
    )
    const cell = (await screen.findByText("Connected clients")).closest(
      '[data-slot="stat"]'
    ) as HTMLElement
    expect(within(cell).getByText("17")).toBeTruthy()
    // A tenant's stats carry no tenant count.
    expect(screen.queryByText("Tenants")).toBeNull()
  })

  it("has the tab strip, with Devices first", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": GLOBEX,
        "overview.stats": STATS,
        "devices.list": DEVICES,
      }),
      PARAMS
    )
    await screen.findByRole("heading", { name: "Globex" })
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toEqual(["Devices", "Roles & topics", "Clients"])
    expect(
      screen.getByRole("tab", { name: "Devices" }).getAttribute("aria-selected")
    ).toBe("true")
  })

  it("shows the devices of the tenant under Devices", async () => {
    const { client, queries } = recordingClient({
      "tenants.get": GLOBEX,
      "overview.stats": STATS,
      "devices.list": {
        items: [
          {
            id: "tdev_01thermo",
            tenantId: "ttnt_02globex",
            name: "Thermostat",
            keyId: "akey_01thermo",
            roles: [],
            createdAt: "2026-10-01T09:00:00Z",
            updatedAt: "2026-10-01T09:00:00Z",
          },
        ],
        limit: 100,
        offset: 0,
      },
    })
    renderPage(TenantDetailPage, client, PARAMS)
    expect(await screen.findByText("Thermostat")).toBeTruthy()
    expect(queries).toContainEqual({
      intent: "devices.list",
      params: { tenantId: "ttnt_02globex" },
    })
  })

  it("opens the roles and clients tabs on this tenant, and reads them only then", async () => {
    const { client, queries } = recordingClient({
      "tenants.get": GLOBEX,
      "overview.stats": STATS,
      "devices.list": DEVICES,
      "roles.list": {
        items: [{ slug: "reader", name: "Reader", publish: [], subscribe: [] }],
      },
      "clients.list": { items: [] },
    })
    renderPage(TenantDetailPage, client, PARAMS)
    await screen.findByText("No devices yet.")
    expect(queries.map((q) => q.intent)).not.toContain("roles.list")
    expect(queries.map((q) => q.intent)).not.toContain("clients.list")

    fireEvent.click(screen.getByRole("tab", { name: "Roles & topics" }))
    expect(await screen.findByText("Reader")).toBeTruthy()
    expect(queries).toContainEqual({
      intent: "roles.list",
      params: { tenantId: "ttnt_02globex" },
    })

    fireEvent.click(screen.getByRole("tab", { name: "Clients" }))
    expect(await screen.findByText("No clients on this node.")).toBeTruthy()
    expect(queries).toContainEqual({
      intent: "clients.list",
      params: { tenantId: "ttnt_02globex" },
    })
  })

  it("keeps the header when only the counters fail", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": GLOBEX,
        "devices.list": DEVICES,
        "overview.stats": () => {
          throw new ContractError("UNAVAILABLE", "broker is not running")
        },
      }),
      PARAMS
    )
    expect(await screen.findByRole("heading", { name: "Globex" })).toBeTruthy()
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/UNAVAILABLE/)
  })

  it("shows NOT_FOUND for a tenant that does not exist", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": () => {
          throw new ContractError("NOT_FOUND", "tenant not found")
        },
        "overview.stats": STATS,
        "devices.list": DEVICES,
      }),
      PARAMS
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/NOT_FOUND/)
  })

  it("links back to the tenant list", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({
        "tenants.get": GLOBEX,
        "overview.stats": STATS,
        "devices.list": DEVICES,
      }),
      PARAMS
    )
    const back = await screen.findByRole("link", { name: /all tenants/i })
    expect(back.getAttribute("href")).toBe("/tenants")
  })
})
