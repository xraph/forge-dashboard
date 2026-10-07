import { Fragment, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { RunStateBadge } from "../badges"
import { RedTeamReportSection } from "../components/redteam-report"
import { ResultsSection } from "../components/results-section"
import { RunCharts } from "../components/run-charts"
import { CompareDialog } from "../components/compare-dialog"
import { CancelRunDialog, SaveBaselineDialog } from "../components/run-dialogs"
import { RUN_POLL_MS } from "../components/runs-list"
import { SettledBoundary } from "../components/settled-boundary"
import { StaleNotice } from "../components/stale-notice"
import { VerdictBand } from "../components/verdict-band"
import { ViewAgainst, type ViewChoice } from "../components/view-against"
import {
  formatCost,
  formatCount,
  formatDuration,
  formatScore,
  formatThreshold,
  shortRunId,
  suitePath,
  versionPath,
} from "../format"
import type { Regression, ResultStatus, Run, RunDetail } from "../types"
import { useSettled } from "../use-settled"

/** /runs/:id. Guards the id, then keys the body on it. */
export const RunDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) return <p className="text-sm text-muted-foreground">No run selected.</p>
  return <RunDetailBody key={id} runId={id} />
}

function RunDetailBody({ runId }: { runId: string }) {
  // A failed poll keeps the page as it was and keeps polling (useSettled):
  // the operator is watching a run, and one lost request should not end that.
  const detail = useSettled(useQuery<RunDetail>("runs.detail", { runId }))
  const running = detail.data?.run.state === "running"
  // Three seconds while the run is running and the tab is visible, nothing
  // once it finishes. The results section polls itself on the same rule.
  usePoll(() => {
    if (running) detail.refetch()
  }, RUN_POLL_MS)
  const [status, setStatus] = useState<ResultStatus | "">("")
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [target, setTarget] = useState<Run | null>(null)
  // Another baseline or threshold, for this view only. The run's own answer
  // stays in runs.detail; runs.regression answers the chosen one.
  const [choice, setChoice] = useState<ViewChoice | null>(null)
  const chosen = useQuery<Regression>("runs.regression", { runId, ...choice }, { enabled: choice !== null })
  const own = detail.data?.regression
  // While the chosen answer loads, or if it was refused, the run's own
  // stands, and the band names whichever baseline is actually on screen.
  const viewed = choice !== null ? chosen.data : undefined
  const regression = viewed ?? own
  const baselineNote =
    viewed?.baseline && viewed.baseline.id !== own?.baseline?.id ? "chosen for this view" : "current baseline"
  return (
    <section className="flex flex-col gap-6">
      {detail.stale && <StaleNotice what="this run" error={detail.error} onRetry={detail.refetch} />}
      <SettledBoundary title="Run" query={detail} skeletonRows={6}>
        {({ run, regression: ownAnswer }) => {
          const answer = regression ?? ownAnswer
          const saveButton =
            run.state === "completed" ? (
              <Button
                variant={answer.state === "noBaseline" ? "default" : "outline"}
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
                      <Button
                        variant="outline"
                        onClick={() => {
                          setTarget(run)
                          setComparing(true)
                        }}
                      >
                        Compare with…
                      </Button>
                      {answer.state !== "noBaseline" && saveButton}
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
                regression={answer}
                baselineNote={baselineNote}
                action={answer.state === "noBaseline" ? saveButton : undefined}
              />
              <StatGrid items={stats(run)} />
              <ScoredWith run={run} />
            </div>
          )
        }}
      </SettledBoundary>
      {detail.data && regression && (
        <>
          {detail.data.run.state === "completed" && (
            <ViewAgainst
              suiteId={detail.data.run.suiteId}
              recordedThreshold={own?.threshold}
              choice={choice}
              onChange={setChoice}
              error={choice !== null ? chosen.error?.message : undefined}
            />
          )}
          <RunCharts runId={runId} run={detail.data.run} regression={regression} />
          <RedTeamReportSection runId={runId} running={running} />
          <ResultsSection
            runId={runId}
            status={status}
            onStatusChange={setStatus}
            running={running}
            baselineId={regression.state === "compared" ? regression.baseline?.id : undefined}
            threshold={regression.threshold}
          />
        </>
      )}
      {target && (
        <>
          <SaveBaselineDialog open={saving} onOpenChange={setSaving} runId={target.id} />
          <CancelRunDialog open={cancelling} onOpenChange={setCancelling} run={target} />
          <CompareDialog open={comparing} onOpenChange={setComparing} run={target} />
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
    {
      label: "Cost reported by target",
      value: formatCost(run.totalCost),
      // A target that reports nothing reads as $0.0000, which is not free.
      hint: run.totalCost === 0 ? "The target reported none; LLM judge calls are not metered" : "LLM judge calls are not metered",
    },
  ]
}

/** The settings the run recorded, or why the threshold comes from config. */
function ScoredWith({ run }: { run: Run }) {
  const s = run.settings
  const recorded =
    s.passThreshold !== undefined || s.regressionThreshold !== undefined || (s.scorers !== undefined && s.scorers.length > 0)
  if (!recorded) {
    return (
      <p className="text-sm text-muted-foreground">
        This run did not record its settings, so its regression threshold comes from the engine's configuration.
      </p>
    )
  }
  // Each setting is recorded on its own, so any of them may be the only one.
  const clauses: ReactNode[] = [
    s.passThreshold !== undefined ? `pass threshold ${formatThreshold(s.passThreshold)}` : null,
    s.regressionThreshold !== undefined ? `regression threshold ${formatThreshold(s.regressionThreshold)}` : null,
    s.concurrency !== undefined ? `concurrency ${s.concurrency}` : null,
    s.scorers && s.scorers.length > 0 ? (
      <>
        {"the run's scorers "}
        {s.scorers.map((name, i) => (
          <span key={`${name}-${i}`}>
            {i > 0 && ", "}
            <span className="font-mono text-xs text-foreground">{name}</span>
          </span>
        ))}
      </>
    ) : null,
  ].filter((c) => c !== null)
  return (
    <p className="text-sm text-muted-foreground">
      {"Scored with "}
      {clauses.map((clause, i) => (
        <Fragment key={i}>
          {i > 0 && (i === clauses.length - 1 ? ", and " : ", ")}
          {clause}
        </Fragment>
      ))}
      .
    </p>
  )
}
