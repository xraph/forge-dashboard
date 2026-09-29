# Vault Slice 3: Feature Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship feature flags end to end: a flag write service in the vault library that cannot corrupt data, ten flag intents on the vault contract, and a React surface built around the flag ladder, its evaluation mode and a whole-list rule editor, runnable against the fixture server.

**Architecture:** Three layers. In `forgery/vault`, a new `flag.Manager` owns every flag write (validation, existence checks, IDs, cache invalidation, audit) so library callers and the dashboard get the same guarantees; the store gains a type filter and an audit resource filter. `extension/contract` gains ten thin handlers over it. In `forge-dashboard`, `packages/plugin-vault` gains a list, a create page and the ladder detail page, and `packages/fixture-server` models the same contract.

**Tech Stack:** Go 1.26, forge v1.11.2 dashboard contract, grove v1.6.3 (memory, sqlite, postgres, mongo stores). React 19, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` at kit's versions, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md`. Read "The 35 intents" (Flags), "The flag ladder", "The rule editor", "Kit and conventions" and all of "What slice 2 found that slice 3 must know" before any task.

**This plan is a precise specification, not complete code.** Wire types, behaviours, test cases and the logic that is easy to get wrong are given exactly. The rest mirrors a named reference file. Implementers write the code; reviewers hold it to this text.

## What checking the write path found

Before designing anything, the flag write path was read and probed on sqlite and memory. Each of these would make a dashboard flag surface lose data or lie:

1. `DefineFlag` is an upsert everywhere. Creating an existing key silently replaces it, type included. `ErrFlagExists` is declared and never returned.
2. A definition with a zero ID stores `""` as the primary key on sqlite, postgres and mongo, so the second such flag fails on a unique violation.
3. `DefineFlag` rewrites every column, including `Variants` and `Metadata`, which no request names. An update built from a fresh `Definition` erases both.
4. sqlite, postgres and mongo accept `SetFlagRules` and `SetFlagTenantOverride` for a key that does not exist (memory accepts the override). A flag created later with that key inherits them.
5. Nothing outside tests calls `Engine.Invalidate`, and the cache is read before the store, so disabling a flag keeps serving cached values for up to 30 seconds.
6. Nothing validates a flag's type, its default against its type, a rule's config, or a return or override value against the type. The templ create page stores every default as a string, so every bool, int and float flag it made evaluates to the caller's fallback.
7. No store filters flags by type or tag, and `CountFlagDefinitions` takes only an app id.
8. There is no flag audit. And `ListAuditByKey` does not filter by resource, so the moment flags write audit rows, `secrets.detail`'s recent audit shows a flag's rows for a flag sharing the secret's key.
9. `mapError` has no case for `ErrFlagNotFound` or `ErrOverrideNotFound`, so both reach the client as `INTERNAL`.
10. Mongo's `DeleteFlagDefinition` deletes the definition first and the rules and overrides after, with no transaction; a retry stops at `ErrFlagNotFound` and the orphans are permanent.
11. Values come back as different Go types per backend (float64 from JSON columns, int32 and `bson.D` from mongo, the caller's own type from memory). Only the JSON wire level is stable.

Full findings with file and line: the slice 3 section of the SDD workspace carries `flags-write-path.md`.

## Decisions this plan makes (flag any you disagree with at plan review)

1. **A flag write service in the library, not logic in handlers.** `flag.Manager` owns create, update, delete, enable, rules and overrides, and is exposed as `Vault.FlagManager()`. Findings 1 to 6 are properties every caller needs, not dashboard concerns, and the spec's first decision was that the advertised API should exist before a second consumer builds a parallel copy. Handlers stay thin.
2. **Every flag write invalidates the local cache and writes an audit row.** Invalidation fixes only the replica that served the write; the evaluate surface says so, with the configured TTL.
3. **Values are validated against the flag's type everywhere they enter:** default, rule return values, tenant overrides. `bool` takes a JSON boolean, `string` a string, `int` a whole number within ±2^53, `float` any number, `json` any JSON value. A flag already stored with a mismatched default (the templ bug) is shown as such, never silently repaired.
4. **Dead rule types round-trip but cannot be added.** `when_tenant_tag` and `custom` are accepted by `SetRules` so saving a list that already holds one does not delete it, and they render as never matching. The add-rule menu offers only `when_tenant`, `when_user`, `rollout`, `schedule`.
5. **`flags.list` filters by type, not by tag.** A type filter is one column on every backend, with a matching count, so paging stays exact. A tag filter needs JSON-array queries in three dialects; it is recorded as a gap, and dropping the templ page's type-only filter would have been a regression.
6. **The audit store filters by resource.** `audit.ListOpts` gains `Resource`, honoured by `ListAudit`, `ListAuditByKey` and `CountAudit`'s new sibling, so `secrets.detail` and `flags.detail` each show only their own rows. Slice 5 needs the same filter.
7. **Mongo delete runs children first.** Rules and overrides go before the definition, so a retry after a partial failure finishes the job. Mongo's non-transactional `SetFlagRules` stays as it is and is recorded.
8. **The create route is `/new-flag`,** per slice 2's rule, not `/flags/new`.
9. **Variants and metadata are shown read-only and preserved by every write.** The engine never reads variants; the page says so.
10. **Last writer wins on concurrent edits.** No store has a version column. Recorded, not fixed.

## Global Constraints

- Go work: `/Users/rexraphael/Work/xraph/forgery/vault`, branch `main`, directly (no worktree). React work: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`.
- Both repositories are shared with other live sessions. Commit ONLY with `git commit --only -- <your paths>` and check `git show --stat HEAD` straight after. Files carrying someone else's unstaged edits are staged with the `git show HEAD:` + `git hash-object -w` + `git update-index --cacheinfo` recipe.
- Go gate at the end of every Go task: `go build ./... && go test ./... && C=$(mktemp -d) && GOLANGCI_LINT_CACHE=$C golangci-lint run ./...`, lint 0 issues. Always a fresh lint cache: a reused one reports phantom issues from other checkouts.
- React gate at the end of every React task: `pnpm --filter @forge-go/dashboard-plugin-vault test && pnpm --filter @forge-go/dashboard-plugin-vault typecheck && pnpm --filter @forge-go/dashboard-plugin-vault lint`. The last task also runs `pnpm -r test`.
- Every handler operates on `deps.Vault.AppID()`. No request carries an app id.
- Handlers map errors through `deps.mapError(intent, err)`, never the package-level `mapError`.
- `flags.evaluate` builds its context from `context.Background()` with `scope.WithAppID`, `scope.WithTenantID` and `scope.WithUserID` set explicitly, each to `""` when absent. It never inherits the request context's tenant or user.
- Wire field names are camelCase on the contract's own projection types. Domain types are never serialised directly. Lists are `[]`, never `null`.
- Paging is `limit` and `offset` in, `total` out.
- A dialog running a command cannot close while it is pending. A create page lives at its own top-level route.
- Commit messages: no `Co-Authored-By`, no Claude or Anthropic attribution, no em dashes. No em dashes in any UI copy or shipped prose.
- Prove any "pre-existing" failure in a clean worktree at the base, never with `git stash`.
- Never open a file for writing before reading it.

## Review Focus

1. A value of the wrong type must never be stored: a bool flag's default, rule return value or override given `"true"` (a string) is refused with `BAD_REQUEST` naming the field, on every intent that takes a value.
2. Disabling a flag must change `flags.evaluate` and the engine's `Evaluate` on the serving replica immediately, not after the TTL.
3. Saving a rule list that contains an existing `when_tenant_tag` or `custom` rule must keep it byte for byte, and the editor must never offer to add one.
4. Creating, updating, enabling, or setting rules on a flag must never erase its variants or metadata, and creating an existing key must refuse with `CONFLICT` without changing the stored flag.
5. The ladder must never present a rung as deciding, or a rule as matching, unless the engine's own `EvaluateDetail` said so; with no evaluation run, no rung is marked.

---

## Part A: vault (Go)

### Task A1: The audit resource filter and mongo's delete order

**Files:** Modify `audit/entry.go`, `audit/store.go`, the four backends' audit list code (`store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/audit.go`, `store/mongo/store.go`), `extension/contract/handlers_secrets.go` (recent audit call), `store/mongo/store.go` (`DeleteFlagDefinition`). Tests: `store/memory/audit_filter_test.go`, `store/sqlite/audit_filter_test.go` (create), the secrets detail handler test.

**sqlite caution:** `store/sqlite/store.go` may carry another session's edits. Before editing, run `git diff -- store/sqlite/store.go`. If it is not clean, put your sqlite changes in a new file where possible, or stage with the cacheinfo recipe.

- `audit.ListOpts` gains `Resource string`. Empty means every resource. `ListAudit` and `ListAuditByKey` honour it on all four backends as an indexed-column equality filter in the query, never a post-filter.
- `CountAudit(ctx, appID)` is unchanged. Add `CountAuditMatching(ctx context.Context, appID string, opts ListOpts) (int64, error)` honouring `Resource` (Limit and Offset ignored), on the interface and all four backends. Slice 5 extends it.
- `secrets.detail`'s recent audit passes `Resource: audithook.ResourceSecret`.
- Mongo `DeleteFlagDefinition`: delete rules, then overrides, then the definition; return `ErrFlagNotFound` only if the definition was already gone AND nothing was deleted, so a retry after a partial failure succeeds in cleaning up.

Tests (fail first): memory and sqlite, three rows for key `k` (two resource `secret`, one `flag`) and one for another key: `ListAuditByKey(k, {Resource:"secret"})` returns exactly the two, `{}` returns three, `CountAuditMatching({Resource:"flag"})` is 1. Secrets detail: a `flag` audit row on the same key does not appear in `recentAudit`.

Commit: `feat(audit): filter audit entries by resource`, and the mongo change as `fix(store): delete a flag's rules and overrides before the flag on mongo`.

### Task A2: The flag type filter

**Files:** Modify `flag/definition.go` (`ListOpts`), `flag/store.go`, the four backends' flag list and count. Tests: `store/memory/flag_filter_test.go`, `store/sqlite/flag_filter_test.go`, postgres in its integration style.

- `flag.ListOpts` gains `Type Type`. Empty means every type. `ListFlagDefinitions` filters by it in the query on all four backends.
- Add `CountFlagDefinitionsMatching(ctx context.Context, appID string, opts ListOpts) (int64, error)` honouring `Type`. The existing `CountFlagDefinitions` stays.
- Memory's empty list returns `[]*Definition{}`, not nil.

Tests (fail first): five flags of mixed types; `Type: bool` with Limit 2 Offset 0 returns the first two bool flags in key order and the count equals the number of bool flags; a page past the end returns empty with the same count.

Commit: `feat(flag): filter flag definitions by type`.

### Task A3: `flag.Manager`, the write service

**Files:** Create `flag/manager.go`, `flag/validate.go`, `flag/manager_test.go`, `flag/validate_test.go`. Modify `vault.go` (wire it, add `FlagManager()`), `audit_hook/events.go` (three actions), `extension/contract/errors.go` (flag sentinels), `core/errors.go` only if a new sentinel is needed.

**Interfaces produced (exact):**

```go
package flag

type Manager struct { /* store Store; engine *Engine; appID string; onMutate func(ctx context.Context, action, key, appID string) */ }

type ManagerOption func(*Manager)
func WithManagerAppID(appID string) ManagerOption
func WithOnFlagMutate(fn func(ctx context.Context, action, key, appID string)) ManagerOption

func NewManager(store Store, engine *Engine, opts ...ManagerOption) *Manager

// CreateInput is everything a new flag carries. DefaultValue must match Type.
type CreateInput struct {
    Key          string
    Type         Type
    DefaultValue any
    Description  string
    Tags         []string
    Enabled      bool
}
func (m *Manager) Create(ctx context.Context, in CreateInput) (*Definition, error)

// UpdateInput changes only the fields that are non-nil.
type UpdateInput struct {
    Description  *string
    DefaultValue *any
    Tags         *[]string
}
func (m *Manager) Update(ctx context.Context, key string, in UpdateInput) (*Definition, error)
func (m *Manager) SetEnabled(ctx context.Context, key string, enabled bool) (*Definition, error)
func (m *Manager) Delete(ctx context.Context, key string) error

// SetRules replaces the whole list. Priority is assigned from the index.
func (m *Manager) SetRules(ctx context.Context, key string, rules []RuleInput) ([]*Rule, error)
type RuleInput struct {
    Type        RuleType
    Config      RuleConfig
    ReturnValue any
}

func (m *Manager) SetTenantOverride(ctx context.Context, key, tenantID string, value any) (*TenantOverride, error)
func (m *Manager) DeleteTenantOverride(ctx context.Context, key, tenantID string) error

// Validation errors. Handlers map any *ValidationError to BAD_REQUEST with its message.
type ValidationError struct { Field, Message string }
func (e *ValidationError) Error() string // "flag: <field>: <message>"
```

Behaviour, exactly:

- **Create:** validate key (non-empty after trim, no leading or trailing space, at most 256 bytes), type (one of bool, string, int, float, json), default against type. `GetFlagDefinition` first: found means return `vault.ErrFlagExists`; `ErrFlagNotFound` means proceed; any other error returns. Build the definition with `ID: id.NewFlagID()`, `AppID`, and `core.NewEntity()` for the timestamps; nil tags become `[]string{}`. Call `DefineFlag`. Then clear anything orphaned under that key (finding 4), in this order: `SetFlagRules(ctx, key, appID, []*Rule{})` (safe now that the flag exists, including on memory), then `ListFlagTenantOverrides` and `DeleteFlagTenantOverride` for each. Invalidate, audit `flag.created`, re-read and return the stored definition.
- **Update / SetEnabled:** read the definition (`ErrFlagNotFound` passes through), change only the named fields, validate a new default against the stored type, `Touch()`, `DefineFlag` the whole row (so Variants, Metadata, ID and CreatedAt survive), invalidate, audit, re-read and return. `SetEnabled` with the current value is a no-op write that still returns the definition and writes no audit row.
- **Delete:** `DeleteFlagDefinition`, invalidate, audit.
- **SetRules:** flag must exist. Validate each rule by type:
  - `when_tenant`: `TenantIDs` non-empty, each trimmed and non-empty, no duplicates.
  - `when_user`: same over `UserIDs`.
  - `rollout`: `0 <= Percentage <= 100`.
  - `schedule`: at least one of `StartAt`, `EndAt`; both set means `StartAt` strictly before `EndAt`. Store both `.UTC()`.
  - `when_tenant_tag`, `custom`: accepted with their config as given (decision 4).
  - any other type: `ValidationError{Field: "rules[i].type"}`.
  - `ReturnValue` validated against the flag's type.
  - Priority = index. Each rule gets `id.NewRuleID()`, `FlagKey`, `AppID`.
  Then `SetFlagRules`, invalidate, audit `flag.rules_set`, return `GetFlagRules`.
- **SetTenantOverride:** flag must exist, tenant id trimmed non-empty, value against type. `ID: id.NewOverrideID()` on a new override (the store keeps an existing ID). Invalidate, audit `flag.override_set`.
- **DeleteTenantOverride:** flag must exist; the store's `ErrOverrideNotFound` passes through. Invalidate, audit `flag.override_deleted`.
- **Value validation (`flag/validate.go`), `func ValidateValue(t Type, v any) error`:** bool: Go `bool`. string: Go `string`. int: `float64` with no fractional part and `|v| <= 2^53`, or any Go integer type. float: `float64` or any Go integer or float type. json: anything except a value that cannot be JSON-marshalled. A nil value is refused for every type except json.
- **Audit actions:** `flag.created`, `flag.updated`, `flag.toggled` (SetEnabled), `flag.deleted` (existing constants) plus new `ActionFlagRulesSet = "flag.rules_set"`, `ActionFlagOverrideSet = "flag.override_set"`, `ActionFlagOverrideDeleted = "flag.override_deleted"` added to `audit_hook/events.go` and `AllActions`. The manager calls `onMutate(ctx, action, key, appID)`; `vault.go` wires it to `v.auditLog.LogAccess(scope.WithAppID(ctx, appID), key, action, audithook.ResourceFlag)`, mirroring the secret hooks.
- **vault.go:** build the manager after the engine: `v.flagManager = flag.NewManager(v.store, v.engine, flag.WithManagerAppID(v.config.AppID), flag.WithOnFlagMutate(...))`, and `func (v *Vault) FlagManager() *flag.Manager`.
- **errors.go (contract):** `vault.ErrFlagNotFound` → `NOT_FOUND "flag not found"`; `vault.ErrFlagExists` → `CONFLICT "a flag with this key already exists"`; `*flag.ValidationError` → `BAD_REQUEST` with its `Error()` text. `ErrOverrideNotFound` is shared with config, so it is NOT mapped globally; the flag override handler maps it itself to `NOT_FOUND "tenant override not found"`.

Tests (fail first, memory and sqlite through `vault.New`):
- create twice: second is `ErrFlagExists`, and the stored type is unchanged.
- two creates without IDs on sqlite both succeed.
- create after orphaned rules and an override were written directly through the store for that key: the new flag has no rules and no overrides.
- update changing only description keeps Variants, Metadata, ID, CreatedAt (seed Variants and Metadata through the store).
- disabling after an `Evaluate` that cached `true`: the next `Evaluate` returns the default immediately (long TTL engine).
- every value path refuses `"true"` for a bool flag with a `*ValidationError` naming the field (`defaultValue`, `rules[0].returnValue`, `value`).
- `int` refuses 1.5 and accepts 2.0; `json` accepts `nil`.
- rules: a rollout of 101, a schedule with start after end, an empty tenant list, and an unknown type are each refused; a list holding a `custom` rule round-trips its config.
- every write produces one audit row with resource `flag` and the right action; `SetEnabled` to the current value produces none.

Commits: `feat(flag): add a write service that validates and never overwrites` (manager, validation, wiring, audit actions) and `feat(contract): map flag errors` (errors.go).

### Task A4: Flag queries

**Files:** Create `extension/contract/handlers_flags.go`, `extension/contract/handlers_flags_test.go`. Modify `extension/contract/project.go`, `manifest.yaml`, `contract.go`.

Manifest (queries):
```yaml
  - { name: flags.list,     kind: query, version: 1, capability: read }
  - { name: flags.detail,   kind: query, version: 1, capability: read }
  - { name: flags.evaluate, kind: query, version: 1, capability: read }
```

Wire types (`project.go`):

```go
type FlagSummary struct {
    ID           string            `json:"id"`
    Key          string            `json:"key"`
    Type         string            `json:"type"`
    DefaultValue any               `json:"defaultValue"`
    // DefaultMatchesType is false when the stored default is not a value of
    // Type, e.g. the templ page's string "true" on a bool flag.
    DefaultMatchesType bool        `json:"defaultMatchesType"`
    Description  string            `json:"description"`
    Tags         []string          `json:"tags"`
    Enabled      bool              `json:"enabled"`
    CreatedAt    string            `json:"createdAt"`
    UpdatedAt    string            `json:"updatedAt"`
}
type FlagRuleSummary struct {
    ID          string            `json:"id"`
    Priority    int               `json:"priority"`
    Type        string            `json:"type"`
    // Implemented is false for when_tenant_tag and custom: they never match.
    Implemented bool              `json:"implemented"`
    TenantIDs   []string          `json:"tenantIds"`
    UserIDs     []string          `json:"userIds"`
    Percentage  int               `json:"percentage"`
    StartAt     *string           `json:"startAt,omitempty"`
    EndAt       *string           `json:"endAt,omitempty"`
    TagKey      string            `json:"tagKey,omitempty"`
    TagValue    string            `json:"tagValue,omitempty"`
    Evaluator   string            `json:"evaluator,omitempty"`
    Params      map[string]any    `json:"params,omitempty"`
    ReturnValue any               `json:"returnValue"`
    ReturnMatchesType bool        `json:"returnMatchesType"`
}
type FlagOverrideSummary struct {
    TenantID       string `json:"tenantId"`
    Value          any    `json:"value"`
    ValueMatchesType bool `json:"valueMatchesType"`
    UpdatedAt      string `json:"updatedAt"`
}
type FlagVariantSummary struct { Value any `json:"value"`; Description string `json:"description"` }
```

Values leave through one helper `wireValue(v any) any` that converts `bson.D`/`bson.A` and any map or slice to plain `map[string]any` / `[]any` via a JSON round-trip, so every backend produces the same wire shape. RFC3339 UTC times everywhere.

- `flags.list {type?, limit, offset}` → `{flags: FlagSummary[], total}`. Limit default 25, max 100, as `secrets.list`. An unknown `type` is `BAD_REQUEST`. Uses `ListFlagDefinitions` and `CountFlagDefinitionsMatching` with the same `Type`.
- `flags.detail {key}` → `{flag: FlagSummary, variants: FlagVariantSummary[], metadata: map[string]string, rules: FlagRuleSummary[] (priority order, ties by id), overrides: FlagOverrideSummary[] (tenantId order), recentAudit: AuditSummary[] (Resource flag, limit 10), cacheTtlSeconds: int}`. `cacheTtlSeconds` comes from the vault config the extension was built with (add an accessor `Vault.FlagCacheTTL() time.Duration` if none exists).
- `flags.evaluate {key, tenantId?, userId?}` → `{value, valueMatchesType, reason, matchedRulePriority?: int, trace: [{priority, type, matched, reached, note}], bucket?: int, evaluatedAt}`. Calls `FlagEngine().EvaluateDetail` on the fresh context (Global Constraints). `bucket` is `flag.RolloutBucket(tenantId, key)` when a tenant is given, omitted otherwise. `reason` is the engine's string. The trace is `[]`, never null.

Tests (fail first): list paging and type filter with totals; unknown type 400; detail on a flag with rules, overrides, variants and metadata projects every field; a mongo-shaped `bson.D` default projects as a plain object (unit test on `wireValue`); a stored string `"true"` default on a bool flag reports `defaultMatchesType: false`; evaluate with a tenant already on the incoming ctx (`scope.WithTenantID(ctx, "leak")`) and no tenant in the request does NOT match a `when_tenant ["leak"]` rule; evaluate reports the bucket; `when_tenant_tag` rule projects `implemented: false`; `recentAudit` excludes secret rows on the same key.

Commit: `feat(contract): add the flag queries`.

### Task A5: Flag commands

**Files:** Modify `extension/contract/handlers_flags.go`, `handlers_flags_test.go`, `manifest.yaml`, `contract.go`, `transport_test.go` (one more case). Test: `extension/contract/handlers_flags_sqlite_test.go`.

Manifest:
```yaml
  - { name: flags.create,               kind: command, version: 1, capability: write, invalidates: [flags.list, flags.detail, flags.evaluate] }
  - { name: flags.update,               kind: command, version: 1, capability: write, invalidates: [flags.list, flags.detail, flags.evaluate] }
  - { name: flags.delete,               kind: command, version: 1, capability: write, invalidates: [flags.list, flags.detail, flags.evaluate] }
  - { name: flags.setEnabled,           kind: command, version: 1, capability: write, invalidates: [flags.list, flags.detail, flags.evaluate] }
  - { name: flags.setRules,             kind: command, version: 1, capability: write, invalidates: [flags.detail, flags.evaluate] }
  - { name: flags.setTenantOverride,    kind: command, version: 1, capability: write, invalidates: [flags.detail, flags.evaluate] }
  - { name: flags.deleteTenantOverride, kind: command, version: 1, capability: write, invalidates: [flags.detail, flags.evaluate] }
```

Requests and responses:
- `flags.create {key, type, defaultValue, description?, tags?, enabled}` → `{flag: FlagSummary}`.
- `flags.update {key, description?: string, defaultValue?: any, tags?: string[]}` → `{flag}`. `defaultValue` distinguishes absent from JSON `null`: decode the request into a struct with `DefaultValue json.RawMessage`; absent (len 0) leaves it; present decodes into `any` (so `null` means set to null, which only a json flag accepts). Decide this once in a shared `optionalValue` helper.
- `flags.delete {key}` → `{ok: true, key}`.
- `flags.setEnabled {key, enabled}` → `{flag}`.
- `flags.setRules {key, rules: [{type, tenantIds?, userIds?, percentage?, startAt?, endAt?, tagKey?, tagValue?, evaluator?, params?, returnValue}]}` in display order → `{rules: FlagRuleSummary[]}`. Times parse as RFC3339; an unparseable time is `BAD_REQUEST` naming `rules[i].startAt`.
- `flags.setTenantOverride {key, tenantId, value}` → `{override: FlagOverrideSummary}`.
- `flags.deleteTenantOverride {key, tenantId}` → `{ok: true, key, tenantId}`.

Every handler calls `deps.Vault.FlagManager()`, never the store.

Tests (fail first): each intent's happy path; create CONFLICT leaves the flag unchanged; update with `defaultValue` absent keeps it, with `null` on a bool flag is 400, on a json flag stores null; setEnabled false then `flags.evaluate` returns the default at once; setRules round-trips a `custom` rule; deleteTenantOverride on a missing tenant is 404 "tenant override not found"; every intent is bound (extend `TestEveryDeclaredIntentIsRegistered` automatically, it reads the manifest); `transport_test.go` gains `flags.setEnabled` asserting its manifest invalidates reach meta. sqlite: create, update description only, read back: variants and metadata seeded through the store survive.

Commit: `feat(contract): add the flag commands`.

---

## Part B: forge-dashboard (React)

All pages mirror `packages/plugin-vault/src/pages/secrets.tsx`, `secret-create.tsx` and `rotation-detail.tsx` for structure, use `useQuery`/`useCommand`, and never call fetch. Badges live in `src/badges.tsx`:

| Signal | Variant | Text |
|---|---|---|
| flag enabled | `outline` | On |
| flag disabled | `secondary` | Off |
| flag type | `outline` | the type, mono |
| value does not match type | `destructive` | Wrong type |
| rule never matches | `secondary` | Never matches |
| deciding rung (evaluation) | `default` | Decided here |
| rung not reached (evaluation) | `secondary` | Not reached |

Values render through one component, `src/components/flag-value.tsx`: `FlagValue({ value, type })` shows booleans as `true`/`false`, strings quoted in mono (so `"true"` and `true` are visibly different, which the templ page hid), numbers in mono with `tabular-nums`, JSON compact in mono truncated at 60 characters with the full value in a `title`. `null` renders as `NoneCell`.

Value inputs go through one component, `src/components/value-input.tsx`: `ValueInput({ type, value, onChange, id, invalid })`. bool: `ToggleGroup` true/false. string: `Input`. int: `Input inputMode="numeric"` accepting an optional minus and digits only. float: `Input inputMode="decimal"`. json: `Textarea` mono with `JSON.parse` validation on change, showing the parse error under it. It reports `undefined` while invalid so the caller can gate submit.

### Task B1: List, create, and plugin wiring

**Files:** Create `src/pages/flags.tsx`, `src/pages/flag-create.tsx`, `src/components/flag-value.tsx`, `src/components/value-input.tsx`, tests for each. Modify `src/index.tsx` (nav Flags `/flags` priority 20; routes `/flags`, `/new-flag`, `/flags/:key` placeholder), `src/badges.tsx`, `src/keys.ts` (`flagPath(key)` with `encodeURIComponent`), `package.json` (add the three `@dnd-kit` packages at kit's versions for B4, and run `pnpm install`; stage the lockfile hunk only for plugin-vault).

- List: `useQuery("flags.list", {type, limit: 25, offset})`. Type filter: kit `NativeSelect` "All types" plus the five types; changing it resets offset to 0. Columns: Key (`font-mono text-xs font-medium`, `PluginLink` to `flagPath`), Type badge, Status badge, Default (`FlagValue`, plus the Wrong type badge when `defaultMatchesType` is false), Tags (`TagList`, `NoneCell` when empty), Updated (`Timestamp`). Caption `{total} flag(s)`. Empty: "No flags yet." with a New flag action; with a type filter active: "No {type} flags." Header action: New flag to `/new-flag`.
- Create: fields Key, Type (NativeSelect, default bool), Default (`ValueInput` for the chosen type; changing type clears it), Description, Tags (comma separated, trimmed, empty dropped), Enabled (Checkbox, default on). Submit disabled until key and a valid default exist. CONFLICT shows "A flag with the key "<submitted key>" already exists." with an "Open the existing flag" link to the submitted key. Success navigates to the new flag.

Tests: list renders every column, the Wrong type badge for `defaultMatchesType: false`, caption at zero, type filter sends `type` and resets offset; `FlagValue` distinguishes `"true"` from `true`; `ValueInput` int rejects `1.5`, json reports a parse error and `undefined`; create sends the typed default (a real boolean, not a string) and exact field names; CONFLICT link uses the submitted key after the field is edited (a stub that throws `ContractError`).

Commit: `feat(plugin-vault): list and create flags`.

### Task B2: The ladder, read and write

**Files:** Create `src/pages/flag-detail.tsx`, `src/components/ladder.tsx` (the rail and rung layout, presentational), tests. Modify `src/index.tsx` (real route).

Layout follows the design in the spec's "The flag ladder" and the diagram below. The rail is a left border joining numbered rungs; numbers are the engine's order.

```
PageHeader: <key mono>  [type badge]            actions: Delete
  description (or "No description"), TagList
Definition: Default <FlagValue> [Wrong type?] (Edit)   Description (Edit)   Tags (Edit)
            Variants (read-only, "Not used when evaluating")   Metadata (read-only)
 1  Enabled                                   <Switch>        "Off: everything below returns the default."
 2  Tenant overrides   Beat every rule below.  (Add override)
      <tenant mono>                          <FlagValue>   (Remove)
 3  Rules              First match wins.       (Edit rules)   [B4]
      1  Tenant is one of   <chips>          <FlagValue>
      2  Rollout            25%              <FlagValue>
      3  Schedule           <start> to <end> UTC  <FlagValue>
 4  Default                                  <FlagValue>
Recent activity: audit rows
```

- When the flag is off, rungs 2 and 3 render `opacity-60` with the sentence "The flag is off, so everything below returns the default." above rung 2. That sentence, not only the opacity, is the signal.
- Rule summaries in words: `when_tenant` "Tenant is one of" + `TagList` of ids; `when_user` "User is one of"; `rollout` "Rollout to {n}% of tenants" (rollout buckets by tenant only; say so); `schedule` "Between {start} and {end} UTC" / "From {start} UTC" / "Until {end} UTC"; `when_tenant_tag` "Tenant tag {k} = {v}" + Never matches badge; `custom` "Custom evaluator {name}" + Never matches badge.
- Enabled: `Switch` sends `flags.setEnabled`; while pending it is disabled; a failure renders a `CommandAlert` under rung 1.
- Edit default, description, tags: one dialog each, sending `flags.update` with only that field. Dialog errors render inside the dialog; `reset()` on open; cannot close while pending.
- Add override: dialog with tenant id and `ValueInput`; Remove: `ConfirmDialog` with `pending`.
- Delete flag: `ConfirmDialog` "This deletes {key}, its {n} rule(s) and {m} tenant override(s). Applications fall back to their own default." with `pending`, then navigate to `/flags`.
- NOT_FOUND renders an `EmptyState` "No flag named {key}." with a link to `/flags`.

Tests: rung order and numbering; off state sentence; every rule type's summary and the Never matches badge; setEnabled sends the right payload and shows a failure from a throwing stub; update sends only the edited field; override add sends a typed value; delete copy counts rules and overrides; dialog stays open on Escape while pending.

Commit: `feat(plugin-vault): show a flag as its evaluation ladder`.

### Task B3: Evaluation mode

**Files:** Modify `src/pages/flag-detail.tsx`, `src/components/ladder.tsx`. Create `src/components/evaluate-bar.tsx`, tests.

- A bar above rung 1: "Evaluate as" with Tenant id and User id inputs, Evaluate and Clear buttons. Evaluate runs `useQuery("flags.evaluate", {key, tenantId, userId})` only after the button is pressed (hold the submitted pair in state; empty inputs are omitted from the payload).
- Result line in the bar: "Returns {FlagValue}." plus one sentence by reason: disabled "The flag is off, so the default is returned."; tenantOverride "Tenant {id} has an override."; rule "Rule {n} decided it." (n is the one-based display number); default "No rule matched, so the default is returned." Then, always: "This is what this server answers now. Other servers may serve the previous answer for up to {cacheTtlSeconds} seconds after a change."
- The ladder marks from the response only:
  - disabled: rung 1 Decided here; rungs 2 to 4 Not reached.
  - tenantOverride: the override row for that tenant Decided here; rungs 3 and 4 Not reached.
  - rule: the rule whose priority equals `matchedRulePriority` Decided here; each earlier rule shows its trace `note` in `text-muted-foreground` under it (checked, rejected); later rules and rung 4 Not reached. A rollout rule's line includes "Tenant {id} lands in bucket {bucket}, {bucket < n ? "under" : "not under"} {n}."
  - default: every rule shows its note; rung 4 Decided here.
- Clear removes every mark. Changing an input does not clear the old result until Evaluate is pressed again, but the result line says "for tenant {t}, user {u}" so a stale pair is visible.
- A command that invalidates `flags.evaluate` refetches it, so marks follow the data.

Tests: each of the four reasons marks exactly the right rungs and no others; with no evaluation run nothing is marked; bucket sentence under and not under; the cache sentence carries `cacheTtlSeconds`; empty inputs are omitted from the payload.

Commit: `feat(plugin-vault): evaluate a flag on its own ladder`.

### Task B4: The rule editor

**Files:** Create `src/components/rule-editor.tsx`, `src/components/rule-form.tsx`, `src/components/chip-input.tsx`, tests. Modify `src/pages/flag-detail.tsx`.

- "Edit rules" swaps rung 3 for a draft of the whole list (a copy of the saved rules). While the draft is open: evaluation marks are hidden and the Evaluate button is disabled with the reason "Save or discard the rule changes to evaluate."; the page asks before navigating away with unsaved changes (`beforeunload` and in-plugin link clicks).
- Reorder by drag with `@dnd-kit/sortable` (`useSortable`, `verticalListSortingStrategy`, `restrictToVerticalAxis` from `@dnd-kit/modifiers` only if the plugin can depend on it; otherwise none), with a visible drag handle button per row that also supports the keyboard sensor (Space to lift, arrows to move). Row numbers update live.
- Each row expands (`Collapsible`) into its type's form:
  - `when_tenant` / `when_user`: `ChipInput` (type, Enter or comma adds a trimmed id, Backspace on empty removes the last, duplicates ignored).
  - `rollout`: kit `Slider` 0 to 100 step 1 bound to a number `Input` 0 to 100; the text "Tenants whose bucket is under {n} get this value. Users without a tenant never match."
  - `schedule`: start and end `datetime-local` inputs interpreted as UTC and labelled "(UTC)", converted with the same helper as the secret expiry; either may be empty; start not before end shows an inline error.
  - `when_tenant_tag` / `custom`: read-only summary with Never matches and a Remove button; no fields.
  - every row: Return value via `ValueInput` for the flag's type.
- "Add rule" `DropdownMenu`: Tenant is one of, User is one of, Rollout, Schedule. Nothing else.
- "Save rules" sends `flags.setRules` with the draft in display order, each rule carrying only its type's fields (dead types carry theirs unchanged). Disabled while any row is invalid, with the first invalid row's problem stated. "Discard" drops the draft after a confirm if it changed. Save errors render above the list; the draft stays.

Tests: drag reorder changes the sent order (drive the keyboard sensor); a saved list with a `custom` rule is sent back with its config unchanged; the add menu has exactly four entries; chip input add, duplicate and backspace; rollout slider and number stay in sync; schedule start after end blocks save; a bool flag's return value is sent as a boolean; failed save keeps the draft (throwing stub).

Commit: `feat(plugin-vault): edit a flag's rules as one ordered list`.

### Task B5: Fixtures, verify, click-through

**Files:** Modify `packages/fixture-server/vault-fixtures.mjs` (flag handlers and seed), `packages/fixture-server/verify.mjs` (flag checks; other sessions' edits are in this file: edit in place with a read-then-edit tool and stage with the cacheinfo recipe).

- Seed: 30 flags across all five types (so the list pages), one with a string `"true"` default on a bool flag, one with every rule type including a `custom` and a `when_tenant_tag`, two with tenant overrides, one disabled, variants and metadata on one.
- Handlers mirror Go exactly: validation messages, CONFLICT, NOT_FOUND texts, priority from index, `implemented`, `*MatchesType` flags, `wireValue` shape, evaluate following the engine's order with the real bucket function (`sha256(tenantId + ":" + key)`, first four bytes big-endian mod 100; use `node:crypto`), trace notes in the engine's wording (copy them from `flag/engine.go`), `cacheTtlSeconds: 30`.
- verify: every flag intent is exercised, every command's invalidates match the manifest, disabling changes the next evaluate, a string default on a bool flag is refused, setRules round-trips the custom rule, create after delete starts clean.

Then the controller runs the real shell against the fixture and clicks through: list and filter, create each type, the ladder, toggle, overrides, every rule type in the editor including drag, evaluate for each reason, delete.

Commit: `feat(fixture-server): model vault's flag intents`.

---

## Done when

- Go: `go build ./... && go test ./... && go test -race ./flag/ ./extension/... ./store/...` clean, lint 0 issues with a fresh cache.
- React: plugin-vault test, typecheck, lint clean; `pnpm -r test` has no failure this slice introduced (prove any other in a clean worktree).
- Fixture verify passes for every vault check.
- The click-through above is done and its findings are fixed or recorded.
- The spec gains "What slice 3 found that slice 4 must know", and the MIGRATION.md notes gain the templ flag bugs (string defaults, no ID, overwrite on create, GET toggles, `yaml` type, app id from the form and query string) and the flags the templ page created with string defaults.
