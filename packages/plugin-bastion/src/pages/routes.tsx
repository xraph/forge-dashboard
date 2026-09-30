import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { EnabledBadge, ProtocolBadge, SourceBadge } from "../badges"
import { routePath } from "../keys"
import type { RouteSummary, RoutesList } from "../types"

const SOURCE_OPTIONS = [
  { label: "All", value: "" },
  { label: "Manual", value: "manual" },
  { label: "FARP", value: "farp" },
  { label: "Discovery", value: "discovery" },
]

const PROTOCOL_OPTIONS = [
  { label: "All", value: "" },
  ...["http", "websocket", "sse", "grpc", "graphql"].map((p) => ({ label: p, value: p })),
]

/** Methods as tags, or "Any": an empty list means the route matches every method. */
export function Methods({ methods }: { methods: string[] }) {
  if (methods.length === 0) return <span className="text-muted-foreground">Any</span>
  return <TagList values={methods} label="methods" />
}

export const routeColumns: Column<RouteSummary>[] = [
  {
    id: "path",
    header: "Path",
    className: "font-mono text-xs font-medium",
    cell: (r) => <PluginLink to={routePath(r.id)}>{r.path}</PluginLink>,
  },
  { id: "methods", header: "Methods", cell: (r) => <Methods methods={r.methods} /> },
  { id: "protocol", header: "Protocol", cell: (r) => <ProtocolBadge protocol={r.protocol} /> },
  { id: "source", header: "Source", cell: (r) => <SourceBadge source={r.source} /> },
  { id: "priority", header: "Priority", align: "end", className: "font-mono text-xs", cell: (r) => r.priority },
  { id: "upstreams", header: "Upstreams", cell: (r) => `${r.healthyTargets}/${r.targetCount} healthy` },
  { id: "status", header: "Status", cell: (r) => <EnabledBadge enabled={r.enabled} /> },
]

export const BastionRoutesPage: ComponentType<PluginPageProps> = () => {
  const [source, setSource] = useState("")
  const [protocol, setProtocol] = useState("")
  const filtered = source !== "" || protocol !== ""

  const list = useQuery<RoutesList>("routes.list", {
    // Absent, not empty, when a filter is not set.
    ...(source === "" ? {} : { source }),
    ...(protocol === "" ? {} : { protocol }),
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Routes" description="Every route in match order: manual routes from config or this dashboard, and routes discovery found." />
      <FilterBar
        filters={[
          { id: "source", label: "Source", value: source, options: SOURCE_OPTIONS, onChange: setSource },
          { id: "protocol", label: "Protocol", value: protocol, options: PROTOCOL_OPTIONS, onChange: setProtocol },
        ]}
      />
      <QueryBoundary title="Routes" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<RouteSummary>
            columns={routeColumns}
            rows={data.routes}
            rowKey={(r) => r.id}
            caption={`${data.total} ${data.total === 1 ? "route" : "routes"}`}
            emptyMessage={
              filtered
                ? "No routes match these filters."
                : "No routes. Add one in config, or let discovery find your services."
            }
          />
        )}
      </QueryBoundary>
    </section>
  )
}
