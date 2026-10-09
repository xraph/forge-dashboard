export interface Identity {
  namespace: string
  serviceID: string
  instanceID: string
}
export interface Instance {
  identity: Identity
  version: string
  ready: boolean
  endpoints: { protocol: string; url: string }[]
}
export interface Provider {
  name: string
  type: string
  healthy: boolean
  capabilities: {
    rpc: boolean
    consumerControls: boolean
    backfill: boolean
    durable: boolean
    replay: boolean
    deadLetters: boolean
    keyOrdering: boolean
  }
}
export interface Stream {
  config: {
    name: string
    provider: string
    subjects: string[]
    maxAge: number
    maxMessages: number
    replicas: number
  }
  messages: number
  bytes: number
  consumers: number
}
export interface Subscription {
  id: string
  stream: string
  messageType: string
  mode: "competing" | "broadcast"
  durable: boolean
  concurrency: number
  maxInFlight: number
  timeout: number
  maxAttempts: number
  retryDelay: number
  startAt: string
  broadcastID?: string
}
export interface Snapshot {
  identity: Identity
  running: boolean
  startedAt: string
  providers: Provider[]
  streams: Stream[]
  subscriptions: Subscription[]
  published: number
  handled: number
  acknowledged: number
  failed: number
  retried: number
  deadLettered: number
  observerDrops: number
  rpcCalls: number
  rpcHandled: number
  rpcFailed: number
  rpcTimedOut: number
}
export interface Delivery {
  stream: string
  consumerID: string
  subscriptionID: string
  destination: Identity
  mode: string
  attempt: number
  sequence: number
}
export interface Letter {
  id: string
  messageID: string
  messageType: string
  delivery: Delivery
  failedAt: string
  replayed: boolean
}
export interface LetterList {
  letters: Letter[]
  nextCursor: string
}
export interface HookEvent {
  duration?: number
  stage: string
  identity: Identity
  at: string
  provider?: string
  message?: { id: string; type: string }
  delivery?: Delivery
}
export interface Receipt {
  messageID: string
  sequence: number
  persisted: boolean
  duplicate: boolean
}

export interface Latency {
  count: number
  total: number
  max: number
  average: number
}
export interface ConsumerInfo {
  subscription: Subscription
  provider: string
  consumerID: string
  pending: number
  ackPending: number
  redelivered: number
  paused: boolean
  processing: Latency
  delivery: Latency
}
export interface BackfillInput {
  id: string
  subscription: string
  start: number
  end: number
}
export interface Backfill {
  messageType: string
  input: BackfillInput
  consumerID: string
  stream: string
  provider: string
  state: "running" | "failed" | "complete"
  next: number
  published: number
  skipped: number
  updatedAt: string
  error?: string
  persisted: boolean
}
export interface BackfillList {
  jobs: Backfill[]
  nextCursor: string
}
