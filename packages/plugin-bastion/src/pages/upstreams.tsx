import { Fragment } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { CircuitBadge, HealthBadge } from "../badges"
import { formatCount, formatMs } from "../format"
import { routePath } from "../keys"
import type { Upstream, UpstreamsList } from "../types"

const columns: Column<Upstream>[] = [
  {
    id: "url",
    header: "URL",
    className: "font-mono text-xs font-medium",
    cell: (u) => u.url,
  },
  {
    id: "health",
    header: "Health",
    cell: (u) => <HealthBadge healthy={u.healthy} />,
  },
  {
    id: "circuit",
    header: "Circuit",
    cell: (u) => <CircuitBadge state={u.circuitState} />,
  },
  {
    id: "routes",
    header: "Routes",
    className: "font-mono text-xs",
    cell: (u) =>
      u.routes.map((r, i) => (
        <Fragment key={`${r.routeId}:${r.targetId}`}>
          {i > 0 && ", "}
          <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>
        </Fragment>
      )),
  },
  {
    id: "requests",
    header: "Requests",
    align: "end",
    cell: (u) => formatCount(u.totalRequests),
  },
  {
    id: "errors",
    header: "Errors",
    align: "end",
    cell: (u) => formatCount(u.totalErrors),
  },
  {
    id: "latency",
    header: "Avg latency",
    align: "end",
    cell: (u) =>
      u.totalRequests === 0 ? (
        <NoneCell label="latency" />
      ) : (
        formatMs(u.avgLatencyMs)
      ),
  },
]

export const BastionUpstreamsPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<UpstreamsList>("upstreams.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Upstreams"
        description="Each upstream once, however many routes use it. An upstream is healthy only when every route's entry for it is."
      />
      <QueryBoundary title="Upstreams" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<Upstream>
            columns={columns}
            rows={data.upstreams}
            rowKey={(u) => u.url}
            caption={`${data.total} ${data.total === 1 ? "upstream" : "upstreams"}`}
            emptyMessage="No upstreams. Add a route to give the gateway somewhere to send traffic."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
