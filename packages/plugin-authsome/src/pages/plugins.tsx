import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import type { FeatureToggle, FeatureTogglesResponse } from "./features"

const columns: Column<FeatureToggle>[] = [
  { id: "label", header: "Feature", cell: (t) => t.label, className: "font-medium" },
  { id: "key", header: "Key", cell: (t) => t.key, className: "font-mono text-xs" },
  {
    id: "enabled",
    header: "Status",
    cell: (t) => (
      <Badge variant={t.enabled ? "outline" : "secondary"}>
        {t.enabled ? "on" : "off"}
      </Badge>
    ),
  },
]

/**
 * The page this plan cannot finish, and says so.
 *
 * The legacy templ dashboard listed all twenty-five installed authsome
 * plugins with their status. There is no intent that enumerates installed
 * plugins: the closest this contract offers is `auth.featureToggles`, which
 * covers nine sign-in features and nothing else. `geoip`, `scim`,
 * `riskengine` and the rest have no toggle at all, so there is nothing here
 * for a row about any of them to read.
 *
 * Rendering the nine and staying silent about the other sixteen would answer
 * "where did the rest of my plugins go" with nothing, which is exactly the
 * failure this package refuses to repeat for a disabled feature toggle. So
 * this page carries a visible, readable note instead of a code comment: a
 * `role="status"` element an operator actually encounters on screen, not
 * prose only another developer will ever see.
 */
export function AuthPluginsPage() {
  const query = useQuery<FeatureTogglesResponse>("auth.featureToggles")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Plugins" />

      <p
        role="status"
        className="rounded-md border px-3 py-2 text-sm text-muted-foreground"
      >
        These are the sign-in features this app can turn on, not the full list
        of installed plugins. The contract has no intent that enumerates
        installed plugins, so the rest are not shown here. See the retirement
        notes.
      </p>

      <QueryBoundary title="Plugins" query={query} skeletonRows={4}>
        {(data) => {
          const toggles = data.toggles ?? []
          return (
            <ResourceTable<FeatureToggle>
              columns={columns}
              rows={toggles}
              rowKey={(t) => t.key}
              caption={`${toggles.length} ${toggles.length === 1 ? "feature" : "features"}`}
              emptyMessage="No feature toggles reported."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
