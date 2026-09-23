# Relay replay consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make replaying a DLQ entry behave the same on all five store backends, give a replayed delivery real retries, and make a second replay of the same entry fail instead of double-sending a webhook.

**Architecture:** Replay moves out of the five store implementations and into `dlq.Service`, which is the only place that can see the configured retry budget. The stores keep one new primitive, `MarkReplayed`, and lose `Replay` and `ReplayBulk` entirely. A new cross-backend conformance suite runs the same assertions against every backend, because none exists today.

**Tech Stack:** Go 1.x, the `grove` query builder used by the SQL and mongo stores, `go-redis` for the redis store.

**Spec:** `docs/superpowers/specs/2026-09-23-relay-dashboard-design.md`, section "Replay".

**Repository:** `/Users/rexraphael/Work/xraph/forgery/relay`. This plan touches no code in forge-dashboard.

## Global Constraints

- Every backend must produce identical observable behaviour for replay. That is the entire point of the change, and it is what the conformance suite exists to enforce.
- A replayed delivery takes `MaxAttempts` from `relay.Config.MaxRetries`. Never a literal, never the exhausted attempt count from the DLQ entry.
- A replayed DLQ row is kept and marked, never deleted. The DLQ becomes a log with a replayed marker.
- `dlq.Service.Replay` and `dlq.Service.ReplayBulk` keep their existing exported signatures, because `api/replay.go` and `dashboard/contributor.go` both call them and neither should need changing in this plan.
- Run `make test` from the relay root. Not a package-scoped run: the store packages and the dlq package both change and only a full run sees both.

## Review Focus

Five conditions the spec implies that no obvious task would cover:

1. Replaying an entry that was already replayed must fail with `ErrAlreadyReplayed` and must NOT enqueue a second delivery. Covered in Task 3.
2. Replaying an entry that does not exist must still return `ErrDLQNotFound`, unchanged from today. Covered in Task 3.
3. If `Enqueue` succeeds but `MarkReplayed` fails, the entry must stay unmarked so a retry of the operation is possible, and the caller must see the error. Covered in Task 3.
4. `ReplayBulk` must skip entries already marked replayed, or a second bulk call over the same window re-sends every webhook in it. Covered in Task 5.
5. A `MaxRetries` of 0 in config must not silently reproduce the original bug. Covered in Task 2.

---

### Task 1: A cross-backend conformance suite for DLQ replay

There is no shared store test suite in this repository today. `store/memory/store_test.go` tests one backend, and the others have only narrow tests (`wake_test.go`, `dequeue_test.go`). This task builds the harness the rest of the plan asserts through. It starts with memory only; later tasks add the other backends as they are fixed.

**Files:**
- Create: `store/storetest/replay.go`
- Create: `store/memory/conformance_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `storetest.ReplayBackend` (the interface a backend must satisfy to be tested), `storetest.NewEntry()`, and `storetest.RunReplaySuite(t *testing.T, newStore func(t *testing.T) ReplayBackend)`. Task 4 calls `RunReplaySuite` from each backend's own test file.

The suite has two kinds of subtest. Most assert the semantics the fix
establishes. Two of them pin behaviour instead: they record what a backend
actually does with an empty tenant filter and with tenant isolation, and fail
when backends disagree with each other rather than asserting something weak
enough that all five pass. The replay divergence was found by reading five
stores by hand; this is that discovery made permanent.

- [ ] **Step 1: Write the suite**

Create `store/storetest/replay.go`:

```go
// Package storetest holds cross-backend conformance suites. Every store
// implementation must produce the same observable behaviour for the
// operations covered here, which is not something a per-backend test can
// establish on its own.
package storetest

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/relay/delivery"
	"github.com/xraph/relay/dlq"
	"github.com/xraph/relay/id"
	"github.com/xraph/relay/internal/entity"
)

// ReplayBackend is the slice of a store the replay suite exercises.
type ReplayBackend interface {
	Push(ctx context.Context, entry *dlq.Entry) error
	GetDLQ(ctx context.Context, dlqID id.ID) (*dlq.Entry, error)
	ListDLQ(ctx context.Context, opts dlq.ListOpts) ([]*dlq.Entry, error)
	MarkReplayed(ctx context.Context, dlqID id.ID, at time.Time) error
	CountDLQ(ctx context.Context) (int64, error)
	Enqueue(ctx context.Context, d *delivery.Delivery) error
	GetDelivery(ctx context.Context, delID id.ID) (*delivery.Delivery, error)
}

// NewEntry builds a DLQ entry suitable for the suite.
func NewEntry() *dlq.Entry {
	return &dlq.Entry{
		Entity:         entity.New(),
		ID:             id.NewDLQID(),
		DeliveryID:     id.NewDeliveryID(),
		EventID:        id.NewEventID(),
		EndpointID:     id.NewEndpointID(),
		EventType:      "invoice.created",
		TenantID:       "tenant-1",
		URL:            "https://receiver.example/hook",
		Payload:        []byte(`{"id":"inv_1"}`),
		Error:          "connection refused",
		AttemptCount:   5,
		LastStatusCode: 0,
		FailedAt:       time.Now().UTC().Add(-time.Hour),
	}
}

// RunReplaySuite asserts the replay semantics every backend must share.
func RunReplaySuite(t *testing.T, newStore func(t *testing.T) ReplayBackend) {
	t.Helper()

	t.Run("MarkReplayed keeps the row and sets the timestamp", func(t *testing.T) {
		ctx := context.Background()
		s := newStore(t)
		e := NewEntry()
		if err := s.Push(ctx, e); err != nil {
			t.Fatalf("push: %v", err)
		}

		at := time.Now().UTC().Truncate(time.Millisecond)
		if err := s.MarkReplayed(ctx, e.ID, at); err != nil {
			t.Fatalf("mark replayed: %v", err)
		}

		got, err := s.GetDLQ(ctx, e.ID)
		if err != nil {
			t.Fatalf("the row must survive a replay, got: %v", err)
		}
		if got.ReplayedAt == nil {
			t.Fatal("ReplayedAt is nil after MarkReplayed")
		}
		if got.ReplayedAt.Unix() != at.Unix() {
			t.Fatalf("ReplayedAt = %v, want %v", got.ReplayedAt, at)
		}
	})

	t.Run("a marked row still counts and still lists", func(t *testing.T) {
		ctx := context.Background()
		s := newStore(t)
		e := NewEntry()
		if err := s.Push(ctx, e); err != nil {
			t.Fatalf("push: %v", err)
		}
		if err := s.MarkReplayed(ctx, e.ID, time.Now().UTC()); err != nil {
			t.Fatalf("mark replayed: %v", err)
		}

		n, err := s.CountDLQ(ctx)
		if err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 1 {
			t.Fatalf("CountDLQ = %d, want 1: a replayed entry is still an entry", n)
		}

		list, err := s.ListDLQ(ctx, dlq.ListOpts{Limit: 10})
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("ListDLQ returned %d entries, want 1", len(list))
		}
		if list[0].ReplayedAt == nil {
			t.Fatal("ListDLQ dropped ReplayedAt on the way back out")
		}
	})

	// Pinning subtests. These do not assert a behaviour chosen in advance;
	// they record what this backend actually does and fail when backends
	// disagree with each other. Reading five stores by hand is how the
	// replay divergence was found in the first place. This makes that
	// discovery automatic, and it would have caught the MaxAttempts case
	// as a byproduct.
	t.Run("pin: what an empty tenant filter returns", func(t *testing.T) {
		ctx := context.Background()
		s := newStore(t)
		a := NewEntry()
		a.TenantID = "tenant-1"
		b := NewEntry()
		b.TenantID = "tenant-2"
		for _, e := range []*dlq.Entry{a, b} {
			if err := s.Push(ctx, e); err != nil {
				t.Fatalf("push: %v", err)
			}
		}

		got, err := s.ListDLQ(ctx, dlq.ListOpts{Limit: 10, TenantID: ""})
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		// An empty tenant filter means "every tenant" on every backend that
		// has been checked. If a backend returns zero here it is treating
		// empty as a literal match, which makes a page that forgot to send
		// a tenant id look perfectly correct.
		if len(got) != 2 {
			t.Fatalf("an empty TenantID returned %d of 2 entries. If this "+
				"backend intends empty to mean 'no tenant', say so here and "+
				"raise it: the backends disagree and callers cannot tell",
				len(got))
		}
		ids := map[string]bool{}
		for _, e := range got {
			ids[e.ID.String()] = true
		}
		// Identity, not count. A count assertion passes when the wrong rows
		// come back in the right quantity.
		if !ids[a.ID.String()] || !ids[b.ID.String()] {
			t.Fatalf("an empty TenantID returned two entries but not the two "+
				"that were pushed: got %v", ids)
		}
	})

	t.Run("pin: tenant isolation by identity", func(t *testing.T) {
		ctx := context.Background()
		s := newStore(t)
		mine := NewEntry()
		mine.TenantID = "tenant-1"
		theirs := NewEntry()
		theirs.TenantID = "tenant-2"
		for _, e := range []*dlq.Entry{mine, theirs} {
			if err := s.Push(ctx, e); err != nil {
				t.Fatalf("push: %v", err)
			}
		}

		got, err := s.ListDLQ(ctx, dlq.ListOpts{Limit: 10, TenantID: "tenant-1"})
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(got) != 1 {
			t.Fatalf("got %d entries for tenant-1, want 1", len(got))
		}
		if got[0].ID != mine.ID {
			t.Fatalf("tenant-1's filter returned tenant-2's entry: %s", got[0].ID)
		}
	})

	t.Run("MarkReplayed on a missing row reports not found", func(t *testing.T) {
		ctx := context.Background()
		s := newStore(t)
		err := s.MarkReplayed(ctx, id.NewDLQID(), time.Now().UTC())
		if err == nil {
			t.Fatal("MarkReplayed on a missing row returned nil")
		}
	})

	t.Run("an enqueued delivery round-trips its retry budget", func(t *testing.T) {
		ctx := context.Background()
		s := newStore(t)
		d := &delivery.Delivery{
			Entity:        entity.New(),
			ID:            id.NewDeliveryID(),
			EventID:       id.NewEventID(),
			EndpointID:    id.NewEndpointID(),
			State:         delivery.StatePending,
			MaxAttempts:   5,
			NextAttemptAt: time.Now().UTC(),
		}
		if err := s.Enqueue(ctx, d); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		got, err := s.GetDelivery(ctx, d.ID)
		if err != nil {
			t.Fatalf("get delivery: %v", err)
		}
		if got.MaxAttempts != 5 {
			t.Fatalf("MaxAttempts = %d, want 5: a backend that drops this "+
				"reintroduces the 1 < 0 bug", got.MaxAttempts)
		}
	})
}
```

- [ ] **Step 2: Wire the memory backend into it**

Create `store/memory/conformance_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/relay/store/memory"
	"github.com/xraph/relay/store/storetest"
)

func TestReplayConformance(t *testing.T) {
	storetest.RunReplaySuite(t, func(t *testing.T) storetest.ReplayBackend {
		t.Helper()
		return memory.New()
	})
}
```

- [ ] **Step 3: Run it and watch it fail to compile**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./store/memory/ -run TestReplayConformance`
Expected: a compile failure, `*memory.Store does not implement storetest.ReplayBackend (missing method MarkReplayed)`. That is the correct failure: no backend has the method yet.

- [ ] **Step 4: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add store/storetest/replay.go store/memory/conformance_test.go
git commit -m "test(store): a cross-backend conformance suite for dlq replay

No shared store suite existed, so five backends drifted apart on replay
without anything noticing. This one fails everywhere until they agree."
```

---

### Task 2: The service-side replay configuration

**Files:**
- Modify: `errors.go`
- Modify: `dlq/service.go:19-33` (the `Service` struct and `NewService`)
- Modify: `relay.go:32` (the `dlq.NewService` call)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `relay.ErrAlreadyReplayed`, `dlq.Config{MaxAttempts int}`, `dlq.Enqueuer` (one method, `Enqueue(ctx, *delivery.Delivery) error`), and `dlq.NewService(store Store, enq Enqueuer, cfg Config, logger log.Logger) *Service`. Task 3 implements `Replay` against these.

- [ ] **Step 1: Write the failing test**

Add to `dlq/service_test.go`:

```go
func TestConfigDefaultsMaxAttempts(t *testing.T) {
	store := memory.New()
	// A zero MaxAttempts is the exact value that caused the original bug,
	// so the service refuses to honour it and falls back to a sane default.
	svc := dlq.NewService(store, store, dlq.Config{MaxAttempts: 0}, nil)
	if got := svc.MaxAttempts(); got != dlq.DefaultMaxAttempts {
		t.Fatalf("MaxAttempts() = %d, want %d", got, dlq.DefaultMaxAttempts)
	}
}

func TestConfigHonoursMaxAttempts(t *testing.T) {
	store := memory.New()
	svc := dlq.NewService(store, store, dlq.Config{MaxAttempts: 3}, nil)
	if got := svc.MaxAttempts(); got != 3 {
		t.Fatalf("MaxAttempts() = %d, want 3", got)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./dlq/ -run TestConfig`
Expected: compile failure, `too many arguments in call to dlq.NewService`.

- [ ] **Step 3: Add the error value**

In `errors.go`, beside `ErrDLQNotFound`:

```go
	// ErrAlreadyReplayed is returned when a DLQ entry that has already been
	// replayed is replayed again. Replaying re-sends a real webhook, so the
	// second call is refused rather than silently duplicating the delivery.
	ErrAlreadyReplayed = errors.New("relay: dlq entry already replayed")
```

- [ ] **Step 4: Add the config, the enqueuer and the constructor**

Replace the `Service` struct and `NewService` in `dlq/service.go`:

```go
// DefaultMaxAttempts is the retry budget a replayed delivery receives when
// the configured value is unusable. Zero is unusable: it makes the retrier
// evaluate `1 < 0` and send the delivery straight back to the DLQ.
const DefaultMaxAttempts = 5

// Config tunes the DLQ service.
type Config struct {
	// MaxAttempts is the retry budget given to a replayed delivery. Values
	// below 1 fall back to DefaultMaxAttempts.
	MaxAttempts int
}

// Enqueuer is the delivery-side capability replay needs. The composite store
// satisfies it, so relay wires the same value in as both dependencies.
type Enqueuer interface {
	Enqueue(ctx context.Context, d *delivery.Delivery) error
}

// Service manages the dead letter queue.
type Service struct {
	store       Store
	enq         Enqueuer
	maxAttempts int
	logger      log.Logger
}

// NewService creates a new DLQ service.
func NewService(store Store, enq Enqueuer, cfg Config, logger log.Logger) *Service {
	if logger == nil {
		logger = log.NewNoopLogger()
	}
	maxAttempts := cfg.MaxAttempts
	if maxAttempts < 1 {
		maxAttempts = DefaultMaxAttempts
	}
	return &Service{
		store:       store,
		enq:         enq,
		maxAttempts: maxAttempts,
		logger:      logger,
	}
}

// MaxAttempts reports the retry budget a replayed delivery will receive.
func (svc *Service) MaxAttempts() int { return svc.maxAttempts }
```

- [ ] **Step 5: Update the one caller**

In `relay.go`, replace line 32:

```go
	r.dlqSvc = dlq.NewService(r.store, r.store, dlq.Config{
		MaxAttempts: r.config.MaxRetries,
	}, r.logger)
```

- [ ] **Step 6: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./dlq/ -run TestConfig -v`
Expected: both PASS. Other tests in the package still fail to compile because `newService()` in the existing test file uses the old signature; fix that helper now:

```go
func newService() (*dlq.Service, *memory.Store) {
	store := memory.New()
	svc := dlq.NewService(store, store, dlq.Config{MaxAttempts: 5}, nil)
	return svc, store
}
```

Re-run `go test ./dlq/` and expect the whole package to pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add errors.go dlq/service.go dlq/service_test.go relay.go
git commit -m "feat(dlq): give the service a retry budget and an enqueuer

Replay has to set MaxAttempts from config, and the store layer cannot
see config. A zero value falls back rather than reproducing the bug it
caused."
```

---

### Task 3: Replay moves into the service

**Files:**
- Modify: `dlq/store.go:10-32` (remove `Replay` and `ReplayBulk`, add `MarkReplayed`)
- Modify: `dlq/service.go` (the `Replay` method)
- Test: `dlq/service_test.go`

**Interfaces:**
- Consumes: `dlq.Config`, `dlq.Enqueuer`, `relay.ErrAlreadyReplayed` from Task 2.
- Produces: `Store.MarkReplayed(ctx context.Context, dlqID id.ID, at time.Time) error` on the store interface. Task 4 implements it on every backend.

- [ ] **Step 1: Write the failing tests**

Add to `dlq/service_test.go`:

```go
func TestReplayEnqueuesWithTheConfiguredBudget(t *testing.T) {
	svc, store := newService()
	e := seedEntry(t, store)

	if err := svc.Replay(ctx(), e.ID); err != nil {
		t.Fatalf("replay: %v", err)
	}

	dels := store.AllDeliveries()
	if len(dels) != 1 {
		t.Fatalf("got %d deliveries, want 1", len(dels))
	}
	if dels[0].MaxAttempts != 5 {
		t.Fatalf("MaxAttempts = %d, want 5", dels[0].MaxAttempts)
	}
	if dels[0].AttemptCount != 0 {
		t.Fatalf("AttemptCount = %d, want 0: a replay starts over", dels[0].AttemptCount)
	}
	if dels[0].State != delivery.StatePending {
		t.Fatalf("State = %q, want pending", dels[0].State)
	}
}

func TestReplayKeepsAndMarksTheEntry(t *testing.T) {
	svc, store := newService()
	e := seedEntry(t, store)

	if err := svc.Replay(ctx(), e.ID); err != nil {
		t.Fatalf("replay: %v", err)
	}

	got, err := store.GetDLQ(ctx(), e.ID)
	if err != nil {
		t.Fatalf("the entry must survive a replay: %v", err)
	}
	if got.ReplayedAt == nil {
		t.Fatal("ReplayedAt is nil after a replay")
	}
}

func TestReplayTwiceIsRefused(t *testing.T) {
	svc, store := newService()
	e := seedEntry(t, store)

	if err := svc.Replay(ctx(), e.ID); err != nil {
		t.Fatalf("first replay: %v", err)
	}
	err := svc.Replay(ctx(), e.ID)
	if !errors.Is(err, relay.ErrAlreadyReplayed) {
		t.Fatalf("second replay error = %v, want ErrAlreadyReplayed", err)
	}
	if n := len(store.AllDeliveries()); n != 1 {
		t.Fatalf("got %d deliveries after a refused replay, want 1: "+
			"the refusal must happen before the enqueue", n)
	}
}

func TestReplayMissingEntry(t *testing.T) {
	svc, _ := newService()
	err := svc.Replay(ctx(), id.NewDLQID())
	if !errors.Is(err, relay.ErrDLQNotFound) {
		t.Fatalf("error = %v, want ErrDLQNotFound", err)
	}
}
```

Add the helper at the top of the file, next to `newService`:

```go
func seedEntry(t *testing.T, store *memory.Store) *dlq.Entry {
	t.Helper()
	e := &dlq.Entry{
		Entity:       entity.New(),
		ID:           id.NewDLQID(),
		DeliveryID:   id.NewDeliveryID(),
		EventID:      id.NewEventID(),
		EndpointID:   id.NewEndpointID(),
		EventType:    "invoice.created",
		TenantID:     "tenant-1",
		URL:          "https://receiver.example/hook",
		Error:        "connection refused",
		AttemptCount: 5,
		FailedAt:     time.Now().UTC().Add(-time.Hour),
	}
	if err := store.Push(ctx(), e); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return e
}
```

`AllDeliveries` does not exist on the memory store yet. Add it in `store/memory/store.go`, beside the other accessors:

```go
// AllDeliveries returns every delivery currently held. Test support: the
// delivery store interface has no unfiltered list.
func (s *Store) AllDeliveries() []*delivery.Delivery {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*delivery.Delivery, 0, len(s.deliveries))
	for _, d := range s.deliveries {
		out = append(out, d)
	}
	return out
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./dlq/ -run TestReplay`
Expected: FAIL. `TestReplayTwiceIsRefused` fails because nothing refuses yet, and `TestReplayEnqueuesWithTheConfiguredBudget` fails on `MaxAttempts = 5, want 5` only once the service owns the logic. Right now the memory store's own `Replay` still runs, so you will see the entry deleted or the hardcoded 5 rather than the configured value.

- [ ] **Step 3: Change the store interface**

In `dlq/store.go`, delete the `Replay` and `ReplayBulk` methods and add:

```go
	// MarkReplayed records that an entry has been replayed. The row is kept:
	// the DLQ is a log, and a marked row is what makes a second replay
	// refusable. Returns a not-found error when the entry does not exist.
	MarkReplayed(ctx context.Context, dlqID id.ID, at time.Time) error
```

- [ ] **Step 4: Implement Replay on the service**

Replace `Service.Replay` in `dlq/service.go`:

```go
// Replay re-enqueues a single DLQ entry for redelivery.
//
// This is a destructive read: it sends a real webhook to a real receiver,
// which cannot tell it apart from the original. An entry that has already
// been replayed is refused rather than sent twice.
func (svc *Service) Replay(ctx context.Context, dlqID id.ID) error {
	entry, err := svc.store.GetDLQ(ctx, dlqID)
	if err != nil {
		return err
	}
	if entry.ReplayedAt != nil {
		return relay.ErrAlreadyReplayed
	}

	now := time.Now().UTC()
	d := &delivery.Delivery{
		Entity:        entity.New(),
		ID:            id.NewDeliveryID(),
		EventID:       entry.EventID,
		EndpointID:    entry.EndpointID,
		State:         delivery.StatePending,
		AttemptCount:  0,
		MaxAttempts:   svc.maxAttempts,
		NextAttemptAt: now,
	}
	if err := svc.enq.Enqueue(ctx, d); err != nil {
		return fmt.Errorf("dlq: replay enqueue: %w", err)
	}

	// Marking after the enqueue means a failure here leaves the entry
	// unmarked and replayable. That risks one duplicate delivery on retry,
	// which is the safer direction: the alternative loses the redelivery
	// entirely and the operator has no way to tell.
	if err := svc.store.MarkReplayed(ctx, dlqID, now); err != nil {
		return fmt.Errorf("dlq: mark replayed: %w", err)
	}
	return nil
}
```

Add `"github.com/xraph/relay"` to the import block if it is not already there. If that creates an import cycle, move `ErrAlreadyReplayed` into the `dlq` package as `dlq.ErrAlreadyReplayed` and have `relay.ErrAlreadyReplayed` alias it, matching how `ErrDLQNotFound` is already handled.

- [ ] **Step 5: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./dlq/ -v`
Expected: the package fails to build, because the five backends still declare `Replay` and do not declare `MarkReplayed`. That is Task 4. To see these tests pass in isolation first, implement memory's `MarkReplayed` now as the first item of Task 4, then return here.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add dlq/store.go dlq/service.go dlq/service_test.go store/memory/store.go
git commit -m "feat(dlq): one replay implementation instead of five

The service owns the semantics now: budget from config, entry kept and
marked, second replay refused. Stores keep MarkReplayed and nothing else."
```

---

### Task 4: MarkReplayed on every backend

Five backends, one method each, and the old `Replay` and `ReplayBulk` deleted from all of them. Do memory first: the dlq tests from Task 3 go green as soon as it lands.

**Files:**
- Modify: `store/memory/store.go` (the `Replay` and `ReplayBulk` methods)
- Modify: `store/postgres/store.go:640-707`
- Modify: `store/sqlite/store.go:616-640` and its `ReplayBulk`
- Modify: `store/redis/dlq.go:171-195` and its `ReplayBulk`
- Modify: `store/mongo/dlq.go:105-130` and its `ReplayBulk`
- Create: `store/postgres/conformance_test.go`, `store/sqlite/conformance_test.go`, `store/redis/conformance_test.go`, `store/mongo/conformance_test.go`

**Interfaces:**
- Consumes: `storetest.RunReplaySuite` from Task 1, `Store.MarkReplayed` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Memory**

In `store/memory/store.go`, delete `Replay` and `ReplayBulk` and add:

```go
// MarkReplayed records that an entry has been replayed, keeping the row.
func (s *Store) MarkReplayed(_ context.Context, dlqID id.ID, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.dlqEntries[dlqID.String()]
	if !ok {
		return relay.ErrDLQNotFound
	}
	t := at.UTC()
	e.ReplayedAt = &t
	return nil
}
```

- [ ] **Step 2: Run the memory conformance suite and the dlq tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./store/memory/ ./dlq/ -v`
Expected: PASS for both. This is the first point in the plan where the new behaviour is demonstrably correct on a real backend.

- [ ] **Step 3: Postgres**

In `store/postgres/store.go`, delete `Replay` (line 640) and `ReplayBulk` (line 669) and add:

```go
func (s *Store) MarkReplayed(ctx context.Context, dlqID id.ID, at time.Time) error {
	res, err := s.pg.NewUpdate((*dlqEntryModel)(nil)).
		Set("replayed_at = $1", at.UTC()).
		Set("updated_at = $2", time.Now().UTC()).
		Where("id = $3", dlqID.String()).
		Exec(ctx)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return relay.ErrDLQNotFound
	}
	return nil
}
```

Check the `grove` update builder's exact `Set` signature against another update in the same file before running; if it takes `(column string, value any)` without the placeholder, drop the `$N` markers.

- [ ] **Step 4: SQLite**

Same shape in `store/sqlite/store.go`, with `?` placeholders instead of `$N`, matching the existing delete at line 635.

- [ ] **Step 5: Redis**

In `store/redis/dlq.go`, delete `Replay` and `ReplayBulk` and add a `MarkReplayed` that reads the entity, sets `ReplayedAt`, and writes it back. The row stays in every sorted set it is already in, so no index maintenance is needed:

```go
func (s *Store) MarkReplayed(ctx context.Context, dlqID id.ID, at time.Time) error {
	var m dlqEntryModel
	if err := s.getEntity(ctx, entityKey(prefixDLQ, dlqID.String()), &m); err != nil {
		if isNotFound(err) {
			return relay.ErrDLQNotFound
		}
		return err
	}
	t := at.UTC()
	m.ReplayedAt = &t
	return s.setEntity(ctx, entityKey(prefixDLQ, dlqID.String()), &m)
}
```

Confirm `setEntity` is the write helper used elsewhere in this file, and that `dlqEntryModel` carries a `ReplayedAt *time.Time`. If it does not, add it with the same json tag pattern the other fields use, because redis serialises the model directly.

- [ ] **Step 6: Mongo**

In `store/mongo/dlq.go`, delete `Replay` and `ReplayBulk` and add:

```go
func (s *Store) MarkReplayed(ctx context.Context, dlqID id.ID, at time.Time) error {
	res, err := s.mdb.NewUpdate((*dlqEntryModel)(nil)).
		Filter(bson.M{"_id": dlqID.String()}).
		Set(bson.M{"replayed_at": at.UTC(), "updated_at": time.Now().UTC()}).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("relay/mongo: mark replayed: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return relay.ErrDLQNotFound
	}
	return nil
}
```

Match the update builder's real signature against an existing update in the same package.

- [ ] **Step 7: Wire each backend into the conformance suite**

Each `conformance_test.go` follows the memory one from Task 1. The three networked backends need their existing test-skip guard, so copy whatever `wake_test.go` and `dequeue_test.go` already use rather than inventing one. For example `store/postgres/conformance_test.go`:

```go
package postgres_test

import (
	"testing"

	"github.com/xraph/relay/store/postgres"
	"github.com/xraph/relay/store/storetest"
)

func TestReplayConformance(t *testing.T) {
	storetest.RunReplaySuite(t, func(t *testing.T) storetest.ReplayBackend {
		t.Helper()
		return newTestStore(t) // the helper wake_test.go already uses
	})
}
```

If a backend has no existing test-store helper, and standing one up needs a live server this plan cannot assume, skip that backend's file and record it in the commit message. Do not write a conformance test that silently passes without connecting.

- [ ] **Step 8: Full build and test**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go build ./... && make test`
Expected: clean build, tests pass. The build is the important half: it is what proves no caller of the removed `Replay` and `ReplayBulk` store methods was missed.

- [ ] **Step 9: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add store/
git commit -m "fix(store): every backend marks a replayed dlq entry the same way

Replaying used to delete the row and leave MaxAttempts at zero on
postgres, sqlite and redis, so the retrier evaluated 1 < 0 and sent the
delivery straight back to the queue it came out of. Mongo used the
exhausted attempt count. Only the in-memory store, which nobody
deploys, behaved correctly. The conformance suite now holds all five
to the same result."
```

---

### Task 5: ReplayBulk moves to the service

**Files:**
- Modify: `dlq/service.go` (the `ReplayBulk` method)
- Test: `dlq/service_test.go`

**Interfaces:**
- Consumes: `Service.Replay` from Task 3, `Store.ListDLQ` with its existing `From`/`To` options.
- Produces: nothing new. `ReplayBulk(ctx, from, to) (int64, error)` keeps its signature so `api/replay.go:75` and `dashboard/contributor.go` are untouched.

- [ ] **Step 1: Write the failing tests**

```go
func TestReplayBulkSkipsAlreadyReplayed(t *testing.T) {
	svc, store := newService()
	a := seedEntry(t, store)
	seedEntry(t, store)

	if err := svc.Replay(ctx(), a.ID); err != nil {
		t.Fatalf("seed replay: %v", err)
	}

	from := time.Now().UTC().Add(-24 * time.Hour)
	to := time.Now().UTC()
	n, err := svc.ReplayBulk(ctx(), from, to)
	if err != nil {
		t.Fatalf("replay bulk: %v", err)
	}
	if n != 1 {
		t.Fatalf("replayed %d, want 1: the already-replayed entry must be skipped", n)
	}
	if got := len(store.AllDeliveries()); got != 2 {
		t.Fatalf("got %d deliveries, want 2 (one per entry, none twice)", got)
	}
}

func TestReplayBulkTwiceSendsNothingTheSecondTime(t *testing.T) {
	svc, store := newService()
	seedEntry(t, store)
	seedEntry(t, store)

	from := time.Now().UTC().Add(-24 * time.Hour)
	to := time.Now().UTC()
	if _, err := svc.ReplayBulk(ctx(), from, to); err != nil {
		t.Fatalf("first bulk: %v", err)
	}
	n, err := svc.ReplayBulk(ctx(), from, to)
	if err != nil {
		t.Fatalf("second bulk: %v", err)
	}
	if n != 0 {
		t.Fatalf("second bulk replayed %d, want 0", n)
	}
	if got := len(store.AllDeliveries()); got != 2 {
		t.Fatalf("got %d deliveries, want 2: a second bulk must not re-send", got)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./dlq/ -run TestReplayBulk`
Expected: compile failure, because `Service.ReplayBulk` still calls the store method deleted in Task 4.

- [ ] **Step 3: Implement it**

```go
// ReplayBulk re-enqueues every un-replayed DLQ entry that failed inside the
// window. Entries already replayed are skipped, so calling it twice over the
// same window does not send every webhook in it twice.
//
// It returns the number replayed. A failure partway through returns the count
// achieved so far along with the error: the deliveries already enqueued have
// been sent and the caller needs to know that.
func (svc *Service) ReplayBulk(ctx context.Context, from, to time.Time) (int64, error) {
	entries, err := svc.store.ListDLQ(ctx, ListOpts{From: &from, To: &to})
	if err != nil {
		return 0, err
	}

	var count int64
	for _, e := range entries {
		if e.ReplayedAt != nil {
			continue
		}
		if err := svc.Replay(ctx, e.ID); err != nil {
			if errors.Is(err, relay.ErrAlreadyReplayed) {
				continue
			}
			return count, err
		}
		count++
	}
	return count, nil
}
```

Add `"errors"` to the imports.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./dlq/ -v`
Expected: PASS.

- [ ] **Step 5: Full check**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go build ./... && make test && make vet`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add dlq/service.go dlq/service_test.go
git commit -m "fix(dlq): a second bulk replay over the same window sends nothing

ReplayBulk lived in five stores and re-sent every entry it found. It is
one loop over Replay now, and Replay refuses an entry it already sent."
```

---

### Task 6: Note the behaviour change where operators will see it

Keeping the DLQ row changes what DLQ depth means. It stops falling when entries are replayed, which matters to anyone alerting on it.

**Files:**
- Modify: `README.md` in the relay root, or `docs/` if a DLQ page exists there. Check both before writing.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Find where the DLQ is documented**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && grep -rln "dead letter\|DLQ" README.md docs/ 2>/dev/null`

- [ ] **Step 2: Add the note**

In the DLQ section of whichever file that finds:

```markdown
### Replayed entries stay in the queue

Replaying an entry marks it and leaves it in place rather than removing it.
The dead letter queue is a log of what failed, not a worklist that empties,
and `CountDLQ` counts replayed entries too. If you alert on DLQ depth, alert
on the un-replayed count instead, or the number stops falling once somebody
starts working through it.

Replaying an entry that has already been replayed returns
`ErrAlreadyReplayed` and sends nothing.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add -A
git commit -m "docs: dlq depth counts replayed entries now"
```
