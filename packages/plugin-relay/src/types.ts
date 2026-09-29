// Response shapes of relay's contract, from extension/contract. Field names
// are the Go JSON tags.
import type { Attempt } from "./components/retry-timeline"

export type { Attempt }

export interface DeliverySummary {
  id: string
  eventId: string
  endpointId: string
  endpointUrl: string
  eventType: string
  tenantId: string
  state: string
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: string
  lastStatusCode: number
  lastError?: string
  lastLatencyMs: number
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface DeliveriesPage {
  deliveries: DeliverySummary[]
  nextCursor?: string
  complete: boolean
}

export interface DeliveryDetail extends DeliverySummary {
  lastResponse?: string
  endpointEnabled?: boolean
  attempts: Attempt[]
}

export interface EventSummary {
  id: string
  type: string
  tenantId: string
  idempotencyKey?: string
  createdAt: string
}

export interface EventsPage {
  events: EventSummary[]
  nextCursor?: string
  complete: boolean
}

export interface EventDetail extends EventSummary {
  data: unknown
  scopeAppId?: string
  scopeOrgId?: string
  deliveries: DeliverySummary[]
}

export interface EventTypeSummary {
  id: string
  name: string
  description: string
  group?: string
  version: string
  schemaVersion?: string
  hasSchema: boolean
  deprecated: boolean
  deprecatedAt?: string
  createdAt: string
  updatedAt: string
}

export interface EventTypeDetail extends EventTypeSummary {
  schema?: unknown
  example?: unknown
  metadata?: Record<string, string>
  scopeAppId?: string
}

export interface DLQEntrySummary {
  id: string
  deliveryId: string
  eventId: string
  endpointId: string
  eventType: string
  tenantId: string
  url: string
  error?: string
  attemptCount: number
  lastStatusCode: number
  replayedAt?: string
  failedAt: string
}

export interface DLQPage {
  entries: DLQEntrySummary[]
  nextCursor?: string
  complete: boolean
}

export interface DLQEntryDetail extends DLQEntrySummary {
  payload: unknown
}

export interface OverviewStats {
  eventTypes: number
  endpoints: number
  pending: number
  deadLetters: number
}

export interface SettingsConfig {
  concurrency: number
  batchSize: number
  maxRetries: number
  pollIntervalMs: number
  maxPollIntervalMs: number
  requestTimeoutMs: number
  shutdownTimeoutMs: number
  cacheTtlMs: number
  retryScheduleMs: number[]
  signature: {
    algorithm: string
    header: string
    timestampHeader: string
    format: string
    signedContent: string
  }
}

export interface Ack {
  ok: boolean
  id?: string
}
