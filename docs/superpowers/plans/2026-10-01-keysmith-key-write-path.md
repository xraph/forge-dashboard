# Keysmith key write path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator create, rotate, revoke, suspend and reactivate keys, close grace windows, and assign or remove scopes from the dashboard, with the raw key shown exactly once and nowhere else.

**Architecture:** The keysmith contract gains one tenant-checked loader that every by-ID write goes through, two read-only pickers (`policies.list`, `scopes.list`), and eight commands with per-action error messages. The fixture models every write so the next read changes. `plugin-keysmith` gains a one-time reveal component, a create dialog on the list, and the detail page's actions.

**Tech Stack:** Go 1.26 + forge v1.10.0 contract; Node fixture; React 19 + Base UI (via kit) + vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md` (sections "The one-time secret", "Commands", "Decisions"). Slice 3 of 6. Slices 1 and 2 are complete; slice 2's final review recommendations are carried in below.

## Global Constraints

- Everything in plan 2's Global Constraints still holds: two repos on `main`, shared trees, `git commit --only` of exact paths, check `git diff <file>` before committing any pre-existing shared file, no trailer, no Claude attribution, no em dashes, Rex's voice, Go lint with a fresh cache, `make test-backends`, React test/typecheck/lint per package. Edit only `packages/plugin-keysmith/**` and `packages/fixture-server/keysmith-fixtures.mjs` in forge-dashboard (plus keysmith lines in `server.mjs`/`verify.mjs` only through the controller).
- Wire is camelCase; times RFC3339 UTC; durations whole seconds. Policy durations that are unset are `null`.
- The raw key appears in exactly two responses, `keys.create` and `keys.rotate`, as `rawKey`. No query, no other command, no fixture state, no URL, no toast, no log line, no query-store entry ever holds it. The fixture generates it, returns it, and keeps only the hint.
- Every by-ID write loads the key through `loadKeyForTenant` and answers the same `NOT_FOUND` "key not found" for a missing key and another tenant's key.
- Every command records the operator: `createdBy` / `rotatedBy` is the principal's subject, never a request field.
- No toast for any key action. The reveal is the confirmation for create and rotate; the detail page's next read is the confirmation for the rest.
- `rotated` is never a value the dashboard sends or shows; `scheduled` is never a reason the dashboard sends.

## Review Focus

1. A raw key left in memory after the reveal closes: `create.data`, a query-store record, the DOM, or a dangling clipboard timer holding it. Task 9 pins DOM and store; the dialog keeps the key only in its own state and calls `reset()` on the hook at once.
2. A rotation with a zero grace while an earlier window is still open: the reveal must list the earlier previous key as still accepted, not claim every previous key stopped. Tasks 4 and 10 pin it.
3. A write aimed at another tenant's key or policy ID: identical NOT_FOUND / BAD_REQUEST to a missing one, and nothing changes. Tasks 1, 3 and 5 pin it.
4. A double click on any destructive confirm: one command goes out. `ConfirmDialog` gets `pending`; the rotate and create dialogs disable their submit while `loading`. Tasks 9 to 11 pin it.
5. A key whose stored state is active but whose expiry has passed: Suspend and Rotate are not offered (the engine refuses rotate; suspend of an effectively expired key has no point), and the page says why. Task 11 pins it.

---

## File Structure

keysmith `extension/contract/`:

| File | Responsibility |
|---|---|
| `load.go` | `loadKeyForTenant`, `listOpenWindows`, `requireID` |
| `handlers_pickers.go` | `policies.list`, `scopes.list` |
| `handlers_key_create.go` | `keys.create` |
| `handlers_key_rotate.go` | `keys.rotate`, `keys.endGrace` |
| `handlers_key_state.go` | `keys.revoke`, `keys.suspend`, `keys.reactivate` |
| `handlers_key_scopes.go` | `keys.scopes.assign`, `keys.scopes.remove` |
| `manifest.yaml`, `contract.go` | intents and bindings |

forge-dashboard `packages/plugin-keysmith/src/`:

| File | Responsibility |
|---|---|
| `types.ts` | new wire types |
| `components/one-time-key.tsx` | the reveal: anatomy, copy, hide, acknowledgement, done |
| `components/create-key-dialog.tsx` | form then reveal |
| `components/rotate-key-dialog.tsx` | reason and grace, then reveal with windows |
| `components/key-actions.tsx` | revoke, suspend, reactivate, end grace |
| `components/scopes-editor.tsx` | assign and remove scopes |
| `pages/keys.tsx`, `pages/key-detail.tsx` | wire the above in |

---

### Task 1: Contract foundations: tenant-checked loader, open windows without a cap, appFrom edges

**Files (keysmith):** Create `extension/contract/load.go`, `load_test.go`; modify `handlers_keys.go` (detail uses the loader and `listOpenWindows`), `tenant_test.go`; fix the two comments the slice 2 review flagged ("CreateKey would refuse both" in `handlers_keys_test.go`, and the fixture's "CreateKey refuses that" is fixed in Task 7).

**Interfaces (Produces):**

```go
// requireID trims raw and parses it as a key ID. Empty answers BAD_REQUEST
// "id is required"; unparseable answers BAD_REQUEST "id is not a key id".
func requireID(raw string) (id.KeyID, error)

// loadKeyForTenant loads the key and answers keyNotFound() when it does not
// exist OR belongs to another tenant, so the two are indistinguishable.
// Every by-ID handler, read or write, goes through it.
func loadKeyForTenant(ctx context.Context, deps Deps, tenant, rawID string) (*key.Key, error)

// listOpenWindows pages through ListRotations for the key until a short
// page, keeping records with a non-empty OldHint and GraceEnds after now,
// sorted by GraceEnds ascending. There is no cap: the slice 2 detail read
// stopped at 100 and could hide a still-valid previous key.
func listOpenWindows(ctx context.Context, eng *keysmith.Engine, keyID id.KeyID, now time.Time) ([]PreviousKey, error)
```

- [ ] **Step 1: Failing tests.** `load_test.go` via `storetest.Each`: `requireID` cases (empty, spaces, `"not-a-key"`, valid); `loadKeyForTenant` returns the key for its tenant, and the byte-identical error for another tenant's ID and a fresh `id.NewKeyID()`; `listOpenWindows` with 120 rotations of one key where the OLDEST has `GraceEnds` 30 days out and the rest are closed returns exactly that one (write the records directly with `s.Rotations().Create`, oldest `CreatedAt` first, `OldHint` set). `tenant_test.go`: `appFrom` with `app_id: ""` refuses, `app_id: 7` with no default refuses, absent with no default returns "".
- [ ] **Step 2: Implement** `load.go`; switch `keysDetailHandler` to `loadKeyForTenant` and `listOpenWindows` (delete its local 100-cap code). Page size for `listOpenWindows`: 100 per `ListRotations` call.
- [ ] **Step 3:** `go test ./... && make test-backends`, lint. Commit `refactor(contract): load every key through one tenant check and list every open window` with the five paths.

---

### Task 2: policies.list and scopes.list (pickers)

**Files (keysmith):** Create `handlers_pickers.go`, `handlers_pickers_test.go`; modify `project.go`, `manifest.yaml`, `contract.go`.

**Interfaces (Produces):**

```go
type PolicySummary struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	Description           string   `json:"description,omitempty"`
	MaxKeyLifetimeSeconds *int64   `json:"maxKeyLifetimeSeconds"`
	GraceSeconds          *int64   `json:"graceSeconds"`
	AllowedScopes         []string `json:"allowedScopes"` // never nil
}
type ScopeSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Parent      string `json:"parent,omitempty"`
	Description string `json:"description,omitempty"`
}
type pickerRequest struct{ Limit, Offset int } // json "limit", "offset"
type policiesListResponse struct {
	Policies []PolicySummary `json:"policies"`
	HasMore  bool            `json:"hasMore"`
}
type scopesListResponse struct {
	Scopes  []ScopeSummary `json:"scopes"`
	HasMore bool           `json:"hasMore"`
}
```

Paging as the spec says for these two: `limit` default 100, cap 200 (pickers want everything in one go), fetch `limit+1` and answer `hasMore`. Both filter by the resolved tenant. Sort: policies by name, scopes by name (do it in the handler so all backends agree). Manifest: `policies.list` and `scopes.list`, `kind: query`, `capability: read`, cache `staleTime: 30s`.

- [ ] Tests (storetest.Each): tenant isolation by ID for both; `hasMore` true with `limit: 2` and three rows; a policy with unset grace/lifetime projects nulls; sorted by name. Commit `feat(contract): list policies and scopes for the key forms`.

---

### Task 3: keys.create

**Files (keysmith):** Create `handlers_key_create.go`, `handlers_key_create_test.go`; modify `errors.go` (nothing), `manifest.yaml`, `contract.go`.

**Interfaces (Produces):**

```go
type keysCreateRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Environment string   `json:"environment"`
	Prefix      string   `json:"prefix"`
	PolicyID    string   `json:"policyId"`
	Scopes      []string `json:"scopes"`
	ExpiresAt   string   `json:"expiresAt"` // RFC3339 or ""
}
type keyWithSecretResponse struct {
	Key    KeySummary `json:"key"`
	RawKey string     `json:"rawKey"`
}
```

Rules, in this order, each refusal `BAD_REQUEST` with the message shown:
1. `tenantFrom`, `appFrom`, `requireUser` (subject becomes `CreatedBy`).
2. `name` trimmed, required ("name is required"), at most 200 characters ("name is too long").
3. `environment` in live, test, staging ("environment must be one of live, test, staging").
4. `prefix` matches `^[a-z][a-z0-9]{1,15}$` ("prefix must be 2 to 16 lowercase letters or digits, starting with a letter"). No underscore: the default generator writes `prefix_environment_random`, and an underscore in the prefix would make the key's parts ambiguous.
5. `expiresAt`, when set, parses as RFC3339 and is in the future ("expiresAt must be an RFC3339 timestamp in the future").
6. `policyId`, when set, parses and the policy exists IN THIS TENANT; otherwise "policy not found" (same message for missing and another tenant's: never confirm a foreign ID). The engine does not check the policy's tenant; this handler is the guard.
7. Call `eng.CreateKey(keysmith.WithTenant(ctx, app, tenant), &keysmith.CreateKeyInput{..., TenantID: tenant, CreatedBy: subject})`.
8. Engine errors, mapped per action: `ErrScopeNotFound` gives `scope "<name>" does not exist in this tenant` (extract the name from the wrapped error if present, else "a scope does not exist in this tenant"); `ErrScopeNotAllowed` gives "a scope is outside this policy's allowed scopes"; `ErrKeyLifetimeExceeded` gives "expiresAt is beyond this policy's maximum key lifetime"; anything else through `deps.mapError`.
9. Answer `keyWithSecretResponse` with `projectKey(created, scopes, now)`.

Manifest: `keys.create`, command, write, `invalidates: [keys.list, keys.detail, overview, policies.detail]` (later-slice intents in `invalidates` are allowed only if `loader.Validate` accepts unknown names; if it refuses, list only intents that exist and say so).

- [ ] Tests (storetest.Each): created key's stored `TenantID` is the resolved tenant and `CreatedBy` the subject even when the principal has a claim AND a different default; the returned `rawKey` validates through `eng.ValidateKey` and ends in the returned key's `hint`; another tenant's policy ID and a random one answer the identical "policy not found"; each validation message; scope not found and scope not allowed messages; lifetime exceeded; the key list afterwards contains the key and the marshalled list and detail never contain the `rawKey` value. Commit `feat(contract): create keys and hand back the raw key once`.

---

### Task 4: keys.rotate and keys.endGrace

**Files (keysmith):** Create `handlers_key_rotate.go`, `handlers_key_rotate_test.go`; modify `manifest.yaml`, `contract.go`.

**Interfaces (Produces):**

```go
type keysRotateRequest struct {
	ID           string `json:"id"`
	Reason       string `json:"reason"`       // manual | compromise | policy
	GraceSeconds *int64 `json:"graceSeconds"` // absent or null: engine default
}
type keysRotateResponse struct {
	Key          KeySummary    `json:"key"`
	RawKey       string        `json:"rawKey"`
	PreviousKeys []PreviousKey `json:"previousKeys"` // every window open after this rotation, never nil
}
type keysEndGraceRequest struct{ ID string } // json "id"
type keysEndGraceResponse struct {
	Key    KeySummary `json:"key"`
	Closed int64      `json:"closed"`
}
```

Rules: `loadKeyForTenant`; `reason` in manual, compromise, policy ("reason must be one of manual, compromise, policy"); `graceSeconds`, when present, is 0 to 7776000 inclusive (90 days; "graceSeconds must be between 0 and 7776000"); call `RotateKey(ctx, id, reason, WithRotatedBy(subject), [WithGrace(seconds) if present])`; `ErrInvalidStateTransition` gives CONFLICT "a revoked or expired key cannot be rotated"; answer the key reloaded after the rotation and `listOpenWindows` computed after it. `keys.endGrace`: load, `EndGrace`, answer the reloaded key and the count. Manifest: `keys.rotate` invalidates `[keys.list, keys.detail, rotations.list, overview]`; `keys.endGrace` invalidates `[keys.detail, rotations.list, overview]` (same rule about unknown names as Task 3).

- [ ] Tests (storetest.Each): rotate answers a `rawKey` that validates and a `previousKeys` holding the old hint; `graceSeconds: 0` answers no window for that rotation BUT still lists an earlier rotation's open window (Review Focus 2); absent grace uses the policy grace (2h policy) else 24h, read back through the response window's `graceEnds`; `scheduled` reason refused; out-of-range grace refused; another tenant's key NOT_FOUND; revoked key CONFLICT with the message; endGrace closes every window and the next detail shows none; `rotatedBy` on the record is the subject. Commit `feat(contract): rotate keys and close grace windows from the dashboard`.

---

### Task 5: keys.revoke, keys.suspend, keys.reactivate

**Files (keysmith):** Create `handlers_key_state.go`, `handlers_key_state_test.go`; modify `manifest.yaml`, `contract.go`.

```go
type keysRevokeRequest struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}
type keyIDRequest struct{ ID string } // json "id"
type keyResponse struct {
	Key KeySummary `json:"key"`
}
```

Rules: all three `loadKeyForTenant`. Revoke: `reason` trimmed, required ("reason is required"), at most 500 characters; already revoked gives CONFLICT "this key is already revoked". Suspend: CONFLICT "only an active key can be suspended" for any key whose EFFECTIVE state is not active (check before calling the engine, so an active-but-expired key is refused too). Reactivate: CONFLICT "only a suspended key can be reactivated". Each answers the reloaded key. Invalidates: all three `[keys.list, keys.detail, overview]`, revoke also `rotations.list`.

- [ ] Tests (storetest.Each): each happy path changes the next `keys.detail`; each refusal message; revoke ends open windows (next detail has no previous keys); the Warden revoke hook is not this slice's concern. Commit `feat(contract): revoke, suspend and reactivate keys`.

---

### Task 6: keys.scopes.assign and keys.scopes.remove

**Files (keysmith):** Create `handlers_key_scopes.go`, `handlers_key_scopes_test.go`; modify `manifest.yaml`, `contract.go`.

```go
type keysScopesRequest struct {
	ID     string   `json:"id"`
	Scopes []string `json:"scopes"`
}
```

Rules: `loadKeyForTenant`; `scopes` non-empty after trimming and de-duplication ("scopes must name at least one scope"); assign maps scope errors as Task 3; remove of a scope the key does not have is not an error (idempotent); a revoked key refuses both with CONFLICT "a revoked key's scopes cannot be changed". Answer `keyResponse`. Invalidates `[keys.list, keys.detail]`.

- [ ] Tests: assign then detail shows the scope sorted; assign an unknown or another tenant's scope name gives the message; policy allowed-scopes refusal; remove; revoked refusal. Commit `feat(contract): assign and remove a key's scopes`.

---

### Task 7: Fixture for every new intent

**Files (forge-dashboard):** `packages/fixture-server/keysmith-fixtures.mjs` only.

Mirror Tasks 1 to 6 exactly: same validation messages and order, same CONFLICT messages, same NOT_FOUND rule, the uncapped open-window rule, `policies.list` / `scopes.list` with `hasMore`. Seed scopes in acme (`billing:read`, `billing:write`, `reports:read`, `catalog:read`, `admin:all`) and one in globex. Writes change state: create appends a key (hint = last 4 of the generated raw key; raw key from `crypto.randomBytes(32).toString("hex")` as `${prefix}_${environment}_${hex}`; never stored); rotate appends a rotation record with `oldHint`, `newHint`, `graceEnds = now + grace` (grace from request, else the key's policy `graceSeconds`, else 86400) and replaces the hint; endGrace sets every open window's `graceEnds` to now; revoke sets state and `revokedAt` and ends windows; suspend and reactivate set state; scopes assign/remove edit the key's scope list. Every handler declares `invalidates` exactly as the Go manifest. Fix the comment that says CreateKey refuses another tenant's policy (it refuses only a dangling one; the contract is the guard).

- [ ] Exercise over HTTP on a free port: create returns a rawKey whose last 4 equal the key's hint and the next `keys.list` grows; the rawKey string appears nowhere in a subsequent `keys.list`, `keys.detail` or a dump of the fixture state (`JSON.stringify` of the module's state, via a temporary debug line you remove before committing, or by grepping every later response); rotate then detail shows the previous key; endGrace empties it; revoke/suspend/reactivate change state; refusals return the Go messages. Paste outputs. Commit `feat(fixture): model every keysmith key write`. `verify.mjs` INPUT entries for the new commands: write them in the working tree and report them; the controller commits them.

---

### Task 8: Types and the one-time reveal component

**Files (forge-dashboard):** modify `src/types.ts`; create `src/components/one-time-key.tsx`, `test/one-time-key.test.tsx`.

**Interfaces (Produces):**

```ts
export interface PolicySummary { id: string; name: string; description?: string; maxKeyLifetimeSeconds: number | null; graceSeconds: number | null; allowedScopes: string[] }
export interface ScopeSummary { id: string; name: string; parent?: string; description?: string }
export interface PoliciesList { policies: PolicySummary[]; hasMore: boolean }
export interface ScopesList { scopes: ScopeSummary[]; hasMore: boolean }
export interface KeyWithSecret { key: KeySummary; rawKey: string }
export interface KeyRotated { key: KeySummary; rawKey: string; previousKeys: PreviousKey[] }
export type RotationReason = "manual" | "compromise" | "policy"

export interface OneTimeKeyProps {
  rawKey: string
  summary: KeySummary   // prefix, environment, hint
  children?: ReactNode  // extra content under the key (the rotate dialog's window list)
  onDone: () => void
}
export function OneTimeKey(props: OneTimeKeyProps): JSX.Element
```

Behaviour (the approved reveal design):
- Heading "Save your new key", line "This is the only time Keysmith will show it."
- The key large (`font-mono text-lg break-all`). When `rawKey` starts with `` `${prefix}_${environment}_` ``, that part renders muted; the body at full weight; the last four characters underlined; below it "You'll recognise it later as" and `maskedKey(summary)` in mono. When it does not start that way (a custom generator), render it whole with only the last four underlined. Never split on `_`.
- Copy button (`navigator.clipboard.writeText`; on failure the text stays `select-all` and the button reads "Select and copy"; on success "Copied" for 2 seconds, timer cleared on unmount). Hide/Show toggles the key between visible and `••••` (the masked form stays visible).
- Checkbox "I've stored this key somewhere safe". Done disabled until it is ticked. Done calls `onDone`.
- While mounted, a `beforeunload` listener calls `preventDefault()` and sets `returnValue`; removed on unmount.
- The component never copies `rawKey` into anything but its own render.

- [ ] Tests: anatomy split for `sk_live_...` (muted prefix part present, underline on last four, masked line `sk_live_…a3f8`); custom-format key renders whole; copy calls the clipboard with the exact value and shows Copied; Hide masks it; Done disabled until ticked; `beforeunload` is prevented while mounted and not after unmount. Commit `feat(plugin-keysmith): add the one-time key reveal`.

---

### Task 9: Create a key from the list

**Files:** create `src/components/create-key-dialog.tsx`, `test/create-key-dialog.test.tsx`; modify `src/pages/keys.tsx` (header action "Create key", and the empty state's action), `test/keys.test.tsx`.

Behaviour:
- Kit `Dialog`. Form: Name, Description, Environment (radio: Live, Test, Staging; default Test), Prefix (default "sk", mono, live preview `` `${prefix}_${environment}_…` ``), Policy (select from `policies.list`: "No policy" plus each policy name; showing its max lifetime and grace via `formatDuration` or "No maximum"/"Not set"), Expiry (optional date input; when a policy with a max lifetime is chosen, a line "Keys under this policy expire after <duration> unless you choose an earlier date."), Scopes (checkbox list from `scopes.list`, narrowed to the policy's `allowedScopes` when non-empty, with a line saying so). Client-side validation mirrors the server's messages for name and prefix; the server is still the authority, and a server `BAD_REQUEST` renders INSIDE the dialog (Base UI marks everything outside inert).
- Submit disabled while `create.loading`. On success: copy `rawKey` and `key` into the dialog's own state, call `create.reset()` immediately, and render `OneTimeKey`. While revealing, `disablePointerDismissal` and the `onOpenChange` handler refuse to close for Escape (check Base UI 1.7's `eventDetails.reason` and how to cancel; if it cannot be cancelled, ignore the close request in the handler, which keeps `open` true).
- Done: clear the state and `navigate(keyPath(key.id))` with `useNavigateTo`.
- Closing before submit (Cancel or Escape) clears the form.

- [ ] Tests: the payload sent to `keys.create` field by field (recordingCommandClient); a server BAD_REQUEST shows inside the dialog; submit is disabled while pending (one command on double click); after success the reveal shows and Escape does not close it; after Done, the raw key string is absent from `document.body.textContent` AND absent from every query-store record (read `(queryStore as unknown as { records: Map<string, unknown> }).records` and `JSON.stringify` its values; comment that the test reaches into a private field on purpose because the store has no public listing); the navigation went to the new key's path; scopes narrow to the policy's allowed scopes. Commit `feat(plugin-keysmith): create keys from the list and show the key once`.

---

### Task 10: Rotate a key and close grace windows

**Files:** create `src/components/rotate-key-dialog.tsx`, `test/rotate-key-dialog.test.tsx`; modify `src/pages/key-detail.tsx` (Rotate action; End now beside each previous key), `test/key-detail.test.tsx`.

Behaviour:
- Rotate dialog: reason radio (Routine rotation = manual, Suspected compromise = compromise, Policy change = policy); grace as a number with a unit select (hours/days), preset from the key's policy `graceSeconds`, or 24 hours with "(default)" when null; picking "Suspected compromise" sets the grace to 0 and shows "The current key stops working the moment you rotate." The operator can still change it. Submit "Rotate key", disabled while pending.
- On success: `OneTimeKey` with children listing the windows from the response: each previous key `maskedKey` with "keeps working until <Timestamp>" and its own "End now"; with none: "Your previous key stopped working when you rotated." When a zero-grace rotation leaves an EARLIER window open, the list shows it (it is in `previousKeys`), with a line: "An earlier previous key is still accepted. End it now if it may also be compromised."
- End now (in the reveal and on the detail page): `ConfirmDialog` "Stop accepting <masked>?" description "Requests using it fail from now on. This cannot be undone." `pending` set; sends `keys.endGrace` (closes every window on the key; the copy says "Stop accepting every previous key?" when there is more than one).
- Rotate is offered only when `effectiveState` is active or suspended; otherwise the button is absent and the header says "A revoked or expired key cannot be rotated."

- [ ] Tests: payload with and without grace; compromise presets 0 and the warning; the earlier-window case renders the extra line; End now sends `keys.endGrace` once on double click; raw key gone after Done (DOM and store, as Task 9); Rotate absent on revoked and on expired-pending. Commit `feat(plugin-keysmith): rotate keys with an honest grace window`.

---

### Task 11: Revoke, suspend, reactivate, and scopes on the detail page

**Files:** create `src/components/key-actions.tsx`, `src/components/scopes-editor.tsx`, tests for each; modify `src/pages/key-detail.tsx`.

Behaviour:
- Revoke: `ConfirmDialog` title "Revoke <masked>?" description "Requests using this key fail from now on, and any open grace window ends with it. A revoked key cannot be brought back." A required reason textarea inside the dialog (`confirmDisabled` until non-empty); `pending`; errors inside the dialog; `reset()` when it opens.
- Suspend (offered when effectiveState is active): non-destructive ConfirmDialog "Suspend <masked>?" "Requests using it fail until you reactivate it. Open grace windows keep running." Reactivate (offered when suspended): direct button, no confirm.
- Expired-pending keys offer neither Suspend nor Rotate, with the expired explanation already on the page.
- Scopes editor: current scopes as tags each with a remove button (sends `keys.scopes.remove` with that one name; no confirm, since adding it back is one click); an "Add scope" select of tenant scopes not already assigned, narrowed to the policy's allowed scopes when non-empty, sending `keys.scopes.assign`. Errors inline. Hidden for revoked keys with "A revoked key's scopes cannot be changed."
- One `useCommand` per action; `reset()` on open.

- [ ] Tests: each payload; revoke needs a reason; double click sends once; each refusal message renders where the person can see it; action visibility per effective state (active, suspended, revoked, expired-pending). Commit `feat(plugin-keysmith): revoke, suspend, reactivate and edit scopes`.

---

### Task 12: Verify in the browser

Controller task. Start the fixture and shell; on the list create a key (check the reveal, copy, acknowledgement, Escape blocked, landing on the detail page); rotate it with the default grace (window shown), then with compromise (earlier window line shown), End now; suspend, reactivate, revoke; assign and remove a scope; confirm in the network panel that `rawKey` appears only in the create and rotate responses, and that no subsequent response carries it. Screenshots of the reveal and the rotated detail. Then the whole-branch review.
