import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { PolicyEditorDialog } from "../components/policy-editor-dialog"
import { formatDuration, policyPath } from "../format"
import { useLastKnown } from "../last-known"
import type { PoliciesList, PolicySummary } from "../types"

// policies.list has no total, so the page asks for as many as the pickers do
// and says when there were more.
const LIST_LIMIT = 200
const LIST_PARAMS = { limit: LIST_LIMIT }

const columns: Column<PolicySummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (p) => <PluginLink to={policyPath(p.id)}>{p.name}</PluginLink>,
  },
  {
    id: "maxLifetime",
    header: "Max lifetime",
    cell: (p) =>
      p.maxKeyLifetimeSeconds === null ? (
        <NoneCell label="maximum lifetime" />
      ) : (
        formatDuration(p.maxKeyLifetimeSeconds)
      ),
  },
  {
    id: "grace",
    header: "Grace",
    // No grace set is not "none": rotation then uses 24 hours.
    cell: (p) =>
      p.graceSeconds === null ? (
        <span className="text-muted-foreground">24 hours (default)</span>
      ) : (
        formatDuration(p.graceSeconds)
      ),
  },
  {
    id: "allowedScopes",
    header: "Allowed scopes",
    // An empty allow list is the widest policy there is, not an absence, so
    // it says so in words rather than as a dash.
    cell: (p) =>
      p.allowedScopes.length === 0 ? (
        <span className="text-muted-foreground">Any scope</span>
      ) : (
        <TagList values={p.allowedScopes} label="allowed scopes" />
      ),
  },
]

export const PoliciesPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<PoliciesList>("policies.list", LIST_PARAMS)
  const [creating, setCreating] = useState(false)
  // The editor says whether a rate limit is enforced here, and only the list
  // knows. A refetch that fails drops the list's data, so the page keeps the
  // last answer it saw. Before any answer, the editor says it does not know.
  const rateLimiterConfigured = useLastKnown(list.data?.rateLimiterConfigured)

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Policies"
        description="Rules attached to keys. Each field says whether Keysmith enforces it."
        actions={
          <Button onClick={() => setCreating(true)}>Create policy</Button>
        }
      />

      <QueryBoundary title="Policies" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.policies ?? []
          const caption = `${rows.length} ${rows.length === 1 ? "policy" : "policies"}`
          return (
            <div className="flex min-w-0 flex-col gap-1.5">
              <ResourceTable<PolicySummary>
                columns={columns}
                rows={rows}
                rowKey={(p) => p.id}
                caption={caption}
                emptyMessage="No policies yet."
              />
              {data.hasMore && (
                <p className="text-xs text-muted-foreground">
                  {`Showing the first ${LIST_LIMIT} policies.`}
                </p>
              )}
            </div>
          )
        }}
      </QueryBoundary>

      {/*
        Outside the boundary: it shows a skeleton on every refetch, and the
        editor and what was typed in it must survive one.
      */}
      <PolicyEditorDialog
        open={creating}
        onOpenChange={setCreating}
        rateLimiterConfigured={rateLimiterConfigured}
      />
    </section>
  )
}
