# Weave dashboard, slice 1: engine and store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Weave's engine and four store backends report the truth the dashboard needs (hit identity, timestamps, working filters, typed duplicates, tenant filtering, newest-first lists) and add the engine capabilities the contract will call (collection update, component report, comparison retrieval, assembly, chunk paging, extension hooks).

**Architecture:** Every change lives in Weave's own packages, behind engine methods, so the contract in slice 3 stays a thin translation layer. A new conformance suite, `store/storetest`, runs the same assertions against memory, SQLite, Postgres and Mongo. Engine tests run on the memory store and memory vector store with a deterministic hashing embedder, so they need no network.

**Tech Stack:** Go 1.26, grove v1.6.3 (pgdriver, sqlitedriver, mongodriver), pgx v5, mongo-driver v2, the standard `testing` package (no assertion library: Weave has none today).

**Spec:** `docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md` in the forge-dashboard repo. Read its "What the investigation found" and "The Go half" sections before Task 1.

## Global Constraints

- Repo: `/Users/rexraphael/Work/xraph/forgery/weave`, branch `main`. No worktrees.
- Do NOT touch `extension/` or `dashboard/` in this slice. Both wait for `xraph/weave#39`.
- Commit only your own paths: `git add <paths>` then `git commit --only -m "..." -- <paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. `_project_files/` belongs to someone else: never stage, move or delete it.
- Commit messages: conventional prefix, Rex's voice, no em dashes, NO `Co-Authored-By` trailer, no Claude or Anthropic attribution.
- Never push. Rex decides when.
- Postgres and Mongo tests run against throwaway containers on odd ports. Never 5432, never 27017. The helpers refuse both.
- Lint with a fresh cache every time: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- Wire field names are snake_case, copied from Weave's JSON tags. New exported structs that the contract will marshal carry snake_case `json` tags.
- No new third-party test libraries. Use `testing` and small helpers.
- Default list ordering stays ascending. Newest-first only when `SortDesc` is set.

## Review Focus

1. A tenant filter of `""` must match only rows whose tenant is empty, on every backend, never "all rows". Pinned in Task 5 (stores) and Task 8 (retrieval).
2. A search string holding regex or LIKE metacharacters (`(`, `.*`) must be treated literally and must not error. Pinned in Task 2.
3. A retrieval hit whose vector exists but whose chunk row is gone must keep its rank and be marked orphaned, never dropped and never an error. Pinned in Task 7.
4. When the token budget runs out at hit N, a smaller hit after N that still fits is included, and the result says which hits made it in. Pinned in Task 12.
5. Renaming a collection to a name another collection in the same tenant already has must fail with `ErrCollectionAlreadyExists` on every backend, not with a raw driver error and not silently. Pinned in Task 4.

---

## Setup: throwaway databases

Run once before Task 1, and again whenever the containers are gone.

```bash
docker run -d --name weave-slice1-pg -e POSTGRES_PASSWORD=weave -e POSTGRES_DB=weave -p 55621:5432 postgres:17-alpine
```

```bash
docker run -d --name weave-slice1-mongo -p 57021:27017 mongo:7
```

Every test command below that names a backend uses:

```bash
export WEAVE_TEST_POSTGRES_DSN="postgres://postgres:weave@localhost:55621/weave?sslmode=disable"
export WEAVE_TEST_MONGO_DSN="mongodb://localhost:57021/weave"
```

With either variable unset, that backend's tests skip. Once set, every failure is fatal.

---

### Task 1: Store conformance harness and timestamps that survive the read

**Files:**
- Create: `internal/pgtest/pgtest.go`
- Create: `internal/mongotest/mongotest.go`
- Create: `store/storetest/storetest.go`
- Create: `store/storetest/fixtures.go`
- Create: `store/storetest/timestamps.go`
- Create: `store/memory/conformance_test.go`
- Create: `store/sqlite/conformance_test.go`
- Create: `store/postgres/conformance_test.go`
- Create: `store/mongo/conformance_test.go`
- Modify: `store/postgres/models.go` (`collectionFromModel`, `documentFromModel`)
- Modify: `store/sqlite/models.go` (`collectionFromModel`, `documentFromModel`)
- Modify: `store/mongo/models.go` (`collectionFromModel`, `documentFromModel`)

**Interfaces:**
- Produces: `storetest.Opener func(t *testing.T) store.Store`, `storetest.Run(t *testing.T, open storetest.Opener)`. Later tasks add subtests to `Run`.
- Produces fixtures in package `storetest`: `mustCollection(t, s, name, tenant string) *collection.Collection`, `mustDocument(t, s, col *collection.Collection, title string, state document.State) *document.Document`, `mustChunks(t, s, doc *document.Document, n int) []*chunk.Chunk`, `collectionIDs`, `documentIDs`, `chunkIDs`, `sameSet`, `sameOrder`, `assertSameInstant`.
- Produces: `pgtest.Schema(t testing.TB, dsn string) string`, `mongotest.Database(t testing.TB, dsn string) string`.

- [ ] **Step 1: Write the Postgres schema helper**

`internal/pgtest/pgtest.go`:

```go
// Package pgtest confines each test that writes to a live PostgreSQL to a
// schema of its own.
//
// `go test ./...` runs packages in parallel and more than one of them may
// open the database WEAVE_TEST_POSTGRES_DSN names. A schema per test gives
// each one tables nobody else touches.
package pgtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Schema creates a randomly named schema in the database dsn names, drops it
// again when the test ends, and returns dsn with search_path pinned to it.
// Weave's migrations create their tables unqualified, so they land inside it.
//
// Open the store on the returned DSN after calling Schema. Cleanups run last
// registered first, so the store's close fires before the drop.
//
// It refuses the default port: on the machines these tests run on, that is
// somebody's live database.
func Schema(t testing.TB, dsn string) string {
	t.Helper()

	if strings.Contains(dsn, ":5432/") || strings.HasSuffix(dsn, ":5432") {
		t.Fatalf("WEAVE_TEST_POSTGRES_DSN points at the default port; refusing to write to what may be a live database")
	}

	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("random schema suffix: %v", err)
	}
	schema := "weave_test_" + hex.EncodeToString(b[:])
	quoted := pgx.Identifier{schema}.Sanitize()

	exec(t, dsn, "CREATE SCHEMA "+quoted)
	t.Cleanup(func() { exec(t, dsn, "DROP SCHEMA IF EXISTS "+quoted+" CASCADE") })

	scoped, err := pinSearchPath(dsn, schema)
	if err != nil {
		t.Fatalf("pin WEAVE_TEST_POSTGRES_DSN to schema %s: %v", schema, err)
	}
	return scoped
}

func exec(t testing.TB, dsn, stmt string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	if _, err := conn.Exec(ctx, stmt); err != nil {
		t.Fatalf("%s: %v", stmt, err)
	}
}

// pinSearchPath sets search_path in whichever DSN spelling pgx was handed.
func pinSearchPath(dsn, schema string) (string, error) {
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return dsn + " search_path=" + schema, nil
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String(), nil
}
```

- [ ] **Step 2: Write the Mongo database helper**

`internal/mongotest/mongotest.go`:

```go
// Package mongotest gives each test that writes to a live MongoDB a database
// of its own, and drops it when the test ends.
package mongotest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Database returns dsn with its database replaced by a random one, and
// registers a cleanup that drops that database. It refuses the default port.
func Database(t testing.TB, dsn string) string {
	t.Helper()

	if strings.Contains(dsn, ":27017") {
		t.Fatalf("WEAVE_TEST_MONGO_DSN points at the default port; refusing to write to what may be a live database")
	}

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse WEAVE_TEST_MONGO_DSN: %v", err)
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("random database suffix: %v", err)
	}
	name := "weave_test_" + hex.EncodeToString(b[:])
	u.Path = "/" + name
	scoped := u.String()

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		client, err := mongo.Connect(options.Client().ApplyURI(scoped))
		if err != nil {
			t.Logf("mongotest: connect to drop %s: %v", name, err)
			return
		}
		defer func() { _ = client.Disconnect(ctx) }()
		if err := client.Database(name).Drop(ctx); err != nil {
			t.Logf("mongotest: drop %s: %v", name, err)
		}
	})
	return scoped
}
```

- [ ] **Step 3: Write the suite entry point and fixtures**

`store/storetest/storetest.go`:

```go
// Package storetest is the conformance suite every Weave store backend runs.
//
// Each case populates the fields the dashboard reads (metadata, offsets,
// timestamps, tenants), because a suite that only builds empty structs tests
// the absence of those features. Assertions compare identities, never bare
// counts: a count passes when the wrong rows come back in the right number.
package storetest

import (
	"testing"

	"github.com/xraph/weave/store"
)

// Opener returns a fresh, migrated, empty store. It is called once per case.
type Opener func(t *testing.T) store.Store

// Run runs every conformance case against the backend open returns.
func Run(t *testing.T, open Opener) {
	t.Run("Timestamps", func(t *testing.T) { testTimestamps(t, open(t)) })
}
```

`store/storetest/fixtures.go`:

```go
package storetest

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/store"
)

func mustCollection(t *testing.T, s store.Store, name, tenant string) *collection.Collection {
	t.Helper()
	col := &collection.Collection{
		ID:             id.NewCollectionID(),
		Name:           name,
		Description:    "about " + name,
		TenantID:       tenant,
		AppID:          "app-1",
		EmbeddingModel: "test-embed",
		EmbeddingDims:  8,
		ChunkStrategy:  "recursive",
		ChunkSize:      64,
		ChunkOverlap:   8,
		Metadata:       map[string]string{"team": "search"},
	}
	if err := s.CreateCollection(context.Background(), col); err != nil {
		t.Fatalf("create collection %q: %v", name, err)
	}
	return col
}

func mustDocument(t *testing.T, s store.Store, col *collection.Collection, title string, state document.State) *document.Document {
	t.Helper()
	docID := id.NewDocumentID()
	doc := &document.Document{
		ID:            docID,
		CollectionID:  col.ID,
		TenantID:      col.TenantID,
		Title:         title,
		Source:        "test://" + title,
		SourceType:    "text/plain",
		ContentHash:   "sha-" + docID.String(),
		ContentLength: 120,
		Metadata:      map[string]string{"lang": "en"},
		State:         state,
	}
	if state == document.StateFailed {
		doc.Error = "embed: quota exceeded"
	}
	if err := s.CreateDocument(context.Background(), doc); err != nil {
		t.Fatalf("create document %q: %v", title, err)
	}
	return doc
}

// mustChunks writes n chunks for doc with distinct offsets, token counts and
// metadata so a round trip that drops any of them is caught.
func mustChunks(t *testing.T, s store.Store, doc *document.Document, n int) []*chunk.Chunk {
	t.Helper()
	chunks := make([]*chunk.Chunk, n)
	for i := range chunks {
		chunks[i] = &chunk.Chunk{
			ID:           id.NewChunkID(),
			DocumentID:   doc.ID,
			CollectionID: doc.CollectionID,
			TenantID:     doc.TenantID,
			Content:      fmt.Sprintf("%s chunk %d", doc.Title, i),
			Index:        i,
			StartOffset:  i * 10,
			EndOffset:    i*10 + 12,
			TokenCount:   3 + i,
			Metadata:     map[string]string{"section": fmt.Sprint(i)},
		}
	}
	if err := s.CreateChunkBatch(context.Background(), chunks); err != nil {
		t.Fatalf("create chunks for %q: %v", doc.Title, err)
	}
	return chunks
}

func collectionIDs(cols []*collection.Collection) []string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c.ID.String()
	}
	return out
}

func documentIDs(docs []*document.Document) []string {
	out := make([]string, len(docs))
	for i, d := range docs {
		out[i] = d.ID.String()
	}
	return out
}

func chunkIDs(chs []*chunk.Chunk) []string {
	out := make([]string, len(chs))
	for i, c := range chs {
		out[i] = c.ID.String()
	}
	return out
}

func sameSet(t *testing.T, label string, got, want []string) {
	t.Helper()
	g := append([]string(nil), got...)
	w := append([]string(nil), want...)
	sort.Strings(g)
	sort.Strings(w)
	if strings.Join(g, ",") != strings.Join(w, ",") {
		t.Errorf("%s: got %v, want %v", label, got, want)
	}
}

func sameOrder(t *testing.T, label string, got, want []string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s: got %v, want %v (order matters)", label, got, want)
	}
}

// assertSameInstant allows one millisecond of drift: Mongo stores
// milliseconds and Postgres microseconds.
func assertSameInstant(t *testing.T, label string, want, got time.Time) {
	t.Helper()
	if got.IsZero() {
		t.Errorf("%s: read back as zero time, want %v", label, want)
		return
	}
	if d := want.Sub(got); d > time.Millisecond || d < -time.Millisecond {
		t.Errorf("%s: got %v, want %v", label, got, want)
	}
}
```

- [ ] **Step 4: Write the failing timestamps case**

`store/storetest/timestamps.go`:

```go
package storetest

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/store"
)

// testTimestamps pins that created_at and updated_at survive every read path
// the dashboard uses: get and list, for collections and documents.
func testTimestamps(t *testing.T, s store.Store) {
	ctx := context.Background()

	col := mustCollection(t, s, "timestamps", "t1")
	gotCol, err := s.GetCollection(ctx, col.ID)
	if err != nil {
		t.Fatalf("get collection: %v", err)
	}
	assertSameInstant(t, "GetCollection created_at", col.CreatedAt, gotCol.CreatedAt)
	assertSameInstant(t, "GetCollection updated_at", col.UpdatedAt, gotCol.UpdatedAt)

	cols, err := s.ListCollections(ctx, &collection.ListFilter{})
	if err != nil {
		t.Fatalf("list collections: %v", err)
	}
	if len(cols) != 1 {
		t.Fatalf("list collections: got %d rows, want 1", len(cols))
	}
	assertSameInstant(t, "ListCollections created_at", col.CreatedAt, cols[0].CreatedAt)

	doc := mustDocument(t, s, col, "stamped", document.StateProcessing)
	created := doc.CreatedAt

	gotDoc, err := s.GetDocument(ctx, doc.ID)
	if err != nil {
		t.Fatalf("get document: %v", err)
	}
	assertSameInstant(t, "GetDocument created_at", created, gotDoc.CreatedAt)
	assertSameInstant(t, "GetDocument updated_at", doc.UpdatedAt, gotDoc.UpdatedAt)

	docs, err := s.ListDocuments(ctx, &document.ListFilter{CollectionID: col.ID})
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("list documents: got %d rows, want 1", len(docs))
	}
	assertSameInstant(t, "ListDocuments created_at", created, docs[0].CreatedAt)

	// An update moves updated_at forward and leaves created_at alone.
	time.Sleep(5 * time.Millisecond)
	update := *gotDoc
	update.State = document.StateReady
	if err := s.UpdateDocument(ctx, &update); err != nil {
		t.Fatalf("update document: %v", err)
	}
	after, err := s.GetDocument(ctx, doc.ID)
	if err != nil {
		t.Fatalf("get updated document: %v", err)
	}
	assertSameInstant(t, "created_at after update", created, after.CreatedAt)
	if !after.UpdatedAt.After(created) {
		t.Errorf("updated_at after update: got %v, want later than %v", after.UpdatedAt, created)
	}
}
```

- [ ] **Step 5: Wire the suite into all four backends**

`store/memory/conformance_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/weave/store"
	"github.com/xraph/weave/store/memory"
	"github.com/xraph/weave/store/storetest"
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
	_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate" // registers the sqlite migrate executor

	"github.com/xraph/weave/store"
	"github.com/xraph/weave/store/sqlite"
	"github.com/xraph/weave/store/storetest"
)

func TestConformance(t *testing.T) {
	storetest.Run(t, func(t *testing.T) store.Store {
		ctx := context.Background()
		drv := sqlitedriver.New()
		if err := drv.Open(ctx, filepath.Join(t.TempDir(), "weave.db")); err != nil {
			t.Fatalf("open sqlite: %v", err)
		}
		db, err := grove.Open(drv)
		if err != nil {
			t.Fatalf("grove.Open sqlite: %v", err)
		}
		t.Cleanup(func() { _ = db.Close() })
		s := sqlite.New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate sqlite: %v", err)
		}
		return s
	})
}
```

`store/postgres/conformance_test.go`:

```go
package postgres_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/pgdriver"

	"github.com/xraph/weave/internal/pgtest"
	"github.com/xraph/weave/store"
	"github.com/xraph/weave/store/postgres"
	"github.com/xraph/weave/store/storetest"
)

// TestConformance skips only when WEAVE_TEST_POSTGRES_DSN is unset. Once it
// is set, every failure is fatal: a skip and a failure look the same without
// -v, and a broken backend must not pass as merely untested.
func TestConformance(t *testing.T) {
	dsn := os.Getenv("WEAVE_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("WEAVE_TEST_POSTGRES_DSN not set, skipping postgres")
	}
	storetest.Run(t, func(t *testing.T) store.Store {
		scoped := pgtest.Schema(t, dsn)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		drv := pgdriver.New()
		if err := drv.Open(ctx, scoped); err != nil {
			t.Fatalf("open postgres: %v", err)
		}
		db, err := grove.Open(drv)
		if err != nil {
			t.Fatalf("grove.Open postgres: %v", err)
		}
		t.Cleanup(func() { _ = db.Close() })
		s := postgres.New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate postgres: %v", err)
		}
		return s
	})
}
```

`store/mongo/conformance_test.go`:

```go
package mongo_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/mongodriver"

	"github.com/xraph/weave/internal/mongotest"
	"github.com/xraph/weave/store"
	"github.com/xraph/weave/store/mongo"
	"github.com/xraph/weave/store/storetest"
)

// TestConformance skips only when WEAVE_TEST_MONGO_DSN is unset; once set,
// every failure is fatal.
func TestConformance(t *testing.T) {
	dsn := os.Getenv("WEAVE_TEST_MONGO_DSN")
	if dsn == "" {
		t.Skip("WEAVE_TEST_MONGO_DSN not set, skipping mongo")
	}
	storetest.Run(t, func(t *testing.T) store.Store {
		scoped := mongotest.Database(t, dsn)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		drv := mongodriver.New()
		if err := drv.Open(ctx, scoped); err != nil {
			t.Fatalf("open mongo: %v", err)
		}
		db, err := grove.Open(drv)
		if err != nil {
			t.Fatalf("grove.Open mongo: %v", err)
		}
		t.Cleanup(func() { _ = db.Close() })
		s := mongo.New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate mongo: %v", err)
		}
		return s
	})
}
```

- [ ] **Step 6: Run and watch it fail on the three database backends**

Run: `go mod tidy && go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(=== RUN|--- |\s+.*read back|ok|FAIL)'`
Expected: memory PASS. sqlite, postgres and mongo FAIL with `GetCollection created_at: read back as zero time`.

- [ ] **Step 7: Carry the timestamps through each mapper**

Six mappers change, and each change is the same one line. In `store/postgres/models.go`, `store/sqlite/models.go` and `store/mongo/models.go`:

1. Add `"github.com/xraph/weave"` to the imports.
2. In `collectionFromModel` and in `documentFromModel`, add this as the first field of the returned struct literal, above `ID:`:

```go
		Entity: weave.Entity{CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt},
```

Every model already has `CreatedAt` and `UpdatedAt` fields (they are written on insert); only the read side dropped them. Leave every other line alone.

- [ ] **Step 8: Run all four backends green**

Run (with the Setup variables exported): `go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: `--- PASS: TestConformance` for memory, sqlite, postgres and mongo, and no `SKIP` for postgres or mongo.

- [ ] **Step 9: Commit**

```bash
git add internal/pgtest/pgtest.go internal/mongotest/mongotest.go store/storetest/storetest.go store/storetest/fixtures.go store/storetest/timestamps.go store/memory/conformance_test.go store/sqlite/conformance_test.go store/postgres/conformance_test.go store/mongo/conformance_test.go
git commit --only -m "fix(store): return created_at and updated_at from the database backends" -- internal/pgtest/pgtest.go internal/mongotest/mongotest.go store/storetest/storetest.go store/storetest/fixtures.go store/storetest/timestamps.go store/memory/conformance_test.go store/sqlite/conformance_test.go store/postgres/conformance_test.go store/mongo/conformance_test.go store/postgres/models.go store/sqlite/models.go store/mongo/models.go go.mod go.sum
git show --stat HEAD
```

---

### Task 2: Filters that work on every backend, and searched counts

**Files:**
- Create: `store/storetest/filters.go`
- Modify: `store/storetest/storetest.go` (register the case)
- Modify: `document/store.go` (`CountFilter.Search`)
- Modify: `store/postgres/store.go` (`ListCollections`, `CountCollections`, `ListDocuments`, `CountDocuments`, `CountChunks`)
- Modify: `store/sqlite/store.go` (`CountDocuments`)
- Modify: `store/mongo/store.go` (`ListCollections`, `CountCollections`, `ListDocuments`, `CountDocuments`)
- Modify: `store/memory/store.go` (`CountDocuments`)

**Interfaces:**
- Consumes: Task 1 fixtures.
- Produces: `document.CountFilter.Search string`, matched exactly like `ListFilter.Search` on every backend.

- [ ] **Step 1: Write the failing case**

`store/storetest/filters.go`:

```go
package storetest

import (
	"context"
	"testing"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/store"
)

// testFilters pins each filter on its own and in combination. On Postgres a
// filter that skipped an earlier one used to reference a placeholder with no
// argument and fail, which the old dashboard rendered as a zero.
func testFilters(t *testing.T, s store.Store) {
	ctx := context.Background()

	a := mustCollection(t, s, "alpha-col", "t1")
	b := mustCollection(t, s, "beta-col", "t1")
	report := mustDocument(t, s, a, "alpha report", document.StateReady)
	notes := mustDocument(t, s, a, "beta notes", document.StateFailed)
	draft := mustDocument(t, s, a, "gamma (draft)", document.StatePending)
	other := mustDocument(t, s, b, "alpha other", document.StateReady)
	reportChunks := mustChunks(t, s, report, 3)
	mustChunks(t, s, notes, 2)

	list := func(label string, f *document.ListFilter, want ...*document.Document) {
		t.Helper()
		got, err := s.ListDocuments(ctx, f)
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		sameSet(t, label, documentIDs(got), documentIDs(want))
	}
	count := func(label string, f *document.CountFilter, want int64) {
		t.Helper()
		got, err := s.CountDocuments(ctx, f)
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if got != want {
			t.Errorf("%s: got %d, want %d", label, got, want)
		}
	}

	list("state only", &document.ListFilter{State: document.StateFailed}, notes)
	list("search only", &document.ListFilter{Search: "alpha"}, report, other)
	list("collection and search", &document.ListFilter{CollectionID: a.ID, Search: "alpha"}, report)
	list("collection, state and search", &document.ListFilter{CollectionID: a.ID, State: document.StateReady, Search: "alpha"}, report)

	count("count state only", &document.CountFilter{State: document.StateReady}, 2)
	count("count search only", &document.CountFilter{Search: "alpha"}, 2)
	count("count all three", &document.CountFilter{CollectionID: a.ID, State: document.StateReady, Search: "alpha"}, 1)

	// Search is literal: regex and LIKE metacharacters match themselves.
	list("literal parenthesis", &document.ListFilter{Search: "(draft"}, draft)
	list("literal dot star", &document.ListFilter{Search: ".*"})
	cols, err := s.ListCollections(ctx, &collection.ListFilter{Search: ".*"})
	if err != nil {
		t.Fatalf("collections literal dot star: %v", err)
	}
	sameSet(t, "collections literal dot star", collectionIDs(cols), nil)

	n, err := s.CountChunks(ctx, &chunk.CountFilter{DocumentID: report.ID})
	if err != nil {
		t.Fatalf("count chunks by document only: %v", err)
	}
	if n != int64(len(reportChunks)) {
		t.Errorf("count chunks by document only: got %d, want %d", n, len(reportChunks))
	}
}
```

Register it in `Run`:

```go
	t.Run("Filters", func(t *testing.T) { testFilters(t, open(t)) })
```

- [ ] **Step 2: Run it to see the failures**

Run: `go test ./store/... -run 'TestConformance/Filters' -v 2>&1 | grep -E '^(\s+--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: does not compile (`unknown field Search in struct literal of type document.CountFilter`).

- [ ] **Step 3: Add `Search` to the document count filter**

In `document/store.go`:

```go
// CountFilter controls filtering for document count queries.
type CountFilter struct {
	// CollectionID filters by collection. Empty means all collections.
	CollectionID id.CollectionID
	// State filters by document state. Empty means all states.
	State State
	// Search filters by title, matched exactly as ListFilter.Search.
	Search string
}
```

- [ ] **Step 4: Run again; expect backend failures**

Run: `go test ./store/... -run 'TestConformance/Filters' -v 2>&1 | grep -E '^(\s+--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected, at least: memory, sqlite and mongo fail `count search only: got 4, want 2`; postgres fails on `state only` with a placeholder error; mongo also fails `literal parenthesis` (a regex error) and `literal dot star`.

- [ ] **Step 5: Fix memory and SQLite counts**

`store/memory/store.go`, inside `CountDocuments`'s filter block, after the `State` check:

```go
			if filter.Search != "" && !strings.Contains(strings.ToLower(doc.Title), strings.ToLower(filter.Search)) {
				continue
			}
```

`store/sqlite/store.go`, inside `CountDocuments`'s filter block, after the `State` clause:

```go
		if filter.Search != "" {
			q = q.Where("title LIKE '%' || ? || '%'", filter.Search)
		}
```

- [ ] **Step 6: Fix Postgres placeholders**

In `store/postgres/store.go`, replace every literal `$1`, `$2`, `$3` in these five methods with `?`, which grove numbers by position (`pgdriver@v1.6.3/query_base.go:77-99`):

```go
// ListCollections
			q = q.Where("name ILIKE '%' || ? || '%'", filter.Search)
// CountCollections
			q = q.Where("name ILIKE '%' || ? || '%'", filter.Search)
// ListDocuments
			q = q.Where("collection_id = ?", filter.CollectionID.String())
			q = q.Where("state = ?", string(filter.State))
			q = q.Where("title ILIKE '%' || ? || '%'", filter.Search)
// CountDocuments
			q = q.Where("collection_id = ?", filter.CollectionID.String())
			q = q.Where("state = ?", string(filter.State))
		if filter.Search != "" {
			q = q.Where("title ILIKE '%' || ? || '%'", filter.Search)
		}
// CountChunks
			q = q.Where("collection_id = ?", filter.CollectionID.String())
			q = q.Where("document_id = ?", filter.DocumentID.String())
```

The single-argument `$1` calls in `GetCollection`, `GetDocument`, `GetChunk` and the deletes work today; leave them.

- [ ] **Step 7: Make Mongo search literal and add the searched count**

In `store/mongo/store.go`, add the import `"regexp"`, and add this helper near `isNotFound`:

```go
// containsCI matches s anywhere in the field, case-insensitively, treating
// every character literally. User input must never reach $regex unquoted:
// "(" is a regex error and ".*" matches everything.
func containsCI(s string) bson.M {
	return bson.M{"$regex": regexp.QuoteMeta(s), "$options": "i"}
}
```

Replace the four raw regex filters:

```go
// ListCollections and CountCollections
			q = q.Filter(bson.M{"name": containsCI(filter.Search)})
// ListDocuments
			q = q.Filter(bson.M{"title": containsCI(filter.Search)})
```

and add to `CountDocuments`, after the `State` filter:

```go
		if filter.Search != "" {
			q = q.Filter(bson.M{"title": containsCI(filter.Search)})
		}
```

- [ ] **Step 8: Run all four backends green**

Run: `go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: PASS on all four, no skips.

- [ ] **Step 9: Commit**

```bash
git add store/storetest/filters.go
git commit --only -m "fix(store): make document filters work on postgres and search literal everywhere" -- store/storetest/filters.go store/storetest/storetest.go document/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/memory/store.go
git show --stat HEAD
```

---

### Task 3: Newest first, on request

**Files:**
- Create: `store/storetest/ordering.go`
- Modify: `store/storetest/storetest.go`
- Modify: `collection/store.go` (`ListFilter.SortDesc`)
- Modify: `document/store.go` (`ListFilter.SortDesc`)
- Modify: `store/memory/store.go`, `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go` (`ListCollections`, `ListDocuments`)

**Interfaces:**
- Produces: `collection.ListFilter.SortDesc bool`, `document.ListFilter.SortDesc bool`. Ordering is `created_at` then `id`, ascending by default, both descending when set.

- [ ] **Step 1: Write the failing case**

`store/storetest/ordering.go`:

```go
package storetest

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/store"
)

// testOrdering pins default ascending order and SortDesc, with paging. The
// sleeps keep created_at distinct even on Mongo's millisecond clock.
func testOrdering(t *testing.T, s store.Store) {
	ctx := context.Background()

	var cols []*collection.Collection
	for _, name := range []string{"first", "second", "third"} {
		cols = append(cols, mustCollection(t, s, name, "t1"))
		time.Sleep(5 * time.Millisecond)
	}
	var docs []*document.Document
	for _, title := range []string{"one", "two", "three"} {
		docs = append(docs, mustDocument(t, s, cols[0], title, document.StateReady))
		time.Sleep(5 * time.Millisecond)
	}

	asc, err := s.ListCollections(ctx, &collection.ListFilter{})
	if err != nil {
		t.Fatalf("list collections asc: %v", err)
	}
	sameOrder(t, "collections default", collectionIDs(asc), collectionIDs(cols))

	desc, err := s.ListCollections(ctx, &collection.ListFilter{SortDesc: true})
	if err != nil {
		t.Fatalf("list collections desc: %v", err)
	}
	sameOrder(t, "collections newest first", collectionIDs(desc), collectionIDs([]*collection.Collection{cols[2], cols[1], cols[0]}))

	page, err := s.ListDocuments(ctx, &document.ListFilter{CollectionID: cols[0].ID, SortDesc: true, Limit: 2, Offset: 1})
	if err != nil {
		t.Fatalf("list documents desc page: %v", err)
	}
	sameOrder(t, "documents newest first, second page of two", documentIDs(page), documentIDs([]*document.Document{docs[1], docs[0]}))

	ascDocs, err := s.ListDocuments(ctx, &document.ListFilter{CollectionID: cols[0].ID})
	if err != nil {
		t.Fatalf("list documents asc: %v", err)
	}
	sameOrder(t, "documents default", documentIDs(ascDocs), documentIDs(docs))
}
```

Register in `Run`:

```go
	t.Run("Ordering", func(t *testing.T) { testOrdering(t, open(t)) })
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./store/... -run 'TestConformance/Ordering' 2>&1 | tail -5`
Expected: compile error, `unknown field SortDesc`.

- [ ] **Step 3: Add the field to both filters**

`collection/store.go`, in `ListFilter`:

```go
	// SortDesc lists newest first. The default is oldest first, which API
	// clients paging by offset already depend on.
	SortDesc bool
```

`document/store.go`, in `ListFilter`, the same field and comment.

- [ ] **Step 4: Implement per backend**

Memory, replace both `sort.Slice` calls in `ListCollections` and `ListDocuments` (shown for collections; documents is identical with `result[i]` being a document):

```go
	desc := filter != nil && filter.SortDesc
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if !a.CreatedAt.Equal(b.CreatedAt) {
			if desc {
				return a.CreatedAt.After(b.CreatedAt)
			}
			return a.CreatedAt.Before(b.CreatedAt)
		}
		if desc {
			return a.ID.String() > b.ID.String()
		}
		return a.ID.String() < b.ID.String()
	})
```

Postgres and SQLite, in both `ListCollections` and `ListDocuments`, replace `OrderExpr("created_at ASC")`:

```go
	order := "created_at ASC, id ASC"
	if filter != nil && filter.SortDesc {
		order = "created_at DESC, id DESC"
	}
	q := s.pg.NewSelect(&models).OrderExpr(order)
```

(SQLite uses `s.sdb.NewSelect`.)

Mongo, in both methods:

```go
	dir := 1
	if filter != nil && filter.SortDesc {
		dir = -1
	}
	q := s.mdb.NewFind(&models).Sort(bson.D{{Key: "created_at", Value: dir}, {Key: "_id", Value: dir}})
```

- [ ] **Step 5: Run all backends green**

Run: `go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: PASS on all four.

- [ ] **Step 6: Commit**

```bash
git add store/storetest/ordering.go
git commit --only -m "feat(store): list collections and documents newest first on request" -- store/storetest/ordering.go store/storetest/storetest.go collection/store.go document/store.go store/memory/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go
git show --stat HEAD
```

---

### Task 4: Duplicates come back typed

**Files:**
- Create: `store/storetest/duplicates.go`
- Create: `store/postgres/errors.go`
- Create: `store/sqlite/errors.go`
- Create: `store/mongo/errors.go`
- Modify: `store/storetest/storetest.go`
- Modify: `store/memory/store.go` (`UpdateCollection`)
- Modify: `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go` (`CreateCollection`, `UpdateCollection`, `CreateDocument`)

**Interfaces:**
- Produces: every backend returns an error satisfying `errors.Is(err, weave.ErrDuplicateDocument)` for a repeated `(collection_id, content_hash)`, and `errors.Is(err, weave.ErrCollectionAlreadyExists)` for a repeated `(tenant_id, name)` on create or update.

- [ ] **Step 1: Write the failing case**

`store/storetest/duplicates.go`:

```go
package storetest

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/weave"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/store"
)

func testDuplicates(t *testing.T, s store.Store) {
	ctx := context.Background()

	a := mustCollection(t, s, "dupes", "t1")
	b := mustCollection(t, s, "elsewhere", "t1")
	orig := mustDocument(t, s, a, "original", document.StateReady)

	again := &document.Document{
		ID: id.NewDocumentID(), CollectionID: a.ID, TenantID: "t1",
		Title: "again", ContentHash: orig.ContentHash, State: document.StatePending,
		Metadata: map[string]string{},
	}
	if err := s.CreateDocument(ctx, again); !errors.Is(err, weave.ErrDuplicateDocument) {
		t.Errorf("same hash, same collection: got %v, want ErrDuplicateDocument", err)
	}

	moved := *again
	moved.ID = id.NewDocumentID()
	moved.CollectionID = b.ID
	if err := s.CreateDocument(ctx, &moved); err != nil {
		t.Errorf("same hash, other collection: got %v, want success", err)
	}

	sameName := &collection.Collection{
		ID: id.NewCollectionID(), Name: "dupes", TenantID: "t1",
		EmbeddingModel: "m", ChunkStrategy: "recursive", ChunkSize: 64, ChunkOverlap: 8,
		Metadata: map[string]string{},
	}
	if err := s.CreateCollection(ctx, sameName); !errors.Is(err, weave.ErrCollectionAlreadyExists) {
		t.Errorf("same name, same tenant: got %v, want ErrCollectionAlreadyExists", err)
	}

	otherTenant := *sameName
	otherTenant.ID = id.NewCollectionID()
	otherTenant.TenantID = "t2"
	if err := s.CreateCollection(ctx, &otherTenant); err != nil {
		t.Errorf("same name, other tenant: got %v, want success", err)
	}

	// Renaming onto a taken name is refused too.
	rename, err := s.GetCollection(ctx, b.ID)
	if err != nil {
		t.Fatalf("get collection to rename: %v", err)
	}
	clone := *rename
	clone.Name = "dupes"
	if err := s.UpdateCollection(ctx, &clone); !errors.Is(err, weave.ErrCollectionAlreadyExists) {
		t.Errorf("rename onto taken name: got %v, want ErrCollectionAlreadyExists", err)
	}
	still, err := s.GetCollection(ctx, b.ID)
	if err != nil {
		t.Fatalf("get after refused rename: %v", err)
	}
	if still.Name != "elsewhere" {
		t.Errorf("refused rename changed the name to %q", still.Name)
	}
}
```

Register in `Run`:

```go
	t.Run("Duplicates", func(t *testing.T) { testDuplicates(t, open(t)) })
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./store/... -run 'TestConformance/Duplicates' -v 2>&1 | grep -E '^\s+\S+\.go:\d+:'`
Expected: sqlite, postgres and mongo report raw constraint errors for the three duplicate cases; memory fails only `rename onto taken name` and `refused rename changed the name`. Memory's failure is a mutation through a shared pointer: note that the case copies into `clone` before calling `UpdateCollection` so a backend that refuses leaves the stored row alone.

- [ ] **Step 3: Memory refuses a rename onto a taken name**

`store/memory/store.go`, `UpdateCollection`, after the existence check:

```go
	for k, existing := range s.collections {
		if k != key && existing.TenantID == col.TenantID && existing.Name == col.Name {
			return weave.ErrCollectionAlreadyExists
		}
	}
```

- [ ] **Step 4: One unique-violation check per driver**

`store/postgres/errors.go`:

```go
package postgres

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// isUniqueViolation reports a Postgres unique_violation (23505). grove wraps
// pgx errors with %w, so errors.As finds the PgError; the string check covers
// a wrapper that flattens it.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
```

`store/sqlite/errors.go`:

```go
package sqlite

import "strings"

// isUniqueViolation reports a SQLite UNIQUE constraint failure. modernc's
// error text for it is stable and carries no typed code through grove.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
```

`store/mongo/errors.go`:

```go
package mongo

import (
	"strings"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

// isUniqueViolation reports a duplicate key error (E11000).
func isUniqueViolation(err error) bool {
	return mongo.IsDuplicateKeyError(err) || (err != nil && strings.Contains(err.Error(), "E11000"))
}
```

This matches `store/mongo/store.go`, which also imports the driver as `mongo` inside `package mongo`.

- [ ] **Step 5: Map the violations in each backend**

In each of `store/postgres/store.go`, `store/sqlite/store.go` and `store/mongo/store.go`, wrap the three writes. Postgres shown; the other two differ only in the receiver's driver field (`s.sdb`, `s.mdb`) and query builder, which stay as they are:

```go
// CreateCollection
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("weave: create collection: %w", weave.ErrCollectionAlreadyExists)
		}
		return fmt.Errorf("weave: create collection: %w", err)
	}

// UpdateCollection, on the Exec error
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("weave: update collection: %w", weave.ErrCollectionAlreadyExists)
		}
		return fmt.Errorf("weave: update collection: %w", err)
	}

// CreateDocument. Document IDs are freshly generated, so the only unique
// key a create can collide on in practice is (collection_id, content_hash).
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("weave: create document: %w", weave.ErrDuplicateDocument)
		}
		return fmt.Errorf("weave: create document: %w", err)
	}
```

- [ ] **Step 6: Run all backends green**

Run: `go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: PASS on all four.

- [ ] **Step 7: Commit**

```bash
git add store/storetest/duplicates.go store/postgres/errors.go store/sqlite/errors.go store/mongo/errors.go
git commit --only -m "fix(store): report duplicate documents and collection names as typed errors" -- store/storetest/duplicates.go store/storetest/storetest.go store/postgres/errors.go store/sqlite/errors.go store/mongo/errors.go store/memory/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go go.mod go.sum
git show --stat HEAD
```

---

### Task 5: Tenant filters and the stalled-document count

**Files:**
- Create: `store/storetest/tenancy.go`
- Modify: `store/storetest/storetest.go`
- Modify: `collection/store.go` (`ListFilter.Tenant`, `CountFilter.Tenant`)
- Modify: `document/store.go` (`ListFilter.Tenant`, `CountFilter.Tenant`, `CountFilter.UpdatedBefore`)
- Modify: `chunk/store.go` (`CountFilter.Tenant`)
- Modify: the four backends' `ListCollections`, `CountCollections`, `ListDocuments`, `CountDocuments`, `CountChunks`

**Interfaces:**
- Produces: `Tenant *string` on collection list/count, document list/count and chunk count filters. Nil means every tenant. Non-nil is an exact match, `""` included.
- Produces: `document.CountFilter.UpdatedBefore time.Time`. Zero means no filter.

- [ ] **Step 1: Write the failing case**

`store/storetest/tenancy.go`:

```go
package storetest

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/store"
)

func ptr(s string) *string { return &s }

// testTenancy pins what a tenant filter does on this backend, as a recorded
// fact: nil sees every tenant, and "" sees only rows written with no tenant.
// Every row Weave writes today has tenant "", so the second rule is the one
// that matters, and the obvious implementation ("skip the filter when the
// value is empty") gets it backwards.
func testTenancy(t *testing.T, s store.Store) {
	ctx := context.Background()

	c1 := mustCollection(t, s, "t1-col", "t1")
	c2 := mustCollection(t, s, "t2-col", "t2")
	c0 := mustCollection(t, s, "untenanted-col", "")
	d1 := mustDocument(t, s, c1, "t1 doc", document.StateReady)
	d2 := mustDocument(t, s, c2, "t2 doc", document.StateReady)
	d0 := mustDocument(t, s, c0, "untenanted doc", document.StateReady)
	ch1 := mustChunks(t, s, d1, 2)
	mustChunks(t, s, d2, 1)
	ch0 := mustChunks(t, s, d0, 3)

	cases := []struct {
		name   string
		tenant *string
		cols   []*collection.Collection
		docs   []*document.Document
		chunks int64
	}{
		{"nil sees everyone", nil, []*collection.Collection{c1, c2, c0}, []*document.Document{d1, d2, d0}, 6},
		{"t1 sees t1", ptr("t1"), []*collection.Collection{c1}, []*document.Document{d1}, int64(len(ch1))},
		{"empty sees only untenanted", ptr(""), []*collection.Collection{c0}, []*document.Document{d0}, int64(len(ch0))},
		{"unknown sees nothing", ptr("t9"), nil, nil, 0},
	}
	for _, tc := range cases {
		cols, err := s.ListCollections(ctx, &collection.ListFilter{Tenant: tc.tenant})
		if err != nil {
			t.Fatalf("%s: list collections: %v", tc.name, err)
		}
		sameSet(t, tc.name+": collections", collectionIDs(cols), collectionIDs(tc.cols))

		nCols, err := s.CountCollections(ctx, &collection.CountFilter{Tenant: tc.tenant})
		if err != nil {
			t.Fatalf("%s: count collections: %v", tc.name, err)
		}
		if nCols != int64(len(tc.cols)) {
			t.Errorf("%s: count collections: got %d, want %d", tc.name, nCols, len(tc.cols))
		}

		docs, err := s.ListDocuments(ctx, &document.ListFilter{Tenant: tc.tenant})
		if err != nil {
			t.Fatalf("%s: list documents: %v", tc.name, err)
		}
		sameSet(t, tc.name+": documents", documentIDs(docs), documentIDs(tc.docs))

		nDocs, err := s.CountDocuments(ctx, &document.CountFilter{Tenant: tc.tenant})
		if err != nil {
			t.Fatalf("%s: count documents: %v", tc.name, err)
		}
		if nDocs != int64(len(tc.docs)) {
			t.Errorf("%s: count documents: got %d, want %d", tc.name, nDocs, len(tc.docs))
		}

		nChunks, err := s.CountChunks(ctx, &chunk.CountFilter{Tenant: tc.tenant})
		if err != nil {
			t.Fatalf("%s: count chunks: %v", tc.name, err)
		}
		if nChunks != tc.chunks {
			t.Errorf("%s: count chunks: got %d, want %d", tc.name, nChunks, tc.chunks)
		}
	}
}

// testStalled pins UpdatedBefore, which the Overview uses to count
// documents stuck in processing.
func testStalled(t *testing.T, s store.Store) {
	ctx := context.Background()
	col := mustCollection(t, s, "stalled", "t1")
	mustDocument(t, s, col, "old", document.StateProcessing)
	time.Sleep(20 * time.Millisecond)
	cutoff := time.Now().UTC()
	time.Sleep(20 * time.Millisecond)
	mustDocument(t, s, col, "fresh", document.StateProcessing)
	mustDocument(t, s, col, "done", document.StateReady)

	n, err := s.CountDocuments(ctx, &document.CountFilter{State: document.StateProcessing, UpdatedBefore: cutoff})
	if err != nil {
		t.Fatalf("count stalled: %v", err)
	}
	if n != 1 {
		t.Errorf("count stalled: got %d, want 1", n)
	}
}
```

Register both in `Run`:

```go
	t.Run("Tenancy", func(t *testing.T) { testTenancy(t, open(t)) })
	t.Run("Stalled", func(t *testing.T) { testStalled(t, open(t)) })
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./store/... -run 'TestConformance/(Tenancy|Stalled)' 2>&1 | tail -5`
Expected: compile error, `unknown field Tenant`.

- [ ] **Step 3: Add the filter fields**

`collection/store.go`, in both `ListFilter` and `CountFilter`:

```go
	// Tenant filters by tenant. Nil means every tenant. A non-nil value is
	// an exact match, so a pointer to "" means rows written with no tenant.
	Tenant *string
```

`document/store.go`: the same `Tenant` field in `ListFilter` and `CountFilter`, plus in `CountFilter` (add `"time"` to the imports):

```go
	// UpdatedBefore counts only documents last updated before this instant.
	// Zero means no filter.
	UpdatedBefore time.Time
```

`chunk/store.go`, in `CountFilter`: the same `Tenant` field.

- [ ] **Step 4: Implement in memory**

Add each check inside the existing `if filter != nil {` blocks:

```go
// collections: ListCollections and CountCollections
			if filter.Tenant != nil && col.TenantID != *filter.Tenant {
				continue
			}
// documents: ListDocuments and CountDocuments
			if filter.Tenant != nil && doc.TenantID != *filter.Tenant {
				continue
			}
// documents: CountDocuments only
			if !filter.UpdatedBefore.IsZero() && !doc.UpdatedAt.Before(filter.UpdatedBefore) {
				continue
			}
// chunks: CountChunks
			if filter.Tenant != nil && ch.TenantID != *filter.Tenant {
				continue
			}
```

- [ ] **Step 5: Implement in Postgres and SQLite**

In each listed method's `if filter != nil {` block (SQLite identical apart from `s.sdb`):

```go
		if filter.Tenant != nil {
			q = q.Where("tenant_id = ?", *filter.Tenant)
		}
```

and in `CountDocuments`:

```go
		if !filter.UpdatedBefore.IsZero() {
			q = q.Where("updated_at < ?", filter.UpdatedBefore.UTC())
		}
```

- [ ] **Step 6: Implement in Mongo**

```go
		if filter.Tenant != nil {
			q = q.Filter(bson.M{"tenant_id": *filter.Tenant})
		}
```

and in `CountDocuments`:

```go
		if !filter.UpdatedBefore.IsZero() {
			q = q.Filter(bson.M{"updated_at": bson.M{"$lt": filter.UpdatedBefore.UTC()}})
		}
```

- [ ] **Step 7: Run all backends**

Run: `go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: PASS on all four.

If SQLite alone fails `count stalled`, the time parameter is being compared as text in a different layout from the stored column. Look at what is stored: `sqlite3 <the temp db> "select typeof(updated_at), updated_at from weave_documents limit 1"` (add a `t.Log(t.TempDir())` temporarily to find it), then bind the parameter in that exact layout, for example `filter.UpdatedBefore.UTC().Format("2006-01-02 15:04:05.999999999-07:00")`, and re-run. Remove the temporary log before committing.

- [ ] **Step 8: Commit**

```bash
git add store/storetest/tenancy.go
git commit --only -m "feat(store): filter by tenant exactly and count documents by last update" -- store/storetest/tenancy.go store/storetest/storetest.go collection/store.go document/store.go chunk/store.go store/memory/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go
git show --stat HEAD
```

---

### Task 6: Page chunks by document or collection

**Files:**
- Create: `store/storetest/chunks.go`
- Modify: `store/storetest/storetest.go`
- Modify: `chunk/store.go` (`ListFilter`, `Store.ListChunks`)
- Modify: the four backends (new `ListChunks`)

**Interfaces:**
- Produces: `chunk.ListFilter{DocumentID id.DocumentID; CollectionID id.CollectionID; Tenant *string; Limit, Offset int}` and `Store.ListChunks(ctx context.Context, filter *ListFilter) ([]*Chunk, error)`, ordered by `document_id` then `index`. Totals come from `CountChunks` with the same filters.

- [ ] **Step 1: Write the failing case**

`store/storetest/chunks.go`:

```go
package storetest

import (
	"context"
	"testing"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/store"
)

func testChunks(t *testing.T, s store.Store) {
	ctx := context.Background()

	a := mustCollection(t, s, "chunks-a", "t1")
	b := mustCollection(t, s, "chunks-b", "t1")
	d1 := mustDocument(t, s, a, "first", document.StateReady)
	d2 := mustDocument(t, s, a, "second", document.StateReady)
	d3 := mustDocument(t, s, b, "third", document.StateReady)
	c1 := mustChunks(t, s, d1, 3)
	c2 := mustChunks(t, s, d2, 2)
	mustChunks(t, s, d3, 1)

	byDoc, err := s.ListChunks(ctx, &chunk.ListFilter{DocumentID: d1.ID})
	if err != nil {
		t.Fatalf("list by document: %v", err)
	}
	sameOrder(t, "by document, in index order", chunkIDs(byDoc), chunkIDs(c1))

	// Every field the dashboard shows survives the round trip.
	got, want := byDoc[2], c1[2]
	if got.StartOffset != want.StartOffset || got.EndOffset != want.EndOffset ||
		got.TokenCount != want.TokenCount || got.Index != want.Index ||
		got.Content != want.Content || got.Metadata["section"] != "2" ||
		got.TenantID != "t1" || got.CollectionID.String() != a.ID.String() || got.CreatedAt.IsZero() {
		t.Errorf("round trip: got %+v, want %+v", got, want)
	}

	all, err := s.ListChunks(ctx, &chunk.ListFilter{CollectionID: a.ID})
	if err != nil {
		t.Fatalf("list by collection: %v", err)
	}
	sameSet(t, "by collection", chunkIDs(all), append(chunkIDs(c1), chunkIDs(c2)...))
	for i := 1; i < len(all); i++ {
		prev, cur := all[i-1], all[i]
		if prev.DocumentID.String() == cur.DocumentID.String() && prev.Index > cur.Index {
			t.Errorf("by collection: index out of order within %s", cur.DocumentID)
		}
		if prev.DocumentID.String() > cur.DocumentID.String() {
			t.Errorf("by collection: documents out of order at %d", i)
		}
	}

	page, err := s.ListChunks(ctx, &chunk.ListFilter{CollectionID: a.ID, Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("list page: %v", err)
	}
	sameOrder(t, "page of two from offset two", chunkIDs(page), chunkIDs(all[2:4]))

	none, err := s.ListChunks(ctx, &chunk.ListFilter{CollectionID: a.ID, Tenant: ptr("t2")})
	if err != nil {
		t.Fatalf("list other tenant: %v", err)
	}
	sameSet(t, "other tenant", chunkIDs(none), nil)
}
```

Register in `Run`:

```go
	t.Run("Chunks", func(t *testing.T) { testChunks(t, open(t)) })
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./store/... -run 'TestConformance/Chunks' 2>&1 | tail -5`
Expected: compile error, `undefined: chunk.ListFilter`.

- [ ] **Step 3: Declare the filter and method**

`chunk/store.go`:

```go
// ListFilter controls paging and filtering for chunk listings. Results are
// ordered by document ID, then by index within each document.
type ListFilter struct {
	// DocumentID filters by document. Empty means all documents.
	DocumentID id.DocumentID
	// CollectionID filters by collection. Empty means all collections.
	CollectionID id.CollectionID
	// Tenant filters by tenant: nil means every tenant, non-nil is exact.
	Tenant *string
	// Limit is the maximum number of chunks to return. Zero means no limit.
	Limit int
	// Offset is the number of chunks to skip.
	Offset int
}
```

and in the `Store` interface:

```go
	// ListChunks returns chunks matching the filter, ordered by document
	// then index.
	ListChunks(ctx context.Context, filter *ListFilter) ([]*Chunk, error)
```

- [ ] **Step 4: Implement in memory**

`store/memory/store.go`:

```go
// ListChunks returns chunks matching the filter, ordered by document then index.
func (s *Store) ListChunks(_ context.Context, filter *chunk.ListFilter) ([]*chunk.Chunk, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*chunk.Chunk
	for _, ch := range s.chunks {
		if filter != nil {
			if filter.DocumentID.String() != "" && ch.DocumentID.String() != filter.DocumentID.String() {
				continue
			}
			if filter.CollectionID.String() != "" && ch.CollectionID.String() != filter.CollectionID.String() {
				continue
			}
			if filter.Tenant != nil && ch.TenantID != *filter.Tenant {
				continue
			}
		}
		result = append(result, ch)
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if a.DocumentID.String() != b.DocumentID.String() {
			return a.DocumentID.String() < b.DocumentID.String()
		}
		return a.Index < b.Index
	})
	if filter != nil {
		if filter.Offset >= len(result) {
			return nil, nil
		}
		result = result[filter.Offset:]
		if filter.Limit > 0 && filter.Limit < len(result) {
			result = result[:filter.Limit]
		}
	}
	return result, nil
}
```

- [ ] **Step 5: Implement in Postgres**

```go
func (s *Store) ListChunks(ctx context.Context, filter *chunk.ListFilter) ([]*chunk.Chunk, error) {
	var models []chunkModel
	q := s.pg.NewSelect(&models).OrderExpr("document_id ASC, index ASC")
	if filter != nil {
		if filter.DocumentID.String() != "" {
			q = q.Where("document_id = ?", filter.DocumentID.String())
		}
		if filter.CollectionID.String() != "" {
			q = q.Where("collection_id = ?", filter.CollectionID.String())
		}
		if filter.Tenant != nil {
			q = q.Where("tenant_id = ?", *filter.Tenant)
		}
		if filter.Limit > 0 {
			q = q.Limit(filter.Limit)
		}
		if filter.Offset > 0 {
			q = q.Offset(filter.Offset)
		}
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("weave: list chunks: %w", err)
	}
	result := make([]*chunk.Chunk, len(models))
	for i := range models {
		result[i] = chunkFromModel(&models[i])
	}
	return result, nil
}
```

- [ ] **Step 6: Implement in SQLite**

The same as Postgres with `s.sdb.NewSelect`, `OrderExpr(`document_id ASC, "index" ASC`)` (SQLite needs `index` quoted, as `ListChunksByDocument` already does), and the error-returning mapper:

```go
	result := make([]*chunk.Chunk, len(models))
	for i := range models {
		c, err := chunkFromModel(&models[i])
		if err != nil {
			return nil, err
		}
		result[i] = c
	}
	return result, nil
```

(SQLite's `chunkFromModel` returns `(*chunk.Chunk, error)`; Postgres's returns a single value, which is why the two loops differ.)

- [ ] **Step 7: Implement in Mongo**

```go
func (s *Store) ListChunks(ctx context.Context, filter *chunk.ListFilter) ([]*chunk.Chunk, error) {
	var models []chunkModel
	q := s.mdb.NewFind(&models).Sort(bson.D{{Key: "document_id", Value: 1}, {Key: "index", Value: 1}})
	if filter != nil {
		if filter.DocumentID.String() != "" {
			q = q.Filter(bson.M{"document_id": filter.DocumentID.String()})
		}
		if filter.CollectionID.String() != "" {
			q = q.Filter(bson.M{"collection_id": filter.CollectionID.String()})
		}
		if filter.Tenant != nil {
			q = q.Filter(bson.M{"tenant_id": *filter.Tenant})
		}
		if filter.Limit > 0 {
			q = q.Limit(int64(filter.Limit))
		}
		if filter.Offset > 0 {
			q = q.Skip(int64(filter.Offset))
		}
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("weave: list chunks: %w", err)
	}
	result := make([]*chunk.Chunk, len(models))
	for i := range models {
		c, err := chunkFromModel(&models[i])
		if err != nil {
			return nil, err
		}
		result[i] = c
	}
	return result, nil
}
```

- [ ] **Step 8: Run all backends, then the whole module**

Run: `go test ./store/... -run TestConformance -v 2>&1 | grep -E '^(--- |ok|FAIL)'` then `go build ./... && go vet ./...`
Expected: PASS on all four; build and vet clean (the interface grew, so any other `chunk.Store` implementer fails to compile here: there should be none outside `store/`).

- [ ] **Step 9: Commit**

```bash
git add store/storetest/chunks.go
git commit --only -m "feat(store): page chunks by document or collection" -- store/storetest/chunks.go store/storetest/storetest.go chunk/store.go store/memory/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go
git show --stat HEAD
```

---

### Task 7: Retrieval hits keep their identity

**Files:**
- Create: `engine/helpers_test.go`
- Create: `engine/retrieve_test.go`
- Create: `retriever/entry.go`
- Modify: `retriever/similarity.go`, `retriever/mmr.go`, `retriever/hybrid.go`
- Modify: `engine/engine.go` (`ScoredChunk`, `Retrieve`, new `retrieveRaw`, new `hydrate`)

**Interfaces:**
- Produces: `retriever.ChunkFromSearchResult(sr vectorstore.SearchResult) *chunk.Chunk`.
- Produces: `engine.ScoredChunk{Chunk *chunk.Chunk "chunk"; Score float64 "score"; Hydrated bool "hydrated"; Orphaned bool "orphaned"}`.
- Produces (unexported, used by Tasks 8 and 11): `(*Engine).retrieveRaw(ctx, query string, params *RetrieveParams) ([]ScoredChunk, error)` and `(*Engine).hydrate(ctx, hits []ScoredChunk) ([]ScoredChunk, error)`.
- Produces test helpers in package `engine_test`: `hashEmbedder`, `newTestEngine(t, opts ...engine.Option) *engine.Engine`, `mustIngest(t, e, colID id.CollectionID, title, content string) id.DocumentID`, `mustTestCollection(t, e, name string) *collection.Collection`.

- [ ] **Step 1: Write the test helpers**

`engine/helpers_test.go`:

```go
package engine_test

import (
	"context"
	"hash/fnv"
	"strings"
	"testing"

	"github.com/xraph/weave/chunker"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/embedder"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/store/memory"
	vsmemory "github.com/xraph/weave/vectorstore/memory"
)

// hashEmbedder is a deterministic bag-of-words embedder: each word adds one
// to a hashed dimension. Texts that share words score higher, so ranking
// tests can reason about order without a network call.
type hashEmbedder struct{ dims int }

func (h hashEmbedder) Embed(_ context.Context, texts []string) ([]embedder.EmbedResult, error) {
	out := make([]embedder.EmbedResult, len(texts))
	for i, text := range texts {
		v := make([]float32, h.dims)
		for _, w := range strings.Fields(strings.ToLower(text)) {
			f := fnv.New32a()
			_, _ = f.Write([]byte(w))
			v[f.Sum32()%uint32(h.dims)]++
		}
		out[i] = embedder.EmbedResult{Vector: v}
	}
	return out, nil
}

func (h hashEmbedder) Dimensions() int { return h.dims }

// testRig is an engine on memory stores, with the stores and embedder kept
// so a test can build retrievers on them or reach past the engine.
type testRig struct {
	Engine  *engine.Engine
	Store   *memory.Store
	Vectors *vsmemory.Store
	Embed   hashEmbedder
}

// rigOption builds an engine option from the rig's own parts, so a test can
// wire a retriever onto the same stores the engine uses.
type rigOption func(r *testRig) engine.Option

func withOpt(o engine.Option) rigOption { return func(*testRig) engine.Option { return o } }

func newRig(t *testing.T, extra ...rigOption) *testRig {
	t.Helper()
	r := &testRig{Store: memory.New(), Vectors: vsmemory.New(), Embed: hashEmbedder{dims: 256}}
	opts := []engine.Option{
		engine.WithStore(r.Store),
		engine.WithVectorStore(r.Vectors),
		engine.WithEmbedder(r.Embed),
		engine.WithChunker(chunker.NewRecursiveChunker()),
	}
	for _, f := range extra {
		opts = append(opts, f(r))
	}
	e, err := engine.New(opts...)
	if err != nil {
		t.Fatalf("engine.New: %v", err)
	}
	r.Engine = e
	return r
}

func newTestEngine(t *testing.T, opts ...engine.Option) *engine.Engine {
	t.Helper()
	extra := make([]rigOption, len(opts))
	for i, o := range opts {
		extra[i] = withOpt(o)
	}
	return newRig(t, extra...).Engine
}

func mustTestCollection(t *testing.T, e *engine.Engine, name string) *collection.Collection {
	t.Helper()
	col := &collection.Collection{Name: name, ChunkSize: 512, ChunkOverlap: 0}
	if err := e.CreateCollection(context.Background(), col); err != nil {
		t.Fatalf("create collection %q: %v", name, err)
	}
	return col
}

// mustIngest ingests short content that the recursive chunker keeps as one
// chunk at size 512, and returns the document ID.
func mustIngest(t *testing.T, ctx context.Context, e *engine.Engine, colID id.CollectionID, title, content string) id.DocumentID {
	t.Helper()
	res, err := e.Ingest(ctx, &engine.IngestInput{CollectionID: colID, Title: title, Content: content})
	if err != nil {
		t.Fatalf("ingest %q: %v", title, err)
	}
	return res.DocumentID
}
```

(`newTestEngine` returns just the engine; tests that need the stores use `newRig`.)

- [ ] **Step 2: Write the failing identity tests**

`engine/retrieve_test.go`:

```go
package engine_test

import (
	"context"
	"testing"

	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/retriever"
)

func TestRetrieveHitsCarryIdentity(t *testing.T) {
	configs := map[string][]rigOption{
		"no retriever": nil,
		"similarity": {func(r *testRig) engine.Option {
			return engine.WithRetriever(retriever.NewSimilarityRetriever(r.Vectors, r.Embed, r.Store))
		}},
		"mmr": {func(r *testRig) engine.Option {
			return engine.WithRetriever(retriever.NewMMRRetriever(r.Vectors, r.Embed, 0.7))
		}},
		"hybrid": {func(r *testRig) engine.Option {
			return engine.WithRetriever(retriever.NewHybridRetriever(retriever.NewSimilarityRetriever(r.Vectors, r.Embed, r.Store)))
		}},
	}
	for name, extra := range configs {
		t.Run(name, func(t *testing.T) {
			r := newRig(t, extra...)
			ctx := context.Background()
			col := mustTestCollection(t, r.Engine, "identity")
			mustIngest(t, ctx, r.Engine, col.ID, "shipping", "shipping takes five working days")
			want := mustIngest(t, ctx, r.Engine, col.ID, "refunds", "refunds are issued within thirty days")

			hits, err := r.Engine.Retrieve(ctx, "refunds thirty days", engine.WithCollection(col.ID), engine.WithTopK(2))
			if err != nil {
				t.Fatalf("retrieve: %v", err)
			}
			if len(hits) == 0 {
				t.Fatal("retrieve: no hits")
			}
			top := hits[0]
			if !top.Hydrated || top.Orphaned {
				t.Errorf("top hit: hydrated=%v orphaned=%v, want hydrated and not orphaned", top.Hydrated, top.Orphaned)
			}
			if top.Chunk.ID.String() == "" {
				t.Error("top hit: empty chunk ID")
			}
			if top.Chunk.DocumentID.String() != want.String() {
				t.Errorf("top hit: document %q, want %q", top.Chunk.DocumentID, want)
			}
			if top.Chunk.CollectionID.String() != col.ID.String() {
				t.Errorf("top hit: collection %q, want %q", top.Chunk.CollectionID, col.ID)
			}
			if top.Chunk.EndOffset == 0 || top.Chunk.TokenCount == 0 {
				t.Errorf("top hit: offsets/tokens not hydrated: %+v", top.Chunk)
			}
		})
	}
}

func TestRetrieveMarksOrphans(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	col := mustTestCollection(t, r.Engine, "orphans")
	doc := mustIngest(t, ctx, r.Engine, col.ID, "refunds", "refunds are issued within thirty days")

	// Remove the chunk rows and leave the vectors, which is what a failed
	// ingest leaves behind in the opposite order.
	if err := r.Store.DeleteChunksByDocument(ctx, doc); err != nil {
		t.Fatalf("delete chunks: %v", err)
	}

	hits, err := r.Engine.Retrieve(ctx, "refunds", engine.WithCollection(col.ID))
	if err != nil {
		t.Fatalf("retrieve: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("retrieve: got %d hits, want the orphan kept", len(hits))
	}
	if !hits[0].Orphaned || hits[0].Hydrated {
		t.Errorf("orphan: orphaned=%v hydrated=%v", hits[0].Orphaned, hits[0].Hydrated)
	}
	if hits[0].Chunk.ID.String() == "" || hits[0].Chunk.Content == "" {
		t.Errorf("orphan: kept no ID or content: %+v", hits[0].Chunk)
	}
}
```

- [ ] **Step 3: Run to see it fail**

Run: `go test ./engine/ -run 'TestRetrieve' 2>&1 | tail -8`
Expected: compile error, `top.Hydrated undefined`.

- [ ] **Step 4: Add the shared entry mapper**

`retriever/entry.go`:

```go
package retriever

import (
	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/vectorstore"
)

// ChunkFromSearchResult builds the chunk a vector hit stands for. The vector
// entry's ID is the chunk ID ingest wrote, so it is carried through: without
// it nobody can tell which chunk, document or collection a hit came from.
// Everything else on the chunk comes from the metadata store, which the
// engine reads afterwards.
func ChunkFromSearchResult(sr vectorstore.SearchResult) *chunk.Chunk {
	chunkID, _ := id.ParseChunkID(sr.ID) //nolint:errcheck // a foreign ID leaves the chunk unidentified, which the engine reports
	return &chunk.Chunk{
		ID:       chunkID,
		Content:  sr.Content,
		Metadata: sr.Metadata,
	}
}
```

In `retriever/similarity.go` and `retriever/mmr.go`, replace the two `&chunk.Chunk{Content: ..., Metadata: ...}` literals with `ChunkFromSearchResult(sr)` and `ChunkFromSearchResult(c)` respectively, and drop the now-unused `chunk` import from `mmr.go` if the compiler says so.

In `retriever/hybrid.go`, dedupe by chunk ID when there is one:

```go
		for rank, res := range results {
			key := res.Chunk.ID.String()
			if key == "" {
				key = res.Chunk.Content // a retriever that sets no IDs still dedupes by text
			}
```

- [ ] **Step 5: Hydrate in the engine**

In `engine/engine.go`, extend `ScoredChunk`:

```go
// ScoredChunk is a chunk with its relevance score.
type ScoredChunk struct {
	Chunk *chunk.Chunk `json:"chunk"`
	Score float64      `json:"score"`
	// Hydrated is true when Chunk was read back from the metadata store by
	// ID, so every field on it is real.
	Hydrated bool `json:"hydrated"`
	// Orphaned is true when the vector store returned a chunk ID that has no
	// row in the metadata store. The hit keeps its rank and its text.
	Orphaned bool `json:"orphaned,omitempty"`
}
```

Replace the whole of the existing `Retrieve` function (from its doc comment through its closing brace, just above `// Document operations`) with these four functions:

```go
// Retrieve performs a semantic retrieval query. Each hit is read back from
// the metadata store by chunk ID; a hit whose row is missing is kept and
// marked Orphaned.
func (e *Engine) Retrieve(ctx context.Context, query string, opts ...RetrieveOption) ([]ScoredChunk, error) {
	if e.retriever == nil && (e.embedder == nil || e.vectorStore == nil) {
		return nil, fmt.Errorf("weave: no retriever or embedder+vectorstore configured")
	}
	params := &RetrieveParams{TopK: e.config.DefaultTopK}
	for _, opt := range opts {
		opt(params)
	}

	colID, _ := id.ParseCollectionID(params.CollectionID) //nolint:errcheck // empty for cross-collection search
	start := time.Now()
	e.extensions.EmitRetrievalStarted(ctx, colID, query)

	hits, err := e.retrieveRaw(ctx, query, params)
	if err == nil {
		hits, err = e.hydrate(ctx, hits)
	}
	if err != nil {
		e.extensions.EmitRetrievalFailed(ctx, colID, err)
		return nil, err
	}
	e.extensions.EmitRetrievalCompleted(ctx, colID, len(hits), time.Since(start))
	return hits, nil
}

// searchScope builds the metadata filter and tenant key both search paths
// send to the vector side.
func searchScope(params *RetrieveParams) (map[string]string, string) {
	filter := map[string]string{}
	if params.CollectionID != "" {
		filter["collection_id"] = params.CollectionID
	}
	if params.TenantID != "" {
		filter["tenant_id"] = params.TenantID
	}
	return filter, params.TenantID
}

// retrieveRaw runs the configured retriever, or a plain vector search when
// none is configured, and returns hits as the vector side reported them. It
// emits no hooks: Retrieve does, once, around the whole call.
func (e *Engine) retrieveRaw(ctx context.Context, query string, params *RetrieveParams) ([]ScoredChunk, error) {
	if params.TenantID == "" {
		params.TenantID = weave.TenantFromContext(ctx)
	}
	filter, tenantKey := searchScope(params)

	if e.retriever != nil {
		results, err := e.retriever.Retrieve(ctx, query, &retriever.Options{
			CollectionID: params.CollectionID,
			TenantKey:    tenantKey,
			TopK:         params.TopK,
			MinScore:     params.MinScore,
			Filter:       filter,
		})
		if err != nil {
			return nil, fmt.Errorf("weave: retrieve: %w", err)
		}
		scored := make([]ScoredChunk, len(results))
		for i, r := range results {
			scored[i] = ScoredChunk{Chunk: r.Chunk, Score: r.Score}
		}
		return scored, nil
	}

	embedResults, err := e.embedder.Embed(ctx, []string{query})
	if err != nil {
		return nil, fmt.Errorf("weave: embed query: %w", err)
	}
	if len(embedResults) == 0 {
		return nil, fmt.Errorf("weave: embed query: no vector returned")
	}
	searchResults, err := e.vectorStore.Search(ctx, embedResults[0].Vector, &vectorstore.SearchOptions{
		TopK:      params.TopK,
		Filter:    filter,
		TenantKey: tenantKey,
		MinScore:  params.MinScore,
	})
	if err != nil {
		return nil, fmt.Errorf("weave: search: %w", err)
	}
	scored := make([]ScoredChunk, len(searchResults))
	for i, sr := range searchResults {
		scored[i] = ScoredChunk{Chunk: retriever.ChunkFromSearchResult(sr), Score: sr.Score}
	}
	return scored, nil
}

// hydrate replaces each hit's chunk with the stored row. A hit with no chunk
// ID (a custom retriever that sets none) is left as it is, unhydrated.
func (e *Engine) hydrate(ctx context.Context, hits []ScoredChunk) ([]ScoredChunk, error) {
	if e.store == nil {
		return hits, nil
	}
	for i := range hits {
		h := &hits[i]
		if h.Chunk == nil || h.Chunk.ID.String() == "" {
			continue
		}
		row, err := e.store.GetChunk(ctx, h.Chunk.ID)
		switch {
		case errors.Is(err, weave.ErrChunkNotFound):
			h.Orphaned = true
		case err != nil:
			return nil, fmt.Errorf("weave: hydrate chunk %s: %w", h.Chunk.ID, err)
		default:
			h.Chunk = row
			h.Hydrated = true
		}
	}
	return hits, nil
}
```

Add `"errors"` to the imports. If `chunk` is no longer referenced in `engine.go` after this, the compiler will say so; it still is (Ingest builds chunks), so expect no change there.

- [ ] **Step 6: Run the engine tests**

Run: `go test ./engine/ ./retriever/ -run 'TestRetrieve' -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: all five subtests and the orphan test PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/helpers_test.go engine/retrieve_test.go retriever/entry.go
git commit --only -m "fix(engine): keep each retrieval hit's chunk, document and collection" -- engine/helpers_test.go engine/retrieve_test.go engine/engine.go retriever/entry.go retriever/similarity.go retriever/mmr.go retriever/hybrid.go
git show --stat HEAD
```

---

### Task 8: Tenant filtering and read methods on the engine

**Files:**
- Create: `engine/reads.go`
- Create: `engine/reads_test.go`
- Modify: `engine/engine.go` (`RetrieveParams.TenantFilter`, `WithTenantFilter`, filter building in `retrieveRaw`)
- Modify: `errors.go` (`ErrInvalidArgument`)

**Interfaces:**
- Produces: `engine.WithTenantFilter(tenant string) RetrieveOption`. It wins over the context tenant and is always applied as an exact metadata match, `""` included.
- Produces: `weave.ErrInvalidArgument`.
- Produces on `*Engine`: `CountCollections(ctx, *collection.CountFilter) (int64, error)`, `CountDocuments(ctx, *document.CountFilter) (int64, error)`, `CountChunks(ctx, *chunk.CountFilter) (int64, error)`, `GetChunk(ctx, id.ChunkID) (*chunk.Chunk, error)`, `ListChunks(ctx, *chunk.ListFilter) ([]*chunk.Chunk, error)` (refuses a filter naming neither a document nor a collection with `ErrInvalidArgument`).

- [ ] **Step 1: Write the failing tests**

`engine/reads_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/weave"
	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/engine"
)

func TestRetrieveTenantFilter(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	col := mustTestCollection(t, r.Engine, "tenants")
	d1 := mustIngest(t, weave.WithTenant(ctx, "t1"), r.Engine, col.ID, "t1 refunds", "refunds for tenant one")
	d0 := mustIngest(t, ctx, r.Engine, col.ID, "open refunds", "refunds for nobody in particular")
	mustIngest(t, weave.WithTenant(ctx, "t2"), r.Engine, col.ID, "t2 refunds", "refunds for tenant two")

	docsOf := func(hits []engine.ScoredChunk) map[string]bool {
		m := map[string]bool{}
		for _, h := range hits {
			m[h.Chunk.DocumentID.String()] = true
		}
		return m
	}

	t1, err := r.Engine.Retrieve(ctx, "refunds", engine.WithCollection(col.ID), engine.WithTenantFilter("t1"))
	if err != nil {
		t.Fatalf("t1: %v", err)
	}
	if got := docsOf(t1); len(got) != 1 || !got[d1.String()] {
		t.Errorf("t1 filter: got documents %v, want only %s", got, d1)
	}

	none, err := r.Engine.Retrieve(ctx, "refunds", engine.WithCollection(col.ID), engine.WithTenantFilter(""))
	if err != nil {
		t.Fatalf("empty: %v", err)
	}
	if got := docsOf(none); len(got) != 1 || !got[d0.String()] {
		t.Errorf("empty tenant filter: got documents %v, want only the untenanted %s", got, d0)
	}

	all, err := r.Engine.Retrieve(ctx, "refunds", engine.WithCollection(col.ID))
	if err != nil {
		t.Fatalf("all: %v", err)
	}
	if got := docsOf(all); len(got) != 3 {
		t.Errorf("no filter: got %d documents, want 3", len(got))
	}
}

func TestListChunksNeedsAScope(t *testing.T) {
	e := newTestEngine(t)
	if _, err := e.ListChunks(context.Background(), &chunk.ListFilter{}); !errors.Is(err, weave.ErrInvalidArgument) {
		t.Errorf("unscoped ListChunks: got %v, want ErrInvalidArgument", err)
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./engine/ -run 'TestRetrieveTenantFilter|TestListChunksNeedsAScope' 2>&1 | tail -5`
Expected: compile error, `undefined: engine.WithTenantFilter`.

- [ ] **Step 3: Add the error and the option**

`errors.go`, in the State errors group:

```go
	ErrInvalidArgument = errors.New("weave: invalid argument")
```

`engine/engine.go`, in `RetrieveParams`:

```go
	// TenantFilter, when set, restricts retrieval to exactly this tenant,
	// "" included, and wins over the context tenant. It is sent as a
	// metadata filter because every vector store ignores an empty TenantKey.
	TenantFilter *string `json:"-"`
```

and the option:

```go
// WithTenantFilter restricts retrieval to exactly one tenant. Unlike
// WithTenantID, an empty string means "rows with no tenant", not "everyone".
func WithTenantFilter(tenant string) RetrieveOption {
	return func(p *RetrieveParams) { p.TenantFilter = &tenant }
}
```

Replace `searchScope` (Task 7) so an explicit filter wins and is always applied, `""` included:

```go
// searchScope builds the metadata filter and tenant key both search paths
// send to the vector side. An explicit TenantFilter wins over the context
// tenant and is always applied as an exact metadata match, because every
// vector store treats an empty TenantKey as "no filter".
func searchScope(params *RetrieveParams) (map[string]string, string) {
	filter := map[string]string{}
	if params.CollectionID != "" {
		filter["collection_id"] = params.CollectionID
	}
	tenantKey := params.TenantID
	switch {
	case params.TenantFilter != nil:
		filter["tenant_id"] = *params.TenantFilter
		tenantKey = *params.TenantFilter
	case params.TenantID != "":
		filter["tenant_id"] = params.TenantID
	}
	return filter, tenantKey
}
```

`retrieveRaw` itself does not change: it still fills `TenantID` from the context first, and `searchScope` decides.

- [ ] **Step 4: Add the read methods**

`engine/reads.go`:

```go
package engine

import (
	"context"
	"fmt"

	"github.com/xraph/weave"
	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/id"
)

// CountCollections counts collections matching the filter.
func (e *Engine) CountCollections(ctx context.Context, filter *collection.CountFilter) (int64, error) {
	if e.store == nil {
		return 0, weave.ErrNoStore
	}
	return e.store.CountCollections(ctx, filter)
}

// CountDocuments counts documents matching the filter.
func (e *Engine) CountDocuments(ctx context.Context, filter *document.CountFilter) (int64, error) {
	if e.store == nil {
		return 0, weave.ErrNoStore
	}
	return e.store.CountDocuments(ctx, filter)
}

// CountChunks counts chunks matching the filter.
func (e *Engine) CountChunks(ctx context.Context, filter *chunk.CountFilter) (int64, error) {
	if e.store == nil {
		return 0, weave.ErrNoStore
	}
	return e.store.CountChunks(ctx, filter)
}

// GetChunk reads one chunk.
func (e *Engine) GetChunk(ctx context.Context, chunkID id.ChunkID) (*chunk.Chunk, error) {
	if e.store == nil {
		return nil, weave.ErrNoStore
	}
	return e.store.GetChunk(ctx, chunkID)
}

// ListChunks pages chunks by document or by collection. A filter naming
// neither is refused: an unscoped chunk listing is a full table scan nobody
// asked for.
func (e *Engine) ListChunks(ctx context.Context, filter *chunk.ListFilter) ([]*chunk.Chunk, error) {
	if e.store == nil {
		return nil, weave.ErrNoStore
	}
	if filter == nil || (filter.DocumentID.String() == "" && filter.CollectionID.String() == "") {
		return nil, fmt.Errorf("%w: list chunks needs a document or a collection", weave.ErrInvalidArgument)
	}
	return e.store.ListChunks(ctx, filter)
}
```

- [ ] **Step 5: Run the engine tests**

Run: `go test ./engine/ -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: every test PASS, including Task 7's.

- [ ] **Step 6: Commit**

```bash
git add engine/reads.go engine/reads_test.go
git commit --only -m "feat(engine): filter retrieval by an exact tenant and expose the reads the dashboard needs" -- engine/reads.go engine/reads_test.go engine/engine.go errors.go
git show --stat HEAD
```

---

### Task 9: Update a collection's name, description and metadata

**Files:**
- Create: `engine/collection_update.go`
- Create: `engine/collection_update_test.go`

**Interfaces:**
- Produces: `engine.CollectionUpdate{Name *string; Description *string; Metadata *map[string]string}` and `(*Engine).UpdateCollection(ctx, colID id.CollectionID, upd CollectionUpdate) (*collection.Collection, error)`. Chunk settings and the recorded model, dims and strategy are not updatable.

- [ ] **Step 1: Write the failing test**

`engine/collection_update_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/weave"
	"github.com/xraph/weave/engine"
)

func TestUpdateCollection(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()
	col := mustTestCollection(t, e, "support")
	col.Description = "help centre"
	col.Metadata = map[string]string{"team": "cx"}
	if _, err := e.UpdateCollection(ctx, col.ID, engine.CollectionUpdate{Description: &col.Description, Metadata: &col.Metadata}); err != nil {
		t.Fatalf("seed update: %v", err)
	}
	beforeSize := col.ChunkSize

	name := "customer support"
	got, err := e.UpdateCollection(ctx, col.ID, engine.CollectionUpdate{Name: &name})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if got.Name != name || got.Description != "help centre" || got.Metadata["team"] != "cx" {
		t.Errorf("rename touched other fields: %+v", got)
	}
	if got.ChunkSize != beforeSize {
		t.Errorf("rename changed chunk size to %d", got.ChunkSize)
	}

	empty := map[string]string{}
	got, err = e.UpdateCollection(ctx, col.ID, engine.CollectionUpdate{Metadata: &empty})
	if err != nil {
		t.Fatalf("clear metadata: %v", err)
	}
	if len(got.Metadata) != 0 {
		t.Errorf("clear metadata: still %v", got.Metadata)
	}

	blank := "   "
	if _, err := e.UpdateCollection(ctx, col.ID, engine.CollectionUpdate{Name: &blank}); !errors.Is(err, weave.ErrInvalidArgument) {
		t.Errorf("blank name: got %v, want ErrInvalidArgument", err)
	}
	stored, err := e.GetCollection(ctx, col.ID)
	if err != nil {
		t.Fatalf("get after refused update: %v", err)
	}
	if stored.Name != name {
		t.Errorf("refused update changed the name to %q", stored.Name)
	}

	mustTestCollection(t, e, "billing")
	taken := "billing"
	if _, err := e.UpdateCollection(ctx, col.ID, engine.CollectionUpdate{Name: &taken}); !errors.Is(err, weave.ErrCollectionAlreadyExists) {
		t.Errorf("taken name: got %v, want ErrCollectionAlreadyExists", err)
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./engine/ -run TestUpdateCollection 2>&1 | tail -5`
Expected: compile error, `undefined: engine.CollectionUpdate`.

- [ ] **Step 3: Implement**

`engine/collection_update.go`:

```go
package engine

import (
	"context"
	"fmt"
	"maps"
	"strings"

	"github.com/xraph/weave"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/id"
)

// CollectionUpdate changes the parts of a collection that are safe to change
// after ingestion. A nil field is left alone. Chunk size, overlap and the
// recorded embedding model, dimensions and strategy are deliberately absent:
// Weave cannot re-chunk existing documents, so changing them would leave
// every existing chunk built under different settings from new ones.
type CollectionUpdate struct {
	Name        *string
	Description *string
	Metadata    *map[string]string
}

// UpdateCollection applies upd and returns the stored collection.
func (e *Engine) UpdateCollection(ctx context.Context, colID id.CollectionID, upd CollectionUpdate) (*collection.Collection, error) {
	if e.store == nil {
		return nil, weave.ErrNoStore
	}
	if upd.Name != nil && strings.TrimSpace(*upd.Name) == "" {
		return nil, fmt.Errorf("%w: collection name cannot be blank", weave.ErrInvalidArgument)
	}

	current, err := e.store.GetCollection(ctx, colID)
	if err != nil {
		return nil, err
	}
	// Work on a copy: the memory store hands back its own pointer, and a
	// refused write must not leave a half-applied change behind.
	next := *current
	if upd.Name != nil {
		next.Name = strings.TrimSpace(*upd.Name)
	}
	if upd.Description != nil {
		next.Description = *upd.Description
	}
	if upd.Metadata != nil {
		next.Metadata = maps.Clone(*upd.Metadata)
		if next.Metadata == nil {
			next.Metadata = map[string]string{}
		}
	}
	if err := e.store.UpdateCollection(ctx, &next); err != nil {
		return nil, err
	}
	return e.store.GetCollection(ctx, colID)
}
```

- [ ] **Step 4: Run, then commit**

Run: `go test ./engine/ -run TestUpdateCollection -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: PASS.

```bash
git add engine/collection_update.go engine/collection_update_test.go
git commit --only -m "feat(engine): rename a collection and edit its description and metadata" -- engine/collection_update.go engine/collection_update_test.go
git show --stat HEAD
```

---

### Task 10: Report which components are wired

**Files:**
- Create: `component.go` (root package `weave`)
- Create: `engine/components.go`
- Create: `engine/components_test.go`
- Create: `retriever/describe.go`, `retriever/describe_test.go`
- Create: `chunker/describe.go`, `loader/describe.go`, `embedder/describe.go`
- Create: `vectorstore/memory/describe.go`, `vectorstore/pgvector/describe.go`, `vectorstore/fabriq/describe.go`

**Interfaces:**
- Produces in package `weave`: `ComponentInfo{Kind string "kind"; Params map[string]string "params"; Score ScoreKind "score"; TenantFilter string "tenant_filter"; Children []ComponentInfo "children"}`, `ScoreKind` with constants `ScoreCosine "cosine"`, `ScoreVectorSimilarity "vector_similarity"`, `ScoreMMR "mmr_relevance"`, `ScoreRRF "rrf"`, `ScoreRerank "rerank"`, `ScoreUnknown "unknown"`, and `Describer interface{ Describe() ComponentInfo }`.
- Produces in package `engine`: `Component{weave.ComponentInfo; Type string "type"; Configured bool "configured"; ContentTypes []string "content_types"; Dimensions int "dimensions"}`, `Components{Loader, Chunker, Embedder, VectorStore, Retriever Component; Score weave.ScoreKind "score"; TenantFilter string "tenant_filter"}`, `(*Engine).Components() Components`.

- [ ] **Step 1: Write the failing tests**

`retriever/describe_test.go`:

```go
package retriever_test

import (
	"testing"

	"github.com/xraph/weave"
	"github.com/xraph/weave/retriever"
	vsmemory "github.com/xraph/weave/vectorstore/memory"
)

func TestDescribe(t *testing.T) {
	vs := vsmemory.New()
	sim := retriever.NewSimilarityRetriever(vs, nil, nil)
	cases := []struct {
		name  string
		d     weave.Describer
		kind  string
		score weave.ScoreKind
	}{
		{"similarity inherits the vector store's score", sim, "similarity", weave.ScoreCosine},
		{"mmr", retriever.NewMMRRetriever(vs, nil, 0.4), "mmr", weave.ScoreMMR},
		{"hybrid", retriever.NewHybridRetriever(sim), "hybrid", weave.ScoreRRF},
		{"rerank", retriever.NewRerankerRetriever(sim, nil), "rerank", weave.ScoreRerank},
	}
	for _, tc := range cases {
		info := tc.d.Describe()
		if info.Kind != tc.kind || info.Score != tc.score {
			t.Errorf("%s: got kind %q score %q, want %q %q", tc.name, info.Kind, info.Score, tc.kind, tc.score)
		}
	}
	if got := retriever.NewMMRRetriever(vs, nil, 0.4).Describe().Params["lambda"]; got != "0.40" {
		t.Errorf("mmr lambda: got %q, want 0.40", got)
	}
	hy := retriever.NewHybridRetriever(sim).Describe()
	if hy.Params["k"] != "60" || len(hy.Children) != 1 || hy.Children[0].Kind != "similarity" {
		t.Errorf("hybrid: got %+v", hy)
	}
}
```

`engine/components_test.go`:

```go
package engine_test

import (
	"slices"
	"testing"

	"github.com/xraph/weave"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/loader"
	"github.com/xraph/weave/retriever"
)

func TestComponents(t *testing.T) {
	r := newRig(t,
		withOpt(engine.WithLoader(loader.NewMarkdownLoader())),
		func(r *testRig) engine.Option {
			return engine.WithRetriever(retriever.NewMMRRetriever(r.Vectors, r.Embed, 0.7))
		},
	)
	c := r.Engine.Components()

	if c.Retriever.Kind != "mmr" || c.Retriever.Params["lambda"] != "0.70" || !c.Retriever.Configured {
		t.Errorf("retriever: %+v", c.Retriever)
	}
	if c.Score != weave.ScoreMMR {
		t.Errorf("score: got %q, want %q", c.Score, weave.ScoreMMR)
	}
	if c.Chunker.Kind != "recursive" || c.VectorStore.Kind != "memory" || c.TenantFilter != "verified" {
		t.Errorf("chunker %q, vector store %q, tenant filter %q", c.Chunker.Kind, c.VectorStore.Kind, c.TenantFilter)
	}
	// The test embedder implements no Describe, so it reports as custom with
	// its Go type and its real dimensions.
	if c.Embedder.Kind != "custom" || c.Embedder.Type == "" || c.Embedder.Dimensions != r.Embed.dims {
		t.Errorf("embedder: %+v", c.Embedder)
	}
	// Content types are probed from the loader's own Supports, never a list.
	if !slices.Contains(c.Loader.ContentTypes, "text/markdown") || slices.Contains(c.Loader.ContentTypes, "text/html") {
		t.Errorf("loader content types: %v", c.Loader.ContentTypes)
	}

	bare := newTestEngine(t)
	bc := bare.Components()
	if bc.Retriever.Configured || bc.Loader.Configured {
		t.Errorf("bare engine: retriever %+v, loader %+v, want both unconfigured", bc.Retriever, bc.Loader)
	}
	if bc.Score != weave.ScoreCosine {
		t.Errorf("bare engine score: got %q, want cosine from the memory vector store", bc.Score)
	}
}
```

(`MarkdownLoader.Supports` accepts exactly `text/markdown` and `text/x-markdown`, `loader/markdown.go:54-56`.)

- [ ] **Step 2: Run to see it fail**

Run: `go test ./retriever/ ./engine/ -run 'TestDescribe|TestComponents' 2>&1 | tail -5`
Expected: compile error, `undefined: weave.Describer`.

- [ ] **Step 3: Declare the shared types**

`component.go`:

```go
package weave

// ScoreKind names what a retrieval score means, so a page never shows an
// RRF sum or a rerank score as though it were cosine similarity.
type ScoreKind string

const (
	// ScoreCosine is cosine similarity between query and chunk vectors.
	ScoreCosine ScoreKind = "cosine"
	// ScoreVectorSimilarity is whatever similarity the vector store reports,
	// when the store does not say which metric it uses.
	ScoreVectorSimilarity ScoreKind = "vector_similarity"
	// ScoreMMR is the vector relevance score, with results in MMR order.
	ScoreMMR ScoreKind = "mmr_relevance"
	// ScoreRRF is a reciprocal rank fusion sum. It is not comparable to cosine.
	ScoreRRF ScoreKind = "rrf"
	// ScoreRerank is a reranker's score. The vector score is not kept.
	ScoreRerank ScoreKind = "rerank"
	// ScoreUnknown means the component does not describe its score.
	ScoreUnknown ScoreKind = "unknown"
)

// ComponentInfo describes one pipeline component for an operator.
type ComponentInfo struct {
	Kind   string            `json:"kind"`
	Params map[string]string `json:"params,omitempty"`
	// Score is set by retrievers and vector stores.
	Score ScoreKind `json:"score,omitempty"`
	// TenantFilter is set by vector stores: "verified" when an exact
	// tenant_id metadata filter is known to work, otherwise "unverified".
	TenantFilter string `json:"tenant_filter,omitempty"`
	// Children are wrapped components, such as a hybrid retriever's parts.
	Children []ComponentInfo `json:"children,omitempty"`
}

// Describer is implemented by components that can describe themselves.
type Describer interface {
	Describe() ComponentInfo
}
```

- [ ] **Step 4: Describe the built-in components**

`retriever/describe.go`:

```go
package retriever

import (
	"fmt"

	"github.com/xraph/weave"
)

func describeAny(x any) weave.ComponentInfo {
	if d, ok := x.(weave.Describer); ok {
		return d.Describe()
	}
	return weave.ComponentInfo{Kind: "custom", Score: weave.ScoreUnknown}
}

// Describe reports a similarity retriever. Its score is whatever the vector
// store underneath reports.
func (r *SimilarityRetriever) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "similarity", Score: describeAny(r.vs).Score}
}

// Describe reports an MMR retriever and its lambda.
func (r *MMRRetriever) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "mmr", Score: weave.ScoreMMR, Params: map[string]string{"lambda": fmt.Sprintf("%.2f", r.lambda)}}
}

// Describe reports a hybrid retriever, its RRF constant and its parts.
func (r *HybridRetriever) Describe() weave.ComponentInfo {
	children := make([]weave.ComponentInfo, len(r.retrievers))
	for i, sub := range r.retrievers {
		children[i] = describeAny(sub)
	}
	return weave.ComponentInfo{Kind: "hybrid", Score: weave.ScoreRRF, Params: map[string]string{"k": fmt.Sprintf("%g", r.k)}, Children: children}
}

// Describe reports a reranking retriever and the retriever it wraps.
func (r *RerankerRetriever) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "rerank", Score: weave.ScoreRerank, Children: []weave.ComponentInfo{describeAny(r.base)}}
}
```

`chunker/describe.go`:

```go
package chunker

import "github.com/xraph/weave"

// Describe reports the fixed-size chunker.
func (*FixedChunker) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "fixed"} }

// Describe reports the recursive chunker.
func (*RecursiveChunker) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "recursive"} }

// Describe reports the semantic chunker. Its offsets are approximate.
func (*SemanticChunker) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "semantic", Params: map[string]string{"offsets": "approximate"}}
}

// Describe reports the sliding-window chunker.
func (*SlidingChunker) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "sliding"} }

// Describe reports the code chunker. Its offsets are approximate.
func (*CodeChunker) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "code", Params: map[string]string{"offsets": "approximate"}}
}
```

`loader/describe.go`:

```go
package loader

import "github.com/xraph/weave"

// Describe reports the plain-text loader.
func (*TextLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "text"} }

// Describe reports the Markdown loader.
func (*MarkdownLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "markdown"} }

// Describe reports the HTML loader.
func (*HTMLLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "html"} }

// Describe reports the CSV loader.
func (*CSVLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "csv"} }

// Describe reports the JSON loader.
func (*JSONLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "json"} }

// Describe reports the URL loader.
func (*URLLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "url"} }

// Describe reports the directory loader. Its Supports never matches a
// content type, so the Pipeline page lists none for it.
func (*DirectoryLoader) Describe() weave.ComponentInfo { return weave.ComponentInfo{Kind: "directory"} }
```

`embedder/describe.go`:

```go
package embedder

import "github.com/xraph/weave"

// Describe reports the OpenAI embedder and its model.
func (e *OpenAIEmbedder) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "openai", Params: map[string]string{"model": e.model}}
}

// Describe reports the local embedder, which is not implemented yet: every
// Embed call returns ErrNotImplemented.
func (*LocalEmbedder) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "local", Params: map[string]string{"implemented": "false"}}
}
```

`vectorstore/memory/describe.go`:

```go
package memory

import "github.com/xraph/weave"

// Describe reports the in-memory vector store: cosine similarity, and an
// exact tenant_id metadata filter that is covered by Weave's own tests.
func (*Store) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "memory", Score: weave.ScoreCosine, TenantFilter: "verified"}
}
```

`vectorstore/pgvector/describe.go`:

```go
package pgvector

import "github.com/xraph/weave"

// Describe reports the pgvector store. It scores 1 - cosine distance, and
// filters metadata with metadata->>'tenant_id' = $n, which matches "".
func (s *Store) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "pgvector", Score: weave.ScoreCosine, TenantFilter: "verified", Params: map[string]string{"table": s.tableName}}
}
```

`vectorstore/fabriq/describe.go`:

```go
package fabriqvec

import "github.com/xraph/weave"

// Describe reports the fabriq store. Its score is whatever fabriq returns,
// and how fabriq applies a tenant_id filter of "" has not been checked.
func (s *Store) Describe() weave.ComponentInfo {
	return weave.ComponentInfo{Kind: "fabriq", Score: weave.ScoreVectorSimilarity, TenantFilter: "unverified", Params: map[string]string{"entity": s.entity}}
}
```

(The directory is `vectorstore/fabriq`, the package is `fabriqvec`.)

- [ ] **Step 5: Build the engine report**

`engine/components.go`:

```go
package engine

import (
	"fmt"

	"github.com/xraph/weave"
	"github.com/xraph/weave/loader"
)

// probeContentTypes is the list a loader's Supports is asked about. The
// Pipeline page shows the answers, never a hand-written list.
var probeContentTypes = []string{
	"text/plain", "text/markdown", "text/x-markdown", "text/html",
	"application/xhtml+xml", "text/csv", "application/json", "text/uri-list",
}

// Component is one wired pipeline stage.
type Component struct {
	weave.ComponentInfo
	Type         string   `json:"type,omitempty"`
	Configured   bool     `json:"configured"`
	ContentTypes []string `json:"content_types,omitempty"`
	Dimensions   int      `json:"dimensions,omitempty"`
}

// Components reports what the engine actually runs.
type Components struct {
	Loader      Component `json:"loader"`
	Chunker     Component `json:"chunker"`
	Embedder    Component `json:"embedder"`
	VectorStore Component `json:"vector_store"`
	// Retriever is unconfigured when the engine falls back to a plain vector
	// search.
	Retriever Component `json:"retriever"`
	// Score is what a retrieval score means on this engine.
	Score weave.ScoreKind `json:"score"`
	// TenantFilter is "verified" when the vector store's exact tenant filter
	// is known to work, otherwise "unverified".
	TenantFilter string `json:"tenant_filter"`
}

func describe(x any) Component {
	if x == nil {
		return Component{}
	}
	c := Component{Configured: true, Type: fmt.Sprintf("%T", x)}
	if d, ok := x.(weave.Describer); ok {
		c.ComponentInfo = d.Describe()
	} else {
		c.ComponentInfo = weave.ComponentInfo{Kind: "custom"}
	}
	return c
}

// Components describes every stage. A stage that is not configured reports
// Configured false, so a page can say so rather than call it active.
func (e *Engine) Components() Components {
	var c Components
	if e.loader != nil {
		c.Loader = describe(e.loader)
		c.Loader.ContentTypes = supported(e.loader)
	}
	if e.chunker != nil {
		c.Chunker = describe(e.chunker)
	}
	if e.embedder != nil {
		c.Embedder = describe(e.embedder)
		c.Embedder.Dimensions = e.embedder.Dimensions()
	}
	if e.vectorStore != nil {
		c.VectorStore = describe(e.vectorStore)
	}
	if e.retriever != nil {
		c.Retriever = describe(e.retriever)
	}

	switch {
	case c.Retriever.Configured:
		c.Score = c.Retriever.Score
	case c.VectorStore.Configured:
		c.Score = c.VectorStore.Score
	}
	if c.Score == "" {
		c.Score = weave.ScoreUnknown
	}
	c.TenantFilter = c.VectorStore.TenantFilter
	if c.TenantFilter == "" {
		c.TenantFilter = "unverified"
	}
	return c
}

func supported(l loader.Loader) []string {
	var out []string
	for _, ct := range probeContentTypes {
		if l.Supports(ct) {
			out = append(out, ct)
		}
	}
	return out
}
```

- [ ] **Step 6: Run, then commit**

Run: `go test ./retriever/ ./engine/ -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'` then `go build ./...`
Expected: PASS; build clean.

```bash
git add component.go engine/components.go engine/components_test.go retriever/describe.go retriever/describe_test.go chunker/describe.go loader/describe.go embedder/describe.go vectorstore/memory/describe.go vectorstore/pgvector/describe.go vectorstore/fabriq/describe.go
git commit --only -m "feat(engine): report which loader, chunker, embedder, store and retriever are wired" -- component.go engine/components.go engine/components_test.go retriever/describe.go retriever/describe_test.go chunker/describe.go loader/describe.go embedder/describe.go vectorstore/memory/describe.go vectorstore/pgvector/describe.go vectorstore/fabriq/describe.go
git show --stat HEAD
```

---

### Task 11: Compare the configured ranking with the raw vector ranking

**Files:**
- Create: `engine/compare.go`
- Create: `engine/compare_test.go`

**Interfaces:**
- Consumes: `retrieveRaw`, `hydrate` (Task 7), `RetrieveParams.TenantFilter` (Task 8), `Components()` (Task 10).
- Produces: `engine.CompareParams{CollectionID id.CollectionID; Tenant *string; TopK int; MinScore float64}`, `engine.CompareHit{ScoredChunk; Rank int "rank"; VectorRank int "vector_rank"; VectorScore float64 "vector_score"}`, `engine.CompareResult{Hits []CompareHit "hits"; LeftOut []CompareHit "left_out"; Window int "window"; VectorMatches int "vector_matches"; BestVectorScore float64 "best_vector_score"; Reordered bool "reordered"; Score weave.ScoreKind "score"; RetrieverMillis float64 "retriever_ms"; VectorMillis float64 "vector_ms"}`, `(*Engine).RetrieveCompare(ctx, query string, p CompareParams) (*CompareResult, error)`.

- [ ] **Step 1: Write the failing tests**

`engine/compare_test.go`:

```go
package engine_test

import (
	"context"
	"testing"

	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/retriever"
)

// The three texts are chosen so the arithmetic is checkable by hand with the
// bag-of-words embedder: A and B are near-duplicates (cosine about 0.94),
// so MMR at lambda 0.3 takes A, then prefers C over B for diversity.
const (
	textA = "refund policy refund window thirty days"
	textB = "refund policy refund window thirty days please"
	textC = "shipping refund label return"
)

func TestRetrieveCompareShowsMMRMovement(t *testing.T) {
	e := newRig(t, func(r *testRig) engine.Option {
		return engine.WithRetriever(retriever.NewMMRRetriever(r.Vectors, r.Embed, 0.3))
	}).Engine
	ctx := context.Background()
	col := mustTestCollection(t, e, "compare")
	a := mustIngest(t, ctx, e, col.ID, "a", textA)
	b := mustIngest(t, ctx, e, col.ID, "b", textB)
	c := mustIngest(t, ctx, e, col.ID, "c", textC)

	res, err := e.RetrieveCompare(ctx, "refund policy window", engine.CompareParams{CollectionID: col.ID, TopK: 2})
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if !res.Reordered {
		t.Error("reordered: got false for an MMR retriever")
	}
	if len(res.Hits) != 2 {
		t.Fatalf("hits: got %d, want 2", len(res.Hits))
	}
	if res.Hits[0].Chunk.DocumentID.String() != a.String() || res.Hits[1].Chunk.DocumentID.String() != c.String() {
		t.Errorf("final order: got %s, %s; want a then c", res.Hits[0].Chunk.DocumentID, res.Hits[1].Chunk.DocumentID)
	}
	if res.Hits[1].Rank != 2 || res.Hits[1].VectorRank != 3 {
		t.Errorf("c: rank %d vector rank %d, want 2 and 3", res.Hits[1].Rank, res.Hits[1].VectorRank)
	}
	if len(res.LeftOut) != 1 || res.LeftOut[0].Chunk.DocumentID.String() != b.String() || res.LeftOut[0].VectorRank != 2 {
		t.Errorf("left out: got %+v, want b at vector rank 2", res.LeftOut)
	}
	if res.Window < 50 || res.VectorMatches != 3 {
		t.Errorf("window %d, vector matches %d", res.Window, res.VectorMatches)
	}
}

func TestRetrieveCompareWithoutRetriever(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	col := mustTestCollection(t, r.Engine, "plain")
	mustIngest(t, ctx, r.Engine, col.ID, "a", textA)
	mustIngest(t, ctx, r.Engine, col.ID, "c", textC)

	res, err := r.Engine.RetrieveCompare(ctx, "refund policy window", engine.CompareParams{CollectionID: col.ID, TopK: 1})
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if res.Reordered || len(res.LeftOut) != 0 {
		t.Errorf("plain vector search: reordered %v, left out %d; want neither", res.Reordered, len(res.LeftOut))
	}
	if len(res.Hits) != 1 || res.Hits[0].Rank != 1 || res.Hits[0].VectorRank != 1 {
		t.Errorf("hits: %+v", res.Hits)
	}
}

func TestRetrieveCompareExplainsAnEmptyResult(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	col := mustTestCollection(t, r.Engine, "strict")
	mustIngest(t, ctx, r.Engine, col.ID, "c", textC)

	res, err := r.Engine.RetrieveCompare(ctx, "refund policy window", engine.CompareParams{CollectionID: col.ID, TopK: 5, MinScore: 0.99})
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(res.Hits) != 0 {
		t.Fatalf("hits: got %d, want none above 0.99", len(res.Hits))
	}
	if res.VectorMatches != 1 || res.BestVectorScore <= 0 || res.BestVectorScore >= 0.99 {
		t.Errorf("explanation: vector matches %d, best %.3f; want 1 match below the minimum", res.VectorMatches, res.BestVectorScore)
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./engine/ -run TestRetrieveCompare 2>&1 | tail -5`
Expected: compile error, `undefined: engine.CompareParams`.

- [ ] **Step 3: Implement**

`engine/compare.go`:

```go
package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/weave"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/retriever"
	"github.com/xraph/weave/vectorstore"
)

// CompareParams configures RetrieveCompare.
type CompareParams struct {
	// CollectionID restricts both searches. Zero means every collection.
	CollectionID id.CollectionID
	// Tenant restricts both searches exactly; nil means every tenant.
	Tenant *string
	// TopK is how many final hits to return. Zero or less uses the config
	// default.
	TopK int
	// MinScore applies to the final hits only. The raw search ignores it, so
	// the result can say what it removed.
	MinScore float64
}

// CompareHit is a hit with its place in both rankings. VectorRank is 1-based;
// 0 means the chunk was not in the raw window at all.
type CompareHit struct {
	ScoredChunk
	Rank        int     `json:"rank"`
	VectorRank  int     `json:"vector_rank"`
	VectorScore float64 `json:"vector_score"`
}

// CompareResult is the configured ranking beside the raw vector ranking.
type CompareResult struct {
	Hits []CompareHit `json:"hits"`
	// LeftOut are raw-window hits the configured retriever did not return, in
	// vector order, at most TopK of them. Empty when nothing reorders.
	LeftOut []CompareHit `json:"left_out"`
	// Window is how many raw hits were asked for.
	Window int `json:"window"`
	// VectorMatches is how many raw hits came back, before MinScore.
	VectorMatches int `json:"vector_matches"`
	// BestVectorScore is the top raw score, or 0 with no matches.
	BestVectorScore float64 `json:"best_vector_score"`
	// Reordered is false when the final ranking is the raw ranking: no
	// retriever, or a plain similarity retriever.
	Reordered bool `json:"reordered"`
	// Score is what Hits[i].Score means.
	Score           weave.ScoreKind `json:"score"`
	RetrieverMillis float64         `json:"retriever_ms"`
	VectorMillis    float64         `json:"vector_ms"`
}

// RetrieveCompare runs the configured retriever and a raw vector search over
// a wider window, and reports where each final hit sat in the raw ranking.
// With no retriever configured it embeds the query once and derives both
// sides from the same search.
func (e *Engine) RetrieveCompare(ctx context.Context, query string, p CompareParams) (*CompareResult, error) {
	if e.embedder == nil || e.vectorStore == nil {
		return nil, fmt.Errorf("weave: compare needs an embedder and a vector store")
	}
	topK := p.TopK
	if topK <= 0 {
		topK = e.config.DefaultTopK
	}
	window := max(3*topK, 50)
	comps := e.Components()
	res := &CompareResult{Window: window, Score: comps.Score}

	// Raw side.
	vecStart := time.Now()
	embedded, err := e.embedder.Embed(ctx, []string{query})
	if err != nil {
		return nil, fmt.Errorf("weave: embed query: %w", err)
	}
	if len(embedded) == 0 {
		return nil, fmt.Errorf("weave: embed query: no vector returned")
	}
	// The same scope rules as Retrieve, including the context tenant when no
	// explicit filter is given.
	scope := &RetrieveParams{CollectionID: p.CollectionID.String(), TenantID: weave.TenantFromContext(ctx), TenantFilter: p.Tenant}
	filter, tenantKey := searchScope(scope)
	raw, err := e.vectorStore.Search(ctx, embedded[0].Vector, &vectorstore.SearchOptions{TopK: window, Filter: filter, TenantKey: tenantKey})
	if err != nil {
		return nil, fmt.Errorf("weave: raw vector search: %w", err)
	}
	res.VectorMillis = float64(time.Since(vecStart).Microseconds()) / 1000
	res.VectorMatches = len(raw)
	if len(raw) > 0 {
		res.BestVectorScore = raw[0].Score
	}
	rawRank := make(map[string]int, len(raw))
	rawScore := make(map[string]float64, len(raw))
	for i, sr := range raw {
		rawRank[sr.ID] = i + 1
		rawScore[sr.ID] = sr.Score
	}

	// Final side.
	var final []ScoredChunk
	if e.retriever == nil {
		for _, sr := range raw {
			if p.MinScore > 0 && sr.Score < p.MinScore {
				continue
			}
			final = append(final, ScoredChunk{Chunk: retriever.ChunkFromSearchResult(sr), Score: sr.Score})
			if len(final) == topK {
				break
			}
		}
		res.RetrieverMillis = res.VectorMillis
	} else {
		params := &RetrieveParams{CollectionID: p.CollectionID.String(), TopK: topK, MinScore: p.MinScore, TenantFilter: p.Tenant}
		retStart := time.Now()
		final, err = e.retrieveRaw(ctx, query, params)
		if err != nil {
			return nil, err
		}
		res.RetrieverMillis = float64(time.Since(retStart).Microseconds()) / 1000
	}

	inFinal := make(map[string]bool, len(final))
	for i, h := range final {
		key := h.Chunk.ID.String()
		inFinal[key] = true
		ch := CompareHit{ScoredChunk: h, Rank: i + 1, VectorRank: rawRank[key], VectorScore: rawScore[key]}
		if ch.VectorRank != ch.Rank {
			res.Reordered = true
		}
		res.Hits = append(res.Hits, ch)
	}
	if e.retriever != nil && comps.Retriever.Kind != "similarity" {
		res.Reordered = true
	}

	if res.Reordered {
		for i, sr := range raw {
			if inFinal[sr.ID] || len(res.LeftOut) == topK {
				continue
			}
			res.LeftOut = append(res.LeftOut, CompareHit{
				ScoredChunk: ScoredChunk{Chunk: retriever.ChunkFromSearchResult(sr), Score: sr.Score},
				VectorRank:  i + 1, VectorScore: sr.Score,
			})
		}
	}

	if err := e.hydrateCompare(ctx, res.Hits); err != nil {
		return nil, err
	}
	if err := e.hydrateCompare(ctx, res.LeftOut); err != nil {
		return nil, err
	}
	return res, nil
}

func (e *Engine) hydrateCompare(ctx context.Context, hits []CompareHit) error {
	plain := make([]ScoredChunk, len(hits))
	for i := range hits {
		plain[i] = hits[i].ScoredChunk
	}
	plain, err := e.hydrate(ctx, plain)
	if err != nil {
		return err
	}
	for i := range hits {
		hits[i].ScoredChunk = plain[i]
	}
	return nil
}
```

`RetrieveCompare` emits no retrieval hooks. It is an operator's diagnostic, not application traffic, and counting it would inflate the `weave.retrieval.*` metrics every dashboard visit.

`Reordered` is true for every retriever other than plain similarity, even when this particular query happened to come out in raw order. The page uses it to decide whether "Left out" means anything, and an MMR or rerank retriever can leave strong matches out whenever it wants to.

- [ ] **Step 4: Run, then commit**

Run: `go test ./engine/ -run TestRetrieveCompare -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: three PASS. If the MMR test picks B over C, the hash embedder collided two words into one dimension: raise `hashEmbedder{dims: 256}` in `newRig` to 1024 rather than change the texts, and note it in the commit body.

```bash
git add engine/compare.go engine/compare_test.go
git commit --only -m "feat(engine): compare the configured ranking with the raw vector ranking" -- engine/compare.go engine/compare_test.go
git show --stat HEAD
```

---

### Task 12: Assemble a ranking with a chosen budget

**Files:**
- Create: `engine/assemble.go`
- Create: `engine/assemble_test.go`

**Interfaces:**
- Produces: `engine.AssembleParams{MaxTokens int}`, `engine.AssembledContext{Context string "context"; TotalTokens int "total_tokens"; MaxTokens int "max_tokens"; Included []int "included"; FirstExcluded int "first_excluded"; TokenCounter string "token_counter"}`, `(*Engine).Assemble(ctx, hits []ScoredChunk, p AssembleParams) (*AssembledContext, error)`.
- Produces: `engine.ChunkRef{ChunkID id.ChunkID "chunk_id"; Score float64 "score"}` and `(*Engine).AssembleRefs(ctx, refs []ChunkRef, p AssembleParams) (*AssembledContext, []ScoredChunk, error)`, which reads each chunk by ID and assembles without embedding again.

- [ ] **Step 1: Write the failing tests**

`engine/assemble_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/xraph/weave"
	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
)

func hit(content string, score float64) engine.ScoredChunk {
	return engine.ScoredChunk{Chunk: &chunk.Chunk{Content: content}, Score: score}
}

// The assembler skips a chunk that does not fit and keeps going, so a later,
// smaller chunk can still get in. The result must say exactly which ones did.
func TestAssembleSkipsAndContinues(t *testing.T) {
	e := newTestEngine(t)
	hits := []engine.ScoredChunk{
		hit(strings.Repeat("a", 20), 0.9), // 5 tokens
		hit(strings.Repeat("b", 40), 0.8), // 10 tokens: does not fit after the first
		hit(strings.Repeat("c", 16), 0.7), // 4 tokens: fits
	}
	got, err := e.Assemble(context.Background(), hits, engine.AssembleParams{MaxTokens: 10})
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	if !slices.Equal(got.Included, []int{0, 2}) || got.FirstExcluded != 1 {
		t.Errorf("included %v first excluded %d, want [0 2] and 1", got.Included, got.FirstExcluded)
	}
	if got.TotalTokens != 9 || got.MaxTokens != 10 || got.TokenCounter != "chars/4" {
		t.Errorf("totals: %+v", got)
	}
	if !strings.Contains(got.Context, "[1] aaaa") || !strings.Contains(got.Context, "[2] cccc") || strings.Contains(got.Context, "bbbb") {
		t.Errorf("context: %q", got.Context)
	}

	all, err := e.Assemble(context.Background(), hits, engine.AssembleParams{})
	if err != nil {
		t.Fatalf("assemble default budget: %v", err)
	}
	if all.FirstExcluded != -1 || all.MaxTokens != 4096 {
		t.Errorf("default budget: first excluded %d, max %d", all.FirstExcluded, all.MaxTokens)
	}
}

func TestAssembleRefsReadsChunksBack(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	col := mustTestCollection(t, r.Engine, "refs")
	mustIngest(t, ctx, r.Engine, col.ID, "refunds", "refunds are issued within thirty days")
	chunks, err := r.Engine.ListChunks(ctx, &chunk.ListFilter{CollectionID: col.ID})
	if err != nil || len(chunks) != 1 {
		t.Fatalf("list chunks: %v (%d)", err, len(chunks))
	}

	got, hits, err := r.Engine.AssembleRefs(ctx, []engine.ChunkRef{{ChunkID: chunks[0].ID, Score: 0.8}}, engine.AssembleParams{MaxTokens: 100})
	if err != nil {
		t.Fatalf("assemble refs: %v", err)
	}
	if !strings.Contains(got.Context, "refunds are issued") || len(hits) != 1 || hits[0].Score != 0.8 || !hits[0].Hydrated {
		t.Errorf("assemble refs: %q, %+v", got.Context, hits)
	}

	_, _, err = r.Engine.AssembleRefs(ctx, []engine.ChunkRef{{ChunkID: id.NewChunkID()}}, engine.AssembleParams{})
	if !errors.Is(err, weave.ErrChunkNotFound) {
		t.Errorf("missing chunk: got %v, want ErrChunkNotFound", err)
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./engine/ -run 'TestAssemble' 2>&1 | tail -5`
Expected: compile error, `undefined: engine.AssembleParams`.

- [ ] **Step 3: Implement**

`engine/assemble.go`:

```go
package engine

import (
	"context"
	"fmt"

	"github.com/xraph/weave/assembler"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/retriever"
)

// defaultMaxTokens matches assembler.New's own default.
const defaultMaxTokens = 4096

// AssembleParams configures Assemble.
type AssembleParams struct {
	// MaxTokens is the token budget. Zero or less uses 4096.
	MaxTokens int
}

// AssembledContext is what Weave's default assembler builds from a ranking.
// It is not necessarily what an application sends: an app may assemble its
// own way.
type AssembledContext struct {
	Context     string `json:"context"`
	TotalTokens int    `json:"total_tokens"`
	MaxTokens   int    `json:"max_tokens"`
	// Included lists the 0-based positions of the hits that made it in, in
	// order. Marker [n] in Context is hit Included[n-1].
	Included []int `json:"included"`
	// FirstExcluded is the position where the budget first ran out, or -1
	// when everything fit. Hits after it may still be included.
	FirstExcluded int `json:"first_excluded"`
	// TokenCounter names how tokens were estimated.
	TokenCounter string `json:"token_counter"`
}

// Assemble runs the default assembler over hits.
func (e *Engine) Assemble(ctx context.Context, hits []ScoredChunk, p AssembleParams) (*AssembledContext, error) {
	maxTokens := p.MaxTokens
	if maxTokens <= 0 {
		maxTokens = defaultMaxTokens
	}
	results := make([]retriever.Result, len(hits))
	for i, h := range hits {
		results[i] = retriever.Result{Chunk: h.Chunk, Score: h.Score}
	}
	out, err := assembler.New(assembler.WithMaxTokens(maxTokens)).Assemble(ctx, results)
	if err != nil {
		return nil, fmt.Errorf("weave: assemble: %w", err)
	}

	ac := &AssembledContext{
		Context:       out.Context,
		TotalTokens:   out.TotalTokens,
		MaxTokens:     maxTokens,
		Included:      make([]int, 0, len(out.Citations)),
		FirstExcluded: -1,
		TokenCounter:  "chars/4",
	}
	in := make(map[int]bool, len(out.Citations))
	for _, c := range out.Citations {
		ac.Included = append(ac.Included, c.ChunkIndex)
		in[c.ChunkIndex] = true
	}
	for i := range hits {
		if !in[i] {
			ac.FirstExcluded = i
			break
		}
	}
	return ac, nil
}

// ChunkRef names a chunk and the score it had in some earlier ranking.
type ChunkRef struct {
	ChunkID id.ChunkID `json:"chunk_id"`
	Score   float64    `json:"score"`
}

// AssembleRefs reads each chunk back by ID and assembles them in the given
// order, without embedding anything. A missing chunk is an error: the ranking
// it came from is stale.
func (e *Engine) AssembleRefs(ctx context.Context, refs []ChunkRef, p AssembleParams) (*AssembledContext, []ScoredChunk, error) {
	hits := make([]ScoredChunk, len(refs))
	for i, ref := range refs {
		ch, err := e.GetChunk(ctx, ref.ChunkID)
		if err != nil {
			return nil, nil, fmt.Errorf("weave: assemble chunk %s: %w", ref.ChunkID, err)
		}
		hits[i] = ScoredChunk{Chunk: ch, Score: ref.Score, Hydrated: true}
	}
	ac, err := e.Assemble(ctx, hits, p)
	if err != nil {
		return nil, nil, err
	}
	return ac, hits, nil
}
```

- [ ] **Step 4: Run, then commit**

Run: `go test ./engine/ -run TestAssemble -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: PASS.

```bash
git add engine/assemble.go engine/assemble_test.go
git commit --only -m "feat(engine): assemble a ranking with a chosen budget and say which hits made it in" -- engine/assemble.go engine/assemble_test.go
git show --stat HEAD
```

---

### Task 13: Describe extensions and their hooks

**Files:**
- Create: `engine/extensions.go`
- Create: `engine/extensions_test.go`

**Interfaces:**
- Produces: `engine.ExtensionInfo{Name string "name"; Hooks []string "hooks"}` and `(*Engine).DescribeExtensions() []ExtensionInfo`. Hook names are snake_case, in lifecycle order: `collection_created`, `collection_deleted`, `ingest_started`, `ingest_chunked`, `ingest_embedded`, `ingest_completed`, `ingest_failed`, `retrieval_started`, `retrieval_completed`, `retrieval_failed`, `document_deleted`, `reindex_started`, `reindex_completed`, `shutdown`.

- [ ] **Step 1: Write the failing test**

`engine/extensions_test.go`:

```go
package engine_test

import (
	"context"
	"slices"
	"testing"

	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/engine"
)

type auditExt struct{}

func (auditExt) Name() string { return "audit" }
func (auditExt) OnCollectionCreated(context.Context, *collection.Collection) error {
	return nil
}
func (auditExt) OnShutdown(context.Context) error { return nil }

type quietExt struct{}

func (quietExt) Name() string { return "quiet" }

func TestDescribeExtensions(t *testing.T) {
	e := newTestEngine(t, engine.WithExtension(auditExt{}), engine.WithExtension(quietExt{}))
	got := e.DescribeExtensions()
	if len(got) != 2 {
		t.Fatalf("got %d extensions, want 2", len(got))
	}
	if got[0].Name != "audit" || !slices.Equal(got[0].Hooks, []string{"collection_created", "shutdown"}) {
		t.Errorf("audit: %+v", got[0])
	}
	if got[1].Name != "quiet" || got[1].Hooks == nil || len(got[1].Hooks) != 0 {
		t.Errorf("quiet: %+v (hooks must be an empty list, not null)", got[1])
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./engine/ -run TestDescribeExtensions 2>&1 | tail -5`
Expected: compile error, `e.DescribeExtensions undefined`.

- [ ] **Step 3: Implement**

`engine/extensions.go`:

```go
package engine

import "github.com/xraph/weave/plugins"

// ExtensionInfo names a registered extension and the lifecycle hooks it
// implements. Extensions expose only a name, so hooks are found by type
// assertion against each hook interface.
type ExtensionInfo struct {
	Name  string   `json:"name"`
	Hooks []string `json:"hooks"`
}

// DescribeExtensions lists registered extensions in registration order.
func (e *Engine) DescribeExtensions() []ExtensionInfo {
	if e.extensions == nil {
		return []ExtensionInfo{}
	}
	exts := e.extensions.Extensions()
	out := make([]ExtensionInfo, 0, len(exts))
	for _, x := range exts {
		out = append(out, ExtensionInfo{Name: x.Name(), Hooks: hooksOf(x)})
	}
	return out
}

func hooksOf(x plugins.Extension) []string {
	hooks := []string{}
	add := func(ok bool, name string) {
		if ok {
			hooks = append(hooks, name)
		}
	}
	_, ok := x.(plugins.CollectionCreated)
	add(ok, "collection_created")
	_, ok = x.(plugins.CollectionDeleted)
	add(ok, "collection_deleted")
	_, ok = x.(plugins.IngestStarted)
	add(ok, "ingest_started")
	_, ok = x.(plugins.IngestChunked)
	add(ok, "ingest_chunked")
	_, ok = x.(plugins.IngestEmbedded)
	add(ok, "ingest_embedded")
	_, ok = x.(plugins.IngestCompleted)
	add(ok, "ingest_completed")
	_, ok = x.(plugins.IngestFailed)
	add(ok, "ingest_failed")
	_, ok = x.(plugins.RetrievalStarted)
	add(ok, "retrieval_started")
	_, ok = x.(plugins.RetrievalCompleted)
	add(ok, "retrieval_completed")
	_, ok = x.(plugins.RetrievalFailed)
	add(ok, "retrieval_failed")
	_, ok = x.(plugins.DocumentDeleted)
	add(ok, "document_deleted")
	_, ok = x.(plugins.ReindexStarted)
	add(ok, "reindex_started")
	_, ok = x.(plugins.ReindexCompleted)
	add(ok, "reindex_completed")
	_, ok = x.(plugins.Shutdown)
	add(ok, "shutdown")
	return hooks
}
```

`engine.WithExtension` takes an `ext.Extension`; `ext` and `plugins` are duplicate packages with the same one-method interface, so the fake satisfies both.

- [ ] **Step 4: Run, then commit**

Run: `go test ./engine/ -run TestDescribeExtensions -v 2>&1 | grep -E '^(--- |\s+\S+\.go:\d+:|ok|FAIL)'`
Expected: PASS.

```bash
git add engine/extensions.go engine/extensions_test.go
git commit --only -m "feat(engine): list each extension with the hooks it implements" -- engine/extensions.go engine/extensions_test.go
git show --stat HEAD
```

---

### Task 14: Gate the slice and hand it to slice 2

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md` in the forge-dashboard repo (append "What slice 1 found that slice 2 must know")

- [ ] **Step 1: Whole-module gate, all backends live**

With the Setup variables exported:

```bash
cd /Users/rexraphael/Work/xraph/forgery/weave && go build ./... && go vet ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
```

Expected: no output past the build (every package `ok` or without tests). Then confirm the database backends ran rather than skipped:

```bash
go test ./store/... -run TestConformance -v 2>&1 | grep -cE -- '--- SKIP'
```

Expected: `0`.

- [ ] **Step 2: Lint with a fresh cache**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
```

Expected: `0 issues.` Fix anything reported in the file that introduced it and commit that fix with the same `--only` discipline.

- [ ] **Step 3: Tidy and check the module graph**

```bash
go mod tidy && git diff --stat go.mod go.sum
```

Expected: `github.com/jackc/pgx/v5` moved from indirect to direct. If tidy changed anything, commit it:

```bash
git commit --only -m "chore: record pgx as a direct dependency of the store tests" -- go.mod go.sum
```

- [ ] **Step 4: Record what slice 2 must know**

Invoke the `rex-voice` skill, draft, then run the draft through `humanizer` in embedded mode. Append to the spec, under a new heading `## What slice 1 found that slice 2 must know`, these facts with their real values:

- the exact JSON shapes of `CompareResult`, `CompareHit`, `ScoredChunk`, `AssembledContext`, `Components`, `Component`, `ComponentInfo`, `ExtensionInfo` (copy the struct tags, not a summary);
- that `Reordered` is true for every non-similarity retriever, even when one query happens to come out in raw order;
- that assembly can include hits after `FirstExcluded`, so the page dims per row from `Included`, and the budget line sits above row `FirstExcluded`;
- the commit hashes of Tasks 1 to 13;
- anything a task found that this plan did not predict (for example a SQLite time layout, or an embedder dimension change).

No em dashes. Commit only the spec:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git commit --only -m "docs: record what weave slice 1 found" -- docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md && git show --stat HEAD
```

- [ ] **Step 5: Stop the containers**

```bash
docker rm -f weave-slice1-pg weave-slice1-mongo
```
