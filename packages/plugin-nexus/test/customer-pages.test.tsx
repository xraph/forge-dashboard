import { fireEvent, screen, waitFor } from "@testing-library/react"
import { expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TenantsPage } from "../src/pages/tenants"
import { TenantDetailPage } from "../src/pages/tenant-detail"
import { KeysPage } from "../src/pages/keys"
import { KeyDetailPage } from "../src/pages/key-detail"
import type { APIKey, Page, Tenant } from "../src/types"
import { answer, fixtureClient } from "./fixtures"
import { renderWithClient } from "./harness"

it("pages tenants and resets the cursor on search or status change", async () => {
  const { client, sent } = fixtureClient()
  renderWithClient(<TenantsPage />, client)
  fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
  await waitFor(() =>
    expect(
      sent.some((x) => x.intent === "tenants.list" && x.params?.cursor)
    ).toBe(true)
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Search tenants" }), {
    target: { value: "Acme" },
  })
  expect(await screen.findByRole("link", { name: "Acme AI" })).toBeTruthy()
  expect(
    sent.filter((x) => x.intent === "tenants.list").at(-1)?.params?.cursor
  ).toBeUndefined()
  fireEvent.change(screen.getByRole("combobox", { name: "Tenant status" }), {
    target: { value: "disabled" },
  })
  expect(await screen.findByText("No matching tenants")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy()
})

it("shows tenant quotas, preserved metadata and stored unenforced settings", async () => {
  const tenant = answer<Page<Tenant>>("tenants.list", { search: "Acme" })
    .items[0]
  const { client, sent } = fixtureClient()
  renderWithClient(<TenantDetailPage params={{ id: tenant.id }} />, client)
  expect(await screen.findByText("$850")).toBeTruthy()
  expect(screen.getByText("85% of monthly budget")).toBeTruthy()
  expect(screen.getByText("Platform")).toBeTruthy()
  expect(screen.getByText("us-central")).toBeTruthy()
  expect(screen.getAllByText(/Stored, not enforced/).length).toBe(2)
  await waitFor(() =>
    expect(
      sent.some(
        (x) => x.intent === "keys.list" && x.params?.tenantId === tenant.id
      )
    ).toBe(true)
  )
})

it("lists active keys by default and can include expired resources", async () => {
  const { client, sent } = fixtureClient()
  renderWithClient(<KeysPage />, client)
  await screen.findByRole("link", { name: /Research team 32 service/ })
  expect(
    sent.some(
      (x) =>
        x.intent === "keys.list" &&
        x.params?.status === "active" &&
        !Object.hasOwn(x.params, "tenantId")
    )
  ).toBe(true)
  fireEvent.change(screen.getByRole("combobox", { name: "Key status" }), {
    target: { value: "expired" },
  })
  expect(await screen.findByText("expired")).toBeTruthy()
})

it("shows expired key detail and keeps the raw secret out of reads", async () => {
  const key = answer<Page<APIKey>>("keys.list", { status: "expired" }).items[0]
  renderWithClient(
    <KeyDetailPage params={{ id: key.id }} />,
    fixtureClient().client
  )
  expect(await screen.findByText("expired")).toBeTruthy()
  expect(screen.getByText(`${key.prefix}…`)).toBeTruthy()
  expect(screen.getByRole("link", { name: key.tenantName })).toBeTruthy()
  expect(screen.queryByText(/rawKey/)).toBeNull()
})

it("missing route IDs issue no queries", () => {
  const { client, sent } = fixtureClient()
  renderWithClient(<TenantDetailPage params={{}} />, client)
  expect(screen.getByText("Invalid tenant address")).toBeTruthy()
  expect(sent).toEqual([])
})

it("keeps denied access separate from a missing key", async () => {
  const key = answer<Page<APIKey>>("keys.list").items[0]
  renderWithClient(
    <KeyDetailPage params={{ id: key.id }} />,
    fixtureClient({
      "keys.get": () => {
        throw new ContractError("PERMISSION_DENIED", "Access denied")
      },
    }).client
  )
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "PERMISSION_DENIED: Access denied"
  )
  expect(screen.queryByText("Key not found")).toBeNull()
})
