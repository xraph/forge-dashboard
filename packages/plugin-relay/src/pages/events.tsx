import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import type { EventSummary, EventsPage, EventTypeSummary } from "../types"

const columns: Column<EventSummary>[] = [
  {
    id: "type",
    header: "Type",
    className: "font-medium",
    cell: (r) => (
      <PluginLink
        to={`/events/${r.id}`}
        className="underline underline-offset-4"
      >
        {r.type}
      </PluginLink>
    ),
  },
  {
    id: "tenant",
    header: "Tenant",
    className: "font-mono text-xs",
    cell: (r) => r.tenantId,
  },
  {
    id: "id",
    header: "Event ID",
    className: "font-mono text-xs",
    cell: (r) => r.id,
  },
  {
    id: "created",
    header: "Sent",
    cell: (r) => <Timestamp value={r.createdAt} label="sent" />,
  },
]

/** Every event Relay accepted, newest first. */
export function RelayEventsPage() {
  const [tenant, setTenant] = useState("")
  const [type, setType] = useState("all")
  const pager = useCursorStack()
  const types = useQuery<{ types: EventTypeSummary[] }>("eventTypes.list", {
    includeDeprecated: true,
  })

  const params: Record<string, unknown> = { limit: 50 }
  if (tenant.trim()) params.tenantId = tenant.trim()
  if (type !== "all") params.type = type
  if (pager.cursor) params.cursor = pager.cursor
  const query = useQuery<EventsPage>("events.list", params)

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Events"
        description="Everything sent through Relay, newest first. Each event fans out to the endpoints it matches."
        actions={
          <PluginLink to="/events/send" className={buttonVariants()}>
            Send an event
          </PluginLink>
        }
      />
      <FilterBar
        search={{
          value: tenant,
          onChange: (v) => {
            setTenant(v)
            pager.reset()
          },
          label: "Tenant",
          placeholder: "Filter by tenant",
        }}
        filters={[
          {
            id: "type",
            label: "Type",
            value: type,
            onChange: (v) => {
              setType(v)
              pager.reset()
            },
            options: [
              { label: "All", value: "all" },
              ...(types.data?.types ?? []).map((t) => ({
                label: t.name,
                value: t.name,
              })),
            ],
          },
        ]}
      />
      <QueryBoundary title="Events" query={query} skeletonRows={8}>
        {(data) => {
          const rows = data.events ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<EventSummary>
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                caption={`${rows.length} ${rows.length === 1 ? "event" : "events"} on this page`}
                emptyMessage={
                  tenant.trim() || type !== "all"
                    ? "No events match these filters."
                    : "No events yet. Send one to see it fan out."
                }
              />
              <CursorPager
                shown={rows.length}
                nextCursor={data.nextCursor}
                onNext={pager.next}
                onPrevious={pager.previous}
                canGoBack={pager.canGoBack}
              />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
