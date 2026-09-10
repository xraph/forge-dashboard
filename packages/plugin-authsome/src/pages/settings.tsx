import { PluginLink, PluginSlot, useQuery, useSlotCount } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"

/** One row of `settings.namespaces`. */
export interface NamespaceSummary {
  name: string
  displayName?: string
  description?: string
  settingCount: number
}

export interface NamespacesList {
  namespaces: NamespaceSummary[]
  context?: { appId?: string; orgId?: string; userId?: string }
}

const columns: Column<NamespaceSummary>[] = [
  {
    id: "namespace",
    header: "Namespace",
    cell: (n) => (
      <PluginLink
        to={`/@auth/settings/${n.name}`}
        className="font-medium underline underline-offset-4"
      >
        {n.displayName || n.name}
      </PluginLink>
    ),
  },
  {
    id: "description",
    header: "Description",
    cell: (n) => n.description || <NoneCell label="description" />,
  },
  {
    id: "settingCount",
    header: "Settings",
    cell: (n) => n.settingCount,
  },
]

/**
 * The settings namespace index.
 *
 * `settings.namespaces` needs no params and is not paged, so this is a plain
 * table: one row per namespace, linking through to `settings.namespace` for
 * the fields inside it. `settings.tabs` is where an installed sub-plugin adds
 * its own namespace entry - the heading above it is conditional because
 * `PluginSlot` renders nothing at all when nobody contributes, and a bare
 * heading over nothing is worse than no heading.
 */
export function AuthSettingsPage() {
  const list = useQuery<NamespacesList>("settings.namespaces")
  const contributed = useSlotCount("settings.tabs")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Settings" />

      <QueryBoundary title="Settings" query={list} skeletonRows={5}>
        {(data) => {
          const namespaces = data.namespaces ?? []
          const caption = `${namespaces.length} ${
            namespaces.length === 1 ? "namespace" : "namespaces"
          }`

          return (
            <ResourceTable<NamespaceSummary>
              columns={columns}
              rows={namespaces}
              rowKey={(n) => n.name}
              caption={caption}
              emptyMessage="No settings namespaces yet."
            />
          )
        }}
      </QueryBoundary>

      {contributed > 0 && (
        <h2 className="text-sm font-medium">From installed plugins</h2>
      )}
      <PluginSlot name="settings.tabs" />
    </section>
  )
}
