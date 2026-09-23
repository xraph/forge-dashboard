# Vault Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the residuals the slice 1 final review left open, before slice 2 builds handlers on top of them.

**Architecture:** Six independent fixes in the vault Go repo, each its own commit. Tenant context keys are unified so one helper reaches every subsystem. Key and audit policy follow the human partner's decisions. confy reads through the secret service, and the memory store stops keeping a field no real backend keeps. The flag cache gets a bound and a public invalidate. Sqlite gets Count tests.

**Tech Stack:** Go 1.26, grove v1.6.3, stdlib `testing`.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md`, section "What slice 1 found that slice 2 must know".

**Decisions already made by the human partner (2026-09-23), binding:**
- A NAMED encryption key env var that is unset or empty at startup is an ERROR. Having no key configured at all keeps the plaintext fallback with a warning.
- Audit is ALWAYS on. `enable_audit` becomes a deprecated no-op.
- confy's constructors change to read through the secret service. A compile error for an external caller is acceptable.

## Global Constraints

- All code work happens in `/Users/rexraphael/Work/xraph/forgery/vault`, on `main` (consent given). Paths below are relative to it.
- `go build ./... && go test ./... && golangci-lint run ./...` pass at the end of every task.
- No test may be loosened, skipped or deleted to get a green run, except where a task explicitly replaces one.
- Error strings lowercase, package-prefixed.
- Commit messages carry NO `Co-Authored-By` trailer and no Claude/Anthropic attribution.
- Any prose that ships (docs, doc comments) has no em dashes.

## Review Focus

1. After Task 1, `scope.WithTenantID(ctx, "t")` must reach the flag engine's tenant override and the override resolver. A test must prove both through the public API, not by comparing key values.
2. After Task 2, no configuration that names a key env var may produce plaintext storage. Unset and set-to-empty both error.
3. After Task 4, no test anywhere may pass because the memory store kept `Value`. The memory store must behave like postgres.
4. After Task 5, the flag cache cannot grow past its cap however many distinct users evaluate, and correctness never depends on an entry surviving.
5. Task 3 must leave no configuration path that turns auditing off.

---

### Task 1: Unify the tenant and user context keys

**Files:** Modify `flag/engine.go`, `override/resolver.go`, `scope/scope.go` (comment only). Test: `flag/scope_keys_test.go`, `override/scope_keys_test.go` (create).

**Problem:** `scope.ContextKey`, `flag.ContextKey` and `override.contextKey` are three distinct types with the same string values. Go matches context keys by type and value, so `scope.WithTenantID` is invisible to flag evaluation and config resolution, contrary to the comment in `scope/scope.go`.

**Fix:** make both local key types aliases of `scope.ContextKey`:

```go
// flag/engine.go
// ContextKey is the context key type for flag evaluation. It is the same type
// as scope.ContextKey, so a tenant or user set with the scope helpers is the
// one the engine reads.
type ContextKey = scope.ContextKey
```

```go
// override/resolver.go
type contextKey = scope.ContextKey
```

Keep the existing constants (`flag.ContextKeyTenantID`, `flag.ContextKeyUserID`, `override.ContextKeyTenantID`) with their current string values. They now equal `scope.KeyTenantID` / `scope.KeyUserID` as keys. `scope` imports nothing from this module, so there is no cycle. Update the `scope/scope.go` comment so it is true: say the flag and override packages alias this type, rather than that the keys "intentionally match".

**Tests (must fail before the fix):**
- `flag/scope_keys_test.go` `TestScopeTenantReachesTheEngine`: define a flag, set a tenant override for "t-1", evaluate with `scope.WithTenantID(context.Background(), "t-1")`, and assert the override value AND `EvaluateDetail(...).Reason == flag.ReasonTenantOverride`.
- `flag/scope_keys_test.go` `TestScopeUserReachesTheEngine`: a `when_user` rule for "u-1"; evaluate with `scope.WithUserID`; assert it matched.
- `override/scope_keys_test.go` `TestScopeTenantReachesTheResolver`: config 10, override for "t-1" = 50, `Resolve` with `scope.WithTenantID` returns 50.

Commit: `fix(scope): make the tenant and user keys one type across packages`, body explaining that the scope helpers were invisible to flag evaluation and config resolution, and how the alias fixes it.

---

### Task 2: A named key env var that is missing is an error

**Files:** Modify `vault.go` (`buildEncryptor`, delete `isUnsetEnv`), `vault_test.go`.

**Rule:** `EncryptionKey` set: use it (unchanged). Else `EncryptionKeyEnv` set: the variable MUST hold a valid key; unset, empty, or undecodable are all errors. Else no key at all: plaintext fallback with the warning (unchanged).

`crypto.EnvKeyProvider.GetKey` already errors on unset or empty. So `buildEncryptor` returns every `GetKey` error, wrapped: `fmt.Errorf("vault: encryption_key_env names %s but it holds no usable key: %w", cfg.EncryptionKeyEnv, err)`. Delete `isUnsetEnv` and its now-false doc comment.

**Tests:**
- Replace `TestNewWithAnUnsetKeyEnvFallsBack` with `TestNewWithANamedButUnsetKeyEnvIsAnError` (unset variable, `New` errors, error names the variable).
- Add `TestNewWithANamedButEmptyKeyEnvIsAnError` (`t.Setenv(name, "")`).
- Keep `TestNewWithNoKeyStoresPlaintextAndDoesNotPanic` and the warning tests unchanged: no key at all still falls back.

Also check `extension/`: `buildVault` only passes `WithEncryptionKeyEnv` when the config names one, so no extension change should be needed. Confirm, and confirm `extension/build_vault_test.go` still passes.

Commit: `feat(vault): refuse to start when a named key variable is missing`, body: naming the variable says you meant to encrypt, so a missing one is a deployment mistake to surface before any plaintext is written; no key at all still falls back.

---

### Task 3: Audit is always on; retire enable_audit

**Files:** Modify `extension/config.go`, `extension/options.go`, the docs page(s) that mention `enable_audit` (search `docs/`). Test: `extension/build_vault_test.go`.

- `EnableAudit` field doc comment: `Deprecated: audit logging is always on and this setting has no effect.` Same on `WithEnableAudit`. Leave the field and option in place so existing configs and code still compile and parse.
- Remove `EnableAudit: true` from `DefaultConfig` only if nothing reads it; otherwise leave it. Do not add any code path that reads it.
- Docs: where `enable_audit` is documented, say it is deprecated and audit is always on.

**Test:** `TestAuditIsOnEvenWhenEnableAuditIsFalse`: an extension with `config.EnableAudit = false` and a store, `buildVault()`, write a secret through `v.Secrets().Set(ctx, k, v, appID)`, assert `CountAudit(ctx, appID) > 0`.

Commit: `refactor(extension): deprecate enable_audit now that audit is always on`.

---

### Task 4: confy reads through the secret service; the memory store stops keeping Value

**Files:** Modify `confy/provider.go`, `confy/source.go`, `confy/*_test.go`, `extension/extension.go` (mountToConfy), `store/memory/store.go`, `vault_test.go`. Test: `store/memory/store_test.go`.

**Why together:** confy returns `sec.Value` from the raw store, which no real backend populates, so confy returns "" for every secret in production. Its tests pass only because the memory store keeps `Value`. Making the memory store honest breaks confy's tests (correctly); fixing confy makes them pass for the right reason. Neither is reviewable alone.

**confy:** add to `confy`:

```go
// SecretReader reads and decrypts a secret. *secret.Service satisfies it.
// confy reads through the service rather than the store because no store
// backend keeps a decrypted value: only the service can produce one.
type SecretReader interface {
	Get(ctx context.Context, key, appID string) (*secret.Secret, error)
}
```

`NewVaultSecretProvider(secrets SecretReader, appID string)` and `NewVaultConfigSource(configStore config.Store, secrets SecretReader, appID string, opts ...VaultSourceOption)`. Every read of a secret value goes through `secrets.Get` and uses the returned `Value`. Keep all other behaviour (not-found handling, key prefixes, patterns) exactly as it is.

**Extension:** `mountToConfy` passes `e.v.Secrets()`. It runs after `e.v` is built; confirm the order in `Register` and move the call if it runs earlier.

**Memory store:** `SetSecret` must not persist `Value` (delete `cp.Value = copyBytes(s.Value)`; make sure the stored copy's `Value` is nil). This matches postgres, sqlite and mongo, which persist only `EncryptedValue`. Add `TestMemoryStoreDoesNotPersistValue` in `store/memory/store_test.go`: set a secret with both fields, read it back with `GetSecret`, assert `Value` is nil and `EncryptedValue` round-trips.

**Root tests:** the memory store is now production-faithful, so `prodLikeStore` in `vault_test.go` is redundant and its comment is false. Delete it and switch its tests to `memory.New()`. They must still fail against the pre-fix `secret.Service.Get` (reason it through; do not re-break the code to check).

**confy tests:** construct a `secret.Service` over `memory.New()` and pass it. Add `TestProviderReturnsPlaintextForAnEncryptedSecret` (service with a real key) and `TestProviderReturnsPlaintextWithNoKey` (nil encryptor). Both must fail against today's confy.

Commit: `fix(confy): read secrets through the service so they are not empty`, body covering both halves and that the memory store now behaves like every real backend.

---

### Task 5: Bound the flag cache and expose Invalidate

**Files:** Modify `flag/cache.go`, `flag/engine.go`. Test: `flag/cache_test.go`, `flag/engine_test.go`.

**Problem:** entries are never evicted. Since the key includes the user, the cache grows by one entry per flag, app, tenant and user forever. Separately, the engine never invalidates, so a flag change reaches `Evaluate` callers only after the TTL.

**Bound:** add `maxEntries int` to `evaluationCache`, default 10000, and an engine option `WithCacheMaxEntries(n int) EngineOption` (n <= 0 means the default). In `set`, when `len(entries) >= maxEntries`: first delete every expired entry; if still at or over the cap, clear the map entirely. The cache is an optimisation: dropping entries never changes an answer, only a hit rate, and a full clear is simple and correct.

**Invalidate:** export on the engine:

```go
// Invalidate drops every cached evaluation for a flag, across apps, tenants
// and users. Call it after changing a flag's definition, rules or tenant
// overrides so Evaluate callers see the change now rather than after the TTL.
// It is a no-op when the engine has no cache.
func (e *Engine) Invalidate(flagKey string)
```

**Tests:**
- `TestCacheNeverExceedsItsCap`: cap 100, set 1000 distinct user keys, assert `len(entries) <= 100` after every set (internal test; `cache_test.go` is package `flag`, check and use what it uses).
- `TestCacheSweepsExpiredBeforeClearing`: tiny TTL, fill to cap with entries that then expire, add one fresh entry, assert the expired ones are gone and the fresh one is present.
- `TestInvalidateMakesAChangeVisibleImmediately`: engine with a long TTL, evaluate (caches default), change the flag's default via the store, `Invalidate(key)`, evaluate again, assert the new value.

Commit: `fix(flag): bound the evaluation cache and let callers invalidate it`.

---

### Task 6: Count tests on sqlite

**Files:** Test: `store/sqlite/count_test.go` (create), in the same package as `store/sqlite/store_test.go`, reusing its `testStore(t)` helper.

Six tests covering each `Count*` method: zero for an empty app, per-app scoping asserted on identity through the matching `List*` call, count independent of paging, and an empty appID matching only empty-scoped rows. Mirror `store/memory/count_test.go`.

Commit: `test(store): cover Count on sqlite`.

---

## Done when

- `go build ./... && go test ./... && golangci-lint run ./...` clean, and `go test -race ./flag/ ./secret/ ./confy/ . ./extension/ ./store/...` clean.
- A tenant set with `scope.WithTenantID` changes flag evaluation and config resolution.
- A named key env var that is missing refuses to start.
- confy returns plaintext on a production-faithful store, keyed and keyless.
- The memory store does not keep `Value`.
- The flag cache is bounded and `Engine.Invalidate` exists.
- sqlite runs Count tests in the default suite.
