import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
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
    <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="recent-heading" className="text-sm font-medium">
          Recent deliveries
        </h2>
        <PluginLink
          to="/deliveries"
          className="text-sm underline underline-offset-4"
        >
          Delivery log
        </PluginLink>
      </div>
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
    </section>
  )
}
