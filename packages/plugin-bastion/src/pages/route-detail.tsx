import type { ComponentType, ReactNode } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CircuitBadge, EnabledBadge, HealthBadge, ProtocolBadge, SourceBadge } from "../badges"
import { formatCount, formatMs } from "../format"
import type { HeaderPolicy, RouteDetail, TargetView } from "../types"
import { Methods } from "./routes"

const REDACTED = "[redacted]"
// Marks a header the route strips. Not a value a header could carry in a row, so it cannot collide.
const REMOVED = "\u0000removed"

interface HeaderRow {
  where: string
  name: string
  value: string
}

function headerRows(d: RouteDetail): HeaderRow[] {
  const rows: HeaderRow[] = []
  const policy = (prefix: string, p?: HeaderPolicy) => {
    const label = (verb: string) => (prefix ? `${prefix} (${verb.toLowerCase()})` : verb)
    for (const [name, value] of Object.entries(p?.set ?? {})) rows.push({ where: label("Set"), name, value })
    for (const [name, value] of Object.entries(p?.add ?? {})) rows.push({ where: label("Add"), name, value })
    for (const name of p?.remove ?? []) rows.push({ where: label("Remove"), name, value: REMOVED })
  }
  policy("", d.headers)
  policy("Request transform", d.transform?.requestHeaders)
  policy("Response transform", d.transform?.responseHeaders)
  return rows
}

const headerColumns: Column<HeaderRow>[] = [
  { id: "where", header: "Where", cell: (h) => h.where },
  { id: "name", header: "Header", className: "font-mono text-xs font-medium", cell: (h) => h.name },
  {
    id: "value",
    header: "Value",
    className: "font-mono text-xs",
    cell: (h) =>
      h.value === REDACTED ? (
        <Badge variant="secondary">Redacted</Badge>
      ) : h.value === REMOVED ? (
        <Badge variant="secondary">Removed</Badge>
      ) : (
        h.value
      ),
  },
]

const targetColumns: Column<TargetView>[] = [
  { id: "url", header: "URL", className: "font-mono text-xs font-medium", cell: (t) => t.url },
  { id: "weight", header: "Weight", align: "end", cell: (t) => t.weight },
  { id: "health", header: "Health", cell: (t) => <HealthBadge healthy={t.healthy} /> },
  { id: "circuit", header: "Circuit", cell: (t) => <CircuitBadge state={t.circuitState} /> },
  { id: "requests", header: "Requests", align: "end", cell: (t) => formatCount(t.stats.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (t) => formatCount(t.stats.totalErrors) },
  {
    id: "latency",
    header: "Avg latency",
    align: "end",
    cell: (t) => (t.stats.totalRequests === 0 ? <NoneCell label="latency" /> : formatMs(t.stats.avgLatencyMs)),
  },
]

const OVERRIDES = ["retry", "timeout", "rateLimit", "auth", "circuitBreaker", "cache", "trafficPolicy"] as const

function mono(v: string, none: string): ReactNode {
  return v ? <span className="font-mono text-xs">{v}</span> : <NoneCell label={none} />
}

export const BastionRouteDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No route in the address, so there is nothing to show.
      </p>
    )
  }
  return <RouteDetailBody id={id} />
}

function RouteDetailBody({ id }: { id: string }) {
  const query = useQuery<RouteDetail>("routes.detail", { id })

  return (
    <section className="flex flex-col gap-6">
      <QueryBoundary title="Route" query={query} skeletonRows={6}>
        {(d) => {
          const headers = headerRows(d)
          const overrides = OVERRIDES.filter((k) => d[k] != null)
          const discovered = d.source !== "manual"
          return (
            <>
              <PageHeader
                title={d.path}
                description={`Served by ${d.targets.length} ${d.targets.length === 1 ? "upstream" : "upstreams"}.`}
              />
              {d.config && (
                <p className="text-sm text-muted-foreground">
                  This route comes from the gateway's config file. A change made here lasts until the gateway restarts.
                </p>
              )}
              {discovered && (
                <p className="text-sm text-muted-foreground">
                  Discovery manages this route. Its next update replaces any change, so it cannot be edited here.
                </p>
              )}
              <DescriptionList
                items={[
                  { term: "Route ID", value: <span className="font-mono text-xs">{d.id}</span> },
                  {
                    term: "Source",
                    value: (
                      <span className="flex items-center gap-2">
                        <SourceBadge source={d.source} />
                        {d.config && <span className="text-sm text-muted-foreground">from the config file</span>}
                      </span>
                    ),
                  },
                  { term: "Service", value: mono(d.serviceName, "service") },
                  { term: "Protocol", value: <ProtocolBadge protocol={d.protocol} /> },
                  { term: "Methods", value: <Methods methods={d.methods} /> },
                  {
                    term: "Priority",
                    value: (
                      <span className="font-mono text-xs">
                        {d.input ? `${d.priority} (entered as ${d.input.priority})` : d.priority}
                      </span>
                    ),
                  },
                  { term: "Status", value: <EnabledBadge enabled={d.enabled} /> },
                  { term: "Strip prefix", value: d.stripPrefix ? "Yes" : "No" },
                  { term: "Add prefix", value: mono(d.addPrefix, "added prefix") },
                  { term: "Rewrite path", value: mono(d.rewritePath, "rewrite") },
                  { term: "Metadata", value: <TagList values={d.metadataKeys} label="metadata" /> },
                  { term: "Updated", value: <Timestamp value={d.updatedAt} label="update" /> },
                ]}
              />
              <section aria-labelledby="targets-heading" className="flex flex-col gap-2">
                <h2 id="targets-heading" className="text-sm font-medium">Targets</h2>
                <ResourceTable<TargetView>
                  columns={targetColumns}
                  rows={d.targets}
                  rowKey={(t) => t.id}
                  caption={`${d.targets.length} ${d.targets.length === 1 ? "target" : "targets"}`}
                  emptyMessage="This route has no upstream, so every request to it fails."
                />
              </section>
              <section aria-labelledby="headers-heading" className="flex flex-col gap-2">
                <h2 id="headers-heading" className="text-sm font-medium">Headers</h2>
                <ResourceTable<HeaderRow>
                  columns={headerColumns}
                  rows={headers}
                  rowKey={(h) => `${h.where}:${h.name}`}
                  caption={`${headers.length} ${headers.length === 1 ? "header" : "headers"}`}
                  emptyMessage="No header changes."
                />
              </section>
              <section aria-labelledby="overrides-heading" className="flex flex-col gap-2">
                <h2 id="overrides-heading" className="text-sm font-medium">Overrides</h2>
                {overrides.length === 0 ? (
                  <NoneCell label="overrides" />
                ) : (
                  <DescriptionList
                    items={overrides.map((k) => ({
                      term: k,
                      value: <span className="font-mono text-xs">{JSON.stringify(d[k])}</span>,
                    }))}
                  />
                )}
              </section>
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
