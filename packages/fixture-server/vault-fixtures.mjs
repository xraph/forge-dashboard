// vault-fixtures.mjs: in-memory state and intent handlers for the vault
// contributor (packages/plugin-vault), kept out of server.mjs like
// warden-fixtures.mjs.
//
// Mirrors forgery/vault/extension/contract (handlers_secrets.go,
// handlers_rotation.go, handlers_flags.go, project.go, errors.go) and, for the
// flag intents, the flag package behind them (manager.go, validate.go,
// engine.go). Field names are the Go JSON tags, and every rule below is the Go
// handler's rule, in the Go handler's order, so a refusal here is a refusal
// there.
//
// The module is self-contained and imports nothing from server.mjs. The one
// thing it needs from there is the FixtureError class: server.mjs's dispatch
// catch tests `err instanceof FixtureError` against its own class, and a
// same-named class declared here would be a different constructor, so every
// refusal would reach the wire as 400/BAD_REQUEST and the shell could never
// see NOT_FOUND or CONFLICT. server.mjs therefore hands its class to
// createVaultHandlers, which is the supported way to get the right status and
// code onto the wire without a circular import.
//
// No secret value is ever stored or returned. create and update accept
// `value`, check that it is a non-empty string, and drop it. Flag values are
// not secrets: they are stored and returned as they are.

import { createHash } from "node:crypto"

const APP_ID = "app_vault"

// The default and maximum page sizes for secrets.list and rotation.policies.
const DEFAULT_LIST_LIMIT = 25
const MAX_LIST_LIMIT = 200
// secrets.detail returns at most this many audit entries.
const RECENT_AUDIT_LIMIT = 10
// rotation.detail returns at most this many rotation records.
const RECENT_ROTATION_RECORD_LIMIT = 50
// The rotation loop only checks once a minute, so a shorter interval cannot
// be honoured.
const MIN_ROTATION_INTERVAL_SECONDS = 60

// flags.list paging. Unlike the secrets and rotation lists the cap is 100.
const DEFAULT_FLAG_LIST_LIMIT = 25
const MAX_FLAG_LIST_LIMIT = 100
// flags.detail returns at most this many audit entries.
const RECENT_FLAG_AUDIT_LIMIT = 10
// How long the engine caches an evaluation, as flags.detail reports it.
const FLAG_CACHE_TTL_SECONDS = 30
// flag/manager.go maxKeyBytes.
const MAX_FLAG_KEY_BYTES = 256
// flag/validate.go maxSafeInt: the largest integer a JSON number holds exactly.
const MAX_SAFE_INT = 2 ** 53
const FLAG_TYPES = ["bool", "string", "int", "float", "json"]
// The rule types the engine can match. when_tenant_tag and custom never do.
const IMPLEMENTED_RULE_TYPES = new Set(["when_tenant", "when_user", "rollout", "schedule"])

// The algorithm a keyed vault stamps on what it writes.
const ENCRYPTION_ALG = "AES-256-GCM"

/** RFC3339 in UTC, without fractional seconds, like the Go projection. */
function iso(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z")
}

// ---------------------------------------------------------------------------
// Seed
//
// Seeded so the interesting answers are reachable rather than so the tables
// are non-empty:
//   - 33 secrets, so secrets.list has a second page at the default limit.
//   - db/primary.password, a key with both "/" and ".", to prove route
//     parameters and query keys survive the characters real keys contain.
//   - legacy/ftp.password, unencrypted (encryptionAlg ""), the row the
//     destructive badge exists for.
//   - Expiries: future, soon, already passed, and one on the rotatable
//     db/primary.password so a rotation that drops the expiry shows.
//   - Metadata on two secrets.
//   - Three policies: enabled with a rotator, enabled WITHOUT a rotator (it
//     will never rotate), and disabled (no next rotation to show).
//   - Rotation records on the rotatable, enabled one, with a version history
//     that matches them.
//   - 30 flags, described where they are seeded (seedFlags).
// ---------------------------------------------------------------------------

const SEED_KEYS = [
  "api/github.token",
  "api/sendgrid.key",
  "api/slack.webhook",
  "api/stripe.key",
  "api/twilio.token",
  "app-session-secret",
  "cache/redis.auth",
  "cdn/cloudflare.token",
  "ci/deploy.key",
  "db/analytics.password",
  "db/primary.password",
  "db/replica.password",
  "feature/launchdarkly.sdk",
  "jwt/signing.key",
  "kafka/broker.password",
  "legacy/ftp.password",
  "mail/postmark.token",
  "monitoring/datadog.key",
  "monitoring/sentry.dsn",
  "oauth/github.client-secret",
  "oauth/google.client-secret",
  "payments/stripe.webhook-secret",
  "queue/rabbit.password",
  "s3/backups.secret",
  "s3/uploads.secret",
  "search/elastic.password",
  "smtp/relay.password",
  "sso/saml.cert-key",
  "ssh/bastion.key",
  "storage/minio.secret",
  "tls/wildcard.key",
  "vpn/gateway.psk",
  "webhook/relay.signing",
]

// Keys an application has registered a rotator for. Rotators live in
// application code, so this set never changes at runtime.
const ROTATOR_KEYS = new Set(["db/primary.password", "smtp/relay.password"])

function seedVaultState() {
  const nowMs = Date.now()
  const hour = 3600_000
  const day = 24 * hour

  let counter = 0
  const nextId = (prefix) => `${prefix}_${String(++counter).padStart(6, "0")}`

  const state = { nextId, secrets: new Map(), policies: new Map(), records: new Map(), flags: new Map(), audit: [] }

  // resource is what audit.ListOpts.Resource filters by: secrets.detail asks
  // for "secret" rows and flags.detail for "flag" rows, so a flag and a secret
  // that share a key never show in each other's history.
  const pushAudit = (key, action, at, userId, resource = "secret") => {
    state.audit.push({ id: nextId("aud"), resource, key, action, outcome: "success", userId, createdAt: iso(at) })
  }

  SEED_KEYS.forEach((key, index) => {
    const version = key === "db/primary.password" ? 4 : 1 + (index % 3)
    const createdMs = nowMs - (40 - index) * day
    const versions = []
    for (let v = 1; v <= version; v += 1) {
      const at = key === "db/primary.password" ? nowMs - (4 - v) * 7 * day - 2 * hour : createdMs + (v - 1) * 3 * day
      versions.push({ id: nextId("secver"), version: v, ...(v === 1 || index % 2 === 0 ? { createdBy: "usr_1" } : {}), createdAt: iso(at) })
    }
    const updatedMs = Date.parse(versions[versions.length - 1].createdAt)
    const row = {
      id: nextId("sec"),
      key,
      version,
      encryptionAlg: key === "legacy/ftp.password" ? "" : ENCRYPTION_ALG,
      expiresAt: null,
      metadata: undefined,
      createdAt: iso(createdMs),
      updatedAt: iso(updatedMs),
      versions,
    }
    if (key === "oauth/google.client-secret") row.expiresAt = iso(nowMs + 45 * day)
    if (key === "api/twilio.token") row.expiresAt = iso(nowMs + 3 * day)
    // Already passed: the Go handlers refuse to SET a past expiry, but a row
    // written while it was still in the future gets there by waiting.
    if (key === "vpn/gateway.psk") row.expiresAt = iso(nowMs - 2 * day)
    // db/primary.password is rotatable and has an expiry, so a rotation that
    // dropped it (the bug Manager.RotateNow used to have) shows.
    if (key === "db/primary.password") row.expiresAt = iso(nowMs + 60 * day)
    if (key === "ci/deploy.key") row.metadata = { owner: "platform", environment: "production" }
    if (key === "api/stripe.key") row.metadata = { owner: "payments", runbook: "https://wiki.example/runbooks/stripe" }
    state.secrets.set(key, row)
    pushAudit(key, "secret.set", createdMs, "usr_1")
  })

  // Rotation policies. The interval is in seconds.
  state.policies.set("db/primary.password", {
    id: nextId("rot"),
    secretKey: "db/primary.password",
    intervalSeconds: 7 * 86400,
    enabled: true,
    lastRotatedAt: iso(nowMs - 2 * hour),
    nextRotationAt: iso(nowMs - 2 * hour + 7 * day),
    createdAt: iso(nowMs - 40 * day),
    updatedAt: iso(nowMs - 2 * hour),
  })
  // Enabled, but nothing in application code has registered a rotator for
  // it: rotatable is false, so it will never rotate however due it gets.
  state.policies.set("api/github.token", {
    id: nextId("rot"),
    secretKey: "api/github.token",
    intervalSeconds: 30 * 86400,
    enabled: true,
    nextRotationAt: iso(nowMs + 12 * day),
    createdAt: iso(nowMs - 20 * day),
    updatedAt: iso(nowMs - 20 * day),
  })
  // Disabled, with a rotator: a stored next-rotation time that must NOT be
  // projected. The stale value is deliberate, it is what proves the
  // projection drops it.
  state.policies.set("smtp/relay.password", {
    id: nextId("rot"),
    secretKey: "smtp/relay.password",
    intervalSeconds: 14 * 86400,
    enabled: false,
    lastRotatedAt: iso(nowMs - 30 * day),
    nextRotationAt: iso(nowMs - 16 * day),
    createdAt: iso(nowMs - 39 * day),
    updatedAt: iso(nowMs - 25 * day),
  })

  // Newest first, the order rotation.detail returns them in. Old and new
  // versions line up with db/primary.password's version history above.
  state.records.set("db/primary.password", [
    { id: nextId("rrec"), oldVersion: 3, newVersion: 4, rotatedBy: "rotation-manager", rotatedAt: iso(nowMs - 2 * hour) },
    { id: nextId("rrec"), oldVersion: 2, newVersion: 3, rotatedBy: "rotation-manager", rotatedAt: iso(nowMs - 7 * day - 2 * hour) },
    { id: nextId("rrec"), oldVersion: 1, newVersion: 2, rotatedAt: iso(nowMs - 14 * day - 2 * hour) },
  ])
  state.records.set("smtp/relay.password", [
    { id: nextId("rrec"), oldVersion: 1, newVersion: 2, rotatedBy: "rotation-manager", rotatedAt: iso(nowMs - 30 * day) },
  ])
  // smtp/relay.password's own version history has to agree with its record.
  const smtp = state.secrets.get("smtp/relay.password")
  smtp.version = 2
  smtp.versions = [
    { id: nextId("secver"), version: 1, createdBy: "usr_1", createdAt: smtp.createdAt },
    { id: nextId("secver"), version: 2, createdAt: iso(nowMs - 30 * day) },
  ]
  smtp.updatedAt = iso(nowMs - 30 * day)

  pushAudit("db/primary.password", "secret.set", nowMs - 2 * hour, "")
  pushAudit("db/primary.password", "secret.get", nowMs - 2 * hour - 1000, "usr_1")
  pushAudit("api/stripe.key", "secret.get", nowMs - 30 * 60_000, "usr_1")
  pushAudit("legacy/ftp.password", "secret.set", nowMs - 5 * 60_000, "usr_1")
  seedFlags(state, nowMs, pushAudit)
  state.audit.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return state
}


// ---------------------------------------------------------------------------
// Flag seed
//
// 30 flags across all five types, so flags.list has a second page at the
// default limit and the type filter has something to narrow. The interesting
// ones:
//   - checkout.new-flow: every rule type in evaluation order (when_tenant,
//     when_user, rollout, schedule not yet started, when_tenant_tag, custom),
//     so a tenant that misses the first three walks the whole ladder to the
//     default and the last two say they never match.
//   - legacy.strict-mode: a bool flag whose stored default is the STRING
//     "true" (what the templ page wrote), plus a rule returning the string
//     "false": defaultMatchesType and returnMatchesType are false.
//   - billing/invoice-v2 and limits.api-rate: tenant overrides. The first has
//     a "/" in its key, to prove the key survives a route.
//   - beta.dark-mode: disabled, with a rollout rule it will not consult.
//   - ui.theme: variants and metadata.
//   - mail.html-templates: a schedule whose window has ended.
// ---------------------------------------------------------------------------

/** One stored rule. Times are UTC RFC3339 strings, "" or absent for an open end. */
function seedRule(vaultState, index, type, config, returnValue) {
  return {
    id: vaultState.nextId("rule"),
    priority: index,
    type,
    config: {
      tenantIds: config.tenantIds ?? [],
      userIds: config.userIds ?? [],
      percentage: config.percentage ?? 0,
      startAt: config.startAt ?? null,
      endAt: config.endAt ?? null,
      tagKey: config.tagKey ?? "",
      tagValue: config.tagValue ?? "",
      evaluator: config.evaluator ?? "",
      params: config.params ?? null,
    },
    returnValue,
  }
}

function seedFlags(state, nowMs, pushAudit) {
  const day = 24 * 3600_000
  const minute = 60_000

  // [key, type, defaultValue, description, enabled, tags]
  const table = [
    ["checkout.new-flow", "bool", false, "The rebuilt checkout, targeted every way the engine can target.", true, ["checkout", "growth"]],
    ["billing/invoice-v2", "bool", false, "Second-generation invoice PDFs.", true, ["billing"]],
    ["legacy.strict-mode", "bool", "true", "Written by the old page with a string default.", true, ["legacy"]],
    ["beta.dark-mode", "bool", false, "Dark mode for the beta cohort. Switched off while the palette is reviewed.", false, ["ui", "beta"]],
    ["search.rerank", "bool", false, "Rerank search hits with the learned model.", true, ["search"]],
    ["search.typeahead", "bool", true, "Suggest queries as you type.", true, ["search"]],
    ["notifications.digest", "bool", false, "Batch notification emails into a daily digest.", true, ["notifications"]],
    ["onboarding.checklist", "bool", false, "Show the setup checklist to new workspaces during the launch window.", true, ["onboarding"]],
    ["api.v3-enabled", "bool", false, "Serve the v3 API to allow-listed users.", true, ["api"]],
    ["ui.compact-tables", "bool", false, "Denser table rows.", true, ["ui"]],
    ["export.csv-streaming", "bool", true, "Stream CSV exports instead of buffering them.", true, ["export"]],
    ["auth.passkeys", "bool", false, "Offer passkey enrolment at sign-in.", true, ["auth"]],
    ["mail.html-templates", "bool", false, "HTML transactional mail. The launch window closed.", true, ["mail"]],

    ["ui.theme", "string", "light", "The default colour theme.", true, ["ui"]],
    ["ui.locale", "string", "en-US", "Fallback locale for anonymous requests.", true, ["ui", "i18n"]],
    ["mail.from-name", "string", "Forge", "Display name on outgoing mail.", true, ["mail"]],
    ["api.version-header", "string", "2026-09-01", "Value of the API-Version response header.", true, ["api"]],
    ["search.engine", "string", "bm25", "Ranking function: bm25 or hybrid.", true, ["search"]],
    ["docs.banner-text", "string", "", "Announcement banner on the docs site. Empty hides it.", true, ["docs"]],
    ["pricing.plan-label", "string", "Pro", "What the top plan is called on the pricing page.", true, ["pricing"]],

    ["limits.api-rate", "int", 100, "Requests per minute per tenant.", true, ["limits", "api"]],
    ["limits.upload-mb", "int", 25, "Largest upload, in megabytes.", true, ["limits"]],
    ["retry.max-attempts", "int", 5, "Attempts before a job is dead-lettered.", true, ["jobs"]],
    ["session.ttl-minutes", "int", 60, "Idle session lifetime.", true, ["auth"]],
    ["pagination.page-size", "int", 25, "Default page size for list endpoints.", true, ["api"]],

    ["pricing.tax-rate", "float", 0.2, "VAT applied when no regional rate is known.", true, ["pricing"]],
    ["search.boost-factor", "float", 1.5, "Weight of title matches against body matches.", true, ["search"]],
    ["sampling.trace-rate", "float", 0.05, "Fraction of requests traced.", true, ["observability"]],

    ["ui.nav-layout", "json", { sections: ["overview", "billing", "settings"], collapsed: false }, "Sidebar sections, in order.", true, ["ui"]],
    ["integrations.allowlist", "json", ["acme", "globex"], "Tenants allowed to use beta integrations.", true, ["integrations"]],
  ]

  table.forEach(([key, type, defaultValue, description, enabled, tags], index) => {
    const createdMs = nowMs - (60 - index) * day
    const row = {
      id: state.nextId("flag"),
      key,
      type,
      defaultValue,
      description,
      tags,
      enabled,
      variants: [],
      metadata: {},
      rules: [],
      overrides: new Map(),
      createdAt: iso(createdMs),
      updatedAt: iso(createdMs),
    }
    state.flags.set(key, row)
    pushAudit(key, "flag.created", createdMs, "usr_1", "flag")
  })

  const flagRow = (key) => state.flags.get(key)
  const setRules = (key, rules, atMs) => {
    const row = flagRow(key)
    row.rules = rules.map(([type, config, value], i) => seedRule(state, i, type, config, value))
    pushAudit(key, "flag.rules_set", atMs, "usr_1", "flag")
  }

  // Every rule type. Buckets for this key: wayne 8 (the rollout takes it),
  // globex 53 and tenant_1 43 (they walk every rung to the default).
  setRules(
    "checkout.new-flow",
    [
      ["when_tenant", { tenantIds: ["acme", "initech"] }, true],
      ["when_user", { userIds: ["usr_1", "usr_2"] }, true],
      ["rollout", { percentage: 30 }, true],
      ["schedule", { startAt: iso(nowMs + 30 * day), endAt: iso(nowMs + 60 * day) }, true],
      ["when_tenant_tag", { tagKey: "plan", tagValue: "enterprise" }, true],
      ["custom", { evaluator: "beta-cohort", params: { cohort: "early", weight: 2, flags: ["a", "b"] } }, true],
    ],
    nowMs - 20 * day,
  )
  setRules(
    "legacy.strict-mode",
    [["when_tenant", { tenantIds: ["acme"] }, "false"]],
    nowMs - 30 * day,
  )
  setRules("beta.dark-mode", [["rollout", { percentage: 50 }, true]], nowMs - 12 * day)
  setRules("search.rerank", [["rollout", { percentage: 25 }, true]], nowMs - 9 * day)
  setRules("notifications.digest", [["when_tenant", { tenantIds: ["acme"] }, true]], nowMs - 8 * day)
  setRules(
    "onboarding.checklist",
    [["schedule", { startAt: iso(nowMs - 5 * day), endAt: iso(nowMs + 9 * day) }, true]],
    nowMs - 5 * day,
  )
  setRules("api.v3-enabled", [["when_user", { userIds: ["usr_3"] }, true]], nowMs - 7 * day)
  setRules(
    "mail.html-templates",
    [["schedule", { startAt: iso(nowMs - 20 * day), endAt: iso(nowMs - 3 * day) }, true]],
    nowMs - 20 * day,
  )
  setRules("ui.theme", [["when_tenant", { tenantIds: ["initech"] }, "dark"]], nowMs - 15 * day)
  setRules("limits.upload-mb", [["when_tenant", { tenantIds: ["acme"] }, 250]], nowMs - 6 * day)
  setRules("sampling.trace-rate", [["rollout", { percentage: 10 }, 1]], nowMs - 4 * day)

  const overrides = (key, entries, atMs) => {
    const row = flagRow(key)
    for (const [tenantId, value] of entries) {
      row.overrides.set(tenantId, { tenantId, value, updatedAt: iso(atMs) })
      pushAudit(key, "flag.override_set", atMs, "usr_1", "flag")
    }
  }
  overrides("billing/invoice-v2", [["acme", true], ["initech", false]], nowMs - 3 * day)
  overrides("limits.api-rate", [["acme", 500], ["globex", 2000]], nowMs - 2 * day)

  const themed = flagRow("ui.theme")
  themed.variants = [
    { value: "light", description: "The default, for daylight." },
    { value: "dark", description: "Low-light palette." },
    { value: "high-contrast", description: "WCAG AAA contrast." },
  ]
  themed.metadata = { owner: "design", ticket: "DES-412", reviewed: "2026-08-30" }
  themed.updatedAt = iso(nowMs - 15 * day + 10 * minute)
  pushAudit("ui.theme", "flag.updated", nowMs - 15 * day + 10 * minute, "usr_1", "flag")

  const beta = flagRow("beta.dark-mode")
  beta.updatedAt = iso(nowMs - 6 * day)
  pushAudit("beta.dark-mode", "flag.toggled", nowMs - 6 * day, "usr_1", "flag")
}

let vault = seedVaultState()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetVault() {
  vault = seedVaultState()
}

// ---------------------------------------------------------------------------
// Projections (project.go)
// ---------------------------------------------------------------------------

/**
 * encryptionAlg has no omitempty in Go, so "" stays on the wire. expiresAt
 * and metadata are omitempty, so they are left out when null or empty.
 */
function projectSecret(row) {
  const out = {
    id: row.id,
    key: row.key,
    version: row.version,
    encryptionAlg: row.encryptionAlg,
  }
  if (row.expiresAt) out.expiresAt = row.expiresAt
  out.appId = APP_ID
  if (row.metadata && Object.keys(row.metadata).length > 0) out.metadata = { ...row.metadata }
  out.createdAt = row.createdAt
  out.updatedAt = row.updatedAt
  return out
}

function projectVersion(v) {
  const out = { id: v.id, version: v.version }
  if (v.createdBy) out.createdBy = v.createdBy
  out.createdAt = v.createdAt
  return out
}

/** nextRotationAt is dropped whenever the policy is disabled, whatever is stored. */
function projectPolicy(p) {
  const out = {
    id: p.id,
    secretKey: p.secretKey,
    intervalSeconds: p.intervalSeconds,
    enabled: p.enabled,
    rotatable: ROTATOR_KEYS.has(p.secretKey),
  }
  if (p.lastRotatedAt) out.lastRotatedAt = p.lastRotatedAt
  if (p.enabled && p.nextRotationAt) out.nextRotationAt = p.nextRotationAt
  out.createdAt = p.createdAt
  out.updatedAt = p.updatedAt
  return out
}

function projectRecord(r) {
  const out = { id: r.id, oldVersion: r.oldVersion, newVersion: r.newVersion }
  if (r.rotatedBy) out.rotatedBy = r.rotatedBy
  out.rotatedAt = r.rotatedAt
  return out
}

function projectAudit(e) {
  const out = { id: e.id, action: e.action, outcome: e.outcome }
  if (e.userId) out.userId = e.userId
  out.createdAt = e.createdAt
  return out
}

// ---------------------------------------------------------------------------
// Flag values (flag/validate.go)
// ---------------------------------------------------------------------------

/** Go's fmt %v of a float64: shortest digits, an exponent from e+06 up or below e-05. */
function goFloat(n) {
  if (n === 0) return "0"
  const [mantissa, exp] = n.toExponential().split("e")
  const e = Number(exp)
  if (e < -4 || e >= 6) return `${mantissa}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`
  return String(n)
}

/** describe: names a value's kind without echoing it. undefined is a JSON null. */
function describeValue(v) {
  if (v === null || v === undefined) return "null"
  if (typeof v === "boolean") return "a boolean"
  if (typeof v === "string") return "a string"
  if (typeof v === "number") return "a number"
  if (Array.isArray(v)) return "an array"
  return "an object"
}

/**
 * ValidateValue: the refusal text for a value that is not acceptable for a
 * flag of type t, or null. A JSON number is always a float64, so int takes one
 * with no fractional part up to 2^53 in magnitude. null is refused for every
 * type except json.
 */
function valueRefusal(t, v) {
  switch (t) {
    case "bool":
      return typeof v === "boolean" ? null : `must be a boolean, got ${describeValue(v)}`
    case "string":
      return typeof v === "string" ? null : `must be a string, got ${describeValue(v)}`
    case "int":
      if (typeof v !== "number") return `must be a whole number, got ${describeValue(v)}`
      if (!Number.isFinite(v) || v !== Math.trunc(v)) return `must be a whole number, got ${goFloat(v)}`
      if (Math.abs(v) > MAX_SAFE_INT) return `must not exceed 2^53 in magnitude, got ${goFloat(v)}`
      return null
    case "float":
      if (typeof v !== "number") return `must be a number, got ${describeValue(v)}`
      return Number.isFinite(v) ? null : `must be a finite number, got ${goFloat(v)}`
    case "json":
      return null
    default:
      return `unknown flag type "${t}"`
  }
}

/** A stored value as the wire carries it: an absent value is a JSON null. */
function wireValue(v) {
  return v === undefined ? null : v
}

/** valueMatchesType: whether v, as it will appear on the wire, is a value of type t. */
function valueMatchesType(t, v) {
  return valueRefusal(t, wireValue(v)) === null
}

/** flag.RolloutBucket: sha256(tenantId + ":" + key), first four bytes big-endian, mod 100. */
export function rolloutBucket(tenantId, flagKey) {
  return createHash("sha256").update(`${tenantId}:${flagKey}`).digest().readUInt32BE(0) % 100
}

// ---------------------------------------------------------------------------
// Flag projections (project.go)
// ---------------------------------------------------------------------------

function projectFlag(row) {
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    defaultValue: wireValue(row.defaultValue),
    defaultMatchesType: valueMatchesType(row.type, row.defaultValue),
    description: row.description,
    tags: [...row.tags],
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * projectFlagRule. tenantIds, userIds and percentage have no omitempty and
 * are always present; startAt and endAt are omitted for an open end, tagKey,
 * tagValue and evaluator when empty, params when it holds nothing.
 * returnMatchesType is decided by the caller: a command that has just stored
 * the rule passes true, because the manager validated it before writing.
 */
function projectRule(rule, returnMatchesType) {
  const out = {
    id: rule.id,
    priority: rule.priority,
    type: rule.type,
    implemented: IMPLEMENTED_RULE_TYPES.has(rule.type),
    tenantIds: [...rule.config.tenantIds],
    userIds: [...rule.config.userIds],
    percentage: rule.config.percentage,
  }
  if (rule.config.startAt) out.startAt = rule.config.startAt
  if (rule.config.endAt) out.endAt = rule.config.endAt
  if (rule.config.tagKey) out.tagKey = rule.config.tagKey
  if (rule.config.tagValue) out.tagValue = rule.config.tagValue
  if (rule.config.evaluator) out.evaluator = rule.config.evaluator
  if (rule.config.params && Object.keys(rule.config.params).length > 0) out.params = structuredClone(rule.config.params)
  out.returnValue = wireValue(rule.returnValue)
  out.returnMatchesType = returnMatchesType
  return out
}

function projectOverride(o, valueMatches) {
  return { tenantId: o.tenantId, value: wireValue(o.value), valueMatchesType: valueMatches, updatedAt: o.updatedAt }
}

// ---------------------------------------------------------------------------
// Flag evaluation (flag/engine.go)
// ---------------------------------------------------------------------------

/** evalSchedule: inside the window, either end open. */
function scheduleMatches(rule, nowMs) {
  const { startAt, endAt } = rule.config
  if (startAt && nowMs < Date.parse(startAt)) return false
  if (endAt && nowMs > Date.parse(endAt)) return false
  return true
}

/** evaluateRule: does one rule match this tenant and user. when_tenant_tag and custom never do. */
function ruleMatches(rule, flagKey, tenantId, userId, nowMs) {
  switch (rule.type) {
    case "when_tenant":
      return tenantId !== "" && rule.config.tenantIds.includes(tenantId)
    case "when_user":
      return userId !== "" && rule.config.userIds.includes(userId)
    case "rollout": {
      if (tenantId === "") return false
      const pct = rule.config.percentage
      if (pct <= 0) return false
      if (pct >= 100) return true
      return rolloutBucket(tenantId, flagKey) < pct
    }
    case "schedule":
      return scheduleMatches(rule, nowMs)
    default:
      return false
  }
}

/** ruleNote: the engine's one-line explanation of a rule's verdict, in its wording. */
function ruleNote(rule, flagKey, tenantId, userId, nowMs) {
  switch (rule.type) {
    case "when_tenant":
      return tenantId === "" ? "no tenant in context" : `tenant ${tenantId}`
    case "when_user":
      return userId === "" ? "no user in context" : `user ${userId}`
    case "rollout":
      if (tenantId === "") return "no tenant in context, a rollout cannot match"
      return `bucket ${rolloutBucket(tenantId, flagKey)} of 100, threshold ${rule.config.percentage}`
    case "schedule": {
      const { startAt, endAt } = rule.config
      if (startAt && nowMs < Date.parse(startAt)) return "the window has not started"
      if (endAt && nowMs > Date.parse(endAt)) return "the window has ended"
      return "inside the window"
    }
    case "when_tenant_tag":
    case "custom":
      return "this rule type is not implemented and never matches"
    default:
      return ""
  }
}

/**
 * EvaluateDetail: disabled, then tenant override, then rules in order (the
 * first match wins and the rest are listed unreached), then the default.
 * There is no cache to bypass here.
 */
function evaluateDetail(row, tenantId, userId, nowMs) {
  if (!row.enabled) return { value: row.defaultValue, reason: "disabled", trace: [] }
  if (tenantId !== "") {
    const override = row.overrides.get(tenantId)
    if (override) return { value: override.value, reason: "tenantOverride", trace: [] }
  }
  const trace = []
  for (let i = 0; i < row.rules.length; i += 1) {
    const rule = row.rules[i]
    const matched = ruleMatches(rule, row.key, tenantId, userId, nowMs)
    trace.push({
      priority: rule.priority,
      type: rule.type,
      matched,
      reached: true,
      note: ruleNote(rule, row.key, tenantId, userId, nowMs),
    })
    if (!matched) continue
    for (const rest of row.rules.slice(i + 1)) {
      trace.push({ priority: rest.priority, type: rest.type, matched: false, reached: false, note: "" })
    }
    return { value: rule.returnValue, reason: "rule", matchedRule: rule, trace }
  }
  return { value: row.defaultValue, reason: "default", trace }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 *   server.mjs's own error class, so refusals carry their real status and code.
 */
export function createVaultHandlers(FixtureError) {
  const badRequest = (message) => new FixtureError(400, "BAD_REQUEST", message)
  const conflict = (message) => new FixtureError(409, "CONFLICT", message)
  const secretNotFound = () => new FixtureError(404, "NOT_FOUND", "secret not found")
  const policyNotFound = () => new FixtureError(404, "NOT_FOUND", "rotation policy not found")
  const flagNotFound = () => new FixtureError(404, "NOT_FOUND", "flag not found")
  const flagExists = () => new FixtureError(409, "CONFLICT", "a flag with this key already exists")
  const overrideNotFound = () => new FixtureError(404, "NOT_FOUND", "tenant override not found")
  /** flag.ValidationError as mapError sends it: "flag: <field>: <message>", BAD_REQUEST. */
  const invalid = (field, message) => badRequest(`flag: ${field}: ${message}`)

  /** requireKey: present, trimmed. Every keyed handler calls it first. */
  function requireKey(raw) {
    const key = typeof raw === "string" ? raw.trim() : ""
    if (key === "") throw badRequest("key is required")
    return key
  }

  /** A limit or offset from the wire, as a whole number, or 0 when it is not one. */
  function wholeNumber(raw) {
    return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
  }

  /** limit <= 0 gets the default, over the cap is capped, offset < 0 is 0. */
  function pageParams(payload) {
    let limit = wholeNumber(payload?.limit)
    if (limit <= 0) limit = DEFAULT_LIST_LIMIT
    if (limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT
    let offset = wholeNumber(payload?.offset)
    if (offset < 0) offset = 0
    return { limit, offset }
  }

  /** parseFutureExpiry: RFC3339 only, and strictly in the future. Returned in UTC. */
  function parseFutureExpiry(raw) {
    const rfc3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/
    const ms = typeof raw === "string" && rfc3339.test(raw) ? Date.parse(raw) : Number.NaN
    if (Number.isNaN(ms)) throw badRequest("expiresAt must be an RFC3339 timestamp")
    if (ms <= Date.now()) throw badRequest("expiresAt must be in the future")
    return iso(ms)
  }

  function recordAudit(key, action, resource = "secret") {
    vault.audit.unshift({ id: vault.nextId("aud"), resource, key, action, outcome: "success", userId: "usr_1", createdAt: iso(Date.now()) })
  }

  /** ListAuditByKey with a Resource: only the rows written for that kind of thing, newest first. */
  function recentAuditFor(key, resource, limit) {
    return vault.audit.filter((e) => e.resource === resource && e.key === key).slice(0, limit).map(projectAudit)
  }

  function newVersionRow(row, version) {
    const v = { id: vault.nextId("secver"), version, createdAt: iso(Date.now()) }
    row.versions.push(v)
  }

  function findSecret(key) {
    const row = vault.secrets.get(key)
    if (!row) throw secretNotFound()
    return row
  }

  // -- flags ----------------------------------------------------------------

  function findFlag(key) {
    const row = vault.flags.get(key)
    if (!row) throw flagNotFound()
    return row
  }

  /** parseFlagType: "" is every type, anything else outside the five is BAD_REQUEST. */
  function parseFlagType(raw) {
    if (raw === undefined || raw === null || raw === "") return ""
    if (typeof raw === "string" && FLAG_TYPES.includes(raw)) return raw
    throw badRequest("type must be one of bool, string, int, float, json")
  }

  /** The string a wire field holds, trimmed, or "" when it is absent or not a string. */
  function trimmedString(raw) {
    return typeof raw === "string" ? raw.trim() : ""
  }

  /** parseRuleTime: an optional RFC3339 rule time, "" or absent meaning an open end. Returned in UTC. */
  function parseRuleTime(i, name, raw) {
    if (raw === undefined || raw === null || raw === "") return null
    const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
    const ms = typeof raw === "string" && rfc3339.test(raw) ? Date.parse(raw) : Number.NaN
    if (Number.isNaN(ms)) throw badRequest(`rules[${i}].${name} must be an RFC3339 timestamp`)
    return iso(ms)
  }

  /** cleanIDs: trims each id and refuses an empty list, a blank id or a duplicate. */
  function cleanIDs(i, name, list) {
    const field = `rules[${i}].config.${name}`
    if (!Array.isArray(list) || list.length === 0) throw invalid(field, "must list at least one id")
    const seen = new Set()
    const out = []
    for (const raw of list) {
      const id = trimmedString(raw)
      if (id === "") throw invalid(field, "must not contain a blank id")
      if (seen.has(id)) throw invalid(field, `lists ${JSON.stringify(id)} more than once`)
      seen.add(id)
      out.push(id)
    }
    return out
  }

  /**
   * validateRule: one rule, checked and reduced to what its type reads.
   * when_tenant_tag and custom keep their config as given: the engine does not
   * evaluate them, but an operator may author them ahead of that.
   */
  function validateRule(i, flagType, raw, startAt, endAt) {
    const cfg = { tenantIds: [], userIds: [], percentage: 0, startAt: null, endAt: null, tagKey: "", tagValue: "", evaluator: "", params: null }
    switch (raw?.type) {
      case "when_tenant":
        cfg.tenantIds = cleanIDs(i, "tenantIds", raw.tenantIds)
        break
      case "when_user":
        cfg.userIds = cleanIDs(i, "userIds", raw.userIds)
        break
      case "rollout": {
        const pct = typeof raw.percentage === "number" ? Math.trunc(raw.percentage) : 0
        if (pct < 0 || pct > 100) throw invalid(`rules[${i}].config.percentage`, "must be between 0 and 100")
        cfg.percentage = pct
        break
      }
      case "schedule":
        if (startAt === null && endAt === null) throw invalid(`rules[${i}].config`, "a schedule needs a start, an end, or both")
        if (startAt !== null && endAt !== null && !(Date.parse(startAt) < Date.parse(endAt))) {
          throw invalid(`rules[${i}].config.endAt`, "must be after the start")
        }
        cfg.startAt = startAt
        cfg.endAt = endAt
        break
      case "when_tenant_tag":
      case "custom":
        cfg.tenantIds = Array.isArray(raw.tenantIds) ? raw.tenantIds.map(String) : []
        cfg.userIds = Array.isArray(raw.userIds) ? raw.userIds.map(String) : []
        cfg.percentage = typeof raw.percentage === "number" ? Math.trunc(raw.percentage) : 0
        cfg.startAt = startAt
        cfg.endAt = endAt
        cfg.tagKey = typeof raw.tagKey === "string" ? raw.tagKey : ""
        cfg.tagValue = typeof raw.tagValue === "string" ? raw.tagValue : ""
        cfg.evaluator = typeof raw.evaluator === "string" ? raw.evaluator : ""
        cfg.params = raw.params && typeof raw.params === "object" && !Array.isArray(raw.params) ? structuredClone(raw.params) : null
        break
      default:
        throw invalid(`rules[${i}].type`, `unknown rule type ${JSON.stringify(raw?.type ?? "")}`)
    }
    const refusal = valueRefusal(flagType, wireValue(raw.returnValue))
    if (refusal !== null) throw invalid(`rules[${i}].returnValue`, refusal)
    return cfg
  }

  /** The manager's write: stamp updatedAt, record the audit row, answer the flag. */
  function writeFlag(row, action) {
    row.updatedAt = iso(Date.now())
    recordAudit(row.key, action, "flag")
    return { flag: projectFlag(row) }
  }

  return {
    "secrets.list": {
      kind: "query",
      handler: (payload) => {
        const { limit, offset } = pageParams(payload)
        const all = [...vault.secrets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        return { secrets: all.slice(offset, offset + limit).map(projectSecret), total: all.length }
      },
    },

    "secrets.detail": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findSecret(key)
        const policy = vault.policies.get(key)
        return {
          secret: projectSecret(row),
          // An explicit null, not an omission: one page shows and creates a policy.
          rotation: policy ? projectPolicy(policy) : null,
          // Resource "secret": a flag with the same key keeps its own history.
          recentAudit: recentAuditFor(key, "secret", RECENT_AUDIT_LIMIT),
        }
      },
    },

    "secrets.versions": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findSecret(key)
        return { versions: [...row.versions].sort((a, b) => b.version - a.version).map(projectVersion) }
      },
    },

    "secrets.create": {
      kind: "command",
      // detail and versions too: a page that read the key before it existed
      // holds a NOT_FOUND for it, and the create has to replace that.
      invalidates: ["secrets.list", "secrets.detail", "secrets.versions"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        // The value is checked and dropped, never stored.
        if (typeof payload?.value !== "string" || payload.value === "") throw badRequest("value is required")
        if (vault.secrets.has(key)) throw conflict("a secret with this key already exists; update it instead")

        let expiresAt = null
        const rawExpiry = payload?.expiresAt
        if (rawExpiry !== undefined && rawExpiry !== null && rawExpiry !== "") expiresAt = parseFutureExpiry(rawExpiry)

        const now = iso(Date.now())
        const row = {
          id: vault.nextId("sec"),
          key,
          version: 1,
          encryptionAlg: ENCRYPTION_ALG,
          expiresAt,
          metadata: undefined,
          createdAt: now,
          updatedAt: now,
          versions: [],
        }
        newVersionRow(row, 1)
        vault.secrets.set(key, row)
        recordAudit(key, "secret.set")
        return { secret: projectSecret(row) }
      },
    },

    "secrets.update": {
      kind: "command",
      invalidates: ["secrets.list", "secrets.detail", "secrets.versions"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (typeof payload?.value !== "string" || payload.value === "") throw badRequest("value is required")
        const row = findSecret(key)

        // expiresAt: absent keeps, "" clears, a timestamp sets (future only).
        // Resolved before anything is written, so a refusal leaves the row alone.
        let expiresAt = row.expiresAt
        const rawExpiry = payload?.expiresAt
        if (rawExpiry !== undefined && rawExpiry !== null) {
          expiresAt = rawExpiry === "" ? null : parseFutureExpiry(rawExpiry)
        }

        // metadata: absent keeps, present replaces wholesale (even with {}).
        let metadata = row.metadata
        const rawMetadata = payload?.metadata
        if (rawMetadata !== undefined && rawMetadata !== null) {
          const isStringMap =
            typeof rawMetadata === "object" && !Array.isArray(rawMetadata) && Object.values(rawMetadata).every((v) => typeof v === "string")
          if (!isStringMap) throw badRequest("metadata must be an object of strings")
          metadata = { ...rawMetadata }
        }

        // This fixture models a keyed vault, and Secrets().Set stamps the
        // algorithm on every write when a key is configured. So replacing the
        // value re-encrypts the legacy unencrypted row; _fixture/reset brings
        // that row back for demos.
        row.encryptionAlg = ENCRYPTION_ALG
        row.expiresAt = expiresAt
        row.metadata = metadata
        row.version += 1
        row.updatedAt = iso(Date.now())
        newVersionRow(row, row.version)
        recordAudit(key, "secret.set")
        return { secret: projectSecret(row) }
      },
    },

    "secrets.delete": {
      kind: "command",
      invalidates: ["secrets.list", "secrets.detail", "secrets.versions", "rotation.policies", "rotation.detail"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!vault.secrets.has(key)) {
          // A retry path: an orphan policy left by an earlier failed cleanup
          // still gets removed before the secret's own NOT_FOUND is answered.
          vault.policies.delete(key)
          throw secretNotFound()
        }
        vault.secrets.delete(key)
        vault.policies.delete(key)
        // Rotation records stay: the store deletes the secret's versions and,
        // through this handler, its policy, and nothing else.
        recordAudit(key, "secret.delete")
        return { ok: true, key }
      },
    },

    // -- flags: every command goes through the manager's rules ---------------

    "flags.list": {
      kind: "query",
      handler: (payload) => {
        const type = parseFlagType(payload?.type)
        let limit = wholeNumber(payload?.limit)
        if (limit <= 0) limit = DEFAULT_FLAG_LIST_LIMIT
        if (limit > MAX_FLAG_LIST_LIMIT) limit = MAX_FLAG_LIST_LIMIT
        let offset = wholeNumber(payload?.offset)
        if (offset < 0) offset = 0
        const matching = [...vault.flags.values()]
          .filter((f) => type === "" || f.type === type)
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        // total is the count matching the type filter, whatever the page.
        return { flags: matching.slice(offset, offset + limit).map(projectFlag), total: matching.length }
      },
    },

    "flags.detail": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findFlag(key)
        const overrides = [...row.overrides.values()].sort((a, b) => (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0))
        return {
          flag: projectFlag(row),
          variants: row.variants.map((v) => ({ value: wireValue(v.value), description: v.description })),
          metadata: { ...row.metadata },
          // In the order the engine walks them, which is not re-sorted.
          rules: row.rules.map((r) => projectRule(r, valueMatchesType(row.type, r.returnValue))),
          overrides: overrides.map((o) => projectOverride(o, valueMatchesType(row.type, o.value))),
          // Resource "flag": a secret with the same key keeps its own history.
          recentAudit: recentAuditFor(key, "flag", RECENT_FLAG_AUDIT_LIMIT),
          cacheTtlSeconds: FLAG_CACHE_TTL_SECONDS,
        }
      },
    },

    "flags.evaluate": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        // The subject is what the request names and nothing else: never the
        // operator's own tenant or user.
        const tenantId = trimmedString(payload?.tenantId)
        const userId = trimmedString(payload?.userId)
        const row = findFlag(key)
        const nowMs = Date.now()
        const detail = evaluateDetail(row, tenantId, userId, nowMs)
        const out = {
          value: wireValue(detail.value),
          valueMatchesType: valueMatchesType(row.type, detail.value),
          reason: detail.reason,
        }
        if (detail.matchedRule) out.matchedRulePriority = detail.matchedRule.priority
        out.trace = detail.trace
        if (tenantId !== "") out.bucket = rolloutBucket(tenantId, key)
        out.evaluatedAt = iso(nowMs)
        return out
      },
    },

    "flags.create": {
      kind: "command",
      invalidates: ["flags.list", "flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (Buffer.byteLength(key, "utf8") > MAX_FLAG_KEY_BYTES) throw invalid("key", `must be at most ${MAX_FLAG_KEY_BYTES} bytes`)
        const type = typeof payload?.type === "string" ? payload.type : ""
        if (!FLAG_TYPES.includes(type)) throw invalid("type", "must be one of bool, string, int, float, json")
        // For a create an absent default and a null one are both null, and
        // only a json flag accepts null.
        const defaultValue = wireValue(payload?.defaultValue)
        const refusal = valueRefusal(type, defaultValue)
        if (refusal !== null) throw invalid("defaultValue", refusal)
        if (vault.flags.has(key)) throw flagExists()

        const now = iso(Date.now())
        // A new flag starts empty: no rules and no overrides, whatever an
        // earlier flag of this key left behind (the delete removes them, and
        // this never inherits them).
        const row = {
          id: vault.nextId("flag"),
          key,
          type,
          defaultValue,
          description: typeof payload?.description === "string" ? payload.description : "",
          tags: Array.isArray(payload?.tags) ? payload.tags.map(String) : [],
          enabled: payload?.enabled === true,
          variants: [],
          metadata: {},
          rules: [],
          overrides: new Map(),
          createdAt: now,
          updatedAt: now,
        }
        vault.flags.set(key, row)
        recordAudit(key, "flag.created", "flag")
        return { flag: projectFlag(row) }
      },
    },

    "flags.update": {
      kind: "command",
      invalidates: ["flags.list", "flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        // Present, even as null, means set it (null only for a json flag);
        // absent means leave it. Description and tags are pointers in Go, so
        // an explicit null leaves them alone too.
        const hasDefault = payload !== null && typeof payload === "object" && "defaultValue" in payload
        const row = findFlag(key)
        if (hasDefault) {
          const refusal = valueRefusal(row.type, wireValue(payload.defaultValue))
          if (refusal !== null) throw invalid("defaultValue", refusal)
          row.defaultValue = wireValue(payload.defaultValue)
        }
        if (typeof payload?.description === "string") row.description = payload.description
        if (Array.isArray(payload?.tags)) row.tags = payload.tags.map(String)
        // Variants and metadata are carried over untouched. Like the manager,
        // an update with nothing to change still writes and is audited.
        return writeFlag(row, "flag.updated")
      },
    },

    "flags.delete": {
      kind: "command",
      invalidates: ["flags.list", "flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        findFlag(key)
        // The flag's rules and overrides live on the row, so they go with it.
        vault.flags.delete(key)
        recordAudit(key, "flag.deleted", "flag")
        return { ok: true, key }
      },
    },

    "flags.setEnabled": {
      kind: "command",
      invalidates: ["flags.list", "flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findFlag(key)
        const enabled = payload?.enabled === true
        // The value it already has writes nothing and records nothing.
        if (row.enabled === enabled) return { flag: projectFlag(row) }
        row.enabled = enabled
        return writeFlag(row, "flag.toggled")
      },
    },

    "flags.setRules": {
      kind: "command",
      invalidates: ["flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!Array.isArray(payload?.rules)) throw badRequest("rules is required; send an empty list to clear them")
        // Every time on the wire is parsed before the flag is even looked up.
        const times = payload.rules.map((r, i) => [parseRuleTime(i, "startAt", r?.startAt), parseRuleTime(i, "endAt", r?.endAt)])
        const row = findFlag(key)
        // Every rule is validated before anything is written.
        const stored = payload.rules.map((r, i) => ({
          id: vault.nextId("rule"),
          // The priority is the index: the first rule wins.
          priority: i,
          type: r?.type,
          config: validateRule(i, row.type, r, times[i][0], times[i][1]),
          returnValue: wireValue(r.returnValue),
        }))
        row.rules = stored
        recordAudit(key, "flag.rules_set", "flag")
        // The manager validated every return value, so they all match.
        return { rules: stored.map((r) => projectRule(r, true)) }
      },
    },

    "flags.setTenantOverride": {
      kind: "command",
      invalidates: ["flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findFlag(key)
        const tenantId = trimmedString(payload?.tenantId)
        if (tenantId === "") throw invalid("tenantId", "is required")
        const value = wireValue(payload?.value)
        const refusal = valueRefusal(row.type, value)
        if (refusal !== null) throw invalid("value", refusal)
        const override = { tenantId, value, updatedAt: iso(Date.now()) }
        row.overrides.set(tenantId, override)
        recordAudit(key, "flag.override_set", "flag")
        return { override: projectOverride(override, true) }
      },
    },

    "flags.deleteTenantOverride": {
      kind: "command",
      invalidates: ["flags.detail", "flags.evaluate"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findFlag(key)
        const tenantId = trimmedString(payload?.tenantId)
        if (tenantId === "") throw invalid("tenantId", "is required")
        if (!row.overrides.delete(tenantId)) throw overrideNotFound()
        recordAudit(key, "flag.override_deleted", "flag")
        return { ok: true, key, tenantId }
      },
    },

    "rotation.policies": {
      kind: "query",
      handler: (payload) => {
        const { limit, offset } = pageParams(payload)
        const all = [...vault.policies.values()].sort((a, b) => (a.secretKey < b.secretKey ? -1 : a.secretKey > b.secretKey ? 1 : 0))
        return { policies: all.slice(offset, offset + limit).map(projectPolicy), total: all.length }
      },
    },

    "rotation.detail": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        findSecret(key)
        const policy = vault.policies.get(key)
        const records = vault.records.get(key) ?? []
        return {
          // An explicit null when the secret exists but has no policy yet.
          policy: policy ? projectPolicy(policy) : null,
          rotatable: ROTATOR_KEYS.has(key),
          records: records.slice(0, RECENT_ROTATION_RECORD_LIMIT).map(projectRecord),
        }
      },
    },

    "rotation.savePolicy": {
      kind: "command",
      invalidates: ["rotation.policies", "rotation.detail", "secrets.detail"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const interval = payload?.intervalSeconds
        if (typeof interval !== "number" || !Number.isInteger(interval) || interval < MIN_ROTATION_INTERVAL_SECONDS) {
          throw badRequest("intervalSeconds must be at least 60")
        }
        findSecret(key)

        const enabled = payload?.enabled === true
        const nowMs = Date.now()
        const now = iso(nowMs)
        const existing = vault.policies.get(key)
        let policy
        let giveNextDueTime
        if (existing) {
          policy = existing
          // New, interval changed, disabled-to-enabled, or enabled with no due
          // time at all gets now plus the interval; every other save keeps the
          // stored one, and lastRotatedAt.
          giveNextDueTime =
            policy.intervalSeconds !== interval || (!policy.enabled && enabled) || (enabled && !policy.nextRotationAt)
          policy.intervalSeconds = interval
          policy.enabled = enabled
          policy.updatedAt = now
        } else {
          giveNextDueTime = true
          policy = { id: vault.nextId("rot"), secretKey: key, intervalSeconds: interval, enabled, createdAt: now, updatedAt: now }
          vault.policies.set(key, policy)
        }
        if (giveNextDueTime) policy.nextRotationAt = iso(nowMs + interval * 1000)
        return { policy: projectPolicy(policy) }
      },
    },

    "rotation.deletePolicy": {
      kind: "command",
      invalidates: ["rotation.policies", "rotation.detail", "secrets.detail"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!vault.policies.delete(key)) throw policyNotFound()
        return { ok: true, key }
      },
    },

    "rotation.rotateNow": {
      kind: "command",
      invalidates: ["rotation.policies", "rotation.detail", "secrets.list", "secrets.detail", "secrets.versions"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!ROTATOR_KEYS.has(key)) {
          throw badRequest("no rotator is registered for this secret; rotators are registered in application code")
        }
        const row = findSecret(key)

        // Expiry and metadata are carried forward, untouched. The rewrite goes
        // through Secrets().Set, so it is stamped with the keyed algorithm, as
        // in secrets.update. Go reads the current value first (an access
        // audit entry) and then sets the new one.
        const oldVersion = row.version
        row.encryptionAlg = ENCRYPTION_ALG
        const nowMs = Date.now()
        const now = iso(nowMs)
        row.version += 1
        row.updatedAt = now
        newVersionRow(row, row.version)

        const records = vault.records.get(key) ?? []
        records.unshift({ id: vault.nextId("rrec"), oldVersion, newVersion: row.version, rotatedBy: "rotation-manager", rotatedAt: now })
        vault.records.set(key, records)

        // Like the manager's updatePolicyTimestamps: a policy, if there is
        // one, is stamped whether or not it is enabled.
        const policy = vault.policies.get(key)
        if (policy) {
          policy.lastRotatedAt = now
          policy.nextRotationAt = iso(nowMs + policy.intervalSeconds * 1000)
          policy.updatedAt = now
        }
        recordAudit(key, "secret.get")
        recordAudit(key, "secret.set")
        return { key, oldVersion, newVersion: row.version }
      },
    },
  }
}
