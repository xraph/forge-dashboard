import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatCount, formatMs, formatPercent } from "../format"
import { routePath } from "../keys"
import type { RouteTraffic, TrafficStats } from "../types"

const NOT_MEASURED = "Not measured"

const ms = (v: number | null) => formatMs(v) ?? <NoneCell label="latency" />

const columns: Column<RouteTraffic>[] = [
  {
    id: "path",
    header: "Path",
    className: "font-mono text-xs font-medium",
    cell: (r) => <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>,
  },
  { id: "requests", header: "Requests", align: "end", cell: (r) => formatCount(r.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (r) => formatCount(r.totalErrors) },
  {
    id: "errorRate",
    header: "Error rate",
    align: "end",
    cell: (r) => formatPercent(r.errorRate) ?? <NoneCell label="error rate" />,
  },
  { id: "avg", header: "Avg latency", align: "end", cell: (r) => ms(r.avgLatencyMs) },
  { id: "p99", header: "p99", align: "end", cell: (r) => ms(r.p99LatencyMs) },
]

function items(s: TrafficStats) {
  const latency = formatMs(s.avgLatencyMs)
  const lookups = s.cacheHits + s.cacheMisses
  return [
    { label: "Requests", value: formatCount(s.totalRequests), hint: `${formatCount(s.totalErrors)} ${s.totalErrors === 1 ? "error" : "errors"}` },
    latency == null
      ? { label: "Latency", value: NOT_MEASURED, hint: "No upstream has answered yet" }
      : {
          label: "Latency",
          value: latency,
          hint: `p99 ${formatMs(s.p99LatencyMs) ?? NOT_MEASURED} over the last ${formatCount(s.latencySamples)} responses`,
        },
    { label: "Rate limited", value: formatCount(s.rateLimited) },
    { label: "Circuit breaks", value: formatCount(s.circuitBreaks), hint: "requests an open breaker refused" },
    {
      label: "Cache",
      value: lookups === 0 ? "No lookups" : `${formatCount(s.cacheHits)} hits, ${formatCount(s.cacheMisses)} misses`,
    },
    // The contract carries no retry count yet, so even a true flag reads Not
    // measured. When a count is added, show it in the true branch.
    s.retriesMeasured
      ? { label: "Retries", value: NOT_MEASURED }
      : { label: "Retries", value: NOT_MEASURED, hint: "Nothing in the proxy retries" },
  ]
}

export const BastionTrafficPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<TrafficStats>("traffic.stats")
  usePoll(query.refetch)

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Traffic" description="Requests the gateway proxied since it started, and how each route is doing." />
      <QueryBoundary title="Traffic" query={query} skeletonRows={4}>
        {(s) => (
          <>
            <StatGrid items={items(s)} />
            <ResourceTable<RouteTraffic>
              columns={columns}
              rows={s.routes}
              rowKey={(r) => r.routeId}
              caption={`${s.total} ${s.total === 1 ? "route" : "routes"}`}
              emptyMessage="No route has served traffic yet."
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
