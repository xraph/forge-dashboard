import type { Environment, KeyState } from "./types"

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
