import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import {
  count,
  Empty,
  Facts,
  Notice,
  PostureStrip,
  rate,
  Refresh,
  Section,
} from "../components/read"
import type { Gateway } from "../types"

export function GatewayPage() {
  const query = useQuery<Gateway>("gateway.get")
  return (
    <div className="space-y-3">
      <PageHeader
        title="Gateway"
        description="Effective pipeline and enforcement limits."
        actions={<Refresh onClick={query.refetch} />}
      />
      <QueryBoundary title="Gateway" query={query}>
        {(data) => (
          <>
            <PostureStrip value={data.posture} />
            <Section title="Pipeline">
              {!data.stagesAvailable ? (
                <Empty
                  title="Pipeline inspection unavailable"
                  body="This custom pipeline does not expose its stages. Add pipeline.Inspector to inspect execution order."
                  action={<Refresh onClick={query.refetch} />}
                />
              ) : !data.stages.length ? (
                <Empty
                  title="No pipeline stages"
                  body="Configure stages in the gateway and refresh this view."
                  action={<Refresh onClick={query.refetch} />}
                />
              ) : (
                <ol className="flex flex-wrap gap-2">
                  {data.stages.map((stage, index) => (
                    <li
                      key={`${stage.name}-${index}`}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      {stage.name}
                      <span className="text-xs text-muted-foreground">
                        {stage.priority}
                      </span>
                      {stage.terminal && (
                        <Badge variant="secondary">terminal</Badge>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Routing">
                <Facts
                  items={[{ label: "Strategy", value: data.routingStrategy }]}
                />
                {data.routingCaveats.map((text) => (
                  <Notice key={text}>{text}</Notice>
                ))}
              </Section>
              <Section title="Cache">
                <Facts
                  items={[
                    { label: "Completion", value: data.cache.kind },
                    { label: "Streaming", value: data.cache.streamKind },
                    { label: "Hits", value: count(data.cache.hits) },
                    { label: "Misses", value: count(data.cache.misses) },
                    { label: "Hit rate", value: rate(data.cache.hitRate) },
                    {
                      label: "Entries",
                      value:
                        data.cache.size === null
                          ? "Not tracked"
                          : count(data.cache.size),
                    },
                    {
                      label: "Bytes",
                      value:
                        data.cache.bytes === null
                          ? "Not tracked"
                          : count(data.cache.bytes),
                    },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  {data.cache.statsScope}
                </p>
              </Section>
            </div>
            <Section title="Guards">
              {data.guards.length ? (
                <ResourceTable
                  density="compact"
                  rows={data.guards}
                  rowKey={(g) => `${g.name}:${g.phase}`}
                  emptyMessage="No guards"
                  columns={[
                    { id: "name", header: "Guard", cell: (g) => g.name },
                    { id: "phase", header: "Phase", cell: (g) => g.phase },
                  ]}
                />
              ) : (
                <Empty
                  title="No guards configured"
                  body="Register guards in your gateway configuration to inspect them here."
                  action={<Refresh onClick={query.refetch} />}
                />
              )}
              {data.guardCaveats.map((text) => (
                <Notice key={text}>{text}</Notice>
              ))}
            </Section>
            <Section title="Aliases">
              {data.aliases.length ? (
                <ResourceTable
                  density="compact"
                  rows={data.aliases}
                  rowKey={(a) => a.name}
                  emptyMessage="No aliases"
                  columns={[
                    { id: "name", header: "Alias", cell: (a) => a.name },
                    {
                      id: "targets",
                      header: "Targets",
                      cell: (a) =>
                        a.targets
                          .map((t) => `${t.provider}/${t.model} (${t.weight})`)
                          .join(", "),
                    },
                    {
                      id: "overrides",
                      header: "Tenant overrides",
                      cell: (a) =>
                        Object.entries(a.tenantOverrides)
                          .map(
                            ([id, targets]) =>
                              `${id}: ${targets.map((t) => `${t.provider}/${t.model} (${t.weight})`).join(", ")}`
                          )
                          .join("; ") || "None",
                    },
                  ]}
                />
              ) : (
                <Empty
                  title="No aliases configured"
                  body="Register a model alias to route a stable model name to providers."
                  action={<Refresh onClick={query.refetch} />}
                />
              )}
            </Section>
            <Section title="Transforms">
              {data.transforms.length ? (
                <ResourceTable
                  density="compact"
                  rows={data.transforms}
                  rowKey={(t) => `${t.name}:${t.phase}`}
                  emptyMessage="No transforms"
                  columns={[
                    { id: "name", header: "Transform", cell: (t) => t.name },
                    { id: "phase", header: "Phase", cell: (t) => t.phase },
                    {
                      id: "stream",
                      header: "Streaming",
                      cell: (t) =>
                        t.streaming ? "Supported" : "Not supported",
                    },
                  ]}
                />
              ) : (
                <Empty
                  title="No transforms configured"
                  body="Register request or response transforms in the gateway."
                  action={<Refresh onClick={query.refetch} />}
                />
              )}
            </Section>
            <Section title="Enforcement limits">
              {data.enforcementCaveats.map((text) => (
                <Notice key={text}>{text}</Notice>
              ))}
            </Section>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
