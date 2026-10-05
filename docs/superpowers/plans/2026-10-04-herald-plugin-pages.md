# Herald plugin pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/plugin-herald` with every page except the template workspace, the herald fixture contributor, and the shell wiring, so an operator can run Herald from the React shell against the fixture server.

**Architecture:** A plugin package in Vault's shape (`src/index.tsx`, `src/pages/`, `src/components/`, `src/badges.tsx`, `src/wire.ts`, `test/harness.tsx` plus a test per page) reading and writing Herald through the 32 intents of the `herald` contract (Herald main at 0325975). A fixture module (`packages/fixture-server/herald-fixtures.mjs`) models that contract in memory so the shell can be clicked through. The template workspace (CodeMirror editor, locale rail, review changes) is plan 2b-2; this plan ships the rendered-preview component it will reuse, because Send test needs it first.

**Tech Stack:** React 19, TypeScript 6, vitest 5 with jsdom and Testing Library, `@forge-go/dashboard-plugin` (definePlugin, useQuery, useCommand, usePluginClient), `@forge-go/dashboard-kit` blocks, Node ESM for the fixture server.

**Spec:** `docs/superpowers/specs/2026-09-30-herald-dashboard-design.md`, sections "The plugin", "Fixtures" and "Wiring and bundle". The wire shapes come from Herald's code, not the spec: `forgery/herald/extension/contract` at 0325975.

This is plan 2b-1 of spec 2. Plan 2b-2 adds the template workspace (route `/templates/:id`) and the bundle baseline. Until 2b-2 lands, template rows link to a route that does not exist yet; nothing is pushed in between.

## Global Constraints

- Work in `/Users/rexraphael/Work/xraph/forge-dashboard` on `main`. No worktrees. Other sessions share this checkout.
- Commit only your own paths: `git add <exact new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .` or a directory. Never `--amend`. Never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. To undo your own change to one file, back it up and restore that file alone.
- Files with other sessions' uncommitted edits (today `packages/fixture-server/verify.mjs`) are edited with the Edit tool only, never `sed -i`, `>` or a rewrite script, and committed through a temporary index so only your hunks land (Task 1 shows the procedure).
- `apps/shell/src/styles.css` is untracked and belongs to the shell's owners. Add Herald's `@source` line to it and do not commit it.
- Commit messages: no `Co-Authored-By`, no Claude or Anthropic attribution of any kind, no em or en dashes. Subject only is fine.
- Plugin identity: `extension: "herald"`, `namespace: "herald"`, `label: "Herald"`. `definePlugin` throws for any label that does not spell the extension, so the spec's "Notifications" is the nav group, never the label.
- Wire types live in `src/wire.ts` and copy Herald's JSON tags exactly (camelCase). Never invent a field.
- Pages are plain components taking `PluginPageProps`; links go through `PluginLink` with scope-relative paths (`/providers/x`, never `/@herald/...`).
- The five display conventions: identifier values (message IDs, provider IDs, driver names, template slugs, locales, notification types, vendor message IDs, key IDs, user and org IDs) carry `font-mono text-xs`; the column an operator reads carries `font-medium`; every table caption carries a live count, including at zero; a cell meaning "none" uses `NoneCell`, `TagList` or `Timestamp`, never a blank or a bare dash; a badge's colour is an attention budget (mapping and reasons in `src/badges.tsx`). No green, emerald, lime or teal classes anywhere.
- Every page header names the app from `engine.info` through `HeraldHeader`: "Default app" for the `""` app, otherwise the app ID in `font-mono text-xs`.
- The copy never says "delivered" for `sent`. It says "Accepted by provider". Wherever a single send is shown: "Herald doesn't receive delivery receipts, so delivery isn't confirmed."
- Credential values are write-only. Secret inputs are uncontrolled `type="password"` with `autoComplete="new-password"` and `spellCheck={false}`, no `value` prop, read from a ref at submit, cleared on success, kept on failure. A value never enters React state, a query param, a label, an error string or the fixture's stored state.
- Optional query filters are left out of params, never sent as `""` (params are the query cache key).
- `ConfirmDialog` always gets `pending={cmd.loading}`; the command's `reset()` runs when the dialog opens; `onOpenChange` ignores a close while loading; `CommandAlert` sits inside the dialog.
- `execute()` resolves `undefined` only when the client throws, so `if (result === undefined) return` is the failure check. A failure test uses a client that throws a `ContractError`.
- Per package before every commit: `pnpm --filter @forge-go/dashboard-plugin-herald test`, `... typecheck`, `... lint` all clean. `packages/host/test/setup-screen.test.tsx` fails for unrelated reasons; leave it.
- No new dependencies in this plan. CodeMirror arrives with plan 2b-2.

## Review Focus

1. A credential typed into the provider form must never reach markup, React state, a query, or an error string, on create, replace, failure and CONFLICT. Task 4 pins it with a canary on every path.
2. Changing a filter on a cursor-paged list must go back to the first page and must not send the old cursor. Tasks 6 and 7 pin it.
3. The Send test confirm must name the provider that will actually send: the pinned one, or `send.resolve`'s answer when none is chosen, and say when it is disabled. A provider failure must render as a failed result with the provider's text, not as an error banner. Task 11 pins both.
4. No control anywhere can set a preference channel back on, and the opt-out confirm names the user, the type and the channel. Task 8 pins it.
5. Editing a routing rule whose provider was deleted must save rather than hit the server's "is not a email provider of this app" refusal: the dangling slot clears. Task 9 pins it.

---

## File map

Created in `packages/plugin-herald/`:
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- `src/index.tsx`: `definePlugin`, nav, routes, barrel
- `src/wire.ts`: every request and response type
- `src/format.ts`: counting, labels, channel lists (no React)
- `src/keys.ts`: route path builders
- `src/badges.tsx`: every badge with its reasons
- `src/components/herald-header.tsx`: `useEngineInfo`, `HeraldHeader`, `AppLine`
- `src/components/cursor-pager.tsx`: `useCursorStack`, `CursorPager` (copied from plugin-relay)
- `src/use-debounced.ts`: `useDebounced`
- `src/components/preview/sms.ts`, `src/components/preview/srcdoc.ts`, `src/components/preview/rendered-preview.tsx`, `src/components/preview/use-render-preview.ts`
- `src/pages/overview.tsx`, `providers.tsx`, `provider-detail.tsx`, `provider-form.tsx`, `templates.tsx`, `template-create.tsx`, `messages.tsx`, `message-detail.tsx`, `inbox.tsx`, `preferences.tsx`, `routing.tsx`, `send-test.tsx`
- `test/harness.tsx`, `test/setup.ts`, `test/data.ts`, `test/plugin.test.tsx`, `test/badges.test.tsx`, `test/format.test.ts`, one `test/<page>.test.tsx` per page, `test/preview.test.tsx`, `test/structure.test.ts`

Created in `packages/fixture-server/`: `herald-fixtures.mjs`, `herald-verify.mjs`.

Modified: `packages/fixture-server/server.mjs` (import, `CONTRIBUTORS` entry, `resetHerald()`), `packages/fixture-server/verify.mjs` (import, `...HERALD_INPUT`, `await verifyHerald(...)`), `apps/shell/package.json`, `apps/shell/src/App.tsx`, `pnpm-lock.yaml`, and, uncommitted, `apps/shell/src/styles.css`.

---
### Task 1: The herald fixture contributor

The shell has nothing to show until the fixture server speaks `herald`. This task adds the contributor in the newest pattern (Sentinel's): a self-contained `herald-fixtures.mjs`, a `herald-verify.mjs` with its own inputs and spot checks, and three small hooks each in `server.mjs` and `verify.mjs`. The fixture models Herald's contract at 0325975, including its unhelpful answers: another app's row is `NOT_FOUND`, and a routing rule with a deleted provider can't be saved until that slot is cleared.

**Files:**
- Create: `packages/fixture-server/herald-fixtures.mjs`, `packages/fixture-server/herald-verify.mjs`
- Modify: `packages/fixture-server/server.mjs` (clean in git: import after the sentinel import, `CONTRIBUTORS` entry after sentinel's, `resetHerald()` after `resetSentinel()` in `handleReset`)
- Modify: `packages/fixture-server/verify.mjs` (carries another session's uncommitted edits: Edit tool only, temporary-index commit)

**Interfaces:**
- Produces: `createHeraldHandlers(FixtureError)`, `resetHerald()`, `HERALD_IDS` (seeded and walk-created IDs), `tid(prefix, n)`; `HERALD_INPUT`, `verifyHerald({ dispatch, getCSRF, failures })`.
- Seed facts later tasks' click-through relies on: app `app_demo`; providers "Primary SMTP" (smtp, encrypted), "Twilio" (twilio, plaintext), "Resend backup" (resend, disabled), "inapp (default)", "Legacy SMS gateway" (driver `legacy-sms`, no schema); templates `auth.welcome` (email and inapp), `auth.password-reset`, `auth.mfa-code`, `billing.receipt` (custom, with a `""` fallback, `en`, and an inactive `fr`), `ops.digest` (custom, disabled); 60 messages; user `usr_ada` with 30 notifications and two opt-outs; routing rules for the app, `org_acme` (its email provider was deleted) and `usr_ada`.

- [ ] **Step 1: Write the fixture module**

`packages/fixture-server/herald-fixtures.mjs`:

```js
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
      const phone = r?.fromPhone || s.from
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
        const credentials = stringMap(f.credentials)
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
        const setCredentials = stringMap(f.setCredentials)
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
```

- [ ] **Step 2: Write the verify module**

`packages/fixture-server/herald-verify.mjs`:

```js
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
```

- [ ] **Step 3: Hook it into server.mjs**

`server.mjs` has no uncommitted edits from anyone else (check with `git diff --stat packages/fixture-server/server.mjs`; if that prints anything, stop and use the temporary-index procedure from Step 4 for this file too). With the Edit tool, make three insertions:

1. After `import { createSentinelHandlers, resetSentinel } from "./sentinel-fixtures.mjs"`:
   ```js
   import { createHeraldHandlers, resetHerald } from "./herald-fixtures.mjs"
   ```
2. After the line `{ name: "sentinel", envPrefix: "SENTINEL", handlers: createSentinelHandlers(FixtureError) },` in `CONTRIBUTORS`:
   ```js
     { name: "herald", envPrefix: "HERALD", handlers: createHeraldHandlers(FixtureError) },
   ```
3. After `resetSentinel()` in `handleReset`:
   ```js
     resetHerald()
   ```

If the header comment near the top lists each contributor (e.g. `- sentinel (packages/plugin-sentinel) ...`), add a line in the same style: `- herald (packages/plugin-herald) 14 queries, 18 commands, see herald-fixtures.mjs`.

- [ ] **Step 4: Hook it into verify.mjs, Edit tool only**

`verify.mjs` holds another session's uncommitted hunks. Record their size first: `git diff --stat packages/fixture-server/verify.mjs` (write the numbers down). With the Edit tool, make three insertions:

1. After `import { SENTINEL_INPUT, verifySentinel } from "./sentinel-verify.mjs"`:
   ```js
   import { HERALD_INPUT, verifyHerald } from "./herald-verify.mjs"
   ```
2. After the line `  ...SENTINEL_INPUT,` inside `INPUT`:
   ```js
     ...HERALD_INPUT,
   ```
3. After `await verifySentinel({ dispatch, getCSRF, failures })`:
   ```js
     await verifyHerald({ dispatch, getCSRF, failures })
   ```

- [ ] **Step 5: Run it**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
SERVER=$!
node packages/fixture-server/verify.mjs http://localhost:8099 2>&1 | tee /tmp/herald-verify.log | grep -E "herald|FAIL|failures" | head -80
kill $SERVER
```

Expected: every `herald::` intent passes in the walk, every `herald ...` spot check prints `true`, and the summary has no herald failures. Failures from other contributors that were failing before your change are not yours; compare against a run with your three verify.mjs lines temporarily absent only if the summary is ambiguous. Port 8099 may be taken by another session's server: if `node` reports `EADDRINUSE`, use `FIXTURE_PORT=8299` and pass `http://localhost:8299`.

- [ ] **Step 6: Commit**

First the new files and `server.mjs` (clean in git, so `--only` is safe):

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/fixture-server/herald-fixtures.mjs packages/fixture-server/herald-verify.mjs
git commit --only -m "feat(fixture-server): serve herald's contract" -- packages/fixture-server/herald-fixtures.mjs packages/fixture-server/herald-verify.mjs packages/fixture-server/server.mjs
git show --stat HEAD
```

Then `verify.mjs` through a temporary index, so only your three lines land:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
SCR=$(mktemp -d)
git show HEAD:packages/fixture-server/verify.mjs > "$SCR/head.mjs"
cp "$SCR/head.mjs" "$SCR/blob.mjs"
```

Apply the same three insertions to `$SCR/blob.mjs` (a scratch copy, so any editor is fine here), then prove both directions:

```bash
git diff --no-index --stat "$SCR/head.mjs" "$SCR/blob.mjs"      # 3 insertions, nothing else
git diff --no-index "$SCR/blob.mjs" packages/fixture-server/verify.mjs | head -60   # only the other session's hunks
BLOB=$(git hash-object -w "$SCR/blob.mjs")
OLD=$(git rev-parse HEAD)
export GIT_INDEX_FILE="$SCR/index"
git read-tree HEAD
git update-index --cacheinfo "100644,$BLOB,packages/fixture-server/verify.mjs"
TREE=$(git write-tree)
NEW=$(git commit-tree "$TREE" -p "$OLD" -m "test(fixture-server): walk herald's intents and check its rules")
unset GIT_INDEX_FILE
git update-ref refs/heads/main "$NEW" "$OLD"
git reset -q -- packages/fixture-server/verify.mjs
git show --stat HEAD
git diff --stat packages/fixture-server/verify.mjs
```

The last command must print the other session's numbers you wrote down in Step 4, unchanged. `git reset -q -- <path>` only refreshes the index entry for that path; it never touches the working tree.

---
### Task 2: Scaffold, wire types, badges, the app header, Overview, and the shell mount

**Files:**
- Create: `packages/plugin-herald/{package.json,tsconfig.json,vitest.config.ts,eslint.config.js}`
- Create: `packages/plugin-herald/src/{index.tsx,wire.ts,format.ts,keys.ts,badges.tsx,use-debounced.ts}`, `src/components/herald-header.tsx`, `src/pages/overview.tsx`
- Create: `packages/plugin-herald/test/{setup.ts,harness.tsx,data.ts,plugin.test.tsx,badges.test.tsx,format.test.ts,herald-header.test.tsx,overview.test.tsx}`
- Modify: `apps/shell/package.json`, `apps/shell/src/App.tsx`, `pnpm-lock.yaml`; and, not committed, `apps/shell/src/styles.css`

**Interfaces:**
- Produces, used by every later task:
  - `src/wire.ts`: every type below, names fixed.
  - `src/format.ts`: `plural(n, one, many?)`, `credentialSummary(creds)`, `statusLabel(status)`, `STATUS_ORDER`, `WRITTEN_STATUSES`, `PREF_CHANNELS`, `ROUTED_CHANNELS`, `CATEGORIES`, `NO_RECEIPTS`.
  - `src/keys.ts`: `providerPath`, `providerEditPath`, `providerSendTestPath`, `templatePath`, `messagePath`, `messageSendTestPath`.
  - `src/badges.tsx`: `MessageStatusBadge`, `EnabledBadge`, `ProtectionBadge`, `VersionBadge`, `DanglingBadge`, `DisabledProviderBadge`.
  - `src/components/herald-header.tsx`: `useEngineInfo(): QueryState<EngineInfoResponse>`, `HeraldHeader({ title, description?, actions? })`, `AppLine`.
  - `src/use-debounced.ts`: `useDebounced<T>(value: T, ms: number): T`.
  - `test/harness.tsx`: `stubClient`, `recordingCommandClient`, `recordingQueryClient`, `failingClient`, `pendingClient`, `scriptedClient`, `renderPage`, `renderWithNavigate`.
  - `test/data.ts`: `ENGINE`, `engine(over)`, `providerSummary(over)`, `providerDetail(over)`, `templateSummary(over)`, `templateDetail(over)`, `messageSummary(over)`, `messageDetail(over)`, `notification(over)`, `scopeRule(over)`.
  - `index.tsx`: `heraldPlugin` (default and named). Each later task appends its nav entry, its route and its page export, and adds its route to the two lists in `test/plugin.test.tsx`.

- [ ] **Step 1: Package files**

`packages/plugin-herald/package.json`:

```json
{
  "name": "@forge-go/dashboard-plugin-herald",
  "version": "0.0.0",
  "type": "module",
  "files": ["src"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "test": "vitest run",
    "lint": "eslint",
    "format": "prettier --write \"**/*.{ts,tsx}\"",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@forge-go/dashboard-kit": "^0.1.0",
    "@forge-go/dashboard-plugin": "^0.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@eslint/js": "^10",
    "@forge-go/dashboard-kit": "workspace:*",
    "@forge-go/dashboard-plugin": "workspace:*",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6",
    "eslint": "^10",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17",
    "jsdom": "^25.0.1",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "typescript": "~6",
    "typescript-eslint": "^8",
    "vitest": "^5.0.0"
  },
  "exports": {
    ".": "./src/index.tsx"
  }
}
```

`packages/plugin-herald/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

`packages/plugin-herald/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["../test-support/jsdom-setup.ts", "./test/setup.ts"],
  },
})
```

`packages/plugin-herald/eslint.config.js`: copy `packages/plugin-vault/eslint.config.js` byte for byte (`cp packages/plugin-vault/eslint.config.js packages/plugin-herald/eslint.config.js`).

`packages/plugin-herald/test/setup.ts`:

```ts
// jsdom 25 has no PointerEvent, and base-ui's checkbox, radio and switch build
// one on click. MouseEvent carries every field they read. This file runs after
// the shared jsdom setup, which this package must not edit.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", {
    value: window.MouseEvent,
    configurable: true,
  })
}
```

- [ ] **Step 2: Wire types**

`packages/plugin-herald/src/wire.ts`:

```ts
/*
 * The herald contract's wire shapes. Field names are the JSON tags in
 * forgery/herald/extension/contract (project.go and the handlers) at 0325975.
 * Optional fields are the Go `omitempty` ones; `| null` is what Go writes as
 * null. Every slice and map in a response is non-nil, so it arrives as an
 * array or an object, never null.
 */

export type ISODate = string
export type Channel = "email" | "sms" | "push" | "inapp" | "webhook" | "chat"
export type RoutedChannel = "email" | "sms" | "push" | "webhook" | "chat"
export type PrefChannel = "email" | "sms" | "push" | "inapp"
export type MessageStatus = "queued" | "sending" | "sent" | "failed" | "bounced" | "delivered" | "suppressed"
export type Protection = "aes-256-gcm" | "plaintext"
export type Placement = "credential" | "setting"
export type ScopeType = "app" | "org" | "user"
export type ResolveVia = "user" | "org" | "app" | "fallback" | "chosen" | "none"
export type ResolveMatch = "exact" | "language" | "default" | "none"
export type OverviewWindow = "24h" | "7d" | "30d"
export type TemplateField = "subject" | "html" | "text" | "title"

export interface AppRef {
  id: string
  /** "Default app" when id is "". */
  label: string
}
export interface FieldInfo {
  key: string
  label: string
  help?: string
  required: boolean
  secret: boolean
  placement: Placement
}
export interface DriverInfo {
  name: string
  channel: string
  /** null: the driver has no schema. []: it needs nothing (inapp). */
  fields: FieldInfo[] | null
}
export interface EngineInfoResponse {
  app: AppRef
  defaultLocale: string
  maxBatchSize: number
  truncateBodyAt: number
  channels: Channel[]
  drivers: DriverInfo[]
  templateFuncs: string[]
  encryption: { configured: boolean; keyId?: string }
  apiProtected: boolean
}

export interface MessageCount {
  status: MessageStatus
  channel: string
  n: number
}
export interface TemplateRef {
  id: string
  slug: string
  channel?: string
}
export interface OverviewStatsResponse {
  since: ISODate
  counts: MessageCount[]
  providers: { total: number; enabled: number }
  credentials: { plaintext: number; encrypted: number }
  templatesWithoutFallback: TemplateRef[]
}

/** Never a value: key, protection, and the key ID for encrypted values. */
export interface CredentialStatus {
  key: string
  protection: Protection
  keyId?: string
}
export interface ProviderSummary {
  id: string
  name: string
  channel: string
  driver: string
  priority: number
  enabled: boolean
  credentials: CredentialStatus[]
  createdAt: ISODate
  updatedAt: ISODate
}
/** value is omitted when secret, including every setting of a driver with no schema. */
export interface SettingEntry {
  key: string
  value?: string
  secret: boolean
}
export interface RouteUse {
  scope: ScopeType
  scopeId: string
  channel: RoutedChannel
}
export interface ProviderDetail extends ProviderSummary {
  settings: SettingEntry[]
  usedBy: RouteUse[]
}
export interface ProvidersListResponse {
  providers: ProviderSummary[]
}
export interface ProvidersDetailResponse {
  provider: ProviderDetail
}
export interface ProviderResponse {
  provider: ProviderSummary
}
export interface ProvidersCreateRequest {
  name: string
  channel: string
  driver: string
  priority: number
  /** Omitted means false on the server, so it is always sent. */
  enabled: boolean
  credentials?: Record<string, string>
  settings?: Record<string, string>
}
export interface ProvidersUpdateRequest {
  id: string
  name?: string
  priority?: number
  enabled?: boolean
  setCredentials?: Record<string, string>
  removeCredentials?: string[]
  setSettings?: Record<string, string>
  removeSettings?: string[]
}
export interface ProvidersEncryptStoredResponse {
  providers: number
  valuesEncrypted: number
  alreadyEncrypted: number
}
export interface DeleteResponse {
  ok: true
  id: string
}

export interface LocaleState {
  locale: string
  active: boolean
}
export interface TemplateSummary {
  id: string
  slug: string
  name: string
  channel: string
  category: string
  isSystem: boolean
  enabled: boolean
  locales: LocaleState[]
  hasFallback: boolean
  updatedAt: ISODate
}
export interface VariableWire {
  name: string
  type: string
  required: boolean
  default?: string
  description?: string
}
export interface VersionWire {
  id: string
  locale: string
  subject: string
  html: string
  text: string
  title: string
  active: boolean
  createdAt: ISODate
  updatedAt: ISODate
}
export interface ResolutionEntry {
  locale: string
  versionId: string | null
  match: ResolveMatch
}
export interface TemplateDetail extends TemplateSummary {
  variables: VariableWire[]
  versions: VersionWire[]
}
export interface TemplatesListResponse {
  templates: TemplateSummary[]
}
export interface TemplatesDetailResponse {
  template: TemplateDetail
  resolution: ResolutionEntry[]
}
export interface ResolveStep {
  try: string
  match: ResolveMatch
  found: boolean
  versionId?: string
}
export interface TemplatesResolveResponse {
  locale: string
  steps: ResolveStep[]
  versionId: string | null
  match: ResolveMatch
}
export interface Content {
  subject: string
  html: string
  text: string
  title: string
}
export interface TemplatesRenderRequest {
  templateId?: string
  content: Content
  /** Absent: the stored template's variables apply. [] declares none. */
  variables?: VariableWire[]
  data?: Record<string, unknown>
}
export interface FieldOutput {
  field: TemplateField
  output: string
  rendered: boolean
}
export type DiagnosticKind = "parse" | "exec" | "escape" | "missing" | "undeclared" | "unprovided"
export interface Diagnostic {
  /** "" for missing and unprovided, which also have line and column 0. */
  field: TemplateField | ""
  /** 1-based; 0 means Go reported none. */
  line: number
  /** 1-based character column; 0 means none (a parse error has none). */
  column: number
  severity: "error" | "warning"
  kind: DiagnosticKind
  message: string
}
export interface PreviewResult {
  fields: FieldOutput[]
  diagnostics: Diagnostic[]
}
export interface TemplatesCreateRequest {
  slug: string
  name: string
  channel: string
  category: string
  version?: { locale: string }
}
export interface TemplateResponse {
  template: TemplateSummary
}
export interface TemplatesResetDefaultsResponse {
  deleted: number
  seeded: number
}

export interface ProviderRef {
  id: string
  /** Always present; "" when the post-send lookup failed. */
  name: string
  driver?: string
  /** Only send.resolve sets it. */
  enabled?: boolean
}
export interface MessageSummary {
  id: string
  recipient: string
  channel: string
  status: MessageStatus
  templateSlug?: string
  provider: ProviderRef | null
  error?: string
  createdAt: ISODate
  sentAt?: ISODate
}
export interface MessageDetail extends MessageSummary {
  subject?: string
  /** The text part only, cut at engine.info's truncateBodyAt bytes. */
  body: string
  metadata: Record<string, string>
  attempts: number
  async: boolean
  envId?: string
  providerMessageId?: string
  template: TemplateRef | null
}
export interface MessagesListResponse {
  messages: MessageSummary[]
  nextCursor?: string
}
export interface MessagesDetailResponse {
  message: MessageDetail
}

export interface SendResolveResponse {
  provider: ProviderRef | null
  via: ResolveVia
  from: { email?: string; name?: string; phone?: string }
}
export interface SendTestRequest {
  channel: string
  recipient: string
  providerId?: string
  template?: string
  locale?: string
  data?: Record<string, unknown>
  subject?: string
  body?: string
  userId?: string
}
export interface SendTestResponse {
  messageId?: string
  status: MessageStatus
  provider: ProviderRef | null
  providerMessageId?: string
  error?: string
  logged: boolean
}

export interface NotificationWire {
  id: string
  userId: string
  type: string
  title: string
  body?: string
  actionUrl?: string
  imageUrl?: string
  read: boolean
  readAt?: ISODate
  metadata: Record<string, string>
  expiresAt?: ISODate
  createdAt: ISODate
}
export interface InboxListResponse {
  notifications: NotificationWire[]
  unread: number
  nextCursor?: string
}
export interface InboxOKResponse {
  ok: true
  id?: string
}

/** null: never set, so the user gets it. */
export interface ChannelPreferenceWire {
  email: boolean | null
  sms: boolean | null
  push: boolean | null
  inapp: boolean | null
}
export interface PreferenceWire {
  id: string
  userId: string
  overrides: Record<string, ChannelPreferenceWire>
  updatedAt: ISODate
}
export interface PreferencesGetResponse {
  preference: PreferenceWire | null
  knownTypes: string[]
}
export interface PreferencesOptOutResponse {
  preference: PreferenceWire
}

export interface RoutedProvider {
  id: string
  /** Omitted when dangling. */
  name?: string
  dangling: boolean
}
export interface ScopeRule {
  id: string
  scope: ScopeType
  /** The app ID for an app rule, which can be "". */
  scopeId: string
  providers: Partial<Record<RoutedChannel, RoutedProvider>>
  fromEmail?: string
  fromName?: string
  fromPhone?: string
  defaultLocale?: string
  /** Always true: Send never reads a rule's default locale. */
  defaultLocaleUnused: boolean
  updatedAt: ISODate
}
export interface ScopesListResponse {
  rules: ScopeRule[]
}
export interface ScopesSetRequest {
  scope: ScopeType
  scopeId?: string
  emailProviderId?: string
  smsProviderId?: string
  pushProviderId?: string
  webhookProviderId?: string
  chatProviderId?: string
  fromEmail?: string
  fromName?: string
  fromPhone?: string
}
export interface ScopesSetResponse {
  rule: ScopeRule
}
```

- [ ] **Step 3: Write the failing tests for format, keys and badges**

`packages/plugin-herald/test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { credentialSummary, plural, statusLabel, STATUS_ORDER } from "../src/format"
import { messagePath, providerPath, providerSendTestPath, templatePath } from "../src/keys"

describe("plural", () => {
  it("uses the singular for one and the plural otherwise, zero included", () => {
    expect(plural(1, "provider")).toBe("1 provider")
    expect(plural(0, "provider")).toBe("0 providers")
    expect(plural(2, "category", "categories")).toBe("2 categories")
  })
})

describe("credentialSummary", () => {
  it("is null with no credentials, so the cell can say none", () => {
    expect(credentialSummary([])).toBeNull()
  })

  it("counts plaintext before encrypted, and never says encrypted without evidence", () => {
    expect(credentialSummary([{ key: "a", protection: "aes-256-gcm", keyId: "k1" }, { key: "b", protection: "aes-256-gcm", keyId: "k1" }, { key: "c", protection: "aes-256-gcm", keyId: "k1" }])).toBe("3 encrypted")
    expect(credentialSummary([{ key: "a", protection: "plaintext" }, { key: "b", protection: "plaintext" }, { key: "c", protection: "aes-256-gcm", keyId: "k1" }])).toBe("2 plaintext, 1 encrypted")
    expect(credentialSummary([{ key: "a", protection: "plaintext" }])).toBe("1 plaintext")
  })
})

describe("statusLabel", () => {
  it("never calls sent delivered", () => {
    expect(statusLabel("sent")).toBe("Accepted by provider")
    for (const status of STATUS_ORDER) {
      if (status !== "delivered") expect(statusLabel(status).toLowerCase()).not.toContain("delivered")
    }
  })
})

describe("paths", () => {
  it("encodes every segment", () => {
    expect(providerPath("hpvd_1")).toBe("/providers/hpvd_1")
    expect(providerSendTestPath("hpvd_1")).toBe("/providers/hpvd_1/send-test")
    expect(templatePath("a/b")).toBe("/templates/a%2Fb")
    expect(messagePath("hmsg_1")).toBe("/messages/hmsg_1")
  })
})
```

`packages/plugin-herald/test/badges.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  DanglingBadge,
  DisabledProviderBadge,
  EnabledBadge,
  MessageStatusBadge,
  ProtectionBadge,
  VersionBadge,
} from "../src/badges"
import type { MessageStatus } from "../src/wire"

function badge(text: string): HTMLElement {
  return screen.getByText(text, { selector: '[data-slot="badge"]' })
}

describe("MessageStatusBadge", () => {
  const cases: [MessageStatus, string, RegExp][] = [
    ["sent", "Accepted by provider", /outline/],
    ["sending", "Sending", /secondary/],
    ["suppressed", "Suppressed", /secondary/],
    ["failed", "Failed", /destructive/],
    ["queued", "Queued", /outline/],
    ["delivered", "Delivered", /outline/],
    ["bounced", "Bounced", /destructive/],
  ]
  it.each(cases)("%s reads %s with %s", (status, text, variant) => {
    render(<MessageStatusBadge status={status} />)
    expect(badge(text).className).toMatch(variant)
  })

  it("shows an unknown status as it came, outline", () => {
    render(<MessageStatusBadge status={"retrying" as MessageStatus} />)
    expect(badge("retrying").className).toMatch(/outline/)
  })
})

describe("the other badges", () => {
  it("enabled recedes and disabled is notable", () => {
    render(<><EnabledBadge enabled /><EnabledBadge enabled={false} /></>)
    expect(badge("Enabled").className).toMatch(/outline/)
    expect(badge("Disabled").className).toMatch(/secondary/)
  })

  it("protection names the algorithm only with evidence, and never colours plaintext red", () => {
    render(<><ProtectionBadge protection="aes-256-gcm" /><ProtectionBadge protection="plaintext" /></>)
    expect(badge("Encrypted").className).toMatch(/outline/)
    expect(badge("Plaintext").className).toMatch(/secondary/)
    expect(badge("Plaintext").className).not.toMatch(/destructive/)
  })

  it("a live version recedes and an inactive one is notable", () => {
    render(<><VersionBadge active /><VersionBadge active={false} /></>)
    expect(badge("Live").className).toMatch(/outline/)
    expect(badge("Inactive").className).toMatch(/secondary/)
  })

  it("a dangling provider is what you came to find", () => {
    render(<DanglingBadge />)
    expect(badge("Provider deleted").className).toMatch(/destructive/)
  })

  it("a disabled provider in a send is a warning, not a failure", () => {
    render(<DisabledProviderBadge />)
    expect(badge("Provider disabled").className).toMatch(/default/)
  })
})
```

Run: `cd packages/plugin-herald && pnpm install --offline 2>/dev/null; npx vitest run test/format.test.ts test/badges.test.tsx`. Expected: FAIL, the modules don't exist. (If `vitest` itself is missing because the package isn't installed yet, run Step 9's `pnpm install` first, then come back.)

- [ ] **Step 4: format, keys, badges, useDebounced**

`packages/plugin-herald/src/format.ts`:

```ts
import type { CredentialStatus, MessageStatus } from "./wire"

/** "1 provider", "0 providers", "2 categories". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "3 encrypted", "2 plaintext, 1 encrypted", or null for none. Plaintext comes
 * first because it is the part somebody has to act on.
 */
export function credentialSummary(creds: CredentialStatus[]): string | null {
  if (creds.length === 0) return null
  const plaintext = creds.filter((c) => c.protection !== "aes-256-gcm").length
  const encrypted = creds.length - plaintext
  const parts: string[] = []
  if (plaintext > 0) parts.push(`${plaintext} plaintext`)
  if (encrypted > 0) parts.push(`${encrypted} encrypted`)
  return parts.join(", ")
}

/** Column and filter order: the common outcome first, then what needs a look. */
export const STATUS_ORDER: MessageStatus[] = ["sent", "sending", "suppressed", "failed", "queued", "delivered", "bounced"]

/** The four statuses Herald writes today. The other three never occur. */
export const WRITTEN_STATUSES: MessageStatus[] = ["sending", "sent", "failed", "suppressed"]

const STATUS_LABELS: Record<MessageStatus, string> = {
  sent: "Accepted by provider",
  sending: "Sending",
  suppressed: "Suppressed",
  failed: "Failed",
  queued: "Queued",
  delivered: "Delivered",
  bounced: "Bounced",
}

/** Never "delivered" for sent: a provider accepting a message is all Herald knows. */
export function statusLabel(status: MessageStatus): string {
  return STATUS_LABELS[status] ?? status
}

/** Said wherever a single send is shown. */
export const NO_RECEIPTS = "Herald doesn't receive delivery receipts, so delivery isn't confirmed."

export const PREF_CHANNELS = ["email", "sms", "push", "inapp"] as const
export const ROUTED_CHANNELS = ["email", "sms", "push", "webhook", "chat"] as const
export const CATEGORIES = ["auth", "transactional", "marketing", "system"] as const
```

`packages/plugin-herald/src/keys.ts`:

```ts
/*
 * Scope-relative paths. The host mounts them under /@herald. Every segment is
 * encoded: provider and message IDs are server-made, but nothing here should
 * depend on that.
 */
const seg = encodeURIComponent

export const providerPath = (id: string) => `/providers/${seg(id)}`
export const providerEditPath = (id: string) => `/providers/${seg(id)}/edit`
export const providerSendTestPath = (id: string) => `/providers/${seg(id)}/send-test`
export const templatePath = (id: string) => `/templates/${seg(id)}`
export const messagePath = (id: string) => `/messages/${seg(id)}`
export const messageSendTestPath = (id: string) => `/messages/${seg(id)}/send-test`
```

`packages/plugin-herald/src/badges.tsx`:

```tsx
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { statusLabel } from "./format"
import type { MessageStatus, Protection } from "./wire"

/*
 * Badge mapping for the herald pages, and why. Colour is an attention budget:
 * whatever holds most rows takes `outline` and recedes, `destructive` is kept
 * for what somebody opened the page to find.
 *
 * Message status
 *   sent is `outline`: it is the majority on any working install. It reads
 *   "Accepted by provider", never "delivered": Herald hands the message over
 *   and hears nothing back.
 *   sending and suppressed are `secondary`: notable, not wrong. Suppressed
 *   means the user opted out, which is the system working.
 *   failed is `destructive`: it is what you came to the log to find.
 *   queued and delivered are `outline` and bounced is `destructive`. Herald
 *   never writes those three today; they are mapped so a future writer does
 *   not render a blank.
 *   Anything else shows as it came, `outline`.
 *
 * Enabled
 *   Enabled is `outline`, disabled `secondary`: a disabled provider or
 *   template is a deliberate state, not a fault.
 *
 * Credential protection
 *   Encrypted is `outline` and plaintext `secondary`, deliberately not
 *   `destructive`. How much of an install is plaintext depends on the
 *   deployment, and on the installs that most need the warning every row
 *   would be red and the colour would mean nothing. The warning lives in one
 *   callout on the providers page and the overview's posture panel instead.
 *   "Encrypted" appears only on a value carrying the aes-256-gcm marker.
 *
 * Version
 *   Live is `outline`, inactive `secondary`.
 *
 * Dangling provider
 *   `destructive`: a routing rule naming a deleted provider skips that rule
 *   at send time, which nobody intends.
 *
 * Disabled provider, in a send
 *   `default`: worth a second look before a test send, not a failure.
 *
 * Channels are plain text, never a badge: a channel is a category, not a
 * signal.
 */

const STATUS_VARIANT: Record<MessageStatus, "outline" | "secondary" | "destructive"> = {
  sent: "outline",
  sending: "secondary",
  suppressed: "secondary",
  failed: "destructive",
  queued: "outline",
  delivered: "outline",
  bounced: "destructive",
}

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{statusLabel(status)}</Badge>
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return <Badge variant={enabled ? "outline" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
}

export function ProtectionBadge({ protection }: { protection: Protection }) {
  return protection === "aes-256-gcm" ? <Badge variant="outline">Encrypted</Badge> : <Badge variant="secondary">Plaintext</Badge>
}

export function VersionBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "outline" : "secondary"}>{active ? "Live" : "Inactive"}</Badge>
}

export function DanglingBadge() {
  return <Badge variant="destructive">Provider deleted</Badge>
}

export function DisabledProviderBadge() {
  return <Badge variant="default">Provider disabled</Badge>
}
```

`packages/plugin-herald/src/use-debounced.ts`:

```ts
import { useEffect, useState } from "react"

/** The value, once it has stopped changing for `ms`. Copied in spirit from plugin-relay. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}
```

Run: `npx vitest run test/format.test.ts test/badges.test.tsx`. Expected: PASS.

- [ ] **Step 5: Harness and test data**

`packages/plugin-herald/test/harness.tsx`:

```tsx
import type { ComponentType, ReactNode } from "react"
import { beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps, ScopedClient } from "@forge-go/dashboard-plugin"

/**
 * `queryStore` is a module-level singleton, so an entry one test writes
 * outlives that test. Every file importing this harness gets the reset.
 */
beforeEach(() => {
  queryStore.clear()
})

/**
 * Answers exactly the intents it was given and refuses every other one, so a
 * typo in an intent name renders an error card and turns the test red.
 */
export function stubClient(answers: Record<string, unknown>, commands: Record<string, unknown> = {}): ScopedClient {
  return {
    extension: "herald",
    query: async (intent: string) => {
      if (!(intent in answers)) throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      return answers[intent]
    },
    command: async (intent: string) => {
      if (!(intent in commands)) throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      return commands[intent]
    },
  } as ScopedClient
}

/** Records every command a page sends, with its payload, in order. */
export function recordingCommandClient(answers: Record<string, unknown>, commands: Record<string, unknown> = {}) {
  const sent: { intent: string; payload: unknown }[] = []
  const inner = stubClient(answers, commands)
  return {
    sent,
    client: {
      extension: inner.extension,
      query: inner.query,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

/** Records every query a page sends, with its params, in order. */
export function recordingQueryClient(answers: Record<string, unknown>) {
  const sent: { intent: string; params?: Record<string, unknown> }[] = []
  const inner = stubClient(answers)
  return {
    sent,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        sent.push({ intent, params })
        return inner.query(intent, params)
      },
      command: inner.command,
    } as ScopedClient,
  }
}

/** Every read and write fails with this error. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: "herald",
    query: async () => {
      throw error
    },
    command: async () => {
      throw error
    },
  } as ScopedClient
}

/** Nothing ever settles. */
export function pendingClient(): ScopedClient {
  return {
    extension: "herald",
    query: () => new Promise<never>(() => {}),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

type Answer = ((input: Record<string, unknown>) => unknown) | object

/**
 * Queries and commands answered by intent, each a value or a function of the
 * input. An answer that is (or returns) a ContractError is thrown, the only
 * way a command's failure path runs. Copied from plugin-relay's harness.
 */
export function scriptedClient(queries: Record<string, Answer>, commands: Record<string, Answer> = {}) {
  const queried: { intent: string; params: Record<string, unknown> }[] = []
  const sent: { intent: string; payload: unknown }[] = []
  const answer = (table: Record<string, Answer>, intent: string, input: Record<string, unknown>) => {
    if (!(intent in table)) throw new ContractError("NOT_FOUND", `no handler for "${intent}"`)
    const a = table[intent]
    const out = typeof a === "function" ? (a as (i: Record<string, unknown>) => unknown)(input) : a
    if (out instanceof ContractError) throw out
    return out
  }
  return {
    queried,
    sent,
    client: {
      extension: "herald",
      query: async (intent: string, params?: Record<string, unknown>) => {
        queried.push({ intent, params: params ?? {} })
        return answer(queries, intent, params ?? {})
      },
      command: async (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return answer(commands, intent, (payload ?? {}) as Record<string, unknown>)
      },
    } as ScopedClient,
  }
}

/** Renders one page the way the host does: inside a PluginProvider. */
export function renderPage(Page: ComponentType<PluginPageProps>, client: ScopedClient, params: PluginPageProps["params"] = {}) {
  return render(
    <PluginProvider client={client}>
      <Page params={params} />
    </PluginProvider>
  )
}

/** As renderPage, with navigation captured so a test can assert where a page went. */
export function renderWithNavigate(Page: ComponentType<PluginPageProps>, client: ScopedClient, params: PluginPageProps["params"] = {}) {
  const navigate = vi.fn()
  const result = render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <Page params={params} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { ...result, navigate }
}
```

`packages/plugin-herald/test/data.ts`:

```ts
import type {
  EngineInfoResponse,
  MessageDetail,
  MessageSummary,
  NotificationWire,
  ProviderDetail,
  ProviderSummary,
  ScopeRule,
  TemplateDetail,
  TemplateSummary,
} from "../src/wire"

/** Test data shaped like the wire. Field names are Herald's JSON tags. */

export const ENGINE: EngineInfoResponse = {
  app: { id: "app_demo", label: "app_demo" },
  defaultLocale: "en",
  maxBatchSize: 100,
  truncateBodyAt: 4096,
  channels: ["email", "sms", "push", "inapp", "webhook", "chat"],
  drivers: [
    { name: "inapp", channel: "inapp", fields: [] },
    { name: "legacy-sms", channel: "sms", fields: null },
    {
      name: "resend",
      channel: "email",
      fields: [
        { key: "api_key", label: "API key", required: true, secret: true, placement: "credential" },
        { key: "base_url", label: "API base URL", help: "Leave empty for Resend's own API.", required: false, secret: false, placement: "setting" },
      ],
    },
    {
      name: "smtp",
      channel: "email",
      fields: [
        { key: "host", label: "Host", required: true, secret: false, placement: "setting" },
        { key: "port", label: "Port", help: "Usually 587, or 465 with implicit TLS.", required: true, secret: false, placement: "setting" },
        { key: "username", label: "Username", required: false, secret: false, placement: "credential" },
        { key: "password", label: "Password", required: false, secret: true, placement: "credential" },
        { key: "from", label: "From address", help: "Used when no routing rule sets one.", required: false, secret: false, placement: "setting" },
      ],
    },
    {
      name: "twilio",
      channel: "sms",
      fields: [
        { key: "account_sid", label: "Account SID", required: true, secret: false, placement: "credential" },
        { key: "auth_token", label: "Auth token", required: true, secret: true, placement: "credential" },
        { key: "from_number", label: "From number", required: true, secret: false, placement: "setting" },
      ],
    },
  ],
  templateFuncs: ["default", "formatDate", "lower", "now", "title", "truncate", "upper"],
  encryption: { configured: true, keyId: "k1" },
  apiProtected: false,
}

export function engine(over: Partial<EngineInfoResponse> = {}): EngineInfoResponse {
  return { ...ENGINE, ...over }
}

export function providerSummary(over: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: "hpvd_01j00000000000000000000001",
    name: "Primary SMTP",
    channel: "email",
    driver: "smtp",
    priority: 0,
    enabled: true,
    credentials: [
      { key: "password", protection: "aes-256-gcm", keyId: "k1" },
      { key: "username", protection: "aes-256-gcm", keyId: "k1" },
    ],
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

export function providerDetail(over: Partial<ProviderDetail> = {}): ProviderDetail {
  return {
    ...providerSummary(),
    settings: [
      { key: "from", value: "no-reply@example.com", secret: false },
      { key: "host", value: "smtp.example.com", secret: false },
      { key: "port", value: "587", secret: false },
    ],
    usedBy: [{ scope: "app", scopeId: "app_demo", channel: "email" }],
    ...over,
  }
}

export function templateSummary(over: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: "htpl_01j00000000000000000000015",
    slug: "billing.receipt",
    name: "Receipt",
    channel: "email",
    category: "transactional",
    isSystem: false,
    enabled: true,
    locales: [
      { locale: "", active: true },
      { locale: "en", active: true },
      { locale: "fr", active: false },
    ],
    hasFallback: true,
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

export function templateDetail(over: Partial<TemplateDetail> = {}): TemplateDetail {
  return {
    ...templateSummary(),
    variables: [
      { name: "customer_name", type: "string", required: true },
      { name: "amount", type: "string", required: true },
      { name: "invoice_url", type: "url", required: false },
    ],
    versions: [
      { id: "htpv_01j00000000000000000000025", locale: "", subject: "Your receipt", html: "<p>Hi {{.customer_name}}</p>", text: "Hi {{.customer_name}}", title: "", active: true, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" },
      { id: "htpv_01j00000000000000000000026", locale: "en", subject: "Your {{.amount}} receipt", html: "<p>Thanks {{.customer_name}}</p>", text: "Thanks {{.customer_name}}", title: "", active: true, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" },
    ],
    ...over,
  }
}

export function messageSummary(over: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: "hmsg_01j00000000000000000001000",
    recipient: "ada@example.com",
    channel: "email",
    status: "sent",
    templateSlug: "auth.welcome",
    provider: { id: "hpvd_01j00000000000000000000001", name: "Primary SMTP", driver: "smtp" },
    createdAt: "2026-09-23T10:00:00Z",
    sentAt: "2026-09-23T10:00:01Z",
    ...over,
  }
}

export function messageDetail(over: Partial<MessageDetail> = {}): MessageDetail {
  return {
    ...messageSummary(),
    subject: "Welcome to Example!",
    body: "Hi Ada,\n\nThanks for joining Example.",
    metadata: { source: "api" },
    attempts: 1,
    async: false,
    providerMessageId: "1000.msg@smtp.example.com",
    template: { id: "htpl_01j00000000000000000000011", slug: "auth.welcome", channel: "email" },
    ...over,
  }
}

export function notification(over: Partial<NotificationWire> = {}): NotificationWire {
  return {
    id: "hinb_01j00000000000000000002000",
    userId: "usr_ada",
    type: "auth.welcome",
    title: "Welcome to Example",
    body: "Open the app for details.",
    read: false,
    metadata: {},
    createdAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

export function scopeRule(over: Partial<ScopeRule> = {}): ScopeRule {
  return {
    id: "hscf_01j00000000000000000004000",
    scope: "app",
    scopeId: "app_demo",
    providers: {
      email: { id: "hpvd_01j00000000000000000000001", name: "Primary SMTP", dangling: false },
    },
    fromEmail: "hello@example.com",
    fromName: "Example",
    defaultLocale: "en",
    defaultLocaleUnused: true,
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}
```

- [ ] **Step 6: The app header, test first**

`packages/plugin-herald/test/herald-header.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { HeraldHeader } from "../src/components/herald-header"
import { engine } from "./data"
import { failingClient, renderPage, stubClient } from "./harness"

const Page: ComponentType<PluginPageProps> = () => <HeraldHeader title="Providers" description="The ones that send." />

describe("HeraldHeader", () => {
  it("names the app in mono", async () => {
    renderPage(Page, stubClient({ "engine.info": engine() }))
    const app = await screen.findByText("app_demo")
    expect(app.className).toMatch(/font-mono text-xs/)
    expect(screen.getByRole("heading", { level: 1, name: "Providers" })).toBeTruthy()
  })

  it("says Default app for the empty app, not a blank", async () => {
    renderPage(Page, stubClient({ "engine.info": engine({ app: { id: "", label: "Default app" } }) }))
    expect(await screen.findByText("Default app")).toBeTruthy()
  })

  it("says the app is unknown when engine.info fails, rather than naming none", async () => {
    renderPage(Page, failingClient(new ContractError("PERMISSION_DENIED", "the app on this session can't be read")))
    expect(await screen.findByText(/App unknown/)).toBeTruthy()
    expect(screen.getByText(/the app on this session can't be read/)).toBeTruthy()
  })
})
```

`packages/plugin-herald/src/components/herald-header.tsx`:

```tsx
import type { ReactNode } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import type { EngineInfoResponse } from "../wire"

/** engine.info, shared by every page through the query cache. */
export function useEngineInfo(): QueryState<EngineInfoResponse> {
  return useQuery<EngineInfoResponse>("engine.info")
}

/**
 * Which app this page shows. Under authsome an empty list reads as "nothing
 * was sent" when it means "nothing in this app", so every page says which
 * app it is reading.
 */
export function AppLine({ info }: { info: QueryState<EngineInfoResponse> }) {
  if (info.error) {
    return (
      <p className="text-sm text-muted-foreground">
        App unknown: {info.error.code}: {info.error.message}
      </p>
    )
  }
  if (!info.data) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        App: loading…
      </p>
    )
  }
  const app = info.data.app
  return (
    <p className="text-sm text-muted-foreground">
      App: {app.id === "" ? app.label : <span className="font-mono text-xs">{app.id}</span>}
    </p>
  )
}

export function HeraldHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const info = useEngineInfo()
  return (
    <div className="flex flex-col gap-1">
      <PageHeader title={title} description={description} actions={actions} />
      <AppLine info={info} />
    </div>
  )
}
```

Run: `npx vitest run test/herald-header.test.tsx`. Expected: PASS.

- [ ] **Step 7: Overview, test first**

`packages/plugin-herald/test/overview.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import type { OverviewStatsResponse } from "../src/wire"
import { engine } from "./data"
import { recordingQueryClient, renderPage, scriptedClient, stubClient } from "./harness"

function stats(over: Partial<OverviewStatsResponse> = {}): OverviewStatsResponse {
  return {
    since: "2026-09-27T10:00:00Z",
    counts: [
      { status: "failed", channel: "email", n: 2 },
      { status: "sent", channel: "email", n: 40 },
      { status: "sent", channel: "sms", n: 9 },
    ],
    providers: { total: 5, enabled: 4 },
    credentials: { plaintext: 3, encrypted: 4 },
    templatesWithoutFallback: [{ id: "htpl_01j00000000000000000000011", slug: "auth.welcome", channel: "email" }],
    ...over,
  }
}

describe("OverviewPage", () => {
  it("asks for the last seven days first, then the window you pick", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "overview.stats": stats() })
    renderPage(OverviewPage, client)
    await screen.findByText("51 messages since", { exact: false })
    expect(sent.find((s) => s.intent === "overview.stats")?.params).toEqual({ window: "7d" })
    fireEvent.click(screen.getByRole("button", { name: "24 hours" }))
    await waitFor(() => expect(sent.filter((s) => s.intent === "overview.stats").map((s) => s.params)).toContainEqual({ window: "24h" }))
  })

  it("shows only the statuses that have rows, and calls sent accepted, never delivered", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats() }))
    const table = await screen.findByRole("table")
    expect(within(table).getByRole("columnheader", { name: "Accepted by provider" })).toBeTruthy()
    expect(within(table).getByRole("columnheader", { name: "Failed" })).toBeTruthy()
    expect(within(table).queryByRole("columnheader", { name: "Suppressed" })).toBeNull()
    expect(document.body.textContent).not.toMatch(/delivered/i)
    expect(screen.getByText(/delivery isn't confirmed/)).toBeTruthy()
  })

  it("says nothing was handed over in the window, and still counts zero", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ counts: [] }) }))
    expect(await screen.findByText("No messages in this window.")).toBeTruthy()
    expect(screen.getByText(/0 messages since/)).toBeTruthy()
  })

  it("offers to encrypt the plaintext values when a key exists, naming how many change", async () => {
    const { client, sent } = scriptedClient(
      { "engine.info": engine(), "overview.stats": stats() },
      { "providers.encryptStored": { providers: 2, valuesEncrypted: 3, alreadyEncrypted: 4 } },
    )
    renderPage(OverviewPage, client)
    expect(await screen.findByText(/3 credential values are stored in plaintext/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Encrypt stored credentials" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("3 plaintext values")
    expect(dialog.textContent).toContain("k1")
    fireEvent.click(within(dialog).getByRole("button", { name: "Encrypt" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "providers.encryptStored", payload: {} }]))
    expect(await screen.findByText("Encrypted 3 values across 2 providers.")).toBeTruthy()
  })

  it("explains how to set a key when none is configured, and offers no button", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ encryption: { configured: false } }), "overview.stats": stats() }))
    expect(await screen.findByText(/No credential key is configured/)).toBeTruthy()
    expect(screen.getByText(/credentials_key/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Encrypt stored credentials" })).toBeNull()
  })

  it("does not call an install with no credentials encrypted", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ credentials: { plaintext: 0, encrypted: 0 } }) }))
    expect(await screen.findByText("No credentials are stored.")).toBeTruthy()
    expect(screen.queryByText(/all encrypted/i)).toBeNull()
  })

  it("says plainly that the REST API is open", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ apiProtected: false }), "overview.stats": stats() }))
    expect(await screen.findByText(/no auth middleware/)).toBeTruthy()
  })

  it("counts templates without a fallback and links to them", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats() }))
    expect(await screen.findByText(/1 template has no fallback version/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Show them" }).getAttribute("href")).toBe("/templates-without-fallback")
  })

  it("shows the error card when the stats fail, not an empty table", async () => {
    renderPage(OverviewPage, scriptedClient({ "engine.info": engine(), "overview.stats": () => new ContractError("INTERNAL", "an internal error occurred") }).client)
    expect(await screen.findByText(/Message counts unavailable/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
```

Run: `npx vitest run test/overview.test.tsx`. Expected: FAIL, the page doesn't exist.

`packages/plugin-herald/src/pages/overview.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { NO_RECEIPTS, plural, STATUS_ORDER, statusLabel } from "../format"
import type { EngineInfoResponse, MessageCount, OverviewStatsResponse, OverviewWindow, ProvidersEncryptStoredResponse } from "../wire"

const WINDOWS: { value: OverviewWindow; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
]

interface ChannelRow {
  channel: string
  byStatus: Record<string, number>
}

/** Rows are channels, columns only the statuses that have rows. */
function CountsTable({ data }: { data: OverviewStatsResponse }) {
  const statuses = STATUS_ORDER.filter((s) => data.counts.some((c) => c.status === s))
  const channels = [...new Set(data.counts.map((c) => c.channel))].sort()
  const rows: ChannelRow[] = channels.map((channel) => ({
    channel,
    byStatus: Object.fromEntries(data.counts.filter((c: MessageCount) => c.channel === channel).map((c) => [c.status, c.n])),
  }))
  const total = data.counts.reduce((sum, c) => sum + c.n, 0)
  const columns: Column<ChannelRow>[] = [
    { id: "channel", header: "Channel", className: "font-medium", cell: (r) => r.channel },
    ...statuses.map((status) => ({
      id: status,
      header: statusLabel(status),
      align: "end" as const,
      className: "font-mono text-xs",
      cell: (r: ChannelRow) => String(r.byStatus[status] ?? 0),
    })),
  ]
  return (
    <ResourceTable<ChannelRow>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.channel}
      caption={`${plural(total, "message")} since ${formatTimestamp(data.since)}`}
      emptyMessage="No messages in this window."
    />
  )
}

function Posture({ info, data }: { info: EngineInfoResponse; data: OverviewStatsResponse }) {
  const encrypt = useCommand<ProvidersEncryptStoredResponse>("providers.encryptStored")
  const [confirming, setConfirming] = useState(false)
  const { plaintext, encrypted } = data.credentials
  const missing = data.templatesWithoutFallback.length

  function openConfirm() {
    encrypt.reset()
    setConfirming(true)
  }

  async function confirm() {
    const result = await encrypt.execute({})
    if (result === undefined) return
    setConfirming(false)
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">Encryption</h3>
        {plaintext + encrypted === 0 ? (
          <p>No credentials are stored.</p>
        ) : info.encryption.configured ? (
          <>
            <p>
              Credential key <span className="font-mono text-xs">{info.encryption.keyId}</span> is configured. {plaintext > 0 ? `${plural(plaintext, "credential value")} ${plaintext === 1 ? "is" : "are"} stored in plaintext; ${encrypted} encrypted.` : `All ${plural(encrypted, "stored value")} carry the encryption marker.`}
            </p>
            {plaintext > 0 && (
              <div>
                <Button size="sm" variant="outline" onClick={openConfirm}>
                  Encrypt stored credentials
                </Button>
              </div>
            )}
          </>
        ) : (
          <p>
            No credential key is configured, so provider credentials are stored in plaintext ({plural(plaintext, "value")}). Set <span className="font-mono text-xs">credentials_key</span> in the herald extension config to encrypt new values, then encrypt the stored ones here.
          </p>
        )}
        {encrypt.data && (
          <p role="status">
            Encrypted {plural(encrypt.data.valuesEncrypted, "value")} across {plural(encrypt.data.providers, "provider")}.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">REST API</h3>
        <p>
          {info.apiProtected
            ? "The REST API has an auth middleware configured."
            : "The REST API has no auth middleware configured. Anyone who can reach it can read messages and send them."}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">Fallback coverage</h3>
        {missing === 0 ? (
          <p>Every template has a fallback version.</p>
        ) : (
          <>
            <p>
              {plural(missing, "template")} {missing === 1 ? "has" : "have"} no fallback version. A request in any locale {missing === 1 ? "it doesn't" : "they don't"} list fails instead of falling back.
            </p>
            <p>
              <PluginLink to="/templates-without-fallback" className="underline">
                Show them
              </PluginLink>
            </p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">Providers</h3>
        <p>
          {data.providers.enabled} of {plural(data.providers.total, "provider")} enabled.
        </p>
      </section>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && !encrypt.loading && setConfirming(false)}
        title="Encrypt stored credentials?"
        description={`This re-stores ${plural(plaintext, "plaintext value")} encrypted under key ${info.encryption.keyId ?? ""}. Values already encrypted are left alone.`}
        confirmLabel="Encrypt"
        destructive={false}
        pending={encrypt.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={encrypt.error} title="Could not encrypt the stored credentials" />
      </ConfirmDialog>
    </div>
  )
}

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const [range, setRange] = useState<OverviewWindow>("7d")
  const info = useEngineInfo()
  const stats = useQuery<OverviewStatsResponse>("overview.stats", { window: range })

  return (
    <section className="flex flex-col gap-6">
      <HeraldHeader title="Notifications" description="What Herald handed to providers, and how this install is protected." />
      <div className="grid gap-8 @3xl/main:grid-cols-[2fr_1fr]">
        <section aria-labelledby="counts-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="counts-heading" className="text-sm font-medium">
              Messages by status and channel
            </h2>
            <div className="flex gap-1" role="group" aria-label="Window">
              {WINDOWS.map((w) => (
                <Button key={w.value} size="sm" variant={w.value === range ? "secondary" : "ghost"} aria-pressed={w.value === range} onClick={() => setRange(w.value)}>
                  {w.label}
                </Button>
              ))}
            </div>
          </div>
          <QueryBoundary title="Message counts" query={stats} skeletonRows={4}>
            {(data) => <CountsTable data={data} />}
          </QueryBoundary>
          <p className="text-sm text-muted-foreground">Accepted by provider means the provider took the message. {NO_RECEIPTS}</p>
        </section>
        <section aria-labelledby="posture-heading" className="flex flex-col gap-3">
          <h2 id="posture-heading" className="text-sm font-medium">
            Posture
          </h2>
          <QueryBoundary title="Engine" query={info} skeletonRows={3}>
            {(engineInfo) => (
              <QueryBoundary title="Posture" query={stats} skeletonRows={3}>
                {(data) => <Posture info={engineInfo} data={data} />}
              </QueryBoundary>
            )}
          </QueryBoundary>
        </section>
      </div>
    </section>
  )
}
```

Run: `npx vitest run test/overview.test.tsx`. Expected: PASS. If the "51 messages since" caption shows as the empty state's description instead of a caption (it does at zero rows, by design), the first test still finds it; that is expected.

- [ ] **Step 8: The plugin entry and its test**

`packages/plugin-herald/src/index.tsx`:

```tsx
import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon } from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"

export { OverviewPage }
export { DanglingBadge, DisabledProviderBadge, EnabledBadge, MessageStatusBadge, ProtectionBadge, VersionBadge } from "./badges"
export { HeraldHeader, useEngineInfo } from "./components/herald-header"
export type * from "./wire"

/**
 * The first-party UI for the `herald` extension.
 *
 * `extension` is "herald", the Go contributor name from
 * herald/extension/contract/manifest.yaml, and the join key the host looks
 * up in the capabilities response. The label must spell the extension, so it
 * is "Herald"; "Notifications" names the nav group and the overview page.
 *
 * No `requires` range: a range the host skips for a contributor that reports
 * no version reads as a guarantee and enforces nothing.
 */
export const heraldPlugin = definePlugin({
  extension: "herald",
  namespace: "herald",
  label: "Herald",
  nav: [{ label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "Notifications" }],
  routes: [{ path: "/", element: OverviewPage }],
})

export default heraldPlugin
```

`packages/plugin-herald/test/plugin.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import heraldPlugin, { heraldPlugin as named } from "../src/index"

function capabilities(...contributors: { name: string; configured?: boolean }[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({ name: c.name, envelopes: ["v1"], configured: c.configured ?? true })),
  }
}

/** Every route, scope-relative. Each task that adds a page adds it here. */
const ROUTES = ["/"]

/** Every nav entry's target. */
const NAV = ["/"]

describe("heraldPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(heraldPlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything: against a
   * capabilities document naming the contributor herald's manifest registers.
   * A wrong name resolves to hidden, silently.
   */
  it("resolves to ready against a host reporting herald's contributor", () => {
    expect(resolvePluginState(heraldPlugin, capabilities({ name: "herald" }))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report herald", () => {
    expect(resolvePluginState(heraldPlugin, capabilities({ name: "warden" })).kind).toBe("hidden")
  })

  it("is labelled with the extension's own name", () => {
    expect(heraldPlugin.label).toBe("Herald")
    expect(heraldPlugin.namespace).toBe("herald")
  })

  it("declares exactly its routes, scope-relative", () => {
    expect(heraldPlugin.routes.map((r) => r.path)).toEqual(ROUTES)
  })

  it("names a route for every nav entry, all under the Notifications group", () => {
    const paths = new Set(heraldPlugin.routes.map((r) => r.path))
    expect(heraldPlugin.nav.map((n) => n.to)).toEqual(NAV)
    for (const item of heraldPlugin.nav) {
      expect(paths.has(item.to)).toBe(true)
      expect(item.group).toBe("Notifications")
    }
  })
})
```

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 9: Mount it in the shell and install**

With the Edit tool:
- `apps/shell/package.json`: add `"@forge-go/dashboard-plugin-herald": "workspace:*",` between the core and keysmith plugin entries.
- `apps/shell/src/App.tsx`: add `import heraldPlugin from "@forge-go/dashboard-plugin-herald"` beside the other plugin imports, and `heraldPlugin,` as the last entry of the `plugins` array (after `bastionPlugin,`).
- `apps/shell/src/styles.css` (untracked, the shell owners' file; do not commit it): add `@source "../../../packages/plugin-herald/src";` after the last `@source` line.

Then:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git diff --stat pnpm-lock.yaml   # must be empty before you start
pnpm install
git diff pnpm-lock.yaml | head -80
```

The lockfile diff must contain only a `packages/plugin-herald:` importer and the `@forge-go/dashboard-plugin-herald` link under `apps/shell`. If it changes anything else (another session's dependency edit), stop and report it: committing it would sweep their change into yours.

- [ ] **Step 10: Check and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
pnpm --filter @forge-go/dashboard-shell typecheck
git add packages/plugin-herald/package.json packages/plugin-herald/tsconfig.json packages/plugin-herald/vitest.config.ts packages/plugin-herald/eslint.config.js packages/plugin-herald/src/index.tsx packages/plugin-herald/src/wire.ts packages/plugin-herald/src/format.ts packages/plugin-herald/src/keys.ts packages/plugin-herald/src/badges.tsx packages/plugin-herald/src/use-debounced.ts packages/plugin-herald/src/components/herald-header.tsx packages/plugin-herald/src/pages/overview.tsx packages/plugin-herald/test/setup.ts packages/plugin-herald/test/harness.tsx packages/plugin-herald/test/data.ts packages/plugin-herald/test/plugin.test.tsx packages/plugin-herald/test/badges.test.tsx packages/plugin-herald/test/format.test.ts packages/plugin-herald/test/herald-header.test.tsx packages/plugin-herald/test/overview.test.tsx
git commit --only -m "feat(plugin-herald): scaffold the plugin with its overview and mount it in the shell" -- packages/plugin-herald/package.json packages/plugin-herald/tsconfig.json packages/plugin-herald/vitest.config.ts packages/plugin-herald/eslint.config.js packages/plugin-herald/src/index.tsx packages/plugin-herald/src/wire.ts packages/plugin-herald/src/format.ts packages/plugin-herald/src/keys.ts packages/plugin-herald/src/badges.tsx packages/plugin-herald/src/use-debounced.ts packages/plugin-herald/src/components/herald-header.tsx packages/plugin-herald/src/pages/overview.tsx packages/plugin-herald/test/setup.ts packages/plugin-herald/test/harness.tsx packages/plugin-herald/test/data.ts packages/plugin-herald/test/plugin.test.tsx packages/plugin-herald/test/badges.test.tsx packages/plugin-herald/test/format.test.ts packages/plugin-herald/test/herald-header.test.tsx packages/plugin-herald/test/overview.test.tsx apps/shell/package.json apps/shell/src/App.tsx pnpm-lock.yaml
git show --stat HEAD
```

The shell typecheck can stop on another session's untracked `src/design-preview`; if it does, say so in the report and check that nothing it prints names herald. `apps/shell/src/styles.css` stays uncommitted.

---
### Task 3: Providers list and provider detail

**Files:**
- Create: `packages/plugin-herald/src/pages/providers.tsx`, `src/pages/provider-detail.tsx`, `test/providers.test.tsx`, `test/provider-detail.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useEngineInfo`, `credentialSummary`, `plural`, `providerPath`, `providerEditPath`, `providerSendTestPath`, `EnabledBadge`, `ProtectionBadge`, wire types.
- Produces: `ProvidersPage`, `ProviderDetailPage` (exported from `index.tsx`); routes `/providers`, `/providers/:id`; nav "Providers" (priority 30).

- [ ] **Step 1: Write the failing tests**

`packages/plugin-herald/test/providers.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProvidersPage } from "../src/pages/providers"
import { engine, providerSummary } from "./data"
import { renderPage, scriptedClient, stubClient } from "./harness"

const LIST = {
  providers: [
    providerSummary(),
    providerSummary({ id: "hpvd_01j00000000000000000000002", name: "Twilio", channel: "sms", driver: "twilio", credentials: [{ key: "account_sid", protection: "plaintext" }, { key: "auth_token", protection: "plaintext" }, { key: "sid2", protection: "aes-256-gcm", keyId: "k1" }] }),
    providerSummary({ id: "hpvd_01j00000000000000000000004", name: "inapp (default)", channel: "inapp", driver: "inapp", credentials: [], enabled: false, priority: 10 }),
  ],
}

describe("ProvidersPage", () => {
  it("counts providers in the caption and links each by name", async () => {
    renderPage(ProvidersPage, stubClient({ "engine.info": engine(), "providers.list": LIST }))
    expect(await screen.findByText("3 providers")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Twilio" })
    expect(link.getAttribute("href")).toBe("/providers/hpvd_01j00000000000000000000002")
    expect(link.closest("td")?.className).toMatch(/font-medium/)
  })

  it("puts the driver in mono and summarises credentials without values", async () => {
    renderPage(ProvidersPage, stubClient({ "engine.info": engine(), "providers.list": LIST }))
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("Twilio"))!
    expect(within(row).getByText("twilio").closest("td")?.className).toMatch(/font-mono text-xs/)
    expect(within(row).getByText("2 plaintext, 1 encrypted")).toBeTruthy()
    const inapp = screen.getAllByRole("row").find((r) => within(r).queryByText("inapp (default)"))!
    expect(within(inapp).getByLabelText("no credentials")).toBeTruthy()
    expect(within(inapp).getByText("Disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })

  it("warns once, above the table, when no credential key is configured", async () => {
    renderPage(ProvidersPage, stubClient({ "engine.info": engine({ encryption: { configured: false } }), "providers.list": LIST }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/stored unencrypted/)
    expect(alert.textContent).toMatch(/credentials_key/)
  })

  it("does not warn when a key is configured", async () => {
    renderPage(ProvidersPage, stubClient({ "engine.info": engine(), "providers.list": LIST }))
    await screen.findByText("3 providers")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says so when there are none, counts zero, and offers New provider", async () => {
    renderPage(ProvidersPage, stubClient({ "engine.info": engine(), "providers.list": { providers: [] } }))
    expect(await screen.findByText(/No providers yet/)).toBeTruthy()
    expect(screen.getByText("0 providers")).toBeTruthy()
    for (const l of screen.getAllByRole("link", { name: "New provider" })) expect(l.getAttribute("href")).toBe("/new-provider")
  })

  it("shows the error card when the list fails", async () => {
    renderPage(ProvidersPage, scriptedClient({ "engine.info": engine(), "providers.list": () => new ContractError("INTERNAL", "an internal error occurred") }).client)
    expect(await screen.findByText(/Providers unavailable/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
```

`packages/plugin-herald/test/provider-detail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProviderDetailPage } from "../src/pages/provider-detail"
import { engine, providerDetail } from "./data"
import { renderPage, renderWithNavigate, scriptedClient } from "./harness"

const ID = "hpvd_01j00000000000000000000001"

function client(detail = providerDetail(), onDelete: () => unknown = () => ({ ok: true, id: ID })) {
  return scriptedClient({ "engine.info": engine(), "providers.detail": { provider: detail } }, { "providers.delete": onDelete })
}

describe("ProviderDetailPage", () => {
  it("asks for the provider by id", async () => {
    const c = client()
    renderPage(ProviderDetailPage, c.client, { id: ID })
    await screen.findByRole("heading", { level: 1, name: "Primary SMTP" })
    expect(c.queried.find((q) => q.intent === "providers.detail")?.params).toEqual({ id: ID })
  })

  it("lists settings with values, and secret ones without", async () => {
    const detail = providerDetail({ settings: [{ key: "host", value: "smtp.example.com", secret: false }, { key: "gateway_token", secret: true }] })
    renderPage(ProviderDetailPage, client(detail).client, { id: ID })
    const table = await screen.findByRole("table", { name: /2 settings/ })
    expect(within(table).getByText("smtp.example.com").className).toMatch(/font-mono/)
    const secretRow = within(table).getAllByRole("row").find((r) => within(r).queryByText("gateway_token"))!
    expect(within(secretRow).getByText("Hidden")).toBeTruthy()
  })

  it("shows each credential's protection and key ID, never a value", async () => {
    const detail = providerDetail({ credentials: [{ key: "password", protection: "aes-256-gcm", keyId: "k1" }, { key: "username", protection: "plaintext" }] })
    renderPage(ProviderDetailPage, client(detail).client, { id: ID })
    const table = await screen.findByRole("table", { name: /2 credentials/ })
    expect(within(table).getByText("Encrypted", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(table).getByText("Plaintext", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(table).getByText("k1").className).toMatch(/font-mono text-xs/)
    expect(within(table).getByLabelText("no key ID")).toBeTruthy()
  })

  it("lists the routing rules that name it, and says when none do", async () => {
    renderPage(ProviderDetailPage, client().client, { id: ID })
    expect(await screen.findByText(/app rule/)).toBeTruthy()
    expect(screen.getByText("app_demo").className).toMatch(/font-mono text-xs/)
  })

  it("explains fallback use when no rule names it", async () => {
    renderPage(ProviderDetailPage, client(providerDetail({ usedBy: [] })).client, { id: ID })
    expect(await screen.findByText(/No routing rule names this provider/)).toBeTruthy()
  })

  it("links to edit and to a test send pinned to this provider", async () => {
    renderPage(ProviderDetailPage, client().client, { id: ID })
    expect((await screen.findByRole("link", { name: "Edit" })).getAttribute("href")).toBe(`/providers/${ID}/edit`)
    expect(screen.getByRole("link", { name: "Send a test through this provider" }).getAttribute("href")).toBe(`/providers/${ID}/send-test`)
  })

  it("names the rules that will dangle before deleting, sends only the id, and goes back to the list", async () => {
    const c = client()
    const { navigate } = renderWithNavigate(ProviderDetailPage, c.client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/1 routing rule names this provider: app app_demo \(email\)/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "providers.delete", payload: { id: ID } }]))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/providers"))
  })

  it("keeps the dialog open and shows the refusal inside it", async () => {
    renderPage(ProviderDetailPage, client(providerDetail(), () => new ContractError("NOT_FOUND", "provider not found")).client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("provider not found")
  })

  it("renders another app's provider as not found, not as an empty page", async () => {
    renderPage(ProviderDetailPage, scriptedClient({ "engine.info": engine(), "providers.detail": () => new ContractError("NOT_FOUND", "provider not found") }).client, { id: ID })
    expect(await screen.findByText(/Provider unavailable/)).toBeTruthy()
    expect(screen.getByText(/provider not found/)).toBeTruthy()
  })

  it("says there is nothing to show without an id", () => {
    renderPage(ProviderDetailPage, scriptedClient({}).client, {})
    expect(screen.getByRole("status").textContent).toMatch(/No provider ID/)
  })
})
```

Run: `npx vitest run test/providers.test.tsx test/provider-detail.test.tsx`. Expected: FAIL, the pages don't exist.

- [ ] **Step 2: The list page**

`packages/plugin-herald/src/pages/providers.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { EnabledBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { credentialSummary, plural } from "../format"
import { providerPath } from "../keys"
import type { ProviderSummary, ProvidersListResponse } from "../wire"

function NewProviderLink() {
  return (
    <PluginLink to="/new-provider" className={buttonVariants()}>
      New provider
    </PluginLink>
  )
}

const columns: Column<ProviderSummary>[] = [
  { id: "name", header: "Name", className: "font-medium", cell: (p) => <PluginLink to={providerPath(p.id)}>{p.name}</PluginLink> },
  { id: "channel", header: "Channel", cell: (p) => p.channel },
  { id: "driver", header: "Driver", className: "font-mono text-xs", cell: (p) => p.driver },
  { id: "priority", header: "Priority", align: "end", className: "font-mono text-xs", cell: (p) => String(p.priority) },
  { id: "credentials", header: "Credentials", cell: (p) => credentialSummary(p.credentials) ?? <NoneCell label="credentials" /> },
  { id: "status", header: "Status", cell: (p) => <EnabledBadge enabled={p.enabled} /> },
]

export const ProvidersPage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  const list = useQuery<ProvidersListResponse>("providers.list")
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader
        title="Providers"
        description="The services Herald hands messages to. Credentials are write-only: you can set and replace them here, never read them back."
        actions={<NewProviderLink />}
      />
      {info.data && !info.data.encryption.configured && (
        <Alert>
          <AlertTitle>Credentials are stored unencrypted</AlertTitle>
          <AlertDescription>
            No credential key is configured. Set <span className="font-mono text-xs">credentials_key</span> in the herald extension config, then encrypt the stored values from the overview.
          </AlertDescription>
        </Alert>
      )}
      <QueryBoundary title="Providers" query={list} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ProviderSummary>
            columns={columns}
            rows={data.providers}
            rowKey={(p) => p.id}
            caption={plural(data.providers.length, "provider")}
            emptyMessage="No providers yet. Add one so Herald has somewhere to send."
            emptyAction={<NewProviderLink />}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 3: The detail page**

`packages/plugin-herald/src/pages/provider-detail.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { EnabledBadge, ProtectionBadge } from "../badges"
import { HeraldHeader } from "../components/herald-header"
import { plural } from "../format"
import { providerEditPath, providerSendTestPath } from "../keys"
import type { CredentialStatus, DeleteResponse, ProviderDetail, ProvidersDetailResponse, RouteUse, SettingEntry } from "../wire"

const settingColumns: Column<SettingEntry>[] = [
  { id: "key", header: "Key", className: "font-mono text-xs", cell: (s) => s.key },
  {
    id: "value",
    header: "Value",
    cell: (s) => (s.secret ? <span className="text-muted-foreground">Hidden</span> : s.value ? <span className="font-mono text-xs">{s.value}</span> : <NoneCell label="value" />),
  },
]

const credentialColumns: Column<CredentialStatus>[] = [
  { id: "key", header: "Key", className: "font-mono text-xs", cell: (c) => c.key },
  { id: "protection", header: "Protection", cell: (c) => <ProtectionBadge protection={c.protection} /> },
  { id: "keyId", header: "Key ID", cell: (c) => (c.keyId ? <span className="font-mono text-xs">{c.keyId}</span> : <NoneCell label="key ID" />) },
]

/** "app app_demo (email)", for the delete confirm, which takes plain text. */
function describeUse(u: RouteUse): string {
  return `${u.scope} ${u.scopeId === "" ? "(default app)" : u.scopeId} (${u.channel})`
}

function UsedBy({ uses }: { uses: RouteUse[] }) {
  if (uses.length === 0) {
    return <p className="text-sm text-muted-foreground">No routing rule names this provider. Herald picks it by channel and priority when no rule applies.</p>
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {uses.map((u) => (
        <li key={`${u.scope}|${u.scopeId}|${u.channel}`}>
          {u.channel} for the {u.scope} rule{" "}
          {u.scopeId === "" ? "for the default app" : <span className="font-mono text-xs">{u.scopeId}</span>}
        </li>
      ))}
    </ul>
  )
}

function ProviderBody({ id }: { id: string }) {
  const detail = useQuery<ProvidersDetailResponse>("providers.detail", { id })
  const remove = useCommand<DeleteResponse>("providers.delete")
  const navigateTo = useNavigateTo()
  const [deleting, setDeleting] = useState(false)

  function openDelete() {
    remove.reset()
    setDeleting(true)
  }

  async function confirmDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    setDeleting(false)
    navigateTo("/providers")
  }

  function deleteText(p: ProviderDetail): string {
    const n = p.usedBy.length
    if (n === 0) return "This deletes the provider and its stored credentials. This cannot be undone."
    return `${plural(n, "routing rule")} ${n === 1 ? "names" : "name"} this provider: ${p.usedBy.map(describeUse).join(", ")}. ${n === 1 ? "It" : "They"} will point at a deleted provider, and Herald skips ${n === 1 ? "it" : "them"} at send time until changed. This cannot be undone.`
  }

  return (
    <QueryBoundary title="Provider" query={detail} skeletonRows={5}>
      {({ provider: p }) => (
        <section className="flex flex-col gap-6">
          <HeraldHeader
            title={p.name}
            actions={
              <div className="flex flex-wrap gap-2">
                <PluginLink to={providerEditPath(p.id)} className={buttonVariants({ variant: "outline" })}>
                  Edit
                </PluginLink>
                <PluginLink to={providerSendTestPath(p.id)} className={buttonVariants({ variant: "outline" })}>
                  Send a test through this provider
                </PluginLink>
                <Button variant="destructive" onClick={openDelete}>
                  Delete
                </Button>
              </div>
            }
          />
          <DetailLayout
            main={
              <div className="flex flex-col gap-6">
                <DescriptionList
                  items={[
                    { term: "ID", value: <span className="font-mono text-xs">{p.id}</span> },
                    { term: "Channel", value: p.channel },
                    { term: "Driver", value: <span className="font-mono text-xs">{p.driver}</span> },
                    { term: "Priority", value: <span className="font-mono text-xs">{p.priority}</span> },
                    { term: "Status", value: <EnabledBadge enabled={p.enabled} /> },
                    { term: "Created", value: <Timestamp value={p.createdAt} label="creation time" /> },
                    { term: "Updated", value: <Timestamp value={p.updatedAt} label="update time" /> },
                  ]}
                />
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Settings</h2>
                  <ResourceTable<SettingEntry> columns={settingColumns} rows={p.settings} rowKey={(s) => s.key} caption={plural(p.settings.length, "setting")} emptyMessage="No settings stored." />
                  {p.settings.some((s) => s.secret) && (
                    <p className="text-sm text-muted-foreground">Hidden values are secrets, or belong to a driver with no field schema, where any setting could be one.</p>
                  )}
                </section>
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Credentials</h2>
                  <ResourceTable<CredentialStatus> columns={credentialColumns} rows={p.credentials} rowKey={(c) => c.key} caption={plural(p.credentials.length, "credential")} emptyMessage="No credentials stored." />
                  <p className="text-sm text-muted-foreground">Credential values are write-only. Replace one from Edit.</p>
                </section>
              </div>
            }
            aside={
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Used by routing rules</h2>
                <UsedBy uses={p.usedBy} />
              </section>
            }
          />
          <ConfirmDialog
            open={deleting}
            onOpenChange={(open) => !open && !remove.loading && setDeleting(false)}
            title={`Delete ${p.name}?`}
            description={deleteText(p)}
            confirmLabel="Delete"
            pending={remove.loading}
            onConfirm={() => void confirmDelete()}
          >
            <CommandAlert error={remove.error} title="Could not delete the provider" />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}

/**
 * A thin guard so a missing id renders a status line without the body's
 * hooks running: a query with no id would ask the server about provider "".
 */
export const ProviderDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No provider ID in the address, so there is nothing to show.
      </p>
    )
  }
  return <ProviderBody id={id} />
}
```

`ResourceTable` sets each table's `aria-label` to its caption, which is how the tests find the settings and credentials tables (`getByRole("table", { name: /2 settings/ })`).

- [ ] **Step 4: Register them**

In `src/index.tsx`: import and export `ProvidersPage` and `ProviderDetailPage`; add `ServerIcon` to the icon import; append to `nav`:

```tsx
{ label: "Providers", to: "/providers", priority: 30, icon: <ServerIcon />, group: "Notifications" },
```

and to `routes`:

```tsx
{ path: "/providers", element: ProvidersPage },
{ path: "/providers/:id", element: ProviderDetailPage },
```

In `test/plugin.test.tsx`: `ROUTES` becomes `["/", "/providers", "/providers/:id"]` and `NAV` becomes `["/", "/providers"]`.

- [ ] **Step 5: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/pages/providers.tsx packages/plugin-herald/src/pages/provider-detail.tsx packages/plugin-herald/test/providers.test.tsx packages/plugin-herald/test/provider-detail.test.tsx
git commit --only -m "feat(plugin-herald): list providers and show one with its credential protection" -- packages/plugin-herald/src/pages/providers.tsx packages/plugin-herald/src/pages/provider-detail.tsx packages/plugin-herald/test/providers.test.tsx packages/plugin-herald/test/provider-detail.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 4: Provider create and edit, schema-driven, with write-only secrets

The forms are lazy routes. Every field comes from the driver's schema in `engine.info`; a driver with no schema (`fields: null`) gets key/value rows with a "secret" checkbox each. Secret inputs follow Vault's pattern exactly: uncontrolled, read at submit, cleared on success, kept on failure. On edit a stored credential shows its protection and offers Replace or Remove, never Show. Moving `base_url` or `host` to a new server needs every stored secret re-entered in the same update; the form says so and holds Save until it's done, and the server enforces it anyway.

**Files:**
- Create: `packages/plugin-herald/src/components/secret-fields.tsx`, `src/pages/provider-create.tsx`, `src/pages/provider-edit.tsx`, `test/provider-create.test.tsx`, `test/provider-edit.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `useEngineInfo`, `HeraldHeader`, `providerPath`, `ProtectionBadge`, wire types.
- Produces: `useSecretFields()` returning `{ register(name): RefCallback, onInput(name, value), read(): Record<string, string>, clear(), filled: ReadonlySet<string> }`; `SecretInput`; `ProviderCreatePage` and `ProviderEditPage` (named and default exports); lazy routes `/new-provider` and `/providers/:id/edit`.

- [ ] **Step 1: Write the failing tests**

`packages/plugin-herald/test/provider-create.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProviderCreatePage } from "../src/pages/provider-create"
import { engine, providerSummary } from "./data"
import { renderWithNavigate, scriptedClient } from "./harness"

const CANARY = "sk_live_canary_herald"
const CREATED = { provider: providerSummary({ id: "hpvd_01j00000000000000000000100" }) }

function expectCanaryNotInMarkup() {
  expect(document.body.innerHTML).not.toContain(CANARY)
  for (const input of document.querySelectorAll("input[type=password]")) expect(input.hasAttribute("value")).toBe(false)
}

function setup(onCreate: (input: Record<string, unknown>) => unknown = () => CREATED) {
  const c = scriptedClient({ "engine.info": engine() }, { "providers.create": onCreate })
  const view = renderWithNavigate(ProviderCreatePage, c.client)
  return { ...c, ...view }
}

async function pickSmtp() {
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Ops SMTP" } })
  fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "email" } })
  fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "smtp" } })
}

describe("ProviderCreatePage", () => {
  it("offers only the channels a driver serves, and only that channel's drivers", async () => {
    setup()
    const channel = (await screen.findByLabelText("Channel")) as HTMLSelectElement
    const channels = [...channel.options].map((o) => o.value).filter(Boolean)
    expect(channels).toEqual(["email", "sms", "inapp"])
    fireEvent.change(channel, { target: { value: "sms" } })
    const drivers = [...(screen.getByLabelText("Driver") as HTMLSelectElement).options].map((o) => o.value).filter(Boolean)
    expect(drivers).toEqual(["legacy-sms", "twilio"])
  })

  it("renders the schema, with the secret as an uncontrolled password field", async () => {
    setup()
    await pickSmtp()
    expect(screen.getByLabelText("Host")).toBeTruthy()
    expect(screen.getByText("Usually 587, or 465 with implicit TLS.")).toBeTruthy()
    const password = screen.getByLabelText("Password") as HTMLInputElement
    expect(password.type).toBe("password")
    expect(password.getAttribute("autocomplete")).toBe("new-password")
    expect(password.getAttribute("spellcheck")).toBe("false")
    expect(password.hasAttribute("value")).toBe(false)
  })

  it("holds Create until the name and every required field are filled", async () => {
    const { sent } = setup()
    await pickSmtp()
    const button = screen.getByRole("button", { name: "Create provider" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.submit(button.closest("form")!)
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "smtp.ops.test" } })
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "587" } })
    expect(button.disabled).toBe(false)
    expect(sent).toEqual([])
  })

  it("sends settings and credentials where the schema puts them, then clears the secret and opens the provider", async () => {
    const { sent, navigate, queried } = setup()
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "smtp.ops.test" } })
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "587" } })
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ops" } })
    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: CANARY } })
    expectCanaryNotInMarkup()
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "providers.create",
      payload: { name: "Ops SMTP", channel: "email", driver: "smtp", priority: 0, enabled: true, credentials: { password: CANARY, username: "ops" }, settings: { host: "smtp.ops.test", port: "587" } },
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/providers/hpvd_01j00000000000000000000100"))
    expect(password.value).toBe("")
    expectCanaryNotInMarkup()
    expect(JSON.stringify(queried)).not.toContain(CANARY)
  })

  it("keeps the secret in the field on failure, out of the markup and out of the error", async () => {
    setup(() => new ContractError("BAD_REQUEST", "herald: invalid provider: smtp: missing required credential \"host\""))
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "smtp.ops.test" } })
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "587" } })
    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    expect((await screen.findByRole("alert")).textContent).toContain("missing required credential")
    expect(password.value).toBe(CANARY)
    expectCanaryNotInMarkup()
  })

  it("falls back to key/value rows for a driver with no schema, secrets to credentials and the rest to settings", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Gateway" } })
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sms" } })
    fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "legacy-sms" } })
    expect(screen.getByText(/no field schema/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }))
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }))
    const keys = screen.getAllByLabelText(/^Key, field/)
    fireEvent.change(keys[0], { target: { value: "gateway" } })
    fireEvent.change(screen.getAllByLabelText(/^Value, field/)[0], { target: { value: "https://sms.test" } })
    fireEvent.change(keys[1], { target: { value: "token" } })
    fireEvent.click(screen.getAllByRole("checkbox", { name: /^Secret, field/ })[1])
    const secret = screen.getAllByLabelText(/^Value, field/)[1] as HTMLInputElement
    expect(secret.type).toBe("password")
    fireEvent.change(secret, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as Record<string, unknown>).credentials).toEqual({ token: CANARY })
    expect((sent[0]?.payload as Record<string, unknown>).settings).toEqual({ gateway: "https://sms.test" })
    expectCanaryNotInMarkup()
  })

  it("sends disabled explicitly when unticked, since the server reads a missing enabled as false", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Inbox" } })
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "inapp" } })
    fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "inapp" } })
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }))
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ name: "Inbox", channel: "inapp", driver: "inapp", priority: 0, enabled: false })
  })
})
```

`packages/plugin-herald/test/provider-edit.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProviderEditPage } from "../src/pages/provider-edit"
import { engine, providerDetail, providerSummary } from "./data"
import { renderWithNavigate, scriptedClient } from "./harness"

const CANARY = "sk_live_canary_edit"
const ID = "hpvd_01j00000000000000000000001"

function setup(onUpdate: (input: Record<string, unknown>) => unknown = () => ({ provider: providerSummary() })) {
  const c = scriptedClient({ "engine.info": engine(), "providers.detail": { provider: providerDetail() } }, { "providers.update": onUpdate })
  const view = renderWithNavigate(ProviderEditPage, c.client, { id: ID })
  return { ...c, ...view }
}

function credentialRow(key: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(key, { selector: "td *, td" }))!
}

describe("ProviderEditPage", () => {
  it("prefills what it can read and shows credentials by protection only", async () => {
    setup()
    expect(((await screen.findByLabelText("Name")) as HTMLInputElement).value).toBe("Primary SMTP")
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("smtp.example.com")
    const row = credentialRow("password")
    expect(within(row).getByText("Encrypted", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(row).getByRole("button", { name: "Replace password" })).toBeTruthy()
    expect(within(row).queryByRole("button", { name: /show/i })).toBeNull()
    expect(document.querySelectorAll("input[type=password]")).toHaveLength(0)
  })

  it("holds Save until something changed", async () => {
    setup()
    expect(((await screen.findByRole("button", { name: "Save changes" })) as HTMLButtonElement).disabled).toBe(true)
  })

  it("replaces one credential and sends only that", async () => {
    const { sent, navigate } = setup()
    fireEvent.click(await screen.findByRole("button", { name: "Replace password" }))
    const input = screen.getByLabelText("New value for password") as HTMLInputElement
    expect(input.type).toBe("password")
    fireEvent.change(input, { target: { value: CANARY } })
    expect(document.body.innerHTML).not.toContain(CANARY)
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setCredentials: { password: CANARY } })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/providers/${ID}`))
    expect(input.value).toBe("")
  })

  it("removes a credential by key", async () => {
    const { sent } = setup()
    fireEvent.click(await screen.findByRole("button", { name: "Remove username" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, removeCredentials: ["username"] })
  })

  it("removes a setting you empty, and sends a changed one", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("From address"), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "465" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setSettings: { port: "465" }, removeSettings: ["from"] })
  })

  it("asks for the secrets again before moving the host, then sends both", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Host"), { target: { value: "smtp.elsewhere.test" } })
    expect(screen.getByText(/Changing host sends credentials to a new server/)).toBeTruthy()
    expect(screen.getByText(/enter password again/)).toBeTruthy()
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Replace password" }))
    fireEvent.change(screen.getByLabelText("New value for password"), { target: { value: CANARY } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setSettings: { host: "smtp.elsewhere.test" }, setCredentials: { password: CANARY } })
  })

  it("keeps a replaced secret in its field on failure and out of the markup", async () => {
    setup(() => new ContractError("UNAVAILABLE", "this provider's credentials are encrypted under a key this server doesn't have"))
    fireEvent.click(await screen.findByRole("button", { name: "Replace password" }))
    const input = screen.getByLabelText("New value for password") as HTMLInputElement
    fireEvent.change(input, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect((await screen.findByRole("alert")).textContent).toContain("encrypted under a key")
    expect(input.value).toBe(CANARY)
    expect(document.body.innerHTML).not.toContain(CANARY)
  })
})
```

Run: `npx vitest run test/provider-create.test.tsx test/provider-edit.test.tsx`. Expected: FAIL, the pages don't exist.

- [ ] **Step 2: The secret-field helper**

`packages/plugin-herald/src/components/secret-fields.tsx`:

```tsx
import { useCallback, useRef, useState } from "react"
import type { ComponentProps } from "react"
import { Input } from "@forge-go/dashboard-kit/components/input"

/**
 * Write-only values, kept where nothing else can read them.
 *
 * A secret lives in its password field's own DOM value for as long as it
 * takes to type it and for one request. It is never React state, never a
 * query param, never a label or an error string. Only whether a field is
 * empty is tracked, to gate Save. `read()` collects the values at submit,
 * `clear()` empties every field after a success; on failure nothing is
 * cleared, so the operator can retry without retyping.
 *
 * The fields are uncontrolled on purpose: React copies a controlled input's
 * value into its `value` attribute, password or not, and anything that
 * serialises markup can then read it.
 */
export function useSecretFields() {
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const [filled, setFilled] = useState<ReadonlySet<string>>(new Set())

  const register = useCallback(
    (name: string) => (el: HTMLInputElement | null) => {
      if (el) inputs.current.set(name, el)
      else inputs.current.delete(name)
    },
    [],
  )

  const onInput = useCallback((name: string, value: string) => {
    setFilled((prev) => {
      const next = new Set(prev)
      if (value === "") next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  /** Called from submit handlers only, never while rendering. */
  const read = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [name, el] of inputs.current) if (el.value !== "") out[name] = el.value
    return out
  }, [])

  const clear = useCallback(() => {
    for (const el of inputs.current.values()) el.value = ""
    setFilled(new Set())
  }, [])

  return { register, onInput, read, clear, filled }
}

export type SecretFields = ReturnType<typeof useSecretFields>

/** "new-password" rather than "off": browsers ignore "off" on password fields. */
export function SecretInput({ name, secrets, ...rest }: { name: string; secrets: SecretFields } & Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "ref" | "onChange" | "name">) {
  return (
    <Input
      {...rest}
      type="password"
      autoComplete="new-password"
      spellCheck={false}
      ref={secrets.register(name)}
      onChange={(e) => secrets.onInput(name, e.target.value)}
    />
  )
}
```

- [ ] **Step 3: The create page**

`packages/plugin-herald/src/pages/provider-create.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { SecretInput, useSecretFields } from "../components/secret-fields"
import { providerPath } from "../keys"
import type { EngineInfoResponse, FieldInfo, ProviderResponse, ProvidersCreateRequest } from "../wire"

interface FreeRow {
  rowId: number
  key: string
  secret: boolean
  value: string
}

function FieldHelp({ field }: { field: FieldInfo }) {
  return field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null
}

function CreateForm({ engine }: { engine: EngineInfoResponse }) {
  const create = useCommand<ProviderResponse>("providers.create")
  const navigateTo = useNavigateTo()
  const secrets = useSecretFields()
  const [name, setName] = useState("")
  const [channel, setChannel] = useState("")
  const [driverName, setDriverName] = useState("")
  const [priority, setPriority] = useState("0")
  const [enabled, setEnabled] = useState(true)
  const [values, setValues] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<FreeRow[]>([])
  const [nextRow, setNextRow] = useState(1)

  const channels = engine.channels.filter((c) => engine.drivers.some((d) => d.channel === c))
  const drivers = engine.drivers.filter((d) => d.channel === channel)
  const driver = drivers.find((d) => d.name === driverName)
  const fields = driver?.fields ?? null
  const priorityNumber = Number(priority)
  const missing = (fields ?? []).filter((f) => f.required && (f.secret ? !secrets.filled.has(f.key) : (values[f.key] ?? "").trim() === ""))
  const rowKeys = rows.map((r) => r.key.trim())
  const rowsValid = rowKeys.every((k) => k !== "") && new Set(rowKeys).size === rowKeys.length
  const canSubmit = !create.loading && name.trim() !== "" && driver !== undefined && priority.trim() !== "" && Number.isInteger(priorityNumber) && missing.length === 0 && rowsValid

  function pickChannel(next: string) {
    secrets.clear()
    setChannel(next)
    setDriverName("")
    setValues({})
    setRows([])
  }

  function pickDriver(next: string) {
    secrets.clear()
    setDriverName(next)
    setValues({})
    setRows([])
  }

  function updateRow(rowId: number, change: Partial<FreeRow>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...change, ...(change.secret !== undefined ? { value: "" } : {}) } : r)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || !driver) return
    const secretValues = secrets.read()
    const credentials: Record<string, string> = {}
    const settings: Record<string, string> = {}
    if (fields) {
      for (const f of fields) {
        if (f.secret) {
          if (secretValues[f.key]) credentials[f.key] = secretValues[f.key]
          continue
        }
        const value = (values[f.key] ?? "").trim()
        if (value === "") continue
        if (f.placement === "setting") settings[f.key] = value
        else credentials[f.key] = value
      }
    } else {
      for (const r of rows) {
        const key = r.key.trim()
        if (r.secret) {
          const value = secretValues[`row-${r.rowId}`]
          if (value) credentials[key] = value
        } else if (r.value.trim() !== "") {
          settings[key] = r.value.trim()
        }
      }
    }
    const payload: ProvidersCreateRequest = { name: name.trim(), channel, driver: driver.name, priority: priorityNumber, enabled }
    if (Object.keys(credentials).length > 0) payload.credentials = credentials
    if (Object.keys(settings).length > 0) payload.settings = settings
    const result = await create.execute(payload)
    // undefined means the client threw: every value stays put for a retry.
    if (result === undefined) return
    secrets.clear()
    navigateTo(providerPath(result.provider.id))
  }

  const settingFields = (fields ?? []).filter((f) => f.placement === "setting")
  const credentialFields = (fields ?? []).filter((f) => f.placement === "credential")

  function renderField(f: FieldInfo) {
    const id = `field-${f.key}`
    return (
      <div key={f.key} className="flex flex-col gap-1.5">
        <Label htmlFor={id}>
          {f.label}
          {f.required && <span aria-hidden="true"> *</span>}
        </Label>
        {f.secret ? (
          <SecretInput id={id} name={f.key} secrets={secrets} aria-required={f.required || undefined} />
        ) : (
          <Input
            id={id}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-required={f.required || undefined}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        )}
        <FieldHelp field={f} />
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-5">
      <CommandAlert error={create.error} title="Could not create the provider" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="provider-name">Name</Label>
        <Input id="provider-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-channel">Channel</Label>
          <NativeSelect id="provider-channel" value={channel} onChange={(e) => pickChannel(e.target.value)}>
            <NativeSelectOption value="">Choose a channel</NativeSelectOption>
            {channels.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-driver">Driver</Label>
          <NativeSelect id="provider-driver" value={driverName} disabled={channel === ""} onChange={(e) => pickDriver(e.target.value)}>
            <NativeSelectOption value="">{channel === "" ? "Choose a channel first" : "Choose a driver"}</NativeSelectOption>
            {drivers.map((d) => (
              <NativeSelectOption key={d.name} value={d.name}>
                {d.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-priority">Priority</Label>
          <Input id="provider-priority" inputMode="numeric" className="font-mono" value={priority} onChange={(e) => setPriority(e.target.value)} />
          <p className="text-xs text-muted-foreground">Lower goes first when no routing rule picks a provider.</p>
        </div>
        <div className="flex items-center gap-2 self-center">
          <Switch id="provider-enabled" aria-label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-sm">Enabled</span>
        </div>
      </div>

      {driver && fields && fields.length === 0 && <p className="text-sm text-muted-foreground">This driver needs no settings or credentials.</p>}

      {driver && settingFields.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Settings</legend>
          {settingFields.map(renderField)}
        </fieldset>
      )}
      {driver && credentialFields.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Credentials</legend>
          <p className="text-xs text-muted-foreground">Write-only. Once saved, a credential can be replaced or removed, never shown.</p>
          {credentialFields.map(renderField)}
        </fieldset>
      )}

      {driver && fields === null && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Fields</legend>
          <p className="text-sm text-muted-foreground">
            This driver has no field schema, so Herald can't tell settings from secrets. Mark each secret: secrets are stored as credentials and never shown again, the rest as settings.
          </p>
          {rows.map((r, i) => (
            <div key={r.rowId} className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`row-key-${r.rowId}`}>{`Key, field ${i + 1}`}</Label>
                <Input id={`row-key-${r.rowId}`} className="font-mono" value={r.key} onChange={(e) => updateRow(r.rowId, { key: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox aria-label={`Secret, field ${i + 1}`} checked={r.secret} onCheckedChange={(checked) => updateRow(r.rowId, { secret: checked === true })} />
                <span className="text-sm" aria-hidden="true">
                  Secret
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`row-value-${r.rowId}`}>{`Value, field ${i + 1}`}</Label>
                {r.secret ? (
                  <SecretInput id={`row-value-${r.rowId}`} name={`row-${r.rowId}`} secrets={secrets} />
                ) : (
                  <Input id={`row-value-${r.rowId}`} className="font-mono" value={r.value} onChange={(e) => updateRow(r.rowId, { value: e.target.value })} />
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows((prev) => prev.filter((x) => x.rowId !== r.rowId))}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRows((prev) => [...prev, { rowId: nextRow, key: "", secret: false, value: "" }])
                setNextRow((n) => n + 1)
              }}
            >
              Add a field
            </Button>
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {create.loading ? "Creating…" : "Create provider"}
        </Button>
        <PluginLink to="/providers" className="text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}

export const ProviderCreatePage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="New provider" description="The fields come from the driver. Credentials are write-only: once saved, you can replace them, never read them back." />
      <QueryBoundary title="Drivers" query={info} skeletonRows={4}>
        {(engine) => <CreateForm engine={engine} />}
      </QueryBoundary>
    </section>
  )
}

export default ProviderCreatePage
```

- [ ] **Step 4: The edit page**

`packages/plugin-herald/src/pages/provider-edit.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { ProtectionBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { SecretInput, useSecretFields } from "../components/secret-fields"
import { providerPath } from "../keys"
import type { EngineInfoResponse, FieldInfo, ProviderDetail, ProviderResponse, ProvidersDetailResponse, ProvidersUpdateRequest } from "../wire"

const TARGETS = ["base_url", "host"]

function EditForm({ provider, engine }: { provider: ProviderDetail; engine: EngineInfoResponse }) {
  const update = useCommand<ProviderResponse>("providers.update")
  const navigateTo = useNavigateTo()
  const secrets = useSecretFields()
  const schema = engine.drivers.find((d) => d.name === provider.driver)?.fields ?? null
  const schemaless = schema === null || schema.length === 0
  const fieldOf = (key: string): FieldInfo | undefined => schema?.find((f) => f.key === key)

  const storedSettings = provider.settings
  const storedSettingKeys = new Set(storedSettings.map((s) => s.key))
  const storedCredKeys = new Set(provider.credentials.map((c) => c.key))
  const newSettingFields = (schema ?? []).filter((f) => f.placement === "setting" && !storedSettingKeys.has(f.key))
  const newCredentialFields = (schema ?? []).filter((f) => f.placement === "credential" && !storedCredKeys.has(f.key))

  const [name, setName] = useState(provider.name)
  const [priority, setPriority] = useState(String(provider.priority))
  const [enabled, setEnabled] = useState(provider.enabled)
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>(() => Object.fromEntries(storedSettings.filter((s) => !s.secret).map((s) => [s.key, s.value ?? ""])))
  const [newValues, setNewValues] = useState<Record<string, string>>({})
  const [replacing, setReplacing] = useState<ReadonlySet<string>>(new Set())
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())

  const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  // What would change, from state only: secrets count by whether their field
  // is filled, never by their value.
  const settingChanged = (key: string, original: string) => (settingDrafts[key] ?? "").trim() !== original
  const changedSettings = storedSettings.filter((s) => !s.secret && settingChanged(s.key, s.value ?? ""))
  const newSettingsFilled = newSettingFields.filter((f) => (f.secret ? secrets.filled.has(`setting:${f.key}`) : (newValues[`setting:${f.key}`] ?? "").trim() !== ""))
  const newCredsFilled = newCredentialFields.filter((f) => (f.secret ? secrets.filled.has(`cred:${f.key}`) : (newValues[`cred:${f.key}`] ?? "").trim() !== ""))
  const replacedFilled = [...replacing].filter((key) => secrets.filled.has(key.startsWith("setting:") ? key : `cred:${key}`))
  const hasChanges =
    name.trim() !== provider.name ||
    Number(priority) !== provider.priority ||
    enabled !== provider.enabled ||
    changedSettings.length > 0 ||
    newSettingsFilled.length > 0 ||
    newCredsFilled.length > 0 ||
    replacedFilled.length > 0 ||
    removing.size > 0

  // Mirrors the server's rule: moving where the driver connects needs every
  // stored secret entered again, or the next send would hand them to the new
  // server. The server refuses it too; this just says so before you press Save.
  const moved = TARGETS.filter((target) => {
    const stored = storedSettings.find((s) => s.key === target)
    if (stored?.secret) return secrets.filled.has(`setting:${target}`)
    const draft = stored ? (settingDrafts[target] ?? "").trim() : (newValues[`setting:${target}`] ?? "").trim()
    return draft !== "" && draft !== (stored?.value ?? "")
  })
  const mustReenter = provider.credentials
    .map((c) => c.key)
    .filter((key) => (schemaless || fieldOf(key)?.secret === true) && !removing.has(key) && !secrets.filled.has(`cred:${key}`))
    .sort()
  const blockedByMove = moved.length > 0 && mustReenter.length > 0

  const canSubmit = !update.loading && hasChanges && !blockedByMove && name.trim() !== "" && Number.isInteger(Number(priority))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const secretValues = secrets.read()
    const payload: ProvidersUpdateRequest = { id: provider.id }
    if (name.trim() !== provider.name) payload.name = name.trim()
    if (Number(priority) !== provider.priority) payload.priority = Number(priority)
    if (enabled !== provider.enabled) payload.enabled = enabled
    const setSettings: Record<string, string> = {}
    const removeSettings: string[] = []
    const setCredentials: Record<string, string> = {}
    const removeCredentials: string[] = []
    for (const s of storedSettings) {
      if (s.secret) {
        if (removing.has(`setting:${s.key}`)) removeSettings.push(s.key)
        else if (secretValues[`setting:${s.key}`]) setSettings[s.key] = secretValues[`setting:${s.key}`]
        continue
      }
      const draft = (settingDrafts[s.key] ?? "").trim()
      if (draft === (s.value ?? "")) continue
      if (draft === "") removeSettings.push(s.key)
      else setSettings[s.key] = draft
    }
    for (const f of newSettingFields) {
      const value = f.secret ? secretValues[`setting:${f.key}`] : (newValues[`setting:${f.key}`] ?? "").trim()
      if (value) setSettings[f.key] = value
    }
    for (const c of provider.credentials) {
      if (removing.has(c.key)) removeCredentials.push(c.key)
      else if (secretValues[`cred:${c.key}`]) setCredentials[c.key] = secretValues[`cred:${c.key}`]
    }
    for (const f of newCredentialFields) {
      const value = f.secret ? secretValues[`cred:${f.key}`] : (newValues[`cred:${f.key}`] ?? "").trim()
      if (value) setCredentials[f.key] = value
    }
    if (Object.keys(setSettings).length > 0) payload.setSettings = setSettings
    if (removeSettings.length > 0) payload.removeSettings = removeSettings
    if (Object.keys(setCredentials).length > 0) payload.setCredentials = setCredentials
    if (removeCredentials.length > 0) payload.removeCredentials = removeCredentials
    const result = await update.execute(payload)
    if (result === undefined) return
    secrets.clear()
    navigateTo(providerPath(provider.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-5">
      <CommandAlert error={update.error} title="Could not save the provider" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-name">Name</Label>
          <Input id="provider-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-priority">Priority</Label>
          <Input id="provider-priority" inputMode="numeric" className="font-mono" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="provider-enabled" aria-label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-sm">Enabled</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Channel {provider.channel} and driver <span className="font-mono text-xs">{provider.driver}</span> can't change. Create a new provider for another driver.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Settings</legend>
        {storedSettings.map((s) => {
          const field = fieldOf(s.key)
          const id = `setting-${s.key}`
          if (s.secret) {
            const key = `setting:${s.key}`
            return (
              <div key={s.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{s.key}</span>
                <span className="text-muted-foreground">{removing.has(key) ? "Will be removed" : "Hidden"}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => setReplacing((r) => toggle(r, key))}>
                  {replacing.has(key) ? "Keep" : `Replace ${s.key}`}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setRemoving((r) => toggle(r, key))}>
                  {removing.has(key) ? "Undo" : `Remove ${s.key}`}
                </Button>
                {replacing.has(key) && !removing.has(key) && <SecretInput aria-label={`New value for ${s.key}`} name={key} secrets={secrets} />}
              </div>
            )
          }
          return (
            <div key={s.key} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{field?.label ?? s.key}</Label>
              <Input id={id} className="font-mono" autoComplete="off" spellCheck={false} value={settingDrafts[s.key] ?? ""} onChange={(e) => setSettingDrafts((d) => ({ ...d, [s.key]: e.target.value }))} />
              {field?.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
              {(settingDrafts[s.key] ?? "").trim() === "" && <p className="text-xs text-muted-foreground">Empty removes this setting.</p>}
            </div>
          )
        })}
        {newSettingFields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`setting-${f.key}`}>{f.label}</Label>
            {f.secret ? (
              <SecretInput id={`setting-${f.key}`} name={`setting:${f.key}`} secrets={secrets} />
            ) : (
              <Input id={`setting-${f.key}`} className="font-mono" autoComplete="off" spellCheck={false} value={newValues[`setting:${f.key}`] ?? ""} onChange={(e) => setNewValues((v) => ({ ...v, [`setting:${f.key}`]: e.target.value }))} />
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}
        {storedSettings.length === 0 && newSettingFields.length === 0 && <p className="text-sm text-muted-foreground">No settings.</p>}
      </fieldset>

      {blockedByMove && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          Changing {moved.join(" and ")} sends credentials to a new server, so enter {mustReenter.join(", ")} again in this update, or remove {mustReenter.length === 1 ? "it" : "them"}.
        </p>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Credentials</legend>
        <p className="text-xs text-muted-foreground">Write-only. Replace or remove a credential; its value is never shown.</p>
        {provider.credentials.length > 0 && (
          <table className="w-full text-sm" aria-label="Stored credentials">
            <tbody>
              {provider.credentials.map((c) => (
                <tr key={c.key} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{c.key}</td>
                  <td className="py-2">
                    <ProtectionBadge protection={c.protection} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {removing.has(c.key) ? <span className="text-muted-foreground">Will be removed</span> : null}
                      <Button type="button" size="xs" variant="outline" disabled={removing.has(c.key)} onClick={() => setReplacing((r) => toggle(r, c.key))}>
                        {replacing.has(c.key) ? "Keep" : `Replace ${c.key}`}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setRemoving((r) => toggle(r, c.key))}>
                        {removing.has(c.key) ? "Undo" : `Remove ${c.key}`}
                      </Button>
                    </div>
                    {replacing.has(c.key) && !removing.has(c.key) && (
                      <div className="mt-2">
                        <SecretInput aria-label={`New value for ${c.key}`} name={`cred:${c.key}`} secrets={secrets} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {newCredentialFields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
            {f.secret ? (
              <SecretInput id={`cred-${f.key}`} name={`cred:${f.key}`} secrets={secrets} />
            ) : (
              <Input id={`cred-${f.key}`} className="font-mono" autoComplete="off" spellCheck={false} value={newValues[`cred:${f.key}`] ?? ""} onChange={(e) => setNewValues((v) => ({ ...v, [`cred:${f.key}`]: e.target.value }))} />
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}
        {provider.credentials.length === 0 && newCredentialFields.length === 0 && <p className="text-sm text-muted-foreground">No credentials.</p>}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <PluginLink to={providerPath(provider.id)} className="text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}

function EditBody({ id }: { id: string }) {
  const info = useEngineInfo()
  const detail = useQuery<ProvidersDetailResponse>("providers.detail", { id })
  return (
    <QueryBoundary title="Provider" query={detail} skeletonRows={5}>
      {({ provider }) => (
        <section className="flex flex-col gap-4">
          <HeraldHeader title={`Edit ${provider.name}`} description="Only what you change is sent. A credential you leave alone stays as it is." />
          <QueryBoundary title="Drivers" query={info} skeletonRows={3}>
            {(engine) => <EditForm key={provider.id} provider={provider} engine={engine} />}
          </QueryBoundary>
        </section>
      )}
    </QueryBoundary>
  )
}

export const ProviderEditPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No provider ID in the address, so there is nothing to edit.
      </p>
    )
  }
  return <EditBody id={id} />
}

export default ProviderEditPage
```

The edit test's `credentialRow` helper finds the stored-credentials row by its key cell; the edit form's credentials table is labelled "Stored credentials". The test data's provider has `password` and `username` stored and `host`, `port`, `from` as settings, so `Username` never appears as a new-field label on edit.

- [ ] **Step 5: Register them as lazy routes**

In `src/index.tsx`, add `import { lazy } from "react"` and:

```tsx
/**
 * The provider forms are their own chunks: only an operator adding or
 * changing a provider pays for them. PluginHost wraps every page in Suspense.
 */
const ProviderCreatePage = lazy(() => import("./pages/provider-create"))
const ProviderEditPage = lazy(() => import("./pages/provider-edit"))
```

Append to `routes` (no nav entries: they are reached from buttons, and create lives at `/new-provider` so no ID can collide with it):

```tsx
{ path: "/new-provider", element: ProviderCreatePage },
{ path: "/providers/:id/edit", element: ProviderEditPage },
```

`ROUTES` in `test/plugin.test.tsx` becomes `["/", "/providers", "/providers/:id", "/new-provider", "/providers/:id/edit"]`.

- [ ] **Step 6: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/components/secret-fields.tsx packages/plugin-herald/src/pages/provider-create.tsx packages/plugin-herald/src/pages/provider-edit.tsx packages/plugin-herald/test/provider-create.test.tsx packages/plugin-herald/test/provider-edit.test.tsx
git commit --only -m "feat(plugin-herald): create and edit providers from the driver schema with write-only credentials" -- packages/plugin-herald/src/components/secret-fields.tsx packages/plugin-herald/src/pages/provider-create.tsx packages/plugin-herald/src/pages/provider-edit.tsx packages/plugin-herald/test/provider-create.test.tsx packages/plugin-herald/test/provider-edit.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 5: Templates list, the missing-fallback view, reset, and create

**Files:**
- Create: `packages/plugin-herald/src/pages/templates.tsx`, `src/pages/template-create.tsx`, `test/templates.test.tsx`, `test/template-create.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useEngineInfo`, `plural`, `CATEGORIES`, `templatePath`, `EnabledBadge`, wire types.
- Produces: `TemplatesPage`, `TemplatesWithoutFallbackPage`, `TemplateCreatePage`; routes `/templates`, `/templates-without-fallback`, `/new-template`; nav "Templates" (priority 10). Rows link to `templatePath(id)`, a route plan 2b-2 adds.

- [ ] **Step 1: Write the failing tests**

`packages/plugin-herald/test/templates.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { TemplatesPage, TemplatesWithoutFallbackPage } from "../src/pages/templates"
import { engine, templateSummary } from "./data"
import { recordingQueryClient, renderPage, scriptedClient } from "./harness"

const LIST = {
  templates: [
    templateSummary(),
    templateSummary({ id: "htpl_01j00000000000000000000011", slug: "auth.welcome", name: "Welcome Email", category: "auth", isSystem: true, hasFallback: false, locales: [{ locale: "en", active: true }] }),
    templateSummary({ id: "htpl_01j00000000000000000000016", slug: "ops.digest", name: "Daily digest", category: "system", enabled: false, locales: [] }),
  ],
}

describe("TemplatesPage", () => {
  it("asks for every template first, sending no empty filters", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "templates.list": LIST })
    renderPage(TemplatesPage, client)
    await screen.findByText("3 templates")
    expect(sent.find((s) => s.intent === "templates.list")?.params).toEqual({})
  })

  it("sends only the filters you set", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "templates.list": LIST })
    renderPage(TemplatesPage, client)
    await screen.findByText("3 templates")
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sms" } })
    fireEvent.change(screen.getByLabelText("Fallback"), { target: { value: "missing" } })
    await waitFor(() => expect(sent.filter((s) => s.intent === "templates.list").map((s) => s.params)).toContainEqual({ channel: "sms", noFallback: true }))
  })

  it("shows slugs in mono, locales as tags with the inactive ones marked, and the fallback named", async () => {
    renderPage(TemplatesPage, recordingQueryClient({ "engine.info": engine(), "templates.list": LIST }).client)
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("Receipt"))!
    expect(within(row).getByText("billing.receipt").closest("td")?.className).toMatch(/font-mono text-xs/)
    expect(within(row).getByText("fallback")).toBeTruthy()
    expect(within(row).getByText("fr (inactive)")).toBeTruthy()
    const digest = screen.getAllByRole("row").find((r) => within(r).queryByText("Daily digest"))!
    expect(within(digest).getByLabelText("no versions")).toBeTruthy()
    expect(within(digest).getByText("Disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
    const welcome = screen.getAllByRole("row").find((r) => within(r).queryByText("Welcome Email"))!
    expect(within(welcome).getByText("System")).toBeTruthy()
    expect(within(welcome).getByRole("link", { name: "Welcome Email" }).getAttribute("href")).toBe("/templates/htpl_01j00000000000000000000011")
  })

  it("tells nothing-here from nothing-matching", async () => {
    renderPage(TemplatesPage, recordingQueryClient({ "engine.info": engine(), "templates.list": { templates: [] } }).client)
    expect(await screen.findByText(/No templates yet/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "auth" } })
    expect(await screen.findByText("No templates match these filters.")).toBeTruthy()
  })

  it("resets the system templates behind a confirm that says custom ones are kept", async () => {
    const c = scriptedClient({ "engine.info": engine(), "templates.list": LIST }, { "templates.resetDefaults": { deleted: 4, seeded: 4 } })
    renderPage(TemplatesPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Reset system templates" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/Custom templates are kept/)
    expect(dialog.textContent).toMatch(/edits you made to system templates are lost/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "templates.resetDefaults", payload: {} }]))
    expect(await screen.findByText("Removed 4 system templates and seeded 4.")).toBeTruthy()
  })
})

describe("TemplatesWithoutFallbackPage", () => {
  it("opens filtered to templates without a fallback and says why that matters", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "templates.list": LIST })
    renderPage(TemplatesWithoutFallbackPage, client)
    expect(await screen.findByText(/fails for any locale it doesn't list/)).toBeTruthy()
    expect(sent.find((s) => s.intent === "templates.list")?.params).toEqual({ noFallback: true })
  })
})
```

`packages/plugin-herald/test/template-create.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TemplateCreatePage } from "../src/pages/template-create"
import { engine, templateSummary } from "./data"
import { renderWithNavigate, scriptedClient } from "./harness"

const CREATED = { template: templateSummary({ id: "htpl_01j00000000000000000000101", slug: "billing.dunning" }) }

function setup(onCreate: () => unknown = () => CREATED) {
  const c = scriptedClient({ "engine.info": engine() }, { "templates.create": onCreate })
  return { ...c, ...renderWithNavigate(TemplateCreatePage, c.client) }
}

async function fill() {
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Dunning" } })
  fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "billing.dunning" } })
  fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "email" } })
}

describe("TemplateCreatePage", () => {
  it("creates with a fallback version by default and opens the template", async () => {
    const { sent, navigate } = setup()
    await fill()
    fireEvent.click(screen.getByRole("button", { name: "Create template" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ slug: "billing.dunning", name: "Dunning", channel: "email", category: "transactional", version: { locale: "" } })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/templates/htpl_01j00000000000000000000101"))
  })

  it("starts with the locale you type instead", async () => {
    const { sent } = setup()
    await fill()
    fireEvent.change(screen.getByLabelText("First version's locale"), { target: { value: "pt-BR" } })
    fireEvent.click(screen.getByRole("button", { name: "Create template" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as { version: unknown }).version).toEqual({ locale: "pt-BR" })
  })

  it("refuses a slug the server would refuse, before sending it", async () => {
    const { sent } = setup()
    await fill()
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "Billing Dunning" } })
    expect(screen.getByText(/lower-case letters, digits, dots, dashes or underscores/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Create template" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("explains a duplicate slug on the same channel", async () => {
    setup(() => new ContractError("CONFLICT", "a template with this slug already exists on this channel"))
    await fill()
    fireEvent.click(screen.getByRole("button", { name: "Create template" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/billing\.dunning already exists on email/)
  })
})
```

Run: `npx vitest run test/templates.test.tsx test/template-create.test.tsx`. Expected: FAIL.

- [ ] **Step 2: The list**

`packages/plugin-herald/src/pages/templates.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { EnabledBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { CATEGORIES, plural } from "../format"
import { templatePath } from "../keys"
import type { TemplateSummary, TemplatesListResponse, TemplatesResetDefaultsResponse } from "../wire"

/** "fallback" for the "" locale, "fr (inactive)" for a version that answers nothing. */
function localeTags(t: TemplateSummary): string[] {
  return t.locales.map((l) => `${l.locale === "" ? "fallback" : l.locale}${l.active ? "" : " (inactive)"}`)
}

const columns: Column<TemplateSummary>[] = [
  { id: "name", header: "Name", className: "font-medium", cell: (t) => <PluginLink to={templatePath(t.id)}>{t.name}</PluginLink> },
  { id: "slug", header: "Slug", className: "font-mono text-xs", cell: (t) => t.slug },
  { id: "channel", header: "Channel", cell: (t) => t.channel },
  { id: "category", header: "Category", cell: (t) => t.category },
  { id: "locales", header: "Locales", cell: (t) => <TagList values={localeTags(t)} label="versions" /> },
  { id: "origin", header: "Origin", cell: (t) => (t.isSystem ? "System" : "Custom") },
  { id: "status", header: "Status", cell: (t) => <EnabledBadge enabled={t.enabled} /> },
]

function NewTemplateLink() {
  return (
    <PluginLink to="/new-template" className={buttonVariants()}>
      New template
    </PluginLink>
  )
}

function TemplatesView({ startWithoutFallback }: { startWithoutFallback: boolean }) {
  const info = useEngineInfo()
  const [channel, setChannel] = useState("")
  const [category, setCategory] = useState("")
  const [fallback, setFallback] = useState(startWithoutFallback ? "missing" : "")
  const reset = useCommand<TemplatesResetDefaultsResponse>("templates.resetDefaults")
  const [confirming, setConfirming] = useState(false)

  // Absent, never "": params are the query's cache key.
  const params: Record<string, unknown> = {}
  if (channel) params.channel = channel
  if (category) params.category = category
  if (fallback === "missing") params.noFallback = true
  const list = useQuery<TemplatesListResponse>("templates.list", params)
  const filtered = channel !== "" || category !== "" || fallback !== ""

  function openReset() {
    reset.reset()
    setConfirming(true)
  }

  async function confirmReset() {
    const result = await reset.execute({})
    if (result === undefined) return
    setConfirming(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader
        title={startWithoutFallback ? "Templates without a fallback" : "Templates"}
        description={
          startWithoutFallback
            ? "A template with no live fallback version fails for any locale it doesn't list. Add a version with an empty locale to give it one."
            : "What Herald renders for each channel. A template answers a locale with its own version, its language, or the fallback version."
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openReset}>
              Reset system templates
            </Button>
            <NewTemplateLink />
          </div>
        }
      />
      <FilterBar
        filters={[
          { id: "channel", label: "Channel", value: channel, onChange: setChannel, options: [{ label: "All channels", value: "" }, ...(info.data?.channels ?? []).map((c) => ({ label: c, value: c }))] },
          { id: "category", label: "Category", value: category, onChange: setCategory, options: [{ label: "All categories", value: "" }, ...CATEGORIES.map((c) => ({ label: c, value: c }))] },
          { id: "fallback", label: "Fallback", value: fallback, onChange: setFallback, options: [{ label: "Any", value: "" }, { label: "Without a fallback version", value: "missing" }] },
        ]}
      />
      {reset.data && (
        <p role="status" className="text-sm">
          Removed {plural(reset.data.deleted, "system template")} and seeded {reset.data.seeded}.
        </p>
      )}
      <QueryBoundary title="Templates" query={list} skeletonRows={6}>
        {(data) => (
          <ResourceTable<TemplateSummary>
            columns={columns}
            rows={data.templates}
            rowKey={(t) => t.id}
            caption={plural(data.templates.length, "template")}
            emptyMessage={filtered ? "No templates match these filters." : "No templates yet. Create one, or reset the system templates to get Herald's defaults."}
            emptyAction={filtered ? undefined : <NewTemplateLink />}
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && !reset.loading && setConfirming(false)}
        title="Reset the system templates?"
        description="This deletes every system template in this app and seeds Herald's defaults again. Custom templates are kept. Any edits you made to system templates are lost."
        confirmLabel="Reset"
        pending={reset.loading}
        onConfirm={() => void confirmReset()}
      >
        <CommandAlert error={reset.error} title="Could not reset the system templates" />
      </ConfirmDialog>
    </section>
  )
}

export const TemplatesPage: ComponentType<PluginPageProps> = () => <TemplatesView startWithoutFallback={false} />

/** The overview's "Show them" link lands here, already filtered. */
export const TemplatesWithoutFallbackPage: ComponentType<PluginPageProps> = () => <TemplatesView startWithoutFallback />
```

- [ ] **Step 3: Create**

`packages/plugin-herald/src/pages/template-create.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { CATEGORIES } from "../format"
import { templatePath } from "../keys"
import type { EngineInfoResponse, TemplateResponse, TemplatesCreateRequest } from "../wire"

/** The server's own patterns, so a refusal shows before the round trip. */
const SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

function CreateForm({ engine }: { engine: EngineInfoResponse }) {
  const create = useCommand<TemplateResponse>("templates.create")
  const navigateTo = useNavigateTo()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [channel, setChannel] = useState("")
  const [category, setCategory] = useState("transactional")
  const [locale, setLocale] = useState("")
  const [sent, setSent] = useState<{ slug: string; channel: string } | null>(null)

  const slugValue = slug.trim()
  const localeValue = locale.trim()
  const slugBad = slugValue !== "" && !SLUG.test(slugValue)
  const localeBad = localeValue !== "" && !LOCALE.test(localeValue)
  const canSubmit = !create.loading && name.trim() !== "" && slugValue !== "" && !slugBad && channel !== "" && !localeBad

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const payload: TemplatesCreateRequest = { slug: slugValue, name: name.trim(), channel, category, version: { locale: localeValue } }
    setSent({ slug: slugValue, channel })
    const result = await create.execute(payload)
    if (result === undefined) return
    navigateTo(templatePath(result.template.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-4">
      <CommandAlert
        title="Could not create the template"
        error={
          sent !== null && create.error?.code === "CONFLICT"
            ? { code: create.error.code, message: `A template with the slug ${sent.slug} already exists on ${sent.channel}. Slugs are unique per channel; open the existing one, or pick another slug.` }
            : create.error
        }
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">Name</Label>
        <Input id="template-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-slug">Slug</Label>
        <Input id="template-slug" className="font-mono" autoComplete="off" spellCheck={false} value={slug} aria-invalid={slugBad || undefined} onChange={(e) => setSlug(e.target.value)} />
        <p className={slugBad ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          What callers send to pick this template. Use lower-case letters, digits, dots, dashes or underscores. It can't change later.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-channel">Channel</Label>
          <NativeSelect id="template-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <NativeSelectOption value="">Choose a channel</NativeSelectOption>
            {engine.channels.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-category">Category</Label>
          <NativeSelect id="template-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-locale">First version's locale</Label>
        <Input id="template-locale" className="font-mono" placeholder={engine.defaultLocale} autoComplete="off" spellCheck={false} value={locale} aria-invalid={localeBad || undefined} onChange={(e) => setLocale(e.target.value)} />
        <p className={localeBad ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          Empty starts with the fallback version, which answers any locale the template doesn't list. A tag like en or pt-BR starts with that translation instead.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {create.loading ? "Creating…" : "Create template"}
        </Button>
        <PluginLink to="/templates" className="text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}

export const TemplateCreatePage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="New template" description="Its content, variables and other locales are edited in the template workspace once it exists." />
      <QueryBoundary title="Channels" query={info} skeletonRows={3}>
        {(engine) => <CreateForm engine={engine} />}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Register them**

In `src/index.tsx`: import and export `TemplatesPage`, `TemplatesWithoutFallbackPage`, `TemplateCreatePage`; add `FileTextIcon` to the icon import; append to `nav`:

```tsx
{ label: "Templates", to: "/templates", priority: 10, icon: <FileTextIcon />, group: "Notifications" },
```

and to `routes`:

```tsx
{ path: "/templates", element: TemplatesPage },
{ path: "/templates-without-fallback", element: TemplatesWithoutFallbackPage },
{ path: "/new-template", element: TemplateCreatePage },
```

`ROUTES` gains `"/templates", "/templates-without-fallback", "/new-template"` at the end; `NAV` gains `"/templates"` at the end (nav array order is declaration order; the sidebar sorts by priority).

- [ ] **Step 5: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/pages/templates.tsx packages/plugin-herald/src/pages/template-create.tsx packages/plugin-herald/test/templates.test.tsx packages/plugin-herald/test/template-create.test.tsx
git commit --only -m "feat(plugin-herald): list templates, show the ones without a fallback, and create one" -- packages/plugin-herald/src/pages/templates.tsx packages/plugin-herald/src/pages/template-create.tsx packages/plugin-herald/test/templates.test.tsx packages/plugin-herald/test/template-create.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 6: Messages and message detail

**Files:**
- Create: `packages/plugin-herald/src/components/cursor-pager.tsx`, `src/pages/messages.tsx`, `src/pages/message-detail.tsx`, `test/messages.test.tsx`, `test/message-detail.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useEngineInfo`, `plural`, `statusLabel`, `WRITTEN_STATUSES`, `NO_RECEIPTS`, `messagePath`, `messageSendTestPath`, `templatePath`, `providerPath`, `MessageStatusBadge`.
- Produces: `useCursorStack()`, `CursorPager` (used again by Task 7); `MessagesPage`, `MessageDetailPage`; routes `/messages`, `/messages/:id`; nav "Messages" (priority 20).

- [ ] **Step 1: Copy the cursor pager**

`packages/plugin-herald/src/components/cursor-pager.tsx`: copy `packages/plugin-relay/src/components/cursor-pager.tsx` byte for byte, then replace its first two comment lines with:

```tsx
// Copied from plugin-relay, which copied it from plugin-authsome: plugin
// packages do not depend on each other. This is the third copy, so it is owed
// to kit; it stays here while kit carries another session's uncommitted edits.
```

- [ ] **Step 2: Write the failing tests**

`packages/plugin-herald/test/messages.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { MessagesPage } from "../src/pages/messages"
import { engine, messageSummary } from "./data"
import { recordingQueryClient, renderPage } from "./harness"

const PAGE1 = {
  messages: [
    messageSummary(),
    messageSummary({ id: "hmsg_01j00000000000000000001001", recipient: "+15550111", channel: "sms", status: "failed", error: "twilio: 21211 invalid 'To' phone number", templateSlug: "auth.mfa-code", provider: { id: "hpvd_01j00000000000000000000002", name: "Twilio", driver: "twilio" } }),
    messageSummary({ id: "hmsg_01j00000000000000000001008", status: "suppressed", provider: null, templateSlug: undefined, sentAt: undefined }),
  ],
  nextCursor: "bzoyNQ",
}

function list(params: Record<string, unknown>) {
  if (params.cursor === "end") return { messages: [] }
  if (params.cursor) return { messages: [messageSummary({ id: "hmsg_01j00000000000000000001030", recipient: "late@example.com" })], nextCursor: "end" }
  if (params.channel === "push") return { messages: [] }
  return PAGE1
}

function client() {
  const sent: Record<string, unknown>[] = []
  const c = recordingQueryClient({ "engine.info": engine() })
  return {
    sent,
    client: {
      ...c.client,
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent === "messages.list") {
          sent.push(params ?? {})
          return list(params ?? {})
        }
        return c.client.query(intent, params)
      },
    } as typeof c.client,
  }
}

describe("MessagesPage", () => {
  it("asks for the first page of 25 with no empty filters", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    expect(c.sent[0]).toEqual({ limit: 25 })
  })

  it("shows ids in mono as links, recipients as the column you read, and none for a missing provider or template", async () => {
    renderPage(MessagesPage, client().client)
    const link = await screen.findByRole("link", { name: "hmsg_01j00000000000000000001000" })
    expect(link.getAttribute("href")).toBe("/messages/hmsg_01j00000000000000000001000")
    expect(link.closest("td")?.className).toMatch(/font-mono text-xs/)
    expect(screen.getByText("+15550111").closest("td")?.className).toMatch(/font-medium/)
    const suppressed = screen.getAllByRole("row").find((r) => within(r).queryByText("hmsg_01j00000000000000000001008"))!
    expect(within(suppressed).getByLabelText("no provider")).toBeTruthy()
    expect(within(suppressed).getByLabelText("no template")).toBeTruthy()
    expect(within(suppressed).getByText("Suppressed", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })

  it("offers only the statuses Herald writes, and says why", async () => {
    renderPage(MessagesPage, client().client)
    const status = (await screen.findByLabelText("Status")) as HTMLSelectElement
    expect([...status.options].map((o) => o.value)).toEqual(["", "sending", "sent", "failed", "suppressed"])
    expect(screen.getByText(/Delivered and bounced are never recorded/)).toBeTruthy()
  })

  it("pages with the cursor, and a filter change starts again without it", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("late@example.com")
    expect(c.sent).toContainEqual({ limit: 25, cursor: "bzoyNQ" })
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } })
    await waitFor(() => expect(c.sent[c.sent.length - 1]).toEqual({ limit: 25, status: "failed" }))
  })

  it("says nothing matches when a filter empties the list", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "push" } })
    expect(await screen.findByText("No messages match these filters.")).toBeTruthy()
    expect(c.sent[c.sent.length - 1]).toEqual({ limit: 25, channel: "push" })
  })

  it("says nothing further on a page past the end, not that nothing was sent", async () => {
    renderPage(MessagesPage, client().client)
    await screen.findByText("3 messages on this page")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("late@example.com")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(await screen.findByText("Nothing further.")).toBeTruthy()
    expect(screen.queryByText(/Nothing has been sent/)).toBeNull()
  })

  it("says nothing has been sent when the app has no messages at all", async () => {
    renderPage(MessagesPage, recordingQueryClient({ "engine.info": engine(), "messages.list": { messages: [] } }).client)
    expect(await screen.findByText(/Nothing has been sent in this app yet/)).toBeTruthy()
    expect(screen.getByText("0 messages on this page")).toBeTruthy()
  })
})
```

`packages/plugin-herald/test/message-detail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { MessageDetailPage } from "../src/pages/message-detail"
import { engine, messageDetail } from "./data"
import { renderPage, scriptedClient } from "./harness"

const ID = "hmsg_01j00000000000000000001000"

function show(detail = messageDetail()) {
  return renderPage(MessageDetailPage, scriptedClient({ "engine.info": engine(), "messages.detail": { message: detail } }).client, { id: ID })
}

describe("MessageDetailPage", () => {
  it("says accepted, not delivered, and that receipts never come back", async () => {
    show()
    expect(await screen.findByText(/Accepted by provider/, { selector: "p" })).toBeTruthy()
    expect(screen.getByText(/delivery isn't confirmed/)).toBeTruthy()
    expect(screen.getByText("1000.msg@smtp.example.com").className).toMatch(/font-mono text-xs/)
  })

  it("links the template and provider while they exist", async () => {
    show()
    expect((await screen.findByRole("link", { name: "auth.welcome" })).getAttribute("href")).toBe("/templates/htpl_01j00000000000000000000011")
    expect(screen.getByRole("link", { name: "Primary SMTP" }).getAttribute("href")).toBe("/providers/hpvd_01j00000000000000000000001")
  })

  it("names a template that is gone without linking it, and says when there is no provider", async () => {
    show(messageDetail({ templateSlug: "retired.notice", template: null, provider: null, status: "suppressed", providerMessageId: undefined }))
    expect(await screen.findByText("retired.notice")).toBeTruthy()
    expect(screen.getByText(/no longer exists/)).toBeTruthy()
    expect(screen.queryByRole("link", { name: "retired.notice" })).toBeNull()
    expect(screen.getByLabelText("no provider")).toBeTruthy()
    expect(screen.getByText(/opted out/)).toBeTruthy()
  })

  it("shows a failure verbatim in a pre", async () => {
    show(messageDetail({ status: "failed", error: "smtp: 550 5.1.1 mailbox unavailable", providerMessageId: undefined, sentAt: undefined }))
    const pre = await screen.findByText("smtp: 550 5.1.1 mailbox unavailable")
    expect(pre.tagName).toBe("PRE")
  })

  it("says the body is the text part, cut at the engine's limit", async () => {
    show()
    expect(await screen.findByText(/HTML bodies aren't logged/)).toBeTruthy()
    expect(screen.getByText(/4096 bytes/)).toBeTruthy()
  })

  it("links to a test send to this recipient, replacing retry", async () => {
    show()
    expect((await screen.findByRole("link", { name: "Send a test to this recipient" })).getAttribute("href")).toBe(`/messages/${ID}/send-test`)
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })

  it("renders not found as an error card", async () => {
    renderPage(MessageDetailPage, scriptedClient({ "engine.info": engine(), "messages.detail": () => new ContractError("NOT_FOUND", "message not found") }).client, { id: ID })
    expect(await screen.findByText(/Message unavailable/)).toBeTruthy()
  })
})
```

Run: `npx vitest run test/messages.test.tsx test/message-detail.test.tsx`. Expected: FAIL.

- [ ] **Step 3: The list**

`packages/plugin-herald/src/pages/messages.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { MessageStatusBadge } from "../badges"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { plural, statusLabel, WRITTEN_STATUSES } from "../format"
import { messagePath } from "../keys"
import type { MessageSummary, MessagesListResponse } from "../wire"

const PAGE_SIZE = 25

const columns: Column<MessageSummary>[] = [
  { id: "id", header: "ID", className: "font-mono text-xs", cell: (m) => <PluginLink to={messagePath(m.id)}>{m.id}</PluginLink> },
  { id: "recipient", header: "Recipient", className: "font-medium", cell: (m) => m.recipient },
  { id: "channel", header: "Channel", cell: (m) => m.channel },
  { id: "status", header: "Status", cell: (m) => <MessageStatusBadge status={m.status} /> },
  { id: "template", header: "Template", cell: (m) => (m.templateSlug ? <span className="font-mono text-xs">{m.templateSlug}</span> : <NoneCell label="template" />) },
  { id: "provider", header: "Provider", cell: (m) => (m.provider ? m.provider.name || <span className="font-mono text-xs">{m.provider.id}</span> : <NoneCell label="provider" />) },
  { id: "created", header: "Created", cell: (m) => <Timestamp value={m.createdAt} label="creation time" /> },
]

export const MessagesPage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  const pager = useCursorStack()
  const [channel, setChannel] = useState("")
  const [status, setStatus] = useState("")

  const params: Record<string, unknown> = { limit: PAGE_SIZE }
  if (channel) params.channel = channel
  if (status) params.status = status
  if (pager.cursor) params.cursor = pager.cursor
  const list = useQuery<MessagesListResponse>("messages.list", params)

  // A cursor belongs to the search that issued it, so every filter change
  // goes back to the first page.
  const change = (set: (v: string) => void) => (v: string) => {
    set(v)
    pager.reset()
  }
  const filtered = channel !== "" || status !== ""

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="Messages" description="Every send Herald logged, newest first." />
      <FilterBar
        filters={[
          { id: "channel", label: "Channel", value: channel, onChange: change(setChannel), options: [{ label: "All channels", value: "" }, ...(info.data?.channels ?? []).map((c) => ({ label: c, value: c }))] },
          { id: "status", label: "Status", value: status, onChange: change(setStatus), options: [{ label: "All statuses", value: "" }, ...WRITTEN_STATUSES.map((s) => ({ label: statusLabel(s), value: s }))] },
        ]}
      />
      <p className="text-sm text-muted-foreground">Herald records sending, accepted, failed and suppressed. Delivered and bounced are never recorded, so a filter for them would always be empty.</p>
      <QueryBoundary title="Messages" query={list} skeletonRows={8}>
        {(data) => (
          <div className="flex flex-col gap-3">
            <ResourceTable<MessageSummary>
              columns={columns}
              rows={data.messages}
              rowKey={(m) => m.id}
              caption={`${plural(data.messages.length, "message")} on this page`}
              emptyMessage={pager.canGoBack ? "Nothing further." : filtered ? "No messages match these filters." : "Nothing has been sent in this app yet."}
            />
            <CursorPager shown={data.messages.length} nextCursor={data.nextCursor} onNext={pager.next} onPrevious={pager.previous} canGoBack={pager.canGoBack} />
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: The detail**

`packages/plugin-herald/src/pages/message-detail.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { MessageStatusBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { NO_RECEIPTS } from "../format"
import { messageSendTestPath, providerPath, templatePath } from "../keys"
import type { MessageDetail, MessagesDetailResponse } from "../wire"

function Outcome({ m }: { m: MessageDetail }) {
  if (m.status === "sent") return <p className="text-sm">Accepted by provider. {NO_RECEIPTS}</p>
  if (m.status === "suppressed") return <p className="text-sm">Not sent: the user opted out of this template on this channel.</p>
  if (m.status === "sending") return <p className="text-sm">Handed to the provider and not settled yet.</p>
  return null
}

function TemplateValue({ m }: { m: MessageDetail }) {
  if (m.template) {
    return (
      <PluginLink to={templatePath(m.template.id)} className="font-mono text-xs underline">
        {m.template.slug}
      </PluginLink>
    )
  }
  if (m.templateSlug) {
    return (
      <span>
        <span className="font-mono text-xs">{m.templateSlug}</span> <span className="text-muted-foreground">(no longer exists)</span>
      </span>
    )
  }
  return <NoneCell label="template" />
}

function MessageBody({ id }: { id: string }) {
  const info = useEngineInfo()
  const detail = useQuery<MessagesDetailResponse>("messages.detail", { id })
  const limit = info.data?.truncateBodyAt
  return (
    <QueryBoundary title="Message" query={detail} skeletonRows={6}>
      {({ message: m }) => (
        <section className="flex flex-col gap-6">
          <HeraldHeader
            title={`Message to ${m.recipient}`}
            actions={
              <PluginLink to={messageSendTestPath(m.id)} className={buttonVariants({ variant: "outline" })}>
                Send a test to this recipient
              </PluginLink>
            }
          />
          <Outcome m={m} />
          {m.error && (
            <section className="flex flex-col gap-1.5">
              <h2 className="text-sm font-medium">Error</h2>
              <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{m.error}</pre>
            </section>
          )}
          <DescriptionList
            items={[
              { term: "ID", value: <span className="font-mono text-xs">{m.id}</span> },
              { term: "Recipient", value: m.recipient },
              { term: "Channel", value: m.channel },
              { term: "Status", value: <MessageStatusBadge status={m.status} /> },
              { term: "Template", value: <TemplateValue m={m} /> },
              {
                term: "Provider",
                value: m.provider ? (
                  <span>
                    <PluginLink to={providerPath(m.provider.id)} className="underline">
                      {m.provider.name || m.provider.id}
                    </PluginLink>
                    {m.provider.driver && <span className="font-mono text-xs"> {m.provider.driver}</span>}
                  </span>
                ) : (
                  <NoneCell label="provider" />
                ),
              },
              { term: "Vendor message ID", value: m.providerMessageId ? <span className="font-mono text-xs">{m.providerMessageId}</span> : <NoneCell label="vendor message ID" /> },
              { term: "Attempts", value: <span className="font-mono text-xs">{m.attempts}</span> },
              { term: "Sent asynchronously", value: m.async ? "Yes" : "No" },
              { term: "Environment", value: m.envId ? <span className="font-mono text-xs">{m.envId}</span> : <NoneCell label="environment" /> },
              { term: "Created", value: <Timestamp value={m.createdAt} label="creation time" /> },
              { term: "Sent", value: <Timestamp value={m.sentAt} label="send time" /> },
            ]}
          />
          <section className="flex flex-col gap-1.5">
            <h2 className="text-sm font-medium">Body</h2>
            {m.subject && <p className="text-sm">Subject: {m.subject}</p>}
            <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{m.body}</pre>
            <p className="text-xs text-muted-foreground">
              This is the text part only. HTML bodies aren't logged, and bodies are cut at {limit === undefined ? "the engine's limit" : `${limit} bytes`} with no marker.
            </p>
          </section>
          <section className="flex flex-col gap-1.5">
            <h2 className="text-sm font-medium">Metadata</h2>
            {Object.keys(m.metadata).length === 0 ? (
              <p className="text-sm text-muted-foreground">No metadata.</p>
            ) : (
              <DescriptionList items={Object.entries(m.metadata).map(([term, value]) => ({ term, value: <span className="font-mono text-xs">{value}</span> }))} />
            )}
          </section>
        </section>
      )}
    </QueryBoundary>
  )
}

export const MessageDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No message ID in the address, so there is nothing to show.
      </p>
    )
  }
  return <MessageBody id={id} />
}
```

The suppressed test passes `status: "suppressed"` and `provider: null`, so its `Outcome` line is the opt-out explanation and the provider row is `NoneCell`.

- [ ] **Step 5: Register them**

In `src/index.tsx`: import and export `MessagesPage` and `MessageDetailPage`; add `MailIcon` to the icon import; append to `nav`:

```tsx
{ label: "Messages", to: "/messages", priority: 20, icon: <MailIcon />, group: "Notifications" },
```

and to `routes`:

```tsx
{ path: "/messages", element: MessagesPage },
{ path: "/messages/:id", element: MessageDetailPage },
```

`ROUTES` gains `"/messages", "/messages/:id"`; `NAV` gains `"/messages"`.

- [ ] **Step 6: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/components/cursor-pager.tsx packages/plugin-herald/src/pages/messages.tsx packages/plugin-herald/src/pages/message-detail.tsx packages/plugin-herald/test/messages.test.tsx packages/plugin-herald/test/message-detail.test.tsx
git commit --only -m "feat(plugin-herald): page the delivery log and show one message honestly" -- packages/plugin-herald/src/components/cursor-pager.tsx packages/plugin-herald/src/pages/messages.tsx packages/plugin-herald/src/pages/message-detail.tsx packages/plugin-herald/test/messages.test.tsx packages/plugin-herald/test/message-detail.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 7: Inbox

**Files:**
- Create: `packages/plugin-herald/src/pages/inbox.tsx`, `test/inbox.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useDebounced`, `useCursorStack`, `CursorPager`, `plural`.
- Produces: `InboxPage`; route `/inbox`; nav "Inbox" (priority 50).

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/inbox.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { InboxPage } from "../src/pages/inbox"
import { engine, notification } from "./data"
import { renderPage, scriptedClient } from "./harness"

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

const PAGE = {
  notifications: [
    notification(),
    notification({ id: "hinb_01j00000000000000000002001", title: "New sign-in", type: "security.signin-alert", read: true, readAt: "2026-09-23T11:00:00Z", expiresAt: "2026-10-30T00:00:00Z" }),
  ],
  unread: 7,
  nextCursor: "bzoyNQ",
}

function setup() {
  return scriptedClient(
    { "engine.info": engine(), "inbox.list": (p) => (p.cursor ? { notifications: [notification({ id: "hinb_01j00000000000000000002029", title: "Older one" })], unread: 7 } : PAGE) },
    { "inbox.markRead": { ok: true, id: "x" }, "inbox.markAllRead": { ok: true }, "inbox.delete": { ok: true, id: "x" } },
  )
}

async function typeUser(value: string) {
  fireEvent.change(await screen.findByLabelText("User ID"), { target: { value } })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

describe("InboxPage", () => {
  it("asks for nothing until there is a user, and says so", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    expect(await screen.findByText(/Enter a user ID/)).toBeTruthy()
    expect(c.queried.some((q) => q.intent === "inbox.list")).toBe(false)
  })

  it("waits for typing to stop, then reads that user's first page", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    fireEvent.change(await screen.findByLabelText("User ID"), { target: { value: "usr_a" } })
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(c.queried.some((q) => q.intent === "inbox.list")).toBe(false)
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "usr_ada" } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await screen.findByText("Welcome to Example")
    expect(c.queried.filter((q) => q.intent === "inbox.list").map((q) => q.params)).toEqual([{ userId: "usr_ada", limit: 25 }])
  })

  it("counts this page and the unread total, with types in mono and read times", async () => {
    renderPage(InboxPage, setup().client)
    await typeUser("usr_ada")
    expect(await screen.findByText("2 notifications on this page, 7 unread in total")).toBeTruthy()
    expect(screen.getByText("security.signin-alert").closest("td")?.className).toMatch(/font-mono text-xs/)
    const unread = screen.getAllByRole("row").find((r) => within(r).queryByText("Welcome to Example"))!
    expect(within(unread).getByText("Unread")).toBeTruthy()
    expect(within(unread).getByLabelText("no expiry")).toBeTruthy()
  })

  it("marks one read straight from its row", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark Welcome to Example read" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.markRead", payload: { id: "hinb_01j00000000000000000002000" } }]))
    expect(screen.queryByRole("button", { name: "Mark New sign-in read" })).toBeNull()
  })

  it("deletes one behind a confirm", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Delete New sign-in" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.delete", payload: { id: "hinb_01j00000000000000000002001" } }]))
  })

  it("marks all read behind a confirm that names the user and the count", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/usr_ada/)
    expect(dialog.textContent).toMatch(/7 unread notifications/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.markAllRead", payload: { userId: "usr_ada" } }]))
  })

  it("starts from the first page when the user changes", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await screen.findByText("Older one")
    await typeUser("usr_bo")
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "inbox.list").map((q) => q.params).at(-1)).toEqual({ userId: "usr_bo", limit: 25 }))
  })

  it("says the user has nothing in this app, rather than nothing at all", async () => {
    renderPage(InboxPage, scriptedClient({ "engine.info": engine(), "inbox.list": { notifications: [], unread: 0 } }).client)
    await typeUser("usr_nobody")
    expect(await screen.findByText("No notifications for usr_nobody in this app.")).toBeTruthy()
  })
})
```

Run: `npx vitest run test/inbox.test.tsx`. Expected: FAIL.

- [ ] **Step 2: The page**

`packages/plugin-herald/src/pages/inbox.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import { HeraldHeader } from "../components/herald-header"
import { plural } from "../format"
import { useDebounced } from "../use-debounced"
import type { DeleteResponse, InboxListResponse, InboxOKResponse, NotificationWire } from "../wire"

const PAGE_SIZE = 25

const columns: Column<NotificationWire>[] = [
  { id: "title", header: "Title", className: "font-medium", cell: (n) => n.title },
  { id: "type", header: "Type", className: "font-mono text-xs", cell: (n) => n.type },
  { id: "read", header: "Read", cell: (n) => (n.read ? <Timestamp value={n.readAt} label="read time" /> : "Unread") },
  { id: "created", header: "Created", cell: (n) => <Timestamp value={n.createdAt} label="creation time" /> },
  { id: "expires", header: "Expires", cell: (n) => <Timestamp value={n.expiresAt} label="expiry" /> },
]

export const InboxPage: ComponentType<PluginPageProps> = () => {
  const [typed, setTyped] = useState("")
  const userId = useDebounced(typed.trim(), 300)
  const pager = useCursorStack()
  const markRead = useCommand<InboxOKResponse>("inbox.markRead")
  const markAll = useCommand<InboxOKResponse>("inbox.markAllRead")
  const remove = useCommand<DeleteResponse>("inbox.delete")
  const [deleting, setDeleting] = useState<NotificationWire | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const params: Record<string, unknown> = { userId, limit: PAGE_SIZE }
  if (pager.cursor) params.cursor = pager.cursor
  const list = useQuery<InboxListResponse>("inbox.list", params, { enabled: userId !== "" })

  function openDelete(n: NotificationWire) {
    remove.reset()
    setDeleting(n)
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result === undefined) return
    setDeleting(null)
  }

  function openMarkAll() {
    markAll.reset()
    setMarkingAll(true)
  }

  async function confirmMarkAll() {
    const result = await markAll.execute({ userId })
    if (result === undefined) return
    setMarkingAll(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="Inbox" description="One user's in-app notifications in this app." />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="inbox-user">User ID</Label>
        <Input
          id="inbox-user"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            pager.reset()
          }}
        />
      </div>
      <CommandAlert error={markRead.error} title="Could not mark the notification read" />
      {userId === "" ? (
        <p className="text-sm text-muted-foreground">Enter a user ID to see their in-app notifications.</p>
      ) : (
        <QueryBoundary title="Inbox" query={list} skeletonRows={6}>
          {(data) => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-end">
                <Button variant="outline" size="sm" disabled={data.unread === 0} onClick={openMarkAll}>
                  Mark all read
                </Button>
              </div>
              <ResourceTable<NotificationWire>
                columns={columns}
                rows={data.notifications}
                rowKey={(n) => n.id}
                caption={`${plural(data.notifications.length, "notification")} on this page, ${data.unread} unread in total`}
                emptyMessage={pager.canGoBack ? "Nothing further." : `No notifications for ${userId} in this app.`}
                rowActions={(n) => (
                  <>
                    {!n.read && (
                      <Button size="xs" variant="outline" disabled={markRead.loading} aria-label={`Mark ${n.title} read`} onClick={() => void markRead.execute({ id: n.id })}>
                        Mark read
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" aria-label={`Delete ${n.title}`} onClick={() => openDelete(n)}>
                      Delete
                    </Button>
                  </>
                )}
              />
              <CursorPager shown={data.notifications.length} nextCursor={data.nextCursor} onNext={pager.next} onPrevious={pager.previous} canGoBack={pager.canGoBack} />
              <ConfirmDialog
                open={markingAll}
                onOpenChange={(open) => !open && !markAll.loading && setMarkingAll(false)}
                title={`Mark all of ${userId}'s notifications read?`}
                description={`This marks ${plural(data.unread, "unread notification")} read for ${userId}. It can't be undone from here.`}
                confirmLabel="Mark all read"
                destructive={false}
                pending={markAll.loading}
                onConfirm={() => void confirmMarkAll()}
              >
                <CommandAlert error={markAll.error} title="Could not mark them read" />
              </ConfirmDialog>
            </div>
          )}
        </QueryBoundary>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.loading && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description={`This removes the notification from ${userId}'s inbox. It cannot be undone.`}
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete the notification" />
      </ConfirmDialog>
    </section>
  )
}
```

The "marks one read" test checks the read row offers no Mark read; the unread one disappears from the list only after the server's invalidation, which the stub client doesn't wire, so the test asserts the payload, not the row vanishing.

- [ ] **Step 3: Register, run, commit**

In `src/index.tsx`: import and export `InboxPage`; add `InboxIcon`; nav `{ label: "Inbox", to: "/inbox", priority: 50, icon: <InboxIcon />, group: "Notifications" }`; route `{ path: "/inbox", element: InboxPage }`. `ROUTES` and `NAV` gain `"/inbox"`.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/pages/inbox.tsx packages/plugin-herald/test/inbox.test.tsx
git commit --only -m "feat(plugin-herald): read a user's inbox and mark or delete notifications" -- packages/plugin-herald/src/pages/inbox.tsx packages/plugin-herald/test/inbox.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---

### Task 8: Preferences, opt-out only

**Files:**
- Create: `packages/plugin-herald/src/pages/preferences.tsx`, `test/preferences.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useDebounced`, `plural`, `PREF_CHANNELS`.
- Produces: `PreferencesPage`; route `/preferences`; nav "Preferences" (priority 60).

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/preferences.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { PreferencesPage } from "../src/pages/preferences"
import { engine } from "./data"
import { renderPage, scriptedClient } from "./harness"

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

const GET = {
  preference: {
    id: "hprf_01j00000000000000000003000",
    userId: "usr_ada",
    overrides: {
      "auth.welcome": { email: null, sms: null, push: null, inapp: false },
      "marketing.weekly": { email: false, sms: true, push: null, inapp: null },
    },
    updatedAt: "2026-09-23T10:00:00Z",
  },
  knownTypes: ["auth.password-reset", "auth.welcome"],
}

async function typeUser(value: string) {
  fireEvent.change(await screen.findByLabelText("User ID"), { target: { value } })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

function setup(get: unknown = GET) {
  return scriptedClient({ "engine.info": engine(), "preferences.get": get }, { "preferences.optOut": (p) => ({ preference: { ...GET.preference, userId: String(p.userId) } }) })
}

function cell(type: string, column: number): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByText(type))!
  return within(row).getAllByRole("cell")[column]
}

describe("PreferencesPage", () => {
  it("lists every known type and every type the user touched, once each", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    expect(await screen.findByText("3 notification types for usr_ada")).toBeTruthy()
    for (const type of ["auth.password-reset", "auth.welcome", "marketing.weekly"]) expect(screen.getByText(type).className).toMatch(/font-mono text-xs/)
  })

  it("reads null as Default, true as On and false as Opted out", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    await screen.findByText("marketing.weekly")
    expect(cell("marketing.weekly", 1).textContent).toContain("Opted out")
    expect(cell("marketing.weekly", 2).textContent).toContain("On")
    expect(cell("marketing.weekly", 3).textContent).toContain("Default")
    expect(within(cell("marketing.weekly", 1)).queryByRole("button")).toBeNull()
  })

  it("opts out behind a confirm naming the user, the type and the channel", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.password-reset by sms" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/usr_ada/)
    expect(dialog.textContent).toMatch(/auth\.password-reset/)
    expect(dialog.textContent).toMatch(/sms/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Opt out" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "preferences.optOut", payload: { userId: "usr_ada", type: "auth.password-reset", channel: "sms" } }]))
  })

  it("offers no way back in, and says why", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    await screen.findByText("marketing.weekly")
    expect(screen.getByText(/can't be undone here/)).toBeTruthy()
    for (const button of screen.getAllByRole("button")) expect(button.textContent ?? "").not.toMatch(/opt in|opt back|turn on|enable|reset|clear/i)
  })

  it("says a user with no record gets everything, and still offers opt-outs", async () => {
    renderPage(PreferencesPage, setup({ preference: null, knownTypes: ["auth.welcome"] }).client)
    await typeUser("usr_new")
    expect(await screen.findByText(/No preferences recorded for usr_new/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Opt usr_new out of auth.welcome by email" })).toBeTruthy()
  })

  it("asks for nothing until there is a user", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    expect(await screen.findByText(/Enter a user ID/)).toBeTruthy()
    expect(c.queried.some((q) => q.intent === "preferences.get")).toBe(false)
  })
})
```

Run: `npx vitest run test/preferences.test.tsx`. Expected: FAIL.

- [ ] **Step 2: The page**

`packages/plugin-herald/src/pages/preferences.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { HeraldHeader } from "../components/herald-header"
import { plural, PREF_CHANNELS } from "../format"
import { useDebounced } from "../use-debounced"
import type { ChannelPreferenceWire, PrefChannel, PreferencesGetResponse, PreferencesOptOutResponse } from "../wire"

interface TypeRow {
  type: string
  prefs?: ChannelPreferenceWire
}

interface Target {
  type: string
  channel: PrefChannel
}

function stateLabel(value: boolean | null | undefined): string {
  if (value === false) return "Opted out"
  if (value === true) return "On"
  return "Default"
}

/**
 * Operators can only opt a user out. A missing record means "send
 * everything", so clearing or reversing an opt-out here would re-subscribe
 * the user to things they declined. There is deliberately no control that
 * turns a channel on.
 */
export const PreferencesPage: ComponentType<PluginPageProps> = () => {
  const [typed, setTyped] = useState("")
  const userId = useDebounced(typed.trim(), 300)
  const prefs = useQuery<PreferencesGetResponse>("preferences.get", { userId }, { enabled: userId !== "" })
  const optOut = useCommand<PreferencesOptOutResponse>("preferences.optOut")
  const [target, setTarget] = useState<Target | null>(null)

  function open(t: Target) {
    optOut.reset()
    setTarget(t)
  }

  async function confirm() {
    if (!target) return
    const result = await optOut.execute({ userId, type: target.type, channel: target.channel })
    if (result === undefined) return
    setTarget(null)
  }

  const columns: Column<TypeRow>[] = [
    { id: "type", header: "Type", className: "font-mono text-xs font-medium", cell: (r) => r.type },
    ...PREF_CHANNELS.map((channel) => ({
      id: channel,
      header: channel,
      cell: (r: TypeRow) => {
        const value = r.prefs?.[channel]
        return (
          <span className="flex items-center gap-2">
            <span className={value === false ? "text-muted-foreground" : undefined}>{stateLabel(value)}</span>
            {value !== false && (
              <Button size="xs" variant="ghost" aria-label={`Opt ${userId} out of ${r.type} by ${channel}`} onClick={() => open({ type: r.type, channel })}>
                Opt out
              </Button>
            )}
          </span>
        )
      },
    })),
  ]

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="Preferences" description="Which notifications a user has opted out of, per channel." />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="pref-user">User ID</Label>
        <Input id="pref-user" className="font-mono" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Opt-outs can't be undone here. A user with no record gets every notification, so reversing an opt-out has to come from the user, through your own application.
      </p>
      {userId === "" ? (
        <p className="text-sm text-muted-foreground">Enter a user ID to see their preferences.</p>
      ) : (
        <QueryBoundary title="Preferences" query={prefs} skeletonRows={4}>
          {(data) => {
            const overrides = data.preference?.overrides ?? {}
            const types = [...new Set([...data.knownTypes, ...Object.keys(overrides)])].sort()
            const rows: TypeRow[] = types.map((type) => ({ type, prefs: overrides[type] }))
            return (
              <div className="flex flex-col gap-3">
                {data.preference === null && <p className="text-sm">No preferences recorded for {userId}, so they get every notification.</p>}
                <ResourceTable<TypeRow>
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.type}
                  caption={`${plural(rows.length, "notification type")} for ${userId}`}
                  emptyMessage="This app has no templates and the user has no opt-outs, so there is nothing to show."
                />
              </div>
            )
          }}
        </QueryBoundary>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && !optOut.loading && setTarget(null)}
        title={`Opt ${userId} out of ${target?.type ?? ""} by ${target?.channel ?? ""}?`}
        description={`Herald stops sending ${target?.type ?? ""} to ${userId} by ${target?.channel ?? ""}. There's no way to opt them back in from the dashboard.`}
        confirmLabel="Opt out"
        pending={optOut.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={optOut.error} title="Could not record the opt-out" />
      </ConfirmDialog>
    </section>
  )
}
```

In the test's `cell(type, column)` helper, column 0 is the type and columns 1 to 4 are email, sms, push, inapp.

- [ ] **Step 3: Register, run, commit**

In `src/index.tsx`: import and export `PreferencesPage`; add `BellOffIcon`; nav `{ label: "Preferences", to: "/preferences", priority: 60, icon: <BellOffIcon />, group: "Notifications" }`; route `{ path: "/preferences", element: PreferencesPage }`. `ROUTES` and `NAV` gain `"/preferences"`.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/pages/preferences.tsx packages/plugin-herald/test/preferences.test.tsx
git commit --only -m "feat(plugin-herald): show a user's preferences and opt them out, never back in" -- packages/plugin-herald/src/pages/preferences.tsx packages/plugin-herald/test/preferences.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 9: Routing rules and the "Who sends?" tester

Herald picks a provider per channel by walking user, org and app rules, then falls back to the first enabled provider by priority. This page shows the rules grouped by level, lets you add, edit and delete them in a dialog, and above them asks `send.resolve` who would send. A rule naming a deleted provider is flagged, and editing it clears that slot, because the server re-checks every slot and would otherwise refuse the save.

**Files:**
- Create: `packages/plugin-herald/src/pages/routing.tsx`, `test/routing.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useEngineInfo`, `plural`, `ROUTED_CHANNELS`, `providerPath`, `DanglingBadge`, `DisabledProviderBadge`, wire types.
- Produces: `RoutingPage`, `VIA_TEXT` (exported for Task 11's "who sends" line); route `/routing`; nav "Routing" (priority 40).

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/routing.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RoutingPage } from "../src/pages/routing"
import { engine, providerSummary, scopeRule } from "./data"
import { renderPage, scriptedClient } from "./harness"

const SMTP = providerSummary()
const TWILIO = providerSummary({ id: "hpvd_01j00000000000000000000002", name: "Twilio", channel: "sms", driver: "twilio" })
const DEAD = "hpvd_01j00000000000000000000007"

const RULES = {
  rules: [
    scopeRule(),
    scopeRule({ id: "hscf_01j00000000000000000004001", scope: "org", scopeId: "org_acme", providers: { email: { id: DEAD, dangling: true } }, fromEmail: undefined, fromName: "Acme", defaultLocale: undefined }),
    scopeRule({ id: "hscf_01j00000000000000000004002", scope: "user", scopeId: "usr_ada", providers: { sms: { id: TWILIO.id, name: "Twilio", dangling: false } }, fromEmail: undefined, fromName: undefined, defaultLocale: undefined }),
  ],
}

function setup(commands: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  return scriptedClient(
    {
      "engine.info": engine(),
      "scopes.list": RULES,
      "providers.list": { providers: [SMTP, TWILIO] },
      "send.resolve": (p) =>
        p.channel === "push"
          ? { provider: null, via: "none", from: {} }
          : { provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp", enabled: false }, via: p.orgId ? "org" : "app", from: { email: "hello@example.com", name: "Example" } },
    },
    { "scopes.set": (p) => ({ rule: scopeRule({ scope: p.scope as "app" }) }), "scopes.delete": () => ({ ok: true, id: "x" }), ...commands },
  )
}

describe("RoutingPage", () => {
  it("groups rules by level, names providers, and flags a deleted one", async () => {
    renderPage(RoutingPage, setup().client)
    expect(await screen.findByRole("heading", { name: "App rule" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Org rules" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "User rules" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Primary SMTP" }).getAttribute("href")).toBe(`/providers/${SMTP.id}`)
    expect(screen.getByText("Provider deleted", { selector: '[data-slot="badge"]' }).className).toMatch(/destructive/)
    expect(screen.getByText(DEAD).className).toMatch(/font-mono text-xs/)
    expect(screen.getByText("org_acme").className).toMatch(/font-mono text-xs/)
  })

  it("labels the stored default locale as unused", async () => {
    renderPage(RoutingPage, setup().client)
    expect(await screen.findByText(/Send doesn't use it/)).toBeTruthy()
  })

  it("asks who sends for the channel you pick, with the org and user you give, and says why", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel to test"), { target: { value: "email" } })
    fireEvent.change(screen.getByLabelText("Org ID (optional)"), { target: { value: "org_acme" } })
    expect(await screen.findByText(/the org's routing rule/)).toBeTruthy()
    expect(c.queried.filter((q) => q.intent === "send.resolve").map((q) => q.params)).toContainEqual({ channel: "email", orgId: "org_acme" })
    expect(screen.getByText("Provider disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })

  it("says plainly when nothing would send", async () => {
    renderPage(RoutingPage, setup().client)
    fireEvent.change(await screen.findByLabelText("Channel to test"), { target: { value: "push" } })
    expect(await screen.findByText(/Nothing would send it/)).toBeTruthy()
  })

  it("adds an org rule with only the fields you set", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Level"), { target: { value: "org" } })
    fireEvent.change(within(dialog).getByLabelText("Org ID"), { target: { value: "org_beta" } })
    fireEvent.change(within(dialog).getByLabelText("email provider"), { target: { value: SMTP.id } })
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Beta" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "scopes.set", payload: { scope: "org", scopeId: "org_beta", emailProviderId: SMTP.id, fromName: "Beta" } }]))
  })

  it("clears a deleted provider's slot when you edit its rule, so the save goes through", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the org rule for org_acme" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/was deleted. Saving clears it/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Acme Inc" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ scope: "org", scopeId: "org_acme", emailProviderId: "", fromName: "Acme Inc" })
  })

  it("edits the app rule without a scope ID, sending only what changed", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the app rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("sms provider"), { target: { value: TWILIO.id } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ scope: "app", smsProviderId: TWILIO.id })
  })

  it("shows a refusal inside the dialog", async () => {
    const c = setup({ "scopes.set": () => new ContractError("BAD_REQUEST", 'herald: invalid provider: sms_provider_id "x" is not a sms provider of this app') })
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the app rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "X" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("is not a sms provider")
  })

  it("deletes a rule behind a confirm, by level and ID", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Delete the user rule for usr_ada" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "scopes.delete", payload: { scope: "user", scopeId: "usr_ada" } }]))
  })
})
```

Run: `npx vitest run test/routing.test.tsx`. Expected: FAIL.

- [ ] **Step 2: The page**

`packages/plugin-herald/src/pages/routing.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { DanglingBadge, DisabledProviderBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { ROUTED_CHANNELS } from "../format"
import { providerPath } from "../keys"
import type { DeleteResponse, ProviderSummary, ProvidersListResponse, ResolveVia, RoutedChannel, ScopeRule, ScopeType, ScopesListResponse, ScopesSetRequest, ScopesSetResponse, SendResolveResponse } from "../wire"

/** Why send.resolve picked what it picked, in words. */
export const VIA_TEXT: Record<ResolveVia, string> = {
  user: "the user's routing rule",
  org: "the org's routing rule",
  app: "the app's routing rule",
  fallback: "no rule names one, so the first enabled provider for the channel by priority",
  chosen: "it was chosen explicitly",
  none: "nothing",
}

type SlotKey = "emailProviderId" | "smsProviderId" | "pushProviderId" | "webhookProviderId" | "chatProviderId"
const slotKey = (ch: RoutedChannel): SlotKey => `${ch}ProviderId` as SlotKey

const LEVELS: { scope: ScopeType; heading: string }[] = [
  { scope: "app", heading: "App rule" },
  { scope: "org", heading: "Org rules" },
  { scope: "user", heading: "User rules" },
]

function WhoSends({ channels }: { channels: string[] }) {
  const [channel, setChannel] = useState("")
  const [orgId, setOrgId] = useState("")
  const [userId, setUserId] = useState("")
  const params: Record<string, unknown> = { channel }
  if (orgId.trim()) params.orgId = orgId.trim()
  if (userId.trim()) params.userId = userId.trim()
  const resolve = useQuery<SendResolveResponse>("send.resolve", params, { enabled: channel !== "" })
  return (
    <section aria-labelledby="who-sends" className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 id="who-sends" className="text-sm font-medium">
        Who sends?
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-channel">Channel to test</Label>
          <NativeSelect id="who-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <NativeSelectOption value="">Choose a channel</NativeSelectOption>
            {channels.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-org">Org ID (optional)</Label>
          <Input id="who-org" className="font-mono" autoComplete="off" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-user">User ID (optional)</Label>
          <Input id="who-user" className="font-mono" autoComplete="off" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>
      </div>
      {channel !== "" && (
        <QueryBoundary title="Who sends" query={resolve} skeletonRows={1}>
          {(r) =>
            r.provider === null ? (
              <p className="text-sm">Nothing would send it: no rule names a provider for {channel}, and no enabled provider handles it.</p>
            ) : (
              <div className="flex flex-col gap-1 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <PluginLink to={providerPath(r.provider.id)} className="font-medium underline">
                    {r.provider.name || r.provider.id}
                  </PluginLink>
                  {r.provider.driver && <span className="font-mono text-xs">{r.provider.driver}</span>}
                  {r.provider.enabled === false && <DisabledProviderBadge />}
                </p>
                <p>Picked by {VIA_TEXT[r.via]}.</p>
                {(r.from.email || r.from.name || r.from.phone) && (
                  <p>
                    From {r.from.name ? `${r.from.name} ` : ""}
                    <span className="font-mono text-xs">{r.from.email ?? r.from.phone}</span>
                  </p>
                )}
              </div>
            )
          }
        </QueryBoundary>
      )}
    </section>
  )
}

function RuleCard({ rule, onEdit, onDelete }: { rule: ScopeRule; onEdit: () => void; onDelete: () => void }) {
  const who = rule.scope === "app" ? "the app rule" : `the ${rule.scope} rule for ${rule.scopeId}`
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{rule.scope === "app" ? "This app" : <span className="font-mono text-xs">{rule.scopeId}</span>}</span>
        <span className="flex gap-2">
          <Button size="xs" variant="outline" aria-label={`Edit ${who}`} onClick={onEdit}>
            Edit
          </Button>
          <Button size="xs" variant="ghost" aria-label={`Delete ${who}`} onClick={onDelete}>
            Delete
          </Button>
        </span>
      </header>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {ROUTED_CHANNELS.map((ch) => {
          const p = rule.providers[ch]
          return (
            <div key={ch} className="contents">
              <dt className="text-muted-foreground">{ch}</dt>
              <dd>
                {!p ? (
                  <NoneCell label={`${ch} provider`} />
                ) : p.dangling ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <DanglingBadge />
                    <span className="font-mono text-xs">{p.id}</span>
                  </span>
                ) : (
                  <PluginLink to={providerPath(p.id)} className="underline">
                    {p.name}
                  </PluginLink>
                )}
              </dd>
            </div>
          )
        })}
        <dt className="text-muted-foreground">From</dt>
        <dd>
          {rule.fromEmail || rule.fromName || rule.fromPhone ? (
            <span>
              {rule.fromName ? `${rule.fromName} ` : ""}
              {rule.fromEmail && <span className="font-mono text-xs">{rule.fromEmail}</span>}
              {rule.fromPhone && <span className="font-mono text-xs"> {rule.fromPhone}</span>}
            </span>
          ) : (
            <NoneCell label="sender" />
          )}
        </dd>
        {rule.defaultLocale && (
          <>
            <dt className="text-muted-foreground">Default locale</dt>
            <dd>
              <span className="font-mono text-xs">{rule.defaultLocale}</span> <span className="text-muted-foreground">(stored, but Send doesn't use it)</span>
            </dd>
          </>
        )}
      </dl>
    </article>
  )
}

interface Draft {
  scope: ScopeType
  scopeId: string
  slots: Record<RoutedChannel, string>
  fromEmail: string
  fromName: string
  fromPhone: string
}

function draftOf(rule: ScopeRule | null): Draft {
  const slots = Object.fromEntries(ROUTED_CHANNELS.map((ch) => {
    const p = rule?.providers[ch]
    // A dangling slot starts cleared: the server re-checks every slot on
    // save and refuses a rule naming a deleted provider.
    return [ch, p && !p.dangling ? p.id : ""]
  })) as Record<RoutedChannel, string>
  return { scope: rule?.scope ?? "app", scopeId: rule?.scopeId ?? "", slots, fromEmail: rule?.fromEmail ?? "", fromName: rule?.fromName ?? "", fromPhone: rule?.fromPhone ?? "" }
}

function RuleDialog({ rule, providers, onClose }: { rule: ScopeRule | null; providers: ProviderSummary[]; onClose: () => void }) {
  const set = useCommand<ScopesSetResponse>("scopes.set")
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule))
  const editing = rule !== null
  const stored = draftOf(rule)
  const danglingSlots = ROUTED_CHANNELS.filter((ch) => rule?.providers[ch]?.dangling)
  const needsId = draft.scope !== "app"
  const canSubmit = !set.loading && (!needsId || draft.scopeId.trim() !== "")

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const payload: ScopesSetRequest = { scope: draft.scope }
    if (needsId) payload.scopeId = draft.scopeId.trim()
    for (const ch of ROUTED_CHANNELS) {
      const value = draft.slots[ch]
      // On add, only what you set. On edit, what changed, and a dangling
      // slot always: its stored value is a deleted provider.
      const original = editing ? (rule?.providers[ch]?.id ?? "") : ""
      if (value !== original) payload[slotKey(ch)] = value
    }
    for (const key of ["fromEmail", "fromName", "fromPhone"] as const) {
      const value = draft[key].trim()
      if (value !== (editing ? stored[key] : "")) payload[key] = value
    }
    const result = await set.execute(payload)
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !set.loading && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit routing rule" : "Add a routing rule"}</DialogTitle>
            <DialogDescription>A rule picks the provider per channel and the sender. Leave a channel empty to let the next level decide.</DialogDescription>
          </DialogHeader>
          <CommandAlert error={set.error} title="Could not save the rule" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-level">Level</Label>
              <NativeSelect id="rule-level" value={draft.scope} disabled={editing} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as ScopeType }))}>
                <NativeSelectOption value="app">app</NativeSelectOption>
                <NativeSelectOption value="org">org</NativeSelectOption>
                <NativeSelectOption value="user">user</NativeSelectOption>
              </NativeSelect>
            </div>
            {needsId && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-id">{draft.scope === "org" ? "Org ID" : "User ID"}</Label>
                <Input id="rule-id" className="font-mono" autoComplete="off" disabled={editing} value={draft.scopeId} onChange={(e) => setDraft((d) => ({ ...d, scopeId: e.target.value }))} />
              </div>
            )}
          </div>
          {ROUTED_CHANNELS.map((ch) => (
            <div key={ch} className="flex flex-col gap-1.5">
              <Label htmlFor={`rule-${ch}`}>{`${ch} provider`}</Label>
              <NativeSelect id={`rule-${ch}`} value={draft.slots[ch]} onChange={(e) => setDraft((d) => ({ ...d, slots: { ...d.slots, [ch]: e.target.value } }))}>
                <NativeSelectOption value="">Not set</NativeSelectOption>
                {providers
                  .filter((p) => p.channel === ch)
                  .map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              {danglingSlots.includes(ch) && <p className="text-xs text-muted-foreground">The provider this pointed at was deleted. Saving clears it.</p>}
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["fromEmail", "From email"],
                ["fromName", "From name"],
                ["fromPhone", "From phone"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`rule-${key}`}>{label}</Label>
                <Input id={`rule-${key}`} autoComplete="off" value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={set.loading} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {set.loading ? "Saving…" : "Save rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export const RoutingPage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  const rules = useQuery<ScopesListResponse>("scopes.list")
  const providers = useQuery<ProvidersListResponse>("providers.list")
  const remove = useCommand<DeleteResponse>("scopes.delete")
  // undefined: no dialog. null: adding. A rule: editing it.
  const [editing, setEditing] = useState<ScopeRule | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<ScopeRule | null>(null)

  function openDelete(rule: ScopeRule) {
    remove.reset()
    setDeleting(rule)
  }

  async function confirmDelete() {
    if (!deleting) return
    const payload = deleting.scope === "app" ? { scope: "app" } : { scope: deleting.scope, scopeId: deleting.scopeId }
    const result = await remove.execute(payload)
    if (result === undefined) return
    setDeleting(null)
  }

  return (
    <section className="flex flex-col gap-6">
      <HeraldHeader
        title="Routing"
        description="Herald picks a provider per channel from the user's rule, then the org's, then the app's, then the first enabled provider by priority."
        actions={<Button onClick={() => setEditing(null)}>Add a rule</Button>}
      />
      <WhoSends channels={info.data?.channels ?? []} />
      <QueryBoundary title="Routing rules" query={rules} skeletonRows={4}>
        {(data) => (
          <div className="flex flex-col gap-6">
            {LEVELS.map(({ scope, heading }) => {
              const level = data.rules.filter((r) => r.scope === scope)
              return (
                <section key={scope} className="flex flex-col gap-3">
                  <h2 className="text-sm font-medium">{heading}</h2>
                  {level.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{scope === "app" ? "No app rule. Each channel falls back to its first enabled provider." : `No ${scope} rules.`}</p>
                  ) : (
                    level.map((rule) => <RuleCard key={rule.id} rule={rule} onEdit={() => setEditing(rule)} onDelete={() => openDelete(rule)} />)
                  )}
                </section>
              )
            })}
          </div>
        )}
      </QueryBoundary>
      {editing !== undefined && <RuleDialog rule={editing} providers={providers.data?.providers ?? []} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.loading && setDeleting(null)}
        title={deleting?.scope === "app" ? "Delete the app rule?" : `Delete the ${deleting?.scope ?? ""} rule for ${deleting?.scopeId ?? ""}?`}
        description="Sends that matched it fall through to the next level. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete the rule" />
      </ConfirmDialog>
    </section>
  )
}
```

The dialog mounts only while open, so each open starts from the rule as stored with no stale error. Its `onOpenChange` ignores a close while saving, so a failure is never hidden.

- [ ] **Step 3: Register, run, commit**

In `src/index.tsx`: import and export `RoutingPage`; add `RouteIcon`; nav `{ label: "Routing", to: "/routing", priority: 40, icon: <RouteIcon />, group: "Notifications" }`; route `{ path: "/routing", element: RoutingPage }`. `ROUTES` and `NAV` gain `"/routing"`.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/pages/routing.tsx packages/plugin-herald/test/routing.test.tsx
git commit --only -m "feat(plugin-herald): show routing rules, ask who sends, and edit rules that name a deleted provider" -- packages/plugin-herald/src/pages/routing.tsx packages/plugin-herald/test/routing.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 10: The rendered preview (shared with the template workspace)

Send test renders a template before it sends, and plan 2b-2's workspace renders as you type. Both use this. It never runs markup in the dashboard's origin: HTML renders in `<iframe sandbox="" srcdoc>` whose document opens with a CSP that allows inline styles and `data:` images only, so a tracking pixel can't fire from the operator's browser until they ask for remote images. SMS output is counted in segments, because a template that tips into a second segment doubles its cost. Nothing here imports CodeMirror.

**Files:**
- Create: `packages/plugin-herald/src/components/preview/sms.ts`, `src/components/preview/srcdoc.ts`, `src/components/preview/use-render-preview.ts`, `src/components/preview/rendered-preview.tsx`, `test/preview.test.tsx`

**Interfaces:**
- Produces:
  - `countSms(text: string): { encoding: "GSM-7" | "UCS-2"; units: number; segments: number; perSegment: number }`
  - `buildSrcdoc(html: string, allowRemoteImages: boolean): string`
  - `useRenderPreview(request: TemplatesRenderRequest | null, delayMs?: number): { result?: PreviewResult; error?: ContractError; stale: boolean }`: debounced (default 400 ms), through `usePluginClient().query`, keeps the last result on screen and marks it stale while a newer render is pending, ignores answers that arrive out of order.
  - `RenderedPreview({ channel, result, from?, stale })` and `DiagnosticsList({ diagnostics })`.

- [ ] **Step 1: Write the failing tests**

`packages/plugin-herald/test/preview.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { countSms } from "../src/components/preview/sms"
import { buildSrcdoc } from "../src/components/preview/srcdoc"
import { DiagnosticsList, RenderedPreview } from "../src/components/preview/rendered-preview"
import { useRenderPreview } from "../src/components/preview/use-render-preview"
import type { PreviewResult, TemplatesRenderRequest } from "../src/wire"
import "./harness"

function result(over: Partial<Record<"subject" | "html" | "text" | "title", string>> = {}): PreviewResult {
  return {
    fields: (["subject", "html", "text", "title"] as const).map((field) => ({ field, output: over[field] ?? "", rendered: (over[field] ?? "") !== "" })),
    diagnostics: [],
  }
}

describe("countSms", () => {
  it("counts GSM-7 in 160s, then 153s once split", () => {
    expect(countSms("a".repeat(160))).toEqual({ encoding: "GSM-7", units: 160, segments: 1, perSegment: 160 })
    expect(countSms("a".repeat(161))).toEqual({ encoding: "GSM-7", units: 161, segments: 2, perSegment: 153 })
  })

  it("counts an extension character as two and keeps accented basics in GSM-7", () => {
    expect(countSms("€").units).toBe(2)
    expect(countSms("é").encoding).toBe("GSM-7")
  })

  it("switches to UCS-2 for anything outside the alphabet, in 70s then 67s", () => {
    expect(countSms("ł".repeat(70))).toEqual({ encoding: "UCS-2", units: 70, segments: 1, perSegment: 70 })
    expect(countSms("ł".repeat(71))).toEqual({ encoding: "UCS-2", units: 71, segments: 2, perSegment: 67 })
    expect(countSms("👋").units).toBe(2)
  })

  it("is zero segments for nothing", () => {
    expect(countSms("").segments).toBe(0)
  })
})

describe("buildSrcdoc", () => {
  it("opens with a CSP that blocks scripts and remote images", () => {
    const doc = buildSrcdoc('<img src="https://tracker.test/p.gif">', false)
    const csp = doc.indexOf("Content-Security-Policy")
    expect(csp).toBeGreaterThan(-1)
    expect(csp).toBeLessThan(doc.indexOf("<body>"))
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("img-src data:;")
    expect(doc).not.toMatch(/script-src/)
  })

  it("lets remote images in only when asked", () => {
    expect(buildSrcdoc("", true)).toContain("img-src data: https: http:;")
  })
})

describe("RenderedPreview", () => {
  it("renders email HTML in an empty sandbox with the CSP, and loads remote images only on request", () => {
    render(<RenderedPreview channel="email" result={result({ subject: "Hi Ada", html: "<p>Hello</p>", text: "Hello" })} from={{ email: "no-reply@example.com", name: "Example" }} stale={false} />)
    const frame = screen.getByTitle("Rendered email") as HTMLIFrameElement
    expect(frame.getAttribute("sandbox")).toBe("")
    expect(frame.getAttribute("srcdoc")).toContain("img-src data:;")
    expect(screen.getByText("Hi Ada")).toBeTruthy()
    expect(screen.getByText(/no-reply@example.com/)).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: "Load remote images" }))
    expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:;")
    expect(frame.getAttribute("sandbox")).toBe("")
  })

  it("counts SMS segments under the text", () => {
    render(<RenderedPreview channel="sms" result={result({ text: "a".repeat(161) })} stale={false} />)
    expect(screen.getByText("2 segments, GSM-7, 161 characters (153 per segment)")).toBeTruthy()
  })

  it("marks an out-of-date preview instead of passing it off as current", () => {
    render(<RenderedPreview channel="sms" result={result({ text: "old" })} stale />)
    expect(screen.getByRole("status").textContent).toMatch(/Out of date/)
  })

  it("lists problems with their field and position", () => {
    render(<DiagnosticsList diagnostics={[{ field: "html", line: 12, column: 5, severity: "error", kind: "parse", message: 'function "nosuch" not defined' }, { field: "", line: 0, column: 0, severity: "warning", kind: "unprovided", message: '"code" has no sample value' }]} />)
    expect(screen.getByText(/html 12:5/)).toBeTruthy()
    expect(screen.getByText(/function "nosuch" not defined/)).toBeTruthy()
    expect(screen.getByText(/"code" has no sample value/)).toBeTruthy()
  })
})

describe("useRenderPreview", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  function Probe({ request }: { request: TemplatesRenderRequest | null }) {
    const preview = useRenderPreview(request)
    const text = preview.result?.fields.find((f) => f.field === "text")?.output ?? "none"
    return (
      <p>
        {text}|{preview.stale ? "stale" : "fresh"}
      </p>
    )
  }

  it("renders 400ms after the last change, keeping the old output marked stale meanwhile", async () => {
    const calls: unknown[] = []
    const client = {
      extension: "herald",
      query: async (_intent: string, params?: Record<string, unknown>) => {
        calls.push(params)
        return result({ text: String((params?.content as { text: string }).text) })
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    const req = (text: string): TemplatesRenderRequest => ({ content: { subject: "", html: "", text, title: "" }, data: {} })
    const view = render(
      <PluginProvider client={client}>
        <Probe request={req("one")} />
      </PluginProvider>
    )
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    await waitFor(() => expect(screen.getByText("one|fresh")).toBeTruthy())
    view.rerender(
      <PluginProvider client={client}>
        <Probe request={req("two")} />
      </PluginProvider>
    )
    expect(screen.getByText("one|stale")).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(399)
    })
    expect(calls).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await waitFor(() => expect(screen.getByText("two|fresh")).toBeTruthy())
  })
})
```

Run: `npx vitest run test/preview.test.tsx`. Expected: FAIL.

- [ ] **Step 2: The pure helpers**

`packages/plugin-herald/src/components/preview/sms.ts`:

```ts
/*
 * SMS segment counting. GSM-7 fits 160 characters in one message and 153 per
 * part once split; anything outside the GSM alphabet sends the whole message
 * as UCS-2, 70 and 67. The extension table's characters cost two units each.
 * Counts are what carriers usually do, not a promise from any one of them.
 */
const BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
)
const EXTENSION = new Set("^{}\\[~]|€\f")

export interface SmsCount {
  encoding: "GSM-7" | "UCS-2"
  units: number
  segments: number
  perSegment: number
}

function segments(units: number, single: number, multi: number): { segments: number; perSegment: number } {
  if (units === 0) return { segments: 0, perSegment: single }
  return units <= single ? { segments: 1, perSegment: single } : { segments: Math.ceil(units / multi), perSegment: multi }
}

export function countSms(text: string): SmsCount {
  let units = 0
  let gsm = true
  for (const ch of text) {
    if (BASIC.has(ch)) units += 1
    else if (EXTENSION.has(ch)) units += 2
    else {
      gsm = false
      break
    }
  }
  if (gsm) return { encoding: "GSM-7", units, ...segments(units, 160, 153) }
  // UCS-2 counts UTF-16 code units: a character outside the basic plane is two.
  const ucs = [...text].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0)
  return { encoding: "UCS-2", units: ucs, ...segments(ucs, 70, 67) }
}
```

`packages/plugin-herald/src/components/preview/srcdoc.ts`:

```ts
/*
 * The document an email preview renders in. It goes into
 * <iframe sandbox="" srcdoc>: the empty sandbox denies scripts, forms, popups
 * and same-origin access, so rendered markup can't touch the dashboard. The
 * CSP comes first in <head> and allows inline styles and data: images only,
 * which keeps a tracking pixel in a template from firing from the operator's
 * browser. Remote images load only when the operator asks.
 */
export function buildSrcdoc(html: string, allowRemoteImages: boolean): string {
  const images = allowRemoteImages ? "img-src data: https: http:;" : "img-src data:;"
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${images} font-src data:`
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"></head><body>${html}</body></html>`
}
```

- [ ] **Step 3: The render hook**

`packages/plugin-herald/src/components/preview/use-render-preview.ts`:

```ts
import { useEffect, useRef, useState } from "react"
import { ContractError, usePluginClient } from "@forge-go/dashboard-plugin"
import { useDebounced } from "../../use-debounced"
import type { PreviewResult, TemplatesRenderRequest } from "../../wire"

interface Settled {
  key: string
  result?: PreviewResult
  error?: ContractError
}

/**
 * templates.render, 400ms after the last change to the request.
 *
 * It goes through the client directly rather than useQuery: a query's params
 * are its cache key, and a key holding the whole editor buffer would leave one
 * store entry per settled edit. The last answer stays on screen, marked stale
 * while a newer request is waiting or in flight, so nobody reads a preview of
 * text they have already changed without being told. An answer that arrives
 * after a newer request was sent is dropped.
 */
export function useRenderPreview(request: TemplatesRenderRequest | null, delayMs = 400) {
  const client = usePluginClient()
  const key = request === null ? "" : JSON.stringify(request)
  const settledKey = useDebounced(key, delayMs)
  const [settled, setSettled] = useState<Settled>({ key: "" })
  const latest = useRef("")

  useEffect(() => {
    latest.current = settledKey
    if (settledKey === "") return
    const params = JSON.parse(settledKey) as Record<string, unknown>
    client
      .query<PreviewResult>("templates.render", params)
      .then((result) => {
        if (latest.current === settledKey) setSettled({ key: settledKey, result })
      })
      .catch((err: unknown) => {
        if (latest.current !== settledKey) return
        const error = err instanceof ContractError ? err : new ContractError("TRANSPORT", String(err))
        setSettled((prev) => ({ key: settledKey, result: prev.result, error }))
      })
  }, [client, settledKey])

  return { result: settled.result, error: key === settled.key ? settled.error : undefined, stale: key !== settled.key }
}
```

`usePluginClient()` returns the `PluginProvider`'s context value, which is stable, so the effect runs once per settled request. `useDebounced` starts settled on its first value, so the first render asks at once and only later edits wait 400ms.

- [ ] **Step 4: The preview component**

`packages/plugin-herald/src/components/preview/rendered-preview.tsx`:

```tsx
import { useState } from "react"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { plural } from "../../format"
import type { Diagnostic, PreviewResult, TemplateField } from "../../wire"
import { countSms } from "./sms"
import { buildSrcdoc } from "./srcdoc"

const output = (result: PreviewResult | undefined, field: TemplateField) => result?.fields.find((f) => f.field === field)?.output ?? ""

/** Lengths platforms usually cut at. Typical, not exact. */
const PUSH_TITLE = 65
const PUSH_BODY = 240

export function DiagnosticsList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Problems">
      {diagnostics.map((d, i) => (
        <li key={i} className={d.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
          <span aria-hidden="true">{d.severity === "error" ? "✕ " : "⚠ "}</span>
          <span className="sr-only">{d.severity === "error" ? "Error: " : "Warning: "}</span>
          {d.field && (
            <span className="font-mono text-xs">
              {d.field}
              {d.line > 0 ? ` ${d.line}${d.column > 0 ? `:${d.column}` : ""}` : ""}{" "}
            </span>
          )}
          {d.message}
        </li>
      ))}
    </ul>
  )
}

function EmailPreview({ result, from }: { result?: PreviewResult; from?: { email?: string; name?: string } }) {
  const [remote, setRemote] = useState(false)
  const html = output(result, "html")
  const text = output(result, "text")
  const subject = output(result, "subject")
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
        <dt className="text-muted-foreground">From</dt>
        <dd>{from?.email ? `${from.name ? `${from.name} ` : ""}<${from.email}>` : <NoneCell label="sender" />}</dd>
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="font-medium">{subject || <NoneCell label="subject" />}</dd>
      </dl>
      <Tabs defaultValue="rendered">
        <TabsList>
          <TabsTrigger value="rendered">Rendered</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        <TabsContent value="rendered" className="flex flex-col gap-2">
          {html === "" ? (
            <p className="text-sm text-muted-foreground">No HTML part. Mail clients show the text part.</p>
          ) : (
            <iframe title="Rendered email" sandbox="" srcDoc={buildSrcdoc(html, remote)} className="h-80 w-full rounded-md border bg-white" />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch aria-label="Load remote images" checked={remote} onCheckedChange={setRemote} />
            <span aria-hidden="true">Load remote images</span>
          </label>
          {!remote && <p className="text-xs text-muted-foreground">Remote images are off, so a tracking pixel in the template can't fire from your browser.</p>}
        </TabsContent>
        <TabsContent value="text">
          <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{text || "(no text part)"}</pre>
        </TabsContent>
        <TabsContent value="source">
          <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{html || "(no HTML part)"}</pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SmsPreview({ result, from }: { result?: PreviewResult; from?: { phone?: string } }) {
  const text = output(result, "text")
  const count = countSms(text)
  return (
    <div className="flex flex-col gap-2 text-sm">
      {from?.phone && (
        <p>
          From <span className="font-mono text-xs">{from.phone}</span>
        </p>
      )}
      <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{text || "(empty)"}</pre>
      <p className="text-muted-foreground">
        {plural(count.segments, "segment")}, {count.encoding}, {plural(count.units, "character")} ({count.perSegment} per segment)
      </p>
    </div>
  )
}

function ShortPreview({ result }: { result?: PreviewResult }) {
  const title = output(result, "title")
  const text = output(result, "text")
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <p className="font-medium">{title || <NoneCell label="title" />}</p>
      <p className="whitespace-pre-wrap">{text || <NoneCell label="body" />}</p>
      <p className="text-xs text-muted-foreground">
        Title {title.length} / about {PUSH_TITLE}, body {text.length} / about {PUSH_BODY}. Typical cut-offs, not exact ones.
      </p>
    </div>
  )
}

function PlainPreview({ result }: { result?: PreviewResult }) {
  const subject = output(result, "subject")
  return (
    <div className="flex flex-col gap-2 text-sm">
      {subject && <p className="font-medium">{subject}</p>}
      <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{output(result, "text") || "(empty)"}</pre>
    </div>
  )
}

export function RenderedPreview({ channel, result, from, stale }: { channel: string; result?: PreviewResult; from?: { email?: string; name?: string; phone?: string }; stale: boolean }) {
  return (
    <div className="relative flex flex-col gap-2">
      {stale && (
        <p role="status" className="text-xs text-muted-foreground">
          Out of date: rendering your latest change…
        </p>
      )}
      <div className={stale ? "opacity-60" : undefined}>
        {channel === "email" ? (
          <EmailPreview result={result} from={from} />
        ) : channel === "sms" ? (
          <SmsPreview result={result} from={from} />
        ) : channel === "push" || channel === "inapp" ? (
          <ShortPreview result={result} />
        ) : (
          <PlainPreview result={result} />
        )}
      </div>
    </div>
  )
}
```

The Switch carries the accessible name ("Load remote images") and the visible text beside it is `aria-hidden`, which avoids the double-label problem kit Checkbox and Switch have under a wrapping `<label>`.

Run: `npx vitest run test/preview.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/components/preview/sms.ts packages/plugin-herald/src/components/preview/srcdoc.ts packages/plugin-herald/src/components/preview/use-render-preview.ts packages/plugin-herald/src/components/preview/rendered-preview.tsx packages/plugin-herald/test/preview.test.tsx
git commit --only -m "feat(plugin-herald): preview rendered templates in a sandbox and count SMS segments" -- packages/plugin-herald/src/components/preview/sms.ts packages/plugin-herald/src/components/preview/srcdoc.ts packages/plugin-herald/src/components/preview/use-render-preview.ts packages/plugin-herald/src/components/preview/rendered-preview.tsx packages/plugin-herald/test/preview.test.tsx
git show --stat HEAD
```

---
### Task 11: Send test

A form that sends one real message: channel, provider (optional; left empty, it shows who Herald would pick and why), recipient, then either a template with a locale and its variables or a raw subject and body. The template path shows the rendered preview inline. Sending opens a confirm that names the provider, its driver, the channel and the recipient, and says when the provider is disabled. The result card is honest about each outcome, and a provider failure is a result, not an error banner.

**Files:**
- Create: `packages/plugin-herald/src/pages/send-test.tsx`, `test/send-test.test.tsx`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `HeraldHeader`, `useEngineInfo`, `useRenderPreview`, `RenderedPreview`, `DiagnosticsList`, `VIA_TEXT` (from `src/pages/routing.tsx`), `DisabledProviderBadge`, `NO_RECEIPTS`, `messagePath`, wire types.
- Produces: `SendTestPage`; routes `/send-test`, `/providers/:providerId/send-test`, `/messages/:messageId/send-test`; nav "Send test" (priority 70).

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/send-test.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SendTestPage } from "../src/pages/send-test"
import type { SendTestResponse } from "../src/wire"
import { engine, messageDetail, providerDetail, providerSummary, templateDetail, templateSummary } from "./data"
import { renderPage, scriptedClient } from "./harness"

const SMTP = providerSummary()
const TWILIO = providerSummary({ id: "hpvd_01j00000000000000000000002", name: "Twilio", channel: "sms", driver: "twilio" })
const RENDERED = {
  fields: [
    { field: "subject", output: "Your $12 receipt", rendered: true },
    { field: "html", output: "<p>Thanks Ada</p>", rendered: true },
    { field: "text", output: "Thanks Ada", rendered: true },
    { field: "title", output: "", rendered: false },
  ],
  diagnostics: [],
}

function setup(answer: SendTestResponse | (() => unknown) = { messageId: "hmsg_01j00000000000000000000150", status: "sent", provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp" }, providerMessageId: "test@smtp.example.com", logged: true }, resolveEnabled = true) {
  return scriptedClient(
    {
      "engine.info": engine(),
      "providers.list": (p) => ({ providers: [SMTP, TWILIO].filter((x) => x.channel === p.channel) }),
      "providers.detail": { provider: providerDetail() },
      "templates.list": (p) => ({ templates: p.channel === "email" ? [templateSummary()] : [] }),
      "templates.detail": { template: templateDetail(), resolution: [] },
      "templates.resolve": { locale: "en", steps: [{ try: "en", match: "exact", found: true, versionId: "htpv_01j00000000000000000000026" }], versionId: "htpv_01j00000000000000000000026", match: "exact" },
      "templates.render": RENDERED,
      "messages.detail": { message: messageDetail({ template: { id: "htpl_01j00000000000000000000015", slug: "billing.receipt", channel: "email" } }) },
      "send.resolve": (p) =>
        p.channel === "push"
          ? { provider: null, via: "none", from: {} }
          : p.providerId
            ? { provider: { id: String(p.providerId), name: p.channel === "sms" ? "Twilio" : "Primary SMTP", driver: p.channel === "sms" ? "twilio" : "smtp", enabled: true }, via: "chosen", from: {} }
            : { provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp", enabled: resolveEnabled }, via: "app", from: { email: "hello@example.com", name: "Example" } },
    },
    { "send.test": typeof answer === "function" ? answer : () => answer },
  )
}

async function fillTemplateSend() {
  fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
  fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
  fireEvent.change(await screen.findByLabelText("Template"), { target: { value: "htpl_01j00000000000000000000015" } })
  fireEvent.change(await screen.findByLabelText("customer_name"), { target: { value: "Ada" } })
  fireEvent.change(screen.getByLabelText("amount"), { target: { value: "$12" } })
}

async function sendAndConfirm() {
  fireEvent.click(await screen.findByRole("button", { name: "Send test" }))
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }))
  return dialog
}

describe("SendTestPage", () => {
  it("names the provider Herald would pick, and why, when you leave it to Herald", async () => {
    renderPage(SendTestPage, setup().client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
    expect(await screen.findByText(/the app's routing rule/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
    fireEvent.change(await screen.findByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/real email message to ada@example.com through Primary SMTP \(smtp\)/)
  })

  it("says the picked provider is disabled before you send", async () => {
    renderPage(SendTestPage, setup(undefined, false).client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
    expect(await screen.findByText("Provider disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(/which is disabled/)
  })

  it("pins the provider it was opened for", async () => {
    renderPage(SendTestPage, setup().client, { providerId: "hpvd_01j00000000000000000000001" })
    expect(((await screen.findByLabelText("Channel")) as HTMLSelectElement).value).toBe("email")
    await waitFor(() => expect((screen.getByLabelText("Provider") as HTMLSelectElement).value).toBe("hpvd_01j00000000000000000000001"))
    expect(await screen.findByText(/it was chosen explicitly/)).toBeTruthy()
  })

  it("prefills channel, recipient and template from a message", async () => {
    renderPage(SendTestPage, setup().client, { messageId: "hmsg_01j00000000000000000001000" })
    expect(((await screen.findByLabelText("Recipient")) as HTMLInputElement).value).toBe("ada@example.com")
    expect((screen.getByLabelText("Channel") as HTMLSelectElement).value).toBe("email")
    await waitFor(() => expect((screen.getByLabelText("Template") as HTMLSelectElement).value).toBe("htpl_01j00000000000000000000015"))
  })

  it("shows the rendered preview of the version that will answer", async () => {
    renderPage(SendTestPage, setup().client)
    await fillTemplateSend()
    expect(await screen.findByText("Your $12 receipt")).toBeTruthy()
    expect(screen.getByTitle("Rendered email").getAttribute("sandbox")).toBe("")
  })

  it("sends the template by slug with its locale and the variables you filled", async () => {
    const c = setup()
    renderPage(SendTestPage, c.client)
    await fillTemplateSend()
    await sendAndConfirm()
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]).toEqual({ intent: "send.test", payload: { channel: "email", recipient: "ada@example.com", template: "billing.receipt", locale: "en", data: { customer_name: "Ada", amount: "$12" } } })
  })

  it("sends a raw body without template fields", async () => {
    const c = setup()
    renderPage(SendTestPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "sms" } })
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "+15550111" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hello" } })
    await sendAndConfirm()
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ channel: "sms", recipient: "+15550111", body: "Hello" })
  })

  it("reports an accepted send without claiming delivery, with the vendor ID and a link to the log", async () => {
    renderPage(SendTestPage, setup().client)
    await fillTemplateSend()
    await sendAndConfirm()
    expect(await screen.findByText(/Accepted by Primary SMTP/)).toBeTruthy()
    expect(screen.getByText("test@smtp.example.com").className).toMatch(/font-mono text-xs/)
    expect(screen.getByText(/delivery isn't confirmed/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open it under Messages" }).getAttribute("href")).toBe("/messages/hmsg_01j00000000000000000000150")
  })

  it("shows a provider failure as a result with the provider's own words, not an error banner", async () => {
    renderPage(SendTestPage, setup({ messageId: "hmsg_01j00000000000000000000151", status: "failed", provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp" }, error: "smtp: 535 authentication failed", logged: true }).client)
    await fillTemplateSend()
    await sendAndConfirm()
    const pre = await screen.findByText("smtp: 535 authentication failed")
    expect(pre.tagName).toBe("PRE")
    expect(screen.getByText(/The provider refused it/)).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("explains a suppressed send and an unlogged one", async () => {
    renderPage(SendTestPage, setup({ messageId: "hmsg_01j00000000000000000000152", status: "suppressed", provider: null, error: "user opted out", logged: false }).client)
    await fillTemplateSend()
    fireEvent.change(screen.getByLabelText("User ID (optional)"), { target: { value: "usr_ada" } })
    await sendAndConfirm()
    expect(await screen.findByText(/usr_ada opted out of billing.receipt on email/)).toBeTruthy()
    expect(screen.getByText(/won't appear under Messages/)).toBeTruthy()
  })

  it("keeps a refusal that never reached a provider inside the dialog", async () => {
    renderPage(SendTestPage, setup(() => new ContractError("BAD_REQUEST", "herald: missing required template variable: amount")).client)
    await fillTemplateSend()
    const dialog = await sendAndConfirm()
    expect((await within(dialog).findByRole("alert")).textContent).toContain("missing required template variable: amount")
  })

  it("holds Send when nothing would send it", async () => {
    renderPage(SendTestPage, setup().client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "push" } })
    expect(await screen.findByText(/Nothing would send it/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "device-token" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

Run: `npx vitest run test/send-test.test.tsx`. Expected: FAIL.

- [ ] **Step 2: The page**

`packages/plugin-herald/src/pages/send-test.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { DisabledProviderBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { DiagnosticsList, RenderedPreview } from "../components/preview/rendered-preview"
import { useRenderPreview } from "../components/preview/use-render-preview"
import { NO_RECEIPTS } from "../format"
import { messagePath } from "../keys"
import { VIA_TEXT } from "./routing"
import type {
  EngineInfoResponse,
  MessagesDetailResponse,
  ProvidersDetailResponse,
  ProvidersListResponse,
  SendResolveResponse,
  SendTestRequest,
  SendTestResponse,
  TemplatesDetailResponse,
  TemplatesListResponse,
  TemplatesResolveResponse,
} from "../wire"

interface Initial {
  channel: string
  providerId: string
  recipient: string
  templateSlug: string
}

const EMPTY: Initial = { channel: "", providerId: "", recipient: "", templateSlug: "" }

function ResultCard({ r, channel, templateSlug, userId }: { r: SendTestResponse; channel: string; templateSlug: string; userId: string }) {
  const name = r.provider ? r.provider.name || r.provider.id : ""
  return (
    <section aria-labelledby="send-result" className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
      <h2 id="send-result" className="font-medium">
        Result
      </h2>
      {r.status === "sent" && (
        <p>
          Accepted by {name}
          {r.providerMessageId && (
            <>
              {" "}
              (<span className="font-mono text-xs">{r.providerMessageId}</span>)
            </>
          )}
          . {NO_RECEIPTS}
        </p>
      )}
      {r.status === "failed" && (
        <>
          <p>The provider refused it{name ? ` (${name})` : ""}. Its own words:</p>
          <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{r.error ?? "(no error text)"}</pre>
        </>
      )}
      {r.status === "suppressed" && (
        <p>
          Not sent: {userId || "the user"} opted out of {templateSlug || "this template"} on {channel}.
        </p>
      )}
      {r.status === "sending" && <p>Handed to the provider, and not settled yet.</p>}
      {!r.logged && <p>The message log couldn't be written, so this send won't appear under Messages.</p>}
      {r.messageId && r.logged && (
        <p>
          <PluginLink to={messagePath(r.messageId)} className="underline">
            Open it under Messages
          </PluginLink>
        </p>
      )}
    </section>
  )
}

function SendForm({ engine, initial }: { engine: EngineInfoResponse; initial: Initial }) {
  const send = useCommand<SendTestResponse>("send.test")
  const [channel, setChannel] = useState(initial.channel)
  const [providerId, setProviderId] = useState(initial.providerId)
  const [recipient, setRecipient] = useState(initial.recipient)
  const [mode, setMode] = useState<"template" | "raw">("template")
  // null: not chosen yet, so a message's template (if any) is the default.
  const [templateChoice, setTemplateChoice] = useState<string | null>(null)
  const [locale, setLocale] = useState(engine.defaultLocale)
  const [data, setData] = useState<Record<string, string>>({})
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [userId, setUserId] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [sentFor, setSentFor] = useState({ channel: "", templateSlug: "", userId: "" })

  const providers = useQuery<ProvidersListResponse>("providers.list", { channel }, { enabled: channel !== "" })
  const templates = useQuery<TemplatesListResponse>("templates.list", { channel }, { enabled: channel !== "" && mode === "template" })
  const templateId = templateChoice ?? templates.data?.templates.find((t) => t.slug === initial.templateSlug)?.id ?? ""
  const detail = useQuery<TemplatesDetailResponse>("templates.detail", { id: templateId }, { enabled: mode === "template" && templateId !== "" })
  const resolved = useQuery<TemplatesResolveResponse>("templates.resolve", { id: templateId, locale: locale.trim() }, { enabled: mode === "template" && templateId !== "" })

  const resolveParams: Record<string, unknown> = { channel }
  if (providerId) resolveParams.providerId = providerId
  if (userId.trim()) resolveParams.userId = userId.trim()
  const who = useQuery<SendResolveResponse>("send.resolve", resolveParams, { enabled: channel !== "" })

  const template = detail.data?.template
  const version = template?.versions.find((v) => v.id === resolved.data?.versionId)
  const sample = Object.fromEntries(Object.entries(data).filter(([, value]) => value.trim() !== ""))
  const preview = useRenderPreview(
    mode === "template" && template && version
      ? { templateId: template.id, content: { subject: version.subject, html: version.html, text: version.text, title: version.title }, data: sample }
      : null,
  )

  const target = who.data?.provider ?? null
  const ready = mode === "template" ? template !== undefined : body.trim() !== ""
  const canSend = !send.loading && channel !== "" && recipient.trim() !== "" && ready && target !== null

  function pickChannel(next: string) {
    setChannel(next)
    setProviderId("")
    setTemplateChoice("")
    setData({})
  }

  function openConfirm(event: FormEvent) {
    event.preventDefault()
    if (!canSend) return
    send.reset()
    setConfirming(true)
  }

  async function confirm() {
    const payload: SendTestRequest = { channel, recipient: recipient.trim() }
    if (providerId) payload.providerId = providerId
    if (mode === "template" && template) {
      payload.template = template.slug
      if (locale.trim()) payload.locale = locale.trim()
      if (Object.keys(sample).length > 0) payload.data = sample
    } else {
      payload.body = body
      if (subject.trim()) payload.subject = subject.trim()
    }
    if (userId.trim()) payload.userId = userId.trim()
    setSentFor({ channel, templateSlug: payload.template ?? "", userId: userId.trim() })
    const result = await send.execute(payload)
    // A provider failure is a normal answer with status "failed"; only a
    // refusal before any provider saw it lands here as undefined.
    if (result === undefined) return
    setConfirming(false)
  }

  const describeTarget = target
    ? `${target.name || target.id}${target.driver ? ` (${target.driver})` : ""}${target.enabled === false ? ", which is disabled" : ""}`
    : ""

  return (
    <div className="grid gap-8 @3xl/main:grid-cols-2">
      <form onSubmit={openConfirm} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-channel">Channel</Label>
            <NativeSelect id="send-channel" value={channel} onChange={(e) => pickChannel(e.target.value)}>
              <NativeSelectOption value="">Choose a channel</NativeSelectOption>
              {engine.channels.map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {c}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-provider">Provider</Label>
            <NativeSelect id="send-provider" value={providerId} disabled={channel === ""} onChange={(e) => setProviderId(e.target.value)}>
              <NativeSelectOption value="">Let Herald choose</NativeSelectOption>
              {(providers.data?.providers ?? []).map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>

        {channel !== "" && (
          <div className="text-sm">
            {who.error ? (
              <p className="text-destructive">
                {who.error.code}: {who.error.message}
              </p>
            ) : !who.data ? (
              <p className="text-muted-foreground">Asking who would send…</p>
            ) : target === null ? (
              <p>Nothing would send it: no rule names a provider for {channel}, and no enabled provider handles it.</p>
            ) : (
              <p className="flex flex-wrap items-center gap-2">
                <span>
                  Sends through <span className="font-medium">{target.name || target.id}</span>
                  {target.driver && <span className="font-mono text-xs"> {target.driver}</span>}, picked by {VIA_TEXT[who.data.via]}.
                </span>
                {target.enabled === false && <DisabledProviderBadge />}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-recipient">Recipient</Label>
          <Input id="send-recipient" className="font-mono" autoComplete="off" spellCheck={false} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-user">User ID (optional)</Label>
          <Input id="send-user" className="font-mono" autoComplete="off" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <p className="text-xs text-muted-foreground">Set it to test the user's opt-outs and routing rule, and in-app delivery.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-mode">Content</Label>
          <NativeSelect id="send-mode" value={mode} onChange={(e) => setMode(e.target.value as "template" | "raw")}>
            <NativeSelectOption value="template">A template</NativeSelectOption>
            <NativeSelectOption value="raw">Write it here</NativeSelectOption>
          </NativeSelect>
        </div>

        {mode === "template" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-template">Template</Label>
                <NativeSelect id="send-template" value={templateId} disabled={channel === ""} onChange={(e) => setTemplateChoice(e.target.value)}>
                  <NativeSelectOption value="">{channel === "" ? "Choose a channel first" : "Choose a template"}</NativeSelectOption>
                  {(templates.data?.templates ?? []).map((t) => (
                    <NativeSelectOption key={t.id} value={t.id}>
                      {`${t.name} (${t.slug})`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-locale">Locale</Label>
                <Input id="send-locale" className="font-mono" autoComplete="off" value={locale} onChange={(e) => setLocale(e.target.value)} />
              </div>
            </div>
            {templateId !== "" && resolved.data && resolved.data.versionId === null && (
              <p className="text-sm">No version answers {locale.trim() || "the fallback"}, so this send would fail. Add a fallback version, or pick a locale the template has.</p>
            )}
            {template && template.variables.length > 0 && (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-sm font-medium">Variables</legend>
                {template.variables.map((v) => (
                  <div key={v.name} className="flex flex-col gap-1.5">
                    <Label htmlFor={`var-${v.name}`} className="font-mono text-xs">
                      {v.name}
                    </Label>
                    <Input id={`var-${v.name}`} placeholder={v.default ?? ""} autoComplete="off" value={data[v.name] ?? ""} onChange={(e) => setData((d) => ({ ...d, [v.name]: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">
                      {v.type}
                      {v.required ? ", required" : ""}
                      {v.default ? `, defaults to ${v.default}` : ""}
                      {v.description ? `. ${v.description}` : ""}
                    </p>
                  </div>
                ))}
              </fieldset>
            )}
          </>
        ) : (
          <>
            {channel !== "sms" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-subject">Subject</Label>
                <Input id="send-subject" autoComplete="off" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="send-body">Body</Label>
              <Textarea id="send-body" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
          </>
        )}

        <div>
          <Button type="submit" disabled={!canSend}>
            Send test
          </Button>
        </div>
        {send.data && <ResultCard r={send.data} channel={sentFor.channel} templateSlug={sentFor.templateSlug} userId={sentFor.userId} />}
      </form>

      {mode === "template" && template && (
        <section aria-labelledby="send-preview" className="flex flex-col gap-3">
          <h2 id="send-preview" className="text-sm font-medium">
            Preview
          </h2>
          {preview.error && (
            <p className="text-sm text-destructive">
              {preview.error.code}: {preview.error.message}
            </p>
          )}
          <DiagnosticsList diagnostics={preview.result?.diagnostics ?? []} />
          <RenderedPreview channel={channel} result={preview.result} from={who.data?.from} stale={preview.stale} />
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && !send.loading && setConfirming(false)}
        title="Send a real test message?"
        description={`This sends a real ${channel} message to ${recipient.trim()} through ${describeTarget}. It is logged like any other send.`}
        confirmLabel="Send"
        destructive={false}
        pending={send.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={send.error} title="Herald refused the send" />
      </ConfirmDialog>
    </div>
  )
}

function Pinned({ engine, providerId }: { engine: EngineInfoResponse; providerId: string }) {
  const pinned = useQuery<ProvidersDetailResponse>("providers.detail", { id: providerId })
  return (
    <QueryBoundary title="Provider" query={pinned} skeletonRows={2}>
      {({ provider }) => <SendForm engine={engine} initial={{ ...EMPTY, channel: provider.channel, providerId: provider.id }} />}
    </QueryBoundary>
  )
}

function FromMessage({ engine, messageId }: { engine: EngineInfoResponse; messageId: string }) {
  const message = useQuery<MessagesDetailResponse>("messages.detail", { id: messageId })
  return (
    <QueryBoundary title="Message" query={message} skeletonRows={2}>
      {({ message: m }) => <SendForm engine={engine} initial={{ ...EMPTY, channel: m.channel, recipient: m.recipient, templateSlug: m.template?.slug ?? "" }} />}
    </QueryBoundary>
  )
}

/**
 * One page for three routes: plain, pinned to a provider (from its detail
 * page) and prefilled from a message (from its detail page, in place of the
 * templ dashboard's Retry, which re-sent a truncated text body as if it were
 * the original).
 */
export const SendTestPage: ComponentType<PluginPageProps> = ({ params }) => {
  const info = useEngineInfo()
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="Send test" description="Sends a real message to a real recipient, and logs it like any other send." />
      <QueryBoundary title="Channels" query={info} skeletonRows={4}>
        {(engine) =>
          params.providerId ? (
            <Pinned engine={engine} providerId={params.providerId} />
          ) : params.messageId ? (
            <FromMessage engine={engine} messageId={params.messageId} />
          ) : (
            <SendForm engine={engine} initial={EMPTY} />
          )
        }
      </QueryBoundary>
    </section>
  )
}
```

The failure test asserts no `role="alert"` anywhere on the page: a provider failure arrives as a successful command with `status: "failed"`, the dialog closes, and the result card shows the provider's words in a `<pre>`.

- [ ] **Step 3: Register, run, commit**

In `src/index.tsx`: import and export `SendTestPage`; add `SendIcon`; nav `{ label: "Send test", to: "/send-test", priority: 70, icon: <SendIcon />, group: "Notifications" }`; routes:

```tsx
{ path: "/send-test", element: SendTestPage },
{ path: "/providers/:providerId/send-test", element: SendTestPage },
{ path: "/messages/:messageId/send-test", element: SendTestPage },
```

`ROUTES` gains those three; `NAV` gains `"/send-test"`.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test && pnpm --filter @forge-go/dashboard-plugin-herald typecheck && pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/pages/send-test.tsx packages/plugin-herald/test/send-test.test.tsx
git commit --only -m "feat(plugin-herald): send a real test message with an honest confirm and result" -- packages/plugin-herald/src/pages/send-test.tsx packages/plugin-herald/test/send-test.test.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/plugin.test.tsx
git show --stat HEAD
```

---
### Task 12: Structure tests and the whole-package check

Cheap tests that catch the regressions page tests can't: a route wired to the wrong page, a page that skips the app line, a stray `/@herald` literal, a green class, a controlled password input, an eager import of a lazy page, or "delivered" creeping into the copy.

**Files:**
- Create: `packages/plugin-herald/test/routes.test.tsx`, `test/structure.test.ts`

**Interfaces:**
- Consumes: `heraldPlugin` and every page.

- [ ] **Step 1: Routes mount the right page**

`packages/plugin-herald/test/routes.test.tsx`:

```tsx
import { Suspense } from "react"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import heraldPlugin from "../src/index"
import { engine } from "./data"
import { stubClient } from "./harness"

const ANSWERS = {
  "engine.info": engine(),
  "overview.stats": { since: "2026-09-27T10:00:00Z", counts: [], providers: { total: 0, enabled: 0 }, credentials: { plaintext: 0, encrypted: 0 }, templatesWithoutFallback: [] },
  "providers.list": { providers: [] },
  "templates.list": { templates: [] },
  "messages.list": { messages: [] },
  "scopes.list": { rules: [] },
}

/** Text that belongs to one page alone, so a route wired to the wrong page fails. */
const EXPECTED: Record<string, string | RegExp> = {
  "/": "Messages by status and channel",
  "/providers": /No providers yet/,
  "/providers/:id": /No provider ID in the address, so there is nothing to show/,
  "/new-provider": "New provider",
  "/providers/:id/edit": /No provider ID in the address, so there is nothing to edit/,
  "/templates": /No templates yet/,
  "/templates-without-fallback": "Templates without a fallback",
  "/new-template": "New template",
  "/messages": /Nothing has been sent in this app yet/,
  "/messages/:id": /No message ID in the address/,
  "/inbox": /Enter a user ID to see their in-app notifications/,
  "/preferences": /Enter a user ID to see their preferences/,
  "/routing": "Who sends?",
  "/send-test": /Sends a real message to a real recipient/,
  "/providers/:providerId/send-test": /Sends a real message to a real recipient/,
  "/messages/:messageId/send-test": /Sends a real message to a real recipient/,
}

describe("routes", () => {
  it("names an expectation for every route", () => {
    expect(heraldPlugin.routes.map((r) => r.path).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(heraldPlugin.routes.map((r) => [r.path, r] as const))("%s mounts its own page", async (path, route) => {
    const Page = route.element
    render(
      <PluginProvider client={stubClient(ANSWERS)}>
        <Suspense fallback={null}>
          <Page params={{}} />
        </Suspense>
      </PluginProvider>
    )
    expect(await screen.findAllByText(EXPECTED[path])).not.toHaveLength(0)
  })
})
```

- [ ] **Step 2: Source rules**

`packages/plugin-herald/test/structure.test.ts`:

```ts
import { describe, expect, it } from "vitest"

/*
 * Rules about the sources themselves. They are read through import.meta.glob,
 * not node:fs: this package's tsconfig has no Node types, so fs passes vitest
 * and fails tsc.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", eager: true })
const source = (mod: { default: string } | string) => (typeof mod === "string" ? mod : mod.default)
const files = Object.entries(modules).map(([path, mod]) => [path, source(mod)] as const)
const naming = (pattern: RegExp) => files.filter(([, text]) => pattern.test(text)).map(([path]) => path).sort()

describe("plugin-herald sources", () => {
  it("found the sources", () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it("never uses a success colour: a badge's colour is an attention budget", () => {
    expect(naming(/\b(text|bg|border|fill|stroke|ring)-(green|emerald|lime|teal)-/)).toEqual([])
  })

  it("never writes the /@herald sigil: links are scope-relative", () => {
    expect(naming(/["'`]\/@herald/)).toEqual([])
  })

  it("never imports another plugin package", () => {
    expect(naming(/from\s+["']@forge-go\/dashboard-plugin-/)).toEqual([])
  })

  it("renders every page header through HeraldHeader, so every page names its app", () => {
    expect(naming(/components\/page-header/)).toEqual(["../src/components/herald-header.tsx"])
  })

  it("keeps password inputs in the secret-field helper, uncontrolled", () => {
    expect(naming(/type="password"/)).toEqual(["../src/components/secret-fields.tsx"])
  })

  it("reaches the provider forms only through lazy()", () => {
    const entry = source(modules["../src/index.tsx"])
    for (const page of ["provider-create", "provider-edit"]) {
      expect(entry).toMatch(new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\("\\./pages/${page}"\\)\\)`))
      expect(naming(new RegExp(`from\\s+["'][./]*pages/${page}["']`))).toEqual([])
    }
  })

  it("never says delivered outside the status mapping and the messages note that says it is never recorded", () => {
    expect(naming(/\bdelivered\b/i)).toEqual(["../src/badges.tsx", "../src/format.ts", "../src/pages/messages.tsx", "../src/wire.ts"])
  })
})
```

Run: `npx vitest run test/routes.test.tsx test/structure.test.ts`. Expected: PASS. A failure here names a real problem in an earlier task's code: fix that code, not the rule, and say so in your report.

- [ ] **Step 3: The whole package and the fixture walk**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
pnpm -r test 2>&1 | tail -40
FIXTURE_PORT=8299 node packages/fixture-server/server.mjs &
SERVER=$!
node packages/fixture-server/verify.mjs http://localhost:8299 2>&1 | grep -E "herald|failures" | tail -30
kill $SERVER
```

Expected: the herald package is clean on all three. `pnpm -r test` fails only in `packages/host/test/setup-screen.test.tsx` (unrelated, leave it) and in anything that was already failing before this plan; name any other failure in the report. Every herald walk entry and spot check passes.

- [ ] **Step 4: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-herald/test/routes.test.tsx packages/plugin-herald/test/structure.test.ts
git commit --only -m "test(plugin-herald): pin routes, headers, links, colours and secret inputs" -- packages/plugin-herald/test/routes.test.tsx packages/plugin-herald/test/structure.test.ts
git show --stat HEAD
```

---

## After the last task: run it

This is the controller's job, after the final review, with the browser pane. Start `fixture-server` (port 8099) and `dashboard-shell` (port 5173) from `.claude/launch.json`, open `/@herald`, and click through:

1. Overview: switch windows; encrypt the stored credentials and watch the plaintext count drop to 0.
2. Providers: create an SMTP provider with a canary password, confirm the list grows, open it, and confirm the canary is in neither the page nor any network response (`read_network_requests`). Replace its password; move its host and see Save held until the password is entered again.
3. Templates: filter to "without a fallback"; create a template; reset the system templates.
4. Messages: page forward, filter, open a failed one, follow "Send a test to this recipient".
5. Send test: send `billing.receipt` with sample data and read the preview (remote images off), then send to `fail@example.com` and read the failure.
6. Inbox and Preferences for `usr_ada`: mark read, delete, opt out, and confirm there's no way back in.
7. Routing: ask who sends email for `org_acme`, then edit the `org_acme` rule and save it (the deleted provider's slot clears).
8. Flip `FIXTURE_HERALD_KEY=none` and `FIXTURE_HERALD_CLAIM=bad` (restart the fixture server) and check the unencrypted callout and the permission error card.

Screenshots of each go in the final report. Anything that misbehaves is a finding for a fix task, not a note.

Carried to plan 2b-2: the template workspace at `/templates/:id` (the list and create already link there), CodeMirror with the lazy-chunk test, and the BASELINE.md section.
