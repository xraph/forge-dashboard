# Dispatch slice 2: operator actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every operator action the dashboard will offer (cancel, retry, dead letter replay, delete and purge, cron enable, disable, delete and run now, workflow replay from a step) safe to run twice, safe across instances and backends, and visible as an engine event, so the contract in slice 3 can expose them without inheriting today's double runs and silent reverts.

**Architecture:** The store layer gains three atomic conditional writes (a dead letter replay claim, targeted cron field writes, and a run reopen), defined once with a memory reference and a conformance suite, implemented on postgres, sqlite, mongo and redis, then folded into the base store interfaces. The engine gains one operator method per action, each routed through those writes and through the engine's own enqueue path, each emitting one `ext.Action` (who did what) on success, with `JobCancelled` as a new lifecycle event. The cron scheduler stops writing whole rows, and the REST api switches to the engine methods so REST and the dashboard share one set of semantics.

**Tech Stack:** Go 1.26, grove ORM (pgdriver, sqlitedriver, mongodriver), grove kv and go-redis with Lua compare-and-set, robfig/cron v3, testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-07-dispatch-dashboard-migration-design.md` (forge-dashboard, commit a18ccc2), "Engine fixes" items 3 to 7, plus the items slice 1 carried forward (redis dropped a run's parent; redis `PushDLQ` overwrote duplicates). Slice 1's plan is `docs/superpowers/plans/2026-10-07-dispatch-slice1-engine-reads.md`; its code is on Dispatch `main` up to `f7a4d4e`.

**How this plan was made:** every task below was implemented and gated in a scratch clone before it was written down, by its own drafter, from the code that passed. The tasks were then replayed in order onto one clone and gated together: build, `go test ./...`, `-race` on engine, worker, cron, workflow, dlq, ext, audit_hook, relay_hook, stream and resource, the integration suites on all five backends, and lint.

## Global Constraints

- Repo: `/Users/rexraphael/Work/xraph/forgery/dispatch`, branch `main`, the shared checkout. No worktrees, no branches. Starts at `f7a4d4e`.
- Commit only your own paths: `git add <new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.
- Commit messages: conventional prefix, Rex's voice, no em dashes anywhere, no `Co-Authored-By` or any Claude or Anthropic attribution.
- Edit existing files with exact-match edits anchored on the quoted code in the task, not on line numbers alone. Create new files from the task's full code blocks. Never extract code from this plan with `sed -n` into files; the permission classifier refuses shell redirects into the shared checkout, and Rex approves shell writes himself. If a command is denied, stop and report; do not try another route.
- New SQL migrations are appended LAST: after `list_order_indexes` (20261008130000), in order `dlq_replayed_job_id` (20261009120000) then `workflow_run_version_parent` (20261009130000).
- Refused state transitions wrap `dispatch.ErrInvalidState` with the current state in the message. Not found keeps the existing `dispatch.Err*NotFound` sentinels. New sentinels: `dispatch.ErrDLQAlreadyReplayed`, `dispatch.ErrDLQAlreadyExists`, `workflow.ErrRunnerShutdown`.
- Every engine operator method emits exactly one `ext.Action` on success and nothing on failure; the actor comes from `ext.WithActor(ctx, subject)`.
- Gate: `go build ./... && go test -count=1 ./...`; store work also `go test -count=1 -race -tags integration ./store/<backend>/...` (mongo and sqlite tests are untagged and run under plain `go test`; check mongo PASSes with `-v`, it skips silently without Docker); engine work `go test -count=1 -race` on the packages the task names; lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C` prints `0 issues.` Under `--build-tags integration` lint reports one pre-existing govet shadow at `store/redis/store_test.go:54`; it is not this plan's.
- Integration tests need Docker; testcontainers pick random ports. If tests fail at 0.00s with `rootless Docker not found`, wait until `docker info` answers and rerun.

## Review Focus

1. **Two operators replay the same dead letter at the same moment, or one retries the failed job while another replays its entry.** Exactly one new run of the work, and the loser gets a clear refusal. Pinned by `ClaimReplayConcurrentExactlyOneWinner` on all five backends (Tasks 1 to 5) and by the engine's concurrent-replay, retry-then-replay and replay-then-retry tests (Tasks 8a, 8b).
2. **An operator disables a cron from a non-leader node while the leader is mid-fire.** The cron stays disabled and fires no more. Pinned by the scheduler regression tests and the leader's re-read under the lock (Task 9), and by `SetCronEnabled`/`UpdateCronNextRun` leaving each other's fields alone on every backend (Tasks 1 to 5).
3. **A running job is cancelled on a real backend (one that honours a cancelled context).** The row stays cancelled, the worker stops within a few heartbeats, and the job reports cancelled, not failed. Before this plan a lost lease reported nothing at all on postgres, sqlite, mongo and redis. Pinned by `worker/cancel_test.go` with a context-honouring store wrapper (Task 8a).
4. **A workflow replay requested while the run is still running, twice at once, or after a newer version of the workflow was registered.** Refused, exactly one starts, and it runs on the run's own version. Pinned by Task 10's tests and by `ReopenRunConcurrentExactlyOneWinner` and `VersionRoundTripsAsWritten` on all five backends (Tasks 1 to 6).
5. **Data written before this release.** Dead letters with no `replayed_job_id`, runs with no `version` or `parent_run_id`, redis rows with no per-job dead letter index. Reads still work and old rows stay replayable. Pinned by each backend's migration test (Tasks 2, 3), the redis self-healing per-job index test (Task 5), and the mongo test that claims both the null and the missing `replayed_at` shapes (Task 4).

## File Structure

Created:

| Path | Responsibility |
|---|---|
| `dlq/claim.go`, `cron/targeted.go`, `workflow/reopen.go` | The three store capabilities and their contracts |
| `store/storetest/dlq_replay.go`, `cron.go`, `workflow.go` | Conformance suites for them |
| `store/<backend>/operator.go`, `operator_test.go` | Each backend's implementation and suite wiring |
| `store/redis/cas.go` | Redis compare-and-set over whole entity blobs (no Lua re-encoding) |
| `engine/ops.go`, `ops_dlq.go`, `ops_cron.go`, `ops_workflow.go` | The engine's operator methods |
| `cron/next.go` | `NextFires` |
| `worker/cancel_test.go` | The lost-lease reporting regression |

Modified (anchored per task): `errors.go`, `dlq/entry.go`, `dlq/service.go`, `dlq/replay.go`, the three base store interfaces, every backend's models and migrations, `ext/ext.go`, `ext/registry.go`, `audit_hook/*`, `relay_hook/*`, `stream/*`, `engine/engine.go`, `worker/runner.go`, `cron/scheduler.go`, `workflow/debug.go`, `workflow/runner.go`, `resource/` (exported `CheckSchedulable`), `api/*`.

---

### Task 1: The store contract for operator actions, its suites, and the memory reference

Operator actions need three store writes that check and change in one step: a replay claim on a dead letter entry (so two replays of the same failure cannot both enqueue a job), single-column cron writes (so the scheduler's whole-row write after a fire can no longer bring a disabled cron back), and a conditional reopen of a workflow run (so two replay-from-step calls cannot run the tail twice). This task defines each as a capability interface with a doc comment that states its atomicity and error contract, writes a conformance suite for each, and makes the memory store the reference that passes them under `-race`. No other backend implements the capabilities yet. They compile unchanged and wire the new suites in their own tasks, which is why the new cases live in new suite functions instead of widening `RunDLQSuite`.

**Files:**
- Modify: `errors.go` (the "Conflict errors" block, after `ErrDuplicateCron`)
- Modify: `dlq/entry.go` (inside `type Entry`, after the `CreatedAt` field)
- Create: `dlq/claim.go`, `cron/targeted.go`, `workflow/reopen.go`
- Create: `store/storetest/dlq_replay.go`, `store/storetest/cron.go`, `store/storetest/workflow.go`
- Create: `store/memory/operator.go`
- Modify: `store/memory/store.go` (`PushDLQ`, around line 673)
- Test: `store/memory/operator_test.go` (create)

**Interfaces:**
- Consumes: `dlq.Store`, `dlq.PageLister`, `cron.Store`, `workflow.Store` as they are on main; the sentinels `dispatch.ErrDLQNotFound`, `dispatch.ErrCronNotFound`, `dispatch.ErrRunNotFound`, `dispatch.ErrInvalidState`.
- Produces (every later store and engine task relies on these exact names):

```go
package dispatch
var ErrDLQAlreadyExists   = errors.New("dispatch: dlq entry already exists")
var ErrDLQAlreadyReplayed = errors.New("dispatch: dlq entry already replayed")

package dlq
// Entry gains:
ReplayedJobID *id.JobID `json:"replayed_job_id,omitempty"`
type ReplayClaimer interface {
	ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
	ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
	GetDLQByJobID(ctx context.Context, jobID id.JobID) (*Entry, error)
	DeleteDLQ(ctx context.Context, entryID id.DLQID) error
}

package cron
type TargetedUpdater interface {
	SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error
	UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error
}

package workflow
type Reopener interface {
	ReopenRun(ctx context.Context, runID id.RunID) error
}

package storetest
type DLQReplayStore interface { dlq.Store; dlq.ReplayClaimer }
func RunDLQReplaySuite(t *testing.T, newStore func(t *testing.T) DLQReplayStore)
type CronStore interface { cron.Store; cron.TargetedUpdater }
func RunCronSuite(t *testing.T, newStore func(t *testing.T) CronStore)
type WorkflowStore interface { workflow.Store; workflow.Reopener }
func RunWorkflowSuite(t *testing.T, newStore func(t *testing.T) WorkflowStore)
```

`RunDLQSuite` and `DLQStore` are unchanged.

Two semantics are pinned here beyond the interface text, so every backend is held to the same thing:
- `GetDLQByJobID` picks the newest entry **by entry ID**, the order `ListDLQPage` uses, not by `FailedAt`. The suite's `GetDLQByJobIDReturnsNewestByID` case gives the older ID the later `FailedAt` so the two orders disagree.
- `UpdateCronNextRun` returns `dispatch.ErrCronNotFound` for a missing entry, like `SetCronEnabled`. The scheduler task must tolerate it, since a cron deleted between a fire and its next-run write now reports not found.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- errors.go dlq cron workflow store/memory store/storetest && git log -1 --oneline`
Expected: no lines from `git status` (the log line shows the slice 1 head or later). If another session has uncommitted edits in any of these paths, stop and report.

- [ ] **Step 2: Add the two sentinels**

In `errors.go`, the "Conflict errors" block currently reads:

```go
	// Conflict errors.
	ErrJobAlreadyExists = errors.New("dispatch: job already exists")
	ErrDuplicateCron    = errors.New("dispatch: duplicate cron entry")

	// State errors.
```

Replace it with:

```go
	// Conflict errors.
	ErrJobAlreadyExists = errors.New("dispatch: job already exists")
	ErrDuplicateCron    = errors.New("dispatch: duplicate cron entry")

	// ErrDLQAlreadyExists is what PushDLQ returns for an entry ID that is
	// already in the dead letter queue. A push never overwrites an entry.
	ErrDLQAlreadyExists = errors.New("dispatch: dlq entry already exists")

	// ErrDLQAlreadyReplayed is what dlq.ReplayClaimer.ClaimReplay returns
	// when the entry was claimed by an earlier replay or retry, so the
	// same failure is never turned back into work twice.
	ErrDLQAlreadyReplayed = errors.New("dispatch: dlq entry already replayed")

	// State errors.
```

- [ ] **Step 3: Give the DLQ entry the job its replay created**

In `dlq/entry.go`, inside `type Entry`, find:

```go
	ReplayedAt *time.Time `json:"replayed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`

	// Priority is the claim ordering the job was enqueued with.
```

Replace it with:

```go
	ReplayedAt *time.Time `json:"replayed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`

	// ReplayedJobID is the job a replay created, or for a retry the
	// retried job itself. ClaimReplay sets it together with ReplayedAt,
	// and it is nil while the entry is unreplayed. An entry marked by the
	// older ReplayDLQ has ReplayedAt set and this nil.
	ReplayedJobID *id.JobID `json:"replayed_job_id,omitempty"`

	// Priority is the claim ordering the job was enqueued with.
```

`dlq/entry.go` already imports `github.com/xraph/dispatch/id`. Every place that builds an `Entry` (`dlq/service.go`, `dlq/replay.go` reads it, each backend's model mapper) uses named fields, so nothing else needs to change to compile.

- [ ] **Step 4: Write the three capability interfaces**

Create `dlq/claim.go`:

```go
package dlq

import (
	"context"

	"github.com/xraph/dispatch/id"
)

// ReplayClaimer is the conditional write that makes replay idempotent.
//
// A replay used to read the entry, enqueue a new job, then mark the entry
// replayed, so two operators clicking replay at once both got a job. The
// claim moves the check into the store: whoever sets replayed_at first
// owns the replay, and everyone after them is told so.
type ReplayClaimer interface {
	// ClaimReplay sets replayed_at = now and replayed_job_id = jobID only
	// if replayed_at is null. It returns dispatch.ErrDLQAlreadyReplayed
	// when replayed_at was already set, and dispatch.ErrDLQNotFound when
	// the entry does not exist. The check and the write are one atomic
	// step on every backend: of two concurrent claims, exactly one wins.
	ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error

	// ReleaseReplay clears replayed_at and replayed_job_id, but only if
	// replayed_job_id still equals jobID, so a release never undoes
	// somebody else's claim. When it does not match, including on an
	// entry nobody claimed, it is a no-op and returns nil. It returns
	// dispatch.ErrDLQNotFound when the entry does not exist. Like the
	// claim, the comparison and the write are one atomic step.
	ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error

	// GetDLQByJobID returns the newest entry for a failed job, newest by
	// entry ID (the order ListDLQPage uses), or dispatch.ErrDLQNotFound
	// when the job has none.
	GetDLQByJobID(ctx context.Context, jobID id.JobID) (*Entry, error)

	// DeleteDLQ hard-deletes one entry. It returns dispatch.ErrDLQNotFound
	// when the entry does not exist.
	DeleteDLQ(ctx context.Context, entryID id.DLQID) error
}
```

Create `cron/targeted.go`:

```go
package cron

import (
	"context"
	"time"

	"github.com/xraph/dispatch/id"
)

// TargetedUpdater writes single fields so a scheduler fire can never
// overwrite an operator's enable or disable. The whole-row UpdateCronEntry
// write-back is what let a disabled cron come back: the scheduler read the
// entry while it was enabled, an operator disabled it, and the scheduler's
// post-fire write put the old row, enabled flag and all, back on top.
//
// Each method changes only the columns it names. Every other field,
// including the lock and last_run_at, reads back exactly as it was.
type TargetedUpdater interface {
	// SetCronEnabled sets enabled, sets next_run_at when nextRunAt is
	// non-nil (nil leaves it unchanged), and stamps updated_at. It
	// returns dispatch.ErrCronNotFound when the entry does not exist.
	SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error

	// UpdateCronNextRun sets next_run_at and stamps updated_at, and
	// nothing else; in particular it never touches enabled. It returns
	// dispatch.ErrCronNotFound when the entry does not exist.
	UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error
}
```

Create `workflow/reopen.go`:

```go
package workflow

import (
	"context"

	"github.com/xraph/dispatch/id"
)

// Reopener is the conditional claim that makes replay-from-step safe.
//
// Replaying a run from a step re-executes it under the same run ID, so two
// replays started together would run the tail of the workflow twice, side
// by side. The claim is the state change itself: only one caller can move
// a run out of a finished state into running.
type Reopener interface {
	// ReopenRun sets state = running, error = "" and completed_at = null
	// (and stamps updated_at) only if the run is not already running. It
	// leaves every other field alone. When the run is running it returns
	// an error wrapping dispatch.ErrInvalidState that names the state;
	// when the run does not exist, dispatch.ErrRunNotFound. The check and
	// the write are one atomic step: of two concurrent reopens, exactly
	// one wins.
	ReopenRun(ctx context.Context, runID id.RunID) error
}
```

Run: `go build ./...`
Expected: no output.

- [ ] **Step 5: Write the DLQ replay suite**

Create `store/storetest/dlq_replay.go`. `raceAttempts` and `concurrentRounds` here are shared with the workflow suite in Step 7.

```go
package storetest

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
)

// DLQReplayStore is what the replay suite requires: the base DLQ store
// plus the claim capability operator replays and retries are built on.
type DLQReplayStore interface {
	dlq.Store
	dlq.ReplayClaimer
}

// concurrentClaimers is how many goroutines race for one claim, and
// concurrentRounds how many fresh entries (or runs) they race over.
// raceAttempts holds the goroutines at a spin barrier so they really call
// together. With it, a claim written as a read then a separate write lost
// against the memory store in 10 of 10 runs under -race, and 7 of 10
// without. A container backend puts a round trip between the read and the
// write, which only widens the window.
const (
	concurrentClaimers = 16
	concurrentRounds   = 10
)

// raceResult counts how a set of simultaneous attempts came out.
type raceResult struct {
	n       int
	wins    int
	winner  int
	refused int
	other   []error
}

// raceAttempts starts n goroutines together, each calling attempt with
// its index, and sorts the outcomes into wins, refusals (errors wrapping
// refusal) and anything else.
func raceAttempts(n int, refusal error, attempt func(i int) error) raceResult {
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		ready atomic.Int64
		res   = raceResult{n: n, winner: -1}
	)

	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()

			// Spin until every goroutine is running, so they call
			// attempt together rather than in the order they woke.
			ready.Add(1)
			for ready.Load() < int64(n) {
				runtime.Gosched()
			}

			err := attempt(i)

			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				res.wins++
				res.winner = i
			case errors.Is(err, refusal):
				res.refused++
			default:
				res.other = append(res.other, err)
			}
		}()
	}
	wg.Wait()

	return res
}

// assertOneWinner fails unless exactly one attempt won and every other one
// was refused.
func (r raceResult) assertOneWinner(t *testing.T, label string) {
	t.Helper()

	if len(r.other) > 0 {
		t.Fatalf("%s: unexpected errors: %v", label, r.other)
	}
	if r.wins != 1 || r.refused != r.n-1 {
		t.Fatalf("%s: %d of %d won and %d were refused, want exactly 1 and %d",
			label, r.wins, r.n, r.refused, r.n-1)
	}
}

// RunDLQReplaySuite pins the replay claim: the first claim wins and every
// later one is refused, a release only undoes its own claim, the job a
// replay created reads back from every path, and a push never overwrites.
//
// Run it with `go test -race`. ClaimReplayConcurrentExactlyOneWinner is
// the case that proves the claim is atomic, and an unguarded
// read-then-write only loses that race reliably under the detector.
//
// newStore may return a shared store, so every case works on entries it
// pushed itself under a queue nobody else uses, and never asserts a total.
func RunDLQReplaySuite(t *testing.T, newStore func(t *testing.T) DLQReplayStore) {
	t.Helper()

	cases := []struct {
		name string
		fn   func(t *testing.T, s DLQReplayStore)
	}{
		{"ClaimReplayFirstWins", testClaimReplayFirstWins},
		{"ClaimReplayConcurrentExactlyOneWinner", testClaimReplayConcurrent},
		{"ClaimReplayUnknownEntry", testClaimReplayUnknownEntry},
		{"ReplayedJobIDReadsBackFromEveryPath", testReplayedJobIDReadsBack},
		{"ReleaseReplayOnlyReleasesItsOwnClaim", testReleaseReplayOnlyOwnClaim},
		{"ReleaseReplayOnUnclaimedEntryIsNoop", testReleaseReplayUnclaimed},
		{"ReleaseReplayUnknownEntry", testReleaseReplayUnknownEntry},
		{"GetDLQByJobIDReturnsNewestByID", testGetDLQByJobIDNewest},
		{"GetDLQByJobIDUnknownJob", testGetDLQByJobIDUnknown},
		{"DeleteDLQRemovesOnlyThatEntry", testDeleteDLQ},
		{"PushDLQRefusesDuplicateID", testPushDLQDuplicate},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.fn(t, newStore(t))
		})
	}
}

// replayEntry builds an unreplayed entry for jobID on queue.
func replayEntry(jobID id.JobID, queue string, failedAt time.Time) *dlq.Entry {
	return &dlq.Entry{
		ID:         id.NewDLQID(),
		JobID:      jobID,
		JobName:    "replay-suite",
		Queue:      queue,
		Payload:    []byte(`{"n":1}`),
		Error:      "boom",
		RetryCount: 3,
		MaxRetries: 3,
		FailedAt:   failedAt,
		CreatedAt:  failedAt,
	}
}

// replayQueue is a queue name no other case, and no other run against a
// shared store, uses.
func replayQueue() string {
	return "dlq-replay-" + id.NewDLQID().String()
}

func pushReplayEntry(t *testing.T, s DLQReplayStore) *dlq.Entry {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Millisecond)
	e := replayEntry(id.NewJobID(), replayQueue(), now)
	if err := s.PushDLQ(context.Background(), e); err != nil {
		t.Fatalf("PushDLQ: %v", err)
	}

	return e
}

// mustGetDLQ reads an entry and returns a copy of it, so a store that
// hands out its own pointer cannot change a snapshot behind the test.
func mustGetDLQ(t *testing.T, s DLQReplayStore, entryID id.DLQID) *dlq.Entry {
	t.Helper()

	got, err := s.GetDLQ(context.Background(), entryID)
	if err != nil {
		t.Fatalf("GetDLQ(%s): %v", entryID, err)
	}
	snapshot := *got

	return &snapshot
}

// assertClaimedBy checks the entry is replayed by exactly jobID.
func assertClaimedBy(t *testing.T, label string, e *dlq.Entry, jobID id.JobID) {
	t.Helper()

	if e.ReplayedAt == nil {
		t.Errorf("%s: ReplayedAt = nil, want set", label)
	}
	if e.ReplayedJobID == nil {
		t.Fatalf("%s: ReplayedJobID = nil, want %s", label, jobID)
	}
	if *e.ReplayedJobID != jobID {
		t.Errorf("%s: ReplayedJobID = %s, want %s", label, *e.ReplayedJobID, jobID)
	}
}

// assertUnclaimed checks the entry carries no replay at all.
func assertUnclaimed(t *testing.T, label string, e *dlq.Entry) {
	t.Helper()

	if e.ReplayedAt != nil {
		t.Errorf("%s: ReplayedAt = %v, want nil", label, *e.ReplayedAt)
	}
	if e.ReplayedJobID != nil {
		t.Errorf("%s: ReplayedJobID = %s, want nil", label, *e.ReplayedJobID)
	}
}

func testClaimReplayFirstWins(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()
	e := pushReplayEntry(t, s)
	first, second := id.NewJobID(), id.NewJobID()

	if err := s.ClaimReplay(ctx, e.ID, first); err != nil {
		t.Fatalf("first ClaimReplay: %v", err)
	}

	err := s.ClaimReplay(ctx, e.ID, second)
	if !errors.Is(err, dispatch.ErrDLQAlreadyReplayed) {
		t.Fatalf("second ClaimReplay error = %v, want ErrDLQAlreadyReplayed", err)
	}

	// The refused claim must not have moved the claim to its own job.
	assertClaimedBy(t, "after refused claim", mustGetDLQ(t, s, e.ID), first)
}

func testClaimReplayConcurrent(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()

	for round := range concurrentRounds {
		e := pushReplayEntry(t, s)
		claimers := make([]id.JobID, concurrentClaimers)
		for i := range claimers {
			claimers[i] = id.NewJobID()
		}

		res := raceAttempts(concurrentClaimers, dispatch.ErrDLQAlreadyReplayed, func(i int) error {
			return s.ClaimReplay(ctx, e.ID, claimers[i])
		})
		res.assertOneWinner(t, fmt.Sprintf("round %d: concurrent ClaimReplay", round))

		assertClaimedBy(t, fmt.Sprintf("round %d", round), mustGetDLQ(t, s, e.ID), claimers[res.winner])
	}
}

func testClaimReplayUnknownEntry(t *testing.T, s DLQReplayStore) {
	err := s.ClaimReplay(context.Background(), id.NewDLQID(), id.NewJobID())
	if !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Fatalf("ClaimReplay(unknown) error = %v, want ErrDLQNotFound", err)
	}
}

// testReplayedJobIDReadsBack reads the claimed entry through every read
// path. On some backends GetDLQ, ListDLQ, ListDLQPage and GetDLQByJobID
// are separate queries over the same mapper, and a column added to one
// and forgotten in another reads back as nil without any error.
func testReplayedJobIDReadsBack(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	queue := replayQueue()

	claimed := replayEntry(id.NewJobID(), queue, now)
	untouched := replayEntry(id.NewJobID(), queue, now)
	for _, e := range []*dlq.Entry{claimed, untouched} {
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("PushDLQ: %v", err)
		}
	}

	newJob := id.NewJobID()
	if err := s.ClaimReplay(ctx, claimed.ID, newJob); err != nil {
		t.Fatalf("ClaimReplay: %v", err)
	}

	assertClaimedBy(t, "GetDLQ", mustGetDLQ(t, s, claimed.ID), newJob)
	assertUnclaimed(t, "GetDLQ untouched", mustGetDLQ(t, s, untouched.ID))

	byJob, err := s.GetDLQByJobID(ctx, claimed.JobID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}
	assertClaimedBy(t, "GetDLQByJobID", byJob, newJob)

	listed, err := s.ListDLQ(ctx, dlq.ListOpts{Queue: queue})
	if err != nil {
		t.Fatalf("ListDLQ: %v", err)
	}
	if len(listed) != 2 {
		t.Fatalf("ListDLQ returned %d entries on its own queue, want 2", len(listed))
	}
	for _, e := range listed {
		if e.ID == claimed.ID {
			assertClaimedBy(t, "ListDLQ", e, newJob)
		} else {
			assertUnclaimed(t, "ListDLQ untouched", e)
		}
	}

	// The paged read is the dashboard's path. store.Store includes it, but
	// DLQReplayStore does not, so reach it through the capability.
	pager, ok := s.(dlq.PageLister)
	if !ok {
		return
	}
	replayed := true
	page, err := pager.ListDLQPage(ctx, dlq.PageOpts{Queue: queue, Replayed: &replayed})
	if err != nil {
		t.Fatalf("ListDLQPage: %v", err)
	}
	if len(page.Entries) != 1 || page.Entries[0].ID != claimed.ID {
		t.Fatalf("ListDLQPage(replayed) = %d entries, want only the claimed one", len(page.Entries))
	}
	assertClaimedBy(t, "ListDLQPage", page.Entries[0], newJob)
}

func testReleaseReplayOnlyOwnClaim(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()
	e := pushReplayEntry(t, s)
	owner, stranger := id.NewJobID(), id.NewJobID()

	if err := s.ClaimReplay(ctx, e.ID, owner); err != nil {
		t.Fatalf("ClaimReplay: %v", err)
	}

	// A release for a job that does not hold the claim is a no-op: it is
	// how a replay whose enqueue failed cleans up, and by then someone
	// else may legitimately own the entry.
	if err := s.ReleaseReplay(ctx, e.ID, stranger); err != nil {
		t.Fatalf("ReleaseReplay(stranger): %v", err)
	}
	assertClaimedBy(t, "after stranger release", mustGetDLQ(t, s, e.ID), owner)

	if err := s.ReleaseReplay(ctx, e.ID, owner); err != nil {
		t.Fatalf("ReleaseReplay(owner): %v", err)
	}
	assertUnclaimed(t, "after owner release", mustGetDLQ(t, s, e.ID))

	// Released means claimable again.
	next := id.NewJobID()
	if err := s.ClaimReplay(ctx, e.ID, next); err != nil {
		t.Fatalf("ClaimReplay after release: %v", err)
	}
	assertClaimedBy(t, "after reclaim", mustGetDLQ(t, s, e.ID), next)
}

func testReleaseReplayUnclaimed(t *testing.T, s DLQReplayStore) {
	e := pushReplayEntry(t, s)

	if err := s.ReleaseReplay(context.Background(), e.ID, id.NewJobID()); err != nil {
		t.Fatalf("ReleaseReplay(unclaimed): %v", err)
	}
	assertUnclaimed(t, "after release of unclaimed", mustGetDLQ(t, s, e.ID))
}

func testReleaseReplayUnknownEntry(t *testing.T, s DLQReplayStore) {
	err := s.ReleaseReplay(context.Background(), id.NewDLQID(), id.NewJobID())
	if !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Fatalf("ReleaseReplay(unknown) error = %v, want ErrDLQNotFound", err)
	}
}

// testGetDLQByJobIDNewest pushes two entries for one job, the older ID
// with the later FailedAt, so a backend that picks by FailedAt instead of
// by ID returns the wrong one.
func testGetDLQByJobIDNewest(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	queue := replayQueue()
	jobID := id.NewJobID()

	older := replayEntry(jobID, queue, now)
	newer := replayEntry(jobID, queue, now.Add(-time.Hour))
	newer.Error = "second failure"
	neighbour := replayEntry(id.NewJobID(), queue, now)

	for _, e := range []*dlq.Entry{older, newer, neighbour} {
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("PushDLQ: %v", err)
		}
	}

	got, err := s.GetDLQByJobID(ctx, jobID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}
	if got.ID != newer.ID {
		t.Fatalf("GetDLQByJobID = %s, want the newer entry %s (older %s)", got.ID, newer.ID, older.ID)
	}
	if got.JobID != jobID || got.Error != newer.Error || got.Queue != queue {
		t.Errorf("GetDLQByJobID = {job %s, error %q, queue %q}, want {job %s, error %q, queue %q}",
			got.JobID, got.Error, got.Queue, jobID, newer.Error, queue)
	}
}

func testGetDLQByJobIDUnknown(t *testing.T, s DLQReplayStore) {
	_, err := s.GetDLQByJobID(context.Background(), id.NewJobID())
	if !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Fatalf("GetDLQByJobID(unknown) error = %v, want ErrDLQNotFound", err)
	}
}

func testDeleteDLQ(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()
	gone := pushReplayEntry(t, s)
	kept := pushReplayEntry(t, s)

	if err := s.DeleteDLQ(ctx, gone.ID); err != nil {
		t.Fatalf("DeleteDLQ: %v", err)
	}

	if _, err := s.GetDLQ(ctx, gone.ID); !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Errorf("GetDLQ(deleted) error = %v, want ErrDLQNotFound", err)
	}
	if _, err := s.GetDLQByJobID(ctx, gone.JobID); !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Errorf("GetDLQByJobID(deleted) error = %v, want ErrDLQNotFound", err)
	}
	mustGetDLQ(t, s, kept.ID)

	if err := s.DeleteDLQ(ctx, gone.ID); !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Errorf("second DeleteDLQ error = %v, want ErrDLQNotFound", err)
	}
}

func testPushDLQDuplicate(t *testing.T, s DLQReplayStore) {
	ctx := context.Background()
	e := pushReplayEntry(t, s)

	dup := *e
	dup.Error = "overwritten"
	dup.Queue = replayQueue()

	err := s.PushDLQ(ctx, &dup)
	if !errors.Is(err, dispatch.ErrDLQAlreadyExists) {
		t.Fatalf("PushDLQ(duplicate ID) error = %v, want ErrDLQAlreadyExists", err)
	}

	got := mustGetDLQ(t, s, e.ID)
	if got.Error != e.Error || got.Queue != e.Queue {
		t.Errorf("after refused push: {error %q, queue %q}, want the original {%q, %q}",
			got.Error, got.Queue, e.Error, e.Queue)
	}
}
```

- [ ] **Step 6: Write the cron suite**

Create `store/storetest/cron.go`:

```go
package storetest

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
)

// CronStore is what the cron suite requires: the base cron store plus the
// targeted writes the scheduler and the operator actions use.
type CronStore interface {
	cron.Store
	cron.TargetedUpdater
}

// RunCronSuite pins the targeted cron writes: each changes only the fields
// it names. The load-bearing case is DisableSurvivesAFire, the regression
// that let a disabled cron come back when the scheduler wrote its whole
// stale row after firing.
//
// newStore may return a shared store, so every case registers its own
// entry under a unique name and never lists or counts.
func RunCronSuite(t *testing.T, newStore func(t *testing.T) CronStore) {
	t.Helper()

	cases := []struct {
		name string
		fn   func(t *testing.T, s CronStore)
	}{
		{"SetCronEnabledLeavesOtherFieldsAlone", testSetCronEnabledLeavesOthers},
		{"SetCronEnabledNilNextRunKeepsNextRun", testSetCronEnabledNilNextRun},
		{"UpdateCronNextRunLeavesOtherFieldsAlone", testUpdateCronNextRunLeavesOthers},
		{"DisableSurvivesAFire", testCronDisableSurvivesAFire},
		{"TargetedWritesUnknownEntry", testCronTargetedUnknown},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.fn(t, newStore(t))
		})
	}
}

// registerCron stores an entry with every field set to something distinct,
// takes its lock, and returns it as the store reads it back. Comparing
// store reads with store reads keeps each backend's time precision out of
// the comparison.
func registerCron(t *testing.T, s CronStore, enabled bool) *cron.Entry {
	t.Helper()

	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	lastRun := now.Add(-5 * time.Minute)
	nextRun := now.Add(5 * time.Minute)

	cronID := id.NewCronID()
	e := &cron.Entry{
		Entity:     dispatch.NewEntity(),
		ID:         cronID,
		Name:       "storetest-cron-" + cronID.String(),
		Schedule:   "*/5 * * * *",
		JobName:    "cron-suite-job",
		Queue:      "cron-suite",
		Payload:    []byte(`{"report":"daily"}`),
		ScopeAppID: "app_cron",
		ScopeOrgID: "org_cron",
		LastRunAt:  &lastRun,
		NextRunAt:  &nextRun,
		Enabled:    enabled,
	}
	if err := s.RegisterCron(ctx, e); err != nil {
		t.Fatalf("RegisterCron: %v", err)
	}

	locked, err := s.AcquireCronLock(ctx, e.ID, id.NewWorkerID(), time.Hour)
	if err != nil {
		t.Fatalf("AcquireCronLock: %v", err)
	}
	if !locked {
		t.Fatal("AcquireCronLock on a fresh entry = false, want true")
	}

	return mustGetCron(t, s, e.ID)
}

// mustGetCron reads an entry and returns a copy of it, so a store that
// hands out its own pointer cannot change a snapshot behind the test.
func mustGetCron(t *testing.T, s CronStore, entryID id.CronID) *cron.Entry {
	t.Helper()

	got, err := s.GetCron(context.Background(), entryID)
	if err != nil {
		t.Fatalf("GetCron(%s): %v", entryID, err)
	}
	snapshot := *got

	return &snapshot
}

func timePtrEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	return a.Equal(*b)
}

func fmtTimePtr(p *time.Time) string {
	if p == nil {
		return "nil"
	}

	return p.Format(time.RFC3339Nano)
}

// assertCronUntouched checks every field neither targeted write may
// change. Enabled, NextRunAt and UpdatedAt are each case's to check.
func assertCronUntouched(t *testing.T, label string, before, after *cron.Entry) {
	t.Helper()

	if after.ID != before.ID {
		t.Errorf("%s: ID = %s, want %s", label, after.ID, before.ID)
	}
	if after.Name != before.Name {
		t.Errorf("%s: Name = %q, want %q", label, after.Name, before.Name)
	}
	if after.Schedule != before.Schedule {
		t.Errorf("%s: Schedule = %q, want %q", label, after.Schedule, before.Schedule)
	}
	if after.JobName != before.JobName {
		t.Errorf("%s: JobName = %q, want %q", label, after.JobName, before.JobName)
	}
	if after.Queue != before.Queue {
		t.Errorf("%s: Queue = %q, want %q", label, after.Queue, before.Queue)
	}
	if !bytes.Equal(after.Payload, before.Payload) {
		t.Errorf("%s: Payload = %q, want %q", label, after.Payload, before.Payload)
	}
	if after.ScopeAppID != before.ScopeAppID || after.ScopeOrgID != before.ScopeOrgID {
		t.Errorf("%s: scope = %q/%q, want %q/%q", label,
			after.ScopeAppID, after.ScopeOrgID, before.ScopeAppID, before.ScopeOrgID)
	}
	if !timePtrEqual(after.LastRunAt, before.LastRunAt) {
		t.Errorf("%s: LastRunAt = %s, want %s", label, fmtTimePtr(after.LastRunAt), fmtTimePtr(before.LastRunAt))
	}
	if after.LockedBy != before.LockedBy {
		t.Errorf("%s: LockedBy = %q, want %q", label, after.LockedBy, before.LockedBy)
	}
	if !timePtrEqual(after.LockedUntil, before.LockedUntil) {
		t.Errorf("%s: LockedUntil = %s, want %s", label, fmtTimePtr(after.LockedUntil), fmtTimePtr(before.LockedUntil))
	}
	if !after.CreatedAt.Equal(before.CreatedAt) {
		t.Errorf("%s: CreatedAt = %v, want %v", label, after.CreatedAt, before.CreatedAt)
	}
	if after.UpdatedAt.Before(before.UpdatedAt) {
		t.Errorf("%s: UpdatedAt went backwards: %v, was %v", label, after.UpdatedAt, before.UpdatedAt)
	}
}

func testSetCronEnabledLeavesOthers(t *testing.T, s CronStore) {
	ctx := context.Background()
	before := registerCron(t, s, false)
	next := time.Now().UTC().Add(time.Hour).Truncate(time.Millisecond)

	if err := s.SetCronEnabled(ctx, before.ID, true, &next); err != nil {
		t.Fatalf("SetCronEnabled(true): %v", err)
	}

	after := mustGetCron(t, s, before.ID)
	if !after.Enabled {
		t.Error("Enabled = false after SetCronEnabled(true)")
	}
	if !timePtrEqual(after.NextRunAt, &next) {
		t.Errorf("NextRunAt = %s, want %s", fmtTimePtr(after.NextRunAt), fmtTimePtr(&next))
	}
	assertCronUntouched(t, "SetCronEnabled(true)", before, after)
}

func testSetCronEnabledNilNextRun(t *testing.T, s CronStore) {
	ctx := context.Background()
	before := registerCron(t, s, true)

	if err := s.SetCronEnabled(ctx, before.ID, false, nil); err != nil {
		t.Fatalf("SetCronEnabled(false, nil): %v", err)
	}

	after := mustGetCron(t, s, before.ID)
	if after.Enabled {
		t.Error("Enabled = true after SetCronEnabled(false)")
	}
	if !timePtrEqual(after.NextRunAt, before.NextRunAt) {
		t.Errorf("NextRunAt = %s, want it left at %s", fmtTimePtr(after.NextRunAt), fmtTimePtr(before.NextRunAt))
	}
	assertCronUntouched(t, "SetCronEnabled(false, nil)", before, after)
}

func testUpdateCronNextRunLeavesOthers(t *testing.T, s CronStore) {
	ctx := context.Background()
	before := registerCron(t, s, true)
	next := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Millisecond)

	if err := s.UpdateCronNextRun(ctx, before.ID, next); err != nil {
		t.Fatalf("UpdateCronNextRun: %v", err)
	}

	after := mustGetCron(t, s, before.ID)
	if !after.Enabled {
		t.Error("Enabled = false after UpdateCronNextRun on an enabled entry")
	}
	if !timePtrEqual(after.NextRunAt, &next) {
		t.Errorf("NextRunAt = %s, want %s", fmtTimePtr(after.NextRunAt), fmtTimePtr(&next))
	}
	assertCronUntouched(t, "UpdateCronNextRun", before, after)
}

// testCronDisableSurvivesAFire is the regression. An operator disables an
// enabled entry, then the scheduler, which read the entry before the
// disable, records its next fire. The entry must stay disabled.
func testCronDisableSurvivesAFire(t *testing.T, s CronStore) {
	ctx := context.Background()
	entry := registerCron(t, s, true)

	if err := s.SetCronEnabled(ctx, entry.ID, false, nil); err != nil {
		t.Fatalf("SetCronEnabled(false): %v", err)
	}
	disabled := mustGetCron(t, s, entry.ID)
	if disabled.Enabled {
		t.Fatal("Enabled = true right after SetCronEnabled(false)")
	}

	// What the scheduler does after a fire.
	next := time.Now().UTC().Add(5 * time.Minute).Truncate(time.Millisecond)
	if err := s.UpdateCronNextRun(ctx, entry.ID, next); err != nil {
		t.Fatalf("UpdateCronNextRun: %v", err)
	}

	after := mustGetCron(t, s, entry.ID)
	if after.Enabled {
		t.Fatal("a disabled cron came back enabled after the scheduler recorded its next run")
	}
	if !timePtrEqual(after.NextRunAt, &next) {
		t.Errorf("NextRunAt = %s, want %s", fmtTimePtr(after.NextRunAt), fmtTimePtr(&next))
	}
	assertCronUntouched(t, "fire after disable", disabled, after)
}

func testCronTargetedUnknown(t *testing.T, s CronStore) {
	ctx := context.Background()
	next := time.Now().UTC()

	if err := s.SetCronEnabled(ctx, id.NewCronID(), true, &next); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("SetCronEnabled(unknown) error = %v, want ErrCronNotFound", err)
	}
	if err := s.UpdateCronNextRun(ctx, id.NewCronID(), next); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("UpdateCronNextRun(unknown) error = %v, want ErrCronNotFound", err)
	}
}
```

- [ ] **Step 7: Write the workflow suite**

Create `store/storetest/workflow.go`:

```go
package storetest

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

// WorkflowStore is what the workflow suite requires: the base workflow
// store plus the reopen claim replay-from-step is built on.
type WorkflowStore interface {
	workflow.Store
	workflow.Reopener
}

// concurrentReopeners is how many goroutines race to reopen one run.
const concurrentReopeners = 16

// RunWorkflowSuite pins ReopenRun, the claim that makes replay-from-step
// safe, and the parent link child runs are found by.
//
// Run it with `go test -race`. ReopenRunConcurrentExactlyOneWinner proves
// the claim is atomic, and an unguarded read-then-write only loses that
// race reliably under the detector.
//
// newStore may return a shared store, so every case creates its own runs
// and never lists or counts anything but its own parent's children.
func RunWorkflowSuite(t *testing.T, newStore func(t *testing.T) WorkflowStore) {
	t.Helper()

	cases := []struct {
		name string
		fn   func(t *testing.T, s WorkflowStore)
	}{
		{"ReopenFailedRunClearsErrorAndCompletion", testReopenFailedRun},
		{"ReopenCompletedRun", testReopenCompletedRun},
		{"ReopenRunningRunIsRefused", testReopenRunningRun},
		{"ReopenRunUnknown", testReopenUnknownRun},
		{"ReopenRunConcurrentExactlyOneWinner", testReopenRunConcurrent},
		{"ParentRunIDRoundTripsAndListChildRuns", testParentRunIDAndChildren},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.fn(t, newStore(t))
		})
	}
}

// createSuiteRun stores a run in the given state with every field the
// reopen must leave alone set to something distinct. A finished run also
// gets an error and a completion time, the two fields reopen clears.
func createSuiteRun(t *testing.T, s WorkflowStore, state workflow.RunState) *workflow.Run {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Millisecond)
	r := &workflow.Run{
		Entity:     dispatch.NewEntity(),
		ID:         id.NewRunID(),
		Name:       "workflow-suite",
		State:      state,
		Input:      []byte(`{"order":7}`),
		ScopeAppID: "app_wf",
		ScopeOrgID: "org_wf",
		StartedAt:  now.Add(-time.Minute),
		Version:    3,
	}
	if state != workflow.RunStateRunning {
		completed := now
		r.Output = []byte(`{"partial":true}`)
		r.Error = "step charge failed"
		r.CompletedAt = &completed
	}

	if err := s.CreateRun(context.Background(), r); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	return mustGetRun(t, s, r.ID)
}

// mustGetRun reads a run and returns a copy of it, so a store that hands
// out its own pointer cannot change a snapshot behind the test.
func mustGetRun(t *testing.T, s WorkflowStore, runID id.RunID) *workflow.Run {
	t.Helper()

	got, err := s.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("GetRun(%s): %v", runID, err)
	}
	snapshot := *got

	return &snapshot
}

// assertReopened checks the three fields reopen writes and every field it
// must leave alone.
func assertReopened(t *testing.T, before, after *workflow.Run) {
	t.Helper()

	if after.State != workflow.RunStateRunning {
		t.Errorf("State = %s, want running", after.State)
	}
	if after.Error != "" {
		t.Errorf("Error = %q, want it cleared", after.Error)
	}
	if after.CompletedAt != nil {
		t.Errorf("CompletedAt = %v, want nil", *after.CompletedAt)
	}

	if after.Name != before.Name {
		t.Errorf("Name = %q, want %q", after.Name, before.Name)
	}
	if !bytes.Equal(after.Input, before.Input) {
		t.Errorf("Input = %q, want %q", after.Input, before.Input)
	}
	if !bytes.Equal(after.Output, before.Output) {
		t.Errorf("Output = %q, want %q", after.Output, before.Output)
	}
	if after.ScopeAppID != before.ScopeAppID || after.ScopeOrgID != before.ScopeOrgID {
		t.Errorf("scope = %q/%q, want %q/%q",
			after.ScopeAppID, after.ScopeOrgID, before.ScopeAppID, before.ScopeOrgID)
	}
	if !after.StartedAt.Equal(before.StartedAt) {
		t.Errorf("StartedAt = %v, want %v", after.StartedAt, before.StartedAt)
	}
	if after.Version != before.Version {
		t.Errorf("Version = %d, want %d", after.Version, before.Version)
	}
	if !after.CreatedAt.Equal(before.CreatedAt) {
		t.Errorf("CreatedAt = %v, want %v", after.CreatedAt, before.CreatedAt)
	}
}

func testReopenFailedRun(t *testing.T, s WorkflowStore) {
	before := createSuiteRun(t, s, workflow.RunStateFailed)

	if err := s.ReopenRun(context.Background(), before.ID); err != nil {
		t.Fatalf("ReopenRun(failed): %v", err)
	}

	assertReopened(t, before, mustGetRun(t, s, before.ID))
}

func testReopenCompletedRun(t *testing.T, s WorkflowStore) {
	before := createSuiteRun(t, s, workflow.RunStateCompleted)

	if err := s.ReopenRun(context.Background(), before.ID); err != nil {
		t.Fatalf("ReopenRun(completed): %v", err)
	}

	assertReopened(t, before, mustGetRun(t, s, before.ID))
}

func testReopenRunningRun(t *testing.T, s WorkflowStore) {
	before := createSuiteRun(t, s, workflow.RunStateRunning)

	err := s.ReopenRun(context.Background(), before.ID)
	if !errors.Is(err, dispatch.ErrInvalidState) {
		t.Fatalf("ReopenRun(running) error = %v, want one wrapping ErrInvalidState", err)
	}

	after := mustGetRun(t, s, before.ID)
	if after.State != workflow.RunStateRunning {
		t.Errorf("State = %s after a refused reopen, want running", after.State)
	}
}

func testReopenUnknownRun(t *testing.T, s WorkflowStore) {
	err := s.ReopenRun(context.Background(), id.NewRunID())
	if !errors.Is(err, dispatch.ErrRunNotFound) {
		t.Fatalf("ReopenRun(unknown) error = %v, want ErrRunNotFound", err)
	}
}

func testReopenRunConcurrent(t *testing.T, s WorkflowStore) {
	ctx := context.Background()

	for round := range concurrentRounds {
		run := createSuiteRun(t, s, workflow.RunStateFailed)

		res := raceAttempts(concurrentReopeners, dispatch.ErrInvalidState, func(int) error {
			return s.ReopenRun(ctx, run.ID)
		})
		res.assertOneWinner(t, fmt.Sprintf("round %d: concurrent ReopenRun", round))

		if got := mustGetRun(t, s, run.ID); got.State != workflow.RunStateRunning {
			t.Errorf("round %d: State = %s after the race, want running", round, got.State)
		}
	}
}

func testParentRunIDAndChildren(t *testing.T, s WorkflowStore) {
	ctx := context.Background()
	parent := createSuiteRun(t, s, workflow.RunStateRunning)

	parentID := parent.ID
	child := &workflow.Run{
		Entity:      dispatch.NewEntity(),
		ID:          id.NewRunID(),
		Name:        "workflow-suite-child",
		State:       workflow.RunStateRunning,
		StartedAt:   time.Now().UTC().Truncate(time.Millisecond),
		ParentRunID: &parentID,
	}
	if err := s.CreateRun(ctx, child); err != nil {
		t.Fatalf("CreateRun(child): %v", err)
	}

	if got := mustGetRun(t, s, parent.ID); got.ParentRunID != nil {
		t.Errorf("top-level run ParentRunID = %s, want nil", *got.ParentRunID)
	}

	got := mustGetRun(t, s, child.ID)
	if got.ParentRunID == nil {
		t.Fatalf("child ParentRunID = nil, want %s: the parent link was not stored", parent.ID)
	}
	if *got.ParentRunID != parent.ID {
		t.Errorf("child ParentRunID = %s, want %s", *got.ParentRunID, parent.ID)
	}

	children, err := s.ListChildRuns(ctx, parent.ID)
	if err != nil {
		t.Fatalf("ListChildRuns: %v", err)
	}
	if len(children) != 1 || children[0].ID != child.ID {
		ids := make([]string, len(children))
		for i, c := range children {
			ids[i] = c.ID.String()
		}
		t.Fatalf("ListChildRuns(parent) = %v, want only %s", ids, child.ID)
	}

	grandchildren, err := s.ListChildRuns(ctx, child.ID)
	if err != nil {
		t.Fatalf("ListChildRuns(child): %v", err)
	}
	if len(grandchildren) != 0 {
		t.Errorf("ListChildRuns(child) = %d runs, want none", len(grandchildren))
	}
}
```

Run: `go vet ./store/storetest/`
Expected: no output.

- [ ] **Step 8: Run the suites against memory and see them fail to compile**

Create `store/memory/operator_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/store/storetest"
)

func TestDLQReplayConformance(t *testing.T) {
	storetest.RunDLQReplaySuite(t, func(_ *testing.T) storetest.DLQReplayStore {
		return memory.New()
	})
}

func TestCronConformance(t *testing.T) {
	storetest.RunCronSuite(t, func(_ *testing.T) storetest.CronStore {
		return memory.New()
	})
}

func TestWorkflowConformance(t *testing.T) {
	storetest.RunWorkflowSuite(t, func(_ *testing.T) storetest.WorkflowStore {
		return memory.New()
	})
}
```

Run: `go test -count=1 ./store/memory/`
Expected:

```
# github.com/xraph/dispatch/store/memory_test [github.com/xraph/dispatch/store/memory.test]
store/memory/operator_test.go:12:10: cannot use memory.New() (value of type *memory.Store) as storetest.DLQReplayStore value in return statement: *memory.Store does not implement storetest.DLQReplayStore (missing method ClaimReplay)
store/memory/operator_test.go:18:10: cannot use memory.New() (value of type *memory.Store) as storetest.CronStore value in return statement: *memory.Store does not implement storetest.CronStore (missing method SetCronEnabled)
store/memory/operator_test.go:24:10: cannot use memory.New() (value of type *memory.Store) as storetest.WorkflowStore value in return statement: *memory.Store does not implement storetest.WorkflowStore (missing method ReopenRun)
FAIL	github.com/xraph/dispatch/store/memory [build failed]
```

- [ ] **Step 9: Implement the capabilities in the memory store**

The memory store keeps the caller's pointer when it creates a run, a cron entry or a DLQ entry, and `GetRun`, `GetCron` and `GetDLQ` hand that same pointer back. So these methods never write through the stored pointer: each replaces the map value with an updated copy, which leaves anything a caller already holds untouched and keeps the race detector quiet. `GetDLQByJobID` returns a deep copy.

Create `store/memory/operator.go`:

```go
package memory

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ dlq.ReplayClaimer    = (*Store)(nil)
	_ cron.TargetedUpdater = (*Store)(nil)
	_ workflow.Reopener    = (*Store)(nil)
)

// The writes below replace the stored struct with an updated copy rather
// than writing through the stored pointer. This store keeps the caller's
// pointer on create and GetDLQ, GetCron and GetRun hand that same pointer
// out, so an in-place write would change values a caller is holding, and
// race with any caller reading them.

// cloneDLQEntry deep-copies the fields of an entry that are reference
// types, for the reads that hand an entry out.
func cloneDLQEntry(e *dlq.Entry) *dlq.Entry {
	out := *e
	out.Resources = e.Resources.Clone()
	out.ResourceLimits = e.ResourceLimits.Clone()

	if e.Payload != nil {
		out.Payload = make([]byte, len(e.Payload))
		copy(out.Payload, e.Payload)
	}

	if e.ArtifactBindings != nil {
		out.ArtifactBindings = make([]byte, len(e.ArtifactBindings))
		copy(out.ArtifactBindings, e.ArtifactBindings)
	}

	return &out
}

// ClaimReplay marks an unreplayed entry replayed by jobID. The check and
// the write happen under one lock, so of two concurrent claims exactly
// one wins.
func (m *Store) ClaimReplay(_ context.Context, entryID id.DLQID, jobID id.JobID) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := entryID.String()
	e, ok := m.dlqs[key]
	if !ok {
		return dispatch.ErrDLQNotFound
	}
	if e.ReplayedAt != nil {
		return dispatch.ErrDLQAlreadyReplayed
	}

	now := time.Now().UTC()
	claimed := *e
	claimed.ReplayedAt = &now
	claimed.ReplayedJobID = &jobID
	m.dlqs[key] = &claimed

	return nil
}

// ReleaseReplay undoes a claim, but only the one jobID made.
func (m *Store) ReleaseReplay(_ context.Context, entryID id.DLQID, jobID id.JobID) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := entryID.String()
	e, ok := m.dlqs[key]
	if !ok {
		return dispatch.ErrDLQNotFound
	}
	if e.ReplayedJobID == nil || *e.ReplayedJobID != jobID {
		return nil
	}

	released := *e
	released.ReplayedAt = nil
	released.ReplayedJobID = nil
	m.dlqs[key] = &released

	return nil
}

// GetDLQByJobID returns the newest entry, by ID, for a failed job.
func (m *Store) GetDLQByJobID(_ context.Context, jobID id.JobID) (*dlq.Entry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var newest *dlq.Entry
	for _, e := range m.dlqs {
		if e.JobID != jobID {
			continue
		}
		if newest == nil || e.ID.String() > newest.ID.String() {
			newest = e
		}
	}
	if newest == nil {
		return nil, dispatch.ErrDLQNotFound
	}

	return cloneDLQEntry(newest), nil
}

// DeleteDLQ removes one entry.
func (m *Store) DeleteDLQ(_ context.Context, entryID id.DLQID) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := entryID.String()
	if _, ok := m.dlqs[key]; !ok {
		return dispatch.ErrDLQNotFound
	}
	delete(m.dlqs, key)

	return nil
}

// SetCronEnabled sets enabled, and next_run_at when one is given.
func (m *Store) SetCronEnabled(_ context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := entryID.String()
	e, ok := m.crons[key]
	if !ok {
		return dispatch.ErrCronNotFound
	}

	updated := *e
	updated.Enabled = enabled
	if nextRunAt != nil {
		next := *nextRunAt
		updated.NextRunAt = &next
	}
	updated.UpdatedAt = time.Now().UTC()
	m.crons[key] = &updated

	return nil
}

// UpdateCronNextRun sets next_run_at and nothing else the scheduler does
// not own.
func (m *Store) UpdateCronNextRun(_ context.Context, entryID id.CronID, nextRunAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := entryID.String()
	e, ok := m.crons[key]
	if !ok {
		return dispatch.ErrCronNotFound
	}

	updated := *e
	updated.NextRunAt = &nextRunAt
	updated.UpdatedAt = time.Now().UTC()
	m.crons[key] = &updated

	return nil
}

// ReopenRun moves a finished run back to running. The check and the write
// happen under one lock, so of two concurrent reopens exactly one wins.
func (m *Store) ReopenRun(_ context.Context, runID id.RunID) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := runID.String()
	r, ok := m.runs[key]
	if !ok {
		return dispatch.ErrRunNotFound
	}
	if r.State == workflow.RunStateRunning {
		return fmt.Errorf("%w: run %s is %s", dispatch.ErrInvalidState, runID, r.State)
	}

	reopened := *r
	reopened.State = workflow.RunStateRunning
	reopened.Error = ""
	reopened.CompletedAt = nil
	reopened.UpdatedAt = time.Now().UTC()
	m.runs[key] = &reopened

	return nil
}
```

Run: `go test -race -count=1 -run 'Conformance' ./store/memory/`
Expected: one failing case, because memory's `PushDLQ` still overwrites:

```
--- FAIL: TestDLQReplayConformance (0.00s)
    --- FAIL: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.00s)
        dlq_replay.go:440: PushDLQ(duplicate ID) error = <nil>, want ErrDLQAlreadyExists
FAIL
FAIL	github.com/xraph/dispatch/store/memory
```

- [ ] **Step 10: Refuse a duplicate push**

In `store/memory/store.go`, replace:

```go
// PushDLQ adds a failed job entry to the dead letter queue.
func (m *Store) PushDLQ(_ context.Context, entry *dlq.Entry) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.dlqs[entry.ID.String()] = entry
	return nil
}
```

with:

```go
// PushDLQ adds a failed job entry to the dead letter queue. An ID that is
// already there is refused with dispatch.ErrDLQAlreadyExists rather than
// overwritten, which would silently drop a replay claim.
func (m *Store) PushDLQ(_ context.Context, entry *dlq.Entry) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := entry.ID.String()
	if _, exists := m.dlqs[key]; exists {
		return dispatch.ErrDLQAlreadyExists
	}
	m.dlqs[key] = entry
	return nil
}
```

Run: `go test -race -count=1 -v -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance' ./store/memory/ 2>&1 | grep -E -- '--- |^ok'`
Expected:

```
--- PASS: TestDLQReplayConformance (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayFirstWins (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayConcurrentExactlyOneWinner (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/ReplayedJobIDReadsBackFromEveryPath (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnlyReleasesItsOwnClaim (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnUnclaimedEntryIsNoop (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDReturnsNewestByID (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDUnknownJob (0.00s)
    --- PASS: TestDLQReplayConformance/DeleteDLQRemovesOnlyThatEntry (0.00s)
    --- PASS: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.00s)
--- PASS: TestCronConformance (0.00s)
    --- PASS: TestCronConformance/SetCronEnabledLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/SetCronEnabledNilNextRunKeepsNextRun (0.00s)
    --- PASS: TestCronConformance/UpdateCronNextRunLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/DisableSurvivesAFire (0.00s)
    --- PASS: TestCronConformance/TargetedWritesUnknownEntry (0.00s)
--- PASS: TestWorkflowConformance (0.00s)
    --- PASS: TestWorkflowConformance/ReopenFailedRunClearsErrorAndCompletion (0.00s)
    --- PASS: TestWorkflowConformance/ReopenCompletedRun (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunningRunIsRefused (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunUnknown (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunConcurrentExactlyOneWinner (0.00s)
    --- PASS: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.00s)
ok  	github.com/xraph/dispatch/store/memory
```

- [ ] **Step 11: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./store/memory/... ./store/storetest/... ./dlq/... ./cron/... ./workflow/...
go vet -tags integration ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: no FAIL lines from `go test ./...`; five `ok` lines from the race run; no output from `go vet -tags integration` (this is what proves the four other backends, whose integration tests call `RunDLQSuite`, still compile); `0 issues.` from the first lint; the second lint reports only the pre-existing `store/redis/store_test.go:54:5: shadow: declaration of "err"` (govet), which is not this task's.

Checked on 2026-10-07: a mutant `ClaimReplay` that reads under `RLock`, unlocks, then writes under `Lock` failed `ClaimReplayConcurrentExactlyOneWinner` in 10 of 10 runs under `-race`, and the same mutant of `ReopenRun` failed `ReopenRunConcurrentExactlyOneWinner` 10 of 10. Before the spin barrier in `raceAttempts`, the goroutines serialized by accident and the DLQ mutant slipped through about half the time.

- [ ] **Step 12: Commit**

```bash
git add dlq/claim.go cron/targeted.go workflow/reopen.go \
  store/storetest/dlq_replay.go store/storetest/cron.go store/storetest/workflow.go \
  store/memory/operator.go store/memory/operator_test.go
git commit --only -m "feat(store): add the replay claim, targeted cron writes and run reopen, with a memory reference

Operator actions need store writes that check and change in one step.
ClaimReplay marks a dead letter entry replayed by one job, and only if
nobody got there first, so two replays of the same failure can't both
enqueue a job. SetCronEnabled and UpdateCronNextRun write only their own
columns, which means the scheduler's write after a fire can no longer
bring a disabled cron back. ReopenRun moves a finished run back to
running for exactly one caller.

Each is a capability interface for now. Each has its own conformance
suite (RunDLQReplaySuite, RunCronSuite, RunWorkflowSuite), and the
memory store passes all three under -race. The other backends compile
unchanged and wire the suites in their own commits. Memory's PushDLQ
also refuses a duplicate ID with ErrDLQAlreadyExists, where it used to
overwrite the entry." -- errors.go dlq/entry.go dlq/claim.go cron/targeted.go workflow/reopen.go \
  store/storetest/dlq_replay.go store/storetest/cron.go store/storetest/workflow.go \
  store/memory/operator.go store/memory/operator_test.go store/memory/store.go
git show --stat HEAD | tail -12
```

Expected: 11 files changed.

Notes for later tasks:
- Each backend task wires all three suites in its own test file: `storetest.RunDLQReplaySuite`, `storetest.RunCronSuite`, `storetest.RunWorkflowSuite`, with the same `newStore` it passes to `RunDLQSuite`. Known gaps the suites will expose: postgres, sqlite and mongo return a wrapped driver error on a duplicate `PushDLQ`, not `ErrDLQAlreadyExists` (wrap with `%w` or map the unique violation); redis overwrites on a duplicate push; redis drops `Run.ParentRunID` in `runEntity`, which fails `ParentRunIDRoundTripsAndListChildRuns`.
- `ReplayedJobIDReadsBackFromEveryPath` reads the claimed entry through `GetDLQ`, `GetDLQByJobID`, `ListDLQ` and `ListDLQPage`, so a backend has to add `replayed_job_id` to every mapper, not just the one `GetDLQ` uses.
- The memory store's pre-existing `ReplayDLQ`, `UpdateCronLastRun`, `AcquireCronLock` and `UpdateRun` still write through or store the caller's pointer. This task does not change them.

---

### Task 2: Postgres implements the replay claim, targeted cron writes and run reopen

Task 1 defined three conditional writes and their suites, and only the memory store passes them. This task makes Postgres pass all three. Each write is one UPDATE with its condition in the WHERE clause, so Postgres settles the race: a second UPDATE of the same row waits for the first to commit, re-checks its WHERE against the row the first one wrote, and matches nothing. When nothing matches, a count tells a missing row from a refused one. `PushDLQ` maps the primary key violation to `dispatch.ErrDLQAlreadyExists`, the way `EnqueueJob`, `RegisterCron` and `CreateRun` already map theirs through `isDuplicateKey` (`ON CONFLICT DO NOTHING` would work too, but it would be the only insert in the store doing it that way, and `dispatch_dlq` has no unique constraint but the key, so the mapping can't misread another violation).

Two migrations go on the end of the list. `dlq_replayed_job_id` adds the nullable `replayed_job_id` column and a `(job_id, id)` index for `GetDLQByJobID`. `workflow_run_version_parent` is a scope addition the coordinator confirmed while this task was being drafted: `dispatch_workflow_runs` never had `version` or `parent_run_id`, and `workflowRunModel` carried neither. A child run read back as top-level, `ListChildRuns` failed outright on a column that does not exist (it is the `ParentRunIDRoundTripsAndListChildRuns` case of the workflow suite), and every run read back as version 0, which the registry resolves to the newest definition, so a run would resume or replay on a definition it was not started on. Both indexes are built `CONCURRENTLY`, with an invalid leftover dropped first, exactly like `list_order_indexes`.

**Files:**
- Create: `store/postgres/operator.go`
- Modify: `store/postgres/models.go` (`dlqEntryModel`, `toDLQModel`, `fromDLQModel`, `workflowRunModel`, `toRunModel`, `fromRunModel`)
- Modify: `store/postgres/migrations.go` (append two migrations after `list_order_indexes`, inside the `Migrations.MustRegister(...)` call in `init`)
- Modify: `store/postgres/dlq.go` (`PushDLQ`)
- Test: `store/postgres/operator_test.go` (create), `store/postgres/operator_schema_test.go` (create)

**Interfaces:**
- Consumes (from Task 1): `dlq.ReplayClaimer`, `cron.TargetedUpdater`, `workflow.Reopener`, `dlq.Entry.ReplayedJobID`, `dispatch.ErrDLQAlreadyExists`, `dispatch.ErrDLQAlreadyReplayed`, `storetest.RunDLQReplaySuite`, `storetest.RunCronSuite`, `storetest.RunWorkflowSuite`. From the existing postgres tests: `setupTestStore`, `remigrate`, `indexIsValid`, `listIndex`, `selectCapture`, `capturedSelect`, `explain`.
- Produces:

```go
package postgres
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error)
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error
// PushDLQ now returns dispatch.ErrDLQAlreadyExists for an existing ID.
// workflow.Run.Version and ParentRunID now persist on every run read and write path.
```

Schema: `dispatch_dlq.replayed_job_id TEXT NULL`, index `idx_dispatch_dlq_job ON dispatch_dlq (job_id, id)` (migration `20261009120000` `dlq_replayed_job_id`); `dispatch_workflow_runs.version INT NOT NULL DEFAULT 0`, `dispatch_workflow_runs.parent_run_id TEXT NULL`, partial index `idx_dispatch_workflow_runs_parent ON dispatch_workflow_runs (parent_run_id, id) WHERE parent_run_id IS NOT NULL` (migration `20261009130000` `workflow_run_version_parent`). The index is partial because most runs have no parent; a lookup by `parent_run_id = $1` implies the predicate, so the planner still uses it.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- store/postgres && git log --oneline -3`
Expected: no lines from `git status`, and Task 1's commit (`feat(store): add the replay claim, targeted cron writes and run reopen, with a memory reference`) in the log. If another session has uncommitted edits under `store/postgres`, stop and report.

- [ ] **Step 2: Wire the three suites against Postgres**

Create `store/postgres/operator_test.go`. Each suite shares one container, the way `TestListConformance` in `list_test.go` does: the suites isolate every case by its own entries, crons and runs.

```go
//go:build integration

package postgres_test

import (
	"testing"

	"github.com/xraph/dispatch/store/storetest"
)

// The operator action suites share one container each, the way
// TestListConformance does: every case works on entries, crons and runs it
// created itself and never asserts a total.

func TestDLQReplayConformance(t *testing.T) {
	shared := setupTestStore(t)

	storetest.RunDLQReplaySuite(t, func(t *testing.T) storetest.DLQReplayStore {
		t.Helper()

		return shared
	})
}

func TestCronConformance(t *testing.T) {
	shared := setupTestStore(t)

	storetest.RunCronSuite(t, func(t *testing.T) storetest.CronStore {
		t.Helper()

		return shared
	})
}

func TestWorkflowConformance(t *testing.T) {
	shared := setupTestStore(t)

	storetest.RunWorkflowSuite(t, func(t *testing.T) storetest.WorkflowStore {
		t.Helper()

		return shared
	})
}
```

- [ ] **Step 3: Write the schema tests**

Create `store/postgres/operator_schema_test.go`. It reuses `listIndex` and `explain`/`selectCapture` from `list_index_test.go` and `remigrate`/`indexIsValid` from `migrations_test.go`. `TestRunVersionAndParentRoundTrip` exists because the shared workflow suite compares a run with itself before and after a reopen, so a version that always read back as 0 would still pass it.

```go
//go:build integration

package postgres_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/xraph/grove/driver"
	"github.com/xraph/grove/drivers/pgdriver"
	"github.com/xraph/grove/hook"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/store/postgres"
	"github.com/xraph/dispatch/workflow"
)

// dlqReplayMigrationVersion is the version string of dlq_replayed_job_id,
// restated so a test can delete its bookkeeping row and force a re-run.
const dlqReplayMigrationVersion = "20261009120000"

// operatorColumns are the columns dlq_replayed_job_id and
// workflow_run_version_parent add, as information_schema reports them.
var operatorColumns = []struct {
	table, column, dataType, nullable string
}{
	{"dispatch_dlq", "replayed_job_id", "text", "YES"},
	{"dispatch_workflow_runs", "parent_run_id", "text", "YES"},
	{"dispatch_workflow_runs", "version", "integer", "NO"},
}

// operatorIndexes are the indexes the two migrations build, with the tail
// of the definition Postgres reports for each in pg_indexes.
var operatorIndexes = []listIndex{
	{"idx_dispatch_dlq_job", "dispatch_dlq", "USING btree (job_id, id)"},
	{
		"idx_dispatch_workflow_runs_parent", "dispatch_workflow_runs",
		"USING btree (parent_run_id, id) WHERE (parent_run_id IS NOT NULL)",
	},
}

// assertOperatorSchema checks every column the two migrations add, and
// every index they build is on the right table with the right columns
// and is valid. Valid matters for the same reason as on the list
// indexes: both are built CONCURRENTLY.
func assertOperatorSchema(t *testing.T, conn driver.DedicatedConn) {
	t.Helper()

	ctx := context.Background()

	for _, col := range operatorColumns {
		var dataType, nullable string

		err := conn.QueryRow(ctx, `
			SELECT data_type, is_nullable FROM information_schema.columns
			WHERE table_name = $1 AND column_name = $2`,
			col.table, col.column,
		).Scan(&dataType, &nullable)
		if err != nil {
			t.Errorf("%s.%s: not in information_schema: %v", col.table, col.column, err)

			continue
		}

		if dataType != col.dataType || nullable != col.nullable {
			t.Errorf("%s.%s: %s nullable=%s, want %s nullable=%s",
				col.table, col.column, dataType, nullable, col.dataType, col.nullable)
		}
	}

	for _, ix := range operatorIndexes {
		var table, def string

		err := conn.QueryRow(ctx,
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

func dedicatedConn(t *testing.T, s *postgres.Store) driver.DedicatedConn {
	t.Helper()

	conn, err := pgdriver.Unwrap(s.DB()).AcquireConn(context.Background())
	if err != nil {
		t.Fatalf("acquire dedicated conn: %v", err)
	}

	t.Cleanup(conn.Release)

	return conn
}

func TestOperatorSchemaAfterMigrate(t *testing.T) {
	s := setupTestStore(t)

	assertOperatorSchema(t, dedicatedConn(t, s))
}

// TestOperatorSchemaSurvivesASecondMigrate runs the whole group again the
// way every pod start does. Every statement is IF NOT EXISTS and each
// index is dropped only when INVALID, so a second run must change nothing.
func TestOperatorSchemaSurvivesASecondMigrate(t *testing.T) {
	s := setupTestStore(t)

	remigrate(t, s)
	remigrate(t, s)

	assertOperatorSchema(t, dedicatedConn(t, s))
}

// TestDLQJobIndexConvergesFromAnInvalidIndex is why dlq_replayed_job_id
// drops an invalid leftover before building: CREATE INDEX CONCURRENTLY IF
// NOT EXISTS would see the unusable index, skip it, and report success.
func TestDLQJobIndexConvergesFromAnInvalidIndex(t *testing.T) {
	s := setupTestStore(t)
	ctx := context.Background()
	conn := dedicatedConn(t, s)

	// The catalog state a failed CONCURRENTLY build leaves behind.
	if _, err := conn.Exec(ctx, `
		UPDATE pg_index SET indisvalid = false
		WHERE indexrelid = 'idx_dispatch_dlq_job'::regclass`); err != nil {
		t.Fatalf("mark the index invalid: %v", err)
	}

	if _, valid := indexIsValid(t, conn, "idx_dispatch_dlq_job"); valid {
		t.Fatal("fixture is wrong: the index should be INVALID")
	}

	if _, err := conn.Exec(ctx,
		`DELETE FROM grove_migrations WHERE version = $1`, dlqReplayMigrationVersion); err != nil {
		t.Fatalf("delete migration row: %v", err)
	}

	remigrate(t, s)

	if exists, valid := indexIsValid(t, conn, "idx_dispatch_dlq_job"); !exists || !valid {
		t.Errorf("after the retry idx_dispatch_dlq_job exists=%v valid=%v, want both", exists, valid)
	}
}

// TestGetDLQByJobIDReadsTheJobIndex checks the statement GetDLQByJobID
// sends is answered by walking idx_dispatch_dlq_job backwards: job_id is
// the index condition and the newest entry is the first row read.
func TestGetDLQByJobIDReadsTheJobIndex(t *testing.T) {
	s := setupTestStore(t)
	ctx := context.Background()

	// grove runs post-query hooks only for a query that succeeded, and a
	// miss comes back as sql.ErrNoRows, so give the lookup a row to find.
	now := time.Now().UTC()
	e := &dlq.Entry{
		ID: id.NewDLQID(), JobID: id.NewJobID(), JobName: "plan", Queue: "plan",
		Payload: []byte(`{}`), Error: "boom", FailedAt: now, CreatedAt: now,
	}
	if err := s.PushDLQ(ctx, e); err != nil {
		t.Fatalf("PushDLQ: %v", err)
	}

	capture := &selectCapture{last: map[string]capturedSelect{}}
	s.DB().Hooks().AddHook(capture, hook.Scope{Operations: []hook.Operation{hook.OpSelect}})

	if _, err := s.GetDLQByJobID(ctx, e.JobID); err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	plan := explain(t, s, capture.take(t, "dispatch_dlq"))

	if !strings.Contains(plan, "Index Scan Backward using idx_dispatch_dlq_job ") {
		t.Errorf("plan does not walk idx_dispatch_dlq_job backwards:\n%s", plan)
	}
}

// TestRunVersionAndParentRoundTrip covers what the shared workflow suite
// cannot see missing. It compares a run with itself before and after a
// reopen, so a version that always read back as 0 would still pass it.
// Every read path goes through the same converter, but each is read here
// anyway, and after each write that rewrites or touches the row.
func TestRunVersionAndParentRoundTrip(t *testing.T) {
	s := setupTestStore(t)
	ctx := context.Background()

	parent := &workflow.Run{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewRunID(),
		Name:      "versioned-parent-" + id.NewRunID().String(),
		State:     workflow.RunStateRunning,
		StartedAt: time.Now().UTC(),
		Version:   3,
	}
	parentID := parent.ID
	child := &workflow.Run{
		Entity:      dispatch.NewEntity(),
		ID:          id.NewRunID(),
		Name:        parent.Name + "-child",
		State:       workflow.RunStateFailed,
		StartedAt:   time.Now().UTC(),
		Version:     3,
		ParentRunID: &parentID,
	}
	for _, r := range []*workflow.Run{parent, child} {
		if err := s.CreateRun(ctx, r); err != nil {
			t.Fatalf("CreateRun(%s): %v", r.Name, err)
		}
	}

	check := func(label string, got *workflow.Run) {
		t.Helper()

		if got.Version != 3 {
			t.Errorf("%s: Version = %d, want 3", label, got.Version)
		}
		if got.ParentRunID == nil || *got.ParentRunID != parent.ID {
			t.Errorf("%s: ParentRunID = %v, want %s", label, got.ParentRunID, parent.ID)
		}
	}
	read := func(stage string) {
		t.Helper()

		got, err := s.GetRun(ctx, child.ID)
		if err != nil {
			t.Fatalf("%s: GetRun: %v", stage, err)
		}
		check(stage+": GetRun", got)

		children, err := s.ListChildRuns(ctx, parent.ID)
		if err != nil {
			t.Fatalf("%s: ListChildRuns: %v", stage, err)
		}
		if len(children) != 1 {
			t.Fatalf("%s: ListChildRuns = %d runs, want 1", stage, len(children))
		}
		check(stage+": ListChildRuns", children[0])

		page, err := s.ListRunsPage(ctx, workflow.ListRunsPageOpts{NamePrefix: child.Name})
		if err != nil {
			t.Fatalf("%s: ListRunsPage: %v", stage, err)
		}
		if len(page.Runs) != 1 {
			t.Fatalf("%s: ListRunsPage = %d runs, want 1", stage, len(page.Runs))
		}
		check(stage+": ListRunsPage", page.Runs[0])

		listed, err := s.ListRuns(ctx, workflow.ListOpts{State: got.State})
		if err != nil {
			t.Fatalf("%s: ListRuns: %v", stage, err)
		}
		found := false
		for _, r := range listed {
			if r.ID == child.ID {
				found = true
				check(stage+": ListRuns", r)
			}
		}
		if !found {
			t.Errorf("%s: ListRuns(state %s) did not return the child", stage, got.State)
		}
	}

	read("after CreateRun")

	if err := s.ReopenRun(ctx, child.ID); err != nil {
		t.Fatalf("ReopenRun: %v", err)
	}
	read("after ReopenRun")

	// UpdateRun writes the whole row, so it must write these two back too.
	updated, err := s.GetRun(ctx, child.ID)
	if err != nil {
		t.Fatalf("GetRun before UpdateRun: %v", err)
	}
	updated.State = workflow.RunStateCompleted
	if err = s.UpdateRun(ctx, updated); err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}
	read("after UpdateRun")

	top, err := s.GetRun(ctx, parent.ID)
	if err != nil {
		t.Fatalf("GetRun(parent): %v", err)
	}
	if top.Version != 3 || top.ParentRunID != nil {
		t.Errorf("parent: Version = %d, ParentRunID = %v; want 3 and nil", top.Version, top.ParentRunID)
	}
}
```

- [ ] **Step 4: Run them and see them fail to compile**

Run: `go test -count=1 -tags integration ./store/postgres/ 2>&1 | head -7`
Expected:

```
# github.com/xraph/dispatch/store/postgres_test [github.com/xraph/dispatch/store/postgres.test]
store/postgres/operator_schema_test.go:180:17: s.GetDLQByJobID undefined (type *"github.com/xraph/dispatch/store/postgres".Store has no field or method GetDLQByJobID)
store/postgres/operator_schema_test.go:279:14: s.ReopenRun undefined (type *"github.com/xraph/dispatch/store/postgres".Store has no field or method ReopenRun)
store/postgres/operator_test.go:21:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/postgres".Store) as storetest.DLQReplayStore value in return statement: *"github.com/xraph/dispatch/store/postgres".Store does not implement storetest.DLQReplayStore (missing method ClaimReplay)
store/postgres/operator_test.go:31:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/postgres".Store) as storetest.CronStore value in return statement: *"github.com/xraph/dispatch/store/postgres".Store does not implement storetest.CronStore (missing method SetCronEnabled)
store/postgres/operator_test.go:41:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/postgres".Store) as storetest.WorkflowStore value in return statement: *"github.com/xraph/dispatch/store/postgres".Store does not implement storetest.WorkflowStore (missing method ReopenRun)
FAIL	github.com/xraph/dispatch/store/postgres [build failed]
```

- [ ] **Step 5: Carry replayed_job_id in the DLQ model**

In `store/postgres/models.go`, inside `type dlqEntryModel struct`:

Find:

```go
	ReplayedAt *time.Time `grove:"replayed_at"`
	CreatedAt  time.Time  `grove:"created_at,notnull,default:current_timestamp"`

	// Carried so Replay
```

Replace it with:

```go
	ReplayedAt *time.Time `grove:"replayed_at"`
	CreatedAt  time.Time  `grove:"created_at,notnull,default:current_timestamp"`

	// ReplayedJobID is the job ClaimReplay recorded with replayed_at. It
	// is NULL while the entry is unreplayed, and on rows the older
	// ReplayDLQ marked, which set replayed_at alone.
	ReplayedJobID *string `grove:"replayed_job_id"`

	// Carried so Replay
```

In `toDLQModel`, two changes. First:

Find:

```go
		return nil, fmt.Errorf(errPrefix+"encode dlq resource limits: %w", err)
	}

	return &dlqEntryModel{
```

Replace it with:

```go
		return nil, fmt.Errorf(errPrefix+"encode dlq resource limits: %w", err)
	}

	var replayedJobID *string
	if e.ReplayedJobID != nil {
		raw := e.ReplayedJobID.String()
		replayedJobID = &raw
	}

	return &dlqEntryModel{
```

Then, inside the `&dlqEntryModel{...}` literal:

Find:

```go
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		Priority:         e.Priority,
```

Replace it with:

```go
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		ReplayedJobID: replayedJobID,

		Priority:         e.Priority,
```

In `fromDLQModel`, two changes. First:

Find:

```go
		return nil, fmt.Errorf(errPrefix+"decode dlq resource limits: %w", err)
	}

	return &dlq.Entry{
```

Replace it with:

```go
		return nil, fmt.Errorf(errPrefix+"decode dlq resource limits: %w", err)
	}

	var replayedJobID *id.JobID
	if m.ReplayedJobID != nil {
		parsed, parseErr := id.ParseJobID(*m.ReplayedJobID)
		if parseErr != nil {
			return nil, fmt.Errorf(errPrefix+"parse replayed job id %q: %w", *m.ReplayedJobID, parseErr)
		}
		replayedJobID = &parsed
	}

	return &dlq.Entry{
```

Then, inside the `&dlq.Entry{...}` literal:

Find:

```go
		ReplayedAt: m.ReplayedAt,
		CreatedAt:  m.CreatedAt,

		Priority:         m.Priority,
```

Replace it with:

```go
		ReplayedAt: m.ReplayedAt,
		CreatedAt:  m.CreatedAt,

		ReplayedJobID: replayedJobID,

		Priority:         m.Priority,
```

`GetDLQ`, `ListDLQ`, `ListDLQPage` (in `list.go`) and the new `GetDLQByJobID` all scan into `dlqEntryModel` and convert with `fromDLQModel`, so this one mapper covers every read path.

- [ ] **Step 6: Append the dlq_replayed_job_id migration**

In `store/postgres/migrations.go`, the `list_order_indexes` migration is the last one in the list, and the call closes right after its `Down`:

```go
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx,
						`DROP INDEX CONCURRENTLY IF EXISTS `+ix.name); err != nil {
						return err
					}
				}

				return nil
			},
		},
	)
}
```

Replace that with (the `list_order_indexes` lines are unchanged; the new migration goes between its closing `},` and the `)`):

```go
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx,
						`DROP INDEX CONCURRENTLY IF EXISTS `+ix.name); err != nil {
						return err
					}
				}

				return nil
			},
		},

		// ClaimReplay records which job a replay or retry created next to
		// replayed_at, so an operator can follow a replayed entry to its
		// new job and a failed enqueue can release only its own claim.
		// Retrying a failed job finds its entry with GetDLQByJobID, a
		// lookup by job_id that no index covered. (job_id, id) answers
		// it, newest entry first, by walking the index backwards.
		&migrate.Migration{
			Name:    "dlq_replayed_job_id",
			Version: "20261009120000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// Under the lock timeout for the reason given on
				// job_resource_columns. A nullable column with no default
				// is a catalog update, not a table rewrite.
				if err := withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_dlq
						ADD COLUMN IF NOT EXISTS replayed_job_id TEXT`); err != nil {
					return err
				}

				// CONCURRENTLY, with an invalid leftover dropped first,
				// as on list_order_indexes: a plain CREATE INDEX would
				// block every dead letter write for the whole build.
				if err := dropIfInvalid(ctx, exec, "idx_dispatch_dlq_job"); err != nil {
					return err
				}

				_, err := exec.Exec(ctx, `
					CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispatch_dlq_job
						ON dispatch_dlq (job_id, id)`)

				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				if _, err := exec.Exec(ctx,
					`DROP INDEX CONCURRENTLY IF EXISTS idx_dispatch_dlq_job`); err != nil {
					return err
				}

				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_dlq
						DROP COLUMN IF EXISTS replayed_job_id`)
			},
		},
	)
}
```

- [ ] **Step 7: Refuse a duplicate push**

In `store/postgres/dlq.go`:

Find:

```go
// PushDLQ adds a failed job entry to the dead letter queue.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	m, err := toDLQModel(entry)
	if err != nil {
		return err
	}
	if _, err = s.pgdb.NewInsert(m).Exec(ctx); err != nil {
		return fmt.Errorf(errPrefix+"push dlq: %w", err)
	}
	return nil
}
```

Replace it with:

```go
// PushDLQ adds a failed job entry to the dead letter queue. An ID that is
// already there is refused with dispatch.ErrDLQAlreadyExists rather than
// overwritten. The primary key is the only unique constraint on
// dispatch_dlq, so a unique violation here can only mean the ID.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	m, err := toDLQModel(entry)
	if err != nil {
		return err
	}
	if _, err = s.pgdb.NewInsert(m).Exec(ctx); err != nil {
		if isDuplicateKey(err) {
			return dispatch.ErrDLQAlreadyExists
		}
		return fmt.Errorf(errPrefix+"push dlq: %w", err)
	}
	return nil
}
```

`dlq.go` already imports `github.com/xraph/dispatch`, and `isDuplicateKey` is in `helpers.go`.

- [ ] **Step 8: Implement the capabilities**

Create `store/postgres/operator.go`:

```go
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ dlq.ReplayClaimer    = (*Store)(nil)
	_ cron.TargetedUpdater = (*Store)(nil)
	_ workflow.Reopener    = (*Store)(nil)
)

// Each conditional write below is one UPDATE whose WHERE clause carries
// the condition. Under READ COMMITTED a second UPDATE of the same row
// waits for the first to commit, then re-checks its WHERE against the
// row the first one wrote, so of two concurrent calls exactly one
// matches. When none matches, a follow-up count tells a missing row from
// a refused one. A row that exists but did not match failed the condition
// when the UPDATE looked at it, so the refusal is reported from that fact
// and not from a second read, which could see a state that came later.

// dlqExists reports whether a dead letter entry is present.
func (s *Store) dlqExists(ctx context.Context, entryID id.DLQID) (bool, error) {
	n, err := s.pgdb.NewSelect((*dlqEntryModel)(nil)).
		Where("id = ?", entryID.String()).
		Count(ctx)
	if err != nil {
		return false, fmt.Errorf(errPrefix+"check dlq exists: %w", err)
	}
	return n > 0, nil
}

// ClaimReplay marks an unreplayed entry replayed by jobID.
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	res, err := s.pgdb.NewUpdate((*dlqEntryModel)(nil)).
		Set("replayed_at = NOW()").
		Set("replayed_job_id = ?", jobID.String()).
		Where("id = ?", entryID.String()).
		Where("replayed_at IS NULL").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"claim dlq replay: %w", err)
	}

	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 1 {
		return nil
	}

	exists, err := s.dlqExists(ctx, entryID)
	if err != nil {
		return err
	}
	if !exists {
		return dispatch.ErrDLQNotFound
	}
	return dispatch.ErrDLQAlreadyReplayed
}

// ReleaseReplay undoes a claim, but only the one jobID made.
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	res, err := s.pgdb.NewUpdate((*dlqEntryModel)(nil)).
		Set("replayed_at = NULL").
		Set("replayed_job_id = NULL").
		Where("id = ?", entryID.String()).
		Where("replayed_job_id = ?", jobID.String()).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"release dlq replay: %w", err)
	}

	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 1 {
		return nil
	}

	exists, err := s.dlqExists(ctx, entryID)
	if err != nil {
		return err
	}
	if !exists {
		return dispatch.ErrDLQNotFound
	}
	return nil
}

// GetDLQByJobID returns the newest entry, by ID, for a failed job. The
// dlq_replayed_job_id migration's (job_id, id) index answers it by
// reading one row from the end of that job's range.
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error) {
	m := new(dlqEntryModel)
	err := s.pgdb.NewSelect(m).
		Where("job_id = ?", jobID.String()).
		OrderExpr("id DESC").
		Limit(1).
		Scan(ctx)
	if err != nil {
		if isNoRows(err) {
			return nil, dispatch.ErrDLQNotFound
		}
		return nil, fmt.Errorf(errPrefix+"get dlq by job id: %w", err)
	}
	return fromDLQModel(m)
}

// DeleteDLQ removes one entry.
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error {
	res, err := s.pgdb.NewDelete((*dlqEntryModel)(nil)).
		Where("id = ?", entryID.String()).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"delete dlq: %w", err)
	}

	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 0 {
		return dispatch.ErrDLQNotFound
	}
	return nil
}

// SetCronEnabled sets enabled, and next_run_at when one is given.
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error {
	q := s.pgdb.NewUpdate((*cronEntryModel)(nil)).
		Set("enabled = ?", enabled).
		Set("updated_at = NOW()")
	if nextRunAt != nil {
		q = q.Set("next_run_at = ?", *nextRunAt)
	}

	res, err := q.Where("id = ?", entryID.String()).Exec(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"set cron enabled: %w", err)
	}

	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 0 {
		return dispatch.ErrCronNotFound
	}
	return nil
}

// UpdateCronNextRun sets next_run_at, and never enabled.
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error {
	res, err := s.pgdb.NewUpdate((*cronEntryModel)(nil)).
		Set("next_run_at = ?", nextRunAt).
		Set("updated_at = NOW()").
		Where("id = ?", entryID.String()).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"update cron next run: %w", err)
	}

	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 0 {
		return dispatch.ErrCronNotFound
	}
	return nil
}

// ReopenRun moves a finished run back to running.
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error {
	running := string(workflow.RunStateRunning)

	res, err := s.pgdb.NewUpdate((*workflowRunModel)(nil)).
		Set("state = ?", running).
		Set("error = ''").
		Set("completed_at = NULL").
		Set("updated_at = NOW()").
		Where("id = ?", runID.String()).
		Where("state <> ?", running).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"reopen run: %w", err)
	}

	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 1 {
		return nil
	}

	n, err := s.pgdb.NewSelect((*workflowRunModel)(nil)).
		Where("id = ?", runID.String()).
		Count(ctx)
	if err != nil {
		return fmt.Errorf(errPrefix+"check run exists: %w", err)
	}
	if n == 0 {
		return dispatch.ErrRunNotFound
	}
	return fmt.Errorf("%w: run %s is %s", dispatch.ErrInvalidState, runID, workflow.RunStateRunning)
}
```

`ReopenRun` reports the refusal as `running` without reading the state back. Zero rows from an existing row can only mean `state = 'running'` when the UPDATE evaluated it, and a fresh read could see a state some other caller wrote afterwards.

Run: `go build ./... && go vet -tags integration ./store/postgres/`
Expected: no output.

- [ ] **Step 9: Run the tests and see only the workflow columns missing**

Run: `go test -count=1 -race -tags integration -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestOperatorSchema|TestDLQJobIndex|TestGetDLQByJobIDReads|TestRunVersion' ./store/postgres/ 2>&1 | grep -E -- '^--- FAIL|^    --- FAIL|_test.go:[0-9]+:|workflow.go:[0-9]+:|^FAIL|^ok'`
Expected (run IDs differ per run):

```
--- FAIL: TestOperatorSchemaAfterMigrate (1.42s)
    operator_schema_test.go:113: dispatch_workflow_runs.parent_run_id: not in information_schema: no rows in result set
    operator_schema_test.go:113: dispatch_workflow_runs.version: not in information_schema: no rows in result set
    operator_schema_test.go:113: idx_dispatch_workflow_runs_parent: not in pg_indexes: no rows in result set
--- FAIL: TestOperatorSchemaSurvivesASecondMigrate (1.14s)
    operator_schema_test.go:125: dispatch_workflow_runs.parent_run_id: not in information_schema: no rows in result set
    operator_schema_test.go:125: dispatch_workflow_runs.version: not in information_schema: no rows in result set
    operator_schema_test.go:125: idx_dispatch_workflow_runs_parent: not in pg_indexes: no rows in result set
--- FAIL: TestRunVersionAndParentRoundTrip (1.16s)
    operator_schema_test.go:277: after CreateRun: GetRun: Version = 0, want 3
    operator_schema_test.go:277: after CreateRun: GetRun: ParentRunID = <nil>, want wfrun_01m4c3ammcekkt7e82g0jxs4zs
    operator_schema_test.go:277: after CreateRun: ListChildRuns: dispatch/postgres: list child runs: pgdriver: query: ERROR: column "parent_run_id" does not exist (SQLSTATE 42703)
--- FAIL: TestWorkflowConformance (1.28s)
    --- FAIL: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.00s)
        workflow.go:223: child ParentRunID = nil, want wfrun_01m4c3ar98ezn88jy1xd35zzxp: the parent link was not stored
FAIL
FAIL	github.com/xraph/dispatch/store/postgres	10.269s
FAIL
```

The DLQ replay suite, the cron suite, the rest of the workflow suite and the DLQ index tests pass already. What fails is the missing run columns, which the next two steps add.

- [ ] **Step 10: Append the workflow_run_version_parent migration**

In `store/postgres/migrations.go`, the migration from Step 6 now closes the list:

```go
				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_dlq
						DROP COLUMN IF EXISTS replayed_job_id`)
			},
		},
	)
}
```

Replace that with:

```go
				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_dlq
						DROP COLUMN IF EXISTS replayed_job_id`)
			},
		},

		// workflow.Run.ParentRunID and Version had no columns. A child run
		// read back as top-level, ListChildRuns failed on a column that
		// did not exist, and every run read back as version 0, which the
		// registry resolves to the newest definition. The runner resumes
		// and replays a run on its stamped version, so a run started on
		// version 1 would have resumed on whatever was newest.
		&migrate.Migration{
			Name:    "workflow_run_version_parent",
			Version: "20261009130000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// Under the lock timeout for the reason given on
				// job_resource_columns. The parent link is nullable and the
				// version default is a constant, so both are catalog
				// updates rather than a table rewrite. Runs written before
				// this read back as version 0, which is what they were
				// already reading back as.
				if err := withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_workflow_runs
						ADD COLUMN IF NOT EXISTS version       INT NOT NULL DEFAULT 0,
						ADD COLUMN IF NOT EXISTS parent_run_id TEXT`); err != nil {
					return err
				}

				// ListChildRuns filters on parent_run_id. Partial, because
				// most runs have no parent and a NULL entry for each would
				// only make the index bigger. CONCURRENTLY, with an invalid
				// leftover dropped first, as on list_order_indexes: every
				// workflow step writes this table.
				if err := dropIfInvalid(ctx, exec, "idx_dispatch_workflow_runs_parent"); err != nil {
					return err
				}

				_, err := exec.Exec(ctx, `
					CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispatch_workflow_runs_parent
						ON dispatch_workflow_runs (parent_run_id, id)
						WHERE parent_run_id IS NOT NULL`)

				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				if _, err := exec.Exec(ctx,
					`DROP INDEX CONCURRENTLY IF EXISTS idx_dispatch_workflow_runs_parent`); err != nil {
					return err
				}

				return withLockTimeout(ctx, exec, `
					ALTER TABLE dispatch_workflow_runs
						DROP COLUMN IF EXISTS version,
						DROP COLUMN IF EXISTS parent_run_id`)
			},
		},
	)
}
```

- [ ] **Step 11: Carry Version and ParentRunID in the run model**

In `store/postgres/models.go`:

Find:

```go
	CompletedAt *time.Time `grove:"completed_at"`
	CreatedAt   time.Time  `grove:"created_at,notnull,default:current_timestamp"`
	UpdatedAt   time.Time  `grove:"updated_at,notnull,default:current_timestamp"`
}

func toRunModel(r *workflow.Run) *workflowRunModel {
	return &workflowRunModel{
```

Replace it with:

```go
	CompletedAt *time.Time `grove:"completed_at"`
	CreatedAt   time.Time  `grove:"created_at,notnull,default:current_timestamp"`
	UpdatedAt   time.Time  `grove:"updated_at,notnull,default:current_timestamp"`
	ParentRunID *string    `grove:"parent_run_id"`
	Version     int        `grove:"version,notnull,default:0"`
}

func toRunModel(r *workflow.Run) *workflowRunModel {
	var parentRunID *string
	if r.ParentRunID != nil {
		raw := r.ParentRunID.String()
		parentRunID = &raw
	}

	return &workflowRunModel{
```

Then, at the end of `toRunModel`:

Find:

```go
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}
```

Replace it with:

```go
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		ParentRunID: parentRunID,
		Version:     r.Version,
	}
}
```

In `fromRunModel`:

Find:

```go
		return nil, fmt.Errorf(errPrefix+"parse run id %q: %w", m.ID, err)
	}

	return &workflow.Run{
```

Replace it with:

```go
		return nil, fmt.Errorf(errPrefix+"parse run id %q: %w", m.ID, err)
	}

	var parentRunID *id.RunID
	if m.ParentRunID != nil {
		parsed, parseErr := id.ParseRunID(*m.ParentRunID)
		if parseErr != nil {
			return nil, fmt.Errorf(errPrefix+"parse parent run id %q: %w", *m.ParentRunID, parseErr)
		}
		parentRunID = &parsed
	}

	return &workflow.Run{
```

Then, at the end of `fromRunModel`:

Find:

```go
		StartedAt:   m.StartedAt,
		CompletedAt: m.CompletedAt,
	}, nil
}
```

Replace it with:

```go
		StartedAt:   m.StartedAt,
		CompletedAt: m.CompletedAt,
		Version:     m.Version,
		ParentRunID: parentRunID,
	}, nil
}
```

`CreateRun` and `UpdateRun` write through `toRunModel`; `GetRun`, `ListRuns`, `ListChildRuns` and `ListRunsPage` (in `list.go`) read through `fromRunModel`. Nothing else changes.

- [ ] **Step 12: Run the tests and see them pass**

Run: `go test -count=1 -race -tags integration -v -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestOperatorSchema|TestDLQJobIndex|TestGetDLQByJobIDReads|TestRunVersion' ./store/postgres/ 2>&1 | grep -E -- '--- |^ok|FAIL'`
Expected:

```
--- PASS: TestOperatorSchemaAfterMigrate (1.46s)
--- PASS: TestOperatorSchemaSurvivesASecondMigrate (1.16s)
--- PASS: TestDLQJobIndexConvergesFromAnInvalidIndex (1.26s)
--- PASS: TestGetDLQByJobIDReadsTheJobIndex (1.44s)
--- PASS: TestRunVersionAndParentRoundTrip (1.69s)
--- PASS: TestDLQReplayConformance (1.48s)
    --- PASS: TestDLQReplayConformance/ClaimReplayFirstWins (0.01s)
    --- PASS: TestDLQReplayConformance/ClaimReplayConcurrentExactlyOneWinner (0.05s)
    --- PASS: TestDLQReplayConformance/ClaimReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/ReplayedJobIDReadsBackFromEveryPath (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnlyReleasesItsOwnClaim (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnUnclaimedEntryIsNoop (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDReturnsNewestByID (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDUnknownJob (0.00s)
    --- PASS: TestDLQReplayConformance/DeleteDLQRemovesOnlyThatEntry (0.00s)
    --- PASS: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.00s)
--- PASS: TestCronConformance (1.37s)
    --- PASS: TestCronConformance/SetCronEnabledLeavesOtherFieldsAlone (0.01s)
    --- PASS: TestCronConformance/SetCronEnabledNilNextRunKeepsNextRun (0.00s)
    --- PASS: TestCronConformance/UpdateCronNextRunLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/DisableSurvivesAFire (0.01s)
    --- PASS: TestCronConformance/TargetedWritesUnknownEntry (0.00s)
--- PASS: TestWorkflowConformance (1.38s)
    --- PASS: TestWorkflowConformance/ReopenFailedRunClearsErrorAndCompletion (0.00s)
    --- PASS: TestWorkflowConformance/ReopenCompletedRun (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunningRunIsRefused (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunUnknown (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunConcurrentExactlyOneWinner (0.07s)
    --- PASS: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.00s)
ok  	github.com/xraph/dispatch/store/postgres
```

- [ ] **Step 13: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race -tags integration ./store/postgres/... 2>&1 | grep -E '^(ok|FAIL|---)'
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: no FAIL lines from `go test ./...` (it also runs the untagged `TestDLQConformance`, `TestLeaseConformance` and the wake tests in this package against a container); `ok  	github.com/xraph/dispatch/store/postgres` from the integration run, which took about 130 seconds on 2026-10-07; `0 issues.` from the first lint; the second lint reports only the pre-existing `store/redis/store_test.go:54:5: shadow: declaration of "err"` (govet), which is not this task's.

- [ ] **Step 14: Commit**

```bash
git add store/postgres/operator.go store/postgres/operator_test.go store/postgres/operator_schema_test.go
git commit --only -m "feat(postgres): implement the replay claim, targeted cron writes and run reopen

Each conditional write is one UPDATE with its condition in the WHERE
clause, so Postgres settles the race and exactly one of two concurrent
claims or reopens wins. When nothing matches, a count tells a missing
row from a refused one. PushDLQ maps the primary key violation to
ErrDLQAlreadyExists, the same way EnqueueJob and RegisterCron map theirs.

Two migrations. dlq_replayed_job_id adds replayed_job_id and a
(job_id, id) index, so GetDLQByJobID reads one row off the end of a
job's range. workflow_run_version_parent adds version and parent_run_id
to dispatch_workflow_runs, which never had them. Until now a child run
read back as top-level, ListChildRuns failed on a column that didn't
exist, and every run read back as version 0, which the registry treats
as the newest definition. Both indexes are built CONCURRENTLY.

The three operator suites run against Postgres now, along with schema
tests and a version round trip the shared suite can't see." -- \
  store/postgres/operator.go store/postgres/operator_test.go store/postgres/operator_schema_test.go \
  store/postgres/dlq.go store/postgres/models.go store/postgres/migrations.go
git show --stat HEAD | tail -7
```

Expected: `6 files changed`.

Notes for later tasks:
- The postgres DLQ conformance suite (`TestDLQConformance` in `lease_test.go`) has no build tag and runs under plain `go test ./...` with its own container. The new suites follow the integration-tagged `TestListConformance` pattern instead, so they only run with `-tags integration`.
- `ClaimReplay` stamps `replayed_at` with the database's `NOW()`, the transaction start time, like the old `ReplayDLQ`. Memory stamps Go's clock. Nothing compares the two.
- SQLite has the same workflow gap this task fixes here: `store/sqlite/workflow.go` queries `parent_run_id` in `ListChildRuns`, and no sqlite migration creates it. Mongo's `ListChildRuns` filters on a `parent_run_id` field nothing in `store/mongo` writes. Each backend's task should check `Version` and `ParentRunID` round trip against a written value, not a store read, since `RunWorkflowSuite` can't catch a dropped `Version`.

---

### Task 3: SQLite implements the replay claim, targeted cron writes and run reopen

Task 1 defined three store capabilities and their suites; this task makes the SQLite store pass all three under `-race`. Each claim is a single conditional UPDATE (`replayed_at IS NULL` for a replay, `state <> 'running'` for a reopen), and a zero-row result is then told apart as "not found" or "refused" with one read. SQLite already serialises writers with a database-wide lock, but the condition is still what picks the winner, and the claims retry `SQLITE_BUSY` like the lease writes do because grove's sqlitedriver sets no `busy_timeout`. Without that retry, the losers of a concurrent claim come back as `database is locked` instead of `ErrDLQAlreadyReplayed` (checked: 3 of 3 runs failed with the retry disabled).

The workflow suite also exposed a schema gap. `dispatch_workflow_runs` never had a `version` or a `parent_run_id` column. Every run read back as version 0, which `workflow.Registry.GetVersion` resolves to the latest registered version, so a run started on version 3 resumed (and would replay from a step) on whatever version is newest. `ListChildRuns` filters on `parent_run_id` and fails on every call today with `SQL logic error: no such column: parent_run_id`. A second migration adds both columns, and the run model carries them on every read path.

**Files:**
- Modify: `store/sqlite/migrations.go` (append two migrations at the end of the `Migrations.MustRegister(...)` call, after `list_order_indexes`, around line 671)
- Modify: `store/sqlite/models.go` (`workflowRunModel`, `toRunModel`, `fromRunModel` around lines 188-243; `dlqEntryModel`, `toDLQModel`, `fromDLQModel` around lines 354-470)
- Modify: `store/sqlite/dlq.go` (`PushDLQ`, lines 13-23)
- Create: `store/sqlite/operator.go`
- Test: `store/sqlite/operator_migrations_test.go` (create), `store/sqlite/operator_test.go` (create)

**Interfaces:**
- Consumes (from Task 1): `dlq.ReplayClaimer`, `cron.TargetedUpdater`, `workflow.Reopener`; `storetest.RunDLQReplaySuite`/`DLQReplayStore`, `storetest.RunCronSuite`/`CronStore`, `storetest.RunWorkflowSuite`/`WorkflowStore`; `dispatch.ErrDLQAlreadyExists`, `dispatch.ErrDLQAlreadyReplayed`. From the package: `withBusyRetry` (`store/sqlite/lease.go`), `isDuplicateKey`, `isNoRows` (`store/sqlite/store.go`), `addColumnIfMissing`, `dropColumnIfPresent` (`store/sqlite/migrations.go`); test helpers `openSqliteStore` (`store/sqlite/reap_test.go`), `openMigratedWithDriver` (`store/sqlite/migrations_test.go`), `queryStrings` (`store/sqlite/list_index_test.go`).
- Produces:

```go
package sqlite // *Store gains
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error)
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error
```

Schema: migration `dlq_replayed_job_id` (`20261009120000`) adds nullable `dispatch_dlq.replayed_job_id TEXT` and `idx_dispatch_dlq_job_id ON dispatch_dlq (job_id, id)`. Migration `workflow_run_version_parent` (`20261009130000`) adds `dispatch_workflow_runs.version INTEGER NOT NULL DEFAULT 0`, nullable `dispatch_workflow_runs.parent_run_id TEXT`, and `idx_dispatch_workflow_runs_parent ON dispatch_workflow_runs (parent_run_id, id)`. `PushDLQ` returns `dispatch.ErrDLQAlreadyExists` for an ID already present. `workflow.Run.Version` and `ParentRunID` now round trip through `CreateRun`, `UpdateRun`, `GetRun`, `ListRuns`, `ListRunsPage` and `ListChildRuns`.

How times are bound: every time goes in as a `time.Time` argument, exactly like `ReplayDLQ` and the insert path. SQLite has no timestamp type, grove's driver writes its own text form (Go's `Time.String()` layout, not ISO-8601), and every comparison on a time column is a string comparison (see the comment on `ReclaimExpiredLeases` in `store/sqlite/lease.go`). A hand-formatted `replayed_at` reads back fine through the model, so the conformance suites cannot see it; `TestClaimReplayStoresReplayedAtInTheDriverTimeForm` is the guard (checked: binding `now.Format(time.RFC3339Nano)` fails it and nothing else).

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- store/sqlite && git log --oneline -3`
Expected: no lines from `git status`, and the log shows Task 1 (`feat(store): add the replay claim, targeted cron writes and run reopen, with a memory reference`) at or below the head. If another session has uncommitted edits under `store/sqlite`, stop and report.

- [ ] **Step 2: Write the migration test**

Create `store/sqlite/operator_migrations_test.go`:

```go
package sqlite_test

import (
	"context"
	"strings"
	"testing"

	"github.com/xraph/grove/driver"
	"github.com/xraph/grove/migrate"

	sqlitestore "github.com/xraph/dispatch/store/sqlite"
)

// operatorSchema is what the two operator-action migrations add: columns
// and an index on one table per migration, in the order the migrations
// run.
var operatorSchema = []struct {
	migration, version string
	table              string
	columns            []string
	index              string
	indexColumns       []string
}{
	{
		migration: "dlq_replayed_job_id", version: "20261009120000",
		table: "dispatch_dlq", columns: []string{"replayed_job_id"},
		index: "idx_dispatch_dlq_job_id", indexColumns: []string{"job_id", "id"},
	},
	{
		migration: "workflow_run_version_parent", version: "20261009130000",
		table: "dispatch_workflow_runs", columns: []string{"version", "parent_run_id"},
		index: "idx_dispatch_workflow_runs_parent", indexColumns: []string{"parent_run_id", "id"},
	},
}

// assertOperatorSchema checks every column and index in operatorSchema is
// present (want true) or absent (want false).
func assertOperatorSchema(t *testing.T, drv driver.Driver, want bool) {
	t.Helper()

	for _, s := range operatorSchema {
		for _, column := range s.columns {
			found := queryStrings(t, drv,
				`SELECT name FROM pragma_table_info(?) WHERE name = ?`, s.table, column)
			if got := len(found) == 1; got != want {
				t.Errorf("%s.%s present = %v, want %v", s.table, column, got, want)
			}
		}

		owner := queryStrings(t, drv,
			`SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?`, s.index)
		if !want {
			if len(owner) != 0 {
				t.Errorf("%s still exists on %v", s.index, owner)
			}

			continue
		}
		if len(owner) != 1 || owner[0][0] != s.table {
			t.Errorf("%s: sqlite_master has %v, want one index on %s", s.index, owner, s.table)

			continue
		}

		var keys []string
		for _, r := range queryStrings(t, drv,
			`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, s.index) {
			keys = append(keys, r[0])
		}
		if strings.Join(keys, ",") != strings.Join(s.indexColumns, ",") {
			t.Errorf("%s: columns %v, want %v", s.index, keys, s.indexColumns)
		}
	}
}

func TestOperatorMigrationsAddColumnsAndIndexes(t *testing.T) {
	_, drv, _ := openMigratedWithDriver(t)

	assertOperatorSchema(t, drv, true)
}

// TestOperatorMigrationsSurviveASecondMigrate runs Migrate again on a
// migrated database, as every process start does.
func TestOperatorMigrationsSurviveASecondMigrate(t *testing.T) {
	s, drv, _ := openMigratedWithDriver(t)

	for range 2 {
		if err := s.Migrate(context.Background()); err != nil {
			t.Fatalf("migrate again: %v", err)
		}
	}

	assertOperatorSchema(t, drv, true)
}

// TestOperatorMigrationsRollBackAndReapply rolls both migrations back
// through grove, runs each Down a second time to prove it is guarded (a
// Down that failed halfway must be re-runnable, and SQLite refuses to drop
// a column an index still covers), then migrates forward again.
func TestOperatorMigrationsRollBackAndReapply(t *testing.T) {
	s, drv, _ := openMigratedWithDriver(t)
	ctx := context.Background()

	exec, err := migrate.NewExecutorFor(drv)
	if err != nil {
		t.Fatalf("NewExecutorFor: %v", err)
	}
	orch := migrate.NewOrchestrator(exec, sqlitestore.Migrations)

	// Rollback undoes the most recent migration first.
	for i := len(operatorSchema) - 1; i >= 0; i-- {
		res, rbErr := orch.Rollback(ctx)
		if rbErr != nil {
			t.Fatalf("rollback: %v", rbErr)
		}
		undone := make([]string, 0, len(res.Rollback))
		for _, m := range res.Rollback {
			undone = append(undone, m.Name)
		}
		if len(undone) != 1 || undone[0] != operatorSchema[i].migration {
			t.Fatalf("rollback undid %v, want [%s]", undone, operatorSchema[i].migration)
		}
	}

	assertOperatorSchema(t, drv, false)

	byVersion := map[string]*migrate.Migration{}
	for _, m := range sqlitestore.Migrations.Migrations() {
		byVersion[m.Version] = m
	}
	for _, sc := range operatorSchema {
		if downErr := byVersion[sc.version].Down(ctx, exec); downErr != nil {
			t.Fatalf("second Down of %s: %v", sc.migration, downErr)
		}
	}

	if err = s.Migrate(ctx); err != nil {
		t.Fatalf("migrate after rollback: %v", err)
	}

	assertOperatorSchema(t, drv, true)
}
```

Run: `go test -count=1 -run TestOperatorMigrations ./store/sqlite/`
Expected:

```
--- FAIL: TestOperatorMigrationsAddColumnsAndIndexes (0.02s)
    operator_migrations_test.go:79: dispatch_dlq.replayed_job_id present = false, want true
    operator_migrations_test.go:79: idx_dispatch_dlq_job_id: sqlite_master has [], want one index on dispatch_dlq
    operator_migrations_test.go:79: dispatch_workflow_runs.version present = false, want true
    operator_migrations_test.go:79: dispatch_workflow_runs.parent_run_id present = false, want true
    operator_migrations_test.go:79: idx_dispatch_workflow_runs_parent: sqlite_master has [], want one index on dispatch_workflow_runs
--- FAIL: TestOperatorMigrationsSurviveASecondMigrate (0.02s)
    operator_migrations_test.go:93: dispatch_dlq.replayed_job_id present = false, want true
    operator_migrations_test.go:93: idx_dispatch_dlq_job_id: sqlite_master has [], want one index on dispatch_dlq
    operator_migrations_test.go:93: dispatch_workflow_runs.version present = false, want true
    operator_migrations_test.go:93: dispatch_workflow_runs.parent_run_id present = false, want true
    operator_migrations_test.go:93: idx_dispatch_workflow_runs_parent: sqlite_master has [], want one index on dispatch_workflow_runs
--- FAIL: TestOperatorMigrationsRollBackAndReapply (0.02s)
    operator_migrations_test.go:121: rollback undid [list_order_indexes], want [workflow_run_version_parent]
FAIL
FAIL	github.com/xraph/dispatch/store/sqlite
```

- [ ] **Step 3: Append the two migrations**

In `store/sqlite/migrations.go`, the `list_order_indexes` migration is the last one registered, and the `MustRegister` call closes right after it:

```go
			Down: func(ctx context.Context, exec migrate.Executor) error {
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx, `DROP INDEX IF EXISTS `+ix.name); err != nil {
						return err
					}
				}

				return nil
			},
		},
	)
}
```

Replace exactly that block with:

```go
			Down: func(ctx context.Context, exec migrate.Executor) error {
				for _, ix := range listOrderIndexes {
					if _, err := exec.Exec(ctx, `DROP INDEX IF EXISTS `+ix.name); err != nil {
						return err
					}
				}

				return nil
			},
		},

		// A replay or retry claims its entry by setting replayed_at and
		// replayed_job_id together, so the entry records which job the
		// replay created. GetDLQByJobID finds a failed job's newest entry,
		// which (job_id, id) answers from the index alone, newest last.
		&migrate.Migration{
			Name:    "dlq_replayed_job_id",
			Version: "20261009120000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// Guarded like every other ADD COLUMN here: SQLite has no
				// ADD COLUMN IF NOT EXISTS, and grove runs Up outside a
				// transaction. Nullable TEXT: an unreplayed entry has no
				// job, and neither does one the older ReplayDLQ marked.
				if err := addColumnIfMissing(ctx, exec,
					"dispatch_dlq", "replayed_job_id", `TEXT`); err != nil {
					return err
				}

				_, err := exec.Exec(ctx, `
					CREATE INDEX IF NOT EXISTS idx_dispatch_dlq_job_id
						ON dispatch_dlq (job_id, id)`)

				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				if _, err := exec.Exec(ctx, `DROP INDEX IF EXISTS idx_dispatch_dlq_job_id`); err != nil {
					return err
				}

				return dropColumnIfPresent(ctx, exec, "dispatch_dlq", "replayed_job_id")
			},
		},

		// workflow.Run had no column for Version or ParentRunID. Every run
		// read back as version 0, which the runner treats as the latest
		// registered version, so a run started on version 3 resumed (and
		// replayed from a step) on whatever version was newest. A child
		// run read back as top-level, and ListChildRuns, which filters on
		// parent_run_id, failed with "no such column" on every call.
		&migrate.Migration{
			Name:    "workflow_run_version_parent",
			Version: "20261009130000",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				// Guarded like every other ADD COLUMN here. version
				// defaults to 0, which is what every existing row read
				// back as before this column existed, so old rows keep
				// their meaning. parent_run_id is NULL for a top-level run.
				for _, c := range []struct{ name, ddl string }{
					{"version", `INTEGER NOT NULL DEFAULT 0`},
					{"parent_run_id", `TEXT`},
				} {
					if err := addColumnIfMissing(ctx, exec,
						"dispatch_workflow_runs", c.name, c.ddl); err != nil {
						return err
					}
				}

				_, err := exec.Exec(ctx, `
					CREATE INDEX IF NOT EXISTS idx_dispatch_workflow_runs_parent
						ON dispatch_workflow_runs (parent_run_id, id)`)

				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				// The index goes first: SQLite refuses to drop a column an
				// index still covers.
				if _, err := exec.Exec(ctx, `DROP INDEX IF EXISTS idx_dispatch_workflow_runs_parent`); err != nil {
					return err
				}

				for _, col := range []string{"version", "parent_run_id"} {
					if err := dropColumnIfPresent(ctx, exec, "dispatch_workflow_runs", col); err != nil {
						return err
					}
				}

				return nil
			},
		},
	)
}
```

The Down of `workflow_run_version_parent` must drop the index before the columns. SQLite refuses to drop a column an index covers (`error in index idx_dispatch_workflow_runs_parent after drop column: no such column: parent_run_id`), and `TestOperatorMigrationsRollBackAndReapply` fails on exactly that if the order is swapped.

Run: `go test -count=1 -v -run TestOperatorMigrations ./store/sqlite/ 2>&1 | grep -E -- '--- |^ok'`
Expected:

```
--- PASS: TestOperatorMigrationsAddColumnsAndIndexes (0.02s)
--- PASS: TestOperatorMigrationsSurviveASecondMigrate (0.02s)
--- PASS: TestOperatorMigrationsRollBackAndReapply (0.02s)
ok  	github.com/xraph/dispatch/store/sqlite
```

- [ ] **Step 4: Wire the three suites and the SQLite-only tests**

Create `store/sqlite/operator_test.go`:

```go
package sqlite_test

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/store/storetest"
	"github.com/xraph/dispatch/workflow"
)

// Each conformance test opens a fresh migrated database per subtest
// through openSqliteStore (store/sqlite/reap_test.go:19), like the other
// suites in this package.

func TestDLQReplayConformance(t *testing.T) {
	storetest.RunDLQReplaySuite(t, func(t *testing.T) storetest.DLQReplayStore {
		t.Helper()

		return openSqliteStore(t)
	})
}

func TestCronConformance(t *testing.T) {
	storetest.RunCronSuite(t, func(t *testing.T) storetest.CronStore {
		t.Helper()

		return openSqliteStore(t)
	})
}

func TestWorkflowConformance(t *testing.T) {
	storetest.RunWorkflowSuite(t, func(t *testing.T) storetest.WorkflowStore {
		t.Helper()

		return openSqliteStore(t)
	})
}

// driverTimeLayout is how grove's sqlitedriver renders a bound time.Time:
// Go's default time.Time.String() form, not ISO-8601. Every time column
// this store compares is compared as text in this form.
const driverTimeLayout = "2006-01-02 15:04:05.999999999 -0700 MST"

// TestClaimReplayStoresReplayedAtInTheDriverTimeForm pins how ClaimReplay
// writes replayed_at. SQLite has no timestamp type, so a time column is
// whatever text the writer put there, and comparisons are string
// comparisons. ClaimReplay must bind a time.Time like ReplayDLQ and the
// insert path do. A hand-formatted value (RFC 3339, say) would read back
// fine through the model and still sort wrongly against every other
// timestamp the moment anything compares replayed_at.
func TestClaimReplayStoresReplayedAtInTheDriverTimeForm(t *testing.T) {
	s, drv, _ := openMigratedWithDriver(t)
	ctx := context.Background()
	now := time.Now().UTC()

	claimed := &dlq.Entry{
		ID: id.NewDLQID(), JobID: id.NewJobID(), JobName: "form", Queue: "form",
		Payload: []byte(`{}`), Error: "boom", FailedAt: now, CreatedAt: now,
	}
	marked := &dlq.Entry{
		ID: id.NewDLQID(), JobID: id.NewJobID(), JobName: "form", Queue: "form",
		Payload: []byte(`{}`), Error: "boom", FailedAt: now, CreatedAt: now,
	}
	for _, e := range []*dlq.Entry{claimed, marked} {
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("PushDLQ: %v", err)
		}
	}

	if err := s.ClaimReplay(ctx, claimed.ID, id.NewJobID()); err != nil {
		t.Fatalf("ClaimReplay: %v", err)
	}
	if err := s.ReplayDLQ(ctx, marked.ID); err != nil {
		t.Fatalf("ReplayDLQ: %v", err)
	}

	for _, e := range []*dlq.Entry{claimed, marked} {
		rows := queryStrings(t, drv,
			`SELECT replayed_at, failed_at FROM dispatch_dlq WHERE id = ?`, e.ID.String())
		if len(rows) != 1 {
			t.Fatalf("%s: %d rows, want 1", e.ID, len(rows))
		}

		for i, col := range []string{"replayed_at", "failed_at"} {
			if _, err := time.Parse(driverTimeLayout, rows[0][i]); err != nil {
				t.Errorf("%s %s = %q, not in the driver's time form: %v", e.ID, col, rows[0][i], err)
			}
		}
	}
}

// TestRunVersionAndParentReadBackFromEveryPath pins the two run columns
// workflow_run_version_parent added. Before it, a run created on version 3
// read back as version 0, which the runner resolves to the latest
// registered version, so a resume or a replay-from-step ran different
// code from the run's own. RunWorkflowSuite covers the parent link
// through GetRun and ListChildRuns; this adds Version, the paged list, and
// the UpdateRun write MigrateRun relies on.
func TestRunVersionAndParentReadBackFromEveryPath(t *testing.T) {
	s := openSqliteStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)

	parent := &workflow.Run{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewRunID(),
		Name:      "lineage-parent",
		State:     workflow.RunStateRunning,
		StartedAt: now,
	}
	parentID := parent.ID
	child := &workflow.Run{
		Entity:      dispatch.NewEntity(),
		ID:          id.NewRunID(),
		Name:        "lineage-child",
		State:       workflow.RunStateRunning,
		StartedAt:   now,
		Version:     3,
		ParentRunID: &parentID,
	}
	for _, r := range []*workflow.Run{parent, child} {
		if err := s.CreateRun(ctx, r); err != nil {
			t.Fatalf("CreateRun(%s): %v", r.Name, err)
		}
	}

	check := func(label string, r *workflow.Run, version int) {
		t.Helper()

		if r.Version != version {
			t.Errorf("%s: Version = %d, want %d", label, r.Version, version)
		}
		if r.ParentRunID == nil || *r.ParentRunID != parentID {
			t.Errorf("%s: ParentRunID = %v, want %s", label, r.ParentRunID, parentID)
		}
	}

	got, err := s.GetRun(ctx, child.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	check("GetRun", got, 3)

	children, err := s.ListChildRuns(ctx, parentID)
	if err != nil {
		t.Fatalf("ListChildRuns: %v", err)
	}
	if len(children) != 1 {
		t.Fatalf("ListChildRuns = %d runs, want 1", len(children))
	}
	check("ListChildRuns", children[0], 3)

	page, err := s.ListRunsPage(ctx, workflow.ListRunsPageOpts{NamePrefix: "lineage-child"})
	if err != nil {
		t.Fatalf("ListRunsPage: %v", err)
	}
	if len(page.Runs) != 1 {
		t.Fatalf("ListRunsPage = %d runs, want 1", len(page.Runs))
	}
	check("ListRunsPage", page.Runs[0], 3)

	// MigrateRun moves a run to another version through UpdateRun.
	got.Version = 4
	if err = s.UpdateRun(ctx, got); err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}
	got, err = s.GetRun(ctx, child.ID)
	if err != nil {
		t.Fatalf("GetRun after UpdateRun: %v", err)
	}
	check("GetRun after UpdateRun", got, 4)
}
```

Run: `go test -count=1 ./store/sqlite/`
Expected:

```
# github.com/xraph/dispatch/store/sqlite_test [github.com/xraph/dispatch/store/sqlite.test]
store/sqlite/operator_test.go:23:10: cannot use openSqliteStore(t) (value of type *"github.com/xraph/dispatch/store/sqlite".Store) as storetest.DLQReplayStore value in return statement: *"github.com/xraph/dispatch/store/sqlite".Store does not implement storetest.DLQReplayStore (missing method ClaimReplay)
store/sqlite/operator_test.go:31:10: cannot use openSqliteStore(t) (value of type *"github.com/xraph/dispatch/store/sqlite".Store) as storetest.CronStore value in return statement: *"github.com/xraph/dispatch/store/sqlite".Store does not implement storetest.CronStore (missing method SetCronEnabled)
store/sqlite/operator_test.go:39:10: cannot use openSqliteStore(t) (value of type *"github.com/xraph/dispatch/store/sqlite".Store) as storetest.WorkflowStore value in return statement: *"github.com/xraph/dispatch/store/sqlite".Store does not implement storetest.WorkflowStore (missing method ReopenRun)
store/sqlite/operator_test.go:74:14: s.ClaimReplay undefined (type *"github.com/xraph/dispatch/store/sqlite".Store has no field or method ClaimReplay)
FAIL	github.com/xraph/dispatch/store/sqlite [build failed]
FAIL
```

- [ ] **Step 5: Carry Version and ParentRunID through the run model**

In `store/sqlite/models.go`, make four replacements.

(a) The end of `type workflowRunModel struct`:

```go
	CompletedAt *time.Time `grove:"completed_at"`
	CreatedAt   time.Time  `grove:"created_at,notnull"`
	UpdatedAt   time.Time  `grove:"updated_at,notnull"`
}

func toRunModel(r *workflow.Run) *workflowRunModel {
	return &workflowRunModel{
		ID:          r.ID.String(),
```

becomes:

```go
	CompletedAt *time.Time `grove:"completed_at"`
	CreatedAt   time.Time  `grove:"created_at,notnull"`
	UpdatedAt   time.Time  `grove:"updated_at,notnull"`

	// Version is the workflow definition version the run executes; 0
	// means unversioned. ParentRunID is NULL for a top-level run.
	Version     int     `grove:"version,notnull,default:0"`
	ParentRunID *string `grove:"parent_run_id"`
}

func toRunModel(r *workflow.Run) *workflowRunModel {
	var parentRunID *string
	if r.ParentRunID != nil {
		s := r.ParentRunID.String()
		parentRunID = &s
	}

	return &workflowRunModel{
		ID:          r.ID.String(),
```

(b) The end of `toRunModel`:

```go
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}
```

becomes:

```go
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		Version:     r.Version,
		ParentRunID: parentRunID,
	}
}
```

(c) In `fromRunModel`:

```go
		return nil, fmt.Errorf("dispatch/sqlite: parse run id %q: %w", m.ID, err)
	}

	return &workflow.Run{
```

becomes:

```go
		return nil, fmt.Errorf("dispatch/sqlite: parse run id %q: %w", m.ID, err)
	}

	var parentRunID *id.RunID
	if m.ParentRunID != nil {
		parsed, parseErr := id.ParseRunID(*m.ParentRunID)
		if parseErr != nil {
			return nil, fmt.Errorf("dispatch/sqlite: parse parent run id %q: %w", *m.ParentRunID, parseErr)
		}
		parentRunID = &parsed
	}

	return &workflow.Run{
```

(d) The end of `fromRunModel`:

```go
		StartedAt:   m.StartedAt,
		CompletedAt: m.CompletedAt,
	}, nil
}
```

becomes:

```go
		StartedAt:   m.StartedAt,
		CompletedAt: m.CompletedAt,
		Version:     m.Version,
		ParentRunID: parentRunID,
	}, nil
}
```

`UpdateRun` writes the whole model with `WherePK`, so `MigrateRun`'s version change now persists through it with no further edit. Every run read (`GetRun`, `ListRuns`, `ListChildRuns`, `ListRunsPage`) goes through `fromRunModel`.

- [ ] **Step 6: Carry ReplayedJobID through the DLQ model**

Still in `store/sqlite/models.go`, three more replacements.

(a) In `type dlqEntryModel struct`:

```go
	ReplayedAt *time.Time `grove:"replayed_at"`
	CreatedAt  time.Time  `grove:"created_at,notnull"`

	// Carried so Replay can rebuild a job that behaves like the failed
```

becomes:

```go
	ReplayedAt *time.Time `grove:"replayed_at"`
	CreatedAt  time.Time  `grove:"created_at,notnull"`

	// ReplayedJobID is set together with ReplayedAt by ClaimReplay, and
	// NULL while the entry is unreplayed or was marked by ReplayDLQ.
	ReplayedJobID *string `grove:"replayed_job_id"`

	// Carried so Replay can rebuild a job that behaves like the failed
```

(b) In `toDLQModel`:

```go
		return nil, fmt.Errorf("dispatch/sqlite: encode dlq resource limits: %w", err)
	}

	return &dlqEntryModel{
```

becomes:

```go
		return nil, fmt.Errorf("dispatch/sqlite: encode dlq resource limits: %w", err)
	}

	var replayedJobID *string
	if e.ReplayedJobID != nil {
		s := e.ReplayedJobID.String()
		replayedJobID = &s
	}

	return &dlqEntryModel{
```

and further down in the same literal:

```go
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		Priority:         e.Priority,
```

becomes:

```go
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		ReplayedJobID: replayedJobID,

		Priority:         e.Priority,
```

(c) In `fromDLQModel`:

```go
		return nil, fmt.Errorf("dispatch/sqlite: decode dlq resource limits: %w", err)
	}

	return &dlq.Entry{
```

becomes:

```go
		return nil, fmt.Errorf("dispatch/sqlite: decode dlq resource limits: %w", err)
	}

	var replayedJobID *id.JobID
	if m.ReplayedJobID != nil {
		parsed, parseErr := id.ParseJobID(*m.ReplayedJobID)
		if parseErr != nil {
			return nil, fmt.Errorf("dispatch/sqlite: parse replayed job id %q: %w", *m.ReplayedJobID, parseErr)
		}
		replayedJobID = &parsed
	}

	return &dlq.Entry{
```

and further down in the same literal:

```go
		ReplayedAt: m.ReplayedAt,
		CreatedAt:  m.CreatedAt,

		Priority:         m.Priority,
```

becomes:

```go
		ReplayedAt: m.ReplayedAt,
		CreatedAt:  m.CreatedAt,

		ReplayedJobID: replayedJobID,

		Priority:         m.Priority,
```

The blank lines around `ReplayedJobID:` keep gofmt from realigning the existing fields. `GetDLQ`, `ListDLQ`, `ListDLQPage` and the new `GetDLQByJobID` all read through `fromDLQModel`, which is what `ReplayedJobIDReadsBackFromEveryPath` checks.

Run: `gofmt -l store/sqlite/ && go build ./...`
Expected: no output.

- [ ] **Step 7: Implement the capabilities**

Create `store/sqlite/operator.go`:

```go
package sqlite

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ dlq.ReplayClaimer    = (*Store)(nil)
	_ cron.TargetedUpdater = (*Store)(nil)
	_ workflow.Reopener    = (*Store)(nil)
)

// The claim, the release and the reopen below are each one conditional
// UPDATE. SQLite holds a single write lock for the whole database, so the
// condition and the write cannot interleave with another writer, and of
// two concurrent claims exactly one changes a row. The conditional form
// is still what decides the winner: without it the loser would overwrite
// the winner as soon as the lock came free.
//
// Those three run under withBusyRetry because they are the writes callers
// race on. Grove's sqlitedriver sets no busy_timeout, so the loser of the
// lock fails at once with SQLITE_BUSY instead of waiting, and without the
// retry a refused claim would surface as a driver error rather than as
// ErrDLQAlreadyReplayed or ErrInvalidState.
//
// Every time is bound as a time.Time, never formatted, for the reason on
// ReclaimExpiredLeases: the driver writes its own text form, and a column
// holding a mix of forms no longer sorts or compares correctly.

// ClaimReplay marks an unreplayed entry replayed by jobID.
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	now := time.Now().UTC()

	var rows int64
	err := withBusyRetry(ctx, func() error {
		res, execErr := s.sdb.NewUpdate((*dlqEntryModel)(nil)).
			Set("replayed_at = ?", now).
			Set("replayed_job_id = ?", jobID.String()).
			Where("id = ?", entryID.String()).
			Where("replayed_at IS NULL").
			Exec(ctx)
		if execErr != nil {
			return execErr
		}
		rows, _ = res.RowsAffected() //nolint:errcheck // driver always returns nil
		return nil
	})
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: claim replay: %w", err)
	}
	if rows == 1 {
		return nil
	}

	// No row changed: either there is no such entry, or it was already
	// replayed. The entry cannot come back once gone, so reading after the
	// write still tells the two apart.
	exists, err := s.dlqExists(ctx, entryID)
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: claim replay: %w", err)
	}
	if !exists {
		return dispatch.ErrDLQNotFound
	}

	return dispatch.ErrDLQAlreadyReplayed
}

// ReleaseReplay undoes a claim, but only the one jobID made.
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	var rows int64
	err := withBusyRetry(ctx, func() error {
		res, execErr := s.sdb.NewUpdate((*dlqEntryModel)(nil)).
			Set("replayed_at = NULL").
			Set("replayed_job_id = NULL").
			Where("id = ?", entryID.String()).
			Where("replayed_job_id = ?", jobID.String()).
			Exec(ctx)
		if execErr != nil {
			return execErr
		}
		rows, _ = res.RowsAffected() //nolint:errcheck // driver always returns nil
		return nil
	})
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: release replay: %w", err)
	}
	if rows == 1 {
		return nil
	}

	// Somebody else's claim, or no claim at all, is a no-op. Only a
	// missing entry is an error.
	exists, err := s.dlqExists(ctx, entryID)
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: release replay: %w", err)
	}
	if !exists {
		return dispatch.ErrDLQNotFound
	}

	return nil
}

// dlqExists reports whether the entry is in the dead letter queue.
func (s *Store) dlqExists(ctx context.Context, entryID id.DLQID) (bool, error) {
	count, err := s.sdb.NewSelect((*dlqEntryModel)(nil)).
		Where("id = ?", entryID.String()).
		Count(ctx)
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// GetDLQByJobID returns the newest entry, by ID, for a failed job.
// idx_dispatch_dlq_job_id holds the entries for one job in ID order, so
// this is one index probe.
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error) {
	m := new(dlqEntryModel)
	err := s.sdb.NewSelect(m).
		Where("job_id = ?", jobID.String()).
		OrderExpr("id DESC").
		Limit(1).
		Scan(ctx)
	if err != nil {
		if isNoRows(err) {
			return nil, dispatch.ErrDLQNotFound
		}
		return nil, fmt.Errorf("dispatch/sqlite: get dlq by job id: %w", err)
	}
	return fromDLQModel(m)
}

// DeleteDLQ removes one entry.
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error {
	res, err := s.sdb.NewDelete((*dlqEntryModel)(nil)).
		Where("id = ?", entryID.String()).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: delete dlq: %w", err)
	}
	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 0 {
		return dispatch.ErrDLQNotFound
	}
	return nil
}

// SetCronEnabled sets enabled, and next_run_at when one is given.
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error {
	q := s.sdb.NewUpdate((*cronEntryModel)(nil)).
		Set("enabled = ?", enabled).
		Set("updated_at = ?", time.Now().UTC())
	if nextRunAt != nil {
		q = q.Set("next_run_at = ?", *nextRunAt)
	}

	res, err := q.Where("id = ?", entryID.String()).Exec(ctx)
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: set cron enabled: %w", err)
	}
	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 0 {
		return dispatch.ErrCronNotFound
	}
	return nil
}

// UpdateCronNextRun sets next_run_at and nothing else the scheduler does
// not own. In particular it never writes enabled, which is what lets an
// operator's disable survive a fire that read the entry before it.
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error {
	res, err := s.sdb.NewUpdate((*cronEntryModel)(nil)).
		Set("next_run_at = ?", nextRunAt).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", entryID.String()).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: update cron next run: %w", err)
	}
	rows, _ := res.RowsAffected() //nolint:errcheck // driver always returns nil
	if rows == 0 {
		return dispatch.ErrCronNotFound
	}
	return nil
}

// ReopenRun moves a finished run back to running, for exactly one caller.
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error {
	now := time.Now().UTC()

	var rows int64
	err := withBusyRetry(ctx, func() error {
		res, execErr := s.sdb.NewUpdate((*workflowRunModel)(nil)).
			Set("state = ?", string(workflow.RunStateRunning)).
			Set("error = ?", "").
			Set("completed_at = NULL").
			Set("updated_at = ?", now).
			Where("id = ?", runID.String()).
			Where("state <> ?", string(workflow.RunStateRunning)).
			Exec(ctx)
		if execErr != nil {
			return execErr
		}
		rows, _ = res.RowsAffected() //nolint:errcheck // driver always returns nil
		return nil
	})
	if err != nil {
		return fmt.Errorf("dispatch/sqlite: reopen run: %w", err)
	}
	if rows == 1 {
		return nil
	}

	// No row changed: the run is missing or already running. Read the
	// state to say which, and to name it in the refusal.
	run, err := s.GetRun(ctx, runID)
	if err != nil {
		return err
	}

	return fmt.Errorf("%w: run %s is %s", dispatch.ErrInvalidState, runID, run.State)
}
```

Run: `go test -race -count=1 -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestClaimReplayStores|TestRunVersionAndParent' ./store/sqlite/ 2>&1 | grep -v -- '--- PASS'`
Expected: one failing case, because `PushDLQ` still wraps the driver's constraint error:

```
--- FAIL: TestDLQReplayConformance (3.53s)
    --- FAIL: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.27s)
        dlq_replay.go:440: PushDLQ(duplicate ID) error = dispatch/sqlite: push dlq: sqlitedriver: exec: constraint failed: UNIQUE constraint failed: dispatch_dlq.id (1555), want ErrDLQAlreadyExists
FAIL
FAIL	github.com/xraph/dispatch/store/sqlite
FAIL
```

- [ ] **Step 8: Refuse a duplicate push**

Mapping the constraint error, rather than `INSERT ... ON CONFLICT DO NOTHING` plus a rows-affected check, is what `RegisterCron` and `CreateRun` already do with `isDuplicateKey`, and the primary key is the only unique constraint on `dispatch_dlq` (its indexes are all non-unique), so a UNIQUE failure on this insert can only be the ID. In `store/sqlite/dlq.go`, replace:

```go
// PushDLQ adds a failed job entry to the dead letter queue.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	m, err := toDLQModel(entry)
	if err != nil {
		return err
	}
	if _, err = s.sdb.NewInsert(m).Exec(ctx); err != nil {
		return fmt.Errorf("dispatch/sqlite: push dlq: %w", err)
	}
	return nil
}
```

with:

```go
// PushDLQ adds a failed job entry to the dead letter queue. An ID that is
// already there is refused with dispatch.ErrDLQAlreadyExists. The primary
// key is the only unique constraint on dispatch_dlq, so a UNIQUE failure
// here can only be the ID, and isDuplicateKey matches it the way
// RegisterCron and CreateRun match theirs.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	m, err := toDLQModel(entry)
	if err != nil {
		return err
	}
	if _, err = s.sdb.NewInsert(m).Exec(ctx); err != nil {
		if isDuplicateKey(err) {
			return dispatch.ErrDLQAlreadyExists
		}
		return fmt.Errorf("dispatch/sqlite: push dlq: %w", err)
	}
	return nil
}
```

`store/sqlite/dlq.go` already imports `github.com/xraph/dispatch`.

Run: `go test -race -count=1 -v -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestClaimReplayStores|TestRunVersionAndParent|TestOperatorMigrations' ./store/sqlite/ 2>&1 | grep -E -- '--- |^ok'`
Expected (times vary; the two concurrent cases take about a second each because losers retry `SQLITE_BUSY`):

```
--- PASS: TestOperatorMigrationsAddColumnsAndIndexes (0.00s)
--- PASS: TestOperatorMigrationsSurviveASecondMigrate (0.00s)
--- PASS: TestOperatorMigrationsRollBackAndReapply (0.00s)
--- PASS: TestDLQReplayConformance (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayFirstWins (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayConcurrentExactlyOneWinner (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/ReplayedJobIDReadsBackFromEveryPath (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnlyReleasesItsOwnClaim (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnUnclaimedEntryIsNoop (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDReturnsNewestByID (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDUnknownJob (0.00s)
    --- PASS: TestDLQReplayConformance/DeleteDLQRemovesOnlyThatEntry (0.00s)
    --- PASS: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.00s)
--- PASS: TestCronConformance (0.00s)
    --- PASS: TestCronConformance/SetCronEnabledLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/SetCronEnabledNilNextRunKeepsNextRun (0.00s)
    --- PASS: TestCronConformance/UpdateCronNextRunLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/DisableSurvivesAFire (0.00s)
    --- PASS: TestCronConformance/TargetedWritesUnknownEntry (0.00s)
--- PASS: TestWorkflowConformance (0.00s)
    --- PASS: TestWorkflowConformance/ReopenFailedRunClearsErrorAndCompletion (0.00s)
    --- PASS: TestWorkflowConformance/ReopenCompletedRun (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunningRunIsRefused (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunUnknown (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunConcurrentExactlyOneWinner (0.00s)
    --- PASS: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.00s)
--- PASS: TestClaimReplayStoresReplayedAtInTheDriverTimeForm (0.00s)
--- PASS: TestRunVersionAndParentReadBackFromEveryPath (0.00s)
ok  	github.com/xraph/dispatch/store/sqlite
```

- [ ] **Step 9: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race ./store/sqlite/...
go vet -tags integration ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: no FAIL lines from `go test ./...` (the SQLite tests are untagged, so this already runs them); `ok  	github.com/xraph/dispatch/store/sqlite` from the race run (about 45 seconds); no output from `go vet`; `0 issues.` from the first lint; the second lint reports only the pre-existing `store/redis/store_test.go:54:5: shadow: declaration of "err"` (govet), which is not this task's.

Checked on 2026-10-07 by mutation, each reverted afterwards: dropping `Where("replayed_at IS NULL")` fails `ClaimReplayFirstWins` and `ClaimReplayConcurrentExactlyOneWinner` (16 of 16 won); dropping `Where("state <> ?", ...)` fails the two reopen refusal cases the same way; making `withBusyRetry` try once fails both concurrent cases with `database is locked (5) (SQLITE_BUSY)` in 3 of 3 runs; not setting `replayedJobID` in `fromDLQModel` fails four replay cases; dropping `Version: m.Version` fails `TestRunVersionAndParentReadBackFromEveryPath`; swapping the Down order in `workflow_run_version_parent` fails the rollback test. Ten repeated `-race` runs of the two concurrent cases passed.

- [ ] **Step 10: Commit**

```bash
git add store/sqlite/operator.go store/sqlite/operator_test.go store/sqlite/operator_migrations_test.go
git commit --only -m "feat(sqlite): implement the replay claim, targeted cron writes and run reopen

SQLite now passes the replay, cron and workflow suites under -race.
ClaimReplay is one UPDATE conditional on replayed_at IS NULL, and
ReopenRun one conditional on state <> 'running', so of two callers
racing for the same row exactly one changes it. Both retry SQLITE_BUSY
the way the lease writes do. Grove's driver sets no busy_timeout, and
without the retry the losers of a race came back as 'database is
locked' rather than as a refusal. PushDLQ refuses a duplicate ID with
ErrDLQAlreadyExists.

Two migrations. dlq_replayed_job_id adds the column a claim fills in,
plus an index on (job_id, id) for GetDLQByJobID.
workflow_run_version_parent adds version and parent_run_id to
dispatch_workflow_runs, which never had either: every run read back as
version 0, which the runner resolves to the newest registered version,
and ListChildRuns failed on every call with 'no such column:
parent_run_id'." -- store/sqlite/dlq.go store/sqlite/migrations.go store/sqlite/models.go \
  store/sqlite/operator.go store/sqlite/operator_test.go store/sqlite/operator_migrations_test.go
git show --stat HEAD | tail -8
```

Expected: `6 files changed, 685 insertions(+), 1 deletion(-)`.

Notes for later tasks:
- The store folding task adds `dlq.ReplayClaimer`, `cron.TargetedUpdater` and `workflow.Reopener` to the base interfaces; `store/sqlite/operator.go` already asserts all three on `*Store`.
- `UpdateCronNextRun` returns `dispatch.ErrCronNotFound` for a deleted entry, as Task 1 pinned. The scheduler task must tolerate it.
- `ListChildRuns` still orders by `created_at ASC`. The new index is `(parent_run_id, id)` as specified, so it narrows by parent and SQLite sorts the few children; run IDs are time-ordered, so switching the query to `id ASC` would let the index do the sort too, if a later task wants it.
- The other durable backends had the same run gap on main: Postgres and Mongo models carry neither `Version` nor `ParentRunID`, and redis's `runEntity` drops both. `RunWorkflowSuite` only catches `ParentRunID`, because it compares a store read with a store read; a `Version` round-trip case in the suite would hold every backend to it.

---

### Task 4: MongoDB implements the replay claim, targeted cron writes and run reopen

Task 1 defined the three capabilities (`dlq.ReplayClaimer`, `cron.TargetedUpdater`, `workflow.Reopener`) and their suites, and made the memory store pass them. This task makes Mongo pass the same suites. Each conditional write is one `UpdateOne` whose filter carries the condition, so the check and the write are one atomic step on the server; when nothing matched, a second read only picks the error to return. Running the workflow suite also exposes an older gap: Mongo's run model never stored `ParentRunID` or `Version`, so `ListChildRuns` could not find a child and every run read back as version 1 (the runner resumes and replays on the stamped version). Both get stored here.

One Mongo detail runs through all of it. grove's insert writes a nil pointer as an explicit BSON null, while the raw driver's encoder (and any `$unset`) leaves the key out. So an unreplayed entry's `replayed_at` can be null or absent. The claim filters on `replayed_at: nil`, which Mongo matches against both. `ReleaseReplay` filters on `replayed_job_id` equal to a job ID string, which neither shape equals, so it needs no special case.

**Files:**
- Create: `store/mongo/operator.go`
- Modify: `store/mongo/models.go` (`workflowRunModel` and its two mappers, around lines 202 to 258; `dlqEntryModel` and its two mappers, around lines 369 to 465)
- Modify: `store/mongo/dlq.go` (imports and `PushDLQ`, lines 1 to 24)
- Modify: `store/mongo/store.go` (`migrationIndexes`, the `colDLQ` entry, around line 252)
- Test: `store/mongo/operator_test.go` (create), `store/mongo/list_index_test.go` (one line, around line 68)

**Interfaces:**
- Consumes (from Task 1): `dlq.ReplayClaimer`, `cron.TargetedUpdater`, `workflow.Reopener`; `dlq.Entry.ReplayedJobID *id.JobID`; `dispatch.ErrDLQAlreadyExists`, `dispatch.ErrDLQAlreadyReplayed`; `storetest.RunDLQReplaySuite`, `storetest.RunCronSuite`, `storetest.RunWorkflowSuite` and their `DLQReplayStore`, `CronStore`, `WorkflowStore` interfaces. Also the existing test helpers in `store/mongo/dequeue_test.go`: `startMongo(t) string`, `openStore(t, uri) *mongostore.Store`, `rawDatabase(t, uri) *mongod.Database`.
- Produces: `*mongo.Store` implements all three capabilities:

```go
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error)
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error
```

`PushDLQ` returns `dispatch.ErrDLQAlreadyExists` on a duplicate ID. `Migrate` creates a `{job_id: 1, _id: -1}` index on `dispatch_dlq`. Mongo runs now round-trip `ParentRunID` and `Version`.

The Mongo tests carry no build tag. They start their own `mongo:7` container through testcontainers and skip silently when Docker is unavailable, so a green run without `-v` proves nothing: confirm PASS lines once with `-v`.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- store/mongo && git log --oneline -3`
Expected: no lines from `git status`, and the log shows Task 1's commit (`feat(store): add the replay claim, targeted cron writes and run reopen, with a memory reference`). If another session has uncommitted edits under `store/mongo`, stop and report.

- [ ] **Step 2: Write the tests**

Create `store/mongo/operator_test.go`:

```go
package mongo_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/store/storetest"
	"github.com/xraph/dispatch/workflow"
)

// The three operator suites run the way TestListSuite does: one container
// and one migrated store per suite, shared by every case. Each case works
// on rows it created under names nobody else uses, which the suites
// document as safe. Migrate runs first so GetDLQByJobID reads through the
// index production has.

func TestDLQReplayConformance(t *testing.T) {
	uri := startMongo(t)
	shared := openStore(t, uri)

	if err := shared.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	storetest.RunDLQReplaySuite(t, func(t *testing.T) storetest.DLQReplayStore {
		t.Helper()

		return shared
	})
}

func TestCronConformance(t *testing.T) {
	uri := startMongo(t)
	shared := openStore(t, uri)

	if err := shared.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	storetest.RunCronSuite(t, func(t *testing.T) storetest.CronStore {
		t.Helper()

		return shared
	})
}

func TestWorkflowConformance(t *testing.T) {
	uri := startMongo(t)
	shared := openStore(t, uri)

	if err := shared.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	storetest.RunWorkflowSuite(t, func(t *testing.T) storetest.WorkflowStore {
		t.Helper()

		return shared
	})
}

// TestClaimReplayMatchesBothUnreplayedShapes covers the document shape the
// suite cannot produce. PushDLQ goes through grove's insert, which writes
// replayed_at as an explicit null; an entry written by the raw driver, or
// one ReleaseReplay has cleared, has no replayed_at key at all. The claim
// filter has to treat both as unreplayed, and a claimed entry as claimed.
func TestClaimReplayMatchesBothUnreplayedShapes(t *testing.T) {
	uri := startMongo(t)
	s := openStore(t, uri)
	col := rawDatabase(t, uri).Collection("dispatch_dlq")
	ctx := context.Background()

	now := time.Now().UTC().Truncate(time.Millisecond)
	entry := func(name string) *dlq.Entry {
		return &dlq.Entry{
			ID:        id.NewDLQID(),
			JobID:     id.NewJobID(),
			JobName:   name,
			Queue:     "claim-shapes",
			Payload:   []byte(`{}`),
			Error:     "boom",
			FailedAt:  now,
			CreatedAt: now,
		}
	}

	nullKey, absentKey := entry("null-shape"), entry("absent-shape")
	for _, e := range []*dlq.Entry{nullKey, absentKey} {
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("push %s: %v", e.JobName, err)
		}
	}

	if _, err := col.UpdateOne(ctx,
		bson.M{"_id": absentKey.ID.String()},
		bson.M{"$unset": bson.M{"replayed_at": "", "replayed_job_id": ""}},
	); err != nil {
		t.Fatalf("unset replay fields: %v", err)
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

	for _, e := range []*dlq.Entry{nullKey, absentKey} {
		jobID := id.NewJobID()
		if err := s.ClaimReplay(ctx, e.ID, jobID); err != nil {
			t.Fatalf("ClaimReplay(%s): %v", e.JobName, err)
		}

		got, err := s.GetDLQ(ctx, e.ID)
		if err != nil {
			t.Fatalf("GetDLQ(%s): %v", e.JobName, err)
		}
		if got.ReplayedAt == nil || got.ReplayedJobID == nil || *got.ReplayedJobID != jobID {
			t.Errorf("%s after claim: ReplayedAt %v, ReplayedJobID %v, want both set to the claim",
				e.JobName, got.ReplayedAt, got.ReplayedJobID)
		}

		if err := s.ClaimReplay(ctx, e.ID, id.NewJobID()); !errors.Is(err, dispatch.ErrDLQAlreadyReplayed) {
			t.Errorf("second ClaimReplay(%s) error = %v, want ErrDLQAlreadyReplayed", e.JobName, err)
		}
	}
}

// TestRunVersionRoundTrips covers what the workflow suite cannot see: it
// compares one store read with another, so a model that drops Version
// reads back 0 on both sides and passes. The runner resumes a run on the
// definition version stamped on it, so a dropped version would resume a
// version 3 run on version 1.
func TestRunVersionRoundTrips(t *testing.T) {
	uri := startMongo(t)
	s := openStore(t, uri)
	ctx := context.Background()

	run := &workflow.Run{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewRunID(),
		Name:      "versioned",
		State:     workflow.RunStateRunning,
		StartedAt: time.Now().UTC().Truncate(time.Millisecond),
		Version:   3,
	}
	if err := s.CreateRun(ctx, run); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	got, err := s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if got.Version != 3 {
		t.Fatalf("Version = %d after a round trip, want 3", got.Version)
	}
}
```

Then, in `store/mongo/list_index_test.go`, inside `TestListIndexesExistAfterMigrate`, find:

```go
		{"dispatch_dlq", "queue:1,_id:-1"},
		{"dispatch_workflow_runs", "state:1,_id:-1"},
```

and replace it with:

```go
		{"dispatch_dlq", "queue:1,_id:-1"},
		{"dispatch_dlq", "job_id:1,_id:-1"},
		{"dispatch_workflow_runs", "state:1,_id:-1"},
```

- [ ] **Step 3: Run them and see the build fail**

Run: `go test -count=1 ./store/mongo/`
Expected:

```
# github.com/xraph/dispatch/store/mongo_test [github.com/xraph/dispatch/store/mongo.test]
store/mongo/operator_test.go:35:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/mongo".Store) as storetest.DLQReplayStore value in return statement: *"github.com/xraph/dispatch/store/mongo".Store does not implement storetest.DLQReplayStore (missing method ClaimReplay)
store/mongo/operator_test.go:50:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/mongo".Store) as storetest.CronStore value in return statement: *"github.com/xraph/dispatch/store/mongo".Store does not implement storetest.CronStore (missing method SetCronEnabled)
store/mongo/operator_test.go:65:10: cannot use shared (variable of type *"github.com/xraph/dispatch/store/mongo".Store) as storetest.WorkflowStore value in return statement: *"github.com/xraph/dispatch/store/mongo".Store does not implement storetest.WorkflowStore (missing method ReopenRun)
store/mongo/operator_test.go:125:15: s.ClaimReplay undefined (type *"github.com/xraph/dispatch/store/mongo".Store has no field or method ClaimReplay)
store/mongo/operator_test.go:138:15: s.ClaimReplay undefined (type *"github.com/xraph/dispatch/store/mongo".Store has no field or method ClaimReplay)
FAIL	github.com/xraph/dispatch/store/mongo [build failed]
FAIL
```

- [ ] **Step 4: Implement the capabilities**

Create `store/mongo/operator.go`:

```go
package mongo

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ dlq.ReplayClaimer    = (*Store)(nil)
	_ cron.TargetedUpdater = (*Store)(nil)
	_ workflow.Reopener    = (*Store)(nil)
)

// Each conditional write below is one UpdateOne whose filter carries the
// condition. Mongo evaluates the filter and applies the update to a single
// document atomically, so of two concurrent callers exactly one matches.
// When nothing matched, a second read only decides which error to return;
// it never decides whether the write happens.

// ClaimReplay marks an unreplayed entry replayed by jobID.
//
// "Unreplayed" is replayed_at equal to nil, which matches both shapes an
// unreplayed entry can have: the explicit null grove's insert writes, and
// the absent key a raw-driver write or ReleaseReplay leaves.
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	col := s.mdb.Collection(colDLQ)

	res, err := col.UpdateOne(ctx,
		bson.M{"_id": entryID.String(), "replayed_at": nil},
		bson.M{"$set": bson.M{
			"replayed_at":     now(),
			"replayed_job_id": jobID.String(),
		}},
	)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: claim replay: %w", err)
	}
	if res.MatchedCount == 1 {
		return nil
	}

	exists, err := s.dlqExists(ctx, entryID)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: claim replay: %w", err)
	}
	if !exists {
		return dispatch.ErrDLQNotFound
	}

	return dispatch.ErrDLQAlreadyReplayed
}

// ReleaseReplay clears a claim, but only the one jobID made. The filter
// names the job, so a release that lost to another claim matches nothing
// and changes nothing.
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	col := s.mdb.Collection(colDLQ)

	res, err := col.UpdateOne(ctx,
		bson.M{"_id": entryID.String(), "replayed_job_id": jobID.String()},
		bson.M{"$unset": bson.M{"replayed_at": "", "replayed_job_id": ""}},
	)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: release replay: %w", err)
	}
	if res.MatchedCount == 1 {
		return nil
	}

	exists, err := s.dlqExists(ctx, entryID)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: release replay: %w", err)
	}
	if !exists {
		return dispatch.ErrDLQNotFound
	}

	return nil
}

// dlqExists reports whether an entry with this ID is stored.
func (s *Store) dlqExists(ctx context.Context, entryID id.DLQID) (bool, error) {
	n, err := s.mdb.Collection(colDLQ).CountDocuments(ctx,
		bson.M{"_id": entryID.String()},
		options.Count().SetLimit(1),
	)
	if err != nil {
		return false, err
	}

	return n > 0, nil
}

// GetDLQByJobID returns the newest entry, by ID, for a failed job. It
// reads through the {job_id: 1, _id: -1} index Migrate creates, so the
// first document the index yields is the answer.
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error) {
	col := s.mdb.Collection(colDLQ)

	var m dlqEntryModel
	err := col.FindOne(ctx,
		bson.M{"job_id": jobID.String()},
		options.FindOne().SetSort(bson.D{{Key: "_id", Value: -1}}),
	).Decode(&m)
	if err != nil {
		if isNoDocuments(err) {
			return nil, dispatch.ErrDLQNotFound
		}
		return nil, fmt.Errorf("dispatch/mongo: get dlq by job id: %w", err)
	}

	return fromDLQModel(&m)
}

// DeleteDLQ removes one entry.
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error {
	res, err := s.mdb.Collection(colDLQ).DeleteOne(ctx, bson.M{"_id": entryID.String()})
	if err != nil {
		return fmt.Errorf("dispatch/mongo: delete dlq: %w", err)
	}
	if res.DeletedCount == 0 {
		return dispatch.ErrDLQNotFound
	}

	return nil
}

// SetCronEnabled sets enabled, and next_run_at when one is given. It
// writes only those fields and updated_at, never the whole document.
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error {
	set := bson.M{
		"enabled":    enabled,
		"updated_at": now(),
	}
	if nextRunAt != nil {
		set["next_run_at"] = *nextRunAt
	}

	res, err := s.mdb.Collection(colCronEntries).UpdateOne(ctx,
		bson.M{"_id": entryID.String()},
		bson.M{"$set": set},
	)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: set cron enabled: %w", err)
	}
	if res.MatchedCount == 0 {
		return dispatch.ErrCronNotFound
	}

	return nil
}

// UpdateCronNextRun sets next_run_at and updated_at, and nothing else, so
// the scheduler's write after a fire can never touch enabled.
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error {
	res, err := s.mdb.Collection(colCronEntries).UpdateOne(ctx,
		bson.M{"_id": entryID.String()},
		bson.M{"$set": bson.M{
			"next_run_at": nextRunAt,
			"updated_at":  now(),
		}},
	)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: update cron next run: %w", err)
	}
	if res.MatchedCount == 0 {
		return dispatch.ErrCronNotFound
	}

	return nil
}

// ReopenRun moves a run that is not running back to running, clearing
// its error and completion time. The state condition is in the filter,
// so of two concurrent reopens exactly one matches.
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error {
	col := s.mdb.Collection(colWorkflowRuns)

	res, err := col.UpdateOne(ctx,
		bson.M{
			"_id":   runID.String(),
			"state": bson.M{"$ne": string(workflow.RunStateRunning)},
		},
		bson.M{
			"$set": bson.M{
				"state":      string(workflow.RunStateRunning),
				"error":      "",
				"updated_at": now(),
			},
			"$unset": bson.M{"completed_at": ""},
		},
	)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: reopen run: %w", err)
	}
	if res.MatchedCount == 1 {
		return nil
	}

	var m workflowRunModel
	err = col.FindOne(ctx, bson.M{"_id": runID.String()},
		options.FindOne().SetProjection(bson.M{"state": 1}),
	).Decode(&m)
	if err != nil {
		if isNoDocuments(err) {
			return dispatch.ErrRunNotFound
		}
		return fmt.Errorf("dispatch/mongo: reopen run: %w", err)
	}

	return fmt.Errorf("%w: run %s is %s", dispatch.ErrInvalidState, runID, m.State)
}
```

Run: `go vet ./store/mongo/`
Expected: no output.

- [ ] **Step 5: Run the tests and see what the models still drop**

Run: `go test -count=1 -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestClaimReplayMatchesBothUnreplayedShapes|TestRunVersionRoundTrips|TestListIndexesExistAfterMigrate' ./store/mongo/ 2>&1 | grep -E -- '--- FAIL|^\s+\S+\.go:[0-9]+|^(ok|FAIL)'`
Expected (IDs differ per run):

```
--- FAIL: TestListIndexesExistAfterMigrate (1.20s)
    list_index_test.go:74: dispatch_dlq has no {job_id:1,_id:-1} index; has [_id:1 queue:1,failed_at:-1 queue:1,_id:-1]
--- FAIL: TestDLQReplayConformance (2.01s)
    --- FAIL: TestDLQReplayConformance/ClaimReplayFirstWins (0.00s)
        dlq_replay.go:230: after refused claim: ReplayedJobID = nil, want job_01m4c2gpz8eq0t7d75hxw248gp
    --- FAIL: TestDLQReplayConformance/ClaimReplayConcurrentExactlyOneWinner (0.02s)
        dlq_replay.go:248: round 0: ReplayedJobID = nil, want job_01m4c2gpzdeq4tarhynmd216br
    --- FAIL: TestDLQReplayConformance/ReplayedJobIDReadsBackFromEveryPath (0.00s)
        dlq_replay.go:281: GetDLQ: ReplayedJobID = nil, want job_01m4c2gq01e4tt61mhz3y02dax
    --- FAIL: TestDLQReplayConformance/ReleaseReplayOnlyReleasesItsOwnClaim (0.02s)
        dlq_replay.go:337: after stranger release: ReplayedJobID = nil, want job_01m4c2gq07e0v9dsmzhrttn56j
    --- FAIL: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.01s)
        dlq_replay.go:440: PushDLQ(duplicate ID) error = dispatch/mongo: push dlq: mongodriver: insert one: write exception: write errors: [E11000 duplicate key error collection: dispatch_dequeue_test.dispatch_dlq index: _id_ dup key: { _id: "dlq_01m4c2gq2new6942qvpwzv56fd" }], want ErrDLQAlreadyExists
--- FAIL: TestWorkflowConformance (1.91s)
    --- FAIL: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.00s)
        workflow.go:223: child ParentRunID = nil, want wfrun_01m4c2gv8cekjassdmhtmc3py6: the parent link was not stored
--- FAIL: TestClaimReplayMatchesBothUnreplayedShapes (1.54s)
    operator_test.go:134: null-shape after claim: ReplayedAt 2026-10-07 20:57:46.568 +0000 UTC, ReplayedJobID <nil>, want both set to the claim
    operator_test.go:134: absent-shape after claim: ReplayedAt 2026-10-07 20:57:46.577 +0000 UTC, ReplayedJobID <nil>, want both set to the claim
--- FAIL: TestRunVersionRoundTrips (0.97s)
    operator_test.go:171: Version = 0 after a round trip, want 3
FAIL
FAIL	github.com/xraph/dispatch/store/mongo	15.781s
FAIL
```

The claim itself works (the claimed entries have `ReplayedAt` set, and `TestCronConformance` already passes). What fails is the model: `replayed_job_id` is written by `ClaimReplay` but never read back, the run model drops `parent_run_id` and `version`, a duplicate push surfaces as a raw driver error, and the index is missing.

- [ ] **Step 6: Store the replayed job, the parent run and the version**

In `store/mongo/models.go`, the end of `type workflowRunModel` reads:

```go
	CompletedAt *time.Time `grove:"completed_at"   bson:"completed_at,omitempty"`
	CreatedAt   time.Time  `grove:"created_at,notnull" bson:"created_at"`
	UpdatedAt   time.Time  `grove:"updated_at,notnull" bson:"updated_at"`
}

func toRunModel(r *workflow.Run) *workflowRunModel {
```

Replace it with:

```go
	CompletedAt *time.Time `grove:"completed_at"   bson:"completed_at,omitempty"`
	CreatedAt   time.Time  `grove:"created_at,notnull" bson:"created_at"`
	UpdatedAt   time.Time  `grove:"updated_at,notnull" bson:"updated_at"`

	// Version is the definition version the run executes, which the
	// runner resumes and replays on. ParentRunID links a child run to its
	// parent, and ListChildRuns filters on it. Both used to be dropped
	// here, so every run read back as version 1 with no parent. A
	// document written before they were added decodes as version 0 (the
	// runner's "version 1") with no parent, which is what it was read as
	// before.
	Version     int     `grove:"version"        bson:"version"`
	ParentRunID *string `grove:"parent_run_id"  bson:"parent_run_id,omitempty"`
}

func toRunModel(r *workflow.Run) *workflowRunModel {
```

Replace the whole of `toRunModel` and `fromRunModel` (they sit directly below the struct) with:

```go
func toRunModel(r *workflow.Run) *workflowRunModel {
	m := &workflowRunModel{
		ID:          r.ID.String(),
		Name:        r.Name,
		State:       string(r.State),
		Input:       r.Input,
		Output:      r.Output,
		Error:       r.Error,
		ScopeAppID:  r.ScopeAppID,
		ScopeOrgID:  r.ScopeOrgID,
		StartedAt:   r.StartedAt,
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		Version:     r.Version,
	}
	if r.ParentRunID != nil {
		parent := r.ParentRunID.String()
		m.ParentRunID = &parent
	}
	return m
}

func fromRunModel(m *workflowRunModel) (*workflow.Run, error) {
	parsedID, err := id.ParseRunID(m.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/mongo: parse run id %q: %w", m.ID, err)
	}

	r := &workflow.Run{
		Entity: dispatch.Entity{
			CreatedAt: m.CreatedAt,
			UpdatedAt: m.UpdatedAt,
		},
		ID:          parsedID,
		Name:        m.Name,
		State:       workflow.RunState(m.State),
		Input:       m.Input,
		Output:      m.Output,
		Error:       m.Error,
		ScopeAppID:  m.ScopeAppID,
		ScopeOrgID:  m.ScopeOrgID,
		StartedAt:   m.StartedAt,
		CompletedAt: m.CompletedAt,
		Version:     m.Version,
	}
	if m.ParentRunID != nil {
		parent, parseErr := id.ParseRunID(*m.ParentRunID)
		if parseErr != nil {
			return nil, fmt.Errorf("dispatch/mongo: parse parent run id %q: %w", *m.ParentRunID, parseErr)
		}
		r.ParentRunID = &parent
	}
	return r, nil
}
```

Still in `store/mongo/models.go`, inside `type dlqEntryModel`, find:

```go
	ReplayedAt *time.Time `grove:"replayed_at"    bson:"replayed_at,omitempty"`
	CreatedAt  time.Time  `grove:"created_at,notnull" bson:"created_at"`

	// Carried so Replay can rebuild a job that behaves like the failed
```

and replace it with:

```go
	ReplayedAt *time.Time `grove:"replayed_at"    bson:"replayed_at,omitempty"`
	CreatedAt  time.Time  `grove:"created_at,notnull" bson:"created_at"`

	// ReplayedJobID is the job a claimed replay or retry created. Like
	// replayed_at, it is an explicit null after grove's insert and absent
	// after ReleaseReplay or a raw-driver write, so any filter on it must
	// match both shapes. ReleaseReplay only ever compares it with a job
	// ID, which neither shape equals.
	ReplayedJobID *string `grove:"replayed_job_id" bson:"replayed_job_id,omitempty"`

	// Carried so Replay can rebuild a job that behaves like the failed
```

Then replace the whole of `toDLQModel` and `fromDLQModel` (directly below `dlqEntryModel`) with:

```go
func toDLQModel(e *dlq.Entry) *dlqEntryModel {
	m := &dlqEntryModel{
		ID:         e.ID.String(),
		JobID:      e.JobID.String(),
		JobName:    e.JobName,
		Queue:      e.Queue,
		Payload:    e.Payload,
		Error:      e.Error,
		RetryCount: e.RetryCount,
		MaxRetries: e.MaxRetries,
		ScopeAppID: e.ScopeAppID,
		ScopeOrgID: e.ScopeOrgID,
		FailedAt:   e.FailedAt,
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		Priority:         e.Priority,
		Timeout:          int64(e.Timeout),
		LeaseTTL:         int64(e.LeaseTTL),
		ArtifactBindings: e.ArtifactBindings,
		Resources:        e.Resources,
		ResourceLimits:   e.ResourceLimits,
		ResourceClass:    e.ResourceClass,
		InputBytes:       e.InputBytes,
		PrimaryInputHash: e.PrimaryInputHash,
	}
	if e.ReplayedJobID != nil {
		replayedJob := e.ReplayedJobID.String()
		m.ReplayedJobID = &replayedJob
	}
	return m
}

func fromDLQModel(m *dlqEntryModel) (*dlq.Entry, error) {
	parsedID, err := id.ParseDLQID(m.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/mongo: parse dlq id %q: %w", m.ID, err)
	}

	parsedJobID, err := id.ParseJobID(m.JobID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/mongo: parse job id %q: %w", m.JobID, err)
	}

	e := &dlq.Entry{
		ID:         parsedID,
		JobID:      parsedJobID,
		JobName:    m.JobName,
		Queue:      m.Queue,
		Payload:    m.Payload,
		Error:      m.Error,
		RetryCount: m.RetryCount,
		MaxRetries: m.MaxRetries,
		ScopeAppID: m.ScopeAppID,
		ScopeOrgID: m.ScopeOrgID,
		FailedAt:   m.FailedAt,
		ReplayedAt: m.ReplayedAt,
		CreatedAt:  m.CreatedAt,

		Priority:         m.Priority,
		Timeout:          time.Duration(m.Timeout),
		LeaseTTL:         time.Duration(m.LeaseTTL),
		ArtifactBindings: m.ArtifactBindings,
		Resources:        m.Resources,
		ResourceLimits:   m.ResourceLimits,
		ResourceClass:    m.ResourceClass,
		InputBytes:       m.InputBytes,
		PrimaryInputHash: m.PrimaryInputHash,
	}
	if m.ReplayedJobID != nil {
		replayedJob, parseErr := id.ParseJobID(*m.ReplayedJobID)
		if parseErr != nil {
			return nil, fmt.Errorf("dispatch/mongo: parse replayed job id %q: %w", *m.ReplayedJobID, parseErr)
		}
		e.ReplayedJobID = &replayedJob
	}
	return e, nil
}
```

Every DLQ read path (`GetDLQ`, `ListDLQ`, `ListDLQPage`, `GetDLQByJobID`) decodes into `dlqEntryModel` and goes through `fromDLQModel`, and every run read goes through `fromRunModel`, so the mappers are the only place these fields need adding.

- [ ] **Step 7: Refuse a duplicate push**

In `store/mongo/dlq.go`, the imports and `PushDLQ` currently read:

```go
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
)

// PushDLQ adds a failed job entry to the dead letter queue.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	m := toDLQModel(entry)
	_, err := s.mdb.NewInsert(m).Exec(ctx)
	if err != nil {
		return fmt.Errorf("dispatch/mongo: push dlq: %w", err)
	}
	return nil
}
```

Replace that with:

```go
	"go.mongodb.org/mongo-driver/v2/bson"
	mongod "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
)

// PushDLQ adds a failed job entry to the dead letter queue. An ID that is
// already there is refused with dispatch.ErrDLQAlreadyExists rather than
// reported as a driver error: the _id index refuses the insert, so a push
// can never overwrite an entry or drop its replay claim.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	m := toDLQModel(entry)
	_, err := s.mdb.NewInsert(m).Exec(ctx)
	if err != nil {
		if mongod.IsDuplicateKeyError(err) {
			return dispatch.ErrDLQAlreadyExists
		}
		return fmt.Errorf("dispatch/mongo: push dlq: %w", err)
	}
	return nil
}
```

grove's insert wraps the driver error with `%w` (`mongodriver: insert one: %w`), so the driver's own `mongod.IsDuplicateKeyError` sees through it. Use it rather than the package's string-matching `isDuplicateKey`.

- [ ] **Step 8: Index the DLQ by job**

In `store/mongo/store.go`, inside `migrationIndexes()`, the `colDLQ` entry ends:

```go
			// Paged list by queue. See listOrderKeys.
			listOrderKeys("queue"),
		},
		colEvents: {
```

Replace it with:

```go
			// Paged list by queue. See listOrderKeys.
			listOrderKeys("queue"),
			// GetDLQByJobID: the entries for one job, newest first, so
			// the newest is the first document the index yields.
			listOrderKeys("job_id"),
		},
		colEvents: {
```

(`listOrderKeys("queue"),` appears twice in the file; this is the one directly above `colEvents`.) `migrationIndexes()` is what `Migrate` runs; the grove migration group in `migrations.go` is never executed, so do not add the index there.

- [ ] **Step 9: Run the tests and see them pass**

Run: `go test -count=1 -v -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestClaimReplayMatchesBothUnreplayedShapes|TestRunVersionRoundTrips|TestListIndexesExistAfterMigrate' ./store/mongo/ 2>&1 | grep -E -- '--- |^(ok|FAIL)|SKIP'`
Expected (timings differ), and no `SKIP` line:

```
--- PASS: TestListIndexesExistAfterMigrate (1.02s)
--- PASS: TestDLQReplayConformance (1.19s)
    --- PASS: TestDLQReplayConformance/ClaimReplayFirstWins (0.00s)
    --- PASS: TestDLQReplayConformance/ClaimReplayConcurrentExactlyOneWinner (0.04s)
    --- PASS: TestDLQReplayConformance/ClaimReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/ReplayedJobIDReadsBackFromEveryPath (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnlyReleasesItsOwnClaim (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnUnclaimedEntryIsNoop (0.00s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDReturnsNewestByID (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDUnknownJob (0.00s)
    --- PASS: TestDLQReplayConformance/DeleteDLQRemovesOnlyThatEntry (0.00s)
    --- PASS: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.00s)
--- PASS: TestCronConformance (1.11s)
    --- PASS: TestCronConformance/SetCronEnabledLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/SetCronEnabledNilNextRunKeepsNextRun (0.00s)
    --- PASS: TestCronConformance/UpdateCronNextRunLeavesOtherFieldsAlone (0.00s)
    --- PASS: TestCronConformance/DisableSurvivesAFire (0.00s)
    --- PASS: TestCronConformance/TargetedWritesUnknownEntry (0.00s)
--- PASS: TestWorkflowConformance (1.14s)
    --- PASS: TestWorkflowConformance/ReopenFailedRunClearsErrorAndCompletion (0.00s)
    --- PASS: TestWorkflowConformance/ReopenCompletedRun (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunningRunIsRefused (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunUnknown (0.00s)
    --- PASS: TestWorkflowConformance/ReopenRunConcurrentExactlyOneWinner (0.03s)
    --- PASS: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.00s)
--- PASS: TestClaimReplayMatchesBothUnreplayedShapes (1.12s)
--- PASS: TestRunVersionRoundTrips (1.10s)
ok  	github.com/xraph/dispatch/store/mongo
```

Checked on 2026-10-07: a mutant `ClaimReplay` that did a `FindOne`, returned `ErrDLQAlreadyReplayed` if `replayed_at` was set, then ran `UpdateOne` on `{_id}` alone failed `ClaimReplayConcurrentExactlyOneWinner` 3 of 3 runs under `-race`; the same mutant of `ReopenRun` (read the state, then update on `{_id}` alone) failed `ReopenRunConcurrentExactlyOneWinner` 3 of 3. The round trip to the container widens the window enough that the suite catches it every time.

- [ ] **Step 10: Gate**

Run:

```bash
go build ./... && go test -count=1 ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race ./store/mongo/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: no FAIL lines from `go test ./...` (it runs the Mongo container tests too, since they are untagged); `ok  	github.com/xraph/dispatch/store/mongo` from the race run; `0 issues.` from the first lint; the second lint reports only the pre-existing `store/redis/store_test.go:54:5: shadow: declaration of "err"` (govet), which is not this task's.

- [ ] **Step 11: Commit**

```bash
git add store/mongo/operator.go store/mongo/operator_test.go
git commit --only -m "feat(mongo): implement the replay claim, targeted cron writes and run reopen

Each conditional write is one UpdateOne with the condition in its filter,
so Mongo checks and writes in one step and two racing callers can't both
win. ClaimReplay matches replayed_at equal to nil, which covers the
explicit null grove's insert writes and the missing key ReleaseReplay
leaves behind. When nothing matches, a second read only picks the error.

PushDLQ now returns ErrDLQAlreadyExists on a duplicate ID. Migrate adds a
{job_id: 1, _id: -1} index so GetDLQByJobID reads the newest entry first.

The run model also dropped ParentRunID and Version, so ListChildRuns
never found a child and every run came back as version 1. Both are
stored now. Old documents read the same as they did before." -- store/mongo/operator.go store/mongo/operator_test.go \
  store/mongo/models.go store/mongo/dlq.go store/mongo/store.go store/mongo/list_index_test.go
git show --stat HEAD | tail -8
```

Expected: `6 files changed, 458 insertions(+), 7 deletions(-)`.

Notes for later tasks:
- `ReleaseReplay` clears with `$unset`, so a released entry has neither `replayed_at` nor `replayed_job_id` keys. Every existing `replayed_at` filter (`replayedFilter` in `list.go`, the claim here) already treats absent like null. Anything new that filters on either field must do the same: equality with `nil` matches both, `$exists` does not.
- `ReopenRun` also `$unset`s `completed_at`, the same absent shape `toRunModel` produces for a nil `CompletedAt` under `omitempty`.
- The old `ReplayDLQ` still sets only `replayed_at`. An entry it marked has `ReplayedJobID` nil, which `dlq.Entry`'s doc already allows.
- The workflow suite compares store reads with store reads, so it cannot see a backend that drops `Run.Version` (both sides read 0). Mongo has `TestRunVersionRoundTrips` for that; postgres and sqlite run models have no `version` column either, so the engine's `ReplayFrom` version check sees every run as version 1 there.

---

### Task 5: Redis implements the replay claim, targeted cron writes and run reopen, and keeps a run's parent

Redis stores each entity as one JSON blob, so every write to a dead letter entry, a cron entry or a run rewrites the whole thing, and today most of those writes are a read in Go followed by a plain SET. That is how a disabled cron comes back on this backend: the scheduler's writes around a fire (the lock, the last run, the write-back of the row) each read the entry, and one that read it before an operator's disable puts `enabled` back when it SETs. Moving the scheduler onto single-field writes does not help here by itself, because on this backend a single-field write is still a whole-blob SET. It is also why two workers can both take a cron lock, and why two replays of one dead letter would both win. This task routes every conditional write through one compare-and-set helper, adds the per-job DLQ index `GetDLQByJobID` needs, makes `PushDLQ` refuse a duplicate ID, and stops `runEntity` dropping `ParentRunID` and `Version`.

**Why a whole-blob compare-and-set, and not the other two shapes.** `updateEntity` (new `store/redis/cas.go`) reads the raw blob, decodes it in Go, lets the caller decide and mutate, marshals with `encoding/json`, and hands both the bytes it read and the new bytes to a Lua script that SETs only if the key still holds exactly what Go read; otherwise Go re-reads and decides again (bounded at 64 attempts).
- Patching the entity inside Lua and calling `cjson.encode` is out. `dlqEntity` carries `Timeout`, `LeaseTTL`, `InputBytes` and resource sets as int64, and Redis's cjson writes an integer past 2^53 in scientific notation that `encoding/json` then refuses to read (the bug recorded at the top of `store/redis/lease.go`). `TestClaimReplayKeepsLargeDurations` pins this.
- The `lease.go` shape (Lua checks one guard field, then blind-SETs Go's blob) would be enough for the claim, but not for cron: a write to any other field between Go's read and the script is silently undone, and that window is exactly the disable bug. The whole-blob compare closes it. Its cost is a retry when an unrelated field changed, which is fine here because none of these writes has a deadline and every lost attempt means another write landed.

So the cron fix is not just `SetCronEnabled` and `UpdateCronNextRun`: `AcquireCronLock`, `ReleaseCronLock` and `UpdateCronLastRun` move onto the same helper, since they rewrite the same blob on every fire. `UpdateCronEntry` stays a whole-row write by definition (the scheduler stops calling it in its own task). The older `ReplayDLQ` moves onto the helper too, so it can never overwrite a claim's `replayed_job_id` with a copy read before the claim.

**The per-job DLQ index, and rows written before it.** `dlq_by_job:<jobID>` is a Set of entry IDs, written by `PushDLQ` and removed by `DeleteDLQ` and `PurgeDLQ` in the same script or MULTI as the entity, the ID set and the created-order index. Rows from the release before this one have no such set, so `GetDLQByJobID` self-heals the way slice 1's created index does, instead of scanning on a miss. A second Set, `dlq_job_indexed`, holds every entry ID that is in its job's set. Each lookup first compares `SCARD dlq_ids` with `SCARD dlq_job_indexed` in one MULTI (two O(1) counts); only when the ID set is ahead does it read `SDIFF`, look up each missing entry's job and add it. A plain fallback scan would cost O(n) on every miss forever (a miss being any retry of a failed job that has no dead letter), because an absent per-job key cannot tell "legacy" from "none". The count check also catches rows a process still on the old release writes during a rolling upgrade. Both new keys are pinned in `keys_internal_test.go`.

**Run fields.** `runEntity` gains `ParentRunID` and `Version`. Both were dropped by every write, so on Redis `ListChildRuns` (a scan over `ListRuns` that filters on `ParentRunID`) never found a child, and every run read back as version 0, which the runner treats as "latest" when it resumes or replays. The workflow suite compares store reads with store reads and cannot see a dropped `Version`, so `TestRunVersionAndParentRoundTrip` checks both against what was written. Note for the other backends: on 2026-10-07 the postgres and sqlite run models had neither field (and no `parent_run_id` column, although their `ListChildRuns` queries one), and mongo drops `Version`.

**Files:**
- Create: `store/redis/cas.go`, `store/redis/operator.go`
- Modify: `store/redis/keys.go` (after `dlqIDs`)
- Modify: `store/redis/dlq.go` (imports, `dlqEntity`, `toDLQEntity`, `fromDLQEntity`, `PushDLQ`, `ReplayDLQ`, the MULTI inside `PurgeDLQ`)
- Modify: `store/redis/cron.go` (imports; `AcquireCronLock`, `ReleaseCronLock`, `UpdateCronLastRun`, plus the two new methods after them)
- Modify: `store/redis/workflow.go` (`runEntity`, `toRunEntity`, `fromRunEntity`)
- Test: `store/redis/keys_internal_test.go` (append), `store/redis/operator_test.go` (create, `//go:build integration`)

**Interfaces:**
- Consumes (Task 1): `dlq.ReplayClaimer`, `cron.TargetedUpdater`, `workflow.Reopener`, `dlq.Entry.ReplayedJobID`, `dispatch.ErrDLQAlreadyExists`, `dispatch.ErrDLQAlreadyReplayed`, `storetest.RunDLQReplaySuite`, `storetest.RunCronSuite`, `storetest.RunWorkflowSuite`. From the existing redis tests: `startRedis`, `openRedisStore` (`store/redis/reap_test.go`), `setupTestKV` (`store/redis/store_test.go`).
- Produces, on `*redis.Store`:

```go
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error)
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error
```

Behaviour changes on existing methods: `PushDLQ` returns `dispatch.ErrDLQAlreadyExists` for an existing ID (it used to overwrite); `AcquireCronLock` gives exactly one of several racing workers `true` (it used to give all of them `true`); `ReleaseCronLock` and `UpdateCronLastRun` no longer clobber concurrent writes; `GetRun` returns `Version` and `ParentRunID`.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- store/redis && git log --oneline -3`
Expected: no lines from `git status`, and the log shows Task 1's commit (`feat(store): add the replay claim, targeted cron writes and run reopen, with a memory reference`) in the history. If another session has uncommitted edits under `store/redis`, stop and report.

- [ ] **Step 2: Pin the two new keys**

Append to the end of `store/redis/keys_internal_test.go` (after the closing brace of `TestKeys_createdIndexes`):

```go
// The per-job DLQ index is pinned for the same reason as the created
// indexes: a rename would orphan every set already built and make every
// lookup rebuild them.
func TestKeys_dlqJobIndex(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want string
	}{
		{"dlqByJob", newKeys("ws_acme:").dlqByJob("job_1"), "ws_acme:dispatch:dlq_by_job:job_1"},
		{"dlqJobIndexed", newKeys("ws_acme:").dlqJobIndexed(), "ws_acme:dispatch:dlq_job_indexed"},
		{"unprefixed dlqByJob", newKeys("").dlqByJob("job_1"), "dispatch:dlq_by_job:job_1"},
		{"unprefixed dlqJobIndexed", newKeys("").dlqJobIndexed(), "dispatch:dlq_job_indexed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.want {
				t.Errorf("%s = %q, want %q", tt.name, tt.got, tt.want)
			}
		})
	}
}
```

Run: `go test -count=1 -run TestKeys_dlqJobIndex ./store/redis/`
Expected:

```
# github.com/xraph/dispatch/store/redis [github.com/xraph/dispatch/store/redis.test]
store/redis/keys_internal_test.go:61:36: newKeys("ws_acme:").dlqByJob undefined (type keys has no field or method dlqByJob)
store/redis/keys_internal_test.go:62:41: newKeys("ws_acme:").dlqJobIndexed undefined (type keys has no field or method dlqJobIndexed)
store/redis/keys_internal_test.go:63:39: newKeys("").dlqByJob undefined (type keys has no field or method dlqByJob)
store/redis/keys_internal_test.go:64:44: newKeys("").dlqJobIndexed undefined (type keys has no field or method dlqJobIndexed)
FAIL	github.com/xraph/dispatch/store/redis [build failed]
FAIL
```

In `store/redis/keys.go`, replace:

```go
// dlqIDs is the Set tracking all DLQ entry IDs for enumeration.
func (k keys) dlqIDs() string { return k.full("dlq_ids") }
```

with:

```go
// dlqIDs is the Set tracking all DLQ entry IDs for enumeration.
func (k keys) dlqIDs() string { return k.full("dlq_ids") }

// dlqByJob is the Set of DLQ entry IDs recorded for one failed job, so
// GetDLQByJobID reads a handful of members instead of every entry.
func (k keys) dlqByJob(jobID string) string { return k.full("dlq_by_job:" + jobID) }

// dlqJobIndexed is the Set of DLQ entry IDs that are already in their
// job's dlqByJob set. It mirrors dlqIDs member for member once every row
// is indexed, so comparing the two counts tells GetDLQByJobID whether a
// row written before the per-job index exists still needs adding.
func (k keys) dlqJobIndexed() string { return k.full("dlq_job_indexed") }
```

Run: `go test -count=1 -run TestKeys_dlqJobIndex -v ./store/redis/ 2>&1 | grep -E -- '--- |^ok'`
Expected:

```
--- PASS: TestKeys_dlqJobIndex (0.00s)
    --- PASS: TestKeys_dlqJobIndex/dlqByJob (0.00s)
    --- PASS: TestKeys_dlqJobIndex/dlqJobIndexed (0.00s)
    --- PASS: TestKeys_dlqJobIndex/unprefixed_dlqByJob (0.00s)
    --- PASS: TestKeys_dlqJobIndex/unprefixed_dlqJobIndexed (0.00s)
ok  	github.com/xraph/dispatch/store/redis	0.4s
```

- [ ] **Step 3: Write the Redis operator tests**

The three shared suites go on one container each, like `TestListConformance` and `TestDLQConformance`. The five Redis-only tests cover what the suites cannot reach: the cron disable racing a scheduler loop (the suite's `DisableSurvivesAFire` takes turns), the cron lock under a race, large int64 fields surviving a claim, the per-job index backfill, and `Version` and `ParentRunID` compared with what was written.

Create `store/redis/operator_test.go`:

```go
//go:build integration

package redis_test

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	redisstore "github.com/xraph/dispatch/store/redis"
	"github.com/xraph/dispatch/store/storetest"
	"github.com/xraph/dispatch/workflow"
)

// The three operator suites share one container each, like the list and
// lease suites: every case isolates itself by its own queue, entry or
// run, so one store per case on the same Redis is what they expect.

func TestDLQReplayConformance(t *testing.T) {
	connStr := startRedis(t)

	storetest.RunDLQReplaySuite(t, func(t *testing.T) storetest.DLQReplayStore {
		t.Helper()

		return openRedisStore(t, connStr)
	})
}

func TestCronConformance(t *testing.T) {
	connStr := startRedis(t)

	storetest.RunCronSuite(t, func(t *testing.T) storetest.CronStore {
		t.Helper()

		return openRedisStore(t, connStr)
	})
}

func TestWorkflowConformance(t *testing.T) {
	connStr := startRedis(t)

	storetest.RunWorkflowSuite(t, func(t *testing.T) storetest.WorkflowStore {
		t.Helper()

		return openRedisStore(t, connStr)
	})
}

// operatorCron registers an enabled cron entry with a unique name.
func operatorCron(t *testing.T, s *redisstore.Store) *cron.Entry {
	t.Helper()

	next := time.Now().UTC().Add(time.Minute)
	cronID := id.NewCronID()
	e := &cron.Entry{
		Entity:    dispatch.NewEntity(),
		ID:        cronID,
		Name:      "redis-operator-" + cronID.String(),
		Schedule:  "* * * * *",
		JobName:   "redis-operator-job",
		Queue:     "redis-operator",
		Enabled:   true,
		NextRunAt: &next,
	}
	if err := s.RegisterCron(context.Background(), e); err != nil {
		t.Fatalf("RegisterCron: %v", err)
	}

	return e
}

// TestCronDisableSurvivesConcurrentFires is the race the conformance
// suite's DisableSurvivesAFire case cannot reach, because there the two
// writes take turns. Here a scheduler loop keeps acquiring the lock,
// recording a fire and the next run, and releasing, while an operator
// disables the entry in the middle of it. Every one of those scheduler
// writes rewrites the whole JSON blob, so if any of them is a plain read
// then SET, one that read the entry before the disable puts enabled back.
func TestCronDisableSurvivesConcurrentFires(t *testing.T) {
	s := openRedisStore(t, startRedis(t))
	ctx := context.Background()

	const rounds = 20
	for round := range rounds {
		entry := operatorCron(t, s)
		worker := id.NewWorkerID()

		var (
			stop  atomic.Bool
			fires atomic.Int64
			wg    sync.WaitGroup
			errMu sync.Mutex
			errs  []error
		)
		record := func(err error) {
			errMu.Lock()
			defer errMu.Unlock()
			errs = append(errs, err)
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			for !stop.Load() {
				if _, err := s.AcquireCronLock(ctx, entry.ID, worker, time.Minute); err != nil {
					record(err)
					return
				}
				at := time.Now().UTC()
				if err := s.UpdateCronLastRun(ctx, entry.ID, at); err != nil {
					record(err)
					return
				}
				if err := s.UpdateCronNextRun(ctx, entry.ID, at.Add(time.Minute)); err != nil {
					record(err)
					return
				}
				if err := s.ReleaseCronLock(ctx, entry.ID, worker); err != nil {
					record(err)
					return
				}
				fires.Add(1)
			}
		}()

		// Let the loop get going, disable in the middle of it, and let it
		// run on for a while after.
		for fires.Load() < 5 {
			runtime.Gosched()
		}
		if err := s.SetCronEnabled(ctx, entry.ID, false, nil); err != nil {
			t.Fatalf("round %d: SetCronEnabled(false): %v", round, err)
		}
		afterDisable := fires.Load()
		for fires.Load() < afterDisable+5 {
			runtime.Gosched()
		}
		stop.Store(true)
		wg.Wait()

		if len(errs) > 0 {
			t.Fatalf("round %d: scheduler loop: %v", round, errs)
		}

		got, err := s.GetCron(ctx, entry.ID)
		if err != nil {
			t.Fatalf("round %d: GetCron: %v", round, err)
		}
		if got.Enabled {
			t.Fatalf("round %d: the cron came back enabled after %d fires raced its disable", round, fires.Load())
		}
		if got.LastRunAt == nil {
			t.Fatalf("round %d: LastRunAt = nil, want the scheduler's fires recorded", round)
		}
	}
}

// TestAcquireCronLockExactlyOneHolder races workers for the lock on a
// fresh entry. The lock lives inside the cron JSON blob, so a lock taken
// as a read then a SET lets every worker that read the unlocked entry
// believe it holds the lock, and each of them fires the cron.
func TestAcquireCronLockExactlyOneHolder(t *testing.T) {
	s := openRedisStore(t, startRedis(t))
	ctx := context.Background()

	const workers = 16
	for round := range 10 {
		entry := operatorCron(t, s)

		var (
			wg    sync.WaitGroup
			ready atomic.Int64
			held  atomic.Int64
			errMu sync.Mutex
			errs  []error
		)
		for range workers {
			wg.Add(1)
			go func() {
				defer wg.Done()

				ready.Add(1)
				for ready.Load() < workers {
					runtime.Gosched()
				}

				ok, err := s.AcquireCronLock(ctx, entry.ID, id.NewWorkerID(), time.Minute)
				if err != nil {
					errMu.Lock()
					errs = append(errs, err)
					errMu.Unlock()
					return
				}
				if ok {
					held.Add(1)
				}
			}()
		}
		wg.Wait()

		if len(errs) > 0 {
			t.Fatalf("round %d: AcquireCronLock: %v", round, errs)
		}
		if n := held.Load(); n != 1 {
			t.Fatalf("round %d: %d of %d workers acquired the lock, want exactly 1", round, n, workers)
		}
	}
}

// TestClaimReplayKeepsLargeDurations guards the reason the claim builds
// its blob in Go. cjson turns an int64 past 2^53 into scientific
// notation on encode, which encoding/json then refuses to read, so a
// claim written by a Lua script that re-encodes the entry would make a
// dead letter with a 200 day timeout unreadable.
func TestClaimReplayKeepsLargeDurations(t *testing.T) {
	s := openRedisStore(t, startRedis(t))
	ctx := context.Background()

	const bigDuration = 200 * 24 * time.Hour
	now := time.Now().UTC()
	e := &dlq.Entry{
		ID:         id.NewDLQID(),
		JobID:      id.NewJobID(),
		JobName:    "large-duration",
		Queue:      "redis-operator",
		Payload:    []byte(`{}`),
		Error:      "boom",
		FailedAt:   now,
		CreatedAt:  now,
		Timeout:    bigDuration,
		LeaseTTL:   bigDuration,
		InputBytes: 1 << 60,
	}
	if err := s.PushDLQ(ctx, e); err != nil {
		t.Fatalf("PushDLQ: %v", err)
	}

	newJob := id.NewJobID()
	if err := s.ClaimReplay(ctx, e.ID, newJob); err != nil {
		t.Fatalf("ClaimReplay: %v", err)
	}

	got, err := s.GetDLQ(ctx, e.ID)
	if err != nil {
		t.Fatalf("GetDLQ after claim: %v", err)
	}
	if got.Timeout != bigDuration || got.LeaseTTL != bigDuration || got.InputBytes != 1<<60 {
		t.Fatalf("after claim: timeout %v, lease ttl %v, input bytes %d; want %v, %v, %d",
			got.Timeout, got.LeaseTTL, got.InputBytes, bigDuration, bigDuration, int64(1<<60))
	}
	if got.ReplayedJobID == nil || *got.ReplayedJobID != newJob {
		t.Fatalf("ReplayedJobID = %v, want %s", got.ReplayedJobID, newJob)
	}
}

// A Redis written by the release before this one has dead letters but no
// per-job index. GetDLQByJobID must find them anyway, and must build the
// index as it goes so the next lookup does not scan again.
func TestGetDLQByJobID_backfillsIndexForPreexistingRows(t *testing.T) {
	ctx := context.Background()
	kvStore := setupTestKV(t)
	s := redisstore.New(kvStore)

	jobID := id.NewJobID()
	now := time.Now().UTC()
	older := &dlq.Entry{ID: id.NewDLQID(), JobID: jobID, JobName: "legacy", Queue: "legacy", FailedAt: now, CreatedAt: now}
	newer := &dlq.Entry{ID: id.NewDLQID(), JobID: jobID, JobName: "legacy", Queue: "legacy", FailedAt: now, CreatedAt: now}
	for _, e := range []*dlq.Entry{older, newer} {
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("PushDLQ: %v", err)
		}
	}

	// What the previous release left behind: no per-job sets at all.
	for _, key := range []string{"dispatch:dlq_by_job:" + jobID.String(), "dispatch:dlq_job_indexed"} {
		if err := kvStore.Delete(ctx, key); err != nil {
			t.Fatalf("delete %s: %v", key, err)
		}
	}

	got, err := s.GetDLQByJobID(ctx, jobID)
	if err != nil {
		t.Fatalf("GetDLQByJobID on a pre-index Redis: %v", err)
	}
	if got.ID != newer.ID {
		t.Fatalf("GetDLQByJobID = %s, want the newer entry %s", got.ID, newer.ID)
	}

	members, err := kvStore.SMembers(ctx, "dispatch:dlq_by_job:"+jobID.String())
	if err != nil {
		t.Fatalf("SMembers per-job index: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("per-job index after the lookup holds %v, want both entries", members)
	}
}

// Redis used to drop a run's version along with its parent. The runner
// resumes a run on run.Version and replay-from-step checks it, so a
// dropped version silently moves a run onto the latest definition. The
// workflow suite reads the version back from the store on both sides of
// a reopen, so it cannot tell a dropped version from a kept one; this
// compares with what was written, after the create and after a reopen.
func TestRunVersionAndParentRoundTrip(t *testing.T) {
	s := openRedisStore(t, startRedis(t))
	ctx := context.Background()

	parentID := id.NewRunID()
	r := &workflow.Run{
		Entity:      dispatch.NewEntity(),
		ID:          id.NewRunID(),
		Name:        "versioned",
		State:       workflow.RunStateFailed,
		StartedAt:   time.Now().UTC(),
		Version:     3,
		ParentRunID: &parentID,
	}
	if err := s.CreateRun(ctx, r); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	check := func(label string) {
		t.Helper()

		got, err := s.GetRun(ctx, r.ID)
		if err != nil {
			t.Fatalf("%s: GetRun: %v", label, err)
		}
		if got.Version != 3 {
			t.Errorf("%s: Version = %d, want 3", label, got.Version)
		}
		if got.ParentRunID == nil || *got.ParentRunID != parentID {
			t.Errorf("%s: ParentRunID = %v, want %s", label, got.ParentRunID, parentID)
		}
	}

	check("after CreateRun")

	if err := s.ReopenRun(ctx, r.ID); err != nil {
		t.Fatalf("ReopenRun: %v", err)
	}
	check("after ReopenRun")

	if !errors.Is(s.ReopenRun(ctx, r.ID), dispatch.ErrInvalidState) {
		t.Fatal("a second ReopenRun on the now running run did not wrap ErrInvalidState")
	}
}
```

Run: `go test -count=1 -tags integration ./store/redis/`
Expected:

```
# github.com/xraph/dispatch/store/redis_test [github.com/xraph/dispatch/store/redis.test]
store/redis/operator_test.go:33:10: cannot use openRedisStore(t, connStr) (value of type *"github.com/xraph/dispatch/store/redis".Store) as storetest.DLQReplayStore value in return statement: *"github.com/xraph/dispatch/store/redis".Store does not implement storetest.DLQReplayStore (missing method ClaimReplay)
store/redis/operator_test.go:43:10: cannot use openRedisStore(t, connStr) (value of type *"github.com/xraph/dispatch/store/redis".Store) as storetest.CronStore value in return statement: *"github.com/xraph/dispatch/store/redis".Store does not implement storetest.CronStore (missing method SetCronEnabled)
store/redis/operator_test.go:53:10: cannot use openRedisStore(t, connStr) (value of type *"github.com/xraph/dispatch/store/redis".Store) as storetest.WorkflowStore value in return statement: *"github.com/xraph/dispatch/store/redis".Store does not implement storetest.WorkflowStore (missing method ReopenRun)
store/redis/operator_test.go:122:17: s.UpdateCronNextRun undefined (type *"github.com/xraph/dispatch/store/redis".Store has no field or method UpdateCronNextRun)
store/redis/operator_test.go:139:15: s.SetCronEnabled undefined (type *"github.com/xraph/dispatch/store/redis".Store has no field or method SetCronEnabled)
store/redis/operator_test.go:247:14: s.ClaimReplay undefined (type *"github.com/xraph/dispatch/store/redis".Store has no field or method ClaimReplay)
store/redis/operator_test.go:289:16: s.GetDLQByJobID undefined (type *"github.com/xraph/dispatch/store/redis".Store has no field or method GetDLQByJobID)
store/redis/operator_test.go:347:14: s.ReopenRun undefined (type *"github.com/xraph/dispatch/store/redis".Store has no field or method ReopenRun)
store/redis/operator_test.go:352:18: s.ReopenRun undefined (type *"github.com/xraph/dispatch/store/redis".Store has no field or method ReopenRun)
FAIL	github.com/xraph/dispatch/store/redis [build failed]
FAIL
```

- [ ] **Step 4: Carry the replayed job ID in the DLQ entity**

Every DLQ read path (`GetDLQ`, `ListDLQ`, `ListDLQPage` through `decodeDLQ`, and `GetDLQByJobID`) goes through `fromDLQEntity`, so these three edits cover them all.

In `store/redis/dlq.go`, inside `type dlqEntity`, replace:

```go
	ReplayedAt *time.Time `json:"replayed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`

	// Carried so Replay
```

with:

```go
	ReplayedAt *time.Time `json:"replayed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`

	// ReplayedJobID is set by ClaimReplay together with ReplayedAt, and
	// empty on an unreplayed entry or one the older ReplayDLQ marked.
	ReplayedJobID string `json:"replayed_job_id,omitempty"`

	// Carried so Replay
```

Replace the whole of `toDLQEntity`:

```go
func toDLQEntity(e *dlq.Entry) *dlqEntity {
	return &dlqEntity{
		ID:         e.ID.String(),
		JobID:      e.JobID.String(),
		JobName:    e.JobName,
		Queue:      e.Queue,
		Payload:    e.Payload,
		Error:      e.Error,
		RetryCount: e.RetryCount,
		MaxRetries: e.MaxRetries,
		ScopeAppID: e.ScopeAppID,
		ScopeOrgID: e.ScopeOrgID,
		FailedAt:   e.FailedAt,
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		Priority:         e.Priority,
		Timeout:          e.Timeout,
		LeaseTTL:         e.LeaseTTL,
		ArtifactBindings: e.ArtifactBindings,
		Resources:        e.Resources,
		ResourceLimits:   e.ResourceLimits,
		ResourceClass:    e.ResourceClass,
		InputBytes:       e.InputBytes,
		PrimaryInputHash: e.PrimaryInputHash,
	}
}
```

with:

```go
func toDLQEntity(e *dlq.Entry) *dlqEntity {
	var replayedJobID string
	if e.ReplayedJobID != nil {
		replayedJobID = e.ReplayedJobID.String()
	}

	return &dlqEntity{
		ID:         e.ID.String(),
		JobID:      e.JobID.String(),
		JobName:    e.JobName,
		Queue:      e.Queue,
		Payload:    e.Payload,
		Error:      e.Error,
		RetryCount: e.RetryCount,
		MaxRetries: e.MaxRetries,
		ScopeAppID: e.ScopeAppID,
		ScopeOrgID: e.ScopeOrgID,
		FailedAt:   e.FailedAt,
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		ReplayedJobID: replayedJobID,

		Priority:         e.Priority,
		Timeout:          e.Timeout,
		LeaseTTL:         e.LeaseTTL,
		ArtifactBindings: e.ArtifactBindings,
		Resources:        e.Resources,
		ResourceLimits:   e.ResourceLimits,
		ResourceClass:    e.ResourceClass,
		InputBytes:       e.InputBytes,
		PrimaryInputHash: e.PrimaryInputHash,
	}
}
```

Replace the whole of `fromDLQEntity`:

```go
func fromDLQEntity(e *dlqEntity) (*dlq.Entry, error) {
	parsedID, err := id.ParseDLQID(e.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/redis: parse dlq id: %w", err)
	}

	parsedJobID, _ := id.ParseJobID(e.JobID) //nolint:errcheck // best-effort

	return &dlq.Entry{
		ID:         parsedID,
		JobID:      parsedJobID,
		JobName:    e.JobName,
		Queue:      e.Queue,
		Payload:    e.Payload,
		Error:      e.Error,
		RetryCount: e.RetryCount,
		MaxRetries: e.MaxRetries,
		ScopeAppID: e.ScopeAppID,
		ScopeOrgID: e.ScopeOrgID,
		FailedAt:   e.FailedAt,
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		Priority:         e.Priority,
		Timeout:          e.Timeout,
		LeaseTTL:         e.LeaseTTL,
		ArtifactBindings: e.ArtifactBindings,
		Resources:        e.Resources,
		ResourceLimits:   e.ResourceLimits,
		ResourceClass:    e.ResourceClass,
		InputBytes:       e.InputBytes,
		PrimaryInputHash: e.PrimaryInputHash,
	}, nil
}
```

with:

```go
func fromDLQEntity(e *dlqEntity) (*dlq.Entry, error) {
	parsedID, err := id.ParseDLQID(e.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/redis: parse dlq id: %w", err)
	}

	parsedJobID, _ := id.ParseJobID(e.JobID) //nolint:errcheck // best-effort

	var replayedJobID *id.JobID
	if e.ReplayedJobID != "" {
		parsed, parseErr := id.ParseJobID(e.ReplayedJobID)
		if parseErr != nil {
			return nil, fmt.Errorf("dispatch/redis: parse dlq replayed job id: %w", parseErr)
		}
		replayedJobID = &parsed
	}

	return &dlq.Entry{
		ID:         parsedID,
		JobID:      parsedJobID,
		JobName:    e.JobName,
		Queue:      e.Queue,
		Payload:    e.Payload,
		Error:      e.Error,
		RetryCount: e.RetryCount,
		MaxRetries: e.MaxRetries,
		ScopeAppID: e.ScopeAppID,
		ScopeOrgID: e.ScopeOrgID,
		FailedAt:   e.FailedAt,
		ReplayedAt: e.ReplayedAt,
		CreatedAt:  e.CreatedAt,

		ReplayedJobID: replayedJobID,

		Priority:         e.Priority,
		Timeout:          e.Timeout,
		LeaseTTL:         e.LeaseTTL,
		ArtifactBindings: e.ArtifactBindings,
		Resources:        e.Resources,
		ResourceLimits:   e.ResourceLimits,
		ResourceClass:    e.ResourceClass,
		InputBytes:       e.InputBytes,
		PrimaryInputHash: e.PrimaryInputHash,
	}, nil
}
```

Run: `go build ./... && echo BUILD-OK`
Expected: `BUILD-OK`

- [ ] **Step 5: Add the compare-and-set helper**

Create `store/redis/cas.go`:

```go
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	goredis "github.com/redis/go-redis/v9"
)

// The conditional writes on JSON entities (the replay claim and its
// release, the cron lock and the cron field writes, the run reopen) all go
// through updateEntity, an optimistic compare-and-set on the whole stored
// blob.
//
// Go does everything except the final check: it reads the raw blob,
// decodes it, decides (the claim is already taken, the run is already
// running), mutates the decoded copy and marshals it with encoding/json.
// casSetScript then writes the new blob only if the key still holds
// exactly the bytes Go read. If anything else wrote the key in between,
// the script refuses and Go starts again from a fresh read, so the
// decision is always made on the value that gets replaced.
//
// Two other shapes were considered and rejected.
//
// Decoding, patching and cjson.encode-ing the entity inside Lua is out for
// the reason lease.go records: cjson renders an integer past 2^53 in
// scientific notation, which encoding/json then cannot read back into an
// int64. dlqEntity carries Timeout, LeaseTTL, InputBytes and resource
// sets, all int64, so a claim would corrupt a long-timeout dead letter.
// TestClaimReplayKeepsLargeDurations pins that.
//
// Checking only the guard field in Lua (replayed_at is null, state is not
// running) before SETting Go's blob is the lease.go shape, and it leaves a
// window: a write to any other field between Go's read and the script is
// silently undone. That window is the bug for cron. AcquireCronLock,
// UpdateCronLastRun, ReleaseCronLock and SetCronEnabled all rewrite the
// same blob, so a scheduler write that read the entry before an operator
// disabled it would put enabled back. Comparing the whole blob closes it:
// no write here can land on a value it did not read.
//
// The cost of comparing the whole blob is a retry when an unrelated field
// changed, and that is cheap here, unlike for lease renewal: none of these
// writes has a deadline, and every retry means some other write landed,
// so the system as a whole always makes progress.

// casSetScript replaces a key's value only if it still holds the value
// the caller read.
//
// KEYS[1] the entity key. ARGV[1] the raw blob the caller read, ARGV[2]
// the blob to write in its place.
// Returns casWritten, casMissing when the key no longer exists, or
// casChanged when it holds something else.
var casSetScript = goredis.NewScript(`
local cur = redis.call('GET', KEYS[1])
if not cur then
  return 0
end
if cur ~= ARGV[1] then
  return 2
end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`)

const (
	casMissing = 0
	casWritten = 1
	casChanged = 2
)

// casAttempts bounds how many times updateEntity re-reads a key that keeps
// changing under it. Each lost attempt means another write landed, so
// running out takes that many writes to one entity inside one call, which
// no caller in this store comes near.
const casAttempts = 64

// errSkipWrite is what a mutate function returns when the entity already
// says what the caller wanted, or the write does not apply to it. The
// update then returns nil without writing.
var errSkipWrite = errors.New("dispatch/redis: nothing to write")

// updateEntity applies mutate to the entity stored at key as one atomic
// compare-and-set, retrying from a fresh read when another write lands
// between the read and the set. notFound is returned when the key does
// not exist, whether before the first read or by the time the set runs.
// Any error from mutate other than errSkipWrite is returned as is, so a
// refusal can be a sentinel the caller passes straight up.
func updateEntity[T any](ctx context.Context, s *Store, key string, notFound error, mutate func(e *T) error) error {
	for range casAttempts {
		raw, err := s.rdb.Get(ctx, key).Bytes()
		if errors.Is(err, goredis.Nil) {
			return notFound
		}
		if err != nil {
			return fmt.Errorf("dispatch/redis: read %s: %w", key, err)
		}

		var e T
		if decodeErr := json.Unmarshal(raw, &e); decodeErr != nil {
			return fmt.Errorf("dispatch/redis: decode %s: %w", key, decodeErr)
		}

		if mutateErr := mutate(&e); mutateErr != nil {
			if errors.Is(mutateErr, errSkipWrite) {
				return nil
			}
			return mutateErr
		}

		next, marshalErr := json.Marshal(&e)
		if marshalErr != nil {
			return fmt.Errorf("dispatch/redis: marshal %s: %w", key, marshalErr)
		}

		res, runErr := casSetScript.Run(ctx, s.rdb, []string{key}, raw, next).Int64()
		if runErr != nil {
			return fmt.Errorf("dispatch/redis: write %s: %w", key, runErr)
		}
		switch res {
		case casWritten:
			return nil
		case casMissing:
			return notFound
		}

		// casChanged: another write landed after the read. Decide again on
		// what is there now, unless the caller has given up.
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
	}

	return fmt.Errorf("dispatch/redis: %s changed under %d consecutive attempts to update it", key, casAttempts)
}
```

- [ ] **Step 6: Move every cron blob write onto the helper**

In `store/redis/cron.go`, replace the import block:

```go
import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
)
```

with:

```go
import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
)
```

Then replace everything from the `// AcquireCronLock attempts to acquire` comment down to, but not including, the `// UpdateCronEntry updates a cron entry.` comment, which today reads:

```go
// AcquireCronLock attempts to acquire a distributed lock for a cron entry.
func (s *Store) AcquireCronLock(ctx context.Context, entryID id.CronID, workerID id.WorkerID, ttl time.Duration) (bool, error) {
	eID := entryID.String()
	key := s.keys.cron(eID)
	wID := workerID.String()
	t := now()
	until := t.Add(ttl)

	// Read current entity.
	var e cronEntity
	if err := s.getEntity(ctx, key, &e); err != nil {
		if isNotFound(err) {
			return false, dispatch.ErrCronNotFound
		}
		return false, fmt.Errorf("dispatch/redis: acquire cron lock get: %w", err)
	}

	// Check current lock state.
	if e.LockedBy != "" && e.LockedBy != wID {
		// Someone else holds the lock -- check if expired.
		if e.LockedUntil != nil && e.LockedUntil.After(t) {
			return false, nil // lock still valid
		}
	}

	// Acquire or re-acquire.
	e.LockedBy = wID
	e.LockedUntil = &until
	e.UpdatedAt = t
	if err := s.setEntity(ctx, key, &e); err != nil {
		return false, fmt.Errorf("dispatch/redis: acquire cron lock set: %w", err)
	}
	return true, nil
}

// ReleaseCronLock releases the distributed lock for a cron entry.
func (s *Store) ReleaseCronLock(ctx context.Context, entryID id.CronID, workerID id.WorkerID) error {
	key := s.keys.cron(entryID.String())
	wID := workerID.String()

	var e cronEntity
	if err := s.getEntity(ctx, key, &e); err != nil {
		if isNotFound(err) {
			return nil // entry gone, no-op
		}
		return fmt.Errorf("dispatch/redis: release cron lock get: %w", err)
	}

	if e.LockedBy != wID {
		return nil // not our lock, no-op
	}

	e.LockedBy = ""
	e.LockedUntil = nil
	e.UpdatedAt = now()
	return s.setEntity(ctx, key, &e)
}

// UpdateCronLastRun records when a cron entry last fired.
func (s *Store) UpdateCronLastRun(ctx context.Context, entryID id.CronID, at time.Time) error {
	key := s.keys.cron(entryID.String())
	var e cronEntity
	if err := s.getEntity(ctx, key, &e); err != nil {
		if isNotFound(err) {
			return dispatch.ErrCronNotFound
		}
		return fmt.Errorf("dispatch/redis: update last run get: %w", err)
	}

	e.LastRunAt = &at
	e.UpdatedAt = now()
	return s.setEntity(ctx, key, &e)
}
```

with:

```go
// The lock, the last and next run, and the enabled flag all live in one
// JSON blob per entry, so every write that changes one of them rewrites
// the whole blob. Each of them goes through updateEntity (cas.go), which
// only writes over the exact value it read. A scheduler write that read
// the entry before an operator disabled it therefore re-reads and keeps
// the disable, instead of putting enabled back; and two workers that both
// read the entry unlocked cannot both take the lock.

// errCronLockHeld is AcquireCronLock's refusal inside updateEntity: the
// lock belongs to another worker and has not expired.
var errCronLockHeld = errors.New("dispatch/redis: cron lock held by another worker")

// AcquireCronLock attempts to acquire a distributed lock for a cron entry.
// Of several workers racing for a free lock, exactly one gets true.
func (s *Store) AcquireCronLock(ctx context.Context, entryID id.CronID, workerID id.WorkerID, ttl time.Duration) (bool, error) {
	wID := workerID.String()

	err := updateEntity(ctx, s, s.keys.cron(entryID.String()), dispatch.ErrCronNotFound,
		func(e *cronEntity) error {
			t := now()
			if e.LockedBy != "" && e.LockedBy != wID && e.LockedUntil != nil && e.LockedUntil.After(t) {
				return errCronLockHeld
			}

			until := t.Add(ttl)
			e.LockedBy = wID
			e.LockedUntil = &until
			e.UpdatedAt = t

			return nil
		})
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, errCronLockHeld):
		return false, nil
	case errors.Is(err, dispatch.ErrCronNotFound):
		return false, err
	default:
		return false, fmt.Errorf("dispatch/redis: acquire cron lock: %w", err)
	}
}

// ReleaseCronLock releases the distributed lock for a cron entry. It is a
// no-op when the entry is gone or the lock is not this worker's.
func (s *Store) ReleaseCronLock(ctx context.Context, entryID id.CronID, workerID id.WorkerID) error {
	wID := workerID.String()

	err := updateEntity(ctx, s, s.keys.cron(entryID.String()), errSkipWrite,
		func(e *cronEntity) error {
			if e.LockedBy != wID {
				return errSkipWrite
			}

			e.LockedBy = ""
			e.LockedUntil = nil
			e.UpdatedAt = now()

			return nil
		})
	if err != nil && !errors.Is(err, errSkipWrite) {
		return fmt.Errorf("dispatch/redis: release cron lock: %w", err)
	}

	return nil
}

// UpdateCronLastRun records when a cron entry last fired, and nothing else.
func (s *Store) UpdateCronLastRun(ctx context.Context, entryID id.CronID, at time.Time) error {
	return updateEntity(ctx, s, s.keys.cron(entryID.String()), dispatch.ErrCronNotFound,
		func(e *cronEntity) error {
			e.LastRunAt = &at
			e.UpdatedAt = now()

			return nil
		})
}

// SetCronEnabled sets enabled, sets next_run_at when nextRunAt is non-nil,
// and stamps updated_at. Every other field keeps whatever the entry holds
// at the moment of the write.
func (s *Store) SetCronEnabled(ctx context.Context, entryID id.CronID, enabled bool, nextRunAt *time.Time) error {
	return updateEntity(ctx, s, s.keys.cron(entryID.String()), dispatch.ErrCronNotFound,
		func(e *cronEntity) error {
			e.Enabled = enabled
			if nextRunAt != nil {
				next := *nextRunAt
				e.NextRunAt = &next
			}
			e.UpdatedAt = now()

			return nil
		})
}

// UpdateCronNextRun sets next_run_at and stamps updated_at, and never
// touches enabled.
func (s *Store) UpdateCronNextRun(ctx context.Context, entryID id.CronID, nextRunAt time.Time) error {
	return updateEntity(ctx, s, s.keys.cron(entryID.String()), dispatch.ErrCronNotFound,
		func(e *cronEntity) error {
			e.NextRunAt = &nextRunAt
			e.UpdatedAt = now()

			return nil
		})
}
```

Run: `go build ./... && echo BUILD-OK`
Expected: `BUILD-OK`

- [ ] **Step 7: Implement the claim, the per-job lookup, the delete and the reopen**

Create `store/redis/operator.go`:

```go
package redis

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

var (
	_ dlq.ReplayClaimer    = (*Store)(nil)
	_ cron.TargetedUpdater = (*Store)(nil)
	_ workflow.Reopener    = (*Store)(nil)
)

// ClaimReplay marks an unreplayed entry replayed by jobID. The decision
// and the write are one compare-and-set (updateEntity), so of two
// concurrent claims exactly one wins and the other re-reads the entry,
// finds it claimed, and gets dispatch.ErrDLQAlreadyReplayed.
func (s *Store) ClaimReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	return updateEntity(ctx, s, s.keys.dlq(entryID.String()), dispatch.ErrDLQNotFound,
		func(e *dlqEntity) error {
			if e.ReplayedAt != nil {
				return dispatch.ErrDLQAlreadyReplayed
			}

			t := now()
			e.ReplayedAt = &t
			e.ReplayedJobID = jobID.String()

			return nil
		})
}

// ReleaseReplay undoes a claim, but only the one jobID made. On any other
// entry it writes nothing and returns nil.
func (s *Store) ReleaseReplay(ctx context.Context, entryID id.DLQID, jobID id.JobID) error {
	return updateEntity(ctx, s, s.keys.dlq(entryID.String()), dispatch.ErrDLQNotFound,
		func(e *dlqEntity) error {
			if e.ReplayedJobID != jobID.String() {
				return errSkipWrite
			}

			e.ReplayedAt = nil
			e.ReplayedJobID = ""

			return nil
		})
}

// GetDLQByJobID returns the newest entry, by ID, for a failed job. It
// reads the job's dlqByJob set, so it costs a few round trips however
// large the dead letter queue is, once ensureDLQJobIndex has nothing left
// to add.
func (s *Store) GetDLQByJobID(ctx context.Context, jobID id.JobID) (*dlq.Entry, error) {
	if err := s.ensureDLQJobIndex(ctx); err != nil {
		return nil, err
	}

	members, err := s.rdb.SMembers(ctx, s.keys.dlqByJob(jobID.String())).Result()
	if err != nil {
		return nil, fmt.Errorf("dispatch/redis: read dlq entries of job %s: %w", jobID, err)
	}

	// Entry IDs of one prefix sort by creation as strings, the order
	// ListDLQPage uses. Newest first.
	slices.SortFunc(members, func(a, b string) int { return strings.Compare(b, a) })

	for _, m := range members {
		var e dlqEntity
		if getErr := s.getEntity(ctx, s.keys.dlq(m), &e); getErr != nil {
			if isNotFound(getErr) {
				// A member whose entry is gone: a delete raced a backfill.
				// The next newest is the answer.
				continue
			}
			return nil, fmt.Errorf("dispatch/redis: get dlq %s: %w", m, getErr)
		}

		return fromDLQEntity(&e)
	}

	return nil, dispatch.ErrDLQNotFound
}

// ensureDLQJobIndex puts every DLQ entry that is not yet in its job's
// dlqByJob set into it. A Redis written by the release before the per-job
// index, or by a process still on that release during a rolling upgrade,
// holds entries that only dlqIDs knows about; without this, GetDLQByJobID
// would report them not found and a retry would skip their replay claim.
//
// It follows ensureBackfilled (listindex.go): both counts are read in one
// MULTI, and when dlqIDs holds no more members than dlqJobIndexed there is
// nothing to do, which is every call once all rows are indexed. Otherwise
// it reads the difference, looks up each entry's job, and adds the entry
// to its job's set and to dlqJobIndexed in one MULTI per entry. An entry
// whose blob is gone is marked indexed anyway, since it has no job to be
// found under, so it does not make every later call look again.
//
// The leftovers are the same kind ensureBackfilled describes. A delete
// that lands between this read and its write leaves a dlqByJob member
// with no entry, which GetDLQByJobID skips, and a dlqJobIndexed member
// with no dlqIDs member. During a rolling upgrade, each such extra member
// can hide one entry an old process pushes, until the counts next differ.
func (s *Store) ensureDLQJobIndex(ctx context.Context) error {
	idsKey, indexedKey := s.keys.dlqIDs(), s.keys.dlqJobIndexed()

	pipe := s.rdb.TxPipeline()
	setCount := pipe.SCard(ctx, idsKey)
	indexedCount := pipe.SCard(ctx, indexedKey)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("dispatch/redis: count dlq ids and job index: %w", err)
	}
	if setCount.Val() <= indexedCount.Val() {
		return nil
	}

	missing, err := s.rdb.SDiff(ctx, idsKey, indexedKey).Result()
	if err != nil {
		return fmt.Errorf("dispatch/redis: read unindexed dlq ids: %w", err)
	}

	for _, m := range missing {
		var e dlqEntity
		getErr := s.getEntity(ctx, s.keys.dlq(m), &e)
		if getErr != nil && !isNotFound(getErr) {
			return fmt.Errorf("dispatch/redis: backfill dlq job index get %s: %w", m, getErr)
		}

		add := s.rdb.TxPipeline()
		if getErr == nil {
			add.SAdd(ctx, s.keys.dlqByJob(e.JobID), m)
		}
		add.SAdd(ctx, indexedKey, m)
		if _, execErr := add.Exec(ctx); execErr != nil {
			return fmt.Errorf("dispatch/redis: backfill dlq job index %s: %w", m, execErr)
		}
	}

	return nil
}

// DeleteDLQ hard-deletes one entry together with every index that points
// at it, in one MULTI. The entry is read first only to learn its job;
// whether this call deleted it is decided by the DEL inside the MULTI, so
// of two concurrent deletes exactly one returns nil.
func (s *Store) DeleteDLQ(ctx context.Context, entryID id.DLQID) error {
	eID := entryID.String()
	key := s.keys.dlq(eID)

	var e dlqEntity
	if err := s.getEntity(ctx, key, &e); err != nil {
		if isNotFound(err) {
			return dispatch.ErrDLQNotFound
		}
		return fmt.Errorf("dispatch/redis: delete dlq get: %w", err)
	}

	pipe := s.rdb.TxPipeline()
	deleted := pipe.Del(ctx, key)
	pipe.SRem(ctx, s.keys.dlqIDs(), eID)
	pipe.ZRem(ctx, s.keys.byCreated(entityDLQ), eID)
	pipe.SRem(ctx, s.keys.dlqByJob(e.JobID), eID)
	pipe.SRem(ctx, s.keys.dlqJobIndexed(), eID)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("dispatch/redis: delete dlq: %w", err)
	}
	if deleted.Val() == 0 {
		return dispatch.ErrDLQNotFound
	}

	return nil
}

// ReopenRun moves a finished run back to running. The decision and the
// write are one compare-and-set (updateEntity), so of two concurrent
// reopens exactly one wins and the other re-reads the run, finds it
// running, and is refused.
func (s *Store) ReopenRun(ctx context.Context, runID id.RunID) error {
	return updateEntity(ctx, s, s.keys.run(runID.String()), dispatch.ErrRunNotFound,
		func(e *runEntity) error {
			if workflow.RunState(e.State) == workflow.RunStateRunning {
				return fmt.Errorf("%w: run %s is %s", dispatch.ErrInvalidState, runID, e.State)
			}

			e.State = string(workflow.RunStateRunning)
			e.Error = ""
			e.CompletedAt = nil
			e.UpdatedAt = now()

			return nil
		})
}
```

Run: `go test -count=1 -race -tags integration -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestCronDisableSurvivesConcurrentFires|TestAcquireCronLockExactlyOneHolder|TestClaimReplayKeepsLargeDurations|TestGetDLQByJobID_backfillsIndexForPreexistingRows|TestRunVersionAndParentRoundTrip' ./store/redis/ 2>&1 | grep -E -- '--- FAIL|_test.go:[0-9]+|[a-z]+\.go:[0-9]+:|^ok|^FAIL'`
Expected: three failures, because `PushDLQ` still overwrites and `runEntity` still drops the run fields (run IDs and timings differ per run). Everything else, including both cron race tests, the claim races and the per-job lookups (the backfill finds entries the old `PushDLQ` did not index), passes:

```
--- FAIL: TestDLQReplayConformance (2.74s)
    --- FAIL: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.04s)
        dlq_replay.go:440: PushDLQ(duplicate ID) error = <nil>, want ErrDLQAlreadyExists
--- FAIL: TestWorkflowConformance (1.40s)
    --- FAIL: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.01s)
        workflow.go:223: child ParentRunID = nil, want wfrun_01m4c37s50e67ata0xb3v9x9as: the parent link was not stored
--- FAIL: TestRunVersionAndParentRoundTrip (1.55s)
    operator_test.go:345: after CreateRun: Version = 0, want 3
    operator_test.go:345: after CreateRun: ParentRunID = <nil>, want wfrun_01m4c37ypre00rg305c148t4kg
    operator_test.go:350: after ReopenRun: Version = 0, want 3
    operator_test.go:350: after ReopenRun: ParentRunID = <nil>, want wfrun_01m4c37ypre00rg305c148t4kg
FAIL
FAIL	github.com/xraph/dispatch/store/redis	12.633s
FAIL
```

- [ ] **Step 8: Refuse a duplicate push and keep every DLQ index in step**

In `store/redis/dlq.go`, replace the import block:

```go
import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/resource"
)
```

with:

```go
import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/resource"
)
```

Replace `PushDLQ` and its comment:

```go
// PushDLQ adds a failed job entry to the dead letter queue.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	eID := entry.ID.String()
	key := s.keys.dlq(eID)

	// Index before the entity; indexCreated says why the order matters.
	if err := s.indexCreated(ctx, entityDLQ, entry.ID); err != nil {
		return fmt.Errorf("dispatch/redis: push dlq created index: %w", err)
	}

	e := toDLQEntity(entry)
	if err := s.setEntity(ctx, key, e); err != nil {
		return fmt.Errorf("dispatch/redis: push dlq set: %w", err)
	}

	if err := s.rdb.SAdd(ctx, s.keys.dlqIDs(), eID).Err(); err != nil {
		return fmt.Errorf("dispatch/redis: push dlq index: %w", err)
	}
	return nil
}
```

with:

```go
// pushDLQScript writes a new DLQ entry and every index that points at it,
// or nothing at all when the entry ID is already taken.
//
// KEYS[1] the entry key, KEYS[2] dlqIDs, KEYS[3] the DLQ created-order
// index, KEYS[4] the job's dlqByJob set, KEYS[5] dlqJobIndexed.
// ARGV[1] the entry blob, ARGV[2] the entry ID, ARGV[3] its created score.
// Returns 1 when written, 0 when the entry already existed.
var pushDLQScript = goredis.NewScript(`
if not redis.call('SET', KEYS[1], ARGV[1], 'NX') then
  return 0
end
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[2])
redis.call('SADD', KEYS[4], ARGV[2])
redis.call('SADD', KEYS[5], ARGV[2])
return 1
`)

// PushDLQ adds a failed job entry to the dead letter queue. An ID that is
// already there is refused with dispatch.ErrDLQAlreadyExists rather than
// overwritten, which would silently drop a replay claim. The SET NX and
// the index writes run in one script, so a refused push leaves no index
// member behind and an accepted one is never visible half-indexed.
func (s *Store) PushDLQ(ctx context.Context, entry *dlq.Entry) error {
	eID := entry.ID.String()

	blob, err := json.Marshal(toDLQEntity(entry))
	if err != nil {
		return fmt.Errorf("dispatch/redis: push dlq marshal: %w", err)
	}

	res, err := pushDLQScript.Run(ctx, s.rdb,
		[]string{
			s.keys.dlq(eID),
			s.keys.dlqIDs(),
			s.keys.byCreated(entityDLQ),
			s.keys.dlqByJob(entry.JobID.String()),
			s.keys.dlqJobIndexed(),
		},
		blob,
		eID,
		strconv.FormatFloat(createdScore(entry.ID), 'f', -1, 64),
	).Int64()
	if err != nil {
		return fmt.Errorf("dispatch/redis: push dlq: %w", err)
	}
	if res == 0 {
		return dispatch.ErrDLQAlreadyExists
	}

	return nil
}
```

Replace `ReplayDLQ` and its comment:

```go
// ReplayDLQ marks a DLQ entry as replayed.
func (s *Store) ReplayDLQ(ctx context.Context, entryID id.DLQID) error {
	key := s.keys.dlq(entryID.String())
	var e dlqEntity
	if err := s.getEntity(ctx, key, &e); err != nil {
		if isNotFound(err) {
			return dispatch.ErrDLQNotFound
		}
		return fmt.Errorf("dispatch/redis: replay dlq get: %w", err)
	}

	t := now()
	e.ReplayedAt = &t
	return s.setEntity(ctx, key, &e)
}
```

with:

```go
// ReplayDLQ marks a DLQ entry as replayed. It goes through the same
// compare-and-set as ClaimReplay, so it can never overwrite a claim's
// replayed_job_id with a copy of the entry read before the claim.
func (s *Store) ReplayDLQ(ctx context.Context, entryID id.DLQID) error {
	return updateEntity(ctx, s, s.keys.dlq(entryID.String()), dispatch.ErrDLQNotFound,
		func(e *dlqEntity) error {
			t := now()
			e.ReplayedAt = &t

			return nil
		})
}
```

Inside `PurgeDLQ`, replace:

```go
			pipe.ZRem(ctx, s.keys.byCreated(entityDLQ), eID)
			if _, pErr := pipe.Exec(ctx); pErr != nil {
```

with:

```go
			pipe.ZRem(ctx, s.keys.byCreated(entityDLQ), eID)
			pipe.SRem(ctx, s.keys.dlqByJob(e.JobID), eID)
			pipe.SRem(ctx, s.keys.dlqJobIndexed(), eID)
			if _, pErr := pipe.Exec(ctx); pErr != nil {
```

`PushDLQ` no longer calls `indexCreated`; the created-order member now goes in with the entity inside the script. `indexCreated` stays, since `CreateRun` and the artifact paths still use it.

Run the same command as Step 7.
Expected: only the run-field failures remain:

```
--- FAIL: TestWorkflowConformance (0.82s)
    --- FAIL: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.01s)
        workflow.go:223: child ParentRunID = nil, want wfrun_01m4c387rte9gawbr15js2er1e: the parent link was not stored
--- FAIL: TestRunVersionAndParentRoundTrip (2.30s)
    operator_test.go:345: after CreateRun: Version = 0, want 3
    operator_test.go:345: after CreateRun: ParentRunID = <nil>, want wfrun_01m4c38fkqe158xvnw4cksmxy7
    operator_test.go:350: after ReopenRun: Version = 0, want 3
    operator_test.go:350: after ReopenRun: ParentRunID = <nil>, want wfrun_01m4c38fkqe158xvnw4cksmxy7
FAIL
FAIL	github.com/xraph/dispatch/store/redis	13.778s
FAIL
```

- [ ] **Step 9: Persist the run's parent and version**

In `store/redis/workflow.go`, replace everything from `type runEntity struct` down to, but not including, `type checkpointEntity struct`:

```go
type runEntity struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	State       string     `json:"state"`
	Input       []byte     `json:"input,omitempty"`
	Output      []byte     `json:"output,omitempty"`
	Error       string     `json:"error"`
	ScopeAppID  string     `json:"scope_app_id"`
	ScopeOrgID  string     `json:"scope_org_id"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func toRunEntity(r *workflow.Run) *runEntity {
	return &runEntity{
		ID:          r.ID.String(),
		Name:        r.Name,
		State:       string(r.State),
		Input:       r.Input,
		Output:      r.Output,
		Error:       r.Error,
		ScopeAppID:  r.ScopeAppID,
		ScopeOrgID:  r.ScopeOrgID,
		StartedAt:   r.StartedAt,
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func fromRunEntity(e *runEntity) (*workflow.Run, error) {
	rID, err := id.ParseRunID(e.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/redis: parse run id: %w", err)
	}

	return &workflow.Run{
		Entity: dispatch.Entity{
			CreatedAt: e.CreatedAt,
			UpdatedAt: e.UpdatedAt,
		},
		ID:          rID,
		Name:        e.Name,
		State:       workflow.RunState(e.State),
		Input:       e.Input,
		Output:      e.Output,
		Error:       e.Error,
		ScopeAppID:  e.ScopeAppID,
		ScopeOrgID:  e.ScopeOrgID,
		StartedAt:   e.StartedAt,
		CompletedAt: e.CompletedAt,
	}, nil
}
```

with:

```go
type runEntity struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	State       string     `json:"state"`
	Input       []byte     `json:"input,omitempty"`
	Output      []byte     `json:"output,omitempty"`
	Error       string     `json:"error"`
	ScopeAppID  string     `json:"scope_app_id"`
	ScopeOrgID  string     `json:"scope_org_id"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`

	// Version and ParentRunID were dropped by every write before this
	// release, so a run written then reads back as unversioned (latest)
	// and top-level. Both are omitted when zero, like on workflow.Run.
	Version     int    `json:"version,omitempty"`
	ParentRunID string `json:"parent_run_id,omitempty"`
}

func toRunEntity(r *workflow.Run) *runEntity {
	var parentRunID string
	if r.ParentRunID != nil {
		parentRunID = r.ParentRunID.String()
	}

	return &runEntity{
		ID:          r.ID.String(),
		Name:        r.Name,
		State:       string(r.State),
		Input:       r.Input,
		Output:      r.Output,
		Error:       r.Error,
		ScopeAppID:  r.ScopeAppID,
		ScopeOrgID:  r.ScopeOrgID,
		StartedAt:   r.StartedAt,
		CompletedAt: r.CompletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		Version:     r.Version,
		ParentRunID: parentRunID,
	}
}

func fromRunEntity(e *runEntity) (*workflow.Run, error) {
	rID, err := id.ParseRunID(e.ID)
	if err != nil {
		return nil, fmt.Errorf("dispatch/redis: parse run id: %w", err)
	}

	var parentRunID *id.RunID
	if e.ParentRunID != "" {
		parsed, parseErr := id.ParseRunID(e.ParentRunID)
		if parseErr != nil {
			return nil, fmt.Errorf("dispatch/redis: parse parent run id: %w", parseErr)
		}
		parentRunID = &parsed
	}

	return &workflow.Run{
		Entity: dispatch.Entity{
			CreatedAt: e.CreatedAt,
			UpdatedAt: e.UpdatedAt,
		},
		ID:          rID,
		Name:        e.Name,
		State:       workflow.RunState(e.State),
		Input:       e.Input,
		Output:      e.Output,
		Error:       e.Error,
		ScopeAppID:  e.ScopeAppID,
		ScopeOrgID:  e.ScopeOrgID,
		StartedAt:   e.StartedAt,
		CompletedAt: e.CompletedAt,
		Version:     e.Version,
		ParentRunID: parentRunID,
	}, nil
}
```

`ListChildRuns` needs no change: it scans `ListRuns` and filters on `ParentRunID`, which now reads back.

Run: `go test -count=1 -race -tags integration -v -run 'TestDLQReplayConformance|TestCronConformance|TestWorkflowConformance|TestCronDisableSurvivesConcurrentFires|TestAcquireCronLockExactlyOneHolder|TestClaimReplayKeepsLargeDurations|TestGetDLQByJobID_backfillsIndexForPreexistingRows|TestRunVersionAndParentRoundTrip' ./store/redis/ 2>&1 | grep -E -- '^--- |^    --- |^ok|^FAIL'`
Expected (timings differ):

```
--- PASS: TestDLQReplayConformance (2.44s)
    --- PASS: TestDLQReplayConformance/ClaimReplayFirstWins (0.01s)
    --- PASS: TestDLQReplayConformance/ClaimReplayConcurrentExactlyOneWinner (0.17s)
    --- PASS: TestDLQReplayConformance/ClaimReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/ReplayedJobIDReadsBackFromEveryPath (0.02s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnlyReleasesItsOwnClaim (0.02s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayOnUnclaimedEntryIsNoop (0.01s)
    --- PASS: TestDLQReplayConformance/ReleaseReplayUnknownEntry (0.00s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDReturnsNewestByID (0.01s)
    --- PASS: TestDLQReplayConformance/GetDLQByJobIDUnknownJob (0.01s)
    --- PASS: TestDLQReplayConformance/DeleteDLQRemovesOnlyThatEntry (0.01s)
    --- PASS: TestDLQReplayConformance/PushDLQRefusesDuplicateID (0.01s)
--- PASS: TestCronConformance (1.63s)
    --- PASS: TestCronConformance/SetCronEnabledLeavesOtherFieldsAlone (0.09s)
    --- PASS: TestCronConformance/SetCronEnabledNilNextRunKeepsNextRun (0.03s)
    --- PASS: TestCronConformance/UpdateCronNextRunLeavesOtherFieldsAlone (0.04s)
    --- PASS: TestCronConformance/DisableSurvivesAFire (0.03s)
    --- PASS: TestCronConformance/TargetedWritesUnknownEntry (0.01s)
--- PASS: TestWorkflowConformance (1.40s)
    --- PASS: TestWorkflowConformance/ReopenFailedRunClearsErrorAndCompletion (0.05s)
    --- PASS: TestWorkflowConformance/ReopenCompletedRun (0.03s)
    --- PASS: TestWorkflowConformance/ReopenRunningRunIsRefused (0.01s)
    --- PASS: TestWorkflowConformance/ReopenRunUnknown (0.01s)
    --- PASS: TestWorkflowConformance/ReopenRunConcurrentExactlyOneWinner (0.15s)
    --- PASS: TestWorkflowConformance/ParentRunIDRoundTripsAndListChildRuns (0.02s)
--- PASS: TestCronDisableSurvivesConcurrentFires (5.10s)
--- PASS: TestAcquireCronLockExactlyOneHolder (1.18s)
--- PASS: TestClaimReplayKeepsLargeDurations (0.39s)
--- PASS: TestGetDLQByJobID_backfillsIndexForPreexistingRows (0.41s)
--- PASS: TestRunVersionAndParentRoundTrip (0.41s)
ok  	github.com/xraph/dispatch/store/redis	14.565s
```

Checked on 2026-10-07: with `updateEntity`'s script call swapped for a plain `SET`, `ClaimReplayConcurrentExactlyOneWinner`, `ReopenRunConcurrentExactlyOneWinner`, `TestCronDisableSurvivesConcurrentFires` and `TestAcquireCronLockExactlyOneHolder` all failed in 3 of 3 runs. With only `UpdateCronLastRun` put back to its old read then SET, `TestCronDisableSurvivesConcurrentFires` failed 4 of 5 (`round 1: the cron came back enabled after 11 fires raced its disable`), which is why the scheduler's writes move onto the helper too.

- [ ] **Step 10: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race -tags integration ./store/redis/...
go vet -tags integration ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: no FAIL lines from `go test ./...`; `ok  	github.com/xraph/dispatch/store/redis` from the race run (about 80 seconds, it starts a dozen containers); no output from `go vet`; `0 issues.` from the first lint; the second lint reports only the pre-existing `store/redis/store_test.go:54:5: shadow: declaration of "err"` (govet), which is not this task's.

- [ ] **Step 11: Commit**

```bash
git add store/redis/cas.go store/redis/operator.go store/redis/operator_test.go
git commit --only -m "feat(redis): implement the replay claim, targeted cron writes and run reopen

Redis now passes the three operator suites. ClaimReplay, ReleaseReplay,
ReopenRun and every cron write that touches the lock, the last or next
run, or the enabled flag go through one compare-and-set: Go reads the
blob, decides, builds the new blob with encoding/json, and a Lua script
writes it only if the key still holds the exact bytes Go read. A
scheduler write that read the entry before an operator disabled it now
re-reads instead of putting enabled back, and two workers can no longer
both take a cron lock. Lua never re-encodes an entity, so large int64
fields survive.

PushDLQ refuses a duplicate ID with ErrDLQAlreadyExists, writing the
entry and its indexes in one script. A per-job set backs GetDLQByJobID
and fills itself from rows written before it existed. DeleteDLQ drops
the entry and all its index members in one MULTI. runEntity keeps
ParentRunID, so ListChildRuns finds children, and Version, which every
write used to drop, so a run read back as the latest version." -- store/redis/cas.go store/redis/operator.go store/redis/operator_test.go \
  store/redis/keys.go store/redis/keys_internal_test.go store/redis/dlq.go store/redis/cron.go store/redis/workflow.go
git show --stat HEAD | tail -10
```

Expected: 8 files changed.

Notes for later tasks:
- The engine's `RetryJob` calls `GetDLQByJobID`. On Redis the first call after upgrading may backfill the per-job index from every dead letter, one GET and one MULTI per entry; after that it is two counts and a few reads.
- `PushDLQ` and `DeleteDLQ` are multi-key scripts and MULTIs across unrelated keys, like the existing `PurgeDLQ` and `DeleteCron`. This store has never supported Redis Cluster without hash tags, and this task does not change that.
- `updateEntity` returns a plain error after 64 consecutive lost compare-and-sets on one key. Nothing in the store comes near that, but a caller seeing `changed under 64 consecutive attempts` is looking at a write storm on one entity, not a missing row.
- `UpdateRun` and `UpdateCronEntry` are still whole-blob writes from the caller's snapshot. A `ReopenRun` racing an `UpdateRun` from a stale run is the engine's concern (replay must not race a live runner), not the store's.
- Other backends (from reading them on 2026-10-07, not run here): postgres and sqlite have no `parent_run_id` or `version` column on runs and their models drop both, so `ParentRunIDRoundTripsAndListChildRuns` will fail there until a migration adds them; mongo drops `Version`.

---

### Task 6: Make the new writes part of every store, and hold every backend to the run's version

All five backends now implement the replay claim, the targeted cron writes and the run reopen, so they stop being optional. Embedding them in `dlq.Store`, `cron.Store` and `workflow.Store` means the engine tasks that follow can call them without a type assertion, and a sixth backend cannot compile without them.

The same task closes a gap the backend tasks found: three of the five backends were dropping `Run.Version` (Postgres, SQLite and Redis never stored it; Mongo had the field but did not persist it), and the shared workflow suite could not see it, because every case compared one store read with a later one, and both said zero. A zero Version resolves to the latest registered workflow definition, so a resumed or replayed run silently switched to code it was never started on. The new case checks Version against the value written.

**Files:**
- Modify: `dlq/store.go`, `cron/store.go`, `workflow/store.go` (embed the capability)
- Modify: `store/storetest/workflow.go` (new case `VersionRoundTripsAsWritten`)

**Interfaces:**
- Consumes: `dlq.ReplayClaimer`, `cron.TargetedUpdater`, `workflow.Reopener` (Task 1), implemented by memory (Task 1), postgres (Task 2), sqlite (Task 3), mongo (Task 4), redis (Task 5).
- Produces: `dlq.Store` includes `ClaimReplay`, `ReleaseReplay`, `GetDLQByJobID`, `DeleteDLQ`; `cron.Store` includes `SetCronEnabled`, `UpdateCronNextRun`; `workflow.Store` includes `ReopenRun`. Tasks 8 to 10 rely on these.

- [ ] **Step 1: Add the failing suite case**

In `store/storetest/workflow.go`, the case list in `RunWorkflowSuite` ends with:

```go
		{"ParentRunIDRoundTripsAndListChildRuns", testParentRunIDAndChildren},
	}
```

Change it to:

```go
		{"ParentRunIDRoundTripsAndListChildRuns", testParentRunIDAndChildren},
		{"VersionRoundTripsAsWritten", testVersionRoundTrips},
	}
```

Append to the end of the file:

```go

// testVersionRoundTrips checks Version against the value written, not
// against another read. Every other case compares one store read with a
// later one, which a backend that drops Version passes trivially: both
// reads say zero. Three backends did exactly that, and a zero Version
// resolves to the latest registered definition, so a resumed or replayed
// run silently switched to code it was never started on.
func testVersionRoundTrips(t *testing.T, s WorkflowStore) {
	got := createSuiteRun(t, s, workflow.RunStateFailed)
	if got.Version != 3 {
		t.Fatalf("Version = %d after CreateRun, want 3: the store dropped it", got.Version)
	}

	if err := s.ReopenRun(context.Background(), got.ID); err != nil {
		t.Fatalf("ReopenRun: %v", err)
	}
	if after := mustGetRun(t, s, got.ID); after.Version != 3 {
		t.Fatalf("Version = %d after ReopenRun, want 3", after.Version)
	}
}
```

`createSuiteRun` already writes `Version: 3`.

- [ ] **Step 2: Run it**

Run: `go test -count=1 -race ./store/memory/ ./store/sqlite/ -run 'Workflow'` and `go test -count=1 -race -tags integration ./store/postgres/ ./store/redis/ -run 'Workflow'` and `go test -count=1 -v ./store/mongo/ -run 'Workflow' 2>&1 | grep -E '^(---|ok|FAIL)|SKIP'`
Expected: every backend passes, including `VersionRoundTripsAsWritten`, because Tasks 2 to 5 fixed the dropped Version on postgres, sqlite, mongo and redis. If one fails, that backend's task did not land as written: stop and report it, do not change the suite.

- [ ] **Step 3: Fold the capabilities into the base interfaces**

In each of `dlq/store.go`, `cron/store.go` and `workflow/store.go`, the interface opens with:

```go
type Store interface {
```

Add the package's capability as the first line inside it, followed by a blank line:

- `dlq/store.go`:

```go
type Store interface {
	ReplayClaimer

```

- `cron/store.go`:

```go
type Store interface {
	TargetedUpdater

```

- `workflow/store.go`:

```go
type Store interface {
	Reopener

```

- [ ] **Step 4: Build everything, tests included**

Run: `gofmt -l dlq cron workflow && go build ./... && go vet -tags integration ./...`
Expected: no output from gofmt, then success. This proves every implementer of the three interfaces, test fakes included, already has the methods. If vet names a type missing a method, it is a test fake the backend tasks did not reach: add the method to it in this task, delegating to the embedded store or returning the zero value with a comment saying the fake does not exercise it.

- [ ] **Step 5: Gate**

```bash
go build ./... && go test -count=1 ./... 2>&1 | grep -v '^ok\|no test files'
go test -count=1 -race ./store/memory/ ./store/sqlite/ ./engine/... ./worker/... ./cron/...
go test -count=1 -race -tags integration ./store/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: no FAIL lines, `0 issues.`

- [ ] **Step 6: Commit**

```bash
git commit --only -m "feat(store): make the operator writes part of every store, and check the run version

dlq.Store, cron.Store and workflow.Store now embed the replay claim, the
targeted cron writes and the run reopen, so the engine can call them
directly and a new backend will not compile without them.

The workflow suite also gains a case that checks a run's Version against
the value written. Every earlier case compared one read with another,
which let three backends drop Version unnoticed, and a dropped Version
quietly resumes a run on the newest definition instead of its own." -- dlq/store.go cron/store.go workflow/store.go store/storetest/workflow.go
git show --stat HEAD | tail -6
```

---

### Task 7: Operator actions and job cancellation become engine events

The engine is about to gain operator methods (cancel, retry, DLQ replay and purge, cron toggles, workflow replay), and a cancelled job needs to stop being reported as `job.failed`. Both need a way out to extensions before any engine code calls them. This task adds the two hooks, the `Action` record and the actor context helpers to `ext`, and teaches the three bundled extensions to handle them: `audit_hook` records them, `relay_hook` turns them into webhooks, and the stream broker publishes `job.cancelled` to the job topics the way it publishes `job.failed`. No engine call sites change here. Later tasks call `EmitJobCancelled` and `EmitOperatorAction`.

**Files:**
- Modify: `ext/ext.go` (add `JobCancelled` after `JobDLQ`; add the operator action section after `Shutdown`)
- Modify: `ext/registry.go` (two entry types, two cache fields, two `Register` cases, `EmitJobCancelled`, `EmitOperatorAction`)
- Modify: `ext/doc.go` (list the new hooks)
- Create: `ext/operator_test.go`
- Modify: `audit_hook/events.go`, `audit_hook/extension.go`, `audit_hook/options.go`, `audit_hook/doc.go`
- Modify: `audit_hook/extension_test.go` (`TestExtension_ViaRegistry` and `TestAllActions` count the new actions)
- Create: `audit_hook/operator_test.go`
- Modify: `relay_hook/events.go`, `relay_hook/extension.go`, `relay_hook/options.go`
- Create: `relay_hook/operator_test.go`
- Modify: `stream/event.go`, `stream/broker.go`
- Create: `stream/cancel_test.go`

**Interfaces:**
- Consumes: `ext.Registry`, `ext.Extension`, `id.ID.String()` (returns `""` for the nil ID), `id.ID.IsNil()`, `relay.Relay.Send` (refuses an event type that has no catalog entry).
- Produces (later tasks rely on these exact names):

```go
package ext
type JobCancelled interface { OnJobCancelled(ctx context.Context, j *job.Job) error }
type OperatorActionObserver interface { OnOperatorAction(ctx context.Context, a Action) error }
type ActionKind string
const (
	ActionJobCancelled     ActionKind = "job.cancelled"
	ActionJobRetried       ActionKind = "job.retried"
	ActionDLQReplayed      ActionKind = "dlq.replayed"
	ActionDLQDeleted       ActionKind = "dlq.deleted"
	ActionDLQPurged        ActionKind = "dlq.purged"
	ActionCronEnabled      ActionKind = "cron.enabled"
	ActionCronDisabled     ActionKind = "cron.disabled"
	ActionCronDeleted      ActionKind = "cron.deleted"
	ActionCronTriggered    ActionKind = "cron.triggered"
	ActionWorkflowReplayed ActionKind = "workflow.replayed"
)
type Action struct {
	Kind     ActionKind
	Actor    string
	JobID    id.JobID
	NewJobID id.JobID
	DLQID    id.DLQID
	CronID   id.CronID
	RunID    id.RunID
	Step     string
	Count    int64
	At       time.Time
}
func WithActor(ctx context.Context, subject string) context.Context
func ActorFrom(ctx context.Context) string
func (r *Registry) EmitJobCancelled(ctx context.Context, j *job.Job)
func (r *Registry) EmitOperatorAction(ctx context.Context, a Action) // fills empty Actor from ActorFrom(ctx), zero At with time.Now().UTC()

package audithook
const ActionJobCancelled = "job.cancelled" // CategoryJob, ResourceJob, warning
const (
	ActionOperatorJobCancelled     = "operator.job_cancelled"
	ActionOperatorJobRetried       = "operator.job_retried"
	ActionOperatorDLQReplayed      = "operator.dlq_replayed"
	ActionOperatorDLQDeleted       = "operator.dlq_deleted"
	ActionOperatorDLQPurged        = "operator.dlq_purged"
	ActionOperatorCronEnabled      = "operator.cron_enabled"
	ActionOperatorCronDisabled     = "operator.cron_disabled"
	ActionOperatorCronDeleted      = "operator.cron_deleted"
	ActionOperatorCronTriggered    = "operator.cron_triggered"
	ActionOperatorWorkflowReplayed = "operator.workflow_replayed"
)
const CategoryOperator = "dispatch.operator"
const ResourceDLQ = "dlq_entry"
func (e *Extension) OnJobCancelled(ctx context.Context, j *job.Job) error
func (e *Extension) OnOperatorAction(ctx context.Context, a ext.Action) error

package relayhook
const EventJobCancelled = "dispatch.job.cancelled"
const (
	EventOperatorJobCancelled     = "dispatch.operator.job_cancelled"
	EventOperatorJobRetried       = "dispatch.operator.job_retried"
	EventOperatorDLQReplayed      = "dispatch.operator.dlq_replayed"
	EventOperatorDLQDeleted       = "dispatch.operator.dlq_deleted"
	EventOperatorDLQPurged        = "dispatch.operator.dlq_purged"
	EventOperatorCronEnabled      = "dispatch.operator.cron_enabled"
	EventOperatorCronDisabled     = "dispatch.operator.cron_disabled"
	EventOperatorCronDeleted      = "dispatch.operator.cron_deleted"
	EventOperatorCronTriggered    = "dispatch.operator.cron_triggered"
	EventOperatorWorkflowReplayed = "dispatch.operator.workflow_replayed"
)
func (h *Extension) OnJobCancelled(ctx context.Context, j *job.Job) error
func (h *Extension) OnOperatorAction(ctx context.Context, a ext.Action) error

package stream
const EventJobCancelled EventType = "job.cancelled"
func (b *Broker) OnJobCancelled(_ context.Context, j *job.Job) error
```

Mapping notes the engine tasks should know. The audit record has no field for the acting subject, so `audit_hook` puts it in `Metadata["actor"]`, next to `kind`, `at` (RFC3339), every non-nil ID (`job_id`, `new_job_id`, `dlq_id`, `cron_id`, `run_id`), `step` when set, and `count` when non-zero or when the kind is `dlq.purged`. `ResourceID` is the ID of the thing acted on: `JobID` for job kinds, `DLQID` for DLQ kinds (empty for a purge), `CronID` for cron kinds (note `cron.fired` keeps using the entry name), `RunID` for `workflow.replayed`. Cancel, DLQ delete, DLQ purge, cron disable and cron delete are `warning`; the rest are `info`; outcome is always `success`. Relay operator events carry no tenant (like `dispatch.cron.fired`) and the same fields as JSON, with `count` sent for a purge even when it is 0. An unknown kind is still audited as `operator.` plus the kind with dots turned to underscores; relay refuses it (no catalog entry) and the registry logs the error. The stream broker does not publish operator actions; its topic scheme has no home for them.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- ext audit_hook relay_hook stream && git log -1 --oneline`
Expected: no output from `git status` for those directories. If another session has uncommitted edits there, stop and report.

- [ ] **Step 2: Write the failing registry tests**

Create `ext/operator_test.go`:

```go
package ext_test

import (
	"context"
	"errors"
	"testing"
	"time"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

// operatorExt implements only the two operator-facing hooks.
type operatorExt struct {
	cancelled []*job.Job
	actions   []ext.Action
}

func (e *operatorExt) Name() string { return "operator" }

func (e *operatorExt) OnJobCancelled(_ context.Context, j *job.Job) error {
	e.cancelled = append(e.cancelled, j)
	return nil
}

func (e *operatorExt) OnOperatorAction(_ context.Context, a ext.Action) error {
	e.actions = append(e.actions, a)
	return nil
}

// failingOperatorExt returns an error from both operator-facing hooks.
type failingOperatorExt struct{}

func (e *failingOperatorExt) Name() string { return "failing-operator" }

func (e *failingOperatorExt) OnJobCancelled(_ context.Context, _ *job.Job) error {
	return errors.New("cancel boom")
}

func (e *failingOperatorExt) OnOperatorAction(_ context.Context, _ ext.Action) error {
	return errors.New("action boom")
}

func TestRegistry_JobCancelledReachesImplementorsOnly(t *testing.T) {
	r := ext.NewRegistry(log.NewNoopLogger())
	jo := &jobOnlyExt{}
	op := &operatorExt{}
	r.Register(jo)
	r.Register(op)

	j := &job.Job{ID: id.NewJobID(), Name: "test-job"}
	r.EmitJobCancelled(context.Background(), j)

	if len(op.cancelled) != 1 || op.cancelled[0] != j {
		t.Fatalf("operator ext: want the cancelled job once, got %v", op.cancelled)
	}
	if len(jo.calls) != 0 {
		t.Fatalf("job-only ext does not implement JobCancelled, got calls %v", jo.calls)
	}
}

func TestRegistry_OperatorActionFillsActorAndTime(t *testing.T) {
	r := ext.NewRegistry(log.NewNoopLogger())
	op := &operatorExt{}
	r.Register(op)

	ctx := ext.WithActor(context.Background(), "user_42")
	jobID := id.NewJobID()

	before := time.Now().UTC()
	r.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionJobCancelled, JobID: jobID})
	after := time.Now().UTC()

	if len(op.actions) != 1 {
		t.Fatalf("want 1 action, got %d", len(op.actions))
	}
	got := op.actions[0]
	if got.Kind != ext.ActionJobCancelled {
		t.Errorf("Kind = %q, want %q", got.Kind, ext.ActionJobCancelled)
	}
	if got.JobID != jobID {
		t.Errorf("JobID = %s, want %s", got.JobID, jobID)
	}
	if got.Actor != "user_42" {
		t.Errorf("Actor = %q, want %q (from ctx)", got.Actor, "user_42")
	}
	if got.At.Before(before) || got.At.After(after) {
		t.Errorf("At = %v, want between %v and %v", got.At, before, after)
	}
	if got.At.Location() != time.UTC {
		t.Errorf("At location = %v, want UTC", got.At.Location())
	}
}

func TestRegistry_OperatorActionKeepsExplicitActorAndTime(t *testing.T) {
	r := ext.NewRegistry(log.NewNoopLogger())
	op := &operatorExt{}
	r.Register(op)

	ctx := ext.WithActor(context.Background(), "user_42")
	at := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	r.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionDLQPurged, Actor: "system", Count: 3, At: at})

	if len(op.actions) != 1 {
		t.Fatalf("want 1 action, got %d", len(op.actions))
	}
	got := op.actions[0]
	if got.Actor != "system" {
		t.Errorf("Actor = %q, want the explicit %q", got.Actor, "system")
	}
	if !got.At.Equal(at) {
		t.Errorf("At = %v, want the explicit %v", got.At, at)
	}
	if got.Count != 3 {
		t.Errorf("Count = %d, want 3", got.Count)
	}
}

func TestRegistry_OperatorActionWithoutActorStaysEmpty(t *testing.T) {
	r := ext.NewRegistry(log.NewNoopLogger())
	op := &operatorExt{}
	r.Register(op)

	r.EmitOperatorAction(context.Background(), ext.Action{Kind: ext.ActionCronTriggered, CronID: id.NewCronID()})

	if len(op.actions) != 1 {
		t.Fatalf("want 1 action, got %d", len(op.actions))
	}
	if op.actions[0].Actor != "" {
		t.Errorf("Actor = %q, want empty when ctx carries none", op.actions[0].Actor)
	}
}

func TestRegistry_OperatorHookErrorsLoggedNotPropagated(t *testing.T) {
	r := ext.NewRegistry(log.NewNoopLogger())
	op := &operatorExt{}
	r.Register(&failingOperatorExt{})
	r.Register(op)

	ctx := context.Background()
	r.EmitJobCancelled(ctx, &job.Job{ID: id.NewJobID()})
	r.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionJobRetried})

	if len(op.cancelled) != 1 || len(op.actions) != 1 {
		t.Fatalf("a failing hook must not stop later ones: cancelled=%d actions=%d", len(op.cancelled), len(op.actions))
	}
}

func TestActorFrom(t *testing.T) {
	if got := ext.ActorFrom(context.Background()); got != "" {
		t.Errorf("ActorFrom(background) = %q, want empty", got)
	}
	ctx := ext.WithActor(context.Background(), "user_7")
	if got := ext.ActorFrom(ctx); got != "user_7" {
		t.Errorf("ActorFrom = %q, want %q", got, "user_7")
	}
}

func TestRegistry_EmptyRegistryOperatorNoOp(_ *testing.T) {
	r := ext.NewRegistry(log.NewNoopLogger())
	ctx := context.Background()

	// Neither should panic with no extensions registered.
	r.EmitJobCancelled(ctx, &job.Job{})
	r.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionCronDeleted})
}
```

- [ ] **Step 3: Run them and see them fail**

Run: `go test ./ext/`
Expected: a build failure that starts:

```text
# github.com/xraph/dispatch/ext_test [github.com/xraph/dispatch/ext.test]
ext/operator_test.go:19:18: undefined: ext.Action
ext/operator_test.go:29:65: undefined: ext.Action
ext/operator_test.go:43:72: undefined: ext.Action
```

- [ ] **Step 4: Add the hooks, the Action record and the actor helpers to `ext/ext.go`**

In `ext/ext.go`, add `JobCancelled` directly after `JobDLQ`.

Find:

```go
// JobDLQ is called when a job is moved to the dead letter queue.
type JobDLQ interface {
	OnJobDLQ(ctx context.Context, j *job.Job, err error) error
}
```

Replace with:

```go
// JobDLQ is called when a job is moved to the dead letter queue.
type JobDLQ interface {
	OnJobDLQ(ctx context.Context, j *job.Job, err error) error
}

// JobCancelled fires when a job reaches cancelled: immediately for a pending
// or retrying job, and for a running job when its worker observes the cancel
// (lease lost to a cancelled row) instead of reporting job.failed.
type JobCancelled interface {
	OnJobCancelled(ctx context.Context, j *job.Job) error
}
```

Then append the operator action section after `Shutdown`, at the end of the file. `ext.go` already imports `context`, `time`, `id` and `job`, so the import block does not change.

Find:

```go
// Shutdown is called during graceful shutdown.
type Shutdown interface {
	OnShutdown(ctx context.Context) error
}
```

Replace with:

```go
// Shutdown is called during graceful shutdown.
type Shutdown interface {
	OnShutdown(ctx context.Context) error
}

// ──────────────────────────────────────────────────
// Operator actions
// ──────────────────────────────────────────────────

// OperatorActionObserver sees every operator action taken through the engine.
type OperatorActionObserver interface {
	OnOperatorAction(ctx context.Context, a Action) error
}

// ActionKind names one kind of operator action.
type ActionKind string

// Operator action kinds. The engine emits exactly one Action per
// successful operator call.
const (
	ActionJobCancelled     ActionKind = "job.cancelled"
	ActionJobRetried       ActionKind = "job.retried"
	ActionDLQReplayed      ActionKind = "dlq.replayed"
	ActionDLQDeleted       ActionKind = "dlq.deleted"
	ActionDLQPurged        ActionKind = "dlq.purged"
	ActionCronEnabled      ActionKind = "cron.enabled"
	ActionCronDisabled     ActionKind = "cron.disabled"
	ActionCronDeleted      ActionKind = "cron.deleted"
	ActionCronTriggered    ActionKind = "cron.triggered"
	ActionWorkflowReplayed ActionKind = "workflow.replayed"
)

// Action describes one operator action. Only the fields that apply to
// its Kind are set; the rest keep their zero values.
type Action struct {
	Kind     ActionKind
	Actor    string   // from ActorFrom(ctx); empty when unknown
	JobID    id.JobID // job acted on
	NewJobID id.JobID // job created (replay, cron trigger)
	DLQID    id.DLQID
	CronID   id.CronID
	RunID    id.RunID
	Step     string // workflow replay step
	Count    int64  // purge count, replay-all count
	At       time.Time
}

// actorKey is the context key for the acting subject. Unexported, so no
// other package can collide with it or set it except through WithActor.
type actorKey struct{}

// WithActor returns a copy of ctx that carries the subject taking an
// operator action. The engine reads it back through ActorFrom.
func WithActor(ctx context.Context, subject string) context.Context {
	return context.WithValue(ctx, actorKey{}, subject)
}

// ActorFrom returns the subject stored by WithActor, or "" when ctx
// carries none.
func ActorFrom(ctx context.Context) string {
	if subject, ok := ctx.Value(actorKey{}).(string); ok {
		return subject
	}
	return ""
}
```

Note `ActorFrom` uses the two-value type assertion inside an `if`: the repo lints with errcheck `check-type-assertions` and `check-blank`, so `subject, _ := ...` would be flagged.

- [ ] **Step 5: Cache and emit the new hooks in `ext/registry.go`**

Add an entry type after `jobDLQEntry`:

Find:

```go
type jobDLQEntry struct {
	name string
	hook JobDLQ
}
```

Replace with:

```go
type jobDLQEntry struct {
	name string
	hook JobDLQ
}

type jobCancelledEntry struct {
	name string
	hook JobCancelled
}
```

Add an entry type after `shutdownEntry`:

Find:

```go
type shutdownEntry struct {
	name string
	hook Shutdown
}
```

Replace with:

```go
type shutdownEntry struct {
	name string
	hook Shutdown
}

type operatorActionEntry struct {
	name string
	hook OperatorActionObserver
}
```

In the `Registry` struct, add a cache field after `jobDLQ`:

Find:

```go
	jobDLQ                []jobDLQEntry
```

Replace with:

```go
	jobDLQ                []jobDLQEntry
	jobCancelled          []jobCancelledEntry
```

And after `shutdown`, closing the struct:

Find:

```go
	shutdown              []shutdownEntry
}
```

Replace with:

```go
	shutdown              []shutdownEntry
	operatorAction        []operatorActionEntry
}
```

In `Register`, after the `JobDLQ` case:

Find:

```go
	if h, ok := e.(JobDLQ); ok {
		r.jobDLQ = append(r.jobDLQ, jobDLQEntry{name, h})
	}
```

Replace with:

```go
	if h, ok := e.(JobDLQ); ok {
		r.jobDLQ = append(r.jobDLQ, jobDLQEntry{name, h})
	}
	if h, ok := e.(JobCancelled); ok {
		r.jobCancelled = append(r.jobCancelled, jobCancelledEntry{name, h})
	}
```

And after the `Shutdown` case, closing `Register`:

Find:

```go
	if h, ok := e.(Shutdown); ok {
		r.shutdown = append(r.shutdown, shutdownEntry{name, h})
	}
}
```

Replace with:

```go
	if h, ok := e.(Shutdown); ok {
		r.shutdown = append(r.shutdown, shutdownEntry{name, h})
	}
	if h, ok := e.(OperatorActionObserver); ok {
		r.operatorAction = append(r.operatorAction, operatorActionEntry{name, h})
	}
}
```

Add `EmitJobCancelled` after `EmitJobDLQ`. It follows the existing emitters exactly: errors are logged through `logHookError` and never returned.

Find:

```go
// EmitJobDLQ notifies all extensions that implement JobDLQ.
func (r *Registry) EmitJobDLQ(ctx context.Context, j *job.Job, jobErr error) {
	for _, e := range r.jobDLQ {
		if err := e.hook.OnJobDLQ(ctx, j, jobErr); err != nil {
			r.logHookError("OnJobDLQ", e.name, err)
		}
	}
}
```

Replace with:

```go
// EmitJobDLQ notifies all extensions that implement JobDLQ.
func (r *Registry) EmitJobDLQ(ctx context.Context, j *job.Job, jobErr error) {
	for _, e := range r.jobDLQ {
		if err := e.hook.OnJobDLQ(ctx, j, jobErr); err != nil {
			r.logHookError("OnJobDLQ", e.name, err)
		}
	}
}

// EmitJobCancelled notifies all extensions that implement JobCancelled.
func (r *Registry) EmitJobCancelled(ctx context.Context, j *job.Job) {
	for _, e := range r.jobCancelled {
		if err := e.hook.OnJobCancelled(ctx, j); err != nil {
			r.logHookError("OnJobCancelled", e.name, err)
		}
	}
}
```

Add `EmitOperatorAction` after `EmitShutdown` (before `logHookError`). `registry.go` already imports `time`.

Find:

```go
// EmitShutdown notifies all extensions that implement Shutdown.
func (r *Registry) EmitShutdown(ctx context.Context) {
	for _, e := range r.shutdown {
		if err := e.hook.OnShutdown(ctx); err != nil {
			r.logHookError("OnShutdown", e.name, err)
		}
	}
}
```

Replace with:

```go
// EmitShutdown notifies all extensions that implement Shutdown.
func (r *Registry) EmitShutdown(ctx context.Context) {
	for _, e := range r.shutdown {
		if err := e.hook.OnShutdown(ctx); err != nil {
			r.logHookError("OnShutdown", e.name, err)
		}
	}
}

// ──────────────────────────────────────────────────
// Operator action emitter
// ──────────────────────────────────────────────────

// EmitOperatorAction notifies all extensions that implement
// OperatorActionObserver. An empty Actor is filled from ActorFrom(ctx)
// and a zero At with the current time in UTC, so callers only set what
// they know.
func (r *Registry) EmitOperatorAction(ctx context.Context, a Action) {
	if a.Actor == "" {
		a.Actor = ActorFrom(ctx)
	}
	if a.At.IsZero() {
		a.At = time.Now().UTC()
	}
	for _, e := range r.operatorAction {
		if err := e.hook.OnOperatorAction(ctx, a); err != nil {
			r.logHookError("OnOperatorAction", e.name, err)
		}
	}
}
```

- [ ] **Step 6: List the new hooks in `ext/doc.go`**

Add a bullet after the `JobDLQ` one. (The existing bullets use em dashes; the new lines do not.)

Find:

```go
//   - [JobDLQ] — job was moved to the dead letter queue
```

Replace with:

```go
//   - [JobDLQ] — job was moved to the dead letter queue
//   - [JobCancelled]: job reached cancelled
```

Add an operator section after the `Shutdown` bullet:

Find:

```go
//   - [Shutdown] — the dispatcher is shutting down gracefully
//
```

Replace with:

```go
//   - [Shutdown] — the dispatcher is shutting down gracefully
//
// # Operator Actions
//
//   - [OperatorActionObserver]: an operator cancelled, retried, replayed,
//     deleted, purged, toggled or triggered something through the engine.
//     The [Action] carries the subject from [WithActor] as its Actor.
//
```

- [ ] **Step 7: Run the registry tests and see them pass**

Run: `gofmt -l ext; go test ./ext/`
Expected: no files from `gofmt -l`, then `ok  	github.com/xraph/dispatch/ext`.

- [ ] **Step 8: Write the failing audit_hook tests**

Create `audit_hook/operator_test.go`:

```go
package audithook_test

import (
	"context"
	"testing"
	"time"

	log "github.com/xraph/go-utils/log"

	ah "github.com/xraph/dispatch/audit_hook"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
)

func TestExtension_JobCancelled(t *testing.T) {
	rec := &mockRecorder{}
	e := ah.New(rec)
	j := newTestJob()

	if err := e.OnJobCancelled(context.Background(), j); err != nil {
		t.Fatalf("OnJobCancelled: %v", err)
	}

	evt := rec.last()
	if evt == nil {
		t.Fatal("no event recorded")
	}
	if evt.Action != ah.ActionJobCancelled {
		t.Errorf("Action: want %q, got %q", ah.ActionJobCancelled, evt.Action)
	}
	if evt.Resource != ah.ResourceJob {
		t.Errorf("Resource: want %q, got %q", ah.ResourceJob, evt.Resource)
	}
	if evt.Category != ah.CategoryJob {
		t.Errorf("Category: want %q, got %q", ah.CategoryJob, evt.Category)
	}
	if evt.ResourceID != j.ID.String() {
		t.Errorf("ResourceID: want %q, got %q", j.ID.String(), evt.ResourceID)
	}
	if evt.Severity != ah.SeverityWarning {
		t.Errorf("Severity: want %q, got %q", ah.SeverityWarning, evt.Severity)
	}
	if evt.Outcome != ah.OutcomeSuccess {
		t.Errorf("Outcome: want %q, got %q", ah.OutcomeSuccess, evt.Outcome)
	}
	if evt.Metadata["job_name"] != "send-email" {
		t.Errorf("Metadata[job_name]: want %q, got %v", "send-email", evt.Metadata["job_name"])
	}
	if evt.Metadata["queue"] != "default" {
		t.Errorf("Metadata[queue]: want %q, got %v", "default", evt.Metadata["queue"])
	}
}

func TestExtension_OperatorJobCancelled(t *testing.T) {
	rec := &mockRecorder{}
	e := ah.New(rec)
	jobID := id.NewJobID()
	at := time.Date(2026, 10, 7, 12, 30, 0, 0, time.UTC)

	err := e.OnOperatorAction(context.Background(), ext.Action{
		Kind:  ext.ActionJobCancelled,
		Actor: "user_42",
		JobID: jobID,
		At:    at,
	})
	if err != nil {
		t.Fatalf("OnOperatorAction: %v", err)
	}

	evt := rec.last()
	if evt == nil {
		t.Fatal("no event recorded")
	}
	if evt.Action != ah.ActionOperatorJobCancelled {
		t.Errorf("Action: want %q, got %q", ah.ActionOperatorJobCancelled, evt.Action)
	}
	if evt.Resource != ah.ResourceJob {
		t.Errorf("Resource: want %q, got %q", ah.ResourceJob, evt.Resource)
	}
	if evt.Category != ah.CategoryOperator {
		t.Errorf("Category: want %q, got %q", ah.CategoryOperator, evt.Category)
	}
	if evt.ResourceID != jobID.String() {
		t.Errorf("ResourceID: want %q, got %q", jobID.String(), evt.ResourceID)
	}
	if evt.Severity != ah.SeverityWarning {
		t.Errorf("Severity: want %q, got %q", ah.SeverityWarning, evt.Severity)
	}
	if evt.Outcome != ah.OutcomeSuccess {
		t.Errorf("Outcome: want %q, got %q", ah.OutcomeSuccess, evt.Outcome)
	}
	if evt.Metadata["actor"] != "user_42" {
		t.Errorf("Metadata[actor]: want %q, got %v", "user_42", evt.Metadata["actor"])
	}
	if evt.Metadata["kind"] != "job.cancelled" {
		t.Errorf("Metadata[kind]: want %q, got %v", "job.cancelled", evt.Metadata["kind"])
	}
	if evt.Metadata["at"] != "2026-10-07T12:30:00Z" {
		t.Errorf("Metadata[at]: want %q, got %v", "2026-10-07T12:30:00Z", evt.Metadata["at"])
	}
	if evt.Metadata["job_id"] != jobID.String() {
		t.Errorf("Metadata[job_id]: want %q, got %v", jobID.String(), evt.Metadata["job_id"])
	}
	for _, absent := range []string{"new_job_id", "dlq_id", "cron_id", "run_id", "step", "count"} {
		if v, ok := evt.Metadata[absent]; ok {
			t.Errorf("Metadata[%s]: want absent for a cancel, got %v", absent, v)
		}
	}
}

func TestExtension_OperatorDLQPurgedKeepsZeroCount(t *testing.T) {
	rec := &mockRecorder{}
	e := ah.New(rec)

	err := e.OnOperatorAction(context.Background(), ext.Action{
		Kind:  ext.ActionDLQPurged,
		Actor: "user_42",
		At:    time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("OnOperatorAction: %v", err)
	}

	evt := rec.last()
	if evt.Action != ah.ActionOperatorDLQPurged {
		t.Errorf("Action: want %q, got %q", ah.ActionOperatorDLQPurged, evt.Action)
	}
	if evt.Resource != ah.ResourceDLQ {
		t.Errorf("Resource: want %q, got %q", ah.ResourceDLQ, evt.Resource)
	}
	if evt.ResourceID != "" {
		t.Errorf("ResourceID: want empty for a purge, got %q", evt.ResourceID)
	}
	if evt.Metadata["count"] != int64(0) {
		t.Errorf("Metadata[count]: want int64(0) (a purge of nothing is still a purge), got %#v", evt.Metadata["count"])
	}
}

func TestExtension_OperatorActionsMapEveryKind(t *testing.T) {
	jobID, newJobID := id.NewJobID(), id.NewJobID()
	dlqID, cronID, runID := id.NewDLQID(), id.NewCronID(), id.NewRunID()

	cases := []struct {
		action    ext.Action
		wantName  string
		wantRes   string
		wantResID string
		wantSev   string
	}{
		{ext.Action{Kind: ext.ActionJobCancelled, JobID: jobID}, ah.ActionOperatorJobCancelled, ah.ResourceJob, jobID.String(), ah.SeverityWarning},
		{ext.Action{Kind: ext.ActionJobRetried, JobID: jobID}, ah.ActionOperatorJobRetried, ah.ResourceJob, jobID.String(), ah.SeverityInfo},
		{ext.Action{Kind: ext.ActionDLQReplayed, DLQID: dlqID, NewJobID: newJobID}, ah.ActionOperatorDLQReplayed, ah.ResourceDLQ, dlqID.String(), ah.SeverityInfo},
		{ext.Action{Kind: ext.ActionDLQDeleted, DLQID: dlqID}, ah.ActionOperatorDLQDeleted, ah.ResourceDLQ, dlqID.String(), ah.SeverityWarning},
		{ext.Action{Kind: ext.ActionDLQPurged, Count: 4}, ah.ActionOperatorDLQPurged, ah.ResourceDLQ, "", ah.SeverityWarning},
		{ext.Action{Kind: ext.ActionCronEnabled, CronID: cronID}, ah.ActionOperatorCronEnabled, ah.ResourceCron, cronID.String(), ah.SeverityInfo},
		{ext.Action{Kind: ext.ActionCronDisabled, CronID: cronID}, ah.ActionOperatorCronDisabled, ah.ResourceCron, cronID.String(), ah.SeverityWarning},
		{ext.Action{Kind: ext.ActionCronDeleted, CronID: cronID}, ah.ActionOperatorCronDeleted, ah.ResourceCron, cronID.String(), ah.SeverityWarning},
		{ext.Action{Kind: ext.ActionCronTriggered, CronID: cronID, NewJobID: newJobID}, ah.ActionOperatorCronTriggered, ah.ResourceCron, cronID.String(), ah.SeverityInfo},
		{ext.Action{Kind: ext.ActionWorkflowReplayed, RunID: runID, Step: "charge"}, ah.ActionOperatorWorkflowReplayed, ah.ResourceWorkflow, runID.String(), ah.SeverityInfo},
	}

	for _, tc := range cases {
		t.Run(string(tc.action.Kind), func(t *testing.T) {
			rec := &mockRecorder{}
			e := ah.New(rec)
			if err := e.OnOperatorAction(context.Background(), tc.action); err != nil {
				t.Fatalf("OnOperatorAction: %v", err)
			}
			evt := rec.last()
			if evt == nil {
				t.Fatal("no event recorded")
			}
			if evt.Action != tc.wantName {
				t.Errorf("Action: want %q, got %q", tc.wantName, evt.Action)
			}
			if evt.Category != ah.CategoryOperator {
				t.Errorf("Category: want %q, got %q", ah.CategoryOperator, evt.Category)
			}
			if evt.Resource != tc.wantRes {
				t.Errorf("Resource: want %q, got %q", tc.wantRes, evt.Resource)
			}
			if evt.ResourceID != tc.wantResID {
				t.Errorf("ResourceID: want %q, got %q", tc.wantResID, evt.ResourceID)
			}
			if evt.Severity != tc.wantSev {
				t.Errorf("Severity: want %q, got %q", tc.wantSev, evt.Severity)
			}
		})
	}
}

func TestExtension_OperatorActionUnknownKind(t *testing.T) {
	rec := &mockRecorder{}
	e := ah.New(rec)

	if err := e.OnOperatorAction(context.Background(), ext.Action{Kind: "queue.paused", Actor: "user_42"}); err != nil {
		t.Fatalf("OnOperatorAction: %v", err)
	}

	evt := rec.last()
	if evt == nil {
		t.Fatal("an unmapped kind must still be audited")
	}
	if evt.Action != "operator.queue_paused" {
		t.Errorf("Action: want %q, got %q", "operator.queue_paused", evt.Action)
	}
	if evt.Category != ah.CategoryOperator {
		t.Errorf("Category: want %q, got %q", ah.CategoryOperator, evt.Category)
	}
	if evt.Metadata["actor"] != "user_42" {
		t.Errorf("Metadata[actor]: want %q, got %v", "user_42", evt.Metadata["actor"])
	}
}

func TestExtension_OperatorActionViaRegistryTakesActorFromContext(t *testing.T) {
	rec := &mockRecorder{}
	reg := ext.NewRegistry(log.NewNoopLogger())
	reg.Register(ah.New(rec))

	ctx := ext.WithActor(context.Background(), "user_9")
	reg.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionJobRetried, JobID: id.NewJobID()})

	evt := rec.findByAction(ah.ActionOperatorJobRetried)
	if evt == nil {
		t.Fatal("no operator.job_retried event recorded")
	}
	if evt.Metadata["actor"] != "user_9" {
		t.Errorf("Metadata[actor]: want %q, got %v", "user_9", evt.Metadata["actor"])
	}
	if at, ok := evt.Metadata["at"].(string); !ok || at == "" {
		t.Errorf("Metadata[at]: want the registry's default time, got %v", evt.Metadata["at"])
	}
}

func TestExtension_WithActions_FiltersOperatorActions(t *testing.T) {
	rec := &mockRecorder{}
	e := ah.New(rec, ah.WithActions(ah.ActionOperatorDLQPurged))
	ctx := context.Background()

	if err := e.OnOperatorAction(ctx, ext.Action{Kind: ext.ActionJobCancelled, JobID: id.NewJobID()}); err != nil {
		t.Fatalf("OnOperatorAction: %v", err)
	}
	if rec.count() != 0 {
		t.Fatalf("want 0 events (operator.job_cancelled disabled), got %d", rec.count())
	}
	if err := e.OnOperatorAction(ctx, ext.Action{Kind: ext.ActionDLQPurged, Count: 2}); err != nil {
		t.Fatalf("OnOperatorAction: %v", err)
	}
	if rec.count() != 1 {
		t.Fatalf("want 1 event (operator.dlq_purged enabled), got %d", rec.count())
	}
}
```

In `audit_hook/extension_test.go`, `TestExtension_ViaRegistry` checks that the registry produces one event per entry in `AllActions()`, which is about to grow by 11. Make it emit the new ones:

Find:

```go
	reg.EmitCronFired(ctx, "hourly", id.NewJobID())

	// Verify all 12 event types were recorded.
	allActions := ah.AllActions()
```

Replace with:

```go
	reg.EmitCronFired(ctx, "hourly", id.NewJobID())
	reg.EmitJobCancelled(ctx, j)
	for _, kind := range []ext.ActionKind{
		ext.ActionJobCancelled, ext.ActionJobRetried,
		ext.ActionDLQReplayed, ext.ActionDLQDeleted, ext.ActionDLQPurged,
		ext.ActionCronEnabled, ext.ActionCronDisabled, ext.ActionCronDeleted, ext.ActionCronTriggered,
		ext.ActionWorkflowReplayed,
	} {
		reg.EmitOperatorAction(ctx, ext.Action{Kind: kind})
	}

	// Verify every action in AllActions was recorded exactly once.
	allActions := ah.AllActions()
```

And in `TestAllActions`:

Find:

```go
	if len(actions) != 12 {
		t.Errorf("expected 12 actions, got %d", len(actions))
	}
```

Replace with:

```go
	if len(actions) != 23 {
		t.Errorf("expected 23 actions, got %d", len(actions))
	}
```

- [ ] **Step 9: Run them and see them fail**

Run: `go test ./audit_hook/`
Expected: a build failure that starts:

```text
# github.com/xraph/dispatch/audit_hook_test [github.com/xraph/dispatch/audit_hook.test]
audit_hook/operator_test.go:20:14: e.OnJobCancelled undefined (type *audithook.Extension has no field or method OnJobCancelled)
audit_hook/operator_test.go:28:22: undefined: ah.ActionJobCancelled
audit_hook/operator_test.go:29:42: undefined: ah.ActionJobCancelled
```

- [ ] **Step 10: Add the audit actions, category and resource**

In `audit_hook/events.go`, add the lifecycle action after `ActionJobDLQ`:

Find:

```go
	ActionJobDLQ                = "job.dlq"
```

Replace with:

```go
	ActionJobDLQ                = "job.dlq"
	ActionJobCancelled          = "job.cancelled"
```

Add the operator actions as their own block after the first `const` block closes:

Find:

```go
	ActionCronFired             = "cron.fired"
)
```

Replace with:

```go
	ActionCronFired             = "cron.fired"
)

// Operator audit actions. Each constant corresponds to one ext.ActionKind
// and is recorded under CategoryOperator, so an operator's cancel stays
// distinct from the job.cancelled lifecycle event it causes.
const (
	ActionOperatorJobCancelled     = "operator.job_cancelled"
	ActionOperatorJobRetried       = "operator.job_retried"
	ActionOperatorDLQReplayed      = "operator.dlq_replayed"
	ActionOperatorDLQDeleted       = "operator.dlq_deleted"
	ActionOperatorDLQPurged        = "operator.dlq_purged"
	ActionOperatorCronEnabled      = "operator.cron_enabled"
	ActionOperatorCronDisabled     = "operator.cron_disabled"
	ActionOperatorCronDeleted      = "operator.cron_deleted"
	ActionOperatorCronTriggered    = "operator.cron_triggered"
	ActionOperatorWorkflowReplayed = "operator.workflow_replayed"
)
```

Add the category:

Find:

```go
	CategoryCron     = "dispatch.cron"
)
```

Replace with:

```go
	CategoryCron     = "dispatch.cron"
	CategoryOperator = "dispatch.operator"
)
```

Add the resource:

Find:

```go
	ResourceCron     = "cron_entry"
)
```

Replace with:

```go
	ResourceCron     = "cron_entry"
	ResourceDLQ      = "dlq_entry"
)
```

In `AllActions`, add the lifecycle action after `ActionJobDLQ`:

Find:

```go
		ActionJobDLQ,
		ActionWorkflowStarted,
```

Replace with:

```go
		ActionJobDLQ,
		ActionJobCancelled,
		ActionWorkflowStarted,
```

And the operator actions at the end of the list:

Find:

```go
		ActionCronFired,
	}
}
```

Replace with:

```go
		ActionCronFired,
		ActionOperatorJobCancelled,
		ActionOperatorJobRetried,
		ActionOperatorDLQReplayed,
		ActionOperatorDLQDeleted,
		ActionOperatorDLQPurged,
		ActionOperatorCronEnabled,
		ActionOperatorCronDisabled,
		ActionOperatorCronDeleted,
		ActionOperatorCronTriggered,
		ActionOperatorWorkflowReplayed,
	}
}
```

- [ ] **Step 11: Implement both hooks in `audit_hook/extension.go`**

Add `strings` to the imports:

Find:

```go
import (
	"context"
	"fmt"
	"time"
```

Replace with:

```go
import (
	"context"
	"fmt"
	"strings"
	"time"
```

Replace the compile-time check block with this one. gofmt realigns every line because `OperatorActionObserver` is the longest name, so the whole block is shown:

Find:

```go
// Compile-time interface checks.
var (
	_ ext.Extension             = (*Extension)(nil)
	_ ext.JobEnqueued           = (*Extension)(nil)
	_ ext.JobStarted            = (*Extension)(nil)
	_ ext.JobCompleted          = (*Extension)(nil)
	_ ext.JobFailed             = (*Extension)(nil)
	_ ext.JobRetrying           = (*Extension)(nil)
	_ ext.JobDLQ                = (*Extension)(nil)
	_ ext.WorkflowStarted       = (*Extension)(nil)
	_ ext.WorkflowStepCompleted = (*Extension)(nil)
	_ ext.WorkflowStepFailed    = (*Extension)(nil)
	_ ext.WorkflowCompleted     = (*Extension)(nil)
	_ ext.WorkflowFailed        = (*Extension)(nil)
	_ ext.CronFired             = (*Extension)(nil)
)
```

Replace with:

```go
// Compile-time interface checks.
var (
	_ ext.Extension              = (*Extension)(nil)
	_ ext.JobEnqueued            = (*Extension)(nil)
	_ ext.JobStarted             = (*Extension)(nil)
	_ ext.JobCompleted           = (*Extension)(nil)
	_ ext.JobFailed              = (*Extension)(nil)
	_ ext.JobRetrying            = (*Extension)(nil)
	_ ext.JobDLQ                 = (*Extension)(nil)
	_ ext.JobCancelled           = (*Extension)(nil)
	_ ext.WorkflowStarted        = (*Extension)(nil)
	_ ext.WorkflowStepCompleted  = (*Extension)(nil)
	_ ext.WorkflowStepFailed     = (*Extension)(nil)
	_ ext.WorkflowCompleted      = (*Extension)(nil)
	_ ext.WorkflowFailed         = (*Extension)(nil)
	_ ext.CronFired              = (*Extension)(nil)
	_ ext.OperatorActionObserver = (*Extension)(nil)
)
```

Add `OnJobCancelled` after `OnJobDLQ`, just above the workflow section marker:

Find:

```go
// ── Workflow lifecycle hooks ────────────────────────
```

Replace with:

```go
// OnJobCancelled implements ext.JobCancelled.
func (e *Extension) OnJobCancelled(ctx context.Context, j *job.Job) error {
	return e.record(ctx, ActionJobCancelled, SeverityWarning, OutcomeSuccess,
		ResourceJob, j.ID.String(), CategoryJob, nil,
		"job_name", j.Name,
		"queue", j.Queue,
	)
}

// ── Workflow lifecycle hooks ────────────────────────
```

Add the operator section just above the internal helpers marker:

Find:

```go
// ── Internal helpers ────────────────────────────────
```

Replace with:

```go
// ── Operator actions ────────────────────────────────

// operatorAudit says how one ext.ActionKind is recorded.
type operatorAudit struct {
	action   string
	resource string
	severity string
}

// operatorAudits maps each operator action kind to its audit action,
// resource type and severity. Actions that stop or remove work are
// warnings; the rest are info.
var operatorAudits = map[ext.ActionKind]operatorAudit{
	ext.ActionJobCancelled:     {ActionOperatorJobCancelled, ResourceJob, SeverityWarning},
	ext.ActionJobRetried:       {ActionOperatorJobRetried, ResourceJob, SeverityInfo},
	ext.ActionDLQReplayed:      {ActionOperatorDLQReplayed, ResourceDLQ, SeverityInfo},
	ext.ActionDLQDeleted:       {ActionOperatorDLQDeleted, ResourceDLQ, SeverityWarning},
	ext.ActionDLQPurged:        {ActionOperatorDLQPurged, ResourceDLQ, SeverityWarning},
	ext.ActionCronEnabled:      {ActionOperatorCronEnabled, ResourceCron, SeverityInfo},
	ext.ActionCronDisabled:     {ActionOperatorCronDisabled, ResourceCron, SeverityWarning},
	ext.ActionCronDeleted:      {ActionOperatorCronDeleted, ResourceCron, SeverityWarning},
	ext.ActionCronTriggered:    {ActionOperatorCronTriggered, ResourceCron, SeverityInfo},
	ext.ActionWorkflowReplayed: {ActionOperatorWorkflowReplayed, ResourceWorkflow, SeverityInfo},
}

// OnOperatorAction implements ext.OperatorActionObserver. AuditEvent has
// no field for the acting subject, so it goes into Metadata["actor"].
// IDs that do not apply to the kind are left out of Metadata. A kind
// this version does not know is still recorded, as "operator." plus the
// kind with its dots turned into underscores.
func (e *Extension) OnOperatorAction(ctx context.Context, a ext.Action) error {
	m, ok := operatorAudits[a.Kind]
	if !ok {
		m = operatorAudit{
			action:   "operator." + strings.ReplaceAll(string(a.Kind), ".", "_"),
			severity: SeverityInfo,
		}
	}

	kv := []any{"kind", string(a.Kind), "actor", a.Actor}
	if !a.At.IsZero() {
		kv = append(kv, "at", a.At.Format(time.RFC3339))
	}
	kv = appendID(kv, "job_id", a.JobID)
	kv = appendID(kv, "new_job_id", a.NewJobID)
	kv = appendID(kv, "dlq_id", a.DLQID)
	kv = appendID(kv, "cron_id", a.CronID)
	kv = appendID(kv, "run_id", a.RunID)
	if a.Step != "" {
		kv = append(kv, "step", a.Step)
	}
	// A purge that removed nothing still says so.
	if a.Count != 0 || a.Kind == ext.ActionDLQPurged {
		kv = append(kv, "count", a.Count)
	}

	return e.record(ctx, m.action, m.severity, OutcomeSuccess,
		m.resource, operatorResourceID(m.resource, a), CategoryOperator, nil,
		kv...,
	)
}

// operatorResourceID picks the ID of the thing the action was taken on.
// A DLQ purge acts on no single entry, so its DLQID is nil and this
// returns "".
func operatorResourceID(resource string, a ext.Action) string {
	switch resource {
	case ResourceJob:
		return a.JobID.String()
	case ResourceDLQ:
		return a.DLQID.String()
	case ResourceCron:
		return a.CronID.String()
	case ResourceWorkflow:
		return a.RunID.String()
	default:
		return ""
	}
}

// appendID adds key and the ID's string to kv, unless the ID is nil.
func appendID(kv []any, key string, v id.ID) []any {
	if v.IsNil() {
		return kv
	}
	return append(kv, key, v.String())
}

// ── Internal helpers ────────────────────────────────
```

- [ ] **Step 12: Update the audit_hook docs**

In `audit_hook/options.go`, the `WithActions` comment:

Find:

```go
// By default all 12 actions are enabled. Unknown actions are silently ignored.
```

Replace with:

```go
// By default every action in AllActions is enabled. Unknown actions are
// silently ignored.
```

In `audit_hook/doc.go`:

Find:

```go
// terminal failures) and rich metadata (job name, queue, elapsed time, errors).
//
```

Replace with:

```go
// terminal failures) and rich metadata (job name, queue, elapsed time, errors).
//
// Operator actions taken through the engine (cancel, retry, DLQ replay,
// delete and purge, cron enable, disable, delete and trigger, workflow
// replay) are recorded under [CategoryOperator], with actions such as
// [ActionOperatorJobCancelled]. The acting subject is in Metadata["actor"].
//
```

- [ ] **Step 13: Run the audit_hook tests and see them pass**

Run: `gofmt -l audit_hook; go test ./audit_hook/`
Expected: no files from `gofmt -l`, then `ok  	github.com/xraph/dispatch/audit_hook`.

- [ ] **Step 14: Write the failing relay_hook tests**

Create `relay_hook/operator_test.go`. It reuses `newTestRelay`, `newTestJob` and `lastEvent` from `extension_test.go`:

```go
package relayhook_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	revent "github.com/xraph/relay/event"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	rh "github.com/xraph/dispatch/relay_hook"
)

// eventData round-trips an event's Data through JSON so a test sees the
// payload the way a webhook receiver would.
func eventData(t *testing.T, evt *revent.Event) map[string]any {
	t.Helper()
	raw, err := json.Marshal(evt.Data)
	if err != nil {
		t.Fatalf("marshal event data: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal event data: %v", err)
	}
	return out
}

func TestRelayHookExtension_JobCancelled(t *testing.T) {
	r := newTestRelay(t)
	h := rh.New(r)
	j := newTestJob()

	if err := h.OnJobCancelled(context.Background(), j); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	evt := lastEvent(t, r, rh.EventJobCancelled)
	if evt.TenantID != "org-1" {
		t.Errorf("TenantID: want %q, got %q", "org-1", evt.TenantID)
	}
	data := eventData(t, evt)
	if data["job_id"] != j.ID.String() {
		t.Errorf("data.job_id: want %q, got %v", j.ID.String(), data["job_id"])
	}
}

func TestRelayHookExtension_OperatorJobCancelled(t *testing.T) {
	r := newTestRelay(t)
	h := rh.New(r)
	jobID := id.NewJobID()
	at := time.Date(2026, 10, 7, 12, 30, 0, 0, time.UTC)

	err := h.OnOperatorAction(context.Background(), ext.Action{
		Kind:  ext.ActionJobCancelled,
		Actor: "user_42",
		JobID: jobID,
		At:    at,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	evt := lastEvent(t, r, rh.EventOperatorJobCancelled)
	// Operator actions are system-level, no tenant.
	if evt.TenantID != "" {
		t.Errorf("TenantID: want empty, got %q", evt.TenantID)
	}
	data := eventData(t, evt)
	want := map[string]any{
		"kind":   "job.cancelled",
		"actor":  "user_42",
		"job_id": jobID.String(),
		"at":     "2026-10-07T12:30:00Z",
	}
	for k, v := range want {
		if data[k] != v {
			t.Errorf("data.%s: want %v, got %v", k, v, data[k])
		}
	}
	for _, absent := range []string{"new_job_id", "dlq_id", "cron_id", "run_id", "step", "count"} {
		if v, ok := data[absent]; ok {
			t.Errorf("data.%s: want absent for a cancel, got %v", absent, v)
		}
	}
}

func TestRelayHookExtension_OperatorActionsUseRegisteredTypes(t *testing.T) {
	cases := map[ext.ActionKind]string{
		ext.ActionJobCancelled:     rh.EventOperatorJobCancelled,
		ext.ActionJobRetried:       rh.EventOperatorJobRetried,
		ext.ActionDLQReplayed:      rh.EventOperatorDLQReplayed,
		ext.ActionDLQDeleted:       rh.EventOperatorDLQDeleted,
		ext.ActionDLQPurged:        rh.EventOperatorDLQPurged,
		ext.ActionCronEnabled:      rh.EventOperatorCronEnabled,
		ext.ActionCronDisabled:     rh.EventOperatorCronDisabled,
		ext.ActionCronDeleted:      rh.EventOperatorCronDeleted,
		ext.ActionCronTriggered:    rh.EventOperatorCronTriggered,
		ext.ActionWorkflowReplayed: rh.EventOperatorWorkflowReplayed,
	}

	r := newTestRelay(t)
	h := rh.New(r)
	ctx := context.Background()

	for kind, eventType := range cases {
		if err := h.OnOperatorAction(ctx, ext.Action{Kind: kind, At: time.Now().UTC()}); err != nil {
			t.Errorf("%s: unexpected error: %v", kind, err)
			continue
		}
		evt := lastEvent(t, r, eventType)
		if got := eventData(t, evt)["kind"]; got != string(kind) {
			t.Errorf("%s: data.kind = %v", eventType, got)
		}
	}
}

func TestRelayHookExtension_OperatorActionUnknownKindErrors(t *testing.T) {
	r := newTestRelay(t)
	h := rh.New(r)

	// No catalog entry exists for a kind this version does not know, so
	// Relay refuses it and the registry logs the error.
	if err := h.OnOperatorAction(context.Background(), ext.Action{Kind: "queue.paused"}); err == nil {
		t.Fatal("want an error for an unregistered operator event type")
	}
}

func TestRelayHookExtension_OperatorActionViaRegistryTakesActorFromContext(t *testing.T) {
	r := newTestRelay(t)
	reg := ext.NewRegistry(log.NewNoopLogger())
	reg.Register(rh.New(r))

	ctx := ext.WithActor(context.Background(), "user_9")
	reg.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionDLQPurged, Count: 5})

	data := eventData(t, lastEvent(t, r, rh.EventOperatorDLQPurged))
	if data["actor"] != "user_9" {
		t.Errorf("data.actor: want %q, got %v", "user_9", data["actor"])
	}
	// JSON numbers decode as float64.
	if data["count"] != float64(5) {
		t.Errorf("data.count: want 5, got %v", data["count"])
	}
	if at, ok := data["at"].(string); !ok || at == "" {
		t.Errorf("data.at: want the registry's default time, got %v", data["at"])
	}
}
```

- [ ] **Step 15: Run them and see them fail**

Run: `go test ./relay_hook/`
Expected: a build failure that starts:

```text
# github.com/xraph/dispatch/relay_hook_test [github.com/xraph/dispatch/relay_hook.test]
relay_hook/operator_test.go:38:14: h.OnJobCancelled undefined (type *relayhook.Extension has no field or method OnJobCancelled)
relay_hook/operator_test.go:42:28: undefined: rh.EventJobCancelled
relay_hook/operator_test.go:58:11: h.OnOperatorAction undefined (type *relayhook.Extension has no field or method OnOperatorAction)
```

- [ ] **Step 16: Add the relay event types and their catalog definitions**

Relay refuses to send an event type that is not in its catalog, so every new type also needs a definition in `AllDefinitions`. The new definitions use version `2026-10-07`; the existing ones stay at `2025-01-01`.

In `relay_hook/events.go`:

Find:

```go
	EventJobDLQ                = "dispatch.job.dlq"
```

Replace with:

```go
	EventJobDLQ                = "dispatch.job.dlq"
	EventJobCancelled          = "dispatch.job.cancelled"
```

Add the operator event types after the first `const` block:

Find:

```go
	EventCronFired             = "dispatch.cron.fired"
)
```

Replace with:

```go
	EventCronFired             = "dispatch.cron.fired"
)

// Operator action event types. Each constant maps to one ext.ActionKind.
// They sit under dispatch.operator so a subscriber can tell an operator's
// cancel apart from the dispatch.job.cancelled lifecycle event it causes.
const (
	EventOperatorJobCancelled     = "dispatch.operator.job_cancelled"
	EventOperatorJobRetried       = "dispatch.operator.job_retried"
	EventOperatorDLQReplayed      = "dispatch.operator.dlq_replayed"
	EventOperatorDLQDeleted       = "dispatch.operator.dlq_deleted"
	EventOperatorDLQPurged        = "dispatch.operator.dlq_purged"
	EventOperatorCronEnabled      = "dispatch.operator.cron_enabled"
	EventOperatorCronDisabled     = "dispatch.operator.cron_disabled"
	EventOperatorCronDeleted      = "dispatch.operator.cron_deleted"
	EventOperatorCronTriggered    = "dispatch.operator.cron_triggered"
	EventOperatorWorkflowReplayed = "dispatch.operator.workflow_replayed"
)
```

In `AllDefinitions`, add the cancelled definition after the DLQ one:

Find:

```go
		{
			Name:        EventJobDLQ,
			Description: "Fired when a job is moved to the dead letter queue.",
			Group:       "jobs",
			Version:     "2025-01-01",
		},
```

Replace with:

```go
		{
			Name:        EventJobDLQ,
			Description: "Fired when a job is moved to the dead letter queue.",
			Group:       "jobs",
			Version:     "2025-01-01",
		},
		{
			Name:        EventJobCancelled,
			Description: "Fired when a job reaches cancelled.",
			Group:       "jobs",
			Version:     "2026-10-07",
		},
```

And the operator definitions after the cron one, closing the list:

Find:

```go
		{
			Name:        EventCronFired,
			Description: "Fired when a cron entry fires and enqueues a job.",
			Group:       "cron",
			Version:     "2025-01-01",
		},
	}
}
```

Replace with:

```go
		{
			Name:        EventCronFired,
			Description: "Fired when a cron entry fires and enqueues a job.",
			Group:       "cron",
			Version:     "2025-01-01",
		},
		// ── Operator events ────────────────────────────
		{
			Name:        EventOperatorJobCancelled,
			Description: "Fired when an operator cancels a job.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorJobRetried,
			Description: "Fired when an operator retries a failed job.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorDLQReplayed,
			Description: "Fired when an operator replays a dead letter queue entry.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorDLQDeleted,
			Description: "Fired when an operator deletes a dead letter queue entry.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorDLQPurged,
			Description: "Fired when an operator purges old dead letter queue entries.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorCronEnabled,
			Description: "Fired when an operator enables a cron entry.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorCronDisabled,
			Description: "Fired when an operator disables a cron entry.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorCronDeleted,
			Description: "Fired when an operator deletes a cron entry.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorCronTriggered,
			Description: "Fired when an operator triggers a cron entry by hand.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
		{
			Name:        EventOperatorWorkflowReplayed,
			Description: "Fired when an operator replays a workflow run from a step.",
			Group:       "operator",
			Version:     "2026-10-07",
		},
	}
}
```

- [ ] **Step 17: Implement both hooks in `relay_hook/extension.go`**

Add `strings` to the imports:

Find:

```go
import (
	"context"
	"time"
```

Replace with:

```go
import (
	"context"
	"strings"
	"time"
```

Replace the compile-time check block (gofmt realigns it, as in audit_hook):

Find:

```go
// Compile-time interface checks.
var (
	_ ext.Extension             = (*Extension)(nil)
	_ ext.JobEnqueued           = (*Extension)(nil)
	_ ext.JobStarted            = (*Extension)(nil)
	_ ext.JobCompleted          = (*Extension)(nil)
	_ ext.JobFailed             = (*Extension)(nil)
	_ ext.JobRetrying           = (*Extension)(nil)
	_ ext.JobDLQ                = (*Extension)(nil)
	_ ext.WorkflowStarted       = (*Extension)(nil)
	_ ext.WorkflowStepCompleted = (*Extension)(nil)
	_ ext.WorkflowStepFailed    = (*Extension)(nil)
	_ ext.WorkflowCompleted     = (*Extension)(nil)
	_ ext.WorkflowFailed        = (*Extension)(nil)
	_ ext.CronFired             = (*Extension)(nil)
)
```

Replace with:

```go
// Compile-time interface checks.
var (
	_ ext.Extension              = (*Extension)(nil)
	_ ext.JobEnqueued            = (*Extension)(nil)
	_ ext.JobStarted             = (*Extension)(nil)
	_ ext.JobCompleted           = (*Extension)(nil)
	_ ext.JobFailed              = (*Extension)(nil)
	_ ext.JobRetrying            = (*Extension)(nil)
	_ ext.JobDLQ                 = (*Extension)(nil)
	_ ext.JobCancelled           = (*Extension)(nil)
	_ ext.WorkflowStarted        = (*Extension)(nil)
	_ ext.WorkflowStepCompleted  = (*Extension)(nil)
	_ ext.WorkflowStepFailed     = (*Extension)(nil)
	_ ext.WorkflowCompleted      = (*Extension)(nil)
	_ ext.WorkflowFailed         = (*Extension)(nil)
	_ ext.CronFired              = (*Extension)(nil)
	_ ext.OperatorActionObserver = (*Extension)(nil)
)
```

Add `OnJobCancelled` after `OnJobDLQ`. It sends the same payload as `dispatch.job.enqueued`:

Find:

```go
// ── Workflow lifecycle hooks ────────────────────────
```

Replace with:

```go
// OnJobCancelled implements ext.JobCancelled.
func (h *Extension) OnJobCancelled(ctx context.Context, j *job.Job) error {
	return h.send(ctx, EventJobCancelled, j.ScopeOrgID, newJobPayload(j))
}

// ── Workflow lifecycle hooks ────────────────────────
```

Add the operator section above the internal helpers marker:

Find:

```go
// ── Internal helpers ────────────────────────────────
```

Replace with:

```go
// ── Operator actions ────────────────────────────────

// operatorEvents maps each operator action kind to its event type.
var operatorEvents = map[ext.ActionKind]string{
	ext.ActionJobCancelled:     EventOperatorJobCancelled,
	ext.ActionJobRetried:       EventOperatorJobRetried,
	ext.ActionDLQReplayed:      EventOperatorDLQReplayed,
	ext.ActionDLQDeleted:       EventOperatorDLQDeleted,
	ext.ActionDLQPurged:        EventOperatorDLQPurged,
	ext.ActionCronEnabled:      EventOperatorCronEnabled,
	ext.ActionCronDisabled:     EventOperatorCronDisabled,
	ext.ActionCronDeleted:      EventOperatorCronDeleted,
	ext.ActionCronTriggered:    EventOperatorCronTriggered,
	ext.ActionWorkflowReplayed: EventOperatorWorkflowReplayed,
}

// OnOperatorAction implements ext.OperatorActionObserver. Operator events
// are system-level, like cron events, so they carry no tenant. A kind
// this version does not know becomes "dispatch.operator." plus the kind
// with its dots turned into underscores; it has no catalog entry, so
// Relay refuses it and the registry logs the error.
func (h *Extension) OnOperatorAction(ctx context.Context, a ext.Action) error {
	eventType, ok := operatorEvents[a.Kind]
	if !ok {
		eventType = "dispatch.operator." + strings.ReplaceAll(string(a.Kind), ".", "_")
	}
	return h.send(ctx, eventType, "", newOperatorPayload(a))
}

// ── Internal helpers ────────────────────────────────
```

At the end of the file, after `cronPayload`, add the operator payload:

Find:

```go
type cronPayload struct {
	EntryName string `json:"entry_name"`
	JobID     string `json:"job_id"`
}
```

Replace with:

```go
type cronPayload struct {
	EntryName string `json:"entry_name"`
	JobID     string `json:"job_id"`
}

type operatorPayload struct {
	Kind     string `json:"kind"`
	Actor    string `json:"actor,omitempty"`
	JobID    string `json:"job_id,omitempty"`
	NewJobID string `json:"new_job_id,omitempty"`
	DLQID    string `json:"dlq_id,omitempty"`
	CronID   string `json:"cron_id,omitempty"`
	RunID    string `json:"run_id,omitempty"`
	Step     string `json:"step,omitempty"`
	Count    *int64 `json:"count,omitempty"`
	At       string `json:"at,omitempty"`
}

// newOperatorPayload leaves out every field that does not apply to the
// action. Nil IDs already print as "". Count is a pointer so that a purge
// which removed nothing still sends "count": 0.
func newOperatorPayload(a ext.Action) *operatorPayload {
	p := &operatorPayload{
		Kind:     string(a.Kind),
		Actor:    a.Actor,
		JobID:    a.JobID.String(),
		NewJobID: a.NewJobID.String(),
		DLQID:    a.DLQID.String(),
		CronID:   a.CronID.String(),
		RunID:    a.RunID.String(),
		Step:     a.Step,
	}
	if a.Count != 0 || a.Kind == ext.ActionDLQPurged {
		count := a.Count
		p.Count = &count
	}
	if !a.At.IsZero() {
		p.At = a.At.Format(time.RFC3339)
	}
	return p
}
```

In `relay_hook/options.go`, the `WithEvents` comment:

Find:

```go
// By default all 12 event types are enabled. Unknown types are silently
// ignored.
```

Replace with:

```go
// By default every event type in AllDefinitions is enabled. Unknown types
// are silently ignored.
```

- [ ] **Step 18: Run the relay_hook tests and see them pass**

Run: `gofmt -l relay_hook; go test ./relay_hook/`
Expected: no files from `gofmt -l`, then `ok  	github.com/xraph/dispatch/relay_hook`.

- [ ] **Step 19: Write the failing stream test**

The broker is registered as an ordinary extension by `engine.WithStreamBroker` (`eng.extensions.Register(eng.broker)` in `engine/engine.go`), so implementing `ext.JobCancelled` on it is all the wiring it needs. Create `stream/cancel_test.go` (package `stream`, like the existing broker tests, so it can use `testLogger`):

```go
package stream

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

func TestBrokerJobCancelledReachesJobTopics(t *testing.T) {
	t.Parallel()

	b := NewBroker(testLogger())
	j := &job.Job{
		ID:         id.NewJobID(),
		Name:       "send-email",
		Queue:      "default",
		ScopeAppID: "app-1",
		ScopeOrgID: "org-1",
	}

	// The same topics job.failed reaches: the job's own topic, all jobs,
	// and the firehose.
	subs := []*Subscriber{
		b.Subscribe("job-sub", JobTopic(j.ID.String())),
		b.Subscribe("jobs-sub", TopicJobs),
		b.Subscribe("firehose-sub", TopicFirehose),
	}

	if err := b.OnJobCancelled(context.Background(), j); err != nil {
		t.Fatalf("OnJobCancelled: %v", err)
	}

	for _, sub := range subs {
		select {
		case evt := <-sub.C():
			if evt.Type != EventJobCancelled {
				t.Errorf("%s: Type = %q, want %q", sub.ID(), evt.Type, EventJobCancelled)
			}
			if evt.Topic != JobTopic(j.ID.String()) {
				t.Errorf("%s: Topic = %q, want %q", sub.ID(), evt.Topic, JobTopic(j.ID.String()))
			}
			var data JobEventData
			if err := json.Unmarshal(evt.Data, &data); err != nil {
				t.Fatalf("%s: decode data: %v", sub.ID(), err)
			}
			if data.JobID != j.ID.String() || data.JobName != "send-email" || data.Queue != "default" {
				t.Errorf("%s: data = %+v", sub.ID(), data)
			}
		case <-time.After(time.Second):
			t.Fatalf("%s: timed out waiting for job.cancelled", sub.ID())
		}
	}
}
```

Run: `go test ./stream/`
Expected: a build failure that starts:

```text
# github.com/xraph/dispatch/stream [github.com/xraph/dispatch/stream.test]
stream/cancel_test.go:33:14: b.OnJobCancelled undefined (type *Broker has no field or method OnJobCancelled)
stream/cancel_test.go:40:19: undefined: EventJobCancelled
stream/cancel_test.go:41:60: undefined: EventJobCancelled
```

- [ ] **Step 20: Publish job.cancelled from the broker**

In `stream/event.go`:

Find:

```go
	EventJobDLQ       EventType = "job.dlq"
```

Replace with:

```go
	EventJobDLQ       EventType = "job.dlq"
	EventJobCancelled EventType = "job.cancelled"
```

In `stream/broker.go`, the compile-time checks (no realignment here, `JobCancelled` is shorter than `WorkflowStepCompleted`):

Find:

```go
	_ ext.JobDLQ                = (*Broker)(nil)
```

Replace with:

```go
	_ ext.JobDLQ                = (*Broker)(nil)
	_ ext.JobCancelled          = (*Broker)(nil)
```

Add `OnJobCancelled` after `OnJobDLQ`. `resolveTopics` already routes any `job.` type to `jobs` and the firehose, plus the event's own `job:<id>` topic, so this reaches exactly the subscribers `job.failed` reaches. Operator actions are not published here.

Find:

```go
// ── Workflow lifecycle hooks ────────────────────────
```

Replace with:

```go
// OnJobCancelled implements ext.JobCancelled. It goes to the same topics
// as job.failed: the job's own topic, jobs, and the firehose.
func (b *Broker) OnJobCancelled(_ context.Context, j *job.Job) error {
	b.publish(&Event{
		Type:      EventJobCancelled,
		Timestamp: time.Now().UTC(),
		Topic:     JobTopic(j.ID.String()),
		Data: mustMarshal(JobEventData{
			JobID:      j.ID.String(),
			JobName:    j.Name,
			Queue:      j.Queue,
			ScopeAppID: j.ScopeAppID,
			ScopeOrgID: j.ScopeOrgID,
		}),
	})
	return nil
}

// ── Workflow lifecycle hooks ────────────────────────
```

Run: `gofmt -l stream; go test ./stream/`
Expected: no files from `gofmt -l`, then `ok  	github.com/xraph/dispatch/stream`.

- [ ] **Step 21: Gate**

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./ext/... ./audit_hook/... ./relay_hook/... ./stream/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: the build succeeds, the first command prints no FAIL lines, the race run prints four `ok` lines (`ext`, `audit_hook`, `relay_hook`, `stream`), and lint prints `0 issues.` This was run on 2026-10-07 against f7a4d4e: every package `ok`, including the store backends, race clean, `0 issues.`

- [ ] **Step 22: Commit**

```bash
git add ext/operator_test.go audit_hook/operator_test.go relay_hook/operator_test.go stream/cancel_test.go
git commit --only -m "feat(ext): add job cancelled and operator action hooks

Two new hooks, so the engine can say when a job ends up cancelled and
when an operator did something to it. JobCancelled fires once a job
reaches cancelled. OperatorActionObserver gets one Action per operator
call, with the actor read from the context through WithActor and the
time filled in when the caller leaves it zero.

audit_hook records both. Operator actions land under dispatch.operator
as operator.job_cancelled and the like, with the actor in metadata
because the audit event has no field for it. relay_hook sends
dispatch.job.cancelled and dispatch.operator.* webhooks. The stream
broker publishes job.cancelled to the same topics as job.failed.
Nothing calls the emitters yet. The engine tasks do that." -- ext/doc.go ext/ext.go ext/registry.go ext/operator_test.go audit_hook/doc.go audit_hook/events.go audit_hook/extension.go audit_hook/extension_test.go audit_hook/options.go audit_hook/operator_test.go relay_hook/events.go relay_hook/extension.go relay_hook/options.go relay_hook/operator_test.go stream/broker.go stream/event.go stream/cancel_test.go
git show --stat HEAD | tail -18
```

Expected last line: `17 files changed, 1109 insertions(+), 32 deletions(-)`.

---

### Task 8a: Cancel and retry jobs through the engine

Cancel and retry live in the REST handlers today, as a read and an unfenced write each. Cancel refuses a running job outright, and retry ignores the dead letter entry, so you can retry a job and replay its entry and get the same failure run twice. This task moves both into the engine. `CancelJob` handles pending, retrying and running jobs; a running one is written cancelled through the lease fence, and the worker learns about it through the lease it already renews. `RetryJob` claims the job's dead letter entry before it resets the job, so a later replay of that entry is refused.

Writing the running case exposed a bug in the worker that has nothing to do with cancel. When a renewal comes back `job.ErrLeaseLost`, the pool cancels the attempt's context with that cause, and the runner then makes its terminal write through that cancelled context. Memory ignores the context, so every existing test passes. Postgres, SQLite, Mongo and Redis all fail the write as `context.Canceled` first, which no call site routes to `abandonLostLease`, so a lost lease reported nothing at all on a real backend (checked on SQLite on 2026-10-07: `UpdateLeasedJob` and `GetJob` on a cancelled context both return `context canceled`). The runner now abandons as soon as it sees that cause, and `abandonLostLease` reads the row on a detached context to tell a cancel from a reclaim.

**Files:**
- Create: `engine/ops.go`
- Create: `engine/ops_test.go`
- Modify: `worker/runner.go` (the `Execute` doc comment's last bullet, about line 242; a check after `elapsed := time.Since(start)` in `Execute`, about line 268; `abandonLostLease`, about lines 987 to 1000)
- Create: `worker/cancel_test.go`

**Interfaces:**
- Consumes: `job.LeaseStore.UpdateLeasedJob` (applies only while the row is running, held by that worker, at that epoch, else `job.ErrLeaseLost`), `dlq.ReplayClaimer` (`GetDLQByJobID`, `ClaimReplay`, `ReleaseReplay`, all on `dlq.Store` since Task 6), `ext.Registry.EmitJobCancelled`, `ext.Registry.EmitOperatorAction` (fills `Actor` from `ext.ActorFrom(ctx)` and a zero `At`), `ext.WithActor`.
- Produces:

```go
package engine
func (eng *Engine) CancelJob(ctx context.Context, jobID id.JobID) (*job.Job, error)
// pending, retrying -> cancelled now, EmitJobCancelled. running -> cancelled through
// UpdateLeasedJob(j, j.WorkerID, j.LeaseEpoch) (UpdateJob when the store has no lease
// capability or the job no WorkerID); a refused fenced write re-reads, up to 3 reads.
// completed, failed, cancelled -> wraps dispatch.ErrInvalidState. Unknown -> dispatch.ErrJobNotFound.
// Emits one ext.ActionJobCancelled {JobID} on success.

func (eng *Engine) RetryJob(ctx context.Context, jobID id.JobID) (*job.Job, error)
// failed only, else wraps dispatch.ErrInvalidState. GetDLQByJobID -> ClaimReplay(entry, jobID)
// (wraps dispatch.ErrDLQAlreadyReplayed when taken); no entry, or an entry deleted before the
// claim, retries without one. Reset: pending, RetryCount 0, LastError "", RunAt now,
// CompletedAt nil, ClearOwnership. UpdateJob failure -> ReleaseReplay. pool.Wake.
// Emits one ext.ActionJobRetried {JobID, DLQID: the claimed entry or nil} on success.
```

Worker behaviour after this task: `Runner.Execute` returns `abandonLostLease(ctx, j, cause)` without writing whenever `context.Cause(ctx)` is `job.ErrLeaseLost`. `abandonLostLease` reads the row (detached from cancellation, 5 second timeout) and emits `EmitJobCancelled(row)` when it is cancelled, else `EmitJobFailed` as before. Both emits now get the detached context.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- engine worker && git log -1 --oneline`
Expected: no output from `git status` for those directories, and the last commit is Task 7's or a later one in this plan. If another session has uncommitted edits there, stop and report.

- [ ] **Step 2: Write the failing engine tests**

Create `engine/ops_test.go`. The recorder and the `putJobInState` / `pushFailed` helpers are reused by Task 8b's tests, so keep their names.

```go
package engine_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/memory"
)

// jobOpsRecorder records what the operator methods report: every
// OperatorAction, and which jobs reached OnJobCancelled and OnJobFailed.
type jobOpsRecorder struct {
	mu        sync.Mutex
	actions   []ext.Action
	cancelled []*job.Job
	failed    []id.JobID
}

func (r *jobOpsRecorder) Name() string { return "job-ops-recorder" }

func (r *jobOpsRecorder) OnOperatorAction(_ context.Context, a ext.Action) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.actions = append(r.actions, a)
	return nil
}

func (r *jobOpsRecorder) OnJobCancelled(_ context.Context, j *job.Job) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cancelled = append(r.cancelled, j)
	return nil
}

func (r *jobOpsRecorder) OnJobFailed(_ context.Context, j *job.Job, _ error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.failed = append(r.failed, j.ID)
	return nil
}

func (r *jobOpsRecorder) snapshot() (actions []ext.Action, cancelled []*job.Job, failed []id.JobID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ext.Action(nil), r.actions...),
		append([]*job.Job(nil), r.cancelled...),
		append([]id.JobID(nil), r.failed...)
}

// newJobOpsEngine builds an engine over st with the recorder registered
// and the pool not started.
func newJobOpsEngine(t *testing.T, st dispatch.Storer, opts ...dispatch.Option) (*engine.Engine, *jobOpsRecorder) {
	t.Helper()

	all := append([]dispatch.Option{dispatch.WithStore(st)}, opts...)
	d, err := dispatch.New(all...)
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}

	rec := &jobOpsRecorder{}
	eng, err := engine.Build(d, engine.WithExtension(rec))
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}

	return eng, rec
}

// putJobInState enqueues a job and moves it straight to state, without
// a worker.
func putJobInState(t *testing.T, eng *engine.Engine, s *memory.Store, state job.State) *job.Job {
	t.Helper()

	j, err := eng.EnqueueRaw(context.Background(), "ops-job", []byte(`{}`))
	if err != nil {
		t.Fatalf("EnqueueRaw: %v", err)
	}
	if state == job.StatePending {
		return j
	}

	j.State = state
	j.LastError = "boom"
	j.RetryCount = 3
	if err := s.UpdateJob(context.Background(), j); err != nil {
		t.Fatalf("UpdateJob: %v", err)
	}

	return j
}

// pushFailed puts j in failed and gives it a dead letter entry, the way
// the runner leaves a job that ran out of retries.
func pushFailed(t *testing.T, eng *engine.Engine, s *memory.Store) (*job.Job, id.DLQID) {
	t.Helper()

	j := putJobInState(t, eng, s, job.StateFailed)
	if err := eng.DLQService().Push(context.Background(), j, errors.New("boom")); err != nil {
		t.Fatalf("Push: %v", err)
	}

	entry, err := s.GetDLQByJobID(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	return j, entry.ID
}

func TestCancelJob_PendingAndRetrying(t *testing.T) {
	for _, state := range []job.State{job.StatePending, job.StateRetrying} {
		t.Run(string(state), func(t *testing.T) {
			s := memory.New()
			eng, rec := newJobOpsEngine(t, s)
			j := putJobInState(t, eng, s, state)

			ctx := ext.WithActor(context.Background(), "alice")
			got, err := eng.CancelJob(ctx, j.ID)
			if err != nil {
				t.Fatalf("CancelJob: %v", err)
			}
			if got.State != job.StateCancelled || got.CompletedAt == nil {
				t.Errorf("returned job: state %s, completed_at %v; want cancelled with a time",
					got.State, got.CompletedAt)
			}

			stored, err := s.GetJob(context.Background(), j.ID)
			if err != nil {
				t.Fatalf("GetJob: %v", err)
			}
			if stored.State != job.StateCancelled {
				t.Errorf("stored state = %s, want cancelled", stored.State)
			}

			actions, cancelled, failed := rec.snapshot()
			if len(cancelled) != 1 || cancelled[0].ID != j.ID {
				t.Errorf("OnJobCancelled saw %d jobs, want exactly %s", len(cancelled), j.ID)
			}
			if len(failed) != 0 {
				t.Errorf("OnJobFailed fired %d times, want 0", len(failed))
			}
			if len(actions) != 1 {
				t.Fatalf("got %d operator actions, want 1", len(actions))
			}
			a := actions[0]
			if a.Kind != ext.ActionJobCancelled || a.JobID != j.ID || a.Actor != "alice" || a.At.IsZero() {
				t.Errorf("action = %+v, want job.cancelled for %s by alice with a time", a, j.ID)
			}
		})
	}
}

func TestCancelJob_TerminalStatesAreRefused(t *testing.T) {
	for _, state := range []job.State{job.StateCompleted, job.StateFailed, job.StateCancelled} {
		t.Run(string(state), func(t *testing.T) {
			s := memory.New()
			eng, rec := newJobOpsEngine(t, s)
			j := putJobInState(t, eng, s, state)

			_, err := eng.CancelJob(context.Background(), j.ID)
			if !errors.Is(err, dispatch.ErrInvalidState) {
				t.Fatalf("CancelJob error = %v, want ErrInvalidState", err)
			}

			stored, err := s.GetJob(context.Background(), j.ID)
			if err != nil {
				t.Fatalf("GetJob: %v", err)
			}
			if stored.State != state {
				t.Errorf("stored state = %s, want it left at %s", stored.State, state)
			}

			actions, cancelled, _ := rec.snapshot()
			if len(actions) != 0 || len(cancelled) != 0 {
				t.Errorf("a refused cancel emitted %d actions and %d cancellations, want none",
					len(actions), len(cancelled))
			}
		})
	}
}

func TestCancelJob_UnknownJob(t *testing.T) {
	eng, rec := newJobOpsEngine(t, memory.New())

	_, err := eng.CancelJob(context.Background(), id.NewJobID())
	if !errors.Is(err, dispatch.ErrJobNotFound) {
		t.Fatalf("CancelJob error = %v, want ErrJobNotFound", err)
	}
	if actions, _, _ := rec.snapshot(); len(actions) != 0 {
		t.Errorf("got %d operator actions for an unknown job, want 0", len(actions))
	}
}

// TestCancelJob_Running cancels a job a real pool is running. The handler
// blocks until its context ends, so the only way out is the cancel
// reaching it through the lease.
func TestCancelJob_Running(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s,
		dispatch.WithConcurrency(1),
		dispatch.WithQueues([]string{"default"}),
		dispatch.WithPollInterval(10*time.Millisecond),
		dispatch.WithHeartbeatInterval(20*time.Millisecond),
	)

	started := make(chan struct{})
	causes := make(chan error, 1)
	engine.Register(eng, job.NewDefinition("ops-block", func(ctx context.Context, _ struct{}) error {
		close(started)
		<-ctx.Done()
		causes <- context.Cause(ctx)
		return ctx.Err()
	}))

	j, err := eng.EnqueueRaw(context.Background(), "ops-block", []byte(`{}`))
	if err != nil {
		t.Fatalf("EnqueueRaw: %v", err)
	}

	if startErr := eng.Start(context.Background()); startErr != nil {
		t.Fatalf("Start: %v", startErr)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = eng.Stop(ctx)
	})

	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("handler never started")
	}

	got, err := eng.CancelJob(ext.WithActor(context.Background(), "bob"), j.ID)
	if err != nil {
		t.Fatalf("CancelJob: %v", err)
	}
	if got.State != job.StateCancelled {
		t.Errorf("returned state = %s, want cancelled", got.State)
	}

	select {
	case cause := <-causes:
		if !errors.Is(cause, job.ErrLeaseLost) {
			t.Errorf("handler context cause = %v, want job.ErrLeaseLost", cause)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the handler's context was not cancelled after CancelJob")
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		_, cancelled, _ := rec.snapshot()
		if len(cancelled) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("OnJobCancelled never fired for the running job")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Several heartbeats later the row must still say cancelled: the
	// worker's own terminal write was refused, not merely late.
	time.Sleep(100 * time.Millisecond)

	stored, err := s.GetJob(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if stored.State != job.StateCancelled || stored.CompletedAt == nil {
		t.Errorf("stored job: state %s, completed_at %v; want cancelled with a time",
			stored.State, stored.CompletedAt)
	}

	actions, cancelled, failed := rec.snapshot()
	if len(cancelled) != 1 || cancelled[0].ID != j.ID || cancelled[0].State != job.StateCancelled {
		t.Errorf("OnJobCancelled saw %d jobs, want one, %s, in state cancelled", len(cancelled), j.ID)
	}
	if len(failed) != 0 {
		t.Errorf("OnJobFailed fired for %v, want never: a cancel is not a failure", failed)
	}
	if len(actions) != 1 || actions[0].Kind != ext.ActionJobCancelled || actions[0].Actor != "bob" {
		t.Errorf("actions = %+v, want one job.cancelled by bob", actions)
	}
}

func TestRetryJob_ClaimsTheDLQEntry(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	j, entryID := pushFailed(t, eng, s)

	got, err := eng.RetryJob(ext.WithActor(context.Background(), "carol"), j.ID)
	if err != nil {
		t.Fatalf("RetryJob: %v", err)
	}

	stored, err := s.GetJob(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	for _, c := range []*job.Job{got, stored} {
		if c.State != job.StatePending || c.RetryCount != 0 || c.LastError != "" ||
			c.CompletedAt != nil || c.StartedAt != nil || !c.WorkerID.IsNil() {
			t.Errorf("job after retry = state %s retries %d error %q completed %v started %v worker %s; "+
				"want a clean pending job", c.State, c.RetryCount, c.LastError, c.CompletedAt, c.StartedAt, c.WorkerID)
		}
	}

	entry, err := s.GetDLQ(context.Background(), entryID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if entry.ReplayedAt == nil || entry.ReplayedJobID == nil || *entry.ReplayedJobID != j.ID {
		t.Errorf("entry after retry: replayed_at %v replayed_job_id %v; want claimed for %s",
			entry.ReplayedAt, entry.ReplayedJobID, j.ID)
	}

	actions, _, _ := rec.snapshot()
	if len(actions) != 1 {
		t.Fatalf("got %d operator actions, want 1", len(actions))
	}
	a := actions[0]
	if a.Kind != ext.ActionJobRetried || a.JobID != j.ID || a.DLQID != entryID || a.Actor != "carol" {
		t.Errorf("action = %+v, want job.retried for %s with entry %s by carol", a, j.ID, entryID)
	}
}

func TestRetryJob_WithoutADLQEntry(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	j := putJobInState(t, eng, s, job.StateFailed)

	if _, err := eng.RetryJob(context.Background(), j.ID); err != nil {
		t.Fatalf("RetryJob: %v", err)
	}

	stored, err := s.GetJob(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if stored.State != job.StatePending {
		t.Errorf("stored state = %s, want pending", stored.State)
	}

	actions, _, _ := rec.snapshot()
	if len(actions) != 1 || actions[0].Kind != ext.ActionJobRetried || !actions[0].DLQID.IsNil() {
		t.Errorf("actions = %+v, want one job.retried with no entry", actions)
	}
}

func TestRetryJob_OnlyFailedJobs(t *testing.T) {
	for _, state := range []job.State{
		job.StatePending, job.StateRunning, job.StateRetrying, job.StateCompleted, job.StateCancelled,
	} {
		t.Run(string(state), func(t *testing.T) {
			s := memory.New()
			eng, rec := newJobOpsEngine(t, s)
			j := putJobInState(t, eng, s, state)

			_, err := eng.RetryJob(context.Background(), j.ID)
			if !errors.Is(err, dispatch.ErrInvalidState) {
				t.Fatalf("RetryJob error = %v, want ErrInvalidState", err)
			}
			if actions, _, _ := rec.snapshot(); len(actions) != 0 {
				t.Errorf("a refused retry emitted %d actions, want 0", len(actions))
			}
		})
	}
}

func TestRetryJob_TwiceIsRefusedByTheClaim(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	j, _ := pushFailed(t, eng, s)

	if _, err := eng.RetryJob(context.Background(), j.ID); err != nil {
		t.Fatalf("first RetryJob: %v", err)
	}

	// Fail it again by hand without a new dead letter entry, so the only
	// thing standing between it and a second retry is the old claim.
	j.State = job.StateFailed
	if err := s.UpdateJob(context.Background(), j); err != nil {
		t.Fatalf("UpdateJob: %v", err)
	}

	_, err := eng.RetryJob(context.Background(), j.ID)
	if !errors.Is(err, dispatch.ErrDLQAlreadyReplayed) {
		t.Fatalf("second RetryJob error = %v, want ErrDLQAlreadyReplayed", err)
	}
	if actions, _, _ := rec.snapshot(); len(actions) != 1 {
		t.Errorf("got %d operator actions, want only the first retry's", len(actions))
	}
}

// failUpdateStore fails UpdateJob while fail is set.
type failUpdateStore struct {
	*memory.Store
	mu   sync.Mutex
	fail bool
}

var errOpsUpdate = errors.New("update refused by test")

func (f *failUpdateStore) setFail(v bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = v
}

func (f *failUpdateStore) UpdateJob(ctx context.Context, j *job.Job) error {
	f.mu.Lock()
	fail := f.fail
	f.mu.Unlock()
	if fail {
		return errOpsUpdate
	}
	return f.Store.UpdateJob(ctx, j)
}

func TestRetryJob_FailedWriteReleasesTheClaim(t *testing.T) {
	s := &failUpdateStore{Store: memory.New()}
	eng, rec := newJobOpsEngine(t, s)
	j, entryID := pushFailed(t, eng, s.Store)

	s.setFail(true)
	_, err := eng.RetryJob(context.Background(), j.ID)
	if !errors.Is(err, errOpsUpdate) {
		t.Fatalf("RetryJob error = %v, want the store's update error", err)
	}

	entry, err := s.GetDLQ(context.Background(), entryID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if entry.ReplayedAt != nil || entry.ReplayedJobID != nil {
		t.Errorf("entry after a failed retry: replayed_at %v replayed_job_id %v; want released",
			entry.ReplayedAt, entry.ReplayedJobID)
	}
	if actions, _, _ := rec.snapshot(); len(actions) != 0 {
		t.Errorf("a failed retry emitted %d actions, want 0", len(actions))
	}

	s.setFail(false)
	if _, err := eng.RetryJob(context.Background(), j.ID); err != nil {
		t.Fatalf("RetryJob after the store recovered: %v", err)
	}
}
```

- [ ] **Step 3: Run them and see them fail**

Run: `go vet ./engine/`
Expected: a compile failure that starts

```
vet: engine/ops_test.go:127:20: eng.CancelJob undefined (type *engine.Engine has no field or method CancelJob)
```

- [ ] **Step 4: Write the failing worker tests**

Create `worker/cancel_test.go`. `ctxStore` is the memory store made to honour a cancelled context, which is what exposes the bug described above.

```go
package worker_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch/backoff"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/worker"
)

// cancelTracker records which jobs reached OnJobCancelled and OnJobFailed.
type cancelTracker struct {
	mu        sync.Mutex
	cancelled []*job.Job
	failed    []id.JobID
}

func (c *cancelTracker) Name() string { return "cancel-tracker" }

func (c *cancelTracker) OnJobCancelled(_ context.Context, j *job.Job) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cancelled = append(c.cancelled, j)
	return nil
}

func (c *cancelTracker) OnJobFailed(_ context.Context, j *job.Job, _ error) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failed = append(c.failed, j.ID)
	return nil
}

func (c *cancelTracker) counts() (cancelled []*job.Job, failed int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]*job.Job(nil), c.cancelled...), len(c.failed)
}

// ctxStore is the memory store made to honour a cancelled context on
// the calls a runner makes, the way every persistent backend does. The
// memory store ignores ctx, which is how a lost-lease write through a
// cancelled context went unnoticed. It also counts job writes.
type ctxStore struct {
	*memory.Store
	writes atomic.Int32
}

func (s *ctxStore) GetJob(ctx context.Context, jobID id.JobID) (*job.Job, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.Store.GetJob(ctx, jobID)
}

func (s *ctxStore) UpdateJob(ctx context.Context, j *job.Job) error {
	s.writes.Add(1)
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.Store.UpdateJob(ctx, j)
}

func (s *ctxStore) UpdateLeasedJob(ctx context.Context, j *job.Job, workerID id.WorkerID, epoch int) error {
	s.writes.Add(1)
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.Store.UpdateLeasedJob(ctx, j, workerID, epoch)
}

// claimLeased enqueues one job named name and claims it with a lease,
// returning the claimed copy and the worker that holds it.
func claimLeased(t *testing.T, s *memory.Store, name string) (*job.Job, id.WorkerID) {
	t.Helper()
	ctx := context.Background()

	now := time.Now().UTC()
	j := &job.Job{
		ID:         id.NewJobID(),
		Name:       name,
		Queue:      "default",
		Payload:    []byte(`{}`),
		State:      job.StatePending,
		MaxRetries: 3,
		RunAt:      now,
	}
	j.CreatedAt = now
	j.UpdatedAt = now
	if err := s.EnqueueJob(ctx, j); err != nil {
		t.Fatalf("EnqueueJob: %v", err)
	}

	workerID := id.NewWorkerID()
	claimed, err := s.DequeueJobs(ctx, job.DequeueOpts{
		Queues:     []string{"default"},
		Limit:      1,
		WorkerID:   workerID,
		LeaseUntil: now.Add(time.Hour),
	})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("DequeueJobs: %v (n=%d)", err, len(claimed))
	}

	return claimed[0], workerID
}

// setStoredState rewrites the stored row's state the way an operator
// cancel (cancelled) or a reclaim (pending) would leave it.
func setStoredState(t *testing.T, s *memory.Store, jobID id.JobID, state job.State) {
	t.Helper()

	row, err := s.GetJob(context.Background(), jobID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	row.State = state
	if state == job.StateCancelled {
		now := time.Now().UTC()
		row.CompletedAt = &now
	}
	if err := s.UpdateJob(context.Background(), row); err != nil {
		t.Fatalf("UpdateJob: %v", err)
	}
}

func newCancelRunner(t *testing.T, st job.Store, name string, handler func(context.Context, struct{}) error) (*worker.Runner, *cancelTracker) {
	t.Helper()

	reg := job.NewRegistry()
	job.NewDefinition(name, handler).Register(reg)

	extensions := ext.NewRegistry(log.NewNoopLogger())
	tracker := &cancelTracker{}
	extensions.Register(tracker)

	runner := worker.NewRunner(
		reg, extensions, st, nil,
		backoff.NewConstant(time.Millisecond), nil, log.NewNoopLogger(),
	)

	return runner, tracker
}

// TestRunner_LeaseLostToACancelledRow_ReportsCancelled is an operator
// cancel landing while the handler runs and the handler finishing anyway:
// its terminal write is refused by the fence, and the runner must report
// the cancel it finds in the row, not a failure.
func TestRunner_LeaseLostToACancelledRow_ReportsCancelled(t *testing.T) {
	s := memory.New()
	j, workerID := claimLeased(t, s, "finishes.job")
	setStoredState(t, s, j.ID, job.StateCancelled)

	runner, tracker := newCancelRunner(t, s, "finishes.job",
		func(context.Context, struct{}) error { return nil })

	ctx := worker.WithLeaseFenceForTest(context.Background(), s, workerID, j.LeaseEpoch)
	if err := runner.Execute(ctx, j); !errors.Is(err, job.ErrLeaseLost) {
		t.Fatalf("Execute() = %v, want job.ErrLeaseLost", err)
	}

	cancelled, failed := tracker.counts()
	if len(cancelled) != 1 || cancelled[0].ID != j.ID || cancelled[0].State != job.StateCancelled {
		t.Errorf("OnJobCancelled saw %d jobs, want one, %s, in state cancelled", len(cancelled), j.ID)
	}
	if failed != 0 {
		t.Errorf("OnJobFailed fired %d times, want 0", failed)
	}

	stored, err := s.GetJob(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if stored.State != job.StateCancelled {
		t.Errorf("stored state = %s, want cancelled left alone", stored.State)
	}
}

// TestRunner_AttemptCancelledForALostLease_WritesNothing is the path the
// pool takes: a renewal came back ErrLeaseLost, so the attempt's context
// is cancelled with that cause before the handler returns. Through a
// store that honours the context, the old terminal write failed as
// context.Canceled and reported nothing at all.
func TestRunner_AttemptCancelledForALostLease_WritesNothing(t *testing.T) {
	tests := []struct {
		name          string
		rowState      job.State
		wantCancelled bool
	}{
		{name: "cancelled by an operator", rowState: job.StateCancelled, wantCancelled: true},
		{name: "reclaimed by the reaper", rowState: job.StatePending, wantCancelled: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &ctxStore{Store: memory.New()}
			j, workerID := claimLeased(t, s.Store, "blocks.job")
			setStoredState(t, s.Store, j.ID, tt.rowState)

			runner, tracker := newCancelRunner(t, s, "blocks.job",
				func(ctx context.Context, _ struct{}) error {
					<-ctx.Done()
					return ctx.Err()
				})

			ctx, cancel := context.WithCancelCause(context.Background())
			cancel(job.ErrLeaseLost)
			ctx = worker.WithLeaseFenceForTest(ctx, s, workerID, j.LeaseEpoch)

			if err := runner.Execute(ctx, j); !errors.Is(err, job.ErrLeaseLost) {
				t.Fatalf("Execute() = %v, want job.ErrLeaseLost", err)
			}
			if n := s.writes.Load(); n != 0 {
				t.Errorf("job writes = %d, want 0: the lease is known lost", n)
			}

			cancelled, failed := tracker.counts()
			if tt.wantCancelled {
				if len(cancelled) != 1 || failed != 0 {
					t.Errorf("cancelled %d, failed %d; want 1 and 0", len(cancelled), failed)
				}
				return
			}
			if len(cancelled) != 0 || failed != 1 {
				t.Errorf("cancelled %d, failed %d; want 0 and 1", len(cancelled), failed)
			}
		})
	}
}
```

- [ ] **Step 5: Run them and see them fail**

Run: `go test -count=1 -run 'TestRunner_LeaseLostToACancelledRow|TestRunner_AttemptCancelled' ./worker/`
Expected:

```
--- FAIL: TestRunner_LeaseLostToACancelledRow_ReportsCancelled (0.00s)
    cancel_test.go:174: OnJobCancelled saw 0 jobs, want one, job_..., in state cancelled
    cancel_test.go:177: OnJobFailed fired 1 times, want 0
--- FAIL: TestRunner_AttemptCancelledForALostLease_WritesNothing (0.00s)
    --- FAIL: TestRunner_AttemptCancelledForALostLease_WritesNothing/cancelled_by_an_operator (0.00s)
        cancel_test.go:221: Execute() = context canceled, want job.ErrLeaseLost
    --- FAIL: TestRunner_AttemptCancelledForALostLease_WritesNothing/reclaimed_by_the_reaper (0.00s)
        cancel_test.go:221: Execute() = context canceled, want job.ErrLeaseLost
FAIL
```

The second test is the persistent-backend bug: the write fails as `context canceled` and nothing is reported.

- [ ] **Step 6: Add the operator methods**

Create `engine/ops.go`:

```go
package engine

import (
	"context"
	"errors"
	"fmt"
	"time"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

// cancelAttempts bounds how many times CancelJob reads a running job
// again after its fenced write found the row had moved on. Each retry
// means the job changed state between the read and the write (it
// finished, failed, or was reclaimed), so a handful is plenty: the next
// read sees a state that is either cancellable without a fence or not
// cancellable at all.
const cancelAttempts = 3

// CancelJob moves a pending, retrying or running job to cancelled.
//
// A pending or retrying job is cancelled on the spot and JobCancelled
// fires before CancelJob returns. A running job is written cancelled
// while its worker still holds it, and the worker finds out through the
// lease: its next RenewLease, or its terminal write, comes back
// job.ErrLeaseLost because the row is no longer running. The pool then
// cancels the handler's context and the runner reports JobCancelled
// instead of JobFailed once it reads the row and sees why. Any other
// state wraps dispatch.ErrInvalidState.
//
// The running write is fenced on the holder and epoch read here, through
// job.LeaseStore.UpdateLeasedJob, rather than a plain UpdateJob. A plain
// write landing just after the worker completed the job would overwrite
// completed with cancelled. The fenced one is refused instead, and
// CancelJob reads the row again and decides on what it finds. A store
// without the lease capability, or a running job claimed without a
// lease, falls back to UpdateJob: there is no fence to write through.
//
// The returned job is the row as written. One OperatorAction of kind
// ext.ActionJobCancelled is emitted on success.
func (eng *Engine) CancelJob(ctx context.Context, jobID id.JobID) (*job.Job, error) {
	for attempt := 1; ; attempt++ {
		j, err := eng.jobStore.GetJob(ctx, jobID)
		if err != nil {
			return nil, err
		}

		now := time.Now().UTC()

		switch j.State {
		case job.StatePending, job.StateRetrying:
			j.State = job.StateCancelled
			j.CompletedAt = &now

			if err := eng.jobStore.UpdateJob(ctx, j); err != nil {
				return nil, fmt.Errorf("cancel job %s: %w", jobID, err)
			}

			eng.extensions.EmitJobCancelled(ctx, j)

		case job.StateRunning:
			j.State = job.StateCancelled
			j.CompletedAt = &now

			err := eng.writeRunningCancel(ctx, j)
			if errors.Is(err, job.ErrLeaseLost) && attempt < cancelAttempts {
				// The row moved between the read and the write. Look
				// again rather than guess what it moved to.
				continue
			}
			if err != nil {
				return nil, fmt.Errorf("cancel job %s: %w", jobID, err)
			}

			// JobCancelled for a running job is the worker's to emit,
			// once it stops. Emitting it here as well would report one
			// cancellation twice.

		default:
			return nil, fmt.Errorf("%w: job %s is %s", dispatch.ErrInvalidState, jobID, j.State)
		}

		eng.extensions.EmitOperatorAction(ctx, ext.Action{
			Kind:  ext.ActionJobCancelled,
			JobID: jobID,
		})

		return j, nil
	}
}

// writeRunningCancel writes a running job's cancellation, fenced on the
// worker and epoch j was read with whenever the store and the job allow
// it. See CancelJob.
func (eng *Engine) writeRunningCancel(ctx context.Context, j *job.Job) error {
	if ls, ok := eng.jobStore.(job.LeaseStore); ok && !j.WorkerID.IsNil() {
		return ls.UpdateLeasedJob(ctx, j, j.WorkerID, j.LeaseEpoch)
	}

	return eng.jobStore.UpdateJob(ctx, j)
}

// RetryJob puts a failed job back to pending, as if it had just been
// enqueued: no retries spent, no error, no owner. Any other state wraps
// dispatch.ErrInvalidState.
//
// A failed job usually has a dead letter entry, and replaying that entry
// would run the same failure a second time. So when one exists the retry
// claims it first, with the retried job as the claim's job, and a claim
// that is already taken refuses the retry with
// dispatch.ErrDLQAlreadyReplayed. If the job write then fails the claim
// is released, so the entry can be replayed or retried later. A failed
// job with no entry retries without a claim.
//
// Without an entry there is nothing to serialise two concurrent retries
// on. Both write the same pending row, which is harmless unless a worker
// claims the job between the two writes.
//
// The returned job is the row as written. One OperatorAction of kind
// ext.ActionJobRetried is emitted on success, carrying the claimed
// entry's ID when there was one.
func (eng *Engine) RetryJob(ctx context.Context, jobID id.JobID) (*job.Job, error) {
	j, err := eng.jobStore.GetJob(ctx, jobID)
	if err != nil {
		return nil, err
	}

	if j.State != job.StateFailed {
		return nil, fmt.Errorf("%w: job %s is %s", dispatch.ErrInvalidState, jobID, j.State)
	}

	ds := eng.dlqService.DLQStore()

	var claimed id.DLQID

	entry, err := ds.GetDLQByJobID(ctx, jobID)
	switch {
	case err == nil:
		claimErr := ds.ClaimReplay(ctx, entry.ID, jobID)
		switch {
		case claimErr == nil:
			claimed = entry.ID
		case errors.Is(claimErr, dispatch.ErrDLQNotFound):
			// Deleted between the read and the claim: there is no
			// longer anything a replay could run twice.
		default:
			return nil, fmt.Errorf("retry job %s: %w", jobID, claimErr)
		}
	case errors.Is(err, dispatch.ErrDLQNotFound):
		// Nothing to claim. The job failed without reaching the DLQ.
	default:
		return nil, fmt.Errorf("retry job %s: %w", jobID, err)
	}

	j.State = job.StatePending
	j.RetryCount = 0
	j.LastError = ""
	j.RunAt = time.Now().UTC()
	j.CompletedAt = nil
	// Clears StartedAt along with the worker and lease fields the failed
	// run left behind. Without it the retried job carries a lapsed
	// lease_expires_at into pending, which a claim that grants no lease
	// never overwrites. See job.Job.ClearOwnership for why that livelocks.
	j.ClearOwnership()

	if err := eng.jobStore.UpdateJob(ctx, j); err != nil {
		if !claimed.IsNil() {
			// Detached, so a write that failed because ctx ended does not
			// also strand the claim.
			relCtx := context.WithoutCancel(ctx)
			if relErr := ds.ReleaseReplay(relCtx, claimed, jobID); relErr != nil {
				eng.logger.Warn("retry: release of the dlq claim failed",
					log.String("job_id", jobID.String()),
					log.String("dlq_id", claimed.String()),
					log.String("error", relErr.Error()),
				)
			}
		}

		return nil, fmt.Errorf("retry job %s: %w", jobID, err)
	}

	if eng.pool != nil {
		eng.pool.Wake()
	}

	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:  ext.ActionJobRetried,
		JobID: jobID,
		DLQID: claimed,
	})

	return j, nil
}
```

Run: `go test -count=1 -run 'TestCancelJob|TestRetryJob' ./engine/`
Expected: everything passes except the running case, because the worker still reports the refused write as a failure:

```
--- FAIL: TestCancelJob_Running (2.03s)
    ops_test.go:268: OnJobCancelled never fired for the running job
FAIL
```

- [ ] **Step 7: Abandon a known-lost lease before writing**

In `worker/runner.go`, in `Execute`, find:

```go
	start := time.Now()
	execErr := r.mw(ctx, j, terminal)
	elapsed := time.Since(start)

	now := time.Now().UTC()
	j.UpdatedAt = now
```

Replace it with:

```go
	start := time.Now()
	execErr := r.mw(ctx, j, terminal)
	elapsed := time.Since(start)

	// The pool cancels an attempt with job.ErrLeaseLost as the cause once
	// a renewal tells it the row moved on (Pool.sendHeartbeats). Any
	// terminal write from here would be refused by the fence anyway, and
	// on a backend that honours the context it fails first as
	// context.Canceled, which no call site below routes to
	// abandonLostLease. Abandon now, while the cause is still known.
	if cause := context.Cause(ctx); errors.Is(cause, job.ErrLeaseLost) {
		return r.abandonLostLease(ctx, j, cause)
	}

	now := time.Now().UTC()
	j.UpdatedAt = now
```

In the doc comment above `Execute`, find the last bullet:

```go
//   - Any of the terminal writes above losing the race to
//     job.ErrLeaseLost: abandonLostLease writes nothing to the store at
//     all — the current lease holder's own write must stand untouched —
//     and only emits JobFailed so extensions still observe the loss.
```

Replace it with:

```go
//   - Any of the terminal writes above losing the race to
//     job.ErrLeaseLost, or the pool having cancelled the attempt with
//     that cause: abandonLostLease writes nothing to the store at
//     all — the current lease holder's own write must stand untouched —
//     and only emits JobCancelled when the row says an operator
//     cancelled it, or JobFailed otherwise, so extensions still observe
//     the loss.
```

(The em dashes on the middle line are existing text; leave them as they are.)

- [ ] **Step 8: Tell a cancel from a reclaim in `abandonLostLease`**

In `worker/runner.go`, find the end of the `abandonLostLease` doc comment and the function:

```go
// The extension registry emit reuses EmitJobFailed rather than adding a
// new event: audit_hook and relay_hook both already implement
// ext.JobFailed, so they observe a lost lease with no new plumbing.
func (r *Runner) abandonLostLease(ctx context.Context, j *job.Job, cause error) error {
	r.logger.Warn("lease lost, discarding terminal write",
		log.String("job_id", j.ID.String()),
		log.String("job_name", j.Name),
	)

	r.extensions.EmitJobFailed(ctx, j, cause)

	return cause
}
```

Replace it with:

```go
// One reason for the loss is not a failure at all: an operator cancelled
// the job while it ran (engine.CancelJob writes the row cancelled, which
// is what fails the fence). So the row is read once, and a cancelled row
// is reported through EmitJobCancelled with the row as stored. Every
// other loss, a reclaim above all, reuses EmitJobFailed rather than
// adding a new event: audit_hook and relay_hook both already implement
// ext.JobFailed, so they observe a lost lease with no new plumbing.
//
// The read and both emits run on a context detached from ctx's
// cancellation. ctx is usually the attempt's own context, which the pool
// has just cancelled, and a read through it would fail on every backend
// that honours the context.
func (r *Runner) abandonLostLease(ctx context.Context, j *job.Job, cause error) error {
	detached := context.WithoutCancel(ctx)

	if cur := r.cancelledRow(detached, j.ID); cur != nil {
		r.logger.Info("job cancelled while running, discarding terminal write",
			log.String("job_id", j.ID.String()),
			log.String("job_name", j.Name),
		)

		r.extensions.EmitJobCancelled(detached, cur)

		return cause
	}

	r.logger.Warn("lease lost, discarding terminal write",
		log.String("job_id", j.ID.String()),
		log.String("job_name", j.Name),
	)

	r.extensions.EmitJobFailed(detached, j, cause)

	return cause
}

// leaseLostReadTimeout bounds the single read abandonLostLease makes to
// learn why a lease was lost. The attempt is already over, so a slow
// store only delays which event is reported, never the job.
const leaseLostReadTimeout = 5 * time.Second

// cancelledRow returns the stored job when its state is cancelled, and
// nil otherwise, including when the read fails. A failed read reports
// the loss as JobFailed, which is what every lost lease reported before
// cancellation existed.
func (r *Runner) cancelledRow(ctx context.Context, jobID id.JobID) *job.Job {
	readCtx, cancel := context.WithTimeout(ctx, leaseLostReadTimeout)
	defer cancel()

	cur, err := r.store.GetJob(readCtx, jobID)
	if err != nil || cur == nil || cur.State != job.StateCancelled {
		return nil
	}

	return cur
}
```

`runner.go` already imports `context`, `errors`, `time`, `id` and `job`. The `cur == nil` guard is there because the fake store in `runner_test.go` returns `(nil, nil)` from `GetJob`.

- [ ] **Step 9: Run the tests and see them pass**

Run: `go test -race -count=1 -v -run 'TestCancelJob|TestRetryJob' ./engine/ 2>&1 | grep -E '^(--- |ok|FAIL)'; go test -race -count=1 -v -run 'TestRunner_LeaseLostToACancelledRow|TestRunner_AttemptCancelled' ./worker/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected:

```
--- PASS: TestCancelJob_PendingAndRetrying (0.00s)
--- PASS: TestCancelJob_TerminalStatesAreRefused (0.00s)
--- PASS: TestCancelJob_UnknownJob (0.00s)
--- PASS: TestCancelJob_Running (0.14s)
--- PASS: TestRetryJob_ClaimsTheDLQEntry (0.00s)
--- PASS: TestRetryJob_WithoutADLQEntry (0.00s)
--- PASS: TestRetryJob_OnlyFailedJobs (0.00s)
--- PASS: TestRetryJob_TwiceIsRefusedByTheClaim (0.00s)
--- PASS: TestRetryJob_FailedWriteReleasesTheClaim (0.00s)
ok  	github.com/xraph/dispatch/engine
--- PASS: TestRunner_LeaseLostToACancelledRow_ReportsCancelled (0.00s)
--- PASS: TestRunner_AttemptCancelledForALostLease_WritesNothing (0.00s)
ok  	github.com/xraph/dispatch/worker
```

The existing `TestRunner_TerminalWrites_AbandonOnLeaseLost` and `TestPool_LeaseLostDuringExecution_DoesNotClobberTheWinner` keep passing: their rows are never cancelled, so they still see `OnJobFailed`.

- [ ] **Step 10: Gate**

```bash
gofmt -l engine worker
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./engine/... ./worker/... ./dlq/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: `gofmt` prints nothing, the build succeeds, the second command prints no FAIL lines, the race run prints three `ok` lines, and lint prints `0 issues.` This was run on 2026-10-07 on top of Task 7 and the store tasks (be8e26a): every package `ok`, race clean, `0 issues.`

- [ ] **Step 11: Commit**

```bash
git add engine/ops.go engine/ops_test.go worker/cancel_test.go
git commit --only -m "feat(engine): cancel and retry jobs through the engine

CancelJob takes a pending, retrying or running job to cancelled. A
running job is written cancelled through the lease fence, so a cancel
that lands just after the worker finished is refused and read again,
and the worker learns about it when its next renewal or terminal write
is refused. The runner now reads the row when a lease is lost and
reports JobCancelled for a cancelled row, JobFailed for anything else.

It also stops writing once the pool has cancelled an attempt for a
lost lease. That write went through the cancelled context, so on every
persistent backend it failed as context.Canceled and no event fired.

RetryJob moves the reset from the REST handler into the engine and
claims the job's dead letter entry first, so a retry and a replay of
the same failure can't both run. Both methods emit one operator action
on success." -- engine/ops.go engine/ops_test.go worker/runner.go worker/cancel_test.go
git show --stat HEAD | tail -5
```

Expected last line: `4 files changed, 958 insertions(+), 5 deletions(-)`.

---

### Task 8b: Replay, delete and purge dead letters through the engine

`dlq.Service.Replay` enqueues straight into the job store and marks the entry afterwards, so two operators clicking replay get two jobs, and the replayed job skips the engine: no capacity check, no pool wake, no `job.enqueued` event. This task routes every replay through the store's claim and the engine. The DLQ service builds the job and claims the entry for its new ID before enqueuing, releasing the claim if the enqueue fails. The engine hands the service an enqueuer, `enqueuePrepared`, which checks the carried `Resources` against today's fleet ceiling and then runs the same tail `EnqueueRaw` runs. `Service.Replay` stays, so `DLQService()` keeps working for existing callers, and it now takes the claim too: no path can run one failure twice. On top of that the engine gains `ReplayDLQ`, `ReplayAllDLQ`, `DeleteDLQ`, `PurgeDLQ` and `CountDLQPurge`, each emitting one operator action, which the REST and dashboard tasks call.

Two decisions you should know about. `enqueuePrepared` does not check that a handler is registered for the job's name, because `EnqueueRaw` never has (the worker that claims it may run a build this process does not); consistency wins. And it does not resolve the requirement again: `resource.CheckSchedulable` is exported from the check `Resolve` already runs, and only that check runs on the carried set.

**Files:**
- Modify: `resource/spec.go` (export `checkSchedulable` as `CheckSchedulable`, about lines 190 and 221 to 224)
- Modify: `dlq/service.go` (the `Service` struct and `NewService`, lines 11 to 20)
- Modify: `dlq/replay.go` (whole file)
- Modify: `dlq/entry.go` (the `Entry` doc comment, lines 13 to 17)
- Modify: `dlq/doc.go` (the `# Replay` section, lines 33 to 35)
- Create: `dlq/replay_test.go`
- Modify: `engine/engine.go` (the DLQ service line in `Build`, about line 417; the tail of `EnqueueRaw`, about lines 718 to 729)
- Create: `engine/ops_dlq.go`
- Create: `engine/ops_dlq_test.go`

**Interfaces:**
- Consumes: everything Task 8a consumes, plus `dlq.PageLister` (`ListDLQPage` with `Replayed: &false`, `CountDLQEntries` with `FailedBefore`; not folded into `dlq.Store`, so the engine type-asserts it), `dlq.Store.PurgeDLQ` (deletes `FailedAt` strictly before), `Engine.MaxWorkerCapacity`, and Task 8a's test helpers `jobOpsRecorder`, `newJobOpsEngine`, `pushFailed` in `engine/ops_test.go`.
- Produces:

```go
package resource
func CheckSchedulable(requests, maxCapacity Set) error // was checkSchedulable; wraps ErrUnschedulable

package dlq
type Enqueuer func(ctx context.Context, j *job.Job) error
type ServiceOption func(*Service)
func WithEnqueuer(fn Enqueuer) ServiceOption
func NewService(store Store, jobStore job.Store, opts ...ServiceOption) *Service // default enqueuer: jobStore.EnqueueJob
func (s *Service) Replay(ctx context.Context, entryID id.DLQID) (*job.Job, error)   // GetDLQ, then ReplayEntry
func (s *Service) ReplayEntry(ctx context.Context, entry *Entry) (*job.Job, error) // mint ID, ClaimReplay, enqueue, ReleaseReplay on failure

package engine
func (eng *Engine) ReplayDLQ(ctx context.Context, entryID id.DLQID) (*job.Job, error)
// Emits ext.ActionDLQReplayed {JobID: entry.JobID, NewJobID, DLQID}.
type ReplayAllOpts struct { Queue string; Limit int } // Limit <= 0 -> 1000
type ReplayAllResult struct { Replayed int; Conflicts int; Failed int; Errors []string } // Errors capped at 20
func (eng *Engine) ReplayAllDLQ(ctx context.Context, opts ReplayAllOpts) (ReplayAllResult, error)
// Emits one ext.ActionDLQReplayed {Count: Replayed, no DLQID}, even when Count is 0; nothing when it errors.
func (eng *Engine) DeleteDLQ(ctx context.Context, entryID id.DLQID) error // emits ext.ActionDLQDeleted {DLQID}
func (eng *Engine) PurgeDLQ(ctx context.Context, before time.Time) (int64, error) // zero before refused; emits ext.ActionDLQPurged {Count}, 0 included
func (eng *Engine) CountDLQPurge(ctx context.Context, before time.Time) (int64, error) // zero before refused; emits nothing
```

Unexported, for whoever touches the engine next: `(*Engine).commitEnqueue(ctx, j)` is the shared enqueue tail (EnqueueJob, pool.Wake, EmitJobEnqueued), and `(*Engine).enqueuePrepared(ctx, j)` is the DLQ service's enqueuer.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- engine dlq resource && git log -1 --oneline`
Expected: no output from `git status` for those directories, and the last commit is Task 8a's. If another session has uncommitted edits there, stop and report.

- [ ] **Step 2: Write the failing DLQ service tests**

Create `dlq/replay_test.go` (it reuses `newTestJob` from `dlq/service_test.go`):

```go
package dlq_test

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/dispatch"
	dispatchDLQ "github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/memory"
)

// pushOne pushes one failed job and returns its entry.
func pushOne(t *testing.T, s *memory.Store, svc *dispatchDLQ.Service) *dispatchDLQ.Entry {
	t.Helper()

	j := newTestJob("replay-claim", []byte(`{}`))
	if err := svc.Push(context.Background(), j, errors.New("boom")); err != nil {
		t.Fatalf("Push: %v", err)
	}

	entry, err := s.GetDLQByJobID(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	return entry
}

func TestService_Replay_SecondReplayIsRefused(t *testing.T) {
	s := memory.New()
	svc := dispatchDLQ.NewService(s, s)
	entry := pushOne(t, s, svc)

	first, err := svc.Replay(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("first Replay: %v", err)
	}

	_, err = svc.Replay(context.Background(), entry.ID)
	if !errors.Is(err, dispatch.ErrDLQAlreadyReplayed) {
		t.Fatalf("second Replay error = %v, want ErrDLQAlreadyReplayed", err)
	}

	pending, err := s.CountJobs(context.Background(), job.CountOpts{State: job.StatePending})
	if err != nil {
		t.Fatalf("CountJobs: %v", err)
	}
	if pending != 1 {
		t.Errorf("pending jobs = %d, want 1: the second replay must not enqueue", pending)
	}

	got, err := s.GetDLQ(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if got.ReplayedJobID == nil || *got.ReplayedJobID != first.ID {
		t.Errorf("ReplayedJobID = %v, want the first replay's job %s", got.ReplayedJobID, first.ID)
	}
}

func TestService_Replay_EnqueuesThroughTheEnqueuer(t *testing.T) {
	s := memory.New()

	var seen []*job.Job
	svc := dispatchDLQ.NewService(s, s, dispatchDLQ.WithEnqueuer(func(ctx context.Context, j *job.Job) error {
		seen = append(seen, j)
		return s.EnqueueJob(ctx, j)
	}))
	entry := pushOne(t, s, svc)

	replayed, err := svc.Replay(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if len(seen) != 1 || seen[0].ID != replayed.ID {
		t.Fatalf("enqueuer saw %d jobs, want exactly the replayed one", len(seen))
	}
}

func TestService_Replay_FailedEnqueueReleasesTheClaim(t *testing.T) {
	s := memory.New()

	refuse := errors.New("enqueue refused by test")
	fail := true
	svc := dispatchDLQ.NewService(s, s, dispatchDLQ.WithEnqueuer(func(ctx context.Context, j *job.Job) error {
		if fail {
			return refuse
		}
		return s.EnqueueJob(ctx, j)
	}))
	entry := pushOne(t, s, svc)

	if _, err := svc.Replay(context.Background(), entry.ID); !errors.Is(err, refuse) {
		t.Fatalf("Replay error = %v, want the enqueuer's error", err)
	}

	got, err := s.GetDLQ(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if got.ReplayedAt != nil || got.ReplayedJobID != nil {
		t.Errorf("entry after a failed enqueue: replayed_at %v replayed_job_id %v; want released",
			got.ReplayedAt, got.ReplayedJobID)
	}

	fail = false
	if _, err := svc.Replay(context.Background(), entry.ID); err != nil {
		t.Fatalf("Replay after the enqueuer recovered: %v", err)
	}
}
```

- [ ] **Step 3: Run them and see them fail**

Run: `go test -count=1 ./dlq/`
Expected: a compile failure that starts

```
dlq/replay_test.go:67:38: too many arguments in call to dispatchDLQ.NewService
	have (*memory.Store, *memory.Store, unknown type)
	want (dlq.Store, job.Store)
dlq/replay_test.go:67:50: undefined: dispatchDLQ.WithEnqueuer
```

- [ ] **Step 4: Give the service an enqueuer**

In `dlq/service.go`, find:

```go
// Service provides high-level DLQ operations over a Store.
type Service struct {
	store    Store
	jobStore job.Store
}

// NewService creates a DLQ service.
func NewService(store Store, jobStore job.Store) *Service {
	return &Service{store: store, jobStore: jobStore}
}
```

Replace it with:

```go
// Service provides high-level DLQ operations over a Store.
type Service struct {
	store    Store
	jobStore job.Store
	enqueue  Enqueuer
}

// Enqueuer puts a prepared job, ID and all, on its queue. Replay hands
// it the job it built from an entry. The engine supplies one that checks
// the job still fits a worker, wakes the local pool and reports the
// enqueue to extensions; without one, Replay writes the job straight to
// the job store.
type Enqueuer func(ctx context.Context, j *job.Job) error

// ServiceOption configures a Service.
type ServiceOption func(*Service)

// WithEnqueuer routes Replay's enqueue through fn.
func WithEnqueuer(fn Enqueuer) ServiceOption {
	return func(s *Service) { s.enqueue = fn }
}

// NewService creates a DLQ service.
func NewService(store Store, jobStore job.Store, opts ...ServiceOption) *Service {
	s := &Service{store: store, jobStore: jobStore}
	for _, opt := range opts {
		opt(s)
	}
	if s.enqueue == nil {
		s.enqueue = jobStore.EnqueueJob
	}
	return s
}
```

The variadic options keep every existing `dlq.NewService(store, jobStore)` call compiling (the engine, `worker/lease_fence_test.go`, `dlq/service_test.go`).

- [ ] **Step 5: Claim before enqueuing in `Replay`**

Replace the whole of `dlq/replay.go` with:

```go
package dlq

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

// Replay re-enqueues a DLQ entry as a new pending job and marks the
// entry as replayed. The new job gets a fresh ID, zero retry count,
// and runs immediately. See ReplayEntry for how a replay is made safe
// to run twice.
func (s *Service) Replay(ctx context.Context, entryID id.DLQID) (*job.Job, error) {
	entry, err := s.store.GetDLQ(ctx, entryID)
	if err != nil {
		return nil, err
	}

	return s.ReplayEntry(ctx, entry)
}

// ReplayEntry is Replay for an entry the caller has already read.
//
// The entry is claimed before anything is enqueued: the new job's ID is
// minted first and ClaimReplay records it on the entry only if nobody
// replayed or retried the entry before. Of two concurrent replays,
// exactly one gets past the claim and the other gets an error wrapping
// dispatch.ErrDLQAlreadyReplayed, so one failure is never turned back
// into two jobs. If the enqueue then fails, the claim is released and
// the entry can be replayed again.
//
// A process that dies between the claim and the enqueue leaves the entry
// marked replayed with no job behind it. That is the safe side to fail
// on: the operator sees an entry replayed into a job that does not
// exist, which is visible, where the opposite order could run the job
// twice, which is not.
func (s *Service) ReplayEntry(ctx context.Context, entry *Entry) (*job.Job, error) {
	j := replayJob(entry)

	if err := s.store.ClaimReplay(ctx, entry.ID, j.ID); err != nil {
		return nil, fmt.Errorf("replay dlq entry %s: %w", entry.ID, err)
	}

	if err := s.enqueue(ctx, j); err != nil {
		// Detached, so an enqueue that failed because ctx ended does not
		// also strand the claim.
		relCtx := context.WithoutCancel(ctx)
		if relErr := s.store.ReleaseReplay(relCtx, entry.ID, j.ID); relErr != nil {
			return nil, errors.Join(
				fmt.Errorf("replay dlq entry %s: %w", entry.ID, err),
				fmt.Errorf("release replay claim: %w", relErr),
			)
		}

		return nil, fmt.Errorf("replay dlq entry %s: %w", entry.ID, err)
	}

	return j, nil
}

// replayJob builds the job a replay of entry enqueues: a fresh pending
// job carrying everything the failed one ran with.
func replayJob(entry *Entry) *job.Job {
	now := time.Now().UTC()

	return &job.Job{
		Entity:     dispatch.NewEntity(),
		ID:         id.NewJobID(),
		Name:       entry.JobName,
		Queue:      entry.Queue,
		Payload:    entry.Payload,
		State:      job.StatePending,
		MaxRetries: entry.MaxRetries,
		ScopeAppID: entry.ScopeAppID,
		ScopeOrgID: entry.ScopeOrgID,
		RunAt:      now,
		// Restored from the failed job. Nothing on the replay path
		// re-derives any of these from the definition: whatever is not
		// set here silently becomes a default, and for LeaseTTL that
		// default is short enough to make a long job unrunnable. See the
		// Entry doc.
		Priority:         entry.Priority,
		Timeout:          entry.Timeout,
		LeaseTTL:         entry.LeaseTTL,
		ArtifactBindings: entry.ArtifactBindings,
		Resources:        entry.Resources,
		ResourceLimits:   entry.ResourceLimits,
		ResourceClass:    entry.ResourceClass,
		InputBytes:       entry.InputBytes,
		PrimaryInputHash: entry.PrimaryInputHash,
	}
}
```

The old file called `s.store.ReplayDLQ` after the enqueue. Nothing calls it now; it stays on `dlq.Store` for existing callers.

- [ ] **Step 6: Update the two doc comments that describe the old path**

In `dlq/entry.go`, find:

```go
// The fields below the identity block exist so Replay can rebuild a job
// that behaves like the one that failed. Replay calls EnqueueJob directly
// rather than going back through the engine, so nothing re-derives these
// for it: whatever the entry does not carry, the replayed job silently
// takes a default for. They are stored as the effective values from the
```

Replace it with:

```go
// The fields below the identity block exist so Replay can rebuild a job
// that behaves like the one that failed. Replay enqueues the job it
// builds as it is, through the engine's prepared-job path or straight to
// the job store, and neither re-derives these from the definition:
// whatever the entry does not carry, the replayed job silently takes a
// default for. They are stored as the effective values from the
```

In `dlq/doc.go`, find:

```go
// Replaying an entry re-enqueues the original job with the same payload.
// Use the admin API (POST /v1/dlq/:entryId/replay) or call the store
// directly. Replay sets ReplayedAt on the DLQ entry.
```

Replace it with:

```go
// Replaying an entry re-enqueues the original job with the same payload.
// Use engine.Engine.ReplayDLQ, the admin API (POST /v1/dlq/:entryId/replay)
// or [Service.Replay]. Every one of them claims the entry first
// ([ReplayClaimer.ClaimReplay]), which sets ReplayedAt and ReplayedJobID,
// so an entry is replayed into at most one job however many callers try.
```

Run: `go test -race -count=1 -v ./dlq/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: nine `--- PASS` lines (the three new ones and the six in `service_test.go`, including `TestService_Replay_PreservesExecutionFields`), then `ok  	github.com/xraph/dispatch/dlq`.

- [ ] **Step 7: Write the failing engine tests**

Create `engine/ops_dlq_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/resource"
	"github.com/xraph/dispatch/store/memory"
)

// pushFailedNamed is pushFailed for a job with its own name, so a test
// can tell entries apart by the job they replay into.
func pushFailedNamed(t *testing.T, eng *engine.Engine, s *memory.Store, name string) *dlq.Entry {
	t.Helper()
	ctx := context.Background()

	j, err := eng.EnqueueRaw(ctx, name, []byte(`{"n":1}`))
	if err != nil {
		t.Fatalf("EnqueueRaw: %v", err)
	}
	j.State = job.StateFailed
	if updErr := s.UpdateJob(ctx, j); updErr != nil {
		t.Fatalf("UpdateJob: %v", updErr)
	}
	if pushErr := eng.DLQService().Push(ctx, j, errors.New("boom")); pushErr != nil {
		t.Fatalf("Push: %v", pushErr)
	}

	entry, err := s.GetDLQByJobID(ctx, j.ID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	return entry
}

func countPending(t *testing.T, s *memory.Store) int64 {
	t.Helper()

	n, err := s.CountJobs(context.Background(), job.CountOpts{State: job.StatePending})
	if err != nil {
		t.Fatalf("CountJobs: %v", err)
	}

	return n
}

func TestReplayDLQ_EnqueuesAndClaims(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	failed, entryID := pushFailed(t, eng, s)

	j, err := eng.ReplayDLQ(ext.WithActor(context.Background(), "dave"), entryID)
	if err != nil {
		t.Fatalf("ReplayDLQ: %v", err)
	}
	if j.ID == failed.ID || j.Name != failed.Name || string(j.Payload) != string(failed.Payload) {
		t.Errorf("replayed job = %s %q %s, want a new ID for %q with the same payload",
			j.ID, j.Name, j.Payload, failed.Name)
	}

	stored, err := s.GetJob(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if stored.State != job.StatePending {
		t.Errorf("stored state = %s, want pending", stored.State)
	}

	entry, err := s.GetDLQ(context.Background(), entryID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if entry.ReplayedJobID == nil || *entry.ReplayedJobID != j.ID {
		t.Errorf("ReplayedJobID = %v, want %s", entry.ReplayedJobID, j.ID)
	}

	actions, _, _ := rec.snapshot()
	if len(actions) != 1 {
		t.Fatalf("got %d operator actions, want 1", len(actions))
	}
	a := actions[0]
	if a.Kind != ext.ActionDLQReplayed || a.DLQID != entryID || a.JobID != failed.ID ||
		a.NewJobID != j.ID || a.Actor != "dave" {
		t.Errorf("action = %+v, want dlq.replayed of %s from %s into %s by dave", a, entryID, failed.ID, j.ID)
	}
}

func TestReplayDLQ_ConcurrentReplaysMakeOneJob(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	_, entryID := pushFailed(t, eng, s)

	const callers = 8
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		won       int
		conflicts int
		other     []error
	)
	for range callers {
		wg.Go(func() {
			_, err := eng.ReplayDLQ(context.Background(), entryID)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				won++
			case errors.Is(err, dispatch.ErrDLQAlreadyReplayed):
				conflicts++
			default:
				other = append(other, err)
			}
		})
	}
	wg.Wait()

	if won != 1 || conflicts != callers-1 || len(other) != 0 {
		t.Fatalf("won %d, conflicts %d, other %v; want 1, %d, none", won, conflicts, other, callers-1)
	}
	if n := countPending(t, s); n != 1 {
		t.Errorf("pending jobs = %d, want exactly 1 new job", n)
	}
	if actions, _, _ := rec.snapshot(); len(actions) != 1 {
		t.Errorf("got %d operator actions, want 1", len(actions))
	}
}

func TestReplayDLQ_ThenRetryIsRefused(t *testing.T) {
	s := memory.New()
	eng, _ := newJobOpsEngine(t, s)
	failed, entryID := pushFailed(t, eng, s)

	if _, err := eng.ReplayDLQ(context.Background(), entryID); err != nil {
		t.Fatalf("ReplayDLQ: %v", err)
	}

	_, err := eng.RetryJob(context.Background(), failed.ID)
	if !errors.Is(err, dispatch.ErrDLQAlreadyReplayed) {
		t.Fatalf("RetryJob after a replay: error = %v, want ErrDLQAlreadyReplayed", err)
	}

	stored, err := s.GetJob(context.Background(), failed.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if stored.State != job.StateFailed {
		t.Errorf("failed job state = %s, want it left failed", stored.State)
	}
}

func TestRetryJob_ThenReplayIsRefused(t *testing.T) {
	s := memory.New()
	eng, _ := newJobOpsEngine(t, s)
	failed, entryID := pushFailed(t, eng, s)

	if _, err := eng.RetryJob(context.Background(), failed.ID); err != nil {
		t.Fatalf("RetryJob: %v", err)
	}

	_, err := eng.ReplayDLQ(context.Background(), entryID)
	if !errors.Is(err, dispatch.ErrDLQAlreadyReplayed) {
		t.Fatalf("ReplayDLQ after a retry: error = %v, want ErrDLQAlreadyReplayed", err)
	}
	if n := countPending(t, s); n != 1 {
		t.Errorf("pending jobs = %d, want only the retried job", n)
	}
}

// failEnqueueStore fails EnqueueJob while fail is set, and for any job
// named poison once poison is set.
type failEnqueueStore struct {
	*memory.Store
	mu     sync.Mutex
	fail   bool
	poison string
}

var errOpsEnqueue = errors.New("enqueue refused by test")

func (f *failEnqueueStore) setPoison(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.poison = name
}

func (f *failEnqueueStore) setFail(v bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = v
}

func (f *failEnqueueStore) EnqueueJob(ctx context.Context, j *job.Job) error {
	f.mu.Lock()
	fail := f.fail || (f.poison != "" && j.Name == f.poison)
	f.mu.Unlock()
	if fail {
		return errOpsEnqueue
	}
	return f.Store.EnqueueJob(ctx, j)
}

func TestReplayDLQ_FailedEnqueueLeavesTheEntryReplayable(t *testing.T) {
	s := &failEnqueueStore{Store: memory.New()}
	eng, rec := newJobOpsEngine(t, s)
	_, entryID := pushFailed(t, eng, s.Store)

	s.setFail(true)
	if _, err := eng.ReplayDLQ(context.Background(), entryID); !errors.Is(err, errOpsEnqueue) {
		t.Fatalf("ReplayDLQ error = %v, want the store's enqueue error", err)
	}

	entry, err := s.GetDLQ(context.Background(), entryID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if entry.ReplayedAt != nil || entry.ReplayedJobID != nil {
		t.Errorf("entry after a failed replay: replayed_at %v replayed_job_id %v; want released",
			entry.ReplayedAt, entry.ReplayedJobID)
	}
	if actions, _, _ := rec.snapshot(); len(actions) != 0 {
		t.Errorf("a failed replay emitted %d actions, want 0", len(actions))
	}

	s.setFail(false)
	if _, err := eng.ReplayDLQ(context.Background(), entryID); err != nil {
		t.Fatalf("ReplayDLQ after the store recovered: %v", err)
	}
}

// TestReplayDLQ_UnschedulableIsRefused replays a job bigger than the
// declared fleet. The check runs on the carried Resources, and runs for
// DLQService().Replay too, because both enqueue through the engine.
func TestReplayDLQ_UnschedulableIsRefused(t *testing.T) {
	s := memory.New()
	d, err := dispatch.New(dispatch.WithStore(s))
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}
	eng, err := engine.Build(d, engine.WithWorkerCapacity(resource.CPUs(2)))
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}

	j, err := eng.EnqueueRaw(context.Background(), "big-job", []byte(`{}`))
	if err != nil {
		t.Fatalf("EnqueueRaw: %v", err)
	}
	// Sized when the fleet was bigger than it is now.
	j.State = job.StateFailed
	j.Resources = resource.CPUs(8)
	if updErr := s.UpdateJob(context.Background(), j); updErr != nil {
		t.Fatalf("UpdateJob: %v", updErr)
	}
	if pushErr := eng.DLQService().Push(context.Background(), j, errors.New("boom")); pushErr != nil {
		t.Fatalf("Push: %v", pushErr)
	}
	entry, err := s.GetDLQByJobID(context.Background(), j.ID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	if _, replayErr := eng.ReplayDLQ(context.Background(), entry.ID); !errors.Is(replayErr, resource.ErrUnschedulable) {
		t.Fatalf("ReplayDLQ error = %v, want ErrUnschedulable", replayErr)
	}
	if _, replayErr := eng.DLQService().Replay(context.Background(), entry.ID); !errors.Is(replayErr, resource.ErrUnschedulable) {
		t.Fatalf("DLQService().Replay error = %v, want ErrUnschedulable", replayErr)
	}

	got, err := s.GetDLQ(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if got.ReplayedAt != nil {
		t.Errorf("entry was left claimed after an unschedulable replay")
	}
}

// stealOnListStore claims the entries in steal right after listing them,
// as if another operator replayed them between ReplayAllDLQ's read and
// its own claim.
type stealOnListStore struct {
	*failEnqueueStore
	steal map[id.DLQID]bool
}

func (s *stealOnListStore) ListDLQPage(ctx context.Context, opts dlq.PageOpts) (dlq.Page, error) {
	page, err := s.Store.ListDLQPage(ctx, opts)
	if err != nil {
		return page, err
	}
	for _, e := range page.Entries {
		if s.steal[e.ID] {
			if claimErr := s.ClaimReplay(ctx, e.ID, id.NewJobID()); claimErr != nil {
				return page, claimErr
			}
		}
	}
	return page, nil
}

func TestReplayAllDLQ_Counts(t *testing.T) {
	s := &stealOnListStore{
		failEnqueueStore: &failEnqueueStore{Store: memory.New()},
		steal:            map[id.DLQID]bool{},
	}
	eng, rec := newJobOpsEngine(t, s)

	done := pushFailedNamed(t, eng, s.Store, "ops-done")
	stolen := pushFailedNamed(t, eng, s.Store, "ops-stolen")
	poison := pushFailedNamed(t, eng, s.Store, "ops-poison")
	for range 3 {
		pushFailedNamed(t, eng, s.Store, "ops-fine")
	}
	s.steal[stolen.ID] = true
	s.setPoison("ops-poison")

	// Replayed before the sweep, so the sweep never lists it.
	if _, err := eng.ReplayDLQ(context.Background(), done.ID); err != nil {
		t.Fatalf("ReplayDLQ: %v", err)
	}

	res, err := eng.ReplayAllDLQ(ext.WithActor(context.Background(), "erin"), engine.ReplayAllOpts{})
	if err != nil {
		t.Fatalf("ReplayAllDLQ: %v", err)
	}
	if res.Replayed != 3 || res.Conflicts != 1 || res.Failed != 1 || len(res.Errors) != 1 {
		t.Fatalf("result = %+v, want 3 replayed, 1 conflict, 1 failed with one message", res)
	}

	got, err := s.GetDLQ(context.Background(), poison.ID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if got.ReplayedAt != nil {
		t.Errorf("the entry whose replay failed was left claimed")
	}

	// One pending job from the earlier replay, three from the sweep.
	if n := countPending(t, s.Store); n != 4 {
		t.Errorf("pending jobs = %d, want 4", n)
	}

	actions, _, _ := rec.snapshot()
	if len(actions) != 2 {
		t.Fatalf("got %d operator actions, want the earlier replay's and one for the sweep", len(actions))
	}
	a := actions[1]
	if a.Kind != ext.ActionDLQReplayed || a.Count != 3 || !a.DLQID.IsNil() || a.Actor != "erin" {
		t.Errorf("sweep action = %+v, want dlq.replayed with count 3, no entry, by erin", a)
	}
}

func TestReplayAllDLQ_LimitTakesTheNewest(t *testing.T) {
	s := memory.New()
	eng, _ := newJobOpsEngine(t, s)

	entries := make([]*dlq.Entry, 0, 4)
	for range 4 {
		entries = append(entries, pushFailedNamed(t, eng, s, "ops-fine"))
		// IDs sort by creation time; a millisecond apart keeps the
		// order this test reads as "newest" unambiguous.
		time.Sleep(2 * time.Millisecond)
	}

	res, err := eng.ReplayAllDLQ(context.Background(), engine.ReplayAllOpts{Limit: 2})
	if err != nil {
		t.Fatalf("ReplayAllDLQ: %v", err)
	}
	if res.Replayed != 2 {
		t.Fatalf("Replayed = %d, want 2", res.Replayed)
	}

	for i, e := range entries {
		got, err := s.GetDLQ(context.Background(), e.ID)
		if err != nil {
			t.Fatalf("GetDLQ: %v", err)
		}
		wantReplayed := i >= 2 // the two pushed last have the highest IDs
		if (got.ReplayedAt != nil) != wantReplayed {
			t.Errorf("entry %d replayed = %v, want %v", i, got.ReplayedAt != nil, wantReplayed)
		}
	}
}

func TestDeleteDLQ(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	_, entryID := pushFailed(t, eng, s)

	if err := eng.DeleteDLQ(ext.WithActor(context.Background(), "frank"), entryID); err != nil {
		t.Fatalf("DeleteDLQ: %v", err)
	}
	if _, err := s.GetDLQ(context.Background(), entryID); !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Errorf("GetDLQ after delete: error = %v, want ErrDLQNotFound", err)
	}

	if err := eng.DeleteDLQ(context.Background(), entryID); !errors.Is(err, dispatch.ErrDLQNotFound) {
		t.Errorf("second DeleteDLQ: error = %v, want ErrDLQNotFound", err)
	}

	actions, _, _ := rec.snapshot()
	if len(actions) != 1 || actions[0].Kind != ext.ActionDLQDeleted || actions[0].DLQID != entryID ||
		actions[0].Actor != "frank" {
		t.Errorf("actions = %+v, want one dlq.deleted of %s by frank", actions, entryID)
	}
}

func TestPurgeDLQ(t *testing.T) {
	s := memory.New()
	eng, rec := newJobOpsEngine(t, s)
	ctx := context.Background()

	now := time.Now().UTC()
	for _, failedAt := range []time.Time{now.Add(-72 * time.Hour), now.Add(-48 * time.Hour), now} {
		e := &dlq.Entry{
			ID:        id.NewDLQID(),
			JobID:     id.NewJobID(),
			JobName:   "ops-old",
			Queue:     "default",
			Error:     "boom",
			FailedAt:  failedAt,
			CreatedAt: failedAt,
		}
		if err := s.PushDLQ(ctx, e); err != nil {
			t.Fatalf("PushDLQ: %v", err)
		}
	}
	cutoff := now.Add(-24 * time.Hour)

	if _, err := eng.PurgeDLQ(ctx, time.Time{}); err == nil {
		t.Fatal("PurgeDLQ with a zero before: want an error")
	}
	if _, err := eng.CountDLQPurge(ctx, time.Time{}); err == nil {
		t.Fatal("CountDLQPurge with a zero before: want an error")
	}

	would, err := eng.CountDLQPurge(ctx, cutoff)
	if err != nil {
		t.Fatalf("CountDLQPurge: %v", err)
	}
	if would != 2 {
		t.Errorf("CountDLQPurge = %d, want 2", would)
	}
	if actions, _, _ := rec.snapshot(); len(actions) != 0 {
		t.Errorf("the dry run and the refusals emitted %d actions, want 0", len(actions))
	}

	purged, err := eng.PurgeDLQ(ext.WithActor(ctx, "gina"), cutoff)
	if err != nil {
		t.Fatalf("PurgeDLQ: %v", err)
	}
	if purged != would {
		t.Errorf("PurgeDLQ = %d, want the dry run's %d", purged, would)
	}

	left, err := s.CountDLQ(ctx)
	if err != nil {
		t.Fatalf("CountDLQ: %v", err)
	}
	if left != 1 {
		t.Errorf("entries left = %d, want 1", left)
	}

	actions, _, _ := rec.snapshot()
	if len(actions) != 1 || actions[0].Kind != ext.ActionDLQPurged || actions[0].Count != 2 ||
		actions[0].Actor != "gina" {
		t.Errorf("actions = %+v, want one dlq.purged with count 2 by gina", actions)
	}
}
```

- [ ] **Step 8: Run them and see them fail**

Run: `go vet ./engine/`
Expected: a compile failure that starts

```
vet: engine/ops_dlq_test.go:62:16: eng.ReplayDLQ undefined (type *engine.Engine has no field or method ReplayDLQ)
```

- [ ] **Step 9: Export the schedulability check**

In `resource/spec.go`, find:

```go
	if err := checkSchedulable(spec.Requests, in.MaxCapacity); err != nil {
```

Replace it with:

```go
	if err := CheckSchedulable(spec.Requests, in.MaxCapacity); err != nil {
```

Then find:

```go
// checkSchedulable rejects a requirement no worker could ever satisfy.
// An empty maxCapacity means capacity is unknown, which disables the
// check rather than rejecting everything.
func checkSchedulable(requests, maxCapacity Set) error {
```

Replace it with:

```go
// CheckSchedulable rejects a requirement no worker could ever satisfy,
// with an error wrapping ErrUnschedulable that names each dimension that
// does not fit. An empty maxCapacity means capacity is unknown, which
// disables the check rather than rejecting everything.
//
// Resolve runs it on the requirement it resolves. It is exported for a
// caller that already holds a resolved requirement, such as a dead
// letter replay carrying the failed job's Resources, and must check it
// against today's fleet without resolving it again.
func CheckSchedulable(requests, maxCapacity Set) error {
```

Nothing else in the repository names `checkSchedulable` (`grep -rn checkSchedulable --include='*.go' .` shows only these two places before the change).

- [ ] **Step 10: Add the DLQ operator methods**

Create `engine/ops_dlq.go`:

```go
package engine

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/resource"
)

// commitEnqueue is the tail every enqueue shares: write the job, nudge
// the local worker pool so an in-process enqueue is picked up at once
// instead of after the idle poll backoff, and tell extensions.
func (eng *Engine) commitEnqueue(ctx context.Context, j *job.Job) error {
	if err := eng.jobStore.EnqueueJob(ctx, j); err != nil {
		return err
	}

	if eng.pool != nil {
		eng.pool.Wake()
	}

	eng.extensions.EmitJobEnqueued(ctx, j)

	return nil
}

// enqueuePrepared enqueues a job somebody else built, ID and all. It is
// the dlq.Enqueuer the engine hands its DLQ service, so a replay goes
// through the same tail as EnqueueRaw.
//
// The job's Resources were resolved when the failed job was first
// enqueued and are not resolved again: the estimator and the definition
// may have changed since, and a replay runs what failed. They are only
// checked against today's fleet ceiling, with the same check Resolve
// runs, because the fleet may have shrunk since and a job no worker can
// run must fail loudly here rather than sit pending forever.
//
// Like EnqueueRaw, it does not ask whether a handler is registered for
// the job's name. EnqueueRaw never has: the worker that claims the job
// may run a build this process does not.
func (eng *Engine) enqueuePrepared(ctx context.Context, j *job.Job) error {
	if len(j.Resources) > 0 {
		if err := resource.CheckSchedulable(j.Resources, eng.MaxWorkerCapacity(ctx)); err != nil {
			return err
		}
	}

	return eng.commitEnqueue(ctx, j)
}

// ReplayDLQ turns a dead letter entry back into work: a new pending job
// carrying everything the failed one ran with, under a fresh ID.
//
// The entry is claimed before the job is enqueued (dlq.Service.ReplayEntry),
// so of two concurrent replays exactly one creates a job and the other
// gets an error wrapping dispatch.ErrDLQAlreadyReplayed, as does a replay
// of an entry whose job was already retried. A failed enqueue releases
// the claim. Unknown entries return dispatch.ErrDLQNotFound, and a job
// too big for every worker wraps resource.ErrUnschedulable.
//
// One OperatorAction of kind ext.ActionDLQReplayed is emitted on success,
// naming the entry, the failed job and the new one.
func (eng *Engine) ReplayDLQ(ctx context.Context, entryID id.DLQID) (*job.Job, error) {
	entry, err := eng.dlqService.DLQStore().GetDLQ(ctx, entryID)
	if err != nil {
		return nil, err
	}

	j, err := eng.dlqService.ReplayEntry(ctx, entry)
	if err != nil {
		return nil, err
	}

	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:     ext.ActionDLQReplayed,
		JobID:    entry.JobID,
		NewJobID: j.ID,
		DLQID:    entryID,
	})

	return j, nil
}

// defaultReplayAllLimit is how many entries ReplayAllDLQ looks at when
// the caller sets no limit. It is the cap the REST handler has always
// listed with.
const defaultReplayAllLimit = 1000

// replayAllPageSize is how many entries ReplayAllDLQ reads per page.
const replayAllPageSize = 100

// maxReplayAllErrors caps ReplayAllResult.Errors. Failed keeps the full
// count; the messages are for a person to read, and a thousand copies of
// one store error tell them nothing the first few do not.
const maxReplayAllErrors = 20

// ReplayAllOpts selects what ReplayAllDLQ replays.
type ReplayAllOpts struct {
	// Queue limits the replay to one queue. Empty means every queue.
	Queue string
	// Limit caps how many entries are tried. Zero or less means 1000.
	Limit int
}

// ReplayAllResult counts what ReplayAllDLQ did with each entry it tried.
type ReplayAllResult struct {
	// Replayed is how many entries became new jobs.
	Replayed int
	// Conflicts is how many were claimed by somebody else between the
	// listing and their own replay.
	Conflicts int
	// Failed is how many could not be replayed for any other reason.
	// Each of those entries was released and can be replayed again.
	Failed int
	// Errors holds a message for the first failures, "<entry id>: <error>",
	// at most 20 of them.
	Errors []string
}

// ReplayAllDLQ replays every entry nobody has replayed yet, newest first,
// up to opts.Limit, each one exactly as ReplayDLQ would. It is not a
// transaction: entries are claimed one at a time, so a concurrent replay
// of one of them shows up as a Conflict, and a failure partway leaves the
// earlier replays in place.
//
// It returns an error only when the entries cannot be listed or ctx ends,
// together with what it had done by then, and emits nothing in that case.
// Otherwise it emits one OperatorAction of kind ext.ActionDLQReplayed,
// with no entry ID and Count set to the number replayed (zero included:
// an operator asked, and the record says what came of it).
func (eng *Engine) ReplayAllDLQ(ctx context.Context, opts ReplayAllOpts) (ReplayAllResult, error) {
	var res ReplayAllResult

	pl, ok := eng.dlqService.DLQStore().(dlq.PageLister)
	if !ok {
		return res, errors.New("dispatch: dlq store does not support paged listing")
	}

	limit := opts.Limit
	if limit <= 0 {
		limit = defaultReplayAllLimit
	}

	unreplayed := false
	cursor := ""
	tried := 0

	for tried < limit {
		page, err := pl.ListDLQPage(ctx, dlq.PageOpts{
			Queue:    opts.Queue,
			Replayed: &unreplayed,
			Cursor:   cursor,
			Limit:    min(limit-tried, replayAllPageSize),
		})
		if err != nil {
			return res, fmt.Errorf("replay all dlq: list: %w", err)
		}

		for _, entry := range page.Entries {
			if err := ctx.Err(); err != nil {
				return res, err
			}

			tried++

			_, replayErr := eng.dlqService.ReplayEntry(ctx, entry)
			switch {
			case replayErr == nil:
				res.Replayed++
			case errors.Is(replayErr, dispatch.ErrDLQAlreadyReplayed):
				res.Conflicts++
			default:
				res.Failed++
				if len(res.Errors) < maxReplayAllErrors {
					res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", entry.ID, replayErr))
				}
			}
		}

		if page.Complete || page.NextCursor == "" {
			break
		}

		cursor = page.NextCursor
	}

	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:  ext.ActionDLQReplayed,
		Count: int64(res.Replayed),
	})

	return res, nil
}

// DeleteDLQ removes one dead letter entry for good. Unknown entries
// return dispatch.ErrDLQNotFound. One OperatorAction of kind
// ext.ActionDLQDeleted is emitted on success.
func (eng *Engine) DeleteDLQ(ctx context.Context, entryID id.DLQID) error {
	if err := eng.dlqService.DLQStore().DeleteDLQ(ctx, entryID); err != nil {
		return err
	}

	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:  ext.ActionDLQDeleted,
		DLQID: entryID,
	})

	return nil
}

// errNoPurgeCutoff refuses a purge or purge count with a zero cutoff.
var errNoPurgeCutoff = errors.New("dispatch: dlq purge needs a non-zero before time")

// PurgeDLQ deletes every dead letter entry that failed strictly before
// before, and returns how many went. A zero before is refused: it matches
// nothing, so it can only be a caller that forgot to set it. One
// OperatorAction of kind ext.ActionDLQPurged, with Count set, is emitted
// on success, including when nothing matched.
func (eng *Engine) PurgeDLQ(ctx context.Context, before time.Time) (int64, error) {
	if before.IsZero() {
		return 0, errNoPurgeCutoff
	}

	n, err := eng.dlqService.DLQStore().PurgeDLQ(ctx, before)
	if err != nil {
		return 0, err
	}

	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:  ext.ActionDLQPurged,
		Count: n,
	})

	return n, nil
}

// CountDLQPurge is PurgeDLQ's dry run: how many entries a purge with the
// same before would delete, counted on the same boundary. It changes
// nothing and emits nothing. A zero before is refused, as PurgeDLQ
// refuses it.
func (eng *Engine) CountDLQPurge(ctx context.Context, before time.Time) (int64, error) {
	if before.IsZero() {
		return 0, errNoPurgeCutoff
	}

	pl, ok := eng.dlqService.DLQStore().(dlq.PageLister)
	if !ok {
		return 0, errors.New("dispatch: dlq store does not support filtered counts")
	}

	return pl.CountDLQEntries(ctx, dlq.CountOpts{FailedBefore: before})
}
```

- [ ] **Step 11: Wire the enqueuer and share the enqueue tail**

In `engine/engine.go`, in `Build`, find:

```go
	// Create the DLQ service.
	eng.dlqService = dlq.NewService(ds, js)
```

Replace it with:

```go
	// Create the DLQ service. Its replays enqueue through the engine, so
	// a replayed job is checked against the fleet, wakes the pool and is
	// reported to extensions like any other enqueue.
	eng.dlqService = dlq.NewService(ds, js, dlq.WithEnqueuer(eng.enqueuePrepared))
```

`eng.pool` is still nil at this point in `Build`; that is fine, `commitEnqueue` reads it at call time.

Then, at the end of `EnqueueRaw`, find:

```go
	if err := eng.jobStore.EnqueueJob(ctx, j); err != nil {
		return nil, err
	}

	// Nudge the local worker pool so in-process enqueues are picked up
	// immediately instead of waiting out the idle poll backoff.
	if eng.pool != nil {
		eng.pool.Wake()
	}

	eng.extensions.EmitJobEnqueued(ctx, j)
	return j, nil
}
```

Replace it with:

```go
	if err := eng.commitEnqueue(ctx, j); err != nil {
		return nil, err
	}

	return j, nil
}
```

`engine.go`'s imports do not change.

- [ ] **Step 12: Run the tests and see them pass**

Run: `go test -race -count=1 -v -run 'TestReplayDLQ|TestRetryJob_ThenReplay|TestReplayAllDLQ|TestDeleteDLQ|TestPurgeDLQ' ./engine/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected:

```
--- PASS: TestReplayDLQ_EnqueuesAndClaims (0.00s)
--- PASS: TestReplayDLQ_ConcurrentReplaysMakeOneJob (0.00s)
--- PASS: TestReplayDLQ_ThenRetryIsRefused (0.00s)
--- PASS: TestRetryJob_ThenReplayIsRefused (0.00s)
--- PASS: TestReplayDLQ_FailedEnqueueLeavesTheEntryReplayable (0.00s)
--- PASS: TestReplayDLQ_UnschedulableIsRefused (0.00s)
--- PASS: TestReplayAllDLQ_Counts (0.00s)
--- PASS: TestReplayAllDLQ_LimitTakesTheNewest (0.01s)
--- PASS: TestDeleteDLQ (0.00s)
--- PASS: TestPurgeDLQ (0.00s)
ok  	github.com/xraph/dispatch/engine
```

The existing `TestEngine_DLQReplay` in `engine/engine_test.go` replays through `eng.DLQService().Replay` and keeps passing, now through the claim and the engine.

- [ ] **Step 13: Gate**

```bash
gofmt -l engine dlq resource
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./engine/... ./worker/... ./dlq/... ./resource/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
```

Expected: `gofmt` prints nothing, the build succeeds, the second command prints no FAIL lines, the race run prints five `ok` lines (`engine`, `worker`, `dlq`, `resource`, `resource/resourcetest`), and lint prints `0 issues.` With `--build-tags integration` the only finding is the known `store/redis/store_test.go:54` shadow. This was run on 2026-10-07 on top of Task 8a.

- [ ] **Step 14: Commit**

```bash
git add dlq/replay_test.go engine/ops_dlq.go engine/ops_dlq_test.go
git commit --only -m "feat(engine): replay, delete and purge dead letters through the engine

ReplayDLQ mints the new job's ID, claims the entry for it, then enqueues
through the engine. Two operators replaying one entry get one job, and
a replay after a retry (or a retry after a replay) is refused with
ErrDLQAlreadyReplayed. A failed enqueue releases the claim so you can
try again.

dlq.Service.Replay used to enqueue straight into the store and mark the
entry afterwards, so it could run a failure twice. It now claims too,
and the engine hands the service an enqueuer, so DLQService().Replay
callers get the same claim, the fleet capacity check on the carried
resources, the pool wake and the enqueued event. EnqueueRaw shares
that tail.

ReplayAllDLQ, DeleteDLQ, PurgeDLQ and CountDLQPurge round it out. A
purge refuses a zero cutoff, and its dry run counts on the same
boundary the purge deletes on." -- resource/spec.go dlq/doc.go dlq/entry.go dlq/replay.go dlq/service.go dlq/replay_test.go engine/engine.go engine/ops_dlq.go engine/ops_dlq_test.go
git show --stat HEAD | tail -10
```

Expected last line: `9 files changed, 957 insertions(+), 42 deletions(-)`.

**For the REST task.** `api/job_handler.go` `cancelJob` and `retryJob` become thin calls to `eng.CancelJob` and `eng.RetryJob`; the reset logic in `retryJob` now lives in `RetryJob` and the handler's copy should go. `cancelJob`'s "can only cancel pending or retrying jobs" refusal is obsolete, since running jobs cancel now. `api/dlq_handler.go` `replayDLQ` calls `eng.ReplayDLQ`; `replayAllDLQ` calls `eng.ReplayAllDLQ` and drops its own loop and `ListDLQ` read; `ReplayAllDLQResponse.Errors` (an `int64` count today) is `Failed`, and `Conflicts` and the `Errors` messages are new information you can add to the response. `purgeDLQ` calls `eng.PurgeDLQ`, and a dry run calls `eng.CountDLQPurge` with the same `before`. Map `dispatch.ErrInvalidState`, `dispatch.ErrDLQAlreadyReplayed` and `resource.ErrUnschedulable` to 409, and the not-found sentinels to 404 as `mapStoreError` already does. Put the caller on the context with `ext.WithActor` before calling, or every action records an empty actor.

---

### Task 9: Cron writes that cannot undo an operator, run now, and next fire times

The scheduler writes the whole cron row back after every fire (`UpdateCronEntry` in `fireEntry`). If you disable an entry between the scheduler's read and that write, the write puts `enabled = true` back, and the row's old `last_run_at` with it. It also fires from a cron list that can be 30 seconds old, and `InvalidateCronCache` only reaches the scheduler in the process that called it, so a leader on another node keeps firing an entry an operator just turned off. This task moves the post-fire write to the targeted `UpdateCronLastRun` + `UpdateCronNextRun` from Task 1, makes the scheduler re-read an entry under its lock before firing it, adds the four engine operator methods for crons, and adds `cron.NextFires` so the dashboard can preview a schedule with the scheduler's own parser.

Two smaller things fall out. robfig's parser panics on a bare `CRON_TZ=UTC` (it slices up to a space that is not there), so `ParseSchedule` gets a guard that turns that into an error. And the scheduler no longer writes `NextRunAt` into its cached entries: with the memory store those are the store's own rows, so that write raced every other reader under `-race`. It keeps the next times it wrote in a small map instead.

**Files:**
- Create: `cron/next.go`
- Create: `cron/next_test.go`
- Create: `cron/scheduler_operator_test.go`
- Create: `engine/ops_cron.go`
- Create: `engine/ops_cron_test.go`
- Modify: `cron/scheduler.go` (imports at lines 3 to 17; `ParseSchedule` at 99 to 103; the `Scheduler` struct's cache fields at 136 to 138; `NewScheduler` at 175; the end of `cronEntries` at 387 to 391; `tick` and `fireEntry`, lines 393 to 509)
- Modify: `cron/doc.go` (the "Enable / Disable" and "Scheduler" sections)

**Interfaces:**
- Consumes: `cron.TargetedUpdater` (`SetCronEnabled`, `UpdateCronNextRun`, both `dispatch.ErrCronNotFound` when absent) folded into `cron.Store`; `ext.Action`, `ext.ActionCronEnabled`, `ext.ActionCronDisabled`, `ext.ActionCronDeleted`, `ext.ActionCronTriggered`, `ext.WithActor`, `(*ext.Registry).EmitOperatorAction`, `(*ext.Registry).EmitCronFired`; `(*engine.Engine).EnqueueRaw`.
- Produces:

```go
package cron
// NextFires returns the next n fire times strictly after from, in the
// returned location, and that location: UTC unless a CRON_TZ= or TZ=
// prefix names a zone (TZ=Local also reports UTC, because the scheduler
// steps every schedule from a UTC instant). n <= 0 is an error. Fewer than
// n times, possibly none, with a nil error when the schedule runs out
// within robfig's five-year search ("0 0 30 2 *").
func NextFires(schedule string, from time.Time, n int) ([]time.Time, *time.Location, error)

package engine
func (eng *Engine) EnableCron(ctx context.Context, cronID id.CronID) (*cron.Entry, error)  // next_run_at = first NextFires from now; no fire time -> wraps dispatch.ErrInvalidState
func (eng *Engine) DisableCron(ctx context.Context, cronID id.CronID) (*cron.Entry, error) // next_run_at untouched
func (eng *Engine) DeleteCron(ctx context.Context, cronID id.CronID) error
func (eng *Engine) TriggerCron(ctx context.Context, cronID id.CronID) (*job.Job, error)    // works on a disabled entry too
```

Every one returns `dispatch.ErrCronNotFound` (unwrapped, straight from the store) for an unknown ID and emits nothing then. On success each emits exactly one `ext.Action` (`CronID` set; `NewJobID` too for a trigger; `Actor` from `ext.WithActor`). Enable, disable and delete call `InvalidateCronCache` on the local scheduler; trigger leaves the row alone, so it does not. Enable and disable return the entry re-read from the store.

- [ ] **Step 1: Check the base**

Run: `git status --porcelain cron engine && grep -n 'TargetedUpdater' cron/store.go`
Expected: no lines from `git status`, and `cron/store.go` shows `TargetedUpdater` embedded in `Store` (Task 6 folded it in). If `cron.Store` does not embed it yet, stop: this task needs `SetCronEnabled` and `UpdateCronNextRun` on every store.

- [ ] **Step 2: Write the failing NextFires tests**

Create `cron/next_test.go`:

```go
package cron_test

import (
	"testing"
	"time"

	"github.com/xraph/dispatch/cron"
)

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", name, err)
	}
	return loc
}

// utc2026 is a whole minute in 2026, in UTC.
func utc2026(month time.Month, day, hour, minute int) time.Time {
	return time.Date(2026, month, day, hour, minute, 0, 0, time.UTC)
}

func TestNextFires(t *testing.T) {
	tokyo := mustLoad(t, "Asia/Tokyo")

	cases := []struct {
		name     string
		schedule string
		from     time.Time
		n        int
		want     []time.Time // compared as instants
		wantLoc  string
	}{
		{
			name:     "five fields",
			schedule: "*/15 * * * *",
			from:     time.Date(2026, 10, 7, 10, 7, 30, 0, time.UTC),
			n:        3,
			want:     []time.Time{utc2026(10, 7, 10, 15), utc2026(10, 7, 10, 30), utc2026(10, 7, 10, 45)},
			wantLoc:  "UTC",
		},
		{
			name:     "strictly after from",
			schedule: "*/15 * * * *",
			from:     utc2026(10, 7, 10, 15),
			n:        1,
			want:     []time.Time{utc2026(10, 7, 10, 30)},
			wantLoc:  "UTC",
		},
		{
			name:     "every descriptor",
			schedule: "@every 90m",
			from:     utc2026(10, 7, 10, 0),
			n:        3,
			want:     []time.Time{utc2026(10, 7, 11, 30), utc2026(10, 7, 13, 0), utc2026(10, 7, 14, 30)},
			wantLoc:  "UTC",
		},
		{
			name:     "no prefix is UTC whatever zone from is in",
			schedule: "0 9 * * *",
			from:     time.Date(2026, 10, 7, 10, 0, 0, 0, tokyo), // 01:00 UTC
			n:        1,
			want:     []time.Time{utc2026(10, 7, 9, 0)},
			wantLoc:  "UTC",
		},
		{
			name:     "CRON_TZ prefix",
			schedule: "CRON_TZ=Asia/Tokyo 0 9 * * *",
			from:     utc2026(10, 7, 0, 30), // 09:30 in Tokyo
			n:        2,
			want:     []time.Time{utc2026(10, 8, 0, 0), utc2026(10, 9, 0, 0)},
			wantLoc:  "Asia/Tokyo",
		},
		{
			name:     "TZ prefix",
			schedule: "TZ=Europe/London 0 9 * * *",
			from:     utc2026(10, 7, 0, 0), // British Summer Time, UTC+1
			n:        1,
			want:     []time.Time{utc2026(10, 7, 8, 0)},
			wantLoc:  "Europe/London",
		},
		{
			// 8 March 2026 is the US spring-forward day: 02:30 does not
			// exist in New York that night, so the schedule skips it, and
			// the offset moves from -5 to -4 either side of the gap.
			name:     "DST gap in a named zone",
			schedule: "CRON_TZ=America/New_York 30 2 * * *",
			from:     utc2026(3, 6, 12, 0),
			n:        3,
			want:     []time.Time{utc2026(3, 7, 7, 30), utc2026(3, 9, 6, 30), utc2026(3, 10, 6, 30)},
			wantLoc:  "America/New_York",
		},
		{
			// The scheduler steps every schedule from a UTC instant, so a
			// schedule pinned to the process's local zone runs in UTC.
			name:     "TZ=Local runs in UTC like the scheduler",
			schedule: "TZ=Local 0 9 * * *",
			from:     utc2026(10, 7, 0, 0),
			n:        1,
			want:     []time.Time{utc2026(10, 7, 9, 0)},
			wantLoc:  "UTC",
		},
		{
			name:     "every with a prefix reports the zone",
			schedule: "CRON_TZ=Asia/Tokyo @every 1h",
			from:     utc2026(10, 7, 0, 0),
			n:        2,
			want:     []time.Time{utc2026(10, 7, 1, 0), utc2026(10, 7, 2, 0)},
			wantLoc:  "Asia/Tokyo",
		},
		{
			name:     "a schedule that never fires",
			schedule: "0 0 30 2 *", // 30 February
			from:     utc2026(10, 7, 0, 0),
			n:        3,
			want:     nil,
			wantLoc:  "UTC",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, loc, err := cron.NextFires(tc.schedule, tc.from, tc.n)
			if err != nil {
				t.Fatalf("NextFires(%q): %v", tc.schedule, err)
			}
			if loc == nil || loc.String() != tc.wantLoc {
				t.Fatalf("location = %v, want %s", loc, tc.wantLoc)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %d fires %v, want %d %v", len(got), got, len(tc.want), tc.want)
			}
			for i := range got {
				if !got[i].Equal(tc.want[i]) {
					t.Errorf("fire %d = %v, want %v", i, got[i], tc.want[i])
				}
				if got[i].Location().String() != tc.wantLoc {
					t.Errorf("fire %d is in %v, want it in %s", i, got[i].Location(), tc.wantLoc)
				}
			}
		})
	}
}

func TestNextFires_DSTOffsets(t *testing.T) {
	got, _, err := cron.NextFires("CRON_TZ=America/New_York 30 2 * * *", utc2026(3, 6, 12, 0), 2)
	if err != nil {
		t.Fatalf("NextFires: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d fires, want 2", len(got))
	}
	for i, wantOffset := range []int{-5 * 3600, -4 * 3600} {
		if h, m := got[i].Hour(), got[i].Minute(); h != 2 || m != 30 {
			t.Errorf("fire %d wall clock = %02d:%02d, want 02:30", i, h, m)
		}
		if _, off := got[i].Zone(); off != wantOffset {
			t.Errorf("fire %d offset = %d, want %d", i, off, wantOffset)
		}
	}
}

func TestNextFires_RejectsNonPositiveN(t *testing.T) {
	for _, n := range []int{0, -1} {
		got, loc, err := cron.NextFires("@every 1m", utc2026(10, 7, 0, 0), n)
		if err == nil {
			t.Errorf("NextFires(n=%d) error = nil, want one", n)
		}
		if got != nil || loc != nil {
			t.Errorf("NextFires(n=%d) = %v, %v, want nil, nil", n, got, loc)
		}
	}
}

func TestNextFires_RejectsBadSchedules(t *testing.T) {
	for _, schedule := range []string{"", "not-a-cron", "61 * * * *", "CRON_TZ=Not/AZone 0 9 * * *", "CRON_TZ=UTC"} {
		if _, _, err := cron.NextFires(schedule, utc2026(10, 7, 0, 0), 1); err == nil {
			t.Errorf("NextFires(%q) error = nil, want one", schedule)
		}
	}
}

// TestParseSchedule_TZPrefixWithoutSchedule pins the guard in front of
// robfig's parser, which slices a CRON_TZ= or TZ= prefix up to the first
// space and panics when there is none.
func TestParseSchedule_TZPrefixWithoutSchedule(t *testing.T) {
	for _, expr := range []string{"CRON_TZ=UTC", "TZ=Europe/London", "CRON_TZ=UTC\t0 9 * * *"} {
		if _, err := cron.ParseSchedule(expr); err == nil {
			t.Errorf("ParseSchedule(%q) error = nil, want one", expr)
		}
	}
}
```

The DST case is real: 8 March 2026 is the US spring-forward night, there is no 02:30 in New York, and robfig skips the day rather than firing at 03:30. The test pins that so nobody "fixes" it by accident.

- [ ] **Step 3: Run them and see them fail to build**

Run: `go test ./cron -run 'NextFires|TZPrefix'`
Expected:

```
cron/next_test.go:124:26: undefined: cron.NextFires
...
FAIL	github.com/xraph/dispatch/cron [build failed]
```

- [ ] **Step 4: Add NextFires**

Create `cron/next.go`:

```go
package cron

import (
	"fmt"
	"strings"
	"time"
)

// NextFires returns the next n times schedule fires strictly after from,
// and the location the schedule is evaluated in.
//
// It parses with ParseSchedule, so it accepts exactly what the scheduler
// and engine.RegisterCron accept, and it steps the schedule the way the
// scheduler does, from a UTC instant. A schedule with no CRON_TZ= or TZ=
// prefix therefore runs in UTC whatever the process's local zone is, and
// a prefixed one runs in the zone it names. The returned times are in
// that location, so their wall clock reads as the schedule does.
//
// Fewer than n times come back when the schedule runs out. The parser
// searches five years ahead and then gives up, so "0 0 30 2 *" (30
// February) yields none and no error. n must be positive.
func NextFires(schedule string, from time.Time, n int) ([]time.Time, *time.Location, error) {
	if n <= 0 {
		return nil, nil, fmt.Errorf("cron: next fires: n must be positive, got %d", n)
	}

	sched, err := ParseSchedule(schedule)
	if err != nil {
		return nil, nil, err
	}
	loc := scheduleLocation(schedule)

	var fires []time.Time
	t := from.UTC()
	for len(fires) < n {
		t = sched.Next(t)
		if t.IsZero() {
			break
		}
		fires = append(fires, t.In(loc))
	}

	return fires, loc, nil
}

// scheduleLocation is the zone a schedule that ParseSchedule accepted is
// evaluated in. The parser reads a CRON_TZ= or TZ= prefix the same way:
// the zone name runs from the '=' to the first space. A schedule with no
// prefix, or one naming Local, is stepped from the scheduler's UTC clock,
// so it runs in UTC. An @every schedule is a fixed delay no zone changes,
// and it reports the prefix's zone only so a page can show its times
// there.
func scheduleLocation(schedule string) *time.Location {
	if !hasTZPrefix(schedule) {
		return time.UTC
	}
	eq := strings.Index(schedule, "=")
	sp := strings.Index(schedule, " ")
	loc, err := time.LoadLocation(schedule[eq+1 : sp])
	if err != nil || loc == time.Local {
		return time.UTC
	}
	return loc
}

func hasTZPrefix(expr string) bool {
	return strings.HasPrefix(expr, "TZ=") || strings.HasPrefix(expr, "CRON_TZ=")
}
```

- [ ] **Step 5: Run them and see the parser panic**

Run: `go test ./cron -run 'NextFires|TZPrefix'`
Expected: `TestNextFires_RejectsBadSchedules` panics inside robfig:

```
--- FAIL: TestNextFires_RejectsBadSchedules (0.00s)
panic: runtime error: slice bounds out of range [:-1] [recovered, repanicked]
...
github.com/robfig/cron/v3.Parser.Parse(...)
	.../github.com/robfig/cron/v3@v3.0.1/parser.go:99 +0x604
github.com/xraph/dispatch/cron.ParseSchedule(...)
```

`engine.RegisterCron` calls the same `ParseSchedule`, so registering `CRON_TZ=UTC` would panic the caller today.

- [ ] **Step 6: Guard ParseSchedule**

In `cron/scheduler.go`, the import block starts:

```go
import (
	"context"
	"errors"
	"strings"
```

Change those lines to:

```go
import (
	"context"
	"errors"
	"fmt"
	"strings"
```

Then replace:

```go
// ParseSchedule parses a cron expression and returns the schedule.
// Exported for use by engine.RegisterCron.
func ParseSchedule(expr string) (cronlib.Schedule, error) {
	return cronParser.Parse(expr)
}
```

with:

```go
// ParseSchedule parses a cron expression and returns the schedule.
// Exported for use by engine.RegisterCron.
func ParseSchedule(expr string) (cronlib.Schedule, error) {
	// robfig v3.0.1 slices a CRON_TZ= or TZ= prefix up to the first
	// space without checking there is one, so "CRON_TZ=UTC" on its own
	// panics. Give it the error any other malformed spec gets.
	if hasTZPrefix(expr) && !strings.Contains(expr, " ") {
		return nil, fmt.Errorf("time zone prefix without a schedule: %q", expr)
	}
	return cronParser.Parse(expr)
}
```

The check matches robfig's own condition (`strings.Index(spec, " ")` is -1), so every spec it accepted before it still accepts.

- [ ] **Step 7: Run them and see them pass**

Run: `go test ./cron -run 'NextFires|TZPrefix|ParseSchedule' -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected:

```
--- PASS: TestNextFires (0.00s)
--- PASS: TestNextFires_DSTOffsets (0.00s)
--- PASS: TestNextFires_RejectsNonPositiveN (0.00s)
--- PASS: TestNextFires_RejectsBadSchedules (0.00s)
--- PASS: TestParseSchedule_TZPrefixWithoutSchedule (0.00s)
--- PASS: TestParseSchedule (0.00s)
ok  	github.com/xraph/dispatch/cron	0.2s
```

- [ ] **Step 8: Write the failing scheduler regression tests**

Create `cron/scheduler_operator_test.go`. It reuses `stubEmitter`, `enqueueSpy` and `registerDueEntry` from `cron/scheduler_test.go`, which registers an `@every 1s` entry that is already due.

```go
package cron_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cluster"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/memory"
)

// startLeader starts a scheduler on s that already holds leadership, with
// a 20ms tick and a cron cache that never refreshes on its own, so every
// tick runs against what the scheduler listed at startup unless something
// invalidates it. That is the view a leader has of an entry an operator
// changed through another node. The scheduler stops when the test ends.
func startLeader(t *testing.T, s *memory.Store, enqueue cron.EnqueueFunc, logger log.Logger) {
	t.Helper()
	ctx := context.Background()
	workerID := id.NewWorkerID()

	w := &cluster.Worker{
		ID:        workerID,
		Hostname:  "test-host",
		State:     cluster.WorkerActive,
		LastSeen:  time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
	}
	if err := s.RegisterWorker(ctx, w); err != nil {
		t.Fatalf("RegisterWorker: %v", err)
	}
	if ok, err := s.AcquireLeadership(ctx, workerID, 30*time.Second); err != nil || !ok {
		t.Fatalf("AcquireLeadership: ok=%v err=%v", ok, err)
	}

	sched := cron.NewScheduler(
		s, s, enqueue, &stubEmitter{}, workerID, logger,
		cron.WithTickInterval(20*time.Millisecond),
		cron.WithLeaderTTL(10*time.Second),
		cron.WithCronRefreshInterval(time.Hour),
	)
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = sched.Stop(context.Background()) })
}

func waitForFirstFire(t *testing.T, spy *enqueueSpy) {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for spy.Count() == 0 {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for the entry to fire")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// TestScheduler_StaleCacheDoesNotFireDisabledEntry is the regression for
// a disabled cron coming back. The entry is disabled in the store without
// touching this scheduler's cache, as an operator on another node would.
// The scheduler then runs through the entry's next fire time: it must not
// enqueue, and its post-fire write must not put enabled back.
func TestScheduler_StaleCacheDoesNotFireDisabledEntry(t *testing.T) {
	s := memory.New()
	spy := &enqueueSpy{}
	entry := registerDueEntry(t, s, "nightly", "report") // @every 1s, due now
	startLeader(t, s, spy.Fn(), nil)

	waitForFirstFire(t, spy)

	if err := s.SetCronEnabled(context.Background(), entry.ID, false, nil); err != nil {
		t.Fatalf("SetCronEnabled(false): %v", err)
	}
	atDisable := spy.Count()

	// The entry's next fire is at most a second after the first one.
	time.Sleep(1500 * time.Millisecond)

	if got := spy.Count(); got != atDisable {
		t.Errorf("enqueues after disable = %d, want 0", got-atDisable)
	}
	got, err := s.GetCron(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("GetCron: %v", err)
	}
	if got.Enabled {
		t.Error("entry is enabled again after the scheduler ran past its fire time")
	}
}

// TestScheduler_DisableDuringFireSticks lands the operator's disable
// between the scheduler's read of the entry and its post-fire write, the
// window the whole-row UpdateCronEntry write-back used to reopen.
func TestScheduler_DisableDuringFireSticks(t *testing.T) {
	s := memory.New()
	entry := registerDueEntry(t, s, "nightly", "report")

	spy := &enqueueSpy{}
	inner := spy.Fn()
	enqueue := func(ctx context.Context, name string, payload []byte, opts ...job.Option) (id.JobID, error) {
		jobID, err := inner(ctx, name, payload, opts...)
		if disErr := s.SetCronEnabled(ctx, entry.ID, false, nil); disErr != nil {
			t.Errorf("SetCronEnabled(false): %v", disErr)
		}
		return jobID, err
	}
	startLeader(t, s, enqueue, nil)

	waitForFirstFire(t, spy)
	time.Sleep(1500 * time.Millisecond)

	if got := spy.Count(); got != 1 {
		t.Errorf("enqueues = %d, want exactly the one that raced the disable", got)
	}
	got, err := s.GetCron(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("GetCron: %v", err)
	}
	if got.Enabled {
		t.Error("the post-fire write put enabled back")
	}
	if got.LastRunAt == nil {
		t.Error("LastRunAt not recorded for the fire")
	}
	if got.NextRunAt == nil || !got.NextRunAt.After(*entry.NextRunAt) {
		t.Errorf("NextRunAt = %v, want it moved past the fire", got.NextRunAt)
	}
}

// TestScheduler_EntryDeletedDuringFire deletes the entry between the
// enqueue and the post-fire writes. The scheduler logs that at debug and
// carries on; it is not an error.
func TestScheduler_EntryDeletedDuringFire(t *testing.T) {
	s := memory.New()
	entry := registerDueEntry(t, s, "nightly", "report")

	spy := &enqueueSpy{}
	inner := spy.Fn()
	var once sync.Once
	enqueue := func(ctx context.Context, name string, payload []byte, opts ...job.Option) (id.JobID, error) {
		jobID, err := inner(ctx, name, payload, opts...)
		once.Do(func() {
			if delErr := s.DeleteCron(ctx, entry.ID); delErr != nil {
				t.Errorf("DeleteCron: %v", delErr)
			}
		})
		return jobID, err
	}
	logger := log.NewTestLogger()
	startLeader(t, s, enqueue, logger)

	waitForFirstFire(t, spy)
	time.Sleep(200 * time.Millisecond)

	if got := spy.Count(); got != 1 {
		t.Errorf("enqueues = %d, want 1", got)
	}
	if _, err := s.GetCron(context.Background(), entry.ID); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Fatalf("GetCron after delete: %v, want ErrCronNotFound", err)
	}
	tl, ok := logger.(*log.TestLogger)
	if !ok {
		t.Fatalf("logger is %T, want *log.TestLogger", logger)
	}
	if n := tl.CountLogs("ERROR"); n != 0 {
		t.Errorf("scheduler logged %d errors for an entry deleted mid-fire: %v", n, tl.GetLogsByLevel("ERROR"))
	}
	if n := tl.CountLogs("DEBUG"); n == 0 {
		t.Error("no debug log for the entry deleted mid-fire")
	}
}

// TestScheduler_FiresOncePerDueTime checks that the scheduler does not
// fire again on the next tick while its cache still holds the old
// NextRunAt: one due time, one enqueue.
func TestScheduler_FiresOncePerDueTime(t *testing.T) {
	s := memory.New()
	ctx := context.Background()
	past := time.Now().UTC().Add(-time.Second)
	entry := &cron.Entry{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewCronID(),
		Name:      "hourly",
		Schedule:  "@every 1h",
		JobName:   "report",
		NextRunAt: &past,
		Enabled:   true,
	}
	if err := s.RegisterCron(ctx, entry); err != nil {
		t.Fatalf("RegisterCron: %v", err)
	}
	spy := &enqueueSpy{}
	startLeader(t, s, spy.Fn(), nil)

	waitForFirstFire(t, spy)
	time.Sleep(300 * time.Millisecond) // ~15 more ticks

	if got := spy.Count(); got != 1 {
		t.Errorf("enqueues = %d, want 1", got)
	}
}
```

`TestScheduler_FiresOncePerDueTime` passes before the change too. It is there for Step 10: once the scheduler stops writing into its cached rows, something else has to stop it firing the same due time on every tick.

- [ ] **Step 9: Run them and see the bug**

Run: `go test -count=1 ./cron -run 'StaleCache|DisableDuringFire|DeletedDuringFire|FiresOncePerDueTime'`
Expected (counts can differ by one with timing; IDs and times elided):

```
--- FAIL: TestScheduler_StaleCacheDoesNotFireDisabledEntry (1.53s)
    scheduler_operator_test.go:90: enqueues after disable = 2, want 0
    scheduler_operator_test.go:97: entry is enabled again after the scheduler ran past its fire time
--- FAIL: TestScheduler_DisableDuringFireSticks (1.53s)
    scheduler_operator_test.go:123: enqueues = 2, want exactly the one that raced the disable
    scheduler_operator_test.go:130: the post-fire write put enabled back
    scheduler_operator_test.go:133: LastRunAt not recorded for the fire
    scheduler_operator_test.go:136: NextRunAt = <time>, want it moved past the fire
--- FAIL: TestScheduler_EntryDeletedDuringFire (0.22s)
    scheduler_operator_test.go:176: scheduler logged 7 errors for an entry deleted mid-fire: [{ERROR update cron last run error ...} ...]
    scheduler_operator_test.go:179: no debug log for the entry deleted mid-fire
FAIL
```

That is the reported bug: the disable comes back, and so does the old `LastRunAt`, because the whole-row write puts the scheduler's stale copy over both.

- [ ] **Step 10: Change the scheduler**

All edits are in `cron/scheduler.go`.

(a) Add the root package import. Replace:

```go
	"github.com/xraph/dispatch/cluster"
```

with:

```go
	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cluster"
```

(`cron/entry.go` already imports `github.com/xraph/dispatch`, so there is no cycle.)

(b) In the `Scheduler` struct, replace:

```go
	cronDirty    atomic.Bool
	cronCache    []*Entry
	lastCronList time.Time
```

with:

```go
	cronDirty    atomic.Bool
	cronCache    []*Entry
	lastCronList time.Time

	// nextRuns holds the next fire time this scheduler wrote for each
	// entry it fired since the cache was last listed, keyed by entry ID.
	// tick prefers it to the cached NextRunAt, so an entry does not fire
	// again on the next tick while the cache still holds the old time.
	// The cached entries are never written: with the memory store they
	// are the store's own rows. Owned by the tickLoop goroutine, and
	// emptied whenever the cache is re-listed.
	nextRuns map[string]time.Time
```

(c) In `NewScheduler`, replace:

```go
		parsed:              make(map[string]cronlib.Schedule),
```

with:

```go
		parsed:              make(map[string]cronlib.Schedule),
		nextRuns:            make(map[string]time.Time),
```

(d) At the end of `cronEntries`, replace:

```go
	s.cronCache = entries
	s.lastCronList = time.Now()
	s.cronDirty.Store(false)
	return entries
}
```

with:

```go
	s.cronCache = entries
	s.lastCronList = time.Now()
	s.cronDirty.Store(false)
	// The fresh list carries every next_run_at this scheduler wrote.
	clear(s.nextRuns)
	return entries
}
```

(e) Replace everything from the line `func (s *Scheduler) tick() {` down to, but not including, the line `// getOrParseSchedule caches parsed cron expressions.` That span is the old `tick` and the old `fireEntry`, which ends with the `s.logger.Info("cron fired", ...)` call and its closing brace. Put this in its place (keep one blank line before the `// getOrParseSchedule` comment):

```go
func (s *Scheduler) tick() {
	// Consult the in-memory lease instead of issuing a GetLeader read on
	// every tick; leaderLoop keeps it current at renewInterval cadence.
	if !s.amLeader() {
		return
	}

	now := time.Now().UTC()
	for _, entry := range s.cronEntries() {
		if !entry.Enabled {
			continue
		}
		due := entry.NextRunAt
		if next, ok := s.nextRuns[entry.ID.String()]; ok {
			due = &next
		}
		if due == nil || due.After(now) {
			continue
		}
		s.fireEntry(s.cancelCtx, entry.ID, now)
	}
}

// fireEntry fires one entry the cache says is due.
//
// The cache can be cronRefreshInterval old, and an operator acting
// through another node invalidates only that node's cache, so a cached
// row is never enough to fire on. Under the entry's lock, fireEntry
// re-reads it and fires only if the store still has it enabled and due.
// That is one GetCron per fire, not per tick. An operator's disable that
// lands after the re-read still sees the fire it raced go out, but
// nothing here can undo the disable: the post-fire writes are
// UpdateCronLastRun and UpdateCronNextRun, and neither touches enabled.
func (s *Scheduler) fireEntry(ctx context.Context, cronID id.CronID, now time.Time) {
	// Acquire per-entry lock under a bounded subcontext.
	acqCtx, acqCancel := s.callCtx()
	acquired, err := s.cronStore.AcquireCronLock(acqCtx, cronID, s.workerID, s.lockTTL)
	acqCancel()
	if err != nil {
		s.logCronErr("acquire cron lock error", cronID, err)
		return
	}
	if !acquired {
		return // Another worker got it.
	}

	getCtx, getCancel := s.callCtx()
	entry, err := s.cronStore.GetCron(getCtx, cronID)
	getCancel()
	if err != nil {
		s.logCronErr("re-read cron entry error", cronID, err)
		if !errors.Is(err, dispatch.ErrCronNotFound) {
			s.releaseCronLock(cronID)
		}
		return
	}
	if !entry.Enabled || entry.NextRunAt == nil || entry.NextRunAt.After(now) {
		// Disabled, or fired or rescheduled since the cache was listed.
		// Re-list on the next tick so the cache stops offering it.
		s.cronDirty.Store(true)
		s.releaseCronLock(cronID)
		return
	}

	// Enqueue the job with optional queue override.
	var enqOpts []job.Option
	if entry.Queue != "" {
		enqOpts = append(enqOpts, job.WithQueue(entry.Queue))
	}
	enqCtx, enqCancel := s.callCtx()
	jobID, enqErr := s.enqueue(enqCtx, entry.JobName, entry.Payload, enqOpts...)
	enqCancel()
	if enqErr != nil {
		s.logger.Error("cron enqueue error",
			log.String("cron_name", entry.Name),
			log.String("job_name", entry.JobName),
			log.String("error", enqErr.Error()),
		)
		s.releaseCronLock(cronID)
		return
	}

	// Record the fire with targeted writes only. A whole-row write here
	// would put back whatever enabled was when the row was read.
	lrCtx, lrCancel := s.callCtx()
	err = s.cronStore.UpdateCronLastRun(lrCtx, cronID, now)
	lrCancel()
	if err != nil {
		s.logCronErr("update cron last run error", cronID, err)
	}

	sched, parseErr := s.getOrParseSchedule(entry.Schedule)
	if parseErr != nil {
		s.logger.Error("parse cron schedule error",
			log.String("cron_name", entry.Name),
			log.String("schedule", entry.Schedule),
			log.String("error", parseErr.Error()),
		)
	} else {
		next := sched.Next(now)
		s.nextRuns[cronID.String()] = next
		nrCtx, nrCancel := s.callCtx()
		err = s.cronStore.UpdateCronNextRun(nrCtx, cronID, next)
		nrCancel()
		if err != nil {
			s.logCronErr("update cron next run error", cronID, err)
		}
	}

	s.releaseCronLock(cronID)

	// Emit hook.
	if s.emitter != nil {
		s.emitter.EmitCronFired(ctx, entry.Name, jobID)
	}

	s.logger.Info("cron fired",
		log.String("cron_name", entry.Name),
		log.String("job_name", entry.JobName),
		log.String("job_id", jobID.String()),
	)
}

// releaseCronLock gives up this worker's lock on an entry.
func (s *Scheduler) releaseCronLock(cronID id.CronID) {
	relCtx, relCancel := s.callCtx()
	err := s.cronStore.ReleaseCronLock(relCtx, cronID, s.workerID)
	relCancel()
	if err != nil {
		s.logCronErr("release cron lock error", cronID, err)
	}
}

// logCronErr logs a failed store call on one entry. An entry that is no
// longer there was deleted after the cache listed it, which is ordinary,
// so that is logged at debug and the cache is re-listed on the next tick.
// Anything else is an error.
func (s *Scheduler) logCronErr(msg string, cronID id.CronID, err error) {
	if errors.Is(err, dispatch.ErrCronNotFound) {
		s.cronDirty.Store(true)
		s.logger.Debug("cron entry deleted while firing",
			log.String("cron_id", cronID.String()),
			log.String("step", msg),
		)
		return
	}
	s.logger.Error(msg,
		log.String("cron_id", cronID.String()),
		log.String("error", err.Error()),
	)
}
```

Why the re-read and not just the cache: `InvalidateCronCache` is process-local. A dashboard request that lands on a non-leader node invalidates that node's scheduler, not the leader's, so the leader's list can be up to `cronRefreshInterval` (30s) stale. The re-read costs one `GetCron` per fire, not per tick, and closes that. A disable that lands after the re-read can still see the one fire it raced go out, but the post-fire writes never touch `enabled`, so nothing undoes it.

- [ ] **Step 11: Run the cron package with the race detector**

Run: `go test -race -count=1 ./cron`
Expected: `ok  	github.com/xraph/dispatch/cron	7.1s` (about seven seconds; the regression tests each wait out a fire window).

- [ ] **Step 12: Write the failing engine tests**

Create `engine/ops_cron_test.go`:

```go
package engine_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/memory"
)

// cronOpsRecorder records operator actions and cron fires.
type cronOpsRecorder struct {
	mu      sync.Mutex
	actions []ext.Action
	fired   []cronOpsFire
}

type cronOpsFire struct {
	name  string
	jobID id.JobID
	at    time.Time
}

func (r *cronOpsRecorder) Name() string { return "cron-ops-recorder" }

func (r *cronOpsRecorder) OnOperatorAction(_ context.Context, a ext.Action) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.actions = append(r.actions, a)
	return nil
}

func (r *cronOpsRecorder) OnCronFired(_ context.Context, name string, jobID id.JobID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fired = append(r.fired, cronOpsFire{name: name, jobID: jobID, at: time.Now()})
	return nil
}

func (r *cronOpsRecorder) getActions() []ext.Action {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ext.Action(nil), r.actions...)
}

func (r *cronOpsRecorder) getFired() []cronOpsFire {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]cronOpsFire(nil), r.fired...)
}

// newCronOpsEngine builds an engine on a memory store with a 20ms cron
// tick and a cron cache that never refreshes on its own, so the scheduler
// sees an operator's change only through InvalidateCronCache.
func newCronOpsEngine(t *testing.T) (*engine.Engine, *memory.Store, *cronOpsRecorder) {
	t.Helper()
	s := memory.New()
	d, err := dispatch.New(
		dispatch.WithStore(s),
		dispatch.WithCronTickInterval(20*time.Millisecond),
		dispatch.WithCronRefreshInterval(time.Hour),
	)
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}
	rec := &cronOpsRecorder{}
	eng, err := engine.Build(d, engine.WithExtension(rec))
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}
	engine.Register(eng, job.NewDefinition("report", func(_ context.Context, _ struct{}) error {
		return nil
	}))
	return eng, s, rec
}

func startCronOpsEngine(t *testing.T, eng *engine.Engine) {
	t.Helper()
	if err := eng.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = eng.Stop(ctx)
	})
}

// addCron stores an entry directly, so a test controls every field.
func addCron(t *testing.T, s *memory.Store, schedule string, enabled bool, nextRunAt time.Time) *cron.Entry {
	t.Helper()
	next := nextRunAt
	e := &cron.Entry{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewCronID(),
		Name:      "nightly-" + id.NewCronID().String(),
		Schedule:  schedule,
		JobName:   "report",
		Queue:     "reports",
		Payload:   []byte(`{"kind":"sales"}`),
		NextRunAt: &next,
		Enabled:   enabled,
	}
	if err := s.RegisterCron(context.Background(), e); err != nil {
		t.Fatalf("RegisterCron: %v", err)
	}
	return e
}

func getCron(t *testing.T, s *memory.Store, cronID id.CronID) cron.Entry {
	t.Helper()
	e, err := s.GetCron(context.Background(), cronID)
	if err != nil {
		t.Fatalf("GetCron: %v", err)
	}
	return *e
}

func wantOneAction(t *testing.T, rec *cronOpsRecorder, kind ext.ActionKind, cronID id.CronID) ext.Action {
	t.Helper()
	actions := rec.getActions()
	if len(actions) != 1 {
		t.Fatalf("operator actions = %d (%v), want 1", len(actions), actions)
	}
	a := actions[0]
	if a.Kind != kind {
		t.Errorf("action kind = %q, want %q", a.Kind, kind)
	}
	if a.CronID.String() != cronID.String() {
		t.Errorf("action cron = %s, want %s", a.CronID, cronID)
	}
	if a.Actor != "user_7" {
		t.Errorf("action actor = %q, want user_7", a.Actor)
	}
	if a.At.IsZero() {
		t.Error("action At is zero")
	}
	return a
}

func TestEngine_DisableCron(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	next := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	e := addCron(t, s, "@every 1h", true, next)
	ctx := ext.WithActor(context.Background(), "user_7")

	got, err := eng.DisableCron(ctx, e.ID)
	if err != nil {
		t.Fatalf("DisableCron: %v", err)
	}
	if got.Enabled {
		t.Error("returned entry is still enabled")
	}
	stored := getCron(t, s, e.ID)
	if stored.Enabled {
		t.Error("stored entry is still enabled")
	}
	if stored.NextRunAt == nil || !stored.NextRunAt.Equal(next) {
		t.Errorf("NextRunAt = %v, want it left at %v", stored.NextRunAt, next)
	}
	wantOneAction(t, rec, ext.ActionCronDisabled, e.ID)
}

func TestEngine_EnableCronComputesNextFromNow(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	e := addCron(t, s, "@every 1h", false, time.Now().UTC().Add(-3*time.Hour))
	ctx := ext.WithActor(context.Background(), "user_7")

	before := time.Now().UTC()
	got, err := eng.EnableCron(ctx, e.ID)
	if err != nil {
		t.Fatalf("EnableCron: %v", err)
	}
	if !got.Enabled {
		t.Error("returned entry is not enabled")
	}
	stored := getCron(t, s, e.ID)
	if !stored.Enabled {
		t.Error("stored entry is not enabled")
	}
	if stored.NextRunAt == nil || stored.NextRunAt.Before(before.Add(59*time.Minute)) || stored.NextRunAt.After(before.Add(61*time.Minute)) {
		t.Errorf("NextRunAt = %v, want about an hour after %v", stored.NextRunAt, before)
	}
	wantOneAction(t, rec, ext.ActionCronEnabled, e.ID)
}

func TestEngine_EnableCronRefusesAScheduleThatNeverFires(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	e := addCron(t, s, "0 0 30 2 *", false, time.Now().UTC().Add(-time.Hour)) // 30 February

	_, err := eng.EnableCron(context.Background(), e.ID)
	if !errors.Is(err, dispatch.ErrInvalidState) {
		t.Fatalf("EnableCron error = %v, want ErrInvalidState", err)
	}
	if getCron(t, s, e.ID).Enabled {
		t.Error("entry was enabled anyway")
	}
	if n := len(rec.getActions()); n != 0 {
		t.Errorf("operator actions = %d, want 0 for a refused enable", n)
	}
}

// TestEngine_EnableCronDoesNotCatchUp enables an entry whose old next run
// is long past. The scheduler must not fire it straight away, and must
// still pick it up at the new next run without waiting out the hour-long
// cache refresh, which only EnableCron's cache invalidation can make
// happen.
func TestEngine_EnableCronDoesNotCatchUp(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	// @every rounds its next fire down to a whole second, so with 2s the
	// first fire after enabling lands between one and two seconds out.
	e := addCron(t, s, "@every 2s", false, time.Now().UTC().Add(-time.Hour))
	startCronOpsEngine(t, eng)
	time.Sleep(100 * time.Millisecond) // leadership and the first cron list

	enabledAt := time.Now()
	if _, err := eng.EnableCron(context.Background(), e.ID); err != nil {
		t.Fatalf("EnableCron: %v", err)
	}

	time.Sleep(800 * time.Millisecond)
	if fired := rec.getFired(); len(fired) != 0 {
		t.Fatalf("entry fired %v after enable, want no catch-up fire", fired[0].at.Sub(enabledAt))
	}

	deadline := time.After(4 * time.Second)
	for len(rec.getFired()) == 0 {
		select {
		case <-deadline:
			t.Fatal("entry never fired after enable; the scheduler cache was not invalidated")
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// TestEngine_DisableCronStopsARunningSchedule is the end-to-end
// regression: once DisableCron returns, the scheduler fires the entry no
// more, and nothing it writes turns the entry back on.
func TestEngine_DisableCronStopsARunningSchedule(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	e := addCron(t, s, "@every 1s", true, time.Now().UTC().Add(-time.Second))
	startCronOpsEngine(t, eng)

	deadline := time.After(3 * time.Second)
	for len(rec.getFired()) == 0 {
		select {
		case <-deadline:
			t.Fatal("entry never fired")
		case <-time.After(20 * time.Millisecond):
		}
	}

	if _, err := eng.DisableCron(context.Background(), e.ID); err != nil {
		t.Fatalf("DisableCron: %v", err)
	}
	atDisable := len(rec.getFired())

	time.Sleep(1500 * time.Millisecond)

	if got := len(rec.getFired()); got != atDisable {
		t.Errorf("fires after DisableCron = %d, want 0", got-atDisable)
	}
	if getCron(t, s, e.ID).Enabled {
		t.Error("entry is enabled again")
	}
}

func TestEngine_DeleteCron(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	e := addCron(t, s, "@every 1h", true, time.Now().UTC().Add(time.Hour))
	ctx := ext.WithActor(context.Background(), "user_7")

	if err := eng.DeleteCron(ctx, e.ID); err != nil {
		t.Fatalf("DeleteCron: %v", err)
	}
	if _, err := s.GetCron(context.Background(), e.ID); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Fatalf("GetCron after delete: %v, want ErrCronNotFound", err)
	}
	wantOneAction(t, rec, ext.ActionCronDeleted, e.ID)

	if err := eng.DeleteCron(ctx, e.ID); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("second DeleteCron error = %v, want ErrCronNotFound", err)
	}
	if n := len(rec.getActions()); n != 1 {
		t.Errorf("operator actions = %d after a failed delete, want still 1", n)
	}
}

func TestEngine_TriggerCron(t *testing.T) {
	eng, s, rec := newCronOpsEngine(t)
	next := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	e := addCron(t, s, "@every 1h", true, next)
	lastRun := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	if err := s.UpdateCronLastRun(context.Background(), e.ID, lastRun); err != nil {
		t.Fatalf("UpdateCronLastRun: %v", err)
	}
	ctx := ext.WithActor(context.Background(), "user_7")

	j, err := eng.TriggerCron(ctx, e.ID)
	if err != nil {
		t.Fatalf("TriggerCron: %v", err)
	}
	if j.Name != "report" || j.Queue != "reports" || string(j.Payload) != `{"kind":"sales"}` {
		t.Errorf("job = %s on %s with %s, want report on reports with the entry's payload", j.Name, j.Queue, j.Payload)
	}
	if j.State != job.StatePending {
		t.Errorf("job state = %s, want pending", j.State)
	}

	page, err := s.ListJobs(context.Background(), job.ListJobsOpts{})
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	if len(page.Jobs) != 1 || page.Jobs[0].ID.String() != j.ID.String() {
		t.Fatalf("jobs in store = %d, want exactly the triggered one", len(page.Jobs))
	}

	stored := getCron(t, s, e.ID)
	if stored.NextRunAt == nil || !stored.NextRunAt.Equal(next) {
		t.Errorf("NextRunAt = %v, want it left at %v", stored.NextRunAt, next)
	}
	if stored.LastRunAt == nil || !stored.LastRunAt.Equal(lastRun) {
		t.Errorf("LastRunAt = %v, want it left at %v", stored.LastRunAt, lastRun)
	}

	fired := rec.getFired()
	if len(fired) != 1 || fired[0].name != e.Name || fired[0].jobID.String() != j.ID.String() {
		t.Errorf("cron fired hooks = %v, want one for %s with job %s", fired, e.Name, j.ID)
	}
	a := wantOneAction(t, rec, ext.ActionCronTriggered, e.ID)
	if a.NewJobID.String() != j.ID.String() {
		t.Errorf("action NewJobID = %s, want %s", a.NewJobID, j.ID)
	}
}

func TestEngine_CronOpsUnknownEntry(t *testing.T) {
	eng, _, rec := newCronOpsEngine(t)
	ctx := context.Background()
	unknown := id.NewCronID()

	if _, err := eng.EnableCron(ctx, unknown); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("EnableCron error = %v, want ErrCronNotFound", err)
	}
	if _, err := eng.DisableCron(ctx, unknown); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("DisableCron error = %v, want ErrCronNotFound", err)
	}
	if err := eng.DeleteCron(ctx, unknown); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("DeleteCron error = %v, want ErrCronNotFound", err)
	}
	if _, err := eng.TriggerCron(ctx, unknown); !errors.Is(err, dispatch.ErrCronNotFound) {
		t.Errorf("TriggerCron error = %v, want ErrCronNotFound", err)
	}
	if n := len(rec.getActions()); n != 0 {
		t.Errorf("operator actions = %d, want 0", n)
	}
}
```

`TestEngine_EnableCronDoesNotCatchUp` checks two things at once. Without the next-run recompute, the scheduler fires within one tick of the enable (about 20ms). Without the cache invalidation it never fires at all, because the cache refresh is an hour. `@every` rounds its next time down to a whole second, which is why the test uses `@every 2s` and only asserts quiet for 800ms.

- [ ] **Step 13: Run them and see them fail to build**

Run: `go vet ./engine`
Expected:

```
vet: engine/ops_cron_test.go:155:18: eng.DisableCron undefined (type *engine.Engine has no field or method DisableCron)
```

- [ ] **Step 14: Add the engine methods**

Create `engine/ops_cron.go`:

```go
package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

// EnableCron turns a cron entry on and returns it as stored.
//
// The next fire time is computed from now, so an entry that was off past
// its old next_run_at does not fire a catch-up the moment it comes back.
// For an @every schedule that restarts the interval, and enabling an
// entry that is already on does the same. A schedule with no fire time in
// the next five years (30 February) is refused with a wrapped
// dispatch.ErrInvalidState, since the scheduler would have nothing to
// wait for. dispatch.ErrCronNotFound when the entry does not exist.
func (eng *Engine) EnableCron(ctx context.Context, cronID id.CronID) (*cron.Entry, error) {
	entry, err := eng.cronStore.GetCron(ctx, cronID)
	if err != nil {
		return nil, err
	}

	fires, _, err := cron.NextFires(entry.Schedule, time.Now().UTC(), 1)
	if err != nil {
		return nil, fmt.Errorf("enable cron %s: %w", cronID, err)
	}
	if len(fires) == 0 {
		return nil, fmt.Errorf("%w: cron %s schedule %q has no fire time in the next five years",
			dispatch.ErrInvalidState, cronID, entry.Schedule)
	}
	next := fires[0].UTC()

	if err := eng.cronStore.SetCronEnabled(ctx, cronID, true, &next); err != nil {
		return nil, err
	}
	return eng.cronToggled(ctx, cronID, ext.ActionCronEnabled)
}

// DisableCron turns a cron entry off and returns it as stored. Its
// next_run_at is left as it was. dispatch.ErrCronNotFound when the entry
// does not exist.
func (eng *Engine) DisableCron(ctx context.Context, cronID id.CronID) (*cron.Entry, error) {
	if err := eng.cronStore.SetCronEnabled(ctx, cronID, false, nil); err != nil {
		return nil, err
	}
	return eng.cronToggled(ctx, cronID, ext.ActionCronDisabled)
}

// DeleteCron removes a cron entry. dispatch.ErrCronNotFound when it does
// not exist.
func (eng *Engine) DeleteCron(ctx context.Context, cronID id.CronID) error {
	if err := eng.cronStore.DeleteCron(ctx, cronID); err != nil {
		return err
	}
	eng.invalidateCronCache()
	eng.extensions.EmitOperatorAction(ctx, ext.Action{Kind: ext.ActionCronDeleted, CronID: cronID})
	return nil
}

// TriggerCron enqueues the entry's job now, with its payload and queue,
// the same job a scheduled fire makes. The schedule is untouched:
// next_run_at and last_run_at stay as they were, so the entry still fires
// at its next scheduled time. A disabled entry can be triggered too, since
// running it by hand is exactly what an operator asks for here. Hooks see
// CronFired with the new job, as for a scheduled fire, and then the
// operator action. dispatch.ErrCronNotFound when the entry does not exist.
func (eng *Engine) TriggerCron(ctx context.Context, cronID id.CronID) (*job.Job, error) {
	entry, err := eng.cronStore.GetCron(ctx, cronID)
	if err != nil {
		return nil, err
	}

	var opts []job.Option
	if entry.Queue != "" {
		opts = append(opts, job.WithQueue(entry.Queue))
	}
	j, err := eng.EnqueueRaw(ctx, entry.JobName, entry.Payload, opts...)
	if err != nil {
		return nil, fmt.Errorf("trigger cron %s: %w", cronID, err)
	}

	eng.extensions.EmitCronFired(ctx, entry.Name, j.ID)
	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:     ext.ActionCronTriggered,
		CronID:   cronID,
		NewJobID: j.ID,
	})
	return j, nil
}

// cronToggled finishes an enable or a disable once the write has landed:
// it makes the local scheduler re-list before its next tick, emits the
// action, and reads the entry back for the caller.
func (eng *Engine) cronToggled(ctx context.Context, cronID id.CronID, kind ext.ActionKind) (*cron.Entry, error) {
	eng.invalidateCronCache()
	eng.extensions.EmitOperatorAction(ctx, ext.Action{Kind: kind, CronID: cronID})
	return eng.cronStore.GetCron(ctx, cronID)
}

// invalidateCronCache reaches only this process's scheduler. A leader on
// another node keeps its cached list until its own refresh, which is why
// the scheduler re-reads an entry under its lock before firing it.
func (eng *Engine) invalidateCronCache() {
	if eng.scheduler != nil {
		eng.scheduler.InvalidateCronCache()
	}
}
```

- [ ] **Step 15: Run them and see them pass**

Run: `go test -race -count=1 ./engine -run 'Cron' -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected:

```
--- PASS: TestEngine_CronFiresAndEnqueuesJob (1.03s)
--- PASS: TestEngine_CronDisabledSkipped (2.00s)
--- PASS: TestEngine_CronExtensionHookFires (1.04s)
--- PASS: TestEngine_RegisterCronIdempotent (0.00s)
--- PASS: TestEngine_RegisterCronInvalidSchedule (0.00s)
--- PASS: TestEngine_DisableCron (0.00s)
--- PASS: TestEngine_EnableCronComputesNextFromNow (0.00s)
--- PASS: TestEngine_EnableCronRefusesAScheduleThatNeverFires (0.00s)
--- PASS: TestEngine_EnableCronDoesNotCatchUp (1.5s)
--- PASS: TestEngine_DisableCronStopsARunningSchedule (1.54s)
--- PASS: TestEngine_DeleteCron (0.00s)
--- PASS: TestEngine_TriggerCron (0.00s)
--- PASS: TestEngine_CronOpsUnknownEntry (0.00s)
ok  	github.com/xraph/dispatch/engine	8.0s
```

- [ ] **Step 16: Update the package doc**

In `cron/doc.go`, replace:

```go
// Cron entries can be enabled or disabled at runtime via the admin API
// (POST /v1/crons/:cronId/enable and POST /v1/crons/:cronId/disable).
//
// # Scheduler
//
// The [Scheduler] evaluates due entries on every tick, acquires a distributed
// lock on each entry, enqueues the corresponding job, and updates LastRunAt
// and NextRunAt. The [ext.CronFired] extension hook fires after each enqueue.
```

with:

```go
// Cron entries can be enabled or disabled at runtime via the admin API
// (POST /v1/crons/:cronId/enable and POST /v1/crons/:cronId/disable).
// Operator code goes through the engine's EnableCron, DisableCron,
// DeleteCron and TriggerCron. Enabling computes the next fire time from
// now, so an entry that was off past its old one does not fire a catch-up.
// [NextFires] previews a schedule's next fire times.
//
// # Scheduler
//
// The [Scheduler] evaluates due entries on every tick, acquires a distributed
// lock on each entry, re-reads it, and fires only if the store still has it
// enabled and due. It enqueues the corresponding job and records LastRunAt
// and NextRunAt with targeted writes that never touch Enabled, so a fire
// cannot undo an operator's disable. The [ext.CronFired] extension hook
// fires after each enqueue.
```

- [ ] **Step 17: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./cron/... ./engine/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: the build succeeds and the first test command prints nothing; the race run prints `ok` for `cron` and `engine`; the first lint prints `0 issues.`; the integration-tag lint prints only the known `store/redis/store_test.go:54:5: shadow` finding, which is not this task's.

- [ ] **Step 18: Commit**

```bash
git add cron/next.go cron/next_test.go cron/scheduler_operator_test.go engine/ops_cron.go engine/ops_cron_test.go
git commit --only -m "feat(cron): keep scheduler fires off an operator's disable, add run now and next fire times

The scheduler used to write the whole cron row back after a fire. If you
disabled an entry between the scheduler's read and that write, the write
put enabled back, and the old LastRunAt with it. A fire is now recorded
with UpdateCronLastRun and UpdateCronNextRun, which never touch enabled.
The scheduler also re-reads an entry under its lock before firing it,
because InvalidateCronCache only reaches the node it ran on and a leader
elsewhere could fire from a list up to 30s old. An entry deleted mid-fire
is logged at debug.

The engine gains EnableCron, DisableCron, DeleteCron and TriggerCron, each
emitting one operator action. Enabling computes the next fire from now, so
an entry that sat disabled past its old time doesn't fire a catch-up.
cron.NextFires previews a schedule with the scheduler's own parser, and
ParseSchedule no longer panics on a bare CRON_TZ= prefix." -- cron/next.go cron/next_test.go cron/scheduler_operator_test.go cron/scheduler.go cron/doc.go engine/ops_cron.go engine/ops_cron_test.go
git show --stat HEAD | tail -9
```

Expected: seven files, `cron/doc.go`, `cron/next.go`, `cron/next_test.go`, `cron/scheduler.go`, `cron/scheduler_operator_test.go`, `engine/ops_cron.go`, `engine/ops_cron_test.go`, about 1056 insertions and 44 deletions.

**For the REST switch (later task):** `api/cron_handler.go`'s `enableCron` and `disableCron` do `GetCron`, flip `entry.Enabled`, and `UpdateCronEntry` the whole row. That is the same lost-update shape this task removes from the scheduler, it never recomputes `NextRunAt` (so enabling an entry that was off past its time fires a catch-up on the next tick), it never invalidates the scheduler cache, and with the memory store it mutates the store's own row outside the store lock. Replace both bodies with `a.eng.EnableCron` / `a.eng.DisableCron`, and `deleteCron` with `a.eng.DeleteCron`; the `cs, ok := ....(cron.Store)` assertions go with them. `dispatch.ErrCronNotFound` still maps to 404 through `mapStoreError`; the never-fires refusal from `EnableCron` wraps `dispatch.ErrInvalidState`, which `mapStoreError` does not map yet (it handles only the not-found sentinels), so the REST task has to add the 409 for it along with the other new refusals. After that switch nothing outside tests calls `UpdateCronEntry`.

---

### Task 10: Replay a workflow from a step without running it twice

Today `workflow.Runner.ReplayFrom` (`workflow/debug.go`) runs the whole tail of a workflow synchronously in the caller, takes no claim on the run (it reads the run, deletes checkpoints, then writes `State = running` with a whole-row `UpdateRun`), and looks the handler up with `registry.Get`, the newest version. So two replays started together run the later steps twice, side by side, and a run started on v1 replays on whatever version was registered last. An HTTP request that asks for a replay is held for the length of the workflow.

This task splits replay into a read-only plan and an action. `PlanReplay` checks the run exists, that `fromStep` has a checkpoint, and that the run's stamped version is registered, and lists the checkpointed steps that will run again. `ReplayFrom` plans, claims the run with `ReopenRun` (Task 1's conditional write: exactly one of two concurrent reopens wins), deletes the later checkpoints, and runs the stamped version on a goroutine the runner tracks, returning the plan straight away. If the delete fails after the claim, the run is put back to failed with the reason, so it is never left running with nothing executing it. `Runner.Shutdown` refuses new replays, cancels the context of the ones in flight and waits for them until its own context expires; the engine's `Stop` calls it before stopping the dispatcher. The engine gains `PlanWorkflowReplay` and `ReplayWorkflowFrom`, which emits one `workflow.replayed` operator action.

Decisions made while drafting (all checked on 2026-10-07 against the code this task applies to):

- **Version 0.** `Run.Version`'s doc says zero means version 1, but `Registry.GetVersion(name, 0)` returns the newest version. Replay normalises 0 to 1 before the lookup (`stampedVersion`), so an unversioned run never replays on a newer definition. `Resume` keeps calling `GetVersion(run.Name, run.Version)` unchanged: it already uses the stamped version for every run started by this code (`StartRaw` stamps `LatestVersion`, which is at least 1), and only a version-0 run differs. Changing `Resume` would change crash recovery for old rows, which is not this task's call.
- **Reruns.** `Reruns` lists the checkpoints created strictly after `fromStep`'s, which is what `DeleteCheckpointsAfter` deletes on Postgres, SQLite, Mongo and Redis (`created_at >`). The memory store deletes ties too (`!Before`). Two checkpoints only tie when saved in the same clock tick, which the durable stores' round trip per save rules out in practice; the tests space their steps 1ms apart so they test replay and not clock resolution (without the pause, `-count=500` on macOS failed once with `plan.Reruns = []`).
- **Checkpoint lookup.** The plan finds `fromStep` through `ListCheckpoints`, not `GetCheckpoint`, so a step checkpointed with empty data (`wf.Step` saves `[]byte{}`) is found whatever a backend returns for an empty blob.
- **Shutdown refusal.** A replay asked for after `Shutdown` began returns `workflow.ErrRunnerShutdown` (new sentinel; it is not a state transition, so it does not wrap `ErrInvalidState`). The replay is counted in flight before it claims the run, so Shutdown either refuses it with the run untouched or waits for it; there is no window where a run is claimed and then dropped.
- **Background context.** The replay keeps the caller's context values (actor, trace) through `context.WithoutCancel`, so the end of an HTTP request does not cancel it; `Shutdown` cancels it instead.
- **`ReplayPlan.State`.** The fixed interface lists `RunID`, `FromStep`, `Version`, `Reruns`; this task adds `State RunState` so a caller can refuse a running run from the plan without a second read. The four fixed fields are unchanged. JSON tags are snake_case like `Run`'s.
- **Callers.** `grep -rn 'ReplayFrom' --include='*.go' .` finds no caller outside `workflow/` (not `api/`, not `dwp/`), so the signature change breaks only the one test this task replaces.

**Files:**
- Create: `workflow/replay.go`, `workflow/lifecycle.go`, `engine/ops_workflow.go`
- Modify: `workflow/runner.go` (`Runner` struct, `NewRunner`, imports)
- Modify: `workflow/debug.go` (delete `ReplayFrom`, lines 65 to 108)
- Modify: `engine/engine.go` (`Stop`, between the cron scheduler stop and `eng.d.Stop`)
- Test: `workflow/replay_test.go` (create), `engine/ops_workflow_test.go` (create), `workflow/debug_test.go` (delete `TestReplayFrom_DeletesLaterCheckpoints`, superseded)

**Interfaces:**
- Consumes (from Task 1 and the store tasks): `workflow.Reopener.ReopenRun` in `workflow.Store`, wrapping `dispatch.ErrInvalidState` for a running run and `dispatch.ErrRunNotFound` for a missing one; `Run.Version` and `Run.ParentRunID` persisted by every backend. From the ext task: `ext.Action`, `ext.ActionWorkflowReplayed`, `ext.WithActor`, `(*ext.Registry).EmitOperatorAction` (fills `Actor` from ctx and `At` when zero).
- Produces:

```go
package workflow

var ErrRunnerShutdown = errors.New("workflow: runner is shut down")

type ReplayPlan struct {
	RunID    id.RunID `json:"run_id"`
	FromStep string   `json:"from_step"`
	Version  int      `json:"version"`  // stamped version; Run.Version 0 means 1
	Reruns   []string `json:"reruns"`   // checkpointed steps after FromStep, in checkpoint order; never nil
	State    RunState `json:"state"`    // run state when planned
}

// Read-only. ErrRunNotFound (wrapped) for a missing run; ErrInvalidState
// (wrapped) when fromStep has no checkpoint (message names the step) or the
// stamped version is not registered (message names "version N"). A running
// run plans without error.
func (r *Runner) PlanReplay(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, error)

// PlanReplay's refusals, plus ErrInvalidState (wrapped) for a running run or
// one another replay claimed first, ErrRunnerShutdown (wrapped) after
// Shutdown, and the store's error (wrapped) when DeleteCheckpointsAfter
// fails, in which case the run is failed again with Error "replay not
// started: ...". Returns once the run is executing in the background.
func (r *Runner) ReplayFrom(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, error)

// Refuses later replays, cancels in-flight ones, waits for them or ctx.
// Returns an error wrapping ctx.Err() on expiry. Safe to call twice.
func (r *Runner) Shutdown(ctx context.Context) error

package engine

func (eng *Engine) PlanWorkflowReplay(ctx context.Context, runID id.RunID, fromStep string) (*workflow.ReplayPlan, error)
// On success emits exactly one ext.Action{Kind: ActionWorkflowReplayed, RunID, Step: fromStep}.
func (eng *Engine) ReplayWorkflowFrom(ctx context.Context, runID id.RunID, fromStep string) (*workflow.ReplayPlan, error)
// Engine.Stop now calls wfRunner.Shutdown(ctx) before eng.d.Stop(ctx).
```

For the REST task: map `dispatch.ErrRunNotFound` to 404, `dispatch.ErrInvalidState` to 409, `workflow.ErrRunnerShutdown` to 503. A successful replay is accepted, not finished: answer 202 with the plan, and let the client watch the run's state.

- [ ] **Step 1: Check the tree is yours to change**

Run: `cd /Users/rexraphael/Work/xraph/forgery/dispatch && git status --porcelain -- workflow engine/engine.go engine/ops_workflow.go engine/ops_workflow_test.go && grep -n 'func (r \*Runner) ReplayFrom' workflow/*.go`
Expected: no `git status` lines for these paths, and exactly one match, `workflow/debug.go:70:func (r *Runner) ReplayFrom(ctx context.Context, runID id.RunID, fromStep string) error {`. If another session has uncommitted edits in any of them, stop and report.

- [ ] **Step 2: Retire the old replay test**

`workflow/debug_test.go` ends with `TestReplayFrom_DeletesLaterCheckpoints`, which calls the old `ReplayFrom` (one return value, synchronous). `workflow/replay_test.go` below covers the same ground and more. Delete the whole function, from the line `func TestReplayFrom_DeletesLaterCheckpoints(t *testing.T) {` to the end of the file, so the file ends with `TestInspectStep_NotFound`'s closing brace and a newline. Then drop the two imports only it used. The import block changes from:

```go
import (
	"bytes"
	"context"
	"encoding/gob"
	"sync/atomic"
	"testing"

	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/workflow"
)
```

to:

```go
import (
	"bytes"
	"context"
	"encoding/gob"
	"testing"

	"github.com/xraph/dispatch/workflow"
)
```

- [ ] **Step 3: Write the failing workflow tests**

Create `workflow/replay_test.go`. It reuses `noopEmitter` (`runner_test.go`) and `testLogger` (`helpers_test.go`).

```go
package workflow_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/workflow"
)

// endEmitter reports every run that finishes, so a test can wait for a
// replay running on the runner's background launcher.
type endEmitter struct {
	noopEmitter
	ends chan workflow.RunState
}

func (e endEmitter) EmitWorkflowCompleted(_ context.Context, _ *workflow.Run, _ time.Duration) {
	e.ends <- workflow.RunStateCompleted
}

func (e endEmitter) EmitWorkflowFailed(_ context.Context, _ *workflow.Run, _ error) {
	e.ends <- workflow.RunStateFailed
}

// newReplayRunner builds a runner on store st whose finished runs arrive
// on the returned channel. The runner is shut down when the test ends.
func newReplayRunner(t *testing.T, st workflow.Store, es *memory.Store) (*workflow.Runner, *workflow.Registry, chan workflow.RunState) {
	t.Helper()
	ends := make(chan workflow.RunState, 16)
	reg := workflow.NewRegistry()
	runner := workflow.NewRunner(reg, st, es, endEmitter{ends: ends}, testLogger())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := runner.Shutdown(ctx); err != nil {
			t.Errorf("Shutdown: %v", err)
		}
	})
	return runner, reg, ends
}

// waitEnd returns the end state of the next run to finish.
func waitEnd(t *testing.T, ends chan workflow.RunState) workflow.RunState {
	t.Helper()
	select {
	case st := <-ends:
		return st
	case <-time.After(5 * time.Second):
		t.Fatal("no run finished within 5s")
		return ""
	}
}

// stepCounts counts invocations of the three steps of the replay workflow.
type stepCounts struct {
	s1, s2, s3 atomic.Int32
}

// tick spaces checkpoints apart. Checkpoint order is creation time, and
// a step this trivial can save in the same clock tick as the one before
// it on a coarse clock. DeleteCheckpointsAfter cannot order a tie (the
// memory store deletes it, the durable stores keep it), and real steps
// are never this close, so the pause keeps the test about replay rather
// than clock resolution.
func tick() { time.Sleep(time.Millisecond) }

// registerThreeSteps registers "replay-three" at version, with steps
// step-1..step-3. step-3 fails while failStep3 is set; step-2 blocks on
// gate when gate is non-nil.
func registerThreeSteps(reg *workflow.Registry, version int, c *stepCounts, failStep3 *atomic.Bool, gate chan struct{}) {
	workflow.RegisterDefinition(reg, workflow.NewWorkflowV("replay-three", version, func(wf *workflow.Workflow, _ struct{}) error {
		if err := wf.Step("step-1", func(_ context.Context) error { c.s1.Add(1); tick(); return nil }); err != nil {
			return err
		}
		if err := wf.Step("step-2", func(_ context.Context) error {
			c.s2.Add(1)
			if gate != nil {
				<-gate
			}
			tick()
			return nil
		}); err != nil {
			return err
		}
		return wf.Step("step-3", func(_ context.Context) error {
			c.s3.Add(1)
			tick()
			if failStep3.Load() {
				return errors.New("step-3 boom")
			}
			return nil
		})
	}))
}

// failedRun starts "replay-three" with step-3 failing, so the run ends
// failed with step-1 and step-2 checkpointed.
func failedRun(t *testing.T, runner *workflow.Runner, ends chan workflow.RunState, failStep3 *atomic.Bool) *workflow.Run {
	t.Helper()
	failStep3.Store(true)
	run, err := runner.StartRaw(context.Background(), "replay-three", []byte(`{}`))
	if err != nil {
		t.Fatalf("StartRaw: %v", err)
	}
	if st := waitEnd(t, ends); st != workflow.RunStateFailed {
		t.Fatalf("first run ended %q, want failed", st)
	}
	return run
}

func TestReplayFrom_RerunsOnlyLaterSteps(t *testing.T) {
	s := memory.New()
	runner, reg, ends := newReplayRunner(t, s, s)
	var c stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &c, &failStep3, nil)
	run := failedRun(t, runner, ends, &failStep3)

	plan, err := runner.PlanReplay(context.Background(), run.ID, "step-1")
	if err != nil {
		t.Fatalf("PlanReplay: %v", err)
	}
	if plan.RunID != run.ID || plan.FromStep != "step-1" || plan.Version != 1 || plan.State != workflow.RunStateFailed {
		t.Fatalf("plan = %+v, want run %s from step-1 on version 1, state failed", plan, run.ID)
	}
	if !slices.Equal(plan.Reruns, []string{"step-2"}) {
		t.Fatalf("plan.Reruns = %v, want [step-2]", plan.Reruns)
	}

	failStep3.Store(false)
	got, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
	if err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	if !slices.Equal(got.Reruns, []string{"step-2"}) || got.Version != 1 {
		t.Fatalf("ReplayFrom plan = %+v, want reruns [step-2] on version 1", got)
	}
	if st := waitEnd(t, ends); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}

	if c.s1.Load() != 1 || c.s2.Load() != 2 || c.s3.Load() != 2 {
		t.Errorf("step calls s1=%d s2=%d s3=%d, want 1/2/2 (step-1 kept, later steps re-run)",
			c.s1.Load(), c.s2.Load(), c.s3.Load())
	}
	after, err := s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if after.State != workflow.RunStateCompleted || after.Error != "" || after.CompletedAt == nil {
		t.Errorf("run after replay: state=%q error=%q completed_at=%v, want completed, no error, set",
			after.State, after.Error, after.CompletedAt)
	}
}

func TestReplayFrom_RefusesRunningRun(t *testing.T) {
	s := memory.New()
	runner, reg, _ := newReplayRunner(t, s, s)
	var c stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &c, &failStep3, nil)

	ctx := context.Background()
	run := &workflow.Run{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewRunID(),
		Name:      "replay-three",
		State:     workflow.RunStateRunning,
		Version:   1,
		StartedAt: time.Now().UTC(),
	}
	if err := s.CreateRun(ctx, run); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	if err := s.SaveCheckpoint(ctx, run.ID, "step-1", []byte{}); err != nil {
		t.Fatalf("SaveCheckpoint: %v", err)
	}

	plan, err := runner.PlanReplay(ctx, run.ID, "step-1")
	if err != nil {
		t.Fatalf("PlanReplay on a running run: %v (planning is read-only and should succeed)", err)
	}
	if plan.State != workflow.RunStateRunning {
		t.Errorf("plan.State = %q, want running", plan.State)
	}

	_, err = runner.ReplayFrom(ctx, run.ID, "step-1")
	if !errors.Is(err, dispatch.ErrInvalidState) {
		t.Fatalf("ReplayFrom on a running run: err = %v, want ErrInvalidState", err)
	}
	if !strings.Contains(err.Error(), "running") {
		t.Errorf("error %q does not name the state", err)
	}
	if c.s1.Load()+c.s2.Load()+c.s3.Load() != 0 {
		t.Errorf("a refused replay ran steps: s1=%d s2=%d s3=%d", c.s1.Load(), c.s2.Load(), c.s3.Load())
	}
}

func TestReplayFrom_ConcurrentCallsStartOnce(t *testing.T) {
	s := memory.New()
	runner, reg, ends := newReplayRunner(t, s, s)
	var c stepCounts
	var failStep3 atomic.Bool
	gate := make(chan struct{})
	registerThreeSteps(reg, 1, &c, &failStep3, gate)

	// The first run must get past step-2, so open the gate for it.
	close(gate)
	run := failedRun(t, runner, ends, &failStep3)

	// A fresh gate holds the winning replay inside step-2 while the
	// others race, so a loser can never find the run finished again.
	gate2 := make(chan struct{})
	var c2 stepCounts
	registerThreeSteps(reg, 1, &c2, &failStep3, gate2)
	failStep3.Store(false)

	const callers = 8
	var wg sync.WaitGroup
	var wins, refused atomic.Int32
	start := make(chan struct{})
	for range callers {
		wg.Go(func() {
			<-start
			_, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
			switch {
			case err == nil:
				wins.Add(1)
			case errors.Is(err, dispatch.ErrInvalidState):
				refused.Add(1)
			default:
				t.Errorf("ReplayFrom: unexpected error %v", err)
			}
		})
	}
	close(start)
	wg.Wait()
	close(gate2)

	if wins.Load() != 1 || refused.Load() != callers-1 {
		t.Fatalf("wins=%d refused=%d, want 1 and %d", wins.Load(), refused.Load(), callers-1)
	}
	if st := waitEnd(t, ends); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}
	if c2.s2.Load() != 1 || c2.s3.Load() != 1 {
		t.Errorf("replayed steps ran s2=%d s3=%d, want exactly once each", c2.s2.Load(), c2.s3.Load())
	}
}

func TestReplayFrom_UsesStampedVersion(t *testing.T) {
	s := memory.New()
	runner, reg, ends := newReplayRunner(t, s, s)
	var v1 stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &v1, &failStep3, nil)
	run := failedRun(t, runner, ends, &failStep3)
	if run.Version != 1 {
		t.Fatalf("run.Version = %d, want 1", run.Version)
	}

	// v2 registers after the run started; the replay must stay on v1.
	var v2 stepCounts
	registerThreeSteps(reg, 2, &v2, &failStep3, nil)
	failStep3.Store(false)

	plan, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
	if err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	if plan.Version != 1 {
		t.Errorf("plan.Version = %d, want 1", plan.Version)
	}
	if st := waitEnd(t, ends); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}
	if v1.s2.Load() != 2 || v1.s3.Load() != 2 {
		t.Errorf("v1 steps s2=%d s3=%d, want 2/2 (replay on v1)", v1.s2.Load(), v1.s3.Load())
	}
	if v2.s1.Load()+v2.s2.Load()+v2.s3.Load() != 0 {
		t.Errorf("v2 handler ran: s1=%d s2=%d s3=%d, want none", v2.s1.Load(), v2.s2.Load(), v2.s3.Load())
	}
}

// storedRun writes a finished run of "replay-three" stamped with version,
// with a checkpoint for step-1, straight to the store.
func storedRun(t *testing.T, s *memory.Store, version int) *workflow.Run {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	run := &workflow.Run{
		Entity:      dispatch.NewEntity(),
		ID:          id.NewRunID(),
		Name:        "replay-three",
		State:       workflow.RunStateFailed,
		Error:       "earlier failure",
		Version:     version,
		StartedAt:   now,
		CompletedAt: &now,
	}
	if err := s.CreateRun(ctx, run); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	if err := s.SaveCheckpoint(ctx, run.ID, "step-1", []byte{}); err != nil {
		t.Fatalf("SaveCheckpoint: %v", err)
	}
	return run
}

func TestReplayFrom_RefusesUnregisteredVersion(t *testing.T) {
	s := memory.New()
	runner, reg, _ := newReplayRunner(t, s, s)
	var c stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &c, &failStep3, nil)
	run := storedRun(t, s, 3)

	for name, call := range map[string]func() error{
		"PlanReplay": func() error {
			_, err := runner.PlanReplay(context.Background(), run.ID, "step-1")
			return err
		},
		"ReplayFrom": func() error {
			_, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
			return err
		},
	} {
		err := call()
		if !errors.Is(err, dispatch.ErrInvalidState) {
			t.Fatalf("%s: err = %v, want ErrInvalidState", name, err)
		}
		if !strings.Contains(err.Error(), "version 3") {
			t.Errorf("%s: error %q does not name the version", name, err)
		}
	}

	after, err := s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if after.State != workflow.RunStateFailed {
		t.Errorf("refused replay moved the run to %q", after.State)
	}
}

func TestReplayFrom_UnversionedRunUsesVersionOne(t *testing.T) {
	s := memory.New()
	runner, reg, ends := newReplayRunner(t, s, s)
	var v1, v2 stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &v1, &failStep3, nil)
	registerThreeSteps(reg, 2, &v2, &failStep3, nil)
	run := storedRun(t, s, 0)

	plan, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
	if err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	if plan.Version != 1 {
		t.Errorf("plan.Version = %d, want 1 (Run.Version 0 means version 1)", plan.Version)
	}
	if st := waitEnd(t, ends); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}
	if v1.s2.Load() != 1 || v2.s2.Load() != 0 {
		t.Errorf("v1 s2=%d v2 s2=%d, want the replay on v1 only", v1.s2.Load(), v2.s2.Load())
	}
}

func TestReplayFrom_RefusesStepWithoutCheckpoint(t *testing.T) {
	s := memory.New()
	runner, reg, ends := newReplayRunner(t, s, s)
	var c stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &c, &failStep3, nil)
	run := failedRun(t, runner, ends, &failStep3)

	// step-3 failed, so it has no checkpoint; "nope" never existed.
	for _, step := range []string{"step-3", "nope"} {
		_, err := runner.PlanReplay(context.Background(), run.ID, step)
		if !errors.Is(err, dispatch.ErrInvalidState) {
			t.Fatalf("PlanReplay(%q): err = %v, want ErrInvalidState", step, err)
		}
		if !strings.Contains(err.Error(), step) {
			t.Errorf("PlanReplay(%q): error %q does not name the step", step, err)
		}
		if _, err := runner.ReplayFrom(context.Background(), run.ID, step); !errors.Is(err, dispatch.ErrInvalidState) {
			t.Fatalf("ReplayFrom(%q): err = %v, want ErrInvalidState", step, err)
		}
	}

	_, err := runner.PlanReplay(context.Background(), id.NewRunID(), "step-1")
	if !errors.Is(err, dispatch.ErrRunNotFound) {
		t.Errorf("PlanReplay on an unknown run: err = %v, want ErrRunNotFound", err)
	}

	cps, err := s.ListCheckpoints(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("ListCheckpoints: %v", err)
	}
	if len(cps) != 2 {
		t.Errorf("checkpoints after refused replays = %d, want 2 (untouched)", len(cps))
	}
}

func TestShutdown_WaitsForInFlightReplay(t *testing.T) {
	s := memory.New()
	runner, reg, ends := newReplayRunner(t, s, s)
	var c stepCounts
	var failStep3 atomic.Bool
	gate := make(chan struct{})
	registerThreeSteps(reg, 1, &c, &failStep3, gate)
	close(gate)
	run := failedRun(t, runner, ends, &failStep3)

	held := make(chan struct{})
	var held2 stepCounts
	registerThreeSteps(reg, 1, &held2, &failStep3, held)
	failStep3.Store(false)

	if _, err := runner.ReplayFrom(context.Background(), run.ID, "step-1"); err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for held2.s2.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("replay never reached step-2")
		}
		time.Sleep(5 * time.Millisecond)
	}

	// A Shutdown whose context expires first reports it and returns.
	short, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := runner.Shutdown(short); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Shutdown with a short deadline: err = %v, want DeadlineExceeded", err)
	}

	done := make(chan error, 1)
	go func() { done <- runner.Shutdown(context.Background()) }()
	select {
	case err := <-done:
		t.Fatalf("Shutdown returned (%v) while a replay was still running", err)
	case <-time.After(100 * time.Millisecond):
	}

	close(held)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Shutdown did not return after the replay finished")
	}
	if st := waitEnd(t, ends); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}

	// After Shutdown a replay is refused before it touches the run.
	_, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
	if !errors.Is(err, workflow.ErrRunnerShutdown) {
		t.Fatalf("ReplayFrom after Shutdown: err = %v, want ErrRunnerShutdown", err)
	}
	after, err := s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if after.State != workflow.RunStateCompleted {
		t.Errorf("refused replay moved the run to %q", after.State)
	}
	cps, err := s.ListCheckpoints(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("ListCheckpoints: %v", err)
	}
	if len(cps) != 3 {
		t.Errorf("checkpoints after refused replay = %d, want 3 (untouched)", len(cps))
	}
}

func TestShutdown_CancelsReplayContext(t *testing.T) {
	s := memory.New()
	runner, reg, _ := newReplayRunner(t, s, s)
	run := storedRun(t, s, 1)

	entered := make(chan struct{})
	var sawCancel atomic.Bool
	workflow.RegisterDefinition(reg, workflow.NewWorkflowV("replay-three", 1, func(wf *workflow.Workflow, _ struct{}) error {
		if err := wf.Step("step-1", func(_ context.Context) error { return nil }); err != nil {
			return err
		}
		return wf.Step("step-2", func(ctx context.Context) error {
			close(entered)
			<-ctx.Done()
			sawCancel.Store(true)
			return ctx.Err()
		})
	}))

	if _, err := runner.ReplayFrom(context.Background(), run.ID, "step-1"); err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	<-entered

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := runner.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if !sawCancel.Load() {
		t.Error("the replay's step did not see its context cancelled by Shutdown")
	}
}

// failingDeleteStore is a memory store whose DeleteCheckpointsAfter fails,
// which strands a run ReplayFrom has already reopened.
type failingDeleteStore struct {
	*memory.Store
}

var errDeleteFailed = errors.New("delete checkpoints: disk on fire")

func (failingDeleteStore) DeleteCheckpointsAfter(_ context.Context, _ id.RunID, _ string) error {
	return errDeleteFailed
}

func TestReplayFrom_DeleteFailureFailsRunAgain(t *testing.T) {
	s := memory.New()
	runner, reg, _ := newReplayRunner(t, failingDeleteStore{s}, s)
	var c stepCounts
	var failStep3 atomic.Bool
	registerThreeSteps(reg, 1, &c, &failStep3, nil)
	run := storedRun(t, s, 1)

	_, err := runner.ReplayFrom(context.Background(), run.ID, "step-1")
	if !errors.Is(err, errDeleteFailed) {
		t.Fatalf("ReplayFrom: err = %v, want the delete failure", err)
	}

	after, err := s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if after.State != workflow.RunStateFailed {
		t.Fatalf("run state = %q, want failed (not stranded in running)", after.State)
	}
	if !strings.Contains(after.Error, "replay not started") || !strings.Contains(after.Error, errDeleteFailed.Error()) {
		t.Errorf("run error = %q, want the replay failure recorded", after.Error)
	}
	if after.CompletedAt == nil {
		t.Error("run CompletedAt is nil, want it set again")
	}
	if c.s1.Load()+c.s2.Load()+c.s3.Load() != 0 {
		t.Errorf("steps ran after a failed replay: s1=%d s2=%d s3=%d", c.s1.Load(), c.s2.Load(), c.s3.Load())
	}
}
```

- [ ] **Step 4: Run them and see them fail**

Run: `go test ./workflow/ 2>&1 | head -6`
Expected: a build failure, starting:

```
# github.com/xraph/dispatch/workflow_test [github.com/xraph/dispatch/workflow.test]
workflow/replay_test.go:44:20: runner.Shutdown undefined (type *workflow.Runner has no field or method Shutdown)
workflow/replay_test.go:128:22: runner.PlanReplay undefined (type *workflow.Runner has no field or method PlanReplay)
workflow/replay_test.go:140:14: assignment mismatch: 2 variables but runner.ReplayFrom returns 1 value
```

- [ ] **Step 5: Give the Runner a background launcher**

In `workflow/runner.go`, add `"sync"` to the standard-library imports, between `"fmt"` and `"time"`:

```go
import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
```

Replace the `Runner` struct:

```go
type Runner struct {
	registry   *Registry
	store      Store
	eventStore event.Store
	emitter    RunEmitter
	logger     log.Logger
}
```

with:

```go
type Runner struct {
	registry   *Registry
	store      Store
	eventStore event.Store
	emitter    RunEmitter
	logger     log.Logger

	// The background launcher (lifecycle.go). life is the context every
	// background run executes under, and stopLife cancels it. inflight
	// counts the background runs Shutdown waits for. closed refuses new
	// launches once Shutdown has begun; lifeMu orders it against
	// inflight.Add, so Shutdown never waits on a group that can still grow.
	life     context.Context
	stopLife context.CancelFunc
	lifeMu   sync.Mutex
	closed   bool
	inflight sync.WaitGroup
}
```

and in `NewRunner` replace:

```go
) *Runner {
	return &Runner{
		registry:   registry,
		store:      store,
		eventStore: eventStore,
		emitter:    emitter,
		logger:     logger,
	}
}
```

with:

```go
) *Runner {
	life, stopLife := context.WithCancel(context.Background())
	return &Runner{
		registry:   registry,
		store:      store,
		eventStore: eventStore,
		emitter:    emitter,
		logger:     logger,
		life:       life,
		stopLife:   stopLife,
	}
}
```

`NewRunner`'s signature does not change, so `engine.Build` and every test helper keep working. The launcher lives as long as the runner; nothing has to start it.

- [ ] **Step 6: Add Shutdown**

Create `workflow/lifecycle.go`:

```go
package workflow

import (
	"context"
	"errors"
	"fmt"
)

// ErrRunnerShutdown is what ReplayFrom returns once Shutdown has begun.
// The refusal comes before the run is claimed, so the run is left exactly
// as it was.
var ErrRunnerShutdown = errors.New("workflow: runner is shut down")

// track counts one more background run, unless Shutdown has begun. A
// caller that gets true must call r.inflight.Done exactly once.
func (r *Runner) track() bool {
	r.lifeMu.Lock()
	defer r.lifeMu.Unlock()
	if r.closed {
		return false
	}
	r.inflight.Add(1)
	return true
}

// Shutdown stops the background launcher. It refuses every later
// ReplayFrom with ErrRunnerShutdown, cancels the context the in-flight
// background runs execute under, and waits for them to return or for
// ctx to expire, whichever is first. On expiry it returns an error
// wrapping ctx.Err() and leaves the runs to finish on their own.
//
// A run whose steps honour cancellation fails with the context error. On
// a durable store the write recording that usually fails too, since it
// shares the cancelled context, so the run stays running and the next
// ResumeAll picks it up from its checkpoints.
//
// Shutdown is safe to call more than once; a later call waits again.
func (r *Runner) Shutdown(ctx context.Context) error {
	r.lifeMu.Lock()
	r.closed = true
	r.lifeMu.Unlock()
	r.stopLife()

	done := make(chan struct{})
	go func() {
		r.inflight.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("workflow runner shutdown: %w", ctx.Err())
	}
}
```

- [ ] **Step 7: Replace ReplayFrom**

In `workflow/debug.go`, delete the old method: the doc comment starting `// ReplayFrom re-executes a workflow from a specific step by deleting all` through the closing brace of `func (r *Runner) ReplayFrom(ctx context.Context, runID id.RunID, fromStep string) error {`, which is the end of the file. The file then ends with `InspectStep`'s closing brace and a newline. Its imports (`context`, `fmt`, `sort`, `time`, `id`) are all still used by `GetTimeline` and `InspectStep`.

Create `workflow/replay.go`:

```go
package workflow

import (
	"context"
	"fmt"
	"sort"
	"time"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
)

// ReplayPlan says what replaying a run from a step does. PlanReplay
// returns it without changing anything; ReplayFrom returns the plan it
// acted on.
type ReplayPlan struct {
	RunID    id.RunID `json:"run_id"`
	FromStep string   `json:"from_step"`

	// Version is the run's stamped version, the one the replay runs on.
	// A run stamped 0 predates versioning and runs on version 1.
	Version int `json:"version"`

	// Reruns names the checkpointed steps after FromStep whose
	// checkpoints the replay deletes, so they run again, in checkpoint
	// order. Steps the run never reached are not listed but run too.
	Reruns []string `json:"reruns"`

	// State is the run's state when the plan was made. ReplayFrom
	// refuses a running run, so a caller can refuse it early from here.
	State RunState `json:"state"`
}

// PlanReplay reports what ReplayFrom would do for the run and step,
// without changing anything. It fails when the run does not exist
// (wrapping dispatch.ErrRunNotFound), when fromStep has no checkpoint,
// or when the run's stamped version is not registered (both wrapping
// dispatch.ErrInvalidState). A running run plans fine; its State says
// ReplayFrom would refuse it.
func (r *Runner) PlanReplay(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, error) {
	plan, _, err := r.planReplay(ctx, runID, fromStep)
	return plan, err
}

// planReplay is PlanReplay, also returning the stamped version's runner.
func (r *Runner) planReplay(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, RunnerFunc, error) {
	run, err := r.store.GetRun(ctx, runID)
	if err != nil {
		return nil, nil, fmt.Errorf("get run %s: %w", runID, err)
	}

	checkpoints, err := r.store.ListCheckpoints(ctx, runID)
	if err != nil {
		return nil, nil, fmt.Errorf("list checkpoints for run %s: %w", runID, err)
	}

	var target *Checkpoint
	for _, cp := range checkpoints {
		if cp.StepName == fromStep {
			target = cp
			break
		}
	}
	if target == nil {
		return nil, nil, fmt.Errorf("%w: run %s has no checkpoint for step %q",
			dispatch.ErrInvalidState, runID, fromStep)
	}

	version := stampedVersion(run)
	runner, ok := r.registry.GetVersion(run.Name, version)
	if !ok {
		return nil, nil, fmt.Errorf("%w: workflow %q version %d is not registered (run %s)",
			dispatch.ErrInvalidState, run.Name, version, runID)
	}

	// Reruns is what DeleteCheckpointsAfter removes on the durable
	// backends: every checkpoint created strictly after fromStep's, in
	// creation order, with the ID breaking a tie as GetTimeline does.
	later := make([]*Checkpoint, 0, len(checkpoints))
	for _, cp := range checkpoints {
		if cp.CreatedAt.After(target.CreatedAt) {
			later = append(later, cp)
		}
	}
	sort.SliceStable(later, func(i, j int) bool {
		if later[i].CreatedAt.Equal(later[j].CreatedAt) {
			return later[i].ID.String() < later[j].ID.String()
		}
		return later[i].CreatedAt.Before(later[j].CreatedAt)
	})
	reruns := make([]string, len(later))
	for i, cp := range later {
		reruns[i] = cp.StepName
	}

	return &ReplayPlan{
		RunID:    runID,
		FromStep: fromStep,
		Version:  version,
		Reruns:   reruns,
		State:    run.State,
	}, runner, nil
}

// stampedVersion is the version a run executes on. Run.Version 0 means
// version 1 (see Run.Version); Registry.GetVersion would read 0 as
// "latest", which for an old run is the wrong handler.
func stampedVersion(run *Run) int {
	if run.Version <= 0 {
		return 1
	}
	return run.Version
}

// ReplayFrom re-runs a finished run from a step. Checkpoints up to and
// including fromStep are kept, so those steps are skipped; every later
// checkpoint is deleted and those steps run again. The run executes on
// its stamped version, never a newer one registered since.
//
// The refusals are PlanReplay's, plus: a running run, or one another
// replay claims first, wraps dispatch.ErrInvalidState; once Shutdown has
// begun, ErrRunnerShutdown. Of two concurrent calls exactly one starts.
//
// The run executes on the runner's background launcher and ReplayFrom
// returns the plan as soon as it has started. The run keeps the values
// of ctx but not its cancellation: Shutdown cancels it instead.
func (r *Runner) ReplayFrom(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, error) {
	plan, runner, err := r.planReplay(ctx, runID, fromStep)
	if err != nil {
		return nil, err
	}
	if plan.State == RunStateRunning {
		return nil, fmt.Errorf("%w: run %s is %s", dispatch.ErrInvalidState, runID, plan.State)
	}

	// Count the replay as in flight before claiming the run, so Shutdown
	// either refuses it here, with the run untouched, or waits for it.
	if !r.track() {
		return nil, fmt.Errorf("replay run %s: %w", runID, ErrRunnerShutdown)
	}
	launched := false
	defer func() {
		if !launched {
			r.inflight.Done()
		}
	}()

	// The claim. Of two replays that both planned, one reopens the run
	// and the other is refused here.
	if reopenErr := r.store.ReopenRun(ctx, runID); reopenErr != nil {
		return nil, fmt.Errorf("reopen run %s: %w", runID, reopenErr)
	}

	if delErr := r.store.DeleteCheckpointsAfter(ctx, runID, fromStep); delErr != nil {
		err = fmt.Errorf("delete checkpoints after %q for run %s: %w", fromStep, runID, delErr)
		r.failReopened(ctx, runID, err)
		return nil, err
	}

	stored, err := r.store.GetRun(ctx, runID)
	if err != nil {
		err = fmt.Errorf("get reopened run %s: %w", runID, err)
		r.failReopened(ctx, runID, err)
		return nil, err
	}
	// The background run writes to its own copy, never to a value a
	// store handed out to other readers.
	run := *stored

	r.emitter.EmitWorkflowStarted(ctx, &run)

	launched = true
	go func() {
		defer r.inflight.Done()
		bg, cancel := context.WithCancel(context.WithoutCancel(ctx))
		defer cancel()
		stop := context.AfterFunc(r.life, cancel)
		defer stop()
		r.executeRun(bg, &run, runner, run.Input)
	}()

	return plan, nil
}

// failReopened puts a run ReplayFrom reopened, but could not hand to an
// executor, back to failed with the reason. Without it the run would sit
// in running with nothing executing it until the next ResumeAll. The
// writes ignore ctx's cancellation, since a cancelled request is one way
// to get here. A failure is logged: the run then stays running, and the
// next ResumeAll resumes it from whatever checkpoints remain.
func (r *Runner) failReopened(ctx context.Context, runID id.RunID, cause error) {
	ctx = context.WithoutCancel(ctx)

	stored, err := r.store.GetRun(ctx, runID)
	if err != nil {
		r.logger.Error("replay not started and the run could not be marked failed",
			log.String("run_id", runID.String()),
			log.String("cause", cause.Error()),
			log.String("error", err.Error()),
		)
		return
	}

	failed := *stored
	now := time.Now().UTC()
	failed.State = RunStateFailed
	failed.Error = "replay not started: " + cause.Error()
	failed.CompletedAt = &now
	if updateErr := r.store.UpdateRun(ctx, &failed); updateErr != nil {
		r.logger.Error("replay not started and the run could not be marked failed",
			log.String("run_id", runID.String()),
			log.String("cause", cause.Error()),
			log.String("error", updateErr.Error()),
		)
	}
}
```

- [ ] **Step 8: Run the workflow tests and see them pass**

Run: `go test -race -count=1 ./workflow/ && go test -count=200 -run 'Replay|Shutdown' ./workflow/`
Expected:

```
ok  	github.com/xraph/dispatch/workflow	2.0s
ok  	github.com/xraph/dispatch/workflow	40.3s
```

(The second line is the stress run for ordering and the concurrent claim; timings vary.) The pre-existing `TestResumePreservesVersion`, `TestMigrateRun`, `TestRunner_ResumeAll`, `TestGetTimeline_OrderedSteps` and `TestInspectStep_*` pass unchanged.

- [ ] **Step 9: Write the failing engine tests**

Create `engine/ops_workflow_test.go`. The recorder is named `wfReplayRecorder` so it cannot collide with a recorder another operator task adds to `engine_test`.

```go
package engine_test

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/store/memory"
	"github.com/xraph/dispatch/workflow"
)

// wfReplayRecorder records operator actions and reports finished
// workflow runs on ends.
type wfReplayRecorder struct {
	mu      sync.Mutex
	actions []ext.Action
	ends    chan workflow.RunState
}

func (r *wfReplayRecorder) Name() string { return "wf-replay-recorder" }

func (r *wfReplayRecorder) OnOperatorAction(_ context.Context, a ext.Action) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.actions = append(r.actions, a)
	return nil
}

func (r *wfReplayRecorder) OnWorkflowCompleted(_ context.Context, _ *workflow.Run, _ time.Duration) error {
	r.ends <- workflow.RunStateCompleted
	return nil
}

func (r *wfReplayRecorder) OnWorkflowFailed(_ context.Context, _ *workflow.Run, _ error) error {
	r.ends <- workflow.RunStateFailed
	return nil
}

func (r *wfReplayRecorder) recorded() []ext.Action {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.actions)
}

func (r *wfReplayRecorder) waitEnd(t *testing.T) workflow.RunState {
	t.Helper()
	select {
	case st := <-r.ends:
		return st
	case <-time.After(5 * time.Second):
		t.Fatal("no workflow run finished within 5s")
		return ""
	}
}

// replayEngine builds an engine on a memory store with a recorder and a
// two-step workflow "eng-replay" whose step-2 fails while fail is set
// and blocks on gate while gate is non-nil.
func replayEngine(t *testing.T, fail *atomic.Bool, gate chan struct{}, step2Calls *atomic.Int32) (*engine.Engine, *memory.Store, *wfReplayRecorder) {
	t.Helper()
	s := memory.New()
	d, err := dispatch.New(dispatch.WithStore(s))
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}
	rec := &wfReplayRecorder{ends: make(chan workflow.RunState, 16)}
	eng, err := engine.Build(d, engine.WithExtension(rec))
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}
	engine.RegisterWorkflow(eng, workflow.NewWorkflow("eng-replay", func(wf *workflow.Workflow, _ struct{}) error {
		if err := wf.Step("step-1", func(_ context.Context) error {
			time.Sleep(time.Millisecond) // keep checkpoint times apart
			return nil
		}); err != nil {
			return err
		}
		return wf.Step("step-2", func(_ context.Context) error {
			step2Calls.Add(1)
			if gate != nil {
				<-gate
			}
			if fail.Load() {
				return errors.New("step-2 boom")
			}
			return nil
		})
	}))
	return eng, s, rec
}

func TestEngine_ReplayWorkflowFrom_EmitsOneAction(t *testing.T) {
	var fail atomic.Bool
	var step2 atomic.Int32
	eng, s, rec := replayEngine(t, &fail, nil, &step2)
	t.Cleanup(func() { _ = eng.Stop(context.Background()) })

	fail.Store(true)
	run, err := engine.StartWorkflow(context.Background(), eng, "eng-replay", struct{}{})
	if err != nil {
		t.Fatalf("StartWorkflow: %v", err)
	}
	if st := rec.waitEnd(t); st != workflow.RunStateFailed {
		t.Fatalf("first run ended %q, want failed", st)
	}

	plan, err := eng.PlanWorkflowReplay(context.Background(), run.ID, "step-1")
	if err != nil {
		t.Fatalf("PlanWorkflowReplay: %v", err)
	}
	if plan.Version != 1 || plan.State != workflow.RunStateFailed || len(plan.Reruns) != 0 {
		t.Fatalf("plan = %+v, want version 1, state failed, no checkpointed reruns", plan)
	}
	if got := rec.recorded(); len(got) != 0 {
		t.Fatalf("PlanWorkflowReplay emitted %d actions, want 0", len(got))
	}

	fail.Store(false)
	ctx := ext.WithActor(context.Background(), "user_7")
	got, err := eng.ReplayWorkflowFrom(ctx, run.ID, "step-1")
	if err != nil {
		t.Fatalf("ReplayWorkflowFrom: %v", err)
	}
	if got.RunID != run.ID || got.FromStep != "step-1" {
		t.Errorf("plan = %+v, want run %s from step-1", got, run.ID)
	}
	if st := rec.waitEnd(t); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}
	if step2.Load() != 2 {
		t.Errorf("step-2 calls = %d, want 2", step2.Load())
	}

	actions := rec.recorded()
	if len(actions) != 1 {
		t.Fatalf("actions = %d, want 1: %+v", len(actions), actions)
	}
	a := actions[0]
	if a.Kind != ext.ActionWorkflowReplayed || a.RunID != run.ID || a.Step != "step-1" || a.Actor != "user_7" || a.At.IsZero() {
		t.Errorf("action = %+v, want workflow.replayed of %s from step-1 by user_7 with a time", a, run.ID)
	}

	after, err := s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if after.State != workflow.RunStateCompleted {
		t.Errorf("run state = %q, want completed", after.State)
	}
}

func TestEngine_ReplayWorkflowFrom_RefusalEmitsNothing(t *testing.T) {
	var fail atomic.Bool
	var step2 atomic.Int32
	eng, _, rec := replayEngine(t, &fail, nil, &step2)
	t.Cleanup(func() { _ = eng.Stop(context.Background()) })

	fail.Store(true)
	run, err := engine.StartWorkflow(context.Background(), eng, "eng-replay", struct{}{})
	if err != nil {
		t.Fatalf("StartWorkflow: %v", err)
	}
	rec.waitEnd(t)

	if _, err := eng.ReplayWorkflowFrom(context.Background(), run.ID, "step-2"); !errors.Is(err, dispatch.ErrInvalidState) {
		t.Fatalf("replay from an uncheckpointed step: err = %v, want ErrInvalidState", err)
	}
	if got := rec.recorded(); len(got) != 0 {
		t.Errorf("a refused replay emitted %d actions, want 0", len(got))
	}
}

func TestEngine_StopWaitsForReplay(t *testing.T) {
	var fail atomic.Bool
	var step2 atomic.Int32
	gate := make(chan struct{})
	eng, s, rec := replayEngine(t, &fail, gate, &step2)

	fail.Store(true)
	close(gate)
	run, err := engine.StartWorkflow(context.Background(), eng, "eng-replay", struct{}{})
	if err != nil {
		t.Fatalf("StartWorkflow: %v", err)
	}
	rec.waitEnd(t)

	// Hold the replay inside step-2.
	held := make(chan struct{})
	var heldCalls atomic.Int32
	engine.RegisterWorkflow(eng, workflow.NewWorkflow("eng-replay", func(wf *workflow.Workflow, _ struct{}) error {
		if stepErr := wf.Step("step-1", func(_ context.Context) error { return nil }); stepErr != nil {
			return stepErr
		}
		return wf.Step("step-2", func(_ context.Context) error {
			heldCalls.Add(1)
			<-held
			return nil
		})
	}))
	if _, replayErr := eng.ReplayWorkflowFrom(context.Background(), run.ID, "step-1"); replayErr != nil {
		t.Fatalf("ReplayWorkflowFrom: %v", replayErr)
	}
	deadline := time.Now().Add(5 * time.Second)
	for heldCalls.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("replay never reached step-2")
		}
		time.Sleep(5 * time.Millisecond)
	}

	stopped := make(chan error, 1)
	go func() { stopped <- eng.Stop(context.Background()) }()
	select {
	case early := <-stopped:
		t.Fatalf("Stop returned (%v) while a replay was in flight", early)
	case <-time.After(100 * time.Millisecond):
	}

	close(held)
	select {
	case stopErr := <-stopped:
		if stopErr != nil {
			t.Fatalf("Stop: %v", stopErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Stop did not return after the replay finished")
	}
	if st := rec.waitEnd(t); st != workflow.RunStateCompleted {
		t.Fatalf("replay ended %q, want completed", st)
	}

	// After Stop a replay is refused and nothing is emitted for it.
	before := len(rec.recorded())
	if _, lateErr := eng.ReplayWorkflowFrom(context.Background(), run.ID, "step-1"); !errors.Is(lateErr, workflow.ErrRunnerShutdown) {
		t.Fatalf("ReplayWorkflowFrom after Stop: err = %v, want ErrRunnerShutdown", lateErr)
	}
	if got := len(rec.recorded()); got != before {
		t.Errorf("a refused replay emitted an action (%d -> %d)", before, got)
	}
	after, err := s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if after.State != workflow.RunStateCompleted {
		t.Errorf("run state = %q, want completed", after.State)
	}
}
```

- [ ] **Step 10: Run them and see them fail**

Run: `go test -run 'ReplayWorkflowFrom|StopWaitsForReplay' ./engine/ 2>&1 | head -4`
Expected:

```
# github.com/xraph/dispatch/engine_test [github.com/xraph/dispatch/engine.test]
engine/ops_workflow_test.go:114:19: eng.PlanWorkflowReplay undefined (type *engine.Engine has no field or method PlanWorkflowReplay)
engine/ops_workflow_test.go:127:18: eng.ReplayWorkflowFrom undefined (type *engine.Engine has no field or method ReplayWorkflowFrom)
engine/ops_workflow_test.go:172:19: eng.ReplayWorkflowFrom undefined (type *engine.Engine has no field or method ReplayWorkflowFrom)
```

- [ ] **Step 11: Add the engine methods**

Create `engine/ops_workflow.go`:

```go
package engine

import (
	"context"

	"github.com/xraph/dispatch/ext"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

// PlanWorkflowReplay reports what ReplayWorkflowFrom would do for the run
// and step, without changing anything. See workflow.Runner.PlanReplay for
// the refusals; a running run plans fine and its State says a replay
// would be refused.
func (eng *Engine) PlanWorkflowReplay(ctx context.Context, runID id.RunID, fromStep string) (*workflow.ReplayPlan, error) {
	return eng.wfRunner.PlanReplay(ctx, runID, fromStep)
}

// ReplayWorkflowFrom re-runs a finished run from a step on the run's
// stamped version, keeping the checkpoints up to and including fromStep.
// It returns once the replay has started on the runner's background
// launcher; Stop waits for it. Refusals are workflow.Runner.ReplayFrom's:
// dispatch.ErrRunNotFound, dispatch.ErrInvalidState (running, claimed by
// another replay, no checkpoint for the step, version not registered),
// or workflow.ErrRunnerShutdown after Stop.
//
// On success it emits one ext.ActionWorkflowReplayed with the run and step.
func (eng *Engine) ReplayWorkflowFrom(ctx context.Context, runID id.RunID, fromStep string) (*workflow.ReplayPlan, error) {
	plan, err := eng.wfRunner.ReplayFrom(ctx, runID, fromStep)
	if err != nil {
		return nil, err
	}

	eng.extensions.EmitOperatorAction(ctx, ext.Action{
		Kind:  ext.ActionWorkflowReplayed,
		RunID: runID,
		Step:  fromStep,
	})
	return plan, nil
}
```

- [ ] **Step 12: Make Stop wait for replays**

In `engine/engine.go`, `Stop` stops the cron scheduler and then the dispatcher. Replace:

```go
		eng.logger.Error("cron scheduler stop error", log.String("error", err.Error()))
	}

	stopErr := eng.d.Stop(ctx)
```

with:

```go
		eng.logger.Error("cron scheduler stop error", log.String("error", err.Error()))
	}

	// Let in-flight workflow replays finish before the dispatcher goes,
	// up to ctx's deadline. Shutdown also refuses any replay asked for
	// from here on. A replay still going when ctx expires is left to
	// finish; if the process exits first, its run is still running in
	// the store and the next Start resumes it, so this only logs.
	if err := eng.wfRunner.Shutdown(ctx); err != nil {
		eng.logger.Warn("workflow runner shutdown incomplete", log.String("error", err.Error()))
	}

	stopErr := eng.d.Stop(ctx)
```

Leave everything else in `Stop` where it is: wake listener, heartbeat, deregister, cron scheduler, then (new) the workflow runner, then the dispatcher, then `stopOnce.Do(eng.closeExecutors)`. A second `Stop` calls `Shutdown` again, which returns at once (`TestEngine_StopTwiceClosesExecutorsOnce` still passes).

- [ ] **Step 13: Run the engine tests and see them pass**

Run: `go test -race -count=1 -run 'ReplayWorkflowFrom|StopWaitsForReplay|StopTwice|Workflow' -v ./engine/ 2>&1 | grep -E '^(--- FAIL|ok|FAIL)'`
Expected:

```
ok  	github.com/xraph/dispatch/engine	1.9s
```

- [ ] **Step 14: Gate**

Run:

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./workflow/... ./engine/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./workflow/... ./engine/...; rm -rf $C
```

Expected: build succeeds; the first `grep` prints nothing; `ok  github.com/xraph/dispatch/workflow` and `ok  github.com/xraph/dispatch/engine` under `-race`; both lint runs print `0 issues.`

- [ ] **Step 15: Commit**

```bash
git add workflow/replay.go workflow/lifecycle.go workflow/replay_test.go engine/ops_workflow.go engine/ops_workflow_test.go
git commit --only -m "feat(workflow): replay a run from a step once, on its own version, in the background

ReplayFrom used to run the whole tail of a workflow inside the caller,
take no claim on the run, and look the handler up with registry.Get. Two
replays started together ran the later steps twice, side by side, and a
run started on v1 could finish on whatever version was registered last.

Replay now plans first. PlanReplay is read-only and says which
checkpointed steps will run again, on which version, and what state the
run is in. ReplayFrom then claims the run with ReopenRun, deletes the
later checkpoints and runs the stamped version on a goroutine the runner
tracks, returning the plan straight away. If the delete fails after the
claim, the run goes back to failed with the reason, so it is never left
running with nothing behind it.

Runner.Shutdown refuses new replays, cancels the ones in flight and
waits for them until its context runs out. Engine Stop calls it before
the dispatcher stops. The engine gains PlanWorkflowReplay and
ReplayWorkflowFrom, and the second emits one workflow.replayed action." -- workflow/replay.go workflow/lifecycle.go workflow/replay_test.go workflow/runner.go workflow/debug.go workflow/debug_test.go engine/ops_workflow.go engine/ops_workflow_test.go engine/engine.go
git show --stat HEAD | tail -11
```

Expected: 9 files changed, the five new ones plus `engine/engine.go`, `workflow/debug.go`, `workflow/debug_test.go` and `workflow/runner.go`.

---

### Task 11: The REST api uses the engine's operator methods

The REST handlers in `api/` do their own state checks and store writes. Cancel refuses a running job, retry resets the row itself without claiming the job's dead letter entry, replay and replay-all skip the engine (so no operator hook fires and an unschedulable job answers 500), purge always reaches back 30 days, and cron enable writes the whole row back, so a schedule that never fires comes back enabled with a next run an hour away. This task points every one of those routes at the engine methods from Tasks 8 to 10, so REST and the dashboard share one set of rules and every action reaches `OnOperatorAction`. It adds the routes the engine now makes possible: delete one DLQ entry, run a cron now, and plan or start a workflow replay from a step. Refusals that come from the state of things answer 409, a workflow runner that has shut down answers 503, and not found stays 404.

Two things the new tests turned up are fixed here as well. `engine.RegisterCron` stored the zero time as `next_run_at` for a schedule that never fires (`0 0 30 2 *`), and the scheduler reads a zero `next_run_at` as due, so the entry fired on every tick; registration now refuses it. And every handler that wrote its own JSON also returned the value, so forge's router wrote the body a second time (`{...}\n{...}\n`, which `json.Unmarshal` rejects). The routes touched here, plus the four single-item reads, return `nil` after writing.

The actor: forge's router carries a `forge.Scope` (app and org), not a user. The only subject forge has is `dashboard/auth.UserInfo`, set by the dashboard's own middleware on dashboard routes, and that package pulls templ (see the global constraint on the root dashboard import). So the REST api passes no actor and `ext.Action.Actor` is empty for REST actions. The dashboard contract (slice 3) sets it with `ext.WithActor`.

**Files:**
- Modify: `engine/engine.go` (`RegisterCron`, the "Compute the initial NextRunAt" block)
- Modify: `engine/engine_test.go` (append after `TestEngine_RegisterCronInvalidSchedule`)
- Modify: `api/requests.go` (imports at line 4; workflow DTOs before `ListWorkflowNamesResponse`; `PurgeDLQResponse` and `ReplayAllDLQResponse` at lines 85 to 94; after `DeleteCronRequest`)
- Modify: `api/job_handler.go` (imports at lines 4 to 15; `getJob`'s return; `cancelJob` and `retryJob` at lines 56 to 122; `mapStoreError` at lines 166 to 175)
- Modify: `api/dlq_handler.go` (imports; `getDLQ`'s return; `replayDLQ`, `replayAllDLQ`, `purgeDLQ` at lines 43 to 89)
- Modify: `api/cron_handler.go` (imports; `getCron`'s return; `enableCron`, `disableCron`, `deleteCron` at lines 60 to 126)
- Modify: `api/workflow_handler.go` (`getWorkflowRun`'s return; append two handlers)
- Modify: `api/api.go` (route registration in `registerJobRoutes`, `registerWorkflowRoutes`, `registerDLQRoutes`, `registerCronRoutes`)
- Modify: `docs/content/docs/api-reference/http-api.mdx`, `docs/content/docs/subsystems/admin-api.mdx`, `docs/content/docs/subsystems/dlq.mdx`, `docs/content/docs/subsystems/endpoints.mdx`
- Create: `api/helpers_test.go`, `api/job_handler_test.go`, `api/dlq_handler_test.go`, `api/cron_handler_test.go`, `api/workflow_handler_test.go`, `api/get_routes_test.go`

**Interfaces:**
- Consumes: `(*engine.Engine).CancelJob`, `RetryJob`, `ReplayDLQ`, `ReplayAllDLQ(ctx, engine.ReplayAllOpts{Queue, Limit}) (engine.ReplayAllResult{Replayed, Conflicts, Failed int; Errors []string}, error)`, `DeleteDLQ`, `PurgeDLQ(ctx, before)`, `CountDLQPurge(ctx, before)`, `EnableCron`, `DisableCron`, `DeleteCron`, `TriggerCron`, `PlanWorkflowReplay`, `ReplayWorkflowFrom`; `workflow.ReplayPlan` (JSON `run_id`, `from_step`, `version`, `reruns`, `state`); sentinels `dispatch.ErrInvalidState`, `dispatch.ErrDLQAlreadyReplayed`, `resource.ErrUnschedulable`, `workflow.ErrRunnerShutdown`, and the not-found sentinels `mapStoreError` already knew.
- Produces (routes, all under `/v1`; error bodies are forge's `{"code": <status>, "error": "<message>"}`, and 5xx bodies are redacted by forge):

| Method and path | Request | Success | Refusals |
|---|---|---|---|
| `POST /jobs/:jobId/cancel` | none | 204 | 409 completed, failed or cancelled; 404; 400 bad ID |
| `POST /jobs/:jobId/retry` | none | 204 | 409 not failed, or its DLQ entry already replayed; 404; 400 |
| `POST /dlq/:entryId/replay` | none | 201 `job.Job` | 409 already replayed, or unschedulable; 404; 400 |
| `DELETE /dlq/:entryId` (new) | none | 204 | 404; 400 |
| `POST /dlq/replay-all` | query `queue`, `limit` (0 to 1000, 0 means 1000) | 200 `{"replayed","conflicts","errors","error_messages"}` | 400 bad limit |
| `POST /dlq/purge` | query `before` (RFC 3339) or `older_than` (positive Go duration), `dry_run` (bool); neither cutoff means 30 days | 200 `{"purged","matched","dry_run","before"}` | 400 both cutoffs, unparseable, zero time, non-positive duration |
| `POST /crons/:cronId/enable` | none | 200 `cron.Entry` | 409 schedule never fires; 404; 400 |
| `POST /crons/:cronId/disable` | none | 200 `cron.Entry` | 404; 400 |
| `DELETE /crons/:cronId` | none | 204 | 404; 400 |
| `POST /crons/:cronId/trigger` (new) | none | 201 `job.Job` | 409 unschedulable; 404; 400 |
| `GET /workflows/runs/:runId/replay?step=` (new) | query `step` (required) | 200 `workflow.ReplayPlan` | 409 no checkpoint or version unregistered; 404; 400 missing step or bad ID |
| `POST /workflows/runs/:runId/replay` (new) | JSON `{"step": "..."}` | 202 `workflow.ReplayPlan` | 409 running, no checkpoint, version unregistered; 503 runner shut down; 404; 400 |

Go types added in `api`: `PlanWorkflowReplayRequest`, `ReplayWorkflowRequest`, `DeleteDLQRequest`, `ReplayAllDLQRequest`, `PurgeDLQRequest`, `TriggerCronRequest`, `ErrorResponse`; `ReplayAllDLQResponse` gains `Conflicts` and `ErrorMessages`; `PurgeDLQResponse` gains `Matched`, `DryRun`, `Before`. `mapStoreError` now maps 404, 409 and 503.

`ReplayAllDLQResponse.Errors` keeps its old meaning, the number of entries that failed, now `ReplayAllResult.Failed`. `error_messages` is always a list, never `null`. Cancel and retry keep answering 204 with no body, as before.

Forge binding facts this task relies on (forge v1.12.0, go-utils v1.3.0): a POST whose request struct has a `json:` field fails binding with 400 when the body is empty, which is why replay-all and purge take query parameters (an old client posting no body keeps working) while the new workflow replay takes a JSON body. A non-pointer query field is required unless tagged `optional:"true"`. An opinionated handler `func(forge.Context, *Req) (*Resp, error)` that returns a non-nil `*Resp` has it written by the router, so a handler that already called `ctx.JSON` must return `nil`.

- [ ] **Step 1: Check the base**

Run: `git status --porcelain api engine docs && git log --oneline -1 && grep -n 'func (eng \*Engine) ReplayWorkflowFrom\|func (eng \*Engine) TriggerCron\|func (eng \*Engine) ReplayAllDLQ' engine/*.go`
Expected: no lines from `git status`, and the three engine methods found (in `engine/ops_workflow.go`, `engine/ops_cron.go`, `engine/ops_dlq.go`). If any is missing, stop: this task needs Tasks 8 to 10.

- [ ] **Step 2: Write the failing RegisterCron test**

At the end of `TestEngine_RegisterCronInvalidSchedule`. Replace this in `engine/engine_test.go`:

```go
	if err == nil {
		t.Fatal("expected error for invalid cron schedule")
	}
}
```

with:

```go
	if err == nil {
		t.Fatal("expected error for invalid cron schedule")
	}
}

// TestEngine_RegisterCronRefusesAScheduleThatNeverFires registers 30
// February. The parser accepts it, but it has no fire time, and a stored
// zero next_run_at is due on every scheduler tick. Registration must
// refuse it and store nothing.
func TestEngine_RegisterCronRefusesAScheduleThatNeverFires(t *testing.T) {
	s := memory.New()
	d, err := dispatch.New(dispatch.WithStore(s))
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}

	eng, err := engine.Build(d)
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}

	ctx := context.Background()
	err = engine.RegisterCron(ctx, eng, &cron.Definition[struct{}]{
		Name:     "never-cron",
		Schedule: "0 0 30 2 *",
		JobName:  "noop",
		Payload:  struct{}{},
	})
	if !errors.Is(err, dispatch.ErrInvalidState) {
		t.Fatalf("RegisterCron error = %v, want ErrInvalidState", err)
	}

	entries, err := s.ListCrons(ctx)
	if err != nil {
		t.Fatalf("ListCrons: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("stored %d cron entries for a schedule that never fires, want 0", len(entries))
	}
}
```

- [ ] **Step 3: Run it and see it fail**

Run: `go test ./engine/ -run 'TestEngine_RegisterCron'`
Expected:

```
--- FAIL: TestEngine_RegisterCronRefusesAScheduleThatNeverFires (0.00s)
    engine_test.go:1647: RegisterCron error = <nil>, want ErrInvalidState
FAIL
```

- [ ] **Step 4: Refuse the schedule in RegisterCron**

In `RegisterCron`. Replace this in `engine/engine.go`:

```go
	// Compute the initial NextRunAt.
	now := time.Now().UTC()
	next := sched.Next(now)
```

with:

```go
	// Compute the initial NextRunAt. A schedule the parser accepts can
	// still never fire (30 February), and Next says so with the zero
	// time. Stored, that zero is due on every tick, so refuse it here.
	now := time.Now().UTC()
	next := sched.Next(now)
	if next.IsZero() {
		return fmt.Errorf("%w: cron %q schedule %q never fires",
			dispatch.ErrInvalidState, def.Name, def.Schedule)
	}
```

`fmt` and `dispatch` are already imported in `engine/engine.go`.

- [ ] **Step 5: Run it and see it pass, then gate and commit the fix**

Run: `go test ./engine/ -run 'TestEngine_RegisterCron' -v 2>&1 | grep -E '^(---|ok)'`
Expected:

```
--- PASS: TestEngine_RegisterCronIdempotent (0.00s)
--- PASS: TestEngine_RegisterCronInvalidSchedule (0.00s)
--- PASS: TestEngine_RegisterCronRefusesAScheduleThatNeverFires (0.00s)
ok  	github.com/xraph/dispatch/engine
```

Then: `go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'; C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C`
Expected: no FAIL lines, `0 issues.`

```bash
git commit --only -m "fix(engine): refuse a cron schedule that never fires at registration

RegisterCron stored whatever the parsed schedule's Next returned as the
first next_run_at. A schedule the parser accepts can still have no fire
time at all (0 0 30 2 *), and then Next returns the zero time. The
scheduler reads a zero next_run_at as due, so the entry fired on every
tick. Registration now fails with an error wrapping
dispatch.ErrInvalidState and stores nothing, which is the refusal
EnableCron already gives for the same schedule." -- engine/engine.go engine/engine_test.go
git show --stat HEAD | tail -3
```

Expected: `2 files changed, 43 insertions(+), 1 deletion(-)`.

- [ ] **Step 6: Add the request and response types**

The tests in the next step build against these. They change no behaviour on their own.

The import line. Replace this in `api/requests.go`:

```go
import "github.com/xraph/dispatch/job"
```

with:

```go
import (
	"time"

	"github.com/xraph/dispatch/job"
)
```

The comment line above `ListWorkflowNamesResponse`. Replace this in `api/requests.go`:

```go
// ListWorkflowNamesResponse contains the registered workflow names.
```

with:

```go
// PlanWorkflowReplayRequest asks what replaying a run from a step would do.
type PlanWorkflowReplayRequest struct {
	RunID string `path:"runId" description:"Workflow run ID"`
	Step  string `query:"step" required:"true" description:"Checkpointed step to replay from"`
}

// ReplayWorkflowRequest replays a finished run from a step.
type ReplayWorkflowRequest struct {
	RunID string `path:"runId" description:"Workflow run ID"`
	Step  string `json:"step" description:"Checkpointed step to replay from; it and every step before it are kept"`
}

// ListWorkflowNamesResponse contains the registered workflow names.
```

Replace this in `api/requests.go`:

```go
// PurgeDLQResponse contains the number of entries purged.
type PurgeDLQResponse struct {
	Purged int64 `json:"purged"`
}

// ReplayAllDLQResponse contains the number of entries replayed.
type ReplayAllDLQResponse struct {
	Replayed int64 `json:"replayed"`
	Errors   int64 `json:"errors"`
}
```

with:

```go
// DeleteDLQRequest is the request for deleting a DLQ entry.
type DeleteDLQRequest struct {
	EntryID string `path:"entryId" description:"DLQ entry ID"`
}

// ReplayAllDLQRequest selects the entries replay-all tries. Both fields
// are query parameters, so a POST with no body still works.
type ReplayAllDLQRequest struct {
	Queue string `query:"queue" optional:"true" description:"Replay only entries from this queue (default: every queue)"`
	Limit int    `query:"limit" optional:"true" description:"Maximum number of entries to try, 1 to 1000 (default: 1000)"`
}

// ReplayAllDLQResponse counts what replay-all did with each entry it
// tried. Errors is the number that failed, as it always was.
type ReplayAllDLQResponse struct {
	Replayed      int64    `json:"replayed"`
	Conflicts     int64    `json:"conflicts"`
	Errors        int64    `json:"errors"`
	ErrorMessages []string `json:"error_messages"`
}

// PurgeDLQRequest sets the purge cutoff. Give before or older_than, not
// both; with neither the cutoff is 30 days ago. Query parameters, so a
// POST with no body still works.
type PurgeDLQRequest struct {
	Before    string `query:"before" optional:"true" description:"Purge entries that failed before this RFC 3339 time"`
	OlderThan string `query:"older_than" optional:"true" description:"Purge entries that failed longer ago than this Go duration, e.g. 72h"`
	DryRun    bool   `query:"dry_run" optional:"true" description:"Count the entries the cutoff matches without deleting any"`
}

// PurgeDLQResponse reports a purge. Matched is how many entries failed
// before the cutoff; Purged is how many were deleted, zero on a dry run.
type PurgeDLQResponse struct {
	Purged  int64     `json:"purged"`
	Matched int64     `json:"matched"`
	DryRun  bool      `json:"dry_run"`
	Before  time.Time `json:"before"`
}
```

Replace this in `api/requests.go`:

```go
// DeleteCronRequest is the request for deleting a cron entry.
type DeleteCronRequest struct {
	CronID string `path:"cronId" description:"Cron entry ID"`
}
```

with:

```go
// DeleteCronRequest is the request for deleting a cron entry.
type DeleteCronRequest struct {
	CronID string `path:"cronId" description:"Cron entry ID"`
}

// TriggerCronRequest is the request for running a cron entry's job now.
type TriggerCronRequest struct {
	CronID string `path:"cronId" description:"Cron entry ID"`
}

// ──────────────────────────────────────────────────
// Error response
// ──────────────────────────────────────────────────

// ErrorResponse is the body the router writes for an error. The operator
// routes declare it for 409 and 503, which WithErrorResponses leaves out.
type ErrorResponse struct {
	Code  int    `json:"code"`
	Error string `json:"error"`
}
```

- [ ] **Step 7: Write the failing handler tests**

The api package has no tests yet. Create these six files.

Create `api/helpers_test.go`: The fixture mounts the api on a fresh forge router through `api.New(eng, nil).Handler()`, which is how a standalone server mounts it. `decode` uses `json.Unmarshal` on the whole body on purpose, so a body written twice fails instead of passing on its first half.

```go
package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/api"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/store/memory"
)

// fixture is an engine on a memory store with the REST api mounted on a
// fresh forge router, the way API.Handler mounts it in production.
type fixture struct {
	eng *engine.Engine
	s   *memory.Store
	h   http.Handler
}

func newFixture(t *testing.T, opts ...engine.Option) *fixture {
	t.Helper()

	s := memory.New()
	d, err := dispatch.New(dispatch.WithStore(s))
	if err != nil {
		t.Fatalf("dispatch.New: %v", err)
	}

	eng, err := engine.Build(d, opts...)
	if err != nil {
		t.Fatalf("engine.Build: %v", err)
	}
	t.Cleanup(func() { _ = eng.Stop(context.Background()) })

	return &fixture{eng: eng, s: s, h: api.New(eng, nil).Handler()}
}

// do sends one request through the router. A non-empty body goes as JSON.
func (f *fixture) do(t *testing.T, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()

	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, target, r)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)

	return rec
}

// wantStatus stops the test when rec answered anything but want.
func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()

	if rec.Code != want {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, want, rec.Body.String())
	}
}

// decode reads the whole body as one T. It uses json.Unmarshal rather
// than a Decoder on purpose: a body written twice fails here instead of
// passing on its first half.
func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()

	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %T: %v; body %s", v, err, rec.Body.String())
	}

	return v
}

// jobInState enqueues a job and moves it straight to state, without a
// worker.
func jobInState(t *testing.T, f *fixture, state job.State, opts ...job.Option) *job.Job {
	t.Helper()

	j, err := f.eng.EnqueueRaw(context.Background(), "api-job", []byte(`{"n":1}`), opts...)
	if err != nil {
		t.Fatalf("EnqueueRaw: %v", err)
	}
	if state == job.StatePending {
		return j
	}

	j.State = state
	if err := f.s.UpdateJob(context.Background(), j); err != nil {
		t.Fatalf("UpdateJob: %v", err)
	}

	return j
}

// failedWithEntry puts a job in failed and gives it a dead letter entry,
// the way the runner leaves a job that ran out of retries.
func failedWithEntry(t *testing.T, f *fixture, opts ...job.Option) (*job.Job, *dlq.Entry) {
	t.Helper()
	ctx := context.Background()

	j := jobInState(t, f, job.StateFailed, opts...)
	if err := f.eng.DLQService().Push(ctx, j, errors.New("boom")); err != nil {
		t.Fatalf("Push: %v", err)
	}

	entry, err := f.s.GetDLQByJobID(ctx, j.ID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	return j, entry
}

func storedJob(t *testing.T, f *fixture, jobID id.JobID) *job.Job {
	t.Helper()

	j, err := f.s.GetJob(context.Background(), jobID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}

	return j
}
```

Create `api/job_handler_test.go`:

```go
package api_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

func TestCancelJob(t *testing.T) {
	cases := []struct {
		state job.State
		want  int
	}{
		{job.StatePending, http.StatusNoContent},
		{job.StateRetrying, http.StatusNoContent},
		{job.StateRunning, http.StatusNoContent},
		{job.StateCompleted, http.StatusConflict},
		{job.StateFailed, http.StatusConflict},
		{job.StateCancelled, http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(string(tc.state), func(t *testing.T) {
			f := newFixture(t)
			j := jobInState(t, f, tc.state)

			rec := f.do(t, http.MethodPost, "/v1/jobs/"+j.ID.String()+"/cancel", "")
			wantStatus(t, rec, tc.want)

			got := storedJob(t, f, j.ID)
			switch {
			case tc.want == http.StatusNoContent && got.State != job.StateCancelled:
				t.Errorf("state = %s, want cancelled", got.State)
			case tc.want == http.StatusConflict && got.State != tc.state:
				t.Errorf("a refused cancel moved the job from %s to %s", tc.state, got.State)
			}
		})
	}
}

func TestCancelJob_UnknownAndMalformed(t *testing.T) {
	f := newFixture(t)

	wantStatus(t, f.do(t, http.MethodPost, "/v1/jobs/"+id.NewJobID().String()+"/cancel", ""), http.StatusNotFound)
	wantStatus(t, f.do(t, http.MethodPost, "/v1/jobs/nope/cancel", ""), http.StatusBadRequest)
}

func TestRetryJob(t *testing.T) {
	f := newFixture(t)
	j, entry := failedWithEntry(t, f)

	wantStatus(t, f.do(t, http.MethodPost, "/v1/jobs/"+j.ID.String()+"/retry", ""), http.StatusNoContent)

	got := storedJob(t, f, j.ID)
	if got.State != job.StatePending || got.RetryCount != 0 || got.LastError != "" {
		t.Errorf("job = state %s, retries %d, error %q; want pending, 0, empty", got.State, got.RetryCount, got.LastError)
	}

	// The retry claims the job's dead letter entry, so it cannot also be
	// replayed into a second copy of the same work.
	claimed, err := f.s.GetDLQ(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("GetDLQ: %v", err)
	}
	if claimed.ReplayedJobID == nil || *claimed.ReplayedJobID != j.ID {
		t.Errorf("entry ReplayedJobID = %v, want %s", claimed.ReplayedJobID, j.ID)
	}
	wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/"+entry.ID.String()+"/replay", ""), http.StatusConflict)
}

func TestRetryJob_Refusals(t *testing.T) {
	f := newFixture(t)

	t.Run("not failed", func(t *testing.T) {
		j := jobInState(t, f, job.StatePending)
		wantStatus(t, f.do(t, http.MethodPost, "/v1/jobs/"+j.ID.String()+"/retry", ""), http.StatusConflict)
	})

	t.Run("entry already replayed", func(t *testing.T) {
		j, entry := failedWithEntry(t, f)
		wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/"+entry.ID.String()+"/replay", ""), http.StatusCreated)

		wantStatus(t, f.do(t, http.MethodPost, "/v1/jobs/"+j.ID.String()+"/retry", ""), http.StatusConflict)
		if got := storedJob(t, f, j.ID); got.State != job.StateFailed {
			t.Errorf("a refused retry moved the job to %s", got.State)
		}
	})

	t.Run("unknown", func(t *testing.T) {
		wantStatus(t, f.do(t, http.MethodPost, "/v1/jobs/"+id.NewJobID().String()+"/retry", ""), http.StatusNotFound)
	})
}
```

Create `api/dlq_handler_test.go`: `bigFailedEntry` is the same trick `engine/ops_dlq_test.go` uses for `ErrUnschedulable`: a job sized for 8 CPUs against a fleet ceiling of 2.

```go
package api_test

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/xraph/dispatch/api"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/resource"
)

func TestReplayDLQ(t *testing.T) {
	f := newFixture(t)
	failed, entry := failedWithEntry(t, f)

	rec := f.do(t, http.MethodPost, "/v1/dlq/"+entry.ID.String()+"/replay", "")
	wantStatus(t, rec, http.StatusCreated)

	j := decode[job.Job](t, rec)
	if j.ID == failed.ID || j.Name != failed.Name || j.State != job.StatePending {
		t.Errorf("replayed job = %s %q %s; want a new pending %q", j.ID, j.Name, j.State, failed.Name)
	}

	// Replaying the same entry again is refused: it already made a job.
	wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/"+entry.ID.String()+"/replay", ""), http.StatusConflict)
	wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/"+id.NewDLQID().String()+"/replay", ""), http.StatusNotFound)
	wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/nope/replay", ""), http.StatusBadRequest)
}

// bigFailedEntry gives f a dead letter entry for a job sized for 8 CPUs,
// as if the fleet had been bigger when it was enqueued.
func bigFailedEntry(t *testing.T, f *fixture) *dlq.Entry {
	t.Helper()
	ctx := context.Background()

	j := jobInState(t, f, job.StateFailed)
	j.Resources = resource.CPUs(8)
	if err := f.s.UpdateJob(ctx, j); err != nil {
		t.Fatalf("UpdateJob: %v", err)
	}
	if err := f.eng.DLQService().Push(ctx, j, context.DeadlineExceeded); err != nil {
		t.Fatalf("Push: %v", err)
	}
	entry, err := f.s.GetDLQByJobID(ctx, j.ID)
	if err != nil {
		t.Fatalf("GetDLQByJobID: %v", err)
	}

	return entry
}

func TestReplayDLQ_Unschedulable(t *testing.T) {
	f := newFixture(t, engine.WithWorkerCapacity(resource.CPUs(2)))
	entry := bigFailedEntry(t, f)

	wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/"+entry.ID.String()+"/replay", ""), http.StatusConflict)
}

func TestReplayAllDLQ(t *testing.T) {
	f := newFixture(t)
	failedWithEntry(t, f)
	failedWithEntry(t, f)
	failedWithEntry(t, f, job.WithQueue("mail"))

	rec := f.do(t, http.MethodPost, "/v1/dlq/replay-all?queue=mail", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[api.ReplayAllDLQResponse](t, rec); got.Replayed != 1 || got.Errors != 0 {
		t.Errorf("queue=mail: %+v, want 1 replayed", got)
	}

	// No parameters and no body, as the route has always been called.
	rec = f.do(t, http.MethodPost, "/v1/dlq/replay-all", "")
	wantStatus(t, rec, http.StatusOK)
	got := decode[api.ReplayAllDLQResponse](t, rec)
	if got.Replayed != 2 || got.Conflicts != 0 || got.Errors != 0 {
		t.Errorf("replay-all: %+v, want 2 replayed and nothing else", got)
	}
	if got.ErrorMessages == nil || len(got.ErrorMessages) != 0 {
		t.Errorf("error_messages = %#v, want an empty list", got.ErrorMessages)
	}

	rec = f.do(t, http.MethodPost, "/v1/dlq/replay-all", "")
	wantStatus(t, rec, http.StatusOK)
	if again := decode[api.ReplayAllDLQResponse](t, rec); again.Replayed != 0 {
		t.Errorf("second replay-all replayed %d, want 0", again.Replayed)
	}
}

func TestReplayAllDLQ_LimitAndFailures(t *testing.T) {
	f := newFixture(t, engine.WithWorkerCapacity(resource.CPUs(2)))
	bigFailedEntry(t, f)
	// IDs sort by creation time; two milliseconds apart keeps "newest"
	// unambiguous.
	time.Sleep(2 * time.Millisecond)
	failedWithEntry(t, f)

	// The limit takes the newest entry, which is the schedulable one.
	rec := f.do(t, http.MethodPost, "/v1/dlq/replay-all?limit=1", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[api.ReplayAllDLQResponse](t, rec); got.Replayed != 1 || got.Errors != 0 {
		t.Errorf("limit=1: %+v, want 1 replayed", got)
	}

	rec = f.do(t, http.MethodPost, "/v1/dlq/replay-all", "")
	wantStatus(t, rec, http.StatusOK)
	got := decode[api.ReplayAllDLQResponse](t, rec)
	if got.Replayed != 0 || got.Errors != 1 || len(got.ErrorMessages) != 1 {
		t.Errorf("unschedulable entry: %+v, want 1 error with its message", got)
	}

	for _, q := range []string{"limit=-1", "limit=1001", "limit=lots"} {
		wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/replay-all?"+q, ""), http.StatusBadRequest)
	}
}

// pushAged stores a dead letter entry that failed age ago.
func pushAged(t *testing.T, f *fixture, age time.Duration) {
	t.Helper()

	at := time.Now().UTC().Add(-age)
	e := &dlq.Entry{
		ID:        id.NewDLQID(),
		JobID:     id.NewJobID(),
		JobName:   "api-job",
		Queue:     "default",
		Payload:   []byte(`{}`),
		Error:     "boom",
		FailedAt:  at,
		CreatedAt: at,
	}
	if err := f.s.PushDLQ(context.Background(), e); err != nil {
		t.Fatalf("PushDLQ: %v", err)
	}
}

func dlqCount(t *testing.T, f *fixture) int64 {
	t.Helper()

	n, err := f.s.CountDLQ(context.Background())
	if err != nil {
		t.Fatalf("CountDLQ: %v", err)
	}

	return n
}

func TestPurgeDLQ_DefaultsToThirtyDays(t *testing.T) {
	f := newFixture(t)
	pushAged(t, f, 31*24*time.Hour)
	pushAged(t, f, 24*time.Hour)

	rec := f.do(t, http.MethodPost, "/v1/dlq/purge", "")
	wantStatus(t, rec, http.StatusOK)

	got := decode[api.PurgeDLQResponse](t, rec)
	if got.Purged != 1 || got.Matched != 1 || got.DryRun {
		t.Errorf("purge = %+v, want 1 purged and matched", got)
	}
	if age := time.Since(got.Before); age < 30*24*time.Hour-time.Minute || age > 30*24*time.Hour+time.Minute {
		t.Errorf("before = %v, want about 30 days ago", got.Before)
	}
	if n := dlqCount(t, f); n != 1 {
		t.Errorf("entries left = %d, want 1", n)
	}
}

func TestPurgeDLQ_Cutoffs(t *testing.T) {
	f := newFixture(t)
	pushAged(t, f, 48*time.Hour)
	pushAged(t, f, 24*time.Hour)
	pushAged(t, f, time.Hour)

	rec := f.do(t, http.MethodPost, "/v1/dlq/purge?dry_run=true&older_than=12h", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[api.PurgeDLQResponse](t, rec); got.Matched != 2 || got.Purged != 0 || !got.DryRun {
		t.Errorf("dry run = %+v, want 2 matched, 0 purged", got)
	}
	if n := dlqCount(t, f); n != 3 {
		t.Fatalf("a dry run deleted entries: %d left, want 3", n)
	}

	before := time.Now().UTC().Add(-36 * time.Hour).Format(time.RFC3339)
	rec = f.do(t, http.MethodPost, "/v1/dlq/purge?"+url.Values{"before": {before}}.Encode(), "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[api.PurgeDLQResponse](t, rec); got.Purged != 1 {
		t.Errorf("before 36h ago: purged %d, want 1", got.Purged)
	}

	rec = f.do(t, http.MethodPost, "/v1/dlq/purge?older_than=12h", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[api.PurgeDLQResponse](t, rec); got.Purged != 1 {
		t.Errorf("older than 12h: purged %d, want 1", got.Purged)
	}
	if n := dlqCount(t, f); n != 1 {
		t.Errorf("entries left = %d, want 1", n)
	}
}

func TestPurgeDLQ_BadCutoffs(t *testing.T) {
	f := newFixture(t)
	pushAged(t, f, 31*24*time.Hour)

	for _, q := range []string{
		"before=2026-01-01T00:00:00Z&older_than=1h",
		"before=yesterday",
		"before=0001-01-01T00:00:00Z",
		"older_than=soon",
		"older_than=0s",
		"older_than=-1h",
		"dry_run=maybe",
	} {
		wantStatus(t, f.do(t, http.MethodPost, "/v1/dlq/purge?"+q, ""), http.StatusBadRequest)
	}
	if n := dlqCount(t, f); n != 1 {
		t.Errorf("a refused purge deleted entries: %d left, want 1", n)
	}
}

func TestDeleteDLQ(t *testing.T) {
	f := newFixture(t)
	_, entry := failedWithEntry(t, f)
	path := "/v1/dlq/" + entry.ID.String()

	wantStatus(t, f.do(t, http.MethodDelete, path, ""), http.StatusNoContent)
	wantStatus(t, f.do(t, http.MethodGet, path, ""), http.StatusNotFound)
	wantStatus(t, f.do(t, http.MethodDelete, path, ""), http.StatusNotFound)
	wantStatus(t, f.do(t, http.MethodDelete, "/v1/dlq/nope", ""), http.StatusBadRequest)
}
```

Create `api/cron_handler_test.go`:

```go
package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)

// addCron stores an entry directly, so a test controls every field.
func addCron(t *testing.T, f *fixture, schedule string, enabled bool) *cron.Entry {
	t.Helper()

	next := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	e := &cron.Entry{
		Entity:    dispatch.NewEntity(),
		ID:        id.NewCronID(),
		Name:      "nightly-" + id.NewCronID().String(),
		Schedule:  schedule,
		JobName:   "report",
		Queue:     "reports",
		Payload:   []byte(`{"kind":"sales"}`),
		NextRunAt: &next,
		Enabled:   enabled,
	}
	if err := f.s.RegisterCron(context.Background(), e); err != nil {
		t.Fatalf("RegisterCron: %v", err)
	}

	return e
}

func TestCronEnableDisable(t *testing.T) {
	f := newFixture(t)
	e := addCron(t, f, "0 3 * * *", true)
	path := "/v1/crons/" + e.ID.String()

	rec := f.do(t, http.MethodPost, path+"/disable", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[cron.Entry](t, rec); got.ID != e.ID || got.Enabled {
		t.Errorf("disable answered %s enabled=%v, want %s disabled", got.ID, got.Enabled, e.ID)
	}

	rec = f.do(t, http.MethodPost, path+"/enable", "")
	wantStatus(t, rec, http.StatusOK)
	got := decode[cron.Entry](t, rec)
	if !got.Enabled || got.NextRunAt == nil || !got.NextRunAt.After(time.Now()) {
		t.Errorf("enable answered enabled=%v next=%v, want enabled with a future next run", got.Enabled, got.NextRunAt)
	}
}

func TestCronEnable_ScheduleThatNeverFires(t *testing.T) {
	f := newFixture(t)
	e := addCron(t, f, "0 0 30 2 *", false) // 30 February

	wantStatus(t, f.do(t, http.MethodPost, "/v1/crons/"+e.ID.String()+"/enable", ""), http.StatusConflict)
}

func TestCronDelete(t *testing.T) {
	f := newFixture(t)
	e := addCron(t, f, "0 3 * * *", true)
	path := "/v1/crons/" + e.ID.String()

	wantStatus(t, f.do(t, http.MethodDelete, path, ""), http.StatusNoContent)
	wantStatus(t, f.do(t, http.MethodGet, path, ""), http.StatusNotFound)
	wantStatus(t, f.do(t, http.MethodDelete, path, ""), http.StatusNotFound)
}

func TestCronTrigger(t *testing.T) {
	f := newFixture(t)
	e := addCron(t, f, "0 3 * * *", false)

	rec := f.do(t, http.MethodPost, "/v1/crons/"+e.ID.String()+"/trigger", "")
	wantStatus(t, rec, http.StatusCreated)

	j := decode[job.Job](t, rec)
	if j.Name != "report" || j.Queue != "reports" || string(j.Payload) != `{"kind":"sales"}` || j.State != job.StatePending {
		t.Errorf("triggered job = %q on %q payload %s state %s; want the entry's pending job", j.Name, j.Queue, j.Payload, j.State)
	}

	// Running it by hand leaves the schedule alone.
	stored, err := f.s.GetCron(context.Background(), e.ID)
	if err != nil {
		t.Fatalf("GetCron: %v", err)
	}
	if stored.NextRunAt == nil || !stored.NextRunAt.Equal(*e.NextRunAt) || stored.LastRunAt != nil {
		t.Errorf("schedule moved: next %v last %v, want next %v and no last run", stored.NextRunAt, stored.LastRunAt, e.NextRunAt)
	}
}

func TestCronOps_UnknownAndMalformed(t *testing.T) {
	f := newFixture(t)
	unknown := "/v1/crons/" + id.NewCronID().String()

	for _, op := range []string{"/enable", "/disable", "/trigger"} {
		wantStatus(t, f.do(t, http.MethodPost, unknown+op, ""), http.StatusNotFound)
		wantStatus(t, f.do(t, http.MethodPost, "/v1/crons/nope"+op, ""), http.StatusBadRequest)
	}
	wantStatus(t, f.do(t, http.MethodDelete, unknown, ""), http.StatusNotFound)
}
```

Create `api/workflow_handler_test.go`: The workflow mirrors `replayEngine` in `engine/ops_workflow_test.go`. The 503 case stops the engine first, which shuts the workflow runner down.

```go
package api_test

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/workflow"
)

// replayFixture registers "api-replay": step-1 always passes, step-2
// fails while fail is set and waits on gate while gate is open.
type replayFixture struct {
	*fixture
	fail atomic.Bool
	gate atomic.Pointer[chan struct{}]
}

func newReplayFixture(t *testing.T) *replayFixture {
	t.Helper()

	rf := &replayFixture{fixture: newFixture(t)}
	engine.RegisterWorkflow(rf.eng, workflow.NewWorkflow("api-replay", func(wf *workflow.Workflow, _ struct{}) error {
		if err := wf.Step("step-1", func(_ context.Context) error {
			time.Sleep(time.Millisecond) // keep checkpoint times apart
			return nil
		}); err != nil {
			return err
		}
		return wf.Step("step-2", func(_ context.Context) error {
			if g := rf.gate.Load(); g != nil {
				<-*g
			}
			if rf.fail.Load() {
				return errors.New("step-2 boom")
			}
			return nil
		})
	}))

	return rf
}

// failedRun starts a run whose step-2 fails and waits for it to finish.
func (rf *replayFixture) failedRun(t *testing.T) *workflow.Run {
	t.Helper()

	rf.fail.Store(true)
	run, err := engine.StartWorkflow(context.Background(), rf.eng, "api-replay", struct{}{})
	if err != nil {
		t.Fatalf("StartWorkflow: %v", err)
	}
	rf.waitState(t, run.ID, workflow.RunStateFailed)
	rf.fail.Store(false)

	return run
}

func (rf *replayFixture) waitState(t *testing.T, runID id.RunID, want workflow.RunState) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for {
		run, err := rf.s.GetRun(context.Background(), runID)
		if err != nil {
			t.Fatalf("GetRun: %v", err)
		}
		if run.State == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("run %s is %s after 5s, want %s", runID, run.State, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestWorkflowReplayPlan(t *testing.T) {
	rf := newReplayFixture(t)
	run := rf.failedRun(t)
	path := "/v1/workflows/runs/" + run.ID.String() + "/replay"

	rec := rf.do(t, http.MethodGet, path+"?step=step-1", "")
	wantStatus(t, rec, http.StatusOK)
	plan := decode[workflow.ReplayPlan](t, rec)
	if plan.RunID != run.ID || plan.FromStep != "step-1" || plan.Version != 1 || plan.State != workflow.RunStateFailed || len(plan.Reruns) != 0 {
		t.Errorf("plan = %+v, want run %s from step-1, version 1, failed, no reruns", plan, run.ID)
	}

	// A plan changes nothing.
	got, err := rf.s.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if got.State != workflow.RunStateFailed {
		t.Errorf("planning moved the run to %s", got.State)
	}

	wantStatus(t, rf.do(t, http.MethodGet, path, ""), http.StatusBadRequest)
	wantStatus(t, rf.do(t, http.MethodGet, path+"?step=step-2", ""), http.StatusConflict) // never checkpointed
	wantStatus(t, rf.do(t, http.MethodGet, "/v1/workflows/runs/"+id.NewRunID().String()+"/replay?step=step-1", ""), http.StatusNotFound)
	wantStatus(t, rf.do(t, http.MethodGet, "/v1/workflows/runs/nope/replay?step=step-1", ""), http.StatusBadRequest)
}

func TestWorkflowReplay(t *testing.T) {
	rf := newReplayFixture(t)
	run := rf.failedRun(t)
	path := "/v1/workflows/runs/" + run.ID.String() + "/replay"

	wantStatus(t, rf.do(t, http.MethodPost, path, ""), http.StatusBadRequest)
	wantStatus(t, rf.do(t, http.MethodPost, path, `{"step":""}`), http.StatusBadRequest)
	wantStatus(t, rf.do(t, http.MethodPost, path, `{"step":"step-2"}`), http.StatusConflict)
	wantStatus(t, rf.do(t, http.MethodPost, "/v1/workflows/runs/"+id.NewRunID().String()+"/replay", `{"step":"step-1"}`), http.StatusNotFound)

	rec := rf.do(t, http.MethodPost, path, `{"step":"step-1"}`)
	wantStatus(t, rec, http.StatusAccepted)
	if plan := decode[workflow.ReplayPlan](t, rec); plan.RunID != run.ID || plan.FromStep != "step-1" {
		t.Errorf("plan = %+v, want run %s from step-1", plan, run.ID)
	}
	rf.waitState(t, run.ID, workflow.RunStateCompleted)
}

func TestWorkflowReplay_RunningRunIsRefused(t *testing.T) {
	rf := newReplayFixture(t)
	run := rf.failedRun(t)
	path := "/v1/workflows/runs/" + run.ID.String() + "/replay"

	// Hold the first replay inside step-2, so the run is running.
	gate := make(chan struct{})
	rf.gate.Store(&gate)
	wantStatus(t, rf.do(t, http.MethodPost, path, `{"step":"step-1"}`), http.StatusAccepted)
	rf.waitState(t, run.ID, workflow.RunStateRunning)

	wantStatus(t, rf.do(t, http.MethodPost, path, `{"step":"step-1"}`), http.StatusConflict)

	close(gate)
	rf.waitState(t, run.ID, workflow.RunStateCompleted)
}

func TestWorkflowReplay_AfterStop(t *testing.T) {
	rf := newReplayFixture(t)
	run := rf.failedRun(t)

	if err := rf.eng.Stop(context.Background()); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	rec := rf.do(t, http.MethodPost, "/v1/workflows/runs/"+run.ID.String()+"/replay", `{"step":"step-1"}`)
	wantStatus(t, rec, http.StatusServiceUnavailable)
}
```

Create `api/get_routes_test.go`:

```go
package api_test

import (
	"net/http"
	"testing"

	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/workflow"
)

// TestGetRoutesWriteOneBody reads one job, entry, cron and run. The
// handlers used to write the body themselves and also return it, so the
// router wrote it a second time and the response held two JSON documents.
func TestGetRoutesWriteOneBody(t *testing.T) {
	rf := newReplayFixture(t)
	j, entry := failedWithEntry(t, rf.fixture)
	e := addCron(t, rf.fixture, "0 3 * * *", true)
	run := rf.failedRun(t)

	rec := rf.do(t, http.MethodGet, "/v1/jobs/"+j.ID.String(), "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[job.Job](t, rec); got.ID != j.ID {
		t.Errorf("job = %s, want %s", got.ID, j.ID)
	}

	rec = rf.do(t, http.MethodGet, "/v1/dlq/"+entry.ID.String(), "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[dlq.Entry](t, rec); got.ID != entry.ID {
		t.Errorf("entry = %s, want %s", got.ID, entry.ID)
	}

	rec = rf.do(t, http.MethodGet, "/v1/crons/"+e.ID.String(), "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[cron.Entry](t, rec); got.ID != e.ID {
		t.Errorf("cron = %s, want %s", got.ID, e.ID)
	}

	rec = rf.do(t, http.MethodGet, "/v1/workflows/runs/"+run.ID.String(), "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[workflow.Run](t, rec); got.ID != run.ID {
		t.Errorf("run = %s, want %s", got.ID, run.ID)
	}
}
```

- [ ] **Step 8: Run them and see them fail**

Run: `go test -count=1 ./api/ 2>&1 | grep -E '^(--- FAIL|FAIL|ok)'`
Expected (checked on 2026-10-07):

```
--- FAIL: TestCronEnableDisable (0.00s)
--- FAIL: TestCronEnable_ScheduleThatNeverFires (0.00s)
--- FAIL: TestCronTrigger (0.00s)
--- FAIL: TestCronOps_UnknownAndMalformed (0.00s)
--- FAIL: TestReplayDLQ (0.00s)
--- FAIL: TestReplayDLQ_Unschedulable (0.00s)
--- FAIL: TestReplayAllDLQ (0.00s)
--- FAIL: TestReplayAllDLQ_LimitAndFailures (0.00s)
--- FAIL: TestPurgeDLQ_DefaultsToThirtyDays (0.00s)
--- FAIL: TestPurgeDLQ_Cutoffs (0.00s)
--- FAIL: TestPurgeDLQ_BadCutoffs (0.00s)
--- FAIL: TestDeleteDLQ (0.00s)
--- FAIL: TestGetRoutesWriteOneBody (0.00s)
--- FAIL: TestCancelJob (0.00s)
--- FAIL: TestRetryJob (0.00s)
--- FAIL: TestRetryJob_Refusals (0.00s)
--- FAIL: TestWorkflowReplayPlan (0.00s)
--- FAIL: TestWorkflowReplay (0.00s)
--- FAIL: TestWorkflowReplay_RunningRunIsRefused (0.00s)
--- FAIL: TestWorkflowReplay_AfterStop (0.00s)
FAIL
```

`TestCancelJob_UnknownAndMalformed` and `TestCronDelete` already pass. The reasons worth reading in the full output: `decode job.Job: invalid character '{' after top-level value` (the doubled body), a running job's cancel answering `400 ... can only cancel pending or retrying jobs`, an unschedulable replay answering 500, a 30 February enable answering 200, `DELETE /v1/dlq/...` answering 405, and the new routes answering `404 page not found`.

- [ ] **Step 9: Map the new refusals to HTTP statuses**

`mapStoreError` keeps its name, since every handler already calls it. The checks use `errors.Is`, so they see through the engine's `fmt.Errorf("...: %w")` wrapping.

The import block. Replace this in `api/job_handler.go`:

```go
import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/xraph/forge"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)
```

with:

```go
import (
	"errors"
	"fmt"
	"net/http"

	"github.com/xraph/forge"

	"github.com/xraph/dispatch"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/resource"
	"github.com/xraph/dispatch/workflow"
)
```

Replace this in `api/job_handler.go`:

```go
// mapStoreError converts dispatch sentinel errors to forge HTTP errors.
func mapStoreError(err error) error {
	if err == nil {
		return nil
	}
	if isNotFound(err) {
		return forge.NotFound(err.Error())
	}
	return err
}
```

with:

```go
// mapStoreError converts dispatch sentinel errors to forge HTTP errors:
// not found answers 404, an operator action the current state refuses
// answers 409, and a workflow runner that has shut down answers 503.
// Anything else passes through and answers 500.
func mapStoreError(err error) error {
	switch {
	case err == nil:
		return nil
	case isNotFound(err):
		return forge.NotFound(err.Error())
	case isConflict(err):
		return forge.NewHTTPError(http.StatusConflict, err.Error())
	case errors.Is(err, workflow.ErrRunnerShutdown):
		return forge.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	default:
		return err
	}
}

// isConflict reports a refusal that comes from the state of things, not
// from the request: the job, run or schedule is in a state that does not
// allow the action, the entry was already replayed, or no worker in the
// fleet is big enough for the job.
func isConflict(err error) bool {
	return errors.Is(err, dispatch.ErrInvalidState) ||
		errors.Is(err, dispatch.ErrDLQAlreadyReplayed) ||
		errors.Is(err, resource.ErrUnschedulable)
}
```

`resource` and `workflow` are new imports here; `time` goes, since the next step removes its last use.

- [ ] **Step 10: Cancel and retry through the engine**

The old retry reset the row itself and never claimed the job's dead letter entry, so a retried job's entry could still be replayed into a second copy of the work. `RetryJob` claims it.

Replace this in `api/job_handler.go`:

```go
func (a *API) cancelJob(ctx forge.Context, _ *CancelJobRequest) (*struct{}, error) {
	jobID, err := id.ParseJobID(ctx.Param("jobId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid job ID: %v", err))
	}

	js, ok := a.eng.Dispatcher().Store().(job.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement job.Store")
	}

	j, err := js.GetJob(ctx.Context(), jobID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	if j.State != job.StatePending && j.State != job.StateRetrying {
		return nil, forge.BadRequest(fmt.Sprintf("can only cancel pending or retrying jobs, current state: %s", j.State))
	}

	now := time.Now().UTC()
	j.State = job.StateCancelled
	j.CompletedAt = &now
	if updateErr := js.UpdateJob(ctx.Context(), j); updateErr != nil {
		return nil, fmt.Errorf("cancel job: %w", updateErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}
```

with:

```go
// cancelJob cancels a pending, retrying or running job through the
// engine. A running job's worker stops when it next touches its lease.
// Any other state answers 409.
func (a *API) cancelJob(ctx forge.Context, _ *CancelJobRequest) (*struct{}, error) {
	jobID, err := id.ParseJobID(ctx.Param("jobId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid job ID: %v", err))
	}

	if _, cancelErr := a.eng.CancelJob(ctx.Context(), jobID); cancelErr != nil {
		return nil, mapStoreError(cancelErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}
```

Replace this in `api/job_handler.go`:

```go
func (a *API) retryJob(ctx forge.Context, _ *RetryJobRequest) (*struct{}, error) {
	jobID, err := id.ParseJobID(ctx.Param("jobId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid job ID: %v", err))
	}

	js, ok := a.eng.Dispatcher().Store().(job.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement job.Store")
	}

	j, err := js.GetJob(ctx.Context(), jobID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	if j.State != job.StateFailed {
		return nil, forge.BadRequest(fmt.Sprintf("can only retry failed jobs, current state: %s", j.State))
	}

	now := time.Now().UTC()
	j.State = job.StatePending
	j.RetryCount = 0
	j.LastError = ""
	j.RunAt = now
	j.CompletedAt = nil
	// Clears StartedAt along with the worker and lease fields the failed
	// run left behind. Without it the retried job carries a lapsed
	// lease_expires_at into pending, which a claim that grants no lease
	// never overwrites — see job.Job.ClearOwnership for why that livelocks.
	j.ClearOwnership()
	if updateErr := js.UpdateJob(ctx.Context(), j); updateErr != nil {
		return nil, fmt.Errorf("retry job: %w", updateErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}
```

with:

```go
// retryJob puts a failed job back to pending through the engine, which
// claims the job's dead letter entry first. Any other state, or an entry
// already replayed, answers 409.
func (a *API) retryJob(ctx forge.Context, _ *RetryJobRequest) (*struct{}, error) {
	jobID, err := id.ParseJobID(ctx.Param("jobId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid job ID: %v", err))
	}

	if _, retryErr := a.eng.RetryJob(ctx.Context(), jobID); retryErr != nil {
		return nil, mapStoreError(retryErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}
```

- [ ] **Step 11: DLQ replay, replay-all, purge and delete through the engine**

In the import block. Replace this in `api/dlq_handler.go`:

```go
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)
```

with:

```go
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)
```

Replace this in `api/dlq_handler.go`:

```go
func (a *API) replayDLQ(ctx forge.Context, _ *ReplayDLQRequest) (*job.Job, error) {
	entryID, err := id.ParseDLQID(ctx.Param("entryId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid DLQ entry ID: %v", err))
	}

	j, err := a.eng.DLQService().Replay(ctx.Context(), entryID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return j, ctx.JSON(http.StatusCreated, j)
}
```

with:

```go
// replayDLQ turns an entry into a new pending job through the engine,
// which claims the entry first. An entry already replayed, or a job no
// worker can run, answers 409.
func (a *API) replayDLQ(ctx forge.Context, _ *ReplayDLQRequest) (*job.Job, error) {
	entryID, err := id.ParseDLQID(ctx.Param("entryId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid DLQ entry ID: %v", err))
	}

	j, err := a.eng.ReplayDLQ(ctx.Context(), entryID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusCreated, j)
}
```

Replace this in `api/dlq_handler.go`:

```go
func (a *API) replayAllDLQ(ctx forge.Context) error {
	store := a.eng.DLQService().DLQStore()
	entries, err := store.ListDLQ(ctx.Context(), dlq.ListOpts{Limit: 1000})
	if err != nil {
		return fmt.Errorf("list dlq for replay-all: %w", err)
	}

	var replayed, errCount int64
	for _, entry := range entries {
		if entry.ReplayedAt != nil {
			continue // already replayed
		}
		if _, replayErr := a.eng.DLQService().Replay(ctx.Context(), entry.ID); replayErr != nil {
			errCount++
		} else {
			replayed++
		}
	}

	return ctx.JSON(http.StatusOK, ReplayAllDLQResponse{Replayed: replayed, Errors: errCount})
}
```

with:

```go
// maxReplayAll is the most entries one replay-all request may try. It is
// the cap the route has always listed with.
const maxReplayAll = 1000

// replayAllDLQ replays every unreplayed entry, newest first, optionally
// in one queue and up to a limit. Entries somebody else claims meanwhile
// count as conflicts; errors counts every other failure.
func (a *API) replayAllDLQ(ctx forge.Context, req *ReplayAllDLQRequest) (*ReplayAllDLQResponse, error) {
	if req.Limit < 0 || req.Limit > maxReplayAll {
		return nil, forge.BadRequest(fmt.Sprintf("limit must be from 0 to %d, and 0 means %d", maxReplayAll, maxReplayAll))
	}

	res, err := a.eng.ReplayAllDLQ(ctx.Context(), engine.ReplayAllOpts{
		Queue: req.Queue,
		Limit: req.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("replay all dlq: %w", err)
	}

	messages := res.Errors
	if messages == nil {
		messages = []string{}
	}

	return nil, ctx.JSON(http.StatusOK, ReplayAllDLQResponse{
		Replayed:      int64(res.Replayed),
		Conflicts:     int64(res.Conflicts),
		Errors:        int64(res.Failed),
		ErrorMessages: messages,
	})
}
```

This replacement also adds `purgeCutoff` and the new `deleteDLQ` handler. Replace this in `api/dlq_handler.go`:

```go
func (a *API) purgeDLQ(ctx forge.Context) error {
	// Purge entries older than 30 days.
	before := time.Now().UTC().Add(-30 * 24 * time.Hour)

	count, err := a.eng.DLQService().DLQStore().PurgeDLQ(ctx.Context(), before)
	if err != nil {
		return fmt.Errorf("purge dlq: %w", err)
	}

	return ctx.JSON(http.StatusOK, PurgeDLQResponse{Purged: count})
}
```

with:

```go
// defaultPurgeAge is how far back a purge reaches when the request names
// no cutoff. Before the route took one, it was the only cutoff there was.
const defaultPurgeAge = 30 * 24 * time.Hour

// purgeDLQ deletes the entries that failed before the cutoff, or with
// dry_run counts them and deletes nothing.
func (a *API) purgeDLQ(ctx forge.Context, req *PurgeDLQRequest) (*PurgeDLQResponse, error) {
	before, err := purgeCutoff(req, time.Now().UTC())
	if err != nil {
		return nil, err
	}

	resp := PurgeDLQResponse{DryRun: req.DryRun, Before: before}
	if req.DryRun {
		n, countErr := a.eng.CountDLQPurge(ctx.Context(), before)
		if countErr != nil {
			return nil, fmt.Errorf("count dlq purge: %w", countErr)
		}
		resp.Matched = n
	} else {
		n, purgeErr := a.eng.PurgeDLQ(ctx.Context(), before)
		if purgeErr != nil {
			return nil, fmt.Errorf("purge dlq: %w", purgeErr)
		}
		resp.Matched = n
		resp.Purged = n
	}

	return nil, ctx.JSON(http.StatusOK, resp)
}

// purgeCutoff reads the purge cutoff from req: before as an RFC 3339
// time, or older_than as a positive Go duration back from now, or 30 days
// back when neither is given. Anything else is a 400.
func purgeCutoff(req *PurgeDLQRequest, now time.Time) (time.Time, error) {
	switch {
	case req.Before != "" && req.OlderThan != "":
		return time.Time{}, forge.BadRequest("give before or older_than, not both")

	case req.Before != "":
		before, err := time.Parse(time.RFC3339, req.Before)
		if err != nil {
			return time.Time{}, forge.BadRequest(fmt.Sprintf("invalid before, want an RFC 3339 time: %v", err))
		}
		if before.IsZero() {
			return time.Time{}, forge.BadRequest("before must not be the zero time")
		}
		return before.UTC(), nil

	case req.OlderThan != "":
		age, err := time.ParseDuration(req.OlderThan)
		if err != nil {
			return time.Time{}, forge.BadRequest(fmt.Sprintf("invalid older_than, want a duration such as 72h: %v", err))
		}
		if age <= 0 {
			return time.Time{}, forge.BadRequest("older_than must be positive")
		}
		return now.Add(-age), nil

	default:
		return now.Add(-defaultPurgeAge), nil
	}
}

// deleteDLQ removes one entry for good.
func (a *API) deleteDLQ(ctx forge.Context, _ *DeleteDLQRequest) (*struct{}, error) {
	entryID, err := id.ParseDLQID(ctx.Param("entryId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid DLQ entry ID: %v", err))
	}

	if delErr := a.eng.DeleteDLQ(ctx.Context(), entryID); delErr != nil {
		return nil, mapStoreError(delErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}
```

- [ ] **Step 12: Cron enable, disable, delete and trigger through the engine**

The old enable and disable wrote the whole row back with `UpdateCronEntry`, which is the write Task 9 took away from the scheduler. They now go through `SetCronEnabled` inside the engine.

The import block. Replace this in `api/cron_handler.go`:

```go
import (
	"fmt"
	"net/http"
	"time"

	"github.com/xraph/forge"

	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
)
```

with:

```go
import (
	"fmt"
	"net/http"

	"github.com/xraph/forge"

	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/id"
	"github.com/xraph/dispatch/job"
)
```

Everything from `func (a *API) enableCron(` to the end of the file (`enableCron`, `disableCron`, `deleteCron`). The replacement adds `triggerCron`. Replace this in `api/cron_handler.go`:

```go
func (a *API) enableCron(ctx forge.Context, _ *EnableCronRequest) (*cron.Entry, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	cs, ok := a.eng.Dispatcher().Store().(cron.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement cron.Store")
	}

	entry, err := cs.GetCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	entry.Enabled = true
	entry.UpdatedAt = time.Now().UTC()
	if updateErr := cs.UpdateCronEntry(ctx.Context(), entry); updateErr != nil {
		return nil, fmt.Errorf("enable cron: %w", updateErr)
	}

	return entry, ctx.JSON(http.StatusOK, entry)
}

func (a *API) disableCron(ctx forge.Context, _ *DisableCronRequest) (*cron.Entry, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	cs, ok := a.eng.Dispatcher().Store().(cron.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement cron.Store")
	}

	entry, err := cs.GetCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	entry.Enabled = false
	entry.UpdatedAt = time.Now().UTC()
	if updateErr := cs.UpdateCronEntry(ctx.Context(), entry); updateErr != nil {
		return nil, fmt.Errorf("disable cron: %w", updateErr)
	}

	return entry, ctx.JSON(http.StatusOK, entry)
}

func (a *API) deleteCron(ctx forge.Context, _ *DeleteCronRequest) (*struct{}, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	cs, ok := a.eng.Dispatcher().Store().(cron.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement cron.Store")
	}

	if delErr := cs.DeleteCron(ctx.Context(), cronID); delErr != nil {
		return nil, mapStoreError(delErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}
```

with:

```go
// enableCron turns an entry on through the engine, which computes the
// next fire time from now. A schedule that never fires answers 409.
func (a *API) enableCron(ctx forge.Context, _ *EnableCronRequest) (*cron.Entry, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	entry, err := a.eng.EnableCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusOK, entry)
}

// disableCron turns an entry off through the engine.
func (a *API) disableCron(ctx forge.Context, _ *DisableCronRequest) (*cron.Entry, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	entry, err := a.eng.DisableCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusOK, entry)
}

// deleteCron removes an entry through the engine.
func (a *API) deleteCron(ctx forge.Context, _ *DeleteCronRequest) (*struct{}, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	if delErr := a.eng.DeleteCron(ctx.Context(), cronID); delErr != nil {
		return nil, mapStoreError(delErr)
	}

	return nil, ctx.NoContent(http.StatusNoContent)
}

// triggerCron enqueues the entry's job now. The schedule is left alone,
// and a disabled entry can be triggered too.
func (a *API) triggerCron(ctx forge.Context, _ *TriggerCronRequest) (*job.Job, error) {
	cronID, err := id.ParseCronID(ctx.Param("cronId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid cron ID: %v", err))
	}

	j, err := a.eng.TriggerCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusCreated, j)
}
```

- [ ] **Step 13: Plan and start a workflow replay**

Append to `api/workflow_handler.go`:

```go
// planWorkflowReplay says what replaying the run from a step would do,
// without changing anything. A step with no checkpoint, or a run on a
// version no longer registered, answers 409.
func (a *API) planWorkflowReplay(ctx forge.Context, req *PlanWorkflowReplayRequest) (*workflow.ReplayPlan, error) {
	runID, err := id.ParseRunID(ctx.Param("runId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid run ID: %v", err))
	}
	if req.Step == "" {
		return nil, forge.BadRequest("step is required")
	}

	plan, err := a.eng.PlanWorkflowReplay(ctx.Context(), runID, req.Step)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusOK, plan)
}

// replayWorkflow re-runs a finished run from a step and answers 202 with
// the plan once the replay has started; the run goes on in the
// background. A running run answers 409, as do the plan's refusals, and
// a runner that has shut down answers 503.
func (a *API) replayWorkflow(ctx forge.Context, req *ReplayWorkflowRequest) (*workflow.ReplayPlan, error) {
	runID, err := id.ParseRunID(ctx.Param("runId"))
	if err != nil {
		return nil, forge.BadRequest(fmt.Sprintf("invalid run ID: %v", err))
	}
	if req.Step == "" {
		return nil, forge.BadRequest("step is required")
	}

	plan, err := a.eng.ReplayWorkflowFrom(ctx.Context(), runID, req.Step)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusAccepted, plan)
}
```

`workflow.ReplayFrom` keeps the request context's values but not its cancellation, so the background run outlives the request.

- [ ] **Step 14: Stop the single-item reads writing their body twice**

These four handlers call `ctx.JSON` and then return the same value, which forge's router writes again. The list routes have the same pattern but are left alone: they do not register at all (see the note at the end of this task).

In `getJob`. Replace this in `api/job_handler.go`:

```go
	j, err := js.GetJob(ctx.Context(), jobID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return j, ctx.JSON(http.StatusOK, j)
```

with:

```go
	j, err := js.GetJob(ctx.Context(), jobID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusOK, j)
```

In `getDLQ`. Replace this in `api/dlq_handler.go`:

```go
	entry, err := a.eng.DLQService().DLQStore().GetDLQ(ctx.Context(), entryID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return entry, ctx.JSON(http.StatusOK, entry)
```

with:

```go
	entry, err := a.eng.DLQService().DLQStore().GetDLQ(ctx.Context(), entryID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusOK, entry)
```

In `getCron`. Replace this in `api/cron_handler.go`:

```go
	entry, err := cs.GetCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return entry, ctx.JSON(http.StatusOK, entry)
```

with:

```go
	entry, err := cs.GetCron(ctx.Context(), cronID)
	if err != nil {
		return nil, mapStoreError(err)
	}

	return nil, ctx.JSON(http.StatusOK, entry)
```

In `getWorkflowRun`. Replace this in `api/workflow_handler.go`:

```go
	return run, ctx.JSON(http.StatusOK, run)
```

with:

```go
	return nil, ctx.JSON(http.StatusOK, run)
```

- [ ] **Step 15: Register the routes**

Route registration discards its error (`_ = g.POST(...)`), so a handler forge cannot bind fails silently and the route is just missing. The tests in Step 7 call every route through the router, which is what proves each one registered.

In `registerJobRoutes`. Replace this in `api/api.go`:

```go
	_ = g.POST("/jobs/:jobId/cancel", a.cancelJob,
		forge.WithSummary("Cancel job"),
		forge.WithDescription("Cancels a pending or retrying job."),
		forge.WithOperationID("cancelJob"),
		forge.WithRequestSchema(CancelJobRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/jobs/:jobId/retry", a.retryJob,
		forge.WithSummary("Retry job"),
		forge.WithDescription("Retries a failed job by resetting it to pending state."),
		forge.WithOperationID("retryJob"),
		forge.WithRequestSchema(RetryJobRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)
```

with:

```go
	_ = g.POST("/jobs/:jobId/cancel", a.cancelJob,
		forge.WithSummary("Cancel job"),
		forge.WithDescription("Cancels a pending, retrying or running job. A running job's worker stops when it next renews its lease."),
		forge.WithOperationID("cancelJob"),
		forge.WithRequestSchema(CancelJobRequest{}),
		forge.WithNoContentResponse(),
		conflictResponse("The job is completed, failed or already cancelled"),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/jobs/:jobId/retry", a.retryJob,
		forge.WithSummary("Retry job"),
		forge.WithDescription("Retries a failed job by resetting it to pending state. Claims the job's DLQ entry, if it has one, so the entry cannot also be replayed."),
		forge.WithOperationID("retryJob"),
		forge.WithRequestSchema(RetryJobRequest{}),
		forge.WithNoContentResponse(),
		conflictResponse("The job is not failed, or its DLQ entry was already replayed"),
		forge.WithErrorResponses(),
	)
```

The end of `registerWorkflowRoutes`. Replace this in `api/api.go`:

```go
		forge.WithResponseSchema(http.StatusOK, "Workflow run details", &workflow.Run{}),
		forge.WithErrorResponses(),
	)
}
```

with:

```go
		forge.WithResponseSchema(http.StatusOK, "Workflow run details", &workflow.Run{}),
		forge.WithErrorResponses(),
	)

	_ = g.GET("/workflows/runs/:runId/replay", a.planWorkflowReplay,
		forge.WithSummary("Plan workflow replay"),
		forge.WithDescription("Reports what replaying the run from a step would do, without changing anything."),
		forge.WithOperationID("planWorkflowReplay"),
		forge.WithRequestSchema(PlanWorkflowReplayRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Replay plan", &workflow.ReplayPlan{}),
		conflictResponse("The step has no checkpoint, or the run's version is not registered"),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/workflows/runs/:runId/replay", a.replayWorkflow,
		forge.WithSummary("Replay workflow run"),
		forge.WithDescription("Re-runs a finished run from a step on its own version. Answers once the replay has started; the run continues in the background."),
		forge.WithOperationID("replayWorkflowRun"),
		forge.WithRequestSchema(ReplayWorkflowRequest{}),
		forge.WithResponseSchema(http.StatusAccepted, "Replay started", &workflow.ReplayPlan{}),
		conflictResponse("The run is running, the step has no checkpoint, or the run's version is not registered"),
		forge.WithResponseSchema(http.StatusServiceUnavailable, "The workflow runner has shut down", ErrorResponse{}),
		forge.WithErrorResponses(),
	)
}
```

In `registerDLQRoutes`, from the replay route's description down to the end of the purge route. Replace this in `api/api.go`:

```go
		forge.WithDescription("Re-enqueues a DLQ entry as a new pending job."),
		forge.WithOperationID("dispatchReplayDLQ"),
		forge.WithRequestSchema(ReplayDLQRequest{}),
		forge.WithCreatedResponse(&job.Job{}),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/dlq/replay-all", a.replayAllDLQ,
		forge.WithSummary("Replay all DLQ entries"),
		forge.WithDescription("Re-enqueues all unreplayed DLQ entries as new pending jobs."),
		forge.WithOperationID("replayAllDLQ"),
		forge.WithResponseSchema(http.StatusOK, "Replay result", ReplayAllDLQResponse{}),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/dlq/purge", a.purgeDLQ,
		forge.WithSummary("Purge DLQ"),
		forge.WithDescription("Removes old DLQ entries."),
		forge.WithOperationID("purgeDLQ"),
		forge.WithResponseSchema(http.StatusOK, "Purge result", PurgeDLQResponse{}),
		forge.WithErrorResponses(),
	)
```

with:

```go
		forge.WithDescription("Re-enqueues a DLQ entry as a new pending job. An entry is replayed at most once."),
		forge.WithOperationID("dispatchReplayDLQ"),
		forge.WithRequestSchema(ReplayDLQRequest{}),
		forge.WithCreatedResponse(&job.Job{}),
		conflictResponse("The entry was already replayed, or no worker can run the job"),
		forge.WithErrorResponses(),
	)

	_ = g.DELETE("/dlq/:entryId", a.deleteDLQ,
		forge.WithSummary("Delete DLQ entry"),
		forge.WithDescription("Permanently removes one DLQ entry."),
		forge.WithOperationID("deleteDLQ"),
		forge.WithRequestSchema(DeleteDLQRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/dlq/replay-all", a.replayAllDLQ,
		forge.WithSummary("Replay all DLQ entries"),
		forge.WithDescription("Re-enqueues unreplayed DLQ entries as new pending jobs, newest first, optionally in one queue and up to a limit."),
		forge.WithOperationID("replayAllDLQ"),
		forge.WithRequestSchema(ReplayAllDLQRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Replay result", ReplayAllDLQResponse{}),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/dlq/purge", a.purgeDLQ,
		forge.WithSummary("Purge DLQ"),
		forge.WithDescription("Removes DLQ entries that failed before a cutoff: before, older_than, or 30 days ago when neither is given. dry_run counts them instead."),
		forge.WithOperationID("purgeDLQ"),
		forge.WithRequestSchema(PurgeDLQRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Purge result", PurgeDLQResponse{}),
		forge.WithErrorResponses(),
	)
```

In `registerCronRoutes`, the enable route. Replace this in `api/api.go`:

```go
		forge.WithDescription("Enables a disabled cron entry."),
		forge.WithOperationID("enableCron"),
		forge.WithRequestSchema(EnableCronRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Enabled cron entry", &cron.Entry{}),
		forge.WithErrorResponses(),
```

with:

```go
		forge.WithDescription("Enables a cron entry. Its next run is computed from now, so it does not fire a catch-up."),
		forge.WithOperationID("enableCron"),
		forge.WithRequestSchema(EnableCronRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Enabled cron entry", &cron.Entry{}),
		conflictResponse("The schedule never fires"),
		forge.WithErrorResponses(),
```

The end of `registerCronRoutes`. Replace this in `api/api.go`:

```go
		forge.WithRequestSchema(DeleteCronRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)
}
```

with:

```go
		forge.WithRequestSchema(DeleteCronRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)

	_ = g.POST("/crons/:cronId/trigger", a.triggerCron,
		forge.WithSummary("Trigger cron entry"),
		forge.WithDescription("Enqueues the entry's job now. The schedule is left alone, and a disabled entry can be triggered too."),
		forge.WithOperationID("triggerCron"),
		forge.WithRequestSchema(TriggerCronRequest{}),
		forge.WithCreatedResponse(&job.Job{}),
		conflictResponse("No worker can run the job"),
		forge.WithErrorResponses(),
	)
}

// conflictResponse documents the 409 an operator route answers when the
// current state refuses the action. WithErrorResponses does not list 409.
func conflictResponse(description string) forge.RouteOption {
	return forge.WithResponseSchema(http.StatusConflict, description, ErrorResponse{})
}
```

- [ ] **Step 16: Run the tests and see them pass**

Run: `gofmt -l api; go test -count=1 -v ./api/ 2>&1 | grep -E '^(--- |ok)'`
Expected: no file from `gofmt`, then

```
--- PASS: TestCronEnableDisable (0.00s)
--- PASS: TestCronEnable_ScheduleThatNeverFires (0.00s)
--- PASS: TestCronDelete (0.00s)
--- PASS: TestCronTrigger (0.00s)
--- PASS: TestCronOps_UnknownAndMalformed (0.00s)
--- PASS: TestReplayDLQ (0.00s)
--- PASS: TestReplayDLQ_Unschedulable (0.00s)
--- PASS: TestReplayAllDLQ (0.00s)
--- PASS: TestReplayAllDLQ_LimitAndFailures (0.00s)
--- PASS: TestPurgeDLQ_DefaultsToThirtyDays (0.00s)
--- PASS: TestPurgeDLQ_Cutoffs (0.00s)
--- PASS: TestPurgeDLQ_BadCutoffs (0.00s)
--- PASS: TestDeleteDLQ (0.00s)
--- PASS: TestGetRoutesWriteOneBody (0.00s)
--- PASS: TestCancelJob (0.00s)
--- PASS: TestCancelJob_UnknownAndMalformed (0.00s)
--- PASS: TestRetryJob (0.00s)
--- PASS: TestRetryJob_Refusals (0.00s)
--- PASS: TestWorkflowReplayPlan (0.00s)
--- PASS: TestWorkflowReplay (0.01s)
--- PASS: TestWorkflowReplay_RunningRunIsRefused (0.01s)
--- PASS: TestWorkflowReplay_AfterStop (0.00s)
ok  	github.com/xraph/dispatch/api
```

Then `go test -race -count=10 ./api/` should print `ok`.

- [ ] **Step 17: Update the endpoint docs**

Only the routes this task changes. `dlq/doc.go` still says purge removes "all entries"; its package comment is not part of this task.

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

````mdx
### Cancel job

Cancels a job in `pending` or `retrying` state.

```http
POST /v1/jobs/{jobId}/cancel
```

**Response `204 No Content`**

**Response `400 Bad Request`:** If the job is not in a cancellable state.
````

with:

````mdx
### Cancel job

Cancels a job in `pending`, `retrying` or `running` state. A running job is marked cancelled at once, and its worker stops the handler when it next renews the job's lease.

```http
POST /v1/jobs/{jobId}/cancel
```

**Response `204 No Content`**

**Response `409 Conflict`:** The job is `completed`, `failed` or already `cancelled`.

### Retry job

Puts a `failed` job back to `pending` with its retry count and error cleared. If the job has a DLQ entry, the retry claims it, so the entry cannot also be replayed into a second copy of the job.

```http
POST /v1/jobs/{jobId}/retry
```

**Response `204 No Content`**

**Response `409 Conflict`:** The job is not `failed`, or its DLQ entry was already replayed.
````

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

```mdx
**Response `404 Not Found`:** `{"error": "run not found"}`

---

## Dead Letter Queue
```

with:

````mdx
**Response `404 Not Found`:** `{"error": "run not found"}`

### Plan a replay

Reports what replaying the run from `step` would do, without changing anything. `reruns` lists the checkpointed steps after `step` that would run again.

```http
GET /v1/workflows/runs/{runId}/replay?step=charge-card
```

**Response `200 OK`:**
```json
{
  "run_id": "run_01h455vb4pex5vsknk084sn02q",
  "from_step": "charge-card",
  "version": 2,
  "reruns": ["send-receipt"],
  "state": "failed"
}
```

**Response `409 Conflict`:** The step has no checkpoint, or the run's version is no longer registered.

### Replay a run from a step

Re-runs a finished run from `step` on the version it started on. The checkpoints up to and including `step` are kept, so those steps are skipped. The response comes back once the replay has started; the run continues in the background.

```http
POST /v1/workflows/runs/{runId}/replay
Content-Type: application/json

{"step": "charge-card"}
```

**Response `202 Accepted`:** The replay plan, as above.

**Response `409 Conflict`:** The run is `running`, the step has no checkpoint, or the run's version is no longer registered.

**Response `503 Service Unavailable`:** The engine is shutting down.

---

## Dead Letter Queue
````

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

````mdx
Re-enqueues the entry as a new `pending` job in its original queue.

```http
POST /v1/dlq/{entryId}/replay
```

**Response `201 Created`:** The newly created `job.Job` object.

### Purge DLQ

Removes DLQ entries older than a threshold.

```http
POST /v1/dlq/purge
```

**Response `200 OK`:**
```json
{
  "purged": 42
}
```
````

with:

````mdx
Re-enqueues the entry as a new `pending` job in its original queue. An entry is replayed at most once.

```http
POST /v1/dlq/{entryId}/replay
```

**Response `201 Created`:** The newly created `job.Job` object.

**Response `409 Conflict`:** The entry was already replayed (or its job retried), or no worker is big enough to run the job.

### Delete DLQ entry

Permanently removes one entry.

```http
DELETE /v1/dlq/{entryId}
```

**Response `204 No Content`**

### Replay all DLQ entries

Replays every entry not yet replayed, newest first. Entries are claimed one at a time, so this is not a transaction: an entry somebody else replays meanwhile counts as a conflict.

```http
POST /v1/dlq/replay-all?queue=default&limit=100
```

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `queue` | string | Only entries from this queue (default: every queue) |
| `limit` | int | Most entries to try, up to 1000 (default: 1000) |

**Response `200 OK`:**
```json
{
  "replayed": 40,
  "conflicts": 1,
  "errors": 2,
  "error_messages": ["dlq_01h455vb4pex5vsknk084sn02q: dispatch/resource: no worker can satisfy the requirement"]
}
```

`errors` counts the entries that failed for any reason other than a conflict. Each of those can be replayed again. `error_messages` holds the first 20.

### Purge DLQ

Removes DLQ entries that failed before a cutoff. Give `before` or `older_than`, not both; with neither, the cutoff is 30 days ago.

```http
POST /v1/dlq/purge?older_than=168h&dry_run=true
```

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `before` | string | RFC 3339 time, e.g. `2026-10-01T00:00:00Z` |
| `older_than` | string | Positive Go duration, e.g. `72h` |
| `dry_run` | bool | Count the matching entries without deleting them |

**Response `200 OK`:**
```json
{
  "purged": 0,
  "matched": 42,
  "dry_run": true,
  "before": "2026-09-30T12:00:00Z"
}
```

`matched` is how many entries failed before the cutoff; `purged` is how many were deleted, always `0` on a dry run.
````

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

````mdx
### Enable cron entry

```http
POST /v1/crons/{cronId}/enable
```

**Response `200 OK`:** Updated cron entry with `enabled: true`.
````

with:

````mdx
### Enable cron entry

The next run is computed from now, so an entry that was off past its old next run does not fire a catch-up.

```http
POST /v1/crons/{cronId}/enable
```

**Response `200 OK`:** Updated cron entry with `enabled: true`.

**Response `409 Conflict`:** The schedule never fires (for example `0 0 30 2 *`).
````

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

````mdx
```http
DELETE /v1/crons/{cronId}
```

**Response `204 No Content`**
````

with:

````mdx
```http
DELETE /v1/crons/{cronId}
```

**Response `204 No Content`**

### Trigger cron entry

Enqueues the entry's job now, with its payload and queue. The schedule is left alone, and a disabled entry can be triggered too.

```http
POST /v1/crons/{cronId}/trigger
```

**Response `201 Created`:** The enqueued `job.Job` object.
````

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

```mdx
| Resource not found | `404` |
| Invalid input | `400` |
| Internal error | `500` |
```

with:

```mdx
| Resource not found | `404` |
| Invalid input | `400` |
| Refused in the current state | `409` |
| Engine shutting down | `503` |
| Internal error | `500` |
```

Replace this in `docs/content/docs/subsystems/admin-api.mdx`:

```mdx
| `POST` | `/v1/jobs/:jobId/cancel` | Cancel a pending job |
```

with:

```mdx
| `POST` | `/v1/jobs/:jobId/cancel` | Cancel a pending, retrying or running job |
| `POST` | `/v1/jobs/:jobId/retry` | Retry a failed job |
```

Replace this in `docs/content/docs/subsystems/admin-api.mdx`:

```mdx
| `GET` | `/v1/workflows/runs/:runId` | Get a workflow run |
```

with:

```mdx
| `GET` | `/v1/workflows/runs/:runId` | Get a workflow run |
| `GET` | `/v1/workflows/runs/:runId/replay?step=` | Plan a replay from a step |
| `POST` | `/v1/workflows/runs/:runId/replay` | Replay a run from a step |
```

Replace this in `docs/content/docs/subsystems/admin-api.mdx`:

```mdx
| `DELETE` | `/v1/crons/:cronId` | Delete a cron entry |
```

with:

```mdx
| `DELETE` | `/v1/crons/:cronId` | Delete a cron entry |
| `POST` | `/v1/crons/:cronId/trigger` | Enqueue the entry's job now |
```

Replace this in `docs/content/docs/subsystems/admin-api.mdx`:

```mdx
| `POST` | `/v1/dlq/:entryId/replay` | Replay a single entry |
| `POST` | `/v1/dlq/purge` | Purge all DLQ entries |
```

with:

```mdx
| `POST` | `/v1/dlq/:entryId/replay` | Replay a single entry |
| `DELETE` | `/v1/dlq/:entryId` | Delete a single entry |
| `POST` | `/v1/dlq/replay-all` | Replay every unreplayed entry |
| `POST` | `/v1/dlq/purge` | Purge entries older than a cutoff |
```

Replace this in `docs/content/docs/subsystems/dlq.mdx`:

````mdx
## Purge

Remove all DLQ entries:

```bash
POST /v1/dlq/purge
```
````

with:

````mdx
## Purge

Remove the entries that failed before a cutoff, 30 days ago unless you give `before` (RFC 3339) or `older_than` (a Go duration). Add `dry_run=true` to count them first:

```bash
POST /v1/dlq/purge
POST /v1/dlq/purge?older_than=168h&dry_run=true
```
````

Replace this in `docs/content/docs/subsystems/endpoints.mdx`:

```mdx
| `DELETE` | `/v1/crons/:cronId` | Delete |
```

with:

```mdx
| `DELETE` | `/v1/crons/:cronId` | Delete |
| `POST` | `/v1/crons/:cronId/trigger` | Enqueue the job now |
```

- [ ] **Step 18: Gate**

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./api/... ./engine/...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: build succeeds, no FAIL lines, both race runs `ok`, `0 issues.` from the first lint. The integration-tag lint reports only the known shadow at `store/redis/store_test.go:54`, which is not this task's.

- [ ] **Step 19: Commit**

```bash
git add api/helpers_test.go api/job_handler_test.go api/dlq_handler_test.go api/cron_handler_test.go api/workflow_handler_test.go api/get_routes_test.go
git commit --only -m "feat(api): route operator actions through the engine

Cancel, retry, DLQ replay, replay-all, purge, and cron enable, disable
and delete now call the engine's operator methods. REST and the
dashboard get one set of rules that way, and every action reaches the
operator hooks. A running job can be cancelled now. A refusal that comes
from the state of things answers 409 instead of 400 or 500, and a
workflow runner that has shut down answers 503.

There are new routes too: DELETE /v1/dlq/:entryId, POST
/v1/crons/:cronId/trigger, and GET and POST
/v1/workflows/runs/:runId/replay. Purge takes before or older_than and a
dry_run flag, and still reaches back 30 days when it gets neither.
Replay-all takes queue and limit, and reports conflicts and the error
messages next to the counts it always had.

Handlers that wrote their own JSON also returned the value, so the router
wrote the body twice. The routes touched here and the four single-item
reads return nil now. The package had no tests; it has handler tests
through the forge router on the memory store." -- api/api.go api/requests.go api/job_handler.go api/dlq_handler.go api/cron_handler.go api/workflow_handler.go api/helpers_test.go api/job_handler_test.go api/dlq_handler_test.go api/cron_handler_test.go api/workflow_handler_test.go api/get_routes_test.go docs/content/docs/api-reference/http-api.mdx docs/content/docs/subsystems/admin-api.mdx docs/content/docs/subsystems/dlq.mdx docs/content/docs/subsystems/endpoints.mdx
git show --stat HEAD | tail -18
```

Expected: `16 files changed, 1240 insertions(+), 132 deletions(-)`.

Note for a later task: the four list routes (`GET /v1/jobs`, `/v1/dlq`, `/v1/crons`, `/v1/workflows/runs`) have never registered on forge v1.12.0. Their handlers return a bare slice (`([]*job.Job, error)`), forge's opinionated-handler detection refuses that signature (`unsupported handler signature`), and `_ = g.GET(...)` throws the error away, so each answers `404 page not found`. Their request types also leave every query field required (non-pointer, no `optional:"true"`). Slice 3's contract does not use them, so they are out of scope here, but whoever touches them should return a pointer type and mark the filters optional.

---

### Task 12: Make the REST list routes register, and fail loudly when a route cannot

`GET /v1/jobs`, `GET /v1/dlq`, `GET /v1/crons` and `GET /v1/workflows/runs` answer `404 page not found`. Their handlers return a bare slice (`([]*job.Job, error)`), forge's opinionated-handler detection only accepts a pointer response (`func(forge.Context, *Req) (*Resp, error)`), so registration fails with `unsupported handler signature`, and `_ = g.GET(...)` in `api/api.go` throws that error away. Even with the signature fixed, every query field is a non-pointer with no `optional:"true"`, so a request without `?limit=&offset=` would be a 400.

The title says the upgrade dropped them. It did not, and the plan should not repeat that: the check is the same in forge v1.8.0 through v1.12.0 (`internal/router/handler.go`, "Pattern 3"), and a probe on `af37581^` (forge v1.10.0) answered 404 on all four. They have never registered since the handlers were written in 37604f6. What the slice does change is that slice 3 and the docs promise these routes, so they get fixed here, and the registration error stops being discarded so the next refused route stops startup instead of hiding.

The fix uses forge's supported way to answer a list: the handler returns a struct with one field tagged `body:""`, and the router writes that field as the whole body (forge `internal/shared/response.go`, `ProcessResponse`; example in forge's `examples/response_with_body_tag`). The body stays a bare JSON array, the shape the handlers always wrote with `ctx.JSON` and the shape `http-api.mdx` documents. A nil slice becomes `[]`, never `null`. `GET /v1/jobs` with no `state` now lists every state: the store only lists one state at a time (`ListJobsByState` with an empty state matches nothing), so the handler merges the six. An unknown state is a 400; before, it silently meant "no jobs".

`RegisterRoutes` now returns an error that names each refused route by method and path (`errors.Join`). The extension's `Register` already returns an error, so it fails on it. `API.Handler()` has no error to return, so it panics with forge's reason, and it now registers only once (a second call used to re-register every route, which forge v1.12.0's router refuses as a collision).

**Files:**
- Modify: `api/requests.go` (imports at line 4; `ListJobsRequest`, `ListWorkflowRunsRequest`, `ListDLQRequest`, `ListCronsRequest`; a `nonNil` helper before `defaultLimit`)
- Modify: `api/job_handler.go` (imports at lines 4 to 16; `listJobs` at lines 18 to 36)
- Modify: `api/dlq_handler.go` (`listDLQ` at lines 17 to 28)
- Modify: `api/cron_handler.go` (`listCrons` at lines 15 to 39)
- Modify: `api/workflow_handler.go` (`listWorkflowRuns` signature and return)
- Modify: `api/api.go` (whole file: registration keeps forge's errors)
- Modify: `extension/extension.go` (route registration in `init`; `(*Extension).RegisterRoutes`)
- Modify: `docs/content/docs/api-reference/http-api.mdx`, `docs/content/docs/api-reference/go-packages.mdx`
- Create: `api/list_routes_test.go`, `api/register_test.go`, `extension/routes_test.go`

**Interfaces:**
- Consumes: Task 11's api test helpers in `api/helpers_test.go` (`newFixture`, `fixture.do`, `wantStatus`, `decode`, `jobInState`, `failedWithEntry`), `addCron` in `api/cron_handler_test.go`, and `newReplayFixture`, `failedRun`, `waitState` in `api/workflow_handler_test.go`. The store methods the handlers already call: `job.Store.ListJobsByState`, `dlq.Store.ListDLQ`, `cron.Store.ListCrons`, `workflow.Store.ListRuns`.
- Produces:

```go
package api
func (a *API) RegisterRoutes(router forge.Router) error // was: no result
func (a *API) Handler() http.Handler                    // registers once; panics with "dispatch api: ..." if forge refuses a route
type ListJobsResponse struct { Jobs []*job.Job `body:""` }
type ListWorkflowRunsResponse struct { Runs []*workflow.Run `body:""` }
type ListDLQResponse struct { Entries []*dlq.Entry `body:""` }
type ListCronsResponse struct { Entries []*cron.Entry `body:""` }

package extension
func (e *Extension) RegisterRoutes(router forge.Router) error // was: no result
```

| Route | Query (all optional) | 200 body | Refusals |
|---|---|---|---|
| `GET /v1/jobs` | `state` (default every state), `queue`, `limit` (default 50, max 1000), `offset` | bare array of `job.Job`, oldest first | 400 unknown state |
| `GET /v1/workflows/runs` | `state` (default every state), `limit`, `offset` | bare array of `workflow.Run`, oldest first | none new |
| `GET /v1/dlq` | `queue`, `limit`, `offset` | bare array of `dlq.Entry`, oldest failure first | none new |
| `GET /v1/crons` | `limit`, `offset` | bare array of `cron.Entry`, oldest first | none new |

An error from `RegisterRoutes` reads like `GET /v1/jobs: forgemux: route GET "/v1/jobs" conflicts with ...`, one line per refused route. The Go signature change is source-breaking only for a caller that used `RegisterRoutes` as a statement and runs errcheck; it still compiles.

- [ ] **Step 1: Check the base**

Run: `git status --porcelain api extension docs/content/docs/api-reference && git log --oneline -1 && grep -n '_ = g.GET("/jobs", a.listJobs' api/api.go && ls api/helpers_test.go api/workflow_handler_test.go`
Expected: no lines from `git status`, Task 11's commit (`feat(api): route operator actions through the engine`) on top, the `_ = g.GET("/jobs"` line found, and both test files listed. If Task 11 is missing, stop: this task builds on its test helpers.

- [ ] **Step 2: Write the failing list route tests**

Create `api/list_routes_test.go`. Each route is called with no query string first, then with each filter. `listBody` insists on a JSON array, so `null` for an empty page fails, and `decode` reads the whole body, so a body written twice fails too. The two millisecond sleeps keep creation times strictly ordered, since every list answers oldest first.

```go
package api_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/workflow"
)

// listBody checks a list route answered 200 with a JSON array, an empty
// list included (never null), and decodes it.
func listBody[T any](t *testing.T, rec *httptest.ResponseRecorder) []T {
	t.Helper()

	wantStatus(t, rec, http.StatusOK)
	if b := bytes.TrimSpace(rec.Body.Bytes()); len(b) == 0 || b[0] != '[' {
		t.Fatalf("body is not a JSON array: %s", rec.Body.String())
	}

	return decode[[]T](t, rec)
}

// idsOf lists the IDs of items, in order, as strings.
func idsOf[T any](items []T, idOf func(T) string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, idOf(item))
	}

	return out
}

// apart keeps creation times strictly ordered between fixtures; the list
// routes answer oldest first.
func apart() { time.Sleep(2 * time.Millisecond) }

func TestListJobs(t *testing.T) {
	f := newFixture(t)
	pending := jobInState(t, f, job.StatePending)
	apart()
	failed := jobInState(t, f, job.StateFailed, job.WithQueue("mail"))
	apart()
	done := jobInState(t, f, job.StateCompleted)

	jobID := func(j job.Job) string { return j.ID.String() }
	cases := []struct {
		query string
		want  []*job.Job
	}{
		{"", []*job.Job{pending, failed, done}},
		{"?state=failed", []*job.Job{failed}},
		{"?queue=mail", []*job.Job{failed}},
		{"?state=completed&queue=default", []*job.Job{done}},
		{"?state=pending&queue=mail", nil},
		{"?limit=1", []*job.Job{pending}},
		{"?limit=1&offset=1", []*job.Job{failed}},
		{"?offset=1", []*job.Job{failed, done}},
		{"?offset=9", nil},
	}
	for _, tc := range cases {
		t.Run("query "+tc.query, func(t *testing.T) {
			got := listBody[job.Job](t, f.do(t, http.MethodGet, "/v1/jobs"+tc.query, ""))
			want := idsOf(tc.want, func(j *job.Job) string { return j.ID.String() })
			if ids := idsOf(got, jobID); !slices.Equal(ids, want) {
				t.Errorf("jobs = %v, want %v", ids, want)
			}
		})
	}

	wantStatus(t, f.do(t, http.MethodGet, "/v1/jobs?state=lost", ""), http.StatusBadRequest)
}

func TestListDLQ(t *testing.T) {
	f := newFixture(t)
	_, first := failedWithEntry(t, f)
	apart()
	_, mail := failedWithEntry(t, f, job.WithQueue("mail"))
	apart()
	_, last := failedWithEntry(t, f)

	entryID := func(e dlq.Entry) string { return e.ID.String() }
	cases := []struct {
		query string
		want  []*dlq.Entry
	}{
		{"", []*dlq.Entry{first, mail, last}},
		{"?queue=mail", []*dlq.Entry{mail}},
		{"?queue=none", nil},
		{"?limit=2", []*dlq.Entry{first, mail}},
		{"?limit=1&offset=2", []*dlq.Entry{last}},
		{"?offset=9", nil},
	}
	for _, tc := range cases {
		t.Run("query "+tc.query, func(t *testing.T) {
			got := listBody[dlq.Entry](t, f.do(t, http.MethodGet, "/v1/dlq"+tc.query, ""))
			want := idsOf(tc.want, func(e *dlq.Entry) string { return e.ID.String() })
			if ids := idsOf(got, entryID); !slices.Equal(ids, want) {
				t.Errorf("entries = %v, want %v", ids, want)
			}
		})
	}
}

func TestListCrons(t *testing.T) {
	f := newFixture(t)
	a := addCron(t, f, "0 3 * * *", true)
	apart()
	b := addCron(t, f, "0 4 * * *", false)
	apart()
	c := addCron(t, f, "0 5 * * *", true)

	cronID := func(e cron.Entry) string { return e.ID.String() }
	cases := []struct {
		query string
		want  []*cron.Entry
	}{
		{"", []*cron.Entry{a, b, c}},
		{"?limit=2", []*cron.Entry{a, b}},
		{"?limit=2&offset=2", []*cron.Entry{c}},
		{"?offset=9", nil},
	}
	for _, tc := range cases {
		t.Run("query "+tc.query, func(t *testing.T) {
			got := listBody[cron.Entry](t, f.do(t, http.MethodGet, "/v1/crons"+tc.query, ""))
			want := idsOf(tc.want, func(e *cron.Entry) string { return e.ID.String() })
			if ids := idsOf(got, cronID); !slices.Equal(ids, want) {
				t.Errorf("crons = %v, want %v", ids, want)
			}
		})
	}
}

func TestListWorkflowRuns(t *testing.T) {
	rf := newReplayFixture(t)
	failed := rf.failedRun(t)
	apart()
	completed, err := engine.StartWorkflow(context.Background(), rf.eng, "api-replay", struct{}{})
	if err != nil {
		t.Fatalf("StartWorkflow: %v", err)
	}
	rf.waitState(t, completed.ID, workflow.RunStateCompleted)

	runID := func(r workflow.Run) string { return r.ID.String() }
	cases := []struct {
		query string
		want  []*workflow.Run
	}{
		{"", []*workflow.Run{failed, completed}},
		{"?state=failed", []*workflow.Run{failed}},
		{"?state=completed", []*workflow.Run{completed}},
		{"?state=running", nil},
		{"?limit=1", []*workflow.Run{failed}},
		{"?limit=1&offset=1", []*workflow.Run{completed}},
		{"?offset=9", nil},
	}
	for _, tc := range cases {
		t.Run("query "+tc.query, func(t *testing.T) {
			got := listBody[workflow.Run](t, rf.do(t, http.MethodGet, "/v1/workflows/runs"+tc.query, ""))
			want := idsOf(tc.want, func(r *workflow.Run) string { return r.ID.String() })
			if ids := idsOf(got, runID); !slices.Equal(ids, want) {
				t.Errorf("runs = %v, want %v", ids, want)
			}
		})
	}
}
```

- [ ] **Step 3: Run them and see them fail**

Run: `go test -count=1 -run 'TestList' ./api/ 2>&1 | grep -E '^(--- FAIL|FAIL)'`
Expected (checked on 2026-10-07):

```
--- FAIL: TestListJobs (0.01s)
--- FAIL: TestListDLQ (0.01s)
--- FAIL: TestListCrons (0.01s)
--- FAIL: TestListWorkflowRuns (0.01s)
FAIL
```

Every subtest in the full output reads `status = 404, want 200; body 404 page not found`, and the unknown-state check reads `status = 404, want 400`.

- [ ] **Step 4: Add the list response types and make the query fields optional**

Each response type has one field tagged `body:""`. Forge's router writes that field, not the struct, as the body, so the JSON stays a bare array. The `optional:"true"` tags matter: without them forge's binder answers `400 invalid request: limit: query parameter is required; offset: query parameter is required` to a request with no query string (checked by removing them from `ListCronsRequest`).

The import block. Replace this in `api/requests.go`:

```go
import (
	"time"

	"github.com/xraph/dispatch/job"
)
```

with:

```go
import (
	"time"

	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/workflow"
)
```

Replace this in `api/requests.go`:

```go
// ListJobsRequest is the request for listing jobs by state.
type ListJobsRequest struct {
	State  string `query:"state" description:"Filter by job state (pending, running, completed, failed, retrying, cancelled)"`
	Queue  string `query:"queue" description:"Filter by queue name"`
	Limit  int    `query:"limit" description:"Maximum number of results (default: 50)"`
	Offset int    `query:"offset" description:"Number of results to skip"`
}
```

with:

```go
// ListJobsRequest is the request for listing jobs. Every field is an
// optional query parameter.
type ListJobsRequest struct {
	State  string `query:"state" optional:"true" description:"Filter by job state (pending, running, completed, failed, retrying, cancelled; default: every state)"`
	Queue  string `query:"queue" optional:"true" description:"Filter by queue name"`
	Limit  int    `query:"limit" optional:"true" description:"Maximum number of results (default: 50, max: 1000)"`
	Offset int    `query:"offset" optional:"true" description:"Number of results to skip"`
}

// ListJobsResponse is a page of jobs, oldest first. The body:"" tag has
// the router write Jobs as the whole body, a bare JSON array.
type ListJobsResponse struct {
	Jobs []*job.Job `body:""`
}
```

Replace this in `api/requests.go`:

```go
// ListWorkflowRunsRequest is the request for listing workflow runs.
type ListWorkflowRunsRequest struct {
	State  string `query:"state" description:"Filter by run state (running, completed, failed)"`
	Limit  int    `query:"limit" description:"Maximum number of results (default: 50)"`
	Offset int    `query:"offset" description:"Number of results to skip"`
}
```

with:

```go
// ListWorkflowRunsRequest is the request for listing workflow runs. Every
// field is an optional query parameter.
type ListWorkflowRunsRequest struct {
	State  string `query:"state" optional:"true" description:"Filter by run state (running, completed, failed; default: every state)"`
	Limit  int    `query:"limit" optional:"true" description:"Maximum number of results (default: 50, max: 1000)"`
	Offset int    `query:"offset" optional:"true" description:"Number of results to skip"`
}

// ListWorkflowRunsResponse is a page of runs, oldest first, written as a
// bare JSON array.
type ListWorkflowRunsResponse struct {
	Runs []*workflow.Run `body:""`
}
```

Replace this in `api/requests.go`:

```go
// ListDLQRequest is the request for listing DLQ entries.
type ListDLQRequest struct {
	Queue  string `query:"queue" description:"Filter by queue name"`
	Limit  int    `query:"limit" description:"Maximum number of results (default: 50)"`
	Offset int    `query:"offset" description:"Number of results to skip"`
}
```

with:

```go
// ListDLQRequest is the request for listing DLQ entries. Every field is
// an optional query parameter.
type ListDLQRequest struct {
	Queue  string `query:"queue" optional:"true" description:"Filter by queue name"`
	Limit  int    `query:"limit" optional:"true" description:"Maximum number of results (default: 50, max: 1000)"`
	Offset int    `query:"offset" optional:"true" description:"Number of results to skip"`
}

// ListDLQResponse is a page of DLQ entries, oldest failure first, written
// as a bare JSON array.
type ListDLQResponse struct {
	Entries []*dlq.Entry `body:""`
}
```

Replace this in `api/requests.go`:

```go
// ListCronsRequest is the request for listing cron entries.
type ListCronsRequest struct {
	Limit  int `query:"limit" description:"Maximum number of results (default: 50)"`
	Offset int `query:"offset" description:"Number of results to skip"`
}
```

with:

```go
// ListCronsRequest is the request for listing cron entries. Both fields
// are optional query parameters.
type ListCronsRequest struct {
	Limit  int `query:"limit" optional:"true" description:"Maximum number of results (default: 50, max: 1000)"`
	Offset int `query:"offset" optional:"true" description:"Number of results to skip"`
}

// ListCronsResponse is a page of cron entries, oldest first, written as a
// bare JSON array.
type ListCronsResponse struct {
	Entries []*cron.Entry `body:""`
}
```

Just above `defaultLimit`, at the end of the file. Replace this in `api/requests.go`:

```go
func defaultLimit(limit int) int {
```

with:

```go
// nonNil returns s, or an empty slice when s is nil, so a list route
// answers [] rather than null.
func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func defaultLimit(limit int) int {
```

- [ ] **Step 5: Return the response types from the four handlers**

`listJobs` gains the every-state merge. The memory store and the SQL stores all list one state at a time, oldest first by `created_at`, so the merge takes the first `offset+limit` of each state, sorts by `created_at` then ID, and cuts the page. With one state it is the same single store call as before. A negative offset is treated as zero (the old `listCrons` would have panicked slicing `entries[-1:]`).

The top of the import block. Replace this in `api/job_handler.go`:

```go
import (
	"errors"
	"fmt"
	"net/http"
```

with:

```go
import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
```

Replace this in `api/job_handler.go`:

```go
func (a *API) listJobs(ctx forge.Context, req *ListJobsRequest) ([]*job.Job, error) {
	state := jobStateFromString(req.State)

	js, ok := a.eng.Dispatcher().Store().(job.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement job.Store")
	}

	jobs, err := js.ListJobsByState(ctx.Context(), state, job.ListOpts{
		Limit:  defaultLimit(req.Limit),
		Offset: req.Offset,
		Queue:  req.Queue,
	})
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}

	return jobs, ctx.JSON(http.StatusOK, jobs)
}
```

with:

```go
// allJobStates is every job state, for a list with no state filter.
var allJobStates = []job.State{
	job.StatePending,
	job.StateRunning,
	job.StateCompleted,
	job.StateFailed,
	job.StateRetrying,
	job.StateCancelled,
}

// listJobs answers a page of jobs, oldest first, as a bare JSON array. With
// no state it lists every state; an unknown state is a 400.
func (a *API) listJobs(ctx forge.Context, req *ListJobsRequest) (*ListJobsResponse, error) {
	states := allJobStates
	if req.State != "" {
		state := jobStateFromString(req.State)
		if state == "" {
			return nil, forge.BadRequest(fmt.Sprintf("unknown job state %q", req.State))
		}
		states = []job.State{state}
	}

	js, ok := a.eng.Dispatcher().Store().(job.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement job.Store")
	}

	jobs, err := listJobsInStates(ctx.Context(), js, states, req.Queue, defaultLimit(req.Limit), max(req.Offset, 0))
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}

	return &ListJobsResponse{Jobs: nonNil(jobs)}, nil
}

// listJobsInStates pages through the jobs in states, oldest first. The
// store lists one state at a time, so for several it takes the first
// offset+limit of each, merges them in the store's order (created_at, then
// ID), and cuts the page from the merge.
func listJobsInStates(ctx context.Context, js job.Store, states []job.State, queue string, limit, offset int) ([]*job.Job, error) {
	if len(states) == 1 {
		return js.ListJobsByState(ctx, states[0], job.ListOpts{Limit: limit, Offset: offset, Queue: queue})
	}

	var merged []*job.Job
	for _, state := range states {
		part, err := js.ListJobsByState(ctx, state, job.ListOpts{Limit: offset + limit, Queue: queue})
		if err != nil {
			return nil, err
		}
		merged = append(merged, part...)
	}

	sort.Slice(merged, func(i, k int) bool {
		if !merged[i].CreatedAt.Equal(merged[k].CreatedAt) {
			return merged[i].CreatedAt.Before(merged[k].CreatedAt)
		}
		return merged[i].ID.String() < merged[k].ID.String()
	})

	if offset >= len(merged) {
		return nil, nil
	}
	merged = merged[offset:]
	if len(merged) > limit {
		merged = merged[:limit]
	}

	return merged, nil
}
```

Replace this in `api/dlq_handler.go`:

```go
func (a *API) listDLQ(ctx forge.Context, req *ListDLQRequest) ([]*dlq.Entry, error) {
	entries, err := a.eng.DLQService().DLQStore().ListDLQ(ctx.Context(), dlq.ListOpts{
		Limit:  defaultLimit(req.Limit),
		Offset: req.Offset,
		Queue:  req.Queue,
	})
	if err != nil {
		return nil, fmt.Errorf("list dlq: %w", err)
	}

	return entries, ctx.JSON(http.StatusOK, entries)
}
```

with:

```go
// listDLQ answers a page of entries, oldest failure first, as a bare JSON
// array.
func (a *API) listDLQ(ctx forge.Context, req *ListDLQRequest) (*ListDLQResponse, error) {
	entries, err := a.eng.DLQService().DLQStore().ListDLQ(ctx.Context(), dlq.ListOpts{
		Limit:  defaultLimit(req.Limit),
		Offset: req.Offset,
		Queue:  req.Queue,
	})
	if err != nil {
		return nil, fmt.Errorf("list dlq: %w", err)
	}

	return &ListDLQResponse{Entries: nonNil(entries)}, nil
}
```

Replace this in `api/cron_handler.go`:

```go
func (a *API) listCrons(ctx forge.Context, req *ListCronsRequest) ([]*cron.Entry, error) {
	cs, ok := a.eng.Dispatcher().Store().(cron.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement cron.Store")
	}

	entries, err := cs.ListCrons(ctx.Context())
	if err != nil {
		return nil, fmt.Errorf("list crons: %w", err)
	}

	// Apply basic pagination.
	limit := defaultLimit(req.Limit)
	offset := req.Offset
	if offset > len(entries) {
		offset = len(entries)
	}
	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}
	page := entries[offset:end]

	return page, ctx.JSON(http.StatusOK, page)
}
```

with:

```go
// listCrons answers a page of entries, oldest first, as a bare JSON array.
func (a *API) listCrons(ctx forge.Context, req *ListCronsRequest) (*ListCronsResponse, error) {
	cs, ok := a.eng.Dispatcher().Store().(cron.Store)
	if !ok {
		return nil, fmt.Errorf("store does not implement cron.Store")
	}

	entries, err := cs.ListCrons(ctx.Context())
	if err != nil {
		return nil, fmt.Errorf("list crons: %w", err)
	}

	// Apply basic pagination.
	limit := defaultLimit(req.Limit)
	offset := min(max(req.Offset, 0), len(entries))
	end := min(offset+limit, len(entries))

	return &ListCronsResponse{Entries: nonNil(entries[offset:end])}, nil
}
```

Replace this in `api/workflow_handler.go`:

```go
func (a *API) listWorkflowRuns(ctx forge.Context, req *ListWorkflowRunsRequest) ([]*workflow.Run, error) {
```

with:

```go
// listWorkflowRuns answers a page of runs, oldest first, as a bare JSON
// array.
func (a *API) listWorkflowRuns(ctx forge.Context, req *ListWorkflowRunsRequest) (*ListWorkflowRunsResponse, error) {
```

At the end of `listWorkflowRuns`. Replace this in `api/workflow_handler.go`:

```go
	return runs, ctx.JSON(http.StatusOK, runs)
}
```

with:

```go
	return &ListWorkflowRunsResponse{Runs: nonNil(runs)}, nil
}
```

`net/http` stays imported in all four files; the single-item reads still call `ctx.JSON(http.StatusOK, ...)`. `api/api.go` is unchanged so far: `_ = g.GET("/jobs", a.listJobs, ...)` accepts any handler type, and forge now accepts these.

- [ ] **Step 6: Run the list tests and see them pass**

Run: `gofmt -l api; go test -count=1 -v -run 'TestList' ./api/ 2>&1 | grep -E '^(--- |ok)'`
Expected: no file from `gofmt`, then

```
--- PASS: TestListJobs (0.01s)
--- PASS: TestListDLQ (0.01s)
--- PASS: TestListCrons (0.01s)
--- PASS: TestListWorkflowRuns (0.01s)
ok  	github.com/xraph/dispatch/api
```

- [ ] **Step 7: Write the failing registration tests**

Create `api/register_test.go`. `TestRegisterRoutes` checks forge accepted every route and holds exactly the 24 the api serves. Mounting the api twice on one router makes every route collide with itself, which is the simplest refusal to provoke: `RegisterRoutes` must return it, and `Handler` must panic with it. `TestHandler_RegistersOnce` calls `Handler` twice, which would collide the same way if `Handler` registered on every call.

```go
package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/xraph/forge"

	"github.com/xraph/dispatch/api"
)

// allRoutes is every route the api serves, as forge lists them.
var allRoutes = []string{
	"GET /v1/jobs",
	"GET /v1/jobs/:jobId",
	"POST /v1/jobs/:jobId/cancel",
	"POST /v1/jobs/:jobId/retry",
	"GET /v1/jobs/counts",
	"GET /v1/workflows",
	"GET /v1/workflows/runs",
	"GET /v1/workflows/runs/:runId",
	"GET /v1/workflows/runs/:runId/replay",
	"POST /v1/workflows/runs/:runId/replay",
	"GET /v1/dlq",
	"GET /v1/dlq/:entryId",
	"POST /v1/dlq/:entryId/replay",
	"DELETE /v1/dlq/:entryId",
	"POST /v1/dlq/replay-all",
	"POST /v1/dlq/purge",
	"GET /v1/dlq/count",
	"GET /v1/crons",
	"GET /v1/crons/:cronId",
	"POST /v1/crons/:cronId/enable",
	"POST /v1/crons/:cronId/disable",
	"DELETE /v1/crons/:cronId",
	"POST /v1/crons/:cronId/trigger",
	"GET /v1/stats",
}

// TestRegisterRoutes mounts the api on a fresh router. Forge must accept
// every route, and the router must hold exactly the routes the api serves.
func TestRegisterRoutes(t *testing.T) {
	f := newFixture(t)
	r := forge.NewRouter()

	if err := api.New(f.eng, r).RegisterRoutes(r); err != nil {
		t.Fatalf("RegisterRoutes: %v", err)
	}

	got := make([]string, 0, len(allRoutes))
	for _, info := range r.Routes() {
		got = append(got, info.Method+" "+info.Path)
	}
	slices.Sort(got)
	want := slices.Sorted(slices.Values(allRoutes))
	if !slices.Equal(got, want) {
		t.Errorf("routes =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// TestRegisterRoutes_ReportsRefusedRoutes mounts the api twice on one
// router, so every route collides with itself. RegisterRoutes must return
// forge's refusals, each named by method and path.
func TestRegisterRoutes_ReportsRefusedRoutes(t *testing.T) {
	f := newFixture(t)
	r := forge.NewRouter()
	a := api.New(f.eng, r)

	if err := a.RegisterRoutes(r); err != nil {
		t.Fatalf("first RegisterRoutes: %v", err)
	}

	err := a.RegisterRoutes(r)
	if err == nil {
		t.Fatal("second RegisterRoutes on the same router returned nil")
	}
	for _, route := range []string{"GET /v1/jobs:", "POST /v1/dlq/purge:", "DELETE /v1/crons/:cronId:", "GET /v1/stats:"} {
		if !strings.Contains(err.Error(), route) {
			t.Errorf("error does not name %q:\n%v", strings.TrimSuffix(route, ":"), err)
		}
	}
}

// TestHandler_PanicsOnARefusedRoute builds a handler on a router that
// already holds every route. Handler has no error to return, so it must
// panic with forge's reason instead of serving an api with holes in it.
func TestHandler_PanicsOnARefusedRoute(t *testing.T) {
	f := newFixture(t)
	r := forge.NewRouter()
	if err := api.New(f.eng, r).RegisterRoutes(r); err != nil {
		t.Fatalf("RegisterRoutes: %v", err)
	}

	defer func() {
		msg, _ := recover().(string)
		if !strings.Contains(msg, "dispatch api: ") || !strings.Contains(msg, "GET /v1/jobs:") {
			t.Errorf("panic = %q, want one naming GET /v1/jobs", msg)
		}
	}()

	api.New(f.eng, r).Handler()
	t.Error("Handler returned on a router where every route collides")
}

// TestHandler_RegistersOnce calls Handler twice. The second call must not
// register every route again, which would collide and panic.
func TestHandler_RegistersOnce(t *testing.T) {
	f := newFixture(t)
	a := api.New(f.eng, nil)

	a.Handler()
	h := a.Handler()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/stats", nil))
	wantStatus(t, rec, http.StatusOK)
}
```

Create `extension/routes_test.go`. It goes through `Register`, the production path, and reads a list route under the default `/dispatch` base path.

```go
package extension_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	forgetesting "github.com/xraph/forge/testing"

	"github.com/xraph/dispatch/extension"
	"github.com/xraph/dispatch/store/memory"
)

// TestExtension_RoutesRegister mounts the api through Register and reads
// a list route under the default base path. Mounting it again on the same
// path collides route by route, and RegisterRoutes must report that.
func TestExtension_RoutesRegister(t *testing.T) {
	ext := extension.New(extension.WithStore(memory.New()))
	fapp := forgetesting.NewTestApp("routes-app", "0.1.0")

	if err := ext.Register(fapp); err != nil {
		t.Fatalf("Register: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/dispatch/v1/jobs", nil)
	fapp.Router().Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("GET /dispatch/v1/jobs = %d %q, want 200 []", rec.Code, rec.Body.String())
	}

	err := ext.RegisterRoutes(fapp.Router().Group("/dispatch"))
	if err == nil || !strings.Contains(err.Error(), "GET /v1/jobs:") {
		t.Errorf("RegisterRoutes on a path that already holds the api = %v, want an error naming GET /v1/jobs", err)
	}
}
```

- [ ] **Step 8: Run them and see them fail**

Run: `go vet ./api/ ./extension/ 2>&1 | grep 'used as value'`
Expected:

```
vet: api/register_test.go:50:12: api.New(f.eng, r).RegisterRoutes(r) (no value) used as value
vet: extension/routes_test.go:34:9: ext.RegisterRoutes(fapp.Router().Group("/dispatch")) (no value) used as value
```

(`go test ./api/` lists all four `api/register_test.go` lines, 50, 73, 77 and 94.) `RegisterRoutes` has no result yet, which is the bug: there is nothing to check.

- [ ] **Step 9: Keep forge's registration errors in `api/api.go`**

Replace the whole of `api/api.go` with the following. Every `_ = g.GET(`, `_ = g.POST(` and `_ = g.DELETE(` becomes `r.get(`, `r.post(` and `r.delete(` on a small `routes` value that keeps forge's error for each route, prefixed with its method and path. Each `register...Routes` returns `r.err()`, and `RegisterRoutes` joins the five. The route options themselves are unchanged from Task 11, so the list routes keep their `[]*job.Job{}` style response schemas.

```go
// Package api provides HTTP handlers for the Dispatch API.
package api

import (
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/xraph/forge"

	"github.com/xraph/dispatch/cron"
	"github.com/xraph/dispatch/dlq"
	"github.com/xraph/dispatch/engine"
	"github.com/xraph/dispatch/job"
	"github.com/xraph/dispatch/workflow"
)

// API wires all Forge-style HTTP handlers together for the dispatch system.
type API struct {
	eng    *engine.Engine
	router forge.Router

	handlerOnce sync.Once
	handler     http.Handler
}

// New creates an API from a dispatch Engine.
func New(eng *engine.Engine, router forge.Router) *API {
	return &API{eng: eng, router: router}
}

// Handler returns the fully assembled http.Handler with all routes. The
// routes are registered on the first call; later calls return the same
// handler. A route forge refuses is a programming error, so Handler
// panics with forge's reason rather than serve an api with a hole in it.
func (a *API) Handler() http.Handler {
	a.handlerOnce.Do(func() {
		if a.router == nil {
			a.router = forge.NewRouter()
		}
		if err := a.RegisterRoutes(a.router); err != nil {
			panic(fmt.Sprintf("dispatch api: %v", err))
		}
		a.handler = a.router.Handler()
	})

	return a.handler
}

// RegisterRoutes registers all dispatch API routes into the given Forge router
// with full OpenAPI metadata. It returns every route forge refused, each
// named by method and path. Forge refuses a handler it cannot bind, or a
// path that collides with one already registered, and that route would
// otherwise answer 404.
func (a *API) RegisterRoutes(router forge.Router) error {
	return errors.Join(
		a.registerJobRoutes(router),
		a.registerWorkflowRoutes(router),
		a.registerDLQRoutes(router),
		a.registerCronRoutes(router),
		a.registerStatsRoutes(router),
	)
}

// routes registers one group's routes and keeps the error forge returns
// for each, named by method and path.
type routes struct {
	g    forge.Router
	errs []error
}

// group starts a /v1 group with the given OpenAPI tag.
func group(router forge.Router, tag string) *routes {
	return &routes{g: router.Group("/v1", forge.WithGroupTags(tag))}
}

func (r *routes) get(path string, handler any, opts ...forge.RouteOption) {
	r.keep(http.MethodGet, path, r.g.GET(path, handler, opts...))
}

func (r *routes) post(path string, handler any, opts ...forge.RouteOption) {
	r.keep(http.MethodPost, path, r.g.POST(path, handler, opts...))
}

func (r *routes) delete(path string, handler any, opts ...forge.RouteOption) {
	r.keep(http.MethodDelete, path, r.g.DELETE(path, handler, opts...))
}

func (r *routes) keep(method, path string, err error) {
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s /v1%s: %w", method, path, err))
	}
}

func (r *routes) err() error {
	return errors.Join(r.errs...)
}

// registerJobRoutes registers job management routes.
func (a *API) registerJobRoutes(router forge.Router) error {
	r := group(router, "jobs")

	r.get("/jobs", a.listJobs,
		forge.WithSummary("List jobs"),
		forge.WithDescription("Returns jobs filtered by state and queue."),
		forge.WithOperationID("listJobs"),
		forge.WithRequestSchema(ListJobsRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Job list", []*job.Job{}),
		forge.WithErrorResponses(),
	)

	r.get("/jobs/:jobId", a.getJob,
		forge.WithSummary("Get job"),
		forge.WithDescription("Returns details of a specific job."),
		forge.WithOperationID("getJob"),
		forge.WithRequestSchema(GetJobRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Job details", &job.Job{}),
		forge.WithErrorResponses(),
	)

	r.post("/jobs/:jobId/cancel", a.cancelJob,
		forge.WithSummary("Cancel job"),
		forge.WithDescription("Cancels a pending, retrying or running job. A running job's worker stops when it next renews its lease."),
		forge.WithOperationID("cancelJob"),
		forge.WithRequestSchema(CancelJobRequest{}),
		forge.WithNoContentResponse(),
		conflictResponse("The job is completed, failed or already cancelled"),
		forge.WithErrorResponses(),
	)

	r.post("/jobs/:jobId/retry", a.retryJob,
		forge.WithSummary("Retry job"),
		forge.WithDescription("Retries a failed job by resetting it to pending state. Claims the job's DLQ entry, if it has one, so the entry cannot also be replayed."),
		forge.WithOperationID("retryJob"),
		forge.WithRequestSchema(RetryJobRequest{}),
		forge.WithNoContentResponse(),
		conflictResponse("The job is not failed, or its DLQ entry was already replayed"),
		forge.WithErrorResponses(),
	)

	r.get("/jobs/counts", a.jobCounts,
		forge.WithSummary("Job counts"),
		forge.WithDescription("Returns job counts grouped by state."),
		forge.WithOperationID("jobCounts"),
		forge.WithResponseSchema(http.StatusOK, "Job counts", JobCountsResponse{}),
		forge.WithErrorResponses(),
	)

	return r.err()
}

// registerWorkflowRoutes registers workflow management routes.
func (a *API) registerWorkflowRoutes(router forge.Router) error {
	r := group(router, "workflows")

	r.get("/workflows", a.listWorkflowNames,
		forge.WithSummary("List workflows"),
		forge.WithDescription("Returns the names of all registered workflows."),
		forge.WithOperationID("listWorkflows"),
		forge.WithResponseSchema(http.StatusOK, "Workflow names", ListWorkflowNamesResponse{}),
		forge.WithErrorResponses(),
	)

	r.get("/workflows/runs", a.listWorkflowRuns,
		forge.WithSummary("List workflow runs"),
		forge.WithDescription("Returns workflow runs filtered by state."),
		forge.WithOperationID("listWorkflowRuns"),
		forge.WithRequestSchema(ListWorkflowRunsRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Workflow runs", []*workflow.Run{}),
		forge.WithErrorResponses(),
	)

	r.get("/workflows/runs/:runId", a.getWorkflowRun,
		forge.WithSummary("Get workflow run"),
		forge.WithDescription("Returns details of a specific workflow run."),
		forge.WithOperationID("getWorkflowRun"),
		forge.WithRequestSchema(GetWorkflowRunRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Workflow run details", &workflow.Run{}),
		forge.WithErrorResponses(),
	)

	r.get("/workflows/runs/:runId/replay", a.planWorkflowReplay,
		forge.WithSummary("Plan workflow replay"),
		forge.WithDescription("Reports what replaying the run from a step would do, without changing anything."),
		forge.WithOperationID("planWorkflowReplay"),
		forge.WithRequestSchema(PlanWorkflowReplayRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Replay plan", &workflow.ReplayPlan{}),
		conflictResponse("The step has no checkpoint, or the run's version is not registered"),
		forge.WithErrorResponses(),
	)

	r.post("/workflows/runs/:runId/replay", a.replayWorkflow,
		forge.WithSummary("Replay workflow run"),
		forge.WithDescription("Re-runs a finished run from a step on its own version. Answers once the replay has started; the run continues in the background."),
		forge.WithOperationID("replayWorkflowRun"),
		forge.WithRequestSchema(ReplayWorkflowRequest{}),
		forge.WithResponseSchema(http.StatusAccepted, "Replay started", &workflow.ReplayPlan{}),
		conflictResponse("The run is running, the step has no checkpoint, or the run's version is not registered"),
		forge.WithResponseSchema(http.StatusServiceUnavailable, "The workflow runner has shut down", ErrorResponse{}),
		forge.WithErrorResponses(),
	)

	return r.err()
}

// registerDLQRoutes registers dead letter queue management routes.
func (a *API) registerDLQRoutes(router forge.Router) error {
	r := group(router, "dlq")

	r.get("/dlq", a.listDLQ,
		forge.WithSummary("List DLQ entries"),
		forge.WithDescription("Returns dead letter queue entries."),
		forge.WithOperationID("listDLQ"),
		forge.WithRequestSchema(ListDLQRequest{}),
		forge.WithResponseSchema(http.StatusOK, "DLQ entries", []*dlq.Entry{}),
		forge.WithErrorResponses(),
	)

	r.get("/dlq/:entryId", a.getDLQ,
		forge.WithSummary("Get DLQ entry"),
		forge.WithDescription("Returns details of a specific DLQ entry."),
		forge.WithOperationID("getDLQ"),
		forge.WithRequestSchema(GetDLQRequest{}),
		forge.WithResponseSchema(http.StatusOK, "DLQ entry details", &dlq.Entry{}),
		forge.WithErrorResponses(),
	)

	r.post("/dlq/:entryId/replay", a.replayDLQ,
		forge.WithSummary("Replay DLQ entry"),
		forge.WithDescription("Re-enqueues a DLQ entry as a new pending job. An entry is replayed at most once."),
		forge.WithOperationID("dispatchReplayDLQ"),
		forge.WithRequestSchema(ReplayDLQRequest{}),
		forge.WithCreatedResponse(&job.Job{}),
		conflictResponse("The entry was already replayed, or no worker can run the job"),
		forge.WithErrorResponses(),
	)

	r.delete("/dlq/:entryId", a.deleteDLQ,
		forge.WithSummary("Delete DLQ entry"),
		forge.WithDescription("Permanently removes one DLQ entry."),
		forge.WithOperationID("deleteDLQ"),
		forge.WithRequestSchema(DeleteDLQRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)

	r.post("/dlq/replay-all", a.replayAllDLQ,
		forge.WithSummary("Replay all DLQ entries"),
		forge.WithDescription("Re-enqueues unreplayed DLQ entries as new pending jobs, newest first, optionally in one queue and up to a limit."),
		forge.WithOperationID("replayAllDLQ"),
		forge.WithRequestSchema(ReplayAllDLQRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Replay result", ReplayAllDLQResponse{}),
		forge.WithErrorResponses(),
	)

	r.post("/dlq/purge", a.purgeDLQ,
		forge.WithSummary("Purge DLQ"),
		forge.WithDescription("Removes DLQ entries that failed before a cutoff: before, older_than, or 30 days ago when neither is given. dry_run counts them instead."),
		forge.WithOperationID("purgeDLQ"),
		forge.WithRequestSchema(PurgeDLQRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Purge result", PurgeDLQResponse{}),
		forge.WithErrorResponses(),
	)

	r.get("/dlq/count", a.dlqCount,
		forge.WithSummary("DLQ count"),
		forge.WithDescription("Returns the total number of DLQ entries."),
		forge.WithOperationID("dlqCount"),
		forge.WithResponseSchema(http.StatusOK, "DLQ count", DLQCountResponse{}),
		forge.WithErrorResponses(),
	)

	return r.err()
}

// registerCronRoutes registers cron management routes.
func (a *API) registerCronRoutes(router forge.Router) error {
	r := group(router, "crons")

	r.get("/crons", a.listCrons,
		forge.WithSummary("List cron entries"),
		forge.WithDescription("Returns all registered cron entries."),
		forge.WithOperationID("listCrons"),
		forge.WithRequestSchema(ListCronsRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Cron entries", []*cron.Entry{}),
		forge.WithErrorResponses(),
	)

	r.get("/crons/:cronId", a.getCron,
		forge.WithSummary("Get cron entry"),
		forge.WithDescription("Returns details of a specific cron entry."),
		forge.WithOperationID("getCron"),
		forge.WithRequestSchema(GetCronRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Cron entry details", &cron.Entry{}),
		forge.WithErrorResponses(),
	)

	r.post("/crons/:cronId/enable", a.enableCron,
		forge.WithSummary("Enable cron entry"),
		forge.WithDescription("Enables a cron entry. Its next run is computed from now, so it does not fire a catch-up."),
		forge.WithOperationID("enableCron"),
		forge.WithRequestSchema(EnableCronRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Enabled cron entry", &cron.Entry{}),
		conflictResponse("The schedule never fires"),
		forge.WithErrorResponses(),
	)

	r.post("/crons/:cronId/disable", a.disableCron,
		forge.WithSummary("Disable cron entry"),
		forge.WithDescription("Disables a cron entry so it no longer fires."),
		forge.WithOperationID("disableCron"),
		forge.WithRequestSchema(DisableCronRequest{}),
		forge.WithResponseSchema(http.StatusOK, "Disabled cron entry", &cron.Entry{}),
		forge.WithErrorResponses(),
	)

	r.delete("/crons/:cronId", a.deleteCron,
		forge.WithSummary("Delete cron entry"),
		forge.WithDescription("Permanently removes a cron entry."),
		forge.WithOperationID("deleteCron"),
		forge.WithRequestSchema(DeleteCronRequest{}),
		forge.WithNoContentResponse(),
		forge.WithErrorResponses(),
	)

	r.post("/crons/:cronId/trigger", a.triggerCron,
		forge.WithSummary("Trigger cron entry"),
		forge.WithDescription("Enqueues the entry's job now. The schedule is left alone, and a disabled entry can be triggered too."),
		forge.WithOperationID("triggerCron"),
		forge.WithRequestSchema(TriggerCronRequest{}),
		forge.WithCreatedResponse(&job.Job{}),
		conflictResponse("No worker can run the job"),
		forge.WithErrorResponses(),
	)

	return r.err()
}

// conflictResponse documents the 409 an operator route answers when the
// current state refuses the action. WithErrorResponses does not list 409.
func conflictResponse(description string) forge.RouteOption {
	return forge.WithResponseSchema(http.StatusConflict, description, ErrorResponse{})
}

// registerStatsRoutes registers aggregate statistics routes.
func (a *API) registerStatsRoutes(router forge.Router) error {
	r := group(router, "stats")

	r.get("/stats", a.stats,
		forge.WithSummary("Dispatch stats"),
		forge.WithDescription("Returns aggregate statistics for jobs, workflows, and DLQ."),
		forge.WithOperationID("dispatchStats"),
		forge.WithResponseSchema(http.StatusOK, "Dispatch statistics", StatsResponse{}),
		forge.WithErrorResponses(),
	)

	return r.err()
}
```

The panic in `Handler` happens inside `sync.Once`, so a recovered panic leaves `Handler` returning nil afterwards. That is deliberate: a misregistered api is a programming error to fix, not a state to recover from.

- [ ] **Step 10: Fail the extension's Register on a refused route**

In `init`, under `// Register HTTP routes unless disabled.`. Replace this in `extension/extension.go`:

```go
		e.apiHandler.RegisterRoutes(fapp.Router().Group(basePath))
	}
```

with:

```go
		if routeErr := e.apiHandler.RegisterRoutes(fapp.Router().Group(basePath)); routeErr != nil {
			return fmt.Errorf("dispatch: register routes: %w", routeErr)
		}
	}
```

Replace this in `extension/extension.go`:

```go
// RegisterRoutes registers all dispatch API routes into a Forge router.
func (e *Extension) RegisterRoutes(router forge.Router) {
	if e.apiHandler != nil {
		e.apiHandler.RegisterRoutes(router)
	}
}
```

with:

```go
// RegisterRoutes registers all dispatch API routes into a Forge router.
// It returns every route forge refused; see api.API.RegisterRoutes.
func (e *Extension) RegisterRoutes(router forge.Router) error {
	if e.apiHandler == nil {
		return nil
	}

	return e.apiHandler.RegisterRoutes(router)
}
```

The variable is `routeErr`, not `err`: `init` already has an `err` in scope and the lint config runs govet's shadow check. `fmt` is already imported.

- [ ] **Step 11: Run the api and extension tests and see them pass**

Run: `gofmt -l api extension; go test -count=1 -v -run 'TestList|TestRegister|TestHandler_|TestExtension_' ./api/ ./extension/ 2>&1 | grep -E '^(--- FAIL|ok|FAIL)'; go test -count=1 -v -run 'TestRegister|TestHandler_|TestExtension_RoutesRegister' ./api/ ./extension/ 2>&1 | grep -E '^--- '`
Expected: no file from `gofmt`, two `ok` lines and no FAIL, then

```
--- PASS: TestRegisterRoutes (0.00s)
--- PASS: TestRegisterRoutes_ReportsRefusedRoutes (0.00s)
--- PASS: TestHandler_PanicsOnARefusedRoute (0.00s)
--- PASS: TestHandler_RegistersOnce (0.00s)
--- PASS: TestExtension_RoutesRegister (0.00s)
```

`TestRegisterRoutes` passing is also the proof that nothing else in the api was silently refused: `/jobs/counts` beside `/jobs/:jobId`, `/dlq/count` and `/dlq/replay-all` beside `/dlq/:entryId` all register on forgemux.

- [ ] **Step 12: Update the docs**

The setup snippet called a convenience wrapper `api.RegisterRoutes(mux, eng)` that does not exist; it is replaced with `Handler()`, which does.

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

````mdx
// With Forge router:
a := api.New(eng, forgeRouter)
a.RegisterRoutes(forgeRouter)

// Standalone (net/http):
mux := http.NewServeMux()
api.RegisterRoutes(mux, eng)  // convenience wrapper
```

Using the Forge extension auto-registers routes unless `WithDisableRoutes(true)` is set.
````

with:

````mdx
// With Forge router. RegisterRoutes returns an error naming every route
// forge refused, so check it at startup:
a := api.New(eng, forgeRouter)
if err := a.RegisterRoutes(forgeRouter); err != nil {
    return err
}

// Standalone (net/http). Handler registers the routes on a fresh Forge
// router the first time it is called, and panics if forge refuses one:
http.Handle("/", api.New(eng, nil).Handler())
```

Using the Forge extension auto-registers routes unless `WithDisableRoutes(true)` is set. `Register` fails if forge refuses a route.

The four list routes (`GET /v1/jobs`, `/v1/workflows/runs`, `/v1/dlq`, `/v1/crons`) answer a bare JSON array, `[]` when nothing matches. Every query parameter on them is optional, and they list oldest first.
````

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

```mdx
| `state` | string | Filter: `pending`, `running`, `completed`, `failed`, `retrying`, `cancelled` |
```

with:

```mdx
| `state` | string | Filter: `pending`, `running`, `completed`, `failed`, `retrying`, `cancelled` (default: every state; anything else is a `400`) |
```

In "List workflow runs". Replace this in `docs/content/docs/api-reference/http-api.mdx`:

```mdx
| `state` | string | Filter: `running`, `completed`, `failed` |
| `limit` | int | Max results (default: 50) |
```

with:

```mdx
| `state` | string | Filter: `running`, `completed`, `failed` (default: every state) |
| `limit` | int | Max results (default: 50, max: 1000) |
```

In "List DLQ entries". Replace this in `docs/content/docs/api-reference/http-api.mdx`:

```mdx
| `queue` | string | Filter by originating queue name |
| `limit` | int | Max results (default: 50) |
```

with:

```mdx
| `queue` | string | Filter by originating queue name |
| `limit` | int | Max results (default: 50, max: 1000) |
```

Replace this in `docs/content/docs/api-reference/http-api.mdx`:

````mdx
```http
GET /v1/crons?limit=50&offset=0
```
````

with:

````mdx
```http
GET /v1/crons?limit=50&offset=0
```

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | int | Max results (default: 50, max: 1000) |
| `offset` | int | Pagination offset |
````

Replace this in `docs/content/docs/api-reference/go-packages.mdx`:

```mdx
| `RegisterRoutes(router)` | method | Mount all `/v1` routes on the router |
| `Handler()` | method | Returns a standalone `http.Handler` |
```

with:

```mdx
| `RegisterRoutes(router) error` | method | Mount all `/v1` routes on the router; the error names every route forge refused |
| `Handler()` | method | Returns a standalone `http.Handler`; registers the routes on the first call and panics if forge refuses one |
```

`getting-started.mdx`, `guides/full-example.mdx` and `subsystems/admin-api.mdx` call the same nonexistent `api.RegisterRoutes(mux, eng)`. They are not part of this task.

- [ ] **Step 13: Gate**

```bash
go build ./... && go test ./... 2>&1 | grep -v '^ok\|no test files'
go test -race -count=1 ./api/... ./extension/...
go test -race -count=10 ./api/
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners --build-tags integration ./...; rm -rf $C
```

Expected: build succeeds, no FAIL lines, every race run `ok`, `0 issues.` from the first lint. The integration-tag lint reports only the known shadow at `store/redis/store_test.go:54`, which is not this task's.

- [ ] **Step 14: Commit**

```bash
git add api/list_routes_test.go api/register_test.go extension/routes_test.go
git commit --only -m "fix(api): register the four list routes and stop hiding refused ones

GET /v1/jobs, /v1/dlq, /v1/crons and /v1/workflows/runs never
registered. Their handlers returned a bare slice, forge only takes a
pointer, and api.go threw the error away, so each answered 404. That
was already true on forge v1.10.0. Each handler now returns a struct
whose body:\"\" field forge writes as the whole body, so you still get a
bare JSON array, and [] when nothing matches. Every query parameter is
optional. A job list with no state covers every state, and an unknown
state is a 400.

RegisterRoutes returns an error naming each route forge refuses. The
extension's Register fails on it and Handler panics with it. Handler
registers once, so a second call no longer collides." -- api/api.go api/requests.go api/job_handler.go api/dlq_handler.go api/cron_handler.go api/workflow_handler.go api/list_routes_test.go api/register_test.go extension/extension.go extension/routes_test.go docs/content/docs/api-reference/http-api.mdx docs/content/docs/api-reference/go-packages.mdx
git show --stat HEAD | tail -14
```

Expected: `12 files changed, 607 insertions(+), 102 deletions(-)`.

---

## After this plan

Slice 2 is done when Task 12's gate is green on `main` in the shared checkout. Nothing is pushed; ask Rex first. Then update the forge-dashboard memory note `dispatch-dashboard-migration.md` with the commit range and anything the tasks reported, and plan slice 3 (the dashboard contract) against the code these slices produced.

Found while planning and deliberately left for later:

- `workflow.Runner.Resume` still resolves the run's version with `Registry.GetVersion(run.Version)`, where 0 means the latest definition. Runs written before `workflow_run_version_parent` read back version 0 on postgres and sqlite, so a crash-recovered old run resumes on the newest definition. Replay normalises 0 to 1; Resume does not. Decide which is right and make them agree.
- Checkpoint timestamp ties: the memory store's `DeleteCheckpointsAfter` deletes checkpoints with the same `created_at` as the target step, the four durable stores keep them. No conformance case covers it. A tiebreak on checkpoint ID, or a sequence column, would settle it.
- `SpawnChildRaw` still starts its goroutine outside the runner's launcher, so engine Stop does not wait for spawned children.
- Cancelling a pending job while a worker claims it can emit `JobCancelled` twice (there is no conditional write for a pending row). `RetryJob` on a failed job with no dead letter has nothing that serialises two concurrent retries. A running job whose worker is already dead stays cancelled but nothing emits `JobCancelled` for it.
- `observability/extension.go` has no counter for cancelled jobs or operator actions, and the docs list only the old event types.
- The REST api has no authenticated subject, so REST operator actions carry an empty actor. The slice 3 contract sets it from the principal with `ext.WithActor`.
- `GET /v1/jobs` with no state filter merges the first offset+limit jobs of each state in memory; offset is uncapped. The dashboard uses the paged `ListJobs` instead.
- Docs (`getting-started.mdx`, `guides/full-example.mdx`, `subsystems/admin-api.mdx`) call an `api.RegisterRoutes(mux, eng)` that does not exist. `dwp.Server.RegisterRoutes` still only logs refused routes.
- `cron.Store.UpdateCronEntry` has no caller outside tests now. Marking it deprecated would trip staticcheck at the remaining test callers; remove it when they move.
- Every slice 3 obligation recorded at the end of slice 1 still stands (cap page size at 200, a deadline on every list and count, `ErrInvalidCursor` to 400, surface `Complete`, redis counts are O(n)). Add: map `ErrInvalidState`, `ErrDLQAlreadyReplayed` and `resource.ErrUnschedulable` to `CONFLICT`, `workflow.ErrRunnerShutdown` to `UNAVAILABLE`, and answer a workflow replay as started, not finished.
