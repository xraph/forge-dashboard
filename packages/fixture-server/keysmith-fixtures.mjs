// keysmith-fixtures.mjs: in-memory state and intent handlers for the keysmith
// contributor (packages/plugin-keysmith), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors forgery/keysmith/extension/contract (tenant.go, project.go, load.go,
// handlers_keys.go, handlers_pickers.go, handlers_key_create.go,
// handlers_key_rotate.go, handlers_key_state.go, handlers_key_scopes.go,
// handlers_policies.go, handlers_policy_write.go, handlers_scope_write.go,
// handlers_rotations.go, handlers_usage.go, handlers_overview.go,
// handlers_settings.go, enforcement.go and manifest.yaml). Field names are the
// Go JSON tags, and every rule below is the Go handler's rule, in the Go
// handler's order, so a refusal here is a refusal there. Every write changes
// the state the next read answers from.
//
// The module is self-contained and imports nothing from server.mjs. The one
// thing it needs from there is the FixtureError class: server.mjs's dispatch
// catch tests `err instanceof FixtureError` against its own class, and a
// same-named class declared here would be a different constructor, so every
// refusal would reach the wire as 400/BAD_REQUEST. server.mjs therefore hands
// its class to createKeysmithHandlers.
//
// No raw key and no hash is ever stored, logged or returned by a read. Only
// keys.create and keys.rotate answer a raw key, once, in their own response;
// the state keeps just the hint (the last four characters of the raw key).
// Both are registered `secret`, as keysmith registers them with forge's
// SecretResponse, so the idempotency store keeps no copy either: a repeat of
// either one under the same idempotency key answers CONFLICT and creates
// nothing.
//
// The fixture's own stand-ins:
//   - There is no principal in the fixture. FIXTURE_KEYSMITH_TENANT stands in
//     for Deps.DefaultTenantID (default "acme"); set it to the empty string to
//     see the refusal a deployment with no tenant configured gets.
//   - With no signed-in user either, FIXTURE_OPERATOR stands in for the
//     principal's subject: it is the createdBy of a new key and the rotatedBy of
//     a rotation record.
//   - Times in the seed are relative to module load, and resetKeysmith()
//     recomputes them.
//   - There is no rate limiter either. FIXTURE_KEYSMITH_RATE_LIMITER=1 stands
//     in for an engine built with one (rateLimiterConfigured); the default is
//     none, so a policy's rate limit reads as stored but not enforced.
//   - settings has no extension to ask. FIXTURE_KEYSMITH_PLUGINS (comma
//     separated, default "audit-hook") stands in for the hook plugins, and
//     FIXTURE_KEYSMITH_STORE_DOWN=1 for a store that does not answer its health
//     check. There is no principal to carry a tenant claim, so settings says
//     the tenant came from config, or from the session's org (tenantSource
//     "scope") under FIXTURE_KEYSMITH_TENANT_SOURCE=scope. Only the label
//     changes: either way the tenant is FIXTURE_KEYSMITH_TENANT.
//   - Usage has no write here. The seed records 30 days of acme requests for
//     the Billing service and Reporting export keys from a fixed pseudo-random
//     sequence, so the same start time always gives the same rows. globex has
//     none, so FIXTURE_KEYSMITH_TENANT=globex shows usage as not recorded.

import { randomBytes } from "node:crypto"
import { isIP } from "node:net"

// Stands in for the signed-in user (see above).
const FIXTURE_OPERATOR = "usr_fixture"

const DEFAULT_LIST_LIMIT = 25
const MAX_LIST_LIMIT = 100
// The pickers feed select boxes that want every row in one go.
const DEFAULT_PICKER_LIMIT = 100
const MAX_PICKER_LIMIT = 200
const MAX_KEY_NAME_LENGTH = 200
// Counted in code points, as Go counts runes.
const MAX_KEY_DESCRIPTION_LENGTH = 1000
const MAX_REVOKE_REASON_LENGTH = 500
// 90 days, the longest grace window a rotation may ask for.
const MAX_GRACE_SECONDS = 7_776_000
// The engine's own grace when neither the request nor the key's policy names one.
const DEFAULT_GRACE_MS = 24 * 3600_000
const ROTATE_REASONS = ["manual", "compromise", "policy"]
// No underscore on purpose: the key is prefix_environment_random.
const KEY_PREFIX_PATTERN = /^[a-z][a-z0-9]{1,15}$/
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
// An active key counts as expiring soon inside this window.
const EXPIRES_SOON_WINDOW_MS = 7 * 24 * 3600_000

// handlers_policy_write.go. Durations are capped in seconds.
const MAX_POLICY_NAME_LENGTH = 200
const MAX_POLICY_DESCRIPTION_LENGTH = 1000
const MAX_POLICY_LIST_ENTRIES = 100
// 10 years of 365 days: maxKeyLifetimeSeconds and rotationPeriodSeconds.
const MAX_POLICY_LIFETIME_SECONDS = 10 * 365 * 24 * 3600
const MAX_POLICY_GRACE_SECONDS = 90 * 24 * 3600
const MAX_POLICY_WINDOW_SECONDS = 31 * 24 * 3600
// rateLimit and burstLimit.
const MAX_POLICY_RATE = 1_000_000_000
const POLICY_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

// handlers_scope_write.go.
const MAX_SCOPE_NAME_LENGTH = 100
const MAX_SCOPE_DESCRIPTION_LENGTH = 1000
// The most children a refused scope delete counts by number.
const MAX_SCOPE_CHILD_COUNT = 200

const ENVIRONMENTS = ["live", "test", "staging"]
// The engine never assigns "rotated", so it is not a filter.
const STATES = ["active", "suspended", "revoked", "expired"]

// A TypeID suffix's alphabet: lowercase Crockford base32. The usage seed needs
// it before the TypeID helpers below.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"

// handlers_rotations.go: every reason a record can carry, "scheduled" included.
const ROTATION_REASONS = ["manual", "compromise", "policy", "scheduled"]

// handlers_usage.go: the most buckets one usage.series answer holds.
const MAX_USAGE_BUCKETS = 400
const USAGE_PERIODS = ["hourly", "daily", "monthly"]

// handlers_overview.go: how many keys and rotations the overview lists.
const OVERVIEW_RECENT = 5

// handlers_settings.go. The grace RotateKey gives when nothing names one, in
// seconds, and the two fixed sentences about the store.
const DEFAULT_GRACE_SECONDS = DEFAULT_GRACE_MS / 1000
const STORE_ANSWERED = "The store answered."
const STORE_DID_NOT_REPLY = "The store did not answer. The error is in the server log."

// enforcement.go: the policy editor's fields in its order, groups top to
// bottom. `when` names the engine path that checks the field, and goes out
// only when the field is enforced.
const POLICY_FIELD_COUNT = 13
const ENFORCEMENT_ROWS = [
  { field: "maxKeyLifetimeSeconds", label: "Max key lifetime", group: "keysmith", when: "when a key is created" },
  { field: "graceSeconds", label: "Grace on rotation", group: "keysmith", when: "when a key is rotated" },
  { field: "allowedScopes", label: "Allowed scopes", group: "keysmith", when: "when a key is created or its scopes are assigned" },
  { field: "rateLimit", label: "Rate limit", group: "rateLimiter", when: "when a key is validated" },
  { field: "rateLimitWindowSeconds", label: "Window", group: "rateLimiter", when: "when a key is validated" },
  { field: "burstLimit", label: "Burst limit", group: "application", when: "" },
  { field: "rotationPeriodSeconds", label: "Rotation period", group: "application", when: "" },
  { field: "dailyQuota", label: "Daily quota", group: "application", when: "" },
  { field: "monthlyQuota", label: "Monthly quota", group: "application", when: "" },
  { field: "allowedIps", label: "Allowed IPs", group: "application", when: "" },
  { field: "allowedOrigins", label: "Allowed origins", group: "application", when: "" },
  { field: "allowedPaths", label: "Allowed paths", group: "application", when: "" },
  { field: "allowedMethods", label: "Allowed methods", group: "application", when: "" },
]

/** RFC3339 in UTC, without fractional seconds, like the Go projection. */
function iso(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z")
}

// Go's string rules, for the policy and scope writes. JavaScript's own differ
// at the edges: trim() strips U+FEFF and keeps U+0085, sort() compares UTF-16
// code units, and JSON.stringify leaves control and format characters such as
// U+00A0 and U+2028 unescaped.

// unicode.IsSpace: the Latin-1 spaces plus the White_Space property.
const GO_SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000"
const GO_TRIM = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, "g")
const GO_HAS_SPACE = new RegExp(`[${GO_SPACE}]`)

/** strings.TrimSpace. */
const goTrimSpace = (s) => s.replace(GO_TRIM, "")

/** utf8.RuneCountInString. */
const runeCount = (s) => [...s].length

/** Go's string order: byte order of the UTF-8 encoding. */
const byteCompare = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))

/** strings.ToUpper: a simple per-rune mapping, so "ß" stays one rune. */
function goToUpper(s) {
  let out = ""
  for (const ch of s) {
    const up = ch.toUpperCase()
    out += [...up].length === 1 ? up : ch
  }
  return out
}

// strconv.IsPrint: letters, marks, numbers, punctuation, symbols and the ASCII space.
const GO_PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u
const GO_ESCAPES = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v" }

/** strconv.Quote. */
function goQuote(s) {
  let out = '"'
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (ch === '"' || ch === "\\") out += `\\${ch}`
    else if (GO_PRINTABLE.test(ch)) out += ch
    else if (GO_ESCAPES[ch]) out += GO_ESCAPES[ch]
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, "0")}`
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, "0")}`
    else out += `\\U${cp.toString(16).padStart(8, "0")}`
  }
  return `${out}"`
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/** Seed IDs in keysmith's TypeID shape: a prefix and 26 lowercase base32 characters. */
export const KEYSMITH_IDS = {
  // acme
  billingKey: "akey_01j9k4m2e7t8x3q5r6v0w1y2za",
  reportingKey: "akey_01j9k4m2e8f9d4n6s7w1x2z3ab",
  webhookKey: "akey_01j9k4m2e9g0e5p7t8x2y3a4bc",
  partnerKey: "akey_01j9k4m2eah1f6q8v9y3z4b5cd",
  mobileKey: "akey_01j9k4m2ebj2g7r9w0z4a5c6de",
  // points at globexPolicy, so its detail answers policy: null
  globexLinkedKey: "akey_01j9k4m2edm4j9t1y2b6c7e8fg",
  standardPolicy: "kpol_01j9k4m1zza0b1c2d3e4f5g6h7",
  // sets neither a grace period nor a max lifetime
  openPolicy: "kpol_01j9k4m1zxc2d3e4f5g6h7j8k9",
  // used only by the revoked "Old mobile app" key, so its delete succeeds
  retiredPolicy: "kpol_01j9k4m1zwd3e4f5g6h7j8k9m0",
  // globex: must never reach acme
  globexKey: "akey_01j9k4m2eck3h8s0x1a5b6d7ef",
  globexPolicy: "kpol_01j9k4m1zyb1c2d3e4f5g6h7j8",
  // the scope store: acme's seven, globex's one
  scopeBillingRead: "kscp_01j9k4m1yaa1b2c3d4e5f6g7h8",
  scopeBillingWrite: "kscp_01j9k4m1yab2c3d4e5f6g7h8j9",
  scopeReportsRead: "kscp_01j9k4m1yac3d4e5f6g7h8j9k0",
  scopeCatalogRead: "kscp_01j9k4m1yad4e5f6g7h8j9k0m1",
  scopeAdminAll: "kscp_01j9k4m1yae5f6g7h8j9k0m1n2",
  scopeGlobexInternal: "kscp_01j9k4m1yaf6g7h8j9k0m1n2p3",
  // the parent of billing:read and billing:write, so its delete refuses
  scopeBilling: "kscp_01j9k4m1yag7h8j9k0m1n2p3q4",
  // held by no key and allowed by no policy, so its delete succeeds
  scopeLegacyRead: "kscp_01j9k4m1yah8j9k0m1n2p3q4r5",
  // billingKey's rotations: one open window, one whose grace has ended
  openRotation: "krot_01j9k4m3aac2d3e4f5g6h7j8k9",
  closedRotation: "krot_01j9k4m3abd3e4f5g6h7j8k9m0",
  // partnerKey is suspended with its expiry ahead, so its window stays open
  partnerRotation: "krot_01j9k4m3ace4f5g6h7j8k9m0n1",
  // webhookKey's expiry has passed, so its window is closed with grace left
  webhookRotation: "krot_01j9k4m3adf5g6h7j8k9m0n1p2",
  // names goneKey, which no longer exists, and predates hints
  goneKeyRotation: "krot_01j9k4m3aeg6h7j8k9m0n1p2q3",
  globexRotation: "krot_01j9k4m3afh7j8k9m0n1p2q3r4",
  // a key deleted outside the contract: no row has this id
  goneKey: "akey_01j9k4m2efn5k0v2z3c7d8f9gh",
}

function seedKeysmithState() {
  const now = Date.now()
  const hour = 3600_000
  const day = 24 * hour

  // A policy row. Durations are milliseconds and 0 is "not set" to the
  // engine, as are counts of 0; lists are empty when unset.
  const policyRow = (fields) => ({
    description: "",
    maxKeyLifetime: 0,
    gracePeriod: 0,
    allowedScopes: [],
    rateLimit: 0,
    rateLimitWindow: 0,
    burstLimit: 0,
    allowedIps: [],
    allowedOrigins: [],
    allowedMethods: [],
    allowedPaths: [],
    rotationPeriod: 0,
    dailyQuota: 0,
    monthlyQuota: 0,
    ...fields,
    updatedAt: fields.updatedAt ?? fields.createdAt,
  })

  const policies = new Map()
  policies.set(
    KEYSMITH_IDS.standardPolicy,
    policyRow({
      id: KEYSMITH_IDS.standardPolicy,
      tenantId: "acme",
      name: "Standard",
      description: "Ninety day keys with a day to roll over",
      maxKeyLifetime: 90 * day,
      gracePeriod: day,
      // A key under this policy may not hold admin:all.
      allowedScopes: ["billing:read", "billing:write", "reports:read", "catalog:read"],
      // Stored only: the fixture has no rate limiter unless
      // FIXTURE_KEYSMITH_RATE_LIMITER=1, and nothing enforces the rest.
      rateLimit: 100,
      rateLimitWindow: 60_000,
      burstLimit: 20,
      allowedMethods: ["GET", "POST"],
      dailyQuota: 10_000,
      createdAt: now - 120 * day,
      updatedAt: now - 30 * day,
    }),
  )
  // 0 is "not set" to the engine: no maximum lifetime, and rotation falls back
  // to a 24 hour grace. The contract sends both as null. An empty
  // allowedScopes means the policy does not restrict scopes.
  policies.set(
    KEYSMITH_IDS.openPolicy,
    policyRow({ id: KEYSMITH_IDS.openPolicy, tenantId: "acme", name: "Open", createdAt: now - 60 * day }),
  )
  // Only the revoked mobile key uses it, so nothing blocks its delete. It
  // still allows devices:read, a name the scope store no longer has: an edit
  // keeps a stored name like that and refuses only names it adds.
  policies.set(
    KEYSMITH_IDS.retiredPolicy,
    policyRow({
      id: KEYSMITH_IDS.retiredPolicy,
      tenantId: "acme",
      name: "Retired",
      description: "The first mobile app's keys",
      maxKeyLifetime: 365 * day,
      allowedScopes: ["devices:read"],
      createdAt: now - 300 * day,
    }),
  )
  policies.set(
    KEYSMITH_IDS.globexPolicy,
    policyRow({
      id: KEYSMITH_IDS.globexPolicy,
      tenantId: "globex",
      name: "Globex standard",
      maxKeyLifetime: 30 * day,
      gracePeriod: 2 * hour,
      allowedScopes: ["internal:all"],
      createdAt: now - 90 * day,
    }),
  )

  // The scope store. A key's own scopes live on its row below, as a stand-in
  // for the key-scope join; some seed keys hold names that are not in here,
  // as they can in Go (the join stores names).
  const scopes = [
    { id: KEYSMITH_IDS.scopeBillingRead, tenantId: "acme", name: "billing:read", parent: "billing", description: "Read invoices and charges" },
    { id: KEYSMITH_IDS.scopeBillingWrite, tenantId: "acme", name: "billing:write", parent: "billing", description: "Create charges and refunds" },
    { id: KEYSMITH_IDS.scopeReportsRead, tenantId: "acme", name: "reports:read", description: "Read and export reports" },
    { id: KEYSMITH_IDS.scopeCatalogRead, tenantId: "acme", name: "catalog:read", description: "Read the product catalog" },
    { id: KEYSMITH_IDS.scopeAdminAll, tenantId: "acme", name: "admin:all", description: "Everything. Policies that list allowed scopes refuse it." },
    { id: KEYSMITH_IDS.scopeBilling, tenantId: "acme", name: "billing", description: "Groups the billing scopes" },
    { id: KEYSMITH_IDS.scopeLegacyRead, tenantId: "acme", name: "legacy:read", description: "Read the old v1 API" },
    { id: KEYSMITH_IDS.scopeGlobexInternal, tenantId: "globex", name: "internal:all", description: "Globex internal services" },
  ]

  // state is the stored state. expiresAt, lastUsedAt, rotatedAt, revokedAt are
  // null when unset. scopes come from the scope store in Go, so they live on
  // the row here only as a stand-in for that store.
  const keys = [
    {
      id: KEYSMITH_IDS.billingKey,
      tenantId: "acme",
      name: "Billing service",
      description: "Charges and invoices from the billing worker",
      prefix: "sk",
      hint: "a91f",
      environment: "live",
      state: "active",
      policyId: KEYSMITH_IDS.standardPolicy,
      scopes: ["billing:read", "billing:write"],
      createdBy: "usr_1",
      expiresAt: now + 50 * day,
      lastUsedAt: now - 12 * 60_000,
      rotatedAt: now - 2 * hour,
      revokedAt: null,
      createdAt: now - 40 * day,
      updatedAt: now - 2 * hour,
      metadata: { owner: "payments", ticket: "PAY-412" },
    },
    {
      id: KEYSMITH_IDS.reportingKey,
      tenantId: "acme",
      name: "Reporting export",
      prefix: "sk",
      hint: "3d0b",
      environment: "test",
      state: "active",
      policyId: KEYSMITH_IDS.openPolicy,
      scopes: ["reports:read"],
      createdBy: "usr_2",
      // A policy with no max lifetime leaves an explicit expiry alone.
      expiresAt: now + 3 * day,
      lastUsedAt: null,
      rotatedAt: null,
      revokedAt: null,
      createdAt: now - 25 * day,
      updatedAt: now - 25 * day,
    },
    {
      // Stored active, but the expiry has passed and nothing has written
      // "expired" yet: effective state expired, expiryPending true.
      id: KEYSMITH_IDS.webhookKey,
      tenantId: "acme",
      name: "Legacy webhook signer",
      prefix: "whk",
      hint: "e5c2",
      environment: "live",
      state: "active",
      policyId: null,
      scopes: [],
      createdBy: "usr_1",
      expiresAt: now - 2 * day,
      lastUsedAt: now - 3 * day,
      rotatedAt: now - 3 * day,
      revokedAt: null,
      createdAt: now - 100 * day,
      updatedAt: now - 3 * day,
    },
    {
      id: KEYSMITH_IDS.partnerKey,
      tenantId: "acme",
      name: "Partner sandbox",
      prefix: "pk",
      hint: "42ad",
      environment: "staging",
      state: "suspended",
      policyId: KEYSMITH_IDS.standardPolicy,
      scopes: ["catalog:read"],
      createdBy: "usr_2",
      // CreateKey gives a key whose policy sets a max lifetime the expiry
      // createdAt + maxKeyLifetime (90 days), so a policy-bound key never has none.
      expiresAt: now - 15 * day + 90 * day,
      lastUsedAt: now - 9 * day,
      rotatedAt: now - 10 * day,
      revokedAt: null,
      createdAt: now - 15 * day,
      updatedAt: now - 8 * day,
    },
    {
      id: KEYSMITH_IDS.mobileKey,
      tenantId: "acme",
      name: "Old mobile app",
      prefix: "sk",
      hint: "b7f8",
      environment: "live",
      state: "revoked",
      // A revoked key does not hold its policy: the Retired policy deletes,
      // and this key keeps the policyId.
      policyId: KEYSMITH_IDS.retiredPolicy,
      scopes: ["devices:read"],
      createdBy: "usr_1",
      expiresAt: null,
      lastUsedAt: now - 11 * day,
      rotatedAt: null,
      revokedAt: now - 10 * day,
      createdAt: now - 200 * day,
      updatedAt: now - 10 * day,
    },
    {
      // An acme key whose row points at globex's policy. The engine does not
      // check a policy's tenant; the contract's keys.create does, and refuses
      // another tenant's policy with the same "policy not found" as a missing
      // one. So in Go only a direct store write gets here. The tenant guard in
      // keys.detail answers policy: null and the key keeps its policyId.
      id: KEYSMITH_IDS.globexLinkedKey,
      tenantId: "acme",
      name: "Globex-linked import",
      prefix: "imp",
      hint: "5f3a",
      environment: "live",
      state: "active",
      policyId: KEYSMITH_IDS.globexPolicy,
      scopes: ["imports:write"],
      createdBy: "usr_1",
      expiresAt: null,
      lastUsedAt: now - 5 * hour,
      rotatedAt: null,
      revokedAt: null,
      createdAt: now - 6 * day,
      updatedAt: now - 6 * day,
    },
    {
      id: KEYSMITH_IDS.globexKey,
      tenantId: "globex",
      name: "Globex internal",
      prefix: "sk",
      hint: "0c9e",
      environment: "live",
      state: "active",
      policyId: null,
      scopes: ["internal:all"],
      createdBy: "usr_9",
      expiresAt: null,
      lastUsedAt: now - hour,
      rotatedAt: now - 5 * day,
      revokedAt: null,
      createdAt: now - 30 * day,
      updatedAt: now - 5 * day,
    },
  ]

  // Rotation records. graceMs is the window the rotation recorded (0 is a
  // real zero-grace rotation) and graceEnds where it ends now; keys.endGrace
  // moves graceEnds only. rotatedBy is "" when nobody was recorded. A window is
  // open by projectRotationItem's rule: the key is in the tenant and not
  // finished, the record kept an old hint, and its grace has not ended.
  const rotation = (fields) => ({ newHint: "", rotatedBy: "", ...fields, graceEnds: fields.createdAt + fields.graceMs })
  const rotations = [
    rotation({
      id: KEYSMITH_IDS.openRotation,
      tenantId: "acme",
      keyId: KEYSMITH_IDS.billingKey,
      reason: "manual",
      oldHint: "7c1e",
      newHint: "a91f",
      rotatedBy: "usr_1",
      createdAt: now - 2 * hour,
      // The Standard policy's day.
      graceMs: day,
    }),
    rotation({
      id: KEYSMITH_IDS.closedRotation,
      tenantId: "acme",
      keyId: KEYSMITH_IDS.billingKey,
      // No scheduler exists, so production never records "scheduled".
      reason: "policy",
      oldHint: "19d4",
      newHint: "7c1e",
      rotatedBy: "usr_1",
      createdAt: now - 30 * day,
      graceMs: day,
    }),
    rotation({
      // Suspended since, but its expiry is ahead, so it may resume and the
      // window stays open.
      id: KEYSMITH_IDS.partnerRotation,
      tenantId: "acme",
      keyId: KEYSMITH_IDS.partnerKey,
      reason: "manual",
      oldHint: "9e07",
      newHint: "42ad",
      rotatedBy: "usr_2",
      createdAt: now - 10 * day,
      graceMs: 14 * day,
    }),
    rotation({
      // Rotated the day before it expired. Its grace runs four more days, but
      // an expired key never validates again, so the window reads closed.
      id: KEYSMITH_IDS.webhookRotation,
      tenantId: "acme",
      keyId: KEYSMITH_IDS.webhookKey,
      reason: "compromise",
      oldHint: "b210",
      newHint: "e5c2",
      rotatedBy: "usr_1",
      createdAt: now - 3 * day,
      graceMs: 7 * day,
    }),
    rotation({
      // Written before hints existed, for a key since deleted outside the
      // contract (the memory and mongo stores keep such a record).
      id: KEYSMITH_IDS.goneKeyRotation,
      tenantId: "acme",
      keyId: KEYSMITH_IDS.goneKey,
      reason: "compromise",
      oldHint: "",
      createdAt: now - 45 * day,
      graceMs: day,
    }),
    rotation({
      id: KEYSMITH_IDS.globexRotation,
      tenantId: "globex",
      keyId: KEYSMITH_IDS.globexKey,
      reason: "manual",
      oldHint: "d81c",
      newHint: "0c9e",
      rotatedBy: "usr_9",
      createdAt: now - 5 * day,
      graceMs: day,
    }),
  ]

  // A key's last use is its newest usage row; keys with no usage keep theirs.
  const usage = seedUsage(now)
  for (const k of keys) {
    const newest = usage.find((r) => r.keyId === k.id)
    if (newest) k.lastUsedAt = newest.createdAt
  }

  return { policies, scopes, keys, rotations, usage }
}

// ---------------------------------------------------------------------------
// Usage seed
// ---------------------------------------------------------------------------

/** mulberry32: a small fixed pseudo-random sequence, so the seed is the same every run. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const USAGE_SEED = 0x6b657973
const USAGE_DAYS = 30

/** A usage row id: the time in the top 48 bits, like the UUIDv7 a real id carries, so ids sort by time. */
function usageID(at, seq) {
  let n = (BigInt(at) << 80n) | BigInt(seq)
  let suffix = ""
  for (let i = 0; i < 26; i++) {
    suffix = CROCKFORD[Number(n & 31n)] + suffix
    n >>= 5n
  }
  return `kusg_${suffix}`
}

/**
 * Thirty days of acme requests up to now, every hour from the same sequence:
 * Billing service all along, Reporting export since it was created 25 days
 * ago. Mostly 200s, some 404s, a handful of 503s, and one quiet UTC day 12
 * days back with no rows at all. Two busy hours carry most of the errors: a
 * big one 50 hours back for the daily views, and a smaller one 7 hours back,
 * with at least three 503s and five 404s, so the 24 hour view has a spike and
 * every range shows all three outcomes. Rows sit on whole seconds, newest
 * first, ties by id descending.
 */
function seedUsage(now) {
  const hour = 3600_000
  const day = 24 * hour
  const rand = mulberry32(USAGE_SEED)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const currentHour = Math.floor(now / hour) * hour
  const quietDay = Math.floor((now - 12 * day) / day) * day
  const busyHour = currentHour - 50 * hour
  const recentBusyHour = currentHour - 7 * hour
  const reportingSince = now - 25 * day

  const billing = {
    keyId: KEYSMITH_IDS.billingKey,
    calls: [
      ["POST", "/v1/charges"],
      ["GET", "/v1/invoices"],
      ["GET", "/v1/invoices/inv_"],
      ["POST", "/v1/refunds"],
      ["GET", "/v1/customers/cus_"],
    ],
    ips: ["10.0.4.17", "10.0.4.18"],
    slow: 0,
  }
  const reporting = {
    keyId: KEYSMITH_IDS.reportingKey,
    calls: [
      ["GET", "/v1/reports"],
      ["GET", "/v1/reports/rep_"],
      ["POST", "/v1/reports/export"],
    ],
    // "" leaves the address out, as a request with none recorded.
    ips: ["203.0.113.24", "198.51.100.7", ""],
    slow: 300,
  }

  const rows = []
  let seq = 0
  // forced, when set, is the status the row gets whatever the roll says.
  const record = (source, start, span, busy, forced) => {
    const at = start + Math.floor((rand() * span) / 1000) * 1000
    const [method, path] = pick(source.calls)
    const endpoint = path.endsWith("_") ? `${path}${1000 + Math.floor(rand() * 9000)}` : path
    const roll = rand()
    const statusCode = forced ?? (roll < (busy ? 0.05 : 0.002) ? 503 : roll < (busy ? 0.12 : 0.08) ? 404 : 200)
    const jitter = rand()
    const latencyMs =
      statusCode === 503
        ? 2000 + Math.floor(jitter * 3000)
        : statusCode === 404
          ? 4 + Math.floor(jitter * 20)
          : 18 + source.slow + Math.floor(jitter * jitter * 240)
    rows.push({
      id: usageID(at, seq++),
      tenantId: "acme",
      keyId: source.keyId,
      method,
      endpoint,
      statusCode,
      latencyMs,
      ipAddress: pick(source.ips),
      createdAt: at,
    })
  }

  for (let i = USAGE_DAYS * 24 - 1; i >= 0; i--) {
    const start = currentHour - i * hour
    // The current hour only runs up to now.
    const span = Math.min(hour, now - start)
    if (span < 1000 || Math.floor(start / day) * day === quietDay) continue
    const utcHour = new Date(start).getUTCHours()
    const working = utcHour >= 13 && utcHour <= 22
    const billingCount = start === busyHour ? 160 : Math.floor(rand() * (working ? 9 : 4)) + (working ? 2 : 0)
    for (let n = 0; n < billingCount; n++) record(billing, start, span, start === busyHour)
    if (start === recentBusyHour) {
      for (let n = 0; n < 48; n++) record(billing, start, span, true, n < 3 ? 503 : n < 8 ? 404 : undefined)
    }
    if (start >= reportingSince) {
      const reportingCount = Math.floor(rand() * (utcHour >= 8 && utcHour <= 18 ? 4 : 2))
      for (let n = 0; n < reportingCount; n++) record(reporting, start, span, false)
    }
  }
  return rows.sort(usageStoreOrder)
}

/** Usages().Query order: created_at desc, then id desc. */
function usageStoreOrder(a, b) {
  return b.createdAt - a.createdAt || byteCompare(b.id, a.id)
}

let keysmith = seedKeysmithState()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetKeysmith() {
  keysmith = seedKeysmithState()
}

// ---------------------------------------------------------------------------
// Projections (project.go)
// ---------------------------------------------------------------------------

/**
 * effectiveState: a revokedAt wins over the state column. A key stored as
 * active whose expiry has passed reads as expired, and pending is true because
 * nothing has written that state yet.
 */
function effectiveState(k, now) {
  if (k.revokedAt !== null) return { state: "revoked", pending: false }
  if (k.state === "active" && k.expiresAt !== null && k.expiresAt <= now) return { state: "expired", pending: true }
  return { state: k.state, pending: false }
}

/**
 * keyIsFinished: no previous key of k can ever validate again. Its expiry has
 * passed whatever the stored state (a suspended key past expiry is refused on
 * expiry once reactivated), or it reads expired or revoked. rotations.list,
 * overview and keys.detail all close windows by this one rule.
 */
function keyIsFinished(k, now) {
  if (k.expiresAt !== null && k.expiresAt <= now) return true
  const { state } = effectiveState(k, now)
  return state === "expired" || state === "revoked"
}

/**
 * projectRotationItem: k is the rotated key, or null when it no longer exists
 * in the caller's tenant; then keyName, prefix and environment are null
 * together and the window is closed. A window is open only while the record
 * kept an old hint, its grace ends after now, and k is not finished.
 */
function projectRotationItem(r, k, now) {
  return {
    id: r.id,
    keyId: r.keyId,
    keyName: k ? k.name : null,
    prefix: k ? k.prefix : null,
    environment: k ? k.environment : null,
    oldHint: r.oldHint,
    newHint: r.newHint,
    reason: r.reason,
    graceSeconds: Math.trunc(r.graceMs / 1000),
    graceEnds: iso(r.graceEnds),
    windowOpen: k !== null && r.oldHint !== "" && r.graceEnds > now && !keyIsFinished(k, now),
    ...(r.rotatedBy ? { rotatedBy: r.rotatedBy } : {}),
    rotatedAt: iso(r.createdAt),
  }
}

/**
 * rotationKeys: each key the records name, kept only when it belongs to the
 * tenant. A key that is gone or another tenant's maps to null.
 */
function rotationKeys(tenantId, recs) {
  const keys = new Map()
  for (const r of recs) {
    if (keys.has(r.keyId)) continue
    const k = keysmith.keys.find((row) => row.id === r.keyId)
    keys.set(r.keyId, k && k.tenantId === tenantId ? k : null)
  }
  return keys
}

/** Rotations().List order: created_at desc, then id desc. */
function rotationStoreOrder(a, b) {
  return b.createdAt - a.createdAt || byteCompare(b.id, a.id)
}

/** Keys().List order: created_at desc, then id desc. */
function keyStoreOrder(a, b) {
  return b.createdAt - a.createdAt || byteCompare(b.id, a.id)
}

/**
 * projectKey: omitempty fields are left out when unset; scopes is never absent,
 * and comes sorted without duplicates like scopeNames in handlers_keys.go.
 */
function projectKey(k, now) {
  const { state, pending } = effectiveState(k, now)
  const out = {
    id: k.id,
    name: k.name,
    ...(k.description ? { description: k.description } : {}),
    prefix: k.prefix,
    hint: k.hint,
    environment: k.environment,
    state: k.state,
    effectiveState: state,
    expiryPending: pending,
    expiresSoon: false,
    ...(k.policyId ? { policyId: k.policyId } : {}),
    scopes: [...new Set(k.scopes)].sort(),
    ...(k.createdBy ? { createdBy: k.createdBy } : {}),
    ...(k.expiresAt !== null ? { expiresAt: iso(k.expiresAt) } : {}),
    ...(k.lastUsedAt !== null ? { lastUsedAt: iso(k.lastUsedAt) } : {}),
    ...(k.rotatedAt !== null ? { rotatedAt: iso(k.rotatedAt) } : {}),
    ...(k.revokedAt !== null ? { revokedAt: iso(k.revokedAt) } : {}),
    createdAt: iso(k.createdAt),
    updatedAt: iso(k.updatedAt),
  }
  if (state === "active" && k.expiresAt !== null && k.expiresAt > now && k.expiresAt - now <= EXPIRES_SOON_WINDOW_MS) {
    out.expiresSoon = true
  }
  return out
}

/** secondsOrNil: a zero duration is unset to the engine, so it goes out as null, never 0. */
function secondsOrNull(ms) {
  return ms === 0 ? null : Math.trunc(ms / 1000)
}

/** projectPolicyRef: both durations are always present, null when unset. */
function projectPolicyRef(p) {
  return {
    id: p.id,
    name: p.name,
    maxKeyLifetimeSeconds: secondsOrNull(p.maxKeyLifetime),
    graceSeconds: secondsOrNull(p.gracePeriod),
  }
}

// ---------------------------------------------------------------------------
// TypeID parsing (id.ParseKeyID / id.ParsePolicyID)
// ---------------------------------------------------------------------------

// A TypeID is a prefix, an underscore and a 26 character suffix in lowercase
// Crockford base32 whose first character is 0 to 7 (the top bits of a 128 bit
// value). ParseWithPrefix then checks the prefix. The brief only asks for the
// prefix, but the Go parser rejects a malformed suffix too, and so does this.
const TYPEID_SUFFIX = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/

function parseTypeID(s, prefix) {
  const want = `${prefix}_`
  return typeof s === "string" && s.startsWith(want) && TYPEID_SUFFIX.test(s.slice(want.length))
}

/**
 * A new TypeID: the prefix, an underscore and 26 characters of lowercase
 * Crockford base32 over 128 random bits (130 bits of room, so the first
 * character is 0 to 7). Real ones are UUIDv7 and sort by time; nothing here
 * reads that order.
 */
function newTypeID(prefix) {
  let n = BigInt(`0x${randomBytes(16).toString("hex")}`)
  let suffix = ""
  for (let i = 0; i < 26; i++) {
    suffix = CROCKFORD[Number(n & 31n)] + suffix
    n >>= 5n
  }
  return `${prefix}_${suffix}`
}

/**
 * listOpenWindows (load.go): every rotation record of the key that kept an old
 * hint and whose grace ends after now, soonest first. There is no cap, so a
 * still-valid previous key is never hidden. A record counts once by ID, as it
 * does in Go where paging can show one twice.
 */
function listOpenWindows(keyId, now) {
  const seen = new Set()
  const open = []
  for (const r of keysmith.rotations) {
    if (r.keyId !== keyId || seen.has(r.id)) continue
    seen.add(r.id)
    // A record with no old hint must never read as an open window.
    if (r.oldHint !== "" && r.graceEnds > now) open.push(r)
  }
  open.sort((a, b) => a.graceEnds - b.graceEnds)
  return open.map((r) => ({
    rotationId: r.id,
    hint: r.oldHint,
    reason: r.reason,
    rotatedAt: iso(r.createdAt),
    graceEnds: iso(r.graceEnds),
  }))
}

/** Rotations.EndGrace: every window still open at `at` now ends at `at`. Answers how many closed. */
function endOpenWindows(keyId, at) {
  let closed = 0
  for (const r of keysmith.rotations) {
    if (r.keyId === keyId && r.graceEnds > at) {
      r.graceEnds = at
      closed++
    }
  }
  return closed
}

/** projectPolicySummary: unset durations are null, allowedScopes is never absent. */
function projectPolicySummary(p) {
  return {
    id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    maxKeyLifetimeSeconds: secondsOrNull(p.maxKeyLifetime),
    graceSeconds: secondsOrNull(p.gracePeriod),
    allowedScopes: [...(p.allowedScopes ?? [])],
  }
}

/** sortedUnique: a sorted copy without duplicates, [] when empty, never null. */
function sortedUnique(list) {
  return [...(list ?? [])].sort(byteCompare).filter((s, i, all) => i === 0 || s !== all[i - 1])
}

/** countOrNil: a zero count is unset to the engine, like a zero duration. */
function countOrNull(n) {
  return n === 0 ? null : n
}

/**
 * projectPolicyDetail: every field, in the Go struct's order. Counts and
 * durations are null when unset, lists are sorted and never null, and
 * durations go out as whole seconds.
 */
function projectPolicyDetail(p) {
  return {
    id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    maxKeyLifetimeSeconds: secondsOrNull(p.maxKeyLifetime),
    graceSeconds: secondsOrNull(p.gracePeriod),
    allowedScopes: sortedUnique(p.allowedScopes),
    rateLimit: countOrNull(p.rateLimit),
    rateLimitWindowSeconds: secondsOrNull(p.rateLimitWindow),
    burstLimit: countOrNull(p.burstLimit),
    allowedIps: sortedUnique(p.allowedIps),
    allowedOrigins: sortedUnique(p.allowedOrigins),
    allowedMethods: sortedUnique(p.allowedMethods),
    allowedPaths: sortedUnique(p.allowedPaths),
    rotationPeriodSeconds: secondsOrNull(p.rotationPeriod),
    dailyQuota: countOrNull(p.dailyQuota),
    monthlyQuota: countOrNull(p.monthlyQuota),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  }
}

/** projectScopeSummary: parent and description are left out when empty. */
function projectScopeSummary(sc) {
  return {
    id: sc.id,
    name: sc.name,
    ...(sc.parent ? { parent: sc.parent } : {}),
    ...(sc.description ? { description: sc.description } : {}),
  }
}

/**
 * policyKeyCounts (handlers_policies.go): the tenant's keys that use the
 * policy, and the ones that block its delete (neither stored revoked nor
 * carrying a revokedAt). Keys of another tenant naming it are skipped.
 */
function policyKeyCounts(tenantId, policyId) {
  let using = 0
  let blocking = 0
  for (const k of keysmith.keys) {
    if (k.policyId !== policyId || k.tenantId !== tenantId) continue
    using++
    if (k.state !== "revoked" && k.revokedAt === null) blocking++
  }
  return { using, blocking }
}

/** Policies().List order: created_at desc, then id desc. */
function policyStoreOrder(a, b) {
  return b.createdAt - a.createdAt || byteCompare(b.id, a.id)
}

/** Scopes().List order: name asc, then id asc. */
function scopeStoreOrder(a, b) {
  return byteCompare(a.name, b.name) || byteCompare(a.id, b.id)
}

/** The rate limiter stand-in (see the header). */
const rateLimiterConfigured = () => process.env.FIXTURE_KEYSMITH_RATE_LIMITER === "1"

/** The hook plugins stand-in: sortedPlugins of FIXTURE_KEYSMITH_PLUGINS, sorted, not de-duplicated, [] for none. */
function fixturePlugins() {
  return (process.env.FIXTURE_KEYSMITH_PLUGINS ?? "audit-hook")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .sort(byteCompare)
}

/** Where settings says the tenant came from (see the header): "scope" or "config". */
const tenantSource = () =>
  process.env.FIXTURE_KEYSMITH_TENANT_SOURCE === "scope" ? "scope" : "config"

/** The store health stand-in (see the header). */
const storeDown = () => process.env.FIXTURE_KEYSMITH_STORE_DOWN === "1"

/**
 * enforcementTable: a fresh copy of the table. The keysmith group is always
 * enforced, the application group never, and the rate limiter group only with
 * a limiter. A row that is not enforced has no `when`.
 */
function enforcementTable(limiter) {
  return ENFORCEMENT_ROWS.map((r) => {
    const enforced = r.group === "keysmith" || (r.group === "rateLimiter" && limiter)
    return { field: r.field, label: r.label, group: r.group, enforced, when: enforced ? r.when : "" }
  })
}

/** enforcedPolicyFieldCount: 3, or 5 with a rate limiter. */
function enforcedPolicyFieldCount(limiter) {
  return enforcementTable(limiter).filter((r) => r.enforced).length
}

// ---------------------------------------------------------------------------
// Usage times (handlers_usage.go)
// ---------------------------------------------------------------------------

const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

// time.Parse(time.RFC3339, s) as Go reads it once its fast path gives up: the
// hour may be one digit, a fraction may follow the seconds after "." or ",",
// and a zone offset may run to 24:60. Only "T" and "Z" in capitals.
const GO_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/

/** Go's daysIn, on the proleptic Gregorian calendar. month is 1 to 12. */
function daysIn(month, year) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** A UTC time from its parts. Date.UTC would read the years 0 to 99 as 1900 to 1999. */
function utcTime(year, month0, day, hour = 0, min = 0, sec = 0) {
  const d = new Date(0)
  d.setUTCFullYear(year, month0, day)
  d.setUTCHours(hour, min, sec, 0)
  return d.getTime()
}

/**
 * parseGoRFC3339: { ms, sub } in UTC, or null where Go refuses. ms is whole
 * milliseconds and sub the nanoseconds past them (0 to 999999): Go keeps
 * nanoseconds, and two times inside one millisecond still compare there.
 */
function parseGoRFC3339(s) {
  const m = GO_RFC3339.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi, se, frac, sign, zh, zm] = m
  const [year, month, day, hour, min, sec] = [y, mo, d, h, mi, se].map(Number)
  if (month < 1 || month > 12 || day < 1 || day > daysIn(month, year)) return null
  if (hour > 23 || min > 59 || sec > 59) return null
  let offsetMs = 0
  if (sign) {
    if (Number(zh) > 24 || Number(zm) > 60) return null
    offsetMs = (sign === "-" ? -1 : 1) * (Number(zh) * 60 + Number(zm)) * 60_000
  }
  // Go reads nine digits of fraction and drops the rest.
  const nanos = (frac ?? "").slice(0, 9).padEnd(9, "0")
  return {
    ms: utcTime(year, month - 1, day, hour, min, sec) + Number(nanos.slice(0, 3)) - offsetMs,
    sub: Number(nanos.slice(3)),
  }
}

/** a is after b, to the nanosecond. */
const timeAfter = (a, b) => a.ms > b.ms || (a.ms === b.ms && a.sub > b.sub)

/** The first whole millisecond at or after t: a whole-millisecond time x is >= t, or < t, exactly when it is against this. */
const ceilMs = (t) => (t.sub > 0 ? t.ms + 1 : t.ms)

/** usage.Truncate: the UTC start of the hour, day or month ms falls in. */
function usageTruncate(ms, period) {
  if (period === "hourly") return Math.floor(ms / HOUR_MS) * HOUR_MS
  if (period === "daily") return Math.floor(ms / DAY_MS) * DAY_MS
  const d = new Date(ms)
  return utcTime(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** nextUsageBucket: one hour, one UTC day, or the 1st of the next UTC month. */
function nextUsageBucket(ms, period) {
  if (period === "hourly") return ms + HOUR_MS
  if (period === "daily") return ms + DAY_MS
  const d = new Date(ms)
  return utcTime(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/** usageBucketStarts: every start from first while it is before before, or null past MAX_USAGE_BUCKETS. */
function usageBucketStarts(first, before, period) {
  const starts = []
  for (let s = first; s < before; s = nextUsageBucket(s, period)) {
    if (starts.length === MAX_USAGE_BUCKETS) return null
    starts.push(s)
  }
  return starts
}

/** time.Format(time.RFC3339) in UTC for any year: Go writes the year -1 as "-0001" and 10000 as "10000". */
function goRFC3339(ms) {
  const y = new Date(ms).getUTCFullYear()
  const year = y < 0 ? `-${String(-y).padStart(4, "0")}` : String(y).padStart(4, "0")
  return year + iso(ms).replace(/^[+-]?\d+/, "")
}

/** The tenant's usage rows, newest first, narrowed to a key and to [after, before) in whole milliseconds. */
function usageRows(tenantId, keyId, after, before) {
  return keysmith.usage.filter(
    (r) =>
      r.tenantId === tenantId &&
      (keyId === null || r.keyId === keyId) &&
      (after === null || r.createdAt >= after) &&
      (before === null || r.createdAt < before),
  )
}

/** usageRecorded: whether the tenant has any usage row at all, at any time, for any key. */
function usageRecorded(tenantId) {
  return keysmith.usage.some((r) => r.tenantId === tenantId)
}

/** UsageRecordItem: no user agent, no metadata; ipAddress left out when empty. */
function projectUsageRecord(r) {
  return {
    id: r.id,
    keyId: r.keyId,
    method: r.method,
    endpoint: r.endpoint,
    statusCode: r.statusCode,
    latencyMs: r.latencyMs,
    ...(r.ipAddress ? { ipAddress: r.ipAddress } : {}),
    at: iso(r.createdAt),
  }
}

// ---------------------------------------------------------------------------
// Policy list checks (handlers_policy_write.go)
// ---------------------------------------------------------------------------

/**
 * normaliseList: trims every entry, drops blanks, upper-cases when asked, and
 * answers a new sorted list without duplicates. It never changes its input.
 */
function normaliseList(list, upper) {
  const out = []
  for (const raw of list ?? []) {
    let s = goTrimSpace(raw)
    if (s === "") continue
    if (upper) s = goToUpper(s)
    out.push(s)
  }
  return out.sort(byteCompare).filter((s, i, all) => i === 0 || s !== all[i - 1])
}

/** net.ParseIP: what Node's isIP accepts, less a zone, which Go refuses. */
function goParseIP(s) {
  return s.includes("%") ? 0 : isIP(s)
}

/** net.ParseIP, else net.ParseCIDR. A CIDR length is decimal digits up to the address's bit length. */
function isIPOrCIDR(s) {
  if (goParseIP(s) !== 0) return true
  const slash = s.indexOf("/")
  if (slash === -1) return false
  const family = goParseIP(s.slice(0, slash))
  const bits = s.slice(slash + 1)
  if (family === 0 || !/^\d+$/.test(bits)) return false
  return Number(bits) <= (family === 4 ? 32 : 128)
}

// The ASCII a host may hold as is (url.shouldEscape in encodeHost mode).
const HOST_CHAR = /^[A-Za-z0-9\-._~!$&'()*+,;=:[\]<>"]$/

/** url.Parse's parseHost and unescape(host, encodeHost): a port of digits only, escapes only above ASCII. */
function validHost(host) {
  const close = host.startsWith("[") ? host.lastIndexOf("]") : -1
  if (host.startsWith("[") && close === -1) return false
  const colon = host.lastIndexOf(":")
  // Only a bracketed IPv6 literal may hold more than one colon.
  if (close === -1 && colon !== host.indexOf(":")) return false
  const port = close !== -1 ? host.slice(close + 1) : colon !== -1 ? host.slice(colon) : ""
  if (!/^(:\d*)?$/.test(port)) return false
  for (let i = 0; i < host.length; i++) {
    const ch = host[i]
    if (ch === "%") {
      const hex = host.slice(i + 1, i + 3)
      if (!/^[0-9A-Fa-f]{2}$/.test(hex) || (Number.parseInt(hex[0], 16) < 8 && hex !== "25")) return false
      i += 2
    } else if (ch.charCodeAt(0) < 0x80 && !HOST_CHAR.test(ch)) {
      return false
    }
  }
  return true
}

/**
 * isOrigin: an http or https URL with a host and nothing after it. No path
 * (not even a trailing slash), no query, not even a bare "?", no fragment, no
 * userinfo. Like url.Parse, the scheme's case does not matter, and a "#" with
 * nothing after it leaves the fragment empty.
 */
function isOrigin(s) {
  // url.Parse refuses ASCII control characters anywhere.
  if (/[\x00-\x1f\x7f]/.test(s)) return false
  const hash = s.indexOf("#")
  if (hash !== -1 && hash !== s.length - 1) return false
  const rest = hash === -1 ? s : s.slice(0, hash)
  if (rest.includes("?")) return false
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/s.exec(rest)
  if (!m) return false
  const scheme = m[1].toLowerCase()
  const authority = m[2]
  if (scheme !== "http" && scheme !== "https") return false
  if (authority === "" || authority.includes("/") || authority.includes("@")) return false
  return validHost(authority)
}

// The request's policyFields, by wire name. Seconds become milliseconds on the row.
const POLICY_TEXT_FIELDS = ["name", "description"]
const POLICY_SECONDS_FIELDS = {
  maxKeyLifetimeSeconds: "maxKeyLifetime",
  graceSeconds: "gracePeriod",
  rateLimitWindowSeconds: "rateLimitWindow",
  rotationPeriodSeconds: "rotationPeriod",
}
const POLICY_COUNT_FIELDS = ["rateLimit", "burstLimit", "dailyQuota", "monthlyQuota"]
const POLICY_LIST_FIELDS = ["allowedScopes", "allowedIps", "allowedOrigins", "allowedMethods", "allowedPaths"]

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 *   server.mjs's own error class, so refusals carry their real status and code.
 */
export function createKeysmithHandlers(FixtureError) {
  const badRequest = (message) => new FixtureError(400, "BAD_REQUEST", message)
  // The one error for a key that does not exist and for a key that belongs to
  // another tenant, so the two cannot be told apart.
  const keyNotFound = () => new FixtureError(404, "NOT_FOUND", "key not found")
  const conflict = (message) => new FixtureError(409, "CONFLICT", message)

  /**
   * tenantFrom. The fixture has no principal, so FIXTURE_KEYSMITH_TENANT stands
   * in for Deps.DefaultTenantID. It never resolves to the empty string: an empty
   * tenant in a store filter matches every tenant's rows, so an unresolvable
   * tenant refuses.
   */
  function tenant() {
    const t = process.env.FIXTURE_KEYSMITH_TENANT ?? "acme"
    if (t === "") {
      throw new FixtureError(
        403,
        "PERMISSION_DENIED",
        "no tenant in scope: keysmith cannot tell which tenant this request is for. Set extensions.keysmith.dashboard.tenant_id for a single-tenant deployment.",
      )
    }
    return t
  }

  /** A limit or offset from the wire, as a whole number, or 0 when it is not one. */
  function wholeNumber(raw) {
    return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
  }

  /** clampPage: limit <= 0 gets the default, over the cap is capped, offset < 0 is 0. */
  function clampPage(params) {
    let limit = wholeNumber(params?.limit)
    if (limit <= 0) limit = DEFAULT_LIST_LIMIT
    if (limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT
    let offset = wholeNumber(params?.offset)
    if (offset < 0) offset = 0
    return { limit, offset }
  }

  const str = (raw) => (typeof raw === "string" ? raw : "")

  /** requireID (load.go): trimmed; empty is "id is required", a malformed one "id is not a key id". */
  function requireID(raw) {
    const id = str(raw).trim()
    if (id === "") throw badRequest("id is required")
    if (!parseTypeID(id, "akey")) throw badRequest("id is not a key id")
    return id
  }

  /**
   * loadKeyForTenant (load.go): a key that does not exist and a key of another
   * tenant both answer the same NOT_FOUND. Every by-id handler goes through it.
   */
  function loadKeyForTenant(tenantId, rawId) {
    const id = requireID(rawId)
    const k = keysmith.keys.find((row) => row.id === id)
    if (!k || k.tenantId !== tenantId) throw keyNotFound()
    return k
  }

  /** scopeStrings: a request's scope list. A value that is not a list of strings fails the decode in Go. */
  function scopeStrings(raw) {
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw) || raw.some((n) => typeof n !== "string")) {
      throw badRequest("scopes must be a list of strings")
    }
    return raw
  }

  /** The engine's checkScopes: each name must exist in the tenant, then pass the policy's allow list, in input order. */
  function checkScopes(tenantId, pol, names) {
    const allowed = pol && pol.allowedScopes.length > 0 ? new Set(pol.allowedScopes) : null
    for (const name of names) {
      if (!keysmith.scopes.some((s) => s.tenantId === tenantId && s.name === name)) {
        throw badRequest(`scope ${JSON.stringify(name)} does not exist in this tenant`)
      }
      if (allowed && !allowed.has(name)) throw badRequest("a scope is outside this policy's allowed scopes")
    }
  }

  /** pickerPage: limit <= 0 gets the default, over the cap is capped, offset < 0 is 0. */
  function pickerPage(params) {
    let limit = wholeNumber(params?.limit)
    if (limit <= 0) limit = DEFAULT_PICKER_LIMIT
    if (limit > MAX_PICKER_LIMIT) limit = MAX_PICKER_LIMIT
    let offset = wholeNumber(params?.offset)
    if (offset < 0) offset = 0
    return { limit, offset }
  }

  /**
   * parseUsageTime (handlers_usage.go): trimmed; blank is null when optional
   * and "<name> is required" when not; anything Go's RFC3339 parse refuses is
   * "<name> is not an RFC3339 time".
   */
  function parseUsageTime(name, raw, required) {
    const s = goTrimSpace(str(raw))
    if (s === "") {
      if (required) throw badRequest(`${name} is required`)
      return null
    }
    const t = parseGoRFC3339(s)
    if (!t) throw badRequest(`${name} is not an RFC3339 time`)
    return t
  }

  /** parseUsageKeyID, and rotations.list's keyId: trimmed, blank is every key. */
  function parseKeyFilter(raw) {
    const s = goTrimSpace(str(raw))
    if (s === "") return null
    if (!parseTypeID(s, "akey")) throw badRequest("keyId is not a key id")
    return s
  }

  /**
   * keyStateChange (handlers_key_state.go): resolve the tenant, validate the
   * request, load the key for the tenant, refuse by effective state, apply,
   * and answer the key as stored afterwards.
   */
  function keyStateChange({ rawId, conflictMessage, validate, allowed, apply }) {
    const tenantId = tenant()
    validate?.()
    const k = loadKeyForTenant(tenantId, rawId)
    if (!allowed(k, Date.now())) throw conflict(conflictMessage)
    apply(k)
    return { key: projectKey(k, Date.now()) }
  }

  /** scopesToChange (handlers_key_scopes.go): trim, drop blanks, sort, compact; empty is refused. */
  function scopesToChange(raw) {
    const names = scopeStrings(raw)
      .map((n) => n.trim())
      .filter((n) => n !== "")
      .sort()
      .filter((n, i, all) => i === 0 || n !== all[i - 1])
    if (names.length === 0) throw badRequest("scopes must name at least one scope")
    return names
  }

  /** requirePolicyID (load.go): trimmed; empty is "id is required", a malformed one "id is not a policy id". */
  function requirePolicyID(raw) {
    const id = goTrimSpace(str(raw))
    if (id === "") throw badRequest("id is required")
    if (!parseTypeID(id, "kpol")) throw badRequest("id is not a policy id")
    return id
  }

  /** loadPolicyForTenant (load.go): a missing policy and another tenant's answer the same NOT_FOUND. */
  function loadPolicyForTenant(tenantId, rawId) {
    const id = requirePolicyID(rawId)
    const pol = keysmith.policies.get(id)
    if (!pol || pol.tenantId !== tenantId) throw new FixtureError(404, "NOT_FOUND", "policy not found")
    return pol
  }

  /** requireScopeID (load.go): trimmed; empty is "id is required", a malformed one "id is not a scope id". */
  function requireScopeID(raw) {
    const id = goTrimSpace(str(raw))
    if (id === "") throw badRequest("id is required")
    if (!parseTypeID(id, "kscp")) throw badRequest("id is not a scope id")
    return id
  }

  /** loadScopeForTenant (load.go): a missing scope and another tenant's answer the same NOT_FOUND. */
  function loadScopeForTenant(tenantId, rawId) {
    const id = requireScopeID(rawId)
    const sc = keysmith.scopes.find((row) => row.id === id)
    if (!sc || sc.tenantId !== tenantId) throw new FixtureError(404, "NOT_FOUND", "scope not found")
    return sc
  }

  /**
   * The dispatcher's JSON decode of policyFields, before the handler runs. A
   * field that is null or left out is not set. A value of the wrong type fails
   * the decode in Go with BAD_REQUEST; the message here is the fixture's own.
   */
  function decodePolicyFields(params) {
    const fields = {}
    for (const [field, value] of Object.entries(params ?? {})) {
      if (value === null || value === undefined) continue
      if (POLICY_TEXT_FIELDS.includes(field)) {
        if (typeof value !== "string") throw badRequest(`${field} must be a string`)
      } else if (field in POLICY_SECONDS_FIELDS || POLICY_COUNT_FIELDS.includes(field)) {
        if (!Number.isInteger(value)) throw badRequest(`${field} must be a whole number`)
      } else if (POLICY_LIST_FIELDS.includes(field)) {
        // Go decodes a null entry of a []string as "", which normaliseList drops.
        if (!Array.isArray(value) || value.some((s) => s !== null && typeof s !== "string")) {
          throw badRequest(`${field} must be a list of strings`)
        }
        fields[field] = value.map((s) => s ?? "")
        continue
      } else {
        continue
      }
      fields[field] = value
    }
    return fields
  }

  /** The same decode for scopes.create: three strings, "" when null or left out. */
  function decodeScopeFields(params) {
    const fields = { name: "", parent: "", description: "" }
    for (const [field, value] of Object.entries(params ?? {})) {
      if (!(field in fields) || value === null || value === undefined) continue
      if (typeof value !== "string") throw badRequest(`${field} must be a string`)
      fields[field] = value
    }
    return fields
  }

  /** A policy row as CreatePolicy starts from: everything unset. */
  function blankPolicy() {
    return {
      name: "",
      description: "",
      maxKeyLifetime: 0,
      gracePeriod: 0,
      allowedScopes: [],
      rateLimit: 0,
      rateLimitWindow: 0,
      burstLimit: 0,
      allowedIps: [],
      allowedOrigins: [],
      allowedMethods: [],
      allowedPaths: [],
      rotationPeriod: 0,
      dailyQuota: 0,
      monthlyQuota: 0,
    }
  }

  /** A copy to edit, so a refused update leaves the stored row alone. */
  function clonePolicy(p) {
    const out = { ...p }
    for (const field of POLICY_LIST_FIELDS) out[field] = [...p[field]]
    return out
  }

  /**
   * applyPolicyFields: copies the decoded fields onto the row. Lists are
   * copied. Seconds are stored as milliseconds; a number too large for Go's
   * clamp still lands past the cap, so validatePolicy answers the same.
   */
  function applyPolicyFields(p, fields) {
    for (const [field, value] of Object.entries(fields)) {
      if (field in POLICY_SECONDS_FIELDS) p[POLICY_SECONDS_FIELDS[field]] = value * 1000
      else if (POLICY_LIST_FIELDS.includes(field)) p[field] = [...value]
      else p[field] = value
    }
  }

  /**
   * validatePolicy (handlers_policy_write.go): normalises p in place and checks
   * it. The first failure wins, in this order: name, description, negative
   * numbers, caps (both in field order), the rate limit pairings, then each
   * list (normalised, counted, then every entry in sorted order). stored is
   * the row's allowedScopes before the edit (null on create): only names not
   * in it are looked up, so a policy naming a scope that has since gone stays
   * editable.
   */
  function validatePolicy(tenantId, p, stored) {
    p.name = goTrimSpace(p.name)
    if (p.name === "") throw badRequest("name is required")
    if (runeCount(p.name) > MAX_POLICY_NAME_LENGTH) throw badRequest("name is too long")
    p.description = goTrimSpace(p.description)
    if (runeCount(p.description) > MAX_POLICY_DESCRIPTION_LENGTH) throw badRequest("description is too long")

    const kept = normaliseList(stored, false)

    // [field, value, limit, cap message]; the row holds durations in ms.
    const numbers = [
      ["maxKeyLifetimeSeconds", p.maxKeyLifetime, MAX_POLICY_LIFETIME_SECONDS * 1000, "is at most 10 years"],
      ["graceSeconds", p.gracePeriod, MAX_POLICY_GRACE_SECONDS * 1000, "is at most 90 days"],
      ["rateLimit", p.rateLimit, MAX_POLICY_RATE, "is too large"],
      ["rateLimitWindowSeconds", p.rateLimitWindow, MAX_POLICY_WINDOW_SECONDS * 1000, "is at most 31 days"],
      ["burstLimit", p.burstLimit, MAX_POLICY_RATE, "is too large"],
      ["rotationPeriodSeconds", p.rotationPeriod, MAX_POLICY_LIFETIME_SECONDS * 1000, "is at most 10 years"],
      ["dailyQuota", p.dailyQuota, 0, ""],
      ["monthlyQuota", p.monthlyQuota, 0, ""],
    ]
    for (const [field, value] of numbers) {
      if (value < 0) throw badRequest(`${field} cannot be negative`)
    }
    for (const [field, value, limit, capMsg] of numbers) {
      if (limit > 0 && value > limit) throw badRequest(`${field} ${capMsg}`)
    }

    if (p.rateLimit > 0 && p.rateLimitWindow === 0) throw badRequest("a rate limit needs a window")
    if (p.burstLimit > 0 && p.rateLimit === 0) throw badRequest("a burst limit needs a rate limit")

    const lists = [
      [
        "allowedScopes",
        false,
        (name) => {
          if (kept.includes(name)) return
          if (!keysmith.scopes.some((sc) => sc.tenantId === tenantId && sc.name === name)) {
            throw badRequest(`scope ${goQuote(name)} does not exist in this tenant`)
          }
        },
      ],
      [
        "allowedIps",
        false,
        (s) => {
          if (!isIPOrCIDR(s)) throw badRequest(`allowedIps: ${goQuote(s)} is not an IP address or CIDR range`)
        },
      ],
      [
        "allowedOrigins",
        false,
        (s) => {
          if (s !== "*" && !isOrigin(s)) {
            throw badRequest(`allowedOrigins: ${goQuote(s)} is not an origin like https://example.com`)
          }
        },
      ],
      [
        "allowedMethods",
        true,
        (s) => {
          if (!POLICY_METHODS.includes(s)) throw badRequest(`allowedMethods: ${goQuote(s)} is not an HTTP method`)
        },
      ],
      [
        "allowedPaths",
        false,
        (s) => {
          if (!s.startsWith("/")) throw badRequest(`allowedPaths: ${goQuote(s)} must start with /`)
        },
      ],
    ]
    for (const [field, upper, check] of lists) {
      p[field] = normaliseList(p[field], upper)
      if (p[field].length > MAX_POLICY_LIST_ENTRIES) throw badRequest(`${field} has more than 100 entries`)
      for (const entry of p[field]) check(entry)
    }
  }

  /**
   * The engine's checkPolicyName: another policy in the tenant with this name
   * refuses. self is the policy being updated, which may keep its own name.
   */
  function checkPolicyName(tenantId, name, self) {
    for (const p of keysmith.policies.values()) {
      if (p.tenantId === tenantId && p.name === name && p.id !== self) {
        throw conflict("a policy with this name already exists")
      }
    }
  }

  /** policyInUse: this tenant's blocking count; 0 names no number. */
  function policyInUse(blocking) {
    if (blocking === 1) return conflict("1 key that is not revoked uses this policy")
    if (blocking > 1) return conflict(`${blocking} keys that are not revoked use this policy`)
    return conflict("keys that are not revoked use this policy")
  }

  /**
   * validateScope (handlers_scope_write.go): trims and checks, first failure
   * wins: name, description, the parent's length, the parent being the scope
   * itself, the parent existing in this tenant.
   */
  function validateScope(tenantId, in_) {
    in_.name = goTrimSpace(in_.name)
    if (in_.name === "") throw badRequest("name is required")
    if (runeCount(in_.name) > MAX_SCOPE_NAME_LENGTH) throw badRequest("name is too long")
    if (GO_HAS_SPACE.test(in_.name)) throw badRequest("name cannot contain spaces")
    in_.description = goTrimSpace(in_.description)
    if (runeCount(in_.description) > MAX_SCOPE_DESCRIPTION_LENGTH) throw badRequest("description is too long")
    in_.parent = goTrimSpace(in_.parent)
    if (in_.parent === "") return
    if (runeCount(in_.parent) > MAX_SCOPE_NAME_LENGTH) throw badRequest("parent is too long")
    if (in_.parent === in_.name) throw badRequest("a scope cannot be its own parent")
    if (!keysmith.scopes.some((sc) => sc.tenantId === tenantId && sc.name === in_.parent)) {
      throw badRequest(`parent scope ${goQuote(in_.parent)} does not exist in this tenant`)
    }
  }

  /** scopeHasChildren: n is read with one row past the cap; 0 names no number. */
  function scopeHasChildren(n) {
    if (n > MAX_SCOPE_CHILD_COUNT) return conflict(`more than ${MAX_SCOPE_CHILD_COUNT} scopes name this scope as their parent`)
    if (n === 1) return conflict("1 scope names this scope as its parent")
    if (n > 1) return conflict(`${n} scopes name this scope as their parent`)
    return conflict("scopes name this scope as their parent")
  }

  /** scopeAllowedByPolicy: n is this tenant's count; 0 names no number. */
  function scopeAllowedByPolicy(n) {
    if (n === 1) return conflict("1 policy allows this scope")
    if (n > 1) return conflict(`${n} policies allow this scope`)
    return conflict("policies allow this scope")
  }

  return {
    "keys.list": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const environment = str(params?.environment)
        if (environment !== "" && !ENVIRONMENTS.includes(environment)) {
          throw badRequest("environment must be one of live, test, staging")
        }
        const state = str(params?.state)
        if (state !== "" && !STATES.includes(state)) {
          throw badRequest("state must be one of active, suspended, revoked, expired")
        }
        const { limit, offset } = clampPage(params)
        const policyId = str(params?.policyId)
        if (policyId !== "" && !parseTypeID(policyId, "kpol")) {
          throw badRequest("policyId is not a policy id")
        }

        // The store filters on the STORED state, not the effective one: a key
        // stored active whose expiry has passed is listed under "active".
        const matched = keysmith.keys
          .filter(
            (k) =>
              k.tenantId === tenantId &&
              (environment === "" || k.environment === environment) &&
              (state === "" || k.state === state) &&
              (policyId === "" || k.policyId === policyId),
          )
          .sort(keyStoreOrder)

        const now = Date.now()
        return {
          keys: matched.slice(offset, offset + limit).map((k) => projectKey(k, now)),
          // Count ignores limit and offset, so total is the size of the filter.
          total: matched.length,
        }
      },
    },

    "keys.detail": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const k = loadKeyForTenant(tenantId, params?.id)

        const now = Date.now()
        const out = {
          key: projectKey(k, now),
          // An explicit null, never omitted: the page tells "no policy" from "absent".
          policy: null,
          metadata: k.metadata ? { ...k.metadata } : {},
          previousKeys: [],
        }

        if (k.policyId) {
          const pol = keysmith.policies.get(k.policyId)
          // A dangling policy reads as none, and a policy from another tenant
          // is never shown.
          if (pol && pol.tenantId === k.tenantId) out.policy = projectPolicyRef(pol)
        }

        // A finished key's windows can never validate again, so none is
        // listed, the same rule rotations.list and overview close them by.
        if (!keyIsFinished(k, now)) out.previousKeys = listOpenWindows(k.id, now)
        return out
      },
    },

    "policies.list": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const { limit, offset } = pickerPage(params)
        // One extra row tells whether another page exists. The page is cut in
        // store order (newest first) and only then sorted by name, as in Go.
        const rows = [...keysmith.policies.values()]
          .filter((p) => p.tenantId === tenantId)
          .sort(policyStoreOrder)
          .slice(offset, offset + limit + 1)
        const hasMore = rows.length > limit
        if (hasMore) rows.length = limit
        rows.sort((a, b) => byteCompare(a.name, b.name))
        return { policies: rows.map(projectPolicySummary), hasMore, rateLimiterConfigured: rateLimiterConfigured() }
      },
    },

    "policies.detail": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const pol = loadPolicyForTenant(tenantId, params?.id)
        const { using, blocking } = policyKeyCounts(tenantId, pol.id)
        return {
          policy: projectPolicyDetail(pol),
          keysUsing: using,
          keysBlockingDelete: blocking,
          rateLimiterConfigured: rateLimiterConfigured(),
        }
      },
    },

    "scopes.list": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const { limit, offset } = pickerPage(params)
        // Store order is name, then id.
        const rows = keysmith.scopes
          .filter((sc) => sc.tenantId === tenantId)
          .sort(scopeStoreOrder)
          .slice(offset, offset + limit + 1)
        const hasMore = rows.length > limit
        if (hasMore) rows.length = limit
        rows.sort((a, b) => byteCompare(a.name, b.name))
        return { scopes: rows.map(projectScopeSummary), hasMore }
      },
    },

    // The tenant's rotations, newest first. keyId is a filter, not a lookup:
    // another tenant's key or a missing one answers an empty page.
    "rotations.list": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const keyId = parseKeyFilter(params?.keyId)
        // Matched exactly, like keys.list's environment and state.
        const reason = str(params?.reason)
        if (reason !== "" && !ROTATION_REASONS.includes(reason)) {
          throw badRequest("reason must be one of manual, compromise, policy, scheduled")
        }
        const { limit, offset } = clampPage(params)
        // One extra row tells whether another page exists.
        const recs = keysmith.rotations
          .filter((r) => r.tenantId === tenantId && (keyId === null || r.keyId === keyId) && (reason === "" || r.reason === reason))
          .sort(rotationStoreOrder)
          .slice(offset, offset + limit + 1)
        const hasMore = recs.length > limit
        if (hasMore) recs.length = limit
        const keys = rotationKeys(tenantId, recs)
        const now = Date.now()
        return { items: recs.map((r) => projectRotationItem(r, keys.get(r.keyId), now)), hasMore }
      },
    },

    // One bucket per period from the UTC bucket after falls in up to before,
    // every bucket present. The first failing check wins, in Go's order.
    "usage.series": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const period = params?.period
        if (!USAGE_PERIODS.includes(period)) throw badRequest("period must be one of hourly, daily, monthly")
        const after = parseUsageTime("after", params?.after, true)
        const before = parseUsageTime("before", params?.before, true)
        if (!timeAfter(before, after)) throw badRequest("before must be after after")
        // The whole first bucket counts, even when after is inside it.
        const first = usageTruncate(after.ms, period)
        const end = ceilMs(before)
        const starts = usageBucketStarts(first, end, period)
        if (!starts) {
          // Monthly is already the longest period, so only a shorter range helps.
          const advice = period === "monthly" ? "choose a shorter range" : "choose a longer period or a shorter range"
          throw badRequest(`this range has more than ${MAX_USAGE_BUCKETS} ${period} buckets; ${advice}`)
        }
        const keyId = parseKeyFilter(params?.keyId)

        const sums = new Map(starts.map((s) => [s, { requests: 0, errs: 0, serverErrs: 0, latency: 0 }]))
        // Every row in [first, before) truncates to one of the starts.
        for (const r of usageRows(tenantId, keyId, first, end)) {
          const b = sums.get(usageTruncate(r.createdAt, period))
          b.requests++
          if (r.statusCode >= 400) b.errs++
          if (r.statusCode >= 500) b.serverErrs++
          b.latency += r.latencyMs
        }
        return {
          period,
          buckets: starts.map((s) => {
            const b = sums.get(s)
            return {
              start: goRFC3339(s),
              requests: b.requests,
              clientErrors: b.errs - b.serverErrs,
              serverErrors: b.serverErrs,
              succeeded: b.requests - b.errs,
              // The mean rounded down, and null where there is nothing to average.
              avgLatencyMs: b.requests > 0 ? Math.floor(b.latency / b.requests) : null,
            }
          }),
          recorded: usageRecorded(tenantId),
        }
      },
    },

    // The tenant's recorded requests, newest first, with the total that match.
    // Both times are optional, and there is no bucket cap.
    "usage.records": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const after = parseUsageTime("after", params?.after, false)
        const before = parseUsageTime("before", params?.before, false)
        if (after && before && !timeAfter(before, after)) throw badRequest("before must be after after")
        const keyId = parseKeyFilter(params?.keyId)
        const { limit, offset } = clampPage(params)
        const rows = usageRows(tenantId, keyId, after ? ceilMs(after) : null, before ? ceilMs(before) : null)
        return { items: rows.slice(offset, offset + limit).map(projectUsageRecord), total: rows.length }
      },
    },

    // Keys by effective state, open windows, keys expiring within 7 days,
    // requests in the last 24 hours, the newest keys and rotations, and how
    // many policy fields this deployment enforces.
    overview: {
      kind: "query",
      handler: () => {
        const tenantId = tenant()
        const now = Date.now()
        const limiter = rateLimiterConfigured()
        const mine = keysmith.keys.filter((k) => k.tenantId === tenantId)

        // Effective state, as the badges show it. Counts start from the stored
        // state, then one scan of ListExpired(now + 7 days) (stored active keys
        // whose expiry is before then, this tenant's only) moves each one that
        // no longer reads active: past its expiry to expired, a set revokedAt
        // to revoked. Every passed expiry is inside that window, so this covers
        // every expiry. The one gap is a race: a stored active key with a
        // revokedAt and no expiry inside the window still counts as active.
        const counts = { active: 0, suspended: 0, revoked: 0, expired: 0 }
        for (const k of mine) if (Object.hasOwn(counts, k.state)) counts[k.state]++

        // Of the same scan, the keys that still read active are expiring.
        let expiringWithin7Days = 0
        for (const k of mine) {
          if (k.state !== "active" || k.expiresAt === null || k.expiresAt >= now + EXPIRES_SOON_WINDOW_MS) continue
          const { state } = effectiveState(k, now)
          if (state === "active") expiringWithin7Days++
          else if (state === "expired" || state === "revoked") {
            counts.active--
            counts[state]++
          }
        }

        // ListPendingGrace(now), this tenant's with an old hint, counted by
        // rotations.list's own windowOpen so the two pages agree.
        const pending = keysmith.rotations.filter((r) => r.graceEnds > now && r.tenantId === tenantId && r.oldHint !== "")
        const pendingKeys = rotationKeys(tenantId, pending)
        const openGraceWindows = pending.filter((r) => projectRotationItem(r, pendingKeys.get(r.keyId), now).windowOpen).length

        // null when the tenant never recorded usage, so the page can say so.
        const requestsLast24h = usageRecorded(tenantId) ? usageRows(tenantId, null, now - DAY_MS, null).length : null

        const recentRecs = keysmith.rotations
          .filter((r) => r.tenantId === tenantId)
          .sort(rotationStoreOrder)
          .slice(0, OVERVIEW_RECENT)
        const recentKeys = rotationKeys(tenantId, recentRecs)
        return {
          counts,
          openGraceWindows,
          expiringWithin7Days,
          requestsLast24h,
          recentKeys: mine
            .sort(keyStoreOrder)
            .slice(0, OVERVIEW_RECENT)
            .map((k) => projectKey(k, now)),
          recentRotations: recentRecs.map((r) => projectRotationItem(r, recentKeys.get(r.keyId), now)),
          enforcedFields: enforcedPolicyFieldCount(limiter),
          policyFields: POLICY_FIELD_COUNT,
        }
      },
    },

    // What this deployment runs with. A store that does not answer is
    // reported, not refused.
    settings: {
      kind: "query",
      handler: () => {
        const tenantId = tenant()
        const limiter = rateLimiterConfigured()
        const down = storeDown()
        return {
          plugins: fixturePlugins(),
          storeHealthy: !down,
          storeMessage: down ? STORE_DID_NOT_REPLY : STORE_ANSWERED,
          rateLimiterConfigured: limiter,
          tenantSource: tenantSource(),
          tenant: tenantId,
          enforcement: enforcementTable(limiter),
          enforcedFields: enforcedPolicyFieldCount(limiter),
          defaultGraceSeconds: DEFAULT_GRACE_SECONDS,
        }
      },
    },

    // Answers a raw key, once (keys.rotate is the other). `secret` is the
    // dispatcher's SecretResponse: server.mjs keeps a tombstone for the
    // idempotency key, not this answer, and a repeat answers CONFLICT.
    "keys.create": {
      kind: "command",
      secret: true,
      invalidates: ["keys.list", "keys.detail", "overview", "policies.detail"],
      handler: (params) => {
        const tenantId = tenant()

        const name = str(params?.name).trim()
        if (name === "") throw badRequest("name is required")
        if ([...name].length > MAX_KEY_NAME_LENGTH) throw badRequest("name is too long")

        // Trimmed like the name. One that is only spaces is no description.
        const description = str(params?.description).trim()
        if ([...description].length > MAX_KEY_DESCRIPTION_LENGTH) throw badRequest("description is too long")

        const environment = params?.environment
        if (!ENVIRONMENTS.includes(environment)) throw badRequest("environment must be one of live, test, staging")

        const prefix = params?.prefix
        if (typeof prefix !== "string" || !KEY_PREFIX_PATTERN.test(prefix)) {
          throw badRequest("prefix must be 2 to 16 lowercase letters or digits, starting with a letter")
        }

        let expiresAt = null
        const rawExpiry = params?.expiresAt
        if (rawExpiry !== undefined && rawExpiry !== null && rawExpiry !== "") {
          const at = typeof rawExpiry === "string" && RFC3339.test(rawExpiry) ? Date.parse(rawExpiry) : NaN
          if (Number.isNaN(at) || at <= Date.now()) {
            throw badRequest("expiresAt must be an RFC3339 timestamp in the future")
          }
          expiresAt = at
        }

        let pol = null
        const rawPolicyId = params?.policyId
        if (rawPolicyId !== undefined && rawPolicyId !== null && rawPolicyId !== "") {
          // One message for a malformed ID, a missing policy and another
          // tenant's policy, so a foreign ID is never confirmed. The engine
          // does not check the policy's tenant: this is the guard.
          pol = parseTypeID(rawPolicyId, "kpol") ? (keysmith.policies.get(rawPolicyId) ?? null) : null
          if (!pol || pol.tenantId !== tenantId) throw badRequest("policy not found")
        }

        const scopes = scopeStrings(params?.scopes)

        // The engine: a lifetime cap is checked before anything is written,
        // then every scope name, in the order given.
        const now = Date.now()
        if (pol && pol.maxKeyLifetime > 0 && expiresAt !== null && expiresAt > now + pol.maxKeyLifetime) {
          throw badRequest("expiresAt is beyond this policy's maximum key lifetime")
        }
        checkScopes(tenantId, pol, scopes)
        if (pol && pol.maxKeyLifetime > 0 && expiresAt === null) expiresAt = now + pol.maxKeyLifetime

        // prefix_environment_random. The raw key goes out in this response and
        // nowhere else: the row keeps the hint only.
        const rawKey = `${prefix}_${environment}_${randomBytes(32).toString("hex")}`
        const k = {
          id: newTypeID("akey"),
          tenantId,
          name,
          ...(description !== "" ? { description } : {}),
          prefix,
          hint: rawKey.slice(-4),
          environment,
          state: "active",
          policyId: pol ? pol.id : null,
          // Stored sorted and without duplicates, like the scope join.
          scopes: [...new Set(scopes)].sort(),
          createdBy: FIXTURE_OPERATOR,
          expiresAt,
          lastUsedAt: null,
          rotatedAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        keysmith.keys.push(k)
        return { key: projectKey(k, Date.now()), rawKey }
      },
    },

    // Answers a raw key, once. `secret` as on keys.create.
    "keys.rotate": {
      kind: "command",
      secret: true,
      invalidates: ["keys.list", "keys.detail", "rotations.list", "overview"],
      handler: (params) => {
        const tenantId = tenant()

        const reason = str(params?.reason)
        // "scheduled" is the engine's own reason, so the dashboard cannot claim it.
        if (!ROTATE_REASONS.includes(reason)) throw badRequest("reason must be one of manual, compromise, policy")
        const rawGrace = params?.graceSeconds
        let graceSeconds = null
        if (rawGrace !== undefined && rawGrace !== null) {
          // A value that is not a whole number fails the decode in Go.
          if (!Number.isInteger(rawGrace) || rawGrace < 0 || rawGrace > MAX_GRACE_SECONDS) {
            throw badRequest("graceSeconds must be between 0 and 7776000")
          }
          graceSeconds = rawGrace
        }

        const k = loadKeyForTenant(tenantId, params?.id)

        // The window: the request's, else the key's policy (when it sets
        // one), else 24 hours. Like the engine this does not check the
        // policy's tenant; only its grace is used and it is never shown.
        let graceMs = DEFAULT_GRACE_MS
        if (graceSeconds !== null) {
          graceMs = graceSeconds * 1000
        } else if (k.policyId) {
          const pol = keysmith.policies.get(k.policyId)
          if (pol && pol.gracePeriod > 0) graceMs = pol.gracePeriod
        }

        const now = Date.now()
        if (
          k.state === "revoked" ||
          k.state === "expired" ||
          k.revokedAt !== null ||
          (k.expiresAt !== null && now > k.expiresAt)
        ) {
          throw conflict("a revoked or expired key cannot be rotated")
        }

        const rawKey = `${k.prefix}_${k.environment}_${randomBytes(32).toString("hex")}`
        const newHint = rawKey.slice(-4)
        keysmith.rotations.push({
          id: newTypeID("krot"),
          tenantId: k.tenantId,
          keyId: k.id,
          reason,
          oldHint: k.hint,
          newHint,
          graceMs,
          rotatedBy: FIXTURE_OPERATOR,
          createdAt: now,
          graceEnds: now + graceMs,
        })
        k.hint = newHint
        k.rotatedAt = now
        k.updatedAt = now

        const after = Date.now()
        return { key: projectKey(k, after), rawKey, previousKeys: listOpenWindows(k.id, after) }
      },
    },

    "keys.endGrace": {
      kind: "command",
      invalidates: ["keys.detail", "rotations.list", "overview"],
      handler: (params) => {
        const tenantId = tenant()
        const k = loadKeyForTenant(tenantId, params?.id)
        const closed = endOpenWindows(k.id, Date.now())
        return { key: projectKey(k, Date.now()), closed }
      },
    },

    // A revoke stops a key blocking its policy's delete, so the policy page refreshes.
    "keys.revoke": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail", "rotations.list", "overview", "policies.detail"],
      handler: (params) => {
        const reason = str(params?.reason).trim()
        return keyStateChange({
          rawId: params?.id,
          conflictMessage: "this key is already revoked",
          validate: () => {
            if (reason === "") throw badRequest("reason is required")
            if ([...reason].length > MAX_REVOKE_REASON_LENGTH) throw badRequest("reason must be at most 500 characters")
          },
          allowed: (k, now) => effectiveState(k, now).state !== "revoked",
          apply: (k) => {
            const now = Date.now()
            k.state = "revoked"
            k.revokedAt = now
            k.updatedAt = now
            // A revoked key must not be reachable through a previous key either.
            endOpenWindows(k.id, now)
          },
        })
      },
    },

    "keys.suspend": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail", "overview"],
      handler: (params) =>
        keyStateChange({
          rawId: params?.id,
          conflictMessage: "only an active key can be suspended",
          // The effective state, so a key that is active in the store but past
          // its expiry is refused here.
          allowed: (k, now) => effectiveState(k, now).state === "active",
          apply: (k) => {
            k.state = "suspended"
            k.updatedAt = Date.now()
          },
        }),
    },

    "keys.reactivate": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail", "overview"],
      handler: (params) =>
        keyStateChange({
          rawId: params?.id,
          conflictMessage: "only a suspended key can be reactivated",
          allowed: (k) => k.state === "suspended" && k.revokedAt === null,
          apply: (k) => {
            k.state = "active"
            k.updatedAt = Date.now()
          },
        }),
    },

    "keys.scopes.assign": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail"],
      handler: (params) => {
        let names = []
        return keyStateChange({
          rawId: params?.id,
          conflictMessage: "a revoked key's scopes cannot be changed",
          validate: () => {
            names = scopesToChange(params?.scopes)
          },
          // The revoked check goes by the effective state, like Go.
          allowed: (k, now) => effectiveState(k, now).state !== "revoked",
          apply: (k) => {
            // The engine reads the key's policy without checking its tenant,
            // and a policy that has gone refuses with its own NOT_FOUND.
            let pol = null
            if (k.policyId) {
              pol = keysmith.policies.get(k.policyId) ?? null
              if (!pol) throw new FixtureError(404, "NOT_FOUND", "policy not found")
            }
            checkScopes(k.tenantId, pol, names)
            k.scopes = [...new Set([...k.scopes, ...names])].sort()
          },
        })
      },
    },

    "keys.scopes.remove": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail"],
      handler: (params) => {
        let names = []
        return keyStateChange({
          rawId: params?.id,
          conflictMessage: "a revoked key's scopes cannot be changed",
          validate: () => {
            names = scopesToChange(params?.scopes)
          },
          allowed: (k, now) => effectiveState(k, now).state !== "revoked",
          // Idempotent: a name the key does not hold, or that is no scope at
          // all, is not an error.
          apply: (k) => {
            k.scopes = k.scopes.filter((n) => !names.includes(n))
          },
        })
      },
    },

    "policies.create": {
      kind: "command",
      invalidates: ["policies.list", "overview"],
      handler: (params) => {
        const fields = decodePolicyFields(params)
        const tenantId = tenant()
        const pol = blankPolicy()
        applyPolicyFields(pol, fields)
        validatePolicy(tenantId, pol, null)
        // CreatePolicy: the name check, then the tenant and times are stamped.
        checkPolicyName(tenantId, pol.name, null)
        const now = Date.now()
        pol.id = newTypeID("kpol")
        pol.tenantId = tenantId
        pol.createdAt = now
        pol.updatedAt = now
        keysmith.policies.set(pol.id, pol)
        return { policy: projectPolicyDetail(pol) }
      },
    },

    // An edit changes the policy a key's detail shows.
    "policies.update": {
      kind: "command",
      invalidates: ["policies.list", "policies.detail", "keys.detail"],
      handler: (params) => {
        const fields = decodePolicyFields(params)
        const tenantId = tenant()
        const stored = loadPolicyForTenant(tenantId, params?.id)
        // Edit a copy of the loaded row, and write it back whole only once it passes.
        const pol = clonePolicy(stored)
        applyPolicyFields(pol, fields)
        validatePolicy(tenantId, pol, stored.allowedScopes)
        checkPolicyName(tenantId, pol.name, pol.id)
        pol.updatedAt = Date.now()
        keysmith.policies.set(pol.id, pol)
        return { policy: projectPolicyDetail(pol) }
      },
    },

    // Refuses while a key that is not revoked uses the policy. A revoked key
    // keeps its policyId, and its detail then reads the policy as none.
    "policies.delete": {
      kind: "command",
      invalidates: ["policies.list", "policies.detail", "overview", "keys.detail"],
      handler: (params) => {
        const tenantId = tenant()
        const pol = loadPolicyForTenant(tenantId, params?.id)
        // The engine's DeletePolicy checks keys in every tenant. The message
        // counts only this tenant's, so it never names another tenant's keys.
        if (keysmith.keys.some((k) => k.policyId === pol.id && k.state !== "revoked" && k.revokedAt === null)) {
          throw policyInUse(policyKeyCounts(tenantId, pol.id).blocking)
        }
        keysmith.policies.delete(pol.id)
        return { id: pol.id }
      },
    },

    "scopes.create": {
      kind: "command",
      invalidates: ["scopes.list", "overview"],
      handler: (params) => {
        const in_ = decodeScopeFields(params)
        const tenantId = tenant()
        validateScope(tenantId, in_)
        // CreateScope: the name check, then the tenant is stamped.
        if (keysmith.scopes.some((sc) => sc.tenantId === tenantId && sc.name === in_.name)) {
          throw conflict("a scope with this name already exists")
        }
        const sc = {
          id: newTypeID("kscp"),
          tenantId,
          name: in_.name,
          ...(in_.parent !== "" ? { parent: in_.parent } : {}),
          ...(in_.description !== "" ? { description: in_.description } : {}),
        }
        keysmith.scopes.push(sc)
        return { scope: projectScopeSummary(sc) }
      },
    },

    // Takes the scope off every key that holds it. Refuses while other scopes
    // name it as their parent, then while a policy lists it in allowedScopes.
    "scopes.delete": {
      kind: "command",
      invalidates: ["scopes.list", "keys.list", "keys.detail", "overview"],
      handler: (params) => {
        const tenantId = tenant()
        const sc = loadScopeForTenant(tenantId, params?.id)
        // The count reads one row past the cap, like countScopeChildren.
        const children = keysmith.scopes.filter((s) => s.tenantId === sc.tenantId && s.parent === sc.name)
        if (children.length > 0) throw scopeHasChildren(Math.min(children.length, MAX_SCOPE_CHILD_COUNT + 1))
        // An exact name match, the rule the engine's check and countAllowingPolicies use.
        let allowing = 0
        for (const p of keysmith.policies.values()) {
          if (p.tenantId === sc.tenantId && p.allowedScopes.includes(sc.name)) allowing++
        }
        if (allowing > 0) throw scopeAllowedByPolicy(allowing)
        keysmith.scopes = keysmith.scopes.filter((s) => s.id !== sc.id)
        // The join goes with the scope, for this tenant's keys only.
        for (const k of keysmith.keys) {
          if (k.tenantId === sc.tenantId) k.scopes = k.scopes.filter((n) => n !== sc.name)
        }
        return { id: sc.id }
      },
    },
  }
}
