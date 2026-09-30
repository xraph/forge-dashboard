// chronicle-fixtures.mjs: in-memory state and intent handlers for the
// chronicle contributor (packages/plugin-chronicle).
//
// Mirrors chronicle's extension/contract on main (manifest.yaml and the
// handlers_*.go files). Field names are the Go JSON tags. Every refusal here
// uses the Go handler's code and message, so a page that handles the fixture's
// error handles the server's.
//
// Four chains in one app, each verifying differently: an intact plain chain
// (the default deployment), an intact mixed-level chain, a broken chain and a
// truncated one. A fixture whose chain always verifies cannot show the surface
// this dashboard exists for.
//
// Deliberate differences from production:
//   - Events are a sample: the last 40 of each chain, the events around each
//     break, and the retention record. Totals count the sample. Two small
//     additions keep the sample honest about what it exists to show: a stretch
//     of events from about a day back on the plain and mixed chains, so the
//     hourly volume chart has an empty hour to show between busy ones, and six
//     old debug events on the acme and globex chains, so a retention preview
//     has something to select.
//   - retention.enforce removes eligible sample events and reports counts; it
//     does not write retained ranges into the chain.
//
// Env switches, read on every call so a reset picks them up:
//   FIXTURE_CHRONICLE_NO_CHECKPOINTS=1  the deployment takes no checkpoints
//   FIXTURE_CHRONICLE_NO_OWN_CHAIN=1    the app-level scope has no chain
//   FIXTURE_CHRONICLE_VIEWER=tenant     the viewer is a tenant operator of acme
//   FIXTURE_CHRONICLE_NO_ERASURE=1      erasures.request is unavailable
//
// Imports nothing from server.mjs. server.mjs hands over FixtureError so
// `instanceof` in its dispatch sees the right class.

import { createHash } from "node:crypto"

const APP_ID = "app_chronicle"
const MAX_VERIFY_SPAN = 100_000
const PREVIEW_CAP = 10_000
const ENFORCE_PER_POLICY = 5_000
// The window a report verifies (compliance.DefaultVerifyWindow).
const REPORT_VERIFY_WINDOW = 50_000
const DEFAULT_REPORT_PERIOD_DAYS = 90
const MAX_SECTION_EVENTS = 1000
const ERASED = "[ERASED]"
// A fixed "now" so ages, buckets and previews are the same on every run.
const NOW = Date.parse("2026-09-29T12:00:00Z")
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const env = () => ({
  noCheckpoints: process.env.FIXTURE_CHRONICLE_NO_CHECKPOINTS === "1",
  noOwnChain: process.env.FIXTURE_CHRONICLE_NO_OWN_CHAIN === "1",
  tenantViewer: process.env.FIXTURE_CHRONICLE_VIEWER === "tenant",
  noErasure: process.env.FIXTURE_CHRONICLE_NO_ERASURE === "1",
})

/** The viewer's scope. Only an app-wide viewer owns records of every tenant. */
function viewer() {
  return env().tenantViewer ? { appId: APP_ID, tenantId: "acme" } : { appId: APP_ID, tenantId: "" }
}
function owns(v, appId, tenantId) {
  if (appId !== v.appId) return false
  return v.tenantId === "" || (tenantId ?? "") === v.tenantId
}
/** An app-level record that governs a tenant viewer without being its own. */
function governs(v, appId, tenantId) {
  return v.tenantId !== "" && appId === v.appId && (tenantId ?? "") === ""
}

/** RFC3339 in UTC, without fractional seconds, like the Go projection. */
function iso(ms) {
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z")
}

function runes(s) {
  return [...s].length
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

function checkpointsEvery(size, upTo, key) {
  const out = []
  for (let from = 1; from + size - 1 <= upTo; from += size) {
    out.push(cp(`ckpt_${key}_${out.length + 1}`, from, from + size - 1))
  }
  return out
}
function cp(id, fromSeq, toSeq) {
  return {
    id,
    fromSeq,
    toSeq,
    eventCount: toSeq - fromSeq + 1,
    createdAt: iso(NOW - (100_000 - toSeq) * 60_000),
    signKeyId: "sk_2026_09",
  }
}

function seedChains() {
  const seeded = {
    own: {
      id: "stream_app", tenantId: "", scheme: "chronicle/v4", schemeSince: 1, headSeq: 12431,
      headHash: "9f2c61a04be7d85c3a1e0f47b6d29c85e1a3f0b7c4d2e6a8f9b0c1d2e3f4a5b6",
      checkpoints: [], gaps: [], tampered: [], downgrades: [], retained: [], truncated: false,
    },
    acme: {
      id: "stream_acme", tenantId: "acme", scheme: "chronicle/v5", schemeSince: 48201, headSeq: 61004,
      headHash: "4b7e0c9d2a1f836e5d4c3b2a19087f6e5d4c3b2a1908f7e6d5c4b3a291807f6e",
      checkpoints: checkpointsEvery(10_000, 60_000, "acme"), gaps: [], tampered: [], downgrades: [], retained: [], truncated: false,
    },
    globex: {
      id: "stream_globex", tenantId: "globex", scheme: "chronicle/v5", schemeSince: 1, headSeq: 5000,
      headHash: "c0ffee5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6",
      checkpoints: [cp("ckpt_globex_1", 1, 2000), cp("ckpt_globex_2", 2001, 4000)],
      gaps: [2311, 2312], tampered: [2780], downgrades: [2901],
      retained: [{ fromSeq: 101, toSeq: 400, recordSeq: 401, policyId: "retpol_globex_debug" }],
      truncated: false,
    },
    initech: {
      id: "stream_initech", tenantId: "initech", scheme: "chronicle/v5", schemeSince: 1, headSeq: 3000,
      headHash: "7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b",
      checkpoints: [cp("ckpt_initech_1", 1, 1500), cp("ckpt_initech_2", 1501, 3400)],
      gaps: [], tampered: [], downgrades: [], retained: [], truncated: true,
    },
  }
  for (const [key, c] of Object.entries(seeded)) c.key = key
  return seeded
}

let chains
let events
let erasures
let policies
let archives
let reports
let counters

const keyed = (scheme) => scheme === "chronicle/v3" || scheme === "chronicle/v5"

/** Every chain the viewer owns, own scope first. */
function viewerChains() {
  const v = viewer()
  return Object.values(chains).filter((c) => {
    if (c.tenantId === "" && env().noOwnChain) return false
    return owns(v, APP_ID, c.tenantId)
  })
}

/** streams.mine and the empty-streamId case of every selector. */
function ownChain() {
  const v = viewer()
  return viewerChains().find((c) => c.tenantId === v.tenantId)
}

/** selectStream: a lookup key, never a grant. */
function selectChain(E, streamId) {
  if (!streamId) return ownChain()
  const c = viewerChains().find((x) => x.id === streamId)
  if (!c) throw new E(404, "NOT_FOUND", "not found")
  return c
}

function coverageCeiling(c) {
  if (c.headSeq === 0 || c.headSeq < c.schemeSince) return "unkeyed"
  if (!env().noCheckpoints) return "signed"
  return keyed(c.scheme) ? "keyed" : "unkeyed"
}

function projectStream(c) {
  const cps = env().noCheckpoints ? [] : c.checkpoints
  const latest = cps[cps.length - 1]
  const out = {
    id: c.id,
    appId: APP_ID,
    headHash: c.headHash,
    headSeq: c.headSeq,
    scheme: c.scheme,
    schemeSince: c.schemeSince,
    coverageCeiling: coverageCeiling(c),
    checkpointingConfigured: !env().noCheckpoints,
  }
  if (c.tenantId) out.tenantId = c.tenantId
  if (latest) out.latestCheckpoint = latest
  return out
}

/** Coverage spans for [from, to], split at the pin and at checkpoint cover. */
function coverageFor(c, from, to) {
  const spans = []
  if (from < c.schemeSince) {
    spans.push({ fromSeq: from, toSeq: Math.min(to, c.schemeSince - 1), level: "unkeyed" })
  }
  const keyedFrom = Math.max(from, c.schemeSince)
  if (keyedFrom > to) return spans
  const aboveLevel = keyed(c.scheme) ? "keyed" : "unkeyed"
  // A checkpoint above the pin lifts what it covers to signed. A plain chain
  // under a checkpoint is signed too: the verifier grades it that way,
  // because a signature still proves the range was not rewritten.
  const signedTo = env().noCheckpoints
    ? 0
    : Math.max(0, ...c.checkpoints.filter((k) => k.toSeq <= Math.min(to, c.headSeq)).map((k) => k.toSeq))
  if (signedTo >= keyedFrom) {
    spans.push({ fromSeq: keyedFrom, toSeq: signedTo, level: "signed" })
    if (signedTo < to) spans.push({ fromSeq: signedTo + 1, toSeq: to, level: aboveLevel })
  } else {
    spans.push({ fromSeq: keyedFrom, toSeq: to, level: aboveLevel })
  }
  return spans
}

const inRange = (from, to) => (n) => n >= from && n <= to

function verifyChain(c, from, to) {
  const within = inRange(from, to)
  const gaps = c.gaps.filter(within)
  const tampered = c.tampered.filter(within)
  const downgrades = c.downgrades.filter(within)
  const retained = c.retained
    .filter((r) => r.toSeq >= from && r.fromSeq <= to)
    .map((r) => ({ ...r, fromSeq: Math.max(r.fromSeq, from), toSeq: Math.min(r.toSeq, to) }))
  const retainedCount = retained.reduce((n, r) => n + (r.toSeq - r.fromSeq + 1), 0)
  const readTo = Math.min(to, c.headSeq)
  const verified = Math.max(0, readTo - from + 1 - gaps.length - retainedCount)

  const cpOn = !env().noCheckpoints
  const headChecked = to >= c.headSeq
  const headMatch = !c.truncated
  const overlapping = cpOn ? c.checkpoints.filter((k) => k.toSeq >= from && k.fromSeq <= to) : []
  const checkpoints = overlapping.map((k) => {
    const pastHead = k.toSeq > c.headSeq
    return {
      id: k.id, fromSeq: k.fromSeq, toSeq: k.toSeq,
      signatureValid: true,
      hashMatch: !pastHead, hashChecked: !pastHead,
      continuityOk: true, continuityChecked: true,
      ...(pastHead ? { note: "The checkpoint ends past the chain's head, so its hash could not be compared." } : {}),
    }
  })
  const latest = cpOn ? c.checkpoints[c.checkpoints.length - 1] : undefined
  const checkpointHeadChecked = latest !== undefined
  const checkpointHeadOk = latest === undefined || latest.toSeq <= c.headSeq

  const report = {
    valid:
      gaps.length === 0 && tampered.length === 0 && downgrades.length === 0 &&
      (!headChecked || headMatch) && (!checkpointHeadChecked || checkpointHeadOk) &&
      checkpoints.every((k) => k.signatureValid && (!k.hashChecked || k.hashMatch)),
    verified,
    firstEvent: verified > 0 ? from : 0,
    lastEvent: verified > 0 ? readTo : 0,
    headSeq: c.headSeq,
    partial: from > 1 || to < c.headSeq,
    headMatch, headChecked,
    checkpointsChecked: cpOn,
    checkpointHeadOk, checkpointHeadChecked,
    retentionPolicies: policies.filter((p) => p.appId === APP_ID && (!p.tenantId || p.tenantId === c.tenantId)).length,
  }
  // omitempty arrays are absent when empty, as on the wire.
  if (gaps.length) report.gaps = gaps
  if (tampered.length) report.tampered = tampered
  if (downgrades.length) report.downgrades = downgrades
  if (retained.length) report.retained = retained
  const coverage = coverageFor(c, from, to)
  if (coverage.length) report.coverage = coverage
  if (checkpoints.length) report.checkpoints = checkpoints
  return report
}

function verifyRun(E, input) {
  const c = selectChain(E, input.streamId)
  if (!c) return { noChain: true }
  const from = input.fromSeq || 1
  const to = input.toSeq || c.headSeq
  if (input.toSeq && to < from) throw new E(400, "BAD_REQUEST", "toSeq cannot be less than fromSeq")
  const span = to >= from ? to - from + 1 : 0
  if (span > MAX_VERIFY_SPAN) {
    throw new E(
      400,
      "BAD_REQUEST",
      `requested range covers ${span} events, which exceeds the ${MAX_VERIFY_SPAN}-event limit on a single verification; ` +
        `the chain's head is at sequence ${c.headSeq}, so ask for a bounded window within it`,
    )
  }
  return { noChain: false, report: verifyChain(c, from, to) }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const ACTION_ROTATION = [
  ["user.login", "auth", "session"],
  ["user.logout", "auth", "session"],
  ["record.update", "data", "patient_record"],
  ["record.read", "data", "patient_record"],
  ["role.grant", "admin", "role"],
  ["invoice.pay", "billing", "invoice"],
]

// The one hour of 2026-09-28 that holds no events, so the volume chart has a
// gap to show. Events that would land in it are moved back an hour.
const EMPTY_HOUR_START = Date.parse("2026-09-28T03:00:00Z")
const EMPTY_HOUR_END = Date.parse("2026-09-28T04:00:00Z")

function digest(key, seq) {
  return createHash("sha256").update(`${key}:${seq}`).digest("hex")
}

function eventTime(c, seq) {
  let ts = NOW - (c.headSeq - seq) * 7 * MINUTE
  if (ts >= EMPTY_HOUR_START && ts < EMPTY_HOUR_END) ts -= HOUR
  return ts
}

function buildEvent(c, seq) {
  const [action, category, resource] = ACTION_ROTATION[seq % 6]
  const scheme = seq >= c.schemeSince ? c.scheme : "chronicle/v4"
  const e = {
    id: `audit_${c.key}_${seq}`,
    streamId: c.id,
    tenantId: c.tenantId,
    sequence: seq,
    ts: eventTime(c, seq),
    action,
    category,
    resource,
    resourceId: `${resource}_${(seq % 40) + 1}`,
    outcome: seq % 17 === 0 ? "denied" : seq % 11 === 0 ? "failure" : "success",
    severity: seq % 23 === 0 ? "critical" : seq % 5 === 0 ? "warning" : "info",
    ip: `10.0.0.${seq % 250}`,
    hash: seq === c.headSeq ? c.headHash : digest(c.key, seq),
    prevHash: digest(c.key, seq - 1),
    hashScheme: scheme,
    subjectId: `subject_${(seq % 4) + 1}`,
    userAgent: "Mozilla/5.0 (fixture)",
    requestId: `req_${seq}`,
    sessionId: `sess_${seq % 9}`,
    metadata: { requestPath: `/api/${resource}`, fields: ["name", "dob"], attempt: seq % 3 },
    erased: false,
  }
  if (seq % 13 !== 0) e.userId = `user_${(seq % 7) + 1}`
  if (keyed(scheme)) e.hashKeyId = "hk_1"
  // A downgrade is an event stamped with a weaker scheme than the pin.
  if (c.downgrades.includes(seq)) {
    e.hashScheme = "chronicle/v4"
    delete e.hashKeyId
  }
  return e
}

function seedEvents() {
  const out = []
  for (const c of Object.values(chains)) {
    const seqs = new Set()
    for (let s = Math.max(1, c.headSeq - 39); s <= c.headSeq; s++) seqs.add(s)
    if (c.key === "own" || c.key === "acme") {
      for (let s = c.headSeq - 300; s <= c.headSeq - 257; s++) seqs.add(s)
    }
    if (c.key === "globex") {
      for (const s of [2310, 2313, 2779, 2780, 2781, 2900, 2901]) seqs.add(s)
    }
    const debugSeqs = c.key === "acme" ? [201, 202, 203, 204, 205, 206] : c.key === "globex" ? [1201, 1202, 1203, 1204, 1205, 1206] : []
    for (const s of debugSeqs) seqs.add(s)

    const retainedSeq = (s) => c.retained.some((r) => s >= r.fromSeq && s <= r.toSeq)
    for (const s of [...seqs].sort((a, b) => a - b)) {
      if (c.gaps.includes(s) || retainedSeq(s)) continue
      const e = buildEvent(c, s)
      if (debugSeqs.includes(s)) {
        Object.assign(e, { action: "debug.trace", category: "debug", resource: "worker", resourceId: "worker_1", outcome: "success", severity: "info" })
      }
      out.push(e)
    }
  }

  const byId = (id) => out.find((e) => e.id === id)

  // An action with a pipe in it, so anything that renders one into a markdown
  // table or a delimited row has to cope.
  Object.assign(byId("audit_acme_61001"), { action: "role.grant|revoke", category: "admin", resource: "role", resourceId: "role_3" })

  // The erased row. Its subject is the one erasure_1 names.
  Object.assign(byId("audit_own_12400"), {
    subjectId: "subject_9",
    erased: true,
    erasedAt: iso(NOW - 20 * DAY),
    erasureId: "erasure_1",
    ip: ERASED,
    reason: ERASED,
  })
  // The victim case: the literal marker recorded as an ordinary value, with no
  // erasure behind it. Nothing here may read as an erasure requested here. Its
  // subject is one no seeded erasure and no ordinary request names, so the row
  // stays a victim however many erasures are run against the sample.
  Object.assign(byId("audit_own_12401"), { subjectId: "subject_victim", reason: ERASED })

  const retention = buildEvent(chains.globex, 401)
  Object.assign(retention, {
    action: "chronicle.retention.purge",
    category: "chronicle",
    resource: "retention_policy",
    resourceId: "retpol_globex_debug",
    outcome: "success",
    severity: "info",
    metadata: { policyId: "retpol_globex_debug", fromSeq: 101, toSeq: 400 },
  })
  delete retention.userId
  out.push(retention)
  return out
}

function projectSummary(e) {
  const s = {
    id: e.id,
    timestamp: iso(e.ts),
    sequence: e.sequence,
    action: e.action,
    resource: e.resource,
    category: e.category,
    outcome: e.outcome,
    severity: e.severity,
    erased: e.erased,
  }
  if (e.resourceId) s.resourceId = e.resourceId
  if (e.userId) s.userId = e.userId
  if (e.ip) s.ip = e.ip
  return s
}

function projectDetail(e) {
  const d = { ...projectSummary(e), streamId: e.streamId, hash: e.hash, prevHash: e.prevHash }
  for (const k of ["hashScheme", "hashKeyId", "reason", "subjectId", "userAgent", "requestId", "sessionId", "metadata", "erasureId"]) {
    if (e[k] !== undefined && e[k] !== "") d[k] = e[k]
  }
  if (e.erasedAt) d.erasedAt = e.erasedAt
  return d
}

/** Every event of a chain the viewer owns. */
function viewerEvents() {
  const ids = new Set(viewerChains().map((c) => c.id))
  return events.filter((e) => ids.has(e.streamId))
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function whole(raw) {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
}

/** pageBounds: negative refused, zero takes the default, over the max is capped. */
function pageBounds(E, input, defaultLimit, maxLimit) {
  let limit = whole(input.limit)
  const offset = whole(input.offset)
  if (limit < 0 || offset < 0) throw new E(400, "BAD_REQUEST", "limit and offset cannot be negative")
  if (limit === 0) limit = defaultLimit
  if (limit > maxLimit) limit = maxLimit
  return { limit, offset }
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

/** An optional RFC3339 bound. Empty is unbounded. */
function parseBound(E, raw, field) {
  if (raw === undefined || raw === null || raw === "") return undefined
  const ms = typeof raw === "string" && RFC3339.test(raw) ? Date.parse(raw) : Number.NaN
  if (Number.isNaN(ms)) throw new E(400, "BAD_REQUEST", `${field} is not a valid RFC3339 timestamp`)
  return ms
}

const list = (raw) => (Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [])
const str = (raw) => (typeof raw === "string" ? raw : "")

function sortEvents(rows, order) {
  const dir = order === "asc" ? 1 : -1
  return [...rows].sort((a, b) => dir * (a.ts - b.ts || a.sequence - b.sequence))
}

function filterEvents(rows, f) {
  const cats = list(f.categories)
  const acts = list(f.actions)
  const res = list(f.resources)
  const sev = list(f.severity)
  const out = list(f.outcome)
  return rows.filter(
    (e) =>
      (f.after === undefined || e.ts >= f.after) &&
      (f.before === undefined || e.ts <= f.before) &&
      (!f.userId || e.userId === f.userId) &&
      (!f.sessionId || e.sessionId === f.sessionId) &&
      (!f.requestId || e.requestId === f.requestId) &&
      (cats.length === 0 || cats.includes(e.category)) &&
      (acts.length === 0 || acts.includes(e.action)) &&
      (res.length === 0 || res.includes(e.resource)) &&
      (sev.length === 0 || sev.includes(e.severity)) &&
      (out.length === 0 || out.includes(e.outcome)),
  )
}

const GROUP_FIELDS = ["category", "action", "outcome", "severity", "resource", "day", "hour"]

/** ResolveGroupBy's checks, with its messages. */
function resolveGroupBy(E, raw) {
  const fields = Array.isArray(raw) ? raw : []
  if (fields.length === 0) throw new E(400, "BAD_REQUEST", "aggregate query requires at least one group_by field")
  const seen = new Set()
  let bucketField = ""
  for (const field of fields) {
    if (!GROUP_FIELDS.includes(field)) throw new E(400, "BAD_REQUEST", `unsupported group_by field: ${JSON.stringify(field)}`)
    if (seen.has(field)) throw new E(400, "BAD_REQUEST", `duplicate group_by field: ${JSON.stringify(field)}`)
    seen.add(field)
    if (field === "day" || field === "hour") {
      if (bucketField !== "") {
        throw new E(400, "BAD_REQUEST", `group_by names more than one time bucket field: ${JSON.stringify(bucketField)} and ${JSON.stringify(field)}`)
      }
      bucketField = field
    }
  }
  return fields
}

function bucketOf(ts, field) {
  const d = new Date(ts).toISOString()
  return field === "day" ? d.slice(0, 10) : `${d.slice(0, 13)}:00:00Z`
}

/** An aggregate over `rows`. A period with no events yields no group. */
function aggregate(rows, fields) {
  const groups = new Map()
  for (const e of rows) {
    const g = {}
    for (const f of fields) {
      const value = f === "day" || f === "hour" ? bucketOf(e.ts, f) : e[f]
      // A key whose value is empty is absent from the group.
      const key = f === "day" || f === "hour" ? "bucket" : f
      if (value) g[key] = value
    }
    const id = JSON.stringify(g)
    const cur = groups.get(id)
    if (cur) cur.count += 1
    else groups.set(id, { ...g, count: 1 })
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1)).map(([, g]) => g)
  return { groups: sorted, total: rows.length }
}

// ---------------------------------------------------------------------------
// Erasures
// ---------------------------------------------------------------------------

function seedErasures() {
  return [
    {
      id: "erasure_1", seq: 1, tenantId: "", subjectId: "subject_9", reason: "GDPR Article 17 request 4471",
      requestedBy: "user_admin", eventsAffected: 1, keyDestroyed: true, legacyKeyRetained: false, status: "completed",
      createdAt: NOW - 20 * DAY,
    },
    {
      id: "erasure_2", seq: 2, tenantId: "acme", subjectId: "legacy-user", reason: "Account closure",
      requestedBy: "user_admin", eventsAffected: 3, keyDestroyed: false, legacyKeyRetained: true, status: "completed",
      createdAt: NOW - 5 * DAY,
    },
    // An erasure that did not finish: some keys may be gone, none confirmed destroyed.
    {
      id: "erasure_3", seq: 3, tenantId: "", subjectId: "subject_3", reason: "GDPR Article 17 request 4502",
      requestedBy: "user_admin", eventsAffected: 2, keyDestroyed: false, legacyKeyRetained: false, status: "pending",
      createdAt: NOW - 1 * DAY,
    },
  ]
}

function projectErasure(r) {
  return {
    id: r.id, subjectId: r.subjectId, reason: r.reason, requestedBy: r.requestedBy,
    eventsAffected: r.eventsAffected, keyDestroyed: r.keyDestroyed, legacyKeyRetained: r.legacyKeyRetained,
    status: r.status, createdAt: iso(r.createdAt),
  }
}

function viewerErasures() {
  const v = viewer()
  return erasures.filter((r) => owns(v, APP_ID, r.tenantId)).sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq)
}

const isControl = (ch) => /[\u0000-\u001f\u007f-\u009f]/.test(ch)
const wellFormed = (s) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)

function checkSubjectId(E, subjectId) {
  const bad = (m) => new E(400, "BAD_REQUEST", m)
  if (subjectId === "") throw bad("subjectId is required")
  if (!wellFormed(subjectId)) throw bad("subjectId is not valid UTF-8")
  if (runes(subjectId) > 256) throw bad("subjectId is longer than 256 characters")
  if ([...subjectId].some(isControl)) throw bad("subjectId contains a control character")
  if (/^\s|\s$/u.test(subjectId)) throw bad("subjectId has leading or trailing whitespace; it is compared exactly, so remove it")
}

function checkReason(E, reason) {
  const bad = (m) => new E(400, "BAD_REQUEST", m)
  if (!wellFormed(reason)) throw bad("reason is not valid UTF-8")
  if ([...reason].some((ch) => ch !== "\n" && isControl(ch))) throw bad("reason contains a control character other than a newline")
  if (reason.trim() === "") throw bad("reason is required")
  if (runes(reason) > 2000) throw bad("reason is longer than 2000 characters")
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

function seedPolicies() {
  return [
    { id: "retpol_app_all", appId: APP_ID, tenantId: "", category: "*", durationMs: 8760 * HOUR, archive: false, createdAt: NOW - 200 * DAY, updatedAt: NOW - 200 * DAY },
    { id: "retpol_acme_debug", appId: APP_ID, tenantId: "acme", category: "debug", durationMs: 720 * HOUR, archive: false, createdAt: NOW - 120 * DAY, updatedAt: NOW - 120 * DAY },
    { id: "retpol_globex_debug", appId: APP_ID, tenantId: "globex", category: "debug", durationMs: 168 * HOUR, archive: true, createdAt: NOW - 90 * DAY, updatedAt: NOW - 40 * DAY },
  ]
}

function seedArchives() {
  return [
    {
      id: "archive_globex_1", tenantId: "globex", policyId: "retpol_globex_debug", category: "debug", eventCount: 300,
      fromTimestamp: Date.parse("2026-09-01T00:00:00Z"), toTimestamp: Date.parse("2026-09-13T00:00:00Z"),
      sinkName: "s3", sinkRef: "s3://audit-archive/globex/2026-09-20.jsonl.gz", createdAt: Date.parse("2026-09-20T03:00:00Z"),
    },
  ]
}

/** Go's Duration.String for whole seconds. */
function goDuration(ms) {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${m}m${s}s`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

/** time.ParseDuration for the h, m and s units, after a trim. Null when it does not parse. */
function parseGoDuration(raw) {
  const s = raw.trim()
  if (s === "0" || s === "+0" || s === "-0") return 0
  const m = /^([+-])?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s)
  if (!m || s === "" || !/\d/.test(s)) return null
  const ms = (Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)) * 1000
  return m[1] === "-" ? -ms : ms
}

function projectPolicy(p, editable) {
  const out = {
    id: p.id, category: p.category, duration: goDuration(p.durationMs), archive: p.archive,
    appId: p.appId, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt), editable,
  }
  if (p.tenantId) out.tenantId = p.tenantId
  return out
}

/** The policies the viewer may change: every one in its app, or a tenant's own. */
function ownPolicies() {
  const v = viewer()
  return policies.filter((p) => owns(v, p.appId, p.tenantId))
}
function governingPolicies() {
  const v = viewer()
  return policies.filter((p) => governs(v, p.appId, p.tenantId))
}

/** Events a policy selects: older than its duration, in its scope and category. */
function eligibleEvents(p) {
  const cutoff = NOW - p.durationMs
  return viewerEvents().filter(
    (e) => (p.tenantId === "" || e.tenantId === p.tenantId) && (p.category === "*" || e.category === p.category) && e.ts < cutoff,
  )
}

function validCategory(c) {
  if (c === "*") return true
  if (c === "" || !wellFormed(c) || runes(c) > 64) return false
  if ([...c].some((ch) => ch === ":" || isControl(ch))) return false
  return !/^\s|\s$/u.test(c)
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function statsOf(rows) {
  return {
    totalEvents: rows.length,
    criticalEvents: rows.filter((e) => e.severity === "critical").length,
    failedEvents: rows.filter((e) => e.outcome === "failure").length,
    deniedEvents: rows.filter((e) => e.outcome === "denied").length,
  }
}

function makeSection(title, rows, notes) {
  const sorted = sortEvents(rows, "desc")
  const section = {
    title,
    events: sorted.slice(0, MAX_SECTION_EVENTS).map(projectSummary),
    matchedEvents: rows.length,
    eventsTruncated: rows.length > MAX_SECTION_EVENTS,
    stats: aggregate(rows, ["outcome"]),
  }
  if (notes) section.notes = notes
  return section
}

/** The verification a report carries: the chain's last window, and what it left out. */
function verificationFor(c, appWide) {
  const cpOn = !env().noCheckpoints
  if (!c) {
    return {
      scope: { status: "no_chain", headSeq: 0, fromSeq: 0, toSeq: 0, window: REPORT_VERIFY_WINDOW, capped: false, checkpointsConfigured: cpOn, notes: [] },
    }
  }
  const toSeq = c.headSeq
  const fromSeq = Math.max(1, toSeq - REPORT_VERIFY_WINDOW + 1)
  const capped = fromSeq > 1
  const notes = []
  if (capped) {
    notes.push(`Sequences 1 to ${fromSeq - 1} were not verified: the report verifies at most 50,000 sequences.`)
  }
  if (appWide) {
    notes.push("This report was generated for the whole app, so it verified only the app's untenanted chain. Each tenant's chain was not verified.")
  }
  const scope = {
    status: "verified",
    streamId: c.id,
    scheme: c.scheme,
    ...(c.schemeSince ? { schemeSince: c.schemeSince } : {}),
    headSeq: c.headSeq,
    fromSeq,
    toSeq,
    window: REPORT_VERIFY_WINDOW,
    capped,
    checkpointsConfigured: cpOn,
    notes,
  }
  // The stored report carries no policy count: it was not taken now.
  return { scope, verification: { ...verifyChain(c, fromSeq, toSeq), retentionPolicies: -1 } }
}

function seedReports() {
  const acme = events.filter((e) => e.tenantId === "acme")
  const own = events.filter((e) => e.tenantId === "")
  const acmeVerify = verificationFor(chains.acme, false)
  const soc2 = {
    id: "report_soc2", tenantId: "acme", type: "soc2", title: "SOC 2 evidence, Q3",
    period: { from: "2026-07-01T00:00:00Z", to: "2026-09-29T12:00:00Z" },
    generatedBy: "user_admin", format: "json", createdAt: NOW - 2 * HOUR,
    stats: statsOf(acme),
    sections: [
      makeSection("Logical access", acme.filter((e) => e.category === "auth")),
      makeSection("Change management", acme.filter((e) => e.category === "admin" || e.category === "data")),
    ],
    verification: acmeVerify.verification,
    verificationScope: acmeVerify.scope,
  }
  // Generated before reports recorded a scope: no verification, no scope.
  const hipaa = {
    id: "report_hipaa", tenantId: "", type: "hipaa", title: "HIPAA access review",
    period: { from: "2026-06-29T00:00:00Z", to: "2026-09-27T00:00:00Z" },
    generatedBy: "user_admin", format: "json", createdAt: NOW - 2 * DAY,
    stats: statsOf(own),
    sections: [makeSection("Access to patient records", own.filter((e) => e.category === "data"))],
  }
  const ai = {
    id: "report_ai", tenantId: "", type: "eu_ai_act", title: "EU AI Act activity summary",
    period: { from: "2026-06-29T00:00:00Z", to: "2026-09-27T00:00:00Z" },
    generatedBy: "user_admin", format: "json", createdAt: NOW - 3 * DAY,
    stats: { totalEvents: 0, criticalEvents: 0, failedEvents: 0, deniedEvents: 0 },
    sections: [],
    verificationScope: verificationFor(undefined, false).scope,
  }
  return [soc2, hipaa, ai]
}

function projectReportSummary(r) {
  const out = {
    id: r.id, title: r.title, type: r.type, period: { ...r.period },
    generatedBy: r.generatedBy, format: r.format, createdAt: iso(r.createdAt),
  }
  if (r.stats) out.stats = { ...r.stats }
  return out
}

function projectReportDetail(r) {
  const out = { ...projectReportSummary(r), sections: r.sections }
  if (r.verification) out.verification = r.verification
  if (r.verificationScope) out.verificationScope = r.verificationScope
  return out
}

function viewerReports() {
  const v = viewer()
  return reports.filter((r) => owns(v, APP_ID, r.tenantId)).sort((a, b) => b.createdAt - a.createdAt)
}

/** reportPeriod: absent or both empty is the last 90 days. */
function reportPeriod(E, p) {
  const bad = (m) => new E(400, "BAD_REQUEST", m)
  const from = p && typeof p === "object" ? str(p.from) : ""
  const to = p && typeof p === "object" ? str(p.to) : ""
  if (from === "" && to === "") {
    return { from: iso(NOW - DEFAULT_REPORT_PERIOD_DAYS * DAY), to: iso(NOW), fromMs: NOW - DEFAULT_REPORT_PERIOD_DAYS * DAY, toMs: NOW }
  }
  if (from === "" || to === "") throw bad("period needs both from and to, or neither")
  const fromMs = RFC3339.test(from) ? Date.parse(from) : Number.NaN
  if (Number.isNaN(fromMs)) throw bad("period.from is not a valid RFC3339 timestamp")
  const toMs = RFC3339.test(to) ? Date.parse(to) : Number.NaN
  if (Number.isNaN(toMs)) throw bad("period.to is not a valid RFC3339 timestamp")
  if (toMs < fromMs) throw bad("period.to cannot be before period.from")
  return { from: iso(fromMs), to: iso(toMs), fromMs, toMs }
}

/** A report the viewer generated, on the viewer's own chain. */
function saveReport(type, title, period, sections, rows) {
  const v = viewer()
  const c = ownChain()
  const { scope, verification } = verificationFor(c, v.tenantId === "")
  const report = {
    id: `report_${counters.report++}`,
    tenantId: v.tenantId,
    type,
    title,
    period: { from: period.from, to: period.to },
    generatedBy: "user_admin",
    format: "json",
    createdAt: NOW,
    stats: statsOf(rows),
    sections,
    verificationScope: scope,
  }
  if (verification) report.verification = verification
  reports.unshift(report)
  return report
}

function csvCell(s) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const htmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function exportContent(r, format) {
  const detail = projectReportDetail(r)
  if (format === "json") return JSON.stringify(detail, null, 2)
  if (format === "csv") {
    const lines = ["section,matched_events,events_listed,truncated"]
    for (const s of detail.sections) lines.push([csvCell(s.title), s.matchedEvents, s.events.length, s.eventsTruncated].join(","))
    return lines.join("\n") + "\n"
  }
  if (format === "markdown") {
    const out = [`# ${r.title}`, "", `Type: ${r.type}. Period: ${r.period.from} to ${r.period.to}.`, "", "| Section | Matched events |", "|---|---|"]
    for (const s of detail.sections) out.push(`| ${s.title} | ${s.matchedEvents} |`)
    for (const s of detail.sections) {
      out.push("", `## ${s.title}`, "", "| Time | Action | Outcome |", "|---|---|---|")
      for (const e of s.events) out.push(`| ${e.timestamp} | ${e.action} | ${e.outcome} |`)
    }
    return out.join("\n") + "\n"
  }
  // html: a full document with a script tag in it, so a page that injected it
  // instead of offering a download would show the problem.
  const body = detail.sections
    .map(
      (s) =>
        `<h2>${htmlEscape(s.title)}</h2><table><tr><th>Time</th><th>Action</th><th>Outcome</th></tr>` +
        s.events.map((e) => `<tr><td>${e.timestamp}</td><td>${htmlEscape(e.action)}</td><td>${e.outcome}</td></tr>`).join("") +
        "</table>",
    )
    .join("")
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(r.title)}</title></head><body>` +
    `<h1>${htmlEscape(r.title)}</h1><script>document.body.setAttribute("data-fixture-injected", "true")</script>${body}</body></html>\n`
  )
}

const EXPORT_FORMATS = {
  json: ["json", "application/json; charset=utf-8"],
  csv: ["csv", "text/csv; charset=utf-8"],
  markdown: ["md", "text/markdown; charset=utf-8"],
  html: ["html", "text/html; charset=utf-8"],
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function resetChronicle() {
  counters = { erasure: 4, report: 1, archive: 2 }
  chains = seedChains()
  events = seedEvents()
  erasures = seedErasures()
  policies = seedPolicies()
  archives = seedArchives()
  reports = seedReports()
}

resetChronicle()

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 *   server.mjs's own error class, so refusals carry their real status and code.
 */
export function createChronicleHandlers(FixtureError) {
  const E = FixtureError
  const badRequest = (message) => new E(400, "BAD_REQUEST", message)
  const notFound = () => new E(404, "NOT_FOUND", "not found")

  function eventFilter(input) {
    return {
      after: parseBound(E, input.after, "after"),
      before: parseBound(E, input.before, "before"),
      userId: str(input.userId),
      sessionId: str(input.sessionId),
      requestId: str(input.requestId),
      categories: input.categories,
      actions: input.actions,
      resources: input.resources,
      severity: input.severity,
      outcome: input.outcome,
    }
  }

  function ownedPolicy(id) {
    const p = policies.find((x) => x.id === id)
    if (!p || !owns(viewer(), p.appId, p.tenantId)) throw notFound()
    return p
  }

  function findOwnedReport(id) {
    const r = reports.find((x) => x.id === id)
    if (!r || !owns(viewer(), APP_ID, r.tenantId)) throw notFound()
    return r
  }

  function eventVerdict(e) {
    const c = Object.values(chains).find((x) => x.id === e.streamId)
    const scheme = e.hashScheme ?? ""
    const belowPin = e.sequence < c.schemeSince
    let valid = true
    if (c.tampered.includes(e.sequence) || c.downgrades.includes(e.sequence)) valid = false
    if (scheme === "" && !belowPin) valid = false
    return { valid, hashScheme: scheme, keyed: valid && keyed(scheme) }
  }

  function overviewStats() {
    const rows = viewerEvents()
    const s = statsOf(rows)
    return {
      ...s,
      erasureCount: viewerErasures().length,
      categories: aggregate(rows, ["category"]).groups,
      severities: aggregate(rows, ["severity"]).groups,
      outcomes: aggregate(rows, ["outcome"]).groups,
    }
  }

  const ownEventsBySubject = (subjectId) => viewerEvents().filter((e) => e.subjectId === subjectId)

  function generate(type, title, input, sectionDefs) {
    const period = reportPeriod(E, input.period)
    const rows = viewerEvents().filter((e) => e.ts >= period.fromMs && e.ts <= period.toMs)
    const sections = sectionDefs(rows)
    return saveReport(type, title, period, sections, rows)
  }

  return {
    "streams.mine": {
      kind: "query",
      handler: (input) => {
        const c = selectChain(E, str(input?.streamId))
        return c ? { stream: projectStream(c) } : {}
      },
    },

    "streams.list": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = pageBounds(E, input ?? {}, 50, 200)
        const all = viewerChains()
        const page = all.slice(offset, offset + limit)
        return { streams: page.map(projectStream), total: all.length, hasMore: offset + page.length < all.length }
      },
    },

    "verify.run": { kind: "query", handler: (input) => verifyRun(E, input ?? {}) },

    "verify.event": {
      kind: "query",
      handler: (input) => {
        const e = viewerEvents().find((x) => x.id === input?.eventId)
        if (!e) throw notFound()
        return eventVerdict(e)
      },
    },

    "checkpoints.list": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = pageBounds(E, input ?? {}, 50, 200)
        const c = selectChain(E, str(input?.streamId))
        // The pre-8d3b2d7 shape, on purpose: the zero value marshals a null.
        if (env().noCheckpoints) return { checkpoints: null, hasMore: false, supported: false }
        const newestFirst = c ? [...c.checkpoints].reverse() : []
        const page = newestFirst.slice(offset, offset + limit)
        return { checkpoints: page, hasMore: newestFirst.length > offset + limit, supported: true }
      },
    },

    "checkpoints.detail": {
      kind: "query",
      handler: (input) => {
        if (env().noCheckpoints) throw notFound()
        for (const c of viewerChains()) {
          const found = c.checkpoints.find((k) => k.id === input?.id)
          if (found) return { checkpoint: found }
        }
        throw notFound()
      },
    },

    "checkpoints.take": {
      kind: "command",
      invalidates: ["checkpoints.list", "streams.mine", "streams.list", "verify.run"],
      handler: (input) => {
        if (env().noCheckpoints) throw new E(503, "UNAVAILABLE", "this deployment takes no checkpoints")
        const c = selectChain(E, str(input?.streamId))
        if (!c) throw new E(404, "NOT_FOUND", "this scope has not recorded any events yet, so there is nothing to checkpoint")
        const latest = c.checkpoints[c.checkpoints.length - 1]
        const from = latest ? latest.toSeq + 1 : 1
        if (c.headSeq < from) return { upToDate: true }
        const made = { ...cp(`ckpt_${c.key}_${c.checkpoints.length + 1}`, from, c.headSeq), createdAt: iso(NOW) }
        c.checkpoints.push(made)
        return { checkpoint: made, upToDate: false }
      },
    },

    "events.list": {
      kind: "query",
      handler: (input) => {
        const i = input ?? {}
        const { limit, offset } = pageBounds(E, i, 50, 1000)
        if (i.order !== undefined && i.order !== "" && i.order !== "asc" && i.order !== "desc") {
          throw badRequest('order must be "asc" or "desc"')
        }
        const filtered = sortEvents(filterEvents(viewerEvents(), eventFilter(i)), i.order)
        const page = filtered.slice(offset, offset + limit)
        return { events: page.map(projectSummary), total: filtered.length, hasMore: offset + page.length < filtered.length }
      },
    },

    "events.detail": {
      kind: "query",
      handler: (input) => {
        const e = viewerEvents().find((x) => x.id === input?.id)
        if (!e) throw notFound()
        return projectDetail(e)
      },
    },

    "events.aggregate": {
      kind: "query",
      handler: (input) => {
        const i = input ?? {}
        const fields = resolveGroupBy(E, i.groupBy)
        const rows = filterEvents(viewerEvents(), { after: parseBound(E, i.after, "after"), before: parseBound(E, i.before, "before") })
        return aggregate(rows, fields)
      },
    },

    "events.byUser": {
      kind: "query",
      handler: (input) => {
        const i = input ?? {}
        if (str(i.userId) === "") throw badRequest("userId is required")
        const { limit, offset } = pageBounds(E, i, 50, 1000)
        const filter = { after: parseBound(E, i.after, "after"), before: parseBound(E, i.before, "before"), userId: i.userId }
        const filtered = sortEvents(filterEvents(viewerEvents(), filter), "desc")
        const page = filtered.slice(offset, offset + limit)
        return { events: page.map(projectSummary), total: filtered.length, hasMore: offset + page.length < filtered.length }
      },
    },

    "overview.stats": { kind: "query", handler: () => overviewStats() },

    "erasures.list": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = pageBounds(E, input ?? {}, 50, 1000)
        const all = viewerErasures()
        const page = all.slice(offset, offset + limit)
        return { erasures: page.map(projectErasure), total: all.length, hasMore: offset + page.length < all.length }
      },
    },

    "erasures.detail": {
      kind: "query",
      handler: (input) => {
        const r = viewerErasures().find((x) => x.id === input?.id)
        if (!r) throw notFound()
        return projectErasure(r)
      },
    },

    "erasures.preview": {
      kind: "query",
      handler: (input) => {
        const subjectId = str(input?.subjectId)
        if (subjectId === "") throw badRequest("subjectId is required")
        return { subjectId, eventsAffected: ownEventsBySubject(subjectId).length }
      },
    },

    "erasures.request": {
      kind: "command",
      invalidates: ["erasures.list", "erasures.preview", "overview.stats", "events.list", "events.detail", "events.byUser"],
      handler: (input) => {
        // Checked before any input, as the Go handler does.
        if (env().noErasure) {
          throw new E(
            503,
            "UNAVAILABLE",
            "erasure is not enabled on this deployment: set chronicle.enable_crypto_erasure to true and give the extension a key store",
          )
        }
        const subjectId = str(input?.subjectId)
        const reason = str(input?.reason)
        checkSubjectId(E, subjectId)
        checkReason(E, reason)

        const hit = ownEventsBySubject(subjectId)
        const seq = counters.erasure++
        const id = `erasure_${seq}`
        for (const e of hit) {
          Object.assign(e, { erased: true, erasedAt: iso(NOW), erasureId: id, ip: ERASED, reason: ERASED })
        }
        // The key of a subject who also has events in another scope is kept.
        const legacyKeyRetained = subjectId === "legacy-user"
        erasures.push({
          id, seq, tenantId: viewer().tenantId, subjectId, reason, requestedBy: "user_admin",
          eventsAffected: hit.length, keyDestroyed: !legacyKeyRetained, legacyKeyRetained, status: "completed", createdAt: NOW,
        })
        return { id, subjectId, eventsAffected: hit.length, keyDestroyed: !legacyKeyRetained, legacyKeyRetained }
      },
    },

    "retention.policies": {
      kind: "query",
      handler: () => {
        const rows = [...ownPolicies().map((p) => projectPolicy(p, true)), ...governingPolicies().map((p) => projectPolicy(p, false))]
        return { policies: rows, total: rows.length }
      },
    },

    "retention.policyDetail": {
      kind: "query",
      handler: (input) => {
        const p = policies.find((x) => x.id === input?.id)
        const v = viewer()
        if (p && owns(v, p.appId, p.tenantId)) return projectPolicy(p, true)
        if (p && governs(v, p.appId, p.tenantId)) return projectPolicy(p, false)
        throw notFound()
      },
    },

    "retention.savePolicy": {
      kind: "command",
      invalidates: ["retention.policies", "retention.policyDetail", "retention.preview", "verify.run"],
      handler: (input) => {
        const i = input ?? {}
        const category = typeof i.category === "string" ? i.category : undefined
        let durationMs
        if (typeof i.duration === "string") {
          durationMs = parseGoDuration(i.duration)
          if (durationMs === null) throw badRequest("duration is not a valid duration, such as 720h")
          if (durationMs <= 0) {
            throw badRequest("duration must be greater than zero: a zero or negative duration purges the category's entire history")
          }
        }
        const archive = typeof i.archive === "boolean" ? i.archive : undefined

        if (i.id !== undefined && i.id !== null) {
          const p = ownedPolicy(i.id)
          // The category is part of a policy's identity.
          if (category !== undefined && category !== p.category) {
            throw badRequest("a policy's category cannot be changed: delete it and create a policy for the new category")
          }
          if (durationMs !== undefined) p.durationMs = durationMs
          if (archive !== undefined) p.archive = archive
          p.updatedAt = NOW
          return projectPolicy(p, true)
        }

        if (category === undefined) throw badRequest("category is required")
        if (durationMs === undefined) throw badRequest("duration is required")
        if (!validCategory(category)) {
          throw badRequest(`category must be "*" or 1 to 64 characters with no ':', no control characters, and no leading or trailing spaces`)
        }
        const v = viewer()
        if (ownPolicies().some((p) => p.tenantId === v.tenantId && p.category === category)) {
          throw new E(409, "CONFLICT", "a retention policy for this category already exists in this scope")
        }
        // A readable id that is the same every time the same policy is made,
        // so a script can delete what it created.
        const slug = category === "*" ? "all" : category.toLowerCase().replace(/[^a-z0-9]+/g, "_")
        const base = `retpol_${v.tenantId || "app"}_${slug}`
        let id = base
        for (let n = 2; policies.some((p) => p.id === id); n++) id = `${base}_${n}`
        const made = {
          id, appId: v.appId, tenantId: v.tenantId, category, durationMs, archive: archive ?? false, createdAt: NOW, updatedAt: NOW,
        }
        policies.push(made)
        return projectPolicy(made, true)
      },
    },

    "retention.deletePolicy": {
      kind: "command",
      invalidates: ["retention.policies", "retention.policyDetail", "retention.preview", "verify.run"],
      handler: (input) => {
        const p = ownedPolicy(input?.id)
        policies = policies.filter((x) => x !== p)
        return { id: p.id }
      },
    },

    "retention.preview": {
      kind: "query",
      handler: () => {
        const own = ownPolicies()
        const distinct = new Set()
        let capped = false
        const byPolicy = own.map((p) => {
          const hit = eligibleEvents(p)
          const isCapped = hit.length > PREVIEW_CAP
          if (isCapped) capped = true
          const counted = hit.slice(0, PREVIEW_CAP)
          for (const e of counted) distinct.add(e.id)
          return { policyId: p.id, category: p.category, eventCount: counted.length, capped: isCapped }
        })
        return {
          eventCount: distinct.size,
          capped,
          noPolicies: own.length === 0,
          governingAppPolicies: governingPolicies().length,
          byPolicy,
        }
      },
    },

    "retention.enforce": {
      kind: "command",
      invalidates: [
        "retention.policies", "retention.archives", "retention.preview", "events.list", "events.detail",
        "events.aggregate", "events.byUser", "overview.stats", "verify.run", "verify.event", "erasures.preview",
      ],
      handler: () => {
        let archived = 0
        let purged = 0
        let moreRemain = false
        for (const p of ownPolicies()) {
          const hit = sortEvents(eligibleEvents(p), "asc")
          const batch = hit.slice(0, ENFORCE_PER_POLICY)
          if (hit.length > ENFORCE_PER_POLICY) moreRemain = true
          if (batch.length === 0) continue
          const gone = new Set(batch.map((e) => e.id))
          events = events.filter((e) => !gone.has(e.id))
          purged += batch.length
          if (p.archive) {
            archived += batch.length
            archives.unshift({
              id: `archive_${counters.archive++}`, tenantId: p.tenantId, policyId: p.id, category: p.category, eventCount: batch.length,
              fromTimestamp: batch[0].ts, toTimestamp: batch[batch.length - 1].ts, sinkName: "s3",
              sinkRef: `s3://audit-archive/${p.tenantId || "app"}/${iso(NOW).slice(0, 10)}.jsonl.gz`, createdAt: NOW,
            })
          }
        }
        return { archived, purged, retained: 0, moreRemain, failed: false }
      },
    },

    "retention.archives": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = pageBounds(E, input ?? {}, 50, 1000)
        const v = viewer()
        const rows = archives.filter((a) => owns(v, APP_ID, a.tenantId)).sort((a, b) => b.createdAt - a.createdAt)
        const page = rows.slice(offset, offset + limit)
        return {
          archives: page.map((a) => ({
            id: a.id, policyId: a.policyId, category: a.category, eventCount: a.eventCount,
            fromTimestamp: iso(a.fromTimestamp), toTimestamp: iso(a.toTimestamp), sinkName: a.sinkName,
            ...(a.sinkRef ? { sinkRef: a.sinkRef } : {}), ...(a.tenantId ? { tenantId: a.tenantId } : {}), createdAt: iso(a.createdAt),
          })),
          hasMore: rows.length > offset + limit,
        }
      },
    },

    "reports.list": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = pageBounds(E, input ?? {}, 50, 1000)
        const rows = viewerReports()
        return { reports: rows.slice(offset, offset + limit).map(projectReportSummary), hasMore: rows.length > offset + limit }
      },
    },

    "reports.detail": { kind: "query", handler: (input) => projectReportDetail(findOwnedReport(input?.id)) },

    "reports.generate": {
      kind: "command",
      invalidates: ["reports.list"],
      handler: (input) => {
        const i = input ?? {}
        const types = { soc2: ["soc2", "SOC 2 report"], hipaa: ["hipaa", "HIPAA report"], euaiact: ["eu_ai_act", "EU AI Act report"] }
        if (!Object.hasOwn(types, i.type)) throw badRequest('type must be one of "soc2", "hipaa" or "euaiact"')
        const [stored, title] = types[i.type]
        const report = generate(stored, title, i, (rows) => {
          if (stored === "soc2") {
            return [
              makeSection("Logical access", rows.filter((e) => e.category === "auth")),
              makeSection("Change management", rows.filter((e) => e.category === "admin" || e.category === "data")),
            ]
          }
          if (stored === "hipaa") return [makeSection("Access to patient records", rows.filter((e) => e.category === "data"))]
          return [makeSection("Recorded activity", rows)]
        })
        return { id: report.id, report: projectReportSummary(report) }
      },
    },

    "reports.generateCustom": {
      kind: "command",
      invalidates: ["reports.list"],
      handler: (input) => {
        const i = input ?? {}
        const title = str(i.title)
        if (title.trim() === "") throw badRequest("title is required")
        if (runes(title) > 200) throw badRequest("title can be at most 200 characters")
        const sections = Array.isArray(i.sections) ? i.sections : []
        if (sections.length === 0) throw badRequest("at least one section is required")
        if (sections.length > 20) throw badRequest("a custom report can have at most 20 sections")
        sections.forEach((s, idx) => {
          const n = idx + 1
          if (str(s?.title).trim() === "") throw badRequest(`section ${n} needs a title`)
          if (runes(str(s.title)) > 200) throw badRequest(`the title of section ${n} can be at most 200 characters`)
          if (runes(str(s.notes)) > 4000) throw badRequest(`the notes of section ${n} can be at most 4000 characters`)
          for (const name of ["categories", "actions", "severity"]) {
            const values = list(s[name])
            if (values.length > 50) throw badRequest(`section ${n} can filter on at most 50 ${name}`)
            for (const value of values) {
              if (runes(value) > 128) throw badRequest(`a ${name} filter value in section ${n} can be at most 128 characters`)
            }
          }
        })
        const report = generate("custom", title, i, (rows) =>
          sections.map((s) => {
            const cats = list(s.categories)
            const acts = list(s.actions)
            const sev = list(s.severity)
            const matched = rows.filter(
              (e) => (cats.length === 0 || cats.includes(e.category)) && (acts.length === 0 || acts.includes(e.action)) && (sev.length === 0 || sev.includes(e.severity)),
            )
            return makeSection(s.title, matched, str(s.notes))
          }),
        )
        return { id: report.id, report: projectReportSummary(report) }
      },
    },

    "reports.export": {
      kind: "query",
      handler: (input) => {
        const i = input ?? {}
        if (!Object.hasOwn(EXPORT_FORMATS, i.format)) {
          throw badRequest('format must be one of "json", "csv", "markdown" or "html"')
        }
        const r = findOwnedReport(i.id)
        const [ext, contentType] = EXPORT_FORMATS[i.format]
        return { filename: `report-${r.id}.${ext}`, contentType, content: exportContent(r, i.format) }
      },
    },

    "settings.detail": {
      kind: "query",
      handler: () => ({
        batchSize: 100,
        flushInterval: "1s",
        retentionInterval: "24h0m0s",
        enableCryptoErasure: !env().noErasure,
        digestScheme: "chronicle/v5",
        keyed: true,
        checkpointingConfigured: !env().noCheckpoints,
        backendName: "sqlite",
        backendHoldsCheckpoints: true,
      }),
    },
  }
}
