import { useQuery } from "@forge-go/dashboard-plugin"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { QueryView } from "../components/query-view"

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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
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

export function StreamingOverviewPage() {
  const query = useQuery<StreamingStats>("stats")

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Streaming</h1>
      <QueryView title="Streaming stats" query={query} skeletonRows={2}>
        {(stats) => (
          <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            <Stat label="Connections" value={stats.totalConnections} />
            <Stat label="Rooms" value={stats.totalRooms} />
            <Stat label="Channels" value={stats.totalChannels} />
            <Stat label="Online users" value={stats.onlineUsers} />
            <Stat label="Messages" value={stats.totalMessages} />
            <Stat label="Messages / sec" value={stats.messagesPerSec} />
            <Stat label="Uptime" value={formatUptime(stats.uptimeSeconds)} />
            <Stat label="Memory" value={formatBytes(stats.memoryBytes)} />
          </div>
        )}
      </QueryView>
    </section>
  )
}
