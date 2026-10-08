import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "../components/presentation"

/** One entry of `apps.context`'s `availableApps`, matching `SwitcherApp`. */
interface PickerApp {
  id: string
  name: string
  slug: string
  isPlatform: boolean
}

interface AppsContextResponse {
  availableApps?: PickerApp[]
}

/**
 * The landing page for this plugin's own namespace root, rendered when no
 * app segment is in the URL yet.
 *
 * Rendered by the host's routed-scope picker, never reached through a route
 * this plugin declares itself: `APP_DIMENSION.routed.picker` in `index.tsx`
 * is what puts it here. It takes no props, the same as every other
 * `RoutedContext.picker`.
 *
 * Each row links straight to that app's users page. The link is written
 * scope-relative and WITH the app's own slug already in it
 * (`/acme/users`, not `/users`): there is no current app segment on this
 * page for the host's resolver to reuse, so the slug has to come from here,
 * the one place that knows which row was picked.
 */
export function AuthAppPicker() {
  const read = useQuery<AppsContextResponse>("apps.context")

  const columns: Column<PickerApp>[] = [
    {
      id: "name",
      header: "App",
      className: "font-medium",
      cell: (app) => (
        <PluginLink
          to={`/${app.slug}/users`}
          className="underline underline-offset-4"
        >
          {app.name}
        </PluginLink>
      ),
    },
    {
      id: "slug",
      header: "Slug",
      className: "font-mono text-xs",
      cell: (app) => app.slug,
    },
    {
      id: "platform",
      header: "Platform",
      cell: (app) => (
        <Badge variant={app.isPlatform ? "outline" : "secondary"}>
          {app.isPlatform ? "platform" : "app"}
        </Badge>
      ),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Choose an app"
        description="Pick an app to scope its users, roles, sessions and devices. Switching apps clears the current environment, and most of the rest of this dashboard keeps answering for the platform app regardless of what you pick here."
      />

      <QueryBoundary title="Apps" query={read} skeletonRows={5}>
        {(data) => {
          const apps = data.availableApps ?? []

          return (
            <ResourceTable<PickerApp>
              columns={columns}
              rows={apps}
              rowKey={(app) => app.id}
              caption={`${apps.length} ${apps.length === 1 ? "app" : "apps"}`}
              emptyMessage="No apps yet."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
