import {
  PluginLink,
  useQuery,
  usePluginClient,
  queryStore,
} from "@forge-go/dashboard-plugin"
import { ActivityIcon } from "@forge-go/dashboard-kit/icons"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Progress } from "@forge-go/dashboard-kit/components/progress"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Page, Properties, Status, formatDuration } from "./components"
import { ServicesTable } from "./services"
import { AuditTable } from "./observability"
import type { Overview } from "./types"

function ApplicationHealth({ data }: { data: Overview }) {
  return (
    <>
      <ActivityIcon className="size-4 text-muted-foreground" />
      <span>Application health</span>
      <Status value={data.overallHealth} />
      <Button
        variant="link"
        size="sm"
        nativeButton={false}
        role="link"
        render={
          <PluginLink to="/services">
            {data.healthyServices} of {data.totalServices} services healthy
          </PluginLink>
        }
      >
        {data.healthyServices} of {data.totalServices} services healthy
      </Button>
    </>
  )
}

export function OverviewPage() {
  const client = usePluginClient()
  const query = useQuery<Overview>("overview")
  return (
    <Page
      title="Overview"
      description="The health and performance of your application, at a glance."
      meta={query.data ? <ApplicationHealth data={query.data} /> : undefined}
      refresh={() =>
        queryStore.invalidate(client.extension, [
          "overview",
          "services.list",
          "audit.list",
        ])
      }
      busy={query.loading}
      data={query.data}
    >
      <QueryBoundary title="Overview" query={query}>
        {(data) => (
          <>
            <StatGrid
              items={[
                {
                  label: "Services",
                  value: data.totalServices,
                  hint: "Registered with the application",
                },
                {
                  label: "Healthy services",
                  value: data.healthyServices,
                  hint: "Latest health check",
                },
                {
                  label: "Metrics",
                  value: data.totalMetrics,
                  hint: "Registered instruments",
                },
                {
                  label: "Uptime",
                  value: formatDuration(data.uptimeSeconds),
                  hint: "Since the application started",
                },
              ]}
            />
            <div className="grid min-w-0 gap-4 @3xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <ServicesTable compact />
              <Section
                title="System health"
                description="Current application snapshot"
                inset
              >
                <div className="space-y-4 pb-4">
                  <div className="font-sans text-2xl font-medium tracking-tight">
                    {data.totalServices > 0
                      ? `${Math.round((data.healthyServices / data.totalServices) * 100)}%`
                      : "No services"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Services currently healthy
                  </p>
                  <Progress
                    value={
                      data.totalServices > 0
                        ? (data.healthyServices / data.totalServices) * 100
                        : 0
                    }
                    aria-label="Healthy services"
                  />
                </div>
                <Properties
                  values={{
                    Version: data.version,
                    Environment: data.environment,
                    Uptime: formatDuration(data.uptimeSeconds),
                  }}
                />
              </Section>
            </div>
          </>
        )}
      </QueryBoundary>
      <AuditTable compact />
    </Page>
  )
}
