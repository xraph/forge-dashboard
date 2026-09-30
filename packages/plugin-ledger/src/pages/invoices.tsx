import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { INVOICE_STATUS_OPTIONS } from "../badges"
import { invoiceColumns } from "../components/invoice-columns"
import { ImportFromProviderAction } from "../components/import-from-provider"
import { BackToFirstPage, OffsetPager } from "../components/offset-pager"
import { listEmptyMessage, pageCaption, pageParams } from "../lib/paging"
import { invoicePath } from "../lib/paths"
import type { Invoice, InvoiceDetail, Page } from "../types"

const columns = invoiceColumns({ withStatus: true })

/**
 * invoices.list takes a tenant, a status and a period window, and pages with
 * no total. There is no subscription filter: a subscription's own invoices are
 * on its page.
 */
export function LedgerInvoicesPage() {
  const [page, setPage] = useState(1)
  const [tenant, setTenant] = useState("")
  const [status, setStatus] = useState("")
  const tenantId = tenant.trim()
  const list = useQuery<Page<Invoice>>("invoices.list", { ...pageParams(page), tenant_id: tenantId || undefined, status: status || undefined })
  const statusLabel = INVOICE_STATUS_OPTIONS.find((s) => s.value === status)?.label.toLowerCase()
  const emptyMessage =
    page === 1 && tenantId ? `No ${statusLabel ? `${statusLabel} ` : ""}invoices for ${tenantId}.` : listEmptyMessage("invoices", page, statusLabel)

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Invoices"
        description="Newest first. Generate one from a subscription's page."
        actions={
          <ImportFromProviderAction<InvoiceDetail>
            intent="invoices.importFromProvider"
            noun="invoice"
            description="Copies one invoice from the payment provider into this app. Its subscription must already be here, so import that first if it isn't. A second live invoice for the same subscription and period is refused."
            pathOf={(d) => invoicePath(d.invoice.id)}
          />
        }
      />
      <FilterBar
        search={{
          value: tenant,
          onChange: (next) => {
            setTenant(next)
            setPage(1)
          },
          placeholder: "Exact tenant ID",
          label: "Tenant ID",
        }}
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            options: [{ label: "All", value: "" }, ...INVOICE_STATUS_OPTIONS],
            onChange: (next) => {
              setStatus(next)
              setPage(1)
            },
          },
        ]}
      />
      <QueryBoundary title="Invoices" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<Invoice>
                columns={columns}
                rows={rows}
                rowKey={(i) => i.id}
                caption={pageCaption({ page, shown: rows.length, hasMore: data.has_more, singular: "invoice", plural: "invoices" })}
                emptyMessage={emptyMessage}
                emptyAction={page > 1 ? <BackToFirstPage onClick={() => setPage(1)} /> : undefined}
              />
              <OffsetPager page={page} hasMore={data.has_more} onPageChange={setPage} />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
