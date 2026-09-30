import type {
  FlagEvaluation,
  FlagOverrideSummary,
  FlagRuleSummary,
  FlagTraceStep,
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
 * Each trace step names the rule it is about (`ruleId`), and the response
 * names the rule that decided it (`matchedRuleId`), so a step is matched to
 * the page's rule with the same id, wherever it sits in either list. What is
 * detected is a disagreement about WHICH rules exist: a step whose id is not
 * on the page, a different number of steps than rules, a step whose type is
 * not its rule's type, or a `matchedRuleId` that is not a matched step's rule
 * (a rule was added, removed or replaced between the two reads). Then no row
 * gets a verdict and none is marked decided, because attributing a step to
 * the wrong rule is worse than saying nothing. A rule that was only moved is
 * not a disagreement: every step still finds its own rule.
 *
 * A response with no rule ids (an older server) falls back to position: step
 * i is rule i, cross-checked by priority, since `flags.detail` returns rules
 * in the order the engine walks them. Position cannot tell a moved rule from
 * a replaced one, which is why the ids exist.
 */
export function readEvaluation(
  evaluation: FlagEvaluation,
  rules: FlagRuleSummary[],
  overrides: FlagOverrideSummary[],
  tenantId: string | undefined,
): LadderMarks {
  const { reason, trace } = evaluation
  const reachedRules = reason === "rule" || reason === "default"
  const byId = trace.some((step) => step.ruleId !== undefined && step.ruleId !== "")

  const walked = byId
    ? readById(evaluation, rules, reachedRules)
    : readByPosition(evaluation, rules, reachedRules)
  const { verdicts, mismatch } = walked
  const decidedIndex = walked.decidedIndex

  const overrideTenant =
    reason === "tenantOverride" &&
    tenantId !== undefined &&
    overrides.some((o) => o.tenantId === tenantId)
      ? tenantId
      : undefined
  // The engine used an override the page cannot find (removed between the two
  // reads), so there is no row to mark. Say so.
  const overrideMissing = reason === "tenantOverride" && overrideTenant === undefined

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
    mismatch: mismatch || overrideMissing,
  }
}

interface Walk {
  verdicts: RuleVerdict[]
  /** Zero-based, or -1 when no rule decided it. */
  decidedIndex: number
  mismatch: boolean
}

function verdictOf(step: FlagTraceStep): RuleVerdict {
  if (!step.reached) return { decided: false, notReached: true, note: "" }
  return { decided: step.matched, notReached: false, note: step.note }
}

/** No rule has a verdict: nothing is claimed about it, decided or not. */
function withheld(rules: FlagRuleSummary[], notReached: boolean): RuleVerdict[] {
  return rules.map(() => ({ decided: false, notReached, note: "" }))
}

function readById(
  evaluation: FlagEvaluation,
  rules: FlagRuleSummary[],
  reachedRules: boolean,
): Walk {
  const { reason, trace } = evaluation
  if (!reachedRules) {
    return { verdicts: withheld(rules, true), decidedIndex: -1, mismatch: false }
  }
  const lost: Walk = { verdicts: withheld(rules, false), decidedIndex: -1, mismatch: true }

  if (trace.length !== rules.length) return lost
  const steps = new Map<string, FlagTraceStep>()
  for (const step of trace) {
    if (step.ruleId === undefined || step.ruleId === "" || steps.has(step.ruleId)) return lost
    steps.set(step.ruleId, step)
  }
  const verdicts: RuleVerdict[] = []
  for (const rule of rules) {
    const step = steps.get(rule.id)
    if (step === undefined || step.type !== rule.type) return lost
    verdicts.push(verdictOf(step))
  }

  if (reason !== "rule") {
    return { verdicts, decidedIndex: -1, mismatch: false }
  }
  // The response names the rule that decided it. It has to be a rule whose own
  // step matched, or the two are describing different evaluations.
  const at = rules.findIndex((rule) => rule.id === evaluation.matchedRuleId)
  if (at < 0 || verdicts[at]?.decided !== true) {
    return { verdicts: lost.verdicts, decidedIndex: -1, mismatch: true }
  }
  return { verdicts, decidedIndex: at, mismatch: false }
}

function readByPosition(
  evaluation: FlagEvaluation,
  rules: FlagRuleSummary[],
  reachedRules: boolean,
): Walk {
  const { reason, trace } = evaluation
  let mismatch = false
  const verdicts: RuleVerdict[] = rules.map((rule, i) => {
    const none: RuleVerdict = { decided: false, notReached: !reachedRules, note: "" }
    if (!reachedRules) return none
    const step = trace[i]
    if (step === undefined || step.priority !== rule.priority) {
      mismatch = true
      return none
    }
    return verdictOf(step)
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
  return { verdicts, decidedIndex, mismatch }
}
