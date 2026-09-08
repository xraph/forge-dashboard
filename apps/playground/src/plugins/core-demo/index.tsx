import { definePlugin, useQuery } from "@forge-go/dashboard-plugin"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"

/**
 * The fields the dashboard extension's `overview` query actually returns.
 * `version` and `environment` come back as the literal string "unknown" on a
 * server that was not built with them set, and this page renders that as-is:
 * dressing it up as "n/a" would hide a real deployment problem.
 */
interface Overview {
  overallHealth: string
  totalServices: number
  healthyServices: number
  totalMetrics: number
  uptimeSeconds: number
  version: string
  environment: string
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

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

function OverviewPage() {
  const { data, error, loading, refetch } = useQuery<Overview>("overview")

  if (loading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading overview…
      </p>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Overview unavailable</CardTitle>
          <CardDescription role="alert">
            {error.code}: {error.message}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={refetch}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <Stat label="Overall health" value={data.overallHealth} />
      <Stat label="Services" value={data.totalServices} />
      <Stat label="Healthy services" value={data.healthyServices} />
      <Stat label="Metrics" value={data.totalMetrics} />
      <Stat label="Uptime" value={formatUptime(data.uptimeSeconds)} />
      <Stat label="Version" value={data.version} />
      <Stat label="Environment" value={data.environment} />
    </div>
  )
}

/**
 * A plugin written the way an extension author would write one: it names the
 * Go contributor it belongs to, declares its nav and routes, and never names
 * a contributor when it queries. It lives in the playground because it is a
 * demonstration that the plugin API works, not a package anyone ships.
 *
 * `root: true` and not a `namespace`: this stands in for the server's own
 * UI, not an extension arriving from elsewhere, so it has nothing to collide
 * with and nothing to gain from living behind a scope switcher. It serves at
 * "/overview" and its nav is pinned above the switcher in every scope.
 */
export const coreDemoPlugin = definePlugin({
  extension: "core-contract",
  root: true,
  label: "System",
  nav: [{ label: "Overview", to: "/overview" }],
  routes: [{ path: "/overview", element: OverviewPage }],
})
