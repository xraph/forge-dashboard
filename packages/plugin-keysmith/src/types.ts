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

export type RotationReason = "manual" | "compromise" | "policy"
