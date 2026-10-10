import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { HealthBadge } from "../badges"
import { formatCount } from "../format"
import type { OpenAPISummary, SpecView } from "../types"

const columns: Column<SpecView>[] = [
  {
    id: "service",
    header: "Service",
    className: "font-mono text-xs font-medium",
    cell: (s) => s.serviceName,
  },
  {
    id: "version",
    header: "Version",
    className: "font-mono text-xs",
    cell: (s) => s.version || <NoneCell label="version" />,
  },
  {
    id: "spec",
    header: "Spec URL",
    className: "font-mono text-xs",
    cell: (s) => s.specUrl,
  },
  {
    id: "health",
    header: "Health",
    cell: (s) => <HealthBadge healthy={s.healthy} />,
  },
  {
    id: "paths",
    header: "Paths",
    align: "end",
    cell: (s) => formatCount(s.pathCount),
  },
  {
    id: "error",
    header: "Error",
    cell: (s) =>
      s.error ? (
        <span className="text-xs text-destructive">{s.error}</span>
      ) : (
        <NoneCell label="error" />
      ),
  },
  {
    id: "fetched",
    header: "Fetched",
    cell: (s) => (
      <Timestamp value={s.fetchedAt ?? undefined} label="fetch time" />
    ),
  },
]

export const BastionApiExplorerPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<OpenAPISummary>("openapi.summary")
  const refresh = useCommand<{ started: boolean }>("openapi.refresh")
  const [started, setStarted] = useState(false)

  async function run() {
    setStarted(false)
    const r = await refresh.execute()
    if (r !== undefined) setStarted(true)
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="API explorer"
        description="The OpenAPI document bastion merges from the services it routes to."
      />
      <QueryBoundary title="API explorer" query={query} skeletonRows={4}>
        {(s) => {
          if (!s.enabled) {
            return (
              <p role="status" className="text-sm text-muted-foreground">
                OpenAPI aggregation is switched off in the gateway config.
              </p>
            )
          }
          if (!s.running) {
            return (
              <p role="status" className="text-sm text-muted-foreground">
                OpenAPI aggregation is configured but has not started on this
                gateway.
              </p>
            )
          }
          return (
            <>
              <StatGrid
                items={[
                  { label: "Paths", value: formatCount(s.totalPaths) },
                  { label: "Services", value: s.total },
                  {
                    label: "Healthy",
                    value: `${s.services.filter((x) => x.healthy).length} of ${s.total}`,
                  },
                  {
                    label: "Last refresh",
                    value: s.lastRefresh
                      ? new Date(s.lastRefresh).toLocaleString()
                      : "Never",
                  },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={s.specPath}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline"
                >
                  Open the merged spec
                </a>
                <IconButton
                  variant="outline"
                  disabled={refresh.loading}
                  onClick={() => void run()}
                  label={refresh.loading ? "Refreshing…" : "Refresh specs"}
                />
              </div>
              <CommandAlert
                title="Could not refresh specs"
                error={refresh.error}
              />
              {started ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Refresh started. Specs update in the background, so check back
                  in a moment.
                </p>
              ) : null}
              <ResourceTable<SpecView>
                columns={columns}
                rows={s.services}
                rowKey={(x) => x.serviceName}
                caption={`${s.total} ${s.total === 1 ? "service" : "services"}`}
                emptyMessage="No service publishes an OpenAPI document yet."
              />
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
