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

import { SENTINEL_INPUT, verifySentinel } from "./sentinel-verify.mjs"
import { HERALD_INPUT, verifyHerald } from "./herald-verify.mjs"

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
  // ledger: ids from ledger-fixtures.mjs's seed. Intents run in handler order,
  // so create precedes delete and archive precedes delete.
  "ledger::plans.detail": { id: "plan_pro" },
  "ledger::plans.create": { name: "Verify plan", slug: "verify-plan", currency: "usd" },
  "ledger::plans.update": { id: "plan_pro", description: "Updated by verify.mjs" },
  "ledger::plans.archive": { id: "plan_legacy" },
  "ledger::plans.activate": { id: "plan_enterprise" },
  "ledger::plans.delete": { id: "plan_legacy" },
  "ledger::plans.syncToProvider": { id: "plan_pro" },
  "ledger::features.detail": { id: "feat_api_calls" },
  "ledger::features.create": { key: "verify_key", name: "Verify", type: "metered", default_limit: 10, period: "monthly" },
  "ledger::features.update": { id: "feat_api_calls", description: "Updated by verify.mjs" },
  "ledger::features.archive": { id: "feat_legacy_exports" },
  "ledger::features.delete": { id: "feat_legacy_exports" },
  "ledger::features.syncToProvider": { id: "feat_api_calls" },
  "ledger::coupons.detail": { id: "cpn_launch20" },
  "ledger::coupons.create": { code: "VERIFY5", name: "Verify", type: "percentage", percentage: 5, currency: "usd" },
  "ledger::coupons.update": { id: "cpn_launch20", name: "Launch offer" },
  "ledger::coupons.delete": { id: "cpn_summer50" },
  "ledger::coupons.apply": { subscription_id: "sub_globex", code: "WELCOME10" },
  "ledger::subscriptions.detail": { id: "sub_acme" },
  "ledger::subscriptions.usage": { id: "sub_acme" },
  "ledger::subscriptions.create": { tenant_id: "verify-tenant", plan_id: "plan_starter" },
  "ledger::subscriptions.changePlan": { id: "sub_globex", plan_id: "plan_pro" },
  "ledger::subscriptions.pause": { id: "sub_wayne" },
  "ledger::subscriptions.resume": { id: "sub_hooli" },
  "ledger::subscriptions.cancel": { id: "sub_wayne", immediately: true },
  "ledger::subscriptions.syncToProvider": { id: "sub_acme" },
  "ledger::invoices.detail": { id: "inv_acme_4" },
  "ledger::invoices.export": { id: "inv_acme_4", format: "csv" },
  "ledger::invoices.generate": { subscription_id: "sub_acme" },
  "ledger::invoices.finalize": { id: "inv_globex_1" },
  "ledger::invoices.markPaid": { id: "inv_initech_1", payment_ref: "verify" },
  "ledger::invoices.void": { id: "inv_acme_4", reason: "Voided by verify.mjs" },
  "ledger::invoices.syncToProvider": { id: "inv_acme_1" },
  "ledger::plans.importFromProvider": { provider_id: "prod_growth" },
  "ledger::features.importFromProvider": { provider_id: "mtr_exports" },
  "ledger::subscriptions.importFromProvider": { provider_id: "sub_1Stark" },
  "ledger::invoices.importFromProvider": { provider_id: "in_1AcmeA" },
  "ledger::usage.aggregate": { tenant_id: "acme", feature_keys: ["api_calls"], period: "monthly" },
  "ledger::entitlements.check": { tenant_id: "acme", feature_key: "api_calls" },
  "ledger::entitlements.invalidate": { tenant_id: "acme" },
  "ledger::paymentMethods.list": { tenant_id: "acme" },
  // config: the fixture lists the commands create, update, rollback, delete, so
  // update makes version 2 of the entry create made, rollback goes back to 1,
  // and delete removes it. overrides.set runs before overrides.delete, on a
  // seeded key the tenant has no override for.
  "vault::config.detail": { key: "limits.api-rate" },
  "bastion::routes.detail": { id: "manual-/users" },
  "bastion::routes.create": { path: "/verify", methods: ["GET"], priority: 1, enabled: true, protocol: "http", targets: [{ url: "http://verify:8080", weight: 1 }], rateLimit: null, auth: null },
  "bastion::routes.update": { id: "00000000-0000-4000-8000-000000000001", priority: 2 },
  "bastion::routes.setEnabled": { id: "00000000-0000-4000-8000-000000000001", enabled: false },
  "bastion::routes.delete": { id: "00000000-0000-4000-8000-000000000001" },
  "bastion::circuits.reset": { targetId: "9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36/1" },
  "vault::config.versions": { key: "limits.api-rate" },
  "vault::config.resolve": { key: "limits.api-rate", tenantId: "acme" },
  "vault::overrides.list": { tenantId: "acme" },
  "vault::config.create": { key: "verify/new.config", valueType: "int", value: 1, description: "made by verify.mjs" },
  "vault::config.update": { key: "verify/new.config", value: 2 },
  "vault::config.rollback": { key: "verify/new.config", version: 1 },
  "vault::config.delete": { key: "verify/new.config" },
  "vault::overrides.set": { key: "features.maintenance-mode", tenantId: "acme", value: true },
  "vault::overrides.delete": { key: "features.maintenance-mode", tenantId: "acme" },
  // chronicle: ids from chronicle-fixtures.mjs's seed, for the default
  // app-wide viewer. main() swaps a few of them when the server is running as a
  // tenant viewer or without an own chain. A created policy's id is derived from
  // its scope and category, so savePolicy and deletePolicy agree without
  // threading anything. checkpoints.take targets initech, whose last checkpoint
  // is already past its head, so it changes nothing the spot checks read.
  "chronicle::verify.run": { streamId: "stream_globex" },
  "chronicle::verify.event": { eventId: "audit_own_12431" },
  "chronicle::events.detail": { id: "audit_own_12431" },
  "chronicle::events.aggregate": { groupBy: ["hour"] },
  "chronicle::events.byUser": { userId: "user_1" },
  "chronicle::checkpoints.detail": { id: "ckpt_acme_1" },
  "chronicle::checkpoints.take": { streamId: "stream_initech" },
  "chronicle::erasures.detail": { id: "erasure_1" },
  "chronicle::erasures.preview": { subjectId: "subject_1" },
  "chronicle::erasures.request": { subjectId: "subject_2", reason: "fixture" },
  "chronicle::retention.policyDetail": { id: "retpol_app_all" },
  "chronicle::retention.savePolicy": { category: "fixture", duration: "48h" },
  "chronicle::retention.deletePolicy": { id: "retpol_app_fixture" },
  "chronicle::reports.detail": { id: "report_soc2" },
  "chronicle::reports.generate": { type: "soc2" },
  "chronicle::reports.generateCustom": { title: "fixture", sections: [{ title: "logins", actions: ["user.login"] }] },
  "chronicle::reports.export": { id: "report_soc2", format: "csv" },

  // keysmith: the seed key "Billing service" (keysmith-fixtures.mjs). keys.list takes no input.
  "keysmith::keys.detail": { id: "akey_01j9k4m2e7t8x3q5r6v0w1y2za" },
  // Commands run in intent order against the seed: create, rotate and end the grace of the
  // billing key, revoke the reporting key, suspend then reactivate the globex-linked key,
  // assign then remove a scope on the billing key. policies.list and scopes.list take no input.
  "keysmith::keys.create": { name: "Verify key", environment: "test", prefix: "vk", scopes: ["reports:read"] },
  "keysmith::keys.rotate": { id: "akey_01j9k4m2e7t8x3q5r6v0w1y2za", reason: "manual" },
  "keysmith::keys.endGrace": { id: "akey_01j9k4m2e7t8x3q5r6v0w1y2za" },
  "keysmith::keys.revoke": { id: "akey_01j9k4m2e8f9d4n6s7w1x2z3ab", reason: "verify script" },
  "keysmith::keys.suspend": { id: "akey_01j9k4m2edm4j9t1y2b6c7e8fg" },
  "keysmith::keys.reactivate": { id: "akey_01j9k4m2edm4j9t1y2b6c7e8fg" },
  "keysmith::keys.scopes.assign": { id: "akey_01j9k4m2e7t8x3q5r6v0w1y2za", scopes: ["catalog:read"] },
  "keysmith::keys.scopes.remove": { id: "akey_01j9k4m2e7t8x3q5r6v0w1y2za", scopes: ["catalog:read"] },
  // The Standard policy, a new policy and scope, the Retired policy (only a revoked key uses it)
  // and legacy:read (no key holds it, no policy allows it), so both deletes succeed.
  "keysmith::policies.detail": { id: "kpol_01j9k4m1zza0b1c2d3e4f5g6h7" },
  "keysmith::policies.create": { name: "Verify policy" },
  "keysmith::policies.update": { id: "kpol_01j9k4m1zza0b1c2d3e4f5g6h7", description: "Edited by verify.mjs" },
  "keysmith::policies.delete": { id: "kpol_01j9k4m1zwd3e4f5g6h7j8k9m0" },
  "keysmith::scopes.create": { name: "verify:read" },
  "keysmith::scopes.delete": { id: "kscp_01j9k4m1yah8j9k0m1n2p3q4r5" },
  // The billing key's rotations and usage; usage.series needs a period and both times.
  // overview and settings take no input.
  "keysmith::rotations.list": { keyId: "akey_01j9k4m2e7t8x3q5r6v0w1y2za" },
  "keysmith::usage.series": { period: "daily", after: new Date(Date.now() - 7 * 86_400_000).toISOString(), before: new Date().toISOString() },
  "keysmith::usage.records": { keyId: "akey_01j9k4m2e7t8x3q5r6v0w1y2za", limit: 25 },

  "streaming-contract::rooms.detail": { id: "room_1" },
  "streaming-contract::rooms.create": { name: "Verify room", description: "d", owner: "usr_1", private: false },
  "streaming-contract::rooms.delete": { id: "room_2" },
  "streaming-contract::rooms.members": { id: "room_1" },
  "streaming-contract::rooms.moderation": { id: "room_1" },
  "streaming-contract::rooms.send-message": { roomID: "room_1", userID: "usr_1", content: "hello from verify.mjs" },
  "streaming-contract::connections.kick": { connID: "conn_2", reason: "verify script" },
  "streaming-contract::presence.set": { userID: "usr_1", status: "away" },

  // trove: the seed in trove-fixtures.mjs. Store "primary" is the default; "archive" is s3 and can presign.
  "trove::objects.list": { bucket: "reports" },
  "trove::objects.head": { bucket: "reports", key: "readme.txt" },
  "trove::objects.contentUrl": { bucket: "reports", key: "readme.txt" },
  "trove::middleware.list": { bucket: "reports", key: "readme.txt" },
  "trove::buckets.create": { name: "verify-trove-bucket" },
  "trove::buckets.delete": { name: "empty" },
  "trove::objects.delete": { bucket: "reports", key: "2026/08/summary.json" },
  "trove::objects.copy": { srcBucket: "reports", srcKey: "readme.txt", dstBucket: "assets", dstKey: "readme-copy.txt" },
  "trove::objects.beginUpload": { bucket: "reports", key: "verify/trove-upload.txt", size: 5, contentType: "text/plain" },
  "trove::objects.completeUpload": { bucket: "reports", key: "readme.txt" },
  "trove::objects.presign": { store: "archive", bucket: "backups", key: "db/2026-09-30.dump" },
  "trove::cas.pin": { hash: `sha256:${"a1".repeat(32)}` },
  "trove::cas.unpin": { hash: `sha256:${"b2".repeat(32)}` },
  ...SENTINEL_INPUT,
  ...HERALD_INPUT,
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

/**
 * Chronicle's env switches change which ids exist and which intents can
 * succeed. Read the mode back from the server instead of from this process's
 * env, so `verify.mjs` needs no flags to match how the server was started.
 */
async function detectChronicleMode(csrf) {
  const call = (intent) => dispatch("chronicle", intent, "query", {}, csrf)
  const settings = await call("settings.detail")
  if (settings.body?.ok !== true) return undefined
  const mine = (await call("streams.mine")).body?.data?.stream
  return {
    checkpoints: settings.body.data.checkpointingConfigured === true,
    erasure: settings.body.data.enableCryptoErasure === true,
    tenant: mine?.tenantId === "acme",
    // An app-wide viewer's own chain is the untenanted one.
    ownChain: mine !== undefined && !mine.tenantId,
  }
}

function applyChronicleMode(mode) {
  if (!mode) return
  if (mode.tenant) {
    INPUT["chronicle::verify.run"] = { streamId: "stream_acme" }
    INPUT["chronicle::checkpoints.take"] = { streamId: "stream_acme" }
    INPUT["chronicle::erasures.detail"] = { id: "erasure_2" }
    INPUT["chronicle::retention.deletePolicy"] = { id: "retpol_acme_fixture" }
  }
  if (!mode.ownChain) {
    INPUT["chronicle::verify.event"] = { eventId: "audit_acme_61004" }
    INPUT["chronicle::events.detail"] = { id: "audit_acme_61004" }
  }
  if (!mode.checkpoints) {
    EXPECT_FAILURE.add("chronicle::checkpoints.take")
    EXPECT_FAILURE.add("chronicle::checkpoints.detail")
  }
  if (!mode.erasure) EXPECT_FAILURE.add("chronicle::erasures.request")
}

async function main() {
  const capsRes = await fetch(`${base}/capabilities`)
  if (!capsRes.ok) {
    console.error(`capabilities fetch failed: ${capsRes.status}`)
    process.exit(1)
  }
  const caps = await capsRes.json()
  const csrf = await getCSRF()
  const chronicleMode = await detectChronicleMode(csrf)
  applyChronicleMode(chronicleMode)

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
    // Every vault command also invalidates audit.list and overview.stats: the
    // manifest appends the same two to all nineteen.
    const withAudit = (want) => [...want.split(","), "audit.list", "overview.stats"].sort().join(",")
    for (const [intent, response, want] of expectedInvalidates) {
      vaultCheck(`${intent} declares the manifest's invalidates`, invalidates(response) === withAudit(want), `${invalidates(response)} vs ${withAudit(want)}`)
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
      vaultCheck(`${intent} declares the manifest's invalidates`, invalidates(response) === withAudit(want), `${invalidates(response)} vs ${withAudit(want)}`)
    }

    // Clean up every flag this block made, then prove the seed count is back.
    for (const key of ["spot/flag.a", "spot/flag.str", "spot/flag.json", "spot/flag.int", "spot/flag.win", "spot/flag.trip"]) await flagCall("flags.delete", { key })
    const flagsAfter = data(await flagCall("flags.list", {}))
    vaultCheck("the flag spot checks cleaned up after themselves", flagsAfter?.total === flist?.total, `${flagsAfter?.total} vs ${flist?.total}`)

    // -- config and overrides: the rules configmgr, config/validate.go and the handlers enforce --
    // Its own block: the names above are the secret and flag checks' own.
    {
    const cfgCall = (intent, input) => vaultCall(intent, /\.(list|detail|versions|resolve)$/.test(intent) ? "query" : "command", input)
    const cfgActions = async (key) => (data(await cfgCall("config.detail", { key }))?.recentAudit ?? []).map((e) => e.action)
    const CONFIG_TYPE_LIST = "must be one of string, int, float, bool, json, duration"

    // Seed: 30 entries, a second page, all six types, a yaml one, a wrong-typed one.
    const cpage1 = await cfgCall("config.list", {})
    const cpage2 = await cfgCall("config.list", { offset: 25 })
    const clist = data(cpage1)
    vaultCheck(
      "config.list pages (25 then the rest, exact total)",
      clist?.entries?.length === 25 && data(cpage2)?.entries?.length === clist.total - 25 && clist.total === 30,
      `got ${clist?.entries?.length} then ${data(cpage2)?.entries?.length} of ${clist?.total}`,
    )
    const call = data(await cfgCall("config.list", { limit: 500 }))?.entries ?? []
    vaultCheck(
      "the config seed covers all six types and is in key order",
      ["string", "int", "float", "bool", "json", "duration"].every((t) => call.some((e) => e.valueType === t)) && same(call.map((e) => e.key), call.map((e) => e.key).sort()),
      JSON.stringify([...new Set(call.map((e) => e.valueType))]),
    )
    vaultCheck(
      "a config row carries every projected field, and metadata is always an object",
      call.every((e) => ["id", "key", "value", "valueType", "knownType", "valueMatchesType", "version", "description", "metadata", "createdAt", "updatedAt"].every((k) => k in e) && e.metadata !== null && typeof e.metadata === "object"),
      "a field is missing or metadata is not an object",
    )
    const yamlEntry = call.find((e) => e.valueType === "yaml")
    vaultCheck("the seed has a yaml entry: knownType false and valueMatchesType false", yamlEntry?.knownType === false && yamlEntry.valueMatchesType === false, JSON.stringify(yamlEntry))
    const wrongTyped = call.filter((e) => e.knownType && !e.valueMatchesType)
    vaultCheck(
      "the seed has one known-type entry whose stored value is the wrong type",
      wrongTyped.length === 1 && wrongTyped[0].key === "limits.page-size" && wrongTyped[0].valueType === "int" && wrongTyped[0].value === "50",
      JSON.stringify(wrongTyped),
    )
    vaultCheck("every other seeded value matches its type", call.filter((e) => e.key !== "limits.page-size" && e.valueType !== "yaml").every((e) => e.valueMatchesType === true), "a seed value does not match its type")
    vaultCheck("several seeded entries have three or more versions", call.filter((e) => e.version >= 3).length >= 8, `${call.filter((e) => e.version >= 3).length}`)
    const prefixed = data(await cfgCall("config.list", { keyPrefix: "billing/", limit: 1 }))
    vaultCheck("config.list filters by key prefix, and total counts the filter not the page", prefixed?.entries?.length === 1 && prefixed.entries[0].key.startsWith("billing/") && prefixed.total === 3, JSON.stringify(prefixed))
    const bigLimit = await cfgCall("config.list", { limit: 100000 })
    vaultCheck("config.list caps an over-large limit rather than refusing it", bigLimit.body?.ok === true && data(bigLimit).entries.length === 30, failure(bigLimit))

    // Versions: newest first, current marked, each judged against the entry's current type.
    const plans = data(await cfgCall("config.versions", { key: "billing/plans" }))?.versions ?? []
    vaultCheck("config.versions is newest first with exactly one current", same(plans.map((v) => v.version), [4, 3, 2, 1]) && same(plans.map((v) => v.current), [true, false, false, false]), JSON.stringify(plans.map((v) => [v.version, v.current])))
    vaultCheck("a json entry's versions change in nested places", plans.length === 4 && plans[0].value.team.trialDays === 14 && plans[1].value.team.trialDays === undefined && plans[1].value.pro.limits.seats === 10 && plans[2].value.pro.limits.seats === 5 && plans[3].value.pro.priceCents === 2900, JSON.stringify(plans.map((v) => v.value.pro)))
    const ttl = data(await cfgCall("config.versions", { key: "cache.ttl" }))?.versions ?? []
    vaultCheck("versions written under an earlier type are flagged valueMatchesType false", same(ttl.map((v) => v.valueMatchesType), [true, false, false]) && ttl[1].value === 600, JSON.stringify(ttl))
    const noVersions = await cfgCall("config.versions", { key: "spot/none.config" })
    vaultCheck("config.versions on a missing key is 404 NOT_FOUND", refused(noVersions, 404, "NOT_FOUND", "config entry not found"), failure(noVersions))
    const noDetail = await cfgCall("config.detail", { key: "spot/none.config" })
    vaultCheck("config.detail on a missing key is 404 NOT_FOUND", refused(noDetail, 404, "NOT_FOUND", "config entry not found"), failure(noDetail))
    const noKey = await cfgCall("config.detail", { key: "  " })
    vaultCheck("config.detail refuses a blank key", badRequest(noKey, "key is required"), failure(noKey))

    // Detail: overrides in tenant order, audit from both resources and never a flag's.
    const rate = data(await cfgCall("config.detail", { key: "limits.api-rate" }))
    vaultCheck(
      "config.detail answers the entry, its overrides in tenant order and never null lists",
      rate?.entry?.key === "limits.api-rate" && same((rate.overrides ?? []).map((o) => o.tenantId), ["acme", "globex"]) && (rate.overrides ?? []).every((o) => o.keyExists === true && o.valueMatchesType === true) && Array.isArray(rate.recentAudit),
      JSON.stringify(rate?.overrides),
    )
    const rateActions = (rate?.recentAudit ?? []).map((e) => e.action)
    vaultCheck(
      "config.detail's recentAudit holds config and override rows, newest first, and no flag row",
      rateActions.includes("override.set") && rateActions.includes("config.set") && rateActions.every((a) => a.startsWith("config.") || a.startsWith("override.")) && (rate.recentAudit ?? []).every((e, i, all) => i === 0 || Date.parse(all[i - 1].createdAt) >= Date.parse(e.createdAt)),
      JSON.stringify(rateActions),
    )
    const flagSharing = (data(await flagCall("flags.detail", { key: "limits.api-rate" }))?.recentAudit ?? []).map((e) => e.action)
    vaultCheck("flags.detail's recentAudit leaves out config rows for the same key", flagSharing.length > 0 && flagSharing.every((a) => a.startsWith("flag.")), JSON.stringify(flagSharing))
    const secretSharing = (data(await vaultCall("secrets.detail", "query", { key: "api/stripe.key" }))?.recentAudit ?? []).map((e) => e.action)
    vaultCheck("secrets.detail's recentAudit leaves out config rows", secretSharing.every((a) => a.startsWith("secret.")), JSON.stringify(secretSharing))

    // Resolve: which source answered, and what each held.
    const rAcme = data(await cfgCall("config.resolve", { key: "limits.api-rate", tenantId: "acme" }))
    vaultCheck(
      "config.resolve for a tenant with an override answers from the override and still says the app value",
      rAcme?.source === "override" && rAcme.value === 5000 && rAcme.overrideValue === 5000 && rAcme.appValue === 1000 && rAcme.tenantId === "acme" && rAcme.valueMatchesType === true,
      JSON.stringify(rAcme),
    )
    const rNone = data(await cfgCall("config.resolve", { key: "limits.api-rate", tenantId: "initech" }))
    vaultCheck(
      "config.resolve for a tenant with none answers appDefault, with no overrideValue key",
      rNone?.source === "appDefault" && rNone.value === 1000 && rNone.appValue === 1000 && !("overrideValue" in rNone) && rNone.tenantId === "initech",
      JSON.stringify(rNone),
    )
    const rNoTenant = data(await cfgCall("config.resolve", { key: "limits.api-rate" }))
    vaultCheck("config.resolve with no tenant answers appDefault and omits tenantId", rNoTenant?.source === "appDefault" && !("tenantId" in rNoTenant) && !("overrideValue" in rNoTenant), JSON.stringify(rNoTenant))
    const rTrim = data(await cfgCall("config.resolve", { key: "limits.api-rate", tenantId: "  globex " }))
    vaultCheck("config.resolve trims the tenant it echoes", rTrim?.source === "override" && rTrim.tenantId === "globex" && rTrim.overrideValue === 250, JSON.stringify(rTrim))
    const rEmpty = data(await cfgCall("config.resolve", { key: "ui.theme-default", tenantId: "globex" }))
    vaultCheck(
      "an override of \"\" is still the override: source override, overrideValue \"\"",
      rEmpty?.source === "override" && rEmpty.value === "" && "overrideValue" in rEmpty && rEmpty.overrideValue === "" && rEmpty.appValue === "system",
      JSON.stringify(rEmpty),
    )
    const rNull = data(await cfgCall("config.resolve", { key: "features.rollout", tenantId: "acme" }))
    vaultCheck("an override of JSON null keeps its overrideValue key", rNull?.source === "override" && "overrideValue" in rNull && rNull.overrideValue === null && rNull.value === null, JSON.stringify(rNull))
    const rWrong = data(await cfgCall("config.resolve", { key: "limits.page-size", tenantId: "globex" }))
    vaultCheck("valueMatchesType judges the value that answered", rWrong?.source === "override" && rWrong.valueMatchesType === false && data(await cfgCall("config.resolve", { key: "limits.page-size", tenantId: "acme" }))?.valueMatchesType === true, JSON.stringify(rWrong))
    const rOrphan = await cfgCall("config.resolve", { key: "legacy.retired-flag", tenantId: "acme" })
    vaultCheck("config.resolve on a key with no entry is NOT_FOUND even when an orphaned override exists", refused(rOrphan, 404, "NOT_FOUND", "config entry not found"), failure(rOrphan))

    // overrides.list.
    const oNeither = await cfgCall("overrides.list", {})
    vaultCheck("overrides.list refuses neither a tenant nor a key", badRequest(oNeither, "give a tenantId or a key"), failure(oNeither))
    const oAcme = data(await cfgCall("overrides.list", { tenantId: "acme" }))
    vaultCheck(
      "overrides.list by tenant is in key order and counts every match",
      oAcme?.total === 9 && oAcme.overrides.length === 9 &&same(oAcme.overrides.map((o) => o.key), oAcme.overrides.map((o) => o.key).sort()) && oAcme.overrides.every((o) => o.tenantId === "acme"),
      JSON.stringify(oAcme?.overrides?.map((o) => o.key)),
    )
    const oPaged = data(await cfgCall("overrides.list", { tenantId: "acme", limit: 3, offset: 3 }))
    vaultCheck("overrides.list pages: total is the match count, the page a slice of it", oPaged?.total === 9 &&same(oPaged.overrides.map((o) => o.key), oAcme.overrides.slice(3, 6).map((o) => o.key)), JSON.stringify(oPaged))
    const oKey = data(await cfgCall("overrides.list", { key: "ui.theme-default" }))
    vaultCheck("overrides.list by key is in tenant order and keeps the empty string", same(oKey?.overrides?.map((o) => [o.tenantId, o.value]), [["acme", "dark"], ["globex", ""]]), JSON.stringify(oKey))
    const oBoth = data(await cfgCall("overrides.list", { key: "ui.theme-default", tenantId: "globex" }))
    const oBothNone = data(await cfgCall("overrides.list", { key: "ui.theme-default", tenantId: "initech" }))
    vaultCheck("overrides.list with a key and a tenant is that one override, or nothing", oBoth?.total === 1 && oBoth.overrides[0].value === "" && oBothNone?.total === 0 && same(oBothNone.overrides, []), JSON.stringify([oBoth, oBothNone]))
    const oOrphan = data(await cfgCall("overrides.list", { key: "legacy.retired-flag" }))
    vaultCheck(
      "an orphaned override is listed with keyExists false and valueMatchesType false",
      oOrphan?.total === 2 && oOrphan.overrides.every((o) => o.keyExists === false && o.valueMatchesType === false),
      JSON.stringify(oOrphan),
    )
    const oGlobex = data(await cfgCall("overrides.list", { tenantId: "globex" }))
    vaultCheck("the wrong-typed override is flagged and the orphan is listed under its tenant", oGlobex?.overrides?.some((o) => o.key === "limits.page-size" && o.valueMatchesType === false && o.keyExists === true) && oGlobex.overrides.some((o) => o.key === "legacy.retired-flag" && o.keyExists === false), JSON.stringify(oGlobex?.overrides?.map((o) => [o.key, o.keyExists, o.valueMatchesType])))
    const oNone = data(await cfgCall("overrides.list", { tenantId: "nobody" }))
    vaultCheck("overrides.list for a tenant with none is an empty list, not an error", oNone?.total === 0 && same(oNone.overrides, []), JSON.stringify(oNone))

    // config.create: every refusal, in the Go order, with the Go words.
    const mk = (input) => cfgCall("config.create", input)
    const cNoType = await mk({ key: "spot/config.a", value: "x" })
    vaultCheck("config.create refuses an absent valueType", badRequest(cNoType, "valueType is required"), failure(cNoType))
    const cUnknownType = await mk({ key: "spot/config.a", valueType: "yaml", value: "x" })
    vaultCheck("config.create refuses a type the vault does not validate", badRequest(cUnknownType, `config: valueType: ${CONFIG_TYPE_LIST}`), failure(cUnknownType))
    const cNoKey = await mk({ key: " ", valueType: "string", value: "x" })
    vaultCheck("config.create refuses a blank key", badRequest(cNoKey, "key is required"), failure(cNoKey))
    const cLongKey = await mk({ key: "k".repeat(257), valueType: "string", value: "x" })
    vaultCheck("config.create refuses a key over 256 bytes", badRequest(cLongKey, "config: key: must be at most 256 bytes"), failure(cLongKey))
    const cRefusals = [
      ["a string", { valueType: "string", value: 5 }, "config: value: must be a string, got a number"],
      ["a string given null", { valueType: "string", value: null }, "config: value: must be a string, got null"],
      ["a string given nothing", { valueType: "string" }, "config: value: must be a string, got null"],
      ["an int given a string", { valueType: "int", value: "5" }, "config: value: must be a whole number, got a string"],
      ["an int given a fraction", { valueType: "int", value: 2.5 }, "config: value: must be a whole number, got 2.5"],
      ["an int over 2^53", { valueType: "int", value: 2 ** 60 }, "config: value: must not exceed 2^53 in magnitude, got 1.152921504606847e+18"],
      ["a float given a string", { valueType: "float", value: "0.5" }, "config: value: must be a number, got a string"],
      ["a bool given a string", { valueType: "bool", value: "true" }, "config: value: must be a boolean, got a string"],
      ["a duration given a number", { valueType: "duration", value: 30 }, 'config: value: must be a duration string such as "30s", got a number'],
      ["a duration given text", { valueType: "duration", value: "abc" }, 'config: value: must be a duration such as "30s" or "1h30m": time: invalid duration "abc"'],
      ["a duration with no unit", { valueType: "duration", value: "5" }, 'config: value: must be a duration such as "30s" or "1h30m": time: missing unit in duration "5"'],
      ["a duration with an unknown unit", { valueType: "duration", value: "5x" }, 'config: value: must be a duration such as "30s" or "1h30m": time: unknown unit "x" in duration "5x"'],
      ["a duration given \"\"", { valueType: "duration", value: "" }, 'config: value: must be a duration such as "30s" or "1h30m": time: invalid duration ""'],
    ]
    for (const [name, input, message] of cRefusals) {
      const r = await mk({ key: "spot/config.a", ...input })
      vaultCheck(`config.create refuses ${name}`, badRequest(r, message), failure(r))
    }
    vaultCheck("no refused create left an entry behind", (await cfgCall("config.detail", { key: "spot/config.a" })).status === 404, "the entry exists")
    const cDurations = await Promise.all(["30s", "1h30m", "-1.5h", "0", "2h45m30s500ms"].map((v, i) => mk({ key: `spot/config.dur${i}`, valueType: "duration", value: v })))
    vaultCheck("config.create accepts every duration Go's ParseDuration does", cDurations.every((r) => r.body?.ok === true), JSON.stringify(cDurations.map((r) => r.body?.error?.message)))
    const cJsonNull = await mk({ key: "spot/config.json", valueType: "json" })
    vaultCheck("config.create takes null (and no value at all) for a json entry", cJsonNull.body?.ok === true && cJsonNull.body.data.entry.value === null && cJsonNull.body.data.entry.valueMatchesType === true && cJsonNull.body.data.entry.version === 1, JSON.stringify(cJsonNull.body))
    const cMade = await mk({ key: "spot/config.a", valueType: "int", value: 7, description: "  as typed  " })
    const cEntry = cMade.body?.data?.entry
    vaultCheck(
      "config.create answers the new entry: version 1, empty metadata, the description as given",
      cEntry?.key === "spot/config.a" && cEntry.value === 7 && cEntry.version === 1 && cEntry.knownType === true && cEntry.valueMatchesType === true && same(cEntry.metadata, {}) && cEntry.description === "  as typed  " && cEntry.createdAt === cEntry.updatedAt,
      JSON.stringify(cMade.body),
    )
    vaultCheck("config.create records config.set", same(await cfgActions("spot/config.a"), ["config.set"]), JSON.stringify(await cfgActions("spot/config.a")))
    const cAgain = await mk({ key: "spot/config.a", valueType: "string", value: "clobber" })
    vaultCheck("config.create on an existing key is 409 CONFLICT and leaves the entry as it was", refused(cAgain, 409, "CONFLICT", "a config entry with this key already exists") && data(await cfgCall("config.detail", { key: "spot/config.a" }))?.entry?.value === 7, failure(cAgain))
    vaultCheck("config.create grows the list total", data(await cfgCall("config.list", {}))?.total === 30 + 1 + 5 + 1, `${data(await cfgCall("config.list", {}))?.total}`)

    // config.update: only what is named changes.
    const up = (input) => cfgCall("config.update", { key: "spot/config.a", ...input })
    const uNone = await cfgCall("config.update", { key: "spot/none.config", description: "x" })
    vaultCheck("config.update on a missing key is 404 NOT_FOUND", refused(uNone, 404, "NOT_FOUND", "config entry not found"), failure(uNone))
    const uBad = await up({ value: "8" })
    vaultCheck("config.update refuses a value of the wrong type", badRequest(uBad, "config: value: must be a whole number, got a string"), failure(uBad))
    const uNull = await up({ value: null })
    vaultCheck("config.update refuses null for an int entry", badRequest(uNull, "config: value: must be a whole number, got null"), failure(uNull))
    const uDesc = await up({ description: "changed" })
    vaultCheck("updating the description alone keeps the value and adds a version", uDesc.body?.data?.entry?.value === 7 && uDesc.body.data.entry.description === "changed" && uDesc.body.data.entry.version === 2, JSON.stringify(uDesc.body))
    const uVal = await up({ value: 8 })
    vaultCheck("updating the value alone keeps the description", uVal.body?.data?.entry?.value === 8 && uVal.body.data.entry.description === "changed" && uVal.body.data.entry.version === 3, JSON.stringify(uVal.body))
    const uSame = await up({ value: 8, description: "changed" })
    vaultCheck(
      "asking for what the entry already holds is not an error, and adds no version and no audit row",
      uSame.body?.ok === true && uSame.body.data.entry.version === 3 && uSame.body.data.entry.updatedAt === uVal.body.data.entry.updatedAt && same(await cfgActions("spot/config.a"), ["config.set", "config.set", "config.set"]),
      JSON.stringify([uSame.body, await cfgActions("spot/config.a")]),
    )
    const uSameType = await up({ valueType: "int", value: 8 })
    vaultCheck("naming the type it already has is a no-op too", uSameType.body?.ok === true && uSameType.body.data.entry.version === 3, JSON.stringify(uSameType.body))
    const uEmptyDesc = await up({ description: "" })
    vaultCheck("an empty description clears it and is a change", uEmptyDesc.body?.data?.entry?.description === "" && uEmptyDesc.body.data.entry.version === 4, JSON.stringify(uEmptyDesc.body))
    const uTypeNoValue = await up({ valueType: "string" })
    vaultCheck("changing the type needs a value", badRequest(uTypeNoValue, "config: valueType: changing the type needs a value of that type"), failure(uTypeNoValue))
    const uTypeUnknown = await up({ valueType: "yaml", value: "x" })
    vaultCheck("changing to a type the vault does not validate is refused", badRequest(uTypeUnknown, `config: valueType: ${CONFIG_TYPE_LIST}`), failure(uTypeUnknown))
    const uTypeBadValue = await up({ valueType: "bool", value: 8 })
    vaultCheck("changing the type validates the value against the new type", badRequest(uTypeBadValue, "config: value: must be a boolean, got a number"), failure(uTypeBadValue))
    const uTypeOk = await up({ valueType: "string", value: "eight" })
    vaultCheck("changing the type with a value of that type works", uTypeOk.body?.data?.entry?.valueType === "string" && uTypeOk.body.data.entry.value === "eight" && uTypeOk.body.data.entry.valueMatchesType === true && uTypeOk.body.data.entry.version === 5, JSON.stringify(uTypeOk.body))
    const uJsonNull = await cfgCall("config.update", { key: "spot/config.json", value: null })
    vaultCheck("config.update of a json entry to null is a no-op when it is null already", uJsonNull.body?.ok === true && uJsonNull.body.data.entry.version === 1, JSON.stringify(uJsonNull.body))
    const uJsonObj = await cfgCall("config.update", { key: "spot/config.json", value: { a: { b: [1, 2] } } })
    const uJsonBack = await cfgCall("config.update", { key: "spot/config.json", value: null })
    vaultCheck("a json entry takes an object, then null", same(uJsonObj.body?.data?.entry?.value, { a: { b: [1, 2] } }) && uJsonBack.body?.data?.entry?.value === null && uJsonBack.body.data.entry.version === 3, JSON.stringify([uJsonObj.body, uJsonBack.body]))
    const uJsonReordered = await cfgCall("config.update", { key: "spot/config.json", value: { y: 1, x: 2 } })
    const uJsonSameOrder = await cfgCall("config.update", { key: "spot/config.json", value: { x: 2, y: 1 } })
    vaultCheck("key order does not make a json value different", uJsonReordered.body?.data?.entry?.version === 4 && uJsonSameOrder.body?.data?.entry?.version === 4, JSON.stringify([uJsonReordered.body, uJsonSameOrder.body]))
    const uYaml = await cfgCall("config.update", { key: "legacy.deploy-manifest", value: "replicas: 4\n" })
    vaultCheck("a yaml entry's value is read-only", badRequest(uYaml, "config: valueType: this entry's type yaml is not one the vault supports"), failure(uYaml))
    const uYamlDesc = await cfgCall("config.update", { key: "legacy.deploy-manifest", description: "Kept as it was, and described." })
    vaultCheck("a yaml entry's description can still change", uYamlDesc.body?.data?.entry?.description === "Kept as it was, and described." && uYamlDesc.body.data.entry.valueType === "yaml", JSON.stringify(uYamlDesc.body))
    const uMeta = await cfgCall("config.update", { key: "app.base-url", value: "https://console2.example.com" })
    vaultCheck(
      "updating the value keeps the description and metadata",
      uMeta.body?.data?.entry?.description === "Public URL, used in emailed links." && same(uMeta.body.data.entry.metadata, { owner: "platform" }) && uMeta.body.data.entry.version === 4,
      JSON.stringify(uMeta.body),
    )

    // config.rollback: the value goes back, the rest stays.
    const rb = (key, version) => cfgCall("config.rollback", { key, version })
    const rbBefore = data(await cfgCall("config.detail", { key: "limits.api-rate" }))?.entry
    const rbMissing = await rb("limits.api-rate", 99)
    vaultCheck("config.rollback to a version that does not exist is 404 NOT_FOUND", refused(rbMissing, 404, "NOT_FOUND", "config version not found"), failure(rbMissing))
    const rbNone = await rb("spot/none.config", 1)
    vaultCheck("config.rollback on a missing key is 404 NOT_FOUND", refused(rbNone, 404, "NOT_FOUND", "config entry not found"), failure(rbNone))
    const rbSame = await rb("limits.api-rate", 4)
    vaultCheck("rolling back to the value it already holds writes nothing", rbSame.body?.ok === true && rbSame.body.data.entry.version === 4 && rbSame.body.data.entry.updatedAt === rbBefore?.updatedAt, JSON.stringify(rbSame.body))
    const rbOk = await rb("limits.api-rate", 1)
    const rbEntry = rbOk.body?.data?.entry
    vaultCheck(
      "config.rollback keeps type, description and metadata and takes the old value as a new version",
      rbEntry?.value === 100 && rbEntry.version === 5 && rbEntry.valueType === rbBefore?.valueType && rbEntry.description === rbBefore?.description && same(rbEntry.metadata, rbBefore?.metadata) && rbEntry.createdAt === rbBefore?.createdAt,
      JSON.stringify([rbEntry, rbBefore]),
    )
    vaultCheck("config.rollback records config.rolled_back", (await cfgActions("limits.api-rate"))[0] === "config.rolled_back", JSON.stringify(await cfgActions("limits.api-rate")))
    const rbHistory = data(await cfgCall("config.versions", { key: "limits.api-rate" }))?.versions ?? []
    vaultCheck("a rollback is a new version, not a rewrite of history", same(rbHistory.map((v) => [v.version, v.value, v.current]), [[5, 100, true], [4, 1000, false], [3, 500, false], [2, 250, false], [1, 100, false]]), JSON.stringify(rbHistory))
    const rbType = await rb("cache.ttl", 1)
    vaultCheck("config.rollback refuses a version that does not fit the current type", badRequest(rbType, "config: version: version 1 holds a number, not a duration"), failure(rbType))
    const rbYaml = await rb("legacy.deploy-manifest", 1)
    vaultCheck("config.rollback on a yaml entry is refused", badRequest(rbYaml, "config: valueType: this entry's type yaml is not one the vault supports"), failure(rbYaml))
    const rbWrongVersion = await rb("limits.page-size", 2)
    vaultCheck("config.rollback to a wrong-typed version is refused", badRequest(rbWrongVersion, "config: version: version 2 holds a string, not a int"), failure(rbWrongVersion))
    const rbRepair = await rb("limits.page-size", 1)
    vaultCheck("rolling a wrong-typed entry back to a valid version repairs it", rbRepair.body?.data?.entry?.value === 10 && rbRepair.body.data.entry.valueMatchesType === true && rbRepair.body.data.entry.version === 3, JSON.stringify(rbRepair.body))
    const rbSpot = await rb("spot/config.a", 1)
    vaultCheck("rolling back after a type change is refused, whatever the old value", badRequest(rbSpot, "config: version: version 1 holds a number, not a string"), failure(rbSpot))

    // overrides.set and overrides.delete: "set to empty" and "revert" are different acts.
    const os = (input) => cfgCall("overrides.set", input)
    const osNoEntry = await os({ key: "spot/none.config", tenantId: "acme", value: 1 })
    vaultCheck("overrides.set on a missing key is 404 NOT_FOUND", refused(osNoEntry, 404, "NOT_FOUND", "config entry not found"), failure(osNoEntry))
    const osNoValue = await os({ key: "spot/config.dur0", tenantId: "acme" })
    vaultCheck("overrides.set refuses an absent value", badRequest(osNoValue, "value is required"), failure(osNoValue))
    const osBlank = await os({ key: "spot/config.dur0", tenantId: "  ", value: "5s" })
    vaultCheck("overrides.set refuses a blank tenant", badRequest(osBlank, "config: tenantId: is required"), failure(osBlank))
    const osBadType = await os({ key: "spot/config.dur0", tenantId: "acme", value: "abc" })
    vaultCheck("overrides.set refuses a value that is not one of the entry's type", badRequest(osBadType, 'config: value: must be a duration such as "30s" or "1h30m": time: invalid duration "abc"'), failure(osBadType))
    const osNull = await os({ key: "spot/config.a", tenantId: "acme", value: null })
    vaultCheck("overrides.set refuses null for a non-json entry", badRequest(osNull, "config: value: must be a string, got null"), failure(osNull))
    const osYaml = await os({ key: "legacy.deploy-manifest", tenantId: "initech", value: "replicas: 9\n" })
    vaultCheck("overrides.set on a yaml entry is refused", badRequest(osYaml, "config: valueType: this entry's type yaml is not one the vault supports"), failure(osYaml))
    const osSet = await os({ key: "spot/config.a", tenantId: " acme ", value: "override" })
    vaultCheck(
      "overrides.set trims the tenant and answers the override",
      osSet.body?.data?.override?.tenantId === "acme" && osSet.body.data.override.value === "override" && osSet.body.data.override.valueMatchesType === true && osSet.body.data.override.keyExists === true && osSet.body.data.override.key === "spot/config.a" && typeof osSet.body.data.override.updatedAt === "string",
      JSON.stringify(osSet.body),
    )
    const osEmpty = await os({ key: "spot/config.a", tenantId: "globex", value: "" })
    vaultCheck("overrides.set takes \"\" on a string entry as a value", osEmpty.body?.data?.override?.value === "" && osEmpty.body.data.override.valueMatchesType === true, JSON.stringify(osEmpty.body))
    const rEmptyOverride = data(await cfgCall("config.resolve", { key: "spot/config.a", tenantId: "globex" }))
    vaultCheck("resolve then says the override answered, with \"\"", rEmptyOverride?.source === "override" && rEmptyOverride.value === "" && rEmptyOverride.appValue === "eight", JSON.stringify(rEmptyOverride))
    const osJsonNull = await os({ key: "spot/config.json", tenantId: "acme", value: null })
    vaultCheck("overrides.set takes null on a json entry", osJsonNull.body?.data?.override?.value === null, JSON.stringify(osJsonNull.body))
    const osReplace = await os({ key: "spot/config.a", tenantId: "acme", value: "replaced" })
    const osList = data(await cfgCall("overrides.list", { key: "spot/config.a" }))
    vaultCheck("overrides.set for a tenant that has one replaces it", osReplace.body?.ok === true && osList?.total === 2 && osList.overrides[0].value === "replaced", JSON.stringify(osList))
    vaultCheck("overrides.set records override.set", (await cfgActions("spot/config.a"))[0] === "override.set", JSON.stringify(await cfgActions("spot/config.a")))

    const od = (input) => cfgCall("overrides.delete", input)
    const odNoEntry = await od({ key: "spot/none.config", tenantId: "acme" })
    vaultCheck("overrides.delete on a missing key with no override is 404 NOT_FOUND about the override, not the entry", refused(odNoEntry, 404, "NOT_FOUND", "tenant override not found"), failure(odNoEntry))
    const odBlank = await od({ key: "spot/config.a", tenantId: "" })
    vaultCheck("overrides.delete refuses a blank tenant", badRequest(odBlank, "config: tenantId: is required"), failure(odBlank))
    const odOrphan = await od({ key: "legacy.retired-flag", tenantId: " acme " })
    vaultCheck("overrides.delete removes an orphaned override without reading its entry", same([odOrphan.body?.data?.ok, odOrphan.body?.data?.key, odOrphan.body?.data?.tenantId], [true, "legacy.retired-flag", "acme"]), JSON.stringify(odOrphan.body))
    const odOrphanList = data(await cfgCall("overrides.list", { key: "legacy.retired-flag" }))
    vaultCheck("the removed orphan is gone and the other one is still listed", odOrphanList?.total === 1 && odOrphanList.overrides[0].tenantId === "globex" && odOrphanList.overrides[0].keyExists === false, JSON.stringify(odOrphanList))
    const odOrphanAgain = await od({ key: "legacy.retired-flag", tenantId: "acme" })
    vaultCheck("removing that orphan again is 404 NOT_FOUND about the override", refused(odOrphanAgain, 404, "NOT_FOUND", "tenant override not found"), failure(odOrphanAgain))
    const odNone = await od({ key: "spot/config.a", tenantId: "initech" })
    vaultCheck("overrides.delete with none set is 404 NOT_FOUND", refused(odNone, 404, "NOT_FOUND", "tenant override not found"), failure(odNone))
    const odOk = await od({ key: "spot/config.a", tenantId: " globex " })
    vaultCheck("overrides.delete answers ok, the key and the trimmed tenant", same([odOk.body?.data?.ok, odOk.body?.data?.key, odOk.body?.data?.tenantId], [true, "spot/config.a", "globex"]), JSON.stringify(odOk.body))
    const rReverted = data(await cfgCall("config.resolve", { key: "spot/config.a", tenantId: "globex" }))
    vaultCheck("deleting the override hands the tenant back to the app default", rReverted?.source === "appDefault" && rReverted.value === "eight" && !("overrideValue" in rReverted), JSON.stringify(rReverted))
    vaultCheck("overrides.delete records override.deleted", (await cfgActions("spot/config.a"))[0] === "override.deleted", JSON.stringify(await cfgActions("spot/config.a")))

    // config.update: a type change is refused while an override would stop being a value of the type.
    const rt = "spot/config.retype"
    await mk({ key: rt, valueType: "string", value: "s" })
    await os({ key: rt, tenantId: "zeta", value: "12" })
    await os({ key: rt, tenantId: "acme", value: "7" })
    const rtRefused = await cfgCall("config.update", { key: rt, valueType: "int", value: 3 })
    vaultCheck("a type change is refused while an override is not a valid value of the new type, naming the first tenant", badRequest(rtRefused, "config: valueType: tenant acme has an override of a string, which is not a valid int; change or revert it first"), failure(rtRefused))
    const rtStill = data(await cfgCall("config.detail", { key: rt }))
    vaultCheck("the refused type change wrote nothing", rtStill?.entry?.valueType === "string" && rtStill.entry.value === "s" && rtStill.entry.version === 1 && same(rtStill.overrides.map((o) => o.tenantId), ["acme", "zeta"]), JSON.stringify(rtStill))
    await od({ key: rt, tenantId: "acme" })
    const rtSecond = await cfgCall("config.update", { key: rt, valueType: "int", value: 3 })
    vaultCheck("reverting the first names the next tenant in order", badRequest(rtSecond, "config: valueType: tenant zeta has an override of a string, which is not a valid int; change or revert it first"), failure(rtSecond))
    await od({ key: rt, tenantId: "zeta" })
    const rtOk = await cfgCall("config.update", { key: rt, valueType: "int", value: 3 })
    vaultCheck("the type change goes through once no override is left to strand", rtOk.body?.data?.entry?.valueType === "int" && rtOk.body.data.entry.value === 3 && rtOk.body.data.entry.version === 2, JSON.stringify(rtOk.body))
    await os({ key: rt, tenantId: "acme", value: 9 })
    const rtFits = await cfgCall("config.update", { key: rt, valueType: "float", value: 3.5 })
    vaultCheck("an override that is a valid value of the new type does not block the change", rtFits.body?.data?.entry?.valueType === "float" && rtFits.body.data.entry.version === 3, JSON.stringify(rtFits.body))

    // config.delete: overrides go with the key and stay gone when it is made again.
    const dl = "spot/config.del"
    await mk({ key: dl, valueType: "string", value: "first", description: "to be deleted" })
    await cfgCall("config.update", { key: dl, value: "second" })
    await os({ key: dl, tenantId: "acme", value: "a" })
    await os({ key: dl, tenantId: "globex", value: "g" })
    const dropped = await cfgCall("config.delete", { key: dl })
    vaultCheck("config.delete answers ok and the key", same([dropped.body?.data?.ok, dropped.body?.data?.key], [true, dl]), JSON.stringify(dropped.body))
    const droppedDetail = await cfgCall("config.detail", { key: dl })
    vaultCheck("a deleted entry is gone", refused(droppedDetail, 404, "NOT_FOUND", "config entry not found"), failure(droppedDetail))
    const droppedOverrides = data(await cfgCall("overrides.list", { key: dl }))
    const droppedByTenant = data(await cfgCall("overrides.list", { tenantId: "acme" }))
    vaultCheck("config.delete removes the key's overrides, so none is left to list as an orphan", droppedOverrides?.total === 0 && !(droppedByTenant?.overrides ?? []).some((o) => o.key === dl), JSON.stringify([droppedOverrides, droppedByTenant?.total]))
    const droppedTwice = await cfgCall("config.delete", { key: dl })
    vaultCheck("config.delete on a missing key is 404 NOT_FOUND", refused(droppedTwice, 404, "NOT_FOUND", "config entry not found"), failure(droppedTwice))
    await mk({ key: dl, valueType: "string", value: "reborn" })
    const reborn = data(await cfgCall("config.detail", { key: dl }))
    const rebornVersions = data(await cfgCall("config.versions", { key: dl }))?.versions ?? []
    vaultCheck(
      "create after delete starts clean: no overrides, one version",
      same(reborn?.overrides, []) && reborn?.entry?.version === 1 && rebornVersions.length === 1 && reborn.entry.description === "",
      JSON.stringify([reborn?.overrides, rebornVersions]),
    )
    const rebornResolve = data(await cfgCall("config.resolve", { key: dl, tenantId: "acme" }))
    vaultCheck("and no tenant resolves through an old override", rebornResolve?.source === "appDefault" && rebornResolve.value === "reborn", JSON.stringify(rebornResolve))
    const rebornActions = await cfgActions(dl)
    vaultCheck("the history keeps the deletion, and clearing the overrides wrote no override.deleted rows", rebornActions.includes("config.deleted") && !rebornActions.includes("override.deleted"), JSON.stringify(rebornActions))
    // Recreating a key that has an orphan clears the orphan.
    await mk({ key: "legacy.retired-flag", valueType: "bool", value: true })
    const orphanGone = data(await cfgCall("overrides.list", { key: "legacy.retired-flag" }))
    vaultCheck("creating a key that has orphaned overrides clears them", orphanGone?.total === 0, JSON.stringify(orphanGone))

    // The manifest's invalidates, for the six config and override commands.
    const configInvalidates = [
      ["config.create", cMade, "config.detail,config.list,config.resolve,config.versions,overrides.list"],
      ["config.update", uVal, "config.detail,config.list,config.resolve,config.versions"],
      ["config.delete", dropped, "config.detail,config.list,config.resolve,config.versions,overrides.list"],
      ["config.rollback", rbOk, "config.detail,config.list,config.resolve,config.versions"],
      ["overrides.set", osSet, "config.detail,config.resolve,overrides.list"],
      ["overrides.delete", odOk, "config.detail,config.resolve,overrides.list"],
    ]
    for (const [intent, response, want] of configInvalidates) {
      vaultCheck(`${intent} declares the manifest's invalidates`, invalidates(response) === withAudit(want), `${invalidates(response)} vs ${withAudit(want)}`)
    }

    // Audit: every action is one Go writes, and the ones this block caused are all there.
    const cfgAudit = new Set()
    for (const key of ["spot/config.a", "spot/config.json", dl, "limits.api-rate", "search.page-size", "legacy.retired-flag", "ui.theme-default"]) for (const a of await cfgActions(key)) cfgAudit.add(a)
    vaultCheck(
      "every config audit action is one Go writes",
      [...cfgAudit].every((a) => ["config.set", "config.deleted", "config.rolled_back", "override.set", "override.deleted"].includes(a)) && ["config.set", "config.deleted", "config.rolled_back", "override.set", "override.deleted"].every((a) => cfgAudit.has(a)),
      JSON.stringify([...cfgAudit]),
    )
    const rolledSeed = await cfgActions("search.page-size")
    vaultCheck("the seed has a rolled-back entry", rolledSeed.includes("config.rolled_back"), JSON.stringify(rolledSeed))

    // Clean up every entry this block made, then prove the seed count is back.
    for (const key of ["spot/config.a", "spot/config.json", "spot/config.dur0", "spot/config.dur1", "spot/config.dur2", "spot/config.dur3", "spot/config.dur4", rt, dl, "legacy.retired-flag"]) await cfgCall("config.delete", { key })
    const configAfter = data(await cfgCall("config.list", {}))
    vaultCheck("the config spot checks cleaned up after themselves", configAfter?.total === clist?.total, `${configAfter?.total} vs ${clist?.total}`)

    // -- audit.list and overview.stats (handlers_audit.go, handlers_overview.go) --
    {
      const aud = async (input) => (await vaultCall("audit.list", "query", input)).body?.data
      const audRaw = (input) => vaultCall("audit.list", "query", input)
      const ov = async () => (await vaultCall("overview.stats", "query", {})).body?.data
      const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
      const ACTIONS = [
        "secret.get", "secret.set", "secret.delete", "secret.rotated",
        "flag.created", "flag.updated", "flag.toggled", "flag.deleted", "flag.rules_set", "flag.override_set", "flag.override_deleted",
        "config.set", "config.rolled_back", "config.deleted", "override.set", "override.deleted",
        "rotation.policy_saved", "rotation.policy_deleted",
      ]
      const RESOURCES = ["secret", "flag", "config", "override", "rotation"]
      const refusedWith = (r, message) => r.status === 400 && r.body?.error?.code === "BAD_REQUEST" && r.body?.error?.message === message

      // Reads: hidden by default, shown by includeReads, and an action named alone is honoured.
      const hidden = await aud({ limit: 100 })
      const shown = await aud({ includeReads: true, limit: 100 })
      const readsOnly = await aud({ action: "secret.get", limit: 100 })
      vaultCheck(
        "audit.list hides secret reads by default, and includeReads brings exactly them back",
        hidden?.entries?.every((e) => e.action !== "secret.get") && readsOnly?.total > 0 && shown?.total === hidden.total + readsOnly.total,
        JSON.stringify([hidden?.total, readsOnly?.total, shown?.total]),
      )
      vaultCheck("naming secret.get returns the reads without includeReads", readsOnly.entries.length > 0 && readsOnly.entries.every((e) => e.action === "secret.get"), JSON.stringify(readsOnly.entries.slice(0, 2)))
      const setDefault = await aud({ action: "secret.set" })
      const setReads = await aud({ action: "secret.set", includeReads: true })
      vaultCheck("includeReads changes nothing once an action is named", eq(setDefault, setReads), `${setDefault?.total} vs ${setReads?.total}`)

      // Every action the vault writes has rows, and each filter counts exactly what it shows.
      const perAction = await Promise.all(ACTIONS.map(async (action) => [action, await aud({ action, limit: 100 })]))
      vaultCheck(
        "every one of the 18 actions has seeded rows, and the total counts them all",
        perAction.every(([action, r]) => r?.total > 0 && r.entries.length === Math.min(r.total, 100) && r.entries.every((e) => e.action === action)),
        JSON.stringify(perAction.map(([a, r]) => [a, r?.total])),
      )
      const onePerPage = await aud({ action: "secret.rotated", limit: 1 })
      const allRotated = await aud({ action: "secret.rotated", limit: 100 })
      vaultCheck("an action filter's total is the same whatever the page", onePerPage?.entries?.length === 1 && onePerPage.total === allRotated?.total && allRotated.total === allRotated.entries.length, `${onePerPage?.total} vs ${allRotated?.total}`)

      // Resource.
      const perResource = await Promise.all(RESOURCES.map(async (resource) => [resource, await aud({ resource, includeReads: true, limit: 100 })]))
      vaultCheck(
        "every resource filter changes the page and the total, and the five sum to the whole log",
        perResource.every(([resource, r]) => r?.total > 0 && r.entries.every((e) => e.resource === resource)) && perResource.reduce((n, [, r]) => n + r.total, 0) === shown.total,
        JSON.stringify(perResource.map(([r, x]) => [r, x?.total])),
      )
      const readsSecretOnly = await aud({ resource: "secret" })
      vaultCheck("the resource filter still hides reads by default", readsSecretOnly.entries.every((e) => e.action !== "secret.get") && readsSecretOnly.total < perResource[0][1].total, `${readsSecretOnly.total} vs ${perResource[0][1].total}`)

      // Key: exact, so a prefix or a substring finds nothing.
      const byKey = await aud({ key: "cache/redis.auth", includeReads: true, limit: 100 })
      const byPrefix = await aud({ key: "cache/redis", includeReads: true })
      const byPaddedKey = await aud({ key: "  cache/redis.auth  ", includeReads: true, limit: 100 })
      vaultCheck(
        "the key filter matches exactly, and is trimmed",
        byKey?.total > 0 && byKey.total < shown.total && byKey.entries.every((e) => e.key === "cache/redis.auth") && byPrefix?.total === 0 && eq(byPaddedKey, byKey),
        JSON.stringify([byKey?.total, byPrefix?.total, byPaddedKey?.total]),
      )

      // Outcome.
      const failed = await aud({ outcome: "failure", limit: 100 })
      const succeeded = await aud({ outcome: "success", limit: 100 })
      vaultCheck(
        "the outcome filter splits the default view exactly",
        failed?.total > 0 && failed.entries.every((e) => e.outcome === "failure") && succeeded.entries.every((e) => e.outcome === "success") && failed.total + succeeded.total === hidden.total,
        JSON.stringify([failed?.total, succeeded?.total, hidden?.total]),
      )
      vaultCheck("a failure row carries its error, and a failure with none recorded omits it", failed.entries.filter((e) => e.error).length === failed.total - 1 && failed.entries.filter((e) => !("error" in e)).length === 1, JSON.stringify(failed.entries.map((e) => e.error)))
      // The seed has one failure that is not a rotation. Without it the
      // 24-hour count could not tell "failed rotations" from "failures".
      const failedOther = failed.entries.filter((e) => e.action !== "secret.rotated")
      vaultCheck("the seed has a failure that is not a rotation, inside the last day", failedOther.length === 1 && failedOther[0].action === "secret.set" && Date.parse(failedOther[0].createdAt) > Date.now() - 86_400_000, JSON.stringify(failedOther))
      vaultCheck("no success row carries an error", succeeded.entries.every((e) => !("error" in e)), "a success row has an error")

      // Since: created at or after it, and the total follows.
      const hourAgo = new Date(Date.now() - 3600_000).toISOString()
      const recent = await aud({ since: hourAgo, limit: 100 })
      vaultCheck(
        "the since filter keeps only rows created at or after it, and the total follows",
        recent?.total > 0 && recent.total < hidden.total && recent.entries.every((e) => Date.parse(e.createdAt) >= Date.parse(hourAgo) - 1000),
        JSON.stringify([recent?.total, hidden?.total]),
      )
      const future = await aud({ since: new Date(Date.now() + 86_400_000).toISOString() })
      vaultCheck("a since in the future matches nothing, with an empty list rather than null", future?.total === 0 && Array.isArray(future.entries) && future.entries.length === 0, JSON.stringify(future))
      // The boundary itself: a row's exact createdAt as since keeps that row,
      // and one second later drops it.
      const boundaryRow = failedOther[0]
      const atBoundary = await aud({ since: boundaryRow.createdAt, key: boundaryRow.key, action: boundaryRow.action, limit: 100 })
      const afterBoundary = await aud({ since: new Date(Date.parse(boundaryRow.createdAt) + 1000).toISOString(), key: boundaryRow.key, action: boundaryRow.action, limit: 100 })
      vaultCheck(
        "a row's exact createdAt as since returns that row, and a second later does not",
        atBoundary.entries.some((e) => e.id === boundaryRow.id) && !afterBoundary.entries.some((e) => e.id === boundaryRow.id),
        JSON.stringify([boundaryRow.createdAt, atBoundary.total, afterBoundary.total]),
      )
      const offsetSince = await aud({ since: "2099-01-01T00:00:00+02:00", includeReads: true })
      vaultCheck("since accepts an RFC3339 offset", offsetSince?.total === 0, JSON.stringify(offsetSince))
      const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString()
      const combined = await aud({ action: "secret.rotated", outcome: "failure", since: days(1), limit: 100 })
      const combinedOlder = await aud({ action: "secret.rotated", outcome: "failure", since: days(2), limit: 100 })
      vaultCheck("filters combine: three failed rotations in the last day, more in the last two", combined?.total === 3 && combinedOlder?.total === 4, JSON.stringify([combined?.total, combinedOlder?.total]))

      // Refusals: a typo must not read as no filter, and the outcome is judged first.
      const badOutcome = await audRaw({ outcome: "failed" })
      const badSince = await audRaw({ since: "yesterday" })
      const badBoth = await audRaw({ outcome: "failed", since: "yesterday" })
      const dateOnly = await audRaw({ since: "2026-09-01" })
      vaultCheck("an unknown outcome is BAD_REQUEST", refusedWith(badOutcome, "outcome must be success or failure"), `${badOutcome.status} ${badOutcome.body?.error?.message}`)
      vaultCheck("an unparseable since is BAD_REQUEST", refusedWith(badSince, "since must be an RFC3339 time"), `${badSince.status} ${badSince.body?.error?.message}`)
      vaultCheck("a date with no time is not RFC3339", refusedWith(dateOnly, "since must be an RFC3339 time"), `${dateOnly.status} ${dateOnly.body?.error?.message}`)
      vaultCheck("the outcome is refused before the since", refusedWith(badBoth, "outcome must be success or failure"), `${badBoth.status} ${badBoth.body?.error?.message}`)
      const blankFilters = await aud({ resource: " ", key: " ", action: " ", outcome: " ", since: " " })
      vaultCheck("blank filters are no filters", eq(blankFilters, await aud({})), `${blankFilters?.total}`)

      // Paging: newest first, limit capped at 100, offset past the end is an empty page with the same total.
      const p1 = await aud({ limit: 5, includeReads: true })
      const p2 = await aud({ limit: 5, offset: 5, includeReads: true })
      const everything = await aud({ limit: 100, includeReads: true })
      vaultCheck(
        "audit.list pages newest first, and the total does not move with the page",
        p1.entries.length === 5 && p2.entries.length === 5 && eq(p1.entries.concat(p2.entries), everything.entries.slice(0, 10)) && p1.total === p2.total && p1.total === shown.total && everything.entries.every((e, i, all) => i === 0 || Date.parse(all[i - 1].createdAt) >= Date.parse(e.createdAt)),
        JSON.stringify([p1.total, p2.total]),
      )
      const huge = await aud({ limit: 100000, includeReads: true })
      const dflt = await aud({ includeReads: true })
      const negative = await aud({ limit: -3, offset: -9, includeReads: true })
      vaultCheck(
        "audit.list caps the limit at 100, defaults it to 25, and treats a negative offset as 0",
        huge.entries.length === 100 && huge.total > 100 && dflt.entries.length === 25 && eq(negative.entries, dflt.entries),
        JSON.stringify([huge.entries.length, huge.total, dflt.entries.length]),
      )
      const pastEnd = await aud({ offset: 100000 })
      vaultCheck("an offset past the end is an empty list and the same total", pastEnd?.entries?.length === 0 && Array.isArray(pastEnd.entries) && pastEnd.total === hidden.total, JSON.stringify(pastEnd))

      // The row: userId, tenantId and error are omitted when empty.
      // The newest hundred are what the spot checks above just wrote, all by
      // the operator, so the reads and the rotations are added for the mix.
      const rows = [...shown.entries, ...readsOnly.entries, ...allRotated.entries]
      const isRow = (e) => ["id", "action", "resource", "key", "outcome", "createdAt"].every((k) => typeof e[k] === "string" && e[k] !== "")
      vaultCheck("every audit row carries id, action, resource, key, outcome and createdAt", rows.every(isRow), "a row is missing a field")
      vaultCheck("the seed has rows with and without a user, and with and without a tenant", rows.some((e) => e.userId) && rows.some((e) => !("userId" in e)) && rows.some((e) => e.tenantId) && rows.some((e) => !("tenantId" in e)), "no mix")
      vaultCheck("no row carries an empty userId, tenantId or error", rows.every((e) => e.userId !== "" && e.tenantId !== "" && e.error !== ""), "an empty string reached the wire")
      vaultCheck("every failure in the seed is on the secret resource", rows.filter((e) => e.outcome === "failure").every((e) => (e.action === "secret.rotated" || e.action === "secret.set") && e.resource === "secret"), "a failure has another action")
      const overrideRow = (await aud({ resource: "override", limit: 100 })).entries.find((e) => e.action === "override.set")
      vaultCheck("an override row is attributed to the tenant it targets", typeof overrideRow?.tenantId === "string" && overrideRow.tenantId !== "", JSON.stringify(overrideRow))

      // overview.stats against the seed and the other lists.
      const stats = await ov()
      const secretList = (await vaultCall("secrets.list", "query", { limit: 200 })).body?.data
      const policyList = (await vaultCall("rotation.policies", "query", { limit: 200 })).body?.data
      const flagTotal = (await vaultCall("flags.list", "query", {})).body?.data?.total
      const configTotal = (await vaultCall("config.list", "query", {})).body?.data?.total
      const tenantOverrides = (await Promise.all(["acme", "globex", "initech"].map(async (tenantId) => (await vaultCall("overrides.list", "query", { tenantId })).body?.data?.total ?? 0))).reduce((n, t) => n + t, 0)
      const enabledPolicies = policyList.policies.filter((p) => p.enabled)
      vaultCheck(
        "overview.stats counts secrets, flags, config entries and overrides like their lists",
        stats?.secrets === secretList.total && stats.unencryptedSecrets === secretList.secrets.filter((s) => s.encryptionAlg === "").length && stats.flags === flagTotal && stats.configEntries === configTotal && stats.configOverrides === tenantOverrides,
        JSON.stringify(stats),
      )
      vaultCheck("the seed leaves an unencrypted secret, so the overview cannot call the vault encrypted", stats.unencryptedSecrets >= 1, `${stats.unencryptedSecrets}`)
      vaultCheck(
        "overview.stats' rotation figures come from the one policy list",
        stats.rotationPolicies === policyList.total && stats.rotationEnabled === enabledPolicies.length && stats.rotationWithoutRotator === enabledPolicies.filter((p) => !p.rotatable).length && stats.rotationOverdue === enabledPolicies.filter((p) => p.rotatable && p.nextRotationAt && Date.parse(p.nextRotationAt) < Date.now()).length,
        JSON.stringify(stats),
      )
      vaultCheck("the seed has an overdue policy, a policy without a rotator and a disabled one", stats.rotationOverdue >= 1 && stats.rotationWithoutRotator >= 1 && stats.rotationEnabled < stats.rotationPolicies, JSON.stringify(stats))
      const pastDueNoRotator = policyList.policies.filter((p) => p.enabled && !p.rotatable && p.nextRotationAt && Date.parse(p.nextRotationAt) < Date.now())
      const disabledNoRotator = policyList.policies.filter((p) => !p.enabled && !p.rotatable)
      vaultCheck(
        "an enabled policy with no rotator and a past due time is counted without a rotator, not overdue; a disabled one with no rotator is counted in neither",
        pastDueNoRotator.length >= 1 && disabledNoRotator.length >= 1 && stats.rotationOverdue === enabledPolicies.filter((p) => p.rotatable && p.nextRotationAt && Date.parse(p.nextRotationAt) < Date.now()).length && stats.rotationWithoutRotator === enabledPolicies.filter((p) => !p.rotatable).length,
        JSON.stringify([pastDueNoRotator.map((p) => p.secretKey), disabledNoRotator.map((p) => p.secretKey), stats.rotationOverdue, stats.rotationWithoutRotator]),
      )
      vaultCheck("a disabled policy is neither overdue nor without a rotator", policyList.policies.filter((p) => !p.enabled).length >= 1 && stats.rotationOverdue + stats.rotationWithoutRotator <= stats.rotationEnabled, JSON.stringify(stats))
      const failedDay = await aud({ outcome: "failure", since: days(1), limit: 100 })
      vaultCheck(
        "failures in the last 24 hours count only the three rotations inside the window, and not the failed secret.set beside them",
        stats.rotationFailures24h === 3 && stats.rotationFailures24h === combined.total && failedDay.total === 4,
        JSON.stringify([stats.rotationFailures24h, combined.total, failedDay.total]),
      )
      vaultCheck("overview.stats reports the keyed algorithm", stats.encryptionEnabled === true && stats.encryptionAlgorithm === "AES-256-GCM", JSON.stringify([stats.encryptionEnabled, stats.encryptionAlgorithm]))
      vaultCheck(
        "recent activity is the ten newest rows of the default view, no reads",
        Array.isArray(stats.recentActivity) && stats.recentActivity.length === 10 && eq(stats.recentActivity, hidden.entries.slice(0, 10)) && stats.recentActivity.every((e) => e.action !== "secret.get"),
        JSON.stringify(stats.recentActivity.map((e) => e.action)),
      )
      // The check above is vacuous when no read is near the top of the log: a
      // leak of secret.get could not show. A rotation reads the secret first,
      // so after one a read sits among the newest rows of the raw log, and the
      // overview must still leave it out.
      await vaultCall("rotation.rotateNow", "command", { key: "smtp/relay.password" })
      const rawTop = await aud({ includeReads: true, limit: 10 })
      const hiddenTop = await aud({ limit: 10 })
      const statsRead = await ov()
      vaultCheck("a read is among the ten newest rows of the raw log, so recent activity has one to leave out", rawTop.entries.some((e) => e.action === "secret.get"), JSON.stringify(rawTop.entries.map((e) => e.action)))
      vaultCheck(
        "recent activity has no secret.get even then, and is the default view's first ten",
        statsRead.recentActivity.length === 10 && statsRead.recentActivity.every((e) => e.action !== "secret.get") && eq(statsRead.recentActivity, hiddenTop.entries),
        JSON.stringify(statsRead.recentActivity.map((e) => e.action)),
      )
      const overviewKeys = ["secrets", "unencryptedSecrets", "flags", "configEntries", "configOverrides", "rotationPolicies", "rotationEnabled", "rotationOverdue", "rotationWithoutRotator", "rotationFailures24h", "encryptionEnabled", "encryptionAlgorithm", "recentActivity"]
      vaultCheck("overview.stats carries every field and nothing else", eq(Object.keys(stats).sort(), overviewKeys.slice().sort()), JSON.stringify(Object.keys(stats)))

      // Every command writes a row that names the operator, and a refused or read call writes none.
      const total0 = (await aud({ includeReads: true })).total
      const madeKey = "spot/audit.key"
      const statsBefore = await ov()
      await vaultCall("secrets.create", "command", { key: madeKey, value: canary })
      await vaultCall("secrets.create", "command", { key: madeKey, value: canary })
      await vaultCall("secrets.create", "command", { key: "spot/audit.empty", value: "" })
      await audRaw({ outcome: "nope" })
      await ov()
      const afterCreate = await aud({ includeReads: true })
      vaultCheck("a refused command and a query write no audit row", afterCreate.total === total0 + 1, `${afterCreate.total} vs ${total0 + 1}`)
      const createdRow = afterCreate.entries[0]
      vaultCheck(
        "secrets.create writes secret.set naming the operator",
        createdRow?.action === "secret.set" && createdRow.resource === "secret" && createdRow.key === madeKey && createdRow.outcome === "success" && createdRow.userId === "usr_1" && !("tenantId" in createdRow) && !("error" in createdRow),
        JSON.stringify(createdRow),
      )
      const statsAfter = await ov()
      vaultCheck("a create moves the overview: one more secret, and it heads recent activity", statsAfter.secrets === statsBefore.secrets + 1 && eq(statsAfter.recentActivity[0], createdRow), JSON.stringify(statsAfter.recentActivity[0]))

      await vaultCall("secrets.update", "command", { key: madeKey, value: canary })
      await vaultCall("rotation.savePolicy", "command", { key: madeKey, intervalSeconds: 3600, enabled: true })
      const savedRow = (await aud({ key: madeKey, resource: "rotation" })).entries[0]
      vaultCheck(
        "rotation.savePolicy writes rotation.policy_saved on the rotation resource, keyed by the secret",
        savedRow?.action === "rotation.policy_saved" && savedRow.resource === "rotation" && savedRow.key === madeKey && savedRow.userId === "usr_1",
        JSON.stringify(savedRow),
      )
      // Enabled with no rotator: the overview must say so.
      const withoutRotator = await ov()
      vaultCheck("saving an enabled policy with no rotator raises rotationWithoutRotator", withoutRotator.rotationWithoutRotator === statsAfter.rotationWithoutRotator + 1 && withoutRotator.rotationPolicies === statsAfter.rotationPolicies + 1, JSON.stringify(withoutRotator))
      await vaultCall("rotation.deletePolicy", "command", { key: madeKey })
      const deletedPolicyRow = (await aud({ key: madeKey, resource: "rotation" })).entries[0]
      vaultCheck("rotation.deletePolicy writes rotation.policy_deleted", deletedPolicyRow?.action === "rotation.policy_deleted" && deletedPolicyRow.userId === "usr_1" && deletedPolicyRow.resource === "rotation", JSON.stringify(deletedPolicyRow))

      // A refused delete of a policy that is not there writes no row.
      const beforeRefused = (await aud({ includeReads: true })).total
      const refusedDelete = await vaultCall("rotation.deletePolicy", "command", { key: madeKey })
      const afterRefused = await aud({ includeReads: true })
      vaultCheck(
        "a refused rotation.deletePolicy is NOT_FOUND and writes no audit row",
        refusedDelete.status === 404 && refusedDelete.body?.error?.code === "NOT_FOUND" && afterRefused.total === beforeRefused,
        `${refusedDelete.status} ${refusedDelete.body?.error?.code} ${beforeRefused} vs ${afterRefused.total}`,
      )

      await vaultCall("rotation.rotateNow", "command", { key: "smtp/relay.password" })
      const rotationRows = (await aud({ key: "smtp/relay.password", includeReads: true, limit: 3 })).entries
      vaultCheck(
        "rotation.rotateNow writes the read, the set and secret.rotated, all naming the operator",
        eq(rotationRows.map((e) => e.action), ["secret.rotated", "secret.set", "secret.get"]) && rotationRows.every((e) => e.userId === "usr_1" && e.outcome === "success" && e.resource === "secret"),
        JSON.stringify(rotationRows),
      )

      await vaultCall("secrets.delete", "command", { key: madeKey })
      const removedRows = (await aud({ key: madeKey })).entries
      vaultCheck("secrets.delete writes secret.delete naming the operator", removedRows[0]?.action === "secret.delete" && removedRows[0].userId === "usr_1", JSON.stringify(removedRows[0]))
      vaultCheck("a delete that found no policy writes no rotation.policy_deleted row of its own", removedRows.filter((e) => e.action === "rotation.policy_deleted").length === 1, JSON.stringify(removedRows.map((e) => e.action)))

      // A delete that removes a policy records it, after the secret.delete row.
      const policied = "spot/audit.policied"
      await vaultCall("secrets.create", "command", { key: policied, value: canary })
      await vaultCall("rotation.savePolicy", "command", { key: policied, intervalSeconds: 3600, enabled: true })
      await vaultCall("secrets.delete", "command", { key: policied })
      const poliedRows = (await aud({ key: policied, limit: 10 })).entries
      vaultCheck(
        "secrets.delete writes rotation.policy_deleted, naming the operator, when it removes a policy",
        eq(poliedRows.slice(0, 2).map((e) => [e.action, e.resource]), [["rotation.policy_deleted", "rotation"], ["secret.delete", "secret"]]) && poliedRows[0].userId === "usr_1" && poliedRows[0].outcome === "success",
        JSON.stringify(poliedRows.slice(0, 3)),
      )

      // A manual rotation whose rotator fails. cache/redis.auth's always does.
      // Go answers what mapError gives an error that is not a domain sentinel,
      // and the manager's hook still writes the attempt as a failure row that
      // names the operator and carries the wrapped error.
      const redisBefore = await vaultCall("secrets.detail", "query", { key: "cache/redis.auth" })
      const redisRecordsBefore = await vaultCall("rotation.detail", "query", { key: "cache/redis.auth" })
      const failuresBefore = (await ov()).rotationFailures24h
      const failedRotation = await vaultCall("rotation.rotateNow", "command", { key: "cache/redis.auth" })
      vaultCheck(
        "a failed manual rotation is INTERNAL with the generic message, and says nothing of the cause",
        failedRotation.status === 500 && failedRotation.body?.error?.code === "INTERNAL" && failedRotation.body.error.message === "an internal error occurred" && !JSON.stringify(failedRotation.body).includes("connection refused"),
        JSON.stringify(failedRotation.body),
      )
      const redisRows = (await aud({ key: "cache/redis.auth", includeReads: true, limit: 2 })).entries
      vaultCheck(
        "it leaves the read, then a secret.rotated failure row naming the operator with its error",
        eq(redisRows.map((e) => e.action), ["secret.rotated", "secret.get"]) && redisRows[0].outcome === "failure" && redisRows[0].userId === "usr_1" && redisRows[0].resource === "secret" && /^rotation: rotator failed for "cache\/redis\.auth": /.test(redisRows[0].error ?? "") && redisRows[1].outcome === "success",
        JSON.stringify(redisRows),
      )
      const redisFailures = await aud({ key: "cache/redis.auth", outcome: "failure", action: "secret.rotated", limit: 1 })
      vaultCheck("the failure is what filtering outcome failure finds first", redisFailures.entries[0]?.id === redisRows[0]?.id, JSON.stringify(redisFailures.entries[0]))
      const redisAfter = await vaultCall("secrets.detail", "query", { key: "cache/redis.auth" })
      const redisRecordsAfter = await vaultCall("rotation.detail", "query", { key: "cache/redis.auth" })
      vaultCheck(
        "a failed rotation changes nothing else: same version, same records, same due time",
        redisAfter.body?.data?.secret?.version === redisBefore.body?.data?.secret?.version &&
          eq(redisRecordsAfter.body?.data?.records, redisRecordsBefore.body?.data?.records) &&
          redisAfter.body?.data?.rotation?.nextRotationAt === redisBefore.body?.data?.rotation?.nextRotationAt,
        JSON.stringify([redisBefore.body?.data?.secret?.version, redisAfter.body?.data?.secret?.version]),
      )
      vaultCheck("the overview counts it as one more failed rotation", (await ov()).rotationFailures24h === failuresBefore + 1, `${failuresBefore}`)

      // The detail intents' recent audit is the list's row, field for field.
      const detailRows = [
        ["secrets.detail", "cache/redis.auth", ["secret"]],
        ["flags.detail", "checkout.new-flow", ["flag"]],
        // A config entry's history is its own writes and its overrides'.
        ["config.detail", "limits.api-rate", ["config", "override"]],
      ]
      for (const [intent, key, resources] of detailRows) {
        const detail = (await vaultCall(intent, "query", { key })).body?.data?.recentAudit ?? []
        const listed = (await aud({ key, includeReads: true, limit: 100 })).entries.filter((e) => resources.includes(e.resource))
        vaultCheck(
          `${intent} recentAudit carries resource, key, tenant, user and error like audit.list`,
          detail.length > 0 && eq(detail, listed.slice(0, detail.length)) && detail.every((e) => resources.includes(e.resource) && e.key === key && e.userId !== "" && e.tenantId !== "" && e.error !== ""),
          JSON.stringify(detail.slice(0, 2)),
        )
      }
      const redisDetail = (await vaultCall("secrets.detail", "query", { key: "cache/redis.auth" })).body?.data?.recentAudit
      vaultCheck("secrets.detail shows the failure row's error", redisDetail?.[0]?.outcome === "failure" && redisDetail[0].userId === "usr_1" && typeof redisDetail[0].error === "string", JSON.stringify(redisDetail?.[0]))

      await vaultCall("flags.setTenantOverride", "command", { key: "search.typeahead", tenantId: "globex", value: false })
      const flagOverrideRow = (await aud({ key: "search.typeahead", action: "flag.override_set" })).entries[0]
      vaultCheck("a flag override row names the operator and the tenant it targets", flagOverrideRow?.userId === "usr_1" && flagOverrideRow.tenantId === "globex" && flagOverrideRow.resource === "flag", JSON.stringify(flagOverrideRow))
      await vaultCall("flags.deleteTenantOverride", "command", { key: "search.typeahead", tenantId: "globex" })
      const flagOverrideGone = (await aud({ key: "search.typeahead", action: "flag.override_deleted" })).entries[0]
      vaultCheck("deleting it writes flag.override_deleted with the same tenant", flagOverrideGone?.userId === "usr_1" && flagOverrideGone.tenantId === "globex", JSON.stringify(flagOverrideGone))

      // The resource each of the other commands writes under.
      await vaultCall("flags.create", "command", { key: "spot/audit.flag", type: "bool", defaultValue: false, enabled: true })
      await vaultCall("flags.setEnabled", "command", { key: "spot/audit.flag", enabled: false })
      await vaultCall("flags.delete", "command", { key: "spot/audit.flag" })
      const flagRows = (await aud({ key: "spot/audit.flag", limit: 10 })).entries
      vaultCheck(
        "flag commands write flag.created, flag.toggled and flag.deleted on the flag resource",
        eq(flagRows.map((e) => e.action), ["flag.deleted", "flag.toggled", "flag.created"]) && flagRows.every((e) => e.resource === "flag" && e.userId === "usr_1"),
        JSON.stringify(flagRows),
      )
      await vaultCall("config.create", "command", { key: "spot/audit.config", valueType: "int", value: 1 })
      await vaultCall("overrides.set", "command", { key: "spot/audit.config", tenantId: "acme", value: 2 })
      await vaultCall("overrides.delete", "command", { key: "spot/audit.config", tenantId: "acme" })
      await vaultCall("config.delete", "command", { key: "spot/audit.config" })
      const cfgRows = (await aud({ key: "spot/audit.config", limit: 10 })).entries
      vaultCheck(
        "config commands write config.set, override.set, override.deleted and config.deleted, with the override rows on the tenant",
        eq(cfgRows.map((e) => [e.action, e.resource]), [["config.deleted", "config"], ["override.deleted", "override"], ["override.set", "override"], ["config.set", "config"]]) && cfgRows.every((e) => e.userId === "usr_1") && cfgRows.filter((e) => e.resource === "override").every((e) => e.tenantId === "acme") && !("tenantId" in cfgRows[0]),
        JSON.stringify(cfgRows),
      )
    }
    }
  }

  // bastion: the rules the Go handlers enforce, not just "answered".
  {
    const call = (intent, input) => dispatch("bastion", intent, "query", input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  bastion ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::bastion ${name}`, reason: detail })
    }
    const missing = await call("routes.detail", { id: "nope" })
    check("unknown route is NOT_FOUND", missing.body?.error?.code === "NOT_FOUND", JSON.stringify(missing.body))
    const blank = await call("routes.detail", {})
    check("missing id is BAD_REQUEST", blank.body?.error?.code === "BAD_REQUEST", JSON.stringify(blank.body))
    const orders = await call("routes.detail", { id: "9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36" })
    const leaked = JSON.stringify(orders.body).includes("k-")
    check("transform api key is redacted", orders.body?.data?.transform?.requestHeaders?.set?.["X-Api-Key"] === "[redacted]" && !leaked, JSON.stringify(orders.body?.data?.transform))
    const first = (await call("overview.stats", {})).body?.data?.totalRequests
    const second = (await call("overview.stats", {})).body?.data?.totalRequests
    check("overview counters advance between reads", second > first, `${first} then ${second}`)
    const cmd = (intent, input) => dispatch("bastion", intent, "command", input, csrf)
    const farp = await cmd("routes.update", { id: "farp-billing-http", priority: 1 })
    check("discovered route edit is CONFLICT source", farp.body?.error?.code === "CONFLICT" && farp.body?.error?.details?.reason === "source", JSON.stringify(farp.body))
    const dup = await cmd("routes.create", { path: "/users", methods: [], targets: [{ url: "http://users:8080", weight: 1 }] })
    check("duplicate path is CONFLICT duplicate", dup.body?.error?.details?.reason === "duplicate", JSON.stringify(dup.body))
    const noTargets = await cmd("routes.create", { path: "/empty", methods: [], targets: [] })
    check("no upstream is BAD_REQUEST on targets", noTargets.body?.error?.details?.field === "targets", JSON.stringify(noTargets.body))
    const toggled = await cmd("routes.setEnabled", { id: "manual-/users", enabled: false })
    check("setEnabled answers durable false", toggled.body?.data?.durable === false, JSON.stringify(toggled.body))
  }

  // ledger catalog: writes visible in the next read, the manifest's
  // invalidates, and the refusals the Go contract makes.
  {
    const lc = (intent, kind, input) => dispatch("ledger", intent, kind, input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  ledger ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::ledger ${name}`, reason: detail })
    }
    const body = (r) => r.body?.data

    const created = await lc("plans.create", "command", { name: "Spot plan", slug: "spot-plan", currency: "usd" })
    check("plans.create answers a draft plan", body(created)?.status === "draft", JSON.stringify(created.body))
    check("plans.create declares the manifest's invalidates", (created.body?.meta?.invalidates ?? []).join(",") === "plans.list,overview.stats", JSON.stringify(created.body?.meta))
    const listed = body(await lc("plans.list", "query", { limit: 200 }))
    check("the new plan is in plans.list", listed?.items?.some((p) => p.slug === "spot-plan") === true, JSON.stringify(listed))
    const dup = await lc("plans.create", "command", { name: "Spot plan", slug: "spot-plan", currency: "usd" })
    check("a taken slug is 409 CONFLICT", dup.status === 409 && dup.body?.error?.code === "CONFLICT", JSON.stringify(dup.body))
    const inUse = await lc("plans.delete", "command", { id: "plan_pro" })
    check("deleting a plan in use is 409 CONFLICT", inUse.status === 409 && inUse.body?.error?.code === "CONFLICT", JSON.stringify(inUse.body))
    const paged = body(await lc("plans.list", "query", { limit: 2 }))
    check("plans.list pages with has_more and no total", paged?.items?.length === 2 && paged.has_more === true && !("total" in paged), JSON.stringify(paged))
    const clamped = body(await lc("plans.list", "query", { limit: 500 }))
    check("a limit over 200 is clamped", clamped?.limit === 200, JSON.stringify(clamped?.limit))
    const pastEnd = body(await lc("plans.list", "query", { offset: 999 }))
    check("an offset past the end is an empty page, not an error", pastEnd?.items?.length === 0 && pastEnd.has_more === false, JSON.stringify(pastEnd))
    const money = body(await lc("plans.detail", "query", { id: "plan_pro" }))?.pricing?.base_amount
    check("money is {amount, currency, display}", money?.amount === 4900 && money.currency === "usd" && typeof money.display === "string", JSON.stringify(money))
    const shared = body(await lc("features.detail", "query", { id: "feat_support_hours" }))
    check("a shared catalog feature is readable from the app", shared?.app_id === "", JSON.stringify(shared))
    const sharedWrite = await lc("features.update", "command", { id: "feat_support_hours", name: "x" })
    const sharedAfter = body(await lc("features.detail", "query", { id: "feat_support_hours" }))
    check("a shared catalog feature is not writable from the app", sharedWrite.status === 403 && sharedWrite.body?.error?.code === "PERMISSION_DENIED" && sharedWrite.body?.error?.message === "shared features can be changed only with no app selected" && sharedAfter?.name === "Support hours", JSON.stringify({ write: sharedWrite.body, after: sharedAfter?.name }))
    const applyTwice = await lc("coupons.apply", "command", { subscription_id: "sub_acme", code: "LAUNCH20" })
    check("applying a coupon twice is 409 CONFLICT", applyTwice.body?.error?.code === "CONFLICT", JSON.stringify(applyTwice.body))
    const expired = await lc("coupons.apply", "command", { subscription_id: "sub_acme", code: "SPRING15" })
    check("a coupon not yet valid is 400 BAD_REQUEST", expired.body?.error?.code === "BAD_REQUEST", JSON.stringify(expired.body))
    const cleared = await lc("coupons.update", "command", { id: "cpn_launch20", valid_until: null })
    check("coupons.update with valid_until null clears it", body(cleared) !== undefined && !("valid_until" in body(cleared)), JSON.stringify(cleared.body))
    const nulled = await lc("plans.update", "command", { id: "plan_pro", features: null, name: null })
    const nulledDetail = body(await lc("plans.detail", "query", { id: "plan_pro" }))
    check("a null update field leaves the plan alone", nulled.body?.ok === true && nulledDetail?.features?.length === 3 && nulledDetail?.name === "Pro", JSON.stringify({ update: nulled.body, features: nulledDetail?.features?.length, name: nulledDetail?.name }))
    await lc("plans.delete", "command", { id: body(created)?.id })
  }

  // ledger billing: lifecycles, refusals and writes visible in the next read.
  // (fix round 1: agrees with the Go engine, see ledger.go and subscription_write.go)
  {
    const lc = (intent, kind, input) => dispatch("ledger", intent, kind, input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  ledger ${name}: ${ok}`)
      if (!ok && detail) console.log(`    ${detail}`)
      if (!ok) failures.push({ key: `spot-check::ledger ${name}`, reason: detail })
    }
    const body = (r) => r.body?.data
    const code = (r) => r.body?.error?.code
    const detailOf = async (subId) => body(await lc("subscriptions.detail", "query", { id: subId }))

    const sub = await lc("subscriptions.create", "command", { tenant_id: "spot-tenant", plan_id: "plan_starter" })
    check("a plan with a trial starts trialing", body(sub)?.status === "trialing" && typeof body(sub)?.trial_end === "string", JSON.stringify(sub.body))
    check("subscriptions.create declares the manifest's invalidates", (sub.body?.meta?.invalidates ?? []).join(",") === "subscriptions.list,overview.stats,entitlements.check,paymentMethods.list", JSON.stringify(sub.body?.meta))
    check("an unknown plan cannot be subscribed to", code(await lc("subscriptions.create", "command", { tenant_id: "spot-other", plan_id: "plan_missing" })) === "NOT_FOUND", "")
    const draftPlan = body(await lc("plans.create", "command", { name: "Draft only", slug: "draft-only", currency: "usd" }))
    check("a draft plan cannot be subscribed to, and that is BAD_REQUEST", code(await lc("subscriptions.create", "command", { tenant_id: "spot-other", plan_id: draftPlan?.id })) === "BAD_REQUEST", "")
    const oldPlan = body(await lc("plans.create", "command", { name: "Old", slug: "old-plan", currency: "usd" }))
    await lc("plans.activate", "command", { id: oldPlan?.id })
    await lc("plans.archive", "command", { id: oldPlan?.id })
    const archived = await lc("subscriptions.create", "command", { tenant_id: "spot-other", plan_id: oldPlan?.id })
    check("an archived plan cannot be subscribed to either", code(archived) === "BAD_REQUEST", JSON.stringify(archived.body))
    const listed = body(await lc("subscriptions.list", "query", { tenant_id: "spot-tenant" }))
    check("the new subscription is in subscriptions.list", listed?.items?.length === 1, JSON.stringify(listed))
    const id = body(sub)?.id
    const twiceA = await lc("subscriptions.create", "command", { tenant_id: "spot-twice", plan_id: "plan_pro" })
    const twiceB = await lc("subscriptions.create", "command", { tenant_id: "spot-twice", plan_id: "plan_pro" })
    check("the ledger has no one-subscription-per-tenant rule", body(twiceA)?.status === "active" && body(twiceB)?.status === "active" && body(twiceA)?.id !== body(twiceB)?.id, JSON.stringify([twiceA.body, twiceB.body]))
    check("pause from trialing", body(await lc("subscriptions.pause", "command", { id }))?.status === "paused", "")
    check("resume from paused, still trialing because the trial outlived the pause", body(await lc("subscriptions.resume", "command", { id }))?.status === "trialing", "")
    check("pausing an active subscription twice is BAD_REQUEST the second time", (await lc("subscriptions.pause", "command", { id }), code(await lc("subscriptions.pause", "command", { id }))) === "BAD_REQUEST", "")

    await lc("subscriptions.resume", "command", { id })

    // changePlan
    check("changePlan to a draft plan is BAD_REQUEST", code(await lc("subscriptions.changePlan", "command", { id, plan_id: draftPlan?.id })) === "BAD_REQUEST", "")
    check("changePlan on an ended subscription is CONFLICT", code(await lc("subscriptions.changePlan", "command", { id: "sub_umbrella", plan_id: "plan_pro" })) === "CONFLICT", "")
    const kept = await lc("subscriptions.changePlan", "command", { id: "sub_acme", plan_id: "plan_pro", quantity: null })
    check("changePlan with quantity null keeps the seats, read back", body(kept)?.quantity?.seats === 6 && (await detailOf("sub_acme"))?.subscription?.quantity?.seats === 6, JSON.stringify(kept.body))
    const noSeats = body(await lc("plans.create", "command", { name: "No seats", slug: "no-seats", currency: "usd", features: [{ key: "api_calls", type: "metered", limit: 10, period: "monthly" }] }))
    await lc("plans.activate", "command", { id: noSeats?.id })
    const softPlan = body(await lc("plans.create", "command", { name: "Soft seats", slug: "soft-seats", currency: "usd", features: [{ key: "seats", type: "seat", limit: 2, period: "none", soft_limit: true }] }))
    await lc("plans.activate", "command", { id: softPlan?.id })
    const onSoft = await lc("subscriptions.changePlan", "command", { id, plan_id: softPlan?.id, quantity: { seats: 5 } })
    check("changePlan takes a new seat count", body(onSoft)?.plan_id === softPlan?.id && body(onSoft)?.quantity?.seats === 5, JSON.stringify(onSoft.body))
    const soft = body(await lc("entitlements.check", "query", { tenant_id: "spot-tenant", feature_key: "seats" }))
    check("over a soft limit is allowed with reason over soft limit", soft?.allowed === true && soft.reason === "over soft limit", JSON.stringify(soft))
    const stranded = await lc("subscriptions.changePlan", "command", { id, plan_id: noSeats?.id })
    check("kept seats that are not a seat feature of the new plan are BAD_REQUEST", code(stranded) === "BAD_REQUEST", JSON.stringify(stranded.body))
    const afterRefusal = await detailOf(id)
    check("a refused changePlan writes nothing", afterRefusal?.subscription?.plan_id === softPlan?.id && afterRefusal.subscription.quantity?.seats === 5, JSON.stringify(afterRefusal?.subscription))
    const onStarter = await lc("subscriptions.changePlan", "command", { id, plan_id: "plan_starter" })
    check("a kept quantity that fits the new plan stays", body(onStarter)?.plan_id === "plan_starter" && body(onStarter)?.quantity?.seats === 5, JSON.stringify(onStarter.body))
    const hard = body(await lc("entitlements.check", "query", { tenant_id: "spot-tenant", feature_key: "seats" }))
    check("over a hard limit is refused with reason quota exceeded", hard?.allowed === false && hard.reason === "quota exceeded", JSON.stringify(hard))
    const sso = body(await lc("entitlements.check", "query", { tenant_id: "spot-tenant", feature_key: "sso" }))
    check("a disabled boolean feature is refused with no reason field", sso?.allowed === false && !("reason" in (sso ?? {})), JSON.stringify(sso))
    const absent = body(await lc("entitlements.check", "query", { tenant_id: "spot-tenant", feature_key: "nope" }))
    check("a feature not in the plan says so", absent?.allowed === false && absent.reason === "feature not in plan", JSON.stringify(absent))
    for (const p of [draftPlan, noSeats, softPlan, oldPlan]) await lc("plans.delete", "command", { id: p?.id })

    // generate, void, generate again
    const first = await lc("invoices.generate", "command", { subscription_id: id })
    check("a fresh subscription generates an invoice", body(first)?.status === "draft", JSON.stringify(first.body))
    check("voiding a draft invoice with a reason works", body(await lc("invoices.void", "command", { id: body(first)?.id, reason: "regenerate" }))?.status === "voided", "")
    const again = await lc("invoices.generate", "command", { subscription_id: id })
    check("generate after a void makes a new invoice", body(again)?.status === "draft" && typeof body(again)?.id === "string" && body(again).id !== body(first)?.id, JSON.stringify(again.body))

    // cancel, as the stores write it
    const later = await lc("subscriptions.cancel", "command", { id: "sub_hooli" })
    check("a cancel at period end sets cancel_at and leaves it running", body(later)?.status !== "canceled" && body(later)?.cancel_at === body(later)?.current_period_end && body(later)?.canceled_at === undefined && body(later)?.ended_at === undefined, JSON.stringify(later.body))
    const now = await lc("subscriptions.cancel", "command", { id, immediately: true })
    check("an immediate cancel ends it now, with cancel_at and canceled_at and no ended_at", body(now)?.status === "canceled" && typeof body(now)?.cancel_at === "string" && typeof body(now)?.canceled_at === "string" && body(now)?.ended_at === undefined, JSON.stringify(now.body))
    check("cancelling an ended subscription is CONFLICT", code(await lc("subscriptions.cancel", "command", { id, immediately: true })) === "CONFLICT", "")
    const umbrella = (await detailOf("sub_umbrella"))?.subscription
    check("the seed's canceled subscription has no ended_at", umbrella?.status === "canceled" && typeof umbrella.canceled_at === "string" && typeof umbrella.cancel_at === "string" && umbrella.ended_at === undefined, JSON.stringify(umbrella))

    const usage = body(await lc("subscriptions.usage", "query", { id: "sub_acme" }))
    const seats = usage?.features?.find((f) => f.key === "seats")
    check("subscriptions.usage reads seats from the quantity", seats?.used === 6, JSON.stringify(usage))
    const unlimited = usage?.features?.find((f) => f.key === "sso")
    check("a boolean feature reports enabled and remaining -1", unlimited?.enabled === true && unlimited.remaining === -1, JSON.stringify(unlimited))

    const gen = await lc("invoices.generate", "command", { subscription_id: "sub_initech" })
    check("invoices.generate answers a draft", body(gen)?.status === "draft" && Array.isArray(body(gen)?.line_items), JSON.stringify(gen.body))
    check("a second invoice for the same period is CONFLICT", code(await lc("invoices.generate", "command", { subscription_id: "sub_initech" })) === "CONFLICT", "")
    const invId = body(gen)?.id
    const finalized = body(await lc("invoices.finalize", "command", { id: invId }))
    check("finalize is visible in invoices.detail", body(await lc("invoices.detail", "query", { id: invId }))?.invoice?.status === "pending", "")
    const termDays = (Date.parse(finalized?.due_date) - Date.now()) / 86_400_000
    check("finalize sets a due date 30 days out", termDays > 29.9 && termDays < 30.1, JSON.stringify(finalized?.due_date))
    check("finalizing twice is CONFLICT", code(await lc("invoices.finalize", "command", { id: invId })) === "CONFLICT", "")
    check("void without a reason is BAD_REQUEST", code(await lc("invoices.void", "command", { id: invId })) === "BAD_REQUEST", "")
    check("void without a reason is checked before the invoice is loaded", code(await lc("invoices.void", "command", { id: "inv_missing" })) === "BAD_REQUEST", "")
    await lc("invoices.markPaid", "command", { id: invId, payment_ref: "  ch_spot  " })
    const paid = body(await lc("invoices.detail", "query", { id: invId }))?.invoice
    check("markPaid trims the reference and stamps paid_at", paid?.status === "paid" && paid.payment_ref === "ch_spot" && typeof paid.paid_at === "string", JSON.stringify(paid))
    check("voiding a paid invoice is CONFLICT", code(await lc("invoices.void", "command", { id: invId, reason: "x" })) === "CONFLICT", "")
    const exported = body(await lc("invoices.export", "query", { id: invId, format: "csv" }))
    check("invoices.export answers base64 csv", Buffer.from(exported?.content ?? "", "base64").toString("utf8").startsWith("description,"), JSON.stringify(exported))
    check("an unregistered export format is BAD_REQUEST", code(await lc("invoices.export", "query", { id: invId, format: "pdf" })) === "BAD_REQUEST", "")

    // usage.events: the id tie-break across pages, and the half-open window.
    const walked = []
    for (let offset = 0; offset < 400; offset += 2) {
      const pageOf = body(await lc("usage.events", "query", { tenant_id: "acme", limit: 2, offset }))
      walked.push(...(pageOf?.items ?? []).map((i) => i.id))
      if (!pageOf?.has_more) break
    }
    const inBatch = walked.filter((e) => e.startsWith("evt_batch_"))
    check("paging by 2 shows each event of a single-instant batch exactly once, id descending", inBatch.join(",") === "evt_batch_3,evt_batch_2,evt_batch_1" && new Set(walked).size === walked.length, JSON.stringify(inBatch))
    const all = body(await lc("usage.events", "query", { tenant_id: "acme", limit: 200 }))
    const at = all?.items?.find((i) => i.id === "evt_batch_1")?.timestamp
    const inclusive = body(await lc("usage.events", "query", { tenant_id: "acme", limit: 200, start: at }))
    check("a window starting at the batch instant includes it", ["evt_batch_1", "evt_batch_2", "evt_batch_3"].every((e) => inclusive?.items?.some((i) => i.id === e)), at)
    const exclusive = body(await lc("usage.events", "query", { tenant_id: "acme", limit: 200, end: at }))
    check("a window ending at the batch instant excludes it", exclusive?.items?.length > 0 && !exclusive.items.some((i) => i.id.startsWith("evt_batch_")), at)
    const nobody = body(await lc("entitlements.check", "query", { tenant_id: "nobody", feature_key: "api_calls" }))
    check("no subscription is not allowed", nobody?.allowed === false && nobody.reason === "no active subscription", JSON.stringify(nobody))
    check("payment methods for a tenant with no subscription here are NOT_FOUND", code(await lc("paymentMethods.list", "query", { tenant_id: "nobody" })) === "NOT_FOUND", "")
    check("payment methods for acme are listed", body(await lc("paymentMethods.list", "query", { tenant_id: "acme" }))?.methods?.length === 2, "")
  }

  // ledger provider import: every importFromProvider files the record under
  // this app, answers the detail shape, refuses a second import, and reports
  // the provider's side as the Go contract does.
  {
    const lc = (intent, input) => dispatch("ledger", intent, "command", input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  ledger ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::ledger ${name}`, reason: detail })
    }
    const body = (r) => r.body?.data
    const code = (r) => r.body?.error?.code
    const message = (r) => r.body?.error?.message ?? ""

    const plan = await lc("plans.importFromProvider", { provider_id: "prod_scale" })
    check("an imported plan lands in this app with its provider id", body(plan)?.app_id === "app_ledger" && body(plan)?.provider_id === "prod_scale" && body(plan)?.provider_name === "stripe" && Array.isArray(body(plan)?.features), JSON.stringify(plan.body))
    check("plans.importFromProvider declares the manifest's invalidates", (plan.body?.meta?.invalidates ?? []).join(",") === "plans.list,overview.stats", JSON.stringify(plan.body?.meta))
    const planDetail = body(await dispatch("ledger", "plans.detail", "query", { id: body(plan)?.id }, csrf))
    check("the imported plan reads back through plans.detail", planDetail?.slug === "scale", JSON.stringify(planDetail))
    check("importing the same plan again is 409 CONFLICT", code(await lc("plans.importFromProvider", { provider_id: "prod_scale" })) === "CONFLICT", "")
    check("a provider plan whose slug this app uses is 409 CONFLICT", code(await lc("plans.importFromProvider", { provider_id: "prod_starter" })) === "CONFLICT", "")
    const slugMsg = message(await lc("plans.importFromProvider", { provider_id: "prod_starter" }))
    check("the slug conflict names the slug", slugMsg.includes('"starter"'), slugMsg)
    const againMsg = message(await lc("plans.importFromProvider", { provider_id: "prod_scale" }))
    check("importing a plan twice names the slug too", againMsg.includes('"scale"'), againMsg)
    const foreign = await lc("plans.importFromProvider", { provider_id: "prod_partner" })
    check("a provider plan filed under another app is 404 NOT_FOUND", foreign.status === 404 && code(foreign) === "NOT_FOUND", JSON.stringify(foreign.body))
    const unknown = await lc("plans.importFromProvider", { provider_id: "prod_nope" })
    check("an id the provider does not hold is 503 UNAVAILABLE in the provider's words", unknown.status === 503 && code(unknown) === "UNAVAILABLE" && message(unknown).includes("prod_nope"), JSON.stringify(unknown.body))
    check("a blank provider_id is 400 BAD_REQUEST", code(await lc("plans.importFromProvider", { provider_id: "  " })) === "BAD_REQUEST", "")
    const blank = await lc("plans.importFromProvider", { provider_id: "  " })
    check("a blank provider_id says provider_id is required", message(blank) === "provider_id is required", JSON.stringify(blank.body))
    check("an unknown provider_name is UNAVAILABLE", code(await lc("plans.importFromProvider", { provider_name: "paypal", provider_id: "prod_growth" })) === "UNAVAILABLE", "")

    const feature = await lc("features.importFromProvider", { provider_id: "mtr_webhooks" })
    check("an imported feature lands in this app's catalog", body(feature)?.app_id === "app_ledger" && body(feature)?.key === "webhooks", JSON.stringify(feature.body))
    check("features.importFromProvider declares the manifest's invalidates", (feature.body?.meta?.invalidates ?? []).join(",") === "features.list", JSON.stringify(feature.body?.meta))
    check("a provider feature whose key this app uses is 409 CONFLICT", code(await lc("features.importFromProvider", { provider_id: "mtr_api_calls" })) === "CONFLICT", "")
    const keyMsg = message(await lc("features.importFromProvider", { provider_id: "mtr_api_calls" }))
    check("the key conflict names the local feature", keyMsg.includes("feat_api_calls"), keyMsg)

    const sub = await lc("subscriptions.importFromProvider", { provider_id: "sub_1Wonka" })
    const subBody = body(sub)
    check("subscriptions.importFromProvider answers the detail shape", subBody?.subscription?.tenant_id === "wonka" && subBody?.plan?.id === "plan_pro" && Array.isArray(subBody?.applied_coupons), JSON.stringify(sub.body))
    check("subscriptions.importFromProvider declares the manifest's invalidates", (sub.body?.meta?.invalidates ?? []).join(",") === "subscriptions.list,overview.stats,entitlements.check,paymentMethods.list", JSON.stringify(sub.body?.meta))
    check("importing the same subscription again is 409 CONFLICT", code(await lc("subscriptions.importFromProvider", { provider_id: "sub_1Wonka" })) === "CONFLICT", "")
    const subDupMsg = message(await lc("subscriptions.importFromProvider", { provider_id: "sub_1Wonka" }))
    check("the subscription conflict names the local subscription", subDupMsg.includes(subBody?.subscription?.id ?? "no id"), subDupMsg)
    check("a subscription on a plan this app lacks is 400 BAD_REQUEST", code(await lc("subscriptions.importFromProvider", { provider_id: "sub_1Orphan" })) === "BAD_REQUEST", "")
    // The plans.activate row ran earlier, so archive plan_enterprise again to have an inactive plan to import onto, then put it back.
    await lc("plans.archive", { id: "plan_enterprise" })
    const retired = await lc("subscriptions.importFromProvider", { provider_id: "sub_1Retired" })
    check("a subscription on an inactive plan is 400 BAD_REQUEST and says to activate the plan", code(retired) === "BAD_REQUEST" && message(retired).includes("activate plan enterprise"), JSON.stringify(retired.body))
    await lc("plans.activate", { id: "plan_enterprise" })

    const inv = await lc("invoices.importFromProvider", { provider_id: "in_1AcmeB" })
    const invBody = body(inv)
    check("invoices.importFromProvider answers the detail shape with line item ids", invBody?.invoice?.provider_id === "in_1AcmeB" && invBody?.subscription?.id === "sub_acme" && Array.isArray(invBody?.export_formats) && invBody.invoice.line_items.length > 0 && invBody.invoice.line_items.every((l) => l.id && l.invoice_id === invBody.invoice.id), JSON.stringify(inv.body))
    check("invoices.importFromProvider declares the manifest's invalidates", (inv.body?.meta?.invalidates ?? []).join(",") === "invoices.list,invoices.pending,subscriptions.detail,overview.stats,overview.recentInvoices", JSON.stringify(inv.body?.meta))
    check("importing the same invoice again is 409 CONFLICT", code(await lc("invoices.importFromProvider", { provider_id: "in_1AcmeB" })) === "CONFLICT", "")
    const invDupMsg = message(await lc("invoices.importFromProvider", { provider_id: "in_1AcmeB" }))
    check("the invoice conflict names the local invoice", invDupMsg.includes(invBody?.invoice?.id ?? "no id"), invDupMsg)
    check("an invoice for a subscription this app lacks is 400 BAD_REQUEST", code(await lc("invoices.importFromProvider", { provider_id: "in_1Orphan" })) === "BAD_REQUEST", "")
    const badTotals = await lc("invoices.importFromProvider", { provider_id: "in_1BadTotals" })
    check("an invoice whose total does not add up is 400 BAD_REQUEST", code(badTotals) === "BAD_REQUEST" && message(badTotals).includes("has a total of"), JSON.stringify(badTotals.body))
  }

  // ledger final review: the refusals and seed rows the whole-branch review asked
  // for. Another app's rows, malformed ids, shared features written from an app,
  // the import checks the engine gained, and the coupon window filter.
  {
    const lc = (intent, kind, input) => dispatch("ledger", intent, kind, input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  ledger ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::ledger ${name}`, reason: detail })
    }
    const body = (r) => r.body?.data
    const code = (r) => r.body?.error?.code
    const message = (r) => r.body?.error?.message ?? ""

    // I2: every app-scoped write to a shared feature is PERMISSION_DENIED, and another app's feature stays NOT_FOUND.
    const SHARED = "shared features can be changed only with no app selected"
    for (const [intent, input] of [
      ["features.update", { id: "feat_support_hours", name: "x" }],
      ["features.archive", { id: "feat_support_hours" }],
      ["features.delete", { id: "feat_support_hours" }],
      ["features.syncToProvider", { id: "feat_support_hours" }],
    ]) {
      const r = await lc(intent, "command", input)
      check(`${intent} on a shared feature from an app is 403 PERMISSION_DENIED`, r.status === 403 && code(r) === "PERMISSION_DENIED" && message(r) === SHARED, JSON.stringify(r.body))
    }
    const stillShared = body(await lc("features.detail", "query", { id: "feat_support_hours" }))
    check("the refused writes left the shared feature as it was", stillShared?.name === "Support hours" && stillShared?.status === "active", JSON.stringify(stillShared))
    const otherFeatureWrite = await lc("features.update", "command", { id: "feat_other_exports", name: "x" })
    check("another app's feature is still 404 NOT_FOUND to a write", otherFeatureWrite.status === 404 && code(otherFeatureWrite) === "NOT_FOUND" && message(otherFeatureWrite) === "feature not found", JSON.stringify(otherFeatureWrite.body))
    const otherFeatureRead = await lc("features.detail", "query", { id: "feat_other_exports" })
    check("another app's feature is 404 NOT_FOUND to a read", otherFeatureRead.status === 404 && code(otherFeatureRead) === "NOT_FOUND", JSON.stringify(otherFeatureRead.body))

    // M18: rows another app owns read as not found, and never list.
    for (const [intent, input, what] of [
      ["plans.detail", { id: "plan_other" }, "plan"],
      ["subscriptions.detail", { id: "sub_outsider" }, "subscription"],
      ["invoices.detail", { id: "inv_outsider_1" }, "invoice"],
    ]) {
      const r = await lc(intent, "query", input)
      check(`${intent} for another app's ${what} is 404 NOT_FOUND`, r.status === 404 && code(r) === "NOT_FOUND" && message(r) === `${what} not found`, JSON.stringify(r.body))
    }
    const foreignWrite = await lc("plans.update", "command", { id: "plan_other", name: "x" })
    check("plans.update on another app's plan is 404 NOT_FOUND", foreignWrite.status === 404 && code(foreignWrite) === "NOT_FOUND", JSON.stringify(foreignWrite.body))
    const foreignSub = await lc("subscriptions.create", "command", { tenant_id: "verify-foreign", plan_id: "plan_other" })
    check("subscriptions.create on another app's plan is 404 NOT_FOUND 'plan not found'", foreignSub.status === 404 && code(foreignSub) === "NOT_FOUND" && message(foreignSub) === "plan not found", JSON.stringify(foreignSub.body))
    const foreignChange = await lc("subscriptions.changePlan", "command", { id: "sub_acme", plan_id: "plan_other" })
    check("subscriptions.changePlan onto another app's plan is 404 NOT_FOUND", foreignChange.status === 404 && code(foreignChange) === "NOT_FOUND", JSON.stringify(foreignChange.body))
    const foreignGenerate = await lc("invoices.generate", "command", { subscription_id: "sub_outsider" })
    check("invoices.generate for another app's subscription is 404 NOT_FOUND", foreignGenerate.status === 404 && code(foreignGenerate) === "NOT_FOUND", JSON.stringify(foreignGenerate.body))
    const allPlans = body(await lc("plans.list", "query", { limit: 200 }))
    const allSubs = body(await lc("subscriptions.list", "query", { limit: 200 }))
    const allInvoices = body(await lc("invoices.list", "query", { limit: 200 }))
    const allFeatures = body(await lc("features.list", "query", { limit: 200 }))
    check("another app's plan, subscription, invoice and feature never list", !allPlans?.items?.some((p) => p.app_id !== "app_ledger") && !allSubs?.items?.some((x) => x.app_id !== "app_ledger") && !allInvoices?.items?.some((x) => x.app_id !== "app_ledger") && !allFeatures?.items?.some((f) => f.id === "feat_other_exports"), JSON.stringify({ plans: allPlans?.items?.length, subs: allSubs?.items?.length, invoices: allInvoices?.items?.length, features: allFeatures?.items?.length }))

    // M17: a malformed id, or one with another entity's prefix, is BAD_REQUEST naming the field.
    for (const [intent, input, want] of [
      ["plans.detail", { id: "sub_acme" }, "id is not a valid id: sub_acme"],
      ["plans.detail", { id: "plan_" }, "id is not a valid id: plan_"],
      ["subscriptions.detail", { id: "plan_pro" }, "id is not a valid id: plan_pro"],
      ["invoices.detail", { id: "nonsense" }, "id is not a valid id: nonsense"],
      ["coupons.detail", { id: "inv_acme_4" }, "id is not a valid id: inv_acme_4"],
      ["features.detail", { id: "plan_pro" }, "id is not a valid id: plan_pro"],
    ]) {
      const r = await lc(intent, "query", input)
      check(`${intent} with id ${JSON.stringify(input.id)} is 400 BAD_REQUEST '${want}'`, r.status === 400 && code(r) === "BAD_REQUEST" && message(r) === want, JSON.stringify(r.body))
    }
    const badPlanField = await lc("subscriptions.create", "command", { tenant_id: "verify-bad-id", plan_id: "sub_acme" })
    check("subscriptions.create names plan_id when it is not a plan id", badPlanField.status === 400 && message(badPlanField) === "plan_id is not a valid id: sub_acme", JSON.stringify(badPlanField.body))
    const missingStillNotFound = await lc("plans.detail", "query", { id: "plan_missing" })
    check("a well-formed id nothing holds is still 404 NOT_FOUND", missingStillNotFound.status === 404 && code(missingStillNotFound) === "NOT_FOUND", JSON.stringify(missingStillNotFound.body))

    // M16: coupons.list {active: true} filters on the validity window only, so an exhausted coupon inside its window still lists.
    const window = body(await lc("coupons.list", "query", { active: true, limit: 200 }))?.items?.map((c) => c.code) ?? []
    check("coupons.list active keeps an exhausted coupon inside its window", window.includes("BETA100") && window.includes("WELCOME10"), JSON.stringify(window))
    check("coupons.list active drops a coupon that has not started", !window.includes("SPRING15"), JSON.stringify(window))
    const past = await lc("coupons.create", "command", { code: "VERIFYGONE", name: "Gone", type: "percentage", percentage: 5, valid_until: new Date(Date.now() - 86_400_000).toISOString() })
    const windowAfter = body(await lc("coupons.list", "query", { active: true, limit: 200 }))?.items?.map((c) => c.code) ?? []
    check("coupons.list active drops a coupon whose window has closed", body(past) !== undefined && !windowAfter.includes("VERIFYGONE"), JSON.stringify({ created: past.body, listed: windowAfter }))
    if (body(past)?.id) await lc("coupons.delete", "command", { id: body(past).id })

    // I1, M4, M5: the engine's import refusals, in its words.
    const odd = await lc("invoices.importFromProvider", "command", { provider_id: "in_1OddLine" })
    check("an imported invoice line of unknown type is 400 BAD_REQUEST", odd.status === 400 && code(odd) === "BAD_REQUEST" && message(odd) === "ledger: invalid input: the provider's invoice has line item 2 of unknown type \"subscription\"", JSON.stringify(odd.body))
    const blankType = await lc("invoices.importFromProvider", "command", { provider_id: "in_1BlankLine" })
    check("an imported invoice line with no type is refused the same way", blankType.status === 400 && message(blankType) === "ledger: invalid input: the provider's invoice has line item 1 of unknown type \"\"", JSON.stringify(blankType.body))
    const storedOdd = body(await lc("invoices.list", "query", { limit: 200 }))?.items?.some((i) => i.provider_id === "in_1OddLine" || i.provider_id === "in_1BlankLine")
    check("a refused invoice import stores nothing", storedOdd === false, String(storedOdd))
    const noEnd = await lc("subscriptions.importFromProvider", "command", { provider_id: "sub_1NoEnd" })
    check("an imported subscription with a start and no end is 400 BAD_REQUEST", noEnd.status === 400 && message(noEnd) === "ledger: invalid input: the provider's subscription \"sub_1NoEnd\" needs both a period start and a period end", JSON.stringify(noEnd.body))
    const backwards = await lc("subscriptions.importFromProvider", "command", { provider_id: "sub_1Backwards" })
    check("an imported subscription whose period ends before it starts is 400 BAD_REQUEST", backwards.status === 400 && message(backwards) === "ledger: invalid input: the provider's subscription \"sub_1Backwards\" ends its period before it starts", JSON.stringify(backwards.body))
    const draft = await lc("features.importFromProvider", "command", { provider_id: "mtr_draft" })
    check("an imported feature that is a draft says it imports as active or archived", draft.status === 400 && message(draft) === "ledger: invalid input: a feature imports as active or archived, not \"draft\"", JSON.stringify(draft.body))
  }

  // chronicle: the four chains verify differently, and the switches change
  // what is reachable. Checks that assume the app-wide viewer say so and are
  // skipped when the server runs as a tenant viewer.
  if (chronicleMode) {
    const cc = (intent, kind, input) => dispatch("chronicle", intent, kind, input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  chronicle ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::chronicle ${name}`, reason: detail })
    }
    const skip = (name, why) => console.log(`  chronicle ${name}: skipped (${why})`)
    const data = (r) => r.body?.data
    const code = (r) => r.body?.error?.code
    const mode = chronicleMode
    console.log(
      `  chronicle mode: ${mode.tenant ? "tenant viewer" : "app-wide viewer"}, ${mode.checkpoints ? "checkpoints" : "no checkpoints"}, ${mode.tenant ? "acme chain" : mode.ownChain ? "own chain" : "no own chain"}, ${mode.erasure ? "erasure" : "no erasure"}`,
    )

    if (mode.tenant) {
      skip("the four-chain verify checks", "tenant viewer: only acme's chain is reachable")
      const streams = data(await cc("streams.list", "query", {}))
      check("a tenant viewer owns one chain, acme's", streams?.total === 1 && streams.streams[0].tenantId === "acme", JSON.stringify(streams))
      const other = await cc("verify.run", "query", { streamId: "stream_globex" })
      check("a tenant viewer cannot verify another tenant's chain", other.status === 404 && code(other) === "NOT_FOUND", JSON.stringify(other.body))
      const policies = data(await cc("retention.policies", "query", {}))
      const app = policies?.policies?.find((p) => p.id === "retpol_app_all")
      const own = policies?.policies?.find((p) => p.id === "retpol_acme_debug")
      check("a governing app-level policy is listed after the tenant's own, not editable", app?.editable === false && own?.editable === true && policies.policies.indexOf(own) < policies.policies.indexOf(app), JSON.stringify(policies))
      const edit = await cc("retention.savePolicy", "command", { id: "retpol_app_all", archive: true })
      check("saving an app-level policy as a tenant is NOT_FOUND", edit.status === 404 && code(edit) === "NOT_FOUND", JSON.stringify(edit.body))
      const del = await cc("retention.deletePolicy", "command", { id: "retpol_app_all" })
      check("deleting an app-level policy as a tenant is NOT_FOUND", del.status === 404 && code(del) === "NOT_FOUND", JSON.stringify(del.body))
      const preview = data(await cc("retention.preview", "query", {}))
      check("a tenant preview counts the governing app-level policies", preview?.governingAppPolicies === 1, JSON.stringify(preview))
      const all = data(await cc("events.list", "query", { limit: 1000 }))
      check("a tenant viewer sees only acme's events", all?.events?.length > 0 && all.events.every((e) => e.id.startsWith("audit_acme_")), `${all?.events?.length} events`)
    } else if (!mode.ownChain) {
      const mine = data(await cc("streams.mine", "query", {}))
      check("with no own chain streams.mine answers {}", JSON.stringify(mine) === "{}", JSON.stringify(mine))
      const verify = data(await cc("verify.run", "query", {}))
      check("with no own chain verify.run answers noChain", verify?.noChain === true && verify.report === undefined, JSON.stringify(verify))
      const streams = data(await cc("streams.list", "query", {}))
      check("the tenants' chains are still listed", streams?.total === 3 && streams.streams.every((s) => s.tenantId), JSON.stringify(streams?.streams?.map((s) => s.id)))
      const take = mode.checkpoints ? await cc("checkpoints.take", "command", {}) : undefined
      if (take) check("with no own chain checkpoints.take is NOT_FOUND", take.status === 404 && code(take) === "NOT_FOUND", JSON.stringify(take.body))
    } else {
      const plain = data(await cc("verify.run", "query", { streamId: "stream_app" }))?.report
      check(
        "the plain chain verifies, at the unkeyed level only",
        plain?.valid === true && plain.verified > 0 && plain.coverage?.length > 0 && plain.coverage.every((c) => c.level === "unkeyed"),
        JSON.stringify(plain),
      )

      const split = data(await cc("verify.run", "query", { streamId: "stream_acme", fromSeq: 48000, toSeq: 48400 }))?.report
      check(
        "the mixed chain's coverage splits at the pin, 48201",
        split?.coverage?.[0]?.level === "unkeyed" && split.coverage[0].toSeq === 48200 && split.coverage[1]?.fromSeq === 48201 && split.coverage[1].level !== "unkeyed",
        JSON.stringify(split?.coverage),
      )

      const broken = data(await cc("verify.run", "query", { streamId: "stream_globex" }))?.report
      check(
        "the broken chain fails, naming its gaps, tampering, downgrade and retained range",
        broken?.valid === false &&
          JSON.stringify(broken.gaps) === "[2311,2312]" &&
          JSON.stringify(broken.tampered) === "[2780]" &&
          JSON.stringify(broken.downgrades) === "[2901]" &&
          broken.retained?.length === 1 && broken.retained[0].fromSeq === 101 && broken.retained[0].toSeq === 400 && broken.retained[0].recordSeq === 401,
        JSON.stringify(broken),
      )

      const truncated = data(await cc("verify.run", "query", { streamId: "stream_initech" }))?.report
      if (mode.checkpoints) {
        check(
          "the truncated chain fails on its head and on its last checkpoint",
          truncated?.valid === false && truncated.headMatch === false && truncated.checkpointHeadOk === false && truncated.checkpointHeadChecked === true,
          JSON.stringify(truncated),
        )
      } else {
        // Without checkpoints the past-head checkpoint does not exist, so only the head check can fail.
        check(
          "the truncated chain fails on its head (no checkpoints to check)",
          truncated?.valid === false && truncated.headMatch === false && truncated.checkpointHeadChecked === false && truncated.checkpointsChecked === false,
          JSON.stringify(truncated),
        )
      }

      const gapHour = "2026-09-28T03:00:00Z"
      const hours = data(await cc("events.aggregate", "query", { groupBy: ["hour"] }))
      const buckets = (hours?.groups ?? []).map((g) => g.bucket)
      check(
        "the hourly volume has no group for the empty hour, with events either side of it",
        buckets.includes("2026-09-28T02:00:00Z") && buckets.includes("2026-09-28T04:00:00Z") && !buckets.includes(gapHour),
        JSON.stringify(buckets.filter((b) => b.startsWith("2026-09-28"))),
      )

      const tooLong = await cc("verify.run", "query", { streamId: "stream_acme", fromSeq: 1, toSeq: 200000 })
      check(
        "a verify range over the cap is BAD_REQUEST with the server's message",
        tooLong.status === 400 && code(tooLong) === "BAD_REQUEST" && tooLong.body.error.message.includes("exceeds the 100000-event limit") && tooLong.body.error.message.includes("head is at sequence 61004"),
        JSON.stringify(tooLong.body),
      )

      const own = data(await cc("events.detail", "query", { id: "audit_own_12400" }))
      const victim = data(await cc("events.detail", "query", { id: "audit_own_12401" }))
      check(
        "the erased marker is evidence only beside an erasure id",
        own?.erased === true && own.erasureId === "erasure_1" && victim?.reason === "[ERASED]" && victim.erased === false && victim.erasureId === undefined,
        JSON.stringify({ own, victim }),
      )
      check(
        "an erased row reads its sealed fields as the marker and has no metadata, as markErased leaves it",
        own?.ip === "[ERASED]" && own.reason === "[ERASED]" && own.userAgent === "[ERASED]" && own.metadata === undefined,
        JSON.stringify(own),
      )

      const recent = data(await cc("verify.run", "query", { streamId: "stream_acme", fromSeq: 51005, toSeq: 61004 }))?.report
      check(
        "the default window ends at the head but is partial, so the head is not checked",
        recent?.valid === true && recent.partial === true && recent.headChecked === false,
        JSON.stringify(recent),
      )
      const wholeAcme = data(await cc("verify.run", "query", { streamId: "stream_acme" }))?.report
      check(
        "a whole-chain check is not partial and checks the head",
        wholeAcme?.valid === true && wholeAcme.partial === false && wholeAcme.headChecked === true && wholeAcme.headMatch === true,
        JSON.stringify(wholeAcme),
      )
    }

    if (mode.checkpoints) {
      const take = await cc("checkpoints.take", "command", { streamId: mode.tenant ? "stream_acme" : "stream_initech" })
      check("checkpoints.take declares the manifest's invalidates", (take.body?.meta?.invalidates ?? []).join(",") === "checkpoints.list,streams.mine,streams.list,verify.run", JSON.stringify(take.body?.meta))
      const cps = data(await cc("checkpoints.list", "query", { streamId: "stream_acme" }))
      check("checkpoints.list is supported and lists newest first", cps?.supported === true && Array.isArray(cps.checkpoints) && cps.checkpoints.length > 1 && cps.checkpoints[0].toSeq > cps.checkpoints[1].toSeq, JSON.stringify(cps))
    } else {
      const cps = data(await cc("checkpoints.list", "query", {}))
      check("without checkpoints, checkpoints.list is unsupported with a null list", cps?.supported === false && cps.checkpoints === null, JSON.stringify(cps))
      const take = await cc("checkpoints.take", "command", {})
      check("without checkpoints, checkpoints.take is UNAVAILABLE", code(take) === "UNAVAILABLE", JSON.stringify(take.body))
      const streams = data(await cc("streams.list", "query", {}))
      check("without checkpoints, no stream reaches the signed ceiling", streams?.streams?.every((s) => s.coverageCeiling !== "signed" && s.checkpointingConfigured === false && s.latestCheckpoint === undefined), JSON.stringify(streams?.streams?.map((s) => s.coverageCeiling)))
      const settings = data(await cc("settings.detail", "query", {}))
      check("without checkpoints, settings say checkpointing is not configured", settings?.checkpointingConfigured === false, JSON.stringify(settings))
      const rep = data(await cc("verify.run", "query", {}))?.report
      check("without checkpoints, a verify run checks no checkpoints and never reaches signed", rep === undefined || (rep.checkpointsChecked === false && rep.checkpointHeadChecked === false && (rep.coverage ?? []).every((c) => c.level !== "signed")), JSON.stringify(rep))
    }

    const noErasure = await cc("erasures.request", "command", { subjectId: "subject_3", reason: "spot check" })
    if (mode.erasure) {
      check("erasures.request answers the result, key destroyed", data(noErasure)?.keyDestroyed === true && data(noErasure)?.legacyKeyRetained === false, JSON.stringify(noErasure.body))
      // subject_3's events: one on the own chain, or acme's when the viewer cannot see the own chain.
      const hitId = mode.tenant || !mode.ownChain ? "audit_acme_61002" : "audit_own_12430"
      const hit = data(await cc("events.detail", "query", { id: hitId }))
      check(
        "an erasure marks the sealed fields that held something, leaves an empty one empty and drops the metadata",
        hit?.erased === true && hit.ip === "[ERASED]" && hit.userAgent === "[ERASED]" && hit.reason === undefined && hit.metadata === undefined,
        JSON.stringify(hit),
      )
      const empty = await cc("erasures.request", "command", { subjectId: "", reason: "x" })
      check("an empty subjectId is BAD_REQUEST with the Go message", code(empty) === "BAD_REQUEST" && empty.body.error.message === "subjectId is required", JSON.stringify(empty.body))
      const blank = await cc("erasures.request", "command", { subjectId: "subject_3", reason: "   " })
      check("a blank reason is BAD_REQUEST", code(blank) === "BAD_REQUEST" && blank.body.error.message === "reason is required", JSON.stringify(blank.body))
      const legacy = await cc("erasures.request", "command", { subjectId: "legacy-user", reason: "spot check" })
      check("a subject whose key is shared answers legacyKeyRetained", data(legacy)?.keyDestroyed === false && data(legacy)?.legacyKeyRetained === true, JSON.stringify(legacy.body))
    } else {
      check("without erasure, erasures.request is UNAVAILABLE before it reads the input", noErasure.status === 503 && code(noErasure) === "UNAVAILABLE", JSON.stringify(noErasure.body))
      const settings = data(await cc("settings.detail", "query", {}))
      check("without erasure, settings say crypto erasure is off", settings?.enableCryptoErasure === false, JSON.stringify(settings))
    }

    const badDuration = await cc("retention.savePolicy", "command", { category: "spot", duration: "soon" })
    check("an unparseable duration is BAD_REQUEST", code(badDuration) === "BAD_REQUEST" && badDuration.body.error.message === "duration is not a valid duration, such as 720h", JSON.stringify(badDuration.body))
    const zero = await cc("retention.savePolicy", "command", { category: "spot", duration: "0s" })
    check("a zero duration is BAD_REQUEST", code(zero) === "BAD_REQUEST" && zero.body.error.message.startsWith("duration must be greater than zero"), JSON.stringify(zero.body))
    const made = await cc("retention.savePolicy", "command", { category: "spot", duration: "90m" })
    check("a policy's duration round-trips as a Go duration string", data(made)?.duration === "1h30m0s" && data(made)?.editable === true, JSON.stringify(made.body))
    const twice = await cc("retention.savePolicy", "command", { category: "spot", duration: "1h" })
    check("a second policy for a category in the same scope is 409 CONFLICT", twice.status === 409 && code(twice) === "CONFLICT", JSON.stringify(twice.body))
    const recat = await cc("retention.savePolicy", "command", { id: data(made)?.id, category: "other" })
    check("a policy's category cannot change", code(recat) === "BAD_REQUEST" && recat.body.error.message.startsWith("a policy's category cannot be changed"), JSON.stringify(recat.body))
    await cc("retention.deletePolicy", "command", { id: data(made)?.id })

    const enforce = await cc("retention.enforce", "command", {})
    check(
      "retention.enforce declares the manifest's invalidates",
      (enforce.body?.meta?.invalidates ?? []).join(",") === "retention.policies,retention.archives,retention.preview,events.list,events.detail,events.aggregate,events.byUser,overview.stats,verify.run,verify.event,erasures.preview",
      JSON.stringify(enforce.body?.meta),
    )
    const after = data(await cc("retention.preview", "query", {}))
    check("after an enforce pass nothing eligible remains", after?.eventCount === 0 && enforce.body?.data?.moreRemain === false, JSON.stringify({ enforce: enforce.body?.data, after }))

    const html = data(await cc("reports.export", "query", { id: "report_soc2", format: "html" }))
    check("an html export is a document with a script tag in it", html?.filename === "report-report_soc2.html" && html.contentType === "text/html; charset=utf-8" && html.content.includes("<script>"), JSON.stringify(html?.filename))
    const md = data(await cc("reports.export", "query", { id: "report_soc2", format: "markdown" }))
    check("a markdown export carries an action with a pipe in it", md?.content?.includes("role.grant|revoke") === true, "no pipe action")
    const badFormat = await cc("reports.export", "query", { id: "nope", format: "pdf" })
    check("an unknown export format is BAD_REQUEST before the lookup", code(badFormat) === "BAD_REQUEST" && badFormat.body.error.message === 'format must be one of "json", "csv", "markdown" or "html"', JSON.stringify(badFormat.body))
    const legacyReport = data(await cc("reports.detail", "query", { id: "report_soc2" }))
    check("a verified report says it was capped, and stored no policy count", legacyReport?.verificationScope?.capped === true && legacyReport.verification?.retentionPolicies === -1, JSON.stringify(legacyReport?.verificationScope))
    if (!mode.tenant) {
      const hipaa = data(await cc("reports.detail", "query", { id: "report_hipaa" }))
      check("the legacy report has no verification and no scope", hipaa && !("verification" in hipaa) && !("verificationScope" in hipaa), JSON.stringify(Object.keys(hipaa ?? {})))
    }
    const badGroup = await cc("events.aggregate", "query", { groupBy: ["day", "hour"] })
    check("two time buckets are BAD_REQUEST with ResolveGroupBy's message", code(badGroup) === "BAD_REQUEST" && badGroup.body.error.message === 'group_by names more than one time bucket field: "day" and "hour"', JSON.stringify(badGroup.body))
    const capped = data(await cc("events.list", "query", { limit: 5000 }))
    check("an events.list limit over 1000 is capped, not refused", capped !== undefined && capped.events.length <= 1000, `${capped?.events?.length}`)
    const negative = await cc("events.list", "query", { limit: -1 })
    check("a negative limit is BAD_REQUEST", code(negative) === "BAD_REQUEST" && negative.body.error.message === "limit and offset cannot be negative", JSON.stringify(negative.body))
  }

  // trove: writes change the next read and refusals are real. The intent loop
  // above wrote to the trove seed, so reset it (this also drops the CSRF
  // token, so fetch a new one) before asserting on exact state.
  {
    await fetch(`${base}/_fixture/reset`, { method: "POST" })
    const tcsrf = await getCSRF()
    const tq = (intent, input) => dispatch("trove", intent, "query", input, tcsrf)
    const tc = (intent, input) => dispatch("trove", intent, "command", input, tcsrf)
    const check = (name, ok, detail) => {
      console.log(`  trove ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::trove ${name}`, reason: detail })
    }
    const code = (r) => r.body?.error?.code
    const invalidates = (r) => (r.body?.meta?.invalidates ?? []).slice().sort().join(",")

    const created = await tc("buckets.create", { name: "verify-trove-2" })
    const buckets = await tq("buckets.list", {})
    check("buckets.create then buckets.list contains the new bucket", created.body?.ok === true && (buckets.body?.data?.buckets ?? []).some((b) => b.name === "verify-trove-2"), JSON.stringify(buckets.body?.data))
    const again = await tc("buckets.create", { name: "verify-trove-2" })
    check("buckets.create on an existing name is 409 CONFLICT", again.status === 409 && code(again) === "CONFLICT", `${again.status} ${code(again)}`)

    const full = await tc("buckets.delete", { name: "reports" })
    check("buckets.delete on a bucket with objects is 409 CONFLICT", full.status === 409 && code(full) === "CONFLICT", `${full.status} ${code(full)}`)
    const casDelete = await tc("buckets.delete", { name: "cas" })
    check("buckets.delete refuses the CAS bucket with 409 CONFLICT and the CAS message", casDelete.status === 409 && code(casDelete) === "CONFLICT" && /^CAS manages the cas bucket\./.test(casDelete.body?.error?.message ?? ""), `trove ${casDelete.status} ${code(casDelete)} ${casDelete.body?.error?.message}`)

    const first = await tq("objects.list", { bucket: "reports", limit: 1 })
    const cursor = first.body?.data?.nextCursor
    check("objects.list with limit 1 answers a nextCursor", typeof cursor === "string" && cursor.length > 0, JSON.stringify(first.body?.data))
    const second = await tq("objects.list", { bucket: "reports", limit: 1, cursor })
    const firstItem = first.body?.data?.objects?.[0]?.key ?? first.body?.data?.prefixes?.[0]
    const secondItem = second.body?.data?.objects?.[0]?.key ?? second.body?.data?.prefixes?.[0]
    check("passing the cursor back answers a different first item", typeof secondItem === "string" && secondItem !== firstItem, `${firstItem} then ${secondItem}`)
    const flat = await tq("objects.list", { bucket: "reports", delimiter: "" })
    check("objects.list with delimiter \"\" is flat: prefixes null, foldersSupported false", flat.body?.data?.prefixes === null && flat.body.data.foldersSupported === false && flat.body.data.objects.length === 5, JSON.stringify(flat.body?.data))
    const badCursor = await tq("objects.list", { bucket: "reports", cursor: "!!!" })
    check("objects.list with a malformed cursor is 400 BAD_REQUEST", badCursor.status === 400 && code(badCursor) === "BAD_REQUEST", `${badCursor.status} ${code(badCursor)}`)
    // trove: the logs bucket holds 450 keys under one prefix, so the browser's Load more pages for real.
    const trovePrefix = "2026/10/04/"
    const troveLogs = await tq("objects.list", { bucket: "logs", prefix: trovePrefix })
    check("objects.list on logs answers a default page of 100 and a nextCursor (trove paging seed)", troveLogs.body?.data?.objects?.length === 100 && typeof troveLogs.body.data.nextCursor === "string" && troveLogs.body.data.nextCursor !== "", `trove ${troveLogs.status} ${troveLogs.body?.data?.objects?.length} ${troveLogs.body?.data?.nextCursor}`)
    const troveLogKeys = (troveLogs.body?.data?.objects ?? []).map((o) => o.key)
    let troveLogCursor = troveLogs.body?.data?.nextCursor ?? null
    let troveLogPages = 1
    while (troveLogCursor !== null && troveLogPages < 20) {
      const trovePage = await tq("objects.list", { bucket: "logs", prefix: trovePrefix, cursor: troveLogCursor })
      troveLogKeys.push(...(trovePage.body?.data?.objects ?? []).map((o) => o.key))
      troveLogCursor = trovePage.body?.data?.nextCursor ?? null
      troveLogPages += 1
    }
    check("following objects.list cursors on logs reaches all 450 keys with no duplicate (trove paging seed)", troveLogKeys.length === 450 && new Set(troveLogKeys).size === 450 && troveLogCursor === null, `trove ${troveLogKeys.length} keys, ${new Set(troveLogKeys).size} distinct, ${troveLogPages} pages`)

    const blankStore = await tq("system.status", { store: "  " })
    check("system.status with a blank store is 400 BAD_REQUEST", blankStore.status === 400 && code(blankStore) === "BAD_REQUEST", `${blankStore.status} ${code(blankStore)}`)
    const unknownStore = await tq("system.status", { store: "nope" })
    check("system.status with an unknown store is 404 NOT_FOUND", unknownStore.status === 404 && code(unknownStore) === "NOT_FOUND", `${unknownStore.status} ${code(unknownStore)}`)
    const protoStore = await tq("system.status", { store: "constructor" })
    check("system.status with store \"constructor\" is 404 NOT_FOUND, not a prototype hit", protoStore.status === 404 && code(protoStore) === "NOT_FOUND" && protoStore.body?.error?.message === 'no store named "constructor"', `trove ${protoStore.status} ${code(protoStore)} ${protoStore.body?.error?.message}`)
    const archive = await tq("system.status", { store: "archive" })
    check("the archive store reports a routing note and the s3 driver", archive.body?.data?.driver === "s3" && typeof archive.body.data.routingNote === "string" && archive.body.data.backends?.[0] === "cold", JSON.stringify(archive.body?.data))
    const archiveCompression = (archive.body?.data?.flags ?? []).find((f) => f.name === "compression")
    check("the archive store's compression is applied with a scope note (trove protection flags)", archiveCompression?.applied === true && archiveCompression.configured === false && /Applies only where its scope matches: key\(\*\.log\)\. Objects outside that scope are not compressed\./.test(archiveCompression.note ?? ""), JSON.stringify(archiveCompression))
    const primaryStatus = await tq("system.status", {})
    const primaryCompression = (primaryStatus.body?.data?.flags ?? []).find((f) => f.name === "compression")
    check("the primary store's compression is applied with no note (trove global registration)", primaryCompression?.applied === true && primaryCompression.note === null, JSON.stringify(primaryCompression))

    const archiveCas = await tq("cas.list", { store: "archive" })
    check("cas.list on a store with no CAS is 503 UNAVAILABLE", archiveCas.status === 503 && code(archiveCas) === "UNAVAILABLE", `${archiveCas.status} ${code(archiveCas)}`)
    const localPresign = await tc("objects.presign", { bucket: "reports", key: "readme.txt" })
    check("objects.presign on the local store is 503 UNAVAILABLE", localPresign.status === 503 && code(localPresign) === "UNAVAILABLE", `${localPresign.status} ${code(localPresign)}`)

    // Writes show in the next read, and the invalidates are the manifest's.
    const copied = await tc("objects.copy", { srcBucket: "reports", srcKey: "readme.txt", dstBucket: "assets", dstKey: "spot.txt" })
    const assets = await tq("objects.list", { bucket: "assets" })
    check("objects.copy lands in the destination's next listing", copied.body?.ok === true && (assets.body?.data?.objects ?? []).some((o) => o.key === "spot.txt"), JSON.stringify(assets.body?.data))
    const copyAgain = await tc("objects.copy", { srcBucket: "reports", srcKey: "readme.txt", dstBucket: "assets", dstKey: "spot.txt" })
    check("objects.copy onto an existing key is 409 CONFLICT with details.exists", copyAgain.status === 409 && copyAgain.body?.error?.details?.exists === true, JSON.stringify(copyAgain.body))
    const begun = await tc("objects.beginUpload", { bucket: "reports", key: "spot/new.txt", size: 5, contentType: "text/plain" })
    check("objects.beginUpload answers the bare content path and a ticket", begun.body?.data?.url === "/dashboard/trove/content" && typeof begun.body.data.ticket === "string" && !begun.body.data.url.includes("?"), JSON.stringify(begun.body?.data))
    const exists = await tc("objects.beginUpload", { bucket: "reports", key: "readme.txt", size: 5 })
    check("objects.beginUpload onto an existing key is 409 CONFLICT", exists.status === 409 && code(exists) === "CONFLICT", `${exists.status} ${code(exists)}`)
    const casUpload = await tc("objects.beginUpload", { bucket: "cas", key: "x", size: 1 })
    check("objects.beginUpload into the CAS bucket is 409 CONFLICT", casUpload.status === 409 && code(casUpload) === "CONFLICT", `${casUpload.status} ${code(casUpload)}`)
    // Content routes: GET and PUT at the fixture's content path, honouring tickets.
    const origin = new URL(base).origin
    const link = await tq("objects.contentUrl", { bucket: "reports", key: "readme.txt" })
    const got = await fetch(`${origin}${link.body?.data?.url}`)
    const gotText = await got.text()
    check("trove content GET answers the object's bytes", got.status === 200 && gotText.startsWith("Reports land here"), `${got.status} ${gotText.slice(0, 40)}`)
    check(
      "trove content GET sends attachment, nosniff, sandbox and no-store",
      got.headers.get("content-disposition") === "attachment; filename*=UTF-8''readme.txt" &&
        got.headers.get("x-content-type-options") === "nosniff" &&
        got.headers.get("content-security-policy") === "sandbox" &&
        got.headers.get("cache-control") === "no-store",
      JSON.stringify(Object.fromEntries(got.headers)),
    )
    const odd = await tq("objects.contentUrl", { bucket: "reports", key: "q3 résumé #1.pdf" })
    const oddGot = await fetch(`${origin}${odd.body?.data?.url}`)
    await oddGot.arrayBuffer()
    check("trove content GET encodes an awkward filename with filename*", oddGot.headers.get("content-disposition") === `attachment; filename*=UTF-8''${encodeURIComponent("q3 résumé #1.pdf")}`, oddGot.headers.get("content-disposition"))
    const preview = await tq("objects.contentUrl", { bucket: "reports", key: "readme.txt", purpose: "preview", limit: 4 })
    const previewBytes = await (await fetch(`${origin}${preview.body?.data?.url}`)).arrayBuffer()
    check("trove content GET stops a preview at its limit", previewBytes.byteLength === 4, String(previewBytes.byteLength))
    const expiredToken = Buffer.from(JSON.stringify({ s: "primary", b: "reports", k: "readme.txt", o: "download", e: 1 })).toString("base64url")
    const expired = await fetch(`${origin}/dashboard/trove/content?t=${expiredToken}`)
    check("trove content GET refuses an expired ticket with 403", expired.status === 403, String(expired.status))
    const upTicket = await tc("objects.beginUpload", { bucket: "reports", key: "spot/put.txt", size: 5, contentType: "text/plain" })
    const getWithUpload = await fetch(`${origin}/dashboard/trove/content?t=${upTicket.body?.data?.ticket}`)
    check("trove content GET refuses an upload ticket with 403", getWithUpload.status === 403, String(getWithUpload.status))
    const putInQuery = await fetch(`${origin}/dashboard/trove/content?t=${upTicket.body?.data?.ticket}`, { method: "PUT", body: "hello" })
    check("trove content PUT refuses a ticket in the query with 403", putInQuery.status === 403, String(putInQuery.status))
    const putWithDownload = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": new URL(`${origin}${link.body?.data?.url}`).searchParams.get("t") } })
    check("trove content PUT refuses a download ticket with 403", putWithDownload.status === 403, String(putWithDownload.status))
    const tooBig = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello, world", headers: { "X-Trove-Ticket": upTicket.body?.data?.ticket } })
    check("trove content PUT refuses a body over the declared size with 413", tooBig.status === 413, String(tooBig.status))
    // trove: a large body must get a clean 413 every time, never a reset socket (EPIPE) mid-send.
    const troveBig = Buffer.alloc(3 * 1024 * 1024, 97)
    const troveBigOutcomes = []
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: troveBig, headers: { "X-Trove-Ticket": upTicket.body?.data?.ticket } })
        await r.arrayBuffer()
        troveBigOutcomes.push(r.status)
      } catch (e) {
        troveBigOutcomes.push(`trove fetch rejected: ${e?.cause?.code ?? e?.message}`)
      }
    }
    check("trove content PUT answers 413 to five 3 MB bodies in a row without a network error", troveBigOutcomes.every((o) => o === 413), JSON.stringify(troveBigOutcomes))
    // trove: every refusal of a large PUT reaches the client as its status (403 and 409 here), never as a reset.
    const troveBigPut = async (ticket) => {
      const out = []
      for (let i = 0; i < 5; i++) {
        try {
          const r = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: troveBig, headers: { "X-Trove-Ticket": ticket } })
          await r.arrayBuffer()
          out.push(r.status)
        } catch (e) {
          out.push(`trove fetch rejected: ${e?.cause?.code ?? e?.message}`)
        }
      }
      return out
    }
    const troveDownloadTicket = new URL(`${origin}${link.body?.data?.url}`).searchParams.get("t")
    const troveForbidden = await troveBigPut(troveDownloadTicket)
    check("trove content PUT answers 403 to five 3 MB bodies sent with a download ticket", troveForbidden.every((o) => o === 403), JSON.stringify(troveForbidden))
    const troveRaceTicket = await tc("objects.beginUpload", { bucket: "reports", key: "spot/put3.txt", size: 5 })
    await tc("objects.copy", { srcBucket: "reports", srcKey: "readme.txt", dstBucket: "reports", dstKey: "spot/put3.txt" })
    const troveConflicts = await troveBigPut(troveRaceTicket.body?.data?.ticket)
    check("trove content PUT answers 409 to five 3 MB bodies onto an existing key", troveConflicts.every((o) => o === 409), JSON.stringify(troveConflicts))
    const put = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": upTicket.body?.data?.ticket } })
    const putBody = await put.json()
    check("trove content PUT stores the body and answers key, storedSize and etag", put.status === 200 && putBody.key === "spot/put.txt" && putBody.storedSize === 5 && typeof putBody.etag === "string", JSON.stringify(putBody))
    const completed = await tc("objects.completeUpload", { bucket: "reports", key: "spot/put.txt" })
    const back = await tq("objects.contentUrl", { bucket: "reports", key: "spot/put.txt" })
    const backText = await (await fetch(`${origin}${back.body?.data?.url}`)).text()
    check("trove upload round trip: completeUpload sees it and GET returns the same bytes", completed.body?.ok === true && completed.body.data.contentType === "text/plain" && backText === "hello", backText)
    const racing = await tc("objects.beginUpload", { bucket: "reports", key: "spot/put2.txt", size: 5 })
    await tc("objects.copy", { srcBucket: "reports", srcKey: "spot/put.txt", dstBucket: "reports", dstKey: "spot/put2.txt" })
    const raced = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": racing.body?.data?.ticket } })
    check("trove content PUT onto a key that appeared since the ticket is 409", raced.status === 409, String(raced.status))
    const scanTicket = await tc("objects.beginUpload", { bucket: "reports", key: "spot/eicar.txt", size: 5 })
    const scanned = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": scanTicket.body?.data?.ticket } })
    check("trove content PUT answers 422 when the fixture's scan blocks a key containing eicar", scanned.status === 422, String(scanned.status))
    const posted = await fetch(`${origin}/dashboard/trove/content`, { method: "POST" })
    check("trove content route answers 405 with Allow for other methods", posted.status === 405 && posted.headers.get("allow") === "GET, PUT", `${posted.status} ${posted.headers.get("allow")}`)
    // The scope matcher (slice 3 deferral): key(*.log) matches a .log key and not a dump.
    const dumpMw = await tq("middleware.list", { store: "archive", bucket: "backups", key: "db/2026-09-29.dump" })
    const logMw = await tq("middleware.list", { store: "archive", bucket: "backups", key: "app.log" })
    check("trove scope matcher: key(*.log) skips a dump and matches a .log key", dumpMw.body?.data?.registrations?.[0]?.matchesWrite === false && logMw.body?.data?.registrations?.[0]?.matchesWrite === true, JSON.stringify([dumpMw.body?.data?.registrations, logMw.body?.data?.registrations]))
    const deleted = await tc("objects.delete", { bucket: "reports", key: "readme.txt" })
    const afterDelete = await tq("objects.head", { bucket: "reports", key: "readme.txt" })
    check("objects.delete makes the next objects.head 404 NOT_FOUND", deleted.body?.ok === true && afterDelete.status === 404 && code(afterDelete) === "NOT_FOUND", `${afterDelete.status} ${code(afterDelete)}`)
    const pinned = await tc("cas.pin", { hash: `sha256:${"a1".repeat(32)}` })
    const casAfter = await tq("cas.list", {})
    const pinnedRow = (casAfter.body?.data?.entries ?? []).find((e) => e.hash === `sha256:${"a1".repeat(32)}`)
    check("cas.pin shows in the next cas.list", pinned.body?.data?.pinned === true && pinnedRow?.pinned === true, JSON.stringify(pinnedRow))
    const orphan = (casAfter.body?.data?.entries ?? []).find((e) => e.indexed === false)
    check("cas.list carries a blob the index does not know, with null refCount and pinned", orphan?.refCount === null && orphan.pinned === null, JSON.stringify(orphan))
    const missingPin = await tc("cas.pin", { hash: "sha256:nope" })
    check("cas.pin on an unindexed hash is 404 NOT_FOUND", missingPin.status === 404 && code(missingPin) === "NOT_FOUND", `${missingPin.status} ${code(missingPin)}`)

    const wantInvalidates = [
      ["buckets.create", created, "buckets.list"],
      ["buckets.delete", await tc("buckets.delete", { name: "empty" }), "buckets.list,objects.list"],
      ["objects.delete", deleted, "cas.list,objects.head,objects.list"],
      ["objects.copy", copied, "objects.head,objects.list"],
      ["objects.beginUpload", begun, ""],
      ["objects.completeUpload", await tc("objects.completeUpload", { bucket: "reports", key: "2026/09/summary.json" }), "objects.head,objects.list"],
      ["objects.presign", await tc("objects.presign", { store: "archive", bucket: "backups", key: "db/2026-09-30.dump" }), ""],
      ["cas.pin", pinned, "cas.list"],
      ["cas.unpin", await tc("cas.unpin", { hash: `sha256:${"a1".repeat(32)}` }), "cas.list"],
      ["cas.gc", await tc("cas.gc", {}), "cas.list,cas.status"],
    ]
    for (const [intent, response, want] of wantInvalidates) {
      check(`${intent} declares the manifest's invalidates`, invalidates(response) === want, `${invalidates(response)} vs ${want}`)
    }
  }

  await verifySentinel({ dispatch, getCSRF, failures })
  await verifyHerald({ dispatch, getCSRF, failures })

  console.log(`\nFinal: ${passed + (failures.length === 0 ? 0 : 0)} handler calls verified, ${failures.length} total failures (including spot checks).`)

  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
