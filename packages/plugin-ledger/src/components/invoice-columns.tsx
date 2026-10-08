import { PluginLink } from "@forge-go/dashboard-plugin"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { InvoiceStatusBadge } from "../badges"
import { formatPeriod } from "../lib/datetime"
import { invoicePath } from "../lib/paths"
import type { Invoice } from "../types"
import { MoneyText } from "./money"

/**
 * The columns every invoice table uses. The total is the column an operator
 * reads, so it carries the weight, right-aligned in tabular figures.
 */
export function invoiceColumns({
  withStatus,
}: {
  withStatus: boolean
}): Column<Invoice>[] {
  const columns: Column<Invoice>[] = [
    {
      id: "id",
      header: "Invoice",
      className: "font-mono text-xs",
      cell: (i) => <PluginLink to={invoicePath(i.id)}>{i.id}</PluginLink>,
    },
    {
      id: "tenant",
      header: "Tenant",
      className: "font-mono text-xs",
      cell: (i) => i.tenant_id,
    },
    {
      id: "period",
      header: "Period",
      cell: (i) => formatPeriod(i.period_start, i.period_end),
    },
  ]
  if (withStatus)
    columns.push({
      id: "status",
      header: "Status",
      cell: (i) => <InvoiceStatusBadge status={i.status} />,
    })
  columns.push(
    {
      id: "due",
      header: "Due",
      cell: (i) => <Timestamp value={i.due_date} label="due date" />,
    },
    {
      id: "total",
      header: "Total",
      align: "end",
      className: "font-medium",
      cell: (i) => <MoneyText value={i.total} />,
    }
  )
  return columns
}
