import { useEffect, useRef, useState } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { RedTeamBadge, ResultStatusBadge, ScorerVerdicts } from "../badges"
import {
  fellPast,
  formatCost,
  formatCount,
  formatDelta,
  formatLatency,
  formatScore,
  plural,
  resultPath,
} from "../format"
import type {
  BaselineDetail,
  ResultCounts,
  ResultRow,
  ResultStatus,
  RunResults,
} from "../types"
import { RUN_POLL_MS } from "./runs-list"
import { SettledBoundary } from "./settled-boundary"

const CHIPS: { status: ResultStatus; label: string }[] = [
  { status: "pass", label: "Pass" },
  { status: "fail", label: "Fail" },
  { status: "error", label: "Error" },
]

/**
 * What the change column knows: nothing yet while the baseline's scores load,
 * or each case's saved score once they have.
 */
type BaselineScores =
  | { state: "loading" }
  | { state: "loaded"; scores: Map<string, number> }
  | { state: "failed" }

function changeColumn(
  baseline: BaselineScores,
  threshold: number | undefined
): Column<ResultRow> {
  return {
    id: "change",
    header: "Change vs baseline",
    align: "end",
    className: "tabular-nums",
    cell: (r) => {
      // Until the scores arrive, or if they could not be read, the page does
      // not know whether the baseline scored this case, so it does not say.
      if (baseline.state === "loading")
        return <NoneCell label="baseline score loaded yet" />
      if (baseline.state === "failed")
        return <NoneCell label="readable baseline score" />
      const old = baseline.scores.get(r.caseId)
      if (old === undefined) return <NoneCell label="baseline score" />
      const delta = r.score - old
      const regressed = fellPast(delta, threshold)
      return regressed ? (
        <span className="font-medium">{`${formatDelta(delta)} regressed`}</span>
      ) : (
        formatDelta(delta)
      )
    },
  }
}

/** The change column comes only with a baseline the run was compared with. */
function columns(
  runId: string,
  baseline: BaselineScores | null,
  threshold: number | undefined
): Column<ResultRow>[] {
  return [
    {
      id: "case",
      header: "Case",
      className: "font-medium",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <PluginLink to={resultPath(runId, r.id)}>{r.caseName}</PluginLink>
          {r.redTeam && <RedTeamBadge attackType={r.redTeam.attackType} />}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <ResultStatusBadge status={r.status} />,
    },
    {
      id: "score",
      header: "Score",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatScore(r.score),
    },
    ...(baseline ? [changeColumn(baseline, threshold)] : []),
    {
      id: "scorers",
      header: "Scorers",
      cell: (r) =>
        r.scorers.length === 0 ? (
          <NoneCell label="scorer verdicts" />
        ) : (
          <ScorerVerdicts verdicts={r.scorers} />
        ),
    },
    {
      id: "latency",
      header: "Latency",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatLatency(r.latencyMs),
    },
    {
      id: "tokens",
      header: "Tokens",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatCount(r.tokensUsed),
    },
    {
      id: "cost",
      header: "Cost reported",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatCost(r.cost),
    },
  ]
}

/**
 * A run's results, filterable by status with the count beside each choice.
 * Result status has no knowable majority, so the chips and their counts do
 * the work a badge colour cannot. "Change vs baseline" reads each case's score
 * from the baseline the run was compared with; a case the baseline never
 * scored says so, and a run compared with no baseline has no such column.
 *
 * Polling stops when the run stops, so the section reads once more on that
 * edge: a case that finished between the last two polls would otherwise be
 * missing from the table while the run's own counts include it.
 *
 * The chips sit outside the read's boundary and keep the last counts they
 * were given: choosing a status changes the read, and the chips (and the
 * focus on the one just pressed) must not vanish while it loads.
 */
export function ResultsSection({
  runId,
  status,
  onStatusChange,
  baselineId,
  threshold,
  running,
}: {
  runId: string
  /** While true the results refresh every three seconds, as the run page does. */
  running: boolean
  status: ResultStatus | ""
  onStatusChange: (status: ResultStatus | "") => void
  /** The baseline the run was compared with, for the change column. */
  baselineId?: string
  threshold?: number
}) {
  const results = useQuery<RunResults>("runs.results", {
    runId,
    ...(status !== "" && { status }),
  })
  const baseline = useQuery<BaselineDetail>(
    "baselines.detail",
    { baselineId },
    { enabled: baselineId !== undefined }
  )
  usePoll(() => {
    if (running) results.refetch()
  }, RUN_POLL_MS)
  const [counts, setCounts] = useState<ResultCounts | null>(
    results.data?.counts ?? null
  )
  if (results.data && results.data.counts !== counts)
    setCounts(results.data.counts)
  const { refetch } = results
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) refetch()
    wasRunning.current = running
  }, [running, refetch])
  const scores: BaselineScores | null =
    baselineId === undefined
      ? null
      : baseline.data
        ? {
            state: "loaded",
            scores: new Map(
              baseline.data.results.map((r) => [r.caseId, r.score])
            ),
          }
        : baseline.error
          ? { state: "failed" }
          : { state: "loading" }
  return (
    <section
      aria-labelledby="sentinel-run-results"
      className="flex flex-col gap-3"
    >
      <h2 id="sentinel-run-results" className="text-sm font-medium">
        Results
      </h2>
      {baseline.error && (
        <p role="alert" className="text-sm text-destructive">
          {`The baseline's saved scores could not be read, so there is no change to show. ${baseline.error.message}`}
        </p>
      )}
      {counts && (
        <div
          role="group"
          aria-label="Show results by status"
          className="flex flex-wrap gap-2"
        >
          <Button
            variant={status === "" ? "default" : "outline"}
            size="sm"
            aria-pressed={status === ""}
            onClick={() => onStatusChange("")}
          >
            {`All ${counts.pass + counts.fail + counts.error}`}
          </Button>
          {CHIPS.map((c) => (
            <Button
              key={c.status}
              variant={status === c.status ? "default" : "outline"}
              size="sm"
              aria-pressed={status === c.status}
              onClick={() =>
                onStatusChange(status === c.status ? "" : c.status)
              }
            >
              {`${c.label} ${counts[c.status]}`}
            </Button>
          ))}
        </div>
      )}
      <SettledBoundary title="Results" query={results} skeletonRows={5}>
        {(data) => {
          const total = data.counts.pass + data.counts.fail + data.counts.error
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<ResultRow>
                columns={columns(runId, scores, threshold)}
                rows={data.items}
                rowKey={(r) => r.id}
                caption={
                  status === ""
                    ? plural(total, "result", "results")
                    : `${data.items.length} of ${plural(total, "result", "results")}`
                }
                emptyMessage={
                  status === ""
                    ? "No case has been scored yet."
                    : "No results with this status."
                }
              />
            </div>
          )
        }}
      </SettledBoundary>
    </section>
  )
}
