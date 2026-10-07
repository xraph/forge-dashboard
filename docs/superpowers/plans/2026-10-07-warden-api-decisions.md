# Warden API decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle four long-standing Warden behaviours the way that holds up long term: duplicates are 409 everywhere on REST, a REST relation delete removes exactly the tuple it names, a negative retention or maintenance interval switches the feature off, and a permission action cannot contain `:`.

**Architecture:** Four independent tasks. Task 1 is REST error mapping. Task 2 widens the store's delete-by-key to include the subject relation in all four backends and makes REST use it. Task 3 relaxes config validation so a negative duration means off and makes every reader of it honest. Task 4 adds one validation shared by every permission write path.

**Tech Stack:** Go (warden core, four stores, contract, REST, DSL), React and TypeScript (plugin-warden config page), the fixture server.

**Spec:** none. Rex asked on 2026-10-07 to pick what is best long term. The choices, and why:
1. Every duplicate is 409 on REST. Today a duplicate role, permission, policy or resource type is 500 (no mapping) and a duplicate relation or assignment is 400. A duplicate is a conflict with existing state.
2. A REST relation delete matches `subject_relation` exactly; an empty one means the direct tuple, not "any". A delete must remove exactly what it names.
3. A negative `check_log_retention` or `maintenance_interval` means off; 0 and omitted keep meaning "use the default". Making 0 mean off would silently disable purging for every config that omits the field, because omitted and 0 are indistinguishable. The engine already treats `<= 0` as off and the extension defaults only `== 0`, so this is mostly validation and wording.
4. A permission's action may not contain `:`. The engine compares `resource + ":" + action` as one string, so `(warden, role:manage)` and `(warden:role, manage)` grant the same check. Resources keep their colons (`warden:role`). Stored permissions are untouched.

## Global Constraints

- Repos: warden `/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening` (heads open PR xraph/warden#62; `main` points at the same commit); forge-dashboard `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. Both are shared trees with other sessions' uncommitted files.
- Commit by explicit path (`git add` only new files, by name; `git commit -m "..." -- <paths>`). Never `git add -A`, `commit -a`, `--amend`, `stash`, `checkout --`, `restore`, `reset` or `clean`. A file with someone else's uncommitted edits is changed with the Edit tool only and committed through a private `GIT_INDEX_FILE` holding only your hunks.
- No `Co-Authored-By` or attribution trailer. No em dash (U+2014) or en dash (U+2013) anywhere.
- Truth rule: every sentence a page, comment, doc or error shows must be true in every case it can appear in.
- Integration tests run only through the existing testcontainers harnesses; never set `WARDEN_TEST_DSN` or `WARDEN_TEST_MONGO_URI`; never touch local ports 5432, 6379 or 27017 or another project's containers.
- Each behaviour change gets a line in the docs it changes (warden has no CHANGELOG): `docs/content/docs/api-reference/rest-api.mdx`, `docs/content/docs/operations/retention.mdx`, `docs/content/docs/integration/forge-extension.mdx`, and the permissions docs.

## Review Focus

1. Task 1 must not turn a non-duplicate into 409: `ErrAlreadyExists` wraps only duplicates; check every wrapper.
2. Task 2: a delete with an empty `subject_relation` must not remove `group:eng#member`, and one with `member` must not remove `group:eng`. The audit and cache behaviour from the previous plan (one event per removed tuple, tenant cache invalidation) must hold with the narrower key.
3. Task 3: a negative value must reach the engine through the extension's merge (no default substituted), validation must accept it, maintenance must not run or purge, and `config.detail` and the config page must say "Off", not show a negative number or "Kept forever" for a negative retention if those mean different things.
4. Task 4: every write path (contract create/update if update can change the action, REST, DSL apply including `grants` that create permissions, bootstrap seeding) refuses `:` in an action; wildcard `*` stays valid; a stored permission with `:` still loads, checks and can be deleted.

---

### Task 1: Every REST duplicate is 409

**Files:** `api/helpers.go` (`mapError`), its tests, `docs/content/docs/api-reference/rest-api.mdx` (status table).

- [ ] **Step 1:** Tests: creating a duplicate role, permission, policy, resource type, assignment and relation through REST each returns 409 with the store's message. A system-role refusal, a cyclic inheritance and an invalid condition keep their statuses.
- [ ] **Step 2:** Run. Expected: FAIL (500 or 400).
- [ ] **Step 3:** Map `errors.Is(err, warden.ErrAlreadyExists)` to 409, placed so no narrower case above it catches a duplicate first; remove the duplicate cases from the 400 branch.
- [ ] **Step 4:** Update the status table so every row is true. `go test -race ./api/`, `go test ./...`.
- [ ] **Step 5:** Commit `fix(api): answer every duplicate with 409`.

### Task 2: A REST relation delete removes exactly the tuple it names

**Files:** `relation/store.go` (`DeleteRelationTuple` gains `subjectRelation string`), the four stores, every caller, `store/contract` (extend the delete-by-key conformance case from the previous plan), `api/relation_handler.go` (pass `req.SubjectRelation`; the pre-delete read and its audit/cache fallback use the same exact key), REST docs.

- [ ] **Step 1:** Conformance: with `group:eng` and `group:eng#member` stored, deleting with subject relation `""` removes only the direct tuple; with `member` only the set; each backend.
- [ ] **Step 2:** REST tests: the same two deletes; each audits exactly the tuple removed; the cache-clear test from the previous plan still passes; the fallback audit key text (from the previous plan) is updated to name the subject relation now that it is exact.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement in all four stores and the handler. Update the handler comment that documents the old "any subject relation" behaviour.
- [ ] **Step 5:** Docs: the REST delete section says the key includes `subject_relation` and an empty one means the direct tuple. `go test ./...`, integration cases for postgres and mongo.
- [ ] **Step 6:** Commit `fix(relations): delete exactly the tuple a REST delete names, subject relation included`.

### Task 3: A negative retention or maintenance interval means off

**Files:** `config.go` (`Validate`), `extension/extension.go` and `extension/config.go` (merge keeps a negative value; comments), `maintenance.go` (comments), `extension/contract/handlers_config.go` (the seconds fields for a negative value), `packages/plugin-warden/src/pages/config.tsx`, the fixture, docs (`retention.mdx`, `forge-extension.mdx`).

- [ ] **Step 1:** Tests: `Validate` accepts negative durations; the extension's merge passes a negative through untouched while 0 still gets the default; `StartMaintenance` does not start and `RunMaintenance`/`RunTenantMaintenance` purge no check logs with a negative retention; `config.detail` reports them in a way the page reads as "Off" (decide the wire value, e.g. 0 seconds plus the existing fields, or an explicit flag; keep it true for older clients); the page shows "Off".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Every comment and doc sentence about 0 and negatives must be true for the engine built directly and through the extension.
- [ ] **Step 4:** `go test ./...`, plugin-warden test/typecheck/lint, fixture node check.
- [ ] **Step 5:** Commit warden `feat(config): let a negative retention or maintenance interval switch it off`; forge-dashboard `fix(warden): show a switched-off retention or maintenance as Off`.

### Task 4: A permission action cannot contain ':'

**Files:** a shared validation (package `permission`), every permission write path (contract `permissions.create` and any update that changes the action, REST create, DSL apply and any path that creates permissions such as `BootstrapAdmin` seeding), their tests, the fixture, permissions docs.

- [ ] **Step 1:** Find every write path: grep `CreatePermission(` outside stores and tests. Tests per path: an action with `:` is refused with a message saying the engine joins resource and action with `:`, so an action may not contain one; `*` and ordinary actions pass; a resource with `:` (`warden:role`) passes; a stored permission with `:` in its action still loads, checks and deletes.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement: contract `BAD_REQUEST`, REST 400, DSL refused at plan with nothing written. Check warden's own seeded permissions (bootstrap) contain no such action.
- [ ] **Step 4:** Docs: the permissions page states the rule. `go test ./...`, plugin-warden tests if the create form shows the refusal, fixture node check.
- [ ] **Step 5:** Commit `feat(permissions): refuse a ':' in a permission's action`.

### Task 5: REST holds the same invariants as the dashboard

Added during execution (Task 1 found that the REST status table promised refusals REST never makes). The dashboard contract refuses a role inheritance cycle and any update or delete of a system role or permission; REST accepts both. Long term, every write path must hold the same invariants.

**Files:** `api/role_handler.go`, `api/permission_handler.go` (update, delete, attach/detach if they can change a system role), the contract's existing checks (find them in `extension/contract/handlers_roles.go` and `handlers_permissions.go`, e.g. the system guards and the cycle check) moved to a package both can import if they are not already shared, tests, `rest-api.mdx`.

- [ ] **Step 1:** Tests through REST: updating or deleting a system role or permission is refused with the contract's message and status mapping (`ErrSystemRoleImmutable`/`ErrSystemPermissionImmutable`, 400 per the current table, or 403 if that is truer; decide and keep the table true); setting a parent that creates a cycle is refused (`ErrCyclicRoleInheritance`); ordinary updates still work.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement by sharing the contract's checks, not copying them. Check the DSL apply path holds the same invariants already (it has ProtectSystem); note any gap.
- [ ] **Step 4:** `go test -race ./api/ ./extension/contract/`, `go test ./...`; the status table stays true.
- [ ] **Step 5:** Commit `fix(api): refuse role cycles and edits to system roles and permissions, as the dashboard does`.
