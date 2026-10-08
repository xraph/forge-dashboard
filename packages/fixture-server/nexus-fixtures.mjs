import { randomBytes } from "node:crypto"

// In-memory operator fixtures. Only key summaries are retained. The shared
// dispatcher uses secret:true to keep replay tombstones for key issuance.
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
const statuses = ["active", "disabled", "suspended"]
const outcomes = ["ok", "cached", "blocked", "refused", "error"]
const scopes = ["completions", "embeddings", "models", "admin"]
const capabilities = Object.fromEntries(["chat", "streaming", "embeddings", "images", "vision", "tools", "json", "audio", "thinking", "batch", "streamingReasoning", "streamingTools", "streamingAudio", "streamingCitations", "realtimeAudio", "realtimeVideo", "liveBidi"].map(name => [name, ["chat", "streaming", "embeddings", "tools", "json"].includes(name)]))
const usageEnabled = () => process.env.FIXTURE_NEXUS_USAGE_OFF !== "1"
const posture = () => ({ requireApiKey: process.env.FIXTURE_NEXUS_OPEN_GATEWAY !== "1", authenticationScope: "HTTP api and proxy routes", limiterKind: "memory", usageEnabled: usageEnabled(), guardCount: 2, cacheKind: "memory" })
const emptyQuota = () => ({ rpm: 0, tpm: 0, dailyRequests: 0, monthlyBudgetUsd: "0", maxTokensPerReq: 0, maxStreamDurationMs: 0, maxStreamTokens: 0 })
const emptyConfig = () => ({ allowedModels: [], blockedModels: [], defaultModel: "", routingStrategy: "", routingStrategyEnforced: false, guardrailPolicy: "", guardrailPolicyEnforced: false, cacheEnabled: null, metadata: null })

function typeId(prefix, value) {
  let n = value ?? (BigInt(Date.now()) << 80n) + BigInt(`0x${randomBytes(10).toString("hex")}`)
  let suffix = ""
  while (n > 0n) { suffix = alphabet[Number(n & 31n)] + suffix; n >>= 5n }
  return `${prefix}_${suffix.padStart(26, "0")}`
}

function decimalParts(value) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("Invalid decimal")
  const [whole, fraction = ""] = value.split(".")
  return { fraction, digits: BigInt(whole + fraction) }
}
function decimalText(digits, scale) {
  const negative = digits < 0n
  const text = (negative ? -digits : digits).toString().padStart(scale + 1, "0")
  const result = scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/\.?0+$/, "") : text
  return `${negative ? "-" : ""}${result}`
}
export function sumDecimals(values) {
  const parts = values.filter(v => v !== null).map(decimalParts)
  const scale = Math.max(0, ...parts.map(p => p.fraction.length))
  return decimalText(parts.reduce((sum, p) => sum + p.digits * 10n ** BigInt(scale - p.fraction.length), 0n), scale)
}
function compareDecimal(a, b) {
  const x = decimalParts(a), y = decimalParts(b)
  const difference = x.digits * 10n ** BigInt(y.fraction.length) - y.digits * 10n ** BigInt(x.fraction.length)
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

export const nexusState = { tenants: new Map(), keys: new Map(), records: [] }
export function resetNexus() {
  nexusState.tenants.clear(); nexusState.keys.clear(); nexusState.records.length = 0
  const now = Date.now()
  for (let i = 0; i < 32; i++) {
    const id = typeId("tenant", BigInt(i + 1))
    const name = ["Acme AI", "Orbit Labs", "Northwind paused"][i] ?? `Research team ${String(i + 1).padStart(2, "0")}`
    const createdAt = new Date(now - (32 - i) * 86400000).toISOString()
    nexusState.tenants.set(id, { id, name, slug: name.toLowerCase().replaceAll(" ", "-"), status: i === 2 ? "suspended" : i === 3 ? "disabled" : "active", quota: { ...emptyQuota(), rpm: 120, tpm: 120000, dailyRequests: 10000, monthlyBudgetUsd: i === 0 ? "1000" : "100", maxTokensPerReq: 8192 }, config: { ...emptyConfig(), cacheEnabled: true, defaultModel: "swift-chat", metadata: { region: "us-central" } }, metadata: { owner: "Platform" }, createdAt, updatedAt: createdAt })
    const kid = typeId("key", BigInt(i + 1))
    nexusState.keys.set(kid, { id: kid, tenantId: id, name: `${name} service`, prefix: `nxk_${String(i + 1).padStart(8, "0")}`, scopes: scopes.slice(0, 3), status: i === 4 ? "revoked" : "active", expiresAt: i === 5 ? new Date(now - 86400000).toISOString() : null, lastUsedAt: i < 2 ? new Date(now - 60000).toISOString() : null, createdAt, metadata: {} })
  }
  for (let i = 0; i < 76; i++) {
    const outcome = outcomes[i % outcomes.length]
    const unpriced = i > 0 && i % 11 === 0 && outcome === "ok"
    const costUsd = i === 0 ? "850" : outcome !== "ok" ? "0" : unpriced ? null : "0.00002190123456789"
    const tid = typeId("tenant", i === 0 ? 1n : 2n), kid = typeId("key", i === 0 ? 1n : 2n)
    nexusState.records.push({ id: typeId("usage", BigInt(i + 1)), tenantId: tid, keyId: kid, requestId: typeId("req", BigInt(i + 1)), provider: outcome === "ok" ? "cloud" : i % 2 ? "local" : "cloud", model: unpriced ? "preview-model" : outcome === "ok" ? "swift-chat" : i % 2 ? "local-chat" : "swift-chat", promptTokens: outcome === "ok" ? 240 : 0, completionTokens: outcome === "ok" ? 96 : 0, totalTokens: outcome === "ok" ? 336 : 0, costUsd, pricingStatus: unpriced ? "unpriced_model" : outcome === "cached" ? "cached" : outcome === "ok" ? "priced" : "not_charged", outcome, blockedBy: outcome === "blocked" ? "pii" : "", refusalCode: outcome === "refused" ? "rate_limit" : "", latencyMs: outcome === "cached" ? 8 : 340 + i, cached: outcome === "cached", statusCode: outcome === "error" ? 502 : outcome === "refused" ? 429 : outcome === "blocked" ? 400 : 200, createdAt: new Date(now - (76 - i) * 1000).toISOString() })
  }
}
resetNexus()

export function createNexusHandlers(FixtureError) {
  const bad = message => new FixtureError(400, "BAD_REQUEST", message)
  const missing = kind => new FixtureError(404, "NOT_FOUND", `${kind} not found`)
  function id(value, prefix) {
    if (typeof value !== "string" || !new RegExp(`^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`).test(value)) throw bad(`${prefix} ID required`)
    return value
  }
  function getTenant(value) { const row = nexusState.tenants.get(id(value, "tenant")); if (!row) throw missing("Tenant"); return row }
  function getKey(value) { const row = nexusState.keys.get(id(value, "key")); if (!row) throw missing("Key"); return row }
  function tenantScope(p) { return Object.hasOwn(p, "tenantId") ? getTenant(p.tenantId).id : undefined }
  function text(value, field, fallback = "") { if (value == null) return fallback; if (typeof value !== "string") throw bad(`${field} must be a string`); return value }
  function choice(value, choices, field) { if (!choices.includes(value)) throw bad(`Invalid ${field}`); return value }
  function page(rows, p, prefix) {
    const cursor = text(p.cursor, "cursor")
    if (cursor) id(cursor, prefix)
    if (p.limit != null && !Number.isSafeInteger(p.limit)) throw bad("limit must be an integer")
    const limit = Math.min(500, p.limit > 0 ? p.limit : 50)
    const sorted = rows.filter(row => !cursor || row.id < cursor).sort((a, b) => b.id.localeCompare(a.id))
    return { items: sorted.slice(0, limit), nextCursor: sorted.length > limit ? sorted[limit - 1].id : "" }
  }
  function periodStart(period) {
    choice(period, ["day", "week", "month"], "period")
    const now = new Date()
    if (period === "week") return now.getTime() - 7 * 86400000
    if (period === "month") now.setUTCDate(1)
    now.setUTCHours(0, 0, 0, 0)
    return now.getTime()
  }
  function inPeriod(tenantId, period) { const start = periodStart(period); return nexusState.records.filter(r => (!tenantId || r.tenantId === tenantId) && Date.parse(r.createdAt) >= start) }
  function projectTenant(row, read = true) {
    return { ...structuredClone(row), monthSpendUsd: usageEnabled() && read ? sumDecimals(inPeriod(row.id, "month").map(r => r.costUsd)) : null, requestsToday: usageEnabled() && read ? inPeriod(row.id, "day").filter(r => r.outcome !== "refused").length : null, usageEnabled: usageEnabled() }
  }
  function effectiveKey(row) { return row.status === "active" && row.expiresAt && Date.parse(row.expiresAt) <= Date.now() ? "expired" : row.status }
  function projectKey(row) { return { ...structuredClone(row), status: effectiveKey(row), tenantName: getTenant(row.tenantId).name } }
  function group(rows, field) {
    const grouped = new Map()
    for (const row of rows) { const group = grouped.get(row[field]) ?? []; group.push(row); grouped.set(row[field], group) }
    return [...grouped].map(([name, rows]) => ({ name, requests: rows.length, tokens: rows.reduce((n, r) => n + r.totalTokens, 0), costUsd: sumDecimals(rows.map(r => r.costUsd)), unpriced: rows.filter(r => r.costUsd === null).length })).sort((a, b) => compareDecimal(b.costUsd, a.costUsd) || a.name.localeCompare(b.name))
  }
  function summary(p) {
    const tenantId = tenantScope(p), start = periodStart(p.period)
    const out = { tenantId: tenantId ?? null, period: p.period, usageEnabled: usageEnabled(), totalRequests: null, totalTokens: null, totalCostUsd: null, unpricedRequests: null, cacheHitRate: null, avgLatencyMs: null, byOutcome: null, byProvider: [], byModel: [] }
    if (!usageEnabled()) return out
    const rows = nexusState.records.filter(r => (!tenantId || r.tenantId === tenantId) && Date.parse(r.createdAt) >= start)
    return { ...out, totalRequests: rows.length, totalTokens: rows.reduce((n, r) => n + r.totalTokens, 0), totalCostUsd: sumDecimals(rows.map(r => r.costUsd)), unpricedRequests: rows.filter(r => r.costUsd === null).length, cacheHitRate: rows.length ? rows.filter(r => r.cached).length / rows.length : 0, avgLatencyMs: rows.length ? Math.trunc(rows.reduce((n, r) => n + r.latencyMs, 0) / rows.length) : 0, byOutcome: Object.fromEntries(outcomes.map(outcome => [outcome, rows.filter(r => r.outcome === outcome).length])), byProvider: group(rows, "provider"), byModel: group(rows, "model") }
  }
  function timestamp(value) {
    if (value == null) return undefined
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw bad("Time bounds must be RFC3339 timestamps")
    return Date.parse(value)
  }
  function metadata(value, fallback) {
    if (value == null) return fallback
    if (typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v => typeof v !== "string")) throw bad("Metadata values must be strings")
    return structuredClone(value)
  }
  function patchTenant(row, p) {
    const next = structuredClone(row)
    if (p.name != null) { next.name = text(p.name, "name").trim(); if (!next.name) throw bad("Name is required") }
    for (const field of ["quota", "config"]) if (p[field] != null && (typeof p[field] !== "object" || Array.isArray(p[field]))) throw bad(`${field} must be an object`)
    for (const field of Object.keys(emptyQuota())) {
      const value = p.quota?.[field]
      if (value == null) continue
      if (field === "monthlyBudgetUsd") {
        if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) throw bad("monthlyBudgetUsd must be a non-negative decimal string")
        next.quota[field] = sumDecimals([value])
      } else {
        if (!Number.isSafeInteger(value) || value < 0 || (field === "maxStreamDurationMs" && value > 9223372036854)) throw bad("Quota limits must be non-negative supported integers")
        next.quota[field] = value
      }
    }
    for (const field of ["allowedModels", "blockedModels"]) {
      if (p.config?.[field] == null) continue
      if (!Array.isArray(p.config[field]) || p.config[field].some(v => typeof v !== "string" || !v.trim())) throw bad("Model names must be non-empty strings")
      next.config[field] = p.config[field].map(v => v.trim())
    }
    if (next.config.allowedModels.some(v => next.config.blockedModels.includes(v))) throw bad("A model cannot be both allowed and blocked")
    for (const field of ["defaultModel", "routingStrategy", "guardrailPolicy"]) if (p.config?.[field] != null) next.config[field] = text(p.config[field], field)
    next.config.defaultModel = next.config.defaultModel.trim()
    if (p.config && Object.hasOwn(p.config, "cacheEnabled")) {
      if (p.config.cacheEnabled !== null && typeof p.config.cacheEnabled !== "boolean") throw bad("cacheEnabled must be true, false or null")
      next.config.cacheEnabled = p.config.cacheEnabled
    }
    next.config.metadata = metadata(p.config?.metadata, next.config.metadata)
    next.metadata = metadata(p.metadata, next.metadata)
    next.updatedAt = new Date().toISOString()
    return next
  }
  function createKey(p, original) {
    const tenant = getTenant(p.tenantId), name = text(p.name, "name").trim()
    if (!name) throw bad("Name is required")
    const wanted = Object.hasOwn(p, "scopes") ? p.scopes : scopes.slice(0, 3)
    if (!Array.isArray(wanted) || !wanted.length || wanted.some(v => !scopes.includes(v))) throw bad("Choose known key scopes")
    const expires = timestamp(p.expiresAt)
    if (expires !== undefined && expires <= Date.now()) throw bad("Expiry must be in the future")
    const rawKey = `nxk_${randomBytes(32).toString("hex")}`
    const row = { id: typeId("key"), tenantId: tenant.id, name, prefix: rawKey.slice(0, 12), scopes: [...wanted], status: "active", expiresAt: expires === undefined ? null : new Date(expires).toISOString(), lastUsedAt: null, createdAt: new Date().toISOString(), metadata: original?.metadata ?? null }
    nexusState.keys.set(row.id, row)
    return { key: projectKey(row), rawKey }
  }
  const models = () => [
    { id: "swift-chat", provider: "cloud", name: "Swift Chat", capabilities, contextWindow: 128000, maxOutput: 8192, priced: true, free: false, inputPerMillionUsd: "0.150000001", outputPerMillionUsd: "0.6", embeddingPerMillionUsd: null },
    { id: "local-chat", provider: "local", name: "Local Chat", capabilities, contextWindow: 32000, maxOutput: 4096, priced: true, free: true, inputPerMillionUsd: "0", outputPerMillionUsd: "0", embeddingPerMillionUsd: "0" },
    { id: "preview-model", provider: "cloud", name: "Preview model", capabilities, contextWindow: 64000, maxOutput: 4096, priced: false, free: false, inputPerMillionUsd: null, outputPerMillionUsd: null, embeddingPerMillionUsd: null },
  ]
  const query = handler => ({ kind: "query", handler: p => structuredClone(handler(p ?? {})) })
  const command = (invalidates, handler, secret = false) => ({ kind: "command", invalidates, secret, handler: p => structuredClone(handler(p ?? {})) })
  return {
    "tenants.list": query(p => {
      const status = text(p.status, "status"), search = text(p.search, "search").toLowerCase()
      if (status) choice(status, statuses, "tenant status")
      const result = page([...nexusState.tenants.values()].filter(t => (!status || t.status === status) && (!search || t.name.toLowerCase().includes(search) || t.slug.toLowerCase().includes(search))), p, "tenant")
      return { ...result, items: result.items.map(t => projectTenant(t)) }
    }),
    "tenants.get": query(p => projectTenant(getTenant(p.id))),
    "keys.list": query(p => {
      const tenantId = tenantScope(p), status = text(p.status, "status")
      if (status) choice(status, ["active", "revoked", "expired"], "key status")
      const result = page([...nexusState.keys.values()].filter(k => (!tenantId || k.tenantId === tenantId) && (!status || effectiveKey(k) === status)), p, "key")
      return { ...result, items: result.items.map(projectKey) }
    }),
    "keys.get": query(p => projectKey(getKey(p.id))),
    "usage.summary": query(summary),
    "usage.series": query(p => {
      const tenantId = tenantScope(p); periodStart(p.period); choice(p.bucket, ["day", "hour"], "bucket")
      const grouped = new Map()
      if (usageEnabled()) for (const row of inPeriod(tenantId, p.period)) {
        const date = new Date(row.createdAt)
        p.bucket === "day" ? date.setUTCHours(0, 0, 0, 0) : date.setUTCMinutes(0, 0, 0)
        const start = date.toISOString(), rows = grouped.get(start) ?? []
        rows.push(row); grouped.set(start, rows)
      }
      return { usageEnabled: usageEnabled(), items: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([start, rows]) => ({ start, requests: rows.length, tokens: rows.reduce((n, r) => n + r.totalTokens, 0), costUsd: sumDecimals(rows.map(r => r.costUsd)), unpriced: rows.filter(r => r.costUsd === null).length })) }
    }),
    "usage.records": query(p => {
      const tenantId = tenantScope(p), keyId = Object.hasOwn(p, "keyId") ? getKey(p.keyId).id : undefined
      if (tenantId && keyId && getKey(keyId).tenantId !== tenantId) throw bad("Key does not belong to this tenant")
      const outcome = text(p.outcome, "outcome"), provider = text(p.provider, "provider"), model = text(p.model, "model")
      if (outcome) choice(outcome, outcomes, "outcome")
      const from = timestamp(p.from), to = timestamp(p.to)
      if (from !== undefined && to !== undefined && to <= from) throw bad("to must be after from")
      const rows = usageEnabled() ? nexusState.records.filter(r => (!tenantId || r.tenantId === tenantId) && (!keyId || r.keyId === keyId) && (!provider || r.provider === provider) && (!model || r.model === model) && (!outcome || r.outcome === outcome) && (from === undefined || Date.parse(r.createdAt) >= from) && (to === undefined || Date.parse(r.createdAt) < to)) : []
      return { usageEnabled: usageEnabled(), ...page(rows, p, "usage") }
    }),
    "overview.get": query(() => {
      const month = summary({ period: "month" })
      return { tenants: { total: nexusState.tenants.size, ...Object.fromEntries(statuses.map(status => [status, [...nexusState.tenants.values()].filter(t => t.status === status).length])) }, activeKeys: [...nexusState.keys.values()].filter(k => effectiveKey(k) === "active").length, monthSpendUsd: month.totalCostUsd, unpricedRequests: month.unpricedRequests, requestsToday: usageEnabled() ? inPeriod(undefined, "day").filter(r => r.outcome !== "refused").length : null, byOutcome: month.byOutcome, outcomePeriod: "month", posture: posture(), insertErrors: 0, limiterErrors: 0 }
    }),
    "models.list": query(() => ({ items: models() })),
    "providers.list": query(() => {
      const to = new Date(), from = new Date(to.getTime() - 15 * 60000)
      return { items: ["cloud", "local"].map(name => { const rows = nexusState.records.filter(r => r.provider === name && Date.parse(r.createdAt) >= from.getTime() && Date.parse(r.createdAt) < to.getTime()); return { name, capabilities, modelCount: models().filter(m => m.provider === name).length, requests: usageEnabled() ? rows.length : null, errors: usageEnabled() ? rows.filter(r => r.outcome === "error").length : null } }), usageEnabled: usageEnabled(), from: from.toISOString(), to: to.toISOString() }
    }),
    "gateway.get": query(() => ({ stages: [{ name: "auth", priority: 100, terminal: false }, { name: "quota", priority: 200, terminal: false }, { name: "guard", priority: 300, terminal: false }, { name: "cache", priority: 400, terminal: false }, { name: "route", priority: 500, terminal: true }], stagesAvailable: true, routingStrategy: "cost_optimized", routingCaveats: ["Picks the first healthy provider while candidates have no cost or latency data."], guards: [{ name: "pii", phase: "input" }, { name: "content", phase: "output" }], guardCaveats: ["The default pipeline does not guard streamed output. Built-in text guards skip non-text content."], cache: { kind: "memory", streamKind: "memory", hits: 148, misses: 492, hitRate: 148 / 640, size: null, bytes: null, statsScope: "completion cache since startup" }, aliases: [{ name: "assistant", targets: [{ provider: "cloud", model: "swift-chat", weight: 1 }], tenantOverrides: {} }], transforms: [{ name: "system-prompt", phase: "request", streaming: false }], posture: posture(), enforcementCaveats: ["Monthly budgets are soft limits. In-flight requests, unpriced calls and records that fail to store can exceed the budget.", "Limiter failures allow requests through; limiterErrors counts them.", ...(!usageEnabled() ? ["Usage collection is disabled. Monthly budgets are not enforced; daily limits still apply."] : [])] })),
    "settings.get": query(() => ({ basePath: "/nexus", defaultTimeoutMs: 60000, defaultMaxRetries: 3, globalRateLimit: 1000, usageEnabled: usageEnabled(), cacheEnabled: true, requireApiKey: posture().requireApiKey, logLevel: "info", authenticationScope: posture().authenticationScope })),
    "tenants.create": command(["tenants.list", "overview.get"], p => {
      const name = text(p.name, "name").trim(), slug = text(p.slug, "slug").trim()
      if (!name || !slug) throw bad("Name and slug are required")
      const row = patchTenant({ id: typeId("tenant"), name, slug, status: "active", quota: emptyQuota(), config: emptyConfig(), metadata: null, createdAt: new Date().toISOString() }, p)
      if ([...nexusState.tenants.values()].some(t => t.slug === slug)) throw new FixtureError(409, "CONFLICT", "Tenant slug already exists")
      nexusState.tenants.set(row.id, row)
      return projectTenant(row, false)
    }),
    "tenants.update": command(["tenants.list", "tenants.get", "overview.get", "keys.list", "keys.get"], p => { const row = patchTenant(getTenant(p.id), p); nexusState.tenants.set(row.id, row); return projectTenant(row, false) }),
    "tenants.setStatus": command(["tenants.list", "tenants.get", "overview.get"], p => { choice(p.status, statuses, "tenant status"); const row = getTenant(p.id); row.status = p.status; row.updatedAt = new Date().toISOString(); return { ...projectTenant(row, false), updatedAt: null } }),
    "keys.create": command(["keys.list", "tenants.get", "overview.get"], p => createKey(p), true),
    "keys.rotate": command(["keys.list", "keys.get", "tenants.get"], p => {
      const row = getKey(p.id)
      if (effectiveKey(row) !== "active") throw bad("Only an active key can be rotated")
      const result = createKey({ tenantId: row.tenantId, name: `${row.name.replace(/ \(rotated\)$/, "")} (rotated)`, scopes: row.scopes, expiresAt: row.expiresAt }, row)
      row.status = "revoked"
      return { ...result, revokedKeyId: row.id }
    }, true),
    "keys.revoke": command(["keys.list", "keys.get", "tenants.get", "overview.get"], p => { const row = getKey(p.id); row.status = "revoked"; return projectKey(row) }),
  }
}
