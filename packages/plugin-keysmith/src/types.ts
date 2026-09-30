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
  maxKeyLifetimeSeconds: number
  graceSeconds: number
}

/** An open rotation window: the old key still validates until `graceEnds`. */
export interface PreviousKey {
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
