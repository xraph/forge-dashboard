# Keysmith: retire the templ dashboard (slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record in `keysmith/MIGRATION.md` everything the templ dashboard did and where it went, then delete the templ dashboard and its dependencies in a commit of its own.

**Architecture:** Task 1 reads the templ sources before they go and writes the inventory, the breaking changes, the capabilities the React dashboard does not surface, and the open findings. Task 2 deletes `dashboard/` and tidies `go.mod`. Nothing outside `dashboard/` imports it (checked 2026-10-06), so the deletion needs no code changes elsewhere.

**Tech Stack:** Go (keysmith), Markdown.

**Spec:** `docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md`, sections "Retiring the templ dashboard" and "Not surfaced". Slice ledgers: `.superpowers/sdd/2026-09-30-keysmith-domain-fixes` (slice 1, recorded in memory), `.superpowers/sdd/2026-10-01-keysmith-key-write-path/progress.md`, `.superpowers/sdd/2026-10-04-keysmith-policies-and-scopes/progress.md`, `.superpowers/sdd/2026-10-05-keysmith-rotations-usage-overview/progress.md` (all in forge-dashboard).

## Global Constraints

- keysmith repo `/Users/rexraphael/Work/xraph/forgery/keysmith` on `main`, no worktrees; leave `_project_files/` alone.
- Git: `git add <exact new files>` / `git rm -r <exact path>`, `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, `--amend`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean`, `git push`.
- Commit messages and MIGRATION.md prose: Rex's voice (invoke the `rex-voice` skill before drafting, then `humanizer`), plain, "we" not "I", "you" for the reader, varied sentence length, no bolded lead-in fragments, no em or en dashes anywhere, no Co-Authored-By trailer, no Claude or Anthropic attribution.
- The deletion is its own commit, containing only the deletion and the `go.mod`/`go.sum` tidy.
- Proof after the deletion: `find . -name '*.templ'` prints nothing; `grep -rn 'keysmith/dashboard' --include='*.go' .` prints nothing; `go build ./... && go test ./...` pass; fresh-cache lint 0 issues; `make test-backends` passes.

## Review Focus

1. A templ feature that silently disappears: every page, column, action, filter, badge, widget and empty state in `dashboard/` appears in the inventory as migrated (with the React page and contract intent), replaced (with what replaced it) or dropped (with why). Pinned in Task 1 by walking every `.templ` file.
2. A downstream user upgrading keysmith hits a breaking change nobody wrote down (an error that changed meaning, a list that changed order, a migration that runs). Pinned in Task 1's breaking-changes section, built from the ledgers.
3. `go mod tidy` removes a dependency something else still needs, or leaves `templ`/`forgeui` as direct requirements nothing uses. Pinned in Task 2 by building, testing and reading the `go.mod` diff.

---

### Task 1: Write `MIGRATION.md`, and correct the store docs

**Files:**
- Create: `MIGRATION.md` (keysmith root)
- Modify: `docs/content/docs/stores/postgres.mdx`, `sqlite.mdx`, `mongo.mdx` (remove the `keysmith_usage_agg` row; slice 1 dropped that table)

Sections, in this order:
1. **What changed, in one paragraph:** the dashboard is now the React `plugin-keysmith` package in forge-dashboard, served through the contract contributor (`Extension.RegisterContractContributor`); the templ dashboard is gone. How to turn it on: `extensions.keysmith.dashboard.tenant_id` (and `app_id`), or `WithDashboardTenant`.
2. **Inventory:** one table per templ page (Overview, Keys, Key detail, Policies, Policy detail, Scopes, Rotations, Usage, Usage detail, Settings) plus the shared components and widgets, built by reading every `.templ` file in `dashboard/` and `dashboard/contributor.go`/`data.go`/`manifest.go`/`plugin_iface.go`. Each row: the templ element (column, action, filter, badge, widget, empty state), its status (Migrated / Replaced / Dropped), where it lives now (React page and contract intent) or what replaced it, and a short reason for anything dropped. The templ `dashboard.Plugin`, `KeyDetailContributor` and `PageContributor` interfaces are dropped (nothing in forgery implements them; spec).
3. **Not surfaced:** the spec's list (Purge, CleanupExpiredKeys, POST /keys/validate deliberately, editing name/description/metadata/expiry after create, GetByPrefix, DeleteByTenant, RecordBatch, DailyCount, MonthlyCount, a usage-recording middleware), plus filtering Rotations and Usage by key from the key page (the links land unfiltered).
4. **Breaking changes for anyone upgrading keysmith:** from the slice ledgers and memory, at least: sqlite rows written before 0af1673 never scan and bucket in local time; `rotation.Store` gained methods (f0d6886); `usage.Aggregation` percentiles became `*int64` and stay nil (44850c1); `keysmith_usage_agg` is dropped; `CreateKey` refuses unknown scope names (breaks authsome's keysmith adapter on its next bump); mongo policy durations now read real values (were 0); `$dateTrunc` needs MongoDB 5.0+; `Aggregate` ignores Limit/Offset; policy and scope names are unique per tenant (`ErrPolicyNameTaken`, `ErrScopeNameTaken`); `DeletePolicy` ignores revoked keys and `ErrPolicyInUse` text changed; `DeleteScope` refuses while children name it (`ErrScopeHasChildren`) or a policy allows it (`ErrScopeAllowedByPolicy`) and removes the scope from every key on memory and mongo; key, policy, scope, rotation and usage lists page in a stable order (`created_at DESC, id DESC`, scopes by name) and the memory usage query is newest first; a new mongo migration (`20261005000001`) adds stable-sort indexes; the REST API answers 409 for the new refusals. Read the ledgers for anything else that changes behaviour a caller can see.
5. **Open findings for the maintainer:** the reported-but-not-fixed list from every slice ledger's "REPORT TO REX" lines (idempotency cache holds raw keys 24h; CreateKey not atomic; no CAS on key Update; compromise rotation leaves earlier windows open; orphan rotation records; REST createKey/listKeys/usage gaps; ValidateKey treats a store outage as a miss; sqlite SQLITE_BUSY after ValidateKey's background write; sqlite foreign keys on one pooled connection; memory ListByKey across tenants; non-atomic check-then-delete in DeletePolicy and DeleteScope; unique-index races surface as INTERNAL; SQL key delete cascades rotation history; SQL rotations has no tenant index; REST create binder treats every field as required and writes the body twice; authsome's parallel API keys; warden_hook has no WardenBridge implementer). One line each, with where it lives.

- [ ] **Steps:** invoke `rex-voice`; read every `.templ` file and the Go files in `dashboard/`; read the four slice ledgers and the spec's "Not surfaced"; draft; run the draft through `humanizer` (embedded mode); `grep -n '—\|–' MIGRATION.md` prints nothing; fix the three `.mdx` rows; commit `docs: record what the dashboard migration moved, replaced and dropped` with `MIGRATION.md` and the three `.mdx` files.

### Task 2: Delete the templ dashboard

**Files:**
- Delete: `dashboard/` (all of it)
- Modify: `go.mod`, `go.sum` (via `go mod tidy`)

- [ ] **Step 1:** Confirm nothing outside `dashboard/` imports it: `grep -rn 'keysmith/dashboard' --include='*.go' . | grep -v '^./dashboard/'` prints nothing.
- [ ] **Step 2:** `git rm -r dashboard`.
- [ ] **Step 3:** `go mod tidy`; read the `go.mod` diff: `github.com/a-h/templ` and `github.com/xraph/forgeui` leave the direct requirements (templ may remain `// indirect` because forge's contract package pulls it; say so if it does).
- [ ] **Step 4:** Prove it: `find . -name '*.templ'` prints nothing; `go build ./... && go test ./...` pass; fresh-cache lint 0 issues; `make test-backends` passes.
- [ ] **Step 5:** Commit only the deletion and `go.mod`/`go.sum`: `chore: delete the templ dashboard`, body saying the React plugin replaces it and MIGRATION.md records what moved.

### Task 3: Close out (controller)

Whole-migration review across both repos (slices 1 to 6), the report to Rex with every open finding and the push question, memory update, and workspace cleanup.
