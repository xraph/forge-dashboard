/**
 * Wire types for the trove contract. Field names are the Go JSON tags in
 * trove/extension/contract (handlers_*.go, project.go, middleware.go). An
 * absent value arrives as null, never "" or 0.
 */

export interface FlagStatus {
  name: string
  configured: boolean
  applied: boolean
  /** Says where a protection applies, or why it does not. */
  note: string | null
}

export interface SystemStatus {
  store: string
  driver: string
  health: { ok: boolean; error: string | null }
  capabilities: {
    multipart: boolean
    presign: boolean
    range: boolean
    serverCopy: boolean
    versioning: boolean
    notification: boolean
    lifecycle: boolean
    folders: boolean
  }
  config: {
    defaultBucket: string | null
    chunkSize: number
    poolSize: number
    maxUploadBytes: number
  }
  flags: FlagStatus[]
  etagIsContentHash: boolean
  contentSecret: "configured" | "per-process"
  /** Backends registered beside the default. [] means every key goes to the default. */
  backends: string[]
  routingNote: string | null
}

export interface StoreRow {
  name: string
  driver: string
  isDefault: boolean
}

export interface StoresList {
  mode: "single" | "multi"
  stores: StoreRow[]
}

export interface BucketRow {
  name: string
  createdAt: string | null
}

export interface BucketsList {
  buckets: BucketRow[]
  /** "modified" where the driver returns a last-modified time (local, sftp, azure). */
  createdAtMeaning: "created" | "modified"
}

export interface MiddlewareRegistration {
  name: string
  direction: string
  scope: string
  priority: number
  /** null unless the request named both a bucket and a key. */
  matchesWrite: boolean | null
  matchesRead: boolean | null
}

export interface MiddlewareWarning {
  code: string
  message: string
}

export interface MiddlewareList {
  registrations: MiddlewareRegistration[]
  warnings: MiddlewareWarning[]
}

export interface CasStatus {
  enabled: boolean
  algorithm: string | null
  bucket: string | null
  index: string | null
  resetsOnRestart: boolean
  releaseSupported: boolean
}

export interface CasEntry {
  hash: string
  storedSize: number
  lastModified: string | null
  indexed: boolean
  /** null when the blob is not in the index. */
  refCount: number | null
  pinned: boolean | null
}

export interface CasList {
  entries: CasEntry[]
  nextCursor: string | null
}

export interface CasGCResult {
  scanned: number
  deleted: number
  freedBytes: number
  errors: number
}

export interface StreamRow {
  id: string
  direction: string
  bucket: string
  key: string
  state: string
  offset: number
  /** null when nobody set the expected size. */
  totalSize: number | null
}

export interface StreamsList {
  streams: StreamRow[]
  active: number
  max: number
}

/** One object row as `objects.list`, `objects.copy` and `objects.completeUpload` return it. */
export interface ObjectRow {
  key: string
  /** Bytes as stored, after any write middleware. Not the logical size. */
  storedSize: number
  etag: string | null
  lastModified: string | null
  contentType: string | null
  storageClass: string | null
}

export interface ObjectsList {
  objects: ObjectRow[]
  /** Common prefixes, sorted. `null` only on a flat listing. */
  prefixes: string[] | null
  nextCursor: string | null
  foldersSupported: boolean
  /** True when the store routes some keys to another backend. */
  routed: boolean
}

export interface ObjectDetail extends ObjectRow {
  versionId: string | null
  metadata: Record<string, string> | null
}

export interface HeadMiddleware {
  name: string
  direction: string
  scope: string
  priority: number
}

export interface ObjectHead {
  object: ObjectDetail
  /** Middleware whose scope matches this key in the current config. */
  middleware: HeadMiddleware[]
  presign: { available: boolean; reason: string | null }
}

/** `objects.contentUrl` and `objects.presign`. */
export interface ContentLink {
  url: string
  expiresAt: string
}

/** `objects.beginUpload`: PUT the body to `url` with `ticket` in X-Trove-Ticket. */
export interface UploadTicket {
  url: string
  ticket: string
  expiresAt: string
}
