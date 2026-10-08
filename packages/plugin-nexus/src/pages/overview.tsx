import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Money } from "../components/money"
import {
  count,
  Metrics,
  Notice,
  OutcomeTable,
  PostureStrip,
  Refresh,
  Section,
  UsageOff,
} from "../components/read"
import type { Overview } from "../types"

export function OverviewPage() {
  const query = useQuery<Overview>("overview.get")
  return (
    <div className="space-y-3">
      <PageHeader
        title="Nexus"
        description="Gateway access, customers and exact spend."
        actions={<Refresh onClick={query.refetch} />}
      />
      <QueryBoundary title="Nexus overview" query={query}>
        {(data) => (
          <>
            <PostureStrip value={data.posture} />
            {!data.posture.requireApiKey && (
              <Notice>
                HTTP api and proxy routes accept requests without a key. A
                supplied valid key still attributes the request to its tenant.
              </Notice>
            )}
            {!data.posture.usageEnabled && <UsageOff />}
            {data.insertErrors > 0 && (
              <Notice>
                {count(data.insertErrors)} usage records failed to store since
                startup. Spend and request history may be incomplete.
              </Notice>
            )}
            {data.limiterErrors > 0 && (
              <Notice>
                {count(data.limiterErrors)} limiter failures allowed requests
                through since startup.
              </Notice>
            )}
            <Metrics
              items={[
                {
                  label: "Month spend",
                  value: <Money value={data.monthSpendUsd} />,
                  hint:
                    data.unpricedRequests === null
                      ? "Collection unavailable"
                      : `${count(data.unpricedRequests)} unpriced requests excluded`,
                },
                {
                  label: "Requests today",
                  value: count(data.requestsToday),
                  hint: "UTC day, refusals excluded",
                },
                {
                  label: "Active keys",
                  value: count(data.activeKeys),
                  hint: "Revoked and expired keys excluded",
                },
                {
                  label: "Tenants",
                  value: count(data.tenants.total),
                  hint: `${data.tenants.active} active · ${data.tenants.disabled} disabled · ${data.tenants.suspended} suspended`,
                },
              ]}
            />
            {data.byOutcome && (
              <Section
                title={`Request outcomes · ${data.outcomePeriod}`}
                action={
                  <PluginLink to="/usage/records">View request log</PluginLink>
                }
              >
                <OutcomeTable value={data.byOutcome} />
              </Section>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              <PluginLink to="/gateway">Inspect gateway</PluginLink>
              <PluginLink to="/tenants">Manage tenants</PluginLink>
              <PluginLink to="/keys">Review API keys</PluginLink>
              <PluginLink to="/usage">Explore usage</PluginLink>
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
