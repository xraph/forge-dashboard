# Chronicle templ retirement (Phase C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inventory every feature of chronicle's templ dashboard into `chronicle/MIGRATION.md` while the pages still exist. Then unwire it from the extension, and delete `dashboard/` in a commit of its own.

**Architecture:** Three steps, in this order:
1. Read every templ page, widget and component on chronicle `main` and account for each item: migrated to the React plugin, deliberately dropped with a reason, or blocked with the shape of the fix.
2. Remove the extension's `DashboardAware` implementation and the templ config plumbing. Keep the public `DashboardMutations` field and the `WithDashboardMutations()` option as deprecated no-ops, because chronicle is a released library (v1.6.x).
3. Delete the directory in its own commit, with `go build ./... && go test ./...` green on the tree without it.

**Tech Stack:** Go (chronicle), templ (read only, then deleted), markdown.

**Spec:** `docs/superpowers/specs/2026-09-23-chronicle-dashboard-migration-design.md`, "Retiring the templ dashboard" and "Already known for `MIGRATION.md`" (including the closed-bugs list), plus the amendments. The React plugin it points at is `packages/plugin-chronicle` in forge-dashboard (Plan B, complete).

## Global Constraints

- Work in a git worktree of chronicle cut from `main`, never in chronicle's main checkout: another session has uncommitted changes there.
- Test databases: only the throwaway containers:
  - `CHRONICLE_TEST_POSTGRES_DSN=postgres://chronicle:chronicle@localhost:55432/chronicle_test?sslmode=disable`
  - `CHRONICLE_TEST_MONGO_DSN=mongodb://localhost:57017/<your own db>`
  - `CHRONICLE_TEST_REDIS_DSN=redis://localhost:56379/0`

  Never localhost:5432 or localhost:6379. Never a mongo db named `ledger_test_*`. Run the suite with `go test ./... -count=1 -p 1`. The postgres `TestTimestampMigrationKeepsExistingRows` failure may still exist on main; report it if seen, and don't fix it.
- Commits: conventional subjects, no `Co-Authored-By` or any other trailer, no em dashes anywhere (code, comments, docs, commit messages). Prose that ships in the repo (`MIGRATION.md`, README, docs) is written in Rex's voice: invoke the `rex-voice` skill before writing it.
- Comments give reasons, never pointers to plans, tasks, briefs or rulings.
- The directory deletion is ITS OWN commit, touching nothing but `dashboard/`.

## Review Focus

1. **A templ feature with no line in `MIGRATION.md`.** Every page, column, action, filter, badge and empty state must be accounted for. The review checks this by listing the templ files' visible strings against the document.
2. **A caller of `WithDashboardMutations()` or YAML `dashboard_mutations: true`.** It must still compile and load, and do nothing. Its doc must say so.
3. **The React plugin's discovery must not depend on `DashboardAware`.** Removing `DashboardContributor()` must leave `RegisterContractContributor` registered. Check how forge v1.11.1's dashboard extension discovers contract contributors.
4. **References left behind:**
   - `extension/contract/doc.go`'s "continues to run alongside" sentence;
   - README's "Dashboard" section;
   - docs pages that describe templ pages or `dashboard_mutations`;
   - build tooling that runs `templ generate` (Makefile, CI, go:generate).
5. **The committed `dashboard/.DS_Store`** goes with the directory.

---

### Task 1: `chronicle/MIGRATION.md`, written while the pages still exist

**Files:**
- Create: `MIGRATION.md` at chronicle's repo root.

- [ ] **Step 1: Read the whole templ dashboard on `main`.** That's every file under `dashboard/`: 13 pages under `dashboard/pages/`, 2 widgets under `dashboard/widgets/`, 8 components under `dashboard/components/`, plus `contributor.go`, `data.go` and `manifest.go`. For each page, list what it renders: title, every column, every action or button, every filter, every badge and its states, every empty state, every link. Include recent additions made directly to templ on main: the erasure status and legacy-key display (e81e2a2), the backfilled retained range note (e5df302), and the tenant untenanted-record guard (d1b8957).
- [ ] **Step 2: Map each item to the React plugin.** Read `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-chronicle/src` (pages, components, verification). Mark every templ item with one of:
  - **Migrated:** name the plugin page or component and route that now does it, and say how, if the behaviour changed.
  - **Deliberately dropped:** give the reason.
  - **Blocked:** give the Go work needed.
- [ ] **Step 3: Carry the known lists.** Use the spec's "Already known for `MIGRATION.md`" section:
  - **Dropped:** `AllowMutations` (now `DashboardMutations`, kept as a deprecated no-op), the settings panel duplicate, `UpdateStreamScheme`, and `compliance.ReportStore.DeleteReport`.
  - **Blocked:** the before/after diff view, and external anchoring.
  - **New, not migrated:**
    - checkpoints as a surface;
    - the coverage ceiling;
    - both destructive-action previews;
    - report export and custom reports;
    - per-event verification;
    - aggregation and activity charts;
    - by-user;
    - the stream selector;
    - `erasures.request`;
    - the three `Report` fields the templ verify page dropped.
  - **Closed bugs:** renderErasureDetail's missing scope check, tenant detail pages opening app-level records, the retention page's unconfirmed zero-duration enforce link, and sqlite overview counts silently reading 0.
- [ ] **Step 4: Write `MIGRATION.md`.**
  - Structure: a short opening for someone upgrading (what replaced the templ dashboard, and how to mount the React plugin), then one section per templ page with a table of items, then the dropped, blocked, new and closed-bugs lists.
  - Rex's voice: invoke `rex-voice` first, and no em dashes.
  - State plainly what an upgrading operator must do: `dashboard_mutations` no longer does anything; writes are governed by the contract's `requires` scopes (`chronicle.write`, `chronicle.admin`); and the dashboard app and tenant come from session claims or `chronicle.dashboard.app_id` and `tenant_id`.
- [ ] **Step 5: Commit.**

```bash
git add MIGRATION.md
git commit -m "docs: inventory the templ dashboard before it goes"
```

---

### Task 2: Unwire the templ dashboard, then delete it in its own commit

**Files:**
- Modify:
  - `extension/extension.go`: remove `DashboardContributor()`, the `dashboard.DashboardAware` assertion and the `chronicledash` import. Keep `ContractContributorAware` and its assertion.
  - `extension/config.go` and `extension/options.go`: `DashboardMutations` and `WithDashboardMutations()` stay, with docs saying they're deprecated and have no effect, naming the replacement.
  - The config merge in `extension/extension.go` around line 930: keep it harmless, or remove it with the field's meaning. The field stays so YAML with the key still loads.
  - `extension/contract/doc.go`: the sentence about templ running alongside.
  - `README.md`: the Dashboard section.
  - Docs under `docs/content/docs`: every page describing templ pages or `dashboard_mutations`.
  - Any `templ generate` in Makefile, CI or `go:generate`.
  - `go.mod` and `go.sum`: run `go mod tidy` after the directory is gone. Drop `github.com/a-h/templ` and ForgeUI if nothing else uses them.
- Delete: `dashboard/`, entirely, in its own commit.
- Test: `extension/config_merge_test.go` and any test that referenced the templ contributor.

- [ ] **Step 1: Check contract discovery doesn't need `DashboardAware`.** Read forge v1.11.1's dashboard extension (the module cache: `go list -m -f '{{.Dir}}' github.com/xraph/forge`, then `extensions/dashboard`), and find how it discovers `ContractContributorAware`. It must not require `DashboardAware`. Add or keep a test in `extension/contract_registration_test.go` (it exists) proving the contract contributor still registers.
- [ ] **Step 2: Write the failing deprecation test.** Add a test that `WithDashboardMutations()` still compiles and that YAML `dashboard_mutations: true` still loads without error, and that neither changes any behaviour a caller can observe. The existing `TestYAMLConfigKeepsDashboardMutations` asserts the old meaning: rewrite it to the new one, and explain why in its comment.
- [ ] **Step 3: Unwire.** Remove `DashboardContributor()`, the assertion and the import, and update the docs and comments listed above. The tree must build with `dashboard/` still present but unused. Run `go build ./... && go vet ./... && go test ./... -count=1 -p 1`.
- [ ] **Step 4: Commit the unwiring.**

```bash
git commit -m "refactor(extension): stop rendering the templ dashboard; the React plugin replaces it" -- <the files you changed>
```

- [ ] **Step 5: Grep for importers.** Run `grep -rn "chronicle/dashboard" --include='*.go' .` across the repo. Only files under `dashboard/` itself may match.
- [ ] **Step 6: Delete the directory.** Run `git rm -r dashboard`, then `go mod tidy`. If tidy changes `go.mod` or `go.sum`, those changes belong to this deletion. Then run `go build ./... && go vet ./... && go test ./... -count=1 -p 1` with the directory gone. Run the full suite, not a partial one.
- [ ] **Step 7: Commit the deletion on its own.** The commit may touch only `dashboard/` and `go.mod`/`go.sum`.

```bash
git commit -m "chore: delete the templ dashboard" -- dashboard go.mod go.sum
```

## Done when

- `MIGRATION.md` accounts for every templ item.
- The extension builds and the full suite passes with `dashboard/` deleted in its own commit.
- `WithDashboardMutations()` and `dashboard_mutations` still load as documented no-ops.
- Nothing in the repo refers to the templ dashboard as live.
