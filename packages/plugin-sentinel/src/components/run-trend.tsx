import { Suspense, lazy } from "react"
import type { ReactNode } from "react"
import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ChartFrame } from "../charts/chart-frame"
import { formatCost, formatScore, measuredDimensions, plural, runPath, shortRunId } from "../format"
import type { Trend, TrendPoint } from "../types"
import { SettledBoundary } from "./settled-boundary"

/** In place of a chart whose chunk would not load. */
function ChartUnavailable() {
  return (
    <p className="text-sm text-muted-foreground">
      The chart could not load. The table beside it has the same numbers.
    </p>
  )
}

// Lazy: both charts bring Recharts, and the suite page is eager, in the
// shell's entry chunk. A static import from here would put Recharts there
// too (BASELINE.md, "Chronicle, and recharts off the entry"). A chunk that
// will not load (a deploy replaced it, the network dropped) costs the chart,
// not the page.
const TrendChart = lazy(() => import("../charts/trend-chart").catch(() => ({ default: ChartUnavailable })))
const DimensionTrends = lazy(() => import("../charts/dimension-trends").catch(() => ({ default: ChartUnavailable })))

function LoadingChart({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading the chart.
        </p>
      }
    >
      {children}
    </Suspense>
  )
}

const trendColumns: Column<TrendPoint>[] = [
  {
    id: "run",
    header: "Run",
    className: "font-mono text-xs font-medium",
    cell: (p) => <PluginLink to={runPath(p.runId)}>{shortRunId(p.runId)}</PluginLink>,
  },
  { id: "started", header: "Started", cell: (p) => <Timestamp value={p.createdAt} label="start time" /> },
  { id: "passRate", header: "Pass rate", align: "end", className: "tabular-nums", cell: (p) => formatScore(p.passRate) },
  { id: "avgScore", header: "Avg score", align: "end", className: "tabular-nums", cell: (p) => formatScore(p.avgScore) },
  { id: "cost", header: "Cost reported", align: "end", className: "tabular-nums", cell: (p) => formatCost(p.totalCost) },
]

function dimensionColumns(points: TrendPoint[]): Column<TrendPoint>[] {
  return [
    trendColumns[0],
    ...measuredDimensions(points).map(
      (dim): Column<TrendPoint> => ({
        id: dim,
        header: dim,
        align: "end",
        className: "tabular-nums",
        cell: (p) => {
          const v = p.dimensionScores[dim]
          return v === undefined ? <NoneCell label={`${dim} score`} /> : formatScore(v)
        },
      }),
    ),
  ]
}

/**
 * A suite's completed runs over time: pass rate against the current baseline,
 * then each dimension on its own. It needs two runs to be a trend.
 */
export function RunTrend({ suiteId }: { suiteId: string }) {
  const trend = useQuery<Trend>("runs.trend", { suiteId })
  const navigate = useNavigateTo()
  return (
    <SettledBoundary title="Trend" query={trend} skeletonRows={3}>
      {({ points, baseline }) => {
        if (points.length < 2) {
          return (
            <p className="text-sm text-muted-foreground">
              {points.length === 0
                ? "No completed run yet, so there is no trend."
                : "One completed run so far. The trend starts with the second."}
            </p>
          )
        }
        const caption = `${plural(points.length, "completed run", "completed runs")}, oldest first`
        return (
          <div className="flex flex-col gap-6">
            <ChartFrame
              title="Pass rate over runs"
              description={
                baseline
                  ? `The line across is "${baseline.name}", the current baseline, at ${formatScore(baseline.passRate)}. Each marker opens its run.`
                  : "This suite has no current baseline. Each marker opens its run."
              }
              table={
                <ResourceTable<TrendPoint>
                  columns={trendColumns}
                  rows={points}
                  rowKey={(p) => p.runId}
                  caption={caption}
                  emptyMessage="No completed runs."
                />
              }
            >
              <LoadingChart>
                <TrendChart points={points} baseline={baseline} onOpenRun={(id) => navigate(runPath(id))} />
              </LoadingChart>
            </ChartFrame>
            <ChartFrame
              title="Dimensions over runs"
              table={
                <ResourceTable<TrendPoint>
                  columns={dimensionColumns(points)}
                  rows={points}
                  rowKey={(p) => p.runId}
                  caption={caption}
                  emptyMessage="No completed runs."
                />
              }
            >
              <LoadingChart>
                <DimensionTrends points={points} />
              </LoadingChart>
            </ChartFrame>
          </div>
        )
      }}
    </SettledBoundary>
  )
}
