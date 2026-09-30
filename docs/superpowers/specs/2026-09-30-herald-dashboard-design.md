# Herald dashboard migration

Spec 2 of 2. It needs `2026-09-30-herald-hardening-design.md` (spec 1) merged
first: several intents below are only honest because of engine and store
changes made there, and the plan for this spec starts after that one finishes.

Three pieces, in order: a contract contributor in `forgery/herald`, a new
`packages/plugin-herald` here, and then the templ dashboard's removal, as its
own commit, once the React side has been clicked through in a browser.

Read `packages/plugin/PLAYBOOK.md` before touching any of it.

## The contract (`herald/extension/contract/`)

It copies Vault's shape, because Vault is the most recent migration finished
end to end:

- `manifest.yaml`, embedded, declaring the contributor, the intents and every
  command's `invalidates`. The transport merges those into `meta.invalidates`,
  and that's the only way the React client ever refreshes.
- `contract.go` with `Register(d, reg, wreg, deps)`, one binding per intent.
- `errors.go` with `mapError`. Domain sentinels map to codes; anything else is
  `INTERNAL` with a fixed message, logged with the intent name, and the
  underlying text never reaches the client, because an error can carry a
  connection string or a credential.
- `operator.go` with `withOperator`, called by commands only, so audit events
  name the person who did the thing.
- `project.go` for the wire types, camelCase, and the functions that build them.
- `handlers_*.go` per area.

The extension implements `dashboard.ContractContributorAware`. The compile-time
assertion lives in `extension/dashboard_aware_test.go`, so the root forge
dashboard package (and the templ pages it drags in) stays out of the shipped
build. Herald moves from forge v1.10.0 to v1.11.2, the version Vault pins; both
have the contract packages, so this is for parity, and the plan checks what the
bump pulls in before committing to it.

`Deps` carries the `*herald.Herald`, the logger, the configured
`dashboard_app_id`, and whether the REST API is protected, which `engine.info`
reports.

### Which app

Nothing on the dashboard path populates `Principal.Claims` today, so the
fallback below is what every deployment actually runs. We designed it as the
real behaviour.

1. An `app_id` claim that is a non-empty string: use it.
2. An `app_id` claim that is present and unusable (empty string, a number,
   `nil`, anything but a non-empty string): refuse with `PERMISSION_DENIED`.
   A tenant whose claim failed to resolve must never be answered with another
   tenant's data, and this is the rule that stops it.
3. No claim at all: use `dashboard_app_id` from the extension config.
4. No claim and no config: use the `""` app.

Rule 4 is a legitimate default. It never applies when a claim was present and failed, which is rule 2's job.
Herald's stores treat `""` as an exact match (spec 1 pins that per backend),
and standalone installs keep their data there: `SeedDefaultProviders` and
config-seeded providers without an `app_id` both write to it. Under authsome,
though, data lives under real app IDs and the `""` app is nearly empty, which is
why every page names the app it's showing.

Every by-ID handler loads the row and compares its app ID. A mismatch returns
`NOT_FOUND`, never `PERMISSION_DENIED`, so a response can't be used to learn
that an ID exists in someone else's app. Versions are checked through their
template, inbox rows through their own app ID.

Tests cover the claim as absent, `""`, `42`, `nil` and a valid string, and
isolation is tested by writing rows under two apps, listing under one, and
asserting on identity, never on count.

### Paging

Messages and inbox rows grow without bound, so they use a cursor: an opaque
string wrapping an offset, and the handler asks the store for `limit + 1` rows
to know whether there's a next page. There's no total, which sidesteps the
question of whether a total on a delivery log is exact. Providers, templates and
scoped configs are bounded configuration and come back whole. Nothing uses page
numbers.

### Queries

`engine.info {}` returns the app in view (`{id, label}`, where the label is
"Default app" for `""`), the default locale, `maxBatchSize`, `truncateBodyAt`,
the channels, each registered driver with its channel and field schema (`null`
for a driver without one), the renderer's function names, whether a credential
key is configured and its key ID, and whether the REST API has auth configured.
It replaces the templ settings panel and feeds the page headers.

`overview.stats {window: "24h" | "7d" | "30d"}` returns `since`, the
`CountMessages` rows as `{status, channel, n}`, provider totals (`total`,
`enabled`), credential totals (`plaintext`, `encrypted`, counted per value), and
the templates with no fallback (`""`) version, as `{id, slug, channel}`.

`providers.list {channel?}` returns summaries: `id`, `name`, `channel`,
`driver`, `priority`, `enabled`, `credentials` (the `CredentialState` list from
spec 1, so key names and protection and never a value), `createdAt`,
`updatedAt`.

`providers.detail {id}` returns the summary plus `settings` as
`{key, value, secret}` (a legacy row that stored a secret-schema key in settings
comes back with `value` omitted) and `usedBy`, the scoped configs that point at
this provider, so a delete can warn you.

`templates.list {channel?, category?}` returns `id`, `slug`, `name`, `channel`,
`category`, `isSystem`, `enabled`, `locales` as `{locale, active}`,
`hasFallback`, `updatedAt`.

`templates.detail {id}` returns the template with its variables and versions,
and `resolution`: for each version's locale, for `""`, and for the configured
default locale, which version answers and by which `Match`.

`templates.resolve {id, locale}` returns the steps `Resolve` would take for any
locale you type, as `[{try, found, versionId?}]`, and the final match. It's
separate from `templates.detail` so the locale tester doesn't refetch the whole
template per keystroke.

`templates.render {templateId?, content, variables?, data}` runs spec 1's
`Preview` and returns its result: per-field output and diagnostics. With a
`templateId` and no `variables`, the stored variables are used; unsaved variable
edits are sent explicitly. The `templateId` is ownership checked. The manifest
disables caching for it; the params contain the whole editor buffer.

`messages.list {channel?, status?, cursor?, limit?}` returns summaries (`id`,
`recipient`, `channel`, `status`, `templateSlug`, `provider` as
`{id, name}` or null, `error`, `createdAt`, `sentAt`) and `nextCursor`.

`messages.detail {id}` returns every field, including `body`, `metadata`,
`attempts`, `async`, `envId` and `providerMessageId`, plus `template` resolved
from the stored slug and channel (`null` if it's gone) and `provider`
(`{id, name, driver}` or `null`). Resolving the slug is how the message page
links to its template; the templ link to the template was always broken,
because it parsed the slug as an ID.

`inbox.list {userId, cursor?}` returns notifications, the unread count and
`nextCursor`. An empty `userId` is `BAD_REQUEST`.

`preferences.get {userId}` returns the preference (or `null`) and `knownTypes`,
the template slugs in this app, so the matrix can offer an opt-out on a type the
user has never touched.

`scopes.list {}` returns every scoped config with its providers resolved to
`{id, name}`, or marked dangling when the provider was deleted, and the from
fields. `defaultLocale` comes back too, flagged as stored and unused by `Send`.

`send.resolve {channel, providerId?, orgId?, userId?}` returns the provider
that would send (`{id, name, driver, enabled}` or `null`), `via` (`chosen`,
`user`, `org`, `app`, `fallback`, `none`), and the from fields that would apply.

### Commands

Every command calls `withOperator` first and records an audit event through
Herald's chronicle bridge. Invalidations are declared in the manifest.

| intent | payload | invalidates |
|---|---|---|
| `providers.create` | `name, channel, driver, priority, enabled, credentials, settings` | `providers.list`, `providers.detail`, `overview.stats`, `send.resolve`, `scopes.list` |
| `providers.update` | `id`, pointers for `name, priority, enabled`, plus `setCredentials, removeCredentials, setSettings, removeSettings` | same |
| `providers.delete` | `id` | same |
| `providers.encryptStored` | `{}` | `providers.list`, `providers.detail`, `overview.stats` |
| `templates.create` | `slug, name, channel, category, variables?, version?` | `templates.list`, `templates.detail`, `templates.resolve`, `overview.stats`, `preferences.get` |
| `templates.update` | `id`, pointers for `name, category, enabled, variables` | same |
| `templates.delete` | `id` | same |
| `templates.resetDefaults` | `{}` | same |
| `versions.create` | `templateId, locale, subject, html, text, title, active` | `templates.list`, `templates.detail`, `templates.resolve`, `overview.stats` |
| `versions.update` | `templateId, versionId`, pointers for `subject, html, text, title, active` | same |
| `versions.delete` | `templateId, versionId` | same |
| `send.test` | `channel, recipient, providerId?, template?, locale?, data?, subject?, body?, userId?` | `messages.list`, `messages.detail`, `overview.stats`, `inbox.list` |
| `inbox.markRead` | `id` | `inbox.list` |
| `inbox.markAllRead` | `userId` | `inbox.list` |
| `inbox.delete` | `id` | `inbox.list` |
| `preferences.optOut` | `userId, type, channel` | `preferences.get` |
| `scopes.set` | `scope, scopeId`, pointers for each channel's provider ID and the from fields | `scopes.list`, `send.resolve`, `providers.detail` |
| `scopes.delete` | `scope, scopeId` | same |

Some rules the table can't carry:

- A provider's `channel` and `driver`, a template's `slug` and `channel`, and a
  version's `locale` can't be changed after creation. The first two change the
  driver schema, the slug is what callers send by, and the locale is part of a
  unique key. To change them you create a new one.
- Provider writes go through spec 1's engine methods, so they're validated and,
  with a key configured, encrypted. Credential values are write only. No
  response, error or log line carries one, and a canary test holds that for
  every intent.
- `providers.encryptStored` with no key configured is `BAD_REQUEST`, "no
  credential key is configured".
- A duplicate slug or locale is `CONFLICT` on every backend, from the sentinels
  spec 1 makes real.
- `templates.resetDefaults` answers `{deleted, seeded}`, counted by the handler
  around `ResetDefaultTemplates`.
- `preferences.optOut` can only make a preference more restrictive. It sets one
  channel of one type to opted out, creating the record if there isn't one, and
  is idempotent. There is no intent that opts a user back in or deletes a
  preference: a missing record means opted in to everything, so deleting one
  would re-subscribe the user to every channel they declined. Channels are the
  four `IsOptedOut` understands (email, sms, push, inapp).
- `scopes.set` reads the existing config and applies only the fields you sent,
  and checks each referenced provider belongs to this app and handles that
  channel.
- `send.test` answers `{messageId, status, provider, providerMessageId?, error?,
  logged}` whatever the driver did. A provider failure is a normal response with
  status `failed`, not a contract error, so the page can show exactly what the
  provider said. Contract errors are for requests that never reached a
  provider: no provider for the channel, template not found, render failure.

### Contract tests

Handlers are tested directly against the memory store, with a SQLite suite for
anything that writes JSON or upserts, since those are the bugs that only show on
a real backend. Structural tests: every manifest intent is registered, and a
real `transport.NewHandler` delivers each command's `invalidates` to the client.
Plus the scope cases above, cross-app isolation per by-ID intent, and the
credential canary.

## The plugin (`packages/plugin-herald`)

```tsx
export const heraldPlugin = definePlugin({
  extension: "herald",
  namespace: "herald",
  label: "Notifications",
  ...
})
```

Nav, in the group "Notifications": Overview, Templates, Messages, Providers,
Routing, Inbox, Preferences, Send test. Create routes are `/new-provider` and
`/new-template`, as in Vault, so nothing can collide with an ID. The template
workspace and the provider form are lazy routes.

The layout mirrors `plugin-vault`: `src/index.tsx`, `src/pages/`,
`src/components/`, `src/badges.tsx` with its reasoning, `src/wire.ts` for the
response types, and `test/harness.tsx` plus a test file per page.

Every page header names the app from `engine.info`: "Default app" or the app ID
in `font-mono text-xs`. Without it, an empty list under authsome reads as
"nothing was sent" when it means "nothing in this app".

All five display conventions apply, and identifiers (message IDs, provider IDs,
driver names, template slugs, locales, notification types, vendor message IDs)
carry `font-mono text-xs`.

### Badges

Written down in `badges.tsx`, with the reasons, because this is where earlier
migrations went wrong.

| thing | value | variant | why |
|---|---|---|---|
| message status | `sent` | outline | the majority on any working install, so it recedes |
| | `sending`, `suppressed` | secondary | notable, not wrong |
| | `failed` | destructive | what you came to the page to find |
| | `queued`, `delivered` | outline | never written today; mapped so a future writer doesn't render blank |
| | `bounced` | destructive | never written today |
| enabled | enabled / disabled | outline / secondary | |
| credential protection | encrypted / plaintext | outline / secondary | see below |
| version | live / inactive | outline / secondary | |
| channel | any | none, plain text | a channel is a category, not a signal |

Credential protection deliberately doesn't use `destructive`. How much of an
install is plaintext depends on the deployment, and on the installs that most
need the warning, every row would be red and the colour would mean nothing. The
attention goes into one callout at the top of the providers page and the
overview's posture panel instead.

The copy never says "delivered" for `sent`. It says "Accepted by provider", and
wherever a single send is shown, "Herald doesn't receive delivery receipts, so
delivery isn't confirmed."

### Overview

A window switch (24h, 7d, 30d) over a status by channel table, headed "Accepted
by providers". Only statuses with rows appear as columns.

Beside it, the posture panel, which is the real content for most installs:

- Encryption: whether a key is configured, and how many credential values are
  still plaintext, with "Encrypt stored credentials" next to the count when a
  key exists, behind a confirm that says how many values will change.
- API: whether the REST API has auth configured.
- Fallback coverage: how many templates have no `""` version, with the note that
  a request in any locale they don't list will fail, linking to the templates
  list filtered to them. On a fresh install that's every shipped template,
  because they only have `en`.

### Providers

The list: Name (`font-medium`), Channel, Driver (mono), Priority, Credentials
("3 encrypted", "2 plaintext, 1 encrypted", or `NoneCell`), Status. The
caption carries the live count. When no key is configured, a callout above the
table says credentials are stored unencrypted and how to set a key.

Create and edit are driven by the driver schema from `engine.info`, with the
driver list filtered to the chosen channel. Secret fields are uncontrolled
password inputs (`autoComplete="new-password"`, no `value` attribute, read on
submit, cleared on success, kept on failure), exactly Vault's pattern. On edit,
a secret shows its protection and offers "Replace" and "Remove". There is no
"show". A driver with no schema falls back to key/value rows, with a checkbox
per row for "secret".

The detail page shows the summary, settings, credential protection per key,
`usedBy`, and "Send a test through this provider", which opens Send test with
the provider pinned. Delete confirms, and lists the routing entries that will
dangle.

### Templates

A `FilterBar` for channel, category and "no fallback version". Columns: Name,
Slug (mono), Channel, Category, Locales (a mono `TagList`, inactive ones
marked), Origin (system or custom), Status. "Reset system templates" sits
behind a confirm saying custom templates are kept and any edits to system
templates are lost.

The template workspace is described in its own section below.

### Messages

A `FilterBar` for channel and status. The status options are the four Herald
writes (sending, sent, failed, suppressed), and a line under the filter says
delivered and bounced are never recorded, so a filter for them would always be
empty. A cursor pager, adapted from `plugin-relay`. Columns: ID (mono),
Recipient (`font-medium`), Channel, Status, Template (mono slug), Provider,
Created (`Timestamp`).

Three empty states: no messages in this app at all, none matching the filters,
and (for a cursor page past the end) nothing further.

The detail page: a `DescriptionList` of every field, the text body with a note
that HTML bodies aren't logged and that bodies are cut at `truncateBodyAt`, the
error in a `<pre>`, metadata, the vendor message ID, and links to the template
and provider when they still exist. "Send a test to this recipient" opens Send
test prefilled with channel, recipient and template.

That link replaces the templ Retry button, deliberately. Retry re-sent the
stored subject and body as a raw message, and the stored body is the text part
only, truncated, with no template data, so a "retry" sent something different
from the original and then showed nothing when the provider failed.

### Inbox

A user ID input with a short debounce, then a cursor-paged table: Title, Type
(mono), Read, Created, Expires. Row actions mark one read or delete it; "Mark all
read" confirms. The templ page handled both row actions on the server and never
offered a button for either.

### Preferences

A user ID input, then the overrides matrix: a row per notification type (the
user's overrides plus `knownTypes`), a column per channel, each cell "Default",
"On" or "Opted out". Any cell that isn't opted out offers "Opt out", and the
confirm names the user, the type and the channel. There's no way back in, and
the page says why in one line.

### Routing

Scoped configs grouped by level (app, org, user): the provider chosen per
channel (dangling ones flagged), the from fields, and the stored-but-unused
default locale, labelled as such. Add, edit and delete in a dialog. Above them,
a "Who sends?" tester: pick a channel and optionally an org or user, and it
shows `send.resolve`'s answer and the step that chose it.

### Send test

A form: channel, then provider (optional; left empty it shows which one the
resolver would pick, and why), recipient, and either a template with a locale
and a variables form built from its declared variables, or a raw subject and
body. The template path shows the rendered preview inline, using the same
preview component as the workspace.

Sending opens a `ConfirmDialog` with `pending`, naming the provider, its driver,
the channel and the recipient, and "disabled" when the provider is. `reset()`
runs when the dialog opens.

The result card is honest about each outcome. `sent` reads "Accepted by Twilio
(`SM8f…`). Herald doesn't receive delivery receipts, so delivery isn't
confirmed." `failed` shows the provider's error verbatim in a `<pre>`.
`suppressed` explains the opt-out. `logged: false` adds that the message log
couldn't be written, so this send won't appear under Messages.

## The template workspace

This is the one surface that gets real design effort; every other page stays
quiet kit. Three tabs: Content, Variables, Settings.

```
┌ Password reset   auth.password-reset  email  system      [Review changes] [Save] ┐
├─ Locales ────────┬─ Editor ────────────────────────────┬─ Preview ─────────────────┤
│ en   Live        │ Subject [single-line editor]        │ Sample data (JSON)        │
│  answers en,     │ ┌HTML┐ Text   Title                 │ {"user_name":"Ada", …}    │
│  en-*            │ │ 12 ✕ {{ nosuch .x }}             │───────────────────────────│
│ fr   Inactive    │ │ …                                │ From / Subject header     │
│                  │ Problems (2)                        │ [sandboxed iframe]        │
│ Test a locale    │ ✕ html 12:5 function "nosuch" …     │ Rendered · Text · Source  │
│ [fr-CA]          │ ⚠ .expires_in used, not declared    │ SMS: 1 segment, GSM-7     │
│ fr-CA → fr ✗     │                                     │  143 / 160                │
│  → default ✗     │                                     │ Remote images off [load]  │
│  → fails         │                                     │                           │
│ + Add locale     │                                     │                           │
└──────────────────┴─────────────────────────────────────┴───────────────────────────┘
```

Below a medium width the three columns stack: locales, then editor, then
preview.

### Locales

The left rail lists each version with Live or Inactive, and under each live one,
which requested locales it answers. Below the list, "Test a locale" takes any
locale and shows `templates.resolve`'s steps, ending in the version that answers
or "fails". That rail is how Herald actually picks content, and it's invisible
everywhere else: every shipped template has only `en`, so a `fr` request fails,
and this is where you find that out.

Each version has a Live / Inactive switch. The confirm says what will answer
that locale afterwards. "Add locale" opens a small dialog for the locale code.
Deleting a version confirms the same way.

There's no version-to-version diff. Herald keeps one version per locale per
template (a unique key), so versions are translations, not history, and a diff
between `en` and `fr` means nothing. The diff that does mean something is your
unsaved edits against what's saved, and that's "Review changes".

### Editor

CodeMirror 6, loaded lazily, at the versions `plugin-relay` and
`plugin-chronicle` already pin (`@codemirror/state ^6.7.6`, `view ^6.43.13`,
`language ^6.12.4`, `commands ^6.11.1`, `search ^6.7.2`, `merge ^6.12.2`),
adding `@codemirror/lang-html`, `@codemirror/lint` and
`@codemirror/autocomplete`. Monaco isn't justified: the language is HTML plus
Go template actions, and the playbook's numbers put Monaco at several times the
whole shell.

- The HTML field uses `lang-html`. Every field gets a decoration layer that
  marks `{{ … }}` actions, so they read as code inside prose or markup.
- Server diagnostics go into the gutter and underline through `lint`'s
  `setDiagnostics`, positioned from the 1-based line and character column. A
  parse error, which has no column, marks its whole line. Clicking a problem in
  the list moves the cursor there.
- Inside `{{ }}`, autocomplete offers `.variable` from the declared variables
  and the function names from `engine.info`.
- Fields are ordered by channel (email: subject, HTML, text; SMS: text; push
  and in-app: title, text; webhook and chat: subject, text). Fields the channel
  doesn't use fold under "Other fields" and stay editable.
- The theme reads kit tokens, like the existing editors.

"Review changes" opens `unifiedMergeView` from `@codemirror/merge`, one section
per changed field, against the saved version. Save is disabled with no changes.
Leaving the page with unsaved changes triggers the browser's `beforeunload`
prompt; the host has no navigation guard to hook, so an in-app link isn't
guarded, and the plan records that rather than faking one.

### Preview

`templates.render` runs 400ms after the last edit to the buffer or the sample
data. While a newer render is in flight, the previous output stays visible and
is marked as out of date, so you never read a preview of text you've already
changed without being told.

The sample data is a JSON editor prefilled from each declared variable's
default, or a placeholder for its type.

HTML output renders in `<iframe sandbox="" srcdoc="…">`. The empty `sandbox`
denies scripts, forms, popups and same-origin access, so rendered markup can't
touch the dashboard. The `srcdoc` opens with a CSP meta tag that allows inline
styles and `data:` images only, which blocks remote images by default: a
tracking pixel in a template would otherwise fire from the operator's browser.
"Load remote images" is an explicit toggle, per preview.

Above the frame, an email preview shows From and the rendered subject, the way a
mail client would. The Text and Source tabs show the text output and the HTML
source as plain text. SMS previews count characters and segments, detecting
GSM-7 against UCS-2 (160 or 70 per single message, 153 or 67 per part once it's
split), because a template that tips into two segments doubles its cost. Push
and in-app previews show title and body at the lengths platforms usually
truncate to, labelled as typical rather than exact.

### Variables

An editable table: name (mono), type, required, default, description, with
add, remove and reorder. It saves through `templates.update`. Unsaved variable
edits feed the preview straight away, through `templates.render`'s `variables`.

### Settings

Name, category, enabled, and delete. Slug and channel are shown and read only,
with a line saying why.

## Fixtures

`packages/fixture-server/herald-fixtures.mjs`, exporting
`createHeraldHandlers(FixtureError)` and `resetHerald()`, registered in
`server.mjs`'s `CONTRIBUTORS` with prefix `HERALD` and reset in
`handleReset`. `verify.mjs` gets `herald::` inputs in create-before-delete
order and spot checks.

The fixture models the fixed contract from spec 1, not today's behaviour:
`suppressed` exists, credentials carry protection markers, sends record a vendor
message ID, and one provider is plaintext while another is encrypted so both
states render. Every write visibly changes the next read. It keeps the
server's unhelpful answers too: an unknown ID from another app is `NOT_FOUND`.

`templates.render` in the fixture is an approximation and says so in the file
header. It substitutes `{{.name}}` from the data, reports unknown function names
against the real function list, and flags unbalanced `{{`. It is for building
the UI, not for trusting output. Real rendering is proven by the contract's Go
tests and the transport test, which run Herald's actual renderer. Nobody should
"fix" the fixture into a template engine.

## Retiring the templ dashboard

In the Herald repo, after the React side has been clicked through against the
fixture server and the shell:

1. Write `herald/MIGRATION.md` in Vault's shape: what you need to do, bugs found
   on the way, deliberately dropped, blocked, page by page, still open. Every
   templ page, column, badge, filter, empty state, action, widget, the settings
   panel and the manifest entries are accounted for as migrated, changed,
   dropped with a reason, or blocked. The inventory was taken while the pages
   still existed and is kept in the session's notes until then.
2. Confirm nothing else imports it:
   `grep -rn "herald/dashboard" --include='*.go'` across forgery. Today only
   `extension/extension.go` does.
3. Delete `dashboard/`, the `DashboardContributor` method and its imports, and
   run `go mod tidy` so the direct `a-h/templ` and `forgeui` requires go (they
   may stay indirect through forge's own `dashboard/auth`, which is forge's
   problem, and MIGRATION.md says so).
4. Prove it: `find . -name '*.templ'` prints nothing, and
   `go build ./... && go test ./...` pass.
5. Commit that alone.

Two templ items are dropped on purpose and MIGRATION.md gives the reasons: the
four widgets (the React host has no generic widget slot; the Overview page
replaces them, with counts that aren't capped at 1,000 rows) and Retry
(replaced, as above). The manifest's `searchable` capability was never
implemented and isn't carried over.

## Wiring and bundle

`apps/shell`: the import and the `plugins` array in `src/App.tsx`, the
workspace dependency in `package.json`, and an `@source` line in
`src/styles.css`. That file is untracked in git and belongs to the shell's
owners, so the plan edits it without committing it and says so.
`apps/example-next` wires only core, streaming and authsome today and stays that
way, matching Vault.

The shell's eager chunk must not grow by any CodeMirror code. After wiring,
build the shell into a scratch output directory with and without Herald
(removing the import, not just the array entry), grep the eager chunks for
`@codemirror`, `cm-editor` and `lang-html`, and append a dated Herald section
to `BASELINE.md` in the same format as Ledger's, touching nothing else in that
file. A test in the package, like Vault's `lazy-editor.test.ts`, asserts that
only the editor components import `@codemirror` and that the routes that use
them are `lazy`.

## Verification

Per package: `test`, `typecheck` and `lint` clean, and `pnpm -r test`. The
known unrelated failure in `packages/host/test/setup-screen.test.tsx` is left
alone.

Then run it. Start the fixture server and the shell and click through every
page: create a provider and see the list grow, replace a secret and confirm it
never appears in the page or the network response, break a template and see the
marker land on the right line, send a test and read the result, opt a user out
and confirm there's no way back. Screenshots go in the final report.

In Go: `go build ./... && go test ./...` and lint with a fresh cache, in the
Herald repo, before the templ deletion and after it.
