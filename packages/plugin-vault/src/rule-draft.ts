import { scheduleTime, toUTCInput } from "./datetime"
import type { FlagRuleSummary } from "./flag-types"

/*
 * The rule editor's working copy, and everything it decides without a screen.
 *
 * A draft is the whole rule list as the operator is shaping it. It is built
 * from what `flags.detail` returned, edited freely, and sent back whole
 * through `flags.setRules` in display order. The order IS the priority: the
 * server derives it from the position, so nothing here carries one.
 */

/** The four types the engine can match, and the only ones the editor can add. */
export const ADDABLE_RULE_TYPES = [
  "when_tenant",
  "when_user",
  "rollout",
  "schedule",
] as const

export type AddableRuleType = (typeof ADDABLE_RULE_TYPES)[number]

/** The words on the add menu, and on a new row's header. */
export const RULE_TYPE_LABELS: Record<AddableRuleType, string> = {
  when_tenant: "Tenant is one of",
  when_user: "User is one of",
  rollout: "Rollout",
  schedule: "Schedule",
}

/** The server refuses a percentage outside this. */
export const MIN_PERCENTAGE = 0
export const MAX_PERCENTAGE = 100

/** One rule in the draft. */
export interface DraftRule {
  /** Stable for the life of the draft: the drag key and the row's React key. */
  uid: string
  type: string
  /** False for the types the engine can never match. */
  implemented: boolean
  tenantIds: string[]
  userIds: string[]
  /** Undefined while the number field holds something that is not 0 to 100. */
  percentage: number | undefined
  /** What the two `datetime-local` controls hold, read as UTC. */
  startText: string
  endText: string
  /** The instants as they were read, so an untouched time is sent back unchanged. */
  startAt?: string
  endAt?: string
  /**
   * The rule as it was read, for the types the editor has no form for. They
   * go back exactly as they came, so saving never changes them.
   */
  kept?: FlagRuleSummary
  /** Undefined while the return value is empty or invalid. */
  returnValue: unknown
  /** New in this draft, so its row opens ready to fill in. */
  isNew: boolean
}

let counter = 0
function nextUid(): string {
  counter += 1
  return `draft-${counter}`
}

/** Types the editor draws no fields for: read-only summary and Remove. */
export function isKeptType(type: string): boolean {
  return type === "when_tenant_tag" || type === "custom"
}

function isAddable(type: string): type is AddableRuleType {
  return (ADDABLE_RULE_TYPES as readonly string[]).includes(type)
}

/**
 * The draft for a flag's saved rules, in the order given.
 *
 * A saved return value that is not a value of the flag's type is not offered
 * back as if it were one: the field starts empty and the row waits for a real
 * value, the same way the default dialog treats a default of the wrong type.
 */
export function draftFromSaved(rules: FlagRuleSummary[]): DraftRule[] {
  return rules.map((r) => ({
    uid: nextUid(),
    type: r.type,
    implemented: r.implemented,
    tenantIds: [...r.tenantIds],
    userIds: [...r.userIds],
    percentage: r.percentage,
    startText: r.startAt ? toUTCInput(r.startAt) : "",
    endText: r.endAt ? toUTCInput(r.endAt) : "",
    startAt: r.startAt,
    endAt: r.endAt,
    kept: isKeptType(r.type) || !isAddable(r.type) ? r : undefined,
    returnValue: r.returnMatchesType ? r.returnValue : undefined,
    isNew: false,
  }))
}

/** An empty rule of one type, for the add menu. */
export function newRule(type: AddableRuleType): DraftRule {
  return {
    uid: nextUid(),
    type,
    implemented: true,
    tenantIds: [],
    userIds: [],
    // A rollout starts at nothing, so adding one cannot switch anything on.
    percentage: 0,
    startText: "",
    endText: "",
    returnValue: undefined,
    isNew: true,
  }
}

/** What is wrong with a schedule's times, or undefined. Shown under its fields. */
export function scheduleProblem(rule: DraftRule): string | undefined {
  const start = scheduleTime(rule.startText, rule.startAt)
  const end = scheduleTime(rule.endText, rule.endAt)
  if (rule.startText === "" && rule.endText === "") {
    return "A schedule needs a start, an end, or both."
  }
  if (
    (rule.startText !== "" && start === undefined) ||
    (rule.endText !== "" && end === undefined)
  ) {
    return "Enter the time as a date and a time."
  }
  if (
    start !== undefined &&
    end !== undefined &&
    !(Date.parse(start) < Date.parse(end))
  ) {
    return "The start must be before the end."
  }
  return undefined
}

/**
 * What is wrong with one rule, in a sentence, or undefined when it is fine.
 * These mirror what the server refuses (`validateRule`), so a request that
 * would come back BAD_REQUEST is stopped here with the same reason.
 */
export function problemWith(rule: DraftRule): string | undefined {
  if (rule.kept !== undefined && !isKeptType(rule.type)) {
    return `Its type ${rule.type} is not one the server accepts. Remove it.`
  }
  switch (rule.type) {
    case "when_tenant":
      if (rule.tenantIds.length === 0) return "Add at least one tenant id."
      break
    case "when_user":
      if (rule.userIds.length === 0) return "Add at least one user id."
      break
    case "rollout":
      if (rule.percentage === undefined) {
        return `The percentage must be a whole number from ${MIN_PERCENTAGE} to ${MAX_PERCENTAGE}.`
      }
      break
    case "schedule": {
      const problem = scheduleProblem(rule)
      if (problem !== undefined) return problem
      break
    }
  }
  if (rule.returnValue === undefined) return "It needs a return value."
  return undefined
}

/** The first row with a problem, as the sentence the save button gives. */
export function firstProblem(rules: DraftRule[]): string | undefined {
  for (let i = 0; i < rules.length; i += 1) {
    const problem = problemWith(rules[i]!)
    if (problem !== undefined) return `Rule ${i + 1}: ${problem}`
  }
  return undefined
}

/** One rule on the `flags.setRules` wire. */
export interface RulePayload {
  type: string
  tenantIds?: string[]
  userIds?: string[]
  percentage?: number
  startAt?: string
  endAt?: string
  tagKey?: string
  tagValue?: string
  evaluator?: string
  params?: Record<string, unknown>
  returnValue: unknown
}

/**
 * The request rule for one draft row: its type's fields and nothing else.
 * (The server keeps only what a type reads, so sending the rest would be
 * noise.) A type the editor has no form for is sent back with every field it
 * was read with.
 */
export function payloadOf(rule: DraftRule): RulePayload {
  const { kept } = rule
  if (kept !== undefined) {
    return {
      type: kept.type,
      ...(kept.tenantIds.length > 0 ? { tenantIds: kept.tenantIds } : {}),
      ...(kept.userIds.length > 0 ? { userIds: kept.userIds } : {}),
      ...(kept.percentage !== 0 ? { percentage: kept.percentage } : {}),
      ...(kept.startAt ? { startAt: kept.startAt } : {}),
      ...(kept.endAt ? { endAt: kept.endAt } : {}),
      ...(kept.tagKey ? { tagKey: kept.tagKey } : {}),
      ...(kept.tagValue ? { tagValue: kept.tagValue } : {}),
      ...(kept.evaluator ? { evaluator: kept.evaluator } : {}),
      ...(kept.params !== undefined ? { params: kept.params } : {}),
      returnValue: rule.returnValue,
    }
  }
  switch (rule.type) {
    case "when_tenant":
      return {
        type: rule.type,
        tenantIds: rule.tenantIds,
        returnValue: rule.returnValue,
      }
    case "when_user":
      return {
        type: rule.type,
        userIds: rule.userIds,
        returnValue: rule.returnValue,
      }
    case "rollout":
      return {
        type: rule.type,
        percentage: rule.percentage,
        returnValue: rule.returnValue,
      }
    default: {
      const startAt = scheduleTime(rule.startText, rule.startAt)
      const endAt = scheduleTime(rule.endText, rule.endAt)
      return {
        type: rule.type,
        ...(startAt === undefined ? {} : { startAt }),
        ...(endAt === undefined ? {} : { endAt }),
        returnValue: rule.returnValue,
      }
    }
  }
}

/** The whole draft as the request's list, in display order. */
export function payloadOfAll(rules: DraftRule[]): RulePayload[] {
  return rules.map(payloadOf)
}

/**
 * Whether the draft differs from what is saved. Compared as what would be
 * sent, so dragging a row away and back, or typing a value and retyping it,
 * is not a change.
 */
export function isChanged(
  draft: DraftRule[],
  saved: FlagRuleSummary[]
): boolean {
  return (
    JSON.stringify(payloadOfAll(draft)) !==
    JSON.stringify(payloadOfAll(draftFromSaved(saved)))
  )
}

/** A draft row as the read-mode summary component takes it. */
export function summaryOf(rule: DraftRule): FlagRuleSummary {
  return {
    id: rule.uid,
    priority: 0,
    type: rule.type,
    implemented: rule.implemented,
    tenantIds: rule.tenantIds,
    userIds: rule.userIds,
    percentage: rule.percentage ?? 0,
    startAt: scheduleTime(rule.startText, rule.startAt),
    endAt: scheduleTime(rule.endText, rule.endAt),
    tagKey: rule.kept?.tagKey,
    tagValue: rule.kept?.tagValue,
    evaluator: rule.kept?.evaluator,
    params: rule.kept?.params,
    returnValue: rule.returnValue,
    returnMatchesType: true,
  }
}
