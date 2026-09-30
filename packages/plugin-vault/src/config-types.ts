import type { AuditEntry } from "./flag-types"

/**
 * The six value types a config entry can have. Mirrors the Go `config.Type`.
 *
 * This is deliberately its own union and not `FlagType` with one more member:
 * the two evolve on their own (flags have no duration), and a shared type
 * would make adding one to either silently widen the other's forms.
 * `ValueInput` takes this union, of which every `FlagType` is a member.
 */
export const CONFIG_TYPES = [
  "string",
  "int",
  "float",
  "bool",
  "json",
  "duration",
] as const

export type ConfigType = (typeof CONFIG_TYPES)[number]

export function isConfigType(value: string): value is ConfigType {
  return (CONFIG_TYPES as readonly string[]).includes(value)
}

/**
 * Mirrors the Go `ConfigEntrySummary`. Field names are its JSON tags.
 * Timestamps are RFC3339 UTC strings.
 */
export interface ConfigEntrySummary {
  id: string
  key: string
  /** Whatever the entry stores. It is not guaranteed to match `valueType`. */
  value: unknown
  /**
   * Any string the server holds. Narrow with `isConfigType` (or read
   * `knownType`) before using it as one of the six.
   */
  valueType: string
  /** False when `valueType` is not one of the six the vault understands. */
  knownType: boolean
  /** False when the stored value is not a value of `valueType`. */
  valueMatchesType: boolean
  version: number
  description: string
  metadata: Record<string, string>
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `configListResponse`. Lists are never null. */
export interface ConfigList {
  entries: ConfigEntrySummary[]
  total: number
}

/** Mirrors the Go `OverrideSummary`: one tenant's value for one key. */
export interface OverrideSummary {
  key: string
  tenantId: string
  value: unknown
  /** False when `value` is not a value of the entry's type. */
  valueMatchesType: boolean
  /** False when no entry holds this key any more. */
  keyExists: boolean
  updatedAt: string
}

/** Mirrors the Go `configDetailResponse`. Lists are never null. */
export interface ConfigDetail {
  entry: ConfigEntrySummary
  overrides: OverrideSummary[]
  recentAudit: AuditEntry[]
}

/** One row of `config.versions`. */
export interface ConfigVersion {
  version: number
  /** What the entry held at that version. It may not match the entry's type now. */
  value: unknown
  /** Whether that value is a value of the entry's CURRENT type. */
  valueMatchesType: boolean
  createdAt: string
  current: boolean
}

/** Mirrors the Go `configVersionsResponse`, newest first. */
export interface ConfigVersions {
  versions: ConfigVersion[]
}
