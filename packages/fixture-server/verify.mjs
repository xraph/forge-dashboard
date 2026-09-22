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

  console.log(`\nFinal: ${passed + (failures.length === 0 ? 0 : 0)} handler calls verified, ${failures.length} total failures (including spot checks).`)

  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
