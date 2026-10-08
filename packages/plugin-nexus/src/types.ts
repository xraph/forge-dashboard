export type MoneyUSD = string
export type Timestamp = string | null
export type TenantStatus = "active" | "disabled" | "suspended"
export type KeyStatus = "active" | "revoked" | "expired"
export type Outcome = "ok" | "cached" | "blocked" | "refused" | "error"
export type Period = "day" | "week" | "month"
export interface Page<T> {
  items: T[]
  nextCursor: string
}
export interface Quota {
  rpm: number
  tpm: number
  dailyRequests: number
  monthlyBudgetUsd: MoneyUSD
  maxTokensPerReq: number
  maxStreamDurationMs: number
  maxStreamTokens: number
}
export interface TenantConfig {
  allowedModels: string[]
  blockedModels: string[]
  defaultModel: string
  routingStrategy: string
  routingStrategyEnforced: boolean
  guardrailPolicy: string
  guardrailPolicyEnforced: boolean
  cacheEnabled: boolean | null
  metadata: Record<string, string> | null
}
export interface Tenant {
  id: string
  name: string
  slug: string
  status: TenantStatus
  quota: Quota
  config: TenantConfig
  metadata: Record<string, string> | null
  createdAt: Timestamp
  updatedAt: Timestamp
  monthSpendUsd: MoneyUSD | null
  requestsToday: number | null
  usageEnabled: boolean
}
export interface APIKey {
  id: string
  tenantId: string
  tenantName: string
  name: string
  prefix: string
  scopes: string[]
  status: KeyStatus
  expiresAt: Timestamp
  lastUsedAt: Timestamp
  createdAt: Timestamp
  metadata: Record<string, string> | null
}
export interface SecretKeyResult {
  key: APIKey
  rawKey: string
  revokedKeyId?: string
}
export interface Posture {
  requireApiKey: boolean
  authenticationScope: string
  limiterKind: string
  usageEnabled: boolean
  guardCount: number
  cacheKind: string
}
export interface Overview {
  tenants: {
    total: number
    active: number
    disabled: number
    suspended: number
  }
  activeKeys: number
  monthSpendUsd: MoneyUSD | null
  unpricedRequests: number | null
  requestsToday: number | null
  byOutcome: Record<Outcome, number> | null
  outcomePeriod: string
  posture: Posture
  insertErrors: number
  limiterErrors: number
}
export interface Aggregate {
  name: string
  requests: number
  tokens: number
  costUsd: MoneyUSD
  unpriced: number
}
export interface UsageSummary {
  tenantId: string | null
  period: Period
  usageEnabled: boolean
  totalRequests: number | null
  totalTokens: number | null
  totalCostUsd: MoneyUSD | null
  unpricedRequests: number | null
  cacheHitRate: number | null
  avgLatencyMs: number | null
  byOutcome: Record<Outcome, number> | null
  byProvider: Aggregate[]
  byModel: Aggregate[]
}
export interface SeriesPoint {
  start: Timestamp
  requests: number
  tokens: number
  costUsd: MoneyUSD
  unpriced: number
}
export interface UsageSeries {
  usageEnabled: boolean
  items: SeriesPoint[]
}
export interface UsageRecord {
  id: string
  tenantId: string | null
  keyId: string | null
  requestId: string | null
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: MoneyUSD | null
  pricingStatus: string
  outcome: Outcome
  blockedBy: string
  refusalCode: string
  latencyMs: number
  cached: boolean
  statusCode: number
  createdAt: Timestamp
}
export interface UsageRecords extends Page<UsageRecord> {
  usageEnabled: boolean
}
export interface Capabilities {
  chat: boolean
  streaming: boolean
  embeddings: boolean
  images: boolean
  vision: boolean
  tools: boolean
  json: boolean
  audio: boolean
  thinking: boolean
  batch: boolean
  streamingReasoning: boolean
  streamingTools: boolean
  streamingAudio: boolean
  streamingCitations: boolean
  realtimeAudio: boolean
  realtimeVideo: boolean
  liveBidi: boolean
}
export interface Model {
  id: string
  provider: string
  name: string
  capabilities: Capabilities
  contextWindow: number
  maxOutput: number
  priced: boolean
  free: boolean
  inputPerMillionUsd: MoneyUSD | null
  outputPerMillionUsd: MoneyUSD | null
  embeddingPerMillionUsd: MoneyUSD | null
}
export interface Provider {
  name: string
  capabilities: Capabilities
  modelCount: number
  requests: number | null
  errors: number | null
}
export interface Providers {
  items: Provider[]
  usageEnabled: boolean
  from: Timestamp
  to: Timestamp
}
export interface AliasTarget {
  provider: string
  model: string
  weight: number
}
export interface Gateway {
  stages: { name: string; priority: number; terminal: boolean }[]
  stagesAvailable: boolean
  routingStrategy: string
  routingCaveats: string[]
  guards: { name: string; phase: string }[]
  guardCaveats: string[]
  cache: {
    kind: string
    streamKind: string
    hits: number | null
    misses: number | null
    hitRate: number | null
    size: number | null
    bytes: number | null
    statsScope: string
  }
  aliases: {
    name: string
    targets: AliasTarget[]
    tenantOverrides: Record<string, AliasTarget[]>
  }[]
  transforms: { name: string; phase: string; streaming: boolean }[]
  posture: Posture
  enforcementCaveats: string[]
}
export interface Settings {
  basePath: string
  defaultTimeoutMs: number
  defaultMaxRetries: number
  globalRateLimit: number
  usageEnabled: boolean
  cacheEnabled: boolean
  requireApiKey: boolean
  logLevel: string
  authenticationScope: string
}
