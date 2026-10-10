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
import type { EventTypeSummary } from "../types"

const columns: Column<EventTypeSummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (r) => (
      <PluginLink
        to={`/event-types/${encodeURIComponent(r.name)}`}
        className="underline underline-offset-4"
      >
        {r.name}
      </PluginLink>
    ),
  },
  {
    id: "description",
    header: "Description",
    cell: (r) => r.description || <NoneCell label="description" />,
  },
  {
    id: "group",
    header: "Group",
    cell: (r) => r.group || <NoneCell label="group" />,
  },
  {
    id: "version",
    header: "Version",
    className: "tabular-nums",
    cell: (r) => r.version || <NoneCell label="version" />,
  },
  {
    id: "schema",
    header: "Schema",
    // Most types have none, and a type without one accepts any payload,
    // which is worth being able to see at a glance.
    cell: (r) =>
      r.hasSchema ? (
        <Badge variant="outline">Validated</Badge>
      ) : (
        <NoneCell label="schema" />
      ),
  },
  {
    id: "state",
    header: "State",
    cell: (r) =>
      r.deprecated ? (
        <Badge variant="secondary">Deprecated</Badge>
      ) : (
        <Badge variant="outline">Active</Badge>
      ),
  },
]

/** The catalog of event types Relay accepts. It is small, so it is not paged. */
export function RelayEventTypesPage() {
  const [show, setShow] = useState("active")
  const query = useQuery<{ types: EventTypeSummary[] }>("eventTypes.list", {
    includeDeprecated: show === "all",
  })
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Event types"
        description="What your application can send. A type with a schema has every payload checked against it."
        actions={
          <PluginLink to="/event-types/new" className={buttonVariants()}>
            Register a type
          </PluginLink>
        }
      />
      <FilterBar
        filters={[
          {
            id: "show",
            label: "Show",
            value: show,
            onChange: setShow,
            options: [
              { label: "Active", value: "active" },
              { label: "Active and deprecated", value: "all" },
            ],
          },
        ]}
      />
      <QueryBoundary title="Event types" query={query} skeletonRows={5}>
        {(data) => {
          const rows = data.types ?? []
          return (
            <ResourceTable<EventTypeSummary>
              columns={columns}
              rows={rows}
              rowKey={(r) => r.name}
              caption={`${rows.length} ${rows.length === 1 ? "type" : "types"}`}
              emptyMessage="No event types yet. Register one before sending events of it."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
