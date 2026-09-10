import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** One row of `connections.list`, from `ConnectionInfo` in types.go. */
export interface ConnectionInfo {
  connID: string
  userID: string
  transport: string
  joinedRooms: string[]
  subscriptions: string[]
  lastActivity: string
  status: string
}

export interface ConnectionsList {
  connections: ConnectionInfo[]
}

const columns: Column<ConnectionInfo>[] = [
  { id: "userID", header: "User", cell: (c) => c.userID },
  {
    id: "connID",
    header: "Connection",
    cell: (c) => <span className="font-mono text-xs">{c.connID}</span>,
  },
  { id: "transport", header: "Transport", cell: (c) => c.transport },
  {
    id: "status",
    header: "Status",
    cell: (c) => <Badge variant="outline">{c.status}</Badge>,
  },
  {
    id: "rooms",
    header: "Rooms",
    cell: (c) => (c.joinedRooms ?? []).length,
    align: "end",
  },
  {
    id: "lastActivity",
    header: "Last activity",
    cell: (c) => formatTimestamp(c.lastActivity),
  },
]

export function StreamingConnectionsPage() {
  const query = useQuery<ConnectionsList>("connections.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Connections" />
      <QueryBoundary title="Connections" query={query} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ConnectionInfo>
            columns={columns}
            rows={data.connections ?? []}
            rowKey={(c) => c.connID}
            caption="Connections"
            emptyMessage="No connections right now."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
