import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { RunStateBadge } from "../badges"
import { ResultsSection } from "../components/results-section"
import { CancelRunDialog, SaveBaselineDialog } from "../components/run-dialogs"
import { RUN_POLL_MS } from "../components/runs-list"
import { SettledBoundary } from "../components/settled-boundary"
import { VerdictBand } from "../components/verdict-band"
import { formatCost, formatCount, formatDuration, formatScore, shortRunId, suitePath, versionPath } from "../format"
import type { ResultStatus, Run, RunDetail } from "../types"

/** /runs/:id. Guards the id, then keys the body on it. */
export const RunDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) return <p className="text-sm text-muted-foreground">No run selected.</p>
  return <RunDetailBody key={id} runId={id} />
}

function RunDetailBody({ runId }: { runId: string }) {
  const detail = useQuery<RunDetail>("runs.detail", { runId })
  const running = detail.data?.run.state === "running"
  // Three seconds while the run is running and the tab is visible, nothing
  // once it finishes. The results section polls itself on the same rule.
  usePoll(() => {
    if (running) detail.refetch()
  }, RUN_POLL_MS)
  const [status, setStatus] = useState<ResultStatus | "">("")
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [target, setTarget] = useState<Run | null>(null)
  return (
    <section className="flex flex-col gap-6">
      <SettledBoundary title="Run" query={detail} skeletonRows={6}>
        {({ run, regression }) => {
          const saveButton =
            run.state === "completed" ? (
              <Button
                variant={regression.state === "noBaseline" ? "default" : "outline"}
                onClick={() => {
                  setTarget(run)
                  setSaving(true)
                }}
              >
                Save as baseline
              </Button>
            ) : null
          return (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <PageHeader
                  title={`Run ${shortRunId(run.id)}`}
                  actions={
                    <>
                      {regression.state !== "noBaseline" && saveButton}
                      {run.state === "running" && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setTarget(run)
                            setCancelling(true)
                          }}
                        >
                          Cancel run
                        </Button>
                      )}
                    </>
                  }
                />
                <RunMeta run={run} />
              </div>
              <VerdictBand
                run={run}
                regression={regression}
                action={regression.state === "noBaseline" ? saveButton : undefined}
              />
              <StatGrid items={stats(run)} />
              <ScoredWith run={run} />
            </div>
          )
        }}
      </SettledBoundary>
      {detail.data && (
        <ResultsSection
          runId={runId}
          status={status}
          onStatusChange={setStatus}
          running={running}
          baselineId={detail.data.regression.state === "compared" ? detail.data.regression.baseline?.id : undefined}
          threshold={detail.data.regression.threshold}
        />
      )}
      {target && (
        <>
          <SaveBaselineDialog open={saving} onOpenChange={setSaving} runId={target.id} />
          <CancelRunDialog open={cancelling} onOpenChange={setCancelling} run={target} />
        </>
      )}
    </section>
  )
}

/** Which suite, target, model and prompt the run used, when it started and how long it took. */
function RunMeta({ run }: { run: Run }) {
  const s = run.settings
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RunStateBadge state={run.state} />
        <PluginLink to={suitePath(run.suiteId)}>{run.suiteName || "Suite"}</PluginLink>
        <span>
          {"Target "}
          {s.target ? <span className="font-mono text-xs text-foreground">{s.target}</span> : "not recorded"}
        </span>
        <span>
          {"Model "}
          <span className="font-mono text-xs text-foreground">{run.model}</span>
        </span>
        {s.promptVersionId ? (
          <PluginLink to={versionPath(run.suiteId, s.promptVersionId)}>The prompt version it used</PluginLink>
        ) : (
          <span>The suite's own prompt</span>
        )}
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <span>
          {"Started "}
          <Timestamp value={run.createdAt} label="start time" />
        </span>
        {run.completedAt && <span>{`Took ${formatDuration(run.createdAt, run.completedAt)}`}</span>}
      </p>
      <p className="font-mono text-xs">{run.id}</p>
    </div>
  )
}

function stats(run: Run) {
  const partial = run.state === "running"
  return [
    {
      label: "Pass rate",
      value: formatScore(run.passRate),
      hint: partial
        ? `So far: ${run.passed} of ${run.completedCases} scored`
        : `${run.passed} of ${run.completedCases} passed`,
    },
    { label: "Avg score", value: formatScore(run.avgScore), hint: partial ? "So far" : undefined },
    { label: "Errored", value: run.errored, hint: "Cases that could not be judged" },
    { label: "Tokens", value: formatCount(run.totalTokens), hint: partial ? "So far" : undefined },
    { label: "Cost reported by target", value: formatCost(run.totalCost), hint: "LLM judge calls are not metered" },
  ]
}

/** The settings the run recorded, or why the threshold comes from config. */
function ScoredWith({ run }: { run: Run }) {
  const s = run.settings
  const recorded = s.passThreshold !== undefined || s.regressionThreshold !== undefined || s.scorers !== undefined
  if (!recorded) {
    return (
      <p className="text-sm text-muted-foreground">
        This run did not record its settings, so its regression threshold comes from the engine's configuration.
      </p>
    )
  }
  const parts = [
    s.passThreshold !== undefined ? `pass threshold ${formatScore(s.passThreshold)}` : null,
    s.regressionThreshold !== undefined ? `regression threshold ${formatScore(s.regressionThreshold)}` : null,
    s.concurrency !== undefined ? `concurrency ${s.concurrency}` : null,
  ].filter((p): p is string => p !== null)
  return (
    <p className="text-sm text-muted-foreground">
      {`Scored with ${parts.join(", ")}`}
      {s.scorers && s.scorers.length > 0 && (
        <>
          {", and the run's scorers "}
          {s.scorers.map((name, i) => (
            <span key={`${name}-${i}`}>
              {i > 0 && ", "}
              <span className="font-mono text-xs text-foreground">{name}</span>
            </span>
          ))}
        </>
      )}
      .
    </p>
  )
}
