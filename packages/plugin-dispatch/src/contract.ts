import type { Duration, JobState, Page, RunState } from "./types"

export interface WorkerRow {
  id: string
  hostname: string | null
  queues: string[]
  concurrency: number
  state: string
  self: boolean
  isLeader: boolean
  leaderUntil: string | null
  lastSeen: string | null
  createdAt: string | null
  heartbeatAge: Duration | null
  heartbeatInterval: Duration | null
  heartbeatStatus: "unknown" | "recent" | "silent"
  clockSkew: boolean
  capacity: Record<string, number>
}
export interface WorkersPage extends Page<WorkerRow> {
  enabled: boolean
  leaderId: string | null
  heartbeatReference: Duration | null
  silentAfter: Duration | null
}
export interface ResourceLeaseRow {
  owner: string
  held: Record<string, number>
  acquiredAt: string | null
}
export interface LocalResources {
  enabled: boolean
  capacity: Record<string, number>
  free: Record<string, number>
  reclaimable: Record<string, number>
  leases: ResourceLeaseRow[]
}
export interface WorkerDetail {
  enabled: boolean
  worker: WorkerRow | null
  leaderId: string | null
  silentAfter: Duration | null
  resources: LocalResources
  asOf: string
}
export interface QueueSettings {
  maxConcurrency: number
  rateLimit: number
  rateBurst: number
  effectiveRateBurst: number | null
}
export interface QueueRow {
  name: string
  counts: Record<JobState, number>
  total: number
  polledByThisProcess: boolean
  localSettings: QueueSettings | null
  localActiveCount: number | null
}
export interface QueueDetail extends QueueRow {
  asOf: string
}
export interface QueuesPage extends Page<QueueRow> {
  workerDiscoveryEnabled: boolean
}
export interface CronSummary {
  enabled: number
  disabled: number
}
export interface WorkerSummary {
  enabled: boolean
  recent: number
  silent: number
  unknown: number
  leaderId: string | null
  silentAfter: Duration | null
}
export interface OverviewSummary {
  jobs: JobCounts
  runs: Record<RunState, number>
  unreplayedDeadLetters: number
  crons: CronSummary
  workers: WorkerSummary
  asOf: string
}
export interface HandlerRow {
  kind: "job" | "workflow"
  name: string
  versions: number[]
  inputCount: number
}
export interface HandlerArtifactInput {
  name: string
  required: boolean
  maxSize: number
  mode: string
}
export interface ExecutionPolicy {
  level: string
  gracePeriod: Duration
  allowDowngrade: boolean
  image: string | null
}
export interface JobHandlerDetail {
  inputs: HandlerArtifactInput[]
  resources: Record<string, number>
  resourceLimits: Record<string, number>
  resourceClass: string | null
  resourceFunction: boolean
  leaseTtl: Duration | null
  effectiveLeaseTtl: Duration
  execution: ExecutionPolicy
}
export interface HandlerDetail extends HandlerRow {
  job: JobHandlerDetail | null
  asOf: string
}
export interface PoolConfig {
  concurrency: number
  queues: string[]
  pollInterval: Duration
  maxPollInterval: Duration
  jobHeartbeatInterval: Duration
  workerHeartbeatInterval: Duration
  workerStaleThreshold: Duration
  staleJobThreshold: Duration
  reapInterval: Duration
  defaultLeaseTtl: Duration
  storeCallTimeout: Duration
  shutdownTimeout: Duration
  storeCallsBounded: boolean
  reapingEnabled: boolean
  leasesEnabled: boolean
}
export interface SchedulerConfig {
  tickInterval: Duration
  leaderTtl: Duration
  refreshInterval: Duration
  lockTtl: Duration
  storeCallTimeout: Duration
  storeCallsBounded: boolean
}
export interface QueueConfigRow {
  name: string
  settings: QueueSettings
}
export interface RequestedRlimits {
  addressSpace: number
  noFile: number
  nProc: number
  core: number
  fSize: number
}
export interface SubprocessConfig {
  userConfigured: boolean
  uid: number | null
  gid: number | null
  allowSameUser: boolean
  hasRlimits: boolean
  strictRlimits: boolean
  requestedLimits: RequestedRlimits
  scratchDir: string | null
}
export interface ExecutorRow {
  name: string
  level: string
  default: boolean
  subprocess: SubprocessConfig | null
}
export interface ResourceConfig {
  enabled: boolean
  defaults: Record<string, number>
  queues: Record<string, Record<string, number>>
  advertisedWorkerCapacity: Record<string, number>
  customKeys: string[]
  estimatorConfigured: boolean
}
export interface ArtifactCacheConfig {
  directory: string
  budgetBytes: number
  usedBytes: number
}
export interface ArtifactConfig {
  enabled: boolean
  backend: string | null
  defaultBucket: string | null
  cache: ArtifactCacheConfig | null
}
export interface EngineConfig {
  workerId: string
  pool: PoolConfig
  scheduler: SchedulerConfig
  queues: QueueConfigRow[]
  executors: ExecutorRow[]
  resources: ResourceConfig
  artifacts: ArtifactConfig
  scratchRoot: string
  wakeNotifierSupported: boolean
  asOf: string
}
export interface JobCounts {
  counts: Record<JobState, number>
  total: number
  asOf: string
}

export interface JobRow {
  id: string
  name: string
  queue: string
  state: JobState
  priority: number
  maxRetries: number
  retryCount: number
  workerId: string | null
  scopeAppId: string | null
  scopeOrgId: string | null
  createdAt: string | null
  runAt: string | null
  startedAt: string | null
  completedAt: string | null
}
