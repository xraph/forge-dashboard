import { useState } from "react"
import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { RedTeamBadge, ResultStatusBadge, RunStateBadge } from "../badges"
import { DumbbellKey, Dumbbells, type DumbbellRow } from "../charts/dumbbells"
import { OutputDiff } from "../components/output-diff"
import { SettledBoundary } from "../components/settled-boundary"
import {
  comparePath,
  formatCost,
  formatDelta,
  formatLatency,
  orderDimensions,
  plural,
  runPath,
  shortRunId,
  suitePath,
} from "../format"
import type { CasePair, Comparison, ResultRow, Run } from "../types"

const RATES: Record<string, string> = { pass_rate: "Pass rate", avg_score: "Avg score" }

/** A case changed when its status or score moved, or only one run scored it. */
function changed(pair: CasePair): boolean {
  if (!pair.a || !pair.b) return true
  return pair.a.status !== pair.b.status || Math.abs(pair.b.score - pair.a.score) >= 0.005
}

function side(row: ResultRow | undefined, which: "A" | "B") {
  if (!row) return <span className="text-muted-foreground">{`Only in ${which === "A" ? "B" : "A"}`}</span>
  return (
    <span className="inline-flex items-center gap-2">
      <ResultStatusBadge status={row.status} />
      <span className="font-mono text-xs tabular-nums">{row.score.toFixed(2)}</span>
    </span>
  )
}

/**
 * /runs/:id/compare/:otherId: run A against run B, both of one suite. The
 * scores come first, as dumbbells on one scale, then latency and cost in
 * words (they are not on that scale), then every case, with each case's
 * outputs one click away as a diff. A lazy route: the diff it can open
 * carries CodeMirror.
 */
export default function ComparePage({ params }: PluginPageProps) {
  const runId = params.id
  const otherId = params.otherId
  if (!runId || !otherId) return <p className="text-sm text-muted-foreground">No runs selected.</p>
  return <CompareBody key={`${runId}:${otherId}`} runId={runId} otherId={otherId} />
}

function CompareBody({ runId, otherId }: { runId: string; otherId: string }) {
  const comparison = useQuery<Comparison>("runs.compare", { runId, otherRunId: otherId })
  const navigate = useNavigateTo()
  const [changedOnly, setChangedOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title="Compare runs"
        actions={
          <Button variant="outline" onClick={() => navigate(comparePath(otherId, runId))}>
            Swap A and B
          </Button>
        }
      />
      <SettledBoundary title="Comparison" query={comparison} skeletonRows={6}>
        {(c) => {
          const dims = orderDimensions(Object.keys(c.dimensionDeltas))
          const rows: DumbbellRow[] = [
            ...c.deltas.filter((d) => d.metric in RATES).map((d) => ({ key: d.metric, label: RATES[d.metric], a: d.a, b: d.b })),
            ...dims.map((dim) => ({
              key: dim,
              label: dim,
              a: c.a.dimensionScores[dim] ?? 0,
              b: c.b.dimensionScores[dim] ?? 0,
            })),
          ]
          const latency = c.deltas.find((d) => d.metric === "avg_latency_ms")
          const cost = c.deltas.find((d) => d.metric === "total_cost")
          const shown = changedOnly ? c.cases.filter(changed) : c.cases
          const pair = c.cases.find((p) => p.caseId === open)
          return (
            <div className="flex flex-col gap-8">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <RunLine which="A" run={c.a} />
                <RunLine which="B" run={c.b} />
              </dl>
              <section aria-labelledby="sentinel-compare-scores" className="flex flex-col gap-2">
                <h2 id="sentinel-compare-scores" className="text-sm font-medium">
                  Scores, A to B
                </h2>
                <DumbbellKey a={shortRunId(c.a.id)} b={shortRunId(c.b.id)} />
                <Dumbbells rows={rows} label="Scores, A to B" />
                <OnlyIn label="Only A measured" dims={c.dimensionsOnlyIn.a} />
                <OnlyIn label="Only B measured" dims={c.dimensionsOnlyIn.b} />
                <p className="text-sm text-muted-foreground">
                  {latency &&
                    `Average latency ${formatLatency(latency.a)} to ${formatLatency(latency.b)} (${latency.delta > 0 ? "+" : latency.delta < 0 ? "−" : ""}${formatLatency(Math.abs(latency.delta))}). `}
                  {cost &&
                    `Cost reported ${formatCost(cost.a)} to ${formatCost(cost.b)} (${cost.delta < 0 ? "−" : "+"}${formatCost(Math.abs(cost.delta))}); LLM judge calls are not metered.`}
                </p>
              </section>
              <section aria-labelledby="sentinel-compare-cases" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="sentinel-compare-cases" className="text-sm font-medium">
                    Cases
                  </h2>
                  <Button variant="outline" size="sm" aria-pressed={changedOnly} onClick={() => setChangedOnly((on) => !on)}>
                    Changed only
                  </Button>
                </div>
                <ResourceTable<CasePair>
                  columns={caseColumns}
                  rows={shown}
                  rowKey={(p) => p.caseId}
                  caption={
                    changedOnly
                      ? `${shown.length} of ${plural(c.cases.length, "case", "cases")} changed`
                      : plural(c.cases.length, "case", "cases")
                  }
                  emptyMessage={changedOnly ? "No case changed between these runs." : "Neither run scored a case."}
                  rowActions={(p) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={open === p.caseId}
                      onClick={() => setOpen(open === p.caseId ? null : p.caseId)}
                    >
                      {`Compare outputs of ${p.caseName}`}
                    </Button>
                  )}
                />
                {pair && (
                  <section aria-label={`Outputs of ${pair.caseName}`} className="flex flex-col gap-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">{`Outputs of ${pair.caseName}`}</h3>
                      <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
                        Close
                      </Button>
                    </div>
                    <OutputDiff key={pair.caseId} pair={pair} aRunId={c.a.id} bRunId={c.b.id} />
                  </section>
                )}
              </section>
            </div>
          )
        }}
      </SettledBoundary>
    </section>
  )
}

const caseColumns: Column<CasePair>[] = [
  {
    id: "case",
    header: "Case",
    className: "font-medium",
    cell: (p) => {
      const attack = (p.a?.redTeam ?? p.b?.redTeam)?.attackType
      return (
        <span className="flex flex-wrap items-center gap-2">
          {p.caseName}
          {attack && <RedTeamBadge attackType={attack} />}
        </span>
      )
    },
  },
  { id: "a", header: "A", cell: (p) => side(p.a, "A") },
  { id: "b", header: "B", cell: (p) => side(p.b, "B") },
  {
    id: "change",
    header: "Change",
    align: "end",
    className: "tabular-nums",
    cell: (p) => (p.a && p.b ? formatDelta(p.b.score - p.a.score) : <NoneCell label="change, one run only" />),
  },
]

function RunLine({ which, run }: { which: "A" | "B"; run: Run }) {
  return (
    <>
      <dt className="font-medium">{which}</dt>
      <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <PluginLink to={runPath(run.id)}>
          <span className="font-mono text-xs">{shortRunId(run.id)}</span>
        </PluginLink>
        <RunStateBadge state={run.state} />
        <PluginLink to={suitePath(run.suiteId)}>{run.suiteName || "Suite"}</PluginLink>
        <span>
          {"Model "}
          <span className="font-mono text-xs text-foreground">{run.model}</span>
        </span>
        <span>
          {"Started "}
          <Timestamp value={run.createdAt} label="start time" />
        </span>
      </dd>
    </>
  )
}

function OnlyIn({ label, dims }: { label: string; dims: string[] }) {
  if (dims.length === 0) return null
  return <p className="text-sm text-muted-foreground">{`${label}: ${orderDimensions(dims).join(", ")}.`}</p>
}

