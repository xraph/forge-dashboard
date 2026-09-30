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
