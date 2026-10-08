import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TenantEditor } from "../src/components/tenant-editor"
import { TenantStatusActions } from "../src/components/tenant-status"
import type { Tenant } from "../src/types"
import { answer, commandClient } from "./fixtures"
import { renderWithClient } from "./harness"
const tenant = () =>
  answer<Tenant>("tenants.get", { id: "tenant_00000000000000000000000001" })
it("submits only dirty tenant fields and disables a no-op save", async () => {
  const original = tenant(),
    { client, commands } = commandClient()
  renderWithClient(<TenantEditor tenant={original} />, client)
  expect(
    screen
      .getByRole("button", { name: "Save changes" })
      .hasAttribute("disabled")
  ).toBe(true)
  fireEvent.change(
    screen.getByRole("textbox", { name: "Requests per minute" }),
    { target: { value: "240" } }
  )
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(commands).toHaveLength(1))
  expect(commands[0].payload).toEqual({ id: original.id, quota: { rpm: 240 } })
  expect(tenant().quota.maxStreamTokens).toBe(original.quota.maxStreamTokens)
})
it("creates a tenant with an exact budget and explicit no-limit defaults", async () => {
  const { client, commands } = commandClient()
  renderWithClient(<TenantEditor />, client)
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "New customer" },
  })
  fireEvent.change(screen.getByRole("textbox", { name: "Slug" }), {
    target: { value: "new-customer" },
  })
  fireEvent.click(
    screen.getByRole("switch", { name: "No limit: Monthly budget (USD)" })
  )
  fireEvent.change(
    screen.getByRole("textbox", { name: "Monthly budget (USD)" }),
    { target: { value: "9.000000150" } }
  )
  fireEvent.click(screen.getByRole("button", { name: "Create tenant" }))
  await waitFor(() => expect(commands).toHaveLength(1))
  expect(commands[0].payload).toMatchObject({
    name: "New customer",
    slug: "new-customer",
    quota: { monthlyBudgetUsd: "9.000000150", maxStreamDurationMs: 0 },
  })
})
it("keeps failed saves and validation visible without dropping the draft", async () => {
  const { client, commands } = commandClient({
    "tenants.update": () => {
      throw new ContractError("UNAVAILABLE", "Save unavailable")
    },
  })
  renderWithClient(<TenantEditor tenant={tenant()} />, client)
  fireEvent.change(
    screen.getByRole("textbox", { name: "Requests per minute" }),
    { target: { value: "-1" } }
  )
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect(await screen.findByRole("alert")).toBeTruthy()
  expect(commands).toHaveLength(0)
  fireEvent.change(
    screen.getByRole("textbox", { name: "Requests per minute" }),
    { target: { value: "240" } }
  )
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect(await screen.findByText(/Save unavailable/)).toBeTruthy()
  expect(
    (
      screen.getByRole("textbox", {
        name: "Requests per minute",
      }) as HTMLInputElement
    ).value
  ).toBe("240")
})
it("keeps status errors inside the confirmation dialog", async () => {
  const { client, commands } = commandClient({
    "tenants.setStatus": () => {
      throw new ContractError("PERMISSION_DENIED", "Status change denied")
    },
  })
  renderWithClient(<TenantStatusActions tenant={tenant()} />, client)
  fireEvent.click(screen.getByRole("button", { name: "Suspend tenant" }))
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Suspend tenant" })
  )
  expect(await within(dialog).findByText(/Status change denied/)).toBeTruthy()
  expect(commands[0].payload).toEqual({ id: tenant().id, status: "suspended" })
})
it("does not replace an edited draft when a background tenant read changes", async () => {
  const original = tenant(),
    { client } = commandClient()
  const view = renderWithClient(<TenantEditor tenant={original} />, client)
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Draft name" },
  })
  const { PluginProvider } = await import("@forge-go/dashboard-plugin")
  await act(async () =>
    view.rerender(
      <PluginProvider client={client}>
        <TenantEditor tenant={{ ...original, name: "Remote name" }} />
      </PluginProvider>
    )
  )
  expect(
    (screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value
  ).toBe("Draft name")
})
