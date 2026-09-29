import type {
  FlagEvaluation,
  FlagOverrideSummary,
  FlagRuleSummary,
} from "./flag-types"

/** What one rule on the ladder shows after an evaluation. */
export interface RuleVerdict {
  /** This rule gave the answer. */
  decided: boolean
  /** The engine listed it but stopped before checking it. */
  notReached: boolean
  /** The engine's own words for the verdict. Empty when it gave none. */
  note: string
}

/** What the ladder shows, worked out from one evaluation response and nothing else. */
export interface LadderMarks {
  reason: FlagEvaluation["reason"]
  /** Rung 1 decided it: the flag is off. */
  enabledDecided: boolean
  /** Rung 2 was never consulted. */
  overridesNotReached: boolean
  /** The tenant whose override decided it, when one did. */
  overrideTenant?: string
  /** Rung 3 was never consulted. */
  rulesNotReached: boolean
  /** One per rule, in the order the rules were given. */
  rules: RuleVerdict[]
  /** The rule that decided it, zero-based, when one did. */
  decidedIndex?: number
  /** Rung 4 decided it. */
  defaultDecided: boolean
  /** Rung 4 was never consulted. */
  defaultNotReached: boolean
  /**
   * The rules the page holds are not the rules the engine walked (one was
   * added, removed or re-ordered between the two reads), so some rows carry no
   * verdict rather than the wrong one.
   */
  mismatch: boolean
}

/**
 * Reads an evaluation onto the ladder.
 *
 * Trace steps are matched to rules BY POSITION. `flags.detail` returns the
 * rules in exactly the order the engine walks them and the trace follows that
 * order, so step i is rule i. The priority on the step is only a cross-check:
 * where it disagrees the rule gets no verdict, because attributing a step to
 * the wrong rule is worse than saying nothing.
 */
export function readEvaluation(
  evaluation: FlagEvaluation,
  rules: FlagRuleSummary[],
  overrides: FlagOverrideSummary[],
  tenantId: string | undefined,
): LadderMarks {
  const { reason, trace } = evaluation
  const reachedRules = reason === "rule" || reason === "default"

  let mismatch = false
  const verdicts: RuleVerdict[] = rules.map((rule, i) => {
    const none: RuleVerdict = { decided: false, notReached: !reachedRules, note: "" }
    if (!reachedRules) return none
    const step = trace[i]
    if (step === undefined || step.priority !== rule.priority) {
      mismatch = true
      return none
    }
    if (!step.reached) return { decided: false, notReached: true, note: "" }
    return { decided: step.matched, notReached: false, note: step.note }
  })
  if (reachedRules && trace.length !== rules.length) mismatch = true

  let decidedIndex = reason === "rule" ? verdicts.findIndex((v) => v.decided) : -1
  if (reason === "rule") {
    // The trace says which rule matched, the response says which priority did.
    // They have to agree, or the page and the engine are looking at different
    // rules. When they do not, no row may claim the decision: it would sit
    // next to "Press Evaluate again" saying the opposite.
    const at = decidedIndex >= 0 ? rules[decidedIndex] : undefined
    if (at === undefined || at.priority !== evaluation.matchedRulePriority) {
      mismatch = true
      if (decidedIndex >= 0) {
        verdicts[decidedIndex] = { decided: false, notReached: false, note: "" }
        decidedIndex = -1
      }
    }
  }

  const overrideTenant =
    reason === "tenantOverride" &&
    tenantId !== undefined &&
    overrides.some((o) => o.tenantId === tenantId)
      ? tenantId
      : undefined
  // The engine used an override the page cannot find (removed between the two
  // reads), so there is no row to mark. Say so.
  if (reason === "tenantOverride" && overrideTenant === undefined) mismatch = true

  return {
    reason,
    enabledDecided: reason === "disabled",
    overridesNotReached: reason === "disabled",
    overrideTenant,
    rulesNotReached: reason === "disabled" || reason === "tenantOverride",
    rules: verdicts,
    decidedIndex: decidedIndex >= 0 ? decidedIndex : undefined,
    defaultDecided: reason === "default",
    defaultNotReached: reason !== "default",
    mismatch,
  }
}
