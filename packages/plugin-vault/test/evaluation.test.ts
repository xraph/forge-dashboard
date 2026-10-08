import { describe, expect, it } from "vitest"
import { readEvaluation } from "../src/evaluation"
import type {
  FlagEvaluation,
  FlagOverrideSummary,
  FlagRuleSummary,
} from "../src/flag-types"

function rule(priority: number, type = "when_user"): FlagRuleSummary {
  return {
    id: `rul_${priority}`,
    priority,
    type,
    implemented: true,
    tenantIds: [],
    userIds: [],
    percentage: 0,
    returnValue: true,
    returnMatchesType: true,
  }
}

const RULES = [rule(0), rule(1), rule(2)]

function evaluation(over: Partial<FlagEvaluation>): FlagEvaluation {
  return {
    value: true,
    valueMatchesType: true,
    reason: "default",
    trace: [],
    evaluatedAt: "2026-09-29T10:00:00Z",
    ...over,
  }
}

const step = (priority: number, matched: boolean, reached = true) => ({
  priority,
  type: "when_user",
  matched,
  reached,
  note: reached ? `note ${priority}` : "",
})

describe("readEvaluation cross-check", () => {
  it("marks the matching rule when the step and the response agree", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRulePriority: 1,
        trace: [step(0, false), step(1, true), step(2, false, false)],
      }),
      RULES,
      [],
      undefined
    )
    expect(marks.decidedIndex).toBe(1)
    expect(marks.rules[1]?.decided).toBe(true)
    expect(marks.mismatch).toBe(false)
  })

  it("withholds the decided mark when the response names another priority", () => {
    // The step at position 1 carries the rule's own priority, so the per-step
    // check passes. The response says priority 2 matched, so page and engine
    // are not looking at the same rules and nothing may claim the decision.
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRulePriority: 2,
        trace: [step(0, false), step(1, true), step(2, false, false)],
      }),
      RULES,
      [],
      undefined
    )
    expect(marks.mismatch).toBe(true)
    expect(marks.decidedIndex).toBeUndefined()
    expect(marks.rules.some((v) => v.decided)).toBe(false)
  })

  it("withholds the decided mark when no step matched at all", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRulePriority: 1,
        trace: [step(0, false), step(1, false), step(2, false)],
      }),
      RULES,
      [],
      undefined
    )
    expect(marks.mismatch).toBe(true)
    expect(marks.decidedIndex).toBeUndefined()
  })
})

describe("readEvaluation by rule id", () => {
  const r1: FlagRuleSummary = { ...rule(0, "when_tenant"), id: "r1" }
  const r2: FlagRuleSummary = { ...rule(1, "rollout"), id: "r2" }
  const idStep = (
    ruleId: string,
    type: string,
    priority: number,
    matched: boolean,
    reached = true
  ) => ({
    ruleId,
    type,
    priority,
    matched,
    reached,
    note: reached ? `note ${ruleId}` : "",
  })

  it("marks the rule named by matchedRuleId when the trace is in another order", () => {
    // The page holds [r1, r2]. The engine walked [r2, r1]: the rules were
    // reordered between the two reads. Position 0 of the trace is r2's step.
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRuleId: "r2",
        matchedRulePriority: 0,
        trace: [
          idStep("r2", "rollout", 0, true),
          idStep("r1", "when_tenant", 1, false, false),
        ],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.decidedIndex).toBe(1)
    expect(marks.rules[1]?.decided).toBe(true)
    expect(marks.rules[0]?.decided).toBe(false)
    expect(marks.rules[0]?.notReached).toBe(true)
  })

  it("marks the matching rule and no mismatch when the ids line up", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRuleId: "r1",
        matchedRulePriority: 0,
        trace: [
          idStep("r1", "when_tenant", 0, true),
          idStep("r2", "rollout", 1, false, false),
        ],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.decidedIndex).toBe(0)
    expect(marks.mismatch).toBe(false)
  })

  it("is a mismatch, with no rule decided, when a step names a rule the page does not hold", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRuleId: "r9",
        trace: [
          idStep("r9", "when_tenant", 0, true),
          idStep("r2", "rollout", 1, false, false),
        ],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.mismatch).toBe(true)
    expect(marks.decidedIndex).toBeUndefined()
    expect(marks.rules.some((v) => v.decided)).toBe(false)
  })

  it("is a mismatch when the counts differ, even if every id is known", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRuleId: "r1",
        trace: [idStep("r1", "when_tenant", 0, true)],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.mismatch).toBe(true)
    expect(marks.decidedIndex).toBeUndefined()
  })

  it("is a mismatch when a matched step's type is not its rule's type", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRuleId: "r1",
        trace: [
          idStep("r1", "when_user", 0, true),
          idStep("r2", "rollout", 1, false, false),
        ],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.mismatch).toBe(true)
    expect(marks.decidedIndex).toBeUndefined()
    expect(marks.rules.some((v) => v.decided)).toBe(false)
  })

  it("is a mismatch when matchedRuleId is not the rule of a matched step", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "rule",
        matchedRuleId: "r2",
        trace: [
          idStep("r1", "when_tenant", 0, true),
          idStep("r2", "rollout", 1, false, true),
        ],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.mismatch).toBe(true)
    expect(marks.decidedIndex).toBeUndefined()
  })

  it("reads a default answer by id too", () => {
    const marks = readEvaluation(
      evaluation({
        reason: "default",
        trace: [
          idStep("r2", "rollout", 1, false),
          idStep("r1", "when_tenant", 0, false),
        ],
      }),
      [r1, r2],
      [],
      undefined
    )
    expect(marks.mismatch).toBe(false)
    expect(marks.rules.map((v) => v.note)).toEqual(["note r1", "note r2"])
  })
})

describe("readEvaluation tenant overrides", () => {
  const overrides: FlagOverrideSummary[] = [
    {
      tenantId: "t-acme",
      value: true,
      valueMatchesType: true,
      updatedAt: "2026-09-22T10:00:00Z",
    },
  ]

  it("names the tenant whose override decided it", () => {
    const marks = readEvaluation(
      evaluation({ reason: "tenantOverride" }),
      RULES,
      overrides,
      "t-acme"
    )
    expect(marks.overrideTenant).toBe("t-acme")
    expect(marks.mismatch).toBe(false)
  })

  it("asks for a fresh evaluation when the tenant's override is no longer on the page", () => {
    // Removed between the two reads: the engine used it, the page cannot show it.
    const marks = readEvaluation(
      evaluation({ reason: "tenantOverride" }),
      RULES,
      overrides,
      "t-gone"
    )
    expect(marks.overrideTenant).toBeUndefined()
    expect(marks.mismatch).toBe(true)
  })
})
