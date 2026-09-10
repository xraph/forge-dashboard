import { PluginLink, PluginSlot, useQuery, useSlotCount } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { displayName, type UserSummary } from "./users"

/** `overview.stats`. */
export interface OverviewStats {
  users: number
  sessions: number
  devices: number
  plugins: number
}

/** `overview.recentSignups({ limit })`. */
export interface RecentSignups {
  users: UserSummary[]
}

const columns: Column<UserSummary>[] = [
  { id: "email", header: "Email", cell: (u) => u.email, className: "font-medium" },
  { id: "name", header: "Name", cell: (u) => displayName(u) },
  { id: "createdAt", header: "Created", cell: (u) => formatTimestamp(u.createdAt) },
]

/**
 * The landing page: four counters, the ten most recent signups, and whatever
 * a sub-plugin has to add.
 *
 * The widgets heading is gated on `useSlotCount` rather than always rendered
 * above `PluginSlot`. `PluginSlot` itself renders nothing at all when nobody
 * contributes, so an unconditional heading above it would draw "More from
 * your plugins" over an empty section on every app that has none installed.
 * `useSlotCount` returns 0 outside a `SubPluginProvider`, which is what lets
 * this page render correctly standalone, with no heading, in a test that
 * mounts it with no host around it at all.
 */
export function AuthOverviewPage() {
  const stats = useQuery<OverviewStats>("overview.stats")
  const recent = useQuery<RecentSignups>("overview.recentSignups", { limit: 10 })
  const widgetCount = useSlotCount("overview.widgets")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Overview" />

      <QueryBoundary title="Overview" query={stats} skeletonRows={1}>
        {(data) => (
          <StatGrid
            items={[
              { label: "Users", value: data.users },
              { label: "Sessions", value: data.sessions },
              { label: "Devices", value: data.devices },
              { label: "Plugins", value: data.plugins },
            ]}
          />
        )}
      </QueryBoundary>

      <QueryBoundary title="Recent signups" query={recent} skeletonRows={5}>
        {(data) => {
          const users = data.users ?? []
          return (
            <ResourceTable<UserSummary>
              columns={columns}
              rows={users}
              rowKey={(u) => u.id}
              caption={`${users.length} shown`}
              emptyMessage="No signups yet."
              rowActions={(user) => (
                <PluginLink
                  to={`/@auth/users/${user.id}`}
                  className="text-sm underline underline-offset-4"
                >
                  Details
                </PluginLink>
              )}
            />
          )
        }}
      </QueryBoundary>

      {widgetCount > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">More from your plugins</h2>
          <PluginSlot name="overview.widgets" />
        </div>
      )}
    </section>
  )
}
