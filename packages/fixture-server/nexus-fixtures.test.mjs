import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { createNexusHandlers, resetNexus, nexusState, sumDecimals } from "./nexus-fixtures.mjs"

class FixtureError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code } }
const handlers = createNexusHandlers(FixtureError)
const call = (intent, params = {}) => handlers[intent].handler(params)
const bad = (intent, params, code = "BAD_REQUEST") => assert.throws(() => call(intent, params), error => error.code === code)
let tenant, other, key
beforeEach(() => {
  delete process.env.FIXTURE_NEXUS_USAGE_OFF
  delete process.env.FIXTURE_NEXUS_OPEN_GATEWAY
  resetNexus()
  tenant = call("tenants.list", { search: "Acme" }).items[0]
  other = call("tenants.list", { search: "Orbit" }).items[0]
  key = call("keys.list", { tenantId: tenant.id, status: "active" }).items[0]
})

test("all 18 intents and exact accounting", () => {
  assert.equal(Object.keys(handlers).length, 18)
  assert.equal(sumDecimals(["9007199254740993.0000000001", "0.0000000002"]), "9007199254740993.0000000003")
  const summary = call("usage.summary", { tenantId: tenant.id, period: "month" })
  assert.equal(summary.totalCostUsd, "850")
  assert.equal(tenant.quota.monthlyBudgetUsd, "1000")
  assert.equal(tenant.monthSpendUsd, "850")
  for (const intent of ["overview.get", "models.list", "providers.list", "gateway.get", "settings.get"]) assert.ok(call(intent))
  assert.ok(call("usage.series", { period: "day", bucket: "hour" }).items.length)
})

test("cursor paging, status and search filter before paging", () => {
  const first = call("tenants.list", { limit: 2 })
  const second = call("tenants.list", { limit: 2, cursor: first.nextCursor })
  assert.equal(first.items.length, 2)
  assert.equal(new Set([...first.items, ...second.items].map(t => t.id)).size, 4)
  assert.deepEqual(call("tenants.list", { search: "Acme", status: "active", limit: 1 }).items.map(t => t.id), [tenant.id])
  bad("tenants.list", { cursor: "bad" })
  bad("tenants.list", { status: "unknown" })
  bad("keys.list", { status: "unknown" })
})

test("explicit invalid scope never broadens reads, including disabled usage", () => {
  for (const disabled of [false, true]) {
    if (disabled) process.env.FIXTURE_NEXUS_USAGE_OFF = "1"
    for (const intent of ["keys.list", "usage.summary", "usage.series", "usage.records"]) {
      for (const tenantId of [null, "", 5, [], "bad"]) bad(intent, { tenantId, period: "month", bucket: "day" })
      bad(intent, { tenantId: "tenant_00000000000000000000000000", period: "month", bucket: "day" }, "NOT_FOUND")
    }
    bad("usage.records", { tenantId: other.id, keyId: key.id })
    bad("usage.records", { keyId: "" })
    bad("usage.records", { outcome: "unknown" })
    bad("usage.records", { from: "yesterday" })
    bad("usage.records", { from: "2026-10-08T01:00:00Z", to: "2026-10-08T00:00:00Z" })
    bad("usage.records", { cursor: tenant.id })
    bad("usage.summary", { period: "year" })
    bad("usage.series", { period: "day", bucket: "week" })
  }
})

test("usage records apply every filter with inclusive start and exclusive end", () => {
  const records = call("usage.records", { tenantId: other.id }).items
  const record = records.find(r => r.outcome === "ok")
  assert.ok(record)
  const params = { tenantId: other.id, keyId: record.keyId, provider: record.provider, model: record.model, outcome: record.outcome, from: record.createdAt, to: new Date(Date.parse(record.createdAt) + 1).toISOString() }
  assert.deepEqual(call("usage.records", params).items.map(r => r.id), [record.id])
  assert.equal(call("usage.records", { ...params, provider: "missing" }).items.length, 0)
  assert.equal(call("usage.records", { ...params, model: "missing" }).items.length, 0)
  assert.equal(call("usage.records", { ...params, from: undefined, to: record.createdAt }).items.some(r => r.id === record.id), false)
})

test("dirty tenant updates preserve nested fields and both metadata maps", () => {
  const changed = call("tenants.update", { id: tenant.id, name: "Acme renamed", quota: { rpm: 99 }, config: { cacheEnabled: null } })
  assert.equal(changed.name, "Acme renamed")
  assert.equal(changed.quota.rpm, 99)
  assert.equal(changed.quota.monthlyBudgetUsd, "1000")
  assert.deepEqual(changed.metadata, tenant.metadata)
  assert.deepEqual(changed.config.metadata, tenant.config.metadata)
  assert.equal(changed.config.cacheEnabled, null)
  assert.equal(call("keys.get", { id: key.id }).tenantName, "Acme renamed")
  assert.ok(handlers["tenants.update"].invalidates.includes("keys.get"))
  call("tenants.setStatus", { id: tenant.id, status: "disabled" })
  assert.equal(call("tenants.get", { id: tenant.id }).status, "disabled")
  call("tenants.update", { id: tenant.id, metadata: {}, config: { metadata: {} } })
  assert.deepEqual(call("tenants.get", { id: tenant.id }).metadata, {})
  for (const quota of [{ rpm: -1 }, { tpm: 1.5 }, { monthlyBudgetUsd: 3 }, { monthlyBudgetUsd: "-1" }, { maxStreamDurationMs: 9223372036855 }]) bad("tenants.update", { id: tenant.id, quota })
  bad("tenants.update", { id: tenant.id, config: { allowedModels: ["same"], blockedModels: ["same"] } })
  bad("tenants.update", { id: tenant.id, config: { cacheEnabled: "yes" } })
  bad("tenants.update", { id: tenant.id, name: " " })
  bad("tenants.setStatus", { id: tenant.id, status: "unknown" })
  bad("tenants.create", { name: "x", slug: tenant.slug }, "CONFLICT")
  const created = call("tenants.create", { name: "New", slug: "new", quota: { monthlyBudgetUsd: "0.0000000001" } })
  assert.equal(call("tenants.get", { id: created.id }).quota.monthlyBudgetUsd, "0.0000000001")
})

test("keys issue once and rotation immediately revokes without retaining a secret", () => {
  const created = call("keys.create", { tenantId: tenant.id, name: "New key" })
  assert.match(created.rawKey, /^nxk_[0-9a-f]{64}$/)
  assert.deepEqual(created.key.scopes, ["completions", "embeddings", "models"])
  const rotated = call("keys.rotate", { id: created.key.id })
  assert.equal(call("keys.get", { id: created.key.id }).status, "revoked")
  assert.equal(rotated.revokedKeyId, created.key.id)
  assert.equal(handlers["keys.create"].secret, true)
  assert.equal(handlers["keys.rotate"].secret, true)
  const stored = JSON.stringify({ ...nexusState, tenants: [...nexusState.tenants.values()], keys: [...nexusState.keys.values()] })
  assert.equal(stored.includes(created.rawKey), false)
  assert.equal(stored.includes(rotated.rawKey), false)
  assert.equal(/"(?:rawKey|hash)"/.test(stored), false)
  const reads = JSON.stringify(Object.entries(handlers).filter(([, h]) => h.kind === "query").map(([intent]) => call(intent, intent === "tenants.get" ? { id: tenant.id } : intent === "keys.get" ? { id: rotated.key.id } : { period: "month", bucket: "day" })))
  assert.equal(reads.includes(created.rawKey), false)
  assert.equal(reads.includes(rotated.rawKey), false)
  assert.equal(/"(?:rawKey|hash)"/.test(reads), false)
  call("keys.revoke", { id: rotated.key.id })
  assert.equal(call("keys.get", { id: rotated.key.id }).status, "revoked")
  bad("keys.rotate", { id: created.key.id })
  for (const scopes of [null, [], ["unknown"], "models"]) bad("keys.create", { tenantId: tenant.id, name: "x", scopes })
  bad("keys.create", { tenantId: tenant.id, name: "x", expiresAt: "2020-01-01T00:00:00Z" })
  bad("keys.create", { tenantId: tenant.id, name: " " })
})

test("effective expiry, tenant scope and failed writes leave state intact", () => {
  const expired = call("keys.list", { status: "expired" }).items
  assert.equal(expired.length, 1)
  assert.equal(call("keys.get", { id: expired[0].id }).status, "expired")
  bad("keys.rotate", { id: expired[0].id })
  assert.ok(call("keys.list", { tenantId: tenant.id }).items.every(k => k.tenantId === tenant.id))
  const before = call("tenants.get", { id: tenant.id })
  bad("tenants.update", { id: tenant.id, name: "Changed", quota: { rpm: -1 } })
  assert.deepEqual(call("tenants.get", { id: tenant.id }), before)
  bad("tenants.create", { name: " ", slug: "new" })
  bad("keys.create", { tenantId: other.id, name: "x", expiresAt: "invalid" })
})

test("usage off and open HTTP posture keep unavailable metrics nullable", () => {
  process.env.FIXTURE_NEXUS_USAGE_OFF = "1"
  process.env.FIXTURE_NEXUS_OPEN_GATEWAY = "1"
  const overview = call("overview.get")
  assert.equal(overview.monthSpendUsd, null)
  assert.equal(overview.requestsToday, null)
  assert.equal(overview.posture.requireApiKey, false)
  assert.equal(overview.posture.authenticationScope, "HTTP api and proxy routes")
  assert.equal(call("usage.summary", { period: "month" }).totalRequests, null)
  assert.deepEqual(call("usage.series", { period: "month", bucket: "day" }).items, [])
  assert.deepEqual(call("usage.records").items, [])
  assert.equal(call("tenants.get", { id: tenant.id }).monthSpendUsd, null)
  assert.equal(call("providers.list").items[0].requests, null)
})
