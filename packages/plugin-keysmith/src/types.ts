/*
 * Wire types for the keysmith contract. They mirror the Go structs in
 * keysmith/extension/contract/project.go and handlers_keys.go. A Go field
 * tagged `omitempty` is optional here; the detail response's `policy` is an
 * explicit null when the key has none.
 */

export type KeyState = "active" | "suspended" | "revoked" | "expired"

export type Environment = "live" | "test" | "staging"

export interface KeySummary {
  id: string
  name: string
  description?: string
  prefix: string
  hint: string
  environment: string
  /** The state as stored. The engine can also store states the page never filters on. */
  state: string
  /** What the page shows: a revoked_at wins, and a lapsed active key reads expired. */
  effectiveState: KeyState
  /** Effective state is expired but nothing has written that state yet. */
  expiryPending: boolean
  /** Active and expiring within 7 days. */
  expiresSoon: boolean
  policyId?: string
  scopes: string[]
  createdBy?: string
  expiresAt?: string
  lastUsedAt?: string
  rotatedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PolicyRef {
  id: string
  name: string
  /** null when the policy sets no maximum. Never 0: the engine reads 0 as unset. */
  maxKeyLifetimeSeconds: number | null
  /** null when the policy sets no grace, and rotation then uses 24 hours. */
  graceSeconds: number | null
}

/** An open rotation window: the old key still validates until `graceEnds`. */
export interface PreviousKey {
  /**
   * Can be "": when keys.rotate cannot read the windows back after rotating,
   * it answers the new window as it computed it, with no rotation ID.
   */
  rotationId: string
  hint: string
  reason: string
  rotatedAt: string
  graceEnds: string
}

export interface KeysList {
  keys: KeySummary[]
  total: number
}

export interface KeyDetail {
  key: KeySummary
  policy: PolicyRef | null
  metadata: Record<string, unknown>
  previousKeys: PreviousKey[]
}

/** A policy as the key forms' picker shows it. Mirrors contract.PolicySummary. */
export interface PolicySummary {
  id: string
  name: string
  description?: string
  /** null when the policy sets no maximum. Never 0: the engine reads 0 as unset. */
  maxKeyLifetimeSeconds: number | null
  /** null when the policy sets no grace, and rotation then uses 24 hours. */
  graceSeconds: number | null
  /** Never null on the wire; an empty list means the policy allows any scope. */
  allowedScopes: string[]
}

/** A scope as the key forms' picker shows it. Mirrors contract.ScopeSummary. */
export interface ScopeSummary {
  id: string
  name: string
  parent?: string
  description?: string
}

export interface PoliciesList {
  policies: PolicySummary[]
  hasMore: boolean
  /**
   * False when the engine has no rate limiter, so a policy's rate limit is
   * stored but not enforced in this deployment.
   */
  rateLimiterConfigured: boolean
}

/**
 * Every policy field the editor and the detail page show. Mirrors
 * contract.PolicyDetail. An unset duration or count is null, never 0: the
 * engine reads 0 as unset. Lists are never null on the wire.
 */
export type PolicyDetail = {
  id: string
  name: string
  description?: string
  maxKeyLifetimeSeconds: number | null
  /** null means rotation uses 24 hours. */
  graceSeconds: number | null
  /** An empty list means the policy allows any scope. */
  allowedScopes: string[]
  rateLimit: number | null
  rateLimitWindowSeconds: number | null
  burstLimit: number | null
  allowedIps: string[]
  allowedOrigins: string[]
  allowedMethods: string[]
  allowedPaths: string[]
  rotationPeriodSeconds: number | null
  dailyQuota: number | null
  monthlyQuota: number | null
  createdAt: string
  updatedAt: string
}

/** policies.detail. */
export type PolicyDetailResponse = {
  policy: PolicyDetail
  /** Every key in the tenant on this policy, revoked or not. */
  keysUsing: number
  /** The keys on it that are not revoked. While above 0, policies.delete refuses. */
  keysBlockingDelete: number
  rateLimiterConfigured: boolean
}

/** The fields policies.create and policies.update carry. */
export type PolicyFields = Partial<
  Omit<PolicyDetail, "id" | "createdAt" | "updatedAt">
>

export interface ScopesList {
  scopes: ScopeSummary[]
  hasMore: boolean
}

/** keys.create. `rawKey` is on the wire exactly once and is shown only by OneTimeKey. */
export interface KeyWithSecret {
  key: KeySummary
  rawKey: string
}

/** keys.rotate. `previousKeys` is every window open after the rotation. */
export interface KeyRotated {
  key: KeySummary
  rawKey: string
  previousKeys: PreviousKey[]
}

/** keys.endGrace: how many rotation windows were closed. */
export interface KeyGraceClosed {
  key: KeySummary
  closed: number
}

/**
 * keys.suspend, keys.reactivate, keys.revoke, keys.scopes.assign and
 * keys.scopes.remove answer with just the key.
 */
export interface KeyOnly {
  key: KeySummary
}

export type RotationReason = "manual" | "compromise" | "policy" | "scheduled"

/**
 * One rotation as rotations.list answers it. Mirrors contract.RotationItem.
 * Neither key's hash is carried; the masked forms are built here from the
 * prefix, environment and hints.
 */
export interface RotationItem {
  id: string
  keyId: string
  /** null, with prefix and environment, when the key no longer exists in this tenant. */
  keyName: string | null
  prefix: string | null
  environment: string | null
  /** "" on records written before hints existed. */
  oldHint: string
  /** "" likewise. */
  newHint: string
  /** A RotationReason, or a value this page does not know by name. */
  reason: string
  /** 0 is a real zero-grace rotation, not unset. */
  graceSeconds: number
  graceEnds: string
  /**
   * The window is still running: the key exists and is neither expired nor
   * revoked, the record has an old hint, and graceEnds is ahead. A suspended
   * key's window counts as open, though its old key is refused until the key
   * is reactivated. Always false when keyName is null.
   */
  windowOpen: boolean
  rotatedBy?: string
  rotatedAt: string
}

/** rotations.list, newest first. No total: hasMore says whether a next page exists. */
export interface RotationsList {
  items: RotationItem[]
  hasMore: boolean
}

export type UsagePeriod = "hourly" | "daily" | "monthly"

/**
 * One UTC bucket of usage.series. Every bucket in the range is present,
 * empty ones included, so a quiet hour reads as zero and not as missing.
 */
export interface UsageBucket {
  /** RFC3339 UTC: the start of the hour, day or month. */
  start: string
  requests: number
  /** Status 400 to 499. */
  clientErrors: number
  /** Status 500 and up. */
  serverErrors: number
  /** Status below 400, so a redirect counts as succeeded. */
  succeeded: number
  /** The mean rounded down; null for an empty bucket. */
  avgLatencyMs: number | null
}

/** usage.series. */
export interface UsageSeries {
  /** Echoes the request. */
  period: UsagePeriod
  /** Ascending, never null. */
  buckets: UsageBucket[]
  /**
   * False when the tenant has no usage rows at all, at any time, for any
   * key: the application has never called RecordUsage. Not the same as a
   * range with no requests in it.
   */
  recorded: boolean
}

/** One recorded request. Mirrors contract.UsageRecordItem. */
export interface UsageRecordItem {
  id: string
  keyId: string
  method: string
  endpoint: string
  statusCode: number
  /** Whole milliseconds, truncated. */
  latencyMs: number
  /** Left out when the application recorded none. */
  ipAddress?: string
  /** RFC3339 UTC. */
  at: string
}

/** usage.records, newest first. `total` counts every matching row, unpaged. */
export interface UsageRecords {
  items: UsageRecordItem[]
  total: number
}

/**
 * The tenant's keys by effective state, as their badges show it. An active
 * key past its expiry that nothing has marked yet counts as expired, and one
 * with a revokedAt counts as revoked, whatever the stored state says.
 */
export interface OverviewCounts {
  active: number
  suspended: number
  revoked: number
  expired: number
}

/** overview. Mirrors contract.overviewResponse. */
export interface Overview {
  counts: OverviewCounts
  /** Counted by the same rule as rotations.list's windowOpen. */
  openGraceWindows: number
  /** Active keys that keys.list flags expiresSoon. */
  expiringWithin7Days: number
  /**
   * null when the tenant has never recorded usage, so silence does not read
   * as a quiet day. 0 when it has, just not in the last 24 hours.
   */
  requestsLast24h: number | null
  /** Newest first, at most 5, projected exactly as keys.list projects them. */
  recentKeys: KeySummary[]
  /** Newest first, at most 5, projected exactly as rotations.list projects them. */
  recentRotations: RotationItem[]
  /** How many of policyFields this deployment enforces: 3, or 5 with a rate limiter. */
  enforcedFields: number
  policyFields: number
}

/**
 * One policy field and whether this deployment enforces it. Mirrors
 * contract.EnforcementRow. `when` is set exactly when `enforced` is true.
 */
export interface EnforcementRow {
  /** The wire name the policy commands take. */
  field: string
  /** The policy editor's label for it. */
  label: string
  /**
   * The editor's group: "keysmith", "rateLimiter" or "application". Typed
   * loosely so a group this page does not know still renders.
   */
  group: string
  enforced: boolean
  /** "when a key is created" and the like; "" when not enforced. */
  when: string
}

/** settings. Mirrors contract.settingsResponse. Read-only. */
export interface Settings {
  /** The hook plugins' names, sorted. [] when none. */
  plugins: string[]
  storeHealthy: boolean
  /** One of two fixed sentences. The driver's error is only in the server log. */
  storeMessage: string
  rateLimiterConfigured: boolean
  /** "claim" when the request carried a tenant_id claim, else "config". */
  tenantSource: "claim" | "config"
  tenant: string
  /** Every policy field, in the editor's order, groups top to bottom. */
  enforcement: EnforcementRow[]
  /** 3, or 5 with a rate limiter. */
  enforcedFields: number
  /** The grace a rotation gets when neither it nor the key's policy names one. */
  defaultGraceSeconds: number
}
