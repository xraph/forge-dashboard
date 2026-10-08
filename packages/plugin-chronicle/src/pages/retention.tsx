import { useState, type ComponentType } from "react"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { PolicyListResponse, PolicySummary } from "../types"
import { EnforceDialog } from "../components/enforce-dialog"
import { countOf, durationLabel } from "../format"
import { categoryLabel, policyScopeLabel } from "../policy"

export { categoryLabel, policyScopeLabel }

const columns: Column<PolicySummary>[] = [
  {
    id: "category",
    header: "Category",
    // A policy an app-wide operator manages is not the viewer's to open: the server answers it as read-only, so the row does not offer a way in.
    cell: (p) =>
      p.editable ? (
        <PluginLink
          to={`/retention/${encodeURIComponent(p.id)}`}
          className="underline underline-offset-4"
        >
          {categoryLabel(p.category)}
        </PluginLink>
      ) : (
        categoryLabel(p.category)
      ),
  },
  { id: "keeps", header: "Keeps for", cell: (p) => durationLabel(p.duration) },
  {
    id: "archive",
    header: "Archive",
    cell: (p) => (p.archive ? "Archived first" : "Not archived"),
  },
  { id: "scope", header: "Scope", cell: (p) => policyScopeLabel(p) },
  {
    id: "updated",
    header: "Updated",
    cell: (p) => <Timestamp value={p.updatedAt} label="update time" />,
  },
  {
    id: "managed",
    header: "Access",
    cell: (p) =>
      p.editable ? null : (
        <span className="text-muted-foreground">
          Managed by an app-wide operator
        </span>
      ),
  },
]

export const RetentionPage: ComponentType<PluginPageProps> = () => {
  const [enforcing, setEnforcing] = useState(false)
  const q = useQuery<PolicyListResponse>("retention.policies")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Retention"
        description="Retention permanently deletes audit events."
        actions={
          <>
            <PluginLink
              to="/new-policy"
              className={buttonVariants({ variant: "outline" })}
            >
              New policy
            </PluginLink>
            <Button onClick={() => setEnforcing(true)}>
              Run retention now
            </Button>
          </>
        }
      />
      <p className="max-w-prose text-sm">
        A policy removes events in its category once they are older than its
        duration. A category of * means every category, not a default: a short
        wildcard overrides a longer specific policy for its category.
      </p>
      <QueryBoundary title="retention policies" query={q} skeletonRows={5}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.policies}
            rowKey={(p) => p.id}
            caption={countOf(data.total, "policy", "policies")}
            emptyMessage="No retention policies: nothing is removed from this audit trail automatically."
          />
        )}
      </QueryBoundary>
      <EnforceDialog open={enforcing} onOpenChange={setEnforcing} />
    </section>
  )
}
