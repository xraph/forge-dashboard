# Warden subject access view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give warden one page that answers what a subject can do and why, add a batch run to the playground, and link every place that names a subject to that page.

**Architecture:** Core gains two exported pieces the engine already has privately: role resolution for a subject at a namespace (direct and inherited through `parentSlug`), and the policy subject matcher. The contract assembles `subjects.detail` from them plus existing store reads, so the page's roles and policies come from the engine's own logic, not a copy. `playground.batchCheck` runs up to `MaxBatchChecks` dry-run checks. `namespaces.list` also scans recent check logs, so the namespace filters can pick the leaf namespaces where checks actually run.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0`, React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, slice 12 ("Subject access view"), plus `playground.batchCheck` from the intent table.

**Predecessors:** plans `2026-09-23-warden-spine.md` through `2026-09-30-warden-playground.md`. This plan assumes the contract package and its three guards, `tenantFrom`, `validateNamespace`, `CheckLogSummary`/`projectCheckLog`, the playground page and its route `/playground/check/:checkId`, the check log pages, the assignments page, and `warden-fixtures.mjs` with its `sandbox` namespace.

**Scope note:** this is plan 4b, the second half of the spec's plan 4. Plans 5 (the CodeMirror schema surface and the React Flow relations graph) and 6 (retirement) remain.

## Global Constraints

- Contributor name is exactly `warden`. Contract DTOs are camelCase; never a warden domain struct on the wire. Arrays are never `null`.
- Every handler resolves its tenant with `tenantFrom(p, deps)`, never from the request. Store reads always carry that tenant; engine calls pass it with `warden.WithCallTenantID`.
- Every new handler is added to **three** self-checking guards: `handlers_tenant_test.go`'s table, `manifest_test.go`'s `wantKind`, and `authz.go`'s `intentPolicies` with `authz_test.go`'s `wantPolicies`. An intent absent from `intentPolicies` is denied. Extend them; never loosen an assertion.
- Every manifest intent line carries `requires: { warden: warden.engine }`.
- Authz: `subjects.detail` is `read` on `warden:assignment` (it is assembled from assignment, role and relation reads, and `read` on assignments is the grant closest to "who holds what"); `playground.batchCheck` is `check` on `warden:authz`, as `playground.explain`.
- Subject kinds: like `playground.explain`, both intents accept any subject kind, including `""`, because the engine evaluates whatever kind it is given and a logged subject must be viewable.
- **Every sentence a page shows must be true for every case it can appear in.** Verify against `engine.go` and `evaluator.go`, never against a comment.
- `Check`'s observable behaviour does not change; every existing root-package test passes unmodified.
- Identifier values carry `font-mono text-xs`; the tenant root renders as `/`; captions count what the server returned; empty states say which kind of empty.
- React tests use `fireEvent`, `toBeTruthy()` and `.textContent`; failure tests stub a thrown `ContractError`.
- No em dashes anywhere. No `Co-Authored-By` trailers, no Claude or Anthropic attribution.
- Both trees are shared with live sessions holding over a hundred uncommitted files. Commit by explicit path, paths inline; stage new files with `git add <path>`; never `git add -A`, `git commit -a` or `--amend`; verify by SHA. Restore only from your own backup or `git checkout -- <exact path>`. Delete only files you created, by exact name. Never point anything at local port 5432.

## What the engine actually does

Verified against `warden/engine.go`, `warden/evaluator.go` and the store interfaces for this plan.

- **Roles in scope at namespace N** (`resolveAssignedRoles`, `engine.go:506`): `ListRolesForSubject(tenant, AncestorNamespaces(N), kind, id)` (global assignments at N and every ancestor; expired assignments excluded in the query itself), plus, for a check on a specific resource, `ListRolesForSubjectOnResource`; then `GetRoles`, then `resolveInheritedRoleObjects`.
- **Inheritance** (`resolveInheritedRoleObjects`): breadth-first up `ParentSlug`, each parent looked up by slug **in the child's own namespace** (`GetRoleBySlug(r.NamespacePath, r.ParentSlug)`), deduplicated by role id, capped at 21 levels. A missing parent ends that chain silently.
- **RBAC grants** come from `ListRolePermissionsForRoles` over every resolved role, matched with `matchPermission` (so `document:*` grants `document:read`).
- **Resource-scoped assignments** grant their role only for a check on that exact resource type and id.
- **A policy selects a subject** (`conditionEvaluator.matchesSubject`, `evaluator.go:200`): an empty `Subjects` list selects everyone; otherwise any matcher whose non-empty `Kind`, `ID` and `Role` all agree (role compared against the resolved role slugs). Selecting is not applying: the policy's actions, resources, window and conditions still decide each check. The evaluator considers only `ListActivePolicies` at the check's namespace and ancestors, and skips a policy not `EffectiveAt(now)`.
- **Relations**: ReBAC checks direct tuples, then resource-type expressions, then a graph walk through usersets and parents. A subject's own tuples are only the first of those.
- **Batch**: there is no batch method on the engine. `MaxBatchChecks` (`config.go:77`, default 100) bounds a batch API call; the contract enforces it.

## Deviations from the spec

1. **The view is at a namespace.** The spec's view is per subject, but roles and policies both cascade by namespace, so the same subject has different access in different namespaces. The page carries a namespace control, defaulting to the root, and says which namespace it shows. Assignments and relations are listed across every namespace, each with its own namespace column, because they are facts about the subject rather than about one scope.
2. **Policies are "selected", not "applied".** The spec says "the active policies whose `matchesSubject` names them". The page lists them under a heading that says they select this subject, and says their actions, resources and conditions decide each check.
3. **Relations are direct tuples only**, and the page says so; a relation reached through a group or a parent object is the playground's job.
4. **`namespaces.list` also scans recent check logs** (the newest 1,000), which is how the leaf namespaces where checks run reach every namespace filter. Plan 3b's final review carried this forward.

## Review Focus

1. **Inheritance traced wrongly.** A parent looked up in the wrong namespace, or a chain continuing past a missing parent, would list roles the engine never resolves. Task 1 exports the engine's own walk rather than a copy.
2. **An expired assignment presented as granting.** Assignments are listed across namespaces including expired rows; roles in scope must come from the query that excludes them. Tasks 2 and 5.
3. **A policy shown as applying to the subject.** Task 5's wording and Task 2's `selectedBy` say how it selects, never that it applies.
4. **A batch that leaves a trace or exceeds the cap.** Task 3 runs every item as a dry run and refuses a batch over `MaxBatchChecks` before running any of it.
5. **A subject link built from an empty kind** would produce a route with an empty segment. Task 6 renders a subject with an empty kind as plain text.

---

## File Structure

**warden** (`/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`)

| File | Responsibility |
|---|---|
| `subject.go` (create) | `Engine.SubjectRoles`, `PolicySelectsSubject` |
| `evaluator.go` (modify) | `matchesSubject` delegates to `PolicySelectsSubject` |
| `engine.go` (modify) | `resolveAssignedRoles` shares the global-role path with `SubjectRoles` |
| `subject_test.go` (create) | Equivalence and matcher tests |
| `extension/contract/handlers_subjects.go` (create) | `subjects.detail` |
| `extension/contract/handlers_playground.go` (modify) | `playground.batchCheck` |
| `extension/contract/handlers_namespaces.go` (modify) | Scan recent check logs |
| `extension/contract/{contract.go,manifest.yaml,authz.go}` + three guard tests (modify) | Registration |

**forge-dashboard** (`main`)

| File | Responsibility |
|---|---|
| `packages/fixture-server/warden-fixtures.mjs` (modify) | Three handlers mirrored |
| `packages/plugin-warden/src/pages/subject-detail.tsx` (create) | The subject view |
| `packages/plugin-warden/src/components/subject-link.tsx` (create) | `SubjectLink` |
| `packages/plugin-warden/src/pages/{check-log,check-log-detail,assignments,playground}.tsx` (modify) | Subject links; batch section |
| `packages/plugin-warden/src/index.tsx` (modify) | Route |

---

## Task 1: Export the engine's subject role resolution and subject matcher

**Files:**
- Create: `subject.go`, `subject_test.go`
- Modify: `engine.go` (`resolveAssignedRoles`, lines 506-530), `evaluator.go` (`matchesSubject`, lines 200-217)

**Interfaces:**
- Produces:

```go
// SubjectRoles reports the roles a subject holds at a namespace, as Check
// resolves them for a check on no particular resource: the roles assigned
// at that namespace or an ancestor (expired assignments excluded), then
// every parent reached through ParentSlug. direct lists the assigned roles;
// all lists direct plus inherited, in the order Check resolves them.
// Resource-scoped assignments are not included: they grant only for a check
// on their own resource.
func (e *Engine) SubjectRoles(ctx context.Context, kind SubjectKind, subjectID string, opts ...CallOption) (direct, all []*role.Role, err error)

// PolicySelectsSubject reports whether a policy's subject matchers select a
// subject holding roleSlugs. It is the evaluator's own test: an empty
// Subjects list selects everyone; otherwise any matcher whose non-empty
// Kind, ID and Role all agree. Selecting is not applying: the policy's
// actions, resources, window and conditions still decide each check.
func PolicySelectsSubject(pol *policy.Policy, kind SubjectKind, subjectID string, roleSlugs []string) bool
```

- [ ] **Step 1: Write the failing tests**

`subject_test.go`, package `warden`, over `store/memory`:
1. `SubjectRoles` at `""` with a root assignment returns that role in `direct` and `all`; at `eng/platform` it also returns a role assigned at `eng`; it never returns a role assigned only at `eng/platform` when asked at `""`.
2. A child role whose `ParentSlug` names a role in the same namespace returns the parent in `all` but not `direct`; a `ParentSlug` naming a role only in another namespace returns nothing for it (the engine looks the parent up in the child's own namespace).
3. An expired assignment's role is absent from both.
4. A resource-scoped assignment's role is absent from both.
5. **Equivalence**: for each case above, the slugs of `all` equal the slugs of the roles `Check` resolves for a check on a resource that has no resource-scoped assignment (assert through a test-only hook or by comparing against `resolveAssignedRoles` directly, since the test is in package `warden`).
6. `PolicySelectsSubject`, a table: empty `Subjects` selects anyone; `{Kind: "user"}` selects any user and no service; `{ID: "alice"}` selects alice of any kind; `{Role: "editor"}` selects only when `roleSlugs` holds `editor`; `{Kind: "user", Role: "editor"}` needs both; one of several matchers agreeing selects; an empty matcher `{}` selects everyone.
7. **Evaluator unchanged**: every existing evaluator and engine test passes unmodified.

- [ ] **Step 2: Run to see them fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/warden && go test . -run 'SubjectRoles|PolicySelectsSubject' -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement by moving code**

`PolicySelectsSubject` takes the body of `matchesSubject` verbatim (with `req.Subject.Kind` and `req.Subject.ID` as parameters); `matchesSubject` becomes a one-line call to it. `SubjectRoles` resolves scope with the existing `prepareCheck`-style option handling (tenant, namespace; no `CheckRequest` validation, since there is no action or resource), then calls a new private `globalRoles(ctx, scope, kind, id) ([]*role.Role, error)` extracted from the first half of `resolveAssignedRoles` (the `ListRolesForSubject` and `GetRoles` path), then `resolveInheritedRoleObjects`. `resolveAssignedRoles` keeps its behaviour, calling the same pieces for the global ids. `ErrTenantRequired` applies as in `Check`. Move code; do not rewrite it.

- [ ] **Step 4: Run everything**

Run: `go test . -race -v -run 'SubjectRoles|PolicySelectsSubject'`, then `go build ./... && go test ./...`.
Expected: PASS, every existing test unmodified. Mutate once (look the parent up in the root namespace instead of the child's), confirm test 2 fails, restore from your backup.

- [ ] **Step 5: Commit**

```bash
git add subject.go subject_test.go
git commit -m "feat(engine): expose a subject's roles and the policy subject matcher" -- subject.go subject_test.go engine.go evaluator.go
```

---

## Task 2: `subjects.detail`

**Files:**
- Create: `extension/contract/handlers_subjects.go`, `extension/contract/handlers_subjects_test.go`
- Modify: `contract.go`, `manifest.yaml`, `authz.go`, and the three guard tests

**Interfaces:**
- Consumes: `Engine.SubjectRoles`, `PolicySelectsSubject` (Task 1); `ListRolePermissionsForRoles`, `ListAssignments`, `ListRelations`, `ListActivePolicies`, `ListCheckLogs`; `projectCheckLog`; `validateNamespace`; the expiring horizon `defaultExpiringWindowHours` (`handlers_assignments.go:29`).
- Produces:

```go
type SubjectDetailInput struct {
	SubjectKind   string `json:"subjectKind"`
	SubjectID     string `json:"subjectId"`
	NamespacePath string `json:"namespacePath"` // "" is the root; always explicit
}

type SubjectPermission struct {
	Name     string `json:"name"`     // resource:action as stored, wildcards included
	Resource string `json:"resource"`
	Action   string `json:"action"`
}

type SubjectRole struct {
	ID            string              `json:"id"`
	Slug          string              `json:"slug"`
	Name          string              `json:"name"`
	NamespacePath string              `json:"namespacePath"`
	// Via is "assigned" or "inherited".
	Via string `json:"via"`
	// InheritedBy lists the slugs of the resolved roles whose ParentSlug
	// names this role in its namespace. Empty for an assigned role that no
	// other resolved role inherits.
	InheritedBy []string            `json:"inheritedBy"`
	Permissions []SubjectPermission `json:"permissions"`
}

type SubjectAssignment struct {
	ID            string `json:"id"`
	NamespacePath string `json:"namespacePath"`
	RoleID        string `json:"roleId"`
	RoleSlug      string `json:"roleSlug"`
	ResourceType  string `json:"resourceType,omitempty"`
	ResourceID    string `json:"resourceId,omitempty"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
	Expired       bool   `json:"expired"`
	// ExpiringSoon is true when ExpiresAt falls within the same horizon
	// assignments.expiring uses.
	ExpiringSoon bool `json:"expiringSoon"`
}

type SubjectRelation struct {
	ID            string `json:"id"`
	NamespacePath string `json:"namespacePath"`
	ObjectType    string `json:"objectType"`
	ObjectID      string `json:"objectId"`
	Relation      string `json:"relation"`
}

type SubjectPolicy struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Effect        string `json:"effect"`
	Priority      int    `json:"priority"`
	NamespacePath string `json:"namespacePath"`
	// SelectedBy says how the policy's subject matchers select this subject:
	// "everyone" (no subject matchers, or an empty matcher), "kind", "id" or
	// "role:<slug>" (the first agreeing matcher's most specific field).
	SelectedBy string `json:"selectedBy"`
}

type SubjectDetailResponse struct {
	Roles              []SubjectRole       `json:"roles"`
	Assignments        []SubjectAssignment `json:"assignments"`
	AssignmentsTruncated bool              `json:"assignmentsTruncated"`
	Relations          []SubjectRelation   `json:"relations"`
	RelationsTruncated bool                `json:"relationsTruncated"`
	Policies           []SubjectPolicy     `json:"policies"`
	RecentChecks       []CheckLogSummary   `json:"recentChecks"`
}
```

- [ ] **Step 1: Write the failing tests**

1. Refusals, each `BAD_REQUEST` naming the field: empty `subjectId`; invalid `namespacePath`. Any `subjectKind`, including `""`, is accepted.
2. Roles: at `""` and at `eng/platform`, `roles` equals `SubjectRoles`' `all` with `via` from `direct`, `inheritedBy` naming the child, and each role's permissions from `ListRolePermissionsForRoles`.
3. Assignments: every namespace, the subject's rows only (kind **and** id), expired rows included with `expired: true`, `expiringSoon` true inside the horizon and false outside; resource-scoped rows carry their resource. Capped at 200 with `assignmentsTruncated` true beyond it.
4. Relations: tuples where the subject is the tuple subject (type and id), every namespace, capped at 200 with `relationsTruncated`.
5. Policies: only active, `EffectiveAt(now)`, at the namespace or an ancestor, and `PolicySelectsSubject` true for the resolved role slugs; `selectedBy` per the table in the DTO comment; a policy in `sandbox` never appears at `""`.
6. Recent checks: the newest ten check log rows for the subject (kind and id), projected with `projectCheckLog`.
7. Tenant: a principal for `t1` never sees `t2`'s roles, assignments, relations, policies or checks.

- [ ] **Step 2: Run to see them fail**, then **Step 3: implement**

`subjectsDetailHandler(deps)`: `requireEngine`, `tenantFrom`, validate, then the six reads. Pass `WithCallTenantID(tenant)` and `WithCallNamespacePath(ns)` to `SubjectRoles`. Map store errors through `mapWardenError`. Every slice `make(..., 0)`.

- [ ] **Step 4: Register and guard**

Manifest: `- { name: subjects.detail, kind: query, version: 1, requires: { warden: warden.engine }, capability: read }` and a `subjectDetail` query with `staleTime: 15s`. Every command that changes roles, role permissions, assignments, relations or policies already invalidates its own lists; add `subjects.detail` to the `invalidates` of: `roles.update`, `roles.delete`, `roles.attachPermission`, `roles.detachPermission`, `roles.setPermissions`, `assignments.create`, `assignments.delete`, `relations.create`, `relations.delete`, `policies.update`, `policies.setActive`, `policies.delete`, `maintenance.run`. The spec already requires the assignment and relation ones. Assert the list in `manifest_test.go`. Authz `{"read", "warden:assignment"}`. The three guards.

- [ ] **Step 5: Run, mutate, commit**

Run the package, then `go test ./...`. Mutate once (drop the kind from the assignments filter), confirm test 3 fails, restore.

```bash
git add extension/contract/handlers_subjects.go extension/contract/handlers_subjects_test.go
git commit -m "feat(contract): answer what one subject can do and why" -- extension/contract/handlers_subjects.go extension/contract/handlers_subjects_test.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/authz.go extension/contract/handlers_tenant_test.go extension/contract/manifest_test.go extension/contract/authz_test.go
```

---

## Task 3: `playground.batchCheck` and leaf namespaces

**Files:**
- Modify: `extension/contract/handlers_playground.go`, `handlers_playground_test.go`, `handlers_namespaces.go`, its test, and the registration files and guards

**Interfaces:**
- Produces:

```go
type PlaygroundBatchInput struct {
	// NamespacePath applies to every item. "" is the root.
	NamespacePath string              `json:"namespacePath"`
	Items         []PlaygroundBatchItem `json:"items"`
}

type PlaygroundBatchItem struct {
	SubjectKind  string `json:"subjectKind"`
	SubjectID    string `json:"subjectId"`
	Action       string `json:"action"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId,omitempty"`
}

type PlaygroundBatchResult struct {
	// Decision is "error" when the item's check failed, with Error set.
	Decision string `json:"decision"`
	Allowed  bool   `json:"allowed"`
	Reason   string `json:"reason,omitempty"`
	Error    string `json:"error,omitempty"`
}

type PlaygroundBatchResponse struct {
	// Results is in item order, one per item.
	Results []PlaygroundBatchResult `json:"results"`
}
```

- [ ] **Step 1: Write the failing tests**

1. Refusals, each `BAD_REQUEST`, before any item runs: no items (`items is required`); more than `Config().MaxBatchChecks` items (`a batch holds at most <n> checks`, with the configured number); an item missing `subjectId`, `action` or `resourceType` (`items[<i>].<field> is required`, first offending item); an invalid namespace. `MaxBatchChecks` of 0 means the default cap of 100, as `Config` documents; read `config.go` to confirm and follow it.
2. Results: one per item in order, each equal to a dry-run `Check` for the same request at the namespace; a store failure on one item gives that item `decision: "error"` and the rest still run.
3. No trace: after a batch, no check log row and no cache entry for any item.
4. Tenant as `playground.explain`.
5. `namespaces.list`: a namespace that appears only on a check log row (among the newest 1,000) is listed; one that appears only on a row beyond the newest 1,000 is not.

- [ ] **Step 2: Implement**

`playgroundBatchHandler(deps)` validates everything first, then runs each item through `deps.Engine.Check(ctx, req, WithCallTenantID, WithCallNamespacePath, WithCallDryRun)`. A per-item error becomes `decision: "error"` with the error's message. `namespacesListHandler` adds `ListCheckLogs(&checklog.QueryFilter{TenantID: tenant, Limit: namespaceScanLimit})` to its scan; update its doc comment's collection count.

- [ ] **Step 3: Register, guard, run, mutate, commit**

Manifest: `playground.batchCheck` as a query (`capability: read`), `playgroundBatch` query with `staleTime: 0s`; authz `{"check", "warden:authz"}`; the three guards. Mutate once (run items without the dry-run option), confirm test 3 fails, restore.

```bash
git commit -m "feat(contract): run a batch of dry-run checks, and list namespaces where checks run" -- extension/contract/handlers_playground.go extension/contract/handlers_playground_test.go extension/contract/handlers_namespaces.go extension/contract/handlers_namespaces_test.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/authz.go extension/contract/handlers_tenant_test.go extension/contract/manifest_test.go extension/contract/authz_test.go
```

If `handlers_namespaces_test.go` does not exist under that name, put the namespace test where the existing `namespaces.list` tests live and list that path instead.

---

## Task 4: Fixture

**Files:**
- Modify: `packages/fixture-server/warden-fixtures.mjs`

- [ ] **Step 1: Three handlers**

Mirror Tasks 2 and 3 exactly, refusal messages and order included, computing from the fixture's own seed: roles in scope through the namespace cascade and `parentSlug` in the child's namespace, expired assignments excluded from roles and listed with `expired: true`, `expiringSoon` against the same horizon, relations where the subject is the tuple subject, policies active and in window at the namespace or an ancestor and selected by the subject's matchers, and the newest ten check log rows for the subject. `playground.batchCheck` answers each item through the existing `playground.explain` scenario logic and projects the verdict. `namespaces.list` adds the check log seed's namespaces.

- [ ] **Step 2: Check by hand**

Start the fixture server on a free port, stop it by PID. Send every refusal and compare with the Go messages. For three seeded subjects (one with an inherited role, one with an expired and an expiring assignment, one selected by a `sandbox` policy only in `sandbox`), write the expected response by hand from the seed and compare. Record both in the report.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(fixture): serve the warden subject view, batch checks and check namespaces" -- packages/fixture-server/warden-fixtures.mjs
```

---

## Task 5: The subject page

**Files:**
- Create: `packages/plugin-warden/src/pages/subject-detail.tsx`, `packages/plugin-warden/test/subject-detail.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`, `packages/plugin-warden/test/plugin.test.tsx`

**Interfaces:**
- Consumes: `subjects.detail` (Task 2), `namespaces.list`, `checkColumns` or the check log row pieces from `components/check-log.tsx`.
- Produces: `WardenSubjectDetailPage` at `/subjects/:kind/:id`, no nav entry. Route params arrive URI-decoded; the page sends them as given.

- [ ] **Step 1: Write the failing tests**

1. Header: `kind:id` in mono, a namespace control (the namespace suggestions, root as `/`), and "Showing access at {namespace}."; changing the namespace sends a new `subjects.detail` with that `namespacePath`.
2. Roles section, headed "Roles at {namespace}": each role's slug linked to `/roles/<id>`, its namespace, "assigned" or "inherited from {slugs}" (the roles in `inheritedBy`), and its permissions as mono chips. Empty: "This subject holds no role at {namespace}." Under the section, muted: "Roles assigned for one resource only are listed under assignments. They grant only for checks on that resource."
3. Assignments section, every namespace: role, namespace, resource (or "every resource"), expiry with `Timestamp`, a `secondary` "expires soon" badge when `expiringSoon`, a `destructive` "expired" badge when `expired`, and under the table: "An expired assignment grants nothing. It stays listed until maintenance removes it." only when at least one row is expired. `assignmentsTruncated` adds "Showing the first 200 assignments."
4. Relations section: object `type:id`, relation, namespace; "Direct relation tuples only. A relation reached through a group or a parent object is found by the check itself; try it in the playground." `relationsTruncated` adds "Showing the first 200 relations."
5. Policies section, headed "Policies that select this subject at {namespace}": name linked to `/policies/<id>`, effect (Deny in destructive, as on the policy page), priority, namespace, and how it selects: `everyone` reads "every subject", `kind` "subjects of this kind", `id` "this subject", `role:<slug>` "holders of {slug}". Under it: "Selecting is not applying. Each policy's actions, resources, window and conditions decide whether it applies to a given check."
6. Recent checks: up to ten rows with the check log's columns, each linking to its detail, and a link "Open the check log" (to `/check-log`).
7. A "Run a check as this subject" link to `/playground`.
8. Every empty section says which empty; a refused query renders the `QueryBoundary` card.

- [ ] **Step 2: Run to see them fail**, **Step 3: implement**, **Step 4: route** `{ path: "/subjects/:kind/:id", element: WardenSubjectDetailPage }` with the "No nav entry" comment. A subject kind of `""` cannot reach this route; Task 6 renders such subjects as plain text.

- [ ] **Step 5: Verify and commit**

Run the package's `test`, `typecheck`, `lint`. Mutate once (show "inherited" for every role), confirm test 2 fails, restore.

```bash
git add packages/plugin-warden/src/pages/subject-detail.tsx packages/plugin-warden/test/subject-detail.test.tsx
git commit -m "feat(warden): show what one subject can do and why" -- packages/plugin-warden/src/pages/subject-detail.tsx packages/plugin-warden/test/subject-detail.test.tsx packages/plugin-warden/src/index.tsx packages/plugin-warden/test/plugin.test.tsx
```

---

## Task 6: Subject links, and the batch section

**Files:**
- Create: `packages/plugin-warden/src/components/subject-link.tsx`, `packages/plugin-warden/test/subject-link.test.tsx`
- Modify: `packages/plugin-warden/src/components/check-log.tsx`, `src/pages/check-log-detail.tsx`, `src/pages/assignments.tsx`, `src/pages/playground.tsx`, and their tests

**Interfaces:**
- Produces: `SubjectLink({ kind, id })`: a `PluginLink` to `/subjects/${encodeURIComponent(kind)}/${encodeURIComponent(id)}` showing `kind:id`, or plain text when `kind` is `""`.

- [ ] **Step 1: Links**

`SubjectLink` replaces the plain `kind:id` subject text in the check log columns, the check detail request line, and the assignments list. The playground builder gains, beside the subject fields, a "View this subject" link shown when both fields are filled and the kind is not `""`. Tests: the href for an id containing `/` is encoded; an empty kind renders plain text; each page renders the link.

- [ ] **Step 2: Batch section**

On the playground page, below the builder, a "Run a batch" disclosure: a textarea, one check per line as `kind:id action type:id` (resource id optional: `type` alone means an empty id), the builder's namespace, and a "Run batch" button. Parsing is client-side; a malformed line shows "Line {n} is not kind:id action type[:id]." and sends nothing. When `config.detail` reports `maxBatchChecks` and the batch has more lines, the section shows "A batch holds at most {maxBatchChecks} checks." without sending. When the config cannot be read, the page does not pre-check, and the server's refusal renders in the section. Results render as a table in line order: the line, the decision badge (check log variants), the reason or error, and an "Open in builder" button that fills the builder above with that line. The section's footer repeats the dry-run sentence the builder uses. Tests: the request (namespace plus items in order, resource id omitted when absent), each refusal, the results table, "Open in builder".

- [ ] **Step 3: Verify and commit**

Run the package's `test`, `typecheck`, `lint`. Mutate once (drop `encodeURIComponent` on the id), confirm the encoding test fails, restore.

```bash
git add packages/plugin-warden/src/components/subject-link.tsx packages/plugin-warden/test/subject-link.test.tsx
git commit -m "feat(warden): link every subject to its access view, and run checks in a batch" -- packages/plugin-warden/src/components/subject-link.tsx packages/plugin-warden/test/subject-link.test.tsx packages/plugin-warden/src/components/check-log.tsx packages/plugin-warden/src/pages/check-log-detail.tsx packages/plugin-warden/src/pages/assignments.tsx packages/plugin-warden/src/pages/playground.tsx packages/plugin-warden/test/check-log.test.tsx packages/plugin-warden/test/check-log-detail.test.tsx packages/plugin-warden/test/assignments.test.tsx packages/plugin-warden/test/playground.test.tsx
```

---

## Carried forward

- **To plan 5:** the CodeMirror schema surface (`schema.export`, `schema.plan`, `schema.apply`), the React Flow relations graph, and the bundle re-measure.
- **Warden follow-ups, not this plan:** every dashboard intent call is authorized by a real `Enforce` and writes a check log row; the playground and the subject view cannot yet name an allow policy skipped because its condition threw.
