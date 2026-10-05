import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { EnabledBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { credentialSummary, plural } from "../format"
import { providerPath } from "../keys"
import type { ProviderSummary, ProvidersListResponse } from "../wire"

function NewProviderLink() {
  return (
    <PluginLink to="/new-provider" className={buttonVariants()}>
      New provider
    </PluginLink>
  )
}

const columns: Column<ProviderSummary>[] = [
  { id: "name", header: "Name", className: "font-medium", cell: (p) => <PluginLink to={providerPath(p.id)}>{p.name}</PluginLink> },
  { id: "channel", header: "Channel", cell: (p) => p.channel },
  { id: "driver", header: "Driver", className: "font-mono text-xs", cell: (p) => p.driver },
  { id: "priority", header: "Priority", align: "end", className: "font-mono text-xs", cell: (p) => String(p.priority) },
  { id: "credentials", header: "Credentials", cell: (p) => credentialSummary(p.credentials) ?? <NoneCell label="credentials" /> },
  { id: "status", header: "Status", cell: (p) => <EnabledBadge enabled={p.enabled} /> },
]

export const ProvidersPage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  const list = useQuery<ProvidersListResponse>("providers.list")
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader
        title="Providers"
        description="The services Herald hands messages to. Credentials are write-only: you can set and replace them here, never read them back."
        actions={<NewProviderLink />}
      />
      {info.data && !info.data.encryption.configured && (
        <Alert>
          <AlertTitle>Credentials are stored unencrypted</AlertTitle>
          <AlertDescription>
            No credential key is configured. Set <span className="font-mono text-xs">credentials_key</span> in the herald extension config, then encrypt the stored values from the overview.
          </AlertDescription>
        </Alert>
      )}
      <QueryBoundary title="Providers" query={list} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ProviderSummary>
            columns={columns}
            rows={data.providers}
            rowKey={(p) => p.id}
            caption={plural(data.providers.length, "provider")}
            emptyMessage="No providers yet. Add one so Herald has somewhere to send."
            emptyAction={<NewProviderLink />}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
