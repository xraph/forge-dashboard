import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { LlmBadge, NeedsConfigBadge } from "../badges"
import { formatThreshold, plural } from "../format"
import type { ScorerInfo, SentinelConfig, TargetInfo } from "../types"

const targetColumns: Column<TargetInfo>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-mono text-xs font-medium",
    cell: (t) => t.name,
  },
  {
    id: "description",
    header: "Description",
    cell: (t) => t.description || <NoneCell label="description" />,
  },
]

const scorerColumns: Column<ScorerInfo>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-mono text-xs font-medium",
    cell: (s) => s.name,
  },
  {
    id: "description",
    header: "Description",
    cell: (s) => s.description || <NoneCell label="description" />,
  },
  {
    id: "dimension",
    header: "Dimension",
    className: "font-mono text-xs",
    cell: (s) => s.dimension || <NoneCell label="dimension" />,
  },
  {
    id: "llm",
    header: "Calls an LLM",
    cell: (s) =>
      s.usesLlm ? (
        <LlmBadge />
      ) : (
        <span className="text-muted-foreground">No</span>
      ),
  },
  {
    id: "config",
    header: "Needs config",
    cell: (s) =>
      s.requiresConfig ? (
        <NeedsConfigBadge />
      ) : (
        <span className="text-muted-foreground">No</span>
      ),
  },
]

/**
 * What this deployment's engine runs with: the effective configuration, the
 * targets a run can call and the scorers that can judge it. All of it comes
 * from config.get, which answers what the engine was built with, not the
 * package defaults.
 */
export const SetupPage: ComponentType<PluginPageProps> = () => {
  const config = useQuery<SentinelConfig>("config.get")
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Setup"
        description="The configuration this engine runs with, the targets a run can call, and the scorers that can judge one."
      />
      <QueryBoundary title="Setup" query={config} skeletonRows={6}>
        {(data) => (
          <div className="flex flex-col gap-6">
            {data.targets.length === 0 && <NoTargetNotice />}
            <section aria-labelledby="sentinel-setup-config" className="flex flex-col gap-2">
              <h2 id="sentinel-setup-config" className="text-sm font-medium">
                Engine configuration
              </h2>
              <DescriptionList
                items={[
                  {
                    term: "Default model",
                    value: <span className="font-mono text-xs">{data.defaultModel}</span>,
                  },
                  { term: "Temperature", value: String(data.temperature) },
                  { term: "Pass threshold", value: formatThreshold(data.passThreshold) },
                  {
                    term: "Regression threshold",
                    value: formatThreshold(data.regressionThreshold),
                  },
                  { term: "Concurrency", value: String(data.concurrency) },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                A run records these when it starts, so changing them later does
                not change how a finished run was scored.
              </p>
            </section>
            <section aria-labelledby="sentinel-setup-targets" className="flex flex-col gap-2">
              <h2 id="sentinel-setup-targets" className="text-sm font-medium">
                Targets
              </h2>
              <ResourceTable<TargetInfo>
                columns={targetColumns}
                rows={data.targets}
                rowKey={(t) => t.name}
                caption={plural(data.targets.length, "target", "targets")}
                emptyMessage="No targets registered."
              />
            </section>
            <section aria-labelledby="sentinel-setup-scorers" className="flex flex-col gap-2">
              <h2 id="sentinel-setup-scorers" className="text-sm font-medium">
                Scorers
              </h2>
              <ResourceTable<ScorerInfo>
                columns={scorerColumns}
                rows={data.scorers}
                rowKey={(s) => s.name}
                caption={plural(data.scorers.length, "scorer", "scorers")}
                emptyMessage="No scorers registered."
              />
              <p className="text-xs text-muted-foreground">
                A scorer that needs config can only be attached to a case, with
                its settings. A run's own scorers are built without any.
              </p>
            </section>
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}

/** Shown when the engine has no target: no run can start until one exists. */
function NoTargetNotice() {
  return (
    <div role="note" className="flex flex-col gap-1 rounded-md border px-4 py-3 text-sm">
      <span className="font-medium">No target is registered, so no run can start.</span>
      <span className="text-muted-foreground">
        A target is what a run sends each case to. Register one in your
        application with the sentinel extension option{" "}
        <span className="font-mono text-xs text-foreground">
          WithTarget(name, description, target)
        </span>
        , then restart it.
      </span>
    </div>
  )
}
