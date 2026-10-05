# Warden policy version guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A policy edit made from a stale copy is refused instead of silently overwriting a newer version, atomically, in every warden store.

**Architecture:** `policy.Store` gains `UpdatePolicyIfVersion`, a compare-and-set on the policy's `Version` that each backend performs in one statement (memory under its lock, sqlite and postgres with `WHERE version = ?`, mongo with a version filter). A shared conformance case in `store/contract` pins the behaviour for all four. Every read-modify-write of a policy (the dashboard's `policies.update` and `policies.setActive`, and the REST update) then writes through it against the version it read. `policies.update` also takes the version the editor loaded, so a copy open for minutes is refused too, and the React editor sends it and explains a refusal.

**Tech Stack:** Go (warden core, four stores, dashboard contract, REST API), React and TypeScript (plugin-warden), the fixture server.

**Spec:** none. This closes a follow-up recorded during plan 3a of the warden dashboard migration ("no optimistic concurrency on `policies.update`: a stale editor copy can skip the match-everything confirmation; needs a version precondition"). Rex chose the atomic, every-store design on 2026-10-05 over a contract-only check.

## Global Constraints

- Repos: warden at `/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`; forge-dashboard at `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. Both are shared trees with other sessions' uncommitted files.
- Commit by explicit path (`git commit -m "..." -- <paths>`; `git add` only new files, by name). Never `git add -A`, `commit -a`, `--amend`, `stash`, `checkout --`, `restore`, `reset` or `clean`. A file that already has someone else's uncommitted edits is changed with the Edit tool only and committed through a private `GIT_INDEX_FILE` holding only your hunks.
- No `Co-Authored-By` or any attribution trailer. No em dash (U+2014) or en dash (U+2013) anywhere: code, comments, UI strings, commit messages.
- Truth rule: every sentence a page, comment or error shows must be true in every case it can appear in. Check against code, not comments.
- Never use local port 5432 or 6379. Integration tests start their own throwaway containers through the existing harnesses (`store/postgres` and `store/mongo` `testharness_test.go`).
- Version semantics already in place: a created policy has `Version` 1, and every update writes `before.Version + 1` (`extension/contract/handlers_policies.go` `writePolicy`, `api/policy_handler.go` update). Keep that.

## Review Focus

1. Two saves racing on the same version: exactly one wins in every backend. Task 1's conformance case runs concurrent writers and asserts one success; Task 2 runs it on postgres and mongo.
2. A refused write leaves the stored policy byte-for-byte as it was (no partial update, no `UpdatedAt` bump). The conformance case reads back after a refusal.
3. Not-found and stale are told apart: a missing id or a foreign tenant is `ErrPolicyNotFound`, never a version conflict. The conformance case covers both.
4. The editor's CONFLICT is not the rename CONFLICT. A duplicate name (`ErrDuplicatePolicy`) and a stale version both map to `CONFLICT`; the stale one carries `details.reason = "stale"` and the editor keys on that. Task 4 tests both.
5. `policies.setActive` and the REST update gain the guard against their own read without any wire change, so a concurrent toggle cannot undo an edit. Task 3 tests a toggle racing an edit through the stores' CAS.

---

### Task 1: The store method, memory and sqlite, and the conformance case

**Files:**
- Modify: `wardenerr/` (the file that defines `ErrPolicyNotFound`): add `ErrStaleWrite` and `ErrPolicyVersionConflict`
- Modify: `errors.go` (warden root): re-export both, beside `ErrPolicyNotFound`
- Modify: `policy/store.go`: add the method to `Store`
- Modify: `store/memory/store.go`, `store/sqlite/store.go`; and add a compile-time stub returning an error to `store/postgres/store.go` and `store/mongo/store.go` only if the build needs it before Task 2 (prefer implementing them in Task 2 in the same commit series; if a stub is used, Task 2 replaces it)
- Create: `store/contract/policy_version.go` (`RunPolicyVersionContract`)
- Create: `store/memory/policy_version_test.go`, `store/sqlite/policy_version_test.go`

**Interfaces:**
- Produces:

```go
// wardenerr
// ErrStaleWrite is returned when a conditional write finds the record changed
// since the caller read it.
var ErrStaleWrite = errors.New("warden: changed since it was read")

// ErrPolicyVersionConflict is returned by UpdatePolicyIfVersion when the
// stored policy's version is not the one the caller expected.
var ErrPolicyVersionConflict = fmt.Errorf("warden: policy changed since it was read: %w", ErrStaleWrite)

// policy.Store
// UpdatePolicyIfVersion writes p, as UpdatePolicy does, only if the stored
// policy with p's tenant and id has Version == expected. The comparison and
// the write are one atomic step. It returns ErrPolicyNotFound when no such
// policy exists in p's tenant, and ErrPolicyVersionConflict when it exists
// at another version; in both cases nothing is written.
UpdatePolicyIfVersion(ctx context.Context, p *Policy, expected int) error
```

- [ ] **Step 1: Write the conformance case** in `store/contract/policy_version.go`, following `policy_roundtrip.go`'s shape (`func RunPolicyVersionContract(t *testing.T, newStore func(*testing.T) (store.Store, func()))`). Subtests:
  - `writes when the version matches`: create a policy (version 1), `UpdatePolicyIfVersion` with a changed description and `Version: 2`, expected 1; read back: description changed, version 2.
  - `refuses a stale version and writes nothing`: from version 2, call with expected 1 and a different description; `errors.Is(err, wardenerr.ErrPolicyVersionConflict)`; read back equals the pre-call read field for field (description, version, UpdatedAt).
  - `missing id is not found`: a fresh `id.NewPolicyID()`; `errors.Is(err, wardenerr.ErrPolicyNotFound)` and not `ErrStaleWrite`.
  - `foreign tenant is not found`: the policy's id with another tenant; not found, and the stored policy is unchanged.
  - `one winner among racing writers`: 8 goroutines each call with expected = current version and a distinct description; exactly one returns nil, the other 7 return `ErrPolicyVersionConflict`; the stored description is the winner's.
- [ ] **Step 2: Wire it** for memory and sqlite (mirror `store/memory/policy_roundtrip_test.go` and `store/sqlite/policy_roundtrip_test.go`). Run `go test ./store/memory/ ./store/sqlite/ -run PolicyVersion`. Expected: build failure (method missing).
- [ ] **Step 3: Implement.** Memory: under `s.mu`, look up, compare tenant then version, then do exactly what `UpdatePolicy` does. sqlite: the same `NewUpdate` as `UpdatePolicy` plus `.Where("version = ?", expected)`; when zero rows change, read the policy by tenant and id to choose the error (`ErrPolicyNotFound` if absent, else `ErrPolicyVersionConflict`); the read only picks the error, the refusal itself was atomic. Do not bump `UpdatedAt` on a refusal (set it on a copy, or after the write succeeds, so the caller's struct is not left claiming a write that did not happen; match what `UpdatePolicy` does to `p` on success).
- [ ] **Step 4: Run** `go test -race ./store/memory/ ./store/sqlite/ ./store/contract/` and `go build ./... && go vet ./...`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store): update a policy only if its version is the one the caller read` with the files above.

### Task 2: postgres and mongo

**Files:**
- Modify: `store/postgres/store.go`, `store/mongo/store.go`
- Create: `store/postgres/policy_version_integration_test.go`, `store/mongo/policy_version_integration_test.go` (`//go:build integration`, mirroring the `policy_roundtrip_integration_test.go` beside each)

**Interfaces:**
- Consumes: `UpdatePolicyIfVersion`, `RunPolicyVersionContract`, `ErrPolicyVersionConflict` from Task 1.

- [ ] **Step 1: Wire the conformance case** for both backends. Run `go test -tags=integration -run PolicyVersion ./store/postgres/ ./store/mongo/`. Expected: FAIL (stub or missing method).
- [ ] **Step 2: Implement.** postgres: as sqlite, `.Where("version = ?", expected)` on the existing update. mongo: add `"version": expected` to the `byID` filter for the update; `MatchedCount() == 0` then reads by tenant and id to pick the error. Check the mongo model's version field name in `policyModel` before writing the filter.
- [ ] **Step 3: Run** the two integration packages with `-tags=integration -race`, plus `go test ./...`. Expected: PASS. If Docker is unavailable, stop and report; do not mark this task done on unit tests alone.
- [ ] **Step 4: Commit** `feat(store): make the policy version guard atomic on postgres and mongo`.

### Task 3: Write every policy through the guard

**Files:**
- Modify: `extension/contract/handlers_policies.go` (`PolicyUpdateInput`, `policiesUpdateHandler`, `writePolicy`), `extension/contract/errors.go` (`mapWardenError`), `extension/contract/manifest.yaml` only if the intent's schema lists fields
- Modify: `api/policy_handler.go` (the update), `api/helpers.go` (`mapError`)
- Test: `extension/contract/handlers_policies_test.go`, `api/` policy handler tests
- Modify: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/fixture-server/warden-fixtures.mjs` (mirror `expectedVersion` and the stale refusal on `policies.update`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `PolicyUpdateInput.ExpectedVersion *int \`json:"expectedVersion,omitempty"\``. A stale refusal on the wire is `{code: "CONFLICT", message: "...", details: {reason: "stale"}}`; a duplicate name stays `CONFLICT` with no `reason`.

- [ ] **Step 1: Write failing tests.**
  - `policies.update` with `expectedVersion` equal to the stored version succeeds and stores version + 1.
  - `policies.update` with an older `expectedVersion` returns `CONFLICT` with `details.reason == "stale"` and writes nothing (read back).
  - `policies.update` without `expectedVersion` still succeeds (other callers).
  - A rename onto an existing name returns `CONFLICT` without `details.reason`.
  - `writePolicy` loses a race. A handler's read and write cannot be interleaved from outside, so test `writePolicy` directly: read a policy as `before`, bump it out of band with `UpdatePolicyIfVersion`, then call `writePolicy` with the stale `before`. Expect `CONFLICT` with `reason: "stale"` and the out-of-band write intact.
  - REST update with a stale `before` (same technique) answers 409.
- [ ] **Step 2: Implement.** `writePolicy` calls `UpdatePolicyIfVersion(ctx, pol, before.Version)`. `policiesUpdateHandler` checks `in.ExpectedVersion` against `before.Version` right after reading `before` and refuses with the stale error before validating. `mapWardenError` maps `errors.Is(err, warden.ErrStaleWrite)` to `CodeConflict` with `Details: map[string]any{"reason": "stale"}` and a message saying the policy changed since it was opened, placed before the `ErrAlreadyExists` case. REST: write with `UpdatePolicyIfVersion(…, before.Version)`, and `mapError` answers 409 for `ErrStaleWrite`. Fixture: honour `expectedVersion` and answer the same error shape.
- [ ] **Step 3: Run** `go test -race ./extension/contract/ ./api/` and `go build ./... && go vet ./...`; for the fixture, the warden section of `packages/fixture-server` tests if any.
- [ ] **Step 4: Commit** in warden `fix(contract): refuse a policy edit made from a stale copy, and write every policy update against the version it read`; in forge-dashboard `feat(fixture): refuse a stale warden policy update`.

### Task 4: The editor sends its version and explains a refusal

**Files:**
- Modify: `packages/plugin-warden/src/components/policy-editor.tsx` (the patch Save sends), and the plugin's `PolicyUpdate` input type if one exists
- Test: `packages/plugin-warden/test/` policy editor tests

**Interfaces:**
- Consumes: Task 3's `expectedVersion` and `details.reason`.

- [ ] **Step 1: Write failing tests.** Save sends `expectedVersion: <loaded.version>` with the patch. A `CONFLICT` with `details.reason === "stale"` shows: "This policy changed after you opened it. Your edits are still here; open the policy again to see the current version, then make them there." The draft stays on screen and no navigation happens. A `CONFLICT` without that reason (duplicate name) keeps showing the server's message as today.
- [ ] **Step 2: Implement.** `loaded` is already held in state so a refetch cannot move the baseline; send `loaded.version`. Keep the existing error rendering for every other refusal.
- [ ] **Step 3: Run** the plugin's `test`, `typecheck` and `lint` scripts.
- [ ] **Step 4: Commit** `feat(warden): send the loaded version with a policy edit, and say when someone else changed it first`.
