// Synthetic development data. Live acceptance uses demo/shield.go and SQLite.
import { readFileSync } from "node:fs"
const schemas = JSON.parse(readFileSync(new URL("./shield-schema.json", import.meta.url), "utf8"))
const editable = Object.keys(schemas)
const kinds = [...editable, "scans", "compliance"]
const prefixes = { instincts: "inst", awareness: "awr", boundaries: "bnd", values: "val", judgments: "jdg", reflexes: "rflx", profiles: "sprf", policies: "pol", scans: "scan", compliance: "crpt" }
const scope = { tenant_id: "shield-fixture", app_id: "shield-fixture", policy_level: "app", policy_key: "shield-fixture" }
let state, next, assignments, previews
const now = () => new Date().toISOString()
const clone = (v) => structuredClone(v)
function defaults(fields) {
  return Object.fromEntries(fields.map(f => [f.key, ["array", "references", "tags"].includes(f.type) ? [] : f.type === "boolean" ? false : ["integer", "number"].includes(f.type) ? 0 : f.type === "json" ? {} : f.type === "json_value" ? null : f.options?.[0] ?? ""]))
}
function makeID(kind) { return `${prefixes[kind]}_${String(next++).padStart(26, "0")}` }
export function resetShield() {
  next = 1; assignments = new Set(); previews = new Map()
  state = Object.fromEntries(kinds.map(k => [k, []]))
  for (const k of editable) state[k].push({ ...defaults(schemas[k]), ...scope, id: makeID(k), name: `example-${k}`, description: "Synthetic fixture configuration", enabled: true, metadata: { source: "synthetic-example" }, created_at: now(), updated_at: now() })
  state.scans.push({ id: makeID("scans"), ...scope, direction: "input", decision: "flag", findings: [], pii_count: 0, duration_ms: 12, profile_used: "example-profiles", created_at: now(), metadata: { source: "synthetic-example", evaluation_available: false } })
  state.compliance.push({ id: makeID("compliance"), ...scope, scope_level: "app", scope_key: scope.app_id, framework: "nist_ai_rmf", generated_at: now(), period_start: now(), period_end: now(), report: { source: "synthetic-example", certified: false } })
  state.pii = [{ id: "pii_00000000000000000000000001", tenant_id: scope.tenant_id, scan_id: state.scans[0].id, pii_type: "email", placeholder: "[EMAIL_EXAMPLE]", expires_at: "2026-01-01T00:00:00Z", created_at: now() }]
}
resetShield()
export function createShieldHandlers(FixtureError) {
  const out = {}
  const error = (status, code, message) => { throw new FixtureError(status, code, message) }
  const get = (kind, id) => state[kind]?.find(r => r.id === id) ?? error(404, "NOT_FOUND", "Resource not found in this scope")
  const list = (kind, input = {}) => {
    const limit = input.limit ?? 25, offset = input.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) error(400, "BAD_REQUEST", "Invalid paging")
    const rows = state[kind].filter(r => (input.enabled === undefined || r.enabled === input.enabled) && (!input.search || r.name?.toLowerCase().includes(input.search.toLowerCase())) && (!input.value || r[input.field] === input.value) && (!input.direction || r.direction === input.direction) && (!input.id || r.scan_id === input.id))
    return { items: clone(rows.slice(offset, offset + limit)), total: rows.length, limit, offset, has_more: offset + limit < rows.length, refreshed_at: now() }
  }
  const references = (kind, name) => state.profiles.filter(p => (p[kind] ?? []).some(v => typeof v === "string" ? v === name : v[`${kind === "awareness" ? "awareness" : kind.replace(/s$/, "")}_name`] === name)).map(p => p.id)
  const define = (name, kind, handler) => { out[name] = { kind, handler, ...(kind === "command" ? { invalidates: ["overview", "layers.summary", "profiles.references", "policies.assignments", "pii.stats", "pii.byScan", ...kinds.flatMap(k => [`${k}.list`, `${k}.detail`])] } : {}) } }
  define("capabilities", "query", () => ({ engine: { persistence: true, evaluation: false, report_generation: false, config_write: false, unavailable_layers: editable.slice(0, 6) }, scope, schemas, can_manage: true, can_manage_privacy: true }))
  for (const intent of ["overview", "layers.summary"]) define(intent, "query", () => ({ evaluation_available: false, refreshed_at: now(), sections: kinds.map(collection => ({ collection, total: state[collection].length, available: true })) }))
  define("config.detail", "query", () => ({ enabled: true, disable_migrate: false, shutdown_timeout: 30000000000, default_profile: "example-profiles" }))
  define("scans.stats", "query", () => Object.fromEntries(["allow", "block", "flag", "redact"].map(d => [d, state.scans.filter(s => s.decision === d).length])))
  define("profiles.references", "query", i => references(i.collection, i.name))
  define("policies.assignments", "query", i => { get("policies", i.id); return { tenant_id: scope.tenant_id, assigned: assignments.has(i.id) } })
  for (const op of ["assign", "unassign"]) define(`policies.${op}`, "command", i => { get("policies", i.id); op === "assign" ? assignments.add(i.id) : assignments.delete(i.id); return { assigned: op === "assign" } })
  define("pii.stats", "query", i => {
    const by_type = {}; for (const token of state.pii) by_type[token.pii_type] = (by_type[token.pii_type] ?? 0) + 1
    return { ...list("pii", i), by_type, distinct_types: Object.keys(by_type).length }
  })
  define("pii.byScan", "query", i => { get("scans", i.id); return list("pii", i) })
  define("pii.retentionPreview", "command", () => {
    const cutoff = now(), ids = state.pii.filter(r => r.expires_at < cutoff).map(r => r.id)
    const p = { id: `preview-${next++}`, cutoff, expires_at: new Date(Date.now() + 300000).toISOString(), token_ids: ids.slice(0, 100), total: ids.length, has_more: ids.length > 100 }
    previews.set(p.id, p); return clone(p)
  })
  for (const name of ["pii.purge", "pii.deleteTokens", "pii.deleteTenant"]) define(name, "command", i => {
    const p = previews.get(i.preview_id)
    if (!p || p.expires_at < now()) error(409, "CONFLICT", "Retention preview expired; review a new preview")
    if (!p.token_ids.length) error(400, "BAD_REQUEST", "A nonempty retention preview is required")
    const before = state.pii.length
    state.pii = state.pii.filter(r => !p.token_ids.includes(r.id) || r.expires_at >= p.cutoff)
    return { affected: before - state.pii.length }
  })
  for (const kind of kinds) {
    define(`${kind}.list`, "query", i => list(kind, i))
    define(`${kind}.detail`, "query", i => clone(get(kind, i.id)))
    if (!editable.includes(kind)) continue
    define(`${kind}.create`, "command", i => {
      if (!i.row?.name || i.row.name.length > 128) error(400, "BAD_REQUEST", "A configuration name is required")
      if (state[kind].some(r => r.name === i.row.name)) error(409, "CONFLICT", "That name is already used in this app")
      const row = { ...defaults(schemas[kind]), enabled: true, metadata: {}, ...clone(i.row), ...scope, id: makeID(kind), created_at: now(), updated_at: now() }
      state[kind].push(row); return clone(row)
    })
    define(`${kind}.update`, "command", i => {
      const row = get(kind, i.id)
      if (i.expected_updated_at && i.expected_updated_at !== row.updated_at) error(409,"CONFLICT","This configuration changed after you opened it. Reload before saving.")
      if (i.row?.name && i.row.name !== row.name) error(409, "CONFLICT", "Name is immutable")
      for (const key of ["id", "app_id", "tenant_id", "scope_key", "scope_level", "created_at"]) if (key in (i.row ?? {}) && i.row[key] !== row[key]) error(409, "CONFLICT", "Scope and identity are immutable")
      Object.assign(row, clone(i.row), { updated_at: now() }); return clone(row)
    })
    define(`${kind}.setEnabled`, "command", i => {
      if (typeof i.enabled !== "boolean") error(400, "BAD_REQUEST", "enabled is required")
      const row = get(kind, i.id); row.enabled = i.enabled; row.updated_at = now(); return clone(row)
    })
    define(`${kind}.delete`, "command", i => {
      const row = get(kind, i.id)
      if (references(kind, row.name).length) error(409, "CONFLICT", "Update referencing profiles before deletion")
      state[kind] = state[kind].filter(r => r.id !== i.id); assignments.delete(i.id); return { deleted: true }
    })
  }
  return out
}
