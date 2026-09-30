# Keysmith contract spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the keysmith contract contributor with tenant resolution and the two key reads, the fixture that models them, and a `plugin-keysmith` package that shows the keys list and a key's detail in the shell.

**Architecture:** A new `extension/contract` package in keysmith declares `keys.list` and `keys.detail` in an embedded manifest and answers them from `*keysmith.Engine`, resolving the tenant Warden's way and checking it on every row. `Extension.RegisterContractContributor` wires it. In forge-dashboard, `keysmith-fixtures.mjs` answers the same two intents from seeded state across two tenants, and `packages/plugin-keysmith` reads them with kit components.

**Tech Stack:** Go 1.26, forge v1.10.0 `extensions/dashboard/contract` (+ `dispatcher`, `loader`), keysmith `internal/storetest`; React 19, TypeScript 6, vitest 5, `@forge-go/dashboard-plugin` and `@forge-go/dashboard-kit`; Node 20 fixture server.

**Spec:** `docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md`. Slice 2 of 6. Slice 1 (`2026-09-30-keysmith-domain-fixes.md`) is complete: keysmith main `55b057f..93bcaab`.

## Global Constraints

- Two repos. Go work in `/Users/rexraphael/Work/xraph/forgery/keysmith` (main). React and fixture work in `/Users/rexraphael/Work/xraph/forge-dashboard` (main). No worktrees. Other sessions work in both at once.
- Stage only your own paths: `git add <new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, a bare directory you did not create, `--amend`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean`, `git push`.
- In forge-dashboard you may edit ONLY: `packages/plugin-keysmith/**`, `packages/fixture-server/keysmith-fixtures.mjs`, keysmith's entries in `packages/fixture-server/server.mjs` and `verify.mjs`, and the keysmith lines in `apps/shell/package.json` and `apps/shell/src/App.tsx`, plus `pnpm-lock.yaml` only as `pnpm install` rewrites it for the new package. `apps/example-next` wires none of the migrated plugins (vault included), so keysmith is not added there.
- Commit messages: no `Co-Authored-By`, no Claude attribution, no em dashes; bodies in Rex's voice (plain, practical first, "we" not "I", varied sentence length, no bolded lead-ins).
- Go lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. Four-backend Go tests: `make test-backends`.
- React per package: `pnpm --filter @forge-go/dashboard-plugin-keysmith test`, `... typecheck`, `... lint`, and before the last commit `pnpm -r test` (`packages/host/test/setup-screen.test.tsx` fails for reasons unrelated to this work; say so, do not fix it).
- Contributor name and plugin `extension` are both exactly `keysmith`. Namespace `keysmith`. Label "API keys".
- Wire JSON is camelCase; timestamps are RFC3339 strings in UTC; durations are whole seconds with a `Seconds` suffix.
- No query response ever contains a raw key or a hash: none of `rawKey`, `raw_key`, `keyHash`, `key_hash` as a field, and never the value of a raw key.
- Identifier-shaped values (key IDs, the masked key `sk_live_…a3f8`, prefixes, scope names) render `font-mono text-xs`. The column an operator reads is `font-medium`. Every table caption carries a live count, including zero. An absent value uses `NoneCell`/`TagList`/`Timestamp`, never a blank.

## Review Focus

1. A key whose `expires_at` has passed but whose stored state is still `active` (expiry is marked lazily): the list and detail must show it as expired, with the stored state still visible. Task 2 pins it in Go, Task 4 in the fixture, Task 6 in the page.
2. A key ID from another tenant passed to `keys.detail`: must answer `NOT_FOUND` with the same message as a key that does not exist, so the dashboard never confirms another tenant's IDs. Task 2 pins it.
3. A `tenant_id` claim that is present but empty or not a string: must refuse, never fall back to the default tenant. Task 1 pins it.
4. A rotation window opened by a pre-fix record (empty old hint) or already closed: must not appear in the detail's "previous keys". Task 2 pins it.
5. A key with no policy, no scopes, no expiry and never used: every one of those cells renders an explicit "none" state the screen reader can read. Tasks 6 and 7 pin it.

---

## File Structure

keysmith:

| File | Responsibility |
|---|---|
| `extension/contract/tenant.go` | `requireUser`, `tenantFrom`, `appFrom` |
| `extension/contract/errors.go` | `mapError` and `Deps.mapError` (logs INTERNAL) |
| `extension/contract/contract.go` | `ContributorName`, `Deps`, `Register` |
| `extension/contract/manifest.yaml` | intents and cache hints |
| `extension/contract/project.go` | wire types and projections (`KeySummary`, `effectiveState`) |
| `extension/contract/handlers_keys.go` | `keys.list`, `keys.detail` |
| `extension/contract/*_test.go` | tests per file above |
| `extension/config.go`, `extension/options.go`, `extension/extension.go` | dashboard tenant config and `RegisterContractContributor` |

forge-dashboard:

| File | Responsibility |
|---|---|
| `packages/fixture-server/keysmith-fixtures.mjs` | seed, tenant rule, `keys.list`, `keys.detail` |
| `packages/plugin-keysmith/src/index.tsx` | `definePlugin`, routes, nav |
| `packages/plugin-keysmith/src/types.ts` | wire types mirroring Go |
| `packages/plugin-keysmith/src/format.ts` | `maskedKey`, `keyPath`, state labels |
| `packages/plugin-keysmith/src/badges.tsx` | `KeyStateBadge` and the mapping comment |
| `packages/plugin-keysmith/src/pages/keys.tsx` | keys list |
| `packages/plugin-keysmith/src/pages/key-detail.tsx` | key detail (read-only in this slice) |
| `packages/plugin-keysmith/test/*` | harness copy, tests |

---

### Task 1: Tenant resolution and error mapping

**Files:**
- Create: `extension/contract/tenant.go`, `extension/contract/tenant_test.go`
- Create: `extension/contract/errors.go`, `extension/contract/errors_test.go`
- Create: `extension/contract/contract.go` (only `ContributorName` and `Deps` in this task)

**Interfaces:**
- Produces:
  - `const ContributorName = "keysmith"`
  - `type Deps struct { Engine *keysmith.Engine; DefaultTenantID string; DefaultAppID string; Plugins []string; Logger forge.Logger }`
  - `func requireUser(p dashcontract.Principal) (string, error)`: the trimmed subject, or `UNAUTHENTICATED`.
  - `func tenantFrom(p dashcontract.Principal, deps Deps) (string, error)`
  - `func appFrom(p dashcontract.Principal, deps Deps) (string, error)`
  - `func mapError(err error) error` and `func (d Deps) mapError(intent string, err error) error`

- [ ] **Step 1: Write the failing tests**

`extension/contract/tenant_test.go`, package `contract`:

```go
func user(claims map[string]any) dashcontract.Principal {
	return dashcontract.Principal{User: &dashauth.UserInfo{Subject: "user_1"}, Claims: claims}
}

func codeOf(t *testing.T, err error) dashcontract.ErrorCode {
	t.Helper()
	var ce *dashcontract.Error
	require.ErrorAs(t, err, &ce)
	return ce.Code
}

func TestTenantFrom(t *testing.T) {
	withDefault := Deps{DefaultTenantID: "acme"}
	cases := []struct {
		name string
		p    dashcontract.Principal
		deps Deps
		want string
		code dashcontract.ErrorCode
	}{
		{"no user refuses even with a default", dashcontract.Principal{}, withDefault, "", dashcontract.CodeUnauthenticated},
		{"blank subject refuses", dashcontract.Principal{User: &dashauth.UserInfo{Subject: "  "}}, withDefault, "", dashcontract.CodeUnauthenticated},
		{"claim wins over default", user(map[string]any{"tenant_id": "globex"}), withDefault, "globex", ""},
		{"empty claim refuses, never defaults", user(map[string]any{"tenant_id": ""}), withDefault, "", dashcontract.CodePermissionDenied},
		{"wrong-typed claim refuses", user(map[string]any{"tenant_id": 42}), withDefault, "", dashcontract.CodePermissionDenied},
		{"nil claim refuses", user(map[string]any{"tenant_id": nil}), withDefault, "", dashcontract.CodePermissionDenied},
		{"absent claim takes the default", user(nil), withDefault, "acme", ""},
		{"absent claim and no default refuses", user(nil), Deps{}, "", dashcontract.CodePermissionDenied},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tenantFrom(tc.p, tc.deps)
			if tc.code != "" {
				assert.Equal(t, tc.code, codeOf(t, err))
				assert.Empty(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestAppFromMayBeEmptyButNeverWrong(t *testing.T) {
	got, err := appFrom(user(nil), Deps{})
	require.NoError(t, err)
	assert.Empty(t, got)
	got, err = appFrom(user(nil), Deps{DefaultAppID: "app_1"})
	require.NoError(t, err)
	assert.Equal(t, "app_1", got)
	got, err = appFrom(user(map[string]any{"app_id": "app_2"}), Deps{DefaultAppID: "app_1"})
	require.NoError(t, err)
	assert.Equal(t, "app_2", got)
	_, err = appFrom(user(map[string]any{"app_id": 7}), Deps{DefaultAppID: "app_1"})
	assert.Equal(t, dashcontract.CodePermissionDenied, codeOf(t, err))
}
```

`extension/contract/errors_test.go`:

```go
func TestMapError(t *testing.T) {
	cases := []struct {
		err  error
		code dashcontract.ErrorCode
	}{
		{fmt.Errorf("get key: %w", keysmith.ErrKeyNotFound), dashcontract.CodeNotFound},
		{keysmith.ErrPolicyNotFound, dashcontract.CodeNotFound},
		{keysmith.ErrRotationNotFound, dashcontract.CodeNotFound},
		{fmt.Errorf(`scope "x": %w`, keysmith.ErrScopeNotFound), dashcontract.CodeBadRequest},
		{keysmith.ErrScopeNotAllowed, dashcontract.CodeBadRequest},
		{keysmith.ErrKeyLifetimeExceeded, dashcontract.CodeBadRequest},
		{usage.ErrInvalidPeriod, dashcontract.CodeBadRequest},
		{keysmith.ErrInvalidStateTransition, dashcontract.CodeConflict},
		{keysmith.ErrPolicyInUse, dashcontract.CodeConflict},
		{errors.New("pq: connection refused to 10.0.0.5"), dashcontract.CodeInternal},
	}
	for _, tc := range cases {
		mapped := mapError(tc.err)
		assert.Equal(t, tc.code, codeOf(t, mapped), tc.err.Error())
	}
	var ce *dashcontract.Error
	require.ErrorAs(t, mapError(errors.New("pq: connection refused to 10.0.0.5")), &ce)
	assert.NotContains(t, ce.Message, "10.0.0.5", "an internal error's text must not reach the client")
	assert.Nil(t, mapError(nil))
}
```

Run: `go test ./extension/contract/ -v`. Expected: compile failure (package empty).

- [ ] **Step 2: Implement**

`contract.go` (this task: doc comment, `ContributorName`, `Deps` with a doc comment per field; `DefaultTenantID` says leaving it empty makes every read refuse, which is correct for a multi-tenant deployment with no tenant claim, and that the empty string would match every tenant's rows).

`tenant.go`: copy the shape and the comment weight of `forgery/warden/extension/contract/errors.go` `tenantFrom` (read it; do not edit warden). Order: `requireUser` first, then the `tenant_id` claim (present and a non-empty string wins; present and anything else refuses with `PERMISSION_DENIED` and a message saying a present-but-unusable claim is refused rather than replaced by another tenant), then `DefaultTenantID`, then refuse with `PERMISSION_DENIED`: "no tenant in scope: keysmith cannot tell which tenant this request is for. Set extensions.keysmith.dashboard.tenant_id for a single-tenant deployment." `appFrom`: `app_id` claim, same present-but-unusable refusal, else `DefaultAppID` (may be empty: keysmith never filters by app, so app only labels new rows). `requireUser` trims the subject and refuses blank with `UNAUTHENTICATED` "keysmith: authentication required".

`errors.go`: `mapError` with the table the test asserts, each `CodeBadRequest` case returning `err.Error()` as the message (these errors carry only caller-supplied names), `NOT_FOUND` messages "key not found", "policy not found", "rotation not found", `CONFLICT` returning `err.Error()`, and the default `CodeInternal` "an internal error occurred". `Deps.mapError` logs the underlying error at Error level with the intent when the result is `CodeInternal` and `Logger` is set, like vault's.

- [ ] **Step 3: Run tests, lint, commit**

Run: `go test ./extension/contract/ -v`, lint. Expected: PASS, 0 issues.

```bash
git add extension/contract/tenant.go extension/contract/tenant_test.go extension/contract/errors.go extension/contract/errors_test.go extension/contract/contract.go
git commit --only -m "feat(contract): resolve the dashboard tenant and map engine errors" -- extension/contract/tenant.go extension/contract/tenant_test.go extension/contract/errors.go extension/contract/errors_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 2: keys.list and keys.detail

**Files:**
- Create: `extension/contract/manifest.yaml`, `extension/contract/project.go`, `extension/contract/handlers_keys.go`
- Create: `extension/contract/project_test.go`, `extension/contract/handlers_keys_test.go`, `extension/contract/contract_test.go`
- Modify: `extension/contract/contract.go` (add `Register`)

**Interfaces:**
- Consumes: Task 1's `Deps`, `tenantFrom`, `mapError`.
- Produces (wire, used verbatim by Tasks 4 to 7):

```go
type KeySummary struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Description    string   `json:"description,omitempty"`
	Prefix         string   `json:"prefix"`
	Hint           string   `json:"hint"`
	Environment    string   `json:"environment"`
	State          string   `json:"state"`          // as stored
	EffectiveState string   `json:"effectiveState"` // what the page shows
	ExpiryPending  bool     `json:"expiryPending"`  // expired, not yet marked
	ExpiresSoon    bool     `json:"expiresSoon"`    // active, expires within 7 days
	PolicyID       string   `json:"policyId,omitempty"`
	Scopes         []string `json:"scopes"`
	CreatedBy      string   `json:"createdBy,omitempty"`
	ExpiresAt      string   `json:"expiresAt,omitempty"`
	LastUsedAt     string   `json:"lastUsedAt,omitempty"`
	RotatedAt      string   `json:"rotatedAt,omitempty"`
	RevokedAt      string   `json:"revokedAt,omitempty"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type PolicyRef struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	MaxKeyLifetimeSeconds int64  `json:"maxKeyLifetimeSeconds"`
	GraceSeconds          int64  `json:"graceSeconds"`
}

type PreviousKey struct {
	RotationID string `json:"rotationId"`
	Hint       string `json:"hint"`
	Reason     string `json:"reason"`
	RotatedAt  string `json:"rotatedAt"`
	GraceEnds  string `json:"graceEnds"`
}

type keysListRequest struct {
	Environment string `json:"environment"`
	State       string `json:"state"`
	PolicyID    string `json:"policyId"`
	Limit       int    `json:"limit"`
	Offset      int    `json:"offset"`
}
type keysListResponse struct {
	Keys  []KeySummary `json:"keys"`
	Total int64        `json:"total"`
}
type keysDetailRequest struct {
	ID string `json:"id"`
}
type keysDetailResponse struct {
	Key          KeySummary     `json:"key"`
	Policy       *PolicyRef     `json:"policy"` // explicit null when none
	Metadata     map[string]any `json:"metadata"`
	PreviousKeys []PreviousKey  `json:"previousKeys"`
}
```

- `func effectiveState(k *key.Key, now time.Time) (state string, pending bool)`: `RevokedAt != nil` gives `"revoked", false`; stored `active` with `ExpiresAt` at or before `now` gives `"expired", true`; otherwise the stored state, false.
- `func projectKey(k *key.Key, scopes []string, now time.Time) KeySummary`. `ExpiresSoon` is true only when the effective state is `active` and `ExpiresAt` is after `now` and within 7 days. `Scopes` is never nil (empty slice). Times via `t.UTC().Format(time.RFC3339)`.
- `func Register(d *dispatcher.Dispatcher, reg dashcontract.Registry, wreg dashcontract.WardenRegistry, deps Deps) error`

- [ ] **Step 1: Manifest**

```yaml
schemaVersion: 1
contributor:
  name: keysmith
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [keysmith.read, keysmith.write]

# No app block and no graph: the React plugin owns routes. Every intent is
# answered for the tenant tenantFrom resolves; no request field names a
# tenant, and no response ever carries a raw key or a key hash.
intents:
  - { name: keys.list,   kind: query, version: 1, capability: read }
  - { name: keys.detail, kind: query, version: 1, capability: read }

queries:
  keysList:
    intent: keys.list
    cache: { staleTime: 30s }
  keyDetail:
    intent: keys.detail
    cache: { staleTime: 30s }
```

Check the exact schema against `forgery/vault/extension/contract/manifest.yaml` and `loader.Validate`; if `loader.Validate` rejects anything here, match vault's form and say so.

- [ ] **Step 2: Write the failing tests**

`project_test.go`:

```go
func TestEffectiveState(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	past, future := now.Add(-time.Minute), now.Add(time.Hour)
	revokedAt := now.Add(-time.Hour)
	cases := []struct {
		name    string
		k       key.Key
		state   string
		pending bool
	}{
		{"active", key.Key{State: key.StateActive, ExpiresAt: &future}, "active", false},
		{"active past expiry is expired, pending", key.Key{State: key.StateActive, ExpiresAt: &past}, "expired", true},
		{"expiry exactly now is expired", key.Key{State: key.StateActive, ExpiresAt: &now}, "expired", true},
		{"stored expired", key.Key{State: key.StateExpired, ExpiresAt: &past}, "expired", false},
		{"suspended past expiry stays suspended", key.Key{State: key.StateSuspended, ExpiresAt: &past}, "suspended", false},
		{"revoked_at wins over a stale active state", key.Key{State: key.StateActive, RevokedAt: &revokedAt}, "revoked", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, p := effectiveState(&tc.k, now)
			assert.Equal(t, tc.state, s)
			assert.Equal(t, tc.pending, p)
		})
	}
}

func TestExpiresSoonOnlyForActiveWithinSevenDays(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	in3d, in8d := now.Add(72*time.Hour), now.Add(8*24*time.Hour)
	assert.True(t, projectKey(&key.Key{State: key.StateActive, ExpiresAt: &in3d}, nil, now).ExpiresSoon)
	assert.False(t, projectKey(&key.Key{State: key.StateActive, ExpiresAt: &in8d}, nil, now).ExpiresSoon)
	assert.False(t, projectKey(&key.Key{State: key.StateSuspended, ExpiresAt: &in3d}, nil, now).ExpiresSoon)
	assert.NotNil(t, projectKey(&key.Key{State: key.StateActive}, nil, now).Scopes)
}
```

`handlers_keys_test.go` (package `contract`), using `storetest.Each` from `github.com/xraph/keysmith/internal/storetest`:

```go
func principal() dashcontract.Principal {
	return dashcontract.Principal{User: &dashauth.UserInfo{Subject: "user_1"}}
}

func setup(t *testing.T, s store.Store) (Deps, *keysmith.Engine) {
	t.Helper()
	eng, err := keysmith.NewEngine(keysmith.WithStore(s))
	require.NoError(t, err)
	return Deps{Engine: eng, DefaultTenantID: "t1"}, eng
}

func tctx(tenant string) context.Context { return keysmith.WithTenant(context.Background(), "app", tenant) }

func create(t *testing.T, eng *keysmith.Engine, tenant string, in *keysmith.CreateKeyInput) *key.CreateResult {
	t.Helper()
	if in == nil {
		in = &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive}
	}
	r, err := eng.CreateKey(tctx(tenant), in)
	require.NoError(t, err)
	return r
}

func TestKeysListIsTenantScopedByID(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		deps, eng := setup(t, s)
		a := create(t, eng, "t1", nil)
		b := create(t, eng, "t1", &keysmith.CreateKeyInput{Name: "k2", Prefix: "sk", Environment: key.EnvTest})
		create(t, eng, "t2", nil)
		out, err := keysListHandler(deps)(context.Background(), keysListRequest{}, principal())
		require.NoError(t, err)
		ids := []string{}
		for _, k := range out.Keys {
			ids = append(ids, k.ID)
		}
		assert.ElementsMatch(t, []string{a.Key.ID.String(), b.Key.ID.String()}, ids)
		assert.EqualValues(t, 2, out.Total)
	})
}

func TestKeysListFiltersAndPages(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		deps, eng := setup(t, s)
		for i := 0; i < 3; i++ {
			create(t, eng, "t1", nil)
		}
		test := create(t, eng, "t1", &keysmith.CreateKeyInput{Name: "t", Prefix: "sk", Environment: key.EnvTest})
		out, err := keysListHandler(deps)(context.Background(), keysListRequest{Environment: "test"}, principal())
		require.NoError(t, err)
		require.Len(t, out.Keys, 1)
		assert.Equal(t, test.Key.ID.String(), out.Keys[0].ID)
		assert.EqualValues(t, 1, out.Total)

		page, err := keysListHandler(deps)(context.Background(), keysListRequest{Limit: 2, Offset: 2}, principal())
		require.NoError(t, err)
		assert.Len(t, page.Keys, 2)
		assert.EqualValues(t, 4, page.Total, "total counts the filter, not the page")

		_, err = keysListHandler(deps)(context.Background(), keysListRequest{Environment: "prod"}, principal())
		assert.Equal(t, dashcontract.CodeBadRequest, codeOf(t, err))
		_, err = keysListHandler(deps)(context.Background(), keysListRequest{State: "rotated"}, principal())
		assert.Equal(t, dashcontract.CodeBadRequest, codeOf(t, err))
	})
}

func TestKeysListRefusesWithoutATenant(t *testing.T) {
	deps, _ := setup(t, memory.New())
	deps.DefaultTenantID = ""
	_, err := keysListHandler(deps)(context.Background(), keysListRequest{}, principal())
	assert.Equal(t, dashcontract.CodePermissionDenied, codeOf(t, err))
	_, err = keysListHandler(Deps{Engine: deps.Engine, DefaultTenantID: "t1"})(context.Background(), keysListRequest{}, dashcontract.Principal{})
	assert.Equal(t, dashcontract.CodeUnauthenticated, codeOf(t, err))
}

func TestKeyDetailHidesOtherTenantsKeys(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		deps, eng := setup(t, s)
		theirs := create(t, eng, "t2", nil)
		_, errTheirs := keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: theirs.Key.ID.String()}, principal())
		_, errMissing := keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: id.NewKeyID().String()}, principal())
		assert.Equal(t, dashcontract.CodeNotFound, codeOf(t, errTheirs))
		assert.Equal(t, errMissing.Error(), errTheirs.Error(), "another tenant's key must read exactly like a missing one")
		_, err := keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: "not-a-key"}, principal())
		assert.Equal(t, dashcontract.CodeBadRequest, codeOf(t, err))
		_, err = keysDetailHandler(deps)(context.Background(), keysDetailRequest{}, principal())
		assert.Equal(t, dashcontract.CodeBadRequest, codeOf(t, err))
	})
}

func TestKeyDetailShowsOpenWindowsOnly(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		deps, eng := setup(t, s)
		orig := create(t, eng, "t1", nil)
		_, err := eng.RotateKey(tctx("t1"), orig.Key.ID, rotation.ReasonManual, keysmith.WithGrace(time.Hour))
		require.NoError(t, err)
		// A pre-fix record: no hint, window in the future. Must not show.
		require.NoError(t, s.Rotations().Create(context.Background(), &rotation.Record{
			ID: id.NewRotationID(), KeyID: orig.Key.ID, TenantID: "t1", OldKeyHash: "legacy", NewKeyHash: "x",
			Reason: rotation.ReasonManual, GraceTTL: time.Hour, GraceEnds: time.Now().Add(time.Hour), CreatedAt: time.Now(),
		}))
		out, err := keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: orig.Key.ID.String()}, principal())
		require.NoError(t, err)
		require.Len(t, out.PreviousKeys, 1)
		assert.Equal(t, orig.RawKey[len(orig.RawKey)-4:], out.PreviousKeys[0].Hint)
		assert.Nil(t, out.Policy)

		_, err = eng.EndGrace(tctx("t1"), orig.Key.ID)
		require.NoError(t, err)
		out, err = keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: orig.Key.ID.String()}, principal())
		require.NoError(t, err)
		assert.Empty(t, out.PreviousKeys)
	})
}

func TestKeyDetailCarriesScopesPolicyAndPendingExpiry(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		deps, eng := setup(t, s)
		require.NoError(t, eng.CreateScope(tctx("t1"), &scope.Scope{Name: "read"}))
		pol := &policy.Policy{Name: "p", GracePeriod: 2 * time.Hour, MaxKeyLifetime: 720 * time.Hour}
		require.NoError(t, eng.CreatePolicy(tctx("t1"), pol))
		k := create(t, eng, "t1", &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive, PolicyID: &pol.ID, Scopes: []string{"read"}})
		out, err := keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: k.Key.ID.String()}, principal())
		require.NoError(t, err)
		assert.Equal(t, []string{"read"}, out.Key.Scopes)
		require.NotNil(t, out.Policy)
		assert.EqualValues(t, 7200, out.Policy.GraceSeconds)
		assert.EqualValues(t, 720*3600, out.Policy.MaxKeyLifetimeSeconds)

		past := time.Now().Add(-time.Minute)
		old := create(t, eng, "t1", &keysmith.CreateKeyInput{Name: "old", Prefix: "sk", Environment: key.EnvLive, ExpiresAt: &past})
		out, err = keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: old.Key.ID.String()}, principal())
		require.NoError(t, err)
		assert.Equal(t, "active", out.Key.State)
		assert.Equal(t, "expired", out.Key.EffectiveState)
		assert.True(t, out.Key.ExpiryPending)
	})
}

func TestNoQueryResponseCarriesASecret(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		deps, eng := setup(t, s)
		r := create(t, eng, "t1", nil)
		list, err := keysListHandler(deps)(context.Background(), keysListRequest{}, principal())
		require.NoError(t, err)
		detail, err := keysDetailHandler(deps)(context.Background(), keysDetailRequest{ID: r.Key.ID.String()}, principal())
		require.NoError(t, err)
		for _, v := range []any{list, detail} {
			b, err := json.Marshal(v)
			require.NoError(t, err)
			body := string(b)
			for _, banned := range []string{"rawKey", "raw_key", "keyHash", "key_hash", r.RawKey, r.Key.KeyHash} {
				assert.NotContains(t, body, banned)
			}
		}
	})
}
```

`contract_test.go`: `TestRegister_NilEngineErrors` and `TestEveryDeclaredIntentIsRegistered`, copied in shape from `forgery/vault/extension/contract/contract_test.go` (Deps with a memory engine and `DefaultTenantID: "t1"`).

Run: `go test ./extension/contract/ -v`. Expected: compile failure on the handlers.

- [ ] **Step 3: Implement**

`project.go`: the wire types above, `effectiveState`, `projectKey`, `projectPolicyRef(p *policy.Policy) PolicyRef` (durations as `int64(d / time.Second)`), `rfc3339(t time.Time) string`, `rfc3339Ptr(*time.Time) string` (empty for nil, so `omitempty` drops it).

`handlers_keys.go`:
- Paging: `defaultListLimit = 25`, `maxListLimit = 100`, `limit <= 0` gets the default, over the cap is capped, `offset < 0` is 0.
- `keysListHandler(deps)`: `tenantFrom` first. Validate `environment` in `"", live, test, staging` and `state` in `"", active, suspended, revoked, expired` (the engine never assigns `rotated`), else `BAD_REQUEST` naming the field and the allowed values. Parse `policyId` with `id.ParsePolicyID` when set, else `BAD_REQUEST`. Build one `key.ListFilter{TenantID: tenant, ...}` and use it for both `deps.Engine.ListKeys` and `deps.Engine.Store().Keys().Count`. For each key, `deps.Engine.Store().Scopes().ListByKey` (key reads never load scopes on any backend) and project with `time.Now()`. Comment the per-row scope read as bounded by the page cap.
- `keysDetailHandler(deps)`: `tenantFrom`; `id` required (`BAD_REQUEST` "id is required") and parsed with `id.ParseKeyID` (`BAD_REQUEST` "id is not a key id"); `GetKey`; if the error maps to not-found, or `k.TenantID != tenant`, return exactly `&dashcontract.Error{Code: CodeNotFound, Message: "key not found"}` in both cases. Scopes as above. Policy: when `PolicyID` is set, `GetPolicy`; not-found, or a policy whose `TenantID` differs from the key's tenant, gives `Policy: nil` (a policy from another tenant is never shown); any other error maps through `deps.mapError`. Previous keys: `ListRotations(&rotation.ListFilter{KeyID: &k.ID, Limit: 100})`, keep records with `OldHint != ""` and `GraceEnds.After(now)`, sort by `GraceEnds` ascending. `Metadata` is `k.Metadata` or an empty map, never nil.
- Every error from the engine goes through `deps.mapError("<intent>", err)`.

`contract.go` `Register`: nil `Engine` errors; load, validate and register the embedded manifest (`//go:embed manifest.yaml`) as vault does; bind `keys.list` and `keys.detail` with `dispatcher.RegisterQuery`.

- [ ] **Step 4: Run and commit**

Run: `go test ./extension/contract/ -v`, `make test-backends`, lint. Expected: PASS on all four backends.

```bash
git add extension/contract/manifest.yaml extension/contract/project.go extension/contract/handlers_keys.go extension/contract/project_test.go extension/contract/handlers_keys_test.go extension/contract/contract_test.go
git commit --only -m "feat(contract): answer keys.list and keys.detail for the resolved tenant" -- extension/contract/manifest.yaml extension/contract/project.go extension/contract/handlers_keys.go extension/contract/project_test.go extension/contract/handlers_keys_test.go extension/contract/contract_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 3: Wire the contributor into the extension

**Files:**
- Modify: `extension/config.go`, `extension/options.go`, `extension/extension.go`
- Create: `extension/contract_contributor_test.go`

**Interfaces:**
- Produces:
  - `extension.Config.Dashboard DashboardConfig` with `DashboardConfig{ TenantID string; AppID string }`, tags `json:"tenant_id" mapstructure:"tenant_id" yaml:"tenant_id"` and the `app_id` equivalents, and the parent field tagged `json:"dashboard" mapstructure:"dashboard" yaml:"dashboard"`.
  - `func WithDashboardTenant(tenantID, appID string) ExtOption`
  - `func (e *Extension) RegisterContractContributor(disp *dispatcher.Dispatcher, reg dashcontract.Registry, wreg dashcontract.WardenRegistry) error`

- [ ] **Step 1: Write the failing test**

`extension/contract_contributor_test.go`, package `extension`:

```go
// The interface assertion lives in a test file on purpose: importing the
// root dashboard package from production code pulls templ into every
// consumer of the extension (forge's dashboard/contract -> dashboard/auth ->
// templ chain is already there; the root package adds the rest).
var _ dashboard.ContractContributorAware = (*Extension)(nil)

func TestRegisterContractContributor(t *testing.T) {
	eng, err := keysmith.NewEngine(keysmith.WithStore(memory.New()))
	require.NoError(t, err)
	e := New(WithDashboardTenant("acme", "app_1"))
	e.eng = eng
	e.config.Dashboard = DashboardConfig{TenantID: "acme", AppID: "app_1"}
	require.NoError(t, e.RegisterContractContributor(dispatcher.New(nil), dashcontract.NewRegistry(), dashcontract.NewWardenRegistry()))
}

func TestRegisterContractContributorSkipsQuietlyWithoutAnEngine(t *testing.T) {
	e := New()
	assert.NoError(t, e.RegisterContractContributor(dispatcher.New(nil), dashcontract.NewRegistry(), dashcontract.NewWardenRegistry()))
}

func TestDashboardTenantMergesFromOptionsWhenYAMLIsSilent(t *testing.T) {
	e := New(WithDashboardTenant("acme", "app_1"))
	merged := e.mergeConfigurations(Config{}, e.config)
	assert.Equal(t, "acme", merged.Dashboard.TenantID)
	assert.Equal(t, "app_1", merged.Dashboard.AppID)
	fromYAML := e.mergeConfigurations(Config{Dashboard: DashboardConfig{TenantID: "yaml"}}, e.config)
	assert.Equal(t, "yaml", fromYAML.Dashboard.TenantID, "YAML wins for strings, as for base_path")
}
```

Check `New()` with no options and a nil logger does not panic in `RegisterContractContributor`'s skip path (the vault version guards `e.Logger()` being nil). Run: `go test ./extension/ -v`. Expected: compile failure.

- [ ] **Step 2: Implement**

- `config.go`: `DashboardConfig` with a doc comment: TenantID is the tenant every dashboard request is scoped to when the principal carries no tenant claim, which today is every request; leave it empty on a multi-tenant deployment and the dashboard refuses rather than guessing.
- `options.go`: `WithDashboardTenant`.
- `extension.go` `mergeConfigurations`: YAML strings win; fill `Dashboard.TenantID` and `Dashboard.AppID` from programmatic when YAML's are empty.
- `RegisterContractContributor`: if `e.eng == nil`, log a warning when a logger exists and return nil (same as vault). Build `ksContract.Deps{Engine: e.eng, DefaultTenantID: e.config.Dashboard.TenantID, DefaultAppID: e.config.Dashboard.AppID, Plugins: names of e.exts, Logger: e.Logger() when non-nil}` and call `ksContract.Register`, wrapping its error. Leave `DashboardContributor()` (templ) in place; slice 6 removes it.
- The loaded config debug log adds `dashboard_tenant_id`.

- [ ] **Step 3: Run and commit**

Run: `go build ./... && go test ./... && make test-backends`, lint.

```bash
git add extension/contract_contributor_test.go
git commit --only -m "feat(extension): register the keysmith contract contributor" -- extension/config.go extension/options.go extension/extension.go extension/contract_contributor_test.go
git show --stat HEAD
```

---

### Task 4: Fixture for keys.list and keys.detail

**Files (forge-dashboard):**
- Create: `packages/fixture-server/keysmith-fixtures.mjs`
- Modify: `packages/fixture-server/server.mjs` (one import, one `CONTRIBUTORS` entry, one reset call), `packages/fixture-server/verify.mjs` (one `INPUT` entry)

**Interfaces:**
- Consumes: the Task 2 wire types and rules, verbatim.
- Produces: `createKeysmithHandlers(FixtureError)` returning `{ "keys.list": {kind:"query", handler}, "keys.detail": {kind:"query", handler} }`, `resetKeysmith()`, and exported `KEYSMITH_IDS` with the seed IDs the page tests and verify use.

- [ ] **Step 1: Write the module**

Header comment like `vault-fixtures.mjs`'s: mirrors `forgery/keysmith/extension/contract` (`tenant.go`, `project.go`, `handlers_keys.go`); field names are the Go JSON tags; every rule is the Go handler's rule in its order; it never stores or returns a raw key or a hash, only the hint.

Tenant rule: `const tenant = () => { const t = process.env.FIXTURE_KEYSMITH_TENANT ?? "acme"; if (t === "") throw new FixtureError(403, "PERMISSION_DENIED", "no tenant in scope: keysmith cannot tell which tenant this request is for. Set extensions.keysmith.dashboard.tenant_id for a single-tenant deployment."); return t }`. The fixture has no principal, so the env var stands in for `DefaultTenantID`; write that in a comment.

Seed (times relative to module load, recomputed by `resetKeysmith`), all in tenant `acme` unless noted, IDs in keysmith's TypeID shape (`akey_` + 26 lowercase base32 characters, `kpol_`, `krot_`):
1. "Billing service", `sk`, live, active, policy "Standard" (grace 24h = 86400, max lifetime 90d = 7776000), scopes `["billing:read","billing:write"]`, used 12 minutes ago, created 40 days ago, with ONE open previous window (rotation 2h ago, reason manual, old hint `7c1e`, grace ends in 22h) and one closed rotation (30 days ago, grace ended).
2. "Reporting export", `sk`, test, active, expires in 3 days (`expiresSoon`), no policy, scopes `["reports:read"]`, never used.
3. "Legacy webhook signer", `whk`, live, stored `active` but `expiresAt` 2 days ago (effective `expired`, `expiryPending: true`), no scopes.
4. "Partner sandbox", `pk`, staging, suspended, policy "Standard".
5. "Old mobile app", `sk`, live, revoked 10 days ago, `revokedAt` set.
6. Tenant `globex`: "Globex internal", `sk`, live, active. Must never appear for `acme`.

Handlers mirror Task 2 exactly: validation messages, paging (default 25, cap 100), `total` counting the filter, NOT_FOUND "key not found" for a missing id AND for another tenant's id, BAD_REQUEST "id is required" / "id is not a key id" (a string not starting `akey_`), effective state and `expiresSoon` computed at request time with the same rules, `previousKeys` only for windows with a hint and `graceEnds` in the future, `policy: null` when none, `metadata: {}` when none, `scopes: []` when none.

- [ ] **Step 2: Register it**

`server.mjs`: `import { createKeysmithHandlers, resetKeysmith } from "./keysmith-fixtures.mjs"`, add `{ name: "keysmith", envPrefix: "KEYSMITH", handlers: createKeysmithHandlers(FixtureError) }` to `CONTRIBUTORS` after chronicle, and `resetKeysmith()` in the reset handler after `resetChronicle()`. `verify.mjs`: `"keysmith::keys.detail": { id: <seed key 1 id> }` with a one-line comment.

- [ ] **Step 3: Exercise it over HTTP**

Start it (`FIXTURE_PORT=8099 node packages/fixture-server/server.mjs` in the background, or the `fixture-server` preview entry), then:

```bash
node packages/fixture-server/verify.mjs http://localhost:8099
```

Expected: every intent answers, keysmith's two included. Also check by hand with curl against the envelope endpoint (copy the request shape verify.mjs sends): `keys.list` returns 5 keys, total 5, no `globex` key; `keys.list {state:"suspended"}` returns 1; `keys.detail` on the globex id returns 404 NOT_FOUND "key not found"; with `FIXTURE_KEYSMITH_TENANT=` (empty) `keys.list` returns 403 PERMISSION_DENIED. Paste the outputs into the report. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add packages/fixture-server/keysmith-fixtures.mjs
git commit --only -m "feat(fixture): answer keysmith keys.list and keys.detail across two tenants" -- packages/fixture-server/keysmith-fixtures.mjs packages/fixture-server/server.mjs packages/fixture-server/verify.mjs
git show --stat HEAD
```

`server.mjs` and `verify.mjs` carry uncommitted edits from other sessions. `git commit --only` commits the WHOLE file, including their lines. Before committing, run `git diff packages/fixture-server/server.mjs packages/fixture-server/verify.mjs`: if anything other than your keysmith lines appears, do NOT commit those two files; commit `keysmith-fixtures.mjs` alone, leave your edits to the two shared files in the working tree, and say so in the report so the controller can decide.

---

### Task 5: plugin-keysmith package, types, formatting and badges

**Files (forge-dashboard):**
- Create: `packages/plugin-keysmith/{package.json,tsconfig.json,vitest.config.ts,eslint.config.js}` (copy plugin-vault's, name `@forge-go/dashboard-plugin-keysmith`, no dependencies beyond the peer and dev deps plugin-vault lists minus CodeMirror and dnd-kit)
- Create: `src/index.tsx`, `src/types.ts`, `src/format.ts`, `src/badges.tsx`
- Create: `test/harness.tsx` (copy of plugin-vault's with `extension: "keysmith"`), `test/plugin.test.tsx`, `test/format.test.ts`, `test/badges.test.tsx`

**Interfaces:**
- Consumes: Task 2 wire types.
- Produces:
  - `src/types.ts`: `KeySummary`, `PolicyRef`, `PreviousKey`, `KeysList` (`{ keys: KeySummary[]; total: number }`), `KeyDetail` (`{ key: KeySummary; policy: PolicyRef | null; metadata: Record<string, unknown>; previousKeys: PreviousKey[] }`), `KeyState = "active" | "suspended" | "revoked" | "expired"`, `Environment = "live" | "test" | "staging"`. Optional Go `omitempty` fields are optional (`?`) in TS.
  - `src/format.ts`: `maskedKey(k: { prefix: string; environment: string; hint: string }): string` returning `` `${prefix}_${environment}_…${hint}` `` (U+2026 ellipsis); `keyPath(id: string): string` returning `` `/keys/${encodeURIComponent(id)}` ``; `STATE_LABEL: Record<KeyState, string>`; `ENVIRONMENTS`, `STATES` option arrays for filters.
  - `src/badges.tsx`: `KeyStateBadge({ summary }: { summary: KeySummary })`.

- [ ] **Step 1: Write the failing tests**

`test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { keyPath, maskedKey } from "../src/format"

describe("maskedKey", () => {
  it("shows prefix and environment, then only the hint", () => {
    expect(maskedKey({ prefix: "sk", environment: "live", hint: "a3f8" })).toBe("sk_live_…a3f8")
  })
})

describe("keyPath", () => {
  it("encodes the id", () => {
    expect(keyPath("akey_01j8zq3k4m5n6p7q8r9s0t1v2w")).toBe("/keys/akey_01j8zq3k4m5n6p7q8r9s0t1v2w")
    expect(keyPath("a/b")).toBe("/keys/a%2Fb")
  })
})
```

`test/badges.test.tsx`: renders `KeyStateBadge` for each case and asserts the text and the variant class hook (`data-variant` if kit's Badge sets it, else the class name kit uses; read kit's badge.tsx):
- active, not expiring: text "Active", variant outline
- active, `expiresSoon`: text "Expires soon", variant destructive
- effective `expired` with `expiryPending`: text "Expired", variant secondary, plus an accessible note "not yet marked; Keysmith marks expiry when the key is next used" (visually a small muted line or `title`, but reachable by a screen reader: use visible text in the badge's accessible name, e.g. `aria-label="Expired, not yet marked"` is not enough on its own; render the note as sr-only text inside)
- suspended: "Suspended", default
- revoked: "Revoked", secondary

`test/plugin.test.tsx`: copy plugin-vault's structure: default and named export are the same; resolves `ready` against capabilities naming `keysmith`; `hidden` when only `vault` is named; routes include `/keys` and `/keys/:id`; nav has "Keys" at `/keys` in group "API keys".

Run: `pnpm --filter @forge-go/dashboard-plugin-keysmith test` (after `pnpm install` picks up the new package). Expected: failures on missing modules.

- [ ] **Step 2: Implement**

`badges.tsx` starts with the mapping comment, written as the spec's Badges section says: whatever holds most rows (active) is outline; suspended is default because it is temporarily off and worth a second look; expired and revoked are secondary, finished history; expiring within 7 days is destructive, the thing someone scans a key list to find. Then the component.

`index.tsx`: `definePlugin({ extension: "keysmith", namespace: "keysmith", label: "API keys", nav: [{ label: "Keys", to: "/keys", priority: 0, icon: <KeyRoundIcon />, group: "API keys" }], routes: [{ path: "/keys", element: KeysPage }, { path: "/keys/:id", element: KeyDetailPage }] })` with a doc comment on the join key like vault's. Until Tasks 6 and 7 land, the two pages are one-line placeholders in `src/pages/keys.tsx` and `src/pages/key-detail.tsx` exporting `KeysPage` and `KeyDetailPage` that render a `PageHeader` only; Tasks 6 and 7 replace them.

- [ ] **Step 3: Run and commit**

Run: test, typecheck, lint for the package. Expected: all clean.

```bash
git add packages/plugin-keysmith
git commit --only -m "feat(plugin-keysmith): scaffold the plugin with key formatting and state badges" -- packages/plugin-keysmith pnpm-lock.yaml
git show --stat HEAD
```

`packages/plugin-keysmith` is a directory this task creates, so adding it whole is allowed. Include `pnpm-lock.yaml` only if `pnpm install` changed it solely for this package; check with `git diff pnpm-lock.yaml` and leave it out (and say so) if it carries other sessions' changes.

---

### Task 6: Keys list page

**Files:**
- Modify: `packages/plugin-keysmith/src/pages/keys.tsx`
- Create: `packages/plugin-keysmith/test/keys.test.tsx`

**Interfaces:**
- Consumes: `KeysList`, `KeySummary`, `maskedKey`, `keyPath`, `KeyStateBadge`, `ENVIRONMENTS`, `STATES`.

- [ ] **Step 1: Write the failing tests** (`renderPage` from the harness, `stubClient`/`recordingQueryClient`)

Use a fixture list mirroring Task 4's seed (five `acme` keys). Assert:
1. The caption reads "5 keys" (server total), and "0 keys" for an empty list, with the empty message "No API keys yet." (creation arrives in slice 3; no action button yet).
2. Name cells link to `keyPath(id)` and carry `font-medium`; the Key column shows `sk_live_…a3f8` in an element with `font-mono` and `text-xs`.
3. Absent values are explicit, found by accessible name (kit's `NoneCell` renders an en dash with `aria-label` "no <label>", and `TagList`/`Timestamp` fall through to it): the key with no policy has an element labelled "no policy"; the key with no scopes, "no scopes"; the never-used key, "no recorded use"; the key with no expiry, "no expiry".
4. The expired-but-pending key shows "Expired" and still shows its stored state somewhere in the row (for example the badge's sr-only note).
5. Choosing Environment "Test" in the FilterBar sends `keys.list` with `environment: "test"` and `offset: 0` (recordingQueryClient); choosing State "Suspended" sends `state: "suspended"`; paging to page 2 sends `offset: 25`. Changing a filter resets to page 1.
6. A failing client renders QueryBoundary's error state with the error message.

- [ ] **Step 2: Implement**

`PageHeader` title "API keys", description "Keys are shown by prefix and last four characters. The full value is only ever shown once, when a key is created or rotated." Columns: Name (`font-medium`, `PluginLink` to `keyPath`), Key (`maskedKey`, `font-mono text-xs`), Environment (plain text), State (`KeyStateBadge`), Policy (`policyId` in `font-mono text-xs` or `NoneCell` label "policy"; the policy name arrives in slice 4), Scopes (`TagList` label "scopes", mono), Last used (`Timestamp` label "recorded use"), Expires (`Timestamp` label "expiry"). FilterBar with Environment (All, Live, Test, Staging) and State (All, Active, Suspended, Revoked, Expired) and a one-line note under it: "State filters match the recorded state. A key past its expiry is marked expired the next time it is used." `PAGE_SIZE = 25`. Caption `${total} ${total === 1 ? "key" : "keys"}`.

- [ ] **Step 3: Run and commit**

```bash
git commit --only -m "feat(plugin-keysmith): list keys with filters, paging and honest empty cells" -- packages/plugin-keysmith/src/pages/keys.tsx packages/plugin-keysmith/test/keys.test.tsx
git show --stat HEAD
```

(`git add` the new test file first.)

---

### Task 7: Key detail page (read-only)

**Files:**
- Modify: `packages/plugin-keysmith/src/pages/key-detail.tsx`
- Create: `packages/plugin-keysmith/test/key-detail.test.tsx`

**Interfaces:**
- Consumes: `KeyDetail`, `maskedKey`, `KeyStateBadge`. Route param `params.id`.

- [ ] **Step 1: Write the failing tests**

With key 1's detail (one open previous window, policy "Standard", two scopes, metadata `{team: "billing"}`):
1. The header shows the name, the masked key in mono, and the state badge; it sends `keys.detail` with `{ id: params.id }`.
2. A "Validity" section lists the previous key as `sk_live_…7c1e` with "valid until" and its `Timestamp`, plus a sentence: "Both the current key and this previous key are accepted until then." With no open windows the section says "No previous key is still accepted."
3. A "Details" `DescriptionList` shows the ID (mono), prefix (mono), environment, created by (or `NoneCell` label "creator"), created, updated, last used (`Timestamp` label "recorded use"), expires (label "expiry"), rotated (label "rotation").
4. "Policy" shows the policy name, max lifetime and grace as readable durations ("90 days", "24 hours"); with `policy: null` it shows an element labelled "no policy".
5. "Scopes" is a mono `TagList`; empty shows an element labelled "no scopes".
6. Metadata renders as a `DescriptionList` of key/value (values `JSON.stringify`ed when not strings); empty shows an element labelled "no metadata".
7. A NOT_FOUND error renders "Key not found" through QueryBoundary, with a link back to `/keys`.
8. The expired-pending key shows the state explanation "Expired on <date>. Keysmith marks expiry when the key is next used, so its recorded state is still active."

Add `src/format.ts` `formatDuration(seconds: number): string` (whole days when divisible by 86400, else whole hours when divisible by 3600, else minutes, else seconds; singular for 1) with its own test in `format.test.ts` first.

- [ ] **Step 2: Implement**

`DetailLayout` with `main` holding Validity, Details, Scopes, Metadata and `aside` holding Policy and a Warden note: "Warden grants this key's permissions as subject api_key:<id>." with the subject in mono (a link arrives in slice 5 once the settings intent says whether the warden hook is registered). No action buttons in this slice.

- [ ] **Step 3: Run and commit**

```bash
git commit --only -m "feat(plugin-keysmith): show a key's validity, policy, scopes and metadata" -- packages/plugin-keysmith/src/pages/key-detail.tsx packages/plugin-keysmith/src/format.ts packages/plugin-keysmith/test/key-detail.test.tsx packages/plugin-keysmith/test/format.test.ts
git show --stat HEAD
```

---

### Task 8: Wire into the shell and run it

**Files:**
- Modify: `apps/shell/package.json` (add `"@forge-go/dashboard-plugin-keysmith": "workspace:*"`), `apps/shell/src/App.tsx` (import `keysmithPlugin` and add it to `plugins` after `vaultPlugin`)

- [ ] **Step 1: Wire and build**

Before editing, `git diff apps/shell/package.json apps/shell/src/App.tsx`: both must be clean or carry only lines you can leave untouched. Add the two lines. Run `pnpm install`, then `pnpm --filter @forge-go/dashboard-shell build` and check the output builds.

- [ ] **Step 2: Whole-repo checks**

`pnpm -r test` (report the known unrelated `packages/host/test/setup-screen.test.tsx` failure as such, and any other failure in full), plus test, typecheck and lint for `plugin-keysmith`.

- [ ] **Step 3: Run it in a browser**

Start the `fixture-server` and `dashboard-shell` preview entries from `.claude/launch.json`. Open `/@keysmith/keys`. Check and screenshot:
- 5 keys, "5 keys" caption, no Globex key.
- The masked keys, the Expires soon badge, the Expired badge with its note, Revoked and Suspended.
- Filter State = Suspended shows 1; page state resets.
- Click "Billing service": detail shows the previous key `sk_live_…7c1e`, policy durations, two scopes, metadata.
- Open `/@keysmith/keys/<globex id>` directly: "Key not found".
- No console errors (`read_console_messages`), no failed network requests other than the deliberate 404.
Stop both servers afterwards.

- [ ] **Step 4: Commit**

```bash
git commit --only -m "feat(shell): mount the keysmith plugin" -- apps/shell/package.json apps/shell/src/App.tsx pnpm-lock.yaml
git show --stat HEAD
```

Same rule as Task 4 for shared files: if `git diff` on either shell file or the lockfile shows other sessions' changes, commit only what is yours and report the rest.
