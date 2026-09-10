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

/**
 * `status` is a free string on the wire, so this maps the values the extension
 * actually emits and falls through to a neutral badge for anything else. A
 * new status must not render as nothing.
 */
function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default"
  if (status === "idle") return "secondary"
  return "outline"
}

/** Renders a string slice as badges, or an em-less dash when it is empty. */
function IdList({ values, label }: { values: string[]; label: string }) {
  if (values.length === 0) {
    // An empty cell reads as "loading" or "broken". The dash says "none",
    // and the label says it to a screen reader too.
    return (
      <span aria-label={`no ${label}`} className="text-muted-foreground">
        –
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="outline" className="font-mono text-xs">
          {value}
        </Badge>
      ))}
    </span>
  )
}

const columns: Column<ConnectionInfo>[] = [
  {
    id: "userID",
    header: "User",
    cell: (c) => <span className="font-mono text-xs">{c.userID}</span>,
  },
  {
    id: "connID",
    header: "Connection",
    cell: (c) => <span className="font-mono text-xs">{c.connID}</span>,
  },
  { id: "transport", header: "Transport", cell: (c) => c.transport },
  {
    id: "status",
    header: "Status",
    // The colour is the scan signal, not the text: an operator scanning a
    // long list reads state from the badge colour at a glance. The text
    // alone is not a substitute for that.
    cell: (c) => (
      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
    ),
  },
  {
    id: "rooms",
    header: "Rooms",
    cell: (c) => <IdList values={c.joinedRooms ?? []} label="rooms" />,
  },
  {
    id: "subscriptions",
    header: "Subscriptions",
    cell: (c) => (
      <IdList values={c.subscriptions ?? []} label="subscriptions" />
    ),
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
        {(data) => {
          const connections = data.connections ?? []
          return (
            <ResourceTable<ConnectionInfo>
              columns={columns}
              rows={connections}
              rowKey={(c) => c.connID}
              caption={
                connections.length === 0
                  ? undefined
                  : `${connections.length} ${
                      connections.length === 1 ? "connection" : "connections"
                    }`
              }
              emptyMessage="No connections right now."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
