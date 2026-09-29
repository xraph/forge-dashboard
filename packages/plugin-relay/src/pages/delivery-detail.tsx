import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { DeliveryStateBadge } from "../components/delivery-state"
import { RetryTimeline } from "../components/retry-timeline"
import { describeStatus } from "../lib/format"
import type { DeliveryDetail } from "../types"

/**
 * One delivery. The retry sequence is the page: when a webhook did not
 * arrive, the question is what happened on each attempt, how long Relay
 * waited between them, and why it stopped.
 */
export function RelayDeliveryDetailPage({ params }: PluginPageProps) {
  if (!params.id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No delivery selected.
      </p>
    )
  }
  return <DeliveryDetailView id={params.id} />
}

function DeliveryDetailView({ id }: { id: string }) {
  const query = useQuery<DeliveryDetail>("deliveries.detail", { id })
  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Delivery" query={query} skeletonRows={6}>
        {(d) => (
          <>
            <PageHeader
              title={d.eventType}
              description={
                d.endpointUrl
                  ? `To ${d.endpointUrl}`
                  : "To an endpoint that has since been deleted"
              }
            />
            <DetailLayout
              main={
                <section
                  aria-labelledby="retry-heading"
                  className="flex flex-col gap-4"
                >
                  <h2 id="retry-heading" className="text-sm font-medium">
                    Retry sequence
                  </h2>
                  <RetryTimeline
                    attempts={d.attempts ?? []}
                    state={d.state}
                    maxAttempts={d.maxAttempts}
                    nextAttemptAt={d.nextAttemptAt}
                    endpointEnabled={d.endpointEnabled}
                  />
                </section>
              }
              aside={
                <DescriptionList
                  items={[
                    {
                      term: "State",
                      value: (
                        <DeliveryStateBadge
                          state={d.state}
                          attemptCount={d.attemptCount}
                        />
                      ),
                    },
                    {
                      term: "Last response",
                      value:
                        d.attemptCount === 0 ? (
                          <NoneCell label="response yet" />
                        ) : (
                          describeStatus(d.lastStatusCode)
                        ),
                    },
                    {
                      term: "Attempts",
                      value: (
                        <span className="tabular-nums">
                          {d.attemptCount} of {d.maxAttempts}
                        </span>
                      ),
                    },
                    {
                      term: "Endpoint",
                      value: d.endpointUrl ? (
                        <PluginLink
                          to={`/endpoints/${d.endpointId}`}
                          className="break-all underline underline-offset-4"
                        >
                          {d.endpointUrl}
                        </PluginLink>
                      ) : (
                        <NoneCell label="endpoint (deleted)" />
                      ),
                    },
                    {
                      term: "Event",
                      value: (
                        <PluginLink
                          to={`/events/${d.eventId}`}
                          className="font-mono text-xs underline underline-offset-4"
                        >
                          {d.eventId}
                        </PluginLink>
                      ),
                    },
                    {
                      term: "Tenant",
                      value: (
                        <span className="font-mono text-xs">{d.tenantId}</span>
                      ),
                    },
                    {
                      term: "Delivery ID",
                      value: <span className="font-mono text-xs">{d.id}</span>,
                    },
                    {
                      term: "Created",
                      value: <Timestamp value={d.createdAt} label="created" />,
                    },
                    {
                      term: "Finished",
                      value: (
                        <Timestamp value={d.completedAt} label="finish time" />
                      ),
                    },
                  ]}
                />
              }
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
