# Warden small fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six small, verified Warden defects: a postgres insert failure, a truncated time display, two blind spots in policy analysis, a role cap that can be lowered silently, and two dashboard pages that say or render something wrong.

**Architecture:** Each fix is local. One store fix gets a conformance case so all four backends prove it. Two contract fixes sit in the policy projection and policy analysis. One guard is shared by the contract, REST and the DSL apply. Two React fixes are copy and markup.

**Tech Stack:** Go (warden stores, contract, REST, DSL), React and TypeScript (plugin-warden).

**Spec:** none. Each item was verified against code at warden 99a8b27 on 2026-10-07 (statuses recorded in memory); Rex chose this batch over the medium items.

## Global Constraints

- Repos: warden `/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`; forge-dashboard `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. Both are shared trees with other sessions' uncommitted files.
- Commit by explicit path (`git add` only new files, by name; `git commit -m "..." -- <paths>`). Never `git add -A`, `commit -a`, `--amend`, `stash`, `checkout --`, `restore`, `reset` or `clean`. A file with someone else's uncommitted edits is changed with the Edit tool only and committed through a private `GIT_INDEX_FILE` holding only your hunks.
- No `Co-Authored-By` or attribution trailer. No em dash (U+2014) or en dash (U+2013) anywhere.
- Truth rule: every sentence a page, comment or error shows must be true in every case it can appear in.
- Integration tests run only through the existing testcontainers harnesses; never set `WARDEN_TEST_DSN` or `WARDEN_TEST_MONGO_URI`, never touch local ports 5432, 6379 or 27017.

## Review Focus

1. A resource type created through REST with no relations and no permissions must insert on postgres. Task 1's conformance case creates one with nil lists on all four stores.
2. A policy window stored with fractional seconds must display exactly what is stored, and an untouched editor must not resend a changed value. Task 2 tests the projection and the editor's no-change diff.
3. Analysis must never call a regex "always matches" when one input can fail it. Task 2 tests each new entry against a value containing a newline and the empty string.
4. Lowering a cap below the live member count is refused on every write path, but raising it, clearing it, or keeping it equal is not. Task 3 covers the contract, REST and DSL apply.
5. The schema apply confirmation keeps its checkbox working (the apply button stays gated on it) after the checkbox moves out of the description. Task 4 tests it.

---

### Task 1: postgres stores a resource type with empty lists

**Files:**
- Modify: `store/postgres/models.go` (`resourceTypeToModel`, about :468-469): wrap the list columns in the existing `orEmpty` helper, as commit 69f7436 did for policies
- Create: `store/contract/resourcetype_empty_lists.go` (`RunResourceTypeEmptyListsContract`), wired in `store/memory`, `store/sqlite` (plain tests) and `store/postgres`, `store/mongo` (`//go:build integration`), mirroring how `RunPolicyRoundTripContract` is wired in each

- [ ] **Step 1:** Write the case: create a resource type whose relation and permission lists are nil (not empty slices), read it back, and assert both lists come back empty (length 0, not an error). Also update one with nil lists if the store has a resource-type update.
- [ ] **Step 2:** Run it on postgres through the harness (`go test -tags=integration -run ResourceTypeEmptyLists ./store/postgres/`). Expected: FAIL with a NOT NULL violation.
- [ ] **Step 3:** Apply `orEmpty` in `resourceTypeToModel`. Check whether `api/resourcetype_handler.go` (about :78-101) needs no change once the store accepts nil; leave it if so.
- [ ] **Step 4:** Run the case on all four stores (memory and sqlite plain; postgres and mongo with `-tags=integration`), then `go test ./...`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(postgres): store a resource type with no relations or permissions`.

### Task 2: Policy windows at full precision, and two analysis blind spots

**Files:**
- Modify: `extension/contract/handlers_policies.go` (`rfc3339Ptr` about :160 and any other place it formats a window bound with `time.RFC3339`): format with `time.RFC3339Nano`
- Modify: `extension/contract/policy_analysis.go` (`matchEveryRegex` about :110; the condition rules near `alwaysPresentFields` about :97-101 and :277-283)
- Test: `extension/contract/handlers_policies_test.go`, `extension/contract/policy_analysis_test.go`
- Check: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-warden/src/components/policy-editor.tsx` and the policy detail page, for how a window bound string is shown and diffed; fix only if a fractional value breaks them

- [ ] **Step 1: Window tests.** A policy stored with `NotBefore` at `2026-10-07T10:00:00.123456789Z` projects that exact string. The editor, given that loaded value and no edit, sends no `notBefore` in its patch (add a plugin-warden test if the diff is string-based).
- [ ] **Step 2: Analysis tests.** For each candidate added to `matchEveryRegex`, a test proves Go's `regexp.MatchString` returns true for `""`, for `"a\nb"`, and for an arbitrary string. Candidates to verify, not to assume: `^`, `$`, `a*` (and the general `x*` form only if it is genuinely always-true: `a*` matches the empty prefix of any string, so it is). A `neq ""` condition on a field Check always requires (subject id, action name, resource type, per `engine.go:289-296`) is classified the same way the analysis already classifies an always-true condition. Read `engine.go` to confirm which fields Check refuses when empty before writing the rule.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement. Keep the existing comment's reasoning true (it explains why `^.*$` is absent); extend it for each addition.
- [ ] **Step 5:** `go test -race ./extension/contract/`, `go test ./...`; plugin-warden test/typecheck/lint if touched.
- [ ] **Step 6:** Commit `fix(contract): project policy windows at full precision, and catch more conditions that always hold`.

### Task 3: A member cap cannot be lowered below the live member count

**Files:**
- Modify: `extension/contract/members.go` (a new helper beside `guardMemberCap`, reusing its live-member count), `extension/contract/handlers_roles.go` (the update, about :365-367), `api/role_handler.go` (about :204-205), and the DSL apply's role update in `dsl/applier.go` if it writes `MaxMembers`
- Test: the matching `_test.go` files

**Interfaces:**
- Produces: a refusal when the new cap is positive and below the number of live members (live as `guardMemberCap` counts them). Contract: `CONFLICT` with the message `"<role name>" has <n> members, so its cap cannot be lowered to <cap>`. REST: 409 with the same text. DSL apply: the role update fails the apply the way any write error does today.

- [ ] **Step 1:** Tests, per path: lowering below the live count is refused and nothing is written; lowering to exactly the live count, raising, and clearing (0) all save; expired assignments do not count.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the shared helper and call it from the three paths. The count read and the write are not atomic; say so in the helper's comment and do not claim otherwise in any message.
- [ ] **Step 4:** `go test -race ./extension/contract/ ./api/ ./dsl/`, `go test ./...`.
- [ ] **Step 5:** Commit `fix(roles): refuse a member cap below the role's live member count`.

### Task 4: Two dashboard pages

**Files:**
- Modify: `packages/plugin-warden/src/pages/schema.tsx` (about :438-455): move the Checkbox and Label out of the ConfirmDialog `description` into its `children` slot (`packages/kit/src/components/confirm-dialog.tsx:88-100`)
- Modify: `packages/plugin-warden/src/pages/permission-detail.tsx` (the note at about :155 and the GrantedBy copy at about :183-192 and :235-239)
- Test: the matching plugin-warden test files

- [ ] **Step 1: Tests.** Schema: the checkbox is not inside the dialog's description element, and the apply button is still disabled until it is checked. Permission detail: the page says a check matches on resource and action, so another permission with the same resource and action (another name, or another namespace the check falls in) grants the same check and is not listed. Write that sentence plainly and verify it against `matcher.go` and the namespace cascade before committing to its wording.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The plugin's test, typecheck and lint scripts.
- [ ] **Step 5:** Commit `fix(warden): keep the schema checkbox out of the dialog text, and say what else grants a permission's check`.
