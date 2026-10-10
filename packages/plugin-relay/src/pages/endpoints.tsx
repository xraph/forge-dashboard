import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"

/** One row of `endpoints.list`, from EndpointSummary in relay's contract. */
export interface EndpointSummary {
  id: string
  tenantId: string
  url: string
  description?: string
  eventTypes: string[]
  enabled: boolean
  rateLimit: number
  /**
   * Whether the endpoint has a signing secret at all. Relay no longer
   * delivers to one without, but one can still exist, and nothing else on
   * the row would say so.
   */
  signed: boolean
  createdAt: string
  updatedAt: string
}

export interface EndpointsList {
  endpoints: EndpointSummary[]
}

type StateFilter = "all" | "enabled" | "disabled"

// Badges ramp by proportion, not meaning (playbook, convention 5). Most
// endpoints are enabled and signed, so those recede to outline. Disabled is
// notable. Unsigned is what somebody came to this page to find.
const columns: Column<EndpointSummary>[] = [
  {
    id: "url",
    header: "URL",
    className: "font-medium",
    cell: (r) => (
      <PluginLink
        to={`/endpoints/${r.id}`}
        className="underline underline-offset-4"
      >
        {r.url}
      </PluginLink>
    ),
  },
  {
    id: "tenant",
    header: "Tenant",
    cell: (r) => <span className="font-mono text-xs">{r.tenantId}</span>,
  },
  {
    id: "eventTypes",
    header: "Event types",
    cell: (r) => <TagList values={r.eventTypes} label="event types" />,
  },
  {
    id: "state",
    header: "State",
    cell: (r) => (
      <Badge variant={r.enabled ? "outline" : "secondary"}>
        {r.enabled ? "Enabled" : "Disabled"}
      </Badge>
    ),
  },
  {
    id: "signing",
    header: "Signing",
    cell: (r) => (
      <Badge variant={r.signed ? "outline" : "destructive"}>
        {r.signed ? "Signed" : "Unsigned"}
      </Badge>
    ),
  },
  {
    id: "rateLimit",
    header: "Rate limit",
    align: "end",
    className: "tabular-nums",
    cell: (r) =>
      r.rateLimit > 0 ? `${r.rateLimit}/s` : <NoneCell label="rate limit" />,
  },
  {
    id: "created",
    header: "Created",
    cell: (r) => <Timestamp value={r.createdAt} label="created" />,
  },
]

export function RelayEndpointsPage() {
  const [tenant, setTenant] = useState("")
  const [state, setState] = useState<StateFilter>("all")

  // An empty tenant lists every tenant; relay's ListEndpoints answers that
  // itself, so the page never invents one.
  const params: Record<string, unknown> = { tenantId: tenant.trim() }
  if (state !== "all") params.enabled = state === "enabled"
  const query = useQuery<EndpointsList>("endpoints.list", params)

  const filtered = tenant.trim() !== "" || state !== "all"

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Endpoints"
        description="Where Relay delivers webhooks, and which events each one receives."
        actions={
          <PluginLink to="/endpoints/new" className={buttonVariants()}>
            New endpoint
          </PluginLink>
        }
      />
      <FilterBar
        search={{
          value: tenant,
          onChange: setTenant,
          label: "Tenant",
          placeholder: "Filter by tenant",
        }}
        filters={[
          {
            id: "state",
            label: "State",
            value: state,
            onChange: (v) => setState(v as StateFilter),
            options: [
              { label: "All", value: "all" },
              { label: "Enabled", value: "enabled" },
              { label: "Disabled", value: "disabled" },
            ],
          },
        ]}
      />
      <QueryBoundary title="Endpoints" query={query} skeletonRows={4}>
        {(data) => {
          // The Go handler never sends null here, but the page renders
          // whatever the host hands it and must not throw on a missing array.
          const endpoints = data.endpoints ?? []
          return (
            <ResourceTable<EndpointSummary>
              columns={columns}
              rows={endpoints}
              rowKey={(r) => r.id}
              // Convention 3: a live count, including at zero.
              caption={`${endpoints.length} ${endpoints.length === 1 ? "endpoint" : "endpoints"}`}
              emptyMessage={
                filtered
                  ? "No endpoints match these filters."
                  : "No endpoints yet. Create one to start delivering webhooks."
              }
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
