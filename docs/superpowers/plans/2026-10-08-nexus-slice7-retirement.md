# Nexus Slice 7: retire the templ dashboard

> Use `superpowers:executing-plans` inline after the Slice 6 review gate is clear.
> Work on main in both primary checkouts. Preserve concurrent work.

**Goal:** Remove the disconnected templ implementation once its React replacement
has passed the read and write browser gates. Keep a usable migration inventory and
verify that the Go workspace still builds with Forge v1.12.3.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`.

## Scope and review focus

Go ownership is `/Users/rexraphael/Work/xraph/forgery/nexus/dashboard/**`, `go.mod`,
`go.sum`, nested module sums only if tidy changes them, and `MIGRATION.md`.
React ownership is this plan, the migration spec and the Nexus section of BASELINE.
Do not change unrelated UI, tests or shared files. Do not create a branch/worktree.

1. Every legacy column, action, filter, badge, widget and empty state must have a
   recorded replacement or a justified deletion in MIGRATION, captured before
   source removal. Retain the distinction between local checks and deployed proof.
2. Remove only the disconnected legacy dashboard. Preserve the active Go contract,
   public gateway API, provider modules and the React host wiring.
3. Forge must resolve to v1.12.3. Remove direct templ/forgeui dependencies when no
   source imports them; verify the resolved module graph, not only go.mod text.
4. All modules must pass format, lint, tests and builds after removal. Restore only
   generated example executables that the build changes, using their pre-build
   tracked contents. Preserve any pre-existing concurrent changes.

## Task 1: retire legacy sources and tidy dependencies

**Files:** Go `dashboard/**`, root `go.mod`, `go.sum`, `MIGRATION.md`; tracked nested
module sums only if required. The inventory already exists in MIGRATION from the
25 templ files. Updated timestamp, scopes and Never semantics are in the React UI.
**Interface:** the public `extension/contract` remains the dashboard integration.

- [ ] Confirm Slice 6 has no unresolved Critical or Important findings and all
  browser prerequisites are recorded in BASELINE. Inspect main and Git status.
- [ ] Check every MIGRATION inventory row against the React routes. Update pending
  rows with their completed checks and retain the deliberate widget/docs-link drops.
- [ ] Search source imports and build scripts for templ, forgeui and the legacy
  dashboard. Delete tracked legacy dashboard paths only. Keep contract sources.
- [ ] Run `go mod tidy`, inspect dependency changes, and verify `go list -m` reports
  Forge v1.12.3. Any remaining templ/forgeui dependency must have a documented path.
- [ ] Run `make l`, then `make f`, inspect the formatting diff, rerun `make l`, and
  run `make test-race` with the existing task-owned database containers and `make b`.
  A task-owned TMPDIR prevents contention on golangci-lint's global lock. All
  commands must return zero. Restore only generated example executables.
- [ ] Recheck staged scope, commit exact owned paths and push main.

## Task 2: final qualification and independent review

**Files:** Go MIGRATION and this migration's React spec/BASELINE; local logs under
`.superpowers/sdd/2026-10-08-nexus-slice7-retirement`.
**Interface:** readers can distinguish implemented local behavior from deployment
configuration that still needs verification.

- [ ] Confirm no .templ or generated templ Go files remain in the retired directory,
  no active code imports it and the public contract tests still pass.
- [ ] Run standalone `GOWORK=off go vet ./...` and `GOWORK=off go test ./...` in each
  nested module, retaining exit codes. Root checks and the React Slice 6 checks
  cover the integrated workspace; standalone checks catch hidden workspace pins.
- [ ] Record the final checks, shared unrelated failures and unqualified installed
  authorization, provider credentials and durable idempotency configuration.
- [ ] Obtain one fresh read-only final review of the retirement diff and inventory.
  Fix Critical/Important findings in one red-to-green pass, record deferred minors
  and every declined-to-judge ruling, then commit and push the verified result.
- [ ] Gather rulings and deferred minors from all seven slice ledgers before cleanup.
  Report the migration's state and pushed commits without claiming deployed readiness.
