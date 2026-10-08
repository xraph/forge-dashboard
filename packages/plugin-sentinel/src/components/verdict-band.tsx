import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
} from "@forge-go/dashboard-kit/icons"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  ago,
  fellPast,
  formatDelta,
  formatScore,
  formatThreshold,
  plural,
} from "../format"
import type { Regression, Run } from "../types"
import { ProgressMeter } from "./progress-meter"

const SOURCE: Record<string, string> = {
  run: "recorded by the run",
  config: "from the engine's configuration",
  override: "set for this view",
}

/**
 * The one thing on the run page that is allowed to be loud. It states the
 * answer as a sentence, then the evidence for it, before any number or chart.
 *
 * It never says "passed". A run with no baseline, a cancelled run and a failed
 * run each say what they are and why there is no verdict; only a comparison
 * against a baseline earns "within threshold", and only a drop past the
 * threshold earns the destructive treatment, always with an icon and words.
 */
export function VerdictBand({
  run,
  regression,
  action,
  baselineNote = "current baseline",
  now: fixedNow,
}: {
  run: Run
  regression: Regression
  /** A button the band offers, such as "Save as baseline" on a run with no baseline. */
  action?: ReactNode
  /** What the compared baseline is to this view: the current one, or one chosen for it. */
  baselineNote?: string
  /** For tests: the moment "last progress" is measured from. */
  now?: number
}) {
  const ticking = useNow(run.state === "running" && fixedNow === undefined)
  const now = fixedNow ?? ticking
  if (run.state === "running") {
    return (
      <Band
        tone="neutral"
        icon={
          <CircleDashedIcon
            aria-hidden
            className="size-5 text-muted-foreground"
          />
        }
      >
        <p className="text-base font-medium">{`${run.completedCases} of ${run.totalCases} cases scored`}</p>
        <ProgressMeter
          done={run.completedCases}
          total={run.totalCases}
          label="Cases scored"
          className="max-w-md"
        />
        <p className="text-sm text-muted-foreground">
          {run.lastProgressAt
            ? `Last progress ${ago(run.lastProgressAt, now)}. `
            : "No case scored yet. "}
          There is no verdict until the run finishes.
        </p>
      </Band>
    )
  }
  if (regression.state === "compared" && regression.baseline) {
    const regressed = regression.hasRegression
    const name = regression.baseline.name
    const was = regression.baseline.passRate
    const current = was + regression.passRateDelta
    const threshold =
      regression.threshold === undefined
        ? ""
        : formatThreshold(regression.threshold)
    const source = SOURCE[regression.thresholdSource ?? ""] ?? ""
    // The server's rule: pass rate, average score, each dimension and each
    // case regress when they fall more than the threshold below the
    // baseline. The evidence names whichever did, so "Regressed" is never
    // shown beside numbers that hold.
    const fell = (delta: number) => fellPast(delta, regression.threshold)
    const fallenDimensions = Object.entries(regression.dimensionDeltas)
      .filter(([, delta]) => fell(delta))
      .sort(([a], [b]) => a.localeCompare(b))
    const evidence = [
      `Pass rate ${formatScore(was)} to ${formatScore(current)} (${formatDelta(regression.passRateDelta)})`,
      fell(regression.avgScoreDelta)
        ? `Avg score ${formatDelta(regression.avgScoreDelta)}`
        : null,
      ...fallenDimensions.map(([dim, delta]) => `${dim} ${formatDelta(delta)}`),
      regression.regressedCases.length > 0
        ? `${plural(regression.regressedCases.length, "case", "cases")} regressed`
        : regressed
          ? null
          : "No case fell past the threshold",
      regression.missingDimensions.length > 0
        ? `${regression.missingDimensions.join(", ")} not measured`
        : null,
      regression.missingCases.length > 0
        ? `${plural(regression.missingCases.length, "case", "cases")} missing from this run`
        : null,
      regression.newCases.length > 0
        ? `${plural(regression.newCases.length, "new case", "new cases")}`
        : null,
    ].filter((e): e is string => e !== null)
    return (
      <Band
        tone={regressed ? "regressed" : "neutral"}
        icon={
          regressed ? (
            <TriangleAlertIcon
              aria-hidden
              className="size-5 text-destructive"
            />
          ) : (
            <CircleCheckIcon
              aria-hidden
              className="size-5 text-muted-foreground"
            />
          )
        }
        action={action}
      >
        <p className="text-base font-medium">
          {regressed
            ? `Regressed against "${name}"`
            : `Within threshold of "${name}"`}
          <span className="font-normal text-muted-foreground">
            {` (${baselineNote}), threshold ${threshold} ${source}`}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{evidence.join(" · ")}</p>
      </Band>
    )
  }
  if (regression.state === "noBaseline") {
    return (
      <Band
        tone="neutral"
        icon={
          <CircleDashedIcon
            aria-hidden
            className="size-5 text-muted-foreground"
          />
        }
        action={action}
      >
        <p className="text-base font-medium">No baseline to compare against</p>
        <p className="text-sm text-muted-foreground">
          {run.state === "completed"
            ? "This suite has no current baseline. Save this run as one to compare later runs with it."
            : "This suite has no current baseline."}
        </p>
      </Band>
    )
  }
  return (
    <Band
      tone="neutral"
      icon={
        <CircleDashedIcon
          aria-hidden
          className="size-5 text-muted-foreground"
        />
      }
    >
      <p className="text-base font-medium">{notComparable(run, regression)}</p>
      {run.error && (
        <p className="text-sm text-muted-foreground">{run.error}</p>
      )}
    </Band>
  )
}

/** The time, refreshed every second while on, so "last progress 8 s ago" stays true between polls. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

function notComparable(run: Run, regression: Regression): string {
  switch (regression.reason) {
    case "runFailed":
      return "This run failed, so it is not compared with a baseline"
    case "runCancelled":
      return `This run was cancelled after ${run.completedCases} of ${run.totalCases} cases, so it is not compared with a baseline`
    case "otherSuite":
      return "That baseline belongs to another suite, so it is not compared"
    default:
      return "This run is in a state the dashboard does not know, so it is not compared"
  }
}

function Band({
  tone,
  icon,
  action,
  children,
}: {
  tone: "neutral" | "regressed"
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-label="Verdict"
      className={cn(
        "flex flex-wrap items-start gap-4 rounded-lg border border-l-4 px-5 py-4",
        tone === "regressed"
          ? "border-destructive/40 border-l-destructive"
          : "border-l-foreground/30"
      )}
    >
      <span className="pt-0.5">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </section>
  )
}
