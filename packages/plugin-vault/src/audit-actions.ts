import type { AuditEntry } from "./flag-types"

/** The five kinds of thing the audit log is about. Mirrors the vault's `resource` column. */
export const AUDIT_RESOURCES = [
  "secret",
  "flag",
  "config",
  "override",
  "rotation",
] as const

export type AuditResource = (typeof AUDIT_RESOURCES)[number]

/**
 * Every action the vault writes to the audit log, in the order the filter
 * offers them: secrets, flags, config, overrides, rotation policies.
 *
 * Fifteen were written before rotation existed. `secret.rotated`,
 * `rotation.policy_saved` and `rotation.policy_deleted` are the three that
 * came with it, and `secret.rotated` is the one the overview links to when a
 * rotation failed. The strings are exact: the server matches them verbatim.
 */
export const AUDIT_ACTIONS = [
  "secret.get",
  "secret.set",
  "secret.delete",
  "secret.rotated",
  "flag.created",
  "flag.updated",
  "flag.toggled",
  "flag.deleted",
  "flag.rules_set",
  "flag.override_set",
  "flag.override_deleted",
  "config.set",
  "config.rolled_back",
  "config.deleted",
  "override.set",
  "override.deleted",
  "rotation.policy_saved",
  "rotation.policy_deleted",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_OUTCOMES = ["success", "failure"] as const

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

export function isAuditResource(value: string): value is AuditResource {
  return (AUDIT_RESOURCES as readonly string[]).includes(value)
}

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}

export function isAuditOutcome(value: string): value is AuditOutcome {
  return (AUDIT_OUTCOMES as readonly string[]).includes(value)
}

/**
 * Whether an action removed its key. A removed secret, flag or config entry has
 * no page to link to, so a delete row shows its key as plain text.
 */
export function isDeleteAction(action: string): boolean {
  return action === "secret.delete" || action.endsWith(".deleted")
}

/** Mirrors the Go `auditListResponse`. `total` counts every row the filters match, not the page. */
export interface AuditList {
  entries: AuditEntry[]
  total: number
}
