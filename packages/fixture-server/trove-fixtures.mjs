// trove-fixtures.mjs: in-memory state and intent handlers for the trove
// contributor (packages/plugin-trove), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors trove/extension/contract as slice 2 shipped it: handlers_*.go,
// errors.go, cursor.go, project.go. Field names are the Go JSON tags. It is
// multi-store: "primary" on the local driver (the default) and "archive" on
// s3, which can presign and routes some keys to a backend named "cold".
//
// Like the Go contract, nothing here reads a metadata store: buckets, objects,
// the CAS index and streams are what the drivers and engines would report.
// Content tickets are unsigned here; slice 4 gives the fixture its content
// routes and checks them there.
//
// server.mjs hands in its FixtureError class so refusals carry their real
// status and code (a class declared here would not pass instanceof there).

const CONTENT_PATH = "/dashboard/trove/content"
const MAX_UPLOAD = 64 * 1024 * 1024
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const MAX_PREVIEW = 256 * 1024
const ENC_NOT_APPLIED =
  "enable_encryption is set, but the extension never registers the encrypt middleware. Nothing is encrypted."
const NO_SCAN = "No scan middleware is registered, so uploads are not scanned."
const ROUTING_NOTE =
  "This store routes some keys to other backends. Listings, bucket operations and health describe the default backend only."
const CAS_GUARD = (b) =>
  `CAS manages the ${b} bucket. Changing its objects here would leave the CAS index pointing at the wrong content.`

const NOW = Date.parse("2026-09-30T12:00:00Z")
function ago(minutes) {
  return new Date(NOW - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")
}
function hex(seed, n = 64) {
  let out = ""
  while (out.length < n) out += seed
  return out.slice(0, n)
}
const HASH_A = `sha256:${hex("a1")}`
const HASH_B = `sha256:${hex("b2")}`
const HASH_ORPHAN = `sha256:${hex("de")}`

function obj(size, minutes, extra = {}) {
  return {
    storedSize: size,
    etag: extra.etag ?? `${size.toString(16)}-${(NOW - minutes * 60_000).toString(16)}`,
    lastModified: ago(minutes),
    contentType: extra.contentType ?? null,
    storageClass: extra.storageClass ?? null,
    versionId: extra.versionId ?? null,
    metadata: extra.metadata ?? null,
  }
}

function seed() {
  return {
    primary: {
      driver: "local",
      isDefault: true,
      healthy: true,
      capabilities: { multipart: false, presign: false, range: false, serverCopy: false, versioning: false, notification: false, lifecycle: false, folders: true },
      config: { defaultBucket: "reports", chunkSize: 8388608, poolSize: 16 },
      etagIsContentHash: false,
      createdAtMeaning: "modified",
      backends: [],
      configured: { encryption: true, compression: true, cas: true },
      registrations: [{ name: "compress", direction: "readwrite", scope: "global", priority: 0 }],
      cas: { algorithm: "sha256", bucket: "cas" },
      index: new Map([
        [HASH_A, { refCount: 2, pinned: false }],
        [HASH_B, { refCount: 1, pinned: true }],
      ]),
      streams: [
        { id: "str_01j9k4m2e7t8x3q5r6v0w1y2za", direction: "upload", bucket: "reports", key: "2026/09/big.csv", state: "active", offset: 3145728, totalSize: 10485760 },
        { id: "str_01j9k4m2e7t8x3q5r6v0w1y2zb", direction: "download", bucket: "assets", key: "logo.png", state: "paused", offset: 2048, totalSize: null },
      ],
      buckets: new Map([
        ["reports", { createdAt: ago(60 * 24 * 30), objects: new Map([
          ["2026/08/summary.json", obj(3901, 60 * 24 * 31, { contentType: "application/json" })],
          ["2026/09/raw.bin", obj(1048576, 60 * 5)],
          ["2026/09/summary.json", obj(4812, 2, { contentType: "application/json", metadata: { owner: "ops" } })],
          ["q3 résumé #1.pdf", obj(88213, 60 * 24, { contentType: "application/pdf" })],
          ["readme.txt", obj(1204, 60 * 2, { contentType: "text/plain" })],
        ]) }],
        ["assets", { createdAt: ago(60 * 24 * 20), objects: new Map([
          ["logo.png", obj(20480, 60 * 24 * 3, { contentType: "image/png" })],
        ]) }],
        ["empty", { createdAt: ago(60 * 24 * 2), objects: new Map() }],
        ["cas", { createdAt: ago(60 * 24 * 10), objects: new Map([
          [HASH_A, obj(4812, 60 * 24)],
          [HASH_B, obj(120, 60 * 12)],
          [HASH_ORPHAN, obj(9, 60 * 48)],
        ]) }],
      ]),
    },
    archive: {
      driver: "s3",
      isDefault: false,
      healthy: true,
      capabilities: { multipart: true, presign: true, range: true, serverCopy: false, versioning: false, notification: false, lifecycle: false, folders: true },
      config: { defaultBucket: null, chunkSize: 8388608, poolSize: 16 },
      etagIsContentHash: true,
      createdAtMeaning: "created",
      backends: ["cold"],
      configured: { encryption: false, compression: false, cas: false },
      registrations: [],
      cas: null,
      index: new Map(),
      streams: [],
      buckets: new Map([
        ["backups", { createdAt: ago(60 * 24 * 90), objects: new Map([
          ["db/2026-09-29.dump", obj(52428800, 60 * 30, { contentType: "application/octet-stream", storageClass: "STANDARD", etag: "9b2cf535f27731c974343645a3985328" })],
          ["db/2026-09-30.dump", obj(52430112, 60 * 6, { contentType: "application/octet-stream", storageClass: "STANDARD", etag: "6f5902ac237024bdd0c176cb93063dc4" })],
        ]) }],
      ]),
    },
  }
}

let state = seed()

export function resetTrove() {
  state = seed()
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url")

export function createTroveHandlers(FixtureError) {
  const badRequest = (m, details) => new FixtureError(400, "BAD_REQUEST", m, details)
  const notFound = (m) => new FixtureError(404, "NOT_FOUND", m)
  const conflict = (m, details) => new FixtureError(409, "CONFLICT", m, details)
  const unavailable = (m) => new FixtureError(503, "UNAVAILABLE", m)

  /** Stores.Resolve: absent is the default, blank refuses, unknown is not found. */
  function store(input) {
    const raw = input?.store
    if (raw === undefined || raw === null || raw === "") return { name: "primary", s: state.primary }
    if (typeof raw !== "string" || raw.trim() === "") throw badRequest("store is blank")
    if (!(raw in state)) throw notFound(`no store named "${raw}"`)
    return { name: raw, s: state[raw] }
  }

  function requireName(field, value) {
    if (typeof value !== "string" || value.trim() === "") throw badRequest(`${field} is required`)
    return value
  }

  function requireKey(value) {
    if (typeof value !== "string" || value === "") throw badRequest("key is required")
    return value
  }

  function bucketOf(s, name) {
    const b = s.buckets.get(name)
    if (!b) throw notFound("bucket not found")
    return b
  }

  function objectOf(s, bucket, key) {
    const o = bucketOf(s, bucket).objects.get(key)
    if (!o) throw notFound("object not found")
    return o
  }

  function row(key, o) {
    return { key, storedSize: o.storedSize, etag: o.etag, lastModified: o.lastModified, contentType: o.contentType, storageClass: o.storageClass }
  }

  function detail(key, o) {
    return { ...row(key, o), versionId: o.versionId, metadata: o.metadata }
  }

  function decodeCursor(c) {
    if (c === undefined || c === null || c === "") return ""
    if (typeof c !== "string" || !/^[A-Za-z0-9_-]+$/.test(c)) {
      throw badRequest("cursor is malformed. Pass back nextCursor exactly as you received it.")
    }
    return Buffer.from(c, "base64url").toString("utf8")
  }

  function clampLimit(raw) {
    const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
    if (n <= 0) return DEFAULT_LIMIT
    return Math.min(n, MAX_LIMIT)
  }

  /** driver.PageKeys: fold by delimiter, skip through the cursor, count both. */
  function pageKeys(sorted, { prefix, delimiter, cursor, limit }) {
    const keys = [], prefixes = []
    let emitted = 0, last = "", next = ""
    for (const key of sorted) {
      if (!key.startsWith(prefix)) continue
      let item = key, isPrefix = false
      if (delimiter !== "") {
        const rest = key.slice(prefix.length)
        const i = rest.indexOf(delimiter)
        if (i >= 0) { item = prefix + rest.slice(0, i + delimiter.length); isPrefix = true }
      }
      if (cursor !== "" && item <= cursor) continue
      if (isPrefix && emitted > 0 && item === last) continue
      if (emitted === limit) { next = last; break }
      if (isPrefix) prefixes.push(item); else keys.push(key)
      last = item
      emitted += 1
    }
    return { keys, prefixes, next }
  }

  function matchingRows(s) {
    // Every fixture registration has a global scope, so it matches every key.
    return s.registrations.map((r) => ({ name: r.name, direction: r.direction, scope: r.scope, priority: r.priority }))
  }

  function presignOf(s, rows) {
    if (!s.capabilities.presign) return { available: false, reason: "This driver cannot create presigned links." }
    if (rows.length > 0) {
      return { available: false, reason: `Middleware applies to this key (${rows.map((r) => r.name).join(", ")}). A presigned link would skip it and return the stored bytes.` }
    }
    return { available: true, reason: null }
  }

  function refuseCAS(s, bucket) {
    if (s.cas && s.cas.bucket === bucket) throw conflict(CAS_GUARD(bucket))
  }

  function ticket(fields, ttlSeconds) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    return { token: b64(JSON.stringify({ ...fields, e: expires })), expiresAt: new Date(expires * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") }
  }

  function flags(s) {
    const has = (n) => s.registrations.some((r) => r.name === n)
    const f = (name, configured, applied, note) => ({ name, configured, applied, note })
    return [
      f("encryption", s.configured.encryption, has("encrypt"), s.configured.encryption && !has("encrypt") ? ENC_NOT_APPLIED : null),
      f("compression", s.configured.compression, has("compress"), s.configured.compression && !has("compress") ? "enable_compression is set, but no compress middleware is registered." : null),
      f("scanning", has("scan"), has("scan"), has("scan") ? null : NO_SCAN),
      f("cas", s.configured.cas, s.cas !== null, s.configured.cas && s.cas === null ? "enable_cas is set, but this store has no CAS engine." : null),
    ]
  }

  function requireCAS(s) {
    if (!s.cas) throw unavailable("CAS is not enabled on this store.")
    return s.cas
  }

  return {
    "system.status": {
      kind: "query",
      handler: (input) => {
        const { name, s } = store(input)
        return {
          store: name,
          driver: s.driver,
          health: s.healthy ? { ok: true, error: null } : { ok: false, error: "The driver did not answer a ping." },
          capabilities: { ...s.capabilities },
          config: { ...s.config, maxUploadBytes: MAX_UPLOAD },
          flags: flags(s),
          etagIsContentHash: s.etagIsContentHash,
          contentSecret: "per-process",
          backends: [...s.backends],
          routingNote: s.backends.length > 0 ? ROUTING_NOTE : null,
        }
      },
    },
    "stores.list": {
      kind: "query",
      handler: () => ({
        mode: "multi",
        stores: Object.entries(state).map(([name, s]) => ({ name, driver: s.driver, isDefault: s.isDefault })),
      }),
    },
    "buckets.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const buckets = [...s.buckets.entries()]
          .map(([name, b]) => ({ name, createdAt: b.createdAt }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))
        return { buckets, createdAtMeaning: s.createdAtMeaning }
      },
    },
    "buckets.create": {
      kind: "command",
      invalidates: ["buckets.list"],
      handler: (input) => {
        const name = requireName("name", input?.name)
        const { s } = store(input)
        if (s.buckets.has(name)) throw conflict("a bucket with this name already exists")
        s.buckets.set(name, { createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), objects: new Map() })
        return { name }
      },
    },
    "buckets.delete": {
      kind: "command",
      invalidates: ["buckets.list", "objects.list"],
      handler: (input) => {
        const name = requireName("name", input?.name)
        const { s } = store(input)
        refuseCAS(s, name)
        const b = bucketOf(s, name)
        if (b.objects.size > 0) throw conflict("This bucket still holds objects. Delete them first.")
        s.buckets.delete(name)
        return { name }
      },
    },
    "objects.list": {
      kind: "query",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const { s } = store(input)
        const b = bucketOf(s, bucket)
        const cursor = decodeCursor(input?.cursor)
        const delimiter = input?.delimiter === undefined || input?.delimiter === null ? "/" : String(input.delimiter)
        const prefix = typeof input?.prefix === "string" ? input.prefix : ""
        const sorted = [...b.objects.keys()].sort()
        const page = pageKeys(sorted, { prefix, delimiter, cursor, limit: clampLimit(input?.limit) })
        return {
          objects: page.keys.map((k) => row(k, b.objects.get(k))),
          prefixes: delimiter === "" ? null : page.prefixes,
          nextCursor: page.next === "" ? null : b64(page.next),
          foldersSupported: delimiter !== "",
          routed: s.backends.length > 0,
        }
      },
    },
    "objects.head": {
      kind: "query",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        const o = objectOf(s, bucket, key)
        const rows = matchingRows(s)
        return { object: detail(key, o), middleware: rows, presign: presignOf(s, rows) }
      },
    },
    "objects.contentUrl": {
      kind: "query",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const purpose = input?.purpose ?? "download"
        if (purpose !== "" && purpose !== "download" && purpose !== "preview") throw badRequest('purpose must be "download" or "preview"')
        const limit = typeof input?.limit === "number" ? input.limit : 0
        if (limit < 0) throw badRequest("limit cannot be negative")
        const { name, s } = store(input)
        objectOf(s, bucket, key)
        const op = purpose === "preview" ? "preview" : "download"
        const t = ticket({ s: name, b: bucket, k: key, o: op, l: op === "preview" ? (limit === 0 || limit > MAX_PREVIEW ? MAX_PREVIEW : limit) : undefined }, 60)
        return { url: `${CONTENT_PATH}?t=${encodeURIComponent(t.token)}`, expiresAt: t.expiresAt }
      },
    },
    "objects.beginUpload": {
      kind: "command",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const size = typeof input?.size === "number" ? input.size : 0
        if (size < 0) throw badRequest("size cannot be negative")
        // Go parses it with mime.ParseMediaType: a type/subtype token pair, then parameters.
        if (typeof input?.contentType === "string" && input.contentType !== "" && !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+\s*(;.*)?$/.test(input.contentType)) {
          throw badRequest("contentType is not a valid media type")
        }
        if (size > MAX_UPLOAD) throw badRequest(`This file is larger than the upload limit of ${MAX_UPLOAD} bytes.`, { maxUploadBytes: MAX_UPLOAD })
        const { name, s } = store(input)
        refuseCAS(s, bucket)
        const b = bucketOf(s, bucket)
        if (b.objects.has(key) && input?.overwrite !== true) throw conflict("an object with this key already exists", { exists: true })
        const t = ticket({ s: name, b: bucket, k: key, o: "upload", n: size, ct: input?.contentType ?? "", ow: input?.overwrite === true }, 900)
        return { url: CONTENT_PATH, ticket: t.token, expiresAt: t.expiresAt }
      },
    },
    "objects.completeUpload": {
      kind: "command",
      invalidates: ["objects.list", "objects.head"],
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        return row(key, objectOf(s, bucket, key))
      },
    },
    "objects.delete": {
      kind: "command",
      invalidates: ["objects.list", "objects.head", "cas.list"],
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        refuseCAS(s, bucket)
        // Delete is idempotent in Trove: a missing key is not an error.
        bucketOf(s, bucket).objects.delete(key)
        return { key }
      },
    },
    "objects.copy": {
      kind: "command",
      invalidates: ["objects.list", "objects.head"],
      handler: (input) => {
        const srcBucket = requireName("srcBucket", input?.srcBucket)
        const dstBucket = requireName("dstBucket", input?.dstBucket)
        if (!input?.srcKey || !input?.dstKey) throw badRequest("srcKey and dstKey are required")
        if (srcBucket === dstBucket && input.srcKey === input.dstKey) throw badRequest("the source and the destination are the same object")
        const { s } = store(input)
        refuseCAS(s, srcBucket)
        refuseCAS(s, dstBucket)
        const o = objectOf(s, srcBucket, input.srcKey)
        const dst = bucketOf(s, dstBucket)
        if (dst.objects.has(input.dstKey) && input?.overwrite !== true) throw conflict("an object with this key already exists", { exists: true })
        const copy = { ...o, lastModified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }
        dst.objects.set(input.dstKey, copy)
        return row(input.dstKey, copy)
      },
    },
    "objects.presign": {
      kind: "command",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        objectOf(s, bucket, key)
        const status = presignOf(s, matchingRows(s))
        if (!status.available) throw unavailable(status.reason)
        let secs = typeof input?.expiresSeconds === "number" ? Math.trunc(input.expiresSeconds) : 0
        if (secs === 0) secs = 3600
        secs = Math.min(Math.max(secs, 60), 7 * 24 * 3600)
        const expiresAt = new Date(Date.now() + secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
        return { url: `https://archive.s3.example/${bucket}/${encodeURIComponent(key)}?X-Amz-Expires=${secs}`, expiresAt }
      },
    },
    "middleware.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const tested = typeof input?.bucket === "string" && input.bucket !== "" && typeof input?.key === "string" && input.key !== ""
        const registrations = s.registrations.map((r) => ({
          ...r,
          matchesWrite: tested ? r.direction !== "read" : null,
          matchesRead: tested ? r.direction !== "write" : null,
        }))
        const warnings = s.registrations.length > 0
          ? [{ code: "bypass", message: "CAS, copy and streams move stored bytes without running any middleware." }]
          : []
        return { registrations, warnings }
      },
    },
    "cas.status": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        if (!s.cas) return { enabled: false, algorithm: null, bucket: null, index: null, resetsOnRestart: false, releaseSupported: false }
        return { enabled: true, algorithm: s.cas.algorithm, bucket: s.cas.bucket, index: "memory", resetsOnRestart: true, releaseSupported: false }
      },
    },
    "cas.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const cas = requireCAS(s)
        const b = s.buckets.get(cas.bucket)
        if (!b) return { entries: [], nextCursor: null }
        const cursor = decodeCursor(input?.cursor)
        const page = pageKeys([...b.objects.keys()].sort(), { prefix: "", delimiter: "", cursor, limit: clampLimit(input?.limit) })
        const entries = page.keys.map((hash) => {
          const o = b.objects.get(hash)
          const e = s.index.get(hash)
          return {
            hash,
            storedSize: o.storedSize,
            lastModified: o.lastModified,
            indexed: e !== undefined,
            refCount: e ? e.refCount : null,
            pinned: e ? e.pinned : null,
          }
        })
        return { entries, nextCursor: page.next === "" ? null : b64(page.next) }
      },
    },
    "cas.pin": casPin(true),
    "cas.unpin": casPin(false),
    "cas.gc": {
      kind: "command",
      invalidates: ["cas.list", "cas.status"],
      handler: (input) => {
        const { s } = store(input)
        requireCAS(s)
        const candidates = [...s.index.values()].filter((e) => e.refCount === 0 && !e.pinned).length
        return { scanned: candidates, deleted: 0, freedBytes: 0, errors: 0 }
      },
    },
    "streams.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const streams = [...s.streams].sort((a, b) => (a.id < b.id ? -1 : 1))
        return { streams, active: streams.length, max: s.config.poolSize }
      },
    },
  }

  function casPin(pin) {
    return {
      kind: "command",
      invalidates: ["cas.list"],
      handler: (input) => {
        const hash = typeof input?.hash === "string" ? input.hash : ""
        if (hash === "") throw badRequest("hash is required")
        const { s } = store(input)
        requireCAS(s)
        const e = s.index.get(hash)
        if (!e) throw notFound("this hash is not in the CAS index. The index is kept in memory and forgets every entry on restart.")
        e.pinned = pin
        const o = s.buckets.get(s.cas.bucket)?.objects.get(hash)
        return { hash, storedSize: o ? o.storedSize : 0, lastModified: null, indexed: true, refCount: e.refCount, pinned: e.pinned }
      },
    }
  }
}
