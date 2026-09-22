# Retiring the templ dashboard: what moved, and what didn't

This ships with the plugin rather than living in `docs/`, which is gitignored
as working notes. This is not a working note. It is for whoever decides to
switch the legacy dashboard off, and they will not have the planning
repository in front of them.

Read this before you switch the templ dashboard off. It tells you what the
React dashboard covers, what it doesn't, and why. The short version is that
user and tenant administration is done, and billing and SCIM directory
management are not.

## What you get

Twenty-four routes in the core plugin, plus twenty-four sub-plugins that appear
only when their Go contributor does.

Users, sessions, devices, roles, apps, environments, webhooks, signup forms,
settings, an overview, credentials and a feature-toggle page. Organizations,
API keys, the waitlist queue, consent records, plans and the password policy.
And eighteen plugins whose entire dashboard surface is a settings panel: MFA,
passkeys, social login, SSO, SCIM, the risk engine, geofencing and the rest.

Every one of those eighteen renders through one component bound to a namespace,
which works because the settings surface is entirely schema-driven: the Go side
sends a field descriptor carrying an input type, options, validation, a
section, an order and whether the value is enforced or read-only or sensitive,
and the React side renders descriptors without having an opinion about MFA or
geofencing or anything else. Add a field in Go and it appears in the dashboard.
Nobody touches React. You can ship a new setting on the server alone.

## What stays in templ

Fourteen surfaces have no contract intent behind them. The templ dashboard
reads its plugin stores in-process, which is the whole reason it can render
them, and a React page has only the contract to work with, so none of these can
be built until somebody adds the intents on the Go side. They're grouped below
by how much work that actually is.

### Billing

Invoices, invoice detail, coupons and the feature catalog have no intents at
all. Neither does subscription lifecycle: create, pause, resume, cancel and
change-plan are HTMX form posts handled directly in `dashboard.go`. Neither
does plan editing: pricing, tiers, features and plan info are the same. The
subscription plugin registers five intents and ships an entire billing product
on top of them.

So `/plans` lists plans and `/plans/:id` reads one, with archive and activate
as the only writes on the page. There's no editor, deliberately: a pricing form
with nothing to submit to would be worse than no form at all. The plans page
carries a line pointing at the templ dashboard for invoices, coupons and
subscription changes, because an operator who finds Plans in the new dashboard
and concludes billing has moved will go looking for invoices and find nothing.
Do not switch that one off.

### SCIM directory management

The `scim` plugin declares `intents: []` and ships a full standalone UI: a
config list, a config detail page with token generation and revocation, a
provisioning log, an org section, an org tab and an overview widget. All of it
reads stores directly. In React, `scim` is a settings panel and nothing else.

### Three per-user sections

MFA factors, passkeys and linked social accounts each show up on the templ user
detail page, and all three plugins declare `intents: []`, so a React user
detail page cannot show any of them. Each one needs a single query on the Go
side and a small React contribution after that, which makes these three the
cheapest work on the whole list.

### Two more that look small and are not

The `sso` plugin ships an org section listing an organization's SSO
connections, and it has no intent behind it. The API key user section is
blocked for a subtler reason worth spelling out, because the design doc
originally claimed it worked: `apikeys.list` takes no input at all, and
`APIKeySummary` carries no `userId`, so there is nothing to filter on and no
way to ask the question. Finding one user's keys would mean an
`apikeys.detail` call for every key in the account.

### Organization invitations and member role changes

These are the frustrating ones, because the Go code is already written and
working. `organization/service.go` implements `CreateInvitation`,
`ListInvitations`, `AcceptInvitation`, `DeclineInvitation` and
`UpdateMemberRole`, and not one of them is registered with the dispatcher, so
the contract has no idea they exist. The org detail page's Members tab carries
a line saying invitations are managed in the legacy dashboard, which is there
because an operator who sees an empty section concludes there are no pending
invitations.

## What the React dashboard has that templ doesn't

An app-wide consent list, with filtering and cursor paging. The templ
`/compliance/consent` page is a card telling you that consent data lives on
user detail pages, and it has no table at all, so this one is new functionality
rather than a port.

Waitlist delete, and approval and rejection notes. The templ page offers none
of the three, though the contract has carried all of them the whole time.

A settings panel over every namespace, instead of a hand-written panel per
plugin. Twenty-five plugins, one component.

## Three things that will trip you up

### The API keys route changed

Legacy `dashboard.go` registers `/api-keys` with a hyphen, under a group called
Developer. The contract manifest says `/apikeys` with no hyphen, under
Security. The manifest wins, because that is what the capabilities response is
built from, and if you type the old path from memory you'll get a 404.

Organization and waitlist moved groups too, from Authentication to Identity and
Compliance. Nothing breaks. You'll just look in the wrong place for a while.

### Four stat cards on the organization list are gone

The templ page shows Organizations, Members, Teams and Invitations, all four
computed in-process from stores the contract does not expose. Only the first is
reachable, and it is the length of the array `orgs.list` already returns. The
other three are not faked from anything, since a number invented on the client
would be wrong in a way nobody could check.

### The hash algorithm on the password page is a constant

`password.policy` returns a `hashAlgorithm` field, and the Go handler hardcodes
the string `"argon2id"` without reading engine config at all, so it tells you
what the binary was built to do and not what the running system is doing. The
page labels it "as compiled" for that reason. Do not make a decision on it.

## Dynamic signup is not OAuth client registration

The design spec for this work claimed `auth.dynamicConfig` and
`auth.dynamicRegister` back OAuth dynamic client registration. They don't. The
handlers' own header comment puts them in the pre-auth bucket alongside
`auth.signup`, and both read the same `formconfig.FormConfig` row the signup
form editor already edits. There is no client, no client id and no client
secret anywhere in the flow.

`auth.dynamicConfig` has a read-only page at `/signup-forms/dynamic`, showing
what an unauthenticated visitor will be asked for.

`auth.dynamicRegister` has no admin UI, on purpose. It creates a real account
in the user table and writes that account's session cookie over the caller's,
so a "test registration" button here would sign the admin out, sign them in as
an account they had just made, and leave a junk user in production. There is a
test asserting no such control exists.

## Consent can be revoked here, and not granted

`consent.grant` is a real intent and this dashboard deliberately has no form
for it. Revoking somebody's consent on their behalf is an administrative
correction. Granting it on their behalf is not: it manufactures a record
saying a person agreed to something, in a product whose consent log exists to
prove exactly that. The legacy dashboard offers no such form either, so
nothing is lost by leaving it out.

If a real need turns up, say a support agent recording consent given over the
phone, it should capture who recorded it and why, and that is a different
feature from a button next to a table row.

## There's no reset to default in settings

You can set a setting and you cannot unset it. `settings.update` passes its
value straight through to `Manager.Set` with no null check anywhere in the
path, so sending null stores a literal null as the override rather than
clearing it and falling back to the inherited default. The `Delete` method that
would clear one is implemented in Go. No intent reaches it.

So the settings pages offer no reset control anywhere, and there is a test
asserting that none appears, because a Reset to default button is exactly the
kind of thing somebody adds in good faith six months from now. If you want one,
it is a single intent on the Go side.

## Where that leaves you

Turn off the templ dashboard for user and tenant administration. Keep it
running for billing and for SCIM directory management, and keep it in the
deployment until somebody registers those intents. Everything else either
works, or tells you on screen why it doesn't.
