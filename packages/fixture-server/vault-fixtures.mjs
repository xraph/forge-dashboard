// vault-fixtures.mjs: in-memory state and intent handlers for the vault
// contributor (packages/plugin-vault), kept out of server.mjs like
// warden-fixtures.mjs.
//
// Mirrors forgery/vault/extension/contract (handlers_secrets.go,
// handlers_rotation.go, project.go, errors.go). Field names are the Go JSON
// tags, and every rule below is the Go handler's rule, in the Go handler's
// order, so a refusal here is a refusal there.
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
// `value`, check that it is a non-empty string, and drop it.

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
//   - Expiries: one comfortably in the future, one soon, one already passed.
//   - Metadata on two secrets.
//   - Three policies: enabled with a rotator, enabled WITHOUT a rotator (it
//     will never rotate), and disabled (no next rotation to show).
//   - Rotation records on the rotatable, enabled one, with a version history
//     that matches them.
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

  const state = { nextId, secrets: new Map(), policies: new Map(), records: new Map(), audit: [] }

  const pushAudit = (key, action, at, userId) => {
    state.audit.push({ id: nextId("aud"), key, action, outcome: "success", userId, createdAt: iso(at) })
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

  pushAudit("db/primary.password", "secret.rotated", nowMs - 2 * hour, "")
  pushAudit("db/primary.password", "secret.accessed", nowMs - 90 * 60_000, "usr_1")
  pushAudit("api/stripe.key", "secret.accessed", nowMs - 30 * 60_000, "usr_1")
  pushAudit("legacy/ftp.password", "secret.set", nowMs - 5 * 60_000, "usr_1")
  state.audit.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return state
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

  function recordAudit(key, action) {
    vault.audit.unshift({ id: vault.nextId("aud"), key, action, outcome: "success", userId: "usr_1", createdAt: iso(Date.now()) })
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
          recentAudit: vault.audit.filter((e) => e.key === key).slice(0, RECENT_AUDIT_LIMIT).map(projectAudit),
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
      invalidates: ["secrets.list"],
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

        // encryptionAlg is left as it was. A keyed vault would re-encrypt the
        // legacy unencrypted row on rewrite; the fixture keeps that row
        // unencrypted so the state stays reachable after an edit.
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
        // The fixture also drops the secret's rotation records, so a key
        // created again later does not inherit a history it never had.
        vault.records.delete(key)
        recordAudit(key, "secret.deleted")
        return { ok: true, key }
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
          // New, interval changed, or disabled-to-enabled gets a first due
          // time; every other save keeps the stored one, and lastRotatedAt.
          giveNextDueTime = policy.intervalSeconds !== interval || (!policy.enabled && enabled)
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

        // Expiry and metadata are carried forward, untouched.
        const oldVersion = row.version
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
        recordAudit(key, "secret.rotated")
        return { key, oldVersion, newVersion: row.version }
      },
    },
  }
}
