import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TenantsPage } from "../src/pages/tenants"
import type { Tenant, TenantsList } from "../src/types"
import {
  failingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

function tenant(over: Partial<Tenant>): Tenant {
  return {
    id: "ttnt_01acme",
    appId: "app_01main",
    externalId: "org_acme",
    name: "Acme",
    enabled: true,
    limits: {
      maxConnections: 0,
      messagesPerSecond: 0,
      burst: 0,
      maxSessionExpirySeconds: 0,
      maxSessions: 0,
    },
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...over,
  }
}

const ACME = tenant({})
const GLOBEX = tenant({
  id: "ttnt_02globex",
  appId: "app_02other",
  externalId: "org_globex",
  name: "Globex",
  enabled: false,
  limits: {
    maxConnections: 500,
    messagesPerSecond: 50,
    burst: 100,
    maxSessionExpirySeconds: 86400,
    maxSessions: 300,
  },
})

function list(...items: Tenant[]): TenantsList {
  return { items, limit: 100, offset: 0 }
}

const ACK = { ok: true }

function openCreate() {
  fireEvent.click(screen.getByRole("button", { name: "New tenant" }))
  return screen.findByRole("dialog", { name: "Create tenant" })
}

function type(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  })
}

describe("TenantsPage list", () => {
  it("renders every tenant with its IDs in font-mono text-xs", async () => {
    renderPage(TenantsPage, stubClient({ "tenants.list": list(ACME, GLOBEX) }))
    for (const id of [
      "ttnt_01acme",
      "ttnt_02globex",
      "app_01main",
      "app_02other",
      "org_acme",
      "org_globex",
    ]) {
      const cell = await screen.findByText(id)
      expect(cell.className, id).toContain("font-mono")
      expect(cell.className, id).toContain("text-xs")
    }
  })

  it("links each name to its detail page", async () => {
    renderPage(TenantsPage, stubClient({ "tenants.list": list(ACME) }))
    const link = await screen.findByRole("link", { name: "Acme" })
    expect(link.getAttribute("href")).toBe("/tenants/ttnt_01acme")
  })

  it("shows a live row count in the caption", async () => {
    renderPage(TenantsPage, stubClient({ "tenants.list": list(ACME, GLOBEX) }))
    expect(await screen.findByText("2 tenants")).toBeTruthy()
  })

  it("marks the disabled tenant, and says enabled for the others", async () => {
    renderPage(TenantsPage, stubClient({ "tenants.list": list(ACME, GLOBEX) }))
    const acme = (await screen.findByText("ttnt_01acme")).closest("tr")!
    const globex = screen.getByText("ttnt_02globex").closest("tr")!
    expect(within(acme).getByText("enabled")).toBeTruthy()
    expect(within(globex).getByText("disabled")).toBeTruthy()
  })

  it("summarises limits, and says defaults when none are set", async () => {
    renderPage(TenantsPage, stubClient({ "tenants.list": list(ACME, GLOBEX) }))
    const acme = (await screen.findByText("ttnt_01acme")).closest("tr")!
    const globex = screen.getByText("ttnt_02globex").closest("tr")!
    expect(within(acme).getByLabelText("no custom limits")).toBeTruthy()
    expect(within(globex).getByText(/500 connections/)).toBeTruthy()
    expect(within(globex).getByText(/50 msg\/s/)).toBeTruthy()
    expect(within(globex).getByText(/300 sessions/)).toBeTruthy()
  })

  it("names an empty list", async () => {
    renderPage(TenantsPage, stubClient({ "tenants.list": list() }))
    expect(await screen.findByText("No tenants yet.")).toBeTruthy()
  })

  it("warns when the page is full, since a next one may exist", async () => {
    renderPage(
      TenantsPage,
      stubClient({
        "tenants.list": { items: [ACME, GLOBEX], limit: 2, offset: 0 },
      })
    )
    expect(await screen.findByText(/first 2 tenants/i)).toBeTruthy()
  })

  it("tells a signed-out operator how to get in", async () => {
    renderPage(
      TenantsPage,
      failingClient(
        new ContractError("UNAUTHENTICATED", "authentication required")
      )
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/sign in/i)
    expect(alert.textContent).toMatch(/dashboard auth/i)
  })
})

describe("TenantsPage create", () => {
  it("sends the typed payload, with limits when any were set", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list(ACME) },
      { "tenants.create": ACME }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("ttnt_01acme")
    const dialog = await openCreate()
    type(dialog, "Name", "  Initech ")
    type(dialog, "App ID", "app_01main")
    type(dialog, "External ID", "org_initech")
    type(dialog, "Max connections", "250")
    type(dialog, "Messages per second", "12.5")
    type(dialog, "Max sessions", "40")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )

    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "tenants.create",
      payload: {
        appId: "app_01main",
        externalId: "org_initech",
        name: "Initech",
        limits: {
          maxConnections: 250,
          messagesPerSecond: 12.5,
          burst: 0,
          maxSessionExpirySeconds: 0,
          maxSessions: 40,
        },
      },
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Create tenant" })).toBeNull()
    )
  })

  it("leaves limits off when none were set", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list() },
      { "tenants.create": ACME }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("No tenants yet.")
    const dialog = await openCreate()
    type(dialog, "App ID", "app_01main")
    type(dialog, "External ID", "org_initech")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )

    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0].payload).toEqual({
      appId: "app_01main",
      externalId: "org_initech",
      name: "",
    })
    expect(commands[0].payload).not.toHaveProperty("limits")
  })

  it("refuses a missing app or external ID without sending anything", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list() },
      { "tenants.create": ACME }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("No tenants yet.")
    const dialog = await openCreate()
    type(dialog, "App ID", "app_01main")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /external id is required/i
    )
    expect(commands).toHaveLength(0)
  })

  it("refuses a negative limit without sending anything", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list() },
      { "tenants.create": ACME }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("No tenants yet.")
    const dialog = await openCreate()
    type(dialog, "App ID", "app_01main")
    type(dialog, "External ID", "org_initech")
    type(dialog, "Burst", "-1")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /burst/i
    )
    expect(commands).toHaveLength(0)
  })

  it("keeps the dialog open and shows the server's refusal inside it", async () => {
    const client = stubClient(
      { "tenants.list": list(ACME) },
      {
        "tenants.create": () => {
          throw new ContractError(
            "CONFLICT",
            "external id is already used by another tenant"
          )
        },
      }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("ttnt_01acme")
    const dialog = await openCreate()
    type(dialog, "App ID", "app_01main")
    type(dialog, "External ID", "org_acme")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/already used by another tenant/)
    expect(alert.textContent).toMatch(/CONFLICT/)
    expect(screen.getByRole("dialog", { name: "Create tenant" })).toBe(dialog)
    // What was typed survives the failure.
    expect(
      (within(dialog).getByLabelText("External ID") as HTMLInputElement).value
    ).toBe("org_acme")
  })

  it("starts blank, with no stale error, the next time it opens", async () => {
    const client = stubClient(
      { "tenants.list": list(ACME) },
      {
        "tenants.create": () => {
          throw new ContractError("CONFLICT", "external id is already used")
        },
      }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("ttnt_01acme")
    let dialog = await openCreate()
    type(dialog, "App ID", "app_01main")
    type(dialog, "External ID", "org_acme")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Create tenant" })).toBeNull()
    )
    dialog = await openCreate()
    expect(within(dialog).queryByRole("alert")).toBeNull()
    expect(
      (within(dialog).getByLabelText("App ID") as HTMLInputElement).value
    ).toBe("")
  })

  it("explains a signed-out refusal inside the dialog", async () => {
    const client = stubClient(
      { "tenants.list": list(ACME) },
      {
        "tenants.create": () => {
          throw new ContractError("UNAUTHENTICATED", "authentication required")
        },
      }
    )
    renderPage(TenantsPage, client)
    await screen.findByText("ttnt_01acme")
    const dialog = await openCreate()
    type(dialog, "App ID", "app_01main")
    type(dialog, "External ID", "org_x")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create tenant" })
    )
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /sign in/i
    )
  })
})

describe("TenantsPage enable and disable", () => {
  it("disables an enabled tenant with a partial update", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list(ACME, GLOBEX) },
      { "tenants.update": ACME }
    )
    renderPage(TenantsPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Disable Acme" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "tenants.update",
      payload: { tenantId: "ttnt_01acme", enabled: false },
    })
  })

  it("enables a disabled tenant", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list(ACME, GLOBEX) },
      { "tenants.update": GLOBEX }
    )
    renderPage(TenantsPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Enable Globex" })
    )
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0].payload).toEqual({
      tenantId: "ttnt_02globex",
      enabled: true,
    })
  })

  it("shows a failed update on the page", async () => {
    const client = stubClient(
      { "tenants.list": list(ACME) },
      {
        "tenants.update": () => {
          throw new ContractError("NOT_FOUND", "tenant not found")
        },
      }
    )
    renderPage(TenantsPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Disable Acme" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/Could not disable Acme/)
    expect(alert.textContent).toMatch(/tenant not found/)
  })
})

describe("TenantsPage delete", () => {
  async function openDelete(name: string) {
    fireEvent.click(
      await screen.findByRole("button", { name: `Delete ${name}` })
    )
    return screen.findByRole("alertdialog")
  }

  it("confirms, then sends tenants.delete with the tenant", async () => {
    const { client, commands } = recordingClient(
      { "tenants.list": list(ACME, GLOBEX) },
      { "tenants.delete": ACK }
    )
    renderPage(TenantsPage, client)
    const dialog = await openDelete("Acme")
    expect(within(dialog).getByText(/Delete .?Acme.?\?/)).toBeTruthy()
    expect(commands).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "tenants.delete",
      payload: { tenantId: "ttnt_01acme" },
    })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows the server's refusal inside the dialog and keeps it open", async () => {
    const client = stubClient(
      { "tenants.list": list(ACME) },
      {
        "tenants.delete": () => {
          throw new ContractError(
            "CONFLICT",
            "tenant still has devices; delete them first"
          )
        },
      }
    )
    renderPage(TenantsPage, client)
    const dialog = await openDelete("Acme")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/still has devices/)
    expect(alert.textContent).toMatch(/CONFLICT/)
    expect(screen.getByRole("alertdialog")).toBe(dialog)
  })

  it("does not show one tenant's failure on the next one's dialog", async () => {
    const client = stubClient(
      { "tenants.list": list(ACME, GLOBEX) },
      {
        "tenants.delete": () => {
          throw new ContractError("CONFLICT", "tenant still has devices")
        },
      }
    )
    renderPage(TenantsPage, client)
    let dialog = await openDelete("Acme")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    dialog = await openDelete("Globex")
    expect(within(dialog).queryByRole("alert")).toBeNull()
  })

  it("disables the confirm button while the delete is in flight", async () => {
    let release: (() => void) | undefined
    const { client, commands } = recordingClient(
      { "tenants.list": list(ACME) },
      {
        "tenants.delete": () =>
          new Promise((resolve) => {
            release = () => resolve(ACK)
          }),
      }
    )
    renderPage(TenantsPage, client)
    const dialog = await openDelete("Acme")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const working = await within(dialog).findByRole("button", {
      name: "Working…",
    })
    expect((working as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(working)
    expect(commands).toHaveLength(1)
    release?.()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})
