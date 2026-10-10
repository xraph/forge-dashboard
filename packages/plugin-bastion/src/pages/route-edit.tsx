import type { ComponentType } from "react"
import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { RouteForm, valuesFromDetail } from "../components/route-form"
import { routePath } from "../keys"
import type { RouteDetail, RouteFields, RouteIdResponse } from "../types"

export const BastionRouteEditPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No route in the address, so there is nothing to edit.
      </p>
    )
  }
  return <RouteEditBody id={id} />
}

function RouteEditBody({ id }: { id: string }) {
  const detail = useQuery<RouteDetail>("routes.detail", { id })
  const update = useCommand<RouteIdResponse>("routes.update")
  const navigateTo = useNavigateTo()

  async function submit(fields: RouteFields) {
    const result = await update.execute({ id, ...fields })
    if (result === undefined) return
    navigateTo(routePath(id))
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <QueryBoundary title="Route" query={detail} skeletonRows={6}>
        {(d) =>
          !d.editable ? (
            <p role="status" className="text-sm text-muted-foreground">
              Discovery manages this route. Its next update replaces any change,
              so it cannot be edited here.
            </p>
          ) : (
            <>
              <PageHeader
                title={`Edit ${d.path}`}
                description={
                  d.config
                    ? "This route comes from the gateway's config file. A change made here lasts until the gateway restarts."
                    : "Headers, transforms and traffic policy are kept as they are; this form does not change them."
                }
              />
              <RouteForm
                initial={valuesFromDetail(d)}
                submitLabel="Save changes"
                pendingLabel="Saving…"
                pending={update.loading}
                error={update.error}
                errorTitle="Could not save the route"
                cancelTo={routePath(id)}
                onSubmit={(f) => void submit(f)}
              />
            </>
          )
        }
      </QueryBoundary>
    </section>
  )
}
