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
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Fixed when Relay starts. Change them in your application's Relay configuration and restart."
      />
      <QueryBoundary title="Settings" query={query} skeletonRows={6}>
        {(c) => (
          <div className="flex min-w-0 flex-col gap-4">
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
            {c.signature && (
              <section
                aria-labelledby="signature-heading"
                className="flex min-w-0 flex-col gap-3"
              >
                <h2 id="signature-heading" className="text-sm font-medium">
                  How a receiver verifies a delivery
                </h2>
                <p className="max-w-prose text-sm text-muted-foreground">
                  Compute {c.signature.algorithm} of the signed content with the
                  endpoint's secret and compare it with the signature header.
                  Reject a timestamp that is too old, so a captured request
                  cannot be replayed.
                </p>
                <DescriptionList
                  items={[
                    { term: "Algorithm", value: c.signature.algorithm },
                    {
                      term: "Signature header",
                      value: (
                        <code className="font-mono text-xs">
                          {c.signature.header}
                        </code>
                      ),
                    },
                    {
                      term: "Format",
                      value: (
                        <code className="font-mono text-xs">
                          {c.signature.format}
                        </code>
                      ),
                    },
                    {
                      term: "Timestamp header",
                      value: (
                        <code className="font-mono text-xs">
                          {c.signature.timestampHeader}
                        </code>
                      ),
                    },
                    {
                      term: "Signed content",
                      value: (
                        <code className="font-mono text-xs">
                          {c.signature.signedContent}
                        </code>
                      ),
                    },
                  ]}
                />
              </section>
            )}
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}
