# Keysmith Policies and Scopes (slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operators can list, create, edit and delete key policies, and list, create and delete scopes, from the React dashboard, against a keysmith engine whose policy and scope writes behave the same on every backend.

**Architecture:** Three domain fixes land first in keysmith (unique names, policy delete that ignores revoked keys, scope delete that leaves no key holding a deleted scope and refuses while children exist). The contract then gains `policies.detail` and five commands, the fixture models them with identical messages, and `plugin-keysmith` gains Policies (list, detail, editor) and Scopes pages. Every dialog that runs a command renders outside its page's `QueryBoundary`.

**Tech Stack:** Go 1.25 (keysmith, forge v1.10.0 dashboard contract, grove stores: memory, sqlite, postgres, mongo), Node ESM fixture, React 19 + Base UI 1.7 via `@forge-go/dashboard-kit`, vitest 5, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md` (sections "Policies say what enforces them", "The contract", "Pages", "Fixture", "Testing"). Prior plans: `2026-09-30-keysmith-domain-fixes.md`, `2026-09-30-keysmith-contract-spine.md`, `2026-10-01-keysmith-key-write-path.md`. The slice 3 ledger's last lines list the carry-overs this plan folds in.

## Global Constraints

- Repos, both on `main`, no worktrees: Go `/Users/rexraphael/Work/xraph/forgery/keysmith` (leave `_project_files/` and `dashboard/` alone); React and fixture `/Users/rexraphael/Work/xraph/forge-dashboard`.
- In forge-dashboard edit only `packages/plugin-keysmith/**` and `packages/fixture-server/keysmith-fixtures.mjs`. `verify.mjs`, `server.mjs` and `pnpm-lock.yaml` carry other sessions' work: never commit them (Task 8 leaves its `verify.mjs` lines in the working tree for the controller).
- Git: `git add <exact new files>`, `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, a bare directory, `--amend`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean`, `git push`. Undo a mutation by backing up and restoring the single file.
- Commit messages: no `Co-Authored-By` trailer, no Claude or Anthropic attribution, no em or en dashes; plain prose, "we" not "I", "you" where natural, varied sentence length, no bolded lead-ins.
- Wire JSON is camelCase; timestamps RFC3339 UTC; durations whole seconds; an unset (zero) duration or count goes out as `null`; lists go out as `[]`, never `null`.
- Error codes are BAD_REQUEST, UNAUTHENTICATED, PERMISSION_DENIED, NOT_FOUND, CONFLICT, INTERNAL. No FAILED_PRECONDITION. INTERNAL never echoes engine text.
- A missing row and another tenant's row answer the identical NOT_FOUND (`policy not found`, `scope not found`).
- Every contract engine write that creates a row under a tenant (`CreatePolicy`, `CreateScope`) runs under `engineCtx(ctx, app, tenant)` (tenant.go), because the engine's `scopeFromContext` prefers the request's forge Scope over `keysmith.WithTenant`.
- `policies.list` keeps the shape slice 3 shipped (`policies`, `hasMore`), not the spec table's `items`/`total`: the create dialog already reads it, and the list page fetches up to 200 like the picker.
- Rex's rulings for this slice (2026-10-04): `policies.delete` ignores revoked keys (only active, suspended or expired keys block it); `scopes.delete` refuses while any scope in the tenant names it as its parent.
- React: kit components only; identifiers (ids, scope names, IPs, paths) in `font-mono text-xs`; labels are plain words; dialog errors and fields go in `ConfirmDialog` children, never `description`; failure tests make the client THROW a `ContractError`.
- Plugin label stays "Keysmith"; nav group "API keys"; routes have no `/dashboard` prefix (dev shell serves `/@keysmith/...`).
- Go lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. Four-backend tests: `make test-backends` (Docker, creates and removes `keysmith-test-pg` / `keysmith-test-mongo`; touch no other container).
- React checks: `pnpm --filter @forge-go/dashboard-plugin-keysmith test|typecheck|lint`, no warnings.

## Review Focus

1. A duplicate name (policy or scope, including a rename on update into an existing name) answers CONFLICT with a plain message on every backend, never INTERNAL. Pinned in Tasks 1 and 5/7.
2. Deleting a scope a key holds: the key's next detail read no longer lists it on any backend, and re-creating a scope with the same name does not silently re-grant it. Pinned in Task 3.
3. An edit that clears a field (0 or empty list) clears it, and a field the request omits is left alone. Pinned in Task 5.
4. A rate limit with no window, a burst with no rate limit, or a negative number refuses with a message naming the field, in the same order in Go and the fixture. Pinned in Tasks 5 and 8.
5. The policy editor and the policy page say honestly what this deployment enforces: the rate-limit group reads "not enforced here" when the engine has no rate limiter, and an edit says it applies from now on, not to existing keys. Pinned in Tasks 10 and 11.

---

## Phase A: domain fixes (keysmith repo)

### Task 1: Policy and scope names are unique per tenant on every backend

**Files:**
- Modify: `errors.go` (keysmith root), `engine.go` (`CreatePolicy`, `UpdatePolicy`, `CreateScope`)
- Test: `engine_policies_test.go` (new), `engine_scopes_test.go`

**Interfaces:**
- Produces: `keysmith.ErrPolicyNameTaken = errors.New("keysmith: a policy with this name already exists in the tenant")`, `keysmith.ErrScopeNameTaken = errors.New("keysmith: a scope with this name already exists in the tenant")`.

Why: postgres, sqlite and mongo have a unique `(tenant_id, name)` index that answers a raw driver error (INTERNAL through the contract); memory accepts duplicates. The engine checks first so all four agree; the index stays as the race backstop.

- [ ] **Step 1: Write the failing tests** (`engine_policies_test.go`, package `keysmith`, using `storetest.Each` like `engine_scopes_test.go`):

```go
func TestCreatePolicyRefusesADuplicateNameInTheTenant(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s) // engine_scopes_test.go helper; ctx is tenant t1
		require.NoError(t, eng.CreatePolicy(ctx, &policy.Policy{Name: "Standard"}))
		err := eng.CreatePolicy(ctx, &policy.Policy{Name: "Standard"})
		require.ErrorIs(t, err, keysmith.ErrPolicyNameTaken)
		// Another tenant may use the same name.
		require.NoError(t, eng.CreatePolicy(keysmith.WithTenant(context.Background(), "app1", "t2"), &policy.Policy{Name: "Standard"}))
	})
}

func TestUpdatePolicyRefusesARenameIntoATakenName(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		a := &policy.Policy{Name: "A"}
		b := &policy.Policy{Name: "B"}
		require.NoError(t, eng.CreatePolicy(ctx, a))
		require.NoError(t, eng.CreatePolicy(ctx, b))
		b.Name = "A"
		require.ErrorIs(t, eng.UpdatePolicy(ctx, b), keysmith.ErrPolicyNameTaken)
		// Keeping its own name is not a clash.
		a.Description = "changed"
		require.NoError(t, eng.UpdatePolicy(ctx, a))
	})
}
```

And in `engine_scopes_test.go`:

```go
func TestCreateScopeRefusesADuplicateNameInTheTenant(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		require.NoError(t, eng.CreateScope(ctx, &scope.Scope{Name: "read"}))
		require.ErrorIs(t, eng.CreateScope(ctx, &scope.Scope{Name: "read"}), keysmith.ErrScopeNameTaken)
		require.NoError(t, eng.CreateScope(keysmith.WithTenant(context.Background(), "app1", "t2"), &scope.Scope{Name: "read"}))
	})
}
```

- [ ] **Step 2: Run** `go test -run 'Duplicate|TakenName' .` — Expected: FAIL (memory accepts the duplicate; sqlite answers a raw constraint error, not the sentinel).

- [ ] **Step 3: Implement.** Add the two sentinels to `errors.go` beside `ErrPolicyInUse`. In `CreatePolicy`, after resolving `sc`, call `e.store.Policies().GetByName(ctx, sc.tenantID, pol.Name)`: found means `return ErrPolicyNameTaken`; `errors.Is(err, ErrPolicyNotFound)` means proceed; any other error returns `fmt.Errorf("check policy name: %w", err)`. `UpdatePolicy` does the same lookup with `pol.TenantID` and refuses only when the found row's ID differs from `pol.ID`. `CreateScope` does the same with `Scopes().GetByName` and `ErrScopeNotFound`.

- [ ] **Step 4: Run** `go test ./...` — Expected: PASS.

- [ ] **Step 5: Commit** `fix: refuse a duplicate policy or scope name in a tenant on every backend` with `errors.go engine.go engine_policies_test.go engine_scopes_test.go`.

### Task 2: Revoked keys no longer block deleting a policy

**Files:**
- Modify: `errors.go` (`ErrPolicyInUse` text), `engine.go` (`DeletePolicy`)
- Test: `engine_policies_test.go`

**Interfaces:**
- Produces: `ErrPolicyInUse` keeps its identity; its text becomes `"keysmith: policy is used by keys that are not revoked"`. `DeletePolicy` refuses only when a key with `State != key.StateRevoked` uses the policy.

Rex's ruling: a revoked key never validates again and there is no key delete, so counting it made a once-used policy permanent. A revoked key keeps its `PolicyID`; `keys.detail` already reads a dangling policy as none.

- [ ] **Step 1: Write the failing test:**

```go
func TestDeletePolicyIgnoresRevokedKeys(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		pol := &policy.Policy{Name: "Retired"}
		require.NoError(t, eng.CreatePolicy(ctx, pol))
		res, err := eng.CreateKey(ctx, &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvTest, PolicyID: &pol.ID})
		require.NoError(t, err)

		require.ErrorIs(t, eng.DeletePolicy(ctx, pol.ID), keysmith.ErrPolicyInUse) // active key blocks
		require.NoError(t, eng.SuspendKey(ctx, res.Key.ID))
		require.ErrorIs(t, eng.DeletePolicy(ctx, pol.ID), keysmith.ErrPolicyInUse) // suspended blocks
		require.NoError(t, eng.RevokeKey(ctx, res.Key.ID, "done"))
		require.NoError(t, eng.DeletePolicy(ctx, pol.ID)) // revoked does not

		_, err = eng.GetPolicy(ctx, pol.ID)
		require.ErrorIs(t, err, keysmith.ErrPolicyNotFound)
		k, err := eng.GetKey(ctx, res.Key.ID)
		require.NoError(t, err)
		require.NotNil(t, k.PolicyID, "a revoked key keeps the id of the policy it used")
	})
}
```

(`CreateKeyInput` takes `PolicyID *id.PolicyID`; confirm against `engine.go` before running.)

- [ ] **Step 2: Run** `go test -run TestDeletePolicyIgnoresRevokedKeys .` — Expected: FAIL at the last `DeletePolicy` (`ErrPolicyInUse`).
- [ ] **Step 3: Implement:** in `DeletePolicy`, count `ListByPolicy` rows whose `State != key.StateRevoked`; refuse when the count is above zero. Update the `ErrPolicyInUse` text.
- [ ] **Step 4: Run** `go test ./...` — Expected: PASS.
- [ ] **Step 5: Commit** `fix: let a policy go once only revoked keys use it`.

### Task 3: Deleting a scope leaves no key holding it, and refuses while children exist

**Files:**
- Modify: `errors.go`, `engine.go` (`DeleteScope`), `store/memory/store.go` (`scopeStore.Delete`), `store/mongo/scope.go` (`Delete`)
- Test: `engine_scopes_test.go`, `internal/storetest/scope_test.go` (new)

**Interfaces:**
- Produces: `keysmith.ErrScopeHasChildren = errors.New("keysmith: other scopes name this scope as their parent")`. `DeleteScope(ctx, id)` loads the scope, refuses with `ErrScopeHasChildren` when `Scopes().List(ctx, &scope.ListFilter{TenantID: s.TenantID, Parent: s.Name, Limit: 1})` returns a row, then deletes.

Why: postgres and sqlite cascade `keysmith_key_scopes` on delete. Memory keeps the deleted name in `keyScopes` (and a scope later re-created under that name re-grants it silently). Mongo leaves `key_scopes` rows pointing at the deleted id.

- [ ] **Step 1: Write the failing store conformance test** (`internal/storetest/scope_test.go`):

```go
func TestDeletingAScopeRemovesItFromEveryKey(t *testing.T) {
	Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k := newKey("t1") // conformance_test.go helper
		require.NoError(t, s.Keys().Create(ctx, k))
		sc := &scope.Scope{ID: id.NewScopeID(), TenantID: "t1", AppID: "app1", Name: "billing:read", CreatedAt: time.Now()}
		require.NoError(t, s.Scopes().Create(ctx, sc))
		require.NoError(t, s.Scopes().AssignToKey(ctx, k.ID, []string{"billing:read"}))

		require.NoError(t, s.Scopes().Delete(ctx, sc.ID))
		held, err := s.Scopes().ListByKey(ctx, k.ID)
		require.NoError(t, err)
		require.Empty(t, held, "a deleted scope is no longer held")

		again := &scope.Scope{ID: id.NewScopeID(), TenantID: "t1", AppID: "app1", Name: "billing:read", CreatedAt: time.Now()}
		require.NoError(t, s.Scopes().Create(ctx, again))
		held, err = s.Scopes().ListByKey(ctx, k.ID)
		require.NoError(t, err)
		require.Empty(t, held, "re-creating the name does not re-grant it")
	})
}
```

And the engine test in `engine_scopes_test.go`:

```go
func TestDeleteScopeRefusesWhileChildrenNameIt(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		parent := &scope.Scope{Name: "billing"}
		require.NoError(t, eng.CreateScope(ctx, parent))
		child := &scope.Scope{Name: "billing:read", Parent: "billing"}
		require.NoError(t, eng.CreateScope(ctx, child))
		// Another tenant's child of the same name does not count.
		require.NoError(t, eng.CreateScope(keysmith.WithTenant(context.Background(), "app1", "t2"), &scope.Scope{Name: "x", Parent: "billing"}))

		require.ErrorIs(t, eng.DeleteScope(ctx, parent.ID), keysmith.ErrScopeHasChildren)
		require.NoError(t, eng.DeleteScope(ctx, child.ID))
		require.NoError(t, eng.DeleteScope(ctx, parent.ID))
	})
}
```

- [ ] **Step 2: Run** `go test ./internal/storetest/ -run TestDeletingAScope` and `go test -run TestDeleteScopeRefuses .` — Expected: memory FAILs the first ("a deleted scope is no longer held"); the engine test FAILs on every backend.
- [ ] **Step 3: Implement.**
  - memory `scopeStore.Delete`: under the lock, after removing the scope row, delete `sc.Name` from `st.keyScopes[kid]` for every key whose `st.keys[kid].TenantID == sc.TenantID`.
  - mongo `Delete`: after deleting the scope document, delete every `keyScopeModel` with `scope_id == scopeID.String()` (`s.mdb.NewDelete((*keyScopeModel)(nil)).Filter(bson.M{"scope_id": ...}).Many()` or the grove mongo equivalent the file already uses; read `RemoveFromKey` for the idiom).
  - engine `DeleteScope`: `Scopes().Get` (not found passes through as `ErrScopeNotFound`), the children check above, then delete.
  - sqlite: confirm `PRAGMA foreign_keys=ON` holds on every pooled connection (the grove driver runs it once at open, `sqlitedriver@v1.4.0/sqlite.go:69`). Check whether keysmith's sqlite store caps the pool at one connection. If it does not, record that in your report for Rex and do not change grove; the conformance test above runs on one connection and passes either way.
- [ ] **Step 4: Run** `go test ./...` then `make test-backends` — Expected: PASS on all four.
- [ ] **Step 5: Commit** two commits: `fix(store): drop a deleted scope from every key on memory and mongo` (stores + storetest) and `fix: keep a scope while other scopes name it as their parent` (errors, engine, engine test).

## Phase B: contract (keysmith `extension/contract`)

### Task 4: `policies.detail`, the full policy projection, and slice 3 Go carry-overs

**Files:**
- Modify: `project.go`, `handlers_pickers.go` (`policiesListResponse`), `load.go`, `manifest.yaml`, `contract.go`
- Create: `handlers_policies.go`, `handlers_policies_test.go`
- Modify (carry-overs): `handlers_key_create_test.go` (`TestKeysCreateThenListAndDetailNeverCarryTheRawKey`)

**Interfaces:**
- Produces (Go, used by Tasks 5-7):

```go
// PolicyDetail is every policy field the editor and the detail page show.
type PolicyDetail struct {
	ID                     string   `json:"id"`
	Name                   string   `json:"name"`
	Description            string   `json:"description,omitempty"`
	MaxKeyLifetimeSeconds  *int64   `json:"maxKeyLifetimeSeconds"`
	GraceSeconds           *int64   `json:"graceSeconds"`
	AllowedScopes          []string `json:"allowedScopes"`
	RateLimit              *int64   `json:"rateLimit"`
	RateLimitWindowSeconds *int64   `json:"rateLimitWindowSeconds"`
	BurstLimit             *int64   `json:"burstLimit"`
	AllowedIPs             []string `json:"allowedIps"`
	AllowedOrigins         []string `json:"allowedOrigins"`
	AllowedMethods         []string `json:"allowedMethods"`
	AllowedPaths           []string `json:"allowedPaths"`
	RotationPeriodSeconds  *int64   `json:"rotationPeriodSeconds"`
	DailyQuota             *int64   `json:"dailyQuota"`
	MonthlyQuota           *int64   `json:"monthlyQuota"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
}
func projectPolicyDetail(p *policy.Policy) PolicyDetail // lists never nil; zero counts and durations null
func countOrNil(n int64) *int64                         // nil for 0, like secondsOrNil
func requirePolicyID(raw string) (id.PolicyID, error)    // "id is required" / "id is not a policy id"
func loadPolicyForTenant(ctx context.Context, deps Deps, tenant, rawID string) (*policy.Policy, error) // NOT_FOUND "policy not found" for missing and foreign
type policyIDRequest struct{ ID string `json:"id"` }
type policiesDetailResponse struct {
	Policy                PolicyDetail `json:"policy"`
	KeysUsing             int          `json:"keysUsing"`          // every key in the tenant with this policy
	KeysBlockingDelete    int          `json:"keysBlockingDelete"` // the ones that are not revoked
	RateLimiterConfigured bool         `json:"rateLimiterConfigured"`
}
func policyKeyCounts(ctx context.Context, deps Deps, tenant string, polID id.PolicyID) (using, blocking int, err error)
```

- `policiesListResponse` gains `RateLimiterConfigured bool \`json:"rateLimiterConfigured"\`` (the create form on the list page needs it).

- [ ] **Step 1: Write the failing tests** in `handlers_policies_test.go` (use `setup`, `principal`, `tctx`, `mkPolicy` from the existing tests):
  - `TestPoliciesDetailProjectsEveryField`: a policy with every field set (durations in whole seconds, lists unsorted with a duplicate) answers each wire field; a policy with nothing set answers `null` for every count and duration and `[]` for every list (assert on `json.Marshal` output containing `"rateLimit":null` and `"allowedIps":[]`).
  - `TestPoliciesDetailIsTenantScoped`: another tenant's policy and a missing id answer the identical `&dashcontract.Error{Code: CodeNotFound, Message: "policy not found"}`; `""` answers BAD_REQUEST `id is required`; `akey_...` answers BAD_REQUEST `id is not a policy id`.
  - `TestPoliciesDetailCountsKeys`: two active keys, one suspended and one revoked under the policy in t1, one key under it in t2 (written straight to the store with t2's tenant), answer `keysUsing: 4`, `keysBlockingDelete: 3`.
  - `TestPoliciesListAndDetailReportTheRateLimiter`: an engine without a limiter answers `false` on both; build one with `keysmith.WithRateLimiter(r)` (`options.go:25`; a stub `RateLimiter` whose `Allow` returns true) and assert `true`.
  - Carry-over: change `TestKeysCreateThenListAndDetailNeverCarryTheRawKey` so a failure prints only lengths (`assert.False(t, strings.Contains(body, raw), "response of %d bytes carries the raw key", len(body))`), never the key.
- [ ] **Step 2: Run** `go test ./extension/contract/ -run 'PoliciesDetail|RateLimiter'` — Expected: FAIL (undefined `policiesDetailHandler`).
- [ ] **Step 3: Implement.** `handlers_policies.go` holds `policiesDetailHandler(deps)`: `tenantFrom`, `loadPolicyForTenant`, `policyKeyCounts` (via `deps.Engine.Store().Keys().ListByPolicy`, counting only rows with `TenantID == tenant`), `RateLimiterConfigured: deps.Engine.RateLimiterConfigured()`. `projectPolicyDetail` sorts and de-duplicates each list. Add to `manifest.yaml`: `- { name: policies.detail, kind: query, version: 1, capability: read }` and a `policyDetail` query block with `cache: { staleTime: 30s }`; bind it in `contract.go`. Also, carry-over: the loader's INTERNAL log label in `load.go` says `keys.load`; pass the calling intent into `loadKeyForTenant`'s error mapping instead (add an `intent string` parameter and update every caller).
- [ ] **Step 4: Run** `go test ./extension/contract/...` and lint — Expected: PASS, 0 issues.
- [ ] **Step 5: Commit** `feat(contract): show one policy with every field and the keys that use it`.

### Task 5: `policies.create` and `policies.update`

**Files:**
- Create: `handlers_policy_write.go`, `handlers_policy_write_test.go`
- Modify: `errors.go` (map `ErrPolicyNameTaken`), `manifest.yaml`, `contract.go`

**Interfaces:**
- Consumes: `PolicyDetail`, `projectPolicyDetail`, `loadPolicyForTenant`, `engineCtx`, `appFrom`, `Deps.mapScopeError`.
- Produces:

```go
// policyFields: every field optional. On create a nil field is unset; on update
// a nil field is left alone, and 0 or an empty list clears it.
type policyFields struct {
	Name                   *string   `json:"name"`
	Description            *string   `json:"description"`
	MaxKeyLifetimeSeconds  *int64    `json:"maxKeyLifetimeSeconds"`
	GraceSeconds           *int64    `json:"graceSeconds"`
	AllowedScopes          *[]string `json:"allowedScopes"`
	RateLimit              *int64    `json:"rateLimit"`
	RateLimitWindowSeconds *int64    `json:"rateLimitWindowSeconds"`
	BurstLimit             *int64    `json:"burstLimit"`
	AllowedIPs             *[]string `json:"allowedIps"`
	AllowedOrigins         *[]string `json:"allowedOrigins"`
	AllowedMethods         *[]string `json:"allowedMethods"`
	AllowedPaths           *[]string `json:"allowedPaths"`
	RotationPeriodSeconds  *int64    `json:"rotationPeriodSeconds"`
	DailyQuota             *int64    `json:"dailyQuota"`
	MonthlyQuota           *int64    `json:"monthlyQuota"`
}
type policiesUpdateRequest struct {
	ID string `json:"id"`
	policyFields
}
type policyResponse struct{ Policy PolicyDetail `json:"policy"` }
func applyPolicyFields(p *policy.Policy, in policyFields) // copies set fields onto p
func validatePolicy(ctx context.Context, deps Deps, tenant string, p *policy.Policy) error // normalises lists in place, then checks
```

Validation runs on the merged policy (so create and update share it), in this order, first failure wins, every message BAD_REQUEST:
1. name trimmed; empty → `name is required`; over 200 runes → `name is too long`.
2. description trimmed; over 1000 runes → `description is too long`.
3. each number, in field order (`maxKeyLifetimeSeconds`, `graceSeconds`, `rateLimit`, `rateLimitWindowSeconds`, `burstLimit`, `rotationPeriodSeconds`, `dailyQuota`, `monthlyQuota`): negative → `<field> cannot be negative`.
4. caps: `maxKeyLifetimeSeconds` and `rotationPeriodSeconds` over 315360000 → `<field> is at most 10 years`; `graceSeconds` over 7776000 → `graceSeconds is at most 90 days`; `rateLimitWindowSeconds` over 2678400 → `rateLimitWindowSeconds is at most 31 days`; `rateLimit` or `burstLimit` over 1000000000 → `<field> is too large`.
5. pairings: `rateLimit > 0` with no window → `a rate limit needs a window`; `burstLimit > 0` with no rate limit → `a burst limit needs a rate limit`.
6. lists (each trimmed, blanks dropped, sorted, de-duplicated; more than 100 entries → `<field> has more than 100 entries`), in order: `allowedScopes` (each must exist in the tenant, through the same message as keys.create: `scope "x" does not exist in this tenant`), `allowedIps` (`net.ParseIP` or `net.ParseCIDR`, else `allowedIps: "x" is not an IP address or CIDR range`), `allowedOrigins` (`*` or an `http`/`https` URL with a host and no path, else `allowedOrigins: "x" is not an origin like https://example.com`), `allowedMethods` (upper-cased; one of GET HEAD POST PUT PATCH DELETE OPTIONS, else `allowedMethods: "x" is not an HTTP method`), `allowedPaths` (must start with `/`, else `allowedPaths: "x" must start with /`).

`ErrPolicyNameTaken` maps to CONFLICT `a policy with this name already exists`.

- [ ] **Step 1: Write the failing tests:**
  - A validation table test driving `policiesCreateHandler` with one bad field per row, asserting the exact code and message for every rule above, plus a row with two bad fields asserting the earlier one wins.
  - `TestPoliciesCreateStoresUnderTheContractTenant`: request context carries `forge.WithScope(ctx, forge.NewOrgScope("app_x", "org_other"))`; the stored policy has the contract tenant and app (mirror the keys.create test from 1a6267c).
  - `TestPoliciesCreateNormalisesLists`: `allowedMethods: ["get", "GET", " post "]` stores `["GET", "POST"]`.
  - `TestPoliciesUpdateLeavesOmittedFieldsAlone`: update with only `description` keeps `rateLimit` and `allowedScopes`.
  - `TestPoliciesUpdateClearsWithZeroAndEmpty`: `rateLimit: 0, rateLimitWindowSeconds: 0, allowedScopes: []` answers `null`, `null`, `[]`.
  - `TestPoliciesUpdateIsTenantScoped` (missing and foreign answer `policy not found`), `TestPoliciesWriteRefusesADuplicateName` (create and rename both answer CONFLICT `a policy with this name already exists`).
  - Both handlers need a user (UNAUTHENTICATED without one) and a tenant (PERMISSION_DENIED without one), as every other command.
- [ ] **Step 2: Run** `go test ./extension/contract/ -run Policies` — Expected: FAIL.
- [ ] **Step 3: Implement.** Create: `requireUser`, `tenantFrom`, `appFrom`; `p := &policy.Policy{}`; `applyPolicyFields`; `validatePolicy`; `deps.Engine.CreatePolicy(engineCtx(ctx, app, tenant), p)`; answer `policyResponse{projectPolicyDetail(p)}`. Update: `loadPolicyForTenant`, apply, validate, `UpdatePolicy(ctx, p)`, answer the projection of `p`. Manifest:
  - `- { name: policies.create, kind: command, version: 1, capability: write, invalidates: [policies.list, overview] }`
  - `- { name: policies.update, kind: command, version: 1, capability: write, invalidates: [policies.list, policies.detail, keys.detail] }`
- [ ] **Step 4: Run** `go test ./extension/contract/...`, lint — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): create and edit policies with checked fields`.

### Task 6: `policies.delete`

**Files:**
- Modify: `handlers_policy_write.go`, `handlers_policy_write_test.go`, `manifest.yaml`, `contract.go`

**Interfaces:**
- Consumes: `loadPolicyForTenant`, `policyKeyCounts`.
- Produces: `policiesDeleteHandler(deps)` answering `struct{ ID string \`json:"id"\` }`. On `ErrPolicyInUse` it answers CONFLICT with the blocking count: `1 key that is not revoked uses this policy` / `N keys that are not revoked use this policy`.

- [ ] **Step 1: Write the failing tests:** deleting a policy with no keys answers its id and `policies.detail` then answers NOT_FOUND; one active and one revoked key answers CONFLICT `1 key that is not revoked uses this policy`; after revoking the active key the delete succeeds and `keys.detail` on the revoked key answers `policy: null` with `key.policyId` still set; foreign and missing ids answer `policy not found`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement:** load for tenant, `DeletePolicy`; on `ErrPolicyInUse`, call `policyKeyCounts` for the message (if that read fails, answer CONFLICT `keys that are not revoked use this policy`). Manifest: `- { name: policies.delete, kind: command, version: 1, capability: write, invalidates: [policies.list, policies.detail, overview] }`.
- [ ] **Step 4: Run** tests, lint — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): delete a policy once no live key uses it`.

### Task 7: `scopes.create` and `scopes.delete`

**Files:**
- Create: `handlers_scope_write.go`, `handlers_scope_write_test.go`
- Modify: `errors.go` (map `ErrScopeNameTaken`), `manifest.yaml`, `contract.go`

**Interfaces:**
- Produces: `scopesCreateRequest{Name, Parent, Description string}` → `struct{ Scope ScopeSummary \`json:"scope"\` }`; `scopesDeleteRequest{ID string}` → `struct{ ID string \`json:"id"\` }`; `requireScopeID` (`id is required` / `id is not a scope id`); `loadScopeForTenant` (NOT_FOUND `scope not found` for missing and foreign).

Create validation, in order, BAD_REQUEST: name trimmed, empty → `name is required`; over 100 runes → `name is too long`; contains any whitespace → `name cannot contain spaces`; description trimmed, over 1000 runes → `description is too long`; parent trimmed; equal to name → `a scope cannot be its own parent`; non-empty and not a scope in the tenant → `parent scope "x" does not exist in this tenant`. `ErrScopeNameTaken` → CONFLICT `a scope with this name already exists`.

Delete: `ErrScopeHasChildren` → CONFLICT with the count from `Scopes().List(TenantID, Parent: name)` (limit 201): `1 scope names this scope as its parent` / `N scopes name this scope as their parent` (if over 200, `more than 200 scopes name this scope as their parent`).

- [ ] **Step 1: Write the failing tests:** the validation table; a create under a forge OrgScope stores under the contract tenant; duplicate name CONFLICT; delete of a held scope removes it from `keys.detail` scopes; delete with two children answers `2 scopes name this scope as their parent`; foreign and missing ids answer `scope not found`; user and tenant refusals.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with `engineCtx` on create. Manifest:
  - `- { name: scopes.create, kind: command, version: 1, capability: write, invalidates: [scopes.list, overview] }`
  - `- { name: scopes.delete, kind: command, version: 1, capability: write, invalidates: [scopes.list, keys.list, keys.detail, overview] }` (keys.list shows scopes too; the spec's table omitted it.)
- [ ] **Step 4: Run** `go test ./...`, lint, `make test-backends` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): create and delete scopes`.

## Phase C: fixture (forge-dashboard)

### Task 8: The fixture models every new intent

**Files:**
- Modify: `packages/fixture-server/keysmith-fixtures.mjs`
- Leave in the working tree, uncommitted: `packages/fixture-server/verify.mjs` INPUT lines

**Interfaces:**
- Consumes: the Go contract's exact messages and order from Tasks 4-7.
- Produces: handlers `policies.detail`, `policies.create`, `policies.update`, `policies.delete`, `scopes.create`, `scopes.delete`; `policies.list` gains `rateLimiterConfigured`, from `process.env.FIXTURE_KEYSMITH_RATE_LIMITER === "1"` (default false); new `KEYSMITH_IDS`: `retiredPolicy` (acme, used only by the revoked "Old mobile app" key, so its delete succeeds), `scopeBilling` (acme, `billing`, parent of `billing:read` and `billing:write`, so its delete refuses), `scopeLegacyRead` (acme, `legacy:read`, held by no key). Seed policies gain the stored-only fields (Standard: rateLimit 100, window 60, burst 20, allowedMethods GET and POST, dailyQuota 10000) so the detail page has something in every group.

Policy rows in the fixture store durations in milliseconds as today; `projectPolicyDetail` converts to whole seconds and `null` for zero, like `projectPolicySummary`.

- [ ] **Step 1: Write a scratchpad probe** (not committed) that starts the fixture on a free port and asserts, for each Go message in Tasks 4-7, the same code and message from the fixture, including order (two bad fields → the earlier one), CONFLICT counts, and that a deleted scope disappears from `keys.detail`.
- [ ] **Step 2: Run it** — Expected: FAIL (unknown intents).
- [ ] **Step 3: Implement** the handlers, mirroring the Go names (`loadPolicyForTenant`, `validatePolicy`, `policyKeyCounts`). Add the INPUT lines to `verify.mjs` after the keysmith block (in the working tree only): `policies.detail` and `policies.update` on Standard, `policies.create` with a new name, `policies.delete` on `retiredPolicy`, `scopes.create` with a new name, `scopes.delete` on `scopeLegacyRead`.
- [ ] **Step 4: Run** the probe, then `node packages/fixture-server/verify.mjs http://localhost:<port>` — Expected: probe PASS; verify 0 failures. Stop the fixture.
- [ ] **Step 5: Commit** only `keysmith-fixtures.mjs`: `feat(fixture): model policy and scope writes`. Report the `verify.mjs` lines as left uncommitted.

## Phase D: React (`packages/plugin-keysmith`)

### Task 9: Types, duration helpers, the Policies list, and policy names on the key list

**Files:**
- Modify: `src/types.ts`, `src/format.ts`, `src/index.tsx`, `src/pages/keys.tsx`
- Create: `src/pages/policies.tsx`, `test/policies.test.tsx`
- Test: `test/format.test.ts`, `test/keys.test.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Produces (TS):

```ts
export type PolicyDetail = {
  id: string; name: string; description?: string
  maxKeyLifetimeSeconds: number | null; graceSeconds: number | null; allowedScopes: string[]
  rateLimit: number | null; rateLimitWindowSeconds: number | null; burstLimit: number | null
  allowedIps: string[]; allowedOrigins: string[]; allowedMethods: string[]; allowedPaths: string[]
  rotationPeriodSeconds: number | null; dailyQuota: number | null; monthlyQuota: number | null
  createdAt: string; updatedAt: string
}
export type PolicyDetailResponse = { policy: PolicyDetail; keysUsing: number; keysBlockingDelete: number; rateLimiterConfigured: boolean }
export type PolicyFields = Partial<Omit<PolicyDetail, "id" | "createdAt" | "updatedAt">>
// PoliciesList gains: rateLimiterConfigured: boolean
export type DurationUnit = "seconds" | "minutes" | "hours" | "days"
export function splitDuration(seconds: number | null, units: DurationUnit[]): { value: string; unit: DurationUnit } // largest unit that divides evenly; null → { value: "", unit: units[units.length - 1] }
export function toSeconds(value: string, unit: DurationUnit): number | null // "" → null; not a whole non-negative number → NaN
export function policyPath(id: string): string // `/policies/${encodeURIComponent(id)}`
export function formatRateLimit(p: Pick<PolicyDetail, "rateLimit" | "rateLimitWindowSeconds">): string | null // "100 per 1 minute", null when unset
```

Behaviour:
- Policies page at `/policies`: PageHeader "Policies", description "Rules attached to keys. Each field says whether Keysmith enforces it.", action "Create policy" (opens the Task 10 editor, rendered outside the QueryBoundary; until Task 10 lands, leave the button out and add it there). ResourceTable over `policies.list` with `limit: 200`: Name (PluginLink to `policyPath`, `font-medium`), Max lifetime (`formatDuration` or NoneCell), Grace ("1 day" or "24 hours (default)" in muted text), Allowed scopes (TagList mono; empty reads "Any scope"). `hasMore` adds "Showing the first 200 policies." EmptyState "No policies yet." with the create action.
- Nav: Keys (priority 0, KeyRoundIcon), Policies (1, ShieldCheckIcon), Scopes (2, TagsIcon, route arrives in Task 12; add the nav entry there), all group "API keys". Route `/policies`.
- Keys list Policy column (carry-over): read `policies.list` (`limit: 200`) and show the policy's name as a PluginLink to its page; an id with no match shows the id in `font-mono text-xs`.

- [ ] **Steps:** tests first for `splitDuration`/`toSeconds`/`formatRateLimit` edge cases (0, null, 90 days, 61 seconds stays seconds, "1.5" → NaN, "-1" → NaN), the list page (rows, empty, hasMore line, failure via throwing client), the nav entries resolving in `plugin.test.tsx`, and the key list showing a policy name and falling back to the id; run (FAIL); implement; run (PASS); commit `feat(plugin-keysmith): list policies and name them on the key list`.

### Task 10: The policy editor, grouped by what enforces each field

**Files:**
- Create: `src/components/policy-editor-dialog.tsx`, `test/policy-editor-dialog.test.tsx`
- Modify: `src/pages/policies.tsx` (Create policy)

**Interfaces:**
- Consumes: `PolicyDetail`, `PolicyFields`, `splitDuration`, `toSeconds`, `policyPath`, `scopes.list`.
- Produces: `PolicyEditorDialog({ open, onOpenChange, policy?: PolicyDetail, rateLimiterConfigured: boolean })`. With no `policy` it creates (`policies.create`) and on success navigates to `policyPath(id)`; with one it edits (`policies.update`, sending every field) and closes.

Behaviour (follow `create-key-dialog.tsx`: synchronous `sending` ref, lock while in flight, `reset()` on open, errors inside the dialog, Base UI `disablePointerDismissal` while sending):
- Top: Name (required), Description.
- Section "Enforced by Keysmith", line: "Keysmith checks these: the lifetime when a key is created, scopes when they are assigned, and the grace when a key is rotated." Fields: Max key lifetime (number + days/hours; blank = "No maximum"), Grace on rotation (number + hours/days; blank = "24 hours (default)"), Allowed scopes (checkboxes from `scopes.list` limit 200, names in mono; none ticked = "Any scope"). On edit, an extra line: "Changes apply from now on. Existing keys keep their expiry and scopes."
- Section "Enforced only with a rate limiter", line from `rateLimiterConfigured`: true → "This deployment has a rate limiter, so Keysmith enforces these."; false → "This deployment has no rate limiter. These are stored, but not enforced here." Fields: Rate limit (requests), Window (number + seconds/minutes/hours).
- Section "Stored for your application", line: "Keysmith does not check these. Your application can read them from ValidationResult.Policy." Fields: Burst limit, Allowed IPs, Allowed origins, Allowed paths (textareas, one per line, mono), Allowed methods (checkboxes GET HEAD POST PUT PATCH DELETE OPTIONS), Rotation period (number + days), Daily quota, Monthly quota.
- Client checks before sending, with the server's wording: name required; a duration that is not a whole non-negative number → "<Label> must be a whole number."; rate limit without window → "A rate limit needs a window." The server stays the authority; its BAD_REQUEST and CONFLICT messages render in the dialog.
- Every field is sent: blank number → `0`, blank list → `[]` (on edit this clears it, which is what the form shows).

- [ ] **Steps:** tests first: the create payload field by field (seconds conversion: 90 days → 7776000, 1 minute window → 60), edit prefills from a `PolicyDetail` (including splitting 86400 into 1 day) and sends `id`; clearing a field sends 0 / []; both rate-limiter lines; the edit-only "Changes apply" line; server CONFLICT message shown; double submit sends once; failure via throwing client. Run (FAIL), implement, run (PASS), wire "Create policy" on the list page outside its QueryBoundary, commit `feat(plugin-keysmith): create and edit policies grouped by what enforces them`.

### Task 11: The policy detail page with edit and delete

**Files:**
- Create: `src/pages/policy-detail.tsx`, `test/policy-detail.test.tsx`
- Modify: `src/index.tsx` (route `/policies/:id`, no nav entry)

**Interfaces:**
- Consumes: `policies.detail`, `keys.list` with `policyId`, `PolicyEditorDialog`, `formatRateLimit`, `formatDuration`.

Behaviour:
- Header: name, description; actions Edit (opens the editor with the policy) and Delete (destructive).
- Three DescriptionList sections with the same headings and lines as the editor (including the rate-limiter line). Unset values read with NoneCell; lists as TagList mono; Created and Updated as Timestamp.
- "Keys using this policy": "N keys use this policy." plus, when some are revoked, "M of them are revoked." Then a ResourceTable over `keys.list` `{ policyId, limit: 25, offset }` with Name (link), Key (masked mono), State badge, paging like the keys page.
- Delete: disabled when `keysBlockingDelete > 0`, with "You can delete this policy once no active, suspended or expired key uses it." ConfirmDialog "Delete <name>?" description "Revoked keys that used it will show no policy. This cannot be undone." Server CONFLICT renders in children. On success navigate to `/policies`.
- Not-found: EmptyState "No policy with this id." with "Back to policies" (like key-detail's `isNoSuchKey`, matching `policy not found` and `id is not a policy id`).
- The editor and the delete dialog render outside the QueryBoundary with their open state above it, and take the policy from the last detail that arrived for this id (copy key-detail's `useLatestDetail` idea). Snapshot the name when Delete opens.

- [ ] **Steps:** tests first: sections and lines for both limiter values; counts line with and without revoked; keys table filtered by policyId (assert the request params); delete disabled with blocking keys; delete success navigates; CONFLICT shown; a page-level test with the `hostLikeClient` pattern from `test/key-detail.test.tsx` showing the edit dialog survives the `policies.detail` refetch after `policies.update`, and fails when moved inside the boundary; not-found. Run (FAIL), implement, run (PASS), commit `feat(plugin-keysmith): show a policy, the keys that use it, and edit or delete it`.

### Task 12: The Scopes page

**Files:**
- Create: `src/pages/scopes.tsx`, `src/components/create-scope-dialog.tsx`, `test/scopes.test.tsx`
- Modify: `src/index.tsx` (route `/scopes`, nav entry)

Behaviour:
- PageHeader "Scopes", action "Create scope". A line under the header: "Parents are stored for your application. Keysmith does not use them when matching, so a key with read does not also get read:users."
- ResourceTable over `scopes.list` `limit: 200`: Name (mono), Parent (mono, or NoneCell), Description, and a Delete button per row. `hasMore` → "Showing the first 200 scopes." EmptyState "No scopes yet." with the create action.
- Create dialog: Name (mono input), Parent (NativeSelect: "No parent" plus every scope name), Description. Errors inline (server messages verbatim). Lock while in flight; `reset()` on open.
- Delete: ConfirmDialog "Delete <name>?" description "Every key that holds it loses it. This cannot be undone." CONFLICT (children) renders in children. Snapshot the name on open.
- Both dialogs render outside the QueryBoundary.

- [ ] **Steps:** tests first: rows with and without parent, the parents line, create payload (trimmed name, parent "" omitted or sent as ""; match what Go accepts), CONFLICT duplicate shown, delete payload by id, children CONFLICT shown, double click sends once, a hostLikeClient page test that the delete dialog's error survives the `scopes.list` refetch. Run (FAIL), implement, run (PASS), commit `feat(plugin-keysmith): list, create and delete scopes`.

### Task 13: Key detail links its policy, and slice 3 React carry-overs

**Files:**
- Modify: `src/pages/key-detail.tsx`, `src/components/key-actions.tsx`
- Test: `test/key-detail.test.tsx`

Behaviour:
- The Policy section's name becomes a PluginLink to `policyPath(policy.id)`.
- Carry-over: `resetReactivate()` must not drop an in-flight reactivate's answer. Only reset when the reactivate command is not loading.
- Carry-over: confirm the kit Button shows `aria-pressed="true"` visibly for the "Hide key" toggle (read `packages/kit/src/components/button.tsx` for an `aria-pressed:` style). If it has none, add `aria-pressed:bg-muted` (or the kit's selected token) on the toggle's className in `one-time-key.tsx` and test the attribute.

- [ ] **Steps:** tests first: the policy link href; starting Rotate while a reactivate is in flight keeps the reactivate refusal when it lands; run (FAIL), implement, run (PASS), commit `fix(plugin-keysmith): link a key's policy and keep a late reactivate answer`.

### Task 14: Verify in the browser (controller)

Start the fixture (`FIXTURE_KEYSMITH_RATE_LIMITER` unset, then `1`) and the shell. On `/@keysmith/policies`: create a policy with fields in all three groups, land on its page, check every section and the limiter line both ways; edit it, clear a field, rename into "Standard" (CONFLICT shown); delete Retired (succeeds, the revoked key's page shows no policy) and try Standard (disabled, with the reason). On `/@keysmith/scopes`: create a child of `billing`, try a duplicate, delete `billing` (children CONFLICT), delete `legacy:read`; assign a scope to a key, delete that scope, and see it gone from the key. Check the keys list shows policy names and the key page links its policy. Then commit the `verify.mjs` lines via a temporary index, and run the whole-branch review across both repos.
