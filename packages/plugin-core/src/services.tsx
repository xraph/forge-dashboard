import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@forge-go/dashboard-kit/components/sheet"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  Page,
  Panel,
  Properties,
  Records,
  Status,
  formatDuration,
} from "./components"
import type { Health, Service, ServiceDetail } from "./types"

function ServiceInspection({ name }: { name: string }) {
  const query = useQuery<ServiceDetail>("services.detail", { name })
  return (
    <QueryBoundary title="Service details" query={query}>
      {(data) => (
        <div className="space-y-6">
          <Properties
            values={{
              Type: data.type,
              Status: data.status,
              Uptime:
                data.uptime === undefined
                  ? undefined
                  : formatDuration(data.uptime / 1e9),
              "Last health check": data.last_health_check,
            }}
          />
          {data.health && (
            <Panel title="Health check">
              <Properties
                values={{
                  Status: data.health.status,
                  Message: data.health.message,
                  "Latency (ms)": data.health.duration / 1e6,
                  Critical: data.health.critical,
                }}
              />
            </Panel>
          )}
          <Panel title="Dependencies">
            <div className="flex flex-wrap gap-2 p-5">
              {data.dependencies?.length ? (
                data.dependencies.map((name) => (
                  <code className="rounded border px-2 py-1 text-xs" key={name}>
                    {name}
                  </code>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No dependencies reported.
                </p>
              )}
            </div>
          </Panel>
          <Panel title="Metrics">
            <Properties
              values={
                data.metrics && Object.keys(data.metrics).length
                  ? data.metrics
                  : { Metrics: "No metrics reported" }
              }
            />
          </Panel>
        </div>
      )}
    </QueryBoundary>
  )
}
export function ServicesTable({ compact = false }: { compact?: boolean }) {
  const query = useQuery<{ services: Service[] | null }>("services.list")
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <Panel
        title="Services"
        description="Registered application services"
        action={
          compact ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              role="link"
              render={<PluginLink to="/services">View all</PluginLink>}
            >
              View all
            </Button>
          ) : undefined
        }
      >
        <QueryBoundary title="Services" query={query}>
          {(data) => (
            <Records
              rows={
                compact
                  ? (data.services ?? []).slice(0, 6)
                  : (data.services ?? [])
              }
              rowKey={(row) => row.name}
              noun="services"
              searchText={
                compact
                  ? undefined
                  : (row) => `${row.name} ${row.type} ${row.status}`
              }
              columns={[
                {
                  label: "Service",
                  render: (row) => (
                    <Button
                      className="h-auto px-0 text-left font-mono text-xs"
                      variant="link"
                      onClick={() => setSelected(row.name)}
                    >
                      {row.name}
                    </Button>
                  ),
                },
                {
                  label: "Type",
                  render: (row) => (
                    <span className="text-muted-foreground">{row.type}</span>
                  ),
                },
                {
                  label: "Status",
                  render: (row) => <Status value={row.status} />,
                },
                ...(!compact
                  ? [
                      {
                        label: "Registered",
                        render: (row: Service) => (
                          <Timestamp
                            value={row.registered_at}
                            label="registration time"
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </QueryBoundary>
      </Panel>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{selected}</SheetTitle>
            <SheetDescription>
              Service health, dependencies, and runtime metrics.
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-6">
            {selected !== null && (
              <ServiceInspection key={selected} name={selected} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
export function ServicesPage() {
  const health = useQuery<Health>("health")
  const services = useQuery<{ services: Service[] | null }>("services.list")
  return (
    <Page
      title="Services & health"
      description="Inspect registered services and their latest health checks."
      refresh={() => {
        health.refetch()
        services.refetch()
      }}
      busy={health.loading || services.loading}
      data={
        health.data && services.data
          ? { health: health.data, services: services.data.services }
          : undefined
      }
    >
      <QueryBoundary title="Health checks" query={health}>
        {(data) => (
          <>
            <StatGrid
              items={[
                {
                  label: "Overall health",
                  value: data.overallStatus || "Unknown",
                },
                { label: "Health checks", value: data.total },
                { label: "Healthy", value: data.healthySummary },
                {
                  label: "Needs attention",
                  value: Math.max(0, data.total - data.healthySummary),
                },
              ]}
            />
            <Panel
              title="Health checks"
              description="Latest results, reported independently of the service registry"
            >
              <Records
                noun="health checks"
                rows={data.services ?? []}
                rowKey={(row) => row.name}
                columns={[
                  { label: "Check", render: (row) => <code>{row.name}</code> },
                  {
                    label: "Status",
                    render: (row) => <Status value={row.status} />,
                  },
                  {
                    label: "Latency",
                    render: (row) => <code>{row.durationMs} ms</code>,
                  },
                  {
                    label: "Critical",
                    render: (row) => (row.critical ? "Yes" : "No"),
                  },
                  {
                    label: "Message",
                    render: (row) => (
                      <span className="whitespace-normal text-muted-foreground">
                        {row.message || "No message"}
                      </span>
                    ),
                  },
                ]}
              />
            </Panel>
          </>
        )}
      </QueryBoundary>
      <ServicesTable />
    </Page>
  )
}
