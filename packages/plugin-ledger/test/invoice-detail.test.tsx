import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { invoiceTransitions, LedgerInvoiceDetailPage } from "../src/pages/invoice-detail"
import { failingClient, renderWithNavigation, scriptedClient } from "./harness"
import { aLineItem, anInvoice, aSubscription, usd } from "./fixtures"

function detail(over = {}) {
  return { invoice: anInvoice(over), subscription: aSubscription(), export_formats: ["csv", "json"] }
}

function open(over = {}, commands: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const { client, sent } = scriptedClient({ "invoices.detail": detail(over), ...extra }, commands)
  return { ...renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" }), sent }
}

/** A dialog's description is a paragraph, so nothing block-level may sit inside it. */
function expectPhrasingOnly(dialog: HTMLElement) {
  const description = dialog.querySelector("[data-slot=alert-dialog-description]")
  expect(description).not.toBeNull()
  expect(description?.querySelector("div, p, ul, ol, table, section, h1, h2, h3")).toBeNull()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("invoiceTransitions", () => {
  // Checked against ledger's FinalizeInvoice, MarkInvoicePaid and MarkInvoiceVoided:
  // finalize takes draft only, paid and voided are final for both mark-paid and
  // void, and everything else is open to both. The engine would also take a
  // draft straight to paid, but that skips the due date finalize sets, so the
  // page offers finalize first.
  it("offers only the legal next step", () => {
    expect(invoiceTransitions("draft")).toEqual(["finalize", "void"])
    expect(invoiceTransitions("pending")).toEqual(["markPaid", "void"])
    expect(invoiceTransitions("past_due")).toEqual(["markPaid", "void"])
    expect(invoiceTransitions("paid")).toEqual([])
    expect(invoiceTransitions("voided")).toEqual([])
  })
})

describe("LedgerInvoiceDetailPage", () => {
  it("reads as a receipt: subtotal, discount, tax, then the total", async () => {
    open()
    const receipt = await screen.findByRole("region", { name: "Totals" })
    const terms = within(receipt).getAllByRole("term").map((t) => t.textContent)
    expect(terms).toEqual(["Subtotal", "Discount", "Tax", "Total"])
    const total = within(receipt).getByText(/120\.10/)
    expect(total.className).toMatch(/tabular-nums/)
    expect(within(receipt).getByText(/27\.80/).textContent).toMatch(/^[−-]/)
  })

  it("shows the engine's totals as they are, and a zero discount as a plain zero", async () => {
    open({ discount_amount: usd(0), subtotal: usd(13900), tax_amount: usd(0), total: usd(13900) })
    const receipt = await screen.findByRole("region", { name: "Totals" })
    const zero = within(receipt).getAllByText("$0.00")
    expect(zero).toHaveLength(2)
    for (const z of zero) expect(z.textContent).not.toMatch(/[−-]/)
    expect(within(receipt).queryByText(/cannot go below zero/)).toBeNull()
  })

  it("says so when the discount is larger than the subtotal, because the total then is not a subtraction", async () => {
    open({ subtotal: usd(1000), discount_amount: usd(1500), tax_amount: usd(0), total: usd(0) })
    const receipt = await screen.findByRole("region", { name: "Totals" })
    expect(within(receipt).getByText(/cannot go below zero/)).toBeTruthy()
  })

  it("groups the line items by kind", async () => {
    open()
    await screen.findByRole("region", { name: "Totals" })
    expect(screen.getByRole("heading", { name: "Base" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Seats" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Discounts" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Tax" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Overage" })).toBeNull()
    const seats = screen.getByRole("region", { name: "1 seat line" })
    expect(within(seats).getByText("6").closest("td")?.className).toMatch(/text-right/)
  })

  it("shows a tier-priced line's missing unit price as none, not as $0.00", async () => {
    // The engine prices seats and overage from a tier ladder and records a zero
    // unit amount, because a ladder has no single per-unit price.
    open({
      line_items: [
        aLineItem({ id: "li_s", description: "Seats", quantity: 6, unit_amount: usd(0), amount: usd(9000), type: "seat", feature_key: "seats" }),
        aLineItem({ id: "li_o", description: "API calls overage", quantity: 12000, unit_amount: usd(0), amount: usd(2400), type: "overage", feature_key: "api_calls" }),
        aLineItem(),
      ],
    })
    await screen.findByRole("region", { name: "Totals" })
    const seats = screen.getByRole("region", { name: "1 seat line" })
    expect(within(seats).getByLabelText("no unit price")).toBeTruthy()
    expect(within(seats).getByText("$90.00")).toBeTruthy()
    expect(within(seats).queryByText("$0.00")).toBeNull()
    const overage = screen.getByRole("region", { name: "1 overage line" })
    expect(within(overage).getByLabelText("no unit price")).toBeTruthy()
    expect(within(overage).getByText("12,000")).toBeTruthy()
    // A base line has a real unit price, and keeps it.
    const base = screen.getByRole("region", { name: "1 base line" })
    expect(within(base).queryByLabelText("no unit price")).toBeNull()
    expect(within(base).getAllByText("$49.00")).toHaveLength(2)
  })

  it("shows a discount line as a negative amount", async () => {
    open()
    const discounts = await screen.findByRole("region", { name: "1 discount line" })
    expect(within(discounts).getAllByText(/27\.80/).length).toBeGreaterThan(0)
    expect(within(discounts).getAllByText(/27\.80/)[0].textContent).toMatch(/^[−-]/)
  })

  it("says when an invoice has no line items", async () => {
    open({ line_items: [] })
    expect(await screen.findByText("This invoice has no line items.")).toBeTruthy()
  })

  it("shows where the invoice is in its life and offers the next step only", async () => {
    open()
    const steps = await screen.findByRole("list", { name: "Invoice progress" })
    expect(within(steps).getByText("Pending").closest("li")?.getAttribute("aria-current")).toBe("step")
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Void" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Finalize" })).toBeNull()
  })

  it("marks a past-due invoice as past due on the progress list and still offers payment", async () => {
    open({ status: "past_due" })
    const steps = await screen.findByRole("list", { name: "Invoice progress" })
    expect(within(steps).getByText("Past due").closest("li")?.getAttribute("aria-current")).toBe("step")
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeTruthy()
  })

  it("offers finalize and void on a draft, and not payment", async () => {
    open({ status: "draft", due_date: undefined })
    await screen.findByRole("region", { name: "Totals" })
    expect(screen.getByRole("button", { name: "Finalize" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Void" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull()
  })

  it("offers nothing on a paid invoice", async () => {
    open({ status: "paid", paid_at: "2026-09-22T10:00:00Z", payment_ref: "ch_1" })
    await screen.findByRole("region", { name: "Totals" })
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull()
    expect(screen.getByText("ch_1")).toBeTruthy()
  })

  it("says a voided invoice is final and shows why it was voided", async () => {
    open({ status: "voided", voided_at: "2026-09-23T10:00:00Z", void_reason: "Duplicate" })
    await screen.findByRole("region", { name: "Totals" })
    expect(screen.getByText(/cannot change again/)).toBeTruthy()
    expect(screen.getByText("Duplicate")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Finalize" })).toBeNull()
  })

  it("links to the subscription", async () => {
    open()
    const link = await screen.findByRole("link", { name: "sub_acme" })
    expect(link.getAttribute("href")).toBe("/subscriptions/sub_acme")
  })

  it("finalizes a draft, and says the due date it sets", async () => {
    const { sent } = open({ status: "draft" }, { "invoices.finalize": anInvoice() })
    fireEvent.click(await screen.findByRole("button", { name: "Finalize" }))
    const dialog = await screen.findByRole("alertdialog")
    expectPhrasingOnly(dialog)
    expect(within(dialog).getByText(/30 days/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Finalize invoice" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "invoices.finalize", payload: { id: "inv_1" } }]))
  })

  it("marks paid with a trimmed reference, and the time only when given", async () => {
    const { sent } = open({}, { "invoices.markPaid": anInvoice({ status: "paid" }) })
    fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }))
    const dialog = await screen.findByRole("alertdialog")
    expectPhrasingOnly(dialog)
    fireEvent.change(within(dialog).getByLabelText("Payment reference"), { target: { value: "  ch_123 " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "invoices.markPaid", payload: { id: "inv_1", payment_ref: "ch_123" } }]))
  })

  it("sends paid_at as RFC3339 when a time is given", async () => {
    const { sent } = open({}, { "invoices.markPaid": anInvoice({ status: "paid" }) })
    fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(within(dialog).getByLabelText("Paid at"), { target: { value: "2026-09-25T14:30" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ id: "inv_1", payment_ref: "", paid_at: new Date("2026-09-25T14:30").toISOString() })
  })

  it("keeps a refusal to mark paid inside the dialog, and clears it when the dialog is opened again", async () => {
    open({}, { "invoices.markPaid": new ContractError("CONFLICT", "ledger: invoice is voided") })
    fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }))
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }))
    expect(await within(dialog).findByText("ledger: invoice is voided")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }))
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByText("ledger: invoice is voided")).toBeNull()
  })

  it("needs a reason to void, and keeps a refusal in the dialog", async () => {
    const { sent } = open({}, { "invoices.void": new ContractError("CONFLICT", "a paid invoice cannot be voided") })
    fireEvent.click(await screen.findByRole("button", { name: "Void" }))
    const dialog = await screen.findByRole("alertdialog")
    expectPhrasingOnly(dialog)
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Duplicate" } })
    fireEvent.click(confirm)
    expect(await within(dialog).findByText("a paid invoice cannot be voided")).toBeTruthy()
    expect(sent[0].payload).toEqual({ id: "inv_1", reason: "Duplicate" })
  })

  it("does not send a void for a reason that is only spaces", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Void" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "   " } })
    expect((within(dialog).getByRole("button", { name: "Void invoice" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("downloads an export through invoices.export", async () => {
    const created = vi.fn<(blob: Blob) => string>(() => "blob:ledger")
    const revoked = vi.fn()
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const csv = btoa("description,quantity\n")
    const { client } = scriptedClient({
      "invoices.detail": detail(),
      "invoices.export": { format: "csv", filename: "invoice-inv_1.csv", content: csv },
    })
    const query = vi.spyOn(client, "query")
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" })
    fireEvent.click(await screen.findByRole("button", { name: "Download CSV" }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(query).toHaveBeenCalledWith("invoices.export", { id: "inv_1", format: "csv" })
    expect(created).toHaveBeenCalled()
    expect(created.mock.calls[0][0].type).toBe("text/csv")
    expect(created.mock.calls[0][0].size).toBe("description,quantity\n".length)
  })

  it.each([
    ["pdf", "application/pdf"],
    ["xyz", "application/octet-stream"],
  ])("types a %s export as %s", async (format, type) => {
    const created = vi.fn<(blob: Blob) => string>(() => "blob:ledger")
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const { client } = scriptedClient({
      "invoices.detail": { ...detail(), export_formats: [format] },
      "invoices.export": { format, filename: `invoice-inv_1.${format}`, content: btoa("%PDF-1.4") },
    })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" })
    fireEvent.click(await screen.findByRole("button", { name: `Download ${format.toUpperCase()}` }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(created.mock.calls[0][0].type).toBe(type)
  })

  it("shows an export that failed, and says when no formatter is registered", async () => {
    const { client } = scriptedClient({
      "invoices.detail": detail(),
      "invoices.export": new ContractError("BAD_REQUEST", 'ledger: invalid input: no invoice formatter for format "csv"'),
    })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" })
    fireEvent.click(await screen.findByRole("button", { name: "Download CSV" }))
    expect(await screen.findByText(/no invoice formatter for format/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Download CSV" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("says so when no invoice formatter is registered", async () => {
    const { client } = scriptedClient({ "invoices.detail": { ...detail(), export_formats: null } })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" })
    expect(await screen.findByText("No invoice formatter is registered.")).toBeTruthy()
  })

  it("syncs to the provider through invoices.syncToProvider", async () => {
    const result = { provider_name: "stripe", provider_id: "in_1", entity_type: "invoice", entity_id: "inv_1", direction: "push", success: true }
    const { sent } = open({}, { "invoices.syncToProvider": result })
    fireEvent.click(await screen.findByRole("button", { name: "Sync to provider" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "invoices.syncToProvider", payload: { id: "inv_1" } }]))
    expect(await screen.findByText("Synced to stripe.")).toBeTruthy()
  })

  it("says so when the invoice does not exist", async () => {
    const { client } = scriptedClient({ "invoices.detail": new ContractError("NOT_FOUND", "invoice not found") })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_gone" })
    expect(await screen.findByText("No invoice with the id inv_gone.")).toBeTruthy()
  })

  it("says the same for an id the store has never seen", async () => {
    const { client } = scriptedClient({ "invoices.detail": new ContractError("NOT_FOUND", "ledger: invoice not found") })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_gone" })
    expect(await screen.findByText("No invoice with the id inv_gone.")).toBeTruthy()
  })

  it("shows the no-app refusal as an error, not as a missing invoice", async () => {
    renderWithNavigation(LedgerInvoiceDetailPage, failingClient(new ContractError("PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")), { id: "inv_1" })
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText(/No invoice with the id/)).toBeNull()
  })

  it("says so when the address carries no id", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerInvoiceDetailPage, client, {})
    expect(screen.getByText("No invoice id in the address, so there is nothing to show.")).toBeTruthy()
  })
})
