// tether-fixtures.mjs: in-memory state and intent handlers for the tether
// contributor (packages/plugin-tether), kept out of server.mjs like
// keysmith-fixtures.mjs.
//
// Mirrors forgery/tether/extension/contract (types.go, errors.go,
// handlers_*.go, manifest.yaml and llm.txt). Field names are the Go JSON tags.
// All 24 intents are here: 10 queries and 14 commands. Every write changes the
// state the next read answers from.
//
// The module is self-contained. The one thing it needs from server.mjs is the
// FixtureError class (see keysmith-fixtures.mjs for why), so server.mjs hands
// its class to createTetherHandlers.
//
// The fixture's own stand-ins:
//   - There is no principal, so the contract's UNAUTHENTICATED admission check
//     is not modelled: every request is a signed-in user. By default that user
//     is an operator (WithDashboardOperators): any tenant, and tenants.create,
//     update and delete. FIXTURE_TETHER_SESSION=tenant makes it a tenant user
//     of the seeded acme tenant instead, scoped the way the Go gate scopes
//     one: an omitted tenantId is acme, another tenant is PERMISSION_DENIED,
//     tenants.list holds acme alone, tenant management is refused, and
//     overview.stats without a tenantId is acme's counters.
//   - There is no broker. Clients and retained messages are rows in the state;
//     stats count them. messagesIn and messagesOut are seeded and do not move.
//     FIXTURE_TETHER_BROKER_DOWN=1 stands in for a broker that is not running,
//     so overview.stats, clients.*, sessions.delete and retained.* answer
//     UNAVAILABLE as the Go handlers do.
//   - devices.provision and devices.rotate are registered `secret`, as tether
//     registers them with SecretResponse: a repeat under one idempotency key
//     answers CONFLICT and makes nothing. The password is never kept; the state
//     holds only the key ID.
//   - clients.kick follows the broker: a connected client with a session expiry
//     above 0 stays as an offline session, one with 0 (a clean session) is gone.
//     The seeded connected client is a clean 3.1.1 session, so kicking it
//     removes it from the next read. sessions.delete removes either.
//   - Times in the seed are relative to module load, and resetTether()
//     recomputes them.

import { randomBytes } from "node:crypto"

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 500
// 10 years in seconds, the cap on every duration the contract takes.
const MAX_SECONDS = 10 * 365 * 24 * 3600

// A TypeID suffix's alphabet: lowercase Crockford base32.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
const TYPEID_SUFFIX = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/

const SLUG = /^[a-z0-9_-]{1,63}$/

function typeId(prefix) {
  const bytes = randomBytes(25)
  let suffix = CROCKFORD[bytes[0] & 7]
  for (let i = 1; i < 26; i++) suffix += CROCKFORD[bytes[i - 1] & 31]
  return `${prefix}_${suffix}`
}

function parseTypeId(raw, prefix) {
  if (typeof raw !== "string" || !raw.startsWith(`${prefix}_`)) return false
  return TYPEID_SUFFIX.test(raw.slice(prefix.length + 1))
}

/** RFC3339 in UTC without fractional seconds, like the Go projection. */
function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
}

export const TETHER_IDS = {
  acme: "ttnt_01j9m4k2e7t8x3q5r6v0w1y2za",
  globex: "ttnt_01j9m4k2e8f9d4n6s7w1x2z3ab",
  boiler: "tdev_01j9m4k3a7t8x3q5r6v0w1y2za",
  gateway: "tdev_01j9m4k3a8f9d4n6s7w1x2z3ab",
  thermostat: "tdev_01j9m4k3a9g0e5p7t8x2y3a4bc",
  globexSensor: "tdev_01j9m4k3aah1f6q8v9y3z4b5cd",
}

// ---------------------------------------------------------------------------
// Topic filters (topic.Valid, with the grant rule that a shared filter is not
// a grant: acl drops it, and perm refuses to store one).
// ---------------------------------------------------------------------------

const isShare = (level) => level.toLowerCase() === "$share"

/** What is wrong with a topic filter, or null. */
function filterProblem(filter) {
  if (filter === "") return "topic empty"
  if (filter.includes("\0")) return "topic contains NUL"
  const levels = filter.split("/")
  if (isShare(levels[0])) return "topic filter is a shared filter, which cannot be granted"
  for (const [i, level] of levels.entries()) {
    if (level.includes("#")) {
      if (level !== "#") return "topic # must occupy a whole level"
      if (i < levels.length - 1) return "topic # must be the last level"
    } else if (level.includes("+") && level !== "+") {
      return "topic + must occupy a whole level"
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function seedTetherState() {
  const now = Date.now()
  const hour = 3600_000
  const day = 24 * hour

  const tenants = new Map()
  const addTenant = (t) => tenants.set(t.id, { ...t, updatedAt: t.updatedAt ?? t.createdAt })

  addTenant({
    id: TETHER_IDS.acme,
    appId: "app_fleet",
    externalId: "acme",
    name: "Acme Fleet",
    enabled: true,
    limits: { maxConnections: 500, messagesPerSecond: 200, burst: 400, maxSessionExpirySeconds: 86_400 },
    createdAt: now - 60 * day,
    updatedAt: now - 5 * day,
  })
  addTenant({
    id: TETHER_IDS.globex,
    appId: "app_fleet",
    externalId: "globex",
    name: "Globex Metering",
    enabled: true,
    limits: { maxConnections: 0, messagesPerSecond: 0, burst: 0, maxSessionExpirySeconds: 0 },
    createdAt: now - 20 * day,
  })

  const devices = new Map()
  const addDevice = (d) => devices.set(d.id, { revoked: false, metadata: undefined, ...d, updatedAt: d.updatedAt ?? d.createdAt })

  addDevice({
    id: TETHER_IDS.boiler,
    tenantId: TETHER_IDS.acme,
    name: "Boiler room sensor",
    keyId: "akey_01j9m4k4a7t8x3q5r6v0w1y2za",
    clientId: "boiler-01",
    roles: ["sensor"],
    metadata: { tether_device_id: TETHER_IDS.boiler },
    createdAt: now - 40 * day,
  })
  addDevice({
    id: TETHER_IDS.gateway,
    tenantId: TETHER_IDS.acme,
    name: "North gateway",
    keyId: "akey_01j9m4k4a8f9d4n6s7w1x2z3ab",
    roles: ["gateway"],
    metadata: { tether_device_id: TETHER_IDS.gateway },
    createdAt: now - 30 * day,
  })
  addDevice({
    id: TETHER_IDS.thermostat,
    tenantId: TETHER_IDS.acme,
    name: "Old thermostat",
    keyId: "akey_01j9m4k4a9g0e5p7t8x2y3a4bc",
    clientId: "thermostat-07",
    roles: [],
    metadata: { tether_device_id: TETHER_IDS.thermostat },
    createdAt: now - 50 * day,
    revoked: true,
  })
  addDevice({
    id: TETHER_IDS.globexSensor,
    tenantId: TETHER_IDS.globex,
    name: "Meter 17",
    keyId: "akey_01j9m4k4aah1f6q8v9y3z4b5cd",
    roles: [],
    metadata: { tether_device_id: TETHER_IDS.globexSensor },
    createdAt: now - 10 * day,
  })

  // Per tenant, keyed by slug.
  const roles = new Map([
    [
      TETHER_IDS.acme,
      [
        { slug: "sensor", name: "Sensor", publish: ["devices/%c/telemetry"], subscribe: ["devices/%c/cmd/#"] },
        {
          slug: "gateway",
          name: "Gateway",
          parentSlug: "sensor",
          publish: ["gateways/%u/#"],
          subscribe: ["gateways/%u/#", "broadcast/+"],
        },
        { slug: "viewer", name: "Viewer", publish: [], subscribe: ["devices/+/telemetry"] },
      ],
    ],
    [TETHER_IDS.globex, [{ slug: "meter", name: "Meter", publish: ["meters/%c/reading"], subscribe: [] }]],
  ])

  const clients = new Map([
    [
      TETHER_IDS.acme,
      [
        {
          clientId: "boiler-01",
          username: "akey_01j9m4k4a7t8x3q5r6v0w1y2za",
          deviceId: TETHER_IDS.boiler,
          remote: "10.4.0.12:51822",
          connected: true,
          protocolVersion: 4,
          subscriptions: ["devices/boiler-01/cmd/#"],
          connectedAt: now - 3 * hour,
          sessionExpirySeconds: 0,
        },
        {
          clientId: "gateway-north",
          username: "akey_01j9m4k4a8f9d4n6s7w1x2z3ab",
          deviceId: TETHER_IDS.gateway,
          connected: false,
          protocolVersion: 5,
          subscriptions: ["gateways/akey_01j9m4k4a8f9d4n6s7w1x2z3ab/#", "broadcast/+"],
          sessionExpirySeconds: 86_400,
        },
      ],
    ],
    [TETHER_IDS.globex, []],
  ])

  const retained = new Map([
    [
      TETHER_IDS.acme,
      [
        { topic: "devices/boiler-01/status", size: 24, qos: 1 },
        { topic: "broadcast/firmware", size: 112, qos: 0 },
      ],
    ],
    [TETHER_IDS.globex, []],
  ])

  const traffic = new Map([
    [TETHER_IDS.acme, { messagesIn: 18_420, messagesOut: 9_310 }],
    [TETHER_IDS.globex, { messagesIn: 640, messagesOut: 12 }],
  ])

  return { tenants, devices, roles, clients, retained, traffic }
}

let tether = seedTetherState()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetTether() {
  tether = seedTetherState()
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function projectTenant(t) {
  return {
    id: t.id,
    appId: t.appId,
    externalId: t.externalId,
    name: t.name,
    enabled: t.enabled,
    limits: { ...t.limits },
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  }
}

function projectDevice(d) {
  const out = {
    id: d.id,
    tenantId: d.tenantId,
    name: d.name,
    keyId: d.keyId,
  }
  if (d.clientId) out.clientId = d.clientId
  out.roles = [...d.roles]
  if (d.metadata) out.metadata = { ...d.metadata }
  out.createdAt = iso(d.createdAt)
  out.updatedAt = iso(d.updatedAt)
  return out
}

function projectClient(c) {
  const out = { clientId: c.clientId }
  if (c.username) out.username = c.username
  if (c.deviceId) out.deviceId = c.deviceId
  if (c.remote) out.remote = c.remote
  out.connected = c.connected
  out.protocolVersion = c.protocolVersion
  out.subscriptions = [...c.subscriptions]
  if (c.connectedAt) out.connectedAt = iso(c.connectedAt)
  out.sessionExpirySeconds = c.sessionExpirySeconds
  return out
}

const projectRole = (r) => {
  const out = { slug: r.slug, name: r.name }
  if (r.parentSlug) out.parentSlug = r.parentSlug
  out.publish = [...r.publish]
  out.subscribe = [...r.subscribe]
  return out
}

const projectRules = (r) => ({ roleSlug: r.slug, publish: [...r.publish], subscribe: [...r.subscribe] })

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 *   server.mjs's own error class, so refusals carry their real status and code.
 */
export function createTetherHandlers(FixtureError) {
  const badRequest = (message) => new FixtureError(400, "BAD_REQUEST", message)
  const notFound = (message) => new FixtureError(404, "NOT_FOUND", message)
  const conflict = (message) => new FixtureError(409, "CONFLICT", message)

  const str = (raw) => (typeof raw === "string" ? raw : "")
  const brokerDown = () => process.env.FIXTURE_TETHER_BROKER_DOWN === "1"
  const requireBroker = () => {
    if (brokerDown()) throw new FixtureError(503, "UNAVAILABLE", "the broker is not running")
  }

  const denied = (message) => new FixtureError(403, "PERMISSION_DENIED", message)

  /** The caller's own tenant, or null for an operator (caller.go's gate). */
  const sessionTenant = () => (process.env.FIXTURE_TETHER_SESSION === "tenant" ? TETHER_IDS.acme : null)

  /** operatorOnly: tenant management is refused to a tenant user. */
  function requireOperator() {
    if (sessionTenant() !== null) throw denied("managing tenants is for operators")
  }

  /**
   * gate.tenantFor then tenantID (caller.go, errors.go): a malformed tenantId
   * is BAD_REQUEST; a tenant user gets their own tenant, and another one is
   * PERMISSION_DENIED; an operator with no tenantId is PERMISSION_DENIED.
   */
  function tenantIdOf(raw) {
    const given = raw !== undefined && raw !== null && raw !== ""
    if (given && !parseTypeId(raw, "ttnt")) throw badRequest("malformed tenantId")
    const own = sessionTenant()
    if (own === null) {
      if (!given) throw denied("tenantId is required")
      return raw
    }
    if (given && raw !== own) throw denied("that tenant is outside your scope")
    return own
  }

  /** loadTenant: an unknown tenant is NOT_FOUND. */
  function loadTenant(raw) {
    const id = tenantIdOf(raw)
    const t = tether.tenants.get(id)
    if (!t) throw notFound("tenant not found")
    return t
  }

  function deviceIdOf(raw) {
    if (raw === undefined || raw === null || raw === "") throw badRequest("deviceId is required")
    if (!parseTypeId(raw, "tdev")) throw badRequest("malformed deviceId")
    return raw
  }

  /** getDevice: a device of another tenant is NOT_FOUND, like an unknown one. */
  function loadDevice(rawTenant, rawDevice) {
    const t = loadTenant(rawTenant)
    const id = deviceIdOf(rawDevice)
    const d = tether.devices.get(id)
    if (!d || d.tenantId !== t.id) throw notFound("device not found")
    return { t, d }
  }

  function required(field, value) {
    if (typeof value !== "string" || value === "") throw badRequest(`${field} is required`)
    return value
  }

  /** page (errors.go). */
  function page(params) {
    const limit = Number.isFinite(params?.limit) ? Math.trunc(params.limit) : 0
    const offset = Number.isFinite(params?.offset) ? Math.trunc(params.offset) : 0
    if (limit < 0 || offset < 0) throw badRequest("limit and offset must not be negative")
    if (limit > MAX_PAGE_SIZE) throw badRequest(`limit must be at most ${MAX_PAGE_SIZE}`)
    return { limit: limit === 0 ? DEFAULT_PAGE_SIZE : limit, offset }
  }

  function seconds(name, n) {
    const v = n === undefined || n === null ? 0 : n
    if (!Number.isFinite(v) || v < 0 || v > MAX_SECONDS) {
      throw badRequest(`${name} must be between 0 and ${MAX_SECONDS}`)
    }
    return Math.trunc(v)
  }

  /** toLimits: negative limits are invalid; an absent field is 0. */
  function toLimits(raw) {
    const n = (v) => (v === undefined || v === null ? 0 : v)
    const l = {
      maxConnections: n(raw?.maxConnections),
      messagesPerSecond: n(raw?.messagesPerSecond),
      burst: n(raw?.burst),
      maxSessionExpirySeconds: n(raw?.maxSessionExpirySeconds),
    }
    for (const v of Object.values(l)) {
      if (typeof v !== "number" || !Number.isFinite(v)) throw badRequest("limits must be numbers")
    }
    if (l.maxConnections < 0 || l.messagesPerSecond < 0 || l.burst < 0) {
      throw badRequest("limits must not be negative")
    }
    l.maxSessionExpirySeconds = seconds("maxSessionExpirySeconds", l.maxSessionExpirySeconds)
    return l
  }

  const tenantRoles = (tenantId) => tether.roles.get(tenantId) ?? []
  const tenantClients = (tenantId) => tether.clients.get(tenantId) ?? []
  const tenantRetained = (tenantId) => tether.retained.get(tenantId) ?? []
  const tenantDevices = (tenantId) => [...tether.devices.values()].filter((d) => d.tenantId === tenantId)

  function loadRole(tenantId, rawSlug) {
    const slug = required("roleSlug", rawSlug)
    const role = tenantRoles(tenantId).find((r) => r.slug === slug)
    if (!role) throw notFound(`role "${slug}" not found`)
    return role
  }

  /** Two lists a grant may hold: every one a valid plain filter. */
  function checkGrants(field, list) {
    for (const filter of list) {
      if (typeof filter !== "string") throw badRequest(`${field} must be a list of strings`)
      const problem = filterProblem(filter)
      if (problem) throw badRequest(`${field} filter ${JSON.stringify(filter)}: ${problem}`)
    }
  }

  const stringList = (raw) => (Array.isArray(raw) ? raw : [])

  function counters(tenantId) {
    const cs = tenantClients(tenantId)
    const traffic = tether.traffic.get(tenantId) ?? { messagesIn: 0, messagesOut: 0 }
    return {
      connected: cs.filter((c) => c.connected).length,
      sessions: cs.length,
      subscriptions: cs.reduce((n, c) => n + c.subscriptions.length, 0),
      retained: tenantRetained(tenantId).length,
      messagesIn: traffic.messagesIn,
      messagesOut: traffic.messagesOut,
    }
  }

  /** A client of the tenant that is not there is NOT_FOUND. */
  function findClient(tenantId, clientId) {
    return tenantClients(tenantId).find((c) => c.clientId === clientId)
  }

  function dropClients(tenantId, keep) {
    tether.clients.set(tenantId, tenantClients(tenantId).filter(keep))
  }

  /** Revoke, delete and a disabled tenant end a device's live connections. */
  function endConnections(tenantId, match) {
    const next = []
    for (const c of tenantClients(tenantId)) {
      if (!match(c)) {
        next.push(c)
      } else if (c.sessionExpirySeconds > 0) {
        next.push({ ...c, connected: false, remote: undefined, connectedAt: undefined })
      }
    }
    tether.clients.set(tenantId, next)
  }

  function newPassword() {
    return `tdk_live_${randomBytes(18).toString("base64url")}`
  }

  const asCredentials = (d, password) => ({ device: projectDevice(d), username: d.keyId, password })

  const TENANT_INVALIDATES = ["tenants.list", "tenants.get", "clients.list", "overview.stats"]
  const DEVICE_INVALIDATES = ["devices.list", "devices.get"]
  const GONE_INVALIDATES = ["devices.list", "devices.get", "clients.list", "overview.stats"]
  const ROLE_INVALIDATES = ["roles.list", "roles.topics.get"]

  return {
    // ----- Queries -----

    "session.info": {
      kind: "query",
      handler: () => {
        const own = sessionTenant()
        return own === null ? { operator: true } : { operator: false, tenantId: own }
      },
    },

    "overview.stats": {
      kind: "query",
      handler: (params) => {
        requireBroker()
        const raw = params?.tenantId
        if ((raw !== undefined && raw !== null && raw !== "") || sessionTenant() !== null) {
          const t = loadTenant(raw)
          return { scope: "tenant", tenantId: t.id, ...counters(t.id) }
        }
        const total = { scope: "node", tenants: tether.tenants.size, connected: 0, sessions: 0, subscriptions: 0, retained: 0, messagesIn: 0, messagesOut: 0 }
        for (const id of tether.tenants.keys()) {
          const c = counters(id)
          for (const key of ["connected", "sessions", "subscriptions", "retained", "messagesIn", "messagesOut"]) total[key] += c[key]
        }
        return total
      },
    },

    "tenants.list": {
      kind: "query",
      handler: (params) => {
        const { limit, offset } = page(params)
        const own = sessionTenant()
        if (own !== null) {
          const t = tether.tenants.get(own)
          return { items: t && offset === 0 ? [projectTenant(t)] : [], limit, offset }
        }
        const all = [...tether.tenants.values()].sort((a, b) => a.createdAt - b.createdAt)
        return { items: all.slice(offset, offset + limit).map(projectTenant), limit, offset }
      },
    },

    "tenants.get": {
      kind: "query",
      handler: (params) => projectTenant(loadTenant(params?.tenantId)),
    },

    "devices.list": {
      kind: "query",
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        const { limit, offset } = page(params)
        const all = tenantDevices(t.id).sort((a, b) => a.createdAt - b.createdAt)
        return { items: all.slice(offset, offset + limit).map(projectDevice), limit, offset }
      },
    },

    "devices.get": {
      kind: "query",
      handler: (params) => projectDevice(loadDevice(params?.tenantId, params?.deviceId).d),
    },

    "roles.list": {
      kind: "query",
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        const sorted = [...tenantRoles(t.id)].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
        return { items: sorted.map(projectRole) }
      },
    },

    "roles.topics.get": {
      kind: "query",
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        return projectRules(loadRole(t.id, params?.roleSlug))
      },
    },

    "clients.list": {
      kind: "query",
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        requireBroker()
        const sorted = [...tenantClients(t.id)].sort((a, b) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0))
        return { items: sorted.map(projectClient) }
      },
    },

    "retained.list": {
      kind: "query",
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        requireBroker()
        const filter = str(params?.filter) || "#"
        const problem = filterProblem(filter)
        if (problem) throw badRequest(problem)
        const matches = (topic) => {
          const f = filter.split("/")
          const n = topic.split("/")
          for (let i = 0; i < f.length; i++) {
            if (f[i] === "#") return true
            if (i >= n.length) return false
            if (f[i] !== "+" && f[i] !== n[i]) return false
          }
          return f.length === n.length
        }
        const items = tenantRetained(t.id)
          .filter((r) => matches(r.topic))
          .sort((a, b) => (a.topic < b.topic ? -1 : 1))
          .map((r) => ({ ...r }))
        return { items }
      },
    },

    // ----- Commands -----

    "tenants.create": {
      kind: "command",
      invalidates: ["tenants.list", "overview.stats"],
      handler: (params) => {
        requireOperator()
        const appId = str(params?.appId).trim()
        if (appId === "") throw badRequest("app ID is required")
        const externalId = str(params?.externalId).trim()
        if (externalId === "") throw badRequest("external ID is required")
        const limits = toLimits(params?.limits)
        for (const other of tether.tenants.values()) {
          if (other.externalId === externalId) {
            throw conflict(`external ID "${externalId}" is already used by tenant ${other.id} under app "${other.appId}"`)
          }
        }
        const now = Date.now()
        const t = {
          id: typeId("ttnt"),
          appId,
          externalId,
          name: str(params?.name),
          enabled: true,
          limits,
          createdAt: now,
          updatedAt: now,
        }
        tether.tenants.set(t.id, t)
        tether.roles.set(t.id, [])
        tether.clients.set(t.id, [])
        tether.retained.set(t.id, [])
        tether.traffic.set(t.id, { messagesIn: 0, messagesOut: 0 })
        return projectTenant(t)
      },
    },

    "tenants.update": {
      kind: "command",
      invalidates: TENANT_INVALIDATES,
      handler: (params) => {
        requireOperator()
        const t = loadTenant(params?.tenantId)
        // Validate everything before changing anything.
        const limits = params?.limits === undefined || params?.limits === null ? null : toLimits(params.limits)
        if (params?.enabled !== undefined && params?.enabled !== null && typeof params.enabled !== "boolean") {
          throw badRequest("enabled must be a boolean")
        }
        if (params?.name !== undefined && params?.name !== null && typeof params.name !== "string") {
          throw badRequest("name must be a string")
        }
        if (typeof params?.name === "string") t.name = params.name
        if (typeof params?.enabled === "boolean") t.enabled = params.enabled
        if (limits) t.limits = limits
        t.updatedAt = Date.now()
        // A disabled tenant's live connections are dropped.
        if (!t.enabled) endConnections(t.id, (c) => c.connected)
        return projectTenant(t)
      },
    },

    "tenants.delete": {
      kind: "command",
      invalidates: TENANT_INVALIDATES,
      handler: (params) => {
        requireOperator()
        const t = loadTenant(params?.tenantId)
        const n = tenantDevices(t.id).length
        if (n > 0) throw conflict(`tenant ${t.id} still has ${n} devices`)
        tether.tenants.delete(t.id)
        tether.roles.delete(t.id)
        tether.clients.delete(t.id)
        tether.retained.delete(t.id)
        tether.traffic.delete(t.id)
        return { ok: true }
      },
    },

    // Answers a password, once. `secret` is the dispatcher's SecretResponse:
    // server.mjs keeps a tombstone for the idempotency key, not this answer.
    "devices.provision": {
      kind: "command",
      secret: true,
      invalidates: ["devices.list"],
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        const name = str(params?.name)
        if (name.trim() === "") throw badRequest("device name is required")
        const clientId = str(params?.clientId)
        if (/[/+#\0]/.test(clientId)) {
          throw badRequest("client ID must be one topic level without '/', '+', '#' or NUL")
        }
        const seen = new Set()
        const roles = []
        for (const slug of stringList(params?.roles)) {
          if (typeof slug !== "string" || slug === "") throw badRequest("role slug is empty")
          if (seen.has(slug)) continue
          seen.add(slug)
          roles.push(slug)
        }
        const known = new Set(tenantRoles(t.id).map((r) => r.slug))
        for (const slug of roles) {
          if (!known.has(slug)) throw badRequest(`role "${slug}" does not exist`)
        }
        if (params?.expiresAt !== undefined && params?.expiresAt !== null && Number.isNaN(Date.parse(params.expiresAt))) {
          throw badRequest("expiresAt must be an RFC 3339 time")
        }
        const now = Date.now()
        const id = typeId("tdev")
        const d = {
          id,
          tenantId: t.id,
          name,
          keyId: typeId("akey"),
          clientId: clientId || undefined,
          roles,
          metadata: { tether_device_id: id },
          createdAt: now,
          updatedAt: now,
          revoked: false,
        }
        tether.devices.set(id, d)
        return asCredentials(d, newPassword())
      },
    },

    "devices.rotate": {
      kind: "command",
      secret: true,
      invalidates: DEVICE_INVALIDATES,
      handler: (params) => {
        const { d } = loadDevice(params?.tenantId, params?.deviceId)
        seconds("graceSeconds", params?.graceSeconds)
        if (d.revoked) throw conflict("device key is revoked and cannot be rotated")
        // A new key: the old one works for the grace window, which the fixture
        // does not model. Open connections keep the username they connected with.
        d.keyId = typeId("akey")
        d.updatedAt = Date.now()
        return asCredentials(d, newPassword())
      },
    },

    "devices.revoke": {
      kind: "command",
      invalidates: GONE_INVALIDATES,
      handler: (params) => {
        const { d } = loadDevice(params?.tenantId, params?.deviceId)
        d.revoked = true
        d.updatedAt = Date.now()
        // The keysmith plugin events end the device's live connections.
        endConnections(d.tenantId, (c) => c.deviceId === d.id && c.connected)
        return { ok: true }
      },
    },

    "devices.delete": {
      kind: "command",
      invalidates: GONE_INVALIDATES,
      handler: (params) => {
        const { d } = loadDevice(params?.tenantId, params?.deviceId)
        tether.devices.delete(d.id)
        dropClients(d.tenantId, (c) => c.deviceId !== d.id)
        return { ok: true }
      },
    },

    "devices.roles.set": {
      kind: "command",
      invalidates: DEVICE_INVALIDATES,
      handler: (params) => {
        const { t, d } = loadDevice(params?.tenantId, params?.deviceId)
        if (!Array.isArray(params?.roles)) throw badRequest("roles is required (use [] for none)")
        const seen = new Set()
        const roles = []
        for (const slug of params.roles) {
          if (typeof slug !== "string" || slug === "") throw badRequest("role slug is empty")
          if (seen.has(slug)) continue
          seen.add(slug)
          roles.push(slug)
        }
        const known = new Set(tenantRoles(t.id).map((r) => r.slug))
        for (const slug of roles) {
          if (!known.has(slug)) throw badRequest(`role "${slug}" does not exist`)
        }
        d.roles = roles
        d.updatedAt = Date.now()
        return projectDevice(d)
      },
    },

    "roles.create": {
      kind: "command",
      invalidates: ROLE_INVALIDATES,
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        const slug = str(params?.slug)
        if (slug === "") throw badRequest("role slug is required")
        if (!SLUG.test(slug)) {
          throw badRequest(`role slug ${JSON.stringify(slug)} must be 1 to 63 characters of a-z, 0-9, _ and -`)
        }
        const publish = stringList(params?.publish)
        const subscribe = stringList(params?.subscribe)
        checkGrants("publish", publish)
        checkGrants("subscribe", subscribe)
        const parentSlug = str(params?.parentSlug)
        const roles = tenantRoles(t.id)
        if (parentSlug !== "" && !roles.some((r) => r.slug === parentSlug)) {
          throw badRequest(`parent role "${parentSlug}" does not exist`)
        }
        if (roles.some((r) => r.slug === slug)) throw conflict(`role "${slug}" already exists`)
        const role = { slug, name: str(params?.name) || slug, publish: [...publish], subscribe: [...subscribe] }
        if (parentSlug !== "") role.parentSlug = parentSlug
        tether.roles.set(t.id, [...roles, role])
        return projectRole(role)
      },
    },

    "roles.delete": {
      kind: "command",
      invalidates: ROLE_INVALIDATES,
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        const role = loadRole(t.id, params?.roleSlug)
        const holders = tenantDevices(t.id).filter((d) => d.roles.includes(role.slug)).length
        if (holders > 0) throw conflict(`role "${role.slug}" is assigned to ${holders} subject(s)`)
        const children = tenantRoles(t.id).filter((r) => r.parentSlug === role.slug).length
        if (children > 0) throw conflict(`role "${role.slug}" is the parent of ${children} role(s)`)
        tether.roles.set(
          t.id,
          tenantRoles(t.id).filter((r) => r.slug !== role.slug),
        )
        return { ok: true }
      },
    },

    "roles.topics.set": {
      kind: "command",
      invalidates: ROLE_INVALIDATES,
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        const role = loadRole(t.id, params?.roleSlug)
        // The call replaces both lists, so a missing one would clear grants
        // the caller never meant to touch.
        if (!Array.isArray(params?.publish) || !Array.isArray(params?.subscribe)) {
          throw badRequest("publish and subscribe are both required (use [] for none)")
        }
        checkGrants("publish", params.publish)
        checkGrants("subscribe", params.subscribe)
        // Stored once each, first-seen order, like acl.Rules.
        role.publish = [...new Set(params.publish)]
        role.subscribe = [...new Set(params.subscribe)]
        return projectRules(role)
      },
    },

    "clients.kick": {
      kind: "command",
      invalidates: ["clients.list", "overview.stats"],
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        requireBroker()
        const clientId = required("clientId", params?.clientId)
        const c = findClient(t.id, clientId)
        // An offline session is not an open connection.
        if (!c || !c.connected) throw notFound(`client "${clientId}" is not connected`)
        endConnections(t.id, (x) => x.clientId === clientId)
        return { ok: true }
      },
    },

    "sessions.delete": {
      kind: "command",
      invalidates: ["clients.list", "overview.stats"],
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        requireBroker()
        const clientId = required("clientId", params?.clientId)
        if (!findClient(t.id, clientId)) throw notFound(`session "${clientId}" not found`)
        dropClients(t.id, (c) => c.clientId !== clientId)
        return { ok: true }
      },
    },

    "retained.delete": {
      kind: "command",
      invalidates: ["retained.list", "overview.stats"],
      handler: (params) => {
        const t = loadTenant(params?.tenantId)
        requireBroker()
        const topic = required("topic", params?.topic)
        if (!tenantRetained(t.id).some((r) => r.topic === topic)) throw notFound(`nothing retained on "${topic}"`)
        tether.retained.set(
          t.id,
          tenantRetained(t.id).filter((r) => r.topic !== topic),
        )
        return { ok: true }
      },
    },
  }
}
