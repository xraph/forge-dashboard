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
// Content tickets are unsigned here: the content routes live in this file
// (handleTroveContent) and check a ticket by its shape, not by an HMAC.
//
// server.mjs hands in its FixtureError class so refusals carry their real
// status and code (a class declared here would not pass instanceof there).

import { createHash } from "node:crypto"

const CONTENT_PATH = "/dashboard/trove/content"
export const TROVE_CONTENT_PATH = CONTENT_PATH
const MAX_UPLOAD = 64 * 1024 * 1024
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const MAX_PREVIEW = 256 * 1024
const ENC_NOT_APPLIED =
  "enable_encryption is set, but the extension never registers the encrypt middleware. Nothing is encrypted."
const NO_SCAN = "No scan middleware is registered, so uploads are not scanned."
const SCAN_CAVEAT =
  "Registered in code. A scan with no provider, an excluded extension or an object over its size limit passes through unscanned, and nothing records which objects were scanned."
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
    body: extra.body === undefined ? null : Buffer.isBuffer(extra.body) ? extra.body : Buffer.from(extra.body, "utf8"),
  }
}

const README = "Reports land here.\nMonthly summaries live under YYYY/MM/summary.json.\n"
const SUMMARY_09 = JSON.stringify({ month: "2026-09", total: 4812, rows: [{ team: "ops", count: 31 }, { team: "billing", count: 12 }] })
const SUMMARY_08 = JSON.stringify({ month: "2026-08", total: 3901, rows: [{ team: "ops", count: 27 }] })
// A 1x1 PNG, the smallest valid image.
const LOGO_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")
// An SVG with a script in it. Shown through an <img>, the script cannot run;
// that is what the browser's preview relies on.
const DIAGRAM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" rx="8" fill="#4f46e5"/><text x="60" y="36" font-size="16" text-anchor="middle" fill="white">trove</text><script>alert("this must never run")</script></svg>'

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
          ["2026/08/summary.json", obj(3901, 60 * 24 * 31, { contentType: "application/json", body: SUMMARY_08 })],
          ["2026/09/raw.bin", obj(1048576, 60 * 5)],
          ["2026/09/summary.json", obj(4812, 2, { contentType: "application/json", metadata: { owner: "ops" }, body: SUMMARY_09 })],
          ["q3 résumé #1.pdf", obj(88213, 60 * 24, { contentType: "application/pdf" })],
          ["readme.txt", obj(1204, 60 * 2, { contentType: "text/plain", body: README })],
        ]) }],
        ["assets", { createdAt: ago(60 * 24 * 20), objects: new Map([
          ["diagram.svg", obj(DIAGRAM_SVG.length, 60 * 24, { contentType: "image/svg+xml", body: DIAGRAM_SVG })],
          ["logo.png", obj(20480, 60 * 24 * 3, { contentType: "image/png", body: LOGO_PNG })],
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
      // One scoped registration, so the Overview shows an applied flag that
      // carries a scope note. Its scope matches no seeded key, so presign on
      // the seeded dumps stays available.
      registrations: [{ name: "compress", direction: "readwrite", scope: "key(*.log)", priority: 0 }],
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

/** Splits "a,b(c,d)" at the commas outside any parentheses. */
function splitTop(text) {
  const parts = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth += 1
    else if (text[i] === ")") depth -= 1
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(from, i))
      from = i + 1
    }
  }
  parts.push(text.slice(from))
  return parts
}

/** Go's key patterns are filepath.Match globs: "*" and "?" stop at a slash. */
function globMatches(pattern, key) {
  const re = pattern.replace(/[.+^${}|\\[\]]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")
  return new RegExp(`^${re}$`).test(key)
}

/** The scope forms the fixture seeds, written the way Go's String() prints them. */
function scopeMatches(scope, bucket, key) {
  if (scope === "global") return true
  const m = /^(bucket|key|and)\((.*)\)$/.exec(scope)
  if (!m) throw new Error(`fixture scope not supported: ${scope}`)
  const args = splitTop(m[2])
  if (m[1] === "bucket") return args.includes(bucket)
  if (m[1] === "key") return args.some((p) => globMatches(p, key))
  return args.every((a) => scopeMatches(a, bucket, key))
}

const sortedRegistrations = (s) => s.registrations.slice().sort((a, b) => a.priority - b.priority)
const runsWrite = (r) => r.direction !== "read"

function matchingRows(s, bucket, key) {
  return sortedRegistrations(s)
    .filter((r) => scopeMatches(r.scope, bucket, key))
    .map((r) => ({ name: r.name, direction: r.direction, scope: r.scope, priority: r.priority }))
}

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
    if (!Object.hasOwn(state, raw)) throw notFound(`no store named "${raw}"`)
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

  /** Go's coverageOf: where one middleware runs on the write path. */
  function coverageOf(s, name) {
    const c = { registered: false, applied: false, global: false, scopes: [] }
    for (const r of s.registrations) {
      if (r.name !== name) continue
      c.registered = true
      if (!runsWrite(r)) continue
      c.applied = true
      if (r.scope === "global") c.global = true
      if (!c.scopes.includes(r.scope)) c.scopes.push(r.scope)
    }
    return c
  }

  /** Go's protectionFlag, string for string. */
  function protectionFlag(name, configured, c, verb, missing) {
    const notes = []
    if (c.registered && !c.applied) notes.push(`Registered for reads only, so nothing is ${verb} on write.`)
    else if (!c.registered && configured) notes.push(missing)
    else if (c.applied && !configured) notes.push("Registered in code rather than by a config switch.")
    if (c.applied && !c.global) {
      notes.push(`Applies only where its scope matches: ${c.scopes.join(", ")}. Objects outside that scope are not ${verb}.`)
    }
    return { name, configured, applied: c.applied, note: notes.length > 0 ? notes.join(" ") : null }
  }

  function flags(s) {
    const encryption = protectionFlag("encryption", s.configured.encryption, coverageOf(s, "encrypt"), "encrypted", ENC_NOT_APPLIED)
    const compression = protectionFlag("compression", s.configured.compression, coverageOf(s, "compress"), "compressed",
      "enable_compression is set, but no compress middleware is registered.")
    const sc = coverageOf(s, "scan")
    const scanning = protectionFlag("scanning", sc.registered, sc, "scanned", "")
    if (!sc.registered) scanning.note = NO_SCAN
    else scanning.note = scanning.note === null ? SCAN_CAVEAT : `${SCAN_CAVEAT} ${scanning.note}`
    const cas = { name: "cas", configured: s.configured.cas, applied: s.cas !== null, note: s.configured.cas && s.cas === null ? "enable_cas is set, but this store has no CAS engine." : null }
    return [encryption, compression, scanning, cas]
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
        const rows = matchingRows(s, bucket, key)
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
        const status = presignOf(s, matchingRows(s, bucket, key))
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
        const registrations = sortedRegistrations(s).map((r) => ({
          ...r,
          matchesWrite: tested ? scopeMatches(r.scope, input.bucket, input.key) && runsWrite(r) : null,
          matchesRead: tested ? scopeMatches(r.scope, input.bucket, input.key) && r.direction !== "write" : null,
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

// What the Go route checks with an HMAC, the fixture checks by shape: the
// ticket is base64url JSON (see ticket() above). It still enforces the
// operation, the expiry, the header for PUT and the declared size, so the
// browser meets the same refusals it will meet against Go.
function readTicket(token) {
  if (typeof token !== "string" || token === "") return { error: "This request has no ticket." }
  let t
  try {
    t = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
  } catch {
    return { error: "This ticket is malformed." }
  }
  if (!t || typeof t !== "object" || typeof t.s !== "string" || typeof t.b !== "string" || typeof t.k !== "string") return { error: "This ticket is malformed." }
  if (typeof t.e !== "number" || t.e * 1000 < Date.now()) return { error: "This ticket has expired. Ask for a new link." }
  return { ticket: t }
}

function sendContentError(res, status, message, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers })
  res.end(JSON.stringify({ error: message }))
}

// Seeded objects without a body serve a deterministic filler of their stored
// size, streamed, so a 50 MB dump downloads without the fixture holding it.
function writeFiller(res, key, size) {
  const unit = Buffer.from(`${key}\n`, "utf8")
  const chunk = Buffer.alloc(64 * 1024)
  for (let i = 0; i < chunk.length; i++) chunk[i] = unit[i % unit.length]
  let left = size
  while (left > 0) {
    const n = Math.min(left, chunk.length)
    res.write(n === chunk.length ? chunk : chunk.subarray(0, n))
    left -= n
  }
}

export async function handleTroveContent(req, res, url) {
  if (req.method !== "GET" && req.method !== "PUT") return sendContentError(res, 405, "Only GET and PUT are allowed here.", { Allow: "GET, PUT" })

  if (req.method === "GET") {
    const { ticket: t, error } = readTicket(url.searchParams.get("t"))
    if (error) return sendContentError(res, 403, error)
    if (t.o !== "download" && t.o !== "preview") return sendContentError(res, 403, "This ticket is not for reading.")
    const s = Object.hasOwn(state, t.s) ? state[t.s] : null
    const o = s?.buckets.get(t.b)?.objects.get(t.k)
    if (!o) return sendContentError(res, 404, "object not found")
    const name = t.k.slice(t.k.lastIndexOf("/") + 1)
    const headers = {
      "Content-Type": o.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "no-store",
    }
    const limit = t.o === "preview" && typeof t.l === "number" && t.l > 0 ? t.l : Infinity
    // Like Go: Content-Length only when no read middleware matches, because
    // the stored size is not the size of what comes out.
    const readsThrough = matchingRows(s, t.b, t.k).some((r) => r.direction !== "write")
    if (o.body) {
      const bytes = o.body.subarray(0, Math.min(o.body.length, limit))
      if (!readsThrough) headers["Content-Length"] = String(bytes.length)
      res.writeHead(200, headers)
      res.end(bytes)
      return
    }
    const size = Math.min(o.storedSize, limit)
    if (!readsThrough) headers["Content-Length"] = String(size)
    res.writeHead(200, headers)
    writeFiller(res, t.k, size)
    res.end()
    return
  }

  if (url.searchParams.has("t")) return sendContentError(res, 403, "Upload tickets go in the X-Trove-Ticket header, never in the URL.")
  const header = req.headers["x-trove-ticket"]
  if (typeof header !== "string" || header === "") return sendContentError(res, 403, "This upload has no X-Trove-Ticket header.")
  const { ticket: t, error } = readTicket(header)
  if (error) return sendContentError(res, 403, error)
  if (t.o !== "upload") return sendContentError(res, 403, "This ticket is not for uploading.")
  const s = Object.hasOwn(state, t.s) ? state[t.s] : null
  const b = s?.buckets.get(t.b)
  if (!b) return sendContentError(res, 404, "bucket not found")
  if (b.objects.has(t.k) && t.ow !== true) return sendContentError(res, 409, "An object with this key already exists.")
  const declared = typeof t.n === "number" ? t.n : 0
  // Like Go, refuse on Content-Length before reading a byte. The answer
  // carries Connection: close and the rest of the body is drained, not cut off:
  // closing the socket while the client is still sending resets the connection
  // and turns a clean 413 into an ECONNRESET or EPIPE in the browser. The
  // response is complete (it has a Content-Length) before the drain ends, and
  // the socket closes only once the request has been read to its end.
  const refuseTooBig = () => {
    const payload = Buffer.from(JSON.stringify({ error: "The body is larger than the size this upload was started with." }))
    res.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": String(payload.length), Connection: "close" })
    res.write(payload)
    const finish = () => res.end()
    if (req.complete) finish()
    else {
      req.once("end", finish)
      req.once("error", finish)
      req.once("close", finish)
    }
    req.resume()
  }
  const announced = Number(req.headers["content-length"])
  if (req.headers["content-length"] !== undefined && Number.isFinite(announced) && announced > declared) {
    refuseTooBig()
    return
  }
  // A chunked body has no Content-Length, so count as it arrives. This reads
  // with events rather than for await: leaving a for await early destroys the stream.
  const chunks = []
  const outcome = await new Promise((resolve) => {
    let total = 0
    let over = false
    req.on("data", (chunk) => {
      if (over) return
      total += chunk.length
      if (total > declared) {
        over = true
        chunks.length = 0
        refuseTooBig()
        resolve("over")
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(over ? "over" : "ok"))
    req.on("error", () => resolve("error"))
  })
  if (outcome !== "ok") return
  // The fixture's stand-in for a scan provider: any key containing "eicar".
  if (/eicar/i.test(t.k)) return sendContentError(res, 422, "A content scan blocked this upload.")
  const body = Buffer.concat(chunks)
  const etag = createHash("md5").update(body).digest("hex")
  b.objects.set(t.k, {
    storedSize: body.length,
    etag,
    lastModified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    contentType: typeof t.ct === "string" && t.ct !== "" ? t.ct : null,
    storageClass: null,
    versionId: null,
    metadata: null,
    body,
  })
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  res.end(JSON.stringify({ key: t.k, storedSize: body.length, etag }))
}
