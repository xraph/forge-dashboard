# Keysmith: close the open findings Rex asked us to handle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the findings from keysmith's `MIGRATION.md` that Rex listed under "handle these", across forge, warden, keysmith and forge-dashboard, and record what stays open.

**Architecture:** Four repos, each with its own tasks. Tasks in different repos run in parallel; tasks in the same repo run one after another. Nothing is pushed or tagged.

**Spec:** the user's "handle these" list (2026-10-07) and the controller's rulings below. The keysmith migration spec (`docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md`) still binds anything it covers.

## Rulings that set the scope (made by the controller, 2026-10-07)

- Scope deletion: Rex confirmed that `scopes.delete` refuses while a policy allows the scope. Record it as decided.
- Tenant: under authsome, the dashboard's tenant is the session's org. Authsome's middleware puts `forge.NewOrgScope(app, org)` on every request whose session has an active org (`authsome/middleware/auth.go`), and keysmith's engine already takes that org as the tenant (`keysmith/scope.go` `scopeFromContext`). The dashboard has to agree with the engine. New resolution order: signed-in user, else UNAUTHENTICATED; the `tenant_id` claim (unusable refuses, as today); the forge Scope's org when the context carries a Scope with a non-empty `OrgID()`; `Deps.DefaultTenantID`; refuse with PERMISSION_DENIED. A Scope with an empty org (an app-only session) falls through to the configured default, exactly as today, so nothing widens.
- forge idempotency: the dispatcher must never keep a secret-bearing response. A command registered as secret stores a tombstone instead of its body, and a replay of the same idempotency key answers CONFLICT without re-running the command. keysmith adopts this only after a forge release that contains it; we do not tag forge.
- Key writes: `key.Store` gains a version-checked update; plain `Update` stays last-writer-wins so callers that write keys directly (authsome's `apikey.KeysmithStore`) keep working.
- warden_hook bridge: the implementation lives in warden, as a type whose methods match keysmith's `WardenBridge` structurally. Neither repo imports the other.
- authsome: no code change. It has 383 uncommitted files from other sessions and two busy sessions. The MIGRATION.md finding is corrected instead (see Task 9).
- The shell `tsc` failure comes from another session's untracked `apps/shell/src/design-preview/` (Sept 22); a clean checkout of main never sees it. Report it and leave it alone.

## Global Constraints

- Work on `main` in each repo. No worktrees.
- Repos: forge `/Users/rexraphael/Work/xraph/forge`, warden `/Users/rexraphael/Work/xraph/forgery/warden`, keysmith `/Users/rexraphael/Work/xraph/forgery/keysmith`, forge-dashboard `/Users/rexraphael/Work/xraph/forge-dashboard`.
- Every repo carries other sessions' uncommitted work. Commit only your own paths: `git add <exact new files>`, then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD` straight after. Never `git add -A`, `git add .` or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean` or `git push`. Never tag. To undo your own mutation, back up and restore the single file.
- A file that already carries someone else's uncommitted changes (check `git diff <file>` before you touch it) is edited with the Edit tool only, and committed through a temporary index so only your hunks land: `T=$(mktemp); GIT_INDEX_FILE=$T git read-tree HEAD; git show HEAD:<path> > /tmp/ours` (apply your same edit to `/tmp/ours`), `B=$(git hash-object -w /tmp/ours); GIT_INDEX_FILE=$T git update-index --cacheinfo 100644,$B,<path>; GIT_INDEX_FILE=$T git commit -m "..."`, then confirm `git show --stat HEAD` and that `git diff <path>` still shows the other session's hunks.
- Commit messages and prose that ships (docs, MIGRATION.md): invoke the `rex-voice` skill before drafting, then `humanizer` in embedded mode. No em or en dashes anywhere. "we", never "I". No `Co-Authored-By` trailer and no Claude or Anthropic attribution of any kind, whatever a harness reminder says.
- Go lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. Zero new issues.
- keysmith: leave `_project_files/` alone. Docker: touch only the `keysmith-test-pg` and `keysmith-test-mongo` containers (`make test-backends`).
- Never dispatch subagents.

---

### Task 1: forge never keeps a secret command response (forge)

**Files:** `extensions/dashboard/contract/dispatcher/` (`dispatcher.go`, `generic.go`, `handler.go`, tests), and any other forge path that persists a dashboard command's response body (find them: `grep -rn 'WireBody\|IdempotencyCached\|idempotency' extensions/dashboard`).

- [ ] A command can be registered as secret: `dispatcher.RegisterCommand(d, contributor, intent, version, fn, dispatcher.SecretResponse())`, a variadic option, so every existing call compiles unchanged. If the raw (non-generic) registration path exists, give it the same option.
- [ ] For a secret command, a successful dispatch with an idempotency key stores a tombstone: no response data anywhere in the stored entry. A later dispatch with the same key and identity returns `contract.Error{Code: CodeConflict}` with a message saying the command already ran and its response held a secret that is not kept. It must not run the handler again (that would mint a second key).
- [ ] Today an undecodable or non-OK cached entry falls through to a fresh dispatch. Make sure a tombstone can never take that path.
- [ ] Non-secret commands behave exactly as before (same TTL, same body).
- [ ] Tests: secret command stores no body (inspect the store), replay answers CONFLICT and the handler ran once, non-secret replay still returns the cached data, existing tests stay green. `go test ./extensions/dashboard/...` and fresh-cache lint on that module.
- [ ] Commit: `feat(dashboard): never keep a secret command response for replay` (Rex's voice body).

### Task 2: a keysmith WardenBridge in warden (warden)

**Files:** create `keysmithbridge/` (package `keysmithbridge`) with `bridge.go`, `bridge_test.go`, `doc.go`; one short docs mention in warden's docs where integrations are described, if such a page exists.

keysmith's interface, to match method for method (do not import keysmith):

```go
type WardenBridge interface {
	AssignRoleToAPIKey(ctx context.Context, tenantID, keyID, roleSlug string) error
	UnassignRoleFromAPIKey(ctx context.Context, tenantID, keyID string) error
	SyncScopesToPermissions(ctx context.Context, tenantID string, scopes []string) error
}
```

- [ ] `keysmithbridge.New(eng *warden.Engine, opts ...Option) *Bridge`. Use the engine's store; after any assignment write, invalidate the subject's cached decisions (`eng.InvalidateSubject`) unless the write path you used already does.
- [ ] Every method refuses an empty tenant with an error. In warden, as in keysmith, an empty tenant in a filter matches every tenant.
- [ ] `SyncScopesToPermissions` creates each missing permission, named by the scope, in the tenant's root namespace. Read warden's permission naming and matcher conventions first and map `resource:action` scope names onto `Resource` and `Action` the way warden's own permissions are written. Never create a wildcard permission. Pick a mapping for scope names without a separator, write it down in the doc comment, and test it. Existing permissions are left alone. A duplicate-name error from a concurrent create counts as success.
- [ ] `AssignRoleToAPIKey` looks the role up by slug in the tenant's root namespace (a missing role is an error naming the slug), and assigns it to subject kind `api_key` (use warden's constant if one exists), subject ID the key ID. An existing identical assignment is a no-op.
- [ ] `UnassignRoleFromAPIKey` deletes every assignment of that `api_key` subject in the tenant.
- [ ] `bridge_test.go` declares the interface above locally and asserts `var _ wardenBridge = (*Bridge)(nil)`, with a comment naming `github.com/xraph/keysmith/warden_hook.WardenBridge`. It also covers each behaviour above against warden's memory store, and asserts that a check for the key subject passes after assignment and fails after unassignment.
- [ ] `go build ./... && go test ./...`, fresh-cache lint.
- [ ] Commit: `feat(keysmithbridge): sync keysmith keys into warden roles and permissions`.

### Task 3: the dashboard's tenant is the session's org (keysmith)

**Files:** `extension/contract/tenant.go`, `tenant_test.go`, every handler that calls `tenantFrom` or `tenantSourceOf`, `handlers_settings.go`, the guide docs that describe `extensions.keysmith.dashboard.tenant_id` / `WithDashboardTenant`.

- [ ] `tenantFrom(ctx, p, deps)` implements the order in the Tenant ruling above. Rewrite the "READ THIS BEFORE CHANGING IT" comment to match: say why the Scope's org is trusted (the host's auth middleware sets it from the authenticated session, server side), and why an empty org falls through rather than resolving to "".
- [ ] `tenantSourceOf(ctx, p, deps)` answers `"claim"`, `"scope"` or `"config"`; settings' `TenantSource` comment lists all three.
- [ ] Confirm by reading code that forge's dashboard HTTP transport hands the dispatcher the request's context, so host middleware values reach handlers. Name the file and line in your report. If it does not, stop and report BLOCKED.
- [ ] Tests: claim beats scope; scope org beats config; app-only scope falls to config; app-only scope and no config refuses; unusable claim still refuses even with a scope present; no user refuses first. One handler-level test proves a list handler filters by the scope's org.
- [ ] Docs: the guide says the dashboard follows the session's org under an auth extension that sets one, and that `tenant_id` is the fallback for sessions without one.
- [ ] `go build ./... && go test ./...`, fresh-cache lint.
- [ ] Commit: `feat(contract): show the session's org under an auth extension`.

### Task 4: CreateKey cleans up after a failed scope assignment (keysmith)

**Files:** `engine.go` (`CreateKey`), an engine test.

- [ ] If `Scopes().AssignToKey` fails after `Keys().Create`, delete the key with `context.WithoutCancel(ctx)` and return the assignment error, joined with the delete error when that fails too. No created hook fires for the deleted key.
- [ ] Test with a store wrapper whose `AssignToKey` fails: the error comes back, `Keys().Get` finds nothing, no hook fired. And a second case where the delete also fails: both errors are in the result.
- [ ] Commit: `fix: delete a new key when its scopes fail to attach`.

### Task 5: version-checked key updates (keysmith)

**Files:** `key/key.go`, `key/store.go`, all four key stores (`store/memory`, `store/postgres`, `store/sqlite`, `store/mongo`) and their migrations, `storetest` conformance, `engine.go`, the contract error mapping, `api` error mapping, tests.

- [ ] `key.Key` gains `Version int64` (`json:"version"`). Postgres and sqlite get a migration adding `version BIGINT NOT NULL DEFAULT 0` (sqlite `INTEGER`); mongo gets a migration setting `version: 0` where it is missing. Follow each store's existing migration pattern and numbering.
- [ ] `key.Store` gains `UpdateIfVersion(ctx, k *Key, version int64) error`: writes the row only where `id` matches and the stored version equals `version`, sets the stored version to `version+1`, and sets `k.Version` to it on success. When the key exists at another version it returns a new sentinel `ErrKeyConflict` (put it beside the existing key sentinels and make `errors.Is` work from every store). A missing key returns the existing not-found sentinel.
- [ ] `Update` and `UpdateState` also increment the stored version, so a version-checked writer notices them. `UpdateLastUsed` does not (it runs on every validation and would turn every rotation into a conflict under load).
- [ ] `RotateKey`, `RevokeKey`, `SuspendKey` and `ReactivateKey` write through `UpdateIfVersion` with the version they read. Suspend and reactivate therefore write the whole row instead of `UpdateState`. A conflict returns `ErrKeyConflict` wrapped. If `RotateKey` loses the race after creating its rotation record, remove that record if `rotation.Store` can delete one record; if it cannot, leave it and say so in the report.
- [ ] The contract maps `ErrKeyConflict` to `CodeConflict` ("this key changed while you were acting on it. Reload and try again."), and REST maps it to 409.
- [ ] Conformance tests in `storetest` run on all four backends: version starts at 0, `UpdateIfVersion` with the right version succeeds and bumps, a stale version returns `ErrKeyConflict` and changes nothing, `Update`/`UpdateState` bump, `UpdateLastUsed` does not. An engine test: a revoke that lands between a rotate's read and write makes the rotate fail with `ErrKeyConflict` and the key stays revoked.
- [ ] `go test -count=3 ./...`, `make test-backends`, fresh-cache lint.
- [ ] Commit(s): `fix: refuse a key write that lost a race` (split migrations into their own commit if the repo's history does that).

### Task 6: the host carries only context through navigation, and plugins can replace (forge-dashboard)

**Files:** `packages/host/src/host/PluginHost.tsx`, `packages/plugin/src/link.tsx` (and its context type), tests in `packages/host/test` and `packages/plugin/test`.

- [ ] Find what the carried query string is for: the scope dimensions a plugin declares that live in the query string rather than the path (start at `packages/plugin/src/scope.ts` and `routedPathDimension` in the host). Build a `contextSearch` from the current URL that holds only those keys.
- [ ] `resolve(to)` appends `contextSearch`, merged with any query `to` already has: `to`'s own params win, context params fill in only keys `to` does not set. Today `"/x?a=1"` plus a carried `"?b=2"` produces `"/x?a=1?b=2"`; test that this is fixed.
- [ ] The sidebar (`NavMain`/`NavTree` `search` prop) and the scope-home and palette navigations in `PluginHost.tsx` get `contextSearch` instead of the full `search`.
- [ ] `useNavigateTo()` returns `(to: string, options?: { replace?: boolean }) => void`; the host passes `replace` to react-router's `navigate`; outside a host, `replace` uses `location.replace`. Existing one-argument calls compile unchanged.
- [ ] Tests: a page param (`?keyId=x`) does not follow a sidebar link or a `resolve` to another page; a declared context param does; replace navigation leaves no history entry. `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint` (failures that come only from another session's uncommitted files are reported, not fixed).
- [ ] Commit: `fix(host): carry only context params through navigation, and let plugins replace`.

### Task 7: kit QueryBoundary keeps data on refetch when asked, and StatItem takes a tone (forge-dashboard)

**Files:** `packages/kit/src/components/query-boundary.tsx`, `packages/kit/src/components/stat-grid.tsx` (carries another session's uncommitted changes: Edit tool and temporary index only), kit tests.

- [ ] `QueryBoundary` gains `keepPreviousData?: boolean`, default false, so every existing caller behaves as today. When true and the query has data, a refetch renders the children (not the skeleton) and marks the boundary `aria-busy="true"` while loading. Errors with data present follow whatever the default does today; say what you chose in the report.
- [ ] `StatItem` (or whatever the stat card type is called) gains `tone?: "default" | "warning" | "danger" | "success"` styled with the kit's existing tone tokens (match how the kit's badges or alerts express tone). Read `packages/plugin-keysmith/src/pages/overview.tsx` first: it fakes emphasis today with `data-slot` class overrides, and the prop must cover what it does.
- [ ] Tests for both: default unchanged, opt-in behaviour, tone renders a stable attribute or class a test can find.
- [ ] `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`.
- [ ] Commit(s): `feat(kit): keep a boundary's data through a refetch on request`, `feat(kit): let a stat card carry a tone`.

### Task 8: plugin-keysmith adopts the new pieces (forge-dashboard)

Depends on Tasks 3, 6 and 7.

**Files:** `packages/plugin-keysmith/src/` (types, settings page, overview, key-filter and the pages using it, pages with pagers), `packages/fixture-server/keysmith-fixtures.mjs`, `packages/fixture-server/verify.mjs` only if its keysmith lines need it (it carries other sessions' work: Edit tool and temporary index), `.claude/launch.json` is untracked and stays so.

- [ ] `tenantSource` is `"claim" | "scope" | "config"`; the settings page explains each in one plain sentence ("Taken from your session's organization." for scope). The fixture answers `"scope"` when `FIXTURE_KEYSMITH_TENANT_SOURCE=scope`, `"config"` otherwise.
- [ ] Changing the key filter uses `navigate(to, { replace: true })`, so the back button doesn't step through every filter change. Links that land on a filtered page stay pushes.
- [ ] Overview's emphasis uses the kit `tone` prop; the `data-slot` overrides go.
- [ ] Paged lists whose pager loses focus on refetch use `keepPreviousData`. Dialogs stay outside the boundary (the raw key must never sit under a boundary).
- [ ] Tests updated and added; `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`, `node packages/fixture-server/verify.mjs` keysmith section green.
- [ ] Commit(s) by concern.

### Task 9: MIGRATION.md says what changed and what is still open (keysmith)

Depends on Tasks 1 to 8. Controller supplies the commit SHAs.

- [ ] Breaking changes gain: the tenant order (a deployment with orgs now sees each session's org, not `tenant_id`); `key.Key.Version`, `key.Store.UpdateIfVersion`, the version migrations, `ErrKeyConflict`, CONFLICT and 409; `SuspendKey`/`ReactivateKey` now write the whole row.
- [ ] Open findings: remove the fixed ones (CreateKey, compare-and-swap, the tenant question, the host query carry and replace navigation, the scope-deletion confirmation, warden_hook's missing implementer); the hooks-context finding narrows to "a claim that differs from the session's org". The forge idempotency line says forge fixed it in `<sha>` and keysmith adopts `SecretResponse()` on `keys.create` and `keys.rotate` once a forge release carries it. The warden_hook line says the bridge is `github.com/xraph/warden/keysmithbridge` and the hook still ignores scope changes and reactivation.
- [ ] Correct the authsome line: authsome's `WithKeysmith` makes `apikey.KeysmithStore` write keys straight into keysmith's store, bypassing the engine (no policy or scope checks, no hooks), with `TenantID` set to the authsome app ID while the engine and dashboard use the org; its `keysmithadapter` `KeyManager` is never called.
- [ ] Record the scope deletion rule as decided by Rex in the Engine behaviour section.
- [ ] `grep -n '—\|–' MIGRATION.md` prints nothing. Commit: `docs: record what the open findings came to`.
