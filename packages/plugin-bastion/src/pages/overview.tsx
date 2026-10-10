import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatCount, formatMs, formatPercent, formatUptime } from "../format"
import { routePath } from "../keys"
import type { OverviewStats, TopRoute } from "../types"

const NOT_MEASURED = "Not measured"

const topColumns: Column<TopRoute>[] = [
  {
    id: "path",
    header: "Path",
    className: "font-mono text-xs font-medium",
    cell: (r) => <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>,
  },
  {
    id: "requests",
    header: "Requests",
    align: "end",
    cell: (r) => formatCount(r.totalRequests),
  },
  {
    id: "errors",
    header: "Errors",
    align: "end",
    cell: (r) => formatCount(r.totalErrors),
  },
]

function items(s: OverviewStats) {
  const latency = formatMs(s.avgLatencyMs)
  return [
    {
      label: "Requests",
      value: formatCount(s.totalRequests),
      hint: `${formatCount(s.totalErrors)} errors`,
    },
    s.errorRate == null
      ? { label: "Error rate", value: NOT_MEASURED, hint: "No requests yet" }
      : {
          label: "Error rate",
          value: formatPercent(s.errorRate) ?? NOT_MEASURED,
        },
    latency == null
      ? {
          label: "Latency",
          value: NOT_MEASURED,
          hint: "No upstream has answered yet",
        }
      : {
          label: "Latency",
          value: latency,
          hint: `p99 ${formatMs(s.p99LatencyMs)} over the last ${formatCount(s.latencySamples)} responses`,
        },
    {
      label: "Upstreams",
      value: `${s.healthyUpstreams} of ${s.totalUpstreams}`,
      hint: "healthy",
    },
    s.circuitBreakerEnabled
      ? {
          label: "Open circuits",
          value: s.openCircuits,
          hint: `${s.halfOpenCircuits} half-open`,
        }
      : {
          label: "Open circuits",
          value: "Off",
          hint: "Circuit breaking is disabled",
        },
    s.cacheHitRate == null
      ? {
          label: "Cache hit rate",
          value: NOT_MEASURED,
          hint: "No cache lookups",
        }
      : {
          label: "Cache hit rate",
          value: formatPercent(s.cacheHitRate) ?? NOT_MEASURED,
          hint: `${formatCount(s.cacheLookups)} lookups`,
        },
    {
      label: "Routes",
      value: `${s.enabledRoutes} of ${s.totalRoutes}`,
      hint: "enabled",
    },
    {
      label: "Uptime",
      value:
        s.startedAt == null ? "Not started" : formatUptime(s.uptimeSeconds),
    },
  ]
}

export const BastionOverviewPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<OverviewStats>("overview.stats")
  usePoll(query.refetch)

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Gateway"
        description="Traffic, upstream health and circuit state for this gateway process."
      />
      <QueryBoundary title="Gateway overview" query={query} skeletonRows={4}>
        {(s) => (
          <>
            <StatGrid items={items(s)} />
            <section
              aria-labelledby="busiest-heading"
              className="flex min-w-0 flex-col gap-2"
            >
              <h2 id="busiest-heading" className="text-sm font-medium">
                Busiest routes
              </h2>
              <ResourceTable<TopRoute>
                columns={topColumns}
                rows={s.topRoutes}
                rowKey={(r) => r.routeId}
                caption={`${s.topRoutes.length} ${s.topRoutes.length === 1 ? "route" : "routes"}`}
                emptyMessage="No route has served traffic yet."
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
