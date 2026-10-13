import { cleanup, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { GatewayPage } from "../src/pages/gateway"
import { KeyDetailPage } from "../src/pages/key-detail"
import { KeysPage } from "../src/pages/keys"
import { ModelsPage } from "../src/pages/models"
import { OverviewPage } from "../src/pages/overview"
import { RecordsPage } from "../src/pages/records"
import { SettingsPage } from "../src/pages/settings"
import { TenantDetailPage } from "../src/pages/tenant-detail"
import { TenantCreatePage, TenantEditPage } from "../src/pages/tenant-form"
import { TenantsPage } from "../src/pages/tenants"
import UsagePage from "../src/pages/usage"
import type { APIKey, Page, UsageRecords } from "../src/types"
import { answer, fixtureClient } from "./fixtures"
import { renderWithClient } from "./harness"

afterEach(() => {
  cleanup()
  window.history.replaceState(null, "", "/")
})

const TENANT_ID = "tenant_00000000000000000000000001"

describe("Nexus pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { container } = renderWithClient(
      <OverviewPage />,
      fixtureClient().client
    )
    await screen.findByText("Keys required")
    await screen.findByRole("table")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("group", { name: "Nexus counters" })).toBeTruthy()
    expect(
      screen.getByRole("region", { name: /Request outcomes/ })
    ).toBeTruthy()
  })

  it("Gateway follows the shared layout", async () => {
    const { container } = renderWithClient(
      <GatewayPage />,
      fixtureClient().client
    )
    await screen.findByText("Keys required")
    await screen.findAllByRole("table")
    expect(layoutViolations(container)).toEqual([])
    for (const name of ["Pipeline", "Routing", "Cache", "Guards", "Aliases"])
      expect(screen.getByRole("region", { name })).toBeTruthy()
  })

  it("Models and providers follows the shared layout", async () => {
    const { container } = renderWithClient(
      <ModelsPage />,
      fixtureClient().client
    )
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2))
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Providers" })).toBeTruthy()
  })

  it("Settings follows the shared layout", async () => {
    const { container } = renderWithClient(
      <SettingsPage />,
      fixtureClient().client
    )
    await screen.findByText("Base path")
    expect(layoutViolations(container)).toEqual([])
    // The page has no table or h2 of its own, so name its region too.
    expect(screen.getByRole("region", { name: "Details" })).toBeTruthy()
  })

  it("API keys follows the shared layout", async () => {
    const { container } = renderWithClient(<KeysPage />, fixtureClient().client)
    await screen.findByRole("link", { name: /Research team 32 service/ })
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Key list" })).toBeTruthy()
  })

  it("API key detail follows the shared layout", async () => {
    const key = answer<Page<APIKey>>("keys.list", { status: "expired" })
      .items[0]
    const { container } = renderWithClient(
      <KeyDetailPage params={{ id: key.id }} />,
      fixtureClient().client
    )
    await screen.findByText(`${key.prefix}…`)
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Metadata" })).toBeTruthy()
  })

  it("Tenants follows the shared layout", async () => {
    const { container } = renderWithClient(
      <TenantsPage />,
      fixtureClient().client
    )
    await screen.findByRole("table")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Tenant list" })).toBeTruthy()
  })

  it("Tenant detail follows the shared layout", async () => {
    const { container } = renderWithClient(
      <TenantDetailPage params={{ id: TENANT_ID }} />,
      fixtureClient().client
    )
    await screen.findByText("85% of monthly budget")
    await screen.findByRole("table")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("group", { name: "Tenant counters" })).toBeTruthy()
    for (const name of ["Request limits", "Configuration", "API keys"])
      expect(screen.getByRole("region", { name })).toBeTruthy()
  })

  it("Create tenant follows the shared layout", async () => {
    const { container } = renderWithClient(
      <TenantCreatePage />,
      fixtureClient().client
    )
    await screen.findByRole("heading", { level: 1, name: "Create tenant" })
    expect(layoutViolations(container)).toEqual([])
    for (const name of [
      "Tenant details",
      "Quotas",
      "Configuration",
      "Tenant metadata",
      "Configuration metadata",
    ])
      expect(screen.getByRole("region", { name })).toBeTruthy()
  })

  it("Edit tenant follows the shared layout", async () => {
    const { container } = renderWithClient(
      <TenantEditPage params={{ id: TENANT_ID }} />,
      fixtureClient().client
    )
    await screen.findByRole("textbox", { name: "Name" })
    expect(layoutViolations(container)).toEqual([])
    for (const name of [
      "Tenant details",
      "Quotas",
      "Configuration",
      "Tenant metadata",
      "Configuration metadata",
    ])
      expect(screen.getByRole("region", { name })).toBeTruthy()
  })

  it("Usage follows the shared layout", async () => {
    const { container } = renderWithClient(
      <UsagePage />,
      fixtureClient().client
    )
    await screen.findByText("Spend by provider")
    await screen.findAllByRole("table")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("group", { name: "Usage counters" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Spend by model" })).toBeTruthy()
  })

  it("Request log follows the shared layout", async () => {
    const requestId = answer<UsageRecords>("usage.records").items.find(
      (row) => row.requestId
    )?.requestId
    const { container } = renderWithClient(
      <RecordsPage />,
      fixtureClient().client
    )
    await screen.findByText(requestId!)
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Request log" })).toBeTruthy()
  })
})
