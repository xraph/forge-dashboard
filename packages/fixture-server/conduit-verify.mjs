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
const consumers = await call("query", "consumers.list")
assert.equal(consumers.ok, true)
const consumer = consumers.data.consumers[0]
assert(consumer.consumerID)
for (const [intent, expected] of [
  ["consumers.pause", true],
  ["consumers.resume", false],
]) {
  const result = await call("command", intent, {
    subscription: consumer.subscription.id,
  })
  assert.equal(result.ok, true)
  assert(result.meta.invalidates.includes("consumers.list"))
  const state = await call("query", "consumers.list")
  assert.equal(
    state.data.consumers.find((c) => c.consumerID === consumer.consumerID)
      .paused,
    expected
  )
}
const input = {
  id: randomUUID(),
  subscription: consumer.subscription.id,
  start: 1,
  end: 2,
}
const job = await call("command", "backfills.run", input)
assert.equal(job.ok, true)
assert.equal(job.data.state, "complete")
assert.equal(job.data.consumerID, consumer.consumerID)
assert(job.meta.invalidates.includes("backfills.list"))
const same = await call("command", "backfills.run", input)
assert.equal(same.ok, true)
assert.equal(same.data.published, job.data.published)
const different = await call("command", "backfills.run", { ...input, end: 3 })
assert.equal(different.error.code, "CONFLICT")
const invalid = await call("command", "backfills.run", {
  ...input,
  id: randomUUID(),
  end: 101,
})
assert.equal(invalid.error.code, "BAD_REQUEST")
const history = await call("query", "backfills.list", {
  provider: consumer.provider,
  limit: 25,
})
assert.equal(history.ok, true)
assert(history.data.jobs.some((j) => j.input.id === input.id))
const hooks = await call("query", "hooks.list")
assert.equal(hooks.ok, true)
assert(hooks.data.events.length <= 100)
assert(hooks.data.events.every((e) => !e.message?.data && !e.message?.headers))
console.log(
  "Conduit HTTP intents verified: identity, replicas, payload privacy, replay, pause/resume, bounded backfill, invalidation and duplicate protection"
)
