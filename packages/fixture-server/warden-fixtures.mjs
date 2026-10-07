// warden-fixtures.mjs: in-memory state and intent handlers for the warden
// contributor, kept out of server.mjs on purpose (see the commit message).
//
// This module is self-contained, matching core-fixtures.mjs: it does not
// import anything from server.mjs. A half-specified maintenance.cacheInvalidate
// call is rejected with a plain Error, which server.mjs's generic catch
// already maps to 400/BAD_REQUEST with the thrown message, the same result
// server.mjs's own badRequest() helper would produce. That keeps this file
// free of a circular import back into server.mjs.

import { createHash } from "node:crypto"

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

  const checkLogs = seedCheckLogs()

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
      // The role contractor-lockout's subject matcher names, and one that
      // grants document:delete. That is what lets the policy playground show
      // an explicit deny overriding an RBAC allow: dave's role allows the
      // delete and the lockout policy refuses it.
      { id: "role_01hv", namespacePath: "", name: "Contractor", slug: "contractor", isSystem: false, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      // The roles staff-read-documents and after-hours-approval name as their
      // subject matchers. Neither grants a permission: they exist so the two
      // policies can apply to someone, and an ABAC allow in the check log
      // belongs to a subject who holds the role the policy asks for.
      { id: "role_01hw", namespacePath: "", name: "Staff", slug: "staff", isSystem: false, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "role_01hy", namespacePath: "", name: "On-call", slug: "oncall", isSystem: false, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
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
      { id: "perm_01d", namespacePath: "", name: "document:delete", resource: "document", action: "delete", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    // The role-permission junction, keyed by natural key exactly as the
    // store keys it: (roleId, namespacePath, name).
    grants: [
      { roleId: "role_01hq", namespacePath: "", name: "document:read" },
      { roleId: "role_01hr", namespacePath: "eng/platform", name: "cluster:admin" },
      { roleId: "role_01hv", namespacePath: "", name: "document:delete" },
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
      // Dave is the contractor the contractor-lockout policy is about.
      { id: "asgn_01h", namespacePath: "", roleId: "role_01hv", subjectKind: "user", subjectId: "dave", expiresAt: null, createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      // Erin is staff and frank is on call, the roles the policies that allow
      // them in the check log ask for.
      { id: "asgn_01i", namespacePath: "", roleId: "role_01hw", subjectKind: "user", subjectId: "erin", expiresAt: null, createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      { id: "asgn_01j", namespacePath: "", roleId: "role_01hy", subjectKind: "user", subjectId: "frank", expiresAt: null, createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
      // Bob's lapsed Reader grant, so one subject holds an expired row (this)
      // and an expiring one (asgn_01c) and the subject view shows both flags
      // side by side. It changes no check: an expired row grants nothing, and
      // bob's check log rows never relied on Reader.
      { id: "asgn_01k", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "bob", expiresAt: new Date(Date.now() - 1800_000).toISOString(), createdAt: hourAgo, grantedBy: WARDEN_ACTOR },
    ],
    // Tuples in two namespaces. Two chains a person can trace, one the engine
    // walks and one it does not. Walked: document:readme#editor names the
    // userset group:eng#member (rel_01c), and erin is a member of it (rel_01f),
    // so erin edits readme transitively. Not walked: rel_01b makes readme the
    // parent of folder:root, but a tuple with no subject relation names one
    // concrete subject, so the walker stops there; read that pair by eye.
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
      // The last hop of a walk the graph walker really follows: document
      // readme's editors include the userset group:eng#member (rel_01c), and
      // erin is a member of group:eng. The walker only descends through a
      // userset subject, so this is the tuple that makes a transitive allow
      // reachable at all.
      { id: "rel_01f", namespacePath: "", objectType: "group", objectId: "eng", relation: "member", subjectType: "user", subjectId: "erin", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      // THE USERSET CHAIN relations.expand is read against, rooted at
      // document:readme#editor. With rel_01c and rel_01f above it runs four
      // subject sets deep (the root counts as the first, depth 0):
      //
      //   document:readme#editor            depth 0, one tuple   (rel_01c)
      //     group:eng#member                depth 1, two tuples  (rel_01f, rel_01g)
      //       user:erin                     depth 2, a single subject
      //       group:platform#member         depth 2, two tuples  (rel_01h, rel_01i)
      //         group:oncall#member         depth 3, one tuple   (rel_01j)
      //           user:frank                depth 4, a single subject
      //         user:dana                   depth 3, a single subject
      //
      // The graph walker would follow it, and the three limits in
      // warden.config below each stop it at a different place: see the table
      // on the graph section (search "THE STOP STATES"). The ids ascend in the
      // order each hop lists its tuples, because every seeded row shares one
      // createdAt and the store breaks that tie by id.
      { id: "rel_01g", namespacePath: "", objectType: "group", objectId: "eng", relation: "member", subjectType: "group", subjectId: "platform", subjectRelation: "member", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      { id: "rel_01h", namespacePath: "", objectType: "group", objectId: "platform", relation: "member", subjectType: "group", subjectId: "oncall", subjectRelation: "member", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      { id: "rel_01i", namespacePath: "", objectType: "group", objectId: "platform", relation: "member", subjectType: "user", subjectId: "dana", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      { id: "rel_01j", namespacePath: "", objectType: "group", objectId: "oncall", relation: "member", subjectType: "user", subjectId: "frank", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
      // The one tuple of the chain stored below the root. An expansion at the
      // root does not see it. One at eng/platform does, because tuples cascade
      // down from every ancestor namespace: it adds user:bob under
      // group:platform#member, which makes that hop three tuples there and
      // two at the root.
      { id: "rel_01k", namespacePath: "eng/platform", objectType: "group", objectId: "platform", relation: "member", subjectType: "user", subjectId: "bob", subjectRelation: "", createdBy: WARDEN_ACTOR, createdAt: hourAgo },
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
      // The type the chain's groups are, and what makes the schema graph
      // show a declared edge: document's "group#member" subjects name it, so
      // those edges are declared and carry toIds. A group's members are users
      // or other groups' members, which is how the chain nests. Tuples use it
      // (group:eng, group:platform and group:oncall), so deleting it is
      // refused like document.
      {
        id: "rtype_01d", namespacePath: "", name: "group", description: "A set of subjects",
        relations: [{ name: "member", allowedSubjects: ["user", "group#member"] }],
        permissions: [],
        createdBy: WARDEN_ACTOR, updatedBy: WARDEN_ACTOR, createdAt: hourAgo, updatedAt: hourAgo,
      },
      // A second type NAMED group, in eng/platform. Two types can share a
      // name across namespaces, which is why an edge carries fromId and toIds
      // and not only names: document's group#member edges now name two
      // target ids, root first because types sort by namespace path. A
      // namespace filter of "eng/platform" leaves only this one.
      {
        id: "rtype_01e", namespacePath: "eng/platform", name: "group", description: "",
        relations: [{ name: "member", allowedSubjects: ["user"] }],
        permissions: [],
        createdAt: hourAgo, updatedAt: hourAgo,
      },
    ],
    // Newest first, matching what a correctly-ordered "Recent checks" panel
    // must show. Distinct createdAt values are the point: a fixture where
    // every row shares one timestamp cannot tell an ordering regression from
    // correct behaviour, because slicing from index 0 looks the same either
    // way. See seedCheckLogs for what each row is for.
    checkLogs,
    // The engine's count of decided checks that left no row. Since is two
    // hours before the newest row, so the page's loss line has a window to
    // print. checkLogs.list reports it only while checkLogEnabled is true.
    checkLogLoss: { queueFull: 3, writeFailed: 1, since: rfc3339(Date.parse(checkLogs[0].createdAt) - 2 * 3600_000) },
    // maxGraphDepth, maxGraphVisited and maxGraphFanout are the budget
    // relations.expand walks under, and each one is the knob for one stop
    // reason. Change one here and restart the server to reach that stop on
    // the seeded userset chain: see THE STOP STATES in the graph section. A 0
    // means the walker's default (10, 5000, 1000), as in Go.
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
      // What a real engine with these settings and the extension's defaults
      // holds: the audit log sink (auth.audit_log is on by default), the
      // expression-cache invalidator the extension adds, and the decision
      // cache invalidator NewEngine adds because cacheTtlSeconds is above 0.
      // Sorted, as config.detail sends them.
      plugins: ["auditlog", "dsl-expression-cache-invalidator", "warden-cache-invalidator"],
    },
  }
}

/**
 * The check log, newest first. Thirty rows, so the list pages at 25 and the
 * second page has five. Every id has the shape of a real check log TypeID
 * (prefix chklog, 26 characters of lowercase Crockford base32), because the
 * Go handler refuses anything else with BAD_REQUEST and a hand check should
 * be able to tell that refusal from a NOT_FOUND. The last two digits are the
 * row's position, 01 the newest.
 *
 * createdAt is whole seconds and distinct on every row, so ordering, the
 * inclusive after/before bounds and the recent-checks slice can each be told
 * from a wrong answer. Rule ids name rows that exist in the seed's roles and
 * policies, except where a row says otherwise.
 *
 * A function declaration on purpose: seedWardenState calls it before any
 * const further down the module has been initialised.
 */
function seedCheckLogs() {
  const base = Math.floor(Date.now() / 1000) * 1000
  const rows = []
  let n = 0
  const row = (minutesAgo, fields) => {
    n++
    rows.push({
      id: "chklog_01jzq8v4m2wardenfx000000" + String(n).padStart(2, "0"),
      namespacePath: "",
      appId: "app_dashboard",
      subjectKind: "user",
      subjectId: "alice",
      action: "read",
      resourceType: "document",
      resourceId: "readme",
      decision: "allow",
      reason: "",
      matchedBy: [],
      obligations: [],
      evalTimeNs: 400_000,
      requestIp: "",
      requestId: "",
      traceId: "",
      cached: false,
      error: "",
      // Minutes apart, plus a per-row second offset so no two rows sit on a
      // round minute together.
      createdAt: new Date(base - minutesAgo * 60_000 - ((n * 7) % 41) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      ...fields,
    })
  }

  // The engine's own reason sentences (engine.go), Go %q quoting for the
  // tenant. The fixture's tenant is org_1. An allow carries no reason.
  const noRoles = (subject) => `subject user:${subject} has no assigned roles in tenant "org_1"`

  // The three matched-by shapes, one per evaluator.
  const rbac = (roleId, perm) => [{ source: "rbac", ruleId: roleId, detail: "role grants " + perm }]
  const abac = (policyId, name, effect) => [{ source: "abac", ruleId: policyId, detail: `policy "${name}" (${effect})` }]
  const rebac = (detail) => [{ source: "rebac", ruleId: "", detail }]

  // RBAC ALLOW naming a role that exists (Reader). The trace id and both
  // correlation ids are set, so the detail page's correlation block is full.
  row(0, { matchedBy: rbac("role_01hq", "document:read"), evalTimeNs: 412_000, requestIp: "203.0.113.10", requestId: "req_7f3a91", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" })
  // CACHED ALLOW: the most common real answer to "why did my permission
  // change not take effect", and the page's scan signal. No trace id, so a
  // detail with the block half empty is reachable.
  row(5, { matchedBy: rbac("role_01hq", "document:read"), evalTimeNs: 1_800, cached: true, requestIp: "203.0.113.10", requestId: "req_7f3a92" })
  // ABAC DENY_EXPLICIT with an obligation, naming a policy that exists. Dave
  // holds Contractor, which grants document:delete, so RBAC allows and the
  // lockout overrides it. The log stores no attributes: the request carried
  // employment "contractor" and a network that is not "office".
  row(10, { subjectId: "dave", action: "delete", decision: "deny_explicit", reason: 'denied by policy "contractor-lockout"', matchedBy: abac("wpol_contractor-lockout", "contractor-lockout", "deny"), obligations: ["audit"], evalTimeNs: 902_000, requestIp: "198.51.100.23", requestId: "req_7f3a93", traceId: "0af7651916cd43dd8448eb211c80319c" })
  // ERROR, in eng/platform. No matched rules and no correlation ids: the
  // engine failed before it had either.
  row(15, { namespacePath: "eng/platform", subjectKind: "service", subjectId: "deployer", action: "admin", resourceType: "cluster", resourceId: "prod", decision: "error", evalTimeNs: 0, error: "store unavailable" })
  // RBAC ALLOW in eng/platform, naming Platform admin.
  row(20, { namespacePath: "eng/platform", subjectId: "bob", action: "admin", resourceType: "cluster", resourceId: "prod", matchedBy: rbac("role_01hr", "cluster:admin"), evalTimeNs: 388_000, requestIp: "10.4.2.21", requestId: "req_7f3a95" })
  // ABAC ALLOW with no obligations. Erin holds Staff, which grants nothing, so
  // RBAC has no permission and staff-read-documents allows a request from a
  // 192.168.x address (the request's context.ip, which the log does not store).
  row(25, { subjectId: "erin", resourceId: "handbook", matchedBy: abac("wpol_staff-read-documents", "staff-read-documents", "allow"), evalTimeNs: 655_000, requestIp: "10.4.2.17", requestId: "req_7f3a96" })
  // ABAC ALLOW with obligations, naming the policy that carries them. Frank
  // holds On-call, which grants nothing, and asked after 18:00 (context.hour,
  // not stored), so after-hours-approval allows it.
  row(30, { subjectId: "frank", resourceType: "cluster", resourceId: "staging", matchedBy: abac("wpol_after-hours-approval", "after-hours-approval", "allow"), obligations: ["log", "notify:security"], evalTimeNs: 721_000, requestIp: "192.0.2.44", requestId: "req_7f3a97", traceId: "5b8aa5a2d2c872e8321cf37308d69df2" })
  // REBAC ALLOW with no ruleId: a tuple has no rule id to name. "direct
  // relation" is what the engine writes when the action is itself a relation
  // the subject holds (rel_01a: bob is a viewer of document:readme).
  row(35, { subjectId: "bob", action: "viewer", matchedBy: rebac("direct relation"), evalTimeNs: 240_000, requestIp: "10.4.2.21", requestId: "req_7f3a98" })
  // REBAC ALLOW through the resource type's expression: document defines
  // read as "viewer or editor", and bob is a viewer, so "read" is granted
  // although no tuple names "read".
  row(40, { subjectId: "bob", matchedBy: rebac("expression: read"), evalTimeNs: 1_120_000, requestIp: "10.4.2.21", requestId: "req_7f3a99" })
  // DENY_NO_ROLES: empty matchedBy, the "nothing matched" shape.
  row(45, { subjectId: "mallory", decision: "deny_no_roles", reason: noRoles("mallory"), evalTimeNs: 96_000, requestIp: "203.0.113.99", requestId: "req_7f3a9a" })
  // DENY_NO_ROLES for carol, whose only assignment has expired.
  row(50, { subjectId: "carol", decision: "deny_no_roles", reason: noRoles("carol"), evalTimeNs: 101_000, requestIp: "10.4.2.25", requestId: "req_7f3a9b" })
  // DENY_NO_PERMS: dave holds Contractor, which grants document:delete and
  // nothing on a report.
  row(55, { subjectId: "dave", resourceId: "q3", resourceType: "report", decision: "deny_no_perms", reason: 'no role grants permission "report:read" for subject user:dave', evalTimeNs: 310_000, requestIp: "198.51.100.23", requestId: "req_7f3a9c" })
  // DENY_NO_PERMS: alice holds Reader, and Reader grants no delete.
  row(60, { action: "delete", decision: "deny_no_perms", reason: 'no role grants permission "document:delete" for subject user:alice', evalTimeNs: 298_000, requestIp: "203.0.113.10", requestId: "req_7f3a9d" })
  // A DELETED RULE: an allow that names a role id that exists nowhere in
  // this fixture (role_01hx), the row the detail page's rule link has to
  // read honestly about. Its permission text still says what it granted.
  row(65, { action: "write", matchedBy: rbac("role_01hx", "document:write"), evalTimeNs: 377_000, requestIp: "203.0.113.10", requestId: "req_7f3a9e" })
  row(70, { subjectId: "erin", action: "export", resourceType: "report", resourceId: "q3", decision: "deny_no_perms", reason: 'no role grants permission "report:export" for subject user:erin', evalTimeNs: 187_000, requestIp: "10.4.2.17", requestId: "req_7f3a9f" })
  // DENY_NO_PERMS in eng/platform: bob holds Platform admin there, which
  // grants cluster:admin and nothing about delete.
  row(75, { namespacePath: "eng/platform", subjectId: "bob", action: "delete", resourceType: "cluster", resourceId: "prod", decision: "deny_no_perms", reason: 'no role grants permission "cluster:delete" for subject user:bob', evalTimeNs: 540_000, requestIp: "10.4.2.21", requestId: "req_7f3aa0" })
  // DENY_NO_ROLES, in eng/platform. Neither deny_relation nor deny_default can
  // be a merged decision while RBAC is on: the merge takes the first reason
  // any model gave, RBAC always gives one, and it comes first. ReBAC's
  // deny_relation shows on the playground's lanes instead.
  row(80, { namespacePath: "eng/platform", subjectId: "mallory", resourceId: "runbook", decision: "deny_no_roles", reason: noRoles("mallory"), evalTimeNs: 205_000, requestIp: "203.0.113.99", requestId: "req_7f3aa1" })
  row(85, { matchedBy: rbac("role_01hq", "document:read"), evalTimeNs: 2_100, cached: true, requestIp: "203.0.113.10", requestId: "req_7f3aa2" })
  row(90, { matchedBy: rbac("role_01hq", "document:read"), evalTimeNs: 1_900, cached: true, requestIp: "203.0.113.10", requestId: "req_7f3aa3" })
  // REBAC ALLOW through the namespace cascade: rel_01a lives at the tenant
  // root and still grants bob viewer on document:readme when the check runs
  // in eng/platform. Bob's only role, Platform admin, grants cluster:admin, so
  // RBAC has nothing to say about a document and ReBAC is what allows it.
  row(95, { namespacePath: "eng/platform", subjectId: "bob", action: "viewer", matchedBy: rebac("direct relation"), evalTimeNs: 233_000, requestIp: "10.4.2.21", requestId: "req_7f3aa4" })
  row(100, { subjectId: "erin", resourceId: "handbook", matchedBy: abac("wpol_staff-read-documents", "staff-read-documents", "allow"), evalTimeNs: 2_400, cached: true, requestIp: "10.4.2.17", requestId: "req_7f3aa5" })
  row(110, { subjectId: "carol", decision: "deny_no_roles", reason: noRoles("carol"), evalTimeNs: 99_000, requestIp: "10.4.2.25", requestId: "req_7f3aa6" })
  // REBAC ALLOW in eng/platform: rel_01d makes alice a viewer of the runbook.
  // The action is the relation itself, "viewer", which no role grants (her
  // Reader role holds document:read only, and it cascades down), so RBAC
  // denies and the direct tuple allows.
  row(120, { namespacePath: "eng/platform", subjectId: "alice", action: "viewer", resourceId: "runbook", matchedBy: rebac("direct relation"), evalTimeNs: 251_000, requestIp: "203.0.113.10", requestId: "req_7f3aa7" })
  row(130, { subjectId: "dave", action: "delete", decision: "deny_explicit", reason: 'denied by policy "contractor-lockout"', matchedBy: abac("wpol_contractor-lockout", "contractor-lockout", "deny"), obligations: ["audit"], evalTimeNs: 887_000, requestIp: "198.51.100.23", requestId: "req_7f3aa8", traceId: "9e107d9d372bb6826bd81d3542a419d6" })
  row(140, { namespacePath: "eng/platform", subjectKind: "service", subjectId: "deployer", action: "admin", resourceType: "cluster", resourceId: "prod", decision: "error", evalTimeNs: 0, error: "store unavailable" })
  row(150, { matchedBy: rbac("role_01hq", "document:read"), evalTimeNs: 405_000, requestIp: "203.0.113.10", requestId: "req_7f3aaa" })
  // Deployer holds Platform oncall (asgn_01d), which has no grants of its
  // own and inherits Platform admin. ruleId is the role whose own permission
  // matched, so it names the parent.
  row(165, { namespacePath: "eng/platform", subjectKind: "service", subjectId: "deployer", action: "admin", resourceType: "cluster", resourceId: "prod", matchedBy: rbac("role_01hr", "cluster:admin"), evalTimeNs: 402_000, requestIp: "10.4.2.21", requestId: "req_7f3aab" })
  row(180, { action: "write", matchedBy: rbac("role_01hx", "document:write"), evalTimeNs: 371_000, requestIp: "203.0.113.10", requestId: "req_7f3aac" })
  row(200, { subjectId: "frank", resourceType: "cluster", resourceId: "staging", matchedBy: abac("wpol_after-hours-approval", "after-hours-approval", "allow"), obligations: ["log", "notify:security"], evalTimeNs: 2_600, cached: true, requestIp: "192.0.2.44", requestId: "req_7f3aad" })
  row(220, { subjectId: "mallory", action: "delete", decision: "deny_no_roles", reason: noRoles("mallory"), evalTimeNs: 289_000, requestIp: "203.0.113.99", requestId: "req_7f3aae" })
  return rows
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
  // The namespace the analysis specimens live in. Policies cascade down, so a
  // check at the tenant root or at eng/platform never sees them, and none of
  // them can decide a playground scenario or a check log row it was not
  // written for. They stay active, so the pages still analyse them.
  const SANDBOX = "sandbox"
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
      namespacePath: SANDBOX,
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
    // MATCHES EVERYTHING: all three matcher lists empty and no condition to
    // restrict it.
    policy("catch-all-allow", {
      namespacePath: SANDBOX,
      description: "No subjects, actions or resources: it applies to every check.",
      priority: 900,
    }),
    // NO MATCHERS BUT A CONDITION: the lists are empty, yet the condition
    // depends on the check, so this does NOT apply to every check.
    policy("office-network-allow", {
      description: "No subjects, actions or resources, but only from the office network.",
      priority: 900,
      conditions: [condition("net1", "context.ip", "ip_in_cidr", ["10.0.0.0/8"])],
    }),
    // A SUBJECT MATCHER THAT IS EMPTY inside a list: it matches everyone, so
    // the subject list restricts nothing although it has two entries. The
    // actions and resources still restrict, so the policy as a whole does not
    // match everything.
    policy("legacy-empty-subject", {
      namespacePath: SANDBOX,
      description: "One of its subjects is the empty matcher.",
      effect: "deny",
      priority: 40,
      subjects: [{ kind: "user", id: "u1", role: "" }, { kind: "", id: "", role: "" }],
      actions: ["delete"],
      resources: ["report:*"],
    }),
    // A not_in GIVEN A STRING: the evaluator refuses an in or not_in whose value
    // is not a list, and a deny whose condition errors fails closed, so this
    // deny denies everyone the other matchers select.
    policy("office-ip-lockout", {
      namespacePath: SANDBOX,
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
      namespacePath: SANDBOX,
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
    // conditions } for a rejected draft, { reason: "stale" } for an update
    // made from an old version). It does not reach the wire, for
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

/**
 * Every distinct namespace on any warden entity or check log row, plus the
 * tenant root. Check log rows count because a leaf namespace where checks run
 * may hold no role, grant or assignment of its own. Check never validates a
 * namespace, so a check log path that validateNamespace refuses (reserved,
 * uppercase or too deep) is left out: every filter would refuse it.
 */
function wardenNamespaces() {
  const seen = new Set([""])
  for (const group of [warden.roles, warden.permissions, warden.assignments, warden.relations, warden.policies, warden.resourceTypes]) {
    for (const row of group) seen.add(row.namespacePath)
  }
  for (const row of warden.checkLogs) {
    try {
      validateNamespace(row.namespacePath)
    } catch {
      continue
    }
    seen.add(row.namespacePath)
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

/**
 * Mirrors resourcetype.CheckTupleDeclared. The resource type named after the
 * tuple's object type at the nearest namespace up the tuple's chain (the
 * evaluator's findResourceType) governs it; none anywhere in the chain and
 * the tuple is not checked. One that governs must declare the relation, and
 * that relation must allow the subject: "user" for user:x, "group#member" for
 * group:x#member, and neither for the other. A relation that lists no
 * subject types allows any subject; it must still be declared. lookup(ns, name) answers for a
 * resource type, or null. Returns the refusal's text, or null.
 */
function undeclaredTupleMessage(t, lookup) {
  let rt = null
  let at = ""
  for (const ns of ancestorNamespaces(t.namespacePath)) {
    rt = lookup(ns, t.objectType)
    if (rt) {
      at = ns
      break
    }
  }
  if (!rt) return null
  const where = (ns) => (ns === "" ? "the tenant root" : `namespace ${goQuote(ns)}`)
  const subjectRelation = t.subjectRelation ?? ""
  const spec = subjectRelation === "" ? t.subjectType : t.subjectType + "#" + subjectRelation
  const subjectId = subjectRelation === "" ? t.subjectId : t.subjectId + "#" + subjectRelation
  const head = `tuple ${t.objectType}:${t.objectId}#${t.relation}@${t.subjectType}:${subjectId} in ${where(t.namespacePath)} is refused: `
  const type = `resource type ${goQuote(rt.name)} in ${where(at)}`
  const list = (names) => names.map(goQuote).join(", ")
  const rel = (rt.relations ?? []).find((r) => r.name === t.relation)
  if (!rel) {
    const names = (rt.relations ?? []).map((r) => r.name)
    if (names.length === 0) return head + `${type} declares no relation ${goQuote(t.relation)} (it declares no relations)`
    return head + `${type} declares no relation ${goQuote(t.relation)} (its relations are ${list(names)})`
  }
  const allowed = rel.allowedSubjects ?? []
  // An empty list puts no limit on the subject type.
  if (allowed.length === 0 || allowed.includes(spec)) return null
  return head + `relation ${goQuote(t.relation)} of ${type} allows subjects ${list(allowed)}, not ${goQuote(spec)}`
}

/** The stored resource type named name at exactly ns, or null. */
const storedResourceType = (ns, name) => warden.resourceTypes.find((x) => x.namespacePath === ns && x.name === name) ?? null

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
 * guardMemberCap in members.go (assignment.CheckMemberCap). Three rules that are easy to get backwards:
 * MaxMembers 0 (or unset) is UNLIMITED; only LIVE assignments occupy a seat;
 * and a member is a distinct (subjectKind, subjectId), not a row, so a
 * subject who already holds the role live is never refused.
 */
function guardMemberCap(role, subjectKind, subjectId, nowMs) {
  if (!(role.maxMembers > 0)) return
  const members = liveMembers(role.id, nowMs)
  if (members.has(JSON.stringify([subjectKind, subjectId]))) return
  if (members.size < role.maxMembers) return
  throw conflict(`${q(role.name)} is capped at ${role.maxMembers} members and already has ${members.size}`)
}

/** assignment.LiveMembers: the distinct (kind, id) pairs holding roleId live at nowMs. */
function liveMembers(roleId, nowMs) {
  const members = new Set()
  for (const a of warden.assignments) {
    if (a.roleId === roleId && isLive(a, nowMs)) members.add(JSON.stringify([a.subjectKind, a.subjectId]))
  }
  return members
}

/**
 * assignment.CheckCapLowering: the CapBelowMembersError text when moving the
 * role's cap from oldCap to newCap lowers it to a positive number below its
 * live member count, or "" when the change passes. A cap of 0 or below is
 * unlimited, so clearing, raising, keeping it, or moving between unlimited
 * values passes without counting; unlimited to a positive cap is a lowering.
 */
function capLoweringRefusal(role, oldCap, newCap, nowMs) {
  if (!(newCap > 0) || (oldCap > 0 && newCap >= oldCap)) return ""
  const n = liveMembers(role.id, nowMs).size
  if (n <= newCap) return ""
  return `${q(role.name)} has ${n} members, so its cap cannot be lowered to ${newCap}`
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

function lexExpression(src, { floats = false } = {}) {
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
      // dsl.Lexer.readNumber: a decimal when a "." and a digit follow. Only
      // the schema parser asks for it; an expression has no use for a number.
      if (floats && peek(0) === 0x2e && isDigit(peek(1))) {
        advance()
        while (pos < buf.length && isDigit(buf[pos])) advance()
        return { kind: "FLOAT", value: buf.toString("utf8", start, pos), ...at }
      }
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

// alwaysPresentFields: the fields resolveField returns as a plain string on
// every request, so the value is never nil, even when it is empty. Being
// present fixes exists and not_exists on these. Check refusing some of them
// when empty fixes neq "" as well (REQUIRED_FIELDS below), and those two
// rules plus values that match any string are all this port classifies.
// Other shapes on a required field are fixed too and are not classified:
// eq "", in [""] and regex ^$ are always false, and not_in [""] is always
// true.
const ALWAYS_PRESENT_FIELDS = new Set(["subject.kind", "subject.id", "resource.type", "resource.id", "action.name"])

// requiredFields: the fields Engine.Check refuses to evaluate when empty
// (engine.go's prepareCheck: subject ID, action name, resource type), so on
// every check warden evaluates they are never "".
const REQUIRED_FIELDS = new Set(["subject.id", "action.name", "resource.type"])

// matchEveryRegex: the anchored patterns recognised as matching every
// string. Patterns with no empty-width assertion are judged by
// regexMatchesEverything instead. "^.*$" is absent on purpose: without (?s)
// the dot does not match a newline, so it fails on a value containing one.
const MATCH_EVERY_REGEX = new Set(["^", "$", "^.*", ".*$"])

// The parsed nodes that are Go's empty-width ops: ^ and \A (bot), $ and \z
// (eot), \b (wb), \B (nwb). The parser maps (?m)^ and (?m)$ to bot and eot
// too, which is still an assertion, as OpBeginLine and OpEndLine are in Go.
const EMPTY_WIDTH_NODES = new Set(["bot", "eot", "wb", "nwb"])

function hasEmptyWidthAssertion(node) {
  return EMPTY_WIDTH_NODES.has(node.t) || childrenOf(node).some(hasEmptyWidthAssertion)
}

/**
 * regexMatchesEverything in policy_analysis.go: true for MATCH_EVERY_REGEX,
 * and for a pattern with no empty-width assertion that matches "", because
 * that empty match does not depend on what surrounds it, so MatchString finds
 * it at the start of any value. Where this port cannot settle the pattern (an
 * "unknown" compile, or matching out of steps) it claims nothing.
 */
function regexMatchesEverything(pattern) {
  if (MATCH_EVERY_REGEX.has(pattern)) return true
  const compiled = compileGoRegex(pattern)
  if (compiled.status !== "ok" || hasEmptyWidthAssertion(compiled.tree)) return false
  return goRegexMatches(compiled.tree, "") === true
}

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
  // inSlice refuses a value that is not a list, whatever the field.
  if ((c.operator === "in" || c.operator === "not_in") && goListOf(c.value) === null) {
    return { problem: "throws", reason: "notAList" }
  }
  if (!fieldResolves(c.field)) {
    const outcome = nilOutcome(c, compiled)
    if (outcome === null) return none
    return { problem: outcome ? "alwaysTrue" : "alwaysFalse", reason: "unresolvableField" }
  }
  if (c.operator === "contains" || c.operator === "starts_with" || c.operator === "ends_with") {
    if (goSprint(c.value) === "") return { problem: "alwaysTrue", reason: "matchesAnything" }
  } else if (c.operator === "regex") {
    if (regexMatchesEverything(goSprint(c.value))) return { problem: "alwaysTrue", reason: "matchesAnything" }
  }
  if (ALWAYS_PRESENT_FIELDS.has(c.field)) {
    if (c.operator === "exists") return { problem: "alwaysTrue", reason: "alwaysPresent" }
    if (c.operator === "not_exists") return { problem: "alwaysFalse", reason: "alwaysPresent" }
  }
  // neq compares fmt.Sprint of both sides, and a required field is never
  // empty on a check warden evaluates. No reason fits, so none is given.
  if (REQUIRED_FIELDS.has(c.field) && c.operator === "neq" && goSprint(c.value) === "") {
    return { problem: "alwaysTrue", reason: "" }
  }
  switch (c.operator) {
    case "in":
    case "not_in": {
      // A value that is not a list was classified as throwing above.
      if (goListOf(c.value).length > 0) return none
      return { problem: c.operator === "in" ? "alwaysFalse" : "alwaysTrue", reason: "emptyList" }
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
  a.matchesEverything =
    a.subjectsUnrestricted && a.actionsUnrestricted && a.resourcesUnrestricted && conditionsAlwaysHold(p.effect, a.problems)
  return a
}

/**
 * conditionsAlwaysHold: for a policy that passes its matchers, whether its
 * conditions are met on every check. Walked in evaluation order: an always-true
 * condition changes nothing and the first other one decides. A throw on a deny
 * counts as met (the engine fails closed), a throw on an allow skips the policy,
 * an always-false condition fails, and one that depends on the check holds for
 * some checks and not others. Reaching the end, with no conditions at all,
 * means they always hold.
 */
function conditionsAlwaysHold(effect, problems) {
  for (const problem of problems) {
    if (problem === "alwaysTrue") continue
    if (problem === "throws") return effect !== "allow"
    return false
  }
  return true
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
    expectedVersion: present(p?.expectedVersion) ? decodeInt(p.expectedVersion, S, "expectedVersion") : undefined,
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

// mapWardenError's answer to ErrPolicyVersionConflict, message verbatim.
// details.reason is what tells it apart from a taken name, which is CONFLICT
// too and carries no reason.
function policyStale() {
  return new WardenFixtureError(
    409,
    "CONFLICT",
    "this policy changed after it was opened, so nothing was saved. Reload the page to see the current version, then make the change again.",
    { reason: "stale" }
  )
}

// checkExpectedVersion: an expectedVersion below the stored one is stale,
// one above it or a negative one was never stored and is bad input, and none
// at all is not checked. Equality is tested first, as in Go: a policy stored
// without a version sits at 0, and its editor sends 0.
function checkExpectedVersion(before, expected) {
  if (expected === undefined) return
  if (expected === before.version) return
  if (expected < 0) {
    throw badRequest(`expectedVersion ${expected} is not a version: versions are never negative`)
  }
  if (expected > before.version) {
    throw badRequest(`expectedVersion ${expected} is ahead of the stored version ${before.version}`)
  }
  throw policyStale()
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
  // rfc3339Ptr: full precision (time.RFC3339Nano), so a bound with a
  // fraction shows the instant EffectiveAt compares.
  if (p.notBefore !== null) out.notBefore = formatRFC3339Nano(p.notBefore)
  if (p.notAfter !== null) out.notAfter = formatRFC3339Nano(p.notAfter)
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


// ---------------------------------------------------------------------------
// Check log helpers: the projection shared by overview.recentChecks and
// checkLogs.list, the detail projection, and the decision set the list filter
// accepts.
// ---------------------------------------------------------------------------

/**
 * knownDecisions in handlers_checklogs.go: every value the engine writes.
 * A filter outside it can only match nothing, and an empty page that reads
 * as "nothing happened" is worse than a refusal.
 */
const KNOWN_DECISIONS = new Set([
  "allow", "deny", "deny_explicit", "deny_default", "deny_no_roles",
  "deny_no_perms", "deny_condition", "deny_relation", "error",
])

/** The store's check log order: newest first, id descending as the tiebreak. */
function newestFirst(rows) {
  return [...rows].sort((a, b) => {
    const d = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    return d !== 0 ? d : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/**
 * projectCheckLog in handlers_overview.go: CheckLogSummary's keys and no
 * others. reason and error carry omitempty in Go, so an empty one is absent,
 * not "". createdAt is UTC RFC 3339 in whole seconds.
 */
function projectCheckLog(e) {
  const out = {
    id: e.id,
    namespacePath: e.namespacePath,
    subjectKind: e.subjectKind,
    subjectId: e.subjectId,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    decision: e.decision,
  }
  if (e.reason) out.reason = e.reason
  out.evalTimeNs = e.evalTimeNs
  out.cached = e.cached
  if (e.error) out.error = e.error
  out.createdAt = rfc3339(e.createdAt)
  return out
}

/**
 * CheckLogDetail: the summary plus what an auditor needs. matchedBy and
 * obligations are always arrays; the rest carry omitempty.
 */
function projectCheckLogDetail(e) {
  const out = projectCheckLog(e)
  if (e.appId) out.appId = e.appId
  out.matchedBy = e.matchedBy.map((m) => {
    const match = { source: m.source }
    if (m.ruleId) match.ruleId = m.ruleId
    if (m.detail) match.detail = m.detail
    return match
  })
  out.obligations = [...e.obligations]
  if (e.requestIp) out.requestIp = e.requestIp
  if (e.requestId) out.requestId = e.requestId
  if (e.traceId) out.traceId = e.traceId
  return out
}

/**
 * parseInstant in handlers_checklogs.go. Empty is unbounded (null). The
 * strict RFC 3339 parser stands in for Date.parse: Date.parse takes
 * "2030-01-01" and other shapes time.Parse refuses, and a fixture that
 * forgives them would hide the refusal.
 */
function parseInstant(field, raw) {
  if (raw === "") return null
  const ms = parseRFC3339(raw)
  if (ms === null) throw badRequest(`${field} is not an RFC 3339 time: ${raw}`)
  return ms
}

/** A check log id is prefix chklog and a 26 character base32 suffix whose first digit is 0 to 7. */
const CHECK_LOG_ID = /^chklog_[0-7][0-9a-hjkmnp-tv-z]{25}$/

// ---------------------------------------------------------------------------
// playground.explain
//
// handlers_playground.go: a dry run of one check, lane by lane. The Go handler
// asks the engine; the fixture has no engine, so it answers from a scenario
// table and builds each answer the way the engine would, from lanes. A lane is
// what one model did, and the merged verdict is computed from the lanes with
// mergeDecisions' own rules (explicit deny, then any allow, then the first
// reason, then the default), so a row cannot claim a verdict its lanes do not
// support.
//
// A scenario is keyed on subjectKind, subjectId, action, resourceType and
// namespacePath, all five exactly. Some rows also read one more field of the
// request, named in the row, because the seed policy or tuple that decides them
// depends on it. Every rule id below exists in this file's own roles and
// policies, and every relation chain is one the seed relations form.
//
// Tenant is org_1, the name the engine's reasons carry (as in the check log
// seed). Send the request in the right-hand column to reach each row.
//
//   row                         request
//   --------------------------  ------------------------------------------------
//   RBAC allow                  user alice, read, document, ""
//   RBAC allow, no lockout      user dave, delete, document, ""
//   explicit deny over an       user dave, delete, document, "", with
//   RBAC allow, obligation      subjectAttributes {"employment": "contractor"}
//                               and context {"network": "guest"}
//   ReBAC transitive allow      user erin, editor, document, "", resourceId
//                               "readme"
//   RBAC no permission, no      user erin, editor, document, "" with any other
//   relation (falls through)    resourceId
//   truncated walk              user alice, read, folder, ""
//   expression failed           user alice, write, document, ""
//   ABAC allow only             user frank, read, report, "", with context
//                               {"ip": "10.4.2.17"}
//   RBAC no permission, no      user frank, read, report, "" with no office
//   relation (falls through)    address
//   a failed model              service deployer, admin, cluster, "eng/platform"
//   no roles (the fallback)     anything else: user mallory, read, document, ""
//
// A request that matches no row gets the no roles shape for its own subject,
// action and resource, at whatever namespace it named. That is right for a
// subject who holds no role at that namespace (mallory, and anyone not in the
// seed). It is only a stand-in for one who does, so every subject the rows
// above name has a row for the requests that fall through their conditions.
// In the "sandbox" namespace (and under it) the fallback also applies the
// specimens seeded there: an explicit deny for a delete of a report, a service
// on a report, a user's delete of a document or a user's export of a document,
// and catch-all-allow for everything else.
//
// The rows were derived, not written by hand: each was checked against the
// policies in force at its namespace (ancestors included), with RBAC, ReBAC and
// ABAC applied as the engine applies them. The seeded specimens that would
// decide a row they were not written for live in the "sandbox" namespace, out
// of reach of checks at the tenant root and at eng/platform.
// ---------------------------------------------------------------------------

/** The tenant the engine's reasons name. */
const EXPLAIN_TENANT = "org_1"

/** truncatedWalkNote in engine.go, byte for byte, including the trailing "; ". */
const TRUNCATED_WALK_NOTE =
  "graph traversal budget exceeded (relation walk truncated, a relation may exist beyond the limit); "

// The engine's reason sentences, from the request. Go's %q is goQuote.
const reasonNoRoles = (r) => `subject ${r.subjectKind}:${r.subjectId} has no assigned roles in tenant ${goQuote(EXPLAIN_TENANT)}`
const reasonNoPerms = (r) =>
  `no role grants permission ${goQuote(r.resourceType + ":" + r.action)} for subject ${r.subjectKind}:${r.subjectId}`
const reasonNoRelation = (r) =>
  `no relation grants ${r.subjectKind}:${r.subjectId} ${r.action} access to ${r.resourceType}:${r.resourceId}`

// A model's own result, as CheckResult carries it.
const laneResult = (decision, fields = {}) => ({
  decision,
  allowed: decision === "allow",
  reason: fields.reason ?? "",
  matchedBy: fields.matchedBy ?? [],
  obligations: fields.obligations ?? [],
})

const rbacMatch = (roleId, permission) => [{ source: "rbac", ruleId: roleId, detail: "role grants " + permission }]
const abacMatch = (policyId, name, effect) => [{ source: "abac", ruleId: policyId, detail: `policy ${goQuote(name)} (${effect})` }]
const rebacMatch = (detail) => [{ source: "rebac", detail }]

// The lane states, one helper each so a scenario reads as the story it tells.
const RBAC_NO_ROLES = (r) => ({ state: "noMatch", result: laneResult("deny_no_roles", { reason: reasonNoRoles(r) }) })
const RBAC_NO_PERMS = (r) => ({ state: "noMatch", result: laneResult("deny_no_perms", { reason: reasonNoPerms(r) }) })
const REBAC_NO_RELATION = (r, extra = {}) => ({
  state: "noMatch",
  result: laneResult("deny_relation", { reason: reasonNoRelation(r) }),
  ...extra,
})
// ABAC with no matching policy has no result at all, so its lane has no
// decision and no reason.
const ABAC_NO_MATCH = { state: "noMatch" }
const SKIPPED = { state: "skipped" }

/** The obligations of every lane, first occurrence first, as mergeObligations does. */
function mergedObligations(results) {
  const seen = new Set()
  const out = []
  for (const r of results) {
    for (const o of r?.obligations ?? []) {
      if (!seen.has(o)) {
        seen.add(o)
        out.push(o)
      }
    }
  }
  return out
}

/**
 * mergeDecisions plus the truncation note in Check: an explicit deny from
 * ABAC wins, then the first allow in pipeline order, then the first reason
 * anyone gave, then the engine's own sentence. The note is prefixed to a
 * denial that followed a truncated walk, joined to the reason with joinReason.
 */
function mergeLanes(req, rbac, rebac, abac, walkTruncated) {
  const all = [rbac, rebac, abac]
  const obligations = mergedObligations(all)
  let out
  if (abac && abac.decision === "deny_explicit") {
    out = abac
  } else if (all.some((r) => r?.allowed)) {
    out = all.find((r) => r?.allowed)
  } else if (all.some((r) => r?.reason)) {
    out = all.find((r) => r?.reason)
  } else {
    out = laneResult("deny_default", {
      reason: `no rule allows ${req.subjectKind}:${req.subjectId} to ${req.action} on ${req.resourceType}:${req.resourceId}`,
    })
  }
  const merged = { ...out, matchedBy: [...out.matchedBy], obligations }
  if (!merged.allowed && walkTruncated) {
    merged.reason = TRUNCATED_WALK_NOTE + (merged.reason === "" ? "no rule allows the request" : merged.reason)
  }
  return merged
}

const projectMatch = (m) => {
  const out = { source: m.source }
  if (m.ruleId) out.ruleId = m.ruleId
  if (m.detail) out.detail = m.detail
  return out
}

/** projectLane: keys in the Go struct's order, the omitempty ones only when set. */
function projectLane(model, l) {
  const out = { model, state: l.state }
  if (l.result) {
    out.decision = l.result.decision
    if (l.result.reason) out.reason = l.result.reason
  }
  out.matchedBy = (l.result?.matchedBy ?? []).map(projectMatch)
  if (l.walkTruncated) out.walkTruncated = true
  if (l.expressionError) out.expressionError = l.expressionError
  if (l.error) out.error = l.error
  return out
}

/**
 * projectExplanation: three lanes in pipeline order and every array present.
 * A failed model has no merged verdict: decision "error", allowed false and
 * the wrapped message, as Check would have returned it.
 */
function projectExplanation(req, spec, evalTimeNs) {
  const lanes = [
    projectLane("rbac", spec.rbac),
    projectLane("rebac", spec.rebac),
    projectLane("abac", spec.abac),
  ]
  if (spec.failed) {
    return { decision: "error", allowed: false, error: spec.failed, matchedBy: [], obligations: [], evalTimeNs, lanes }
  }
  const merged = mergeLanes(req, spec.rbac.result, spec.rebac.result, spec.abac.result, spec.rebac.walkTruncated === true)
  const out = { decision: merged.decision, allowed: merged.allowed }
  if (merged.reason) out.reason = merged.reason
  return { ...out, matchedBy: merged.matchedBy.map(projectMatch), obligations: merged.obligations, evalTimeNs, lanes }
}

const EXPLAIN_SCENARIOS = [
  // RBAC ALLOW: Reader (role_01hq) grants document:read. ReBAC is skipped
  // because RBAC already allowed, and no policy matches.
  {
    key: ["user", "alice", "read", "document", ""],
    evalTimeNs: 412_000,
    lanes: () => ({
      rbac: { state: "allow", result: laneResult("allow", { matchedBy: rbacMatch("role_01hq", "document:read") }) },
      rebac: SKIPPED,
      abac: ABAC_NO_MATCH,
    }),
  },
  // EXPLICIT DENY OVER AN RBAC ALLOW, with an obligation. Dave holds
  // Contractor (role_01hv), which grants document:delete, and
  // contractor-lockout denies a contractor's delete unless they are on the
  // office network. Its two conditions read subject.employment and
  // context.network, so the request has to carry the first for the deny to
  // apply. The second may be missing: a missing field is not "office".
  // Its "audit" obligation rides on the merged answer.
  {
    key: ["user", "dave", "delete", "document", ""],
    // A missing context.network is not "office", as the engine's neq reads a
    // missing field, so the lockout applies to a contractor who sent none.
    when: (r) => r.subjectAttributes.employment === "contractor" && r.context.network !== "office",
    evalTimeNs: 902_000,
    lanes: () => ({
      rbac: { state: "allow", result: laneResult("allow", { matchedBy: rbacMatch("role_01hv", "document:delete") }) },
      rebac: SKIPPED,
      abac: {
        state: "deny",
        result: laneResult("deny_explicit", {
          reason: `denied by policy ${goQuote("contractor-lockout")}`,
          matchedBy: abacMatch("wpol_contractor-lockout", "contractor-lockout", "deny"),
          obligations: ["audit"],
        }),
      },
    }),
  },
  // The same delete with the lockout's conditions unmet: Contractor allows it
  // and nothing objects. It follows the row above, which takes the request
  // first when it carries the contractor attributes.
  {
    key: ["user", "dave", "delete", "document", ""],
    evalTimeNs: 391_000,
    lanes: () => ({
      rbac: { state: "allow", result: laneResult("allow", { matchedBy: rbacMatch("role_01hv", "document:delete") }) },
      rebac: SKIPPED,
      abac: ABAC_NO_MATCH,
    }),
  },
  // REBAC TRANSITIVE ALLOW. Erin's only role, Release approver, grants
  // nothing, so RBAC has no permission for her. ReBAC walks
  // document:readme#editor to the userset group:eng#member (rel_01c) and finds
  // erin in it (rel_01f). Only readme has that chain, so the row needs the id.
  {
    key: ["user", "erin", "editor", "document", ""],
    when: (r) => r.resourceId === "readme",
    evalTimeNs: 1_120_000,
    lanes: (r) => ({
      rbac: RBAC_NO_PERMS(r),
      rebac: {
        state: "allow",
        result: laneResult("allow", {
          matchedBy: rebacMatch(`transitive: ${r.resourceType}:${r.resourceId}#${r.action} -> group:eng#member -> user:erin`),
        }),
      },
      abac: ABAC_NO_MATCH,
    }),
  },
  // Erin on any other document: the same RBAC no permission (her roles grant
  // nothing) and no relation, so the verdict is RBAC's. The row above takes
  // readme first.
  {
    key: ["user", "erin", "editor", "document", ""],
    evalTimeNs: 588_000,
    lanes: (r) => ({
      rbac: RBAC_NO_PERMS(r),
      rebac: REBAC_NO_RELATION(r),
      abac: ABAC_NO_MATCH,
    }),
  },
  // TRUNCATED WALK. Alice holds Reader, which grants no folder permission.
  // The walk down a deep folder tree stops at its budget before it can say
  // whether a relation exists, so ReBAC's no match is not "no relation". The
  // merged reason is RBAC's, with the truncation note in front.
  {
    key: ["user", "alice", "read", "folder", ""],
    evalTimeNs: 3_400_000,
    lanes: (r) => ({
      rbac: RBAC_NO_PERMS(r),
      rebac: REBAC_NO_RELATION(r, { walkTruncated: true }),
      abac: ABAC_NO_MATCH,
    }),
  },
  // EXPRESSION FAILED. Document defines write as an expression over editor,
  // and the relation lookups behind it failed. The engine logs that, treats it
  // as no match and walks on, so the verdict is RBAC's no permission.
  {
    key: ["user", "alice", "write", "document", ""],
    evalTimeNs: 1_650_000,
    lanes: (r) => ({
      rbac: RBAC_NO_PERMS(r),
      rebac: REBAC_NO_RELATION(r, { expressionError: "relation store: context deadline exceeded" }),
      abac: ABAC_NO_MATCH,
    }),
  },
  // ABAC ALLOW ONLY. Frank holds On-call, which grants nothing on a report,
  // and has no tuple. office-network-allow (no matchers, one condition:
  // context.ip in 10.0.0.0/8) lets a request from the office network through,
  // and it is the only policy in force at the tenant root that applies.
  {
    key: ["user", "frank", "read", "report", ""],
    when: (r) => inTenNet(r.context.ip),
    evalTimeNs: 655_000,
    lanes: (r) => ({
      rbac: RBAC_NO_PERMS(r),
      rebac: REBAC_NO_RELATION(r),
      abac: {
        state: "allow",
        result: laneResult("allow", { matchedBy: abacMatch("wpol_office-network-allow", "office-network-allow", "allow") }),
      },
    }),
  },
  // Frank without an office address: On-call grants nothing on a report and
  // office-network-allow needs context.ip, so nothing applies. The row above
  // takes a request that carries a 10.x address first.
  {
    key: ["user", "frank", "read", "report", ""],
    evalTimeNs: 421_000,
    lanes: (r) => ({
      rbac: RBAC_NO_PERMS(r),
      rebac: REBAC_NO_RELATION(r),
      abac: ABAC_NO_MATCH,
    }),
  },
  // A FAILED MODEL. The deployer's check in eng/platform fails on RBAC's store
  // read, as the check log's error rows do. Nothing after it ran, and there
  // is no merged verdict: Check would have returned this error.
  {
    key: ["service", "deployer", "admin", "cluster", "eng/platform"],
    evalTimeNs: 184_000,
    lanes: () => ({
      rbac: { state: "error", error: "store unavailable" },
      rebac: { state: "notEvaluated" },
      abac: { state: "notEvaluated" },
      failed: "warden rbac: store unavailable",
    }),
  },
]

// The analysis specimens seeded in the "sandbox" namespace, as ABAC sees them
// for a subject who holds no role (the fallback's subject). Highest priority
// first, as the evaluator sorts them: every deny outranks an allow, so the
// first deny that applies is the verdict, and catch-all-allow (which applies to
// everything) is the allow that wins otherwise.
const SANDBOX_DENIES = [
  // legacy-empty-subject, priority 40: an empty subject matcher matches everyone.
  ["legacy-empty-subject", (r) => r.action === "delete" && r.resourceType === "report"],
  // wildcard-actions-deny, priority 35: every action, services only.
  ["wildcard-actions-deny", (r) => r.subjectKind === "service" && r.resourceType === "report"],
  // legacy-id-pattern-deny, priority 30: its regex never compiles, and a deny that errors applies.
  ["legacy-id-pattern-deny", (r) => r.subjectKind === "user" && r.action === "delete" && r.resourceType === "document"],
  // office-ip-lockout, priority 25: not_in given a string is always true.
  ["office-ip-lockout", (r) => r.subjectKind === "user" && r.action === "export" && r.resourceType === "document"],
]

/** Whether a check runs in the sandbox namespace or under it. */
const inSandbox = (ns) => ns === "sandbox" || ns.startsWith("sandbox/")

/** ABAC's lane for a roleless subject in the sandbox namespace. */
function sandboxAbac(r) {
  const denied = SANDBOX_DENIES.find(([, applies]) => applies(r))
  if (denied) {
    const [name] = denied
    return {
      state: "deny",
      result: laneResult("deny_explicit", {
        reason: `denied by policy ${goQuote(name)}`,
        matchedBy: abacMatch("wpol_" + name, name, "deny"),
      }),
    }
  }
  return {
    state: "allow",
    result: laneResult("allow", { matchedBy: abacMatch("wpol_catch-all-allow", "catch-all-allow", "allow") }),
  }
}

/** A dotted-quad IPv4 address inside 10.0.0.0/8, the one CIDR a row here reads. */
function inTenNet(ip) {
  const m = typeof ip === "string" ? /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip) : null
  return m !== null && m.slice(1).every((o) => Number(o) <= 255)
}

/** The scenario a request reaches, or null. The first row whose key and condition both hold wins. */
function findExplainScenario(req) {
  const key = [req.subjectKind, req.subjectId, req.action, req.resourceType, req.namespacePath]
  return EXPLAIN_SCENARIOS.find((s) => s.key.every((k, i) => k === key[i]) && (!s.when || s.when(req))) ?? null
}

/** A context or attribute bag: null and absent decode to none, as a nil map does. */
function decodeBag(v, field) {
  if (v === undefined || v === null) return {}
  if (typeof v !== "object" || Array.isArray(v)) throw decodeFail("PlaygroundExplainInput", field, v, "map[string]interface {}")
  return v
}

/**
 * One dry-run check, answered from the scenario table. playground.explain and
 * every playground.batchCheck item go through here, so a batch item's verdict
 * is the one the explain page would show for the same request.
 */
function explainRequest(req) {
  const scenario = findExplainScenario(req)
  if (scenario) return projectExplanation(req, scenario.lanes(req), scenario.evalTimeNs)
  const abac = inSandbox(req.namespacePath) ? sandboxAbac(req) : ABAC_NO_MATCH
  return projectExplanation(req, { rbac: RBAC_NO_ROLES(req), rebac: REBAC_NO_RELATION(req), abac }, 96_000)
}

// ---------------------------------------------------------------------------
// subjects.detail
//
// handlers_subjects.go: what one subject can do at a namespace, and why. The
// Go handler checks read on warden:role, warden:relation and warden:policy
// before it returns those sections, and names a section it leaves empty in
// withheld. The fixture viewer holds every grant, so nothing is withheld here.
// Recent checks are not part of the reply: the page reads them through
// checkLogs.list. The subject kind is never validated (the check log and the stores accept any
// string), and it always matches exactly. The Go stores read an empty kind as
// "any kind" in their filters, so the handler pages past every other kind to
// keep only rows whose kind is exactly "". Matching exactly here gives the
// same rows without the paging.
// ---------------------------------------------------------------------------

// How many assignments and relations the view returns. The Go handler asks the
// store for one more, so a full page proves there is more.
const SUBJECT_LIST_CAP = 200

/**
 * SubjectRoles: the roles assigned at the namespace or an ancestor (expired
 * rows and resource-scoped rows excluded), then every parent reached through
 * parentSlug, looked up in the child's own namespace. Breadth first and
 * deduplicated by id, the order resolveInheritedRoleObjects gives. direct
 * keeps repeats, as the store does: it only decides each role's via.
 */
function resolveSubjectRoles(kind, subjectId, namespacePath, nowMs) {
  const scope = new Set(ancestorNamespaces(namespacePath))
  const direct = []
  for (const a of warden.assignments) {
    if (a.subjectKind !== kind || a.subjectId !== subjectId || a.resourceType) continue
    if (!scope.has(a.namespacePath) || !isLive(a, nowMs)) continue
    const r = warden.roles.find((x) => x.id === a.roleId)
    if (r) direct.push(r)
  }
  const seen = new Set()
  const all = []
  let level = direct
  for (let depth = 0; level.length > 0 && depth <= 20; depth++) {
    const next = []
    for (const r of level) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      all.push(r)
      if (!r.parentSlug) continue
      const parent = warden.roles.find((x) => x.namespacePath === r.namespacePath && x.slug === r.parentSlug)
      if (parent && !seen.has(parent.id)) next.push(parent)
    }
    level = next
  }
  return { direct, all }
}

/** projectSubjectRoles: one entry per resolved role, in resolution order. */
function projectSubjectRoles(direct, all) {
  const assigned = new Set(direct.map((r) => r.id))
  return all.map((r) => {
    const names = warden.grants.filter((g) => g.roleId === r.id)
    const permissions = warden.permissions
      .filter((p) => names.some((g) => g.name === p.name && g.namespacePath === p.namespacePath))
      .map((p) => ({ name: p.name, resource: p.resource, action: p.action }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      namespacePath: r.namespacePath,
      via: assigned.has(r.id) ? "assigned" : "inherited",
      inheritedBy: all
        .filter((c) => c.parentSlug === r.slug && c.namespacePath === r.namespacePath)
        .map((c) => c.slug)
        .sort(),
      permissions,
    }
  })
}

/**
 * subjectPolicySelection: how the first agreeing matcher selects the subject,
 * by its most specific field. An empty list, or an empty matcher, is everyone.
 */
function subjectPolicySelection(p, kind, subjectId, roleSlugs) {
  for (const sm of p.subjects) {
    if (sm.kind && sm.kind !== kind) continue
    if (sm.id && sm.id !== subjectId) continue
    if (sm.role && !roleSlugs.includes(sm.role)) continue
    if (sm.role) return "role:" + sm.role
    if (sm.id) return "id"
    if (sm.kind) return "kind"
    return "everyone"
  }
  return "everyone"
}

/** PolicySelectsSubject: no matchers select everyone, else any agreeing matcher. */
function policySelectsSubject(p, kind, subjectId, roleSlugs) {
  if (p.subjects.length === 0) return true
  return p.subjects.some(
    (sm) => (!sm.kind || sm.kind === kind) && (!sm.id || sm.id === subjectId) && (!sm.role || roleSlugs.includes(sm.role))
  )
}

/** EffectiveAt: active, not before the window opens, not after it closes. */
function policyEffectiveAt(p, atNs) {
  if (!p.isActive) return false
  if (p.notBefore !== null && atNs < p.notBefore) return false
  if (p.notAfter !== null && atNs > p.notAfter) return false
  return true
}

/** namespaceField: a malformed namespace, with the field named. */
function namespaceField(path) {
  try {
    validateNamespace(path)
  } catch (err) {
    if (err instanceof WardenFixtureError && err.code === "BAD_REQUEST") throw badRequest("namespacePath: " + err.message)
    throw err
  }
}

function subjectsDetail(params) {
  const S = "SubjectDetailInput"
  const kind = decodeString(params?.subjectKind, S, "subjectKind")
  const subjectId = decodeString(params?.subjectId, S, "subjectId")
  const namespacePath = decodeString(params?.namespacePath, S, "namespacePath")
  if (subjectId === "") throw badRequest("subjectId is required: name the subject to look up")
  namespaceField(namespacePath)

  const nowMs = Date.now()
  const { direct, all } = resolveSubjectRoles(kind, subjectId, namespacePath, nowMs)
  const roles = projectSubjectRoles(direct, all)
  const slugs = all.map((r) => r.slug)

  // Every namespace, not the one asked about: the roles above are what
  // resolves here, and this is where each came from and what else is held.
  let rows = warden.assignments
    .filter((a) => a.subjectKind === kind && a.subjectId === subjectId)
    .sort(byCreated)
    .slice(0, SUBJECT_LIST_CAP + 1)
  const assignmentsTruncated = rows.length > SUBJECT_LIST_CAP
  if (assignmentsTruncated) rows = rows.slice(0, SUBJECT_LIST_CAP)
  const horizonMs = nowMs + DEFAULT_EXPIRING_HOURS * 3600_000
  const assignments = rows.map((a) => {
    const r = warden.roles.find((x) => x.id === a.roleId)
    const expired = !isLive(a, nowMs)
    const out = { id: a.id, namespacePath: a.namespacePath, roleId: a.roleId, roleSlug: r?.slug ?? "" }
    if (a.resourceType) out.resourceType = a.resourceType
    if (a.resourceId) out.resourceId = a.resourceId
    let expiringSoon = false
    if (a.expiresAt) {
      out.expiresAt = rfc3339(a.expiresAt)
      expiringSoon = !expired && Date.parse(a.expiresAt) <= horizonMs
    }
    out.expired = expired
    out.expiringSoon = expiringSoon
    return out
  })

  let tuples = warden.relations
    .filter((t) => t.subjectType === kind && t.subjectId === subjectId)
    .sort(byCreated)
    .slice(0, SUBJECT_LIST_CAP + 1)
  const relationsTruncated = tuples.length > SUBJECT_LIST_CAP
  if (relationsTruncated) tuples = tuples.slice(0, SUBJECT_LIST_CAP)
  // subjectRelation is omitempty: set only on a userset grant (group:eng#member).
  const relations = tuples.map((t) => {
    const out = {
      id: t.id,
      namespacePath: t.namespacePath,
      objectType: t.objectType,
      objectId: t.objectId,
      relation: t.relation,
    }
    if (t.subjectRelation) out.subjectRelation = t.subjectRelation
    return out
  })

  // A candidate is stored at this namespace or an ancestor, in effect right
  // now, and selects a subject holding these roles. Selecting is not
  // applying: its actions, resources and conditions still decide each check.
  const scope = new Set(ancestorNamespaces(namespacePath))
  const atNs = nowNs()
  const policies = warden.policies
    .filter((p) => p.isActive && scope.has(p.namespacePath))
    .sort(compareByPriority)
    .filter((p) => policyEffectiveAt(p, atNs) && policySelectsSubject(p, kind, subjectId, slugs))
    .map((p) => ({
      id: p.id,
      name: p.name,
      effect: p.effect,
      priority: p.priority,
      namespacePath: p.namespacePath,
      selectedBy: subjectPolicySelection(p, kind, subjectId, slugs),
    }))

  // The fixture grants the viewer every section's read, so nothing is
  // withheld. The Go handler lists "roles", "relations" or "policies" here
  // for each grant the viewer lacks.
  const withheld = []

  return { roles, assignments, assignmentsTruncated, relations, relationsTruncated, policies, withheld }
}

// ---------------------------------------------------------------------------
// playground.batchCheck
//
// handlers_playground.go: several dry-run checks at one namespace. Everything
// is validated before the first item runs, so a refused batch ran nothing.
// ---------------------------------------------------------------------------

/** warden.Config documents "Defaults to 100" for a MaxBatchChecks of 0. */
const DEFAULT_MAX_BATCH_CHECKS = 100

function playgroundBatchCheck(params) {
  const S = "PlaygroundBatchInput"
  const namespacePath = decodeString(params?.namespacePath, S, "namespacePath")
  let raw = params?.items
  if (raw === undefined || raw === null) raw = []
  if (!Array.isArray(raw)) throw decodeFail(S, "items", raw, "[]contract.PlaygroundBatchItem")
  const items = raw.map((it) => {
    if (it === null || it === undefined) return { subjectKind: "", subjectId: "", action: "", resourceType: "", resourceId: "" }
    if (typeof it !== "object" || Array.isArray(it)) throw decodeFail(S, "items", it, "contract.PlaygroundBatchItem")
    return {
      subjectKind: decodeString(it.subjectKind, S, "items.subjectKind"),
      subjectId: decodeString(it.subjectId, S, "items.subjectId"),
      action: decodeString(it.action, S, "items.action"),
      resourceType: decodeString(it.resourceType, S, "items.resourceType"),
      resourceId: decodeString(it.resourceId, S, "items.resourceId"),
    }
  })

  if (items.length === 0) throw badRequest("items is required")
  const limit = warden.config.maxBatchChecks > 0 ? warden.config.maxBatchChecks : DEFAULT_MAX_BATCH_CHECKS
  if (items.length > limit) throw badRequest(`a batch holds at most ${limit} checks`)
  // The subject kind is not validated, for the reason explain does not: a
  // logged check under any kind must be replayable.
  items.forEach((it, i) => {
    if (it.subjectId === "") throw badRequest(`items[${i}].subjectId is required`)
    if (it.action === "") throw badRequest(`items[${i}].action is required`)
    if (it.resourceType === "") throw badRequest(`items[${i}].resourceType is required`)
  })
  validateNamespace(namespacePath)

  // Nothing here writes: no check log row, no cache, no state change.
  return {
    results: items.map((it) => {
      const ex = explainRequest({ ...it, namespacePath, context: {}, subjectAttributes: {}, resourceAttributes: {} })
      const out = { decision: ex.decision, allowed: ex.allowed }
      if (ex.reason) out.reason = ex.reason
      if (ex.error) out.error = ex.error
      return out
    }),
  }
}

// ---------------------------------------------------------------------------
// schema.export, schema.plan and schema.apply
//
// handlers_schema.go is the authority for the wire shapes, the refusals and
// their order, and planDigest. The fixture cannot run warden's dsl package, so
// this section is a port of the parts of it the three intents touch: the
// formatter (dsl/format.go, for export), the lexer and parser (dsl/lexer.go
// and parser.go, reusing lexExpression above), the resolver (resolver.go) and
// the applier's comparison and write order (applier.go), with the system-entity
// refusals the contract always turns on (ApplyOptions.ProtectSystem). It works on fields,
// not on text: a submitted declaration is compared with the stored row the way
// the applier compares them, so an edit that only reflows the source plans as
// nothing, and a `~` line names the fields that changed, as in Go.
//
// Where the fixture differs from Go, on purpose:
//
//   - Grants. The Go handlers refuse PERMISSION_DENIED when the caller lacks a
//     read (export, plan) or manage (apply) grant on any of warden:role,
//     warden:permission, warden:policy, warden:resourcetype and
//     warden:relation, in that order, and that check comes first. The fixture
//     viewer holds every grant, so the check never refuses and is not
//     modelled. The order of the refusals that remain is the Go order: input
//     decoding, then source diagnostics, then the digest.
//   - Condition operators are Go's: one the language does not know is refused
//     (`expected condition operator, got IDENT "..."`). So the export of a
//     store that holds one (the seeded fuzzy-network-allow in the root
//     namespace, which uses "approximately") is source the real server cannot
//     plan either, and a plan of the whole export reports that parse error.
//     Moving the specimen to another namespace would not change that: an
//     export with no prefix holds every namespace, sandbox included.
//   - Failing part way. Go answers INTERNAL "the apply stopped part way: ..."
//     when a write fails after the dry run. Nothing in memory fails, so a
//     source that contains SCHEMA_FAIL_MARKER (for example in a comment) makes
//     the write phase stop after resource types and permissions have been
//     written, with the same answer. Writes before the stop stay.
//   - diverged is computed as Go computes it (the digest of what was written
//     against the digest that was approved). State cannot change between the
//     two steps in a single-threaded fixture, so it is always false: a
//     repeated relation line is refused by the resolver, and a grant whose
//     permission the same apply prunes is left out of the role's grants
//     before they are compared.
//   - Integers of 2^53 or more are refused with a diagnostic, where Go's Atoi
//     takes them up to 2^63-1. A JS number cannot hold them, and a BigInt
//     would have to run through every projection of priority, maxMembers and
//     condition values (JSON.stringify refuses one), so the refusal stays
//     local to the parser.
//
// CONFLICT, INTERNAL and the other codes below are set on the thrown object,
// but server.mjs maps any error that is not its own FixtureError class to
// 400/BAD_REQUEST on the wire (see the note on WardenFixtureError), so a
// browser sees the message, not the code.
// ---------------------------------------------------------------------------

/** A source that contains this text makes schema.apply fail part way. See above. */
const SCHEMA_FAIL_MARKER = "fixture:fail-apply"

/** The id the applier stamps on rows it writes (declarativeActor.ID). */
const DECLARATIVE_ACTOR = "system"

const INT64_MAX = 2n ** 63n - 1n

const SCHEMA_KEYWORDS = new Set([...DSL_KEYWORDS, "true", "false"])

const cmpString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const schemaKey = (ns, name) => ns + "\0" + name

// ---- formatting (dsl/format.go) --------------------------------------------

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** quoteString: only the escapes the lexer reads. */
function schemaQuote(s) {
  let out = '"'
  for (const ch of s) {
    if (ch === "\\") out += "\\\\"
    else if (ch === '"') out += '\\"'
    else if (ch === "\n") out += "\\n"
    else if (ch === "\t") out += "\\t"
    else if (ch === "\r") out += "\\r"
    else out += ch
  }
  return out + '"'
}

/** formatName: bare when the lexer reads it back as the same identifier. */
function schemaName(s) {
  return BARE_NAME.test(s) && !SCHEMA_KEYWORDS.has(s) ? s : schemaQuote(s)
}

function schemaParent(parent) {
  if (parent.startsWith("/")) {
    const segs = parent.slice(1).split("/")
    if (segs.every((seg) => schemaName(seg) === seg)) return parent
  }
  return schemaName(parent)
}

/** formatField: a dotted path of bare words is written bare, anything else quoted. */
function schemaField(field) {
  const segs = field.split(".")
  for (let i = 0; i < segs.length; i++) {
    if (!BARE_NAME.test(segs[i])) return schemaQuote(field)
    if (i === 0 && (segs[i] === "all_of" || segs[i] === "any_of")) return schemaQuote(field)
  }
  return field
}

const CANONICAL_OPS = {
  eq: "==", neq: "!=", gt: ">", lt: "<", gte: ">=", lte: "<=", regex: "=~", not_in: "not in", not_exists: "not exists",
}
const canonicalOp = (op) => CANONICAL_OPS[op] ?? op

/** Numbers in plain decimal, never an exponent, which the lexer does not read. */
function plainDecimal(n) {
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? String(n) : BigInt(n).toString()
  const s = String(n)
  return /e/i.test(s) ? n.toFixed(20).replace(/0+$/, "") : s
}

function schemaLiteral(v) {
  if (typeof v === "string") return schemaQuote(v)
  if (typeof v === "boolean") return String(v)
  if (typeof v === "number") return plainDecimal(v)
  if (Array.isArray(v)) return "[" + v.map(schemaLiteral).join(", ") + "]"
  return schemaQuote(goSprint(v))
}

/** time.RFC3339Nano in UTC: the fraction is written only when there is one, without trailing zeros. */
function formatRFC3339Nano(ns) {
  let seconds = ns / 1_000_000_000n
  let nanos = ns % 1_000_000_000n
  if (nanos < 0n) {
    seconds -= 1n
    nanos += 1_000_000_000n
  }
  const whole = new Date(Number(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "")
  const frac = nanos.toString().padStart(9, "0").replace(/0+$/, "")
  return whole + (frac ? "." + frac : "") + "Z"
}

/** FormatExpr: an expression in canonical text, parentheses only where precedence needs them. */
function formatExpr(e) {
  switch (e.type) {
    case "ref": return e.name
    case "traverse": return e.steps.join("->")
    case "or": return formatExprPrec(e.left, 0) + " or " + formatExprPrec(e.right, 0)
    case "and": return formatExprPrec(e.left, 1) + " and " + formatExprPrec(e.right, 1)
    case "not": return "not " + formatExprPrec(e.inner, 2)
    default: return ""
  }
}
function formatExprPrec(e, ctx) {
  if (e.type === "or") return ctx > 0 ? "(" + formatExpr(e) + ")" : formatExpr(e)
  if (e.type === "and") return ctx > 1 ? "(" + formatExpr(e) + ")" : formatExpr(e)
  return formatExpr(e)
}

/** The expression text as FormatExpr writes it, or the text unchanged when it does not parse. */
function canonicalExpr(src) {
  const { expr, diags } = compileExpression(src)
  return diags.length > 0 ? src : formatExpr(expr)
}

class SchemaWriter {
  constructor() {
    this.lines = []
    this.depth = 0
  }
  line(text) {
    this.lines.push("    ".repeat(this.depth) + text)
  }
  blank() {
    this.lines.push("")
  }
  /** Inline up to three items; otherwise one per line with a trailing comma, a level in from the line it opens on. */
  list(items) {
    if (items.length === 0) return "[]"
    if (items.length <= 3) return "[" + items.join(", ") + "]"
    const inner = "    ".repeat(this.depth + 1)
    return "[\n" + items.map((it) => inner + it + ",\n").join("") + "    ".repeat(this.depth) + "]"
  }
  strings(items) {
    return this.list(items.map(schemaQuote))
  }
  /** One matcher is written inline, more are one per line. */
  subjects(list) {
    const items = list.map((m) => {
      const fields = []
      if (m.kind) fields.push("kind = " + schemaQuote(m.kind))
      if (m.id) fields.push("id = " + schemaQuote(m.id))
      if (m.role) fields.push("role = " + schemaQuote(m.role))
      return fields.length === 0 ? "{}" : "{ " + fields.join(", ") + " }"
    })
    if (items.length === 1) return "[" + items[0] + "]"
    const inner = "    ".repeat(this.depth + 1)
    return "[\n" + items.map((it) => inner + it + ",\n").join("") + "    ".repeat(this.depth) + "]"
  }
  text() {
    return this.lines.join("\n") + "\n"
  }
}

function writeResourceType(w, rt) {
  w.line(`resource ${schemaName(rt.name)} {`)
  w.depth++
  if (rt.description) w.line(`description = ${schemaQuote(rt.description)}`)
  for (const rel of rt.relations) {
    const subjects = rel.allowedSubjects.map((s) => (s.relation === "" ? schemaName(s.type) : schemaName(s.type) + "#" + schemaName(s.relation)))
    w.line(subjects.length === 0 ? `relation ${schemaName(rel.name)}:` : `relation ${schemaName(rel.name)}: ${subjects.join(" | ")}`)
  }
  if (rt.relations.length > 0 && rt.permissions.length > 0) w.blank()
  for (const perm of rt.permissions) w.line(`permission ${schemaName(perm.name)} = ${formatExpr(perm.expr)}`)
  w.depth--
  w.line("}")
}

function writePermission(w, p) {
  if (!p.description && !p.isSystem) {
    w.line(`permission ${schemaQuote(p.name)} (${schemaName(p.resource)} : ${schemaName(p.action)})`)
    return
  }
  w.line(`permission ${schemaQuote(p.name)} {`)
  w.depth++
  w.line(`resource = ${schemaName(p.resource)}`)
  w.line(`action = ${schemaName(p.action)}`)
  if (p.description) w.line(`description = ${schemaQuote(p.description)}`)
  if (p.isSystem) w.line("is_system = true")
  w.depth--
  w.line("}")
}

function writeRole(w, r) {
  w.line(r.parent ? `role ${schemaName(r.slug)} : ${schemaParent(r.parent)} {` : `role ${schemaName(r.slug)} {`)
  w.depth++
  if (r.name) w.line(`name = ${schemaQuote(r.name)}`)
  if (r.description) w.line(`description = ${schemaQuote(r.description)}`)
  if (r.isSystem) w.line("is_system = true")
  if (r.isDefault) w.line("is_default = true")
  if (r.maxMembers !== 0) w.line(`max_members = ${r.maxMembers}`)
  if (r.grantsSet || r.grants.length > 0 || r.qualifiedGrants.length > 0) {
    const items = [
      ...r.grants.map(schemaQuote),
      ...r.qualifiedGrants.map((g) => `{ namespace = ${schemaQuote(g.ns)}, name = ${schemaQuote(g.name)} }`),
    ]
    w.line(`grants ${r.grantsAppend ? "+=" : "="} ${w.list(items)}`)
  }
  w.depth--
  w.line("}")
}

function writePolicy(w, p) {
  w.line(`policy ${schemaQuote(p.name)} {`)
  w.depth++
  if (p.description) w.line(`description = ${schemaQuote(p.description)}`)
  if (p.effect) w.line(`effect = ${p.effect}`)
  if (p.priority !== 0) w.line(`priority = ${p.priority}`)
  w.line(`active = ${p.active}`)
  if (p.notBefore !== null) w.line(`not_before = ${schemaQuote(formatRFC3339Nano(p.notBefore))}`)
  if (p.notAfter !== null) w.line(`not_after = ${schemaQuote(formatRFC3339Nano(p.notAfter))}`)
  if (p.obligations.length > 0) w.line(`obligations = ${w.strings(p.obligations)}`)
  if (p.subjects.length > 0) w.line(`subjects = ${w.subjects(p.subjects)}`)
  if (p.actions.length > 0) w.line(`actions = ${w.strings(p.actions)}`)
  if (p.resources.length > 0) w.line(`resources = ${w.strings(p.resources)}`)
  if (p.conditions.length > 0) {
    w.line("when {")
    w.depth++
    for (const c of p.conditions) {
      const head = `${schemaField(c.field)} ${canonicalOp(c.operator)}`
      w.line(c.value === undefined || c.value === null ? head : `${head} ${schemaLiteral(c.value)}`)
    }
    w.depth--
    w.line("}")
  }
  w.depth--
  w.line("}")
}

const TUPLE_KEY = (t) => [t.objectType, t.objectId, t.relation, t.subjectType, t.subjectId, t.subjectRelation]

/** A relation tuple as its source line writes it, after the `relation` keyword (dsl relationText). */
function relationText(r) {
  let subject = schemaName(r.subjectType) + ":" + schemaName(r.subjectId)
  if (r.subjectRelation) subject += "#" + schemaName(r.subjectRelation)
  return `${schemaName(r.objectType)}:${schemaName(r.objectId)} ${schemaName(r.relation)} = ${subject}`
}

function writeRelation(w, r) {
  w.line(`relation ${relationText(r)}`)
}

/** One namespace's declarations in section order, a blank line between sections. Reports whether it wrote anything. */
function writeSections(w, g) {
  const byName = (key) => (a, b) => cmpString(a[key], b[key])
  const sections = [
    [g.resourceTypes.sort(byName("name")), writeResourceType, true],
    [g.permissions.sort(byName("name")), writePermission, false],
    [g.roles.sort(byName("slug")), writeRole, true],
    [g.policies.sort(byName("name")), writePolicy, true],
    [
      g.relations.sort((a, b) => {
        const ka = TUPLE_KEY(a)
        const kb = TUPLE_KEY(b)
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return cmpString(ka[i], kb[i])
        return 0
      }),
      writeRelation,
      false,
    ],
  ]
  let first = true
  for (const [rows, write, spaced] of sections) {
    if (rows.length === 0) continue
    if (!first) w.blank()
    first = false
    rows.forEach((row, i) => {
      if (spaced && i > 0) w.blank()
      write(w, row)
    })
  }
  return !first
}

/** dsl.Format: the header, the tenant root's declarations, then one flat `namespace` block per path, sorted. */
function formatSchema(tenant, groups) {
  const w = new SchemaWriter()
  w.line("warden config 1")
  if (tenant) w.line(`tenant ${schemaName(tenant)}`)
  w.blank()
  let wrote = false
  if (groups.has("")) wrote = writeSections(w, groups.get(""))
  for (const path of [...groups.keys()].filter((p) => p !== "").sort(cmpString)) {
    if (wrote) w.blank()
    wrote = true
    w.line(`namespace ${schemaQuote(path)} {`)
    w.depth++
    writeSections(w, groups.get(path))
    w.depth--
    w.line("}")
  }
  return w.text()
}

// ---- export: the seed as declarations (dsl.BuildProgram) --------------------

function emptyGroup() {
  return { resourceTypes: [], permissions: [], roles: [], policies: [], relations: [] }
}

/** grantIsPlain: a bare name reaches the permission from the role's namespace, or from the root unless a same-named one shadows it. */
function grantIsPlain(roleNs, perm) {
  if (perm.namespacePath === roleNs) return true
  if (perm.namespacePath !== "") return false
  return !warden.permissions.some((p) => p.namespacePath === roleNs && p.name === perm.name)
}

function exportDecls(prefix) {
  const matches = (ns) => prefix === "" || ns === prefix || ns.startsWith(prefix + "/")
  const groups = new Map()
  const group = (ns) => {
    if (!groups.has(ns)) groups.set(ns, emptyGroup())
    return groups.get(ns)
  }

  for (const rt of warden.resourceTypes) {
    if (!matches(rt.namespacePath)) continue
    group(rt.namespacePath).resourceTypes.push({
      name: rt.name,
      description: rt.description ?? "",
      relations: rt.relations.map((d) => ({
        name: d.name,
        allowedSubjects: d.allowedSubjects.map((s) => {
          const i = s.indexOf("#")
          return i < 0 ? { type: s, relation: "" } : { type: s.slice(0, i), relation: s.slice(i + 1) }
        }),
      })),
      permissions: rt.permissions.map((d) => {
        const { expr, diags } = compileExpression(d.expression)
        // The exporter falls back to the stored text as a placeholder reference.
        return { name: d.name, expr: diags.length > 0 ? { type: "ref", name: d.expression } : expr }
      }),
    })
  }
  for (const p of warden.permissions) {
    if (!matches(p.namespacePath)) continue
    group(p.namespacePath).permissions.push({
      name: p.name, resource: p.resource, action: p.action, description: p.description ?? "", isSystem: Boolean(p.isSystem),
    })
  }
  for (const r of warden.roles) {
    if (!matches(r.namespacePath)) continue
    const held = warden.grants
      .filter((g) => g.roleId === r.id)
      .map((g) => warden.permissions.find((p) => p.namespacePath === g.namespacePath && p.name === g.name))
      .filter(Boolean)
    // A role owns its grant set in the export: `grants = []` is written for a
    // role with none, so removing a grant from the source revokes it.
    const plain = held.filter((p) => grantIsPlain(r.namespacePath, p))
    const qualified = held.filter((p) => !grantIsPlain(r.namespacePath, p))
    group(r.namespacePath).roles.push({
      slug: r.slug,
      parent: r.parentSlug ?? "",
      name: r.name,
      description: r.description ?? "",
      isSystem: Boolean(r.isSystem),
      isDefault: Boolean(r.isDefault),
      maxMembers: r.maxMembers ?? 0,
      grantsSet: true,
      grantsAppend: false,
      grants: plain.map((p) => p.name).sort(cmpString),
      qualifiedGrants: qualified
        .map((p) => ({ ns: p.namespacePath, name: p.name }))
        .sort((a, b) => cmpString(a.ns, b.ns) || cmpString(a.name, b.name)),
    })
  }
  for (const p of warden.policies) {
    if (!matches(p.namespacePath)) continue
    group(p.namespacePath).policies.push({
      name: p.name,
      description: p.description ?? "",
      effect: p.effect,
      priority: p.priority,
      active: p.isActive,
      notBefore: p.notBefore ?? null,
      notAfter: p.notAfter ?? null,
      obligations: [...p.obligations],
      subjects: p.subjects.map((s) => ({ kind: s.kind ?? "", id: s.id ?? "", role: s.role ?? "" })),
      actions: [...p.actions],
      resources: [...p.resources],
      conditions: p.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    })
  }
  for (const t of warden.relations) {
    if (!matches(t.namespacePath)) continue
    group(t.namespacePath).relations.push({
      objectType: t.objectType, objectId: t.objectId, relation: t.relation,
      subjectType: t.subjectType, subjectId: t.subjectId, subjectRelation: t.subjectRelation ?? "",
    })
  }
  return groups
}

// ---- parsing (dsl/parser.go) -----------------------------------------------

const joinNs = (parent, child) => (parent === "" ? child : child === "" ? parent : parent + "/" + child)

/**
 * dsl.Parse over lexExpression's tokens. Every diagnostic, and the error
 * recovery that decides which ones follow, is the parser's own, so a bad
 * source shows the editor the same markers. Decls carry a `ns` (the absolute
 * namespace path, stamped by flattening) and a `pos`.
 */
function parseSchemaSource(src) {
  const next = lexExpression(src, { floats: true })
  const errs = []
  let cur = next()
  const advance = () => {
    const prev = cur
    cur = next()
    return prev
  }
  const pos = (t = cur) => ({ line: t.line, col: t.col })
  const errf = (t, message) => errs.push({ line: t.line, col: t.col, message })
  const got = () => `${cur.kind} ${goQuote(cur.value)}`
  const expect = (kind) => {
    if (cur.kind !== kind) {
      errf(cur, `expected ${kind}, got ${got()}`)
      return cur
    }
    return advance()
  }
  const accept = (kind) => {
    if (cur.kind !== kind) return false
    advance()
    return true
  }
  /** A name: a bare identifier or a string literal. null when it is neither, and nothing is consumed. */
  const name = () => {
    if (cur.kind !== "IDENT" && cur.kind !== "STRING") return null
    return advance().value
  }
  const isWord = (t) => t.kind === "IDENT" || (t.kind !== "STRING" && SCHEMA_KEYWORDS.has(t.value))
  const atEnd = (close) => cur.kind === close || cur.kind === "EOF"

  // ---- expressions (Pratt-style: or < and < not < traversal) ----
  function parseExpr() {
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
      const e = parseExpr()
      if (!accept(")")) errf(cur, "expected `)`")
      return e
    }
    if (cur.kind === "IDENT") {
      const at = pos()
      const first = advance().value
      if (cur.kind !== "->") return { type: "ref", name: first, ...at }
      const steps = [first]
      while (accept("->")) {
        if (cur.kind !== "IDENT") {
          errf(cur, "expected identifier after `->`")
          break
        }
        steps.push(advance().value)
      }
      return { type: "traverse", steps, ...at }
    }
    errf(cur, `expected expression, got ${got()}`)
    return { type: "ref", name: "<error>", ...pos() }
  }

  // ---- literals ----
  const startsLiteral = (k) => k === "STRING" || k === "INT" || k === "FLOAT" || k === "BOOL" || k === "[" || k === "-"

  /** An INT with an optional leading `-`, for an integer the store keeps signed. */
  function parseSignedInt(what) {
    const neg = accept("-")
    if (cur.kind !== "INT") {
      errf(cur, `expected an integer after ${what} =, got ${got()}`)
      return null
    }
    const tok = advance()
    const raw = (neg ? "-" : "") + tok.value
    const v = Number(raw)
    if (!Number.isSafeInteger(v)) {
      // Go refuses only beyond int64; a JS number is exact only to 2^53 (see the header note).
      const beyondInt64 = BigInt(raw) > INT64_MAX || BigInt(raw) < -INT64_MAX - 1n
      errf(tok, beyondInt64
        ? `invalid integer ${goQuote(raw)} for ${what}: strconv.Atoi: parsing ${goQuote(raw)}: value out of range`
        : `invalid integer ${goQuote(raw)} for ${what}: the fixture holds integers only below 2^53`)
      return null
    }
    return v
  }
  function parseNumber() {
    const neg = accept("-")
    const tok = cur
    if (tok.kind === "INT" || tok.kind === "FLOAT") {
      advance()
      const n = (neg ? -1 : 1) * Number(tok.value)
      // Go keeps an integer that fits int64 exact and reads a larger one as a float64. A JS number is
      // exact only to 2^53, so the band between would be silently rounded: refuse it (header note).
      if (tok.kind === "INT" && !Number.isSafeInteger(n)) {
        const big = BigInt((neg ? "-" : "") + tok.value)
        if (big <= INT64_MAX && big >= -INT64_MAX - 1n) {
          // The diagnostic is recorded; the rounded number keeps the parse going without cascading noise.
          errf(tok, `invalid integer literal ${goQuote((neg ? "-" : "") + tok.value)}: the fixture holds integers only below 2^53`)
        }
      }
      return n
    }
    errf(tok, `expected a number after \`-\`, got ${tok.kind} ${goQuote(tok.value)}`)
    return undefined
  }
  function parseLiteralValue() {
    switch (cur.kind) {
      case "STRING": return { value: advance().value }
      case "INT":
      case "FLOAT":
      case "-": {
        const v = parseNumber()
        return v === undefined ? null : { value: v }
      }
      case "BOOL": return { value: advance().value === "true" }
      case "[": return parseValueList()
    }
    errf(cur, `expected literal value, got ${got()}`)
    return null
  }
  function parseValueList() {
    if (!accept("[")) {
      errf(cur, "expected `[` to open list")
      return null
    }
    const items = []
    while (!atEnd("]")) {
      if (cur.kind === "[") {
        errf(cur, "a list value cannot hold another list")
        advance()
        continue
      }
      const v = parseLiteralValue()
      if (v === null) {
        advance()
        continue
      }
      items.push(v.value)
      if (!accept(",")) break
    }
    expect("]")
    return { value: items }
  }
  function parseStringList() {
    if (!accept("[")) {
      errf(cur, "expected `[` to open string list")
      return []
    }
    const out = []
    while (!atEnd("]")) {
      if (cur.kind !== "STRING") {
        errf(cur, "expected string literal")
        advance()
        continue
      }
      out.push(advance().value)
      if (!accept(",")) break
    }
    expect("]")
    return out
  }
  /** `{ key = "value", ... }`, every value a string literal, every key one of keys. */
  function parseObject(what, keys) {
    const fields = new Map()
    expect("{")
    while (!atEnd("}")) {
      const keyTok = cur
      if (!isWord(keyTok)) {
        errf(keyTok, `expected a ${what} field (${keys.join(", ")}), got ${keyTok.kind} ${goQuote(keyTok.value)}`)
        advance()
        continue
      }
      advance()
      const known = keys.includes(keyTok.value)
      if (!known) errf(keyTok, `unknown ${what} field ${goQuote(keyTok.value)}: expected ${keys.join(", ")}`)
      if (!accept("=")) errf(cur, `expected \`=\` after ${goQuote(keyTok.value)}`)
      if (cur.kind !== "STRING") {
        errf(cur, `expected a string after ${keyTok.value} =`)
      } else {
        if (fields.has(keyTok.value)) errf(keyTok, `${what} field ${goQuote(keyTok.value)} is given twice`)
        if (known) fields.set(keyTok.value, cur.value)
        advance()
      }
      accept(",")
    }
    expect("}")
    return fields
  }

  // ---- declarations ----
  function parseImport() {
    const at = pos()
    advance()
    if (cur.kind !== "STRING") {
      errf(cur, "expected string after `import`")
      return null
    }
    const d = { path: advance().value, pos: at }
    return d
  }

  function parseRelationDef() {
    const at = pos()
    advance()
    const relName = name()
    if (relName === null) {
      errf(cur, "expected relation name")
      return null
    }
    const def = { name: relName, allowedSubjects: [], pos: at }
    if (!accept(":")) {
      errf(cur, "expected `:` after relation name")
      return null
    }
    // A relation may allow no subject type at all (`relation x:` and nothing after).
    if (cur.kind !== "IDENT" && cur.kind !== "STRING") return def
    for (;;) {
      const type = name()
      if (type === null) {
        errf(cur, "expected subject type identifier")
        return def
      }
      const st = { type, relation: "" }
      if (accept("#")) {
        const rel = name()
        if (rel !== null) st.relation = rel
        else errf(cur, "expected relation name after `#`")
      }
      def.allowedSubjects.push(st)
      if (!accept("|")) break
    }
    return def
  }

  function parseResource() {
    const at = pos()
    advance()
    const rtName = name()
    if (rtName === null) {
      errf(cur, "expected resource type name")
      return null
    }
    const d = { name: rtName, ns: "", description: "", relations: [], permissions: [], pos: at }
    if (!accept("{")) {
      errf(cur, "expected `{` to open resource block")
      return null
    }
    while (!atEnd("}")) {
      switch (cur.kind) {
        case "relation": {
          const rel = parseRelationDef()
          if (rel) d.relations.push(rel)
          break
        }
        case "permission": {
          const pat = pos()
          advance()
          const permName = name()
          if (permName === null) {
            errf(cur, "expected permission name (identifier)")
            break
          }
          const perm = { name: permName, expr: null, pos: pat }
          d.permissions.push(perm)
          if (!accept("=")) {
            errf(cur, "expected `=` after permission name")
            break
          }
          perm.expr = parseExpr()
          break
        }
        case "description":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after description")
          if (cur.kind === "STRING") d.description = advance().value
          else errf(cur, "expected string after description =")
          break
        default:
          errf(cur, `unexpected token ${got()} inside resource block`)
          advance()
      }
    }
    expect("}")
    return d
  }

  function parsePermission() {
    const at = pos()
    advance()
    if (cur.kind !== "STRING") {
      errf(cur, "expected permission name as string literal")
      return null
    }
    const d = { name: cur.value, ns: "", resource: "", action: "", description: "", isSystem: false, pos: at }
    const colon = d.name.indexOf(":")
    if (colon >= 0) {
      d.resource = d.name.slice(0, colon)
      d.action = d.name.slice(colon + 1)
    }
    advance()
    if (cur.kind === "(") {
      advance()
      const res = name()
      if (res !== null) d.resource = res
      else errf(cur, "expected resource type identifier")
      if (!accept(":")) errf(cur, "expected `:` between resource and action")
      const act = name()
      if (act !== null) d.action = act
      else errf(cur, "expected action identifier")
      if (!accept(")")) errf(cur, "expected `)` to close permission shorthand")
    } else if (cur.kind === "{") {
      advance()
      while (!atEnd("}")) {
        switch (cur.kind) {
          case "resource": {
            advance()
            if (!accept("=")) errf(cur, "expected `=` after `resource`")
            const v = name()
            if (v !== null) d.resource = v
            else errf(cur, "expected resource identifier")
            break
          }
          case "IDENT": {
            const key = advance().value
            if (!accept("=")) errf(cur, `expected \`=\` after ${goQuote(key)}`)
            if (key === "action") {
              if (cur.kind === "IDENT" || cur.kind === "STRING") d.action = cur.value
              else errf(cur, "expected action identifier")
              advance()
            } else {
              errf(cur, `unknown permission attribute ${goQuote(key)}`)
              advance()
            }
            break
          }
          case "description":
            advance()
            if (!accept("=")) errf(cur, "expected `=` after description")
            if (cur.kind === "STRING") d.description = advance().value
            break
          case "is_system":
            advance()
            if (!accept("=")) errf(cur, "expected `=` after is_system")
            if (cur.kind === "BOOL") d.isSystem = advance().value === "true"
            break
          default:
            errf(cur, `unexpected token in permission block: ${got()}`)
            advance()
        }
      }
      expect("}")
    }
    return d
  }

  function parseGrantList(d) {
    if (!accept("[")) {
      errf(cur, "expected `[` to open string list")
      return
    }
    while (!atEnd("]")) {
      if (cur.kind === "STRING") {
        d.grants.push(advance().value)
      } else if (cur.kind === "{") {
        const at = pos()
        const fields = parseObject("qualified grant", ["namespace", "name"])
        if (!fields.has("name")) errf(at, "a qualified grant needs a name")
        d.qualifiedGrants.push({ ns: fields.get("namespace") ?? "", name: fields.get("name") ?? "", pos: at })
      } else {
        errf(cur, "expected string literal or a qualified grant `{ namespace = ..., name = ... }`")
        advance()
        continue
      }
      if (!accept(",")) break
    }
    expect("]")
  }

  function parseRole() {
    const at = pos()
    advance()
    const slug = name()
    if (slug === null) {
      errf(cur, "expected role slug")
      return null
    }
    const d = {
      slug, ns: "", parent: "", name: "", description: "", isSystem: false, isDefault: false, maxMembers: 0,
      grants: [], grantsAppend: false, qualifiedGrants: [], grantsSet: false, pos: at,
    }
    // Optional parent: `: <slug>` or `: /seg/seg/.../slug`.
    if (accept(":")) {
      if (cur.kind === "/") {
        let sb = "/"
        advance()
        for (;;) {
          if (cur.kind !== "IDENT") {
            errf(cur, "expected identifier in absolute parent path")
            break
          }
          sb += advance().value
          if (!accept("/")) break
          sb += "/"
        }
        d.parent = sb
      } else if (cur.kind === "IDENT" || cur.kind === "STRING") {
        d.parent = advance().value
      } else {
        errf(cur, "expected parent role slug after `:`")
      }
    }
    if (!accept("{")) {
      errf(cur, "expected `{` to open role block")
      return d
    }
    while (!atEnd("}")) {
      switch (cur.kind) {
        case "name":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after name")
          if (cur.kind === "STRING") d.name = advance().value
          else errf(cur, "expected string after name =")
          break
        case "description":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after description")
          if (cur.kind === "STRING") d.description = advance().value
          break
        case "is_system":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after is_system")
          if (cur.kind === "BOOL") d.isSystem = advance().value === "true"
          break
        case "is_default":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after is_default")
          if (cur.kind === "BOOL") d.isDefault = advance().value === "true"
          break
        case "max_members": {
          advance()
          if (!accept("=")) errf(cur, "expected `=` after max_members")
          const v = parseSignedInt("max_members")
          if (v !== null) d.maxMembers = v
          break
        }
        case "grants":
          advance()
          if (cur.kind === "+=") {
            d.grantsAppend = true
            advance()
          } else if (!accept("=")) {
            errf(cur, "expected `=` or `+=` after grants")
          }
          d.grantsSet = true
          parseGrantList(d)
          break
        default:
          errf(cur, `unexpected token in role block: ${got()}`)
          advance()
      }
    }
    expect("}")
    return d
  }

  function parseSubjectList() {
    if (!accept("[")) {
      errf(cur, "expected `[` to open the subjects list")
      return []
    }
    const out = []
    while (!atEnd("]")) {
      if (cur.kind !== "{") {
        errf(cur, `expected a subject matcher \`{ kind = ..., id = ..., role = ... }\`, got ${got()}`)
        advance()
        continue
      }
      const fields = parseObject("subject matcher", ["kind", "id", "role"])
      out.push({ kind: fields.get("kind") ?? "", id: fields.get("id") ?? "", role: fields.get("role") ?? "" })
      if (!accept(",")) break
    }
    expect("]")
    return out
  }

  function parseFieldPath() {
    if (!isWord(cur)) {
      errf(cur, `expected field path identifier, got ${got()}`)
      return ""
    }
    let out = advance().value
    while (accept(".")) {
      if (isWord(cur)) {
        out += "." + advance().value
      } else if (cur.kind === "[") {
        // .[...] for map access
        advance()
        if (cur.kind === "STRING") {
          out += "[" + goQuote(advance().value) + "]"
        }
        expect("]")
      } else {
        errf(cur, "expected identifier after `.`")
        return out
      }
    }
    return out
  }

  const OPERATORS = {
    "==": "eq", "!=": "neq", in: "in", contains: "contains", starts_with: "starts_with", ends_with: "ends_with",
    ">": "gt", "<": "lt", ">=": "gte", "<=": "lte", exists: "exists", ip_in_cidr: "ip_in_cidr",
    time_after: "time_after", time_before: "time_before", "=~": "regex",
  }
  /** The canonical operator, or null after a diagnostic. */
  function parseOperator() {
    const at = cur
    if (cur.kind === "not") {
      advance()
      if (cur.kind === "in") {
        advance()
        return "not_in"
      }
      if (cur.kind === "exists") {
        advance()
        return "not_exists"
      }
      errf(cur, "expected `in` or `exists` after `not`")
      return null
    }
    if (Object.hasOwn(OPERATORS, cur.kind)) {
      advance()
      return OPERATORS[at.kind]
    }
    errf(at, `expected condition operator, got ${at.kind} ${goQuote(at.value)}`)
    return null
  }

  function parseCondition() {
    const at = pos()
    if (cur.kind === "all_of" || cur.kind === "any_of") {
      const kind = advance().kind
      if (!accept("{")) {
        errf(cur, `expected \`{\` after ${kind}`)
        return null
      }
      const c = { field: "", operator: "", value: undefined, negate: false, allOf: null, anyOf: null, pos: at }
      const inner = []
      while (!atEnd("}")) {
        const child = parseCondition()
        if (child) inner.push(child)
      }
      expect("}")
      if (kind === "all_of") c.allOf = inner
      else c.anyOf = inner
      return c
    }
    // Atomic: field-path operator value [negate]. A field a bare path cannot spell is a string literal.
    let field
    if (cur.kind === "STRING") field = advance().value
    else field = parseFieldPath()
    if (field === "") {
      advance() // ensure progress
      return null
    }
    const opLine = cur.line
    const op = parseOperator()
    if (op === null) return null
    // exists and not_exists take a value only when it starts on the operator's own line.
    let value
    if ((op !== "exists" && op !== "not_exists") || (cur.line === opLine && startsLiteral(cur.kind))) {
      const lit = parseLiteralValue()
      if (lit === null) return null
      value = lit.value
    }
    const c = { field, operator: op, value, negate: false, allOf: null, anyOf: null, pos: at }
    if (accept("negate")) c.negate = true
    return c
  }

  function parseTimeField(label) {
    advance()
    if (!accept("=")) errf(cur, `expected \`=\` after ${label}`)
    if (cur.kind === "STRING") {
      const tok = advance()
      const t = parseGoTime(tok.value)
      if (t === null) {
        errf(tok, `${label} must be RFC3339 timestamp: expected RFC3339 (e.g. "2026-06-01T00:00:00Z"), got ${goQuote(tok.value)}`)
        return null
      }
      return t
    }
    errf(cur, `expected RFC3339 timestamp string after ${label} =`)
    return null
  }

  function parsePolicy() {
    const at = pos()
    advance()
    if (cur.kind !== "STRING") {
      errf(cur, "expected policy name as string literal")
      return null
    }
    const d = {
      name: advance().value, ns: "", description: "", effect: "", priority: 0, active: true, notBefore: null, notAfter: null,
      obligations: [], subjects: [], actions: [], resources: [], conditions: [], pos: at,
    }
    if (!accept("{")) {
      errf(cur, "expected `{` to open policy block")
      return d
    }
    while (!atEnd("}")) {
      switch (cur.kind) {
        case "effect":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after effect")
          if (cur.kind === "allow" || cur.kind === "deny") {
            d.effect = advance().kind
          } else {
            errf(cur, `expected \`allow\` or \`deny\`, got ${got()}`)
            advance()
          }
          break
        case "priority": {
          advance()
          if (!accept("=")) errf(cur, "expected `=` after priority")
          const v = parseSignedInt("priority")
          if (v !== null) d.priority = v
          break
        }
        case "active":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after active")
          if (cur.kind === "BOOL") d.active = advance().value === "true"
          break
        case "subjects":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after subjects")
          d.subjects.push(...parseSubjectList())
          break
        case "actions":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after actions")
          d.actions.push(...parseStringList())
          break
        case "resources":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after resources")
          d.resources.push(...parseStringList())
          break
        case "description":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after description")
          if (cur.kind === "STRING") d.description = advance().value
          break
        case "not_before": {
          const t = parseTimeField("not_before")
          if (t !== null) d.notBefore = t
          break
        }
        case "not_after": {
          const t = parseTimeField("not_after")
          if (t !== null) d.notAfter = t
          break
        }
        case "obligations":
          advance()
          if (!accept("=")) errf(cur, "expected `=` after obligations")
          d.obligations.push(...parseStringList())
          break
        case "when":
          advance()
          if (!accept("{")) {
            errf(cur, "expected `{` after `when`")
            continue
          }
          while (!atEnd("}")) {
            const c = parseCondition()
            if (c) d.conditions.push(c)
          }
          expect("}")
          break
        default:
          errf(cur, `unexpected token in policy block: ${got()}`)
          advance()
      }
    }
    expect("}")
    return d
  }

  function parseTopLevelRelation() {
    const at = pos()
    advance()
    const d = { ns: "", objectType: "", objectId: "", relation: "", subjectType: "", subjectId: "", subjectRelation: "", pos: at }
    const step = (field, what) => {
      const v = name()
      if (v === null) {
        errf(cur, `expected ${what}`)
        return false
      }
      d[field] = v
      return true
    }
    const punct = (kind, what) => {
      if (accept(kind)) return true
      errf(cur, `expected ${what}`)
      return false
    }
    if (!step("objectType", "object type")) return null
    if (!punct(":", "`:` after object type")) return d
    if (!step("objectId", "object id")) return d
    if (!step("relation", "relation name")) return d
    if (!punct("=", "`=` after relation name")) return d
    if (!step("subjectType", "subject type")) return d
    if (!punct(":", "`:` after subject type")) return d
    if (!step("subjectId", "subject id")) return d
    if (accept("#")) {
      const rel = name()
      if (rel !== null) d.subjectRelation = rel
      else errf(cur, "expected relation name after `#`")
    }
    return d
  }

  const newScope = () => ({ namespaces: [], resourceTypes: [], permissions: [], roles: [], policies: [], relations: [] })
  const SCOPE_KEY = {
    resource: ["resourceTypes", parseResource],
    permission: ["permissions", parsePermission],
    role: ["roles", parseRole],
    policy: ["policies", parsePolicy],
    relation: ["relations", parseTopLevelRelation],
  }

  function parseNamespace() {
    const at = pos()
    advance()
    if (cur.kind !== "STRING" && cur.kind !== "IDENT") {
      errf(cur, "expected namespace name as identifier or string literal")
      return null
    }
    const d = { name: advance().value, pos: at, ...newScope() }
    if (!accept("{")) {
      errf(cur, "expected `{` to open namespace block")
      return null
    }
    while (!atEnd("}")) {
      if (cur.kind === "namespace") {
        const child = parseNamespace()
        if (child) d.namespaces.push(child)
      } else if (Object.hasOwn(SCOPE_KEY, cur.kind)) {
        const [key, parse] = SCOPE_KEY[cur.kind]
        const child = parse()
        if (child) d[key].push(child)
      } else {
        errf(cur, `unexpected token ${got()} inside namespace`)
        advance()
      }
    }
    expect("}")
    return d
  }

  /** One top-level declaration. False when nothing was consumed, so the caller skips a token. */
  function parseTopLevel(prog) {
    if (cur.kind === "ILLEGAL") {
      errf(cur, `lexer error: ${cur.value}`)
      advance()
      return true
    }
    if (cur.kind === "import") {
      const d = parseImport()
      if (d) prog.imports.push(d)
      return true
    }
    if (cur.kind === "namespace") {
      const d = parseNamespace()
      if (d) prog.namespaces.push(d)
      return true
    }
    if (Object.hasOwn(SCOPE_KEY, cur.kind)) {
      const [key, parse] = SCOPE_KEY[cur.kind]
      const d = parse()
      if (d) prog[key].push(d)
      return true
    }
    if (cur.kind === "EOF") return false
    errf(cur, `unexpected token ${got()} at top level`)
    return false
  }

  // ---- the program ----
  const prog = { version: 0, tenant: "", app: "", imports: [], headerPos: pos(), ...newScope(), blocks: [], blockAt: [] }
  if (cur.kind !== "warden") {
    errf(cur, "expected `warden config <version>` header")
  } else {
    advance()
    expect("config")
    prog.version = Number.parseInt(expect("INT").value, 10) || 0
  }
  for (;;) {
    if (cur.kind === "tenant") {
      advance()
      const v = name()
      if (v !== null) prog.tenant = v
      else errf(cur, "expected tenant identifier after `tenant`")
    } else if (cur.kind === "app") {
      advance()
      const v = name()
      if (v !== null) prog.app = v
      else errf(cur, "expected app identifier after `app`")
    } else {
      break
    }
  }
  while (cur.kind !== "EOF") {
    if (!parseTopLevel(prog)) advance()
  }

  // flattenNamespaces: stamp the absolute path on every wrapped decl and promote it to the flat lists.
  const flatten = (nsDecl, parent) => {
    const abs = joinNs(parent, nsDecl.name)
    prog.blocks.push(abs)
    prog.blockAt.push({ ns: abs, pos: nsDecl.pos })
    for (const key of ["resourceTypes", "permissions", "roles", "policies", "relations"]) {
      for (const d of nsDecl[key]) {
        d.ns = abs
        prog[key].push(d)
      }
    }
    for (const child of nsDecl.namespaces) flatten(child, abs)
  }
  for (const nsDecl of prog.namespaces) flatten(nsDecl, "")
  return { prog, errs }
}

// ---- resolving (dsl/resolver.go) -------------------------------------------

/** warden.ValidateNamespacePath's message, or "" when the path is valid. */
function namespaceProblem(path) {
  try {
    validateNamespace(path)
    return ""
  } catch (err) {
    return err.message
  }
}

/** Resolve: duplicates, conventions, role parents and cycles, expression names, and conditions the store cannot hold. */
function resolveSchema(prog) {
  const errs = []
  const errf = (at, message) => errs.push({ line: at.line, col: at.col, message })
  const posText = (p) => `schema.warden:${p.line}:${p.col}`
  const rolesByKey = new Map()
  const permsByKey = new Map()
  const policyByKey = new Map()
  const rtsByKey = new Map()

  const index = (list, map, label, nameOf) => {
    for (const d of list) {
      const k = schemaKey(d.ns, nameOf(d))
      if (map.has(k)) errf(d.pos, `${label} ${goQuote(nameOf(d))} already declared at ${posText(map.get(k).pos)}`)
      else map.set(k, d)
    }
  }
  index(prog.roles, rolesByKey, "role", (d) => d.slug)
  index(prog.permissions, permsByKey, "permission", (d) => d.name)
  index(prog.policies, policyByKey, "policy", (d) => d.name)
  index(prog.resourceTypes, rtsByKey, "resource type", (d) => d.name)
  // A tuple is its whole row. The store holds one of each, so a second line
  // for the same tuple could only be a no-op, and a plan would count it as a
  // second write the apply never makes.
  const tuples = new Map()
  for (const t of prog.relations) {
    const k = [t.ns, ...TUPLE_KEY(t)].join("\u0000")
    if (tuples.has(k)) errf(t.pos, `relation ${relationText(t)} already declared at ${posText(tuples.get(k).pos)}`)
    else tuples.set(k, t)
  }

  // checkConventions
  for (const r of prog.roles) {
    if (r.slug === "") errf(r.pos, `role slug ${goQuote(r.slug)} must not be empty`)
    const bad = namespaceProblem(r.ns)
    if (bad) errf(r.pos, bad)
    for (const g of r.qualifiedGrants) {
      if (g.name === "") errf(g.pos, `role ${goQuote(r.slug)} has a qualified grant with no permission name`)
      const gbad = namespaceProblem(g.ns)
      if (gbad) errf(g.pos, gbad)
    }
  }
  for (const p of prog.permissions) {
    if (p.name === "" || p.resource === "" || p.action === "") {
      errf(p.pos, `permission name ${goQuote(p.name)} must be \`<resource>:<action>\`, with a resource and an action that are not empty`)
    }
    const bad = namespaceProblem(p.ns)
    if (bad) errf(p.pos, bad)
  }
  for (const p of prog.policies) {
    if (goTrimSpace(p.name) === "") errf(p.pos, `policy name ${goQuote(p.name)} must not be empty`)
    if (p.effect === "") errf(p.pos, `policy ${goQuote(p.name)} is missing \`effect\``)
    if (p.notBefore !== null && p.notAfter !== null && p.notAfter < p.notBefore) {
      errf(p.pos, `policy ${goQuote(p.name)} has not_after (${formatGoTime(p.notAfter)}) before not_before (${formatGoTime(p.notBefore)})`)
    }
  }
  for (const rt of prog.resourceTypes) {
    if (rt.name === "") errf(rt.pos, `resource type name ${goQuote(rt.name)} must not be empty`)
    const bad = namespaceProblem(rt.ns)
    if (bad) errf(rt.pos, bad)
  }

  // checkRoleParents: a bare slug resolves at the role's namespace and then each ancestor, an absolute path exactly.
  const lookupParent = (role) => {
    if (role.parent.startsWith("/")) {
      const rest = role.parent.slice(1)
      const i = rest.lastIndexOf("/")
      return rolesByKey.get(i < 0 ? schemaKey("", rest) : schemaKey(rest.slice(0, i), rest.slice(i + 1)))
    }
    for (const ns of ancestorNamespaces(role.ns)) {
      const found = rolesByKey.get(schemaKey(ns, role.parent))
      if (found) return found
    }
    return undefined
  }
  for (const role of prog.roles) {
    if (role.parent !== "" && !lookupParent(role)) {
      errf(role.pos, `role ${goQuote(role.slug)} references unknown parent ${goQuote(role.parent)} (in namespace ${goQuote(role.ns)})`)
    }
  }

  // checkCycles
  const state = new Map()
  const dfs = (role, path) => {
    const s = state.get(role)
    if (s === 1) {
      errf(role.pos, `role ${goQuote(role.slug)} is part of a parent cycle: ${[...path, role].map((r) => r.slug).join(" -> ")}`)
      return
    }
    if (s === 2) return
    state.set(role, 1)
    if (role.parent !== "") {
      const parent = lookupParent(role)
      if (parent) dfs(parent, [...path, role])
    }
    state.set(role, 2)
  }
  for (const role of prog.roles) dfs(role, [])

  // checkExpressions: every name resolves to a relation declared on the owning type.
  const checkExpr = (rt, e, targets) => {
    switch (e?.type) {
      case "ref":
        if (!targets.has(e.name)) errf(e, `expression references undeclared relation ${goQuote(e.name)} on resource ${goQuote(rt.name)}`)
        break
      case "traverse": {
        if (e.steps.length < 2) {
          errf(e, "traversal must have at least one `->` hop")
          return
        }
        if (!targets.has(e.steps[0])) {
          errf(e, `traversal starts with undeclared relation ${goQuote(e.steps[0])} on resource ${goQuote(rt.name)}`)
          return
        }
        // Later hops must resolve on the chain's current target type.
        let target = targets.get(e.steps[0])
        for (let i = 1; i < e.steps.length; i++) {
          const next = prog.resourceTypes.find((x) => x.name === target)
          if (!next) {
            errf(e, `traversal hops into undeclared resource type ${goQuote(target)}`)
            return
          }
          const step = e.steps[i]
          const rel = next.relations.find((r) => r.name === step)
          if (!rel && !next.permissions.some((p) => p.name === step)) {
            errf(e, `traversal step ${goQuote(step)} is not a relation or permission on resource ${goQuote(next.name)}`)
            return
          }
          target = rel ? (rel.allowedSubjects[0]?.type ?? "") : ""
        }
        break
      }
      case "or":
      case "and":
        checkExpr(rt, e.left, targets)
        checkExpr(rt, e.right, targets)
        break
      case "not":
        checkExpr(rt, e.inner, targets)
        break
    }
  }
  for (const rt of prog.resourceTypes) {
    const targets = new Map(rt.relations.map((rel) => [rel.name, rel.allowedSubjects[0]?.type ?? ""]))
    for (const perm of rt.permissions) checkExpr(rt, perm.expr, targets)
  }

  // checkConditions: only shapes that flatten to a list that must all hold.
  const checkCondition = (pol, c) => {
    if (c.anyOf !== null) {
      if (c.anyOf.length === 0) {
        errf(c.pos, `policy ${goQuote(pol.name)}: an empty any_of can never hold, and a stored policy cannot say that (its conditions are a list that must all hold)`)
      } else if (c.anyOf.length === 1) {
        checkCondition(pol, c.anyOf[0])
      } else {
        errf(c.pos, `policy ${goQuote(pol.name)}: any_of with ${c.anyOf.length} conditions cannot be stored: a stored policy's conditions must all hold, and it has no OR. Split it into one policy per alternative`)
      }
    } else if (c.allOf !== null) {
      for (const inner of c.allOf) checkCondition(pol, inner)
    } else if (c.negate) {
      errf(c.pos, `policy ${goQuote(pol.name)}: \`negate\` cannot be stored: a stored condition has no negation, so it would mean the opposite. Use the opposite operator (!=, not in, not exists) instead`)
    }
  }
  for (const pol of prog.policies) for (const c of pol.conditions) checkCondition(pol, c)
  return errs
}

/**
 * checkSource: syntax first (a parse failure stops there, the program is
 * partial), then what the dashboard refuses outright, reported together in
 * position order, then the resolver. Plan and apply both call it.
 */
function checkSchemaSource(src) {
  const { prog, errs } = parseSchemaSource(src)
  if (errs.length > 0) return { diags: errs }

  const refused = []
  if (prog.imports.length > 0) {
    const { line, col } = prog.imports[0].pos
    refused.push({ line, col, message: "imports are not supported here: paste the imported source instead" })
  }
  // Program keeps no position for the tenant or app lines, so both report the
  // header's. A program with no header position reports 1:1.
  const line = prog.headerPos.line < 1 ? 1 : prog.headerPos.line
  const col = prog.headerPos.line < 1 ? 1 : prog.headerPos.col
  if (prog.tenant !== "" && prog.tenant !== WARDEN_TENANT) {
    refused.push({ line, col, message: `this source names tenant ${goQuote(prog.tenant)}; the dashboard applies to your tenant only` })
  }
  // The dashboard sets no app, and Apply would otherwise stamp the source's onto every entity it writes.
  if (prog.app !== "") {
    refused.push({ line, col, message: `this source names app ${goQuote(prog.app)}; the dashboard does not set an app: remove the declaration` })
  }
  if (refused.length > 0) return { diags: refused.sort((a, b) => a.line - b.line || a.col - b.col) }

  const resolved = resolveSchema(prog)
  return resolved.length > 0 ? { diags: resolved } : { prog }
}

// ---- applying (dsl/applier.go) ---------------------------------------------

const updateLine = (kind, ns, name, fields) => `~ ${kind}/${ns}/${name} (${fields.join(", ")})`

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/** Numbers compare as numbers and a list of strings equals the same list, however the store typed them. */
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function grantsManaged(r) {
  return r.grantsSet || r.grantsAppend || r.grants.length > 0 || r.qualifiedGrants.length > 0
}

const parentSlugForStorage = (parent) => (parent.startsWith("/") ? parent.slice(parent.lastIndexOf("/") + 1) : parent)

/** topoSortRoles: a role after its parent when the parent is in the same source. */
function topoSortRoles(roles) {
  const byKey = new Map(roles.map((r) => [schemaKey(r.ns, r.slug), r]))
  const parentInSet = (r) => {
    if (r.parent.startsWith("/")) {
      const rest = r.parent.slice(1)
      const i = rest.lastIndexOf("/")
      return byKey.get(i < 0 ? schemaKey("", rest) : schemaKey(rest.slice(0, i), rest.slice(i + 1)))
    }
    for (const ns of ancestorNamespaces(r.ns)) {
      const found = byKey.get(schemaKey(ns, r.parent))
      if (found) return found
    }
    return undefined
  }
  const seen = new Set()
  const out = []
  const visit = (r) => {
    if (seen.has(r)) return
    seen.add(r)
    if (r.parent !== "") {
      const p = parentInSet(r)
      if (p) visit(p)
    }
    out.push(r)
  }
  roles.forEach(visit)
  return out
}

/** flattenConditions: atomic conditions, `all_of` at any depth, and an `any_of` of exactly one. */
function flattenConditions(list) {
  const out = []
  const walk = (c) => {
    if (c.anyOf !== null) {
      if (c.anyOf.length === 1) walk(c.anyOf[0])
    } else if (c.allOf !== null) {
      c.allOf.forEach(walk)
    } else if (c.field !== "") {
      // exists and not_exists may carry no value, and a stored one then has no value key.
      out.push(c.value === undefined ? { field: c.field, operator: c.operator } : { field: c.field, operator: c.operator, value: c.value })
    }
  }
  list.forEach(walk)
  return out
}

/**
 * dsl.Apply over the seed arrays. write=false is the dry run: the same walk,
 * the same lines, nothing stored. Returns { diags } when a grant names no
 * permission (checked before anything is written, as checkGrants does), else
 * the lines. A write stops at SCHEMA_FAIL_MARKER, after resource types and
 * permissions, and throws: what was written stays.
 */
function runSchemaApplier(prog, prune, write, source) {
  const res = { created: [], updated: [], deleted: [], noOps: 0 }
  const covered = new Set([...prog.resourceTypes, ...prog.permissions, ...prog.roles, ...prog.policies, ...prog.relations].map((d) => d.ns))
  for (const path of prog.blocks) covered.add(path)
  const covers = (ns) => covered.has(ns)
  const declaredPerms = new Set(prog.permissions.map((p) => schemaKey(p.ns, p.name)))
  const now = () => new Date().toISOString()

  // A permission will exist once this apply has written its permissions: the
  // source declares it, or the store holds it and prune will not delete it.
  // Whether this apply deletes the permission ns/name if the store holds it.
  const prunes = (ns, name) => prune && covers(ns) && !declaredPerms.has(schemaKey(ns, name))
  const permExists = (ns, name) => {
    if (declaredPerms.has(schemaKey(ns, name))) return true
    if (prunes(ns, name)) return false
    return warden.permissions.some((p) => p.namespacePath === ns && p.name === name)
  }
  // A bare grant is looked up in the role's namespace, then at the root.
  const resolveGrant = (roleNs, name) => {
    if (permExists(roleNs, name)) return { ns: roleNs, name }
    if (roleNs !== "" && permExists("", name)) return { ns: "", name }
    return null
  }
  const desiredGrants = (r) => {
    const refs = []
    const diags = []
    const seen = new Set()
    const add = (ref) => {
      const k = schemaKey(ref.ns, ref.name)
      if (seen.has(k)) return
      seen.add(k)
      refs.push(ref)
    }
    for (const n of r.grants) {
      const ref = resolveGrant(r.ns, n)
      if (ref) add(ref)
      else diags.push({ line: r.pos.line, col: r.pos.col, message: `role ${r.slug} grants unknown permission ${goQuote(n)}` })
    }
    for (const g of r.qualifiedGrants) {
      if (permExists(g.ns, g.name)) add({ ns: g.ns, name: g.name })
      else diags.push({ line: g.pos.line, col: g.pos.col, message: `role ${r.slug} grants unknown permission ${goQuote(g.name)} in namespace ${goQuote(g.ns)}` })
    }
    return { refs, diags }
  }

  // grantsDiffer. A stored grant whose permission this apply prunes is left
  // out of what the role holds: deleting the permission removes the grant
  // first, so counting it would plan a `~ (grants)` line the apply never
  // writes.
  const grantsDiffer = (r, stored) => {
    if (!grantsManaged(r)) return false
    const have = new Set(
      warden.grants
        .filter((g) => g.roleId === stored.id && !prunes(g.namespacePath, g.name))
        .map((g) => schemaKey(g.namespacePath, g.name))
    )
    const want = new Set(desiredGrants(r).refs.map((ref) => schemaKey(ref.ns, ref.name)))
    return have.size !== want.size || [...want].some((k) => !have.has(k))
  }

  const grantDiags = prog.roles.flatMap((r) => desiredGrants(r).diags)
  if (grantDiags.length > 0) return { diags: grantDiags }

  // checkSystem (ApplyOptions.ProtectSystem, which the contract always
  // sets): every change to a system role or permission is refused before
  // anything is written, in the words of extension/contract/immutable.go.
  {
    const diags = []
    const refuse = (at, message) => diags.push({ line: at.line, col: at.col, message })
    for (const p of prog.permissions) {
      const existing = warden.permissions.find((x) => x.namespacePath === p.ns && x.name === p.name)
      if (!existing) {
        if (p.isSystem) refuse(p.pos, `${goQuote(p.name)} cannot be created as a system permission`)
      } else if (existing.isSystem) {
        const changed =
          existing.resource !== p.resource || existing.action !== p.action ||
          (existing.description ?? "") !== p.description || !p.isSystem
        if (changed) refuse(p.pos, `${goQuote(p.name)} is a system permission and cannot be changed or deleted`)
      } else if (p.isSystem) {
        refuse(p.pos, `${goQuote(p.name)} is not a system permission, and source cannot make it one`)
      }
    }
    for (const r of prog.roles) {
      const existing = warden.roles.find((x) => x.namespacePath === r.ns && x.slug === r.slug)
      if (!existing) {
        if (r.isSystem) refuse(r.pos, `${goQuote(r.slug)} cannot be created as a system role`)
      } else if (existing.isSystem) {
        const changed =
          existing.name !== (r.name || r.slug) || (existing.description ?? "") !== r.description || !r.isSystem ||
          Boolean(existing.isDefault) !== r.isDefault || (existing.maxMembers ?? 0) !== r.maxMembers ||
          (existing.parentSlug ?? "") !== parentSlugForStorage(r.parent) || grantsDiffer(r, existing)
        if (changed) refuse(r.pos, `${goQuote(r.slug)} is a system role and cannot be changed or deleted`)
      } else if (r.isSystem) {
        refuse(r.pos, `${goQuote(r.slug)} is not a system role, and source cannot make it one`)
      }
    }
    if (prune) {
      // A refused prune has no declaration of its own, so it stands where the
      // source first covers the namespace (dsl coverPositions).
      const at = new Map()
      const mark = (ns, p) => {
        const cur = at.get(ns)
        if (!cur || p.line < cur.line || (p.line === cur.line && p.col < cur.col)) at.set(ns, p)
      }
      for (const d of [...prog.resourceTypes, ...prog.permissions, ...prog.roles, ...prog.policies, ...prog.relations]) mark(d.ns, d.pos)
      for (const b of prog.blockAt) mark(b.ns, b.pos)
      for (const p of warden.permissions) {
        if (p.isSystem && prunes(p.namespacePath, p.name)) {
          refuse(at.get(p.namespacePath), `${goQuote(p.name)} is a system permission and cannot be changed or deleted, and prune would delete it`)
        }
      }
      const declaredRoles = new Set(prog.roles.map((r) => schemaKey(r.ns, r.slug)))
      for (const r of warden.roles) {
        if (!r.isSystem || !covers(r.namespacePath) || declaredRoles.has(schemaKey(r.namespacePath, r.slug))) continue
        refuse(at.get(r.namespacePath), `${goQuote(r.slug)} is a system role and cannot be changed or deleted, and prune would delete it`)
      }
    }
    if (diags.length > 0) return { diags }
  }

  // checkRelations: a tuple the apply would write that its governing
  // resource type does not declare is refused before anything is written,
  // against the resource types as the apply leaves them: the source's
  // declaration where it has one, none where prune deletes the stored one,
  // the store otherwise. A tuple already stored is a no-op and not checked.
  {
    const planned = new Map(
      prog.resourceTypes.map((rt) => [
        schemaKey(rt.ns, rt.name),
        {
          name: rt.name,
          relations: rt.relations.map((rel) => ({
            name: rel.name,
            allowedSubjects: rel.allowedSubjects.map((s) => (s.relation === "" ? s.type : s.type + "#" + s.relation)),
          })),
        },
      ])
    )
    const lookup = (ns, name) => {
      const declared = planned.get(schemaKey(ns, name))
      if (declared) return declared
      if (prune && covers(ns)) return null
      return storedResourceType(ns, name)
    }
    const diags = []
    for (const t of prog.relations) {
      const stored = warden.relations.some(
        (x) =>
          x.namespacePath === t.ns && x.objectType === t.objectType && x.objectId === t.objectId && x.relation === t.relation &&
          x.subjectType === t.subjectType && x.subjectId === t.subjectId && (x.subjectRelation ?? "") === t.subjectRelation
      )
      if (stored) continue
      const message = undeclaredTupleMessage({ ...t, namespacePath: t.ns }, lookup)
      if (message) diags.push({ line: t.pos.line, col: t.pos.col, message })
    }
    if (diags.length > 0) return { diags }
  }

  // ---- resource types ----
  {
    const declared = new Set()
    for (const rt of prog.resourceTypes) {
      declared.add(schemaKey(rt.ns, rt.name))
      const relations = rt.relations.map((rel) => ({
        name: rel.name,
        allowedSubjects: rel.allowedSubjects.map((s) => (s.relation === "" ? s.type : s.type + "#" + s.relation)),
      }))
      const permissions = rt.permissions.map((p) => ({ name: p.name, expression: formatExpr(p.expr) }))
      const existing = warden.resourceTypes.find((x) => x.namespacePath === rt.ns && x.name === rt.name)
      if (!existing) {
        if (write) {
          const at = now()
          warden.resourceTypes.push({
            id: newId("rtype"), namespacePath: rt.ns, name: rt.name, description: rt.description, relations, permissions,
            createdBy: DECLARATIVE_ACTOR, updatedBy: DECLARATIVE_ACTOR, createdAt: at, updatedAt: at,
          })
        }
        res.created.push(`+ resource_type/${rt.ns}/${rt.name}`)
        continue
      }
      const changed = []
      if ((existing.description ?? "") !== rt.description) changed.push("description")
      const relationsSame =
        existing.relations.length === relations.length &&
        existing.relations.every((d, i) => d.name === relations[i].name && sameList(d.allowedSubjects, relations[i].allowedSubjects))
      if (!relationsSame) changed.push("relations")
      // Expressions compare in canonical form: the store keeps what was typed, the language keeps its meaning.
      const permsSame =
        existing.permissions.length === permissions.length &&
        existing.permissions.every((d, i) => d.name === permissions[i].name && canonicalExpr(d.expression) === canonicalExpr(permissions[i].expression))
      if (!permsSame) changed.push("permissions")
      if (changed.length === 0) {
        res.noOps++
        continue
      }
      if (write) Object.assign(existing, { description: rt.description, relations, permissions, updatedBy: DECLARATIVE_ACTOR, updatedAt: now() })
      res.updated.push(updateLine("resource_type", rt.ns, rt.name, changed))
    }
    if (prune) {
      for (const rt of [...warden.resourceTypes]) {
        if (!covers(rt.namespacePath) || declared.has(schemaKey(rt.namespacePath, rt.name))) continue
        if (write) warden.resourceTypes.splice(warden.resourceTypes.indexOf(rt), 1)
        res.deleted.push(`- resource_type/${rt.namespacePath}/${rt.name}`)
      }
    }
  }

  // ---- permissions ----
  {
    const declared = new Set()
    for (const p of prog.permissions) {
      declared.add(schemaKey(p.ns, p.name))
      const existing = warden.permissions.find((x) => x.namespacePath === p.ns && x.name === p.name)
      if (!existing) {
        if (write) {
          const at = now()
          warden.permissions.push({
            id: newId("perm"), namespacePath: p.ns, name: p.name, resource: p.resource, action: p.action,
            description: p.description, isSystem: p.isSystem, createdAt: at, updatedAt: at,
          })
        }
        res.created.push(`+ permission/${p.ns}/${p.name}`)
        continue
      }
      const changed = []
      if (existing.resource !== p.resource) changed.push("resource")
      if (existing.action !== p.action) changed.push("action")
      if ((existing.description ?? "") !== p.description) changed.push("description")
      if (Boolean(existing.isSystem) !== p.isSystem) changed.push("is_system")
      if (changed.length === 0) {
        res.noOps++
        continue
      }
      if (write) Object.assign(existing, { resource: p.resource, action: p.action, description: p.description, isSystem: p.isSystem, updatedAt: now() })
      res.updated.push(updateLine("permission", p.ns, p.name, changed))
    }
    if (prune) {
      for (const p of [...warden.permissions]) {
        if (!covers(p.namespacePath) || declared.has(schemaKey(p.namespacePath, p.name))) continue
        if (write) {
          warden.permissions.splice(warden.permissions.indexOf(p), 1)
          // The junction row would otherwise name a permission that is gone.
          warden.grants = warden.grants.filter((g) => !(g.namespacePath === p.namespacePath && g.name === p.name))
        }
        res.deleted.push(`- permission/${p.namespacePath}/${p.name}`)
      }
    }
  }

  // A real apply that has written resource types and permissions stops here.
  if (write && source.includes(SCHEMA_FAIL_MARKER)) {
    throw new Error(`fixture: the store refused a write (the source contains ${goQuote(SCHEMA_FAIL_MARKER)})`)
  }

  // ---- roles ----
  {
    const declared = new Set()
    for (const r of topoSortRoles(prog.roles)) {
      declared.add(schemaKey(r.ns, r.slug))
      const name = r.name || r.slug
      const parentSlug = parentSlugForStorage(r.parent)
      const existing = warden.roles.find((x) => x.namespacePath === r.ns && x.slug === r.slug)
      if (!existing) {
        if (write) {
          const at = now()
          warden.roles.push({
            id: newId("role"), namespacePath: r.ns, name, slug: r.slug, description: r.description, parentSlug,
            isSystem: r.isSystem, isDefault: r.isDefault, maxMembers: r.maxMembers, createdAt: at, updatedAt: at,
          })
        }
        res.created.push(`+ role/${r.ns}/${r.slug}`)
        continue
      }
      const changed = []
      if (existing.name !== name) changed.push("name")
      if ((existing.description ?? "") !== r.description) changed.push("description")
      if (Boolean(existing.isSystem) !== r.isSystem) changed.push("is_system")
      if (Boolean(existing.isDefault) !== r.isDefault) changed.push("is_default")
      if ((existing.maxMembers ?? 0) !== r.maxMembers) changed.push("max_members")
      if ((existing.parentSlug ?? "") !== parentSlug) changed.push("parent")
      const rowChanged = changed.length > 0
      // A role with no grants clause leaves its grants alone.
      if (grantsDiffer(r, existing)) changed.push("grants")
      if (changed.length === 0) {
        res.noOps++
        continue
      }
      // A cap lowered below the role's live members stops the apply, in a dry
      // run too. dsl wraps it as "update role <slug>: ..."; mapWardenError
      // sends only the refusal (CONFLICT, no reason) from a plan or apply's
      // dry run, and a write pass reports the whole chain as a half apply.
      if (rowChanged) {
        const refusal = capLoweringRefusal(existing, existing.maxMembers ?? 0, r.maxMembers, Date.now())
        if (refusal) {
          const err = conflict(refusal)
          err.chain = `update role ${r.slug}: ${refusal}`
          throw err
        }
      }
      // A grant-only change is written with the grants below; the row is left alone.
      if (write && rowChanged) {
        Object.assign(existing, { name, description: r.description, isSystem: r.isSystem, isDefault: r.isDefault, maxMembers: r.maxMembers, parentSlug, updatedAt: now() })
      }
      res.updated.push(updateLine("role", r.ns, r.slug, changed))
    }
    if (prune) {
      for (const r of [...warden.roles]) {
        if (!covers(r.namespacePath) || declared.has(schemaKey(r.namespacePath, r.slug))) continue
        // Unreachable here: checkSystem refused a pruned system role above.
        // dsl keeps the skip for the CLI and the declarative loader.
        if (r.isSystem) continue
        if (write) {
          warden.roles.splice(warden.roles.indexOf(r), 1)
          // The store cascades a role's assignments and grants.
          warden.assignments = warden.assignments.filter((a) => a.roleId !== r.id)
          warden.grants = warden.grants.filter((g) => g.roleId !== r.id)
        }
        res.deleted.push(`- role/${r.namespacePath}/${r.slug}`)
      }
    }
  }

  // ---- role permissions: each role with a grants clause owns its whole set ----
  if (write) {
    for (const r of prog.roles) {
      if (!grantsManaged(r)) continue
      const stored = warden.roles.find((x) => x.namespacePath === r.ns && x.slug === r.slug)
      const refs = desiredGrants(r).refs
      warden.grants = warden.grants
        .filter((g) => g.roleId !== stored.id)
        .concat(refs.map((ref) => ({ roleId: stored.id, namespacePath: ref.ns, name: ref.name })))
    }
  }

  // ---- policies ----
  {
    const declared = new Set()
    for (const p of prog.policies) {
      declared.add(schemaKey(p.ns, p.name))
      const conditions = flattenConditions(p.conditions)
      const existing = warden.policies.find((x) => x.namespacePath === p.ns && x.name === p.name)
      if (!existing) {
        if (write) {
          const at = nextPolicyCreatedAt()
          warden.policies.push({
            id: newId("wpol"), namespacePath: p.ns, name: p.name, description: p.description, effect: p.effect,
            priority: p.priority, isActive: p.active, notBefore: p.notBefore, notAfter: p.notAfter, version: 1,
            subjects: p.subjects.map((s) => ({ ...s })), actions: [...p.actions], resources: [...p.resources],
            conditions: conditions.map((c) => ({ id: newId("cond"), ...c })), obligations: [...p.obligations],
            createdBy: DECLARATIVE_ACTOR, updatedBy: DECLARATIVE_ACTOR, createdAt: at, updatedAt: at,
          })
        }
        res.created.push(`+ policy/${p.ns}/${p.name}`)
        continue
      }
      const changed = []
      if ((existing.description ?? "") !== p.description) changed.push("description")
      if (existing.effect !== p.effect) changed.push("effect")
      if (existing.priority !== p.priority) changed.push("priority")
      if (existing.isActive !== p.active) changed.push("active")
      if ((existing.notBefore ?? null) !== p.notBefore) changed.push("not_before")
      if ((existing.notAfter ?? null) !== p.notAfter) changed.push("not_after")
      if (!sameList(existing.obligations, p.obligations)) changed.push("obligations")
      const sameSubjects =
        existing.subjects.length === p.subjects.length &&
        existing.subjects.every((s, i) => (s.kind ?? "") === p.subjects[i].kind && (s.id ?? "") === p.subjects[i].id && (s.role ?? "") === p.subjects[i].role)
      if (!sameSubjects) changed.push("subjects")
      if (!sameList(existing.actions, p.actions)) changed.push("actions")
      if (!sameList(existing.resources, p.resources)) changed.push("resources")
      const sameConditions =
        existing.conditions.length === conditions.length &&
        existing.conditions.every((c, i) => c.field === conditions[i].field && c.operator === conditions[i].operator && sameValue(c.value, conditions[i].value))
      if (!sameConditions) changed.push("conditions")
      if (changed.length === 0) {
        res.noOps++
        continue
      }
      if (write) {
        Object.assign(existing, {
          description: p.description, effect: p.effect, priority: p.priority, isActive: p.active,
          notBefore: p.notBefore, notAfter: p.notAfter, obligations: [...p.obligations],
          subjects: p.subjects.map((s) => ({ ...s })), actions: [...p.actions], resources: [...p.resources],
          conditions: sameConditions ? existing.conditions : conditions.map((c) => ({ id: newId("cond"), ...c })),
          version: existing.version + 1, updatedBy: DECLARATIVE_ACTOR, updatedAt: now(),
        })
      }
      res.updated.push(updateLine("policy", p.ns, p.name, changed))
    }
    if (prune) {
      for (const p of [...warden.policies]) {
        if (!covers(p.namespacePath) || declared.has(schemaKey(p.namespacePath, p.name))) continue
        if (write) warden.policies.splice(warden.policies.indexOf(p), 1)
        res.deleted.push(`- policy/${p.namespacePath}/${p.name}`)
      }
    }
  }

  // ---- relations: created when missing, never updated, never pruned ----
  for (const t of prog.relations) {
    const dup = warden.relations.some(
      (x) =>
        x.namespacePath === t.ns && x.objectType === t.objectType && x.objectId === t.objectId && x.relation === t.relation &&
        x.subjectType === t.subjectType && x.subjectId === t.subjectId && (x.subjectRelation ?? "") === t.subjectRelation
    )
    if (dup) {
      res.noOps++
      continue
    }
    if (write) {
      warden.relations.push({
        id: newId("rel"), namespacePath: t.ns, objectType: t.objectType, objectId: t.objectId, relation: t.relation,
        subjectType: t.subjectType, subjectId: t.subjectId, subjectRelation: t.subjectRelation,
        createdBy: DECLARATIVE_ACTOR, createdAt: now(),
      })
    }
    res.created.push(`+ relation/${t.ns}/${t.objectType}:${t.objectId}#${t.relation}`)
  }
  return { res }
}

// ---- the digest, the dry run and the three handlers ------------------------

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))

/**
 * planDigest: SHA-256 over the prune flag (one byte); the SHA-256 of the
 * submitted source; then created, updated and deleted, each sorted by bytes
 * and length-prefixed (the count, then each line with its own length, all as
 * big-endian uint64); then the no-op count. Hex, 64 characters. The source is
 * in it because a `~` line names the fields that change and not their
 * values, so two sources can give the same lines and mean different things.
 */
function planDigest(prune, source, r) {
  const h = createHash("sha256")
  const uint = (n) => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64BE(BigInt(n))
    h.update(buf)
  }
  h.update(Buffer.from([prune ? 1 : 0]))
  h.update(createHash("sha256").update(Buffer.from(source, "utf8")).digest())
  for (const list of [r.created, r.updated, r.deleted]) {
    const lines = [...list].sort(byteOrder)
    uint(lines.length)
    for (const line of lines) {
      uint(Buffer.byteLength(line, "utf8"))
      h.update(Buffer.from(line, "utf8"))
    }
  }
  uint(r.noOps)
  return h.digest("hex")
}

/** dryRunSchema: the one path plan and apply share, so the diff an operator sees and the diff apply verifies cannot differ. */
function dryRunSchema(source, prune) {
  const checked = checkSchemaSource(source)
  if (checked.diags) return { diags: checked.diags }
  const ran = runSchemaApplier(checked.prog, prune, false, source)
  if (ran.diags) return { diags: ran.diags }
  return { prog: checked.prog, res: ran.res }
}

function decodeBool(v, struct, field) {
  if (v === undefined || v === null) return false
  if (typeof v !== "boolean") throw decodeFail(struct, field, v, "bool")
  return v
}

// errSchemaChanged. details.reason is how the page tells it from the cap
// refusal apply's own dry run can return, which is CONFLICT with no reason.
const schemaChanged = () =>
  new WardenFixtureError(409, "CONFLICT", "the schema changed since you planned: plan again", { reason: "schema_changed" })

function schemaExport(params) {
  const prefix = decodeString(params?.namespacePrefix, "SchemaExportInput", "namespacePrefix")
  if (prefix !== "") validateNamespace(prefix)
  return { source: formatSchema(WARDEN_TENANT, exportDecls(prefix)) }
}

function schemaPlan(params) {
  const S = "SchemaPlanInput"
  const source = decodeString(params?.source, S, "source")
  const prune = decodeBool(params?.prune, S, "prune")
  const dry = dryRunSchema(source, prune)
  if (dry.diags) {
    return { valid: false, diagnostics: dry.diags, created: [], updated: [], deleted: [], noOps: 0, digest: "" }
  }
  const { res } = dry
  return {
    valid: true,
    diagnostics: [],
    created: res.created,
    updated: res.updated,
    deleted: res.deleted,
    noOps: res.noOps,
    digest: planDigest(prune, source, res),
  }
}

function schemaApply(payload) {
  const S = "SchemaApplyInput"
  const source = decodeString(payload?.source, S, "source")
  const prune = decodeBool(payload?.prune, S, "prune")
  const digest = decodeString(payload?.digest, S, "digest")

  // Invalid source is refused before the digest is looked at: there is
  // nothing to plan, so nothing the operator could have seen.
  const dry = dryRunSchema(source, prune)
  if (dry.diags) {
    const d = dry.diags[0]
    throw badRequest(`the source has an error at line ${d.line}, column ${d.col}: ${d.message}`)
  }
  // The operator applies the diff they saw or nothing. An empty digest never
  // matches: planDigest is always 64 hex characters.
  const planned = planDigest(prune, source, dry.res)
  if (digest === "" || digest !== planned) throw schemaChanged()

  let written
  try {
    written = runSchemaApplier(dry.prog, prune, true, source)
    if (written.diags) throw new Error(written.diags[0].message)
  } catch (err) {
    // The dry run passed, so anything that fails now failed after other
    // writes, and the store has no transaction: a half apply, not a refusal.
    throw new WardenFixtureError(500, "INTERNAL", "the apply stopped part way: " + (err.chain ?? err.message))
  }
  const { res } = written
  return {
    created: res.created,
    updated: res.updated,
    deleted: res.deleted,
    noOps: res.noOps,
    diverged: planDigest(prune, source, res) !== planned,
  }
}

// ---------------------------------------------------------------------------
// resourceTypes.graph and relations.expand
//
// handlers_graphs.go, over expand.go and graph_walker.go in warden. The Go is
// the authority for every key, rule and refusal here.
//
// The schema graph is drawn from resource types alone, one edge per allowed
// subject of each relation: what the schema allows, not what is stored. The
// expansion is the opposite. It is the ReBAC walker's own breadth-first walk
// from one object and relation with no target, over the stored tuples, under
// the engine's graph budget (warden.config). Relations match exactly, tuples
// cascade down from every ancestor namespace of the request, and only a
// subject SET (a tuple with a subjectRelation) is walked into: a single
// subject is a leaf.
//
// THE STOP STATES. Every request below is
//   { objectType: "document", objectId: "readme", relation: "editor" }
// against the seeded chain (see the tuples above rel_01g in seedWardenState),
// and a state is reached by changing ONE value in warden.config and
// restarting. A 0 in the config is the default (10, 5000, 1000), and the
// response's limit is always the effective value.
//
//   state     config change             namespacePath   response
//   --------  ------------------------  --------------  ---------------------
//   complete  none (10 / 5000 / 1000)   ""              stop complete, limit 0, 7 nodes,
//                                                       all four sets walked
//   depth     maxGraphDepth: 2          ""              stop depth, limit 2. group:oncall#member
//                                                       sits at depth 3, so it is dequeued past
//                                                       the limit: it is reached but not walked
//                                                       and user:frank is never found (6 nodes)
//   visited   maxGraphVisited: 3        ""              stop visited, limit 3. The fourth
//                                                       distinct set, group:oncall#member, trips
//                                                       the count: not walked, 6 nodes. With 2
//                                                       it is group:platform#member (4 nodes)
//   fanout    maxGraphFanout: 2         ""              stop fanout, limit 2. group:eng#member
//                                                       lists two tuples, which is at the limit
//                                                       (>=, not >): it is the node that trips,
//                                                       not walked, with no edges (2 nodes)
//   fanout    maxGraphFanout: 3         "eng/platform"  stop fanout, limit 3. Only here: rel_01k
//                                                       adds a third tuple to
//                                                       group:platform#member, so that hop trips
//                                                       and the same limit completes at the root
//
// Depth 3 and above complete on this chain, visited 4 and above complete, and
// fanout 3 and above complete at the root. To see the 2000 node cap
// (truncatedNodes above 0), a chain of subject sets must reach more nodes than
// that: relations.create about 700 single subjects under each of
// group:eng#member, group:platform#member and group:oncall#member (a hop of
// 1000 tuples would trip the default fanout first).
//
// A hop lists its tuples in the store's order, oldest first and by id on a
// tie, and a hop that returns maxGraphFanout tuples is a fanout stop, which is
// why the list is capped at the limit before it is counted.
// ---------------------------------------------------------------------------

/** The walker's defaults when warden.config holds 0 (NewGraphWalker). */
const DEFAULT_MAX_GRAPH_DEPTH = 10
const DEFAULT_MAX_GRAPH_VISITED = 5000
const DEFAULT_MAX_GRAPH_FANOUT = 1000

/** maxExpandNodes: how many nodes an expansion returns. */
const MAX_EXPAND_NODES = 2000

/** maxSchemaGraphTypes: how many resource types the schema graph draws. */
const MAX_SCHEMA_GRAPH_TYPES = 500

const effectiveLimit = (configured, fallback) => (configured > 0 ? configured : fallback)

/** The Go code's byte order on ids and names. For ASCII it is code unit order. */
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function resourceTypesGraph(params) {
  const S = "ResourceTypeGraphInput"
  // *string: absent and null are no filter, and "" is the tenant root.
  const nsAbsent = params?.namespacePath === undefined || params?.namespacePath === null
  const namespacePath = nsAbsent ? null : decodeString(params.namespacePath, S, "namespacePath")
  if (namespacePath !== null) validateNamespace(namespacePath)

  // The cap keeps the first 500 types in namespace, name and id order, so
  // which survive does not depend on the store's order.
  let rows = (namespacePath === null ? [...warden.resourceTypes] : warden.resourceTypes.filter((rt) => rt.namespacePath === namespacePath)).sort(
    (a, b) => compareStrings(a.namespacePath, b.namespacePath) || compareStrings(a.name, b.name) || compareStrings(a.id, b.id)
  )
  const truncated = rows.length > MAX_SCHEMA_GRAPH_TYPES
  if (truncated) rows = rows.slice(0, MAX_SCHEMA_GRAPH_TYPES)

  // Both lists are always arrays, never null.
  const nodes = rows.map((rt) => ({
    id: rt.id,
    namespacePath: rt.namespacePath,
    name: rt.name,
    relations: rt.relations.map((d) => ({ name: d.name, allowedSubjects: [...d.allowedSubjects] })),
    permissions: rt.permissions.map((d) => ({ name: d.name, expression: d.expression })),
  }))
  const idsByName = new Map()
  for (const n of nodes) idsByName.set(n.name, [...(idsByName.get(n.name) ?? []), n.id])

  const edges = []
  for (const n of nodes) {
    for (const rel of n.relations) {
      for (const allowed of rel.allowedSubjects) {
        // strings.Cut at the first "#".
        const cut = allowed.indexOf("#")
        const to = cut === -1 ? allowed : allowed.slice(0, cut)
        const toRelation = cut === -1 ? "" : allowed.slice(cut + 1)
        const toIds = [...(idsByName.get(to) ?? [])]
        const edge = { from: n.name, fromId: n.id, relation: rel.name, to }
        // toRelation is omitempty.
        if (toRelation) edge.toRelation = toRelation
        edge.declared = toIds.length > 0
        edge.toIds = toIds
        edges.push(edge)
      }
    }
  }
  return { nodes, edges, truncated }
}

/** expandKey: type:id#relation for a subject set, type:id for a single subject. */
function expandKey(n) {
  return n.relation === "" ? `${n.type}:${n.id}` : `${n.type}:${n.id}#${n.relation}`
}

/**
 * Engine.ExpandRelation over the seeded tuples, as bfsGraphWalker.traverse
 * walks them. Written step for step like traverse, so each stop reads the way
 * the Go does:
 *   depth    a dequeued entry is deeper than maxDepth, checked BEFORE the
 *            visited test, so a repeat entry past the limit stops it too;
 *   visited  the count of distinct type:id#relation nodes passes maxVisited;
 *   fanout   a hop's tuples, capped at maxFanout, number maxFanout.
 * Nodes are deduplicated by the walker's visit key, so a subject set is one
 * node however many tuples reach it. Walked is set when a node's hop passed
 * the fanout check, so it is false for a frontier node, for the node that
 * tripped fanout, and for every single subject.
 */
function expandRelation(objectType, objectId, rel, namespacePath) {
  const maxDepth = effectiveLimit(warden.config.maxGraphDepth, DEFAULT_MAX_GRAPH_DEPTH)
  const maxVisited = effectiveLimit(warden.config.maxGraphVisited, DEFAULT_MAX_GRAPH_VISITED)
  const maxFanout = effectiveLimit(warden.config.maxGraphFanout, DEFAULT_MAX_GRAPH_FANOUT)

  // Tuples cascade down: the request namespace and every ancestor of it. One
  // pass groups what is in scope by the hop that lists it, oldest first.
  const scope = new Set(ancestorNamespaces(namespacePath))
  const hops = new Map()
  for (const t of [...warden.relations].sort(byCreated)) {
    if (!scope.has(t.namespacePath)) continue
    const key = `${t.objectType}:${t.objectId}#${t.relation}`
    const list = hops.get(key)
    if (list) list.push(t)
    else hops.set(key, [t])
  }

  const nodes = []
  const parent = []
  const edges = []
  const sets = new Map() // visit key -> node index
  const singles = new Map() // "type\u0000id" -> node index
  const add = (n, from) => {
    nodes.push({ ...n, walked: false })
    parent.push(from)
    return nodes.length - 1
  }
  const rootKey = `${objectType}:${objectId}#${rel}`
  sets.set(rootKey, add({ type: objectType, id: objectId, relation: rel, depth: 0 }, -1))

  let stop = "complete"
  let limit = 0
  const queue = [{ type: objectType, id: objectId, relation: rel, depth: 0 }]
  const visited = new Set()
  for (let head = 0; head < queue.length; head++) {
    const entry = queue[head]
    if (entry.depth > maxDepth) {
      stop = "depth"
      limit = maxDepth
      break
    }
    const visitKey = `${entry.type}:${entry.id}#${entry.relation}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)
    if (visited.size > maxVisited) {
      stop = "visited"
      limit = maxVisited
      break
    }
    const tuples = (hops.get(visitKey) ?? []).slice(0, maxFanout)
    if (tuples.length >= maxFanout) {
      stop = "fanout"
      limit = maxFanout
      break
    }
    const from = sets.get(visitKey)
    nodes[from].walked = true
    for (const t of tuples) {
      const depth = entry.depth + 1
      let to
      if (t.subjectRelation) {
        const key = `${t.subjectType}:${t.subjectId}#${t.subjectRelation}`
        if (!sets.has(key)) sets.set(key, add({ type: t.subjectType, id: t.subjectId, relation: t.subjectRelation, depth }, from))
        to = sets.get(key)
        // Only a subject set is walked into.
        queue.push({ type: t.subjectType, id: t.subjectId, relation: t.subjectRelation, depth })
      } else {
        const key = `${t.subjectType}\u0000${t.subjectId}`
        if (!singles.has(key)) singles.set(key, add({ type: t.subjectType, id: t.subjectId, relation: "", depth }, from))
        to = singles.get(key)
      }
      edges.push({ from, to, namespacePath: t.namespacePath })
    }
  }
  return { nodes, edges, parent, stop, limit }
}

/**
 * expansionPath: the node indexes of the walk's path to the first node for
 * subjectType:subjectID, root first. The first edge into a node of that type
 * and id (a single subject or a subject set) is the tuple Walk would have
 * stopped on. Empty when the expansion never reached it.
 */
function expansionPath(x, subjectType, subjectId) {
  for (const edge of x.edges) {
    const to = x.nodes[edge.to]
    if (to.type !== subjectType || to.id !== subjectId) continue
    const path = []
    for (let i = edge.from; i !== -1; i = x.parent[i]) path.unshift(i)
    path.push(edge.to)
    return path
  }
  return []
}

function relationsExpand(params) {
  const S = "RelationExpandInput"
  // The whole request decodes before any check runs, as it does in Go.
  const objectType = decodeString(params?.objectType, S, "objectType")
  const objectId = decodeString(params?.objectId, S, "objectId")
  const relation = decodeString(params?.relation, S, "relation")
  const namespacePath = decodeString(params?.namespacePath, S, "namespacePath")
  const pathToType = decodeString(params?.pathToType, S, "pathToType")
  const pathToId = decodeString(params?.pathToId, S, "pathToId")

  if (objectType === "") throw badRequest("objectType is required")
  if (objectId === "") throw badRequest("objectId is required")
  if (relation === "") throw badRequest("relation is required")
  if ((pathToType === "") !== (pathToId === "")) {
    throw badRequest("pathToType and pathToId go together: set both or neither")
  }
  validateNamespace(namespacePath)

  const x = expandRelation(objectType, objectId, relation, namespacePath)
  const pathIdx = pathToType !== "" ? expansionPath(x, pathToType, pathToId) : []

  // The first MAX_EXPAND_NODES nodes in the walk's order stay, and so do the
  // root (index 0, inside the cap) and every node on the path.
  const keep = x.nodes.map((_, i) => i < MAX_EXPAND_NODES)
  for (const i of pathIdx) keep[i] = true
  const kept = keep.filter(Boolean).length

  // A kept node with an edge to a dropped node no longer has all its tuples
  // drawn, so it is not reported as walked, and it is reported as capped so
  // that a walked node is not mistaken for an unwalked one.
  const incomplete = new Array(x.nodes.length).fill(false)
  for (const e of x.edges) if (keep[e.from] && !keep[e.to]) incomplete[e.from] = true

  const keys = x.nodes.map(expandKey)
  const nodes = []
  x.nodes.forEach((n, i) => {
    if (!keep[i]) return
    const out = { key: keys[i], type: n.type, id: n.id }
    // relation is omitempty.
    if (n.relation) out.relation = n.relation
    out.depth = n.depth
    out.walked = n.walked && !incomplete[i]
    // True when the node cap removed any of this node's outgoing edges.
    out.capped = incomplete[i]
    nodes.push(out)
  })
  return {
    nodes,
    edges: x.edges
      .filter((e) => keep[e.from] && keep[e.to])
      .map((e) => ({ from: keys[e.from], to: keys[e.to], namespacePath: e.namespacePath })),
    stop: x.stop,
    limit: x.limit,
    // The built-in walker is the only one the fixture has.
    exactWalk: true,
    truncatedNodes: x.nodes.length - kept,
    path: pathIdx.map((i) => keys[i]),
  }
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
      checks: newestFirst(warden.checkLogs)
        .slice(0, params?.limit > 0 ? params.limit : 10)
        .map(projectCheckLog),
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
      "checkLogs.list", "checkLogs.detail", "subjects.detail",
    ],
    handler: () => {
      // Go runs RunTenantMaintenance for the caller's tenant: that tenant's
      // expired assignments and, when the retention is above zero, its check
      // log entries older than the retention window. This fixture holds one
      // tenant, the caller's, so every row here is in scope.
      //
      // A fixture that accepts a write and changes nothing hides the bug it
      // exists to expose, so this really removes the rows and a second run
      // honestly reports zero.
      const nowMs = Date.now()
      const assignmentsBefore = warden.assignments.length
      warden.assignments = warden.assignments.filter(
        (a) => !a.expiresAt || Date.parse(a.expiresAt) > nowMs
      )
      let checkLogsPurged = 0
      const retentionHours = warden.config.checkLogRetentionHours
      if (retentionHours > 0) {
        const cutoffMs = nowMs - retentionHours * 3600_000
        const logsBefore = warden.checkLogs.length
        warden.checkLogs = warden.checkLogs.filter((e) => Date.parse(e.createdAt) >= cutoffMs)
        checkLogsPurged = logsBefore - warden.checkLogs.length
      }
      return {
        assignmentsPurged: assignmentsBefore - warden.assignments.length,
        checkLogsPurged,
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
      // guardCapLowering, against the role as stored, before the parent check.
      if (payload.maxMembers !== undefined) {
        const refusal = capLoweringRefusal(r, r.maxMembers ?? 0, payload.maxMembers, Date.now())
        if (refusal) throw conflict(refusal)
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
  "relations.expand": {
    kind: "query",
    handler: (params) => relationsExpand(params),
  },
  "relations.create": {
    kind: "command",
    invalidates: ["relations.list", "relations.expand", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      // The same order as Go, so the first missing part reported is the
      // same one on every run.
      for (const field of ["objectType", "objectId", "relation", "subjectType", "subjectId"]) {
        if (!payload?.[field]) throw badRequest("a relation needs " + field)
      }
      const namespacePath = payload.namespacePath ?? ""
      validateNamespace(namespacePath)
      const subjectRelation = payload.subjectRelation ?? ""
      // The resource type governing the object type, if there is one, must
      // declare the relation and allow the subject. Go checks before the
      // write, so this refusal comes before the duplicate's CONFLICT.
      const undeclared = undeclaredTupleMessage({ ...payload, namespacePath, subjectRelation }, storedResourceType)
      if (undeclared) throw badRequest(undeclared)
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
    invalidates: ["relations.list", "relations.expand", "overview.stats", "namespaces.list"],
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
  "resourceTypes.graph": {
    kind: "query",
    handler: (params) => resourceTypesGraph(params),
  },
  "resourceTypes.create": {
    kind: "command",
    invalidates: ["resourceTypes.list", "resourceTypes.graph", "overview.stats", "namespaces.list"],
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
    invalidates: ["resourceTypes.list", "resourceTypes.detail", "resourceTypes.graph"],
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
    invalidates: ["resourceTypes.list", "resourceTypes.detail", "resourceTypes.graph", "overview.stats", "namespaces.list"],
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

  "checkLogs.list": {
    kind: "query",
    handler: (params) => {
      // The whole request decodes before any check runs, as it does in Go.
      const S = "CheckLogsListInput"
      const nsAbsent = params?.namespacePath === undefined || params?.namespacePath === null
      const namespacePath = nsAbsent ? null : decodeString(params.namespacePath, S, "namespacePath")
      const subjectKind = decodeString(params?.subjectKind, S, "subjectKind")
      const subjectId = decodeString(params?.subjectId, S, "subjectId")
      const action = decodeString(params?.action, S, "action")
      const resourceType = decodeString(params?.resourceType, S, "resourceType")
      const resourceId = decodeString(params?.resourceId, S, "resourceId")
      const decision = decodeString(params?.decision, S, "decision")
      const cachedRaw = params?.cached
      if (cachedRaw !== undefined && cachedRaw !== null && typeof cachedRaw !== "boolean") {
        throw decodeFail(S, "cached", cachedRaw, "bool")
      }
      const afterRaw = decodeString(params?.after, S, "after")
      const beforeRaw = decodeString(params?.before, S, "before")
      const paging = {
        limit: decodeInt(params?.limit, S, "limit"),
        offset: decodeInt(params?.offset, S, "offset"),
      }

      if (decision !== "" && !KNOWN_DECISIONS.has(decision)) {
        throw badRequest("decision is not one warden records: " + decision)
      }
      const after = parseInstant("after", afterRaw)
      const before = parseInstant("before", beforeRaw)
      if (after !== null && before !== null && after > before) {
        throw badRequest("after is later than before")
      }

      // Every filter is an exact match and they combine with AND. Both time
      // bounds are inclusive, compared on the row's own createdAt.
      const rows = newestFirst(warden.checkLogs).filter((e) => {
        if (namespacePath !== null && e.namespacePath !== namespacePath) return false
        if (subjectKind !== "" && e.subjectKind !== subjectKind) return false
        if (subjectId !== "" && e.subjectId !== subjectId) return false
        if (action !== "" && e.action !== action) return false
        if (resourceType !== "" && e.resourceType !== resourceType) return false
        if (resourceId !== "" && e.resourceId !== resourceId) return false
        if (decision !== "" && e.decision !== decision) return false
        if (typeof cachedRaw === "boolean" && e.cached !== cachedRaw) return false
        const at = Date.parse(e.createdAt)
        if (after !== null && at < after) return false
        if (before !== null && at > before) return false
        return true
      })

      const page = pageOf(rows, paging)
      const out = { ...page, items: page.items.map(projectCheckLog) }
      // Absent, not zeroed, when check logging is off.
      if (warden.config.checkLogEnabled) out.notRecorded = { ...warden.checkLogLoss }
      return out
    },
  },
  "checkLogs.detail": {
    kind: "query",
    handler: (params) => {
      const raw = decodeString(params?.id, "CheckLogDetailInput", "id")
      if (!CHECK_LOG_ID.test(raw)) throw badRequest("not a check log id: " + raw)
      const e = warden.checkLogs.find((x) => x.id === raw)
      if (!e) {
        throw new WardenFixtureError(404, "NOT_FOUND", `check log ${raw}: warden: check log not found: warden: not found`)
      }
      return projectCheckLogDetail(e)
    },
  },
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
      const draft = decodeDraft(params, "PolicyDraft")
      const issues = collectPolicyIssues(draft, ALL_PARTS)
      // Analysed as a create would store it, so the answer is the stored
      // policy's, not the raw draft's. The effect goes in unchecked: anything
      // but exactly "allow" is treated as a deny, as in Go.
      const shape = {
        effect: draft.effect,
        isActive: true,
        notBefore: null,
        notAfter: null,
        subjects: draft.subjects.map(storedSubject),
        actions: trimmedList(draft.actions),
        resources: trimmedList(draft.resources),
        conditions: toPolicyConditions(draft.conditions, []),
      }
      return {
        valid: issuesError(issues) === null,
        matchesEverything: analysePolicy(shape, nowNs()).matchesEverything,
        fields: issues.fields,
        conditions: issues.conditions,
      }
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
      // Before validation, as in Go: an edit made from a stale copy is refused
      // as stale even when it is also invalid. Go also makes the write itself
      // conditional on before.version; here nothing can land between this read
      // and the write below, so the check above is the whole guard.
      checkExpectedVersion(before, patch.expectedVersion)
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
  "playground.explain": {
    kind: "query",
    handler: (params) => {
      // The request decodes whole before any check, as it does in Go. There is
      // no tenant field: the tenant is the caller's.
      const S = "PlaygroundExplainInput"
      const req = {
        subjectKind: decodeString(params?.subjectKind, S, "subjectKind"),
        subjectId: decodeString(params?.subjectId, S, "subjectId"),
        action: decodeString(params?.action, S, "action"),
        resourceType: decodeString(params?.resourceType, S, "resourceType"),
        resourceId: decodeString(params?.resourceId, S, "resourceId"),
        namespacePath: decodeString(params?.namespacePath, S, "namespacePath"),
        context: decodeBag(params?.context, "context"),
        subjectAttributes: decodeBag(params?.subjectAttributes, "subjectAttributes"),
        resourceAttributes: decodeBag(params?.resourceAttributes, "resourceAttributes"),
      }
      // The subject kind is not checked, as in the handler: warden logs checks
      // under other kinds ("" from the REST API, anything from Go callers) and
      // a logged check must be replayable. An unlisted kind falls through to
      // the scenario table and then the fallback.
      if (req.subjectId === "") throw badRequest("subjectId is required")
      if (req.action === "") throw badRequest("action is required")
      if (req.resourceType === "") throw badRequest("resourceType is required")
      validateNamespace(req.namespacePath)

      // Nothing here writes: no check log row, no cache, no state change.
      return explainRequest(req)
    },
  },
  "subjects.detail": {
    kind: "query",
    handler: (params) => subjectsDetail(params),
  },
  "playground.batchCheck": {
    kind: "query",
    handler: (params) => playgroundBatchCheck(params),
  },
  // -------------------------------------------------------------------------
  // Schema: the tenant's model as Warden source. See the section above
  // wardenHandlers for what is ported and what differs from Go.
  // -------------------------------------------------------------------------

  "schema.export": {
    kind: "query",
    handler: (params) => schemaExport(params),
  },
  "schema.plan": {
    kind: "query",
    handler: (params) => schemaPlan(params),
  },
  "schema.apply": {
    kind: "command",
    // The invalidates list in warden's manifest.yaml for schema.apply, verbatim.
    invalidates: [
      "roles.list", "roles.detail", "permissions.list", "permissions.detail", "policies.list", "policies.detail",
      "resourceTypes.list", "resourceTypes.detail", "resourceTypes.graph", "relations.list", "relations.expand", "assignments.list", "assignments.expiring",
      "namespaces.list", "overview.stats", "subjects.detail", "schema.export", "schema.plan",
    ],
    handler: (payload) => schemaApply(payload),
  },
}
