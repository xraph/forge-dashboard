import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/**
 * The `stats` query's wire shape, from `StatsResponse` in
 * `extensions/streaming/contract/types.go`. Every field is always present -
 * none of them carry `omitempty` - so none of them are optional here.
 */
export interface StreamingStats {
  totalConnections: number
  totalRooms: number
  totalChannels: number
  totalMessages: number
  onlineUsers: number
  messagesPerSec: number
  uptimeSeconds: number
  memoryBytes: number
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** One row of `presence.list`, from `PresenceInfo` in types.go. */
export interface PresenceInfo {
  userID: string
  status: string
  customStatus?: string
  lastSeen: string
  rooms: string[]
}

export interface PresenceList {
  presence: PresenceInfo[]
}

const presenceColumns: Column<PresenceInfo>[] = [
  { id: "userID", header: "User", cell: (p) => p.userID },
  {
    id: "status",
    header: "Status",
    cell: (p) => (
      <span className="flex items-center gap-2">
        <Badge variant="outline">{p.status}</Badge>
        {p.customStatus && (
          <span className="text-xs text-muted-foreground">{p.customStatus}</span>
        )}
      </span>
    ),
  },
  { id: "rooms", header: "Rooms", cell: (p) => (p.rooms ?? []).length, align: "end" },
  { id: "lastSeen", header: "Last seen", cell: (p) => formatTimestamp(p.lastSeen) },
]

function OnlineUsers() {
  const query = useQuery<PresenceList>("presence.list")
  return (
    <QueryBoundary title="Online users" query={query} skeletonRows={3}>
      {(data) => (
        <ResourceTable<PresenceInfo>
          columns={presenceColumns}
          rows={data.presence ?? []}
          rowKey={(p) => p.userID}
          caption="Online users"
          emptyMessage="Nobody is online."
        />
      )}
    </QueryBoundary>
  )
}

export function StreamingOverviewPage() {
  const query = useQuery<StreamingStats>("stats")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Streaming" description="Live connection and room counts for this node." />
      <QueryBoundary title="Streaming stats" query={query} skeletonRows={2}>
        {(stats) => (
          <StatGrid
            items={[
              { label: "Connections", value: stats.totalConnections },
              { label: "Rooms", value: stats.totalRooms },
              { label: "Channels", value: stats.totalChannels },
              { label: "Online users", value: stats.onlineUsers },
              { label: "Messages", value: stats.totalMessages },
              { label: "Messages / sec", value: stats.messagesPerSec },
              { label: "Uptime", value: formatUptime(stats.uptimeSeconds) },
              { label: "Memory", value: formatBytes(stats.memoryBytes) },
            ]}
          />
        )}
      </QueryBoundary>
      <OnlineUsers />
    </section>
  )
}
