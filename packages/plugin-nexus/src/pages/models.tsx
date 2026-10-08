import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Money } from "../components/money"
import { count, Empty, Refresh, Section } from "../components/read"
import type { Capabilities, Model, Providers } from "../types"

function CapabilitiesCell({ value }: { value: Capabilities }) {
  return (
    <div className="flex max-w-72 flex-wrap gap-1">
      {Object.entries(value)
        .filter(([, on]) => on)
        .map(([name]) => (
          <Badge key={name} variant="secondary">
            {name.replace(/([A-Z])/g, " $1").toLowerCase()}
          </Badge>
        ))}
    </div>
  )
}
export function ModelsPage() {
  const models = useQuery<{ items: Model[] }>("models.list")
  const providers = useQuery<Providers>("providers.list")
  const refresh = () => {
    models.refetch()
    providers.refetch()
  }
  return (
    <div className="space-y-3">
      <PageHeader
        title="Models and providers"
        description="Registered capabilities and USD prices per million tokens."
        actions={<Refresh onClick={refresh} />}
      />
      <QueryBoundary title="Model catalog" query={models}>
        {(data) =>
          data.items.length ? (
            <ResourceTable
              density="compact"
              rows={data.items}
              rowKey={(m) => `${m.provider}/${m.id}`}
              emptyMessage="No registered models"
              columns={[
                {
                  id: "model",
                  header: "Model",
                  cell: (m) => (
                    <div>
                      <span className="font-medium">{m.name || m.id}</span>
                      <p className="text-xs text-muted-foreground">
                        {m.provider} / {m.id}
                      </p>
                    </div>
                  ),
                },
                {
                  id: "pricing",
                  header: "Pricing",
                  cell: (m) => (
                    <Badge
                      variant={
                        m.free ? "secondary" : m.priced ? "outline" : "default"
                      }
                    >
                      {m.free ? "Free" : m.priced ? "Priced" : "Unpriced"}
                    </Badge>
                  ),
                },
                {
                  id: "input",
                  header: "Input / 1M",
                  align: "end",
                  cell: (m) => (
                    <Money
                      value={m.inputPerMillionUsd}
                      unavailable="Unpriced"
                    />
                  ),
                },
                {
                  id: "output",
                  header: "Output / 1M",
                  align: "end",
                  cell: (m) => (
                    <Money
                      value={m.outputPerMillionUsd}
                      unavailable="Unpriced"
                    />
                  ),
                },
                {
                  id: "embedding",
                  header: "Embedding / 1M",
                  align: "end",
                  cell: (m) => (
                    <Money
                      value={m.embeddingPerMillionUsd}
                      unavailable="Unpriced"
                    />
                  ),
                },
                {
                  id: "limits",
                  header: "Context / output",
                  cell: (m) =>
                    `${count(m.contextWindow)} / ${count(m.maxOutput)}`,
                },
                {
                  id: "capabilities",
                  header: "Capabilities",
                  cell: (m) => <CapabilitiesCell value={m.capabilities} />,
                },
              ]}
            />
          ) : (
            <Empty
              title="No registered models"
              body="Register a provider with a model catalog, then refresh."
              action={
                <Button size="sm" variant="outline" onClick={models.refetch}>
                  Refresh catalog
                </Button>
              }
            />
          )
        }
      </QueryBoundary>
      <Section title="Providers">
        <QueryBoundary title="Providers" query={providers}>
          {(data) => (
            <>
              <p className="text-xs text-muted-foreground">
                Observed traffic · {data.from ?? "unknown start"} to{" "}
                {data.to ?? "unknown end"} ·{" "}
                {data.usageEnabled
                  ? "15-minute window"
                  : "usage collection disabled"}
              </p>
              {data.items.length ? (
                <ResourceTable
                  density="compact"
                  rows={data.items}
                  rowKey={(p) => p.name}
                  emptyMessage="No providers"
                  columns={[
                    { id: "name", header: "Provider", cell: (p) => p.name },
                    {
                      id: "models",
                      header: "Models",
                      cell: (p) => count(p.modelCount),
                    },
                    {
                      id: "requests",
                      header: "Requests",
                      cell: (p) => count(p.requests),
                    },
                    {
                      id: "errors",
                      header: "Errors",
                      cell: (p) => count(p.errors),
                    },
                    {
                      id: "capabilities",
                      header: "Capabilities",
                      cell: (p) => <CapabilitiesCell value={p.capabilities} />,
                    },
                  ]}
                />
              ) : (
                <Empty
                  title="No registered providers"
                  body="Register a provider in the gateway and refresh."
                  action={<Refresh onClick={providers.refetch} />}
                />
              )}
            </>
          )}
        </QueryBoundary>
      </Section>
    </div>
  )
}
