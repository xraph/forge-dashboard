import { pathToFileURL } from "node:url"

const tenant = "tenant_00000000000000000000000001"
const key = "key_00000000000000000000000001"
export const NEXUS_INPUT = {
  "nexus::tenants.get": { id: tenant }, "nexus::keys.get": { id: key },
  "nexus::usage.summary": { period: "month" }, "nexus::usage.series": { period: "month", bucket: "day" },
  "nexus::tenants.create": { name: "Verification tenant", slug: "nexus-verification" },
  "nexus::tenants.update": { id: tenant, name: "Acme updated" },
  "nexus::tenants.setStatus": { id: tenant, status: "active" },
  "nexus::keys.create": { tenantId: tenant, name: "Verification key" },
  "nexus::keys.rotate": { id: key },
  "nexus::keys.revoke": { id: "key_00000000000000000000000002" },
}

export async function verifyNexus({ dispatch, getCSRF, failures, base }) {
  await fetch(`${base}/_fixture/reset`, { method: "POST" })
  const csrf = await getCSRF()
  const q = (intent, input = {}) => dispatch("nexus", intent, "query", input, csrf)
  const c = (intent, input = {}) => dispatch("nexus", intent, "command", input, csrf)
  const check = (name, ok) => { console.log(`  nexus ${name}: ${Boolean(ok)}`); if (!ok) failures.push({ key: `nexus::${name}`, reason: "Verification failed" }) }
  const code = response => response.body?.error?.code
  const first = await q("tenants.list", { limit: 1 })
  const next = await q("tenants.list", { limit: 1, cursor: first.body?.data?.nextCursor })
  check("cursor paging advances", first.body?.data?.items[0]?.id !== next.body?.data?.items[0]?.id)
  const before = (await q("tenants.get", { id: tenant })).body?.data
  const updated = await c("tenants.update", { id: tenant, name: "Acme HTTP", quota: { rpm: 101 } })
  const after = (await q("tenants.get", { id: tenant })).body?.data
  check("partial update preserves exact budget and metadata", after?.quota.rpm === 101 && after?.quota.monthlyBudgetUsd === before?.quota.monthlyBudgetUsd && JSON.stringify(after?.config.metadata) === JSON.stringify(before?.config.metadata))
  check("rename invalidates key and usage labels", updated.body?.meta?.invalidates?.includes("keys.get") && updated.body?.meta?.invalidates?.includes("usage.records"))
  check("blank scope is refused", code(await q("usage.summary", { tenantId: "", period: "month" })) === "BAD_REQUEST")
  check("unknown scope is refused", code(await q("usage.records", { tenantId: "tenant_00000000000000000000000000" })) === "NOT_FOUND")
  const made = await c("tenants.create", { name: "HTTP customer", slug: `http-${crypto.randomUUID()}`, quota: { monthlyBudgetUsd: "1.0000000000000000001" } })
  check("created tenant persists exact budget", (await q("tenants.get", { id: made.body?.data?.id })).body?.data?.quota.monthlyBudgetUsd === "1.0000000000000000001")
  check("duplicate slug conflicts", code(await c("tenants.create", { name: "duplicate", slug: before?.slug })) === "CONFLICT")
  const keyed = async (intent, payload, idempotencyKey) => {
    const result = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envelope: "v1", contributor: "nexus", kind: "command", intent, payload, csrf, idempotencyKey }) })
    return { status: result.status, body: await result.json() }
  }
  const idem = crypto.randomUUID(), input = { tenantId: tenant, name: "HTTP one-time key" }
  const issued = await keyed("keys.create", input, idem), repeated = await keyed("keys.create", input, idem)
  const secret = issued.body?.data?.rawKey, kid = issued.body?.data?.key?.id
  check("raw key is returned once", typeof secret === "string" && repeated.status === 500 && code(repeated) === "CONFLICT" && repeated.body.data === undefined)
  const rotationIdem = crypto.randomUUID()
  const rotated = await keyed("keys.rotate", { id: kid }, rotationIdem)
  check("rotation revokes immediately", (await q("keys.get", { id: kid })).body?.data?.status === "revoked")
  check("rotation replay does not issue again", code(await keyed("keys.rotate", { id: kid }, rotationIdem)) === "CONFLICT")
  const reads = JSON.stringify([(await q("keys.list")).body?.data, (await q("keys.get", { id: rotated.body?.data?.key?.id })).body?.data])
  check("reads keep raw values and hashes absent", !reads.includes(secret) && !reads.includes(rotated.body?.data?.rawKey) && !/"(?:rawKey|hash)"/.test(reads))
  const revoke = await c("keys.revoke", { id: rotated.body?.data?.key?.id })
  check("revoke persists", revoke.body?.data?.status === "revoked" && (await q("keys.get", { id: rotated.body?.data?.key?.id })).body?.data?.status === "revoked")
  await fetch(`${base}/_fixture/reset`, { method: "POST" })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = `${process.argv[2] ?? "http://localhost:8198"}/dashboard/api/dashboard/v1`
  const failures = []
  const getCSRF = async () => (await (await fetch(`${base}/csrf`)).json()).token
  const dispatch = async (contributor, intent, kind, input, csrf) => {
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envelope: "v1", contributor, intent, kind, ...(kind === "query" ? { params: input } : { payload: input, csrf, idempotencyKey: crypto.randomUUID() }) }) })
    return { status: response.status, body: await response.json() }
  }
  const caps = await (await fetch(`${base}/capabilities`)).json()
  const csrf = await getCSRF()
  const contributor = caps.contributors.find(c => c.name === "nexus")
  if (!contributor) throw new Error("Nexus contributor absent")
  for (const intent of contributor.intents) {
    let response = await dispatch("nexus", intent.name, "query", NEXUS_INPUT[`nexus::${intent.name}`] ?? {}, csrf)
    if (response.body?.error?.code === "BAD_REQUEST" && /kind/.test(response.body.error.message)) response = await dispatch("nexus", intent.name, "command", NEXUS_INPUT[`nexus::${intent.name}`] ?? {}, csrf)
    if (!response.body?.ok) failures.push({ key: intent.name, reason: response.body?.error?.code })
  }
  console.log(`Nexus intent walk: ${contributor.intents.length} intents, ${failures.length} failures`)
  await verifyNexus({ dispatch, getCSRF, failures, base })
  if (failures.length) console.error(failures)
  process.exitCode = failures.length ? 1 : 0
}
