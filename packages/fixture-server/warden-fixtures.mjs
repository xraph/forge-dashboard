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

function seedWardenState() {
  const now = new Date().toISOString()
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  return {
    roles: [
      { id: "role_01hq", namespacePath: "", name: "Reader", slug: "reader", isSystem: false, isDefault: true, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "role_01hr", namespacePath: "eng/platform", name: "Platform admin", slug: "platform-admin", isSystem: false, isDefault: false, parentSlug: "reader", maxMembers: 5, createdAt: hourAgo, updatedAt: now },
      { id: "role_01hs", namespacePath: "", name: "System", slug: "system", isSystem: true, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    permissions: [
      { id: "perm_01a", namespacePath: "", name: "document:read", resource: "document", action: "read", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "perm_01b", namespacePath: "", name: "document:write", resource: "document", action: "write", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "perm_01c", namespacePath: "eng/platform", name: "cluster:admin", resource: "cluster", action: "admin", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    assignments: [
      { id: "asgn_01a", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "alice", expiresAt: null, createdAt: hourAgo },
      // Expired on purpose: maintenance.run must be able to report a purge.
      { id: "asgn_01b", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "carol", expiresAt: hourAgo, createdAt: hourAgo },
    ],
    relations: [
      { id: "rel_01a", namespacePath: "", objectType: "document", objectId: "readme", relation: "viewer", subjectType: "user", subjectId: "bob", subjectRelation: "", createdAt: hourAgo },
      { id: "rel_01b", namespacePath: "", objectType: "folder", objectId: "root", relation: "parent", subjectType: "document", subjectId: "readme", subjectRelation: "", createdAt: hourAgo },
    ],
    policies: [
      { id: "pol_01a", namespacePath: "", name: "contractor-lockout", effect: "deny", priority: 10, isActive: true, createdAt: hourAgo, updatedAt: now },
    ],
    resourceTypes: [
      { id: "rt_01a", namespacePath: "", name: "document", description: "A document", createdAt: hourAgo, updatedAt: hourAgo },
    ],
    checkLogs: [
      { id: "chk_01a", namespacePath: "", subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "readme", decision: "allow", reason: "", evalTimeNs: 412_000, cached: false, error: "", createdAt: now },
      // Cached: the most common real answer to "why did my permission change
      // not take effect", and the page's scan signal.
      { id: "chk_01b", namespacePath: "", subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "readme", decision: "allow", reason: "", evalTimeNs: 1_800, cached: true, error: "", createdAt: now },
      { id: "chk_01c", namespacePath: "", subjectKind: "user", subjectId: "dave", action: "delete", resourceType: "document", resourceId: "readme", decision: "deny_explicit", reason: 'denied by policy "contractor-lockout"', evalTimeNs: 902_000, cached: false, error: "", createdAt: now },
      { id: "chk_01d", namespacePath: "eng/platform", subjectKind: "service", subjectId: "deployer", action: "admin", resourceType: "cluster", resourceId: "prod", decision: "error", reason: "", evalTimeNs: 0, cached: false, error: "store unavailable", createdAt: now },
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

// ---------------------------------------------------------------------------
// Warden intents (four queries, two commands in this plan)
// ---------------------------------------------------------------------------

/** Every distinct namespace on any warden entity, plus the tenant root. */
function wardenNamespaces() {
  const seen = new Set([""])
  for (const group of [warden.roles, warden.permissions, warden.assignments, warden.relations, warden.policies, warden.resourceTypes]) {
    for (const row of group) seen.add(row.namespacePath)
  }
  return [...seen].sort()
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
    invalidates: ["overview.stats", "overview.recentChecks"],
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
}
