// Field names are the Go JSON tags in chronicle's extension/contract. Every
// type here is hand-written against chronicle main. Optional (?) means the Go
// field is a pointer or omitempty, so the key can be absent.

export type VerifyLevel = "unkeyed" | "keyed" | "signed" | "anchored"

export interface CheckpointSummary {
  id: string
  fromSeq: number
  toSeq: number
  eventCount: number
  createdAt: string
  signKeyId: string
}

export interface StreamSummary {
  id: string
  appId: string
  tenantId?: string
  headHash: string
  headSeq: number
  scheme: string
  schemeSince: number
  coverageCeiling: VerifyLevel
  latestCheckpoint?: CheckpointSummary
  checkpointingConfigured: boolean
}

export interface MineResponse { stream?: StreamSummary }
export interface StreamListResponse { streams: StreamSummary[]; total: number; hasMore: boolean }

export interface CoverageSpan { fromSeq: number; toSeq: number; level: VerifyLevel; note?: string }

export interface CheckpointResult {
  id: string
  fromSeq: number
  toSeq: number
  signatureValid: boolean
  hashMatch: boolean
  hashChecked: boolean
  continuityOk: boolean
  continuityChecked: boolean
  note?: string
}

export interface RetainedRange {
  fromSeq: number
  toSeq: number
  recordSeq: number
  policyId?: string
  backfill?: string
}

export interface VerifyReport {
  valid: boolean
  verified: number
  gaps?: number[]
  tampered?: number[]
  downgrades?: number[]
  tolerant?: number[]
  retained?: RetainedRange[]
  firstEvent: number
  lastEvent: number
  headSeq: number
  partial: boolean
  headMatch: boolean
  headChecked: boolean
  checkpointsChecked: boolean
  checkpointHeadOk: boolean
  checkpointHeadChecked: boolean
  coverage?: CoverageSpan[]
  checkpoints?: CheckpointResult[]
  /** -1 means unknown. Zero is a real answer. */
  retentionPolicies: number
}

export interface VerifyResponse { report?: VerifyReport; noChain: boolean }
export interface VerifyEventResponse { valid: boolean; hashScheme: string; keyed: boolean }

export interface CheckpointListResponse {
  /** null from servers older than chronicle 8d3b2d7 when supported is false. */
  checkpoints: CheckpointSummary[] | null
  hasMore: boolean
  supported: boolean
}
export interface GetCheckpointResponse { checkpoint: CheckpointSummary }
export interface TakeCheckpointResponse { checkpoint?: CheckpointSummary; upToDate: boolean }

export interface EventSummary {
  id: string
  timestamp: string
  sequence: number
  action: string
  resource: string
  resourceId?: string
  category: string
  outcome: string
  severity: string
  userId?: string
  ip?: string
  erased: boolean
}

export interface EventDetail extends EventSummary {
  streamId: string
  hash: string
  prevHash: string
  hashScheme?: string
  hashKeyId?: string
  reason?: string
  subjectId?: string
  userAgent?: string
  requestId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  erasedAt?: string
  erasureId?: string
}

export interface EventListResponse { events: EventSummary[]; total: number; hasMore: boolean }

export interface AggregateGroup {
  bucket?: string
  category?: string
  action?: string
  outcome?: string
  severity?: string
  resource?: string
  count: number
}
export interface AggregateResponse { groups: AggregateGroup[]; total: number }

export interface OverviewStats {
  totalEvents: number
  criticalEvents: number
  /** outcome "failure" only. */
  failedEvents: number
  deniedEvents: number
  erasureCount: number
  categories: AggregateGroup[]
  severities: AggregateGroup[]
  outcomes: AggregateGroup[]
}

export interface ErasureSummary {
  id: string
  subjectId: string
  reason: string
  requestedBy: string
  eventsAffected: number
  keyDestroyed: boolean
  /** True when the key predates per-scope keys and events in another scope still use it. */
  legacyKeyRetained: boolean
  /**
   * "pending" is an erasure that did not finish: some keys may be gone, but
   * not every one is confirmed destroyed. Records from before erasures had a
   * status are completed, and so is anything this type does not recognise.
   */
  status: "pending" | "completed"
  createdAt: string
}
export interface ErasureListResponse { erasures: ErasureSummary[]; total: number; hasMore: boolean }
export interface ErasurePreviewResponse { subjectId: string; eventsAffected: number }
export interface ErasureResult {
  id: string
  subjectId: string
  eventsAffected: number
  keyDestroyed: boolean
  legacyKeyRetained: boolean
}

export interface PolicySummary {
  id: string
  category: string
  /** A Go duration, such as "720h0m0s". */
  duration: string
  archive: boolean
  appId: string
  tenantId?: string
  createdAt: string
  updatedAt: string
  editable: boolean
}
export interface PolicyListResponse { policies: PolicySummary[]; total: number }
export interface PolicyPreview { policyId: string; category: string; eventCount: number; capped: boolean }
export interface RetentionPreviewResponse {
  eventCount: number
  capped: boolean
  noPolicies: boolean
  governingAppPolicies: number
  byPolicy: PolicyPreview[]
}
export interface EnforceResponse {
  archived: number
  purged: number
  /** Always 0 today: the library's enforcer never sets it. */
  retained: number
  moreRemain: boolean
  failed: boolean
}
export interface ArchiveSummary {
  id: string
  policyId: string
  category: string
  eventCount: number
  fromTimestamp: string
  toTimestamp: string
  sinkName: string
  sinkRef?: string
  tenantId?: string
  createdAt: string
}
export interface ArchiveListResponse { archives: ArchiveSummary[]; hasMore: boolean }

export interface ReportPeriod { from: string; to: string }
export interface ReportStats {
  totalEvents: number
  criticalEvents: number
  failedEvents: number
  deniedEvents: number
}
export interface ReportSummary {
  id: string
  title: string
  /** soc2, hipaa, eu_ai_act or custom. */
  type: string
  period: ReportPeriod
  generatedBy: string
  format: string
  createdAt: string
  stats?: ReportStats
}
export interface ReportSection {
  title: string
  notes?: string
  events: EventSummary[]
  matchedEvents: number
  eventsTruncated: boolean
  stats?: AggregateResponse
}
export type VerificationStatus = "verified" | "no_chain" | "not_configured"
export interface VerificationScope {
  status: VerificationStatus
  streamId?: string
  scheme?: string
  schemeSince?: number
  headSeq: number
  fromSeq: number
  toSeq: number
  window: number
  capped: boolean
  checkpointsConfigured: boolean
  notes: string[]
}
export interface ReportDetail extends ReportSummary {
  sections: ReportSection[]
  verification?: VerifyReport
  verificationScope?: VerificationScope
}
export interface ReportListResponse { reports: ReportSummary[]; hasMore: boolean }
export interface GenerateReportResponse { id: string; report: ReportSummary }
export interface CustomReportSection {
  title: string
  categories?: string[]
  actions?: string[]
  severity?: string[]
  notes?: string
}
export interface ExportReportResponse { filename: string; contentType: string; content: string }

export interface SettingsDetail {
  batchSize: number
  flushInterval: string
  retentionInterval: string
  enableCryptoErasure: boolean
  digestScheme: string
  keyed: boolean
  checkpointingConfigured: boolean
  backendName: string
  backendHoldsCheckpoints: boolean
}

/** The contract's own limits, from chronicle's extension/contract. */
export const LIMITS = {
  verifySpan: 100_000,
  pageDefault: 50,
  pageMaxStreamsCheckpoints: 200,
  pageMax: 1000,
  previewCap: 10_000,
  enforcePerPolicy: 5_000,
  reportWindow: 50_000,
  customReportTitle: 200,
  customReportSections: 20,
  customSectionTitle: 200,
  customSectionNotes: 4000,
  customFilterValues: 50,
  customFilterValue: 128,
  erasureSubjectId: 256,
  erasureReason: 2000,
  policyCategory: 64,
} as const
