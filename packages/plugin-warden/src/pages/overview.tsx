import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"

export interface OverviewStats {
  roles: number
  permissions: number
  assignments: number
  relations: number
  policies: number
  resourceTypes: number
}

export interface CheckSummary {
  id: string
  namespacePath: string
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId: string
  decision: string
  reason?: string
  evalTimeNs: number
  cached: boolean
  error?: string
  createdAt: string
}

export interface RecentChecks {
  checks: CheckSummary[]
}

/**
 * The tenant root is a real namespace where things live, not an absent
 * value, so it does not use NoneCell. It renders as "/" rather than the word
 * "root" because namespaceSegmentRegex permits "root" as an ordinary segment
 * name, and a namespace actually called root would then be indistinguishable
 * from the tenant root. ValidateNamespacePath forbids a leading or trailing
 * slash, so "/" is a token no real path can produce.
 */
export function NamespaceCell({ path }: { path: string }) {
  return (
    <span className="font-mono text-xs" title={path === "" ? "Tenant root" : path}>
      {path === "" ? "/" : path}
    </span>
  )
}

/**
 * The check log's scan signal is not the decision.
 *
 * Allow-versus-deny volume is a property of the deployment rather than the
 * domain: a permissive system logs mostly allows and the denials are the
 * interesting minority, a restrictive one is the reverse, and both are
 * ordinary. So the decision badge takes a stable mapping and the page
 * accepts that it is weak. Error is the one state whose meaning does not
 * vary with posture, so it is the one that interrupts.
 */
function decisionVariant(decision: string): "outline" | "secondary" | "destructive" {
  if (decision === "error") return "destructive"
  return decision === "allow" ? "outline" : "secondary"
}

export function WardenOverviewPage() {
  const stats = useQuery<OverviewStats>("overview.stats")
  const recent = useQuery<RecentChecks>("overview.recentChecks", { limit: 10 })

  const columns: Column<CheckSummary>[] = [
    {
      id: "subject",
      header: "Subject",
      cell: (c) => `${c.subjectKind}:${c.subjectId}`,
      className: "font-medium",
    },
    { id: "action", header: "Action", cell: (c) => c.action },
    {
      id: "resource",
      header: "Resource",
      cell: (c) => (
        <span className="font-mono text-xs">
          {c.resourceType}:{c.resourceId}
        </span>
      ),
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (c) => <NamespaceCell path={c.namespacePath} />,
    },
    {
      id: "decision",
      header: "Decision",
      cell: (c) => <Badge variant={decisionVariant(c.decision)}>{c.decision}</Badge>,
    },
    {
      id: "cached",
      header: "Cached",
      // A cached row is the most common real answer to "why did my
      // permission change not take effect", and nothing surfaced it before.
      cell: (c) => (c.cached ? <Badge variant="secondary">cached</Badge> : null),
    },
    {
      id: "createdAt",
      header: "When",
      cell: (c) => <Timestamp value={c.createdAt} label="checked at" />,
    },
  ]

  return (
    <section className="flex flex-col gap-6">
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
              emptyMessage="No checks have been recorded yet."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
