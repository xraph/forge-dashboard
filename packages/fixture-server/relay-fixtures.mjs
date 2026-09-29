// relay-fixtures.mjs: relay's delivery log, events, event types, dead letter
// queue, overview and settings. Mirrors relay/extension/contract; field names
// are the Go JSON tags.
//
// The endpoint intents live in server.mjs, and this module takes what it needs
// from there by injection (the endpoint list, FixtureError), so it imports
// nothing back from server.mjs.
//
// It models what a real backend does, not what the in-memory store does,
// because the two differ in the places the pages care about most:
//   - a replay marks the DLQ row and keeps it, creates a pending delivery, and
//     refuses a second replay of the same row with CONFLICT;
//   - lists order by (time, id) descending and page with an opaque cursor,
//     and a cursor this fixture did not issue is BAD_REQUEST;
//   - an idempotency key used twice stores nothing the second time.
//
// The seed is built for the pages to have something true to show: a log that
// is mostly delivered, one delivery mid-retry, one that gave up after five
// attempts on a real backoff schedule, one whose receiver answered 410 and
// had its endpoint disabled, one 4xx that was never retried, and a DLQ with
// one entry already replayed.

const MAX_ATTEMPTS = 5
const RETRY_SCHEDULE_MS = [5_000, 30_000, 120_000, 900_000, 3_600_000]

// Rows verify.mjs and the page tests address by id. Everything else gets a
// generated id.
export const RELAY_IDS = {
  gaveUpEvent: "evt_01hq2k3m4n5p6q7r8s9t0ve001",
  gaveUpDelivery: "del_01hq2k3m4n5p6q7r8s9t0vd001",
  retryingDelivery: "del_01hq2k3m4n5p6q7r8s9t0vd002",
  gaveUpDLQ: "dlq_01hq2k3m4n5p6q7r8s9t0vq001",
  clientErrorDLQ: "dlq_01hq2k3m4n5p6q7r8s9t0vq002",
  replayedDLQ: "dlq_01hq2k3m4n5p6q7r8s9t0vq003",
}

const CONFLICT = "CONFLICT"
const BAD_REQUEST = "BAD_REQUEST"
const NOT_FOUND = "NOT_FOUND"

// Crockford base32, 26 characters: the shape of a TypeID suffix.
const B32 = "0123456789abcdefghjkmnpqrstvwxyz"
let seq = 0
function newId(prefix) {
  seq += 1
  let n = BigInt(Date.now()) * 100000n + BigInt(seq)
  let s = ""
  for (let i = 0; i < 26; i++) {
    s = B32[Number(n % 32n)] + s
    n /= 32n
  }
  return `${prefix}_0${s.slice(1)}`
}

function iso(ms) {
  return new Date(ms).toISOString()
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const INVOICE_SCHEMA = {
  type: "object",
  required: ["invoiceId", "amount", "currency"],
  properties: {
    invoiceId: { type: "string" },
    amount: { type: "integer", minimum: 0 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
  },
}

function seed(endpoints) {
  const now = Date.now()
  const min = 60_000
  const hour = 60 * min
  const byTenant = (t) => endpoints().filter((e) => e.tenantId === t)
  const PROD = "ep_01hq2k3m4n5p6q7r8s9t0v1w2x"

  const eventTypes = [
    { name: "invoice.paid", description: "An invoice was paid in full.", group: "billing", version: "2", schemaVersion: "2020-12",
      schema: INVOICE_SCHEMA, example: { invoiceId: "inv_1042", amount: 4200, currency: "USD" } },
    { name: "invoice.created", description: "A draft invoice was finalised.", group: "billing", version: "1", schemaVersion: "",
      schema: null, example: { invoiceId: "inv_1043" } },
    { name: "customer.created", description: "A customer account was opened.", group: "customers", version: "1", schemaVersion: "",
      schema: null, example: { customerId: "cus_88" } },
    { name: "deployment.completed", description: "A deployment finished rolling out.", group: "platform", version: "1", schemaVersion: "",
      schema: null, example: { service: "api", sha: "4f2c9e1" } },
    { name: "legacy.ping", description: "Heartbeat from the v1 integration.", group: "platform", version: "1", schemaVersion: "",
      schema: null, example: {}, deprecatedAt: iso(now - 14 * 24 * hour) },
  ].map((d, i) => ({
    id: newId("evtype"),
    ...d,
    deprecated: Boolean(d.deprecatedAt),
    metadata: {},
    createdAt: iso(now - (30 - i) * 24 * hour),
    updatedAt: iso(now - (30 - i) * 24 * hour),
  }))

  const events = []
  const deliveries = []
  const attempts = new Map() // deliveryId -> attempt[]
  const dlq = []

  // One event, fanned out to its tenant's matching endpoints (whether or not
  // they are enabled now: these are history), then shaped by `story`.
  function history(type, tenantId, agoMs, data, story, ids = {}) {
    const createdAt = now - agoMs
    const evt = { id: ids.event ?? newId("evt"), type, tenantId, data, idempotencyKey: "", scopeAppId: "", scopeOrgId: "", createdAt: iso(createdAt) }
    events.push(evt)
    for (const ep of byTenant(tenantId).filter((e) => e.eventTypes.some((p) => globMatches(p, type)))) {
      const d = {
        id: ids.delivery && ep.id === ids.deliveryEndpoint ? ids.delivery : newId("del"), eventId: evt.id, endpointId: ep.id, eventType: type, tenantId,
        state: "delivered", attemptCount: 0, maxAttempts: MAX_ATTEMPTS, nextAttemptAt: iso(createdAt),
        lastStatusCode: 0, lastError: "", lastResponse: "", lastLatencyMs: 0, completedAt: null,
        createdAt: iso(createdAt), updatedAt: iso(createdAt),
      }
      deliveries.push(d)
      // A story shapes the one delivery it is about. The event's other
      // deliveries simply succeeded.
      if (ids.deliveryEndpoint && ep.id !== ids.deliveryEndpoint) ok(d, ep, createdAt)
      else story(d, ep, createdAt)
    }
  }

  function attempt(d, at, statusCode, outcome, extra = {}) {
    const list = attempts.get(d.id) ?? []
    const n = list.length + 1
    const next = outcome === "retry" ? at + RETRY_SCHEDULE_MS[Math.min(n - 1, RETRY_SCHEDULE_MS.length - 1)] : null
    const a = {
      id: newId("att"), attemptNum: n, statusCode, error: extra.error ?? "", response: extra.response ?? "",
      latencyMs: extra.latencyMs ?? 120 + ((n * 37) % 200), outcome, nextAttemptAt: next === null ? null : iso(next),
      attemptedAt: iso(at),
    }
    list.push(a)
    attempts.set(d.id, list)
    d.attemptCount = n
    d.lastStatusCode = statusCode
    d.lastError = a.error
    d.lastResponse = a.response
    d.lastLatencyMs = a.latencyMs
    d.updatedAt = iso(at)
    if (next !== null) d.nextAttemptAt = iso(next)
    return next ?? at
  }

  const ok = (d, _ep, at) => {
    attempt(d, at + 300, 200, "delivered", { response: '{"received":true}' })
    d.state = "delivered"
    d.completedAt = d.updatedAt
  }

  function toDLQ(d, ep, failedAt, id) {
    dlq.push({
      id: id ?? newId("dlq"), deliveryId: d.id, eventId: d.eventId, endpointId: d.endpointId, eventType: d.eventType,
      tenantId: d.tenantId, url: ep.url, error: d.lastError || `HTTP ${d.lastStatusCode}`, attemptCount: d.attemptCount,
      lastStatusCode: d.lastStatusCode, replayedAt: null, failedAt: iso(failedAt),
      payload: events.find((e) => e.id === d.eventId)?.data ?? null,
    })
  }

  // The healthy bulk of the log.
  for (let i = 0; i < 18; i++) {
    const type = ["invoice.paid", "invoice.created", "customer.created"][i % 3]
    history(type, "acme", (i + 1) * 23 * min, type === "invoice.paid"
      ? { invoiceId: `inv_${1000 + i}`, amount: 1000 + i * 250, currency: "USD" }
      : { id: `${type.split(".")[0]}_${i}` }, ok)
  }
  history("deployment.completed", "globex", 40 * min, { service: "api", sha: "4f2c9e1" }, ok)
  history("deployment.completed", "globex", 3 * hour, { service: "worker", sha: "a91b007" }, ok)

  // Mid-retry: two failures, the next attempt still ahead.
  history("invoice.paid", "acme", 4 * min, { invoiceId: "inv_2001", amount: 9900, currency: "USD" }, (d, _ep, at) => {
    let t = attempt(d, at + 200, 503, "retry", { response: "upstream unavailable" })
    attempt(d, t + 400, 0, "retry", { error: "dial tcp 203.0.113.9:443: i/o timeout", latencyMs: 10_000 })
    d.state = "pending"
  }, { delivery: RELAY_IDS.retryingDelivery, deliveryEndpoint: PROD })

  // Queued: nothing attempted yet.
  history("customer.created", "acme", 20_000, { id: "customer_new" }, (d) => {
    d.state = "pending"
  }, { deliveryEndpoint: PROD })

  // Gave up after five attempts on the backoff schedule.
  history("invoice.paid", "acme", 5 * hour, { invoiceId: "inv_1777", amount: 1250, currency: "USD" }, (d, ep, at) => {
    let t = at + 150
    const tries = [
      [500, "", "internal error"],
      [502, "", "bad gateway"],
      [503, "", "upstream unavailable"],
      [0, "context deadline exceeded (Client.Timeout exceeded while awaiting headers)", ""],
    ]
    for (const [code, error, response] of tries) {
      t = attempt(d, t, code, "retry", { error, response, latencyMs: code === 0 ? 10_000 : 180 })
    }
    attempt(d, t, 500, "dlq", { response: '{"error":"database is locked"}' })
    d.state = "failed"
    d.completedAt = d.updatedAt
    toDLQ(d, ep, Date.parse(d.updatedAt), RELAY_IDS.gaveUpDLQ)
  }, { event: RELAY_IDS.gaveUpEvent, delivery: RELAY_IDS.gaveUpDelivery, deliveryEndpoint: PROD })

  // A client error: not retried.
  history("invoice.created", "acme", 2 * hour, { invoiceId: "inv_1500" }, (d, ep, at) => {
    attempt(d, at + 90, 422, "dlq", { response: '{"error":"unknown field invoiceId"}' })
    d.state = "failed"
    d.completedAt = d.updatedAt
    toDLQ(d, ep, Date.parse(d.updatedAt), RELAY_IDS.clientErrorDLQ)
  }, { deliveryEndpoint: PROD })

  // The receiver is gone: 410 disabled the endpoint (the staging one, which
  // the endpoint seed has disabled). Its DLQ entry was later replayed.
  const stagingId = "ep_01hq2k3m4n5p6q7r8s9t0v1w2y"
  history("customer.created", "acme", 26 * hour, { id: "customer_old" }, (d, ep, at) => {
    attempt(d, at + 80, 410, "endpoint_disabled", { response: "Gone" })
    d.state = "failed"
    d.completedAt = d.updatedAt
    toDLQ(d, ep, Date.parse(d.updatedAt), RELAY_IDS.replayedDLQ)
    dlq[dlq.length - 1].replayedAt = iso(at + 2 * hour)
  }, { deliveryEndpoint: stagingId })

  return { eventTypes, events, deliveries, attempts, dlq }
}

function globMatches(pattern, type) {
  if (pattern === "*" || pattern === type) return true
  const p = pattern.split(".")
  const t = type.split(".")
  return p.length === t.length && p.every((seg, i) => seg === "*" || seg === t[i])
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

function encodeCursor(time, id) {
  return Buffer.from(`${Date.parse(time)}|${id}`).toString("base64url")
}

function decodeCursor(raw, Err) {
  const text = Buffer.from(String(raw), "base64url").toString()
  const [ms, id] = text.split("|")
  if (!id || !/^\d+$/.test(ms ?? "")) throw new Err(400, BAD_REQUEST, "invalid cursor")
  return { ms: Number(ms), id }
}

/** rows newest first by timeKey then id, filtered, one page after the cursor. */
function page(rows, timeKey, input, Err) {
  const limit = Math.min(Math.max(Number(input?.limit) || 50, 1), 200)
  const pos = input?.cursor ? decodeCursor(input.cursor, Err) : null
  const sorted = [...rows].sort((a, b) => {
    const d = Date.parse(b[timeKey]) - Date.parse(a[timeKey])
    return d !== 0 ? d : b.id < a.id ? -1 : b.id > a.id ? 1 : 0
  })
  const after = pos
    ? sorted.filter((r) => {
        const t = Date.parse(r[timeKey])
        return t < pos.ms || (t === pos.ms && r.id < pos.id)
      })
    : sorted
  const items = after.slice(0, limit)
  const nextCursor = after.length > limit ? encodeCursor(items[limit - 1][timeKey], items[limit - 1].id) : undefined
  return { items, nextCursor }
}

function inWindow(time, from, to) {
  const t = Date.parse(time)
  if (from && t < Date.parse(from)) return false
  if (to && t > Date.parse(to)) return false
  return true
}

const STATUS_CLASSES = { "2xx": [200, 299], "4xx": [400, 499], "5xx": [500, 599], none: [0, 0] }

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {() => object[]} deps.endpoints  the endpoint rows server.mjs owns
 * @param {typeof Error} deps.FixtureError server.mjs's error class
 */
export function createRelayFixtures({ endpoints, FixtureError: Err }) {
  let state = seed(endpoints)

  const field = (f, message) => new Err(400, BAD_REQUEST, message, { field: f })
  const find = (rows, rawId, prefix, what) => {
    const id = typeof rawId === "string" ? rawId.trim() : ""
    if (!id) throw new Err(400, BAD_REQUEST, `${what} id is required`)
    if (!id.startsWith(`${prefix}_`)) throw new Err(400, BAD_REQUEST, `malformed ${what} id`)
    const row = rows.find((r) => r.id === id)
    if (!row) throw new Err(404, NOT_FOUND, `${what} not found`)
    return row
  }
  const endpointURL = (id) => endpoints().find((e) => e.id === id)?.url ?? ""
  const deliverySummary = (d) => {
    const { lastResponse: _drop, ...rest } = d
    return { ...rest, endpointUrl: endpointURL(d.endpointId) }
  }
  const eventSummary = ({ data: _d, scopeAppId: _a, scopeOrgId: _o, ...rest }) => rest
  const typeSummary = ({ schema, example: _e, metadata: _m, ...rest }) => ({ ...rest, hasSchema: Boolean(schema) })
  const dlqSummary = ({ payload: _p, ...rest }) => rest
  const window = (input) => {
    if (!input?.from || !input?.to) throw new Err(400, BAD_REQUEST, "a bulk replay needs both ends of the window")
    if (Date.parse(input.to) < Date.parse(input.from)) throw new Err(400, BAD_REQUEST, "the window ends before it starts")
    return state.dlq.filter((e) => inWindow(e.failedAt, input.from, input.to))
  }

  function enqueue(evt, endpointId, eventType, tenantId) {
    const at = new Date().toISOString()
    const d = {
      id: newId("del"), eventId: evt, endpointId, eventType, tenantId, state: "pending", attemptCount: 0,
      maxAttempts: MAX_ATTEMPTS, nextAttemptAt: at, lastStatusCode: 0, lastError: "", lastResponse: "",
      lastLatencyMs: 0, completedAt: null, createdAt: at, updatedAt: at,
    }
    state.deliveries.push(d)
    return d
  }

  function replay(entry) {
    if (entry.replayedAt) throw new Err(409, CONFLICT, "this entry has already been replayed")
    entry.replayedAt = new Date().toISOString()
    enqueue(entry.eventId, entry.endpointId, entry.eventType, entry.tenantId)
  }

  const handlers = {
    "deliveries.list": {
      kind: "query",
      handler: (p) => {
        if (p?.statusClass && !STATUS_CLASSES[p.statusClass]) {
          throw new Err(400, BAD_REQUEST, `relay: invalid filter: status class "${p.statusClass}"`)
        }
        const [lo, hi] = STATUS_CLASSES[p?.statusClass] ?? [-1, 1e9]
        const rows = state.deliveries.filter(
          (d) =>
            (!p?.state || d.state === p.state) &&
            (!p?.endpointId || d.endpointId === p.endpointId) &&
            (!p?.eventId || d.eventId === p.eventId) &&
            (!p?.eventType || d.eventType === p.eventType) &&
            (!p?.tenantId || d.tenantId === p.tenantId) &&
            d.lastStatusCode >= lo && d.lastStatusCode <= hi &&
            inWindow(d.createdAt, p?.from, p?.to)
        )
        const { items, nextCursor } = page(rows, "createdAt", p, Err)
        return { deliveries: items.map(deliverySummary), ...(nextCursor ? { nextCursor } : {}), complete: true }
      },
    },
    "deliveries.detail": {
      kind: "query",
      handler: (p) => {
        const d = find(state.deliveries, p?.id, "del", "delivery")
        const ep = endpoints().find((e) => e.id === d.endpointId)
        return {
          ...deliverySummary(d),
          lastResponse: d.lastResponse,
          ...(ep ? { endpointEnabled: ep.enabled } : {}),
          attempts: state.attempts.get(d.id) ?? [],
        }
      },
    },

    "events.list": {
      kind: "query",
      handler: (p) => {
        const rows = state.events.filter(
          (e) => (!p?.type || e.type === p.type) && (!p?.tenantId || e.tenantId === p.tenantId) && inWindow(e.createdAt, p?.from, p?.to)
        )
        const { items, nextCursor } = page(rows, "createdAt", p, Err)
        return { events: items.map(eventSummary), ...(nextCursor ? { nextCursor } : {}), complete: true }
      },
    },
    "events.detail": {
      kind: "query",
      handler: (p) => {
        const e = find(state.events, p?.id, "evt", "event")
        return {
          ...e,
          deliveries: state.deliveries
            .filter((d) => d.eventId === e.id)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .map(deliverySummary),
        }
      },
    },
    "events.send": {
      kind: "command",
      invalidates: ["events.list", "deliveries.list", "overview.stats"],
      handler: (p) => {
        if (!p?.type?.trim()) throw field("type", "Event type: required")
        if (!p?.tenantId?.trim()) throw field("tenant_id", "Tenant ID: required")
        const et = state.eventTypes.find((t) => t.name === p.type)
        if (!et) throw field("type", "Event type: not registered")
        if (et.deprecated) throw new Err(400, BAD_REQUEST, "relay: event type is deprecated")
        const data = p.data ?? null
        for (const req of et.schema?.required ?? []) {
          if (data === null || typeof data !== "object" || !(req in data)) {
            throw new Err(400, BAD_REQUEST, `relay: payload validation failed: missing property '${req}'`)
          }
        }
        const key = p.idempotencyKey ?? ""
        if (key && state.events.some((e) => e.idempotencyKey === key)) return { ok: true, duplicate: true }
        const evt = { id: newId("evt"), type: p.type, tenantId: p.tenantId, data, idempotencyKey: key,
          scopeAppId: "", scopeOrgId: "", createdAt: new Date().toISOString() }
        state.events.push(evt)
        for (const ep of endpoints()) {
          if (ep.enabled && ep.tenantId === evt.tenantId && ep.eventTypes.some((pt) => globMatches(pt, evt.type))) {
            enqueue(evt.id, ep.id, evt.type, evt.tenantId)
          }
        }
        return { ok: true, id: evt.id }
      },
    },

    "eventTypes.list": {
      kind: "query",
      handler: (p) => ({
        types: state.eventTypes
          .filter((t) => (p?.includeDeprecated || !t.deprecated) && (!p?.group || t.group === p.group))
          .map(typeSummary),
      }),
    },
    "eventTypes.detail": {
      kind: "query",
      handler: (p) => {
        const t = state.eventTypes.find((x) => x.name === p?.name)
        if (!p?.name) throw new Err(400, BAD_REQUEST, "event type name is required")
        if (!t) throw new Err(404, NOT_FOUND, "event type not found")
        return { ...typeSummary(t), ...(t.schema ? { schema: t.schema } : {}), ...(t.example ? { example: t.example } : {}), metadata: t.metadata }
      },
    },
    "eventTypes.match": {
      kind: "query",
      handler: (p) => ({
        types: p?.pattern?.trim() ? state.eventTypes.filter((t) => globMatches(p.pattern, t.name)).map(typeSummary) : [],
      }),
    },
    "eventTypes.register": {
      kind: "command",
      invalidates: ["eventTypes.list", "eventTypes.detail", "overview.stats"],
      handler: (p) => {
        if (!p?.name?.trim()) throw field("name", "Name: required")
        if (p.schema !== undefined && (p.schema === null || typeof p.schema !== "object" || Array.isArray(p.schema))) {
          throw field("schema", "Schema: must be a JSON object")
        }
        const now = new Date().toISOString()
        let t = state.eventTypes.find((x) => x.name === p.name)
        if (!t) {
          t = { id: newId("evtype"), name: p.name, deprecated: false, metadata: {}, createdAt: now }
          state.eventTypes.push(t)
        }
        Object.assign(t, {
          description: p.description ?? "", group: p.group ?? "", version: p.version ?? "",
          schemaVersion: p.schemaVersion ?? "", schema: p.schema ?? null, example: p.example ?? null, updatedAt: now,
        })
        return { ok: true, id: t.id }
      },
    },
    "eventTypes.deprecate": {
      kind: "command",
      invalidates: ["eventTypes.list", "eventTypes.detail", "overview.stats"],
      handler: (p) => {
        const t = state.eventTypes.find((x) => x.name === p?.name)
        if (!t) throw new Err(404, NOT_FOUND, "event type not found")
        t.deprecated = true
        t.deprecatedAt = new Date().toISOString()
        t.updatedAt = t.deprecatedAt
        return { ok: true }
      },
    },

    "dlq.list": {
      kind: "query",
      handler: (p) => {
        const rows = state.dlq.filter(
          (e) =>
            (!p?.tenantId || e.tenantId === p.tenantId) &&
            (!p?.endpointId || e.endpointId === p.endpointId) &&
            (typeof p?.replayed !== "boolean" || Boolean(e.replayedAt) === p.replayed) &&
            inWindow(e.failedAt, p?.from, p?.to)
        )
        const { items, nextCursor } = page(rows, "failedAt", p, Err)
        return { entries: items.map(dlqSummary), ...(nextCursor ? { nextCursor } : {}), complete: true }
      },
    },
    "dlq.detail": {
      kind: "query",
      handler: (p) => ({ ...find(state.dlq, p?.id, "dlq", "dead letter") }),
    },
    "dlq.bulkPreview": {
      kind: "query",
      handler: (p) => {
        const rows = window(p)
        return { replayable: rows.filter((e) => !e.replayedAt).length, alreadyReplayed: rows.filter((e) => e.replayedAt).length }
      },
    },
    "dlq.replay": {
      kind: "command",
      invalidates: ["dlq.list", "dlq.detail", "dlq.bulkPreview", "deliveries.list", "overview.stats"],
      handler: (p) => {
        const entry = find(state.dlq, p?.id, "dlq", "dead letter")
        replay(entry)
        return { ok: true, id: entry.id }
      },
    },
    "dlq.replayBulk": {
      kind: "command",
      invalidates: ["dlq.list", "dlq.detail", "dlq.bulkPreview", "deliveries.list", "overview.stats"],
      handler: (p) => {
        let replayed = 0
        for (const e of window(p)) {
          if (e.replayedAt) continue
          replay(e)
          replayed += 1
        }
        return { replayed }
      },
    },
    "dlq.purge": {
      kind: "command",
      invalidates: ["dlq.list", "dlq.detail", "dlq.bulkPreview", "overview.stats"],
      handler: (p) => {
        if (!p?.before) throw new Err(400, BAD_REQUEST, "purge needs a cutoff")
        const before = Date.parse(p.before)
        const kept = state.dlq.filter((e) => Date.parse(e.failedAt) >= before)
        const purged = state.dlq.length - kept.length
        state.dlq = kept
        return { purged }
      },
    },

    "overview.stats": {
      kind: "query",
      handler: () => ({
        eventTypes: state.eventTypes.filter((t) => !t.deprecated).length,
        endpoints: endpoints().length,
        pending: state.deliveries.filter((d) => d.state === "pending").length,
        deadLetters: state.dlq.length,
      }),
    },
    "settings.config": {
      kind: "query",
      handler: () => ({
        concurrency: 10, batchSize: 50, maxRetries: MAX_ATTEMPTS, pollIntervalMs: 1000, maxPollIntervalMs: 30000,
        requestTimeoutMs: 10000, shutdownTimeoutMs: 30000, cacheTtlMs: 300000, retryScheduleMs: RETRY_SCHEDULE_MS,
      }),
    },
  }

  return {
    handlers,
    reset() {
      state = seed(endpoints)
    },
  }
}
