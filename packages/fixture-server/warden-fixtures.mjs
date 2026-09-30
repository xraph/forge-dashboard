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
    policies: seedPolicies(hourAgo, now),
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

/**
 * The policies. One for every state and flag the pages render, so each has a
 * row to look at, plus the shapes the analysis exists to catch. Stored rows,
 * so a few of them are shapes the write path now refuses (a window that ends
 * before it starts, an unknown operator): that is what a policy created before
 * validation, or through the REST API, looks like. The list and detail flags
 * come from analysePolicy at read time, never from here.
 *
 * Windows are relative to server start, like every other seed here, and are
 * stored as nanoseconds since the epoch (BigInt) so comparisons stay exact.
 *
 * This is a function declaration on purpose: it runs when the module loads,
 * before any const declared further down has been initialised, so it must not
 * use one.
 */
function seedPolicies(hourAgo, now) {
  const dayNs = (days) => BigInt(Math.round(Date.now() + days * 86_400_000)) * 1_000_000n
  // Older rows first, so the tie-break on age is visible and the order is stable.
  let minutes = 60
  const born = () => new Date(Date.now() - minutes-- * 60_000).toISOString()
  const condition = (id, field, operator, value) => {
    const c = { id: "cond_" + id, field, operator }
    if (value !== undefined) c.value = value
    return c
  }
  const policy = (id, fields) => {
    const at = born()
    return {
      id: "wpol_" + id,
      namespacePath: "",
      name: id,
      description: "",
      effect: "allow",
      priority: 100,
      isActive: true,
      notBefore: null,
      notAfter: null,
      version: 1,
      subjects: [],
      actions: [],
      resources: [],
      conditions: [],
      obligations: [],
      createdBy: WARDEN_ACTOR,
      updatedBy: WARDEN_ACTOR,
      createdAt: at,
      updatedAt: at,
      ...fields,
    }
  }
  return [
    // ACTIVE DENY: a role matcher and a two-row condition list, both of which
    // depend on the check, so nothing is flagged. The reference row.
    policy("contractor-lockout", {
      description: "Contractors are locked out of documents unless they are on the office network.",
      effect: "deny",
      priority: 10,
      version: 4,
      updatedAt: now,
      subjects: [{ kind: "user", id: "", role: "contractor" }],
      actions: ["delete", "export"],
      resources: ["document:*"],
      conditions: [
        condition("lock1", "subject.employment", "eq", "contractor"),
        condition("lock2", "context.network", "neq", "office"),
      ],
      obligations: ["audit"],
    }),
    // ACTIVE ALLOW.
    policy("staff-read-documents", {
      description: "Staff can read documents from a corporate network.",
      priority: 100,
      version: 3,
      subjects: [{ kind: "user", id: "", role: "staff" }],
      actions: ["read"],
      resources: ["document:*"],
      conditions: [condition("staff1", "context.ip", "ip_in_cidr", ["10.0.0.0/8", "192.168.0.0/16"])],
    }),
    // The same name in another namespace: the name is unique per namespace,
    // not per tenant, so this is legal and a rename onto it from the root is not.
    policy("staff-read-documents", {
      id: "wpol_staff-read-documents-platform",
      namespacePath: "eng/platform",
      description: "The platform team's copy, narrower than the root one.",
      priority: 100,
      subjects: [{ kind: "user", id: "", role: "platform-admin" }],
      actions: ["read"],
      resources: ["cluster:*"],
      conditions: [condition("staffp1", "subject.level", "gte", 2)],
    }),
    // INACTIVE.
    policy("draft-export-block", {
      description: "Not switched on yet.",
      effect: "deny",
      priority: 20,
      isActive: false,
      subjects: [{ kind: "service", id: "", role: "" }],
      actions: ["export"],
      resources: ["report:*"],
    }),
    // SCHEDULED: active, but the window has not opened.
    policy("quarter-end-freeze", {
      description: "Blocks deploys at quarter end.",
      effect: "deny",
      priority: 15,
      notBefore: dayNs(10),
      notAfter: dayNs(20),
      subjects: [{ kind: "service", id: "", role: "" }],
      actions: ["deploy"],
      resources: ["cluster:prod"],
    }),
    // EXPIRED: active, but the window has closed.
    policy("holiday-freeze", {
      description: "Last winter's change freeze.",
      effect: "deny",
      priority: 15,
      notBefore: dayNs(-20),
      notAfter: dayNs(-3),
      subjects: [{ kind: "service", id: "", role: "" }],
      actions: ["deploy"],
      resources: ["cluster:prod"],
    }),
    // NEVER: the window ends before it starts, so it cannot be in effect at
    // any instant. The write path refuses this now; a stored one still exists.
    policy("misordered-window", {
      description: "Saved with the end before the start.",
      priority: 100,
      notBefore: dayNs(5),
      notAfter: dayNs(2),
      subjects: [{ kind: "user", id: "", role: "" }],
      actions: ["read"],
      resources: ["report:*"],
    }),
    // OBLIGATIONS AND A WINDOW, in effect right now.
    policy("after-hours-approval", {
      description: "Out-of-hours access is allowed for the on-call window, with obligations.",
      priority: 50,
      notBefore: dayNs(-2),
      notAfter: dayNs(30),
      subjects: [{ kind: "user", id: "", role: "oncall" }],
      actions: ["read", "write"],
      resources: ["cluster:*"],
      conditions: [condition("after1", "context.hour", "gte", 18)],
      obligations: ["log", "notify:security"],
    }),
    // FAILS CLOSED: a deny whose first condition is a regex that does not
    // compile. The engine errors, and a deny that errors applies. A working
    // condition after it changes nothing.
    policy("legacy-id-pattern-deny", {
      description: "Saved with a pattern that never compiled.",
      effect: "deny",
      priority: 30,
      subjects: [{ kind: "user", id: "", role: "" }],
      actions: ["delete"],
      resources: ["document:*"],
      conditions: [
        condition("legacy1", "subject.id", "regex", "(unclosed"),
        condition("legacy2", "subject.level", "lt", 3),
      ],
    }),
    // NEVER APPLIES, unknown operator: an allow that throws is skipped.
    policy("fuzzy-network-allow", {
      description: "Uses an operator warden does not have.",
      priority: 100,
      subjects: [{ kind: "user", id: "", role: "" }],
      actions: ["read"],
      resources: ["document:*"],
      conditions: [condition("fuzzy1", "context.ip", "approximately", "10.0.0.0/8")],
    }),
    // NEVER APPLIES, and the deciding condition is the SECOND one: the first
    // varies with the check, the second is an ip_in_cidr with no valid CIDR.
    policy("vpn-only-access", {
      description: "The CIDRs were typed wrong.",
      priority: 100,
      subjects: [{ kind: "user", id: "", role: "employee" }],
      actions: ["read"],
      resources: ["document:*"],
      conditions: [
        condition("vpn1", "subject.level", "gte", 2),
        condition("vpn2", "context.ip", "ip_in_cidr", ["10.0.0.0/99", "not-a-network"]),
      ],
    }),
    // MATCHES EVERYTHING: all three matcher lists empty.
    policy("catch-all-allow", {
      description: "No subjects, actions or resources: it applies to every check.",
      priority: 900,
    }),
    // A SUBJECT MATCHER THAT IS EMPTY inside a list: it matches everyone, so
    // the subject list restricts nothing although it has two entries. The
    // actions and resources still restrict, so the policy as a whole does not
    // match everything.
    policy("legacy-empty-subject", {
      description: "One of its subjects is the empty matcher.",
      effect: "deny",
      priority: 40,
      subjects: [{ kind: "user", id: "u1", role: "" }, { kind: "", id: "", role: "" }],
      actions: ["delete"],
      resources: ["report:*"],
    }),
    // A not_in GIVEN A STRING: not_in against something that is not a list is
    // always true, so this deny denies everyone the other matchers select.
    policy("office-ip-lockout", {
      description: "not_in was given a string, not a list.",
      effect: "deny",
      priority: 25,
      subjects: [{ kind: "user", id: "", role: "" }],
      actions: ["export"],
      resources: ["document:*"],
      conditions: [condition("office1", "context.ip", "not_in", "10.0.0.0/8")],
    }),
    // ACTIONS *:* matches every action.
    policy("wildcard-actions-deny", {
      description: "Every action, for services only.",
      effect: "deny",
      priority: 35,
      subjects: [{ kind: "service", id: "", role: "" }],
      actions: ["*:*"],
      resources: ["report:*"],
    }),
    // ALWAYS PRESENT: subject.id is never absent, so not_exists is never true.
    policy("anonymous-only-allow", {
      description: "Meant for callers with no id. Every caller has one.",
      priority: 100,
      subjects: [{ kind: "user", id: "", role: "" }],
      actions: ["read"],
      resources: ["public:*"],
      conditions: [condition("anon1", "subject.id", "not_exists")],
    }),
    // MATCHES ANYTHING: an empty prefix is a prefix of every value.
    policy("any-ip-allow", {
      description: "Meant to restrict by IP. An empty prefix restricts nothing.",
      priority: 100,
      subjects: [{ kind: "user", id: "", role: "employee" }],
      actions: ["read"],
      resources: ["document:*"],
      conditions: [condition("anyip1", "context.ip", "starts_with", "")],
    }),
  ]
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
    // Mirrors contract.Error.Details. resourceTypes.create and update set it
    // (the expression diagnostics), and so do the policy writes ({ fields,
    // conditions } for a rejected draft). It does not reach the wire, for
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
// roles and permissions intents, the twelve assignment, relation and
// resource type intents, and the seven policy intents
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

// ---------------------------------------------------------------------------
// Policies: the analysis and the validation, ported from the Go contract
//
// The authority is the committed Go in warden's extension/contract
// (policy_analysis.go, policy_validate.go, handlers_policies.go). This is an
// independent double of it, not a translation of the plan's snippets, and it
// is deliberately as unforgiving as Go: a fixture that forgives what Go
// refuses lets a page look right here and wrong against the server.
//
// Go's own standard library decides several of the outcomes (fmt.Sprint,
// strconv.ParseFloat, time.Parse, net.ParseCIDR, regexp), so each of those is
// ported below as a small function rather than approximated with the nearest
// JavaScript built-in. Where JavaScript cannot match Go exactly the fixture is
// CONSERVATIVE: it never claims a fixed outcome Go would not. The known gaps
// are listed at goRegex and at the end of classifyCondition.
// ---------------------------------------------------------------------------

/** strings.TrimSpace: Go trims unicode.IsSpace, which is not JavaScript's trim (no U+FEFF, but U+0085). */
const GO_SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000"
const GO_TRIM = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, "g")
function goTrimSpace(s) {
  return s.replace(GO_TRIM, "")
}

/** Go's %q for the strings these messages quote. */
function goQuote(value) {
  let out = '"'
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0)
    const simple = { 7: "\\a", 8: "\\b", 12: "\\f", 10: "\\n", 13: "\\r", 9: "\\t", 11: "\\v", 92: "\\\\", 34: '\\"' }[cp]
    if (simple) out += simple
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0")
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "\\ufffd"
    else if (cp >= 0x20 && cp < 0x7f) out += ch
    else if (/^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(ch)) out += ch
    else out += cp < 0x10000 ? "\\u" + cp.toString(16).padStart(4, "0") : "\\U" + cp.toString(16).padStart(8, "0")
  }
  return out + '"'
}

/** fmt.Sprint's %v for a float64: %g, shortest digits, exponent below -4 or at 6 and above. */
function goFloatString(n) {
  if (Number.isNaN(n)) return "NaN"
  if (n === Infinity) return "+Inf"
  if (n === -Infinity) return "-Inf"
  if (n === 0) return Object.is(n, -0) ? "-0" : "0"
  const [mantissa, expText] = Math.abs(n).toExponential().split("e")
  const digits = mantissa.replace(".", "")
  const exp = Number(expText)
  let out
  if (exp < -4 || exp >= 6) {
    out =
      digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") +
      "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0")
  } else if (exp >= 0) {
    out = digits.length > exp + 1 ? digits.slice(0, exp + 1) + "." + digits.slice(exp + 1) : digits.padEnd(exp + 1, "0")
  } else {
    out = "0." + "0".repeat(-exp - 1) + digits
  }
  return (n < 0 ? "-" : "") + out
}

/**
 * fmt.Sprint of a decoded JSON value. nil is "<nil>", which is what a missing
 * attribute prints as and what the analysis compares against.
 */
function goSprint(v) {
  if (v === undefined || v === null) return "<nil>"
  switch (typeof v) {
    case "string": return v
    case "boolean": return v ? "true" : "false"
    case "number": return goFloatString(v)
  }
  if (Array.isArray(v)) return "[" + v.map(goSprint).join(" ") + "]"
  return "map[" + Object.keys(v).sort().map((k) => k + ":" + goSprint(v[k])).join(" ") + "]"
}

/** strconv's underscoreOK: an underscore only between digits, or after a base prefix. */
function underscoreOK(text) {
  let s = text
  let saw = "^"
  let i = 0
  if (s.length >= 1 && (s[0] === "-" || s[0] === "+")) s = s.slice(1)
  let hex = false
  if (s.length >= 2 && s[0] === "0" && "bBoOxX".includes(s[1])) {
    i = 2
    saw = "0"
    hex = s[1] === "x" || s[1] === "X"
  }
  for (; i < s.length; i++) {
    const c = s[i]
    if (/[0-9]/.test(c) || (hex && /[a-fA-F]/.test(c))) {
      saw = "0"
      continue
    }
    if (c === "_") {
      if (saw !== "0") return false
      saw = "_"
      continue
    }
    if (saw === "_") return false
    saw = "!"
  }
  return saw !== "_"
}

/**
 * strconv.ParseFloat(s, 64). Returns the number, or null when Go returns an
 * error, which includes a value out of range: asNumber reads `err == nil`, so
 * "1e999" is not a number to warden even though it is +Inf to ParseFloat.
 */
function parseGoFloat(s) {
  if (typeof s !== "string") return null
  let m = /^([+-]?)(?:inf|infinity)$/i.exec(s)
  if (m) return m[1] === "-" ? -Infinity : Infinity
  if (/^nan$/i.test(s)) return NaN
  if (s.includes("_")) {
    if (!underscoreOK(s)) return null
    s = s.replaceAll("_", "")
  }
  m = /^([+-]?)0[xX]([0-9a-fA-F]*)\.?([0-9a-fA-F]*)[pP]([+-]?\d+)$/.exec(s)
  if (m) {
    const whole = m[2]
    const fraction = /^([+-]?)0[xX][0-9a-fA-F]*\.([0-9a-fA-F]*)/.exec(s)?.[2] ?? ""
    if (whole.length + fraction.length === 0) return null
    const value = Number(BigInt("0x" + (whole + fraction))) * 2 ** (Number(m[4]) - 4 * fraction.length)
    if (!Number.isFinite(value)) return null
    return m[1] === "-" ? -value : value
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null
  const value = Number(s)
  return Number.isFinite(value) ? value : null
}

/** asNumber in policy_analysis.go: a JSON number, or a string ParseFloat accepts. */
function goAsNumber(v) {
  if (typeof v === "number") return v
  if (typeof v === "string") return parseGoFloat(v)
  return null
}

// ---- time.Parse(time.RFC3339, s) ------------------------------------------

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function daysFromCivil(y0, m, d) {
  const y = m <= 2 ? y0 - 1 : y0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468
}

/**
 * time.Parse(time.RFC3339, s) as an instant in nanoseconds since the epoch
 * (a BigInt), or null. It follows Go's general parser, not a regex for what
 * RFC 3339 says: the hour may be one digit, the fraction may follow a comma,
 * an offset may reach 24:60, a second of 60 is refused and lower case is
 * refused. Date.parse forgives most of what Go refuses.
 */
function parseGoTime(text) {
  if (typeof text !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/.exec(text)
  if (!m) return null
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  let offset = 0
  if (!m[8]) {
    const oh = Number(m[10])
    const om = Number(m[11])
    if (oh > 24 || om > 60) return null
    offset = (oh * 60 + om) * 60
    if (m[9] === "-") offset = -offset
  }
  const nanos = m[7] ? Number(m[7].slice(0, 9).padEnd(9, "0")) : 0
  const seconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset
  return BigInt(seconds) * 1_000_000_000n + BigInt(nanos)
}

/** Go's time.Format(time.RFC3339) of an instant, in UTC, whole seconds. */
function formatGoTime(ns) {
  let seconds = ns / 1_000_000_000n
  if (ns % 1_000_000_000n < 0n) seconds -= 1n
  return new Date(Number(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
}

// ---- net.ParseCIDR ---------------------------------------------------------

function parseStrictIPv4(s) {
  const parts = s.split(".")
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && !(p.length > 1 && p[0] === "0") && Number(p) <= 255)
}

/** netip.parseIPv6, minus the zone (a zone makes ParseCIDR refuse anyway). */
function parseStrictIPv6(text) {
  let s = text
  let ellipsis = -1
  if (s.length >= 2 && s[0] === ":" && s[1] === ":") {
    ellipsis = 0
    s = s.slice(2)
    if (s.length === 0) return true
  }
  let i = 0
  while (i < 16) {
    let off = 0
    let acc = 0
    for (; off < s.length; off++) {
      const c = s[off]
      if (!/[0-9a-fA-F]/.test(c)) break
      acc = acc * 16 + parseInt(c, 16)
      if (off > 3) return false
    }
    if (off === 0) return false
    if (off < s.length && s[off] === ".") {
      if (ellipsis < 0 && i !== 12) return false
      if (i + 4 > 16) return false
      if (!parseStrictIPv4(s)) return false
      s = ""
      i += 4
      break
    }
    i += 2
    s = s.slice(off)
    if (s.length === 0) break
    if (s[0] !== ":" || s.length === 1) return false
    s = s.slice(1)
    if (s[0] === ":") {
      if (ellipsis >= 0) return false
      ellipsis = i
      s = s.slice(1)
      if (s.length === 0) break
    }
  }
  if (s.length !== 0) return false
  if (i < 16) return ellipsis >= 0
  return ellipsis < 0
}

/** net.ParseCIDR reports no error. */
function goParseCIDR(s) {
  if (typeof s !== "string") return false
  const slash = s.indexOf("/")
  if (slash < 0) return false
  const addr = s.slice(0, slash)
  const mask = s.slice(slash + 1)
  if (addr.includes("%")) return false
  let bits
  const first = /[.:]/.exec(addr)?.[0]
  if (first === ".") {
    if (!parseStrictIPv4(addr)) return false
    bits = 32
  } else if (first === ":") {
    if (!parseStrictIPv6(addr)) return false
    bits = 128
  } else {
    return false
  }
  if (!/^\d+$/.test(mask)) return false
  const n = Number(mask)
  return n < 0xffffff && n <= bits
}

// ---- regexp (Go's RE2 dialect) ---------------------------------------------
//
// warden compiles a regex condition with Go's regexp, and JavaScript's RegExp
// is a different language: it has lookaround and back references RE2 refuses,
// it refuses `^*` which RE2 accepts, it reads `[[:alpha:]]` as something else
// and it has no `(?i)` group. So the pattern is parsed here by Go's grammar.
// The analysis needs two answers from it: does the pattern compile, and does
// it match the text "<nil>" (a field warden never resolves prints as that).
//
// compileGoRegex answers "ok", "invalid" or "unknown". "invalid" is claimed
// only for what Go's parser is known to refuse. "unknown" is returned for the
// few things this port cannot settle (a Unicode script name the JavaScript
// engine does not know), and the analysis then claims nothing.
//
// Not ported, so the fixture ACCEPTS what Go might refuse: the size limits
// (expression too large, nesting depth 1000). Repeat counts are checked,
// including the nested product Go's repeatIsValid limits to 1000.

const GO_CATEGORIES = new Set(
  "C Cc Cf Cn Co Cs L LC Ll Lm Lo Lt Lu M Mc Me Mn N Nd Nl No P Pc Pd Pe Pf Pi Po Ps S Sc Sk Sm So Z Zl Zp Zs".split(" ")
)
const GO_SCRIPTS = new Set(
  ("Adlam Ahom Anatolian_Hieroglyphs Arabic Armenian Avestan Balinese Bamum Bassa_Vah Batak Bengali Bhaiksuki Bopomofo Brahmi Braille " +
    "Buginese Buhid Canadian_Aboriginal Carian Caucasian_Albanian Chakma Cham Cherokee Chorasmian Common Coptic Cuneiform Cypriot " +
    "Cypro_Minoan Cyrillic Deseret Devanagari Dives_Akuru Dogra Duployan Egyptian_Hieroglyphs Elbasan Elymaic Ethiopic Georgian " +
    "Glagolitic Gothic Grantha Greek Gujarati Gunjala_Gondi Gurmukhi Han Hangul Hanifi_Rohingya Hanunoo Hatran Hebrew Hiragana " +
    "Imperial_Aramaic Inherited Inscriptional_Pahlavi Inscriptional_Parthian Javanese Kaithi Kannada Katakana Kawi Kayah_Li " +
    "Kharoshthi Khitan_Small_Script Khmer Khojki Khudawadi Lao Latin Lepcha Limbu Linear_A Linear_B Lisu Lycian Lydian Mahajani " +
    "Makasar Malayalam Mandaic Manichaean Marchen Masaram_Gondi Medefaidrin Meetei_Mayek Mende_Kikakui Meroitic_Cursive " +
    "Meroitic_Hieroglyphs Miao Modi Mongolian Mro Multani Myanmar Nabataean Nag_Mundari Nandinagari New_Tai_Lue Newa Nko Nushu " +
    "Nyiakeng_Puachue_Hmong Ogham Ol_Chiki Old_Hungarian Old_Italic Old_North_Arabian Old_Permic Old_Persian Old_Sogdian " +
    "Old_South_Arabian Old_Turkic Old_Uyghur Oriya Osage Osmanya Pahawh_Hmong Palmyrene Pau_Cin_Hau Phags_Pa Phoenician " +
    "Psalter_Pahlavi Rejang Runic Samaritan Saurashtra Sharada Shavian Siddham SignWriting Sinhala Sogdian Sora_Sompeng Soyombo " +
    "Sundanese Syloti_Nagri Syriac Tagalog Tagbanwa Tai_Le Tai_Tham Tai_Viet Takri Tamil Tangsa Tangut Telugu Thaana Thai Tibetan " +
    "Tifinagh Tirhuta Toto Ugaritic Vai Vithkuqi Wancho Warang_Citi Yezidi Yi Zanabazar_Square").split(" ")
)

class GoRegexInvalid extends Error {}
class GoRegexUnknown extends Error {}

const inRange = (cp, lo, hi) => cp >= lo && cp <= hi
const RE_PERL = {
  d: (cp) => inRange(cp, 0x30, 0x39),
  s: (cp) => cp === 0x20 || inRange(cp, 0x09, 0x0a) || cp === 0x0c || cp === 0x0d,
  w: (cp) => inRange(cp, 0x30, 0x39) || inRange(cp, 0x41, 0x5a) || inRange(cp, 0x61, 0x7a) || cp === 0x5f,
}
const RE_POSIX = {
  alnum: (cp) => inRange(cp, 0x30, 0x39) || inRange(cp, 0x41, 0x5a) || inRange(cp, 0x61, 0x7a),
  alpha: (cp) => inRange(cp, 0x41, 0x5a) || inRange(cp, 0x61, 0x7a),
  ascii: (cp) => cp <= 0x7f,
  blank: (cp) => cp === 0x09 || cp === 0x20,
  cntrl: (cp) => cp <= 0x1f || cp === 0x7f,
  digit: (cp) => inRange(cp, 0x30, 0x39),
  graph: (cp) => inRange(cp, 0x21, 0x7e),
  lower: (cp) => inRange(cp, 0x61, 0x7a),
  print: (cp) => inRange(cp, 0x20, 0x7e),
  punct: (cp) => inRange(cp, 0x21, 0x2f) || inRange(cp, 0x3a, 0x40) || inRange(cp, 0x5b, 0x60) || inRange(cp, 0x7b, 0x7e),
  space: (cp) => cp === 0x20 || inRange(cp, 0x09, 0x0d),
  upper: (cp) => inRange(cp, 0x41, 0x5a),
  word: (cp) => inRange(cp, 0x30, 0x39) || inRange(cp, 0x41, 0x5a) || inRange(cp, 0x61, 0x7a) || cp === 0x5f,
  xdigit: (cp) => inRange(cp, 0x30, 0x39) || inRange(cp, 0x41, 0x46) || inRange(cp, 0x61, 0x66),
}

const isAlnumASCII = (cp) => inRange(cp, 0x30, 0x39) || inRange(cp, 0x41, 0x5a) || inRange(cp, 0x61, 0x7a)
const unhex = (cp) => (inRange(cp, 0x30, 0x39) ? cp - 0x30 : inRange(cp, 0x61, 0x66) ? cp - 0x61 + 10 : inRange(cp, 0x41, 0x46) ? cp - 0x41 + 10 : -1)

// unicode.CategoryAliases, keyed by the canonical form of each name.
const GO_CATEGORY_ALIASES = Object.fromEntries(
  Object.entries({
    Cased_Letter: "LC", Close_Punctuation: "Pe", Combining_Mark: "M", Connector_Punctuation: "Pc", Control: "Cc",
    Currency_Symbol: "Sc", Dash_Punctuation: "Pd", Decimal_Number: "Nd", Enclosing_Mark: "Me", Final_Punctuation: "Pf",
    Format: "Cf", Initial_Punctuation: "Pi", Letter: "L", Letter_Number: "Nl", Line_Separator: "Zl", Lowercase_Letter: "Ll",
    Mark: "M", Math_Symbol: "Sm", Modifier_Letter: "Lm", Modifier_Symbol: "Sk", Nonspacing_Mark: "Mn", Number: "N",
    Open_Punctuation: "Ps", Other: "C", Other_Letter: "Lo", Other_Number: "No", Other_Punctuation: "Po", Other_Symbol: "So",
    Paragraph_Separator: "Zp", Private_Use: "Co", Punctuation: "P", Separator: "Z", Space_Separator: "Zs", Spacing_Mark: "Mc",
    Surrogate: "Cs", Symbol: "S", Titlecase_Letter: "Lt", Unassigned: "Cn", Uppercase_Letter: "Lu",
    cntrl: "Cc", digit: "Nd", punct: "P",
  }).map(([name, actual]) => [canonicalGoName(name), actual])
)

/**
 * canonicalName in regexp/syntax: a leading capital, then lower case, with
 * underscores, spaces and hyphens dropped. Go 1.26 looks a script up by this
 * form against keys that still carry their underscores, so a script such as
 * Old_Italic can never be found: \p{Old_Italic} does not compile.
 */
function canonicalGoName(name) {
  let out = ""
  let first = true
  for (let c of name) {
    if (c === "_" || c === "-" || c === " ") continue
    if (first) {
      if (c >= "a" && c <= "z") c = c.toUpperCase()
      first = false
    } else if (c >= "A" && c <= "Z") {
      c = c.toLowerCase()
    }
    out += c
  }
  return out
}

/** A predicate for \p{Name}, by regexp/syntax's unicodeTable (Go 1.26). */
function goUnicodePredicate(rawName) {
  const name = canonicalGoName(rawName)
  const fromJS = (source) => {
    let re
    try {
      re = new RegExp(source, "u")
    } catch {
      throw new GoRegexUnknown(rawName)
    }
    return (cp) => re.test(String.fromCodePoint(cp))
  }
  if (name === "Any") return () => true
  if (name === "Assigned") return fromJS("^\\P{Cn}$")
  if (name === "Ascii") return (cp) => cp < 0x80
  if (name === "Lc") return fromJS("^\\p{LC}$")
  if (GO_CATEGORIES.has(name)) return fromJS(`^\\p{${name}}$`)
  if (GO_SCRIPTS.has(name)) return fromJS(`^\\p{Script=${name}}$`)
  if (GO_CATEGORY_ALIASES[name]) return fromJS(`^\\p{${GO_CATEGORY_ALIASES[name]}}$`)
  throw new GoRegexInvalid("invalid character class range")
}

/** The characters case folding puts in one class with cp, for the ASCII this fixture ever matches. */
function foldVariants(cp) {
  const ch = String.fromCodePoint(cp)
  const out = new Set([cp, ch.toLowerCase().codePointAt(0), ch.toUpperCase().codePointAt(0)])
  return [...out]
}

function compileGoRegex(pattern) {
  const cps = Array.from(pattern)
  let pos = 0

  const invalid = (why) => {
    throw new GoRegexInvalid(why)
  }
  const peek = (k = 0) => cps[pos + k]
  const is = (ch, k = 0) => cps[pos + k] === ch

  /** parseEscape: one escaped character, as a code point. */
  function parseEscape() {
    pos++ // the backslash
    if (pos >= cps.length) invalid("trailing backslash")
    const c = cps[pos++]
    const cp = c.codePointAt(0)
    if (cp < 0x80 && !isAlnumASCII(cp)) return cp
    const octal = () => pos < cps.length && cps[pos] >= "0" && cps[pos] <= "7"
    if ((c >= "1" && c <= "7" && octal()) || c === "0") {
      let r = cp - 0x30
      for (let i = 1; i < 3 && octal(); i++) r = r * 8 + (cps[pos++].codePointAt(0) - 0x30)
      return r
    }
    if (c === "x") {
      if (pos >= cps.length) invalid("invalid escape")
      let d = cps[pos++]
      if (d === "{") {
        let n = 0
        let r = 0
        for (;;) {
          if (pos >= cps.length) invalid("invalid escape")
          d = cps[pos++]
          if (d === "}") break
          const v = unhex(d.codePointAt(0))
          if (v < 0) invalid("invalid escape")
          r = r * 16 + v
          if (r > 0x10ffff) invalid("invalid escape")
          n++
        }
        if (n === 0) invalid("invalid escape")
        return r
      }
      const x = unhex(d.codePointAt(0))
      if (pos >= cps.length) invalid("invalid escape")
      const y = unhex(cps[pos++].codePointAt(0))
      if (x < 0 || y < 0) invalid("invalid escape")
      return x * 16 + y
    }
    const simple = { a: 7, f: 12, n: 10, r: 13, t: 9, v: 11 }[c]
    if (simple !== undefined) return simple
    return invalid("invalid escape")
  }

  /** \pN, \p{Name}, \P{^Name}: a predicate, or null when this is not one. */
  function parseUnicodeClass() {
    if (!(is("\\") && (is("p", 1) || is("P", 1)))) return null
    let sign = is("P", 1) ? -1 : 1
    pos += 2
    let name
    if (pos < cps.length && cps[pos] === "{") {
      const end = cps.indexOf("}", pos)
      if (end < 0) invalid("invalid character class range")
      name = cps.slice(pos + 1, end).join("")
      pos = end + 1
    } else {
      name = pos < cps.length ? cps[pos++] : ""
    }
    if (name.startsWith("^")) {
      sign = -sign
      name = name.slice(1)
    }
    const pred = goUnicodePredicate(name)
    return sign > 0 ? pred : (cp) => !pred(cp)
  }

  /** \d \D \s \S \w \W as a predicate, or null. */
  function parsePerlClass() {
    if (!is("\\")) return null
    const c = peek(1)
    const base = c && RE_PERL[c.toLowerCase()]
    if (!base || !"dDsSwW".includes(c)) return null
    pos += 2
    return c === c.toLowerCase() ? base : (cp) => !base(cp)
  }

  function parseClass(flags) {
    pos++ // [
    let negate = false
    if (is("^")) {
      negate = true
      pos++
    }
    const items = []
    let first = true
    while (pos >= cps.length || cps[pos] !== "]" || first) {
      first = false
      if (pos < cps.length - 2 && is("[") && is(":", 1)) {
        const rest = cps.slice(pos + 2).join("")
        const end = rest.indexOf(":]")
        if (end >= 0) {
          let name = rest.slice(0, end)
          const neg = name.startsWith("^")
          if (neg) name = name.slice(1)
          const pred = Object.hasOwn(RE_POSIX, name) ? RE_POSIX[name] : null
          if (!pred) invalid("invalid character class range")
          items.push(neg ? (cp) => !pred(cp) : pred)
          pos += 2 + Array.from(rest.slice(0, end + 2)).length
          continue
        }
      }
      const uni = pos < cps.length - 2 ? parseUnicodeClass() : null
      if (uni) {
        items.push(uni)
        continue
      }
      const perl = parsePerlClass()
      if (perl) {
        items.push(perl)
        continue
      }
      const classChar = () => {
        if (pos >= cps.length) invalid("missing closing ]")
        return is("\\") ? parseEscape() : cps[pos++].codePointAt(0)
      }
      const lo = classChar()
      let hi = lo
      if (cps.length - pos >= 2 && is("-") && !is("]", 1)) {
        pos++
        hi = classChar()
        if (hi < lo) invalid("invalid character class range")
      }
      items.push((cp) => cp >= lo && cp <= hi)
    }
    pos++ // ]
    const fold = flags.i
    const raw = (cp) => items.some((f) => f(cp))
    const positive = fold ? (cp) => foldVariants(cp).some(raw) : raw
    return { t: "cls", test: negate ? (cp) => !positive(cp) : positive }
  }

  function repeatIsValid(node, n) {
    let limit = n
    if (node.t === "rep" && node.counted) {
      let m = node.max
      if (m === 0) return true
      if (m < 0) m = node.min
      if (m > limit) return false
      if (m > 0) limit = Math.floor(limit / m)
    }
    return childrenOf(node).every((sub) => repeatIsValid(sub, limit))
  }

  /**
   * The `{n}`, `{n,}` or `{n,m}` at pos, or null when the brace is a literal
   * (no digits, a leading zero, no closing brace). On success pos moves past
   * it. A count too large for Go's parser comes back as min -1, which is
   * refused as an invalid repeat count.
   */
  function parseCounted() {
    let p = pos + 1
    const int = () => {
      if (p >= cps.length || cps[p] < "0" || cps[p] > "9") return undefined
      if (cps[p] === "0" && p + 1 < cps.length && cps[p + 1] >= "0" && cps[p + 1] <= "9") return undefined
      let n = 0
      while (p < cps.length && cps[p] >= "0" && cps[p] <= "9") {
        if (n >= 1e8) n = -1
        if (n >= 0) n = n * 10 + (cps[p].codePointAt(0) - 0x30)
        p++
      }
      return n
    }
    let min = int()
    if (min === undefined) return null
    let max = min
    if (p < cps.length && cps[p] === ",") {
      p++
      if (p < cps.length && cps[p] === "}") max = -1
      else {
        max = int()
        if (max === undefined) return null
        if (max < 0) min = -1
      }
    }
    if (p >= cps.length || cps[p] !== "}") return null
    pos = p + 1
    return { min, max }
  }

  function parseFlagsGroup(flags) {
    // At "(?". Returns { capture: true } for a named capture, { flags, open } otherwise.
    const named = (cps[pos + 2] === "P" && cps[pos + 3] === "<" && cps.length - pos > 4) || (cps[pos + 2] === "<" && cps.length - pos > 3)
    if (named) {
      const end = cps.indexOf(">", pos)
      if (end < 0) invalid("invalid named capture")
      const from = cps[pos + 2] === "P" ? pos + 4 : pos + 3
      const name = cps.slice(from, end).join("")
      if (name === "" || !/^\w+$/.test(name) || /[^\x00-\x7f]/.test(name)) invalid("invalid named capture")
      pos = end + 1
      return { capture: true }
    }
    pos += 2
    const next = { ...flags }
    let sign = 1
    let sawFlag = false
    while (pos < cps.length) {
      const c = cps[pos++]
      if (c === "i" || c === "m" || c === "s" || c === "U") {
        next[c] = sign > 0
        sawFlag = true
      } else if (c === "-") {
        if (sign < 0) invalid("invalid or unsupported Perl syntax")
        sign = -1
        sawFlag = false
      } else if (c === ":" || c === ")") {
        if (sign < 0 && !sawFlag) invalid("invalid or unsupported Perl syntax")
        return { flags: next, open: c === ":" }
      } else {
        invalid("invalid or unsupported Perl syntax")
      }
    }
    return invalid("invalid or unsupported Perl syntax")
  }

  /** One alternation, up to an unconsumed ")" or the end. */
  function parseAlternation(startFlags) {
    let flags = { ...startFlags }
    const alts = []
    let seq = []
    let lastRepeat = false
    while (pos < cps.length && !is(")")) {
      let repeated = false
      const c = cps[pos]
      const counted = c === "{" ? parseCounted() : null
      if (c === "(") {
        if (is("?", 1)) {
          const g = parseFlagsGroup(flags)
          if (g.capture) {
            const inner = parseAlternation(flags)
            if (!is(")")) invalid("missing closing )")
            pos++
            seq.push({ t: "cap", sub: inner })
          } else if (g.open) {
            const inner = parseAlternation(g.flags)
            if (!is(")")) invalid("missing closing )")
            pos++
            seq.push({ t: "cap", sub: inner })
          } else {
            flags = g.flags
          }
        } else {
          pos++
          const inner = parseAlternation(flags)
          if (!is(")")) invalid("missing closing )")
          pos++
          seq.push({ t: "cap", sub: inner })
        }
      } else if (c === "|") {
        pos++
        alts.push({ t: "cat", subs: seq })
        seq = []
      } else if (c === "^") {
        pos++
        seq.push({ t: "bot" })
      } else if (c === "$") {
        pos++
        seq.push({ t: "eot" })
      } else if (c === ".") {
        pos++
        seq.push({ t: "any", nl: flags.s })
      } else if (c === "[") {
        seq.push(parseClass(flags))
      } else if (c === "*" || c === "+" || c === "?" || counted) {
        let min, max
        if (counted) {
          min = counted.min
          max = counted.max
          if (min < 0 || min > 1000 || max > 1000 || (max >= 0 && min > max)) invalid("invalid repeat count")
        } else {
          pos++
          min = c === "+" ? 1 : 0
          max = c === "?" ? 1 : -1
        }
        if (is("?")) pos++ // non-greedy: same set of matches for a yes or no answer
        if (lastRepeat) invalid("invalid nested repetition operator")
        if (seq.length === 0) invalid("missing argument to repetition operator")
        const sub = seq.pop()
        const node = { t: "rep", sub, min, max, counted: Boolean(counted) }
        if (counted && (min >= 2 || max >= 2) && !repeatIsValid(node, 1000)) invalid("invalid repeat count")
        seq.push(node)
        repeated = true
      } else if (c === "\\") {
        const t1 = cps[pos + 1]
        if (t1 === "A") {
          pos += 2
          seq.push({ t: "bot" })
        } else if (t1 === "z") {
          pos += 2
          seq.push({ t: "eot" })
        } else if (t1 === "b" || t1 === "B") {
          pos += 2
          seq.push({ t: t1 === "b" ? "wb" : "nwb" })
        } else if (t1 === "C") {
          invalid("invalid escape")
        } else if (t1 === "Q") {
          pos += 2
          let end = pos
          while (end < cps.length && !(cps[end] === "\\" && cps[end + 1] === "E")) end++
          for (; pos < end; pos++) seq.push({ t: "lit", cp: cps[pos].codePointAt(0), fold: flags.i })
          pos = Math.min(end + 2, cps.length)
        } else {
          const uni = parseUnicodeClass()
          const perl = uni ? null : parsePerlClass()
          const pred = uni ?? perl
          if (pred) {
            seq.push({ t: "cls", test: flags.i ? (cp) => foldVariants(cp).some(pred) : pred })
          } else {
            seq.push({ t: "lit", cp: parseEscape(), fold: flags.i })
          }
        }
      } else {
        pos++
        seq.push({ t: "lit", cp: c.codePointAt(0), fold: flags.i })
      }
      lastRepeat = repeated
    }
    alts.push({ t: "cat", subs: seq })
    return alts.length === 1 ? alts[0] : { t: "alt", subs: alts }
  }

  try {
    const tree = parseAlternation({ i: false, m: false, s: false, U: false })
    if (pos < cps.length) invalid("unexpected )")
    return { status: "ok", tree }
  } catch (err) {
    if (err instanceof GoRegexInvalid) return { status: "invalid" }
    if (err instanceof GoRegexUnknown) return { status: "unknown" }
    throw err
  }
}

function childrenOf(node) {
  if (node.t === "cat" || node.t === "alt") return node.subs
  if (node.t === "rep" || node.t === "cap") return [node.sub]
  return []
}

/**
 * regexp.MatchString over a short text with no newline in it, by backtracking
 * the parsed tree. Backtracking can blow up where Go's engine does not
 * (`(.?){1000}`), so it gives up after a fixed number of steps and returns
 * null, and the analysis then claims nothing.
 */
function goRegexMatches(tree, text) {
  const cps = Array.from(text).map((c) => c.codePointAt(0))
  const word = (i) => i >= 0 && i < cps.length && RE_PERL.w(cps[i])
  let steps = 0
  const giveUp = new Error("regex step budget exhausted")
  const step = (node, i, k) => {
    if (++steps > 200_000) throw giveUp
    switch (node.t) {
      case "lit": {
        if (i >= cps.length) return false
        const c = cps[i]
        const same = c === node.cp || (node.fold && foldVariants(node.cp).includes(c))
        return same && k(i + 1)
      }
      case "any": return i < cps.length && (node.nl || cps[i] !== 10) && k(i + 1)
      case "cls": return i < cps.length && node.test(cps[i]) && k(i + 1)
      case "bot": return i === 0 && k(i)
      case "eot": return i === cps.length && k(i)
      case "wb": return word(i - 1) !== word(i) && k(i)
      case "nwb": return word(i - 1) === word(i) && k(i)
      case "cap": return step(node.sub, i, k)
      case "cat": {
        const run = (j, at) => (j === node.subs.length ? k(at) : step(node.subs[j], at, (next) => run(j + 1, next)))
        return run(0, i)
      }
      case "alt": return node.subs.some((sub) => step(sub, i, k))
      case "rep": {
        const loop = (count, at) => {
          if (count < node.min) return step(node.sub, at, (next) => loop(count + 1, next))
          if (node.max < 0 || count < node.max) {
            const more = step(node.sub, at, (next) => next !== at && loop(count + 1, next))
            if (more) return true
          }
          return k(at)
        }
        return loop(0, i)
      }
    }
    return false
  }
  try {
    for (let start = 0; start <= cps.length; start++) if (step(tree, start, () => true)) return true
    return false
  } catch (err) {
    if (err === giveUp || err instanceof RangeError) return null // out of steps, or out of stack
    throw err
  }
}

// ---- classifyCondition, policyState, analysePolicy -------------------------

const CONDITION_OPERATORS = new Set([
  "eq", "neq", "in", "not_in", "contains", "starts_with", "ends_with", "gt", "lt", "gte", "lte",
  "exists", "not_exists", "ip_in_cidr", "time_after", "time_before", "regex",
])

/**
 * fieldResolves: only subject.<x>, resource.<x>, action.name and context.<x>
 * ever produce a value. An empty suffix on subject, resource and context is
 * an attribute lookup of the name "", so it can vary; "action." cannot.
 */
function fieldResolves(field) {
  const dot = field.indexOf(".")
  if (dot < 0) return false
  const prefix = field.slice(0, dot)
  const suffix = field.slice(dot + 1)
  if (prefix === "subject" || prefix === "resource" || prefix === "context") return true
  return prefix === "action" && suffix === "name"
}

// Fields resolveField returns as a plain string on every request, so the value
// is never nil, even when it is empty. Only exists and not_exists have a fixed
// outcome on them.
const ALWAYS_PRESENT_FIELDS = new Set(["subject.kind", "subject.id", "resource.type", "resource.id", "action.name"])

// The patterns known to match every string. "^.*$" is absent on purpose: the
// dot does not match a newline, so it fails on a value that contains one.
const MATCH_EVERYTHING_REGEX = new Set(["", ".*", "^.*", ".*$"])

/** listOf: a list is the only shape in() accepts; each item prints as fmt.Sprint does. */
function goListOf(v) {
  return Array.isArray(v) ? v.map(goSprint) : null
}

function anyCIDRParses(v) {
  const cidrs = typeof v === "string" ? [v] : goListOf(v)
  return cidrs !== null && cidrs.some(goParseCIDR)
}

/**
 * nilOutcome: what evaluateCondition returns when the field resolved to nil,
 * for the operators whose result then depends only on the stored value.
 * Returns null when a regex the port cannot settle decides it.
 */
function nilOutcome(c, compiled) {
  const actual = "<nil>"
  const expected = goSprint(c.value)
  switch (c.operator) {
    case "eq": return actual === expected
    case "neq": return actual !== expected
    case "in":
    case "not_in": {
      const found = (goListOf(c.value) ?? []).includes(actual)
      return c.operator === "in" ? found : !found
    }
    case "contains": return actual.includes(expected)
    case "starts_with": return actual.startsWith(expected)
    case "ends_with": return actual.endsWith(expected)
    case "not_exists": return true
    case "regex": return compiled.status === "ok" ? goRegexMatches(compiled.tree, actual) : null
  }
  return false
}

/**
 * classifyCondition: whether a condition's outcome is fixed, and why. Returns
 * { problem, reason }, both "" when the outcome depends on the check.
 *
 * Conservative where JavaScript cannot match Go: a regex whose compilation
 * this port cannot settle claims nothing (see compileGoRegex).
 */
function classifyCondition(c) {
  const none = { problem: "", reason: "" }
  if (!CONDITION_OPERATORS.has(c.operator)) return { problem: "throws", reason: "unknownOperator" }
  let compiled = null
  if (c.operator === "regex") {
    compiled = compileGoRegex(goSprint(c.value))
    if (compiled.status === "invalid") return { problem: "throws", reason: "invalidRegex" }
  }
  if (!fieldResolves(c.field)) {
    const outcome = nilOutcome(c, compiled)
    if (outcome === null) return none
    return { problem: outcome ? "alwaysTrue" : "alwaysFalse", reason: "unresolvableField" }
  }
  if (c.operator === "contains" || c.operator === "starts_with" || c.operator === "ends_with") {
    if (goSprint(c.value) === "") return { problem: "alwaysTrue", reason: "matchesAnything" }
  } else if (c.operator === "regex") {
    if (MATCH_EVERYTHING_REGEX.has(goSprint(c.value))) return { problem: "alwaysTrue", reason: "matchesAnything" }
  }
  if (ALWAYS_PRESENT_FIELDS.has(c.field)) {
    if (c.operator === "exists") return { problem: "alwaysTrue", reason: "alwaysPresent" }
    if (c.operator === "not_exists") return { problem: "alwaysFalse", reason: "alwaysPresent" }
  }
  switch (c.operator) {
    case "in":
    case "not_in": {
      const items = goListOf(c.value)
      let reason = "notAList"
      if (items !== null) {
        if (items.length > 0) return none
        reason = "emptyList"
      }
      return { problem: c.operator === "in" ? "alwaysFalse" : "alwaysTrue", reason }
    }
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const n = goAsNumber(c.value)
      if (n === null) return { problem: "alwaysFalse", reason: "notANumber" }
      // gt and lt against NaN are false for every actual. gte and lte are TRUE
      // for a numeric actual (the comparator gives (0, true) for NaN), and
      // infinities hold for every finite actual, so those are left unclassified.
      if (Number.isNaN(n) && (c.operator === "gt" || c.operator === "lt")) return { problem: "alwaysFalse", reason: "notANumber" }
      break
    }
    case "ip_in_cidr":
      if (!anyCIDRParses(c.value)) return { problem: "alwaysFalse", reason: "noValidCIDR" }
      break
    case "time_after":
    case "time_before":
      if (typeof c.value !== "string" || parseGoTime(c.value) === null) return { problem: "alwaysFalse", reason: "notATime" }
      break
  }
  return none
}

/** policyState, as of nowNs (BigInt nanoseconds). Instants compare exactly. */
function policyState(p, nowNs) {
  if (!p.isActive) return "inactive"
  if (p.notBefore !== null && p.notAfter !== null && p.notAfter < p.notBefore) return "never"
  if (p.notBefore !== null && nowNs < p.notBefore) return "scheduled"
  if (p.notAfter !== null && nowNs > p.notAfter) return "expired"
  return "active"
}

function matchesEveryValue(pattern) {
  return pattern === "*" || pattern === "*:*" || pattern === "*.*"
}

/**
 * analysePolicy: everything the pages show about a policy that the stored
 * fields do not say. The first condition with a fixed false or a throw decides,
 * because evaluation stops there, and a condition that merely depends on the
 * check cannot rescue a later one.
 */
function analysePolicy(p, nowNs) {
  const a = {
    state: policyState(p, nowNs),
    failsClosed: false,
    neverApplies: false,
    decidingCondition: -1,
    problems: [],
    reasons: [],
    subjectsUnrestricted: p.subjects.length === 0,
    actionsUnrestricted: false,
    resourcesUnrestricted: false,
    matchesEverything: false,
    hasRoleMatcher: false,
  }
  for (const c of p.conditions) {
    const { problem, reason } = classifyCondition(c)
    a.problems.push(problem)
    a.reasons.push(reason)
  }
  for (let i = 0; i < a.problems.length; i++) {
    if (a.problems[i] === "throws") {
      a.decidingCondition = i
      if (p.effect === "allow") a.neverApplies = true
      else a.failsClosed = true // anything but exactly "allow" is a deny
      break
    }
    if (a.problems[i] === "alwaysFalse") {
      a.decidingCondition = i
      a.neverApplies = true
      break
    }
  }
  for (const s of p.subjects) {
    if (s.kind === "" && s.id === "" && s.role === "") a.subjectsUnrestricted = true
    if (s.role !== "") a.hasRoleMatcher = true
  }
  a.actionsUnrestricted = p.actions.length === 0 || p.actions.some(matchesEveryValue)
  a.resourcesUnrestricted = p.resources.length === 0 || p.resources.some(matchesEveryValue)
  a.matchesEverything = a.subjectsUnrestricted && a.actionsUnrestricted && a.resourcesUnrestricted
  return a
}

// ---- write-time validation -------------------------------------------------

const POLICY_SUBJECT_KINDS = SUBJECT_KINDS // warden's closed set, declared with the assignments
const MAX_EXACT_INTEGER = 2 ** 53
const WINDOW_START_NOT_A_TIME = "The start is not an RFC3339 time."
const WINDOW_END_NOT_A_TIME = "The end is not an RFC3339 time."
const WINDOW_END_NOT_AFTER = "The end must be after the start."

/** storedCondition: the one place a wire condition becomes a stored one; the field is trimmed here, once. */
function storedCondition(c) {
  return { field: goTrimSpace(c.field), operator: c.operator, value: c.value }
}

/** storedSubject: trimmed once, so a subject of only whitespace is refused, never stored as the empty matcher. */
function storedSubject(s) {
  return { kind: goTrimSpace(s.kind), id: goTrimSpace(s.id), role: goTrimSpace(s.role) }
}

const trimmedList = (list) => list.map(goTrimSpace)
const hasEmptyEntry = (list) => list.some((v) => goTrimSpace(v) === "")

const isComparison = (op) => op === "gt" || op === "lt" || op === "gte" || op === "lte"

function nonFinite(v) {
  const n = goAsNumber(v)
  return n !== null && !Number.isFinite(n)
}

function largestMagnitude(v) {
  if (Array.isArray(v)) {
    let best = 0
    let found = false
    for (const item of v) {
      const n = largestMagnitude(item)
      if (n !== null) {
        found = true
        best = Math.max(best, n)
      }
    }
    return found ? best : null
  }
  return typeof v === "number" ? Math.abs(v) : null
}

/** conditionIssue: why one condition cannot be saved, or "". The messages are Go's, word for word. */
function conditionIssue(c) {
  const pc = storedCondition(c)
  // classifyCondition first: its messages say what the condition would DO.
  const { problem, reason } = classifyCondition(pc)
  if (reason === "unknownOperator") return `${goQuote(c.operator)} is not an operator warden knows, so this condition would fail every check.`
  if (reason === "invalidRegex") return "This pattern does not compile, so this condition would fail every check."
  if (reason === "unresolvableField") {
    return `Warden never gives ${goQuote(pc.field)} a value, so this condition would always be ${problem === "alwaysTrue"}. Use subject., resource., context., or action.name.`
  }
  if (reason === "alwaysPresent") {
    return `Warden always gives ${goQuote(pc.field)} a value, even an empty one, so this condition would always be ${problem === "alwaysTrue"}.`
  }
  if (reason === "matchesAnything") return "This matches every value, so this condition is always true and restricts nothing."
  if (isComparison(pc.operator) && nonFinite(pc.value)) return "The value is not a finite number."
  if (reason === "notAList") return "This operator needs a list of values."
  if (reason === "emptyList" && problem === "alwaysFalse") return "The list is empty, so this condition is never met and the policy never applies."
  if (reason === "emptyList") return "The list is empty, so this condition restricts nothing."
  if (reason === "notANumber") return "This operator compares numbers, and the value is not one."
  if (reason === "noValidCIDR") return "None of these parse as a network like 10.0.0.0/8."
  if (reason === "notATime") return "The value must be an RFC3339 time, like 2026-06-01T09:00:00Z."
  // policy.ValidateCondition. Its operator, field, time and empty-list checks
  // cannot fail here (the classification above caught them), so what is left
  // is the 512 byte regex cap and a CIDR list with some bad entries.
  if (pc.operator === "regex" && Buffer.byteLength(goSprint(pc.value)) > 512) return "regex condition pattern exceeds 512 characters"
  if (pc.operator === "ip_in_cidr") {
    const cidrs = typeof pc.value === "string" ? [pc.value] : goListOf(pc.value)
    const bad = cidrs.find((x) => !goParseCIDR(x))
    if (bad !== undefined) return `invalid CIDR ${goQuote(bad)}: invalid CIDR address: ${bad}`
  }
  const n = largestMagnitude(c.value)
  if (n !== null && n > MAX_EXACT_INTEGER) {
    if (isComparison(pc.operator)) {
      return "Numbers above 9007199254740992 lose precision when stored, and a comparison reads a string as a number too, so use a smaller number."
    }
    return "Numbers above 9007199254740992 lose precision when stored. Store it as a string instead."
  }
  return ""
}

/** windowOrderIssue: an end at or before the start is refused; an absent bound is no bound. */
function windowOrderIssue(nb, na) {
  return nb !== null && na !== null && !(na > nb) ? WINDOW_END_NOT_AFTER : ""
}

function windowIssue(notBefore, notAfter) {
  let nb = null
  let na = null
  if (notBefore !== "") {
    nb = parseGoTime(notBefore)
    if (nb === null) return WINDOW_START_NOT_A_TIME
  }
  if (notAfter !== "") {
    na = parseGoTime(notAfter)
    if (na === null) return WINDOW_END_NOT_A_TIME
  }
  return windowOrderIssue(nb, na)
}

const ALL_PARTS = { name: true, effect: true, window: true, subjects: true, actions: true, resources: true, conditions: true, obligations: true }

/**
 * collectPolicyIssues: every reason a draft cannot be saved. An update
 * validates only the parts it changes, so a policy stored with a bad condition
 * before this validation existed can still have its description edited.
 */
function collectPolicyIssues(d, parts) {
  const issues = { fields: {}, conditions: [] }
  if (parts.name && goTrimSpace(d.name) === "") issues.fields.name = "A policy needs a name."
  if (parts.effect && d.effect !== "allow" && d.effect !== "deny") issues.fields.effect = 'Effect must be "allow" or "deny".'
  if (parts.window) {
    const msg = windowIssue(d.notBefore, d.notAfter)
    if (msg) issues.fields.window = msg
  }
  if (parts.subjects) {
    for (const raw of d.subjects) {
      const s = storedSubject(raw)
      if (s.kind === "" && s.id === "" && s.role === "") {
        issues.fields.subjects = "An empty subject matcher matches everyone. To mean everyone, remove every subject instead."
        break
      }
      if (s.kind !== "" && !POLICY_SUBJECT_KINDS.has(s.kind)) {
        issues.fields.subjects = `Subject kind ${goQuote(s.kind)} is not one warden checks. Use user, api_key, service or service_acct.`
        break
      }
    }
  }
  if (parts.actions && hasEmptyEntry(d.actions)) issues.fields.actions = "An entry is empty."
  if (parts.resources && hasEmptyEntry(d.resources)) issues.fields.resources = "An entry is empty."
  if (parts.obligations && hasEmptyEntry(d.obligations)) issues.fields.obligations = "An entry is empty."
  if (parts.conditions) {
    d.conditions.forEach((c, index) => {
      const message = conditionIssue(c)
      if (message) issues.conditions.push({ index, message })
    })
  }
  return issues
}

/** issuesError: the BAD_REQUEST a page renders row by row. */
function issuesError(issues) {
  const fields = Object.keys(issues.fields).length
  if (fields === 0 && issues.conditions.length === 0) return null
  return new WardenFixtureError(
    400,
    "BAD_REQUEST",
    `This policy cannot be saved: ${issues.conditions.length} condition(s) and ${fields} field(s) need fixing.`,
    { fields: issues.fields, conditions: issues.conditions }
  )
}

/**
 * toPolicyConditions: every condition gets a fresh id, except that a sent id
 * is kept when it belongs to one of the policy's currently stored conditions
 * and this is its first appearance in the new set. A create passes none.
 */
function toPolicyConditions(input, stored) {
  const owned = new Set(stored.map((c) => c.id))
  const used = new Set()
  return input.map((c) => {
    let id = newId("cond")
    if (typeof c.id === "string" && owned.has(c.id) && !used.has(c.id)) {
      id = c.id
      used.add(c.id)
    }
    return { id, ...storedCondition(c), value: structuredClone(c.value) }
  })
}

// ---- decoding a request the way encoding/json would ------------------------

function jsonKind(v) {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  if (typeof v === "boolean") return "bool"
  return typeof v
}

function decodeFail(struct, field, v, goType) {
  const what = typeof v === "number" && goType === "int" ? `number ${v}` : jsonKind(v)
  return badRequest(`json: cannot unmarshal ${what} into Go struct field ${struct}.${field} of type ${goType}`)
}

/** null and absent both decode to the zero value. */
function decodeString(v, struct, field) {
  if (v === undefined || v === null) return ""
  if (typeof v !== "string") throw decodeFail(struct, field, v, "string")
  return v
}

function decodeInt(v, struct, field) {
  if (v === undefined || v === null) return 0
  if (typeof v !== "number" || !Number.isInteger(v)) throw decodeFail(struct, field, v, "int")
  return v
}

function decodeStrings(v, struct, field) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw decodeFail(struct, field, v, "[]string")
  return v.map((x) => decodeString(x, struct, field))
}

function decodeSubjects(v, struct, field) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw decodeFail(struct, field, v, "[]contract.PolicySubject")
  return v.map((s) => {
    if (s === null || s === undefined) return { kind: "", id: "", role: "" }
    if (typeof s !== "object" || Array.isArray(s)) throw decodeFail(struct, field, s, "contract.PolicySubject")
    return {
      kind: decodeString(s.kind, struct, field + ".kind"),
      id: decodeString(s.id, struct, field + ".id"),
      role: decodeString(s.role, struct, field + ".role"),
    }
  })
}

function decodeConditions(v, struct, field) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw decodeFail(struct, field, v, "[]contract.PolicyCondition")
  return v.map((c) => {
    if (c === null || c === undefined) return { id: "", field: "", operator: "", value: undefined }
    if (typeof c !== "object" || Array.isArray(c)) throw decodeFail(struct, field, c, "contract.PolicyCondition")
    return {
      id: decodeString(c.id, struct, field + ".id"),
      field: decodeString(c.field, struct, field + ".field"),
      operator: decodeString(c.operator, struct, field + ".operator"),
      value: c.value === null ? undefined : c.value,
    }
  })
}

/** PolicyDraft, as policies.validate and policies.create decode it. */
function decodeDraft(p, struct) {
  return {
    name: decodeString(p?.name, struct, "name"),
    description: decodeString(p?.description, struct, "description"),
    effect: decodeString(p?.effect, struct, "effect"),
    priority: decodeInt(p?.priority, struct, "priority"),
    notBefore: decodeString(p?.notBefore, struct, "notBefore"),
    notAfter: decodeString(p?.notAfter, struct, "notAfter"),
    subjects: decodeSubjects(p?.subjects, struct, "subjects"),
    actions: decodeStrings(p?.actions, struct, "actions"),
    resources: decodeStrings(p?.resources, struct, "resources"),
    conditions: decodeConditions(p?.conditions, struct, "conditions"),
    obligations: decodeStrings(p?.obligations, struct, "obligations"),
  }
}

/** PolicyUpdateInput: pointers, so null and absent are both "leave alone". */
function decodePatch(p) {
  const present = (v) => v !== undefined && v !== null
  const S = "PolicyUpdateInput"
  return {
    id: decodeString(p?.id, S, "id"),
    name: present(p?.name) ? decodeString(p.name, S, "name") : undefined,
    description: present(p?.description) ? decodeString(p.description, S, "description") : undefined,
    effect: present(p?.effect) ? decodeString(p.effect, S, "effect") : undefined,
    priority: present(p?.priority) ? decodeInt(p.priority, S, "priority") : undefined,
    notBefore: present(p?.notBefore) ? decodeString(p.notBefore, S, "notBefore") : undefined,
    notAfter: present(p?.notAfter) ? decodeString(p.notAfter, S, "notAfter") : undefined,
    subjects: present(p?.subjects) ? decodeSubjects(p.subjects, S, "subjects") : undefined,
    actions: present(p?.actions) ? decodeStrings(p.actions, S, "actions") : undefined,
    resources: present(p?.resources) ? decodeStrings(p.resources, S, "resources") : undefined,
    conditions: present(p?.conditions) ? decodeConditions(p.conditions, S, "conditions") : undefined,
    obligations: present(p?.obligations) ? decodeStrings(p.obligations, S, "obligations") : undefined,
  }
}

// ---- policy rows -----------------------------------------------------------

// The tenant the Go contract resolves from the principal. Only the store's
// duplicate-name message names it.
const WARDEN_TENANT = "tenant_fixture"

// The order warden's stores list policies in, which is also evaluation order:
// priority, then age, then id.
const compareByPriority = (a, b) =>
  a.priority - b.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function policyNotFound(rawId) {
  return new WardenFixtureError(404, "NOT_FOUND", `policy ${rawId}: warden: policy not found: warden: not found`)
}

function policyDuplicate(name, namespacePath) {
  return new WardenFixtureError(
    409,
    "CONFLICT",
    `policy ${goQuote(name)} in tenant ${goQuote(WARDEN_TENANT)} ns ${goQuote(namespacePath)}: warden: policy already exists in this scope: warden: already exists`
  )
}

function renameDuplicate(name, namespacePath) {
  return new WardenFixtureError(
    409,
    "CONFLICT",
    `policy ${goQuote(name)} in ns ${goQuote(namespacePath)}: warden: policy already exists in this scope: warden: already exists`
  )
}

/** projectPolicySummary: the list row, analysed as of now. Omitempty fields are absent. */
function policySummaryOf(p, a) {
  const out = { id: p.id, namespacePath: p.namespacePath, name: p.name }
  if (p.description) out.description = p.description
  out.effect = p.effect
  out.priority = p.priority
  out.isActive = p.isActive
  out.state = a.state
  out.failsClosed = a.failsClosed
  out.neverApplies = a.neverApplies
  out.matchesEverything = a.matchesEverything
  out.version = p.version
  out.updatedAt = rfc3339(p.updatedAt)
  return out
}

/** projectPolicyDetail: every slice is an array, never null, so a page never guards against it. */
function projectPolicyDetail(p, nowNs) {
  const a = analysePolicy(p, nowNs)
  const out = {
    ...policySummaryOf(p, a),
    subjects: p.subjects.map((s) => {
      const subject = {}
      if (s.kind) subject.kind = s.kind
      if (s.id) subject.id = s.id
      if (s.role) subject.role = s.role
      return subject
    }),
    actions: [...p.actions],
    resources: [...p.resources],
    conditions: p.conditions.map((c, i) => {
      const view = { id: c.id, field: c.field, operator: c.operator }
      if (c.value !== undefined && c.value !== null) view.value = structuredClone(c.value)
      if (a.problems[i]) view.problem = a.problems[i]
      if (a.reasons[i]) view.reason = a.reasons[i]
      return view
    }),
    obligations: [...p.obligations],
  }
  if (p.notBefore !== null) out.notBefore = formatGoTime(p.notBefore)
  if (p.notAfter !== null) out.notAfter = formatGoTime(p.notAfter)
  out.subjectsUnrestricted = a.subjectsUnrestricted
  out.actionsUnrestricted = a.actionsUnrestricted
  out.resourcesUnrestricted = a.resourcesUnrestricted
  out.hasRoleMatcher = a.hasRoleMatcher
  if (a.decidingCondition >= 0) out.decidingCondition = a.decidingCondition
  if (p.createdBy) out.createdBy = p.createdBy
  if (p.updatedBy) out.updatedBy = p.updatedBy
  out.createdAt = rfc3339(p.createdAt)
  return out
}

const nowNs = () => BigInt(Date.now()) * 1_000_000n

// Go stamps a create with nanoseconds, so two policies made back to back never
// share a creation time and the list keeps them in the order they were made.
// Milliseconds would tie, and the id tie-break is random, so each create here
// is stamped at least a millisecond after the last.
let lastPolicyCreateMs = 0
function nextPolicyCreatedAt() {
  lastPolicyCreateMs = Math.max(Date.now(), lastPolicyCreateMs + 1)
  return new Date(lastPolicyCreateMs).toISOString()
}

/**
 * mergedWindow: the window after the patch, as exact instants. A bound the
 * patch does not name is the stored one itself, never a formatted copy. An
 * empty string clears a bound. msg is why the pair cannot be saved, or "".
 */
function mergedWindow(before, patch) {
  let nb = before.notBefore
  let na = before.notAfter
  const bound = (raw, current, notATime) => {
    if (raw === undefined) return { value: current, msg: "" }
    if (raw === "") return { value: null, msg: "" }
    const t = parseGoTime(raw)
    return t === null ? { value: current, msg: notATime } : { value: t, msg: "" }
  }
  let r = bound(patch.notBefore, nb, WINDOW_START_NOT_A_TIME)
  nb = r.value
  if (r.msg) return { nb, na, msg: r.msg }
  r = bound(patch.notAfter, na, WINDOW_END_NOT_A_TIME)
  na = r.value
  if (r.msg) return { nb, na, msg: r.msg }
  return { nb, na, msg: windowOrderIssue(nb, na) }
}

/** draftAndParts: a patch as the draft collectPolicyIssues judges. The window is judged by mergedWindow. */
function draftAndParts(patch) {
  const d = { name: "", effect: "", notBefore: "", notAfter: "", subjects: [], actions: [], resources: [], conditions: [], obligations: [] }
  const parts = { name: false, effect: false, window: false, subjects: false, actions: false, resources: false, conditions: false, obligations: false }
  for (const key of ["name", "effect", "subjects", "actions", "resources", "conditions", "obligations"]) {
    if (patch[key] !== undefined) {
      d[key] = patch[key]
      parts[key] = true
    }
  }
  return { d, parts }
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

  // -------------------------------------------------------------------------
  // Policies
  //
  // Reads carry what analysePolicy says a policy will DO (state, failsClosed,
  // neverApplies, matchesEverything, and per condition a problem and reason),
  // computed at read time and never stored. Writes are validated by
  // collectPolicyIssues, and a create is always stored INACTIVE: a new policy
  // with no matchers matches every check in its namespace and below.
  // Activation is an explicit policies.setActive.
  //
  // Refusals here carry `details` ({ fields, conditions } for a rejected
  // draft) on the thrown error, but that does not reach the browser until
  // server.mjs registers warden through a FixtureError factory: see the note
  // on WardenFixtureError.
  // -------------------------------------------------------------------------

  "policies.list": {
    kind: "query",
    handler: (params) => {
      const S = "PoliciesListInput"
      if (params?.effect !== undefined && params.effect !== null) decodeString(params.effect, S, "effect")
      if (params?.search !== undefined && params.search !== null) decodeString(params.search, S, "search")
      if (params?.isActive !== undefined && params.isActive !== null && typeof params.isActive !== "boolean") {
        throw decodeFail(S, "isActive", params.isActive, "bool")
      }
      if (params?.namespacePath !== undefined && params.namespacePath !== null) decodeString(params.namespacePath, S, "namespacePath")
      let rows = byNamespace(warden.policies, params)
      if (params?.effect) rows = rows.filter((p) => p.effect === params.effect)
      if (typeof params?.isActive === "boolean") rows = rows.filter((p) => p.isActive === params.isActive)
      if (params?.search) {
        // strings.ToLower on both sides, over the name only.
        const needle = String(params.search).toLowerCase()
        rows = rows.filter((p) => p.name.toLowerCase().includes(needle))
      }
      const now = nowNs()
      const page = pageOf([...rows].sort(compareByPriority), params)
      return { ...page, items: page.items.map((p) => policySummaryOf(p, analysePolicy(p, now))) }
    },
  },
  "policies.detail": {
    kind: "query",
    handler: (params) => {
      const raw = decodeString(params?.id, "PolicyDetailInput", "id")
      requireId("wpol", "policy", raw)
      const p = warden.policies.find((x) => x.id === raw)
      if (!p) throw policyNotFound(raw)
      return projectPolicyDetail(p, nowNs())
    },
  },
  // A query because it writes nothing: it reports what a create would refuse,
  // so a form can show every problem before anything is sent.
  "policies.validate": {
    kind: "query",
    handler: (params) => {
      const issues = collectPolicyIssues(decodeDraft(params, "PolicyDraft"), ALL_PARTS)
      return { valid: issuesError(issues) === null, fields: issues.fields, conditions: issues.conditions }
    },
  },
  "policies.create": {
    kind: "command",
    invalidates: ["policies.list", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      const draft = decodeDraft(payload, "PolicyCreateInput")
      const namespacePath = decodeString(payload?.namespacePath, "PolicyCreateInput", "namespacePath")
      validateNamespace(namespacePath)
      const refused = issuesError(collectPolicyIssues(draft, ALL_PARTS))
      if (refused) throw refused
      const name = goTrimSpace(draft.name)
      if (warden.policies.some((x) => x.namespacePath === namespacePath && x.name === name)) {
        throw policyDuplicate(name, namespacePath)
      }
      const now = nextPolicyCreatedAt()
      const row = {
        id: newId("wpol"),
        namespacePath,
        name,
        description: draft.description,
        effect: draft.effect,
        priority: draft.priority,
        // Always inactive, whatever the input says. There is no isActive on the input.
        isActive: false,
        notBefore: draft.notBefore === "" ? null : parseGoTime(draft.notBefore),
        notAfter: draft.notAfter === "" ? null : parseGoTime(draft.notAfter),
        version: 1,
        subjects: draft.subjects.map(storedSubject),
        actions: trimmedList(draft.actions),
        resources: trimmedList(draft.resources),
        conditions: toPolicyConditions(draft.conditions, []),
        obligations: trimmedList(draft.obligations),
        createdBy: WARDEN_ACTOR,
        updatedBy: WARDEN_ACTOR,
        createdAt: now,
        updatedAt: now,
      }
      warden.policies.push(row)
      return { id: row.id }
    },
  },
  "policies.update": {
    kind: "command",
    invalidates: ["policies.list", "policies.detail"],
    handler: (payload) => {
      const patch = decodePatch(payload)
      requireId("wpol", "policy", patch.id)
      const i = warden.policies.findIndex((x) => x.id === patch.id)
      if (i === -1) throw policyNotFound(patch.id)
      const before = warden.policies[i]
      // Only what the patch changes is validated, so a policy stored with a bad
      // condition before this validation existed can still have its
      // description edited. The window is judged as the merged pair, so a new
      // start after the stored end is refused.
      const { d, parts } = draftAndParts(patch)
      const issues = collectPolicyIssues(d, parts)
      const windowPatched = patch.notBefore !== undefined || patch.notAfter !== undefined
      const merged = mergedWindow(before, patch)
      if (windowPatched && merged.msg) issues.fields.window = merged.msg
      const refused = issuesError(issues)
      if (refused) throw refused

      // Read, patch the present fields on a copy, write. Every patched list is
      // replaced rather than edited.
      const next = { ...before }
      if (patch.name !== undefined) next.name = goTrimSpace(patch.name)
      if (patch.description !== undefined) next.description = patch.description
      if (patch.effect !== undefined) next.effect = patch.effect
      if (patch.priority !== undefined) next.priority = patch.priority
      if (windowPatched) {
        next.notBefore = merged.nb
        next.notAfter = merged.na
      }
      if (patch.subjects !== undefined) next.subjects = patch.subjects.map(storedSubject)
      if (patch.actions !== undefined) next.actions = trimmedList(patch.actions)
      if (patch.resources !== undefined) next.resources = trimmedList(patch.resources)
      if (patch.conditions !== undefined) next.conditions = toPolicyConditions(patch.conditions, before.conditions)
      if (patch.obligations !== undefined) next.obligations = trimmedList(patch.obligations)

      // A rename onto a name already in this namespace. Renaming a policy to
      // its own name is not a conflict.
      if (patch.name !== undefined && next.name !== before.name) {
        if (warden.policies.some((x) => x.namespacePath === before.namespacePath && x.name === next.name)) {
          throw renameDuplicate(next.name, before.namespacePath)
        }
      }
      next.updatedBy = WARDEN_ACTOR
      next.version = before.version + 1
      next.updatedAt = new Date().toISOString()
      warden.policies[i] = next
      return {}
    },
  },
  "policies.setActive": {
    kind: "command",
    invalidates: ["policies.list", "policies.detail"],
    handler: (payload) => {
      const S = "PolicySetActiveInput"
      const raw = decodeString(payload?.id, S, "id")
      const active = payload?.active === undefined || payload.active === null ? false : payload.active
      if (typeof active !== "boolean") throw decodeFail(S, "active", active, "bool")
      requireId("wpol", "policy", raw)
      const i = warden.policies.findIndex((x) => x.id === raw)
      if (i === -1) throw policyNotFound(raw)
      const before = warden.policies[i]
      warden.policies[i] = {
        ...before,
        isActive: active,
        updatedBy: WARDEN_ACTOR,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
      }
      return {}
    },
  },
  "policies.delete": {
    kind: "command",
    invalidates: ["policies.list", "policies.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      const raw = decodeString(payload?.id, "PolicyDeleteInput", "id")
      requireId("wpol", "policy", raw)
      const i = warden.policies.findIndex((x) => x.id === raw)
      if (i === -1) throw policyNotFound(raw)
      warden.policies.splice(i, 1)
      return {}
    },
  },
}
