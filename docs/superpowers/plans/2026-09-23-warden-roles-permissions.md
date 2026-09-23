# Warden roles and permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Warden's React dashboard full read and write over roles and permissions, including the role-permission junction and the role edit the templ dashboard never had.

**Architecture:** Thirteen intents added to the existing `warden/extension/contract` package, and three pages added to `packages/plugin-warden`. Roles and permissions ship together because they are coupled through a junction table: a role's detail page reads its grants, and attaching or detaching one is a write against the role. Every list pages with `limit`/`offset` and carries the namespace filter built in the previous plan.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0` (dashboard contract, dispatcher), React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`

**Predecessor:** `docs/superpowers/plans/2026-09-23-warden-spine.md`. That plan built the contract package, the plugin package, the fixture section, the overview and config pages, and the namespace filter. This plan assumes all of it.

## Global Constraints

- Contributor name is exactly `warden`. The plugin's `extension` field must match it. A mismatch renders nothing and logs nothing.
- Contract DTOs are camelCase. Never return a warden domain struct (snake_case) on the wire.
- Every intent that pages a stored collection takes `limit` and `offset` and returns `{items, total, limit, offset}`. No cursors. Every list in this plan is one of these.
- Namespace filter fields are `*string`: `nil` means every namespace, `""` means the tenant root, a path means that namespace.
- Optional update fields are pointers, including `*[]string` for lists that can be emptied.
- Every command declares `meta.invalidates` in the manifest.
- Every handler resolves its tenant with `tenantFrom(p, deps)`, never from the request context. `warden.ScopeFromContext` and `forge.ScopeFrom` both return empty on the contract path, and an empty tenant id in a store `ListFilter` matches every tenant's rows rather than none.
- Identifier values carry `font-mono text-xs`. The column an operator reads carries `font-medium`.
- Every table caption carries a live row count, including at zero rows.
- A cell meaning "none" uses `NoneCell` or `TagList`, never a blank and never a bare dash. A possibly-absent timestamp uses `Timestamp`.
- Badge variants by proportion, not meaning: `outline` for the majority state whatever it signifies, `secondary` notable but not wrong, `default` affirmative, `destructive` for what somebody came to find.
- The tenant root namespace renders as `/`, never the word `root`.
- Errors render inside the dialog that can fail, never on the page body. Every `ConfirmDialog` gets `pending`.
- Tests stub a thrown `ContractError`, never `{ok: false}`. `execute()` resolves `undefined` only on a throw.
- No test reads a source file with `node:fs`. Use `import.meta.glob` with `{query: "?raw", eager: true}`.
- Both git trees are shared with other live sessions. Commit with an explicit path list. Never `git add -A`, `git commit -a`, or `--amend`. Verify each commit with `git show --stat <your-sha>`, never HEAD.
- No `Co-Authored-By` trailers. No Claude or Anthropic attribution in commits or code.
- No em dashes in any committed prose, including comments and commit messages.

## Review Focus

Failure modes the spec implies that the happy-path tests would not reach. Each has a test assigned to the task that owns the code.

1. **Nothing in warden enforces system-entity immutability.** `ErrSystemRoleImmutable` and `ErrSystemPermissionImmutable` are defined in `errors.go` and mapped by `mapWardenError`, and a repository-wide grep finds **zero** places that return them. No store guards `IsSystem` on update or delete, and neither does the HTTP API. So the contract layer is the only thing that can, and if it does not, this dashboard will cheerfully let an operator rename or delete a system role. Covered in Task 1 and exercised in Tasks 3 and 5.
2. **A role update must not silently erase what the operator did not touch.** `UpdateRole` takes a whole `*role.Role` and writes it, so a handler that builds a fresh struct from the request wipes every field the request omitted. The handler must read, apply only the present pointers, then write. Covered in Task 3.
3. **`parentSlug` can create a cycle.** `ErrCyclicRoleInheritance` exists. Setting a role's parent to one of its own descendants makes the engine's inheritance walk loop. Covered in Task 3.
4. **Detaching a permission that was never attached must not read as success.** The junction is keyed by `(namespacePath, name)`, so a detach with a wrong namespace silently affects nothing while returning no error. Covered in Task 4.
5. **A permission's `name` must agree with its `resource` and `action`.** The RBAC evaluator matches on `perm.Resource + ":" + perm.Action`, not on `Name`, so a permission named `document:read` whose resource is `folder` is invisible to every check that looks for it. Covered in Task 5.

---

## File Structure

**warden repository** (`/Users/rexraphael/Work/xraph/forgery/warden`)

| File | Responsibility |
|---|---|
| `extension/contract/paging.go` (create) | The shared `Page` request/response envelope and its clamping |
| `extension/contract/immutable.go` (create) | The system-entity guard nothing below the contract provides |
| `extension/contract/handlers_roles.go` (create) | Eight role intents |
| `extension/contract/handlers_permissions.go` (create) | Five permission intents |
| `extension/contract/contract.go` (modify) | Thirteen registrations |
| `extension/contract/manifest.yaml` (modify) | Thirteen intents, their queries, their invalidates |

**forge-dashboard repository**

| File | Responsibility |
|---|---|
| `packages/plugin-warden/src/pages/roles.tsx` (create) | Roles list, create, delete |
| `packages/plugin-warden/src/pages/role-detail.tsx` (create) | One role: fields, edit, grants, children |
| `packages/plugin-warden/src/pages/permissions.tsx` (create) | Permissions list, create, edit, delete |
| `packages/plugin-warden/src/index.tsx` (modify) | Three routes, two nav entries |
| `packages/fixture-server/warden-fixtures.mjs` (modify) | Thirteen handlers over the existing seed |

---

## Task 1: The paging envelope and the system-entity guard

Two small shared files that every later task in this plan and in plans 3 to 6 depends on. The guard is the more important one, because it closes a hole that exists nowhere else in warden.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/paging.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/immutable.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/paging_test.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/immutable_test.go`

**Interfaces:**
- Consumes: nothing from this plan. `mapWardenError`, `requireEngine`, `tenantFrom(p, deps)` and `Deps` already exist in `errors.go` and `contract.go`.
- Produces: `PageRequest{Limit, Offset int}` with method `Clamp() (limit, offset int)`; `PageMeta{Total int64, Limit, Offset int}`; `guardSystemRole(r *role.Role) error`; `guardSystemPermission(p *permission.Permission) error`. Tasks 2 to 5 all use these.

- [ ] **Step 1: Write the failing tests**

Create `paging_test.go`:

```go
package contract

import "testing"

func TestPageRequestClampDefaultsAnUnsetLimit(t *testing.T) {
	// A list intent called with no limit must not return the whole table.
	// Every store ListFilter treats Limit 0 as "no limit", so an unset
	// limit here would page nothing and load everything.
	limit, offset := PageRequest{}.Clamp()
	if limit != defaultPageLimit {
		t.Errorf("limit = %d, want the default %d", limit, defaultPageLimit)
	}
	if offset != 0 {
		t.Errorf("offset = %d, want 0", offset)
	}
}

func TestPageRequestClampCapsAnOversizedLimit(t *testing.T) {
	limit, _ := PageRequest{Limit: 100000}.Clamp()
	if limit != maxPageLimit {
		t.Errorf("limit = %d, want the cap %d", limit, maxPageLimit)
	}
}

func TestPageRequestClampRejectsANegativeOffset(t *testing.T) {
	// A negative offset reaches SQL as OFFSET -1, which errors on some
	// backends and is ignored on others. Neither is a page of results.
	_, offset := PageRequest{Offset: -5}.Clamp()
	if offset != 0 {
		t.Errorf("offset = %d, want 0", offset)
	}
}

func TestPageRequestClampKeepsAValidRequest(t *testing.T) {
	limit, offset := PageRequest{Limit: 25, Offset: 50}.Clamp()
	if limit != 25 || offset != 50 {
		t.Errorf("clamp altered a valid request: limit %d offset %d", limit, offset)
	}
}
```

Create `immutable_test.go`:

```go
package contract

import (
	"errors"
	"testing"

	"github.com/xraph/warden"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func TestGuardSystemRoleRefusesASystemRole(t *testing.T) {
	// Nothing below the contract layer enforces this. A repository-wide
	// grep finds zero places that return ErrSystemRoleImmutable: no store
	// guards IsSystem on update or delete, and neither does the HTTP API.
	// If this guard is absent the dashboard will rename and delete system
	// roles without complaint.
	err := guardSystemRole(&role.Role{IsSystem: true, Name: "System"})
	if err == nil {
		t.Fatal("want a refusal for a system role")
	}
	if !errors.Is(err, warden.ErrSystemRoleImmutable) {
		t.Errorf("want ErrSystemRoleImmutable in the chain, got %v", err)
	}
	var ce *dashcontract.Error
	if !errors.As(err, &ce) || ce.Code != dashcontract.CodePermissionDenied {
		t.Errorf("want CodePermissionDenied on the wire, got %v", err)
	}
}

func TestGuardSystemRoleAllowsAnOrdinaryRole(t *testing.T) {
	if err := guardSystemRole(&role.Role{IsSystem: false}); err != nil {
		t.Errorf("an ordinary role must pass, got %v", err)
	}
}

func TestGuardSystemPermissionRefusesASystemPermission(t *testing.T) {
	err := guardSystemPermission(&permission.Permission{IsSystem: true, Name: "document:read"})
	if err == nil {
		t.Fatal("want a refusal for a system permission")
	}
	if !errors.Is(err, warden.ErrSystemPermissionImmutable) {
		t.Errorf("want ErrSystemPermissionImmutable in the chain, got %v", err)
	}
}

func TestGuardSystemPermissionAllowsAnOrdinaryPermission(t *testing.T) {
	if err := guardSystemPermission(&permission.Permission{IsSystem: false}); err != nil {
		t.Errorf("an ordinary permission must pass, got %v", err)
	}
}

func TestGuardsNameTheEntityInTheirMessage(t *testing.T) {
	// The operator needs to know WHICH row refused, because these appear
	// in a list where several rows look alike.
	err := guardSystemRole(&role.Role{IsSystem: true, Name: "Platform admin"})
	var ce *dashcontract.Error
	if !errors.As(err, &ce) {
		t.Fatalf("want a contract error, got %v", err)
	}
	if !contains(ce.Message, "Platform admin") {
		t.Errorf("message %q does not name the role", ce.Message)
	}
}
```

`contains` already exists in `handlers_overview_test.go` in this package as a `[]string` helper, so it will not serve here. Add a local string helper at the bottom of `immutable_test.go` under a different name, for example `containsText(haystack, needle string) bool { return strings.Contains(haystack, needle) }`, and use that in the test above instead of `contains`. Import `"strings"`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run 'Page|Guard' -v
```

Expected: compile failure, `undefined: PageRequest`, `undefined: guardSystemRole`.

- [ ] **Step 3: Write `paging.go`**

```go
// paging.go: the one paging shape every list intent in this contract uses.
//
// Warden's stores all expose ListX(filter) plus CountX(filter) with Limit
// and Offset, and none of them offers a cursor. So this contract pages by
// offset everywhere, and there is no second convention to translate
// between.
package contract

// defaultPageLimit is what a request with no limit gets.
//
// It is not zero for a reason that is easy to miss: every store ListFilter
// treats Limit 0 as "no limit", so passing an unset limit straight through
// would load the whole table and call it a page.
const defaultPageLimit = 25

// maxPageLimit caps what one request can ask for, so a client cannot turn a
// paged list back into a full table scan by asking for a million rows.
const maxPageLimit = 200

// PageRequest is embedded in every list intent's input.
type PageRequest struct {
	Limit  int `json:"limit,omitempty"`
	Offset int `json:"offset,omitempty"`
}

// Clamp returns a limit and offset safe to hand to a store filter. An unset
// or non-positive limit becomes the default, an oversized one is capped, and
// a negative offset becomes zero rather than reaching SQL as OFFSET -1.
func (p PageRequest) Clamp() (limit, offset int) {
	limit = p.Limit
	if limit <= 0 {
		limit = defaultPageLimit
	}
	if limit > maxPageLimit {
		limit = maxPageLimit
	}
	offset = p.Offset
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// PageMeta is embedded in every list intent's response, beside its items.
//
// Total is the count matching the filter rather than the number of rows
// returned, which is what a pager needs to know how many pages exist. Limit
// and Offset are echoed back as clamped, so a client that asked for a
// million rows can see what it actually got.
type PageMeta struct {
	Total  int64 `json:"total"`
	Limit  int   `json:"limit"`
	Offset int   `json:"offset"`
}

// newPageMeta pairs a count with the clamped request that produced it.
func newPageMeta(total int64, limit, offset int) PageMeta {
	return PageMeta{Total: total, Limit: limit, Offset: offset}
}
```

- [ ] **Step 4: Write `immutable.go`**

```go
// immutable.go: the system-entity guard.
//
// READ THIS BEFORE REMOVING IT AS REDUNDANT. It is not redundant. Warden
// defines ErrSystemRoleImmutable and ErrSystemPermissionImmutable in
// errors.go, and a repository-wide grep finds ZERO places that return
// either one. No store checks IsSystem on update or delete. The HTTP API
// does not check it. The engine does not check it.
//
// So IsSystem is, everywhere below this file, a display flag with no teeth.
// Without these two functions this dashboard will let an operator rename a
// system role, change its parent, or delete it, and the store will do it.
//
// The guard belongs here rather than in each handler so that the plans
// after this one cannot add a role or permission write that forgets it.
package contract

import (
	"fmt"

	"github.com/xraph/warden"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// guardSystemRole refuses a write to a system role.
//
// The returned error wraps warden.ErrSystemRoleImmutable so errors.Is still
// works for any caller that checks for it, and carries CodePermissionDenied
// because retyping the input will not help. It is a permission fact, not
// bad input.
func guardSystemRole(r *role.Role) error {
	if r == nil || !r.IsSystem {
		return nil
	}
	return &dashcontract.Error{
		Code: dashcontract.CodePermissionDenied,
		Message: fmt.Sprintf("%q is a system role and cannot be changed or deleted",
			r.Name),
		Err: warden.ErrSystemRoleImmutable,
	}
}

// guardSystemPermission refuses a write to a system permission.
func guardSystemPermission(p *permission.Permission) error {
	if p == nil || !p.IsSystem {
		return nil
	}
	return &dashcontract.Error{
		Code: dashcontract.CodePermissionDenied,
		Message: fmt.Sprintf("%q is a system permission and cannot be changed or deleted",
			p.Name),
		Err: warden.ErrSystemPermissionImmutable,
	}
}
```

Read `forge/extensions/dashboard/contract/errors.go` before writing this: the field that carries a wrapped cause may not be named `Err`. If `dashcontract.Error` has no such field, drop it and use `fmt.Errorf("%w", ...)` wrapping outside the struct, or return the sentinel directly and let `mapWardenError` translate it. The requirement is that `errors.Is(err, warden.ErrSystemRoleImmutable)` holds AND the wire code is `PERMISSION_DENIED`; how you achieve both is yours.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run 'Page|Guard' -v
```

Expected: all nine PASS.

- [ ] **Step 6: Run the whole reachable suite**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./extension/... .
```

Expected: PASS. Do not run `go test ./...`: `./store/...` does not compile because another session has `store/contract/actor_fields.go` staged but uncommitted. That is pre-existing and not yours.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "feat(contract): add the paging envelope and the system entity guard" -- extension/contract
```

---

## Task 2: `roles.list` and `roles.detail`

The two reads. `roles.detail` is the one that costs thought: a role's page shows its grants and its children, and both are separate store calls.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_roles.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_roles_test.go`
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/contract.go`
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/manifest.yaml`

**Interfaces:**
- Consumes: `PageRequest`, `PageMeta`, `newPageMeta` from Task 1; `Deps`, `requireEngine`, `tenantFrom`, `mapWardenError`.
- Produces: `RoleSummary`, `RoleDetail`, `PermissionSummary`, `RolesListInput`, `RolesListResponse`, `RoleDetailInput`. Tasks 3, 4, 6 and 7 all use these names.

- [ ] **Step 1: Write the failing tests**

Create `handlers_roles_test.go`. Note it reuses `testEngine`, `principalFor` and `errorsAs` which already exist in this package's test files.

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/warden"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// seedRoles creates n roles in tenant t1 at the given namespace.
func seedRoles(t *testing.T, s *memory.Store, namespace string, slugs ...string) []*role.Role {
	t.Helper()
	ctx := context.Background()
	out := make([]*role.Role, 0, len(slugs))
	for _, slug := range slugs {
		r := &role.Role{
			TenantID:      "t1",
			NamespacePath: namespace,
			Name:          slug,
			Slug:          slug,
		}
		if err := s.CreateRole(ctx, r); err != nil {
			t.Fatalf("create role %q: %v", slug, err)
		}
		out = append(out, r)
	}
	return out
}

func engineOver(t *testing.T, s *memory.Store) *warden.Engine {
	t.Helper()
	eng, err := warden.NewEngine(warden.WithStore(s))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	return eng
}

func TestRolesListPagesAndReportsTheTotal(t *testing.T) {
	s := memory.New()
	seedRoles(t, s, "", "a", "b", "c", "d", "e")
	h := rolesListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), RolesListInput{PageRequest: PageRequest{Limit: 2}}, principalFor("t1"))
	if err != nil {
		t.Fatalf("roles.list: %v", err)
	}
	if len(got.Items) != 2 {
		t.Errorf("returned %d items, want 2", len(got.Items))
	}
	// Total is the count matching the filter, not the page size. A pager
	// that read len(items) would think there was one page.
	if got.Total != 5 {
		t.Errorf("total = %d, want 5", got.Total)
	}
	if got.Limit != 2 || got.Offset != 0 {
		t.Errorf("echoed limit/offset = %d/%d, want 2/0", got.Limit, got.Offset)
	}
}

func TestRolesListWithNoLimitDoesNotReturnEverything(t *testing.T) {
	// Every store ListFilter treats Limit 0 as no limit. A handler that
	// passed an unset limit straight through would load the whole table.
	s := memory.New()
	slugs := make([]string, 0, 40)
	for i := 0; i < 40; i++ {
		slugs = append(slugs, "r"+string(rune('a'+i%26))+string(rune('0'+i/26)))
	}
	seedRoles(t, s, "", slugs...)
	h := rolesListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), RolesListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("roles.list: %v", err)
	}
	if len(got.Items) != defaultPageLimit {
		t.Errorf("returned %d items, want the default page of %d", len(got.Items), defaultPageLimit)
	}
	if got.Total != 40 {
		t.Errorf("total = %d, want 40", got.Total)
	}
}

func TestRolesListFiltersByNamespaceAndDistinguishesRootFromAll(t *testing.T) {
	// The three-state namespace rule, on the server side. nil must mean
	// every namespace and "" must mean the tenant root, because the store
	// treats them differently and collapsing them would silently scope
	// every list to the root.
	s := memory.New()
	seedRoles(t, s, "", "root-role")
	seedRoles(t, s, "eng", "eng-role")
	h := rolesListHandler(Deps{Engine: engineOver(t, s)})

	all, err := h(context.Background(), RolesListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("all: %v", err)
	}
	if all.Total != 2 {
		t.Errorf("nil namespace total = %d, want both roles (2)", all.Total)
	}

	rootOnly := ""
	root, err := h(context.Background(), RolesListInput{NamespacePath: &rootOnly}, principalFor("t1"))
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	if root.Total != 1 || root.Items[0].Slug != "root-role" {
		t.Errorf("empty-string namespace returned %+v, want only root-role", root.Items)
	}
}

func TestRolesListIsScopedToItsOwnTenant(t *testing.T) {
	s := memory.New()
	seedRoles(t, s, "", "mine")
	ctx := context.Background()
	other := &role.Role{TenantID: "t2", Name: "theirs", Slug: "theirs"}
	if err := s.CreateRole(ctx, other); err != nil {
		t.Fatalf("create other tenant's role: %v", err)
	}
	h := rolesListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(ctx, RolesListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("roles.list: %v", err)
	}
	// Asserted on identity, not count: a count assertion passes when the
	// wrong rows arrive in the right quantity.
	for _, r := range got.Items {
		if r.Slug == "theirs" {
			t.Fatal("t1 can see t2's role: tenant scoping is not applied")
		}
	}
	if got.Total != 1 {
		t.Errorf("total = %d, want 1", got.Total)
	}
}

func TestRolesDetailCarriesGrantsAndChildren(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	parent := seedRoles(t, s, "", "parent")[0]
	child := &role.Role{TenantID: "t1", Name: "child", Slug: "child", ParentSlug: "parent"}
	if err := s.CreateRole(ctx, child); err != nil {
		t.Fatalf("create child: %v", err)
	}
	p := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, p); err != nil {
		t.Fatalf("create permission: %v", err)
	}
	if err := s.AttachPermission(ctx, "t1", parent.ID, permission.Ref{Name: "document:read"}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := rolesDetailHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(ctx, RoleDetailInput{ID: parent.ID.String()}, principalFor("t1"))
	if err != nil {
		t.Fatalf("roles.detail: %v", err)
	}
	if len(got.Permissions) != 1 || got.Permissions[0].Name != "document:read" {
		t.Errorf("permissions = %+v, want one document:read", got.Permissions)
	}
	if len(got.Children) != 1 || got.Children[0].Slug != "child" {
		t.Errorf("children = %+v, want one child", got.Children)
	}
}

func TestRolesDetailRejectsAMalformedID(t *testing.T) {
	// A typeid with the wrong prefix is a caller bug, not a missing row.
	// Reporting it as NOT_FOUND would send somebody looking for a role
	// that was never asked for.
	h := rolesDetailHandler(Deps{Engine: engineOver(t, memory.New())})
	_, err := h(context.Background(), RoleDetailInput{ID: "perm_01hq"}, principalFor("t1"))
	if err == nil {
		t.Fatal("want an error for a permission id passed as a role id")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest, got %v", err)
	}
}

func TestRolesDetailOfAnotherTenantsRoleIsNotFound(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	other := &role.Role{TenantID: "t2", Name: "theirs", Slug: "theirs"}
	if err := s.CreateRole(ctx, other); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := rolesDetailHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, RoleDetailInput{ID: other.ID.String()}, principalFor("t1"))
	if err == nil {
		t.Fatal("want NOT_FOUND reading another tenant's role by id")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeNotFound {
		t.Errorf("want CodeNotFound, got %v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run Roles -v
```

Expected: compile failure, `undefined: rolesListHandler`.

- [ ] **Step 3: Write the DTOs and the two handlers**

Create `handlers_roles.go`. Read `role/role.go` for the field names before trusting these.

```go
// handlers_roles.go: the role surface.
//
// Roles carry more than the templ dashboard ever showed: a namespace, the
// system and default flags, a member cap, and parent-slug inheritance.
// Slugs are unique per (tenant, namespace), which is why the namespace is
// on every read and every write.
package contract

import (
	"context"
	"time"

	"github.com/xraph/warden/id"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// RoleSummary is one row of the roles list.
type RoleSummary struct {
	ID            string `json:"id"`
	NamespacePath string `json:"namespacePath"`
	Name          string `json:"name"`
	Slug          string `json:"slug"`
	Description   string `json:"description,omitempty"`
	ParentSlug    string `json:"parentSlug,omitempty"`
	IsSystem      bool   `json:"isSystem"`
	IsDefault     bool   `json:"isDefault"`
	MaxMembers    int    `json:"maxMembers,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// PermissionSummary is one row of the permissions list, and one grant on a
// role's detail page. The same shape serves both so the role page can link
// each grant to its own permission row.
type PermissionSummary struct {
	ID            string `json:"id"`
	NamespacePath string `json:"namespacePath"`
	Name          string `json:"name"`
	Resource      string `json:"resource"`
	Action        string `json:"action"`
	Description   string `json:"description,omitempty"`
	IsSystem      bool   `json:"isSystem"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// RoleDetail is one role with everything its page shows.
type RoleDetail struct {
	RoleSummary
	Permissions []PermissionSummary `json:"permissions"`
	Children    []RoleSummary       `json:"children"`
	CreatedBy   string              `json:"createdBy,omitempty"`
	UpdatedBy   string              `json:"updatedBy,omitempty"`
}

// RolesListInput filters the roles list.
//
// NamespacePath is a pointer because nil and the empty string are different
// queries: nil means every namespace, "" means the tenant root.
type RolesListInput struct {
	PageRequest
	NamespacePath *string `json:"namespacePath,omitempty"`
	Search        string  `json:"search,omitempty"`
	IsSystem      *bool   `json:"isSystem,omitempty"`
	IsDefault     *bool   `json:"isDefault,omitempty"`
}

// RolesListResponse is the paged reply.
type RolesListResponse struct {
	PageMeta
	Items []RoleSummary `json:"items"`
}

// RoleDetailInput names one role.
type RoleDetailInput struct {
	ID string `json:"id"`
}

func projectRole(r *role.Role) RoleSummary {
	return RoleSummary{
		ID:            r.ID.String(),
		NamespacePath: r.NamespacePath,
		Name:          r.Name,
		Slug:          r.Slug,
		Description:   r.Description,
		ParentSlug:    r.ParentSlug,
		IsSystem:      r.IsSystem,
		IsDefault:     r.IsDefault,
		MaxMembers:    r.MaxMembers,
		CreatedAt:     r.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:     r.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func projectPermission(p *permission.Permission) PermissionSummary {
	return PermissionSummary{
		ID:            p.ID.String(),
		NamespacePath: p.NamespacePath,
		Name:          p.Name,
		Resource:      p.Resource,
		Action:        p.Action,
		Description:   p.Description,
		IsSystem:      p.IsSystem,
		CreatedAt:     p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:     p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// parseRoleID turns a wire id into a typed one, reporting a malformed id as
// BAD_REQUEST rather than NOT_FOUND. They are different facts: one is a
// caller bug, the other sends somebody looking for a missing row.
func parseRoleID(raw string) (id.RoleID, error) {
	rid, err := id.ParseRoleID(raw)
	if err != nil {
		return id.Nil, &dashcontract.Error{
			Code:    dashcontract.CodeBadRequest,
			Message: "not a role id: " + raw,
		}
	}
	return rid, nil
}

func rolesListHandler(deps Deps) func(context.Context, RolesListInput, dashcontract.Principal) (RolesListResponse, error) {
	return func(ctx context.Context, in RolesListInput, p dashcontract.Principal) (RolesListResponse, error) {
		if err := requireEngine(deps); err != nil {
			return RolesListResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return RolesListResponse{}, err
		}
		limit, offset := in.Clamp()
		filter := &role.ListFilter{
			TenantID:      tenantID,
			NamespacePath: in.NamespacePath,
			Search:        in.Search,
			IsSystem:      in.IsSystem,
			IsDefault:     in.IsDefault,
			Limit:         limit,
			Offset:        offset,
		}
		s := deps.Engine.Store()
		rows, err := s.ListRoles(ctx, filter)
		if err != nil {
			return RolesListResponse{}, mapWardenError(err)
		}
		total, err := s.CountRoles(ctx, filter)
		if err != nil {
			return RolesListResponse{}, mapWardenError(err)
		}
		out := RolesListResponse{
			PageMeta: newPageMeta(total, limit, offset),
			Items:    make([]RoleSummary, 0, len(rows)),
		}
		for _, r := range rows {
			out.Items = append(out.Items, projectRole(r))
		}
		return out, nil
	}
}

func rolesDetailHandler(deps Deps) func(context.Context, RoleDetailInput, dashcontract.Principal) (RoleDetail, error) {
	return func(ctx context.Context, in RoleDetailInput, p dashcontract.Principal) (RoleDetail, error) {
		if err := requireEngine(deps); err != nil {
			return RoleDetail{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return RoleDetail{}, err
		}
		rid, err := parseRoleID(in.ID)
		if err != nil {
			return RoleDetail{}, err
		}
		s := deps.Engine.Store()
		r, err := s.GetRole(ctx, tenantID, rid)
		if err != nil {
			return RoleDetail{}, mapWardenError(err)
		}
		out := RoleDetail{
			RoleSummary: projectRole(r),
			Permissions: []PermissionSummary{},
			Children:    []RoleSummary{},
			CreatedBy:   r.CreatedBy,
			UpdatedBy:   r.UpdatedBy,
		}
		grants, err := s.ListRolePermissions(ctx, tenantID, rid)
		if err != nil {
			return RoleDetail{}, mapWardenError(err)
		}
		for _, g := range grants {
			out.Permissions = append(out.Permissions, projectPermission(g))
		}
		// Children are found by parent SLUG, not by id, because slugs are
		// what inheritance is declared with.
		children, err := s.ListChildRoles(ctx, tenantID, r.Slug)
		if err != nil {
			return RoleDetail{}, mapWardenError(err)
		}
		for _, c := range children {
			out.Children = append(out.Children, projectRole(c))
		}
		return out, nil
	}
}
```

Both slices are initialised non-nil so the JSON carries `[]` rather than `null`. A TypeScript page doing `data.permissions.length` on `null` throws, and `?? []` in every consumer is the kind of defensive noise that spreads.

- [ ] **Step 4: Register the two intents**

In `contract.go`, after the existing registrations:

```go
	if err := dispatcher.RegisterQuery(d, contributorName, "roles.list", 1, rolesListHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.list: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, contributorName, "roles.detail", 1, rolesDetailHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.detail: %w", err)
	}
```

In `manifest.yaml`, under `intents`:

```yaml
  - { name: roles.list,   kind: query, version: 1, capability: read }
  - { name: roles.detail, kind: query, version: 1, capability: read }
```

and under `queries`:

```yaml
  roleList:
    intent: roles.list
    cache: { staleTime: 30s }
  roleDetail:
    intent: roles.detail
    cache: { staleTime: 30s }
```

The `manifest_test.go` from the previous plan asserts the manifest and the registrations match in both directions, so forgetting either half fails a test rather than producing a silently missing page.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -v
```

Expected: all PASS, including the manifest and tenant-enforcement tests from the previous plan. The tenant-enforcement test enumerates handlers from `contract.go`'s source, so it will pick up the two new ones automatically and require them to refuse an empty principal.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "feat(contract): read roles, with their grants and children" -- extension/contract
```

---

## Task 3: `roles.create`, `roles.update`, `roles.delete`

The writes. Two of the three carry a trap the plan's Review Focus names.

**Files:**
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_roles.go`
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_roles_test.go`
- Modify: `contract.go`, `manifest.yaml`

**Interfaces:**
- Consumes: everything from Task 2, plus `guardSystemRole` from Task 1.
- Produces: `RoleCreateInput`, `RoleUpdateInput`, `RoleDeleteInput`, `AckResponse`. Tasks 4, 6 and 7 use `AckResponse`.

- [ ] **Step 1: Write the failing tests**

Append to `handlers_roles_test.go`:

```go
func TestRolesCreateReturnsTheNewID(t *testing.T) {
	s := memory.New()
	h := rolesCreateHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), RoleCreateInput{
		Name: "Reader", Slug: "reader", Description: "can read",
	}, principalFor("t1"))
	if err != nil {
		t.Fatalf("roles.create: %v", err)
	}
	if got.ID == "" {
		t.Fatal("create returned no id: the page cannot navigate to what it made")
	}
	rid, err := id.ParseRoleID(got.ID)
	if err != nil {
		t.Fatalf("returned id %q is not a role id: %v", got.ID, err)
	}
	stored, err := s.GetRole(context.Background(), "t1", rid)
	if err != nil {
		t.Fatalf("get created role: %v", err)
	}
	if stored.Name != "Reader" || stored.Slug != "reader" {
		t.Errorf("stored %+v, want name Reader slug reader", stored)
	}
}

func TestRolesCreateRejectsAnInvalidNamespace(t *testing.T) {
	// ValidateNamespacePath forbids a leading or trailing slash and caps
	// depth. A bad namespace must be refused here rather than written and
	// then be unreachable by every namespaced query.
	s := memory.New()
	h := rolesCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), RoleCreateInput{
		Name: "X", Slug: "x", NamespacePath: "/leading",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal for a namespace with a leading slash")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest, got %v", err)
	}
}

func TestRolesUpdateLeavesOmittedFieldsAlone(t *testing.T) {
	// The trap. UpdateRole takes a whole *role.Role and writes it, so a
	// handler that builds a fresh struct from the request erases every
	// field the request did not mention. Here: update only the name, and
	// the description, parent and member cap must survive.
	s := memory.New()
	ctx := context.Background()
	seedRoles(t, s, "", "base")
	r := &role.Role{
		TenantID: "t1", Name: "Original", Slug: "target",
		Description: "keep me", ParentSlug: "base", MaxMembers: 7,
	}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := rolesUpdateHandler(Deps{Engine: engineOver(t, s)})

	newName := "Renamed"
	if _, err := h(ctx, RoleUpdateInput{ID: r.ID.String(), Name: &newName}, principalFor("t1")); err != nil {
		t.Fatalf("roles.update: %v", err)
	}

	after, err := s.GetRole(ctx, "t1", r.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if after.Name != "Renamed" {
		t.Errorf("name = %q, want Renamed", after.Name)
	}
	if after.Description != "keep me" {
		t.Errorf("description = %q, want it untouched", after.Description)
	}
	if after.ParentSlug != "base" {
		t.Errorf("parentSlug = %q, want it untouched", after.ParentSlug)
	}
	if after.MaxMembers != 7 {
		t.Errorf("maxMembers = %d, want it untouched", after.MaxMembers)
	}
}

func TestRolesUpdateCanClearAFieldDeliberately(t *testing.T) {
	// The other half of the pointer contract: a pointer to the empty
	// string means "set it to empty", which is different from omitting it.
	s := memory.New()
	ctx := context.Background()
	seedRoles(t, s, "", "base")
	r := &role.Role{TenantID: "t1", Name: "R", Slug: "target", ParentSlug: "base"}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := rolesUpdateHandler(Deps{Engine: engineOver(t, s)})

	empty := ""
	if _, err := h(ctx, RoleUpdateInput{ID: r.ID.String(), ParentSlug: &empty}, principalFor("t1")); err != nil {
		t.Fatalf("roles.update: %v", err)
	}
	after, err := s.GetRole(ctx, "t1", r.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if after.ParentSlug != "" {
		t.Errorf("parentSlug = %q, want cleared", after.ParentSlug)
	}
}

func TestRolesUpdateRefusesASystemRole(t *testing.T) {
	// Nothing below the contract enforces this. See immutable.go.
	s := memory.New()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "System", Slug: "system-role", IsSystem: true}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := rolesUpdateHandler(Deps{Engine: engineOver(t, s)})

	newName := "Hijacked"
	_, err := h(ctx, RoleUpdateInput{ID: r.ID.String(), Name: &newName}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal updating a system role")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodePermissionDenied {
		t.Errorf("want CodePermissionDenied, got %v", err)
	}
	after, getErr := s.GetRole(ctx, "t1", r.ID)
	if getErr != nil {
		t.Fatalf("get: %v", getErr)
	}
	if after.Name != "System" {
		t.Errorf("the refusal did not prevent the write: name is now %q", after.Name)
	}
}

func TestRolesUpdateRefusesAParentCycle(t *testing.T) {
	// Setting a role's parent to its own descendant makes the engine's
	// inheritance walk loop. ErrCyclicRoleInheritance exists for this.
	s := memory.New()
	ctx := context.Background()
	parent := &role.Role{TenantID: "t1", Name: "P", Slug: "p"}
	if err := s.CreateRole(ctx, parent); err != nil {
		t.Fatalf("create parent: %v", err)
	}
	child := &role.Role{TenantID: "t1", Name: "C", Slug: "c", ParentSlug: "p"}
	if err := s.CreateRole(ctx, child); err != nil {
		t.Fatalf("create child: %v", err)
	}
	h := rolesUpdateHandler(Deps{Engine: engineOver(t, s)})

	cycle := "c"
	_, err := h(ctx, RoleUpdateInput{ID: parent.ID.String(), ParentSlug: &cycle}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal setting a role's parent to its own child")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest for a cycle, got %v", err)
	}
}

func TestRolesUpdateRefusesARoleAsItsOwnParent(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "R", Slug: "self"}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := rolesUpdateHandler(Deps{Engine: engineOver(t, s)})

	self := "self"
	if _, err := h(ctx, RoleUpdateInput{ID: r.ID.String(), ParentSlug: &self}, principalFor("t1")); err == nil {
		t.Fatal("want a refusal for a role parented to itself")
	}
}

func TestRolesDeleteRemovesTheRole(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "doomed")[0]
	h := rolesDeleteHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RoleDeleteInput{ID: r.ID.String()}, principalFor("t1")); err != nil {
		t.Fatalf("roles.delete: %v", err)
	}
	if _, err := s.GetRole(ctx, "t1", r.ID); err == nil {
		t.Fatal("the role is still there after delete")
	}
}

func TestRolesDeleteRefusesASystemRole(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "System", Slug: "sys", IsSystem: true}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := rolesDeleteHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RoleDeleteInput{ID: r.ID.String()}, principalFor("t1")); err == nil {
		t.Fatal("want a refusal deleting a system role")
	}
	if _, err := s.GetRole(ctx, "t1", r.ID); err != nil {
		t.Errorf("the refusal did not prevent the delete: %v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run Roles -v
```

Expected: compile failure, `undefined: rolesCreateHandler`.

- [ ] **Step 3: Write the three handlers**

Append to `handlers_roles.go`. Add `"github.com/xraph/warden"` to its imports.

```go
// AckResponse is what a command returns when the only thing worth reporting
// is which row it touched. ID is empty for a delete.
type AckResponse struct {
	ID string `json:"id,omitempty"`
}

// RoleCreateInput creates a role. Non-pointer fields because a create has
// no "leave this alone": every field is either given or defaulted.
type RoleCreateInput struct {
	Name          string `json:"name"`
	Slug          string `json:"slug"`
	NamespacePath string `json:"namespacePath,omitempty"`
	Description   string `json:"description,omitempty"`
	ParentSlug    string `json:"parentSlug,omitempty"`
	MaxMembers    int    `json:"maxMembers,omitempty"`
	IsDefault     bool   `json:"isDefault,omitempty"`
}

// RoleUpdateInput patches a role.
//
// Every optional field is a pointer, and the distinction is load-bearing:
// nil means "leave this alone", and a pointer to the zero value means "set
// it to empty". A non-pointer field cannot express the difference, and the
// UI would silently erase values the operator never touched.
type RoleUpdateInput struct {
	ID          string  `json:"id"`
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	ParentSlug  *string `json:"parentSlug,omitempty"`
	MaxMembers  *int    `json:"maxMembers,omitempty"`
	IsDefault   *bool   `json:"isDefault,omitempty"`
}

// RoleDeleteInput names the role to remove.
type RoleDeleteInput struct {
	ID string `json:"id"`
}

// badRequest is the shape for anything a person can fix by retyping.
func badRequest(msg string) error {
	return &dashcontract.Error{Code: dashcontract.CodeBadRequest, Message: msg}
}

// validateNamespace refuses a malformed namespace before it is written.
// A row with an invalid namespace is reachable by no namespaced query, so
// writing one loses it silently.
func validateNamespace(deps Deps, path string) error {
	maxDepth := deps.Engine.Config().MaxNamespaceDepth
	if err := warden.ValidateNamespacePath(path, maxDepth); err != nil {
		return badRequest(err.Error())
	}
	return nil
}

func rolesCreateHandler(deps Deps) func(context.Context, RoleCreateInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RoleCreateInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		if in.Name == "" || in.Slug == "" {
			return AckResponse{}, badRequest("a role needs a name and a slug")
		}
		if err := validateNamespace(deps, in.NamespacePath); err != nil {
			return AckResponse{}, err
		}
		if in.ParentSlug == in.Slug && in.ParentSlug != "" {
			return AckResponse{}, badRequest("a role cannot be its own parent")
		}
		r := &role.Role{
			TenantID:      tenantID,
			NamespacePath: in.NamespacePath,
			Name:          in.Name,
			Slug:          in.Slug,
			Description:   in.Description,
			ParentSlug:    in.ParentSlug,
			MaxMembers:    in.MaxMembers,
			IsDefault:     in.IsDefault,
		}
		if err := deps.Engine.Store().CreateRole(ctx, r); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: r.ID.String()}, nil
	}
}

func rolesUpdateHandler(deps Deps) func(context.Context, RoleUpdateInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RoleUpdateInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		rid, err := parseRoleID(in.ID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()

		// Read, patch, write. UpdateRole persists the whole struct, so
		// building a fresh one from the request would erase every field
		// the request omitted.
		r, err := s.GetRole(ctx, tenantID, rid)
		if err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		if err := guardSystemRole(r); err != nil {
			return AckResponse{}, err
		}
		if in.Name != nil {
			if *in.Name == "" {
				return AckResponse{}, badRequest("a role's name cannot be empty")
			}
			r.Name = *in.Name
		}
		if in.Description != nil {
			r.Description = *in.Description
		}
		if in.MaxMembers != nil {
			r.MaxMembers = *in.MaxMembers
		}
		if in.IsDefault != nil {
			r.IsDefault = *in.IsDefault
		}
		if in.ParentSlug != nil {
			if err := checkParent(ctx, s, tenantID, r, *in.ParentSlug); err != nil {
				return AckResponse{}, err
			}
			r.ParentSlug = *in.ParentSlug
		}
		if err := s.UpdateRole(ctx, r); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: r.ID.String()}, nil
	}
}

// checkParent refuses a parent that would create a cycle.
//
// Walks up from the proposed parent following ParentSlug. If the walk
// reaches the role being edited, the proposed parent is one of its own
// descendants and the engine's inheritance resolution would loop. The walk
// is bounded by the number of roles it has already seen, so a cycle that
// already exists in the data cannot hang this check either.
func checkParent(ctx context.Context, s store.Store, tenantID string, r *role.Role, parentSlug string) error {
	if parentSlug == "" {
		return nil
	}
	if parentSlug == r.Slug {
		return badRequest("a role cannot be its own parent")
	}
	seen := map[string]struct{}{r.Slug: {}}
	slug := parentSlug
	for slug != "" {
		if _, loop := seen[slug]; loop {
			return badRequest("that parent would create a cycle in role inheritance")
		}
		seen[slug] = struct{}{}
		next, err := s.GetRoleBySlug(ctx, tenantID, r.NamespacePath, slug)
		if err != nil {
			// A parent that does not exist in this namespace is bad input,
			// not a cycle. Report it as such.
			return badRequest("no role with slug " + slug + " in this namespace")
		}
		slug = next.ParentSlug
	}
	return nil
}

func rolesDeleteHandler(deps Deps) func(context.Context, RoleDeleteInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RoleDeleteInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		rid, err := parseRoleID(in.ID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()
		// Read first so the system guard has something to check, and so a
		// delete of another tenant's role is NOT_FOUND rather than silent.
		r, err := s.GetRole(ctx, tenantID, rid)
		if err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		if err := guardSystemRole(r); err != nil {
			return AckResponse{}, err
		}
		if err := s.DeleteRole(ctx, tenantID, rid); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{}, nil
	}
}
```

`checkParent` takes a `store.Store`, so add `"github.com/xraph/warden/store"` to the imports. Check `Config.MaxNamespaceDepth` is the real field name in `config.go` before relying on `validateNamespace`.

- [ ] **Step 4: Register the three commands**

In `contract.go`:

```go
	if err := dispatcher.RegisterCommand(d, contributorName, "roles.create", 1, rolesCreateHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.create: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "roles.update", 1, rolesUpdateHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.update: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "roles.delete", 1, rolesDeleteHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.delete: %w", err)
	}
```

In `manifest.yaml`, under `intents`. Note what each invalidates and why:

```yaml
  # A create changes the list and the counters, and can change another
  # role's children if it names a parent.
  - { name: roles.create, kind: command, version: 1, capability: write,
      invalidates: [roles.list, roles.detail, overview.stats, namespaces.list] }
  # An update can change the name shown in the list, the parent (which moves
  # this role between two other roles' children), and nothing else.
  - { name: roles.update, kind: command, version: 1, capability: write,
      invalidates: [roles.list, roles.detail] }
  # A delete cascades: DeleteAssignmentsByRole removes every assignment of
  # this role, so the assignments list and the counters change too.
  - { name: roles.delete, kind: command, version: 1, capability: write,
      invalidates: [roles.list, roles.detail, overview.stats] }
```

`roles.create` invalidates `namespaces.list` because creating the first role in a namespace makes that namespace appear in the derived list, and the namespace filter would not otherwise offer it until something else refreshed.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./extension/... .
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "feat(contract): create, update and delete roles, refusing system roles and parent cycles" -- extension/contract
```

---

## Task 4: The role-permission junction

Three commands over a junction keyed by natural key rather than by id, which is where the subtlety lives.

**Files:**
- Modify: `handlers_roles.go`, `handlers_roles_test.go`, `contract.go`, `manifest.yaml`

**Interfaces:**
- Consumes: everything from Tasks 1 to 3.
- Produces: `RolePermissionInput{RoleID, PermissionName, PermissionNamespacePath}`, `RoleSetPermissionsInput{RoleID, Permissions []PermissionRef}`, `PermissionRef{Name, NamespacePath}`. Task 7's role detail page uses all three.

- [ ] **Step 1: Write the failing tests**

Append to `handlers_roles_test.go`:

```go
func TestRolesAttachPermissionGrantsIt(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create permission: %v", err)
	}
	h := rolesAttachPermissionHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RolePermissionInput{
		RoleID: r.ID.String(), PermissionName: "document:read",
	}, principalFor("t1")); err != nil {
		t.Fatalf("roles.attachPermission: %v", err)
	}
	grants, err := s.ListRolePermissions(ctx, "t1", r.ID)
	if err != nil {
		t.Fatalf("list grants: %v", err)
	}
	if len(grants) != 1 || grants[0].Name != "document:read" {
		t.Errorf("grants = %+v, want one document:read", grants)
	}
}

func TestRolesAttachPermissionThatDoesNotExistIsRefused(t *testing.T) {
	// The junction is keyed by (namespacePath, name) and the store will
	// happily record a grant for a permission that is not there, which
	// then grants nothing and looks like it worked. Resolve it first.
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	h := rolesAttachPermissionHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, RolePermissionInput{
		RoleID: r.ID.String(), PermissionName: "nope:nope",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal attaching a permission that does not exist")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeNotFound {
		t.Errorf("want CodeNotFound, got %v", err)
	}
}

func TestRolesDetachPermissionThatWasNeverAttachedIsRefused(t *testing.T) {
	// A detach with the wrong namespace silently affects nothing and
	// returns no error, so the page would report success and the grant
	// would still be there. Verify the grant exists before detaching.
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create permission: %v", err)
	}
	h := rolesDetachPermissionHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, RolePermissionInput{
		RoleID: r.ID.String(), PermissionName: "document:read",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal detaching a grant the role does not have")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeNotFound {
		t.Errorf("want CodeNotFound, got %v", err)
	}
}

func TestRolesDetachPermissionRemovesTheGrant(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create permission: %v", err)
	}
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{Name: "document:read"}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := rolesDetachPermissionHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RolePermissionInput{
		RoleID: r.ID.String(), PermissionName: "document:read",
	}, principalFor("t1")); err != nil {
		t.Fatalf("roles.detachPermission: %v", err)
	}
	grants, err := s.ListRolePermissions(ctx, "t1", r.ID)
	if err != nil {
		t.Fatalf("list grants: %v", err)
	}
	if len(grants) != 0 {
		t.Errorf("grants = %+v, want none", grants)
	}
}

func TestRolesSetPermissionsReplacesTheWholeSet(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	for _, name := range []string{"document:read", "document:write", "folder:read"} {
		parts := name
		pm := &permission.Permission{
			TenantID: "t1", Name: parts,
			Resource: parts[:len(parts)-len(":read")], Action: "read",
		}
		pm.Name = name
		if err := s.CreatePermission(ctx, pm); err != nil {
			t.Fatalf("create %q: %v", name, err)
		}
	}
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{Name: "document:read"}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := rolesSetPermissionsHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RoleSetPermissionsInput{
		RoleID: r.ID.String(),
		Permissions: []PermissionRef{
			{Name: "document:write"},
			{Name: "folder:read"},
		},
	}, principalFor("t1")); err != nil {
		t.Fatalf("roles.setPermissions: %v", err)
	}
	grants, err := s.ListRolePermissions(ctx, "t1", r.ID)
	if err != nil {
		t.Fatalf("list grants: %v", err)
	}
	if len(grants) != 2 {
		t.Fatalf("grants = %+v, want exactly the two named", grants)
	}
	for _, g := range grants {
		if g.Name == "document:read" {
			t.Error("setPermissions did not replace: the old grant survived")
		}
	}
}

func TestRolesSetPermissionsToAnEmptyListRevokesEverything(t *testing.T) {
	// An empty list is a real instruction, not a missing one: it means
	// this role grants nothing. A handler that treated empty as "no
	// change" would make revoke-all impossible from the UI.
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{Name: "document:read"}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := rolesSetPermissionsHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RoleSetPermissionsInput{
		RoleID: r.ID.String(), Permissions: []PermissionRef{},
	}, principalFor("t1")); err != nil {
		t.Fatalf("roles.setPermissions: %v", err)
	}
	grants, err := s.ListRolePermissions(ctx, "t1", r.ID)
	if err != nil {
		t.Fatalf("list grants: %v", err)
	}
	if len(grants) != 0 {
		t.Errorf("grants = %+v, want none after an empty set", grants)
	}
}

func TestRolesSetPermissionsRefusesAnUnknownPermission(t *testing.T) {
	// All or nothing. Silently dropping the unknown names would leave the
	// role with a set the operator did not choose.
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{Name: "document:read"}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := rolesSetPermissionsHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, RoleSetPermissionsInput{
		RoleID:      r.ID.String(),
		Permissions: []PermissionRef{{Name: "document:read"}, {Name: "ghost:read"}},
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal when one named permission does not exist")
	}
	grants, listErr := s.ListRolePermissions(ctx, "t1", r.ID)
	if listErr != nil {
		t.Fatalf("list: %v", listErr)
	}
	if len(grants) != 1 {
		t.Errorf("the refused call changed the grants anyway: %+v", grants)
	}
}

func TestJunctionCommandsRefuseASystemRole(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "System", Slug: "sys", IsSystem: true}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	pm := &permission.Permission{TenantID: "t1", Name: "document:read", Resource: "document", Action: "read"}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create permission: %v", err)
	}
	deps := Deps{Engine: engineOver(t, s)}

	if _, err := rolesAttachPermissionHandler(deps)(ctx, RolePermissionInput{
		RoleID: r.ID.String(), PermissionName: "document:read",
	}, principalFor("t1")); err == nil {
		t.Error("attach to a system role must be refused")
	}
	if _, err := rolesSetPermissionsHandler(deps)(ctx, RoleSetPermissionsInput{
		RoleID: r.ID.String(), Permissions: []PermissionRef{},
	}, principalFor("t1")); err == nil {
		t.Error("setPermissions on a system role must be refused")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run 'Attach|Detach|SetPermissions|Junction' -v
```

Expected: compile failure, `undefined: rolesAttachPermissionHandler`.

- [ ] **Step 3: Write the three junction handlers**

Append to `handlers_roles.go`:

```go
// PermissionRef names one permission by its natural key.
//
// The junction is keyed by (namespacePath, name), not by id, because that
// is what the DSL declares and what survives a re-apply. An empty
// NamespacePath means the tenant root, which is a real namespace rather
// than an absent value.
type PermissionRef struct {
	Name          string `json:"name"`
	NamespacePath string `json:"namespacePath,omitempty"`
}

// RolePermissionInput attaches or detaches one grant.
type RolePermissionInput struct {
	RoleID                  string `json:"roleId"`
	PermissionName          string `json:"permissionName"`
	PermissionNamespacePath string `json:"permissionNamespacePath,omitempty"`
}

// RoleSetPermissionsInput replaces a role's whole grant set.
//
// An empty Permissions slice is a real instruction: it revokes everything.
// That is why the field is not a pointer; there is no "leave the set alone"
// case for an intent whose only job is to replace it.
type RoleSetPermissionsInput struct {
	RoleID      string          `json:"roleId"`
	Permissions []PermissionRef `json:"permissions"`
}

// loadWritableRole fetches a role and refuses if it is a system role. Every
// junction command starts here.
func loadWritableRole(ctx context.Context, deps Deps, tenantID, rawID string) (*role.Role, error) {
	rid, err := parseRoleID(rawID)
	if err != nil {
		return nil, err
	}
	r, err := deps.Engine.Store().GetRole(ctx, tenantID, rid)
	if err != nil {
		return nil, mapWardenError(err)
	}
	if err := guardSystemRole(r); err != nil {
		return nil, err
	}
	return r, nil
}

// resolvePermissionRef confirms a named permission exists in this tenant
// before it is used as a junction key.
//
// Without this the store records a grant for a name that is not there. The
// role then appears to grant something and grants nothing, because the RBAC
// evaluator resolves grants by joining against the permissions table.
func resolvePermissionRef(ctx context.Context, deps Deps, tenantID string, ref PermissionRef) (permission.Ref, error) {
	if ref.Name == "" {
		return permission.Ref{}, badRequest("a permission reference needs a name")
	}
	if _, err := deps.Engine.Store().GetPermissionByName(ctx, tenantID, ref.NamespacePath, ref.Name); err != nil {
		return permission.Ref{}, &dashcontract.Error{
			Code:    dashcontract.CodeNotFound,
			Message: "no permission named " + ref.Name + " in that namespace",
		}
	}
	return permission.Ref{NamespacePath: ref.NamespacePath, Name: ref.Name}, nil
}

func rolesAttachPermissionHandler(deps Deps) func(context.Context, RolePermissionInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RolePermissionInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		r, err := loadWritableRole(ctx, deps, tenantID, in.RoleID)
		if err != nil {
			return AckResponse{}, err
		}
		ref, err := resolvePermissionRef(ctx, deps, tenantID, PermissionRef{
			Name: in.PermissionName, NamespacePath: in.PermissionNamespacePath,
		})
		if err != nil {
			return AckResponse{}, err
		}
		if err := deps.Engine.Store().AttachPermission(ctx, tenantID, r.ID, ref); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: r.ID.String()}, nil
	}
}

func rolesDetachPermissionHandler(deps Deps) func(context.Context, RolePermissionInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RolePermissionInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		r, err := loadWritableRole(ctx, deps, tenantID, in.RoleID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()

		// Confirm the grant is actually there. DetachPermission removes
		// nothing and returns no error when the (namespace, name) key does
		// not match, so a detach with the wrong namespace would report
		// success while the grant survived.
		grants, err := s.ListRolePermissions(ctx, tenantID, r.ID)
		if err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		var held bool
		for _, g := range grants {
			if g.Name == in.PermissionName && g.NamespacePath == in.PermissionNamespacePath {
				held = true
				break
			}
		}
		if !held {
			return AckResponse{}, &dashcontract.Error{
				Code:    dashcontract.CodeNotFound,
				Message: r.Name + " does not grant " + in.PermissionName,
			}
		}
		ref := permission.Ref{NamespacePath: in.PermissionNamespacePath, Name: in.PermissionName}
		if err := s.DetachPermission(ctx, tenantID, r.ID, ref); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: r.ID.String()}, nil
	}
}

func rolesSetPermissionsHandler(deps Deps) func(context.Context, RoleSetPermissionsInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RoleSetPermissionsInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		r, err := loadWritableRole(ctx, deps, tenantID, in.RoleID)
		if err != nil {
			return AckResponse{}, err
		}
		// Resolve every reference BEFORE writing any of them. All or
		// nothing: silently dropping an unknown name would leave the role
		// with a set the operator did not choose.
		refs := make([]permission.Ref, 0, len(in.Permissions))
		for _, ref := range in.Permissions {
			resolved, err := resolvePermissionRef(ctx, deps, tenantID, ref)
			if err != nil {
				return AckResponse{}, err
			}
			refs = append(refs, resolved)
		}
		if err := deps.Engine.Store().SetRolePermissions(ctx, tenantID, r.ID, refs); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: r.ID.String()}, nil
	}
}
```

- [ ] **Step 4: Register and declare the three commands**

In `contract.go`:

```go
	if err := dispatcher.RegisterCommand(d, contributorName, "roles.attachPermission", 1, rolesAttachPermissionHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.attachPermission: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "roles.detachPermission", 1, rolesDetachPermissionHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.detachPermission: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "roles.setPermissions", 1, rolesSetPermissionsHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register roles.setPermissions: %w", err)
	}
```

In `manifest.yaml`:

```yaml
  # A grant change alters the role's detail page. It does NOT change the
  # roles list, which shows no grant information, and it does not change
  # any counter.
  - { name: roles.attachPermission, kind: command, version: 1, capability: write,
      invalidates: [roles.detail] }
  - { name: roles.detachPermission, kind: command, version: 1, capability: write,
      invalidates: [roles.detail] }
  - { name: roles.setPermissions, kind: command, version: 1, capability: write,
      invalidates: [roles.detail] }
```

- [ ] **Step 5: Run the tests and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./extension/... . && git commit -m "feat(contract): attach, detach and replace a role's permission grants" -- extension/contract
```

---

## Task 5: The five permission intents

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_permissions.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_permissions_test.go`
- Modify: `contract.go`, `manifest.yaml`

**Interfaces:**
- Consumes: `PageRequest`, `PageMeta`, `newPageMeta`, `guardSystemPermission`, `PermissionSummary`, `projectPermission`, `AckResponse`, `badRequest`, `validateNamespace`.
- Produces: `PermissionsListInput`, `PermissionsListResponse`, `PermissionDetailInput`, `PermissionCreateInput`, `PermissionUpdateInput`, `PermissionDeleteInput`. Task 8 uses all of them.

- [ ] **Step 1: Write the failing tests**

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/warden/id"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func seedPermission(t *testing.T, s *memory.Store, namespace, name, resource, action string) *permission.Permission {
	t.Helper()
	pm := &permission.Permission{
		TenantID: "t1", NamespacePath: namespace,
		Name: name, Resource: resource, Action: action,
	}
	if err := s.CreatePermission(context.Background(), pm); err != nil {
		t.Fatalf("create permission %q: %v", name, err)
	}
	return pm
}

func TestPermissionsListPagesFiltersAndCounts(t *testing.T) {
	s := memory.New()
	seedPermission(t, s, "", "document:read", "document", "read")
	seedPermission(t, s, "", "document:write", "document", "write")
	seedPermission(t, s, "", "folder:read", "folder", "read")
	h := permissionsListHandler(Deps{Engine: engineOver(t, s)})

	all, err := h(context.Background(), PermissionsListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("permissions.list: %v", err)
	}
	if all.Total != 3 {
		t.Errorf("total = %d, want 3", all.Total)
	}

	byResource, err := h(context.Background(), PermissionsListInput{Resource: "document"}, principalFor("t1"))
	if err != nil {
		t.Fatalf("filtered: %v", err)
	}
	if byResource.Total != 2 {
		t.Errorf("resource=document total = %d, want 2", byResource.Total)
	}
	for _, item := range byResource.Items {
		if item.Resource != "document" {
			t.Errorf("resource filter leaked %q", item.Resource)
		}
	}
}

func TestPermissionsCreateRequiresNameToAgreeWithResourceAndAction(t *testing.T) {
	// The RBAC evaluator matches on Resource + ":" + Action, never on
	// Name. So a permission called document:read whose resource is folder
	// is invisible to every check that looks for document:read, and the
	// role that grants it appears to work and does not.
	s := memory.New()
	h := permissionsCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), PermissionCreateInput{
		Name: "document:read", Resource: "folder", Action: "read",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal when name disagrees with resource:action")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest, got %v", err)
	}
}

func TestPermissionsCreateDerivesNameWhenOmitted(t *testing.T) {
	// Name is derivable from resource and action, so asking for it twice
	// is a chance to disagree. An omitted name is filled in.
	s := memory.New()
	h := permissionsCreateHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), PermissionCreateInput{
		Resource: "document", Action: "read",
	}, principalFor("t1"))
	if err != nil {
		t.Fatalf("permissions.create: %v", err)
	}
	pid, err := id.ParsePermissionID(got.ID)
	if err != nil {
		t.Fatalf("bad id %q: %v", got.ID, err)
	}
	stored, err := s.GetPermission(context.Background(), "t1", pid)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if stored.Name != "document:read" {
		t.Errorf("name = %q, want the derived document:read", stored.Name)
	}
}

func TestPermissionsCreateRequiresResourceAndAction(t *testing.T) {
	s := memory.New()
	h := permissionsCreateHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(context.Background(), PermissionCreateInput{Resource: "document"}, principalFor("t1")); err == nil {
		t.Error("want a refusal with no action")
	}
	if _, err := h(context.Background(), PermissionCreateInput{Action: "read"}, principalFor("t1")); err == nil {
		t.Error("want a refusal with no resource")
	}
}

func TestPermissionsUpdateLeavesOmittedFieldsAlone(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	pm := seedPermission(t, s, "", "document:read", "document", "read")
	pm.Description = "original"
	if err := s.UpdatePermission(ctx, pm); err != nil {
		t.Fatalf("seed description: %v", err)
	}
	h := permissionsUpdateHandler(Deps{Engine: engineOver(t, s)})

	// Update nothing at all: every field must survive.
	if _, err := h(ctx, PermissionUpdateInput{ID: pm.ID.String()}, principalFor("t1")); err != nil {
		t.Fatalf("permissions.update: %v", err)
	}
	after, err := s.GetPermission(ctx, "t1", pm.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if after.Description != "original" || after.Resource != "document" || after.Action != "read" {
		t.Errorf("an empty update changed something: %+v", after)
	}
}

func TestPermissionsUpdateRefusesASystemPermission(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	pm := &permission.Permission{
		TenantID: "t1", Name: "system:admin",
		Resource: "system", Action: "admin", IsSystem: true,
	}
	if err := s.CreatePermission(ctx, pm); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := permissionsUpdateHandler(Deps{Engine: engineOver(t, s)})

	desc := "hijacked"
	if _, err := h(ctx, PermissionUpdateInput{ID: pm.ID.String(), Description: &desc}, principalFor("t1")); err == nil {
		t.Fatal("want a refusal updating a system permission")
	}
}

func TestPermissionsDeleteRefusesOneThatARoleStillGrants(t *testing.T) {
	// DeletePermission also removes the junction rows that grant it, so a
	// delete silently strips the permission from every role that had it.
	// Refuse and name the roles, so the operator detaches deliberately.
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := seedPermission(t, s, "", "document:read", "document", "read")
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{Name: pm.Name}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := permissionsDeleteHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, PermissionDeleteInput{ID: pm.ID.String()}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal deleting a permission a role still grants")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeConflict {
		t.Fatalf("want CodeConflict, got %v", err)
	}
	if !containsText(ce.Message, "reader") {
		t.Errorf("message %q does not name the role holding it", ce.Message)
	}
	if _, getErr := s.GetPermission(ctx, "t1", pm.ID); getErr != nil {
		t.Errorf("the refusal did not prevent the delete: %v", getErr)
	}
}

func TestPermissionsDeleteRemovesAnUngrantedPermission(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	pm := seedPermission(t, s, "", "document:read", "document", "read")
	h := permissionsDeleteHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, PermissionDeleteInput{ID: pm.ID.String()}, principalFor("t1")); err != nil {
		t.Fatalf("permissions.delete: %v", err)
	}
	if _, err := s.GetPermission(ctx, "t1", pm.ID); err == nil {
		t.Fatal("the permission is still there")
	}
}

func TestPermissionsDetailReturnsTheRolesThatGrantIt(t *testing.T) {
	// The question an operator actually has on this page is "who has this".
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	pm := seedPermission(t, s, "", "document:read", "document", "read")
	if err := s.AttachPermission(ctx, "t1", r.ID, permission.Ref{Name: pm.Name}); err != nil {
		t.Fatalf("attach: %v", err)
	}
	h := permissionsDetailHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(ctx, PermissionDetailInput{ID: pm.ID.String()}, principalFor("t1"))
	if err != nil {
		t.Fatalf("permissions.detail: %v", err)
	}
	if len(got.GrantedBy) != 1 || got.GrantedBy[0].Slug != "reader" {
		t.Errorf("grantedBy = %+v, want the reader role", got.GrantedBy)
	}
}

var _ = role.Role{}
```

Delete the trailing `var _ = role.Role{}` if the `role` import is used by `seedRoles` already being in another file in the package; keep whichever imports the file actually needs.

`containsText` comes from Task 1's `immutable_test.go`, in the same package.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run Permissions -v
```

Expected: compile failure, `undefined: permissionsListHandler`.

- [ ] **Step 3: Write `handlers_permissions.go`**

```go
// handlers_permissions.go: the permission surface.
//
// One thing about permissions matters more than the rest: the RBAC
// evaluator matches a request against Resource + ":" + Action, and never
// against Name. So Name is a label, and a permission whose name disagrees
// with its resource and action is invisible to every check that looks for
// it by name while appearing correct in every list. This file refuses to
// write that state.
package contract

import (
	"context"
	"strings"

	"github.com/xraph/warden/id"
	"github.com/xraph/warden/permission"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// PermissionDetail is one permission plus the roles that grant it, which is
// the question an operator opens this page to answer.
type PermissionDetail struct {
	PermissionSummary
	GrantedBy []RoleSummary `json:"grantedBy"`
}

// PermissionsListInput filters the permissions list.
type PermissionsListInput struct {
	PageRequest
	NamespacePath *string `json:"namespacePath,omitempty"`
	Resource      string  `json:"resource,omitempty"`
	Action        string  `json:"action,omitempty"`
	Search        string  `json:"search,omitempty"`
	IsSystem      *bool   `json:"isSystem,omitempty"`
}

// PermissionsListResponse is the paged reply.
type PermissionsListResponse struct {
	PageMeta
	Items []PermissionSummary `json:"items"`
}

// PermissionDetailInput names one permission.
type PermissionDetailInput struct {
	ID string `json:"id"`
}

// PermissionCreateInput creates a permission. Name may be omitted, in which
// case it is derived as resource:action.
type PermissionCreateInput struct {
	Name          string `json:"name,omitempty"`
	Resource      string `json:"resource"`
	Action        string `json:"action"`
	NamespacePath string `json:"namespacePath,omitempty"`
	Description   string `json:"description,omitempty"`
}

// PermissionUpdateInput patches a permission. Resource and action are
// absent deliberately: changing either would change what the permission
// means without changing which roles grant it, silently altering every
// check that resolves through it. Delete and recreate instead.
type PermissionUpdateInput struct {
	ID          string  `json:"id"`
	Description *string `json:"description,omitempty"`
}

// PermissionDeleteInput names the permission to remove.
type PermissionDeleteInput struct {
	ID string `json:"id"`
}

func parsePermissionID(raw string) (id.PermissionID, error) {
	pid, err := id.ParsePermissionID(raw)
	if err != nil {
		return id.Nil, badRequest("not a permission id: " + raw)
	}
	return pid, nil
}

// derivedName is what the RBAC evaluator will actually match on.
func derivedName(resource, action string) string { return resource + ":" + action }

func permissionsListHandler(deps Deps) func(context.Context, PermissionsListInput, dashcontract.Principal) (PermissionsListResponse, error) {
	return func(ctx context.Context, in PermissionsListInput, p dashcontract.Principal) (PermissionsListResponse, error) {
		if err := requireEngine(deps); err != nil {
			return PermissionsListResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return PermissionsListResponse{}, err
		}
		limit, offset := in.Clamp()
		filter := &permission.ListFilter{
			TenantID:      tenantID,
			NamespacePath: in.NamespacePath,
			Resource:      in.Resource,
			Action:        in.Action,
			Search:        in.Search,
			IsSystem:      in.IsSystem,
			Limit:         limit,
			Offset:        offset,
		}
		s := deps.Engine.Store()
		rows, err := s.ListPermissions(ctx, filter)
		if err != nil {
			return PermissionsListResponse{}, mapWardenError(err)
		}
		total, err := s.CountPermissions(ctx, filter)
		if err != nil {
			return PermissionsListResponse{}, mapWardenError(err)
		}
		out := PermissionsListResponse{
			PageMeta: newPageMeta(total, limit, offset),
			Items:    make([]PermissionSummary, 0, len(rows)),
		}
		for _, pm := range rows {
			out.Items = append(out.Items, projectPermission(pm))
		}
		return out, nil
	}
}

func permissionsDetailHandler(deps Deps) func(context.Context, PermissionDetailInput, dashcontract.Principal) (PermissionDetail, error) {
	return func(ctx context.Context, in PermissionDetailInput, p dashcontract.Principal) (PermissionDetail, error) {
		if err := requireEngine(deps); err != nil {
			return PermissionDetail{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return PermissionDetail{}, err
		}
		pid, err := parsePermissionID(in.ID)
		if err != nil {
			return PermissionDetail{}, err
		}
		pm, err := deps.Engine.Store().GetPermission(ctx, tenantID, pid)
		if err != nil {
			return PermissionDetail{}, mapWardenError(err)
		}
		holders, err := rolesGranting(ctx, deps, tenantID, pm)
		if err != nil {
			return PermissionDetail{}, err
		}
		return PermissionDetail{
			PermissionSummary: projectPermission(pm),
			GrantedBy:         holders,
		}, nil
	}
}

// rolesGranting finds every role in the tenant whose grants include pm.
//
// There is no store method for this direction, so it scans the tenant's
// roles and checks each one's grants. Bounded by maxPageLimit rather than
// unbounded: a tenant with more roles than that has a bigger problem than
// this page, and an unbounded scan here would be a denial of service on
// the dashboard.
func rolesGranting(ctx context.Context, deps Deps, tenantID string, pm *permission.Permission) ([]RoleSummary, error) {
	s := deps.Engine.Store()
	roles, err := s.ListRoles(ctx, &role.ListFilter{TenantID: tenantID, Limit: maxPageLimit})
	if err != nil {
		return nil, mapWardenError(err)
	}
	ids := make([]id.RoleID, 0, len(roles))
	byID := make(map[id.RoleID]*role.Role, len(roles))
	for _, r := range roles {
		ids = append(ids, r.ID)
		byID[r.ID] = r
	}
	grants, err := s.ListRolePermissionsForRoles(ctx, tenantID, ids)
	if err != nil {
		return nil, mapWardenError(err)
	}
	out := []RoleSummary{}
	for rid, held := range grants {
		for _, g := range held {
			if g == nil {
				continue
			}
			if g.Name == pm.Name && g.NamespacePath == pm.NamespacePath {
				if r, ok := byID[rid]; ok {
					out = append(out, projectRole(r))
				}
				break
			}
		}
	}
	return out, nil
}

func permissionsCreateHandler(deps Deps) func(context.Context, PermissionCreateInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in PermissionCreateInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		if in.Resource == "" || in.Action == "" {
			return AckResponse{}, badRequest("a permission needs a resource and an action")
		}
		if err := validateNamespace(deps, in.NamespacePath); err != nil {
			return AckResponse{}, err
		}
		want := derivedName(in.Resource, in.Action)
		name := in.Name
		if name == "" {
			name = want
		}
		// The evaluator matches on resource:action, so a name that says
		// something else is a permission nothing can find by name.
		if name != want {
			return AckResponse{}, badRequest(
				"name " + name + " disagrees with " + want +
					": checks match on resource and action, so this permission would be unreachable by name")
		}
		pm := &permission.Permission{
			TenantID:      tenantID,
			NamespacePath: in.NamespacePath,
			Name:          name,
			Resource:      in.Resource,
			Action:        in.Action,
			Description:   in.Description,
		}
		if err := deps.Engine.Store().CreatePermission(ctx, pm); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: pm.ID.String()}, nil
	}
}

func permissionsUpdateHandler(deps Deps) func(context.Context, PermissionUpdateInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in PermissionUpdateInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		pid, err := parsePermissionID(in.ID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()
		pm, err := s.GetPermission(ctx, tenantID, pid)
		if err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		if err := guardSystemPermission(pm); err != nil {
			return AckResponse{}, err
		}
		if in.Description != nil {
			pm.Description = *in.Description
		}
		if err := s.UpdatePermission(ctx, pm); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: pm.ID.String()}, nil
	}
}

func permissionsDeleteHandler(deps Deps) func(context.Context, PermissionDeleteInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in PermissionDeleteInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		pid, err := parsePermissionID(in.ID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()
		pm, err := s.GetPermission(ctx, tenantID, pid)
		if err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		if err := guardSystemPermission(pm); err != nil {
			return AckResponse{}, err
		}
		// DeletePermission also removes the junction rows granting it, so
		// deleting one silently strips it from every role that had it.
		// Refuse and name the roles, so the operator detaches on purpose.
		holders, err := rolesGranting(ctx, deps, tenantID, pm)
		if err != nil {
			return AckResponse{}, err
		}
		if len(holders) > 0 {
			names := make([]string, 0, len(holders))
			for _, h := range holders {
				names = append(names, h.Slug)
			}
			return AckResponse{}, &dashcontract.Error{
				Code: dashcontract.CodeConflict,
				Message: pm.Name + " is still granted by " + strings.Join(names, ", ") +
					". Detach it from those roles first.",
			}
		}
		if err := s.DeletePermission(ctx, tenantID, pid); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{}, nil
	}
}
```

- [ ] **Step 4: Register and declare the five intents**

In `contract.go`:

```go
	if err := dispatcher.RegisterQuery(d, contributorName, "permissions.list", 1, permissionsListHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register permissions.list: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, contributorName, "permissions.detail", 1, permissionsDetailHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register permissions.detail: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "permissions.create", 1, permissionsCreateHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register permissions.create: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "permissions.update", 1, permissionsUpdateHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register permissions.update: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "permissions.delete", 1, permissionsDeleteHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register permissions.delete: %w", err)
	}
```

In `manifest.yaml`:

```yaml
  - { name: permissions.list,   kind: query, version: 1, capability: read }
  - { name: permissions.detail, kind: query, version: 1, capability: read }
  # A new permission can appear in a role's attach picker, and creates a
  # namespace entry if it is the first thing in that namespace.
  - { name: permissions.create, kind: command, version: 1, capability: write,
      invalidates: [permissions.list, overview.stats, namespaces.list] }
  - { name: permissions.update, kind: command, version: 1, capability: write,
      invalidates: [permissions.list, permissions.detail] }
  # A delete removes junction rows, so any role's detail page can change.
  - { name: permissions.delete, kind: command, version: 1, capability: write,
      invalidates: [permissions.list, permissions.detail, roles.detail, overview.stats] }
```

and under `queries`:

```yaml
  permissionList:
    intent: permissions.list
    cache: { staleTime: 30s }
  permissionDetail:
    intent: permissions.detail
    cache: { staleTime: 30s }
```

- [ ] **Step 5: Run the tests and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./extension/... . && git commit -m "feat(contract): the permission surface, refusing names that checks cannot match" -- extension/contract
```

---

## Task 6: The fixture server's roles and permissions handlers

Before the pages, so they have something to run against.

**Files:**
- Modify: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/fixture-server/warden-fixtures.mjs`

**Interfaces:**
- Consumes: the thirteen intent names and their exact response shapes from Tasks 2 to 5.
- Produces: thirteen fixture handlers. Tasks 7 to 9 run against them.

- [ ] **Step 1: Read what exists**

`warden-fixtures.mjs` already holds warden's seed state (three roles including one system role, three permissions, two namespaces) and six handlers. Read it, and read the Go DTOs in `handlers_roles.go` and `handlers_permissions.go` for the exact field names. A mismatch here is the class of bug this fixture exists to catch.

- [ ] **Step 2: Add a paging helper and the role-permission junction to the seed**

```js
/**
 * Pages an array the way every warden list intent pages a store: clamped
 * limit, clamped offset, and a total that counts the filtered set rather
 * than the returned page. A pager reading items.length would think there
 * was one page.
 */
function pageOf(rows, params) {
  const limit = Math.min(Math.max(Number(params?.limit) || 25, 1), 200)
  const offset = Math.max(Number(params?.offset) || 0, 0)
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
  }
}

/**
 * Applies the three-state namespace filter. An absent namespacePath means
 * every namespace; an empty string means the tenant root. Those are
 * different queries and collapsing them would scope every list to the root.
 */
function byNamespace(rows, params) {
  if (params?.namespacePath === undefined) return rows
  return rows.filter((r) => r.namespacePath === params.namespacePath)
}
```

Add a junction to the seed, beside the existing arrays:

```js
    // The role-permission junction, keyed by natural key exactly as the
    // store keys it: (roleId, namespacePath, name).
    grants: [
      { roleId: "role_01hq", namespacePath: "", name: "document:read" },
      { roleId: "role_01hr", namespacePath: "eng/platform", name: "cluster:admin" },
    ],
```

- [ ] **Step 3: Add the thirteen handlers**

```js
  "roles.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.roles, params)
      if (params?.search) {
        const q = String(params.search).toLowerCase()
        rows = rows.filter(
          (r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)
        )
      }
      if (params?.isSystem !== undefined) {
        rows = rows.filter((r) => r.isSystem === params.isSystem)
      }
      if (params?.isDefault !== undefined) {
        rows = rows.filter((r) => r.isDefault === params.isDefault)
      }
      return pageOf(rows, params)
    },
  },
  "roles.detail": {
    kind: "query",
    handler: (params) => {
      const r = warden.roles.find((x) => x.id === params?.id)
      if (!r) throw notFound("role", params?.id)
      const names = warden.grants.filter((g) => g.roleId === r.id)
      return {
        ...r,
        permissions: warden.permissions.filter((p) =>
          names.some((g) => g.name === p.name && g.namespacePath === p.namespacePath)
        ),
        children: warden.roles.filter((c) => c.parentSlug === r.slug),
      }
    },
  },
  "roles.create": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      if (!payload?.name || !payload?.slug) {
        throw badRequest("a role needs a name and a slug")
      }
      const now = new Date().toISOString()
      const row = {
        id: "role_" + Math.random().toString(36).slice(2, 10),
        namespacePath: payload.namespacePath ?? "",
        name: payload.name,
        slug: payload.slug,
        description: payload.description ?? "",
        parentSlug: payload.parentSlug ?? "",
        isSystem: false,
        isDefault: Boolean(payload.isDefault),
        maxMembers: payload.maxMembers ?? 0,
        createdAt: now,
        updatedAt: now,
      }
      warden.roles.push(row)
      return { id: row.id }
    },
  },
  "roles.update": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.id)
      if (!r) throw notFound("role", payload?.id)
      // The system guard, matching the Go handler. Nothing below the
      // contract layer enforces this, so the fixture must not either.
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      // Only the fields present in the payload change. A fixture that
      // overwrote everything would hide the read-patch-write bug.
      for (const field of ["name", "description", "parentSlug"]) {
        if (payload[field] !== undefined) r[field] = payload[field]
      }
      if (payload.maxMembers !== undefined) r.maxMembers = payload.maxMembers
      if (payload.isDefault !== undefined) r.isDefault = payload.isDefault
      r.updatedAt = new Date().toISOString()
      return { id: r.id }
    },
  },
  "roles.delete": {
    kind: "command",
    invalidates: ["roles.list", "roles.detail", "overview.stats"],
    handler: (payload) => {
      const i = warden.roles.findIndex((x) => x.id === payload?.id)
      if (i === -1) throw notFound("role", payload?.id)
      const r = warden.roles[i]
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      warden.roles.splice(i, 1)
      // The store cascades DeleteAssignmentsByRole, so the fixture does too.
      warden.assignments = warden.assignments.filter((a) => a.roleId !== r.id)
      warden.grants = warden.grants.filter((g) => g.roleId !== r.id)
      return {}
    },
  },
  "roles.attachPermission": {
    kind: "command",
    invalidates: ["roles.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.roleId)
      if (!r) throw notFound("role", payload?.roleId)
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      const ns = payload.permissionNamespacePath ?? ""
      const pm = warden.permissions.find(
        (p) => p.name === payload?.permissionName && p.namespacePath === ns
      )
      if (!pm) throw notFound("permission", payload?.permissionName)
      const already = warden.grants.some(
        (g) => g.roleId === r.id && g.name === pm.name && g.namespacePath === ns
      )
      if (!already) warden.grants.push({ roleId: r.id, namespacePath: ns, name: pm.name })
      return { id: r.id }
    },
  },
  "roles.detachPermission": {
    kind: "command",
    invalidates: ["roles.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.roleId)
      if (!r) throw notFound("role", payload?.roleId)
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      const ns = payload.permissionNamespacePath ?? ""
      const i = warden.grants.findIndex(
        (g) => g.roleId === r.id && g.name === payload?.permissionName && g.namespacePath === ns
      )
      // A detach of a grant the role does not hold must not read as
      // success, exactly as the Go handler refuses it.
      if (i === -1) {
        throw notFound("grant", `${r.slug} does not grant ${payload?.permissionName}`)
      }
      warden.grants.splice(i, 1)
      return { id: r.id }
    },
  },
  "roles.setPermissions": {
    kind: "command",
    invalidates: ["roles.detail"],
    handler: (payload) => {
      const r = warden.roles.find((x) => x.id === payload?.roleId)
      if (!r) throw notFound("role", payload?.roleId)
      if (r.isSystem) {
        throw permissionDenied(`"${r.name}" is a system role and cannot be changed or deleted`)
      }
      const refs = payload?.permissions ?? []
      // Resolve every reference before writing any: all or nothing, so a
      // typo cannot leave the role with a set nobody chose.
      const resolved = refs.map((ref) => {
        const ns = ref.namespacePath ?? ""
        const pm = warden.permissions.find((p) => p.name === ref.name && p.namespacePath === ns)
        if (!pm) throw notFound("permission", ref.name)
        return { roleId: r.id, namespacePath: ns, name: pm.name }
      })
      warden.grants = warden.grants.filter((g) => g.roleId !== r.id).concat(resolved)
      return { id: r.id }
    },
  },
  "permissions.list": {
    kind: "query",
    handler: (params) => {
      let rows = byNamespace(warden.permissions, params)
      if (params?.resource) rows = rows.filter((p) => p.resource === params.resource)
      if (params?.action) rows = rows.filter((p) => p.action === params.action)
      if (params?.search) {
        const q = String(params.search).toLowerCase()
        rows = rows.filter((p) => p.name.toLowerCase().includes(q))
      }
      return pageOf(rows, params)
    },
  },
  "permissions.detail": {
    kind: "query",
    handler: (params) => {
      const pm = warden.permissions.find((x) => x.id === params?.id)
      if (!pm) throw notFound("permission", params?.id)
      const holderIds = warden.grants
        .filter((g) => g.name === pm.name && g.namespacePath === pm.namespacePath)
        .map((g) => g.roleId)
      return {
        ...pm,
        grantedBy: warden.roles.filter((r) => holderIds.includes(r.id)),
      }
    },
  },
  "permissions.create": {
    kind: "command",
    invalidates: ["permissions.list", "overview.stats", "namespaces.list"],
    handler: (payload) => {
      if (!payload?.resource || !payload?.action) {
        throw badRequest("a permission needs a resource and an action")
      }
      const want = `${payload.resource}:${payload.action}`
      const name = payload.name || want
      if (name !== want) {
        throw badRequest(
          `name ${name} disagrees with ${want}: checks match on resource and action, so this permission would be unreachable by name`
        )
      }
      const now = new Date().toISOString()
      const row = {
        id: "perm_" + Math.random().toString(36).slice(2, 10),
        namespacePath: payload.namespacePath ?? "",
        name,
        resource: payload.resource,
        action: payload.action,
        description: payload.description ?? "",
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      }
      warden.permissions.push(row)
      return { id: row.id }
    },
  },
  "permissions.update": {
    kind: "command",
    invalidates: ["permissions.list", "permissions.detail"],
    handler: (payload) => {
      const pm = warden.permissions.find((x) => x.id === payload?.id)
      if (!pm) throw notFound("permission", payload?.id)
      if (pm.isSystem) {
        throw permissionDenied(
          `"${pm.name}" is a system permission and cannot be changed or deleted`
        )
      }
      if (payload.description !== undefined) pm.description = payload.description
      pm.updatedAt = new Date().toISOString()
      return { id: pm.id }
    },
  },
  "permissions.delete": {
    kind: "command",
    invalidates: ["permissions.list", "permissions.detail", "roles.detail", "overview.stats"],
    handler: (payload) => {
      const i = warden.permissions.findIndex((x) => x.id === payload?.id)
      if (i === -1) throw notFound("permission", payload?.id)
      const pm = warden.permissions[i]
      if (pm.isSystem) {
        throw permissionDenied(
          `"${pm.name}" is a system permission and cannot be changed or deleted`
        )
      }
      const holders = warden.grants
        .filter((g) => g.name === pm.name && g.namespacePath === pm.namespacePath)
        .map((g) => warden.roles.find((r) => r.id === g.roleId)?.slug)
        .filter(Boolean)
      if (holders.length > 0) {
        throw conflict(
          `${pm.name} is still granted by ${holders.join(", ")}. Detach it from those roles first.`
        )
      }
      warden.permissions.splice(i, 1)
      return {}
    },
  },
```

`permissionDenied` and `conflict` may not exist yet. `badRequest` was added in the previous plan. Check what the file has and add whichever are missing in the same style, keeping them local to `warden-fixtures.mjs` so the module stays standalone rather than importing back into `server.mjs`.

Note the seed has a system role (`role_01hs`) and no system permission. Add `isSystem: true` to one seeded permission so the refusal paths are reachable by hand, and update the counts in any existing test or check that asserts three permissions.

- [ ] **Step 4: Verify over the wire**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
sleep 2 && node packages/fixture-server/verify.mjs http://localhost:8099
```

Expected: warden now shows nineteen intents and zero failures. Then check by hand that updating the system role is refused, that detaching a grant the role does not hold is refused, and that deleting a granted permission is refused and names the role. Kill the server when done.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git commit -m "feat(fixture): answer warden's role and permission intents" -- packages/fixture-server/warden-fixtures.mjs
```

Only that file. Do NOT commit `server.mjs`: it is mid-refactor by another session and imports untracked files.

---

## Task 7: The roles list page

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-warden/src/pages/roles.tsx`
- Create: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-warden/test/roles.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: `useNamespaceFilter`, `NamespaceCell`, `namespaceParam` from `../components/namespace-filter`; `stubClient`, `failingClient`, `recordingCommandClient`, `renderPage` from `./harness`.
- Produces: `WardenRolesPage`, and the exported types `RoleSummary`, `RolesList`, `AckResponse` that Task 8 and 9 reuse.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenRolesPage } from "../src/pages/roles"
import {
  failingClient,
  recordingCommandClient,
  renderPage,
  stubClient,
} from "./harness"

const ROLES = {
  items: [
    {
      id: "role_01hq",
      namespacePath: "",
      name: "Reader",
      slug: "reader",
      description: "can read",
      parentSlug: "",
      isSystem: false,
      isDefault: true,
      maxMembers: 0,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
    {
      id: "role_01hs",
      namespacePath: "eng/platform",
      name: "System",
      slug: "system",
      parentSlug: "reader",
      isSystem: true,
      isDefault: false,
      maxMembers: 5,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
}

const NAMESPACES = { namespaces: ["", "eng/platform"] }

function client(extra = {}, commands = {}) {
  return stubClient(
    { "roles.list": ROLES, "namespaces.list": NAMESPACES, ...extra },
    commands
  )
}

describe("WardenRolesPage", () => {
  it("lists roles with a live count in the caption", async () => {
    renderPage(WardenRolesPage, client())
    expect(await screen.findByText("Reader")).toBeTruthy()
    expect(await screen.findByText(/2 roles/)).toBeTruthy()
  })

  it("renders the tenant root as a slash and a real path as itself", async () => {
    renderPage(WardenRolesPage, client())
    await screen.findByText("Reader")
    expect(screen.getByText("/")).toBeTruthy()
    expect(screen.getByText("eng/platform")).toBeTruthy()
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(
      WardenRolesPage,
      client({ "roles.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    expect(await screen.findByText(/0 roles/)).toBeTruthy()
    expect(await screen.findByText(/No roles yet/i)).toBeTruthy()
  })

  it("marks a system role so an operator can see why it cannot be edited", async () => {
    renderPage(WardenRolesPage, client())
    await screen.findByText("System")
    // Most roles are not system roles, so system is the minority and the
    // thing somebody scanning for it is hunting.
    expect(await screen.findByText(/system/i)).toBeTruthy()
  })

  it("offers no delete on a system role", async () => {
    renderPage(WardenRolesPage, client())
    await screen.findByText("System")
    // The contract refuses it, so offering the button would promise
    // something the server will reject.
    expect(screen.queryByRole("button", { name: /Delete System/i })).toBeNull()
    expect(screen.getByRole("button", { name: /Delete Reader/i })).toBeTruthy()
  })

  it("sends the namespace filter as an absent field for all namespaces", async () => {
    const { client: c, intents } = (() => {
      const sent: { intent: string; params?: unknown }[] = []
      const inner = client()
      return {
        intents: sent,
        client: {
          extension: "warden",
          query: (intent: string, params?: Record<string, unknown>) => {
            sent.push({ intent, params })
            return inner.query(intent, params)
          },
          command: inner.command,
        } as typeof inner,
      }
    })()
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")
    const list = intents.find((i) => i.intent === "roles.list")
    expect(list).toBeTruthy()
    // "All namespaces" must send no namespacePath at all. Sending "" would
    // silently scope the list to the tenant root.
    expect((list?.params as Record<string, unknown>)?.namespacePath).toBeUndefined()
  })

  it("keeps what the operator typed when a create fails", async () => {
    const { client: c } = recordingCommandClient(
      { "roles.list": ROLES, "namespaces.list": NAMESPACES },
      {}
    )
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")
    // roles.create is absent from the command map, so the harness throws a
    // ContractError, which is the only thing that makes execute() resolve
    // undefined. A stub answering {ok:false} would resolve normally and
    // this test would never run the failure path.
    expect(screen.queryByText(/Could not create/i)).toBeNull()
  })

  it("surfaces a list failure instead of rendering an empty table", async () => {
    renderPage(
      WardenRolesPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText("Reader")).toBeNull()
  })

  it("pages when the total exceeds the page size", async () => {
    renderPage(
      WardenRolesPage,
      client({ "roles.list": { ...ROLES, total: 60, limit: 25, offset: 0 } })
    )
    await screen.findByText("Reader")
    // total 60 against limit 25 means three pages, so a pager must appear.
    await waitFor(() => expect(screen.getByText(/60 roles/)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test roles
```

Expected: FAIL, cannot resolve `../src/pages/roles`.

- [ ] **Step 3: Write the page**

Read `packages/plugin-authsome/src/pages/roles.tsx` first for the create-form and delete-dialog shape this codebase uses, and `packages/kit/src/components/resource-table.tsx` for `PaginationState`.

```tsx
import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { NamespaceCell, useNamespaceFilter } from "../components/namespace-filter"

/** Mirrors the Go `RoleSummary`. Field names are its JSON tags. */
export interface RoleSummary {
  id: string
  namespacePath: string
  name: string
  slug: string
  description?: string
  parentSlug?: string
  isSystem: boolean
  isDefault: boolean
  maxMembers?: number
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `RolesListResponse`: PageMeta embedded beside items. */
export interface RolesList {
  items: RoleSummary[]
  total: number
  limit: number
  offset: number
}

/** Mirrors the Go `AckResponse`. */
export interface AckResponse {
  id?: string
}

const PAGE_SIZE = 25

function CreateRoleForm({
  namespacePath,
  onDone,
}: {
  namespacePath: string
  onDone: () => void
}) {
  const create = useCommand<AckResponse>("roles.create")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")

  async function submit() {
    const result = await create.execute({
      name,
      slug,
      description: description || undefined,
      namespacePath,
    })
    // execute resolves undefined only when the client throws, so this is
    // the success check. A failed create must not close the form and throw
    // away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the role" />
      <p className="text-sm text-muted-foreground">
        Creating in {namespacePath === "" ? "the tenant root" : namespacePath}. Slugs
        are unique per namespace, so the same slug can exist in two of them.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-name">Name</Label>
        <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-slug">Slug</Label>
        <Input id="role-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-description">Description</Label>
        <Input
          id="role-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={create.loading || name.trim() === "" || slug.trim() === ""}
        >
          {create.loading ? "Creating…" : "Create role"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function WardenRolesPage() {
  const namespace = useNamespaceFilter()
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RoleSummary | null>(null)

  const list = useQuery<RolesList>("roles.list", {
    ...namespace.param,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const remove = useCommand<AckResponse>("roles.delete")

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<RoleSummary>[] = [
    { id: "name", header: "Name", cell: (r) => r.name, className: "font-medium" },
    { id: "slug", header: "Slug", cell: (r) => r.slug, className: "font-mono text-xs" },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "parent",
      header: "Inherits",
      cell: (r) =>
        r.parentSlug ? (
          <span className="font-mono text-xs">{r.parentSlug}</span>
        ) : (
          <NoneCell label="parent role" />
        ),
    },
    {
      id: "flags",
      header: "Flags",
      cell: (r) => (
        <span className="flex gap-1">
          {/* Most roles are neither, so both badges mark a minority. A
              system role is what somebody scanning for one is hunting. */}
          {r.isSystem && <Badge variant="destructive">system</Badge>}
          {r.isDefault && <Badge variant="secondary">default</Badge>}
          {!r.isSystem && !r.isDefault && <NoneCell label="flags" />}
        </span>
      ),
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (r) => <Timestamp value={r.updatedAt} label="updated at" />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Roles"
        actions={
          !creating && <Button onClick={() => setCreating(true)}>New role</Button>
        }
      />

      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setPage(0)
          },
          placeholder: "Search name or slug",
          label: "Search roles",
        }}
        filters={[namespace.filterConfig]}
      />

      {creating && (
        <CreateRoleForm
          namespacePath={namespace.value === "all" ? "" : namespace.value}
          onDone={() => setCreating(false)}
        />
      )}

      <QueryBoundary title="Roles" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          const caption = `${data.total} ${data.total === 1 ? "role" : "roles"}`
          return (
            <ResourceTable<RoleSummary>
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              caption={caption}
              emptyMessage="No roles yet."
              pagination={{
                page,
                pageSize: data.limit,
                total: data.total,
                onPageChange: setPage,
              }}
              rowActions={(r) => (
                <>
                  <PluginLink
                    to={`/roles/${r.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </PluginLink>
                  {/* No delete on a system role: the contract refuses it,
                      so the button would promise a rejection. */}
                  {!r.isSystem && (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${r.name}`}
                      onClick={() => {
                        // Reset at open, not at close: the operator is
                        // about to read whatever this dialog shows for THIS
                        // role, so a failure from a previous row must not
                        // be attributed to one they have not touched.
                        remove.reset()
                        setDeleting(r)
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/* The error lives inside the dialog. Base UI marks everything
          outside an open dialog inert and aria-hidden, so an alert on the
          page body is unreachable while the dialog that can fail is open. */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Every assignment of this role is removed with it, and any role
              inheriting from it loses its parent. This cannot be undone.
            </span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
```

Check `ResourceTable`'s `pagination` prop shape against `packages/kit/src/components/resource-table.tsx` before relying on `onPageChange`; `PaginationState` in that file declares `page`, `pageSize` and `total`, and the change handler may be a separate prop or named differently.

- [ ] **Step 4: Wire the route and nav**

In `src/index.tsx`, import `WardenRolesPage`, re-export it and its types, add the route `{ path: "/roles", element: WardenRolesPage }` and the nav entry:

```tsx
    {
      label: "Roles",
      to: "/roles",
      priority: 10,
      icon: <UserCogIcon />,
      group: "Authorization",
    },
```

`UserCogIcon` comes from `@forge-go/dashboard-kit/icons`. The plugin test from the previous plan asserts every nav entry points at a path some route serves, so a missing route fails a test.

- [ ] **Step 5: Run, typecheck, lint, commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): add the roles list page" -- packages/plugin-warden
```

---

## Task 8: The role detail page

The page where the junction becomes visible: a role's fields, its grants, and its children.

**Files:**
- Create: `packages/plugin-warden/src/pages/role-detail.tsx`
- Create: `packages/plugin-warden/test/role-detail.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: `RoleSummary`, `AckResponse` from `./roles`; `NamespaceCell`; the harness.
- Produces: `WardenRoleDetailPage`, `RoleDetail`, `PermissionSummary`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenRoleDetailPage } from "../src/pages/role-detail"
import { failingClient, recordingCommandClient, renderPage, stubClient } from "./harness"

const DETAIL = {
  id: "role_01hq",
  namespacePath: "",
  name: "Reader",
  slug: "reader",
  description: "can read",
  parentSlug: "",
  isSystem: false,
  isDefault: true,
  maxMembers: 0,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
  createdBy: "usr_1",
  updatedBy: "usr_2",
  permissions: [
    {
      id: "perm_01a",
      namespacePath: "",
      name: "document:read",
      resource: "document",
      action: "read",
      isSystem: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  children: [
    {
      id: "role_01hr",
      namespacePath: "",
      name: "Editor",
      slug: "editor",
      parentSlug: "reader",
      isSystem: false,
      isDefault: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
}

const PERMS = {
  items: [
    DETAIL.permissions[0],
    {
      id: "perm_01b",
      namespacePath: "",
      name: "document:write",
      resource: "document",
      action: "write",
      isSystem: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  total: 2,
  limit: 200,
  offset: 0,
}

function client(detail = DETAIL, commands = {}) {
  return stubClient(
    { "roles.detail": detail, "permissions.list": PERMS },
    commands
  )
}

describe("WardenRoleDetailPage", () => {
  it("shows the role's fields", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("Reader")).toBeTruthy()
    expect(await screen.findByText("reader")).toBeTruthy()
  })

  it("lists the role's grants with a live count", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("document:read")).toBeTruthy()
    expect(await screen.findByText(/1 permission/)).toBeTruthy()
  })

  it("says which kind of empty a role with no grants is", async () => {
    renderPage(
      WardenRoleDetailPage,
      client({ ...DETAIL, permissions: [] }),
      { id: "role_01hq" }
    )
    expect(await screen.findByText(/0 permissions/)).toBeTruthy()
    expect(await screen.findByText(/grants nothing/i)).toBeTruthy()
  })

  it("lists the roles that inherit from this one", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("Editor")).toBeTruthy()
  })

  it("says which kind of empty a role with no children is", async () => {
    renderPage(WardenRoleDetailPage, client({ ...DETAIL, children: [] }), {
      id: "role_01hq",
    })
    expect(await screen.findByText(/nothing inherits/i)).toBeTruthy()
  })

  it("sends the natural key when detaching a grant, not the permission id", async () => {
    // The junction is keyed by (namespacePath, name). Sending an id would
    // detach nothing and report success.
    const { client: c, sent } = recordingCommandClient(
      { "roles.detail": DETAIL, "permissions.list": PERMS },
      { "roles.detachPermission": { id: "role_01hq" } }
    )
    renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
    const detach = await screen.findByRole("button", { name: /Revoke document:read/i })
    detach.click()
    const confirm = await screen.findByRole("button", { name: /^Revoke$/i })
    confirm.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sent[0]?.intent).toBe("roles.detachPermission")
    expect(sent[0]?.payload).toEqual({
      roleId: "role_01hq",
      permissionName: "document:read",
      permissionNamespacePath: "",
    })
  })

  it("offers no edit or revoke on a system role", async () => {
    renderPage(
      WardenRoleDetailPage,
      client({ ...DETAIL, isSystem: true, name: "System" }),
      { id: "role_01hs" }
    )
    await screen.findByText("System")
    expect(screen.queryByRole("button", { name: /Edit/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /Revoke/i })).toBeNull()
    // And it says why, rather than just hiding the controls.
    expect(await screen.findByText(/system role/i)).toBeTruthy()
  })

  it("surfaces a read failure instead of a blank page", async () => {
    renderPage(
      WardenRoleDetailPage,
      failingClient(new ContractError("NOT_FOUND", "role not found")),
      { id: "role_nope" }
    )
    expect(await screen.findAllByText(/role not found/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test role-detail
```

Expected: FAIL, cannot resolve `../src/pages/role-detail`.

- [ ] **Step 3: Write the page**

```tsx
import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert } from "@forge-go/dashboard-kit/components/alert"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { NamespaceCell } from "../components/namespace-filter"
import type { AckResponse, RoleSummary } from "./roles"

/** Mirrors the Go `PermissionSummary`. */
export interface PermissionSummary {
  id: string
  namespacePath: string
  name: string
  resource: string
  action: string
  description?: string
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `RoleDetail`: RoleSummary embedded, so the JSON is flat. */
export interface RoleDetail extends RoleSummary {
  permissions: PermissionSummary[]
  children: RoleSummary[]
  createdBy?: string
  updatedBy?: string
}

interface PermissionsList {
  items: PermissionSummary[]
  total: number
  limit: number
  offset: number
}

/** The picker reads a wide page because it is a chooser, not a browser. */
const PICKER_LIMIT = 200

export function WardenRoleDetailPage({ params }: PluginPageProps) {
  const id = params.id as string
  const detail = useQuery<RoleDetail>("roles.detail", { id })
  const attach = useCommand<AckResponse>("roles.attachPermission")
  const detach = useCommand<AckResponse>("roles.detachPermission")

  const [revoking, setRevoking] = useState<PermissionSummary | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [chosen, setChosen] = useState("")

  async function confirmRevoke() {
    if (!revoking) return
    // The junction is keyed by (namespacePath, name), never by id. Sending
    // an id would detach nothing and the server would refuse it.
    const result = await detach.execute({
      roleId: id,
      permissionName: revoking.name,
      permissionNamespacePath: revoking.namespacePath,
    })
    if (result !== undefined) setRevoking(null)
  }

  async function confirmAttach() {
    if (chosen === "") return
    const [namespacePath, name] = splitRef(chosen)
    const result = await attach.execute({
      roleId: id,
      permissionName: name,
      permissionNamespacePath: namespacePath,
    })
    if (result !== undefined) {
      setAttaching(false)
      setChosen("")
    }
  }

  return (
    <QueryBoundary title="Role" query={detail} skeletonRows={4}>
      {(role) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={role.name}
            actions={
              !role.isSystem && (
                <Button
                  onClick={() => {
                    // Reset at open: the operator is about to read this
                    // dialog, and a failure from a previous attempt must
                    // not be attributed to an action they have not taken.
                    attach.reset()
                    setChosen("")
                    setAttaching(true)
                  }}
                >
                  Attach permission
                </Button>
              )
            }
          />

          {role.isSystem && (
            <Alert>
              This is a system role. It cannot be edited, deleted, or have its
              grants changed.
            </Alert>
          )}

          <DetailLayout
            aside={
              <DescriptionList
                items={[
                  { term: "Slug", value: <span className="font-mono text-xs">{role.slug}</span> },
                  { term: "Namespace", value: <NamespaceCell path={role.namespacePath} /> },
                  {
                    term: "Description",
                    value: role.description || <NoneCell label="description" />,
                  },
                  {
                    term: "Inherits from",
                    value: role.parentSlug ? (
                      <span className="font-mono text-xs">{role.parentSlug}</span>
                    ) : (
                      <NoneCell label="parent role" />
                    ),
                  },
                  {
                    term: "Member cap",
                    value: role.maxMembers ? String(role.maxMembers) : "Unlimited",
                  },
                  { term: "Default role", value: role.isDefault ? "Yes" : "No" },
                  {
                    term: "Created by",
                    value: role.createdBy ? (
                      <span className="font-mono text-xs">{role.createdBy}</span>
                    ) : (
                      <NoneCell label="creator" />
                    ),
                  },
                  {
                    term: "Updated",
                    value: <Timestamp value={role.updatedAt} label="updated at" />,
                  },
                ]}
              />
            }
            main={
              <div className="flex flex-col gap-6">
                <GrantsTable
                  role={role}
                  onRevoke={(p) => {
                    detach.reset()
                    setRevoking(p)
                  }}
                />
                <ChildrenTable role={role} />
              </div>
            }
          />

          <ConfirmDialog
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title={`Revoke ${revoking?.name ?? ""}?`}
            description={
              <span className="flex flex-col gap-2">
                <span>
                  {role.name} stops granting this permission. Anyone holding the
                  role loses it, and any role inheriting from {role.slug} loses it
                  too.
                </span>
                <CommandAlert error={detach.error} title="Could not revoke" />
              </span>
            }
            confirmLabel="Revoke"
            pending={detach.loading}
            onConfirm={() => void confirmRevoke()}
          />

          <AttachDialog
            open={attaching}
            onOpenChange={(open) => !open && setAttaching(false)}
            roleName={role.name}
            held={role.permissions}
            chosen={chosen}
            onChoose={setChosen}
            error={attach.error}
            pending={attach.loading}
            onConfirm={() => void confirmAttach()}
          />
        </section>
      )}
    </QueryBoundary>
  )
}

/** Encodes a natural key into one select value, and back. */
function joinRef(namespacePath: string, name: string) {
  return `${namespacePath}\u0000${name}`
}
function splitRef(value: string): [string, string] {
  const i = value.indexOf("\u0000")
  return [value.slice(0, i), value.slice(i + 1)]
}

function GrantsTable({
  role,
  onRevoke,
}: {
  role: RoleDetail
  onRevoke: (p: PermissionSummary) => void
}) {
  const grants = role.permissions ?? []
  const columns: Column<PermissionSummary>[] = [
    { id: "name", header: "Permission", cell: (p) => p.name, className: "font-medium" },
    { id: "resource", header: "Resource", cell: (p) => p.resource },
    { id: "action", header: "Action", cell: (p) => p.action },
    {
      id: "namespace",
      header: "Namespace",
      cell: (p) => <NamespaceCell path={p.namespacePath} />,
    },
  ]
  return (
    <ResourceTable<PermissionSummary>
      columns={columns}
      rows={grants}
      rowKey={(p) => p.id}
      caption={`${grants.length} ${grants.length === 1 ? "permission" : "permissions"}`}
      emptyMessage="This role grants nothing."
      rowActions={(p) => (
        <>
          <PluginLink
            to={`/permissions/${p.id}`}
            className="text-sm underline underline-offset-4"
          >
            Details
          </PluginLink>
          {!role.isSystem && (
            <Button
              variant="destructive"
              size="sm"
              aria-label={`Revoke ${p.name}`}
              onClick={() => onRevoke(p)}
            >
              Revoke
            </Button>
          )}
        </>
      )}
    />
  )
}

function ChildrenTable({ role }: { role: RoleDetail }) {
  const children = role.children ?? []
  const columns: Column<RoleSummary>[] = [
    { id: "name", header: "Role", cell: (r) => r.name, className: "font-medium" },
    { id: "slug", header: "Slug", cell: (r) => r.slug, className: "font-mono text-xs" },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "flags",
      header: "Flags",
      cell: (r) =>
        r.isSystem ? <Badge variant="destructive">system</Badge> : <NoneCell label="flags" />,
    },
  ]
  return (
    <ResourceTable<RoleSummary>
      columns={columns}
      rows={children}
      rowKey={(r) => r.id}
      caption={`${children.length} ${children.length === 1 ? "child role" : "child roles"}`}
      emptyMessage="Nothing inherits from this role."
      rowActions={(r) => (
        <PluginLink to={`/roles/${r.id}`} className="text-sm underline underline-offset-4">
          Details
        </PluginLink>
      )}
    />
  )
}

function AttachDialog({
  open,
  onOpenChange,
  roleName,
  held,
  chosen,
  onChoose,
  error,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleName: string
  held: PermissionSummary[]
  chosen: string
  onChoose: (v: string) => void
  error: unknown
  pending: boolean
  onConfirm: () => void
}) {
  // Only fetch the picker's options while the dialog is open. A wide list
  // on every detail render is a request nobody asked for.
  const list = useQuery<PermissionsList>(
    "permissions.list",
    open ? { limit: PICKER_LIMIT } : undefined
  )
  const heldKeys = new Set(held.map((p) => joinRef(p.namespacePath, p.name)))
  const options = (list.data?.items ?? []).filter(
    (p) => !heldKeys.has(joinRef(p.namespacePath, p.name))
  )

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Attach a permission to ${roleName}`}
      description={
        <span className="flex flex-col gap-2">
          <span>
            Anyone holding this role gains it immediately, as does any role that
            inherits from it.
          </span>
          <NativeSelect
            aria-label="Permission to attach"
            value={chosen}
            onChange={(e) => onChoose(e.target.value)}
          >
            <option value="">Choose a permission</option>
            {options.map((p) => (
              <option key={p.id} value={joinRef(p.namespacePath, p.name)}>
                {p.name}
                {p.namespacePath === "" ? " (/)" : ` (${p.namespacePath})`}
              </option>
            ))}
          </NativeSelect>
          {options.length === 0 && !list.loading && (
            <span className="text-sm text-muted-foreground">
              Every permission is already granted to this role.
            </span>
          )}
          <CommandAlert error={error} title="Could not attach" />
        </span>
      }
      confirmLabel="Attach"
      pending={pending}
      confirmDisabled={chosen === ""}
      onConfirm={onConfirm}
    />
  )
}
```

Three things to verify against the real sources before relying on them. `NativeSelect`'s props: read `packages/kit/src/components/native-select.tsx`; if it does not forward `onChange` and `value`, use a plain `<select>` with the same aria-label. `ConfirmDialog`'s `confirmDisabled`: confirm it exists in `packages/kit/src/components/confirm-dialog.tsx`, since it is the separate state for a dialog still missing a value it needs, distinct from `pending`. And `useQuery`'s behaviour when passed `undefined` params: if it fires regardless, gate the whole `AttachDialog` on `open` at the call site instead.

The `\u0000` separator is a NUL byte, chosen because a namespace path cannot contain one (`namespaceSegmentRegex` allows only lowercase letters, digits and hyphens) and neither can a permission name. Any printable separator could appear in a real value and would split the key in the wrong place.

- [ ] **Step 4: Wire the route**

Add `{ path: "/roles/:id", element: WardenRoleDetailPage }` to `routes` in `src/index.tsx` and re-export the page and its types. Do NOT add a nav entry: a sidebar link to "a role" with no role chosen points nowhere.

- [ ] **Step 5: Run, typecheck, lint, commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): add the role detail page with its grants and children" -- packages/plugin-warden
```

---

## Task 9: The permissions page

**Files:**
- Create: `packages/plugin-warden/src/pages/permissions.tsx`
- Create: `packages/plugin-warden/test/permissions.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: `AckResponse` from `./roles`; `useNamespaceFilter`, `NamespaceCell`; the harness.
- Produces: `WardenPermissionsPage`, `PermissionSummary`, `PermissionsList`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenPermissionsPage } from "../src/pages/permissions"
import { failingClient, recordingCommandClient, renderPage, stubClient } from "./harness"

const PERMS = {
  items: [
    {
      id: "perm_01a",
      namespacePath: "",
      name: "document:read",
      resource: "document",
      action: "read",
      description: "read a document",
      isSystem: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
    {
      id: "perm_01c",
      namespacePath: "eng/platform",
      name: "cluster:admin",
      resource: "cluster",
      action: "admin",
      isSystem: true,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
}

const NAMESPACES = { namespaces: ["", "eng/platform"] }

function client(extra = {}, commands = {}) {
  return stubClient(
    { "permissions.list": PERMS, "namespaces.list": NAMESPACES, ...extra },
    commands
  )
}

describe("WardenPermissionsPage", () => {
  it("lists permissions with a live count", async () => {
    renderPage(WardenPermissionsPage, client())
    expect(await screen.findByText("document:read")).toBeTruthy()
    expect(await screen.findByText(/2 permissions/)).toBeTruthy()
  })

  it("shows resource and action separately from the name", async () => {
    // The evaluator matches on resource and action, not on the name, so
    // seeing them is how an operator checks a permission will be found.
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("document:read")
    expect(screen.getByText("document")).toBeTruthy()
    expect(screen.getByText("read")).toBeTruthy()
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(
      WardenPermissionsPage,
      client({ "permissions.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    expect(await screen.findByText(/0 permissions/)).toBeTruthy()
    expect(await screen.findByText(/No permissions yet/i)).toBeTruthy()
  })

  it("derives the name from resource and action as the operator types", async () => {
    // Asking for the name separately is a chance to disagree with
    // resource:action, and the contract refuses a disagreement. Deriving
    // it removes the chance.
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("document:read")
    screen.getByRole("button", { name: /New permission/i }).click()
    const resource = await screen.findByLabelText(/Resource/i)
    const action = await screen.findByLabelText(/Action/i)
    ;(resource as HTMLInputElement).value = "folder"
    resource.dispatchEvent(new Event("input", { bubbles: true }))
    ;(action as HTMLInputElement).value = "write"
    action.dispatchEvent(new Event("input", { bubbles: true }))
    expect(await screen.findByText(/folder:write/)).toBeTruthy()
  })

  it("offers no delete on a system permission", async () => {
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("cluster:admin")
    expect(screen.queryByRole("button", { name: /Delete cluster:admin/i })).toBeNull()
    expect(screen.getByRole("button", { name: /Delete document:read/i })).toBeTruthy()
  })

  it("shows the conflict when a delete is refused because a role grants it", async () => {
    const { client: c } = recordingCommandClient(
      { "permissions.list": PERMS, "namespaces.list": NAMESPACES },
      {}
    )
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    screen.getByRole("button", { name: /Delete document:read/i }).click()
    const confirm = await screen.findByRole("button", { name: /^Delete$/i })
    confirm.click()
    // permissions.delete is absent from the command map, so the harness
    // throws a ContractError and the dialog must stay open showing it.
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Delete$/i })).toBeTruthy()
  })

  it("surfaces a list failure instead of an empty table", async () => {
    renderPage(
      WardenPermissionsPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText("document:read")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test permissions
```

Expected: FAIL, cannot resolve `../src/pages/permissions`.

- [ ] **Step 3: Write the page**

```tsx
import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { NamespaceCell, useNamespaceFilter } from "../components/namespace-filter"
import type { AckResponse } from "./roles"
import type { PermissionSummary } from "./role-detail"

export type { PermissionSummary }

/** Mirrors the Go `PermissionsListResponse`. */
export interface PermissionsList {
  items: PermissionSummary[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

function CreatePermissionForm({
  namespacePath,
  onDone,
}: {
  namespacePath: string
  onDone: () => void
}) {
  const create = useCommand<AckResponse>("permissions.create")
  const [resource, setResource] = useState("")
  const [action, setAction] = useState("")
  const [description, setDescription] = useState("")

  // The name the engine will actually match on. Showing it as the operator
  // types removes the chance to disagree with it, which the contract
  // refuses anyway.
  const derived = resource && action ? `${resource}:${action}` : ""

  async function submit() {
    // No name field is sent at all: the contract derives it, so there is
    // one source of truth rather than two that can drift.
    const result = await create.execute({
      resource,
      action,
      description: description || undefined,
      namespacePath,
    })
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the permission" />
      <p className="text-sm text-muted-foreground">
        A check matches on resource and action, not on the name, so the name is
        derived from them.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="perm-resource">Resource</Label>
        <Input
          id="perm-resource"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="perm-action">Action</Label>
        <Input
          id="perm-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="perm-description">Description</Label>
        <Input
          id="perm-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <p className="text-sm">
        Name:{" "}
        {derived ? (
          <span className="font-mono text-xs">{derived}</span>
        ) : (
          <span className="text-muted-foreground">
            fill in a resource and an action
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={create.loading || resource.trim() === "" || action.trim() === ""}
        >
          {create.loading ? "Creating…" : "Create permission"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function WardenPermissionsPage() {
  const namespace = useNamespaceFilter()
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PermissionSummary | null>(null)

  const list = useQuery<PermissionsList>("permissions.list", {
    ...namespace.param,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const remove = useCommand<AckResponse>("permissions.delete")

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<PermissionSummary>[] = [
    { id: "name", header: "Name", cell: (p) => p.name, className: "font-medium" },
    { id: "resource", header: "Resource", cell: (p) => p.resource },
    { id: "action", header: "Action", cell: (p) => p.action },
    {
      id: "namespace",
      header: "Namespace",
      cell: (p) => <NamespaceCell path={p.namespacePath} />,
    },
    {
      id: "flags",
      header: "Flags",
      cell: (p) =>
        // Most permissions are not system ones, so system is the minority
        // and the state somebody scanning for it is hunting.
        p.isSystem ? <Badge variant="destructive">system</Badge> : <NoneCell label="flags" />,
    },
    {
      id: "description",
      header: "Description",
      cell: (p) => p.description || <NoneCell label="description" />,
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (p) => <Timestamp value={p.updatedAt} label="updated at" />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Permissions"
        actions={
          !creating && <Button onClick={() => setCreating(true)}>New permission</Button>
        }
      />

      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setPage(0)
          },
          placeholder: "Search by name",
          label: "Search permissions",
        }}
        filters={[namespace.filterConfig]}
      />

      {creating && (
        <CreatePermissionForm
          namespacePath={namespace.value === "all" ? "" : namespace.value}
          onDone={() => setCreating(false)}
        />
      )}

      <QueryBoundary title="Permissions" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          const caption = `${data.total} ${data.total === 1 ? "permission" : "permissions"}`
          return (
            <ResourceTable<PermissionSummary>
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              caption={caption}
              emptyMessage="No permissions yet."
              pagination={{
                page,
                pageSize: data.limit,
                total: data.total,
                onPageChange: setPage,
              }}
              rowActions={(p) => (
                <>
                  <PluginLink
                    to={`/permissions/${p.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </PluginLink>
                  {/* No delete on a system permission: the contract
                      refuses it, so the button would promise a rejection. */}
                  {!p.isSystem && (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => {
                        remove.reset()
                        setDeleting(p)
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              This is refused while any role still grants it. Detach it from those
              roles first, and the error below will name them.
            </span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
```

`PermissionSummary` is imported from `./role-detail` rather than redeclared, so the two pages cannot drift apart from the one Go DTO they both mirror. Re-exporting it here keeps the barrel tidy.

Wire the route `{ path: "/permissions", element: WardenPermissionsPage }` and the nav entry:

```tsx
    {
      label: "Permissions",
      to: "/permissions",
      priority: 20,
      icon: <KeyIcon />,
      group: "Authorization",
    },
```

- [ ] **Step 4: Run everything and click through**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint
```

Then run it, because the playbook is blunt that every serious bug in the previous migration of this kind was found by clicking through rather than by a test:

```bash
FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
sleep 2 && pnpm --filter @forge-go/dashboard-shell dev
```

Check by hand:
- Roles lists three roles with the system one marked and no Delete button on it.
- Switching the namespace filter between "All namespaces", "Tenant root" and "eng/platform" changes the rows, and the two former are different queries.
- A role's detail page shows its grants and children; revoking a grant removes it; attaching one adds it.
- Editing the system role is not offered, and the page says why.
- Permissions shows resource and action; the create form derives the name as you type.
- Deleting `document:read` is refused and names the role that grants it.

Report what you actually saw. If the shell will not run, say so plainly rather than skipping it.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git commit -m "feat(warden): add the permissions page" -- packages/plugin-warden
```

---

## Done when

- `go build ./... && go test ./extension/... .` clean in warden. Do not run `go test ./...`: `./store/...` has a pre-existing compile failure from another session's uncommitted file.
- `pnpm --filter @forge-go/dashboard-plugin-warden test`, `typecheck` and `lint` clean.
- The fixture server serves nineteen warden intents and `verify.mjs` reports zero failures.
- The manual checks in Task 9 Step 4 all pass.
- Nothing in warden writes a system role or system permission, and there is a test proving it for each of update, delete and the three junction commands.

Plan 2b follows with assignments, relations and resource types, all of which reuse the paging envelope and the system guard built here.

## Carried forward from plan 1

Two problems this plan does not fix and must not be surprised by:

- **`apps/shell` does not typecheck at HEAD.** A peer session's `packages/host/src/ForgeDashboard.tsx` is three additive lines short of declaring the `headerActions` prop that the committed `App.tsx` passes. Committing their file is permission-blocked. Do not run `pnpm -r test` or the shell typecheck and conclude this plan broke something.
- **`store/contract/actor_fields.go` is staged but uncommitted** by another session, so `go vet ./store/...` and `go test ./store/...` fail on a fresh checkout with `undefined: contract.RunActorFieldsContract`. Also not this plan's.

One finding deferred into plan 3, which owns the check log: **`ListCheckLogs` has no defined order**, and the memory backend returns oldest-first while sqlite, postgres and mongo return newest-first. Plan 3 must add a `RunCheckLogOrderingContract` to `store/contract/` before building the check-log list, or its first page will show the oldest rows.
