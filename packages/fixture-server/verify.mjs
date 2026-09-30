#!/usr/bin/env node
// verify.mjs
//
// Exercises every intent the fixture server's own /capabilities response
// advertises, over real HTTP, against a running `server.mjs`. Not a test
// suite (the package has none, deliberately — see README.md) but a
// repeatable smoke check: capabilities lists a name, this script calls it,
// and either it answers a well-formed contract response or this script says
// exactly which intent didn't and why.
//
// A "pass" is: the dispatcher found the intent (not 404 NOT_FOUND with a
// "not registered" message) and the handler did not throw an *unexpected*
// error. A handler-thrown 404 for a bad id this script chose badly still
// counts as well-formed (it's a real contract error shape) but is flagged
// separately so it doesn't hide behind a blanket pass — see `expectOkFalse`
// below for the couple of intents this script deliberately calls with
// input that SHOULD fail (subscriptions.list with no tenantId).
//
// Usage:
//   FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
//   node packages/fixture-server/verify.mjs http://localhost:8099

const base = (process.argv[2] ?? "http://localhost:8099") + "/dashboard/api/dashboard/v1"

/**
 * Per-intent params/payload. Keyed by `${contributor}::${intent}`. Missing
 * entries default to `{}`, which is correct for every list-style query and
 * every command whose fields are all optional in the seed data. IDs here
 * are the ones server.mjs's seed functions actually create, so a handler
 * that 404s on an unknown id is not mistaken for one that is missing.
 */
const INPUT = {
  "auth::auth.login": { email: "ada@example.com", password: "anything" },
  "auth::auth.toggleFeature": { key: "passwordAuth", enabled: true },
  "auth::users.detail": { id: "usr_1" },
  "auth::users.create": { email: "new.hire@example.com", password: "correct-horse-1", firstName: "New", lastName: "Hire" },
  "auth::users.update": { id: "usr_1", firstName: "Ada" },
  "auth::users.ban": { id: "usr_3", reason: "verify script" },
  "auth::users.unban": { id: "usr_3" },
  "auth::users.delete": { id: "usr_7" },
  "auth::sessions.detail": { id: "ses_1" },
  "auth::sessions.revoke": { id: "ses_2" },
  "auth::sessions.bulkRevoke": { userId: "usr_2" },
  "auth::devices.detail": { id: "dev_1" },
  "auth::devices.trust": { id: "dev_2" },
  "auth::devices.delete": { id: "dev_2" },
  "auth::roles.detail": { id: "role_1" },
  "auth::roles.create": { name: "Tester", slug: "tester" },
  "auth::roles.update": { id: "role_2", name: "Viewer (renamed)" },
  "auth::roles.delete": { id: "role_2" },
  "auth::roles.assign": { userId: "usr_1", roleId: "role_1" },
  "auth::roles.unassign": { userId: "usr_1", roleId: "role_1" },
  "auth::apps.detail": { id: "app_1" },
  "auth::apps.create": { name: "Verify App", slug: "verify-app" },
  "auth::apps.update": { id: "app_2", name: "Demo App (renamed)" },
  "auth::apps.delete": { id: "app_2" },
  // app_3 (Storefront) on purpose, not app_2: apps.delete above removes
  // app_2 earlier in this same intent loop, and apps.switch running after
  // that would 404 on it. app_3's own environments (env_5/env_6) are also
  // untouched by every other auth::environments.* entry in this table, so
  // environments.switch below can target one without racing them.
  "auth::apps.switch": { appId: "app_3" },
  "auth::environments.detail": { id: "env_1" },
  "auth::environments.create": { name: "QA", slug: "qa" },
  "auth::environments.update": { id: "env_2", name: "Staging (renamed)" },
  "auth::environments.delete": { id: "env_2" },
  "auth::environments.clone": { id: "env_1", name: "Production copy", slug: "production-copy" },
  "auth::environments.setDefault": { id: "env_1" },
  // Relies on auth::apps.switch (above, and earlier in intent order) having
  // already switched to app_3, so env_6 (Staging, app_3) validates as
  // belonging to the current app.
  "auth::environments.switch": { envId: "env_6" },
  "auth::webhooks.detail": { id: "webhook_1" },
  "auth::webhooks.create": { url: "https://example.com/hooks/verify", events: ["user.created"] },
  "auth::webhooks.update": { id: "webhook_1", active: false },
  "auth::webhooks.delete": { id: "webhook_1" },
  "auth::overview.recentSignups": { limit: 5 },
  "auth::formConfigs.saveSignup": {
    fields: [{ key: "email", label: "Email", type: "email", order: 1 }],
    active: true,
  },
  "auth::settings.namespace": { namespace: "riskengine", scope: "app" },
  "auth::settings.update": { key: "riskengine.threshold", value: 90, scope: "app" },
  "auth::settings.enforce": { key: "mfa.required", value: true, scope: "app" },
  "auth::settings.unenforce": { key: "mfa.required", scope: "app" },

  "organization::orgs.detail": { id: "org_1" },
  "organization::orgs.create": { name: "New Org", slug: "new-org" },
  "organization::orgs.update": { id: "org_2", name: "Globex (renamed)" },
  "organization::orgs.delete": { id: "org_2" },
  "organization::orgs.members": { orgId: "org_1" },
  "organization::orgs.removeMember": { id: "member_2" },

  "apikey::apikeys.detail": { id: "key_1" },
  "apikey::apikeys.create": { name: "Verify key", userId: "usr_1" },
  "apikey::apikeys.revoke": { id: "key_1" },

  "waitlist::waitlist.detail": { id: "wait_1" },
  "waitlist::waitlist.approve": { id: "wait_1" },
  "waitlist::waitlist.reject": { id: "wait_2" },
  "waitlist::waitlist.delete": { id: "wait_3" },

  "consent::consent.userConsents": { userId: "usr_1" },
  "consent::consent.grant": { userId: "usr_1", purpose: "newsletter" },
  "consent::consent.revoke": { userId: "usr_1", purpose: "newsletter" },

  "subscription::plans.detail": { id: "plan_1" },
  "subscription::plans.archive": { id: "plan_1" },
  "subscription::plans.activate": { id: "plan_1" },
  "subscription::subscriptions.list": { tenantId: "tenant_1" },

  // relay: delete takes the staging endpoint so setEnabled and rotateSecret,
  // which run after it, still have the production one to act on.
  "relay::endpoints.detail": { id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x" },
  "relay::endpoints.resolve": { tenantId: "acme", eventType: "invoice.created" },
  "relay::endpoints.create": {
    tenantId: "acme",
    url: "https://verify.example/hook",
    eventTypes: ["invoice.*"],
  },
  "relay::endpoints.update": { id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x", description: "updated by verify.mjs" },
  "relay::endpoints.delete": { id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2y" },
  "relay::endpoints.setEnabled": { id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x", enabled: false },
  "relay::endpoints.rotateSecret": { id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2z" },
  // relay-fixtures.mjs's RELAY_IDS. replay takes the 4xx entry and leaves
  // the gave-up one for detail and bulk replay.
  "relay::deliveries.detail": { id: "del_01hq2k3m4n5p6q7r8s9t0vd001" },
  "relay::events.detail": { id: "evt_01hq2k3m4n5p6q7r8s9t0ve001" },
  "relay::events.send": { type: "invoice.paid", tenantId: "acme", data: { invoiceId: "inv_v", amount: 1, currency: "USD" } },
  "relay::eventTypes.detail": { name: "invoice.paid" },
  "relay::eventTypes.match": { pattern: "invoice.*" },
  "relay::eventTypes.register": { name: "verify.ping", version: "1" },
  "relay::eventTypes.deprecate": { name: "customer.created" },
  "relay::dlq.detail": { id: "dlq_01hq2k3m4n5p6q7r8s9t0vq001" },
  "relay::dlq.replay": { id: "dlq_01hq2k3m4n5p6q7r8s9t0vq002" },
  "relay::dlq.bulkPreview": { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date().toISOString() },
  "relay::dlq.replayBulk": { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date().toISOString() },
  "relay::dlq.purge": { before: new Date(Date.now() - 365 * 86_400_000).toISOString() },

  // vault: keys that exist in vault-fixtures.mjs's seed. create runs before
  // delete (intent order), so delete removes the row create made; savePolicy
  // runs before deletePolicy, on a secret that starts with no policy.
  "vault::secrets.detail": { key: "db/primary.password" },
  "vault::secrets.versions": { key: "db/primary.password" },
  "vault::secrets.create": { key: "verify/new.secret", value: "verify-canary-value", expiresAt: "2099-01-01T00:00:00Z" },
  "vault::secrets.update": { key: "api/stripe.key", value: "verify-canary-value" },
  "vault::secrets.delete": { key: "verify/new.secret" },
  "vault::rotation.detail": { key: "db/primary.password" },
  "vault::rotation.savePolicy": { key: "api/stripe.key", intervalSeconds: 3600, enabled: true },
  "vault::rotation.deletePolicy": { key: "api/stripe.key" },
  "vault::rotation.rotateNow": { key: "db/primary.password" },
  // flags: intent order is list, detail, evaluate, create, update, delete,
  // setEnabled, setRules, setTenantOverride, deleteTenantOverride. create runs
  // before update and delete, which act on the flag it made; the last four act
  // on a seeded flag, and the override is set before it is deleted.
  "vault::flags.detail": { key: "checkout.new-flow" },
  "vault::flags.evaluate": { key: "checkout.new-flow", tenantId: "acme" },
  "vault::flags.create": { key: "verify/new.flag", type: "bool", defaultValue: false, enabled: true },
  "vault::flags.update": { key: "verify/new.flag", description: "updated by verify.mjs" },
  "vault::flags.delete": { key: "verify/new.flag" },
  "vault::flags.setEnabled": { key: "auth.passkeys", enabled: false },
  "vault::flags.setRules": { key: "auth.passkeys", rules: [{ type: "rollout", percentage: 10, returnValue: true }] },
  "vault::flags.setTenantOverride": { key: "auth.passkeys", tenantId: "acme", value: true },
  "vault::flags.deleteTenantOverride": { key: "auth.passkeys", tenantId: "acme" },
  "streaming-contract::rooms.detail": { id: "room_1" },
  "streaming-contract::rooms.create": { name: "Verify room", description: "d", owner: "usr_1", private: false },
  "streaming-contract::rooms.delete": { id: "room_2" },
  "streaming-contract::rooms.members": { id: "room_1" },
  "streaming-contract::rooms.moderation": { id: "room_1" },
  "streaming-contract::rooms.send-message": { roomID: "room_1", userID: "usr_1", content: "hello from verify.mjs" },
  "streaming-contract::connections.kick": { connID: "conn_2", reason: "verify script" },
  "streaming-contract::presence.set": { userID: "usr_1", status: "away" },
}

/**
 * Intents this script deliberately calls in a way that SHOULD produce a
 * contract-level failure — asserting the failure mode is part of what this
 * script is checking, not a bug in the harness.
 */
const EXPECT_FAILURE = new Set([
  // subscriptions.list is documented to succeed with an empty list, not
  // fail, when tenantId is missing — so it isn't in this set. Nothing else
  // is exercised with intentionally-bad input in this pass.
])

async function getJSON(path) {
  const res = await fetch(`${base}${path}`)
  return { status: res.status, body: await res.json() }
}

async function getCSRF() {
  const { body } = await getJSON("/csrf")
  return body.token
}

async function dispatch(contributor, intent, kind, input, csrf) {
  const envelope = {
    envelope: "v1",
    kind,
    contributor,
    intent,
    ...(kind === "query" ? { params: input } : { payload: input }),
  }
  if (kind === "command") {
    envelope.csrf = csrf
    envelope.idempotencyKey = crypto.randomUUID()
  }
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  })
  const body = await res.json()
  return { status: res.status, body }
}

/** Tries query first; if the fixture says kind doesn't match, retries as a command. */
async function callIntent(contributor, intent, input, csrf) {
  const first = await dispatch(contributor, intent, "query", input, csrf)
  if (
    first.status === 400 &&
    first.body?.error?.code === "BAD_REQUEST" &&
    typeof first.body?.error?.message === "string" &&
    first.body.error.message.includes("does not match intent capability")
  ) {
    return { kind: "command", ...(await dispatch(contributor, intent, "command", input, csrf)) }
  }
  return { kind: "query", ...first }
}

async function main() {
  const capsRes = await fetch(`${base}/capabilities`)
  if (!capsRes.ok) {
    console.error(`capabilities fetch failed: ${capsRes.status}`)
    process.exit(1)
  }
  const caps = await capsRes.json()
  const csrf = await getCSRF()

  let total = 0
  let passed = 0
  const failures = []

  for (const contributor of caps.contributors) {
    for (const intent of contributor.intents) {
      total += 1
      const key = `${contributor.name}::${intent.name}`
      const input = INPUT[key] ?? {}
      let result
      try {
        result = await callIntent(contributor.name, intent.name, input, csrf)
      } catch (err) {
        failures.push({ key, reason: `threw: ${err.message}` })
        continue
      }

      const wantFailure = EXPECT_FAILURE.has(key)
      const registered = !(result.status === 404 && result.body?.error?.message?.includes("not registered"))
      const isServerError = result.status === 500
      const ok = result.body?.ok === true

      if (!registered) {
        failures.push({ key, reason: "404 intent not registered (dispatch never found the handler)" })
        continue
      }
      if (isServerError) {
        failures.push({ key, reason: `500 ${result.body?.error?.code}: ${result.body?.error?.message}` })
        continue
      }
      if (wantFailure) {
        if (ok) failures.push({ key, reason: "expected a contract-level failure but got ok:true" })
        else passed += 1
        continue
      }
      if (!ok) {
        failures.push({
          key,
          reason: `${result.status} ${result.body?.error?.code}: ${result.body?.error?.message}`,
        })
        continue
      }
      passed += 1
    }
  }

  console.log(`Contributors: ${caps.contributors.length}`)
  console.log(`Intents exercised: ${total}`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failures.length}`)
  if (failures.length) {
    console.log("\nFailures:")
    for (const f of failures) console.log(`  ${f.key} — ${f.reason}`)
  }

  // A couple of spot-checks that invalidation and secret-once actually work,
  // beyond "the handler didn't throw" — cheap to run here since the state
  // is already warm.
  console.log("\nSpot checks:")

  // apikeys.create is the only response carrying a secret; apikeys.list and
  // apikeys.detail must never carry one.
  const createKey = await dispatch(
    "apikey",
    "apikeys.create",
    "command",
    { name: "Spot check key", userId: "usr_1" },
    csrf,
  )
  const hasSecretOnCreate = typeof createKey.body?.data?.secret === "string" && createKey.body.data.secret.length > 0
  const list = await dispatch("apikey", "apikeys.list", "query", {}, csrf)
  const listLeaksSecret = list.body?.data?.apiKeys?.some((k) => "secret" in k)
  const detail = await dispatch("apikey", "apikeys.detail", "query", { id: createKey.body?.data?.id }, csrf)
  const detailLeaksSecret = detail.body?.data && "secret" in detail.body.data
  console.log(
    `  apikeys.create carries secret: ${hasSecretOnCreate} / apikeys.list leaks secret: ${listLeaksSecret} / apikeys.detail leaks secret: ${detailLeaksSecret}`,
  )
  if (!hasSecretOnCreate || listLeaksSecret || detailLeaksSecret) {
    failures.push({ key: "spot-check::apikeys secret-once", reason: "secret-once invariant violated" })
  }

  // relay's replay behaves like a real backend, not like the in-memory store:
  // the row stays listed and marked, and a second replay is refused. The
  // intent loop above already replayed the 4xx entry once.
  const replayedId = "dlq_01hq2k3m4n5p6q7r8s9t0vq002"
  const again = await dispatch("relay", "dlq.replay", "command", { id: replayedId }, csrf)
  const dlqList = await dispatch("relay", "dlq.list", "query", {}, csrf)
  const stillListed = dlqList.body?.data?.entries?.find((e) => e.id === replayedId)
  console.log(
    `  second dlq.replay refused: ${again.body?.error?.code === "CONFLICT"} / replayed row kept and marked: ${Boolean(stillListed?.replayedAt)}`,
  )
  if (again.body?.error?.code !== "CONFLICT" || !stillListed?.replayedAt) {
    failures.push({ key: "spot-check::relay replay", reason: "replay did not keep, mark and refuse like a real backend" })
  }

  // A create must show up in its list (meta.invalidates + an actual write).
  const roomCreate = await dispatch(
    "streaming-contract",
    "rooms.create",
    "command",
    { name: "Spot check room", description: "", owner: "usr_1", private: false },
    csrf,
  )
  const invalidatesRoomsList = roomCreate.body?.meta?.invalidates?.includes("rooms.list")
  const roomsList = await dispatch("streaming-contract", "rooms.list", "query", {}, csrf)
  const roomAppears = roomsList.body?.data?.rooms?.some((r) => r.id === roomCreate.body?.data?.id)
  console.log(`  rooms.create declares meta.invalidates rooms.list: ${invalidatesRoomsList} / new room appears in rooms.list: ${roomAppears}`)
  if (!invalidatesRoomsList || !roomAppears) {
    failures.push({ key: "spot-check::rooms.create invalidation", reason: "write did not propagate to rooms.list" })
  }

  // Ban a user, confirm users.detail reflects it. (Not users.list here:
  // users.list is cursor-paged with a small default page size, and usr_6
  // may not land on page one — that's a pagination fact, not a sign
  // invalidation is broken. users.detail has no such ambiguity.)
  await dispatch("auth", "users.ban", "command", { id: "usr_6", reason: "spot check" }, csrf)
  const bannedUser = await dispatch("auth", "users.detail", "query", { id: "usr_6" }, csrf)
  console.log(`  users.ban propagates to users.detail: ${bannedUser.body?.data?.banned === true}`)
  if (bannedUser.body?.data?.banned !== true) {
    failures.push({ key: "spot-check::users.ban invalidation", reason: "ban did not propagate to users.detail" })
  }

  // waitlist.counts is exactly {pending, approved, rejected}, no total.
  const counts = await dispatch("waitlist", "waitlist.counts", "query", {}, csrf)
  const countsKeys = Object.keys(counts.body?.data ?? {}).sort()
  const countsShapeOk = JSON.stringify(countsKeys) === JSON.stringify(["approved", "pending", "rejected"])
  console.log(`  waitlist.counts shape is exactly {pending,approved,rejected}: ${countsShapeOk}`)
  if (!countsShapeOk) {
    failures.push({ key: "spot-check::waitlist.counts shape", reason: `got keys ${countsKeys.join(",")}` })
  }

  // subscriptions.list with no tenantId is empty, not an error.
  const noTenant = await dispatch("subscription", "subscriptions.list", "query", {}, csrf)
  const emptyWithoutTenant = noTenant.body?.ok === true && Array.isArray(noTenant.body?.data?.subscriptions) && noTenant.body.data.subscriptions.length === 0
  console.log(`  subscriptions.list with no tenantId returns an empty list (not an error): ${emptyWithoutTenant}`)
  if (!emptyWithoutTenant) {
    failures.push({ key: "spot-check::subscriptions.list no tenantId", reason: "did not short-circuit to empty list" })
  }

  // apps.context / apps.switch / environments.switch: prove the switch
  // state actually holds rather than a fixture that acks the command and
  // answers the same context forever. Targets app_3/env_5 — app_2 is gone
  // by this point (the generic loop above ran auth::apps.delete on it), so
  // the "second app" here is app_3, untouched by anything earlier in this
  // script.
  const appSwitch = await dispatch("auth", "apps.switch", "command", { appId: "app_3" }, csrf)
  const afterAppSwitch = await dispatch("auth", "apps.context", "query", {}, csrf)
  const currentIsSecondApp = afterAppSwitch.body?.data?.currentApp?.id === "app_3"
  const secondAppEnvIds = (afterAppSwitch.body?.data?.availableEnvs ?? []).map((e) => e.id).sort()
  // app_3's own seeded pair must be there, and no other app's environment may
  // be. Not an exact match on ["env_5","env_6"]: the intent loop above runs
  // environments.create and environments.clone while app_3 is selected, and
  // those now land in app_3, which is the point. This assertion used to pass
  // only because a created environment was stamped with an app id that did
  // not exist, so it belonged to nothing and showed up nowhere.
  const otherAppsEnvIds = ["env_1", "env_2", "env_3", "env_4"]
  const envsAreSecondAppsOwn =
    secondAppEnvIds.includes("env_5") &&
    secondAppEnvIds.includes("env_6") &&
    !secondAppEnvIds.some((id) => otherAppsEnvIds.includes(id))
  console.log(
    `  apps.switch declares meta.invalidates apps.context: ${appSwitch.body?.meta?.invalidates?.includes("apps.context")}`,
  )
  console.log(`  apps.context reports app_3 as currentApp after switching to it: ${currentIsSecondApp}`)
  console.log(`  availableEnvs after switching to app_3 are app_3's own (env_5, env_6), not every env: ${envsAreSecondAppsOwn}`)
  if (!appSwitch.body?.meta?.invalidates?.includes("apps.context")) {
    failures.push({ key: "spot-check::apps.switch invalidation", reason: "apps.switch did not declare meta.invalidates apps.context" })
  }
  if (!currentIsSecondApp) {
    failures.push({ key: "spot-check::apps.switch currentApp", reason: "apps.context did not report app_3 as currentApp after switching" })
  }
  if (!envsAreSecondAppsOwn) {
    failures.push({ key: "spot-check::apps.switch availableEnvs", reason: `got availableEnvs ${JSON.stringify(secondAppEnvIds)}` })
  }

  // environments.switch, still scoped to app_3 from the switch above.
  const envSwitch = await dispatch("auth", "environments.switch", "command", { envId: "env_5" }, csrf)
  const afterEnvSwitch = await dispatch("auth", "apps.context", "query", {}, csrf)
  const currentEnvChanged = afterEnvSwitch.body?.data?.currentEnv?.id === "env_5"
  console.log(`  environments.switch changes apps.context's currentEnv: ${currentEnvChanged}`)
  if (!envSwitch.body?.meta?.invalidates?.includes("apps.context")) {
    failures.push({ key: "spot-check::environments.switch invalidation", reason: "environments.switch did not declare meta.invalidates apps.context" })
  }
  if (!currentEnvChanged) {
    failures.push({ key: "spot-check::environments.switch currentEnv", reason: "currentEnv did not change to env_5 after environments.switch" })
  }

  // apps.switch("") clears back to the default (platform) app.
  await dispatch("auth", "apps.switch", "command", { appId: "" }, csrf)
  const afterClear = await dispatch("auth", "apps.context", "query", {}, csrf)
  const backToDefaultApp = afterClear.body?.data?.currentApp?.isPlatform === true
  console.log(`  apps.switch with "" returns currentApp to the default (platform) app: ${backToDefaultApp}`)
  if (!backToDefaultApp) {
    failures.push({ key: "spot-check::apps.switch clear", reason: "empty appId did not return currentApp to the platform app" })
  }

  // users.list is cursor-paged and a second page exists.
  const page1 = await dispatch("auth", "users.list", "query", {}, csrf)
  const hasNextCursor = typeof page1.body?.data?.nextCursor === "string" && page1.body.data.nextCursor.length > 0
  console.log(`  users.list has a reachable second page: ${hasNextCursor}`)
  if (!hasNextCursor) {
    failures.push({ key: "spot-check::users.list pagination", reason: "no nextCursor on first page" })
  }

  // vault: the rules the Go handlers enforce, not just "answered".
  {
    const vaultCall = (intent, kind, input) => dispatch("vault", intent, kind, input, csrf)
    const vaultCheck = (name, ok, detail) => {
      console.log(`  vault ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::vault ${name}`, reason: detail })
    }
    const canary = "spot-check-canary-value"

    const page1 = await vaultCall("secrets.list", "query", {})
    const page2 = await vaultCall("secrets.list", "query", { offset: 25 })
    const listed = page1.body?.data
    vaultCheck(
      "secrets.list pages (25 then the rest, exact total)",
      listed?.secrets?.length === 25 && page2.body?.data?.secrets?.length === listed.total - 25 && listed.total >= 30,
      `got ${listed?.secrets?.length} then ${page2.body?.data?.secrets?.length} of ${listed?.total}`,
    )

    const all = await vaultCall("secrets.list", "query", { limit: 500 })
    const rows = all.body?.data?.secrets ?? []
    vaultCheck(
      "every row carries encryptionAlg, and one is empty",
      rows.length > 0 && rows.every((r) => typeof r.encryptionAlg === "string") && rows.some((r) => r.encryptionAlg === ""),
      "encryptionAlg missing or no unencrypted seed row",
    )

    const created = await vaultCall("secrets.create", "command", { key: "spot/check.key", value: canary, expiresAt: "2099-01-01T00:00:00Z" })
    const again = await vaultCall("secrets.create", "command", { key: "spot/check.key", value: canary })
    vaultCheck("secrets.create refuses an existing key with 409 CONFLICT", again.status === 409 && again.body?.error?.code === "CONFLICT", `${again.status} ${again.body?.error?.code}`)
    const noValue = await vaultCall("secrets.create", "command", { key: "spot/other.key", value: "" })
    vaultCheck("secrets.create refuses an empty value with BAD_REQUEST", noValue.body?.error?.code === "BAD_REQUEST", `${noValue.body?.error?.code}`)
    const past = await vaultCall("secrets.create", "command", { key: "spot/past.key", value: canary, expiresAt: "2001-01-01T00:00:00Z" })
    vaultCheck("secrets.create refuses a past expiry with BAD_REQUEST", past.body?.error?.code === "BAD_REQUEST", `${past.body?.error?.code}`)

    const grown = await vaultCall("secrets.list", "query", {})
    vaultCheck("secrets.create grows the list total", grown.body?.data?.total === listed.total + 1, `${grown.body?.data?.total} vs ${listed.total}`)

    const kept = await vaultCall("secrets.update", "command", { key: "spot/check.key", value: canary })
    vaultCheck(
      "secrets.update keeps the expiry and bumps the version",
      kept.body?.data?.secret?.expiresAt === created.body?.data?.secret?.expiresAt && kept.body?.data?.secret?.version === 2,
      JSON.stringify(kept.body?.data?.secret),
    )
    const cleared = await vaultCall("secrets.update", "command", { key: "spot/check.key", value: canary, expiresAt: "" })
    vaultCheck("secrets.update with expiresAt \"\" clears it", cleared.body?.data?.secret && !("expiresAt" in cleared.body.data.secret), JSON.stringify(cleared.body?.data?.secret))
    const missing = await vaultCall("secrets.update", "command", { key: "spot/none.key", value: canary })
    vaultCheck("secrets.update on a missing key is 404 NOT_FOUND", missing.status === 404 && missing.body?.error?.code === "NOT_FOUND", `${missing.status} ${missing.body?.error?.code}`)

    const versions = await vaultCall("secrets.versions", "query", { key: "spot/check.key" })
    const versionNumbers = (versions.body?.data?.versions ?? []).map((v) => v.version)
    vaultCheck("secrets.versions is newest first", JSON.stringify(versionNumbers) === "[3,2,1]", JSON.stringify(versionNumbers))

    const detail = await vaultCall("secrets.detail", "query", { key: "spot/check.key" })
    vaultCheck("secrets.detail answers rotation: null when there is no policy", detail.body?.data && detail.body.data.rotation === null && Array.isArray(detail.body.data.recentAudit), JSON.stringify(detail.body?.data?.rotation))

    const shortInterval = await vaultCall("rotation.savePolicy", "command", { key: "spot/check.key", intervalSeconds: 30, enabled: true })
    vaultCheck("rotation.savePolicy refuses under 60s with BAD_REQUEST", shortInterval.body?.error?.code === "BAD_REQUEST", `${shortInterval.body?.error?.code}`)
    const disabled = await vaultCall("rotation.savePolicy", "command", { key: "spot/check.key", intervalSeconds: 3600, enabled: false })
    vaultCheck("a disabled policy omits nextRotationAt", disabled.body?.data?.policy && !("nextRotationAt" in disabled.body.data.policy), JSON.stringify(disabled.body?.data?.policy))
    const enabled = await vaultCall("rotation.savePolicy", "command", { key: "spot/check.key", intervalSeconds: 3600, enabled: true })
    vaultCheck("re-enabling a policy gives it a nextRotationAt", typeof enabled.body?.data?.policy?.nextRotationAt === "string", JSON.stringify(enabled.body?.data?.policy))
    const notRotatable = await vaultCall("rotation.rotateNow", "command", { key: "spot/check.key" })
    vaultCheck("rotation.rotateNow refuses a key with no rotator with BAD_REQUEST", notRotatable.body?.error?.code === "BAD_REQUEST", `${notRotatable.body?.error?.code}`)

    // Saving an enabled policy unchanged keeps its due time. api/github.token's
    // seed due time is 12 days out on a 30-day interval, so a save that wrongly
    // reset it to now plus the interval would move it by 18 days, not by the
    // second or so between two calls.
    const githubBefore = await vaultCall("rotation.detail", "query", { key: "api/github.token" })
    const githubPolicy = githubBefore.body?.data?.policy
    const resaved = await vaultCall("rotation.savePolicy", "command", {
      key: "api/github.token",
      intervalSeconds: githubPolicy?.intervalSeconds,
      enabled: true,
    })
    vaultCheck(
      "saving an enabled policy unchanged keeps nextRotationAt byte for byte",
      githubPolicy?.enabled === true &&
        typeof githubPolicy.nextRotationAt === "string" &&
        resaved.body?.data?.policy?.nextRotationAt === githubPolicy.nextRotationAt,
      `before ${githubPolicy?.nextRotationAt}, after ${resaved.body?.data?.policy?.nextRotationAt}`,
    )
    // The other half of the rule, an enabled policy with no due time getting
    // one on save, has no state to start from here: every path through the
    // contract that stores a policy also gives it a due time, and nothing
    // clears one. Only a row written before the rule existed has none.

    // db/primary.password carries an expiry in the seed, so "unchanged" is a
    // real comparison and not undefined === undefined.
    const before = await vaultCall("secrets.detail", "query", { key: "db/primary.password" })
    const recordsBefore = await vaultCall("rotation.detail", "query", { key: "db/primary.password" })
    const rotated = await vaultCall("rotation.rotateNow", "command", { key: "db/primary.password" })
    const after = await vaultCall("secrets.detail", "query", { key: "db/primary.password" })
    const recordsAfter = await vaultCall("rotation.detail", "query", { key: "db/primary.password" })
    const expiryBefore = before.body?.data?.secret?.expiresAt
    vaultCheck(
      "rotation.rotateNow bumps the version",
      rotated.body?.data?.newVersion === before.body?.data?.secret?.version + 1 && after.body?.data?.secret?.version === rotated.body?.data?.newVersion,
      JSON.stringify(rotated.body?.data),
    )
    vaultCheck(
      "rotation.rotateNow keeps the expiry (the seed row has one)",
      typeof expiryBefore === "string" && after.body?.data?.secret?.expiresAt === expiryBefore,
      `before ${expiryBefore}, after ${after.body?.data?.secret?.expiresAt}`,
    )
    vaultCheck(
      "rotation.rotateNow appends a record, newest first",
      recordsAfter.body?.data?.records?.length === (recordsBefore.body?.data?.records?.length ?? 0) + 1 &&
        recordsAfter.body?.data?.records?.[0]?.oldVersion === before.body?.data?.secret?.version &&
        recordsAfter.body?.data?.records?.[0]?.newVersion === rotated.body?.data?.newVersion,
      JSON.stringify(recordsAfter.body?.data?.records?.[0]),
    )

    // The fixture models a keyed vault: Set stamps the algorithm on every write,
    // so replacing the legacy unencrypted row's value encrypts it.
    await vaultCall("secrets.update", "command", { key: "legacy/ftp.password", value: canary })
    const legacy = await vaultCall("secrets.detail", "query", { key: "legacy/ftp.password" })
    vaultCheck("secrets.update on the unencrypted row stamps AES-256-GCM", legacy.body?.data?.secret?.encryptionAlg === "AES-256-GCM", `${JSON.stringify(legacy.body?.data?.secret?.encryptionAlg)}`)

    // Metadata: absent keeps, present replaces (even with {}). On its own key,
    // so the version arithmetic above stays exact.
    await vaultCall("secrets.create", "command", { key: "spot/meta.key", value: canary })
    const metaSet = await vaultCall("secrets.update", "command", { key: "spot/meta.key", value: canary, metadata: { owner: "verify" } })
    const metaKept = await vaultCall("secrets.update", "command", { key: "spot/meta.key", value: canary })
    const metaReplaced = await vaultCall("secrets.update", "command", { key: "spot/meta.key", value: canary, metadata: { team: "qa" } })
    const metaEmptied = await vaultCall("secrets.update", "command", { key: "spot/meta.key", value: canary, metadata: {} })
    vaultCheck("secrets.update sets metadata when it is sent", JSON.stringify(metaSet.body?.data?.secret?.metadata) === '{"owner":"verify"}', JSON.stringify(metaSet.body?.data?.secret?.metadata))
    vaultCheck("secrets.update keeps metadata when it is absent", JSON.stringify(metaKept.body?.data?.secret?.metadata) === '{"owner":"verify"}', JSON.stringify(metaKept.body?.data?.secret?.metadata))
    vaultCheck("secrets.update replaces metadata when it is present", JSON.stringify(metaReplaced.body?.data?.secret?.metadata) === '{"team":"qa"}', JSON.stringify(metaReplaced.body?.data?.secret?.metadata))
    vaultCheck("secrets.update with metadata {} empties it", metaEmptied.body?.data?.secret && !("metadata" in metaEmptied.body.data.secret), JSON.stringify(metaEmptied.body?.data?.secret))

    // rotation.detail: a secret with no policy answers policy: null, a missing one is NOT_FOUND.
    const noPolicy = await vaultCall("rotation.detail", "query", { key: "spot/meta.key" })
    vaultCheck(
      "rotation.detail answers policy: null and rotatable: false for a secret with no policy",
      noPolicy.body?.ok === true && noPolicy.body.data.policy === null && noPolicy.body.data.rotatable === false && Array.isArray(noPolicy.body.data.records),
      JSON.stringify(noPolicy.body?.data),
    )
    const noSecret = await vaultCall("rotation.detail", "query", { key: "spot/none.key" })
    vaultCheck("rotation.detail on a missing secret is 404 NOT_FOUND", noSecret.status === 404 && noSecret.body?.error?.code === "NOT_FOUND", `${noSecret.status} ${noSecret.body?.error?.code}`)

    // The two policy commands and the delete, kept for the invalidates check below.
    const savedMeta = await vaultCall("rotation.savePolicy", "command", { key: "spot/meta.key", intervalSeconds: 600, enabled: true })
    const policyDeleted = await vaultCall("rotation.deletePolicy", "command", { key: "spot/meta.key" })
    const metaRemoved = await vaultCall("secrets.delete", "command", { key: "spot/meta.key" })

    const removed = await vaultCall("secrets.delete", "command", { key: "spot/check.key" })
    const policies = await vaultCall("rotation.policies", "query", {})
    vaultCheck(
      "secrets.delete removes the secret and its policy",
      removed.body?.data?.ok === true && !(policies.body?.data?.policies ?? []).some((p) => p.secretKey === "spot/check.key"),
      JSON.stringify(policies.body?.data),
    )
    const gone = await vaultCall("secrets.delete", "command", { key: "spot/check.key" })
    vaultCheck("secrets.delete on a missing key is 404 NOT_FOUND", gone.status === 404 && gone.body?.error?.code === "NOT_FOUND", `${gone.status} ${gone.body?.error?.code}`)

    // The manifest's invalidates, for all six commands.
    const invalidates = (r) => (r.body?.meta?.invalidates ?? []).slice().sort().join(",")
    const expectedInvalidates = [
      ["secrets.create", created, "secrets.detail,secrets.list,secrets.versions"],
      ["secrets.update", kept, "secrets.detail,secrets.list,secrets.versions"],
      ["secrets.delete", removed, "rotation.detail,rotation.policies,secrets.detail,secrets.list,secrets.versions"],
      ["rotation.savePolicy", savedMeta, "rotation.detail,rotation.policies,secrets.detail"],
      ["rotation.deletePolicy", policyDeleted, "rotation.detail,rotation.policies,secrets.detail"],
      ["rotation.rotateNow", rotated, "rotation.detail,rotation.policies,secrets.detail,secrets.list,secrets.versions"],
    ]
    for (const [intent, response, want] of expectedInvalidates) {
      vaultCheck(`${intent} declares the manifest's invalidates`, invalidates(response) === want, `${invalidates(response)} vs ${want}`)
    }
    vaultCheck("the metadata-key cleanup delete succeeded", metaRemoved.body?.data?.ok === true, JSON.stringify(metaRemoved.body))

    // No response, from any vault intent, may carry the value.
    const everything = JSON.stringify([page1.body, all.body, created.body, kept.body, cleared.body, versions.body, detail.body, rotated.body])
    vaultCheck("no response carries a secret value", !everything.includes(canary), "the canary value came back")

    // -- flags: the rules the Go manager, engine and handlers enforce ---------
    const { createHash } = await import("node:crypto")
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const data = (r) => r.body?.data
    const failure = (r) => `${r.status} ${r.body?.error?.code}: ${r.body?.error?.message}`
    /** A refusal: this HTTP status, this contract code and exactly this message. */
    const refused = (r, status, code, message) => r.status === status && r.body?.error?.code === code && r.body?.error?.message === message
    const badRequest = (r, message) => refused(r, 400, "BAD_REQUEST", message)
    const flagCall = (intent, input) => vaultCall(intent, /\.(list|detail|evaluate)$/.test(intent) ? "query" : "command", input)
    const bucketOf = (tenantId, key) => createHash("sha256").update(`${tenantId}:${key}`).digest().readUInt32BE(0) % 100
    const flagActions = async (key) => (data(await flagCall("flags.detail", { key }))?.recentAudit ?? []).map((e) => e.action)
    const rulesWithoutIds = (rules) => rules.map(({ id, ...rest }) => rest)

    // Seed: 30 flags, all five types, a second page, a type filter and a total.
    const fpage1 = await flagCall("flags.list", {})
    const fpage2 = await flagCall("flags.list", { offset: 25 })
    const flist = data(fpage1)
    vaultCheck(
      "flags.list pages (25 then the rest, exact total)",
      flist?.flags?.length === 25 && data(fpage2)?.flags?.length === flist.total - 25 && flist.total === 30,
      `got ${flist?.flags?.length} then ${data(fpage2)?.flags?.length} of ${flist?.total}`,
    )
    const fall = data(await flagCall("flags.list", { limit: 500 }))?.flags ?? []
    vaultCheck(
      "the seed covers all five types and is in key order",
      ["bool", "string", "int", "float", "json"].every((t) => fall.some((f) => f.type === t)) && same(fall.map((f) => f.key), fall.map((f) => f.key).sort()),
      JSON.stringify([...new Set(fall.map((f) => f.type))]),
    )
    const jsonOnly = data(await flagCall("flags.list", { type: "json", limit: 1 }))
    vaultCheck("flags.list filters by type, and total counts the filter not the page", jsonOnly?.flags?.length === 1 && jsonOnly.flags[0].type === "json" && jsonOnly.total === 2, JSON.stringify(jsonOnly))
    const badType = await flagCall("flags.list", { type: "boolean" })
    vaultCheck("flags.list refuses an unknown type", badRequest(badType, "type must be one of bool, string, int, float, json"), failure(badType))
    vaultCheck("a flag row carries every projected field", fall.every((f) => ["id", "key", "type", "defaultValue", "defaultMatchesType", "description", "tags", "enabled", "createdAt", "updatedAt"].every((k) => k in f) && Array.isArray(f.tags)), "a field is missing or tags is not a list")

    const strict = fall.find((f) => f.key === "legacy.strict-mode")
    vaultCheck("the seed has a bool flag with the string \"true\" default, flagged as the wrong type", strict?.type === "bool" && strict.defaultValue === "true" && strict.defaultMatchesType === false, JSON.stringify(strict))
    vaultCheck("a well-typed default reports defaultMatchesType true", fall.filter((f) => f.key !== "legacy.strict-mode").every((f) => f.defaultMatchesType === true), "a seed default does not match its type")
    // auth.passkeys is the other one: the intent loop above disabled it through
    // flags.setEnabled before this check runs.
    const disabledKeys = fall.filter((f) => !f.enabled).map((f) => f.key)
    vaultCheck("the seed has one disabled flag (and flags.setEnabled disabled auth.passkeys)", same(disabledKeys, ["auth.passkeys", "beta.dark-mode"]), JSON.stringify(disabledKeys))

    const ladder = data(await flagCall("flags.detail", { key: "checkout.new-flow" }))
    vaultCheck(
      "one seeded flag has every rule type in order, priorities from the index",
      same((ladder?.rules ?? []).map((r) => r.type), ["when_tenant", "when_user", "rollout", "schedule", "when_tenant_tag", "custom"]) && (ladder?.rules ?? []).every((r, i) => r.priority === i),
      JSON.stringify((ladder?.rules ?? []).map((r) => [r.priority, r.type])),
    )
    vaultCheck(
      "implemented is false for when_tenant_tag and custom only",
      same((ladder?.rules ?? []).map((r) => r.implemented), [true, true, true, true, false, false]),
      JSON.stringify((ladder?.rules ?? []).map((r) => r.implemented)),
    )
    const tagRule = ladder?.rules?.[4]
    const customRule = ladder?.rules?.[5]
    vaultCheck(
      "the tag and custom rules keep their config",
      tagRule?.tagKey === "plan" && tagRule.tagValue === "enterprise" && customRule?.evaluator === "beta-cohort" && same(customRule.params, { cohort: "early", weight: 2, flags: ["a", "b"] }),
      JSON.stringify([tagRule, customRule]),
    )
    const wayneEval = data(await flagCall("flags.evaluate", { key: "checkout.new-flow", tenantId: "wayne" }))
    vaultCheck(
      "an evaluation names each rule by id in the engine's order, and the deciding rule by matchedRuleId",
      wayneEval?.reason === "rule" && wayneEval.matchedRuleId === ladder?.rules?.[2]?.id && wayneEval.matchedRulePriority === 2 && same((wayneEval.trace ?? []).map((s) => s.ruleId), (ladder?.rules ?? []).map((r) => r.id)) && (wayneEval.trace ?? []).every((s) => typeof s.ruleId === "string" && s.ruleId !== ""),
      JSON.stringify({ matchedRuleId: wayneEval?.matchedRuleId, trace: (wayneEval?.trace ?? []).map((s) => s.ruleId), rules: (ladder?.rules ?? []).map((r) => r.id) }),
    )
    vaultCheck(
      "matchedRuleId is absent unless a rule decided",
      !("matchedRuleId" in (data(await flagCall("flags.evaluate", { key: "checkout.new-flow", tenantId: "globex" })) ?? {})),
      "globex walks every rung to the default",
    )
    vaultCheck(
      "flags.detail carries cacheTtlSeconds 30 and never null lists",
      ladder?.cacheTtlSeconds === 30 && Array.isArray(ladder.variants) && Array.isArray(ladder.overrides) && Array.isArray(ladder.recentAudit) && ladder.metadata !== null && typeof ladder.metadata === "object",
      JSON.stringify({ ttl: ladder?.cacheTtlSeconds }),
    )
    const strictDetail = data(await flagCall("flags.detail", { key: "legacy.strict-mode" }))
    vaultCheck("a rule returning the wrong type is flagged returnMatchesType false", strictDetail?.rules?.[0]?.returnValue === "false" && strictDetail.rules[0].returnMatchesType === false, JSON.stringify(strictDetail?.rules))
    const themed = data(await flagCall("flags.detail", { key: "ui.theme" }))
    vaultCheck("one seeded flag carries variants and metadata", themed?.variants?.length === 3 && themed.variants[0].value === "light" && themed.metadata?.owner === "design", JSON.stringify([themed?.variants, themed?.metadata]))
    const invoice = data(await flagCall("flags.detail", { key: "billing/invoice-v2" }))
    const rate = data(await flagCall("flags.detail", { key: "limits.api-rate" }))
    vaultCheck(
      "two seeded flags carry tenant overrides, listed by tenant",
      same((invoice?.overrides ?? []).map((o) => o.tenantId), ["acme", "initech"]) && same((rate?.overrides ?? []).map((o) => o.tenantId), ["acme", "globex"]) && [...(invoice?.overrides ?? []), ...(rate?.overrides ?? [])].every((o) => o.valueMatchesType === true),
      JSON.stringify([invoice?.overrides, rate?.overrides]),
    )
    const missingFlag = await flagCall("flags.detail", { key: "spot/none.flag" })
    vaultCheck("flags.detail on a missing key is 404 NOT_FOUND", refused(missingFlag, 404, "NOT_FOUND", "flag not found"), failure(missingFlag))
    const blankKey = await flagCall("flags.detail", { key: "  " })
    vaultCheck("flags.detail with a blank key is BAD_REQUEST", badRequest(blankKey, "key is required"), failure(blankKey))

    // create: the manager's refusals, in its order.
    const boolWithString = await flagCall("flags.create", { key: "spot/flag.bad", type: "bool", defaultValue: "true", enabled: true })
    vaultCheck("flags.create refuses a string default on a bool flag", badRequest(boolWithString, "flag: defaultValue: must be a boolean, got a string"), failure(boolWithString))
    const intFraction = await flagCall("flags.create", { key: "spot/flag.bad", type: "int", defaultValue: 1.5 })
    vaultCheck("flags.create refuses a fractional int", badRequest(intFraction, "flag: defaultValue: must be a whole number, got 1.5"), failure(intFraction))
    const intHuge = await flagCall("flags.create", { key: "spot/flag.bad", type: "int", defaultValue: 2 ** 53 + 2 })
    vaultCheck("flags.create refuses an int beyond 2^53", badRequest(intHuge, "flag: defaultValue: must not exceed 2^53 in magnitude, got 9.007199254740994e+15"), failure(intHuge))
    const floatWithString = await flagCall("flags.create", { key: "spot/flag.bad", type: "float", defaultValue: "1.5" })
    vaultCheck("flags.create refuses a string default on a float flag", badRequest(floatWithString, "flag: defaultValue: must be a number, got a string"), failure(floatWithString))
    const stringWithNull = await flagCall("flags.create", { key: "spot/flag.bad", type: "string", defaultValue: null })
    vaultCheck("flags.create refuses null on a string flag", badRequest(stringWithNull, "flag: defaultValue: must be a string, got null"), failure(stringWithNull))
    const noDefault = await flagCall("flags.create", { key: "spot/flag.bad", type: "bool" })
    vaultCheck("flags.create with no default is refused like a null one", badRequest(noDefault, "flag: defaultValue: must be a boolean, got null"), failure(noDefault))
    const badFlagType = await flagCall("flags.create", { key: "spot/flag.bad", type: "boolean", defaultValue: true })
    vaultCheck("flags.create refuses an unknown type", badRequest(badFlagType, "flag: type: must be one of bool, string, int, float, json"), failure(badFlagType))
    const noKey = await flagCall("flags.create", { key: "", type: "bool", defaultValue: true })
    vaultCheck("flags.create refuses a blank key", badRequest(noKey, "key is required"), failure(noKey))
    const longKey = await flagCall("flags.create", { key: "k".repeat(257), type: "bool", defaultValue: true })
    vaultCheck("flags.create refuses a key over 256 bytes", badRequest(longKey, "flag: key: must be at most 256 bytes"), failure(longKey))
    const beforeRefusals = data(await flagCall("flags.list", {}))?.total
    vaultCheck("no refused create left a flag behind", beforeRefusals === flist?.total, `${beforeRefusals} vs ${flist?.total}`)

    const fcreated = await flagCall("flags.create", { key: "spot/flag.a", type: "bool", defaultValue: false, description: "spot", tags: ["one", "two"], enabled: true })
    vaultCheck(
      "flags.create answers the flag it made",
      fcreated.body?.data?.flag?.key === "spot/flag.a" && fcreated.body.data.flag.enabled === true && fcreated.body.data.flag.defaultMatchesType === true && same(fcreated.body.data.flag.tags, ["one", "two"]) && fcreated.body.data.flag.description === "spot",
      JSON.stringify(fcreated.body),
    )
    const fagain = await flagCall("flags.create", { key: "spot/flag.a", type: "int", defaultValue: 3 })
    vaultCheck("flags.create refuses an existing key with 409 CONFLICT", refused(fagain, 409, "CONFLICT", "a flag with this key already exists"), failure(fagain))
    const afterConflict = data(await flagCall("flags.detail", { key: "spot/flag.a" }))?.flag
    vaultCheck("a refused create leaves the flag exactly as it was", afterConflict?.type === "bool" && afterConflict.defaultValue === false, JSON.stringify(afterConflict))
    const fgrown = data(await flagCall("flags.list", {}))?.total
    vaultCheck("flags.create grows the list total", fgrown === (flist?.total ?? 0) + 1, `${fgrown} vs ${flist?.total}`)
    const emptyTagsFlag = await flagCall("flags.create", { key: "spot/flag.str", type: "string", defaultValue: "" })
    vaultCheck("a string flag may default to the empty string, and tags are [] not null", emptyTagsFlag.body?.data?.flag?.defaultValue === "" && same(emptyTagsFlag.body.data.flag.tags, []) && emptyTagsFlag.body.data.flag.enabled === false, JSON.stringify(emptyTagsFlag.body))
    const jsonNull = await flagCall("flags.create", { key: "spot/flag.json", type: "json", defaultValue: null })
    vaultCheck("a json flag may default to null", jsonNull.body?.data?.flag?.defaultValue === null && jsonNull.body.data.flag.defaultMatchesType === true, JSON.stringify(jsonNull.body))

    // update: absent leaves, present sets, checked against the stored type.
    const updBad = await flagCall("flags.update", { key: "spot/flag.a", defaultValue: "true" })
    vaultCheck("flags.update refuses a default that does not match the stored type", badRequest(updBad, "flag: defaultValue: must be a boolean, got a string"), failure(updBad))
    const updNullBool = await flagCall("flags.update", { key: "spot/flag.a", defaultValue: null })
    vaultCheck("flags.update refuses null on a bool flag", badRequest(updNullBool, "flag: defaultValue: must be a boolean, got null"), failure(updNullBool))
    const updDesc = await flagCall("flags.update", { key: "spot/flag.a", description: "renamed" })
    vaultCheck("flags.update leaves an absent default and tags alone", updDesc.body?.data?.flag?.description === "renamed" && updDesc.body.data.flag.defaultValue === false && same(updDesc.body.data.flag.tags, ["one", "two"]), JSON.stringify(updDesc.body))
    const updTrue = await flagCall("flags.update", { key: "spot/flag.a", defaultValue: true, tags: [] })
    vaultCheck("flags.update sets a present default and an empty tag list", updTrue.body?.data?.flag?.defaultValue === true && same(updTrue.body.data.flag.tags, []), JSON.stringify(updTrue.body))
    const updJson = await flagCall("flags.update", { key: "spot/flag.json", defaultValue: { a: [1, 2] } })
    const updJsonNull = await flagCall("flags.update", { key: "spot/flag.json", defaultValue: null })
    vaultCheck("flags.update sets a json default and a null one", same(updJson.body?.data?.flag?.defaultValue, { a: [1, 2] }) && updJsonNull.body?.data?.flag?.defaultValue === null, JSON.stringify([updJson.body, updJsonNull.body]))
    const updMissing = await flagCall("flags.update", { key: "spot/none.flag", description: "x" })
    vaultCheck("flags.update on a missing key is 404 NOT_FOUND", refused(updMissing, 404, "NOT_FOUND", "flag not found"), failure(updMissing))

    // setRules: refusals first, then the ladder and what the engine does with it.
    const rulesAbsent = await flagCall("flags.setRules", { key: "spot/flag.a" })
    vaultCheck("flags.setRules refuses an absent rules list", badRequest(rulesAbsent, "rules is required; send an empty list to clear them"), failure(rulesAbsent))
    const rulesNull = await flagCall("flags.setRules", { key: "spot/flag.a", rules: null })
    vaultCheck("flags.setRules refuses a null rules list", badRequest(rulesNull, "rules is required; send an empty list to clear them"), failure(rulesNull))
    const ruleRefusals = [
      ["a percentage over 100", { type: "rollout", percentage: 101, returnValue: true }, "flag: rules[0].percentage: must be between 0 and 100"],
      ["a negative percentage", { type: "rollout", percentage: -1, returnValue: true }, "flag: rules[0].percentage: must be between 0 and 100"],
      ["no tenant ids", { type: "when_tenant", tenantIds: [], returnValue: true }, "flag: rules[0].tenantIds: must list at least one id"],
      ["a blank tenant id", { type: "when_tenant", tenantIds: ["acme", " "], returnValue: true }, "flag: rules[0].tenantIds: must not contain a blank id"],
      ["a duplicate tenant id", { type: "when_tenant", tenantIds: ["acme", " acme "], returnValue: true }, 'flag: rules[0].tenantIds: lists "acme" more than once'],
      ["no user ids", { type: "when_user", returnValue: true }, "flag: rules[0].userIds: must list at least one id"],
      ["a schedule with no bounds", { type: "schedule", returnValue: true }, "flag: rules[0].startAt: a schedule needs a start, an end, or both"],
      ["a schedule that ends before it starts", { type: "schedule", startAt: "2030-01-02T00:00:00Z", endAt: "2030-01-01T00:00:00Z", returnValue: true }, "flag: rules[0].endAt: must be after the start"],
      ["a schedule that ends when it starts", { type: "schedule", startAt: "2030-01-01T00:00:00Z", endAt: "2030-01-01T00:00:00Z", returnValue: true }, "flag: rules[0].endAt: must be after the start"],
      ["an unknown rule type", { type: "geo", returnValue: true }, 'flag: rules[0].type: unknown rule type "geo"'],
      ["a return value of the wrong type", { type: "rollout", percentage: 5, returnValue: "yes" }, "flag: rules[0].returnValue: must be a boolean, got a string"],
      ["a missing return value", { type: "rollout", percentage: 5 }, "flag: rules[0].returnValue: must be a boolean, got null"],
    ]
    for (const [what, rule, message] of ruleRefusals) {
      const r = await flagCall("flags.setRules", { key: "spot/flag.a", rules: [rule] })
      vaultCheck(`flags.setRules refuses ${what}`, badRequest(r, message), failure(r))
    }
    const badTime = await flagCall("flags.setRules", { key: "spot/flag.a", rules: [{ type: "rollout", percentage: 1, returnValue: true }, { type: "schedule", startAt: "tomorrow", returnValue: true }] })
    vaultCheck("flags.setRules refuses a start that is not RFC3339, naming its index", badRequest(badTime, "rules[1].startAt must be an RFC3339 timestamp"), failure(badTime))
    const badEnd = await flagCall("flags.setRules", { key: "spot/flag.a", rules: [{ type: "schedule", endAt: "2030-01-01 00:00", returnValue: true }] })
    vaultCheck("flags.setRules refuses an end that is not RFC3339", badRequest(badEnd, "rules[0].endAt must be an RFC3339 timestamp"), failure(badEnd))
    const laterBad = await flagCall("flags.setRules", { key: "spot/flag.a", rules: [{ type: "rollout", percentage: 50, returnValue: true }, { type: "rollout", percentage: 200, returnValue: true }] })
    vaultCheck("flags.setRules names the rule at fault by its index", badRequest(laterBad, "flag: rules[1].percentage: must be between 0 and 100"), failure(laterBad))
    vaultCheck("no refused setRules wrote anything", same(data(await flagCall("flags.detail", { key: "spot/flag.a" }))?.rules, []), "a refused list left rules behind")
    const rulesOnMissing = await flagCall("flags.setRules", { key: "spot/none.flag", rules: [] })
    vaultCheck("flags.setRules on a missing key is 404 NOT_FOUND", refused(rulesOnMissing, 404, "NOT_FOUND", "flag not found"), failure(rulesOnMissing))

    // The engine's order: disabled, tenant override, rules in order, default.
    const ordered = await flagCall("flags.setRules", {
      key: "spot/flag.a",
      rules: [
        { type: "when_tenant", tenantIds: ["acme"], returnValue: true },
        { type: "when_user", userIds: ["usr_9"], returnValue: true },
        { type: "rollout", percentage: 100, returnValue: true },
      ],
    })
    vaultCheck(
      "flags.setRules answers the stored rules, priority from the index, every return value matching",
      same((ordered.body?.data?.rules ?? []).map((r) => [r.priority, r.type, r.implemented, r.returnMatchesType]), [[0, "when_tenant", true, true], [1, "when_user", true, true], [2, "rollout", true, true]]),
      JSON.stringify(ordered.body),
    )
    const evAcme = data(await flagCall("flags.evaluate", { key: "spot/flag.a", tenantId: "acme" }))
    vaultCheck(
      "a rule at priority 0 decides, matchedRulePriority 0 survives, and the rest are not reached",
      evAcme?.reason === "rule" && evAcme.value === true && evAcme.matchedRulePriority === 0 && same((evAcme.trace ?? []).map((s) => [s.priority, s.matched, s.reached, s.note]), [[0, true, true, "tenant acme"], [1, false, false, ""], [2, false, false, ""]]),
      JSON.stringify(evAcme),
    )
    const evBucket = data(await flagCall("flags.evaluate", { key: "spot/flag.a", tenantId: "zeta", userId: "usr_1" }))
    const zetaBucket = bucketOf("zeta", "spot/flag.a")
    vaultCheck(
      "the engine's trace notes are in its wording, and a rollout falls through to the rollout rule",
      evBucket?.reason === "rule" && evBucket.matchedRulePriority === 2 && same((evBucket.trace ?? []).map((s) => s.note), ["tenant zeta", "user usr_1", `bucket ${zetaBucket} of 100, threshold 100`]),
      JSON.stringify(evBucket),
    )
    vaultCheck("bucket is sha256(tenantId:key), first four bytes big-endian, mod 100", evBucket?.bucket === zetaBucket, `${evBucket?.bucket} vs ${zetaBucket}`)
    const evNoTenant = data(await flagCall("flags.evaluate", { key: "spot/flag.a" }))
    vaultCheck(
      "with no tenant or user there is no bucket, and the notes say so",
      evNoTenant && !("bucket" in evNoTenant) && same((evNoTenant.trace ?? []).map((s) => s.note), ["no tenant in context", "no user in context", "no tenant in context, a rollout cannot match"]) && evNoTenant.reason === "default" && evNoTenant.matchedRulePriority === undefined && evNoTenant.value === true,
      JSON.stringify(evNoTenant),
    )
    vaultCheck("evaluate reports the flag's own type check and a timestamp", evNoTenant?.valueMatchesType === true && typeof evNoTenant.evaluatedAt === "string", JSON.stringify(evNoTenant))
    const evMissing = await flagCall("flags.evaluate", { key: "spot/none.flag" })
    vaultCheck("flags.evaluate on a missing key is 404 NOT_FOUND", refused(evMissing, 404, "NOT_FOUND", "flag not found"), failure(evMissing))

    // Overrides.
    const ovMissingFlag = await flagCall("flags.setTenantOverride", { key: "spot/none.flag", tenantId: "acme", value: true })
    vaultCheck("flags.setTenantOverride on a missing flag is 404 NOT_FOUND", refused(ovMissingFlag, 404, "NOT_FOUND", "flag not found"), failure(ovMissingFlag))
    const ovBlank = await flagCall("flags.setTenantOverride", { key: "spot/flag.a", tenantId: "  ", value: true })
    vaultCheck("flags.setTenantOverride refuses a blank tenant", badRequest(ovBlank, "flag: tenantId: is required"), failure(ovBlank))
    const ovWrongType = await flagCall("flags.setTenantOverride", { key: "spot/flag.a", tenantId: "acme", value: "true" })
    vaultCheck("flags.setTenantOverride refuses a value of the wrong type", badRequest(ovWrongType, "flag: value: must be a boolean, got a string"), failure(ovWrongType))
    const ovSet = await flagCall("flags.setTenantOverride", { key: "spot/flag.a", tenantId: " acme ", value: false })
    vaultCheck("flags.setTenantOverride trims the tenant and answers the override", ovSet.body?.data?.override?.tenantId === "acme" && ovSet.body.data.override.value === false && ovSet.body.data.override.valueMatchesType === true && typeof ovSet.body.data.override.updatedAt === "string", JSON.stringify(ovSet.body))
    const evOverride = data(await flagCall("flags.evaluate", { key: "spot/flag.a", tenantId: "acme" }))
    vaultCheck("an override beats every rule, with an empty trace and the bucket still reported", evOverride?.reason === "tenantOverride" && evOverride.value === false && same(evOverride.trace, []) && evOverride.bucket === bucketOf("acme", "spot/flag.a"), JSON.stringify(evOverride))
    const ovDeleted = await flagCall("flags.deleteTenantOverride", { key: "spot/flag.a", tenantId: "acme" })
    vaultCheck("flags.deleteTenantOverride answers ok, the key and the tenant", same([ovDeleted.body?.data?.ok, ovDeleted.body?.data?.key, ovDeleted.body?.data?.tenantId], [true, "spot/flag.a", "acme"]), JSON.stringify(ovDeleted.body))
    const evAfterOverride = data(await flagCall("flags.evaluate", { key: "spot/flag.a", tenantId: "acme" }))
    vaultCheck("deleting the override hands the tenant back to the rules", evAfterOverride?.reason === "rule" && evAfterOverride.value === true, JSON.stringify(evAfterOverride))
    const ovDeletedTwice = await flagCall("flags.deleteTenantOverride", { key: "spot/flag.a", tenantId: "acme" })
    vaultCheck("flags.deleteTenantOverride with none set is 404 NOT_FOUND", refused(ovDeletedTwice, 404, "NOT_FOUND", "tenant override not found"), failure(ovDeletedTwice))
    const ovDelBlank = await flagCall("flags.deleteTenantOverride", { key: "spot/flag.a", tenantId: "" })
    vaultCheck("flags.deleteTenantOverride refuses a blank tenant", badRequest(ovDelBlank, "flag: tenantId: is required"), failure(ovDelBlank))
    const ovDelMissingFlag = await flagCall("flags.deleteTenantOverride", { key: "spot/none.flag", tenantId: "acme" })
    vaultCheck("flags.deleteTenantOverride on a missing flag says the flag is missing", refused(ovDelMissingFlag, 404, "NOT_FOUND", "flag not found"), failure(ovDelMissingFlag))

    // Value types per flag type.
    await flagCall("flags.create", { key: "spot/flag.int", type: "int", defaultValue: 5, enabled: true })
    const ovIntString = await flagCall("flags.setTenantOverride", { key: "spot/flag.int", tenantId: "acme", value: "9" })
    vaultCheck("an int override refuses a string", badRequest(ovIntString, "flag: value: must be a whole number, got a string"), failure(ovIntString))
    const ovIntFraction = await flagCall("flags.setTenantOverride", { key: "spot/flag.int", tenantId: "acme", value: 2.5 })
    vaultCheck("an int override refuses a fraction", badRequest(ovIntFraction, "flag: value: must be a whole number, got 2.5"), failure(ovIntFraction))
    const ruleIntFraction = await flagCall("flags.setRules", { key: "spot/flag.int", rules: [{ type: "rollout", percentage: 5, returnValue: 1.5 }] })
    vaultCheck("an int rule return refuses a fraction", badRequest(ruleIntFraction, "flag: rules[0].returnValue: must be a whole number, got 1.5"), failure(ruleIntFraction))
    const ovIntOk = await flagCall("flags.setTenantOverride", { key: "spot/flag.int", tenantId: "acme", value: -7 })
    vaultCheck("an int override accepts a negative whole number", ovIntOk.body?.data?.override?.value === -7, JSON.stringify(ovIntOk.body))
    const ovJson = await flagCall("flags.setTenantOverride", { key: "spot/flag.json", tenantId: "acme", value: { deep: { list: [1, "two", null] } } })
    vaultCheck("a json override accepts any JSON value, null included", same(ovJson.body?.data?.override?.value, { deep: { list: [1, "two", null] } }), JSON.stringify(ovJson.body))

    // setEnabled: a disabled flag stops evaluating its rules at once.
    // The default goes back to false first, so the value a disabled flag serves
    // differs from the value its rules serve.
    await flagCall("flags.update", { key: "spot/flag.a", defaultValue: false })
    const auditBeforeToggle = await flagActions("spot/flag.a")
    const off =await flagCall("flags.setEnabled", { key: "spot/flag.a", enabled: false })
    const evOff = data(await flagCall("flags.evaluate", { key: "spot/flag.a", tenantId: "acme" }))
    vaultCheck(
      "disabling a flag changes the next evaluate to the default, with an empty trace",
      off.body?.data?.flag?.enabled === false && evOff?.reason === "disabled" && evOff.value === false && same(evOff.trace, []) && evOff.matchedRulePriority === undefined,
      JSON.stringify([off.body?.data?.flag, evOff]),
    )
    const offAgain = await flagCall("flags.setEnabled", { key: "spot/flag.a", enabled: false })
    vaultCheck("disabling a disabled flag changes nothing and records nothing", offAgain.body?.data?.flag?.updatedAt === off.body?.data?.flag?.updatedAt && (await flagActions("spot/flag.a")).length === auditBeforeToggle.length + 1, JSON.stringify(await flagActions("spot/flag.a")))
    const on = await flagCall("flags.setEnabled", { key: "spot/flag.a", enabled: true })
    const evOn = data(await flagCall("flags.evaluate", { key: "spot/flag.a", tenantId: "acme" }))
    vaultCheck("enabling it again restores the rules", on.body?.data?.flag?.enabled === true && evOn?.reason === "rule" && evOn.value === true, JSON.stringify(evOn))
    const enabledMissing = await flagCall("flags.setEnabled", { key: "spot/none.flag", enabled: true })
    vaultCheck("flags.setEnabled on a missing key is 404 NOT_FOUND", refused(enabledMissing, 404, "NOT_FOUND", "flag not found"), failure(enabledMissing))

    // Schedules: the three notes, and a window that is open matches.
    const in2099 = "2099-01-01T00:00:00Z"
    await flagCall("flags.create", { key: "spot/flag.win", type: "bool", defaultValue: false, enabled: true })
    const windows = await flagCall("flags.setRules", {
      key: "spot/flag.win",
      rules: [
        { type: "schedule", startAt: in2099, returnValue: true },
        { type: "schedule", endAt: "2001-01-01T00:00:00Z", returnValue: true },
        { type: "schedule", startAt: "2001-01-01T00:00:00+02:00", endAt: in2099, returnValue: true },
      ],
    })
    vaultCheck("schedule times are stored in UTC", windows.body?.data?.rules?.[2]?.startAt === "2000-12-31T22:00:00Z" && windows.body.data.rules[2].endAt === in2099 && !("endAt" in windows.body.data.rules[0]) && !("startAt" in windows.body.data.rules[1]), JSON.stringify(windows.body))
    const evWin = data(await flagCall("flags.evaluate", { key: "spot/flag.win" }))
    vaultCheck(
      "schedule notes: not started, ended, inside the window",
      evWin?.reason === "rule" && evWin.matchedRulePriority === 2 && same((evWin.trace ?? []).map((s) => [s.matched, s.note]), [[false, "the window has not started"], [false, "the window has ended"], [true, "inside the window"]]),
      JSON.stringify(evWin),
    )

    // setRules round trip: what detail returns can be sent straight back, and
    // the custom and tag rules keep their config through it.
    const original = data(await flagCall("flags.detail", { key: "checkout.new-flow" }))?.rules ?? []
    await flagCall("flags.create", { key: "spot/flag.trip", type: "bool", defaultValue: false, enabled: true })
    const sentBack = await flagCall("flags.setRules", { key: "spot/flag.trip", rules: original })
    const roundTripped = data(await flagCall("flags.detail", { key: "spot/flag.trip" }))?.rules ?? []
    vaultCheck(
      "flags.setRules round-trips every rule type, the custom one's evaluator and params included",
      original.length === 6 && sentBack.body?.ok === true && same(rulesWithoutIds(roundTripped), rulesWithoutIds(original)) && same(rulesWithoutIds(sentBack.body?.data?.rules ?? []), rulesWithoutIds(original)),
      `${failure(sentBack)} ${JSON.stringify(rulesWithoutIds(roundTripped)[5])}`,
    )
    const reordered = await flagCall("flags.setRules", { key: "spot/flag.trip", rules: [...original].reverse() })
    vaultCheck("a reordered list takes its priorities from the new order", same((reordered.body?.data?.rules ?? []).map((r) => [r.priority, r.type]), [[0, "custom"], [1, "when_tenant_tag"], [2, "schedule"], [3, "rollout"], [4, "when_user"], [5, "when_tenant"]]), JSON.stringify(reordered.body))
    const emptied = await flagCall("flags.setRules", { key: "spot/flag.trip", rules: [] })
    vaultCheck("an empty list clears the rules", emptied.body?.ok === true && same(emptied.body.data.rules, []) && same(data(await flagCall("flags.detail", { key: "spot/flag.trip" }))?.rules, []), JSON.stringify(emptied.body))

    // A flag deleted and made again starts clean: no rules, no overrides.
    await flagCall("flags.setRules", { key: "spot/flag.trip", rules: [{ type: "rollout", percentage: 50, returnValue: true }] })
    await flagCall("flags.setTenantOverride", { key: "spot/flag.trip", tenantId: "acme", value: true })
    const dropped = await flagCall("flags.delete", { key: "spot/flag.trip" })
    vaultCheck("flags.delete answers ok and the key", same([dropped.body?.data?.ok, dropped.body?.data?.key], [true, "spot/flag.trip"]), JSON.stringify(dropped.body))
    const droppedDetail = await flagCall("flags.detail", { key: "spot/flag.trip" })
    vaultCheck("a deleted flag is gone", refused(droppedDetail, 404, "NOT_FOUND", "flag not found"), failure(droppedDetail))
    const droppedTwice = await flagCall("flags.delete", { key: "spot/flag.trip" })
    vaultCheck("flags.delete on a missing key is 404 NOT_FOUND", refused(droppedTwice, 404, "NOT_FOUND", "flag not found"), failure(droppedTwice))
    await flagCall("flags.create", { key: "spot/flag.trip", type: "bool", defaultValue: true, enabled: true })
    const reborn = data(await flagCall("flags.detail", { key: "spot/flag.trip" }))
    vaultCheck("create after delete starts clean: no rules, no overrides", same(reborn?.rules, []) && same(reborn?.overrides, []) && reborn?.flag?.defaultValue === true, JSON.stringify([reborn?.rules, reborn?.overrides]))
    const rebornEval = data(await flagCall("flags.evaluate", { key: "spot/flag.trip", tenantId: "acme" }))
    vaultCheck("and evaluates to its default", rebornEval?.reason === "default" && rebornEval.value === true && same(rebornEval.trace, []), JSON.stringify(rebornEval))

    // Audit: flag rows and secret rows never show in each other's history.
    vaultCheck(
      "flags.detail's recentAudit holds the flag actions, newest first",
      same((await flagActions("spot/flag.a")).slice(0, 3), ["flag.toggled", "flag.toggled", "flag.updated"]) && (await flagActions("spot/flag.a")).every((a) => a.startsWith("flag.")),
      JSON.stringify(await flagActions("spot/flag.a")),
    )
    const allActions = new Set()
    for (const key of ["spot/flag.a", "spot/flag.json", "spot/flag.int", "spot/flag.trip", "checkout.new-flow", "ui.theme", "beta.dark-mode", "billing/invoice-v2"]) for (const a of await flagActions(key)) allActions.add(a)
    vaultCheck("every flag audit action is one Go writes", [...allActions].every((a) => ["flag.created", "flag.updated", "flag.toggled", "flag.deleted", "flag.rules_set", "flag.override_set", "flag.override_deleted"].includes(a)) && ["flag.created", "flag.updated", "flag.toggled", "flag.rules_set", "flag.override_set", "flag.override_deleted"].every((a) => allActions.has(a)), JSON.stringify([...allActions]))
    // A flag sharing a secret's key: each side's detail must show only its own.
    await flagCall("flags.create", { key: "api/stripe.key", type: "bool", defaultValue: false, enabled: true })
    await flagCall("flags.setEnabled", { key: "api/stripe.key", enabled: false })
    const flagSide = await flagActions("api/stripe.key")
    const secretSide = (data(await vaultCall("secrets.detail", "query", { key: "api/stripe.key" }))?.recentAudit ?? []).map((e) => e.action)
    vaultCheck("secrets.detail's recentAudit leaves out flag rows", secretSide.length > 0 && secretSide.every((a) => a.startsWith("secret.")), JSON.stringify(secretSide))
    vaultCheck("flags.detail's recentAudit leaves out secret rows", same(flagSide, ["flag.toggled", "flag.created"]), JSON.stringify(flagSide))
    const flagDeleteAudit = await flagCall("flags.delete", { key: "api/stripe.key" })
    vaultCheck("flags.delete records flag.deleted without touching the secret", flagDeleteAudit.body?.ok === true && (await vaultCall("secrets.detail", "query", { key: "api/stripe.key" })).body?.ok === true, JSON.stringify(flagDeleteAudit.body))

    // The manifest's invalidates, for the seven flag commands.
    const flagInvalidates = [
      ["flags.create", fcreated, "flags.detail,flags.evaluate,flags.list"],
      ["flags.update", updDesc, "flags.detail,flags.evaluate,flags.list"],
      ["flags.delete", dropped, "flags.detail,flags.evaluate,flags.list"],
      ["flags.setEnabled", off, "flags.detail,flags.evaluate,flags.list"],
      ["flags.setRules", ordered, "flags.detail,flags.evaluate"],
      ["flags.setTenantOverride", ovSet, "flags.detail,flags.evaluate"],
      ["flags.deleteTenantOverride", ovDeleted, "flags.detail,flags.evaluate"],
    ]
    for (const [intent, response, want] of flagInvalidates) {
      vaultCheck(`${intent} declares the manifest's invalidates`, invalidates(response) === want, `${invalidates(response)} vs ${want}`)
    }

    // Clean up every flag this block made, then prove the seed count is back.
    for (const key of ["spot/flag.a", "spot/flag.str", "spot/flag.json", "spot/flag.int", "spot/flag.win", "spot/flag.trip"]) await flagCall("flags.delete", { key })
    const flagsAfter = data(await flagCall("flags.list", {}))
    vaultCheck("the flag spot checks cleaned up after themselves", flagsAfter?.total === flist?.total, `${flagsAfter?.total} vs ${flist?.total}`)
  }

  console.log(`\nFinal: ${passed + (failures.length === 0 ? 0 : 0)} handler calls verified, ${failures.length} total failures (including spot checks).`)

  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
