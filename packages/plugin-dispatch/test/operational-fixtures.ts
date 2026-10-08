import type {
  EngineConfig,
  HandlerDetail,
  JobCounts,
  JobRow,
  OverviewSummary,
  QueueRow,
  WorkerDetail,
  WorkerRow,
} from "../src/contract"
import type { Page } from "../src/types"
export const asOf = "2026-10-08T18:00:00Z"
export const duration = { text: "5s", ms: 5000 }
export const page = <T>(items: T[]): Page<T> => ({
  items,
  nextCursor: null,
  complete: true,
  asOf,
})
export const counts: JobCounts = {
  counts: {
    pending: 4,
    running: 2,
    completed: 18,
    failed: 1,
    retrying: 0,
    cancelled: 0,
  },
  total: 25,
  asOf,
}
export const overview: OverviewSummary = {
  jobs: counts,
  runs: { running: 2, completed: 8, failed: 1 },
  unreplayedDeadLetters: 3,
  crons: { enabled: 2, disabled: 1 },
  workers: {
    enabled: true,
    recent: 1,
    silent: 1,
    unknown: 0,
    leaderId: "worker-remote",
    silentAfter: duration,
  },
  asOf,
}
export const queue: QueueRow = {
  name: "email/bulk",
  counts: counts.counts,
  total: 25,
  polledByThisProcess: false,
  localSettings: null,
  localActiveCount: null,
}
export const worker: WorkerRow = {
  id: "worker-remote",
  hostname: "runner-2",
  queues: ["email/bulk"],
  concurrency: 4,
  state: "active",
  self: false,
  isLeader: true,
  leaderUntil: asOf,
  lastSeen: asOf,
  createdAt: asOf,
  heartbeatAge: duration,
  heartbeatInterval: null,
  heartbeatStatus: "recent",
  clockSkew: false,
  capacity: { cpu: 4 },
}
export const workerDetail: WorkerDetail = {
  enabled: true,
  worker,
  leaderId: worker.id,
  silentAfter: duration,
  resources: {
    enabled: false,
    capacity: {},
    free: {},
    reclaimable: {},
    leases: [],
  },
  asOf,
}
export const job: JobRow = {
  id: "job-a",
  name: "send-email",
  queue: queue.name,
  state: "pending",
  priority: 0,
  maxRetries: 3,
  retryCount: 0,
  workerId: null,
  scopeAppId: "app-a",
  scopeOrgId: null,
  createdAt: asOf,
  runAt: asOf,
  startedAt: null,
  completedAt: null,
}
export const handler: HandlerDetail = {
  kind: "workflow",
  name: "image/normalize",
  versions: [1, 4],
  inputCount: 0,
  job: null,
  asOf,
}
export const config: EngineConfig = {
  workerId: "worker-local",
  pool: {
    concurrency: 4,
    queues: ["emails"],
    pollInterval: duration,
    maxPollInterval: duration,
    jobHeartbeatInterval: duration,
    workerHeartbeatInterval: duration,
    workerStaleThreshold: duration,
    staleJobThreshold: duration,
    reapInterval: duration,
    defaultLeaseTtl: duration,
    storeCallTimeout: duration,
    shutdownTimeout: duration,
    storeCallsBounded: true,
    reapingEnabled: true,
    leasesEnabled: true,
  },
  scheduler: {
    tickInterval: duration,
    leaderTtl: duration,
    refreshInterval: duration,
    lockTtl: duration,
    storeCallTimeout: duration,
    storeCallsBounded: true,
  },
  queues: [],
  executors: [
    { name: "function", level: "function", default: true, subprocess: null },
  ],
  resources: {
    enabled: false,
    defaults: {},
    queues: {},
    advertisedWorkerCapacity: {},
    customKeys: [],
    estimatorConfigured: false,
  },
  artifacts: {
    enabled: false,
    backend: null,
    defaultBucket: null,
    cache: null,
  },
  scratchRoot: "",
  wakeNotifierSupported: false,
  asOf,
}
