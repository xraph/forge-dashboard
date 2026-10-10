import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"
import { RUN_POLL_MS } from "../components/runs-list"
import { RunsTable } from "../components/runs-table"
import { SettledBoundary } from "../components/settled-boundary"
import { formatDelta, plural, runPath, shortRunId, suitePath } from "../format"
import type { Overview, RegressionSummary } from "../types"

const regressionColumns: Column<RegressionSummary>[] = [
  {
    id: "suite",
    header: "Suite",
    className: "font-medium",
    cell: (r) => (
      <PluginLink to={suitePath(r.suiteId)}>{r.suiteName}</PluginLink>
    ),
  },
  {
    id: "run",
    header: "Run",
    className: "font-mono text-xs",
    cell: (r) => (
      <PluginLink to={runPath(r.runId)}>{shortRunId(r.runId)}</PluginLink>
    ),
  },
  { id: "baseline", header: "Against baseline", cell: (r) => r.baseline.name },
  {
    id: "worst",
    // The server's worst delta: pass rate, average score, a dimension or a
    // case, whichever fell furthest. Not only a case's.
    header: "Worst drop",
    align: "end",
    className: "tabular-nums",
    // The destructive colour comes with the icon and the word, never alone.
    cell: (r) => (
      <span className="inline-flex items-center gap-1 text-destructive">
        <TriangleAlertIcon aria-hidden className="size-3.5" />
        {formatDelta(r.worstDelta)}
      </span>
    ),
  },
  {
    id: "started",
    header: "Started",
    cell: (r) => <Timestamp value={r.createdAt} label="start time" />,
  },
]

/**
 * / : what needs attention first (a missing target, runs in flight, recent
 * regressions), then the counts and the newest runs. Refreshed every three
 * seconds while a run is active and the tab is visible.
 */
export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const overview = useQuery<Overview>("overview.stats")
  const active = (overview.data?.activeRuns.length ?? 0) > 0
  usePoll(() => {
    if (active) overview.refetch()
  }, RUN_POLL_MS)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="Evaluation suites, their runs and how those runs compare with each suite's baseline."
      />
      <SettledBoundary title="Overview" query={overview} skeletonRows={6}>
        {(o) => (
          <div className="flex min-w-0 flex-col gap-4">
            {!o.targetsRegistered && (
              <section
                aria-label="No target"
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-l-4 border-l-foreground/30 px-4 py-3"
              >
                <p className="text-base font-medium">
                  No target is registered, so no run can start
                </p>
                <p className="text-sm text-muted-foreground">
                  {"A target is what a run sends each case to. "}
                  <PluginLink to="/setup">Setup</PluginLink>
                  {" shows how to register one."}
                </p>
              </section>
            )}
            <StatGrid
              items={[
                { label: "Suites", value: o.suiteCount },
                { label: "Cases", value: o.caseCount },
                { label: "Runs", value: o.runCount },
              ]}
            />
            {o.activeRuns.length > 0 && (
              <section
                aria-labelledby="sentinel-overview-active"
                className="flex min-w-0 flex-col gap-2"
              >
                <h2
                  id="sentinel-overview-active"
                  className="text-sm font-medium"
                >
                  Running now
                </h2>
                <RunsTable
                  runs={o.activeRuns}
                  showSuite
                  caption={`${plural(o.activeRuns.length, "run", "runs")} in flight`}
                  emptyMessage="No run is in flight."
                />
              </section>
            )}
            <section
              aria-labelledby="sentinel-overview-regressions"
              className="flex min-w-0 flex-col gap-2"
            >
              <h2
                id="sentinel-overview-regressions"
                className="text-sm font-medium"
              >
                Recent regressions
              </h2>
              <ResourceTable<RegressionSummary>
                columns={regressionColumns}
                rows={o.recentRegressions}
                rowKey={(r) => r.runId}
                caption={`${plural(o.recentRegressions.length, "regressed run", "regressed runs")} among the twenty newest completed`}
                emptyMessage="None of the twenty newest completed runs fell past its suite's threshold. Suites without a baseline are not compared."
              />
            </section>
            <section
              aria-labelledby="sentinel-overview-recent"
              className="flex min-w-0 flex-col gap-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id="sentinel-overview-recent"
                  className="text-sm font-medium"
                >
                  Recent runs
                </h2>
                <PluginLink to="/runs" className="text-sm">
                  Every run
                </PluginLink>
              </div>
              <RunsTable
                runs={o.recentRuns}
                showSuite
                caption={`${plural(o.recentRuns.length, "run", "runs")}, newest first`}
                emptyMessage="No runs yet. Start one from a suite's Runs tab."
              />
            </section>
          </div>
        )}
      </SettledBoundary>
    </section>
  )
}
