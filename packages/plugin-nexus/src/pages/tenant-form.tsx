import { useState } from "react"
import {
  PluginLink,
  usePluginClient,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TenantEditor } from "../components/tenant-editor"
import { Empty } from "../components/read"
import { validID } from "../format"
import type { Tenant } from "../types"
export function TenantCreatePage() {
  return <TenantEditor />
}
export function TenantEditPage({ params }: PluginPageProps) {
  const client = usePluginClient()
  const valid = validID(params.id, "tenant")
  const query = useQuery<Tenant>(
    "tenants.get",
    { id: params.id },
    { enabled: valid }
  )
  const [previous, setPrevious] = useState<{
    client: typeof client
    id: string | undefined
    data?: Tenant
  }>({ client, id: params.id })
  const same = previous.client === client && previous.id === params.id
  // A blank loading entry follows a host cache clear. Never retain data from
  // that context, or from a denied or missing resource.
  const cleared = query.loading && !query.data && !query.error
  const transient =
    query.error &&
    ["TRANSPORT", "UNAVAILABLE", "TIMEOUT", "INTERNAL"].includes(
      query.error.code
    ) &&
    !/HTTP (401|403)\b/.test(query.error.message)
  const data =
    valid && !cleared && (!query.error || transient)
      ? (query.data ?? (same ? previous.data : undefined))
      : undefined
  if (!same || previous.data !== data)
    setPrevious({ client, id: params.id, data })
  if (!valid || query.error?.code === "NOT_FOUND")
    return (
      <Empty
        title={valid ? "Tenant not found" : "Invalid tenant address"}
        body="Choose a customer from the tenant list."
        action={<PluginLink to="/tenants">View tenants</PluginLink>}
      />
    )
  return (
    <>
      {data ? (
        <div aria-busy={query.loading} className="space-y-3">
          {query.error && (
            <QueryBoundary title="Tenant refresh" query={query}>
              {() => null}
            </QueryBoundary>
          )}
          <TenantEditor key={data.id} tenant={data} />
        </div>
      ) : (
        <QueryBoundary title="Tenant" query={query}>
          {() => null}
        </QueryBoundary>
      )}
    </>
  )
}
