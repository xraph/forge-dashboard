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
      { id: "role_01hr", namespacePath: "eng/platform", name: "Platform admin", slug: "platform-admin", isSystem: false, isDefault: false, parentSlug: "reader", maxMembers: 5, createdAt: hourAgo, updatedAt: now },
      { id: "role_01hs", namespacePath: "", name: "System", slug: "system", isSystem: true, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
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
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
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
  const limit = Math.min(Math.max(Number(params?.limit) || 25, 1), 200)
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
  if (params?.namespacePath === undefined) return rows
  return rows.filter((r) => r.namespacePath === params.namespacePath)
}

// ---------------------------------------------------------------------------
// Warden intents (eight queries, eleven commands: the original four queries
// and two commands, plus the thirteen roles and permissions intents added
// here)
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

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  "roles.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.roles, params)
      if (params?.search) {
        const q = String(params.search).toLowerCase()
        rows = rows.filter(
          (r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)
        )
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
        children: warden.roles.filter((c) => c.parentSlug === r.slug),
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
      const now = new Date().toISOString()
      const row = {
        id: "role_" + Math.random().toString(36).slice(2, 10),
        namespacePath: payload.namespacePath ?? "",
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
    invalidates: ["roles.list", "roles.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.id)
      if (!r) throw notFound("role", payload?.id)
      // The system guard, matching the Go handler. Nothing below the
      // contract layer enforces this, so the fixture must not either.
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
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
    invalidates: ["roles.list", "roles.detail", "overview.stats"],
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
    invalidates: ["roles.detail"],
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
    invalidates: ["roles.detail"],
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
    invalidates: ["roles.detail"],
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
        grantedBy: warden.roles.filter((r) => holderIds.includes(r.id)),
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
      const now = new Date().toISOString()
      const row = {
        id: "perm_" + Math.random().toString(36).slice(2, 10),
        namespacePath: payload.namespacePath ?? "",
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
    invalidates: ["permissions.list", "permissions.detail", "roles.detail", "overview.stats"],
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
}
