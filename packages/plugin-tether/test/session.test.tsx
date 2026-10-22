import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import { TenantDetailPage } from "../src/pages/tenant-detail"
import { TenantsPage } from "../src/pages/tenants"
import type { SessionInfo, Stats, Tenant } from "../src/types"
import { TENANT_ID, devices } from "./fixtures"
import { recordingClient, renderPage, stubClient } from "./harness"

const OPERATOR: SessionInfo = { operator: true }
const MEMBER: SessionInfo = { operator: false, tenantId: TENANT_ID }

const ACME: Tenant = {
  id: TENANT_ID,
  appId: "aapp_demo",
  externalId: "acme",
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
}

const NODE: Stats = {
  scope: "node",
  tenants: 2,
  connected: 5,
  sessions: 6,
  subscriptions: 7,
  retained: 1,
  messagesIn: 10,
  messagesOut: 20,
}

const OWN: Stats = { ...NODE, scope: "tenant", tenantId: TENANT_ID, tenants: undefined }

/** Every read a tenant user's tenant page makes. */
function memberAnswers() {
  return {
    "session.info": MEMBER,
    "tenants.get": ACME,
    "overview.stats": OWN,
    "devices.list": devices(),
  }
}

describe("an operator", () => {
  it("sees the node overview with the way to every tenant", async () => {
    const { client, queries } = recordingClient({
      "session.info": OPERATOR,
      "overview.stats": NODE,
    })
    renderPage(OverviewPage, client)
    await screen.findByText("Sessions")
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Manage tenants" })).toBeTruthy()
    const stats = queries.find((q) => q.intent === "overview.stats")
    expect(stats?.params ?? {}).not.toHaveProperty("tenantId")
  })

  it("sees the link back to every tenant on a tenant page", async () => {
    renderPage(
      TenantDetailPage,
      stubClient({ ...memberAnswers(), "session.info": OPERATOR }),
      { tenantId: TENANT_ID }
    )
    await screen.findByRole("heading", { name: "Acme" })
    expect(await screen.findByRole("link", { name: "All tenants" })).toBeTruthy()
  })
})

describe("a tenant user", () => {
  it("lands on their own tenant at /", async () => {
    const { client, queries } = recordingClient(memberAnswers())
    renderPage(OverviewPage, client)
    await screen.findByRole("heading", { name: "Acme" })
    await screen.findByText("Sessions")
    expect(screen.queryByRole("link", { name: "Manage tenants" })).toBeNull()
    expect(screen.queryByRole("link", { name: "All tenants" })).toBeNull()
    // The counters are the tenant's, asked for by its ID.
    const stats = queries.filter((q) => q.intent === "overview.stats")
    expect(stats.length).toBeGreaterThan(0)
    for (const q of stats) {
      expect(q.params).toEqual({ tenantId: TENANT_ID })
    }
  })

  it("gets their own tenant from the Tenants page, never the list", async () => {
    const { client, queries } = recordingClient(memberAnswers())
    renderPage(TenantsPage, client)
    await screen.findByRole("heading", { name: "Acme" })
    expect(screen.queryByRole("button", { name: "New tenant" })).toBeNull()
    expect(queries.map((q) => q.intent)).not.toContain("tenants.list")
  })

  it("has no link to a tenant list they cannot read", async () => {
    renderPage(TenantDetailPage, stubClient(memberAnswers()), {
      tenantId: TENANT_ID,
    })
    await screen.findByRole("heading", { name: "Acme" })
    await screen.findByText("Sessions")
    expect(screen.queryByRole("link", { name: "All tenants" })).toBeNull()
  })
})

describe("a session with no tenant", () => {
  it("is told why rather than shown an empty page", async () => {
    const client = {
      ...stubClient({}),
      query: async () => {
        throw new ContractError(
          "PERMISSION_DENIED",
          "no tenant in scope for this session"
        )
      },
    }
    renderPage(OverviewPage, client)
    expect(
      await screen.findByText(/no tenant in scope for this session/)
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy()
  })
})
