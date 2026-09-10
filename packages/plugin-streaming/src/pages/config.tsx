import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  DescriptionList,
  type DescriptionItem,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"

/** From `ConfigSummary` in types.go. The three maps are deliberately open. */
export interface ConfigSummary {
  backendType?: string
  distributed: boolean
  nodeID?: string
  features: Record<string, unknown>
  limits: Record<string, unknown>
  timeouts: Record<string, unknown>
}

/**
 * Renders whatever keys a map happens to hold, sorted so the order does not
 * shift between reads.
 *
 * Iterating rather than hand-listing is the whole point. The server adds a
 * limit or a feature flag whenever it likes, and a page that named its fields
 * would drop the new one silently, which is precisely the failure a
 * configuration page exists to prevent.
 */
function OpenMap({ title, values }: { title: string; values: Record<string, unknown> }) {
  const entries = Object.entries(values ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {entries.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} configured.`} />
      ) : (
        <DescriptionList
          items={entries.map(
            ([key, value]): DescriptionItem => ({
              term: key,
              // Objects and arrays print as JSON rather than "[object Object]",
              // which tells an operator nothing about what the server sent.
              value:
                typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value),
            }),
          )}
        />
      )}
    </section>
  )
}

export function StreamingConfigPage() {
  const query = useQuery<ConfigSummary>("config")

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Configuration" description="How this streaming node is set up." />
      <QueryBoundary title="Configuration" query={query} skeletonRows={3}>
        {(config) => (
          <>
            <DescriptionList
              items={[
                {
                  term: "Backend",
                  value: config.backendType || <NoneCell label="backend type" />,
                },
                { term: "Distributed", value: config.distributed ? "yes" : "no" },
                {
                  term: "Node",
                  value: config.nodeID ? (
                    <span className="font-mono text-xs">{config.nodeID}</span>
                  ) : (
                    <NoneCell label="node ID" />
                  ),
                },
              ]}
            />
            <OpenMap title="Features" values={config.features} />
            <OpenMap title="Limits" values={config.limits} />
            <OpenMap title="Timeouts" values={config.timeouts} />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
