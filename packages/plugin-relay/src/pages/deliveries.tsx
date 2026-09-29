import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import { DeliveryStateBadge } from "../components/delivery-state"
import { describeStatus } from "../lib/format"
import type {
  DeliveriesPage,
  DeliverySummary,
  EventTypeSummary,
} from "../types"
import type { EndpointsList } from "./endpoints"

const PAGE_SIZE = 50

// The windows people actually ask about. A range picker would be more
// general; nobody arrives at a delivery log with two dates in mind.
const WINDOWS: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
}

export const deliveryColumns: Column<DeliverySummary>[] = [
  {
    id: "state",
    header: "State",
    cell: (r) => (
      <DeliveryStateBadge state={r.state} attemptCount={r.attemptCount} />
    ),
  },
  {
    id: "event",
    header: "Event type",
    className: "font-medium",
    cell: (r) => (
      <PluginLink
        to={`/deliveries/${r.id}`}
        className="underline underline-offset-4"
      >
        {r.eventType}
      </PluginLink>
    ),
  },
  {
    id: "endpoint",
    header: "Endpoint",
    cell: (r) =>
      r.endpointUrl ? (
        <span className="break-all">{r.endpointUrl}</span>
      ) : (
        <NoneCell label="endpoint (deleted)" />
      ),
  },
  {
    id: "response",
    header: "Response",
    cell: (r) =>
      r.attemptCount === 0 ? (
        <NoneCell label="response yet" />
      ) : (
        <span
          className={cn(
            "tabular-nums",
            (r.lastStatusCode === 0 || r.lastStatusCode >= 400) &&
              "text-destructive"
          )}
        >
          {describeStatus(r.lastStatusCode)}
        </span>
      ),
  },
  {
    id: "attempts",
    header: "Attempts",
    cell: (r) => (
      <span className="tabular-nums">
        {r.attemptCount} of {r.maxAttempts}
      </span>
    ),
  },
  {
    id: "tenant",
    header: "Tenant",
    className: "font-mono text-xs",
    cell: (r) => r.tenantId,
  },
  {
    id: "created",
    header: "Created",
    cell: (r) => <Timestamp value={r.createdAt} label="created" />,
  },
]

/**
 * The delivery log: every webhook Relay has tried to send, newest first.
 *
 * Filters lead because you arrive holding something: a tenant, an endpoint
 * that has gone quiet, a status that should not be there. Any change to them
 * starts again from the newest page, since a cursor belongs to the search
 * that issued it.
 */
export function RelayDeliveriesPage() {
  const [tenant, setTenant] = useState("")
  const [state, setState] = useState("all")
  const [status, setStatus] = useState("all")
  const [endpoint, setEndpoint] = useState("all")
  const [eventType, setEventType] = useState("all")
  const [created, setCreated] = useState("all")
  // Fixed when the window is chosen. Computing it on every render would
  // change the query's params, and with them its cache key, every render.
  const [from, setFrom] = useState<string | undefined>()
  const pager = useCursorStack()

  const endpoints = useQuery<EndpointsList>("endpoints.list", { tenantId: "" })
  const types = useQuery<{ types: EventTypeSummary[] }>("eventTypes.list", {
    includeDeprecated: true,
  })

  const params: Record<string, unknown> = { limit: PAGE_SIZE }
  if (tenant.trim()) params.tenantId = tenant.trim()
  if (state !== "all") params.state = state
  if (status !== "all") params.statusClass = status
  if (endpoint !== "all") params.endpointId = endpoint
  if (eventType !== "all") params.eventType = eventType
  if (from) params.from = from
  if (pager.cursor) params.cursor = pager.cursor
  const query = useQuery<DeliveriesPage>("deliveries.list", params)

  const filtered =
    tenant.trim() !== "" ||
    [state, status, endpoint, eventType, created].some((v) => v !== "all")

  // Every filter change goes back to the first page.
  const change = (set: (v: string) => void) => (v: string) => {
    set(v)
    pager.reset()
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Deliveries"
        description="Every webhook Relay has tried to send, newest first."
      />
      <FilterBar
        search={{
          value: tenant,
          onChange: change(setTenant),
          label: "Tenant",
          placeholder: "Filter by tenant",
        }}
        filters={[
          {
            id: "state",
            label: "State",
            value: state,
            onChange: change(setState),
            options: [
              { label: "All", value: "all" },
              { label: "Queued or retrying", value: "pending" },
              { label: "Delivered", value: "delivered" },
              { label: "Failed", value: "failed" },
            ],
          },
          {
            id: "status",
            label: "Response",
            value: status,
            onChange: change(setStatus),
            options: [
              { label: "Any", value: "all" },
              { label: "2xx", value: "2xx" },
              { label: "4xx", value: "4xx" },
              { label: "5xx", value: "5xx" },
              { label: "No response", value: "none" },
            ],
          },
          {
            id: "endpoint",
            label: "Endpoint",
            value: endpoint,
            onChange: change(setEndpoint),
            options: [
              { label: "All", value: "all" },
              ...(endpoints.data?.endpoints ?? []).map((e) => ({
                label: e.url,
                value: e.id,
              })),
            ],
          },
          {
            id: "eventType",
            label: "Event type",
            value: eventType,
            onChange: change(setEventType),
            options: [
              { label: "All", value: "all" },
              ...(types.data?.types ?? []).map((t) => ({
                label: t.name,
                value: t.name,
              })),
            ],
          },
          {
            id: "window",
            label: "Created",
            value: created,
            onChange: (v) => {
              setCreated(v)
              setFrom(
                v === "all"
                  ? undefined
                  : new Date(Date.now() - WINDOWS[v]).toISOString()
              )
              pager.reset()
            },
            options: [
              { label: "Any time", value: "all" },
              { label: "Last hour", value: "hour" },
              { label: "Last 24 hours", value: "day" },
              { label: "Last 7 days", value: "week" },
            ],
          },
        ]}
      />
      <QueryBoundary title="Deliveries" query={query} skeletonRows={8}>
        {(data) => {
          const rows = data.deliveries ?? []
          return (
            <div className="flex flex-col gap-3">
              {!data.complete && (
                // Only redis says this: it filters some fields in memory over
                // a bounded window, and it stopped before the page filled.
                <p
                  role="status"
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  {rows.length === 0
                    ? "Nothing found in the part of the log searched so far. Next searches further back."
                    : "This page may be short: the search stopped before it filled. Next carries on from there."}
                </p>
              )}
              <ResourceTable<DeliverySummary>
                columns={deliveryColumns}
                rows={rows}
                rowKey={(r) => r.id}
                caption={`${rows.length} ${rows.length === 1 ? "delivery" : "deliveries"} on this page`}
                emptyMessage={
                  !data.complete
                    ? "None found yet."
                    : filtered
                      ? "No deliveries match these filters."
                      : "Nothing has been sent yet. A delivery appears here when an event matches an endpoint."
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
