import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { invoiceColumns } from "../components/invoice-columns"
import type { Invoice, OverviewStats } from "../types"

const RECENT = 10

const invoices = (n: number) => `${n} ${n === 1 ? "invoice" : "invoices"}`

/**
 * Billing at a glance: counts, what is waiting to be paid, and what was
 * issued last. Nothing here is a chart: each figure is one number, and a
 * number is its own best picture.
 */
export function LedgerOverviewPage() {
  const stats = useQuery<OverviewStats>("overview.stats")
  const pending = useQuery<Invoice[]>("invoices.pending")
  const recent = useQuery<Invoice[]>("overview.recentInvoices", { limit: RECENT })

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Billing" description="Plans, subscriptions and invoices for this app." />

      <QueryBoundary title="Billing counts" query={stats} skeletonRows={1}>
        {(s) => {
          const by = s.subscriptions_by_status
          const live = (by.active ?? 0) + (by.trialing ?? 0)
          // The store counts by scanning at most 5,000 rows per kind. When a
          // scan hit that bound the number is a floor, and says so.
          const n = (value: number) => (s.capped ? `${value}+` : value)
          return (
            <div className="flex flex-col gap-2">
              <StatGrid
                items={[
                  { label: "Plans", value: n(s.plans), hint: `${s.active_plans} active` },
                  { label: "Live subscriptions", value: n(live), hint: `${by.trialing ?? 0} trialing` },
                  { label: "Subscriptions past due", value: n(by.past_due ?? 0) },
                  { label: "Awaiting payment", value: n(s.pending_invoices), hint: "invoices" },
                  { label: "Coupons", value: n(s.coupons) },
                ]}
              />
              {s.capped && (
                <p className="text-sm text-muted-foreground">
                  Each count stops at 5,000 rows, and at least one reached it, so the real numbers are at least these.
                </p>
              )}
            </div>
          )
        }}
      </QueryBoundary>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Awaiting payment</h2>
        <QueryBoundary title="Invoices awaiting payment" query={pending} skeletonRows={3}>
          {(rows) => (
            <ResourceTable<Invoice>
              columns={invoiceColumns({ withStatus: false })}
              rows={rows ?? []}
              rowKey={(i) => i.id}
              caption={`${invoices((rows ?? []).length)} awaiting payment`}
              emptyMessage="Nothing is awaiting payment."
            />
          )}
        </QueryBoundary>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Recent invoices</h2>
        <QueryBoundary title="Recent invoices" query={recent} skeletonRows={5}>
          {(rows) => (
            <ResourceTable<Invoice>
              columns={invoiceColumns({ withStatus: true })}
              rows={rows ?? []}
              rowKey={(i) => i.id}
              caption={`${(rows ?? []).length} recent ${(rows ?? []).length === 1 ? "invoice" : "invoices"}`}
              emptyMessage="No invoices have been issued yet."
            />
          )}
        </QueryBoundary>
      </section>
    </section>
  )
}
