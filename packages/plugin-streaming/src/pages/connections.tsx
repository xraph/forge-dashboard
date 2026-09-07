import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import {
  EmptyState,
  QueryView,
  formatTimestamp,
} from "../components/query-view"

/**
 * One row of `connections.list`, from `ConnectionInfo` in
 * `extensions/streaming/contract/types.go`.
 */
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
    return (
      <span aria-label={`no ${label}`} className="text-muted-foreground">
        &ndash;
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="outline" className="font-mono">
          {value}
        </Badge>
      ))}
    </span>
  )
}

export function StreamingConnectionsPage() {
  const query = useQuery<ConnectionsList>("connections.list")

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Connections</h1>
      <QueryView title="Connections" query={query} skeletonRows={4}>
        {(data) => {
          const connections = data.connections ?? []
          if (connections.length === 0) {
            return <EmptyState message="No active connections." />
          }

          return (
            <Table>
              <TableCaption>
                {connections.length}{" "}
                {connections.length === 1 ? "connection" : "connections"}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Connection</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Rooms</TableHead>
                  <TableHead>Subscriptions</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.connID}>
                    <TableCell className="font-mono text-xs">
                      {conn.connID}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {conn.userID}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{conn.transport}</Badge>
                    </TableCell>
                    <TableCell>
                      <IdList values={conn.joinedRooms ?? []} label="rooms" />
                    </TableCell>
                    <TableCell>
                      <IdList
                        values={conn.subscriptions ?? []}
                        label="subscriptions"
                      />
                    </TableCell>
                    <TableCell>{formatTimestamp(conn.lastActivity)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(conn.status)}>
                        {conn.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }}
      </QueryView>
    </section>
  )
}
