import type { ComponentType } from "react"
import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { EMPTY_ROUTE, RouteForm } from "../components/route-form"
import { routePath } from "../keys"
import type { RouteFields, RouteIdResponse } from "../types"

export const BastionRouteCreatePage: ComponentType<PluginPageProps> = () => {
  const create = useCommand<RouteIdResponse>("routes.create")
  const navigateTo = useNavigateTo()

  async function submit(fields: RouteFields) {
    const result = await create.execute(fields)
    // execute resolves undefined only when the command failed.
    if (result === undefined) return
    navigateTo(routePath(result.id))
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="New route"
        description="A manual route. It stays until you delete it, and survives a restart only when the gateway has a route store."
      />
      <RouteForm
        initial={EMPTY_ROUTE}
        submitLabel="Create route"
        pendingLabel="Creating…"
        pending={create.loading}
        error={create.error}
        errorTitle="Could not create the route"
        cancelTo="/routes"
        onSubmit={(f) => void submit(f)}
      />
    </section>
  )
}
