import { useQuery } from "@forge-go/dashboard-plugin"
import { RouteIcon } from "@forge-go/dashboard-kit/icons"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Page, Panel, Properties, Records } from "./components"
import type { Extension, Overview } from "./types"

export function ExtensionsPage() {
  const query = useQuery<{ extensions: Extension[] | null }>("extensions.list")
  return (
    <Page
      title="Extensions"
      description="Extensions registered with the application."
      refresh={query.refetch}
      busy={query.loading}
      data={query.data}
    >
      <QueryBoundary title="Extensions" query={query}>
        {(data) => (
          <Panel
            title="Installed extensions"
            description="Use the application switcher to open an available extension dashboard."
          >
            <Records
              noun="extensions"
              rows={data.extensions ?? []}
              rowKey={(row) => row.name}
              searchText={(row) =>
                `${row.name} ${row.displayName} ${row.description ?? ""}`
              }
              columns={[
                {
                  label: "Extension",
                  render: (row) => (
                    <div>
                      <span className="font-medium">
                        {row.displayName || row.name}
                      </span>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.name}
                      </div>
                    </div>
                  ),
                },
                {
                  label: "Version",
                  render: (row) => (
                    <Badge variant="outline" className="font-mono">
                      {row.version}
                    </Badge>
                  ),
                },
                {
                  label: "Description",
                  render: (row) => (
                    <span className="text-muted-foreground">
                      {row.description || "No description"}
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        )}
      </QueryBoundary>
    </Page>
  )
}
export function ConfigurationPage() {
  const query = useQuery<Overview>("overview")
  return (
    <Page
      title="Configuration"
      description="Inspect the application runtime and deployment information."
      refresh={query.refetch}
      busy={query.loading}
    >
      <QueryBoundary title="Configuration" query={query}>
        {(data) => (
          <Panel
            title="Application"
            description="Read-only deployment values"
            action={<Badge variant="outline">Read only</Badge>}
          >
            <Properties
              values={{ Version: data.version, Environment: data.environment }}
            />
            <div className="border-t px-5 py-4 text-sm text-muted-foreground">
              Configuration changes are managed in your application deployment.
              This server contract does not expose a configuration editor.
            </div>
          </Panel>
        )}
      </QueryBoundary>
    </Page>
  )
}
export function RoutesPage() {
  return (
    <Page
      title="Routes"
      description="Inspect the routes registered by your application."
    >
      <EmptyState
        icon={<RouteIcon />}
        title="Route inventory unavailable"
        description="This server contract does not expose registered routes. You can inspect recorded requests on the Traces page."
      />
    </Page>
  )
}
