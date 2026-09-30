# Sentinel library, phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Sentinel library do what its API claims, so a dashboard built on it in phase 2 reports numbers the library actually computed and persisted.

**Architecture:** Every change lands in `/Users/rexraphael/Work/xraph/forgery/sentinel`. Store changes are proven by one conformance suite (`store/storetest`) that all four backends run: memory and sqlite under a plain `go test`, postgres and mongo under `-tags integration` with testcontainers. Engine changes are proven on the memory store with `target.FromFunc` and `scorer.FromFunc`, under `-race`.

**Tech Stack:** Go 1.26, grove v1.6.3 (pg, sqlite, mongo drivers), testcontainers-go v0.44.0, pgx v5.10.0.

**Spec:** `docs/superpowers/specs/2026-09-30-sentinel-dashboard-design.md` in forge-dashboard (committed `186b686`). Read its sections "What the investigation found", "Decisions" and "The Go half" before starting.

## Global Constraints

- Work on `main` in the sentinel repo. No worktrees.
- Commit only your own paths: `git add <new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD` to check. Never `git add -A`, `git add .`, or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. To undo, back up and restore a single file.
- Leave the untracked `_project_files/` alone.
- Commit messages: no `Co-Authored-By` trailer, no Claude attribution of any kind, no em dashes.
- Lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- `regression_threshold` default is `0.05`. The pass threshold default stays `0.7`.
- Run settings are recorded in `Run.Config` as flat keys: `pass_threshold`, `regression_threshold`, `concurrency`, `target`, `scorers`, `model`, `prompt_version_id`. Never nest maps there (mongo decodes nested maps as `bson.D`).
- The templ dashboard (`dashboard/`) is untouched in this phase. It must still compile.
- The forge version bump is phase 2, not this phase.

## Review Focus

1. A leakage attack generated for a suite with no system prompt. The `not_contains` scorer falls back to `Expected` when its substring is empty, so the case would check the wrong thing. Expect a refusal naming the missing prompt. Test in Task 16.
2. A cancel that lands after the last case finished but before the run is finalised. Expect the run to stay `cancelled`, with full counters. Test in Task 8.
3. Two prompt versions created for one suite at the same moment. Expect two distinct version numbers and no error. Test in Task 6.
4. A result the store fails to write. Expect the run to end `failed` with "1 of 3 results could not be stored", never `completed`. Test in Task 13.
5. The engine stopping while a run is mid-flight. Expect the run to end `cancelled`, not `completed` and not stuck in `running`. Test in Task 13.

---

### Task 1: Conformance harness, and the postgres nil-jsonb check

**Files:**
- Create: `store/storetest/storetest.go`
- Create: `store/storetest/fixtures.go`
- Create: `store/storetest/jsonfields.go`
- Create: `store/memory/conformance_test.go`
- Create: `store/sqlite/conformance_test.go`
- Create: `store/postgres/conformance_integration_test.go`
- Create: `store/mongo/conformance_integration_test.go`
- Modify: `go.mod`, `go.sum` (testcontainers, pgx as test dependencies)
- Modify, only if Step 6 fails on postgres: `store/postgres/models.go`

**Interfaces:**
- Produces: `storetest.Run(t *testing.T, newStore storetest.Factory)` where `type Factory func(t *testing.T) store.Store`. Later tasks add subtests to `Run`.
- Produces fixture helpers used by every later storetest file: `mustSuite(t, s, appID string) *suite.Suite`, `mustCase(t, s, suiteID id.SuiteID) *testcase.Case`, `mustRun(t, s, suiteID id.SuiteID, appID string) *evalrun.Run`, `mustResult(t, s, runID id.EvalRunID, caseID id.CaseID, status evalrun.ResultStatus, score float64) *evalrun.Result`, `bg() context.Context`.

- [ ] **Step 1: Write the suite entry point**

`store/storetest/storetest.go`:

```go
// Package storetest is the conformance suite every Sentinel store backend
// runs. One set of assertions, four backends: a behaviour that differs
// between backends shows up here as a failure on the odd one out, not as a
// dashboard that works on sqlite and lies on mongo.
//
// Memory and sqlite run it under a plain `go test ./...`. Postgres and mongo
// run it under `go test -tags integration ./store/...`, against
// testcontainers, or against SENTINEL_TEST_DSN / SENTINEL_TEST_MONGO_URI
// when those are set.
package storetest

import (
	"testing"

	"github.com/xraph/sentinel/store"
)

// Factory returns a fresh, migrated, empty store for one subtest.
type Factory func(t *testing.T) store.Store

// Run executes every conformance check against the backend newStore builds.
func Run(t *testing.T, newStore Factory) {
	t.Run("JSONFieldsRoundTrip", func(t *testing.T) { testJSONFieldsRoundTrip(t, newStore(t)) })
}
```

- [ ] **Step 2: Write the fixtures**

`store/storetest/fixtures.go`:

```go
package storetest

import (
	"context"
	"testing"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/store"
	"github.com/xraph/sentinel/suite"
	"github.com/xraph/sentinel/testcase"
)

func bg() context.Context { return context.Background() }

// The fixtures populate every map and slice with an empty value, so a test
// that is not about nil handling never trips over it.

func mustSuite(t *testing.T, s store.Store, appID string) *suite.Suite {
	t.Helper()
	su := &suite.Suite{
		Entity:   sentinel.NewEntity(),
		ID:       id.NewSuiteID(),
		Name:     "suite-" + id.NewSuiteID().String(),
		AppID:    appID,
		Model:    "test-model",
		Metadata: map[string]any{},
	}
	if err := s.CreateSuite(bg(), su); err != nil {
		t.Fatalf("create suite: %v", err)
	}
	return su
}

func mustCase(t *testing.T, s store.Store, suiteID id.SuiteID) *testcase.Case {
	t.Helper()
	tc := &testcase.Case{
		Entity:       sentinel.NewEntity(),
		ID:           id.NewCaseID(),
		SuiteID:      suiteID,
		Name:         "case-" + id.NewCaseID().String(),
		Input:        "hello",
		ScenarioType: testcase.ScenarioStandard,
		Scorers:      []testcase.ScorerConfig{},
		Tags:         []string{},
		Context:      map[string]any{},
		Metadata:     map[string]any{},
	}
	if err := s.CreateCase(bg(), tc); err != nil {
		t.Fatalf("create case: %v", err)
	}
	return tc
}

func mustRun(t *testing.T, s store.Store, suiteID id.SuiteID, appID string) *evalrun.Run {
	t.Helper()
	r := &evalrun.Run{
		Entity:          sentinel.NewEntity(),
		ID:              id.NewEvalRunID(),
		SuiteID:         suiteID,
		Model:           "test-model",
		TotalCases:      3,
		AppID:           appID,
		Config:          map[string]any{},
		State:           evalrun.StateRunning,
		DimensionScores: map[string]float64{},
	}
	if err := s.CreateRun(bg(), r); err != nil {
		t.Fatalf("create run: %v", err)
	}
	return r
}

func mustResult(t *testing.T, s store.Store, runID id.EvalRunID, caseID id.CaseID, status evalrun.ResultStatus, score float64) *evalrun.Result {
	t.Helper()
	r := &evalrun.Result{
		Entity:          sentinel.NewEntity(),
		ID:              id.NewEvalResultID(),
		RunID:           runID,
		CaseID:          caseID,
		CaseName:        "case",
		Status:          status,
		Score:           score,
		ScorerResults:   []evalrun.ScorerResult{},
		DimensionScores: map[string]float64{},
	}
	if err := s.CreateResult(bg(), r); err != nil {
		t.Fatalf("create result: %v", err)
	}
	return r
}
```

- [ ] **Step 3: Write the jsonb round-trip check**

`store/storetest/jsonfields.go`. It writes each JSON-ish field twice: nil, the way the engine writes it today, and populated, the way the dashboard will. Both must round-trip.

```go
package storetest

import (
	"math"
	"testing"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/baseline"
	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/store"
	"github.com/xraph/sentinel/suite"
	"github.com/xraph/sentinel/testcase"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-5 }

func testJSONFieldsRoundTrip(t *testing.T, s store.Store) {
	// Nil everywhere: what the engine writes today for a run it has just
	// started, a result whose target call failed, and an imported case.
	nilSuite := &suite.Suite{Entity: sentinel.NewEntity(), ID: id.NewSuiteID(), Name: "nil-suite", AppID: "app_a"}
	if err := s.CreateSuite(bg(), nilSuite); err != nil {
		t.Fatalf("create suite with nil metadata: %v", err)
	}
	nilCase := &testcase.Case{Entity: sentinel.NewEntity(), ID: id.NewCaseID(), SuiteID: nilSuite.ID, Name: "nil-case", Input: "x", ScenarioType: testcase.ScenarioStandard}
	if err := s.CreateCase(bg(), nilCase); err != nil {
		t.Fatalf("create case with nil tags, scorers, context, metadata: %v", err)
	}
	nilRun := &evalrun.Run{Entity: sentinel.NewEntity(), ID: id.NewEvalRunID(), SuiteID: nilSuite.ID, Model: "m", AppID: "app_a", State: evalrun.StateRunning}
	if err := s.CreateRun(bg(), nilRun); err != nil {
		t.Fatalf("create run with nil config and dimension scores: %v", err)
	}
	nilResult := &evalrun.Result{Entity: sentinel.NewEntity(), ID: id.NewEvalResultID(), RunID: nilRun.ID, CaseID: nilCase.ID, CaseName: "nil-case", Status: evalrun.StatusError, Error: "target failed"}
	if err := s.CreateResult(bg(), nilResult); err != nil {
		t.Fatalf("create result with nil scorer results and dimension scores: %v", err)
	}
	nilBaseline := &baseline.Baseline{ID: id.NewBaselineID(), SuiteID: nilSuite.ID, RunID: nilRun.ID, Name: "nil-baseline"}
	if err := s.SaveBaseline(bg(), nilBaseline); err != nil {
		t.Fatalf("save baseline with nil results and dimension scores: %v", err)
	}
	if _, err := s.GetRun(bg(), nilRun.ID); err != nil {
		t.Fatalf("read back nil run: %v", err)
	}

	// Populated: what the dashboard's writes and the new run settings put there.
	su := mustSuite(t, s, "app_a")
	tc := &testcase.Case{
		Entity: sentinel.NewEntity(), ID: id.NewCaseID(), SuiteID: su.ID, Name: "full", Input: "in",
		ScenarioType: testcase.ScenarioTraitProbe,
		Scorers:      []testcase.ScorerConfig{{Name: "contains", Config: map[string]any{"substring": "x"}}},
		Tags:         []string{"redteam", "leakage"},
		Context:      map[string]any{"attack_type": "leakage"},
		Metadata:     map[string]any{"owner": "qa"},
	}
	if err := s.CreateCase(bg(), tc); err != nil {
		t.Fatalf("create populated case: %v", err)
	}
	gotCase, err := s.GetCase(bg(), tc.ID)
	if err != nil {
		t.Fatalf("get case: %v", err)
	}
	if len(gotCase.Scorers) != 1 || gotCase.Scorers[0].Name != "contains" || gotCase.Scorers[0].Config["substring"] != "x" {
		t.Errorf("case scorers did not round-trip: %+v", gotCase.Scorers)
	}
	if len(gotCase.Tags) != 2 || gotCase.Tags[1] != "leakage" {
		t.Errorf("case tags did not round-trip: %v", gotCase.Tags)
	}
	if gotCase.Context["attack_type"] != "leakage" || gotCase.Metadata["owner"] != "qa" {
		t.Errorf("case context or metadata did not round-trip: %v %v", gotCase.Context, gotCase.Metadata)
	}

	run := &evalrun.Run{
		Entity: sentinel.NewEntity(), ID: id.NewEvalRunID(), SuiteID: su.ID, Model: "m", AppID: "app_a",
		State:           evalrun.StateRunning,
		Config:          map[string]any{"target": "llm:x", "scorers": []any{"exact", "contains"}, "pass_threshold": 0.7},
		DimensionScores: map[string]float64{"skill": 0.25},
	}
	if err := s.CreateRun(bg(), run); err != nil {
		t.Fatalf("create populated run: %v", err)
	}
	gotRun, err := s.GetRun(bg(), run.ID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if gotRun.Config["target"] != "llm:x" {
		t.Errorf("run config target did not round-trip: %v", gotRun.Config)
	}
	if !near(gotRun.DimensionScores["skill"], 0.25) {
		t.Errorf("run dimension scores did not round-trip: %v", gotRun.DimensionScores)
	}

	res := &evalrun.Result{
		Entity: sentinel.NewEntity(), ID: id.NewEvalResultID(), RunID: run.ID, CaseID: tc.ID, CaseName: "full",
		Status: evalrun.StatusPass, Score: 0.9, Output: "out",
		ScorerResults:   []evalrun.ScorerResult{{ScorerName: "exact", Score: 1, Passed: true, Reason: "match", Dimension: "skill"}},
		DimensionScores: map[string]float64{"skill": 0.5},
		RunTrace:        &evalrun.RunTrace{Steps: []evalrun.StepTrace{{Index: 0, Type: "plan", Output: "p"}}},
	}
	if err := s.CreateResult(bg(), res); err != nil {
		t.Fatalf("create populated result: %v", err)
	}
	results, err := s.ListResults(bg(), run.ID)
	if err != nil || len(results) != 1 {
		t.Fatalf("list results: %v (%d)", err, len(results))
	}
	got := results[0]
	if len(got.ScorerResults) != 1 || got.ScorerResults[0].Reason != "match" || got.ScorerResults[0].Dimension != "skill" {
		t.Errorf("scorer results did not round-trip: %+v", got.ScorerResults)
	}
	if got.RunTrace == nil || len(got.RunTrace.Steps) != 1 || got.RunTrace.Steps[0].Type != "plan" {
		t.Errorf("run trace did not round-trip: %+v", got.RunTrace)
	}

	b := &baseline.Baseline{
		ID: id.NewBaselineID(), SuiteID: su.ID, RunID: run.ID, Name: "full", PassRate: 0.5, AvgScore: 0.5,
		Results:         []baseline.Result{{CaseID: tc.ID, CaseName: "full", Score: 0.9, Status: "pass", DimensionScores: map[string]float64{"skill": 0.5}}},
		DimensionScores: map[string]float64{"skill": 0.5},
		IsCurrent:       true,
	}
	if err := s.SaveBaseline(bg(), b); err != nil {
		t.Fatalf("save populated baseline: %v", err)
	}
	gotB, err := s.GetBaseline(bg(), b.ID)
	if err != nil {
		t.Fatalf("get baseline: %v", err)
	}
	if len(gotB.Results) != 1 || gotB.Results[0].CaseID.String() != tc.ID.String() || !near(gotB.DimensionScores["skill"], 0.5) {
		t.Errorf("baseline did not round-trip: %+v", gotB)
	}
}
```

- [ ] **Step 4: Wire memory and sqlite**

`store/memory/conformance_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/sentinel/store"
	"github.com/xraph/sentinel/store/memory"
	"github.com/xraph/sentinel/store/storetest"
)

func TestConformance(t *testing.T) {
	storetest.Run(t, func(*testing.T) store.Store { return memory.New() })
}
```

`store/sqlite/conformance_test.go`:

```go
package sqlite_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"

	"github.com/xraph/sentinel/store"
	sentinelsqlite "github.com/xraph/sentinel/store/sqlite"
	"github.com/xraph/sentinel/store/storetest"
)

// SQLite here is pure Go (modernc.org/sqlite), so this runs under a plain
// `go test ./...` with no external service.
func TestConformance(t *testing.T) {
	storetest.Run(t, func(t *testing.T) store.Store {
		t.Helper()
		sdb := sqlitedriver.New()
		if err := sdb.Open(context.Background(), filepath.Join(t.TempDir(), "sentinel.db")); err != nil {
			t.Fatalf("open sqlite: %v", err)
		}
		db, err := grove.Open(sdb)
		if err != nil {
			t.Fatalf("grove open: %v", err)
		}
		t.Cleanup(func() { _ = db.Close() })
		s := sentinelsqlite.New(db)
		if err := s.Migrate(context.Background()); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		return s
	})
}
```

- [ ] **Step 5: Wire postgres and mongo behind the integration tag**

`store/postgres/conformance_integration_test.go`:

```go
//go:build integration

package postgres_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/pgdriver"
	_ "github.com/xraph/grove/drivers/pgdriver/pgmigrate"

	"github.com/xraph/sentinel/store"
	sentinelpg "github.com/xraph/sentinel/store/postgres"
	"github.com/xraph/sentinel/store/storetest"
)

var (
	pgOnce sync.Once
	pgDSN  string
	pgErr  error
)

// adminDSN is SENTINEL_TEST_DSN when set, otherwise a shared
// postgres:16-alpine container started on first use.
func adminDSN(t *testing.T) string {
	t.Helper()
	if dsn := os.Getenv("SENTINEL_TEST_DSN"); dsn != "" {
		return dsn
	}
	pgOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		c, err := tcpostgres.Run(ctx, "postgres:16-alpine",
			tcpostgres.WithDatabase("sentinel_admin"),
			tcpostgres.WithUsername("sentinel"),
			tcpostgres.WithPassword("sentinel"),
			tcpostgres.BasicWaitStrategies(),
		)
		if err != nil {
			pgErr = fmt.Errorf("start postgres container: %w", err)
			return
		}
		pgDSN, pgErr = c.ConnectionString(ctx, "sslmode=disable")
	})
	if pgErr != nil {
		t.Skipf("postgres unavailable: %v", pgErr)
	}
	return pgDSN
}

func TestConformance(t *testing.T) {
	storetest.Run(t, func(t *testing.T) store.Store {
		t.Helper()
		admin := adminDSN(t)
		var rnd [4]byte
		_, _ = rand.Read(rnd[:])
		name := "sentinel_test_" + hex.EncodeToString(rnd[:])
		ctx := context.Background()

		conn, err := pgx.Connect(ctx, admin)
		if err != nil {
			t.Fatalf("admin connect: %v", err)
		}
		if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
			t.Fatalf("create database: %v", err)
		}
		_ = conn.Close(ctx)

		u, err := url.Parse(admin)
		if err != nil {
			t.Fatalf("parse dsn: %v", err)
		}
		u.Path = "/" + name
		drv := pgdriver.New()
		if err := drv.Open(ctx, u.String()); err != nil {
			t.Fatalf("open postgres: %v", err)
		}
		db, err := grove.Open(drv)
		if err != nil {
			t.Fatalf("grove open: %v", err)
		}
		t.Cleanup(func() {
			_ = drv.Close()
			c, err := pgx.Connect(context.Background(), admin)
			if err == nil {
				_, _ = c.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
				_ = c.Close(context.Background())
			}
		})
		s := sentinelpg.New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		return s
	})
}
```

`store/mongo/conformance_integration_test.go`:

```go
//go:build integration

package mongo_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/mongodriver"

	"github.com/xraph/sentinel/store"
	sentinelmongo "github.com/xraph/sentinel/store/mongo"
	"github.com/xraph/sentinel/store/storetest"
)

var (
	mongoOnce sync.Once
	mongoURI  string
	mongoErr  error
)

func connURI(t *testing.T) string {
	t.Helper()
	if uri := os.Getenv("SENTINEL_TEST_MONGO_URI"); uri != "" {
		return uri
	}
	mongoOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		c, err := tcmongo.Run(ctx, "mongo:7")
		if err != nil {
			mongoErr = fmt.Errorf("start mongo container: %w", err)
			return
		}
		mongoURI, mongoErr = c.ConnectionString(ctx)
	})
	if mongoErr != nil {
		t.Skipf("mongo unavailable: %v", mongoErr)
	}
	return mongoURI
}

func TestConformance(t *testing.T) {
	storetest.Run(t, func(t *testing.T) store.Store {
		t.Helper()
		var rnd [4]byte
		_, _ = rand.Read(rnd[:])
		ctx := context.Background()
		drv := mongodriver.New()
		if err := drv.Open(ctx, connURI(t), mongodriver.WithDatabase("sentinel_test_"+hex.EncodeToString(rnd[:]))); err != nil {
			t.Fatalf("open mongo: %v", err)
		}
		db, err := grove.Open(drv)
		if err != nil {
			t.Fatalf("grove open: %v", err)
		}
		t.Cleanup(func() {
			_ = drv.Database().Drop(context.Background())
			_ = drv.Close()
		})
		s := sentinelmongo.New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		return s
	})
}
```

Add the test dependencies:

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
go get github.com/testcontainers/testcontainers-go/modules/postgres@v0.44.0 github.com/testcontainers/testcontainers-go/modules/mongodb@v0.44.0 github.com/jackc/pgx/v5@v5.10.0
go mod tidy
```

- [ ] **Step 6: Run the check on all four backends**

Run: `go test ./store/... && go test -tags integration ./store/postgres/ ./store/mongo/ -run TestConformance -v`

Expected: memory, sqlite and mongo PASS. The spec records an unverified claim that postgres FAILS here with a not-null violation on `CreateRun` (pgx encodes a nil map as SQL NULL into a `NOT NULL` jsonb column). Note which result you get in the task report, with the exact error text. If postgres passes, skip Step 7 and say the claim was wrong.

- [ ] **Step 7 (only if postgres failed): Normalise nil JSON fields on the way into postgres**

In `store/postgres/models.go`, add:

```go
// nonNilMap and nonNilSlice turn a nil map or slice into an empty one. pgx
// encodes nil as SQL NULL, and these jsonb columns are NOT NULL, so without
// this every run the engine starts and every failed result is rejected.
func nonNilMap[V any](m map[string]V) map[string]V {
	if m == nil {
		return map[string]V{}
	}
	return m
}

func nonNilSlice[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
```

Then wrap each of these assignments in the `*ToModel` functions: `suiteToModel` Metadata; `caseToModel` Scorers, Tags, Context, Metadata; `runToModel` Config, DimensionScores; `resultToModel` ScorerResults, DimensionScores; `baselineToModel` Results, DimensionScores. For example, `Config: r.Config,` becomes `Config: nonNilMap(r.Config),`.

Re-run Step 6. Expected: all four PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
git add store/storetest/storetest.go store/storetest/fixtures.go store/storetest/jsonfields.go store/memory/conformance_test.go store/sqlite/conformance_test.go store/postgres/conformance_integration_test.go store/mongo/conformance_integration_test.go
git commit --only -m "test(store): add a conformance suite all four backends run

Sentinel had no store tests at all. This adds one suite of assertions
that memory and sqlite run under plain go test, and postgres and mongo
run under -tags integration against testcontainers. The first check
round-trips every JSON field, nil and populated." -- store/storetest/storetest.go store/storetest/fixtures.go store/storetest/jsonfields.go store/memory/conformance_test.go store/sqlite/conformance_test.go store/postgres/conformance_integration_test.go store/mongo/conformance_integration_test.go go.mod go.sum
git show --stat HEAD
```

If Step 7 ran, commit `store/postgres/models.go` separately with `fix(postgres): write empty JSON for nil maps and slices` and a body quoting the not-null error Step 6 produced.

---

### Task 2: Memory store returns copies

The memory store hands back its internal pointers. Any caller that mutates a returned run changes the stored row, and in Task 13 the runner reads a run's state while `CancelRun` writes it, which is a data race under `-race`.

**Files:**
- Modify: `store/memory/store.go`
- Create: `store/storetest/isolation.go`
- Modify: `store/storetest/storetest.go`

**Interfaces:**
- Consumes: fixtures from Task 1.
- Produces: every memory `Get*`/`List*` returns a shallow copy; every `Create*`/`Save*` stores a shallow copy after setting timestamps on the caller's value.

- [ ] **Step 1: Write the failing check**

`store/storetest/isolation.go`:

```go
package storetest

import (
	"testing"

	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/store"
)

// A value read from the store is the caller's to change. Mutating it must
// not change what the store holds, which is trivially true for the SQL and
// document backends and was false for memory.
func testReturnedValuesAreIndependent(t *testing.T, s store.Store) {
	su := mustSuite(t, s, "app_a")
	run := mustRun(t, s, su.ID, "app_a")

	run.State = evalrun.StateFailed // the caller's own value after CreateRun
	got, err := s.GetRun(bg(), run.ID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if got.State != evalrun.StateRunning {
		t.Fatalf("mutating the value passed to CreateRun changed the store: %s", got.State)
	}

	got.State = evalrun.StateCancelled
	again, err := s.GetRun(bg(), run.ID)
	if err != nil {
		t.Fatalf("get run again: %v", err)
	}
	if again.State != evalrun.StateRunning {
		t.Fatalf("mutating a returned run changed the store: %s", again.State)
	}

	listed, err := s.ListRuns(bg(), &evalrun.ListFilter{SuiteID: su.ID})
	if err != nil || len(listed) != 1 {
		t.Fatalf("list runs: %v (%d)", err, len(listed))
	}
	listed[0].Model = "changed"
	again, _ = s.GetRun(bg(), run.ID)
	if again.Model != "test-model" {
		t.Fatalf("mutating a listed run changed the store: %s", again.Model)
	}
}
```

Add to `Run` in `storetest.go`:

```go
	t.Run("ReturnedValuesAreIndependent", func(t *testing.T) { testReturnedValuesAreIndependent(t, newStore(t)) })
```

- [ ] **Step 2: Run it to verify it fails on memory only**

Run: `go test ./store/... -run TestConformance/ReturnedValuesAreIndependent -v`
Expected: memory FAIL ("mutating the value passed to CreateRun changed the store"), sqlite PASS.

- [ ] **Step 3: Copy on the way in and out**

In `store/memory/store.go`, add after the `Store` type:

```go
// The memory store copies values across its boundary, the way every other
// backend does by construction. Copies are shallow: maps and slices inside
// are shared, which is fine because nothing in Sentinel mutates them in
// place after writing.
func cloneSuite(v *suite.Suite) *suite.Suite                   { c := *v; return &c }
func cloneCase(v *testcase.Case) *testcase.Case                { c := *v; return &c }
func cloneRun(v *evalrun.Run) *evalrun.Run                     { c := *v; return &c }
func cloneResult(v *evalrun.Result) *evalrun.Result            { c := *v; return &c }
func cloneBaseline(v *baseline.Baseline) *baseline.Baseline    { c := *v; return &c }
func clonePV(v *promptversion.PromptVersion) *promptversion.PromptVersion { c := *v; return &c }
```

Then apply them at every boundary:
- `CreateSuite`, `UpdateSuite`: `s.suites[key] = cloneSuite(su)`.
- `GetSuite`, `GetSuiteByName`: `return cloneSuite(su), nil`.
- `ListSuites`: `result = append(result, cloneSuite(su))`.
- `CreateCase`, `CreateCaseBatch`, `UpdateCase`: store `cloneCase(tc)`. `GetCase`: return `cloneCase(tc)`. `ListCases`: append `cloneCase(tc)`.
- `CreateRun`, `UpdateRun`: store `cloneRun(run)`. `GetRun`: return `cloneRun(run)`. `ListRuns`, `ListRunsBySuite`: append `cloneRun(run)`.
- `CreateResult`, `CreateResultBatch`: store `cloneResult(r)`. `ListResults`: append `cloneResult(r)`.
- `SaveBaseline`: store `cloneBaseline(b)`. `GetBaseline`, `GetLatestBaseline`: return `cloneBaseline(b)`. `ListBaselines`: append `cloneBaseline(b)`.
- `CreatePromptVersion`: store `clonePV(pv)`. `GetPromptVersion`, `GetCurrentPromptVersion`: return `clonePV(pv)`. `ListPromptVersions`: append `clonePV(pv)`.

`SaveBaseline` and `SetCurrentPromptVersion` mutate stored values under the write lock, which stays correct.

- [ ] **Step 4: Run the whole suite, including the race detector**

Run: `go test -race ./store/...`
Expected: PASS on memory and sqlite.

- [ ] **Step 5: Commit**

```bash
git add store/storetest/isolation.go
git commit --only -m "fix(memory): copy values across the store boundary

The memory store returned its own pointers, so a caller that changed a
run it had read changed the stored row too. Every other backend copies
by construction; memory now does the same." -- store/memory/store.go store/storetest/isolation.go store/storetest/storetest.go
git show --stat HEAD
```

---

### Task 3: The engine receives the extension's config

**Files:**
- Modify: `config.go` (package `sentinel`)
- Modify: `extension/config.go`
- Modify: `extension/extension.go`
- Create: `extension/config_test.go`

**Interfaces:**
- Produces: `sentinel.Config.RegressionThreshold float64` (default `0.05`); `extension.Config.RegressionThreshold float64` (`regression_threshold`); `func engineConfig(c Config) sentinel.Config`; `func (e *Extension) newEngine(logger log.Logger) (*engine.Engine, error)`.

- [ ] **Step 1: Write the failing test**

`extension/config_test.go`:

```go
package extension

import (
	"testing"
	"time"
)

func TestEngineReceivesConfiguredValues(t *testing.T) {
	e := New(WithConfig(Config{PassThreshold: 0.9, Concurrency: 2, DefaultModel: "fast", RegressionThreshold: 0.1}))
	e.config = e.mergeWithDefaults(e.config)

	eng, err := e.newEngine(nil)
	if err != nil {
		t.Fatalf("newEngine: %v", err)
	}
	got := eng.Config()
	if got.PassThreshold != 0.9 || got.Concurrency != 2 || got.DefaultModel != "fast" || got.RegressionThreshold != 0.1 {
		t.Fatalf("engine did not receive the configured values: %+v", got)
	}
}

func TestRegressionThresholdDefaults(t *testing.T) {
	e := New()
	e.config = e.mergeWithDefaults(e.config)
	if got := engineConfig(e.config); got.RegressionThreshold != 0.05 || got.PassThreshold != 0.7 || got.ShutdownTimeout != 30*time.Second {
		t.Fatalf("defaults: %+v", got)
	}
}

func TestYAMLRegressionThresholdWins(t *testing.T) {
	e := New(WithConfig(Config{RegressionThreshold: 0.2}))
	merged := e.mergeConfigurations(Config{RegressionThreshold: 0.1}, e.config)
	if merged.RegressionThreshold != 0.1 {
		t.Fatalf("yaml should win: %v", merged.RegressionThreshold)
	}
	merged = e.mergeConfigurations(Config{}, e.config)
	if merged.RegressionThreshold != 0.2 {
		t.Fatalf("programmatic should fill a gap: %v", merged.RegressionThreshold)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./extension/ -run 'TestEngineReceives|TestRegression|TestYAML' -v`
Expected: FAIL to compile (`RegressionThreshold` and `newEngine` undefined).

- [ ] **Step 3: Implement**

In `config.go`, add to `Config`:

```go
	// RegressionThreshold is how far a metric may fall below the current
	// baseline, as an absolute amount on its 0 to 1 scale, before a run
	// counts as regressed. One value covers pass rate, average score, each
	// dimension and each case, and lower is always worse.
	RegressionThreshold float64
```

and `RegressionThreshold: 0.05,` in `DefaultConfig()`.

In `extension/config.go`, add to `Config`:

```go
	// RegressionThreshold is how far below the current baseline a metric
	// may fall before a run counts as regressed. Default 0.05.
	RegressionThreshold float64 `json:"regression_threshold" mapstructure:"regression_threshold" yaml:"regression_threshold"`
```

and `RegressionThreshold: 0.05,` in `DefaultConfig()`.

In `extension/extension.go`, add to `mergeConfigurations` after the `PassThreshold` block:

```go
	if yamlConfig.RegressionThreshold == 0 {
		if programmaticConfig.RegressionThreshold != 0 {
			yamlConfig.RegressionThreshold = programmaticConfig.RegressionThreshold
		} else {
			yamlConfig.RegressionThreshold = defaults.RegressionThreshold
		}
	}
```

and to `mergeWithDefaults` after the `PassThreshold` line:

```go
	if programmatic.RegressionThreshold != 0 {
		result.RegressionThreshold = programmatic.RegressionThreshold
	}
```

Add below `buildStoreFromGroveDB`:

```go
// engineConfig is the engine's view of the merged extension config. Before
// this existed the engine was built without it, so every deployment scored
// at the defaults whatever it had configured.
func engineConfig(c Config) sentinel.Config {
	return sentinel.Config{
		DefaultModel:        c.DefaultModel,
		Temperature:         c.Temperature,
		PassThreshold:       c.PassThreshold,
		Concurrency:         c.Concurrency,
		ShutdownTimeout:     c.ShutdownTimeout,
		RegressionThreshold: c.RegressionThreshold,
	}
}

// newEngine builds the engine from the merged config, then the options the
// application passed, so an explicit engine.WithConfig still wins. A nil
// logger leaves the engine's no-op logger in place.
func (e *Extension) newEngine(logger log.Logger) (*engine.Engine, error) {
	opts := make([]engine.Option, 0, len(e.engineOpts)+2)
	opts = append(opts, engine.WithConfig(engineConfig(e.config)))
	opts = append(opts, e.engineOpts...)
	if logger != nil {
		opts = append(opts, engine.WithLogger(logger))
	}
	return engine.New(opts...)
}
```

In `init`, replace the block from `opts := make(...)` through `e.eng = eng` with:

```go
	eng, err := e.newEngine(e.Logger())
	if err != nil {
		return fmt.Errorf("sentinel: create engine: %w", err)
	}
	e.eng = eng
```

Imports to add in `extension.go`: `"github.com/xraph/sentinel"` and `log "github.com/xraph/go-utils/log"`. If `e.Logger()` does not satisfy `log.Logger` directly, the existing `engine.WithLogger(e.Logger())` call proves it does; keep the same expression.

- [ ] **Step 4: Run the tests**

Run: `go test ./extension/ ./... -run 'TestEngineReceives|TestRegression|TestYAML' -v && go build ./...`
Expected: PASS, and the build (including the templ dashboard) succeeds.

- [ ] **Step 5: Commit**

```bash
git add extension/config_test.go
git commit --only -m "fix(extension): pass the merged config to the engine

The extension loaded pass_threshold, concurrency and default_model and
then built the engine without them, so every deployment scored at 0.7.
It also gains regression_threshold, default 0.05." -- config.go extension/config.go extension/extension.go extension/config_test.go
git show --stat HEAD
```

---

### Task 4: Scorers describe themselves

**Files:**
- Modify: `scorer/registry.go`
- Create: `scorer/registry_test.go`

**Interfaces:**
- Produces: `type scorer.Descriptor struct { Name, Description, Dimension string; UsesLLM bool }`; `(*Registry).RegisterDescribed(d Descriptor, f Factory)`; `(*Registry).Descriptors() []Descriptor` (sorted by name); `(*Registry).Has(name string) bool`. `Register(name, f)` keeps working and records a descriptor with the name only.

- [ ] **Step 1: Write the failing test**

`scorer/registry_test.go`:

```go
package scorer

import (
	"context"
	"testing"
)

func TestBuiltinsAreDescribed(t *testing.T) {
	r := NewRegistry()
	ds := r.Descriptors()
	want := []string{"contains", "cost", "exact", "json_schema", "json_valid", "latency", "length", "not_contains", "regex"}
	if len(ds) != len(want) {
		t.Fatalf("got %d descriptors, want %d: %+v", len(ds), len(want), ds)
	}
	for i, d := range ds {
		if d.Name != want[i] {
			t.Errorf("descriptor %d is %q, want %q (sorted by name)", i, d.Name, want[i])
		}
		if d.Description == "" {
			t.Errorf("%s has no description", d.Name)
		}
		if d.UsesLLM {
			t.Errorf("%s is deterministic and must not claim to call an LLM", d.Name)
		}
	}
}

// custom always returned an error from the registry: it can only be built
// with FromFunc. Listing it would offer a scorer that fails every case.
func TestCustomIsNotOffered(t *testing.T) {
	if NewRegistry().Has("custom") {
		t.Fatal("custom must not be registered")
	}
}

func TestRegisterDescribed(t *testing.T) {
	r := NewRegistry()
	r.RegisterDescribed(Descriptor{Name: "judge", Description: "LLM judge", Dimension: "persona", UsesLLM: true},
		func(map[string]any) (Scorer, error) {
			return FromFunc("judge", func(context.Context, *Input) (*Output, error) { return &Output{Score: 1}, nil }), nil
		})
	if !r.Has("judge") {
		t.Fatal("judge not registered")
	}
	s, err := r.Get("judge", nil)
	if err != nil || s.Name() != "judge" {
		t.Fatalf("get judge: %v", err)
	}
	var found bool
	for _, d := range r.Descriptors() {
		if d.Name == "judge" && d.UsesLLM && d.Dimension == "persona" {
			found = true
		}
	}
	if !found {
		t.Fatal("judge descriptor missing")
	}
	if _, err := r.Get("nope", nil); err == nil {
		t.Fatal("unknown scorer should error")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./scorer/ -v`
Expected: FAIL to compile (`Descriptors`, `Has`, `RegisterDescribed`, `Descriptor` undefined).

- [ ] **Step 3: Implement**

In `scorer/registry.go`:

1. Add the type and a field:

```go
// Descriptor says what a registered scorer is, for anyone listing them.
type Descriptor struct {
	Name        string
	Description string
	Dimension   string // the human-like dimension it reports, empty for none
	UsesLLM     bool   // true when scoring makes a model call, which costs money
}
```

Add `descs map[string]Descriptor` to `Registry`, initialise it in `NewRegistry` next to `factories`, and call `r.describeBuiltins()` after `r.registerBuiltins()`.

2. Change `Register` to record a bare descriptor, and add the new methods:

```go
// Register adds a scorer factory by name, with no description.
func (r *Registry) Register(name string, factory Factory) {
	r.RegisterDescribed(Descriptor{Name: name}, factory)
}

// RegisterDescribed adds a scorer factory with a descriptor.
func (r *Registry) RegisterDescribed(d Descriptor, factory Factory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[d.Name] = factory
	r.descs[d.Name] = d
}

// Has reports whether a scorer is registered under name.
func (r *Registry) Has(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.factories[name]
	return ok
}

// Descriptors lists every registered scorer, sorted by name.
func (r *Registry) Descriptors() []Descriptor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Descriptor, 0, len(r.descs))
	for _, d := range r.descs {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
```

Add `"sort"` to the imports.

3. Delete the `r.factories["custom"] = ...` block from `registerBuiltins`.

4. Add the descriptions:

```go
// describeBuiltins records what each built-in does. The text is what an
// operator reads when picking scorers for a run.
func (r *Registry) describeBuiltins() {
	for name, desc := range map[string]string{
		"exact":        "Passes when the output equals the expected value.",
		"contains":     "Passes when the output contains a substring (config: substring, case_insensitive).",
		"not_contains": "Passes when the output does not contain a substring (config: substring, case_insensitive).",
		"regex":        "Passes when the output matches a regular expression (config: pattern).",
		"json_valid":   "Passes when the output is valid JSON.",
		"json_schema":  "Passes when the output is valid JSON. The schema option is not enforced yet.",
		"length":       "Passes when the output's word count is within min and max.",
		"latency":      "Passes when the target answered within max_ms milliseconds.",
		"cost":         "Passes when the target reported a cost at or below max_cost.",
	} {
		r.descs[name] = Descriptor{Name: name, Description: desc}
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./scorer/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scorer/registry_test.go
git commit --only -m "feat(scorer): let registered scorers describe themselves

The registry can now list what it holds, with a description, a
dimension and whether scoring calls a model. custom is gone from the
built-ins because the registry could never construct it." -- scorer/registry.go scorer/registry_test.go
git show --stat HEAD
```

---

### Task 5: Runs record their settings

**Files:**
- Create: `evalrun/settings.go`
- Create: `evalrun/settings_test.go`
- Modify: `evalrun/run.go`

**Interfaces:**
- Produces:
  - `type evalrun.Settings struct { PassThreshold, RegressionThreshold *float64; Concurrency *int; Target string; Scorers []string; Model, PromptVersionID string }`
  - `(Settings).Config() map[string]any`
  - `evalrun.SettingsFrom(config map[string]any) Settings`
  - `type evalrun.Finalization struct { Stats *ResultStats; State RunState; Error string; CompletedAt time.Time }`
  - `(*Run).ApplyStats(st *ResultStats)`

- [ ] **Step 1: Write the failing test**

`evalrun/settings_test.go`:

```go
package evalrun

import (
	"encoding/json"
	"testing"
)

// bsonA stands in for mongo's bson.A, which is a named []any. A plain type
// assertion to []any fails on it.
type bsonA []any

func TestSettingsRoundTrip(t *testing.T) {
	pt, rt, c := 0.7, 0.05, 4
	in := Settings{PassThreshold: &pt, RegressionThreshold: &rt, Concurrency: &c, Target: "llm:x", Scorers: []string{"exact", "contains"}, Model: "m", PromptVersionID: "pv_1"}
	got := SettingsFrom(in.Config())
	if *got.PassThreshold != 0.7 || *got.RegressionThreshold != 0.05 || *got.Concurrency != 4 {
		t.Fatalf("numbers: %+v", got)
	}
	if got.Target != "llm:x" || got.Model != "m" || got.PromptVersionID != "pv_1" || len(got.Scorers) != 2 || got.Scorers[1] != "contains" {
		t.Fatalf("strings: %+v", got)
	}
}

func TestSettingsSurviveEachBackendsDecoding(t *testing.T) {
	var fromJSON map[string]any // sqlite and postgres: numbers come back float64, arrays []any
	_ = json.Unmarshal([]byte(`{"pass_threshold":0.7,"concurrency":4,"scorers":["exact"]}`), &fromJSON)
	fromMongo := map[string]any{"pass_threshold": 0.7, "concurrency": int32(4), "scorers": bsonA{"exact"}}

	for name, cfg := range map[string]map[string]any{"json": fromJSON, "mongo": fromMongo} {
		s := SettingsFrom(cfg)
		if s.PassThreshold == nil || *s.PassThreshold != 0.7 || s.Concurrency == nil || *s.Concurrency != 4 || len(s.Scorers) != 1 {
			t.Errorf("%s: %+v", name, s)
		}
	}
}

// A run written before settings were recorded has none of the keys. That
// must read as "not recorded", never as zero.
func TestMissingSettingsAreNil(t *testing.T) {
	s := SettingsFrom(nil)
	if s.PassThreshold != nil || s.RegressionThreshold != nil || s.Concurrency != nil || s.Scorers != nil || s.Target != "" {
		t.Fatalf("expected nothing recorded: %+v", s)
	}
}

func TestApplyStats(t *testing.T) {
	r := &Run{TotalCases: 10}
	r.ApplyStats(&ResultStats{TotalCases: 4, Passed: 3, Failed: 1, PassRate: 0.75, AvgScore: 0.8, AvgLatencyMs: 12, TotalTokens: 99, TotalCost: 0.5, DimensionScores: map[string]float64{"skill": 1}})
	if r.TotalCases != 10 {
		t.Fatal("ApplyStats must not overwrite the planned case count")
	}
	if r.Passed != 3 || r.Failed != 1 || r.PassRate != 0.75 || r.AvgScore != 0.8 || r.AvgLatencyMs != 12 || r.TotalTokens != 99 || r.TotalCost != 0.5 || r.DimensionScores["skill"] != 1 {
		t.Fatalf("stats not applied: %+v", r)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./evalrun/ -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

`evalrun/settings.go`:

```go
package evalrun

import (
	"encoding/json"
	"reflect"
)

// Run.Config keys a run's settings are recorded under. They are flat on
// purpose: mongo decodes nested maps as bson.D, which serialises as a list.
const (
	SettingPassThreshold       = "pass_threshold"
	SettingRegressionThreshold = "regression_threshold"
	SettingConcurrency         = "concurrency"
	SettingTarget              = "target"
	SettingScorers             = "scorers"
	SettingModel               = "model"
	SettingPromptVersionID     = "prompt_version_id"
)

// Settings are what a run was scored with, recorded when it started. A
// pointer or slice is nil, and a string empty, when the run predates
// recording: that means "not recorded", which is not the same as today's
// configuration and must never be shown as if it were.
type Settings struct {
	PassThreshold       *float64
	RegressionThreshold *float64
	Concurrency         *int
	Target              string
	Scorers             []string
	Model               string
	PromptVersionID     string
}

// Config returns the settings as Run.Config entries.
func (s Settings) Config() map[string]any {
	m := map[string]any{}
	if s.PassThreshold != nil {
		m[SettingPassThreshold] = *s.PassThreshold
	}
	if s.RegressionThreshold != nil {
		m[SettingRegressionThreshold] = *s.RegressionThreshold
	}
	if s.Concurrency != nil {
		m[SettingConcurrency] = *s.Concurrency
	}
	if s.Target != "" {
		m[SettingTarget] = s.Target
	}
	if s.Scorers != nil {
		m[SettingScorers] = append([]string(nil), s.Scorers...)
	}
	if s.Model != "" {
		m[SettingModel] = s.Model
	}
	m[SettingPromptVersionID] = s.PromptVersionID
	return m
}

// SettingsFrom reads settings back from Run.Config, tolerating the number
// and array types each backend decodes into.
func SettingsFrom(config map[string]any) Settings {
	var s Settings
	if v, ok := toFloat(config[SettingPassThreshold]); ok {
		s.PassThreshold = &v
	}
	if v, ok := toFloat(config[SettingRegressionThreshold]); ok {
		s.RegressionThreshold = &v
	}
	if v, ok := toFloat(config[SettingConcurrency]); ok {
		n := int(v)
		s.Concurrency = &n
	}
	s.Target, _ = config[SettingTarget].(string)
	s.Scorers = toStrings(config[SettingScorers])
	s.Model, _ = config[SettingModel].(string)
	s.PromptVersionID, _ = config[SettingPromptVersionID].(string)
	return s
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// toStrings accepts any slice kind, named or not, whose elements are
// strings: []string, []any, and mongo's bson.A.
func toStrings(v any) []string {
	if v == nil {
		return nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Slice {
		return nil
	}
	out := make([]string, 0, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		if s, ok := rv.Index(i).Interface().(string); ok {
			out = append(out, s)
		}
	}
	return out
}
```

In `evalrun/run.go`, add `"time"` is already imported; add:

```go
// Finalization is what a runner writes when it stops scheduling a run.
type Finalization struct {
	Stats       *ResultStats
	State       RunState // applied only if the stored state is still running
	Error       string   // written when non-empty
	CompletedAt time.Time
}

// ApplyStats copies aggregate counters onto the run. TotalCases is the
// planned case count and is left alone: a cancelled run has fewer results
// than cases, and both numbers matter.
func (r *Run) ApplyStats(st *ResultStats) {
	if st == nil {
		return
	}
	r.Passed = st.Passed
	r.Failed = st.Failed
	r.PassRate = st.PassRate
	r.AvgScore = st.AvgScore
	r.AvgLatencyMs = st.AvgLatencyMs
	r.TotalTokens = st.TotalTokens
	r.TotalCost = st.TotalCost
	r.DimensionScores = st.DimensionScores
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./evalrun/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add evalrun/settings.go evalrun/settings_test.go
git commit --only -m "feat(evalrun): record the settings a run was scored with

A run now carries its pass threshold, regression threshold,
concurrency, target, scorers, model and prompt version in Config, so a
chart can show the threshold a run was judged by, not today's." -- evalrun/settings.go evalrun/settings_test.go evalrun/run.go
git show --stat HEAD
```

---

### Task 6: Prompt versions number themselves, and set-current stays in its suite

**Files:**
- Modify: `sentinel` `errors.go` (add `ErrPromptVersionExists`)
- Modify: `engine/engine.go` (`CreatePromptVersion`, `SetCurrentPromptVersion`, new `nextPromptVersion`)
- Modify: `store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/store.go`, `store/mongo/store.go` (`SetCurrentPromptVersion`; memory also `CreatePromptVersion`)
- Create: `store/storetest/promptversions.go`
- Modify: `store/storetest/storetest.go`
- Create: `engine/helpers_test.go`
- Create: `engine/promptversion_test.go`

**Interfaces:**
- Consumes: fixtures (Task 1).
- Produces: `sentinel.ErrPromptVersionExists`. Store `SetCurrentPromptVersion` returns `sentinel.ErrPromptVersionNotFound` when the version is not in the suite, and changes nothing. `engine.CreatePromptVersion` assigns `Version` and honours `IsCurrent` by calling set-current after insert.
- Produces engine test helpers used by Tasks 10 to 16: `newEngine(t, opts ...engine.Option) (*engine.Engine, *memory.Store)`, `seedSuite(t, e, prompt string, inputs ...string) *suite.Suite`, `okScorer(name string, score float64, dim string) scorer.Scorer`, `failingScorer(name string) scorer.Scorer`, `waitFor(t, what string, cond func() bool)`.

- [ ] **Step 1: Write the failing store check**

`store/storetest/promptversions.go`:

```go
package storetest

import (
	"errors"
	"testing"
	"time"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/promptversion"
	"github.com/xraph/sentinel/store"
)

func mustPV(t *testing.T, s store.Store, suiteID id.SuiteID, version int) *promptversion.PromptVersion {
	t.Helper()
	pv := &promptversion.PromptVersion{ID: id.NewPromptVersionID(), SuiteID: suiteID, Version: version, SystemPrompt: "prompt", CreatedAt: time.Now().UTC()}
	if err := s.CreatePromptVersion(bg(), pv); err != nil {
		t.Fatalf("create prompt version %d: %v", version, err)
	}
	return pv
}

func testSetCurrentPromptVersionIsScoped(t *testing.T, s store.Store) {
	a := mustSuite(t, s, "app_a")
	b := mustSuite(t, s, "app_a")
	a1, a2 := mustPV(t, s, a.ID, 1), mustPV(t, s, a.ID, 2)
	b1 := mustPV(t, s, b.ID, 1)

	if err := s.SetCurrentPromptVersion(bg(), a.ID, a2.ID); err != nil {
		t.Fatalf("set current: %v", err)
	}
	cur, err := s.GetCurrentPromptVersion(bg(), a.ID)
	if err != nil || cur.ID.String() != a2.ID.String() {
		t.Fatalf("current of a should be a2: %v %v", cur, err)
	}
	if got, _ := s.GetPromptVersion(bg(), a1.ID); got.IsCurrent {
		t.Fatal("a1 must no longer be current")
	}

	// b1 belongs to suite b. Naming it for suite a must refuse and change
	// nothing in either suite.
	err = s.SetCurrentPromptVersion(bg(), a.ID, b1.ID)
	if !errors.Is(err, sentinel.ErrPromptVersionNotFound) {
		t.Fatalf("foreign version: want ErrPromptVersionNotFound, got %v", err)
	}
	if cur, _ := s.GetCurrentPromptVersion(bg(), a.ID); cur == nil || cur.ID.String() != a2.ID.String() {
		t.Fatal("a refusal must leave a2 current")
	}
	if got, _ := s.GetPromptVersion(bg(), b1.ID); got.IsCurrent {
		t.Fatal("a refusal must not make b1 current")
	}
}

func testDuplicatePromptVersionIsRefused(t *testing.T, s store.Store) {
	a := mustSuite(t, s, "app_a")
	mustPV(t, s, a.ID, 1)
	dup := &promptversion.PromptVersion{ID: id.NewPromptVersionID(), SuiteID: a.ID, Version: 1, SystemPrompt: "again", CreatedAt: time.Now().UTC()}
	if err := s.CreatePromptVersion(bg(), dup); err == nil {
		t.Fatal("a second version 1 for the same suite must be refused")
	}
}
```

Add to `Run`:

```go
	t.Run("SetCurrentPromptVersionIsScoped", func(t *testing.T) { testSetCurrentPromptVersionIsScoped(t, newStore(t)) })
	t.Run("DuplicatePromptVersionIsRefused", func(t *testing.T) { testDuplicatePromptVersionIsRefused(t, newStore(t)) })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./store/... -run 'TestConformance/(SetCurrent|Duplicate)' -v`
Expected: memory FAIL on both (clears everything before refusing; allows duplicates). sqlite FAIL on the scoped check (the foreign id becomes current and nil is returned).

- [ ] **Step 3: Fix the four backends**

Add to `errors.go` under the conflict errors:

```go
	ErrPromptVersionExists = errors.New("sentinel: prompt version already exists")
```

Memory, `CreatePromptVersion`, replace the body:

```go
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.promptVersions {
		if existing.SuiteID.String() == pv.SuiteID.String() && existing.Version == pv.Version {
			return sentinel.ErrPromptVersionExists
		}
	}
	pv.CreatedAt = time.Now().UTC()
	s.promptVersions[pv.ID.String()] = clonePV(pv)
	return nil
```

Memory, `SetCurrentPromptVersion`, replace the body:

```go
	s.mu.Lock()
	defer s.mu.Unlock()
	target, ok := s.promptVersions[pvID.String()]
	if !ok || target.SuiteID.String() != suiteID.String() {
		return sentinel.ErrPromptVersionNotFound
	}
	sid := suiteID.String()
	for _, pv := range s.promptVersions {
		if pv.SuiteID.String() == sid {
			pv.IsCurrent = pv.ID.String() == pvID.String()
		}
	}
	return nil
```

SQLite, `SetCurrentPromptVersion` (postgres is identical with `s.pgdb` in place of `s.sdb`):

```go
func (s *Store) SetCurrentPromptVersion(ctx context.Context, suiteID id.SuiteID, pvID id.PromptVersionID) error {
	tx, err := s.sdb.BeginTxQuery(ctx, nil)
	if err != nil {
		return fmt.Errorf("sentinel: begin set current prompt version: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.NewUpdate((*promptVersionModel)(nil)).
		Set("is_current = ?", false).
		Where("suite_id = ?", suiteID.String()).
		Exec(ctx); err != nil {
		return fmt.Errorf("sentinel: reset prompt versions: %w", err)
	}
	res, err := tx.NewUpdate((*promptVersionModel)(nil)).
		Set("is_current = ?", true).
		Where("id = ?", pvID.String()).
		Where("suite_id = ?", suiteID.String()).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("sentinel: set current prompt version: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("sentinel: set current prompt version: %w", err)
	} else if n == 0 {
		return sentinel.ErrPromptVersionNotFound // the deferred rollback restores the reset
	}
	return tx.Commit()
}
```

Mongo, `SetCurrentPromptVersion`. Mongo transactions need a replica set, which the test container is not, so check first and scope the write:

```go
func (s *Store) SetCurrentPromptVersion(ctx context.Context, suiteID id.SuiteID, pvID id.PromptVersionID) error {
	coll := s.mdb.Collection(colPromptVersions)
	scoped := bson.M{"_id": pvID.String(), "suite_id": suiteID.String()}
	n, err := coll.CountDocuments(ctx, scoped)
	if err != nil {
		return fmt.Errorf("sentinel: find prompt version: %w", err)
	}
	if n == 0 {
		return sentinel.ErrPromptVersionNotFound
	}
	if _, err := coll.UpdateMany(ctx,
		bson.M{"suite_id": suiteID.String()},
		bson.M{"$set": bson.M{"is_current": false}},
	); err != nil {
		return fmt.Errorf("sentinel: reset prompt versions: %w", err)
	}
	if _, err := coll.UpdateOne(ctx, scoped, bson.M{"$set": bson.M{"is_current": true}}); err != nil {
		return fmt.Errorf("sentinel: set current prompt version: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Run the store checks**

Run: `go test ./store/... -run TestConformance -v`
Expected: PASS on memory and sqlite.

- [ ] **Step 5: Write the engine helpers and the failing engine test**

`engine/helpers_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/engine"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/scorer"
	"github.com/xraph/sentinel/store/memory"
	"github.com/xraph/sentinel/suite"
	"github.com/xraph/sentinel/testcase"
)

func bg() context.Context { return context.Background() }

func newEngine(t *testing.T, opts ...engine.Option) (*engine.Engine, *memory.Store) {
	t.Helper()
	st := memory.New()
	e, err := engine.New(append([]engine.Option{engine.WithStore(st)}, opts...)...)
	if err != nil {
		t.Fatalf("engine.New: %v", err)
	}
	t.Cleanup(func() { _ = e.Stop(context.Background()) })
	return e, st
}

// seedSuite creates a suite with the given system prompt and one case per
// input, named after the input.
func seedSuite(t *testing.T, e *engine.Engine, prompt string, inputs ...string) *suite.Suite {
	t.Helper()
	s := &suite.Suite{Entity: sentinel.NewEntity(), Name: "suite-" + id.NewSuiteID().String(), SystemPrompt: prompt, Metadata: map[string]any{}}
	if err := e.CreateSuite(bg(), s); err != nil {
		t.Fatalf("create suite: %v", err)
	}
	for _, in := range inputs {
		tc := &testcase.Case{Entity: sentinel.NewEntity(), SuiteID: s.ID, Name: in, Input: in, ScenarioType: testcase.ScenarioStandard,
			Scorers: []testcase.ScorerConfig{}, Tags: []string{}, Context: map[string]any{}, Metadata: map[string]any{}}
		if err := e.CreateCase(bg(), tc); err != nil {
			t.Fatalf("create case: %v", err)
		}
	}
	return s
}

func okScorer(name string, score float64, dim string) scorer.Scorer {
	return scorer.FromFunc(name, func(context.Context, *scorer.Input) (*scorer.Output, error) {
		return &scorer.Output{Score: score, Passed: score >= 0.7, Reason: "ok", Dimension: dim}, nil
	})
}

func failingScorer(name string) scorer.Scorer {
	return scorer.FromFunc(name, func(context.Context, *scorer.Input) (*scorer.Output, error) {
		return nil, errors.New("judge timed out")
	})
}

// waitFor polls cond every 10ms for up to five seconds.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}
```

`engine/promptversion_test.go`:

```go
package engine_test

import (
	"errors"
	"sort"
	"sync"
	"testing"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/promptversion"
)

func TestPromptVersionsNumberThemselves(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "base")
	for i := 0; i < 3; i++ {
		if err := e.CreatePromptVersion(bg(), &promptversion.PromptVersion{SuiteID: s.ID, SystemPrompt: "p"}); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	list, _ := e.ListPromptVersions(bg(), s.ID)
	for i, pv := range list {
		if pv.Version != i+1 {
			t.Fatalf("version %d is %d, want %d", i, pv.Version, i+1)
		}
	}
}

func TestCreateAsCurrentLeavesOneCurrent(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "base")
	first := &promptversion.PromptVersion{SuiteID: s.ID, SystemPrompt: "one", IsCurrent: true}
	second := &promptversion.PromptVersion{SuiteID: s.ID, SystemPrompt: "two", IsCurrent: true}
	for _, pv := range []*promptversion.PromptVersion{first, second} {
		if err := e.CreatePromptVersion(bg(), pv); err != nil {
			t.Fatalf("create: %v", err)
		}
	}
	list, _ := e.ListPromptVersions(bg(), s.ID)
	var current []int
	for _, pv := range list {
		if pv.IsCurrent {
			current = append(current, pv.Version)
		}
	}
	if len(current) != 1 || current[0] != 2 {
		t.Fatalf("exactly version 2 should be current, got %v", current)
	}
}

// Review focus 3: two creates at once must both succeed with distinct numbers.
func TestConcurrentCreatesGetDistinctVersions(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "base")
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = e.CreatePromptVersion(bg(), &promptversion.PromptVersion{SuiteID: s.ID, SystemPrompt: "p"})
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	list, _ := e.ListPromptVersions(bg(), s.ID)
	got := []int{list[0].Version, list[1].Version}
	sort.Ints(got)
	if got[0] != 1 || got[1] != 2 {
		t.Fatalf("versions %v, want [1 2]", got)
	}
}

func TestSetCurrentRefusesAnotherSuitesVersion(t *testing.T) {
	e, _ := newEngine(t)
	a, b := seedSuite(t, e, "a"), seedSuite(t, e, "b")
	pvB := &promptversion.PromptVersion{SuiteID: b.ID, SystemPrompt: "b"}
	if err := e.CreatePromptVersion(bg(), pvB); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := e.SetCurrentPromptVersion(bg(), a.ID, pvB.ID); !errors.Is(err, sentinel.ErrPromptVersionNotFound) {
		t.Fatalf("want ErrPromptVersionNotFound, got %v", err)
	}
}
```

- [ ] **Step 6: Run it to verify it fails**

Run: `go test ./engine/ -run 'Prompt|SetCurrent' -race -v`
Expected: FAIL (versions are all 0; two versions current; the concurrent create collides).

- [ ] **Step 7: Implement in the engine**

In `engine/engine.go`, replace `CreatePromptVersion` and `SetCurrentPromptVersion`:

```go
// CreatePromptVersion creates the next version of a suite's prompt. The
// engine assigns Version as the suite's highest plus one, and retries once
// when a concurrent create took the same number. IsCurrent on the input
// makes the new version current, through SetCurrentPromptVersion, so a
// suite never has two current versions.
func (e *Engine) CreatePromptVersion(ctx context.Context, pv *promptversion.PromptVersion) error {
	if e.store == nil {
		return sentinel.ErrNoStore
	}
	if _, err := e.store.GetSuite(ctx, pv.SuiteID); err != nil {
		return err
	}
	if pv.ID.String() == "" {
		pv.ID = id.NewPromptVersionID()
	}
	makeCurrent := pv.IsCurrent
	pv.IsCurrent = false

	var err error
	for attempt := 0; attempt < 2; attempt++ {
		if pv.Version, err = e.nextPromptVersion(ctx, pv.SuiteID); err != nil {
			return err
		}
		if err = e.store.CreatePromptVersion(ctx, pv); err == nil {
			break
		}
	}
	if err != nil {
		return fmt.Errorf("sentinel: create prompt version: %w", err)
	}
	if makeCurrent {
		if err := e.store.SetCurrentPromptVersion(ctx, pv.SuiteID, pv.ID); err != nil {
			return err
		}
		pv.IsCurrent = true
	}
	e.extensions.EmitPromptVersionCreated(ctx, pv.SuiteID, pv.ID, pv.Version)
	return nil
}

func (e *Engine) nextPromptVersion(ctx context.Context, suiteID id.SuiteID) (int, error) {
	list, err := e.store.ListPromptVersions(ctx, suiteID)
	if err != nil {
		return 0, fmt.Errorf("sentinel: list prompt versions: %w", err)
	}
	highest := 0
	for _, pv := range list {
		if pv.Version > highest {
			highest = pv.Version
		}
	}
	return highest + 1, nil
}

// SetCurrentPromptVersion makes a version current for its suite. A version
// from another suite is refused with ErrPromptVersionNotFound before
// anything changes.
func (e *Engine) SetCurrentPromptVersion(ctx context.Context, suiteID id.SuiteID, pvID id.PromptVersionID) error {
	if e.store == nil {
		return sentinel.ErrNoStore
	}
	pv, err := e.store.GetPromptVersion(ctx, pvID)
	if err != nil {
		return err
	}
	if pv.SuiteID.String() != suiteID.String() {
		return sentinel.ErrPromptVersionNotFound
	}
	return e.store.SetCurrentPromptVersion(ctx, suiteID, pvID)
}
```

- [ ] **Step 8: Run all tests**

Run: `go test -race ./engine/ ./store/... && go build ./...`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add store/storetest/promptversions.go engine/helpers_test.go engine/promptversion_test.go
git commit --only -m "fix(promptversion): number versions and keep set-current in its suite

Nothing assigned Version, so the second version for a suite failed its
unique index on three backends. Set-current also accepted another
suite's version, leaving this suite with none current. The engine now
numbers versions, and every backend refuses a foreign one." -- errors.go engine/engine.go store/memory/store.go store/sqlite/store.go store/postgres/store.go store/mongo/store.go store/storetest/promptversions.go store/storetest/storetest.go engine/helpers_test.go engine/promptversion_test.go
git show --stat HEAD
```

---

### Task 7: Deleting a suite deletes what belongs to it, on every backend

**Files:**
- Modify: `store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/store.go`, `store/mongo/store.go` (`DeleteSuite`)
- Create: `store/storetest/cascade.go`
- Modify: `store/storetest/storetest.go`

**Interfaces:**
- Consumes: fixtures (Task 1), `mustPV` (Task 6).
- Produces: `DeleteSuite` removes the suite's cases, runs, results, baselines and prompt versions on all four backends.

- [ ] **Step 1: Write the failing check**

`store/storetest/cascade.go`:

```go
package storetest

import (
	"errors"
	"testing"
	"time"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/baseline"
	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/store"
)

type suiteRows struct {
	suiteID  id.SuiteID
	caseID   id.CaseID
	runID    id.EvalRunID
	resultID id.EvalResultID
}

func seedSuiteRows(t *testing.T, s store.Store) suiteRows {
	t.Helper()
	su := mustSuite(t, s, "app_a")
	tc := mustCase(t, s, su.ID)
	run := mustRun(t, s, su.ID, "app_a")
	res := mustResult(t, s, run.ID, tc.ID, evalrun.StatusPass, 1)
	if err := s.SaveBaseline(bg(), &baseline.Baseline{ID: id.NewBaselineID(), SuiteID: su.ID, RunID: run.ID, Name: "b",
		Results: []baseline.Result{}, DimensionScores: map[string]float64{}, CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatalf("save baseline: %v", err)
	}
	mustPV(t, s, su.ID, 1)
	return suiteRows{su.ID, tc.ID, run.ID, res.ID}
}

func testDeleteSuiteCascades(t *testing.T, s store.Store) {
	gone := seedSuiteRows(t, s)
	kept := seedSuiteRows(t, s)

	if err := s.DeleteSuite(bg(), gone.suiteID); err != nil {
		t.Fatalf("delete suite: %v", err)
	}

	if cases, _ := s.ListCases(bg(), gone.suiteID); len(cases) != 0 {
		t.Errorf("cases survived: %d", len(cases))
	}
	if _, err := s.GetRun(bg(), gone.runID); !errors.Is(err, sentinel.ErrRunNotFound) {
		t.Errorf("run survived: %v", err)
	}
	if res, _ := s.ListResults(bg(), gone.runID); len(res) != 0 {
		t.Errorf("results survived: %d", len(res))
	}
	if bl, _ := s.ListBaselines(bg(), gone.suiteID); len(bl) != 0 {
		t.Errorf("baselines survived: %d", len(bl))
	}
	if pvs, _ := s.ListPromptVersions(bg(), gone.suiteID); len(pvs) != 0 {
		t.Errorf("prompt versions survived: %d", len(pvs))
	}

	// The other suite is untouched, checked by identity.
	cases, _ := s.ListCases(bg(), kept.suiteID)
	if len(cases) != 1 || cases[0].ID.String() != kept.caseID.String() {
		t.Errorf("other suite's case changed: %+v", cases)
	}
	if run, err := s.GetRun(bg(), kept.runID); err != nil || run.ID.String() != kept.runID.String() {
		t.Errorf("other suite's run changed: %v", err)
	}
	if res, _ := s.ListResults(bg(), kept.runID); len(res) != 1 || res[0].ID.String() != kept.resultID.String() {
		t.Errorf("other suite's result changed: %+v", res)
	}
	if bl, _ := s.ListBaselines(bg(), kept.suiteID); len(bl) != 1 {
		t.Errorf("other suite's baseline changed: %d", len(bl))
	}
	if pvs, _ := s.ListPromptVersions(bg(), kept.suiteID); len(pvs) != 1 {
		t.Errorf("other suite's prompt versions changed: %d", len(pvs))
	}
}
```

Add to `Run`:

```go
	t.Run("DeleteSuiteCascades", func(t *testing.T) { testDeleteSuiteCascades(t, newStore(t)) })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./store/... -run TestConformance/DeleteSuiteCascades -v`
Expected: memory FAIL ("cases survived"). sqlite may pass or fail depending on which pooled connection ran the foreign-key pragma. Either way, Step 3 makes it deterministic.

- [ ] **Step 3: Delete explicitly in each backend**

Memory, replace `DeleteSuite`'s body after the existence check:

```go
	delete(s.suites, key)
	runIDs := map[string]bool{}
	for k, run := range s.runs {
		if run.SuiteID.String() == key {
			runIDs[k] = true
			delete(s.runs, k)
		}
	}
	for k, r := range s.results {
		if runIDs[r.RunID.String()] {
			delete(s.results, k)
		}
	}
	for k, tc := range s.cases {
		if tc.SuiteID.String() == key {
			delete(s.cases, k)
		}
	}
	for k, b := range s.baselines {
		if b.SuiteID.String() == key {
			delete(s.baselines, k)
		}
	}
	for k, pv := range s.promptVersions {
		if pv.SuiteID.String() == key {
			delete(s.promptVersions, k)
		}
	}
	return nil
```

SQLite, replace `DeleteSuite` (postgres identical with `s.pgdb`; its cascade already does this, and the explicit deletes are harmless and make the backends agree by construction). Baselines reference runs, so they go before runs:

```go
// DeleteSuite deletes a suite and everything that belongs to it. SQLite's
// ON DELETE CASCADE fires only on connections that ran PRAGMA foreign_keys,
// which grove sets on one pooled connection, so the children are deleted
// explicitly.
func (s *Store) DeleteSuite(ctx context.Context, suiteID id.SuiteID) error {
	sid := suiteID.String()
	tx, err := s.sdb.BeginTxQuery(ctx, nil)
	if err != nil {
		return fmt.Errorf("sentinel: begin delete suite: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.NewDelete((*resultModel)(nil)).
		Where("run_id IN (SELECT id FROM sentinel_runs WHERE suite_id = ?)", sid).
		Exec(ctx); err != nil {
		return fmt.Errorf("sentinel: delete suite results: %w", err)
	}
	for _, m := range []any{(*baselineModel)(nil), (*promptVersionModel)(nil), (*caseModel)(nil), (*runModel)(nil)} {
		if _, err := tx.NewDelete(m).Where("suite_id = ?", sid).Exec(ctx); err != nil {
			return fmt.Errorf("sentinel: delete suite children: %w", err)
		}
	}
	if _, err := tx.NewDelete((*suiteModel)(nil)).Where("id = ?", sid).Exec(ctx); err != nil {
		return fmt.Errorf("sentinel: delete suite: %w", err)
	}
	return tx.Commit()
}
```

Mongo, replace `DeleteSuite`:

```go
func (s *Store) DeleteSuite(ctx context.Context, suiteID id.SuiteID) error {
	sid := suiteID.String()
	var runs []runModel
	if err := s.mdb.NewFind(&runs).Filter(bson.M{"suite_id": sid}).Scan(ctx); err != nil {
		return fmt.Errorf("sentinel: find suite runs: %w", err)
	}
	runIDs := make([]string, len(runs))
	for i := range runs {
		runIDs[i] = runs[i].ID
	}
	if len(runIDs) > 0 {
		if _, err := s.mdb.Collection(colResults).DeleteMany(ctx, bson.M{"run_id": bson.M{"$in": runIDs}}); err != nil {
			return fmt.Errorf("sentinel: delete suite results: %w", err)
		}
	}
	for _, col := range []string{colBaselines, colPromptVersions, colCases, colRuns} {
		if _, err := s.mdb.Collection(col).DeleteMany(ctx, bson.M{"suite_id": sid}); err != nil {
			return fmt.Errorf("sentinel: delete suite children: %w", err)
		}
	}
	if _, err := s.mdb.Collection(colSuites).DeleteOne(ctx, bson.M{"_id": sid}); err != nil {
		return fmt.Errorf("sentinel: delete suite: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Run the checks**

Run: `go test -race ./store/... -run TestConformance -v`
Expected: PASS on memory and sqlite.

- [ ] **Step 5: Commit**

```bash
git add store/storetest/cascade.go
git commit --only -m "fix(store): delete a suite's children on every backend

Postgres cascaded, sqlite cascaded only on some pooled connections, and
memory and mongo left every case, run, result, baseline and prompt
version orphaned. All four now delete them explicitly." -- store/memory/store.go store/sqlite/store.go store/postgres/store.go store/mongo/store.go store/storetest/cascade.go store/storetest/storetest.go
git show --stat HEAD
```

---

### Task 8: Stores can cancel and finalise a run conditionally

**Files:**
- Modify: `evalrun/store.go` (interface)
- Modify: `store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/store.go`, `store/mongo/store.go`
- Create: `store/storetest/lifecycle.go`
- Modify: `store/storetest/storetest.go`

**Interfaces:**
- Consumes: `evalrun.Finalization`, `(*Run).ApplyStats` (Task 5).
- Produces on `evalrun.Store`:
  - `CancelRun(ctx context.Context, runID id.EvalRunID, at time.Time) (bool, error)`: sets `cancelled` and `completed_at` only where the state is `running`. Returns `(false, nil)` for a run that exists and is not running, `(false, sentinel.ErrRunNotFound)` for a missing one.
  - `FinalizeRun(ctx context.Context, runID id.EvalRunID, f *evalrun.Finalization) (evalrun.RunState, error)`: writes counters, `dimension_scores`, `completed_at`, and `error` when non-empty, always; writes `state` only if the stored state is `running`. Returns the stored state. `sentinel.ErrRunNotFound` for a missing run.

- [ ] **Step 1: Write the failing check**

`store/storetest/lifecycle.go`:

```go
package storetest

import (
	"errors"
	"testing"
	"time"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/store"
)

func finalStats() *evalrun.ResultStats {
	return &evalrun.ResultStats{TotalCases: 3, Passed: 2, Failed: 1, PassRate: 2.0 / 3, AvgScore: 0.75, AvgLatencyMs: 40, TotalTokens: 300, TotalCost: 0.25,
		DimensionScores: map[string]float64{"skill": 0.5}}
}

func testCancelRun(t *testing.T, s store.Store) {
	su := mustSuite(t, s, "app_a")
	run := mustRun(t, s, su.ID, "app_a")

	ok, err := s.CancelRun(bg(), run.ID, time.Now().UTC())
	if err != nil || !ok {
		t.Fatalf("cancel running run: ok=%v err=%v", ok, err)
	}
	got, _ := s.GetRun(bg(), run.ID)
	if got.State != evalrun.StateCancelled || got.CompletedAt == nil {
		t.Fatalf("after cancel: state=%s completedAt=%v", got.State, got.CompletedAt)
	}

	ok, err = s.CancelRun(bg(), run.ID, time.Now().UTC())
	if err != nil || ok {
		t.Fatalf("cancelling a cancelled run must report false without error: ok=%v err=%v", ok, err)
	}
	if _, err := s.CancelRun(bg(), id.NewEvalRunID(), time.Now().UTC()); !errors.Is(err, sentinel.ErrRunNotFound) {
		t.Fatalf("cancel missing run: want ErrRunNotFound, got %v", err)
	}
}

func testFinalizeRun(t *testing.T, s store.Store) {
	su := mustSuite(t, s, "app_a")
	run := mustRun(t, s, su.ID, "app_a")

	state, err := s.FinalizeRun(bg(), run.ID, &evalrun.Finalization{Stats: finalStats(), State: evalrun.StateCompleted, CompletedAt: time.Now().UTC()})
	if err != nil || state != evalrun.StateCompleted {
		t.Fatalf("finalize: state=%s err=%v", state, err)
	}
	got, _ := s.GetRun(bg(), run.ID)
	if got.State != evalrun.StateCompleted || got.Passed != 2 || got.Failed != 1 || got.TotalTokens != 300 || !near(got.AvgScore, 0.75) || !near(got.DimensionScores["skill"], 0.5) || got.CompletedAt == nil {
		t.Fatalf("finalized run: %+v", got)
	}
	if got.TotalCases != 3 {
		t.Fatalf("finalize must not touch total_cases: %d", got.TotalCases)
	}

	if _, err := s.FinalizeRun(bg(), id.NewEvalRunID(), &evalrun.Finalization{Stats: finalStats(), State: evalrun.StateCompleted, CompletedAt: time.Now().UTC()}); !errors.Is(err, sentinel.ErrRunNotFound) {
		t.Fatalf("finalize missing run: want ErrRunNotFound, got %v", err)
	}
}

// Review focus 2: a cancel that lands after the last case but before the
// finalize. The run stays cancelled, and the counters still arrive.
func testFinalizeKeepsCancel(t *testing.T, s store.Store) {
	su := mustSuite(t, s, "app_a")
	run := mustRun(t, s, su.ID, "app_a")
	if ok, err := s.CancelRun(bg(), run.ID, time.Now().UTC()); err != nil || !ok {
		t.Fatalf("cancel: %v", err)
	}
	state, err := s.FinalizeRun(bg(), run.ID, &evalrun.Finalization{Stats: finalStats(), State: evalrun.StateCompleted, CompletedAt: time.Now().UTC()})
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}
	if state != evalrun.StateCancelled {
		t.Fatalf("finalize overwrote a cancel: %s", state)
	}
	got, _ := s.GetRun(bg(), run.ID)
	if got.State != evalrun.StateCancelled || got.Passed != 2 {
		t.Fatalf("cancelled run should keep its state and gain counters: %+v", got)
	}
}

func testFinalizeRecordsFailure(t *testing.T, s store.Store) {
	su := mustSuite(t, s, "app_a")
	run := mustRun(t, s, su.ID, "app_a")
	state, err := s.FinalizeRun(bg(), run.ID, &evalrun.Finalization{Stats: finalStats(), State: evalrun.StateFailed, Error: "1 of 3 results could not be stored", CompletedAt: time.Now().UTC()})
	if err != nil || state != evalrun.StateFailed {
		t.Fatalf("finalize failed: state=%s err=%v", state, err)
	}
	got, _ := s.GetRun(bg(), run.ID)
	if got.Error != "1 of 3 results could not be stored" {
		t.Fatalf("error not recorded: %q", got.Error)
	}
}
```

Add to `Run`:

```go
	t.Run("CancelRun", func(t *testing.T) { testCancelRun(t, newStore(t)) })
	t.Run("FinalizeRun", func(t *testing.T) { testFinalizeRun(t, newStore(t)) })
	t.Run("FinalizeKeepsCancel", func(t *testing.T) { testFinalizeKeepsCancel(t, newStore(t)) })
	t.Run("FinalizeRecordsFailure", func(t *testing.T) { testFinalizeRecordsFailure(t, newStore(t)) })
```

- [ ] **Step 2: Add the interface methods and run to see it fail**

In `evalrun/store.go`, add to `Store` after `UpdateRun`, and add `"time"` to its imports:

```go
	// CancelRun marks a running run cancelled at the given time. It reports
	// false, with no error, when the run exists and is no longer running.
	// The condition is part of the write, so it is safe against a runner
	// finishing at the same moment on another replica.
	CancelRun(ctx context.Context, runID id.EvalRunID, at time.Time) (bool, error)

	// FinalizeRun writes a finished run's counters, dimension scores and
	// completion time, and its error when one is given. It writes the state
	// only if the stored state is still running, and returns the state the
	// store holds afterwards, so a cancel is never overwritten.
	FinalizeRun(ctx context.Context, runID id.EvalRunID, f *Finalization) (RunState, error)
```

Run: `go build ./...`
Expected: FAIL, every backend is missing the two methods.

- [ ] **Step 3: Implement memory**

```go
func (s *Store) CancelRun(_ context.Context, runID id.EvalRunID, at time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.runs[runID.String()]
	if !ok {
		return false, sentinel.ErrRunNotFound
	}
	if run.State != evalrun.StateRunning {
		return false, nil
	}
	t := at.UTC()
	run.State = evalrun.StateCancelled
	run.CompletedAt = &t
	run.UpdatedAt = time.Now().UTC()
	return true, nil
}

func (s *Store) FinalizeRun(_ context.Context, runID id.EvalRunID, f *evalrun.Finalization) (evalrun.RunState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.runs[runID.String()]
	if !ok {
		return "", sentinel.ErrRunNotFound
	}
	run.ApplyStats(f.Stats)
	t := f.CompletedAt.UTC()
	run.CompletedAt = &t
	if f.Error != "" {
		run.Error = f.Error
	}
	if run.State == evalrun.StateRunning {
		run.State = f.State
	}
	run.UpdatedAt = time.Now().UTC()
	return run.State, nil
}
```

- [ ] **Step 4: Implement sqlite and postgres**

SQLite. `dimension_scores` is a JSON text column there:

```go
func (s *Store) CancelRun(ctx context.Context, runID id.EvalRunID, at time.Time) (bool, error) {
	res, err := s.sdb.NewUpdate((*runModel)(nil)).
		Set("state = ?", string(evalrun.StateCancelled)).
		Set("completed_at = ?", at.UTC()).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", runID.String()).
		Where("state = ?", string(evalrun.StateRunning)).
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("sentinel: cancel run: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("sentinel: cancel run: %w", err)
	}
	if n > 0 {
		return true, nil
	}
	if _, err := s.GetRun(ctx, runID); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Store) FinalizeRun(ctx context.Context, runID id.EvalRunID, f *evalrun.Finalization) (evalrun.RunState, error) {
	st := f.Stats
	if st == nil {
		st = &evalrun.ResultStats{}
	}
	dims := st.DimensionScores
	if dims == nil {
		dims = map[string]float64{}
	}
	dimsJSON, err := json.Marshal(dims)
	if err != nil {
		return "", fmt.Errorf("sentinel: finalize run: %w", err)
	}
	q := s.sdb.NewUpdate((*runModel)(nil)).
		Set("passed = ?", st.Passed).
		Set("failed = ?", st.Failed).
		Set("pass_rate = ?", st.PassRate).
		Set("avg_score = ?", st.AvgScore).
		Set("avg_latency_ms = ?", st.AvgLatencyMs).
		Set("total_tokens = ?", st.TotalTokens).
		Set("total_cost = ?", st.TotalCost).
		Set("dimension_scores = ?", string(dimsJSON)).
		Set("completed_at = ?", f.CompletedAt.UTC()).
		Set("updated_at = ?", time.Now().UTC()).
		Set("state = CASE WHEN state = ? THEN ? ELSE state END", string(evalrun.StateRunning), string(f.State))
	if f.Error != "" {
		q = q.Set("error = ?", f.Error)
	}
	res, err := q.Where("id = ?", runID.String()).Exec(ctx)
	if err != nil {
		return "", fmt.Errorf("sentinel: finalize run: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return "", fmt.Errorf("sentinel: finalize run: %w", err)
	} else if n == 0 {
		return "", sentinel.ErrRunNotFound
	}
	run, err := s.GetRun(ctx, runID)
	if err != nil {
		return "", err
	}
	return run.State, nil
}
```

Postgres: the same two methods with `s.pgdb`, except the dimension scores line, because the column is jsonb:

```go
		Set("dimension_scores = CAST(? AS jsonb)", string(dimsJSON)).
```

Add `"encoding/json"` to the postgres store imports if it is not there. If grove's placeholder rewriting rejects two `?` in one `Set` expression on postgres (the test will say so), split the conditional state into a second statement inside the same method: `NewUpdate((*runModel)(nil)).Set("state = ?", string(f.State)).Where("id = ?", id).Where("state = ?", "running")`, run after the counters update.

- [ ] **Step 5: Implement mongo**

```go
func (s *Store) CancelRun(ctx context.Context, runID id.EvalRunID, at time.Time) (bool, error) {
	coll := s.mdb.Collection(colRuns)
	res, err := coll.UpdateOne(ctx,
		bson.M{"_id": runID.String(), "state": string(evalrun.StateRunning)},
		bson.M{"$set": bson.M{"state": string(evalrun.StateCancelled), "completed_at": at.UTC(), "updated_at": time.Now().UTC()}},
	)
	if err != nil {
		return false, fmt.Errorf("sentinel: cancel run: %w", err)
	}
	if res.ModifiedCount > 0 {
		return true, nil
	}
	n, err := coll.CountDocuments(ctx, bson.M{"_id": runID.String()})
	if err != nil {
		return false, fmt.Errorf("sentinel: cancel run: %w", err)
	}
	if n == 0 {
		return false, sentinel.ErrRunNotFound
	}
	return false, nil
}

func (s *Store) FinalizeRun(ctx context.Context, runID id.EvalRunID, f *evalrun.Finalization) (evalrun.RunState, error) {
	st := f.Stats
	if st == nil {
		st = &evalrun.ResultStats{}
	}
	dims := st.DimensionScores
	if dims == nil {
		dims = map[string]float64{}
	}
	set := bson.M{
		"passed": st.Passed, "failed": st.Failed, "pass_rate": st.PassRate, "avg_score": st.AvgScore,
		"avg_latency_ms": st.AvgLatencyMs, "total_tokens": st.TotalTokens, "total_cost": st.TotalCost,
		"dimension_scores": dims, "completed_at": f.CompletedAt.UTC(), "updated_at": time.Now().UTC(),
	}
	if f.Error != "" {
		set["error"] = f.Error
	}
	coll := s.mdb.Collection(colRuns)
	res, err := coll.UpdateOne(ctx, bson.M{"_id": runID.String()}, bson.M{"$set": set})
	if err != nil {
		return "", fmt.Errorf("sentinel: finalize run: %w", err)
	}
	if res.MatchedCount == 0 {
		return "", sentinel.ErrRunNotFound
	}
	if _, err := coll.UpdateOne(ctx,
		bson.M{"_id": runID.String(), "state": string(evalrun.StateRunning)},
		bson.M{"$set": bson.M{"state": string(f.State)}},
	); err != nil {
		return "", fmt.Errorf("sentinel: finalize run state: %w", err)
	}
	run, err := s.GetRun(ctx, runID)
	if err != nil {
		return "", err
	}
	return run.State, nil
}
```

`res.ModifiedCount` and `res.MatchedCount` are fields on `*mongo.UpdateResult` in mongo-driver v2.

- [ ] **Step 6: Run the checks on all four backends**

Run: `go test -race ./store/... && go test -tags integration ./store/postgres/ ./store/mongo/ -run TestConformance -v`
Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add store/storetest/lifecycle.go
git commit --only -m "feat(store): cancel and finalize runs with a conditional write

CancelRun sets cancelled only on a running run, and FinalizeRun writes
counters always but the state only if the run is still running. The
condition lives in the write, so a cancel from any replica survives a
runner finishing at the same moment." -- evalrun/store.go store/memory/store.go store/sqlite/store.go store/postgres/store.go store/mongo/store.go store/storetest/lifecycle.go store/storetest/storetest.go
git show --stat HEAD
```

---

### Task 9: Regression detection reports what it could not compare

**Files:**
- Modify: `baseline/regression.go`
- Create: `baseline/regression_test.go`

**Interfaces:**
- Produces on `baseline.RegressionResult`: `Threshold float64` (`threshold`), `MissingCases []CaseRef` (`missing_cases,omitempty`), `NewCases []CaseRef` (`new_cases,omitempty`), `MissingDimensions []string` (`missing_dimensions,omitempty`); `type CaseRef struct { CaseID string \`json:"case_id"\`; CaseName string \`json:"case_name"\` }`; `(*RegressionResult).WorstDelta() float64`. `DimensionDeltas` no longer contains dimensions missing from the run.

- [ ] **Step 1: Write the failing test**

`baseline/regression_test.go`:

```go
package baseline

import (
	"testing"

	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
)

func result(caseID id.CaseID, name string, score float64) *evalrun.Result {
	return &evalrun.Result{CaseID: caseID, CaseName: name, Score: score}
}

func TestDetectRegression(t *testing.T) {
	c1, c2, c3 := id.NewCaseID(), id.NewCaseID(), id.NewCaseID()
	base := &Baseline{
		PassRate: 0.5, AvgScore: 0.5,
		DimensionScores: map[string]float64{"skill": 0.5, "trait": 0.5},
		Results:         []Result{{CaseID: c1, CaseName: "one", Score: 0.5}, {CaseID: c2, CaseName: "two", Score: 0.5}},
	}

	t.Run("within threshold, on the boundary", func(t *testing.T) {
		stats := &evalrun.ResultStats{PassRate: 0.25, AvgScore: 0.25, DimensionScores: map[string]float64{"skill": 0.25, "trait": 0.25}}
		rr := DetectRegression(stats, []*evalrun.Result{result(c1, "one", 0.25), result(c2, "two", 0.25)}, base, 0.25)
		if rr.HasRegression {
			t.Fatalf("a drop exactly equal to the threshold is not a regression: %+v", rr)
		}
		if rr.Threshold != 0.25 {
			t.Fatalf("threshold not recorded: %v", rr.Threshold)
		}
	})

	t.Run("pass rate beyond threshold", func(t *testing.T) {
		stats := &evalrun.ResultStats{PassRate: 0.25, AvgScore: 0.5, DimensionScores: map[string]float64{"skill": 0.5, "trait": 0.5}}
		rr := DetectRegression(stats, []*evalrun.Result{result(c1, "one", 0.5), result(c2, "two", 0.5)}, base, 0.125)
		if !rr.HasRegression || rr.PassRateDelta != -0.25 {
			t.Fatalf("pass rate regression missed: %+v", rr)
		}
		if rr.WorstDelta() != -0.25 {
			t.Fatalf("worst delta: %v", rr.WorstDelta())
		}
	})

	t.Run("a missing dimension is not measured, and still regresses", func(t *testing.T) {
		stats := &evalrun.ResultStats{PassRate: 0.5, AvgScore: 0.5, DimensionScores: map[string]float64{"skill": 0.5}}
		rr := DetectRegression(stats, []*evalrun.Result{result(c1, "one", 0.5), result(c2, "two", 0.5)}, base, 0.125)
		if !rr.HasRegression {
			t.Fatal("a dimension that stopped being measured must still flag, for CI")
		}
		if len(rr.MissingDimensions) != 1 || rr.MissingDimensions[0] != "trait" {
			t.Fatalf("missing dimensions: %v", rr.MissingDimensions)
		}
		if _, ok := rr.DimensionDeltas["trait"]; ok {
			t.Fatal("a missing dimension must not appear as a delta of -0.5")
		}
	})

	t.Run("case regression, and missing and new cases", func(t *testing.T) {
		stats := &evalrun.ResultStats{PassRate: 0.5, AvgScore: 0.5, DimensionScores: map[string]float64{"skill": 0.5, "trait": 0.5}}
		rr := DetectRegression(stats, []*evalrun.Result{result(c1, "one", 0.125), result(c3, "three", 1)}, base, 0.125)
		if !rr.HasRegression || len(rr.RegressedCases) != 1 || rr.RegressedCases[0].CaseID != c1.String() {
			t.Fatalf("case one should regress: %+v", rr.RegressedCases)
		}
		if len(rr.MissingCases) != 1 || rr.MissingCases[0].CaseID != c2.String() || rr.MissingCases[0].CaseName != "two" {
			t.Fatalf("case two is missing from the run: %+v", rr.MissingCases)
		}
		if len(rr.NewCases) != 1 || rr.NewCases[0].CaseID != c3.String() {
			t.Fatalf("case three is new: %+v", rr.NewCases)
		}
	})

	t.Run("missing and new cases alone do not regress", func(t *testing.T) {
		stats := &evalrun.ResultStats{PassRate: 0.5, AvgScore: 0.5, DimensionScores: map[string]float64{"skill": 0.5, "trait": 0.5}}
		rr := DetectRegression(stats, []*evalrun.Result{result(c1, "one", 0.5), result(c3, "three", 0.5)}, base, 0.125)
		if rr.HasRegression {
			t.Fatalf("a changed case set is reported, not counted as a regression: %+v", rr)
		}
	})
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./baseline/ -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Replace `baseline/regression.go`:

```go
package baseline

import (
	"sort"

	"github.com/xraph/sentinel/evalrun"
)

// RegressionResult holds the outcome of a regression detection check.
type RegressionResult struct {
	HasRegression   bool               `json:"has_regression"`
	Threshold       float64            `json:"threshold"`
	PassRateDelta   float64            `json:"pass_rate_delta"`
	AvgScoreDelta   float64            `json:"avg_score_delta"`
	DimensionDeltas map[string]float64 `json:"dimension_deltas,omitempty"`
	RegressedCases  []RegressedCase    `json:"regressed_cases,omitempty"`

	// MissingCases are baseline cases with no result in the run. They do not
	// set HasRegression: the suite changed, which is a different question.
	MissingCases []CaseRef `json:"missing_cases,omitempty"`
	// NewCases are run results with no baseline case to compare against.
	NewCases []CaseRef `json:"new_cases,omitempty"`
	// MissingDimensions are baseline dimensions the run did not measure.
	// They set HasRegression, the conservative answer for CI, and are kept
	// out of DimensionDeltas so nobody reads "not measured" as a large drop.
	MissingDimensions []string `json:"missing_dimensions,omitempty"`
}

// RegressedCase identifies a single case that regressed from baseline.
type RegressedCase struct {
	CaseID   string  `json:"case_id"`
	CaseName string  `json:"case_name"`
	OldScore float64 `json:"old_score"`
	NewScore float64 `json:"new_score"`
	Delta    float64 `json:"delta"`
}

// CaseRef names a case without scores.
type CaseRef struct {
	CaseID   string `json:"case_id"`
	CaseName string `json:"case_name"`
}

// DetectRegression compares a run's results against a baseline. A metric
// regresses when it falls more than threshold below the baseline; one
// absolute threshold covers pass rate, average score, each dimension and
// each case, and lower is always worse.
func DetectRegression(stats *evalrun.ResultStats, results []*evalrun.Result, b *Baseline, threshold float64) *RegressionResult {
	rr := &RegressionResult{
		Threshold:       threshold,
		PassRateDelta:   stats.PassRate - b.PassRate,
		AvgScoreDelta:   stats.AvgScore - b.AvgScore,
		DimensionDeltas: make(map[string]float64),
	}
	if rr.PassRateDelta < -threshold || rr.AvgScoreDelta < -threshold {
		rr.HasRegression = true
	}

	for dim, baselineScore := range b.DimensionScores {
		current, measured := stats.DimensionScores[dim]
		if !measured {
			rr.MissingDimensions = append(rr.MissingDimensions, dim)
			rr.HasRegression = true
			continue
		}
		delta := current - baselineScore
		rr.DimensionDeltas[dim] = delta
		if delta < -threshold {
			rr.HasRegression = true
		}
	}
	sort.Strings(rr.MissingDimensions)

	baselineLookup := make(map[string]Result, len(b.Results))
	for _, br := range b.Results {
		baselineLookup[br.CaseID.String()] = br
	}
	seen := make(map[string]bool, len(results))
	for _, r := range results {
		key := r.CaseID.String()
		seen[key] = true
		br, ok := baselineLookup[key]
		if !ok {
			rr.NewCases = append(rr.NewCases, CaseRef{CaseID: key, CaseName: r.CaseName})
			continue
		}
		delta := r.Score - br.Score
		if delta < -threshold {
			rr.HasRegression = true
			rr.RegressedCases = append(rr.RegressedCases, RegressedCase{
				CaseID: key, CaseName: r.CaseName, OldScore: br.Score, NewScore: r.Score, Delta: delta,
			})
		}
	}
	for _, br := range b.Results {
		if !seen[br.CaseID.String()] {
			rr.MissingCases = append(rr.MissingCases, CaseRef{CaseID: br.CaseID.String(), CaseName: br.CaseName})
		}
	}
	return rr
}

// WorstDelta is the most negative delta found: pass rate, average score,
// any dimension or any regressed case. It is what RegressionDetected hooks
// receive.
func (rr *RegressionResult) WorstDelta() float64 {
	worst := rr.PassRateDelta
	if rr.AvgScoreDelta < worst {
		worst = rr.AvgScoreDelta
	}
	for _, d := range rr.DimensionDeltas {
		if d < worst {
			worst = d
		}
	}
	for _, c := range rr.RegressedCases {
		if c.Delta < worst {
			worst = c.Delta
		}
	}
	return worst
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./baseline/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add baseline/regression_test.go
git commit --only -m "feat(baseline): report missing and new cases and dimensions

A baseline case with no result was skipped silently, and a dimension
the run did not measure showed up as a large drop. The result now lists
missing and new cases, lists unmeasured dimensions on their own, and
records the threshold it applied." -- baseline/regression.go baseline/regression_test.go
git show --stat HEAD
```

---

### Task 10: The engine holds named targets and scorers

**Files:**
- Modify: `errors.go` (add `ErrUnknownTarget`, `ErrUnknownScorer`, `ErrInvalidInput`, `ErrUnsupportedFormat`)
- Modify: `engine/engine.go`, `engine/options.go`
- Create: `engine/registry_test.go`

**Interfaces:**
- Consumes: `scorer.Descriptor`, `(*Registry).RegisterDescribed` (Task 4); helpers (Task 6).
- Produces:
  - `type engine.RegisteredTarget struct { Name, Description string; Target target.Target }`
  - `engine.WithTarget(name, description string, t target.Target) Option`
  - `engine.WithScorer(d scorer.Descriptor, f scorer.Factory) Option`
  - `(*Engine).Targets() []RegisteredTarget` (sorted by name)
  - `(*Engine).Target(name string) (RegisteredTarget, bool)`
  - `(*Engine).Scorers() *scorer.Registry`
  - Errors `sentinel.ErrUnknownTarget`, `sentinel.ErrUnknownScorer`, `sentinel.ErrInvalidInput`, `sentinel.ErrUnsupportedFormat`.

- [ ] **Step 1: Write the failing test**

`engine/registry_test.go`:

```go
package engine_test

import (
	"context"
	"testing"

	"github.com/xraph/sentinel/engine"
	"github.com/xraph/sentinel/scorer"
	"github.com/xraph/sentinel/target"
)

func echo(name string) target.Target {
	return target.FromFunc(name, func(_ context.Context, in string) (string, error) { return in, nil })
}

func TestTargetsAreNamed(t *testing.T) {
	e, _ := newEngine(t, engine.WithTarget("b", "second", echo("b")), engine.WithTarget("a", "first", echo("a")))
	got := e.Targets()
	if len(got) != 2 || got[0].Name != "a" || got[0].Description != "first" || got[1].Name != "b" {
		t.Fatalf("targets: %+v", got)
	}
	if rt, ok := e.Target("a"); !ok || rt.Target == nil {
		t.Fatal("target a not found")
	}
	if _, ok := e.Target("nope"); ok {
		t.Fatal("unknown target found")
	}
}

func TestDuplicateTargetIsRefused(t *testing.T) {
	if _, err := engine.New(engine.WithTarget("a", "", echo("a")), engine.WithTarget("a", "", echo("a"))); err == nil {
		t.Fatal("registering a target name twice must fail")
	}
	if _, err := engine.New(engine.WithTarget("", "", echo("a"))); err == nil {
		t.Fatal("a target needs a name")
	}
}

func TestScorersIncludeApplicationScorers(t *testing.T) {
	e, _ := newEngine(t, engine.WithScorer(scorer.Descriptor{Name: "judge", Description: "LLM judge", UsesLLM: true},
		func(map[string]any) (scorer.Scorer, error) { return okScorer("judge", 1, ""), nil }))
	if !e.Scorers().Has("judge") || !e.Scorers().Has("exact") {
		t.Fatal("the registry should hold built-ins and application scorers")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./engine/ -run 'Targets|Duplicate|Scorers' -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Add to `errors.go` under the evaluation errors:

```go
	ErrUnknownTarget     = errors.New("sentinel: unknown target")
	ErrUnknownScorer     = errors.New("sentinel: unknown scorer")
	ErrInvalidInput      = errors.New("sentinel: invalid input")
	ErrUnsupportedFormat = errors.New("sentinel: unsupported format")
```

In `engine/engine.go`, add fields to `Engine`:

```go
	targets        map[string]RegisteredTarget
	scorers        *scorer.Registry
	pendingScorers []pendingScorer
```

and the types and accessors:

```go
// RegisteredTarget is a target an application named, so a run can be
// started by name from somewhere that cannot hold a Go value, such as the
// dashboard.
type RegisteredTarget struct {
	Name        string
	Description string
	Target      target.Target
}

type pendingScorer struct {
	desc    scorer.Descriptor
	factory scorer.Factory
}

// Targets lists the registered targets, sorted by name.
func (e *Engine) Targets() []RegisteredTarget {
	out := make([]RegisteredTarget, 0, len(e.targets))
	for _, t := range e.targets {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Target returns a registered target by name.
func (e *Engine) Target(name string) (RegisteredTarget, bool) {
	t, ok := e.targets[name]
	return t, ok
}

// Scorers returns the scorer registry: the built-ins plus whatever the
// application registered with WithScorer.
func (e *Engine) Scorers() *scorer.Registry { return e.scorers }
```

In `New`, after the options loop and before the extension registry:

```go
	e.scorers = scorer.NewRegistry()
	for _, p := range e.pendingScorers {
		e.scorers.RegisterDescribed(p.desc, p.factory)
	}
	e.pendingScorers = nil
```

Add imports `"sort"`, `"github.com/xraph/sentinel/scorer"`, `"github.com/xraph/sentinel/target"`.

In `engine/options.go`, add (with imports `"errors"`, `"fmt"`, scorer and target):

```go
// WithTarget registers a named target, so a run can be started by name.
func WithTarget(name, description string, t target.Target) Option {
	return func(e *Engine) error {
		if name == "" || t == nil {
			return errors.New("sentinel: WithTarget needs a name and a target")
		}
		if e.targets == nil {
			e.targets = make(map[string]RegisteredTarget)
		}
		if _, dup := e.targets[name]; dup {
			return fmt.Errorf("sentinel: target %q registered twice", name)
		}
		e.targets[name] = RegisteredTarget{Name: name, Description: description, Target: t}
		return nil
	}
}

// WithScorer registers a scorer factory with a descriptor. This is how an
// application makes the LLM scorers available, since only it holds an
// LLMClient.
func WithScorer(d scorer.Descriptor, f scorer.Factory) Option {
	return func(e *Engine) error {
		if d.Name == "" || f == nil {
			return errors.New("sentinel: WithScorer needs a name and a factory")
		}
		e.pendingScorers = append(e.pendingScorers, pendingScorer{desc: d, factory: f})
		return nil
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `go test -race ./engine/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/registry_test.go
git commit --only -m "feat(engine): register targets and scorers by name

A run could only be started from Go, with target and scorer values in
hand, so the REST route always failed with ErrNoTarget. Applications
can now register named targets and scorers, and the engine lists them." -- errors.go engine/engine.go engine/options.go engine/registry_test.go
git show --stat HEAD
```

---

### Task 11: Targets receive the run's prompt, model and temperature

`LLMTarget` sends the prompt it was constructed with. `Run.SystemPrompt` is a label the model never sees, so a run recording "prompt v3" can be false. This task makes the run's choice reach the target.

**Files:**
- Modify: `target/target.go`, `target/llm.go`
- Create: `target/options_test.go`

**Interfaces:**
- Produces: `type target.CallOptions struct { SystemPrompt, Model string; Temperature float64 }`; `target.WithCallOptions(ctx context.Context, o CallOptions) context.Context`; `target.CallOptionsFrom(ctx context.Context) (CallOptions, bool)`. `LLMTarget.Call` prefers a non-empty `SystemPrompt` and `Model` from the context, and uses its `Temperature` whenever options are present.

- [ ] **Step 1: Write the failing test**

`target/options_test.go`:

```go
package target

import (
	"context"
	"testing"
)

type recordingClient struct{ model, prompt string; temp float64 }

func (c *recordingClient) Complete(_ context.Context, model, systemPrompt, _ string, temperature float64) (*LLMResponse, error) {
	c.model, c.prompt, c.temp = model, systemPrompt, temperature
	return &LLMResponse{Output: "ok"}, nil
}

func TestLLMTargetUsesTheRunsChoices(t *testing.T) {
	c := &recordingClient{}
	tgt := NewLLMTarget(c, "built-model", "built-prompt", 0.9)

	ctx := WithCallOptions(context.Background(), CallOptions{SystemPrompt: "version 3", Model: "run-model", Temperature: 0.2})
	if _, err := tgt.Call(ctx, "hi"); err != nil {
		t.Fatal(err)
	}
	if c.prompt != "version 3" || c.model != "run-model" || c.temp != 0.2 {
		t.Fatalf("target ignored the run: %+v", c)
	}
}

func TestLLMTargetFallsBackWithoutOptions(t *testing.T) {
	c := &recordingClient{}
	tgt := NewLLMTarget(c, "built-model", "built-prompt", 0.9)
	if _, err := tgt.Call(context.Background(), "hi"); err != nil {
		t.Fatal(err)
	}
	if c.prompt != "built-prompt" || c.model != "built-model" || c.temp != 0.9 {
		t.Fatalf("without options the constructed values apply: %+v", c)
	}
}

func TestEmptyOptionFieldsKeepConstructedValues(t *testing.T) {
	c := &recordingClient{}
	tgt := NewLLMTarget(c, "built-model", "built-prompt", 0.9)
	ctx := WithCallOptions(context.Background(), CallOptions{Temperature: 0})
	if _, err := tgt.Call(ctx, "hi"); err != nil {
		t.Fatal(err)
	}
	if c.prompt != "built-prompt" || c.model != "built-model" {
		t.Fatalf("empty prompt and model must not blank the constructed ones: %+v", c)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./target/ -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Append to `target/target.go`:

```go
// CallOptions carry what the run decided for this call: the prompt of the
// suite's current prompt version (or the suite's own prompt), the model and
// the temperature. A target that builds its own request should prefer these
// to whatever it was constructed with, so the prompt a run records is the
// prompt the model actually saw.
type CallOptions struct {
	SystemPrompt string
	Model        string
	Temperature  float64
}

type callOptionsKey struct{}

// WithCallOptions attaches the run's choices to ctx.
func WithCallOptions(ctx context.Context, o CallOptions) context.Context {
	return context.WithValue(ctx, callOptionsKey{}, o)
}

// CallOptionsFrom returns the run's choices, if the engine attached any.
func CallOptionsFrom(ctx context.Context) (CallOptions, bool) {
	o, ok := ctx.Value(callOptionsKey{}).(CallOptions)
	return o, ok
}
```

In `target/llm.go`, replace the `Complete` call in `Call`:

```go
	model, prompt, temperature := t.Model, t.SystemPrompt, t.Temperature
	if o, ok := CallOptionsFrom(ctx); ok {
		if o.SystemPrompt != "" {
			prompt = o.SystemPrompt
		}
		if o.Model != "" {
			model = o.Model
		}
		temperature = o.Temperature
	}
	resp, err := t.Client.Complete(ctx, model, prompt, input, temperature)
```

- [ ] **Step 4: Run the tests**

Run: `go test ./target/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add target/options_test.go
git commit --only -m "fix(target): send the run's prompt, model and temperature

LLMTarget sent the prompt it was built with, so the system prompt a run
recorded was a label the model never saw. The engine now attaches the
run's choices to the call context and LLMTarget uses them." -- target/target.go target/llm.go target/options_test.go
git show --stat HEAD
```

---

### Task 12: Scoring stops hiding absences

**Files:**
- Modify: `engine/runner.go` (`evaluateCase`)
- Create: `engine/scoring_test.go`

**Interfaces:**
- Consumes: `(*Engine).Scorers()` (Task 10); helpers (Task 6).
- Produces: `evaluateCase` scores with the run's scorers plus the case's own `Scorers` resolved through the registry. Any scorer error, including an unknown case scorer name, makes the result `error`, with `Error` naming each failing scorer; `Score` is the mean over scorers that returned. The case's stored `Context` is never mutated.

- [ ] **Step 1: Write the failing test**

`engine/scoring_test.go`:

```go
package engine_test

import (
	"context"
	"strings"
	"testing"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/engine"
	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/scorer"
	"github.com/xraph/sentinel/target"
	"github.com/xraph/sentinel/testcase"
)

func runOnce(t *testing.T, e *engine.Engine, suiteID id.SuiteID, scorers ...scorer.Scorer) *engine.RunResult {
	t.Helper()
	res, err := e.RunEval(bg(), &engine.RunConfig{
		SuiteID: suiteID,
		Target:  target.FromFunc("echo", func(_ context.Context, in string) (string, error) { return "hello " + in, nil }),
		Scorers: scorers,
	})
	if err != nil {
		t.Fatalf("RunEval: %v", err)
	}
	return res
}

func TestScorerErrorMakesTheCaseError(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p", "a")
	res := runOnce(t, e, s.ID, okScorer("good", 1, "skill"), failingScorer("judge"))

	r := res.Results[0]
	if r.Status != evalrun.StatusError {
		t.Fatalf("a scorer error must make the case error, got %s", r.Status)
	}
	if r.Score != 1 {
		t.Fatalf("score is the mean over scorers that returned: %v", r.Score)
	}
	if !strings.Contains(r.Error, "scorer judge") || !strings.Contains(r.Error, "judge timed out") {
		t.Fatalf("error must name the scorer: %q", r.Error)
	}
	if r.DimensionScores["skill"] != 1 {
		t.Fatalf("the good scorer's dimension survives: %v", r.DimensionScores)
	}
	if res.Stats.Passed != 0 || res.Stats.Errored != 1 {
		t.Fatalf("an errored case never counts as a pass: %+v", res.Stats)
	}
}

func TestCaseScorersAreApplied(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p")
	tc := &testcase.Case{Entity: sentinel.NewEntity(), SuiteID: s.ID, Name: "c", Input: "world", ScenarioType: testcase.ScenarioStandard,
		Scorers: []testcase.ScorerConfig{{Name: "contains", Config: map[string]any{"substring": "hello"}}},
		Tags:    []string{}, Context: map[string]any{}, Metadata: map[string]any{}}
	if err := e.CreateCase(bg(), tc); err != nil {
		t.Fatal(err)
	}
	res := runOnce(t, e, s.ID, okScorer("good", 1, ""))
	if n := len(res.Results[0].ScorerResults); n != 2 {
		t.Fatalf("run scorer plus case scorer: got %d scorer results", n)
	}
	if res.Results[0].Status != evalrun.StatusPass {
		t.Fatalf("both scorers pass: %+v", res.Results[0])
	}
}

func TestUnknownCaseScorerIsVisiblyUnscored(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p")
	tc := &testcase.Case{Entity: sentinel.NewEntity(), SuiteID: s.ID, Name: "c", Input: "x", ScenarioType: testcase.ScenarioStandard,
		Scorers: []testcase.ScorerConfig{{Name: "nope"}}, Tags: []string{}, Context: map[string]any{}, Metadata: map[string]any{}}
	if err := e.CreateCase(bg(), tc); err != nil {
		t.Fatal(err)
	}
	r := runOnce(t, e, s.ID, okScorer("good", 1, "")).Results[0]
	if r.Status != evalrun.StatusError || !strings.Contains(r.Error, `unknown scorer "nope"`) {
		t.Fatalf("unknown case scorer: status=%s error=%q", r.Status, r.Error)
	}
}

func TestCaseContextIsNotMutated(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p", "a")
	runOnce(t, e, s.ID, okScorer("good", 1, ""))
	cases, _ := e.ListCases(bg(), s.ID)
	if _, leaked := cases[0].Context["latency_ms"]; leaked {
		t.Fatal("the engine wrote latency_ms into the stored case's context")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test -race ./engine/ -run 'Scorer|CaseScorers|Unknown|Context' -v`
Expected: FAIL (status is `pass`/`fail`, case scorers ignored, context mutated).

- [ ] **Step 3: Implement**

In `engine/runner.go`, replace the section of `evaluateCase` from `// Build scorer input.` through the pass/fail decision with:

```go
	// Copy the case's context: the stored case must not gain latency_ms and
	// cost, and two runs of one suite must not write the same map.
	scorerCtx := make(map[string]any, len(tc.Context)+2)
	for k, v := range tc.Context {
		scorerCtx[k] = v
	}
	scorerCtx["latency_ms"] = float64(result.LatencyMs)
	scorerCtx["cost"] = result.Cost

	input := &scorer.Input{
		Input:    tc.Input,
		Expected: tc.Expected,
		Actual:   output.Output,
		Trace:    output.Trace,
		Context:  scorerCtx,
	}

	// The run's scorers, then the case's own, resolved by name. A case scorer
	// nobody registered is a scorer error like any other, so the case is
	// visibly unscored instead of silently scored by fewer scorers.
	all := append([]scorer.Scorer(nil), scorers...)
	var scorerErrs []string
	var scorerResults []evalrun.ScorerResult
	for _, cfg := range tc.Scorers {
		s, err := e.scorers.Get(cfg.Name, cfg.Config)
		if err != nil {
			scorerErrs = append(scorerErrs, fmt.Sprintf("scorer %s: %v", cfg.Name, err))
			scorerResults = append(scorerResults, evalrun.ScorerResult{ScorerName: cfg.Name, Reason: "scorer error: " + err.Error()})
			continue
		}
		all = append(all, s)
	}

	var total float64
	var scored int
	dimensionScores := make(map[string]float64)
	dimensionCounts := make(map[string]int)
	for _, s := range all {
		so, err := s.Score(ctx, input)
		if err != nil {
			scorerErrs = append(scorerErrs, fmt.Sprintf("scorer %s: %v", s.Name(), err))
			scorerResults = append(scorerResults, evalrun.ScorerResult{ScorerName: s.Name(), Reason: "scorer error: " + err.Error()})
			continue
		}
		scorerResults = append(scorerResults, evalrun.ScorerResult{
			ScorerName: s.Name(), Score: so.Score, Passed: so.Passed, Reason: so.Reason, Dimension: so.Dimension, Details: so.Details,
		})
		total += so.Score
		scored++
		if so.Dimension != "" {
			dimensionScores[so.Dimension] += so.Score
			dimensionCounts[so.Dimension]++
		}
	}
	if scored > 0 {
		result.Score = total / float64(scored)
	}
	for dim, sum := range dimensionScores {
		dimensionScores[dim] = sum / float64(dimensionCounts[dim])
	}
	result.ScorerResults = scorerResults
	result.DimensionScores = dimensionScores

	// A case any scorer could not judge is an error, never a pass: its score
	// covers fewer scorers than the run asked for.
	switch {
	case len(scorerErrs) > 0:
		result.Status = evalrun.StatusError
		result.Error = strings.Join(scorerErrs, "; ")
	case result.Score >= e.config.PassThreshold:
		result.Status = evalrun.StatusPass
	default:
		result.Status = evalrun.StatusFail
	}
```

Add `"strings"` to the imports. The target-error branch above this section is unchanged, but make sure it sets `ScorerResults: []evalrun.ScorerResult{}` and `DimensionScores: map[string]float64{}` on the result before returning, so an errored result never writes nil JSON.

- [ ] **Step 4: Run the tests**

Run: `go test -race ./engine/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/scoring_test.go
git commit --only -m "fix(engine): make a case that could not be scored an error

A scorer error counted as a zero in the case average while its
dimension vanished, and the engine ignored per-case scorer configs,
including red team's leakage check. Both now count: the case scorers
run, and any scorer error makes the case error, never a pass." -- engine/runner.go engine/scoring_test.go
git show --stat HEAD
```

---

### Task 13: Runs start asynchronously, persist per case, and can be cancelled

**Files:**
- Modify: `engine/runner.go` (rewrite `RunEval`; add `StartRun`, `CancelRun`, `planRun`, `executeRun`, `finishRun`, `stopRequested`, `effectivePrompt`)
- Modify: `engine/engine.go` (`baseCtx`, `cancelBase`, `runs sync.WaitGroup` fields; `New`; `Stop`)
- Create: `engine/runner_test.go`

**Interfaces:**
- Consumes: `evalrun.Settings`, `Finalization`, `ApplyStats` (Task 5); `CancelRun`, `FinalizeRun` (Task 8); registries (Task 10); `target.WithCallOptions` (Task 11); scoring (Task 12).
- Produces:
  - `type engine.StartConfig struct { SuiteID id.SuiteID; Target string; Scorers []string; Model string }`
  - `(*Engine).StartRun(ctx context.Context, cfg *StartConfig) (*evalrun.Run, error)`: validates everything, creates the run and returns it; evaluation continues on the engine's own context.
  - `(*Engine).CancelRun(ctx context.Context, runID id.EvalRunID) error`: `ErrRunNotFound`, or `ErrInvalidState` when not running.
  - `(*Engine).RunEval` keeps its signature and stays synchronous.
  - `(*Engine).effectivePrompt(ctx, s *suite.Suite) (prompt, promptVersionID string, err error)`, used again in Task 16.
  - `finishRun` calls `e.checkRegression`, which Task 14 adds; in this task `finishRun` does not call it yet.

- [ ] **Step 1: Write the failing tests**

`engine/runner_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/engine"
	"github.com/xraph/sentinel/evalrun"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/promptversion"
	"github.com/xraph/sentinel/scorer"
	"github.com/xraph/sentinel/store/memory"
	"github.com/xraph/sentinel/target"
)

// gated returns a target that answers one case each time release receives.
// It reports each input on entered (when entered is not nil) before it
// blocks, so a test can release a case it knows is waiting, and it records
// the call options it saw.
func gated(release <-chan struct{}, entered chan<- string, seen *target.CallOptions, mu *sync.Mutex) target.Target {
	return target.FromFunc("gated", func(ctx context.Context, in string) (string, error) {
		if o, ok := target.CallOptionsFrom(ctx); ok && seen != nil {
			mu.Lock()
			*seen = o
			mu.Unlock()
		}
		if entered != nil {
			entered <- in
		}
		select {
		case <-release:
			return "ok " + in, nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	})
}

func startGated(t *testing.T, e *engine.Engine, suiteID id.SuiteID) *evalrun.Run {
	t.Helper()
	run, err := e.StartRun(bg(), &engine.StartConfig{SuiteID: suiteID, Target: "gated", Scorers: []string{"good"}})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	return run
}

func goodScorer() engine.Option {
	return engine.WithScorer(scorer.Descriptor{Name: "good"}, func(map[string]any) (scorer.Scorer, error) { return okScorer("good", 1, "skill"), nil })
}

func stateOf(e *engine.Engine, runID id.EvalRunID) evalrun.RunState {
	r, err := e.GetRun(bg(), runID)
	if err != nil {
		return ""
	}
	return r.State
}

func TestStartRunReturnsAtOnceAndPersistsPerCase(t *testing.T) {
	release := make(chan struct{})
	e, _ := newEngine(t, engine.WithTarget("gated", "test", gated(release, nil, nil, nil)), goodScorer(),
		engine.WithConfig(configWith(1)))
	s := seedSuite(t, e, "p", "a", "b", "c")

	run := startGated(t, e, s.ID)
	if run.State != evalrun.StateRunning || run.TotalCases != 3 {
		t.Fatalf("started run: %+v", run)
	}

	release <- struct{}{}
	waitFor(t, "one stored result", func() bool { r, _ := e.ListResults(bg(), run.ID); return len(r) == 1 })
	if stateOf(e, run.ID) != evalrun.StateRunning {
		t.Fatal("the run must still be running with one of three results stored")
	}

	release <- struct{}{}
	release <- struct{}{}
	waitFor(t, "completion", func() bool { return stateOf(e, run.ID) == evalrun.StateCompleted })
	done, _ := e.GetRun(bg(), run.ID)
	if done.Passed != 3 || done.PassRate != 1 || done.CompletedAt == nil {
		t.Fatalf("final counters come from the stored results: %+v", done)
	}
}

func TestCancelStopsSchedulingAndKeepsPartialCounts(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan string, 10)
	e, _ := newEngine(t, engine.WithTarget("gated", "test", gated(release, entered, nil, nil)), goodScorer(),
		engine.WithConfig(configWith(1)))
	s := seedSuite(t, e, "p", "a", "b", "c", "d")
	run := startGated(t, e, s.ID)

	<-entered             // case a is waiting in the target
	release <- struct{}{} // case a finishes
	<-entered             // case b is now in flight: concurrency is 1, so nothing else is
	if err := e.CancelRun(bg(), run.ID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	release <- struct{}{} // let b finish; the runner must not start c

	waitFor(t, "the runner to finish", func() bool {
		r, _ := e.GetRun(bg(), run.ID)
		return r.State == evalrun.StateCancelled && r.Passed == 2
	})
	results, _ := e.ListResults(bg(), run.ID)
	if len(results) != 2 {
		t.Fatalf("in-flight case stored, nothing after it: %d results", len(results))
	}
	if err := e.CancelRun(bg(), run.ID); !errors.Is(err, sentinel.ErrInvalidState) {
		t.Fatalf("cancelling a cancelled run: want ErrInvalidState, got %v", err)
	}
	if err := e.CancelRun(bg(), id.NewEvalRunID()); !errors.Is(err, sentinel.ErrRunNotFound) {
		t.Fatalf("cancelling a missing run: want ErrRunNotFound, got %v", err)
	}
}

func TestStartRunRefusesBeforeWritingAnything(t *testing.T) {
	e, _ := newEngine(t, engine.WithTarget("gated", "test", gated(make(chan struct{}), nil, nil, nil)), goodScorer())
	s := seedSuite(t, e, "p", "a")
	empty := seedSuite(t, e, "p")

	cases := []struct {
		name string
		cfg  engine.StartConfig
		want error
	}{
		{"unknown target", engine.StartConfig{SuiteID: s.ID, Target: "nope", Scorers: []string{"good"}}, sentinel.ErrUnknownTarget},
		{"unknown scorer", engine.StartConfig{SuiteID: s.ID, Target: "gated", Scorers: []string{"nope"}}, sentinel.ErrUnknownScorer},
		{"no scorers", engine.StartConfig{SuiteID: s.ID, Target: "gated"}, sentinel.ErrNoScorers},
		{"no cases", engine.StartConfig{SuiteID: empty.ID, Target: "gated", Scorers: []string{"good"}}, sentinel.ErrEmptyInput},
	}
	for _, c := range cases {
		cfg := c.cfg
		if _, err := e.StartRun(bg(), &cfg); !errors.Is(err, c.want) {
			t.Errorf("%s: want %v, got %v", c.name, c.want, err)
		}
	}
	if runs, _ := e.ListRuns(bg(), &evalrun.ListFilter{}); len(runs) != 0 {
		t.Fatalf("a refused start must write no run, found %d", len(runs))
	}
}

func TestRunRecordsSettingsAndSendsTheCurrentPrompt(t *testing.T) {
	release := make(chan struct{}, 1)
	var seen target.CallOptions
	var mu sync.Mutex
	e, _ := newEngine(t, engine.WithTarget("gated", "test", gated(release, nil, &seen, &mu)), goodScorer())
	s := seedSuite(t, e, "suite prompt", "a")
	pv := &promptversion.PromptVersion{SuiteID: s.ID, SystemPrompt: "version prompt", IsCurrent: true}
	if err := e.CreatePromptVersion(bg(), pv); err != nil {
		t.Fatal(err)
	}

	release <- struct{}{}
	run := startGated(t, e, s.ID)
	waitFor(t, "completion", func() bool { return stateOf(e, run.ID) == evalrun.StateCompleted })

	got, _ := e.GetRun(bg(), run.ID)
	st := evalrun.SettingsFrom(got.Config)
	if st.PassThreshold == nil || *st.PassThreshold != 0.7 || st.RegressionThreshold == nil || *st.RegressionThreshold != 0.05 {
		t.Fatalf("thresholds not recorded: %+v", st)
	}
	if st.Target != "gated" || len(st.Scorers) != 1 || st.Scorers[0] != "good" || st.PromptVersionID != pv.ID.String() {
		t.Fatalf("settings: %+v", st)
	}
	if got.SystemPrompt != "version prompt" {
		t.Fatalf("the run records the current version's prompt: %q", got.SystemPrompt)
	}
	mu.Lock()
	defer mu.Unlock()
	if seen.SystemPrompt != "version prompt" {
		t.Fatalf("the target must receive the prompt the run records: %q", seen.SystemPrompt)
	}
}

// failingResults refuses to store results for one case name.
type failingResults struct {
	*memory.Store
	failFor string
}

func (f *failingResults) CreateResult(ctx context.Context, r *evalrun.Result) error {
	if r.CaseName == f.failFor {
		return errors.New("disk full")
	}
	return f.Store.CreateResult(ctx, r)
}

// Review focus 4.
func TestAnUnstoredResultFailsTheRun(t *testing.T) {
	st := &failingResults{Store: memory.New(), failFor: "b"}
	e, err := engine.New(engine.WithStore(st))
	if err != nil {
		t.Fatal(err)
	}
	s := seedSuite(t, e, "p", "a", "b", "c")
	res, err := e.RunEval(bg(), &engine.RunConfig{SuiteID: s.ID,
		Target:  target.FromFunc("echo", func(_ context.Context, in string) (string, error) { return in, nil }),
		Scorers: []scorer.Scorer{okScorer("good", 1, "")}})
	if err == nil {
		t.Fatal("RunEval must report the failure")
	}
	if res == nil || res.Run.State != evalrun.StateFailed || res.Run.Error != "1 of 3 results could not be stored" {
		t.Fatalf("run: %+v", res)
	}
}

// Review focus 5.
func TestStopCancelsActiveRuns(t *testing.T) {
	release := make(chan struct{})
	st := memory.New()
	e, err := engine.New(engine.WithStore(st), engine.WithTarget("gated", "test", gated(release, nil, nil, nil)), goodScorer(),
		engine.WithConfig(configWith(1)))
	if err != nil {
		t.Fatal(err)
	}
	s := seedSuite(t, e, "p", "a", "b", "c")
	run := startGated(t, e, s.ID)

	if err := e.Stop(bg()); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	got, err := st.GetRun(bg(), run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != evalrun.StateCancelled {
		t.Fatalf("a run interrupted by shutdown must end cancelled, got %s", got.State)
	}
}

func TestRunEvalStaysSynchronous(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p", "a", "b")
	res, err := e.RunEval(bg(), &engine.RunConfig{SuiteID: s.ID,
		Target:  target.FromFunc("echo", func(_ context.Context, in string) (string, error) { return in, nil }),
		Scorers: []scorer.Scorer{okScorer("good", 1, "")}})
	if err != nil || res.Run.State != evalrun.StateCompleted || len(res.Results) != 2 || res.Stats.Passed != 2 {
		t.Fatalf("RunEval: %v %+v", err, res)
	}
}

func configWith(concurrency int) sentinel.Config {
	c := sentinel.DefaultConfig()
	c.Concurrency = concurrency
	c.ShutdownTimeout = 2 * time.Second
	return c
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go test -race ./engine/ -run 'StartRun|Cancel|Refuses|Records|Unstored|Stop|Synchronous' -v`
Expected: FAIL to compile (`StartRun`, `StartConfig`, `CancelRun` undefined).

- [ ] **Step 3: Add the engine's own context**

In `engine/engine.go`, add fields to `Engine`:

```go
	baseCtx    context.Context    // runs started with StartRun evaluate on this
	cancelBase context.CancelFunc // Stop cancels it
	runs       sync.WaitGroup     // StartRun goroutines still evaluating
```

In `New`, before the options loop:

```go
	e.baseCtx, e.cancelBase = context.WithCancel(context.Background())
```

Replace `Stop`:

```go
// Stop cancels runs this process is evaluating, waits up to ShutdownTimeout
// for them to record their cancellation, then shuts extensions and the store
// down. A run cancelled here ends cancelled, with the results it stored.
func (e *Engine) Stop(ctx context.Context) error {
	e.cancelBase()
	done := make(chan struct{})
	go func() { e.runs.Wait(); close(done) }()
	timeout := e.config.ShutdownTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	select {
	case <-done:
	case <-time.After(timeout):
		e.logger.Warn("sentinel: runs still finishing at shutdown timeout")
	case <-ctx.Done():
	}
	if e.extensions != nil {
		e.extensions.EmitShutdown(ctx)
	}
	if e.store != nil {
		return e.store.Close()
	}
	return nil
}
```

Add imports `"sync"` and `"time"`.

- [ ] **Step 4: Rewrite the runner**

In `engine/runner.go`, replace `RunEval`, `failRun` and `aggregateStats` (the last is no longer used: counters come from the store) with the code below. Keep `RunConfig`, `RunResult` and the Task 12 `evaluateCase`. Remove the old `failRun` call sites.

```go
// StartConfig starts a run by the names an application registered with
// WithTarget and WithScorer.
type StartConfig struct {
	SuiteID id.SuiteID
	Target  string
	Scorers []string
	Model   string
}

// runPlan is a validated run, created in the store and ready to evaluate.
type runPlan struct {
	run         *evalrun.Run
	cases       []*testcase.Case
	target      target.Target
	scorers     []scorer.Scorer
	concurrency int
}

// RunEval runs a suite synchronously with target and scorer values, for Go
// and CI callers. Results are stored as each case finishes, exactly as for
// StartRun, and cancelling ctx cancels the run.
func (e *Engine) RunEval(ctx context.Context, cfg *RunConfig) (*RunResult, error) {
	if cfg.Target == nil {
		return nil, sentinel.ErrNoTarget
	}
	if len(cfg.Scorers) == 0 {
		return nil, sentinel.ErrNoScorers
	}
	names := make([]string, len(cfg.Scorers))
	for i, s := range cfg.Scorers {
		names[i] = s.Name()
	}
	plan, err := e.planRun(ctx, cfg.SuiteID, cfg.Model, cfg.PersonaRef, cfg.Concurrency, cfg.Target, cfg.Target.Name(), cfg.Scorers, names)
	if err != nil {
		return nil, err
	}
	return e.executeRun(ctx, plan)
}

// StartRun validates a run, creates it and returns at once. Evaluation
// continues on the engine's own context, so the request that started it
// can return; poll the run and its results to watch it, and CancelRun to
// stop it. Every refusal happens before anything is written.
func (e *Engine) StartRun(ctx context.Context, cfg *StartConfig) (*evalrun.Run, error) {
	if e.store == nil {
		return nil, sentinel.ErrNoStore
	}
	rt, ok := e.targets[cfg.Target]
	if !ok {
		return nil, fmt.Errorf("%w %q", sentinel.ErrUnknownTarget, cfg.Target)
	}
	if len(cfg.Scorers) == 0 {
		return nil, sentinel.ErrNoScorers
	}
	scorers := make([]scorer.Scorer, 0, len(cfg.Scorers))
	for _, name := range cfg.Scorers {
		s, err := e.scorers.Get(name, nil)
		if err != nil {
			return nil, fmt.Errorf("%w %q", sentinel.ErrUnknownScorer, name)
		}
		scorers = append(scorers, s)
	}
	plan, err := e.planRun(ctx, cfg.SuiteID, cfg.Model, "", 0, rt.Target, rt.Name, scorers, cfg.Scorers)
	if err != nil {
		return nil, err
	}
	started := *plan.run
	e.runs.Add(1)
	go func() {
		defer e.runs.Done()
		if _, err := e.executeRun(e.baseCtx, plan); err != nil {
			e.logger.Warn("sentinel: run ended with an error",
				log.String("run_id", plan.run.ID.String()), log.String("error", err.Error()))
		}
	}()
	return &started, nil
}

// CancelRun asks a running run to stop. The runner stops scheduling cases
// at its next check; cases already in flight finish and are stored. It works
// from any replica because the signal lives in the store.
func (e *Engine) CancelRun(ctx context.Context, runID id.EvalRunID) error {
	if e.store == nil {
		return sentinel.ErrNoStore
	}
	ok, err := e.store.CancelRun(ctx, runID, time.Now().UTC())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%w: run %s is not running", sentinel.ErrInvalidState, runID)
	}
	return nil
}

// effectivePrompt is the prompt a run of this suite sends: the current
// prompt version's if the suite has one, otherwise the suite's own.
func (e *Engine) effectivePrompt(ctx context.Context, s *suite.Suite) (string, string, error) {
	pv, err := e.store.GetCurrentPromptVersion(ctx, s.ID)
	switch {
	case err == nil:
		return pv.SystemPrompt, pv.ID.String(), nil
	case errors.Is(err, sentinel.ErrPromptVersionNotFound):
		return s.SystemPrompt, "", nil
	default:
		return "", "", fmt.Errorf("sentinel: load current prompt version: %w", err)
	}
}

func (e *Engine) planRun(ctx context.Context, suiteID id.SuiteID, model, personaRef string, concurrency int,
	tgt target.Target, targetName string, scorers []scorer.Scorer, scorerNames []string) (*runPlan, error) {
	if e.store == nil {
		return nil, sentinel.ErrNoStore
	}
	s, err := e.store.GetSuite(ctx, suiteID)
	if err != nil {
		return nil, fmt.Errorf("sentinel: load suite: %w", err)
	}
	cases, err := e.store.ListCases(ctx, suiteID)
	if err != nil {
		return nil, fmt.Errorf("sentinel: load cases: %w", err)
	}
	if len(cases) == 0 {
		return nil, sentinel.ErrEmptyInput
	}
	prompt, pvID, err := e.effectivePrompt(ctx, s)
	if err != nil {
		return nil, err
	}
	if model == "" {
		model = s.Model
	}
	if model == "" {
		model = e.config.DefaultModel
	}
	if personaRef == "" {
		personaRef = s.PersonaRef
	}
	if concurrency <= 0 {
		concurrency = e.config.Concurrency
	}
	if concurrency <= 0 {
		concurrency = 1
	}

	passThreshold, regressionThreshold := e.config.PassThreshold, e.config.RegressionThreshold
	settings := evalrun.Settings{
		PassThreshold: &passThreshold, RegressionThreshold: &regressionThreshold, Concurrency: &concurrency,
		Target: targetName, Scorers: scorerNames, Model: model, PromptVersionID: pvID,
	}
	run := &evalrun.Run{
		Entity:          sentinel.NewEntity(),
		ID:              id.NewEvalRunID(),
		SuiteID:         suiteID,
		Model:           model,
		SystemPrompt:    prompt,
		Temperature:     s.Temperature,
		TotalCases:      len(cases),
		AppID:           s.AppID,
		PersonaRef:      personaRef,
		Config:          settings.Config(),
		State:           evalrun.StateRunning,
		DimensionScores: map[string]float64{},
	}
	if err := e.store.CreateRun(ctx, run); err != nil {
		return nil, fmt.Errorf("sentinel: create run: %w", err)
	}
	e.extensions.EmitEvalRunStarted(ctx, suiteID, run.ID, model)
	if personaRef != "" {
		e.extensions.EmitPersonaEvalStarted(ctx, run.ID, personaRef)
	}
	return &runPlan{run: run, cases: cases, target: tgt, scorers: scorers, concurrency: concurrency}, nil
}

// executeRun evaluates the plan's cases, storing each result as it
// finishes, and stops scheduling when the run is cancelled or ctx ends.
func (e *Engine) executeRun(ctx context.Context, p *runPlan) (*RunResult, error) {
	run := p.run
	// Writes must land even after ctx is cancelled: a run stopped by
	// shutdown still records what it did.
	writeCtx := context.WithoutCancel(ctx)
	callCtx := target.WithCallOptions(ctx, target.CallOptions{SystemPrompt: run.SystemPrompt, Model: run.Model, Temperature: run.Temperature})

	sem := make(chan struct{}, p.concurrency)
	var wg sync.WaitGroup
	var unwritten atomic.Int64
	for _, tc := range p.cases {
		sem <- struct{}{}
		if e.stopRequested(ctx, writeCtx, run.ID) {
			<-sem
			break
		}
		wg.Add(1)
		go func(tc *testcase.Case) {
			defer wg.Done()
			defer func() { <-sem }()
			result := e.evaluateCase(callCtx, run.ID, tc, p.target, p.scorers)
			if err := e.store.CreateResult(writeCtx, result); err != nil {
				unwritten.Add(1)
				e.logger.Warn("sentinel: store result",
					log.String("run_id", run.ID.String()), log.String("case_id", tc.ID.String()), log.String("error", err.Error()))
			}
		}(tc)
	}
	wg.Wait()
	return e.finishRun(writeCtx, p, unwritten.Load())
}

// stopRequested reports whether the runner should stop scheduling. A done
// ctx means this process is stopping the run, so it records the cancel
// itself; otherwise it reads the run, because the cancel may have come from
// another replica.
func (e *Engine) stopRequested(ctx, writeCtx context.Context, runID id.EvalRunID) bool {
	if ctx.Err() != nil {
		if _, err := e.store.CancelRun(writeCtx, runID, time.Now().UTC()); err != nil {
			e.logger.Warn("sentinel: record cancel", log.String("run_id", runID.String()), log.String("error", err.Error()))
		}
		return true
	}
	r, err := e.store.GetRun(writeCtx, runID)
	if err != nil {
		e.logger.Warn("sentinel: check run state", log.String("run_id", runID.String()), log.String("error", err.Error()))
		return false
	}
	return r.State == evalrun.StateCancelled
}

// finishRun computes counters from the stored results and finalises the
// run. The store keeps a cancel that arrived meanwhile.
func (e *Engine) finishRun(ctx context.Context, p *runPlan, unwritten int64) (*RunResult, error) {
	run := p.run
	stats, err := e.store.GetResultStats(ctx, run.ID)
	if err != nil {
		e.logger.Warn("sentinel: read result stats", log.String("run_id", run.ID.String()), log.String("error", err.Error()))
		stats = &evalrun.ResultStats{DimensionScores: map[string]float64{}}
	}
	f := &evalrun.Finalization{Stats: stats, State: evalrun.StateCompleted, CompletedAt: time.Now().UTC()}
	if unwritten > 0 {
		f.State = evalrun.StateFailed
		f.Error = fmt.Sprintf("%d of %d results could not be stored", unwritten, run.TotalCases)
	}
	state, err := e.store.FinalizeRun(ctx, run.ID, f)
	if err != nil {
		return nil, fmt.Errorf("sentinel: finalize run: %w", err)
	}
	run.ApplyStats(stats)
	run.State = state
	run.CompletedAt = &f.CompletedAt
	if f.Error != "" {
		run.Error = f.Error
	}
	results, err := e.store.ListResults(ctx, run.ID)
	if err != nil {
		e.logger.Warn("sentinel: list results", log.String("run_id", run.ID.String()), log.String("error", err.Error()))
	}
	res := &RunResult{Run: run, Results: results, Stats: stats}

	switch state {
	case evalrun.StateCompleted:
		e.extensions.EmitEvalRunCompleted(ctx, run.SuiteID, run.ID, stats.PassRate, time.Since(run.CreatedAt))
		if run.PersonaRef != "" {
			e.extensions.EmitPersonaEvalCompleted(ctx, run.ID, run.PersonaRef, stats.DimensionScores)
		}
	case evalrun.StateFailed:
		failure := errors.New(run.Error)
		e.extensions.EmitEvalRunFailed(ctx, run.SuiteID, run.ID, failure)
		return res, fmt.Errorf("sentinel: %w", failure)
	}
	return res, nil
}
```

Imports for `runner.go`: `"context"`, `"errors"`, `"fmt"`, `"sync"`, `"sync/atomic"`, `"strings"` (Task 12), `"time"`, go-utils `log`, and `sentinel`, `evalrun`, `id`, `scorer`, `suite`, `target`, `testcase`.

- [ ] **Step 5: Run the tests, with the race detector**

Run: `go test -race -count=3 ./engine/ -v`
Expected: PASS, three times. A flake here is a real ordering bug; do not add sleeps to hide it.

- [ ] **Step 6: Check nothing else broke**

Run: `go build ./... && go test -race ./...`
Expected: PASS. `api/run_handler.go` still calls `RunEval` and compiles unchanged.

- [ ] **Step 7: Commit**

```bash
git add engine/runner_test.go
git commit --only -m "feat(engine): start runs asynchronously and store results per case

RunEval wrote every result in one batch at the end, so a running run
showed zeros until it finished, and nothing could stop it. StartRun now
returns at once, each result is stored as its case finishes, CancelRun
stops scheduling from any replica, and Stop cancels runs this process
owns." -- engine/engine.go engine/runner.go engine/runner_test.go
git show --stat HEAD
```

---

### Task 14: Regression is checked when a run completes

**Files:**
- Modify: `engine/runner.go` (add `checkRegression`, call it from `finishRun`)
- Create: `engine/regression_test.go`

**Interfaces:**
- Consumes: `baseline.DetectRegression`, `WorstDelta` (Task 9); `evalrun.SettingsFrom` (Task 5); `finishRun` (Task 13).
- Produces: on a completed run with a current baseline, `RegressionDetected` hooks fire with the baseline id and the worst delta, using the run's recorded regression threshold.

- [ ] **Step 1: Write the failing test**

`engine/regression_test.go`:

```go
package engine_test

import (
	"context"
	"sync"
	"testing"

	"github.com/xraph/sentinel/baseline"
	"github.com/xraph/sentinel/engine"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/scorer"
	"github.com/xraph/sentinel/target"
)

type regressionRecorder struct {
	mu        sync.Mutex
	baselines []string
	deltas    []float64
}

func (r *regressionRecorder) Name() string { return "recorder" }
func (r *regressionRecorder) OnRegressionDetected(_ context.Context, _ id.SuiteID, baselineID id.BaselineID, delta float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.baselines = append(r.baselines, baselineID.String())
	r.deltas = append(r.deltas, delta)
	return nil
}

func TestRegressionHookFiresAgainstTheCurrentBaseline(t *testing.T) {
	rec := &regressionRecorder{}
	e, _ := newEngine(t, engine.WithExtension(rec))
	s := seedSuite(t, e, "p", "a", "b")
	echo := target.FromFunc("echo", func(_ context.Context, in string) (string, error) { return in, nil })

	good, err := e.RunEval(bg(), &engine.RunConfig{SuiteID: s.ID, Target: echo, Scorers: []scorer.Scorer{okScorer("s", 1, "")}})
	if err != nil {
		t.Fatal(err)
	}
	b := &baseline.Baseline{SuiteID: s.ID, RunID: good.Run.ID, Name: "good", PassRate: good.Run.PassRate, AvgScore: good.Run.AvgScore,
		DimensionScores: map[string]float64{}, IsCurrent: true}
	for _, r := range good.Results {
		b.Results = append(b.Results, baseline.Result{CaseID: r.CaseID, CaseName: r.CaseName, Score: r.Score, Status: string(r.Status)})
	}
	if err := e.SaveBaseline(bg(), b); err != nil {
		t.Fatal(err)
	}

	if _, err := e.RunEval(bg(), &engine.RunConfig{SuiteID: s.ID, Target: echo, Scorers: []scorer.Scorer{okScorer("s", 0.5, "")}}); err != nil {
		t.Fatal(err)
	}

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.baselines) != 1 || rec.baselines[0] != b.ID.String() {
		t.Fatalf("hook should fire once against the current baseline: %v", rec.baselines)
	}
	if rec.deltas[0] != -1 {
		t.Fatalf("worst delta is the pass rate falling from 1 to 0: %v", rec.deltas[0])
	}
}

func TestNoBaselineNoHook(t *testing.T) {
	rec := &regressionRecorder{}
	e, _ := newEngine(t, engine.WithExtension(rec))
	s := seedSuite(t, e, "p", "a")
	echo := target.FromFunc("echo", func(_ context.Context, in string) (string, error) { return in, nil })
	if _, err := e.RunEval(bg(), &engine.RunConfig{SuiteID: s.ID, Target: echo, Scorers: []scorer.Scorer{okScorer("s", 0, "")}}); err != nil {
		t.Fatal(err)
	}
	if len(rec.baselines) != 0 {
		t.Fatal("with no baseline there is nothing to regress against")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test -race ./engine/ -run 'RegressionHook|NoBaseline' -v`
Expected: FAIL ("hook should fire once").

- [ ] **Step 3: Implement**

In `engine/runner.go`, add:

```go
// checkRegression compares a completed run with its suite's current
// baseline, using the regression threshold the run recorded, and fires
// RegressionDetected when it regressed. No baseline means nothing to
// compare against, which is not a pass and not a regression.
func (e *Engine) checkRegression(ctx context.Context, run *evalrun.Run, stats *evalrun.ResultStats, results []*evalrun.Result) {
	b, err := e.store.GetLatestBaseline(ctx, run.SuiteID)
	if err != nil {
		if !errors.Is(err, sentinel.ErrBaselineNotFound) {
			e.logger.Warn("sentinel: load baseline", log.String("run_id", run.ID.String()), log.String("error", err.Error()))
		}
		return
	}
	threshold := e.config.RegressionThreshold
	if v := evalrun.SettingsFrom(run.Config).RegressionThreshold; v != nil {
		threshold = *v
	}
	rr := baseline.DetectRegression(stats, results, b, threshold)
	if rr.HasRegression {
		e.extensions.EmitRegressionDetected(ctx, run.SuiteID, b.ID, rr.WorstDelta())
	}
}
```

In `finishRun`'s `case evalrun.StateCompleted:` branch, after the persona hook, add:

```go
		e.checkRegression(ctx, run, stats, results)
```

Add the import `"github.com/xraph/sentinel/baseline"`.

- [ ] **Step 4: Run the tests**

Run: `go test -race ./engine/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/regression_test.go
git commit --only -m "feat(engine): check for regression when a run completes

DetectRegression existed and nothing called it, so the
RegressionDetected hook never fired. A completed run is now compared
with its suite's current baseline at the threshold the run recorded." -- engine/runner.go engine/regression_test.go
git show --stat HEAD
```

---

### Task 15: Case import imports

**Files:**
- Modify: `engine/engine.go` (`ImportCases`)
- Modify: `testcase/store.go` (document `ImportCases` as unused)
- Create: `engine/import_test.go`

**Interfaces:**
- Consumes: `testcase.ImportJSON`, `ImportCSV`, `ImportJSONL`; `sentinel.ErrUnsupportedFormat` (Task 10).
- Produces: `(*Engine).ImportCases(ctx, suiteID, format string, data []byte) (int64, error)` parses `json`, `csv` or `jsonl` and writes through `CreateCaseBatch`. `ErrUnsupportedFormat` for anything else, `ErrEmptyInput` for zero cases, `ErrSuiteNotFound` for a missing suite.

- [ ] **Step 1: Write the failing test**

`engine/import_test.go`:

```go
package engine_test

import (
	"errors"
	"testing"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/id"
)

func TestImportCases(t *testing.T) {
	e, _ := newEngine(t)
	cases := []struct {
		format, data string
		want         int64
	}{
		{"json", `[{"name":"a","input":"x"},{"name":"b","input":"y","tags":["t"]}]`, 2},
		{"csv", "name,input,expected,tags\na,x,,t1;t2\n", 1},
		{"jsonl", "{\"name\":\"a\",\"input\":\"x\"}\n{\"name\":\"b\",\"input\":\"y\"}\n", 2},
	}
	for _, c := range cases {
		s := seedSuite(t, e, "p")
		n, err := e.ImportCases(bg(), s.ID, c.format, []byte(c.data))
		if err != nil || n != c.want {
			t.Fatalf("%s: n=%d err=%v", c.format, n, err)
		}
		stored, _ := e.ListCases(bg(), s.ID)
		if int64(len(stored)) != c.want {
			t.Fatalf("%s: imported %d, stored %d", c.format, n, len(stored))
		}
	}
}

func TestImportRefusals(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p")
	if _, err := e.ImportCases(bg(), s.ID, "yaml", []byte("x")); !errors.Is(err, sentinel.ErrUnsupportedFormat) {
		t.Errorf("yaml: %v", err)
	}
	if _, err := e.ImportCases(bg(), s.ID, "json", []byte("[]")); !errors.Is(err, sentinel.ErrEmptyInput) {
		t.Errorf("empty: %v", err)
	}
	if _, err := e.ImportCases(bg(), s.ID, "json", []byte("{nope")); err == nil {
		t.Error("malformed json must fail")
	}
	if _, err := e.ImportCases(bg(), id.NewSuiteID(), "json", []byte(`[{"name":"a","input":"x"}]`)); !errors.Is(err, sentinel.ErrSuiteNotFound) {
		t.Errorf("missing suite: %v", err)
	}
	if stored, _ := e.ListCases(bg(), s.ID); len(stored) != 0 {
		t.Fatalf("refused imports must write nothing: %d", len(stored))
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./engine/ -run Import -v`
Expected: FAIL (imports return 0 with no error).

- [ ] **Step 3: Implement**

In `engine/engine.go`, replace `ImportCases`:

```go
// ImportCases parses cases in json, csv or jsonl and writes them to a
// suite. The store's ImportCases was a stub in every backend and is no
// longer called.
func (e *Engine) ImportCases(ctx context.Context, suiteID id.SuiteID, format string, data []byte) (int64, error) {
	if e.store == nil {
		return 0, sentinel.ErrNoStore
	}
	if _, err := e.store.GetSuite(ctx, suiteID); err != nil {
		return 0, err
	}
	var (
		cases []*testcase.Case
		err   error
	)
	switch strings.ToLower(format) {
	case "json":
		cases, err = testcase.ImportJSON(suiteID, data)
	case "csv":
		cases, err = testcase.ImportCSV(suiteID, data)
	case "jsonl":
		cases, err = testcase.ImportJSONL(suiteID, data)
	default:
		return 0, fmt.Errorf("%w %q: use json, csv or jsonl", sentinel.ErrUnsupportedFormat, format)
	}
	if err != nil {
		return 0, fmt.Errorf("sentinel: parse %s: %w", format, err)
	}
	if len(cases) == 0 {
		return 0, sentinel.ErrEmptyInput
	}
	for _, tc := range cases {
		if tc.ID.String() == "" {
			tc.ID = id.NewCaseID()
		}
		tc.SuiteID = suiteID
		if tc.Tags == nil {
			tc.Tags = []string{}
		}
		if tc.Scorers == nil {
			tc.Scorers = []testcase.ScorerConfig{}
		}
		if tc.Context == nil {
			tc.Context = map[string]any{}
		}
		if tc.Metadata == nil {
			tc.Metadata = map[string]any{}
		}
	}
	if err := e.store.CreateCaseBatch(ctx, cases); err != nil {
		return 0, fmt.Errorf("sentinel: store imported cases: %w", err)
	}
	return int64(len(cases)), nil
}
```

Add `"strings"` to the engine.go imports. In `testcase/store.go`, replace the comment on `ImportCases` with:

```go
	// ImportCases is unused. Every backend implemented it as a stub, and
	// engine.ImportCases now parses and writes cases itself. It stays on the
	// interface so custom stores keep compiling.
```

- [ ] **Step 4: Run the tests**

Run: `go test -race ./engine/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/import_test.go
git commit --only -m "fix(engine): make case import import

ImportCases returned (0, nil) in all four stores and the parsers in
testcase were never called. The engine now parses json, csv and jsonl
and writes the cases itself." -- engine/engine.go testcase/store.go engine/import_test.go
git show --stat HEAD
```

---

### Task 16: Red-team cases can be generated into a suite

**Files:**
- Modify: `redteam/redteam.go` (add `MaxPerType`, `GeneratorFor`)
- Create: `redteam/redteam_test.go`
- Create: `engine/redteam.go`
- Create: `engine/redteam_test.go`

**Interfaces:**
- Consumes: `effectivePrompt` (Task 13); `sentinel.ErrInvalidInput` (Task 10).
- Produces: `redteam.MaxPerType = 5`; `redteam.GeneratorFor(t AttackType) (Generator, bool)`; `(*Engine).GenerateRedTeam(ctx, suiteID id.SuiteID, types []redteam.AttackType, count int) ([]*testcase.Case, error)`, which validates every type before generating anything, caps count at 5, and refuses leakage for a suite with no prompt.

- [ ] **Step 1: Write the failing tests**

`redteam/redteam_test.go`:

```go
package redteam

import "testing"

func TestGeneratorFor(t *testing.T) {
	for _, at := range []AttackType{AttackInjection, AttackJailbreak, AttackLeakage, AttackHallucination, AttackOfftopic} {
		g, ok := GeneratorFor(at)
		if !ok || g.Type() != at {
			t.Errorf("%s: ok=%v", at, ok)
		}
	}
	if _, ok := GeneratorFor("bias"); ok {
		t.Error("bias is not an attack type this package has")
	}
}
```

`engine/redteam_test.go`:

```go
package engine_test

import (
	"errors"
	"testing"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/promptversion"
	"github.com/xraph/sentinel/redteam"
)

func TestGenerateRedTeam(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "you are a billing assistant")
	cases, err := e.GenerateRedTeam(bg(), s.ID, []redteam.AttackType{redteam.AttackInjection, redteam.AttackLeakage}, 3)
	if err != nil || len(cases) != 6 {
		t.Fatalf("n=%d err=%v", len(cases), err)
	}
	stored, _ := e.ListCases(bg(), s.ID)
	if len(stored) != 6 {
		t.Fatalf("stored %d", len(stored))
	}
	for _, c := range stored {
		if len(c.Tags) == 0 || c.Tags[0] != "redteam" {
			t.Fatalf("case not tagged redteam: %v", c.Tags)
		}
	}
}

func TestRedTeamCountIsCapped(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p")
	cases, err := e.GenerateRedTeam(bg(), s.ID, []redteam.AttackType{redteam.AttackJailbreak}, 9)
	if err != nil || len(cases) != redteam.MaxPerType {
		t.Fatalf("n=%d err=%v", len(cases), err)
	}
}

func TestLeakageUsesTheCurrentPrompt(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "old prompt")
	if err := e.CreatePromptVersion(bg(), &promptversion.PromptVersion{SuiteID: s.ID, SystemPrompt: "new prompt", IsCurrent: true}); err != nil {
		t.Fatal(err)
	}
	cases, err := e.GenerateRedTeam(bg(), s.ID, []redteam.AttackType{redteam.AttackLeakage}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := cases[0].Scorers[0].Config["substring"]; got != "new prompt" {
		t.Fatalf("leakage must look for the prompt runs send: %v", got)
	}
}

// Review focus 1.
func TestLeakageNeedsAPrompt(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "")
	_, err := e.GenerateRedTeam(bg(), s.ID, []redteam.AttackType{redteam.AttackInjection, redteam.AttackLeakage}, 2)
	if !errors.Is(err, sentinel.ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput, got %v", err)
	}
	if stored, _ := e.ListCases(bg(), s.ID); len(stored) != 0 {
		t.Fatalf("a refusal must write nothing, not even the injection cases: %d", len(stored))
	}
}

func TestRedTeamRefusals(t *testing.T) {
	e, _ := newEngine(t)
	s := seedSuite(t, e, "p")
	for name, call := range map[string]func() error{
		"no types":     func() error { _, err := e.GenerateRedTeam(bg(), s.ID, nil, 1); return err },
		"zero count":   func() error { _, err := e.GenerateRedTeam(bg(), s.ID, []redteam.AttackType{redteam.AttackJailbreak}, 0); return err },
		"unknown type": func() error { _, err := e.GenerateRedTeam(bg(), s.ID, []redteam.AttackType{"bias"}, 1); return err },
	} {
		if err := call(); !errors.Is(err, sentinel.ErrInvalidInput) {
			t.Errorf("%s: want ErrInvalidInput, got %v", name, err)
		}
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go test ./redteam/ ./engine/ -run 'GeneratorFor|RedTeam|Leakage' -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Append to `redteam/redteam.go`:

```go
// MaxPerType is how many cases a generator can produce: each has five
// fixed templates.
const MaxPerType = 5

// GeneratorFor returns the built-in generator for an attack type.
func GeneratorFor(t AttackType) (Generator, bool) {
	switch t {
	case AttackInjection:
		return NewInjectionGenerator(), true
	case AttackJailbreak:
		return NewJailbreakGenerator(), true
	case AttackLeakage:
		return NewLeakageGenerator(), true
	case AttackHallucination:
		return NewHallucinationGenerator(), true
	case AttackOfftopic:
		return NewOfftopicGenerator(), true
	}
	return nil, false
}
```

`engine/redteam.go`:

```go
package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/xraph/sentinel"
	"github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/redteam"
	"github.com/xraph/sentinel/testcase"
)

// GenerateRedTeam writes attack cases for each type into a suite, up to
// redteam.MaxPerType per type. It validates every type before generating
// anything, so a refusal writes nothing.
//
// Leakage cases carry the suite's effective prompt as the substring their
// not_contains scorer looks for. With no prompt that scorer falls back to
// the case's Expected text and checks the wrong thing, so leakage is refused
// for a suite without one.
func (e *Engine) GenerateRedTeam(ctx context.Context, suiteID id.SuiteID, types []redteam.AttackType, count int) ([]*testcase.Case, error) {
	if e.store == nil {
		return nil, sentinel.ErrNoStore
	}
	if len(types) == 0 {
		return nil, fmt.Errorf("%w: choose at least one attack type", sentinel.ErrInvalidInput)
	}
	if count < 1 {
		return nil, fmt.Errorf("%w: count must be at least 1", sentinel.ErrInvalidInput)
	}
	if count > redteam.MaxPerType {
		count = redteam.MaxPerType
	}
	s, err := e.store.GetSuite(ctx, suiteID)
	if err != nil {
		return nil, err
	}
	prompt, _, err := e.effectivePrompt(ctx, s)
	if err != nil {
		return nil, err
	}

	generators := make([]redteam.Generator, 0, len(types))
	for _, t := range types {
		g, ok := redteam.GeneratorFor(t)
		if !ok {
			return nil, fmt.Errorf("%w: unknown attack type %q", sentinel.ErrInvalidInput, t)
		}
		if t == redteam.AttackLeakage && strings.TrimSpace(prompt) == "" {
			return nil, fmt.Errorf("%w: leakage attacks need a system prompt to look for, and this suite has none", sentinel.ErrInvalidInput)
		}
		generators = append(generators, g)
	}

	var out []*testcase.Case
	for _, g := range generators {
		cases, err := g.Generate(ctx, &redteam.GenerateConfig{SuiteID: suiteID.String(), Count: count, SystemPrompt: prompt})
		if err != nil {
			return nil, fmt.Errorf("sentinel: generate %s attacks: %w", g.Type(), err)
		}
		for _, tc := range cases {
			if tc.Metadata == nil {
				tc.Metadata = map[string]any{}
			}
		}
		out = append(out, cases...)
	}
	if err := e.store.CreateCaseBatch(ctx, out); err != nil {
		return nil, fmt.Errorf("sentinel: store red team cases: %w", err)
	}
	return out, nil
}
```

- [ ] **Step 4: Run the tests**

Run: `go test -race ./redteam/ ./engine/ -v && go build ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add redteam/redteam_test.go engine/redteam.go engine/redteam_test.go
git commit --only -m "feat(engine): generate red team cases into a suite

Nothing imported the redteam package. The engine can now write attack
cases for chosen types into a suite, capped at the five templates each
type has, and it refuses leakage for a suite with no prompt, where the
check would test the wrong text." -- redteam/redteam.go redteam/redteam_test.go engine/redteam.go engine/redteam_test.go
git show --stat HEAD
```

---

### Task 17: Extension options, and the whole-repo gate

**Files:**
- Modify: `extension/options.go`
- Modify: `extension/config_test.go`

**Interfaces:**
- Consumes: `engine.WithTarget`, `engine.WithScorer` (Task 10).
- Produces: `extension.WithTarget(name, description string, t target.Target) ExtOption`; `extension.WithScorer(d scorer.Descriptor, f scorer.Factory) ExtOption`.

- [ ] **Step 1: Write the failing test**

Append to `extension/config_test.go` (add imports `"context"`, `"github.com/xraph/sentinel/scorer"`, `"github.com/xraph/sentinel/target"`):

```go
func TestExtensionRegistersTargetsAndScorers(t *testing.T) {
	echo := target.FromFunc("echo", func(_ context.Context, in string) (string, error) { return in, nil })
	e := New(
		WithTarget("support-bot", "the production support agent", echo),
		WithScorer(scorer.Descriptor{Name: "judge", UsesLLM: true}, func(map[string]any) (scorer.Scorer, error) {
			return scorer.FromFunc("judge", func(context.Context, *scorer.Input) (*scorer.Output, error) { return &scorer.Output{Score: 1}, nil }), nil
		}),
	)
	e.config = e.mergeWithDefaults(e.config)
	eng, err := e.newEngine(nil)
	if err != nil {
		t.Fatal(err)
	}
	if rt, ok := eng.Target("support-bot"); !ok || rt.Description != "the production support agent" {
		t.Fatalf("target not registered: %+v", rt)
	}
	if !eng.Scorers().Has("judge") {
		t.Fatal("scorer not registered")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./extension/ -run TestExtensionRegisters -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Append to `extension/options.go` (imports `"github.com/xraph/sentinel/scorer"`, `"github.com/xraph/sentinel/target"`):

```go
// WithTarget registers a named target, so the dashboard can start a run
// against it. Without one, runs can only be started from Go.
func WithTarget(name, description string, t target.Target) ExtOption {
	return func(e *Extension) {
		e.engineOpts = append(e.engineOpts, engine.WithTarget(name, description, t))
	}
}

// WithScorer registers a scorer the dashboard can offer for a run. Use it
// for the LLM scorers, which need the application's LLMClient.
func WithScorer(d scorer.Descriptor, f scorer.Factory) ExtOption {
	return func(e *Extension) {
		e.engineOpts = append(e.engineOpts, engine.WithScorer(d, f))
	}
}
```

- [ ] **Step 4: Run the whole gate**

Run each and paste the tail of the output into the task report:

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
go build ./...
go test -race ./...
go test -race -tags integration ./store/postgres/ ./store/mongo/ -v
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
```

Expected: all PASS, lint clean. The templ dashboard still builds. If lint reports issues in files this plan did not touch, list them in the report and leave them alone.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "feat(extension): expose target and scorer registration

WithTarget and WithScorer pass through to the engine, so an application
can name what the dashboard is allowed to start runs against." -- extension/options.go extension/config_test.go
git show --stat HEAD
```

- [ ] **Step 6: Report**

Write a short report covering: the postgres nil-jsonb result from Task 1 with the exact error text, any grove placeholder workaround used in Task 8, lint findings in untouched files, and anything a task's expected output got wrong. Phase 2's plan is written from this report.
