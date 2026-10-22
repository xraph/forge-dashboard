import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import type { StatItem } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatCount } from "../format"
import type { Stats } from "../types"

/**
 * The counter strip for an `overview.stats` answer. The node total opens with
 * the tenant count; a tenant's own counters carry none, so the cell is left
 * out rather than showing a zero that means "not applicable".
 */
export function Counters({ stats }: { stats: Stats }) {
  const items: StatItem[] = []
  if (stats.tenants !== undefined) {
    items.push({ label: "Tenants", value: formatCount(stats.tenants) })
  }
  items.push(
    { label: "Connected clients", value: formatCount(stats.connected) },
    { label: "Sessions", value: formatCount(stats.sessions) },
    { label: "Subscriptions", value: formatCount(stats.subscriptions) },
    { label: "Retained messages", value: formatCount(stats.retained) },
    { label: "Messages in", value: formatCount(stats.messagesIn) },
    { label: "Messages out", value: formatCount(stats.messagesOut) }
  )
  return (
    <StatGrid
      items={items}
      aria-label={stats.scope === "node" ? "Node counters" : "Tenant counters"}
    />
  )
}
