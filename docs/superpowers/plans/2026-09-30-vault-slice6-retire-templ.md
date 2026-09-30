# Vault Slice 6: Retire the templ Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Finish the vault migration the way `packages/plugin/PLAYBOOK.md` ("Retiring the templ dashboard") requires: write `vault/MIGRATION.md` from the live templ pages, account for every item, then delete `vault/dashboard/` and the `LocalContributor` that registers it, as its own commit.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md`, especially "Retiring the templ dashboard", "Already known for MIGRATION.md", and every "What slice N found" section.

## Global Constraints

- Work in `/Users/rexraphael/Work/xraph/forgery/vault`, branch `main`, directly. Shared with other sessions: commit only with `git commit --only -- <paths>`; never an index-wide git command; never touch `_project_files/` or `store/sqlite/time_roundtrip_test.go`; never connect to any database.
- Gate: `go build ./... && go test ./... && C=$(mktemp -d) && GOLANGCI_LINT_CACHE=$C golangci-lint run ./...`, lint 0 issues.
- `MIGRATION.md` and any docs prose ship in the repo under Rex's name: no em dashes or en dashes anywhere; address the reader as "you"; use "we" for team work, never "I"; practical before rationale; varied sentence length; no bolded lead-in fragment opening paragraph after paragraph. Commit messages: no `Co-Authored-By`, no attribution, no em dashes.

## Review Focus

1. Every templ page, column, action, filter, badge, empty state and widget appears in `MIGRATION.md` with exactly one fate: migrated (to which page), changed (how), deliberately dropped (why), or blocked (on what).
2. Nothing the templ pages did is lost without an entry: a reviewer comparing the `.templ` files to the file must find no gap.
3. After deletion nothing in the repo imports `vault/dashboard`, the extension no longer implements `DashboardAware`, unused modules are tidied away, and the gate passes.

---

### Task T1: Write `vault/MIGRATION.md`

**Files:** create `MIGRATION.md` at the vault repo root. Model its structure on `/Users/rexraphael/Work/xraph/forgery/relay/MIGRATION.md`.

Sections, in this order:
1. A short opening: what moved where (`@forge-go/dashboard-plugin-vault`, contract contributor `vault` in `extension/contract`), and that the file was written by walking every templ page before deleting it.
2. **What you need to do:** registering the React plugin in a shell (`import vaultPlugin from "@forge-go/dashboard-plugin-vault"`), the `@source` line for Tailwind, that vault now needs forge v1.11.2 (manifest invalidates), that the extension starts the rotation loop on every replica and claims due policies, that `enable_audit` is deprecated (audit is always on), that a named key env var that is missing now refuses to start, and any API changes a Go caller of vault will notice (`flag.WithOnFlagMutate` takes a tenant; `rotation.Store.ClaimDueRotation`; new store interface methods such as the `Count*`/`...Matching` ones and `CountSecretsUnencrypted`, which a custom store must implement). Check each claim against the code before writing it.
3. **Bugs found on the way:** every bug the spec's "Bugs found, not migrated" list and the "What slice N found" sections record, one line each, all fixed.
4. **Deliberately dropped** and **Blocked**, from the spec's lists, each with its reason or blocker.
5. **Page by page:** every templ route, and within it every column, action, filter, badge and empty state, each with its fate (migrated to which React page and element, changed and how, dropped and why). Cover the widgets and the settings page. Sources, all of which must be read: every file under `dashboard/` (the `.templ` sources plus `contributor.go`, `data.go`, `manifest.go`), and the inventories already written in `/private/tmp/claude-501/-Users-rexraphael-Work-xraph-forge-dashboard/70b3f713-2920-4ee1-b123-f0c399e5e841/scratchpad/flags-write-path.md` (section 5), `config-write-path.md` (section 6) and `audit-overview-findings.md` (section 5). For the React side, read `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-vault/src/index.tsx` and its pages.
6. **Still open:** the known gaps the spec records (plaintext in version history uncountable, expiring-soon not shown, no audit retention, `audit_hook` never attached, no rotator judged per replica, flag tag filter, last-writer-wins edits, mongo's non-transactional `SetFlagRules`, padded legacy keys).

Commit: `docs: record vault's templ dashboard before retiring it`.

### Task T2: Delete the templ dashboard

**Files:** delete `dashboard/` entirely; modify `extension/extension.go` (remove the `vaultdash` import, the `dashboard.DashboardAware` assertion and the `DashboardContributor` method; keep `ContractContributorAware`), `go.mod`/`go.sum` (`go mod tidy`; `a-h/templ` and `forgeui` go if nothing else uses them), and any test that referenced the templ contributor.

- Before deleting: `grep -rn 'xraph/vault/dashboard' --include='*.go' .` must show only `dashboard/` itself and `extension/extension.go`; stop and report anything else.
- After: the same grep is empty; the gate passes.
- Separately, update the docs pages under `docs/content/docs/` that describe the templ dashboard (`getting-started.mdx`, `index.mdx`, `guides/forge-extension.mdx`, `guides/full-example.mdx` and any others the grep finds) to describe the React plugin and point to `MIGRATION.md`. Leave mentions of the dashboard contract alone if they are accurate.

Commits: `refactor(extension): retire the templ dashboard` (the deletion, the extension change and the module tidy, together, nothing else) and `docs: point the vault docs at the React dashboard`.

## Done when

`MIGRATION.md` accounts for every templ item; `vault/dashboard/` is gone in its own commit; the gate passes; the spec's Sequencing notes slice 6 done.
