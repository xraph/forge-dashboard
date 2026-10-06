import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { scenarioLabel } from "./format"
import type { Regression, ResultStatus, RunState } from "./types"

// Badge colour is an attention budget (PLAYBOOK, convention 5). The mappings
// below are the spec's "Badges" table, with its reasons:
//
// - Scenario: almost every case is "standard", so standard takes outline and
//   recedes; the other seven are notable but not wrong, so secondary.
// - Markers ("Current", "Red team"): default. They are rare on any page and
//   are the thing worth a second look on the row that carries them.
// - "Calls an LLM": default. Few scorers call a model, and those cost money a
//   run does not meter, so only they get the loud badge.
// - "Needs config": secondary. Notable, not wrong: such a scorer can only be
//   attached to a case, with its settings.
// - Run state: completed is most runs, so outline; cancelled is notable but
//   not wrong, so secondary; running is the one to watch, so default; failed
//   is what somebody opens the runs list to find, so destructive.
// - Result status: a suite can sit at any pass rate, so no state is knowably
//   the majority and the mapping is fixed by meaning instead (the playbook's
//   rule for an unknowable majority). Pass is outline, error is default (the
//   case could not be judged, which deserves a second look and is not the
//   same as failing), fail is destructive. The status filter chips with their
//   counts do the work colour cannot.
// - Verdict: within threshold is outline; no baseline, not comparable and
//   pending are secondary, because none of them is a pass; regressed is
//   destructive, and always sits beside an icon and words.

export function ScenarioBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === "standard" ? "outline" : "secondary"}>
      {scenarioLabel(type)}
    </Badge>
  )
}

export function CurrentBadge() {
  return <Badge variant="default">Current</Badge>
}

/** A red-team case's marker, with its attack type. */
export function RedTeamBadge({ attackType }: { attackType: string }) {
  return (
    <Badge variant="default">
      Red team<span className="font-mono text-xs">· {attackType}</span>
    </Badge>
  )
}

/** A scorer that calls a model, and so costs money a run does not meter. */
export function LlmBadge() {
  return <Badge variant="default">Calls an LLM</Badge>
}

/** A scorer that cannot run without config of its own. */
export function NeedsConfigBadge() {
  return <Badge variant="secondary">Needs config</Badge>
}

const RUN_STATE: Record<RunState, { label: string; variant: "outline" | "secondary" | "default" | "destructive" }> = {
  completed: { label: "Completed", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  running: { label: "Running", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
}

export function RunStateBadge({ state }: { state: RunState }) {
  const s = RUN_STATE[state] ?? { label: state, variant: "secondary" as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

const RESULT_STATUS: Record<ResultStatus, { label: string; variant: "outline" | "default" | "destructive" }> = {
  pass: { label: "Pass", variant: "outline" },
  error: { label: "Error", variant: "default" },
  fail: { label: "Fail", variant: "destructive" },
}

export function ResultStatusBadge({ status }: { status: ResultStatus }) {
  const s = RESULT_STATUS[status] ?? { label: status, variant: "default" as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** The verdict a regression answer earns, in words a person scans for. */
export function verdictLabel(regression: Regression): string {
  switch (regression.state) {
    case "compared":
      return regression.hasRegression ? "Regressed" : "Within threshold"
    case "noBaseline":
      return "No baseline"
    case "running":
      return "Pending"
    default:
      return "Not comparable"
  }
}

export function VerdictBadge({ regression }: { regression: Regression }) {
  const regressed = regression.state === "compared" && regression.hasRegression
  const within = regression.state === "compared" && !regression.hasRegression
  return (
    <Badge variant={regressed ? "destructive" : within ? "outline" : "secondary"}>{verdictLabel(regression)}</Badge>
  )
}
