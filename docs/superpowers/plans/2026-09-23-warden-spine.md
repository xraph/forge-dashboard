# Warden dashboard spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest end-to-end path from Warden's Go engine to a React page in the Forge dashboard, and prove it works, before any of the 48 intents are written.

**Architecture:** Warden gains a contract contributor named `warden` in its own repository, registered through `Extension.RegisterContractContributor`, which answers six intents over the dashboard's POST envelope. `forge-dashboard` gains `packages/plugin-warden`, which declares routes and nav and reads those intents. A `warden` section in the fixture server lets the pages run without a Go server. One change lands in warden core: a `WithCallDryRun` call option that makes an authorization check safe to press twice.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0` (dashboard contract, dispatcher, loader), React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`, Node for the fixture server.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`

## Global Constraints

- Contributor name is exactly `warden`. Plugin `extension` field must match it. A mismatch renders nothing and logs nothing.
- Contract DTOs are camelCase. Never return a warden domain struct (snake_case) on the wire.
- Every intent that pages a stored collection takes `limit` and `offset` and returns `{items, total, limit, offset}`. No cursors anywhere. This binds the browsable resource lists (roles, permissions, assignments, relations, resource types, policies, check logs). It does NOT bind two other shapes: a derived set with no stored rows to page (`namespaces.list`, which scans for distinct values and returns a flat array), and a fixed-size feed that is a widget rather than a browsable list (`overview.recentChecks`, which takes `limit` only). The framework's own `audit.list` is `limit`-only for the same reason.
- Namespace filter fields are `*string`: `nil` means every namespace, `""` means the tenant root, a path means that namespace.
- Optional update fields are pointers, including `*[]string` for lists that can be emptied.
- Every command declares `meta.invalidates` in the manifest.
- **Never resolve a tenant from the request context.** `warden.ScopeFromContext` and `forge.ScopeFrom` both return empty on the contract path, because nothing there propagates a scope. Resolve from `Principal.Claims` then `Deps.DefaultTenantID`, and refuse with `PERMISSION_DENIED` when neither answers. An empty tenant matches every tenant's rows rather than none.
- Identifier values carry `font-mono text-xs`. The column an operator reads carries `font-medium`.
- Every table caption carries a live row count, including at zero rows.
- A cell meaning "none" uses `NoneCell` or `TagList`. Never a blank, never a bare dash. A possibly-absent timestamp uses `Timestamp`.
- Badge variants by proportion, not meaning: `outline` for the majority state, `secondary` notable but not wrong, `default` affirmative, `destructive` for what somebody came to find.
- The tenant root namespace renders as `/`, never as the word `root`.
- Errors render inside the dialog that can fail, never on the page body.
- Every `ConfirmDialog` gets `pending`.
- Tests stub a thrown `ContractError`, never `{ok: false}`.
- No test reads a source file with `node:fs`. Use `import.meta.glob` with `{query: "?raw", eager: true}`.
- This git tree is shared with other sessions. Commit with `git commit -m "..." -- <paths>`. Never `git commit -a`, never `--amend`.
- No `Co-Authored-By` trailers. No Claude or Anthropic attribution in any committed prose.
- No em dashes in any committed prose.

## Review Focus

These are the failure modes the spec implies that the happy-path tests would not reach. Each has a test assigned to the task that owns the code.

1. A request whose tenant cannot be resolved must refuse, and two tenants asking the same question must get different answers. An empty tenant id matches every row in a store `ListFilter`, and on a check it can return an allow the real tenant's policies would deny. Covered in Task 3.
2. A namespace literally named `root` must stay distinguishable from the tenant root, which renders as `/`. `namespaceSegmentRegex` permits `root` as a segment. Covered in Task 8.
3. `overview.stats` that cannot resolve a tenant must make the page say "no tenant selected" rather than show zero of everything. Covered in Tasks 3 and 7.
4. `config.detail` with `EnableCheckLog` false must drive a banner, because an empty check log is otherwise indistinguishable from an idle system. Covered in Tasks 2 and 9.
5. `maintenance.run` that purges zero rows succeeded and changed nothing. It must not read as a failure and must not read as having purged something. Covered in Tasks 4 and 9.
6. The namespace filter with only the tenant root present must still offer both "All namespaces" and "Tenant root", because they are different queries even when they return the same rows. Covered in Task 8.

---

## File Structure

**warden repository** (`/Users/rexraphael/Work/xraph/forgery/warden`)

| File | Responsibility |
|---|---|
| `call_options.go` (modify) | Add `dryRun` and `WithCallDryRun` |
| `engine.go` (modify) | Four dry-run guards in `Check`, one in `failCheck` |
| `dryrun_test.go` (create) | Proves dry run skips cache, log and hooks |
| `extension/contract/contract.go` (create) | `Deps`, `Register`, manifest load |
| `extension/contract/manifest.yaml` (create) | Contributor, intents, queries, graph |
| `extension/contract/errors.go` (create) | `mapWardenError` |
| `extension/contract/handlers_config.go` (create) | `config.detail` |
| `extension/contract/handlers_overview.go` (create) | `overview.stats`, `overview.recentChecks` |
| `extension/contract/handlers_namespaces.go` (create) | `namespaces.list` |
| `extension/contract/handlers_maintenance.go` (create) | `maintenance.run`, `maintenance.cacheInvalidate` |
| `extension/extension.go` (modify) | `RegisterContractContributor` |
| `extension/config.go` (modify) | `Dashboard.TenantID` |

**forge-dashboard repository** (this one)

| File | Responsibility |
|---|---|
| `packages/plugin-warden/package.json` etc. (create) | Package scaffold, copied from `plugin-streaming` |
| `packages/plugin-warden/src/index.tsx` (create) | `definePlugin`, nav, routes |
| `packages/plugin-warden/src/components/namespace-filter.tsx` (create) | The three-state filter every later list reuses |
| `packages/plugin-warden/src/pages/overview.tsx` (create) | Stat tiles and recent checks |
| `packages/plugin-warden/src/pages/config.tsx` (create) | Read-only config, banner, maintenance controls |
| `packages/plugin-warden/test/harness.tsx` (create) | Stub clients, copied from `plugin-streaming` |
| `packages/fixture-server/server.mjs` (modify) | `warden` seed state and handlers |
| `apps/shell/src/App.tsx` (modify) | Register the plugin |

---

## Task 1: `WithCallDryRun` in warden core

Makes an authorization check safe to press twice. Without it the playground writes an audit entry on every press, primes the cache, fires `PolicyObligationFired` hooks that Chronicle audit listens to, and serves the second press from cache with no reasoning and a meaningless `EvalTimeNs`.

**Files:**
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/call_options.go`
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/engine.go` (the `Check` body, and `failCheck`)
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/dryrun_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `warden.WithCallDryRun() warden.CallOption`. Task 2 does not use it; Plan 4's playground does. It ships here because it is core work and does not belong in a UI task.

- [ ] **Step 1: Write the failing tests**

Create `/Users/rexraphael/Work/xraph/forgery/warden/dryrun_test.go`. Read `engine_test.go` first for the existing helper that builds an engine over a memory store, and reuse it rather than writing a new one.

```go
package warden

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"
	"github.com/xraph/warden/store/memory"
)

// seedAllow creates a tenant where user:alice may read document.
func seedAllow(t *testing.T, s *memory.Store) {
	t.Helper()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "Reader", Slug: "reader"}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create role: %v", err)
	}
	p := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, p); err != nil {
		t.Fatalf("create permission: %v", err)
	}
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{NamespacePath: "", Name: "document:read"}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	a := &assignment.Assignment{TenantID: "t1", RoleID: r.ID, SubjectKind: "user", SubjectID: "alice"}
	if err := s.CreateAssignment(ctx, a); err != nil {
		t.Fatalf("create assignment: %v", err)
	}
}

func readReq() *CheckRequest {
	return &CheckRequest{
		Subject:  Subject{Kind: SubjectUser, ID: "alice"},
		Action:   Action{Name: "read"},
		Resource: Resource{Type: "document", ID: "doc1"},
		TenantID: "t1",
	}
}

// countCheckLogs drains the writer and returns how many entries landed.
func countCheckLogs(t *testing.T, eng *Engine, s *memory.Store) int {
	t.Helper()
	// The writer batches on a 250ms interval; give it room to flush.
	time.Sleep(400 * time.Millisecond)
	n, err := s.CountCheckLogs(context.Background(), checklogFilterForTenant("t1"))
	if err != nil {
		t.Fatalf("count check logs: %v", err)
	}
	return int(n)
}

func TestDryRunWritesNoCheckLog(t *testing.T) {
	s := memory.New()
	seedAllow(t, s)
	eng, err := NewEngine(WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	ctx := context.Background()

	if _, err := eng.Check(ctx, readReq(), WithCallDryRun()); err != nil {
		t.Fatalf("dry run check: %v", err)
	}
	if got := countCheckLogs(t, eng, s); got != 0 {
		t.Fatalf("dry run wrote %d check log entries, want 0", got)
	}

	// The same check without the option still logs, so the test is not
	// passing because logging is broken.
	if _, err := eng.Check(ctx, readReq()); err != nil {
		t.Fatalf("normal check: %v", err)
	}
	if got := countCheckLogs(t, eng, s); got != 1 {
		t.Fatalf("normal check wrote %d check log entries, want 1", got)
	}
}

func TestDryRunNeitherReadsNorWritesCache(t *testing.T) {
	s := memory.New()
	seedAllow(t, s)
	eng, err := NewEngine(WithStore(s), WithConfig(Config{CacheTTL: time.Minute}))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	ctx := context.Background()

	// A dry run must not populate the cache, so a following normal check
	// still evaluates rather than being served a cached copy.
	if _, err := eng.Check(ctx, readReq(), WithCallDryRun()); err != nil {
		t.Fatalf("dry run: %v", err)
	}

	// Warm the cache with a real check, then revoke the grant in the store.
	if _, err := eng.Check(ctx, readReq()); err != nil {
		t.Fatalf("warming check: %v", err)
	}
	if err := s.DeleteAssignmentsBySubject(ctx, "t1", "user", "alice"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// A normal check is served the stale allow from cache.
	cached, err := eng.Check(ctx, readReq())
	if err != nil {
		t.Fatalf("cached check: %v", err)
	}
	if !cached.Allowed {
		t.Fatal("expected the warm cache to serve a stale allow; cache may not be enabled")
	}

	// A dry run ignores that cache entry and evaluates against the store,
	// which no longer grants anything.
	fresh, err := eng.Check(ctx, readReq(), WithCallDryRun())
	if err != nil {
		t.Fatalf("dry run after revoke: %v", err)
	}
	if fresh.Allowed {
		t.Fatal("dry run was served a cached allow; it must bypass the cache read")
	}
}
```

The `checklogFilterForTenant` helper does not exist. Add it at the bottom of the same file:

```go
// Returns a pointer: CountCheckLogs takes *QueryFilter, and Go cannot take
// the address of a function call result.
func checklogFilterForTenant(tenantID string) *checklog.QueryFilter {
	return &checklog.QueryFilter{TenantID: tenantID}
}
```

and add `"github.com/xraph/warden/checklog"` to the imports.

Check `engine_test.go` for the real names of `NewEngine`, `WithStore`, `WithConfig` and `memory.New` before running. If any differs, use the real one; do not invent options.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test -run 'TestDryRun' ./... -v
```

Expected: compile failure, `undefined: WithCallDryRun`.

- [ ] **Step 3: Add the option**

In `call_options.go`, add the field to `callOptions`:

```go
type callOptions struct {
	tenantID         string
	appID            string
	namespacePath    string
	namespacePathSet bool // distinguishes "explicitly set to empty" from "not set"
	dryRun           bool
}
```

and the option, after `WithCallNamespacePath`:

```go
// WithCallDryRun evaluates the check without any of its side effects: the
// result cache is neither read nor written, no check log entry is enqueued,
// and no plugin hooks fire.
//
// It exists for callers that ask "what would this decide" rather than
// "decide this", the dashboard playground above all. Without it, pressing
// a playground button writes an audit entry indistinguishable from
// production traffic, fires PolicyObligationFired at whatever is listening,
// and serves the second press from cache, which skips evaluation entirely
// and reports a cache lookup as the evaluation time.
//
// The decision itself is identical. Only the side effects are suppressed.
func WithCallDryRun() CallOption {
	return func(o *callOptions) {
		o.dryRun = true
	}
}
```

- [ ] **Step 4: Guard the four side effects in `Check`**

In `engine.go`, inside `Check`, after `co := resolveCallOptions(opts)` is already resolved, the four guards are:

Cache read, currently `if e.cache != nil {`:

```go
	// 1. Cache hit? Hooks and the check log still fire on a hit: only the
	// RBAC/ReBAC/ABAC evaluation itself is skipped. A dry run skips the
	// lookup entirely, because a cached answer carries no reasoning and its
	// EvalTimeNs is a cache lookup rather than an evaluation.
	if e.cache != nil && !co.dryRun {
```

Cache write, currently `if e.cache != nil {` after the merge:

```go
	// 6. Cache the result.
	if e.cache != nil && !co.dryRun {
```

Hooks, currently `e.emitAfterCheck(ctx, req, result)`:

```go
	// 7. Extension hooks: per-obligation, then after check.
	if !co.dryRun {
		e.emitAfterCheck(ctx, req, result)
	}
```

Check log, currently `e.writeCheckLog(ctx, scope, req, result, false, "")`:

```go
	// 8. Write check log entry (via the bounded batching writer, never a
	// per-call goroutine).
	if !co.dryRun {
		e.writeCheckLog(ctx, scope, req, result, false, "")
	}
```

The cache-hit branch also calls `emitAfterCheck` and `writeCheckLog`. It is now unreachable under dry run because the whole branch is guarded, so leave its body alone.

- [ ] **Step 5: Guard `failCheck`**

`failCheck` writes a log entry on the error path, and a dry run must leave no trace even when it fails. Change its signature to take the flag and update its four call sites in `Check`.

```go
// failCheck records a check-evaluation failure (as a check log entry with
// Decision "error") and returns the error unchanged, so every Check error
// path still leaves an audit trail. A dry run leaves none, the same as its
// success path.
func (e *Engine) failCheck(ctx context.Context, scope tenantScope, req *CheckRequest, err error, dryRun bool) (*CheckResult, error) {
	e.metrics.StoreError("check")
	if !dryRun {
		e.writeCheckLog(ctx, scope, req, nil, false, err.Error())
	}
	return nil, err
}
```

Each of the three call sites inside `Check` becomes, for example:

```go
		rbacResult, rbacRoles, err = e.evaluateRBAC(ctx, scope, req)
		if err != nil {
			return e.failCheck(ctx, scope, req, fmt.Errorf("warden rbac: %w", err), co.dryRun)
		}
```

Find every `e.failCheck(` with grep and update all of them:

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && grep -n "e.failCheck(" engine.go
```

- [ ] **Step 6: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test -run 'TestDryRun' ./... -v
```

Expected: both PASS.

- [ ] **Step 7: Run the whole suite, not just the new tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./...
```

Expected: all PASS. `failCheck` gained a parameter, so a missed call site is a compile error and a stale test is a failure. Both must be zero.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git add call_options.go engine.go dryrun_test.go && git commit -m "feat(engine): add WithCallDryRun for checks that ask rather than decide" -- call_options.go engine.go dryrun_test.go
```

---

## Task 2: The contract package, and one intent end to end

The Go spine. After this task the `warden` contributor exists, appears in the capabilities response, and answers one query.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/contract.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/manifest.yaml`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/errors.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_config.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_config_test.go`
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/extension.go`

**Interfaces:**
- Consumes: `warden.Engine` and `warden.Config`.
- Produces: `contract.Deps{Engine *warden.Engine, DefaultTenantID string}`, `tenantFrom(p, deps)` which every later handler opens with, `contract.Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error`, and `mapWardenError(err error) error` used by every later handler. Tasks 3 and 4 add handlers to this package and register them inside `Register`.

- [ ] **Step 1: Read the worked example**

Read `/Users/rexraphael/Work/xraph/forgery/authsome/extension/contract/contract.go` and its `manifest.yaml`. Do not copy field names from this plan without checking them against that file and against warden's own structs. The plan is a summary and the playbook is explicit that summaries are not a source for field names.

- [ ] **Step 2: Write the failing test**

Create `handlers_config_test.go`:

```go
package contract

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/warden"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func testEngine(t *testing.T, cfg warden.Config) *warden.Engine {
	t.Helper()
	eng, err := warden.NewEngine(warden.WithStore(memory.New()), warden.WithConfig(cfg))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	return eng
}

func TestConfigDetailReportsTheEngineConfig(t *testing.T) {
	falseVal := false
	eng := testEngine(t, warden.Config{
		MaxGraphDepth:     7,
		CacheTTL:          30 * time.Second,
		EnableCheckLog:    &falseVal,
		CheckLogRetention: 48 * time.Hour,
	})

	h := configDetailHandler(Deps{Engine: eng})
	got, err := h(context.Background(), struct{}{}, dashcontract.Principal{})
	if err != nil {
		t.Fatalf("config.detail: %v", err)
	}

	if got.MaxGraphDepth != 7 {
		t.Errorf("maxGraphDepth = %d, want 7", got.MaxGraphDepth)
	}
	// The banner on the config page keys off this exact field. An empty
	// check log is otherwise indistinguishable from an idle system.
	if got.CheckLogEnabled {
		t.Error("checkLogEnabled = true, want false")
	}
	if got.CacheTTLSeconds != 30 {
		t.Errorf("cacheTTLSeconds = %d, want 30", got.CacheTTLSeconds)
	}
	if got.CheckLogRetentionHours != 48 {
		t.Errorf("checkLogRetentionHours = %d, want 48", got.CheckLogRetentionHours)
	}
}

func TestConfigDetailDefaultsAreReportedAsEnabled(t *testing.T) {
	// Every Enable* flag is a *bool where nil means enabled. A handler that
	// dereferences it naively panics; one that treats nil as false reports
	// a correctly-configured engine as switched off.
	eng := testEngine(t, warden.Config{})

	h := configDetailHandler(Deps{Engine: eng})
	got, err := h(context.Background(), struct{}{}, dashcontract.Principal{})
	if err != nil {
		t.Fatalf("config.detail: %v", err)
	}

	if !got.RBACEnabled || !got.ABACEnabled || !got.ReBACEnabled || !got.CheckLogEnabled {
		t.Errorf("nil Enable* flags must report enabled, got %+v", got)
	}
}

func TestConfigDetailWithoutAnEngineIsUnavailable(t *testing.T) {
	h := configDetailHandler(Deps{})
	_, err := h(context.Background(), struct{}{}, dashcontract.Principal{})
	if err == nil {
		t.Fatal("want an error when no engine is configured")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeUnavailable {
		t.Errorf("want CodeUnavailable, got %v", err)
	}
}
```

Add a small helper at the bottom so the test reads cleanly, and import `"errors"`:

```go
func errorsAs(err error, target any) bool { return errors.As(err, target) }
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -v
```

Expected: compile failure, `undefined: configDetailHandler`, `undefined: Deps`.

- [ ] **Step 4: Write `errors.go`**

```go
// Package contract wires warden into the Forge dashboard's contract path.
// It registers the `warden` contributor with the dashboard's contract
// registry and answers the intents the React plugin reads.
//
// Warden continues to expose its templ pages through DashboardContributor
// while this package grows; the templ dashboard is retired once every
// surface has an equivalent here. See warden/MIGRATION.md for the
// accounting.
package contract

import (
	"errors"
	"fmt"

	"github.com/xraph/warden"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// mapWardenError translates a warden error into the dashboard's canonical
// wire codes.
//
// The two immutability errors map to PERMISSION_DENIED rather than
// BAD_REQUEST on purpose: retyping the input will not help, so it is not
// bad input. Everything that a person can fix by changing what they typed
// is BAD_REQUEST.
func mapWardenError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, warden.ErrNotFound):
		return &dashcontract.Error{Code: dashcontract.CodeNotFound, Message: err.Error()}
	case errors.Is(err, warden.ErrAlreadyExists):
		return &dashcontract.Error{Code: dashcontract.CodeConflict, Message: err.Error()}
	case errors.Is(err, warden.ErrSystemRoleImmutable),
		errors.Is(err, warden.ErrSystemPermissionImmutable):
		return &dashcontract.Error{Code: dashcontract.CodePermissionDenied, Message: err.Error()}
	case errors.Is(err, warden.ErrTenantRequired):
		return &dashcontract.Error{
			Code:    dashcontract.CodeBadRequest,
			Message: "no tenant in scope: select a tenant before reading warden data",
		}
	case errors.Is(err, warden.ErrCyclicRoleInheritance),
		errors.Is(err, warden.ErrMaxMembersExceeded),
		errors.Is(err, warden.ErrInvalidCondition):
		return &dashcontract.Error{Code: dashcontract.CodeBadRequest, Message: err.Error()}
	default:
		return &dashcontract.Error{Code: dashcontract.CodeInternal, Message: err.Error()}
	}
}

// requireEngine is the guard every handler opens with.
func requireEngine(deps Deps) error {
	if deps.Engine == nil {
		return &dashcontract.Error{
			Code:    dashcontract.CodeUnavailable,
			Message: "warden engine not configured",
		}
	}
	return nil
}

// tenantFrom resolves the caller's tenant for a contract request.
//
// READ THIS BEFORE CHANGING IT. It is the most dangerous function here.
//
// warden.ScopeFromContext does NOT work on this path. It reads either a
// warden.WithTenant value or forge.ScopeFrom(ctx), and nothing on the
// contract path sets either: grep extensions/dashboard/contract for
// context.WithValue and you will find nothing. A scope helper ported from
// warden/dashboard/contributor.go compiles, runs, and silently returns the
// empty string forever.
//
// The empty string is not a harmless zero. An empty TenantID in a store
// ListFilter matches EVERY tenant's rows rather than none, so a handler
// that resolved "" would serve every tenant's roles, permissions,
// assignments, relations, policies and check logs to whoever opened the
// dashboard. On an authorization check it is worse than a leak: a question
// asked in the wrong scope can return an ALLOW that the real tenant's
// policies would have denied.
//
// So this never defaults to empty. An unresolvable tenant refuses.
//
// Resolution order:
//  1. The principal's claims, the canonical per-request surface.
//  2. Deps.DefaultTenantID, for single-tenant deployments that configure it.
//  3. Refuse with PERMISSION_DENIED.
//
// Step 1 returns nothing today. dashauth.UserInfo is built by the auth
// provider, and authsome's userToUserInfo (extension/auth_pages.go) sets no
// Claims at all, so Principal.Claims is empty on every request. The claim
// read is here because it is where the tenant belongs once a tenant
// selector exists, and because reading it costs nothing. Until then a
// multi-tenant deployment either configures DefaultTenantID or gets
// refusals, which is the right behaviour for a dashboard that cannot tell
// which tenant it is looking at.
func tenantFrom(p dashcontract.Principal, deps Deps) (string, error) {
	// A claim that is PRESENT but unusable is not the same as no claim, and
	// the difference decides whether the fallback is safe.
	//
	// No claim at all means nothing has been said about the tenant, so a
	// configured default is a reasonable answer. A claim that is present
	// and does not resolve means something tried to say which tenant this
	// is and failed, and answering with a different tenant is how
	// "empty matches everything" gets reintroduced by somebody following
	// this function correctly. So a broken claim refuses.
	if raw, present := p.Claims[tenantClaim]; present {
		s, ok := raw.(string)
		if !ok || s == "" {
			return "", &dashcontract.Error{
				Code: dashcontract.CodePermissionDenied,
				Message: "tenant claim is present but unusable: refusing rather than " +
					"falling back to a different tenant",
			}
		}
		return s, nil
	}
	if deps.DefaultTenantID != "" {
		return deps.DefaultTenantID, nil
	}
	return "", &dashcontract.Error{
		Code: dashcontract.CodePermissionDenied,
		Message: "no tenant in scope: warden cannot tell which tenant this request is for. " +
			"Set warden.dashboard.tenant_id for a single-tenant deployment.",
	}
}

// tenantClaim is the claim key a tenant selector would populate, matching
// the app_id convention authsome uses.
const tenantClaim = "tenant_id"
```

Remove that last line once a later task uses `fmt`. Add `"context"` to the imports.

- [ ] **Step 5: Write `handlers_config.go`**

Read warden's `config.go` for the real field names before writing this. `Enable*` are `*bool` where nil means enabled, and `Config` has unexported accessor methods (`rbacEnabled()` and friends) that are not reachable from this package, so the nil check is written out here.

```go
// handlers_config.go: the read-only view of the engine's configuration.
//
// Warden's Config comes from Forge config, not from a store, so there is no
// write path and no settings intent. The templ dashboard rendered these same
// fields with every input marked Disabled.
package contract

import (
	"context"

	"github.com/xraph/warden"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// ConfigDetail is the config.detail response.
//
// Durations are flattened to whole units because the wire carries JSON and a
// Go duration serialises as a nanosecond integer nobody can read. The page
// formats from these.
type ConfigDetail struct {
	MaxGraphDepth          int   `json:"maxGraphDepth"`
	MaxGraphVisited        int   `json:"maxGraphVisited"`
	MaxGraphFanout         int   `json:"maxGraphFanout"`
	MaxBatchChecks         int   `json:"maxBatchChecks"`
	CacheTTLSeconds        int   `json:"cacheTtlSeconds"`
	CacheMaxSize           int   `json:"cacheMaxSize"`
	RBACEnabled            bool  `json:"rbacEnabled"`
	ABACEnabled            bool  `json:"abacEnabled"`
	ReBACEnabled           bool  `json:"rebacEnabled"`
	CheckLogEnabled        bool  `json:"checkLogEnabled"`
	RequireTenant          bool  `json:"requireTenant"`
	EvaluateAllModels      bool  `json:"evaluateAllModels"`
	CheckLogQueueSize      int   `json:"checkLogQueueSize"`
	CheckLogRetentionHours int64 `json:"checkLogRetentionHours"`
	MaintenanceIntervalMin int64 `json:"maintenanceIntervalMinutes"`
}

// enabled reads one of Config's tri-state flags. A nil pointer means the
// default, and every Enable* default is true.
func enabled(flag *bool) bool { return flag == nil || *flag }

func configDetailHandler(deps Deps) func(context.Context, struct{}, dashcontract.Principal) (ConfigDetail, error) {
	return func(_ context.Context, _ struct{}, _ dashcontract.Principal) (ConfigDetail, error) {
		if err := requireEngine(deps); err != nil {
			return ConfigDetail{}, err
		}
		c := deps.Engine.Config()
		return ConfigDetail{
			MaxGraphDepth:          c.MaxGraphDepth,
			MaxGraphVisited:        c.MaxGraphVisited,
			MaxGraphFanout:         c.MaxGraphFanout,
			MaxBatchChecks:         c.MaxBatchChecks,
			CacheTTLSeconds:        int(c.CacheTTL.Seconds()),
			CacheMaxSize:           c.CacheMaxSize,
			RBACEnabled:            enabled(c.EnableRBAC),
			ABACEnabled:            enabled(c.EnableABAC),
			ReBACEnabled:           enabled(c.EnableReBAC),
			CheckLogEnabled:        enabled(c.EnableCheckLog),
			RequireTenant:          enabled(c.RequireTenant),
			EvaluateAllModels:      c.EvaluateAllModels,
			CheckLogQueueSize:      c.CheckLogQueueSize,
			CheckLogRetentionHours: int64(c.CheckLogRetention.Hours()),
			MaintenanceIntervalMin: int64(c.MaintenanceInterval.Minutes()),
		}, nil
	}
}

var _ = warden.MaxNamespaceDepth // warden is imported for later handlers
```

Delete that last line once Task 4 imports `warden` for real.

- [ ] **Step 6: Write `manifest.yaml`**

Read authsome's `manifest.yaml` first for the exact schema. This is the whole file for now; Tasks 3 and 4 add to `intents`, `queries` and `graph`.

```yaml
schemaVersion: 1
contributor:
  name: warden
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [warden.read, warden.write]
  app:
    displayName: Warden
    slug: warden
    icon: shield-check
    priority: 20
    home: /

intents:
  - { name: config.detail, kind: query, version: 1, capability: read }

queries:
  config:
    intent: config.detail
    cache: { staleTime: 60s }

graph: []
```

- [ ] **Step 7: Write `contract.go`**

```go
package contract

import (
	"bytes"
	_ "embed"
	"fmt"

	"github.com/xraph/warden"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

//go:embed manifest.yaml
var manifestYAML []byte

// contributorName is the join key. The React plugin's `extension` field must
// match it exactly. A mismatch does not error anywhere: the plugin resolves
// to `hidden`, no routes mount, no nav appears, and nothing is logged,
// because a contributor the server never mentioned is an ordinary thing for
// a shell to encounter.
const contributorName = "warden"

// Deps bundles what the contract handlers need at registration time.
type Deps struct {
	// Engine is the live warden engine. Required.
	Engine *warden.Engine

	// DefaultTenantID is the tenant every dashboard request is scoped to
	// when the principal carries no tenant claim. Required for any
	// deployment that wants the dashboard to answer at all today, because
	// nothing populates Principal.Claims yet.
	//
	// Leave it empty in a multi-tenant deployment. Every read then refuses
	// with PERMISSION_DENIED, which is correct: a dashboard that cannot
	// tell which tenant it is looking at must not guess, and the empty
	// string would match every tenant's rows rather than none.
	DefaultTenantID string
}

// Register loads the embedded manifest, validates it, registers the `warden`
// contributor with reg, and binds the handlers against deps.
func Register(
	d *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
	deps Deps,
) error {
	if deps.Engine == nil {
		return fmt.Errorf("warden/contract: Engine is required")
	}

	m, err := loader.Load(bytes.NewReader(manifestYAML), "warden/extension/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("warden/contract: load manifest: %w", err)
	}
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("warden/contract: validate manifest: %w", err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("warden/contract: register manifest: %w", err)
	}

	if err := dispatcher.RegisterQuery(d, contributorName, "config.detail", 1, configDetailHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register config.detail: %w", err)
	}

	return nil
}
```

- [ ] **Step 8: Add the dashboard tenant setting**

In `/Users/rexraphael/Work/xraph/forgery/warden/extension/config.go`, find the config struct that carries `BasePath` and add a `Dashboard` block beside it. Read the file first; if a `Dashboard` struct already exists, add the field to it rather than creating a second one.

```go
// DashboardConfig configures warden's dashboard surfaces.
type DashboardConfig struct {
	// TenantID scopes every dashboard request when the caller's principal
	// carries no tenant claim.
	//
	// Nothing populates dashboard principal claims today, so in practice
	// this is what makes the dashboard answer at all. Set it for a
	// single-tenant deployment.
	//
	// Leave it empty in a multi-tenant deployment. Every read then refuses
	// with PERMISSION_DENIED, which is the correct behaviour: the empty
	// string in a store ListFilter matches every tenant's rows rather than
	// none, so guessing would serve one operator every tenant's data, and
	// on a check could return an allow the real tenant would have denied.
	TenantID string `json:"tenant_id" mapstructure:"tenant_id" yaml:"tenant_id"`
}
```

and on the extension's config struct:

```go
	// Dashboard configures the React dashboard surfaces.
	Dashboard DashboardConfig `json:"dashboard" mapstructure:"dashboard" yaml:"dashboard"`
```

- [ ] **Step 9: Wire it onto the Extension**

Read how authsome does this at `extension/extension.go:1038` and match the signature exactly. In warden's `extension/extension.go`, beside the existing `DashboardContributor`:

```go
// RegisterContractContributor implements the dashboard's contract
// auto-discovery. It registers the `warden` contributor so the React shell
// can read warden's intents.
//
// This is the parallel surface to DashboardContributor above. Both exist
// while the templ dashboard is being retired; see warden/MIGRATION.md.
func (e *Extension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
) error {
	if e.eng == nil {
		e.Logger().Warn("warden: engine not initialised; skipping contract contributor registration")
		return nil
	}
	if err := wardencontract.Register(disp, reg, wreg, wardencontract.Deps{Engine: e.eng, DefaultTenantID: e.config.Dashboard.TenantID}); err != nil {
		return fmt.Errorf("warden: register contract contributor: %w", err)
	}
	return nil
}
```

Add the imports, matching authsome's aliases:

```go
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	wardencontract "github.com/xraph/warden/extension/contract"
```

- [ ] **Step 10: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./extension/... -v
```

Expected: all three config tests PASS, build clean.

- [ ] **Step 11: Run the whole suite**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./...
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git add extension/contract extension/extension.go extension/config.go && git commit -m "feat(contract): register the warden contributor and answer config.detail" -- extension/contract extension/extension.go extension/config.go
```

---

## Task 3: `overview.stats`, `overview.recentChecks` and `namespaces.list`

Three reads. `overview.stats` is the one that must fail loudly with no tenant rather than reporting zero of everything.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_overview.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_namespaces.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_overview_test.go`
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/contract.go` (three registrations)
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/manifest.yaml`

**Interfaces:**
- Consumes: `Deps`, `requireEngine`, `tenantFrom`, `mapWardenError` from Task 2.
- Produces: `OverviewStats{Roles, Permissions, Assignments, Relations, Policies, ResourceTypes int64}`, `RecentChecksResponse{Checks []CheckLogSummary}`, `CheckLogSummary`, `NamespacesResponse{Namespaces []string}`. Task 7's page reads `OverviewStats` field names; Task 8's filter reads `NamespacesResponse`.

- [ ] **Step 1: Write the failing tests**

Create `handlers_overview_test.go`:

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/warden"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// principalFor builds a Principal carrying a tenant claim.
//
// Deliberately NOT a context helper. warden.WithTenant would compile and
// would prove nothing, because nothing on the contract path reads it: the
// handler resolves its tenant from the principal and from Deps, never from
// ctx. A test that seeded the context would pass against a handler that
// refuses every real request.
func principalFor(tenantID string) dashcontract.Principal {
	return dashcontract.Principal{Claims: map[string]any{"tenant_id": tenantID}}
}

func TestOverviewStatsWithoutATenantRefuses(t *testing.T) {
	// An unresolvable tenant must refuse, never default. The empty string
	// matches every tenant's rows in a store ListFilter rather than none,
	// so a handler that fell back to "" would serve one tenant's dashboard
	// the counts of all of them.
	eng := testEngine(t, warden.Config{})
	h := overviewStatsHandler(Deps{Engine: eng})

	_, err := h(context.Background(), struct{}{}, dashcontract.Principal{})
	if err == nil {
		t.Fatal("want an error when no tenant can be resolved")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodePermissionDenied {
		t.Fatalf("want CodePermissionDenied, got %v", err)
	}
}

func TestOverviewStatsIgnoresAContextScope(t *testing.T) {
	// The trap this package exists to avoid. warden.WithTenant is what the
	// templ dashboard used and it is invisible here, because nothing on the
	// contract path propagates a warden or forge scope into the handler's
	// context. A handler that read ctx would pass a test written this way
	// and refuse every real request, or worse, be "fixed" by defaulting to
	// the empty tenant.
	eng := testEngine(t, warden.Config{})
	h := overviewStatsHandler(Deps{Engine: eng})

	ctx := warden.WithTenant(context.Background(), "t1")
	if _, err := h(ctx, struct{}{}, dashcontract.Principal{}); err == nil {
		t.Fatal("a context scope must not satisfy tenant resolution on the contract path")
	}
}

func TestOverviewStatsIsScopedToItsOwnTenant(t *testing.T) {
	// The isolation test. Two tenants, different data, asked through the
	// same handler. If tenant resolution is broken in the direction that
	// leaks rather than the direction that refuses, both answers come back
	// identical and this is the test that says so.
	s := memory.New()
	ctx := context.Background()
	for _, tenant := range []string{"t1", "t2"} {
		n := 1
		if tenant == "t2" {
			n = 3
		}
		for i := 0; i < n; i++ {
			r := &role.Role{TenantID: tenant, Name: "R", Slug: fmt.Sprintf("r%d", i)}
			if err := s.CreateRole(ctx, r); err != nil {
				t.Fatalf("create role in %s: %v", tenant, err)
			}
		}
	}
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	h := overviewStatsHandler(Deps{Engine: eng})

	one, err := h(ctx, struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("t1: %v", err)
	}
	two, err := h(ctx, struct{}{}, principalFor("t2"))
	if err != nil {
		t.Fatalf("t2: %v", err)
	}
	if one.Roles != 1 {
		t.Errorf("t1 roles = %d, want 1", one.Roles)
	}
	if two.Roles != 3 {
		t.Errorf("t2 roles = %d, want 3", two.Roles)
	}
	if one.Roles == two.Roles {
		t.Fatal("both tenants reported the same count: tenant scoping is not being applied")
	}
}

func TestDefaultTenantIDIsUsedWhenTheClaimIsAbsent(t *testing.T) {
	// The single-tenant path. It must work without a claim, and it must not
	// widen to every tenant.
	s := memory.New()
	seedAllow(t, s)
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	h := overviewStatsHandler(Deps{Engine: eng, DefaultTenantID: "t1"})

	got, err := h(context.Background(), struct{}{}, dashcontract.Principal{})
	if err != nil {
		t.Fatalf("with DefaultTenantID: %v", err)
	}
	if got.Roles != 1 {
		t.Errorf("roles = %d, want 1", got.Roles)
	}
}

func TestNamespacesListIsScopedByIdentityNotCount(t *testing.T) {
	// Isolation asserted on identity. A count assertion passes when the
	// wrong rows come back in the right quantity, and here the rows have
	// names, so there is no excuse for counting them instead.
	s := memory.New()
	ctx := context.Background()
	for tenant, ns := range map[string]string{"t1": "eng", "t2": "billing"} {
		r := &role.Role{TenantID: tenant, NamespacePath: ns, Name: "R", Slug: "r"}
		if err := s.CreateRole(ctx, r); err != nil {
			t.Fatalf("create role in %s/%s: %v", tenant, ns, err)
		}
	}
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	h := namespacesListHandler(Deps{Engine: eng})

	one, err := h(ctx, struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("t1: %v", err)
	}
	two, err := h(ctx, struct{}{}, principalFor("t2"))
	if err != nil {
		t.Fatalf("t2: %v", err)
	}
	// Both carry the tenant root; what differs is the one real namespace.
	if !contains(one.Namespaces, "eng") || contains(one.Namespaces, "billing") {
		t.Errorf("t1 namespaces = %q, want eng and not billing", one.Namespaces)
	}
	if !contains(two.Namespaces, "billing") || contains(two.Namespaces, "eng") {
		t.Errorf("t2 namespaces = %q, want billing and not eng", two.Namespaces)
	}
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func TestABrokenTenantClaimRefusesRatherThanFallingBack(t *testing.T) {
	// The fallback hazard. A claim that is present and unusable must not
	// resolve to the configured default, because that answers a question
	// about one tenant with another tenant's data while every test written
	// against a single tenant stays green.
	eng := testEngine(t, warden.Config{})
	h := overviewStatsHandler(Deps{Engine: eng, DefaultTenantID: "t1"})

	for name, claim := range map[string]any{
		"empty string": "",
		"wrong type":   12345,
		"nil":          nil,
	} {
		t.Run(name, func(t *testing.T) {
			p := dashcontract.Principal{Claims: map[string]any{"tenant_id": claim}}
			_, err := h(context.Background(), struct{}{}, p)
			if err == nil {
				t.Fatalf("a %s tenant claim must refuse, not fall back to DefaultTenantID", name)
			}
		})
	}
}

func TestAClaimBeatsTheConfiguredDefault(t *testing.T) {
	s := memory.New()
	seedAllow(t, s) // one role in t1, none in t2
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	h := overviewStatsHandler(Deps{Engine: eng, DefaultTenantID: "t1"})

	got, err := h(context.Background(), struct{}{}, principalFor("t2"))
	if err != nil {
		t.Fatalf("t2 claim over t1 default: %v", err)
	}
	if got.Roles != 0 {
		t.Errorf("roles = %d, want 0: the claim must win over the default", got.Roles)
	}
}

func TestOverviewStatsCountsEachEntity(t *testing.T) {
	s := memory.New()
	seedAllow(t, s) // one role, one permission, one assignment
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	h := overviewStatsHandler(Deps{Engine: eng})
	got, err := h(context.Background(), struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("overview.stats: %v", err)
	}

	if got.Roles != 1 || got.Permissions != 1 || got.Assignments != 1 {
		t.Errorf("counts = %+v, want 1 role, 1 permission, 1 assignment", got)
	}
	if got.Policies != 0 || got.Relations != 0 || got.ResourceTypes != 0 {
		t.Errorf("unseeded counts = %+v, want zero", got)
	}
}

func TestNamespacesListIncludesTheTenantRoot(t *testing.T) {
	s := memory.New()
	seedAllow(t, s) // seeded at the tenant root, namespace ""
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	h := namespacesListHandler(Deps{Engine: eng})
	got, err := h(context.Background(), struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("namespaces.list: %v", err)
	}

	// The tenant root is a real namespace where things live, and the filter
	// needs it as a selectable option distinct from "all namespaces".
	var hasRoot bool
	for _, ns := range got.Namespaces {
		if ns == "" {
			hasRoot = true
		}
	}
	if !hasRoot {
		t.Errorf("namespaces = %q, want the tenant root \"\" present", got.Namespaces)
	}
}

func TestNamespacesListIsSortedAndDeduplicated(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	for _, ns := range []string{"eng/platform", "eng", "eng/platform", "billing"} {
		r := &role.Role{TenantID: "t1", NamespacePath: ns, Name: "R", Slug: "r-" + ns}
		if err := s.CreateRole(ctx, r); err != nil {
			t.Fatalf("create role in %q: %v", ns, err)
		}
	}
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	h := namespacesListHandler(Deps{Engine: eng})
	got, err := h(context.Background(), struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("namespaces.list: %v", err)
	}

	want := []string{"", "billing", "eng", "eng/platform"}
	if len(got.Namespaces) != len(want) {
		t.Fatalf("namespaces = %q, want %q", got.Namespaces, want)
	}
	for i := range want {
		if got.Namespaces[i] != want[i] {
			t.Fatalf("namespaces = %q, want %q", got.Namespaces, want)
		}
	}
}
```

Note the last test seeds four roles with distinct slugs but duplicate namespaces, because slugs are unique per `(tenant, namespace)` and a duplicate slug in the same namespace would fail the create rather than the assertion. Add `"github.com/xraph/warden/role"` to the imports.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run 'Overview|Namespaces' -v
```

Expected: compile failure, `undefined: overviewStatsHandler`.

- [ ] **Step 3: Write `handlers_overview.go`**

```go
// handlers_overview.go: the entity counters and the recent-checks list.
package contract

import (
	"context"

	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/checklog"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/policy"
	"github.com/xraph/warden/relation"
	"github.com/xraph/warden/resourcetype"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// OverviewStats is the overview.stats response: one counter per entity kind
// in a single payload, so the six stat tiles cost one request.
type OverviewStats struct {
	Roles         int64 `json:"roles"`
	Permissions   int64 `json:"permissions"`
	Assignments   int64 `json:"assignments"`
	Relations     int64 `json:"relations"`
	Policies      int64 `json:"policies"`
	ResourceTypes int64 `json:"resourceTypes"`
}

// CheckLogSummary is one row of the recent-checks list and of the check log
// page. Cached and Error are carried because they are this page's scan
// signal: allow versus deny volume depends on the deployment's posture, so
// neither can be the thing colour keys off.
type CheckLogSummary struct {
	ID            string `json:"id"`
	NamespacePath string `json:"namespacePath"`
	SubjectKind   string `json:"subjectKind"`
	SubjectID     string `json:"subjectId"`
	Action        string `json:"action"`
	ResourceType  string `json:"resourceType"`
	ResourceID    string `json:"resourceId"`
	Decision      string `json:"decision"`
	Reason        string `json:"reason,omitempty"`
	EvalTimeNs    int64  `json:"evalTimeNs"`
	Cached        bool   `json:"cached"`
	Error         string `json:"error,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

// RecentChecksInput caps the list. Zero or negative means the default of 10.
type RecentChecksInput struct {
	Limit int `json:"limit,omitempty"`
}

// RecentChecksResponse is the overview.recentChecks reply.
type RecentChecksResponse struct {
	Checks []CheckLogSummary `json:"checks"`
}

func overviewStatsHandler(deps Deps) func(context.Context, struct{}, dashcontract.Principal) (OverviewStats, error) {
	return func(ctx context.Context, _ struct{}, p dashcontract.Principal) (OverviewStats, error) {
		if err := requireEngine(deps); err != nil {
			return OverviewStats{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return OverviewStats{}, err
		}
		s := deps.Engine.Store()

		var out OverviewStats
		// Each count is a separate store call because each ListFilter is a
		// different type. A failure in any one is reported rather than
		// silently rendered as zero: a zero an operator cannot distinguish
		// from an error is worse than an error.
		if out.Roles, err = s.CountRoles(ctx, &role.ListFilter{TenantID: tenantID}); err != nil {
			return OverviewStats{}, mapWardenError(err)
		}
		if out.Permissions, err = s.CountPermissions(ctx, &permission.ListFilter{TenantID: tenantID}); err != nil {
			return OverviewStats{}, mapWardenError(err)
		}
		if out.Assignments, err = s.CountAssignments(ctx, &assignment.ListFilter{TenantID: tenantID}); err != nil {
			return OverviewStats{}, mapWardenError(err)
		}
		if out.Relations, err = s.CountRelations(ctx, &relation.ListFilter{TenantID: tenantID}); err != nil {
			return OverviewStats{}, mapWardenError(err)
		}
		if out.Policies, err = s.CountPolicies(ctx, &policy.ListFilter{TenantID: tenantID}); err != nil {
			return OverviewStats{}, mapWardenError(err)
		}
		if out.ResourceTypes, err = s.CountResourceTypes(ctx, &resourcetype.ListFilter{TenantID: tenantID}); err != nil {
			return OverviewStats{}, mapWardenError(err)
		}
		return out, nil
	}
}

func overviewRecentChecksHandler(deps Deps) func(context.Context, RecentChecksInput, dashcontract.Principal) (RecentChecksResponse, error) {
	return func(ctx context.Context, in RecentChecksInput, p dashcontract.Principal) (RecentChecksResponse, error) {
		if err := requireEngine(deps); err != nil {
			return RecentChecksResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return RecentChecksResponse{}, err
		}
		limit := in.Limit
		if limit <= 0 {
			limit = 10
		}
		entries, err := deps.Engine.Store().ListCheckLogs(ctx, &checklog.QueryFilter{
			TenantID: tenantID,
			Limit:    limit,
		})
		if err != nil {
			return RecentChecksResponse{}, mapWardenError(err)
		}
		out := RecentChecksResponse{Checks: make([]CheckLogSummary, 0, len(entries))}
		for _, e := range entries {
			out.Checks = append(out.Checks, projectCheckLog(e))
		}
		return out, nil
	}
}

// projectCheckLog is shared with the check log page in a later plan.
func projectCheckLog(e *checklog.Entry) CheckLogSummary {
	return CheckLogSummary{
		ID:            e.ID.String(),
		NamespacePath: e.NamespacePath,
		SubjectKind:   e.SubjectKind,
		SubjectID:     e.SubjectID,
		Action:        e.Action,
		ResourceType:  e.ResourceType,
		ResourceID:    e.ResourceID,
		Decision:      e.Decision,
		Reason:        e.Reason,
		EvalTimeNs:    e.EvalTimeNs,
		Cached:        e.Cached,
		Error:         e.Error,
		CreatedAt:     e.CreatedAt.UTC().Format(time.RFC3339),
	}
}
```

Add `"time"` to the imports.

- [ ] **Step 4: Write `handlers_namespaces.go`**

```go
// handlers_namespaces.go: the derived namespace list.
//
// There is no namespace entity in warden. No table, no CRUD, no create. A
// namespace exists only as a string on rows, so this scans the entity tables
// for distinct values. The tenant root ("") is always present, because it is
// a real place where things live and the filter needs it as an option
// distinct from "all namespaces".
package contract

import (
	"context"
	"sort"

	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/policy"
	"github.com/xraph/warden/relation"
	"github.com/xraph/warden/resourcetype"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// NamespacesResponse is the namespaces.list reply. Paths are sorted, with
// the tenant root first because the empty string sorts first anyway and the
// filter renders it at the top.
type NamespacesResponse struct {
	Namespaces []string `json:"namespaces"`
}

// namespaceScanLimit caps how many rows of each kind are scanned for
// distinct namespace values. A tenant with more entities than this in one
// namespace still reports that namespace; a tenant whose namespaces are all
// beyond the cap is pathological and would need a store-level DISTINCT,
// which no backend exposes today.
const namespaceScanLimit = 1000

func namespacesListHandler(deps Deps) func(context.Context, struct{}, dashcontract.Principal) (NamespacesResponse, error) {
	return func(ctx context.Context, _ struct{}, p dashcontract.Principal) (NamespacesResponse, error) {
		if err := requireEngine(deps); err != nil {
			return NamespacesResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return NamespacesResponse{}, err
		}
		s := deps.Engine.Store()
		seen := map[string]struct{}{"": {}}

		roles, err := s.ListRoles(ctx, &role.ListFilter{TenantID: tenantID, Limit: namespaceScanLimit})
		if err != nil {
			return NamespacesResponse{}, mapWardenError(err)
		}
		for _, r := range roles {
			seen[r.NamespacePath] = struct{}{}
		}

		perms, err := s.ListPermissions(ctx, &permission.ListFilter{TenantID: tenantID, Limit: namespaceScanLimit})
		if err != nil {
			return NamespacesResponse{}, mapWardenError(err)
		}
		for _, p := range perms {
			seen[p.NamespacePath] = struct{}{}
		}

		pols, err := s.ListPolicies(ctx, &policy.ListFilter{TenantID: tenantID, Limit: namespaceScanLimit})
		if err != nil {
			return NamespacesResponse{}, mapWardenError(err)
		}
		for _, p := range pols {
			seen[p.NamespacePath] = struct{}{}
		}

		rts, err := s.ListResourceTypes(ctx, &resourcetype.ListFilter{TenantID: tenantID, Limit: namespaceScanLimit})
		if err != nil {
			return NamespacesResponse{}, mapWardenError(err)
		}
		for _, rt := range rts {
			seen[rt.NamespacePath] = struct{}{}
		}

		asgs, err := s.ListAssignments(ctx, &assignment.ListFilter{TenantID: tenantID, Limit: namespaceScanLimit})
		if err != nil {
			return NamespacesResponse{}, mapWardenError(err)
		}
		for _, a := range asgs {
			seen[a.NamespacePath] = struct{}{}
		}

		tuples, err := s.ListRelations(ctx, &relation.ListFilter{TenantID: tenantID, Limit: namespaceScanLimit})
		if err != nil {
			return NamespacesResponse{}, mapWardenError(err)
		}
		for _, tp := range tuples {
			seen[tp.NamespacePath] = struct{}{}
		}

		out := make([]string, 0, len(seen))
		for ns := range seen {
			out = append(out, ns)
		}
		sort.Strings(out)
		return NamespacesResponse{Namespaces: out}, nil
	}
}
```

- [ ] **Step 5: Register the three intents**

In `contract.go`, after the `config.detail` registration:

```go
	if err := dispatcher.RegisterQuery(d, contributorName, "overview.stats", 1, overviewStatsHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register overview.stats: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, contributorName, "overview.recentChecks", 1, overviewRecentChecksHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register overview.recentChecks: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, contributorName, "namespaces.list", 1, namespacesListHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register namespaces.list: %w", err)
	}
```

And in `manifest.yaml`, under `intents`:

```yaml
  - { name: overview.stats,        kind: query, version: 1, capability: read }
  - { name: overview.recentChecks, kind: query, version: 1, capability: read }
  - { name: namespaces.list,       kind: query, version: 1, capability: read }
```

under `queries`:

```yaml
  overviewStats:
    intent: overview.stats
    cache: { staleTime: 15s }
  recentChecks:
    intent: overview.recentChecks
    cache: { staleTime: 15s }
  namespaces:
    intent: namespaces.list
    cache: { staleTime: 60s }
```

- [ ] **Step 6: Pin what an empty tenant actually does, per backend**

Every handler above refuses rather than passing an empty tenant to the store, and that refusal is load-bearing. It is load-bearing because of an assumption about what the store does with an empty `TenantID`, and an assumption nobody can point at is one that gets optimised away later.

So pin it in the shared suite rather than asserting it from memory. Create `/Users/rexraphael/Work/xraph/forgery/warden/store/contract/empty_tenant.go` beside the existing contract files, matching their shape (read `tenant_isolation.go` first for the `MakeStore` signature and the file's conventions):

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/warden/role"
)

// RunEmptyTenantContract documents what a query with an empty TenantID
// returns, on whichever backend it runs against.
//
// This is not a test of desired behaviour. It is a record of actual
// behaviour, because the contract layer's tenant resolution refuses rather
// than passing an empty tenant through, and that refusal is only obviously
// correct while somebody remembers what empty does. If empty matches every
// row, this test says so in a place that cannot be forgotten.
//
// If the four backends disagree with each other, that disagreement is the
// finding. Do not weaken the assertion until it satisfies all four.
func RunEmptyTenantContract(t *testing.T, mk MakeStore) {
	t.Run("ListRoles with an empty tenant", func(t *testing.T) {
		s := mk(t)
		ctx := context.Background()

		for _, tenant := range []string{"t1", "t2"} {
			r := &role.Role{TenantID: tenant, Name: "R", Slug: "r"}
			if err := s.CreateRole(ctx, r); err != nil {
				t.Fatalf("create role in %s: %v", tenant, err)
			}
		}

		got, err := s.ListRoles(ctx, &role.ListFilter{TenantID: ""})
		if err != nil {
			t.Fatalf("ListRoles with empty tenant: %v", err)
		}

		// The behaviour this pins: an empty TenantID is not a filter, so
		// every tenant's rows come back. Two tenants were seeded and both
		// are returned. This is exactly why the dashboard contract layer
		// refuses an unresolvable tenant instead of passing one through.
		if len(got) != 2 {
			t.Fatalf("empty tenant returned %d roles across 2 tenants; "+
				"this backend filters differently from the others, which is "+
				"the finding rather than a reason to loosen this assertion", len(got))
		}
	})
}
```

Then call it from each backend's test, matching how `RunTenantIsolationContract` is already called in each file:

- `store/memory/tenant_isolation_test.go:14` shows the memory form.
- `store/sqlite/tenant_isolation_test.go:20` uses `newSQLiteContractStore`.
- `store/postgres/tenant_isolation_integration_test.go:16` uses `newPostgresContractStore`.
- `store/mongo/tenant_isolation_integration_test.go:16` uses `newMongoContractStore`.

Add one function per file beside the existing one, for example in sqlite:

```go
func TestEmptyTenantContract(t *testing.T) {
	contract.RunEmptyTenantContract(t, newSQLiteContractStore)
}
```

- [ ] **Step 7: Run the tests, including the backends that need no harness**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... ./store/memory/... ./store/sqlite/... -v
```

Expected: all PASS. If the memory and sqlite backends disagree about what an empty tenant returns, stop and report it rather than adjusting the assertion. Postgres and mongo run under their integration harnesses; run them if those are available here, and note in the commit message if they were not.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git add extension/contract store/contract store/memory store/sqlite store/postgres store/mongo && git commit -m "feat(contract): add the overview counters, recent checks and namespace list" -- extension/contract store/contract store/memory store/sqlite store/postgres store/mongo
```

---

## Task 4: `maintenance.run` and `maintenance.cacheInvalidate`

The only two operational actions warden exposes, and the only two commands in this plan. `maintenance.run` returning zero purges is a success that changed nothing, and it must read as neither a failure nor as having purged something.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_maintenance.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_maintenance_test.go`
- Modify: `contract.go`, `manifest.yaml`

**Interfaces:**
- Consumes: `Deps`, `requireEngine`, `tenantFrom`, `mapWardenError`.
- Produces: `MaintenanceResult{AssignmentsPurged, CheckLogsPurged int64}` and `CacheInvalidateInput{SubjectKind, SubjectID string}`. Task 9's page reads both.

- [ ] **Step 1: Write the failing tests**

```go
package contract

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/warden"
	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func TestMaintenanceRunReportsZeroWhenNothingExpired(t *testing.T) {
	// A run that purged nothing succeeded. The page must be able to tell
	// that apart from a failure and from a run that removed rows, and the
	// only thing carrying that is these two counters.
	eng := testEngine(t, warden.Config{})
	h := maintenanceRunHandler(Deps{Engine: eng})

	got, err := h(context.Background(), struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("maintenance.run: %v", err)
	}
	if got.AssignmentsPurged != 0 || got.CheckLogsPurged != 0 {
		t.Errorf("result = %+v, want both zero", got)
	}
}

func TestMaintenanceRunPurgesExpiredAssignments(t *testing.T) {
	s := memory.New()
	seedAllow(t, s)
	past := time.Now().Add(-time.Hour)
	expired := &assignment.Assignment{
		TenantID:    "t1",
		SubjectKind: "user",
		SubjectID:   "bob",
		ExpiresAt:   &past,
	}
	if err := s.CreateAssignment(context.Background(), expired); err != nil {
		t.Fatalf("create expired assignment: %v", err)
	}
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	h := maintenanceRunHandler(Deps{Engine: eng})
	got, err := h(context.Background(), struct{}{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("maintenance.run: %v", err)
	}
	if got.AssignmentsPurged != 1 {
		t.Errorf("assignmentsPurged = %d, want 1", got.AssignmentsPurged)
	}
}

func TestCacheInvalidateWithoutASubjectClearsTheTenant(t *testing.T) {
	eng := testEngine(t, warden.Config{CacheTTL: time.Minute})
	h := cacheInvalidateHandler(Deps{Engine: eng})

	// Both forms must be accepted: a whole-tenant flush, and one subject.
	if _, err := h(context.Background(), CacheInvalidateInput{}, principalFor("t1")); err != nil {
		t.Fatalf("tenant invalidate: %v", err)
	}
	in := CacheInvalidateInput{SubjectKind: "user", SubjectID: "alice"}
	if _, err := h(context.Background(), in, principalFor("t1")); err != nil {
		t.Fatalf("subject invalidate: %v", err)
	}
}

func TestCacheInvalidateRejectsAHalfSpecifiedSubject(t *testing.T) {
	// A kind with no id, or an id with no kind, is a caller bug. Silently
	// flushing the whole tenant instead would be a much larger action than
	// the one that was asked for.
	eng := testEngine(t, warden.Config{CacheTTL: time.Minute})
	h := cacheInvalidateHandler(Deps{Engine: eng})

	_, err := h(context.Background(), CacheInvalidateInput{SubjectKind: "user"}, principalFor("t1"))
	if err == nil {
		t.Fatal("want an error for a subject kind with no id")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest, got %v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run Maintenance -v
```

Expected: compile failure, `undefined: maintenanceRunHandler`.

- [ ] **Step 3: Write `handlers_maintenance.go`**

```go
// handlers_maintenance.go: the two operational commands.
//
// These are the only writes warden's config surface has. RunMaintenance
// purges expired assignments and, when CheckLogRetention is set, check log
// entries past it. Cache invalidation is the manual version of what a write
// would do automatically.
package contract

import (
	"context"

	"github.com/xraph/warden"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// MaintenanceResult is the maintenance.run reply.
//
// Both counters are always present, including at zero, because zero is a
// real outcome: the run succeeded and there was nothing to purge. A page
// that could not distinguish that from a failure would have to guess.
type MaintenanceResult struct {
	AssignmentsPurged int64 `json:"assignmentsPurged"`
	CheckLogsPurged   int64 `json:"checkLogsPurged"`
}

// CacheInvalidateInput selects what to flush. Both fields empty flushes the
// whole tenant; both set flushes one subject. One without the other is an
// error rather than a silent widening to the tenant.
type CacheInvalidateInput struct {
	SubjectKind string `json:"subjectKind,omitempty"`
	SubjectID   string `json:"subjectId,omitempty"`
}

// CacheInvalidateResult reports which scope was flushed, so the page can say
// what it did rather than "done".
type CacheInvalidateResult struct {
	Scope string `json:"scope"` // "tenant" or "subject"
}

func maintenanceRunHandler(deps Deps) func(context.Context, struct{}, dashcontract.Principal) (MaintenanceResult, error) {
	return func(ctx context.Context, _ struct{}, p dashcontract.Principal) (MaintenanceResult, error) {
		if err := requireEngine(deps); err != nil {
			return MaintenanceResult{}, err
		}
		if _, err := tenantFrom(p, deps); err != nil {
			return MaintenanceResult{}, err
		}
		// RunMaintenance is engine-wide rather than per-tenant: expired
		// assignments are purged across every tenant and the check log
		// purge uses the configured retention. The tenant check above is
		// an authorization gate on who may trigger it, not a scope.
		rep, err := deps.Engine.RunMaintenance(ctx)
		if err != nil {
			return MaintenanceResult{}, mapWardenError(err)
		}
		return MaintenanceResult{
			AssignmentsPurged: rep.AssignmentsPurged,
			CheckLogsPurged:   rep.CheckLogsPurged,
		}, nil
	}
}

func cacheInvalidateHandler(deps Deps) func(context.Context, CacheInvalidateInput, dashcontract.Principal) (CacheInvalidateResult, error) {
	return func(ctx context.Context, in CacheInvalidateInput, p dashcontract.Principal) (CacheInvalidateResult, error) {
		if err := requireEngine(deps); err != nil {
			return CacheInvalidateResult{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return CacheInvalidateResult{}, err
		}

		hasKind, hasID := in.SubjectKind != "", in.SubjectID != ""
		switch {
		case hasKind != hasID:
			return CacheInvalidateResult{}, &dashcontract.Error{
				Code:    dashcontract.CodeBadRequest,
				Message: "subjectKind and subjectId must be given together, or both omitted to flush the tenant",
			}
		case hasKind:
			deps.Engine.InvalidateSubject(ctx, tenantID, warden.SubjectKind(in.SubjectKind), in.SubjectID)
			return CacheInvalidateResult{Scope: "subject"}, nil
		default:
			deps.Engine.InvalidateTenant(ctx, tenantID)
			return CacheInvalidateResult{Scope: "tenant"}, nil
		}
	}
}
```

- [ ] **Step 4: Register both commands**

In `contract.go`:

```go
	if err := dispatcher.RegisterCommand(d, contributorName, "maintenance.run", 1, maintenanceRunHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register maintenance.run: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "maintenance.cacheInvalidate", 1, cacheInvalidateHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register maintenance.cacheInvalidate: %w", err)
	}
```

In `manifest.yaml`, under `intents`. `maintenance.run` purges assignments and check logs, so it invalidates everything that counts them:

```yaml
  - { name: maintenance.run, kind: command, version: 1, capability: write,
      invalidates: [overview.stats, overview.recentChecks] }
  - { name: maintenance.cacheInvalidate, kind: command, version: 1, capability: write }
```

`maintenance.cacheInvalidate` declares no invalidates deliberately: it changes no stored row, only the engine's in-memory decision cache, so no query's answer changes.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -v
```

Expected: all PASS.

- [ ] **Step 6: Run the whole suite and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./... && git add extension/contract && git commit -m "feat(contract): add the maintenance run and cache invalidate commands" -- extension/contract
```

---

## Task 5: `packages/plugin-warden`, and the join-key test

The TypeScript spine. The single most important assertion in this plan lives here: that the plugin's `extension` field resolves against a capabilities document carrying warden's real contributor name. Get it wrong and nothing renders and nothing is logged.

**Files:**
- Create: `packages/plugin-warden/package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- Create: `packages/plugin-warden/src/index.tsx`
- Create: `packages/plugin-warden/test/harness.tsx`
- Create: `packages/plugin-warden/test/plugin.test.tsx`
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- Consumes: the contributor name `warden` from Task 2's `manifest.yaml`.
- Produces: `wardenPlugin` as both the default and a named export. Tasks 7, 8 and 9 add pages to `routes` and `nav`. `test/harness.tsx` exports `stubClient`, `failingClient`, `pendingClient`, `recordingCommandClient` and `renderPage` for every later page test.

- [ ] **Step 1: Copy the package scaffold**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
mkdir -p packages/plugin-warden/src/pages packages/plugin-warden/src/components packages/plugin-warden/test
cp packages/plugin-streaming/tsconfig.json packages/plugin-warden/tsconfig.json
cp packages/plugin-streaming/vitest.config.ts packages/plugin-warden/vitest.config.ts
cp packages/plugin-streaming/eslint.config.js packages/plugin-warden/eslint.config.js
cp packages/plugin-streaming/package.json packages/plugin-warden/package.json
cp packages/plugin-streaming/test/harness.tsx packages/plugin-warden/test/harness.tsx
```

Then edit `packages/plugin-warden/package.json` and change only the `name` field to `@forge-go/dashboard-plugin-warden`. Leave every dependency as it is.

In `packages/plugin-warden/test/harness.tsx`, replace all four occurrences of the string `"streaming-contract"` with `"warden"`, and update the doc comment on `stubClient` so its example names a warden intent (`"roles.list" against "roles"`) rather than a streaming one.

- [ ] **Step 2: Write the failing test**

Create `packages/plugin-warden/test/plugin.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import wardenPlugin, { wardenPlugin as named } from "../src/index"

function capabilities(
  ...contributors: { name: string; configured?: boolean }[]
): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
    })),
  }
}

describe("wardenPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(wardenPlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything.
   *
   * Comparing `plugin.extension` to the literal "warden" would compare the
   * source line to itself. What matters is what the host does with the name,
   * so this resolves the plugin against a capabilities response carrying the
   * contributor warden's manifest really registers
   * (`warden/extension/contract/manifest.yaml`, contributor.name).
   *
   * A wrong name here resolves to `hidden`: no routes, no nav, nothing
   * logged, because a contributor the server never mentioned is an ordinary
   * thing for a shell to meet. That silence is why this test exists.
   */
  it("resolves to ready against a host reporting warden's contributor", () => {
    expect(
      resolvePluginState(wardenPlugin, capabilities({ name: "warden" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report warden at all", () => {
    expect(
      resolvePluginState(wardenPlugin, capabilities({ name: "auth" })).kind
    ).toBe("hidden")
  })

  it("names a route for every nav entry", () => {
    // A nav link pointing at a path no route serves is a dead link that no
    // other test would catch, because nav and routes are independent lists.
    const paths = new Set(wardenPlugin.routes.map((r) => r.path))
    for (const item of wardenPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test
```

Expected: FAIL, cannot resolve `../src/index`.

- [ ] **Step 4: Write `src/index.tsx`**

Read `packages/plugin-streaming/src/index.tsx` for the `definePlugin` shape before writing. The overview and config pages arrive in Tasks 7 and 9; this version imports them and they must exist for the module to load, so create both as one-line placeholders now and fill them in their own tasks.

```tsx
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  HouseIcon,
  SettingsIcon,
} from "@forge-go/dashboard-kit/icons"
import { WardenConfigPage } from "./pages/config"
import { WardenOverviewPage } from "./pages/overview"

export type { ConfigDetail } from "./pages/config"
export type { OverviewStats, RecentChecks, CheckSummary } from "./pages/overview"
export { WardenConfigPage, WardenOverviewPage }

/**
 * The first-party UI for the `warden` extension.
 *
 * `extension` is "warden", the Go contributor name from
 * `warden/extension/contract/manifest.yaml`. It is the join key the host
 * looks up in the capabilities response, and it is checked in
 * `test/plugin.test.tsx` by resolving against a capabilities document rather
 * than by comparing the string to itself.
 *
 * No `requires` range. Warden's contributor reports no version, and
 * `resolvePluginState` skips the range check entirely for a contributor that
 * answers none, so a range would read as a guarantee and enforce nothing.
 *
 * Note that warden's roles are the same rows authsome's /roles page shows,
 * through `authsome/rbac/warden_store.go`. This page is the canonical one and
 * shows every field; authsome's is scoped to one app and drops namespace,
 * parent-slug inheritance, the system and default flags and member caps.
 */
export const wardenPlugin = definePlugin({
  extension: "warden",
  namespace: "warden",
  label: "Warden",
  nav: [
    {
      label: "Overview",
      to: "/",
      priority: 0,
      icon: <HouseIcon />,
      group: "Overview",
    },
    {
      label: "Config",
      to: "/config",
      priority: 40,
      icon: <SettingsIcon />,
      group: "Operations",
    },
  ],
  routes: [
    { path: "/", element: WardenOverviewPage },
    { path: "/config", element: WardenConfigPage },
  ],
})

export default wardenPlugin
```

- [ ] **Step 5: Create the two page placeholders**

`packages/plugin-warden/src/pages/overview.tsx`:

```tsx
export interface OverviewStats {
  roles: number
  permissions: number
  assignments: number
  relations: number
  policies: number
  resourceTypes: number
}

export interface CheckSummary {
  id: string
  namespacePath: string
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId: string
  decision: string
  reason?: string
  evalTimeNs: number
  cached: boolean
  error?: string
  createdAt: string
}

export interface RecentChecks {
  checks: CheckSummary[]
}

export function WardenOverviewPage() {
  return null
}
```

`packages/plugin-warden/src/pages/config.tsx`:

```tsx
export interface ConfigDetail {
  maxGraphDepth: number
  maxGraphVisited: number
  maxGraphFanout: number
  maxBatchChecks: number
  cacheTtlSeconds: number
  cacheMaxSize: number
  rbacEnabled: boolean
  abacEnabled: boolean
  rebacEnabled: boolean
  checkLogEnabled: boolean
  requireTenant: boolean
  evaluateAllModels: boolean
  checkLogQueueSize: number
  checkLogRetentionHours: number
  maintenanceIntervalMinutes: number
}

export function WardenConfigPage() {
  return null
}
```

These two interfaces mirror Task 2's `ConfigDetail` and Task 3's `OverviewStats`, `CheckLogSummary` and `RecentChecksResponse` field by field. Check them against those Go structs' JSON tags rather than against this plan.

- [ ] **Step 6: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test
```

Expected: all four PASS.

- [ ] **Step 7: Register the plugin in the shell**

In `apps/shell/src/App.tsx`, add the import beside the others and extend the array:

```tsx
import wardenPlugin from "@forge-go/dashboard-plugin-warden"
```

```tsx
const plugins = [corePlugin, streamingPlugin, authsomePlugin, wardenPlugin]
```

Add the workspace dependency to `apps/shell/package.json` under `dependencies`, matching how the other three are declared:

```json
    "@forge-go/dashboard-plugin-warden": "workspace:*",
```

Then install:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm install
```

- [ ] **Step 8: Typecheck, lint, and run every package's tests**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && pnpm -r test
```

Expected: all clean. `pnpm -r test` rather than the one package, because only the whole run catches a stale assertion in `apps/shell/test/app.test.tsx`, which asserts over the plugin list and will now see a fourth entry.

If `apps/shell/test/app.test.tsx` fails on a count or a list of plugin names, update that assertion. It is asserting the real registration and a fourth plugin is the change.

- [ ] **Step 9: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git add packages/plugin-warden apps/shell/src/App.tsx apps/shell/package.json pnpm-lock.yaml && git commit -m "feat(warden): add the plugin package and register it in the shell" -- packages/plugin-warden apps/shell/src/App.tsx apps/shell/package.json pnpm-lock.yaml
```

---

## Task 6: The fixture server's `warden` section

Without this, no page can be opened without a running Go server, and the playbook is blunt that every serious bug in the authsome migration was found by clicking through rather than by a test.

**Files:**
- Modify: `packages/fixture-server/server.mjs`

**Interfaces:**
- Consumes: the six intent names from Tasks 2, 3 and 4.
- Produces: a `warden` entry in `CONTRIBUTORS`, so `/capabilities` advertises it and `verify.mjs` exercises it automatically.

- [ ] **Step 1: Read how an existing contributor is built**

Read `packages/fixture-server/server.mjs` around lines 1004 to 1060 for `streamingHandlers`, and around line 2488 for `CONTRIBUTORS`. Match that shape exactly.

- [ ] **Step 2: Add the seed state**

Place this next to the other `seed*` functions. The seed has more work to do here than in most plugins: a fixture where every check returns the same answer cannot exercise the playground in a later plan, and a fixture whose namespaces are all the tenant root cannot exercise the filter.

```js
// ---------------------------------------------------------------------------
// In-memory state: warden
//
// Seeded so the interesting answers are reachable rather than so the tables
// are non-empty. Two namespaces, because one cannot exercise the namespace
// filter or the ancestor cascade. An expired assignment, so maintenance.run
// reports a non-zero purge rather than a zero that proves nothing. A cached
// check log row and an errored one, because those two are the check log's
// scan signal and a page that never sees them cannot be checked.
// ---------------------------------------------------------------------------

function seedWardenState() {
  const now = new Date().toISOString()
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  return {
    roles: [
      { id: "role_01hq", namespacePath: "", name: "Reader", slug: "reader", isSystem: false, isDefault: true, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "role_01hr", namespacePath: "eng/platform", name: "Platform admin", slug: "platform-admin", isSystem: false, isDefault: false, parentSlug: "reader", maxMembers: 5, createdAt: hourAgo, updatedAt: now },
      { id: "role_01hs", namespacePath: "", name: "System", slug: "system", isSystem: true, isDefault: false, parentSlug: "", maxMembers: 0, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    permissions: [
      { id: "perm_01a", namespacePath: "", name: "document:read", resource: "document", action: "read", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "perm_01b", namespacePath: "", name: "document:write", resource: "document", action: "write", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
      { id: "perm_01c", namespacePath: "eng/platform", name: "cluster:admin", resource: "cluster", action: "admin", isSystem: false, createdAt: hourAgo, updatedAt: hourAgo },
    ],
    assignments: [
      { id: "asgn_01a", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "alice", expiresAt: null, createdAt: hourAgo },
      // Expired on purpose: maintenance.run must be able to report a purge.
      { id: "asgn_01b", namespacePath: "", roleId: "role_01hq", subjectKind: "user", subjectId: "carol", expiresAt: hourAgo, createdAt: hourAgo },
    ],
    relations: [
      { id: "rel_01a", namespacePath: "", objectType: "document", objectId: "readme", relation: "viewer", subjectType: "user", subjectId: "bob", subjectRelation: "", createdAt: hourAgo },
      { id: "rel_01b", namespacePath: "", objectType: "folder", objectId: "root", relation: "parent", subjectType: "document", subjectId: "readme", subjectRelation: "", createdAt: hourAgo },
    ],
    policies: [
      { id: "pol_01a", namespacePath: "", name: "contractor-lockout", effect: "deny", priority: 10, isActive: true, createdAt: hourAgo, updatedAt: now },
    ],
    resourceTypes: [
      { id: "rt_01a", namespacePath: "", name: "document", description: "A document", createdAt: hourAgo, updatedAt: hourAgo },
    ],
    checkLogs: [
      { id: "chk_01a", namespacePath: "", subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "readme", decision: "allow", reason: "", evalTimeNs: 412_000, cached: false, error: "", createdAt: now },
      // Cached: the most common real answer to "why did my permission change
      // not take effect", and the page's scan signal.
      { id: "chk_01b", namespacePath: "", subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "readme", decision: "allow", reason: "", evalTimeNs: 1_800, cached: true, error: "", createdAt: now },
      { id: "chk_01c", namespacePath: "", subjectKind: "user", subjectId: "dave", action: "delete", resourceType: "document", resourceId: "readme", decision: "deny_explicit", reason: 'denied by policy "contractor-lockout"', evalTimeNs: 902_000, cached: false, error: "", createdAt: now },
      { id: "chk_01d", namespacePath: "eng/platform", subjectKind: "service", subjectId: "deployer", action: "admin", resourceType: "cluster", resourceId: "prod", decision: "error", reason: "", evalTimeNs: 0, cached: false, error: "store unavailable", createdAt: now },
    ],
    config: {
      maxGraphDepth: 10,
      maxGraphVisited: 5000,
      maxGraphFanout: 1000,
      maxBatchChecks: 100,
      cacheTtlSeconds: 60,
      cacheMaxSize: 10000,
      rbacEnabled: true,
      abacEnabled: true,
      rebacEnabled: true,
      checkLogEnabled: true,
      requireTenant: true,
      evaluateAllModels: false,
      checkLogQueueSize: 4096,
      checkLogRetentionHours: 2160,
      maintenanceIntervalMinutes: 60,
    },
  }
}

let warden = seedWardenState()
```

- [ ] **Step 3: Add the handlers**

```js
// ---------------------------------------------------------------------------
// Warden intents (four queries, two commands in this plan)
// ---------------------------------------------------------------------------

/** Every distinct namespace on any warden entity, plus the tenant root. */
function wardenNamespaces() {
  const seen = new Set([""])
  for (const group of [warden.roles, warden.permissions, warden.assignments, warden.relations, warden.policies, warden.resourceTypes]) {
    for (const row of group) seen.add(row.namespacePath)
  }
  return [...seen].sort()
}

const wardenHandlers = {
  "config.detail": {
    kind: "query",
    handler: () => warden.config,
  },
  "overview.stats": {
    kind: "query",
    handler: () => ({
      roles: warden.roles.length,
      permissions: warden.permissions.length,
      assignments: warden.assignments.length,
      relations: warden.relations.length,
      policies: warden.policies.length,
      resourceTypes: warden.resourceTypes.length,
    }),
  },
  "overview.recentChecks": {
    kind: "query",
    handler: (params) => ({
      checks: warden.checkLogs.slice(0, params?.limit > 0 ? params.limit : 10),
    }),
  },
  "namespaces.list": {
    kind: "query",
    handler: () => ({ namespaces: wardenNamespaces() }),
  },
  "maintenance.run": {
    kind: "command",
    invalidates: ["overview.stats", "overview.recentChecks"],
    handler: () => {
      // A fixture that accepts a write and changes nothing hides the bug it
      // exists to expose, so this really removes the expired rows and a
      // second run honestly reports zero.
      const nowMs = Date.now()
      const before = warden.assignments.length
      warden.assignments = warden.assignments.filter(
        (a) => !a.expiresAt || Date.parse(a.expiresAt) > nowMs
      )
      return {
        assignmentsPurged: before - warden.assignments.length,
        checkLogsPurged: 0,
      }
    },
  },
  "maintenance.cacheInvalidate": {
    kind: "command",
    handler: (payload) => {
      const hasKind = Boolean(payload?.subjectKind)
      const hasId = Boolean(payload?.subjectId)
      if (hasKind !== hasId) {
        // The fixture must not forgive a half-specified subject, or a page
        // can ship sending one field and the bug appears only in production.
        throw badRequest(
          "subjectKind and subjectId must be given together, or both omitted to flush the tenant"
        )
      }
      return { scope: hasKind ? "subject" : "tenant" }
    },
  },
}
```

`badRequest` may not exist. Check for the existing error helpers beside `notFound` near the top of the file and use whichever the file already has; if there is only `notFound`, add `badRequest` next to it in the same style.

- [ ] **Step 4: Register the contributor**

```js
  { name: "warden", envPrefix: "WARDEN", handlers: wardenHandlers },
```

Add it to `CONTRIBUTORS` after the `auth` entry.

- [ ] **Step 5: Run the server and verify**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
sleep 2 && node packages/fixture-server/verify.mjs http://localhost:8099
```

Expected: the summary line reports `warden` with six intents and zero failures. `verify.mjs` discovers contributors from `/capabilities`, so no change is needed there.

Stop the server when done:

```bash
kill %1
```

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git add packages/fixture-server/server.mjs && git commit -m "feat(fixture): seed warden and answer its first six intents" -- packages/fixture-server/server.mjs
```

---

## Task 7: The overview page

Six stat tiles and a recent-checks table. The one behaviour worth getting right is the no-tenant state, which must not look like an empty tenant.

**Files:**
- Modify: `packages/plugin-warden/src/pages/overview.tsx`
- Create: `packages/plugin-warden/test/overview.test.tsx`

**Interfaces:**
- Consumes: `OverviewStats` and `RecentChecks` from Task 5's placeholder, whose shapes mirror Task 3's Go structs. `stubClient`, `failingClient`, `renderPage` from `test/harness.tsx`.
- Produces: `WardenOverviewPage`, already wired into `routes` by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin-warden/test/overview.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenOverviewPage } from "../src/pages/overview"
import { failingClient, renderPage, stubClient } from "./harness"

const STATS = {
  roles: 3,
  permissions: 3,
  assignments: 2,
  relations: 2,
  policies: 1,
  resourceTypes: 1,
}

const CHECKS = {
  checks: [
    {
      id: "chk_01a",
      namespacePath: "",
      subjectKind: "user",
      subjectId: "alice",
      action: "read",
      resourceType: "document",
      resourceId: "readme",
      decision: "allow",
      evalTimeNs: 412_000,
      cached: false,
      createdAt: "2026-09-23T10:00:00Z",
    },
    {
      id: "chk_01b",
      namespacePath: "eng/platform",
      subjectKind: "service",
      subjectId: "deployer",
      action: "admin",
      resourceType: "cluster",
      resourceId: "prod",
      decision: "error",
      evalTimeNs: 0,
      cached: false,
      error: "store unavailable",
      createdAt: "2026-09-23T10:01:00Z",
    },
  ],
}

function client() {
  return stubClient({
    "overview.stats": STATS,
    "overview.recentChecks": CHECKS,
  })
}

describe("WardenOverviewPage", () => {
  it("shows a tile for each of the six entity counts", async () => {
    renderPage(WardenOverviewPage, client())
    for (const label of [
      "Roles",
      "Permissions",
      "Assignments",
      "Relations",
      "Policies",
      "Resource types",
    ]) {
      expect(await screen.findByText(label)).toBeTruthy()
    }
    // Not findByText("3"): roles and permissions are both 3 in this
    // fixture, and findByText throws when more than one node matches.
    expect(screen.getAllByText("3").length).toBe(2)
  })

  it("carries a live row count on the recent checks caption", async () => {
    renderPage(WardenOverviewPage, client())
    expect(await screen.findByText(/2 checks/)).toBeTruthy()
  })

  it("says which kind of empty an empty check list is", async () => {
    renderPage(
      WardenOverviewPage,
      stubClient({ "overview.stats": STATS, "overview.recentChecks": { checks: [] } })
    )
    // Zero rows still gets a count, per the table conventions.
    expect(await screen.findByText(/0 checks/)).toBeTruthy()
    expect(await screen.findByText(/No checks have been recorded/i)).toBeTruthy()
  })

  it("renders the tenant root namespace as a slash, never as the word root", async () => {
    renderPage(WardenOverviewPage, client())
    const rootCells = await screen.findAllByText("/")
    expect(rootCells.length).toBeGreaterThan(0)
    expect(screen.queryByText("root")).toBeNull()
  })

  /**
   * The no-tenant case, which the templ dashboard rendered as a dedicated
   * page. Reporting six zeroes instead would tell an operator their tenant
   * is empty when the truth is that no tenant is selected, and those call
   * for completely different actions.
   */
  it("distinguishes no tenant selected from an empty tenant", async () => {
    renderPage(
      WardenOverviewPage,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "no tenant in scope: warden cannot tell which tenant this request is for."
        )
      )
    )
    expect(await screen.findByText(/cannot tell which tenant/i)).toBeTruthy()
    expect(screen.queryByText("Roles")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test overview
```

Expected: FAIL. `WardenOverviewPage` returns null, so every query is missing.

- [ ] **Step 3: Write the page**

Read `packages/plugin-streaming/src/pages/overview.tsx` for how `StatGrid` and `QueryBoundary` are used together before writing. Keep the exported interfaces from Task 5 unchanged and add the component beneath them.

```tsx
import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"

/**
 * The tenant root is a real namespace where things live, not an absent
 * value, so it does not use NoneCell. It renders as "/" rather than the word
 * "root" because namespaceSegmentRegex permits "root" as an ordinary segment
 * name, and a namespace actually called root would then be indistinguishable
 * from the tenant root. ValidateNamespacePath forbids a leading or trailing
 * slash, so "/" is a token no real path can produce.
 */
export function NamespaceCell({ path }: { path: string }) {
  return (
    <span className="font-mono text-xs" title={path === "" ? "Tenant root" : path}>
      {path === "" ? "/" : path}
    </span>
  )
}

/**
 * The check log's scan signal is not the decision.
 *
 * Allow-versus-deny volume is a property of the deployment rather than the
 * domain: a permissive system logs mostly allows and the denials are the
 * interesting minority, a restrictive one is the reverse, and both are
 * ordinary. So the decision badge takes a stable mapping and the page
 * accepts that it is weak. Error is the one state whose meaning does not
 * vary with posture, so it is the one that interrupts.
 */
function decisionVariant(decision: string): "outline" | "secondary" | "destructive" {
  if (decision === "error") return "destructive"
  return decision === "allow" ? "outline" : "secondary"
}

export function WardenOverviewPage() {
  const stats = useQuery<OverviewStats>("overview.stats")
  const recent = useQuery<RecentChecks>("overview.recentChecks", { limit: 10 })

  const columns: Column<CheckSummary>[] = [
    {
      id: "subject",
      header: "Subject",
      cell: (c) => `${c.subjectKind}:${c.subjectId}`,
      className: "font-medium",
    },
    { id: "action", header: "Action", cell: (c) => c.action },
    {
      id: "resource",
      header: "Resource",
      cell: (c) => (
        <span className="font-mono text-xs">
          {c.resourceType}:{c.resourceId}
        </span>
      ),
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (c) => <NamespaceCell path={c.namespacePath} />,
    },
    {
      id: "decision",
      header: "Decision",
      cell: (c) => <Badge variant={decisionVariant(c.decision)}>{c.decision}</Badge>,
    },
    {
      id: "cached",
      header: "Cached",
      // A cached row is the most common real answer to "why did my
      // permission change not take effect", and nothing surfaced it before.
      cell: (c) => (c.cached ? <Badge variant="secondary">cached</Badge> : null),
    },
    {
      id: "createdAt",
      header: "When",
      cell: (c) => <Timestamp value={c.createdAt} label="checked at" />,
    },
  ]

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Warden" />

      <QueryBoundary title="Counts" query={stats} skeletonRows={1}>
        {(data) => (
          <StatGrid
            items={[
              { label: "Roles", value: data.roles },
              { label: "Permissions", value: data.permissions },
              { label: "Assignments", value: data.assignments },
              { label: "Relations", value: data.relations },
              { label: "Policies", value: data.policies },
              { label: "Resource types", value: data.resourceTypes },
            ]}
          />
        )}
      </QueryBoundary>

      <QueryBoundary title="Recent checks" query={recent} skeletonRows={5}>
        {(data) => {
          const checks = data.checks ?? []
          const caption = `${checks.length} ${checks.length === 1 ? "check" : "checks"}`
          return (
            <ResourceTable<CheckSummary>
              columns={columns}
              rows={checks}
              rowKey={(c) => c.id}
              caption={caption}
              emptyMessage="No checks have been recorded yet."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
```

The `cached` column returns `null` for the false case rather than `NoneCell`. That is deliberate and is the one place the convention does not apply: `NoneCell` means "this row has no value for this field", and every row has a cached state. An absent badge reads as "not cached", which is what it is.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test overview
```

Expected: all five PASS. If `QueryBoundary` does not surface the error message text the no-tenant test looks for, read its source at `packages/kit/src/components/query-boundary.tsx` and assert on what it actually renders. Do not weaken the assertion to `queryByText` returning anything.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git add packages/plugin-warden && git commit -m "feat(warden): add the overview page" -- packages/plugin-warden
```

---

## Task 8: The namespace filter

Small, and it comes before the list pages because every list from the next plan onward carries it. Retrofitting it into nine finished pages costs more than building it once.

**Files:**
- Create: `packages/plugin-warden/src/components/namespace-filter.tsx`
- Create: `packages/plugin-warden/test/namespace-filter.test.tsx`
- Modify: `packages/plugin-warden/src/pages/overview.tsx` (move `NamespaceCell` here)

**Interfaces:**
- Consumes: `namespaces.list` from Task 3.
- Produces: `NamespaceCell({path})`, `useNamespaceFilter()` returning `{value, setValue, filterConfig, param}`, and the type `NamespaceValue = "all" | string`. Every list page in the next plan uses `filterConfig` in its `FilterBar` and `param` in its query.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import {
  NamespaceCell,
  namespaceParam,
  namespaceOptions,
  useNamespaceFilter,
} from "../src/components/namespace-filter"
import { failingClient, stubClient } from "./harness"
import { ContractError } from "@forge-go/dashboard-plugin"

describe("NamespaceCell", () => {
  it("renders the tenant root as a slash", () => {
    render(<NamespaceCell path="" />)
    expect(screen.getByText("/")).toBeTruthy()
  })

  /**
   * namespaceSegmentRegex permits "root" as an ordinary segment name, so a
   * namespace literally called root must stay distinguishable from the
   * tenant root. Rendering the tenant root as the word "root" would collapse
   * the two into one label.
   */
  it("keeps a namespace named root distinct from the tenant root", () => {
    const { rerender } = render(<NamespaceCell path="root" />)
    expect(screen.getByText("root")).toBeTruthy()
    rerender(<NamespaceCell path="" />)
    expect(screen.getByText("/")).toBeTruthy()
    expect(screen.queryByText("root")).toBeNull()
  })
})

describe("namespaceParam", () => {
  /**
   * The three states are not two. "All namespaces" and "the tenant root" are
   * different queries, and the contract distinguishes them by nil versus the
   * empty string, so the param builder must too. A builder that sent "" for
   * "all" would silently scope every list to the root.
   */
  it("sends undefined for all namespaces and an empty string for the root", () => {
    expect(namespaceParam("all")).toEqual({})
    expect(namespaceParam("")).toEqual({ namespacePath: "" })
    expect(namespaceParam("eng/platform")).toEqual({ namespacePath: "eng/platform" })
  })
})

describe("namespaceOptions", () => {
  it("offers all and the tenant root even when only the root exists", () => {
    // Both must appear even though they return the same rows here, because
    // they are different queries and the next namespace someone creates
    // makes them differ.
    const opts = namespaceOptions([""])
    expect(opts.map((o) => o.value)).toEqual(["all", ""])
    expect(opts[0].label).toBe("All namespaces")
    expect(opts[1].label).toBe("Tenant root")
  })

  it("lists discovered namespaces after the root, in order", () => {
    const opts = namespaceOptions(["", "billing", "eng", "eng/platform"])
    expect(opts.map((o) => o.value)).toEqual([
      "all",
      "",
      "billing",
      "eng",
      "eng/platform",
    ])
  })

  it("never renders a blank option label", () => {
    // A select whose empty option means "all" cannot also express "root".
    // Every option carries a real label so neither can be mistaken for the
    // other or for a placeholder.
    for (const opt of namespaceOptions(["", "eng"])) {
      expect(opt.label.trim()).not.toBe("")
    }
  })
})

/** Renders the hook's output so it can be asserted on. */
function Probe() {
  const { value, filterConfig, param } = useNamespaceFilter()
  return (
    <div>
      <span data-testid="value">{value}</span>
      <span data-testid="param">{JSON.stringify(param)}</span>
      <span data-testid="options">
        {filterConfig.options.map((o) => o.label).join("|")}
      </span>
    </div>
  )
}

describe("useNamespaceFilter", () => {
  it("starts on all namespaces and sends no namespace param", async () => {
    render(
      <PluginProvider client={stubClient({ "namespaces.list": { namespaces: ["", "eng"] } })}>
        <Probe />
      </PluginProvider>
    )
    expect((await screen.findByTestId("value")).textContent).toBe("all")
    expect(screen.getByTestId("param").textContent).toBe("{}")
  })

  it("offers every namespace the query returned", async () => {
    render(
      <PluginProvider client={stubClient({ "namespaces.list": { namespaces: ["", "eng"] } })}>
        <Probe />
      </PluginProvider>
    )
    expect((await screen.findByTestId("options")).textContent).toBe(
      "All namespaces|Tenant root|eng"
    )
  })

  it("still filters when the namespace list cannot be read", async () => {
    // A page whose namespace list is unavailable must still render its
    // rows. Falling back to the two options that always exist keeps the
    // filter usable instead of blanking the control or the page.
    render(
      <PluginProvider client={failingClient(new ContractError("INTERNAL", "boom"))}>
        <Probe />
      </PluginProvider>
    )
    expect((await screen.findByTestId("options")).textContent).toBe(
      "All namespaces|Tenant root"
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test namespace
```

Expected: FAIL, cannot resolve `../src/components/namespace-filter`.

- [ ] **Step 3: Write the component**

```tsx
import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { FilterConfig, FilterOption } from "@forge-go/dashboard-kit/components/filter-bar"

/**
 * Namespace has three states, not two.
 *
 * The contract's namespace field is a `*string`: nil means every namespace,
 * the empty string means the tenant root, and a path means that one. Those
 * are genuinely different queries, and the store treats them differently, so
 * the UI cannot collapse "all" and "root" into one blank option.
 *
 * "all" is a sentinel here rather than a real namespace path, chosen because
 * namespaceSegmentRegex requires a segment to start with a letter and the
 * sentinel never reaches the wire: namespaceParam turns it into an absent
 * field.
 */
export type NamespaceValue = "all" | string

export interface NamespacesResponse {
  namespaces: string[]
}

/**
 * The tenant root renders as "/" rather than the word "root", because
 * namespaceSegmentRegex permits "root" as an ordinary segment name and a
 * namespace actually called root would otherwise be indistinguishable from
 * it. ValidateNamespacePath forbids a leading or trailing slash, so "/" is a
 * token no real path can produce.
 *
 * The root is not an absent value and does not use NoneCell. It is a real
 * place where things live.
 */
export function NamespaceCell({ path }: { path: string }) {
  return (
    <span className="font-mono text-xs" title={path === "" ? "Tenant root" : path}>
      {path === "" ? "/" : path}
    </span>
  )
}

/** Turns the selected value into the query params the contract expects. */
export function namespaceParam(value: NamespaceValue): { namespacePath?: string } {
  return value === "all" ? {} : { namespacePath: value }
}

/** Builds the select's options. Every option carries a real label. */
export function namespaceOptions(namespaces: string[]): FilterOption[] {
  const opts: FilterOption[] = [{ label: "All namespaces", value: "all" }]
  for (const ns of namespaces) {
    opts.push(ns === "" ? { label: "Tenant root", value: "" } : { label: ns, value: ns })
  }
  return opts
}

/**
 * The hook every list page uses. It holds the selection, fetches the
 * namespace list once, and hands back both the FilterBar config and the
 * query params.
 *
 * The list query failing is not fatal: the filter falls back to offering
 * "All namespaces" and "Tenant root", which are the two that always exist,
 * so a page whose namespace list is unavailable still renders its rows.
 */
export function useNamespaceFilter() {
  const [value, setValue] = useState<NamespaceValue>("all")
  const list = useQuery<NamespacesResponse>("namespaces.list")

  const namespaces = list.data?.namespaces ?? [""]
  const filterConfig: FilterConfig = {
    id: "namespace",
    label: "Namespace",
    value,
    options: namespaceOptions(namespaces),
    onChange: (next) => setValue(next as NamespaceValue),
  }

  return { value, setValue, filterConfig, param: namespaceParam(value) }
}
```

- [ ] **Step 4: Move `NamespaceCell` out of the overview page**

Delete the `NamespaceCell` definition from `src/pages/overview.tsx` and import it instead:

```tsx
import { NamespaceCell } from "../components/namespace-filter"
```

Remove it from the overview page's exports if Task 7 exported it. Task 5's barrel does not export it; add it there so later plans can reach it:

```tsx
export { NamespaceCell, useNamespaceFilter, namespaceParam } from "./components/namespace-filter"
export type { NamespaceValue } from "./components/namespace-filter"
```

- [ ] **Step 5: Run every test in the package**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test
```

Expected: all PASS. The overview tests must still pass after the move; if they fail on an import, the barrel export is wrong.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git add packages/plugin-warden && git commit -m "feat(warden): add the three-state namespace filter every list will reuse" -- packages/plugin-warden
```

---

## Task 9: The config page

Read-only, plus the two maintenance controls, plus the banner that stops an empty check log from lying.

**Files:**
- Modify: `packages/plugin-warden/src/pages/config.tsx`
- Create: `packages/plugin-warden/test/config.test.tsx`

**Interfaces:**
- Consumes: `ConfigDetail` from Task 5, `config.detail` from Task 2, `maintenance.run` and `maintenance.cacheInvalidate` from Task 4, and `recordingCommandClient` and `stubClient` from the harness.
- Produces: `WardenConfigPage`, already wired into `routes`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { WardenConfigPage } from "../src/pages/config"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

const CONFIG = {
  maxGraphDepth: 10,
  maxGraphVisited: 5000,
  maxGraphFanout: 1000,
  maxBatchChecks: 100,
  cacheTtlSeconds: 60,
  cacheMaxSize: 10000,
  rbacEnabled: true,
  abacEnabled: true,
  rebacEnabled: true,
  checkLogEnabled: true,
  requireTenant: true,
  evaluateAllModels: false,
  checkLogQueueSize: 4096,
  checkLogRetentionHours: 2160,
  maintenanceIntervalMinutes: 60,
}

describe("WardenConfigPage", () => {
  it("shows which authorization models are enabled", async () => {
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    expect(await screen.findByText("RBAC")).toBeTruthy()
    expect(await screen.findByText("ABAC")).toBeTruthy()
    expect(await screen.findByText("ReBAC")).toBeTruthy()
  })

  it("says the configuration is read-only and where it comes from", async () => {
    // Warden's Config comes from Forge config, not a store. A page with no
    // save button and no explanation looks broken rather than read-only.
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    expect(await screen.findByText(/read-only/i)).toBeTruthy()
  })

  /**
   * The banner that stops an empty check log from lying.
   *
   * With check logging off, no writer is constructed at all and the check
   * log table is empty. That is indistinguishable from a system where
   * nothing has been checked, and the difference is "you have no audit
   * trail" versus "you are idle".
   */
  it("warns when check logging is disabled", async () => {
    renderPage(
      WardenConfigPage,
      stubClient({ "config.detail": { ...CONFIG, checkLogEnabled: false } })
    )
    expect(await screen.findByText(/check logging is disabled/i)).toBeTruthy()
    expect(await screen.findByText(/nothing is being recorded/i)).toBeTruthy()
  })

  it("does not warn when check logging is on", async () => {
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByText("RBAC")
    expect(screen.queryByText(/check logging is disabled/i)).toBeNull()
  })

  /**
   * A run that purged nothing succeeded. It must not read as a failure and
   * must not read as having removed something.
   */
  it("reports a maintenance run that purged nothing as a success", async () => {
    const { client } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.run": { assignmentsPurged: 0, checkLogsPurged: 0 } }
    )
    renderPage(WardenConfigPage, client)

    await userEvent.click(await screen.findByRole("button", { name: /run maintenance/i }))
    await userEvent.click(await screen.findByRole("button", { name: /^run$/i }))

    expect(await screen.findByText(/nothing needed purging/i)).toBeTruthy()
  })

  it("reports what a maintenance run actually purged", async () => {
    const { client } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.run": { assignmentsPurged: 3, checkLogsPurged: 120 } }
    )
    renderPage(WardenConfigPage, client)

    await userEvent.click(await screen.findByRole("button", { name: /run maintenance/i }))
    await userEvent.click(await screen.findByRole("button", { name: /^run$/i }))

    expect(await screen.findByText(/3 expired assignments/i)).toBeTruthy()
    expect(await screen.findByText(/120 check log entries/i)).toBeTruthy()
  })

  it("sends no subject fields when flushing the whole tenant", async () => {
    const { client, sent } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.cacheInvalidate": { scope: "tenant" } }
    )
    renderPage(WardenConfigPage, client)

    await userEvent.click(await screen.findByRole("button", { name: /clear cache/i }))
    await userEvent.click(await screen.findByRole("button", { name: /^clear$/i }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("maintenance.cacheInvalidate")
    // The contract rejects a half-specified subject, so an empty string in
    // either field would be a BAD_REQUEST rather than a tenant flush.
    expect(sent[0].payload).toEqual({})
  })
})
```

`@testing-library/user-event` may not be a dependency of this package. Check `packages/plugin-authsome/package.json`; if it is there, add the same version to `packages/plugin-warden/package.json` and run `pnpm install`. If the other packages drive clicks through `fireEvent` instead, use that and keep the assertions unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test config
```

Expected: FAIL. `WardenConfigPage` returns null.

- [ ] **Step 3: Write the page**

Keep the `ConfigDetail` interface from Task 5 and add below it:

```tsx
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Alert } from "@forge-go/dashboard-kit/components/alert"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"

interface MaintenanceResult {
  assignmentsPurged: number
  checkLogsPurged: number
}

/**
 * A run that purged nothing succeeded and changed nothing. Saying "done"
 * would be ambiguous between that and a run that removed rows, and both are
 * things an operator acts on differently.
 */
function purgeSummary(r: MaintenanceResult): string {
  if (r.assignmentsPurged === 0 && r.checkLogsPurged === 0) {
    return "Maintenance ran. Nothing needed purging."
  }
  const parts: string[] = []
  if (r.assignmentsPurged > 0) {
    parts.push(`${r.assignmentsPurged} expired assignments`)
  }
  if (r.checkLogsPurged > 0) {
    parts.push(`${r.checkLogsPurged} check log entries`)
  }
  return `Maintenance ran. Purged ${parts.join(" and ")}.`
}

function ModelBadge({ label, on }: { label: string; on: boolean }) {
  // Most engines run with all three models on, so enabled is the majority
  // state and takes outline. A disabled model is the thing somebody scanning
  // this page is looking for.
  return (
    <Badge variant={on ? "outline" : "destructive"}>
      {label}
      {on ? "" : " off"}
    </Badge>
  )
}

export function WardenConfigPage() {
  const config = useQuery<ConfigDetail>("config.detail")
  const runMaintenance = useCommand<MaintenanceResult>("maintenance.run")
  const clearCache = useCommand<{ scope: string }>("maintenance.cacheInvalidate")

  const [confirmingRun, setConfirmingRun] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [runResult, setRunResult] = useState<MaintenanceResult | null>(null)

  async function doRun() {
    const result = await runMaintenance.execute({})
    // execute resolves undefined only when the client throws, so this is the
    // success check. A failure must leave the dialog open with its error.
    if (result === undefined) return
    setRunResult(result)
    setConfirmingRun(false)
  }

  async function doClear() {
    // No subject fields at all. The contract rejects a half-specified
    // subject, so an empty string in either would be a BAD_REQUEST rather
    // than the tenant-wide flush this button means.
    const result = await clearCache.execute({})
    if (result === undefined) return
    setConfirmingClear(false)
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Config"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                // Reset at open, not at close: the operator is about to read
                // whatever this dialog shows, and a failure left over from a
                // previous attempt must not be attributed to this one.
                runMaintenance.reset()
                setRunResult(null)
                setConfirmingRun(true)
              }}
            >
              Run maintenance
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                clearCache.reset()
                setConfirmingClear(true)
              }}
            >
              Clear cache
            </Button>
          </div>
        }
      />

      {runResult && <Alert>{purgeSummary(runResult)}</Alert>}

      <QueryBoundary title="Config" query={config} skeletonRows={4}>
        {(c) => (
          <div className="flex flex-col gap-6">
            {!c.checkLogEnabled && (
              <Alert variant="destructive">
                Check logging is disabled, so nothing is being recorded. The check
                log will stay empty whatever traffic this engine serves.
              </Alert>
            )}

            <p className="text-sm text-muted-foreground">
              Warden reads its configuration from Forge config, so this page is
              read-only. Change these values where the engine is configured and
              restart it.
            </p>

            <div className="flex gap-2">
              <ModelBadge label="RBAC" on={c.rbacEnabled} />
              <ModelBadge label="ABAC" on={c.abacEnabled} />
              <ModelBadge label="ReBAC" on={c.rebacEnabled} />
            </div>

            <DescriptionList
              items={[
                { term: "Graph depth limit", value: String(c.maxGraphDepth) },
                { term: "Graph visit budget", value: String(c.maxGraphVisited) },
                { term: "Graph fanout limit", value: String(c.maxGraphFanout) },
                { term: "Batch check limit", value: String(c.maxBatchChecks) },
                {
                  term: "Decision cache",
                  value:
                    c.cacheTtlSeconds > 0
                      ? `${c.cacheTtlSeconds}s, up to ${c.cacheMaxSize} entries`
                      : "Off",
                },
                { term: "Tenant required", value: c.requireTenant ? "Yes" : "No" },
                {
                  term: "Evaluate all models",
                  value: c.evaluateAllModels ? "Yes" : "No",
                },
                {
                  term: "Check log queue",
                  value: `${c.checkLogQueueSize} entries`,
                },
                {
                  term: "Check log retention",
                  value:
                    c.checkLogRetentionHours > 0
                      ? `${c.checkLogRetentionHours} hours`
                      : "Kept forever",
                },
                {
                  term: "Maintenance interval",
                  value:
                    c.maintenanceIntervalMinutes > 0
                      ? `${c.maintenanceIntervalMinutes} minutes`
                      : "Off",
                },
              ]}
            />
          </div>
        )}
      </QueryBoundary>

      {/*
        The errors live inside their dialogs. Base UI marks everything outside
        an open dialog inert and aria-hidden, so an alert on the page body is
        unreachable for as long as the dialog that can fail is open.
      */}
      <ConfirmDialog
        open={confirmingRun}
        onOpenChange={(open) => !open && setConfirmingRun(false)}
        title="Run maintenance now?"
        description={
          <span className="flex flex-col gap-2">
            <span>
              Purges assignments that have already expired, and check log entries
              older than the retention window. This runs across every tenant.
            </span>
            <CommandAlert
              error={runMaintenance.error}
              title="Could not run maintenance"
            />
          </span>
        }
        confirmLabel="Run"
        pending={runMaintenance.loading}
        onConfirm={() => void doRun()}
      />

      <ConfirmDialog
        open={confirmingClear}
        onOpenChange={(open) => !open && setConfirmingClear(false)}
        title="Clear this tenant's decision cache?"
        description={
          <span className="flex flex-col gap-2">
            <span>
              The next check for every subject in this tenant is evaluated from
              the store rather than served from cache. Nothing stored changes.
            </span>
            <CommandAlert error={clearCache.error} title="Could not clear the cache" />
          </span>
        }
        confirmLabel="Clear"
        pending={clearCache.loading}
        onConfirm={() => void doClear()}
      />
    </section>
  )
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test config
```

Expected: all seven PASS. If `Alert` does not accept a `variant` prop, read `packages/kit/src/components/alert.tsx` and use what it does accept.

- [ ] **Step 5: Run everything, in both repositories**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./...
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && pnpm -r test
```

Expected: everything clean. `pnpm -r test` rather than one package, because only `tsc` sees the barrel and a renamed export breaks the build while every test stays green.

- [ ] **Step 6: Run it and click through**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
sleep 2 && pnpm --filter @forge-go/dashboard-shell dev
```

Open the shell, find Warden in the nav, and check by hand:

- The overview shows six tiles with the seeded counts, and the recent-checks table shows four rows.
- The tenant root namespace shows as `/` and the `eng/platform` row shows its path.
- The errored check row is the one that stands out; the two allows do not.
- The cached row is marked.
- Config lists every value and says it is read-only.
- Run maintenance once: it reports purging one expired assignment. Run it again: it reports that nothing needed purging. Two different messages, both plainly successful.
- Clear cache reports the tenant scope.

Stop both when done.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git add packages/plugin-warden && git commit -m "feat(warden): add the config page with maintenance controls" -- packages/plugin-warden
```

---

## Done when

- `warden` appears in the fixture server's capabilities response and `verify.mjs` exercises all six intents with zero failures.
- `go build ./... && go test ./...` is clean in warden.
- `pnpm -r test`, and `typecheck` and `lint` for `plugin-warden`, are clean here.
- The overview and config pages render against the fixture server and the manual checks in Task 9 Step 6 all pass.
- `WithCallDryRun` exists and is proven to skip the cache, the check log and the hooks.

The next plan adds the CRUD surfaces: roles, permissions, assignments, relations and resource types, all using the namespace filter Task 8 built.
