# Dispatch slice 1: engine reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Dispatch on forge v1.12.0 and grove v1.7.0, make worker rows tell the truth, and give every long list (jobs, workflow runs, dead letters, artifacts) a newest-first, filtered, cursor-paged read on all five store backends, so the contract in slice 3 has honest data to serve.

**Architecture:** Dispatch IDs are UUIDv7 TypeIDs with a monotonic counter, so "newest first" is `id DESC` on every backend and a page cursor is simply the last ID returned. Each domain package gains a small `list.go` with its options, page type, an optional capability interface and a shared in-Go `Match` predicate. A new `store/storetest` list suite pins the semantics, the memory store is the reference implementation, and each backend implements and runs the same suite. Redis, which keeps its IDs in unordered sets, gains one sorted-set index per entity scored by the ID's millisecond timestamp, backfilled once, and reports `Complete: false` when a filtered scan stops at its budget. The last task folds the capabilities into the aggregate `store.Store`.

**Tech Stack:** Go 1.26, grove ORM (pgdriver, sqlitedriver, mongodriver), grove kv (redisdriver), testcontainers for postgres, mongo and redis, robfig/cron (untouched here).

**Spec:** `docs/superpowers/specs/2026-10-07-dispatch-dashboard-migration-design.md` (forge-dashboard, commit a18ccc2). This plan covers the spec's "Step 0", engine fix 1 (worker liveness) and engine fix 2 (the list layer). Slice 2 covers fixes 3 to 7, slice 3 the contract.

**Refinements of the spec, decided while planning:** lists order and page by ID rather than by `(created_at, id)`, because Dispatch IDs are UUIDv7 TypeIDs minted with a monotonic counter (verified in `gofrs/uuid` v5.5.1 and pinned by `TestIDsMintedInOrderSortInOrder`). The paged reads get new names (`ListRunsPage`, `ListDLQPage`, `CountDLQEntries`, `ListArtifactsPage`) so the existing `ListRuns`, `ListDLQ` and `CountDLQ` keep their callers. Every task below was implemented and gated in a scratch clone before it was written down, and Tasks 0 to 7 were then replayed in order onto one clone and gated together (build, `go test ./...`, `-race` on engine, worker and cron, integration suites on all five backends, lint: all green).

## Global Constraints

- Repo: `/Users/rexraphael/Work/xraph/forgery/dispatch`, branch `main`, the shared checkout. No worktrees, no branches.
- Commit only your own paths: `git add <new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.
- Commit messages: conventional prefix, Rex's voice, no em dashes anywhere, no `Co-Authored-By` or any Claude or Anthropic attribution.
- Pins after Task 0: `github.com/xraph/forge v1.12.0`; `github.com/xraph/grove`, `grove/drivers/{pgdriver,sqlitedriver,mongodriver}`, `grove/kv`, `grove/kv/drivers/redisdriver` all `v1.7.0`.
- Never import the root `github.com/xraph/forge/extensions/dashboard` package outside a `_test.go` file.
- Ordering contract for every new list: newest first by ID (`id DESC`), cursor is the ID of the last row on the previous page, a row is on the next page exactly when its ID sorts strictly below the cursor.
- `Limit <= 0` means `paging.DefaultLimit` (50). Stores do not cap; the contract (slice 3) caps at 200.
- Every string filter is exact match except `NamePrefix`, which is a case-sensitive literal prefix (`%` and `_` are ordinary characters). An empty filter value means "no filter", including empty scope, which means every tenant.
- Gate before every commit that touches Go: `go build ./... && go test ./...`; for store work also `go test -tags integration ./store/<backend>/...`; lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C`.
- Integration tests need Docker. Testcontainers pick random ports; never bind 5432, 6379 or 27017 yourself. Run container tests with `-count=1`: if Docker blips, mongo's tests skip silently and `go test` caches the skip as `ok`. If tests fail at 0.00s with `rootless Docker not found`, wait until `docker info` answers and rerun.
- golangci-lint refuses to start while another session lints on this machine, so every lint command carries `--allow-parallel-runners`. Under `--build-tags integration` it reports one pre-existing issue, a govet shadow at `store/redis/store_test.go:54`; leave it, it is not this plan's.

## Review Focus

1. **A cursor pointing at a row that has since been deleted.** Keyset paging must carry on from where that row was, not restart or fail. Pinned by `JobsCursorSurvivesDeletedRow` in Task 1, run by every backend.
2. **A cursor from the wrong list or plain garbage** (a run ID passed to `ListJobs`, `"abc"`). It must fail with `paging.ErrInvalidCursor`, never silently start from the top. Pinned by `JobsInvalidCursor` and `RunsInvalidCursor` in Task 1.
3. **Names containing SQL wildcards or differing only by case.** `NamePrefix: "a_b"` must not match `axb` or `A_b`. Pinned by `JobsNamePrefixIsLiteralAndCaseSensitive` in Task 1; the SQL tasks escape `LIKE` or avoid it.
4. **Redis data written before this release, or by an instance still on it during a rolling deploy.** The new sorted-set index lacks those rows; a list must backfill whenever the ID set holds more members than the index, not just once. Pinned by `TestListJobs_backfillsIndexForPreexistingRows` and `TestListJobs_picksUpRowsWrittenByThePreviousRelease` in Task 5b.
5. **A worker row removed by another instance's sweep while the worker is alive.** The heartbeat must notice `ErrWorkerNotFound` and register the row again. Pinned by `TestEngine_WorkerHeartbeatReregistersDeletedRow` in Task 6b.

## File Structure

Created:

| Path | Responsibility |
|---|---|
| `paging/paging.go` | `DefaultLimit`, `Limit`, `ErrInvalidCursor`, `Cursor` (validate a cursor against an ID prefix) |
| `paging/paging_test.go` | Unit tests for the above |
| `job/list.go` | `ListJobsOpts`, `Page`, `Lister`, `ListJobsOpts.Match` |
| `workflow/list.go` | `ListRunsPageOpts`, `RunPage`, `CountRunsOpts`, `PageLister`, matchers |
| `dlq/list.go` | `PageOpts`, `Page`, `CountOpts`, `PageLister`, matchers |
| `artifact/list.go` | `PageOpts`, `Page`, `PageLister`, `PageOpts.Match` |
| `store/storetest/list.go` | `ListStore`, `RunListSuite` and its cases |
| `store/storetest/cluster.go` | `RunClusterSuite` (worker heartbeat, capacity, `GetWorker`) |
| `store/memory/list.go` | Memory implementation of the four list capabilities |
| `store/memory/list_test.go` | Runs `RunListSuite` on memory |
| `store/{postgres,sqlite,mongo,redis}/list.go` | Each backend's implementation |
| `store/{postgres,sqlite,mongo,redis}/list_test.go` | Runs `RunListSuite` on that backend |
| `store/redis/listindex.go` | The redis created-order indexes, their maintenance and one-time backfill |
| `engine/heartbeat.go` | The worker row heartbeat loop |
| `engine/heartbeat_test.go` | Its tests |
| `store/redis/export_test.go` | Test-only hook for the redis list scan budget |
| `store/{postgres,sqlite}/migrations.go` (modified) | `worker_capacity_column` (Task 6a) and `list_order_indexes` (Task 8) appended last |
| `store/mongo/store.go` (modified) | List-order compound indexes in `migrationIndexes()` (Task 8) |

Modified: `go.mod`, `go.sum`, `Makefile`, every `dashboard/**/*.go` (build tag only), `id/id.go` (`Time`), `cluster/store.go` (`GetWorker`), every `cluster.Store` implementation, the postgres, sqlite and mongo worker models and migrations, the redis job, run, DLQ and artifact write paths, `engine/engine.go`, `store/store.go`.

---

### Task 0: Move to forge v1.12.0 and grove v1.7.0, and take templ out of the build

The templ dashboard imports `forge/extensions/dashboard/contributor`, which forge v1.12.0 removed. The pages stay on disk as the reference for `MIGRATION.md` (slice 6) but leave the build now.

**Files:**
- Modify: every `*.go` file under `dashboard/` (prepend a build constraint)
- Modify: `go.mod`, `go.sum`
- Modify: `Makefile` (drop the `templ` step from `all`)
- Modify: `exec/shim/store_test.go` (allow `golang.org/x/term`)

**Interfaces:**
- Consumes: nothing.
- Produces: a module on forge v1.12.0 and grove v1.7.0 with no templ or forgeui requirement.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain && git log -1 --oneline`
Expected: no lines from `git status` touching `go.mod`, `go.sum`, `Makefile` or `dashboard/`. If another session has uncommitted edits in any of them, stop and report.

- [ ] **Step 2: Exclude the templ package from the build**

```bash
cd /Users/rexraphael/Work/xraph/forgery/dispatch
for f in $(find dashboard -name '*.go'); do
  printf '//go:build ignore\n\n' | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
head -3 dashboard/contributor.go
```

Expected first lines of `dashboard/contributor.go`:

```go
//go:build ignore

package dashboard
```

(These files carry no other session's work; a scripted edit is safe here, unlike `fixture-server/server.mjs` in the other repo.)

- [ ] **Step 3: Stop `make all` regenerating templ output**

In `Makefile`, the `all` target reads `all: templ check test build` (line 234). Change it to:

```make
all: check test build
```

Leave the `templ` and `templ-watch` targets in place until slice 6 deletes the directory.

- [ ] **Step 4: Bump the modules**

```bash
go get github.com/xraph/forge@v1.12.0 \
  github.com/xraph/grove@v1.7.0 \
  github.com/xraph/grove/drivers/mongodriver@v1.7.0 \
  github.com/xraph/grove/drivers/pgdriver@v1.7.0 \
  github.com/xraph/grove/drivers/sqlitedriver@v1.7.0 \
  github.com/xraph/grove/kv@v1.7.0 \
  github.com/xraph/grove/kv/drivers/redisdriver@v1.7.0
go mod tidy
grep -E 'xraph/(forge|grove)|a-h/templ|forgeui' go.mod
```

Expected: `forge v1.12.0`, six grove lines at `v1.7.0`, and no `a-h/templ` or `forgeui` line.

- [ ] **Step 5: Run the tests and see the shim allowlist trip**

Run: `go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'`
Expected: one failure, in `exec/shim`:

```
--- FAIL: TestShimLinksNoInfrastructure
    store_test.go:363: exec/shim links "golang.org/x/term", which is outside the sandbox's allowed closure (shimAllowedModules)
```

This was checked on 2026-10-07. forge v1.12.0 brings `github.com/xraph/go-utils` v1.3.0, whose `log` package now imports `golang.org/x/term` to detect a terminal. `go list -deps -f '{{.ImportPath}} {{join .Imports " "}}' ./exec/shim | grep golang.org/x/term` shows `github.com/xraph/go-utils/log` as the only importer. It is a terminal library, not an infrastructure client, which is the thing the allowlist exists to keep out.

- [ ] **Step 6: Allow x/term in the shim's closure, with the reason**

In `exec/shim/store_test.go`, inside `shimAllowedModules`, add this entry directly after the `"golang.org/x/sys"` line:

```go
	// go-utils v1.3.0's log package reads whether stderr is a terminal,
	// which brought x/term in with the forge v1.12.0 bump rather than with
	// any change here. Like x/sys above, it is terminal and syscall
	// plumbing, not a client for anything outside the process.
	"golang.org/x/term", // go-utils/log's terminal detection
```

Then run `gofmt -w exec/shim/store_test.go`. It realigns the trailing comments: the `x/sys` line's comment moves in and the new `x/term` line joins the aligned block below it. Leave that as gofmt writes it.

- [ ] **Step 7: Gate**

Run: `go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'; C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C`
Expected: build succeeds, no FAIL lines, `0 issues.`

- [ ] **Step 8: Commit**

```bash
git commit --only -m "build: move to forge v1.12.0 and grove v1.7.0 and take templ out of the build

Forge v1.12.0 removed the contributor package the templ dashboard is built
on, and it is the release whose transport carries meta.invalidates, which
the React dashboard needs so a write refreshes the page. The templ pages
stay on disk behind a build tag until the migration record is written,
then go in their own commit.

Grove v1.7.0 resolves hook-rewritten keys on every kv operation. The
shim allowlist gains golang.org/x/term, which go-utils' logger now uses
to detect a terminal." -- go.mod go.sum Makefile exec/shim/store_test.go $(find dashboard -name '*.go')
git show --stat HEAD | tail -3
```

Note for whoever merges xraph/dispatch#33 later: that PR also moves grove to v1.7.0, so `go.mod` will conflict on the same lines with the same values. Take either side and run `go mod tidy`.

---

### Task 1: List types, the conformance suite, and the memory reference

**Files:**
- Create: `paging/paging.go`, `paging/paging_test.go`
- Modify: `id/id.go` (add `Time`), test in `id/id_test.go`
- Create: `job/list.go`, `workflow/list.go`, `dlq/list.go`, `artifact/list.go`
- Create: `store/storetest/list.go`
- Create: `store/memory/list.go`, `store/memory/list_test.go`

**Interfaces:**
- Consumes: `id.ParseWithPrefix(s string, expected id.Prefix) (id.ID, error)`; the existing store types.
- Produces (every later task relies on these exact names):

```go
package paging
const DefaultLimit = 50
var ErrInvalidCursor error
func Limit(n int) int
func Cursor(raw string, prefix id.Prefix) (id.ID, error)

package id
func (i ID) Time() time.Time

package job
type ListJobsOpts struct { States []State; Queue, NamePrefix, ScopeAppID, ScopeOrgID, Cursor string; Limit int }
type Page struct { Jobs []*Job; NextCursor string; Complete bool }
type Lister interface { ListJobs(ctx context.Context, opts ListJobsOpts) (Page, error) }
func (o ListJobsOpts) Match(j *Job) bool

package workflow
type ListRunsPageOpts struct { State RunState; NamePrefix, ScopeAppID, ScopeOrgID, Cursor string; Limit int }
type RunPage struct { Runs []*Run; NextCursor string; Complete bool }
type CountRunsOpts struct { State RunState; Name string }
type PageLister interface {
	ListRunsPage(ctx context.Context, opts ListRunsPageOpts) (RunPage, error)
	CountRuns(ctx context.Context, opts CountRunsOpts) (int64, error)
}
func (o ListRunsPageOpts) Match(r *Run) bool
func (o CountRunsOpts) Match(r *Run) bool

package dlq
type PageOpts struct { Queue, NamePrefix, ScopeAppID, ScopeOrgID string; Replayed *bool; Cursor string; Limit int }
type Page struct { Entries []*Entry; NextCursor string; Complete bool }
type CountOpts struct { Queue string; Replayed *bool; FailedBefore time.Time }
type PageLister interface {
	ListDLQPage(ctx context.Context, opts PageOpts) (Page, error)
	CountDLQEntries(ctx context.Context, opts CountOpts) (int64, error)
}
func (o PageOpts) Match(e *Entry) bool
func (o CountOpts) Match(e *Entry) bool

package artifact
type PageOpts struct { Lifecycle Lifecycle; ScopeAppID, ScopeOrgID string; IncludeDeleted bool; Cursor string; Limit int }
type Page struct { Artifacts []*Artifact; NextCursor string; Complete bool }
type PageLister interface { ListArtifactsPage(ctx context.Context, opts PageOpts) (Page, error) }
func (o PageOpts) Match(a *Artifact) bool

package storetest
type ListStore interface { job.Store; job.Lister; workflow.Store; workflow.PageLister; dlq.Store; dlq.PageLister; artifact.Store; artifact.PageLister }
func RunListSuite(t *testing.T, newStore func(t *testing.T) ListStore)
```

- [ ] **Step 1: Write the failing tests for `paging` and `id.Time`**

Create `paging/paging_test.go`:

```go
package paging_test

import (
	"errors"
	"testing"

	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/paging"
)

func TestLimit(t *testing.T) {
	for in, want := range map[int]int{-3: paging.DefaultLimit, 0: paging.DefaultLimit, 1: 1, 500: 500} {
		if got := paging.Limit(in); got != want {
			t.Errorf("Limit(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestCursor(t *testing.T) {
	jobID := id.NewJobID()

	got, err := paging.Cursor("", id.PrefixJob)
	if err != nil || !got.IsNil() {
		t.Fatalf("empty cursor = (%v, %v), want (nil ID, nil)", got, err)
	}

	got, err = paging.Cursor(jobID.String(), id.PrefixJob)
	if err != nil || got.String() != jobID.String() {
		t.Fatalf("job cursor = (%v, %v), want (%s, nil)", got, err, jobID)
	}

	for _, raw := range []string{"abc", id.NewRunID().String()} {
		if _, err := paging.Cursor(raw, id.PrefixJob); !errors.Is(err, paging.ErrInvalidCursor) {
			t.Errorf("Cursor(%q, job) error = %v, want ErrInvalidCursor", raw, err)
		}
	}
}
```

Append to the existing `id/id_test.go` (package `id_test`), and add `"time"` to its import block:

```go
func TestIDTime(t *testing.T) {
	before := time.Now().UTC().Truncate(time.Millisecond)
	got := id.NewJobID().Time()
	after := time.Now().UTC()

	if got.Before(before) || got.After(after) {
		t.Fatalf("Time() = %v, want between %v and %v", got, before, after)
	}
	if !id.Nil.Time().IsZero() {
		t.Fatalf("Nil.Time() = %v, want zero", id.Nil.Time())
	}
}

func TestIDsMintedInOrderSortInOrder(t *testing.T) {
	prev := id.NewJobID().String()
	for range 5000 {
		next := id.NewJobID().String()
		if next <= prev {
			t.Fatalf("id %s minted after %s sorts at or below it", next, prev)
		}
		prev = next
	}
}
```

The second test is the property the whole plan rests on: IDs minted one after another in one process sort in minting order, including within a millisecond.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./paging/ ./id/`
Expected: FAIL to compile: `package github.com/xraph/dispatch/paging is not in std` and `id.NewJobID().Time undefined`.

- [ ] **Step 3: Implement `paging` and `id.Time`**

Create `paging/paging.go`:

```go
// Package paging holds what every cursor-paged store list shares.
//
// Dispatch IDs are UUIDv7 TypeIDs minted with a monotonic counter, so a
// row's ID sorts by when it was created. Every paged list orders by ID,
// newest first, and its cursor is the ID of the last row a page returned:
// the next page is every matching row whose ID sorts strictly below it.
// A cursor is therefore stable across inserts and deletes, and a deleted
// cursor row still marks its place.
package paging

import (
	"errors"
	"fmt"

	"github.com/xraph/dispatch/id"
)

// DefaultLimit is the page size when a caller passes zero or less.
const DefaultLimit = 50

// ErrInvalidCursor is returned when a cursor is not an ID of the kind the
// list pages by. Stores never fall back to the first page on a bad cursor:
// a client that sent one would otherwise see page one again and believe
// it had reached the end.
var ErrInvalidCursor = errors.New("dispatch: invalid page cursor")

// Limit returns n, or DefaultLimit when n is zero or negative.
func Limit(n int) int {
	if n <= 0 {
		return DefaultLimit
	}

	return n
}

// Cursor validates raw as an ID with the given prefix. An empty raw is the
// first page and returns the nil ID.
func Cursor(raw string, prefix id.Prefix) (id.ID, error) {
	if raw == "" {
		return id.Nil, nil
	}

	parsed, err := id.ParseWithPrefix(raw, prefix)
	if err != nil {
		return id.Nil, fmt.Errorf("%w: %w", ErrInvalidCursor, err)
	}

	return parsed, nil
}
```

Add to `id/id.go`, after `IsNil` (around line 238), and add `"time"` to its imports:

```go
// Time returns the creation instant carried in the ID's UUIDv7 timestamp,
// at millisecond precision. The nil ID returns the zero time.
//
// Stores that keep IDs in an unordered structure (redis sets) use it to
// score an ordered index, which is why it lives here and not in a store.
func (i ID) Time() time.Time {
	if !i.valid {
		return time.Time{}
	}

	b := i.inner.Bytes()
	if len(b) < 6 {
		return time.Time{}
	}

	ms := int64(b[0])<<40 | int64(b[1])<<32 | int64(b[2])<<24 |
		int64(b[3])<<16 | int64(b[4])<<8 | int64(b[5])

	return time.UnixMilli(ms).UTC()
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `go test ./paging/ ./id/`
Expected: `ok` for both.

- [ ] **Step 5: Add the four `list.go` files**

Create `job/list.go`:

```go
package job

import (
	"context"
	"slices"
	"strings"
)

// ListJobsOpts filters and pages ListJobs.
//
// Every string filter is an exact match except NamePrefix, which is a
// case-sensitive literal prefix. An empty value means "no filter": an
// empty States lists every state, and an empty ScopeAppID lists every
// app. The second is pinned by the conformance suite because it is the
// dangerous one: the dashboard is operator-wide on purpose, and a caller
// that meant to scope must pass the scope.
type ListJobsOpts struct {
	States     []State
	Queue      string
	NamePrefix string
	ScopeAppID string
	ScopeOrgID string

	// Cursor is the ID of the last job on the previous page. Empty is the
	// first page. See package paging for the ordering contract.
	Cursor string

	// Limit is the page size; zero or less means paging.DefaultLimit.
	Limit int
}

// Page is one page of ListJobs, newest first.
type Page struct {
	Jobs []*Job

	// NextCursor is the cursor for the following page, or empty when there
	// is none. It is always set when Complete is false.
	NextCursor string

	// Complete is false when a backend stopped scanning at its budget
	// before it could fill the page or prove there was nothing left. The
	// page is then not evidence that no more rows match: continue from
	// NextCursor. Backends that filter at their index always report true.
	Complete bool
}

// Lister is the paged, filtered job read the dashboard uses. It is a
// separate interface from Store so backends could gain it one at a time;
// store.Store embeds it once all five have.
type Lister interface {
	ListJobs(ctx context.Context, opts ListJobsOpts) (Page, error)
}

// Match reports whether j passes every filter in o. The cursor and limit
// are not filters and are ignored. Backends that filter in Go share this
// so the predicate cannot drift between them.
func (o ListJobsOpts) Match(j *Job) bool {
	if len(o.States) > 0 && !slices.Contains(o.States, j.State) {
		return false
	}
	if o.Queue != "" && j.Queue != o.Queue {
		return false
	}
	if o.NamePrefix != "" && !strings.HasPrefix(j.Name, o.NamePrefix) {
		return false
	}
	if o.ScopeAppID != "" && j.ScopeAppID != o.ScopeAppID {
		return false
	}
	if o.ScopeOrgID != "" && j.ScopeOrgID != o.ScopeOrgID {
		return false
	}

	return true
}
```

Create `workflow/list.go`:

```go
package workflow

import (
	"context"
	"strings"
)

// ListRunsPageOpts filters and pages ListRunsPage. The rules are the same
// as job.ListJobsOpts: exact matches except NamePrefix, empty means no
// filter, newest first by ID.
type ListRunsPageOpts struct {
	State      RunState
	NamePrefix string
	ScopeAppID string
	ScopeOrgID string
	Cursor     string
	Limit      int
}

// RunPage is one page of ListRunsPage. NextCursor and Complete mean what
// they mean on job.Page.
type RunPage struct {
	Runs       []*Run
	NextCursor string
	Complete   bool
}

// CountRunsOpts filters CountRuns. Name is an exact workflow name; empty
// State or Name counts every value.
type CountRunsOpts struct {
	State RunState
	Name  string
}

// PageLister is the paged run read and the run count the dashboard uses.
// ListRuns is kept, unchanged, for the engine's own callers.
type PageLister interface {
	ListRunsPage(ctx context.Context, opts ListRunsPageOpts) (RunPage, error)
	CountRuns(ctx context.Context, opts CountRunsOpts) (int64, error)
}

// Match reports whether r passes every filter in o.
func (o ListRunsPageOpts) Match(r *Run) bool {
	if o.State != "" && r.State != o.State {
		return false
	}
	if o.NamePrefix != "" && !strings.HasPrefix(r.Name, o.NamePrefix) {
		return false
	}
	if o.ScopeAppID != "" && r.ScopeAppID != o.ScopeAppID {
		return false
	}
	if o.ScopeOrgID != "" && r.ScopeOrgID != o.ScopeOrgID {
		return false
	}

	return true
}

// Match reports whether r is counted under o.
func (o CountRunsOpts) Match(r *Run) bool {
	if o.State != "" && r.State != o.State {
		return false
	}
	if o.Name != "" && r.Name != o.Name {
		return false
	}

	return true
}
```

Create `dlq/list.go`:

```go
package dlq

import (
	"context"
	"strings"
	"time"
)

// PageOpts filters and pages ListDLQPage, newest first by ID. NamePrefix
// matches the entry's JobName. Replayed nil lists both; a pointer to false
// lists only entries nobody has replayed yet, which is the dashboard's
// default view.
type PageOpts struct {
	Queue      string
	NamePrefix string
	ScopeAppID string
	ScopeOrgID string
	Replayed   *bool
	Cursor     string
	Limit      int
}

// Page is one page of ListDLQPage. NextCursor and Complete mean what they
// mean on job.Page.
type Page struct {
	Entries    []*Entry
	NextCursor string
	Complete   bool
}

// CountOpts filters CountDLQEntries. A zero FailedBefore counts every
// entry; a set one counts entries whose FailedAt is strictly before it,
// the same boundary PurgeDLQ deletes on, so a purge confirmation can show
// exactly how many rows will go.
type CountOpts struct {
	Queue        string
	Replayed     *bool
	FailedBefore time.Time
}

// PageLister is the paged DLQ read and the filtered count the dashboard
// uses. ListDLQ and CountDLQ are kept, unchanged, for existing callers.
type PageLister interface {
	ListDLQPage(ctx context.Context, opts PageOpts) (Page, error)
	CountDLQEntries(ctx context.Context, opts CountOpts) (int64, error)
}

// Match reports whether e passes every filter in o.
func (o PageOpts) Match(e *Entry) bool {
	if o.Queue != "" && e.Queue != o.Queue {
		return false
	}
	if o.NamePrefix != "" && !strings.HasPrefix(e.JobName, o.NamePrefix) {
		return false
	}
	if o.ScopeAppID != "" && e.ScopeAppID != o.ScopeAppID {
		return false
	}
	if o.ScopeOrgID != "" && e.ScopeOrgID != o.ScopeOrgID {
		return false
	}
	if o.Replayed != nil && *o.Replayed != (e.ReplayedAt != nil) {
		return false
	}

	return true
}

// Match reports whether e is counted under o.
func (o CountOpts) Match(e *Entry) bool {
	if o.Queue != "" && e.Queue != o.Queue {
		return false
	}
	if o.Replayed != nil && *o.Replayed != (e.ReplayedAt != nil) {
		return false
	}
	if !o.FailedBefore.IsZero() && !e.FailedAt.Before(o.FailedBefore) {
		return false
	}

	return true
}
```

Create `artifact/list.go`:

```go
package artifact

import "context"

// PageOpts filters and pages ListArtifactsPage, newest first by ID. The
// filters mean what they mean on ListOpts; only the paging differs.
type PageOpts struct {
	Lifecycle      Lifecycle
	ScopeAppID     string
	ScopeOrgID     string
	IncludeDeleted bool
	Cursor         string
	Limit          int
}

// Page is one page of ListArtifactsPage. NextCursor and Complete mean what
// they mean on job.Page.
type Page struct {
	Artifacts  []*Artifact
	NextCursor string
	Complete   bool
}

// PageLister is the cursor-paged artifact read. ListArtifacts is kept for
// existing callers.
type PageLister interface {
	ListArtifactsPage(ctx context.Context, opts PageOpts) (Page, error)
}

// Match reports whether a passes every filter in o.
func (o PageOpts) Match(a *Artifact) bool {
	if a.DeletedAt != nil && !o.IncludeDeleted {
		return false
	}
	if o.Lifecycle != "" && a.Lifecycle != o.Lifecycle {
		return false
	}
	if o.ScopeAppID != "" && a.ScopeAppID != o.ScopeAppID {
		return false
	}
	if o.ScopeOrgID != "" && a.ScopeOrgID != o.ScopeOrgID {
		return false
	}

	return true
}
```

Run: `go build ./...`
Expected: success.

- [ ] **Step 6: Write the conformance suite**

Create `store/storetest/list.go`:

```go
package storetest

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/paging"
	"github.com/xraph/dispatch/workflow"
)

// ListStore is what the list suite requires: the four stores whose lists
// grow without bound, each with its paged capability.
type ListStore interface {
	job.Store
	job.Lister
	workflow.Store
	workflow.PageLister
	dlq.Store
	dlq.PageLister
	artifact.Store
	artifact.PageLister
}

// RunListSuite pins the paged list contract: newest first by ID, a cursor
// that is the last ID returned, filters that are exact except a literal
// case-sensitive name prefix, and an empty scope that means every tenant.
//
// newStore may return a shared store, so each case isolates itself with a
// queue, name prefix or scope nobody else uses, and asserts on the
// identity of what comes back, never on a total.
func RunListSuite(t *testing.T, newStore func(t *testing.T) ListStore) {
	t.Helper()

	cases := []struct {
		name string
		fn   func(t *testing.T, s ListStore)
	}{
		{"JobsNewestFirstAcrossStates", testJobsNewestFirstAcrossStates},
		{"JobsFilterByStates", testJobsFilterByStates},
		{"JobsCursorPagesJoin", testJobsCursorPagesJoin},
		{"JobsCursorSurvivesDeletedRow", testJobsCursorSurvivesDeletedRow},
		{"JobsInvalidCursor", testJobsInvalidCursor},
		{"JobsNamePrefixIsLiteralAndCaseSensitive", testJobsNamePrefixIsLiteralAndCaseSensitive},
		{"JobsScopeFilterAndEmptyMeansAll", testJobsScopeFilterAndEmptyMeansAll},
		{"RunsNewestFirstFiltersAndCounts", testRunsNewestFirstFiltersAndCounts},
		{"RunsCursorPagesJoin", testRunsCursorPagesJoin},
		{"RunsInvalidCursor", testRunsInvalidCursor},
		{"DLQNewestFirstAndReplayedFilter", testDLQNewestFirstAndReplayedFilter},
		{"DLQCountFilters", testDLQCountFilters},
		{"DLQCursorNameAndScope", testDLQCursorNameAndScope},
		{"ArtifactsNewestFirstAndFilters", testArtifactsNewestFirstAndFilters},
		{"ArtifactsCursorPagesJoin", testArtifactsCursorPagesJoin},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { c.fn(t, newStore(t)) })
	}
}

// uniq returns a label no other case or run will use.
func uniq(kind string) string { return kind + "-" + id.NewJobID().String() }

func listJob(name, queue string, state job.State) *job.Job {
	j := PendingJob(name, queue, 0)
	j.State = state

	return j
}

func enqueueAll(t *testing.T, s ListStore, jobs ...*job.Job) {
	t.Helper()

	for _, j := range jobs {
		if err := s.EnqueueJob(context.Background(), j); err != nil {
			t.Fatalf("enqueue %s: %v", j.Name, err)
		}
	}
}

func jobIDs(jobs []*job.Job) []string {
	out := make([]string, len(jobs))
	for i, j := range jobs {
		out[i] = j.ID.String()
	}

	return out
}

// newestFirst returns the IDs of jobs in reverse creation order, which is
// the order every list must return them in.
func newestFirst(jobs ...*job.Job) []string {
	ids := jobIDs(jobs)
	slices.Reverse(ids)

	return ids
}

func assertIDs(t *testing.T, what string, got, want []string) {
	t.Helper()

	if !slices.Equal(got, want) {
		t.Fatalf("%s:\n got  %v\n want %v", what, got, want)
	}
}

func testJobsNewestFirstAcrossStates(t *testing.T, s ListStore) {
	q := uniq("q")
	jobs := make([]*job.Job, 0, 6)
	for _, st := range []job.State{
		job.StatePending, job.StateRunning, job.StateCompleted,
		job.StateFailed, job.StateRetrying, job.StateCancelled,
	} {
		jobs = append(jobs, listJob("all-"+string(st), q, st))
	}
	enqueueAll(t, s, jobs...)

	page, err := s.ListJobs(context.Background(), job.ListJobsOpts{Queue: q})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	assertIDs(t, "every state, newest first", jobIDs(page.Jobs), newestFirst(jobs...))
	if !page.Complete || page.NextCursor != "" {
		t.Fatalf("page = complete %v, next %q; want complete with no next cursor", page.Complete, page.NextCursor)
	}
}

func testJobsFilterByStates(t *testing.T, s ListStore) {
	q := uniq("q")
	pending := listJob("p", q, job.StatePending)
	failed := listJob("f", q, job.StateFailed)
	retrying := listJob("r", q, job.StateRetrying)
	enqueueAll(t, s, pending, failed, retrying)

	page, err := s.ListJobs(context.Background(), job.ListJobsOpts{
		Queue:  q,
		States: []job.State{job.StateFailed, job.StateRetrying},
	})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	assertIDs(t, "failed and retrying only", jobIDs(page.Jobs), newestFirst(failed, retrying))
}

func testJobsCursorPagesJoin(t *testing.T, s ListStore) {
	q := uniq("q")
	jobs := make([]*job.Job, 0, 7)
	for i := range 7 {
		jobs = append(jobs, listJob(fmt.Sprintf("page-%d", i), q, job.StatePending))
	}
	enqueueAll(t, s, jobs...)

	var got []string
	cursor := ""
	for pageNo := 1; ; pageNo++ {
		page, err := s.ListJobs(context.Background(), job.ListJobsOpts{Queue: q, Cursor: cursor, Limit: 3})
		if err != nil {
			t.Fatalf("page %d: %v", pageNo, err)
		}
		if len(page.Jobs) > 3 {
			t.Fatalf("page %d returned %d jobs with limit 3", pageNo, len(page.Jobs))
		}
		got = append(got, jobIDs(page.Jobs)...)
		if page.NextCursor == "" {
			break
		}
		if pageNo > 5 {
			t.Fatal("more than 5 pages for 7 jobs at limit 3: the cursor is not advancing")
		}
		cursor = page.NextCursor
	}
	assertIDs(t, "pages joined", got, newestFirst(jobs...))
}

func testJobsCursorSurvivesDeletedRow(t *testing.T, s ListStore) {
	q := uniq("q")
	a := listJob("a", q, job.StatePending)
	b := listJob("b", q, job.StatePending)
	c := listJob("c", q, job.StatePending)
	d := listJob("d", q, job.StatePending)
	enqueueAll(t, s, a, b, c, d)

	ctx := context.Background()
	first, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q, Limit: 2})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	assertIDs(t, "first page", jobIDs(first.Jobs), newestFirst(c, d))

	// The cursor row is c. Delete it, then ask for what comes after it.
	if delErr := s.DeleteJob(ctx, c.ID); delErr != nil {
		t.Fatalf("delete cursor row: %v", delErr)
	}

	next, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q, Cursor: first.NextCursor, Limit: 2})
	if err != nil {
		t.Fatalf("next page after deleted cursor row: %v", err)
	}
	assertIDs(t, "next page", jobIDs(next.Jobs), newestFirst(a, b))
}

func testJobsInvalidCursor(t *testing.T, s ListStore) {
	for _, cursor := range []string{"not-an-id", id.NewRunID().String()} {
		_, err := s.ListJobs(context.Background(), job.ListJobsOpts{Cursor: cursor})
		if !errors.Is(err, paging.ErrInvalidCursor) {
			t.Errorf("ListJobs(cursor %q) error = %v, want paging.ErrInvalidCursor", cursor, err)
		}
	}
}

func testJobsNamePrefixIsLiteralAndCaseSensitive(t *testing.T, s ListStore) {
	q := uniq("q")
	underscore := listJob("a_b-1", q, job.StatePending)
	wildcardHit := listJob("axb-1", q, job.StatePending)
	upper := listJob("A_b-2", q, job.StatePending)
	percent := listJob("a%c", q, job.StatePending)
	enqueueAll(t, s, underscore, wildcardHit, upper, percent)

	ctx := context.Background()
	page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q, NamePrefix: "a_b"})
	if err != nil {
		t.Fatalf("ListJobs a_b: %v", err)
	}
	assertIDs(t, `prefix "a_b"`, jobIDs(page.Jobs), []string{underscore.ID.String()})

	page, err = s.ListJobs(ctx, job.ListJobsOpts{Queue: q, NamePrefix: "a%"})
	if err != nil {
		t.Fatalf("ListJobs a%%: %v", err)
	}
	assertIDs(t, `prefix "a%"`, jobIDs(page.Jobs), []string{percent.ID.String()})
}

func testJobsScopeFilterAndEmptyMeansAll(t *testing.T, s ListStore) {
	q := uniq("q")
	appOne, appTwo := uniq("app"), uniq("app")
	orgOne, orgTwo := uniq("org"), uniq("org")

	first := listJob("scoped-1", q, job.StatePending)
	first.ScopeAppID, first.ScopeOrgID = appOne, orgOne
	second := listJob("scoped-2", q, job.StatePending)
	second.ScopeAppID, second.ScopeOrgID = appTwo, orgTwo
	unscoped := listJob("unscoped", q, job.StatePending)
	enqueueAll(t, s, first, second, unscoped)

	ctx := context.Background()
	for _, tc := range []struct {
		what string
		opts job.ListJobsOpts
		want []string
	}{
		{"app one", job.ListJobsOpts{Queue: q, ScopeAppID: appOne}, []string{first.ID.String()}},
		{"org two", job.ListJobsOpts{Queue: q, ScopeOrgID: orgTwo}, []string{second.ID.String()}},
		{"app one in org two", job.ListJobsOpts{Queue: q, ScopeAppID: appOne, ScopeOrgID: orgTwo}, []string{}},
		// Pinned on purpose: an empty scope is "every tenant", not "none".
		{"empty scope", job.ListJobsOpts{Queue: q}, newestFirst(first, second, unscoped)},
	} {
		page, err := s.ListJobs(ctx, tc.opts)
		if err != nil {
			t.Fatalf("%s: %v", tc.what, err)
		}
		assertIDs(t, tc.what, jobIDs(page.Jobs), tc.want)
	}
}

func listRun(name string, state workflow.RunState) *workflow.Run {
	return &workflow.Run{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewRunID(),
		Name:      name,
		State:     state,
		StartedAt: time.Now().UTC(),
	}
}

func createRuns(t *testing.T, s ListStore, runs ...*workflow.Run) {
	t.Helper()

	for _, r := range runs {
		if err := s.CreateRun(context.Background(), r); err != nil {
			t.Fatalf("create run %s: %v", r.Name, err)
		}
	}
}

func runIDs(runs []*workflow.Run) []string {
	out := make([]string, len(runs))
	for i, r := range runs {
		out[i] = r.ID.String()
	}

	return out
}

func runsNewestFirst(runs ...*workflow.Run) []string {
	ids := runIDs(runs)
	slices.Reverse(ids)

	return ids
}

func testRunsNewestFirstFiltersAndCounts(t *testing.T, s ListStore) {
	prefix := uniq("wf")
	a := listRun(prefix+"-a", workflow.RunStateRunning)
	b := listRun(prefix+"-b", workflow.RunStateCompleted)
	c := listRun(prefix+"-b", workflow.RunStateFailed)
	d := listRun(prefix+"-c", workflow.RunStateCompleted)
	d.ScopeAppID = uniq("app")
	createRuns(t, s, a, b, c, d)

	ctx := context.Background()
	page, err := s.ListRunsPage(ctx, workflow.ListRunsPageOpts{NamePrefix: prefix})
	if err != nil {
		t.Fatalf("ListRunsPage: %v", err)
	}
	assertIDs(t, "runs newest first", runIDs(page.Runs), runsNewestFirst(a, b, c, d))

	page, err = s.ListRunsPage(ctx, workflow.ListRunsPageOpts{NamePrefix: prefix, State: workflow.RunStateCompleted})
	if err != nil {
		t.Fatalf("ListRunsPage completed: %v", err)
	}
	assertIDs(t, "completed runs", runIDs(page.Runs), runsNewestFirst(b, d))

	page, err = s.ListRunsPage(ctx, workflow.ListRunsPageOpts{NamePrefix: prefix, ScopeAppID: d.ScopeAppID})
	if err != nil {
		t.Fatalf("ListRunsPage scoped: %v", err)
	}
	assertIDs(t, "scoped runs", runIDs(page.Runs), []string{d.ID.String()})

	for _, tc := range []struct {
		opts workflow.CountRunsOpts
		want int64
	}{
		{workflow.CountRunsOpts{Name: prefix + "-b"}, 2},
		{workflow.CountRunsOpts{Name: prefix + "-b", State: workflow.RunStateFailed}, 1},
		{workflow.CountRunsOpts{Name: prefix + "-z"}, 0},
	} {
		n, err := s.CountRuns(ctx, tc.opts)
		if err != nil {
			t.Fatalf("CountRuns %+v: %v", tc.opts, err)
		}
		if n != tc.want {
			t.Errorf("CountRuns %+v = %d, want %d", tc.opts, n, tc.want)
		}
	}
}

func testRunsCursorPagesJoin(t *testing.T, s ListStore) {
	prefix := uniq("wf")
	runs := make([]*workflow.Run, 0, 5)
	for i := range 5 {
		runs = append(runs, listRun(fmt.Sprintf("%s-%d", prefix, i), workflow.RunStateCompleted))
	}
	createRuns(t, s, runs...)

	var got []string
	cursor := ""
	for pageNo := 1; ; pageNo++ {
		page, err := s.ListRunsPage(context.Background(), workflow.ListRunsPageOpts{NamePrefix: prefix, Cursor: cursor, Limit: 2})
		if err != nil {
			t.Fatalf("page %d: %v", pageNo, err)
		}
		got = append(got, runIDs(page.Runs)...)
		if page.NextCursor == "" {
			break
		}
		if pageNo > 4 {
			t.Fatal("cursor is not advancing")
		}
		cursor = page.NextCursor
	}
	assertIDs(t, "run pages joined", got, runsNewestFirst(runs...))
}

func testRunsInvalidCursor(t *testing.T, s ListStore) {
	_, err := s.ListRunsPage(context.Background(), workflow.ListRunsPageOpts{Cursor: id.NewJobID().String()})
	if !errors.Is(err, paging.ErrInvalidCursor) {
		t.Fatalf("ListRunsPage(job cursor) error = %v, want paging.ErrInvalidCursor", err)
	}
}

func listEntry(jobName, queue string, failedAt time.Time) *dlq.Entry {
	return &dlq.Entry{
		ID:         id.NewDLQID(),
		JobID:      id.NewJobID(),
		JobName:    jobName,
		Queue:      queue,
		Payload:    []byte(`{}`),
		Error:      "boom",
		MaxRetries: 3,
		FailedAt:   failedAt,
		CreatedAt:  failedAt,
	}
}

func pushAll(t *testing.T, s ListStore, entries ...*dlq.Entry) {
	t.Helper()

	for _, e := range entries {
		if err := s.PushDLQ(context.Background(), e); err != nil {
			t.Fatalf("push %s: %v", e.JobName, err)
		}
	}
}

func entryIDs(entries []*dlq.Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.ID.String()
	}

	return out
}

func entriesNewestFirst(entries ...*dlq.Entry) []string {
	ids := entryIDs(entries)
	slices.Reverse(ids)

	return ids
}

func testDLQNewestFirstAndReplayedFilter(t *testing.T, s ListStore) {
	q := uniq("q")
	now := time.Now().UTC().Truncate(time.Millisecond)
	a := listEntry("a", q, now.Add(-2*time.Hour))
	b := listEntry("b", q, now.Add(-time.Hour))
	c := listEntry("c", q, now)
	pushAll(t, s, a, b, c)

	ctx := context.Background()
	if err := s.ReplayDLQ(ctx, b.ID); err != nil {
		t.Fatalf("replay b: %v", err)
	}

	yes, no := true, false
	for _, tc := range []struct {
		what     string
		replayed *bool
		want     []string
	}{
		{"both", nil, entriesNewestFirst(a, b, c)},
		{"unreplayed", &no, entriesNewestFirst(a, c)},
		{"replayed", &yes, []string{b.ID.String()}},
	} {
		page, err := s.ListDLQPage(ctx, dlq.PageOpts{Queue: q, Replayed: tc.replayed})
		if err != nil {
			t.Fatalf("%s: %v", tc.what, err)
		}
		assertIDs(t, tc.what, entryIDs(page.Entries), tc.want)
	}
}

func testDLQCountFilters(t *testing.T, s ListStore) {
	q := uniq("q")
	now := time.Now().UTC().Truncate(time.Millisecond)
	old := listEntry("old", q, now.Add(-48*time.Hour))
	mid := listEntry("mid", q, now.Add(-24*time.Hour))
	fresh := listEntry("fresh", q, now)
	pushAll(t, s, old, mid, fresh)

	ctx := context.Background()
	if err := s.ReplayDLQ(ctx, mid.ID); err != nil {
		t.Fatalf("replay mid: %v", err)
	}

	no := false
	for _, tc := range []struct {
		what string
		opts dlq.CountOpts
		want int64
	}{
		{"queue", dlq.CountOpts{Queue: q}, 3},
		{"unreplayed", dlq.CountOpts{Queue: q, Replayed: &no}, 2},
		// Strictly before, the boundary PurgeDLQ uses: mid itself is not counted.
		{"failed before mid", dlq.CountOpts{Queue: q, FailedBefore: mid.FailedAt}, 1},
		{"failed before now", dlq.CountOpts{Queue: q, FailedBefore: now.Add(time.Second)}, 3},
	} {
		n, err := s.CountDLQEntries(ctx, tc.opts)
		if err != nil {
			t.Fatalf("%s: %v", tc.what, err)
		}
		if n != tc.want {
			t.Errorf("CountDLQEntries %s = %d, want %d", tc.what, n, tc.want)
		}
	}
}

func testDLQCursorNameAndScope(t *testing.T, s ListStore) {
	q := uniq("q")
	now := time.Now().UTC().Truncate(time.Millisecond)
	entries := make([]*dlq.Entry, 0, 6)
	for i := range 5 {
		entries = append(entries, listEntry(fmt.Sprintf("render-%d", i), q, now))
	}
	other := listEntry("email-0", q, now)
	other.ScopeAppID = uniq("app")
	pushAll(t, s, append(entries, other)...)

	ctx := context.Background()
	var got []string
	cursor := ""
	for pageNo := 1; ; pageNo++ {
		page, err := s.ListDLQPage(ctx, dlq.PageOpts{Queue: q, NamePrefix: "render-", Cursor: cursor, Limit: 2})
		if err != nil {
			t.Fatalf("page %d: %v", pageNo, err)
		}
		got = append(got, entryIDs(page.Entries)...)
		if page.NextCursor == "" {
			break
		}
		if pageNo > 4 {
			t.Fatal("cursor is not advancing")
		}
		cursor = page.NextCursor
	}
	assertIDs(t, "render entries paged", got, entriesNewestFirst(entries...))

	page, err := s.ListDLQPage(ctx, dlq.PageOpts{Queue: q, ScopeAppID: other.ScopeAppID})
	if err != nil {
		t.Fatalf("scoped: %v", err)
	}
	assertIDs(t, "scoped entry", entryIDs(page.Entries), []string{other.ID.String()})

	if _, err := s.ListDLQPage(ctx, dlq.PageOpts{Cursor: id.NewJobID().String()}); !errors.Is(err, paging.ErrInvalidCursor) {
		t.Fatalf("ListDLQPage(job cursor) error = %v, want paging.ErrInvalidCursor", err)
	}
}

func listArtifact(app string, lifecycle artifact.Lifecycle) *artifact.Artifact {
	artID := id.NewArtifactID()

	return &artifact.Artifact{
		ID:         artID,
		Backend:    "mem",
		Bucket:     "list-suite",
		Key:        artID.String(),
		Size:       42,
		Lifecycle:  lifecycle,
		ScopeAppID: app,
		CreatedAt:  time.Now().UTC().Truncate(time.Millisecond),
	}
}

func createArtifacts(t *testing.T, s ListStore, arts ...*artifact.Artifact) {
	t.Helper()

	for _, a := range arts {
		if err := s.CreateArtifact(context.Background(), a, nil); err != nil {
			t.Fatalf("create artifact %s: %v", a.ID, err)
		}
	}
}

func artifactIDs(arts []*artifact.Artifact) []string {
	out := make([]string, len(arts))
	for i, a := range arts {
		out[i] = a.ID.String()
	}

	return out
}

func artifactsNewestFirst(arts ...*artifact.Artifact) []string {
	ids := artifactIDs(arts)
	slices.Reverse(ids)

	return ids
}

func testArtifactsNewestFirstAndFilters(t *testing.T, s ListStore) {
	app := uniq("app")
	durable := listArtifact(app, artifact.Durable)
	ephemeral := listArtifact(app, artifact.Ephemeral)

	// Artifacts are only ever soft-deleted by the sweeper, and UpdateArtifact
	// deliberately preserves DeletedAt, so the suite deletes the way
	// production does: an unlinked ephemeral artifact old enough for
	// SweepOrphans. The two-hour age keeps every other case's artifacts,
	// all created just now, out of the sweep.
	swept := listArtifact(app, artifact.Ephemeral)
	swept.CreatedAt = swept.CreatedAt.Add(-2 * time.Hour)
	createArtifacts(t, s, durable, ephemeral, swept)

	ctx := context.Background()
	marked, err := s.SweepOrphans(ctx, time.Now().UTC().Add(-time.Hour), 0)
	if err != nil {
		t.Fatalf("SweepOrphans: %v", err)
	}
	if !slices.Contains(artifactIDs(marked), swept.ID.String()) {
		t.Fatalf("SweepOrphans did not mark %s; marked %v", swept.ID, artifactIDs(marked))
	}

	for _, tc := range []struct {
		what string
		opts artifact.PageOpts
		want []string
	}{
		{"live", artifact.PageOpts{ScopeAppID: app}, artifactsNewestFirst(durable, ephemeral)},
		{"with deleted", artifact.PageOpts{ScopeAppID: app, IncludeDeleted: true}, artifactsNewestFirst(durable, ephemeral, swept)},
		{"ephemeral", artifact.PageOpts{ScopeAppID: app, Lifecycle: artifact.Ephemeral}, []string{ephemeral.ID.String()}},
	} {
		page, err := s.ListArtifactsPage(ctx, tc.opts)
		if err != nil {
			t.Fatalf("%s: %v", tc.what, err)
		}
		assertIDs(t, tc.what, artifactIDs(page.Artifacts), tc.want)
	}
}

func testArtifactsCursorPagesJoin(t *testing.T, s ListStore) {
	app := uniq("app")
	arts := make([]*artifact.Artifact, 0, 5)
	for range 5 {
		arts = append(arts, listArtifact(app, artifact.Durable))
	}
	createArtifacts(t, s, arts...)

	var got []string
	cursor := ""
	for pageNo := 1; ; pageNo++ {
		page, err := s.ListArtifactsPage(context.Background(), artifact.PageOpts{ScopeAppID: app, Cursor: cursor, Limit: 2})
		if err != nil {
			t.Fatalf("page %d: %v", pageNo, err)
		}
		got = append(got, artifactIDs(page.Artifacts)...)
		if page.NextCursor == "" {
			break
		}
		if pageNo > 4 {
			t.Fatal("cursor is not advancing")
		}
		cursor = page.NextCursor
	}
	assertIDs(t, "artifact pages joined", got, artifactsNewestFirst(arts...))
}
```

- [ ] **Step 7: Run the suite against memory to see it fail**

Create `store/memory/list_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/store/storetest"
)

func TestListSuite(t *testing.T) {
	storetest.RunListSuite(t, func(_ *testing.T) storetest.ListStore {
		return memory.New()
	})
}
```

Run: `go test ./store/memory/ -run TestListSuite`
Expected: FAIL to compile: `*memory.Store does not implement storetest.ListStore (missing method CountDLQEntries)`.

- [ ] **Step 8: Implement the memory reference**

Create `store/memory/list.go`:

```go
package memory

import (
	"context"
	"sort"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/paging"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ job.Lister          = (*Store)(nil)
	_ workflow.PageLister = (*Store)(nil)
	_ dlq.PageLister      = (*Store)(nil)
	_ artifact.PageLister = (*Store)(nil)
)

// pageByID orders rows newest first by ID, drops every row at or above the
// cursor, and cuts the page. It is the reference the other backends are
// held to by the list suite.
func pageByID[T any](rows []T, idOf func(T) string, cursor id.ID, limit int) (page []T, next string) {
	sort.Slice(rows, func(i, k int) bool { return idOf(rows[i]) > idOf(rows[k]) })

	if !cursor.IsNil() {
		c := cursor.String()
		start := sort.Search(len(rows), func(i int) bool { return idOf(rows[i]) < c })
		rows = rows[start:]
	}

	limit = paging.Limit(limit)
	if len(rows) <= limit {
		return rows, ""
	}

	return rows[:limit], idOf(rows[limit-1])
}

// ListJobs returns jobs newest first by ID, filtered and paged.
func (m *Store) ListJobs(_ context.Context, opts job.ListJobsOpts) (job.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixJob)
	if err != nil {
		return job.Page{}, err
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	rows := make([]*job.Job, 0, len(m.jobs))
	for _, j := range m.jobs {
		if opts.Match(j) {
			rows = append(rows, cloneJob(j))
		}
	}

	rows, next := pageByID(rows, func(j *job.Job) string { return j.ID.String() }, cursor, opts.Limit)

	return job.Page{Jobs: rows, NextCursor: next, Complete: true}, nil
}

// ListRunsPage returns workflow runs newest first by ID, filtered and paged.
func (m *Store) ListRunsPage(_ context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixRun)
	if err != nil {
		return workflow.RunPage{}, err
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	rows := make([]*workflow.Run, 0, len(m.runs))
	for _, r := range m.runs {
		if opts.Match(r) {
			cp := *r
			rows = append(rows, &cp)
		}
	}

	rows, next := pageByID(rows, func(r *workflow.Run) string { return r.ID.String() }, cursor, opts.Limit)

	return workflow.RunPage{Runs: rows, NextCursor: next, Complete: true}, nil
}

// CountRuns counts workflow runs by state and exact name.
func (m *Store) CountRuns(_ context.Context, opts workflow.CountRunsOpts) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, r := range m.runs {
		if opts.Match(r) {
			n++
		}
	}

	return n, nil
}

// ListDLQPage returns dead letter entries newest first by ID, filtered and
// paged.
func (m *Store) ListDLQPage(_ context.Context, opts dlq.PageOpts) (dlq.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixDLQ)
	if err != nil {
		return dlq.Page{}, err
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	rows := make([]*dlq.Entry, 0, len(m.dlqs))
	for _, e := range m.dlqs {
		if opts.Match(e) {
			cp := *e
			rows = append(rows, &cp)
		}
	}

	rows, next := pageByID(rows, func(e *dlq.Entry) string { return e.ID.String() }, cursor, opts.Limit)

	return dlq.Page{Entries: rows, NextCursor: next, Complete: true}, nil
}

// CountDLQEntries counts dead letter entries under the given filters.
func (m *Store) CountDLQEntries(_ context.Context, opts dlq.CountOpts) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, e := range m.dlqs {
		if opts.Match(e) {
			n++
		}
	}

	return n, nil
}

// ListArtifactsPage returns artifacts newest first by ID, filtered and
// paged.
func (m *Store) ListArtifactsPage(_ context.Context, opts artifact.PageOpts) (artifact.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixArtifact)
	if err != nil {
		return artifact.Page{}, err
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	rows := make([]*artifact.Artifact, 0, len(m.artifacts))
	for _, a := range m.artifacts {
		if opts.Match(a) {
			rows = append(rows, a.Clone())
		}
	}

	rows, next := pageByID(rows, func(a *artifact.Artifact) string { return a.ID.String() }, cursor, opts.Limit)

	return artifact.Page{Artifacts: rows, NextCursor: next, Complete: true}, nil
}
```

The memory store's receiver is `m` in `store.go` and `s` in `artifact.go`. Both are `*Store`, so use `m` throughout this file as above; `go vet`'s receiver-name check is per method, but the repo's lint config may enforce consistency (`recvcheck`). If lint complains, rename `m` to `s` in this file only.

- [ ] **Step 9: Run the suite to see it pass**

Run: `go test -race ./store/memory/ -run TestListSuite -v 2>&1 | grep -E '^(=== RUN|--- |ok|FAIL)' | head -40`
Expected: every `--- PASS`, then `ok`.

- [ ] **Step 10: Gate and commit**

Run: `go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'; C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C`
Expected: no FAIL lines, `0 issues.`

```bash
git add paging/paging.go paging/paging_test.go job/list.go workflow/list.go dlq/list.go artifact/list.go store/storetest/list.go store/memory/list.go store/memory/list_test.go
git commit --only -m "feat(store): page every long list newest first by id

Jobs, workflow runs, dead letters and artifacts each gain a paged read
that filters by state, queue, name prefix and scope, orders newest first,
and hands back the id of the last row as the cursor for the next page.
Ids are UUIDv7 with a monotonic counter, so ordering by id is ordering by
creation, and a cursor keeps its place even when its row is deleted.

The memory store is the reference. store/storetest gains RunListSuite so
the other four backends are held to the same answers, including the one
that matters most for an operator console: an empty scope filter means
every tenant." -- paging/paging.go paging/paging_test.go id/id.go id/id_test.go job/list.go workflow/list.go dlq/list.go artifact/list.go store/storetest/list.go store/memory/list.go store/memory/list_test.go
git show --stat HEAD | tail -14
```

---

### Task 2: Postgres implements the paged lists

Postgres is the reference SQL backend, so it goes first. Every list is keyset paging on the primary key: `ORDER BY id DESC`, `id < cursor`, and one row past the limit to decide `NextCursor`. The primary key already covers that, so this task adds no migration (Task 6 appends one later and the migrations must apply in order). Name prefixes use `starts_with`, which never pattern-matches, so `%` and `_` stay literal with nothing to escape.

**Files:**
- Create: `store/postgres/list.go`
- Test: `store/postgres/list_test.go` (build tag `integration`, uses `setupTestStore` from `store/postgres/store_test.go`)

**Interfaces:**
- Consumes (Task 1): `paging.Cursor`, `paging.Limit`, `id.PrefixJob`, `id.PrefixRun`, `id.PrefixDLQ`, `id.PrefixArtifact`, `job.ListJobsOpts`, `job.Page`, `job.Lister`, `workflow.ListRunsPageOpts`, `workflow.RunPage`, `workflow.CountRunsOpts`, `workflow.PageLister`, `dlq.PageOpts`, `dlq.Page`, `dlq.CountOpts`, `dlq.PageLister`, `artifact.PageOpts`, `artifact.Page`, `artifact.PageLister`, `storetest.ListStore`, `storetest.RunListSuite`, `storetest.PendingJob`. Existing postgres helpers: `fromJobModel`, `fromRunModel`, `fromDLQModel`, `fromArtifactModels`, `errPrefix`, and the `jobModel`, `workflowRunModel`, `dlqEntryModel`, `artifactModel` types.
- Produces, on `*postgres.Store`:

```go
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error)
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error)
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error)
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error)
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error)
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error)
```

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain store/postgres && git log -1 --oneline`
Expected: no output from `git status` (neither `list.go` nor `list_test.go` exists yet), and the last commit is Task 1's. If another session has uncommitted edits under `store/postgres/`, stop and report.

- [ ] **Step 2: Write the failing tests**

Create `store/postgres/list_test.go`. The first test runs the shared suite on one container, the way `TestDequeueConformance` in `dequeue_test.go` does. The second pins Review Focus territory the suite cannot reach from Go: that `ORDER BY id DESC` under the server's default collation is Go's byte order.

```go
//go:build integration

package postgres_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/xraph/grove/drivers/pgdriver"

	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/storetest"
)

// TestListConformance runs the paged list suite against Postgres.
//
// One container serves every case, the way TestDequeueConformance shares
// one: the suite isolates each case by a queue, name prefix or scope
// nobody else uses and asserts only on the rows it created.
func TestListConformance(t *testing.T) {
	shared := setupTestStore(t)

	storetest.RunListSuite(t, func(t *testing.T) storetest.ListStore {
		t.Helper()

		return shared
	})
}

// TestListJobsOrdersByIDUnderDefaultCollation pins the assumption every
// paged list rests on: that ORDER BY id DESC on a TEXT column, under the
// database's default collation, is the same order as Go's byte comparison
// of the IDs. Dispatch IDs only use [0-9a-z_], and a linguistic collation
// is free to weigh '_' or digits differently from their bytes, so this is
// a property of the server, not of our code.
//
// Fifty IDs minted in a tight loop share milliseconds, so their order
// within a millisecond comes only from the monotonic counter in the low
// bits. They are inserted in a scrambled order so that neither insertion
// order nor heap order can produce the expected result by accident.
func TestListJobsOrdersByIDUnderDefaultCollation(t *testing.T) {
	s := setupTestStore(t)
	ctx := context.Background()

	var collation string
	if err := pgdriver.Unwrap(s.DB()).NewRaw(
		`SELECT datcollate FROM pg_database WHERE datname = current_database()`,
	).Scan(ctx, &collation); err != nil {
		t.Fatalf("read database collation: %v", err)
	}
	t.Logf("database collation: %s", collation)

	const n = 50
	queue := "collation-" + id.NewJobID().String()

	jobs := make([]*job.Job, n)
	for i := range jobs {
		jobs[i] = storetest.PendingJob(fmt.Sprintf("collation-%02d", i), queue, 0)
	}

	minted := make([]string, n)
	for i, j := range jobs {
		minted[i] = j.ID.String()
	}
	if !slices.IsSorted(minted) {
		t.Fatalf("IDs minted in a loop are not ascending in Go byte order: %v", minted)
	}

	// 7 is coprime with 50, so k*7 mod 50 visits every index once, in an
	// order that is neither minting order nor its reverse.
	for k := range n {
		j := jobs[(k*7)%n]
		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("enqueue %s: %v", j.Name, err)
		}
	}

	page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: queue, Limit: 100})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}

	got := make([]string, len(page.Jobs))
	for i, j := range page.Jobs {
		got[i] = j.ID.String()
	}

	want := slices.Clone(minted)
	slices.Reverse(want)

	if !slices.Equal(got, want) {
		t.Fatalf("ORDER BY id DESC under %q disagrees with Go byte order:\n got  %s\n want %s",
			collation, strings.Join(got, " "), strings.Join(want, " "))
	}
	if page.NextCursor != "" || !page.Complete {
		t.Fatalf("page = next %q, complete %v; want one complete page", page.NextCursor, page.Complete)
	}
}
```

- [ ] **Step 3: Run the tests and see them fail to build**

Run: `go test -tags integration -run 'TestList' ./store/postgres/`
Expected:

```
# github.com/xraph/dispatch/store/postgres_test [github.com/xraph/dispatch/store/postgres.test]
store/postgres/list_test.go:30:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/postgres".Store) as storetest.ListStore value in return statement: *"github.com/xraph/dispatch/store/postgres".Store does not implement storetest.ListStore (missing method CountDLQEntries)
store/postgres/list_test.go:82:17: s.ListJobs undefined (type *"github.com/xraph/dispatch/store/postgres".Store has no field or method ListJobs)
FAIL	github.com/xraph/dispatch/store/postgres [build failed]
FAIL
```

- [ ] **Step 4: Implement the four capabilities**

Create `store/postgres/list.go`. It follows `ListJobsByState`, `ListRuns`, `ListDLQ` and `ListArtifacts`: the grove builder `s.pgdb.NewSelect`, `?` placeholders, the existing `from*Model` converters. The shared pieces are `pageQuery` (cursor predicate, order, `limit+1`) and `cutPage` (drop the extra row, set the next cursor). The cursor is validated by `paging.Cursor` before any query runs, so a bad one returns `paging.ErrInvalidCursor` without touching the database. The scan error is named `scanErr` because govet's shadow check (enabled in `.golangci.yml`) rejects a second `err` where the outer one is still used after the block.

```go
package postgres

import (
	"context"
	"fmt"

	"github.com/xraph/grove/drivers/pgdriver"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/paging"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ job.Lister          = (*Store)(nil)
	_ workflow.PageLister = (*Store)(nil)
	_ dlq.PageLister      = (*Store)(nil)
	_ artifact.PageLister = (*Store)(nil)
)

// pageQuery finishes a keyset page: rows strictly below the cursor, newest
// first by ID, and one row past the limit so the caller can tell whether
// another page exists without a second query. The primary key index
// serves both the predicate and the ordering.
func pageQuery(q *pgdriver.SelectQuery, cursor id.ID, limit int) *pgdriver.SelectQuery {
	if !cursor.IsNil() {
		q = q.Where("id < ?", cursor.String())
	}

	return q.OrderExpr("id DESC").Limit(limit + 1)
}

// cutPage drops the extra row pageQuery fetched. When there was one, the
// next cursor is the ID of the last row kept.
func cutPage[M any](models []M, limit int, idOf func(*M) string) (page []M, next string) {
	if len(models) <= limit {
		return models, ""
	}

	return models[:limit], idOf(&models[limit-1])
}

// whereNamePrefix filters col to values that start with prefix, taken
// literally and case-sensitively. starts_with does no pattern matching,
// so '%' and '_' in a name are ordinary characters and need no escaping.
func whereNamePrefix(q *pgdriver.SelectQuery, col, prefix string) *pgdriver.SelectQuery {
	if prefix == "" {
		return q
	}

	return q.Where("starts_with("+col+", ?)", prefix)
}

// whereScope filters on the tenant columns. An empty value is no filter,
// so an empty scope lists every tenant.
func whereScope(q *pgdriver.SelectQuery, appID, orgID string) *pgdriver.SelectQuery {
	if appID != "" {
		q = q.Where("scope_app_id = ?", appID)
	}
	if orgID != "" {
		q = q.Where("scope_org_id = ?", orgID)
	}

	return q
}

// whereReplayed filters dead letters on whether anyone has replayed them.
// Nil is no filter.
func whereReplayed(q *pgdriver.SelectQuery, replayed *bool) *pgdriver.SelectQuery {
	switch {
	case replayed == nil:
		return q
	case *replayed:
		return q.Where("replayed_at IS NOT NULL")
	default:
		return q.Where("replayed_at IS NULL")
	}
}

// ListJobs returns jobs newest first by ID, filtered and paged.
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixJob)
	if err != nil {
		return job.Page{}, err
	}
	limit := paging.Limit(opts.Limit)

	var models []jobModel
	q := s.pgdb.NewSelect(&models)

	if len(opts.States) > 0 {
		states := make([]string, len(opts.States))
		for i, st := range opts.States {
			states[i] = string(st)
		}
		q = q.Where("state = ANY(?)", states)
	}
	if opts.Queue != "" {
		q = q.Where("queue = ?", opts.Queue)
	}
	q = whereNamePrefix(q, "name", opts.NamePrefix)
	q = whereScope(q, opts.ScopeAppID, opts.ScopeOrgID)

	if scanErr := pageQuery(q, cursor, limit).Scan(ctx); scanErr != nil {
		return job.Page{}, fmt.Errorf(errPrefix+"list jobs page: %w", scanErr)
	}

	models, next := cutPage(models, limit, func(m *jobModel) string { return m.ID })

	jobs := make([]*job.Job, 0, len(models))
	for i := range models {
		j, convErr := fromJobModel(&models[i])
		if convErr != nil {
			return job.Page{}, fmt.Errorf(errPrefix+"list jobs page convert: %w", convErr)
		}
		jobs = append(jobs, j)
	}

	return job.Page{Jobs: jobs, NextCursor: next, Complete: true}, nil
}

// ListRunsPage returns workflow runs newest first by ID, filtered and
// paged.
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixRun)
	if err != nil {
		return workflow.RunPage{}, err
	}
	limit := paging.Limit(opts.Limit)

	var models []workflowRunModel
	q := s.pgdb.NewSelect(&models)

	if opts.State != "" {
		q = q.Where("state = ?", string(opts.State))
	}
	q = whereNamePrefix(q, "name", opts.NamePrefix)
	q = whereScope(q, opts.ScopeAppID, opts.ScopeOrgID)

	if scanErr := pageQuery(q, cursor, limit).Scan(ctx); scanErr != nil {
		return workflow.RunPage{}, fmt.Errorf(errPrefix+"list runs page: %w", scanErr)
	}

	models, next := cutPage(models, limit, func(m *workflowRunModel) string { return m.ID })

	runs := make([]*workflow.Run, 0, len(models))
	for i := range models {
		r, convErr := fromRunModel(&models[i])
		if convErr != nil {
			return workflow.RunPage{}, fmt.Errorf(errPrefix+"list runs page convert: %w", convErr)
		}
		runs = append(runs, r)
	}

	return workflow.RunPage{Runs: runs, NextCursor: next, Complete: true}, nil
}

// CountRuns counts workflow runs by state and exact name.
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error) {
	q := s.pgdb.NewSelect((*workflowRunModel)(nil))

	if opts.State != "" {
		q = q.Where("state = ?", string(opts.State))
	}
	if opts.Name != "" {
		q = q.Where("name = ?", opts.Name)
	}

	count, err := q.Count(ctx)
	if err != nil {
		return 0, fmt.Errorf(errPrefix+"count runs: %w", err)
	}

	return count, nil
}

// ListDLQPage returns dead letter entries newest first by ID, filtered and
// paged.
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixDLQ)
	if err != nil {
		return dlq.Page{}, err
	}
	limit := paging.Limit(opts.Limit)

	var models []dlqEntryModel
	q := s.pgdb.NewSelect(&models)

	if opts.Queue != "" {
		q = q.Where("queue = ?", opts.Queue)
	}
	q = whereNamePrefix(q, "job_name", opts.NamePrefix)
	q = whereScope(q, opts.ScopeAppID, opts.ScopeOrgID)
	q = whereReplayed(q, opts.Replayed)

	if scanErr := pageQuery(q, cursor, limit).Scan(ctx); scanErr != nil {
		return dlq.Page{}, fmt.Errorf(errPrefix+"list dlq page: %w", scanErr)
	}

	models, next := cutPage(models, limit, func(m *dlqEntryModel) string { return m.ID })

	entries := make([]*dlq.Entry, 0, len(models))
	for i := range models {
		e, convErr := fromDLQModel(&models[i])
		if convErr != nil {
			return dlq.Page{}, fmt.Errorf(errPrefix+"list dlq page convert: %w", convErr)
		}
		entries = append(entries, e)
	}

	return dlq.Page{Entries: entries, NextCursor: next, Complete: true}, nil
}

// CountDLQEntries counts dead letter entries under the given filters. A
// set FailedBefore counts entries that failed strictly before it, the same
// boundary PurgeDLQ deletes on.
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error) {
	q := s.pgdb.NewSelect((*dlqEntryModel)(nil))

	if opts.Queue != "" {
		q = q.Where("queue = ?", opts.Queue)
	}
	q = whereReplayed(q, opts.Replayed)
	if !opts.FailedBefore.IsZero() {
		q = q.Where("failed_at < ?", opts.FailedBefore)
	}

	count, err := q.Count(ctx)
	if err != nil {
		return 0, fmt.Errorf(errPrefix+"count dlq entries: %w", err)
	}

	return count, nil
}

// ListArtifactsPage returns artifacts newest first by ID, filtered and
// paged. Soft-deleted artifacts are left out unless IncludeDeleted is set.
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixArtifact)
	if err != nil {
		return artifact.Page{}, err
	}
	limit := paging.Limit(opts.Limit)

	var models []artifactModel
	q := s.pgdb.NewSelect(&models)

	if !opts.IncludeDeleted {
		q = q.Where("deleted_at IS NULL")
	}
	if opts.Lifecycle != "" {
		q = q.Where("lifecycle = ?", string(opts.Lifecycle))
	}
	q = whereScope(q, opts.ScopeAppID, opts.ScopeOrgID)

	if scanErr := pageQuery(q, cursor, limit).Scan(ctx); scanErr != nil {
		return artifact.Page{}, fmt.Errorf(errPrefix+"list artifacts page: %w", scanErr)
	}

	models, next := cutPage(models, limit, func(m *artifactModel) string { return m.ID })

	arts, err := fromArtifactModels(models)
	if err != nil {
		return artifact.Page{}, fmt.Errorf(errPrefix+"list artifacts page convert: %w", err)
	}

	return artifact.Page{Artifacts: arts, NextCursor: next, Complete: true}, nil
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `go test -tags integration -run 'TestList' -v ./store/postgres/ 2>&1 | grep -E '^(--- |    --- |ok|FAIL)|collation'`
Expected (timings vary):

```
--- PASS: TestListConformance (7.25s)
    --- PASS: TestListConformance/JobsNewestFirstAcrossStates (0.06s)
    --- PASS: TestListConformance/JobsFilterByStates (0.03s)
    --- PASS: TestListConformance/JobsCursorPagesJoin (0.08s)
    --- PASS: TestListConformance/JobsCursorSurvivesDeletedRow (0.01s)
    --- PASS: TestListConformance/JobsInvalidCursor (0.00s)
    --- PASS: TestListConformance/JobsNamePrefixIsLiteralAndCaseSensitive (0.00s)
    --- PASS: TestListConformance/JobsScopeFilterAndEmptyMeansAll (0.01s)
    --- PASS: TestListConformance/RunsNewestFirstFiltersAndCounts (0.02s)
    --- PASS: TestListConformance/RunsCursorPagesJoin (0.01s)
    --- PASS: TestListConformance/RunsInvalidCursor (0.00s)
    --- PASS: TestListConformance/DLQNewestFirstAndReplayedFilter (0.01s)
    --- PASS: TestListConformance/DLQCountFilters (0.01s)
    --- PASS: TestListConformance/DLQCursorNameAndScope (0.01s)
    --- PASS: TestListConformance/ArtifactsNewestFirstAndFilters (0.04s)
    --- PASS: TestListConformance/ArtifactsCursorPagesJoin (0.06s)
    list_test.go:55: database collation: en_US.utf8
--- PASS: TestListJobsOrdersByIDUnderDefaultCollation (7.54s)
ok  	github.com/xraph/dispatch/store/postgres	15.117s
```

This was checked on 2026-10-07. Two things worth knowing if you are tempted to change the SQL. A plain `name LIKE prefix || '%'` fails `JobsNamePrefixIsLiteralAndCaseSensitive` (prefix `"a_b"` comes back with `axb-1` as well), which is why the code uses `starts_with`. And the container's collation is `en_US.utf8`, not `C`: the ordering test passes because every ID in a table shares one prefix and the rest is lowercase Crockford base32, which `en_US.utf8` sorts the same as bytes. Do not "fix" this with `COLLATE "C"` in the query; that stops the primary key index serving the `ORDER BY`.

- [ ] **Step 6: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -tags integration ./store/postgres/... 2>&1 | grep -E '^(ok|FAIL|---)|DATA RACE'
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./store/postgres/...; rm -rf $C
```

Expected: build succeeds and the first command prints nothing; the race run prints only `ok  	github.com/xraph/dispatch/store/postgres` (about six minutes, most of it the per-test containers in `store_test.go`); lint prints `0 issues.` twice.

The repo's `.golangci.yml` sets no build tags, so the second lint run is the only one that sees `list_test.go`. Keep it scoped to `./store/postgres/...`: a whole-repo `--build-tags integration` run also reports a shadowed `err` at `store/redis/store_test.go:54`, which predates this plan and is not this task's to fix. `--allow-parallel-runners` is there because other sessions lint in the same machine and golangci-lint refuses to run alongside them otherwise. If a container test fails with `rootless Docker not found`, the Docker daemon went away mid-run; wait for `docker info` to answer and run again.

- [ ] **Step 7: Commit**

```bash
git add store/postgres/list.go store/postgres/list_test.go
git commit --only -m "feat(postgres): page jobs, runs, dead letters and artifacts by ID

Postgres now implements the four paged list capabilities. Each list
orders by id DESC, reads the rows strictly below the cursor and fetches
one row past the limit, so we know whether another page exists without
a second query. The primary key covers all of that, so there's no
migration.

Name prefixes go through starts_with, which treats % and _ as plain
characters. A second test pins the one thing the SQL can't check for
itself: that the database's default collation sorts our IDs the way Go
does." -- store/postgres/list.go store/postgres/list_test.go
git show --stat HEAD | tail -3
```

Expected:

```
 store/postgres/list.go      | 271 ++++++++++++++++++++++++++++++++++++++++++++
 store/postgres/list_test.go | 102 +++++++++++++++++
 2 files changed, 373 insertions(+)
```

---

### Task 3: SQLite implements the paged lists

SQLite gets the four paged reads and two counts that Task 1 defined, and runs the shared list suite. The queries are plain keyset paging on the primary key: `ORDER BY id DESC`, `id < cursor`, one extra row fetched to decide whether there is a next page. Two SQLite traps shape the code. `LIKE` folds ASCII case and treats `%` and `_` as wildcards, so the name prefix is `substr(name, 1, n) = prefix` instead, and `substr` counts characters on TEXT, so `n` is the prefix's rune count, not `len`. And `failed_at` is a TEXT column compared lexically, so `CountDLQEntries` binds its time exactly the way `PurgeDLQ` already does, or the purge confirmation count would drift from what a purge deletes. No migration in this task; Task 6 owns indexes.

**Files:**
- Create: `store/sqlite/list.go`
- Test: `store/sqlite/list_test.go` (create)

**Interfaces:**
- Consumes: `paging.Cursor`, `paging.Limit`, `id.PrefixJob`, `id.PrefixRun`, `id.PrefixDLQ`, `id.PrefixArtifact` (Task 1); `job.ListJobsOpts`, `job.Page`, `workflow.ListRunsPageOpts`, `workflow.RunPage`, `workflow.CountRunsOpts`, `dlq.PageOpts`, `dlq.Page`, `dlq.CountOpts`, `artifact.PageOpts`, `artifact.Page` (Task 1); `storetest.RunListSuite`, `storetest.ListStore`, `storetest.PendingJob(name, queue string, ttl time.Duration) *job.Job` (Task 1 and existing); in package `sqlite`: `jobModel`, `workflowRunModel`, `dlqEntryModel`, `artifactModel`, `fromJobModel`, `fromRunModel`, `fromDLQModel`, `fromArtifactModels`, `placeholders(n int) string` (all existing, in `store/sqlite/models.go`, `store/sqlite/artifact_models.go`, `store/sqlite/artifact.go`); `openSqliteStore(t *testing.T) *sqlitestore.Store` in `store/sqlite/reap_test.go:19` (existing test helper, package `sqlite_test`).
- Produces, on `*sqlite.Store`:

```go
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error)
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error)
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error)
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error)
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error)
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error)
```

and the compile-time assertions `_ job.Lister`, `_ workflow.PageLister`, `_ dlq.PageLister`, `_ artifact.PageLister` for `(*Store)(nil)`.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain store/sqlite && git log -1 --oneline`
Expected: no lines from `git status`. Neither `store/sqlite/list.go` nor `store/sqlite/list_test.go` exists yet. If another session has uncommitted work in `store/sqlite/`, stop and report.

- [ ] **Step 2: Write the failing tests**

Create `store/sqlite/list_test.go`. SQLite tests in this package carry no build tag (see `store/sqlite/lease_test.go`), so these run under plain `go test ./...`. The second test is SQLite-only: the shared suite uses ASCII names, so it cannot catch a byte count passed where `substr` wants a character count.

```go
package sqlite_test

import (
	"context"
	"testing"

	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/storetest"
)

// TestListConformance runs the paged list contract against SQLite. Every
// subtest gets its own migrated database from openSqliteStore
// (store/sqlite/reap_test.go:19).
func TestListConformance(t *testing.T) {
	storetest.RunListSuite(t, func(t *testing.T) storetest.ListStore {
		t.Helper()

		return openSqliteStore(t)
	})
}

// TestListJobsNamePrefixCountsCharacters pins the SQLite-only half of the
// name prefix: substr counts characters on TEXT, so the length it is given
// must be the prefix's rune count. "é-" is two characters and three bytes;
// with len() the predicate would compare "é-1" to "é-" and match nothing.
func TestListJobsNamePrefixCountsCharacters(t *testing.T) {
	s := openSqliteStore(t)
	ctx := context.Background()

	hit := storetest.PendingJob("é-1", "multibyte", 0)
	miss := storetest.PendingJob("éa-1", "multibyte", 0)
	for _, j := range []*job.Job{hit, miss} {
		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("enqueue %s: %v", j.Name, err)
		}
	}

	page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: "multibyte", NamePrefix: "é-"})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	if len(page.Jobs) != 1 || page.Jobs[0].ID != hit.ID {
		got := make([]string, len(page.Jobs))
		for i, j := range page.Jobs {
			got[i] = j.Name
		}
		t.Fatalf(`prefix "é-" matched %q, want only "é-1"`, got)
	}
}
```

- [ ] **Step 3: Run them and watch the build fail**

Run: `go test ./store/sqlite/ -run 'TestList'`
Expected:

```
# github.com/xraph/dispatch/store/sqlite_test [github.com/xraph/dispatch/store/sqlite.test]
store/sqlite/list_test.go:16:10: cannot use openSqliteStore(t) (value of type *"github.com/xraph/dispatch/store/sqlite".Store) as storetest.ListStore value in return statement: *"github.com/xraph/dispatch/store/sqlite".Store does not implement storetest.ListStore (missing method CountDLQEntries)
FAIL	github.com/xraph/dispatch/store/sqlite [build failed]
FAIL
```

(The compiler may report the second test's `s.ListJobs` call as well; either error is the expected failure.)

- [ ] **Step 4: Implement the lists**

Create `store/sqlite/list.go`. It follows the existing `ListJobsByState`, `ListRuns`, `ListDLQ` and `ListArtifacts`: grove's select builder with one `Where` per set filter, the model conversion helpers, and errors wrapped as `dispatch/sqlite: <op>: %w`. The scan error is named `scanErr` rather than reusing `err`, because govet's shadow check flags it in `ListArtifactsPage`, where the outer `err` is used again afterwards; the other three use the same name for consistency.

Things to keep exactly as written:
- The cursor is validated with `paging.Cursor` before any query, so a bad cursor returns `paging.ErrInvalidCursor` and never falls back to page one.
- `namePrefixWhere` passes `utf8.RuneCountInString(prefix)`. Using `len(prefix)` fails `TestListJobsNamePrefixCountsCharacters` (checked: it matches nothing for `"é-"`). Using `LIKE ?` with `prefix + "%"` fails the suite's `JobsNamePrefixIsLiteralAndCaseSensitive` (checked: `"a_b"` returns three jobs, `a_b-1`, `axb-1` and `A_b-2`).
- `CountDLQEntries` binds `opts.FailedBefore` as a `time.Time`, as `PurgeDLQ` in `store/sqlite/dlq.go` does. `failed_at` is a TEXT column; grove's sqlitedriver converts every bound `time.Time` to UTC and modernc/sqlite writes it with `Time.String()`, both on insert and in the comparison, so the lexical `<` is chronological and the boundary is strict. Do not format the time yourself.
- Artifact `scope_app_id` and `scope_org_id` are stored as NULL when empty (`nullString` in `store/sqlite/artifact.go`); the filters only apply when non-empty, so `= ?` is correct.

```go
package sqlite

import (
	"context"
	"fmt"
	"unicode/utf8"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/paging"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ job.Lister          = (*Store)(nil)
	_ workflow.PageLister = (*Store)(nil)
	_ dlq.PageLister      = (*Store)(nil)
	_ artifact.PageLister = (*Store)(nil)
)

// namePrefixWhere returns a predicate that holds when column starts with
// prefix, compared literally and case-sensitively, plus its arguments.
//
// LIKE is the obvious choice and the wrong one on SQLite: it folds ASCII
// case by default and reads % and _ as wildcards, so "a_b" would match
// "axb" and "A_b". substr with the = operator compares with the BINARY
// collation instead. substr counts characters on TEXT, not bytes, so the
// length is the prefix's rune count: len(prefix) counts bytes, and for a
// multi-byte prefix it would take too many characters to ever match.
func namePrefixWhere(column, prefix string) (where string, args []any) {
	return "substr(" + column + ", 1, ?) = ?", []any{utf8.RuneCountInString(prefix), prefix}
}

// pageCut trims a result fetched with limit+1 rows down to limit and
// returns the cursor for the following page: the ID of the last row kept,
// or empty when the extra row was not there.
func pageCut[M any](models []M, limit int, idOf func(*M) string) (kept []M, next string) {
	if len(models) <= limit {
		return models, ""
	}

	kept = models[:limit]

	return kept, idOf(&kept[limit-1])
}

// ListJobs returns jobs newest first by ID, filtered and paged.
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixJob)
	if err != nil {
		return job.Page{}, err
	}

	limit := paging.Limit(opts.Limit)

	var models []jobModel
	q := s.sdb.NewSelect(&models)

	if len(opts.States) > 0 {
		states := make([]any, len(opts.States))
		for i, st := range opts.States {
			states[i] = string(st)
		}
		q = q.Where("state IN ("+placeholders(len(states))+")", states...)
	}
	if opts.Queue != "" {
		q = q.Where("queue = ?", opts.Queue)
	}
	if opts.NamePrefix != "" {
		where, args := namePrefixWhere("name", opts.NamePrefix)
		q = q.Where(where, args...)
	}
	if opts.ScopeAppID != "" {
		q = q.Where("scope_app_id = ?", opts.ScopeAppID)
	}
	if opts.ScopeOrgID != "" {
		q = q.Where("scope_org_id = ?", opts.ScopeOrgID)
	}
	if !cursor.IsNil() {
		q = q.Where("id < ?", cursor.String())
	}

	if scanErr := q.OrderExpr("id DESC").Limit(limit + 1).Scan(ctx); scanErr != nil {
		return job.Page{}, fmt.Errorf("dispatch/sqlite: list jobs: %w", scanErr)
	}

	models, next := pageCut(models, limit, func(m *jobModel) string { return m.ID })

	jobs := make([]*job.Job, 0, len(models))
	for i := range models {
		j, convErr := fromJobModel(&models[i])
		if convErr != nil {
			return job.Page{}, fmt.Errorf("dispatch/sqlite: list jobs convert: %w", convErr)
		}
		jobs = append(jobs, j)
	}

	return job.Page{Jobs: jobs, NextCursor: next, Complete: true}, nil
}

// ListRunsPage returns workflow runs newest first by ID, filtered and paged.
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixRun)
	if err != nil {
		return workflow.RunPage{}, err
	}

	limit := paging.Limit(opts.Limit)

	var models []workflowRunModel
	q := s.sdb.NewSelect(&models)

	if opts.State != "" {
		q = q.Where("state = ?", string(opts.State))
	}
	if opts.NamePrefix != "" {
		where, args := namePrefixWhere("name", opts.NamePrefix)
		q = q.Where(where, args...)
	}
	if opts.ScopeAppID != "" {
		q = q.Where("scope_app_id = ?", opts.ScopeAppID)
	}
	if opts.ScopeOrgID != "" {
		q = q.Where("scope_org_id = ?", opts.ScopeOrgID)
	}
	if !cursor.IsNil() {
		q = q.Where("id < ?", cursor.String())
	}

	if scanErr := q.OrderExpr("id DESC").Limit(limit + 1).Scan(ctx); scanErr != nil {
		return workflow.RunPage{}, fmt.Errorf("dispatch/sqlite: list runs page: %w", scanErr)
	}

	models, next := pageCut(models, limit, func(m *workflowRunModel) string { return m.ID })

	runs := make([]*workflow.Run, 0, len(models))
	for i := range models {
		r, convErr := fromRunModel(&models[i])
		if convErr != nil {
			return workflow.RunPage{}, fmt.Errorf("dispatch/sqlite: list runs page convert: %w", convErr)
		}
		runs = append(runs, r)
	}

	return workflow.RunPage{Runs: runs, NextCursor: next, Complete: true}, nil
}

// CountRuns counts workflow runs by state and exact name.
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error) {
	q := s.sdb.NewSelect((*workflowRunModel)(nil))

	if opts.State != "" {
		q = q.Where("state = ?", string(opts.State))
	}
	if opts.Name != "" {
		q = q.Where("name = ?", opts.Name)
	}

	count, err := q.Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("dispatch/sqlite: count runs: %w", err)
	}

	return count, nil
}

// ListDLQPage returns dead letter entries newest first by ID, filtered and
// paged.
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixDLQ)
	if err != nil {
		return dlq.Page{}, err
	}

	limit := paging.Limit(opts.Limit)

	var models []dlqEntryModel
	q := s.sdb.NewSelect(&models)

	if opts.Queue != "" {
		q = q.Where("queue = ?", opts.Queue)
	}
	if opts.NamePrefix != "" {
		where, args := namePrefixWhere("job_name", opts.NamePrefix)
		q = q.Where(where, args...)
	}
	if opts.ScopeAppID != "" {
		q = q.Where("scope_app_id = ?", opts.ScopeAppID)
	}
	if opts.ScopeOrgID != "" {
		q = q.Where("scope_org_id = ?", opts.ScopeOrgID)
	}
	if opts.Replayed != nil {
		q = q.Where(replayedWhere(*opts.Replayed))
	}
	if !cursor.IsNil() {
		q = q.Where("id < ?", cursor.String())
	}

	if scanErr := q.OrderExpr("id DESC").Limit(limit + 1).Scan(ctx); scanErr != nil {
		return dlq.Page{}, fmt.Errorf("dispatch/sqlite: list dlq page: %w", scanErr)
	}

	models, next := pageCut(models, limit, func(m *dlqEntryModel) string { return m.ID })

	entries := make([]*dlq.Entry, 0, len(models))
	for i := range models {
		e, convErr := fromDLQModel(&models[i])
		if convErr != nil {
			return dlq.Page{}, fmt.Errorf("dispatch/sqlite: list dlq page convert: %w", convErr)
		}
		entries = append(entries, e)
	}

	return dlq.Page{Entries: entries, NextCursor: next, Complete: true}, nil
}

// CountDLQEntries counts dead letter entries under the given filters.
// FailedBefore is bound as a time.Time, exactly as PurgeDLQ binds it, so
// the driver writes both sides of failed_at < ? in the same UTC text form
// and the count matches what a purge at that time would delete.
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error) {
	q := s.sdb.NewSelect((*dlqEntryModel)(nil))

	if opts.Queue != "" {
		q = q.Where("queue = ?", opts.Queue)
	}
	if opts.Replayed != nil {
		q = q.Where(replayedWhere(*opts.Replayed))
	}
	if !opts.FailedBefore.IsZero() {
		q = q.Where("failed_at < ?", opts.FailedBefore)
	}

	count, err := q.Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("dispatch/sqlite: count dlq entries: %w", err)
	}

	return count, nil
}

// replayedWhere is the predicate for a dlq Replayed filter.
func replayedWhere(replayed bool) string {
	if replayed {
		return "replayed_at IS NOT NULL"
	}

	return "replayed_at IS NULL"
}

// ListArtifactsPage returns artifacts newest first by ID, filtered and
// paged.
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixArtifact)
	if err != nil {
		return artifact.Page{}, err
	}

	limit := paging.Limit(opts.Limit)

	var models []artifactModel
	q := s.sdb.NewSelect(&models)

	if !opts.IncludeDeleted {
		q = q.Where("deleted_at IS NULL")
	}
	if opts.Lifecycle != "" {
		q = q.Where("lifecycle = ?", string(opts.Lifecycle))
	}
	if opts.ScopeAppID != "" {
		q = q.Where("scope_app_id = ?", opts.ScopeAppID)
	}
	if opts.ScopeOrgID != "" {
		q = q.Where("scope_org_id = ?", opts.ScopeOrgID)
	}
	if !cursor.IsNil() {
		q = q.Where("id < ?", cursor.String())
	}

	if scanErr := q.OrderExpr("id DESC").Limit(limit + 1).Scan(ctx); scanErr != nil {
		return artifact.Page{}, fmt.Errorf("dispatch/sqlite: list artifacts page: %w", scanErr)
	}

	models, next := pageCut(models, limit, func(m *artifactModel) string { return m.ID })

	arts, err := fromArtifactModels(models)
	if err != nil {
		return artifact.Page{}, fmt.Errorf("dispatch/sqlite: list artifacts page convert: %w", err)
	}

	return artifact.Page{Artifacts: arts, NextCursor: next, Complete: true}, nil
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `go test -count=1 -v ./store/sqlite/ -run 'TestList' 2>&1 | grep -E '^(--- |ok)'`
Expected:

```
--- PASS: TestListConformance (1.26s)
--- PASS: TestListJobsNamePrefixCountsCharacters (0.02s)
ok  	github.com/xraph/dispatch/store/sqlite	1.707s
```

Timings vary. With `-v` and no grep you also see all fifteen suite subtests pass, from `JobsNewestFirstAcrossStates` to `ArtifactsCursorPagesJoin`.

- [ ] **Step 6: Gate**

Run:

```bash
gofmt -l store/sqlite
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -tags integration ./store/sqlite/... 2>&1 | tail -1
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected:
- `gofmt -l` prints nothing.
- The build succeeds and the filtered `go test` prints nothing (no FAIL lines).
- The race run prints `ok  	github.com/xraph/dispatch/store/sqlite	<n>s`. It takes about two minutes on a laptop; that is the existing suites, not this one.
- The first lint prints `0 issues.`
- The integration-tag lint prints exactly one issue, which predates this task and is not in a file it touches:

```
store/redis/store_test.go:54:5: shadow: declaration of "err" shadows declaration at line 36 (govet)
	if err := rdb.Open(ctx, connStr); err != nil {
	   ^
1 issues:
* govet: 1
```

Any other issue, and any issue in `store/sqlite/list.go` or `store/sqlite/list_test.go`, is yours to fix before committing. If golangci-lint refuses with `parallel golangci-lint is running`, another session is linting the same checkout: wait for it, or add `--allow-parallel-runners`.

- [ ] **Step 7: Commit**

```bash
git add store/sqlite/list.go store/sqlite/list_test.go
git commit --only -m "feat(sqlite): page jobs, runs, DLQ entries and artifacts by ID

SQLite now has the paged lists the dashboard reads: ListJobs,
ListRunsPage, CountRuns, ListDLQPage, CountDLQEntries and
ListArtifactsPage. Each orders by id DESC, pages with id < cursor, and
fetches one extra row to know whether there is a next page.

The name prefix can't use LIKE here. SQLite's LIKE ignores ASCII case and
reads % and _ as wildcards, so the filter compares substr(name, 1, n)
with =, where n is the prefix's length in characters, since substr counts
characters on TEXT. CountDLQEntries binds FailedBefore as a time.Time the
way PurgeDLQ does, so a purge confirmation counts exactly the rows the
purge will delete." -- store/sqlite/list.go store/sqlite/list_test.go
git show --stat HEAD | tail -3
```

Expected:

```
 store/sqlite/list.go      | 295 ++++++++++++++++++++++++++++++++++++++++++++++
 store/sqlite/list_test.go |  49 ++++++++
 2 files changed, 344 insertions(+)
```

Note for Task 6: every query here orders by the primary key and filters on other columns. SQLite can walk the `id` index backwards and filter as it goes, which is fine while the tables are small but scans far on a selective filter (one queue's DLQ entries, one state's jobs). Composite indexes ending in `id`, such as `dispatch_dlq (queue, id)`, `dispatch_jobs (state, id)` and `dispatch_jobs (queue, id)`, `dispatch_workflow_runs (state, id)` and `dispatch_artifacts (scope_app_id, id)`, would let it seek instead. Nothing in this task depends on them.

---

### Task 4: MongoDB implements the paged lists

Mongo gets the four paged reads the dashboard needs. Every dispatch `_id` is a TypeID string whose suffix sorts in creation order, and Mongo compares strings bytewise, so `_id` descending is newest first and the cursor is a plain `$lt` on `_id`. The `_id` index already exists, so this task adds no indexes. Name prefixes go to `$regex` anchored and escaped with `regexp.QuoteMeta`. The shared suite can't catch a missing escape (`%` and `_` mean nothing to a regex), so this task adds two Mongo-only tests next to the suite run: one for regex metacharacters in a prefix, one for the two shapes an unreplayed DLQ entry can have in the collection.

**Files:**
- Create: `store/mongo/list.go`
- Test: `store/mongo/list_test.go`

**Interfaces:**
- Consumes: `paging.Cursor`, `paging.Limit`, `id.PrefixJob`, `id.PrefixRun`, `id.PrefixDLQ`, `id.PrefixArtifact`; `job.ListJobsOpts`, `job.Page`, `workflow.ListRunsPageOpts`, `workflow.RunPage`, `workflow.CountRunsOpts`, `dlq.PageOpts`, `dlq.Page`, `dlq.CountOpts`, `artifact.PageOpts`, `artifact.Page` (Task 1); `storetest.RunListSuite`, `storetest.ListStore`, `storetest.PendingJob`; the existing mongo models and converters (`jobModel`/`fromJobModel`, `workflowRunModel`/`fromRunModel`, `dlqEntryModel`/`fromDLQModel`, `artifactModel`/`fromArtifactModels`), the collection constants in `store/mongo/store.go`, and the test helpers `startMongo`, `openStore`, `rawDatabase` in `store/mongo/dequeue_test.go`.
- Produces, on `*mongo.Store` (compile-time asserted against `job.Lister`, `workflow.PageLister`, `dlq.PageLister`, `artifact.PageLister`):

```go
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error)
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error)
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error)
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error)
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error)
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error)
```

Every page reports `Complete: true`: Mongo filters at the query, never in Go.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain store/mongo/ && git log -1 --oneline`
Expected: no `store/mongo/list.go` or `store/mongo/list_test.go` in the output. If either exists, another session is on this task: stop and report.

Note on tags: the mongo package's tests carry **no** build tag. They start a `mongo:7` testcontainer themselves and skip under `-short`, so plain `go test ./...` runs them (and needs Docker). `-tags integration` changes nothing for this package; it is in the gate below only because the plan's gate names it. Do not add a tag to the new test file.

- [ ] **Step 2: Write the failing tests**

Create `store/mongo/list_test.go`:

```go
package mongo_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/storetest"
)

// TestListSuite runs the paged list suite against MongoDB.
//
// One container and one store serve every subtest, as in
// TestDequeueConformance: each case isolates itself with a queue, name
// prefix or scope nobody else uses. Migrate runs first so the pages are
// read with the indexes production has.
func TestListSuite(t *testing.T) {
	uri := startMongo(t)
	shared := openStore(t, uri)

	if err := shared.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	storetest.RunListSuite(t, func(t *testing.T) storetest.ListStore {
		t.Helper()

		return shared
	})
}

// TestListJobsNamePrefixIsNotARegex covers what the shared suite cannot:
// "%" and "_" are ordinary characters to a regex, so the suite's prefix
// case passes even if the prefix reaches Mongo's $regex unescaped. A "."
// would then match any character, and an unbalanced "(" would fail the
// whole query instead of matching nothing.
func TestListJobsNamePrefixIsNotARegex(t *testing.T) {
	uri := startMongo(t)
	s := openStore(t, uri)
	ctx := context.Background()

	const queue = "regex-literal"

	dot := storetest.PendingJob("a.b-1", queue, 0)
	anyChar := storetest.PendingJob("axb-1", queue, 0)
	paren := storetest.PendingJob("a(b-1", queue, 0)

	for _, j := range []*job.Job{dot, anyChar, paren} {
		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("enqueue %s: %v", j.Name, err)
		}
	}

	for _, tc := range []struct {
		prefix string
		want   *job.Job
	}{
		{"a.", dot},
		{"a(", paren},
	} {
		page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: queue, NamePrefix: tc.prefix})
		if err != nil {
			t.Fatalf("ListJobs(prefix %q): %v", tc.prefix, err)
		}

		got := make([]string, len(page.Jobs))
		for i, j := range page.Jobs {
			got[i] = j.Name
		}

		if !slices.Equal(got, []string{tc.want.Name}) {
			t.Errorf("ListJobs(prefix %q) = %v, want [%s]", tc.prefix, got, tc.want.Name)
		}
	}
}

// TestDLQReplayedFilterMatchesBothUnreplayedShapes pins the replayed_at
// filter against both ways a document can say "never replayed". PushDLQ
// goes through grove's insert, which writes an explicit null; the raw
// driver's encoder honours "omitempty" and leaves the key out. The suite
// only ever produces the first, so the second is made here with $unset.
func TestDLQReplayedFilterMatchesBothUnreplayedShapes(t *testing.T) {
	uri := startMongo(t)
	s := openStore(t, uri)
	col := rawDatabase(t, uri).Collection("dispatch_dlq")
	ctx := context.Background()

	const queue = "replayed-shapes"

	now := time.Now().UTC().Truncate(time.Millisecond)
	entry := func(name string) *dlq.Entry {
		return &dlq.Entry{
			ID:        id.NewDLQID(),
			JobID:     id.NewJobID(),
			JobName:   name,
			Queue:     queue,
			Payload:   []byte(`{}`),
			Error:     "boom",
			FailedAt:  now,
			CreatedAt: now,
		}
	}

	nullKey, absentKey, replayed := entry("null"), entry("absent"), entry("replayed")
	for _, e := range []*dlq.Entry{nullKey, absentKey, replayed} {
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("push %s: %v", e.JobName, err)
		}
	}

	if err := s.ReplayDLQ(ctx, replayed.ID); err != nil {
		t.Fatalf("replay: %v", err)
	}

	if _, err := col.UpdateOne(ctx,
		bson.M{"_id": absentKey.ID.String()},
		bson.M{"$unset": bson.M{"replayed_at": ""}},
	); err != nil {
		t.Fatalf("unset replayed_at: %v", err)
	}

	// The two shapes really are different, or the rest proves nothing.
	var nullDoc, absentDoc bson.M
	if err := col.FindOne(ctx, bson.M{"_id": nullKey.ID.String()}).Decode(&nullDoc); err != nil {
		t.Fatalf("read null doc: %v", err)
	}
	if v, ok := nullDoc["replayed_at"]; !ok || v != nil {
		t.Fatalf("pushed replayed_at = %#v (present=%t), want present and null", v, ok)
	}
	if err := col.FindOne(ctx, bson.M{"_id": absentKey.ID.String()}).Decode(&absentDoc); err != nil {
		t.Fatalf("read absent doc: %v", err)
	}
	if v, ok := absentDoc["replayed_at"]; ok {
		t.Fatalf("unset replayed_at = %#v, want key absent", v)
	}

	yes, no := true, false
	for _, tc := range []struct {
		what     string
		replayed *bool
		want     []string
	}{
		{"unreplayed", &no, []string{absentKey.ID.String(), nullKey.ID.String()}},
		{"replayed", &yes, []string{replayed.ID.String()}},
	} {
		page, err := s.ListDLQPage(ctx, dlq.PageOpts{Queue: queue, Replayed: tc.replayed})
		if err != nil {
			t.Fatalf("ListDLQPage %s: %v", tc.what, err)
		}

		got := make([]string, len(page.Entries))
		for i, e := range page.Entries {
			got[i] = e.ID.String()
		}

		if !slices.Equal(got, tc.want) {
			t.Errorf("ListDLQPage %s:\n got  %v\n want %v", tc.what, got, tc.want)
		}

		n, err := s.CountDLQEntries(ctx, dlq.CountOpts{Queue: queue, Replayed: tc.replayed})
		if err != nil {
			t.Fatalf("CountDLQEntries %s: %v", tc.what, err)
		}

		if n != int64(len(tc.want)) {
			t.Errorf("CountDLQEntries %s = %d, want %d", tc.what, n, len(tc.want))
		}
	}
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `go test ./store/mongo/ -run 'TestListSuite|TestListJobsNamePrefixIsNotARegex|TestDLQReplayedFilterMatchesBothUnreplayedShapes'`
Expected: FAIL to compile:

```
store/mongo/list_test.go:34:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/mongo".Store) as storetest.ListStore value in return statement: *"github.com/xraph/dispatch/store/mongo".Store does not implement storetest.ListStore (missing method CountDLQEntries)
store/mongo/list_test.go:67:18: s.ListJobs undefined (type *"github.com/xraph/dispatch/store/mongo".Store has no field or method ListJobs)
store/mongo/list_test.go:152:18: s.ListDLQPage undefined (...)
store/mongo/list_test.go:166:15: s.CountDLQEntries undefined (...)
FAIL	github.com/xraph/dispatch/store/mongo [build failed]
```

- [ ] **Step 4: Implement the lists**

Create `store/mongo/list.go`. It uses the raw driver collection (`s.mdb.Collection`) with `options.Find()`, the same way `ListJobsByState`, `ListRuns`, `ListDLQ` and `ListArtifacts` do, and reuses their model converters.

```go
package mongo

import (
	"context"
	"fmt"
	"regexp"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/paging"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ job.Lister          = (*Store)(nil)
	_ workflow.PageLister = (*Store)(nil)
	_ dlq.PageLister      = (*Store)(nil)
	_ artifact.PageLister = (*Store)(nil)
)

// namePrefix matches strings that start with prefix, read literally and
// case-sensitively. QuoteMeta escapes every regex metacharacter, so a
// name like "a.b" or "a(b" is a prefix and not a pattern. An anchored,
// case-sensitive regex is also the only kind Mongo can turn into an index
// range, should the field ever be indexed.
func namePrefix(prefix string) bson.M {
	return bson.M{"$regex": "^" + regexp.QuoteMeta(prefix)}
}

// findPage reads one page of col newest first by _id. Every dispatch _id
// is a TypeID string whose suffix sorts in creation order, and Mongo
// compares strings bytewise, so _id descending is newest first. A row is
// after the cursor exactly when its _id sorts strictly below it, which
// holds whether or not the cursor row still exists.
//
// It asks for one row more than the page so it can tell whether another
// page follows without a second query; more reports that, and the extra
// row is dropped.
func findPage[M any](
	ctx context.Context, s *Store, col string, filter bson.M, cursor id.ID, limit int,
) (rows []M, more bool, err error) {
	if !cursor.IsNil() {
		filter["_id"] = bson.M{"$lt": cursor.String()}
	}

	limit = paging.Limit(limit)
	find := options.Find().
		SetSort(bson.D{{Key: "_id", Value: -1}}).
		SetLimit(int64(limit) + 1)

	cur, err := s.mdb.Collection(col).Find(ctx, filter, find)
	if err != nil {
		return nil, false, err
	}

	if err := cur.All(ctx, &rows); err != nil {
		return nil, false, err
	}

	if len(rows) > limit {
		return rows[:limit], true, nil
	}

	return rows, false, nil
}

// ListJobs returns jobs newest first by ID, filtered and paged.
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixJob)
	if err != nil {
		return job.Page{}, err
	}

	filter := bson.M{}
	if len(opts.States) > 0 {
		states := make([]string, len(opts.States))
		for i, st := range opts.States {
			states[i] = string(st)
		}
		filter["state"] = bson.M{"$in": states}
	}
	if opts.Queue != "" {
		filter["queue"] = opts.Queue
	}
	if opts.NamePrefix != "" {
		filter["name"] = namePrefix(opts.NamePrefix)
	}
	if opts.ScopeAppID != "" {
		filter["scope_app_id"] = opts.ScopeAppID
	}
	if opts.ScopeOrgID != "" {
		filter["scope_org_id"] = opts.ScopeOrgID
	}

	models, more, err := findPage[jobModel](ctx, s, colJobs, filter, cursor, opts.Limit)
	if err != nil {
		return job.Page{}, fmt.Errorf("dispatch/mongo: list jobs page: %w", err)
	}

	page := job.Page{Jobs: make([]*job.Job, 0, len(models)), Complete: true}
	for i := range models {
		j, convErr := fromJobModel(&models[i])
		if convErr != nil {
			return job.Page{}, fmt.Errorf("dispatch/mongo: list jobs page convert: %w", convErr)
		}
		page.Jobs = append(page.Jobs, j)
	}
	if more {
		page.NextCursor = page.Jobs[len(page.Jobs)-1].ID.String()
	}

	return page, nil
}

// ListRunsPage returns workflow runs newest first by ID, filtered and paged.
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixRun)
	if err != nil {
		return workflow.RunPage{}, err
	}

	filter := bson.M{}
	if opts.State != "" {
		filter["state"] = string(opts.State)
	}
	if opts.NamePrefix != "" {
		filter["name"] = namePrefix(opts.NamePrefix)
	}
	if opts.ScopeAppID != "" {
		filter["scope_app_id"] = opts.ScopeAppID
	}
	if opts.ScopeOrgID != "" {
		filter["scope_org_id"] = opts.ScopeOrgID
	}

	models, more, err := findPage[workflowRunModel](ctx, s, colWorkflowRuns, filter, cursor, opts.Limit)
	if err != nil {
		return workflow.RunPage{}, fmt.Errorf("dispatch/mongo: list runs page: %w", err)
	}

	page := workflow.RunPage{Runs: make([]*workflow.Run, 0, len(models)), Complete: true}
	for i := range models {
		r, convErr := fromRunModel(&models[i])
		if convErr != nil {
			return workflow.RunPage{}, fmt.Errorf("dispatch/mongo: list runs page convert: %w", convErr)
		}
		page.Runs = append(page.Runs, r)
	}
	if more {
		page.NextCursor = page.Runs[len(page.Runs)-1].ID.String()
	}

	return page, nil
}

// CountRuns counts workflow runs by state and exact name.
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error) {
	filter := bson.M{}
	if opts.State != "" {
		filter["state"] = string(opts.State)
	}
	if opts.Name != "" {
		filter["name"] = opts.Name
	}

	n, err := s.mdb.Collection(colWorkflowRuns).CountDocuments(ctx, filter)
	if err != nil {
		return 0, fmt.Errorf("dispatch/mongo: count runs: %w", err)
	}

	return n, nil
}

// replayedFilter is the replayed_at condition for a Replayed filter.
// PushDLQ goes through grove's insert, which writes an unreplayed entry's
// replayed_at as an explicit null, while a document written by the raw
// driver's encoder drops the key under "omitempty". Equality with nil
// matches both shapes, and $ne nil matches neither, so both answers hold
// whichever path wrote the entry. "Not replayed" is a plain nil, the same
// equality ListArtifacts uses on deleted_at.
func replayedFilter(replayed bool) any {
	if replayed {
		return bson.M{"$ne": nil}
	}

	return nil
}

// ListDLQPage returns dead letter entries newest first by ID, filtered and
// paged.
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixDLQ)
	if err != nil {
		return dlq.Page{}, err
	}

	filter := bson.M{}
	if opts.Queue != "" {
		filter["queue"] = opts.Queue
	}
	if opts.NamePrefix != "" {
		filter["job_name"] = namePrefix(opts.NamePrefix)
	}
	if opts.ScopeAppID != "" {
		filter["scope_app_id"] = opts.ScopeAppID
	}
	if opts.ScopeOrgID != "" {
		filter["scope_org_id"] = opts.ScopeOrgID
	}
	if opts.Replayed != nil {
		filter["replayed_at"] = replayedFilter(*opts.Replayed)
	}

	models, more, err := findPage[dlqEntryModel](ctx, s, colDLQ, filter, cursor, opts.Limit)
	if err != nil {
		return dlq.Page{}, fmt.Errorf("dispatch/mongo: list dlq page: %w", err)
	}

	page := dlq.Page{Entries: make([]*dlq.Entry, 0, len(models)), Complete: true}
	for i := range models {
		e, convErr := fromDLQModel(&models[i])
		if convErr != nil {
			return dlq.Page{}, fmt.Errorf("dispatch/mongo: list dlq page convert: %w", convErr)
		}
		page.Entries = append(page.Entries, e)
	}
	if more {
		page.NextCursor = page.Entries[len(page.Entries)-1].ID.String()
	}

	return page, nil
}

// CountDLQEntries counts dead letter entries under the given filters.
// FailedBefore is strictly before, the same $lt PurgeDLQ deletes on, so
// the count a purge confirmation shows is the count the purge removes.
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error) {
	filter := bson.M{}
	if opts.Queue != "" {
		filter["queue"] = opts.Queue
	}
	if opts.Replayed != nil {
		filter["replayed_at"] = replayedFilter(*opts.Replayed)
	}
	if !opts.FailedBefore.IsZero() {
		filter["failed_at"] = bson.M{"$lt": opts.FailedBefore}
	}

	n, err := s.mdb.Collection(colDLQ).CountDocuments(ctx, filter)
	if err != nil {
		return 0, fmt.Errorf("dispatch/mongo: count dlq entries: %w", err)
	}

	return n, nil
}

// ListArtifactsPage returns artifacts newest first by ID, filtered and
// paged. A live artifact's deleted_at may be absent or null, as in
// ListArtifacts, and equality with nil matches both.
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixArtifact)
	if err != nil {
		return artifact.Page{}, err
	}

	filter := bson.M{}
	if !opts.IncludeDeleted {
		filter["deleted_at"] = nil
	}
	if opts.Lifecycle != "" {
		filter["lifecycle"] = string(opts.Lifecycle)
	}
	if opts.ScopeAppID != "" {
		filter["scope_app_id"] = opts.ScopeAppID
	}
	if opts.ScopeOrgID != "" {
		filter["scope_org_id"] = opts.ScopeOrgID
	}

	models, more, err := findPage[artifactModel](ctx, s, colArtifacts, filter, cursor, opts.Limit)
	if err != nil {
		return artifact.Page{}, fmt.Errorf("dispatch/mongo: list artifacts page: %w", err)
	}

	arts, err := fromArtifactModels(models)
	if err != nil {
		return artifact.Page{}, fmt.Errorf("dispatch/mongo: list artifacts page convert: %w", err)
	}

	page := artifact.Page{Artifacts: arts, Complete: true}
	if more {
		page.NextCursor = arts[len(arts)-1].ID.String()
	}

	return page, nil
}
```

Three details to keep exactly as written:

- `findPage` writes the cursor predicate into the caller's `filter` map. Each caller builds a fresh `bson.M{}`, so nothing is shared, but do not hoist a filter into a package variable.
- `replayedFilter(false)` returns a plain `nil`, which Mongo reads as "equal to null", and that matches both an explicit null (what `PushDLQ` writes through grove's insert) and a missing key (what the raw driver's `omitempty` encoder writes). Do not replace it with `{"$exists": false}`: that matches only the missing key, and `TestDLQReplayedFilterMatchesBothUnreplayedShapes` fails with `CountDLQEntries unreplayed = 1, want 2`.
- `namePrefix` must keep `regexp.QuoteMeta`. Without it `TestListJobsNamePrefixIsNotARegex` fails twice: prefix `a.` returns `[a(b-1 axb-1 a.b-1]`, and prefix `a(` errors with `(Location51091) Regular expression is invalid: missing closing parenthesis`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `go test -race ./store/mongo/ -run 'TestListSuite|TestListJobsNamePrefixIsNotARegex|TestDLQReplayedFilterMatchesBothUnreplayedShapes' -v 2>&1 | grep -E '^\s*--- |^ok|^FAIL'`
Expected:

```
--- PASS: TestListSuite
    --- PASS: TestListSuite/JobsNewestFirstAcrossStates
    --- PASS: TestListSuite/JobsFilterByStates
    --- PASS: TestListSuite/JobsCursorPagesJoin
    --- PASS: TestListSuite/JobsCursorSurvivesDeletedRow
    --- PASS: TestListSuite/JobsInvalidCursor
    --- PASS: TestListSuite/JobsNamePrefixIsLiteralAndCaseSensitive
    --- PASS: TestListSuite/JobsScopeFilterAndEmptyMeansAll
    --- PASS: TestListSuite/RunsNewestFirstFiltersAndCounts
    --- PASS: TestListSuite/RunsCursorPagesJoin
    --- PASS: TestListSuite/RunsInvalidCursor
    --- PASS: TestListSuite/DLQNewestFirstAndReplayedFilter
    --- PASS: TestListSuite/DLQCountFilters
    --- PASS: TestListSuite/DLQCursorNameAndScope
    --- PASS: TestListSuite/ArtifactsNewestFirstAndFilters
    --- PASS: TestListSuite/ArtifactsCursorPagesJoin
--- PASS: TestListJobsNamePrefixIsNotARegex
--- PASS: TestDLQReplayedFilterMatchesBothUnreplayedShapes
ok  	github.com/xraph/dispatch/store/mongo
```

(Timings omitted. Each test starts its own container, so this takes around 30 seconds.)

- [ ] **Step 6: Gate**

Run:

```bash
gofmt -l store/mongo/
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -tags integration ./store/mongo/... 2>&1 | tail -1
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: `gofmt` prints nothing, the `go test ./...` filter prints nothing, the race run ends `ok  	github.com/xraph/dispatch/store/mongo` (about three minutes: every mongo test starts its own container), and lint prints `0 issues.`

`--allow-parallel-runners` is there because other sessions lint in this tree too; without it golangci-lint refuses with `parallel golangci-lint is running`. If you also lint with `--build-tags integration`, expect one issue that is not this task's: `store/redis/store_test.go:54:5: shadow: declaration of "err" shadows declaration at line 36 (govet)`. It predates this plan (that file is the only `//go:build integration` file in the repo, so the default lint never sees it). Leave it alone here.

- [ ] **Step 7: Commit**

```bash
git add store/mongo/list.go store/mongo/list_test.go
git commit --only -m "feat(mongo): page jobs, runs, dead letters and artifacts newest first

Mongo now implements the four paged lists. Each sorts on _id descending,
which is creation order because every id is a TypeID string, and the
cursor is a plain \$lt on _id. We fetch one row past the limit to learn
whether there's a next page, so a page is still one query.

Name prefixes go through an anchored regex escaped with QuoteMeta. The
shared suite can't catch a missing escape, since % and _ mean nothing to
a regex, so a test here pins a dot and an open paren. Another proves the
replayed filter matches both shapes an unreplayed entry can have: the
explicit null grove's insert writes, and no key at all." -- store/mongo/list.go store/mongo/list_test.go
git show --stat HEAD | tail -3
```

Expected:

```
 store/mongo/list.go      | 301 +++++++++++++++++++++++++++++++++++++++++++++++
 store/mongo/list_test.go | 175 +++++++++++++++++++++++++++
 2 files changed, 476 insertions(+)
```

No index or migration change. Sorting on `_id` uses the `_id` index; see the note below for when that stops being enough.

> **Index note for a later task (not this one).** A filtered page walks the `_id` index backwards and filters as it goes, so it stops after `limit+1` matches. That's cheap when matches are common and slow when they're rare: a queue or name with no matching rows scans the whole collection. If the dashboard shows slow pages on big deployments, add compound indexes like `{queue: 1, _id: -1}`, `{state: 1, _id: -1}`, `{scope_app_id: 1, _id: -1}` on jobs and `{name: 1, state: 1}` on runs (for `CountRuns`) to `migrationIndexes()` in `store/mongo/store.go`. That function, not `store/mongo/migrations.go`, is what `Migrate` actually runs.

---

---

### Task 5a: Redis keeps a created-order index for jobs, runs, dead letters and artifacts

Redis keeps every job, run, dead letter and artifact ID in an unordered set (`job_ids`, `run_ids`, `dlq_ids`, `artifact_ids`), so it cannot return the newest rows first without reading all of them. This task gives each of the four entities a sorted set scored by the Unix millisecond minted into its ID, and keeps it in step on every write that creates or removes one. Task 5b reads it. Redis orders members that share a score by their bytes, and Dispatch IDs minted in the same millisecond sort by their monotonic counter, so a reverse range over the index is exactly `id DESC`.

**Files:**
- Create: `store/redis/listindex.go`
- Create: `store/redis/listindex_test.go` (integration-tagged)
- Modify: `store/redis/keys.go` (append after line 130, the end of the file)
- Modify: `store/redis/keys_internal_test.go` (append after line 23, the end of the file)
- Modify: `store/redis/job.go` (`EnqueueJob` pipeline, lines 203-208; `DeleteJob` pipeline, lines 321-324)
- Modify: `store/redis/workflow.go` (`CreateRun`, lines 92-95)
- Modify: `store/redis/dlq.go` (`PushDLQ`, lines 113-116; `PurgeDLQ`, lines 194-196)
- Modify: `store/redis/artifact.go` (`CreateArtifact`, lines 140-144; `PurgeArtifact`, line 833)

**Interfaces:**
- Consumes: `id.ID.Time() time.Time` (Task 1); `(*kv.Store).ZAdd(ctx, key string, members ...driver.ScoredMember) (int64, error)` and `(*kv.Store).ZScore(ctx, key, member string) (float64, bool, error)` from `github.com/xraph/grove/kv` v1.7.0; `driver.ScoredMember{Member string; Score float64}` from `github.com/xraph/grove/kv/driver`.
- Produces (package `redis`, unexported, used by Task 5b):

```go
const entityJob, entityRun, entityDLQ, entityArtifact = "job", "run", "dlq", "artifact"
func (k keys) byCreated(entity string) string // <prefix>dispatch:<entity>_by_created
func createdScore(i id.ID) float64            // float64(i.Time().UnixMilli())
func (s *Store) indexCreated(ctx context.Context, entity string, member id.ID) error
```

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain store/redis && git log -1 --oneline`
Expected: no lines from `git status`. If another session has uncommitted edits under `store/redis/`, stop and report.

- [ ] **Step 2: Write the failing key-shape test**

Append to the end of `store/redis/keys_internal_test.go` (after the closing brace of `TestKeys_full`, with one blank line between):

```go
// The created-order indexes are new keys on data that already exists in
// production, so their exact shape is pinned: renaming one would orphan
// every index already built and quietly backfill a new one.
func TestKeys_createdIndexes(t *testing.T) {
	tests := []struct {
		entity string
		want   string
	}{
		{entityJob, "ws_acme:dispatch:job_by_created"},
		{entityRun, "ws_acme:dispatch:run_by_created"},
		{entityDLQ, "ws_acme:dispatch:dlq_by_created"},
		{entityArtifact, "ws_acme:dispatch:artifact_by_created"},
	}
	k := newKeys("ws_acme:")
	for _, tt := range tests {
		t.Run(tt.entity, func(t *testing.T) {
			if got := k.byCreated(tt.entity); got != tt.want {
				t.Errorf("byCreated(%q) = %q, want %q", tt.entity, got, tt.want)
			}
		})
	}

	if got := newKeys("").byCreated(entityJob); got != "dispatch:job_by_created" {
		t.Errorf("unprefixed byCreated(job) = %q, want %q", got, "dispatch:job_by_created")
	}
}
```

Run: `go test ./store/redis/ -run TestKeys`
Expected: a build failure that starts like this:

```
# github.com/xraph/dispatch/store/redis [github.com/xraph/dispatch/store/redis.test]
store/redis/keys_internal_test.go:33:4: undefined: entityJob
store/redis/keys_internal_test.go:34:4: undefined: entityRun
```

- [ ] **Step 3: Add the keys, the score and the index write helper**

Append to the end of `store/redis/keys.go`, after `ownerLinks`, with one blank line between:

```go
// ── Created-order index keys ──

// byCreated is the Sorted Set of every ID of one entity kind (entityJob,
// entityRun, entityDLQ, entityArtifact) scored by the Unix millisecond
// minted into the ID. The paged lists walk it newest first. The *_ids
// sets stay the source of truth for everything else, and a list call
// backfills the index from them whenever a set holds more members than
// its index.
func (k keys) byCreated(entity string) string { return k.full(entity + "_by_created") }
```

Create `store/redis/listindex.go`:

```go
package redis

import (
	"context"

	"github.com/xraph/grove/kv/driver"

	"github.com/xraph/dispatch/id"
)

// The entity kinds that have a created-order index. Each is the stem of
// its byCreated key.
const (
	entityJob      = "job"
	entityRun      = "run"
	entityDLQ      = "dlq"
	entityArtifact = "artifact"
)

// createdScore is an ID's score in a created-order index: the Unix
// millisecond minted into its UUIDv7. A millisecond count is far below
// 2^53, so the float64 holds it exactly. Redis orders members that share
// a score by their bytes, and IDs minted in the same millisecond sort by
// their monotonic counter, so a reverse range over the index is exactly
// ID-descending, the order every paged list returns.
func createdScore(i id.ID) float64 {
	return float64(i.Time().UnixMilli())
}

// indexCreated adds member to entity's created-order index.
//
// The create paths that write one key at a time call this BEFORE they
// write the entity. A crash between the two then leaves an index member
// with no entity, which the list reads skip. The other order would leave
// a row the lists cannot see until a later list call notices its ID set
// has outgrown the index and backfills. The create paths that already
// write their indexes in one MULTI (job enqueue) add the member inside it
// instead.
func (s *Store) indexCreated(ctx context.Context, entity string, member id.ID) error {
	_, err := s.kv.ZAdd(ctx, s.keys.byCreated(entity), driver.ScoredMember{
		Member: member.String(),
		Score:  createdScore(member),
	})

	return err
}
```

Run: `go test ./store/redis/ -run TestKeys -v 2>&1 | grep -E '^(---|ok|FAIL)'`
Expected:

```
--- PASS: TestKeys_full (0.00s)
--- PASS: TestKeys_createdIndexes (0.00s)
ok  	github.com/xraph/dispatch/store/redis	...
```

- [ ] **Step 4: Write the failing write-path test**

Create `store/redis/listindex_test.go`:

```go
//go:build integration

package redis_test

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/grove/kv"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	redisstore "github.com/xraph/dispatch/store/redis"
	"github.com/xraph/dispatch/store/storetest"
	"github.com/xraph/dispatch/workflow"
)

// assertIndexed checks that member sits in the created-order index at key
// with the millisecond minted into its ID as its score.
func assertIndexed(t *testing.T, kvStore *kv.Store, key string, member id.ID) {
	t.Helper()

	score, ok, err := kvStore.ZScore(context.Background(), key, member.String())
	if err != nil {
		t.Fatalf("ZSCORE %s %s: %v", key, member, err)
	}
	if !ok {
		t.Fatalf("%s is not in %s", member, key)
	}
	if want := float64(member.Time().UnixMilli()); score != want {
		t.Fatalf("%s scored %v in %s, want %v", member, score, key, want)
	}
}

func assertNotIndexed(t *testing.T, kvStore *kv.Store, key string, member id.ID) {
	t.Helper()

	_, ok, err := kvStore.ZScore(context.Background(), key, member.String())
	if err != nil {
		t.Fatalf("ZSCORE %s %s: %v", key, member, err)
	}
	if ok {
		t.Fatalf("%s is still in %s after its row was deleted", member, key)
	}
}

// Every write that creates or removes a job, run, dead letter or artifact
// keeps that entity's created-order index in step. The key names are
// spelled out so a rename shows up here as well as in the keys test.
func TestCreatedIndex_followsEveryCreateAndDelete(t *testing.T) {
	ctx := context.Background()
	kvStore := setupTestKV(t)
	s := redisstore.New(kvStore)

	t.Run("jobs", func(t *testing.T) {
		j := storetest.PendingJob("indexed", "created-index", 0)
		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("EnqueueJob: %v", err)
		}
		assertIndexed(t, kvStore, "dispatch:job_by_created", j.ID)

		if err := s.DeleteJob(ctx, j.ID); err != nil {
			t.Fatalf("DeleteJob: %v", err)
		}
		assertNotIndexed(t, kvStore, "dispatch:job_by_created", j.ID)
	})

	t.Run("runs", func(t *testing.T) {
		r := &workflow.Run{
			Entity:    dispatch.NewEntity(),
			ID:        id.NewRunID(),
			Name:      "indexed",
			State:     workflow.RunStateRunning,
			StartedAt: time.Now().UTC(),
		}
		if err := s.CreateRun(ctx, r); err != nil {
			t.Fatalf("CreateRun: %v", err)
		}
		assertIndexed(t, kvStore, "dispatch:run_by_created", r.ID)
	})

	t.Run("dead letters", func(t *testing.T) {
		failed := time.Now().UTC().Add(-time.Hour)
		e := &dlq.Entry{
			ID:        id.NewDLQID(),
			JobID:     id.NewJobID(),
			JobName:   "indexed",
			Queue:     "created-index",
			Payload:   []byte(`{}`),
			Error:     "boom",
			FailedAt:  failed,
			CreatedAt: failed,
		}
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("PushDLQ: %v", err)
		}
		assertIndexed(t, kvStore, "dispatch:dlq_by_created", e.ID)

		if _, err := s.PurgeDLQ(ctx, time.Now().UTC()); err != nil {
			t.Fatalf("PurgeDLQ: %v", err)
		}
		assertNotIndexed(t, kvStore, "dispatch:dlq_by_created", e.ID)
	})

	t.Run("artifacts", func(t *testing.T) {
		artID := id.NewArtifactID()
		a := &artifact.Artifact{
			ID:        artID,
			Backend:   "mem",
			Bucket:    "created-index",
			Key:       artID.String(),
			Size:      1,
			Lifecycle: artifact.Durable,
			CreatedAt: time.Now().UTC(),
		}
		if err := s.CreateArtifact(ctx, a, nil); err != nil {
			t.Fatalf("CreateArtifact: %v", err)
		}
		assertIndexed(t, kvStore, "dispatch:artifact_by_created", a.ID)

		if err := s.PurgeArtifact(ctx, a.ID); err != nil {
			t.Fatalf("PurgeArtifact: %v", err)
		}
		assertNotIndexed(t, kvStore, "dispatch:artifact_by_created", a.ID)
	})
}
```

Run: `go test -tags integration ./store/redis/ -run TestCreatedIndex -v 2>&1 | grep -E 'listindex_test|^(---|ok|FAIL)'`
Expected (the IDs differ per run):

```
    listindex_test.go:63: job_01... is not in dispatch:job_by_created
    listindex_test.go:82: wfrun_01... is not in dispatch:run_by_created
    listindex_test.go:100: dlq_01... is not in dispatch:dlq_by_created
    listindex_test.go:122: art_01... is not in dispatch:artifact_by_created
--- FAIL: TestCreatedIndex_followsEveryCreateAndDelete (...)
FAIL
```

- [ ] **Step 5: Add the member inside the pipelines that already exist**

Four writes already run their index updates in one `TxPipeline` on `s.rdb`. The index member goes inside the same MULTI, on the same client, so the entity, its ID set and its index change together.

In `store/redis/job.go`, `EnqueueJob` (lines 203-204), change:

```go
	pipe := s.rdb.TxPipeline()
	pipe.SAdd(ctx, s.keys.jobIDs(), jID)
```

to:

```go
	pipe := s.rdb.TxPipeline()
	pipe.SAdd(ctx, s.keys.jobIDs(), jID)
	pipe.ZAdd(ctx, s.keys.byCreated(entityJob), goredis.Z{Score: createdScore(j.ID), Member: jID})
```

In `store/redis/job.go`, `DeleteJob` (lines 323-324), change:

```go
	pipe.SRem(ctx, s.keys.jobIDs(), jID)
	pipe.ZRem(ctx, s.keys.queue(e.Queue), jID)
```

to:

```go
	pipe.SRem(ctx, s.keys.jobIDs(), jID)
	pipe.ZRem(ctx, s.keys.byCreated(entityJob), jID)
	pipe.ZRem(ctx, s.keys.queue(e.Queue), jID)
```

In `store/redis/dlq.go`, `PurgeDLQ` (line 196), change:

```go
			pipe.SRem(ctx, s.keys.dlqIDs(), eID)
```

to:

```go
			pipe.SRem(ctx, s.keys.dlqIDs(), eID)
			pipe.ZRem(ctx, s.keys.byCreated(entityDLQ), eID)
```

In `store/redis/artifact.go`, `PurgeArtifact` (line 833), change:

```go
	pipe.SRem(ctx, s.keys.artifactIDs(), key)
```

to:

```go
	pipe.SRem(ctx, s.keys.artifactIDs(), key)
	pipe.ZRem(ctx, s.keys.byCreated(entityArtifact), key)
```

- [ ] **Step 6: Index the three creates that write one key at a time**

`CreateRun`, `PushDLQ` and `CreateArtifact` write the entity and then `SADD` as separate commands. Each gets an `indexCreated` call BEFORE its entity write; the doc comment on `indexCreated` says why that order is the safe one.

In `store/redis/workflow.go`, `CreateRun` (lines 92-95), change:

```go
	e := toRunEntity(run)
	if err := s.setEntity(ctx, key, e); err != nil {
		return fmt.Errorf("dispatch/redis: create run set: %w", err)
	}
```

to:

```go
	// Index before the entity; indexCreated says why the order matters.
	if err := s.indexCreated(ctx, entityRun, run.ID); err != nil {
		return fmt.Errorf("dispatch/redis: create run created index: %w", err)
	}

	e := toRunEntity(run)
	if err := s.setEntity(ctx, key, e); err != nil {
		return fmt.Errorf("dispatch/redis: create run set: %w", err)
	}
```

In `store/redis/dlq.go`, `PushDLQ` (lines 113-116), change:

```go
	e := toDLQEntity(entry)
	if err := s.setEntity(ctx, key, e); err != nil {
		return fmt.Errorf("dispatch/redis: push dlq set: %w", err)
	}
```

to:

```go
	// Index before the entity; indexCreated says why the order matters.
	if err := s.indexCreated(ctx, entityDLQ, entry.ID); err != nil {
		return fmt.Errorf("dispatch/redis: push dlq created index: %w", err)
	}

	e := toDLQEntity(entry)
	if err := s.setEntity(ctx, key, e); err != nil {
		return fmt.Errorf("dispatch/redis: push dlq set: %w", err)
	}
```

In `store/redis/artifact.go`, `CreateArtifact` (lines 140-144), change:

```go
	if !ok {
		return artifact.ErrExists
	}

	if err := s.setEntity(ctx, s.keys.artifact(a.ID.String()), toArtifactEntity(a)); err != nil {
```

to:

```go
	if !ok {
		return artifact.ErrExists
	}

	// Index before the entity; indexCreated says why the order matters.
	if err := s.indexCreated(ctx, entityArtifact, a.ID); err != nil {
		s.rdb.Del(ctx, guard)

		return fmt.Errorf("dispatch/redis: create artifact created index: %w", err)
	}

	if err := s.setEntity(ctx, s.keys.artifact(a.ID.String()), toArtifactEntity(a)); err != nil {
```

The guard release on failure matches what the existing `setEntity` failure branch right below already does, so a failed index write does not burn the storage coordinates.

- [ ] **Step 7: Run the tests and see them pass**

Run: `gofmt -l store/redis; go test -tags integration ./store/redis/ -run 'TestCreatedIndex|TestKeys' -v 2>&1 | grep -E '^(---|\s+---|ok|FAIL)'`
Expected: no `gofmt` output, then:

```
--- PASS: TestKeys_full (0.00s)
    ...
--- PASS: TestKeys_createdIndexes (0.00s)
    ...
--- PASS: TestCreatedIndex_followsEveryCreateAndDelete (...)
    --- PASS: TestCreatedIndex_followsEveryCreateAndDelete/jobs (...)
    --- PASS: TestCreatedIndex_followsEveryCreateAndDelete/runs (...)
    --- PASS: TestCreatedIndex_followsEveryCreateAndDelete/dead_letters (...)
    --- PASS: TestCreatedIndex_followsEveryCreateAndDelete/artifacts (...)
ok  	github.com/xraph/dispatch/store/redis	...
```

- [ ] **Step 8: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -tags integration ./store/redis/... 2>&1 | tail -1
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./store/redis/...; rm -rf $C
```

Expected: no FAIL lines, `ok  	github.com/xraph/dispatch/store/redis` from the race run, `0 issues.` from the first lint. The integration-tagged lint reports exactly one issue, and it is not yours:

```
store/redis/store_test.go:54:5: shadow: declaration of "err" shadows declaration at line 36 (govet)
```

That shadow is on `main` already (`setupTestKV` in `store_test.go`, untouched here); leave it. Any other line is yours to fix. `--allow-parallel-runners` is there because other sessions lint on this machine and golangci-lint otherwise refuses with "parallel golangci-lint is running".

- [ ] **Step 9: Commit**

```bash
git add store/redis/listindex.go store/redis/listindex_test.go
git commit --only -m "feat(redis): keep a created-order index for jobs, runs, dead letters and artifacts

Redis keeps every entity ID in an unordered set, so it cannot list the
newest rows first without reading all of them. Each of the four
entities now has a sorted set scored by the millisecond in its ID, and
every write that creates or removes one keeps it in step.

Enqueue, job delete, DLQ purge and artifact purge add or remove the
member inside the MULTI they already run. Run create, DLQ push and
artifact create write it before the entity, so a crash in between
leaves a member the list reads skip, not a row that waits on a
backfill to show up." -- store/redis/listindex.go store/redis/listindex_test.go store/redis/keys.go store/redis/keys_internal_test.go store/redis/job.go store/redis/workflow.go store/redis/dlq.go store/redis/artifact.go
git show --stat HEAD | tail -9
```

Expected: 8 files changed.

---

### Task 5b: Redis lists jobs, runs, dead letters and artifacts a page at a time

With the index from Task 5a in place, the four paged lists walk it newest first and filter in Go with the shared `Match` from Task 1, because Redis cannot filter inside a sorted set. Two things make Redis different from the other four backends. Rows written before this release are in the ID sets but not the index, so before every list read the store compares the two counts (`SCARD` of the ID set, `ZCARD` of the index) and backfills the index from the set whenever the set holds more. That one check covers rows written before this release and rows a process still on the previous release writes during a rolling upgrade, after the index already exists. And a filter that matches rarely could read every row the tenant has to fill one page, so each call examines at most 5000 IDs and, if it stops there, says so with `Complete: false` and a cursor to carry on from.

**Files:**
- Create: `store/redis/list.go`
- Create: `store/redis/list_test.go` (integration-tagged)
- Create: `store/redis/export_test.go`
- Modify: `store/redis/listindex.go` (replace the whole file: adds `ensureBackfilled`)
- Modify: `store/redis/store.go` (`Store` struct, lines 56-61; `New`, lines 66-71)

**Interfaces:**
- Consumes: everything Task 5a produces; `paging.Cursor`, `paging.Limit`, the four `Match` methods and `storetest.RunListSuite` from Task 1; from grove kv v1.7.0, `(*kv.Store).ZRangeWithScores(ctx, key string, spec driver.RangeSpec) ([]driver.ScoredMember, error)`, `MGetRaw(ctx, keys []string) ([][]byte, error)` (positional, nil where a key is absent), `SMembers`, `SCard(ctx, key string) (int64, error)`, `ZCard(ctx, key string) (int64, error)`; `driver.RangeSpec{Min, Max float64; HasMin, HasMax, Reverse bool; Offset, Count int64}` (Min and Max inclusive).
- Produces:

```go
// package redis
var _ job.Lister, _ workflow.PageLister, _ dlq.PageLister, _ artifact.PageLister = (*Store)(nil)
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error)
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error)
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error)
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error)
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error)
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error)
const listScanBudget = 5000 // IDs examined per list call
const listWindow = 200      // IDs per range read

// test-only, from export_test.go
func (s *Store) SetListScanBudgetForTest(n int)
```

- [ ] **Step 1: Write the failing tests**

Create `store/redis/export_test.go`:

```go
package redis

// SetListScanBudgetForTest lowers how many index members one paged list
// call on this store examines, so a test can make a filtered scan stop at
// its budget without writing thousands of rows.
func (s *Store) SetListScanBudgetForTest(n int) { s.scanBudget = n }
```

Create `store/redis/list_test.go`:

```go
//go:build integration

package redis_test

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"testing"

	"github.com/xraph/grove/kv/drivers/redisdriver"

	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	redisstore "github.com/xraph/dispatch/store/redis"
	"github.com/xraph/dispatch/store/storetest"
)

func TestListConformance(t *testing.T) {
	// One container, shared keyspace: the suite isolates its cases by
	// queue, name prefix and scope, so one store per case on the same
	// Redis is what it expects.
	connStr := startRedis(t)

	storetest.RunListSuite(t, func(t *testing.T) storetest.ListStore {
		t.Helper()

		return openRedisStore(t, connStr)
	})
}

func listedJobIDs(jobs []*job.Job) []string {
	out := make([]string, len(jobs))
	for i, j := range jobs {
		out[i] = j.ID.String()
	}

	return out
}

// A Redis written by the release before this one has jobs and their ID
// set but no created-order index. The first list call must build the
// index from the set, or every job written before the upgrade would be
// missing from the dashboard.
func TestListJobs_backfillsIndexForPreexistingRows(t *testing.T) {
	ctx := context.Background()
	kvStore := setupTestKV(t)
	s := redisstore.New(kvStore)

	q := "backfill-" + id.NewJobID().String()
	older := storetest.PendingJob("before-the-index-1", q, 0)
	newer := storetest.PendingJob("before-the-index-2", q, 0)
	for _, j := range []*job.Job{older, newer} {
		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("enqueue %s: %v", j.Name, err)
		}
	}

	if err := kvStore.Delete(ctx, "dispatch:job_by_created"); err != nil {
		t.Fatalf("drop the index to simulate pre-release data: %v", err)
	}

	page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	want := []string{newer.ID.String(), older.ID.String()}
	if got := listedJobIDs(page.Jobs); !slices.Equal(got, want) {
		t.Fatalf("jobs after backfill:\n got  %v\n want %v", got, want)
	}
	if !page.Complete {
		t.Fatal("backfilled page reported incomplete")
	}

	n, err := kvStore.ZCard(ctx, "dispatch:job_by_created")
	if err != nil {
		t.Fatalf("ZCARD index: %v", err)
	}
	if n != 2 {
		t.Fatalf("index holds %d members after the backfill, want 2", n)
	}
}

// During a rolling upgrade a process still on the previous release keeps
// adding jobs to the ID set without touching the index, after this
// release has already built it. The next list call must notice the set
// has outgrown the index and pick those jobs up.
func TestListJobs_picksUpRowsWrittenByThePreviousRelease(t *testing.T) {
	ctx := context.Background()
	kvStore := setupTestKV(t)
	s := redisstore.New(kvStore)

	q := "rollout-" + id.NewJobID().String()
	current := storetest.PendingJob("written-by-this-release", q, 0)
	if err := s.EnqueueJob(ctx, current); err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	// Use the index once, so it exists before the old process writes.
	page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q})
	if err != nil {
		t.Fatalf("first ListJobs: %v", err)
	}
	if got := listedJobIDs(page.Jobs); !slices.Equal(got, []string{current.ID.String()}) {
		t.Fatalf("first page = %v, want only %s", got, current.ID)
	}

	// What the previous release's EnqueueJob leaves behind: the entity and
	// its ID-set membership, and nothing in the created-order index.
	old := storetest.PendingJob("written-by-the-previous-release", q, 0)
	raw, err := json.Marshal(map[string]any{
		"id":          old.ID.String(),
		"name":        old.Name,
		"queue":       old.Queue,
		"payload":     old.Payload,
		"state":       string(old.State),
		"max_retries": old.MaxRetries,
		"run_at":      old.RunAt,
		"created_at":  old.CreatedAt,
		"updated_at":  old.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("marshal old-release job: %v", err)
	}
	rdb := redisdriver.UnwrapClient(kvStore)
	if setErr := rdb.Set(ctx, "dispatch:job:"+old.ID.String(), raw, 0).Err(); setErr != nil {
		t.Fatalf("SET old-release job: %v", setErr)
	}
	if addErr := rdb.SAdd(ctx, "dispatch:job_ids", old.ID.String()).Err(); addErr != nil {
		t.Fatalf("SADD old-release job: %v", addErr)
	}

	page, err = s.ListJobs(ctx, job.ListJobsOpts{Queue: q})
	if err != nil {
		t.Fatalf("ListJobs after the old-release write: %v", err)
	}
	want := []string{old.ID.String(), current.ID.String()}
	if got := listedJobIDs(page.Jobs); !slices.Equal(got, want) {
		t.Fatalf("jobs after the old-release write:\n got  %v\n want %v", got, want)
	}
}

// When a filter matches rarely, a page can run out of scan budget before
// it fills. It must say so, hand back a cursor that is never empty, and
// a client following the cursors must see every match exactly once.
func TestListJobs_reportsIncompleteScanAndContinues(t *testing.T) {
	ctx := context.Background()
	s := redisstore.New(setupTestKV(t))
	s.SetListScanBudgetForTest(10)

	q := "rare-" + id.NewJobID().String()
	noise := "noise-" + id.NewJobID().String()

	// Oldest first: a match, twelve others, a match, twelve others, a
	// match. Newest first with a budget of ten, no single call can reach
	// two matches.
	matches := make([]*job.Job, 0, 3)
	for i := range 3 {
		if i > 0 {
			for k := range 12 {
				if err := s.EnqueueJob(ctx, storetest.PendingJob(fmt.Sprintf("noise-%d-%d", i, k), noise, 0)); err != nil {
					t.Fatalf("enqueue noise: %v", err)
				}
			}
		}
		m := storetest.PendingJob(fmt.Sprintf("match-%d", i), q, 0)
		if err := s.EnqueueJob(ctx, m); err != nil {
			t.Fatalf("enqueue match: %v", err)
		}
		matches = append(matches, m)
	}

	var (
		got        []string
		incomplete int
		cursor     string
	)
	for pageNo := 1; ; pageNo++ {
		if pageNo > 10 {
			t.Fatal("more than 10 pages for 27 jobs at a budget of 10: the cursor is not advancing")
		}

		page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q, Cursor: cursor, Limit: 5})
		if err != nil {
			t.Fatalf("page %d: %v", pageNo, err)
		}
		got = append(got, listedJobIDs(page.Jobs)...)

		if !page.Complete {
			incomplete++
			if page.NextCursor == "" {
				t.Fatalf("page %d is incomplete with no cursor to continue from", pageNo)
			}
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}

	if incomplete == 0 {
		t.Fatal("no page reported an incomplete scan; the budget is not being applied")
	}
	want := listedJobIDs(matches)
	slices.Reverse(want)
	if !slices.Equal(got, want) {
		t.Fatalf("matches across pages:\n got  %v\n want %v", got, want)
	}
}

// Two tenants on one Redis each list only their own jobs. On an
// unprefixed index both stores would walk the same sorted set.
func TestStore_KeyPrefix_listsAreIsolated(t *testing.T) {
	ctx := context.Background()
	kvStore := setupTestKV(t)
	a := redisstore.New(kvStore, redisstore.WithKeyPrefix("ws_a:"))
	b := redisstore.New(kvStore, redisstore.WithKeyPrefix("ws_b:"))

	ja := storetest.PendingJob("tenant-a-only", "default", 0)
	if err := a.EnqueueJob(ctx, ja); err != nil {
		t.Fatalf("enqueue on a: %v", err)
	}
	jb := storetest.PendingJob("tenant-b-only", "default", 0)
	if err := b.EnqueueJob(ctx, jb); err != nil {
		t.Fatalf("enqueue on b: %v", err)
	}

	for _, tc := range []struct {
		tenant string
		store  *redisstore.Store
		want   string
	}{
		{"a", a, ja.ID.String()},
		{"b", b, jb.ID.String()},
	} {
		page, err := tc.store.ListJobs(ctx, job.ListJobsOpts{})
		if err != nil {
			t.Fatalf("ListJobs on %s: %v", tc.tenant, err)
		}
		if got := listedJobIDs(page.Jobs); !slices.Equal(got, []string{tc.want}) {
			t.Fatalf("tenant %s listed %v, want only its own %s", tc.tenant, got, tc.want)
		}
	}
}

// sameMillisecondJobIDs mints n job IDs that all carry the same creation
// millisecond, retrying until a run of n fits inside one. Minting is
// microseconds, so the first or second attempt nearly always does.
func sameMillisecondJobIDs(t *testing.T, n int) []id.ID {
	t.Helper()

	for range 100 {
		ids := make([]id.ID, n)
		for i := range ids {
			ids[i] = id.NewJobID()
		}
		if ids[0].Time().Equal(ids[n-1].Time()) {
			return ids
		}
	}
	t.Fatalf("could not mint %d job IDs inside one millisecond", n)

	return nil
}

// IDs minted in one millisecond share a score, so the index orders them
// by their bytes alone. Paging through more of them than one range read
// returns exercises the step over members a cursor has already passed.
func TestListJobs_pagesThroughIDsFromOneMillisecond(t *testing.T) {
	ctx := context.Background()
	s := redisstore.New(setupTestKV(t))
	s.SetListScanBudgetForTest(10)

	q := "same-ms-" + id.NewJobID().String()
	ids := sameMillisecondJobIDs(t, 25)
	for i, jobID := range ids {
		j := storetest.PendingJob(fmt.Sprintf("same-ms-%d", i), q, 0)
		j.ID = jobID
		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
	}

	var got []string
	cursor := ""
	for pageNo := 1; ; pageNo++ {
		if pageNo > 20 {
			t.Fatal("more than 20 pages for 25 jobs at limit 3: the cursor is not advancing")
		}

		page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: q, Cursor: cursor, Limit: 3})
		if err != nil {
			t.Fatalf("page %d: %v", pageNo, err)
		}
		got = append(got, listedJobIDs(page.Jobs)...)
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}

	want := make([]string, len(ids))
	for i, jobID := range ids {
		want[len(ids)-1-i] = jobID.String()
	}
	if !slices.Equal(got, want) {
		t.Fatalf("same-millisecond jobs across pages:\n got  %v\n want %v", got, want)
	}
}
```

`startRedis` and `openRedisStore` live in `reap_test.go` (untagged); `setupTestKV` lives in `store_test.go` (integration-tagged). Both are visible to this file under `-tags integration`.

Run: `go test -tags integration ./store/redis/ -run 'TestList|TestStore_KeyPrefix_lists'`
Expected:

```
# github.com/xraph/dispatch/store/redis [github.com/xraph/dispatch/store/redis.test]
store/redis/export_test.go:6:53: s.scanBudget undefined (type *Store has no field or method scanBudget)
FAIL	github.com/xraph/dispatch/store/redis [build failed]
```

- [ ] **Step 2: Give the store its scan budget**

In `store/redis/store.go`, the `Store` struct (lines 56-61) becomes:

```go
type Store struct {
	kv     *kv.Store
	rdb    goredis.UniversalClient
	keys   keys
	logger log.Logger

	// scanBudget is how many index members one paged list call examines;
	// listScanBudget in production. Tests lower it through export_test.go.
	scanBudget int
}
```

and the literal in `New` (lines 66-71) becomes:

```go
	s := &Store{
		kv:     store,
		rdb:    redisdriver.UnwrapClient(store),
		keys:   newKeys(""),
		logger: log.NewNoopLogger(),

		scanBudget: listScanBudget,
	}
```

`listScanBudget` is declared in `list.go` (Step 4); the package does not build until then.

- [ ] **Step 3: Add the backfill**

Replace the whole of `store/redis/listindex.go` with:

```go
package redis

import (
	"context"
	"fmt"

	"github.com/xraph/grove/kv/driver"

	"github.com/xraph/dispatch/id"
)

// The entity kinds that have a created-order index. Each is the stem of
// its byCreated key.
const (
	entityJob      = "job"
	entityRun      = "run"
	entityDLQ      = "dlq"
	entityArtifact = "artifact"
)

// createdScore is an ID's score in a created-order index: the Unix
// millisecond minted into its UUIDv7. A millisecond count is far below
// 2^53, so the float64 holds it exactly. Redis orders members that share
// a score by their bytes, and IDs minted in the same millisecond sort by
// their monotonic counter, so a reverse range over the index is exactly
// ID-descending, the order every paged list returns.
func createdScore(i id.ID) float64 {
	return float64(i.Time().UnixMilli())
}

// indexCreated adds member to entity's created-order index.
//
// The create paths that write one key at a time call this BEFORE they
// write the entity. A crash between the two then leaves an index member
// with no entity, which the list reads skip. The other order would leave
// a row the lists cannot see until a later list call notices its ID set
// has outgrown the index and backfills. The create paths that already
// write their indexes in one MULTI (job enqueue) add the member inside it
// instead.
func (s *Store) indexCreated(ctx context.Context, entity string, member id.ID) error {
	_, err := s.kv.ZAdd(ctx, s.keys.byCreated(entity), driver.ScoredMember{
		Member: member.String(),
		Score:  createdScore(member),
	})

	return err
}

// backfillChunk bounds how many members one ZADD carries while an index
// is built from its ID set, so a large set does not become one huge
// command.
const backfillChunk = 500

// ensureBackfilled puts every member of the ID set at idsKey into
// entity's created-order index when the set has outgrown it. Every list
// call runs it before reading the index; the check is two O(1) counts.
//
// On this release every create writes its index member before, or in the
// same MULTI as, its ID-set member, so the set holds more members than
// the index only when something wrote the set alone. That is every row
// from a release before the index existed, and every row a process still
// on that release writes during a rolling upgrade. Either way this ZADDs
// the whole set with its scores. ZADD of a member already present with
// the same score changes nothing, so a backfill racing another backfill
// or a create is harmless.
//
// The index can also hold more members than the set, and that is no
// reason to backfill. A create writes its member before its entity, and a
// delete racing a backfill can leave a member whose entity is gone; the
// reads skip both. The one gap is a rolling upgrade in which a previous
// release process deletes rows (SREM without ZREM) and also adds them:
// each stale member it leaves can offset one row it adds, and that row
// stays out of the lists until the counts next differ. Once every process
// runs this release, nothing writes the set without the index.
func (s *Store) ensureBackfilled(ctx context.Context, entity, idsKey string) error {
	index := s.keys.byCreated(entity)

	inSet, err := s.kv.SCard(ctx, idsKey)
	if err != nil {
		return fmt.Errorf("dispatch/redis: count %s ids: %w", entity, err)
	}

	inIndex, err := s.kv.ZCard(ctx, index)
	if err != nil {
		return fmt.Errorf("dispatch/redis: count %s index: %w", entity, err)
	}

	if inSet <= inIndex {
		return nil
	}

	members, err := s.kv.SMembers(ctx, idsKey)
	if err != nil {
		return fmt.Errorf("dispatch/redis: read %s ids for backfill: %w", entity, err)
	}

	batch := make([]driver.ScoredMember, 0, min(len(members), backfillChunk))
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if _, zErr := s.kv.ZAdd(ctx, index, batch...); zErr != nil {
			return fmt.Errorf("dispatch/redis: backfill %s index: %w", entity, zErr)
		}
		batch = batch[:0]

		return nil
	}

	for _, m := range members {
		parsed, pErr := id.Parse(m)
		if pErr != nil {
			// Only IDs are ever written to the ID sets. Something else has
			// no creation time to sort by, so it stays out of the index,
			// and a set holding one makes every list call backfill again.
			continue
		}
		batch = append(batch, driver.ScoredMember{Member: m, Score: createdScore(parsed)})
		if len(batch) == backfillChunk {
			if fErr := flush(); fErr != nil {
				return fErr
			}
		}
	}

	return flush()
}
```

(Compared with Task 5a's version this adds the `fmt` import, `backfillChunk` and `ensureBackfilled`; the rest is unchanged.)

- [ ] **Step 4: Add the four lists and the two counts**

Create `store/redis/list.go`:

```go
package redis

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/xraph/grove/kv/driver"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/paging"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ job.Lister          = (*Store)(nil)
	_ workflow.PageLister = (*Store)(nil)
	_ dlq.PageLister      = (*Store)(nil)
	_ artifact.PageLister = (*Store)(nil)
)

const (
	// listScanBudget caps how many index members one paged list call
	// examines. Redis cannot filter inside the index, so a filter that
	// matches rarely would otherwise read every row the tenant has before
	// returning an empty page. At the budget the call returns what it
	// found with Complete false and a cursor to continue from, which the
	// dashboard shows as "more may match". 5000 is about 25 windows,
	// enough that an ordinary filter fills its page long before it.
	listScanBudget = 5000

	// listWindow is how many members one range read takes from an index,
	// and so how many entities one pipelined read fetches.
	listWindow = 200
)

// indexScan describes one entity kind to scanNewestFirst: which index to
// walk, which ID set backfills it, where each member's entity lives, how
// to decode it and which rows to keep.
type indexScan[T any] struct {
	entity string
	ids    string
	keyOf  func(member string) string
	decode func(raw []byte) (T, error)
	match  func(T) bool
}

// scanResult is one page of an indexScan, in the shape every Page type
// shares.
type scanResult[T any] struct {
	rows     []T
	next     string
	complete bool
}

// page walks the created-order index newest first, starting just below
// cursor, and collects up to limit rows that match.
//
// It reads the index listWindow members at a time, fetches each window's
// entities in one pipelined read, and stops at the first of these:
//
//   - limit+1 matches. The page is full and the extra match proves a next
//     page exists, so NextCursor is the last row returned.
//   - the end of the index. The page is complete and has no next page.
//   - s.scanBudget members examined. The page is incomplete and
//     NextCursor is the last member examined, so the next call carries on
//     exactly where this one stopped. If the budget runs out on the last
//     member of the index, that next call returns an empty complete page.
//
// Members whose entity is gone are skipped and still count against the
// budget. They are not removed here: a create writes its member before
// its entity, so a member with no entity may be a row about to exist.
func (sc indexScan[T]) page(ctx context.Context, s *Store, cursor id.ID, limit int) (scanResult[T], error) {
	if err := s.ensureBackfilled(ctx, sc.entity, sc.ids); err != nil {
		return scanResult[T]{}, err
	}

	limit = paging.Limit(limit)
	budget := max(s.scanBudget, 1)
	index := s.keys.byCreated(sc.entity)

	// Scores are milliseconds and members are IDs, so "below the cursor"
	// is a score at or below the cursor's, minus the members at that same
	// score which sort at or above it.
	spec := driver.RangeSpec{Reverse: true}
	after := ""
	if !cursor.IsNil() {
		spec.Max, spec.HasMax, after = createdScore(cursor), true, cursor.String()
	}

	out := scanResult[T]{rows: []T{}}
	matched := make([]string, 0, limit)
	examined := 0
	lastSeen := ""

	for examined < budget {
		spec.Count = int64(min(listWindow, budget-examined))

		window, err := s.kv.ZRangeWithScores(ctx, index, spec)
		if err != nil {
			return scanResult[T]{}, fmt.Errorf("dispatch/redis: range %s index: %w", sc.entity, err)
		}
		exhausted := int64(len(window)) < spec.Count

		// A range bounded by the last score read returns the members
		// already passed at that score first. Drop them.
		fresh := window
		for len(fresh) > 0 && spec.HasMax && fresh[0].Score == spec.Max && fresh[0].Member >= after {
			fresh = fresh[1:]
		}

		if len(fresh) == 0 {
			if exhausted {
				out.complete = true

				return out, nil
			}

			// A whole window already passed means more than a window of
			// IDs share this millisecond. Step over them.
			spec.Offset += int64(len(window))

			continue
		}
		spec.Offset = 0

		keys := make([]string, len(fresh))
		for i, m := range fresh {
			keys[i] = sc.keyOf(m.Member)
		}

		raws, err := s.kv.MGetRaw(ctx, keys)
		if err != nil {
			return scanResult[T]{}, fmt.Errorf("dispatch/redis: read %s window: %w", sc.entity, err)
		}

		for i, m := range fresh {
			examined++
			lastSeen = m.Member

			if raws[i] == nil {
				continue
			}

			row, dErr := sc.decode(raws[i])
			if dErr != nil {
				return scanResult[T]{}, fmt.Errorf("dispatch/redis: decode %s %s: %w", sc.entity, m.Member, dErr)
			}
			if !sc.match(row) {
				continue
			}

			if len(out.rows) == limit {
				out.next, out.complete = matched[limit-1], true

				return out, nil
			}
			out.rows = append(out.rows, row)
			matched = append(matched, m.Member)
		}

		if exhausted {
			out.complete = true

			return out, nil
		}

		last := fresh[len(fresh)-1]
		spec.Max, spec.HasMax, after = last.Score, true, last.Member
	}

	out.next = lastSeen

	return out, nil
}

// countMatching decodes every entity in the ID set at idsKey and counts
// the ones match keeps. Counts are not paged, so this is O(n) in the set
// on Redis, the same as CountJobs.
func countMatching[T any](
	ctx context.Context,
	s *Store,
	idsKey string,
	keyOf func(member string) string,
	decode func(raw []byte) (T, error),
	match func(T) bool,
) (int64, error) {
	members, err := s.kv.SMembers(ctx, idsKey)
	if err != nil {
		return 0, fmt.Errorf("dispatch/redis: count members: %w", err)
	}

	var n int64
	for start := 0; start < len(members); start += listWindow {
		chunk := members[start:min(start+listWindow, len(members))]

		keys := make([]string, len(chunk))
		for i, m := range chunk {
			keys[i] = keyOf(m)
		}

		raws, err := s.kv.MGetRaw(ctx, keys)
		if err != nil {
			return 0, fmt.Errorf("dispatch/redis: count read: %w", err)
		}

		for i, raw := range raws {
			if raw == nil {
				continue
			}

			row, dErr := decode(raw)
			if dErr != nil {
				return 0, fmt.Errorf("dispatch/redis: count decode %s: %w", chunk[i], dErr)
			}
			if match(row) {
				n++
			}
		}
	}

	return n, nil
}

func decodeJob(raw []byte) (*job.Job, error) {
	var e jobEntity
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, err
	}

	return fromJobEntity(&e)
}

func decodeRun(raw []byte) (*workflow.Run, error) {
	var e runEntity
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, err
	}

	return fromRunEntity(&e)
}

func decodeDLQ(raw []byte) (*dlq.Entry, error) {
	var e dlqEntity
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, err
	}

	return fromDLQEntity(&e)
}

func decodeArtifact(raw []byte) (*artifact.Artifact, error) {
	var e artifactEntity
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, err
	}

	return fromArtifactEntity(&e)
}

// ListJobs returns jobs newest first by ID, filtered and paged. See
// indexScan.page for when a page comes back incomplete.
func (s *Store) ListJobs(ctx context.Context, opts job.ListJobsOpts) (job.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixJob)
	if err != nil {
		return job.Page{}, err
	}

	res, err := indexScan[*job.Job]{
		entity: entityJob,
		ids:    s.keys.jobIDs(),
		keyOf:  s.keys.job,
		decode: decodeJob,
		match:  opts.Match,
	}.page(ctx, s, cursor, opts.Limit)
	if err != nil {
		return job.Page{}, err
	}

	return job.Page{Jobs: res.rows, NextCursor: res.next, Complete: res.complete}, nil
}

// ListRunsPage returns workflow runs newest first by ID, filtered and
// paged.
func (s *Store) ListRunsPage(ctx context.Context, opts workflow.ListRunsPageOpts) (workflow.RunPage, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixRun)
	if err != nil {
		return workflow.RunPage{}, err
	}

	res, err := indexScan[*workflow.Run]{
		entity: entityRun,
		ids:    s.keys.runIDs(),
		keyOf:  s.keys.run,
		decode: decodeRun,
		match:  opts.Match,
	}.page(ctx, s, cursor, opts.Limit)
	if err != nil {
		return workflow.RunPage{}, err
	}

	return workflow.RunPage{Runs: res.rows, NextCursor: res.next, Complete: res.complete}, nil
}

// CountRuns counts workflow runs by state and exact name. It reads every
// run: O(n) on Redis, like CountJobs.
func (s *Store) CountRuns(ctx context.Context, opts workflow.CountRunsOpts) (int64, error) {
	return countMatching(ctx, s, s.keys.runIDs(), s.keys.run, decodeRun, opts.Match)
}

// ListDLQPage returns dead letter entries newest first by ID, filtered
// and paged.
func (s *Store) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixDLQ)
	if err != nil {
		return dlq.Page{}, err
	}

	res, err := indexScan[*dlq.Entry]{
		entity: entityDLQ,
		ids:    s.keys.dlqIDs(),
		keyOf:  s.keys.dlq,
		decode: decodeDLQ,
		match:  opts.Match,
	}.page(ctx, s, cursor, opts.Limit)
	if err != nil {
		return dlq.Page{}, err
	}

	return dlq.Page{Entries: res.rows, NextCursor: res.next, Complete: res.complete}, nil
}

// CountDLQEntries counts dead letter entries under the given filters. It
// reads every entry: O(n) on Redis, like CountJobs.
func (s *Store) CountDLQEntries(ctx context.Context, opts dlq.CountOpts) (int64, error) {
	return countMatching(ctx, s, s.keys.dlqIDs(), s.keys.dlq, decodeDLQ, opts.Match)
}

// ListArtifactsPage returns artifacts newest first by ID, filtered and
// paged.
func (s *Store) ListArtifactsPage(ctx context.Context, opts artifact.PageOpts) (artifact.Page, error) {
	cursor, err := paging.Cursor(opts.Cursor, id.PrefixArtifact)
	if err != nil {
		return artifact.Page{}, err
	}

	res, err := indexScan[*artifact.Artifact]{
		entity: entityArtifact,
		ids:    s.keys.artifactIDs(),
		keyOf:  s.keys.artifact,
		decode: decodeArtifact,
		match:  opts.Match,
	}.page(ctx, s, cursor, opts.Limit)
	if err != nil {
		return artifact.Page{}, err
	}

	return artifact.Page{Artifacts: res.rows, NextCursor: res.next, Complete: res.complete}, nil
}
```

How the cursor works on a score index, since it is the subtle part: scores are milliseconds, so "strictly below the cursor ID" is "score at or below the cursor's score, minus the members at that exact score which sort at or above the cursor". The range uses `Max` = cursor score (inclusive) with `Reverse`, and the members already passed at that score come back first, so `page` drops that prefix. If a whole window is nothing but already-passed members (more than a window of IDs minted in one millisecond), it steps over them with `Offset`. `TestListJobs_pagesThroughIDsFromOneMillisecond` drives that branch: with the budget at 10 every range read is at most 10 members, and 25 same-millisecond IDs paged 3 at a time force it.

Missing entities are skipped and not removed: a create writes its member before its entity (Task 5a), so a member with no entity can be a row about to exist, and a lazy `ZREM` could race it and lose the row for good.

- [ ] **Step 5: Run the tests and see them pass**

Run: `gofmt -l store/redis; go test -race -tags integration ./store/redis/ -run 'TestList|TestStore_KeyPrefix_lists|TestCreatedIndex|TestKeys' -v 2>&1 | grep -E '^(---|\s+---|ok|FAIL)'`
Expected: no `gofmt` output, then every line PASS, including:

```
--- PASS: TestListConformance (...)
    --- PASS: TestListConformance/JobsNewestFirstAcrossStates (...)
    ... (15 subtests, all PASS)
--- PASS: TestListJobs_backfillsIndexForPreexistingRows (...)
--- PASS: TestListJobs_picksUpRowsWrittenByThePreviousRelease (...)
--- PASS: TestListJobs_reportsIncompleteScanAndContinues (...)
--- PASS: TestStore_KeyPrefix_listsAreIsolated (...)
--- PASS: TestListJobs_pagesThroughIDsFromOneMillisecond (...)
--- PASS: TestCreatedIndex_followsEveryCreateAndDelete (...)
ok  	github.com/xraph/dispatch/store/redis	...
```

These tests were checked against four broken variants of `list.go` and `listindex.go` while this task was written: without the `Offset` step the same-millisecond test returns 10 of 25 jobs; without `ensureBackfilled` the backfill test lists nothing; with the backfill only run while the index is empty (a build-once marker in effect), the backfill test still passes but the rollout test lists only the job this release wrote; with the budget ignored the incomplete-scan test fails with "no page reported an incomplete scan". If one of them passes against code you know is wrong, the test is not doing its job.

- [ ] **Step 6: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -tags integration ./store/redis/... 2>&1 | tail -1
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./store/redis/...; rm -rf $C
```

Expected: no FAIL lines; `ok  	github.com/xraph/dispatch/store/redis` from the race run (about two and a half minutes, most of it the existing container tests); `0 issues.` from the first lint; and from the integration-tagged lint only the `store_test.go:54:5: shadow` line Task 5a already described.

- [ ] **Step 7: Commit**

```bash
git add store/redis/list.go store/redis/list_test.go store/redis/export_test.go
git commit --only -m "feat(redis): list jobs, runs, dead letters and artifacts a page at a time

The four paged lists walk the created-order index newest first, 200 IDs
per read, and filter in Go with the shared Match. Rows written before
this release, or written by a process still on it during a rolling
upgrade, get into the index through a backfill from the ID set. Each
list call compares the two counts first and backfills only when the set
holds more, so it costs two O(1) calls the rest of the time.

A filter that matches rarely stops after 5000 IDs and says so with
Complete false and a cursor to carry on from, so you never wait on a
read of the whole keyspace for one page. The two counts still read the
whole set, the same as CountJobs already does." -- store/redis/list.go store/redis/list_test.go store/redis/export_test.go store/redis/listindex.go store/redis/store.go
git show --stat HEAD | tail -6
```

Expected: 5 files changed.

Note for whoever runs a mixed-version roll: the count check heals rows a previous-release process adds. One gap remains while such a process is still running: it also deletes rows with `SREM` and no `ZREM`, and each stale index member that leaves behind can offset one row it adds, so `SCARD > ZCARD` does not fire for that row. The row stays out of the lists until the counts next differ (for example, another previous-release add). Once every process runs this release, nothing writes an ID set without its index. If an operator ever needs to force a rebuild, `DEL <prefix>dispatch:<entity>_by_created` and the next list call rebuilds it from the set.

---

### Task 6a: Worker rows carry their capacity, and every store can read one back

`cluster.Worker.Capacity` survives only the memory store: postgres, sqlite, mongo and redis list the worker fields by hand and leave it out. There is also no way to read one worker row, so nothing can check what a heartbeat or a registration actually wrote. This task adds `GetWorker` to `cluster.Store`, persists `Capacity` on the four real backends, and adds a cluster conformance suite every backend runs. The suite pins the one thing Task 6b depends on: a heartbeat against a missing row returns `dispatch.ErrWorkerNotFound`. All five backends already do; redis had a different hole (Step 9).

**Files:**
- Modify: `cluster/store.go` (lines 18-20, the `HeartbeatWorker` doc, and a new method after it)
- Modify: `cluster/k8s/provider.go` (new method after `HeartbeatWorker`, which ends at line 126)
- Modify: `store/memory/store.go` (imports lines 3-19; cluster section lines 820-966)
- Modify: `store/sqlite/models.go` (lines 519-567), `store/sqlite/cluster.go` (lines 15-30 and after line 60), `store/sqlite/migrations.go` (append after line 616)
- Modify: `store/postgres/models.go` (lines 510-558), `store/postgres/cluster.go` (lines 15-30 and after line 59), `store/postgres/migrations.go` (append after line 691)
- Modify: `store/mongo/models.go` (lines 512-560), `store/mongo/cluster.go` (line 34 and after line 77)
- Modify: `store/redis/cluster.go` (imports, `workerEntity` lines 15-61, `HeartbeatWorker` lines 102-116)
- Modify: `engine/engine.go` (comment lines 235-244 and 515-516), `engine/resource.go` (comment lines 271-276)
- Create: `store/storetest/cluster.go`
- Test: `store/memory/cluster_test.go`, `store/sqlite/cluster_test.go`, `store/postgres/cluster_test.go`, `store/mongo/cluster_test.go`, `store/redis/cluster_test.go`, `cluster/k8s/get_worker_test.go`

Line numbers are from the tree after Task 1. Tasks 2 to 5 add list code to the same backends, so where a number has drifted, use the quoted anchor text.

**Interfaces:**
- Consumes: `resource.EncodeSet`, `resource.DecodeSet`, `resource.EncodeSetString`, `resource.DecodeSetString`, `resource.Set.Clone`, `storetest.GiB`.
- Produces:

```go
package cluster
// added to Store:
GetWorker(ctx context.Context, workerID id.WorkerID) (*Worker, error) // dispatch.ErrWorkerNotFound when absent

package storetest
func RunClusterSuite(t *testing.T, newStore func(t *testing.T) cluster.Store)
```

Every backend now round-trips `Worker.Capacity`. Postgres and sqlite gain migration `20261008120000` `worker_capacity_column` (a nullable `capacity` column on `dispatch_workers`). The k8s provider still does not store capacity; see the note at the end of this task.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- cluster store engine && git log -1 --oneline`
Expected: no lines for any file this task lists. If another session has uncommitted edits in one of them, stop and report.

- [ ] **Step 2: Write the cluster suite**

Create `store/storetest/cluster.go`:

```go
package storetest

import (
	"context"
	"errors"
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/resource"
)

// RunClusterSuite pins the worker row contract the engine's heartbeat and
// the dashboard's worker list rely on: a registered row reads back whole,
// capacity included, a heartbeat moves LastSeen to now, and both reads
// and heartbeats on a row that does not exist say so with
// dispatch.ErrWorkerNotFound. The engine re-registers on exactly that
// sentinel, so a backend that returned nil or another error for a missing
// row would leave a live worker invisible after another instance's stale
// sweep removed it.
//
// newStore may return a shared store. Each case registers its own
// worker IDs and never asserts on ListWorkers, and no case sets IsLeader,
// so the single-leader index some backends keep is never contended.
func RunClusterSuite(t *testing.T, newStore func(t *testing.T) cluster.Store) {
	t.Helper()

	cases := []struct {
		name string
		fn   func(t *testing.T, s cluster.Store)
	}{
		{"GetWorkerRoundTripsEveryField", testGetWorkerRoundTripsEveryField},
		{"GetWorkerUnknownIsNotFound", testGetWorkerUnknownIsNotFound},
		{"ReregisterReplacesCapacity", testReregisterReplacesCapacity},
		{"HeartbeatAdvancesLastSeen", testHeartbeatAdvancesLastSeen},
		{"HeartbeatUnknownIsNotFound", testHeartbeatUnknownIsNotFound},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { c.fn(t, newStore(t)) })
	}
}

// suiteWorker builds a worker with every field set to something a backend
// could plausibly drop. Times are truncated to the millisecond, the
// coarsest precision any backend stores (BSON dates).
//
// LeaderUntil is set while IsLeader stays false so the round trip covers
// the column without claiming leadership on a store other tests share.
func suiteWorker() *cluster.Worker {
	now := time.Now().UTC().Truncate(time.Millisecond)
	until := now.Add(time.Minute)

	return &cluster.Worker{
		ID:          id.NewWorkerID(),
		Hostname:    "suite-host",
		Queues:      []string{"default", "render"},
		Concurrency: 7,
		State:       cluster.WorkerActive,
		Capacity: resource.Set{
			resource.CPU:    4000,
			resource.Memory: 8 * GiB,
			"fpga":          2,
		},
		LeaderUntil: &until,
		LastSeen:    now,
		Metadata:    map[string]string{"zone": "eu-west-1", "version": "1.2.3"},
		CreatedAt:   now.Add(-time.Hour),
	}
}

func registerWorker(t *testing.T, s cluster.Store, w *cluster.Worker) {
	t.Helper()

	if err := s.RegisterWorker(context.Background(), w); err != nil {
		t.Fatalf("RegisterWorker %s: %v", w.ID, err)
	}
}

func getWorker(t *testing.T, s cluster.Store, workerID id.WorkerID) *cluster.Worker {
	t.Helper()

	got, err := s.GetWorker(context.Background(), workerID)
	if err != nil {
		t.Fatalf("GetWorker %s: %v", workerID, err)
	}

	return got
}

func testGetWorkerRoundTripsEveryField(t *testing.T, s cluster.Store) {
	want := suiteWorker()
	registerWorker(t, s, want)

	got := getWorker(t, s, want.ID)

	if got.ID.String() != want.ID.String() {
		t.Errorf("ID = %s, want %s", got.ID, want.ID)
	}
	if got.Hostname != want.Hostname {
		t.Errorf("Hostname = %q, want %q", got.Hostname, want.Hostname)
	}
	if !slices.Equal(got.Queues, want.Queues) {
		t.Errorf("Queues = %v, want %v", got.Queues, want.Queues)
	}
	if got.Concurrency != want.Concurrency {
		t.Errorf("Concurrency = %d, want %d", got.Concurrency, want.Concurrency)
	}
	if got.State != want.State {
		t.Errorf("State = %q, want %q", got.State, want.State)
	}
	if !maps.Equal(got.Capacity, want.Capacity) {
		t.Errorf("Capacity = %v, want %v", got.Capacity, want.Capacity)
	}
	if got.IsLeader != want.IsLeader {
		t.Errorf("IsLeader = %v, want %v", got.IsLeader, want.IsLeader)
	}
	if got.LeaderUntil == nil || !got.LeaderUntil.Equal(*want.LeaderUntil) {
		t.Errorf("LeaderUntil = %v, want %v", got.LeaderUntil, *want.LeaderUntil)
	}
	if !got.LastSeen.Equal(want.LastSeen) {
		t.Errorf("LastSeen = %v, want %v", got.LastSeen, want.LastSeen)
	}
	if !maps.Equal(got.Metadata, want.Metadata) {
		t.Errorf("Metadata = %v, want %v", got.Metadata, want.Metadata)
	}
	if !got.CreatedAt.Equal(want.CreatedAt) {
		t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, want.CreatedAt)
	}
}

func testGetWorkerUnknownIsNotFound(t *testing.T, s cluster.Store) {
	got, err := s.GetWorker(context.Background(), id.NewWorkerID())
	if !errors.Is(err, dispatch.ErrWorkerNotFound) {
		t.Fatalf("GetWorker(unknown) = (%v, %v), want dispatch.ErrWorkerNotFound", got, err)
	}
}

// testReregisterReplacesCapacity covers the upsert path: the engine
// registers again after a sweep, and a worker restarted with a new
// capacity under the same ID must not keep advertising the old one.
func testReregisterReplacesCapacity(t *testing.T, s cluster.Store) {
	w := suiteWorker()
	registerWorker(t, s, w)

	again := *w
	again.Capacity = resource.Set{resource.Memory: 2 * GiB}
	again.LastSeen = w.LastSeen.Add(time.Second)
	registerWorker(t, s, &again)

	got := getWorker(t, s, w.ID)
	if !maps.Equal(got.Capacity, again.Capacity) {
		t.Errorf("Capacity after re-register = %v, want %v", got.Capacity, again.Capacity)
	}
	if !got.LastSeen.Equal(again.LastSeen) {
		t.Errorf("LastSeen after re-register = %v, want %v", got.LastSeen, again.LastSeen)
	}
}

func testHeartbeatAdvancesLastSeen(t *testing.T, s cluster.Store) {
	w := suiteWorker()
	w.LastSeen = w.LastSeen.Add(-time.Minute)
	registerWorker(t, s, w)

	if err := s.HeartbeatWorker(context.Background(), w.ID); err != nil {
		t.Fatalf("HeartbeatWorker: %v", err)
	}

	got := getWorker(t, s, w.ID)
	if !got.LastSeen.After(w.LastSeen) {
		t.Fatalf("LastSeen after heartbeat = %v, want after %v", got.LastSeen, w.LastSeen)
	}
	if drift := time.Since(got.LastSeen).Abs(); drift > 5*time.Second {
		t.Fatalf("LastSeen after heartbeat = %v, %v away from now; want within 5s", got.LastSeen, drift)
	}
}

func testHeartbeatUnknownIsNotFound(t *testing.T, s cluster.Store) {
	err := s.HeartbeatWorker(context.Background(), id.NewWorkerID())
	if !errors.Is(err, dispatch.ErrWorkerNotFound) {
		t.Fatalf("HeartbeatWorker(unknown) error = %v, want dispatch.ErrWorkerNotFound", err)
	}
}
```

The postgres heartbeat writes `NOW()` from the database clock. The 5 second window allows for a container clock that drifts slightly from the host.

- [ ] **Step 3: Run it against memory to see it fail**

Create `store/memory/cluster_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/store/storetest"
)

func TestClusterSuite(t *testing.T) {
	storetest.RunClusterSuite(t, func(_ *testing.T) cluster.Store {
		return memory.New()
	})
}
```

Run: `go test ./store/memory/ -run TestClusterSuite`
Expected: FAIL to compile:

```
store/storetest/cluster.go:87:16: s.GetWorker undefined (type cluster.Store has no field or method GetWorker)
store/storetest/cluster.go:137:16: s.GetWorker undefined (type cluster.Store has no field or method GetWorker)
```

- [ ] **Step 4: Add `GetWorker` to the interface and to all six implementations**

In `cluster/store.go`, replace the `HeartbeatWorker` doc and declaration (lines 18-20):

```go
	// HeartbeatWorker updates the last-seen timestamp for a worker,
	// indicating it is still alive.
	HeartbeatWorker(ctx context.Context, workerID id.WorkerID) error
```

with:

```go
	// HeartbeatWorker updates the last-seen timestamp for a worker,
	// indicating it is still alive. It returns dispatch.ErrWorkerNotFound
	// when the row is gone, which the engine's heartbeat takes as the
	// signal to register the worker again.
	HeartbeatWorker(ctx context.Context, workerID id.WorkerID) error

	// GetWorker returns one registered worker, or dispatch.ErrWorkerNotFound
	// when no row exists for workerID.
	GetWorker(ctx context.Context, workerID id.WorkerID) (*Worker, error)
```

**Memory** (`store/memory/store.go`). The store currently keeps the caller's `*cluster.Worker` and hands the same pointer back from `ListWorkers`, `ReapDeadWorkers` and `GetLeader`. Task 6b's heartbeat writes `LastSeen` on its own goroutine while the dashboard and `engine.MaxWorkerCapacity` read workers on others, so `-race` would flag every read. The store copies on the way in and on the way out instead.

Add `"maps"` and `"slices"` to the import block, after `"fmt"`:

```go
import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sort"
	"sync"
	"time"
```

Replace `RegisterWorker` (lines 820-827, starting `// RegisterWorker adds a new worker to the cluster registry.`) with:

```go
// cloneWorker returns a copy of w that shares no maps, slices or pointers
// with it. The store keeps its own copy and hands out copies, because the
// engine's heartbeat writes LastSeen on one goroutine while the dashboard
// and the fleet capacity check read workers on others.
func cloneWorker(w *cluster.Worker) *cluster.Worker {
	out := *w
	out.Queues = slices.Clone(w.Queues)
	out.Capacity = w.Capacity.Clone()
	out.Metadata = maps.Clone(w.Metadata)

	if w.LeaderUntil != nil {
		until := *w.LeaderUntil
		out.LeaderUntil = &until
	}

	return &out
}

// RegisterWorker adds a worker to the cluster registry, replacing any
// existing entry with the same ID.
func (m *Store) RegisterWorker(_ context.Context, w *cluster.Worker) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.workers[w.ID.String()] = cloneWorker(w)
	return nil
}
```

Directly after `HeartbeatWorker` (whose body ends `w.LastSeen = time.Now().UTC()` / `return nil` / `}`), add:

```go
// GetWorker returns a copy of one registered worker.
func (m *Store) GetWorker(_ context.Context, workerID id.WorkerID) (*cluster.Worker, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	w, ok := m.workers[workerID.String()]
	if !ok {
		return nil, dispatch.ErrWorkerNotFound
	}
	return cloneWorker(w), nil
}
```

Then make the three readers return copies. In `ListWorkers`, change `result = append(result, w)` to:

```go
		result = append(result, cloneWorker(w))
```

In `ReapDeadWorkers`, change `dead = append(dead, w)` to:

```go
			dead = append(dead, cloneWorker(w))
```

In `GetLeader`, change the final `return w, nil` to:

```go
	return cloneWorker(w), nil
```

**Sqlite** (`store/sqlite/cluster.go`), directly after `HeartbeatWorker` (ends line 60):

```go
// GetWorker returns one registered worker.
func (s *Store) GetWorker(ctx context.Context, workerID id.WorkerID) (*cluster.Worker, error) {
	m := new(workerModel)
	err := s.sdb.NewSelect(m).
		Where("id = ?", workerID.String()).
		Limit(1).
		Scan(ctx)
	if err != nil {
		if isNoRows(err) {
			return nil, dispatch.ErrWorkerNotFound
		}
		return nil, fmt.Errorf("dispatch/sqlite: get worker: %w", err)
	}
	return fromWorkerModel(m)
}
```

**Postgres** (`store/postgres/cluster.go`), directly after `HeartbeatWorker` (ends line 59):

```go
// GetWorker returns one registered worker.
func (s *Store) GetWorker(ctx context.Context, workerID id.WorkerID) (*cluster.Worker, error) {
	m := new(workerModel)
	err := s.pgdb.NewSelect(m).
		Where("id = ?", workerID.String()).
		Limit(1).
		Scan(ctx)
	if err != nil {
		if isNoRows(err) {
			return nil, dispatch.ErrWorkerNotFound
		}
		return nil, fmt.Errorf(errPrefix+"get worker: %w", err)
	}
	return fromWorkerModel(m)
}
```

**Mongo** (`store/mongo/cluster.go`), directly after `HeartbeatWorker` (ends line 77, before the `HeartbeatWorkers` doc):

```go
// GetWorker returns one registered worker.
func (s *Store) GetWorker(ctx context.Context, workerID id.WorkerID) (*cluster.Worker, error) {
	var m workerModel
	err := s.mdb.Collection(colWorkers).
		FindOne(ctx, bson.M{"_id": workerID.String()}).
		Decode(&m)
	if err != nil {
		if isNoDocuments(err) {
			return nil, dispatch.ErrWorkerNotFound
		}
		return nil, fmt.Errorf("dispatch/mongo: get worker: %w", err)
	}
	return fromWorkerModel(&m)
}
```

**Redis** (`store/redis/cluster.go`), directly after `HeartbeatWorker` (ends line 116):

```go
// GetWorker returns one registered worker.
func (s *Store) GetWorker(ctx context.Context, workerID id.WorkerID) (*cluster.Worker, error) {
	var e workerEntity
	if err := s.getEntity(ctx, s.keys.worker(workerID.String()), &e); err != nil {
		if isNotFound(err) {
			return nil, dispatch.ErrWorkerNotFound
		}
		return nil, fmt.Errorf("dispatch/redis: get worker: %w", err)
	}
	return fromWorkerEntity(&e)
}
```

**k8s** (`cluster/k8s/provider.go`), directly after `HeartbeatWorker` (ends line 126):

```go
// GetWorker returns the worker whose Pod carries the given worker-id
// annotation.
func (p *Provider) GetWorker(ctx context.Context, workerID id.WorkerID) (*cluster.Worker, error) {
	pod, err := p.findPodByWorkerID(ctx, workerID.String())
	if err != nil {
		return nil, err
	}
	if pod == nil {
		return nil, dispatch.ErrWorkerNotFound
	}
	return p.workerFromPod(pod)
}
```

No other type implements `cluster.Store`: `grep -rn 'func (.*) DeleteStaleWorkers' --include='*.go' .` lists exactly these six, and the one test fake (`errCluster` in `engine/resource_test.go`) embeds `*memory.Store`.

Run: `go build ./... && go test -race ./store/memory/ -run TestClusterSuite`
Expected: build succeeds, `ok`. Memory already round-tripped every field; the suite is now in place for the others.

- [ ] **Step 5: Run the suite on the other backends and the k8s provider, and see capacity fail**

Create `store/sqlite/cluster_test.go`:

```go
package sqlite_test

import (
	"testing"

	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/store/storetest"
)

func TestClusterSuite(t *testing.T) {
	// openSqliteStore (reap_test.go) opens a migrated store in a per-test
	// temp directory, so every case gets its own database.
	storetest.RunClusterSuite(t, func(t *testing.T) cluster.Store {
		t.Helper()

		return openSqliteStore(t)
	})
}
```

Create `store/postgres/cluster_test.go`:

```go
//go:build integration

package postgres_test

import (
	"testing"

	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/store/storetest"
)

func TestClusterSuite(t *testing.T) {
	// One container for every case: the suite isolates by worker ID.
	shared := setupTestStore(t)

	storetest.RunClusterSuite(t, func(t *testing.T) cluster.Store {
		t.Helper()

		return shared
	})
}
```

Create `store/mongo/cluster_test.go` (the mongo tests carry no build tag; `startMongo` skips under `-short`):

```go
package mongo_test

import (
	"context"
	"testing"

	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/store/storetest"
)

func TestClusterSuite(t *testing.T) {
	// One container for every case: the suite isolates by worker ID.
	// Migrate so the worker indexes, the partial unique leader index
	// among them, are in force the way they are in production.
	shared := openStore(t, startMongo(t))
	if err := shared.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	storetest.RunClusterSuite(t, func(t *testing.T) cluster.Store {
		t.Helper()

		return shared
	})
}
```

Create `store/redis/cluster_test.go` (Step 9 adds a second test to this file):

```go
//go:build integration

package redis_test

import (
	"testing"

	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/store/storetest"
)

func TestClusterSuite(t *testing.T) {
	// One container for every case: the suite isolates by worker ID.
	shared := setupTestStore(t)

	storetest.RunClusterSuite(t, func(t *testing.T) cluster.Store {
		t.Helper()

		return shared
	})
}
```

The suite cannot run on the k8s provider: `RegisterWorker` annotates an existing Pod named after `Hostname`, and the suite's workers have no Pod. Create `cluster/k8s/get_worker_test.go` instead, using the package's fake-clientset helpers from `provider_test.go`:

```go
package k8s

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
)

// The shared cluster suite cannot run here: RegisterWorker annotates an
// existing Pod named after the worker's Hostname, and the suite's
// workers have no Pod. These two cases pin GetWorker directly.

func TestGetWorker(t *testing.T) {
	p, _ := newTestProvider(t, makeWorkerPod("get-pod"), makeWorkerPod("other-pod"))
	ctx := context.Background()

	want := makeWorker(t, "get-pod")
	if err := p.RegisterWorker(ctx, want); err != nil {
		t.Fatalf("RegisterWorker: %v", err)
	}
	if err := p.RegisterWorker(ctx, makeWorker(t, "other-pod")); err != nil {
		t.Fatalf("RegisterWorker other: %v", err)
	}

	got, err := p.GetWorker(ctx, want.ID)
	if err != nil {
		t.Fatalf("GetWorker: %v", err)
	}
	if got.ID.String() != want.ID.String() || got.Hostname != "get-pod" {
		t.Fatalf("GetWorker = %s on %q, want %s on %q", got.ID, got.Hostname, want.ID, "get-pod")
	}
	if got.Metadata["zone"] != "us-east-1" {
		t.Errorf("Metadata = %v, want zone us-east-1", got.Metadata)
	}
}

func TestGetWorker_NotFound(t *testing.T) {
	p, _ := newTestProvider(t, makeWorkerPod("lonely-pod"))

	_, err := p.GetWorker(context.Background(), id.NewWorkerID())
	if !errors.Is(err, dispatch.ErrWorkerNotFound) {
		t.Fatalf("GetWorker(unknown) error = %v, want dispatch.ErrWorkerNotFound", err)
	}
}
```

Run:

```bash
go test ./cluster/k8s/
for b in sqlite postgres mongo redis; do
  go test -tags integration ./store/$b/ -run TestClusterSuite 2>&1 | grep -E '^(ok|FAIL|\s+---|\s+cluster.go)'
done
```

Expected: `ok` for `cluster/k8s`, then the same failure on each of the four backends, and only this one. Every heartbeat and not-found case already passes, which is the finding: all five stores already return `ErrWorkerNotFound` for a missing row.

```
    --- FAIL: TestClusterSuite/GetWorkerRoundTripsEveryField
        cluster.go:117: Capacity = map[], want map[cpu:4000 fpga:2 memory:8589934592]
    --- FAIL: TestClusterSuite/ReregisterReplacesCapacity
        cluster.go:157: Capacity after re-register = map[], want map[memory:2147483648]
FAIL
```

- [ ] **Step 6: Persist capacity on sqlite**

In `store/sqlite/models.go`, replace `workerModel`, `toWorkerModel` and `fromWorkerModel` (lines 519-567, from `type workerModel struct {` to the end of `fromWorkerModel`) with:

```go
type workerModel struct {
	grove.BaseModel `grove:"table:dispatch_workers"`

	ID          string    `grove:"id,pk"`
	Hostname    string    `grove:"hostname,notnull"`
	Queues      string    `grove:"queues,notnull,default:'[]'"`
	Concurrency int       `grove:"concurrency,notnull,default:10"`
	State       string    `grove:"state,notnull,default:'active'"`
	IsLeader    bool      `grove:"is_leader,notnull,default:false"`
	LeaderUntil *string   `grove:"leader_until"`
	LastSeen    time.Time `grove:"last_seen,notnull"`
	Metadata    string    `grove:"metadata,notnull,default:'{}'"`
	CreatedAt   time.Time `grove:"created_at,notnull"`

	// Capacity uses the nullable TEXT encoding jobModel's resource sets
	// use: resource.EncodeSetString writes NULL for a zero Set, so a
	// worker that advertised nothing reads back as a nil Set.
	Capacity *string `grove:"capacity"`
}

func toWorkerModel(w *cluster.Worker) (*workerModel, error) {
	capacity, err := resource.EncodeSetString(w.Capacity)
	if err != nil {
		return nil, fmt.Errorf("dispatch/sqlite: encode worker capacity: %w", err)
	}

	return &workerModel{
		ID:          w.ID.String(),
		Hostname:    w.Hostname,
		Queues:      stringsToJSON(w.Queues),
		Concurrency: w.Concurrency,
		State:       string(w.State),
		IsLeader:    w.IsLeader,
		LeaderUntil: timeToStr(w.LeaderUntil),
		LastSeen:    w.LastSeen,
		Metadata:    mapToJSON(w.Metadata),
		CreatedAt:   w.CreatedAt,
		Capacity:    capacity,
	}, nil
}

func fromWorkerModel(m *workerModel) (*cluster.Worker, error) {
	parsedID, err := id.ParseWorkerID(m.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/sqlite: parse worker id %q: %w", m.ID, err)
	}

	capacity, err := resource.DecodeSetString(m.Capacity)
	if err != nil {
		return nil, fmt.Errorf("dispatch/sqlite: decode worker capacity: %w", err)
	}

	return &cluster.Worker{
		ID:          parsedID,
		Hostname:    m.Hostname,
		Queues:      jsonToStrings(m.Queues),
		Concurrency: m.Concurrency,
		State:       cluster.WorkerState(m.State),
		Capacity:    capacity,
		IsLeader:    m.IsLeader,
		LeaderUntil: strToTime(m.LeaderUntil),
		LastSeen:    m.LastSeen,
		Metadata:    jsonToMap(m.Metadata),
		CreatedAt:   m.CreatedAt,
	}, nil
}
```

`models.go` already imports `resource`. In `store/sqlite/cluster.go`, replace `RegisterWorker`'s body down to `if err != nil {` (lines 15-26) so it handles the new error and updates capacity on conflict:

```go
func (s *Store) RegisterWorker(ctx context.Context, w *cluster.Worker) error {
	m, err := toWorkerModel(w)
	if err != nil {
		return err
	}
	_, err = s.sdb.NewInsert(m).
		OnConflict("(id) DO UPDATE").
		Set("hostname = EXCLUDED.hostname").
		Set("queues = EXCLUDED.queues").
		Set("concurrency = EXCLUDED.concurrency").
		Set("state = EXCLUDED.state").
		Set("capacity = EXCLUDED.capacity").
		Set("last_seen = EXCLUDED.last_seen").
		Set("metadata = EXCLUDED.metadata").
		Exec(ctx)
	if err != nil {
```

(the two lines after it, `return fmt.Errorf("dispatch/sqlite: register worker: %w", err)` and the closing braces, stay as they are).

In `store/sqlite/migrations.go`, append a migration as the last entry in `Migrations.MustRegister(...)`: directly after the `dlq_job_execution_columns` migration's closing `},` (line 616) and before the `)` that closes `MustRegister` (line 617). If an earlier task appended its own migration after `dlq_job_execution_columns`, go after that one: this must be the last entry.

```go
		// cluster.Worker.Capacity had no column, so every worker read back
		// with an empty capacity and the enqueue-time fleet check, which
		// takes the largest capacity among live workers, never saw one.
		&migrate.Migration{
			Name:    "worker_capacity_column",
			Version: "20261008120000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// Guarded like every other ADD COLUMN here: SQLite has no
				// ADD COLUMN IF NOT EXISTS, and grove runs Up outside a
				// transaction. Nullable TEXT, matching the resource sets on
				// dispatch_jobs and dispatch_dlq.
				return addColumnIfMissing(ctx, exec, "dispatch_workers", "capacity", `TEXT`)
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				return dropColumnIfPresent(ctx, exec, "dispatch_workers", "capacity")
			},
		},
```

Run: `go test ./store/sqlite/`
Expected: `ok` (the whole package, so the existing migration tests run against the new entry too).

- [ ] **Step 7: Persist capacity on postgres**

In `store/postgres/models.go`, replace `workerModel`, `toWorkerModel` and `fromWorkerModel` (lines 510-558) with:

```go
type workerModel struct {
	grove.BaseModel `grove:"table:dispatch_workers"`

	ID          string            `grove:"id,pk"`
	Hostname    string            `grove:"hostname,notnull"`
	Queues      []string          `grove:"queues,array"`
	Concurrency int               `grove:"concurrency,notnull,default:10"`
	State       string            `grove:"state,notnull,default:'active'"`
	IsLeader    bool              `grove:"is_leader,notnull,default:false"`
	LeaderUntil *time.Time        `grove:"leader_until"`
	LastSeen    time.Time         `grove:"last_seen,notnull,default:current_timestamp"`
	Metadata    map[string]string `grove:"metadata,type:jsonb"`
	CreatedAt   time.Time         `grove:"created_at,notnull,default:current_timestamp"`

	// Capacity uses the jsonb codec jobModel's resource sets use:
	// resource.EncodeSet writes NULL for a zero Set, so a worker that
	// advertised nothing reads back as a nil Set.
	Capacity []byte `grove:"capacity,type:jsonb"`
}

func toWorkerModel(w *cluster.Worker) (*workerModel, error) {
	capacity, err := resource.EncodeSet(w.Capacity)
	if err != nil {
		return nil, fmt.Errorf(errPrefix+"encode worker capacity: %w", err)
	}

	return &workerModel{
		ID:          w.ID.String(),
		Hostname:    w.Hostname,
		Queues:      w.Queues,
		Concurrency: w.Concurrency,
		State:       string(w.State),
		IsLeader:    w.IsLeader,
		LeaderUntil: w.LeaderUntil,
		LastSeen:    w.LastSeen,
		Metadata:    w.Metadata,
		CreatedAt:   w.CreatedAt,
		Capacity:    capacity,
	}, nil
}

func fromWorkerModel(m *workerModel) (*cluster.Worker, error) {
	parsedID, err := id.ParseWorkerID(m.ID)
	if err != nil {
		return nil, fmt.Errorf(errPrefix+"parse worker id %q: %w", m.ID, err)
	}

	capacity, err := resource.DecodeSet(m.Capacity)
	if err != nil {
		return nil, fmt.Errorf(errPrefix+"decode worker capacity: %w", err)
	}

	return &cluster.Worker{
		ID:          parsedID,
		Hostname:    m.Hostname,
		Queues:      m.Queues,
		Concurrency: m.Concurrency,
		State:       cluster.WorkerState(m.State),
		Capacity:    capacity,
		IsLeader:    m.IsLeader,
		LeaderUntil: m.LeaderUntil,
		LastSeen:    m.LastSeen,
		Metadata:    m.Metadata,
		CreatedAt:   m.CreatedAt,
	}, nil
}
```

In `store/postgres/cluster.go`, replace `RegisterWorker` from its signature to `if err != nil {` (lines 15-26) with:

```go
func (s *Store) RegisterWorker(ctx context.Context, w *cluster.Worker) error {
	m, err := toWorkerModel(w)
	if err != nil {
		return err
	}
	_, err = s.pgdb.NewInsert(m).
		OnConflict("(id) DO UPDATE").
		Set("hostname = EXCLUDED.hostname").
		Set("queues = EXCLUDED.queues").
		Set("concurrency = EXCLUDED.concurrency").
		Set("state = EXCLUDED.state").
		Set("capacity = EXCLUDED.capacity").
		Set("last_seen = EXCLUDED.last_seen").
		Set("metadata = EXCLUDED.metadata").
		Exec(ctx)
	if err != nil {
```

In `store/postgres/migrations.go`, append as the last entry in `Migrations.MustRegister(...)`: directly after the `dlq_job_execution_columns` migration's closing `},` (line 691, after its `Down` that ends `DROP COLUMN IF EXISTS primary_input_hash`)`) and before the `)` on line 692. As with sqlite, if an earlier task appended a migration there, go after it.

```go
		// cluster.Worker.Capacity had no column, so every worker read back
		// with an empty capacity and the enqueue-time fleet check, which
		// takes the largest capacity among live workers, never saw one.
		&migrate.Migration{
			Name:    "worker_capacity_column",
			Version: "20261008120000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// Under the lock timeout for the reason given on
				// job_resource_columns. A nullable column with no default
				// is a catalog update, not a table rewrite, and every
				// running worker heartbeats this table, so a long wait for
				// its lock would stall them all.
				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_workers
						ADD COLUMN IF NOT EXISTS capacity JSONB`)
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_workers
						DROP COLUMN IF EXISTS capacity`)
			},
		},
```

Run: `go test -tags integration ./store/postgres/ -run 'TestClusterSuite|TestStore_MigrateIdempotent'`
Expected: `ok`.

- [ ] **Step 8: Persist capacity on mongo**

In `store/mongo/models.go`, replace `workerModel`, `toWorkerModel` and `fromWorkerModel` (lines 512-560) with:

```go
type workerModel struct {
	grove.BaseModel `grove:"table:dispatch_workers"`

	ID          string            `grove:"id,pk"          bson:"_id"`
	Hostname    string            `grove:"hostname,notnull" bson:"hostname"`
	Queues      []string          `grove:"queues"         bson:"queues"`
	Concurrency int               `grove:"concurrency,notnull" bson:"concurrency"`
	State       string            `grove:"state,notnull"  bson:"state"`
	IsLeader    bool              `grove:"is_leader,notnull" bson:"is_leader"`
	LeaderUntil *time.Time        `grove:"leader_until"   bson:"leader_until,omitempty"`
	LastSeen    time.Time         `grove:"last_seen,notnull" bson:"last_seen"`
	Metadata    map[string]string `grove:"metadata"       bson:"metadata,omitempty"`
	CreatedAt   time.Time         `grove:"created_at,notnull" bson:"created_at"`

	// Capacity is a native BSON subdocument, as the resource sets on
	// jobModel are. A zero Set is stored as null and reads back as nil.
	Capacity resource.Set `grove:"capacity" bson:"capacity,omitempty"`
}

func toWorkerModel(w *cluster.Worker) *workerModel {
	m := &workerModel{
		ID:          w.ID.String(),
		Hostname:    w.Hostname,
		Queues:      w.Queues,
		Concurrency: w.Concurrency,
		State:       string(w.State),
		IsLeader:    w.IsLeader,
		LeaderUntil: w.LeaderUntil,
		LastSeen:    w.LastSeen,
		Metadata:    w.Metadata,
		CreatedAt:   w.CreatedAt,
	}

	// Left nil for a zero Set, for the reason toJobModel gives: nil is
	// what reads back, never an empty subdocument.
	if !w.Capacity.IsZero() {
		m.Capacity = w.Capacity
	}

	return m
}

func fromWorkerModel(m *workerModel) (*cluster.Worker, error) {
	parsedID, err := id.ParseWorkerID(m.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/mongo: parse worker id %q: %w", m.ID, err)
	}

	return &cluster.Worker{
		ID:          parsedID,
		Hostname:    m.Hostname,
		Queues:      m.Queues,
		Concurrency: m.Concurrency,
		State:       cluster.WorkerState(m.State),
		Capacity:    m.Capacity,
		IsLeader:    m.IsLeader,
		LeaderUntil: m.LeaderUntil,
		LastSeen:    m.LastSeen,
		Metadata:    m.Metadata,
		CreatedAt:   m.CreatedAt,
	}, nil
}
```

`RegisterWorker` in `store/mongo/cluster.go` upserts through an explicit `$set`, so the field has to be named there too. After the `"created_at":   m.CreatedAt,` line (line 34), add:

```go
			"capacity":     m.Capacity,
```

Mongo is schemaless; no migration.

Run: `go test ./store/mongo/ -run TestClusterSuite`
Expected: `ok`. If it finishes in under two seconds, the container did not start and the test skipped (`startMongo` skips when Docker is unavailable): check `docker info` and rerun with `-count=1`.

- [ ] **Step 9: Persist capacity on redis, and close the heartbeat index gap**

Redis `HeartbeatWorker` reads the entity and writes it back in two round trips. `DeleteStaleWorkers` deletes both the entity and its `worker_ids` member. A sweep that lands between the heartbeat's read and write leaves the entity back but the member gone. From then on every heartbeat succeeds against a row `ListWorkers` cannot see, the engine never gets the `ErrWorkerNotFound` it re-registers on (Task 6b), and the worker drops off the dashboard while it is still running. Once 6b makes heartbeats real, this is a live race against every other instance's startup sweep.

Append to `store/redis/cluster_test.go`, and widen its imports to:

```go
import (
	"context"
	"testing"
	"time"

	"github.com/xraph/grove/kv/drivers/redisdriver"

	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/id"
	redisstore "github.com/xraph/dispatch/store/redis"
	"github.com/xraph/dispatch/store/storetest"
)
```

```go
// TestHeartbeatWorker_restoresIndexMembership covers the state a stale
// sweep racing a heartbeat leaves behind. HeartbeatWorker reads the
// entity and writes it back; DeleteStaleWorkers deletes the entity and
// its worker_ids member. If the sweep lands between the heartbeat's read
// and write, the entity comes back without its member, and from then on
// the heartbeat succeeds against a row ListWorkers cannot see, so the
// engine never re-registers and the worker drops off the dashboard while
// it is still running. The heartbeat restores the member, which makes
// that state heal on the next beat.
func TestHeartbeatWorker_restoresIndexMembership(t *testing.T) {
	ctx := context.Background()
	kvStore := setupTestKV(t)
	s := redisstore.New(kvStore)

	w := &cluster.Worker{
		ID:          id.NewWorkerID(),
		Hostname:    "raced",
		Queues:      []string{"default"},
		Concurrency: 1,
		State:       cluster.WorkerActive,
		LastSeen:    time.Now().UTC(),
		CreatedAt:   time.Now().UTC(),
	}
	if err := s.RegisterWorker(ctx, w); err != nil {
		t.Fatalf("register: %v", err)
	}

	// The legacy, unprefixed key: see TestStore_KeyPrefix_emptyPrefixKeepsLegacyKeys.
	client := redisdriver.UnwrapClient(kvStore)
	if err := client.SRem(ctx, "dispatch:worker_ids", w.ID.String()).Err(); err != nil {
		t.Fatalf("drop index member: %v", err)
	}

	if err := s.HeartbeatWorker(ctx, w.ID); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}

	workers, err := s.ListWorkers(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, got := range workers {
		if got.ID.String() == w.ID.String() {
			return
		}
	}
	t.Fatalf("worker %s missing from ListWorkers after a heartbeat; the index member was not restored", w.ID)
}
```

Run: `go test -tags integration ./store/redis/ -run 'TestClusterSuite|TestHeartbeatWorker_restoresIndexMembership' 2>&1 | grep -E '^(ok|FAIL|--- FAIL|\s+---|\s+cluster)'`
Expected: the Step 5 capacity failures, plus:

```
--- FAIL: TestHeartbeatWorker_restoresIndexMembership
    cluster_test.go:75: worker wkr_... missing from ListWorkers after a heartbeat; the index member was not restored
```

Now fix both in `store/redis/cluster.go`. Add `"github.com/xraph/dispatch/resource"` to the imports, after `"github.com/xraph/dispatch/id"`.

Add a field at the end of `workerEntity`, after `CreatedAt   time.Time         `json:"created_at"``:

```go

	// Capacity is the JSON object the job and DLQ entities use for their
	// resource sets; omitempty keeps a zero Set out of the entity, so it
	// reads back as nil.
	Capacity resource.Set `json:"capacity,omitempty"`
```

In `toWorkerEntity`, after `CreatedAt:   w.CreatedAt,` add:

```go
		Capacity:    w.Capacity,
```

In `fromWorkerEntity`, after `State:       cluster.WorkerState(e.State),` add:

```go
		Capacity:    e.Capacity,
```

Redis `RegisterWorker` writes the whole entity, so a re-register replaces capacity with no further change.

Replace `HeartbeatWorker` (lines 102-116, from `// HeartbeatWorker updates the last-seen timestamp for a worker.` to its closing brace) with:

```go
// HeartbeatWorker updates the last-seen timestamp for a worker.
//
// The read and the write are two round trips, so a DeleteStaleWorkers
// that lands between them deletes the entity and its worker_ids member,
// then the write puts the entity back alone. Re-adding the member here
// heals that: without it the heartbeat keeps succeeding against a worker
// ListWorkers cannot see, and the engine, which re-registers only on
// ErrWorkerNotFound, never notices. SAdd of an existing member is a no-op.
func (s *Store) HeartbeatWorker(ctx context.Context, workerID id.WorkerID) error {
	wID := workerID.String()
	key := s.keys.worker(wID)

	var e workerEntity
	if err := s.getEntity(ctx, key, &e); err != nil {
		if isNotFound(err) {
			return dispatch.ErrWorkerNotFound
		}
		return fmt.Errorf("dispatch/redis: heartbeat get: %w", err)
	}

	e.LastSeen = now()
	if err := s.setEntity(ctx, key, &e); err != nil {
		return fmt.Errorf("dispatch/redis: heartbeat set: %w", err)
	}

	if err := s.rdb.SAdd(ctx, s.keys.workerIDs(), wID).Err(); err != nil {
		return fmt.Errorf("dispatch/redis: heartbeat index: %w", err)
	}
	return nil
}
```

Leave the `GetWorker` added in Step 4 directly after it.

Run the same command again.
Expected: `ok`.

- [ ] **Step 10: Correct the engine comments that say capacity does not round-trip**

Three comments describe the state this task just changed. They are comments only; behaviour is untouched.

In `engine/engine.go`, in the `WithWorkerCapacity` doc, replace this paragraph (lines 235-244):

```go
// The check cannot derive the fleet maximum for itself, because
// cluster.Worker.Capacity does not round-trip. Only store/memory carries
// it; postgres, sqlite, mongo, redis and the k8s provider all enumerate
// worker fields by hand and drop it, so a worker registered with
// {memory: 64GiB} reads back an empty map. MaxWorkerCapacity therefore
// sees this value and — on memory alone — whatever live workers
// published, never the real fleet maximum. Persisting Capacity in those
// four models would make the derivation honest and is tracked as
// follow-up work; until then, declaring the ceiling is the operator's
// job or the check stays off.
```

with:

```go
// The check cannot derive the fleet maximum for itself. Every store
// backend now persists cluster.Worker.Capacity (the k8s provider still
// drops it), but a worker's row carries only what that worker passed
// here, so a fleet in which nobody declared reads back with no capacity
// at all. MaxWorkerCapacity therefore starts from this value and lets
// live workers' published capacities raise it, never lower it.
// Declaring the ceiling is the operator's job, or the check stays off.
```

In `Build`, inside the `if eng.resources != nil` block (line 516), change:

```go
		// does not round-trip on four of the five backends, nothing could
```

to:

```go
		// did not then round-trip on four of the five backends, nothing could
```

In `engine/resource.go`, in the `MaxWorkerCapacity` doc (lines 271-276), replace:

```go
// gate is the whole correctness argument. The registry cannot supply the
// fleet maximum on its own: cluster.Worker.Capacity round-trips only on
// store/memory — postgres, sqlite, mongo, redis and the k8s provider all
// enumerate worker fields by hand and drop it — so a fleet whose largest
// worker has 64 GiB reads back as a fleet of workers with no capacity at
// all. Deriving the ceiling from whatever this process happens to know
```

with:

```go
// gate is the whole correctness argument. The registry cannot supply the
// fleet maximum on its own: a worker's row carries only the capacity
// that worker declared through WithWorkerCapacity (and the k8s provider
// does not persist it at all), so a fleet whose largest worker has
// 64 GiB but declared nothing reads back as a fleet of workers with no
// capacity. Deriving the ceiling from whatever this process happens to know
```

- [ ] **Step 11: Gate**

```bash
go build ./... && go test ./... 2>&1 | grep -E '^(FAIL|--- FAIL|panic)'
for b in memory sqlite postgres mongo redis; do
  go test -count=1 -race -tags integration ./store/$b/... 2>&1 | grep -E '^(ok|FAIL|--- FAIL|panic)'
done
go test -race ./cluster/...
C=$(mktemp -d)
GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...
GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...
rm -rf $C
```

Expected: no output from the first `grep`; `ok` for all five store packages and `cluster/k8s`; `0 issues.` from the first lint run. The second lint run (the repo config has no build tags, so integration files are only linted here) reports exactly one issue, and it is not in this task's files:

```
store/redis/store_test.go:54:5: shadow: declaration of "err" shadows declaration at line 36 (govet)
```

It is in `setupTestKV` and predates this task. Leave it. Any other issue is yours.

Checked on 2026-10-07: postgres ok in 263s under `-race`, redis 37s, mongo 21s, sqlite 31s. `--allow-parallel-runners` is there because other checkouts on this machine run golangci-lint at the same time and the second one otherwise exits with "parallel golangci-lint is running". If Docker restarts mid-run, every container test fails at 0.00s with `rootless Docker not found`; rerun once `docker info` answers. Mongo instead skips silently and `go test` caches that as `ok`, hence `-count=1`.

- [ ] **Step 12: Commit**

```bash
git add store/storetest/cluster.go store/memory/cluster_test.go store/sqlite/cluster_test.go \
  store/postgres/cluster_test.go store/mongo/cluster_test.go store/redis/cluster_test.go \
  cluster/k8s/get_worker_test.go
git commit --only -m "feat(cluster): persist worker capacity and read a worker back

Postgres, sqlite, mongo and redis dropped cluster.Worker.Capacity on
write, so every worker read back with no capacity and only the memory
store told the truth. Each backend now stores it the way it stores a
job's resource set, with a new capacity column on dispatch_workers for
the two SQL stores. GetWorker reads one row by ID.

store/storetest gains RunClusterSuite and every backend runs it. It pins
what the engine heartbeat will rely on: a heartbeat or a read against a
missing row returns ErrWorkerNotFound. Redis now re-adds the worker to
its index on each heartbeat, because a stale sweep landing between the
heartbeat's read and write left a row ListWorkers could not see. The
memory store copies workers in and out, since a heartbeat will write
one while other goroutines read it." -- \
  cluster/store.go cluster/k8s/provider.go cluster/k8s/get_worker_test.go \
  store/storetest/cluster.go \
  store/memory/store.go store/memory/cluster_test.go \
  store/sqlite/models.go store/sqlite/cluster.go store/sqlite/migrations.go store/sqlite/cluster_test.go \
  store/postgres/models.go store/postgres/cluster.go store/postgres/migrations.go store/postgres/cluster_test.go \
  store/mongo/models.go store/mongo/cluster.go store/mongo/cluster_test.go \
  store/redis/cluster.go store/redis/cluster_test.go \
  engine/engine.go engine/resource.go
git show --stat HEAD | tail -23
```

Expected: 21 files changed (7 new).

Note for later tasks: the k8s provider still drops `Capacity`. Its annotations are written field by field in `setWorkerAnnotations`, read in `workerFromPod`, and stripped in `removeWorkerAnnotations`; a `capacity` annotation holding `resource.EncodeSet` JSON would close it in three places. It was out of scope here.

---

### Task 6b: The engine keeps its worker row alive

`engine.Build` registers the worker row once (`engine/engine.go` around line 578) and nothing ever refreshes it: `cluster.Store.HeartbeatWorker` has no production caller. `LastSeen` is the registration time forever. Every instance runs `DeleteStaleWorkers(max(5m, 5*heartbeat))` at startup (`extension/extension.go` around line 320), so five minutes after a worker starts, the next instance to start deletes its row, the leader's included. `engine.MaxWorkerCapacity` (`engine/resource.go` around line 321) also stops counting a worker once its `LastSeen` passes the same threshold. This task adds the heartbeat. It keeps the Build-time registration, beats once at `Start` and every `HeartbeatInterval` after, and registers the row again when a beat finds it gone.

Nothing writes `WorkerDraining` or `WorkerDead`, and this task does not start.

**Files:**
- Create: `engine/heartbeat.go`
- Modify: `engine/engine.go` (`Engine` struct after line 114; `Build` lines 583-595; `Start` before its final `return nil`, line 755; `Stop` before the deregister at line 766)
- Test: `engine/heartbeat_test.go`

**Interfaces:**
- Consumes: `cluster.Store.HeartbeatWorker` returning `dispatch.ErrWorkerNotFound` for a missing row (pinned by Task 6a's suite on every backend), `cluster.Store.GetWorker` (tests only), `dispatch.WithHeartbeatInterval`, `engine.WithWorkerCapacity`.
- Produces: no new exported API. `Engine.Start` now runs a goroutine that `Engine.Stop` ends before it deregisters the worker.

- [ ] **Step 1: Write the failing tests**

Create `engine/heartbeat_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/resource"
	"github.com/xraph/dispatch/store/memory"
)

// heartbeatInterval is short so the tests see several beats quickly. Each
// test polls with a deadline rather than sleeping a fixed time.
const heartbeatInterval = 20 * time.Millisecond

// buildHeartbeatEngine builds an engine on a fresh memory store with a
// short heartbeat interval and stops it when the test ends. Build has
// already registered the worker row; nothing has started.
func buildHeartbeatEngine(t *testing.T) (*engine.Engine, *memory.Store) {
	t.Helper()

	s := memory.New()
	d, err := dispatch.New(
		dispatch.WithStore(s),
		dispatch.WithConcurrency(1),
		dispatch.WithQueues([]string{"default", "render"}),
		dispatch.WithHeartbeatInterval(heartbeatInterval),
	)
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}

	eng, err := engine.Build(d, engine.WithWorkerCapacity(resource.Set{resource.Memory: 4 << 30}))
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}
	t.Cleanup(func() { _ = eng.Stop(context.Background()) })

	return eng, s
}

// waitForWorker polls the store until cond holds for the engine's row, or
// fails the test after five seconds. A missing row is passed to cond as
// nil.
func waitForWorker(t *testing.T, s *memory.Store, eng *engine.Engine, what string, cond func(*cluster.Worker) bool) *cluster.Worker {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		w, err := s.GetWorker(context.Background(), eng.WorkerID())
		if err != nil && !errors.Is(err, dispatch.ErrWorkerNotFound) {
			t.Fatalf("GetWorker: %v", err)
		}
		if cond(w) {
			return w
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)

	return nil
}

func TestEngine_WorkerHeartbeatAdvancesLastSeen(t *testing.T) {
	eng, s := buildHeartbeatEngine(t)
	ctx := context.Background()

	registered, err := s.GetWorker(ctx, eng.WorkerID())
	if err != nil {
		t.Fatalf("Build did not register the worker row: %v", err)
	}

	if err := eng.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Two advances, not one: Start beats once straight away, so a single
	// advance would pass even if the ticker never fired.
	first := waitForWorker(t, s, eng, "LastSeen to pass the registration time", func(w *cluster.Worker) bool {
		return w != nil && w.LastSeen.After(registered.LastSeen)
	})
	waitForWorker(t, s, eng, "LastSeen to advance a second time", func(w *cluster.Worker) bool {
		return w != nil && w.LastSeen.After(first.LastSeen)
	})
}

// TestEngine_WorkerHeartbeatReregistersDeletedRow is the case the sweep in
// extension.Start makes real: another instance starting up deletes every
// row whose LastSeen is old, and a live worker's row must come back.
func TestEngine_WorkerHeartbeatReregistersDeletedRow(t *testing.T) {
	eng, s := buildHeartbeatEngine(t)
	ctx := context.Background()

	registered, err := s.GetWorker(ctx, eng.WorkerID())
	if err != nil {
		t.Fatalf("Build did not register the worker row: %v", err)
	}

	if err := eng.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// What another instance's stale sweep does to this row.
	if err := s.DeregisterWorker(ctx, eng.WorkerID()); err != nil {
		t.Fatalf("DeregisterWorker: %v", err)
	}

	back := waitForWorker(t, s, eng, "the heartbeat to register the deleted row again", func(w *cluster.Worker) bool {
		return w != nil
	})

	if back.Hostname != registered.Hostname || back.Concurrency != registered.Concurrency {
		t.Errorf("re-registered row = %q x%d, want %q x%d",
			back.Hostname, back.Concurrency, registered.Hostname, registered.Concurrency)
	}
	if !slices.Equal(back.Queues, registered.Queues) {
		t.Errorf("re-registered Queues = %v, want %v", back.Queues, registered.Queues)
	}
	if back.State != cluster.WorkerActive {
		t.Errorf("re-registered State = %q, want %q", back.State, cluster.WorkerActive)
	}
	if back.Capacity[resource.Memory] != 4<<30 {
		t.Errorf("re-registered Capacity = %v, want 4 GiB of memory", back.Capacity)
	}
	if !back.CreatedAt.Equal(registered.CreatedAt) {
		t.Errorf("re-registered CreatedAt = %v, want the Build-time %v", back.CreatedAt, registered.CreatedAt)
	}
	if back.LastSeen.Before(registered.LastSeen) {
		t.Errorf("re-registered LastSeen = %v, want at or after %v", back.LastSeen, registered.LastSeen)
	}
}

// TestEngine_StopLeavesNoHeartbeatWriting pins the ordering in Stop: the
// heartbeat stops before the row is deregistered, so nothing puts the row
// back afterwards. If the loop outlived Stop, the next beat would see
// ErrWorkerNotFound and register a stopped worker as live.
func TestEngine_StopLeavesNoHeartbeatWriting(t *testing.T) {
	eng, s := buildHeartbeatEngine(t)
	ctx := context.Background()

	if err := eng.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := eng.Stop(ctx); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := eng.Stop(ctx); err != nil {
		t.Fatalf("second Stop: %v", err)
	}

	// Absence can only be shown over time: watch for ten intervals.
	for range 10 {
		if _, err := s.GetWorker(ctx, eng.WorkerID()); !errors.Is(err, dispatch.ErrWorkerNotFound) {
			t.Fatalf("GetWorker after Stop = %v, want dispatch.ErrWorkerNotFound: something is still writing the row", err)
		}
		time.Sleep(heartbeatInterval)
	}
}
```

Stop without Start is already covered: `TestEngine_StopTwiceClosesExecutorsOnce` in `engine/double_stop_test.go` builds with `startEngine`, which never calls `Start`, then calls `Stop` twice.

- [ ] **Step 2: Run them to see them fail**

Run: `go test -race ./engine/ -run 'TestEngine_WorkerHeartbeat|TestEngine_StopLeavesNoHeartbeatWriting'`
Expected:

```
--- FAIL: TestEngine_WorkerHeartbeatAdvancesLastSeen (5.00s)
    heartbeat_test.go:84: timed out waiting for LastSeen to pass the registration time
--- FAIL: TestEngine_WorkerHeartbeatReregistersDeletedRow (5.01s)
    heartbeat_test.go:113: timed out waiting for the heartbeat to register the deleted row again
FAIL
```

`TestEngine_StopLeavesNoHeartbeatWriting` passes now because nothing writes the row at all. It guards the implementation: with the heartbeat in place and the `stopHeartbeat` call removed from `Stop`, it fails with `GetWorker after Stop = <nil>, want dispatch.ErrWorkerNotFound` (checked on 2026-10-07).

- [ ] **Step 3: Write the heartbeat**

Create `engine/heartbeat.go`:

```go
package engine

import (
	"context"
	"errors"
	"slices"
	"time"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cluster"
)

// defaultWorkerHeartbeat is the row heartbeat's interval when
// dispatch.Config.HeartbeatInterval is zero or negative. Zero there turns
// off job lease heartbeats; it is not a request to let this worker's row
// go stale, which would get it swept by the next instance to start and
// drop its capacity out of the fleet check.
const defaultWorkerHeartbeat = 10 * time.Second

// workerRow returns the cluster row this engine registers for itself: the
// fields Build computed, with LastSeen set to now. CreatedAt stays the
// Build-time value, so a row registered again after a sweep still says
// when this process came up.
func (eng *Engine) workerRow() *cluster.Worker {
	w := eng.self
	w.Queues = slices.Clone(eng.self.Queues)
	w.Capacity = eng.self.Capacity.Clone()
	w.LastSeen = time.Now().UTC()

	return &w
}

// workerHeartbeatInterval is how often the row heartbeat runs.
func (eng *Engine) workerHeartbeatInterval() time.Duration {
	if hb := eng.d.Config().HeartbeatInterval; hb > 0 {
		return hb
	}

	return defaultWorkerHeartbeat
}

// startHeartbeat keeps this worker's cluster row alive until
// stopHeartbeat.
//
// Build registers the row once. Without this loop its LastSeen is the
// registration time forever, so after five minutes the stale sweep every
// instance runs at startup deletes it, the leader's included, and the
// enqueue-time capacity check stops counting it. The loop beats once
// straight away, then every interval.
//
// The loop's context is detached from ctx: Start's caller may cancel ctx
// once Start returns, and the row must outlive that. Only stopHeartbeat
// ends it. A second Start while the loop runs is a no-op.
func (eng *Engine) startHeartbeat(ctx context.Context) {
	eng.heartbeatMu.Lock()
	defer eng.heartbeatMu.Unlock()

	if eng.heartbeatCancel != nil {
		return
	}

	hbCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	done := make(chan struct{})
	eng.heartbeatCancel = cancel
	eng.heartbeatDone = done

	interval := eng.workerHeartbeatInterval()

	go func() {
		defer close(done)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		eng.beat(hbCtx, interval)

		for {
			select {
			case <-hbCtx.Done():
				return
			case <-ticker.C:
				eng.beat(hbCtx, interval)
			}
		}
	}()
}

// stopHeartbeat ends the loop and waits for it to exit, or for ctx to
// end, whichever comes first. Safe when the loop never started and safe
// to call twice.
func (eng *Engine) stopHeartbeat(ctx context.Context) {
	eng.heartbeatMu.Lock()
	cancel, done := eng.heartbeatCancel, eng.heartbeatDone
	eng.heartbeatCancel, eng.heartbeatDone = nil, nil
	eng.heartbeatMu.Unlock()

	if cancel == nil {
		return
	}

	cancel()

	select {
	case <-done:
	case <-ctx.Done():
		eng.logger.Warn("worker heartbeat did not stop before the shutdown deadline",
			log.String("error", ctx.Err().Error()),
		)
	}
}

// beat refreshes the row once. A row that is gone, because another
// instance's stale sweep deleted it or because Build's registration
// failed, is registered again. Any other failure is logged and left to
// the next tick. Each call is bounded by one interval so a hung store
// call cannot stack beats behind it.
func (eng *Engine) beat(ctx context.Context, interval time.Duration) {
	callCtx, cancel := context.WithTimeout(ctx, interval)
	defer cancel()

	err := eng.clusterStore.HeartbeatWorker(callCtx, eng.pool.WorkerID())
	if err == nil || ctx.Err() != nil {
		return
	}

	if !errors.Is(err, dispatch.ErrWorkerNotFound) {
		eng.logger.Warn("worker heartbeat failed",
			log.String("worker_id", eng.pool.WorkerID().String()),
			log.String("error", err.Error()),
		)

		return
	}

	if regErr := eng.clusterStore.RegisterWorker(callCtx, eng.workerRow()); regErr != nil {
		if ctx.Err() == nil {
			eng.logger.Warn("worker row missing and registering it again failed",
				log.String("worker_id", eng.pool.WorkerID().String()),
				log.String("error", regErr.Error()),
			)
		}

		return
	}

	eng.logger.Info("worker row was missing; registered it again",
		log.String("worker_id", eng.pool.WorkerID().String()),
	)
}
```

- [ ] **Step 4: Wire it into the engine**

In `engine/engine.go`, in the `Engine` struct, directly after the cron subsystem fields (line 114, `scheduler    *cron.Scheduler`) and before the `wakeStop` comment, add:

```go

	// self is the cluster row Build registered for this worker. The row
	// heartbeat (heartbeat.go) registers it again from here when another
	// instance's stale sweep has deleted it.
	self cluster.Worker

	// heartbeatCancel and heartbeatDone belong to the running row
	// heartbeat; both are nil when it is not running. heartbeatMu guards
	// them so Start and Stop can race without leaking the goroutine.
	heartbeatMu     sync.Mutex
	heartbeatCancel context.CancelFunc
	heartbeatDone   chan struct{}
```

(`sync` and `context` are already imported.)

In `Build`, under `// Register this worker in the cluster store.`, replace the worker literal and the registration (lines 583-595):

```go
	w := &cluster.Worker{
		ID:          eng.pool.WorkerID(),
		Hostname:    hostname,
		Queues:      config.Queues,
		Concurrency: config.Concurrency,
		Capacity:    eng.workerCapacity.Clone(),
		State:       cluster.WorkerActive,
		LastSeen:    time.Now().UTC(),
		CreatedAt:   time.Now().UTC(),
	}
	if regErr := cls.RegisterWorker(context.Background(), w); regErr != nil {
		logger.Warn("failed to register worker in cluster store", log.String("error", regErr.Error()))
	}
```

with:

```go
	registeredAt := time.Now().UTC()
	eng.self = cluster.Worker{
		ID:          eng.pool.WorkerID(),
		Hostname:    hostname,
		Queues:      config.Queues,
		Concurrency: config.Concurrency,
		Capacity:    eng.workerCapacity.Clone(),
		State:       cluster.WorkerActive,
		LastSeen:    registeredAt,
		CreatedAt:   registeredAt,
	}
	// A failure here is not fatal: the row heartbeat started by Start
	// registers the row on its first beat when it finds it missing.
	if regErr := cls.RegisterWorker(context.Background(), eng.workerRow()); regErr != nil {
		logger.Warn("failed to register worker in cluster store", log.String("error", regErr.Error()))
	}
```

The registration is the same row as before; it is kept on the engine so the heartbeat can register it again.

In `Start`, directly before its final `return nil` (after the wake listener block that ends `eng.wakeStop = stop` / `}` / `}`), add:

```go
	// Keep this worker's cluster row alive. See startHeartbeat.
	eng.startHeartbeat(ctx)

```

It goes last so a `Start` that fails earlier (the scheduler or the dispatcher) leaves no goroutine behind.

In `Stop`, directly after the wake listener block and before `// Deregister this worker from the cluster.`, add:

```go
	// Stop the row heartbeat before deregistering. A beat that ran after
	// the delete would find the row missing and register it again,
	// leaving a stopped worker listed as live until the next sweep.
	eng.stopHeartbeat(ctx)

```

- [ ] **Step 5: Run the tests to see them pass**

Run: `go test -race ./engine/ -run 'TestEngine_WorkerHeartbeat|TestEngine_StopLeavesNoHeartbeatWriting|TestEngine_StopTwice' -v 2>&1 | grep -E '^(---|ok|FAIL)'`
Expected:

```
--- PASS: TestEngine_StopTwiceClosesExecutorsOnce
--- PASS: TestEngine_WorkerHeartbeatAdvancesLastSeen
--- PASS: TestEngine_WorkerHeartbeatReregistersDeletedRow
--- PASS: TestEngine_StopLeavesNoHeartbeatWriting
ok  	github.com/xraph/dispatch/engine
```

- [ ] **Step 6: Gate**

```bash
go build ./... && go test ./... 2>&1 | grep -E '^(FAIL|--- FAIL|panic)'
go test -count=1 -race ./engine/ ./worker/ ./cron/ ./extension/
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: no output from the `grep`, `ok` for the four race packages (about 17s, 9s, 4s and 2s), `0 issues.`

The race run matters here. Every engine test now has a heartbeat goroutine writing the memory store while the pool, the cron scheduler and `MaxWorkerCapacity` read it, which is why Task 6a made the memory store copy workers in and out.

- [ ] **Step 7: Commit**

```bash
git add engine/heartbeat.go engine/heartbeat_test.go
git commit --only -m "feat(engine): keep the worker row alive with a heartbeat

Build registered the worker row once and nothing touched it again, so
LastSeen stayed at the registration time. Five minutes later the next
instance to start swept the row as stale, the leader's included, and
the fleet capacity check stopped counting the worker.

Start now beats the row straight away and then every HeartbeatInterval.
If a beat finds the row gone it registers it again from what Build
recorded. Stop ends the loop before it deregisters, so a stopped worker
doesn't come back." -- engine/engine.go engine/heartbeat.go engine/heartbeat_test.go
git show --stat HEAD | tail -4
```

Expected: 3 files changed (2 new).

---

### Task 7: Fold the list capabilities into `store.Store`

Every backend now implements the four paged reads, so they stop being optional. Embedding them in the aggregate means the contract in slice 3 can take a `store.Store` and call `ListJobs` without a type assertion, and a sixth backend added later cannot compile without them. No backend asserted the aggregate before; this task adds that check for all five.

**Files:**
- Modify: `store/store.go:33-40` (the `Store` interface)
- Create: `store/store_test.go`

**Interfaces:**
- Consumes: `job.Lister`, `workflow.PageLister`, `dlq.PageLister`, `artifact.PageLister` (Task 1), implemented by memory (Task 1), postgres (Task 2), sqlite (Task 3), mongo (Task 4), redis (Task 5).
- Produces: `store.Store` now includes `ListJobs`, `ListRunsPage`, `CountRuns`, `ListDLQPage`, `CountDLQEntries`, `ListArtifactsPage`, and `GetWorker` (from Task 6a, already on `cluster.Store`).

- [ ] **Step 1: Write the failing compile test**

Create `store/store_test.go`:

```go
package store_test

import (
	"github.com/xraph/dispatch/store"
	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/store/mongo"
	"github.com/xraph/dispatch/store/postgres"
	"github.com/xraph/dispatch/store/redis"
	"github.com/xraph/dispatch/store/sqlite"
)

// Every backend must satisfy the whole aggregate, including the paged
// reads the dashboard depends on. Before this file, nothing checked that
// a backend implemented store.Store as one unit; each asserted the
// subsystem interfaces separately, so a capability added to store.Store
// could be missing from one backend until something called it.
var (
	_ store.Store = (*memory.Store)(nil)
	_ store.Store = (*postgres.Store)(nil)
	_ store.Store = (*sqlite.Store)(nil)
	_ store.Store = (*mongo.Store)(nil)
	_ store.Store = (*redis.Store)(nil)
)

// requirePagedReads fails to compile until store.Store carries the paged
// reads: a method value on an interface only exists if the method does.
func requirePagedReads(s store.Store) {
	_ = s.ListJobs
	_ = s.ListRunsPage
	_ = s.CountRuns
	_ = s.ListDLQPage
	_ = s.CountDLQEntries
	_ = s.ListArtifactsPage
	_ = s.GetWorker
}

var _ = requirePagedReads
```

- [ ] **Step 2: Run it to see it fail**

Run: `go vet ./store/`
Expected: compile errors of the form `s.ListJobs undefined (type store.Store has no field or method ListJobs)`, one per paged method. `GetWorker` already compiles, because Task 6a put it on `cluster.Store`.

- [ ] **Step 3: Embed the capabilities**

In `store/store.go`, the interface currently reads:

```go
type Store interface {
	job.Store
	workflow.Store
	cron.Store
	dlq.Store
	event.Store
	cluster.Store
	artifact.Store
```

Change those lines to:

```go
type Store interface {
	job.Store
	job.Lister
	workflow.Store
	workflow.PageLister
	cron.Store
	dlq.Store
	dlq.PageLister
	event.Store
	cluster.Store
	artifact.Store
	artifact.PageLister
```

Leave `Migrate`, `Ping` and `Close` as they are.

- [ ] **Step 4: Run it to see it pass**

Run: `go vet ./store/ && go test ./store/`
Expected: no output from vet, then `ok  	github.com/xraph/dispatch/store` (the package has one compile-only test file, so `[no tests to run]` is also a pass).

- [ ] **Step 5: Gate the whole module**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race ./engine/... ./worker/... ./cron/...
go test -count=1 -race -tags integration ./store/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: no FAIL lines anywhere, `0 issues.`

- [ ] **Step 6: Commit**

```bash
git add store/store_test.go
git commit --only -m "feat(store): make the paged reads part of every store

store.Store now embeds the job, run, dead letter and artifact paged reads,
so anything holding a store can list newest first without asserting a
capability, and a new backend will not compile until it has them. A test
file pins that all five backends satisfy the aggregate as one unit, which
nothing checked before." -- store/store.go store/store_test.go
git show --stat HEAD | tail -4
```

---

---

### Task 8: Index the filtered lists

Tasks 2 to 4 page every list newest first by ID, and none of the filters has an index that ends in `id`. So a filtered page on Postgres or SQLite either walks the primary key backwards and throws away every row that misses the filter, or fetches every match and sorts it. On a big `dispatch_jobs` where the state you asked for is rare, the first plan reads most of the table to fill one page. This task adds one `(filter, id)` index per exact-match filter on all three SQL-shaped backends, so the filter becomes the index condition and rows come back already in ID order.

It also changes Task 2's Postgres `ListJobs`. Postgres can't read a `(state, id)` index in ID order for `state = ANY($1)`, even with a one-element array; it walks the primary key instead (Step 5 shows the plan). So one state is now sent as `state = $1`. SQLite already rewrites a one-value `IN (?)` to equality, and Mongo plans a one-element `$in` as equality, so neither needs a change.

The name prefix filter gets no index on any backend: whatever index serves a prefix (`starts_with` on a C-collation B-tree, SQLite never, an anchored Mongo regex) returns matches in name order, and they would still be sorted by ID. The migrations say so in a comment.

**Files:**
- Create: `store/postgres/list_index_test.go`, `store/sqlite/list_index_test.go`, `store/mongo/list_index_test.go`
- Modify: `store/postgres/migrations.go` (append one migration after `worker_capacity_column`, which ends at line 713, and a new package var after `init`)
- Modify: `store/sqlite/migrations.go` (append one migration after `worker_capacity_column`, which ends at line 633, and a new package var after `init`)
- Modify: `store/postgres/list.go` (`pageQuery` doc lines 24-27; the `States` filter in `ListJobs`, lines 94-100)
- Modify: `store/postgres/dequeue_test.go` (the drop list in `TestDequeueBoundedQueryPlanUsesDequeueIndex`, after line 162)
- Modify: `store/mongo/store.go` (`migrationIndexes`, lines 153-286, and a new function at the end of the file)

Line numbers are from the tree after Task 7. Where a number has drifted, use the quoted anchor text.

**Interfaces:**
- Consumes: `postgres.Store.DB()`, `sqlite.Store`, `mongo.Store.Migrate`, the list methods from Tasks 2 to 4, `grove.DB.Hooks()`, `hook.PostQueryHook` (`AfterQuery(ctx, *hook.QueryContext, any) error`; grove fills `RawQuery` and `RawArgs` before post-query hooks run on both the pg and sqlite drivers).
- Produces: Postgres and SQLite migration `20261008130000` `list_order_indexes`, which creates
  `idx_dispatch_jobs_list_state (state, id)`, `idx_dispatch_jobs_list_queue (queue, id)`, `idx_dispatch_dlq_list_queue (queue, id)`, `idx_dispatch_workflow_runs_list_state (state, id)` and `idx_dispatch_artifacts_list_scope (scope_app_id, id)`. Mongo `Migrate` creates `{state:1,_id:-1}` and `{queue:1,_id:-1}` on `dispatch_jobs`, `{queue:1,_id:-1}` on `dispatch_dlq`, `{state:1,_id:-1}` on `dispatch_workflow_runs` and `{scope_app_id:1,_id:-1}` on `dispatch_artifacts` (default index names). No Go API changes.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- store && git log -1 --oneline`
Expected: no lines for any file this task lists. If another session has uncommitted edits in one of them, stop and report.

Then confirm the Mongo migration path: `grep -rn 'Migrations' --include='*.go' store/mongo | grep -v '^store/mongo/migrations.go'` prints nothing. The grove group in `store/mongo/migrations.go` is never run; `Store.Migrate` in `store/mongo/store.go` creates the indexes from `migrationIndexes()`, so that is where the Mongo indexes go.

- [ ] **Step 2: Write the Postgres tests**

Create `store/postgres/list_index_test.go`:

```go
//go:build integration

package postgres_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/xraph/grove/drivers/pgdriver"
	"github.com/xraph/grove/hook"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/postgres"
	"github.com/xraph/dispatch/store/storetest"
	"github.com/xraph/dispatch/workflow"
)

// listIndex is one index migration list_order_indexes builds, with the
// tail of the definition Postgres reports for it in pg_indexes.
type listIndex struct {
	name, table, def string
}

var listIndexes = []listIndex{
	{"idx_dispatch_jobs_list_state", "dispatch_jobs", "USING btree (state, id)"},
	{"idx_dispatch_jobs_list_queue", "dispatch_jobs", "USING btree (queue, id)"},
	{"idx_dispatch_dlq_list_queue", "dispatch_dlq", "USING btree (queue, id)"},
	{"idx_dispatch_workflow_runs_list_state", "dispatch_workflow_runs", "USING btree (state, id)"},
	{"idx_dispatch_artifacts_list_scope", "dispatch_artifacts", "USING btree (scope_app_id, id)"},
}

// assertListIndexes checks every list index exists on the right table
// with the right columns and is valid. Valid matters because the indexes
// are built CONCURRENTLY, and a failed concurrent build leaves an index
// the planner ignores.
func assertListIndexes(t *testing.T, s *postgres.Store) {
	t.Helper()

	ctx := context.Background()

	conn, err := pgdriver.Unwrap(s.DB()).AcquireConn(ctx)
	if err != nil {
		t.Fatalf("acquire dedicated conn: %v", err)
	}

	defer conn.Release()

	for _, ix := range listIndexes {
		var table, def string

		err = conn.QueryRow(ctx,
			`SELECT tablename, indexdef FROM pg_indexes WHERE indexname = $1`, ix.name,
		).Scan(&table, &def)
		if err != nil {
			t.Errorf("%s: not in pg_indexes: %v", ix.name, err)

			continue
		}

		if table != ix.table || !strings.HasSuffix(def, ix.def) {
			t.Errorf("%s: on %s as %q, want on %s ending %q", ix.name, table, def, ix.table, ix.def)
		}

		if _, valid := indexIsValid(t, conn, ix.name); !valid {
			t.Errorf("%s: INVALID, so the planner ignores it", ix.name)
		}
	}
}

func TestListIndexesExistAfterMigrate(t *testing.T) {
	s := setupTestStore(t)

	assertListIndexes(t, s)
}

// TestListIndexesSurviveASecondMigrate runs the whole group again the
// way every pod start does. Each index is dropped only when INVALID and
// created with IF NOT EXISTS, so a second run must change nothing.
func TestListIndexesSurviveASecondMigrate(t *testing.T) {
	s := setupTestStore(t)

	remigrate(t, s)
	remigrate(t, s)

	assertListIndexes(t, s)
}

// selectCapture records the last SELECT grove built for each table, as
// sent: the SQL with its placeholders and the bound arguments. grove sets
// RawQuery and RawArgs before it runs post-query hooks.
type selectCapture struct {
	mu   sync.Mutex
	last map[string]capturedSelect
}

type capturedSelect struct {
	query string
	args  []any
}

func (c *selectCapture) AfterQuery(_ context.Context, qc *hook.QueryContext, _ any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.last[qc.Table] = capturedSelect{query: qc.RawQuery, args: qc.RawArgs}

	return nil
}

func (c *selectCapture) take(t *testing.T, table string) capturedSelect {
	t.Helper()

	c.mu.Lock()
	defer c.mu.Unlock()

	got, ok := c.last[table]
	if !ok {
		t.Fatalf("no SELECT on %s was captured", table)
	}

	delete(c.last, table)

	return got
}

// explain returns Postgres's plan for one captured statement.
//
// The three planner switches leave it one question: which index reads
// the filtered rows already in id order. With sequential scans, bitmap
// scans and explicit sorts priced out, the candidates are the primary
// key walked backwards with the filter applied row by row, or a list
// index walked backwards with the filter as its index condition. That
// keeps the test independent of table size and statistics, which on a
// fresh container are empty. SET LOCAL ends with the transaction, so
// nothing leaks back into the pool.
func explain(t *testing.T, s *postgres.Store, q capturedSelect) string {
	t.Helper()

	ctx := context.Background()

	tx, err := pgdriver.Unwrap(s.DB()).BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}

	defer func() { _ = tx.Rollback() }()

	for _, set := range []string{
		`SET LOCAL enable_seqscan = off`,
		`SET LOCAL enable_bitmapscan = off`,
		`SET LOCAL enable_sort = off`,
	} {
		if _, err = tx.Exec(ctx, set); err != nil {
			t.Fatalf("%s: %v", set, err)
		}
	}

	rows, err := tx.Query(ctx, `EXPLAIN `+q.query, q.args...)
	if err != nil {
		t.Fatalf("EXPLAIN %s: %v", q.query, err)
	}

	defer rows.Close()

	var plan []string

	for rows.Next() {
		var line string
		if err = rows.Scan(&line); err != nil {
			t.Fatalf("scan plan line: %v", err)
		}

		plan = append(plan, line)
	}

	if err = rows.Err(); err != nil {
		t.Fatalf("read plan: %v", err)
	}

	return strings.Join(plan, "\n")
}

// TestFilteredListsReadInIndexOrder runs each paged list with one filter,
// captures the statement the store actually sent, and checks Postgres
// would answer it by walking that filter's list index backwards: the
// filter becomes the index condition and the rows come out newest first
// with no sort.
//
// Capturing rather than restating the SQL is the point. ListJobs used to
// send one state as state = ANY($1), and Postgres cannot read a
// (state, id) index in id order for an array, even a one-element one. It
// walked the primary key instead, the plan this index exists to replace.
func TestFilteredListsReadInIndexOrder(t *testing.T) {
	s := setupTestStore(t)
	ctx := context.Background()

	capture := &selectCapture{last: map[string]capturedSelect{}}
	s.DB().Hooks().AddHook(capture, hook.Scope{Operations: []hook.Operation{hook.OpSelect}})

	cases := []struct {
		index string
		table string
		list  func() error
	}{
		{"idx_dispatch_jobs_list_state", "dispatch_jobs", func() error {
			_, err := s.ListJobs(ctx, job.ListJobsOpts{States: []job.State{job.StateFailed}})
			return err
		}},
		{"idx_dispatch_jobs_list_queue", "dispatch_jobs", func() error {
			_, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: "reports"})
			return err
		}},
		{"idx_dispatch_dlq_list_queue", "dispatch_dlq", func() error {
			_, err := s.ListDLQPage(ctx, dlq.PageOpts{Queue: "reports"})
			return err
		}},
		{"idx_dispatch_workflow_runs_list_state", "dispatch_workflow_runs", func() error {
			_, err := s.ListRunsPage(ctx, workflow.ListRunsPageOpts{State: workflow.RunStateFailed})
			return err
		}},
		{"idx_dispatch_artifacts_list_scope", "dispatch_artifacts", func() error {
			_, err := s.ListArtifactsPage(ctx, artifact.PageOpts{ScopeAppID: "app-1"})
			return err
		}},
	}

	for _, c := range cases {
		t.Run(c.index, func(t *testing.T) {
			if err := c.list(); err != nil {
				t.Fatalf("list: %v", err)
			}

			plan := explain(t, s, capture.take(t, c.table))

			if !strings.Contains(plan, "Index Scan Backward using "+c.index+" ") {
				t.Errorf("plan does not walk %s backwards:\n%s", c.index, plan)
			}
		})
	}
}

// TestListJobsOneStateMatchesOnlyThatState covers the equality branch
// ListJobs takes for exactly one state. The shared list suite filters on
// two states, which still goes through ANY.
func TestListJobsOneStateMatchesOnlyThatState(t *testing.T) {
	s := setupTestStore(t)
	ctx := context.Background()

	const queue = "one-state"

	var failed []string

	for i, st := range []job.State{
		job.StateFailed, job.StatePending, job.StateFailed, job.StateRetrying, job.StateFailed,
	} {
		j := storetest.PendingJob(fmt.Sprintf("one-state-%d", i), queue, 0)
		j.State = st

		if err := s.EnqueueJob(ctx, j); err != nil {
			t.Fatalf("enqueue %s: %v", j.Name, err)
		}

		if st == job.StateFailed {
			failed = append(failed, j.ID.String())
		}
	}

	page, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: queue, States: []job.State{job.StateFailed}})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}

	got := make([]string, len(page.Jobs))
	for i, j := range page.Jobs {
		got[i] = j.ID.String()
	}

	slices.Reverse(failed)

	if !slices.Equal(got, failed) {
		t.Fatalf("one state = %v, want the failed jobs newest first %v", got, failed)
	}
}
```

`indexIsValid` and `remigrate` already exist in `store/postgres/migrations_test.go`, and `setupTestStore` in `store/postgres/store_test.go`; all three files share the `integration` tag and the `postgres_test` package.

The plan test captures the statement each list really sends through a grove post-query hook rather than restating the SQL, so it keeps tracking `list.go` if the query changes. `TestListJobsOneStateMatchesOnlyThatState` passes before and after this task; it is there because the shared suite only filters on two states, so nothing else exercises the equality branch Step 6 adds.

- [ ] **Step 3: Run them and see them fail**

Run: `go test -count=1 -tags integration -run 'TestListIndexes|TestFilteredListsReadInIndexOrder|TestListJobsOneState' ./store/postgres/ 2>&1 | grep -v '🐳\|✅\|⏳\|🔔\|🚫'`
Expected: the two index tests report every index missing, for example

```
--- FAIL: TestListIndexesExistAfterMigrate
    list_index_test.go:79: idx_dispatch_jobs_list_state: not in pg_indexes: no rows in result set
```

and each plan subtest shows the primary key walked backwards with the filter applied row by row:

```
--- FAIL: TestFilteredListsReadInIndexOrder/idx_dispatch_jobs_list_queue
    list_index_test.go:242: plan does not walk idx_dispatch_jobs_list_queue backwards:
        Limit  (cost=0.14..46.42 rows=1 width=580)
          ->  Index Scan Backward using dispatch_jobs_pkey on dispatch_jobs  (cost=0.14..46.42 rows=1 width=580)
                Filter: (queue = 'reports'::text)
```

`TestListJobsOneStateMatchesOnlyThatState` passes. If any test reports `rootless Docker not found` or skips, wait until `docker info` answers and rerun; never trust a cached run (`-count=1` is there for that).

- [ ] **Step 4: Add the Postgres migration**

In `store/postgres/migrations.go`, the last migration in `init` is `worker_capacity_column`. Its end and the end of `init` read (lines 709-715):

```go
			Down: func(ctx context.Context, exec migrate.Executor) error {
				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_workers
						DROP COLUMN IF EXISTS capacity`)
			},
		},
	)
}
```

Insert this between the `},` on line 713 and the `)` on line 714:

```go
		// The paged lists read newest first by ID with optional exact-match
		// filters. With no index ending in id, a filtered page either walks
		// the primary key backwards and drops every row that fails the
		// filter, which reads most of a large table when matches are rare,
		// or fetches every match and sorts them. An index on (filter, id)
		// turns the filter into an index condition and hands rows back
		// already in ID order, so a page stops after limit+1 rows.
		//
		// The name prefix filter gets no index. starts_with can only use
		// a B-tree under the C collation, and even then the index returns
		// matches in name order, so every match would still be sorted by
		// ID before the first row came back. A prefix rides on whichever
		// index the other filters choose, or on the primary key.
		&migrate.Migration{
			Name:    "list_order_indexes",
			Version: "20261008130000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// CONCURRENTLY, with an invalid leftover dropped first,
				// for the reasons given on add_job_lease_columns: a plain
				// CREATE INDEX blocks every write to the table for the
				// whole build, and dispatch_jobs is the fleet's hottest
				// table. The other three tables take a write on every dead
				// letter, workflow step and upload, so they get the same
				// treatment.
				for _, ix := range listOrderIndexes {
					if err := dropIfInvalid(ctx, exec, ix.name); err != nil {
						return err
					}

					if _, err := exec.Exec(ctx, `CREATE INDEX CONCURRENTLY IF NOT EXISTS `+
						ix.name+` ON `+ix.table+` (`+ix.columns+`)`); err != nil {
						return err
					}
				}

				return nil
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx,
						`DROP INDEX CONCURRENTLY IF EXISTS `+ix.name); err != nil {
						return err
					}
				}

				return nil
			},
		},
```

Then, directly after the closing `}` of `init` (before the `// ddlLockTimeout bounds` comment), add:

```go

// listOrderIndexes are the indexes list_order_indexes builds, one per
// exact-match filter a paged list can narrow by. Each ends in id so a
// backward walk returns the filtered rows newest first.
var listOrderIndexes = []struct{ name, table, columns string }{
	{"idx_dispatch_jobs_list_state", "dispatch_jobs", "state, id"},
	{"idx_dispatch_jobs_list_queue", "dispatch_jobs", "queue, id"},
	{"idx_dispatch_dlq_list_queue", "dispatch_dlq", "queue, id"},
	{"idx_dispatch_workflow_runs_list_state", "dispatch_workflow_runs", "state, id"},
	{"idx_dispatch_artifacts_list_scope", "dispatch_artifacts", "scope_app_id, id"},
}
```

The loop reuses `dropIfInvalid`, defined further down the same file, exactly as migrations 008 and 009 do. Grove does not wrap `Up` in a transaction (see the comment on `add_job_lease_columns`), so `CONCURRENTLY` is allowed.

- [ ] **Step 5: Run the tests and see the ANY plan**

Run the Step 3 command again.
Expected: both index tests pass, and four of the five plan subtests pass. The jobs-by-state one still fails, because `ListJobs` sends one state as an array:

```
--- FAIL: TestFilteredListsReadInIndexOrder/idx_dispatch_jobs_list_state
    list_index_test.go:242: plan does not walk idx_dispatch_jobs_list_state backwards:
        Limit  (cost=0.14..46.26 rows=1 width=580)
          ->  Index Scan Backward using dispatch_jobs_pkey on dispatch_jobs  (cost=0.14..46.26 rows=1 width=580)
                Filter: (state = ANY ('{failed}'::text[]))
```

This was checked on postgres:16 on 2026-10-07, on 200,000 rows with ANALYZE as well as on the empty test table: for 10% of rows in one state, `state = 'retrying'` walks `(state, id)` backwards (cost 10.57) while `state = ANY('{retrying}')` walks the primary key with a filter (cost 24.55).

- [ ] **Step 6: Send one state as equality**

In `store/postgres/list.go`, the `pageQuery` doc (lines 24-27) ends:

```go
// another page exists without a second query. The primary key index
// serves both the predicate and the ordering.
```

Replace those two lines with:

```go
// another page exists without a second query. The primary key serves
// both the predicate and the ordering, or, when a filter has one, a list
// index from migration list_order_indexes whose last column is id.
```

In `ListJobs`, replace (lines 94-100):

```go
	if len(opts.States) > 0 {
		states := make([]string, len(opts.States))
		for i, st := range opts.States {
			states[i] = string(st)
		}
		q = q.Where("state = ANY(?)", states)
	}
```

with:

```go
	switch {
	case len(opts.States) == 1:
		// Equality, not ANY: Postgres reads idx_dispatch_jobs_list_state
		// in ID order for state = $1, but not for state = ANY($1), even
		// with one element. Several states cannot come out of that index
		// in one ordered walk, so for them the planner chooses between the
		// primary key and a sort.
		q = q.Where("state = ?", string(opts.States[0]))
	case len(opts.States) > 1:
		states := make([]string, len(opts.States))
		for i, st := range opts.States {
			states[i] = string(st)
		}
		q = q.Where("state = ANY(?)", states)
	}
```

- [ ] **Step 7: Run the whole Postgres package and fix the dequeue plan test**

Run: `go test -count=1 -tags integration ./store/postgres/ 2>&1 | grep -E '^(ok|FAIL|--- FAIL)|Index Name'`
Expected: every new test passes, and one existing test fails:

```
--- FAIL: TestDequeueBoundedQueryPlanUsesDequeueIndex
                          "Index Name": "idx_dispatch_jobs_list_state",
```

That test fills `dispatch_jobs` with 500 pending rows, disables sequential scans, and already drops `idx_dispatch_jobs_state` inside a rolled-back transaction because a state index is cheaper than the partial dequeue index on a table where every row is pending. The two new indexes win for the same fixture reason. It is not a production regression: on 300,000 rows with 1% pending and ANALYZE, the same dequeue statement plans exactly as before the new indexes (checked 2026-10-07).

In `store/postgres/dequeue_test.go`, directly after the line (162)

```go
		`DROP INDEX idx_dispatch_jobs_state`,
```

add:

```go
		// The paged list indexes (migration list_order_indexes) lead with
		// state and with queue. Every row here is pending, so they are no
		// bigger than the partial dequeue index and narrower, and win on
		// cost the same way. On a real table, where finished jobs far
		// outnumber pending ones, the partial index is the small one.
		`DROP INDEX idx_dispatch_jobs_list_state`,
		`DROP INDEX idx_dispatch_jobs_list_queue`,
```

Both are needed: with only the first dropped, `idx_dispatch_jobs_list_queue` wins instead.

Run the Step 7 command again. Expected: `ok  	github.com/xraph/dispatch/store/postgres`.

- [ ] **Step 8: Write the SQLite tests**

Create `store/sqlite/list_index_test.go`:

```go
package sqlite_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/xraph/grove/driver"
	"github.com/xraph/grove/hook"

	"github.com/xraph/dispatch/artifact"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/workflow"
)

// listIndex is one index migration list_order_indexes builds and the
// columns it must cover, in order.
type listIndex struct {
	name, table string
	columns     []string
}

var listIndexes = []listIndex{
	{"idx_dispatch_jobs_list_state", "dispatch_jobs", []string{"state", "id"}},
	{"idx_dispatch_jobs_list_queue", "dispatch_jobs", []string{"queue", "id"}},
	{"idx_dispatch_dlq_list_queue", "dispatch_dlq", []string{"queue", "id"}},
	{"idx_dispatch_workflow_runs_list_state", "dispatch_workflow_runs", []string{"state", "id"}},
	{"idx_dispatch_artifacts_list_scope", "dispatch_artifacts", []string{"scope_app_id", "id"}},
}

// queryStrings runs a query whose rows are all text and returns them,
// one slice per row.
func queryStrings(t *testing.T, drv driver.Driver, query string, args ...any) [][]string {
	t.Helper()

	rows, err := drv.Query(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}

	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		t.Fatalf("columns of %s: %v", query, err)
	}

	var out [][]string

	for rows.Next() {
		row := make([]any, len(cols))
		for i := range row {
			row[i] = new(any)
		}

		if err = rows.Scan(row...); err != nil {
			t.Fatalf("scan %s: %v", query, err)
		}

		text := make([]string, len(cols))
		for i, v := range row {
			switch x := (*v.(*any)).(type) {
			case string:
				text[i] = x
			case []byte:
				text[i] = string(x)
			}
		}

		out = append(out, text)
	}

	if err = rows.Err(); err != nil {
		t.Fatalf("read %s: %v", query, err)
	}

	return out
}

// assertListIndexes checks each list index is on the right table and
// covers exactly its columns, in order. pragma_index_info lists an
// index's key columns by position.
func assertListIndexes(t *testing.T, drv driver.Driver) {
	t.Helper()

	for _, ix := range listIndexes {
		owner := queryStrings(t, drv,
			`SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?`, ix.name)
		if len(owner) != 1 || owner[0][0] != ix.table {
			t.Errorf("%s: sqlite_master has %v, want one index on %s", ix.name, owner, ix.table)

			continue
		}

		var cols []string
		for _, r := range queryStrings(t, drv,
			`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, ix.name) {
			cols = append(cols, r[0])
		}

		if strings.Join(cols, ",") != strings.Join(ix.columns, ",") {
			t.Errorf("%s: columns %v, want %v", ix.name, cols, ix.columns)
		}
	}
}

func TestListIndexesExistAfterMigrate(t *testing.T) {
	_, drv, _ := openMigratedWithDriver(t)

	assertListIndexes(t, drv)
}

// TestListIndexesSurviveASecondMigrate runs Migrate again on a migrated
// database, as every process start does. CREATE INDEX IF NOT EXISTS makes
// the rerun a no-op; it must not fail and must leave every index in place.
func TestListIndexesSurviveASecondMigrate(t *testing.T) {
	s, drv, _ := openMigratedWithDriver(t)

	for range 2 {
		if err := s.Migrate(context.Background()); err != nil {
			t.Fatalf("migrate again: %v", err)
		}
	}

	assertListIndexes(t, drv)
}

// selectCapture records the last SELECT grove built for each table, as
// sent: the SQL with its placeholders and the bound arguments. grove sets
// RawQuery and RawArgs before it runs post-query hooks.
type selectCapture struct {
	mu   sync.Mutex
	last map[string]capturedSelect
}

type capturedSelect struct {
	query string
	args  []any
}

func (c *selectCapture) AfterQuery(_ context.Context, qc *hook.QueryContext, _ any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.last[qc.Table] = capturedSelect{query: qc.RawQuery, args: qc.RawArgs}

	return nil
}

func (c *selectCapture) take(t *testing.T, table string) capturedSelect {
	t.Helper()

	c.mu.Lock()
	defer c.mu.Unlock()

	got, ok := c.last[table]
	if !ok {
		t.Fatalf("no SELECT on %s was captured", table)
	}

	delete(c.last, table)

	return got
}

// TestFilteredListsReadInIndexOrder runs each paged list with one filter,
// captures the statement the store actually sent, and asks SQLite how it
// would run it. The plan must search the filter's list index and must not
// build a temporary B-tree for ORDER BY: the index already returns the
// matching rows in ID order, so a page stops after limit+1 rows instead
// of sorting every match.
//
// SQLite has no planner switches, and with no ANALYZE statistics it
// prefers an index that satisfies both the WHERE and the ORDER BY over one
// that needs a sort, so the plan is the same on an empty table as on a
// large one.
func TestFilteredListsReadInIndexOrder(t *testing.T) {
	s, drv, db := openMigratedWithDriver(t)
	ctx := context.Background()

	capture := &selectCapture{last: map[string]capturedSelect{}}
	db.Hooks().AddHook(capture, hook.Scope{Operations: []hook.Operation{hook.OpSelect}})

	cases := []struct {
		index string
		table string
		list  func() error
	}{
		{"idx_dispatch_jobs_list_state", "dispatch_jobs", func() error {
			_, err := s.ListJobs(ctx, job.ListJobsOpts{States: []job.State{job.StateFailed}})
			return err
		}},
		{"idx_dispatch_jobs_list_queue", "dispatch_jobs", func() error {
			_, err := s.ListJobs(ctx, job.ListJobsOpts{Queue: "reports"})
			return err
		}},
		{"idx_dispatch_dlq_list_queue", "dispatch_dlq", func() error {
			_, err := s.ListDLQPage(ctx, dlq.PageOpts{Queue: "reports"})
			return err
		}},
		{"idx_dispatch_workflow_runs_list_state", "dispatch_workflow_runs", func() error {
			_, err := s.ListRunsPage(ctx, workflow.ListRunsPageOpts{State: workflow.RunStateFailed})
			return err
		}},
		{"idx_dispatch_artifacts_list_scope", "dispatch_artifacts", func() error {
			_, err := s.ListArtifactsPage(ctx, artifact.PageOpts{ScopeAppID: "app-1"})
			return err
		}},
	}

	for _, c := range cases {
		t.Run(c.index, func(t *testing.T) {
			if err := c.list(); err != nil {
				t.Fatalf("list: %v", err)
			}

			q := capture.take(t, c.table)

			var lines []string
			for _, r := range queryStrings(t, drv, `EXPLAIN QUERY PLAN `+q.query, q.args...) {
				lines = append(lines, r[len(r)-1])
			}

			plan := strings.Join(lines, "\n")

			if !strings.Contains(plan, "USING INDEX "+c.index+" ") {
				t.Errorf("plan does not search %s:\n%s", c.index, plan)
			}

			if strings.Contains(plan, "TEMP B-TREE") {
				t.Errorf("plan sorts instead of reading in index order:\n%s", plan)
			}
		})
	}
}
```

`openMigratedWithDriver` lives in `store/sqlite/migrations_test.go` and returns the store, the raw driver and the `*grove.DB`. These tests need no build tag; SQLite runs in process.

- [ ] **Step 9: Run them and see them fail**

Run: `go test -count=1 -run 'TestListIndexes|TestFilteredListsReadInIndexOrder' ./store/sqlite/`
Expected: every index reported missing (`sqlite_master has [], want one index on dispatch_jobs`) and every plan subtest failing, for example:

```
--- FAIL: TestFilteredListsReadInIndexOrder/idx_dispatch_jobs_list_state
    list_index_test.go:229: plan does not search idx_dispatch_jobs_list_state:
        SEARCH dispatch_jobs USING INDEX idx_dispatch_jobs_state (state=?)
        USE TEMP B-TREE FOR ORDER BY
--- FAIL: TestFilteredListsReadInIndexOrder/idx_dispatch_jobs_list_queue
    list_index_test.go:229: plan does not search idx_dispatch_jobs_list_queue:
        SCAN dispatch_jobs USING INDEX sqlite_autoindex_dispatch_jobs_1
```

The first plan line shows SQLite already turned the one-value `state IN (?)` from Task 3 into `state=?`.

- [ ] **Step 10: Add the SQLite migration**

In `store/sqlite/migrations.go`, `worker_capacity_column` and `init` end (lines 630-635):

```go
			Down: func(ctx context.Context, exec migrate.Executor) error {
				return dropColumnIfPresent(ctx, exec, "dispatch_workers", "capacity")
			},
		},
	)
}
```

Insert this between the `},` on line 633 and the `)` on line 634:

```go
		// The paged lists read newest first by ID with optional exact-match
		// filters. With no index ending in id, a filtered page either scans
		// the primary key's index backwards and drops every row that fails
		// the filter, or searches a single-column index and sorts every
		// match in a temporary B-tree. An index on (filter, id) does both
		// jobs at once, so a page stops after limit+1 rows.
		//
		// The name prefix filter gets no index. It is a substr comparison,
		// which no index serves, and an index on name would return matches
		// in name order anyway, so every match would still be sorted by ID.
		// A prefix rides on whichever index the other filters choose.
		&migrate.Migration{
			Name:    "list_order_indexes",
			Version: "20261008130000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// IF NOT EXISTS on each, so a run that failed partway, with
				// no row in grove_migrations, converges on the retry.
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx, `CREATE INDEX IF NOT EXISTS `+
						ix.name+` ON `+ix.table+` (`+ix.columns+`)`); err != nil {
						return err
					}
				}

				return nil
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx, `DROP INDEX IF EXISTS `+ix.name); err != nil {
						return err
					}
				}

				return nil
			},
		},
```

Then, directly after the closing `}` of `init` (before the `// columnExists reports` comment), add:

```go

// listOrderIndexes are the indexes list_order_indexes builds, one per
// exact-match filter a paged list can narrow by. Each ends in id so the
// filtered rows come back in ID order without a sort.
var listOrderIndexes = []struct{ name, table, columns string }{
	{"idx_dispatch_jobs_list_state", "dispatch_jobs", "state, id"},
	{"idx_dispatch_jobs_list_queue", "dispatch_jobs", "queue, id"},
	{"idx_dispatch_dlq_list_queue", "dispatch_dlq", "queue, id"},
	{"idx_dispatch_workflow_runs_list_state", "dispatch_workflow_runs", "state, id"},
	{"idx_dispatch_artifacts_list_scope", "dispatch_artifacts", "scope_app_id, id"},
}
```

The variable has the same name as the Postgres one; they are in different packages.

- [ ] **Step 11: Run the SQLite package**

Run: `go test -count=1 ./store/sqlite/`
Expected: `ok  	github.com/xraph/dispatch/store/sqlite`.

- [ ] **Step 12: Write the Mongo test**

Create `store/mongo/list_index_test.go`:

```go
package mongo_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
	mongod "go.mongodb.org/mongo-driver/v2/mongo"
)

// indexKeys returns every index on a collection as its key pattern
// written out, "state:1,_id:-1", so a test can compare patterns without
// caring about the numeric type the server echoes back.
func indexKeys(t *testing.T, mdb *mongod.Database, col string) []string {
	t.Helper()

	ctx := context.Background()

	cur, err := mdb.Collection(col).Indexes().List(ctx)
	if err != nil {
		t.Fatalf("list indexes on %s: %v", col, err)
	}

	var specs []struct {
		Key bson.D `bson:"key"`
	}
	if err = cur.All(ctx, &specs); err != nil {
		t.Fatalf("decode indexes on %s: %v", col, err)
	}

	out := make([]string, 0, len(specs))
	for _, spec := range specs {
		parts := make([]string, len(spec.Key))
		for i, e := range spec.Key {
			parts[i] = fmt.Sprintf("%s:%v", e.Key, e.Value)
		}
		out = append(out, strings.Join(parts, ","))
	}

	return out
}

// TestListIndexesExistAfterMigrate checks the compound indexes the paged
// lists read through: one per exact-match filter, each ending in _id
// descending so a filtered page comes back newest first without a sort.
//
// Migrate runs twice first, as it does on every process start.
// CreateMany with an identical key pattern and options is a no-op, so the
// second run must succeed and leave the same indexes.
func TestListIndexesExistAfterMigrate(t *testing.T) {
	uri := startMongo(t)
	s := openStore(t, uri)

	for range 2 {
		if err := s.Migrate(context.Background()); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}

	mdb := rawDatabase(t, uri)

	for _, want := range []struct{ col, keys string }{
		{"dispatch_jobs", "state:1,_id:-1"},
		{"dispatch_jobs", "queue:1,_id:-1"},
		{"dispatch_dlq", "queue:1,_id:-1"},
		{"dispatch_workflow_runs", "state:1,_id:-1"},
		{"dispatch_artifacts", "scope_app_id:1,_id:-1"},
	} {
		if got := indexKeys(t, mdb, want.col); !slices.Contains(got, want.keys) {
			t.Errorf("%s has no {%s} index; has %v", want.col, want.keys, got)
		}
	}
}
```

`startMongo`, `openStore` and `rawDatabase` are in `store/mongo/dequeue_test.go`. Mongo tests carry no build tag and skip when no container runtime answers, so always run them with `-v` once and check for `--- PASS`, not `--- SKIP`.

- [ ] **Step 13: Run it and see it fail**

Run: `go test -count=1 -v -run TestListIndexesExistAfterMigrate ./store/mongo/ 2>&1 | grep -E '^(--- |ok|FAIL)|list_index'`
Expected:

```
    list_index_test.go:73: dispatch_jobs has no {state:1,_id:-1} index; has [_id:1 queue:1,state:1,priority:-1,run_at:1 state:1 scope_app_id:1,scope_org_id:1 state:1,heartbeat_at:1 state:1,lease_expires_at:1]
    list_index_test.go:73: dispatch_jobs has no {queue:1,_id:-1} index; has [...]
    list_index_test.go:73: dispatch_dlq has no {queue:1,_id:-1} index; has [_id:1 queue:1,failed_at:-1]
    list_index_test.go:73: dispatch_workflow_runs has no {state:1,_id:-1} index; has [_id:1 state:1 created_at:1]
    list_index_test.go:73: dispatch_artifacts has no {scope_app_id:1,_id:-1} index; has [...]
--- FAIL: TestListIndexesExistAfterMigrate
```

- [ ] **Step 14: Add the Mongo indexes**

In `store/mongo/store.go`, inside `migrationIndexes()`, make four additions.

Under `colArtifacts`, after the scope index that ends at line 175:

```go
			{Keys: bson.D{
				{Key: "scope_app_id", Value: 1},
				{Key: "scope_org_id", Value: 1},
			}},
			// Paged list by tenant. See listOrderKeys.
			listOrderKeys("scope_app_id"),
		},
		colArtifactLinks: {
```

Under `colJobs`, after the lease index (line 214):

```go
			// Lease index for the expired-lease reclaim scan.
			{Keys: bson.D{{Key: "state", Value: 1}, {Key: "lease_expires_at", Value: 1}}},
			// Paged list by state and by queue. See listOrderKeys.
			listOrderKeys("state"),
			listOrderKeys("queue"),
		},
```

`colWorkflowRuns` becomes:

```go
		colWorkflowRuns: {
			{Keys: bson.D{{Key: "state", Value: 1}}},
			{Keys: bson.D{{Key: "created_at", Value: 1}}},
			// Paged list by state. See listOrderKeys.
			listOrderKeys("state"),
		},
```

`colDLQ` becomes:

```go
		colDLQ: {
			{Keys: bson.D{
				{Key: "queue", Value: 1},
				{Key: "failed_at", Value: -1},
			}},
			// Paged list by queue. See listOrderKeys.
			listOrderKeys("queue"),
		},
```

At the end of the file, after the closing `}` of `migrationIndexes`, add:

```go

// listOrderKeys is the index a paged list reads through when it filters
// on field: the filter first, then _id descending, the order every page
// is read in. Mongo turns the filter into index bounds and returns the
// matches already newest first, so a page stops after limit+1 documents
// instead of sorting every match or walking _id and discarding the rest.
// A one-element $in, which ListJobs sends for one state, is planned as an
// equality. Several states become one scan per state, merged in _id order
// (SORT_MERGE), which still needs no sort.
//
// The name prefix filter gets no index. An anchored regex can use an
// index on name, but that index returns matches in name order, so every
// match would still be sorted by _id before the first one came back.
func listOrderKeys(field string) mongod.IndexModel {
	return mongod.IndexModel{Keys: bson.D{
		{Key: field, Value: 1},
		{Key: "_id", Value: -1},
	}}
}
```

Default index names (`state_1__id_-1` and so on) match most of the existing entries, and `CreateMany` with the same keys, options and name is a no-op, so a second `Migrate` is safe. The SORT_MERGE claim was checked on mongo:7 on 2026-10-07: `find({state:{$in:["failed"]}}).sort({_id:-1})` plans as `LIMIT <- FETCH <- IXSCAN(state_1__id_-1)`, and a two-state `$in` as `LIMIT <- FETCH <- SORT_MERGE <- IXSCAN <- IXSCAN` on the same index.

- [ ] **Step 15: Run the Mongo test**

Run the Step 13 command again.
Expected: `--- PASS: TestListIndexesExistAfterMigrate` and `ok  	github.com/xraph/dispatch/store/mongo`.

- [ ] **Step 16: Gate**

```bash
gofmt -l store
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race -tags integration ./store/... 2>&1 | grep -E '^(ok|FAIL|--- FAIL|panic)'
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: `gofmt` prints nothing; the unit run prints no lines; the integration run prints `ok` for `store`, `store/memory`, `store/mongo`, `store/postgres`, `store/redis`, `store/sqlite` and `store/storetest` and no FAIL; the first lint prints `0 issues.`; the second prints exactly one issue, the pre-existing `store/redis/store_test.go:54:5: shadow: declaration of "err" shadows declaration at line 36 (govet)`, which this task leaves alone. If Docker drops partway (`rootless Docker not found`), wait for `docker info` to answer and rerun the integration line.

- [ ] **Step 17: Commit**

```bash
git add store/postgres/list_index_test.go store/sqlite/list_index_test.go store/mongo/list_index_test.go
git commit --only -m "feat(store): index the paged lists by filter and ID

A filtered page reads newest first by ID, and no filter had an index
ending in id. Postgres and SQLite walked the primary key backwards and
dropped every row that missed the filter, or fetched every match and
sorted it, so a rare state on a big jobs table read most of the table
to fill one page.

Postgres and SQLite get migration 20261008130000 with five (filter, id)
indexes. Postgres builds them CONCURRENTLY, since the fleet writes these
tables while the migration runs. Mongo gets the same keys with _id
descending.

ListJobs on Postgres now sends one state as state = ?. Postgres can't
read the new index in ID order for state = ANY(\$1), even with one
element, so the commonest filter got nothing from it until that changed.
The name prefix filter has no index on purpose: any index on name hands
matches back in name order, and they'd still need sorting by ID." -- \
  store/postgres/migrations.go store/postgres/list.go store/postgres/dequeue_test.go \
  store/postgres/list_index_test.go store/sqlite/migrations.go store/sqlite/list_index_test.go \
  store/mongo/store.go store/mongo/list_index_test.go
git show --stat HEAD | tail -9
```

Expected: 8 files changed, three of them created.

Note for later tasks: the multi-state job filter (`States` with two or more values) still has no ordered index plan on Postgres or SQLite; Mongo merges per-state scans. If the dashboard's default job view filters on several states at once, that is the query to look at next. The older single-column `idx_dispatch_jobs_state` and `idx_dispatch_workflow_runs_state` are now prefixes of the new indexes; this task keeps them, because they are smaller and the planner still picks them for rare-state counts and for the dequeue statement.

---

## After this plan

Slice 1 is done when Task 8's gate is green on `main` in the shared checkout. Then:

- Nothing is pushed. Ask Rex before pushing `main`.
- Update the forge-dashboard memory note `dispatch-dashboard-migration.md` with the commit range and anything the tasks reported.
- Slice 2 (DLQ replay and retry, cron service, cancel running, workflow replay-from-step, operator events) is planned next, against the code this slice produced.

Carried to slice 2 from this plan's investigation:

- Redis never stores a run's `ParentRunID` (`runEntity` in `store/redis/workflow.go` has no such field), so `ListChildRuns` finds nothing on redis. The run tree in slice 5 needs it.
- Redis `PushDLQ` has no duplicate check, unlike `CreateRun` and `EnqueueJob`.
- The k8s cluster provider still drops `Worker.Capacity`.
- Multi-state job filters have no ordered index plan on Postgres or SQLite (Mongo merges per-state scans). If the dashboard's default jobs view filters on several states, measure it.
- During a rolling deploy, a redis delete by an old-release instance can mask an insert by another, so the redis created-order index can miss a row until every instance runs this release. The manual fix is to delete `<prefix>dispatch:<entity>_by_created`; the next list rebuilds it. This goes into `MIGRATION.md`.
