// keysmith-fixtures.mjs: in-memory state and intent handlers for the keysmith
// contributor (packages/plugin-keysmith), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors forgery/keysmith/extension/contract (tenant.go, project.go, load.go,
// handlers_keys.go, handlers_pickers.go, handlers_key_create.go,
// handlers_key_rotate.go, handlers_key_state.go, handlers_key_scopes.go and
// manifest.yaml). Field names are the Go JSON tags, and every rule below is
// the Go handler's rule, in the Go handler's order, so a refusal here is a
// refusal there. Every write changes the state the next read answers from.
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
//
// Three things here are the fixture's own:
//   - There is no principal in the fixture. FIXTURE_KEYSMITH_TENANT stands in
//     for Deps.DefaultTenantID (default "acme"); set it to the empty string to
//     see the refusal a deployment with no tenant configured gets.
//   - With no signed-in user either, FIXTURE_OPERATOR stands in for the
//     principal's subject: it is the createdBy of a new key and the rotatedBy of
//     a rotation record.
//   - Times in the seed are relative to module load, and resetKeysmith()
//     recomputes them.

import { randomBytes } from "node:crypto"

// Stands in for the signed-in user (see above).
const FIXTURE_OPERATOR = "usr_fixture"

const DEFAULT_LIST_LIMIT = 25
const MAX_LIST_LIMIT = 100
// The pickers feed select boxes that want every row in one go.
const DEFAULT_PICKER_LIMIT = 100
const MAX_PICKER_LIMIT = 200
const MAX_KEY_NAME_LENGTH = 200
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

const ENVIRONMENTS = ["live", "test", "staging"]
// The engine never assigns "rotated", so it is not a filter.
const STATES = ["active", "suspended", "revoked", "expired"]

/** RFC3339 in UTC, without fractional seconds, like the Go projection. */
function iso(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z")
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
  // globex: must never reach acme
  globexKey: "akey_01j9k4m2eck3h8s0x1a5b6d7ef",
  globexPolicy: "kpol_01j9k4m1zyb1c2d3e4f5g6h7j8",
  // the scope store: acme's five, globex's one
  scopeBillingRead: "kscp_01j9k4m1yaa1b2c3d4e5f6g7h8",
  scopeBillingWrite: "kscp_01j9k4m1yab2c3d4e5f6g7h8j9",
  scopeReportsRead: "kscp_01j9k4m1yac3d4e5f6g7h8j9k0",
  scopeCatalogRead: "kscp_01j9k4m1yad4e5f6g7h8j9k0m1",
  scopeAdminAll: "kscp_01j9k4m1yae5f6g7h8j9k0m1n2",
  scopeGlobexInternal: "kscp_01j9k4m1yaf6g7h8j9k0m1n2p3",
  // billingKey's rotations: one open window, one whose grace has ended
  openRotation: "krot_01j9k4m3aac2d3e4f5g6h7j8k9",
  closedRotation: "krot_01j9k4m3abd3e4f5g6h7j8k9m0",
}

function seedKeysmithState() {
  const now = Date.now()
  const hour = 3600_000
  const day = 24 * hour

  const policies = new Map()
  policies.set(KEYSMITH_IDS.standardPolicy, {
    id: KEYSMITH_IDS.standardPolicy,
    tenantId: "acme",
    name: "Standard",
    description: "Ninety day keys with a day to roll over",
    maxKeyLifetime: 90 * day,
    gracePeriod: day,
    // A key under this policy may not hold admin:all.
    allowedScopes: ["billing:read", "billing:write", "reports:read", "catalog:read"],
  })
  // 0 is "not set" to the engine: no maximum lifetime, and rotation falls back
  // to a 24 hour grace. The contract sends both as null.
  policies.set(KEYSMITH_IDS.openPolicy, {
    id: KEYSMITH_IDS.openPolicy,
    tenantId: "acme",
    name: "Open",
    maxKeyLifetime: 0,
    gracePeriod: 0,
    // An empty list means the policy does not restrict scopes.
    allowedScopes: [],
  })
  policies.set(KEYSMITH_IDS.globexPolicy, {
    id: KEYSMITH_IDS.globexPolicy,
    tenantId: "globex",
    name: "Globex standard",
    maxKeyLifetime: 30 * day,
    gracePeriod: 2 * hour,
    allowedScopes: ["internal:all"],
  })

  // The scope store. A key's own scopes live on its row below, as a stand-in
  // for the key-scope join; some seed keys hold names that are not in here,
  // as they can in Go (the join stores names).
  const scopes = [
    { id: KEYSMITH_IDS.scopeBillingRead, tenantId: "acme", name: "billing:read", description: "Read invoices and charges" },
    { id: KEYSMITH_IDS.scopeBillingWrite, tenantId: "acme", name: "billing:write", description: "Create charges and refunds" },
    { id: KEYSMITH_IDS.scopeReportsRead, tenantId: "acme", name: "reports:read", description: "Read and export reports" },
    { id: KEYSMITH_IDS.scopeCatalogRead, tenantId: "acme", name: "catalog:read", description: "Read the product catalog" },
    { id: KEYSMITH_IDS.scopeAdminAll, tenantId: "acme", name: "admin:all", description: "Everything. Policies that list allowed scopes refuse it." },
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
      rotatedAt: null,
      revokedAt: null,
      createdAt: now - 100 * day,
      updatedAt: now - 100 * day,
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
      rotatedAt: null,
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
      policyId: null,
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
      rotatedAt: null,
      revokedAt: null,
      createdAt: now - 30 * day,
      updatedAt: now - 30 * day,
    },
  ]

  // Rotation records. A window is open when it kept an old hint and its grace
  // period has not ended. The closed one (grace ended) and any record without
  // an old hint (written before the grace fix) never read as open.
  const rotations = [
    {
      id: KEYSMITH_IDS.openRotation,
      keyId: KEYSMITH_IDS.billingKey,
      reason: "manual",
      oldHint: "7c1e",
      createdAt: now - 2 * hour,
      graceEnds: now + 22 * hour,
    },
    {
      id: KEYSMITH_IDS.closedRotation,
      keyId: KEYSMITH_IDS.billingKey,
      // No scheduler exists, so production never records "scheduled".
      reason: "policy",
      oldHint: "19d4",
      createdAt: now - 30 * day,
      graceEnds: now - 30 * day + day,
    },
  ]

  return { policies, scopes, keys, rotations }
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
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
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
          .sort((a, b) => b.createdAt - a.createdAt)

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

        out.previousKeys = listOpenWindows(k.id, now)
        return out
      },
    },


    "policies.list": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const { limit, offset } = pickerPage(params)
        // One extra row tells whether another page exists. The page is cut in
        // store order and only then sorted, as in Go.
        const rows = [...keysmith.policies.values()]
          .filter((p) => p.tenantId === tenantId)
          .slice(offset, offset + limit + 1)
        const hasMore = rows.length > limit
        if (hasMore) rows.length = limit
        rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        return { policies: rows.map(projectPolicySummary), hasMore }
      },
    },

    "scopes.list": {
      kind: "query",
      handler: (params) => {
        const tenantId = tenant()
        const { limit, offset } = pickerPage(params)
        const rows = keysmith.scopes.filter((sc) => sc.tenantId === tenantId).slice(offset, offset + limit + 1)
        const hasMore = rows.length > limit
        if (hasMore) rows.length = limit
        rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        return {
          scopes: rows.map((sc) => ({
            id: sc.id,
            name: sc.name,
            ...(sc.parent ? { parent: sc.parent } : {}),
            ...(sc.description ? { description: sc.description } : {}),
          })),
          hasMore,
        }
      },
    },

    // Answers a raw key, once (keys.rotate is the other).
    "keys.create": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail", "overview", "policies.detail"],
      handler: (params) => {
        const tenantId = tenant()

        const name = str(params?.name).trim()
        if (name === "") throw badRequest("name is required")
        if ([...name].length > MAX_KEY_NAME_LENGTH) throw badRequest("name is too long")

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
          ...(typeof params?.description === "string" && params.description !== "" ? { description: params.description } : {}),
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

    // Answers a raw key, once.
    "keys.rotate": {
      kind: "command",
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
          keyId: k.id,
          reason,
          oldHint: k.hint,
          newHint,
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

    "keys.revoke": {
      kind: "command",
      invalidates: ["keys.list", "keys.detail", "rotations.list", "overview"],
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
  }
}
