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
