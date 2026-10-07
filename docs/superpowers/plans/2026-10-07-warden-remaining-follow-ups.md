# Warden remaining follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four open Warden follow-ups: the dashboard's maintenance run stays inside the caller's tenant, a dashboard relation delete audits the whole tuple, relation writes obey the resource type that declares their object type, and the two intents with no UI get one.

**Architecture:** The maintenance and audit fixes each add a tenant-scoped store method to all four backends with a shared conformance case, then use it from the contract. Declaration enforcement is one shared check, called by every relation write path (contract, REST, DSL apply), plus a read-side flag so the relations page can mark tuples written before enforcement. The UI work is two React additions over intents that already exist.

**Tech Stack:** Go (warden core, four stores, contract, REST, DSL), React and TypeScript (plugin-warden), the fixture server.

**Spec:** none. Rex chose on 2026-10-07: maintenance scoped to the tenant (the engine's scheduled maintenance stays engine-wide); declarations enforced by refusing bad writes only (undeclared object types stay free, existing tuples and the evaluator untouched, existing violations flagged); the expiring list on the assignments page; a store lookup for the relation audit.

## Global Constraints

- Repos: warden `/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening` (it heads open PR xraph/warden#62; `main` points at the same commit); forge-dashboard `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. Both are shared trees with other sessions' uncommitted files.
- Commit by explicit path (`git add` only new files, by name; `git commit -m "..." -- <paths>`). Never `git add -A`, `commit -a`, `--amend`, `stash`, `checkout --`, `restore`, `reset` or `clean`. A file with someone else's uncommitted edits is changed with the Edit tool only and committed through a private `GIT_INDEX_FILE` holding only your hunks.
- No `Co-Authored-By` or attribution trailer. No em dash (U+2014) or en dash (U+2013) anywhere.
- Truth rule: every sentence a page, comment or error shows must be true in every case it can appear in.
- Integration tests run only through the existing testcontainers harnesses; never set `WARDEN_TEST_DSN` or `WARDEN_TEST_MONGO_URI`; never touch local ports 5432, 6379 or 27017 or another project's containers.
- Contract guards stay green: `extension/contract` `handlers_tenant_test.go`, `manifest_test.go`, `authz_test.go`, `authz_logging_test.go`. Every new or changed intent keeps them in step.
- The fixture server (`packages/fixture-server/warden-fixtures.mjs`) mirrors every wire change, verified with a throwaway node script that imports `wardenHandlers` (it has no suite).

## Review Focus

1. A tenant's maintenance run must not delete one row of another tenant, and must invalidate only its own cache. Task 1's conformance case seeds two tenants and checks both.
2. A relation delete for a foreign tenant's id is not found, never audited as that tenant's tuple. Task 2 covers it.
3. Declaration resolution must match the evaluator's: the nearest resource type of that name up the namespace ancestor chain (`dsl/engine_evaluator.go` `findResourceType`). A tuple whose object type has no resource type anywhere in its chain is never refused. Task 3 tests both.
4. Subject matching must match the DSL's meaning of `allowed_subjects` exactly, including `group#member` entries and any wildcard form the DSL accepts. Task 3 reads `dsl/ast.go`, the parser and docs before writing the matcher.
5. Enforcement must not refuse a write the evaluator would honour in a way that breaks existing DSL sources: a DSL apply whose tuples break their own declarations fails at plan (dry run) with a message naming the tuple, not part way. Task 3 tests a plan.

---

### Task 1: Tenant-scoped maintenance

**Files:**
- Modify: `assignment/store.go`, `checklog/store.go` (new methods), the four stores, `maintenance.go` (new `Engine.RunTenantMaintenance(ctx, tenantID string) (MaintenanceReport, error)`), `extension/contract/handlers_maintenance.go`
- Create: `store/contract/tenant_maintenance.go` (`RunTenantMaintenanceContract`), wired in all four backends (memory and sqlite plain; postgres and mongo `//go:build integration`)
- Modify: forge-dashboard `packages/plugin-warden/src/pages/config.tsx` (the Run maintenance confirmation and result copy), `packages/fixture-server/warden-fixtures.mjs`

**Interfaces:**
- Produces: `DeleteExpiredAssignmentsForTenant(ctx, tenantID string, now time.Time) (int64, error)` and `PurgeCheckLogsForTenant(ctx, tenantID string, before time.Time) (int64, error)`; `RunTenantMaintenance` purges only that tenant and, when it removed rows and a cache exists, calls `InvalidateTenant(ctx, tenantID)` (not `Clear`). An empty tenant ID is refused, never treated as "every tenant".

- [ ] **Step 1:** Conformance case: two tenants each with an expired and a live assignment and an old and a new check log; a run for t1 removes only t1's expired assignment and old log; t2 is untouched; an empty tenant ID errors.
- [ ] **Step 2:** Engine test: `RunTenantMaintenance` invalidates only that tenant's cache entries (use a fake Cache recording calls) and only when rows were removed; `RunMaintenance` is unchanged.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement in all four stores, the engine and the contract (`maintenance.run` calls `RunTenantMaintenance` with the resolved tenant). Update the contract comments that call the run engine-wide.
- [ ] **Step 5:** React: the confirmation and result say the run purges this tenant's expired assignments and, when retention is set, its check log entries older than the retention window. Verify each clause against the code. Fixture mirrors.
- [ ] **Step 6:** Run memory, sqlite, postgres and mongo cases, `go test ./...`, plugin-warden test/typecheck/lint.
- [ ] **Step 7:** Commit warden `fix(maintenance): run the dashboard's maintenance for the caller's tenant only`; forge-dashboard `fix(warden): say the maintenance run covers this tenant`.

### Task 2: A dashboard relation delete audits the whole tuple

**Files:**
- Modify: `relation/store.go` (add `GetRelation(ctx, tenantID string, relID id.RelationID) (*Tuple, error)`), the four stores, `extension/contract/handlers_relations.go` (delete, about :215-235)
- Create: `store/contract/relation_get.go`, wired in all four backends

- [ ] **Step 1:** Conformance case: get by id returns the tuple; a missing id and a foreign tenant both return `ErrRelationNotFound`.
- [ ] **Step 2:** Contract test: `relations.delete` audits `relation.deleted` with the deleted tuple as the before entity (not just its id); a foreign or missing id is NOT_FOUND and audits nothing.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. The read and the delete are not atomic; the comment says so. The typed plugin hook keeps its id-only signature.
- [ ] **Step 5:** `go test ./...` and the integration cases.
- [ ] **Step 6:** Commit `fix(relations): audit the whole tuple when the dashboard deletes a relation`.

### Task 3: Relation writes obey their resource type's declarations

**Files:**
- Create: the shared check (place it where contract, `api/` and `dsl/` can all import it without a cycle, e.g. package `resourcetype` or `relation`), with tests
- Modify: `extension/contract/handlers_relations.go` (create), `api/relation_handler.go` (create, about :100), `dsl/applier.go` (tuple writes, about :1393; refuse at the dry run as the cap check does), the error mapping in contract and REST
- Modify: `packages/fixture-server/warden-fixtures.mjs`

**Interfaces:**
- Produces: `CheckTupleDeclared(ctx, store, tuple) error`. It finds the resource type named `tuple.ObjectType` at the nearest namespace up `tuple.NamespacePath`'s ancestor chain (the evaluator's rule). None found: nil. Found: the relation must be declared, and the subject (`SubjectType`, plus `#SubjectRelation` when set) must match an `allowed_subjects` entry under the DSL's semantics. A refusal names the tuple, the resource type and its namespace, and what is allowed. Contract: `BAD_REQUEST` (the operator can fix the input). REST: 400. DSL: refused at plan.

- [ ] **Step 1:** Read `dsl/ast.go` `SubjectType`, the parser and `docs/content/docs/integration/dsl-reference.mdx` for exactly what `allowed_subjects` entries mean (plain type, `type#relation`, any wildcard), and write the matcher's table test from that, including what a plain `group` entry allows for a tuple with `SubjectRelation` set.
- [ ] **Step 2:** Tests per path: undeclared object type writes; declared relation and allowed subject writes; undeclared relation refused; disallowed subject refused; a resource type in an ancestor namespace governs a tuple in a child namespace; one in a sibling namespace does not; a DSL source whose tuple breaks its own declaration fails at plan with nothing written.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement and call from all three paths. Fixture mirrors.
- [ ] **Step 5:** `go test -race ./extension/contract/ ./api/ ./dsl/`, `go test ./...`.
- [ ] **Step 6:** Commit `feat(relations): refuse a tuple its resource type does not declare`.

### Task 4: The relations page marks tuples that break their declaration

**Files:**
- Modify: `extension/contract/handlers_relations.go` (list, and detail if there is one): each row carries `undeclared: string` (empty when the tuple conforms or no resource type governs it; otherwise the same reason Task 3 would refuse with), computed with Task 3's check, resolving each distinct (namespace, object type) once per page
- Modify: `packages/plugin-warden/src/pages/relations.tsx` and its types; the fixture
- Test: contract and plugin tests

- [ ] **Step 1:** Tests: a conforming tuple has no mark; a tuple written before enforcement (seed it straight into the store) shows the reason; the page renders a muted mark with that reason and a short explanation that warden still evaluates the tuple.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Verify the page's sentence against the evaluator: existing tuples are still honoured at check time.
- [ ] **Step 4:** Tests, typecheck, lint; `go test ./extension/contract/`.
- [ ] **Step 5:** Commit warden `feat(contract): mark relations that break their resource type`; forge-dashboard `feat(warden): show which relations break their resource type`.

### Task 5: UI for assignments.expiring and permissions.update

**Files:**
- Modify: `packages/plugin-warden/src/pages/assignments.tsx` (an "Expiring soon" view beside the existing filters, reading `assignments.expiring` with `withinHours` and `limit`), `packages/plugin-warden/src/pages/permission-detail.tsx` (an edit of the description through `permissions.update`, the only field it accepts), and tests
- Check: the manifest's `invalidates` for both intents so the pages refresh after a write

- [ ] **Step 1:** Tests: the expiring view lists what the intent returns, says the window it used, and says when it hit its limit; the description edit sends `{id, description}`, shows the server's refusal, and refreshes the page on success. System permissions: check whether `permissions.update` refuses them and make the edit control match.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with the kit components the neighbouring pages use.
- [ ] **Step 4:** Tests, typecheck, lint.
- [ ] **Step 5:** Commit `feat(warden): list assignments about to expire, and edit a permission's description`.
