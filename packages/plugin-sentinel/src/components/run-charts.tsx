import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { DeltaBars, ScaleBars, type DeltaRow } from "../charts/bars"
import { ChartFrame } from "../charts/chart-frame"
import {
  DIMENSIONS,
  fellPast,
  formatDelta,
  formatScore,
  formatThreshold,
  orderDimensions,
  plural,
  resultPath,
} from "../format"
import type { BaselineDetail, Regression, Run, RunResults } from "../types"

interface CaseChange extends DeltaRow {
  caseName: string
  resultId: string
  was: number
  now: number
}

const changeColumns: Column<CaseChange>[] = [
  { id: "case", header: "Case", className: "font-medium", cell: (c) => c.label },
  { id: "was", header: "Baseline score", align: "end", className: "tabular-nums", cell: (c) => formatScore(c.was) },
  { id: "now", header: "This run", align: "end", className: "tabular-nums", cell: (c) => formatScore(c.now) },
  {
    id: "change",
    header: "Change",
    align: "end",
    className: "tabular-nums",
    cell: (c) => (c.regressed ? `${formatDelta(c.value)} regressed` : formatDelta(c.value)),
  },
]

const dimensionColumns: Column<{ dim: string; score: number }>[] = [
  { id: "dimension", header: "Dimension", className: "font-medium", cell: (d) => d.dim },
  { id: "score", header: "Score", align: "end", className: "tabular-nums", cell: (d) => formatScore(d.score) },
]

/**
 * The run's pictures: how each case moved against the baseline it was
 * compared with, and its dimension scores. Both have tables. Neither is drawn
 * for a run that has nothing to show yet; each says why instead.
 */
export function RunCharts({ runId, run, regression }: { runId: string; run: Run; regression: Regression }) {
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      {regression.state === "compared" && regression.baseline && regression.threshold !== undefined ? (
        <CaseChanges
          runId={runId}
          baselineId={regression.baseline.id}
          baselineName={regression.baseline.name}
          threshold={regression.threshold}
          missing={regression.missingCases.length}
        />
      ) : null}
      <DimensionScores run={run} />
    </div>
  )
}

function CaseChanges({
  runId,
  baselineId,
  baselineName,
  threshold,
  missing,
}: {
  runId: string
  baselineId: string
  baselineName: string
  threshold: number
  missing: number
}) {
  // The same reads the results section makes, so they come from one request.
  const results = useQuery<RunResults>("runs.results", { runId })
  const baseline = useQuery<BaselineDetail>("baselines.detail", { baselineId })
  if (!results.data || !baseline.data) {
    const error = results.error ?? baseline.error
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Change from baseline</h2>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{`The scores could not be read. ${error.message}`}</p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Reading the scores.
          </p>
        )}
      </section>
    )
  }
  const was = new Map(baseline.data.results.map((r) => [r.caseId, r.score]))
  const changes: CaseChange[] = results.data.items
    .flatMap((r) => {
      const old = was.get(r.caseId)
      if (old === undefined) return []
      const value = r.score - old
      return [
        {
          key: r.id,
          label: <PluginLink to={resultPath(runId, r.id)}>{r.caseName}</PluginLink>,
          caseName: r.caseName,
          resultId: r.id,
          value,
          regressed: fellPast(value, threshold),
          was: old,
          now: r.score,
        },
      ]
    })
    .sort((a, b) => a.value - b.value || a.caseName.localeCompare(b.caseName))
  const unmatched = results.data.items.length - changes.length
  const notes = [
    unmatched > 0 ? `${plural(unmatched, "case is", "cases are")} new since the baseline and not compared` : null,
    missing > 0 ? `${plural(missing, "case", "cases")} the baseline scored ${missing === 1 ? "is" : "are"} missing from this run` : null,
  ].filter((n): n is string => n !== null)
  return (
    <ChartFrame
      title="Change from baseline"
      description={`Each case's score against "${baselineName}", worst first. A case regresses when it falls more than ${formatThreshold(threshold)} below.`}
      table={
        <ResourceTable<CaseChange>
          columns={changeColumns}
          rows={changes}
          rowKey={(c) => c.key}
          caption={`${plural(changes.length, "case", "cases")} compared, worst first`}
          emptyMessage="No case was scored by both this run and the baseline."
        />
      }
    >
      <div className="flex flex-col gap-2">
        {changes.length > 0 ? (
          <DeltaBars rows={changes} threshold={threshold} label="Change from baseline, by case" />
        ) : (
          <p className="text-sm text-muted-foreground">No case was scored by both this run and the baseline.</p>
        )}
        {notes.length > 0 && <p className="text-sm text-muted-foreground">{`${notes.join(". ")}.`}</p>}
      </div>
    </ChartFrame>
  )
}

function DimensionScores({ run }: { run: Run }) {
  const dims = orderDimensions(Object.keys(run.dimensionScores))
  const rows = dims.map((dim) => ({ dim, score: run.dimensionScores[dim] }))
  const unmeasured = DIMENSIONS.filter((d) => !dims.includes(d))
  const pass = run.settings.passThreshold
  const partial = run.state !== "completed"
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Dimension scores</h2>
        <p className="text-sm text-muted-foreground">
          {run.state === "running" ? "No dimension has been measured yet." : "This run measured no dimensions."}
        </p>
      </section>
    )
  }
  return (
    <ChartFrame
      title="Dimension scores"
      description={
        run.state === "running"
          ? "So far, from the cases scored."
          : partial
            ? "From the cases scored before the run stopped."
            : undefined
      }
      table={
        <ResourceTable<{ dim: string; score: number }>
          columns={dimensionColumns}
          rows={rows}
          rowKey={(d) => d.dim}
          caption={plural(rows.length, "dimension", "dimensions")}
          emptyMessage="No dimensions."
        />
      }
    >
      <div className="flex flex-col gap-2">
        {rows.length === 1 ? (
          // One bar is not a chart: say the number.
          <p className="text-sm">{`${rows[0].dim} ${formatScore(rows[0].score)}`}</p>
        ) : (
          <ScaleBars
            rows={rows.map((r) => ({ key: r.dim, label: r.dim, value: r.score, valueLabel: formatScore(r.score) }))}
            reference={pass === undefined ? undefined : { value: pass, label: `Pass threshold ${formatThreshold(pass)}` }}
            label="Dimension scores"
          />
        )}
        {unmeasured.length > 0 && (
          <p className="text-sm text-muted-foreground">{`Not measured: ${unmeasured.join(", ")}.`}</p>
        )}
      </div>
    </ChartFrame>
  )
}
