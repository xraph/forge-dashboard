import { useState, type ComponentType } from "react"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { EventListResponse } from "../types"
import { eventColumns } from "../components/event-columns"
import { pageOf } from "../format"

const PAGE = 50

/**
 * Keyed by user so that following a link to another user starts on that
 * user's first page, not on whatever page the last one was left at.
 */
export const UserEventsPage: ComponentType<PluginPageProps> = (props) => (
  <UserEventsView
    key={props.params.userId ?? ""}
    userId={props.params.userId ?? ""}
  />
)

/**
 * No filters: a user page is reached by clicking a user id, not by searching,
 * and the contract's `events.byUser` takes only a time range.
 */
function UserEventsView({ userId }: { userId: string }) {
  const [offset, setOffset] = useState(0)
  const q = useQuery<EventListResponse>("events.byUser", {
    userId,
    limit: PAGE,
    offset,
  })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={`Events by ${userId}`}
        description="Every event this user took part in, newest first."
      />
      <QueryBoundary title="events" query={q} skeletonRows={10}>
        {(data) => (
          <ResourceTable
            columns={eventColumns({ showUser: false })}
            rows={data.events}
            rowKey={(e) => e.id}
            caption={pageOf(data.events.length, data.total, "event", "events")}
            emptyMessage="No events are recorded for this user."
            pagination={{
              page: offset / PAGE + 1,
              pageSize: PAGE,
              total: data.total,
            }}
            onPageChange={(page) => setOffset((page - 1) * PAGE)}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
