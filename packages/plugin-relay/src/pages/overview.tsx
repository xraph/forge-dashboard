import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import type { DeliveriesPage, DeliverySummary, OverviewStats } from "../types"
import { deliveryColumns } from "./deliveries"

/**
 * Where Relay stands: the four counters the templ overview had, and the
 * latest failures, since those are what someone opening this page is after.
 */
export function RelayOverviewPage() {
  const stats = useQuery<OverviewStats>("overview.stats", {})
  const failures = useQuery<DeliveriesPage>("deliveries.list", {
    state: "failed",
    limit: 5,
  })
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Relay"
        description="Webhook delivery: what is waiting, what failed, and where it goes."
      />
      <QueryBoundary title="Counters" query={stats} skeletonRows={1}>
        {(s) => (
          <StatGrid
            items={[
              { label: "Event types", value: s.eventTypes, hint: "Active" },
              { label: "Endpoints", value: s.endpoints },
              {
                label: "Pending",
                value: s.pending,
                hint: "Queued or retrying",
              },
              { label: "Dead letters", value: s.deadLetters, hint: "Gave up" },
            ]}
          />
        )}
      </QueryBoundary>
      <section
        aria-labelledby="failures-heading"
        className="flex flex-col gap-2"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="failures-heading" className="text-sm font-medium">
            Latest failures
          </h2>
          <PluginLink
            to="/dlq"
            className="text-sm underline underline-offset-4"
          >
            Dead letter queue
          </PluginLink>
        </div>
        <QueryBoundary
          title="Latest failures"
          query={failures}
          skeletonRows={3}
        >
          {(data) => {
            const rows = data.deliveries ?? []
            return (
              <ResourceTable<DeliverySummary>
                columns={deliveryColumns}
                rows={rows}
                rowKey={(r) => r.id}
                caption={`${rows.length} most recent`}
                emptyMessage="No failed deliveries."
              />
            )
          }}
        </QueryBoundary>
      </section>
    </section>
  )
}
