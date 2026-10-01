// bastion-fixtures.mjs: in-memory state and intent handlers for the bastion
// contributor (packages/plugin-bastion). Mirrors
// forgery/bastion/extension/contract; field names are the Go JSON tags.
//
// Self-contained: it imports nothing from server.mjs. server.mjs hands over
// its FixtureError class so refusals keep their status and code.
//
// Deliberate differences from a live gateway: counters advance on every
// overview.stats and traffic.stats read, so a polling page visibly moves.

const ORDERS = "9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36"
const STARTED_AT = "2026-09-30T08:00:00Z"

function seed() {
  const t = (id, url, healthy, circuitState, stats, extra = {}) => ({
    id, url, weight: 1, tags: [], healthy, circuitState,
    stats: { activeConns: 0, avgLatencyMs: 0, ...stats },
    tls: false, metadataKeys: [], ...extra,
  })
  const route = (r) => ({
    methods: [], protocol: "http", serviceName: "", enabled: true, config: false,
    stripPrefix: false, addPrefix: "", rewritePath: "",
    headers: {}, metadataKeys: [], version: 1,
    createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-30T07:30:00Z",
    ...r,
  })
  return {
    tick: 0,
    nextId: 1,
    lastRefresh: "2026-09-30T09:00:00Z",
    discoveredAt: { billing: "2026-09-30T08:01:00Z", search: "2026-09-30T08:01:05Z" },
    routes: [
      route({
        id: ORDERS, path: "/gw/orders", methods: ["GET", "POST"], source: "manual", priority: 105,
        editable: true, input: { path: "/orders", priority: 5 }, stripPrefix: true,
        transform: { requestHeaders: { set: { "X-Api-Key": "[redacted]", "X-Env": "prod" } }, responseHeaders: {} },
        retry: {
          enabled: true, maxAttempts: 3, backoff: "exponential",
          initialDelay: 100000000, maxDelay: 5000000000, multiplier: 2, jitter: true,
          retryableStatus: [502, 503, 504], retryableMethods: ["GET"], budgetPercent: 20,
        },
        targets: [
          t(`${ORDERS}/0`, "http://orders-a:8080", true, "closed", { totalRequests: 1840, totalErrors: 12, avgLatencyMs: 42.5 }, { healthCheckPath: "/healthz", metadataKeys: ["health_check_path"] }),
          t(`${ORDERS}/1`, "http://orders-b:8080", true, "open", { totalRequests: 310, totalErrors: 44, avgLatencyMs: 180.2 }),
        ],
      }),
      route({
        id: "manual-/users", path: "/gw/users", source: "manual", priority: 110, editable: true, config: true,
        input: { path: "/users", priority: 10 },
        targets: [t("target-/users-http://users:8080", "http://users:8080", true, "half_open", { totalRequests: 920, totalErrors: 3, avgLatencyMs: 18.1 })],
      }),
      route({
        id: "farp-billing-http", path: "/billing/*", source: "farp", serviceName: "billing", priority: 0, editable: false,
        targets: [t("farp-billing-0", "http://billing:9000", false, "closed", { totalRequests: 55, totalErrors: 55, avgLatencyMs: 0 })],
      }),
      route({
        id: "discovery-search", path: "/search/*", source: "discovery", serviceName: "search", protocol: "grpc",
        priority: 0, editable: false, enabled: false,
        targets: [t("discovery-search-0", "http://search:50051", true, "closed", { totalRequests: 0, totalErrors: 0 })],
      }),
    ],
  }
}

let bastion = seed()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetBastion() {
  bastion = seed()
}

const pct = (n, d) => (d === 0 ? null : (n / d) * 100)

function summary(r) {
  return {
    id: r.id, path: r.path, methods: r.methods, protocol: r.protocol, source: r.source,
    serviceName: r.serviceName, priority: r.priority, enabled: r.enabled,
    targetCount: r.targets.length, healthyTargets: r.targets.filter((t) => t.healthy).length,
    editable: r.editable, config: r.config, updatedAt: r.updatedAt,
  }
}

function routeTotals(r) {
  return r.targets.reduce(
    (a, t) => ({ req: a.req + t.stats.totalRequests, err: a.err + t.stats.totalErrors }),
    { req: 0, err: 0 },
  )
}

/** Moves every answered route forward a little, so polling shows movement. */
function advance() {
  bastion.tick += 1
  for (const r of bastion.routes) {
    if (!r.enabled) continue
    for (const t of r.targets) {
      if (t.circuitState === "open" || !t.healthy) continue
      t.stats.totalRequests += 3
      if (bastion.tick % 5 === 0) t.stats.totalErrors += 1
    }
  }
}

function upstreams() {
  const byUrl = new Map()
  const rank = { closed: 0, half_open: 1, open: 2 }
  for (const r of bastion.routes) {
    for (const t of r.targets) {
      const u = byUrl.get(t.url) ?? {
        url: t.url, healthy: true, circuitState: "closed", activeConns: 0,
        totalRequests: 0, totalErrors: 0, avgLatencyMs: 0, routes: [], _w: 0,
      }
      u.healthy = u.healthy && t.healthy
      if (rank[t.circuitState] > rank[u.circuitState]) u.circuitState = t.circuitState
      u.totalRequests += t.stats.totalRequests
      u.totalErrors += t.stats.totalErrors
      u._w += t.stats.avgLatencyMs * t.stats.totalRequests
      u.routes.push({ routeId: r.id, path: r.path, targetId: t.id })
      byUrl.set(t.url, u)
    }
  }
  return [...byUrl.values()]
    .map(({ _w, ...u }) => ({ ...u, avgLatencyMs: u.totalRequests ? _w / u.totalRequests : 0 }))
    .sort((a, b) => a.url.localeCompare(b.url))
}

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 */
export function createBastionHandlers(FixtureError) {
  const bad = (field, message) => new FixtureError(400, "BAD_REQUEST", message, { field })
  const conflict = (message, details) => new FixtureError(409, "CONFLICT", message, details)
  const notFound = (message) => new FixtureError(404, "NOT_FOUND", message)
  const SCHEMES = new Set(["http:", "https:", "ws:", "wss:"])
  const ROUTE_WRITE = ["routes.list", "routes.detail", "upstreams.list", "overview.stats", "traffic.stats", "circuits.list"]

  function requireId(raw) {
    const id = typeof raw === "string" ? raw.trim() : ""
    if (!id) throw new FixtureError(400, "BAD_REQUEST", "id is required")
    return id
  }
  function find(id) {
    const r = bastion.routes.find((x) => x.id === id)
    if (!r) throw notFound("route not found")
    return r
  }
  function manual(id) {
    const r = find(id)
    if (r.source !== "manual") {
      throw conflict(`route "${id}" comes from ${r.source}; its next update would undo any change made here`, { reason: "source", source: r.source })
    }
    return r
  }
  function validate(f) {
    if (typeof f.path !== "string" || !f.path.startsWith("/")) throw bad("path", "must start with /")
    if (!Array.isArray(f.targets) || f.targets.length === 0) throw bad("targets", "at least one upstream is required")
    const seen = new Set()
    f.targets.forEach((t, i) => {
      let u
      try { u = new URL(t.url) } catch { u = null }
      if (!u || !u.host || !SCHEMES.has(u.protocol)) throw bad("targets", `upstream ${i + 1}: "${t.url}" is not an http, https, ws or wss URL`)
      if (seen.has(t.url)) throw bad("targets", `upstream ${i + 1}: ${t.url} is listed twice`)
      seen.add(t.url)
      if (t.weight < 0) throw bad("targets", `upstream ${i + 1}: weight cannot be negative`)
    })
  }
  const overlap = (a, b) => a.length === 0 || b.length === 0 || a.some((m) => b.some((x) => x.toUpperCase() === m.toUpperCase()))
  function checkConflict(id, fullPath, methods) {
    const other = bastion.routes.find((r) => r.id !== id && r.source === "manual" && r.path === fullPath && overlap(r.methods, methods))
    if (other) throw conflict(`route "${other.id}" already serves ${fullPath} for an overlapping method`, { reason: "duplicate", routeId: other.id })
  }
  function targetsFor(id, inputs, prior = []) {
    return inputs.map((t, i) => {
      const kept = prior.find((p) => p.url === t.url)
      return {
        ...(kept ?? { id: `${id}/${i}`, healthy: true, circuitState: "closed", stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [] }),
        url: t.url, weight: t.weight || 1, tags: t.tags ?? [],
      }
    })
  }

  return {
    "overview.stats": {
      kind: "query",
      handler: () => {
        advance()
        const totals = bastion.routes.map(routeTotals).reduce((a, b) => ({ req: a.req + b.req, err: a.err + b.err }), { req: 0, err: 0 })
        const ups = upstreams()
        const targets = bastion.routes.flatMap((r) => r.targets)
        const top = bastion.routes
          .map((r) => ({ routeId: r.id, path: r.path, totalRequests: routeTotals(r).req, totalErrors: routeTotals(r).err }))
          .filter((r) => r.totalRequests > 0)
          .sort((a, b) => b.totalRequests - a.totalRequests)
          .slice(0, 5)
        return {
          totalRequests: totals.req, totalErrors: totals.err, errorRate: pct(totals.err, totals.req),
          avgLatencyMs: 48.3, p99LatencyMs: 212.0, latencySamples: 4096,
          // The cache never stores, so a real gateway with caching on shows lookups and no hits.
          cacheLookups: 0, cacheHitRate: null,
          rateLimited: 14, circuitBreaks: 37,
          totalRoutes: bastion.routes.length, enabledRoutes: bastion.routes.filter((r) => r.enabled).length,
          healthyUpstreams: ups.filter((u) => u.healthy).length, totalUpstreams: ups.length,
          openCircuits: targets.filter((t) => t.circuitState === "open").length,
          halfOpenCircuits: targets.filter((t) => t.circuitState === "half_open").length,
          circuitBreakerEnabled: true, discoveryEnabled: true,
          startedAt: STARTED_AT, uptimeSeconds: 7200 + bastion.tick * 10,
          topRoutes: top,
        }
      },
    },
    "traffic.stats": {
      kind: "query",
      handler: () => {
        advance()
        const routes = bastion.routes
          .map((r) => {
            const { req, err } = routeTotals(r)
            return {
              routeId: r.id, path: r.path, totalRequests: req, totalErrors: err, errorRate: pct(err, req),
              avgLatencyMs: req ? 40 : null, p99LatencyMs: req ? 190 : null, latencySamples: req ? Math.min(req, 1024) : 0,
            }
          })
          .filter((r) => r.totalRequests > 0)
          .sort((a, b) => b.totalRequests - a.totalRequests)
        const totalRequests = routes.reduce((a, r) => a + r.totalRequests, 0)
        const totalErrors = routes.reduce((a, r) => a + r.totalErrors, 0)
        return {
          totalRequests, totalErrors, rateLimited: 14, circuitBreaks: 37, cacheHits: 0, cacheMisses: 0,
          retriesMeasured: false, avgLatencyMs: 48.3, p99LatencyMs: 212.0, latencySamples: 4096,
          routes, total: routes.length,
        }
      },
    },
    "circuits.list": {
      kind: "query",
      handler: () => {
        const circuits = bastion.routes
          .flatMap((r) => r.targets.map((t) => ({ r, t })))
          .map(({ r, t }) => ({
            targetId: t.id, url: t.url, routes: [{ routeId: r.id, path: r.path, targetId: t.id }],
            tracked: t.stats.totalRequests > 0, state: t.circuitState,
            failureCount: t.circuitState === "closed" ? 0 : 5,
            lastFailure: t.circuitState === "closed" ? null : "2026-09-30T09:41:00Z",
            lastStateChange: t.stats.totalRequests > 0 ? "2026-09-30T09:41:00Z" : null,
          }))
          .sort((a, b) => a.targetId.localeCompare(b.targetId))
        return { enabled: true, failureThreshold: 5, resetTimeoutSeconds: 30, halfOpenMax: 3, circuits, total: circuits.length }
      },
    },
    "routes.list": {
      kind: "query",
      handler: (params) => {
        const routes = bastion.routes
          .filter((r) => !params?.source || r.source === params.source)
          .filter((r) => !params?.protocol || r.protocol === params.protocol)
          .map(summary)
        return { routes, total: routes.length }
      },
    },
    "routes.detail": {
      kind: "query",
      handler: (params) => {
        const id = typeof params?.id === "string" ? params.id.trim() : ""
        if (!id) throw new FixtureError(400, "BAD_REQUEST", "id is required")
        const r = bastion.routes.find((x) => x.id === id)
        if (!r) throw new FixtureError(404, "NOT_FOUND", "route not found")
        const { targets, input, ...rest } = r
        return { ...summary(r), ...rest, ...(input ? { input } : {}), targets }
      },
    },
    "upstreams.list": {
      kind: "query",
      handler: () => {
        const ups = upstreams()
        return { upstreams: ups, total: ups.length }
      },
    },
    "services.list": {
      kind: "query",
      handler: () => {
        const services = [
          { name: "billing", version: "2.4.1", address: "10.0.4.12", port: 9000, protocols: ["http"], healthy: false, routeCount: 1, discoveredAt: bastion.discoveredAt.billing, metadataKeys: ["team"] },
          { name: "search", version: "1.0.0", address: "10.0.4.20", port: 50051, protocols: ["grpc"], healthy: true, routeCount: 1, discoveredAt: bastion.discoveredAt.search, metadataKeys: [] },
        ]
        return { discoveryEnabled: true, services, total: services.length }
      },
    },
    "openapi.summary": {
      kind: "query",
      handler: () => {
        const services = [
          { serviceName: "billing", version: "2.4.1", specUrl: "http://billing:9000/openapi.json", healthy: false, pathCount: 0, error: "GET http://billing:9000/openapi.json: connection refused", fetchedAt: "2026-09-30T09:00:00Z" },
          { serviceName: "orders", version: "3.1.0", specUrl: "http://orders-a:8080/openapi.json", healthy: true, pathCount: 14, fetchedAt: "2026-09-30T09:00:00Z" },
        ]
        return { enabled: true, running: true, specPath: "/gateway/openapi.json", lastRefresh: bastion.lastRefresh, totalPaths: 14, services, total: services.length }
      },
    },
    "config.detail": {
      kind: "query",
      handler: () => ({
        sections: [
          { id: "gateway", title: "Gateway", enabled: true, settings: [{ key: "Base path", value: "/gw" }, { key: "Routes in config", value: "1" }] },
          { id: "circuitBreaker", title: "Circuit breaker", enabled: true, settings: [{ key: "Failure threshold", value: "5" }, { key: "Reset timeout", value: "30s" }, { key: "Half-open probes", value: "3" }] },
          { id: "retry", title: "Retry", enabled: true, note: "Nothing in the proxy calls the retry policy, so no request is retried whatever this says.", settings: [{ key: "Max attempts", value: "3" }] },
          { id: "caching", title: "Response cache", enabled: false, note: "Nothing writes to the cache, so every lookup misses whatever this says.", settings: [{ key: "Default TTL", value: "5m0s" }] },
          { id: "tls", title: "Upstream TLS", enabled: true, settings: [{ key: "Client key", value: "set" }, { key: "CA certificate", value: "not set" }] },
          { id: "ipFilter", title: "IP filter", enabled: true, settings: [{ key: "Allow list", value: "2 addresses" }, { key: "Deny list", value: "0 addresses" }] },
          { id: "timeouts", title: "Timeouts", enabled: null, settings: [{ key: "Connect", value: "5s" }, { key: "Read", value: "30s" }] },
        ],
      }),
    },
    // Commands come after the queries, in this order: verify.mjs walks the
    // table, and routes.delete removes what routes.create made.
    "routes.create": {
      kind: "command",
      invalidates: ROUTE_WRITE,
      handler: (f) => {
        f = f ?? {}
        validate(f)
        const methods = (f.methods ?? []).map((m) => m.toUpperCase())
        const fullPath = "/gw" + f.path
        checkConflict("", fullPath, methods)
        const id = `00000000-0000-4000-8000-${String(bastion.nextId++).padStart(12, "0")}`
        const now = new Date().toISOString()
        const priority = f.priority ?? 0
        const route = {
          id, path: fullPath, methods, protocol: f.protocol || "http", serviceName: "", source: "manual",
          priority: priority + 100, enabled: Boolean(f.enabled), editable: true, config: false,
          input: { path: f.path, priority },
          stripPrefix: Boolean(f.stripPrefix), addPrefix: f.addPrefix ?? "", rewritePath: f.rewritePath ?? "",
          headers: {}, metadataKeys: [], version: 1, createdAt: now, updatedAt: now,
          targets: targetsFor(id, f.targets),
        }
        if (f.rateLimit != null) route.rateLimit = f.rateLimit
        if (f.auth != null) route.auth = f.auth
        bastion.routes.push(route)
        return { id }
      },
    },
    "routes.update": {
      kind: "command",
      invalidates: ROUTE_WRITE,
      handler: (f) => {
        f = f ?? {}
        const id = requireId(f.id)
        const r = manual(id)
        const next = {
          path: f.path ?? r.input?.path ?? r.path.replace(/^\/gw/, ""),
          priority: f.priority ?? r.input?.priority ?? r.priority - 100,
          methods: f.methods ? f.methods.map((m) => m.toUpperCase()) : r.methods,
          targets: f.targets ?? r.targets,
        }
        validate(next)
        checkConflict(id, "/gw" + next.path, next.methods)
        r.path = "/gw" + next.path
        r.priority = next.priority + 100
        r.input = { path: next.path, priority: next.priority }
        r.methods = next.methods
        if (f.targets) r.targets = targetsFor(id, f.targets, r.targets)
        for (const k of ["enabled", "protocol", "stripPrefix", "addPrefix", "rewritePath"]) {
          if (f[k] !== undefined) r[k] = f[k]
        }
        for (const k of ["rateLimit", "auth"]) {
          if (f[k] === undefined) continue
          if (f[k] === null) delete r[k]
          else r[k] = f[k]
        }
        r.version += 1
        r.updatedAt = new Date().toISOString()
        return { id }
      },
    },
    "routes.setEnabled": {
      kind: "command",
      invalidates: ["routes.list", "routes.detail", "overview.stats"],
      handler: (f) => {
        const id = requireId(f?.id)
        if (typeof f.enabled !== "boolean") throw bad("enabled", "enabled is required")
        const r = manual(id)
        r.enabled = f.enabled
        r.updatedAt = new Date().toISOString()
        // The fixture has no route store, so nothing outlives a restart.
        return { id, enabled: f.enabled, durable: false }
      },
    },
    "routes.delete": {
      kind: "command",
      invalidates: ROUTE_WRITE,
      handler: (f) => {
        const id = requireId(f?.id)
        manual(id)
        bastion.routes = bastion.routes.filter((r) => r.id !== id)
        return { ok: true, id }
      },
    },
    "discovery.refresh": {
      kind: "command",
      invalidates: ["services.list", "routes.list", "routes.detail", "upstreams.list", "overview.stats", "openapi.summary"],
      handler: () => {
        const now = new Date().toISOString()
        for (const name of Object.keys(bastion.discoveredAt)) bastion.discoveredAt[name] = now
        return { ok: true }
      },
    },
    "openapi.refresh": {
      kind: "command",
      invalidates: ["openapi.summary"],
      handler: () => {
        bastion.lastRefresh = new Date().toISOString()
        return { started: true }
      },
    },
    "circuits.reset": {
      kind: "command",
      invalidates: ["circuits.list", "upstreams.list", "routes.detail", "overview.stats"],
      handler: (f) => {
        const targetId = typeof f?.targetId === "string" ? f.targetId.trim() : ""
        if (!targetId) throw bad("targetId", "targetId is required")
        const target = bastion.routes.flatMap((r) => r.targets).find((t) => t.id === targetId)
        if (!target) throw notFound("this target has no circuit breaker yet; it gets one on its first proxied request")
        target.circuitState = "closed"
        return { targetId, state: "closed" }
      },
    },
  }
}
