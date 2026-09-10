# Authsome sub-plugins: twenty-four contributors, one package

Status: approved, not implemented
Depends on: the plugin platform spec (slots), the authsome core spec (host pages)

Twenty-four authsome plugins contribute dashboard UI today. Six carry real data
of their own. Eighteen are a settings panel and a nav entry. This spec covers
all of them, plus the honest list of what can't be built yet.

## Packaging

One package, `packages/plugin-authsome`, exporting the core plugin and every
first-party sub-plugin. Each sub-plugin gets its own entry in the package
`exports` map, so a consumer who wants Organizations but not Waitlist can import
what they want.

Seven packages was the alternative and it buys nothing here. These ship and
version together with the Go repository they mirror. The extension point itself
is public in `@forge-go/dashboard-plugin`, so a third party can still write and
publish an authsome sub-plugin without touching this package, which is the
property that actually matters.

## Nav placement comes from Go

Every sub-plugin manifest already declares its route, group, icon and priority:

```yaml
graph:
  - route: /apikeys
    nav: { group: Security, icon: key, priority: 1 }
```

Those are the source of truth and the React sub-plugins copy them exactly.
Groups in use: Identity, Security, Auth, Compliance, Enterprise, Configuration.
Getting one wrong breaks nothing. It just puts API Keys under the wrong heading, which is the kind of thing nobody notices for a year.

## The six with data

Checked against the Go manifests and handlers after this spec was approved. Four
of the claims below are corrections, and one of them removes a surface this spec
promised.

| sub-plugin | contributor | routes (nav group / icon / priority) | slots |
|---|---|---|---|
| organization | `organization` | `/organizations` (Identity / users / 2), `/organizations/create`, `/organizations/:id` | `overview.widgets` |
| apikey | `apikey` | `/apikeys` (Security / key / 1), `/apikeys/create`, `/apikeys/:id` | `overview.widgets` |
| waitlist | `waitlist` | `/waitlist` (Compliance / clock / 1) | `overview.widgets` |
| consent | `consent` | `/compliance/consent` (Compliance / shield-check / 0) | `overview.widgets`, `user.detail.sections` |
| subscription | `subscription` | `/plans` (Configuration / package / 2), `/plans/:id` | `overview.widgets`, `org.detail.tabs`, `user.detail.sections` |
| password | `password` | `/auth/password` (Auth / lock / 0) | none |

Only the listed routes carry nav. Detail and create routes declare none, which
is why they never appear in the sidebar and are reached from their list page.

The legacy `dashboard.go` nav disagrees with these manifests in three places:
organization sits under "Authentication" there, waitlist under "Authentication"
at priority 5, and apikey under "Developer" at a different path entirely,
`/api-keys` with a hyphen. The manifest is the contributor system's own
declaration and the React side follows it. The hyphen matters: a route typed
from memory off the old dashboard will 404.

**organization** hosts slots of its own. `/organizations/:id` renders
`org.detail.sections` and `org.detail.tabs`; `/organizations/create` renders
`org.create.fields`. So it is both a consumer and a host, which is the case that
proves the slot API is not a special case for the core plugin. Its detail page
has exactly two built-in tabs, Overview and Members, and contributed tabs render
after them.

Intents: `orgs.list`, `orgs.detail`, `orgs.create`, `orgs.update`, `orgs.delete`,
`orgs.members`, `orgs.removeMember`. Seven, no more. Neither `orgs.list` nor
`orgs.members` pages at all: both answer the whole array, with no cursor, no
limit and no total. So the org list is the one place in this package that does
not need the cursor pager, and adding paging controls to it would be inventing
a server behaviour that does not exist.

`orgs.update` takes `name` and `logo` as `*string`. Absent means leave alone;
an empty string is a real value that clears the field. The Go plugin also
implements invitations and member role changes, and none of it is wired to the
dispatcher, so invite and role-change UI is blocked.

**apikey** lists, creates and revokes. There is no delete. An earlier draft of
this spec asked whether revoke and delete were different operations, and the
answer is that delete does not exist: revoke sets a flag, and the templ UI drops
the action entirely once a key is revoked.

Creation shows the secret exactly once. `CreateAPIKeyResponse` carries
`{ ok, id, keyPrefix, secret }`, the stored row keeps only a hash, and
`APIKeySummary` and `APIKeyDetail` have no secret field at all. So the one-shot
reveal panel is not a UI convention being polite about a value it could refetch.
The value is gone. An admin who closes that panel without copying mints a new key.

`apikeys.create` requires a `userId`, so the create form needs a user to attach
the key to rather than defaulting to the operator.

**The `user.detail.sections` contribution for apikey is blocked, and this spec
previously said it was not.** It claimed `apikeys.list` filtered by user id.
`apikeys.list` takes no input at all, and `APIKeySummary` does not carry a
`userId`, so there is nothing to filter on. Getting the owner of each key means
one `apikeys.detail` call per key. That is not a section, it is a fan-out, and
it goes on the blocked list.

**waitlist** is the admin review queue. Six intents: `waitlist.list`,
`waitlist.detail`, `waitlist.approve`, `waitlist.reject`, `waitlist.delete` and
`waitlist.counts`, which answers exactly `{ pending, approved, rejected }`.
`waitlist.list` pages by cursor and takes `{ email?, status?, cursor?, limit? }`.
Approve and reject both take an optional `note`, and the templ UI offers neither
a note field nor a delete button, so the React page is a superset of it.

**consent** has four intents, and two of them are the same handler:
`consent.list` and `consent.userConsents` are registered to one function and are
wire-identical, differing only in name. Both take
`{ userId?, purpose?, cursor?, limit? }`.

`consent.revoke` does not take a record id. It takes `{ userId, purpose }` and
matches on that composite, scoped to the caller's app server-side. So a revoke
button on a row sends the row's user and purpose, not its id, even though the
row carries an id. `consent.grant` also exists and this spec did not mention it.

The templ `/compliance/consent` page is not a data page: it renders a card
saying consent data lives on user detail pages. So the app-wide consent list is
new, and worth building, but it is a gain over the legacy dashboard rather than
a port of it.

**subscription** covers `/plans` and `/plans/:id` with archive and activate, plus
`subscriptions.list`, which requires a `tenantId` and quietly answers an empty
list when given none. Five intents total.

Everything else in the legacy billing UI posts to form handlers that never reach
the dispatcher. Invoices, coupons and the feature catalog have no intents.
Neither does subscription lifecycle: create, pause, resume, cancel and change
plan are all form posts. Neither does plan editing: pricing, tiers, features and
plan info are all form posts against `plans.detail`'s own page. So `/plans/:id`
is a read-only detail page with two buttons, and the templ dashboard stays the
answer for billing.

**password** is `password.policy`, read-only, answering
`{ minLength, requireSpecial, hashAlgorithm }` alongside the standard settings
panel. Two things about it. `hashAlgorithm` is hardcoded to `"argon2id"`
server-side and does not read engine config, so it is a label rather than a
fact. And the legacy page shows an allowed-domains list that the intent does not
return; that comes straight from settings in the templ render path, so the React
page reads it from the settings namespace or not at all.

## The eighteen settings-only

anomaly, deviceverify, email, geofence, geoip, impossibletravel, ipreputation,
magiclink, mfa, notification, oauth2provider, passkey, phone, riskengine, scim,
social, sso, vpndetect.

Each is a declaration, not a component:

```ts
defineSubPlugin({
  extension: "mfa",
  host: "auth",
  label: "Multi-Factor Auth",
  nav: [{ label: "Multi-Factor Auth", to: "/auth/mfa", group: "Auth", priority: 4 }],
  routes: [{ path: "/auth/mfa", element: settingsPanelFor("mfa") }],
  hostIntents: SETTINGS_INTENTS,
  contributions: {
    "settings.tabs": [{ id: "mfa", label: "MFA", render: settingsPanelFor("mfa") }],
  },
})
```

Note what the contribution carries. An earlier draft of this spec wrote
`namespace: "mfa"` on the contribution object, which `SlotContribution` has no
field for and `defineSubPlugin` would have accepted silently on its way to
rendering nothing. A contribution is `{ id, label, priority, render }` and the
namespace binding lives inside the component `settingsPanelFor` returns.

`settingsPanelFor` is one component in the core package, bound to a namespace.
It reads `settings.namespace` and renders kit's `settings-form` over whatever
comes back. This works because the settings surface is entirely schema-driven:
`SettingField` carries `inputType`, `options`, `validation`, `section`, `order`,
`isEnforced`, `canOverride`, `readOnly` and `sensitive`. The React side renders
descriptors and has no opinion about MFA.

Six of the eighteen contribute something beyond the panel: mfa, passkey, social,
oauth2provider, sso and scim. The first draft of this spec said four and left
out sso, whose `org_section.templ` lists an organization's SSO connections, and
undercounted scim, which also ships an overview widget. All six still declare
`intents: []`, so every surface that needs data of its own is blocked.

Three of their widgets are not blocked, because they carry no data at all. The
mfa, passkey and oauth2provider tiles are static cards in templ, taking no
parameters and reading nothing: "MFA Enabled", "Passkeys / Enabled", "OAuth2
Clients / Active". A React contribution can render those today. Whether it
should is a separate question, and the answer here is no: a tile that always
says the same thing is furniture, and the overview is better without it.

The social and sso widgets take a list of configured provider names. That is
settings data, not a query of its own, so it is reachable through the settings
host intent the eighteen already declare. Confirm the field name against the
namespace response at implementation time rather than assuming one.

Every manifest declares its namespace equal to its contributor name, verified
across all eighteen. That makes binding the panel by contributor name safe, but
it is manifest convention rather than a schema invariant, so the binding stays
an explicit string per sub-plugin instead of being derived.

## hostIntents

The platform spec defines this; here's what uses it. A settings-only sub-plugin
declares zero intents of its own, and its panel reads `settings.namespace` and
`settings.update`, which belong to the **auth** contributor. The eighteen of
them declare exactly four host intents and can reach nothing else:

```ts
const SETTINGS_INTENTS = [
  "settings.namespace", "settings.update", "settings.enforce", "settings.unenforce",
]
```

The scoping guarantee survives, because the widening is declared, narrow and
readable at the call site. What it stops is a sub-plugin quietly reading
`users.list` through its host. The contributor name still isn't a parameter
anywhere, and the allowlist is validated at import time like everything else in
`definePlugin`.

The `extension` field still does the presence gating: no `mfa` contributor in
the capabilities response means no nav entry and no settings tab, which is
exactly the behaviour an admin expects when the plugin isn't installed.

## What can't be built yet

Some sub-plugins ship templ pages with no contract intents behind them. The
templ dashboard reads their stores in-process; a React page has only the
contract. So these are blocked on Go work in the authsome repository, and the
migration notes have to say so rather than let somebody find out.

The list below is longer than the first draft of this spec claimed, and the
subscription entry in particular is much longer. That plugin registers five
intents and ships an entire billing product.

| surface | templ file | missing |
|---|---|---|
| SCIM directory list, detail, logs | `plugins/scim/dashui/scim_*.templ` | `scim` declares `intents: []` |
| SCIM org section and tab | `plugins/scim/dashui/org_*.templ` | as above |
| SCIM overview widget | `plugins/scim/dashui/overview_widget.templ` | as above |
| Per-user MFA factors | `plugins/mfa/dashui/user_section.templ` | `mfa` declares `intents: []` |
| Per-user passkeys | `plugins/passkey/dashui/user_section.templ` | `passkey` declares `intents: []` |
| Per-user linked social accounts | `plugins/social/dashui/user_section.templ` | `social` declares `intents: []` |
| Organization SSO connections | `plugins/sso/dashui/org_section.templ` | `sso` declares `intents: []` |
| Per-user API keys | `plugins/apikey/dashui/user_section.templ` | `apikeys.list` takes no filter and its summary has no `userId` |
| Invoices and invoice detail | `plugins/subscription/dashui/invoice*.templ` | no `invoices.*` intent |
| Coupons | `plugins/subscription/dashui/coupons_page.templ` | no `coupons.*` intent |
| Feature catalog | `plugins/subscription/dashui/features_page.templ` | no `features.*` intent |
| Subscription lifecycle: create, pause, resume, cancel, change plan | `plugins/subscription/dashui/subscription*.templ` | form posts only, no intents |
| Plan editing: pricing, tiers, features, plan info | `plugins/subscription/dashui/plan_detail.templ` | form posts only, no intents |
| Organization invitations and member role changes | `plugins/organization/dashui/org_detail.templ` | implemented in Go, never wired to the dispatcher |

The oauth2provider client widget came off this list. That tile takes no
parameters and reads nothing, so it is not blocked, just not worth building.

Two of these are cheaper than they look. The organization invitations and
member-role surfaces already exist in `organization/service.go` as
`CreateInvitation`, `ListInvitations`, `AcceptInvitation`, `DeclineInvitation`
and `UpdateMemberRole`. Nothing is missing but the dispatcher registration. The
three per-user sections are a query each.

The rest is real work. SCIM directory management and subscription billing are
whole products, and neither should be rushed onto a contract surface to make a
migration checklist look finished.

Until those exist, `scim` ships as a settings-only sub-plugin, `subscription`
ships plans without billing, `apikey` ships without its user section, and
`organization` ships without invitations. Everything renders, everything is
useful, and nothing pretends to be complete. **The templ dashboard stays the
answer for SCIM directory management and for billing**, and that belongs on the
retirement checklist as an explicit line rather than as a surprise.

## Testing

Per sub-plugin: absent contributor renders nothing, present contributor renders
nav and route, and slot contributions land in the host page.

Across sub-plugins, three tests matter more than the rest:

- a sub-plugin's query carries its own contributor on the wire, not its host's
- a sub-plugin reading a host intent outside `hostIntents` throws at import
- one sub-plugin throwing during render loses only its own slot entry, with the
  host page and every sibling contribution still on screen

The eighteen settings-only plugins share one parameterised test, because they
share one component. Writing eighteen near-identical suites would be volume, not
coverage.
