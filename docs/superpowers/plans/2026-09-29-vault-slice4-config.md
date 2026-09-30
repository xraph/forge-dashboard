# Vault Slice 4: Config and Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship config and tenant overrides end to end: a config write service in the vault library that cannot lose data, eleven intents on the vault contract, and React pages for listing, creating, editing (a lazy CodeMirror editor for JSON), diffing and rolling back versions, per-tenant overrides with an explicit unset, a resolve panel, and a cross-key overrides page.

**Architecture:** Same shape as slice 3. In `forgery/vault`, a new `configmgr.Manager` owns every config and override write; the config store gains a key-prefix filter; `extension/contract` gains thin handlers. In `forge-dashboard`, `packages/plugin` gains an `enabled` option on `useQuery` (and flags move onto it), `packages/plugin-vault` gains the config pages with the editor route lazy-loaded, and `packages/fixture-server` models the same contract.

**Tech Stack:** Go 1.26, forge v1.11.2, grove v1.6.3. React 19, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`, CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `lang-json`, `merge`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md`. Read "The 35 intents" (Config, Overrides), "Three subsystems, three shapes", "Lazy loading", and "What slice 3 found that slice 4 must know" first.

**This plan is a precise specification, not complete code.** Behaviours, wire types, test cases and the logic that is easy to get wrong are exact. The rest mirrors a named reference: slice 3's `flag/manager.go`, `extension/contract/handlers_flags.go`, and `packages/plugin-vault/src/pages/flag*.tsx`.

## What checking the write path found

Probed on memory and sqlite (full findings: `config-write-path.md` in this plan's SDD workspace):

1. **Delete leaves overrides behind** on every backend. The resolver keeps serving them for the deleted key, and they come back when the key is recreated.
2. **An override can target a key that does not exist,** with a blank tenant and a value of any type. A mistyped override makes the typed accessors (`Int`, `Duration`...) return the code default for that tenant.
3. **Versions keep only the value,** and `Service.Set` builds a fresh entry every call. A rollback or partial update through it relabels the type and wipes description and metadata. `GetConfigVersion` returns the old value with the *current* type and description.
4. **A zero ID** fails the second create on sqlite and postgres. `ErrConfigExists` is declared and never returned: every set is an upsert, and every write, even a no-op, adds a version.
5. **No validation anywhere:** blank or padded keys, bogus type labels, `"abc"` typed as int.
6. **Numbers arrive as float64,** so an omitted `valueType` is inferred as "float", never "int". Backends return values as different Go types (memory keeps the caller's type, sqlite/postgres float64, mongo int32 and `bson.D`).
7. **No key filter** in the store, `CountConfig` takes no filter, and sqlite errors on an offset with no limit. Override lists are unpaged and there is no list-all.
8. **The resolver returns only a value;** it cannot say where the value came from. Override writes never invalidate its cache. A deleted key with a live override still resolves.
9. **Nothing audits config or override writes;** the four action constants have no callers. `mapError` has no case for `ErrConfigNotFound`.
10. `Service.Watch` fires only from `Service.Set`, never on delete.
11. **The templ pages** store every create as a raw string, silently retype unknown types to "string" on edit, turn invalid JSON into a string, take the app id from the request, and show only overrides on the first 100 keys.

## Decisions this plan makes

1. **A config write service in the library,** `configmgr.Manager`, exposed as `Vault.ConfigManager()`, owning create, update, delete, rollback, set-override and delete-override. Same reasons as `flag.Manager`: findings 1 to 5 are properties every caller needs.
2. **`valueType` is required on create** (the spec had it optional). Inference from a JSON number can only ever say "float", so an omitted type would mislabel every integer. The UI always sends one.
3. **Six value types:** `string`, `int`, `float`, `bool`, `json`, `duration` (a Go duration string such as `"90s"`, the form `Service.Duration` parses). Values are validated against the type on every write, overrides included. An entry already stored with another label (the templ page's `yaml`) is shown read-only with a sentence saying why, never silently retyped.
4. **An update that changes nothing writes nothing:** no version, no audit row. Only a real change mints a version.
5. **Rollback restores the value only,** as a new version, keeping the entry's current type, description and metadata, and refuses with `BAD_REQUEST` when that old value is not valid for the current type. Versions never stored a type, so claiming to restore one would be a lie.
6. **`config.versions` reports value and time only.** `CreatedBy` is never written by any store, so no author column is shown.
7. **Delete removes a key's overrides first, then the entry.** Create clears any orphaned overrides for the key before writing it. Mongo's `DeleteConfig` deletes versions before the entry, so a retry can finish.
8. **`config.list` filters by key prefix,** in the store on all four backends with a matching count. A prefix is indexable; a substring is not.
9. **`overrides.list` needs a tenant or a key** (the store can only list by one of them) and pages the whole list the store returns, so its total is exact.
10. **`config.resolve` answers `NOT_FOUND` for a missing key,** even if an orphaned override exists, and reports `source`, `appValue` and `overrideValue` from reads of its own, on a fresh context.
11. **Override audit rows carry the overridden tenant** as their tenant id. `LogAccess` takes no metadata, and the acting operator's tenant is not what the row is about.
12. **Config watchers fire on every value change the manager makes,** rollback and delete (new value nil) included, not only on `Service.Set`.
13. **`useQuery` gains `enabled`,** so a query can wait for a button. `config.resolve` uses it, and flags' `use-evaluate.ts` moves onto it and is deleted. This touches `packages/plugin`, shared by every plugin; the change is additive and defaults to today's behaviour.
14. **Routes:** `/config`, `/new-config` (not `/config/new`), `/config/:key` (lazy), `/overrides`.
15. **plugin-vault owns its CodeMirror editor,** built like relay's `json-editor.tsx`. Moving one JSON editor into kit for both plugins would edit relay's package, which another session owns; it is recorded as a follow-up.

## Global Constraints

- Go work: `/Users/rexraphael/Work/xraph/forgery/vault`, branch `main`, directly. React work: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`, directly. No worktrees.
- Both repositories are shared with live sessions. Commit only with `git commit --only -- <your paths>` and check `git show --stat HEAD` after. Never run `git reset` (bare or otherwise), `git restore .`, `git restore --staged .`, `git checkout -- .`, `git stash`, `git clean`, or `--amend`. Files carrying someone else's edits are staged with the `git show HEAD:` + `git hash-object -w` + `git update-index --cacheinfo` recipe. Never open a file for writing from a script; use the Edit tool.
- Research and tests touch only this project's own data. Never connect to, or guess credentials for, databases or services that belong to other projects.
- Go gate: `go build ./... && go test ./... && C=$(mktemp -d) && GOLANGCI_LINT_CACHE=$C golangci-lint run ./...`, lint 0 issues, fresh cache every run.
- React gate: `pnpm --filter @forge-go/dashboard-plugin-vault test && pnpm --filter @forge-go/dashboard-plugin-vault typecheck && pnpm --filter @forge-go/dashboard-plugin-vault lint`; a task touching `packages/plugin` also runs `pnpm --filter @forge-go/dashboard-plugin test typecheck lint`.
- Every handler operates on `deps.Vault.AppID()`; no request carries an app id. Handlers call `deps.mapError(intent, err)`. `config.resolve` builds its context from `context.Background()` with app and tenant set explicitly.
- Wire names camelCase on the contract's own types; lists `[]` never `null`; values leave through the same `wireValue` normalisation flags use. Paging is `limit`/`offset` in, `total` out.
- A dialog running a command cannot close while pending; a create page has its own top-level route; secret-style rules for values do not apply (config is not secret).
- Commit messages: no `Co-Authored-By`, no Claude or Anthropic attribution, no em dashes. No em dashes in UI copy or shipped prose.
- Prove any "pre-existing" failure in a clean worktree or from logs, never by editing shared files or with `git stash`.

## Review Focus

1. No write may store a value that is not valid for the entry's type, on create, update, rollback or override; each refusal is `BAD_REQUEST` naming the field.
2. No write may erase a field it did not name: updating the value keeps description and metadata; rollback keeps type, description and metadata.
3. Deleting a key must leave no override that still resolves, and recreating the key must not bring old overrides back.
4. "Revert to app default" (`overrides.delete`) and "set to empty" (`overrides.set` with `""`) must be different acts with different words, and the resolve panel must say which source answered.
5. The config editor route must load CodeMirror only when opened: the eager entry chunk must not contain it, confirmed from `pnpm build` output and written into `BASELINE.md`.

---

## Part A: vault (Go)

### Task A1: Config key-prefix filter and mongo delete order

**Files:** `config/entry.go` (`ListOpts.KeyPrefix`), `config/store.go`, the four backends' config list and count, `store/mongo/store.go` (`DeleteConfig`). Tests: `store/memory/config_filter_test.go`, `store/sqlite/config_filter_test.go`, postgres in its integration style.

- `config.ListOpts` gains `KeyPrefix string`. Empty means all. Every backend filters in the query: sqlite and postgres `key LIKE ? ESCAPE '\'` with `%` and `_` in the prefix escaped; mongo an anchored regex with the prefix `regexp.QuoteMeta`-escaped; memory `strings.HasPrefix`.
- Add `CountConfigMatching(ctx, appID string, opts ListOpts) (int64, error)` honouring `KeyPrefix`, on the interface and all four backends. `CountConfig` stays.
- Memory returns `[]*Entry{}` for an empty page.
- Mongo `DeleteConfig`: delete versions first, then the entry; return `ErrConfigNotFound` only when nothing at all was deleted.
- Tests (fail first): keys `db.host`, `db.port`, `dbx`, `cache.ttl`, `db_x`: prefix `db.` returns exactly the two `db.` keys with count 2; prefix `db_` does not match `dbx` (underscore escaped); limit/offset page within the filter; an empty page past the end keeps the count.

Commits: `feat(config): filter config entries by key prefix`, `fix(store): delete a config's versions before the config on mongo`.

### Task A2: `configmgr.Manager`

**Files:** create `configmgr/manager.go` (new package `configmgr`: `override` imports `config`, so a manager in `config` cannot reach the override store), `config/validate.go`, tests; modify `config/service.go` (exported `Notify(ctx, key string, oldValue, newValue any)` that runs the watchers `Set` runs), `vault.go` (`ConfigManager() *configmgr.Manager`), `audit_hook/events.go` (`ActionConfigRolledBack = "config.rolled_back"`, added to `AllActions` and its test), `extension/contract/errors.go`.

**Interfaces (exact):**

```go
package config // validate.go

type ValidationError struct{ Field, Message string }
func (e *ValidationError) Error() string // "config: <field>: <message>"

// Types the manager accepts. An entry stored with any other label is read-only.
const (TypeString = "string"; TypeInt = "int"; TypeFloat = "float"; TypeBool = "bool"; TypeJSON = "json"; TypeDuration = "duration")
func KnownType(t string) bool
func ValidateValue(valueType string, v any) error

package configmgr // manager.go

type Manager struct{ /* store config.Store; overrides override.Store; resolver *override.Resolver (may be nil); service *config.Service (for watchers, via Notify); appID string; onMutate func(ctx context.Context, action, resource, key, appID, tenantID string) */ }
type ManagerOption func(*Manager)
func WithManagerAppID(appID string) ManagerOption
func WithOnConfigMutate(fn func(ctx context.Context, action, resource, key, appID, tenantID string)) ManagerOption
func NewManager(store config.Store, overrides override.Store, resolver *override.Resolver, svc *config.Service, opts ...ManagerOption) *Manager

type CreateInput struct{ Key, ValueType, Description string; Value any }
func (m *Manager) Create(ctx context.Context, in CreateInput) (*config.Entry, error)
type UpdateInput struct{ Value *any; ValueType *string; Description *string }
func (m *Manager) Update(ctx context.Context, key string, in UpdateInput) (*config.Entry, error)
func (m *Manager) Delete(ctx context.Context, key string) error
func (m *Manager) Rollback(ctx context.Context, key string, version int64) (*config.Entry, error)
func (m *Manager) SetOverride(ctx context.Context, key, tenantID string, value any) (*override.Override, error)
func (m *Manager) DeleteOverride(ctx context.Context, key, tenantID string) error
```

`override` imports `config`, which is why the manager has its own package. `configmgr` imports both and neither imports it.

Behaviour, exactly:
- **Key:** trimmed non-empty, no leading or trailing space, at most 256 bytes (as flags). **Tenant:** trimmed non-empty.
- **`ValidateValue`:** string: Go `string`. int: a whole `float64` within ±2^53, or any Go integer. float: any Go number. bool: Go `bool`. json: anything JSON-marshallable, `nil` allowed. duration: a `string` accepted by `time.ParseDuration`. `nil` refused for every type but json. Unknown type: `ValidationError{Field: "valueType"}`.
- **Create:** validate key, `valueType` (required, known), value. `GetConfig` found means `vault.ErrConfigExists` (core sentinel, as flags). Clear orphaned overrides for the key (list by key, delete each). Write the entry with `ID: id.NewConfigID()`, `AppID`, `Version` left zero for the store to number, `core.NewEntity()` times. Invalidate the resolver for the key, notify watchers (old nil, new value), audit `config.set` resource `config`. Re-read and return.
- **Update:** read (NOT_FOUND passes through). Apply only the non-nil fields. If `ValueType` changes, a `Value` must be given too and must be valid for the new type; a type change alone is `ValidationError{Field: "valueType", Message: "changing the type needs a value of that type"}`. The entry's own type must be known to change its value (`ValidationError{Field: "valueType", Message: "this entry's type <t> is not one the vault supports"}`). If nothing differs (value deep-equal after `wireValue`-style JSON normalisation, same type, same description), return the entry without writing, auditing or notifying. Otherwise write the full merged entry (ID, metadata, CreatedAt kept), invalidate, notify, audit `config.set`.
- **Delete:** read (NOT_FOUND passes through), delete every override for the key, then `DeleteConfig`, invalidate, notify (new nil), audit `config.deleted`.
- **Rollback:** read the entry; find `version` in `ListConfigVersions` (not `GetConfigVersion`); missing version is `NOT_FOUND` via a new `ErrConfigVersionNotFound` core sentinel (message "config version not found"). Validate that value against the entry's current type (`ValidationError{Field: "version", Message: "version <n> holds <describe>, not a <type>"}`). Rolling back to a value equal to the current one is a no-op as in Update. Otherwise write the merged entry with that value, invalidate, notify, audit `config.rolled_back`.
- **SetOverride:** key must exist (NOT_FOUND); tenant valid; value valid for the entry's type (field `value`). `ID: id.NewOverrideID()` when new (the store may keep an existing ID). Invalidate the resolver for key and tenant, audit `override.set` resource `override` with the audit row's tenant set to the overridden tenant.
- **DeleteOverride:** key must exist; the store's `ErrOverrideNotFound` passes through; invalidate; audit `override.deleted` with the overridden tenant.
- **Wiring in `vault.go`:** build after the resolver and config service; the mutate hook calls `v.auditLog.LogAccess(scope.WithTenantID(scope.WithAppID(ctx, appID), tenantID), key, action, resource)`. `func (v *Vault) ConfigManager() *config.Manager`.
- **`errors.go`:** `vault.ErrConfigNotFound` → `NOT_FOUND "config entry not found"`; `vault.ErrConfigExists` → `CONFLICT "a config entry with this key already exists"`; `ErrConfigVersionNotFound` → `NOT_FOUND "config version not found"`; `*config.ValidationError` → `BAD_REQUEST` with its text. `ErrOverrideNotFound` stays unmapped globally (flags' handler maps it itself; config's handler will too).

Tests (fail first, memory and sqlite through `vault.New`): create twice → `ErrConfigExists`, nothing changed; two creates without IDs on sqlite; create after an orphan override was written through the store → no override; `"abc"` as int, `1.5` as int, `"soon"` as duration, `nil` as string each refused naming the field; json accepts nil; update of value keeps description and metadata (seeded through the store); a no-op update mints no version and no audit row; type change without a value refused; delete removes overrides and the resolver no longer resolves the key for that tenant; rollback to v1 restores the value, keeps the current type and description, adds a version; rollback of a value invalid for the current type refused; rollback to a missing version → not found; override on a missing key → not found, mistyped override refused; every write writes one audit row with the right action, resource and tenant; watchers fire on update, rollback and delete.

Commits: `feat(config): add a write service that validates and never erases`, `feat(contract): map config errors`.

### Task A3: Config and override queries

**Files:** create `extension/contract/handlers_config.go`, tests; modify `project.go`, `manifest.yaml`, `contract.go`.

Wire types:

```go
type ConfigEntrySummary struct {
    ID string `json:"id"`; Key string `json:"key"`; Value any `json:"value"`; ValueType string `json:"valueType"`
    // KnownType is false for a label the vault does not validate (e.g. the templ page's "yaml").
    KnownType bool `json:"knownType"`; ValueMatchesType bool `json:"valueMatchesType"`
    Version int64 `json:"version"`; Description string `json:"description"`; Metadata map[string]string `json:"metadata"`
    CreatedAt string `json:"createdAt"`; UpdatedAt string `json:"updatedAt"`
}
type ConfigVersionSummary struct { Version int64 `json:"version"`; Value any `json:"value"`; ValueMatchesType bool `json:"valueMatchesType"`; CreatedAt string `json:"createdAt"`; Current bool `json:"current"` }
type OverrideSummary struct { Key string `json:"key"`; TenantID string `json:"tenantId"`; Value any `json:"value"`; ValueMatchesType bool `json:"valueMatchesType"`; UpdatedAt string `json:"updatedAt"` }
```

- `config.list {keyPrefix?, limit, offset}` → `{entries, total}` (default 25, max 100; always passes a limit to the store).
- `config.detail {key}` → `{entry, overrides: OverrideSummary[] (tenantId order), recentAudit: AuditSummary[] (resource config and override, both, for this key, newest first, 10)}`. The audit for a key spans two resources; fetch both with `Resource` filters and merge by time, or document the chosen approach.
- `config.versions {key}` → `{versions}` newest first; `valueMatchesType` against the entry's current type; `current` true on the entry's version.
- `config.resolve {key, tenantId?}` → `{value, valueMatchesType, source: "override"|"appDefault", appValue, overrideValue?, tenantId?}`. Missing key → `NOT_FOUND`. With a tenant that has an override: source override. Built on a fresh context.
- `overrides.list {tenantId?, key?, limit, offset}` → `{overrides, total}`; neither given → `BAD_REQUEST "give a tenantId or a key"`; both given → the one override (or empty). Orphaned overrides (key missing) are listed with `valueMatchesType: false` and a `keyExists: false` field, so the page can say so.

Manifest queries plus `queries:` cache block entries (list/detail/versions 30s, resolve 0s, overrides.list 30s).

Tests (fail first): prefix filter and total; detail projects every field, `{}` metadata not null; a stored `yaml` entry reports `knownType: false`; versions newest first with `current`; resolve source for override and app default, NOT_FOUND for a missing key with an orphan override, and not inheriting a tenant from the incoming context; overrides.list by tenant and by key, BAD_REQUEST with neither, exact paging total, an orphan reported with `keyExists: false`; recentAudit shows override rows for the key.

Commit: `feat(contract): add the config and override queries`.

### Task A4: Config and override commands

**Files:** `handlers_config.go`, tests, sqlite test, `manifest.yaml`, `contract.go`, `transport_test.go` (one more case).

Manifest invalidates:
- `config.create` → `[config.list, config.detail, config.versions, config.resolve, overrides.list]`
- `config.update`, `config.rollback` → `[config.list, config.detail, config.versions, config.resolve]`
- `config.delete` → `[config.list, config.detail, config.versions, config.resolve, overrides.list]`
- `overrides.set`, `overrides.delete` → `[config.detail, config.resolve, overrides.list]`

Requests:
- `config.create {key, valueType, value, description?}` → `{entry}`; `valueType` absent is `BAD_REQUEST "valueType is required"`.
- `config.update {key, value?, valueType?, description?}` → `{entry}`; `value` distinguishes absent from JSON `null` (the `optionalValue` helper from flags).
- `config.delete {key}` → `{ok, key}`. `config.rollback {key, version}` → `{entry}`.
- `overrides.set {key, tenantId, value}` → `{override}`; `value` absent is `BAD_REQUEST "value is required"` (absent is not null).
- `overrides.delete {key, tenantId}` → `{ok, key, tenantId}`; missing override → `NOT_FOUND "tenant override not found"`.

Every handler goes through `deps.Vault.ConfigManager()`.

Tests (fail first): each happy path; CONFLICT leaves the entry unchanged; update absent vs null (null on a string entry is 400, on a json entry stores null); no-op update returns the entry and adds no version; rollback happy path and refusal; overrides.set on a missing key 404, mistyped 400; the explicit unset removes the override and resolve reports appDefault; transport test: `overrides.delete`'s manifest invalidates reach meta. sqlite: update value only keeps description and metadata; delete then recreate shows no old override.

Commit: `feat(contract): add the config and override commands`.

---

## Part B: forge-dashboard (React)

### Task B0: `useQuery` waits when told to

**Files:** `packages/plugin/src/hooks.ts`, its tests; `packages/plugin-vault/src/use-evaluate.ts` (delete), `src/pages/flag-detail.tsx`, `src/components/evaluate-bar.tsx` and their tests.

- `useQuery(intent, params?, options?: { enabled?: boolean })`. `enabled` defaults to `true` (today's behaviour). When `false`: no request is issued, the hook returns `{ data: undefined, error: undefined, loading: false, refetch }`, it does not subscribe to or read a store entry, and invalidation does not issue a request for it. Turning `enabled` from false to true issues the read. `refetch` while disabled does nothing.
- Flags' evaluation moves onto `useQuery("flags.evaluate", params, { enabled: submitted !== null })`; `use-evaluate.ts` is deleted; every flag evaluation test still passes unchanged in intent (adapt only mechanics).
- Tests: disabled issues no request; enabling issues one; invalidating a disabled query issues none; existing `useQuery` tests unchanged.

Commit: `feat(plugin): let a query wait until it is enabled` and `refactor(plugin-vault): evaluate flags through useQuery`.

### Task B1: Config list and create

**Files:** create `src/pages/config.tsx`, `src/pages/config-create.tsx`, `src/components/config-value.tsx`, tests; modify `src/index.tsx` (nav "Config" group: Config `/config` priority 30, Overrides `/overrides` priority 40; routes `/config`, `/new-config`, `/config/:key` placeholder, `/overrides` placeholder), `src/keys.ts` (`configPath(key)`), `src/badges.tsx`, `src/components/value-input.tsx` (add `duration`).

- `ValueInput` gains type `duration`: a text input accepting what Go's `time.ParseDuration` accepts (`^[-+]?((\d+(\.\d*)?|\.\d+)(ns|us|µs|ms|s|m|h))+$` or `0`), reporting `undefined` with a message otherwise. Add a `ConfigType` union and keep flags' `FlagType` separate; ValueInput takes the union.
- `ConfigValue({value, valueType})`: renders like `FlagValue`, and for `duration` shows the string mono.
- List: `useQuery("config.list", {keyPrefix, limit: 25, offset})`, a "Key starts with" input (debounced 300ms, trimmed, resets offset). Columns Key (mono medium, link), Type badge (Unsupported type badge `secondary` when not known), Value (`ConfigValue`, Wrong type badge when `valueMatchesType` false), Version (`v{n}` mono), Updated. Caption `{total} entr(y|ies)`. Empty: "No config yet." / "No keys start with {prefix}."
- Create (`/new-config`): Key, Type (the six), Value (`ValueInput`; JSON uses a plain mono textarea here, not CodeMirror, to keep the create route light), Description. CONFLICT shows the submitted key with "Open the existing entry". Success navigates to the entry.

Tests: columns, caption at zero, prefix filter sends `keyPrefix` and resets offset, unsupported type badge; duration input accepts `90s`, `1h30m`, `0`, refuses `soon`; create sends typed values (int as number, bool as boolean, json parsed, duration string) and `valueType`; CONFLICT link keeps the submitted key.

Commit: `feat(plugin-vault): list and create config entries`.

### Task B2: The config editor, versions and rollback (lazy route)

**Files:** create `src/pages/config-detail.tsx` (default export, lazy), `src/components/json-editor.tsx` (CodeMirror, default export), `src/components/json-diff.tsx` (`@codemirror/merge`, default export), tests; modify `src/index.tsx` (`lazy(() => import("./pages/config-detail"))`), `package.json` (CodeMirror packages at relay's versions plus `@codemirror/merge`; plugin-vault lockfile hunk only).

- Page: PageHeader key (mono), type badge, Delete. Definition: description (Edit dialog, sends only description), metadata read-only. Value editor: `json` entries get `JsonEditor` (lazy-loaded inside the lazy route too, showing the value as a `<pre>` until CodeMirror arrives, like relay's `json-view.tsx`), with parse errors shown under it with line and column, and Save disabled until it parses and differs from the stored value. Other known types get `ValueInput`. Unknown types: read-only value and the sentence "This entry's type, {t}, is not one the vault validates, so its value cannot be edited here." Save sends `config.update {key, value}` only; the success line says "Saved as version {n}." A save that changes nothing is never sent (Save disabled).
- Versions: newest first, `v{n}` mono, value preview, time, "Current" badge on the current one. Selecting a version shows a diff against the current value: json via `JsonDiff` (lazy), scalars as "Was {old}. Now {new}." A version whose value is not valid for the current type shows the Wrong type badge and its Roll back button is disabled with that reason. Roll back: `ConfirmDialog` "Roll back {key} to version {n}? This saves its value as a new version. The type and description stay as they are." with `pending`.
- Delete: `ConfirmDialog` "This deletes {key}, its {n} version(s) and {m} tenant override(s). Applications fall back to their own default." then navigate to `/config`.
- NOT_FOUND ("config entry not found") renders "No config entry named {key}."

Tests (with CodeMirror mocked only where jsdom cannot run it; `JsonEditor` itself gets a test that it reports parse errors): save sends only value; Save disabled when unchanged or unparseable; unknown type read-only; rollback copy and payload; rollback disabled for a mismatched version; diff shows "Was/Now" for scalars; delete copy counts.

Commit: `feat(plugin-vault): edit config values, compare versions and roll back`.

### Task B3: Overrides, the explicit unset, resolve, and the overrides page

**Files:** modify `src/pages/config-detail.tsx`; create `src/components/resolve-panel.tsx`, `src/pages/overrides.tsx`, tests.

- On the entry page, an Overrides section: rows tenant (mono medium), value (`ConfigValue`, Wrong type badge), updated, and two actions: "Change" (dialog with `ValueInput` for the entry's type) and "Revert to app default" (`ConfirmDialog` "Tenant {t} goes back to the app default, {appValue}." sending `overrides.delete`). "Add override" dialog: tenant id and value. Setting a string entry's override to `""` is allowed and shown quoted; the words "Revert to app default" appear only on the delete action.
- Resolve panel (`useQuery("config.resolve", {key, tenantId}, {enabled})` after a button press): "Resolve for tenant" input, Resolve and Clear. Result: "Tenant {t} gets {value}, from its override." or "Tenant {t} gets {value}, the app default." (no tenant: "Without a tenant, the app default is {value}."). When an override answered, also "The app default is {appValue}."
- `/overrides` page: asks first ("Show overrides for a tenant" / "for a key", one input each, one active at a time), then lists with `useQuery("overrides.list", ...)` and paging. Columns Key (mono, link to the entry), Tenant (mono), Value, Updated, and "Revert to app default". Orphans (`keyExists: false`) show "Key deleted" (`destructive`) and only the revert action. Empty prompt state before a choice: "Pick a tenant or a key to see its overrides. The store can only list them one way at a time."

Tests: add override sends a typed value; "" allowed on a string entry; revert sends `overrides.delete` and its copy names the app default; resolve sentences for both sources and no tenant; overrides page sends `tenantId` or `key` only, never both, and never queries before a choice; orphan row.

Commit: `feat(plugin-vault): manage tenant overrides and resolve a key`.

### Task B4: Fixtures, verify, bundle baseline, click-through

**Files:** `packages/fixture-server/vault-fixtures.mjs`, `verify.mjs` (other sessions' edits: Edit tool, cacheinfo recipe), `BASELINE.md` (append a section).

- Seed: 30 config entries across all six types plus one `yaml` entry and one entry whose stored value is wrong for its type; several with 3+ versions (json ones with nested changes); overrides on several keys for tenants `acme`, `globex`; one orphaned override on a deleted key.
- Handlers mirror Go exactly (messages, validation, no-op updates, rollback rules, delete order, NOT_FOUND texts, resolve sources, override audit tenants, invalidates).
- verify: every config and override intent; each command's invalidates vs the manifest; delete removes overrides; rollback keeps type and description; overrides.list refuses neither; resolve sources.
- Bundle: `pnpm --filter @forge-go/dashboard-shell build`, then record in `BASELINE.md` the entry chunk size with and without the vault config route, and the lazy chunks for `config-detail`, `json-editor` and `json-diff`, and confirm by grepping the built entry chunk that no CodeMirror code is in it.
- The controller clicks through in the real shell against its own fixture (as slice 3).

Commits: `feat(fixture-server): model vault's config and override intents`, `docs: measure the vault config editor chunks`.

---

## Done when

- Go gate clean, `go test -race ./config/ ./override/ ./extension/... ./store/...` clean.
- React gate clean for plugin-vault and plugin; `pnpm -r test` has no failure this slice introduced.
- verify passes every vault check; the click-through is done and its findings fixed or recorded.
- `BASELINE.md` has the measured chunks and the entry chunk is free of CodeMirror.
- The spec gains "What slice 4 found that slice 5 must know", and the MIGRATION notes gain the templ config bugs and anything dropped.
