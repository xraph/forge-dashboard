import { useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { RedTeamBadge, ResultStatusBadge } from "../badges"
import { PlainText, RevealText } from "../components/plain-text"
import { SettledBoundary } from "../components/settled-boundary"
import { casePath, formatCost, formatCount, formatLatency, formatScore, plural, runPath, shortRunId } from "../format"
import type { ResultDetail, Run, RunDetail, ScorerResult, TestCase, ToolCall, TraceStep } from "../types"

const scorerColumns: Column<ScorerResult & { key: string }>[] = [
  { id: "scorer", header: "Scorer", className: "font-mono text-xs font-medium", cell: (s) => s.scorerName },
  {
    id: "verdict",
    header: "Verdict",
    // Most scorers pass on most cases, so a pass recedes and a fail is the
    // thing to find.
    cell: (s) => <Badge variant={s.passed ? "outline" : "destructive"}>{s.passed ? "Passed" : "Failed"}</Badge>,
  },
  { id: "score", header: "Score", align: "end", className: "tabular-nums", cell: (s) => formatScore(s.score) },
  {
    id: "dimension",
    header: "Dimension",
    className: "font-mono text-xs",
    cell: (s) => s.dimension || <NoneCell label="dimension" />,
  },
  {
    id: "reason",
    header: "Reason",
    cell: (s) => (s.reason ? <span className="break-words whitespace-pre-wrap">{s.reason}</span> : <NoneCell label="reason" />),
  },
  {
    id: "details",
    header: "Details",
    cell: (s) =>
      s.details ? (
        <pre className="font-mono text-xs break-words whitespace-pre-wrap">{JSON.stringify(s.details, null, 2)}</pre>
      ) : (
        <NoneCell label="details" />
      ),
  },
]

const toolColumns: Column<ToolCall & { key: string }>[] = [
  { id: "tool", header: "Tool", className: "font-mono text-xs font-medium", cell: (t) => t.toolName },
  {
    id: "arguments",
    header: "Arguments",
    cell: (t) => <pre className="font-mono text-xs break-words whitespace-pre-wrap">{t.arguments}</pre>,
  },
  {
    id: "result",
    header: "Result",
    cell: (t) => <pre className="font-mono text-xs break-words whitespace-pre-wrap">{t.result}</pre>,
  },
  {
    id: "error",
    header: "Error",
    cell: (t) =>
      t.error ? <span className="break-words whitespace-pre-wrap">{t.error}</span> : <NoneCell label="error" />,
  },
]

/** /runs/:id/results/:resultId. Guards the ids, then keys the body on them. */
export const ResultDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const runId = params.id
  const resultId = params.resultId
  if (!runId || !resultId) return <p className="text-sm text-muted-foreground">No result selected.</p>
  return <ResultDetailBody key={resultId} runId={runId} resultId={resultId} />
}

function ResultDetailBody({ runId, resultId }: { runId: string; resultId: string }) {
  const result = useQuery<ResultDetail>("results.detail", { runId, resultId })
  // The run page's own read: the suite name and the run's state, shared.
  const detail = useQuery<RunDetail>("runs.detail", { runId })
  // The case as it is now, for the input. It may have been deleted since.
  const caseId = result.data?.caseId
  const testCase = useQuery<TestCase>("cases.detail", { caseId }, { enabled: caseId !== undefined })
  return (
    <section className="flex flex-col gap-6">
      <SettledBoundary title="Result" query={result} skeletonRows={6}>
        {(r) => (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <PageHeader title={r.caseName} />
              <div className="flex flex-wrap items-center gap-2">
                <ResultStatusBadge status={r.status} />
                {r.redTeam && <RedTeamBadge attackType={r.redTeam.attackType} />}
              </div>
            </div>
            <DescriptionList items={facts(r, runId, detail.data?.run, testCase.data)} />
            {r.error && (
              <section aria-labelledby="sentinel-result-error" className="flex flex-col gap-2">
                <h2 id="sentinel-result-error" className="text-sm font-medium">
                  Why it could not be judged
                </h2>
                <PlainText value={r.error} label="Error" />
              </section>
            )}
            <section aria-labelledby="sentinel-result-input" className="flex flex-col gap-2">
              <h2 id="sentinel-result-input" className="text-sm font-medium">
                Input
              </h2>
              {testCase.data ? (
                <PlainText value={testCase.data.input} label="Input" />
              ) : testCase.error?.code === "NOT_FOUND" ? (
                <p className="text-sm text-muted-foreground">
                  The case has been deleted since this run, so its input is no longer available.
                </p>
              ) : testCase.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {`The input could not be read. ${testCase.error.message}`}
                </p>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading the input.
                </p>
              )}
            </section>
            <section aria-labelledby="sentinel-result-output" className="flex flex-col gap-2">
              <h2 id="sentinel-result-output" className="text-sm font-medium">
                Output
              </h2>
              {r.output === "" ? (
                <NoneCell label="output" />
              ) : r.redTeam ? (
                <RevealText value={r.output} length={r.outputLength} attackType={r.redTeam.attackType} label="Output" />
              ) : (
                <PlainText value={r.output} label="Output" />
              )}
            </section>
            <section aria-labelledby="sentinel-result-scorers" className="flex flex-col gap-2">
              <h2 id="sentinel-result-scorers" className="text-sm font-medium">
                How it was scored
              </h2>
              <ResourceTable<ScorerResult & { key: string }>
                columns={scorerColumns}
                rows={r.scorerResults.map((s, i) => ({ ...s, key: String(i) }))}
                rowKey={(s) => s.key}
                caption={plural(r.scorerResults.length, "scorer", "scorers")}
                emptyMessage="No scorer judged this case."
              />
              <DimensionList scores={r.dimensionScores} />
            </section>
            {r.runTrace && <Trace trace={r.runTrace} attackType={r.redTeam?.attackType} />}
          </div>
        )}
      </SettledBoundary>
    </section>
  )
}

function facts(r: ResultDetail, runId: string, run: Run | undefined, testCase: TestCase | undefined) {
  return [
    {
      term: "Run",
      value: (
        <PluginLink to={runPath(runId)}>
          <span className="font-mono text-xs">{shortRunId(runId)}</span>
          {run?.suiteName ? `, ${run.suiteName}` : ""}
        </PluginLink>
      ),
    },
    {
      term: "Case",
      value: testCase ? (
        <PluginLink to={casePath(testCase.suiteId, testCase.id)}>{testCase.name}</PluginLink>
      ) : (
        <span className="font-mono text-xs">{r.caseId}</span>
      ),
    },
    { term: "Score", value: formatScore(r.score) },
    { term: "Latency", value: formatLatency(r.latencyMs) },
    { term: "Tokens", value: formatCount(r.tokensUsed) },
    { term: "Cost reported", value: formatCost(r.cost) },
  ]
}

/** Dimension scores as words and numbers; the bars come with the charts. */
function DimensionList({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No scorer measured a dimension on this case.</p>
  }
  return (
    <DescriptionList
      items={entries.map(([dim, v]) => ({
        term: dim,
        value: formatScore(v),
      }))}
    />
  )
}

function Trace({ trace, attackType }: { trace: NonNullable<ResultDetail["runTrace"]>; attackType?: string }) {
  return (
    <section aria-labelledby="sentinel-result-trace" className="flex flex-col gap-3">
      <h2 id="sentinel-result-trace" className="text-sm font-medium">
        Trace
      </h2>
      {trace.steps.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded.</p>}
      {trace.steps.map((step: TraceStep) => (
        <div key={step.index} className="flex flex-col gap-1">
          <p className="text-sm">
            {`Step ${step.index + 1}, `}
            <span className="font-mono text-xs">{step.type}</span>
            {`, ${formatCount(step.tokensUsed)} tokens`}
          </p>
          {attackType ? (
            <RevealText
              value={step.output}
              length={[...step.output].length}
              attackType={attackType}
              label={`Step ${step.index + 1} output`}
            />
          ) : (
            <PlainText value={step.output} label={`Step ${step.index + 1} output`} />
          )}
        </div>
      ))}
      {attackType && trace.toolCalls.length > 0 ? (
        <HiddenToolCalls count={trace.toolCalls.length} attackType={attackType}>
          <ToolCalls calls={trace.toolCalls} />
        </HiddenToolCalls>
      ) : (
        <ToolCalls calls={trace.toolCalls} />
      )}
    </section>
  )
}

function ToolCalls({ calls }: { calls: ToolCall[] }) {
  return (
    <ResourceTable<ToolCall & { key: string }>
      columns={toolColumns}
      rows={calls.map((t, i) => ({ ...t, key: String(i) }))}
      rowKey={(t) => t.key}
      caption={plural(calls.length, "tool call", "tool calls")}
      emptyMessage="No tool calls."
    />
  )
}

/**
 * A red-team trace's tool calls, collapsed like its output: an attack that
 * worked often shows up in what the agent passed to a tool or got back from
 * it. The reveal is this result's alone and is not stored.
 */
function HiddenToolCalls({ count, attackType, children }: { count: number; attackType: string; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  if (!shown) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-3">
        <p className="text-sm text-muted-foreground">
          Tool calls in a red-team trace stay hidden until you ask for them: their arguments and results may carry the attack.
        </p>
        <Button variant="outline" size="sm" onClick={() => setShown(true)}>
          {`Show ${plural(count, "tool call", "tool calls")} (${attackType})`}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {children}
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown(false)}>
        Hide tool calls
      </Button>
    </div>
  )
}
