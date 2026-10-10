import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "../components/presentation"

interface InstalledPlugin {
  name: string
  settingCount: number
}

interface PluginsListResponse {
  plugins: InstalledPlugin[]
}

const columns: Column<InstalledPlugin>[] = [
  {
    id: "name",
    header: "Extension",
    cell: (plugin) => (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        <span className="font-mono text-xs font-medium">{plugin.name}</span>
        <span className="text-xs text-muted-foreground sm:hidden">
          {plugin.settingCount} settings
        </span>
      </span>
    ),
  },
  {
    id: "settings",
    header: "Registered settings",
    cell: (plugin) => plugin.settingCount,
    className: "hidden sm:table-cell",
  },
  {
    id: "configure",
    header: "Configure",
    cell: (plugin) =>
      plugin.settingCount > 0 ? (
        <PluginLink
          to={`/settings/${plugin.name}`}
          aria-label={`Open ${plugin.name} settings`}
          className="text-sm font-medium hover:underline"
        >
          Settings
        </PluginLink>
      ) : (
        <NoneCell label="settings" />
      ),
  },
]

export function AuthPluginsPage() {
  const query = useQuery<PluginsListResponse>("plugins.list")
  const [filter, setFilter] = useState("")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Extensions"
        description="Authsome plugins registered on this server and their configurable settings."
        actions={
          <Input
            aria-label="Filter extensions"
            placeholder="Filter extensions..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="w-56 max-w-full"
          />
        }
      />
      <QueryBoundary title="Extensions" query={query} skeletonRows={6}>
        {(data) => {
          const plugins = data.plugins ?? []
          const filtered = plugins.filter((plugin) =>
            plugin.name.toLowerCase().includes(filter.trim().toLowerCase())
          )
          return (
            <ResourceTable<InstalledPlugin>
              columns={columns}
              rows={filtered}
              rowKey={(plugin) => plugin.name}
              caption={
                filter
                  ? `${filtered.length} of ${plugins.length} extensions`
                  : `${plugins.length} ${plugins.length === 1 ? "extension" : "extensions"}`
              }
              emptyMessage={
                filter
                  ? "No extensions match this filter."
                  : "No Authsome extensions registered."
              }
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
