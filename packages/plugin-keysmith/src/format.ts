import type { Environment, KeyState, PolicyDetail } from "./types"

/**
 * A key as a person may see it: prefix, environment, then only the hint.
 * The raw key is never on the wire, so this is all there is to show.
 */
export function maskedKey(k: {
  prefix: string
  environment: string
  hint: string
}): string {
  return `${k.prefix}_${k.environment}_…${k.hint}`
}

/** The detail page for one key. The id is encoded so a stray "/" cannot change the route. */
export function keyPath(id: string): string {
  return `/keys/${encodeURIComponent(id)}`
}

/** The page for one policy. Encoded for the same reason as keyPath. */
export function policyPath(id: string): string {
  return `/policies/${encodeURIComponent(id)}`
}

export const STATE_LABEL: Record<KeyState, string> = {
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
  expired: "Expired",
}

/** The states a list can be filtered on. The engine never assigns "rotated". */
export const STATES: { value: KeyState; label: string }[] = [
  { value: "active", label: STATE_LABEL.active },
  { value: "suspended", label: STATE_LABEL.suspended },
  { value: "revoked", label: STATE_LABEL.revoked },
  { value: "expired", label: STATE_LABEL.expired },
]

export const ENVIRONMENTS: { value: Environment; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "test", label: "Test" },
  { value: "staging", label: "Staging" },
]

/**
 * A length of time as people say it: the largest unit that divides the
 * seconds exactly, so 90 days stays "90 days" and 25 hours does not become
 * "1 day". Never rounds.
 */
export function formatDuration(seconds: number): string {
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ]
  for (const [size, name] of units) {
    if (seconds !== 0 && seconds % size === 0) {
      const n = seconds / size
      return `${n} ${name}${n === 1 ? "" : "s"}`
    }
  }
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`
}

export type DurationUnit = "seconds" | "minutes" | "hours" | "days"

const UNIT_SECONDS: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
}

/**
 * Seconds as a form shows them: a whole number and one of the units the form
 * offers. The largest offered unit that divides exactly wins, so 86400 reads
 * "1 day" and 61 seconds stays "61 seconds". Never rounds.
 *
 * Unset (null) is a blank value in the last unit offered, the one a person
 * most likely types in. Zero is "0" in the smallest unit offered. When no
 * offered unit divides exactly (90 minutes against hours and days), this
 * answers the exact seconds in "seconds", which a form whose list lacks
 * seconds has to offer for that value rather than round it away.
 */
export function splitDuration(
  seconds: number | null,
  units: DurationUnit[],
): { value: string; unit: DurationUnit } {
  if (seconds === null) {
    return { value: "", unit: units[units.length - 1] ?? "seconds" }
  }
  const bySize = [...units].sort((a, b) => UNIT_SECONDS[b] - UNIT_SECONDS[a])
  if (seconds === 0) {
    return { value: "0", unit: bySize[bySize.length - 1] ?? "seconds" }
  }
  for (const unit of bySize) {
    if (seconds % UNIT_SECONDS[unit] === 0) {
      return { value: String(seconds / UNIT_SECONDS[unit]), unit }
    }
  }
  return { value: String(seconds), unit: "seconds" }
}

/**
 * What a duration field holds, in seconds. Blank is null (unset). Anything
 * that is not a whole non-negative number, or that overflows a safe integer,
 * is NaN so the form can refuse it with the server's wording.
 */
export function toSeconds(value: string, unit: DurationUnit): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return NaN
  const seconds = Number(trimmed) * UNIT_SECONDS[unit]
  return Number.isSafeInteger(seconds) ? seconds : NaN
}

/**
 * A rate limit as people say it: "100 per 1 minute". Null when the policy sets
 * none (the engine reads 0 as unset too). A limit stored with no window, which
 * the contract now refuses but an older row can hold, says so.
 */
export function formatRateLimit(
  p: Pick<PolicyDetail, "rateLimit" | "rateLimitWindowSeconds">,
): string | null {
  if (!p.rateLimit) return null
  if (!p.rateLimitWindowSeconds) return `${p.rateLimit} with no window`
  return `${p.rateLimit} per ${formatDuration(p.rateLimitWindowSeconds)}`
}
