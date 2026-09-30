import { CheckFailedBadge, CheckHeldBadge } from "../badges"

/**
 * A check has three states, not two. chronicle's verify.Report pairs every
 * uncertain result with a *Checked flag because a Go bool's false zero value
 * cannot say whether the check ran. Rendering one as a boolean turns "we did
 * not look" into "we looked and it failed", or the other way round.
 */
export type TriState = "not-checked" | "held" | "failed"

export function tri(checked: boolean, ok: boolean): TriState {
  if (!checked) return "not-checked"
  return ok ? "held" : "failed"
}

/**
 * A badge means an opinion was formed. A check that did not run is plain
 * muted text, so an absence looks like an absence.
 */
export function TriStateMark({
  state,
  held,
  failed,
  notChecked,
}: {
  state: TriState
  held: string
  failed: string
  notChecked: string
}) {
  if (state === "held") return <CheckHeldBadge>{held}</CheckHeldBadge>
  if (state === "failed") return <CheckFailedBadge>{failed}</CheckFailedBadge>
  return <span className="text-sm text-muted-foreground">{notChecked}</span>
}
