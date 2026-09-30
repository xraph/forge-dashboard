import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerInvoicesPage } from "../src/pages/invoices"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"
import { anInvoice, aPage } from "./fixtures"

describe("LedgerInvoicesPage", () => {
  it("lists invoices with their status and total, and filters by tenant and status", async () => {
    const { client, sent } = recordingQueryClient({ "invoices.list": aPage([anInvoice(), anInvoice({ id: "inv_2", status: "past_due" })]) })
    renderPage(LedgerInvoicesPage, client)
    await screen.findByText("inv_2")
    expect(sent[0].params).toEqual({ limit: 50, offset: 0 })
    expect(screen.getByText("2 invoices")).toBeTruthy()
    const badge = screen.getByText("Past due", { selector: '[data-slot="badge"]' })
    expect(badge.className.replace(/aria-invalid:\S+/g, "")).toMatch(/destructive/)
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } })
    await waitFor(() => expect(sent.at(-1)?.params).toEqual({ limit: 50, offset: 0, tenant_id: "acme", status: "pending" }))
  })

  it("says which kind of empty it is", async () => {
    renderPage(LedgerInvoicesPage, stubClient({ "invoices.list": aPage([]) }))
    expect(await screen.findByText("No invoices yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "past_due" } })
    expect(await screen.findByText("No past due invoices.")).toBeTruthy()
  })

  it("names the tenant when a tenant filter matched nothing", async () => {
    renderPage(LedgerInvoicesPage, stubClient({ "invoices.list": aPage([]) }))
    await screen.findByText("No invoices yet.")
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "  ghost " } })
    expect(await screen.findByText("No invoices for ghost.")).toBeTruthy()
  })

  it("links each invoice to its page", async () => {
    renderPage(LedgerInvoicesPage, stubClient({ "invoices.list": aPage([anInvoice()]) }))
    const link = await screen.findByRole("link", { name: "inv_1" })
    expect(link.getAttribute("href")).toBe("/invoices/inv_1")
  })

  it("shows the no-app refusal as an error, not as no invoices", async () => {
    renderPage(LedgerInvoicesPage, failingClient(new ContractError("PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")))
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText("No invoices yet.")).toBeNull()
  })
})
