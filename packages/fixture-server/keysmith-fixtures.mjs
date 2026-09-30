// keysmith-fixtures.mjs: in-memory state and intent handlers for the keysmith
// contributor (packages/plugin-keysmith), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors forgery/keysmith/extension/contract (tenant.go, project.go,
// handlers_keys.go). Field names are the Go JSON tags, and every rule below is
// the Go handler's rule, in the Go handler's order, so a refusal here is a
// refusal there.
//
// The module is self-contained and imports nothing from server.mjs. The one
// thing it needs from there is the FixtureError class: server.mjs's dispatch
// catch tests `err instanceof FixtureError` against its own class, and a
// same-named class declared here would be a different constructor, so every
// refusal would reach the wire as 400/BAD_REQUEST. server.mjs therefore hands
// its class to createKeysmithHandlers.
//
// No raw key and no hash is ever stored or returned, only the hint (the last
// four characters of the raw key).
//
// Two things here are the fixture's own:
//   - There is no principal in the fixture. FIXTURE_KEYSMITH_TENANT stands in
//     for Deps.DefaultTenantID (default "acme"); set it to the empty string to
//     see the refusal a deployment with no tenant configured gets.
//   - Times in the seed are relative to module load, and resetKeysmith()
//     recomputes them.

const DEFAULT_LIST_LIMIT = 25
const MAX_LIST_LIMIT = 100
// How many rotation records keys.detail reads when looking for open windows.
const MAX_ROTATIONS_READ = 100
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
    maxKeyLifetime: 90 * day,
    gracePeriod: day,
  })
  // 0 is "not set" to the engine: no maximum lifetime, and rotation falls back
  // to a 24 hour grace. The contract sends both as null.
  policies.set(KEYSMITH_IDS.openPolicy, {
    id: KEYSMITH_IDS.openPolicy,
    tenantId: "acme",
    name: "Open",
    maxKeyLifetime: 0,
    gracePeriod: 0,
  })
  policies.set(KEYSMITH_IDS.globexPolicy, {
    id: KEYSMITH_IDS.globexPolicy,
    tenantId: "globex",
    name: "Globex standard",
    maxKeyLifetime: 30 * day,
    gracePeriod: 2 * hour,
  })

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
      // An acme key whose row points at globex's policy. CreateKey refuses
      // that, so in Go only a direct store write gets here. The tenant guard
      // in keys.detail answers policy: null and the key keeps its policyId.
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
      reason: "scheduled",
      oldHint: "19d4",
      createdAt: now - 30 * day,
      graceEnds: now - 30 * day + day,
    },
  ]

  return { policies, keys, rotations }
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

/** projectKey: omitempty fields are left out when unset; scopes is never absent. */
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
    scopes: [...k.scopes],
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
        const rawId = params?.id
        if (rawId === undefined || rawId === null || rawId === "") throw badRequest("id is required")
        if (!parseTypeID(rawId, "akey")) throw badRequest("id is not a key id")

        const k = keysmith.keys.find((row) => row.id === rawId)
        if (!k || k.tenantId !== tenantId) throw keyNotFound()

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

        const open = keysmith.rotations
          .filter((r) => r.keyId === k.id)
          .slice(0, MAX_ROTATIONS_READ)
          // A record with no old hint must never read as an open window.
          .filter((r) => r.oldHint !== "" && r.graceEnds > now)
          .sort((a, b) => a.graceEnds - b.graceEnds)
        out.previousKeys = open.map((r) => ({
          rotationId: r.id,
          hint: r.oldHint,
          reason: r.reason,
          rotatedAt: iso(r.createdAt),
          graceEnds: iso(r.graceEnds),
        }))
        return out
      },
    },
  }
}
