// Isolated HTTP verification of every synthetic Shield intent.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { readFileSync } from "node:fs"
const portProbe = createServer(); await new Promise(r => portProbe.listen(0, "127.0.0.1", r)); const port = portProbe.address().port; await new Promise(r => portProbe.close(r))
const server = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { env: { ...process.env, FIXTURE_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] })
let stderr = ""; server.stderr.on("data", b => { stderr += b })
const base = `http://127.0.0.1:${port}/dashboard/api/dashboard/v1`
try {
 let ready = false
 for (let i = 0; i < 50; i++) { try { await fetch(`${base}/capabilities`); ready = true; break } catch { await delay(100) } }
 assert.ok(ready, stderr)
 const csrf = (await (await fetch(`${base}/csrf`)).json()).token
 const visited = new Set()
 async function call(intent, kind = "query", input = {}, key = crypto.randomUUID()) {
  visited.add(intent)
  const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelope: "v1", contributor: "shield", intent, kind, ...(kind === "query" ? { params: input } : { payload: input, csrf, idempotencyKey: key }) }) })
  const result = await response.json(); assert.equal(result.ok, true, `${intent}: ${JSON.stringify(result)}`); return result.data
 }
 const caps = await call("capabilities"); assert.equal(caps.engine.evaluation, false)
 for (const name of ["overview", "layers.summary", "config.detail", "scans.stats"]) await call(name)
 const editable = Object.keys(caps.schemas)
 for (const kind of [...editable, "scans", "compliance"]) {
  const page = await call(`${kind}.list`); assert.equal(page.total, 1)
  const original = page.items[0]; await call(`${kind}.detail`, "query", { id: original.id })
  if (!editable.includes(kind)) continue
  const key = crypto.randomUUID(), input = { row: { ...original, name: `verify-${kind}`, id: undefined, created_at: undefined, updated_at: undefined, enabled: false } }
  const row = await call(`${kind}.create`, "command", input, key)
  assert.deepEqual(await call(`${kind}.create`, "command", input, key), row)
  assert.equal((await call(`${kind}.list`)).total, 2)
  await call(`${kind}.update`, "command", { id: row.id, row: { description: "HTTP edit", ...(kind === "instincts" ? { strategies: [] } : {}) } })
  assert.equal((await call(`${kind}.detail`, "query", { id: row.id })).enabled, false)
  await call(`${kind}.setEnabled`, "command", { id: row.id, enabled: true })
  if (kind === "policies") { for (const op of ["assign", "unassign"]) { await call(`policies.${op}`, "command", { id: row.id }); assert.equal((await call("policies.assignments", "query", { id: row.id })).assigned, op === "assign") } }
  await call(`${kind}.delete`, "command", { id: row.id }); assert.equal((await call(`${kind}.list`)).total, 1)
 }
 await call("profiles.references", "query", { collection: "instincts", name: "example-instincts" })
 const scan = (await call("scans.list")).items[0]
 await call("pii.byScan", "query", { id: scan.id }); await call("pii.stats")
 for (const intent of ["pii.purge", "pii.deleteTokens", "pii.deleteTenant"]) {
  await fetch(`${base}/_fixture/reset`, { method: "POST" })
  // Reset clears CSRF; obtain another token and exercise aliases directly below.
  const fresh = (await (await fetch(`${base}/csrf`)).json()).token
  async function command(name, payload) { visited.add(name); const b = await (await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelope: "v1", kind: "command", contributor: "shield", intent: name, payload, csrf: fresh, idempotencyKey: crypto.randomUUID() }) })).json(); assert.equal(b.ok, true, JSON.stringify(b)); return b.data }
  const p = await command("pii.retentionPreview", {}); assert.equal((await command(intent, { preview_id: p.id })).affected, 1)
 }
 const manifest = readFileSync(new URL("../../../forgery/shield/extension/contract/manifest.yaml", import.meta.url), "utf8")
 const names = [...manifest.matchAll(/- \{ name: ([^,]+)/g)].map(m => m[1])
 assert.deepEqual([...visited].sort(), names.sort())
 console.log(`Shield fixture: ${visited.size} intents verified over HTTP, mutable reads, idempotent replay and retention.`)
} finally { server.kill("SIGTERM") }
