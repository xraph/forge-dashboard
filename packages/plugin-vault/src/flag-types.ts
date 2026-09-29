import type { FlagSummary } from "./pages/flags"

/** The five value types a flag can have. Mirrors the Go `flag.Type`. */
export const FLAG_TYPES = ["bool", "string", "int", "float", "json"] as const

export type FlagType = (typeof FLAG_TYPES)[number]

export function isFlagType(value: string): value is FlagType {
  return (FLAG_TYPES as readonly string[]).includes(value)
}

/**
 * Mirrors the Go `FlagRuleSummary`. Field names are its JSON tags.
 *
 * The engine walks rules in the order `flags.detail` returns them, so a list
 * of these is rendered as given and never re-sorted: `priority` is what the
 * store holds, the position in the list is what the engine does.
 */
export interface FlagRuleSummary {
  id: string
  priority: number
  /** `when_tenant`, `when_user`, `rollout`, `schedule`, `when_tenant_tag` or `custom`. */
  type: string
  /** False for the types the engine can never match. */
  implemented: boolean
  tenantIds: string[]
  userIds: string[]
  percentage: number
  /** UTC RFC3339. Absent for an open end. */
  startAt?: string
  endAt?: string
  tagKey?: string
  tagValue?: string
  evaluator?: string
  params?: Record<string, unknown>
  returnValue: unknown
  /** False when `returnValue` is not a value of the flag's type. */
  returnMatchesType: boolean
}

/** Mirrors the Go `FlagOverrideSummary`. */
export interface FlagOverrideSummary {
  tenantId: string
  value: unknown
  /** False when `value` is not a value of the flag's type. */
  valueMatchesType: boolean
  updatedAt: string
}

/** Mirrors the Go `FlagVariantSummary`. */
export interface FlagVariantSummary {
  value: unknown
  description: string
}

/** Mirrors the Go `AuditSummary`. Shared by the secret and flag detail pages. */
export interface AuditEntry {
  id: string
  action: string
  outcome: string
  userId?: string
  createdAt: string
}

/**
 * Mirrors the Go `flagsDetailResponse`. `rules` is in the order the engine
 * walks them, `overrides` in tenant order. Lists are never null.
 */
export interface FlagDetail {
  flag: FlagSummary
  variants: FlagVariantSummary[]
  metadata: Record<string, string>
  rules: FlagRuleSummary[]
  overrides: FlagOverrideSummary[]
  recentAudit: AuditEntry[]
  /** How long the engine caches an evaluation, in seconds. */
  cacheTtlSeconds: number
}

/** Why an evaluation answered the way it did, in the order the engine reaches them. */
export type EvaluationReason = "disabled" | "tenantOverride" | "rule" | "default"

/**
 * Mirrors the Go `FlagTraceStep`: one rule the engine looked at, in the order
 * it walked them. `reached` is false for the rules after the one that matched,
 * which the engine lists but never checks (and gives no `note`).
 */
export interface FlagTraceStep {
  priority: number
  type: string
  matched: boolean
  reached: boolean
  note: string
}

/**
 * Mirrors the Go `flagsEvaluateResponse`. `trace` is never null and is empty
 * for `disabled` and `tenantOverride`. `bucket` is present only when a tenant
 * was given.
 */
export interface FlagEvaluation {
  value: unknown
  valueMatchesType: boolean
  reason: EvaluationReason
  /** Present only when `reason` is `rule`. */
  matchedRulePriority?: number
  trace: FlagTraceStep[]
  bucket?: number
  evaluatedAt: string
}
