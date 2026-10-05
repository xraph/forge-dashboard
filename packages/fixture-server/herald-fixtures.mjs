// herald-fixtures.mjs: in-memory state and intent handlers for the herald
// contributor (packages/plugin-herald). Mirrors forgery/herald
// extension/contract at 0325975: field names are the Go JSON tags, refusals
// use the Go handlers' text in the Go handlers' order.
//
// Self-contained: it imports nothing from server.mjs. server.mjs hands over
// its FixtureError class, because the dispatcher tells a refusal from a crash
// with `instanceof` and a second copy of the class would never match.
//
// Credential values are never stored here, only each key's protection
// ("aes-256-gcm" or "plaintext"), so nothing this server answers can carry
// one.
//
// Where this differs from the real server, on purpose:
// - templates.render is an approximation for building the UI. It substitutes
//   {{.name}} (and upper, lower, title of one), flags a function Herald does
//   not have, an unclosed {{, and undeclared, missing or unprovided variables.
//   Everything else inside {{ }} renders as nothing. It is not a template
//   engine and must not become one: real rendering is proven by the Go
//   contract tests against Herald's own renderer.
// - engine.info lists a "legacy-sms" driver with no field schema
//   (fields:null) beside the five the extension registers, so the key/value
//   fallback form has something to render.
// - A chosen provider in send.resolve and send.test takes its sender from its
//   own settings, and a fallback provider from the app rule. Herald's
//   resolver is subtler; the page only displays what comes back.
// - send.test contacts nothing. A recipient containing "fail" takes the
//   provider-failure path, and a user opted out of the template on that
//   channel is "suppressed".
// - The forge transport answers every handler error with HTTP 500. This
//   server uses each code's own status. Pages branch on error.code either way.
// - Driver "missing required credential" texts all use double quotes; the
//   real drivers mix quote styles.
//
// Switches, read on every call so a running server can be flipped:
//   FIXTURE_HERALD_APP    the app the session resolves to. Default "app_demo".
//                         "" is Herald's real default app, which this seed
//                         leaves empty.
//   FIXTURE_HERALD_CLAIM  "bad" answers every intent PERMISSION_DENIED, as a
//                         session with an unusable app_id claim does.
//   FIXTURE_HERALD_KEY    "none" makes encryption unconfigured.

const DEFAULT_APP = "app_demo"
const OTHER_APP = "app_other"

const CHANNELS = ["email", "sms", "push", "inapp", "webhook", "chat"]
const ROUTED = ["email", "sms", "push", "webhook", "chat"]
const PREF_CHANNELS = ["email", "sms", "push", "inapp"]
const CATEGORIES = ["auth", "transactional", "marketing", "system"]
const SCOPE_ORDER = ["app", "org", "user"]
const FUNCS = ["default", "formatDate", "lower", "now", "title", "truncate", "upper"]
const BUILTINS = ["and", "call", "html", "index", "slice", "js", "len", "not", "or", "print", "printf", "println", "urlquery", "eq", "ge", "gt", "le", "lt", "ne"]
const KEYWORDS = ["if", "else", "end", "range", "with", "define", "template", "block", "break", "continue", "nil"]
const KNOWN = new Set([...FUNCS, ...BUILTINS, ...KEYWORDS])

const ENC = "aes-256-gcm"
const PLAIN = "plaintext"
const KEY_ID = "k1"
const MAX_RENDER_BYTES = 256 << 10

const SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const VARNAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const CONTROL = /[\u0000-\u001f\u007f]/

/** A TypeID-shaped ID: prefix, underscore, 26 base32 characters. */
export function tid(prefix, n) {
  return `${prefix}_01j${String(n).padStart(23, "0")}`
}
const typeId = (prefix) => new RegExp(`^${prefix}_[0-7][0-9a-hjkmnp-tv-z]{25}$`)

function field(key, label, opts = {}) {
  const out = { key, label }
  if (opts.help) out.help = opts.help
  out.required = Boolean(opts.required)
  out.secret = Boolean(opts.secret)
  out.placement = opts.placement ?? "credential"
  return out
}

const SENDER = [
  field("from", "From address", { placement: "setting", help: "Used when no routing rule sets one." }),
  field("from_name", "From name", { placement: "setting" }),
]

/** Sorted by name, as engine.info sorts them. */
const DRIVERS = [
  {
    name: "fcm",
    channel: "push",
    fields: [
      field("project_id", "Project ID", { required: true, placement: "setting" }),
      field("access_token", "OAuth access token", { secret: true, help: "Set this or a server key. Tokens are short-lived and Herald does not refresh them." }),
      field("server_key", "Server key", { secret: true, help: "Legacy key. Set this or an access token." }),
      field("base_url", "API base URL", { placement: "setting" }),
    ],
  },
  { name: "inapp", channel: "inapp", fields: [] },
  { name: "legacy-sms", channel: "sms", fields: null },
  {
    name: "resend",
    channel: "email",
    fields: [
      field("api_key", "API key", { required: true, secret: true }),
      field("base_url", "API base URL", { placement: "setting", help: "Leave empty for Resend's own API." }),
      ...SENDER,
    ],
  },
  {
    name: "smtp",
    channel: "email",
    fields: [
      field("host", "Host", { required: true, placement: "setting" }),
      field("port", "Port", { required: true, placement: "setting", help: "Usually 587, or 465 with implicit TLS." }),
      field("use_tls", "Implicit TLS", { placement: "setting", help: '"true" to connect over TLS from the start (port 465).' }),
      field("username", "Username"),
      field("password", "Password", { secret: true }),
      ...SENDER,
    ],
  },
  {
    name: "twilio",
    channel: "sms",
    fields: [
      field("account_sid", "Account SID", { required: true }),
      field("auth_token", "Auth token", { required: true, secret: true }),
      field("from_number", "From number", { required: true, placement: "setting", help: "E.164, e.g. +15550100. A routing rule's from phone overrides it." }),
      field("base_url", "API base URL", { placement: "setting", help: "Leave empty for Twilio's own API." }),
    ],
  },
]

const v = (name, opts = {}) => {
  const out = { name, type: opts.type ?? "string", required: Boolean(opts.required) }
  if (opts.default) out.default = opts.default
  if (opts.description) out.description = opts.description
  return out
}

/** The system templates resetDefaults puts back, a subset of Herald's 49. */
function systemTemplates() {
  return [
    {
      slug: "auth.welcome", name: "Welcome Email", channel: "email", category: "auth",
      variables: [v("user_name", { required: true, description: "User's display name" }), v("app_name", { required: true, description: "Application name" }), v("login_url", { type: "url", description: "Login URL" })],
      versions: [{ locale: "en", subject: "Welcome to {{.app_name}}!", html: '<h1>Welcome, {{.user_name}}</h1>\n<p>Thanks for joining {{.app_name}}.</p>\n<p><a href="{{.login_url}}">Sign in</a></p>', text: "Hi {{.user_name}},\n\nThanks for joining {{.app_name}}.\nSign in: {{.login_url}}", title: "", active: true }],
    },
    {
      slug: "auth.password-reset", name: "Password Reset", channel: "email", category: "auth",
      variables: [v("user_name", { required: true }), v("app_name", { required: true }), v("reset_url", { required: true, type: "url" }), v("expires_in", { default: "1 hour" })],
      versions: [{ locale: "en", subject: "Reset your {{.app_name}} password", html: '<p>Hi {{.user_name}},</p>\n<p><a href="{{.reset_url}}">Reset your password</a>. The link expires in {{.expires_in}}.</p>', text: "Hi {{.user_name}},\n\nReset your password: {{.reset_url}}\nThe link expires in {{.expires_in}}.", title: "", active: true }],
    },
    {
      slug: "auth.mfa-code", name: "MFA Verification Code", channel: "sms", category: "auth",
      variables: [v("code", { required: true }), v("app_name", { required: true }), v("expires_in", { default: "5 minutes" })],
      versions: [{ locale: "en", subject: "", html: "", text: "{{.code}} is your {{.app_name}} code. It expires in {{.expires_in}}.", title: "", active: true }],
    },
    {
      slug: "auth.welcome", name: "Welcome Notification", channel: "inapp", category: "auth",
      variables: [v("user_name", { required: true }), v("app_name", { required: true })],
      versions: [{ locale: "en", subject: "", html: "", text: "Hi {{.user_name}}, your account is ready.", title: "Welcome to {{.app_name}}", active: true }],
    },
  ]
}

function seed() {
  const now = Date.now()
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString()
  const s = { nextId: 100, providers: [], templates: [], messages: [], inbox: [], preferences: [], scopes: [] }

  const provider = (n, appId, name, channel, driver, priority, enabled, settings, credentials, created) => {
    s.providers.push({ id: tid("hpvd", n), appId, name, channel, driver, priority, enabled, settings, credentials, createdAt: at(created), updatedAt: at(created) })
  }
  provider(1, DEFAULT_APP, "Primary SMTP", "email", "smtp", 0, true, { host: "smtp.example.com", port: "587", from: "no-reply@example.com", from_name: "Example" }, { password: ENC, username: ENC }, 14_400)
  provider(2, DEFAULT_APP, "Twilio", "sms", "twilio", 0, true, { from_number: "+15550100" }, { account_sid: PLAIN, auth_token: PLAIN }, 14_000)
  provider(3, DEFAULT_APP, "Resend backup", "email", "resend", 10, false, {}, { api_key: ENC }, 13_000)
  provider(4, DEFAULT_APP, "inapp (default)", "inapp", "inapp", 0, true, {}, {}, 14_500)
  provider(5, DEFAULT_APP, "Legacy SMS gateway", "sms", "legacy-sms", 5, true, { gateway: "https://sms.internal.example.com" }, { token: PLAIN }, 12_000)
  provider(9, OTHER_APP, "Other app SMTP", "email", "smtp", 0, true, { host: "smtp.other.example.com", port: "587" }, { password: ENC }, 14_000)

  let versionN = 21
  const template = (n, appId, spec, isSystem, enabled, created) => {
    s.templates.push({
      id: tid("htpl", n), appId, slug: spec.slug, name: spec.name, channel: spec.channel, category: spec.category,
      isSystem, enabled, variables: spec.variables,
      versions: spec.versions.map((ver) => ({ id: tid("htpv", versionN++), ...ver, createdAt: at(created), updatedAt: at(created) })),
      createdAt: at(created), updatedAt: at(created),
    })
  }
  systemTemplates().forEach((spec, i) => template(11 + i, DEFAULT_APP, spec, true, true, 20_000 - i))
  template(15, DEFAULT_APP, {
    slug: "billing.receipt", name: "Receipt", channel: "email", category: "transactional",
    variables: [v("customer_name", { required: true }), v("amount", { required: true }), v("invoice_url", { type: "url" })],
    versions: [
      { locale: "", subject: "Your receipt", html: '<p>Hi {{.customer_name}}, we received <strong>{{.amount}}</strong>.</p>\n<p><a href="{{.invoice_url}}">View the invoice</a></p>\n<img src="https://tracker.example.com/open.gif" alt="">', text: "Hi {{.customer_name}}, we received {{.amount}}. Invoice: {{.invoice_url}}", title: "", active: true },
      { locale: "en", subject: "Your {{.amount}} receipt", html: "<p>Hi {{.customer_name}}, thanks for your payment of {{.amount}}.</p>", text: "Hi {{.customer_name}}, thanks for your payment of {{.amount}}.", title: "", active: true },
      { locale: "fr", subject: "Votre reçu", html: "<p>Bonjour {{.customer_name}}, nous avons reçu {{.amount}}.</p>", text: "Bonjour {{.customer_name}}, nous avons reçu {{.amount}}.", title: "", active: false },
    ],
  }, false, true, 9_000)
  template(16, DEFAULT_APP, {
    slug: "ops.digest", name: "Daily digest", channel: "email", category: "system", variables: [],
    versions: [{ locale: "en", subject: "Daily digest", html: "", text: "Nothing to report.", title: "", active: true }],
  }, false, false, 8_000)
  template(19, OTHER_APP, {
    slug: "other.only", name: "Other app template", channel: "email", category: "transactional", variables: [],
    versions: [{ locale: "en", subject: "Hi", html: "", text: "Hi", title: "", active: true }],
  }, false, true, 8_000)

  const STATUS = ["sent", "sent", "sent", "sent", "sent", "sent", "sent", "failed", "suppressed", "sending"]
  for (let i = 0; i < 60; i++) {
    const channel = ["email", "sms", "inapp"][i % 3]
    const status = STATUS[i % 10]
    const createdAt = at(i * 200 + 5)
    const m = {
      id: tid("hmsg", 1000 + i), appId: DEFAULT_APP, channel, status,
      recipient: channel === "email" ? ["ada@example.com", "bo@example.com", "cy@example.com"][i % 3] : channel === "sms" ? `+1555011${i % 10}` : "usr_ada",
      templateSlug: channel === "sms" ? "auth.mfa-code" : "auth.welcome",
      providerId: status === "suppressed" ? "" : channel === "email" ? tid("hpvd", 1) : channel === "sms" ? tid("hpvd", 2) : tid("hpvd", 4),
      subject: channel === "email" ? "Welcome to Example!" : "",
      body: channel === "sms" ? "123456 is your Example code. It expires in 5 minutes." : "Hi Ada,\n\nThanks for joining Example.",
      metadata: { source: "api" }, attempts: status === "failed" ? 3 : 1, async: i % 4 === 0,
      createdAt,
    }
    if (status === "sent") {
      m.sentAt = new Date(Date.parse(createdAt) + 1_000).toISOString()
      if (channel === "email") m.providerMessageId = `${1000 + i}.msg@smtp.example.com`
      if (channel === "sms") m.providerMessageId = `SM${String(1000 + i).padStart(32, "f")}`
    }
    if (status === "failed") m.error = channel === "sms" ? "twilio: 21211 invalid 'To' phone number" : "smtp: 550 5.1.1 mailbox unavailable"
    if (status === "suppressed") m.error = "user opted out"
    if (i === 4) m.templateSlug = "retired.notice"
    if (i === 5) m.providerId = tid("hpvd", 7)
    s.messages.push(m)
  }
  for (let i = 0; i < 2; i++) {
    s.messages.push({ id: tid("hmsg", 1100 + i), appId: OTHER_APP, channel: "email", status: "sent", recipient: "zed@other.example.com", templateSlug: "other.only", providerId: tid("hpvd", 9), subject: "Hi", body: "Hi", metadata: {}, attempts: 1, async: false, createdAt: at(30 + i) })
  }

  const TYPES = ["auth.welcome", "security.signin-alert", "billing.receipt"]
  for (let i = 0; i < 30; i++) {
    const read = i % 3 !== 0
    const n = { id: tid("hinb", 2000 + i), appId: DEFAULT_APP, userId: "usr_ada", type: TYPES[i % 3], title: ["Welcome to Example", "New sign-in", "Your receipt"][i % 3], body: "Open the app for details.", read, metadata: {}, createdAt: at(i * 90 + 3) }
    if (read) n.readAt = at(i * 90)
    if (i % 5 === 0) n.expiresAt = new Date(now + (i + 1) * 86_400_000).toISOString()
    if (i % 3 === 2) n.actionUrl = "https://example.com/billing"
    s.inbox.push(n)
  }
  s.inbox.push({ id: tid("hinb", 2100), appId: DEFAULT_APP, userId: "usr_bo", type: "auth.welcome", title: "Welcome to Example", read: false, metadata: {}, createdAt: at(50) })
  s.inbox.push({ id: tid("hinb", 2101), appId: DEFAULT_APP, userId: "usr_bo", type: "auth.welcome", title: "Welcome back", read: false, metadata: {}, createdAt: at(40) })
  s.inbox.push({ id: tid("hinb", 2200), appId: OTHER_APP, userId: "usr_ada", type: "other.only", title: "Other app", read: false, metadata: {}, createdAt: at(20) })

  s.preferences.push({
    id: tid("hprf", 3000), appId: DEFAULT_APP, userId: "usr_ada",
    overrides: {
      "auth.welcome": { email: null, sms: null, push: null, inapp: false },
      "marketing.weekly": { email: false, sms: null, push: null, inapp: null },
    },
    createdAt: at(5_000), updatedAt: at(4_000),
  })

  const rule = (n, appId, scope, scopeId, fields, created) => {
    s.scopes.push({ id: tid("hscf", n), appId, scope, scopeId, emailProviderId: "", smsProviderId: "", pushProviderId: "", webhookProviderId: "", chatProviderId: "", fromEmail: "", fromName: "", fromPhone: "", defaultLocale: "", ...fields, createdAt: at(created), updatedAt: at(created) })
  }
  rule(4000, DEFAULT_APP, "app", DEFAULT_APP, { emailProviderId: tid("hpvd", 1), smsProviderId: tid("hpvd", 2), fromEmail: "hello@example.com", fromName: "Example", defaultLocale: "en" }, 10_000)
  rule(4001, DEFAULT_APP, "org", "org_acme", { emailProviderId: tid("hpvd", 7), fromName: "Acme" }, 9_500)
  rule(4002, DEFAULT_APP, "user", "usr_ada", { smsProviderId: tid("hpvd", 5) }, 9_000)
  rule(4003, OTHER_APP, "app", OTHER_APP, { emailProviderId: tid("hpvd", 9) }, 9_000)
  return s
}

let state = seed()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetHerald() {
  state = seed()
}

/**
 * Seeded IDs, and the IDs the verify walk's creates receive. The walk runs
 * the commands in the order createHeraldHandlers lists them against a fresh
 * seed, so providers.create gets 100, templates.create 101 with its first
 * version 102, and versions.create 103.
 */
export const HERALD_IDS = {
  smtp: tid("hpvd", 1),
  twilio: tid("hpvd", 2),
  legacy: tid("hpvd", 5),
  deletedProvider: tid("hpvd", 7),
  otherProvider: tid("hpvd", 9),
  welcomeEmail: tid("htpl", 11),
  receipt: tid("htpl", 15),
  otherTemplate: tid("htpl", 19),
  message: tid("hmsg", 1000),
  otherMessage: tid("hmsg", 1100),
  notification: tid("hinb", 2001),
  notification2: tid("hinb", 2002),
  otherNotification: tid("hinb", 2200),
  created: { provider: tid("hpvd", 100), template: tid("htpl", 101), firstVersion: tid("htpv", 102), frVersion: tid("htpv", 103) },
}

const str = (value) => (typeof value === "string" ? value.trim() : "")
const raw = (value) => (typeof value === "string" ? value : "")
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {})
const stamp = () => new Date().toISOString()
const next = (prefix) => tid(prefix, state.nextId++)
const bytes = (text) => Buffer.byteLength(text, "utf8")
const driverOf = (name) => DRIVERS.find((d) => d.name === name)
const schemaless = (d) => !d || !d.fields || d.fields.length === 0

function stringMap(value) {
  const out = {}
  for (const [key, val] of Object.entries(obj(value))) if (typeof val === "string") out[key] = val
  return out
}
const withoutEmpty = (map) => Object.fromEntries(Object.entries(map).filter(([, val]) => val !== ""))
const stringList = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === "string") : [])

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&#34;").replace(/'/g, "&#39;")
}

function lineCol(src, index) {
  const before = src.slice(0, index)
  return { line: before.split("\n").length, column: index - before.lastIndexOf("\n") }
}

/** The approximation described in the header. Never a template engine. */
function approximate(fieldName, src, declared, values, html) {
  const diags = []
  if (src === "") return { out: { field: fieldName, output: "", rendered: false }, diags }
  const opens = [...src.matchAll(/\{\{/g)].map((m) => m.index)
  const closes = [...src.matchAll(/\}\}/g)].length
  if (opens.length !== closes) {
    const pos = lineCol(src, opens[opens.length - 1] ?? 0)
    diags.push({ field: fieldName, line: pos.line, column: 0, severity: "error", kind: "parse", message: "unclosed action" })
    return { out: { field: fieldName, output: "", rendered: false }, diags }
  }
  const undeclared = new Set()
  let failed = false
  const output = src.replace(/\{\{-?\s*([\s\S]*?)\s*-?\}\}/g, (whole, inner, index) => {
    const one = /^\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(inner)
    const call = /^(upper|lower|title)\s+\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(inner)
    const name = one?.[1] ?? call?.[2]
    if (name !== undefined) {
      if (!declared.has(name) && !undeclared.has(name)) {
        undeclared.add(name)
        const pos = lineCol(src, index + whole.indexOf("."))
        diags.push({ field: fieldName, line: pos.line, column: pos.column, severity: "warning", kind: "undeclared", message: `.${name} is used but not declared as a variable` })
      }
      const value = values[name]
      if (value === undefined || value === null) return html ? "" : "<no value>"
      let text = String(value)
      if (call?.[1] === "upper") text = text.toUpperCase()
      if (call?.[1] === "lower") text = text.toLowerCase()
      if (call?.[1] === "title") text = text.replace(/\b\w/g, (c) => c.toUpperCase())
      return html ? escapeHtml(text) : text
    }
    const head = inner.split(/\s+/)[0] ?? ""
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(head) && !KNOWN.has(head)) {
      failed = true
      diags.push({ field: fieldName, line: lineCol(src, index).line, column: 0, severity: "error", kind: "parse", message: `function "${head}" not defined` })
    }
    return ""
  })
  if (failed) return { out: { field: fieldName, output: "", rendered: false }, diags: diags.filter((d) => d.kind === "parse") }
  return { out: { field: fieldName, output, rendered: true }, diags }
}

function substitute(src, values) {
  return src.replace(/\{\{-?\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*-?\}\}/g, (_, name) => (values[name] === undefined ? "<no value>" : String(values[name])))
}

function withDefaults(variables, data) {
  const values = { ...data }
  for (const variable of variables) if (variable.default && !(variable.name in values)) values[variable.name] = variable.default
  return values
}

function explain(t, requested) {
  const locale = requested.trim()
  const steps = []
  const attempt = (loc, match) => {
    const hit = t.versions.find((ver) => ver.active && ver.locale === loc)
    steps.push(hit ? { try: loc, match, found: true, versionId: hit.id } : { try: loc, match, found: false })
    return hit
  }
  let found = attempt(locale, "exact")
  if (!found && locale.includes("-")) {
    const lang = locale.split("-")[0]
    if (lang) found = attempt(lang, "language")
  }
  if (!found && locale !== "") found = attempt("", "default")
  const hit = steps.find((s) => s.found)
  return { locale, steps, versionId: hit ? hit.versionId : null, match: hit ? hit.match : "none" }
}

function decodeCursor(rawCursor, bad) {
  const c = str(rawCursor)
  if (!c) return 0
  const m = /^o:(\d+)$/.exec(Buffer.from(c, "base64url").toString("utf8"))
  if (!m) throw bad("cursor is not valid")
  return Number(m[1])
}
const encodeCursor = (offset) => Buffer.from(`o:${offset}`).toString("base64url")
const pageLimit = (value) => Math.min(Number.isInteger(value) && value > 0 ? value : 25, 100)

const PROVIDER_WRITE = ["providers.list", "providers.detail", "overview.stats", "send.resolve", "scopes.list"]
const TEMPLATE_WRITE = ["templates.list", "templates.detail", "templates.resolve", "overview.stats", "preferences.get"]
const VERSION_WRITE = ["templates.list", "templates.detail", "templates.resolve", "overview.stats"]
const SCOPE_WRITE = ["scopes.list", "send.resolve", "providers.detail"]

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 */
export function createHeraldHandlers(FixtureError) {
  const bad = (message) => new FixtureError(400, "BAD_REQUEST", message)
  const notFound = (message) => new FixtureError(404, "NOT_FOUND", message)
  const conflict = (message) => new FixtureError(409, "CONFLICT", message)

  function appId() {
    if (process.env.FIXTURE_HERALD_CLAIM === "bad") throw new FixtureError(403, "PERMISSION_DENIED", "the app on this session can't be read")
    return process.env.FIXTURE_HERALD_APP ?? DEFAULT_APP
  }
  const keyConfigured = () => process.env.FIXTURE_HERALD_KEY !== "none"

  function parseId(rawId, prefix, message) {
    const id = str(rawId)
    if (!typeId(prefix).test(id)) throw bad(message)
    return id
  }

  function ownedProvider(app, rawId) {
    const id = parseId(rawId, "hpvd", "id is not a provider id")
    const p = state.providers.find((x) => x.id === id && x.appId === app)
    if (!p) throw notFound("provider not found")
    return p
  }

  function ownedTemplate(app, rawId) {
    const id = parseId(rawId, "htpl", "id is not a template id")
    const t = state.templates.find((x) => x.id === id && x.appId === app)
    if (!t) throw notFound("template not found")
    return t
  }

  function ownedVersion(app, templateId, versionId) {
    const t = ownedTemplate(app, templateId)
    const id = parseId(versionId, "htpv", "versionId is not a version id")
    const ver = t.versions.find((x) => x.id === id)
    if (!ver) throw notFound("template version not found")
    return { t, ver }
  }

  function ownedNotification(app, rawId) {
    const id = parseId(rawId, "hinb", "id is not a notification id")
    const n = state.inbox.find((x) => x.id === id && x.appId === app)
    if (!n) throw notFound("notification not found")
    return n
  }

  function credentialList(p) {
    return Object.keys(p.credentials).sort().map((key) => (p.credentials[key] === ENC ? { key, protection: ENC, keyId: KEY_ID } : { key, protection: PLAIN }))
  }

  function providerSummary(p) {
    return { id: p.id, name: p.name, channel: p.channel, driver: p.driver, priority: p.priority, enabled: p.enabled, credentials: credentialList(p), createdAt: p.createdAt, updatedAt: p.updatedAt }
  }

  function settingsOf(p) {
    const d = driverOf(p.driver)
    return Object.keys(p.settings).sort().map((key) => {
      const secret = schemaless(d) || d.fields.some((f) => f.key === key && f.secret)
      return secret ? { key, secret: true } : { key, value: p.settings[key], secret: false }
    })
  }

  function routesUsing(app, id) {
    const uses = []
    for (const r of state.scopes) {
      if (r.appId !== app) continue
      for (const ch of ROUTED) if (r[`${ch}ProviderId`] === id) uses.push({ scope: r.scope, scopeId: r.scopeId, channel: ch })
    }
    return uses
  }

  function checkPlacement(d, credentials, settings) {
    for (const target of ["base_url", "host"]) {
      if (target in credentials) throw bad(`herald: invalid provider: ${target} says where the driver connects and belongs in settings, not credentials`)
    }
    if (schemaless(d)) return
    for (const f of d.fields) {
      if (f.placement === "setting" && f.key in credentials) throw bad(`herald: invalid provider: ${f.key} is a setting and belongs in settings, not credentials`)
      if (f.secret && f.key in settings) throw bad(`herald: invalid provider: ${f.key} is a secret and belongs in credentials, not settings`)
    }
  }

  function checkRequired(d, present) {
    if (schemaless(d)) return
    for (const f of d.fields) {
      if (f.required && !present.has(f.key)) throw bad(`herald: invalid provider: ${d.name}: missing required credential "${f.key}"`)
    }
    if (d.name === "fcm" && !present.has("access_token") && !present.has("server_key")) {
      throw bad("herald: invalid provider: fcm: missing required credential 'server_key' or 'access_token'")
    }
  }

  const protect = (credentials) => Object.fromEntries(Object.keys(credentials).map((key) => [key, keyConfigured() ? ENC : PLAIN]))

  const hasFallback = (t) => t.versions.some((ver) => ver.locale === "" && ver.active)
  const sortedVersions = (t) => [...t.versions].sort((a, b) => a.locale.localeCompare(b.locale))

  function templateSummary(t) {
    return { id: t.id, slug: t.slug, name: t.name, channel: t.channel, category: t.category, isSystem: t.isSystem, enabled: t.enabled, locales: sortedVersions(t).map((ver) => ({ locale: ver.locale, active: ver.active })), hasFallback: hasFallback(t), updatedAt: t.updatedAt }
  }

  const versionWire = (ver) => ({ id: ver.id, locale: ver.locale, subject: ver.subject, html: ver.html, text: ver.text, title: ver.title, active: ver.active, createdAt: ver.createdAt, updatedAt: ver.updatedAt })

  function checkVariables(list) {
    const seen = new Set()
    return list.map((item) => {
      const variable = obj(item)
      const name = str(variable.name)
      if (!VARNAME.test(name)) throw bad("variable names must be Go template field names (letters, digits, underscores)")
      if (seen.has(name)) throw bad(`variable ${name} is declared twice`)
      seen.add(name)
      const out = { name, type: str(variable.type) || "string", required: variable.required === true }
      if (typeof variable.default === "string" && variable.default !== "") out.default = variable.default
      if (typeof variable.description === "string" && variable.description !== "") out.description = variable.description
      return out
    })
  }

  function messageSummary(m, app) {
    const p = state.providers.find((x) => x.id === m.providerId && x.appId === app)
    const out = { id: m.id, recipient: m.recipient, channel: m.channel, status: m.status, provider: p ? { id: p.id, name: p.name, driver: p.driver } : null, createdAt: m.createdAt }
    if (m.templateSlug) out.templateSlug = m.templateSlug
    if (m.error) out.error = m.error
    if (m.sentAt) out.sentAt = m.sentAt
    return out
  }

  function notificationWire(n) {
    const out = { id: n.id, userId: n.userId, type: n.type, title: n.title, read: n.read, metadata: n.metadata, createdAt: n.createdAt }
    for (const key of ["body", "actionUrl", "imageUrl", "readAt", "expiresAt"]) if (n[key]) out[key] = n[key]
    return out
  }

  const preferenceWire = (p) => ({ id: p.id, userId: p.userId, overrides: p.overrides, updatedAt: p.updatedAt })

  function projectRule(r, app) {
    const providers = {}
    for (const ch of ROUTED) {
      const id = r[`${ch}ProviderId`]
      if (!id) continue
      const p = state.providers.find((x) => x.id === id && x.appId === app)
      providers[ch] = p ? { id, name: p.name, dangling: false } : { id, dangling: true }
    }
    const out = { id: r.id, scope: r.scope, scopeId: r.scopeId, providers, defaultLocaleUnused: true, updatedAt: r.updatedAt }
    for (const key of ["fromEmail", "fromName", "fromPhone", "defaultLocale"]) if (r[key]) out[key] = r[key]
    return out
  }

  const ruleFor = (app, scope, scopeId) => state.scopes.find((r) => r.appId === app && r.scope === scope && r.scopeId === scopeId)

  function resolveSend(app, channel, providerId, orgId, userId) {
    if (providerId) {
      const id = parseId(providerId, "hpvd", "id is not a provider id")
      const p = state.providers.find((x) => x.id === id && x.appId === app)
      if (!p) throw notFound("provider not found")
      if (p.channel !== channel) throw bad(`herald: invalid channel type: provider ${p.id} sends ${p.channel}, not ${channel}`)
      if (!driverOf(p.driver)) throw bad(`herald: driver not found: driver=${p.driver}`)
      return { p, via: "chosen", rule: null }
    }
    for (const [scope, scopeId] of [["user", userId], ["org", orgId], ["app", app]]) {
      if (scope !== "app" && !scopeId) continue
      const r = ruleFor(app, scope, scopeId)
      const id = r?.[`${channel}ProviderId`]
      if (!id) continue
      const p = state.providers.find((x) => x.id === id && x.appId === app && x.channel === channel)
      if (p) return { p, via: scope, rule: r }
    }
    const candidates = state.providers
      .filter((x) => x.appId === app && x.channel === channel && x.enabled)
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
    if (candidates.length === 0) return null
    return { p: candidates[0], via: "fallback", rule: ruleFor(app, "app", app) ?? null }
  }

  function senderFor(channel, res) {
    const r = res.rule
    const s = res.p.settings
    if (channel === "sms") {
      const phone = r?.fromPhone || s.from_number || s.from
      return phone ? { phone } : {}
    }
    const from = {}
    const email = r?.fromEmail || s.from
    const name = r?.fromName || s.from_name
    if (email) from.email = email
    if (name) from.name = name
    return from
  }

  function optedOut(app, userId, type, channel) {
    const pref = state.preferences.find((p) => p.appId === app && p.userId === userId)
    return pref?.overrides[type]?.[channel] === false
  }

  // Wire order: queries first, then commands, creates before the deletes that
  // remove what they made. verify.mjs walks this order (see HERALD_IDS).
  return {
    "engine.info": {
      kind: "query",
      handler: () => {
        const id = appId()
        return {
          app: { id, label: id === "" ? "Default app" : id },
          defaultLocale: "en", maxBatchSize: 100, truncateBodyAt: 4096,
          channels: CHANNELS, drivers: DRIVERS, templateFuncs: FUNCS,
          encryption: keyConfigured() ? { configured: true, keyId: KEY_ID } : { configured: false },
          apiProtected: false,
        }
      },
    },
    "overview.stats": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const windows = { "24h": 24 * 60, "7d": 7 * 24 * 60, "30d": 30 * 24 * 60 }
        const w = str(f.window) || "7d"
        if (!(w in windows)) throw bad("window must be 24h, 7d or 30d")
        const since = new Date(Date.now() - windows[w] * 60_000).toISOString()
        const groups = new Map()
        for (const m of state.messages) {
          if (m.appId !== app || m.createdAt < since) continue
          const key = `${m.status}|${m.channel}`
          groups.set(key, (groups.get(key) ?? 0) + 1)
        }
        const counts = [...groups.entries()]
          .map(([key, n]) => ({ status: key.split("|")[0], channel: key.split("|")[1], n }))
          .sort((a, b) => a.status.localeCompare(b.status) || a.channel.localeCompare(b.channel))
        const providers = state.providers.filter((p) => p.appId === app)
        let plaintext = 0
        let encrypted = 0
        for (const p of providers) for (const prot of Object.values(p.credentials)) prot === ENC ? encrypted++ : plaintext++
        return {
          since, counts,
          providers: { total: providers.length, enabled: providers.filter((p) => p.enabled).length },
          credentials: { plaintext, encrypted },
          templatesWithoutFallback: state.templates.filter((t) => t.appId === app && !hasFallback(t)).map((t) => ({ id: t.id, slug: t.slug, channel: t.channel })),
        }
      },
    },
    "providers.list": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const channel = str(f.channel)
        const providers = state.providers
          .filter((p) => p.appId === app && (!channel || p.channel === channel))
          .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(providerSummary)
        return { providers }
      },
    },
    "providers.detail": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const p = ownedProvider(app, f.id)
        return { provider: { ...providerSummary(p), settings: settingsOf(p), usedBy: routesUsing(app, p.id) } }
      },
    },
    "templates.list": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const channel = str(f.channel)
        const category = str(f.category)
        const templates = state.templates
          .filter((t) => t.appId === app && (!channel || t.channel === channel) && (!category || t.category === category) && (f.noFallback !== true || !hasFallback(t)))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(templateSummary)
        return { templates }
      },
    },
    "templates.detail": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const t = ownedTemplate(app, f.id)
        const locales = [...new Set([...sortedVersions(t).map((ver) => ver.locale), "", "en"])]
        return {
          template: { ...templateSummary(t), variables: t.variables, versions: sortedVersions(t).map(versionWire) },
          resolution: locales.map((loc) => {
            const r = explain(t, loc)
            return { locale: loc, versionId: r.versionId, match: r.match }
          }),
        }
      },
    },
    "templates.resolve": {
      kind: "query",
      handler: (f) => explain(ownedTemplate(appId(), f.id), raw(f.locale)),
    },
    "templates.render": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const content = obj(f.content)
        const c = { subject: raw(content.subject), html: raw(content.html), text: raw(content.text), title: raw(content.title) }
        const requested = Array.isArray(f.variables) ? f.variables : null
        const size = bytes(c.subject) + bytes(c.html) + bytes(c.text) + bytes(c.title) + bytes(JSON.stringify(f.data ?? null)) + (requested ? bytes(JSON.stringify(requested)) : 0)
        if (size > MAX_RENDER_BYTES) throw bad("the template and its sample data are too large to preview")
        let variables = requested ? checkVariables(requested) : []
        if (str(f.templateId)) {
          const t = ownedTemplate(app, f.templateId)
          if (!requested) variables = t.variables
        }
        const values = withDefaults(variables, obj(f.data))
        const declared = new Set(variables.map((x) => x.name))
        const rendered = ["subject", "html", "text", "title"].map((name) => approximate(name, c[name], declared, values, name === "html"))
        const diagnostics = rendered.flatMap((r) => r.diags)
        for (const variable of variables) {
          if (values[variable.name] !== undefined) continue
          diagnostics.push(variable.required
            ? { field: "", line: 0, column: 0, severity: "error", kind: "missing", message: `required variable "${variable.name}" has no value and no default` }
            : { field: "", line: 0, column: 0, severity: "warning", kind: "unprovided", message: `"${variable.name}" has no sample value, so it renders as <no value> in text and nothing in HTML` })
        }
        return { fields: rendered.map((r) => r.out), diagnostics }
      },
    },
    "messages.list": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const offset = decodeCursor(f.cursor, bad)
        const limit = pageLimit(f.limit)
        const channel = str(f.channel)
        const status = str(f.status)
        const rows = state.messages
          .filter((m) => m.appId === app && (!channel || m.channel === channel) && (!status || m.status === status))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        const page = rows.slice(offset, offset + limit + 1)
        const out = { messages: page.slice(0, limit).map((m) => messageSummary(m, app)) }
        if (page.length > limit) out.nextCursor = encodeCursor(offset + limit)
        return out
      },
    },
    "messages.detail": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const id = parseId(f.id, "hmsg", "id is not a message id")
        const m = state.messages.find((x) => x.id === id && x.appId === app)
        if (!m) throw notFound("message not found")
        const t = m.templateSlug ? state.templates.find((x) => x.appId === app && x.slug === m.templateSlug && x.channel === m.channel) : undefined
        const out = { ...messageSummary(m, app), body: m.body, metadata: m.metadata, attempts: m.attempts, async: m.async, template: t ? { id: t.id, slug: t.slug, channel: t.channel } : null }
        if (m.subject) out.subject = m.subject
        if (m.providerMessageId) out.providerMessageId = m.providerMessageId
        return { message: out }
      },
    },
    "inbox.list": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const userId = str(f.userId)
        if (!userId) throw bad("userId is required")
        const offset = decodeCursor(f.cursor, bad)
        const limit = pageLimit(f.limit)
        const rows = state.inbox
          .filter((n) => n.appId === app && n.userId === userId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        const page = rows.slice(offset, offset + limit + 1)
        const out = { notifications: page.slice(0, limit).map(notificationWire), unread: rows.filter((n) => !n.read).length }
        if (page.length > limit) out.nextCursor = encodeCursor(offset + limit)
        return out
      },
    },
    "preferences.get": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const userId = str(f.userId)
        if (!userId) throw bad("userId is required")
        const pref = state.preferences.find((p) => p.appId === app && p.userId === userId)
        const knownTypes = [...new Set(state.templates.filter((t) => t.appId === app).map((t) => t.slug))].sort()
        return { preference: pref ? preferenceWire(pref) : null, knownTypes }
      },
    },
    "scopes.list": {
      kind: "query",
      handler: () => {
        const app = appId()
        const rules = state.scopes
          .filter((r) => r.appId === app)
          .sort((a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) || a.createdAt.localeCompare(b.createdAt))
          .map((r) => projectRule(r, app))
        return { rules }
      },
    },
    "send.resolve": {
      kind: "query",
      handler: (f) => {
        const app = appId()
        const channel = str(f.channel)
        if (!CHANNELS.includes(channel)) throw bad("channel is not one Herald supports")
        const res = resolveSend(app, channel, str(f.providerId), str(f.orgId), str(f.userId))
        if (!res) return { provider: null, via: "none", from: {} }
        return { provider: { id: res.p.id, name: res.p.name, driver: res.p.driver, enabled: res.p.enabled }, via: res.via, from: senderFor(channel, res) }
      },
    },

    "providers.create": {
      kind: "command",
      invalidates: PROVIDER_WRITE,
      handler: (f) => {
        const app = appId()
        const name = str(f.name)
        const channel = str(f.channel)
        const driver = str(f.driver)
        if (!name) throw bad("herald: invalid provider: name is required")
        const d = driverOf(driver)
        if (!d) throw bad(`herald: driver not found: ${driver}`)
        if (d.channel !== channel) throw bad(`herald: invalid channel type: driver ${driver} sends ${d.channel}, not ${channel}`)
        const credentials = withoutEmpty(stringMap(f.credentials))
        const settings = stringMap(f.settings)
        checkPlacement(d, credentials, settings)
        checkRequired(d, new Set([...Object.keys(credentials), ...Object.keys(settings)].filter((k) => (credentials[k] ?? settings[k]) !== "")))
        const t = stamp()
        const p = { id: next("hpvd"), appId: app, name, channel, driver, priority: Number.isInteger(f.priority) ? f.priority : 0, enabled: f.enabled === true, settings, credentials: protect(credentials), createdAt: t, updatedAt: t }
        state.providers.push(p)
        return { provider: providerSummary(p) }
      },
    },
    "providers.update": {
      kind: "command",
      invalidates: PROVIDER_WRITE,
      handler: (f) => {
        const app = appId()
        const p = ownedProvider(app, f.id)
        const d = driverOf(p.driver)
        if (f.name !== undefined && f.name !== null && !str(f.name)) throw bad("herald: invalid provider: name is required")
        // An empty value means "not entered", so it is never recorded as a stored key.
        const setCredentials = withoutEmpty(stringMap(f.setCredentials))
        const removeCredentials = stringList(f.removeCredentials)
        const setSettings = stringMap(f.setSettings)
        const removeSettings = stringList(f.removeSettings)
        checkPlacement(d, setCredentials, setSettings)
        const moved = ["base_url", "host"].filter((target) => {
          const value = setSettings[target]
          return value !== undefined && value !== "" && value !== (p.settings[target] ?? "")
        })
        if (moved.length > 0) {
          const secretKeys = Object.keys(p.credentials).filter((key) => schemaless(d) || d.fields.some((x) => x.key === key && x.secret))
          const missing = secretKeys.filter((key) => !setCredentials[key] && !removeCredentials.includes(key)).sort()
          if (missing.length > 0) throw bad(`herald: invalid provider: changing ${moved.join(" and ")} sends credentials to a new server; enter ${missing.join(", ")} again in the same update`)
        }
        if (f.name !== undefined && f.name !== null) p.name = str(f.name)
        if (Number.isInteger(f.priority)) p.priority = f.priority
        if (typeof f.enabled === "boolean") p.enabled = f.enabled
        for (const key of removeSettings) delete p.settings[key]
        Object.assign(p.settings, setSettings)
        for (const key of removeCredentials) delete p.credentials[key]
        Object.assign(p.credentials, protect(setCredentials))
        p.updatedAt = stamp()
        return { provider: providerSummary(p) }
      },
    },
    "providers.encryptStored": {
      kind: "command",
      invalidates: ["providers.list", "providers.detail", "overview.stats"],
      handler: () => {
        const app = appId()
        if (!keyConfigured()) throw bad("herald: no credential key is configured")
        let providers = 0
        let valuesEncrypted = 0
        let alreadyEncrypted = 0
        for (const p of state.providers) {
          if (p.appId !== app) continue
          let changed = false
          for (const key of Object.keys(p.credentials)) {
            if (p.credentials[key] === ENC) alreadyEncrypted++
            else {
              p.credentials[key] = ENC
              valuesEncrypted++
              changed = true
            }
          }
          if (changed) providers++
        }
        return { providers, valuesEncrypted, alreadyEncrypted }
      },
    },
    "templates.create": {
      kind: "command",
      invalidates: TEMPLATE_WRITE,
      handler: (f) => {
        const app = appId()
        const slug = str(f.slug)
        if (!SLUG.test(slug)) throw bad("slug must be lower-case letters, digits, dots, dashes or underscores")
        const name = str(f.name)
        if (!name) throw bad("name is required")
        const channel = str(f.channel)
        if (!CHANNELS.includes(channel)) throw bad("channel is not one Herald supports")
        const category = str(f.category) || "transactional"
        if (!CATEGORIES.includes(category)) throw bad("category must be auth, transactional, marketing or system")
        const version = f.version && typeof f.version === "object" ? f.version : null
        const locale = version ? str(version.locale) : ""
        if (version && locale !== "" && !LOCALE.test(locale)) throw bad("locale must be empty (the fallback) or a tag like en or pt-BR")
        const variables = checkVariables(Array.isArray(f.variables) ? f.variables : [])
        if (state.templates.some((t) => t.appId === app && t.slug === slug && t.channel === channel)) throw conflict("a template with this slug already exists on this channel")
        const t = stamp()
        const created = { id: next("htpl"), appId: app, slug, name, channel, category, isSystem: false, enabled: true, variables, versions: [], createdAt: t, updatedAt: t }
        if (version) created.versions.push({ id: next("htpv"), locale, subject: raw(version.subject), html: raw(version.html), text: raw(version.text), title: raw(version.title), active: true, createdAt: t, updatedAt: t })
        state.templates.push(created)
        return { template: templateSummary(created) }
      },
    },
    "templates.update": {
      kind: "command",
      invalidates: TEMPLATE_WRITE,
      handler: (f) => {
        const app = appId()
        const t = ownedTemplate(app, f.id)
        if (f.name !== undefined && f.name !== null && !str(f.name)) throw bad("name is required")
        if (f.category !== undefined && f.category !== null && !CATEGORIES.includes(f.category)) throw bad("category must be auth, transactional, marketing or system")
        const variables = Array.isArray(f.variables) ? checkVariables(f.variables) : null
        if (f.name !== undefined && f.name !== null) t.name = str(f.name)
        if (f.category !== undefined && f.category !== null) t.category = f.category
        if (typeof f.enabled === "boolean") t.enabled = f.enabled
        if (variables) t.variables = variables
        t.updatedAt = stamp()
        return { template: templateSummary(t) }
      },
    },
    "versions.create": {
      kind: "command",
      invalidates: VERSION_WRITE,
      handler: (f) => {
        const app = appId()
        const t = ownedTemplate(app, f.templateId)
        const locale = str(f.locale)
        if (locale !== "" && !LOCALE.test(locale)) throw bad("locale must be empty (the fallback) or a tag like en or pt-BR")
        if (t.versions.some((ver) => ver.locale === locale)) throw conflict("this template already has a version for that locale")
        const now = stamp()
        const ver = { id: next("htpv"), locale, subject: raw(f.subject), html: raw(f.html), text: raw(f.text), title: raw(f.title), active: f.active === undefined || f.active === null ? true : f.active === true, createdAt: now, updatedAt: now }
        t.versions.push(ver)
        t.updatedAt = now
        return { version: versionWire(ver) }
      },
    },
    "versions.update": {
      kind: "command",
      invalidates: VERSION_WRITE,
      handler: (f) => {
        const { t, ver } = ownedVersion(appId(), f.templateId, f.versionId)
        for (const key of ["subject", "html", "text", "title"]) if (typeof f[key] === "string") ver[key] = f[key]
        if (typeof f.active === "boolean") ver.active = f.active
        ver.updatedAt = stamp()
        t.updatedAt = ver.updatedAt
        return { version: versionWire(ver) }
      },
    },
    "versions.delete": {
      kind: "command",
      invalidates: VERSION_WRITE,
      handler: (f) => {
        const { t, ver } = ownedVersion(appId(), f.templateId, f.versionId)
        t.versions = t.versions.filter((x) => x.id !== ver.id)
        return { ok: true, id: ver.id }
      },
    },
    "templates.resetDefaults": {
      kind: "command",
      invalidates: TEMPLATE_WRITE,
      handler: () => {
        const app = appId()
        const before = state.templates.filter((t) => t.appId === app && t.isSystem).length
        state.templates = state.templates.filter((t) => !(t.appId === app && t.isSystem))
        let seeded = 0
        for (const spec of systemTemplates()) {
          if (state.templates.some((t) => t.appId === app && t.slug === spec.slug && t.channel === spec.channel)) continue
          const now = stamp()
          state.templates.push({ id: next("htpl"), appId: app, slug: spec.slug, name: spec.name, channel: spec.channel, category: spec.category, isSystem: true, enabled: true, variables: spec.variables, versions: spec.versions.map((ver) => ({ id: next("htpv"), ...ver, createdAt: now, updatedAt: now })), createdAt: now, updatedAt: now })
          seeded++
        }
        return { deleted: before, seeded }
      },
    },
    "send.test": {
      kind: "command",
      invalidates: ["messages.list", "messages.detail", "overview.stats", "inbox.list"],
      handler: (f) => {
        const app = appId()
        const channel = str(f.channel)
        if (!CHANNELS.includes(channel)) throw bad("channel is not one Herald supports")
        const recipient = str(f.recipient)
        if (!recipient) throw bad("recipient is required")
        const slug = str(f.template)
        const body = str(f.body)
        if (!slug && !body) throw bad("give a template or a body")
        if (slug && body) throw bad("give a template or a body, not both")
        const providerId = str(f.providerId)
        if (providerId && !typeId("hpvd").test(providerId)) throw bad("id is not a provider id")
        const userId = str(f.userId)
        let subject = raw(f.subject)
        let text = body
        const record = (fields) => {
          const now = stamp()
          const m = { id: next("hmsg"), appId: app, channel, recipient, templateSlug: slug, metadata: { source: "dashboard.send.test" }, attempts: 1, async: false, subject, body: text.slice(0, 4096), createdAt: now, ...fields }
          state.messages.push(m)
          return m
        }
        if (slug) {
          const t = state.templates.find((x) => x.appId === app && x.slug === slug && x.channel === channel)
          if (!t) throw notFound("template not found")
          if (!t.enabled) throw bad("herald: template is disabled")
          const locale = str(f.locale) || "en"
          const ver = t.versions.find((x) => x.id === explain(t, locale).versionId)
          if (!ver) throw bad(`herald: no template version for locale: template="${slug}" locale="${locale}"`)
          const values = withDefaults(t.variables, obj(f.data))
          for (const variable of t.variables) {
            if (variable.required && (values[variable.name] === undefined || values[variable.name] === "")) throw bad(`herald: missing required template variable: ${variable.name}`)
          }
          subject = substitute(ver.subject || ver.title, values)
          text = substitute(ver.text, values)
          if (userId && optedOut(app, userId, slug, channel)) {
            const m = record({ status: "suppressed", providerId: "", error: "user opted out" })
            return { messageId: m.id, status: "suppressed", provider: null, error: "user opted out", logged: true }
          }
        }
        const res = resolveSend(app, channel, providerId, "", userId)
        if (!res) throw bad(`herald: no provider configured for channel: channel=${channel}`)
        const failed = recipient.includes("fail")
        const now = stamp()
        const m = failed
          ? record({ status: "failed", providerId: res.p.id, error: `${res.p.driver}: 401 unauthorized: the provider refused the credentials` })
          : record({ status: "sent", providerId: res.p.id, sentAt: now, ...(res.p.driver === "inapp" ? {} : { providerMessageId: res.p.driver === "twilio" ? `SM${"0".repeat(31)}1` : `test@${res.p.driver}.example.com` }) })
        if (channel === "inapp" && userId && !failed) {
          state.inbox.push({ id: next("hinb"), appId: app, userId, type: slug || "dashboard.test", title: subject || "Test notification", body: text, read: false, metadata: {}, createdAt: now })
        }
        const out = { messageId: m.id, status: m.status, provider: { id: res.p.id, name: res.p.name, driver: res.p.driver }, logged: true }
        if (m.providerMessageId) out.providerMessageId = m.providerMessageId
        if (m.error) out.error = m.error
        return out
      },
    },
    "inbox.markRead": {
      kind: "command",
      invalidates: ["inbox.list"],
      handler: (f) => {
        const n = ownedNotification(appId(), f.id)
        if (!n.read) {
          n.read = true
          n.readAt = stamp()
        }
        return { ok: true, id: n.id }
      },
    },
    "inbox.markAllRead": {
      kind: "command",
      invalidates: ["inbox.list"],
      handler: (f) => {
        const app = appId()
        const userId = str(f.userId)
        if (!userId) throw bad("userId is required")
        const now = stamp()
        for (const n of state.inbox) {
          if (n.appId === app && n.userId === userId && !n.read) {
            n.read = true
            n.readAt = now
          }
        }
        return { ok: true }
      },
    },
    "preferences.optOut": {
      kind: "command",
      invalidates: ["preferences.get"],
      handler: (f) => {
        const app = appId()
        const userId = str(f.userId)
        if (!userId) throw bad("userId is required")
        const type = str(f.type)
        if (!type || bytes(type) > 256 || CONTROL.test(type)) throw bad("type must be 1 to 256 bytes with no control characters")
        const channel = str(f.channel)
        if (!PREF_CHANNELS.includes(channel)) throw bad("channel must be email, sms, push or inapp")
        let pref = state.preferences.find((p) => p.appId === app && p.userId === userId)
        if (!pref) {
          pref = { id: next("hprf"), appId: app, userId, overrides: {}, createdAt: stamp(), updatedAt: stamp() }
          state.preferences.push(pref)
        }
        const current = pref.overrides[type] ?? { email: null, sms: null, push: null, inapp: null }
        pref.overrides[type] = { ...current, [channel]: false }
        pref.updatedAt = stamp()
        return { preference: preferenceWire(pref) }
      },
    },
    "scopes.set": {
      kind: "command",
      invalidates: SCOPE_WRITE,
      handler: (f) => {
        const app = appId()
        const scope = str(f.scope)
        if (!SCOPE_ORDER.includes(scope)) throw bad("scope must be app, org or user")
        const scopeId = scope === "app" ? app : str(f.scopeId)
        if (scope !== "app" && !scopeId) throw bad("scopeId is required for an org or user rule")
        const existing = ruleFor(app, scope, scopeId)
        const draft = existing
          ? { ...existing }
          : { appId: app, scope, scopeId, emailProviderId: "", smsProviderId: "", pushProviderId: "", webhookProviderId: "", chatProviderId: "", fromEmail: "", fromName: "", fromPhone: "", defaultLocale: "", createdAt: stamp() }
        for (const key of [...ROUTED.map((ch) => `${ch}ProviderId`), "fromEmail", "fromName", "fromPhone"]) {
          if (typeof f[key] === "string") draft[key] = f[key].trim()
        }
        // Every slot of the merged rule is checked, the ones not sent too,
        // which is why a rule naming a deleted provider can't be saved until
        // that slot is cleared.
        for (const ch of ROUTED) {
          const id = draft[`${ch}ProviderId`]
          if (!id) continue
          if (!state.providers.some((p) => p.id === id && p.appId === app && p.channel === ch)) {
            throw bad(`herald: invalid provider: ${ch}_provider_id "${id}" is not a ${ch} provider of this app`)
          }
        }
        draft.updatedAt = stamp()
        if (existing) Object.assign(existing, draft)
        else {
          draft.id = next("hscf")
          state.scopes.push(draft)
        }
        return { rule: projectRule(existing ?? draft, app) }
      },
    },
    "scopes.delete": {
      kind: "command",
      invalidates: SCOPE_WRITE,
      handler: (f) => {
        const app = appId()
        const scope = str(f.scope)
        if (!SCOPE_ORDER.includes(scope)) throw bad("scope must be app, org or user")
        const scopeId = scope === "app" ? app : str(f.scopeId)
        if (scope !== "app" && !scopeId) throw bad("scopeId is required for an org or user rule")
        const r = ruleFor(app, scope, scopeId)
        if (!r) throw notFound("routing rule not found")
        state.scopes = state.scopes.filter((x) => x !== r)
        return { ok: true, id: r.id }
      },
    },
    "inbox.delete": {
      kind: "command",
      invalidates: ["inbox.list"],
      handler: (f) => {
        const n = ownedNotification(appId(), f.id)
        state.inbox = state.inbox.filter((x) => x !== n)
        return { ok: true, id: n.id }
      },
    },
    "templates.delete": {
      kind: "command",
      invalidates: TEMPLATE_WRITE,
      handler: (f) => {
        const t = ownedTemplate(appId(), f.id)
        state.templates = state.templates.filter((x) => x !== t)
        return { ok: true, id: t.id }
      },
    },
    "providers.delete": {
      kind: "command",
      invalidates: PROVIDER_WRITE,
      handler: (f) => {
        const p = ownedProvider(appId(), f.id)
        state.providers = state.providers.filter((x) => x !== p)
        return { ok: true, id: p.id }
      },
    },
  }
}
