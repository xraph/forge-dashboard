# Keysmith domain fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make keysmith's engine and all four store backends do what the dashboard is about to claim they do, before any dashboard code depends on them.

**Architecture:** A cross-backend test harness in `internal/storetest` runs every test against memory and sqlite always, and against postgres and mongo when their env vars are set. Each domain fix lands as its own commit with a test that fails first. No contract or React code in this plan.

**Tech Stack:** Go 1.26, grove v1.6.3 (pgdriver, sqlitedriver on modernc, mongodriver), testify, Docker for the postgres and mongo test containers.

**Spec:** `docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md` in forge-dashboard. This is slice 1 of 6. Slices 2 to 6 (contract spine, key write path, policies and scopes, rotations/usage/overview/settings, retiring templ) get their own plans once this lands.

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forgery/keysmith`, branch `main`. No worktrees. Leave the untracked `_project_files/` alone.
- Other sessions work in forgery repos at the same time. Stage only your own files: `git add <paths>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, a bare directory, `--amend`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.
- Commit messages: no `Co-Authored-By` trailer, no Claude attribution, no em dashes. Bodies in Rex's voice (the `rex-voice` skill, then `humanizer` in embedded mode).
- Lint with a fresh cache every run: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- Full backend runs: `make test-backends` (added in Task 1) starts `keysmith-test-pg` on port 55437 and `keysmith-test-mongo` on 57037. Never touch other containers.
- Existing exported names keep compiling unless this plan removes them on purpose (`CleanupGraceExpired` in Task 6). Say so in the commit body when an exported API changes.
- Durations in stores keep their existing units (milliseconds in `grace_ttl_ms` and `latency_ms`).

## Review Focus

1. A sqlite deployment with rows already written in the broken `m=+...` format: every read of those rows still fails after Task 1. The fix only helps rows written afterwards. Task 1's commit body and, later, `MIGRATION.md` must say so; no test can repair data that never parsed.
2. Two rotations inside one grace window: both previous keys must validate until their own `grace_ends`, and `EndGrace` must close both. Task 6 pins this.
3. A revoked key presented through its previous (in-grace) hash: must fail with `ErrKeyInactive`, not validate. Task 6 pins this, because revoke ends windows and state is checked after the fallback lookup.
4. `Aggregate` with no `KeyID` sums across keys and returns a zero `KeyID`; with a `TenantID` it must never include another tenant's rows. Task 7 pins the tenant case by ID, not by count.
5. `AssignScopes` for a scope that exists in a different tenant must refuse with `ErrScopeNotFound`, not assign. Task 4 pins this on every backend (postgres's join was right by accident; memory accepted anything).

---

## File Structure

| File | Responsibility |
|---|---|
| `internal/storetest/storetest.go` (new) | `Each(t, fn)`: runs `fn` once per available backend with a fresh migrated store |
| `internal/storetest/conformance_test.go` (new) | Round-trip, time and empty-tenant pinning tests at store level |
| `scripts/test-backends.sh` (new) | Starts the two containers, runs `go test ./...` with the env vars, stops them |
| `Makefile` | `test-backends` target |
| `store/errors.go` (new) | `ErrKeyNotFound` and friends as store-level sentinels |
| `errors.go` | Root sentinels re-export the store ones |
| `store/{memory,sqlite,postgres,mongo}/*` | Not-found sentinel, sqlite time fix, rotation and usage changes |
| `rotation/rotation.go`, `rotation/store.go` | `OldHint`, `NewHint`, `GetInGraceByOldHash`, `EndGrace` |
| `usage/usage.go` | `Aggregation.ServerErrorCount`, pointer percentiles, period constants |
| `engine.go`, `types.go`, `options.go` | State guards, scope gate, grace window, `RotateOption`, `RateLimiterConfigured` |
| `engine_rotation_test.go`, `engine_state_test.go`, `engine_scopes_test.go`, `engine_usage_test.go` (new) | Engine behaviour across backends |
| `api/responses.go` | Aggregation response carries the new fields |

---

### Task 1: Cross-backend harness, and make sqlite readable

The sqlite store writes `time.Time` values through modernc, which formats them with `t.String()` unless the DSN sets `_time_format`. A local time with a monotonic reading comes out as `2026-09-30 13:53:45.835528 -0500 CDT m=+0.026463793` and cannot be scanned back, so every read of a row fails. Vault hit the same bug and fixed it with `dbTime(t) = t.UTC()` (see `vault/store/sqlite/models.go`). `store/sqlite` also never imports `sqlitemigrate`, so `Migrate` fails with "no executor registered" unless the host imports it.

**Files:**
- Create: `internal/storetest/storetest.go`
- Create: `internal/storetest/conformance_test.go`
- Create: `scripts/test-backends.sh`
- Modify: `Makefile` (add `test-backends`)
- Modify: `store/sqlite/store.go` (blank import, `dbTime`, `dbTimePtr`)
- Modify: `store/sqlite/models.go` (every `toModel` wraps times)
- Modify: `store/sqlite/key.go`, `store/sqlite/usage.go`, `store/sqlite/rotation.go` (every bound time argument wrapped)

**Interfaces:**
- Produces: `storetest.Each(t *testing.T, fn func(t *testing.T, s store.Store))` and `storetest.Backend{Name string}` exposed to fn via `storetest.Name(t)`. Every later task's tests call `Each`.

- [ ] **Step 1: Write the harness**

```go
// Package storetest runs a test against every keysmith store backend that is
// available. Memory and sqlite always run. Postgres runs when
// KEYSMITH_TEST_PG_DSN is set and mongo when KEYSMITH_TEST_MONGO_URI is set;
// `make test-backends` sets both.
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/mongodriver"
	"github.com/xraph/grove/drivers/pgdriver"
	"github.com/xraph/grove/drivers/sqlitedriver"

	"github.com/xraph/keysmith/store"
	"github.com/xraph/keysmith/store/memory"
	mongostore "github.com/xraph/keysmith/store/mongo"
	pgstore "github.com/xraph/keysmith/store/postgres"
	sqlitestore "github.com/xraph/keysmith/store/sqlite"
)

type backend struct {
	name string
	open func(t *testing.T) store.Store
}

func backends() []backend {
	bs := []backend{
		{"memory", func(*testing.T) store.Store { return memory.New() }},
		{"sqlite", openSQLite},
	}
	if dsn := os.Getenv("KEYSMITH_TEST_PG_DSN"); dsn != "" {
		bs = append(bs, backend{"postgres", func(t *testing.T) store.Store { return openPostgres(t, dsn) }})
	}
	if uri := os.Getenv("KEYSMITH_TEST_MONGO_URI"); uri != "" {
		bs = append(bs, backend{"mongo", func(t *testing.T) store.Store { return openMongo(t, uri) }})
	}
	return bs
}

// Each runs fn once per available backend, each with a fresh migrated store.
func Each(t *testing.T, fn func(t *testing.T, s store.Store)) {
	t.Helper()
	for _, b := range backends() {
		t.Run(b.name, func(t *testing.T) {
			s := b.open(t)
			if err := s.Migrate(context.Background()); err != nil {
				t.Fatalf("%s migrate: %v", b.name, err)
			}
			fn(t, s)
		})
	}
}

func suffix() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func openSQLite(t *testing.T) store.Store {
	t.Helper()
	sdb := sqlitedriver.New()
	if err := sdb.Open(context.Background(), filepath.Join(t.TempDir(), "keysmith.db")); err != nil {
		t.Fatalf("sqlite open: %v", err)
	}
	db, err := grove.Open(sdb)
	if err != nil {
		t.Fatalf("grove open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return sqlitestore.New(db)
}

// openPostgres creates a throwaway database per test, so tests never share
// rows, and drops it afterwards.
func openPostgres(t *testing.T, dsn string) store.Store {
	t.Helper()
	ctx := context.Background()
	admin := pgdriver.New()
	if err := admin.Open(ctx, dsn); err != nil {
		t.Fatalf("postgres admin open: %v", err)
	}
	name := "ks_" + suffix()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	db := pgdriver.New()
	if err := db.Open(ctx, replaceDB(dsn, name)); err != nil {
		t.Fatalf("postgres open: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		_ = admin.Close()
	})
	return pgstore.New(db)
}

func openMongo(t *testing.T, uri string) store.Store {
	t.Helper()
	ctx := context.Background()
	md := mongodriver.New()
	name := "ks_" + suffix()
	if err := md.Open(ctx, uri, mongodriver.WithDatabase(name), mongodriver.WithTimeout(10*time.Second)); err != nil {
		t.Fatalf("mongo open: %v", err)
	}
	db, err := grove.Open(md)
	if err != nil {
		t.Fatalf("grove open: %v", err)
	}
	t.Cleanup(func() {
		_ = md.Collection("keysmith_keys").Database().Drop(context.Background())
		_ = db.Close()
	})
	return mongostore.New(db)
}
```

`replaceDB` swaps the path segment of a `postgres://user:pw@host:port/db?query` DSN. Write it with `net/url`: parse, set `u.Path = "/" + name`, return `u.String()`.

- [ ] **Step 2: Write the failing conformance tests**

`internal/storetest/conformance_test.go`, package `storetest_test`:

```go
func newKey(tenant string) *key.Key {
	now := time.Now() // local, with a monotonic reading: the case that broke sqlite
	exp := now.Add(48 * time.Hour)
	return &key.Key{
		ID: id.NewKeyID(), TenantID: tenant, AppID: "app", Name: "k",
		Prefix: "sk", Hint: "a3f8", KeyHash: "hash-" + id.NewKeyID().String(),
		Environment: key.EnvLive, State: key.StateActive,
		ExpiresAt: &exp, CreatedAt: now, UpdatedAt: now,
	}
}

func TestKeyRoundTripKeepsInstants(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k := newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k))

		got, err := s.Keys().Get(ctx, k.ID)
		require.NoError(t, err)
		// Mongo keeps milliseconds, so compare instants within a millisecond.
		assert.WithinDuration(t, k.CreatedAt, got.CreatedAt, time.Millisecond)
		require.NotNil(t, got.ExpiresAt)
		assert.WithinDuration(t, *k.ExpiresAt, *got.ExpiresAt, time.Millisecond)

		byHash, err := s.Keys().GetByHash(ctx, k.KeyHash)
		require.NoError(t, err)
		assert.Equal(t, k.ID.String(), byHash.ID.String())
	})
}

func TestListExpiredComparesInstants(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		past := newKey("t1")
		p := time.Now().Add(-time.Hour)
		past.ExpiresAt = &p
		future := newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, past))
		require.NoError(t, s.Keys().Create(ctx, future))

		expired, err := s.Keys().ListExpired(ctx, time.Now())
		require.NoError(t, err)
		ids := keyIDs(expired)
		assert.Contains(t, ids, past.ID.String())
		assert.NotContains(t, ids, future.ID.String())
	})
}

// An empty TenantID in a list filter is not "no tenant". On every backend it
// means "every tenant". This test records that fact so the contract layer,
// which must never pass an empty tenant, has something to defend against.
func TestEmptyTenantFilterMatchesEveryTenant(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		a, b := newKey("tenant-a"), newKey("tenant-b")
		require.NoError(t, s.Keys().Create(ctx, a))
		require.NoError(t, s.Keys().Create(ctx, b))

		all, err := s.Keys().List(ctx, &key.ListFilter{TenantID: ""})
		require.NoError(t, err)
		assert.ElementsMatch(t, []string{a.ID.String(), b.ID.String()}, keyIDs(all))

		onlyA, err := s.Keys().List(ctx, &key.ListFilter{TenantID: "tenant-a"})
		require.NoError(t, err)
		assert.Equal(t, []string{a.ID.String()}, keyIDs(onlyA))
	})
}

func keyIDs(ks []*key.Key) []string {
	out := make([]string, len(ks))
	for i, k := range ks {
		out[i] = k.ID.String()
	}
	return out
}
```

- [ ] **Step 3: Run it and watch sqlite fail**

Run: `go test ./internal/storetest/ -run . -v`
Expected: `memory` passes; `sqlite` fails, either with `no executor registered for driver "sqlite"` at migrate or with `cannot parse "... m=+..." as time.Time`.

- [ ] **Step 4: Fix sqlite**

In `store/sqlite/store.go` add the import `_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate"` with a comment saying `Migrate` needs the executor registered and the host should not have to know that. Add:

```go
// dbTime normalizes a time before it is bound to a query or written to a
// model. modernc/sqlite stores a time.Time as t.String() unless the DSN sets
// _time_format, and this store does not own the DSN. That string only scans
// back when it is UTC with no monotonic reading: a monotonic reading adds
// " m=+..." and a local zone adds a name, and either one fails the scan for
// every row a query touches. t.UTC() fixes both and keeps the instant. UTC
// strings with trimmed fractions also sort as text, which the time
// comparisons in this package rely on.
func dbTime(t time.Time) time.Time { return t.UTC() }

func dbTimePtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := dbTime(*t)
	return &u
}
```

Then wrap every time that reaches the database:
- `store/sqlite/models.go`: in `keyToModel`, `policyToModel`, `scopeToModel`, `usageToModel`, `rotationToModel`, wrap each `time.Time` field with `dbTime(...)` and each `*time.Time` with `dbTimePtr(...)`.
- `store/sqlite/key.go`: `UpdateLastUsed` binds `dbTime(at)`; `ListExpired` binds `dbTime(before)`.
- `store/sqlite/usage.go`: every `*filter.After`, `*filter.Before`, `before`, `dayStart`, `dayEnd`, `monthStart`, `monthEnd` bound as `dbTime(...)`.
- `store/sqlite/rotation.go`: `ListPendingGrace` binds `dbTime(now)`.

Find any you missed with: `grep -n 'Where(.*?", \*\?[a-zA-Z.]*\(After\|Before\|before\|now\|at\|Start\|End\)' store/sqlite/*.go`.

- [ ] **Step 5: Run the tests again**

Run: `go test ./internal/storetest/ -v`
Expected: PASS for memory and sqlite.

- [ ] **Step 6: Add the backend runner**

`scripts/test-backends.sh`:

```bash
#!/usr/bin/env bash
# Runs the whole suite against memory, sqlite, postgres and mongo. Starts its
# own containers on odd ports so it never collides with anything you already
# run, and removes them on exit.
set -euo pipefail
PG=keysmith-test-pg
MG=keysmith-test-mongo
cleanup() { docker rm -f "$PG" "$MG" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name "$PG" -e POSTGRES_PASSWORD=ks -e POSTGRES_DB=ks -p 55437:5432 postgres:16-alpine >/dev/null
docker run -d --name "$MG" -p 57037:27017 mongo:7 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
export KEYSMITH_TEST_PG_DSN="postgres://postgres:ks@localhost:55437/ks?sslmode=disable"
export KEYSMITH_TEST_MONGO_URI="mongodb://localhost:57037"
go test -count=1 ./... "$@"
```

`chmod +x scripts/test-backends.sh`. In `Makefile`, add `test-backends` to `.PHONY` and:

```make
## test-backends: Run tests against memory, sqlite, postgres and mongo (needs Docker)
test-backends:
	@./scripts/test-backends.sh
```

- [ ] **Step 7: Run every backend**

Run: `make test-backends`
Expected: all four subtests PASS for the three conformance tests, and the existing suite still passes. If postgres or mongo fails, stop and report it; do not paper over a backend difference in the test.

- [ ] **Step 8: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add internal/storetest scripts/test-backends.sh
git commit --only -m "fix(sqlite): store times in UTC so rows scan back, and test every backend" -- internal/storetest scripts/test-backends.sh Makefile store/sqlite/store.go store/sqlite/models.go store/sqlite/key.go store/sqlite/usage.go store/sqlite/rotation.go
git show --stat HEAD
```

The body must say: the sqlite store could not read a single row it wrote, `ValidateKey` on a freshly created key returned "invalid API key", `Migrate` needed a side-effect import the host never knew about, and rows already written in the old format still will not scan.

---

### Task 2: Not-found is a sentinel on every backend

Each backend returns its own private `notFoundError`, which no `errors.Is` can match, so `keysmith.ErrKeyNotFound` is never returned and the REST API's `mapStoreError` cannot produce a 404. The contract needs `NOT_FOUND`.

**Files:**
- Create: `store/errors.go`
- Modify: `errors.go` (root sentinels become the store ones)
- Modify: `store/memory/store.go:777-781`, `store/postgres/helpers.go:3-7`, `store/sqlite/store.go:79-83`, `store/mongo/store.go:98-102`
- Test: `internal/storetest/conformance_test.go`

**Interfaces:**
- Produces: `store.ErrKeyNotFound`, `store.ErrPolicyNotFound`, `store.ErrScopeNotFound`, `store.ErrRotationNotFound`. `keysmith.ErrKeyNotFound` etc. are the same values, so `errors.Is(err, keysmith.ErrKeyNotFound)` works on anything a store returns.

- [ ] **Step 1: Write the failing test**

```go
func TestNotFoundIsASentinel(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		_, err := s.Keys().Get(ctx, id.NewKeyID())
		assert.ErrorIs(t, err, store.ErrKeyNotFound)
		_, err = s.Keys().GetByHash(ctx, "nope")
		assert.ErrorIs(t, err, store.ErrKeyNotFound)
		_, err = s.Policies().Get(ctx, id.NewPolicyID())
		assert.ErrorIs(t, err, store.ErrPolicyNotFound)
		_, err = s.Scopes().GetByName(ctx, "t1", "nope")
		assert.ErrorIs(t, err, store.ErrScopeNotFound)
		_, err = s.Rotations().LatestForKey(ctx, id.NewKeyID())
		assert.ErrorIs(t, err, store.ErrRotationNotFound)
	})
}
```

Run: `go test ./internal/storetest/ -run TestNotFoundIsASentinel -v`. Expected: FAIL, `undefined: store.ErrKeyNotFound`.

- [ ] **Step 2: Add the sentinels**

`store/errors.go`:

```go
package store

import "errors"

// Not-found sentinels. Every backend returns these (possibly wrapped), so
// callers can tell a missing row from a failed query with errors.Is. The
// root keysmith package re-exports them under the same names.
var (
	ErrKeyNotFound      = errors.New("keysmith: key not found")
	ErrPolicyNotFound   = errors.New("keysmith: policy not found")
	ErrScopeNotFound    = errors.New("keysmith: scope not found")
	ErrRotationNotFound = errors.New("keysmith: rotation record not found")
)

// NotFound maps an entity name to its sentinel. Backends call it from their
// errNotFound helper.
func NotFound(entity string) error {
	switch entity {
	case "key":
		return ErrKeyNotFound
	case "policy":
		return ErrPolicyNotFound
	case "scope":
		return ErrScopeNotFound
	case "rotation":
		return ErrRotationNotFound
	default:
		return errors.New("keysmith: " + entity + " not found")
	}
}
```

In root `errors.go`, replace the four definitions with `ErrKeyNotFound = store.ErrKeyNotFound` and so on, keeping the doc comments. The root package already imports `store`, so there is no cycle.

In each backend, delete `type notFoundError` and its `Error` method, and make `errNotFound(entity string) error { return store.NotFound(entity) }`. Run `grep -rn 'notFoundError' store/` afterwards and fix any type assertion it finds.

- [ ] **Step 3: Run the tests**

Run: `go test ./... && make test-backends`
Expected: PASS everywhere, including `TestNotFoundIsASentinel` on all four backends.

- [ ] **Step 4: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add store/errors.go
git commit --only -m "fix(store): return not-found sentinels that errors.Is can match" -- store/errors.go errors.go store/memory/store.go store/postgres/helpers.go store/sqlite/store.go store/mongo/store.go internal/storetest/conformance_test.go
git show --stat HEAD
```

---

### Task 3: Revocation is terminal

`SuspendKey` has no state guard, so revoke, suspend, reactivate brings a revoked key back with `revoked_at` still set.

**Files:**
- Modify: `engine.go` (`SuspendKey`, `RevokeKey`)
- Create: `engine_state_test.go`

**Interfaces:**
- Produces: `SuspendKey` returns `ErrInvalidStateTransition` unless the key is `active`. `RevokeKey` returns `ErrInvalidStateTransition` for a key already `revoked`. Both return `ErrKeyNotFound` (wrapped) for a missing key.

- [ ] **Step 1: Write the failing tests**

`engine_state_test.go`, package `keysmith_test`. Add this helper here (later tasks reuse it):

```go
func newEngine(t *testing.T, s store.Store, opts ...keysmith.Option) (*keysmith.Engine, context.Context) {
	t.Helper()
	eng, err := keysmith.NewEngine(append([]keysmith.Option{keysmith.WithStore(s)}, opts...)...)
	require.NoError(t, err)
	return eng, keysmith.WithTenant(context.Background(), "app", "t1")
}

func mustCreate(t *testing.T, eng *keysmith.Engine, ctx context.Context, in *keysmith.CreateKeyInput) *key.CreateResult {
	t.Helper()
	if in == nil {
		in = &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive}
	}
	r, err := eng.CreateKey(ctx, in)
	require.NoError(t, err)
	return r
}

func TestRevokedKeyCannotBeResurrected(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		r := mustCreate(t, eng, ctx, nil)
		require.NoError(t, eng.RevokeKey(ctx, r.Key.ID, "gone"))

		assert.ErrorIs(t, eng.SuspendKey(ctx, r.Key.ID), keysmith.ErrInvalidStateTransition)
		assert.ErrorIs(t, eng.ReactivateKey(ctx, r.Key.ID), keysmith.ErrInvalidStateTransition)
		_, err := eng.ValidateKey(ctx, r.RawKey)
		assert.ErrorIs(t, err, keysmith.ErrKeyInactive)

		k, err := eng.GetKey(ctx, r.Key.ID)
		require.NoError(t, err)
		assert.Equal(t, key.StateRevoked, k.State)
	})
}

func TestRevokeTwiceIsRefused(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		r := mustCreate(t, eng, ctx, nil)
		require.NoError(t, eng.RevokeKey(ctx, r.Key.ID, "gone"))
		assert.ErrorIs(t, eng.RevokeKey(ctx, r.Key.ID, "again"), keysmith.ErrInvalidStateTransition)
	})
}

func TestSuspendOnlyFromActive(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		r := mustCreate(t, eng, ctx, nil)
		require.NoError(t, eng.SuspendKey(ctx, r.Key.ID))
		assert.ErrorIs(t, eng.SuspendKey(ctx, r.Key.ID), keysmith.ErrInvalidStateTransition)
		require.NoError(t, eng.ReactivateKey(ctx, r.Key.ID))
		_, err := eng.ValidateKey(ctx, r.RawKey)
		assert.NoError(t, err)
	})
}

func TestStateChangesOnMissingKeyAreNotFound(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		assert.ErrorIs(t, eng.SuspendKey(ctx, id.NewKeyID()), keysmith.ErrKeyNotFound)
		assert.ErrorIs(t, eng.RevokeKey(ctx, id.NewKeyID(), "x"), keysmith.ErrKeyNotFound)
	})
}
```

Run: `go test -run 'Revoke|Suspend|StateChanges' -v .`
Expected: FAIL on `TestRevokedKeyCannotBeResurrected` (suspend returns nil) and `TestRevokeTwiceIsRefused`.

- [ ] **Step 2: Implement**

```go
// RevokeKey permanently disables a key. Revocation is terminal: no state
// change leads out of it, and revoking twice is refused so hooks fire once.
func (e *Engine) RevokeKey(ctx context.Context, keyID id.KeyID, reason string) error {
	k, err := e.store.Keys().Get(ctx, keyID)
	if err != nil {
		return fmt.Errorf("get key: %w", err)
	}
	if k.State == key.StateRevoked {
		return ErrInvalidStateTransition
	}
	// ...existing body unchanged from here...
}

// SuspendKey temporarily disables an active key. Only an active key can be
// suspended; anything else, a revoked key above all, is refused.
func (e *Engine) SuspendKey(ctx context.Context, keyID id.KeyID) error {
	k, err := e.store.Keys().Get(ctx, keyID)
	if err != nil {
		return fmt.Errorf("get key: %w", err)
	}
	if k.State != key.StateActive {
		return ErrInvalidStateTransition
	}
	if err := e.store.Keys().UpdateState(ctx, keyID, key.StateSuspended); err != nil {
		return fmt.Errorf("suspend key: %w", err)
	}
	k.State = key.StateSuspended
	_ = e.hooks.FireKeySuspended(ctx, k)
	return nil
}
```

- [ ] **Step 3: Run the tests**

Run: `go test ./... && make test-backends`
Expected: PASS.

- [ ] **Step 4: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add engine_state_test.go
git commit --only -m "fix(engine): make revocation terminal" -- engine.go engine_state_test.go
git show --stat HEAD
```

Body: revoke, then suspend, then reactivate used to bring a revoked key back with `revoked_at` still set and its Warden role gone. Also say a repeated REST `DELETE /keys/:id` now answers 409 through the existing `ErrInvalidStateTransition` mapping.

---

### Task 4: Scopes are checked before anything is written

`CreateKey` writes the key row, then assigns scopes. On postgres and mongo a missing scope fails the assignment after the row exists, so the caller gets an error, no raw key, and an active orphan key. Memory accepts any name. `ErrScopeNotAllowed` is defined and never returned.

**Files:**
- Modify: `engine.go` (`CreateKey`, `AssignScopes`, new unexported `checkScopes`)
- Create: `engine_scopes_test.go`

**Interfaces:**
- Consumes: `store.ErrScopeNotFound` (Task 2).
- Produces: `CreateKey` and `AssignScopes` return `ErrScopeNotFound` (wrapped) for an unknown name in the key's tenant and `ErrScopeNotAllowed` for a name outside a non-empty `policy.AllowedScopes`, and write nothing in either case.

- [ ] **Step 1: Write the failing tests**

```go
func createScope(t *testing.T, eng *keysmith.Engine, ctx context.Context, name string) {
	t.Helper()
	require.NoError(t, eng.CreateScope(ctx, &scope.Scope{Name: name}))
}

func TestCreateKeyWithUnknownScopeWritesNothing(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		_, err := eng.CreateKey(ctx, &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive, Scopes: []string{"nope"}})
		assert.ErrorIs(t, err, keysmith.ErrScopeNotFound)
		n, err := s.Keys().Count(context.Background(), &key.ListFilter{TenantID: "t1"})
		require.NoError(t, err)
		assert.Zero(t, n, "a failed create must not leave a key behind")
	})
}

func TestScopeFromAnotherTenantIsNotFound(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		other := keysmith.WithTenant(context.Background(), "app", "t2")
		createScope(t, eng, other, "read")
		r := mustCreate(t, eng, ctx, nil)
		assert.ErrorIs(t, eng.AssignScopes(ctx, r.Key.ID, []string{"read"}), keysmith.ErrScopeNotFound)
		got, err := s.Scopes().ListByKey(context.Background(), r.Key.ID)
		require.NoError(t, err)
		assert.Empty(t, got)
	})
}

func TestPolicyAllowedScopesAreEnforced(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		createScope(t, eng, ctx, "read")
		createScope(t, eng, ctx, "write")
		pol := &policy.Policy{Name: "readonly", AllowedScopes: []string{"read"}}
		require.NoError(t, eng.CreatePolicy(ctx, pol))

		_, err := eng.CreateKey(ctx, &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive, PolicyID: &pol.ID, Scopes: []string{"write"}})
		assert.ErrorIs(t, err, keysmith.ErrScopeNotAllowed)

		r, err := eng.CreateKey(ctx, &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive, PolicyID: &pol.ID, Scopes: []string{"read"}})
		require.NoError(t, err)
		assert.ErrorIs(t, eng.AssignScopes(ctx, r.Key.ID, []string{"write"}), keysmith.ErrScopeNotAllowed)
	})
}

func TestEmptyAllowedScopesAllowsAnyExistingScope(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		createScope(t, eng, ctx, "write")
		pol := &policy.Policy{Name: "open"}
		require.NoError(t, eng.CreatePolicy(ctx, pol))
		_, err := eng.CreateKey(ctx, &keysmith.CreateKeyInput{Name: "k", Prefix: "sk", Environment: key.EnvLive, PolicyID: &pol.ID, Scopes: []string{"write"}})
		assert.NoError(t, err)
	})
}
```

Run: `go test -run 'Scope' -v .`. Expected: FAIL on memory for the unknown and other-tenant cases, FAIL everywhere on `AllowedScopes`.

- [ ] **Step 2: Implement**

```go
// checkScopes resolves every scope name in the tenant and, when the policy
// lists allowed scopes, checks each against it. It runs before anything is
// written, so a refused create or assignment leaves no trace. An empty
// AllowedScopes means the policy does not restrict scopes.
func (e *Engine) checkScopes(ctx context.Context, tenantID string, pol *policy.Policy, names []string) error {
	var allowed map[string]bool
	if pol != nil && len(pol.AllowedScopes) > 0 {
		allowed = make(map[string]bool, len(pol.AllowedScopes))
		for _, s := range pol.AllowedScopes {
			allowed[s] = true
		}
	}
	for _, name := range names {
		if _, err := e.store.Scopes().GetByName(ctx, tenantID, name); err != nil {
			return fmt.Errorf("scope %q: %w", name, err)
		}
		if allowed != nil && !allowed[name] {
			return fmt.Errorf("scope %q: %w", name, ErrScopeNotAllowed)
		}
	}
	return nil
}
```

In `CreateKey`, load the policy (the existing block) before building `k`, keep it in a `pol` variable, then call `e.checkScopes(ctx, tenantID, pol, input.Scopes)` before `e.store.Keys().Create`. In `AssignScopes`, load the key, load its policy if `PolicyID != nil`, call `checkScopes(ctx, k.TenantID, pol, scopeNames)`, then assign.

- [ ] **Step 3: Run the tests**

Run: `go test ./... && make test-backends`. Expected: PASS. The existing `TestCreateKeyWithScopes` in `engine_test.go` creates scopes first; if it relied on memory accepting unknown names, update it to create them and say so in the commit body.

- [ ] **Step 4: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add engine_scopes_test.go
git commit --only -m "fix(engine): check scopes before writing a key and enforce allowed scopes" -- engine.go engine_scopes_test.go engine_test.go
git show --stat HEAD
```

---

### Task 5: Rotation records carry hints and can be found by old hash

**Files:**
- Modify: `rotation/rotation.go` (fields), `rotation/store.go` (two methods)
- Modify: memory `store/memory/store.go` rotation section
- Modify: `store/sqlite/{rotation.go,models.go,migrations.go}`
- Modify: `store/postgres/{rotation.go,models.go,migrations.go}`
- Modify: `store/mongo/{rotation.go,models.go,migrations.go,store.go}`
- Test: `internal/storetest/rotation_test.go` (new)

**Interfaces:**
- Produces:
  - `rotation.Record.OldHint string` (`json:"old_hint" db:"old_hint"`), `NewHint string` (`json:"new_hint" db:"new_hint"`).
  - `rotation.Store.GetInGraceByOldHash(ctx context.Context, hash string, now time.Time) (*Record, error)`: the record whose `OldKeyHash == hash` and `GraceEnds > now`; `store.ErrRotationNotFound` otherwise. If several match, the one with the latest `GraceEnds`.
  - `rotation.Store.EndGrace(ctx context.Context, keyID id.KeyID, at time.Time) (int64, error)`: sets `GraceEnds = at` on every record for the key with `GraceEnds > at`, returns how many changed.

- [ ] **Step 1: Write the failing store tests**

```go
func rec(keyID id.KeyID, oldHash string, ends time.Time) *rotation.Record {
	return &rotation.Record{
		ID: id.NewRotationID(), KeyID: keyID, TenantID: "t1",
		OldKeyHash: oldHash, NewKeyHash: "new-" + oldHash,
		OldHint: "a3f8", NewHint: "9c01", Reason: rotation.ReasonManual,
		GraceTTL: time.Hour, GraceEnds: ends, RotatedBy: "user_1", CreatedAt: time.Now(),
	}
}

func TestRotationHintsRoundTrip(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k := newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k))
		r := rec(k.ID, "old-1", time.Now().Add(time.Hour))
		require.NoError(t, s.Rotations().Create(ctx, r))
		got, err := s.Rotations().Get(ctx, r.ID)
		require.NoError(t, err)
		assert.Equal(t, "a3f8", got.OldHint)
		assert.Equal(t, "9c01", got.NewHint)
		assert.Equal(t, "user_1", got.RotatedBy)
	})
}

func TestGetInGraceByOldHash(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k := newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k))
		open := rec(k.ID, "old-open", time.Now().Add(time.Hour))
		closed := rec(k.ID, "old-closed", time.Now().Add(-time.Minute))
		require.NoError(t, s.Rotations().Create(ctx, open))
		require.NoError(t, s.Rotations().Create(ctx, closed))

		got, err := s.Rotations().GetInGraceByOldHash(ctx, "old-open", time.Now())
		require.NoError(t, err)
		assert.Equal(t, open.ID.String(), got.ID.String())

		_, err = s.Rotations().GetInGraceByOldHash(ctx, "old-closed", time.Now())
		assert.ErrorIs(t, err, store.ErrRotationNotFound)
		_, err = s.Rotations().GetInGraceByOldHash(ctx, "never", time.Now())
		assert.ErrorIs(t, err, store.ErrRotationNotFound)
	})
}

func TestEndGraceClosesEveryOpenWindow(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k, other := newKey("t1"), newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k))
		require.NoError(t, s.Keys().Create(ctx, other))
		require.NoError(t, s.Rotations().Create(ctx, rec(k.ID, "a", time.Now().Add(time.Hour))))
		require.NoError(t, s.Rotations().Create(ctx, rec(k.ID, "b", time.Now().Add(2*time.Hour))))
		require.NoError(t, s.Rotations().Create(ctx, rec(other.ID, "c", time.Now().Add(time.Hour))))

		n, err := s.Rotations().EndGrace(ctx, k.ID, time.Now())
		require.NoError(t, err)
		assert.EqualValues(t, 2, n)

		_, err = s.Rotations().GetInGraceByOldHash(ctx, "a", time.Now().Add(time.Second))
		assert.ErrorIs(t, err, store.ErrRotationNotFound)
		_, err = s.Rotations().GetInGraceByOldHash(ctx, "c", time.Now().Add(time.Second))
		assert.NoError(t, err, "another key's window must stay open")
	})
}
```

Run: `go test ./internal/storetest/ -run 'Rotation|Grace' -v`. Expected: compile failure on the new fields and methods.

- [ ] **Step 2: Domain types**

Add `OldHint` and `NewHint` to `rotation.Record` after `NewKeyHash`, with a comment: the last four characters of each raw key, the same public hint `key.Key` carries; empty on records written before this field existed. Add the two methods to `rotation.Store` with the doc comments from the Interfaces block.

- [ ] **Step 3: Memory**

```go
func (s *rotationStore) GetInGraceByOldHash(_ context.Context, hash string, now time.Time) (*rotation.Record, error) {
	st := s.store()
	st.mu.RLock()
	defer st.mu.RUnlock()
	var best *rotation.Record
	for _, r := range st.rotations {
		if r.OldKeyHash == hash && r.GraceEnds.After(now) && (best == nil || r.GraceEnds.After(best.GraceEnds)) {
			best = r
		}
	}
	if best == nil {
		return nil, errNotFound("rotation")
	}
	cp := *best
	return &cp, nil
}

func (s *rotationStore) EndGrace(_ context.Context, keyID id.KeyID, at time.Time) (int64, error) {
	st := s.store()
	st.mu.Lock()
	defer st.mu.Unlock()
	var n int64
	for _, r := range st.rotations {
		if r.KeyID.String() == keyID.String() && r.GraceEnds.After(at) {
			r.GraceEnds = at
			n++
		}
	}
	return n, nil
}
```

- [ ] **Step 4: SQL backends**

Model: add `OldHint string \`grove:"old_hint,notnull"\`` and `NewHint string \`grove:"new_hint,notnull"\`` to `rotationModel` in both sqlite and postgres, and map them in `rotationToModel` and `rotationFromModel`.

Postgres migration: append to the grove `Migrations` group

```go
&migrate.Migration{
	Name:    "rotation_hints_and_old_hash_index",
	Version: "20260930000001",
	Up: func(ctx context.Context, exec migrate.Executor) error {
		_, err := exec.Exec(ctx, rotationHintsSQL)
		return err
	},
	Down: func(ctx context.Context, exec migrate.Executor) error {
		_, err := exec.Exec(ctx, `DROP INDEX IF EXISTS idx_keysmith_rotations_old_hash;
ALTER TABLE keysmith_rotations DROP COLUMN IF EXISTS old_hint;
ALTER TABLE keysmith_rotations DROP COLUMN IF EXISTS new_hint;`)
		return err
	},
},
```

with

```go
const rotationHintsSQL = `ALTER TABLE keysmith_rotations ADD COLUMN IF NOT EXISTS old_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE keysmith_rotations ADD COLUMN IF NOT EXISTS new_hint TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_keysmith_rotations_old_hash ON keysmith_rotations (old_key_hash);`
```

and append `rotationHintsSQL` to `migrationSQL`, because `Store.Migrate` runs that slice and not the group. Both paths must stay in step.

Sqlite migration: append to its group, version `20260930000001`. sqlite has no `ADD COLUMN IF NOT EXISTS`, which is fine because the orchestrator records applied versions:

```sql
ALTER TABLE keysmith_rotations ADD COLUMN old_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE keysmith_rotations ADD COLUMN new_hint TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_keysmith_rotations_old_hash ON keysmith_rotations (old_key_hash);
```

If modernc refuses several statements in one `Exec`, split them into three `exec.Exec` calls.

Store methods, sqlite shown; postgres is identical without `dbTime`:

```go
func (s *rotationStore) GetInGraceByOldHash(ctx context.Context, hash string, now time.Time) (*rotation.Record, error) {
	m := new(rotationModel)
	err := s.sdb.NewSelect(m).
		Where("old_key_hash = ?", hash).
		Where("grace_ends > ?", dbTime(now)).
		OrderExpr("grace_ends DESC").
		Limit(1).
		Scan(ctx)
	if err != nil {
		if isNoRows(err) {
			return nil, errNotFound("rotation")
		}
		return nil, fmt.Errorf("keysmith/sqlite: get in-grace rotation: %w", err)
	}
	return rotationFromModel(m)
}

func (s *rotationStore) EndGrace(ctx context.Context, keyID id.KeyID, at time.Time) (int64, error) {
	res, err := s.sdb.NewUpdate((*rotationModel)(nil)).
		Set("grace_ends = ?", dbTime(at)).
		Where("key_id = ?", keyID.String()).
		Where("grace_ends > ?", dbTime(at)).
		Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("keysmith/sqlite: end grace: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
```

Postgres's not-found check uses `errors.Is(err, sql.ErrNoRows)` as in `store/postgres/key.go`; copy that file's idiom.

- [ ] **Step 5: Mongo**

Model: `OldHint string \`grove:"old_hint" bson:"old_hint"\``, `NewHint string \`grove:"new_hint" bson:"new_hint"\``, mapped both ways. Index: add `{Keys: bson.D{{Key: "old_key_hash", Value: 1}}}` to `colRotations` in `migrationIndexes()` in `store/mongo/store.go` (the path `Store.Migrate` runs) and to the `create_keysmith_rotations` migration's index list.

```go
func (s *rotationStore) GetInGraceByOldHash(ctx context.Context, hash string, now time.Time) (*rotation.Record, error) {
	var models []rotationModel
	err := s.mdb.NewFind(&models).
		Filter(bson.M{"old_key_hash": hash, "grace_ends": bson.M{"$gt": now}}).
		Sort(bson.D{{Key: "grace_ends", Value: -1}}).
		Limit(1).
		Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("keysmith/mongo: get in-grace rotation: %w", err)
	}
	if len(models) == 0 {
		return nil, errNotFound("rotation")
	}
	return rotationFromModel(&models[0])
}

func (s *rotationStore) EndGrace(ctx context.Context, keyID id.KeyID, at time.Time) (int64, error) {
	res, err := s.mdb.NewUpdate((*rotationModel)(nil)).
		Filter(bson.M{"key_id": keyID.String(), "grace_ends": bson.M{"$gt": at}}).
		Set("grace_ends", at).
		Many().
		Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("keysmith/mongo: end grace: %w", err)
	}
	return res.ModifiedCount(), nil
}
```

Check the method name on the mongo result type (`ModifiedCount` or `RowsAffected`) against `store/mongo/key.go`, which already uses `res.MatchedCount()`.

- [ ] **Step 6: Run the tests**

Run: `go test ./... && make test-backends`. Expected: PASS on all four.

- [ ] **Step 7: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add internal/storetest/rotation_test.go
git commit --only -m "feat(rotation): record key hints and look rotations up by old hash" -- rotation/rotation.go rotation/store.go store/memory/store.go store/sqlite/rotation.go store/sqlite/models.go store/sqlite/migrations.go store/postgres/rotation.go store/postgres/models.go store/postgres/migrations.go store/mongo/rotation.go store/mongo/models.go store/mongo/migrations.go store/mongo/store.go internal/storetest/rotation_test.go
git show --stat HEAD
```

---

### Task 6: A real grace window

**Files:**
- Modify: `engine.go` (`RotateKey`, `ValidateKey`, `RevokeKey`, new `EndGrace`, delete `CleanupGraceExpired`)
- Modify: `types.go` (`ValidationResult` fields), `options.go` (`RotateOption`)
- Modify: `engine_test.go` (`TestRotateKey`)
- Create: `engine_rotation_test.go`

**Interfaces:**
- Consumes: Task 5's `GetInGraceByOldHash`, `EndGrace`, `OldHint`, `NewHint`.
- Produces:
  - `type RotateOption func(*rotateConfig)`; `WithGrace(d time.Duration) RotateOption` (zero is valid and means the old key dies now; negative is treated as zero); `WithRotatedBy(subject string) RotateOption`.
  - `func (e *Engine) RotateKey(ctx context.Context, keyID id.KeyID, reason rotation.Reason, opts ...RotateOption) (*key.CreateResult, error)`. Refuses a `revoked` or `expired` key (stored state, or `ExpiresAt` in the past) with `ErrInvalidStateTransition`.
  - `func (e *Engine) EndGrace(ctx context.Context, keyID id.KeyID) (int64, error)`.
  - `ValidationResult.ViaPreviousKey bool` (`json:"via_previous_key,omitempty"`), `ValidationResult.GraceEnds *time.Time` (`json:"grace_ends,omitempty"`).

- [ ] **Step 1: Write the failing tests**

```go
func TestOldKeyValidatesInsideTheWindow(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		orig := mustCreate(t, eng, ctx, nil)
		rot, err := eng.RotateKey(ctx, orig.Key.ID, rotation.ReasonManual, keysmith.WithGrace(time.Hour), keysmith.WithRotatedBy("user_1"))
		require.NoError(t, err)

		vr, err := eng.ValidateKey(ctx, orig.RawKey)
		require.NoError(t, err)
		assert.True(t, vr.ViaPreviousKey)
		require.NotNil(t, vr.GraceEnds)
		assert.WithinDuration(t, time.Now().Add(time.Hour), *vr.GraceEnds, 5*time.Second)
		assert.Equal(t, orig.Key.ID.String(), vr.Key.ID.String())

		vr, err = eng.ValidateKey(ctx, rot.RawKey)
		require.NoError(t, err)
		assert.False(t, vr.ViaPreviousKey)

		recs, err := eng.ListRotations(ctx, &rotation.ListFilter{KeyID: &orig.Key.ID})
		require.NoError(t, err)
		require.Len(t, recs, 1)
		assert.Equal(t, orig.RawKey[len(orig.RawKey)-4:], recs[0].OldHint)
		assert.Equal(t, rot.RawKey[len(rot.RawKey)-4:], recs[0].NewHint)
		assert.Equal(t, "user_1", recs[0].RotatedBy)
	})
}

func TestZeroGraceKillsTheOldKeyAtOnce(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		orig := mustCreate(t, eng, ctx, nil)
		_, err := eng.RotateKey(ctx, orig.Key.ID, rotation.ReasonCompromise, keysmith.WithGrace(0))
		require.NoError(t, err)
		_, err = eng.ValidateKey(ctx, orig.RawKey)
		assert.ErrorIs(t, err, keysmith.ErrInvalidKey)
	})
}

func TestDefaultGraceComesFromPolicyThen24h(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		pol := &policy.Policy{Name: "p", GracePeriod: 2 * time.Hour}
		require.NoError(t, eng.CreatePolicy(ctx, pol))
		withPol := mustCreate(t, eng, ctx, &keysmith.CreateKeyInput{Name: "a", Prefix: "sk", Environment: key.EnvLive, PolicyID: &pol.ID})
		bare := mustCreate(t, eng, ctx, nil)
		_, err := eng.RotateKey(ctx, withPol.Key.ID, rotation.ReasonManual)
		require.NoError(t, err)
		_, err = eng.RotateKey(ctx, bare.Key.ID, rotation.ReasonManual)
		require.NoError(t, err)

		a, _ := eng.ListRotations(ctx, &rotation.ListFilter{KeyID: &withPol.Key.ID})
		b, _ := eng.ListRotations(ctx, &rotation.ListFilter{KeyID: &bare.Key.ID})
		assert.Equal(t, 2*time.Hour, a[0].GraceTTL)
		assert.Equal(t, 24*time.Hour, b[0].GraceTTL)
	})
}

func TestTwoRotationsInOneWindowKeepBothPreviousKeys(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		k0 := mustCreate(t, eng, ctx, nil)
		k1, err := eng.RotateKey(ctx, k0.Key.ID, rotation.ReasonManual, keysmith.WithGrace(time.Hour))
		require.NoError(t, err)
		k2, err := eng.RotateKey(ctx, k0.Key.ID, rotation.ReasonManual, keysmith.WithGrace(time.Hour))
		require.NoError(t, err)
		for _, raw := range []string{k0.RawKey, k1.RawKey, k2.RawKey} {
			_, err := eng.ValidateKey(ctx, raw)
			assert.NoError(t, err)
		}
		n, err := eng.EndGrace(ctx, k0.Key.ID)
		require.NoError(t, err)
		assert.EqualValues(t, 2, n)
		for _, raw := range []string{k0.RawKey, k1.RawKey} {
			_, err := eng.ValidateKey(ctx, raw)
			assert.ErrorIs(t, err, keysmith.ErrInvalidKey)
		}
		_, err = eng.ValidateKey(ctx, k2.RawKey)
		assert.NoError(t, err)
	})
}

func TestRevokeEndsTheWindowAndPreviousKeyStaysDead(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		orig := mustCreate(t, eng, ctx, nil)
		_, err := eng.RotateKey(ctx, orig.Key.ID, rotation.ReasonManual, keysmith.WithGrace(time.Hour))
		require.NoError(t, err)
		require.NoError(t, eng.RevokeKey(ctx, orig.Key.ID, "gone"))
		_, err = eng.ValidateKey(ctx, orig.RawKey)
		assert.Error(t, err)
		recs, _ := eng.ListRotations(ctx, &rotation.ListFilter{KeyID: &orig.Key.ID})
		assert.False(t, recs[0].GraceEnds.After(time.Now()), "revoke must close the window")
	})
}

func TestSuspendedKeyFailsThroughItsPreviousHashToo(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		orig := mustCreate(t, eng, ctx, nil)
		_, err := eng.RotateKey(ctx, orig.Key.ID, rotation.ReasonManual, keysmith.WithGrace(time.Hour))
		require.NoError(t, err)
		require.NoError(t, eng.SuspendKey(ctx, orig.Key.ID))
		_, err = eng.ValidateKey(ctx, orig.RawKey)
		assert.ErrorIs(t, err, keysmith.ErrKeyInactive)
	})
}

func TestRotateRefusesRevokedAndExpiredKeys(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		eng, ctx := newEngine(t, s)
		revoked := mustCreate(t, eng, ctx, nil)
		require.NoError(t, eng.RevokeKey(ctx, revoked.Key.ID, "x"))
		_, err := eng.RotateKey(ctx, revoked.Key.ID, rotation.ReasonManual)
		assert.ErrorIs(t, err, keysmith.ErrInvalidStateTransition)

		past := time.Now().Add(-time.Minute)
		expired := mustCreate(t, eng, ctx, &keysmith.CreateKeyInput{Name: "e", Prefix: "sk", Environment: key.EnvLive, ExpiresAt: &past})
		_, err = eng.RotateKey(ctx, expired.Key.ID, rotation.ReasonManual)
		assert.ErrorIs(t, err, keysmith.ErrInvalidStateTransition)
	})
}
```

In `engine_test.go`, change the end of `TestRotateKey`: replace the `// Old key should fail.` assertion with an assertion that the old key validates with `ViaPreviousKey == true`, and add a `WithGrace(0)` rotation at the end asserting the previous key then fails with `ErrInvalidKey`.

Run: `go test -run 'Rotat|Grace|Revoke|Suspended' -v .`. Expected: compile failure on `WithGrace`.

- [ ] **Step 2: Options and result fields**

`options.go`:

```go
type rotateConfig struct {
	grace     *time.Duration
	rotatedBy string
}

// RotateOption customises one call to RotateKey.
type RotateOption func(*rotateConfig)

// WithGrace sets how long the previous key keeps validating. Zero means it
// stops the moment the rotation is recorded, which is what a compromise
// rotation wants. A negative value is treated as zero.
func WithGrace(d time.Duration) RotateOption {
	return func(c *rotateConfig) {
		if d < 0 {
			d = 0
		}
		c.grace = &d
	}
}

// WithRotatedBy records who rotated the key.
func WithRotatedBy(subject string) RotateOption {
	return func(c *rotateConfig) { c.rotatedBy = subject }
}
```

`types.go`: add the two `ValidationResult` fields with doc comments (a host can warn a caller who is still on a previous key, and say until when).

- [ ] **Step 3: Engine**

`RotateKey(ctx, keyID, reason, opts ...RotateOption)`:
1. Get the key. If `State == StateRevoked || State == StateExpired || (ExpiresAt != nil && now.After(*ExpiresAt))`, return `ErrInvalidStateTransition`.
2. Apply opts. Grace: `*cfg.grace` if set, else the policy's `GracePeriod` if a policy is set and it is above zero, else `24 * time.Hour`.
3. Before overwriting, capture `oldHash := k.KeyHash` and `oldHint := k.Hint`.
4. Generate, hash, update the key (existing code).
5. Create the record with `OldHint: oldHint`, `NewHint: k.Hint`, `RotatedBy: cfg.rotatedBy`, `GraceTTL: grace`, `GraceEnds: now.Add(grace)`.

`ValidateKey`: replace the lookup and the unreachable `StateRotated` block with

```go
	var viaPrevious bool
	var graceEnds *time.Time
	k, err := e.store.Keys().GetByHash(ctx, hash)
	if err != nil {
		rec, recErr := e.store.Rotations().GetInGraceByOldHash(ctx, hash, time.Now())
		if recErr != nil {
			_ = e.hooks.FireKeyValidationFailed(ctx, rawKey, err)
			return nil, ErrInvalidKey
		}
		k, err = e.store.Keys().Get(ctx, rec.KeyID)
		if err != nil {
			_ = e.hooks.FireKeyValidationFailed(ctx, rawKey, err)
			return nil, ErrInvalidKey
		}
		viaPrevious = true
		ends := rec.GraceEnds
		graceEnds = &ends
	}
```

Keep the state, expiry, rate-limit and scope checks after it unchanged except that the state check becomes `if k.State != key.StateActive`. Set `ViaPreviousKey: viaPrevious, GraceEnds: graceEnds` on the result.

`EndGrace`:

```go
// EndGrace closes every open grace window on a key now, so every previous
// key stops validating. It returns how many windows it closed.
func (e *Engine) EndGrace(ctx context.Context, keyID id.KeyID) (int64, error) {
	if _, err := e.store.Keys().Get(ctx, keyID); err != nil {
		return 0, fmt.Errorf("get key: %w", err)
	}
	n, err := e.store.Rotations().EndGrace(ctx, keyID, time.Now())
	if err != nil {
		return 0, fmt.Errorf("end grace: %w", err)
	}
	return n, nil
}
```

`RevokeKey`: after the update succeeds and before firing the hook, `if _, err := e.store.Rotations().EndGrace(ctx, keyID, now); err != nil { return fmt.Errorf("end grace: %w", err) }`.

Delete `CleanupGraceExpired`. Leave `key.StateRotated` defined; add to its comment that the engine never assigns it and it exists for compatibility.

- [ ] **Step 4: Run the tests**

Run: `go test ./... && make test-backends`. Expected: PASS. `grep -rn CleanupGraceExpired .` finds nothing outside `_project_files`.

- [ ] **Step 5: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add engine_rotation_test.go
git commit --only -m "fix(engine): keep the previous key valid for the grace window" -- engine.go types.go options.go engine_test.go engine_rotation_test.go
git show --stat HEAD
```

Body: before this, rotation killed the old key at once whatever `grace_ends` said, and `TestRotateKey` asserted it. Now the previous hash validates until its window ends. `RotateKey` takes options (existing callers compile). `CleanupGraceExpired` is removed: it never acted, and with its filter corrected it would have revoked the live key.

---

### Task 7: Usage aggregates over raw rows

Nothing writes `keysmith_usage_agg`, so `Aggregate` is empty on every backend and memory returns `nil`.

**Files:**
- Modify: `usage/usage.go`
- Modify: `store/memory/store.go` (usage section)
- Modify: `store/sqlite/{usage.go,models.go,migrations.go}`, `store/postgres/{usage.go,models.go,migrations.go}`, `store/mongo/{usage.go,models.go,migrations.go,store.go}`
- Modify: `api/responses.go` (`AggregationResponse`, `toAggregationResponse`)
- Create: `internal/storetest/usage_test.go`

**Interfaces:**
- Produces:
  - `usage.PeriodHourly = "hourly"`, `usage.PeriodDaily = "daily"`, `usage.PeriodMonthly = "monthly"`; `usage.ErrInvalidPeriod`.
  - `Aggregation` gains `ServerErrorCount int64 \`json:"server_error_count"\``; `P50Latency` and `P99Latency` become `*int64` with `omitempty`, always nil.
  - `Aggregate(filter)`: requires `filter.Period` in the three constants, else `ErrInvalidPeriod`. Buckets are UTC. Groups by key when `filter.KeyID != nil`, otherwise sums across keys with a zero `KeyID`. `ErrorCount` counts status >= 400, `ServerErrorCount` status >= 500. `TotalLatency` sums `latency_ms`. Ordered by `PeriodStart` ascending. `After` inclusive, `Before` exclusive, on every backend. Only buckets with rows are returned; filling empty buckets is the caller's job.
  - Memory `Query` and `Count` treat `Before` as exclusive, matching SQL.

- [ ] **Step 1: Write the failing tests**

```go
func usageAt(keyID id.KeyID, tenant string, at time.Time, status int, latency time.Duration) *usage.Record {
	return &usage.Record{ID: id.NewUsageID(), KeyID: keyID, TenantID: tenant, Endpoint: "/x", Method: "GET",
		StatusCode: status, Latency: latency, CreatedAt: at}
}

func TestAggregateDailyBuckets(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k := newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k))
		day1 := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
		day2 := time.Date(2026, 9, 29, 23, 30, 0, 0, time.UTC)
		require.NoError(t, s.Usages().RecordBatch(ctx, []*usage.Record{
			usageAt(k.ID, "t1", day1, 200, 10*time.Millisecond),
			usageAt(k.ID, "t1", day1.Add(time.Hour), 404, 20*time.Millisecond),
			usageAt(k.ID, "t1", day2, 503, 30*time.Millisecond),
		}))
		after := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
		before := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
		aggs, err := s.Usages().Aggregate(ctx, &usage.QueryFilter{TenantID: "t1", Period: usage.PeriodDaily, After: &after, Before: &before})
		require.NoError(t, err)
		require.Len(t, aggs, 2)
		assert.True(t, aggs[0].PeriodStart.Equal(after))
		assert.EqualValues(t, 2, aggs[0].RequestCount)
		assert.EqualValues(t, 1, aggs[0].ErrorCount)
		assert.EqualValues(t, 0, aggs[0].ServerErrorCount)
		assert.EqualValues(t, 30, aggs[0].TotalLatency)
		assert.EqualValues(t, 1, aggs[1].ServerErrorCount)
		assert.Nil(t, aggs[0].P50Latency)
	})
}

func TestAggregateNeverCrossesTenants(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		a, b := newKey("t1"), newKey("t2")
		require.NoError(t, s.Keys().Create(ctx, a))
		require.NoError(t, s.Keys().Create(ctx, b))
		at := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
		require.NoError(t, s.Usages().RecordBatch(ctx, []*usage.Record{
			usageAt(a.ID, "t1", at, 200, 0), usageAt(b.ID, "t2", at, 200, 0), usageAt(b.ID, "t2", at, 200, 0),
		}))
		aggs, err := s.Usages().Aggregate(ctx, &usage.QueryFilter{TenantID: "t1", Period: usage.PeriodDaily})
		require.NoError(t, err)
		require.Len(t, aggs, 1)
		assert.Equal(t, "t1", aggs[0].TenantID)
		assert.EqualValues(t, 1, aggs[0].RequestCount)
	})
}

func TestAggregateHourlyAndMonthlyAndPerKey(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k1, k2 := newKey("t1"), newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k1))
		require.NoError(t, s.Keys().Create(ctx, k2))
		at := time.Date(2026, 9, 28, 10, 15, 0, 0, time.UTC)
		require.NoError(t, s.Usages().RecordBatch(ctx, []*usage.Record{
			usageAt(k1.ID, "t1", at, 200, 0), usageAt(k2.ID, "t1", at.Add(10*time.Minute), 200, 0),
		}))
		hourly, err := s.Usages().Aggregate(ctx, &usage.QueryFilter{TenantID: "t1", Period: usage.PeriodHourly})
		require.NoError(t, err)
		require.Len(t, hourly, 1)
		assert.True(t, hourly[0].PeriodStart.Equal(time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)))
		assert.EqualValues(t, 2, hourly[0].RequestCount)

		monthly, err := s.Usages().Aggregate(ctx, &usage.QueryFilter{TenantID: "t1", Period: usage.PeriodMonthly})
		require.NoError(t, err)
		require.Len(t, monthly, 1)
		assert.True(t, monthly[0].PeriodStart.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)))

		perKey, err := s.Usages().Aggregate(ctx, &usage.QueryFilter{TenantID: "t1", KeyID: &k1.ID, Period: usage.PeriodDaily})
		require.NoError(t, err)
		require.Len(t, perKey, 1)
		assert.EqualValues(t, 1, perKey[0].RequestCount)
		assert.Equal(t, k1.ID.String(), perKey[0].KeyID.String())

		_, err = s.Usages().Aggregate(ctx, &usage.QueryFilter{TenantID: "t1", Period: "weekly"})
		assert.ErrorIs(t, err, usage.ErrInvalidPeriod)
	})
}

func TestUsageBeforeIsExclusive(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		k := newKey("t1")
		require.NoError(t, s.Keys().Create(ctx, k))
		at := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
		require.NoError(t, s.Usages().Record(ctx, usageAt(k.ID, "t1", at, 200, 0)))
		got, err := s.Usages().Query(ctx, &usage.QueryFilter{TenantID: "t1", Before: &at})
		require.NoError(t, err)
		assert.Empty(t, got)
	})
}
```

Run: `go test ./internal/storetest/ -run 'Aggregate|Usage' -v`. Expected: compile failure on `usage.PeriodDaily`.

- [ ] **Step 2: Domain types**

In `usage/usage.go` add the three constants, `var ErrInvalidPeriod = errors.New("keysmith: usage period must be hourly, daily or monthly")`, `ServerErrorCount`, and change the percentile fields to `*int64` with a comment: never set, because the four backends cannot compute the same percentile; kept so the JSON shape does not break. Add:

```go
// Truncate returns the UTC start of the bucket t falls in.
func Truncate(t time.Time, period string) (time.Time, error) {
	u := t.UTC()
	switch period {
	case PeriodHourly:
		return time.Date(u.Year(), u.Month(), u.Day(), u.Hour(), 0, 0, 0, time.UTC), nil
	case PeriodDaily:
		return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC), nil
	case PeriodMonthly:
		return time.Date(u.Year(), u.Month(), 1, 0, 0, 0, 0, time.UTC), nil
	default:
		return time.Time{}, ErrInvalidPeriod
	}
}
```

- [ ] **Step 3: Memory**

Replace `Aggregate` with a loop over `matchUsageFilter` rows that calls `usage.Truncate`, keys a map by `bucket.Unix()` plus key ID when `filter.KeyID != nil`, accumulates the counts, and returns the values sorted by `PeriodStart`. Change `matchUsageFilter`'s `Before` check to `!rec.CreatedAt.Before(*f.Before)` so `Before` is exclusive.

- [ ] **Step 4: Sqlite**

Times are stored as UTC text after Task 1 (`2026-09-28 10:15:00 +0000 UTC`), so a bucket is a prefix: hourly `substr(created_at, 1, 13)`, daily `substr(created_at, 1, 10)`, monthly `substr(created_at, 1, 7)`. Build the SQL with the prefix length from a switch on `filter.Period` (never from user input directly), run it with `s.sdb.Query(ctx, sql, args...)`, scan `bucket string, key string, requests, errors, serverErrors, latency int64`, and parse the bucket with the layout for its length (`"2006-01-02 15"`, `"2006-01-02"`, `"2006-01"`) in UTC.

```sql
SELECT substr(created_at, 1, ?) AS bucket, %s AS key_id, tenant_id,
       COUNT(*), SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END),
       SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END), COALESCE(SUM(latency_ms), 0)
FROM keysmith_usage
WHERE 1=1 [AND tenant_id = ?] [AND key_id = ?] [AND created_at >= ?] [AND created_at < ?]
GROUP BY bucket, %s, tenant_id
ORDER BY bucket ASC
```

`%s` is `key_id` when a key filter is set and `''` otherwise. Bind times with `dbTime`.

Old `aggFromModel` and `usageAggModel` go. Add a sqlite migration, version `20260930000002`, `DROP TABLE IF EXISTS keysmith_usage_agg`, and remove the agg table from the original create migration's `Down` only if that keeps `Down` working; otherwise leave the original migration text alone (it is history).

- [ ] **Step 5: Postgres**

Same shape with `date_trunc`:

```sql
SELECT date_trunc($1, created_at AT TIME ZONE 'UTC') AS bucket, ...
```

where `$1` is `hour`, `day` or `month` from the switch. Scan `bucket` into `time.Time` and set `.UTC()` on it (the column is `timestamp without time zone` after `AT TIME ZONE`, so treat it as UTC with `time.Date(...)` of its fields if pgx returns a local zone). Use `s.db.Query(ctx, sql, args...)`. Add migration `20260930000002` to both the group and `migrationSQL`: `DROP TABLE IF EXISTS keysmith_usage_agg`.

- [ ] **Step 6: Mongo**

```go
unit := map[string]string{usage.PeriodHourly: "hour", usage.PeriodDaily: "day", usage.PeriodMonthly: "month"}[filter.Period]
if unit == "" {
	return nil, usage.ErrInvalidPeriod
}
match := bson.M{}
// tenant_id, key_id, created_at {$gte, $lt} as the filter says
groupID := bson.M{"bucket": bson.M{"$dateTrunc": bson.M{"date": "$created_at", "unit": unit, "timezone": "UTC"}}, "tenant_id": "$tenant_id"}
if filter.KeyID != nil {
	groupID["key_id"] = "$key_id"
}
var rows []struct {
	ID struct {
		Bucket   time.Time `bson:"bucket"`
		TenantID string    `bson:"tenant_id"`
		KeyID    string    `bson:"key_id"`
	} `bson:"_id"`
	Requests     int64 `bson:"requests"`
	Errors       int64 `bson:"errors"`
	ServerErrors int64 `bson:"server_errors"`
	Latency      int64 `bson:"latency"`
}
err := s.mdb.NewAggregate(colUsage).
	Match(match).
	Group(bson.M{
		"_id":           groupID,
		"requests":      bson.M{"$sum": 1},
		"errors":        bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$gte": bson.A{"$status_code", 400}}, 1, 0}}},
		"server_errors": bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$gte": bson.A{"$status_code", 500}}, 1, 0}}},
		"latency":       bson.M{"$sum": "$latency_ms"},
	}).
	Sort(bson.D{{Key: "_id.bucket", Value: 1}}).
	Scan(ctx, &rows)
```

Remove `colUsageAgg` from `migrationIndexes()`, and add a migration `20260930000002` that drops the `keysmith_usage_agg` collection (`mexec.DropCollection(ctx, (*usageAggModel)(nil))` needs the model, so keep `usageAggModel` declared solely for that drop, with a comment saying why).

- [ ] **Step 7: REST response**

`AggregationResponse` gains `ServerErrorCount int64 \`json:"server_error_count"\``; `P50Latency` and `P99Latency` become `*int64 \`json:"...,omitempty"\``. Map them in `toAggregationResponse`. In `api/usage_handler.go`, when `req.Period` is empty default it to `usage.PeriodDaily`, and map `usage.ErrInvalidPeriod` to `forge.BadRequest`.

- [ ] **Step 8: Run the tests**

Run: `go test ./... && make test-backends`. Expected: PASS on all four.

- [ ] **Step 9: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add internal/storetest/usage_test.go
git commit --only -m "fix(usage): aggregate from recorded usage instead of an unwritten table" -- usage/usage.go store/memory/store.go store/sqlite/usage.go store/sqlite/models.go store/sqlite/migrations.go store/postgres/usage.go store/postgres/models.go store/postgres/migrations.go store/mongo/usage.go store/mongo/models.go store/mongo/migrations.go store/mongo/store.go api/responses.go api/usage_handler.go internal/storetest/usage_test.go
git show --stat HEAD
```

Body: nothing ever wrote `keysmith_usage_agg`, so `Aggregate` and the REST `/usage` endpoints returned nothing. Percentiles are now always empty because the backends cannot agree on one. Memory's `Before` was inclusive while SQL's was exclusive; now all four agree.

---

### Task 8: Report whether a rate limiter is configured, then verify everything

**Files:**
- Modify: `engine.go`
- Modify: `engine_state_test.go`

**Interfaces:**
- Produces: `func (e *Engine) RateLimiterConfigured() bool`.

- [ ] **Step 1: Write the failing test**

```go
type allowAll struct{}

func (allowAll) Allow(context.Context, string, int, time.Duration) (bool, error)    { return true, nil }
func (allowAll) Remaining(context.Context, string, int, time.Duration) (int, error) { return 0, nil }

func TestRateLimiterConfigured(t *testing.T) {
	without, err := keysmith.NewEngine(keysmith.WithStore(memory.New()))
	require.NoError(t, err)
	assert.False(t, without.RateLimiterConfigured())
	with, err := keysmith.NewEngine(keysmith.WithStore(memory.New()), keysmith.WithRateLimiter(allowAll{}))
	require.NoError(t, err)
	assert.True(t, with.RateLimiterConfigured())
}
```

Run: `go test -run TestRateLimiterConfigured .`. Expected: FAIL, undefined method.

- [ ] **Step 2: Implement**

```go
// RateLimiterConfigured reports whether a RateLimiter was injected. Without
// one, a policy's RateLimit is stored and never enforced.
func (e *Engine) RateLimiterConfigured() bool { return e.ratelimiter != nil }
```

- [ ] **Step 3: Verify the whole slice**

Run, in order, and read every line of output:

```bash
go build ./...
go test -count=1 ./...
make test-backends
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
go vet ./...
```

Expected: all green. Re-run the probe from the spec's findings as a regression check: revoke, suspend, reactivate leaves the key revoked; the old key validates after a rotation with grace; `Aggregate` returns rows.

- [ ] **Step 4: Commit**

```bash
git commit --only -m "feat(engine): report whether a rate limiter is configured" -- engine.go engine_state_test.go
git show --stat HEAD
```

- [ ] **Step 5: Report**

Tell Rex, with the evidence: which commits landed, the four-backend test output, and that the sqlite fix does not repair rows written before Task 1. Then write plan 2 (contract spine) against the real signatures from this plan.
