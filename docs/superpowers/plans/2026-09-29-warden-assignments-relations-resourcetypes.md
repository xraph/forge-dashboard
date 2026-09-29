# Warden assignments, relations and resource types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish warden's RBAC and ReBAC surfaces in the React dashboard: who holds which role, which objects relate to which subjects, and what shape a resource type declares.

**Architecture:** Twelve intents added to `warden/extension/contract`, and five pages added to `packages/plugin-warden`. Assignments and relations are create-and-delete only, because their stores expose no update, so neither page has an edit form and both say why. Resource types do have an update, and their permission expressions get validated server-side against warden's own parser. Two pages consume intents plan 2a built and left waiting.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0` (dashboard contract, dispatcher), React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`

**Predecessors:** `docs/superpowers/plans/2026-09-23-warden-spine.md` (the contract package, the plugin package, the fixture section, the namespace filter) and `docs/superpowers/plans/2026-09-23-warden-roles-permissions.md` (the paging envelope, the system-entity guard, and thirteen role and permission intents). This plan assumes both.

## Global Constraints

- Contributor name is exactly `warden`. The plugin's `extension` field must match it. A mismatch renders nothing and logs nothing.
- Contract DTOs are camelCase. Never return a warden domain struct (snake_case) on the wire.
- Every intent that pages a stored collection embeds `PageRequest` and returns `PageMeta` beside `items`. No cursors.
- Namespace filter fields are `*string`: `nil` means every namespace, `""` means the tenant root, a path means that namespace.
- Optional update fields are pointers, including `*[]string` for lists that can be emptied.
- Every command declares `meta.invalidates` in the manifest.
- Every handler resolves its tenant with `tenantFrom(p, deps)`, never from the request context. `warden.ScopeFromContext` and `forge.ScopeFrom` both return empty on the contract path, and an empty tenant id in a store `ListFilter` matches every tenant's rows rather than none.
- Every new handler must be added to `handlers_tenant_test.go`'s table and `manifest_test.go`'s `wantKind` map. Both are sized against registrations parsed from `contract.go`'s source. Extend them; never loosen an assertion to make a new handler fit.
- Identifier values carry `font-mono text-xs`. The column an operator reads carries `font-medium`.
- Every table caption carries a live row count including at zero rows, counting the server's `total`, never `rows.length`.
- Empty states say which KIND of empty. Use `emptyListMessage` from `components/namespace-filter.tsx`, which already distinguishes unfiltered, searched and namespace-filtered.
- A cell meaning "none" uses `NoneCell` or `TagList`. A possibly-absent timestamp uses `Timestamp`.
- Badge variants by proportion, not meaning: `outline` for the majority state whatever it signifies, `secondary` notable but not wrong, `default` affirmative, `destructive` for what somebody came to find.
- The tenant root namespace renders as `/`, never the word `root`.
- Errors render inside the dialog that can fail. Every `ConfirmDialog` gets `pending`; `confirmDisabled` is the separate state for a dialog missing a value.
- `execute()` resolves `undefined` only when the client throws. That is the success check. `reset()` is called when a dialog OPENS.
- Drive tests with `fireEvent`. `@testing-library/user-event` and `jest-dom` are deliberately not dependencies; the house style is `toBeTruthy()` and `.textContent`.
- Both git trees are shared with other live sessions. Commit with an explicit path list. Never `git add -A`, `git commit -a`, or `--amend`. Verify each commit with `git show --stat <your-sha>`, never HEAD.
- No `Co-Authored-By` trailers. No Claude or Anthropic attribution in commits or code.
- No em dashes in any committed prose, including comments and commit messages.

## Review Focus

Failure modes the spec implies that the happy-path tests would not reach. Each has a test assigned to the task that owns the code.

1. **`Role.MaxMembers` is enforced by nothing.** `ErrMaxMembersExceeded` is *handled* in `api/helpers.go:34` and a repository-wide grep finds **zero** places that return it. No store counts members before an insert. So a role capped at five accepts five hundred assignments, exactly the way `IsSystem` was decorative before plan 2a's guard. The contract layer is again the only place that can enforce it. Covered in Task 1.
2. **An expired assignment is invisible to the engine but visible in the list.** `ListRolesForSubject` and `ListRolesForSubjectOnResource`, the paths the engine resolves through, filter on `ExpiresAt` (`store/memory/store.go:685`, `:709`). `filterAssignments`, behind the `ListAssignments` a dashboard reads, does not. So an expired row sits in the list looking live while granting nothing. Covered in Tasks 1 and 5.
3. **A resource type's permission expression is validated by nothing on write.** `dsl.CompileExpr` exists and returns diagnostics carrying `Pos{Line, Col}`, and it is called only by the DSL exporter and the evaluator's lazy compile. `api/resourcetype_handler.go:100` copies `Expression` straight through. So an invalid expression saves and then fails silently at check time, where `evaluateReBAC` logs a warning and treats it as no match. Covered in Task 3.
4. **Assignments must NOT reuse `guardSystemRole`.** `extension/bootstrap.go:100` creates a system role and `:168` assigns a subject to it. Guarding assignment writes the way role writes are guarded would break first-run bootstrap from the dashboard. Assigning is a membership change, not a role edit. Covered in Task 1.
5. **A relation tuple's namespace does not cascade.** Roles, permissions, policies and resource types resolve up the ancestor chain; relation tuples deliberately do not, because they name concrete object and subject pairs and cross-namespace matching would be semantically wrong (`relation/relation.go`'s type comment says so). A relations page that implied cascade would mislead. Covered in Tasks 2 and 6.

---

## File Structure

**warden repository** (`/Users/rexraphael/Work/xraph/forgery/warden`)

| File | Responsibility |
|---|---|
| `extension/contract/members.go` (create) | The member-cap guard nothing below the contract provides |
| `extension/contract/handlers_assignments.go` (create) | Four assignment intents |
| `extension/contract/handlers_relations.go` (create) | Three relation intents |
| `extension/contract/handlers_resourcetypes.go` (create) | Five resource-type intents, with expression validation |
| `extension/contract/contract.go` (modify) | Twelve registrations |
| `extension/contract/manifest.yaml` (modify) | Twelve intents, their queries, their invalidates |
| `extension/contract/handlers_tenant_test.go` (modify) | Twelve table entries |
| `extension/contract/manifest_test.go` (modify) | Twelve `wantKind` entries |

**forge-dashboard repository**

| File | Responsibility |
|---|---|
| `packages/plugin-warden/src/pages/assignments.tsx` (create) | Who holds which role, with expiry made honest |
| `packages/plugin-warden/src/pages/relations.tsx` (create) | Relation tuples, create and delete |
| `packages/plugin-warden/src/pages/resource-types.tsx` (create) | Resource types list |
| `packages/plugin-warden/src/pages/resource-type-detail.tsx` (create) | One type's relations and permission expressions |
| `packages/plugin-warden/src/pages/permission-detail.tsx` (create) | Consumes `permissions.detail`, built in 2a and unconsumed |
| `packages/plugin-warden/src/pages/role-detail.tsx` (modify) | An edit form consuming `roles.update` and `roles.setPermissions`, both unconsumed |
| `packages/plugin-warden/src/index.tsx` (modify) | Five routes, three nav entries |
| `packages/fixture-server/warden-fixtures.mjs` (modify) | Twelve handlers plus seed |

---

## Task 1: The member-cap guard and the four assignment intents

The assignment surface, plus the guard that makes `Role.MaxMembers` mean something for the first time.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/members.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_assignments.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_assignments_test.go`
- Modify: `contract.go`, `manifest.yaml`, `handlers_tenant_test.go`, `manifest_test.go`

**Interfaces:**
- Consumes: `PageRequest`, `PageMeta`, `newPageMeta`, `defaultPageLimit`, `maxPageLimit` from `paging.go`; `Deps`, `requireEngine`, `tenantFrom`, `mapWardenError`, `badRequest`, `AckResponse`, `parseRoleID`, `projectRole`, `RoleSummary`, `validateNamespace` from plan 2a; `forEachRolePage` if Task 1 extracts one (see Step 4).
- Produces: `AssignmentSummary`, `AssignmentsListInput`, `AssignmentsListResponse`, `AssignmentCreateInput`, `AssignmentDeleteInput`, `ExpiringInput`, `ExpiringResponse`, `guardMemberCap`. Task 5 uses the DTOs; Tasks 2 and 3 use nothing from here.

- [ ] **Step 1: Write the failing tests**

Create `handlers_assignments_test.go`. Reuse `seedRoles`, `engineOver`, `principalFor`, `errorsAs` and `containsText`, all already in this package's test files.

```go
package contract

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/role"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// seedAssignment binds a subject to a role, optionally with an expiry.
func seedAssignment(t *testing.T, s *memory.Store, roleID, subjectID string, expires *time.Time) *assignment.Assignment {
	t.Helper()
	rid, err := parseRoleIDForTest(roleID)
	if err != nil {
		t.Fatalf("parse role id %q: %v", roleID, err)
	}
	a := &assignment.Assignment{
		TenantID:    "t1",
		RoleID:      rid,
		SubjectKind: "user",
		SubjectID:   subjectID,
		ExpiresAt:   expires,
	}
	if err := s.CreateAssignment(context.Background(), a); err != nil {
		t.Fatalf("create assignment for %q: %v", subjectID, err)
	}
	return a
}

func TestAssignmentsListPagesAndReportsTheTotal(t *testing.T) {
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	for _, who := range []string{"a", "b", "c", "d", "e"} {
		seedAssignment(t, s, r.ID.String(), who, nil)
	}
	h := assignmentsListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), AssignmentsListInput{PageRequest: PageRequest{Limit: 2}}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.list: %v", err)
	}
	if len(got.Items) != 2 {
		t.Errorf("returned %d items, want 2", len(got.Items))
	}
	if got.Total != 5 {
		t.Errorf("total = %d, want 5", got.Total)
	}
}

func TestAssignmentsListMarksExpiredRowsExpired(t *testing.T) {
	// The finding this page exists to fix. ListRolesForSubject filters
	// expired assignments (store/memory/store.go:685) so the engine ignores
	// them, but filterAssignments behind ListAssignments does not. So an
	// expired row is IN the list and grants nothing, and the list must say
	// so or it is lying to the operator.
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	seedAssignment(t, s, r.ID.String(), "gone", &past)
	seedAssignment(t, s, r.ID.String(), "soon", &future)
	seedAssignment(t, s, r.ID.String(), "forever", nil)
	h := assignmentsListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), AssignmentsListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.list: %v", err)
	}
	if len(got.Items) != 3 {
		t.Fatalf("returned %d items, want all 3 including the expired one", len(got.Items))
	}
	bySubject := map[string]AssignmentSummary{}
	for _, a := range got.Items {
		bySubject[a.SubjectID] = a
	}
	if !bySubject["gone"].Expired {
		t.Error("the past-dated assignment is not marked expired: the page would show it as live")
	}
	if bySubject["soon"].Expired {
		t.Error("a future expiry must not be marked expired")
	}
	if bySubject["forever"].Expired {
		t.Error("an assignment with no expiry must not be marked expired")
	}
	if bySubject["forever"].ExpiresAt != "" {
		t.Errorf("no expiry should serialise as empty, got %q", bySubject["forever"].ExpiresAt)
	}
}

func TestAssignmentsListCarriesTheRoleItBinds(t *testing.T) {
	// A row reading only a role id is unreadable. The page needs the slug.
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	seedAssignment(t, s, r.ID.String(), "alice", nil)
	h := assignmentsListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), AssignmentsListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.list: %v", err)
	}
	if got.Items[0].RoleSlug != "reader" {
		t.Errorf("roleSlug = %q, want reader", got.Items[0].RoleSlug)
	}
}

func TestAssignmentsListIsScopedToItsOwnTenant(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	mine := seedRoles(t, s, "", "mine")[0]
	seedAssignment(t, s, mine.ID.String(), "alice", nil)
	theirs := &role.Role{TenantID: "t2", Name: "T", Slug: "theirs"}
	if err := s.CreateRole(ctx, theirs); err != nil {
		t.Fatalf("create other tenant's role: %v", err)
	}
	other := &assignment.Assignment{
		TenantID: "t2", RoleID: theirs.ID, SubjectKind: "user", SubjectID: "bob",
	}
	if err := s.CreateAssignment(ctx, other); err != nil {
		t.Fatalf("create other tenant's assignment: %v", err)
	}
	h := assignmentsListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(ctx, AssignmentsListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.list: %v", err)
	}
	// Asserted on identity, not count: a count assertion passes when the
	// wrong rows arrive in the right quantity.
	for _, a := range got.Items {
		if a.SubjectID == "bob" {
			t.Fatal("t1 can see t2's assignment: tenant scoping is not applied")
		}
	}
	if got.Total != 1 {
		t.Errorf("total = %d, want 1", got.Total)
	}
}

func TestAssignmentsCreateBinds(t *testing.T) {
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	h := assignmentsCreateHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), AssignmentCreateInput{
		RoleID: r.ID.String(), SubjectKind: "user", SubjectID: "alice",
	}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.create: %v", err)
	}
	if got.ID == "" {
		t.Fatal("create returned no id")
	}
}

func TestAssignmentsCreateAcceptsASystemRole(t *testing.T) {
	// Deliberate, and the opposite of every role WRITE in plan 2a.
	// extension/bootstrap.go:100 creates a system role and :168 assigns a
	// subject to it, so guarding assignment writes with guardSystemRole
	// would break first-run bootstrap from the dashboard. Assigning is a
	// membership change, not a role edit.
	s := memory.New()
	ctx := context.Background()
	sys := &role.Role{TenantID: "t1", Name: "System", Slug: "warden-admin", IsSystem: true}
	if err := s.CreateRole(ctx, sys); err != nil {
		t.Fatalf("create system role: %v", err)
	}
	h := assignmentsCreateHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, AssignmentCreateInput{
		RoleID: sys.ID.String(), SubjectKind: "user", SubjectID: "root",
	}, principalFor("t1")); err != nil {
		t.Fatalf("assigning to a system role must be allowed, got %v", err)
	}
}

func TestAssignmentsCreateRefusesPastTheMemberCap(t *testing.T) {
	// Role.MaxMembers is enforced by NOTHING below this layer.
	// ErrMaxMembersExceeded is handled in api/helpers.go:34 and returned by
	// zero places, and no store counts members before an insert. So a role
	// capped at 2 accepts unlimited assignments unless this guard refuses.
	s := memory.New()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "Small", Slug: "small", MaxMembers: 2}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := assignmentsCreateHandler(Deps{Engine: engineOver(t, s)})

	for _, who := range []string{"a", "b"} {
		if _, err := h(ctx, AssignmentCreateInput{
			RoleID: r.ID.String(), SubjectKind: "user", SubjectID: who,
		}, principalFor("t1")); err != nil {
			t.Fatalf("assigning %q within the cap: %v", who, err)
		}
	}

	_, err := h(ctx, AssignmentCreateInput{
		RoleID: r.ID.String(), SubjectKind: "user", SubjectID: "c",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal past the member cap")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeConflict {
		t.Fatalf("want CodeConflict, got %v", err)
	}
	if !containsText(ce.Message, "2") {
		t.Errorf("message %q does not name the cap", ce.Message)
	}
}

func TestAssignmentsCreateIgnoresACapOfZero(t *testing.T) {
	// MaxMembers 0 means unlimited. No field comment says so; the evidence
	// is the omitempty tag and the templ dashboard rendering the cap only
	// `if r.MaxMembers > 0`. A guard treating 0 as "no members allowed"
	// would block every assignment on every role that never set a cap.
	s := memory.New()
	r := seedRoles(t, s, "", "uncapped")[0]
	h := assignmentsCreateHandler(Deps{Engine: engineOver(t, s)})

	for _, who := range []string{"a", "b", "c"} {
		if _, err := h(context.Background(), AssignmentCreateInput{
			RoleID: r.ID.String(), SubjectKind: "user", SubjectID: who,
		}, principalFor("t1")); err != nil {
			t.Fatalf("assigning %q to an uncapped role: %v", who, err)
		}
	}
}

func TestAssignmentsCreateCountsOnlyLiveMembersAgainstTheCap(t *testing.T) {
	// An expired assignment grants nothing, so it must not occupy a seat.
	// Counting it would lock a role out permanently as old grants pile up.
	s := memory.New()
	ctx := context.Background()
	r := &role.Role{TenantID: "t1", Name: "Small", Slug: "small", MaxMembers: 1}
	if err := s.CreateRole(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}
	past := time.Now().Add(-time.Hour)
	seedAssignment(t, s, r.ID.String(), "gone", &past)
	h := assignmentsCreateHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, AssignmentCreateInput{
		RoleID: r.ID.String(), SubjectKind: "user", SubjectID: "live",
	}, principalFor("t1")); err != nil {
		t.Fatalf("an expired assignment must not occupy a seat, got %v", err)
	}
}

func TestAssignmentsCreateRejectsAnUnknownSubjectKind(t *testing.T) {
	// warden.SubjectKind is a closed set: user, api_key, service,
	// service_acct. A typo stores an assignment no check will ever match,
	// because the engine compares the kind verbatim.
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	h := assignmentsCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), AssignmentCreateInput{
		RoleID: r.ID.String(), SubjectKind: "usr", SubjectID: "alice",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal for an unknown subject kind")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest, got %v", err)
	}
}

func TestAssignmentsDeleteRemovesIt(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	r := seedRoles(t, s, "", "reader")[0]
	a := seedAssignment(t, s, r.ID.String(), "alice", nil)
	h := assignmentsDeleteHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, AssignmentDeleteInput{ID: a.ID.String()}, principalFor("t1")); err != nil {
		t.Fatalf("assignments.delete: %v", err)
	}
	if _, err := s.GetAssignment(ctx, "t1", a.ID); err == nil {
		t.Fatal("the assignment is still there")
	}
}

func TestAssignmentsExpiringListsWhatIsAboutToLapse(t *testing.T) {
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	soon := time.Now().Add(2 * time.Hour)
	far := time.Now().Add(100 * 24 * time.Hour)
	seedAssignment(t, s, r.ID.String(), "soon", &soon)
	seedAssignment(t, s, r.ID.String(), "far", &far)
	seedAssignment(t, s, r.ID.String(), "never", nil)
	h := assignmentsExpiringHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), ExpiringInput{WithinHours: 24}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.expiring: %v", err)
	}
	var subjects []string
	for _, a := range got.Items {
		subjects = append(subjects, a.SubjectID)
	}
	if len(subjects) != 1 || subjects[0] != "soon" {
		t.Errorf("expiring = %v, want only soon", subjects)
	}
}

func TestAssignmentsExpiringDefaultsItsWindow(t *testing.T) {
	// A window of zero must not mean "nothing expires", which would make an
	// empty page look healthy.
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	soon := time.Now().Add(2 * time.Hour)
	seedAssignment(t, s, r.ID.String(), "soon", &soon)
	h := assignmentsExpiringHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), ExpiringInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.expiring: %v", err)
	}
	if len(got.Items) != 1 {
		t.Errorf("an unset window returned %d items, want the default window to catch the one expiring in 2h", len(got.Items))
	}
}

func TestAssignmentsExpiringIncludesWhatAlreadyLapsed(t *testing.T) {
	// ListExpiringAssignments takes a "before" instant and returns
	// everything with an expiry earlier than it, which includes expiries
	// already in the PAST (store/memory/store.go:736). That is the right
	// behaviour for a feed of what needs attention, since a grant that
	// lapsed last week still needs somebody to renew or remove it. But the
	// feed must distinguish the two, or "expiring soon" and "already dead"
	// read identically.
	s := memory.New()
	r := seedRoles(t, s, "", "reader")[0]
	past := time.Now().Add(-time.Hour)
	soon := time.Now().Add(2 * time.Hour)
	seedAssignment(t, s, r.ID.String(), "gone", &past)
	seedAssignment(t, s, r.ID.String(), "soon", &soon)
	h := assignmentsExpiringHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), ExpiringInput{WithinHours: 24}, principalFor("t1"))
	if err != nil {
		t.Fatalf("assignments.expiring: %v", err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("returned %d items, want both the lapsed and the lapsing", len(got.Items))
	}
	bySubject := map[string]AssignmentSummary{}
	for _, a := range got.Items {
		bySubject[a.SubjectID] = a
	}
	if !bySubject["gone"].Expired {
		t.Error("the already-lapsed row is not marked expired: the feed cannot distinguish it from one expiring soon")
	}
	if bySubject["soon"].Expired {
		t.Error("a row expiring in 2h must not be marked expired yet")
	}
}
```

`parseRoleIDForTest` does not exist. The package's `parseRoleID` returns a contract error rather than a raw one, which is awkward in a test helper. Add a tiny local helper at the bottom of this file:

```go
func parseRoleIDForTest(raw string) (id.RoleID, error) { return id.ParseRoleID(raw) }
```

and import `"github.com/xraph/warden/id"`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run Assignments -v
```

Expected: compile failure, `undefined: assignmentsListHandler`.

- [ ] **Step 3: Write `members.go`**

```go
// members.go: the member-cap guard.
//
// READ THIS BEFORE REMOVING IT AS REDUNDANT. Role.MaxMembers is enforced
// nowhere below this file. warden defines ErrMaxMembersExceeded, and a
// repository-wide grep finds it HANDLED once (api/helpers.go maps it to a
// status) and RETURNED zero times. No store counts a role's members before
// inserting an assignment.
//
// So MaxMembers is, everywhere below the contract layer, a number somebody
// typed into a form. A role capped at five accepts five hundred assignments
// and nothing complains. This is the same shape as IsSystem before
// immutable.go, and the same reasoning applies: the contract is the only
// enforcement point that exists.
package contract

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/role"
	"github.com/xraph/warden/store"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// guardMemberCap refuses an assignment that would take a role past its cap.
//
// Two rules that are easy to get backwards:
//
// MaxMembers 0 means UNLIMITED. There is no field comment saying so, so the
// evidence is the `omitempty` tag on role.Role.MaxMembers and the templ
// dashboard's own guard at dashboard/pages/role_detail_templ.go:328, which
// renders the cap only `if r.MaxMembers > 0`. A guard that read 0 as "no
// members" would block every assignment on every role that never set a
// cap, which is most of them.
//
// Only LIVE members occupy a seat. An expired assignment grants nothing
// (ListRolesForSubject filters it), so counting it would let old grants pile
// up until a role could never be assigned again.
func guardMemberCap(ctx context.Context, s store.Store, tenantID string, r *role.Role, now time.Time) error {
	if r.MaxMembers <= 0 {
		return nil
	}
	held, err := s.ListSubjectsForRole(ctx, tenantID, r.ID)
	if err != nil {
		return mapWardenError(err)
	}
	live := 0
	for _, a := range held {
		if isLive(a, now) {
			live++
		}
	}
	if live < r.MaxMembers {
		return nil
	}
	return &dashcontract.Error{
		Code: dashcontract.CodeConflict,
		Message: fmt.Sprintf("%q is capped at %d members and already has %d",
			r.Name, r.MaxMembers, live),
	}
}

// isLive reports whether an assignment grants anything at instant now.
//
// This is the same test the engine applies when resolving roles
// (store/memory/store.go's ListRolesForSubject), and it is the definition of
// "expired" the whole assignment surface uses. A nil ExpiresAt never
// expires.
func isLive(a *assignment.Assignment, now time.Time) bool {
	return a.ExpiresAt == nil || a.ExpiresAt.After(now)
}
```

`ListSubjectsForRole(ctx, tenantID, roleID)` is declared at `assignment/store.go:50` and implemented by all four backends. The memory implementation (`store/memory/store.go:717`) does NOT filter on `ExpiresAt`, so the `isLive` loop is load-bearing rather than defensive: without it an expired grant occupies a seat forever. Check the sqlite, postgres and mongo implementations too. If any of them DOES filter expiry, the loop is still correct, but say so in your report, because a cap that counts differently per backend is a store-contract bug worth its own test in `store/contract/`.

- [ ] **Step 4: Write `handlers_assignments.go`**

Read `assignment/assignment.go` for the field names before trusting these.

```go
// handlers_assignments.go: the assignment surface.
//
// Assignments are create-and-delete only, because assignment.Store exposes
// no update. So there is no patch input here and no edit form on the page:
// changing who holds a role means deleting one binding and making another.
//
// The one thing this file cares about more than the rest is expiry. The
// engine's resolution path filters expired assignments, so an expired row
// grants nothing. The LISTING path does not filter them, so they are
// visible. A page that showed them without saying so would be reporting
// access that does not exist, which is why every projected row carries
// Expired.
package contract

import (
	"context"
	"time"

	"github.com/xraph/warden/assignment"
	"github.com/xraph/warden/id"
	"github.com/xraph/warden/role"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// defaultExpiringWindowHours is the horizon assignments.expiring uses when
// the caller names none. Not zero: a zero window would return nothing and an
// empty page would look like nothing is lapsing.
const defaultExpiringWindowHours = 7 * 24

// AssignmentSummary is one row of the assignments list.
//
// RoleSlug is denormalised deliberately. A row that named only a role id
// would be unreadable, and resolving it per row in the page would be a
// request per row.
//
// Expired is computed rather than stored, because the store has no such
// column: it is ExpiresAt compared against now, using the same test the
// engine applies when it resolves roles.
type AssignmentSummary struct {
	ID            string `json:"id"`
	NamespacePath string `json:"namespacePath"`
	RoleID        string `json:"roleId"`
	RoleSlug      string `json:"roleSlug"`
	RoleName      string `json:"roleName"`
	SubjectKind   string `json:"subjectKind"`
	SubjectID     string `json:"subjectId"`
	ResourceType  string `json:"resourceType,omitempty"`
	ResourceID    string `json:"resourceId,omitempty"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
	Expired       bool   `json:"expired"`
	GrantedBy     string `json:"grantedBy,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

// AssignmentsListInput filters the assignments list.
type AssignmentsListInput struct {
	PageRequest
	NamespacePath *string `json:"namespacePath,omitempty"`
	RoleID        string  `json:"roleId,omitempty"`
	SubjectKind   string  `json:"subjectKind,omitempty"`
	SubjectID     string  `json:"subjectId,omitempty"`
	ResourceType  string  `json:"resourceType,omitempty"`
	ResourceID    string  `json:"resourceId,omitempty"`
}

// AssignmentsListResponse is the paged reply.
type AssignmentsListResponse struct {
	PageMeta
	Items []AssignmentSummary `json:"items"`
}

// AssignmentCreateInput binds a subject to a role.
//
// ExpiresAt is an RFC3339 string rather than a time, because that is what
// the wire carries and parsing it here lets a malformed value be a
// BAD_REQUEST naming the field instead of a JSON decode failure naming
// nothing.
type AssignmentCreateInput struct {
	RoleID        string `json:"roleId"`
	SubjectKind   string `json:"subjectKind"`
	SubjectID     string `json:"subjectId"`
	NamespacePath string `json:"namespacePath,omitempty"`
	ResourceType  string `json:"resourceType,omitempty"`
	ResourceID    string `json:"resourceId,omitempty"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
}

// AssignmentDeleteInput names the binding to remove.
type AssignmentDeleteInput struct {
	ID string `json:"id"`
}

// ExpiringInput asks what lapses within a horizon.
type ExpiringInput struct {
	WithinHours int `json:"withinHours,omitempty"`
	Limit       int `json:"limit,omitempty"`
}

// ExpiringResponse is the reply. Not paged: this is a "what needs attention"
// feed with a caller-set limit, not a browsable collection, so it carries no
// PageMeta. Compare overview.recentChecks in the spine plan.
type ExpiringResponse struct {
	Items []AssignmentSummary `json:"items"`
}

// validSubjectKinds is warden's closed set. A kind outside it stores an
// assignment no check will ever match, because the engine compares
// req.Subject.Kind verbatim against the stored string.
var validSubjectKinds = map[string]struct{}{
	"user":         {},
	"api_key":      {},
	"service":      {},
	"service_acct": {},
}

func parseAssignmentID(raw string) (id.AssignmentID, error) {
	aid, err := id.ParseAssignmentID(raw)
	if err != nil {
		return id.Nil, badRequest("not an assignment id: " + raw)
	}
	return aid, nil
}

func projectAssignment(a *assignment.Assignment, r *role.Role, now time.Time) AssignmentSummary {
	out := AssignmentSummary{
		ID:            a.ID.String(),
		NamespacePath: a.NamespacePath,
		RoleID:        a.RoleID.String(),
		SubjectKind:   a.SubjectKind,
		SubjectID:     a.SubjectID,
		ResourceType:  a.ResourceType,
		ResourceID:    a.ResourceID,
		Expired:       !isLive(a, now),
		GrantedBy:     a.GrantedBy,
		CreatedAt:     a.CreatedAt.UTC().Format(time.RFC3339),
	}
	if a.ExpiresAt != nil {
		out.ExpiresAt = a.ExpiresAt.UTC().Format(time.RFC3339)
	}
	if r != nil {
		out.RoleSlug = r.Slug
		out.RoleName = r.Name
	}
	return out
}

// rolesByIDFor resolves the roles a page of assignments references, in one
// round trip rather than one per row.
func rolesByIDFor(ctx context.Context, deps Deps, tenantID string, rows []*assignment.Assignment) (map[id.RoleID]*role.Role, error) {
	seen := map[id.RoleID]struct{}{}
	ids := make([]id.RoleID, 0, len(rows))
	for _, a := range rows {
		if _, dup := seen[a.RoleID]; dup {
			continue
		}
		seen[a.RoleID] = struct{}{}
		ids = append(ids, a.RoleID)
	}
	if len(ids) == 0 {
		return map[id.RoleID]*role.Role{}, nil
	}
	found, err := deps.Engine.Store().GetRoles(ctx, tenantID, ids)
	if err != nil {
		return nil, mapWardenError(err)
	}
	byID := make(map[id.RoleID]*role.Role, len(found))
	for _, r := range found {
		byID[r.ID] = r
	}
	return byID, nil
}

func assignmentsListHandler(deps Deps) func(context.Context, AssignmentsListInput, dashcontract.Principal) (AssignmentsListResponse, error) {
	return func(ctx context.Context, in AssignmentsListInput, p dashcontract.Principal) (AssignmentsListResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AssignmentsListResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AssignmentsListResponse{}, err
		}
		limit, offset := in.Clamp()
		filter := &assignment.ListFilter{
			TenantID:      tenantID,
			NamespacePath: in.NamespacePath,
			SubjectKind:   in.SubjectKind,
			SubjectID:     in.SubjectID,
			ResourceType:  in.ResourceType,
			ResourceID:    in.ResourceID,
			Limit:         limit,
			Offset:        offset,
		}
		if in.RoleID != "" {
			rid, err := parseRoleID(in.RoleID)
			if err != nil {
				return AssignmentsListResponse{}, err
			}
			filter.RoleID = &rid
		}
		s := deps.Engine.Store()
		rows, err := s.ListAssignments(ctx, filter)
		if err != nil {
			return AssignmentsListResponse{}, mapWardenError(err)
		}
		total, err := s.CountAssignments(ctx, filter)
		if err != nil {
			return AssignmentsListResponse{}, mapWardenError(err)
		}
		byID, err := rolesByIDFor(ctx, deps, tenantID, rows)
		if err != nil {
			return AssignmentsListResponse{}, err
		}
		now := time.Now()
		out := AssignmentsListResponse{
			PageMeta: newPageMeta(total, limit, offset),
			Items:    make([]AssignmentSummary, 0, len(rows)),
		}
		for _, a := range rows {
			out.Items = append(out.Items, projectAssignment(a, byID[a.RoleID], now))
		}
		return out, nil
	}
}

func assignmentsCreateHandler(deps Deps) func(context.Context, AssignmentCreateInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in AssignmentCreateInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		if in.SubjectID == "" {
			return AckResponse{}, badRequest("an assignment needs a subject id")
		}
		if _, ok := validSubjectKinds[in.SubjectKind]; !ok {
			return AckResponse{}, badRequest(
				"subjectKind must be one of user, api_key, service, service_acct, got " + in.SubjectKind)
		}
		if err := validateNamespace(in.NamespacePath); err != nil {
			return AckResponse{}, err
		}
		rid, err := parseRoleID(in.RoleID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()
		r, err := s.GetRole(ctx, tenantID, rid)
		if err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		// NOTE: no guardSystemRole here, and that is deliberate.
		// extension/bootstrap.go creates a system role and assigns a
		// subject to it, so refusing assignments to system roles would
		// break first-run bootstrap from the dashboard. Assigning is a
		// membership change, not an edit of the role.
		now := time.Now()
		if err := guardMemberCap(ctx, s, tenantID, r, now); err != nil {
			return AckResponse{}, err
		}
		a := &assignment.Assignment{
			TenantID:      tenantID,
			NamespacePath: in.NamespacePath,
			RoleID:        rid,
			SubjectKind:   in.SubjectKind,
			SubjectID:     in.SubjectID,
			ResourceType:  in.ResourceType,
			ResourceID:    in.ResourceID,
		}
		if in.ExpiresAt != "" {
			when, parseErr := time.Parse(time.RFC3339, in.ExpiresAt)
			if parseErr != nil {
				return AckResponse{}, badRequest("expiresAt must be an RFC3339 instant, got " + in.ExpiresAt)
			}
			if !when.After(now) {
				return AckResponse{}, badRequest("expiresAt is already in the past, so this assignment would grant nothing")
			}
			a.ExpiresAt = &when
		}
		if err := s.CreateAssignment(ctx, a); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: a.ID.String()}, nil
	}
}

func assignmentsDeleteHandler(deps Deps) func(context.Context, AssignmentDeleteInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in AssignmentDeleteInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		aid, err := parseAssignmentID(in.ID)
		if err != nil {
			return AckResponse{}, err
		}
		s := deps.Engine.Store()
		// Read first, so deleting another tenant's assignment is NOT_FOUND
		// rather than a silent no-op.
		if _, err := s.GetAssignment(ctx, tenantID, aid); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		if err := s.DeleteAssignment(ctx, tenantID, aid); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{}, nil
	}
}

func assignmentsExpiringHandler(deps Deps) func(context.Context, ExpiringInput, dashcontract.Principal) (ExpiringResponse, error) {
	return func(ctx context.Context, in ExpiringInput, p dashcontract.Principal) (ExpiringResponse, error) {
		if err := requireEngine(deps); err != nil {
			return ExpiringResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return ExpiringResponse{}, err
		}
		hours := in.WithinHours
		if hours <= 0 {
			hours = defaultExpiringWindowHours
		}
		limit := in.Limit
		if limit <= 0 || limit > maxPageLimit {
			limit = defaultPageLimit
		}
		now := time.Now()
		before := now.Add(time.Duration(hours) * time.Hour)
		rows, err := deps.Engine.Store().ListExpiringAssignments(ctx, tenantID, before, limit)
		if err != nil {
			return ExpiringResponse{}, mapWardenError(err)
		}
		byID, err := rolesByIDFor(ctx, deps, tenantID, rows)
		if err != nil {
			return ExpiringResponse{}, err
		}
		out := ExpiringResponse{Items: make([]AssignmentSummary, 0, len(rows))}
		for _, a := range rows {
			out.Items = append(out.Items, projectAssignment(a, byID[a.RoleID], now))
		}
		return out, nil
	}
}
```

Check `assignment.ListFilter.RoleID`'s real type in `assignment/assignment.go`: it is `*id.RoleID`, which is why the handler takes the address of a local. Check `validateNamespace`'s real signature too; plan 2a settled on `validateNamespace(path string) error`.

Two things about `ListExpiringAssignments` that the memory implementation settles (`store/memory/store.go:731`). It excludes assignments with no expiry, so a permanent grant never appears in the feed, and it sorts ascending by expiry, so the soonest is first. But it returns everything expiring before the horizon INCLUDING expiries already in the past, so the feed carries lapsed grants as well as lapsing ones. That is right for a feed of what needs attention, and it is exactly why `AssignmentSummary.Expired` matters here too. It also clamps through `fanoutLimit(limit)` rather than using the limit verbatim, so do not assert an exact row count against a large limit in any test.

- [ ] **Step 5: Register the four intents**

In `contract.go`, four registrations following the established pattern: `assignments.list` and `assignments.expiring` as queries, `assignments.create` and `assignments.delete` as commands, each wrapped in `fmt.Errorf` on failure:

```go
	if err := dispatcher.RegisterQuery(d, contributorName, "assignments.list", 1, assignmentsListHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register assignments.list: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, contributorName, "assignments.expiring", 1, assignmentsExpiringHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register assignments.expiring: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "assignments.create", 1, assignmentsCreateHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register assignments.create: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, contributorName, "assignments.delete", 1, assignmentsDeleteHandler(deps)); err != nil {
		return fmt.Errorf("warden/contract: register assignments.delete: %w", err)
	}
```

In `manifest.yaml`:

```yaml
  - { name: assignments.list,     kind: query, version: 1, capability: read }
  - { name: assignments.expiring, kind: query, version: 1, capability: read }
  # A new binding changes the list, the expiring feed if it carries an
  # expiry, the counters, and the role's own detail page, which is where an
  # operator reads how many hold it.
  - { name: assignments.create, kind: command, version: 1, capability: write,
      invalidates: [assignments.list, assignments.expiring, roles.detail, overview.stats] }
  - { name: assignments.delete, kind: command, version: 1, capability: write,
      invalidates: [assignments.list, assignments.expiring, roles.detail, overview.stats] }
```

and under `queries`:

```yaml
  assignmentList:
    intent: assignments.list
    cache: { staleTime: 30s }
  expiringAssignments:
    intent: assignments.expiring
    cache: { staleTime: 60s }
```

Plan 2a left a manifest comment on `roles.delete` saying the assignments list changes too, with no intent to name. Add `assignments.list` to `roles.delete`'s `invalidates` now that it exists, because `DeleteAssignmentsByRole` really does cascade.

- [ ] **Step 6: Extend the two guard tests**

Add all four handlers to `handlers_tenant_test.go`'s `tenantEnforcedHandlers` table and all four intents to `manifest_test.go`'s `wantKind` map. Both have size assertions derived from `contract.go`'s source; adding entries is completing them, not weakening them.

- [ ] **Step 7: Run the tests**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./...
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "feat(contract): the assignment surface, with the member cap warden never enforced" -- extension/contract
```

---

## Task 2: The three relation intents

Relation tuples: Zanzibar-style `object#relation@subject` triples. Create and delete only, because `relation.Store` exposes no update.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_relations.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_relations_test.go`
- Modify: `contract.go`, `manifest.yaml`, `handlers_tenant_test.go`, `manifest_test.go`

**Interfaces:**
- Consumes: `PageRequest`, `PageMeta`, `newPageMeta`, `Deps`, `requireEngine`, `tenantFrom`, `mapWardenError`, `badRequest`, `AckResponse`, `validateNamespace`.
- Produces: `RelationSummary`, `RelationsListInput`, `RelationsListResponse`, `RelationCreateInput`, `RelationDeleteInput`. Task 6 uses them.

- [ ] **Step 1: Write the failing tests**

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/warden/relation"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func seedTuple(t *testing.T, s *memory.Store, namespace, objType, objID, rel, subjType, subjID string) *relation.Tuple {
	t.Helper()
	tp := &relation.Tuple{
		TenantID:      "t1",
		NamespacePath: namespace,
		ObjectType:    objType,
		ObjectID:      objID,
		Relation:      rel,
		SubjectType:   subjType,
		SubjectID:     subjID,
	}
	if err := s.CreateRelation(context.Background(), tp); err != nil {
		t.Fatalf("create tuple: %v", err)
	}
	return tp
}

func TestRelationsListPagesFiltersAndCounts(t *testing.T) {
	s := memory.New()
	seedTuple(t, s, "", "document", "readme", "viewer", "user", "alice")
	seedTuple(t, s, "", "document", "readme", "editor", "user", "bob")
	seedTuple(t, s, "", "folder", "root", "parent", "document", "readme")
	h := relationsListHandler(Deps{Engine: engineOver(t, s)})

	all, err := h(context.Background(), RelationsListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("relations.list: %v", err)
	}
	if all.Total != 3 {
		t.Errorf("total = %d, want 3", all.Total)
	}

	byObject, err := h(context.Background(), RelationsListInput{ObjectType: "document"}, principalFor("t1"))
	if err != nil {
		t.Fatalf("filtered: %v", err)
	}
	if byObject.Total != 2 {
		t.Errorf("objectType=document total = %d, want 2", byObject.Total)
	}
	for _, r := range byObject.Items {
		if r.ObjectType != "document" {
			t.Errorf("object filter leaked %q", r.ObjectType)
		}
	}
}

func TestRelationsListIsScopedToItsOwnTenant(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	seedTuple(t, s, "", "document", "mine", "viewer", "user", "alice")
	other := &relation.Tuple{
		TenantID: "t2", ObjectType: "document", ObjectID: "theirs",
		Relation: "viewer", SubjectType: "user", SubjectID: "bob",
	}
	if err := s.CreateRelation(ctx, other); err != nil {
		t.Fatalf("create other tenant's tuple: %v", err)
	}
	h := relationsListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(ctx, RelationsListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("relations.list: %v", err)
	}
	for _, r := range got.Items {
		if r.ObjectID == "theirs" {
			t.Fatal("t1 can see t2's tuple: tenant scoping is not applied")
		}
	}
	if got.Total != 1 {
		t.Errorf("total = %d, want 1", got.Total)
	}
}

func TestRelationsCreateWritesTheTuple(t *testing.T) {
	s := memory.New()
	h := relationsCreateHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), RelationCreateInput{
		ObjectType: "document", ObjectID: "readme",
		Relation: "viewer", SubjectType: "user", SubjectID: "alice",
	}, principalFor("t1"))
	if err != nil {
		t.Fatalf("relations.create: %v", err)
	}
	if got.ID == "" {
		t.Fatal("create returned no id")
	}
}

func TestRelationsCreateRequiresEveryPartOfTheTriple(t *testing.T) {
	// A tuple missing any part matches nothing and is unreachable by every
	// filter, so it is silent junk rather than a partial grant.
	s := memory.New()
	h := relationsCreateHandler(Deps{Engine: engineOver(t, s)})
	full := RelationCreateInput{
		ObjectType: "document", ObjectID: "readme",
		Relation: "viewer", SubjectType: "user", SubjectID: "alice",
	}

	for _, missing := range []string{"objectType", "objectId", "relation", "subjectType", "subjectId"} {
		in := full
		switch missing {
		case "objectType":
			in.ObjectType = ""
		case "objectId":
			in.ObjectID = ""
		case "relation":
			in.Relation = ""
		case "subjectType":
			in.SubjectType = ""
		case "subjectId":
			in.SubjectID = ""
		}
		_, err := h(context.Background(), in, principalFor("t1"))
		if err == nil {
			t.Errorf("want a refusal with %s missing", missing)
			continue
		}
		var ce *dashcontract.Error
		if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
			t.Errorf("%s missing: want CodeBadRequest, got %v", missing, err)
		}
	}
}

func TestRelationsCreateRefusesADuplicateTuple(t *testing.T) {
	s := memory.New()
	seedTuple(t, s, "", "document", "readme", "viewer", "user", "alice")
	h := relationsCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), RelationCreateInput{
		ObjectType: "document", ObjectID: "readme",
		Relation: "viewer", SubjectType: "user", SubjectID: "alice",
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal for a duplicate tuple")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeConflict {
		t.Errorf("want CodeConflict, got %v", err)
	}
}

func TestRelationsDeleteRemovesTheTuple(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	tp := seedTuple(t, s, "", "document", "readme", "viewer", "user", "alice")
	h := relationsDeleteHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, RelationDeleteInput{ID: tp.ID.String()}, principalFor("t1")); err != nil {
		t.Fatalf("relations.delete: %v", err)
	}
	rows, err := s.ListRelations(ctx, &relation.ListFilter{TenantID: "t1"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("rows = %+v, want none", rows)
	}
}

func TestRelationsDeleteOfAnotherTenantsTupleIsNotFound(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	other := &relation.Tuple{
		TenantID: "t2", ObjectType: "document", ObjectID: "theirs",
		Relation: "viewer", SubjectType: "user", SubjectID: "bob",
	}
	if err := s.CreateRelation(ctx, other); err != nil {
		t.Fatalf("create: %v", err)
	}
	h := relationsDeleteHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, RelationDeleteInput{ID: other.ID.String()}, principalFor("t1"))
	if err == nil {
		t.Fatal("want NOT_FOUND deleting another tenant's tuple")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeNotFound {
		t.Errorf("want CodeNotFound, got %v", err)
	}
}

func TestRelationsListDoesNotCascadeAcrossNamespaces(t *testing.T) {
	// Roles, permissions, policies and resource types resolve up the
	// ancestor chain. Tuples deliberately do not, because they name
	// concrete object and subject pairs and cross-namespace matching would
	// be semantically wrong (see relation/relation.go's type comment).
	// A list that cascaded would imply access the engine will not grant.
	s := memory.New()
	seedTuple(t, s, "", "document", "root-doc", "viewer", "user", "alice")
	seedTuple(t, s, "eng", "document", "eng-doc", "viewer", "user", "alice")
	h := relationsListHandler(Deps{Engine: engineOver(t, s)})

	eng := "eng"
	got, err := h(context.Background(), RelationsListInput{NamespacePath: &eng}, principalFor("t1"))
	if err != nil {
		t.Fatalf("relations.list: %v", err)
	}
	if got.Total != 1 || got.Items[0].ObjectID != "eng-doc" {
		t.Errorf("namespace eng returned %+v, want only eng-doc and no ancestor row", got.Items)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run Relations -v
```

Expected: compile failure, `undefined: relationsListHandler`.

- [ ] **Step 3: Write `handlers_relations.go`**

```go
// handlers_relations.go: the relation surface.
//
// A tuple is object#relation@subject, Zanzibar style:
// document:readme#viewer@user:bob.
//
// Two things about tuples that differ from everything else in this contract.
//
// They are create-and-delete only. relation.Store exposes no update, so
// changing a tuple means deleting one and writing another. There is no
// patch input here and no edit form on the page.
//
// Their namespace does NOT cascade. Roles, permissions, policies and
// resource types at an ancestor namespace are in scope for a check in a
// descendant. Tuples are not, because they name concrete pairs and matching
// them across namespaces would be wrong. relation/relation.go's type
// comment says so, and a list that implied otherwise would promise access
// the engine will not grant.
package contract

import (
	"context"
	"time"

	"github.com/xraph/warden/id"
	"github.com/xraph/warden/relation"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// RelationSummary is one tuple.
type RelationSummary struct {
	ID              string `json:"id"`
	NamespacePath   string `json:"namespacePath"`
	ObjectType      string `json:"objectType"`
	ObjectID        string `json:"objectId"`
	Relation        string `json:"relation"`
	SubjectType     string `json:"subjectType"`
	SubjectID       string `json:"subjectId"`
	SubjectRelation string `json:"subjectRelation,omitempty"`
	CreatedBy       string `json:"createdBy,omitempty"`
	CreatedAt       string `json:"createdAt"`
}

// RelationsListInput filters the tuple list. Every field the store's filter
// offers is here, because tracing a tuple means narrowing on whichever end
// you happen to know.
type RelationsListInput struct {
	PageRequest
	NamespacePath   *string `json:"namespacePath,omitempty"`
	ObjectType      string  `json:"objectType,omitempty"`
	ObjectID        string  `json:"objectId,omitempty"`
	Relation        string  `json:"relation,omitempty"`
	SubjectType     string  `json:"subjectType,omitempty"`
	SubjectID       string  `json:"subjectId,omitempty"`
	SubjectRelation string  `json:"subjectRelation,omitempty"`
}

// RelationsListResponse is the paged reply.
type RelationsListResponse struct {
	PageMeta
	Items []RelationSummary `json:"items"`
}

// RelationCreateInput writes one tuple. Every part of the triple is
// required: a tuple missing any of them matches nothing and is reachable by
// no filter, so it is silent junk rather than a partial grant.
type RelationCreateInput struct {
	NamespacePath   string `json:"namespacePath,omitempty"`
	ObjectType      string `json:"objectType"`
	ObjectID        string `json:"objectId"`
	Relation        string `json:"relation"`
	SubjectType     string `json:"subjectType"`
	SubjectID       string `json:"subjectId"`
	SubjectRelation string `json:"subjectRelation,omitempty"`
}

// RelationDeleteInput names the tuple to remove, by id.
//
// The store also offers DeleteRelationTuple, which takes the whole natural
// key. By-id is used here because the list hands the page an id, and an id
// cannot be half-right the way a seven-part key can.
type RelationDeleteInput struct {
	ID string `json:"id"`
}

func parseRelationID(raw string) (id.RelationID, error) {
	rid, err := id.ParseRelationID(raw)
	if err != nil {
		return id.Nil, badRequest("not a relation id: " + raw)
	}
	return rid, nil
}

func projectTuple(tp *relation.Tuple) RelationSummary {
	return RelationSummary{
		ID:              tp.ID.String(),
		NamespacePath:   tp.NamespacePath,
		ObjectType:      tp.ObjectType,
		ObjectID:        tp.ObjectID,
		Relation:        tp.Relation,
		SubjectType:     tp.SubjectType,
		SubjectID:       tp.SubjectID,
		SubjectRelation: tp.SubjectRelation,
		CreatedBy:       tp.CreatedBy,
		CreatedAt:       tp.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func relationsListHandler(deps Deps) func(context.Context, RelationsListInput, dashcontract.Principal) (RelationsListResponse, error) {
	return func(ctx context.Context, in RelationsListInput, p dashcontract.Principal) (RelationsListResponse, error) {
		if err := requireEngine(deps); err != nil {
			return RelationsListResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return RelationsListResponse{}, err
		}
		limit, offset := in.Clamp()
		filter := &relation.ListFilter{
			TenantID:        tenantID,
			NamespacePath:   in.NamespacePath,
			ObjectType:      in.ObjectType,
			ObjectID:        in.ObjectID,
			Relation:        in.Relation,
			SubjectType:     in.SubjectType,
			SubjectID:       in.SubjectID,
			SubjectRelation: in.SubjectRelation,
			Limit:           limit,
			Offset:          offset,
		}
		s := deps.Engine.Store()
		rows, err := s.ListRelations(ctx, filter)
		if err != nil {
			return RelationsListResponse{}, mapWardenError(err)
		}
		total, err := s.CountRelations(ctx, filter)
		if err != nil {
			return RelationsListResponse{}, mapWardenError(err)
		}
		out := RelationsListResponse{
			PageMeta: newPageMeta(total, limit, offset),
			Items:    make([]RelationSummary, 0, len(rows)),
		}
		for _, tp := range rows {
			out.Items = append(out.Items, projectTuple(tp))
		}
		return out, nil
	}
}

func relationsCreateHandler(deps Deps) func(context.Context, RelationCreateInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RelationCreateInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		for field, value := range map[string]string{
			"objectType":  in.ObjectType,
			"objectId":    in.ObjectID,
			"relation":    in.Relation,
			"subjectType": in.SubjectType,
			"subjectId":   in.SubjectID,
		} {
			if value == "" {
				return AckResponse{}, badRequest("a relation needs " + field)
			}
		}
		if err := validateNamespace(in.NamespacePath); err != nil {
			return AckResponse{}, err
		}
		tp := &relation.Tuple{
			TenantID:        tenantID,
			NamespacePath:   in.NamespacePath,
			ObjectType:      in.ObjectType,
			ObjectID:        in.ObjectID,
			Relation:        in.Relation,
			SubjectType:     in.SubjectType,
			SubjectID:       in.SubjectID,
			SubjectRelation: in.SubjectRelation,
		}
		if err := deps.Engine.Store().CreateRelation(ctx, tp); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{ID: tp.ID.String()}, nil
	}
}

func relationsDeleteHandler(deps Deps) func(context.Context, RelationDeleteInput, dashcontract.Principal) (AckResponse, error) {
	return func(ctx context.Context, in RelationDeleteInput, p dashcontract.Principal) (AckResponse, error) {
		if err := requireEngine(deps); err != nil {
			return AckResponse{}, err
		}
		tenantID, err := tenantFrom(p, deps)
		if err != nil {
			return AckResponse{}, err
		}
		rid, err := parseRelationID(in.ID)
		if err != nil {
			return AckResponse{}, err
		}
		if err := deps.Engine.Store().DeleteRelation(ctx, tenantID, rid); err != nil {
			return AckResponse{}, mapWardenError(err)
		}
		return AckResponse{}, nil
	}
}
```

`relation.Store` has no `GetRelation`, so the delete cannot read first the way the role and assignment deletes do. Check whether `DeleteRelation` returns `ErrRelationNotFound` when the row belongs to another tenant. If it does, the test above passes as written. If it silently succeeds, say so in your report: that is the same class of bug as plan 2a's `DetachPermission` finding, and the handler will need a pre-check built from `ListRelations` filtered to that id.

- [ ] **Step 4: Register, declare, extend the guards, run, commit**

Three registrations in `contract.go` (`relations.list` a query, `relations.create` and `relations.delete` commands). In `manifest.yaml`:

```yaml
  - { name: relations.list, kind: query, version: 1, capability: read }
  # A tuple change alters the list and the counters. It does NOT change any
  # role or permission surface: tuples are ReBAC and grant through the graph
  # walker rather than through a role.
  - { name: relations.create, kind: command, version: 1, capability: write,
      invalidates: [relations.list, overview.stats, namespaces.list] }
  - { name: relations.delete, kind: command, version: 1, capability: write,
      invalidates: [relations.list, overview.stats] }
```

and a `relationList` query entry with `staleTime: 30s`. Add all three to both guard tests. Then:

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./... && git commit -m "feat(contract): read and write relation tuples" -- extension/contract
```

---

## Task 3: The five resource-type intents, with expression validation

Resource types declare the ReBAC schema: which relations a type has, and which permissions derive from them. The permission expressions are a real mini-language, and nothing validates them today.

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_resourcetypes.go`
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/handlers_resourcetypes_test.go`
- Modify: `contract.go`, `manifest.yaml`, `handlers_tenant_test.go`, `manifest_test.go`

**Interfaces:**
- Consumes: the usual shared helpers.
- Produces: `ResourceTypeSummary`, `ResourceTypeDetail`, `RelationDefDTO`, `PermissionDefDTO`, `ResourceTypesListInput`, `ResourceTypesListResponse`, `ResourceTypeDetailInput`, `ResourceTypeCreateInput`, `ResourceTypeUpdateInput`, `ResourceTypeDeleteInput`, `ExpressionDiagnostic`. Tasks 7 and 8 use them.

- [ ] **Step 1: Write the failing tests**

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/warden/resourcetype"
	"github.com/xraph/warden/store/memory"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func seedResourceType(t *testing.T, s *memory.Store, namespace, name string) *resourcetype.ResourceType {
	t.Helper()
	rt := &resourcetype.ResourceType{
		TenantID:      "t1",
		NamespacePath: namespace,
		Name:          name,
		Relations: []resourcetype.RelationDef{
			{Name: "viewer", AllowedSubjects: []string{"user"}},
		},
		Permissions: []resourcetype.PermissionDef{
			{Name: "read", Expression: "viewer"},
		},
	}
	if err := s.CreateResourceType(context.Background(), rt); err != nil {
		t.Fatalf("create resource type %q: %v", name, err)
	}
	return rt
}

func TestResourceTypesListPagesAndCounts(t *testing.T) {
	s := memory.New()
	seedResourceType(t, s, "", "document")
	seedResourceType(t, s, "", "folder")
	h := resourceTypesListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), ResourceTypesListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("resourceTypes.list: %v", err)
	}
	if got.Total != 2 {
		t.Errorf("total = %d, want 2", got.Total)
	}
}

func TestResourceTypesListCarriesCountsNotWholeDefinitions(t *testing.T) {
	// A list row showing every relation and expression of every type is a
	// wall of text. The counts are the scannable thing; the detail page
	// carries the definitions.
	s := memory.New()
	seedResourceType(t, s, "", "document")
	h := resourceTypesListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), ResourceTypesListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("resourceTypes.list: %v", err)
	}
	if got.Items[0].RelationCount != 1 || got.Items[0].PermissionCount != 1 {
		t.Errorf("counts = %d/%d, want 1/1", got.Items[0].RelationCount, got.Items[0].PermissionCount)
	}
}

func TestResourceTypesListIsScopedToItsOwnTenant(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	seedResourceType(t, s, "", "mine")
	other := &resourcetype.ResourceType{TenantID: "t2", Name: "theirs"}
	if err := s.CreateResourceType(ctx, other); err != nil {
		t.Fatalf("create other tenant's type: %v", err)
	}
	h := resourceTypesListHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(ctx, ResourceTypesListInput{}, principalFor("t1"))
	if err != nil {
		t.Fatalf("resourceTypes.list: %v", err)
	}
	for _, rt := range got.Items {
		if rt.Name == "theirs" {
			t.Fatal("t1 can see t2's resource type: tenant scoping is not applied")
		}
	}
	if got.Total != 1 {
		t.Errorf("total = %d, want 1", got.Total)
	}
}

func TestResourceTypesDetailCarriesRelationsAndExpressions(t *testing.T) {
	s := memory.New()
	rt := seedResourceType(t, s, "", "document")
	h := resourceTypesDetailHandler(Deps{Engine: engineOver(t, s)})

	got, err := h(context.Background(), ResourceTypeDetailInput{ID: rt.ID.String()}, principalFor("t1"))
	if err != nil {
		t.Fatalf("resourceTypes.detail: %v", err)
	}
	if len(got.Relations) != 1 || got.Relations[0].Name != "viewer" {
		t.Errorf("relations = %+v, want one viewer", got.Relations)
	}
	if len(got.Permissions) != 1 || got.Permissions[0].Expression != "viewer" {
		t.Errorf("permissions = %+v, want one read=viewer", got.Permissions)
	}
	// Non-nil so the JSON carries [] rather than null: a page doing
	// data.relations.length on null throws.
	if got.Relations == nil || got.Permissions == nil {
		t.Error("slices must be non-nil")
	}
}

func TestResourceTypesCreateRefusesAnUnparseableExpression(t *testing.T) {
	// The finding. dsl.CompileExpr exists and returns diagnostics carrying
	// Pos{Line, Col}, and it is called only by the DSL exporter and the
	// evaluator's lazy compile. api/resourcetype_handler.go copies
	// Expression straight through, so an invalid expression saves fine and
	// then fails silently at check time: evaluateReBAC logs a warning and
	// treats it as no match. The permission simply never grants, with no
	// error anywhere an operator will look.
	s := memory.New()
	h := resourceTypesCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), ResourceTypeCreateInput{
		Name: "document",
		Relations: []RelationDefDTO{{Name: "viewer", AllowedSubjects: []string{"user"}}},
		Permissions: []PermissionDefDTO{{Name: "read", Expression: "viewer or or editor"}},
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal for an unparseable expression")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Fatalf("want CodeBadRequest, got %v", err)
	}
	if !containsText(ce.Message, "read") {
		t.Errorf("message %q does not name which permission failed", ce.Message)
	}
}

func TestResourceTypesCreateReportsTheDiagnosticPosition(t *testing.T) {
	// Diagnostics carry Line and Col, which is what lets an editor mark the
	// exact column. Dropping them would waste the only precise thing the
	// parser gives us.
	s := memory.New()
	h := resourceTypesCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), ResourceTypeCreateInput{
		Name:        "document",
		Permissions: []PermissionDefDTO{{Name: "read", Expression: "viewer or or editor"}},
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) {
		t.Fatalf("want a contract error, got %v", err)
	}
	if len(ce.Details) == 0 {
		t.Fatal("the error carries no diagnostics: the page cannot mark the column")
	}
}

func TestResourceTypesCreateAcceptsAValidExpression(t *testing.T) {
	s := memory.New()
	h := resourceTypesCreateHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(context.Background(), ResourceTypeCreateInput{
		Name: "document",
		Relations: []RelationDefDTO{
			{Name: "viewer", AllowedSubjects: []string{"user"}},
			{Name: "editor", AllowedSubjects: []string{"user"}},
		},
		Permissions: []PermissionDefDTO{{Name: "read", Expression: "viewer or editor"}},
	}, principalFor("t1")); err != nil {
		t.Fatalf("a valid expression must be accepted, got %v", err)
	}
}

func TestResourceTypesCreateRefusesAnExpressionNamingAnUndeclaredRelation(t *testing.T) {
	// An expression that parses can still reference a relation the type
	// does not declare, and then it can never match. The parser cannot
	// catch this; only the type's own relation list can.
	s := memory.New()
	h := resourceTypesCreateHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(context.Background(), ResourceTypeCreateInput{
		Name:        "document",
		Relations:   []RelationDefDTO{{Name: "viewer", AllowedSubjects: []string{"user"}}},
		Permissions: []PermissionDefDTO{{Name: "read", Expression: "viewer or ghost"}},
	}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal for an expression naming an undeclared relation")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeBadRequest {
		t.Errorf("want CodeBadRequest, got %v", err)
	}
	if !containsText(ce.Message, "ghost") {
		t.Errorf("message %q does not name the undeclared relation", ce.Message)
	}
}

func TestResourceTypesUpdateLeavesOmittedFieldsAlone(t *testing.T) {
	// UpdateResourceType persists the whole struct, the same trap
	// UpdateRole carries. Update only the description and the relations and
	// permissions must survive.
	s := memory.New()
	ctx := context.Background()
	rt := seedResourceType(t, s, "", "document")
	h := resourceTypesUpdateHandler(Deps{Engine: engineOver(t, s)})

	desc := "a document"
	if _, err := h(ctx, ResourceTypeUpdateInput{ID: rt.ID.String(), Description: &desc}, principalFor("t1")); err != nil {
		t.Fatalf("resourceTypes.update: %v", err)
	}
	after, err := s.GetResourceType(ctx, "t1", rt.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if after.Description != "a document" {
		t.Errorf("description = %q, want updated", after.Description)
	}
	if len(after.Relations) != 1 || len(after.Permissions) != 1 {
		t.Errorf("the update erased definitions: %d relations, %d permissions",
			len(after.Relations), len(after.Permissions))
	}
}

func TestResourceTypesUpdateValidatesReplacedExpressions(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	rt := seedResourceType(t, s, "", "document")
	h := resourceTypesUpdateHandler(Deps{Engine: engineOver(t, s)})

	bad := []PermissionDefDTO{{Name: "read", Expression: "viewer or or editor"}}
	_, err := h(ctx, ResourceTypeUpdateInput{ID: rt.ID.String(), Permissions: &bad}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal for an unparseable expression on update")
	}
	after, getErr := s.GetResourceType(ctx, "t1", rt.ID)
	if getErr != nil {
		t.Fatalf("get: %v", getErr)
	}
	if after.Permissions[0].Expression != "viewer" {
		t.Errorf("the refused update changed the stored expression to %q", after.Permissions[0].Expression)
	}
}

func TestResourceTypesUpdateCanEmptyTheDefinitions(t *testing.T) {
	// A pointer to an empty slice means "remove them all", distinct from
	// nil meaning "leave them alone". Without the pointer there is no way
	// to clear a definition list from the UI.
	s := memory.New()
	ctx := context.Background()
	rt := seedResourceType(t, s, "", "document")
	h := resourceTypesUpdateHandler(Deps{Engine: engineOver(t, s)})

	empty := []PermissionDefDTO{}
	if _, err := h(ctx, ResourceTypeUpdateInput{ID: rt.ID.String(), Permissions: &empty}, principalFor("t1")); err != nil {
		t.Fatalf("resourceTypes.update: %v", err)
	}
	after, err := s.GetResourceType(ctx, "t1", rt.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(after.Permissions) != 0 {
		t.Errorf("permissions = %+v, want cleared", after.Permissions)
	}
}

func TestResourceTypesDeleteRefusesWhileTuplesReferenceIt(t *testing.T) {
	// Deleting a type whose tuples still exist leaves those tuples
	// referencing a schema that is gone, and the graph walker then cannot
	// resolve any derived permission through them. Refuse and say how many.
	s := memory.New()
	ctx := context.Background()
	rt := seedResourceType(t, s, "", "document")
	seedTuple(t, s, "", "document", "readme", "viewer", "user", "alice")
	h := resourceTypesDeleteHandler(Deps{Engine: engineOver(t, s)})

	_, err := h(ctx, ResourceTypeDeleteInput{ID: rt.ID.String()}, principalFor("t1"))
	if err == nil {
		t.Fatal("want a refusal deleting a type that tuples still reference")
	}
	var ce *dashcontract.Error
	if !errorsAs(err, &ce) || ce.Code != dashcontract.CodeConflict {
		t.Fatalf("want CodeConflict, got %v", err)
	}
	if _, getErr := s.GetResourceType(ctx, "t1", rt.ID); getErr != nil {
		t.Errorf("the refusal did not prevent the delete: %v", getErr)
	}
}

func TestResourceTypesDeleteRemovesAnUnreferencedType(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	rt := seedResourceType(t, s, "", "orphan")
	h := resourceTypesDeleteHandler(Deps{Engine: engineOver(t, s)})

	if _, err := h(ctx, ResourceTypeDeleteInput{ID: rt.ID.String()}, principalFor("t1")); err != nil {
		t.Fatalf("resourceTypes.delete: %v", err)
	}
	if _, err := s.GetResourceType(ctx, "t1", rt.ID); err == nil {
		t.Fatal("the type is still there")
	}
}
```

`dashcontract.Error` may have no `Details` field. Read `forge/extensions/dashboard/contract/errors.go` before writing the diagnostic-position test. If there is no structured field, carry the diagnostics in the message in a form the page can parse, or add a typed response, and adjust that one test to match what you built. The requirement is that line and column reach the client; the shape is yours.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/... -run ResourceTypes -v
```

Expected: compile failure, `undefined: resourceTypesListHandler`.

- [ ] **Step 3: Write `handlers_resourcetypes.go`**

The file's own header should say why expression validation lives here:

```go
// handlers_resourcetypes.go: the ReBAC schema surface.
//
// A resource type declares its relations (viewer, editor, parent) and the
// permissions derived from them (read = viewer or editor or parent->read).
//
// Those expressions are a real language with a real parser, dsl.CompileExpr,
// which returns diagnostics carrying Pos{Line, Col}. Nothing calls it on a
// write. api/resourcetype_handler.go copies Expression straight through, and
// the store stores whatever it is handed. An invalid expression therefore
// saves without complaint and fails at CHECK time, where evaluateReBAC logs
// a warning and treats it as no match. The permission silently never grants,
// and nothing an operator can see says why.
//
// So this file validates on write, twice. First the expression must parse.
// Second, every relation it names must be one the type declares, which the
// parser cannot know and which is the other way to write an expression that
// can never match.
package contract
```

Implement:

- `ResourceTypeSummary{ID, NamespacePath, Name, Description, RelationCount, PermissionCount, CreatedAt, UpdatedAt}` with camelCase tags. Counts rather than full definitions, per the test.
- `ResourceTypeDetail` embedding the summary plus `Relations []RelationDefDTO` and `Permissions []PermissionDefDTO`, both initialised non-nil.
- `RelationDefDTO{Name string, AllowedSubjects []string}` and `PermissionDefDTO{Name, Expression string}`, mirroring `resourcetype.RelationDef` and `PermissionDef`.
- `validateDefinitions(relations []RelationDefDTO, permissions []PermissionDefDTO) error`, which: requires every relation and permission to have a name; runs `dsl.CompileExpr("<permission>", p.Expression)` on each expression and turns its diagnostics into a `BAD_REQUEST` naming the permission and carrying line and column; and checks every bare identifier the expression references against the declared relation names, refusing an undeclared one by name.
- The five handlers, each opening with `requireEngine` then `tenantFrom(p, deps)`.
- `resourceTypesUpdateHandler` reads, patches only the present pointers, then writes. `Description *string`, `Relations *[]RelationDefDTO`, `Permissions *[]PermissionDefDTO`. When either definition list is present, validate the resulting pair together, because a permission expression's validity depends on the relations it is checked against.
- `resourceTypesDeleteHandler` reads the type, counts tuples whose `ObjectType` equals its name using `CountRelations`, and refuses with `CONFLICT` naming the count if any exist.

For the undeclared-relation check, read `dsl/ast.go` to see how an expression's identifiers are exposed. If walking the AST is impractical, a lexical pass over the expression's identifier tokens using `dsl`'s lexer is acceptable; say in your report which you did and what it cannot catch.

- [ ] **Step 4: Register, declare, extend the guards, run, commit**

Five registrations. In `manifest.yaml`:

```yaml
  - { name: resourceTypes.list,   kind: query, version: 1, capability: read }
  - { name: resourceTypes.detail, kind: query, version: 1, capability: read }
  # A schema change alters what the graph walker can derive, so it affects
  # the relations surface as well as its own.
  - { name: resourceTypes.create, kind: command, version: 1, capability: write,
      invalidates: [resourceTypes.list, overview.stats, namespaces.list] }
  - { name: resourceTypes.update, kind: command, version: 1, capability: write,
      invalidates: [resourceTypes.list, resourceTypes.detail] }
  - { name: resourceTypes.delete, kind: command, version: 1, capability: write,
      invalidates: [resourceTypes.list, resourceTypes.detail, overview.stats] }
```

plus `resourceTypeList` and `resourceTypeDetail` query entries at `staleTime: 30s`. Add all five to both guard tests.

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go test ./... && git commit -m "feat(contract): resource types, validating the expressions nothing validated" -- extension/contract
```

---

## Task 4: The fixture server's twelve handlers

Before the pages, so they have something to run against.

**Files:**
- Modify: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/fixture-server/warden-fixtures.mjs`

**Interfaces:**
- Consumes: the twelve intent names and their exact response shapes from Tasks 1 to 3.
- Produces: twelve fixture handlers plus seed. Tasks 5 to 9 run against them.

- [ ] **Step 1: Read what exists**

The file already holds warden's seed and nineteen handlers, plus the helpers `pageOf`, `byNamespace`, `notFound`, `badRequest`, `permissionDenied`, `conflict` and the local `WardenFixtureError`. Read them, and read the Go DTOs from Tasks 1 to 3 for the exact field names.

Note the established local-error pattern: `server.mjs` tests `instanceof` against its own private class, which this module cannot satisfy, so refusals surface as 400 with the right message. That is known and accepted; match the message, not the status.

- [ ] **Step 2: Extend the seed**

Add assignments with a spread of expiry states, tuples, and resource types. The point is that every interesting answer is reachable:

- an assignment with no expiry, one expiring soon (inside a day), one expiring far out, and one ALREADY EXPIRED, because the expired case is the whole reason the list carries `expired`
- a role with `maxMembers: 2` already holding two live members, so the cap refusal is reachable by hand
- tuples in two namespaces, and a two-hop chain (`folder:root#parent@document:readme` plus `document:readme#viewer@user:bob`), because a chain is what the relations page exists to let somebody trace
- a resource type with two relations and a derived permission expression that references both

- [ ] **Step 3: Add the twelve handlers**

Mirror every refusal the Go handlers make, because a fixture that forgives what the server rejects hides the bug it exists to expose:

- `assignments.create` refuses an unknown `subjectKind`, an `expiresAt` that is not RFC3339, an `expiresAt` already past, and a role at its member cap counting only LIVE members
- `assignments.create` ACCEPTS a system role, matching Go, since bootstrap assigns to one
- `assignments.list` computes `expired` per row rather than storing it, and does not hide expired rows
- `assignments.expiring` defaults its window when none is given
- `relations.create` refuses any missing part of the triple and a duplicate tuple
- `relations.list` does NOT cascade namespaces
- `resourceTypes.create` and `update` refuse an unparseable expression and one naming an undeclared relation
- `resourceTypes.update` patches only present fields
- `resourceTypes.delete` refuses while tuples reference the type, naming the count

- [ ] **Step 4: Verify over the wire**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
```

Note the PID and kill only that process afterwards. Do NOT `pkill -f server.mjs`: other sessions run one.

```bash
sleep 2 && node packages/fixture-server/verify.mjs http://localhost:8099
```

Then check by hand, with curl, that each refusal above actually refuses and that state is unchanged afterwards. Report the response bodies.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git commit -m "feat(fixture): answer warden's assignment, relation and resource type intents" -- packages/fixture-server/warden-fixtures.mjs
```

Only that file. Do NOT commit `server.mjs`: its committed version still has no warden wiring at all, that wiring lives only in another session's uncommitted copy, and committing it is permission-blocked.

---

## Task 5: The assignments page

**Files:**
- Create: `packages/plugin-warden/src/pages/assignments.tsx`
- Create: `packages/plugin-warden/test/assignments.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: `useNamespaceFilter`, `NamespaceCell`, `emptyListMessage` from `components/namespace-filter`; `AckResponse` from `pages/roles`; the harness.
- Produces: `WardenAssignmentsPage`, `AssignmentSummary`, `AssignmentsList`.

- [ ] **Step 1: Write the failing tests**

The tests that matter most on this page, in order:

```tsx
it("marks an expired assignment as granting nothing", async () => {
  // The whole reason this page exists in this shape. The engine filters
  // expired assignments when it resolves roles, so an expired row grants
  // nothing, but the listing does not filter them. A row shown plainly
  // would tell an operator somebody has access they do not have.
  renderPage(WardenAssignmentsPage, client())
  const row = (await screen.findByText("gone")).closest("tr")!
  expect(within(row).getByText(/expired/i)).toBeTruthy()
})

it("does not mark a future expiry or a permanent binding", async () => {
  renderPage(WardenAssignmentsPage, client())
  const soon = (await screen.findByText("soon")).closest("tr")!
  expect(within(soon).queryByText(/expired/i)).toBeNull()
  const forever = (await screen.findByText("forever")).closest("tr")!
  expect(within(forever).queryByText(/expired/i)).toBeNull()
})

it("shows a permanent binding as permanent rather than blank", async () => {
  // A blank expiry cell reads as "still loading" or "broken", and is
  // silent to a screen reader.
  renderPage(WardenAssignmentsPage, client())
  const forever = (await screen.findByText("forever")).closest("tr")!
  expect(within(forever).getByText(/never/i)).toBeTruthy()
})

it("names the role by slug, not by id", async () => {
  renderPage(WardenAssignmentsPage, client())
  expect(await screen.findByText("reader")).toBeTruthy()
  expect(screen.queryByText(/^role_/)).toBeNull()
})

it("says which kind of empty an empty list is", async () => { /* filtered vs unfiltered, via emptyListMessage */ })
it("offers no edit control, and says why", async () => {
  // assignment.Store exposes no update, so there is nothing to offer. The
  // page says so rather than leaving the absence unexplained.
})
it("sends the exact create payload", async () => { /* recordingCommandClient, toEqual */ })
it("shows the member-cap refusal inside the dialog", async () => { /* failingClient throwing CONFLICT */ })
it("resets paging when the namespace filter changes", async () => { /* recordingQueryClient, offset: 0 */ })
```

Write them in full, with a fixture carrying `gone` (past expiry), `soon` (future), `forever` (none), following the shape of `packages/plugin-warden/test/roles.test.tsx`.

- [ ] **Step 2: Run to verify they fail, then implement**

Columns: subject (`font-medium`, rendered `kind:id`), role (slug, `font-mono text-xs`, linking to `/roles/:id`), scope (the resource type and id when present, else `NoneCell`), namespace (`NamespaceCell`), expiry (`Timestamp` when set, the word "Never" when not), status, and a delete action.

The status column is where the finding lands. Most assignments are live, so live is the majority and takes no badge at all; `expired` takes `destructive`, because an operator scanning this page for "why does this person still have access" or "why does this person not" is looking for exactly that row.

The page carries one line saying assignments cannot be edited, only created and deleted, because `assignment.Store` has no update. An absence with no explanation reads as a missing feature.

- [ ] **Step 3: Wire the route and nav, verify, commit**

Route `/assignments`, nav entry under "Authorization" at priority 30 with a `UsersIcon`. Then:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): add the assignments page, with expiry made honest" -- packages/plugin-warden
```

---

## Task 6: The relations page

**Files:**
- Create: `packages/plugin-warden/src/pages/relations.tsx`
- Create: `packages/plugin-warden/test/relations.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: the namespace filter helpers, `AckResponse`, the harness.
- Produces: `WardenRelationsPage`, `RelationSummary`, `RelationsList`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders a tuple in its Zanzibar form", async () => {
  // document:readme#viewer@user:bob is how this domain is written
  // everywhere else, including warden's own docs and the DSL. Six separate
  // columns would make an operator reassemble it in their head.
  renderPage(WardenRelationsPage, client())
  expect(await screen.findByText(/document:readme#viewer@user:bob/)).toBeTruthy()
})

it("says that a relation's namespace does not cascade", async () => {
  // Roles, permissions, policies and resource types resolve up the
  // ancestor chain. Tuples do not. A page that did not say so would imply
  // access the engine will not grant.
  renderPage(WardenRelationsPage, client())
  expect(await screen.findByText(/does not cascade/i)).toBeTruthy()
})

it("offers no edit control, and says why", async () => { /* no update in the store */ })
it("filters by each end of the triple", async () => { /* object and subject filters both reach the wire */ })
it("sends the exact create payload", async () => { /* toEqual, all five required parts */ })
it("says which kind of empty an empty list is", async () => { /* emptyListMessage */ })
it("resets paging when the namespace filter changes", async () => { /* offset: 0 */ })
it("shows a duplicate-tuple refusal inside the dialog", async () => { /* throwing client */ })
```

- [ ] **Step 2: Implement**

The tuple column renders `objectType:objectId#relation@subjectType:subjectId` in `font-mono text-xs`, because that is a raw value somebody copies into a check or a DSL file. Keep the parts as separate filter inputs even though they render as one string: filtering is how you trace a chain, and the whole point is narrowing on whichever end you know.

One line on the page says a tuple's namespace does not cascade, unlike everything else in warden.

One line says tuples cannot be edited, only created and deleted.

- [ ] **Step 3: Wire, verify, commit**

Route `/relations`, nav under "Relationships" at priority 20 with a `LinkIcon`.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): add the relations page" -- packages/plugin-warden
```

---

## Task 7: The resource types list and detail pages

**Files:**
- Create: `packages/plugin-warden/src/pages/resource-types.tsx`
- Create: `packages/plugin-warden/src/pages/resource-type-detail.tsx`
- Create: `packages/plugin-warden/test/resource-types.test.tsx`
- Create: `packages/plugin-warden/test/resource-type-detail.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: the namespace filter helpers, `AckResponse`, the harness.
- Produces: `WardenResourceTypesPage`, `WardenResourceTypeDetailPage`, `ResourceTypeSummary`, `ResourceTypeDetail`, `RelationDef`, `PermissionDef`.

- [ ] **Step 1: Write the failing tests**

The list page is a table of name, namespace, relation count, permission count, updated, with create and delete. Its tests follow the roles page's shape.

The detail page is where the thought goes:

```tsx
it("renders each permission as a name and its expression", async () => {
  renderPage(WardenResourceTypeDetailPage, client(), { id: "rt_01a" })
  expect(await screen.findByText("read")).toBeTruthy()
  expect(await screen.findByText("viewer or editor")).toBeTruthy()
})

it("shows an expression in monospace, because it is a raw value", async () => {
  renderPage(WardenResourceTypeDetailPage, client(), { id: "rt_01a" })
  const expr = await screen.findByText("viewer or editor")
  expect(expr.className).toContain("font-mono")
})

it("lists each relation with the subject types it allows", async () => {
  renderPage(WardenResourceTypeDetailPage, client(), { id: "rt_01a" })
  const row = (await screen.findByText("viewer")).closest("tr")!
  expect(within(row).getByText("user")).toBeTruthy()
})

it("marks an expression that references an undeclared relation", async () => {
  // The server refuses this on write, but a type written through the DSL
  // or the REST API can carry one. The page must not render it as though
  // it works, because it can never match.
  renderPage(WardenResourceTypeDetailPage, clientWithDanglingExpression(), { id: "rt_01a" })
  const row = (await screen.findByText("read")).closest("tr")!
  expect(within(row).getByText(/ghost/)).toBeTruthy()
})

it("shows the server's diagnostic against the expression that failed", async () => {
  // resourceTypes.update refuses an unparseable expression with a
  // diagnostic carrying a line and column. Showing it against the right
  // expression is the whole value of having it.
})

it("says which kind of empty a type with no relations is", async () => { /* not a generic No rows */ })
it("sends only the fields the operator changed", async () => { /* toEqual, pointer semantics */ })
```

- [ ] **Step 2: Implement**

Read `packages/plugin-warden/src/pages/role-detail.tsx` for the established `DetailLayout` shape.

The detail page has two tables in the main column. Relations: name (`font-medium`), allowed subject types (`TagList`, since a relation with no allowed subjects is a real and broken state that must not render blank). Permissions: name (`font-medium`), expression (`font-mono text-xs`).

An expression referencing a relation the type does not declare gets marked, because the server refuses those on write but a type created through the DSL or the REST API can carry one, and it can never match. Compute the check client-side from the type's own relation list.

The edit form sends `Relations` and `Permissions` as present-or-absent, so a nil means "leave alone" and an empty array means "remove them all". When the server refuses with a diagnostic, show it against the expression that failed rather than at the top of the form.

- [ ] **Step 3: Wire, verify, commit**

Routes `/resource-types` and `/resource-types/:id`; nav entry for the list only, under "Relationships" at priority 10 with a `LayersIcon`. No nav entry for the detail page: a link to "a resource type" with none chosen points nowhere.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): add the resource type pages" -- packages/plugin-warden
```

---

## Task 8: The permission detail page

`permissions.detail` was built in plan 2a and has been consumed by nothing since. Plan 2a removed two dead links to this page and recorded that it belongs here.

**Files:**
- Create: `packages/plugin-warden/src/pages/permission-detail.tsx`
- Create: `packages/plugin-warden/test/permission-detail.test.tsx`
- Modify: `packages/plugin-warden/src/pages/permissions.tsx` (restore the row link), `packages/plugin-warden/src/pages/role-detail.tsx` (restore the grant link), `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: `PermissionSummary` from `pages/role-detail`, `AckResponse`, `NamespaceCell`, the harness.
- Produces: `WardenPermissionDetailPage`, `PermissionDetail`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("answers who grants this permission", async () => {
  // The question an operator opens this page for. permissions.detail's
  // grantedBy exists precisely to answer it.
  renderPage(WardenPermissionDetailPage, client(), { id: "perm_01a" })
  expect(await screen.findByText("reader")).toBeTruthy()
})

it("says which kind of empty a permission nothing grants is", async () => {
  renderPage(WardenPermissionDetailPage, clientWithNoHolders(), { id: "perm_01a" })
  expect(await screen.findByText(/no role grants/i)).toBeTruthy()
})

it("shows resource and action separately from the name", async () => {
  // A check matches on resource and action, never on the name, so these
  // are the fields that decide whether it will be found.
})

it("marks a system permission and offers no delete", async () => { /* both halves */ })
it("links each granting role to its own page", async () => { /* PluginLink, scope-relative */ })
it("surfaces a read failure rather than a blank page", async () => { /* throwing client */ })
```

Also add, to `permissions.test.tsx` and `role-detail.test.tsx`, tests that the Details links are back and point at `/permissions/:id`. Plan 2a added tests asserting those links were ABSENT; those tests must be replaced, not left contradicting the new behaviour.

- [ ] **Step 2: Implement and restore the links**

`DetailLayout` with the permission's fields in the aside and a `grantedBy` table in the main column. The empty state says "No role grants this permission." rather than a generic empty, because a permission nothing grants is a meaningful state and not an error.

Restore the row link in `permissions.tsx` and the grant link in `role-detail.tsx`, both `to={`/permissions/${p.id}`}` through `PluginLink`, and register the route.

- [ ] **Step 3: Wire, verify, commit**

Route `/permissions/:id`, no nav entry.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): add the permission detail page and restore its links" -- packages/plugin-warden
```

---

## Task 9: The role edit form

`roles.update` and `roles.setPermissions` were both built in plan 2a and neither has a caller. So the dashboard cannot rename a role, change its parent, or replace its grant set in one go, and the system-role alert says a role "cannot be edited" when no role has an edit control at all.

**Files:**
- Modify: `packages/plugin-warden/src/pages/role-detail.tsx`
- Modify: `packages/plugin-warden/test/role-detail.test.tsx`

**Interfaces:**
- Consumes: `roles.update`, `roles.setPermissions`, both already registered and manifest-declared.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

```tsx
it("sends only the fields the operator changed", async () => {
  // roles.update's optional fields are pointers: nil means leave alone, a
  // pointer to the zero value means clear. On the wire that is an absent
  // key versus a present empty one. Sending every field would silently
  // overwrite what nobody touched.
  const { client, sent } = recordingCommandClient({...}, { "roles.update": { id: "role_01hq" } })
  renderPage(WardenRoleDetailPage, client, { id: "role_01hq" })
  fireEvent.click(await screen.findByRole("button", { name: /edit/i }))
  fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: "Renamed" } })
  fireEvent.click(screen.getByRole("button", { name: /save/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].payload).toEqual({ id: "role_01hq", name: "Renamed" })
})

it("can clear the parent deliberately", async () => {
  // A present empty string, distinct from omitting the field.
  expect(sent[0].payload).toEqual({ id: "role_01hq", parentSlug: "" })
})

it("offers no edit on a system role, and says why", async () => { /* both halves, and the alert is now true */ })
it("keeps what the operator typed when a save fails", async () => { /* throwing client, form stays open, values survive */ })
it("replaces the whole grant set in one call", async () => { /* roles.setPermissions payload, toEqual */ })
it("can revoke everything with an empty set", async () => { /* permissions: [] is a real instruction */ })
```

- [ ] **Step 2: Implement**

An Edit button on the role detail page, hidden for a system role, opening a form over the same fields the aside shows: name, description, parentSlug, maxMembers, isDefault. It builds its payload from only the fields that differ from what was loaded, so an untouched field is an absent key rather than a present unchanged one.

`roles.setPermissions` gets a "Replace all" control beside the existing attach and revoke, taking the whole set at once. That is what the intent is for, and doing it one attach at a time is several writes where one would do.

The system-role alert's wording becomes true once an edit control exists for ordinary roles.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint && git commit -m "feat(warden): let a role be edited, consuming the intents that had no caller" -- packages/plugin-warden
```

---

## Done when

- `go build ./... && go test ./...` clean in warden.
- `pnpm --filter @forge-go/dashboard-plugin-warden test`, `typecheck` and `lint` clean.
- The fixture server answers all thirty-one warden intents, and every refusal in Task 4 Step 4 refuses by hand with state unchanged.
- `Role.MaxMembers` refuses past its cap, counting only live members, with a test.
- An expired assignment is marked as granting nothing, with a test.
- An unparseable permission expression is refused on both create and update, with the diagnostic's line and column reaching the client.
- No intent in `warden/extension/contract` lacks a caller, except any this plan explicitly records as deferred.

## Carried forward, and not this plan's to fix

- **`apps/shell` does not typecheck at HEAD.** A peer session's uncommitted `packages/host/src/ForgeDashboard.tsx` is three additive lines short of the `headerActions` prop the committed `App.tsx` passes. Committing their file has been refused four times by the permission classifier. Do not run `pnpm -r test` and conclude this plan broke something.
- **Warden is not wired into the fixture server at committed HEAD.** `server.mjs`'s committed version contains no warden at all; the import and `CONTRIBUTORS` entry live only in another session's uncommitted copy, which also depends on two untracked modules. So the fixture works in the working tree and not from a fresh checkout.
- **`ListCheckLogs` has no defined order,** and the memory backend returns oldest-first while the other three return newest-first. Plan 3 owns the check log and must add a `RunCheckLogOrderingContract` to `store/contract/` before building its list page, or the first page will show the oldest rows.
- **`mapWardenError`'s default returns raw store text to the browser.** Recorded in plan 2a's review; worth sanitising before more handlers rely on it.
- Two Minors from plan 2a's final re-review: `emptyListMessage` treats a whitespace-only search as truthy, and the permissions page's delete step-back has no test.
