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

  const created = await c("providers.create", { name: "Canary SMTP", channel: "email", driver: "smtp", enabled: true, credentials: { password: CANARY }, settings: { host: "smtp.canary.test", port: "587" } })
  const id = data(created)?.provider?.id
  const detail = await q("providers.detail", { id })
  const list = await q("providers.list")
  check("a created provider is in the next list", data(list)?.providers?.some((p) => p.id === id), list.body)
  check("no read carries a credential value", ![created, detail, list].some((r) => JSON.stringify(r.body).includes(CANARY)), "canary found")
  check("the credential shows its protection only", data(detail)?.provider?.credentials?.some((x) => x.key === "password" && !("value" in x)), detail.body)

  const failed = await c("send.test", { channel: "email", recipient: "fail@example.com", body: "Hi" })
  check("a provider failure is a normal response with status failed", failed.body?.ok === true && data(failed)?.status === "failed" && Boolean(data(failed)?.error), failed.body)
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
  check("messages page with a cursor and never repeat", Boolean(data(first)?.nextCursor) && (data(second)?.messages ?? []).every((m) => !firstIds.has(m.id)), second.body)

  const dangling = await c("scopes.set", { scope: "org", scopeId: "org_acme", fromName: "Acme Inc" })
  check("a rule naming a deleted provider can't be saved as it is", code(dangling) === "BAD_REQUEST" && /email_provider_id/.test(dangling.body?.error?.message ?? ""), dangling.body)
  const cleared = await c("scopes.set", { scope: "org", scopeId: "org_acme", emailProviderId: "", fromName: "Acme Inc" })
  check("clearing the dangling slot saves the rule", cleared.body?.ok === true && !data(cleared)?.rule?.providers?.email, cleared.body)
}
