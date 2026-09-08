#!/usr/bin/env node
// server.mjs
//
// This is a development fixture, not a shipped package. It exists because
// two plugins this wave (streaming-contract, auth) cannot be built against
// the real thing: the demo server only registers core-contract, and the
// authsome repo that owns "auth" is mid-flight in another session. Everything
// built against this fixture is only as trustworthy as its fidelity to the
// real envelope, so it imitates the wire shapes and status codes of
// extensions/dashboard/contract/transport (forge) as closely as a zero-
// dependency Node script reasonably can. See README.md for the mapping back
// to the Go source and for the four-state flags.
//
// No framework, no dependencies: plain node:http. That keeps this package
// installable with zero `pnpm install` surface and makes the whole contract
// readable in one file.

import { createServer } from "node:http"
import { randomBytes } from "node:crypto"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.FIXTURE_PORT ?? 4310)
const BASE_PATH = process.env.FIXTURE_BASE_PATH ?? "/dashboard/api/dashboard/v1"
const CSRF_TTL_MS = Number(process.env.FIXTURE_CSRF_TTL_MS ?? 5 * 60_000) // 5 minutes

function envBool(name, def) {
  const v = process.env[name]
  if (v === undefined || v === "") return def
  return v === "1" || v.toLowerCase() === "true"
}

/** Reads the three four-state knobs for one contributor's env prefix. */
function contributorConfig(prefix) {
  return {
    omit: envBool(`FIXTURE_${prefix}_OMIT`, false),
    configured: envBool(`FIXTURE_${prefix}_CONFIGURED`, true),
    version: process.env[`FIXTURE_${prefix}_VERSION`] || undefined,
    message: process.env[`FIXTURE_${prefix}_MESSAGE`] || undefined,
  }
}

// ---------------------------------------------------------------------------
// Wire-level error codes, mirrored from extensions/dashboard/contract/errors.go
// ---------------------------------------------------------------------------

const CODE = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  INTERNAL: "INTERNAL",
}

/** Thrown by intent handlers when they need a specific status+code pair. */
class FixtureError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

/** token -> expiresAt (ms epoch). Matches the real manager's TTL-checked validate. */
const csrfTokens = new Map()

function issueToken() {
  return randomBytes(24).toString("hex")
}

function isValidCSRF(token) {
  const exp = csrfTokens.get(token)
  if (exp === undefined) return false
  if (Date.now() > exp) {
    csrfTokens.delete(token)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// In-memory state — streaming-contract
// ---------------------------------------------------------------------------

const START = new Date().toISOString()

function seedStreamingState() {
  return {
    rooms: new Map([
      [
        "room_1",
        {
          id: "room_1",
          name: "General",
          description: "General discussion",
          owner: "usr_1",
          members: 2,
          private: false,
          archived: false,
          created: START,
          updated: START,
        },
      ],
      [
        "room_2",
        {
          id: "room_2",
          name: "Support",
          description: "Support escalations",
          owner: "usr_2",
          members: 1,
          private: true,
          archived: false,
          created: START,
          updated: START,
        },
      ],
    ]),
    roomMembers: new Map([
      [
        "room_1",
        [
          { userID: "usr_1", role: "owner", joinedAt: START, permissions: ["*"] },
          { userID: "usr_2", role: "member", joinedAt: START, permissions: ["read", "write"] },
        ],
      ],
      ["room_2", [{ userID: "usr_2", role: "owner", joinedAt: START, permissions: ["*"] }]],
    ]),
    moderation: new Map([
      [
        "room_1",
        [
          {
            timestamp: START,
            action: "mute",
            actorID: "usr_1",
            targetID: "usr_3",
            reason: "spam",
          },
        ],
      ],
      ["room_2", []],
    ]),
    connections: [
      {
        connID: "conn_1",
        userID: "usr_1",
        transport: "websocket",
        joinedRooms: ["room_1"],
        subscriptions: ["chan_1"],
        lastActivity: START,
        status: "active",
      },
      {
        connID: "conn_2",
        userID: "usr_2",
        transport: "sse",
        joinedRooms: ["room_1", "room_2"],
        subscriptions: ["chan_1", "chan_2"],
        lastActivity: START,
        status: "idle",
      },
    ],
    channels: [
      { id: "chan_1", name: "announcements", subscriberCount: 2, messageCount: 42 },
      { id: "chan_2", name: "support-alerts", subscriberCount: 1, messageCount: 7 },
    ],
    presence: [
      { userID: "usr_1", status: "online", customStatus: "", lastSeen: START, rooms: ["room_1"] },
      {
        userID: "usr_2",
        status: "away",
        customStatus: "in a meeting",
        lastSeen: START,
        rooms: ["room_1", "room_2"],
      },
    ],
    config: {
      backendType: "memory",
      distributed: false,
      nodeID: "fixture-node-1",
      features: { presence: true, moderation: true },
      limits: { maxRoomsPerUser: 50, maxMembersPerRoom: 500 },
      timeouts: { idleSeconds: 300 },
    },
  }
}

let streaming = seedStreamingState()

// ---------------------------------------------------------------------------
// In-memory state — auth
// ---------------------------------------------------------------------------

function seedAuthState() {
  const users = new Map([
    [
      "usr_1",
      {
        id: "usr_1",
        email: "ada@example.com",
        emailVerified: true,
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada",
        banned: false,
        createdAt: START,
        displayName: "Ada Lovelace",
        phone: "",
        phoneVerified: false,
        image: "",
        banReason: "",
        banExpiresAt: "",
        passwordChangedAt: "",
        updatedAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
      },
    ],
    [
      "usr_2",
      {
        id: "usr_2",
        email: "grace@example.com",
        emailVerified: true,
        firstName: "Grace",
        lastName: "Hopper",
        username: "grace",
        banned: false,
        createdAt: START,
        displayName: "Grace Hopper",
        phone: "",
        phoneVerified: false,
        image: "",
        banReason: "",
        banExpiresAt: "",
        passwordChangedAt: "",
        updatedAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
      },
    ],
    [
      "usr_3",
      {
        id: "usr_3",
        email: "alan@example.com",
        emailVerified: false,
        firstName: "Alan",
        lastName: "Turing",
        username: "alan",
        banned: false,
        createdAt: START,
        displayName: "Alan Turing",
        phone: "",
        phoneVerified: false,
        image: "",
        banReason: "",
        banExpiresAt: "",
        passwordChangedAt: "",
        updatedAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
      },
    ],
  ])

  const sessions = new Map([
    [
      "ses_1",
      {
        id: "ses_1",
        userId: "usr_1",
        ipAddress: "127.0.0.1",
        userAgent: "curl/8.4.0",
        lastActivityAt: START,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
      },
    ],
    [
      "ses_2",
      {
        id: "ses_2",
        userId: "usr_2",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0 (fixture)",
        lastActivityAt: START,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
      },
    ],
  ])

  return { users, sessions }
}

let auth = seedAuthState()

// ---------------------------------------------------------------------------
// Idempotency store — mirrors the default wiring in
// extensions/dashboard/extension.go:365
// (`dispatcher.WithIdempotencyStore(adaptIdempotencyStore(idempotency.NewInMemoryStore()))`)
// and the dedup rule in contract/dispatcher/dispatcher.go.
// ---------------------------------------------------------------------------

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000 // 24h, hardcoded, matching the Go store

/** key -> { data, meta, expiresAt } */
const idempotencyStore = new Map()

/**
 * Dedup applies only to kind === "command", only when a store exists (it
 * always does here) and the key is non-empty — queries never dedup. The
 * lookup key is the idempotency key plus an identity string, where identity
 * is `principalIdentity(p, intent)` = `user.Subject + ":" + intent`. This
 * fixture has no principal, so identity is `":" + intent`, and the full key
 * is `idempotencyKey + identity`. Note what's folded in: the intent, not the
 * contributor — matching that oddity is the point.
 */
function idempotencyStoreKey(idempotencyKey, intent) {
  return `${idempotencyKey}:${intent}`
}

function idempotencyLookup(key) {
  const entry = idempotencyStore.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    idempotencyStore.delete(key)
    return undefined
  }
  return entry
}

function idempotencyStorePut(key, data, meta) {
  idempotencyStore.set(key, { data, meta, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS })
}

// ---------------------------------------------------------------------------
// Streaming-contract intents (nine queries, no commands this wave)
// ---------------------------------------------------------------------------

const streamingHandlers = {
  stats: {
    kind: "query",
    handler: () => ({
      totalConnections: streaming.connections.length,
      totalRooms: streaming.rooms.size,
      totalChannels: streaming.channels.length,
      totalMessages: streaming.channels.reduce((sum, c) => sum + c.messageCount, 0),
      onlineUsers: streaming.presence.filter((p) => p.status === "online").length,
      messagesPerSec: 3.2,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryBytes: process.memoryUsage().rss,
    }),
  },
  "connections.list": {
    kind: "query",
    handler: () => ({ connections: streaming.connections }),
  },
  "rooms.list": {
    kind: "query",
    handler: () => ({ rooms: [...streaming.rooms.values()] }),
  },
  "rooms.detail": {
    kind: "query",
    handler: (params) => {
      const room = streaming.rooms.get(params?.id)
      if (!room) throw new FixtureError(404, CODE.NOT_FOUND, `room ${params?.id} not found`)
      return room
    },
  },
  "rooms.members": {
    kind: "query",
    handler: (params) => {
      if (!streaming.rooms.has(params?.id)) {
        throw new FixtureError(404, CODE.NOT_FOUND, `room ${params?.id} not found`)
      }
      return { members: streaming.roomMembers.get(params.id) ?? [] }
    },
  },
  "rooms.moderation": {
    kind: "query",
    handler: (params) => {
      if (!streaming.rooms.has(params?.id)) {
        throw new FixtureError(404, CODE.NOT_FOUND, `room ${params?.id} not found`)
      }
      return { entries: streaming.moderation.get(params.id) ?? [] }
    },
  },
  "channels.list": {
    kind: "query",
    handler: () => ({ channels: streaming.channels }),
  },
  "presence.list": {
    kind: "query",
    handler: () => ({ presence: streaming.presence }),
  },
  config: {
    kind: "query",
    handler: () => streaming.config,
  },
}

// ---------------------------------------------------------------------------
// Auth intents (the nine this wave scopes to)
// ---------------------------------------------------------------------------

function userSummary(u) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    banned: u.banned,
    createdAt: u.createdAt,
  }
}

function sessionSummary(s) {
  return {
    id: s.id,
    userId: s.userId,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastActivityAt: s.lastActivityAt,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  }
}

const authHandlers = {
  "auth.login": {
    kind: "command",
    handler: (payload) => {
      const email = payload?.email
      const match = [...auth.users.values()].find((u) => u.email === email)
      // A fixture, not a real auth check: any password validates. An unknown
      // email still succeeds so a plugin's happy path is easy to exercise;
      // the subject falls back to the first seeded user.
      const subject = match?.id ?? "usr_1"
      return { ok: true, subject }
    },
  },
  "auth.logout": {
    kind: "command",
    handler: () => ({ ok: true }),
  },
  "auth.config": {
    kind: "query",
    handler: () => ({
      brand: "Forge Fixture",
      passwordEnabled: true,
      signupURL: "/signup",
      signupLabel: "Create an account",
      termsURL: "/terms",
      privacyURL: "/privacy",
      socialProviders: [
        { id: "google", label: "Continue with Google", authStartURL: "/auth/oauth/google/start" },
      ],
    }),
  },
  "users.list": {
    kind: "query",
    handler: (params) => {
      let list = [...auth.users.values()]
      if (params?.email) {
        list = list.filter((u) => u.email.includes(params.email))
      }
      const limit = params?.limit && params.limit > 0 ? params.limit : list.length
      return { users: list.slice(0, limit).map(userSummary), total: list.length }
    },
  },
  "users.detail": {
    kind: "query",
    handler: (params) => {
      const u = auth.users.get(params?.id)
      if (!u) throw new FixtureError(404, CODE.NOT_FOUND, `user ${params?.id} not found`)
      return u
    },
  },
  "users.ban": {
    kind: "command",
    invalidates: ["users.list", "users.detail"],
    handler: (payload) => {
      const u = auth.users.get(payload?.id)
      if (!u) throw new FixtureError(404, CODE.NOT_FOUND, `user ${payload?.id} not found`)
      u.banned = true
      u.banReason = payload?.reason ?? ""
      u.banExpiresAt = payload?.expiresAt ?? ""
      u.updatedAt = new Date().toISOString()
      return { ok: true, id: u.id }
    },
  },
  "users.unban": {
    kind: "command",
    invalidates: ["users.list", "users.detail"],
    handler: (payload) => {
      const u = auth.users.get(payload?.id)
      if (!u) throw new FixtureError(404, CODE.NOT_FOUND, `user ${payload?.id} not found`)
      u.banned = false
      u.banReason = ""
      u.banExpiresAt = ""
      u.updatedAt = new Date().toISOString()
      return { ok: true, id: u.id }
    },
  },
  "sessions.list": {
    kind: "query",
    handler: (params) => {
      let list = [...auth.sessions.values()]
      if (params?.userId) list = list.filter((s) => s.userId === params.userId)
      return { sessions: list.map(sessionSummary) }
    },
  },
  "sessions.revoke": {
    kind: "command",
    invalidates: ["sessions.list"],
    handler: (payload) => {
      const id = payload?.id
      if (!auth.sessions.has(id)) {
        throw new FixtureError(404, CODE.NOT_FOUND, `session ${id} not found`)
      }
      auth.sessions.delete(id)
      return { ok: true, id }
    },
  },
}

// ---------------------------------------------------------------------------
// Registry: contributor -> intent -> definition
// ---------------------------------------------------------------------------

function findIntent(contributor, intent) {
  if (contributor === "streaming-contract") {
    if (contributorConfig("STREAMING").omit) return null
    return streamingHandlers[intent] ?? null
  }
  if (contributor === "auth") {
    if (contributorConfig("AUTH").omit) return null
    return authHandlers[intent] ?? null
  }
  return null
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

function intentCapability(name) {
  return { name, versions: [{ n: 1, status: "active" }] }
}

/**
 * Field order matches extensions/dashboard/contract/transport/capabilities.go
 * + the four-state work layered on it: name, envelopes, intents, version
 * (omitted when unset), configured (always present), message (omitted when
 * unset). `configured` is deliberately never left out — the four-state
 * resolver in packages/plugin/src/resolve.ts distinguishes `false` from
 * "not reported", and a fixture that ever drops the key would let that
 * distinction go untested.
 */
function contributorCapability(name, envelopes, intentNames, cfg) {
  const c = { name, envelopes, intents: intentNames.map(intentCapability) }
  if (cfg.version) c.version = cfg.version
  c.configured = cfg.configured
  if (cfg.message) c.message = cfg.message
  return c
}

function buildCapabilities() {
  const contributors = []

  const streamingCfg = contributorConfig("STREAMING")
  if (!streamingCfg.omit) {
    contributors.push(
      contributorCapability("streaming-contract", ["v1"], Object.keys(streamingHandlers), streamingCfg),
    )
  }

  const authCfg = contributorConfig("AUTH")
  if (!authCfg.omit) {
    contributors.push(contributorCapability("auth", ["v1"], Object.keys(authHandlers), authCfg))
  }

  return { shellEnvelopes: ["v1"], contributors }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function applyCORS(req, res) {
  const origin = req.headers.origin
  res.setHeader("Access-Control-Allow-Origin", origin ?? "*")
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Credentials", "true")
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(body)
}

/** Mirrors contract.ErrorResponse: {ok:false, envelope:"v1", error:{code,message}}. */
function sendError(res, status, code, message) {
  sendJSON(res, status, { ok: false, envelope: "v1", error: { code, message } })
}

const MAX_BODY_BYTES = 5 * 1024 * 1024

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

/**
 * POST {BASE_PATH}: the envelope dispatch. Order mirrors
 * extensions/dashboard/contract/transport/http.go's ServeHTTP exactly,
 * because the whole point of this fixture is that the csrf/idempotencyKey
 * rejection fires before any handler logic runs — the same place the real
 * server puts it, regardless of whether contract security is otherwise
 * configured.
 */
async function handleContractRequest(req, res) {
  if (req.method !== "POST") {
    return sendError(res, 405, CODE.BAD_REQUEST, "POST required")
  }

  let body
  try {
    body = await readJSONBody(req)
  } catch (err) {
    return sendError(res, 400, CODE.BAD_REQUEST, `invalid JSON: ${err.message}`)
  }

  const { envelope, kind, contributor, intent, params, payload, csrf, idempotencyKey } = body ?? {}

  if (envelope !== "v1") {
    return sendError(res, 400, CODE.UNSUPPORTED_VERSION, `envelope ${envelope} unsupported`)
  }
  if (kind !== "query" && kind !== "command") {
    // validateKind (contract/transport/http.go) also accepts kind=subscribe,
    // for SSE streaming; this fixture doesn't model it because no intent
    // either plugin consumes this wave needs it. It does NOT accept
    // kind=graph — that was the server-driven-UI surface W3 deleted.
    return sendError(res, 400, CODE.BAD_REQUEST, `unknown kind ${kind}`)
  }

  const def = findIntent(contributor, intent)
  if (!def) {
    return sendError(res, 404, CODE.NOT_FOUND, `intent ${intent} not registered`)
  }
  if (def.kind !== kind) {
    return sendError(
      res,
      400,
      CODE.BAD_REQUEST,
      `kind ${kind} does not match intent capability ${def.kind === "command" ? "write" : "read"}`,
    )
  }

  if (kind === "command") {
    // The load-bearing check this whole fixture exists to enforce: reject
    // before consulting CSRF validity at all, exactly as
    // contract/transport/http.go:120 does.
    if (!idempotencyKey || !csrf) {
      return sendError(res, 400, CODE.BAD_REQUEST, "command requires csrf and idempotencyKey")
    }
    if (!isValidCSRF(csrf)) {
      return sendError(res, 403, CODE.UNAUTHENTICATED, "csrf token invalid")
    }
  }

  // Idempotency dedup: command-only, and only once a key is actually
  // present. A hit returns the cached data/meta verbatim without re-running
  // the handler — see the idempotency-store block above for the exact key.
  let idemKey
  if (kind === "command" && idempotencyKey) {
    idemKey = idempotencyStoreKey(idempotencyKey, intent)
    const cached = idempotencyLookup(idemKey)
    if (cached) {
      return sendJSON(res, 200, { ok: true, envelope: "v1", kind, data: cached.data, meta: cached.meta })
    }
  }

  const input = kind === "command" ? payload : params

  // Fixture-only authorisation hook: a command or query whose params/payload
  // carries `__forbidden: true` gets a real denial instead of running its
  // handler. Exists so a client's retry logic can be proven NOT to retry a
  // 403/PERMISSION_DENIED the way it retries 403/UNAUTHENTICATED.
  if (input && typeof input === "object" && input.__forbidden) {
    return sendError(res, 403, CODE.PERMISSION_DENIED, "denied by fixture (__forbidden)")
  }

  let data
  try {
    data = def.handler(input ?? {})
  } catch (err) {
    if (err instanceof FixtureError) {
      return sendError(res, err.status, err.code, err.message)
    }
    return sendError(res, 400, CODE.BAD_REQUEST, err.message)
  }

  const meta = {}
  if (def.invalidates?.length) meta.invalidates = def.invalidates

  // Only successful dispatches are cached: the handler above already
  // returned early on error (FixtureError or otherwise), so reaching here
  // means success. A failed command never poisons the key, and a retry of
  // it runs fresh.
  if (idemKey) idempotencyStorePut(idemKey, data, meta)

  return sendJSON(res, 200, { ok: true, envelope: "v1", kind, data, meta })
}

/** GET {BASE_PATH}/csrf. */
function handleCSRFGet(req, res, url) {
  if (req.method !== "GET") {
    return sendError(res, 405, CODE.BAD_REQUEST, "GET required")
  }
  const stale = url.searchParams.get("stale")
  const token = issueToken()
  if (stale === "1" || stale === "true") {
    // Deliberately never added to csrfTokens, and reported with an
    // already-past expiresAt: any command that carries it gets 403
    // UNAUTHENTICATED, which is the whole point of this flag — driving Task
    // 1's refresh-and-retry path without waiting out a real TTL.
    return sendJSON(res, 200, { token, expiresAt: new Date(Date.now() - 1000).toISOString() })
  }
  const expiresAt = Date.now() + CSRF_TTL_MS
  csrfTokens.set(token, expiresAt)
  return sendJSON(res, 200, { token, expiresAt: new Date(expiresAt).toISOString() })
}

/**
 * POST {BASE_PATH}/_fixture/expire-csrf — fixture-only control endpoint.
 * Invalidates every currently-valid token, so a token a client already holds
 * (fetched the normal way) goes stale without needing `?stale=1` up front.
 * This is the shape a real TTL expiry takes: the client doesn't find out
 * until the next command is rejected.
 */
function handleExpireCSRF(res) {
  const count = csrfTokens.size
  csrfTokens.clear()
  return sendJSON(res, 200, { ok: true, expired: count })
}

/** POST {BASE_PATH}/_fixture/reset — fixture-only, restores seed state. */
function handleReset(res) {
  streaming = seedStreamingState()
  auth = seedAuthState()
  csrfTokens.clear()
  idempotencyStore.clear()
  return sendJSON(res, 200, { ok: true })
}

/**
 * GET {BASE_PATH}/principal, mirroring extensions/dashboard/handlers/principal.go.
 *
 * FIXTURE_PRINCIPAL selects which of the Go handler's four answers to serve:
 *
 *   signedIn   (default)  200 {authenticated:true, subject, ...}
 *   anonymous             200 {authenticated:false}          auth switched off
 *   signedOut             401 {code:"UNAUTHENTICATED", loginPath}
 *   denied                403 {code:"PERMISSION_DENIED", requiredRoles}
 *
 * The client's other two states need no switch. `unknown` happens on any cold
 * load before this answers, and `unreachable` you get by stopping the fixture.
 */
function handlePrincipalGet(req, res) {
  if (req.method !== "GET") {
    return sendError(res, 405, CODE.BAD_REQUEST, "GET required")
  }
  const mode = process.env.FIXTURE_PRINCIPAL ?? "signedIn"
  switch (mode) {
    case "anonymous":
      return sendJSON(res, 200, { authenticated: false })
    case "signedOut":
      return sendJSON(res, 401, {
        code: "UNAUTHENTICATED",
        loginPath: "/dashboard/login",
      })
    case "denied":
      return sendJSON(res, 403, {
        code: "PERMISSION_DENIED",
        message: "Your account doesn't have a role required to access this dashboard.",
        requiredRoles: ["admin"],
      })
    case "signedIn":
      return sendJSON(res, 200, {
        authenticated: true,
        subject: "usr_fixture_ada",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        roles: ["admin"],
        scopes: ["users:read", "users:write", "sessions:read"],
      })
    default:
      return sendError(
        res,
        500,
        CODE.INTERNAL,
        `FIXTURE_PRINCIPAL=${mode} is not one of signedIn, anonymous, signedOut, denied`,
      )
  }
}

const server = createServer(async (req, res) => {
  applyCORS(req, res)
  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`)

  try {
    if (url.pathname === BASE_PATH) {
      await handleContractRequest(req, res)
      return
    }
    if (url.pathname === `${BASE_PATH}/capabilities`) {
      if (req.method !== "GET") return sendError(res, 405, CODE.BAD_REQUEST, "GET required")
      return sendJSON(res, 200, buildCapabilities())
    }
    if (url.pathname === `${BASE_PATH}/csrf`) {
      return handleCSRFGet(req, res, url)
    }
    if (url.pathname === `${BASE_PATH}/principal`) {
      return handlePrincipalGet(req, res)
    }
    if (url.pathname === `${BASE_PATH}/_fixture/expire-csrf` && req.method === "POST") {
      return handleExpireCSRF(res)
    }
    if (url.pathname === `${BASE_PATH}/_fixture/reset` && req.method === "POST") {
      return handleReset(res)
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return sendJSON(res, 200, {
        ok: true,
        name: "@forge-go/fixture-server",
        basePath: BASE_PATH,
        note: "development fixture, not a shipped package",
      })
    }
    return sendError(res, 404, CODE.NOT_FOUND, `no route for ${req.method} ${url.pathname}`)
  } catch (err) {
    return sendError(res, 500, "INTERNAL", err instanceof Error ? err.message : "internal error")
  }
})

// Loopback, explicitly. Omit the host and node:http binds every interface,
// which puts a server that reflects the request origin with
// `Access-Control-Allow-Credentials: true` and exposes a mutating
// `_fixture/reset` on whatever network the machine is on. The blast radius is
// seeded fake data, so this is housekeeping rather than a security fix - but
// the log line below already said localhost, and now it is true.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fixture-server] development fixture, not a shipped package`)
  console.log(`[fixture-server] listening on http://localhost:${PORT}`)
  console.log(`[fixture-server] contract base: http://localhost:${PORT}${BASE_PATH}`)
  console.log(
    `[fixture-server] streaming-contract configured=${contributorConfig("STREAMING").configured} omit=${contributorConfig("STREAMING").omit}`,
  )
  console.log(
    `[fixture-server] auth              configured=${contributorConfig("AUTH").configured} omit=${contributorConfig("AUTH").omit}`,
  )
})
