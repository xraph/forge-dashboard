import type { PolicySummary } from "./types"
import { LIMITS } from "./types"

/** "*" is every category, and it is a choice the operator makes, not a default. */
export function categoryLabel(c: string): string {
  return c === "*" ? "Every category (*)" : c
}

/** Whose events a policy removes: an app-level policy has no tenant, so it reaches all of them. */
export function policyScopeLabel(p: PolicySummary): string {
  return p.tenantId ? `Tenant ${p.tenantId}` : "App level, every tenant"
}

/**
 * chronicle's rule: "*" or 1 to 64 characters with no ':', no control
 * characters, no edge spaces. The control range includes the C1 block because
 * the server tests Unicode's Cc class, which covers U+0080 to U+009F as well.
 */
export function categoryProblem(c: string): string | null {
  if (c === "*") return null
  if (c === "") return "A category is required."
  if (c !== c.trim()) return "A category cannot start or end with a space."
  if ([...c].length > LIMITS.policyCategory) return `A category is at most ${LIMITS.policyCategory} characters.`
  if (c.includes(":")) return "A category cannot contain ':'."
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(c)) return "A category cannot contain control characters."
  return null
}

export type DurationUnit = "hours" | "days"

/** The longest a Go duration can be: the largest int64 of nanoseconds, in whole hours. */
export const MAX_HOURS = 2_562_047

/** What is wrong with a duration typed as an amount and a unit, or null. An empty amount is not yet a problem, only not ready. */
export function durationProblem(amount: string, unit: DurationUnit): string | null {
  if (amount === "") return null
  if (!/^\d+$/.test(amount)) return "Enter a whole number of hours or days."
  const n = Number(amount)
  if (n === 0) return "A duration must be greater than zero."
  if (n * (unit === "days" ? 24 : 1) > MAX_HOURS) return "That is longer than a duration can be."
  return null
}

/** The Go duration string the server parses: always whole hours, "48h" or "720h". */
export function goDuration(amount: string, unit: DurationUnit): string {
  return `${Number(amount) * (unit === "days" ? 24 : 1)}h`
}

/**
 * A server duration as an amount and unit, in days when it is a whole number
 * of them. Null when it is not a whole number of hours ("1h30m0s"), which the
 * form has no way to show.
 */
export function splitDuration(duration: string): { amount: string; unit: DurationUnit } | null {
  const m = /^(\d+)h0m0s$/.exec(duration)
  if (!m) return null
  const hours = Number(m[1])
  if (hours === 0) return null
  return hours % 24 === 0 ? { amount: String(hours / 24), unit: "days" } : { amount: String(hours), unit: "hours" }
}
