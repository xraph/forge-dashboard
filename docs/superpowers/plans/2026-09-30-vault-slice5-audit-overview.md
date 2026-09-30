# Vault Slice 5: Audit and Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last two vault surfaces: an audit log page with honest filters and totals, and an overview page at `/` that tells an operator what is wrong (unencrypted secrets, overdue or failing rotations) before it tells them what is fine.

**Architecture:** Same shape as slices 3 and 4. In `forgery/vault`, the audit store gains the filters the page needs, rotation writes audit rows of its own (including failures), every dashboard command records the operator who ran it, and the contract gains `audit.list` and `overview.stats`. In `forge-dashboard`, `packages/plugin-vault` gains the overview and audit pages, and the fixture models both intents.

**Tech Stack:** Go 1.26, forge v1.11.2, grove v1.6.3. React 19, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit` (`StatGrid`, `ResourceTable`, `FilterBar`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md`. Read "The 35 intents" (Audit and overview), "Information architecture", and "What slice 4 found that slice 5 must know" first.

**This plan is a precise specification, not complete code.** Mirror slice 4's `configmgr`, `handlers_config.go`, and `packages/plugin-vault/src/pages/config*.tsx` for structure.

## What checking the read and write paths found

Probed on memory and sqlite (full findings: `audit-overview-findings.md` in this plan's SDD workspace):

1. **The audit store filters by resource only.** No key, action, outcome or time filter exists, and there is no count by key, so `audit.list {key}` would page one set and count another.
2. **Every row says "success".** `LogFailure` has no callers, so an outcome filter would always be empty and failures are invisible.
3. **No row carries a user.** Every contract handler ignores `contract.Principal`, so a dashboard write is indistinguishable from an app write.
4. **Action strings disagree with their constants.** Written: `secret.get`, `secret.set`, `secret.delete`, `flag.created`, `flag.updated`, `flag.toggled`, `flag.deleted`, `flag.rules_set`, `flag.override_set`, `flag.override_deleted`, `config.set`, `config.rolled_back`, `config.deleted`, `override.set`, `override.deleted`. Declared and never written: `secret.accessed`, `secret.deleted`, `secret.rotated`, `flag.evaluated`.
5. **Rotation is misrecorded.** `RotateNow` shows up as a `secret.get` plus a `secret.set` with no user; a failed rotation leaves one `secret.get` success row and nothing else, and the scheduled loop's lease makes a failing policy look healthy.
6. **Reads flood the log.** Every application read through confy writes a `secret.get` row; a "recent activity" list would be mostly reads.
7. **"Encryption enabled" only means this process has a key.** One store can hold encrypted and plaintext rows, and the encrypted vault reads both. There is no count of unencrypted secrets.
8. **Overview counts:** `CountOverrides` counts config overrides only; the secrets count includes expired secrets; the rotation count includes disabled policies. The templ overview capped every count at 10000 and showed 0 on any error.
9. Flag override audit rows carry no tenant. Deleting a config entry writes no `override.deleted` rows for the overrides it removes. The `audit_hook` extension is never attached.
10. Paging on mongo can tie on `created_at` (millisecond precision); sqlite errors on an offset with no limit.

## Decisions this plan makes

1. **The audit store filters by key, action, outcome, time and read exclusion,** in the query on all four backends, with the same predicate for the count, and a stable `created_at DESC, id DESC` order.
2. **Rotation writes its own audit rows:** `secret.rotated` on success and a `secret.rotated` failure row (with the error in metadata) on every failed attempt, manual or scheduled. The declared constant finally has a writer, and failures become visible.
3. **Every dashboard command records its operator:** handlers put `Principal.User.Subject` on the context as the audit user before calling any write. Queries do not.
4. **The audit page hides reads by default** (`secret.get`), with a "Show reads" toggle. The overview's recent activity never shows reads.
5. **The action list the UI knows is the list actually written** (finding 4 plus `secret.rotated`), not the declared constants. The constant mismatch is recorded, not "fixed", because renaming written strings would split old rows from new ones.
6. **The overview reports problems first:** unencrypted secrets (new `CountSecretsUnencrypted` store method), rotation policies that are overdue, enabled without a rotator, or failed in the last 24 hours. Counts that include what the operator might not expect say so ("Config overrides", "Rotation policies (enabled of total)").
7. **Encryption on the overview states both facts:** whether this vault encrypts new writes, and how many stored secrets are not encrypted.
8. **Every command invalidates `audit.list` and `overview.stats`,** because every command writes an audit row and most change a count.
9. **Flag override audit rows carry the tenant** (as config override rows do).
10. **Expiring-soon secrets are not on the overview:** no store method answers it without a list-all. Recorded as a gap.
11. **Ride-along from slice 4:** the config versions table's value cell is capped narrower so Compare and Roll back fit at a 1024px viewport.

## Global Constraints

- Go work: `/Users/rexraphael/Work/xraph/forgery/vault`, branch `main`, directly. React work: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`, directly. No worktrees.
- Both repositories are shared with live sessions. Commit only with `git commit --only -- <your paths>` and check `git show --stat HEAD` after. Never run `git reset` (bare or otherwise), `git restore .`, `git restore --staged .`, `git checkout -- .`, `git stash`, `git clean`, or `--amend`. Files carrying someone else's edits are staged with the `git show HEAD:` + `git hash-object -w` + `git update-index --cacheinfo` recipe and committed from the index only after checking `git diff --cached --name-only` in the same command. Never open a file you do not own for writing from a script; use the Edit tool.
- Never connect to, or guess credentials for, any database or service. You may start and remove your own throwaway containers only when a task says so.
- Go gate: `go build ./... && go test ./... && C=$(mktemp -d) && GOLANGCI_LINT_CACHE=$C golangci-lint run ./...`, lint 0 issues, fresh cache every run.
- React gate: `pnpm --filter @forge-go/dashboard-plugin-vault test && pnpm --filter @forge-go/dashboard-plugin-vault typecheck && pnpm --filter @forge-go/dashboard-plugin-vault lint`.
- Every handler operates on `deps.Vault.AppID()`; no request carries an app id. Handlers call `deps.mapError(intent, err)`.
- Wire names camelCase; lists `[]` never `null`; paging `limit`/`offset` in, `total` out; always pass a limit to a store list.
- Commit messages: no `Co-Authored-By`, no Claude or Anthropic attribution, no em dashes. No em dashes in UI copy.

## Review Focus

1. Every audit filter must change both the page and the total: filter by key, action, outcome or time and the total counts exactly the rows the pages show.
2. A dashboard write must show who made it; an app write must show no user rather than a wrong one; a query must never set a user.
3. A failed rotation, manual or scheduled, must leave a failure row an operator can find by filtering outcome failure.
4. The overview must never report "encrypted" or "healthy" while an unencrypted secret or a failing rotation exists.
5. Reads must not drown writes: the default audit view and the overview's recent activity exclude `secret.get`.

---

## Part A: vault (Go)

### Task A1: Audit filters and the unencrypted count

**Files:** `audit/entry.go` (`ListOpts`), `audit/store.go` docs, the four backends' audit list and count, `secret` store interface and four backends (`CountSecretsUnencrypted`). Tests: memory and sqlite filter tests; postgres in its integration style.

- `audit.ListOpts` gains `Key string`, `Action string`, `Outcome string`, `Since time.Time` (zero means no bound; `created_at >= Since`), `ExcludeActions []string`. Empty means no filter for each. `ListAudit` and `CountAuditMatching` honour every field in the query (never post-filter) on all four backends. `ListAuditByKey` keeps working and also honours the new fields.
- Order `created_at DESC, id DESC` on every backend.
- `CountSecretsUnencrypted(ctx, appID) (int64, error)` on the secret store interface and all four backends: rows whose `encryption_alg` is empty.
- Tests (fail first): each filter alone and combined changes both the page and the count identically; `ExcludeActions: ["secret.get"]` drops reads; `Since` bounds; 30 rows with one identical `created_at` page without duplicates or gaps at limit 7; unencrypted count on mixed rows.

Commits: `feat(audit): filter audit entries by key, action, outcome and time`, `feat(secret): count secrets stored without encryption`.

### Task A2: Honest audit writers

**Files:** `rotation/manager.go` (+ option), `vault.go`, `flag/manager.go` (tenant on override rows), `extension/contract/*.go` (operator on every command), tests.

- `rotation.WithOnRotate(fn func(ctx context.Context, key, appID string, err error)) ManagerOption`. `RotateNow` calls it once per attempt that got past the policy lookup: `err == nil` after a successful rotation (after the record is written), the error otherwise (no rotator, rotator failure, write failure). `vault.go` wires it: success → `auditLog.LogAccess(ctx, key, "secret.rotated", "secret")`; failure → `auditLog.LogFailure(ctx, key, "secret.rotated", "secret", err)`, both with `scope.WithAppID`. Add `ActionSecretRotated` usage; do not rename any other action string.
- The flag manager's override writes pass the overridden tenant to its hook, and `vault.go` sets it as the row's tenant, as configmgr does.
- A helper `withOperator(ctx context.Context, p contract.Principal) context.Context` returns `scope.WithUserID(ctx, p.User.Subject)` when `p.User != nil` and `Subject` is non-empty, else ctx unchanged. Every COMMAND handler (secrets, rotation, flags, config, overrides) uses it on the context it passes to writes. No query does. `flags.evaluate` and `config.resolve` keep building fresh contexts.
- Tests (fail first): a manual rotateNow through the handler with a principal writes `secret.rotated` success with that user; a rotator error writes a failure row with the error text in metadata and the user; a scheduled failure (manager test) writes a failure row with no user; a no-rotator rotateNow writes a failure row; flag override set/delete rows carry the tenant; one command per family writes a row with the principal's subject; a query writes no user; a nil principal writes no user.

Commits: `feat(rotation): record every rotation attempt in the audit log`, `feat(contract): record the operator on every dashboard write`, `fix(flag): record the tenant on flag override audit rows`.

### Task A3: `audit.list` and `overview.stats`

**Files:** `extension/contract/handlers_audit.go`, `handlers_overview.go` (create), tests; `project.go` (`AuditSummary` gains fields), `manifest.yaml`, `contract.go`, `manifest_test.go`, `transport_test.go`.

- `AuditSummary` gains `tenantId` (omitempty), `userId` (omitempty) and `error` (omitempty, from metadata `error` on a failure row). Existing detail pages keep working.
- `audit.list {resource?, key?, action?, outcome?, includeReads?: bool, since?: RFC3339, limit, offset}` → `{entries: AuditSummary[], total}`. Default 25, max 100. `includeReads` false (default) sets `ExcludeActions: ["secret.get"]`; true sets none. Unknown `outcome` (not success/failure) → `BAD_REQUEST`. Bad `since` → `BAD_REQUEST`.
- `overview.stats {}` → `{secrets, unencryptedSecrets, flags, configEntries, configOverrides, rotationPolicies, rotationEnabled, rotationOverdue, rotationWithoutRotator, rotationFailures24h, encryptionEnabled, encryptionAlgorithm, recentActivity: AuditSummary[]}`. Overdue: enabled, rotatable, `NextRotationAt` before now. Without rotator: enabled and not in `RotatorKeys()`. Failures: `CountAuditMatching{Action:"secret.rotated", Outcome:"failure", Since: now-24h}`. `encryptionAlgorithm` is `"AES-256-GCM"` when a key is configured, `""` otherwise (read it from the vault, add an accessor if needed). Recent activity: 10 newest, reads excluded. Any count error fails the whole query (never a 0 standing in for an error).
- Manifest: both queries; `queries:` cache (audit.list 15s, overview.stats 15s). Every existing command's `invalidates` gains `audit.list` and `overview.stats`.
- Tests (fail first): filters reach the store and the total matches; reads excluded by default; bad outcome and since refused; every stat computed on a seeded vault (mixed encryption, overdue, no-rotator, a failure row in the window and one outside it); a count error surfaces as an error; transport test: one command's meta.invalidates now includes both.

Commit: `feat(contract): add the audit list and the overview stats`.

---

## Part B: forge-dashboard (React)

### Task B1: The overview page (and the slice 4 ride-along)

**Files:** create `src/pages/overview.tsx`, tests; modify `src/index.tsx` (route `/` renders the overview; nav "Overview" `/` at the top of the first group), `src/badges.tsx`; `src/pages/config-detail.tsx` (ride-along).

- `useQuery("overview.stats", {})`. Problems first: a "Needs attention" list, shown only when something is wrong, with one line per problem and a link: "{n} secret(s) are stored without encryption." (link `/secrets`), "{n} rotation polic(y|ies) overdue." / "{n} enabled polic(y|ies) have no rotator and will never rotate." / "{n} rotation attempt(s) failed in the last 24 hours." (link `/audit` filtered to action `secret.rotated`, outcome failure). When nothing is wrong: "Nothing needs attention."
- Encryption line: "New secrets are encrypted with {alg}." or, destructive, "No encryption key is configured, so new secrets are stored unencrypted." Never the word "encrypted" alone when `unencryptedSecrets > 0`.
- `StatGrid`: Secrets, Flags, Config entries, Config overrides, Rotation policies (hint "{enabled} enabled").
- Recent activity (writes only) with a link "See the audit log" to `/audit`.
- Ride-along: in `config-detail.tsx`'s versions table, cap the value cell at `max-w-48` (not `max-w-xs`) so the table fits a 1024px viewport; keep the title and truncation; update its test.
- Tests: each problem line appears only when its count is non-zero, with the right link; "Nothing needs attention." when all are zero; the destructive encryption sentence; counts render at zero; an error renders the query error, never zeros.

Commit: `feat(plugin-vault): show an overview that leads with what needs attention`.

### Task B2: The audit page

**Files:** create `src/pages/audit.tsx`, `src/audit-actions.ts`, tests; modify `src/index.tsx` (nav "Audit" `/audit`, group "Audit", priority 50), `src/badges.tsx`.

- Filters (in a `FilterBar`): Resource (All, secret, flag, config, override), Action (All plus the 16 known actions from `audit-actions.ts`), Outcome (All, success, failure), Key (exact, debounced 300ms), "Show reads" checkbox (off). Every change resets to page 1. Initial filters can come from the URL search params (so the overview's link lands filtered): `?action=secret.rotated&outcome=failure`.
- Columns: Time (`Timestamp`, with year), Action (mono), Resource badge, Key (mono; link to the entity page when the resource is secret, flag or config and the action is not a delete), Tenant (`NoneCell` when empty), User (`NoneCell` "no user" when empty), Outcome (`outline` success, `destructive` failure, with the error text under a failure). Caption `{total} entr(y|ies)`.
- Empty: "No audit entries match these filters." and, with reads hidden, "Reads are hidden. Turn on Show reads to include them."
- Tests: each filter is sent and resets the page; URL params seed the filters; reads hidden by default (`includeReads` false sent); failure row shows its error; key links only for live resources; caption at zero.

Commit: `feat(plugin-vault): browse the audit log with filters that count`.

### Task B3: Fixtures, verify, click-through

**Files:** `packages/fixture-server/vault-fixtures.mjs`, `verify.mjs` (other sessions' edits: Edit tool, cacheinfo recipe, commit the index only after checking it holds only your files).

- Seed audit rows across all 16 actions, some reads, several `secret.rotated` failures inside and outside the last 24 hours, rows with and without users and tenants; secrets with mixed encryption; an overdue policy and one without a rotator.
- Handlers mirror Go exactly (filters and totals, read exclusion, outcome and since validation, overview stats rules, every command writing an audit row with the operator `usr_1`, invalidates).
- verify: every filter changes page and total; reads excluded by default; overview stats against the seed; a command's invalidates include both new intents.
- The controller clicks through in the real shell against its own fixture.

Commit: `feat(fixture-server): model vault's audit and overview intents`.

---

## Done when

- Go gate clean, `go test -race ./audit/ ./rotation/ ./extension/... ./store/...` clean. React gate clean. verify passes every vault check. The click-through is done and its findings fixed or recorded.
- The spec gains "What slice 5 found that slice 6 must know", and the MIGRATION notes gain the templ audit and overview bugs (in-memory filtering over the newest 100, count badge of the page, no year or zone, the always-zero Overrides card, the 10000 cap, the dead "Audit Logging" setting) and the recorded gaps (action constants that were never written, no retention, `audit_hook` never attached, config delete writing no `override.deleted` rows).
