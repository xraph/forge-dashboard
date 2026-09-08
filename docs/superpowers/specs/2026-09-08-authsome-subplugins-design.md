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

| sub-plugin | contributor | routes | slots |
|---|---|---|---|
| organization | `organization` | `/organizations`, `/organizations/create`, `/organizations/:id` | `overview.widgets` |
| apikey | `apikey` | `/apikeys`, `/apikeys/create`, `/apikeys/:id` | `overview.widgets`, `user.detail.sections` |
| waitlist | `waitlist` | `/waitlist` | `overview.widgets` |
| consent | `consent` | `/compliance/consent` | `overview.widgets`, `user.detail.sections` |
| subscription | `subscription` | `/plans`, `/plans/:id` | `overview.widgets`, `org.detail.tabs`, `user.detail.sections` |
| password | `password` | `/auth/password` | none |

**organization** is the biggest, and it's the one that hosts slots of its own.
`/organizations/:id` renders `org.detail.sections` and `org.detail.tabs`;
`/organizations/create` renders `org.create.fields`. So the organization sub-plugin is both a consumer and a host, which is the case that proves the slot API is not secretly a special case for the core plugin.
Intents: `orgs.list`, `orgs.detail`, `orgs.create`, `orgs.update`, `orgs.delete`,
`orgs.members`, `orgs.removeMember`.

**apikey** lists, creates and revokes. Creation shows the secret exactly once, so you get a deliberate one-shot reveal panel and a copy button. The server will not answer it a second time, and an admin who closes that panel without copying has to mint a new key. `apikeys.list` filtered by user id is the
`user.detail.sections` contribution.

**waitlist** is the admin review queue: approve, reject, delete, plus
`waitlist.counts` behind the overview widget.

**consent** audits and revokes consent records app-wide, and shows one user's
consents on the user detail page.

**subscription** covers `/plans` and `/plans/:id` with archive and activate, and
`subscriptions.list`. See the gap section for what it can't cover.

**password** is `password.policy` read-only alongside the standard settings
panel, so an admin sees the effective hash algorithm next to the policy.

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
  contributions: { "settings.tabs": [{ id: "mfa", label: "MFA", namespace: "mfa" }] },
})
```

`settingsPanelFor` is one component in the core package, bound to a namespace.
It reads `settings.namespace` and renders kit's `settings-form` over whatever
comes back. This works because the settings surface is entirely schema-driven:
`SettingField` carries `inputType`, `options`, `validation`, `section`, `order`,
`isEnforced`, `canOverride`, `readOnly` and `sensitive`. The React side renders
descriptors and has no opinion about MFA.

Four of the eighteen also contribute a widget or a user section in the templ
dashboard (mfa, passkey, social, oauth2provider). Those are per-user factor and
provider lists, and they have no intents behind them. See the gaps.

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

Two sub-plugins ship templ pages with no contract intents behind them. The templ
dashboard reads their stores in-process; a React page has only the contract. So
these are blocked on Go work in the authsome repository, and the migration notes
have to say so rather than let somebody find out.

| surface | templ file | missing |
|---|---|---|
| SCIM directory list, detail, logs | `plugins/scim/dashui/scim_*.templ` | `scim` declares `intents: []` |
| SCIM org section and tab | `plugins/scim/dashui/org_*.templ` | as above |
| Invoices and invoice detail | `plugins/subscription/dashui/invoice*.templ` | no `invoices.*` intent |
| Coupons | `plugins/subscription/dashui/coupons_page.templ` | no `coupons.*` intent |
| Plan features | `plugins/subscription/dashui/features_page.templ` | no intent |
| Per-user MFA factors | `plugins/mfa/dashui/user_section.templ` | `mfa` declares `intents: []` |
| Per-user passkeys | `plugins/passkey/dashui/user_section.templ` | `passkey` declares `intents: []` |
| Per-user linked social accounts | `plugins/social/dashui/user_section.templ` | `social` declares `intents: []` |
| OAuth2 client widget | `plugins/oauth2provider/dashui/widget.templ` | `intents: []` |

Nine surfaces. Each needs an intent pair on the Go side (a list query, sometimes
a revoke command) and then a small React contribution. SCIM and subscription
billing are the substantial ones; the three per-user sections are a query each.

Until those exist, `scim` ships as a settings-only sub-plugin, and `subscription`
ships plans without billing. Both render, both are useful, and neither pretends
to be complete. The templ dashboard stays the answer for SCIM directory
management specifically, and that should be an explicit line in the retirement
checklist rather than a surprise.

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
