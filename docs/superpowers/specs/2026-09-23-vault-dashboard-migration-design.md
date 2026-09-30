# Vault dashboard: templ to React shell

Design for moving the Vault extension's dashboard off server-rendered templ and
onto the React shell, across two repositories.

- Go: `/Users/rexraphael/Work/xraph/forgery/vault`
- React: `forge-dashboard`, as a new `packages/plugin-vault`

Method is `packages/plugin/PLAYBOOK.md`, including its closing section on
retiring the templ dashboard.

## What this is for

Vault unifies three capabilities behind one API: encrypted secrets, rule-based
feature flags, and hot-reloadable runtime config, with versioning, rotation,
tenant-scoped evaluation and audit. Its dashboard today is 20 templ pages plus
12 components rendered server-side through `contributor.LocalContributor`. The
React shell cannot consume that: it speaks a POST envelope carrying a
contributor name and an intent name, and Vault has no contract contributor, no
intents and no envelope.

The operator this is for runs a platform and needs three questions answered
that the current dashboard cannot answer: what is in this secret's history,
why did this flag evaluate this way for this tenant, and what is this config
key actually resolving to right now.

Success is: every capability Vault's domain packages offer is reachable from
the React dashboard or is recorded in `vault/MIGRATION.md` as deliberately
dropped or blocked, and `vault/dashboard/` no longer exists.

## What the investigation found

These are the facts the design rests on. Each was read from the Go source, not
inferred.

### `vault.Vault` is a stub

`options.go:63` says "the full implementation is in vault.go (created in a
later phase)". That file does not exist. `NewVault` returns a struct holding a
`Config` and a logger, and nothing else. There is no `Secrets()`, `Flags()` or
`Config()` accessor, though `doc.go` documents all three.

The extension (`extension/extension.go`) therefore wires only `store.Store`. It
never constructs `crypto.Encryptor`, `secret.Service`, `flag.Engine`,
`override.Resolver`, `config.Service`, `rotation.Manager` or `audit.Logger`.

Three consequences follow, and they are the reason this migration cannot start
with handlers:

Every secret created through the current dashboard is blank. The templ create
handler builds `&secret.Secret{Entity, Key, Value, AppID}` and calls
`store.SetSecret` directly. The store persists only `EncryptedValue`
(`store/postgres/models.go:46`), which that struct never sets, and it never
sets `ID` either. Every row written this way has an empty value and a zero ID.

The audit log is never written, because `audit.NewLogger` is not constructed
anywhere in the repository outside its own package. The Audit page, the Recent
Audit widget and the audit card on secret detail all read a table nothing
writes. `secret.Service` carries `WithOnAccess` and `WithOnMutate` hooks that
exist for precisely this and that nothing has ever passed.

No secret value can be returned at all. `Secret.Value` and `Secret.EncryptedValue`
are both `json:"-"`. `secret.Meta` has no value field at all. Decryption exists
only in `secret.Service.Get`, and that service is never built.

### An unconfigured Vault stores plaintext and cannot say so

With no encryptor, `secret.Service.Set` puts the plaintext straight into
`EncryptedValue` and leaves `EncryptionAlg` empty (`secret/service.go:152`).
The fallback itself is documented and fine. The problem is that `secret.Meta`
carries no `EncryptionAlg` field, and neither `ToMeta` nor any backend's
`toMeta` projects one, so `ListSecrets` returns encrypted and plaintext rows
that no caller can tell apart.

It has to be reported per row, not per Vault. Nothing re-encrypts on read, so
a key added later leaves everything written before it in plaintext forever. One
app can hold both kinds at once, and a Vault with a perfectly good key can
still be full of plaintext rows. A single "encryption is on" flag describes the
current configuration and says nothing about the data.

So `secret.Meta` gains `EncryptionAlg`, the contract projects it as
`encryptionAlg`, and the rule for the UI is that empty means **not encrypted**
rather than unknown. No secrets surface may use the words encrypted, secure or
protected for a row whose algorithm is empty, and the list shows the state per
row rather than once at the top.

### Flag evaluation answers "what", never "why"

`Engine.Evaluate(ctx, key, appID)` reads tenant and user from context values
(`vault.tenant_id`, `vault.user_id`), so a handler can synthesise a context from
a supplied payload and evaluate server-side. It returns a bare `any`.

Its order is: disabled returns the default; a tenant override wins outright;
otherwise rules in ascending priority, first match wins; otherwise the default.

Three constraints on any evaluation surface:

- A 30 second evaluation cache would serve stale answers to a debugging
  operator.
- `RuleWhenTenantTag` and `RuleCustom` both `return false` unconditionally,
  marked "not yet implemented" in `flag/engine.go`. They can never match.
- `SetFlagRules` replaces the whole list. There is no per-rule add or delete.

### Rotation needs a rotator that only Go can register

`Manager.RotateNow` fails with `no rotator registered for %q` unless
`RegisterRotator` was called for that key in application code. The registry is
an unexported in-memory map with no accessor, so a dashboard cannot even tell
which policies are executable.

### Config is free-form and the server never parses it

`config.Entry.Value` is `any`; `ValueType` is a label inferred from the Go type
by `inferValueType`. There is no schema, no validation and no parse step, so
the server can never report a parse position. Validation is necessarily
client-side.

### Coverage of the 17 templ routes

Eleven read correctly. Four write, one of them broken (secret create, above).
One is dead: the settings page takes a nine-field struct and the contributor
passes only `AppID`, so eight rows render as `-`, `0s` and "Disabled". The
overview's Overrides stat is never populated and always reads zero.

No per-rule, per-override or per-version write surface exists anywhere in
templ, and no evaluate or resolve surface exists at all.

## Decisions

Taken with the human partner, 2026-09-23.

| Decision | Choice | Why |
|---|---|---|
| Go scope | Finish `vault.Vault` first | The advertised API should exist before a second consumer builds a parallel copy of it |
| Secret values | Write-only, never read back | No reveal intent exists, so there is no decryption oracle and no masked value to echo back |
| Flag evaluation | Add `EvaluateDetail` to the engine | Precedence stays in one place; reimplementing it in a handler would drift |
| Config unset | Build explicit unset | The domain distinguishes override-present from override-absent, so the UI should too |
| Row counts | Add `Count*` to the store interfaces | Makes `overview.stats` honest and offset paging real |
| Plaintext rows | Report `encryptionAlg` per secret, empty means not encrypted | A key added later never re-encrypts old rows, so one app holds both kinds and only the row knows |
| Import cycle | Move `Entity` and the errors to `vault/core` | Package `vault` cannot import the subsystems that import it; four symbols and two files are the whole entanglement |
| App scope | The configured app only; no request carries an app id | A request-supplied id lets any operator reach any app, and the principal's authsome app id is a different namespace |
| Sequencing | Vertical slices per subsystem | Wire-shape mistakes surface after 7 handlers, not 35 |

## The Go half

### First, break the import cycle

Package `vault` cannot import `secret`, `flag`, `config`, `override` or
`rotation`, because all five import `vault`. That is almost certainly why
`vault.go` was never written, and it makes the constructor below impossible
until it is fixed.

The entanglement is four symbols: `Entity` and `NewEntity` from `entity.go`,
and `ErrSecretNotFound` and `ErrOverrideNotFound` from `errors.go`. Nothing
else crosses.

So both files move to a new leaf package, `vault/core`, alongside the existing
leaf `vault/id`. The five subsystem packages import `core`. Root `vault` then
re-exports everything it moved:

```go
type Entity = core.Entity                    // a true alias, so embeds are unchanged
func NewEntity() Entity { return core.NewEntity() }
var ErrSecretNotFound = core.ErrSecretNotFound   // same value, so errors.Is still matches
```

Every existing caller keeps working, inside the repo and out. `vault.Entity`
composite literals, struct embedding and field promotion all behave as before,
because a type alias is the same type. The sentinel errors are the same values,
so `errors.Is` is unaffected.

Move the whole of `errors.go`, not only the two errors the subsystems use. A
package holding four of six sentinel errors is a worse thing to maintain than
one holding all of them.

### `vault.go`

With the cycle gone, `New(opts ...Option) (*Vault, error)` is the signature
`doc.go` already documents. `Vault` and `NewVault` move out of `options.go`,
which keeps only `Option` and the option functions.

Construction order, each from the store and the resolved `Config`:

```
Encryptor        crypto.NewEncryptor(key)   from EncryptionKey, else EncryptionKeyEnv
audit.Logger     over the store
secret.Service   store + encryptor, WithOnAccess/WithOnMutate wired to the logger
flag.Engine      store, WithCacheTTL(cfg.FlagCacheTTL)
flag.Service     over the engine
override.Resolver  config store + override store
config.Service   store + resolver
rotation.Manager store + secret.Service
```

Accessors: `Secrets()`, `Flags()`, `FlagEngine()`, `Config()`, `Overrides()`,
`Rotation()`, `Audit()`, `Store()`, `EncryptionEnabled()`. `FlagEngine()` is
separate from `Flags()` because `EvaluateDetail` lives on the engine while the
typed read path lives on the service.

An absent encryption key is not an error. It degrades to the documented
unencrypted fallback and the contract reports it, so the dashboard can say so
rather than pretending secrets are encrypted when they are not.

`extension/extension.go` switches to `vault.New` and surfaces the error, and
provides `*vault.Vault` into the DI container as it already does.

### Two domain additions

**`flag.Engine.EvaluateDetail(ctx, key, appID) (Detail, error)`**

```go
type Detail struct {
    Value       any        `json:"value"`
    Reason      string     `json:"reason"`       // disabled | tenantOverride | rule | default
    MatchedRule *Rule      `json:"matched_rule,omitempty"`
    Trace       []TraceStep `json:"trace"`
}
type TraceStep struct {
    Priority int      `json:"priority"`
    Type     RuleType `json:"type"`
    Matched  bool     `json:"matched"`
    Reached  bool     `json:"reached"`
    Note     string   `json:"note,omitempty"` // e.g. "bucket 73 of 100, threshold 25"
}
```

Bypasses the evaluation cache. `Evaluate` becomes a thin wrapper over it so
precedence exists once.

**`rotation.Manager.RotatorKeys() []string`** so the contract can report which
policies are executable.

### Counts on the store interfaces

One method per subsystem store interface, implemented across all four backends
(`memory`, `sqlite`, `postgres`, `mongo`):

```
secret.Store    CountSecrets(ctx, appID) (int64, error)
flag.Store      CountFlagDefinitions(ctx, appID) (int64, error)
config.Store    CountConfig(ctx, appID) (int64, error)
override.Store  CountOverrides(ctx, appID) (int64, error)
rotation.Store  CountRotationPolicies(ctx, appID) (int64, error)
audit.Store     CountAudit(ctx, appID) (int64, error)
```

### The contract package

`vault/extension/contract/`, shaped after
`authsome/extension/contract/`: an embedded `manifest.yaml` loaded through
`loader.Load` / `loader.Validate`, registered against the dashboard registry,
then one `RegisterQuery` / `RegisterCommand` per intent, each failing loudly.
`Extension.RegisterContractContributor` implements
`dashboard.ContractContributorAware` and passes `Deps{Vault *vault.Vault}`.

Contributor name is **`vault`**. This is the join key the React plugin's
`extension` field must match; a mismatch renders nothing and logs nothing.

On wire naming: the contract declares its own projection types in camelCase and
does not serialise domain types directly. Authsome's domain is snake_case
(`device.Device` has `json:"user_id"`, `json:"last_seen_at"`) while its
contract projection `DeviceSummary` is `json:"userId"`, `json:"lastSeenAt"`. The
domain supplies which fields exist and what they mean; the contract owns the
spelling. Vault's domain is snake_case throughout and its contract will be
camelCase throughout.

Paging is offset and limit everywhere, matching all six domain `ListOpts`
structs. No cursors anywhere, so no translation layer in the UI.

Optional update fields are pointers, so "leave alone" and "set to empty" stay
distinct.

### The 35 intents

No request carries an app id. Every handler operates on the one app the vault
extension is configured with (`Config.AppID`), which is the human partner's
decision of 2026-09-23. A request cannot name another app, so no operator can
reach another app's secrets, flags or config by guessing its id, and the
dashboard principal's authsome app id, which has no reason to match a vault
app id, never enters the question.

Every command names the queries it invalidates. Queries are cacheable and free
of side effects.

**Secrets: 3 queries, 4 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `secrets.list` | query | `{key?, limit, offset}` | `{secrets[], total}` |
| `secrets.detail` | query | `{key}` | meta, rotation policy, recent audit |
| `secrets.versions` | query | `{key}` | metadata only; no values |
| `secrets.create` | command | `{key, value, metadata?, expiresAt?}` | → `secrets.list` |
| `secrets.update` | command | `{key, value}` | new version → `list`, `detail`, `versions` |
| `secrets.delete` | command | `{key}` | → `secrets.list` |
| `secrets.setExpiry` | command | `{key, expiresAt *string}` | → `detail`, `list` |

`SecretSummary` mirrors `secret.Meta` exactly: `id, key, version,
encryptionAlg, expiresAt, appId, metadata, createdAt, updatedAt`. There is no field a value could occupy,
in any request or response, in either direction. That is the write-only
decision expressed in the type, not in a comment.

**Rotation: 2 queries, 3 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `rotation.policies` | query | `{limit, offset}` | each row carries `rotatable: bool` |
| `rotation.detail` | query | `{key}` | policy plus records |
| `rotation.savePolicy` | command | `{key, intervalSeconds, enabled}` | → `policies`, `detail` |
| `rotation.deletePolicy` | command | `{key}` | → `rotation.policies` |
| `rotation.rotateNow` | command | `{key}` | → `detail`, `secrets.detail`, `secrets.versions` |

`rotatable` comes from `RotatorKeys()`. `rotateNow` is offered only where it is
true, and the row says why when it is false.

**Flags: 3 queries, 7 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `flags.list` | query | `{type?, tag?, limit, offset}` | `{flags[], total}` |
| `flags.detail` | query | `{key}` | definition, rules, tenant overrides |
| `flags.evaluate` | query | `{key, tenantId?, userId?}` | `EvaluateDetail` projection |
| `flags.create` | command | `{key, type, defaultValue, description?, tags?, enabled}` | → `flags.list` |
| `flags.update` | command | `{key, description *string, defaultValue *any, tags *[]string}` | → `list`, `detail` |
| `flags.delete` | command | `{key}` | → `flags.list` |
| `flags.setEnabled` | command | `{key, enabled}` | → `list`, `detail`, `evaluate` |
| `flags.setRules` | command | `{key, rules[]}` | whole-list replace → `detail`, `evaluate` |
| `flags.setTenantOverride` | command | `{key, tenantId, value}` | → `detail`, `evaluate` |
| `flags.deleteTenantOverride` | command | `{key, tenantId}` | → `detail`, `evaluate` |

`flags.evaluate` is a query because it has no side effects. `setRules` replaces
the whole list because `SetFlagRules` does; the request carries rules in
display order and the handler assigns `Priority` from the index, so the UI
never sends a priority number and the two cannot disagree.

**Config: 4 queries, 4 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `config.list` | query | `{key?, limit, offset}` | `{entries[], total}` |
| `config.detail` | query | `{key}` | entry plus its overrides |
| `config.versions` | query | `{key}` | values included; config is not secret |
| `config.resolve` | query | `{key, tenantId?}` | `{value, source, overrideValue?, appValue}` |
| `config.create` | command | `{key, value, valueType?, description?}` | → `config.list` |
| `config.update` | command | `{key, value *any, valueType *string, description *string}` | → `list`, `detail`, `versions`, `resolve` |
| `config.delete` | command | `{key}` | → `config.list` |
| `config.rollback` | command | `{key, version}` | reads then re-sets → `detail`, `versions`, `resolve` |

`rollback` produces a new version rather than rewriting history, because
`SetConfig` auto-versions and there is no other honest option.
`source` is `"override"` or `"appDefault"`.

**Overrides: 1 query, 2 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `overrides.list` | query | `{tenantId?, key?, limit, offset}` | requires tenantId or key; see below |
| `overrides.set` | command | `{key, tenantId, value}` | → `overrides.list`, `config.resolve`, `config.detail` |
| `overrides.delete` | command | `{key, tenantId}` | the explicit unset → same |

`overrides.delete` is the affordance the config-unset decision buys: a distinct
intent with a distinct verb, so "revert to the app default" and "set this to an
empty value" are different acts that cannot be confused.

**`overrides.list` requires either `tenantId` or `key`, and returns
`CodeBadRequest` when given neither.** This is not a policy choice: the override
store offers only `ListOverridesByTenant` and `ListOverridesByKey`, and there is
no method that lists all overrides for an app. The templ page papered over this
by listing up to 100 config entries, fetching overrides per key and truncating
at 100, which silently omits overrides on any key past the first hundred. The
`/overrides` page therefore opens asking which tenant or key to look at, rather
than showing a list that is quietly incomplete.

Pointer semantics need care for optional arbitrary values. `*string` and `*bool`
behave as you would expect. `*any` on `flags.update.defaultValue` and
`config.update.value` needs care: `encoding/json` leaves the pointer nil when
the field is absent, which is the distinction wanted, but an explicit JSON
`null` also produces a non-nil pointer to a nil interface. Both intents treat
that second case as "set the value to null", which is a legitimate config value
and a legitimate flag default. Decide this once, in the shared projection
helpers, not per handler.

**Audit and overview: 2 queries**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `audit.list` | query | `{resource?, key?, outcome?, limit, offset}` | `{entries[], total}` |
| `overview.stats` | query | `{}` | six counts from the new `Count*` methods |

There is deliberately no settings intent. The templ settings page renders
eight fields its contributor never passes plus a hardcoded encryption blurb. It
is replaced by nothing. One thing on it was true and worth keeping: whether
encryption is actually configured. That moves to `overview.stats` as
`encryptionEnabled`, where an operator will actually see it.

## The React half

`packages/plugin-vault`, `extension: "vault"`, `namespace: "vault"`.

Pages are plain components taking a `params` prop. No dependency on
react-router. Links go through `PluginLink` with scope-relative paths. Reads
use `useQuery`, writes use `useCommand`, and refreshes happen only through
`meta.invalidates`.

### Information architecture

| Group | Route | Page |
|---|---|---|
| Overview | `/` | stat grid, recent audit |
| Secrets | `/secrets` | list |
| | `/new-secret` | create |
| | `/secrets/:key` | timeline detail |
| | `/rotation` | policy list |
| | `/rotation/:key` | policy detail and records |
| Flags | `/flags` | list |
| | `/flags/new` | create |
| | `/flags/:key` | the ladder |
| Config | `/config` | list |
| | `/config/new` | create |
| | `/config/:key` | editor, versions, overrides |
| | `/overrides` | cross-key tenant view |
| Audit | `/audit` | list |

Detail, create and edit routes carry no nav entry: a sidebar link to "a secret"
with no secret chosen points nowhere.

### Three subsystems, three shapes

Secrets are an append-only log with a value nobody can read, so the detail page
is a timeline rather than a table: versions descending with the current one marked, the
rotation policy pinned above as the thing that generates future entries, and
the audit trail below.

There is nothing to diff for secrets. Under write-only no value is readable, so
v4 against v5 could only compare metadata. Diff belongs to config alone.
Rotation records compare version numbers (`oldVersion`, `newVersion`), never
contents.

Config is free-form structured text, so it gets a real editor. CodeMirror 6 with
`@codemirror/lang-json`
for editing and `@codemirror/merge` for the version diff, loaded lazily at the
route. Config values are small blobs rather than files, so an IDE is the wrong
size of tool; CodeMirror does both jobs for roughly an order of magnitude less
weight than Monaco, and the real numbers go into `BASELINE.md`. Measure
it, do not assert it. Only `valueType: json` gets the editor; scalars get a typed
input. Validation is client-side because the server has no parse step to report
from.

Flags are a waterfall with short-circuits, and they are the design centre of the
whole migration. They get their own section below.

### The flag ladder

The templ page renders definition, rules and tenant overrides as three
unrelated cards, which loses the two facts that matter most: a tenant override
beats every rule, and a disabled flag makes the entire rule table dead weight.
Both are invisible when the three are siblings.

One object replaces all three, read top to bottom in the engine's own order:

```
 (1)  Enabled                                        yes
 -----------------------------------------------------
 (2)  Tenant overrides           beats every rule below
      t-acme                                      true
      t-globex                                   false
 -----------------------------------------------------
 (3)  Rules, first match wins
      0   when tenant     t-beta, t-gamma          true
      1   rollout         25%                      true
      2   schedule        1-14 Mar                 true
 -----------------------------------------------------
 (4)  Default                                      false
```

The numbering is the evaluation sequence, not decoration. Disabling the flag
visibly stands rungs 2 and 3 down, because that is what the engine does to
them.

Evaluation is the same object in a second mode, not a separate widget. Entering
a tenant and user marks the rung that decided, greys the rungs never
reached, and annotates each rule checked and rejected. The answer to "why" then
appears in the same place, and the same order, as the configuration the
operator was already reading.

The rollout hash is deterministic: `sha256(tenantId + ":" + flagKey) % 100`, so
a rollout rung can report the actual bucket ("t-acme lands in bucket 73; at 25%
it does not match") rather than leaving a percentage to be trusted. The
`TraceStep.Note` field exists to carry that.

### The rule editor

Rules reorder by drag with `@dnd-kit`, which is already in kit. `Priority` is a
plain int and `SetFlagRules` replaces the whole list, so drag-to-reorder maps
exactly onto the one write the store offers, and the handler derives priority
from position.

Each row expands into a form specific to its type: chips for tenant and user
IDs, a slider for the rollout percentage, a date range for schedules.

`when_tenant_tag` and `custom` both return false unconditionally in the engine.
They render when existing data contains them, marked as never matching, and are
**absent from the add-rule menu**. Offering a rule that cannot match would be a
feature deleted by accident in the playbook's sense.

### Kit and conventions

`ResourceTable`, `PageHeader`, `QueryBoundary`, `CommandAlert`, `ConfirmDialog`,
`FilterBar`, `DetailLayout`, `DescriptionList`, `StatGrid`, `EmptyState`,
`NoneCell`, `TagList`, `Timestamp`. Anything genuinely shared that is missing
belongs in kit, not here.

All five display conventions apply: `font-mono text-xs` on identifiers,
`font-medium` on the column an operator reads, a live row count on every table
caption including at zero, `NoneCell` or `TagList` for "none" and never a blank
or a bare dash, and badge colour as the scan signal with `outline` for true or
normal and `secondary` for false.

### Lazy loading

Only the config editor route is lazy:

```tsx
const ConfigDetailPage = lazy(() => import("./pages/config-detail"))
```

`PluginHost` wraps every page in `Suspense`. Two obligations follow: re-measure
and write the numbers into `BASELINE.md`, and confirm against `pnpm build`
output that the chunk actually splits, since one stray static import of
CodeMirror anywhere pulls it back into the entry.

## Sequencing

Six slices. Each is runnable and clickable before the next begins.

1. **Go core.** `vault.go`, `EvaluateDetail`, `RotatorKeys`, the six `Count*`
   methods across four backends, extension rewiring. `go build ./... && go test
   ./...` clean.
2. **Contract skeleton plus Secrets and Rotation.** Manifest, registration,
   12 intents. React plugin scaffold, secrets and rotation pages, fixtures.
   Run it.
3. **Flags.** 10 intents, the ladder, the rule editor, the evaluation mode.
4. **Config and Overrides.** 11 intents, the lazy editor, the diff, explicit
   unset. Re-measure `BASELINE.md`.
5. **Audit and Overview.** 2 intents and their pages.
6. **Retire templ.** Its own commit, after the procedure below.

All six are done. `vault/MIGRATION.md` landed first (25e44a5, corrected in
6847360), then the deletion on its own in c33b425, then the docs (b73a9aa,
e1cdb03, ea2a307). Nothing is pushed yet.

Per package, `test`, `typecheck` and `lint` clean, and `pnpm -r test` too, not
just the package being worked on.

## Retiring the templ dashboard

Following the playbook's closing section. Steps 1 and 2 happen while the templ
pages still exist.

1. **Write `vault/MIGRATION.md` first**, from the live pages: every page,
   column, action, filter, badge and empty state across the 17 routes, 12
   components and 2 widgets.
2. **Account for every item** as migrated, deliberately dropped, or blocked.
3. **`grep -rn "vault/dashboard" --include='*.go'`** across the extension to
   find anything else importing it.
4. **`go build ./... && go test ./...`** with the directory gone.
5. **Delete as its own commit**, separate from the migration.

### Already known for `MIGRATION.md`

Recorded here so they are not lost between now and step 1.

**Deliberately dropped**

- The settings page. Its contributor passed only the app id, so the other
  eight fields showed template defaults: four of them read as blanks (the key
  env as "-", both durations as "0s", audit as "Disabled") and four as
  plausible-looking values nobody had set. The encryption card beside them was
  hardcoded text. Whether encryption is configured moves to `overview.stats`.
- The Overrides stat on the overview, as it was. It was never populated and
  always read zero; it is replaced by a real count.
- `secrets.setExpiry`. Nothing in the store or the service changes an expiry
  without rewriting the value, and the server can't read the value back under
  the write-only decision. Expiry is set on create and changed on update.
- The key filter on the secrets list. The templ page filtered the first 100
  rows after reading them and reported that as a complete search. A real
  filter needs a store filter across four backends.
- The `yaml` flag type on the create page. It was never a flag type: the
  engine and every typed reader ignore it.
- The flag list's free-text type box. It is now a type select backed by a
  real store filter, so the page and the total agree.

**Blocked, with the blocker named**

- `rotation.rotateNow` for any secret without a registered rotator. The
  registration is application Go code and no dashboard can supply it. The UI
  reports which policies are executable rather than offering a button that
  fails.
- `when_tenant_tag` and `custom` rules. The engine returns false for both. They
  are displayed where data contains them and cannot be created.
- A tag filter on the flag list. Tags are a JSON array in three different
  column types across the backends, so a filter that keeps paging exact
  needs three dialects of array query.
- Keys or tenant ids the templ pages stored with leading or trailing spaces.
  The new pages list them, but every write path trims its input, so such a
  row can't be opened, changed or reverted from the dashboard. Fix those rows
  in the store first.
- Editing a config value whose type is not one of the six the vault checks
  (the templ page's `yaml`). It is shown read-only with the reason, and the
  only way out is a retype that comes with a valid value.
- Counting plaintext left in version history. Versions carry no algorithm
  column, so a secret whose current value is encrypted can still hold
  plaintext in an older version, and nothing can count it without reading
  every version. The overview says so instead of implying it's fixed.
- Secrets that expire soon. No store method answers it without reading every
  row, so the overview leaves it out.

**Bugs found, not migrated**

- Secret create writes an empty encrypted value and a zero ID. The contract
  path goes through `secret.Service.Set`, which encrypts and assigns an ID.
- The audit log was never written. Wiring `audit.Logger` into
  `secret.Service`'s existing `WithOnAccess` and `WithOnMutate` hooks fixes it,
  which turns four previously dead read surfaces live.
- Scheduled rotation never ran. Nothing started `rotation.Manager`'s loop, so
  the "next rotation" the templ page showed never happened.
- Every update and every rotation erased the secret's expiry and metadata,
  because `Set` builds a fresh row and the backends upsert both columns from
  it.
- A policy saved from the dashboard never fell due: `NextRotationAt` was only
  ever set after a rotation.
- Flag create stored every default as a string. A bool flag got `"true"`,
  an int got `"42"`, so every non-string flag made there evaluates to the
  caller's own fallback. Those rows still exist: the new pages mark each one
  "Wrong type" and leave the fix to the operator, since only they know the
  value they meant.
- Flag create set no ID, so the second flag made there failed on a unique
  violation on sqlite, postgres and mongo. It also overwrote an existing key,
  type included, because `DefineFlag` is an upsert.
- Flag create took the app id from a form field, and the detail page took it
  from the query string, so either could read or write another app's flags.
- Enable and disable ran over GET, with no cache invalidation and no audit
  row, so a disabled flag kept answering from cache for up to 30 seconds.
- The flag list and detail pages swallowed store errors into their empty
  states, and the list counted at most 100 flags.
- Config create stored every value as the raw string from the form, whatever
  its type, set no ID (so the second create failed on sqlite and postgres),
  and overwrote an existing key. Edit turned invalid JSON into a string and
  silently retyped any label outside six known ones to "string".
- Deleting a config key left its overrides behind. They kept answering for
  their tenants and came back when the key was recreated. Delete now removes
  them first, create clears any left over, and an orphan that survives
  anyway (from `config.Service.Delete`, which the dashboard doesn't use) can
  be removed from the overrides page.
- A rollback through `config.Service.Set` relabelled the type and wiped the
  description and metadata, and `GetConfigVersion` reported the old value
  under the current type. Versions only ever stored the value.
- The overrides page showed only the overrides of the first 100 keys, took
  the app id from the request, and could not change anything. Nothing
  audited config or override writes.
- The audit page filtered in memory over the newest 100 rows, had no paging,
  showed the page's length as its count, and printed times with no year or
  zone. Every row said "success", because nothing ever wrote a failure, and
  no row carried a user.
- A rotation looked like a secret read plus a write, and a failed one left
  only the read. The scheduled loop's retry lease made a failing policy look
  healthy. Rotation now writes `secret.rotated` rows, failures included.
- The overview's Overrides card was always 0, because nothing set it. Every
  count was capped at 10000 by a list limit, and any error showed as 0.
- The settings page showed "Audit Logging: Disabled" forever, from a config
  field nothing read.

## Testing

Go: table-driven handler tests per intent file against a memory store, as
authsome does. `EvaluateDetail` gets its own tests covering each of the four
reasons and the short-circuits, since it is now the single source of
precedence. The new `Count*` methods are tested per backend.

React: per page, that it renders, reads the right intent, and sends the right
field names. Failure paths use a stub that **throws `ContractError`**, because
`execute()` resolves `undefined` only on a throw; a stub answering
`{ ok: false }` resolves normally and the failure path never runs.

Errors belonging to an open dialog render inside it, since Base UI marks
everything outside an open dialog inert and `aria-hidden`. A page holding one
`useCommand` across many rows calls `reset()` when the dialog opens and clears
any inputs it carries. Every `ConfirmDialog` passes `pending`, which does not
debounce and without which a double-click sends the command twice.

No test reads a source file with `node:fs`; `import.meta.glob` with
`{ query: "?raw", eager: true }` instead, because a plugin package's tsconfig
carries no Node types and such a test passes vitest while failing typecheck.

Finally, run it: fixture server and shell up, every page opened and clicked
through. Every serious bug in the authsome migration was found that way and not
by a test.

## What slice 1 found that slice 2 must know

Slice 1, the Go core, and a follow-up batch landed on vault's `main`, from
`90a6f4b` to `fa3f84f` (27 commits ahead of origin, not pushed). Several things
this section used to warn about are now fixed; what follows is the state slice
2 builds on.

### Fixed by the follow-ups

The tenant and user context keys are one type. `flag.ContextKey` and
`override`'s key are aliases of `scope.ContextKey`, so a tenant set with
`scope.WithTenantID` reaches flag evaluation, config resolution and audit
alike. confy reads and writes through the secret service, so it no longer
returns an empty string for every secret on real backends. The memory store no
longer keeps a decrypted `Value`, so it behaves like postgres, sqlite and mongo
and can no longer hide a read bug. The flag cache is bounded, and
`FlagEngine().Invalidate(key)` drops a flag's cached results, with a generation
counter so an evaluation already in flight cannot put a stale value back. A
named key env var that is missing now refuses to start. Audit is always on.

### What slice 2 handlers must do

**Evaluate on a fresh context.** Because the key types are now unified, any
tenant or user sitting on the incoming request context, such as the operator's
own identity placed there for auditing, will drive `when_user` and
`when_tenant` rules, rollouts and override resolution. `flags.evaluate` and
`config.resolve` must build a new context from `context.Background()` carrying
only the tenant and user in the request, never inherit the request's.

**Invalidate after every flag write.** Flag commands write through the store,
which does not touch the engine's cache. Each of `flags.update`,
`flags.setEnabled`, `flags.setRules`, `flags.setTenantOverride`,
`flags.deleteTenantOverride` and `flags.delete` must call
`FlagEngine().Invalidate(key)`. It affects only the local process: other
replicas serve the old answer until their TTL expires, and the evaluate
surface should say so rather than imply the change is live everywhere.

**Never read a secret value to render a list.** `Secrets().Get` decrypts and
writes an audit row on every call. List and detail pages use `List`, `GetMeta`
and `ListVersions`, which return metadata only. Under the write-only decision
no handler calls `Get` at all.

**Use the configured app.** Every handler reads the vault's configured app id
and ignores anything else. No request carries one.

**Never port the templ secret create.** `dashboard/contributor.go` writes a
secret by calling `store.SetSecret` with only `Value` set. Every backend
discards `Value`, so it stores an empty, unencrypted, unaudited row.
`secrets.create` goes through `Secrets().Set`.

### Still open, and not blocking slice 2

Version rows carry no algorithm of their own. `GetVersion` applies the secret's
current `EncryptionAlg` to every version, so a history spanning a key change
reads wrongly: keyless after keyed returns ciphertext as `Value`. The dashboard
is write-only and never reads versions, so no surface may show a version's
value. The fix is a per-version column across four backends.

Invalidation is per process. A multi-replica deployment sees a flag change on
other replicas only after the cache TTL, 30 seconds by default.

`WithCacheMaxEntries` is not reachable from `vault.Config` or the extension
config, so the default cap of 10000 applies everywhere.

The `EncryptionKeyEnv` doc comment in `config.go` still calls it a fallback.
Slice 2's first task corrects it.

### What slice 2 can rely on

`vault.New` composes every service, and `WithConfig` overlays rather than
replaces. `FlagEngine().EvaluateDetail` returns a reason, the matched rule and
a trace that is never null; `flag.RolloutBucket` gives the exact bucket.
`Rotation().RotatorKeys()` says which secrets are rotatable. Six `Count`
methods exist on every backend, and an empty app id matches only empty-scoped
rows. `secret.Meta.EncryptionAlg` reports each row's own state, and empty means
not encrypted. `Secrets().Get` reads correctly whatever key a row was written
with, and an encrypted row read with no key is an error rather than an empty
value.

## What slice 2 found that slice 3 must know

Slice 2 shipped secrets and rotation end to end: eleven intents in
`vault/extension/contract` and `packages/plugin-vault` with five pages, plus
fixture handlers. On vault's `main` it runs from `fa3f84f` to `bffe17f`,
not pushed.

### Things that changed underneath you

Vault is on forge v1.11.2. On v1.10.0 the transport never passed a manifest's
`invalidates` on to the client, so no write refreshed any page against a real
server; the fixture hid it because it builds meta itself. Every new command
declares its `invalidates` in `manifest.yaml`, and
`extension/contract/transport_test.go` shows how to prove it through forge's
real HTTP handler.

The extension starts the rotation loop, on every replica. Before rotating, the
loop claims a due policy through `Store.ClaimDueRotation`, which moves its due
time forward by a five-minute lease, so only one replica rotates it. A replica
with no rotator for a key never claims it. A failed rotation retries when the
lease runs out, not every minute, and meanwhile the policy shows a due time in
the future instead of looking overdue. The overview in slice 5 is where that
failure should become visible.

The sqlite store now normalises every time to UTC before writing (`fe26706`,
from a separate session). Handlers still build their own times with
`.UTC()`, which costs nothing.

### Patterns to reuse

Handlers map errors through `deps.mapError(intent, err)`. It logs the
`INTERNAL` case on the server with the intent name and still sends the client
only a generic message. Don't call the package-level `mapError` from a handler.

On the React side, three rules came out of review and apply to every surface
you build:

- Any input that holds a secret value is uncontrolled. react-dom 19 reflects a
  controlled input's value into the HTML `value` attribute, password fields
  included, so the plaintext lands in `outerHTML`.
- A dialog running a command can't close while that command is pending,
  otherwise a failure that arrives later is shown nowhere.
- A create page lives at its own top-level route (`/new-secret`), never
  `/<list>/new`, because a key can literally be called "new".

The fixture models a keyed vault and uses Go's own audit action strings. Keep
it that way: every write in the fixture has to change the next read the way
the server does, and `verify.mjs` checks that it does.

### Still open

A dashboard save of a rotation policy is a read, then a full-row write. If
you save within milliseconds of a replica claiming that policy, the save can
put the old due time back and cause one repeat rotation. A compare-and-set
save on `updated_at` would close it.

Two creates of the same key can both pass the existence check. Memory and
sqlite then quietly add a version 2, and postgres answers `INTERNAL` on its
unique constraint, so the `CONFLICT` promise is best effort.

## What slice 3 found that slice 4 must know

Slice 3 shipped feature flags: ten intents, a list, a create page, and the
ladder with evaluation and a whole-list rule editor. On vault's `main` it
starts at `bffe17f`, not pushed.

### Check the write path before you design anything

It paid off again. The flag store upserted on create, stored `""` as a
primary key when no ID was set, rewrote columns no request named, and
accepted rules and overrides for keys that didn't exist, which then attached
themselves to whatever flag got that key later. None of it showed up in the
templ pages, because they never wrote enough to hit it. Config and overrides
sit on the same kind of store code, so read `config/`, `override/` and all
four backends' config paths, and probe them on sqlite, before you sketch a
page.

### Things that changed underneath you

Every flag write goes through `Vault.FlagManager()`. It validates values
against the flag's type, refuses an existing key, sets IDs, clears orphans
before it creates, invalidates the engine cache and writes an audit row.
Handlers stay thin. If config writes need the same guarantees, give config
the same kind of service instead of putting the rules in handlers.

The audit store filters by resource: `audit.ListOpts.Resource`, and
`CountAuditMatching` for totals. Slice 5 builds on both. The flag store has a
type filter, `flag.ListOpts.Type` with `CountFlagDefinitionsMatching`; that
is the shape to copy for any filter a list page needs, so the page and its
total come from the same predicate.

`vault.ErrOverrideNotFound` is shared by flag overrides and config overrides,
so `mapError` deliberately leaves it unmapped. The flag handler maps it to
"tenant override not found". Config's handlers must map it to their own
message.

The evaluation trace names each rule by ID (`ruleId`, `matchedRuleId`), and
the ladder matches on that. Matching by position or priority broke the
moment someone else reordered the rules, because the write service renumbers
priorities from zero on every save.

### Patterns to reuse

`ValueInput` and `FlagValue` in `plugin-vault/src/components` handle typed
values: bool, string, int, float and JSON, with `""` a valid string and a
saved value never rewritten on mount. Config's scalar editor can use them
as they are.

`flags.evaluate` runs only when you press Evaluate, and `useQuery` has no way
to wait for that, so `use-evaluate.ts` drives the public `queryStore`
directly. `config.resolve` needs the same thing. Add an `enabled` option to
`useQuery` in `packages/plugin` first, move flags onto it, and delete
`use-evaluate.ts`, so two pages don't grow two copies.

Both repositories are shared with other live sessions. Commit with
`git commit --only -- <paths>`, never run an index-wide `git reset`,
`git restore --staged .` or `git stash`, and stage `verify.mjs` with the
`git hash-object` and `git update-index --cacheinfo` recipe, because other
sessions keep uncommitted edits in it.

### Still open

The flag list has no tag filter. Two people editing one flag at once means
the last save wins, because no store has a version column. Mongo's
`SetFlagRules` deletes and reinserts without a transaction, so a failure
halfway leaves a partial rule list live. Cache invalidation reaches only the
replica that served the write; other replicas catch up within the TTL, and
the evaluate panel says so.

## What slice 4 found that slice 5 must know

Slice 4 shipped config and tenant overrides: eleven intents, a list with a
key-prefix filter, a create page, the entry page with a lazy CodeMirror
editor, a version diff and rollback, per-tenant overrides with an explicit
revert, a resolve panel, and a cross-key overrides page. On vault's `main`
it starts at `c2db8dd`, not pushed.

### Things that changed underneath you

Config and override writes go through `Vault.ConfigManager()`, in its own
package `configmgr` because `override` imports `config`. It checks every
value against the entry's type (overrides included), refuses an existing
key, never erases a field a request didn't name, clears overrides before a
delete and orphans before a create, skips a write that changes nothing, and
writes an audit row for each real change. A type change is refused while any
override would no longer fit it.

`useQuery` takes `{ enabled }` now, so a query can wait for a button. Flag
evaluation and config resolve both use it; the workaround hook from slice 3
is gone.

Audit rows for config carry resource `config`, and override rows carry
resource `override` with the overridden tenant as the row's tenant.
`config.detail` merges both for its recent activity. The audit page in
slice 5 should filter on those two resources and show the tenant column,
because for an override row it says which tenant the change was about.

### Patterns to reuse

`BASELINE.md` has the measured chunks: the config routes add under 10 KB to
the entry, and CodeMirror lives only in the lazy editor and diff chunks.
`test/lazy-editor.test.ts` fails the test run for any change that pulls
CodeMirror into an eager module, so a new lazy route can copy that test.

Value display and input (`ConfigValue`, `FlagValue`, `ValueInput`) cover all
six types now, duration included. Pass the draft, never the stored value, to
`ValueInput`: its bool toggle is fully controlled.

### Still open

Postgres and mongo ran only in throwaway containers during implementation;
there is no mongo harness in the repo. `overrides.list` reads every override
for a tenant or key before paging, because the store can't page or count
them. The CodeMirror editor exists twice, in relay and in vault; one shared
editor in kit is the follow-up.

## What slice 5 found that slice 6 must know

Slice 5 shipped the overview at `/` and the audit log at `/audit`. With it,
every templ page has a React replacement or a recorded reason it has none.
On vault's `main` it starts at `acfd34a`, not pushed.

### Things that changed underneath you

The audit store filters by key, action, outcome and time as well as
resource, with the same predicate for the page and the total, and orders by
`created_at DESC, id DESC`. `CountSecretsUnencrypted` exists on all four
backends.

Every dashboard command records its operator as the audit row's user; no
query does. Rotation writes a `secret.rotated` row for every attempt,
success or failure, and saving or deleting a rotation policy writes
`rotation.policy_saved` or `rotation.policy_deleted`. The actions actually
written differ from some declared constants (`secret.get` is written,
`secret.accessed` never is), and slice 5 kept the written strings rather than
split old rows from new.

`audit.list` hides `secret.get` unless you ask for reads or name that action.
App reads through confy write a row each, so the table grows without bound;
nothing purges it.

### For MIGRATION.md

The "Bugs found, not migrated" and "Deliberately dropped" lists above are now
complete for all five subsystems, and each item says what replaced it. Write
`vault/MIGRATION.md` from the live templ pages while they still exist, walk
every route against those lists, and then delete `vault/dashboard/` as its
own commit, after `grep -rn "vault/dashboard"` across the repo comes back
empty and the build passes without it.

### Still open

`audit_hook` is never attached, so chronicle sees no vault events. Deleting a
config key removes its overrides without an `override.deleted` row each.
"Enabled with no rotator" is judged by the replica that answers, so it can be
wrong where another replica has the rotator. The fixture's seed times are
relative to when it starts, so `verify.mjs` expects a server younger than a
few hours.
