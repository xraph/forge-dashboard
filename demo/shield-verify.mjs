// Real Go HTTP acceptance. Creates and removes only this run's own configuration.
import assert from "node:assert/strict"
const base = `${process.argv[2] ?? "http://127.0.0.1:8201"}/dashboard/api/dashboard/v1`
const csrf = (await (await fetch(`${base}/csrf`)).json()).token
const run = `migration-http-${Date.now()}`
const calls = []
async function call(intent, kind = "query", input = {}, key = crypto.randomUUID(), expected) {
 const body = await (await fetch(base, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({envelope:"v1",contributor:"shield",intent,kind,...(kind==="query"?{params:input}:{payload:input,csrf,idempotencyKey:key})})})).json()
 calls.push(intent)
 if (expected) {assert.equal(body.error?.code,expected,JSON.stringify(body));return body}
 assert.equal(body.ok,true,`${intent}: ${JSON.stringify(body)}`);return body.data
}
const caps = await call("capabilities");assert.equal(caps.engine.evaluation,false)
for (const intent of ["overview","layers.summary","scans.stats","config.detail"]) await call(intent)
for (const kind of Object.keys(caps.schemas)) {
 const original = (await call(`${kind}.list`)).items[0];assert.ok(original,kind)
 const row = structuredClone(original)
 for (const key of ["id","app_id","tenant_id","scope_key","scope_level","created_at","updated_at"]) delete row[key]
 row.name=`${run}-${kind}`;row.enabled=false
 const key=crypto.randomUUID(),made=await call(`${kind}.create`,"command",{row},key)
 try {
  assert.deepEqual(await call(`${kind}.create`,"command",{row},key),made)
  assert.equal((await call(`${kind}.detail`,"query",{id:made.id})).enabled,false)
  const changed=await call(`${kind}.update`,"command",{id:made.id,row:{description:"HTTP persistence review",...(kind==="instincts"?{strategies:[]}:{}),...(kind==="judgments"?{threshold:0}:{})}})
  if(kind==="instincts")assert.deepEqual(changed.strategies,[])
  if(kind==="judgments")assert.equal(changed.threshold,0)
  await call(`${kind}.update`,"command",{id:made.id,expected_updated_at:made.updated_at,row:{description:"stale tab"}},undefined,"CONFLICT")
  const current=await call(`${kind}.detail`,"query",{id:made.id})
  await call(`${kind}.update`,"command",{id:made.id,expected_updated_at:current.updated_at,row:{description:"fresh tab"}})
  assert.equal((await call(`${kind}.setEnabled`,"command",{id:made.id,enabled:true})).enabled,true)
  await call(`${kind}.update`,"command",{id:made.id,row:{name:"illegal-rename"}},undefined,"CONFLICT")
  if(kind==="policies")for(const op of ["assign","unassign"]){await call(`policies.${op}`,"command",{id:made.id});assert.equal((await call("policies.assignments","query",{id:made.id})).assigned,op==="assign")}
 } finally {await call(`${kind}.delete`,"command",{id:made.id})}
 await call(`${kind}.detail`,"query",{id:made.id},undefined,"NOT_FOUND")
}
for(const kind of ["scans","compliance"]){const p=await call(`${kind}.list`);for(const row of p.items)await call(`${kind}.detail`,"query",{id:row.id})}
await call("scans.list","query",{direction:"output"})
const pii=await call("pii.stats");assert.ok(!JSON.stringify(pii).includes("encrypted_value"));assert.ok(!JSON.stringify(pii).includes("decrypted_value"))
assert.equal(pii.total,Object.values(pii.by_type).reduce((a,b)=>a+b,0));assert.equal(pii.distinct_types,Object.keys(pii.by_type).length)
const scan=(await call("scans.list")).items[0];await call("pii.byScan","query",{id:scan.id})
const preview=await call("pii.retentionPreview","command",{});assert.ok(preview.id)
await call("pii.purge","command",{preview_id:"invalid-preview"},undefined,"CONFLICT")
console.log(`Real Shield HTTP: ${calls.length} requests passed, eight CRUD workflows, replay, assignments, records and metadata-only privacy. Retention deletion remains covered by isolated backend tests.`)
