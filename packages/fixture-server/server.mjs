#!/usr/bin/env node
// server.mjs
//
// This is a development fixture, not a shipped package. It exists because
// the dashboard's plugins cannot be built against the real thing: the demo
// server only registers core-contract, and the authsome repo that owns
// "auth" plus its two dozen sub-plugins is mid-flight elsewhere. Everything
// built against this fixture is only as trustworthy as its fidelity to the
// real envelope, so it imitates the wire shapes and status codes of
// extensions/dashboard/contract/transport (forge) as closely as a zero-
// dependency Node script reasonably can. See README.md for the mapping back
// to the Go source and for the four-state flags.
//
// No framework, no dependencies: plain node:http. That keeps this package
// installable with zero `pnpm install` surface and makes the whole contract
// readable in one file.
//
// Contributor inventory (three top-level plugins, twenty-four sub-plugins):
//   - core-contract       (packages/plugin-core)            1 query
//   - streaming-contract  (packages/plugin-streaming)        9 queries, 5 commands
//   - auth                (packages/plugin-authsome)         query+command surface
//   - organization, apikey, waitlist, consent, subscription, password
//                          (packages/plugin-authsome/src/sub) each its own
//                          contributor, own intents
//   - eighteen settings-only sub-plugins (sub/settings-only.tsx): each its
//     own contributor name, `intents: []`, reachable only through auth's
//     settings.namespace/settings.update via the host-intent allowlist.
//   - relay               (packages/plugin-relay)            14 queries, 12 commands
//                          mirrors relay/extension/contract; endpoints here,
//                          the rest in relay-fixtures.mjs
//   - bastion             (packages/plugin-bastion)          9 queries
//   - sentinel            (packages/plugin-sentinel)         18 queries, 14 commands
//                          mirrors sentinel/extension/contract; see
//                          sentinel-fixtures.mjs
//   - herald              (packages/plugin-herald)           14 queries, 18 commands
//                          mirrors herald/extension/contract; see
//                          herald-fixtures.mjs

import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { createRelayFixtures } from "./relay-fixtures.mjs"
import { createVaultHandlers, resetVault } from "./vault-fixtures.mjs"
import { createTroveHandlers, handleTroveContent, resetTrove, TROVE_CONTENT_PATH } from "./trove-fixtures.mjs"
import { createLedgerHandlers, resetLedger } from "./ledger-fixtures.mjs"
import { createChronicleHandlers, resetChronicle } from "./chronicle-fixtures.mjs"
import { createBastionHandlers, resetBastion } from "./bastion-fixtures.mjs"
import { createKeysmithHandlers, resetKeysmith } from "./keysmith-fixtures.mjs"
import { createSentinelHandlers, resetSentinel } from "./sentinel-fixtures.mjs"
import { createHeraldHandlers, resetHerald } from "./herald-fixtures.mjs"
import { createWeaveHandlers, resetWeave } from "./weave-fixtures.mjs"

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
  // `details` mirrors contract.Error.Details. The real server puts the field a
  // validation error is about there (details.field), and a fixture that drops
  // it would hide a form that fails to map the error onto the right input.
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

function notFound(kind, id) {
  return new FixtureError(404, CODE.NOT_FOUND, `${kind} ${id} not found`)
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
// Shared id counters. Seeded above the count of fixture rows so a freshly
// created row's id never collides with a seeded one.
// ---------------------------------------------------------------------------

let idCounters = {}

function resetIdCounters() {
  idCounters = {
    user: 7,
    device: 2,
    role: 2,
    app: 3,
    env: 6,
    webhook: 1,
    org: 2,
    member: 2,
    apikey: 2,
    waitlist: 7,
    consent: 7,
    room: 2,
    formConfig: 1,
  }
}
resetIdCounters()

function nextId(kind, prefix) {
  idCounters[kind] = (idCounters[kind] ?? 0) + 1
  return `${prefix}_${idCounters[kind]}`
}

const START = new Date().toISOString()

/**
 * Cursor pagination shared by users.list, waitlist.list and consent.list.
 * The cursor is just an opaque stringified offset — the wire never promises
 * anything about its format, and offset-as-cursor is enough to exercise the
 * client's cursor stack (next/previous/reset) faithfully. `defaultLimit` is
 * deliberately small (not the real server's 100) because none of the pages
 * that call these intents send a `limit` at all, and a 100-row default would
 * make the second page unreachable without seeding a hundred rows.
 */
function paginateCursor(list, { cursor, limit } = {}, defaultLimit) {
  const offset = cursor ? Number(cursor) || 0 : 0
  const lim = limit && limit > 0 ? limit : defaultLimit
  const page = list.slice(offset, offset + lim)
  const nextOffset = offset + lim
  const nextCursor = nextOffset < list.length ? String(nextOffset) : undefined
  return { page, nextCursor, total: list.length }
}

// ---------------------------------------------------------------------------
// In-memory state — streaming-contract
// ---------------------------------------------------------------------------

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
  const userSeed = [
    ["usr_1", "ada@example.com", "Ada", "Lovelace", "ada", true],
    ["usr_2", "grace@example.com", "Grace", "Hopper", "grace", true],
    ["usr_3", "alan@example.com", "Alan", "Turing", "alan", false],
    ["usr_4", "margaret@example.com", "Margaret", "Hamilton", "margaret", true],
    ["usr_5", "katherine@example.com", "Katherine", "Johnson", "katherine", true],
    ["usr_6", "radia@example.com", "Radia", "Perlman", "radia", true],
    ["usr_7", "barbara@example.com", "Barbara", "Liskov", "barbara", true],
  ]
  const users = new Map(
    userSeed.map(([id, email, firstName, lastName, username, emailVerified], i) => [
      id,
      {
        id,
        email,
        emailVerified,
        firstName,
        lastName,
        username,
        banned: false,
        createdAt: new Date(Date.now() - (userSeed.length - i) * 3_600_000).toISOString(),
        displayName: `${firstName} ${lastName}`,
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
    ]),
  )

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
        orgId: "",
        deviceId: "dev_1",
        impersonatedBy: "",
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        principalKind: "user",
        updatedAt: START,
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
        orgId: "",
        deviceId: "dev_2",
        impersonatedBy: "",
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        principalKind: "user",
        updatedAt: START,
      },
    ],
  ])

  const devices = new Map([
    [
      "dev_1",
      {
        id: "dev_1",
        userId: "usr_1",
        name: "Ada's MacBook",
        type: "desktop",
        browser: "Chrome",
        os: "macOS",
        ipAddress: "127.0.0.1",
        trusted: true,
        lastSeenAt: START,
        createdAt: START,
      },
    ],
    [
      "dev_2",
      {
        id: "dev_2",
        userId: "usr_2",
        name: "Grace's iPhone",
        type: "mobile",
        browser: "Safari",
        os: "iOS",
        ipAddress: "127.0.0.1",
        trusted: false,
        lastSeenAt: START,
        createdAt: START,
      },
    ],
  ])

  const roles = new Map([
    [
      "role_1",
      {
        id: "role_1",
        name: "Admin",
        slug: "admin",
        description: "Full access to every resource",
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
        parentId: "",
        permissions: [
          { id: "perm_1", action: "*", resource: "*" },
        ],
        updatedAt: START,
      },
    ],
    [
      "role_2",
      {
        id: "role_2",
        name: "Viewer",
        slug: "viewer",
        description: "Read-only access",
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
        parentId: "",
        permissions: [
          { id: "perm_2", action: "read", resource: "*" },
        ],
        updatedAt: START,
      },
    ],
  ])

  const apps = new Map([
    [
      "app_1",
      {
        id: "app_1",
        name: "Platform",
        slug: "platform",
        isPlatform: true,
        createdAt: START,
        logo: "",
        publishableKey: "pk_fixture_platform",
        metadata: {},
        updatedAt: START,
      },
    ],
    [
      "app_2",
      {
        id: "app_2",
        name: "Demo App",
        slug: "demo-app",
        isPlatform: false,
        createdAt: START,
        logo: "",
        publishableKey: "pk_fixture_demo",
        metadata: { tier: "free" },
        updatedAt: START,
      },
    ],
    [
      "app_3",
      {
        id: "app_3",
        name: "Storefront",
        slug: "storefront",
        isPlatform: false,
        createdAt: START,
        logo: "",
        publishableKey: "pk_fixture_storefront",
        metadata: { tier: "growth" },
        updatedAt: START,
      },
    ],
  ])

  const environments = new Map([
    [
      "env_1",
      {
        id: "env_1",
        name: "Production",
        slug: "production",
        type: "production",
        isDefault: true,
        createdAt: START,
        appId: "app_1",
        color: "#22c55e",
        description: "Live environment",
        clonedFrom: "",
        metadata: {},
        updatedAt: START,
      },
    ],
    [
      "env_2",
      {
        id: "env_2",
        name: "Staging",
        slug: "staging",
        type: "staging",
        isDefault: false,
        createdAt: START,
        appId: "app_1",
        color: "#eab308",
        description: "Pre-production environment",
        clonedFrom: "",
        metadata: {},
        updatedAt: START,
      },
    ],
    // app_2 and app_3 each get their own production/staging pair, scoped by
    // `appId` — needed so apps.context's availableEnvs (filtered to the
    // current app) has something to show for every app the switcher lists,
    // not only app_1.
    [
      "env_3",
      {
        id: "env_3",
        name: "Production",
        slug: "production",
        type: "production",
        isDefault: true,
        createdAt: START,
        appId: "app_2",
        color: "#22c55e",
        description: "Live environment",
        clonedFrom: "",
        metadata: {},
        updatedAt: START,
      },
    ],
    [
      "env_4",
      {
        id: "env_4",
        name: "Staging",
        slug: "staging",
        type: "staging",
        isDefault: false,
        createdAt: START,
        appId: "app_2",
        color: "#eab308",
        description: "Pre-production environment",
        clonedFrom: "",
        metadata: {},
        updatedAt: START,
      },
    ],
    [
      "env_5",
      {
        id: "env_5",
        name: "Production",
        slug: "production",
        type: "production",
        isDefault: true,
        createdAt: START,
        appId: "app_3",
        color: "#22c55e",
        description: "Live environment",
        clonedFrom: "",
        metadata: {},
        updatedAt: START,
      },
    ],
    [
      "env_6",
      {
        id: "env_6",
        name: "Staging",
        slug: "staging",
        type: "staging",
        isDefault: false,
        createdAt: START,
        appId: "app_3",
        color: "#eab308",
        description: "Pre-production environment",
        clonedFrom: "",
        metadata: {},
        updatedAt: START,
      },
    ],
  ])

  const webhooks = new Map([
    [
      "webhook_1",
      {
        id: "webhook_1",
        url: "https://example.com/hooks/authsome",
        events: ["user.created", "user.banned"],
        active: true,
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
        updatedAt: START,
      },
    ],
  ])

  const featureToggles = new Map([
    ["passwordAuth", { key: "passwordAuth", label: "Password sign-in", description: "Allow email+password", enabled: true, available: true }],
    ["socialLogin", { key: "socialLogin", label: "Social login", description: "Allow OAuth providers", enabled: true, available: true }],
    ["mfaRequired", { key: "mfaRequired", label: "Require MFA", description: "Force multi-factor for all users", enabled: false, available: true }],
    ["waitlistMode", { key: "waitlistMode", label: "Waitlist mode", description: "Gate signups behind approval", enabled: false, available: true }],
  ])

  const formConfigs = {
    list: [{ id: "form_1", formType: "signup", version: 1, active: true, createdAt: START }],
    signupFields: [
      { key: "email", label: "Email", type: "email", order: 1, validation: { required: true } },
      { key: "password", label: "Password", type: "password", order: 2, validation: { required: true, minLen: 8 } },
      { key: "name", label: "Full name", type: "text", order: 3, placeholder: "Ada Lovelace" },
    ],
    signupActive: true,
    signupUpdatedAt: START,
  }

  return {
    users,
    sessions,
    devices,
    roles,
    apps,
    environments,
    webhooks,
    featureToggles,
    formConfigs,
  }
}

let auth = seedAuthState()

// ---------------------------------------------------------------------------
// In-memory state — app/environment switcher (apps.context, apps.switch,
// environments.switch). Kept separate from `auth` because it models
// something different: which app/env THIS caller is scoped to right now,
// not seeded data.
//
// The real server keeps this in the `authsome_app` / `authsome_env`
// cookies, read back through the principal's claims. This fixture has no
// per-request identity, so module state stands in for "the one session
// this fixture serves." `null` means "unset," which resolves to the
// platform app / that app's default environment — the same fallback
// handlers_context.go applies when the claim is missing.
// ---------------------------------------------------------------------------

let currentAppId = null
let currentEnvId = null

function platformAppId() {
  for (const a of auth.apps.values()) {
    if (a.isPlatform) return a.id
  }
  return undefined
}

// ---------------------------------------------------------------------------
// In-memory state — settings (served through auth's settings.namespace /
// settings.update / settings.enforce / settings.unenforce, and read by the
// eighteen settings-only sub-plugins through the host-intent allowlist).
// ---------------------------------------------------------------------------

function seedSettingsState() {
  // Real categories for several of the eighteen namespaces, plus `password`
  // (the settings-editor link `password.tsx` points at) so the panels have
  // something to render. Deliberately includes, across this set, at least
  // one enforced field (riskengine.mode), one read-only field
  // (geoip.provider) and one sensitive field whose effectiveValue is the
  // literal "***" (geoip.apiKey) — per the contract, a secret's value never
  // travels on the wire even in the settings surface.
  return new Map([
    [
      "riskengine",
      {
        displayName: "Risk Engine",
        categories: [
          {
            name: "Scoring",
            settings: [
              {
                key: "riskengine.enabled",
                displayName: "Enabled",
                type: "bool",
                default: true,
                effectiveValue: true,
                isOverridden: false,
                isEnforced: false,
                canOverride: true,
                order: 1,
              },
              {
                key: "riskengine.threshold",
                displayName: "Block threshold",
                type: "int",
                default: 75,
                effectiveValue: 80,
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                order: 2,
                validation: { min: 0, max: 100 },
              },
              {
                key: "riskengine.mode",
                displayName: "Mode",
                type: "string",
                default: "monitor",
                effectiveValue: "enforce",
                isOverridden: true,
                isEnforced: true,
                canOverride: false,
                order: 3,
                options: [
                  { label: "Monitor", value: "monitor" },
                  { label: "Enforce", value: "enforce" },
                ],
              },
            ],
          },
        ],
      },
    ],
    [
      "geoip",
      {
        displayName: "Geo IP",
        categories: [
          {
            name: "Provider",
            settings: [
              {
                key: "geoip.provider",
                displayName: "Provider",
                type: "string",
                default: "maxmind",
                effectiveValue: "maxmind",
                isOverridden: false,
                isEnforced: false,
                canOverride: false,
                readOnly: true,
                order: 1,
              },
              {
                key: "geoip.apiKey",
                displayName: "API key",
                type: "string",
                effectiveValue: "***",
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                sensitive: true,
                order: 2,
              },
              {
                key: "geoip.cacheTtl",
                displayName: "Cache TTL (seconds)",
                type: "int",
                default: 1800,
                effectiveValue: 3600,
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                order: 3,
              },
            ],
          },
        ],
      },
    ],
    [
      "mfa",
      {
        displayName: "Multi-Factor Auth",
        categories: [
          {
            name: "Policy",
            settings: [
              {
                key: "mfa.required",
                displayName: "Require MFA",
                type: "bool",
                default: false,
                effectiveValue: false,
                isOverridden: false,
                isEnforced: false,
                canOverride: true,
                order: 1,
              },
              {
                key: "mfa.methods",
                displayName: "Allowed methods",
                type: "string",
                default: "totp",
                effectiveValue: "totp,webauthn",
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                order: 2,
              },
            ],
          },
        ],
      },
    ],
    [
      "notification",
      {
        displayName: "Notifications",
        categories: [
          {
            name: "Delivery",
            settings: [
              {
                key: "notification.email",
                displayName: "Email notifications",
                type: "bool",
                default: true,
                effectiveValue: true,
                isOverridden: false,
                isEnforced: false,
                canOverride: true,
                order: 1,
              },
              {
                key: "notification.webhookUrl",
                displayName: "Webhook URL",
                type: "string",
                effectiveValue: "",
                isOverridden: false,
                isEnforced: false,
                canOverride: true,
                order: 2,
              },
            ],
          },
        ],
      },
    ],
    [
      "scim",
      {
        displayName: "SCIM",
        categories: [
          {
            name: "Provisioning",
            settings: [
              {
                key: "scim.enabled",
                displayName: "Enabled",
                type: "bool",
                default: false,
                effectiveValue: false,
                isOverridden: false,
                isEnforced: false,
                canOverride: true,
                order: 1,
              },
              {
                key: "scim.token",
                displayName: "Bearer token",
                type: "string",
                effectiveValue: "***",
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                sensitive: true,
                order: 2,
              },
            ],
          },
        ],
      },
    ],
    [
      "password",
      {
        displayName: "Password",
        categories: [
          {
            name: "Validation",
            settings: [
              {
                key: "password.min_length",
                displayName: "Minimum length",
                type: "int",
                default: 8,
                effectiveValue: 10,
                isOverridden: true,
                isEnforced: true,
                canOverride: false,
                order: 1,
                validation: { min: 8, max: 128 },
              },
              {
                key: "password.require_special",
                displayName: "Require special character",
                type: "bool",
                default: false,
                effectiveValue: true,
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                order: 2,
              },
            ],
          },
        ],
      },
    ],
  ])
}

let settingsData = seedSettingsState()

/** A namespace this fixture has no hand-authored data for still answers a
 * well-formed (if sparse) response instead of 404 — matching how a real
 * namespace with nothing configured yet behaves. */
function settingsNamespaceFor(namespace) {
  const known = settingsData.get(namespace)
  if (known) return known
  return {
    displayName: undefined,
    categories: [
      {
        name: "General",
        settings: [
          {
            key: `${namespace}.enabled`,
            displayName: "Enabled",
            type: "bool",
            default: false,
            effectiveValue: false,
            isOverridden: false,
            isEnforced: false,
            canOverride: true,
            order: 1,
          },
        ],
      },
    ],
  }
}

function settingsFieldCount(entry) {
  return entry.categories.reduce((sum, c) => sum + (c.settings?.length ?? 0), 0)
}

function findSettingField(namespace, key) {
  const entry = settingsData.get(namespace)
  if (!entry) return null
  for (const category of entry.categories) {
    const field = category.settings.find((s) => s.key === key)
    if (field) return field
  }
  return null
}

// ---------------------------------------------------------------------------
// In-memory state — organization
// ---------------------------------------------------------------------------

function seedOrganizationState() {
  const organizations = new Map([
    ["org_1", { id: "org_1", name: "Acme Corp", slug: "acme", createdAt: START, appId: "app_fixture", logo: "", metadata: { plan: "growth" }, updatedAt: START }],
    ["org_2", { id: "org_2", name: "Globex", slug: "globex", createdAt: START, appId: "app_fixture", logo: "", metadata: {}, updatedAt: START }],
  ])
  const members = new Map([
    ["org_1", [
      { id: "member_1", userId: "usr_1", role: "owner", createdAt: START },
      { id: "member_2", userId: "usr_2", role: "member", createdAt: START },
    ]],
    ["org_2", [{ id: "member_3", userId: "usr_2", role: "owner", createdAt: START }]],
  ])
  return { organizations, members }
}

let organization = seedOrganizationState()

// ---------------------------------------------------------------------------
// In-memory state — apikey
// ---------------------------------------------------------------------------

function seedApikeyState() {
  const apikeys = new Map([
    [
      "key_1",
      {
        id: "key_1",
        name: "CI deploy key",
        keyPrefix: "ask_ci",
        scopes: ["deploy:write"],
        revoked: false,
        expiresAt: "",
        lastUsedAt: START,
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
        userId: "usr_1",
        serviceAccountId: "",
        publicKey: "pk_ask_ci",
        updatedAt: START,
      },
    ],
    [
      "key_2",
      {
        id: "key_2",
        name: "Legacy integration",
        keyPrefix: "ask_leg",
        scopes: [],
        revoked: true,
        expiresAt: "",
        lastUsedAt: "",
        createdAt: START,
        appId: "app_fixture",
        envId: "env_fixture",
        userId: "usr_2",
        serviceAccountId: "",
        publicKey: "pk_ask_leg",
        updatedAt: START,
      },
    ],
  ])
  return { apikeys }
}

let apikey = seedApikeyState()

// ---------------------------------------------------------------------------
// In-memory state — waitlist
// ---------------------------------------------------------------------------

function seedWaitlistState() {
  const statuses = ["pending", "pending", "pending", "approved", "approved", "rejected", "pending"]
  const entries = new Map(
    statuses.map((status, i) => {
      const id = `wait_${i + 1}`
      return [
        id,
        {
          id,
          email: `waitlisted-${i + 1}@example.com`,
          name: `Waitlisted ${i + 1}`,
          status,
          userId: undefined,
          ipAddress: "127.0.0.1",
          note: "",
          createdAt: new Date(Date.now() - (statuses.length - i) * 60_000).toISOString(),
          updatedAt: START,
        },
      ]
    }),
  )
  return { entries }
}

let waitlist = seedWaitlistState()

// ---------------------------------------------------------------------------
// In-memory state — consent
// ---------------------------------------------------------------------------

function seedConsentState() {
  const purposes = ["marketing", "analytics", "marketing", "essential", "analytics", "marketing", "essential"]
  const records = new Map(
    purposes.map((purpose, i) => {
      const id = `consent_${i + 1}`
      const granted = i % 3 !== 0
      return [
        id,
        {
          id,
          userId: `usr_${(i % 7) + 1}`,
          appId: "app_fixture",
          purpose,
          granted,
          version: "1.0",
          ipAddress: "127.0.0.1",
          grantedAt: granted ? START : undefined,
          revokedAt: granted ? undefined : START,
          createdAt: new Date(Date.now() - (purposes.length - i) * 60_000).toISOString(),
          updatedAt: START,
        },
      ]
    }),
  )
  return { records }
}

let consent = seedConsentState()

// ---------------------------------------------------------------------------
// In-memory state — subscription
// ---------------------------------------------------------------------------

function seedSubscriptionState() {
  const plans = new Map([
    [
      "plan_1",
      {
        id: "plan_1",
        name: "Starter",
        slug: "starter",
        description: "For small teams",
        currency: "usd",
        status: "active",
        trialDays: 14,
        features: [{ key: "seats", name: "Seats", type: "seat", limit: 5, period: "" }],
      },
    ],
    [
      "plan_2",
      {
        id: "plan_2",
        name: "Growth",
        slug: "growth",
        description: "For growing teams",
        currency: "usd",
        status: "active",
        trialDays: 14,
        features: [{ key: "seats", name: "Seats", type: "seat", limit: 25, period: "" }],
      },
    ],
    [
      "plan_3",
      {
        id: "plan_3",
        name: "Legacy",
        slug: "legacy",
        description: "No longer sold",
        currency: "usd",
        status: "archived",
        trialDays: 0,
        features: [],
      },
    ],
  ])
  // Keyed by tenantId, matching subscriptions.list's required param.
  const subscriptionsByTenant = new Map([
    [
      "tenant_1",
      [
        {
          id: "sub_1",
          tenantId: "tenant_1",
          planId: "plan_2",
          status: "active",
          currentPeriodStart: START,
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      ],
    ],
  ])
  return { plans, subscriptionsByTenant }
}

let subscription = seedSubscriptionState()

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

/**
 * forge v1.12.1's SecretResponse. An intent registered with `secret: true`
 * answers a secret once (keysmith's keys.create and keys.rotate answer a raw
 * key), so its response is never kept. A success leaves a tombstone with no
 * body instead, and a repeat with the same key answers CONFLICT without
 * running the handler, because running it again would mint a second secret.
 * The message is the dispatcher's, word for word: clients match on it.
 */
const SECRET_NOT_KEPT =
  "command already ran and its response held a secret that is not kept; send a new idempotency key to run it again"

function idempotencyStoreTombstone(key) {
  idempotencyStore.set(key, { tombstone: true, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS })
}

/**
 * forge v1.12.2's claim. A command holds its idempotency key while it runs,
 * and a repeat under the same key in that time answers CONFLICT (retryable)
 * without running. The Go dispatcher first waits up to 10 seconds for the
 * holder to finish; the fixture answers at once.
 *
 * Every command here finishes in one tick, so nothing would ever be held.
 * FIXTURE_COMMAND_HOLD_MS keeps each command's claim that long after its
 * handler ran, before the answer goes out, so a retry can land inside it.
 * After the hold a repeat gets what the store says: the cached answer, or for
 * a secret intent the CONFLICT above.
 */
const idempotencyClaims = new Set()
const STILL_RUNNING = "the same command is still running under this idempotency key; retry once it finishes"
const COMMAND_HOLD_MS = Number(process.env.FIXTURE_COMMAND_HOLD_MS ?? 0)

// ---------------------------------------------------------------------------
// core-contract intent (one query)
// ---------------------------------------------------------------------------

const coreHandlers = {
  overview: {
    kind: "query",
    handler: () => ({
      overallHealth: "healthy",
      totalServices: 5,
      healthyServices: 5,
      totalMetrics: 128,
      uptimeSeconds: Math.floor(process.uptime()),
      version: "0.0.0-fixture",
      environment: "fixture",
    }),
  },
}

// ---------------------------------------------------------------------------
// Streaming-contract intents (nine queries, five commands)
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
  "connections.kick": {
    kind: "command",
    invalidates: ["connections.list"],
    handler: (payload) => {
      const idx = streaming.connections.findIndex((c) => c.connID === payload?.connID)
      if (idx === -1) throw notFound("connection", payload?.connID)
      streaming.connections.splice(idx, 1)
      return { ok: true, id: payload.connID }
    },
  },
  "rooms.list": {
    kind: "query",
    handler: () => ({ rooms: [...streaming.rooms.values()] }),
  },
  "rooms.create": {
    kind: "command",
    invalidates: ["rooms.list"],
    handler: (payload) => {
      const id = nextId("room", "room")
      const now = new Date().toISOString()
      const room = {
        id,
        name: payload?.name ?? "",
        description: payload?.description ?? "",
        owner: payload?.owner ?? "",
        members: 1,
        private: Boolean(payload?.private),
        archived: false,
        created: now,
        updated: now,
      }
      streaming.rooms.set(id, room)
      streaming.roomMembers.set(id, [
        { userID: payload?.owner ?? "", role: "owner", joinedAt: now, permissions: ["*"] },
      ])
      streaming.moderation.set(id, [])
      return { ok: true, id }
    },
  },
  "rooms.delete": {
    kind: "command",
    invalidates: ["rooms.list"],
    handler: (payload) => {
      const id = payload?.id
      if (!streaming.rooms.has(id)) throw notFound("room", id)
      streaming.rooms.delete(id)
      streaming.roomMembers.delete(id)
      streaming.moderation.delete(id)
      return { ok: true, id }
    },
  },
  "rooms.detail": {
    kind: "query",
    handler: (params) => {
      const room = streaming.rooms.get(params?.id)
      if (!room) throw notFound("room", params?.id)
      return room
    },
  },
  "rooms.members": {
    kind: "query",
    handler: (params) => {
      if (!streaming.rooms.has(params?.id)) throw notFound("room", params?.id)
      return { members: streaming.roomMembers.get(params.id) ?? [] }
    },
  },
  "rooms.moderation": {
    kind: "query",
    handler: (params) => {
      if (!streaming.rooms.has(params?.id)) throw notFound("room", params?.id)
      return { entries: streaming.moderation.get(params.id) ?? [] }
    },
  },
  "rooms.send-message": {
    kind: "command",
    // No corresponding read exists (no messages.list intent this wave), so
    // there is nothing meaningful to invalidate — matching auth.logout's
    // existing precedent of a command with no `invalidates`.
    handler: (payload) => {
      if (!streaming.rooms.has(payload?.roomID)) throw notFound("room", payload?.roomID)
      return { ok: true, id: `msg_${Date.now()}` }
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
  "presence.set": {
    kind: "command",
    invalidates: ["presence.list"],
    handler: (payload) => {
      const entry = streaming.presence.find((p) => p.userID === payload?.userID)
      if (!entry) throw notFound("presence", payload?.userID)
      entry.status = payload?.status ?? entry.status
      entry.lastSeen = new Date().toISOString()
      return { ok: true, id: payload.userID }
    },
  },
  config: {
    kind: "query",
    handler: () => streaming.config,
  },
}

// ---------------------------------------------------------------------------
// Auth intents
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

function deviceSummary(d) {
  return { ...d }
}

function roleSummary(r) {
  return { id: r.id, name: r.name, slug: r.slug, description: r.description, createdAt: r.createdAt }
}

function appSummary(a) {
  return { id: a.id, name: a.name, slug: a.slug, isPlatform: a.isPlatform, createdAt: a.createdAt }
}

function envSummary(e) {
  return { id: e.id, name: e.name, slug: e.slug, type: e.type, isDefault: e.isDefault, createdAt: e.createdAt }
}

/** Projects to SwitcherApp (handlers_context.go): id, name, slug, logo?, isPlatform. */
function switcherApp(a) {
  const out = { id: a.id, name: a.name, slug: a.slug }
  if (a.logo) out.logo = a.logo
  out.isPlatform = a.isPlatform
  return out
}

/** Projects to SwitcherEnv (handlers_context.go): id, name, slug, type?, isDefault. */
function switcherEnv(e) {
  const out = { id: e.id, name: e.name, slug: e.slug }
  if (e.type) out.type = e.type
  out.isDefault = e.isDefault
  return out
}

function webhookSummary(w) {
  return { id: w.id, url: w.url, events: w.events, active: w.active, createdAt: w.createdAt }
}

/** Applies pointer-semantics fields (present key = set, absent key = leave
 * unchanged) from `payload` onto `target`, for the given field names. */
function applyPointerFields(target, payload, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(payload ?? {}, field)) {
      target[field] = payload[field]
    }
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
  "auth.featureToggles": {
    kind: "query",
    handler: () => ({ toggles: [...auth.featureToggles.values()] }),
  },
  "auth.toggleFeature": {
    kind: "command",
    invalidates: ["auth.featureToggles"],
    handler: (payload) => {
      const toggle = auth.featureToggles.get(payload?.key)
      if (!toggle) throw notFound("feature", payload?.key)
      toggle.enabled = Boolean(payload?.enabled)
      return { ok: true, id: toggle.key }
    },
  },
  "auth.dynamicConfig": {
    kind: "query",
    handler: () => ({
      title: "Create your account",
      description: "Fields collected on the public signup form.",
      fields: auth.formConfigs.signupFields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        order: f.order,
      })),
      active: auth.formConfigs.signupActive,
    }),
  },

  /**
   * Served because the Go contract serves it, not because anything calls it.
   *
   * The React dashboard deliberately offers no control that reaches this: it
   * creates a real account and writes that account's session cookie over the
   * caller's, so an admin pressing it would be signed out as somebody else.
   * That is a decision about what to put on an admin page, and it is not this
   * server's decision to make. A fixture that quietly omits an intent the
   * contract declares is a fixture that lies about the contract, and the next
   * person to build against it finds out the hard way.
   */
  "auth.dynamicRegister": {
    kind: "command",
    handler: (payload) => {
      const id = `usr_${auth.users.size + 1}`
      auth.users.set(id, {
        id,
        email: payload?.email ?? "",
        emailVerified: false,
        firstName: payload?.name ?? "",
        lastName: "",
        username: payload?.email ?? "",
        banned: false,
        createdAt: new Date().toISOString(),
      })
      return { data: { ok: true, subject: id }, invalidates: ["users.list"] }
    },
  },

  // -- users -----------------------------------------------------------
  "users.list": {
    kind: "query",
    handler: (params) => {
      let list = [...auth.users.values()]
      if (params?.email) list = list.filter((u) => u.email.includes(params.email))
      const { page, nextCursor, total } = paginateCursor(list, params, 5)
      return { users: page.map(userSummary), nextCursor, total }
    },
  },
  "users.detail": {
    kind: "query",
    handler: (params) => {
      const u = auth.users.get(params?.id)
      if (!u) throw notFound("user", params?.id)
      return u
    },
  },
  "users.create": {
    kind: "command",
    invalidates: ["users.list"],
    handler: (payload) => {
      const id = nextId("user", "usr")
      const now = new Date().toISOString()
      const u = {
        id,
        email: payload?.email ?? "",
        emailVerified: false,
        firstName: payload?.firstName ?? "",
        lastName: payload?.lastName ?? "",
        username: payload?.username ?? "",
        banned: false,
        createdAt: now,
        displayName: [payload?.firstName, payload?.lastName].filter(Boolean).join(" "),
        phone: "",
        phoneVerified: false,
        image: "",
        banReason: "",
        banExpiresAt: "",
        passwordChangedAt: now,
        updatedAt: now,
        appId: "app_fixture",
        envId: "env_fixture",
      }
      auth.users.set(id, u)
      return { ok: true, id }
    },
  },
  "users.update": {
    kind: "command",
    invalidates: ["users.list", "users.detail"],
    handler: (payload) => {
      const u = auth.users.get(payload?.id)
      if (!u) throw notFound("user", payload?.id)
      applyPointerFields(u, payload, ["firstName", "lastName", "username", "emailVerified"])
      u.displayName = [u.firstName, u.lastName].filter(Boolean).join(" ")
      u.updatedAt = new Date().toISOString()
      return { ok: true, id: u.id }
    },
  },
  "users.ban": {
    kind: "command",
    invalidates: ["users.list", "users.detail"],
    handler: (payload) => {
      const u = auth.users.get(payload?.id)
      if (!u) throw notFound("user", payload?.id)
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
      if (!u) throw notFound("user", payload?.id)
      u.banned = false
      u.banReason = ""
      u.banExpiresAt = ""
      u.updatedAt = new Date().toISOString()
      return { ok: true, id: u.id }
    },
  },
  "users.delete": {
    kind: "command",
    invalidates: ["users.list"],
    handler: (payload) => {
      if (!auth.users.has(payload?.id)) throw notFound("user", payload?.id)
      auth.users.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },

  // -- sessions ----------------------------------------------------------
  "sessions.list": {
    kind: "query",
    handler: (params) => {
      let list = [...auth.sessions.values()]
      if (params?.userId) list = list.filter((s) => s.userId === params.userId)
      const limit = params?.limit && params.limit > 0 ? params.limit : list.length
      return { sessions: list.slice(0, limit).map(sessionSummary) }
    },
  },
  "sessions.detail": {
    kind: "query",
    handler: (params) => {
      const s = auth.sessions.get(params?.id)
      if (!s) throw notFound("session", params?.id)
      return s
    },
  },
  "sessions.revoke": {
    kind: "command",
    invalidates: ["sessions.list"],
    handler: (payload) => {
      const id = payload?.id
      if (!auth.sessions.has(id)) throw notFound("session", id)
      auth.sessions.delete(id)
      return { ok: true, id }
    },
  },
  "sessions.bulkRevoke": {
    kind: "command",
    invalidates: ["sessions.list"],
    handler: (payload) => {
      const userId = payload?.userId
      let count = 0
      for (const [id, s] of auth.sessions) {
        if (s.userId === userId) {
          auth.sessions.delete(id)
          count += 1
        }
      }
      return { ok: true, count }
    },
  },

  // -- devices -------------------------------------------------------------
  "devices.list": {
    kind: "query",
    handler: (params) => {
      let list = [...auth.devices.values()]
      if (params?.userId) list = list.filter((d) => d.userId === params.userId)
      const limit = params?.limit && params.limit > 0 ? params.limit : list.length
      return { devices: list.slice(0, limit).map(deviceSummary) }
    },
  },
  "devices.detail": {
    kind: "query",
    handler: (params) => {
      const d = auth.devices.get(params?.id)
      if (!d) throw notFound("device", params?.id)
      return d
    },
  },
  "devices.trust": {
    kind: "command",
    invalidates: ["devices.list", "devices.detail"],
    handler: (payload) => {
      const d = auth.devices.get(payload?.id)
      if (!d) throw notFound("device", payload?.id)
      d.trusted = true
      return { ok: true, id: d.id }
    },
  },
  "devices.delete": {
    kind: "command",
    invalidates: ["devices.list"],
    handler: (payload) => {
      if (!auth.devices.has(payload?.id)) throw notFound("device", payload?.id)
      auth.devices.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },

  // -- roles -----------------------------------------------------------
  "roles.list": {
    kind: "query",
    handler: () => ({ roles: [...auth.roles.values()].map(roleSummary) }),
  },
  "roles.detail": {
    kind: "query",
    handler: (params) => {
      const r = auth.roles.get(params?.id)
      if (!r) throw notFound("role", params?.id)
      return r
    },
  },
  "roles.create": {
    kind: "command",
    invalidates: ["roles.list"],
    handler: (payload) => {
      const id = nextId("role", "role")
      const now = new Date().toISOString()
      auth.roles.set(id, {
        id,
        name: payload?.name ?? "",
        slug: payload?.slug ?? "",
        description: payload?.description ?? "",
        createdAt: now,
        appId: "app_fixture",
        envId: "env_fixture",
        parentId: "",
        permissions: [],
        updatedAt: now,
      })
      return { ok: true, id }
    },
  },
  "roles.update": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail"],
    handler: (payload) => {
      const r = auth.roles.get(payload?.id)
      if (!r) throw notFound("role", payload?.id)
      applyPointerFields(r, payload, ["name", "description"])
      r.updatedAt = new Date().toISOString()
      return { ok: true, id: r.id }
    },
  },
  "roles.delete": {
    kind: "command",
    invalidates: ["roles.list"],
    handler: (payload) => {
      if (!auth.roles.has(payload?.id)) throw notFound("role", payload?.id)
      auth.roles.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },
  "roles.assign": {
    kind: "command",
    handler: (payload) => {
      if (!auth.roles.has(payload?.roleId)) throw notFound("role", payload?.roleId)
      if (!auth.users.has(payload?.userId)) throw notFound("user", payload?.userId)
      return { ok: true }
    },
  },
  "roles.unassign": {
    kind: "command",
    handler: (payload) => {
      if (!auth.roles.has(payload?.roleId)) throw notFound("role", payload?.roleId)
      if (!auth.users.has(payload?.userId)) throw notFound("user", payload?.userId)
      return { ok: true }
    },
  },

  // -- apps -----------------------------------------------------------
  "apps.list": {
    kind: "query",
    handler: () => ({ apps: [...auth.apps.values()].map(appSummary) }),
  },
  "apps.detail": {
    kind: "query",
    handler: (params) => {
      const a = auth.apps.get(params?.id)
      if (!a) throw notFound("app", params?.id)
      return a
    },
  },
  "apps.create": {
    kind: "command",
    invalidates: ["apps.list"],
    handler: (payload) => {
      const id = nextId("app", "app")
      const now = new Date().toISOString()
      auth.apps.set(id, {
        id,
        name: payload?.name ?? "",
        slug: payload?.slug ?? "",
        isPlatform: false,
        createdAt: now,
        logo: payload?.logo ?? "",
        publishableKey: `pk_fixture_${id}`,
        metadata: {},
        updatedAt: now,
      })
      return { ok: true, id }
    },
  },
  "apps.update": {
    kind: "command",
    invalidates: ["apps.list", "apps.detail"],
    handler: (payload) => {
      const a = auth.apps.get(payload?.id)
      if (!a) throw notFound("app", payload?.id)
      applyPointerFields(a, payload, ["name", "slug", "logo"])
      a.updatedAt = new Date().toISOString()
      return { ok: true, id: a.id }
    },
  },
  "apps.delete": {
    kind: "command",
    invalidates: ["apps.list"],
    handler: (payload) => {
      if (!auth.apps.has(payload?.id)) throw notFound("app", payload?.id)
      auth.apps.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },

  // -- app/environment switcher (handlers_context.go) --------------------
  //
  // Backs ContextSwitchers.tsx's two dimensions, both of which read this
  // one query (`apps.context`) and each send their own command. See the
  // module-state block near the top of this file for what `currentAppId`
  // / `currentEnvId` mean and why they live outside `auth`.
  "apps.context": {
    kind: "query",
    handler: () => {
      const availableApps = [...auth.apps.values()].map(switcherApp)

      // Falls back to the platform app when nothing has been switched yet —
      // the same fallback AppIDFromPrincipal applies when the claim/cookie
      // is missing.
      const resolvedAppId = currentAppId ?? platformAppId()
      let currentApp
      if (resolvedAppId) {
        const a = auth.apps.get(resolvedAppId)
        if (a) currentApp = switcherApp(a)
      }

      // availableEnvs is scoped to the CURRENT app, not every environment —
      // that's what lets a switch away from an app prove the old app's env
      // doesn't leak into the new app's list.
      let availableEnvs = []
      let currentEnv
      if (resolvedAppId) {
        availableEnvs = [...auth.environments.values()]
          .filter((e) => e.appId === resolvedAppId)
          .map(switcherEnv)
        if (currentEnvId) {
          currentEnv = availableEnvs.find((e) => e.id === currentEnvId)
        }
        if (!currentEnv) {
          currentEnv = availableEnvs.find((e) => e.isDefault)
        }
      }

      return { currentApp, currentEnv, availableApps, availableEnvs }
    },
  },
  "apps.switch": {
    kind: "command",
    invalidates: ["apps.context"],
    handler: (payload) => {
      const raw = String(payload?.appId ?? "").trim()
      if (raw === "") {
        // Empty string clears the selection back to the default (the
        // platform app), per the Go comment on AppSwitchInput.
        currentAppId = null
        currentEnvId = null
        return { ok: true }
      }
      if (!auth.apps.has(raw)) throw notFound("app", raw)
      currentAppId = raw
      // The old env belongs to the old app. Rather than let a stale envId
      // silently carry over (or silently re-resolve to a same-slug env in
      // the new app, which the real contract has no concept of), clear it —
      // matching appsSwitchHandler's clearSwitcherCookie(envSwitcherCookie)
      // call. apps.context re-resolves it to the new app's default env on
      // the next read.
      currentEnvId = null
      return { ok: true }
    },
  },

  // -- environments -----------------------------------------------------
  "environments.list": {
    kind: "query",
    handler: () => ({ environments: [...auth.environments.values()].map(envSummary) }),
  },
  "environments.detail": {
    kind: "query",
    handler: (params) => {
      const e = auth.environments.get(params?.id)
      if (!e) throw notFound("environment", params?.id)
      return e
    },
  },
  "environments.create": {
    kind: "command",
    invalidates: ["environments.list"],
    handler: (payload) => {
      const id = nextId("env", "env")
      const now = new Date().toISOString()
      auth.environments.set(id, {
        id,
        name: payload?.name ?? "",
        slug: payload?.slug ?? "",
        type: payload?.type ?? "development",
        isDefault: false,
        createdAt: now,
        // The app the switcher currently has selected, not a constant. A
        // hardcoded id put every new environment under an app that does not
        // exist, so it never appeared in any app's environment list.
        appId: currentAppId ?? platformAppId(),
        color: payload?.color ?? "",
        description: payload?.description ?? "",
        clonedFrom: "",
        metadata: {},
        updatedAt: now,
      })
      return { ok: true, id }
    },
  },
  "environments.update": {
    kind: "command",
    invalidates: ["environments.list", "environments.detail"],
    handler: (payload) => {
      const e = auth.environments.get(payload?.id)
      if (!e) throw notFound("environment", payload?.id)
      applyPointerFields(e, payload, ["name", "description", "color"])
      e.updatedAt = new Date().toISOString()
      return { ok: true, id: e.id }
    },
  },
  "environments.delete": {
    kind: "command",
    invalidates: ["environments.list"],
    handler: (payload) => {
      if (!auth.environments.has(payload?.id)) throw notFound("environment", payload?.id)
      auth.environments.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },
  "environments.clone": {
    kind: "command",
    invalidates: ["environments.list"],
    handler: (payload) => {
      const src = auth.environments.get(payload?.id)
      if (!src) throw notFound("environment", payload?.id)
      const id = nextId("env", "env")
      const now = new Date().toISOString()
      auth.environments.set(id, {
        ...src,
        id,
        name: payload?.name ?? `${src.name} copy`,
        slug: payload?.slug ?? `${src.slug}-copy`,
        isDefault: false,
        createdAt: now,
        clonedFrom: src.id,
        updatedAt: now,
      })
      return { ok: true, id }
    },
  },
  "environments.setDefault": {
    kind: "command",
    invalidates: ["environments.list"],
    // Scoped to the target's own app. It used to clear `isDefault` across
    // every environment of every app, which left the whole fixture with a
    // single default between them: switch to another app and its environment
    // list claimed no default at all. That was invisible until apps.context
    // started answering per-app environments and something read them.
    handler: (payload) => {
      const e = auth.environments.get(payload?.id)
      if (!e) throw notFound("environment", payload?.id)
      for (const env of auth.environments.values()) {
        if (env.appId !== e.appId) continue
        env.isDefault = env.id === e.id
      }
      return { ok: true, id: e.id }
    },
  },
  "environments.switch": {
    kind: "command",
    invalidates: ["apps.context"],
    handler: (payload) => {
      const raw = String(payload?.envId ?? "").trim()
      if (raw === "") {
        // Empty string clears back to the current app's default env.
        currentEnvId = null
        return { ok: true }
      }
      const env = auth.environments.get(raw)
      if (!env) throw notFound("environment", raw)
      // Guards against a stale envId from before an app switch, matching
      // environmentsSwitchHandler's "does not belong to the current app"
      // check in handlers_context.go.
      const resolvedAppId = currentAppId ?? platformAppId()
      if (resolvedAppId && env.appId !== resolvedAppId) {
        throw new FixtureError(400, CODE.BAD_REQUEST, "environment does not belong to the current app")
      }
      currentEnvId = raw
      return { ok: true }
    },
  },

  // -- webhooks -----------------------------------------------------------
  "webhooks.list": {
    kind: "query",
    handler: () => ({ webhooks: [...auth.webhooks.values()].map(webhookSummary) }),
  },
  "webhooks.detail": {
    kind: "query",
    handler: (params) => {
      const w = auth.webhooks.get(params?.id)
      if (!w) throw notFound("webhook", params?.id)
      return w
    },
  },
  "webhooks.create": {
    kind: "command",
    invalidates: ["webhooks.list"],
    handler: (payload) => {
      const id = nextId("webhook", "webhook")
      const now = new Date().toISOString()
      auth.webhooks.set(id, {
        id,
        url: payload?.url ?? "",
        events: payload?.events ?? [],
        active: true,
        createdAt: now,
        appId: "app_fixture",
        envId: "env_fixture",
        updatedAt: now,
      })
      return { ok: true, id }
    },
  },
  "webhooks.update": {
    kind: "command",
    invalidates: ["webhooks.list", "webhooks.detail"],
    handler: (payload) => {
      const w = auth.webhooks.get(payload?.id)
      if (!w) throw notFound("webhook", payload?.id)
      applyPointerFields(w, payload, ["url", "events", "active"])
      w.updatedAt = new Date().toISOString()
      return { ok: true, id: w.id }
    },
  },
  "webhooks.delete": {
    kind: "command",
    invalidates: ["webhooks.list"],
    handler: (payload) => {
      if (!auth.webhooks.has(payload?.id)) throw notFound("webhook", payload?.id)
      auth.webhooks.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },

  // -- credentials, overview, formConfigs ----------------------------------
  "credentials.detail": {
    kind: "query",
    handler: () => ({
      appId: "app_1",
      appName: "Platform",
      appSlug: "platform",
      publishableKey: "pk_fixture_platform",
      envId: "env_1",
      envName: "Production",
      envSlug: "production",
      isPlatform: true,
    }),
  },
  "overview.stats": {
    kind: "query",
    handler: () => ({
      users: auth.users.size,
      sessions: auth.sessions.size,
      devices: auth.devices.size,
      plugins: 27,
    }),
  },
  "overview.recentSignups": {
    kind: "query",
    handler: (params) => {
      const limit = params?.limit && params.limit > 0 ? params.limit : 10
      const list = [...auth.users.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      return { users: list.slice(0, limit).map(userSummary) }
    },
  },
  "formConfigs.list": {
    kind: "query",
    handler: () => ({ formConfigs: auth.formConfigs.list }),
  },
  "formConfigs.signup": {
    kind: "query",
    handler: () => ({
      appId: "app_fixture",
      fields: auth.formConfigs.signupFields,
      updatedAt: auth.formConfigs.signupUpdatedAt,
    }),
  },
  "formConfigs.saveSignup": {
    kind: "command",
    invalidates: ["formConfigs.signup", "formConfigs.list"],
    handler: (payload) => {
      auth.formConfigs.signupFields = payload?.fields ?? []
      auth.formConfigs.signupActive = Boolean(payload?.active)
      auth.formConfigs.signupUpdatedAt = new Date().toISOString()
      if (auth.formConfigs.list[0]) {
        auth.formConfigs.list[0].version += 1
        auth.formConfigs.list[0].active = auth.formConfigs.signupActive
      }
      return { ok: true }
    },
  },
  "formConfigs.deleteSignup": {
    kind: "command",
    invalidates: ["formConfigs.signup", "formConfigs.list"],
    handler: () => {
      auth.formConfigs.signupFields = []
      auth.formConfigs.signupActive = false
      auth.formConfigs.signupUpdatedAt = new Date().toISOString()
      if (auth.formConfigs.list[0]) auth.formConfigs.list[0].active = false
      return { ok: true }
    },
  },

  // -- settings (also reached by the 18 settings-only sub-plugins via their
  // hostIntents allowlist: settings.namespace, settings.update,
  // settings.enforce, settings.unenforce) --------------------------------
  "settings.namespaces": {
    kind: "query",
    handler: () => ({
      namespaces: [...settingsData.entries()].map(([name, entry]) => ({
        name,
        displayName: entry.displayName,
        settingCount: settingsFieldCount(entry),
      })),
      context: { appId: "app_fixture" },
    }),
  },
  "settings.namespace": {
    kind: "query",
    handler: (params) => {
      const namespace = params?.namespace
      if (!namespace) throw new FixtureError(400, CODE.BAD_REQUEST, "namespace is required")
      const entry = settingsNamespaceFor(namespace)
      return {
        namespace,
        displayName: entry.displayName,
        scope: params?.scope ?? "app",
        categories: entry.categories,
      }
    },
  },
  "settings.update": {
    kind: "command",
    invalidates: ["settings.namespace", "settings.namespaces"],
    handler: (payload) => {
      // The fixture does not thread namespace through settings.update's
      // payload (neither does the real contract — it resolves the field
      // from the key), so this scans every namespace for a matching key.
      for (const [, entry] of settingsData) {
        for (const category of entry.categories) {
          const field = category.settings.find((s) => s.key === payload?.key)
          if (field) {
            field.effectiveValue = field.sensitive ? "***" : payload?.value
            field.isOverridden = true
            return { ok: true }
          }
        }
      }
      // Unknown key: still ack, matching a server that persists a setting it
      // has never seen a manifest for.
      return { ok: true }
    },
  },
  "settings.enforce": {
    kind: "command",
    invalidates: ["settings.namespace", "settings.namespaces"],
    handler: (payload) => {
      const field = findFieldAnyNamespace(payload?.key)
      if (field) {
        field.isEnforced = true
        field.canOverride = false
        field.effectiveValue = field.sensitive ? "***" : payload?.value
      }
      return { ok: true }
    },
  },
  "settings.unenforce": {
    kind: "command",
    invalidates: ["settings.namespace", "settings.namespaces"],
    handler: (payload) => {
      const field = findFieldAnyNamespace(payload?.key)
      if (field) {
        field.isEnforced = false
        field.canOverride = true
      }
      return { ok: true }
    },
  },
}

function findFieldAnyNamespace(key) {
  for (const [, entry] of settingsData) {
    for (const category of entry.categories) {
      const field = category.settings.find((s) => s.key === key)
      if (field) return field
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// organization intents (its own contributor, "organization")
// ---------------------------------------------------------------------------

function orgSummary(o) {
  return { id: o.id, name: o.name, slug: o.slug, createdAt: o.createdAt }
}

const organizationHandlers = {
  "orgs.list": {
    kind: "query",
    handler: () => ({ organizations: [...organization.organizations.values()].map(orgSummary) }),
  },
  "orgs.detail": {
    kind: "query",
    handler: (params) => {
      const o = organization.organizations.get(params?.id)
      if (!o) throw notFound("organization", params?.id)
      return o
    },
  },
  "orgs.create": {
    kind: "command",
    invalidates: ["orgs.list"],
    handler: (payload) => {
      const id = nextId("org", "org")
      const now = new Date().toISOString()
      organization.organizations.set(id, {
        id,
        name: payload?.name ?? "",
        slug: payload?.slug ?? "",
        createdAt: now,
        appId: "app_fixture",
        logo: payload?.logo ?? "",
        metadata: {},
        updatedAt: now,
      })
      organization.members.set(id, [])
      return { ok: true, id }
    },
  },
  "orgs.update": {
    kind: "command",
    invalidates: ["orgs.list", "orgs.detail"],
    handler: (payload) => {
      const o = organization.organizations.get(payload?.id)
      if (!o) throw notFound("organization", payload?.id)
      applyPointerFields(o, payload, ["name", "logo"])
      o.updatedAt = new Date().toISOString()
      return { ok: true, id: o.id }
    },
  },
  "orgs.delete": {
    kind: "command",
    invalidates: ["orgs.list"],
    handler: (payload) => {
      if (!organization.organizations.has(payload?.id)) throw notFound("organization", payload?.id)
      organization.organizations.delete(payload.id)
      organization.members.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },
  "orgs.members": {
    kind: "query",
    handler: (params) => {
      if (!organization.organizations.has(params?.orgId)) throw notFound("organization", params?.orgId)
      return { members: organization.members.get(params.orgId) ?? [] }
    },
  },
  "orgs.removeMember": {
    kind: "command",
    invalidates: ["orgs.members"],
    handler: (payload) => {
      for (const members of organization.members.values()) {
        const idx = members.findIndex((m) => m.id === payload?.id)
        if (idx !== -1) {
          members.splice(idx, 1)
          return { ok: true, id: payload.id }
        }
      }
      throw notFound("member", payload?.id)
    },
  },
}

// ---------------------------------------------------------------------------
// apikey intents (its own contributor, "apikey")
// ---------------------------------------------------------------------------

function apikeySummary(k) {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    scopes: k.scopes,
    revoked: k.revoked,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }
}

const apikeyHandlers = {
  "apikeys.list": {
    kind: "query",
    handler: () => ({ apiKeys: [...apikey.apikeys.values()].map(apikeySummary) }),
  },
  "apikeys.detail": {
    kind: "query",
    handler: (params) => {
      const k = apikey.apikeys.get(params?.id)
      if (!k) throw notFound("apikey", params?.id)
      // apikeys.detail is APIKeyDetail: no secret field, ever — and there
      // never was one on `k` to begin with, since apikeys.create never
      // stores the plaintext, only hands it back once on the wire.
      return { ...k }
    },
  },
  "apikeys.create": {
    kind: "command",
    invalidates: ["apikeys.list"],
    handler: (payload) => {
      const id = nextId("apikey", "key")
      const now = new Date().toISOString()
      const secret = `ask_${randomBytes(16).toString("hex")}`
      const keyPrefix = secret.slice(0, 12)
      apikey.apikeys.set(id, {
        id,
        name: payload?.name ?? "",
        keyPrefix,
        scopes: payload?.scopes ?? [],
        revoked: false,
        expiresAt: "",
        lastUsedAt: "",
        createdAt: now,
        appId: "app_fixture",
        envId: "env_fixture",
        userId: payload?.userId ?? "",
        serviceAccountId: "",
        publicKey: `pk_${id}`,
        updatedAt: now,
      })
      // The ONLY response anywhere carrying the plaintext secret.
      return { ok: true, id, keyPrefix, secret }
    },
  },
  "apikeys.revoke": {
    kind: "command",
    invalidates: ["apikeys.list", "apikeys.detail"],
    handler: (payload) => {
      const k = apikey.apikeys.get(payload?.id)
      if (!k) throw notFound("apikey", payload?.id)
      k.revoked = true
      k.updatedAt = new Date().toISOString()
      return { ok: true, id: k.id }
    },
  },
}

// ---------------------------------------------------------------------------
// waitlist intents (its own contributor, "waitlist")
// ---------------------------------------------------------------------------

const waitlistHandlers = {
  "waitlist.list": {
    kind: "query",
    handler: (params) => {
      let list = [...waitlist.entries.values()]
      if (params?.email) list = list.filter((e) => e.email.includes(params.email))
      if (params?.status) list = list.filter((e) => e.status === params.status)
      const { page, nextCursor, total } = paginateCursor(list, params, 5)
      return { entries: page, total, nextCursor }
    },
  },
  "waitlist.detail": {
    kind: "query",
    handler: (params) => {
      const e = waitlist.entries.get(params?.id)
      if (!e) throw notFound("waitlist entry", params?.id)
      return e
    },
  },
  "waitlist.approve": {
    kind: "command",
    invalidates: ["waitlist.list", "waitlist.counts"],
    handler: (payload) => {
      const e = waitlist.entries.get(payload?.id)
      if (!e) throw notFound("waitlist entry", payload?.id)
      e.status = "approved"
      e.note = payload?.note ?? e.note
      e.updatedAt = new Date().toISOString()
      return { ok: true, id: e.id }
    },
  },
  "waitlist.reject": {
    kind: "command",
    invalidates: ["waitlist.list", "waitlist.counts"],
    handler: (payload) => {
      const e = waitlist.entries.get(payload?.id)
      if (!e) throw notFound("waitlist entry", payload?.id)
      e.status = "rejected"
      e.note = payload?.note ?? e.note
      e.updatedAt = new Date().toISOString()
      return { ok: true, id: e.id }
    },
  },
  "waitlist.delete": {
    kind: "command",
    invalidates: ["waitlist.list", "waitlist.counts"],
    handler: (payload) => {
      if (!waitlist.entries.has(payload?.id)) throw notFound("waitlist entry", payload?.id)
      waitlist.entries.delete(payload.id)
      return { ok: true, id: payload.id }
    },
  },
  "waitlist.counts": {
    kind: "query",
    handler: () => {
      const list = [...waitlist.entries.values()]
      return {
        pending: list.filter((e) => e.status === "pending").length,
        approved: list.filter((e) => e.status === "approved").length,
        rejected: list.filter((e) => e.status === "rejected").length,
      }
    },
  },
}

// ---------------------------------------------------------------------------
// consent intents (its own contributor, "consent")
// ---------------------------------------------------------------------------

function consentListHandler(params) {
  let list = [...consent.records.values()]
  if (params?.userId) list = list.filter((c) => c.userId === params.userId)
  if (params?.purpose) list = list.filter((c) => c.purpose === params.purpose)
  const { page, nextCursor } = paginateCursor(list, params, 5)
  return { items: page, nextCursor }
}

const consentHandlers = {
  // consent.list and consent.userConsents are wire-identical in the Go
  // contract, sharing one handler — matched here deliberately.
  "consent.list": { kind: "query", handler: consentListHandler },
  "consent.userConsents": { kind: "query", handler: consentListHandler },
  "consent.grant": {
    kind: "command",
    invalidates: ["consent.list", "consent.userConsents"],
    handler: (payload) => {
      const id = nextId("consent", "consent")
      const now = new Date().toISOString()
      consent.records.set(id, {
        id,
        userId: payload?.userId ?? "",
        appId: "app_fixture",
        purpose: payload?.purpose ?? "",
        granted: true,
        version: payload?.version ?? "",
        ipAddress: payload?.ipAddress ?? "",
        grantedAt: now,
        revokedAt: undefined,
        createdAt: now,
        updatedAt: now,
      })
      return { ok: true, id }
    },
  },
  "consent.revoke": {
    kind: "command",
    invalidates: ["consent.list", "consent.userConsents"],
    handler: (payload) => {
      // Keyed by the (userId, purpose) composite, never by id.
      const record = [...consent.records.values()].find(
        (c) => c.userId === payload?.userId && c.purpose === payload?.purpose,
      )
      if (!record) throw new FixtureError(404, CODE.NOT_FOUND, "consent record not found")
      record.granted = false
      record.revokedAt = new Date().toISOString()
      record.updatedAt = record.revokedAt
      return { ok: true }
    },
  },
}

// ---------------------------------------------------------------------------
// subscription intents (its own contributor, "subscription")
// ---------------------------------------------------------------------------

function planSummary(p) {
  return { id: p.id, name: p.name, slug: p.slug, description: p.description, currency: p.currency, status: p.status, trialDays: p.trialDays }
}

const subscriptionHandlers = {
  "plans.list": {
    kind: "query",
    handler: () => ({ plans: [...subscription.plans.values()].map(planSummary) }),
  },
  "plans.detail": {
    kind: "query",
    handler: (params) => {
      const p = subscription.plans.get(params?.id)
      if (!p) throw notFound("plan", params?.id)
      return { ...planSummary(p), features: p.features }
    },
  },
  "plans.archive": {
    kind: "command",
    invalidates: ["plans.list", "plans.detail"],
    handler: (payload) => {
      const p = subscription.plans.get(payload?.id)
      if (!p) throw notFound("plan", payload?.id)
      p.status = "archived"
      return { ok: true, id: p.id }
    },
  },
  "plans.activate": {
    kind: "command",
    invalidates: ["plans.list", "plans.detail"],
    handler: (payload) => {
      const p = subscription.plans.get(payload?.id)
      if (!p) throw notFound("plan", payload?.id)
      p.status = "active"
      return { ok: true, id: p.id }
    },
  },
  "subscriptions.list": {
    kind: "query",
    handler: (params) => {
      // Required tenantId. An empty/missing one short-circuits to an empty
      // list without error — do not make this forgiving.
      if (!params?.tenantId) return { subscriptions: [] }
      return { subscriptions: subscription.subscriptionsByTenant.get(params.tenantId) ?? [] }
    },
  },
}

// ---------------------------------------------------------------------------
// password intent (its own contributor, "password")
// ---------------------------------------------------------------------------

const passwordHandlers = {
  "password.policy": {
    kind: "query",
    handler: () => ({
      minLength: 10,
      requireSpecial: true,
      // Hardcoded in the real handler too (hashAlgorithm() ignores the
      // engine argument) — matching that rather than "fixing" it here.
      hashAlgorithm: "argon2id",
    }),
  },
}

// ---------------------------------------------------------------------------
// The eighteen settings-only sub-plugins. Copied from
// packages/plugin-authsome/src/sub/settings-only.tsx's SETTINGS_ONLY table
// (itself copied from each plugin's contract/manifest.yaml) — extension name
// is the join key, and every one of these declares `intents: []` in Go: all
// reads/writes flow through auth's settings.namespace/settings.update via
// the sub-plugin's hostIntents allowlist, never through an intent of their
// own.
// ---------------------------------------------------------------------------

const SETTINGS_ONLY_EXTENSIONS = [
  "riskengine",
  "anomaly",
  "geoip",
  "geofence",
  "impossibletravel",
  "ipreputation",
  "vpndetect",
  "deviceverify",
  "email",
  "phone",
  "magiclink",
  "mfa",
  "passkey",
  "social",
  "oauth2provider",
  "scim",
  "sso",
  "notification",
]

// ---------------------------------------------------------------------------
// relay: webhook endpoints (packages/plugin-relay)
// ---------------------------------------------------------------------------
//
// Mirrors relay/extension/contract. Field names are the Go JSON tags. Where the
// real server behaves unhelpfully the fixture does too, so a page that relies
// on something the server does not do fails here and not in production:
//
//   - validation errors carry details.field in snake_case (the Go
//     ValidationError field), even though the inputs are camelCase;
//   - an id without the ep_ prefix is BAD_REQUEST, not NOT_FOUND;
//   - an empty or missing tenantId lists every tenant (ListEndpoints since
//     the list-endpoints fix);
//   - glob matching is relay's catalog.Match, segment for segment, so
//     "invoice.*" does not match "invoice.created.v2".

function seedRelayState() {
  return {
    endpoints: [
      {
        id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x",
        tenantId: "acme",
        url: "https://acme.example/webhooks/relay",
        description: "Production receiver",
        eventTypes: ["invoice.*", "customer.created"],
        enabled: true,
        rateLimit: 0,
        signed: true,
        headers: {},
        metadata: {},
        createdAt: "2026-08-14T09:12:00Z",
        updatedAt: "2026-09-02T16:40:00Z",
      },
      {
        id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2y",
        tenantId: "acme",
        url: "https://acme.example/webhooks/staging",
        description: "",
        eventTypes: ["*"],
        enabled: false,
        rateLimit: 10,
        signed: true,
        headers: {},
        metadata: {},
        createdAt: "2026-09-01T11:05:00Z",
        updatedAt: "2026-09-01T11:05:00Z",
      },
      {
        // Deliberately unsigned. The real server sends such an endpoint no
        // deliveries now, but one written before that fix, or straight to the
        // store, can still exist, and the list has to surface it.
        id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2z",
        tenantId: "globex",
        url: "https://globex.example/hooks",
        description: "Imported, no secret",
        eventTypes: ["deployment.completed"],
        enabled: true,
        rateLimit: 0,
        signed: false,
        headers: {},
        metadata: {},
        createdAt: "2026-09-18T08:00:00Z",
        updatedAt: "2026-09-18T08:00:00Z",
      },
    ],
  }
}

let relayState = seedRelayState()

/** relay's catalog.Match, ported: "*" matches all; otherwise segment for segment. */
function relayGlobMatches(pattern, eventType) {
  if (pattern === "*" || pattern === eventType) return true
  const p = pattern.split(".")
  const e = eventType.split(".")
  if (p.length !== e.length) return false
  return p.every((seg, i) => seg === "*" || seg === e[i])
}

// relay's mapRelayError prefixes the message with the field's label, because
// the dashboard client drops details and the message is all a page sees.
const RELAY_FIELD_LABELS = { tenant_id: "Tenant ID", url: "URL", event_types: "Event types" }

function relayValidation(field, message) {
  return new FixtureError(400, CODE.BAD_REQUEST, `${RELAY_FIELD_LABELS[field] ?? field}: ${message}`, { field })
}

function relayFindEndpoint(rawId) {
  const id = typeof rawId === "string" ? rawId.trim() : ""
  if (!id) throw new FixtureError(400, CODE.BAD_REQUEST, "endpoint id is required")
  if (!id.startsWith("ep_")) throw new FixtureError(400, CODE.BAD_REQUEST, "malformed endpoint id")
  const ep = relayState.endpoints.find((e) => e.id === id)
  if (!ep) throw new FixtureError(404, CODE.NOT_FOUND, "endpoint not found")
  return ep
}

function relayValidURL(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/** The list row: no headers or metadata, and never a secret. */
function relaySummary(ep) {
  const { headers: _h, metadata: _m, ...row } = ep
  return row
}

const relayHandlers = {
  "endpoints.list": {
    kind: "query",
    handler: (payload) => {
      const tenantId = payload?.tenantId ?? ""
      let rows = tenantId === "" ? relayState.endpoints : relayState.endpoints.filter((e) => e.tenantId === tenantId)
      if (typeof payload?.enabled === "boolean") rows = rows.filter((e) => e.enabled === payload.enabled)
      return { endpoints: rows.map(relaySummary) }
    },
  },
  "endpoints.detail": {
    kind: "query",
    handler: (payload) => ({ ...relayFindEndpoint(payload?.id) }),
  },
  "endpoints.resolve": {
    kind: "query",
    handler: (payload) => {
      const type = payload?.eventType ?? ""
      const rows = relayState.endpoints.filter(
        (e) => e.enabled && e.tenantId === (payload?.tenantId ?? "") && e.eventTypes.some((p) => relayGlobMatches(p, type)),
      )
      return { endpoints: rows.map(relaySummary) }
    },
  },
  "endpoints.create": {
    kind: "command",
    invalidates: ["endpoints.list"],
    handler: (payload) => {
      if (!relayValidURL(payload?.url ?? "")) throw relayValidation("url", "invalid URL")
      if (!(payload?.tenantId ?? "")) throw relayValidation("tenant_id", "required")
      if (!Array.isArray(payload?.eventTypes) || payload.eventTypes.length === 0) {
        throw relayValidation("event_types", "at least one event type pattern required")
      }
      const now = new Date().toISOString()
      const ep = {
        id: `ep_${randomBytes(13).toString("hex")}`,
        tenantId: payload.tenantId,
        url: payload.url,
        description: payload.description ?? "",
        eventTypes: payload.eventTypes,
        enabled: true,
        rateLimit: payload.rateLimit ?? 0,
        signed: true,
        headers: payload.headers ?? {},
        metadata: payload.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }
      relayState.endpoints.push(ep)
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.update": {
    kind: "command",
    invalidates: ["endpoints.list", "endpoints.detail"],
    handler: (payload) => {
      const ep = relayFindEndpoint(payload?.id)
      // A field present in the payload is applied, and "" clears it; an absent
      // field leaves the value alone. That is what the Go handler's pointers do.
      if (payload?.url !== undefined && payload.url !== null) {
        if (!relayValidURL(payload.url)) throw relayValidation("url", "invalid URL")
        ep.url = payload.url
      }
      if (payload?.eventTypes !== undefined && payload.eventTypes !== null) {
        if (!Array.isArray(payload.eventTypes) || payload.eventTypes.length === 0) {
          throw relayValidation("event_types", "at least one event type pattern required")
        }
        ep.eventTypes = payload.eventTypes
      }
      for (const k of ["description", "rateLimit", "headers", "metadata"]) {
        if (payload?.[k] !== undefined && payload[k] !== null) ep[k] = payload[k]
      }
      ep.updatedAt = new Date().toISOString()
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.delete": {
    kind: "command",
    invalidates: ["endpoints.list"],
    handler: (payload) => {
      const ep = relayFindEndpoint(payload?.id)
      relayState.endpoints = relayState.endpoints.filter((e) => e.id !== ep.id)
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.setEnabled": {
    kind: "command",
    invalidates: ["endpoints.list", "endpoints.detail"],
    handler: (payload) => {
      const ep = relayFindEndpoint(payload?.id)
      ep.enabled = Boolean(payload?.enabled)
      ep.updatedAt = new Date().toISOString()
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.rotateSecret": {
    kind: "command",
    // The list as well as the detail: rotating gives an unsigned endpoint a
    // secret, which flips its badge on the list row.
    invalidates: ["endpoints.list", "endpoints.detail"],
    handler: (payload) => {
      const ep = relayFindEndpoint(payload?.id)
      ep.signed = true
      ep.updatedAt = new Date().toISOString()
      return { id: ep.id, secret: `whsec_${randomBytes(32).toString("hex")}` }
    },
  },
}

// Deliveries, events, event types, the DLQ, overview and settings. They read
// the endpoint rows above, so a delivery names a URL that exists here.
const relayFixtures = createRelayFixtures({ endpoints: () => relayState.endpoints, FixtureError })

// ---------------------------------------------------------------------------
// Registry: contributor -> intent -> definition
// ---------------------------------------------------------------------------

/**
 * Every contributor this fixture answers for, in capabilities order. Each
 * entry's `envPrefix` is what `contributorConfig` reads its four-state knobs
 * from (`FIXTURE_<envPrefix>_OMIT` etc.), extending the pattern the original
 * two contributors (STREAMING, AUTH) already used rather than replacing it.
 */
const CONTRIBUTORS = [
  { name: "core-contract", envPrefix: "CORE", handlers: coreHandlers },
  { name: "streaming-contract", envPrefix: "STREAMING", handlers: streamingHandlers },
  { name: "auth", envPrefix: "AUTH", handlers: authHandlers },
  { name: "organization", envPrefix: "ORGANIZATION", handlers: organizationHandlers },
  { name: "apikey", envPrefix: "APIKEY", handlers: apikeyHandlers },
  { name: "waitlist", envPrefix: "WAITLIST", handlers: waitlistHandlers },
  { name: "consent", envPrefix: "CONSENT", handlers: consentHandlers },
  { name: "subscription", envPrefix: "SUBSCRIPTION", handlers: subscriptionHandlers },
  { name: "password", envPrefix: "PASSWORD", handlers: passwordHandlers },
  { name: "relay", envPrefix: "RELAY", handlers: { ...relayHandlers, ...relayFixtures.handlers } },
  { name: "vault", envPrefix: "VAULT", handlers: createVaultHandlers(FixtureError) },
  { name: "trove", envPrefix: "TROVE", handlers: createTroveHandlers(FixtureError) },
  { name: "ledger", envPrefix: "LEDGER", handlers: createLedgerHandlers(FixtureError) },
  { name: "chronicle", envPrefix: "CHRONICLE", handlers: createChronicleHandlers(FixtureError) },
  { name: "keysmith", envPrefix: "KEYSMITH", handlers: createKeysmithHandlers(FixtureError) },
  { name: "bastion", envPrefix: "BASTION", handlers: createBastionHandlers(FixtureError) },
  { name: "sentinel", envPrefix: "SENTINEL", handlers: createSentinelHandlers(FixtureError) },
  { name: "herald", envPrefix: "HERALD", handlers: createHeraldHandlers(FixtureError) },
  { name: "weave", envPrefix: "WEAVE", handlers: createWeaveHandlers(FixtureError) },
  ...SETTINGS_ONLY_EXTENSIONS.map((extension) => ({
    name: extension,
    envPrefix: extension.toUpperCase(),
    // intents: [] — settings-only sub-plugins register no intents of their
    // own. See the block comment above.
    handlers: {},
  })),
]

function findContributor(name) {
  return CONTRIBUTORS.find((c) => c.name === name)
}

function findIntent(contributor, intent) {
  const c = findContributor(contributor)
  if (!c) return null
  if (contributorConfig(c.envPrefix).omit) return null
  return c.handlers[intent] ?? null
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
  for (const c of CONTRIBUTORS) {
    const cfg = contributorConfig(c.envPrefix)
    if (cfg.omit) continue
    contributors.push(contributorCapability(c.name, ["v1"], Object.keys(c.handlers), cfg))
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

/**
 * Mirrors contract.ErrorResponse: {ok:false, envelope:"v1",
 * error:{code,message,details?}}. details is omitted when empty, as the real
 * server's omitempty does.
 */
function sendError(res, status, code, message, details) {
  const error = { code, message }
  if (details && Object.keys(details).length > 0) error.details = details
  sendJSON(res, status, { ok: false, envelope: "v1", error })
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
    if (idempotencyClaims.has(idemKey)) {
      return sendError(res, 409, "CONFLICT", STILL_RUNNING)
    }
    const cached = idempotencyLookup(idemKey)
    // A tombstone, or any entry at all for a secret intent, refuses: the
    // Go dispatcher's order, so a tombstone never falls through to a run.
    if (cached && (cached.tombstone || def.secret)) {
      return sendError(res, 409, "CONFLICT", SECRET_NOT_KEPT)
    }
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
      return sendError(res, err.status, err.code, err.message, err.details)
    }
    return sendError(res, 400, CODE.BAD_REQUEST, err.message)
  }

  const meta = {}
  if (def.invalidates?.length) meta.invalidates = def.invalidates

  // The handler ran in one tick, so nothing could reach the claim while it
  // did. Only a hold leaves room for a repeat to find it.
  if (idemKey && COMMAND_HOLD_MS > 0) {
    idempotencyClaims.add(idemKey)
    await new Promise((resolve) => setTimeout(resolve, COMMAND_HOLD_MS))
    idempotencyClaims.delete(idemKey)
  }

  // Only successful dispatches are cached: the handler above already
  // returned early on error (FixtureError or otherwise), so reaching here
  // means success. A failed command never poisons the key, and a retry of
  // it runs fresh. A secret intent keeps a tombstone, never its answer.
  if (idemKey && def.secret) idempotencyStoreTombstone(idemKey)
  else if (idemKey) idempotencyStorePut(idemKey, data, meta)

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
  resetIdCounters()
  streaming = seedStreamingState()
  auth = seedAuthState()
  currentAppId = null
  currentEnvId = null
  settingsData = seedSettingsState()
  organization = seedOrganizationState()
  apikey = seedApikeyState()
  waitlist = seedWaitlistState()
  consent = seedConsentState()
  subscription = seedSubscriptionState()
  relayState = seedRelayState()
  relayFixtures.reset()
  resetVault()
  resetTrove()
  resetLedger()
  resetChronicle()
  resetKeysmith()
  resetBastion()
  resetSentinel()
  resetHerald()
  resetWeave()
  csrfTokens.clear()
  idempotencyStore.clear()
  idempotencyClaims.clear()
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
    if (url.pathname === TROVE_CONTENT_PATH) {
      return await handleTroveContent(req, res, url)
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
  console.log(`[fixture-server] ${CONTRIBUTORS.length} contributors registered:`)
  for (const c of CONTRIBUTORS) {
    const cfg = contributorConfig(c.envPrefix)
    console.log(
      `[fixture-server]   ${c.name} (${Object.keys(c.handlers).length} intents) configured=${cfg.configured} omit=${cfg.omit}`,
    )
  }
})
