import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { RedTeamBadge, ResultStatusBadge } from "../badges"
import { formatCost, formatCount, formatDelta, formatLatency, formatScore, plural, resultPath } from "../format"
import type { BaselineDetail, ResultRow, ResultStatus, RunResults } from "../types"
import { RUN_POLL_MS } from "./runs-list"
import { SettledBoundary } from "./settled-boundary"

const CHIPS: { status: ResultStatus; label: string }[] = [
  { status: "pass", label: "Pass" },
  { status: "fail", label: "Fail" },
  { status: "error", label: "Error" },
]

function columns(runId: string, baseline: Map<string, number> | null, threshold: number | undefined): Column<ResultRow>[] {
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
    { id: "status", header: "Status", cell: (r) => <ResultStatusBadge status={r.status} /> },
    { id: "score", header: "Score", align: "end", className: "tabular-nums", cell: (r) => formatScore(r.score) },
    {
      id: "change",
      header: "Change vs baseline",
      align: "end",
      className: "tabular-nums",
      cell: (r) => {
        const old = baseline?.get(r.caseId)
        if (old === undefined) return <NoneCell label="baseline score" />
        const delta = r.score - old
        const regressed = threshold !== undefined && delta < -threshold - 1e-9
        return regressed ? (
          <span className="font-medium">{`${formatDelta(delta)} regressed`}</span>
        ) : (
          formatDelta(delta)
        )
      },
    },
    { id: "latency", header: "Latency", align: "end", className: "tabular-nums", cell: (r) => formatLatency(r.latencyMs) },
    { id: "tokens", header: "Tokens", align: "end", className: "tabular-nums", cell: (r) => formatCount(r.tokensUsed) },
    { id: "cost", header: "Cost reported", align: "end", className: "tabular-nums", cell: (r) => formatCost(r.cost) },
  ]
}

/**
 * A run's results, filterable by status with the count beside each choice.
 * Result status has no knowable majority, so the chips and their counts do
 * the work a badge colour cannot. "Change vs baseline" reads each case's score
 * from the current baseline's saved results; a case the baseline never scored
 * says so.
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
  const results = useQuery<RunResults>("runs.results", { runId, ...(status !== "" && { status }) })
  const baseline = useQuery<BaselineDetail>("baselines.detail", { baselineId }, { enabled: baselineId !== undefined })
  usePoll(() => {
    if (running) results.refetch()
  }, RUN_POLL_MS)
  const scores = baseline.data ? new Map(baseline.data.results.map((r) => [r.caseId, r.score])) : null
  return (
    <section aria-labelledby="sentinel-run-results" className="flex flex-col gap-3">
      <h2 id="sentinel-run-results" className="text-sm font-medium">
        Results
      </h2>
      <SettledBoundary title="Results" query={results} skeletonRows={5}>
        {(data) => {
          const total = data.counts.pass + data.counts.fail + data.counts.error
          return (
            <div className="flex flex-col gap-3">
              <div role="group" aria-label="Show results by status" className="flex flex-wrap gap-2">
                <Button
                  variant={status === "" ? "default" : "outline"}
                  size="sm"
                  aria-pressed={status === ""}
                  onClick={() => onStatusChange("")}
                >
                  {`All ${total}`}
                </Button>
                {CHIPS.map((c) => (
                  <Button
                    key={c.status}
                    variant={status === c.status ? "default" : "outline"}
                    size="sm"
                    aria-pressed={status === c.status}
                    onClick={() => onStatusChange(status === c.status ? "" : c.status)}
                  >
                    {`${c.label} ${data.counts[c.status]}`}
                  </Button>
                ))}
              </div>
              <ResourceTable<ResultRow>
                columns={columns(runId, scores, threshold)}
                rows={data.items}
                rowKey={(r) => r.id}
                caption={
                  status === ""
                    ? plural(total, "result", "results")
                    : `${data.items.length} of ${plural(total, "result", "results")}`
                }
                emptyMessage={status === "" ? "No case has been scored yet." : "No results with this status."}
              />
            </div>
          )
        }}
      </SettledBoundary>
    </section>
  )
}
