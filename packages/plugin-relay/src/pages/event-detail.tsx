import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { JsonView } from "../components/json-view"
import type { DeliverySummary, EventDetail } from "../types"
import { deliveryColumns } from "./deliveries"

export function RelayEventDetailPage({ params }: PluginPageProps) {
  if (!params.id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No event selected.
      </p>
    )
  }
  return <EventDetailView id={params.id} />
}

/** One event, its payload, and the deliveries it fanned out to. */
function EventDetailView({ id }: { id: string }) {
  const query = useQuery<EventDetail>("events.detail", { id })
  return (
    <section className="flex flex-col gap-6">
      <QueryBoundary title="Event" query={query} skeletonRows={6}>
        {(e) => {
          const deliveries = e.deliveries ?? []
          return (
            <>
              <PageHeader
                title={e.type}
                description={`Sent for tenant ${e.tenantId}`}
              />
              <DescriptionList
                items={[
                  {
                    term: "Type",
                    value: (
                      <PluginLink
                        to={`/event-types/${encodeURIComponent(e.type)}`}
                        className="underline underline-offset-4"
                      >
                        {e.type}
                      </PluginLink>
                    ),
                  },
                  {
                    term: "Tenant",
                    value: (
                      <span className="font-mono text-xs">{e.tenantId}</span>
                    ),
                  },
                  {
                    term: "Event ID",
                    value: <span className="font-mono text-xs">{e.id}</span>,
                  },
                  {
                    term: "Idempotency key",
                    value: e.idempotencyKey ? (
                      <span className="font-mono text-xs">
                        {e.idempotencyKey}
                      </span>
                    ) : (
                      <NoneCell label="idempotency key" />
                    ),
                  },
                  {
                    term: "Sent",
                    value: <Timestamp value={e.createdAt} label="sent" />,
                  },
                ]}
              />
              <section
                aria-labelledby="data-heading"
                className="flex flex-col gap-2"
              >
                <h2 id="data-heading" className="text-sm font-medium">
                  Payload
                </h2>
                <JsonView value={e.data} label="payload" />
              </section>
              <section
                aria-labelledby="fanout-heading"
                className="flex flex-col gap-2"
              >
                <h2 id="fanout-heading" className="text-sm font-medium">
                  Deliveries
                </h2>
                <ResourceTable<DeliverySummary>
                  columns={deliveryColumns}
                  rows={deliveries}
                  rowKey={(r) => r.id}
                  caption={`${deliveries.length} ${deliveries.length === 1 ? "delivery" : "deliveries"}`}
                  emptyMessage="No endpoint matched this event, so nothing was sent."
                />
              </section>
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
