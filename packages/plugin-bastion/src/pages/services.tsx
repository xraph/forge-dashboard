import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { HealthBadge } from "../badges"
import { RefreshDiscovery } from "../components/refresh-discovery"
import type { ServiceView, ServicesList } from "../types"

const columns: Column<ServiceView>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-mono text-xs font-medium",
    cell: (s) => s.name,
  },
  {
    id: "version",
    header: "Version",
    className: "font-mono text-xs",
    cell: (s) => s.version || <NoneCell label="version" />,
  },
  {
    id: "address",
    header: "Address",
    className: "font-mono text-xs",
    cell: (s) => `${s.address}:${s.port}`,
  },
  {
    id: "protocols",
    header: "Protocols",
    cell: (s) => <TagList values={s.protocols ?? []} label="protocols" />,
  },
  {
    id: "health",
    header: "Health",
    cell: (s) => <HealthBadge healthy={s.healthy} />,
  },
  { id: "routes", header: "Routes", align: "end", cell: (s) => s.routeCount },
  {
    id: "discovered",
    header: "Discovered",
    cell: (s) => (
      <Timestamp value={s.discoveredAt ?? undefined} label="discovery time" />
    ),
  },
  {
    id: "metadata",
    header: "Metadata",
    cell: (s) => <TagList values={s.metadataKeys ?? []} label="metadata" />,
  },
]

export const BastionServicesPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<ServicesList>("services.list")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Services"
        description="Services discovery found, and how many routes it built for each."
        actions={<RefreshDiscovery />}
      />
      <QueryBoundary title="Services" query={list} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ServiceView>
            columns={columns}
            rows={data.services}
            rowKey={(s) => s.name}
            caption={`${data.total} ${data.total === 1 ? "service" : "services"}`}
            emptyMessage={
              data.discoveryEnabled
                ? "Discovery found no services. Services appear here once they register over FARP or are found by a scan."
                : "Discovery is switched off in the gateway config, so no services are found."
            }
          />
        )}
      </QueryBoundary>
    </section>
  )
}
