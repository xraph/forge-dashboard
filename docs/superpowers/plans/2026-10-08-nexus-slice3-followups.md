# Nexus Slice 3 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close what slice 3's final review left open, on Rex's 2026-10-08 decision ("pick what's best long term"):
- tenant model controls are enforced;
- key expiry is true at the store;
- the first admin key needs no Go;
- the four review residuals are fixed.

**Architecture:**
- A `model_policy` stage at priority 260 (after alias resolution, before the cache) refuses models a tenant blocks or does not allow, checking both the requested and the resolved name.
- The access stage fills the tenant's default model.
- The cache stage honours the tenant's cache switch.
- Each key store derives expiry in its status filter and in a new `Count`.
- `key.Service.Ensure` creates a key from an operator-supplied raw value, idempotently. The extension calls it after migration from `bootstrap_admin_key` or `NEXUS_BOOTSTRAP_ADMIN_KEY`.

**Tech Stack:** Go 1.26, grove v1.6.3 stores (memory, SQLite, Postgres, Mongo).

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`. Read "Slice 3: enforcement" and "What slice 3 found that slice 4 must know", including its rulings table and the "v1 breaking changes from slice 3" list.

**Code repo:** `/Users/rexraphael/Work/xraph/forgery/nexus`, branch `main`, HEAD `b53a8cf` (slices 1 to 3 unpushed). Paths below are relative to it unless they name forge-dashboard.

## Global Constraints

The slice 3 SDD constraints still apply. They are in `/Users/rexraphael/Work/xraph/forge-dashboard/.superpowers/sdd/2026-10-07-nexus-slice3-enforcement/constraints.md`:
- shared checkout;
- `--only` commits with exact paths;
- no trailer;
- no amend;
- never move HEAD;
- no `go build` that writes files;
- inline the DB variables: pg on 55632, mongo on 57632, Redis on **56479**;
- never touch port 56379.

Further constraints:
- Refusal codes as before. A model the tenant may not use is refused 403 `forbidden`, as a recorded pipeline refusal.
- Gateway keys are secrets. The bootstrap raw key is never logged, never echoed and never stored, only its hash.
- `RoutingStrategy` and `GuardrailPolicy` on `tenant.Config` are not enforced in this plan. Their godoc and the hand-off say "stored, not enforced".

## Decisions this plan makes (each recorded again in the ledger)

1. **Model policy matches names exactly.** A request is refused when the requested name or the resolved name is in `BlockedModels`. When `AllowedModels` is non-empty, a request is refused unless the requested name or the resolved name is in it. Blocks win over allows. Names are case-sensitive and trimmed when saved.
2. **Embeddings are checked too.** Alias resolution does not run for them, so for embeddings the requested name and the resolved name are the same.
3. **`DefaultModel` fills an empty `model`**, in the access stage, before alias resolution. A request that names a model keeps it.
4. **`CacheEnabled` false bypasses the cache** for that tenant, both for reading and writing. Nil means the gateway setting.
5. **Store status semantics for keys:**
   - `active` means `status = 'active' AND (expires_at IS NULL OR expires_at > now)`.
   - `expired` means `status = 'expired' OR (status = 'active' AND expires_at <= now)`.
   - `revoked` means `status = 'revoked'`.

   Every key a store returns from `List` carries its effective status.
6. **`key.Store.Count(ctx, *ListOptions) (int, error)`** uses the same filter semantics. `key.Service` gains `ListPage(ctx, *ListOptions) (*ListResult, error)` and `Count(ctx, *ListOptions) (int, error)`.
7. **The bootstrap admin key is operator-supplied and idempotent by hash.**
   - Its raw value must have the key shape (`nxs_` plus 64 lowercase hex characters).
   - If a key with that hash exists in any status, nothing changes. A revoked bootstrap key stays revoked and a warning is logged without the key.
   - Otherwise the key is created with scope `admin`, named "bootstrap admin", in the tenant with slug `operator`, which is created if it is missing. An existing `operator` tenant that is not active is an error.
8. **A tenant that still has keys or usage history cannot be deleted.** The service refuses with `tenant.ErrInUse`, which maps to 409 `conflict` at the admin API. Postgres's foreign-key violation (SQLSTATE 23503) also maps to `ErrInUse`. Operators disable a tenant instead.

## Review Focus

1. A tenant blocks `o1`, and an alias `smart` resolves to `o1`: a request for `smart` is refused. Pinned in Task 1.
2. A key expires between two requests. A paged `List` with `status=active` no longer returns it, and `Count(active)` drops by one, on all four backends. Pinned in Task 2.
3. Two replicas start with the same `NEXUS_BOOTSTRAP_ADMIN_KEY` against one store: exactly one key exists afterwards. Pinned in Task 3, sequentially with one store; the docs state that concurrent first starts can race on tenant creation and the second one errors and is retried on restart.
4. A stream aborted while a chunk arrives does not race. Pinned under `-race` in Task 4.
5. Deleting a tenant with keys gives 409, and the tenant is intact. Pinned in Task 4.

---

### Task 1: Tenant model policy, default model, and per-tenant cache switch

**Files:**
- Create: `pipeline/middlewares/model_policy.go`, `pipeline/middlewares/model_policy_test.go`
- Modify:
  - `pipeline/middlewares/access.go`: fill `DefaultModel`.
  - `pipeline/middlewares/cache.go`: honour `CacheEnabled`.
  - `nexus.go`: wire `model_policy` at 260.
  - `tenant/tenant.go`: godoc.
  - `tenant/service_impl.go`: validate the model lists.
  - `wiring_test.go`: stage list.
  - `gateway_enforcement_test.go`.

**Interfaces:**
- Produces: `middlewares.NewModelPolicy() *ModelPolicyMiddleware`, with name `model_policy` and priority 260.
- `tenant.Create` and `tenant.Update` trim the names in `AllowedModels` and `BlockedModels`. They refuse with `ErrInvalid` an empty name, and a name that is in both lists.

- [ ] **Step 1: Write the failing tests.** In `pipeline/middlewares/model_policy_test.go`, use `WithTenantForTest` and set the alias state the way the alias stage does: `req.State["original_model"]` holds the requested name and `req.Completion.Model` holds the resolved name. Cover:
  - a blocked requested name gives 403;
  - a blocked resolved name (through an alias) gives 403;
  - an allow list that contains only the alias name allows it;
  - an allow list that contains neither name gives 403;
  - blocked wins when a name is in both lists. Insert a tenant directly so the service validation does not stop it;
  - an embedding with a blocked model gives 403;
  - no tenant in the context passes;
  - empty lists pass.

  Assert `pipeline.HTTPStatus` returns (403, `forbidden`) and that the message names the model, not any key.

  Access test: a tenant with `DefaultModel: "gpt-4o"` and a request with `Model: ""` reaches `next` with `Model == "gpt-4o"`. A request that names a model keeps it.

  Cache test: with a tenant whose `CacheEnabled` is `&false` in the context, two identical requests both reach `next`, so neither reads nor writes the cache. With nil, the second request is a hit.

  Tenant service tests: an empty name, or a name in both lists, gives `ErrInvalid` on both Create and Update. Surrounding spaces are trimmed.

  Gateway test (`gateway_enforcement_test.go`): a tenant blocks `gpt-4o`. A request for it is refused 403 and recorded `refused` with code `forbidden`, at `$0`, with the tenant attributed.

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement.**

```go
// pipeline/middlewares/model_policy.go
package middlewares

import (
	"context"
	"slices"

	"github.com/xraph/nexus/pipeline"
)

// ModelPolicyMiddleware refuses a model the tenant blocks, or does not
// allow. It runs after alias resolution, so it sees both the name the
// caller asked for and the model it resolved to; either one being blocked
// refuses the request, and either one being allowed admits it. Blocks win.
type ModelPolicyMiddleware struct{}

func NewModelPolicy() *ModelPolicyMiddleware { return &ModelPolicyMiddleware{} }

func (*ModelPolicyMiddleware) Name() string  { return "model_policy" }
func (*ModelPolicyMiddleware) Priority() int { return 260 }

func (*ModelPolicyMiddleware) Process(ctx context.Context, req *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	t, ok := TenantFromContext(ctx)
	if !ok || (len(t.Config.AllowedModels) == 0 && len(t.Config.BlockedModels) == 0) {
		return next(ctx)
	}
	resolved := requestModel(req)
	requested := resolved
	if s, ok := req.State["original_model"].(string); ok && s != "" {
		requested = s
	}
	names := []string{requested, resolved}
	for _, n := range names {
		if slices.Contains(t.Config.BlockedModels, n) {
			return nil, refuse(pipeline.CodeForbidden, 403, "model "+n+" is blocked for this tenant")
		}
	}
	if len(t.Config.AllowedModels) > 0 &&
		!slices.Contains(t.Config.AllowedModels, requested) && !slices.Contains(t.Config.AllowedModels, resolved) {
		return nil, refuse(pipeline.CodeForbidden, 403, "model "+requested+" is not allowed for this tenant")
	}
	return next(ctx)
}
```

`requestModel(req)` already exists in `usage.go`. It returns the completion's or the embedding's model; confirm that. `refuse` is in `access.go`.

- Export the `"original_model"` state key as `pipeline.StateOriginalModel` in `pipeline/state.go`, and use it in `alias.go` and here.
- Access stage: after the tenant is loaded and checked, and before `next`: `if req.Completion != nil && req.Completion.Model == "" && t.Config.DefaultModel != "" { req.Completion.Model = t.Config.DefaultModel }`. Do the same for `req.Embedding`.
- Cache stage: at the top of `Process`, `if t, ok := TenantFromContext(ctx); ok && t.Config.CacheEnabled != nil && !*t.Config.CacheEnabled { return next(ctx) }`.
- `nexus.go buildDefaultPipeline`: `b.Use(middlewares.NewModelPolicy())`, unconditionally. It passes through quickly when the tenant has no lists.
- Update `wiring_test.go`'s expected default stage list.
- `tenant/tenant.go`: on `RoutingStrategy` and `GuardrailPolicy`, add the godoc "Stored for the dashboard; not enforced by the gateway yet." On `AllowedModels`, `BlockedModels`, `DefaultModel` and `CacheEnabled`, describe the enforcement.
- `tenant/service_impl.go`: write a `normaliseConfig(*Config) error` that trims the names, refuses empty ones and refuses overlap, wrapping `ErrInvalid`. Call it in Create and in Update when `input.Config != nil`.

- [ ] **Step 4: Run.** `go test -race ./pipeline/... ./tenant/ .` with the DB variables inline, and lint.

- [ ] **Step 5: Commit.** Subject: `feat(nexus): enforce a tenant's allowed and blocked models, its default model and its cache switch`. List the exact paths.

---

### Task 2: Key expiry is true at the store

**Files:**
- Modify:
  - `key/key.go` (Store and Service interfaces, `Effective`);
  - `key/service_impl.go`;
  - `store/memory_key.go`;
  - the key stores in `store/sqlite/store.go`, `store/postgres/store.go` and `store/mongo/store.go`;
  - each SQL backend's migrations (a new index migration);
  - `store/mongo/migrations.go`, in both index places.
- Create: `store/storetest/key_status_test.go`.

**Interfaces:**
- `key.Effective(k *APIKey, now time.Time) Status`, exported, pure. Use it in `key.Service.derive` and in every store, so the rule lives in one place.
- `key.Store.Count(ctx context.Context, opts *ListOptions) (int, error)`. `Cursor` and `Limit` are ignored.
- `key.Service.ListPage(ctx, *ListOptions) (*ListResult, error)` and `key.Service.Count(ctx, *ListOptions) (int, error)`. Both delegate to the store.

- [ ] **Step 1: Write the failing conformance tests** in `store/storetest/key_status_test.go`, run with `storetest.Each`. Insert four keys for one tenant: active with no expiry, active expiring an hour from now, active that expired an hour ago, and revoked. Then assert:
  - `List{Status: active}` returns exactly the first two.
  - `List{Status: expired}` returns exactly the third, and its `Status` reads `expired`.
  - `List{Status: revoked}` returns the fourth.
  - `List{}` returns all four, with the third reading `expired`.
  - `Count` agrees with each `List`.
  - Paging (`Limit: 1` with a cursor) over `Status: active` returns both active keys across two pages.
  - The existing `TestKeyListAcrossAndWithinTenants` still passes.

- [ ] **Step 2: Run them and watch them fail on all four backends.**

- [ ] **Step 3: Implement.**
  - SQL: build the status clause per the decision above, passing `time.Now().UTC()` as a parameter. SQLite stores `expires_at` as text, so compare with `conv.TimeText` the way the usage stores do. Read the key model's conversion.
  - Mongo: use `$or` filters.
  - Memory: use `Effective`.
  - Map every returned row through `Effective`.
  - Implement `Count` the same way as `List`, with no ordering or paging.
  - Indexes: a new migration adding `(tenant_id, status)` and `(status, expires_at)` on SQLite and Postgres; for Mongo, the same compound indexes in both index-definition places.
  - Update the key.Service doc so it says the store derives expiry too.

- [ ] **Step 4: Run.** `go test -race ./store/... ./key/... .` with the DB variables inline, and lint.

- [ ] **Step 5: Commit.** Subject: `fix(store): derive key expiry in every store's list and count`.

---

### Task 3: The first admin key without Go

**Files:**
- Modify: `key/key.go` and `key/service_impl.go` (`Ensure`), `nexus.go` and `options.go` (bootstrap), `extension/config.go` and `extension/extension.go`, and the docs pages `api-reference/http-api.mdx` ("Your first admin key") and `guides/forge-extension.mdx`.
- Create: `key/ensure_test.go`, `bootstrap_test.go`.

**Interfaces:**
- `key.Service.Ensure(ctx context.Context, rawKey string, in *CreateInput) (k *APIKey, created bool, err error)`. It does the following:
  - validates the shape (unknown shape: `ErrInvalid`, and the message never contains the key);
  - looks up the key by prefix and constant-time hash compare;
  - if the key exists in any status, returns it with `created=false`;
  - otherwise runs `Create`'s validation (tenant exists, scopes known, expiry) and inserts the key with that hash and prefix, then emits `KeyCreated`.
- `key.WellFormed(raw string) bool`, which exports the shape check.
- `nexus.WithBootstrapAdminKey(raw string) Option` and `(*Gateway).EnsureBootstrapAdminKey(ctx) error`.
  - With no key configured, the method does nothing.
  - Otherwise it gets or creates the tenant with slug `operator` (name "Operator"), then calls `Keys().Ensure` with `Scopes: [admin]` and `Name: "bootstrap admin"`.
  - A revoked bootstrap key produces a `Warn` that carries the key id and never the raw key.
  - An inactive `operator` tenant is an error.
- Extension: config `BootstrapAdminKey string` (`bootstrap_admin_key`). When it is empty, `Register` reads `NEXUS_BOOTSTRAP_ADMIN_KEY`. `Start` calls `gw.EnsureBootstrapAdminKey(ctx)` after `Migrate`. The raw value never appears in a log, an error or config output.

- [ ] **Step 1: Write the failing tests.**
  - `key/ensure_test.go`:
    - a fresh raw key is created with the admin scope and validates;
    - a second `Ensure` with the same raw key returns `created=false` and one key exists;
    - a revoked key stays revoked;
    - a malformed raw key gives `ErrInvalid`, and the error text never contains it;
    - an unknown scope gives `ErrInvalid`.
  - `bootstrap_test.go`:
    - running `EnsureBootstrapAdminKey` twice on a memory store gives one `operator` tenant and one admin key, and the raw key authenticates against `/admin/providers` through `api.New`;
    - an inactive `operator` tenant gives an error;
    - a captured log contains no raw key.
  - Extension test: the env var is used when the config field is empty, and the config value wins over the env var. Use `t.Setenv`.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement** to the interfaces above. Hashing and the prefix reuse the unexported `hashKey` and `rawKey[:12]`. For library users who build a gateway without the extension, document on `EnsureBootstrapAdminKey` that it must be called after `Store().Migrate()`.

- [ ] **Step 4: Run.** `go test -race ./key/ ./extension/ ./api/ .` with the DB variables inline, and lint.

- [ ] **Step 5: Commit.** Subject: `feat(nexus): create the first admin key from config or an env var`.

---

### Task 4: The slice 3 review residuals

**Files:**
- `nexus.go` (warn text);
- `pipeline/middlewares/stream_lifecycle.go` (mutex) and its test;
- `tenant/errors.go`, `tenant/service_impl.go`, `store/postgres/store.go` (FK mapping), `api/requests.go` / `api/tenant_handler.go` (409), and tests;
- the `go.sum` files of `_examples/live`, `_examples/realtime` and `config`.

- [ ] **N1.** With usage recording off, the daily cap still holds through the limiter; only the monthly budget goes inert.
  - Fix the `Initialize` warning text to "the monthly budget will not apply".
  - The docs and the spec paragraph are fixed in Task 5.
  - Add a gateway test: with usage off and `DailyRequests: 2`, a third request is refused `quota_exceeded`.
- [ ] **N2.** `lifecycleStream` races between `Next` and `Close` on `acc` and `watchdogStop`.
  - Guard the stream's mutable state with a mutex.
  - Make sure a watchdog started after `Close` is stopped at once, or never started.
  - Test: concurrent `Next` and `Close` under `-race`, run with `-count=20`, gives no race reports. A watchdog after `Close` does not close the inner stream a second time; check it with a counting inner stream.
- [ ] **N3.** Add `tenant.ErrInUse = errors.New("nexus: tenant is in use")`.
  - `tenant.Service.Delete` refuses with it when the tenant has any key. The tenant service gains `WithKeys(KeyLister)` where `KeyLister` has `ListByTenant(ctx, id) ([]*key.APIKey, error)` (key.Store satisfies it). Avoid an import cycle: tenant must not import key. Define the method with a minimal local return shape, or wire a `func(ctx, id) (bool, error)` "in use" checker that the gateway builds.
  - The Postgres tenant `Delete` maps SQLSTATE 23503 to `ErrInUse`, for usage history.
  - `/admin/tenants/{id}` DELETE maps `ErrInUse` to 409 with code `conflict` and the message "tenant has keys or usage history; disable it instead".
  - Tests: a service test, an api test, and a Postgres conformance-style test inserting a usage row.
- [ ] **N4.** Docs only, in Task 5: the composite index migration on a large `nexus_usage_records` table blocks writes while it builds. Run it in a maintenance window, or create the index `CONCURRENTLY` by hand before upgrading. The migration's `IF NOT EXISTS` then skips it.
- [ ] **Module hygiene.** `GOWORK=off go mod tidy` in `_examples/live`, `_examples/realtime` and `config`, so `GOWORK=off go vet ./...` passes there. Make it its own chore commit, and add the three to the gate loop.

Commits:
- `fix(nexus): say only the budget stops when usage is off`
- `fix(pipeline): guard a stream's state between Next and Close`
- `fix(tenant): refuse to delete a tenant that still has keys or usage`
- `chore: tidy the example and config modules`

---

### Task 5: Docs, the gate, and the hand-off

- [ ] **Docs** (nexus docs site, rex-voice then humanizer, no em or en dashes):
  - `multi-tenancy.mdx`: tenant config enforcement (allowed and blocked models, the default model, the cache switch; routing strategy and guardrail policy stored, not enforced), deleting a tenant (409, disable instead), and the corrected N1 sentence.
  - `configuration.mdx`: N1, and `bootstrap_admin_key` / `NEXUS_BOOTSTRAP_ADMIN_KEY`.
  - `http-api.mdx`: the bootstrap, and 409 on tenant delete.
  - The upgrade note for N4, wherever the docs keep upgrade notes. If there is no such place, put it in the hand-off.
- [ ] **Gate:** the slice 3 gate, plus `GOWORK=off go vet` in `_examples/live`, `_examples/realtime` and `config`. Run it with all three DB variables inline.
- [ ] **Hand-off** (forge-dashboard spec, Edit tool only): in "What slice 3 found that slice 4 must know", mark I7 and I8 resolved and say how:
  - which tenant config fields are enforced;
  - store-level expiry, plus `key.Service.ListPage` and `Count` for `keys.list` and the overview count.
  - Correct the Ruling 16 posture line to "usage off: the monthly budget is inert", and say the daily cap still holds.
  - Add the bootstrap, Ruling 14 confirmed by Rex on 2026-10-08, `tenant.ErrInUse` → 409, and the N4 upgrade note.
  - Commit only that path with `git add -f`. Subject: `docs: record the nexus slice 3 follow-ups`.
