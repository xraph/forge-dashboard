# Authsome core plugin: every page the templ dashboard has

Status: approved, not implemented
Depends on: the plugin platform spec
Blocks: nothing (the sub-plugin spec can run alongside it once slots exist)

The goal is retirement. When this lands and the sub-plugin spec lands, there's
nothing the templ dashboard does that the React one cannot, and
`authsome/dashboard` can be deleted.

## The join key

`extension: "auth"`. Not "authsome", which is the app slug and the repository
name, and not the npm package name either. It's the Go contributor name in
`extension/contract/manifest.yaml`, and it is what the host looks up in the
capabilities response. Get it wrong and the whole plugin resolves to `hidden`,
silently, because a contributor the server never mentioned is an ordinary thing
for a shell to meet. The existing plugin already has this right and the tests
already pin it.

## What is there today, and what is missing

The plugin ships three pages (login, users, sessions) against nine intents. The
contract declares sixty-eight. Everything below is the difference.

## Context

The plugin declares both context dimensions from the platform spec:

```
app          apps.context -> currentApp, availableApps      apps.switch
environment  apps.context -> currentEnv, availableEnvs      environments.switch
```

The host renders the two switchers and clears the query store on a switch.
Nothing else in this plugin knows an app id exists, because the server resolves
it from the cookie on every handler.

## Pages

Twenty-three routes in four nav groups. Intents in brackets. If you're checking
this against the manifest, the count below excludes the eight the gate owns.

### Identity

- `/users` list, with search and pagination `[users.list]`. Row actions: ban,
  unban, delete, all through `confirm-dialog`, all invalidating through server
  meta, with no hand-written refetch `[users.ban, users.unban, users.delete]`
- `/users/create` `[users.create]`
- `/users/:id` detail, editable `[users.detail, users.update]`. Hosts
  `user.detail.sections`, so the MFA, consent and social plugins can each push a
  panel here. Also shows this user's sessions and devices inline
  `[sessions.list, devices.list]`, both filtered by user id
- `/sessions` list with revoke and bulk revoke
  `[sessions.list, sessions.revoke, sessions.bulkRevoke]`
- `/sessions/:id` `[sessions.detail]`
- `/devices` list with trust and delete `[devices.list, devices.trust, devices.delete]`
- `/devices/:id` `[devices.detail]`
- `/roles` list with create and delete `[roles.list, roles.create, roles.delete]`
- `/roles/:id` detail with permissions, and assign/unassign
  `[roles.detail, roles.update, roles.assign, roles.unassign]`

### Configuration

- `/apps` list `[apps.list, apps.delete]`
- `/apps/create` `[apps.create]`
- `/apps/:id` `[apps.detail, apps.update]`
- `/environments` list, with clone and set-default
  `[environments.list, environments.create, environments.clone,
  environments.setDefault, environments.delete]`
- `/environments/:id` `[environments.detail, environments.update]`
- `/webhooks` list and detail in one page, with an events multi-select
  `[webhooks.list, webhooks.detail, webhooks.create, webhooks.update,
  webhooks.delete]`
- `/signup-forms` `[formConfigs.list]`
- `/signup-forms/edit` field editor: add, remove, reorder, toggle required
  `[formConfigs.signup, formConfigs.saveSignup, formConfigs.deleteSignup]`
- `/settings` namespace index `[settings.namespaces]`, plus the tabs
  contributed by sub-plugins through `settings.tabs`
- `/settings/:namespace` the generic panel `[settings.namespace, settings.update,
  settings.enforce, settings.unenforce]`

### Security

- `/credentials` `[credentials.detail]`. Publishable key with a copy button, and
  the app and environment it belongs to
- `/features` the sign-in methods panel `[auth.featureToggles, auth.toggleFeature]`.
  One command per changed toggle, not a bag. Rows where `available` is false
  render disabled with the reason, which is how an admin learns that MFA is off
  because the plugin isn't installed rather than because somebody turned it off

### System

- `/` overview. Four counters `[overview.stats]`, recent signups
  `[overview.recentSignups]`, and `overview.widgets` underneath, so any installed
  plugin can add its own card
- `/plugins` installed plugins. See the gap below

### Sign-in belongs to the gate, not to this plugin

An earlier version of this spec kept `/login` here as an unlisted route. It does
not. The auth-gate spec puts sign-in behind an `AuthGate` in the host, so
authsome drops `/login` from `nav` and from `routes` both, and the sign-out
action moves into the `NavUser` footer dropdown that already exists.

Eight intents go with it: `auth.login`, `auth.logout`, `auth.config`,
`auth.signup`, `auth.forgotPassword`, `auth.resetPassword`, `auth.setupStatus`
and `auth.setup`. The last two because first-run setup is a pre-auth screen for
the same reason sign-in is.

`AuthLoginPage` and its tests move, they don't get deleted. The component is
correct. It's in the wrong package.

What stays here is `auth.dynamicConfig`, and this paragraph used to be wrong
about it. It said `auth.dynamicConfig` and `auth.dynamicRegister` back OAuth
dynamic client registration. They do not. The handlers' own header comment puts
them in the pre-auth bucket alongside `auth.signup`, and both read the same
`formconfig.FormConfig` row the signup form editor already edits. There is no
client, no client id and no client secret anywhere in the flow.

`auth.dynamicConfig` gets a read-only page under `/settings` with no nav entry,
showing what an unauthenticated visitor will be asked for. That is genuinely
useful next to the signup form editor.

`auth.dynamicRegister` gets no admin UI at all. It creates a real account in the
user table and writes that account's session cookie over the caller's, so a
"test registration" button in an admin dashboard signs the admin out, signs them
in as an account they just made, and leaves a junk user in production. It is a
sign-in surface intent and it belongs to the signup form.

## The /plugins gap

The templ dashboard's `/plugins` page lists all twenty-five installed authsome
plugins and their status. There is no intent for that. The closest is
`auth.featureToggles`, which covers nine features, and the two are not the same
list: `geoip`, `scim`, `riskengine` and the rest have no toggle.

So `/plugins` gets built against `auth.featureToggles` and shows nine rows, and
the page says plainly that it shows sign-in methods and not the full
plugin inventory. Closing the gap properly needs a new `plugins.list` intent on
the Go side, which is a change to the authsome repository and out of scope here.
This is the one place where the React dashboard is knowingly behind the templ
one, and it belongs in the migration notes.

## Forms

Create and edit forms use kit's `field` primitives with client-side validation
mirroring what the handlers enforce, and they surface server validation errors
against the field the server named. Optional-field updates go out as pointer
semantics: the Go inputs use `*string` and `omitempty` throughout, so an
unchanged field must be absent from the payload rather than sent as an empty
string. Send `""` for a name you didn't touch and you rename the app to nothing.

## Testing

Every page: loading, error, empty, populated. Every command: the failure path,
asserting the server's message reaches the operator, because a failed write is
usually the server saying something true about what was just attempted.

Specific tests worth naming:

- optional-field updates omit untouched fields rather than sending empty strings
- a ban invalidates through `meta.invalidates` with no `refetch()` in page code
- `/users/:id` renders sub-plugin sections, and renders fine with none
- feature toggles disable rows where `available` is false
- the two context switchers appear, and switching clears the store
- no route in this plugin renders sign-in, and `nav` contains no `Sign in` row

## Package layout

Stays `packages/plugin-authsome`. Pages under `src/pages/`, one file per route,
shared bits under `src/components/`. `src/components/query-view.tsx` is deleted
and its callers move to kit's `query-boundary`. `src/pages/login.tsx` leaves for
wherever the auth-gate spec puts it.

## Sequencing

Two specs edit `packages/plugin/src/types.ts` and `packages/plugin/src/client.ts`:
this family adds `context?` and the sub-plugin fields, the auth-gate spec adds
`auth?` and `onUnauthenticated`. The platform spec lands first, so those files
settle once and the gate is built on a finished client. That also means the 401
path flows through the query store by construction, which is the outcome both
specs want.
