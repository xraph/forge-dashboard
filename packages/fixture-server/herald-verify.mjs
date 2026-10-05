// herald-verify.mjs: herald's inputs for verify.mjs's walk, and the rules the
// Go handlers enforce, checked over HTTP rather than "it answered".
// verify.mjs carries an import, `...HERALD_INPUT` and one call; everything
// else lives here so herald never edits the shared file twice.
import { HERALD_IDS as I } from "./herald-fixtures.mjs"

const CANARY = "sk_herald_verify_canary"

/** Inputs keyed "herald::<intent>". A missing key sends {}. */
export const HERALD_INPUT = {
  "herald::providers.detail": { id: I.smtp },
  "herald::templates.detail": { id: I.receipt },
  "herald::templates.resolve": { id: I.receipt, locale: "fr-CA" },
  "herald::templates.render": { templateId: I.receipt, content: { subject: "Hi {{.customer_name}}", html: "", text: "", title: "" }, data: { customer_name: "Ada", amount: "$12" } },
  "herald::messages.detail": { id: I.message },
  "herald::inbox.list": { userId: "usr_ada" },
  "herald::preferences.get": { userId: "usr_ada" },
  "herald::send.resolve": { channel: "email" },
  "herald::providers.create": { name: "Verify SMTP", channel: "email", driver: "smtp", priority: 5, enabled: true, credentials: { username: "verify", password: "verify-secret" }, settings: { host: "smtp.verify.test", port: "587" } },
  "herald::providers.update": { id: I.created.provider, name: "Verify SMTP renamed" },
  "herald::templates.create": { slug: "verify.notice", name: "Verify notice", channel: "email", category: "transactional", version: { locale: "en", subject: "Hello", text: "Hello" } },
  "herald::templates.update": { id: I.created.template, name: "Verify notice renamed" },
  "herald::versions.create": { templateId: I.created.template, locale: "fr", subject: "Bonjour", text: "Bonjour" },
  "herald::versions.update": { templateId: I.created.template, versionId: I.created.frVersion, active: false },
  "herald::versions.delete": { templateId: I.created.template, versionId: I.created.frVersion },
  "herald::send.test": { channel: "email", recipient: "ada@example.com", body: "Verify" },
  "herald::inbox.markRead": { id: I.notification },
  "herald::inbox.markAllRead": { userId: "usr_bo" },
  "herald::preferences.optOut": { userId: "usr_ada", type: "auth.welcome", channel: "email" },
  "herald::scopes.set": { scope: "user", scopeId: "usr_verify", emailProviderId: I.smtp },
  "herald::scopes.delete": { scope: "user", scopeId: "usr_verify" },
  "herald::inbox.delete": { id: I.notification2 },
  "herald::templates.delete": { id: I.created.template },
  "herald::providers.delete": { id: I.created.provider },
}

export async function verifyHerald({ dispatch, getCSRF, failures }) {
  const csrf = await getCSRF()
  const q = (intent, input = {}) => dispatch("herald", intent, "query", input, csrf)
  const c = (intent, input = {}) => dispatch("herald", intent, "command", input, csrf)
  const check = (name, ok, detail) => {
    ok = Boolean(ok)
    console.log(`  herald ${name}: ${ok}`)
    if (!ok) failures.push({ key: `spot-check::herald ${name}`, reason: typeof detail === "string" ? detail : JSON.stringify(detail) })
  }
  const data = (r) => r.body?.data
  const code = (r) => r.body?.error?.code

  const missing = await q("providers.detail", { id: "hpvd_01j00000000000000000099999" })
  const foreign = await q("providers.detail", { id: I.otherProvider })
  check("unknown provider is NOT_FOUND", code(missing) === "NOT_FOUND", missing.body)
  check("another app's provider is NOT_FOUND, same message", code(foreign) === "NOT_FOUND" && foreign.body?.error?.message === missing.body?.error?.message, foreign.body)

  const absent = (prefix) => `${prefix}_01j00000000000000000099999`
  const sameAsAbsent = (name, foreignResult, absentResult) =>
    check(`another app's ${name} is NOT_FOUND, same message`, code(foreignResult) === "NOT_FOUND" && foreignResult.body?.error?.message === absentResult.body?.error?.message, foreignResult.body)
  sameAsAbsent("template", await q("templates.detail", { id: I.otherTemplate }), await q("templates.detail", { id: absent("htpl") }))
  sameAsAbsent("message", await q("messages.detail", { id: I.otherMessage }), await q("messages.detail", { id: absent("hmsg") }))
  sameAsAbsent("notification", await c("inbox.markRead", { id: I.otherNotification }), await c("inbox.markRead", { id: absent("hinb") }))

  // Go's applyFrom falls back to the sms driver's own sender key when no rule sets a phone: twilio's from_number.
  const smsRoute = await q("send.resolve", { channel: "sms" })
  check("the sms route sends from Twilio's from_number: the app rule sets no phone", data(smsRoute)?.provider?.driver === "twilio" && data(smsRoute)?.via === "app" && data(smsRoute)?.from?.phone === "+15550100", smsRoute.body)
  // The chosen path takes From from the app rule, which the provider's own (empty) settings can't supply.
  const chosen = await q("send.resolve", { channel: "email", providerId: I.resendBackup })
  check("a chosen provider takes From from the app rule", data(chosen)?.via === "chosen" && data(chosen)?.from?.email === "hello@example.com" && data(chosen)?.from?.name === "Example", chosen.body)

  // A rule naming a disabled provider is skipped, as in Go's tryScope: the user rule below must not answer.
  const named = await c("scopes.set", { scope: "user", scopeId: "usr_disabled", emailProviderId: I.resendBackup })
  const skipped = await q("send.resolve", { channel: "email", userId: "usr_disabled" })
  check("a rule naming a disabled provider does not resolve via that rule", named.body?.ok === true && data(skipped)?.via === "app" && data(skipped)?.provider?.id === I.smtp, skipped.body)
  await c("scopes.delete", { scope: "user", scopeId: "usr_disabled" })

  const created = await c("providers.create", { name: "Canary SMTP", channel: "email", driver: "smtp", enabled: true, credentials: { password: CANARY }, settings: { host: "smtp.canary.test", port: "587" } })
  const id = data(created)?.provider?.id
  const detail = await q("providers.detail", { id })
  const list = await q("providers.list")
  check("a created provider is in the next list", data(list)?.providers?.some((p) => p.id === id), list.body)
  check("no read carries a credential value", ![created, detail, list].some((r) => JSON.stringify(r.body).includes(CANARY)), "canary found")
  check("the credential shows its protection only", data(detail)?.provider?.credentials?.some((x) => x.key === "password" && !("value" in x)), detail.body)

  const failed = await c("send.test", { channel: "email", recipient: "fail@example.com", body: "Hi" })
  check("a provider failure is a normal response with status failed", failed.body?.ok === true && data(failed)?.status === "failed" && Boolean(data(failed)?.error), failed.body)
  // Go writes type = the template slug and title = the rendered title, so a raw send leaves both empty.
  const rawInapp = await c("send.test", { channel: "inapp", recipient: "usr_raw", userId: "usr_raw", body: "Write it here" })
  const rawInbox = await q("inbox.list", { userId: "usr_raw" })
  check("a raw in-app send lands in the inbox with an empty title and type", data(rawInapp)?.status === "sent" && data(rawInbox)?.notifications?.length === 1 && data(rawInbox).notifications[0].title === "" && data(rawInbox).notifications[0].type === "", rawInbox.body)
  const both = await c("send.test", { channel: "email", recipient: "ada@example.com", template: "auth.welcome", body: "Hi" })
  check("a template plus a body is refused", code(both) === "BAD_REQUEST" && /not both/.test(both.body?.error?.message ?? ""), both.body)

  await c("preferences.optOut", { userId: "usr_new", type: "auth.welcome", channel: "sms" })
  const again = await c("preferences.optOut", { userId: "usr_new", type: "auth.welcome", channel: "sms" })
  check("opting out twice changes nothing", data(again)?.preference?.overrides?.["auth.welcome"]?.sms === false && data(again)?.preference?.overrides?.["auth.welcome"]?.email === null, again.body)

  const broken = await q("templates.render", { content: { subject: "", html: "<p>\n{{ nosuch .x }}</p>", text: "", title: "" }, data: {} })
  check("an unknown function is a parse diagnostic on its line", data(broken)?.diagnostics?.some((d) => d.kind === "parse" && d.field === "html" && d.line === 2 && /nosuch/.test(d.message)), broken.body)

  const first = await q("messages.list", { limit: 25 })
  const second = await q("messages.list", { limit: 25, cursor: data(first)?.nextCursor })
  const firstIds = new Set((data(first)?.messages ?? []).map((m) => m.id))
  const secondRows = data(second)?.messages ?? []
  check("messages page with a cursor and never repeat", Boolean(data(first)?.nextCursor) && secondRows.length > 0 && secondRows.every((m) => !firstIds.has(m.id)), second.body)

  const acme = (r) => data(r)?.rules?.find((x) => x.scope === "org" && x.scopeId === "org_acme")
  const ruleBefore = acme(await q("scopes.list"))
  const dangling = await c("scopes.set", { scope: "org", scopeId: "org_acme", fromName: "Acme Inc" })
  check("a rule naming a deleted provider can't be saved as it is", code(dangling) === "BAD_REQUEST" && /email_provider_id/.test(dangling.body?.error?.message ?? ""), dangling.body)
  const ruleAfterRefusal = acme(await q("scopes.list"))
  check("the refused save left the rule unchanged", Boolean(ruleBefore?.providers?.email?.dangling) && JSON.stringify(ruleAfterRefusal) === JSON.stringify(ruleBefore), { ruleBefore, ruleAfterRefusal })
  const cleared = await c("scopes.set", { scope: "org", scopeId: "org_acme", emailProviderId: "", fromName: "Acme Inc" })
  check("clearing the dangling slot saves the rule", cleared.body?.ok === true && !data(cleared)?.rule?.providers?.email, cleared.body)
  const ruleAfterClear = acme(await q("scopes.list"))
  check("the cleared rule reads back without its email slot and keeps the new name", Boolean(ruleAfterClear) && !ruleAfterClear.providers?.email && ruleAfterClear.fromName === "Acme Inc", ruleAfterClear)

  const blank = await c("providers.update", { id: I.twilio, setCredentials: { auth_token: "" } })
  const blankDetail = await q("providers.detail", { id: I.twilio })
  check("an empty credential value on update is ignored, not stored", blank.body?.ok === true && data(blankDetail)?.provider?.credentials?.map((x) => x.key).join() === "account_sid,auth_token", blankDetail.body)
  const blankNew = await c("providers.update", { id: I.twilio, setCredentials: { extra_token: "" } })
  const blankNewDetail = await q("providers.detail", { id: I.twilio })
  check("an empty value for a new key does not create it", blankNew.body?.ok === true && !data(blankNewDetail)?.provider?.credentials?.some((x) => x.key === "extra_token"), blankNewDetail.body)
}
