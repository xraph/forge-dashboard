# Vault Slice 2: Secrets and Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first end-to-end Vault surface: a Go contract contributor answering eleven secret and rotation intents, and a React plugin that lists, creates, updates, deletes and rotates secrets, runnable against the fixture server.

**Architecture:** Two repositories. In `forgery/vault`, a new `extension/contract` package mirrors `forgery/relay/extension/contract` (the closest recent sibling): an embedded `manifest.yaml`, a `Register` that loads, validates and registers it, and one handler per intent, all operating on the vault's configured app. In `forge-dashboard`, a new `packages/plugin-vault` mirrors `packages/plugin-warden` (the newest sibling package), with a matching fixture module in `packages/fixture-server`.

**Tech Stack:** Go 1.26, forge v1.10.0 dashboard contract (`dispatcher.RegisterQuery/RegisterCommand`, `loader`), React 19, `@forge-go/dashboard-plugin` (`definePlugin`, `useQuery`, `useCommand`, `PluginLink`, `useNavigateTo`), `@forge-go/dashboard-kit`, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md`. Read "The React half" and all of "What slice 1 found that slice 2 must know" before starting any task.

**This plan is written as a precise specification, not complete code.** Wire types, file paths, behaviours, test cases and the logic that is easy to get wrong are given exactly. The rest mirrors a named reference file. Implementers write the code; reviewers hold it to this text.

## Decisions this plan makes (flag any you disagree with at plan review)

Found by checking the write path, per the playbook, before designing any page that writes:

1. **Scheduled rotation starts with the extension.** Nothing in the repository ever starts `rotation.Manager`'s loop, so a policy never rotates anything on schedule, and a rotation page showing "next rotation at 14:00" would be an absence rendered as a pass. The extension's `Start` starts the loop and `Stop` stops it. This is a production behaviour change: once deployed, any secret with an enabled, due policy AND an application-registered rotator gets rotated on schedule. Secrets with a policy but no rotator log an error each minute and change nothing, as they would have if the loop had ever run. **This needs your yes at plan review.**
2. **A new or re-enabled policy gets a first due time.** `NextRotationAt` is set only after a rotation, so a policy saved from a dashboard would never fall due. `rotation.savePolicy` sets `NextRotationAt = now + interval` when the policy is new, when its interval changes, or when it goes from disabled to enabled, and leaves it alone otherwise.
3. **Updating or rotating a secret keeps its expiry and metadata.** `secret.Service.Set` builds a fresh row, and the backends upsert `expires_at` and `metadata` from it, so every update and every rotation silently erased both. `secrets.update` carries them forward unless the request changes them, and `rotation.Manager.RotateNow` is fixed to carry them forward too.
4. **`secrets.setExpiry` is dropped.** No store or service path changes expiry without rewriting the value, and under the write-only decision the server cannot read the value back. Expiry is set at create and changed on update, which takes a new value. Slice 2 has six secret intents, not seven.
5. **`secrets.list` has no key filter.** The store cannot filter by key at the index. The templ page filtered the first 100 rows after reading them, which is an abandoned search reported as complete. Paging is exact, with a real total. A key filter needs a store filter across four backends and is recorded as a gap.
6. **`secrets.create` refuses an existing key with `CONFLICT`,** because `Set` would otherwise silently add a version to it. `secrets.update` refuses a missing key with `NOT_FOUND`, because `Set` would otherwise create it.
7. **Deleting a secret deletes its rotation policy.** Otherwise the orphaned policy makes the rotation loop fail on a missing secret every minute, forever.
8. **A rotation interval must be at least 60 seconds,** the loop's check interval. A shorter one cannot be honoured.
9. **`rotation.detail` answers with `policy: null` for a secret that exists but has no policy,** and `NOT_FOUND` only when the secret does not exist. That lets one page both show and create a policy.

## Global Constraints

- Go work: `/Users/rexraphael/Work/xraph/forgery/vault`, branch `main` (consent given). React work: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. Paths below say which.
- Go gate at the end of every Go task: `go build ./... && go test ./... && golangci-lint run ./...`, lint 0 issues.
- React gate at the end of every React task, from the repo root: `pnpm --filter @forge-go/dashboard-plugin-vault test && pnpm --filter @forge-go/dashboard-plugin-vault typecheck && pnpm --filter @forge-go/dashboard-plugin-vault lint`. The final task also runs `pnpm -r test`.
- Every handler operates on the vault's configured app, `deps.Vault.AppID()`. No request carries an app id.
- Wire field names are camelCase and belong to the contract's own projection types; domain types are never serialised directly.
- Paging is `limit` and `offset` in, `total` out, everywhere.
- No handler ever calls `Secrets().Get` or `GetVersion`. No request or response anywhere carries a secret value except the `value` field on `secrets.create` and `secrets.update` requests.
- Evaluate and resolve are not in this slice, but no handler here inherits tenant or user from the request context either.
- Commit messages: no `Co-Authored-By` trailer, no Claude/Anthropic attribution. No em dashes in any shipped prose or UI copy.
- Prove any "pre-existing" failure in a clean worktree, never with `git stash`.

## Review Focus

1. A secret value must never reach a response, a query cache key, a URL, a log line or a rendered element after the request that carried it. Test the create and update pages for the value being cleared from state on success and absent from the DOM.
2. An unencrypted row must never be presented with the words encrypted, secure or protected, and the badge for it must be the destructive one on every surface that shows a secret.
3. Updating a secret without touching expiry must leave the expiry as it was, on a real backend (sqlite), not only in memory.
4. A rotation page must never show a next-rotation time for a policy that is disabled, and must say plainly when a policy has no registered rotator and therefore will never rotate.
5. Every command's `invalidates` must make the next read visibly change, in the fixture as well as the real server.

---

## Part A: Go (in `/Users/rexraphael/Work/xraph/forgery/vault`)

### Task A1: Domain fixes the contract depends on

**Files:** `vault.go`, `config.go` (comment), `rotation/manager.go`, `extension/extension.go`. Tests: `vault_test.go`, `rotation/manager_test.go`, `extension/build_vault_test.go`.

1. `func (v *Vault) AppID() string` returning `v.config.AppID`, with a doc comment saying handlers use it as the only app they operate on. Test it returns the configured value after `WithConfig` overlays.
2. `config.go`: rewrite the `EncryptionKeyEnv` doc comment. It is not a fallback that degrades to plaintext: when named, the variable must hold a valid key or `New` fails.
3. `rotation.Manager.RotateNow`: read `GetMeta` for the current secret before calling `Set`, and pass `secret.WithExpiresAt(*meta.ExpiresAt)` when non-nil and `secret.WithMetadata(meta.Metadata)` when non-empty. Test with a rotator registered: set a secret with an expiry and metadata, `RotateNow`, then assert `GetMeta` still has both and the version went up by one. It must fail against today's code.
4. Extension lifecycle: `Start` calls `e.v.Rotation().Start(context.Background())` when `e.v` is non-nil, and `Stop` calls `e.v.Rotation().Stop(ctx)` before closing the store. Use `context.Background()` for the loop, not the start context, which may be short-lived. Test through an internal extension test that `Start` then `Stop` returns without error and does not hang.

Commit: `fix(rotation): keep expiry and metadata on rotate, and start the loop`, body explaining that scheduled rotation had never run and that every rotation erased expiry and metadata.

### Task A2: Contract skeleton and the three secret queries

**Files (create):** `extension/contract/manifest.yaml`, `contract.go`, `errors.go`, `project.go`, `handlers_secrets.go`, `manifest_test.go`, `handlers_secrets_test.go`. **Modify:** `extension/extension.go` (implement `dashboard.ContractContributorAware`).

Mirror `forgery/relay/extension/contract/contract.go` and `manifest.yaml` for shape, and `forgery/authsome/extension/contract/manifest_test.go` for the three manifest tests.

`manifest.yaml`: contributor `name: vault`, `envelope: {supports: [v1], preferred: v1}`, `capabilities: [vault.read, vault.write]`. No `app` block and no `graph`: the React plugin owns routes. This task declares only `secrets.list`, `secrets.detail`, `secrets.versions` (queries, capability read) and their `queries:` cache entries (`staleTime: 30s`). Later tasks append their own intents. Keep a comment block stating that no request carries an app id and why.

`contract.go`:

```go
type Deps struct {
	// Vault is the composed vault. Required. Every handler operates on
	// Vault.AppID() and nothing else.
	Vault *vault.Vault
}

func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error
```

It fails when `deps.Vault` is nil, loads, validates and registers the manifest, then registers each intent with `vault/contract: register <intent>: %w` on failure. Contributor name constant `"vault"`.

`errors.go`: one `mapError(err error) error` translating domain errors to `*contract.Error`: `vault.ErrSecretNotFound` and `vault.ErrRotationNotFound` to `CodeNotFound`; `vault.ErrDecryptionFailed` to `CodeUnavailable` with the message "this secret is encrypted and the vault has no key configured"; anything else to `CodeInternal` with a generic message (do not echo internal error text to the client). A `badRequest(msg)` and `conflict(msg)` helper. Validate `key` as non-empty and trimmed in one helper that every keyed handler uses.

`project.go`: the wire types and projections.

```go
type SecretSummary struct {
	ID            string            `json:"id"`
	Key           string            `json:"key"`
	Version       int64             `json:"version"`
	EncryptionAlg string            `json:"encryptionAlg"` // "" means NOT encrypted
	ExpiresAt     *string           `json:"expiresAt,omitempty"` // RFC3339
	AppID         string            `json:"appId"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
}

type SecretVersionSummary struct {
	ID        string `json:"id"`
	Version   int64  `json:"version"`
	CreatedBy string `json:"createdBy,omitempty"`
	CreatedAt string `json:"createdAt"`
}

type RotationPolicySummary struct {
	ID              string  `json:"id"`
	SecretKey       string  `json:"secretKey"`
	IntervalSeconds int64   `json:"intervalSeconds"`
	Enabled         bool    `json:"enabled"`
	Rotatable       bool    `json:"rotatable"` // a rotator is registered for this key
	LastRotatedAt   *string `json:"lastRotatedAt,omitempty"`
	NextRotationAt  *string `json:"nextRotationAt,omitempty"` // omitted when disabled
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

type AuditSummary struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Outcome   string `json:"outcome"`
	UserID    string `json:"userId,omitempty"`
	CreatedAt string `json:"createdAt"`
}
```

`EncryptionAlg` has no `omitempty`: an empty string must reach the client as `""`, because absence and "not encrypted" must not be confusable. `NextRotationAt` is projected as nil when the policy is disabled, whatever the stored value, because a disabled policy has no next rotation. All times UTC RFC3339.

Handlers, all queries:

| Intent | Request | Response | Behaviour |
|---|---|---|---|
| `secrets.list` | `{limit, offset}` | `{secrets: SecretSummary[], total}` | limit defaults to 25, capped at 200; offset >= 0. `total` from `Store().CountSecrets`. Uses `Secrets().List`. |
| `secrets.detail` | `{key}` | `{secret, rotation: RotationPolicySummary\|null, recentAudit: AuditSummary[]}` | `GetMeta`; policy via `Store().GetRotationPolicy` (not-found becomes null); `recentAudit` via `Store().ListAuditByKey` limit 10. |
| `secrets.versions` | `{key}` | `{versions: SecretVersionSummary[]}` | `ListVersions`, newest first. NOT_FOUND when the secret does not exist, even if orphan versions do. |

Tests (`handlers_secrets_test.go`), against `vault.New(WithStore(memory.New()), WithAppID("app1"), WithEncryptionKey(32 bytes))`, calling handler funcs directly with `contract.Principal{}`:
- list: paging returns the requested window and the full total; a secret written under another app never appears (write one directly via `Store().SetSecret` under "app2" and assert identity, not count).
- list and detail: a row written through a keyless vault on the same store reports `encryptionAlg: ""`, and marshalling the response to JSON contains `"encryptionAlg":""`.
- detail: missing key is `NOT_FOUND` as a `*contract.Error`; rotation is null without a policy and present with one; `nextRotationAt` absent when the policy is disabled.
- versions: newest first; missing key is `NOT_FOUND`.
- A JSON marshal of every response type in this file contains no field named `value`.

`manifest_test.go`: loads, validates against `contract.NewWardenRegistry()`, registers, and asserts the contributor name is `vault` and the declared intent count matches the number registered. Update the count in each later task.

Extension: implement `RegisterContractContributor(disp, reg, wreg)` like relay's: quiet warn-and-skip when `e.v` is nil, otherwise `vaultcontract.Register(..., Deps{Vault: e.v})`, wrapping the error. Add `var _ dashboard.ContractContributorAware = (*Extension)(nil)`.

Commit: `feat(contract): add the vault contributor with the secret queries`.

### Task A3: Secret commands

**Files:** `manifest.yaml`, `contract.go`, `handlers_secrets.go`, `handlers_secrets_test.go`, `manifest_test.go`. Also a sqlite-backed test file `extension/contract/handlers_secrets_sqlite_test.go`.

| Intent | Request | Response | Invalidates |
|---|---|---|---|
| `secrets.create` | `{key, value, expiresAt?: string}` | `{secret: SecretSummary}` | `secrets.list` |
| `secrets.update` | `{key, value, expiresAt?: *string, metadata?: *map}` | `{secret: SecretSummary}` | `secrets.list, secrets.detail, secrets.versions` |
| `secrets.delete` | `{key}` | `{ok: true, key}` | `secrets.list, secrets.detail, secrets.versions` (Task A4 adds `rotation.policies, rotation.detail` once those intents exist) |

Rules:
- `value` must be non-empty on create and update: `BAD_REQUEST` otherwise. The handler never logs it, never includes it in an error, and never returns it.
- `create`: `GetMeta` first; if the key exists, `CONFLICT` "a secret with this key already exists; update it instead". Parse `expiresAt` as RFC3339; a past time is `BAD_REQUEST`.
- `update`: `GetMeta` first; missing is `NOT_FOUND`. `expiresAt` pointer semantics: absent keeps the current expiry; present `""` clears it; present timestamp sets it (future only). `metadata` absent keeps the current metadata; present replaces it. Pass the resulting expiry and metadata to `Set` as options every time, because `Set` without them erases both.
- `delete`: `Secrets().Delete`, then `Store().DeleteRotationPolicy`, ignoring `ErrRotationNotFound` only.

Tests:
- create conflict on existing key; create then list shows it; a past expiry is rejected.
- update of a missing key is NOT_FOUND and creates nothing.
- update with no expiry field keeps the existing expiry and metadata; with `expiresAt: ""` clears it; with a new timestamp changes it. These three run in the sqlite file too, against `sqlitestore` via the same `testStore` pattern as `store/sqlite/store_test.go` (copy the helper into this package's test file; test helpers cannot be imported across packages), because the erasure bug lived in the backend upsert and memory cannot prove it fixed.
- delete removes the policy as well.
- The error text for a failed create or update never contains the submitted value (send a distinctive value and assert it is absent from `err.Error()`).

Commit: `feat(contract): create, update and delete secrets without losing expiry`.

### Task A4: Rotation intents

**Files:** `manifest.yaml`, `contract.go`, `handlers_rotation.go`, `handlers_rotation_test.go`, `manifest_test.go`.

| Intent | Kind | Request | Response | Invalidates |
|---|---|---|---|---|
| `rotation.policies` | query | `{limit, offset}` | `{policies: RotationPolicySummary[], total}` | |
| `rotation.detail` | query | `{key}` | `{policy: RotationPolicySummary\|null, rotatable, records: RotationRecordSummary[]}` | |
| `rotation.savePolicy` | command | `{key, intervalSeconds, enabled}` | `{policy}` | `rotation.policies, rotation.detail, secrets.detail` |
| `rotation.deletePolicy` | command | `{key}` | `{ok: true, key}` | same |
| `rotation.rotateNow` | command | `{key}` | `{key, oldVersion, newVersion}` | `rotation.policies, rotation.detail, secrets.list, secrets.detail, secrets.versions` |

```go
type RotationRecordSummary struct {
	ID         string `json:"id"`
	OldVersion int64  `json:"oldVersion"`
	NewVersion int64  `json:"newVersion"`
	RotatedBy  string `json:"rotatedBy,omitempty"`
	RotatedAt  string `json:"rotatedAt"`
}
```

Rules:
- `rotatable` everywhere comes from `Rotation().RotatorKeys()` (build a set once per request).
- `rotation.policies`: `ListRotationPolicies` returns every policy; sort by secret key, total is the full length, then apply limit/offset. This is exact, not a post-filter.
- `rotation.detail`: `GetMeta` first (missing secret is NOT_FOUND); policy null when none; records newest first, limit 50.
- `rotation.savePolicy`: the secret must exist (NOT_FOUND). `intervalSeconds < 60` is BAD_REQUEST. Load any existing policy. Set `NextRotationAt = now + interval` when the policy is new, when the interval changed, or when it goes from disabled to enabled; otherwise keep it. Keep `LastRotatedAt`. New policies get `id.NewRotationID()` and `core.NewEntity()`.
- When this task declares the rotation queries, also add `rotation.policies` and `rotation.detail` to `secrets.delete`'s `invalidates`. Task A3 could not: an `invalidates` entry naming an intent the manifest does not declare yet may fail `loader.Validate`.
- `rotation.rotateNow`: not rotatable is BAD_REQUEST "no rotator is registered for this secret; rotators are registered in application code". Read the version before, call `RotateNow`, read the version after, and return both.

Tests: every rule above, including a table test for the three `NextRotationAt` cases and the "unchanged" case; `rotateNow` with a registered no-op rotator bumps the version and keeps expiry; the not-rotatable path returns BAD_REQUEST without writing anything.

Commit: `feat(contract): rotation policies, history and rotate-now`.

---

## Part B: React and fixtures (in `/Users/rexraphael/Work/xraph/forge-dashboard`)

Every page mirrors `packages/plugin-warden/src/pages/*.tsx` for structure, uses kit components by their paths (`@forge-go/dashboard-kit/components/<name>`), and follows the playbook's five display conventions. Every test file mirrors `packages/plugin-warden/test/*.test.tsx` and uses a `test/harness.tsx` copied from warden's with `extension: "vault"`.

**Badge mapping, with reasons, to be written into a comment in `src/badges.ts` and used everywhere:**
- Encryption: `AES-256-GCM` (or any non-empty alg, shown by name) `outline`; empty shows the text "Not encrypted" with `destructive`. The majority state is not knowable at design time (a keyless deployment is all unencrypted, a keyed one mostly encrypted), so per the playbook this is a stable semantic mapping, and "not encrypted" is the state an operator comes to find. The words encrypted, secure and protected never appear for an empty alg.
- Policy status: enabled `outline`, disabled `secondary`.
- Rotator: registered `default` ("Rotator registered"), none `outline` ("No rotator"). Most secrets have none, so none recedes.

### Task B1: Package scaffold

**Create** `packages/plugin-vault` as a copy of `plugin-warden`'s layout: `package.json` (name `@forge-go/dashboard-plugin-vault`, same scripts and deps), `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `src/index.tsx`, `src/badges.ts`, `test/harness.tsx`, `test/plugin.test.tsx`. Register in `apps/shell/package.json` and `apps/shell/src/App.tsx` exactly as warden is. Run `pnpm install`.

`definePlugin({ extension: "vault", namespace: "vault", label: "Vault", nav, routes })`. Nav, group "Secrets": Secrets `/secrets` (priority 0), Rotation `/rotation` (priority 10). Routes: `/` and `/secrets` both render the secrets list for now (the overview replaces `/` in slice 5), `/secrets/new`, `/secrets/:key`, `/rotation`, `/rotation/:key`. Pages in this task are placeholders exporting a component that renders a PageHeader, so the routes typecheck; later tasks replace them.

`src/badges.ts` exports `EncryptionBadge({ alg })`, `PolicyStatusBadge({ enabled })`, `RotatorBadge({ rotatable })`, each returning a kit `Badge` per the mapping above.

`src/keys.ts` exports `secretPath(key)` returning `/secrets/${encodeURIComponent(key)}` and `rotationPath(key)` likewise. Every link uses them. A key containing `/` or `.` must round-trip.

`plugin.test.tsx`: warden's four tests adapted to vault (resolves ready against a `vault` contributor, hidden otherwise, every nav entry has a route). Add `badges.test.tsx`: an empty alg renders "Not encrypted" with the destructive variant and never the substring "ncrypted" in any other form; `keys.test.ts`: `secretPath("db/primary.password")` encodes both characters.

Commit: `feat(plugin-vault): scaffold the vault plugin`.

### Task B2: Secrets list

**File:** `src/pages/secrets.tsx`, test `test/secrets.test.tsx`.

`useQuery<SecretsList>("secrets.list", { limit: 25, offset })` with `offset` in component state, driven by `ResourceTable`'s `pagination` / `onPageChange` (page is one-based; offset = (page - 1) * 25).

PageHeader "Secrets", description "Values are write-only: you can set and replace them here, never read them back.", action a `PluginLink` button "New secret" to `/secrets/new`.

Columns: Key (`font-mono text-xs font-medium`, a `PluginLink` to `secretPath(key)`), Encryption (`EncryptionBadge`), Version (`v{n}`, `font-mono text-xs`), Expires (`Timestamp` label "expiry"), Updated (`Timestamp` label "update"). Caption: `{total} secret(s)`, the live total including zero. Empty: `emptyMessage` "No secrets yet." with the New secret action.

When any row on the current page has an empty alg, render above the table a short note: "Secrets marked Not encrypted were stored while this vault had no encryption key. Adding a key later does not encrypt them; replace their values to re-store them encrypted." This speaks only about rows on screen and never says anything is encrypted.

Tests: the list intent with limit/offset; caption shows the server total, not the page length; zero rows shows the empty state and "0 secrets"; paging to page 2 sends offset 25; an unencrypted row shows the destructive badge and the note, an all-encrypted page shows no note; key links are encoded; an error renders the QueryBoundary error, not an empty table.

Commit: `feat(plugin-vault): secrets list with exact paging and per-row encryption`.

### Task B3: Create a secret

**File:** `src/pages/secret-create.tsx`, test `test/secret-create.test.tsx`.

Fields: Key (text, `font-mono`), Value (`type="password"`, `autoComplete="off"`, `spellCheck={false}`), Expires (optional `datetime-local`, converted to RFC3339 UTC). `useCommand("secrets.create")`. `CommandAlert` above the form for failures, including CONFLICT. Submit disabled while loading or while key or value is empty.

On success: clear the value from state BEFORE navigating, then `useNavigateTo()(secretPath(key))`. On failure: keep the key and expiry, keep the value so the operator can retry, and never render the value anywhere except the password input.

Tests (use `recordingCommandClient`): the payload has exactly `key`, `value` and, only when set, `expiresAt`; submitting navigates to the encoded detail path; a CONFLICT (make the stub THROW a `ContractError`, since a resolved `{ok:false}` never runs the failure path) renders the alert; after a successful submit the value text appears nowhere in the DOM; the value is never passed to `useQuery` (assert via `recordingClient` intents that no read carries it).

Commit: `feat(plugin-vault): create secrets without ever showing the value again`.

### Task B4: Secret detail

**File:** `src/pages/secret-detail.tsx`, test `test/secret-detail.test.tsx`.

Reads `secrets.detail` and `secrets.versions` with `{ key: params.key }` (react-router has already decoded it). A missing `params.key` renders a status line, not a query.

Layout, `DetailLayout`:
- **Header:** PageHeader title is the key; actions "Replace value" and "Delete".
- **Main:** `DescriptionList` with ID (mono), Encryption (`EncryptionBadge` plus, when empty, the sentence "Stored unencrypted. Replacing the value while a key is configured stores it encrypted."), Version, Expires (`Timestamp` "expiry"), Created, Updated, Metadata (`TagList` of `k=v`, label "metadata"). Below it, **Versions** as a timeline: an ordered list, newest first, each item `v{n}`, created by (or `NoneCell` "author"), created at; the first item marked "Current". Its heading carries the live count. There is no diff and no "view value", by design: write-only means there is nothing to compare.
- **Aside:** **Rotation**: when `rotation` is null, "No rotation policy." and a link "Set up rotation" to `rotationPath(key)`; otherwise interval, `PolicyStatusBadge`, `RotatorBadge`, next rotation (`Timestamp` "next rotation", which the server already omits when disabled), and a link to the rotation page. When there is no rotator, the sentence "No rotator is registered for this secret, so this policy will not rotate it." **Recent activity**: the audit entries, action and time, or an `EmptyState` "No recorded activity yet."

Replace value: a dialog with Value (password), and an expiry choice with three radio options: keep the current expiry (the default, sends no `expiresAt`), set a new one (sends the timestamp), remove it (sends `""`). `useCommand("secrets.update")`; `reset()` and clear inputs when the dialog OPENS; errors render INSIDE the dialog; submit uses `pending`; clear the value on success and close.

Delete: `ConfirmDialog` destructive, description naming the key and saying its rotation policy is deleted too, `pending`, error inside the dialog, navigate to `/secrets` on success.

Tests: both reads go out with the key; missing key shows the status line and sends nothing; keep-expiry sends no `expiresAt`, remove sends `""`, set sends the timestamp; update errors appear inside the dialog; reopening the dialog clears a previous error and value; delete sends `{key}` and navigates; the no-rotator sentence appears only when `rotatable` is false; a disabled policy shows no next-rotation time; the versions list marks only the newest as current.

Commit: `feat(plugin-vault): secret detail as a version timeline`.

### Task B5: Rotation

**Files:** `src/pages/rotation.tsx`, `src/pages/rotation-detail.tsx`, tests for each.

List (`rotation.policies`, same paging as secrets): columns Secret (mono link to `rotationPath`), Interval (human readable: "every 1 day", "every 6 hours", falling back to seconds), Status (`PolicyStatusBadge`), Rotator (`RotatorBadge`), Next rotation, Last rotated (both `Timestamp`). Caption with the live total. Header description: "Due policies are checked once a minute in each vault process. A policy only rotates a secret whose application registered a rotator." Empty: "No rotation policies. Set one up from a secret's page."

Detail (`rotation.detail`): when `policy` is null, a form to create one (interval in hours or days, enabled). When present, the same form prefilled plus a "Delete policy" `ConfirmDialog`. "Rotate now" is a button enabled only when `rotatable`; when disabled, the adjacent text explains why. Rotate now opens a `ConfirmDialog` stating that it creates a new version and applications must pick up the new value; on success show "Rotated from v{old} to v{new}." Records table: rotated at, `v{old} → v{new}` in mono, rotated by (or `NoneCell`), caption with count.

Validation mirrors the server: interval below 60 seconds cannot be submitted. Errors from save, delete and rotate render where the operator is looking (inside the dialog for dialog actions, above the form for the form).

Tests: create sends `{key, intervalSeconds, enabled}` with seconds computed from the unit; the rotate button is disabled with the explanation when not rotatable; rotate-now sends `{key}` and shows the version change; delete sends `{key}`; a disabled policy shows no next rotation; the records caption counts.

Commit: `feat(plugin-vault): rotation policies and rotate-now`.

### Task B6: Fixtures, verification and running it

**Files:** `packages/fixture-server/vault-fixtures.mjs` (new, self-contained like `warden-fixtures.mjs`), `server.mjs` (register `{ name: "vault", envPrefix: "VAULT", handlers: vaultHandlers }`), `verify.mjs` if it needs vault-specific inputs.

The fixture implements all eleven intents with in-memory state and the SAME rules as the Go handlers, including: CONFLICT on create of an existing key; NOT_FOUND on update of a missing key; update keeps expiry unless told otherwise; delete removes the policy; `nextRotationAt` omitted when disabled and computed on save by the three rules; `rotateNow` refused when not rotatable; `encryptionAlg: ""` present, not omitted. It never stores or returns a value (it accepts one and discards it). Every command visibly changes the next read.

Seed so the interesting states are reachable, per the playbook: at least 30 secrets so paging has a second page; one key containing `/` and `.`; one unencrypted secret; one with an expiry; one with metadata; three policies (enabled with a rotator, enabled without a rotator, disabled); rotation records on the rotatable one.

Then run it:
1. `pnpm -r test` from the root.
2. Start the fixture server and the shell (`.claude/launch.json` has both), and run `node packages/fixture-server/verify.mjs http://localhost:8099`; every vault intent must answer well formed.
3. In the browser: open Secrets, page to page 2, open the slashed key, replace its value keeping the expiry and confirm the expiry is unchanged, create a secret and confirm the list total grows, try creating the same key again and see the conflict, delete it and see the total shrink, open Rotation, rotate the rotatable secret and see the version bump on the secret page, confirm the no-rotator policy explains itself, confirm the unencrypted secret shows the destructive badge and the note. Take screenshots of the list, the detail and the rotation page.

Commit: `feat(fixture-server): vault secrets and rotation fixtures`.

## Done when

- Both repos' gates are clean, including `pnpm -r test`.
- Every eleven-intent behaviour above is tested in Go, and the expiry-preservation tests pass on sqlite.
- The shell, against the fixture server, walks the whole click-through above with no console errors.
- No secret value appears in any response, cache key, URL, log or rendered element after the request that carried it.
