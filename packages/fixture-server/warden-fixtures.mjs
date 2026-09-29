// warden-fixtures.mjs: in-memory state and intent handlers for the warden
// contributor, kept out of server.mjs on purpose (see the commit message).
//
// This module is self-contained, matching core-fixtures.mjs: it does not
// import anything from server.mjs. A half-specified maintenance.cacheInvalidate
// call is rejected with a plain Error, which server.mjs's generic catch
// already maps to 400/BAD_REQUEST with the thrown message, the same result
// server.mjs's own badRequest() helper would produce. That keeps this file
// free of a circular import back into server.mjs.

// ---------------------------------------------------------------------------
// In-memory state: warden
//
// Seeded so the interesting answers are reachable rather than so the tables
// are non-empty. Two namespaces, because one cannot exercise the namespace
// filter or the ancestor cascade. An expired assignment, so maintenance.run
// reports a non-zero purge rather than a zero that proves nothing. A cached
// check log row and an errored one, because those two are the check log's
// scan signal and a page that never sees them cannot be checked.
// ---------------------------------------------------------------------------

// The actor the fixture stamps on rows it writes, as grantedBy, createdBy and
// updatedBy. The Go handlers take it from the signed-in principal.
const WARDEN_ACTOR = "user_fixture"

function seedWardenState() {
  const now = new Date().toISOString()
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  // Relative to server start, so "expiring soon" is still soon when somebody
  // opens the page, and "far out" stays far out for the length of a session.
  const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString()

  // Spread out and distinct, newest first, matching the array order below.
  // A real store bug (warden's memory store returns check logs
  // oldest-first, and does not sort at all at committed HEAD) is invisible
  // against a fixture where every row shares one timestamp: "recent" would
  // show whatever the handler slices first regardless of ordering, and a
  // regression there would pass this fixture silently.
  const checkAt = [0, 5, 10, 15].map(
    (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
  )

  return {
    roles: [
      { id: "role_01hq", namespacePath: "", name: "Reader", slug: "reader", isSystem: false, isDefault: true, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "role_01hr", namespacePath: "eng/platform", name: "Platform admin", slug: "platform-admin", isSystem: false, isDefault: false, parentSlug: "", maxMembers: 5, createdAt: hourAgo, updatedAt: now },
      // A parent resolves only inside its own namespace (the engine looks the
      // parent up by tenant, namespace and slug), so the inheritance the seed
      // shows has to stay inside eng/platform. platform-admin used to inherit
      // from the root "reader", a state the engine refuses to create.
      { id: "role_01ht", namespacePath: "eng/platform", name: "Platform oncall", slug: "platform-oncall", isSystem: false, isDefault: false, parentSlug: "platform-admin", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "role_01hs", namespacePath: "", name: "System", slug: "system", isSystem: true, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      // Capped at two and already full: dana and erin are its two live
      // members, so assigning a third subject reaches the cap refusal by
      // hand. Dana holds it twice (see the assignments below), which is
      // what makes "a member is a distinct subject, not a row" observable:
      // three rows, two members, and a third binding for dana is still
      // accepted.
      { id: "role_01hu", namespacePath: "", name: "Release approver", slug: "release-approver", isSystem: false, isDefault: false, parentSlug: "", maxMembers: 2, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    permissions: [
      { id: "perm_01a", namespacePath: "", name: "document:read", resource: "document", action: "read", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "perm_01b", namespacePath: "", name: "document:write", resource: "document", action: "write", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
      // System, on purpose: the only seeded way to reach permissions.update
      // and permissions.delete's system-permission refusal by hand. Already
      // granted to role_01hr below, so the isSystem guard (which the real
      // handler checks first) is what fires on it, not the holder conflict
      // guard; perm_01a stays available, granted and non-system, to reach
      // that conflict refusal on its own.
      { id: "perm_01c", namespacePath: "eng/platform", name: "cluster:admin", resource: "cluster", action: "admin", isSystem: true, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    // The role-permission junction, keyed by natural key exactly as the
    // store keys it: (roleId, namespacePath, name).
    grants: [
      { roleId: "role_01hq", namespacePath: "", name: "document:read" },
      { roleId: "role_01hr", namespacePath: "eng/platform", name: "cluster:admin" },
    ],
    // A spread of expiry states, because every one of them reads differently
    // on the page: none, inside a day, days out, months out, and already
    // lapsed. The lapsed row is the whole reason the list carries `expired`.
    // Rows are stored without it: it is computed per read, as in Go.
    assignments: [
      // No expiry.
      { id: "asgn_01a", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "alice", expiresAt: null, createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      // Already expired: maintenance.run must be able to report a purge, and
      // assignments.list must still show it. It stays visible until the
      // sweep runs, so the row can be found by hand; a maintenance run
      // removes it and only a restart brings it back.
      { id: "asgn_01b", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "carol", expiresAt: hourAgo, createdAt: hourAgo },
      // Inside a day, so the expiring feed's "soon" end has a row.
      { id: "asgn_01c", namespacePath: "eng/platform", roleId: "role_01hr", subjectKind: "user", subjectId: "bob", expiresAt: inHours(6), createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      // Days out: inside the default seven-day window, outside a day.
      { id: "asgn_01d", namespacePath: "eng/platform", roleId: "role_01ht", subjectKind: "service", subjectId: "deployer", expiresAt: inHours(5 * 24), createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      // Release approver: two live members, three rows. Dana holds the role
      // in two places (the tenant root, and on one document inside
      // eng/platform), so she is one member on two rows.
      { id: "asgn_01e", namespacePath: "", roleId: "role_01hu", subjectKind: "user", subjectId: "dana", expiresAt: inHours(90 * 24), createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      { id: "asgn_01f", namespacePath: "eng/platform", roleId: "role_01hu", subjectKind: "user", subjectId: "dana", resourceType: "document", resourceId: "runbook", expiresAt: null, createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      { id: "asgn_01g", namespacePath: "", roleId: "role_01hu", subjectKind: "user", subjectId: "erin", expiresAt: null, createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
    ],
    // Tuples in two namespaces, and a two-hop chain a person can trace:
    // folder:root#parent@document:readme, then document:readme#viewer@user:bob.
    // A namespace-filtered list is an exact match, so the eng/platform ones
    // are absent from a root-filtered list and the other way round. That is
    // the listing only: at check time the root tuples also apply in
    // eng/platform, because tuples cascade down like roles and policies.
    relations: [
      { id: "rel_01a", namespacePath: "", objectType: "document", objectId: "readme", relation: "viewer", subjectType: "user", subjectId: "bob", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      { id: "rel_01b", namespacePath: "", objectType: "folder", objectId: "root", relation: "parent", subjectType: "document", subjectId: "readme", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      // A userset subject (group:eng#member), the one shape with a
      // subjectRelation.
      { id: "rel_01c", namespacePath: "", objectType: "document", objectId: "readme", relation: "editor", subjectType: "group", subjectId: "eng", subjectRelation: "member", createdAt: hourAgo },
      { id: "rel_01d", namespacePath: "eng/platform", objectType: "document", objectId: "runbook", relation: "viewer", subjectType: "user", subjectId: "alice", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      { id: "rel_01e", namespacePath: "eng/platform", objectType: "cluster", objectId: "prod", relation: "admin", subjectType: "service", subjectId: "deployer", subjectRelation: "", createdAt: hourAgo },
    ],
    policies: [
      { id: "pol_01a", namespacePath: "", name: "contractor-lockout", effect: "deny", priority: 10, isActive: true, createdAt: hourAgo, updatedAt: now },
    ],
    resourceTypes: [
      // Two relations and a permission derived from both. Tuples still use
      // it as their object type (three of them, two at the root and one in
      // eng/platform, since a delete counts the type's namespace, everything
      // below it and each ancestor, and a root type has no ancestors), so
      // deleting it is refused by hand.
      {
        id: "rtype_01a", namespacePath: "", name: "document", description: "A document",
        relations: [
          { name: "viewer", allowedSubjects: ["user", "group#member"] },
          { name: "editor", allowedSubjects: ["user", "group#member"] },
        ],
        permissions: [
          { name: "read", expression: "viewer or editor" },
          { name: "write", expression: "editor" },
        ],
        createdBy: WARDEN_ACTOR, updatedBy: WARDEN_ACTOR, createdAt: hourAgo, updatedAt: hourAgo,
      },
      // SAVED WITH AN EXPRESSION THE WRITE PATH NOW REFUSES. "owner" is not a
      // declared relation, so "close" can never match. This is what the
      // REST handler and older tooling will store, and it is what the
      // detail page's warning exists for, so it has to be reachable. No
      // tuples use it, so it is also the resource type that can be deleted.
      // Editing it and saving without fixing the expression is refused.
      {
        id: "rtype_01b", namespacePath: "", name: "ticket", description: "Saved before expressions were checked",
        relations: [{ name: "assignee", allowedSubjects: ["user"] }],
        permissions: [{ name: "close", expression: "assignee or owner" }],
        createdBy: WARDEN_ACTOR, updatedBy: WARDEN_ACTOR, createdAt: hourAgo, updatedAt: hourAgo,
      },
      // In the child namespace, with a tuple of its own (cluster:prod).
      {
        id: "rtype_01c", namespacePath: "eng/platform", name: "cluster", description: "",
        relations: [{ name: "admin", allowedSubjects: ["service", "user"] }],
        permissions: [{ name: "operate", expression: "admin" }],
        createdAt: hourAgo, updatedAt: hourAgo,
      },
    ],
    // Newest first, matching what a correctly-ordered "Recent checks" panel
    // must show. Distinct createdAt values are the point: a fixture where
    // every row shares one timestamp cannot tell an ordering regression from
    // correct behaviour, because slicing from index 0 looks the same either
    // way.
    checkLogs: [
      { id: "chk_01a", namespacePath: "", subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "readme", decision: "allow", reason: "", evalTimeNs: 412_000, cached: false, error: "", createdAt: checkAt[0] },
      // Cached: the most common real answer to "why did my permission change
      // not take effect", and the page's scan signal.
      { id: "chk_01b", namespacePath: "", subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "readme", decision: "allow", reason: "", evalTimeNs: 1_800, cached: true, error: "", createdAt: checkAt[1] },
      { id: "chk_01c", namespacePath: "", subjectKind: "user", subjectId: "dave", action: "delete", resourceType: "document", resourceId: "readme", decision: "deny_explicit", reason: 'denied by policy "contractor-lockout"', evalTimeNs: 902_000, cached: false, error: "", createdAt: checkAt[2] },
      { id: "chk_01d", namespacePath: "eng/platform", subjectKind: "service", subjectId: "deployer", action: "admin", resourceType: "cluster", resourceId: "prod", decision: "error", reason: "", evalTimeNs: 0, cached: false, error: "store unavailable", createdAt: checkAt[3] },
    ],
    config: {
      maxGraphDepth: 10,
      maxGraphVisited: 5000,
      maxGraphFanout: 1000,
      maxBatchChecks: 100,
      cacheTtlSeconds: 60,
      cacheMaxSize: 10000,
      rbacEnabled: true,
      abacEnabled: true,
      rebacEnabled: true,
      checkLogEnabled: true,
      requireTenant: true,
      evaluateAllModels: false,
      checkLogQueueSize: 4096,
      checkLogRetentionHours: 2160,
      maintenanceIntervalMinutes: 60,
    },
  }
}

let warden = seedWardenState()

/**
 * Restores the seed. server.mjs's _fixture/reset does not call this today
 * (its committed reset has no warden in it at all), so warden state, once a
 * maintenance run has purged the expired assignment, comes back only with a
 * restart. Exported so that reset can be given the one line it needs.
 */
export function resetWardenFixtures() {
  warden = seedWardenState()
}

// ---------------------------------------------------------------------------
// Errors
//
// notFound, badRequest, permissionDenied, and conflict give the roles and
// permissions handlers below the same four refusal shapes the Go contract
// throws (extensions/dashboard/contract/errors.go: CodeNotFound,
// CodeBadRequest, CodePermissionDenied, CodeConflict). They stay local to
// this module for the same reason maintenance.cacheInvalidate's plain Error
// does: importing server.mjs's own FixtureError back into this file would
// create the circular import this module exists to avoid.
//
// That choice has one real consequence, worth naming rather than hiding.
// server.mjs's dispatch catch tests `err instanceof FixtureError` against
// its OWN class, and a class of the same name and shape declared in a
// second ES module is still a distinct constructor: the check fails, every
// time, for anything thrown from here. So every refusal below reaches the
// wire as 400/BAD_REQUEST, and the intended status and code survive only on
// the thrown object itself (.status, .code) and in the message text, not in
// the HTTP response. That is not a step down from the real backend, though:
// extensions/dashboard/contract/transport/http.go writes every handler
// error as 500 and puts the real distinction in the JSON body's error.code,
// never in the status line either. Neither a fixed 400 nor a fixed 500
// tells a caller apart from the status alone; both push that job to the
// body. What the caller actually depends on, a refused write leaving state
// unchanged, holds either way.
class WardenFixtureError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    // Mirrors contract.Error.Details. Only resourceTypes.create and update
    // set it (the expression diagnostics). It does not reach the wire, for
    // the reason in the comment above: server.mjs sends err.details only
    // for its own FixtureError.
    this.details = details
  }
}

function notFound(kind, id) {
  return new WardenFixtureError(404, "NOT_FOUND", `${kind} ${id} not found`)
}

function badRequest(message) {
  return new WardenFixtureError(400, "BAD_REQUEST", message)
}

function permissionDenied(message) {
  return new WardenFixtureError(403, "PERMISSION_DENIED", message)
}

function conflict(message) {
  return new WardenFixtureError(409, "CONFLICT", message)
}

/**
 * Pages an array the way every warden list intent pages a store: clamped
 * limit, clamped offset, and a total that counts the filtered set rather
 * than the returned page. A pager reading items.length would think there
 * was one page.
 */
function pageOf(rows, params) {
  // Mirrors PageRequest.Clamp in warden: an unset or non-positive limit is
  // the default of 25 (not 1), and only an oversized one is capped.
  const asked = Number(params?.limit)
  const limit = Math.min(asked > 0 ? asked : 25, 200)
  const offset = Math.max(Number(params?.offset) || 0, 0)
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
  }
}

/**
 * Applies the three-state namespace filter. An absent namespacePath means
 * every namespace; an empty string means the tenant root. Those are
 * different queries and collapsing them would scope every list to the root.
 */
function byNamespace(rows, params) {
  // null is the same as absent: Go decodes both to a nil *string, and
  // filtering to nothing on a null would hide every row.
  if (params?.namespacePath === undefined || params?.namespacePath === null) return rows
  return rows.filter((r) => r.namespacePath === params.namespacePath)
}

// ---------------------------------------------------------------------------
// Warden intents: the original four queries and two commands, the thirteen
// roles and permissions intents, and the twelve assignment, relation and
// resource type intents
// ---------------------------------------------------------------------------

/** Every distinct namespace on any warden entity, plus the tenant root. */
function wardenNamespaces() {
  const seen = new Set([""])
  for (const group of [warden.roles, warden.permissions, warden.assignments, warden.relations, warden.policies, warden.resourceTypes]) {
    for (const row of group) seen.add(row.namespacePath)
  }
  return [...seen].sort()
}

/**
 * Mirrors checkParent in the Go contract: a parent must exist in the role's
 * own namespace, may not be the role itself, and may not be one of its own
 * descendants.
 */
function checkParent(namespacePath, slug, parentSlug) {
  if (!parentSlug) return
  if (parentSlug === slug) throw badRequest("a role cannot be its own parent")
  const seen = new Set([slug])
  let cur = parentSlug
  while (cur) {
    if (seen.has(cur)) {
      throw badRequest("that parent would create a cycle in role inheritance")
    }
    seen.add(cur)
    const next = warden.roles.find((x) => x.namespacePath === namespacePath && x.slug === cur)
    if (!next) throw badRequest(`no role with slug ${cur} in this namespace`)
    cur = next.parentSlug
  }
}

// ---------------------------------------------------------------------------
// Shared by the assignment, relation and resource type intents
// ---------------------------------------------------------------------------

/**
 * A store refusal in the words the memory store uses: the entity and its id,
 * then warden's own sentinel text. mapWardenError passes err.Error() through
 * as the message, so this is what a page would see from the real server.
 */
function storeNotFound(label, rawId) {
  return new WardenFixtureError(404, "NOT_FOUND", `${label} ${rawId}: warden: ${label} not found`)
}

/**
 * Mirrors parseAssignmentID, parseRelationID and friends: an id with the
 * wrong prefix, or none, is a BAD_REQUEST naming what it is not, rather than
 * a NOT_FOUND. The fixture's ids are not real TypeIDs, so only the prefix is
 * checked.
 */
function requireId(prefix, label, raw) {
  if (typeof raw !== "string" || !raw.startsWith(prefix + "_") || raw.length === prefix.length + 1) {
    throw badRequest(`not ${/^[aeiou]/.test(label) ? "an" : "a"} ${label} id: ${raw ?? ""}`)
  }
  return raw
}

function newId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10)
}

/** Go's time.RFC3339 layout: whole seconds, Z. Never milliseconds. */
function rfc3339(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** The store's default order for every list: oldest first, id as tiebreak. */
function byCreated(a, b) {
  const d = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Go's %q for the strings these messages quote. */
function q(value) {
  return JSON.stringify(String(value))
}

/**
 * Mirrors warden.ValidateNamespacePath with the default depth of eight. The
 * tenant root, the empty string, is always valid.
 */
function validateNamespace(path) {
  if (!path) return
  if (path.startsWith("/") || path.endsWith("/")) {
    throw badRequest(`warden: namespace path ${q(path)} must not start or end with /`)
  }
  if (path.includes("//")) {
    throw badRequest(`warden: namespace path ${q(path)} must not contain empty segments`)
  }
  const segments = path.split("/")
  if (segments.length > 8) {
    throw badRequest(`warden: namespace path ${q(path)} exceeds max depth 8 (got ${segments.length})`)
  }
  for (const seg of segments) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(seg)) {
      throw badRequest(`warden: namespace segment ${q(seg)} is not valid (must match ^[a-z][a-z0-9-]{0,62}$)`)
    }
    if (seg === "system" || seg === "admin") {
      throw badRequest(`warden: namespace segment ${q(seg)} is reserved`)
    }
  }
}

/**
 * Mirrors warden.AncestorNamespaces: the path itself first, then each
 * ancestor up to and including the tenant root "". The root alone is [""].
 */
function ancestorNamespaces(path) {
  if (!path) return [""]
  const segments = path.split("/")
  const out = []
  for (let i = segments.length; i > 0; i--) out.push(segments.slice(0, i).join("/"))
  out.push("")
  return out
}

/** nsHasPrefix in the memory store: the prefix itself and everything below it. */
function nsHasPrefix(path, prefix) {
  return prefix === "" || path === prefix || path.startsWith(prefix + "/")
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

// Mirrors validSubjectKinds. A kind outside it stores an assignment no check
// will ever match.
const SUBJECT_KINDS = new Set(["user", "api_key", "service", "service_acct"])

/**
 * Mirrors validateResourceScope: both resource fields or neither. An id
 * without a type is a global grant (the store keeps every row whose
 * resourceType is empty, whatever its resourceId), and a type without an id
 * matches only checks on a resource whose id is empty. Both look scoped and
 * are not. Checked with the other inputs, before the member cap.
 */
function validateResourceScope(resourceType, resourceId) {
  if (resourceId && !resourceType) {
    throw badRequest(
      "resourceId needs a resourceType: warden ignores an id without a type, " +
        "so this assignment would apply to every resource, not one. Give both, or neither"
    )
  }
  if (resourceType && !resourceId) {
    throw badRequest(
      "resourceType needs a resourceId: without one this assignment would match " +
        "only checks on a resource whose id is empty. Give both, or neither"
    )
  }
}

// The window assignments.expiring uses when the caller names none. Not zero:
// a zero window returns nothing, and an empty page would look like nothing is
// lapsing.
const DEFAULT_EXPIRING_HOURS = 7 * 24

/** isLive in members.go: no expiry never expires; otherwise it must be ahead. */
function isLive(a, nowMs) {
  return !a.expiresAt || Date.parse(a.expiresAt) > nowMs
}

/**
 * projectAssignment. Field order follows the Go struct, and the omitempty
 * fields are absent rather than empty or null. `expired` is computed from
 * expiresAt against the clock here, never stored, exactly as in Go.
 */
function projectAssignment(a, nowMs) {
  const r = warden.roles.find((x) => x.id === a.roleId)
  const out = {
    id: a.id,
    namespacePath: a.namespacePath,
    roleId: a.roleId,
    roleSlug: r?.slug ?? "",
    roleName: r?.name ?? "",
    subjectKind: a.subjectKind,
    subjectId: a.subjectId,
  }
  if (a.resourceType) out.resourceType = a.resourceType
  if (a.resourceId) out.resourceId = a.resourceId
  if (a.expiresAt) out.expiresAt = rfc3339(a.expiresAt)
  out.expired = !isLive(a, nowMs)
  if (a.grantedBy) out.grantedBy = a.grantedBy
  out.createdAt = rfc3339(a.createdAt)
  return out
}

/**
 * Parses an RFC3339 instant the way Go's time.Parse(time.RFC3339, s) does:
 * a "T", whole or fractional seconds, and a Z or a numeric offset, with every
 * field in range. Returns null for anything else. Date.parse alone is too
 * forgiving: it takes "2030-01-01" and other things Go refuses, and a fixture
 * that forgives them hides the bug.
 */
function parseRFC3339(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(text)
  if (!m) return null
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number)
  if (month < 1 || month > 12) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > daysInMonth) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  if (m[7] !== "Z") {
    const [oh, om] = m[7].slice(1).split(":").map(Number)
    if (oh > 23 || om > 59) return null
  }
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : ms
}

/**
 * guardMemberCap in members.go. Three rules that are easy to get backwards:
 * MaxMembers 0 (or unset) is UNLIMITED; only LIVE assignments occupy a seat;
 * and a member is a distinct (subjectKind, subjectId), not a row, so a
 * subject who already holds the role live is never refused.
 */
function guardMemberCap(role, subjectKind, subjectId, nowMs) {
  if (!(role.maxMembers > 0)) return
  const members = new Set()
  for (const a of warden.assignments) {
    if (a.roleId === role.id && isLive(a, nowMs)) {
      members.add(JSON.stringify([a.subjectKind, a.subjectId]))
    }
  }
  if (members.has(JSON.stringify([subjectKind, subjectId]))) return
  if (members.size < role.maxMembers) return
  throw conflict(`${q(role.name)} is capped at ${role.maxMembers} members and already has ${members.size}`)
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/** projectTuple. subjectRelation and createdBy are omitempty. */
function projectTuple(t) {
  const out = {
    id: t.id,
    namespacePath: t.namespacePath,
    objectType: t.objectType,
    objectId: t.objectId,
    relation: t.relation,
    subjectType: t.subjectType,
    subjectId: t.subjectId,
  }
  if (t.subjectRelation) out.subjectRelation = t.subjectRelation
  if (t.createdBy) out.createdBy = t.createdBy
  out.createdAt = rfc3339(t.createdAt)
  return out
}

// ---------------------------------------------------------------------------
// Resource types
//
// The expression parser below is a port of dsl.CompileExpr (warden/dsl:
// lexer.go, token.go and the expression half of parser.go), because the
// diagnostics a page shows carry a line and a column and only a real parse
// produces the same ones. It works on bytes, as the Go lexer does, so a
// column after a multi-byte character matches. Token kinds are named by how
// Go's TokenKind.String() prints them, which is what the messages quote.
// ---------------------------------------------------------------------------

// The DSL's keywords. The lexer lifts them out of the identifier stream, so a
// relation named "name", "role" or "or" cannot be referenced in an
// expression: it lexes as a keyword and the expression is refused.
const DSL_KEYWORDS = new Set([
  "warden", "config", "tenant", "app", "namespace", "import", "resource", "relation",
  "permission", "role", "policy", "effect", "allow", "deny", "actions", "resources",
  "subjects", "when", "negate", "grants", "name", "description", "priority", "active",
  "is_system", "is_default", "max_members", "metadata", "or", "and", "not", "in",
  "contains", "starts_with", "ends_with", "exists", "ip_in_cidr", "time_after",
  "time_before", "all_of", "any_of", "not_before", "not_after", "obligations",
])

const isIdentStart = (c) => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f
const isDigit = (c) => c >= 0x30 && c <= 0x39
const isIdentPart = (c) => isIdentStart(c) || isDigit(c) || c === 0x2d

// Single-byte punctuation the lexer emits as a token of its own.
const PUNCT = new Set("{}()[],:;.|#&/".split("").map((c) => c.charCodeAt(0)))

function lexExpression(src) {
  const buf = Buffer.from(src, "utf8")
  let pos = 0
  let line = 1
  let col = 1
  let pending = null
  const peek = (n) => (pos + n >= buf.length ? 0 : buf[pos + n])
  const advance = () => {
    if (pos >= buf.length) return
    if (buf[pos] === 0x0a) {
      line++
      col = 1
    } else {
      col++
    }
    pos++
  }

  const skipTrivia = () => {
    while (pos < buf.length) {
      const ch = buf[pos]
      if (ch === 0x20 || ch === 0x09 || ch === 0x0d || ch === 0x0a) {
        advance()
      } else if (ch === 0x2f && peek(1) === 0x2f) {
        while (pos < buf.length && buf[pos] !== 0x0a) advance()
      } else if (ch === 0x2f && peek(1) === 0x2a) {
        const at = { line, col }
        advance()
        advance()
        let closed = false
        while (pos < buf.length) {
          if (buf[pos] === 0x2a && peek(1) === 0x2f) {
            advance()
            advance()
            closed = true
            break
          }
          advance()
        }
        if (!closed) {
          pending = { kind: "ILLEGAL", value: "unterminated block comment", ...at }
          return
        }
      } else {
        return
      }
    }
  }

  // Emits a one- or two-byte operator: `second` after the first byte picks
  // the two-byte kind.
  const operator = (at, second, kindTwo, kindOne) => {
    advance()
    if (second !== null && peek(0) === second) {
      advance()
      return { kind: kindTwo, value: kindTwo, ...at }
    }
    return { kind: kindOne, value: kindOne, ...at }
  }

  return function next() {
    skipTrivia()
    if (pending) {
      const t = pending
      pending = null
      return t
    }
    const at = { line, col }
    if (pos >= buf.length) return { kind: "EOF", value: "", ...at }
    const ch = buf[pos]

    if (ch === 0x22) {
      advance()
      const bytes = []
      while (pos < buf.length) {
        const c = buf[pos]
        if (c === 0x22) {
          advance()
          return { kind: "STRING", value: Buffer.from(bytes).toString("utf8"), ...at }
        }
        if (c === 0x0a) return { kind: "ILLEGAL", value: "unterminated string", ...at }
        if (c === 0x5c) {
          advance()
          if (pos >= buf.length) return { kind: "ILLEGAL", value: "unterminated string escape", ...at }
          const esc = buf[pos]
          advance()
          const mapped = { 0x5c: 0x5c, 0x22: 0x22, 0x6e: 0x0a, 0x74: 0x09, 0x72: 0x0d }[esc]
          if (mapped !== undefined) bytes.push(mapped)
          else bytes.push(0x5c, esc)
          continue
        }
        bytes.push(c)
        advance()
      }
      return { kind: "ILLEGAL", value: "unterminated string", ...at }
    }
    if (isIdentStart(ch)) {
      const start = pos
      while (pos < buf.length) {
        // A hyphen before ">" is the arrow, not part of the name, so
        // parent->read is three tokens while billing-admin is one.
        if (buf[pos] === 0x2d && peek(1) === 0x3e) break
        if (!isIdentPart(buf[pos])) break
        advance()
      }
      const lex = buf.toString("utf8", start, pos)
      if (lex === "true" || lex === "false") return { kind: "BOOL", value: lex, ...at }
      if (DSL_KEYWORDS.has(lex)) return { kind: lex, value: lex, ...at }
      return { kind: "IDENT", value: lex, ...at }
    }
    if (isDigit(ch)) {
      const start = pos
      while (pos < buf.length && isDigit(buf[pos])) advance()
      return { kind: "INT", value: buf.toString("utf8", start, pos), ...at }
    }
    if (PUNCT.has(ch)) {
      advance()
      const v = String.fromCharCode(ch)
      return { kind: v, value: v, ...at }
    }
    switch (ch) {
      case 0x2b: return operator(at, 0x3d, "+=", "+")
      case 0x2d: return operator(at, 0x3e, "->", "-")
      case 0x21: return operator(at, 0x3d, "!=", "!")
      case 0x3c: return operator(at, 0x3d, "<=", "<")
      case 0x3e: return operator(at, 0x3d, ">=", ">")
      case 0x3d: {
        advance()
        if (peek(0) === 0x3d) {
          advance()
          return { kind: "==", value: "==", ...at }
        }
        if (peek(0) === 0x7e) {
          advance()
          return { kind: "=~", value: "=~", ...at }
        }
        return { kind: "=", value: "=", ...at }
      }
    }
    // Anything else is one illegal rune. Consume all of its bytes.
    const size = ch >= 0xf0 ? 4 : ch >= 0xe0 ? 3 : ch >= 0xc0 ? 2 : 1
    const value = buf.toString("utf8", pos, Math.min(pos + size, buf.length))
    for (let i = 0; i < size; i++) advance()
    return { kind: "ILLEGAL", value, ...at }
  }
}

/**
 * dsl.CompileExpr. Returns the tree and the diagnostics, in the order the
 * parser found them, each with a 1-based line and byte column relative to the
 * expression text. A failed parse still returns a tree of placeholders, and
 * the caller must not trust it, as in Go.
 */
function compileExpression(src) {
  const next = lexExpression(src)
  const diags = []
  let cur = next()
  const advance = () => {
    cur = next()
  }
  const errf = (at, message) => diags.push({ line: at.line, col: at.col, message })

  function parseOr() {
    let left = parseAnd()
    while (cur.kind === "or" || cur.kind === "+") {
      advance()
      left = { type: "or", left, right: parseAnd() }
    }
    return left
  }
  function parseAnd() {
    let left = parseNot()
    while (cur.kind === "and" || cur.kind === "&") {
      advance()
      left = { type: "and", left, right: parseNot() }
    }
    return left
  }
  function parseNot() {
    if (cur.kind === "not" || cur.kind === "!" || cur.kind === "-") {
      advance()
      return { type: "not", inner: parseNot() }
    }
    return parsePrimary()
  }
  function parsePrimary() {
    if (cur.kind === "(") {
      advance()
      const e = parseOr()
      if (cur.kind === ")") advance()
      else errf(cur, "expected `)`")
      return e
    }
    if (cur.kind === "IDENT") {
      const at = { line: cur.line, col: cur.col }
      const first = cur.value
      advance()
      if (cur.kind !== "->") return { type: "ref", name: first, ...at }
      const steps = [first]
      while (cur.kind === "->") {
        advance()
        if (cur.kind !== "IDENT") {
          errf(cur, "expected identifier after `->`")
          break
        }
        steps.push(cur.value)
        advance()
      }
      return { type: "traverse", steps, ...at }
    }
    errf(cur, `expected expression, got ${cur.kind} ${q(cur.value)}`)
    return { type: "ref", name: "<error>", line: cur.line, col: cur.col }
  }

  const expr = parseOr()
  if (cur.kind !== "EOF") errf(cur, "unexpected trailing tokens after expression")
  return { expr, diags }
}

/**
 * referencedRelations: every relation an expression needs the current type
 * to declare. A bare name is a direct lookup on this type. A traversal
 * (parent->read) needs only its first step declared here, because every
 * later step belongs to whichever type the first hop lands on.
 */
function referencedRelations(e) {
  switch (e.type) {
    case "ref": return [{ name: e.name, line: e.line, col: e.col }]
    case "traverse": return [{ name: e.steps[0], line: e.line, col: e.col }]
    case "or":
    case "and": return [...referencedRelations(e.left), ...referencedRelations(e.right)]
    case "not": return referencedRelations(e.inner)
    default: return []
  }
}

/**
 * validateDefinitions in handlers_resourcetypes.go: names first, then every
 * expression parsed, then every referenced relation checked against the
 * declared ones. All the diagnostics found are reported together, in
 * declaration order, and ride on the error's details under "diagnostics".
 */
function validateDefinitions(relations, permissions) {
  const declared = new Set()
  for (const r of relations) {
    if (!r.name) throw badRequest("a relation needs a name")
    if (declared.has(r.name)) throw badRequest(`relation ${r.name} is declared twice`)
    declared.add(r.name)
  }
  const permNames = new Set()
  for (const p of permissions) {
    if (!p.name) throw badRequest("a permission needs a name")
    if (permNames.has(p.name)) throw badRequest(`permission ${p.name} is declared twice`)
    permNames.add(p.name)
  }

  const diagnostics = []
  for (const p of permissions) {
    const { expr, diags } = compileExpression(p.expression)
    if (diags.length > 0) {
      for (const d of diags) diagnostics.push({ permission: p.name, ...d })
      // The tree of a failed parse holds placeholders, so its references are
      // not worth checking.
      continue
    }
    for (const ref of referencedRelations(expr)) {
      if (declared.has(ref.name)) continue
      const message = permNames.has(ref.name)
        ? `${ref.name} is a permission, not a relation. A bare name, like the first step of a traversal, ` +
          "is looked up as a relation, not evaluated as a permission"
        : `relation ${ref.name} is not declared on this type`
      diagnostics.push({ permission: p.name, line: ref.line, col: ref.col, message })
    }
  }
  if (diagnostics.length === 0) return
  const parts = diagnostics.map((d) => `permission ${d.permission} at ${d.line}:${d.col}: ${d.message}`)
  throw new WardenFixtureError(
    400,
    "BAD_REQUEST",
    "invalid permission expression: " + parts.join("; "),
    { diagnostics }
  )
}

/** Reads a definition list off a payload, copying it so the caller cannot alias state. */
function relationDefs(list) {
  if (!Array.isArray(list)) throw badRequest("relations must be a list")
  return list.map((d) => ({
    name: d?.name ?? "",
    allowedSubjects: Array.isArray(d?.allowedSubjects) ? d.allowedSubjects.map(String) : [],
  }))
}

function permissionDefs(list) {
  if (!Array.isArray(list)) throw badRequest("permissions must be a list")
  return list.map((d) => ({ name: d?.name ?? "", expression: d?.expression ?? "" }))
}

/** projectResourceType: counts, not definitions. Description is omitempty. */
function projectResourceType(rt) {
  const out = { id: rt.id, namespacePath: rt.namespacePath, name: rt.name }
  if (rt.description) out.description = rt.description
  out.relationCount = rt.relations.length
  out.permissionCount = rt.permissions.length
  out.createdAt = rfc3339(rt.createdAt)
  out.updatedAt = rfc3339(rt.updatedAt)
  return out
}

export const wardenHandlers = {
  "config.detail": {
    kind: "query",
    handler: () => warden.config,
  },
  "overview.stats": {
    kind: "query",
    handler: () => ({
      roles: warden.roles.length,
      permissions: warden.permissions.length,
      assignments: warden.assignments.length,
      relations: warden.relations.length,
      policies: warden.policies.length,
      resourceTypes: warden.resourceTypes.length,
    }),
  },
  "overview.recentChecks": {
    kind: "query",
    handler: (params) => ({
      checks: warden.checkLogs.slice(0, params?.limit > 0 ? params.limit : 10),
    }),
  },
  "namespaces.list": {
    kind: "query",
    handler: () => ({ namespaces: wardenNamespaces() }),
  },
  "maintenance.run": {
    kind: "command",
    invalidates: [
      "overview.stats", "overview.recentChecks", "assignments.list",
      "assignments.expiring", "roles.detail", "namespaces.list",
    ],
    handler: () => {
      // A fixture that accepts a write and changes nothing hides the bug it
      // exists to expose, so this really removes the expired rows and a
      // second run honestly reports zero.
      const nowMs = Date.now()
      const before = warden.assignments.length
      warden.assignments = warden.assignments.filter(
        (a) => !a.expiresAt || Date.parse(a.expiresAt) > nowMs
      )
      return {
        assignmentsPurged: before - warden.assignments.length,
        checkLogsPurged: 0,
      }
    },
  },
  "maintenance.cacheInvalidate": {
    kind: "command",
    handler: (payload) => {
      const hasKind = Boolean(payload?.subjectKind)
      const hasId = Boolean(payload?.subjectId)
      if (hasKind !== hasId) {
        // The fixture must not forgive a half-specified subject, or a page
        // can ship sending one field and the bug appears only in production.
        // A plain Error here is deliberate: server.mjs's dispatch catch maps
        // any non-FixtureError to 400/BAD_REQUEST with this message, which
        // is exactly what its own badRequest() helper would produce, and
        // this module stays free of an import back into server.mjs.
        throw new Error(
          "subjectKind and subjectId must be given together, or both omitted to flush the tenant"
        )
      }
      return { scope: hasKind ? "subject" : "tenant" }
    },
  },

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  "roles.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.roles, params)
      if (params?.search) {
        const q = String(params.search).toLowerCase()
        // Name only, exactly as every real store filters it (the memory and
        // sqlite stores never look at the slug). Matching the slug here too
        // would hide a UI that promises a slug search the server cannot do.
        rows = rows.filter((r) => r.name.toLowerCase().includes(q))
      }
      if (params?.isSystem !== undefined) {
        rows = rows.filter((r) => r.isSystem === params.isSystem)
      }
      if (params?.isDefault !== undefined) {
        rows = rows.filter((r) => r.isDefault === params.isDefault)
      }
      return pageOf(rows, params)
    },
  },
  "roles.detail": {
    kind: "query",
    handler: (params) => {
      const r = warden.roles.find((x) => x.id === params?.id)
      if (!r) throw notFound("role", params?.id)
      const names = warden.grants.filter((g) => g.roleId === r.id)
      return {
        ...r,
        permissions: warden.permissions.filter((p) =>
          names.some((g) => g.name === p.name && g.namespacePath === p.namespacePath)
        ),
        // A child inherits from the parent in ITS OWN namespace, so a
        // same-slug role elsewhere is somebody else's parent.
        children: warden.roles.filter(
          (c) => c.parentSlug === r.slug && c.namespacePath === r.namespacePath
        ),
      }
    },
  },
  "roles.create": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      if (!payload?.name || !payload?.slug) {
        throw badRequest("a role needs a name and a slug")
      }
      const namespacePath = payload.namespacePath ?? ""
      checkParent(namespacePath, payload.slug, payload.parentSlug)
      // Slugs are unique per namespace. The real store refuses a second one
      // with CONFLICT, which is the likeliest way a create form fails.
      if (warden.roles.some((x) => x.namespacePath === namespacePath && x.slug === payload.slug)) {
        throw conflict(
          `role "${payload.slug}" in ns "${namespacePath}": warden: role already exists in this scope`
        )
      }
      const now = new Date().toISOString()
      const row = {
        id: "role_" + Math.random().toString(36).slice(2, 10),
        namespacePath,
        name: payload.name,
        slug: payload.slug,
        description: payload.description ?? "",
        parentSlug: payload.parentSlug ?? "",
        isSystem: false,
        isDefault: Boolean(payload.isDefault),
        maxMembers: payload.maxMembers ?? 0,
        createdAt: now,
        updatedAt: now,
      }
      warden.roles.push(row)
      return { id: row.id }
    },
  },
  "roles.update": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail", "permissions.detail", "assignments.list", "assignments.expiring"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.id)
      if (!r) throw notFound("role", payload?.id)
      // The system guard, matching the Go handler. Nothing below the
      // contract layer enforces this, so the fixture must not either.
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      if (payload.name !== undefined && payload.name === "") {
        throw badRequest("a role's name cannot be empty")
      }
      if (payload.parentSlug !== undefined) {
        checkParent(r.namespacePath, r.slug, payload.parentSlug)
      }
      // Only the fields present in the payload change. A fixture that
      // overwrote everything would hide the read-patch-write bug.
      for (const field of ["name", "description", "parentSlug"]) {
        if (payload[field] !== undefined) r[field] = payload[field]
      }
      if (payload.maxMembers !== undefined) r.maxMembers = payload.maxMembers
      if (payload.isDefault !== undefined) r.isDefault = payload.isDefault
      r.updatedAt = new Date().toISOString()
      return { id: r.id }
    },
  },
  "roles.delete": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail", "permissions.detail", "overview.stats", "namespaces.list", "assignments.list", "assignments.expiring"],
    handler: (payload) => {
      const i = warden.roles.findIndex((x) => x.id === payload?.id)
      if (i === -1) throw notFound("role", payload?.id)
      const r = warden.roles[i]
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      warden.roles.splice(i, 1)
      // The store cascades DeleteAssignmentsByRole, so the fixture does too.
      warden.assignments = warden.assignments.filter((a) => a.roleId !== r.id)
      warden.grants = warden.grants.filter((g) => g.roleId !== r.id)
      return {}
    },
  },
  "roles.attachPermission": {
    kind: "command",
    invalidates: ["roles.detail", "permissions.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.roleId)
      if (!r) throw notFound("role", payload?.roleId)
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      const ns = payload.permissionNamespacePath ?? ""
      const pm = warden.permissions.find(
        (p) => p.name === payload?.permissionName && p.namespacePath === ns
      )
      if (!pm) throw notFound("permission", payload?.permissionName)
      const already = warden.grants.some(
        (g) => g.roleId === r.id && g.name === pm.name && g.namespacePath === ns
      )
      if (!already) warden.grants.push({ roleId: r.id, namespacePath: ns, name: pm.name })
      return { id: r.id }
    },
  },
  "roles.detachPermission": {
    kind: "command",
    invalidates: ["roles.detail", "permissions.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.roleId)
      if (!r) throw notFound("role", payload?.roleId)
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      const ns = payload.permissionNamespacePath ?? ""
      const i = warden.grants.findIndex(
        (g) => g.roleId === r.id && g.name === payload?.permissionName && g.namespacePath === ns
      )
      // A detach of a grant the role does not hold must not read as
      // success, exactly as the Go handler refuses it. Message matches
      // rolesDetachPermissionHandler's wording exactly (role NAME, no "not
      // found" suffix) rather than bending notFound(kind, id) around a full
      // sentence.
      if (i === -1) {
        throw new WardenFixtureError(
          404,
          "NOT_FOUND",
          `${r.name} does not grant ${payload?.permissionName}`
        )
      }
      warden.grants.splice(i, 1)
      return { id: r.id }
    },
  },
  "roles.setPermissions": {
    kind: "command",
    invalidates: ["roles.detail", "permissions.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.roleId)
      if (!r) throw notFound("role", payload?.roleId)
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      const refs = payload?.permissions ?? []
      // Resolve every reference before writing any: all or nothing, so a
      // typo cannot leave the role with a set nobody chose.
      const resolved = refs.map((ref) => {
        const ns = ref.namespacePath ?? ""
        const pm = warden.permissions.find((p) => p.name === ref.name && p.namespacePath === ns)
        if (!pm) throw notFound("permission", ref.name)
        return { roleId: r.id, namespacePath: ns, name: pm.name }
      })
      warden.grants = warden.grants.filter((g) => g.roleId !== r.id).concat(resolved)
      return { id: r.id }
    },
  },

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  "permissions.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.permissions, params)
      if (params?.resource) rows = rows.filter((p) => p.resource === params.resource)
      if (params?.action) rows = rows.filter((p) => p.action === params.action)
      if (params?.search) {
        const q = String(params.search).toLowerCase()
        rows = rows.filter((p) => p.name.toLowerCase().includes(q))
      }
      // !== undefined, not truthiness: absent means "do not filter", false
      // means "only non-system ones", and a truthy check would collapse
      // those into the same result, matching roles.list's isSystem filter.
      if (params?.isSystem !== undefined) {
        rows = rows.filter((p) => p.isSystem === params.isSystem)
      }
      return pageOf(rows, params)
    },
  },
  "permissions.detail": {
    kind: "query",
    handler: (params) => {
      const pm = warden.permissions.find((x) => x.id === params?.id)
      if (!pm) throw notFound("permission", params?.id)
      const holderIds = warden.grants
        .filter((g) => g.name === pm.name && g.namespacePath === pm.namespacePath)
        .map((g) => g.roleId)
      return {
        ...pm,
        // Sorted by slug, matching the Go handler, so the page is stable.
        grantedBy: warden.roles
          .filter((r) => holderIds.includes(r.id))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
      }
    },
  },
  "permissions.create": {
    kind: "command",
    invalidates: ["permissions.list", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      if (!payload?.resource || !payload?.action) {
        throw badRequest("a permission needs a resource and an action")
      }
      const want = `${payload.resource}:${payload.action}`
      const name = payload.name || want
      if (name !== want) {
        throw badRequest(
          `name ${name} disagrees with ${want}: checks match on resource and action, so this permission would be unreachable by name`
        )
      }
      const namespacePath = payload.namespacePath ?? ""
      if (warden.permissions.some((x) => x.namespacePath === namespacePath && x.name === name)) {
        throw conflict(
          `permission "${name}" in ns "${namespacePath}": warden: permission already exists in this scope`
        )
      }
      const now = new Date().toISOString()
      const row = {
        id: "perm_" + Math.random().toString(36).slice(2, 10),
        namespacePath,
        name,
        resource: payload.resource,
        action: payload.action,
        description: payload.description ?? "",
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      }
      warden.permissions.push(row)
      return { id: row.id }
    },
  },
  "permissions.update": {
    kind: "command",
    invalidates: ["permissions.list", "permissions.detail"],
    handler: (payload) => {
      const pm = warden.permissions.find((x) => x.id === payload?.id)
      if (!pm) throw notFound("permission", payload?.id)
      if (pm.isSystem) {
        throw permissionDenied(
          `"${pm.name}" is a system permission and cannot be changed or deleted`
        )
      }
      if (payload.description !== undefined) pm.description = payload.description
      pm.updatedAt = new Date().toISOString()
      return { id: pm.id }
    },
  },
  "permissions.delete": {
    kind: "command",
    invalidates: ["permissions.list", "permissions.detail", "roles.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      const i = warden.permissions.findIndex((x) => x.id === payload?.id)
      if (i === -1) throw notFound("permission", payload?.id)
      const pm = warden.permissions[i]
      if (pm.isSystem) {
        throw permissionDenied(
          `"${pm.name}" is a system permission and cannot be changed or deleted`
        )
      }
      const holders = warden.grants
        .filter((g) => g.name === pm.name && g.namespacePath === pm.namespacePath)
        .map((g) => warden.roles.find((r) => r.id === g.roleId)?.slug)
        .filter(Boolean)
      if (holders.length > 0) {
        throw conflict(
          `${pm.name} is still granted by ${holders.join(", ")}. Detach it from those roles first.`
        )
      }
      warden.permissions.splice(i, 1)
      return {}
    },
  },

  // -------------------------------------------------------------------------
  // Assignments
  //
  // Create-and-delete only: the store exposes no update, so there is no
  // patch here. Every refusal below is one handlers_assignments.go makes.
  // -------------------------------------------------------------------------

  "assignments.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.assignments, params)
      if (params?.roleId) {
        requireId("role", "role", params.roleId)
        rows = rows.filter((a) => a.roleId === params.roleId)
      }
      if (params?.subjectKind) rows = rows.filter((a) => a.subjectKind === params.subjectKind)
      if (params?.subjectId) rows = rows.filter((a) => a.subjectId === params.subjectId)
      if (params?.resourceType) rows = rows.filter((a) => (a.resourceType ?? "") === params.resourceType)
      if (params?.resourceId) rows = rows.filter((a) => (a.resourceId ?? "") === params.resourceId)
      // Expired rows are NOT hidden. The engine ignores them when it
      // resolves roles, but the listing shows them, marked, so a page can
      // say the access is gone rather than pretend the row is not there.
      const nowMs = Date.now()
      const page = pageOf([...rows].sort(byCreated), params)
      return { ...page, items: page.items.map((a) => projectAssignment(a, nowMs)) }
    },
  },
  "assignments.expiring": {
    kind: "query",
    handler: (params) => {
      const hours = Number(params?.withinHours) > 0 ? Number(params.withinHours) : DEFAULT_EXPIRING_HOURS
      // Clamped like PageRequest.Clamp, not defaulted: an oversized request
      // gets the most the contract allows rather than the default of 25.
      const asked = Number(params?.limit)
      const limit = Math.min(asked > 0 ? asked : 25, 200)
      const nowMs = Date.now()
      const before = nowMs + hours * 3600_000
      // Rows with no expiry are excluded. Rows that already lapsed are
      // INCLUDED, as well as those about to: the bound is only "before",
      // so a small page can fill with old lapsed grants, which is why the
      // limit clamps rather than defaults.
      const rows = warden.assignments
        .filter((a) => a.expiresAt && Date.parse(a.expiresAt) < before)
        .sort((a, b) => {
          const d = Date.parse(a.expiresAt) - Date.parse(b.expiresAt)
          return d !== 0 ? d : a.id < b.id ? -1 : 1
        })
        .slice(0, limit)
      return { items: rows.map((a) => projectAssignment(a, nowMs)) }
    },
  },
  "assignments.create": {
    kind: "command",
    invalidates: ["assignments.list", "assignments.expiring", "roles.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      if (!payload?.subjectId) throw badRequest("an assignment needs a subject id")
      if (!SUBJECT_KINDS.has(payload.subjectKind)) {
        throw badRequest(
          "subjectKind must be one of user, api_key, service, service_acct, got " + (payload.subjectKind ?? "")
        )
      }
      const namespacePath = payload.namespacePath ?? ""
      validateNamespace(namespacePath)
      validateResourceScope(payload.resourceType ?? "", payload.resourceId ?? "")
      requireId("role", "role", payload.roleId)
      const role = warden.roles.find((r) => r.id === payload.roleId)
      if (!role) throw storeNotFound("role", payload.roleId)
      // NOTE: no system-role guard here, and that is deliberate, matching
      // Go. Bootstrap creates a system role and assigns a subject to it, so
      // refusing would break first-run bootstrap. Assigning is a membership
      // change, not an edit of the role. Every role WRITE refuses a system
      // role; this must not.
      const nowMs = Date.now()
      let expiresAt = null
      if (payload.expiresAt) {
        const when = parseRFC3339(String(payload.expiresAt))
        if (when === null) {
          throw badRequest("expiresAt must be an RFC3339 instant, got " + payload.expiresAt)
        }
        if (!(when > nowMs)) {
          throw badRequest("expiresAt is already in the past, so this assignment would grant nothing")
        }
        expiresAt = new Date(when).toISOString()
      }
      // The cap goes LAST among the input checks, so a malformed request
      // against a full role reports what is wrong with it rather than the
      // cap. A subject who already holds the role is never refused by the
      // cap, so a duplicate binding falls through and reports the duplicate.
      guardMemberCap(role, payload.subjectKind, payload.subjectId, nowMs)
      const resourceType = payload.resourceType ?? ""
      const resourceId = payload.resourceId ?? ""
      const dup = warden.assignments.some(
        (a) =>
          a.namespacePath === namespacePath &&
          a.roleId === role.id &&
          a.subjectKind === payload.subjectKind &&
          a.subjectId === payload.subjectId &&
          (a.resourceType ?? "") === resourceType &&
          (a.resourceId ?? "") === resourceId
      )
      if (dup) {
        throw conflict(
          `assignment role=${role.id} subject=${payload.subjectKind}:${payload.subjectId} ns ${q(namespacePath)}: warden: role already assigned to subject`
        )
      }
      const row = {
        id: newId("asgn"),
        namespacePath,
        roleId: role.id,
        subjectKind: payload.subjectKind,
        subjectId: payload.subjectId,
        expiresAt,
        grantedBy: WARDEN_ACTOR,
        createdAt: new Date().toISOString(),
      }
      if (resourceType) row.resourceType = resourceType
      if (resourceId) row.resourceId = resourceId
      warden.assignments.push(row)
      return { id: row.id }
    },
  },
  "assignments.delete": {
    kind: "command",
    invalidates: ["assignments.list", "assignments.expiring", "roles.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      requireId("asgn", "assignment", payload?.id)
      const i = warden.assignments.findIndex((a) => a.id === payload.id)
      if (i === -1) throw storeNotFound("assignment", payload.id)
      warden.assignments.splice(i, 1)
      return {}
    },
  },

  // -------------------------------------------------------------------------
  // Relations (tuples)
  //
  // Create-and-delete only. A namespace filter is an exact match, never a
  // prefix, so it lists what is stored in that one namespace. At check time
  // tuples DO cascade: a tuple applies in its namespace and every namespace
  // below it, like roles and policies, so a namespace's listing omits a
  // parent's tuples that also apply there.
  // -------------------------------------------------------------------------

  "relations.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.relations, params)
      for (const field of ["objectType", "objectId", "relation", "subjectType", "subjectId", "subjectRelation"]) {
        if (params?.[field]) rows = rows.filter((t) => (t[field] ?? "") === params[field])
      }
      const page = pageOf([...rows].sort(byCreated), params)
      return { ...page, items: page.items.map(projectTuple) }
    },
  },
  "relations.create": {
    kind: "command",
    invalidates: ["relations.list", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      // The same order as Go, so the first missing part reported is the
      // same one on every run.
      for (const field of ["objectType", "objectId", "relation", "subjectType", "subjectId"]) {
        if (!payload?.[field]) throw badRequest("a relation needs " + field)
      }
      const namespacePath = payload.namespacePath ?? ""
      validateNamespace(namespacePath)
      const subjectRelation = payload.subjectRelation ?? ""
      const dup = warden.relations.some(
        (t) =>
          t.namespacePath === namespacePath &&
          t.objectType === payload.objectType &&
          t.objectId === payload.objectId &&
          t.relation === payload.relation &&
          t.subjectType === payload.subjectType &&
          t.subjectId === payload.subjectId &&
          (t.subjectRelation ?? "") === subjectRelation
      )
      if (dup) {
        throw conflict(
          `relation ${payload.objectType}:${payload.objectId}#${payload.relation}@${payload.subjectType}:${payload.subjectId} ns ${q(namespacePath)}: warden: relation tuple already exists`
        )
      }
      const row = {
        id: newId("rel"),
        namespacePath,
        objectType: payload.objectType,
        objectId: payload.objectId,
        relation: payload.relation,
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
        subjectRelation,
        createdBy: WARDEN_ACTOR,
        createdAt: new Date().toISOString(),
      }
      warden.relations.push(row)
      return { id: row.id }
    },
  },
  "relations.delete": {
    kind: "command",
    invalidates: ["relations.list", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      requireId("rel", "relation", payload?.id)
      const i = warden.relations.findIndex((t) => t.id === payload.id)
      if (i === -1) throw storeNotFound("relation", payload.id)
      warden.relations.splice(i, 1)
      return {}
    },
  },

  // -------------------------------------------------------------------------
  // Resource types
  //
  // A type declares its relations and the permissions derived from them.
  // Writes validate what nothing below the contract validates: that every
  // expression parses, and that every relation it names is declared.
  // -------------------------------------------------------------------------

  "resourceTypes.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.resourceTypes, params)
      if (params?.search) {
        const needle = String(params.search).toLowerCase()
        rows = rows.filter((rt) => rt.name.toLowerCase().includes(needle))
      }
      const page = pageOf([...rows].sort(byCreated), params)
      return { ...page, items: page.items.map(projectResourceType) }
    },
  },
  "resourceTypes.detail": {
    kind: "query",
    handler: (params) => {
      requireId("rtype", "resource type", params?.id)
      const rt = warden.resourceTypes.find((x) => x.id === params.id)
      if (!rt) throw storeNotFound("resource type", params.id)
      // Both lists are always arrays, never null: a page doing
      // data.relations.length on null throws.
      const out = {
        ...projectResourceType(rt),
        relations: rt.relations.map((d) => ({ name: d.name, allowedSubjects: [...d.allowedSubjects] })),
        permissions: rt.permissions.map((d) => ({ name: d.name, expression: d.expression })),
      }
      if (rt.createdBy) out.createdBy = rt.createdBy
      if (rt.updatedBy) out.updatedBy = rt.updatedBy
      return out
    },
  },
  "resourceTypes.create": {
    kind: "command",
    invalidates: ["resourceTypes.list", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      if (!payload?.name) throw badRequest("a resource type needs a name")
      const namespacePath = payload.namespacePath ?? ""
      validateNamespace(namespacePath)
      const relations = relationDefs(payload.relations ?? [])
      const permissions = permissionDefs(payload.permissions ?? [])
      validateDefinitions(relations, permissions)
      if (warden.resourceTypes.some((x) => x.namespacePath === namespacePath && x.name === payload.name)) {
        throw conflict(
          `resource type ${q(payload.name)} ns ${q(namespacePath)}: warden: resource type already exists in this scope`
        )
      }
      const now = new Date().toISOString()
      const row = {
        id: newId("rtype"),
        namespacePath,
        name: payload.name,
        description: payload.description ?? "",
        relations,
        permissions,
        createdBy: WARDEN_ACTOR,
        updatedBy: WARDEN_ACTOR,
        createdAt: now,
        updatedAt: now,
      }
      warden.resourceTypes.push(row)
      return { id: row.id }
    },
  },
  "resourceTypes.update": {
    kind: "command",
    invalidates: ["resourceTypes.list", "resourceTypes.detail"],
    handler: (payload) => {
      requireId("rtype", "resource type", payload?.id)
      const rt = warden.resourceTypes.find((x) => x.id === payload.id)
      if (!rt) throw storeNotFound("resource type", payload.id)
      // Only the fields present change. null decodes to a nil pointer in Go,
      // so it is absent, while an empty list is present and clears the list.
      // Name and namespace are not patchable: tuples name a type by its name,
      // so a rename would strand every tuple that used the old one.
      const has = (v) => v !== undefined && v !== null
      let relations = rt.relations
      let permissions = rt.permissions
      // A permission expression is valid only against the relations it is
      // checked with, so when either list changes the resulting pair is
      // validated together. A description-only update validates nothing: it
      // must not be blocked by a definition it does not touch. That is why
      // the seeded "ticket" type can still have its description edited.
      if (has(payload.relations) || has(payload.permissions)) {
        if (has(payload.relations)) relations = relationDefs(payload.relations)
        if (has(payload.permissions)) permissions = permissionDefs(payload.permissions)
        validateDefinitions(relations, permissions)
      }
      if (has(payload.description)) rt.description = String(payload.description)
      rt.relations = relations
      rt.permissions = permissions
      rt.updatedBy = WARDEN_ACTOR
      rt.updatedAt = new Date().toISOString()
      return { id: rt.id }
    },
  },
  "resourceTypes.delete": {
    kind: "command",
    invalidates: ["resourceTypes.list", "resourceTypes.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      requireId("rtype", "resource type", payload?.id)
      const i = warden.resourceTypes.findIndex((x) => x.id === payload.id)
      if (i === -1) throw storeNotFound("resource type", payload.id)
      const rt = warden.resourceTypes[i]
      // A check resolves a type by name from the check's namespace up, and
      // considers tuples from the check's namespace up. So this type answers
      // for checks at its namespace and below, and every tuple in scope for
      // those checks uses it: tuples at its namespace or below it, and tuples
      // at each of its strict ancestors, because tuples cascade downward.
      // The tenant root prefix matches everything. Mirrors the Go guard,
      // which adds an exact-namespace count per strict ancestor.
      const ancestors = new Set(ancestorNamespaces(rt.namespacePath).slice(1))
      const used = warden.relations.filter(
        (t) =>
          t.objectType === rt.name &&
          (nsHasPrefix(t.namespacePath, rt.namespacePath) || ancestors.has(t.namespacePath))
      ).length
      if (used > 0) {
        throw conflict(
          `${used} relation tuples still use ${rt.name} as their object type. ` +
            "Delete them first: without the type the graph walker cannot resolve " +
            "a derived permission through them."
        )
      }
      warden.resourceTypes.splice(i, 1)
      return {}
    },
  },
}
