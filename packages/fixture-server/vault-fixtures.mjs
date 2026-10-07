// vault-fixtures.mjs: in-memory state and intent handlers for the vault
// contributor (packages/plugin-vault), kept out of server.mjs like
// warden-fixtures.mjs.
//
// Mirrors forgery/vault/extension/contract (handlers_secrets.go,
// handlers_rotation.go, handlers_flags.go, project.go, errors.go) and, for the
// flag intents, the flag package behind them (manager.go, validate.go,
// engine.go), and for the config and override intents, handlers_config.go,
// configmgr/manager.go and config/validate.go. Field names are the Go JSON tags, and every rule below is the Go
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

// config.list and overrides.list paging: default 25, capped at 100.
const DEFAULT_CONFIG_LIST_LIMIT = 25
const MAX_CONFIG_LIST_LIMIT = 100
// config.detail returns at most this many audit entries.
const RECENT_CONFIG_AUDIT_LIMIT = 10
// configmgr/manager.go maxKeyBytes.
const MAX_CONFIG_KEY_BYTES = 256
// The six value types the write service validates. Any other stored label
// (the templ page's "yaml", say) is readable but its value cannot be judged.
const CONFIG_TYPES = ["string", "int", "float", "bool", "json", "duration"]
// configmgr/manager.go typeList.
const CONFIG_TYPE_LIST = "must be one of string, int, float, bool, json, duration"

// The algorithm a keyed vault stamps on what it writes.
const ENCRYPTION_ALG = "AES-256-GCM"

// audit.list paging: default 25, capped at 100 (tighter than the other lists:
// an audit row is wider and the table only grows).
const DEFAULT_AUDIT_LIST_LIMIT = 25
const MAX_AUDIT_LIST_LIMIT = 100
// overview.stats shows this many audit rows as recent activity.
const OVERVIEW_RECENT_ACTIVITY_LIMIT = 10
// How far back overview.stats counts failed rotations.
const ROTATION_FAILURE_WINDOW_MS = 24 * 3600_000
// The one action every secret read writes. The default audit view and the
// overview's recent activity leave it out.
const SECRET_READ_ACTION = "secret.get"

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
//   - ssh/bastion.key expires in 20 days: inside the 30-day window and outside
//     the 7-day one, so the two expiry filters answer differently.
//   - api/slack.webhook has a mixed history: v1 stored in the clear, v2 from
//     before versions recorded their algorithm (unrecorded), v3 encrypted.
//     Every other version follows its secret: the two unencrypted keys are
//     plaintext throughout, the rest encrypted.
//   - Metadata on two secrets.
//   - Policies for every case the overview counts: enabled with a rotator,
//     enabled with a rotator and overdue (its rotator always fails), enabled
//     WITHOUT a rotator (it will never rotate; one of them with a due time
//     already past, which is not overdue), disabled with a rotator, and
//     disabled without one (counted in no line).
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
const ROTATOR_KEYS = new Set(["db/primary.password", "smtp/relay.password", "cache/redis.auth"])
// Rotators that always fail, with the cause their error wraps. rotation.rotateNow
// on one of these reads the secret, fails in the rotator, and changes nothing.
const FAILING_ROTATOR_KEYS = new Map([["cache/redis.auth", "dial tcp 10.0.3.7:6379: connect: connection refused"]])

// Rows stored in the clear: written before the vault had a key. Two, so the
// overview's "unencrypted" line has a count and the list is a mix.
const UNENCRYPTED_KEYS = new Set(["legacy/ftp.password", "queue/rabbit.password"])

// The secret whose version history shows all three encryption values.
const MIXED_HISTORY_KEY = "api/slack.webhook"

// Version rows carry the algorithm the value was written with: a string
// ("" is plaintext), or null for a row written before versions recorded one.
function seedVersionAlg(key, v) {
  if (key === MIXED_HISTORY_KEY) return v === 1 ? "" : v === 2 ? null : ENCRYPTION_ALG
  return UNENCRYPTED_KEYS.has(key) ? "" : ENCRYPTION_ALG
}

// The 7d and 30d windows of secrets.list and overview.stats. Bounds are
// half-open: an expired secret (expires_at <= now) is never also expiring
// (now < expires_at <= now + window), and a secret with no expiry is neither.
const EXPIRY_WINDOW_DAYS = { "7d": 7, "30d": 30 }
const EXPIRING_SOON_DAYS = 30

/** AddDate(0, 0, n) in UTC: whole calendar days, like the Go handlers. */
function addDaysMs(ms, days) {
  const d = new Date(ms)
  d.setUTCDate(d.getUTCDate() + days)
  return d.getTime()
}

/** The expires_at test for one bound pair; a secret with no expiry never matches. */
function expiresWithin(row, afterMs, beforeMs) {
  if (!row.expiresAt) return false
  const at = Date.parse(row.expiresAt)
  if (afterMs !== null && !(at > afterMs)) return false
  if (beforeMs !== null && !(at <= beforeMs)) return false
  return true
}

function seedVaultState() {
  const nowMs = Date.now()
  const hour = 3600_000
  const day = 24 * hour

  let counter = 0
  const nextId = (prefix) => `${prefix}_${String(++counter).padStart(6, "0")}`

  const state = {
    nextId,
    secrets: new Map(),
    policies: new Map(),
    records: new Map(),
    flags: new Map(),
    // key -> entry row, and key -> (tenant -> override). An override may sit
    // under a key that has no entry: an orphan.
    configs: new Map(),
    configOverrides: new Map(),
    audit: [],
  }

  // resource is what audit.ListOpts.Resource filters by: secrets.detail asks
  // for "secret" rows and flags.detail for "flag" rows, so a flag and a secret
  // that share a key never show in each other's history.
  // tenantId is set on override rows only: the override's own tenant.
  // failure, when given, is the failure message: the row's outcome is "failure"
  // and the message is what the projection shows as its error.
  const pushAudit = (key, action, at, userId, resource = "secret", tenantId = "", failure = undefined) => {
    state.audit.push({
      id: nextId("aud"),
      resource,
      key,
      action,
      outcome: failure === undefined ? "success" : "failure",
      userId,
      createdAt: iso(at),
      ...(tenantId === "" ? {} : { tenantId }),
      ...(failure === undefined ? {} : { error: failure }),
    })
  }

  SEED_KEYS.forEach((key, index) => {
    const version = key === "db/primary.password" ? 4 : 1 + (index % 3)
    const createdMs = nowMs - (40 - index) * day
    const versions = []
    for (let v = 1; v <= version; v += 1) {
      const at = key === "db/primary.password" ? nowMs - (4 - v) * 7 * day - 2 * hour : createdMs + (v - 1) * 3 * day
      versions.push({
        id: nextId("secver"),
        version: v,
        ...(v === 1 || index % 2 === 0 ? { createdBy: "usr_1" } : {}),
        createdAt: iso(at),
        encryptionAlg: seedVersionAlg(key, v),
      })
    }
    const updatedMs = Date.parse(versions[versions.length - 1].createdAt)
    const row = {
      id: nextId("sec"),
      key,
      version,
      encryptionAlg: UNENCRYPTED_KEYS.has(key) ? "" : ENCRYPTION_ALG,
      expiresAt: null,
      metadata: undefined,
      createdAt: iso(createdMs),
      updatedAt: iso(updatedMs),
      versions,
    }
    if (key === "oauth/google.client-secret") row.expiresAt = iso(nowMs + 45 * day)
    if (key === "api/twilio.token") row.expiresAt = iso(nowMs + 3 * day)
    if (key === "ssh/bastion.key") row.expiresAt = iso(nowMs + 20 * day)
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
  // Enabled, with a rotator, and overdue: its next rotation fell due three
  // days ago and the rotator keeps failing (the audit rows below), so the
  // overview has an overdue count and failed rotations to show. Its rotator
  // fails for real too: rotation.rotateNow on this key always errors and
  // leaves a failure row (see FAILING_ROTATOR_KEYS).
  state.policies.set("cache/redis.auth", {
    id: nextId("rot"),
    secretKey: "cache/redis.auth",
    intervalSeconds: 7 * 86400,
    enabled: true,
    lastRotatedAt: iso(nowMs - 10 * day),
    nextRotationAt: iso(nowMs - 3 * day),
    createdAt: iso(nowMs - 30 * day),
    updatedAt: iso(nowMs - 10 * day),
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

  // Enabled, no rotator, and its due time is already past. It is counted as
  // without a rotator and not as overdue: a policy nothing can run cannot be
  // late.
  state.policies.set("api/sendgrid.key", {
    id: nextId("rot"),
    secretKey: "api/sendgrid.key",
    intervalSeconds: 14 * 86400,
    enabled: true,
    nextRotationAt: iso(nowMs - 2 * day),
    createdAt: iso(nowMs - 16 * day),
    updatedAt: iso(nowMs - 16 * day),
  })
  // Disabled and no rotator: counted in neither line.
  state.policies.set("api/slack.webhook", {
    id: nextId("rot"),
    secretKey: "api/slack.webhook",
    intervalSeconds: 30 * 86400,
    enabled: false,
    createdAt: iso(nowMs - 12 * day),
    updatedAt: iso(nowMs - 12 * day),
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
    { id: nextId("secver"), version: 1, createdBy: "usr_1", createdAt: smtp.createdAt, encryptionAlg: ENCRYPTION_ALG },
    { id: nextId("secver"), version: 2, createdAt: iso(nowMs - 30 * day), encryptionAlg: ENCRYPTION_ALG },
  ]
  smtp.updatedAt = iso(nowMs - 30 * day)

  pushAudit("db/primary.password", "secret.set", nowMs - 2 * hour, "")
  pushAudit("db/primary.password", "secret.get", nowMs - 2 * hour - 1000, "")
  pushAudit("api/stripe.key", "secret.get", nowMs - 30 * 60_000, "usr_1")
  pushAudit("legacy/ftp.password", "secret.set", nowMs - 5 * 60_000, "usr_1")
  seedFlags(state, nowMs, pushAudit)
  seedConfig(state, nowMs, pushAudit)
  seedAuditExtras(state, nowMs, pushAudit)
  state.audit.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return state
}


// ---------------------------------------------------------------------------
// Audit seed
//
// Everything above leaves the log without a handful of the actions the vault
// writes and with only success rows. This adds the rest so every audit filter
// and every overview line has data:
//   - all 18 actions: secret.delete, secret.rotated, flag.deleted,
//     flag.override_deleted, override.deleted, rotation.policy_saved and
//     rotation.policy_deleted join the eleven seeded elsewhere.
//   - secret reads, many more than writes, some with a tenant, so the default
//     view (reads hidden) and the overview's recent activity have something
//     to leave out.
//   - secret.rotated failures. Three fall inside the last 24 hours (two on
//     cache/redis.auth, one on db/primary.password, one of them manual) and
//     three fall outside it, so the overview's count is 3 and not 6. One more
//     failure, a secret.set, sits inside the window and is not a rotation, so
//     the count is 3 and not 4.
//   - db/primary.password's last rotation (set, read and rotated rows) names
//     no user: the rotation loop ran it, and its three rows agree.
//   - rows with a user (the dashboard operator usr_1, and usr_2) and rows
//     without (an application or the rotation loop wrote them), and rows with
//     and without a tenant.
// ---------------------------------------------------------------------------

function seedAuditExtras(state, nowMs, pushAudit) {
  const minute = 60_000
  const hour = 3600_000
  const day = 24 * hour

  // Reads. Twelve keys, some read several times, a few on behalf of a tenant.
  const readKeys = [
    "api/stripe.key",
    "db/primary.password",
    "jwt/signing.key",
    "api/sendgrid.key",
    "cache/redis.auth",
    "s3/uploads.secret",
    "oauth/github.client-secret",
    "smtp/relay.password",
    "kafka/broker.password",
    "mail/postmark.token",
    "monitoring/sentry.dsn",
    "search/elastic.password",
  ]
  for (let i = 0; i < 36; i += 1) {
    const key = readKeys[i % readKeys.length]
    const at = nowMs - (10 + i * 47) * minute
    // An application read carries no user; a third carry a tenant.
    pushAudit(key, "secret.get", at, i % 4 === 0 ? "usr_1" : "", "secret", i % 3 === 0 ? "acme" : "")
  }

  // The actions the rest of the seed never writes.
  pushAudit("legacy/old-token", "secret.set", nowMs - 12 * day, "usr_1")
  pushAudit("legacy/old-token", "secret.delete", nowMs - 11 * day, "usr_1")
  pushAudit("legacy.retired-toggle", "flag.created", nowMs - 22 * day, "usr_1", "flag")
  pushAudit("legacy.retired-toggle", "flag.deleted", nowMs - 21 * day, "usr_2", "flag")
  pushAudit("search.rerank", "flag.override_deleted", nowMs - 4 * day, "usr_1", "flag", "globex")
  pushAudit("limits.api-rate", "override.deleted", nowMs - 5 * day - hour, "usr_2", "override", "initech")
  pushAudit("api/github.token", "rotation.policy_saved", nowMs - 20 * day, "usr_1", "rotation")
  pushAudit("db/primary.password", "rotation.policy_saved", nowMs - 40 * day, "usr_1", "rotation")
  pushAudit("cache/redis.auth", "rotation.policy_saved", nowMs - 30 * day, "usr_1", "rotation")
  pushAudit("smtp/relay.password", "rotation.policy_saved", nowMs - 25 * day, "usr_1", "rotation")
  pushAudit("ci/deploy.key", "rotation.policy_saved", nowMs - 9 * day, "usr_2", "rotation")
  pushAudit("ci/deploy.key", "rotation.policy_deleted", nowMs - 8 * day, "usr_2", "rotation")

  // Successful rotations: the loop's (no user) and one an operator ran.
  pushAudit("db/primary.password", "secret.rotated", nowMs - 2 * hour + 2000, "", "secret")
  pushAudit("db/primary.password", "secret.rotated", nowMs - 7 * day - 2 * hour + 2000, "", "secret")
  pushAudit("cache/redis.auth", "secret.rotated", nowMs - 10 * day, "usr_1", "secret")
  pushAudit("smtp/relay.password", "secret.rotated", nowMs - 30 * day, "", "secret")

  // Failed rotations. Inside the last 24 hours: 3. Outside it: 3.
  const dial = 'rotation: rotator failed for "cache/redis.auth": dial tcp 10.0.3.7:6379: connect: connection refused'
  pushAudit("cache/redis.auth", "secret.rotated", nowMs - 1 * hour, "", "secret", "", dial)
  pushAudit("cache/redis.auth", "secret.rotated", nowMs - 3 * hour, "usr_1", "secret", "", dial)
  pushAudit("db/primary.password", "secret.rotated", nowMs - 20 * hour, "", "secret", "", 'rotation: rotator failed for "db/primary.password": pq: password authentication failed for user "rotator"')
  pushAudit("cache/redis.auth", "secret.rotated", nowMs - 30 * hour, "", "secret", "", dial)
  pushAudit("smtp/relay.password", "secret.rotated", nowMs - 3 * day, "", "secret", "", 'rotation: rotator failed for "smtp/relay.password": 535 authentication credentials invalid')
  // A failure with no message recorded: the projection leaves error out.
  pushAudit("db/primary.password", "secret.rotated", nowMs - 8 * day, "", "secret", "", "")
  // A failure that is not a rotation, inside the window: the overview counts
  // failed rotations, so this one must not move that number.
  pushAudit("legacy/ftp.password", "secret.set", nowMs - 5 * hour, "usr_1", "secret", "", "secret: store write failed: connection reset by peer")
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
      pushAudit(key, "flag.override_set", atMs, "usr_1", "flag", tenantId)
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

// ---------------------------------------------------------------------------
// Config seed
//
// 30 entries, so config.list has a second page at the default limit. 28 are
// well formed across all six types; the other two are what the old page wrote:
//   - legacy.deploy-manifest: type "yaml", a label the vault does not validate
//     (knownType false, valueMatchesType false, read-only to the write service).
//   - limits.page-size: an int entry whose stored value is the STRING "50"
//     (valueMatchesType false). Its first version is a valid int, so a rollback
//     to it is accepted.
// Version histories are the point of most rows: 3 or more versions on a dozen
// of them, and the json ones change in nested places, so a diff has something
// to show. Two more shapes worth having:
//   - cache.ttl changed type from int to duration, so its old versions hold
//     numbers and a rollback to one is refused.
//   - search.page-size was rolled back (its third version is config.rolled_back).
// Overrides for acme and globex on several keys, including one holding "" on a
// string entry (an override of nothing, not a missing one), one whose value is
// the wrong type, and an orphan: overrides on legacy.retired-flag, whose entry
// was deleted by a write that did not clear them.
// ---------------------------------------------------------------------------

function seedConfig(state, nowMs, pushAudit) {
  const day = 24 * 3600_000
  const hour = 3600_000

  // [key, type, description, versions oldest first (the last is current), metadata]
  const table = [
    ["app.name", "string", "What the console calls itself in the header.", ["Forge", "Forge Console"], {}],
    ["app.base-url", "string", "Public URL, used in emailed links.", ["http://localhost:3000", "https://staging.example.com", "https://console.example.com"], { owner: "platform" }],
    ["billing/invoice.currency", "string", "Currency new invoices are issued in.", ["EUR", "GBP", "USD"], {}],
    ["mail.from-address", "string", "Sender on transactional mail.", ["no-reply@example.com"], {}],
    ["support.email", "string", "Where the help link goes.", ["help@example.com", "support@example.com"], {}],
    ["ui.theme-default", "string", "Theme a tenant gets before it picks one.", ["light", "system"], {}],

    ["limits.api-rate", "int", "Requests per minute per tenant.", [100, 250, 500, 1000], { owner: "platform", runbook: "https://wiki.example/runbooks/rate-limits" }],
    ["retry.max-attempts", "int", "Attempts before a job is dead-lettered.", [3, 5], {}],
    ["search.page-size", "int", "Hits per page in search.", [20, 50, 20], {}],
    ["session.max-devices", "int", "Trusted devices a user may keep.", [5], {}],

    ["billing/tax.rate", "float", "VAT applied when no regional rate is known.", [0.2, 0.2075, 0.0825], {}],
    ["ml.rerank-threshold", "float", "Score under which a reranked hit is dropped.", [0.5, 0.72], {}],
    ["sampling.trace-ratio", "float", "Fraction of requests traced.", [0.05], {}],

    ["auth.require-mfa", "bool", "Force a second factor at sign-in.", [false, true], {}],
    ["export.csv-streaming", "bool", "Stream CSV exports instead of buffering them.", [false, true], {}],
    ["features.maintenance-mode", "bool", "Show the maintenance page to everyone but operators.", [false, true, false], {}],
    ["signup.open", "bool", "Accept new sign-ups.", [true], {}],
    ["ui.compact-tables", "bool", "Denser table rows.", [false], {}],

    [
      "billing/plans",
      "json",
      "Plans on the pricing page: price in cents and the limits each one carries.",
      [
        { free: { priceCents: 0, limits: { seats: 1, projects: 3 } }, pro: { priceCents: 2900, limits: { seats: 5, projects: 20 } } },
        { free: { priceCents: 0, limits: { seats: 1, projects: 3 } }, pro: { priceCents: 3900, limits: { seats: 5, projects: 20 } } },
        { free: { priceCents: 0, limits: { seats: 2, projects: 3 } }, pro: { priceCents: 3900, limits: { seats: 10, projects: 50 } }, team: { priceCents: 9900, limits: { seats: 25, projects: 200 } } },
        { free: { priceCents: 0, limits: { seats: 2, projects: 5 } }, pro: { priceCents: 3900, limits: { seats: 10, projects: 50 } }, team: { priceCents: 9900, limits: { seats: 25, projects: 200 }, trialDays: 14 } },
      ],
      { owner: "growth", ticket: "GRO-118" },
    ],
    [
      "ui.nav-items",
      "json",
      "Sidebar entries, in order.",
      [
        [{ label: "Overview", path: "/" }, { label: "Billing", path: "/billing" }],
        [{ label: "Overview", path: "/" }, { label: "Billing", path: "/billing" }, { label: "Settings", path: "/settings" }],
        [{ label: "Overview", path: "/" }, { label: "Billing", path: "/billing", badge: "new" }, { label: "Settings", path: "/settings" }],
      ],
      {},
    ],
    [
      "search.synonyms",
      "json",
      "Query expansion table.",
      [
        { car: ["auto"], invoice: ["bill"] },
        { car: ["auto", "vehicle"], invoice: ["bill"] },
        { car: ["auto", "vehicle"], invoice: ["bill", "receipt"], sku: ["product code"] },
      ],
      {},
    ],
    [
      "notifications.channels",
      "json",
      "Where each kind of notification goes.",
      [
        { email: { enabled: true, digest: "daily" }, slack: { enabled: false } },
        { email: { enabled: true, digest: "hourly" }, slack: { enabled: true, channel: "#alerts" } },
        { email: { enabled: true, digest: "hourly" }, slack: { enabled: true, channel: "#ops-alerts" } },
      ],
      {},
    ],
    ["routing.rules", "json", "Path rewrites applied before routing.", [{ "/old": "/new" }, { "/old": "/new", "/blog": "/news" }], {}],
    ["features.rollout", "json", "Rollout plan. null while there is none.", [{ phase: 1 }, null], {}],

    ["session.timeout", "duration", "Idle time before a session ends.", ["15m", "20m", "30m"], {}],
    ["http.client-timeout", "duration", "Outbound HTTP timeout.", ["5s"], {}],
    ["jobs.retry-backoff", "duration", "Wait before a failed job is retried.", ["30s", "1h30m"], {}],
    ["cache.ttl", "duration", "How long the edge cache holds a page. Was a number of seconds.", [300, 600, "10m"], {}],

    ["legacy.deploy-manifest", "yaml", "Written by the old page. Kept as it was.", ["replicas: 2\nimage: forge:1.3\n", "replicas: 3\nimage: forge:1.4\n"], {}],
    ["limits.page-size", "int", "Written by the old page with a string.", [10, "50"], {}],
  ]

  // Where a version is not a plain set: search.page-size's third was a rollback.
  const rolledBack = { "search.page-size": 3 }

  table.forEach(([key, valueType, description, values, metadata], index) => {
    const count = values.length
    const createdMs = nowMs - ((count + 2) * 4 + (index % 9) + 3) * day
    const versions = values.map((value, i) => ({ version: i + 1, value: structuredClone(value), createdAt: iso(createdMs + i * 4 * day + (index % 5) * hour) }))
    const last = versions[versions.length - 1]
    state.configs.set(key, {
      id: state.nextId("cfg"),
      key,
      valueType,
      value: structuredClone(last.value),
      description,
      metadata: { ...metadata },
      version: count,
      createdAt: iso(createdMs),
      updatedAt: last.createdAt,
      versions,
    })
    for (const v of versions) {
      pushAudit(key, rolledBack[key] === v.version ? "config.rolled_back" : "config.set", Date.parse(v.createdAt), "usr_1", "config")
    }
  })

  // key -> [[tenant, value], ...], newest write last. An override's updatedAt
  // is when it was written; its audit row carries the tenant.
  const overrides = (key, entries, atMs) => {
    const byTenant = state.configOverrides.get(key) ?? new Map()
    entries.forEach(([tenantId, value], i) => {
      const at = atMs + i * 10 * 60_000
      byTenant.set(tenantId, { id: state.nextId("ovr"), key, tenantId, value: structuredClone(value), createdAt: iso(at), updatedAt: iso(at) })
      pushAudit(key, "override.set", at, "usr_1", "override", tenantId)
    })
    state.configOverrides.set(key, byTenant)
  }
  overrides("limits.api-rate", [["acme", 5000], ["globex", 250]], nowMs - 3 * day)
  overrides("features.maintenance-mode", [["globex", true]], nowMs - 2 * day)
  overrides("session.timeout", [["acme", "1h"]], nowMs - 5 * day)
  // "" is an override of the empty string, which is not the same act as having
  // none: the tenant reads "" and not the app default.
  overrides("ui.theme-default", [["acme", "dark"], ["globex", ""]], nowMs - 4 * day)
  overrides("billing/tax.rate", [["globex", 0.2]], nowMs - 6 * day)
  overrides("app.base-url", [["acme", "https://acme.console.example.com"], ["globex", "https://globex.console.example.com"]], nowMs - 8 * day)
  overrides("search.synonyms", [["acme", { car: ["auto"], sku: ["part number"] }]], nowMs - 1 * day)
  overrides("features.rollout", [["acme", null]], nowMs - 7 * day)
  // The entry's stored value is the wrong type, and so is globex's override.
  overrides("limits.page-size", [["acme", 50], ["globex", "abc"]], nowMs - 9 * day)
  // The entry has a type the vault does not validate, so nothing matches it.
  overrides("legacy.deploy-manifest", [["acme", "replicas: 5\n"]], nowMs - 10 * day)

  // An orphan: the entry was deleted by a write that left its overrides, and
  // nothing has recreated the key. It resolves for no one.
  pushAudit("legacy.retired-flag", "config.set", nowMs - 40 * day, "usr_1", "config")
  overrides("legacy.retired-flag", [["acme", true], ["globex", false]], nowMs - 35 * day)
  pushAudit("legacy.retired-flag", "config.deleted", nowMs - 20 * day, "usr_1", "config")
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

/** project.go versionEncryption: null (unrecorded) is "unknown", "" is "plaintext", anything else "encrypted". */
function versionEncryption(alg) {
  if (alg === null || alg === undefined) return "unknown"
  return alg === "" ? "plaintext" : "encrypted"
}

/** encryption has no omitempty in Go, so it is always on the wire. */
/** A secret's version rows other than its current one, as vault counts them. */
function earlierVersions(row) {
  return row.versions.filter((v) => v.version !== row.version)
}

function projectVersion(v) {
  const out = { id: v.id, version: v.version }
  if (v.createdBy) out.createdBy = v.createdBy
  out.createdAt = v.createdAt
  out.encryption = versionEncryption(v.encryptionAlg)
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

/**
 * projectAuditSummary: Go's shared projectAuditSummary, the one row shape the
 * audit list, the overview's recent activity and the detail intents' recent
 * audit all use. tenantId, userId and error are omitempty, and error is only
 * ever read from a failure row.
 */
function projectAuditSummary(e) {
  const out = { id: e.id, action: e.action, resource: e.resource, key: e.key, outcome: e.outcome }
  if (e.tenantId) out.tenantId = e.tenantId
  if (e.userId) out.userId = e.userId
  if (e.outcome === "failure" && e.error) out.error = e.error
  out.createdAt = e.createdAt
  return out
}

/** The detail intents' recentAudit rows: the same projection as the list. */
const projectAudit = projectAuditSummary

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

// ---------------------------------------------------------------------------
// Config values and projections (config/validate.go, project.go)
// ---------------------------------------------------------------------------

/** config.KnownType: one of the six types the write service supports. */
function knownConfigType(t) {
  return CONFIG_TYPES.includes(t)
}

const DURATION_UNITS = { ns: 1, us: 1e3, "µs": 1e3, "μs": 1e3, ms: 1e6, s: 1e9, m: 60e9, h: 3600e9 }

/**
 * time.ParseDuration: null when s parses, else Go's own error text. Go quotes
 * the input with strconv.Quote, which for the text a person types is JSON's
 * quoting.
 */
function durationRefusal(s) {
  const q = (x) => JSON.stringify(x)
  const invalid = () => `time: invalid duration ${q(s)}`
  let rest = s
  if (rest !== "" && (rest[0] === "-" || rest[0] === "+")) rest = rest.slice(1)
  if (rest === "0") return null
  if (rest === "") return invalid()
  let total = 0
  while (rest !== "") {
    if (!(rest[0] === "." || (rest[0] >= "0" && rest[0] <= "9"))) return invalid()
    const whole = /^\d*/.exec(rest)[0]
    rest = rest.slice(whole.length)
    let fraction = ""
    if (rest[0] === ".") {
      rest = rest.slice(1)
      fraction = /^\d*/.exec(rest)[0]
      rest = rest.slice(fraction.length)
    }
    // No digits at all, e.g. ".s".
    if (whole === "" && fraction === "") return invalid()
    const unit = /^[^.\d]*/.exec(rest)[0]
    if (unit === "") return `time: missing unit in duration ${q(s)}`
    rest = rest.slice(unit.length)
    if (!Object.hasOwn(DURATION_UNITS, unit)) return `time: unknown unit ${q(unit)} in duration ${q(s)}`
    total += (Number(whole === "" ? "0" : whole) + Number(`0.${fraction === "" ? "0" : fraction}`)) * DURATION_UNITS[unit]
    // A Duration is an int64 of nanoseconds.
    if (total > 9.223372036854775807e18) return invalid()
  }
  return null
}

/**
 * config.ValidateValue for a known type: the refusal text for a value that is
 * not acceptable, or null. A JSON number is a float64, so int takes one with no
 * fractional part up to 2^53 in magnitude. null is refused for every type but
 * json, where it is the JSON null. Callers check knownConfigType first.
 */
function configValueRefusal(t, v) {
  switch (t) {
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
    case "bool":
      return typeof v === "boolean" ? null : `must be a boolean, got ${describeValue(v)}`
    case "json":
      return null
    case "duration": {
      if (typeof v !== "string") return `must be a duration string such as "30s", got ${describeValue(v)}`
      const refusal = durationRefusal(v)
      return refusal === null ? null : `must be a duration such as "30s" or "1h30m": ${refusal}`
    }
    default:
      return `unknown type ${JSON.stringify(t)}`
  }
}

/** configValueMatchesType: a type the vault does not know never matches. */
function configValueMatchesType(t, v) {
  return knownConfigType(t) && configValueRefusal(t, wireValue(v)) === null
}

/**
 * sameValue: two values as the wire would show them, deep-compared. Object key
 * order does not matter.
 */
function sameValue(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]))
}

function projectConfigEntry(row) {
  return {
    id: row.id,
    key: row.key,
    value: wireValue(row.value),
    valueType: row.valueType,
    knownType: knownConfigType(row.valueType),
    valueMatchesType: configValueMatchesType(row.valueType, row.value),
    version: row.version,
    description: row.description,
    metadata: { ...row.metadata },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** A version keeps only its value, so it is judged against the entry's current type. */
function projectConfigVersion(v, row) {
  return {
    version: v.version,
    value: wireValue(v.value),
    valueMatchesType: configValueMatchesType(row.valueType, v.value),
    createdAt: v.createdAt,
    current: v.version === row.version,
  }
}

/** row is the key's entry, or undefined for an orphan, whose value can match no type. */
function projectConfigOverride(o, row) {
  return {
    key: o.key,
    tenantId: o.tenantId,
    value: wireValue(o.value),
    valueMatchesType: row !== undefined && configValueMatchesType(row.valueType, o.value),
    keyExists: row !== undefined,
    updatedAt: o.updatedAt,
  }
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
      ruleId: rule.id,
      priority: rule.priority,
      type: rule.type,
      matched,
      reached: true,
      note: ruleNote(rule, row.key, tenantId, userId, nowMs),
    })
    if (!matched) continue
    for (const rest of row.rules.slice(i + 1)) {
      trace.push({ ruleId: rest.id, priority: rest.priority, type: rest.type, matched: false, reached: false, note: "" })
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
  const EXPIRY_MESSAGE = 'expiry must be "", "expired", "7d" or "30d"'
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

  // tenantId is set on override rows only: the tenant that was overridden.
  function recordAudit(key, action, resource = "secret", tenantId = "", failure = undefined) {
    vault.audit.unshift({
      id: vault.nextId("aud"),
      resource,
      key,
      action,
      outcome: failure === undefined ? "success" : "failure",
      userId: "usr_1",
      createdAt: iso(Date.now()),
      ...(tenantId === "" ? {} : { tenantId }),
      ...(failure === undefined ? {} : { error: failure }),
    })
  }

  /** audit.list's limit: <= 0 gets the default, over 100 is capped, offset < 0 is 0. */
  function auditPageParams(payload) {
    let limit = wholeNumber(payload?.limit)
    if (limit <= 0) limit = DEFAULT_AUDIT_LIST_LIMIT
    if (limit > MAX_AUDIT_LIST_LIMIT) limit = MAX_AUDIT_LIST_LIMIT
    let offset = wholeNumber(payload?.offset)
    if (offset < 0) offset = 0
    return { limit, offset }
  }

  /** time.Parse(time.RFC3339, s): a T, a Z or a numeric offset, optional fractional seconds. */
  function parseRFC3339(raw) {
    const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
    return rfc3339.test(raw) ? Date.parse(raw) : Number.NaN
  }

  /**
   * The rows audit.ListOpts selects: exact resource, key, action and outcome,
   * created at or after since, and none whose action is excluded. Newest
   * first, as the fixture's log is already kept.
   */
  function matchingAudit({ resource, key, action, outcome, sinceMs, excludeActions }) {
    return vault.audit.filter(
      (e) =>
        (resource === "" || e.resource === resource) &&
        (key === "" || e.key === key) &&
        (action === "" || e.action === action) &&
        (outcome === "" || e.outcome === outcome) &&
        (sinceMs === null || Date.parse(e.createdAt) >= sinceMs) &&
        !excludeActions.includes(e.action),
    )
  }

  /** ListAuditByKey with a Resource: only the rows written for that kind of thing, newest first. */
  function recentAuditFor(key, resource, limit) {
    return vault.audit.filter((e) => e.resource === resource && e.key === key).slice(0, limit).map(projectAudit)
  }

  function newVersionRow(row, version) {
    // The row is stamped with the secret's algorithm before this is called,
    // as Secrets().Set records the algorithm it wrote the value with.
    const v = { id: vault.nextId("secver"), version, createdAt: iso(Date.now()), encryptionAlg: row.encryptionAlg }
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
    const field = `rules[${i}].${name}`
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
        if (pct < 0 || pct > 100) throw invalid(`rules[${i}].percentage`, "must be between 0 and 100")
        cfg.percentage = pct
        break
      }
      case "schedule":
        if (startAt === null && endAt === null) throw invalid(`rules[${i}].startAt`, "a schedule needs a start, an end, or both")
        if (startAt !== null && endAt !== null && !(Date.parse(startAt) < Date.parse(endAt))) {
          throw invalid(`rules[${i}].endAt`, "must be after the start")
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

  // -- config ---------------------------------------------------------------

  const configExists = () => conflict("a config entry with this key already exists")
  /** config.ValidationError as mapError sends it: "config: <field>: <message>", BAD_REQUEST. */
  const configInvalid = (field, message) => badRequest(`config: ${field}: ${message}`)
  /** configmgr.unsupportedType: an entry whose stored type the write service does not know. */
  const unsupportedConfigType = (t) => configInvalid("valueType", `this entry's type ${t} is not one the vault supports`)

  function findConfig(key) {
    const row = vault.configs.get(key)
    if (!row) throw new FixtureError(404, "NOT_FOUND", "config entry not found")
    return row
  }

  /** limit <= 0 gets the default, over the cap is capped, offset < 0 is 0. */
  function configPageParams(payload) {
    let limit = wholeNumber(payload?.limit)
    if (limit <= 0) limit = DEFAULT_CONFIG_LIST_LIMIT
    if (limit > MAX_CONFIG_LIST_LIMIT) limit = MAX_CONFIG_LIST_LIMIT
    return { limit, offset: Math.max(0, wholeNumber(payload?.offset)) }
  }

  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const byTenant = (a, b) => (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0)

  /** configmgr.validateTenant: trimmed, and required. */
  function configTenant(raw) {
    const tenantId = typeof raw === "string" ? raw.trim() : ""
    if (tenantId === "") throw configInvalid("tenantId", "is required")
    return tenantId
  }

  /** The manager's write: a new version whatever changed, the row otherwise kept whole, then the audit row. */
  function writeConfig(row, merged, action) {
    const now = iso(Date.now())
    row.valueType = merged.valueType
    row.value = structuredClone(merged.value)
    row.description = merged.description
    row.version += 1
    row.updatedAt = now
    row.versions.push({ version: row.version, value: structuredClone(merged.value), createdAt: now })
    recordAudit(row.key, action, "config")
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
        // One now per request. Validated before the store is read, so an
        // unknown value is BAD_REQUEST whatever else is on the request.
        const nowMs = Date.now()
        const expiry = payload?.expiry ?? ""
        let afterMs = null
        let beforeMs = null
        if (typeof expiry !== "string") throw badRequest(EXPIRY_MESSAGE)
        if (expiry === "expired") {
          beforeMs = nowMs
        } else if (expiry !== "") {
          if (!Object.hasOwn(EXPIRY_WINDOW_DAYS, expiry)) throw badRequest(EXPIRY_MESSAGE)
          afterMs = nowMs
          beforeMs = addDaysMs(nowMs, EXPIRY_WINDOW_DAYS[expiry])
        }

        let all = [...vault.secrets.values()]
        if (expiry === "") {
          all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        } else {
          // Only secrets with an expiry, soonest first, then by key.
          all = all
            .filter((r) => expiresWithin(r, afterMs, beforeMs))
            .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        }
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
      invalidates: ["secrets.list", "secrets.detail", "secrets.versions", "audit.list", "overview.stats"],
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
      invalidates: ["secrets.list", "secrets.detail", "secrets.versions", "audit.list", "overview.stats"],
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
      invalidates: ["secrets.list", "secrets.detail", "secrets.versions", "rotation.policies", "rotation.detail", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!vault.secrets.has(key)) {
          // A retry path: an orphan policy left by an earlier failed cleanup
          // still gets removed before the secret's own NOT_FOUND is answered.
          // A policy it removes is recorded like any other, and none removed
          // writes no row.
          if (vault.policies.delete(key)) recordAudit(key, "rotation.policy_deleted", "rotation")
          throw secretNotFound()
        }
        vault.secrets.delete(key)
        // Rotation records stay: the store deletes the secret's versions and,
        // through this handler, its policy, and nothing else.
        recordAudit(key, "secret.delete")
        if (vault.policies.delete(key)) recordAudit(key, "rotation.policy_deleted", "rotation")
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
        if (detail.matchedRule) {
          out.matchedRulePriority = detail.matchedRule.priority
          out.matchedRuleId = detail.matchedRule.id
        }
        out.trace = detail.trace
        if (tenantId !== "") out.bucket = rolloutBucket(tenantId, key)
        out.evaluatedAt = iso(nowMs)
        return out
      },
    },

    "flags.create": {
      kind: "command",
      invalidates: ["flags.list", "flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
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
      invalidates: ["flags.list", "flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
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
      invalidates: ["flags.list", "flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
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
      invalidates: ["flags.list", "flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
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
      invalidates: ["flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
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
      invalidates: ["flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
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
        recordAudit(key, "flag.override_set", "flag", tenantId)
        return { override: projectOverride(override, true) }
      },
    },

    "flags.deleteTenantOverride": {
      kind: "command",
      invalidates: ["flags.detail", "flags.evaluate", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findFlag(key)
        const tenantId = trimmedString(payload?.tenantId)
        if (tenantId === "") throw invalid("tenantId", "is required")
        if (!row.overrides.delete(tenantId)) throw overrideNotFound()
        recordAudit(key, "flag.override_deleted", "flag", tenantId)
        return { ok: true, key, tenantId }
      },
    },

    // -- config and overrides (handlers_config.go, configmgr/manager.go) -------

    "config.list": {
      kind: "query",
      handler: (payload) => {
        const { limit, offset } = configPageParams(payload)
        const prefix = trimmedString(payload?.keyPrefix)
        const all = [...vault.configs.values()].filter((r) => r.key.startsWith(prefix)).sort(byKey)
        return { entries: all.slice(offset, offset + limit).map(projectConfigEntry), total: all.length }
      },
    },

    "config.detail": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findConfig(key)
        const overrides = [...(vault.configOverrides.get(key)?.values() ?? [])].sort(byTenant)
        // A key's history is on two resources, the entry's own writes and its
        // overrides'. Go fetches each with the full limit and merges by time;
        // the fixture's audit list is already newest first, so the ten newest
        // of the two together are its first ten.
        const rows = vault.audit.filter((e) => (e.resource === "config" || e.resource === "override") && e.key === key)
        return {
          entry: projectConfigEntry(row),
          overrides: overrides.map((o) => projectConfigOverride(o, row)),
          recentAudit: rows.slice(0, RECENT_CONFIG_AUDIT_LIMIT).map(projectAudit),
        }
      },
    },

    "config.versions": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findConfig(key)
        const versions = [...row.versions].sort((a, b) => b.version - a.version)
        return { versions: versions.map((v) => projectConfigVersion(v, row)) }
      },
    },

    "config.resolve": {
      kind: "query",
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const tenantId = trimmedString(payload?.tenantId)
        const row = findConfig(key)
        const out = { value: wireValue(row.value), valueMatchesType: false, source: "appDefault", appValue: wireValue(row.value) }
        let valueForType = row.value
        const o = tenantId === "" ? undefined : vault.configOverrides.get(key)?.get(tenantId)
        if (o !== undefined) {
          out.value = wireValue(o.value)
          out.source = "override"
          // Present exactly when the override answered, whatever it holds: "",
          // false, 0 and null are values.
          out.overrideValue = wireValue(o.value)
          valueForType = o.value
        }
        out.valueMatchesType = configValueMatchesType(row.valueType, valueForType)
        if (tenantId !== "") out.tenantId = tenantId
        return out
      },
    },

    "overrides.list": {
      kind: "query",
      handler: (payload) => {
        const tenantId = trimmedString(payload?.tenantId)
        const key = trimmedString(payload?.key)
        if (tenantId === "" && key === "") throw badRequest("give a tenantId or a key")
        const { limit, offset } = configPageParams(payload)

        let all
        if (tenantId !== "" && key !== "") {
          const o = vault.configOverrides.get(key)?.get(tenantId)
          all = o === undefined ? [] : [o]
        } else if (tenantId !== "") {
          all = [...vault.configOverrides.values()].flatMap((byTenant) => (byTenant.has(tenantId) ? [byTenant.get(tenantId)] : [])).sort(byKey)
        } else {
          all = [...(vault.configOverrides.get(key)?.values() ?? [])].sort(byTenant)
        }
        // An orphan is listed, not hidden: keyExists false, valueMatchesType false.
        const page = all.slice(offset, offset + limit).map((o) => projectConfigOverride(o, vault.configs.get(o.key)))
        return { overrides: page, total: all.length }
      },
    },

    "config.create": {
      kind: "command",
      invalidates: ["config.list", "config.detail", "config.versions", "config.resolve", "overrides.list", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const valueType = trimmedString(payload?.valueType)
        if (valueType === "") throw badRequest("valueType is required")
        if (Buffer.byteLength(key) > MAX_CONFIG_KEY_BYTES) throw configInvalid("key", `must be at most ${MAX_CONFIG_KEY_BYTES} bytes`)
        if (!knownConfigType(valueType)) throw configInvalid("valueType", CONFIG_TYPE_LIST)
        // An absent value and a null one are both null, which only json takes.
        const value = wireValue(payload?.value)
        const refusal = configValueRefusal(valueType, value)
        if (refusal !== null) throw configInvalid("value", refusal)
        if (vault.configs.has(key)) throw configExists()

        // Overrides left for this key before the entry existed are live the
        // moment it is, so a new entry starts with none. They are cleared
        // without an audit row, as the manager does.
        vault.configOverrides.delete(key)
        const now = iso(Date.now())
        vault.configs.set(key, {
          id: vault.nextId("cfg"),
          key,
          valueType,
          value: structuredClone(value),
          description: typeof payload?.description === "string" ? payload.description : "",
          metadata: {},
          version: 1,
          createdAt: now,
          updatedAt: now,
          versions: [{ version: 1, value: structuredClone(value), createdAt: now }],
        })
        recordAudit(key, "config.set", "config")
        return { entry: projectConfigEntry(vault.configs.get(key)) }
      },
    },

    "config.update": {
      kind: "command",
      invalidates: ["config.list", "config.detail", "config.versions", "config.resolve", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        // Absent leaves the value; a present null is null, which only a json
        // entry accepts. valueType and description are pointers in Go, so a
        // null is absent for them.
        const hasValue = payload?.value !== undefined
        const newValue = payload?.value
        const newType = typeof payload?.valueType === "string" ? payload.valueType.trim() : undefined
        const newDescription = typeof payload?.description === "string" ? payload.description : undefined
        const row = findConfig(key)

        const merged = { valueType: row.valueType, value: row.value, description: row.description }
        if (newType !== undefined && newType !== row.valueType) {
          if (!knownConfigType(newType)) throw configInvalid("valueType", CONFIG_TYPE_LIST)
          if (!hasValue) throw configInvalid("valueType", "changing the type needs a value of that type")
          const refusal = configValueRefusal(newType, newValue)
          if (refusal !== null) throw configInvalid("value", refusal)
          // A tenant whose override is not a value of the new type would
          // silently read the caller's fallback instead. The first in tenant
          // order is named, and nothing is written.
          const overrides = [...(vault.configOverrides.get(key)?.values() ?? [])].sort(byTenant)
          for (const o of overrides) {
            if (configValueRefusal(newType, wireValue(o.value)) !== null) {
              throw configInvalid(
                "valueType",
                `tenant ${o.tenantId} has an override of ${describeValue(o.value)}, which is not a valid ${newType}; change or revert it first`,
              )
            }
          }
          merged.valueType = newType
          merged.value = newValue
        } else if (hasValue) {
          if (!knownConfigType(row.valueType)) throw unsupportedConfigType(row.valueType)
          const refusal = configValueRefusal(row.valueType, newValue)
          if (refusal !== null) throw configInvalid("value", refusal)
          merged.value = newValue
        }
        if (newDescription !== undefined) merged.description = newDescription

        // Asking for what the entry already holds writes, audits and versions nothing.
        if (merged.valueType === row.valueType && merged.description === row.description && sameValue(merged.value, row.value)) {
          return { entry: projectConfigEntry(row) }
        }
        writeConfig(row, merged, "config.set")
        return { entry: projectConfigEntry(row) }
      },
    },

    "config.rollback": {
      kind: "command",
      invalidates: ["config.list", "config.detail", "config.versions", "config.resolve", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        const row = findConfig(key)
        const version = typeof payload?.version === "number" ? Math.trunc(payload.version) : 0
        const target = row.versions.find((v) => v.version === version)
        if (target === undefined) throw new FixtureError(404, "NOT_FOUND", "config version not found")
        if (!knownConfigType(row.valueType)) throw unsupportedConfigType(row.valueType)
        if (configValueRefusal(row.valueType, wireValue(target.value)) !== null) {
          throw configInvalid("version", `version ${version} holds ${describeValue(target.value)}, not a ${row.valueType}`)
        }
        // The entry keeps its type, description and metadata and takes the old
        // value as a new version. The value it already holds writes nothing.
        if (sameValue(target.value, row.value)) return { entry: projectConfigEntry(row) }
        writeConfig(row, { valueType: row.valueType, value: target.value, description: row.description }, "config.rolled_back")
        return { entry: projectConfigEntry(row) }
      },
    },

    "config.delete": {
      kind: "command",
      invalidates: ["config.list", "config.detail", "config.versions", "config.resolve", "overrides.list", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        findConfig(key)
        // Overrides go first and the entry last, so a failure part way leaves
        // the entry and a retry finishes the job. Neither an override's removal
        // nor the entry's versions get an audit row of their own.
        vault.configOverrides.delete(key)
        vault.configs.delete(key)
        recordAudit(key, "config.deleted", "config")
        return { ok: true, key }
      },
    },

    "overrides.set": {
      kind: "command",
      invalidates: ["config.detail", "config.resolve", "overrides.list", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        // A missing value is refused; null and "" are values.
        if (payload?.value === undefined) throw badRequest("value is required")
        const row = findConfig(key)
        const tenantId = configTenant(payload?.tenantId)
        if (!knownConfigType(row.valueType)) throw unsupportedConfigType(row.valueType)
        const refusal = configValueRefusal(row.valueType, payload.value)
        if (refusal !== null) throw configInvalid("value", refusal)

        const byTenant = vault.configOverrides.get(key) ?? new Map()
        const now = iso(Date.now())
        // An existing override keeps its id and creation time.
        const existing = byTenant.get(tenantId)
        const o = { id: existing?.id ?? vault.nextId("ovr"), key, tenantId, value: structuredClone(payload.value), createdAt: existing?.createdAt ?? now, updatedAt: now }
        byTenant.set(tenantId, o)
        vault.configOverrides.set(key, byTenant)
        recordAudit(key, "override.set", "override", tenantId)
        return { override: projectConfigOverride(o, row) }
      },
    },

    "overrides.delete": {
      kind: "command",
      invalidates: ["config.detail", "config.resolve", "overrides.list", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        // The entry is not read: an override whose entry is gone still
        // resolves for its tenant, so it has to be removable. A tenant with no
        // override is not found, whether or not the key exists.
        const tenantId = configTenant(payload?.tenantId)
        const byTenant = vault.configOverrides.get(key)
        if (!byTenant?.delete(tenantId)) throw overrideNotFound()
        recordAudit(key, "override.deleted", "override", tenantId)
        return { ok: true, key, tenantId }
      },
    },

    "audit.list": {
      kind: "query",
      handler: (payload) => {
        const resource = trimmedString(payload?.resource)
        const key = trimmedString(payload?.key)
        const action = trimmedString(payload?.action)
        const outcome = trimmedString(payload?.outcome)
        if (outcome !== "" && outcome !== "success" && outcome !== "failure") throw badRequest("outcome must be success or failure")
        let sinceMs = null
        const since = trimmedString(payload?.since)
        if (since !== "") {
          sinceMs = parseRFC3339(since)
          if (Number.isNaN(sinceMs)) throw badRequest("since must be an RFC3339 time")
        }
        // The exclusion is the default view's, not a rule about reads: a
        // caller who names an action has said which rows they want.
        const excludeActions = payload?.includeReads !== true && action === "" ? [SECRET_READ_ACTION] : []
        const { limit, offset } = auditPageParams(payload)

        // The total and the page come from the same filter, so they always
        // describe the same rows.
        const matched = matchingAudit({ resource, key, action, outcome, sinceMs, excludeActions })
        return { entries: matched.slice(offset, offset + limit).map(projectAuditSummary), total: matched.length }
      },
    },

    "overview.stats": {
      kind: "query",
      handler: () => {
        const nowMs = Date.now()
        const secrets = [...vault.secrets.values()]
        let configOverrides = 0
        for (const byTenant of vault.configOverrides.values()) configOverrides += byTenant.size

        // Every rotation figure comes from the one policy list, so the total
        // and its subsets agree.
        const policies = [...vault.policies.values()]
        let rotationEnabled = 0
        let rotationOverdue = 0
        let rotationWithoutRotator = 0
        for (const p of policies) {
          if (!p.enabled) continue
          rotationEnabled += 1
          if (!ROTATOR_KEYS.has(p.secretKey)) {
            rotationWithoutRotator += 1
            continue
          }
          if (p.nextRotationAt && Date.parse(p.nextRotationAt) < nowMs) rotationOverdue += 1
        }

        const rotationFailures24h = matchingAudit({
          resource: "",
          key: "",
          action: "secret.rotated",
          outcome: "failure",
          sinceMs: nowMs - ROTATION_FAILURE_WINDOW_MS,
          excludeActions: [],
        }).length

        return {
          secrets: secrets.length,
          unencryptedSecrets: secrets.filter((r) => r.encryptionAlg === "").length,
          // Earlier version rows, not secrets: each secret's current version
          // is left out, since unencryptedSecrets already covers it. "" is
          // stored in the clear, null was written before versions recorded
          // an algorithm.
          plaintextVersions: secrets.reduce((n, r) => n + earlierVersions(r).filter((v) => v.encryptionAlg === "").length, 0),
          unrecordedVersions: secrets.reduce((n, r) => n + earlierVersions(r).filter((v) => v.encryptionAlg === null).length, 0),
          expiredSecrets: secrets.filter((r) => expiresWithin(r, null, nowMs)).length,
          expiringSecrets: secrets.filter((r) => expiresWithin(r, nowMs, addDaysMs(nowMs, EXPIRING_SOON_DAYS))).length,
          flags: vault.flags.size,
          configEntries: vault.configs.size,
          configOverrides,
          rotationPolicies: policies.length,
          rotationEnabled,
          rotationOverdue,
          rotationWithoutRotator,
          rotationFailures24h,
          // This fixture models a keyed vault, as secrets.update does.
          encryptionEnabled: true,
          encryptionAlgorithm: ENCRYPTION_ALG,
          recentActivity: matchingAudit({ resource: "", key: "", action: "", outcome: "", sinceMs: null, excludeActions: [SECRET_READ_ACTION] })
            .slice(0, OVERVIEW_RECENT_ACTIVITY_LIMIT)
            .map(projectAuditSummary),
        }
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
      invalidates: ["rotation.policies", "rotation.detail", "secrets.detail", "audit.list", "overview.stats"],
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
        recordAudit(key, "rotation.policy_saved", "rotation")
        return { policy: projectPolicy(policy) }
      },
    },

    "rotation.deletePolicy": {
      kind: "command",
      invalidates: ["rotation.policies", "rotation.detail", "secrets.detail", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!vault.policies.delete(key)) throw policyNotFound()
        recordAudit(key, "rotation.policy_deleted", "rotation")
        return { ok: true, key }
      },
    },

    "rotation.rotateNow": {
      kind: "command",
      invalidates: ["rotation.policies", "rotation.detail", "secrets.list", "secrets.detail", "secrets.versions", "audit.list", "overview.stats"],
      handler: (payload) => {
        const key = requireKey(payload?.key)
        if (!ROTATOR_KEYS.has(key)) {
          throw badRequest("no rotator is registered for this secret; rotators are registered in application code")
        }
        const row = findSecret(key)

        // Go's Manager.RotateNow reads the current value first (an access row),
        // and a rotator that fails stops it there: no new version, no record,
        // no policy stamp. The manager's onRotate hook still writes its one
        // row per attempt, this one a failure naming the operator with the
        // wrapped error. The client is told what mapError tells it for an
        // error that is not a domain sentinel: INTERNAL, and nothing of the
        // cause.
        const cause = FAILING_ROTATOR_KEYS.get(key)
        if (cause !== undefined) {
          recordAudit(key, "secret.get")
          recordAudit(key, "secret.rotated", "secret", "", `rotation: rotator failed for "${key}": ${cause}`)
          throw new FixtureError(500, "INTERNAL", "an internal error occurred")
        }

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
        // The manager's onRotate hook: one row per attempt, this one a success.
        recordAudit(key, "secret.rotated")
        return { key, oldVersion, newVersion: row.version }
      },
    },
  }
}
