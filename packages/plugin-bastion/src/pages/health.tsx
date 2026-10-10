import { Fragment } from "react"
import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { CircuitBadge, EnabledBadge, HealthBadge } from "../badges"
import { formatCount } from "../format"
import { routePath } from "../keys"
import type { ConfigDetail, Upstream, UpstreamsList } from "../types"

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
    id: "active",
    header: "Active connections",
    align: "end",
    cell: (u) => formatCount(u.activeConns),
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
]

function HealthChecks({ config }: { config: ConfigDetail }) {
  const section = config.sections.find((s) => s.id === "healthCheck")
  if (!section || section.enabled === false) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Active health checks are switched off, so health comes only from passive
        failures on proxied requests.
      </p>
    )
  }
  return (
    <section
      aria-labelledby="checks-heading"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2
        id="checks-heading"
        className="flex items-center gap-2 text-sm font-medium"
      >
        Health checks <EnabledBadge enabled />
      </h2>
      <DescriptionList
        items={section.settings.map((s) => ({
          term: s.key,
          value: <span className="font-mono text-xs">{s.value}</span>,
        }))}
      />
    </section>
  )
}

export const BastionHealthPage: ComponentType<PluginPageProps> = () => {
  const ups = useQuery<UpstreamsList>("upstreams.list")
  usePoll(ups.refetch)
  const config = useQuery<ConfigDetail>("config.detail")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Health"
        description="Each upstream's last known health. Bastion probes on its own schedule; there is no manual check and no history."
      />
      <QueryBoundary
        title="Health check settings"
        query={config}
        skeletonRows={2}
      >
        {(c) => <HealthChecks config={c} />}
      </QueryBoundary>
      <QueryBoundary title="Upstream health" query={ups} skeletonRows={5}>
        {(data) => {
          const rows = [...data.upstreams].sort(
            (a, b) =>
              Number(a.healthy) - Number(b.healthy) ||
              a.url.localeCompare(b.url)
          )
          const unhealthy = rows.filter((u) => !u.healthy).length
          const caption = `${data.total} ${data.total === 1 ? "upstream" : "upstreams"}${unhealthy > 0 ? ` (${unhealthy} unhealthy)` : ""}`
          return (
            <ResourceTable<Upstream>
              columns={columns}
              rows={rows}
              rowKey={(u) => u.url}
              caption={caption}
              emptyMessage="No upstreams. Add a route to give the gateway somewhere to send traffic."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
