import {
  PluginLink,
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
  const valid = validID(params.id, "tenant")
  const query = useQuery<Tenant>(
    "tenants.get",
    { id: params.id },
    { enabled: valid }
  )
  if (!valid || query.error?.code === "NOT_FOUND")
    return (
      <Empty
        title={valid ? "Tenant not found" : "Invalid tenant address"}
        body="Choose a customer from the tenant list."
        action={<PluginLink to="/tenants">View tenants</PluginLink>}
      />
    )
  return (
    <QueryBoundary title="Tenant" query={query} keepPreviousData>
      {(tenant) => <TenantEditor key={tenant.id} tenant={tenant} />}
    </QueryBoundary>
  )
}
