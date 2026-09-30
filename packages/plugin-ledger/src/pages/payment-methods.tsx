import { useState } from "react"
import type { FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import type { PaymentMethod, PaymentMethods } from "../types"

const columns: Column<PaymentMethod>[] = [
  {
    id: "brand",
    header: "Method",
    className: "font-medium",
    cell: (m) => (m.brand ? `${m.brand.charAt(0).toUpperCase()}${m.brand.slice(1)}` : m.type.replace("_", " ")),
  },
  { id: "last4", header: "Last 4", className: "font-mono text-xs", cell: (m) => m.last4 },
  {
    id: "expiry",
    header: "Expires",
    className: "tabular-nums",
    cell: (m) => (m.expiry_year > 0 ? `${String(m.expiry_month).padStart(2, "0")}/${m.expiry_year}` : <NoneCell label="expiry" />),
  },
  // Most tenants hold one method, the default, so default is the majority and
  // could recede; it is kept secondary because it is the one a person looks
  // for, and "not default" is left as a none rather than a second badge.
  { id: "default", header: "Default", cell: (m) => (m.is_default ? <Badge variant="secondary">Default</Badge> : <NoneCell label="default" />) },
  { id: "provider", header: "Provider ID", className: "font-mono text-xs", cell: (m) => m.provider_id },
]

function Methods({ tenant }: { tenant: string }) {
  const methods = useQuery<PaymentMethods>("paymentMethods.list", { tenant_id: tenant })

  if (methods.error?.code === "NOT_FOUND" && methods.error.message === "tenant not found") {
    return (
      <EmptyState
        title={`${tenant} has no subscription in this app, so there are no payment methods to show.`}
        description="Payment methods are looked up only for tenants subscribed here."
      />
    )
  }

  return (
    <QueryBoundary title="Payment methods" query={methods} skeletonRows={3}>
      {(data) => {
        if (!data.configured) {
          return <EmptyState title="No payment provider is configured." description="Register one with the ledger extension to see stored methods." />
        }
        const rows = data.methods ?? []
        return (
          <ResourceTable<PaymentMethod>
            columns={columns}
            rows={rows}
            rowKey={(m) => m.id}
            caption={`${rows.length} payment ${rows.length === 1 ? "method" : "methods"} for ${tenant}`}
            emptyMessage={`${tenant} has no payment methods on file.`}
          />
        )
      }}
    </QueryBoundary>
  )
}

/**
 * Payment methods for one tenant. The provider keys methods by tenant alone,
 * so the contract answers only for a tenant subscribed in this app; the page
 * reads nothing until a tenant is named.
 */
export function LedgerPaymentMethodsPage() {
  const [draft, setDraft] = useState("")
  const [tenant, setTenant] = useState("")

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = draft.trim()
    if (next !== "") setTenant(next)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Payment methods" description="The cards and accounts a payment provider holds for a tenant." />
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pm-tenant">Tenant ID</Label>
          <Input id="pm-tenant" className="w-64 font-mono" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Button type="submit" disabled={draft.trim() === ""}>
          Look up
        </Button>
      </form>
      <div aria-live="polite">{tenant !== "" && <Methods key={tenant} tenant={tenant} />}</div>
    </section>
  )
}
