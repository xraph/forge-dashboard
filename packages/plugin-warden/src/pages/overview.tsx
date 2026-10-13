import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { checkColumns, type CheckSummary } from "../components/check-log"

export interface OverviewStats {
  roles: number
  permissions: number
  assignments: number
  relations: number
  policies: number
  resourceTypes: number
}

export interface RecentChecks {
  checks: CheckSummary[]
}

export function WardenOverviewPage() {
  const stats = useQuery<OverviewStats>("overview.stats")
  const recent = useQuery<RecentChecks>("overview.recentChecks", { limit: 10 })

  const columns = checkColumns()

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Warden" />

      <QueryBoundary title="Counts" query={stats} skeletonRows={1}>
        {(data) => (
          <StatGrid
            items={[
              { label: "Roles", value: data.roles },
              { label: "Permissions", value: data.permissions },
              { label: "Assignments", value: data.assignments },
              { label: "Relations", value: data.relations },
              { label: "Policies", value: data.policies },
              { label: "Resource types", value: data.resourceTypes },
            ]}
          />
        )}
      </QueryBoundary>

      <Section
        title="Recent checks"
        actions={
          <PluginLink
            to="/check-log"
            className="text-sm underline underline-offset-4"
          >
            View the check log
          </PluginLink>
        }
      >
        <QueryBoundary title="Recent checks" query={recent} skeletonRows={5}>
          {(data) => {
            const checks = data.checks ?? []
            const caption = `${checks.length} ${checks.length === 1 ? "check" : "checks"}`
            return (
              <ResourceTable<CheckSummary>
                columns={columns}
                rows={checks}
                rowKey={(c) => c.id}
                caption={caption}
                emptyMessage="No checks are in the log."
              />
            )
          }}
        </QueryBoundary>
      </Section>
    </section>
  )
}
