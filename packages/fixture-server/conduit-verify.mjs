import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

const base =
  (process.argv[2] ?? "http://127.0.0.1:8097") + "/dashboard/api/dashboard/v1"
async function call(kind, intent, input = {}) {
  const token =
    kind === "command"
      ? (await (await fetch(base + "/csrf")).json()).token
      : undefined
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      envelope: "v1",
      kind,
      contributor: "conduit",
      intent,
      context: {},
      [kind === "query" ? "params" : "payload"]: input,
      csrf: token,
      idempotencyKey: kind === "command" ? randomUUID() : undefined,
    }),
  })
  return { status: res.status, ...(await res.json()) }
}
const capabilities = await (await fetch(base + "/capabilities")).json()
assert(capabilities.contributors.some((c) => c.name === "conduit"))
const overview = await call("query", "overview")
assert.equal(overview.ok, true)
assert(overview.data.identity.serviceID)
assert(Array.isArray(overview.data.providers))
const members = await call("query", "services.list")
assert.equal(members.ok, true)
assert(members.data.instances.length >= 2)
assert(
  new Set(members.data.instances.map((i) => i.identity.instanceID)).size >= 2
)
const provider = overview.data.providers.find(
  (p) => p.capabilities.deadLetters
).name
const failures = await call("query", "deadletters.list", {
  provider,
  limit: 25,
})
assert.equal(failures.ok, true)
assert(failures.data.letters.length > 0)
const letter = failures.data.letters.find((l) => !l.replayed)
assert(letter)
assert(!("message" in letter))
const replay = await call("command", "deadletters.replay", {
  provider,
  subscription: letter.delivery.subscriptionID,
  id: letter.id,
})
assert.equal(replay.ok, true)
assert.equal(replay.data.messageID, letter.messageID)
assert(replay.meta.invalidates.includes("deadletters.list"))
const changed = await call("query", "deadletters.list", { provider, limit: 25 })
assert(changed.data.letters.find((l) => l.id === letter.id).replayed)
const duplicate = await call("command", "deadletters.replay", {
  provider,
  subscription: letter.delivery.subscriptionID,
  id: letter.id,
})
assert.equal(duplicate.error.code, "CONFLICT")
const hooks = await call("query", "hooks.list")
assert.equal(hooks.ok, true)
assert(hooks.data.events.length <= 100)
assert(hooks.data.events.every((e) => !e.message?.data && !e.message?.headers))
console.log(
  "Conduit HTTP intents verified: identity, replicas, payload privacy, replay, invalidation and duplicate protection"
)
