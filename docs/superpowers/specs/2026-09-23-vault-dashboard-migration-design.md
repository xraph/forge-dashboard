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

Every command names the queries it invalidates. Queries are cacheable and free
of side effects.

**Secrets: 3 queries, 4 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `secrets.list` | query | `{appId?, key?, limit, offset}` | `{secrets[], total}` |
| `secrets.detail` | query | `{key, appId?}` | meta, rotation policy, recent audit |
| `secrets.versions` | query | `{key, appId?}` | metadata only; no values |
| `secrets.create` | command | `{key, value, appId?, metadata?, expiresAt?}` | → `secrets.list` |
| `secrets.update` | command | `{key, value, appId?}` | new version → `list`, `detail`, `versions` |
| `secrets.delete` | command | `{key, appId?}` | → `secrets.list` |
| `secrets.setExpiry` | command | `{key, appId?, expiresAt *string}` | → `detail`, `list` |

`SecretSummary` mirrors `secret.Meta` exactly: `id, key, version,
encryptionAlg, expiresAt, appId, metadata, createdAt, updatedAt`. There is no field a value could occupy,
in any request or response, in either direction. That is the write-only
decision expressed in the type, not in a comment.

**Rotation: 2 queries, 3 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `rotation.policies` | query | `{appId?, limit, offset}` | each row carries `rotatable: bool` |
| `rotation.detail` | query | `{key, appId?}` | policy plus records |
| `rotation.savePolicy` | command | `{key, appId?, intervalSeconds, enabled}` | → `policies`, `detail` |
| `rotation.deletePolicy` | command | `{key, appId?}` | → `rotation.policies` |
| `rotation.rotateNow` | command | `{key, appId?}` | → `detail`, `secrets.detail`, `secrets.versions` |

`rotatable` comes from `RotatorKeys()`. `rotateNow` is offered only where it is
true, and the row says why when it is false.

**Flags: 3 queries, 7 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `flags.list` | query | `{appId?, type?, tag?, limit, offset}` | `{flags[], total}` |
| `flags.detail` | query | `{key, appId?}` | definition, rules, tenant overrides |
| `flags.evaluate` | query | `{key, appId?, tenantId?, userId?}` | `EvaluateDetail` projection |
| `flags.create` | command | `{key, type, defaultValue, description?, tags?, enabled, appId?}` | → `flags.list` |
| `flags.update` | command | `{key, appId?, description *string, defaultValue *any, tags *[]string}` | → `list`, `detail` |
| `flags.delete` | command | `{key, appId?}` | → `flags.list` |
| `flags.setEnabled` | command | `{key, appId?, enabled}` | → `list`, `detail`, `evaluate` |
| `flags.setRules` | command | `{key, appId?, rules[]}` | whole-list replace → `detail`, `evaluate` |
| `flags.setTenantOverride` | command | `{key, appId?, tenantId, value}` | → `detail`, `evaluate` |
| `flags.deleteTenantOverride` | command | `{key, appId?, tenantId}` | → `detail`, `evaluate` |

`flags.evaluate` is a query because it has no side effects. `setRules` replaces
the whole list because `SetFlagRules` does; the request carries rules in
display order and the handler assigns `Priority` from the index, so the UI
never sends a priority number and the two cannot disagree.

**Config: 4 queries, 4 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `config.list` | query | `{appId?, key?, limit, offset}` | `{entries[], total}` |
| `config.detail` | query | `{key, appId?}` | entry plus its overrides |
| `config.versions` | query | `{key, appId?}` | values included; config is not secret |
| `config.resolve` | query | `{key, appId?, tenantId?}` | `{value, source, overrideValue?, appValue}` |
| `config.create` | command | `{key, value, valueType?, description?, appId?}` | → `config.list` |
| `config.update` | command | `{key, appId?, value *any, valueType *string, description *string}` | → `list`, `detail`, `versions`, `resolve` |
| `config.delete` | command | `{key, appId?}` | → `config.list` |
| `config.rollback` | command | `{key, appId?, version}` | reads then re-sets → `detail`, `versions`, `resolve` |

`rollback` produces a new version rather than rewriting history, because
`SetConfig` auto-versions and there is no other honest option.
`source` is `"override"` or `"appDefault"`.

**Overrides: 1 query, 2 commands**

| Intent | Kind | Request | Notes |
|---|---|---|---|
| `overrides.list` | query | `{appId?, tenantId?, key?, limit, offset}` | requires tenantId or key; see below |
| `overrides.set` | command | `{key, appId?, tenantId, value}` | → `overrides.list`, `config.resolve`, `config.detail` |
| `overrides.delete` | command | `{key, appId?, tenantId}` | the explicit unset → same |

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
| `audit.list` | query | `{appId?, resource?, key?, outcome?, limit, offset}` | `{entries[], total}` |
| `overview.stats` | query | `{appId?}` | six counts from the new `Count*` methods |

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
| | `/secrets/new` | create |
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

- The settings page. Eight of its nine fields were never populated, and the
  ninth was a hardcoded constant. `encryptionEnabled` moves to
  `overview.stats`.
- The Overrides stat on the overview, as it was. It was never populated and
  always read zero; it is replaced by a real count.

**Blocked, with the blocker named**

- `rotation.rotateNow` for any secret without a registered rotator. The
  registration is application Go code and no dashboard can supply it. The UI
  reports which policies are executable rather than offering a button that
  fails.
- `when_tenant_tag` and `custom` rules. The engine returns false for both. They
  are displayed where data contains them and cannot be created.

**Bugs found, not migrated**

- Secret create writes an empty encrypted value and a zero ID. The contract
  path goes through `secret.Service.Set`, which encrypts and assigns an ID.
- The audit log was never written. Wiring `audit.Logger` into
  `secret.Service`'s existing `WithOnAccess` and `WithOnMutate` hooks fixes it,
  which turns four previously dead read surfaces live.

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
