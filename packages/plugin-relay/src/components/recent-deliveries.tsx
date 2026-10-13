import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { deliveryColumns } from "../pages/deliveries"
import type { DeliveriesPage, DeliverySummary } from "../types"

// Every column but the endpoint's own URL, which this whole page is about.
const columns = deliveryColumns.filter((c) => c.id !== "endpoint")

/** An endpoint's latest deliveries, as the templ endpoint page showed them. */
export function RecentDeliveries({ endpointId }: { endpointId: string }) {
  const query = useQuery<DeliveriesPage>("deliveries.list", {
    endpointId,
    limit: 20,
  })
  return (
    <Section
      title="Recent deliveries"
      actions={
        <PluginLink
          to="/deliveries"
          className="text-sm underline underline-offset-4"
        >
          Delivery log
        </PluginLink>
      }
    >
      <QueryBoundary title="Recent deliveries" query={query} skeletonRows={3}>
        {(data) => {
          const rows = data.deliveries ?? []
          return (
            <ResourceTable<DeliverySummary>
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              caption={`${rows.length} most recent`}
              emptyMessage="Nothing has been sent to this endpoint yet."
            />
          )
        }}
      </QueryBoundary>
    </Section>
  )
}
