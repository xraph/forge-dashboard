import { useQuery } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { formatDuration } from "../lib/format"
import type { SettingsConfig } from "../types"

/**
 * Relay's configuration, read-only. It is fixed when Relay starts, so the
 * page says where to change it rather than offering fields that could not.
 */
export function RelaySettingsPage() {
  const query = useQuery<SettingsConfig>("settings.config", {})
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Fixed when Relay starts. Change them in your application's Relay configuration and restart."
      />
      <QueryBoundary title="Settings" query={query} skeletonRows={6}>
        {(c) => (
          <DescriptionList
            items={[
              { term: "Attempts per delivery", value: c.maxRetries },
              {
                term: "Retry schedule",
                value: (
                  <span className="tabular-nums">
                    {(c.retryScheduleMs ?? [])
                      .map(formatDuration)
                      .join(", then ")}
                  </span>
                ),
              },
              {
                term: "Request timeout",
                value: formatDuration(c.requestTimeoutMs),
              },
              { term: "Concurrent deliveries", value: c.concurrency },
              { term: "Batch size", value: c.batchSize },
              {
                term: "Polling",
                value: `every ${formatDuration(c.pollIntervalMs)}, backing off to ${formatDuration(c.maxPollIntervalMs)} when idle`,
              },
              {
                term: "Shutdown grace",
                value: formatDuration(c.shutdownTimeoutMs),
              },
              { term: "Catalog cache", value: formatDuration(c.cacheTtlMs) },
            ]}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
