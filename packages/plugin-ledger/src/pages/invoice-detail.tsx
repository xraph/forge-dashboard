import { useState, type ReactNode } from "react"
import { ContractError, PluginLink, useCommand, usePluginClient, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { InvoiceStatusBadge } from "../badges"
import { ConfirmAction } from "../components/confirm-action"
import { LedgerTable, type LedgerColumn } from "../components/ledger-table"
import { MoneyText } from "../components/money"
import { isNotFound, NotFoundState } from "../components/not-found"
import { SyncPanel } from "../components/sync-panel"
import { formatPeriod, toRFC3339 } from "../lib/datetime"
import { formatMoney } from "../lib/money"
import { subscriptionPath } from "../lib/paths"
import type { Invoice, InvoiceDetail, InvoiceExport, InvoiceStatus, LineItem, LineItemType } from "../types"

type Transition = "finalize" | "markPaid" | "void"

/**
 * The next steps the page offers from each state.
 *
 * Checked against the engine. Finalize takes a draft only. Mark-paid and void
 * each refuse only a paid or a voided invoice, so pending and past-due take
 * both, and paid and voided are final. The engine would also take a draft
 * straight to paid or voided. Void is offered on a draft, since a draft nobody
 * wants should be discardable. Mark-paid is not: it would skip finalize, which
 * is what sets the due date, so a draft is finalized first. The page renders
 * only these, so no button promises a refusal.
 */
export function invoiceTransitions(status: InvoiceStatus): Transition[] {
  switch (status) {
    case "draft":
      return ["finalize", "void"]
    case "pending":
    case "past_due":
      return ["markPaid", "void"]
    default:
      return []
  }
}

/** Line items read as sections, in the order the engine builds a bill. */
export const LINE_GROUPS: { type: LineItemType; label: string; noun: string }[] = [
  { type: "base", label: "Base", noun: "base" },
  { type: "seat", label: "Seats", noun: "seat" },
  { type: "usage", label: "Usage", noun: "usage" },
  { type: "overage", label: "Overage", noun: "overage" },
  { type: "discount", label: "Discounts", noun: "discount" },
  { type: "tax", label: "Tax", noun: "tax" },
]

/**
 * The groups to render: the six known types in order, then one "Other" group
 * for any line whose type is not among them. The engine writes only the six,
 * but a row stored by an SDK caller or an older import can carry another type
 * or none, and such a line counts toward the subtotal. Dropping it would leave
 * a total no visible line explains.
 */
export function lineGroups(lines: LineItem[]): { key: string; label: string; noun: string; rows: LineItem[] }[] {
  const known = new Set<string>(LINE_GROUPS.map((g) => g.type))
  const groups = LINE_GROUPS.map((g) => ({ key: g.type as string, label: g.label, noun: g.noun, rows: lines.filter((l) => l.type === g.type) }))
  groups.push({ key: "other", label: "Other", noun: "other", rows: lines.filter((l) => !known.has(l.type)) })
  return groups.filter((g) => g.rows.length > 0)
}

const number = new Intl.NumberFormat()

/**
 * The engine prices seats and overage from a tier ladder and records a zero
 * unit amount for them, because a ladder has no single per-unit price. Only
 * the line's amount means anything, so a zero there reads as none, not as a
 * free unit.
 */
function hasNoUnitPrice(line: LineItem): boolean {
  return (line.type === "seat" || line.type === "overage") && line.unit_amount.amount === 0
}

const lineColumns: LedgerColumn<LineItem>[] = [
  { id: "description", header: "Description", className: "font-medium", cell: (l) => l.description },
  { id: "feature", header: "Feature", className: "font-mono text-xs", cell: (l) => l.feature_key || <NoneCell label="feature" /> },
  { id: "quantity", header: "Quantity", align: "end", className: "tabular-nums", cell: (l) => number.format(l.quantity) },
  {
    id: "unit",
    header: "Unit price",
    align: "end",
    cell: (l) => (hasNoUnitPrice(l) ? <NoneCell label="unit price" /> : <MoneyText value={l.unit_amount} />),
  },
  { id: "amount", header: "Amount", align: "end", cell: (l) => <MoneyText value={l.amount} /> },
]

export function LedgerInvoiceDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No invoice id in the address, so there is nothing to show.
      </p>
    )
  }
  // Keyed by id, so moving between invoices in place starts with fresh dialog state.
  return <InvoiceDetailBody key={id} id={id} />
}

function InvoiceDetailBody({ id }: { id: string }) {
  const detail = useQuery<InvoiceDetail>("invoices.detail", { id })
  // Once there is data the page stays up through a refresh: a write
  // invalidates invoices.detail, and QueryBoundary would otherwise swap the
  // page for a skeleton and take any open dialog with it.
  if (detail.data !== undefined) return <InvoiceDetailView detail={detail.data} />
  if (isNotFound(detail.error, "invoice")) return <NotFoundState noun="invoice" id={id} backTo="/invoices" backLabel="Back to invoices" />
  return (
    <QueryBoundary title="Invoice" query={detail} skeletonRows={6}>
      {(d) => <InvoiceDetailView detail={d} />}
    </QueryBoundary>
  )
}

/**
 * The totals as a receipt: one narrow column, figures right-aligned in
 * tabular numerals so the decimals line up, the discount shown as the
 * subtraction it is, and the total set apart by a rule and weight.
 *
 * Every figure is the engine's own and nothing here adds them up. The engine
 * clamps the amount before tax at zero when the discount is larger than the
 * subtotal, so the total is then not subtotal minus discount plus tax, and the
 * receipt says so rather than leave a column that does not add up.
 */
function Receipt({ invoice }: { invoice: Invoice }) {
  const row = (term: string, value: ReactNode, strong = false) => (
    <div className={cn("contents", strong && "font-medium")}>
      <dt className={cn("py-1", strong ? "border-t pt-2 text-base" : "text-muted-foreground")}>{term}</dt>
      <dd className={cn("py-1 text-right tabular-nums", strong && "border-t pt-2 text-base")}>{value}</dd>
    </div>
  )
  const discounted = invoice.discount_amount.amount > 0
  const clamped = invoice.subtotal.amount - invoice.discount_amount.amount < 0
  return (
    <section aria-label="Totals" className="flex max-w-sm flex-col gap-2">
      <dl className="grid grid-cols-[1fr_auto] gap-x-8 text-sm">
        {row("Subtotal", <MoneyText value={invoice.subtotal} />)}
        {row("Discount", <span className="tabular-nums">{discounted ? "−" : ""}{formatMoney(invoice.discount_amount)}</span>)}
        {row("Tax", <MoneyText value={invoice.tax_amount} />)}
        {row("Total", <MoneyText value={invoice.total} />, true)}
      </dl>
      {clamped && (
        <p className="text-xs text-muted-foreground">
          The discount is more than the subtotal, so the amount before tax cannot go below zero and the total is tax alone.
        </p>
      )}
    </section>
  )
}

const STEPS: { key: string; label: string; reached: InvoiceStatus[] }[] = [
  { key: "draft", label: "Draft", reached: ["draft", "pending", "past_due", "paid"] },
  { key: "pending", label: "Pending", reached: ["pending", "past_due", "paid"] },
  { key: "paid", label: "Paid", reached: ["paid"] },
]

/** Draft, pending, paid, with the current step marked and a voided invoice said plainly. */
function InvoiceProgress({ status }: { status: InvoiceStatus }) {
  if (status === "voided") {
    return <p className="text-sm text-muted-foreground">Voided. It will not be collected and cannot change again.</p>
  }
  const current = status === "draft" ? "draft" : status === "paid" ? "paid" : "pending"
  return (
    <ol aria-label="Invoice progress" className="flex flex-col gap-1 text-sm">
      {STEPS.map((step) => {
        const reached = step.reached.includes(status)
        const label = step.key === "pending" && status === "past_due" ? "Past due" : step.label
        return (
          <li key={step.key} aria-current={step.key === current ? "step" : undefined} className={cn("flex items-center gap-2", !reached && "text-muted-foreground")}>
            <span aria-hidden="true" className={cn("size-2 rounded-full", reached ? "bg-primary" : "bg-muted")} />
            {label}
            <span className="sr-only">{reached ? " (done)" : " (not yet)"}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** What the export's bytes are, by the format name the engine echoes back. */
const MIME: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  pdf: "application/pdf",
}

/**
 * Decodes the contract's base64 export and hands it to the browser as a file.
 * `content` is a Go []byte, so it arrives base64 and may be binary (a PDF).
 */
function download(file: InvoiceExport) {
  const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[file.format] ?? "application/octet-stream" }))
  const a = document.createElement("a")
  a.href = url
  a.download = file.filename
  a.click()
  // Not at once: some browsers start the save after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function InvoiceDetailView({ detail }: { detail: InvoiceDetail }) {
  const { invoice, subscription } = detail
  const client = usePluginClient()
  const finalize = useCommand<Invoice>("invoices.finalize")
  const markPaid = useCommand<Invoice>("invoices.markPaid")
  const voidIt = useCommand<Invoice>("invoices.void")
  const [dialog, setDialog] = useState<Transition | null>(null)
  const [paymentRef, setPaymentRef] = useState("")
  const [paidAt, setPaidAt] = useState("")
  const [reason, setReason] = useState("")
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState<{ code: string; message: string } | undefined>()
  const transitions = invoiceTransitions(invoice.status)
  const lines = invoice.line_items ?? []
  const formats = detail.export_formats ?? []

  function openDialog(which: Transition) {
    // Reset at open, and clear what the dialog collects, so nothing from an
    // earlier attempt is shown against this one.
    ;({ finalize, markPaid, void: voidIt })[which].reset()
    setPaymentRef("")
    setPaidAt("")
    setReason("")
    setDialog(which)
  }

  // An export is a query, but one that runs only when asked, so it goes
  // through the client directly rather than useQuery, which reads on mount.
  async function exportAs(format: string) {
    setExporting(format)
    setExportError(undefined)
    try {
      download(await client.query<InvoiceExport>("invoices.export", { id: invoice.id, format }))
    } catch (err) {
      // Not every failure is a ContractError: atob throws a plain Error on bad base64.
      setExportError(err instanceof ContractError ? err : { code: "CLIENT", message: String(err) })
    } finally {
      setExporting(null)
    }
  }

  // The engine trims the reference and reads an absent paid_at as now.
  const markPaidPayload: Record<string, unknown> = { id: invoice.id, payment_ref: paymentRef.trim() }
  const paidAtIso = toRFC3339(paidAt)
  if (paidAtIso) markPaidPayload.paid_at = paidAtIso
  const close = (o: boolean) => !o && setDialog(null)

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={`Invoice ${invoice.id}`} description={`${invoice.tenant_id}, ${formatPeriod(invoice.period_start, invoice.period_end)}`} />
      <DetailLayout
        main={
          <>
            <Receipt invoice={invoice} />
            {lineGroups(lines).map((g) => (
              <section key={g.key} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">{g.label}</h2>
                <LedgerTable<LineItem>
                  columns={lineColumns}
                  rows={g.rows}
                  rowKey={(l) => l.id}
                  caption={`${g.rows.length} ${g.noun} ${g.rows.length === 1 ? "line" : "lines"}`}
                  emptyMessage="No lines."
                />
              </section>
            ))}
            {lines.length === 0 && <p className="text-sm text-muted-foreground">This invoice has no line items.</p>}
          </>
        }
        aside={
          <>
            <section className="flex flex-col gap-3" aria-label="Status">
              <h2 className="text-sm font-medium">Status</h2>
              <InvoiceProgress status={invoice.status} />
              {transitions.length > 0 && (
                <div className="flex gap-2">
                  {transitions.includes("finalize") && <Button onClick={() => openDialog("finalize")}>Finalize</Button>}
                  {transitions.includes("markPaid") && <Button onClick={() => openDialog("markPaid")}>Mark paid</Button>}
                  {transitions.includes("void") && (
                    <Button variant="outline" onClick={() => openDialog("void")}>
                      Void
                    </Button>
                  )}
                </div>
              )}
            </section>
            <DescriptionList
              items={[
                { term: "Status", value: <InvoiceStatusBadge status={invoice.status} /> },
                {
                  term: "Subscription",
                  value: (
                    <PluginLink to={subscriptionPath(subscription.id)} className="font-mono text-xs">
                      {subscription.id}
                    </PluginLink>
                  ),
                },
                { term: "Tenant", value: <span className="font-mono text-xs">{invoice.tenant_id}</span> },
                { term: "Period", value: formatPeriod(invoice.period_start, invoice.period_end) },
                { term: "Due", value: <Timestamp value={invoice.due_date} label="due date" /> },
                { term: "Paid", value: <Timestamp value={invoice.paid_at} label="payment" /> },
                { term: "Payment reference", value: invoice.payment_ref ? <span className="font-mono text-xs">{invoice.payment_ref}</span> : <NoneCell label="payment reference" /> },
                ...(invoice.status === "voided"
                  ? [
                      { term: "Voided", value: <Timestamp value={invoice.voided_at} label="void time" /> },
                      { term: "Reason", value: invoice.void_reason || <NoneCell label="reason" /> },
                    ]
                  : []),
              ]}
            />
            <section className="flex flex-col gap-2" aria-label="Export">
              <h2 className="text-sm font-medium">Export</h2>
              {formats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoice formatter is registered.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {formats.map((f) => (
                    <Button key={f} variant="outline" size="sm" disabled={exporting !== null} onClick={() => void exportAs(f)}>
                      {exporting === f ? "Preparing…" : `Download ${f.toUpperCase()}`}
                    </Button>
                  ))}
                </div>
              )}
              <CommandAlert error={exportError} title="Could not export" />
            </section>
            <SyncPanel intent="invoices.syncToProvider" id={invoice.id} providerName={invoice.provider_name} providerId={invoice.provider_id} />
          </>
        }
      />

      <ConfirmAction
        open={dialog === "finalize"}
        onOpenChange={close}
        title="Finalize this invoice?"
        description="It stops being a draft and becomes pending, due in 30 days from now."
        confirmLabel="Finalize invoice"
        command={finalize}
        payload={{ id: invoice.id }}
        onDone={() => setDialog(null)}
      />
      <ConfirmAction
        open={dialog === "markPaid"}
        onOpenChange={close}
        title={`Mark ${formatMoney(invoice.total)} as paid?`}
        confirmLabel="Mark as paid"
        command={markPaid}
        payload={markPaidPayload}
        onDone={() => setDialog(null)}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paid-ref">Payment reference</Label>
          <Input id="paid-ref" className="font-mono" autoComplete="off" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paid-at">Paid at</Label>
          <Input id="paid-at" type="datetime-local" aria-describedby="paid-at-help" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <p id="paid-at-help" className="text-xs/relaxed text-muted-foreground">
          Leave the time empty for now.
        </p>
      </ConfirmAction>
      <ConfirmAction
        open={dialog === "void"}
        onOpenChange={close}
        title="Void this invoice?"
        description="It will not be collected. A new invoice can then be generated for the same period."
        confirmLabel="Void invoice"
        destructive
        command={voidIt}
        payload={{ id: invoice.id, reason: reason.trim() }}
        confirmDisabled={reason.trim() === ""}
        onDone={() => setDialog(null)}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmAction>
    </section>
  )
}

export default LedgerInvoiceDetailPage
