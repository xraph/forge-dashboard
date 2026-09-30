# Keysmith dashboard migration

Keysmith's dashboard moves from server-rendered templ onto the React shell, and
the templ dashboard is deleted once the React side has been run in a browser.
The work spans two repositories:

- `forgery/keysmith`: domain fixes, a new `extension/contract` package, and
  finally the removal of `dashboard/`.
- `forge-dashboard`: a new `packages/plugin-keysmith`, its fixture, and the
  shell wiring.

Read `packages/plugin/PLAYBOOK.md` first if you are picking this up. Most of
the decisions below exist because a rule in there applied.

## What we found before designing anything

Keysmith mints secrets, so the first job was tracing every path a raw key can
take out of the engine. There are four that matter.

1. `CreateKey` returns `CreateResult.RawKey`. REST `POST /keys` passes it on.
2. `RotateKey` returns a second one-time secret through the same struct, and
   REST `POST /keys/:id/rotate` passes that on too.
3. `FireKeyValidationFailed(ctx, rawKey, err)` hands the presented key to every
   plugin. At `engine.go:154` it does this for a key that was found but is
   inactive, so it's a real key. The built-in plugins ignore the argument. A
   third-party plugin gets it.
4. authsome's `bridge/keysmithadapter` returns `RawKey` to authsome.

`Hint` also keeps the last four hex characters in plaintext, which is normal
and is what the dashboard uses to name a key.

The templ dashboard's rotate action called `RotateKey` and threw the result
away. Because rotation also killed the old key on the spot (below), rotating
from the old dashboard left a key nobody could ever use again, behind a
confirm dialog that promised "the old key will enter a grace period".

We ran the engine against the memory store to confirm the worst of it rather
than trust a reading of the code:

```
rotation: old key err=keysmith: invalid API key | new key err=<nil> | key state=active | grace_ends in 168h0m0s
revoke: after revoke err=keysmith: key is not active | suspend err=<nil> | reactivate err=<nil> | validate err=<nil> | state=active revoked_at=true
aggregate rows (memory): 0
```

So, in order of severity:

- Revocation is reversible. `SuspendKey` has no state guard, so if you revoke
  a key, suspend it and then reactivate it, the key validates again with
  `revoked_at` still set, and because Warden's role was removed at revoke and
  is never given back, the resurrected key doesn't even match its own
  permissions.
- Rotation has no grace window. `RotateKey` overwrites `KeyHash` on the same
  row and keeps the old hash only in `rotation.Record.OldKeyHash`, which
  nothing reads. `StateRotated` is never assigned, so the grace branch in
  `ValidateKey` can't run. `TestRotateKey` asserts the immediate failure,
  which pins the contradiction in place.
- `CleanupGraceExpired` is dead, and fixing it naively would be worse.
  `ListPendingGrace` returns records with `grace_ends > now`, then the loop
  requires `now.After(GraceEnds)`, so it never acts; correct the filter and it
  revokes `rec.KeyID`, which by then is the row holding the new key.
- Key create can orphan a key. The row is written before scopes are assigned,
  so on postgres a missing scope fails the assignment, you get an error and no
  raw key, and an active key nobody holds stays behind. The memory store
  accepts any scope name, so you'll never see this locally.
- Usage aggregation is always empty. Nothing writes `keysmith_usage_agg` on
  any backend, and the memory store returns `nil`. Usage is only recorded when
  your application calls `RecordUsage` itself, since the middleware never does.
- Most of a policy is decoration. Only `MaxKeyLifetime` (at create) and
  `RateLimit` do anything, and `RateLimit` only when a `RateLimiter` has been
  injected, which none ships and the extension never does. Burst, allowed
  scopes, IPs, origins, methods, paths, rotation period and both quotas are
  stored and never checked. There's no scheduler either, so "scheduled
  rotation" does not exist.
- Scope parents are stored and never used. `RequireScopes` matches exact
  names.
- Nothing checks a tenant by ID, and an empty tenant means every tenant. Get,
  rotate, revoke, suspend and reactivate take an ID and never look at the
  tenant, and every backend treats an empty `TenantID` in a list filter as no
  filter at all. The templ pages set no tenant, so they showed you every
  tenant's rows.

The extension's own tests are thin: eight `_test.go` files. `engine_test.go`
has 14 tests against memory only. The memory store has 27. Postgres has four
tests of nil-to-empty conversion with no database. Nothing tests the postgres,
sqlite or mongo stores, `api/`, `middleware`, `warden_hook`, `observability`,
`extension`, the cleanup functions, rate limiting, `MaxKeyLifetime`, state
transitions or tenant isolation.

## Decisions

These were settled one at a time with Rex on 2026-09-30.

### Fix the domain first (option A)

Each fix lands in keysmith as its own commit with tests before any handler
depends on it. The fixture models the fixed contract, not the shipped one. If
you compare the fixture with a keysmith older than these commits, it will
disagree on purpose.

### Tenant resolution follows Warden (option A)

`tenantFrom(principal, deps)`:

1. No user on the principal refuses with `PERMISSION_DENIED`. A default tenant
   exists for single-tenant deployments, not for anonymous requests.
2. A `tenant_id` claim that is present and a non-empty string wins.
3. A `tenant_id` claim that is present but empty, or not a string, refuses.
   It never falls through to the default, because a claim that failed to
   resolve answered with another tenant's rows is the bug this rule exists to
   stop.
4. No claim at all uses `Deps.DefaultTenantID`, from config
   `keysmith.dashboard.tenant_id`.
5. Nothing configured refuses with `PERMISSION_DENIED` and a message naming the
   config key.

`app_id` resolves the same way (claim, then `Deps.DefaultAppID`) but may end
up empty, because Keysmith never filters by app. It only labels new rows.

Every by-ID read and write loads the row first and answers `NOT_FOUND` when
its tenant differs from the resolved one. `NOT_FOUND`, not `PERMISSION_DENIED`,
so the dashboard does not confirm that an ID exists in someone else's tenant.

Handlers call the engine with `keysmith.WithTenant(ctx, appID, tenantID)`, so
`CreatePolicy` and `CreateScope`, which read the tenant only from context,
write the right one.

Nothing populates `Principal.Claims` today, so in practice step 4 or 5 runs on
every request. Rows written with an empty tenant (standalone use, authsome's
adapter) cannot be reached from the dashboard. `MIGRATION.md` says so and the
refusal message points at the config key.

### A real grace window, chosen per rotation (option A)

Engine:

- `RotateKey(ctx, id, reason, opts ...RotateOption)`. `WithGrace(d)` overrides
  the grace, `WithRotatedBy(s)` sets `RotatedBy`. Without `WithGrace`, the
  grace is the policy's `GracePeriod`, or 24h with no policy. Existing callers
  compile unchanged.
- `RotateKey` refuses a revoked or expired key with
  `ErrInvalidStateTransition`.
- `rotation.Record` gains `OldHint` and `NewHint`. Records written before this
  change have both empty, which the dashboard renders as "not recorded".
- `rotation.Store` gains `GetInGraceByOldHash(ctx, hash, now)` and
  `EndGrace(ctx, keyID, at) (int64, error)`, on all four backends, with an
  index on `old_key_hash`.
- `ValidateKey`: on a `GetByHash` miss, look up an in-grace rotation record by
  the presented hash, load its key, and validate that key as usual (state,
  expiry, rate limit, scopes). `ValidationResult` gains `ViaPreviousKey bool`
  and `GraceEnds *time.Time`, so a host can warn its callers.
- `Engine.EndGrace(ctx, keyID)` closes every open window on a key now.
- `RevokeKey` also ends every open window.
- The unreachable `StateRotated` branch goes. The constant stays, since it is
  exported.
- `CleanupGraceExpired` is removed. Expiry now happens at lookup, so there is
  nothing to sweep, and the method as written would revoke live keys if its
  filter were ever corrected.
- `TestRotateKey` changes to assert the new behaviour: the old key validates
  inside the window, fails after `EndGrace`, and fails at once with
  `WithGrace(0)`.

Dashboard: the rotate dialog has a reason and a grace. Grace defaults from the
policy. Picking `compromise` presets it to zero; the operator can still change
it. Two keys rotated inside one window leave two previous keys valid, each
until its own `grace_ends`, and the key detail lists both.

### Revocation is terminal

`SuspendKey` accepts only an `active` key. `RevokeKey` on a revoked key
returns `ErrInvalidStateTransition` so hooks do not fire twice. The contract
maps that error to `CONFLICT`: the dashboard's wire codes have no
`FAILED_PRECONDITION`. A regression test runs the exact
revoke, suspend, reactivate sequence above and asserts the key stays dead.

### Scopes are checked before the key row is written

`CreateKey` and `AssignScopes` both resolve every scope name with
`Scopes().GetByName(tenant, name)` before writing anything, and refuse with
`ErrScopeNotFound`. When the key has a policy with non-empty `AllowedScopes`,
a name outside it refuses with `ErrScopeNotAllowed`, which was defined and
never returned until now. The engine is the gate, so memory and postgres stop
disagreeing.

### Usage aggregates over raw rows (option A)

`usage.Store.Aggregate` is rebuilt on all four backends as a `GROUP BY` over
`keysmith_usage`: `date_trunc` on postgres, `strftime` on sqlite,
`$dateTrunc` on mongo, a loop in memory. Buckets are UTC.

- `Period` is `hourly`, `daily` or `monthly`. Anything else is an error.
- Each bucket carries `RequestCount`, `ErrorCount` (status 400 and up, as
  before) and a new `ServerErrorCount` (500 and up), plus `TotalLatency`.
- `P50Latency` and `P99Latency` become `*int64` and stay nil. sqlite has no
  percentile function and mongo only gained one in 7.0, so a value would mean
  different things per backend.
- A migration drops `keysmith_usage_agg`.

The REST `/usage` endpoints use the same method, so they start returning real
data as a side effect.

Not in scope: an opt-in `middleware.RecordUsage`. Recorded as unsurfaced.

### Policies say what enforces them (option A)

Every field stays editable. The editor and detail page group them:

| Group | Fields |
|---|---|
| Enforced by Keysmith | `max_key_lifetime` (at create), `allowed_scopes` (at assignment, new), `grace_period` (at rotation, now real) |
| Enforced only with a rate limiter | `rate_limit`, `rate_limit_window` |
| Stored for your application | `burst_limit`, `allowed_ips`, `allowed_origins`, `allowed_methods`, `allowed_paths`, `rotation_period`, `daily_quota`, `monthly_quota` |

The last group carries one line: Keysmith does not check these, and your
application can read them from `ValidationResult.Policy`.

`Engine.RateLimiterConfigured() bool` feeds the settings intent, and the
rate-limit group says whether this deployment has a limiter. Without one, the
group reads "not enforced here", whatever the policy's numbers are.

## The contract

`extension/contract` in keysmith, shaped like vault's: an embedded
`manifest.yaml`, `Register(d, reg, wreg, deps)`, one handler file per area, and
`Extension.RegisterContractContributor`. Contributor name `keysmith`.

`Deps`: `Engine *keysmith.Engine`, `DefaultTenantID`, `DefaultAppID`,
`Plugins []string` (registered hook plugin names, for settings), `Logger`.

Wire types are the contract's own projections, never the domain structs. Their JSON names are camelCase and timestamps are RFC3339 strings, as vault's and warden's are (`encryptionAlg`, `createdAt`). The domain structs' snake_case tags stay on the REST API. Durations are whole seconds (`graceSeconds`).

### Queries

| Intent | Request | Answers |
|---|---|---|
| `overview` | none | counts by state, open grace windows, keys expiring within 7 days, requests in the last 24h (`null` when no rows exist), 5 recent keys, 5 recent rotations |
| `keys.list` | `environment`, `state`, `policyId`, `limit`, `offset` | `items`, `total` |
| `keys.detail` | `id` | key, effective state, policy summary, scopes, open windows (`hint`, `graceEnds`) |
| `rotations.list` | `keyId?`, `reason?`, `limit`, `offset` | `items` with `oldHint`, `newHint`, window open or closed, `hasMore` |
| `policies.list` | `limit`, `offset` | `items`, `total` |
| `policies.detail` | `id` | policy, `keysUsing` (count and first page) |
| `scopes.list` | `limit`, `offset` | `items`, `hasMore` |
| `usage.series` | `keyId?`, `period`, `after`, `before` | buckets, every bucket present including empty ones |
| `usage.records` | `keyId?`, `after`, `before`, `limit`, `offset` | `items`, `total` |
| `settings` | none | plugins, store health, rate limiter configured, tenant source, enforcement table, default grace |

Paging is `limit` and `offset` everywhere, because that is what the stores
take. `total` is exact where a store has `Count` (keys, policies, usage).
Rotations and scopes fetch one extra row and answer `hasMore`.

"Effective state" is computed in the handler: an `active` key past
`expiresAt` answers `expired` with `expiryPending: true`, because the engine
only marks expiry when the key is next used. The stored state is still in the
response.

"Expiring within 7 days" uses `ListExpired(now+7d)`, which has no tenant
filter, then filters by tenant in the handler. That list is not paged, so the
filtered result is complete, not a window. It is the one post-filter in the
contract and it is safe for that reason.

### Commands

| Intent | Request | Invalidates |
|---|---|---|
| `keys.create` | `name`, `description`, `environment`, `prefix`, `policyId?`, `scopes`, `expiresAt?` | `keys.list`, `overview`, `policies.detail` |
| `keys.rotate` | `id`, `reason`, `graceSeconds?` | `keys.detail`, `rotations.list`, `overview` |
| `keys.endGrace` | `id` | `keys.detail`, `rotations.list`, `overview` |
| `keys.revoke` | `id`, `reason` | `keys.list`, `keys.detail`, `rotations.list`, `overview` |
| `keys.suspend` | `id` | `keys.list`, `keys.detail`, `overview` |
| `keys.reactivate` | `id` | `keys.list`, `keys.detail`, `overview` |
| `keys.scopes.assign` | `id`, `scopes` | `keys.detail`, `keys.list` |
| `keys.scopes.remove` | `id`, `scopes` | `keys.detail`, `keys.list` |
| `policies.create` | policy fields | `policies.list`, `overview` |
| `policies.update` | `id`, policy fields as pointers | `policies.list`, `policies.detail`, `keys.detail` |
| `policies.delete` | `id` | `policies.list`, `overview` |
| `scopes.create` | `name`, `parent?`, `description` | `scopes.list`, `overview` |
| `scopes.delete` | `id` | `scopes.list`, `keys.detail`, `overview` |

`createdBy` and `rotatedBy` come from the principal's subject, never from
the request.

Durations cross the wire as whole seconds (`rateLimitWindowSeconds`,
`graceSeconds` and so on). The REST API's `"30d"` strings stay on the REST
API.

`keys.create` and `keys.rotate` answer `{ key, rawKey }` and are the only
responses in the contract that carry a secret. No query type has a `rawKey`
field. A Go test marshals every query response type and asserts none of `rawKey`,
`raw_key`, `keyHash` or `key_hash` appears.

`policies.delete` on a policy in use answers `CONFLICT` with the number of
keys using it.

## The React plugin

`packages/plugin-keysmith`, `extension: "keysmith"`, `namespace: "keysmith"`,
label "API keys". Nav group "API keys": Overview, Keys, Policies, Scopes,
Rotations, Usage, Settings.

### The one-time secret

One component, `OneTimeKeyDialog`, serves create and rotate.

1. The form opens in a dialog. Create collects name, description, environment,
   prefix (mono, with a live preview like `sk_live_…`), policy, optional
   expiry and scopes. The scope choice narrows to the policy's
   `allowedScopes` when it has any. Rotate collects reason and grace.
2. On success the same dialog swaps to the reveal. The raw key goes into the
   component's own state, never read off `create.data`, and the hook's
   `reset()` runs straight away so the hook holds no copy either.
3. The reveal shows the key large, in mono, split into its anatomy: prefix and
   environment dimmed, the random body at full weight, the last four
   characters underlined with "you'll recognise it later as …a3f8". That is
   the only form the key takes anywhere else in the dashboard.
4. Copy, and Hide. Clicking outside and Escape are blocked. Done stays
   disabled until "I've stored this key somewhere safe" is ticked. A
   `beforeunload` guard runs while the reveal is up.
5. Done wipes the state and closes. After create you land on the key's detail
   page. After rotate you stay where you were.
6. The rotate reveal also states the window: "Your previous key (…a3f8) keeps
   working until 1 Oct, 14:02", with End it now (`keys.endGrace`). With a
   zero grace it says the previous key stopped working when you rotated.

The raw key never reaches a toast ("Key created" carries no value), a URL, the
query store, the console, or a fixture read. A test renders the reveal, clicks
Done, and asserts the value is gone from the DOM and that no `useQuery` cache
entry contains it.

Revoke is a `ConfirmDialog` naming the key as `sk_live_…a3f8`, asking for a
reason, and saying the key cannot be brought back and that any open grace
window ends with it.

### Pages

The overview opens on a StatGrid: active keys, open grace windows, keys
expiring within 7 days, and requests in the last 24h, which reads "not
recorded" when the intent answers `null` so you don't mistake silence for a
quiet day. Under it sit recent keys, recent rotations, and a line linking to
Settings with how many policy fields this deployment actually enforces.

Keys is a ResourceTable: Name (`font-medium`), Key (`sk_live_…a3f8`, mono),
Environment, State, Policy (or `NoneCell`), Scopes (`TagList`, mono), then
Last used and Expires as `Timestamp`. The FilterBar covers environment, state
and policy.

Key detail carries Rotate, Suspend or Reactivate, and Revoke. Its sections:

- Validity: expiry, and every previous key still valid, each with its hint,
  its end time and End now.
- Details: ID in mono, prefix, environment, created by, timestamps, and
  metadata read-only.
- Policy: a link, and what is enforced.
- Scopes: assign and remove.
- Rotation history.
- A small usage chart linking to Usage.
- Warden: when the settings intent lists `warden-hook`, a `PluginLink` to
  `/@warden/subjects/api_key/<id>`. Otherwise the subject is named as text,
  because a link into a plugin you haven't installed goes nowhere.

Policies has the list, create and edit with the three enforcement groups, and
a detail page listing the keys that use the policy. Delete is refused while
any key uses it.

Scopes shows name and parent in mono, and the description. You can create one
and delete one behind a confirm. The page says parents are stored for your
application and are not used when matching, since anyone reading a tree of
`read` and `read:users` would otherwise assume `read` grants both.

Rotations lists every rotation across keys: when, key (link, mono), reason,
grace, window and rotated by, filtered by reason.

Usage offers 24h hourly, 7d daily, 30d daily and 12 months monthly, and a key
filter. It shows the chart, a table view of the same buckets, and a records
table (time, key, method, endpoint, status, latency, IP, with the identifiers
in mono). The empty state says usage appears once your application calls
`RecordUsage`.

Settings is read-only: plugins, store health, rate limiter, tenant source, the
enforcement table and the default grace.

### Badges

Key state, by proportion:

| State | Variant | Why |
|---|---|---|
| active | outline | the majority on any real deployment |
| suspended | default | temporarily off, worth a second look |
| expired, revoked | secondary | finished history |
| expires within 7 days | destructive | what someone scans a key list to find |

Rotation reason: `compromise` destructive, `policy` secondary, `manual` and
`scheduled` outline. `scheduled` never occurs today.

Environment is text, not a badge.

### The usage chart

Emphasis form, stacked columns: successful requests in neutral `#71717b`,
4xx in the status colour serious `#ec835a`, 5xx in critical `#d03b3b`. The
dataviz validator passes CVD separation for the adjacent status pair in both
modes (worst ΔE 13.9 deutan). It flags the grey for low chroma, which is intended
because the grey is the series meant to recede, and flags serious below 3:1 on
the light surface,
so the chart ships a labelled legend, a tooltip per column, and the table view.
Every bucket in the range is present, including empty ones, so a quiet hour
reads as zero and not as missing data.

### Libraries

Recharts through kit's `chart.tsx`, already in kit. No CodeMirror: a policy is
structured data with no text form, and metadata is small enough for a
description list. Nothing new is added. Ledger and Chronicle already import
Recharts statically, so it should already be in the eager chunk; the plan
checks that in the `pnpm build` output before deciding the usage page needs no
lazy route.

## Fixture

`packages/fixture-server/keysmith-fixtures.mjs`, registered with one line in
`server.mjs` and one in `verify.mjs`.

- It models the fixed contract: a rotation leaves the previous key listed as
  valid until its grace ends, `keys.endGrace` closes it, revoke is terminal,
  and suspend on a revoked key refuses.
- Writes change the next read.
- `raw_key` appears in the create and rotate responses and nowhere in the
  fixture's state. The fixture stores a hash and a hint, like the engine.
- It keeps the tenant rule: requests with no resolvable tenant refuse.
- Two tenants are seeded, so isolation is visible.

## Retiring the templ dashboard

After the React plugin has been clicked through against the fixture:

1. `keysmith/MIGRATION.md` gets the inventory of every templ page, column,
   action, filter, badge, widget and empty state, each marked migrated,
   replaced or dropped with a reason. It also lists what this migration did
   not cover (see below).
2. `grep -rn "keysmith/dashboard" --include='*.go'` finds only
   `extension/extension.go`, which is updated.
3. Delete `dashboard/`, `DashboardContributor()`, every `*_templ.go`, and
   `github.com/a-h/templ` and `forgeui` from `go.mod` if nothing else needs
   them.
4. `find . -name '*.templ'` returns nothing, and `go build ./... && go test
   ./...` pass.
5. It lands as its own commit.

The templ `dashboard.Plugin`, `KeyDetailContributor` and `PageContributor`
interfaces go with it. They let hook plugins render templ into the old
dashboard, and nothing in forgery implements them.

## Testing

Go, in keysmith:

- Every domain fix gets a test that fails before the fix, against memory and
  sqlite. Postgres and mongo get the same code with compile-time coverage only,
  and `MIGRATION.md` says so plainly.
- Every handler has a test, including its failure paths, and each engine error
  is asserted against the contract code it maps to.
- Tenant isolation: rows under two tenants, list under one, assert on IDs. The
  tenant resolver is tested with the claim empty, the wrong type, nil, absent
  with a default, and absent without one.
- A pinning test records what an empty tenant does per backend, stated as what
  it is: it matches every tenant.
- Lint with a fresh cache every run.

React, in `plugin-keysmith`: vitest and tsc both, lint clean, and `pnpm -r
test` across the repo. Failure tests make the client throw a `ContractError`,
since a stub answering `{ ok: false }` resolves normally and never reaches the
failure path. Then the fixture server and the shell, clicking every
page, before the templ deletion.

## Known overlap and neighbours

authsome has its own API keys: `plugins/apikey` with its own store and the
`apikeys.*` intents, surfaced in `plugin-authsome/src/sub/apikey.tsx`. Its
`WithKeysmith` option builds a keysmith-backed `KeyManager` that nothing inside
authsome calls. So there are two independent API-key systems. Keys minted
through the adapter would appear in Keysmith's dashboard with prefix
`authsome` and no tenant, which under the tenant rule means they do not
appear at all. Worth a decision by whoever owns authsome; this migration does
not touch it.

`warden_hook` depends on a `WardenBridge` that nothing in forgery implements.
It reacts to create and revoke only, not to scope changes, reactivation or
rotation.

## Not surfaced

Recorded in `MIGRATION.md` as capabilities the dashboard does not expose:
`usage.Store.Purge`, `CleanupExpiredKeys`, `POST /keys/validate` (deliberately:
it means pasting a live key into a browser), editing a key's name,
description, metadata or expiry after create (the engine has no `UpdateKey`),
`GetByPrefix`, `DeleteByTenant`, `RecordBatch`, `DailyCount` and
`MonthlyCount`, and an opt-in usage-recording middleware.
