# Nexus Slice 3: Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nexus refuse what it should: HTTP traffic needs a valid `nxs_` key, and every request is held to its tenant's status, key scopes, per-request token cap, daily requests, monthly budget, and RPM/TPM through a pluggable limiter, with typed refusals that reach the client as 401, 403, 400, 429 or 503.

**Architecture:** Refusals are one type, `pipeline.RefusalError`, which the usage stage already records as `refused` at `$0`. Two new pipeline stages sit between identity (30) and stream lifecycle (60): access (40), which checks tenant status and key scopes, and quota (50), which checks the per-request cap, the store-backed daily and budget limits, and the limiter-backed RPM/TPM. `auth.KeyAuth` authenticates HTTP requests in `api` and `proxy`, and puts the tenant, key and scopes in the context the pipeline reads. The limiter is an interface with memory and Redis implementations.

**Tech Stack:** Go 1.26, grove v1.6.3 stores (memory, SQLite, Postgres, Mongo), `github.com/redis/go-redis/v9` v9.21.0 (already in the module graph as indirect), net/http.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`. Read "Slice 3: enforcement", "Decisions", and both hand-off sections ("What slice 1 found", "What slice 2 found that slice 3 must know").

**Code repo:** `/Users/rexraphael/Work/xraph/forgery/nexus`, branch `main`, HEAD `9301ea4` (slices 1 and 2 unpushed). Every path below is relative to it unless it names forge-dashboard.

## Global Constraints

- Work on `main` in the shared checkout. Commit only your own paths: `git add <new files>`, then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .` or a bare directory. Never `--amend`. Never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. Never push.
- Commit messages: no `Co-Authored-By` trailer, no Claude or Anthropic attribution, no em or en dashes.
- Never run `go build` that writes files: use `go build -o /dev/null ./...` or `go vet`. `_examples/grpc/grpc`, `_examples/live/live` and `_examples/realtime/realtime` are committed binaries.
- `go test ./providers/...` from the root matches nothing; every provider is its own module. Loop over `providers/*/`.
- A module that replaces nexus with the root (`grpcsrv`, `_examples/grpc`, every `providers/*`) needs `GOWORK=off go mod tidy` when the root's requires change. Do it as its own `chore` commit.
- Lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- `dashboard/` (templ) must keep compiling until slice 7. Never run `templ generate -path dashboard`.
- Test databases (started by the controller; never ports 5432, 6379 or 27017):
  - `docker run -d --rm --name nexus-test-pg -e POSTGRES_PASSWORD=nexus -e POSTGRES_DB=nexus -p 55632:5432 postgres:17-alpine`
  - `docker run -d --rm --name nexus-test-mongo -p 57632:27017 mongo:7`
  - `docker run -d --rm --name nexus-test-redis -p 56379:6379 redis:7-alpine`
  - Inline on every test command that should reach them: `NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable" NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test" NEXUS_TEST_REDIS_ADDR="localhost:56379"`
- Money is `money.USD`. No float64 holds a price, cost, spend or budget. The one exception is the `usedPct float64` that `plugin.BudgetWarning` already takes, computed by `money.USD.Ratio` for display.
- An unknown cost is nil, never `$0`. A pipeline refusal is recorded `refused`, `not_charged`, `$0`.
- Gateway keys are secrets. Never log a raw key, never put one in an error message, never echo one in a response other than `Create` and `Rotate`.
- Refusal codes and statuses, exactly: `unauthenticated` 401, `forbidden` 403, `invalid_request` 400, `rate_limited` 429, `quota_exceeded` 429, `budget_exceeded` 429, `unavailable` 503, `content_blocked` 400 (guard blocks).
- `Config.RequireAPIKey` defaults to `true`. `false` keeps the open gateway.
- The budget is a soft limit: the request that crosses it completes, the next one is refused.
- An unreachable limiter lets the request through and is counted. An unreachable store on a daily or budget check refuses with 503 `unavailable`.
- Fixed one-minute windows for RPM and TPM.
- Stage priorities after this slice: request_id 5, tracing 10, usage 15, timeout 20, identity 30, access 40, quota 50, stream_lifecycle 60, guardrail 150, transform 200, alias 250, cache 280, retry 340, custom by priority, provider_call last.

## Rulings this plan makes (each recorded again in the slice ledger)

1. **`RefusalError` lives in `pipeline`, not the root package.** `pipeline/middlewares` cannot import `nexus` (the root imports middlewares). The root re-exports it: `type RefusalError = pipeline.RefusalError`.
2. **Refusals at the HTTP edge are not recorded.** A 401 from `KeyAuth` or a 403 from a route scope (`admin`, `models`) happens before the pipeline, with no tenant to charge; recording it would let anyone write rows. Every refusal inside the pipeline is recorded, as slice 2 built.
3. **`DailyRequests` counts every recorded request except `refused` ones.** Otherwise a tenant held at its RPM burns its daily quota on the refusals.
4. **`key.Store.FindByPrefix` returns every key with the prefix, any status.** `Validate` compares hashes in constant time across all of them; an unknown prefix and a wrong hash both return `key.ErrNotFound`, so a caller cannot probe which prefixes exist. Revoked and expired are reported only after the hash matches.
5. **`LastUsedAt` is written with a single-column update (`key.Store.TouchLastUsed`).** A full-row `Update` from `Validate` raced `Revoke` and could write a revoked key back as active.
6. **Key and tenant services take options** (`key.WithTenants`, `key.WithEvents`, `tenant.WithEvents`), so `key.NewService(store)` still compiles for existing callers.
7. **Edge scopes go in the context; in-process callers who name a key id get it looked up.** The access stage uses `pipeline.Scopes(ctx)` when the edge set them, and `key.Service.Get` otherwise. A caller that names no key is not scope-checked.
8. **An unknown tenant is refused `forbidden` and recorded unattributed** (spec M9: the Postgres tenant foreign key would lose the row otherwise).
9. **Retry stops on refusals, guard blocks, context errors and `pipeline.Permanent` errors.** Provider-call wraps "no providers registered", "no providers support embeddings", routing failures and an unknown request type as permanent.
10. **`Engine.Complete` with `Stream: true` is refused `invalid_request`** (spec M10) instead of dropping the stream unclosed.
11. **`GlobalRateLimit` is enforced** through the same limiter, key `global:rpm`, for every request including unattributed ones. It was stored and displayed but never enforced.
12. **A stream cut by `MaxStreamDuration` or `MaxStreamTokens` is recorded `error`, status 429, refusal code `quota_exceeded`, priced from the tokens seen.** It was served in part, so it was charged; it is not a `refused` row.
13. **Budget hooks fire once per tenant per month per replica.** `BudgetWarning` at 80% and `BudgetExceeded` would otherwise fire on every request above the line.
14. **The Redis limiter is a package in the root module (`ratelimit/redislimit`).** go-redis is already in the module graph as indirect; moving it to direct adds no new module.

Deferred, with reasons (they go into the slice 3 hand-off): M4 (non-`req_` request ids), M6 (tracing tenant), M8 (auto-discovered `WithDatabase` order), M11 (bounded insert workers), Vertex `statistics.token_count`, gRPC authentication (callers add an interceptor; `auth.Authenticate` is the building block), WebSocket browser auth (headers only in this slice).

## Review Focus

1. A key revoked between two requests of the same client: the next request is 401, and the key's `LastUsedAt` update never writes it back to active. Pinned by `TestTouchingAKeyNeverChangesItsStatus` (Task 3) and `TestARevokedKeyIsRefusedAtTheEdge` (Task 13).
2. Two keys that share a 12-character prefix: each one authenticates as itself. Pinned by `TestKeysSharingAPrefixAreAllFound` (Task 3) and `TestValidateFindsTheRightKeyAmongSharedPrefixes` (Task 4).
3. A tenant at its budget: the request that crosses it completes, the next one is 429 `budget_exceeded`. Pinned by `TestTheBudgetIsASoftLimit` (Task 11).
4. A limiter that is down lets requests through and counts them; a store that is down refuses money checks with 503. Pinned by `TestALimiterFailureLetsTheRequestThrough` and `TestAStoreFailureRefusesTheMoneyCheck` (Task 9).
5. With keys required, `/health` answers without a key and `/v1/chat/completions` without a key is 401 and writes no usage row. Pinned by `TestHealthNeedsNoKey` and `TestAMissingKeyIsRefusedAndNotRecorded` (Task 13).

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `pipeline/middlewares/usage.go` | reserve before the call (N1) | 1 |
| `pipeline/refusal.go` | `RefusalError`, codes, `HTTPStatus`, `RetryAfter` | 2 |
| `pipeline/permanent.go` | `Permanent`, `IsPermanent` | 2 |
| `pipeline/builder.go` | refuse `Execute` with `Stream: true` | 2 |
| `pipeline/middlewares/identity.go` | `ErrInvalidIdentity` becomes a `RefusalError` | 2 |
| `pipeline/middlewares/retry.go` | stop on non-retryable errors | 2 |
| `pipeline/middlewares/provider_call.go` | wrap permanent errors | 2 |
| `guard/errors.go` | `BlockedError` reports `content_blocked`, 400 | 2 |
| `refusal.go` (root) | `type RefusalError = pipeline.RefusalError` | 2 |
| `key/key.go`, `key/errors.go`, `key/service_impl.go`, `key/options.go` | key semantics | 3, 4 |
| `store/memory_key.go`, `store/{sqlite,postgres,mongo}/store.go` | `FindByPrefix` slice, `TouchLastUsed`, usage reads | 3, 5 |
| `store/storetest/key_test.go`, `store/storetest/enforcement_test.go` | conformance | 3, 5 |
| `tenant/service_impl.go`, `tenant/options.go` | tenant events | 4 |
| `ratelimit/ratelimit.go`, `ratelimit/memory.go` | `Limiter`, `Decision`, memory | 6 |
| `ratelimit/redislimit/redis.go` | Redis limiter | 7 |
| `pipeline/context.go` | `WithScopes`, `Scopes` | 8 |
| `pipeline/middlewares/access.go` | access stage (40) | 8 |
| `pipeline/middlewares/quota.go` | quota stage (50) | 9 |
| `money/money.go` | `Ratio` | 9 |
| `pipeline/middlewares/stream_lifecycle.go` | default resolver, `QuotaError` as a refusal | 10 |
| `config.go`, `options.go`, `nexus.go`, `engine.go`, `extension/*` | wiring | 11 |
| `gateway_enforcement_test.go` | gateway-level enforcement tests | 11 |
| `auth/keyauth.go` | `RawKey`, `Authenticate`, `KeyAuth`, `RequireScope` | 12 |
| `api/*.go`, `proxy/*.go`, `httpstream/encoder.go` | protected routes, error mapping | 13 |
| docs site, spec hand-off | docs and hand-off | 14 |

---

### Task 1: Reserve the usage record before the call (N1)

**Files:**
- Modify: `pipeline/middlewares/usage.go` (`Process` at ~113-131, `record` at ~288-295, `usageRecordingStream.Close` at ~470-474)
- Test: `gateway_usage_test.go`, `pipeline/middlewares/usage_outcome_test.go`

**Interfaces:**
- Consumes: `reserve() bool`, `insert(rec)`, `drop(rec)`, `release()` (existing).
- Produces: `finish(rec *usage.Record, reserved bool)` (unexported); `record` is removed.

- [ ] **Step 1: Write the failing gateway test.** Append to `gateway_usage_test.go`:

```go
// gateProvider blocks every Complete until release is closed, and signals on
// entered when a call arrives.
type gateProvider struct {
	fakeProvider
	entered chan struct{}
	release chan struct{}
}

func (g *gateProvider) Complete(ctx context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	g.entered <- struct{}{}
	<-g.release
	return g.fakeProvider.Complete(ctx, req)
}

func TestShutdownWaitsForACompletionStillWithTheProvider(t *testing.T) {
	s := store.NewMemory()
	p := &gateProvider{fakeProvider: fakeProvider{name: "openai", price: listPrice}, entered: make(chan struct{}, 1), release: make(chan struct{})}
	gw := nexus.New(nexus.WithDatabase(s), nexus.WithProvider(p))
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := gw.Engine().Complete(context.Background(), &provider.CompletionRequest{Model: "gpt-4o", Messages: []provider.Message{{Role: "user", Content: "hi"}}})
		done <- err
	}()
	<-p.entered
	shut := make(chan error, 1)
	go func() { shut <- gw.Shutdown(context.Background()) }()
	// Shutdown must still be waiting: the completion is with the provider.
	select {
	case err := <-shut:
		t.Fatalf("Shutdown returned %v while a completion was in flight", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(p.release)
	if err := <-done; err != nil {
		t.Fatalf("complete: %v", err)
	}
	if err := <-shut; err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	res, err := s.Usage().Query(context.Background(), &usage.QueryOptions{Limit: 10})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(res.Items) != 1 || res.Items[0].Outcome != usage.OutcomeOK {
		t.Fatalf("records = %+v; the in-flight completion's record must be stored", res.Items)
	}
	if gw.UsageInsertErrors() != 0 {
		t.Fatalf("insert errors = %d, want 0", gw.UsageInsertErrors())
	}
}
```

If the file has no `time` import, add it.

- [ ] **Step 2: Run it and watch it fail.**

Run: `go test -race -run TestShutdownWaitsForACompletionStillWithTheProvider -v .`
Expected: FAIL with "Shutdown returned <nil> while a completion was in flight".

- [ ] **Step 3: Reserve first.** Replace `Process` and `record` in `pipeline/middlewares/usage.go`:

```go
func (m *UsageMiddleware) Process(ctx context.Context, req *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	if m.usage == nil {
		return next(ctx)
	}
	start := time.Now()
	// Reserve before the call, so a shutdown that starts while this request
	// is with the provider waits for its record. A request that arrives
	// after the stage closed is still served; its record is dropped and
	// counted.
	reserved := m.reserve()
	defer func() {
		if r := recover(); r != nil {
			if reserved {
				m.release()
			}
			panic(r)
		}
	}()
	resp, err := next(ctx)

	rec := m.newRecord(ctx, req, start)
	if err == nil && resp != nil && resp.Stream != nil {
		// The reservation moves to the stream and is released after its
		// record is stored, so a shutdown waits for a stream that is open.
		resp.Stream = &usageRecordingStream{inner: resp.Stream, mw: m, ctx: ctx, rec: rec, req: req, start: start, reserved: reserved}
		return resp, nil
	}
	rec.Latency = time.Since(start)
	m.classify(ctx, rec, req, resp, err)
	m.finish(rec, reserved)
	return resp, err
}

// finish stores rec on the reservation taken for it, or drops and counts it
// when the stage was already closed.
func (m *UsageMiddleware) finish(rec *usage.Record, reserved bool) {
	if reserved {
		m.insert(rec)
		return
	}
	m.drop(rec)
}
```

Delete `record`. In `usageRecordingStream.Close`, replace the closing `if s.reserved { s.mw.insert(rec) } else { s.mw.drop(rec) }` with `s.mw.finish(rec, s.reserved)`.

- [ ] **Step 4: Run the package tests.**

Run: `go test -race ./pipeline/middlewares/ . -run 'Usage|Shutdown|Record|Stream'`
Expected: PASS, including the new test and every slice 2 shutdown test.

- [ ] **Step 5: Commit.**

```bash
git commit --only -m "fix(nexus): reserve a usage record before the provider call

A completion still with the provider when Shutdown started reserved its
insert only after the call returned, found the stage closed, and lost its
record while Shutdown returned nil. The reservation now comes first, so
Shutdown waits for it." -- pipeline/middlewares/usage.go gateway_usage_test.go
git show --stat HEAD
```

---

### Task 2: One refusal type, and stop retrying what cannot succeed

**Files:**
- Modify: `pipeline/refusal.go`, `pipeline/builder.go` (`Execute` ~64-79), `pipeline/middlewares/identity.go` (~11-25), `pipeline/middlewares/usage.go` (refused branch ~195-202), `pipeline/middlewares/retry.go`, `pipeline/middlewares/provider_call.go` (~45, ~95, ~113, ~119), `guard/errors.go`
- Create: `pipeline/permanent.go`, `refusal.go` (root), `pipeline/refusal_test.go`, `pipeline/middlewares/retry_test.go`
- Test: `pipeline/middlewares/usage_outcome_test.go`

**Interfaces:**
- Produces:
  - `pipeline.RefusalError{Code string; Status int; Message string; Limit string; RetryAfter time.Duration; Unattributed bool; Cause error}` with `Error()`, `Unwrap()`, `RefusalCode()`, `StatusCode()`.
  - Constants `pipeline.CodeUnauthenticated`, `CodeForbidden`, `CodeInvalidRequest`, `CodeRateLimited`, `CodeQuotaExceeded`, `CodeBudgetExceeded`, `CodeUnavailable`, `CodeContentBlocked`.
  - `pipeline.HTTPStatus(err error) (status int, code string)`, `pipeline.RetryAfter(err error) time.Duration`.
  - `pipeline.Permanent(err error) error`, `pipeline.IsPermanent(err error) bool`.
  - `nexus.RefusalError` (alias).
  - `guard.BlockedError` gains `RefusalCode() string` ("content_blocked") and `StatusCode() int` (400).
  - `middlewares.ErrInvalidIdentity` is a `*pipeline.RefusalError` with `Unattributed: true`.

- [ ] **Step 1: Write the failing tests.** `pipeline/refusal_test.go`:

```go
package pipeline_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/xraph/nexus/pipeline"
)

func TestARefusalCarriesItsCodeStatusAndWait(t *testing.T) {
	r := &pipeline.RefusalError{Code: pipeline.CodeRateLimited, Status: 429, Message: "60 requests a minute", Limit: "60", RetryAfter: 12 * time.Second}
	wrapped := fmt.Errorf("quota stage: %w", r)
	status, code := pipeline.HTTPStatus(wrapped)
	if status != 429 || code != "rate_limited" {
		t.Fatalf("HTTPStatus = %d %q", status, code)
	}
	if got := pipeline.RetryAfter(wrapped); got != 12*time.Second {
		t.Fatalf("RetryAfter = %v", got)
	}
	if r.Error() != "nexus: 60 requests a minute" {
		t.Fatalf("Error() = %q", r.Error())
	}
	var asRefusal pipeline.Refusal
	if !errors.As(wrapped, &asRefusal) {
		t.Fatal("a RefusalError must satisfy pipeline.Refusal")
	}
}

func TestAnyOtherErrorIsAnInternalError(t *testing.T) {
	status, code := pipeline.HTTPStatus(errors.New("upstream 502"))
	if status != 500 || code != "internal_error" {
		t.Fatalf("HTTPStatus = %d %q", status, code)
	}
	if pipeline.RetryAfter(errors.New("x")) != 0 {
		t.Fatal("RetryAfter of a plain error must be 0")
	}
}

func TestPermanentSurvivesWrapping(t *testing.T) {
	base := errors.New("nexus: no providers registered")
	err := fmt.Errorf("call: %w", pipeline.Permanent(base))
	if !pipeline.IsPermanent(err) || !errors.Is(err, base) {
		t.Fatal("a wrapped permanent error must stay permanent and keep its cause")
	}
	if pipeline.IsPermanent(base) || pipeline.Permanent(nil) != nil {
		t.Fatal("only marked errors are permanent, and Permanent(nil) is nil")
	}
}

func TestExecuteRefusesAStreamRequest(t *testing.T) {
	b := pipeline.NewBuilder()
	b.Use(terminalStub{})
	svc, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.Execute(t.Context(), &provider.CompletionRequest{Model: "m", Stream: true})
	status, code := pipeline.HTTPStatus(err)
	if status != 400 || code != pipeline.CodeInvalidRequest {
		t.Fatalf("Execute with Stream = %v (%d %s); want invalid_request", err, status, code)
	}
}
```

Use the terminal test double the builder tests already have (`pipeline/builder_test.go`); if none is exported to `pipeline_test`, add `terminalStub` in this file implementing `Name`, `Priority`, `Process` (returns an empty `&pipeline.Response{}`) and `Terminal()`. Read `pipeline.Service` to confirm the method name (`Execute`) and adjust the import list (`provider`).

`pipeline/middlewares/retry_test.go`:

```go
package middlewares_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/nexus/guard"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
)

func TestRetryGivesUpOnWhatCannotSucceed(t *testing.T) {
	for name, fail := range map[string]error{
		"refusal":   &pipeline.RefusalError{Code: pipeline.CodeForbidden, Status: 403},
		"block":     &guard.BlockedError{Guard: "pii", Phase: guard.PhaseInput},
		"permanent": pipeline.Permanent(errors.New("nexus: no providers registered")),
		"canceled":  context.Canceled,
	} {
		calls := 0
		mw := middlewares.NewRetry(3, time.Millisecond, 1)
		_, err := mw.Process(context.Background(), &pipeline.Request{}, func(context.Context) (*pipeline.Response, error) {
			calls++
			return nil, fail
		})
		if calls != 1 || !errors.Is(err, fail) {
			t.Errorf("%s: calls = %d, err = %v; want one call and the same error", name, calls, err)
		}
	}
}

func TestRetryStillRetriesAProviderFailure(t *testing.T) {
	calls := 0
	mw := middlewares.NewRetry(2, time.Millisecond, 1)
	_, _ = mw.Process(context.Background(), &pipeline.Request{}, func(context.Context) (*pipeline.Response, error) {
		calls++
		return nil, errors.New("upstream 502")
	})
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}
}
```

In `pipeline/middlewares/usage_outcome_test.go`, add a case that a `*pipeline.RefusalError{Unattributed: true}` is recorded with no tenant and no key, and one with `Unattributed: false` keeps them. Follow the file's existing `runOnce` and `recordingUsage` helpers.

- [ ] **Step 2: Run and watch them fail** (`go test ./pipeline/ ./pipeline/middlewares/ -run 'Refusal|Internal|Permanent|Execute|Retry|Unattributed'`): undefined symbols.

- [ ] **Step 3: Implement.** Replace `pipeline/refusal.go`:

```go
package pipeline

import (
	"errors"
	"time"
)

// Refusal is an error a stage returns when it refuses a request before any
// provider is called: authentication, scopes, quotas, budgets. The usage
// stage records it as refused, at exactly $0, under RefusalCode.
type Refusal interface {
	error
	RefusalCode() string
	StatusCode() int
}

// Refusal codes. Each maps to one HTTP status at the edge.
const (
	CodeUnauthenticated = "unauthenticated" // 401
	CodeForbidden       = "forbidden"       // 403
	CodeInvalidRequest  = "invalid_request" // 400
	CodeRateLimited     = "rate_limited"    // 429
	CodeQuotaExceeded   = "quota_exceeded"  // 429
	CodeBudgetExceeded  = "budget_exceeded" // 429
	CodeUnavailable     = "unavailable"     // 503
	CodeContentBlocked  = "content_blocked" // 400, a guard block
)

// RefusalError is the refusal every Nexus stage returns. Limit names the
// limit that refused the request ("60" requests a minute, "10.00" USD), when
// there is one. RetryAfter is how long the caller should wait before the
// limit can let it through, zero when waiting will not help. Unattributed
// asks the usage stage to record the request under no tenant and no key:
// for identities that disagree, and for a tenant that does not exist.
type RefusalError struct {
	Code         string
	Status       int
	Message      string
	Limit        string
	RetryAfter   time.Duration
	Unattributed bool
	Cause        error
}

func (e *RefusalError) Error() string {
	if e.Message != "" {
		return "nexus: " + e.Message
	}
	return "nexus: " + e.Code
}

func (e *RefusalError) Unwrap() error       { return e.Cause }
func (e *RefusalError) RefusalCode() string { return e.Code }
func (e *RefusalError) StatusCode() int     { return e.Status }

var _ Refusal = (*RefusalError)(nil)

// HTTPStatus maps err to the status and code an HTTP edge should answer
// with: a refusal's own, or 500 internal_error for anything else.
func HTTPStatus(err error) (status int, code string) {
	var r Refusal
	if errors.As(err, &r) {
		return r.StatusCode(), r.RefusalCode()
	}
	return 500, "internal_error"
}

// RetryAfter is how long the refusal in err says to wait, or 0.
func RetryAfter(err error) time.Duration {
	var r *RefusalError
	if errors.As(err, &r) {
		return r.RetryAfter
	}
	return 0
}
```

`pipeline/permanent.go`:

```go
package pipeline

import "errors"

// Permanent marks err as one that a retry cannot fix: no provider is
// registered, routing found no candidate. The retry stage gives up on it.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err: err}
}

// IsPermanent reports whether err, or anything it wraps, was marked Permanent.
func IsPermanent(err error) bool {
	var p permanentError
	return errors.As(err, &p)
}

type permanentError struct{ err error }

func (p permanentError) Error() string { return p.err.Error() }
func (p permanentError) Unwrap() error { return p.err }
```

Root `refusal.go`:

```go
package nexus

import "github.com/xraph/nexus/pipeline"

// RefusalError is the typed refusal every enforcement stage returns. It
// lives in pipeline so stages can return it without importing this package.
type RefusalError = pipeline.RefusalError
```

`guard/errors.go`, append:

```go
// RefusalCode and StatusCode let an HTTP edge map a block to 400 the way it
// maps any other refusal. The usage stage still records it as blocked.
func (e *BlockedError) RefusalCode() string { return "content_blocked" }
func (e *BlockedError) StatusCode() int     { return 400 }
```

`pipeline/middlewares/identity.go`: replace the `invalidIdentityError` type and its methods with

```go
// ErrInvalidIdentity refuses a request whose tenant or key ids disagree or
// do not parse. It is recorded unattributed: charged to neither tenant.
var ErrInvalidIdentity error = &pipeline.RefusalError{
	Code:         pipeline.CodeInvalidRequest,
	Status:       400,
	Message:      "invalid tenant or key id",
	Unattributed: true,
}
```

The existing `fmt.Errorf("%w: ...", ErrInvalidIdentity, ...)` sites keep working; `errors.Is` matches the pointer.

`pipeline/middlewares/usage.go`, the refused branch becomes:

```go
	case errors.As(err, &refused):
		rec.Outcome, rec.RefusalCode, rec.StatusCode = usage.OutcomeRefused, refused.RefusalCode(), refused.StatusCode()
		notCharged(rec)
		// Some refusals are charged to no one: identities that disagree, a
		// tenant that does not exist.
		var re *pipeline.RefusalError
		if errors.As(err, &re) && re.Unattributed {
			rec.TenantID, rec.KeyID = id.TenantID{}, id.KeyID{}
		}
```

`pipeline/middlewares/retry.go`, inside the loop after `resp, err := next(ctx)`:

```go
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if !retryable(err) {
			return nil, err
		}
```

and add

```go
// retryable reports whether another attempt could succeed. A refusal or a
// guard block will refuse again, a permanent error will fail again, and a
// canceled or expired context has no time left.
func retryable(err error) bool {
	var refused pipeline.Refusal
	switch {
	case errors.As(err, &refused), pipeline.IsPermanent(err),
		errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return false
	}
	return true
}
```

(`guard.BlockedError` now satisfies `pipeline.Refusal`, so it is covered.)

`pipeline/middlewares/provider_call.go`: wrap with `pipeline.Permanent(...)` the four errors: `fmt.Errorf("nexus: unknown request type: %s", ...)`, `errors.New("nexus: no providers support embeddings")`, `errors.New("nexus: no providers registered")`, `fmt.Errorf("nexus: routing: %w", err)`. Provider call errors (`nexus: provider %s: %w`) stay retryable.

`pipeline/builder.go` `Execute`: before running the chain, refuse a stream:

```go
	if req.Stream {
		return nil, &RefusalError{Code: CodeInvalidRequest, Status: 400, Message: "a stream request needs CompleteStream"}
	}
```

Read `Execute` first; place this where `req` is known non-nil and before `Type` is set.

- [ ] **Step 4: Run the tests.**

Run: `go test -race ./pipeline/... ./guard/... . && go build -o /dev/null ./...`
Expected: PASS. `TestFailuresSayWhetherAProviderWasCalled` now finishes in milliseconds instead of 1.5s, because "no providers registered" is permanent. `TestARetriedRequestIsRecordedOnce` still takes about 1.5s.

- [ ] **Step 5: Commit.**

```bash
git add pipeline/permanent.go refusal.go pipeline/refusal_test.go pipeline/middlewares/retry_test.go
git commit --only -m "feat(nexus): one typed refusal, and no retries for what cannot succeed

RefusalError carries a code, a status, the limit and how long to wait.
Guard blocks map to 400. Retry gives up on refusals, blocks, a canceled
context and errors marked permanent, so a gateway with no provider fails at
once instead of after 1.5 seconds of backoff. Complete with Stream set is
refused instead of dropping the stream." -- pipeline/refusal.go pipeline/permanent.go pipeline/builder.go pipeline/middlewares/identity.go pipeline/middlewares/usage.go pipeline/middlewares/retry.go pipeline/middlewares/provider_call.go guard/errors.go refusal.go pipeline/refusal_test.go pipeline/middlewares/retry_test.go pipeline/middlewares/usage_outcome_test.go
git show --stat HEAD
```

---

### Task 3: Key stores find every key with a prefix, and touch one column

**Files:**
- Modify: `key/key.go` (Store interface ~78-86), `store/memory_key.go`, `store/sqlite/store.go` (~197-209), `store/postgres/store.go` (~189-201), `store/mongo/store.go` (~237-248), `key/service_impl.go` (only to compile: `Validate` takes the first element for now; Task 4 rewrites it)
- Create: `store/storetest/key_test.go`
- Modify: `store/storetest/conformance_test.go` (the `FindByPrefix` line in `TestMissingRowsAreErrNotFound`)

**Interfaces:**
- Produces on `key.Store`:
  - `FindByPrefix(ctx context.Context, prefix string) ([]*APIKey, error)`: every key with the prefix, any status, an empty slice and nil error when none.
  - `TouchLastUsed(ctx context.Context, id string, at time.Time) error`: sets only `last_used_at`; `key.ErrNotFound` when the key is missing.

- [ ] **Step 1: Write the failing conformance tests.** `store/storetest/key_test.go`:

```go
package storetest_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
)

func TestKeysSharingAPrefixAreAllFound(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		a, b := storetest.Key(tn.ID, "a"), storetest.Key(tn.ID, "b")
		b.Prefix = a.Prefix
		b.Status = key.KeyRevoked
		other := storetest.Key(tn.ID, "other")
		for _, k := range []*key.APIKey{a, b, other} {
			if err := s.Keys().Insert(ctx, k); err != nil {
				t.Fatalf("insert: %v", err)
			}
		}
		got, err := s.Keys().FindByPrefix(ctx, a.Prefix)
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("found %d keys for a shared prefix, want 2 (a revoked key is found too)", len(got))
		}
		seen := map[string]bool{}
		for _, k := range got {
			seen[k.ID.String()] = true
		}
		if !seen[a.ID.String()] || !seen[b.ID.String()] {
			t.Fatalf("found %v, want a and b", seen)
		}
	})
}

func TestAnUnknownPrefixFindsNothing(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		got, err := s.Keys().FindByPrefix(context.Background(), "nxs_00000000")
		if err != nil || len(got) != 0 {
			t.Fatalf("FindByPrefix(unknown) = %v, %v; want none and no error", got, err)
		}
	})
}

func TestTouchingAKeyNeverChangesItsStatus(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		k := storetest.Key(tn.ID, "k")
		if err := s.Keys().Insert(ctx, k); err != nil {
			t.Fatalf("insert: %v", err)
		}
		k.Status = key.KeyRevoked
		if err := s.Keys().Update(ctx, k); err != nil {
			t.Fatalf("revoke: %v", err)
		}
		at := storetest.Now().Add(time.Minute)
		if err := s.Keys().TouchLastUsed(ctx, k.ID.String(), at); err != nil {
			t.Fatalf("touch: %v", err)
		}
		got, err := s.Keys().FindByID(ctx, k.ID.String())
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		if got.Status != key.KeyRevoked {
			t.Fatalf("status after touch = %s, want revoked", got.Status)
		}
		if got.LastUsedAt == nil || !got.LastUsedAt.Equal(at) {
			t.Fatalf("last used = %v, want %v", got.LastUsedAt, at)
		}
		if err := s.Keys().TouchLastUsed(ctx, id.NewKeyID().String(), at); !errors.Is(err, key.ErrNotFound) {
			t.Fatalf("touch of a missing key = %v, want key.ErrNotFound", err)
		}
	})
}
```

In `TestMissingRowsAreErrNotFound`, the `FindByPrefix(ctx, "nxs_00000000")` assertion moves to `TestAnUnknownPrefixFindsNothing`; delete it there.

- [ ] **Step 2: Run them and watch them fail** (`go test ./store/storetest/ -run 'Prefix|Touch'` with the DB variables): compile errors.

- [ ] **Step 3: Implement.** `key/key.go` Store:

```go
	// FindByPrefix returns every key whose prefix is prefix, in any status.
	// Prefixes are not unique, so a caller must check the hash. None found
	// is an empty slice and a nil error.
	FindByPrefix(ctx context.Context, prefix string) ([]*APIKey, error)
	// TouchLastUsed sets only LastUsedAt, so it can never undo a concurrent
	// revoke. It returns ErrNotFound when the key does not exist.
	TouchLastUsed(ctx context.Context, id string, at time.Time) error
```

Memory (`store/memory_key.go`):

```go
func (s *memoryKeyStore) FindByPrefix(_ context.Context, prefix string) ([]*key.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*key.APIKey
	for _, k := range s.data {
		if k.Prefix == prefix {
			out = append(out, cloneKey(k))
		}
	}
	return out, nil
}

func (s *memoryKeyStore) TouchLastUsed(_ context.Context, keyID string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.data[keyID]
	if !ok {
		return key.ErrNotFound
	}
	t := at
	k.LastUsedAt = &t
	return nil
}
```

Postgres (SQLite is the same with `s.sdb` and `nexus/sqlite`):

```go
func (s *keyStore) FindByPrefix(ctx context.Context, prefix string) ([]*key.APIKey, error) {
	var models []apiKeyModel
	if err := s.pgdb.NewSelect(&models).Where("prefix = ?", prefix).Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/postgres: find keys by prefix: %w", err)
	}
	out := make([]*key.APIKey, 0, len(models))
	for i := range models {
		k, err := apiKeyFromModel(&models[i])
		if err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, nil
}

func (s *keyStore) TouchLastUsed(ctx context.Context, kid string, at time.Time) error {
	m := &apiKeyModel{ID: kid, LastUsedAt: &at}
	res, err := s.pgdb.NewUpdate(m).Column("last_used_at").WherePK().Exec(ctx)
	if err != nil {
		return fmt.Errorf("nexus/postgres: touch key: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return key.ErrNotFound
	}
	return nil
}
```

If `NewSelect(&models)` on an empty result returns `sql.ErrNoRows` in this grove version, treat it as an empty slice. Check how `ListByTenant` handles it. Check that `UpdateQuery.Column` exists in the pinned `pgdriver`/`sqlitedriver` v1.6.3 (`go doc github.com/xraph/grove/drivers/pgdriver.UpdateQuery.Column`). If it does not, use `Set("last_used_at = ?", at)` with `Where("id = ?", kid)`, and make sure SQLite stores the time the same way `apiKeyToModel` does, so `TestTouchingAKeyNeverChangesItsStatus`'s equality holds.

Mongo:

```go
func (s *keyStore) FindByPrefix(ctx context.Context, prefix string) ([]*key.APIKey, error) {
	var models []apiKeyModel
	if err := s.mdb.NewFind(&models).Filter(bson.M{"prefix": prefix}).Scan(ctx); err != nil && !isNoDocuments(err) {
		return nil, fmt.Errorf("nexus/mongo: find keys by prefix: %w", err)
	}
	out := make([]*key.APIKey, 0, len(models))
	for i := range models {
		k, err := apiKeyFromModel(&models[i])
		if err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, nil
}

func (s *keyStore) TouchLastUsed(ctx context.Context, kid string, at time.Time) error {
	res, err := s.mdb.Collection(colKeys).UpdateOne(ctx, bson.M{"_id": kid}, bson.M{"$set": bson.M{"last_used_at": at}})
	if err != nil {
		return fmt.Errorf("nexus/mongo: touch key: %w", err)
	}
	if res.MatchedCount == 0 {
		return key.ErrNotFound
	}
	return nil
}
```

Use the keys collection constant this file already uses (read the file for its name), and the multi-document find pattern that `ListByTenant` uses if `NewFind(&slice)` differs.

`key/service_impl.go` `Validate`, a temporary bridge until Task 4:

```go
	keys, err := s.store.FindByPrefix(ctx, prefix)
	if err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return nil, ErrNotFound
	}
	k := keys[0]
```

Grep for other `FindByPrefix` callers (`grep -rn 'FindByPrefix(' --include='*.go' .` from the repo root, `dashboard/` included) and adapt them.

- [ ] **Step 4: Run.**

Run (DB variables inline): `go test -race ./store/... ./key/... && go build -o /dev/null ./...`
Expected: PASS on memory, sqlite, postgres and mongo, none skipped.

- [ ] **Step 5: Commit.**

```bash
git add store/storetest/key_test.go
git commit --only -m "fix(store): find every key that shares a prefix, and touch only last_used_at

Prefixes are 32 random bits, so two keys can share one, and FindByPrefix
returned whichever row came first. It now returns every key with the
prefix in any status. TouchLastUsed updates one column, so recording use
can no longer write a revoked key back as active." -- key/key.go key/service_impl.go store/memory_key.go store/sqlite/store.go store/postgres/store.go store/mongo/store.go store/storetest/key_test.go store/storetest/conformance_test.go
git show --stat HEAD
```

---

### Task 4: Key and tenant services say what happened, and tell the hooks

**Files:**
- Modify: `key/key.go` (`CreateInput`, `Service`), `key/errors.go`, `key/service_impl.go`, `tenant/service_impl.go`, `nexus.go` (`Initialize` ~130-135)
- Create: `key/options.go`, `tenant/options.go`, `key/service_test.go`, `tenant/service_test.go`

**Interfaces:**
- Produces:
  - `key.ErrRevoked`, `key.ErrExpired`, `key.ErrInvalid` (every input validation error wraps it).
  - `key.CreateInput.ExpiresAt *time.Time`.
  - `key.Service.Get(ctx context.Context, id string) (*APIKey, error)`.
  - `key.NewService(store Store, opts ...Option) Service`, with `key.WithTenants(TenantFinder)`, `key.WithEvents(Events)` and `key.WithClock(func() time.Time)`.
  - `type key.TenantFinder interface{ FindByID(ctx context.Context, id string) (*tenant.Tenant, error) }`. `tenant.Store` satisfies it.
  - `type key.Events interface{ EmitKeyCreated(ctx context.Context, keyID id.KeyID, tenantID id.TenantID); EmitKeyRevoked(ctx context.Context, keyID id.KeyID) }`. `*plugin.Registry` satisfies it.
  - `tenant.NewService(store Store, opts ...Option) Service`, with `tenant.WithEvents(Events)`.
  - `type tenant.Events interface{ EmitTenantCreated(ctx context.Context, tenantID id.TenantID); EmitTenantDisabled(ctx context.Context, tenantID id.TenantID) }`.
  - Every key the service returns has its expiry derived: an active key whose `ExpiresAt` has passed reads `KeyExpired`.

- [ ] **Step 1: Write the failing tests.** `key/service_test.go` (package `key_test`, on `store.NewMemory()`):

```go
package key_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/tenant"
)

type events struct {
	mu      sync.Mutex
	created []id.KeyID
	revoked []id.KeyID
}

func (e *events) EmitKeyCreated(_ context.Context, k id.KeyID, _ id.TenantID) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.created = append(e.created, k)
}
func (e *events) EmitKeyRevoked(_ context.Context, k id.KeyID) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.revoked = append(e.revoked, k)
}

func setup(t *testing.T, now func() time.Time) (key.Service, *tenant.Tenant, store.Store, *events) {
	t.Helper()
	s := store.NewMemory()
	tn, err := tenant.NewService(s.Tenants()).Create(context.Background(), &tenant.CreateInput{Name: "Acme", Slug: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	ev := &events{}
	opts := []key.Option{key.WithTenants(s.Tenants()), key.WithEvents(ev)}
	if now != nil {
		opts = append(opts, key.WithClock(now))
	}
	return key.NewService(s.Keys(), opts...), tn, s, ev
}

func TestValidateFindsTheRightKeyAmongSharedPrefixes(t *testing.T) {
	svc, tn, s, _ := setup(t, nil)
	ctx := context.Background()
	a, rawA, err := svc.Create(ctx, &key.CreateInput{TenantID: tn.ID.String(), Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	// A second key whose raw value starts with a's 12-character prefix: a
	// real 32-bit collision, stored the way Create stores keys (hex SHA-256).
	rawB := a.Prefix + strings.Repeat("b", 56)
	sum := sha256.Sum256([]byte(rawB))
	b := &key.APIKey{ID: id.NewKeyID(), TenantID: tn.ID, Name: "b", Prefix: a.Prefix,
		Hash: hex.EncodeToString(sum[:]), Scopes: []string{"completions"}, Status: key.KeyActive, CreatedAt: time.Now()}
	if err := s.Keys().Insert(ctx, b); err != nil {
		t.Fatal(err)
	}
	for raw, want := range map[string]id.KeyID{rawA: a.ID, rawB: b.ID} {
		got, err := svc.Validate(ctx, raw)
		if err != nil || got.ID != want {
			t.Fatalf("validate = %v, %v; want %s", got, err, want)
		}
	}
	forged := a.Prefix + strings.Repeat("c", 56)
	if _, err := svc.Validate(ctx, forged); !errors.Is(err, key.ErrNotFound) {
		t.Fatalf("validate a forged key = %v, want ErrNotFound", err)
	}
}

func TestAnUnknownKeyAndAWrongKeyLookTheSame(t *testing.T) {
	svc, tn, _, _ := setup(t, nil)
	ctx := context.Background()
	_, raw, err := svc.Create(ctx, &key.CreateInput{TenantID: tn.ID.String(), Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	wrong := raw[:12] + strings.Repeat("0", len(raw)-12)
	for _, k := range []string{"nxs_ffffffff" + strings.Repeat("0", 56), wrong, "short", ""} {
		if _, err := svc.Validate(ctx, k); !errors.Is(err, key.ErrNotFound) {
			t.Errorf("Validate(%q...) = %v, want ErrNotFound", k[:min(len(k), 6)], err)
		}
	}
}

func TestRevokedAndExpiredAreReportedOnlyForTheRightKey(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	svc, tn, _, ev := setup(t, clock)
	ctx := context.Background()
	exp := now.Add(time.Hour)
	k, raw, err := svc.Create(ctx, &key.CreateInput{TenantID: tn.ID.String(), Name: "a", ExpiresAt: &exp})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	if _, err := svc.Validate(ctx, raw); !errors.Is(err, key.ErrExpired) {
		t.Fatalf("validate expired = %v", err)
	}
	got, err := svc.Get(ctx, k.ID.String())
	if err != nil || got.Status != key.KeyExpired {
		t.Fatalf("Get = %v, %v; an expired key reads expired without a background job", got, err)
	}
	k2, raw2, _ := svc.Create(ctx, &key.CreateInput{TenantID: tn.ID.String(), Name: "b"})
	if err := svc.Revoke(ctx, k2.ID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(ctx, raw2); !errors.Is(err, key.ErrRevoked) {
		t.Fatalf("validate revoked = %v", err)
	}
	if len(ev.created) != 2 || len(ev.revoked) != 1 || ev.revoked[0] != k2.ID {
		t.Fatalf("events created %v revoked %v", ev.created, ev.revoked)
	}
}

func TestLastUsedIsWrittenAtMostOnceAMinute(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	clock := func() time.Time { return now }
	svc, tn, s, _ := setup(t, clock)
	ctx := context.Background()
	k, raw, _ := svc.Create(ctx, &key.CreateInput{TenantID: tn.ID.String(), Name: "a"})
	if _, err := svc.Validate(ctx, raw); err != nil {
		t.Fatal(err)
	}
	first := now
	now = now.Add(30 * time.Second)
	_, _ = svc.Validate(ctx, raw)
	got, _ := s.Keys().FindByID(ctx, k.ID.String())
	if got.LastUsedAt == nil || !got.LastUsedAt.Equal(first) {
		t.Fatalf("last used = %v, want %v (no second write inside a minute)", got.LastUsedAt, first)
	}
	now = now.Add(31 * time.Second)
	_, _ = svc.Validate(ctx, raw)
	got, _ = s.Keys().FindByID(ctx, k.ID.String())
	if !got.LastUsedAt.Equal(now) {
		t.Fatalf("last used = %v, want %v", got.LastUsedAt, now)
	}
}

func TestCreateRefusesBadInputWithoutPanicking(t *testing.T) {
	svc, tn, _, _ := setup(t, nil)
	ctx := context.Background()
	past := time.Now().Add(-time.Minute)
	for name, in := range map[string]*key.CreateInput{
		"malformed tenant": {TenantID: "not-a-tenant", Name: "a"},
		"unknown tenant":   {TenantID: id.NewTenantID().String(), Name: "a"},
		"no name":          {TenantID: tn.ID.String()},
		"expired already":  {TenantID: tn.ID.String(), Name: "a", ExpiresAt: &past},
	} {
		if _, _, err := svc.Create(ctx, in); err == nil {
			t.Errorf("%s: created", name)
		}
	}
	if _, _, err := svc.Create(ctx, &key.CreateInput{TenantID: id.NewTenantID().String(), Name: "a"}); !errors.Is(err, tenant.ErrNotFound) {
		t.Errorf("unknown tenant = %v, want tenant.ErrNotFound", err)
	}
	if _, _, err := svc.Create(ctx, &key.CreateInput{TenantID: "nope", Name: "a"}); !errors.Is(err, key.ErrInvalid) {
		t.Errorf("malformed tenant = %v, want key.ErrInvalid", err)
	}
}

func TestRotateRevokesTheOldKeyAndKeepsTheName(t *testing.T) {
	svc, tn, _, _ := setup(t, nil)
	ctx := context.Background()
	old, oldRaw, _ := svc.Create(ctx, &key.CreateInput{TenantID: tn.ID.String(), Name: "indexer", Scopes: []string{"completions"}})
	n, newRaw, err := svc.Rotate(ctx, old.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	n2, _, err := svc.Rotate(ctx, n.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	if n2.Name != "indexer (rotated)" {
		t.Fatalf("name after two rotations = %q", n2.Name)
	}
	if _, err := svc.Validate(ctx, oldRaw); !errors.Is(err, key.ErrRevoked) {
		t.Fatalf("old key = %v", err)
	}
	if _, err := svc.Validate(ctx, newRaw); !errors.Is(err, key.ErrRevoked) {
		t.Fatalf("first rotation's key = %v, want revoked by the second", err)
	}
	if len(n2.Scopes) != 1 || n2.Scopes[0] != "completions" {
		t.Fatalf("scopes = %v", n2.Scopes)
	}
	if _, _, err := svc.Rotate(ctx, old.ID.String()); err == nil {
		t.Fatal("rotating a revoked key must fail")
	}
}
```

`tenant/service_test.go`: create a tenant (`EmitTenantCreated` once with its id). `SetStatus(disabled)` emits `EmitTenantDisabled` once. `SetStatus(suspended)` from disabled emits nothing. `SetStatus(active)` emits nothing. `SetStatus(suspended)` from active emits once.

- [ ] **Step 2: Run them and watch them fail** (`go test ./key/ ./tenant/`).

- [ ] **Step 3: Implement.**

`key/errors.go`:

```go
var (
	// ErrNotFound is returned for a key that does not exist, and by Validate
	// for any raw key that matches no stored hash, so a caller cannot tell
	// an unknown prefix from a wrong key.
	ErrNotFound = errors.New("nexus: api key not found")
	// ErrRevoked and ErrExpired are returned by Validate only for the right
	// raw key.
	ErrRevoked = errors.New("nexus: api key revoked")
	ErrExpired = errors.New("nexus: api key expired")
	// ErrInvalid wraps every input the service refuses.
	ErrInvalid = errors.New("nexus: invalid api key input")
)
```

`key/key.go`: correct the hash comment to `// SHA-256 of the raw key, hex (never exposed). The raw key carries 256 random bits, so an unsalted hash is enough.`, add `ExpiresAt *time.Time` to `CreateInput`, add `Get(ctx context.Context, id string) (*APIKey, error)` to `Service`, and change the `Rotate` doc to say it is not atomic across backends.

`key/options.go`:

```go
package key

import (
	"context"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/tenant"
)

// TenantFinder lets Create check that a key's tenant exists. tenant.Store
// satisfies it.
type TenantFinder interface {
	FindByID(ctx context.Context, id string) (*tenant.Tenant, error)
}

// Events receives key lifecycle events. *plugin.Registry satisfies it.
type Events interface {
	EmitKeyCreated(ctx context.Context, keyID id.KeyID, tenantID id.TenantID)
	EmitKeyRevoked(ctx context.Context, keyID id.KeyID)
}

// Option configures the key service.
type Option func(*service)

// WithTenants makes Create refuse a key for a tenant that does not exist.
func WithTenants(t TenantFinder) Option { return func(s *service) { s.tenants = t } }

// WithEvents reports created and revoked keys.
func WithEvents(e Events) Option { return func(s *service) { s.events = e } }

// WithClock replaces time.Now, for tests.
func WithClock(now func() time.Time) Option { return func(s *service) { s.now = now } }
```

`key/service_impl.go`, the rewritten methods (keep `hashKey` and the key format):

```go
type service struct {
	store   Store
	tenants TenantFinder
	events  Events
	now     func() time.Time
}

func NewService(store Store, opts ...Option) Service {
	s := &service{store: store, now: time.Now}
	for _, o := range opts {
		o(s)
	}
	return s
}

// derive reports an active key whose expiry has passed as expired.
func (s *service) derive(k *APIKey) *APIKey {
	if k != nil && k.Status == KeyActive && k.ExpiresAt != nil && !k.ExpiresAt.After(s.now()) {
		k.Status = KeyExpired
	}
	return k
}

func (s *service) Create(ctx context.Context, input *CreateInput) (*APIKey, string, error) {
	if input == nil || input.Name == "" {
		return nil, "", fmt.Errorf("%w: name is required", ErrInvalid)
	}
	tid, err := id.ParseTenantID(input.TenantID)
	if err != nil {
		return nil, "", fmt.Errorf("%w: tenant id: %v", ErrInvalid, err)
	}
	if input.ExpiresAt != nil && !input.ExpiresAt.After(s.now()) {
		return nil, "", fmt.Errorf("%w: expires_at is in the past", ErrInvalid)
	}
	if s.tenants != nil {
		if _, err := s.tenants.FindByID(ctx, tid.String()); err != nil {
			return nil, "", fmt.Errorf("nexus: key for tenant %s: %w", tid, err)
		}
	}
	rawBytes := make([]byte, 32)
	if _, err := rand.Read(rawBytes); err != nil {
		return nil, "", fmt.Errorf("nexus: generate key: %w", err)
	}
	rawKey := "nxs_" + hex.EncodeToString(rawBytes)
	scopes := input.Scopes
	if len(scopes) == 0 {
		scopes = []string{"completions", "embeddings", "models"}
	}
	k := &APIKey{
		ID:        id.NewKeyID(),
		TenantID:  tid,
		Name:      input.Name,
		Prefix:    rawKey[:12],
		Hash:      hashKey(rawKey),
		Scopes:    scopes,
		Status:    KeyActive,
		ExpiresAt: input.ExpiresAt,
		Metadata:  input.Metadata,
		CreatedAt: s.now(),
	}
	if k.Metadata == nil {
		k.Metadata = map[string]string{}
	}
	if err := s.store.Insert(ctx, k); err != nil {
		return nil, "", err
	}
	if s.events != nil {
		s.events.EmitKeyCreated(ctx, k.ID, k.TenantID)
	}
	return k, rawKey, nil
}

func (s *service) Validate(ctx context.Context, rawKey string) (*APIKey, error) {
	if len(rawKey) < 12 {
		return nil, ErrNotFound
	}
	candidates, err := s.store.FindByPrefix(ctx, rawKey[:12])
	if err != nil {
		return nil, err
	}
	want := []byte(hashKey(rawKey))
	var match *APIKey
	// Compare against every candidate, in constant time, and keep going
	// after a match, so timing says nothing about which key matched.
	for _, k := range candidates {
		if subtle.ConstantTimeCompare([]byte(k.Hash), want) == 1 {
			match = k
		}
	}
	if match == nil {
		return nil, ErrNotFound
	}
	s.derive(match)
	switch match.Status {
	case KeyRevoked:
		return nil, ErrRevoked
	case KeyExpired:
		return nil, ErrExpired
	}
	now := s.now()
	if match.LastUsedAt == nil || now.Sub(*match.LastUsedAt) >= time.Minute {
		// Best effort: a failed touch must not refuse a valid key.
		if err := s.store.TouchLastUsed(ctx, match.ID.String(), now); err == nil {
			match.LastUsedAt = &now
		}
	}
	return match, nil
}

func (s *service) Get(ctx context.Context, keyID string) (*APIKey, error) {
	k, err := s.store.FindByID(ctx, keyID)
	if err != nil {
		return nil, err
	}
	return s.derive(k), nil
}

func (s *service) Revoke(ctx context.Context, keyID string) error {
	k, err := s.store.FindByID(ctx, keyID)
	if err != nil {
		return err
	}
	if k.Status == KeyRevoked {
		return nil
	}
	k.Status = KeyRevoked
	if err := s.store.Update(ctx, k); err != nil {
		return err
	}
	if s.events != nil {
		s.events.EmitKeyRevoked(ctx, k.ID)
	}
	return nil
}

func (s *service) List(ctx context.Context, tenantID string) ([]*APIKey, error) {
	keys, err := s.store.ListByTenant(ctx, tenantID)
	for _, k := range keys {
		s.derive(k)
	}
	return keys, err
}

const rotatedSuffix = " (rotated)"

// Rotate creates a replacement for an active key and revokes the old one.
// It is not atomic across backends: if the revoke fails, the new key is
// revoked too (best effort) and the error is returned, so no key the caller
// never saw is left active.
func (s *service) Rotate(ctx context.Context, oldKeyID string) (*APIKey, string, error) {
	old, err := s.Get(ctx, oldKeyID)
	if err != nil {
		return nil, "", fmt.Errorf("nexus: old key: %w", err)
	}
	if old.Status != KeyActive {
		return nil, "", fmt.Errorf("%w: only an active key can be rotated (this one is %s)", ErrInvalid, old.Status)
	}
	n, raw, err := s.Create(ctx, &CreateInput{
		TenantID:  old.TenantID.String(),
		Name:      strings.TrimSuffix(old.Name, rotatedSuffix) + rotatedSuffix,
		Scopes:    old.Scopes,
		ExpiresAt: old.ExpiresAt,
		Metadata:  old.Metadata,
	})
	if err != nil {
		return nil, "", err
	}
	if err := s.Revoke(ctx, old.ID.String()); err != nil {
		_ = s.Revoke(ctx, n.ID.String())
		return nil, "", fmt.Errorf("nexus: revoke the rotated key: %w", err)
	}
	return n, raw, nil
}
```

Imports: add `crypto/subtle`, `strings`, `errors` if still used.

`tenant/options.go`:

```go
package tenant

import (
	"context"

	"github.com/xraph/nexus/id"
)

// Events receives tenant lifecycle events. *plugin.Registry satisfies it.
type Events interface {
	EmitTenantCreated(ctx context.Context, tenantID id.TenantID)
	EmitTenantDisabled(ctx context.Context, tenantID id.TenantID)
}

// Option configures the tenant service.
type Option func(*service)

// WithEvents reports created tenants, and tenants that leave active.
func WithEvents(e Events) Option { return func(s *service) { s.events = e } }
```

`tenant/service_impl.go`: add `events Events` to `service`; make `NewService(store Store, opts ...Option) Service` apply the options; after a successful `Insert` in `Create`, call `s.events.EmitTenantCreated(ctx, t.ID)` when events is set. In `SetStatus`, remember `was := t.Status` and after a successful `Update`, emit `EmitTenantDisabled` when `was == StatusActive && status != StatusActive`.

`nexus.go` `Initialize`:

```go
	if gw.tenant == nil {
		gw.tenant = tenant.NewService(gw.store.Tenants(), tenant.WithEvents(gw.extensions))
	}
	if gw.key == nil {
		gw.key = key.NewService(gw.store.Keys(), key.WithTenants(gw.store.Tenants()), key.WithEvents(gw.extensions))
	}
```

`gw.extensions` is a `*plugin.Registry`. If it can be nil here, guard both (`var ke key.Events; if gw.extensions != nil { ke = gw.extensions }`), so you never store a typed-nil interface.

- [ ] **Step 4: Run.**

Run (DB variables inline): `go test -race ./key/ ./tenant/ ./store/... . && go build -o /dev/null ./... && go vet ./_examples/multi-tenant/`
Expected: PASS. Existing gateway tests that call `Keys().Create` with a random tenant id now fail with `tenant.ErrNotFound`. There should be none, because slice 2's tests set ids on requests and not through the key service; fix any you find by creating the tenant first.

- [ ] **Step 5: Commit.**

```bash
git add key/options.go tenant/options.go key/service_test.go tenant/service_test.go
git commit --only -m "fix(key): validate in constant time, derive expiry, and say why a key failed

Validate checks every key that shares a prefix, answers an unknown prefix
and a wrong key the same way, and reports revoked or expired only for the
right key. An expired key reads expired without a background job. Create
refuses a bad tenant id instead of panicking and checks the tenant exists.
Rotate no longer stacks its suffix and does not leave an unseen key active
when the revoke fails. Key and tenant changes now reach the hooks." -- key/key.go key/errors.go key/options.go key/service_impl.go key/service_test.go tenant/options.go tenant/service_impl.go tenant/service_test.go nexus.go
git show --stat HEAD
```

---

### Task 5: Usage reads that enforcement can trust

**Files:**
- Modify: `store/postgres/store.go` (`MonthlySpend` ~298, `DailyRequests` ~318), `store/sqlite/store.go` (~306, ~334), `store/mongo/store.go` (`DailyRequests` ~382), `store/memory_usage.go` (`DailyRequests` ~59), `usage/usage.go` (doc on the two interface methods)
- Create: `store/storetest/enforcement_test.go`

**Interfaces:**
- Produces: `DailyRequests(ctx, tenantID)` counts every record since midnight UTC except `refused` ones. Postgres and SQLite build the tenant clause only when `tenantID != ""`.

- [ ] **Step 1: Write the failing conformance test.**

```go
package storetest_test

import (
	"context"
	"testing"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

func TestDailyRequestsLeaveOutRefusals(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		ok := storetest.Record(tn.ID, "0.01")
		blocked := storetest.Record(tn.ID, "")
		blocked.Outcome = usage.OutcomeBlocked
		refused := storetest.Record(tn.ID, "")
		refused.Outcome, refused.PricingStatus, refused.RefusalCode, refused.StatusCode = usage.OutcomeRefused, usage.PricingNotCharged, "rate_limited", 429
		zero := money0()
		refused.CostUSD = &zero
		for _, r := range []*usage.Record{ok, blocked, refused} {
			storetest.InsertRecord(t, s, r)
		}
		n, err := s.Usage().DailyRequests(ctx, tn.ID.String())
		if err != nil {
			t.Fatal(err)
		}
		if n != 2 {
			t.Fatalf("daily requests = %d, want 2: a refused request must not use up the quota that refused it", n)
		}
		all, err := s.Usage().DailyRequests(ctx, "")
		if err != nil || all != 2 {
			t.Fatalf("every tenant = %d, %v; want 2", all, err)
		}
		other, err := s.Usage().DailyRequests(ctx, id.NewTenantID().String())
		if err != nil || other != 0 {
			t.Fatalf("another tenant = %d, %v; want 0", other, err)
		}
	})
}
```

Define `money0()` as `money.Zero` (import `money`), or set `refused.CostUSD = &money.Zero` through a local copy. `refused` must look the way the usage stage writes it: `not_charged` and exactly `$0`.

- [ ] **Step 2: Run it and watch it fail** (DB variables inline): `got 3, want 2` on every backend.

- [ ] **Step 3: Implement.** Postgres:

```go
func (s *usageStore) DailyRequests(ctx context.Context, tenantID string) (int, error) {
	since, err := usage.PeriodStart("day", time.Now())
	if err != nil {
		return 0, err
	}
	q := `SELECT COUNT(*) FROM nexus_usage_records WHERE created_at >= $1 AND outcome <> 'refused'`
	args := []any{since}
	if tenantID != "" {
		q += ` AND tenant_id = $2`
		args = append(args, tenantID)
	}
	var count int
	if err := s.pgdb.QueryRow(ctx, q, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("nexus/postgres: daily requests: %w", err)
	}
	return count, nil
}
```

`MonthlySpend` gets the same conditional tenant clause, without the outcome filter: a refusal is `$0` and adds nothing. SQLite is the same shape with `?` placeholders, `conv.TimeText(since)` and its existing Go-side sum in `MonthlySpend`. Mongo: `DailyRequests` uses `m := tenantMatch(tenantID, since); m["outcome"] = bson.M{"$ne": "refused"}`. Memory `DailyRequests`: count records from `inWindow` whose `Outcome != usage.OutcomeRefused`.

Update the `usage.Service`/`Store` doc for `DailyRequests`: "counts every request recorded since midnight UTC except refused ones, so refusals never use up the quota".

- [ ] **Step 4: Run** (DB variables inline): `go test -race ./store/... ./usage/...`. Expected: PASS on all four backends.

- [ ] **Step 5: Commit.**

```bash
git add store/storetest/enforcement_test.go
git commit --only -m "fix(store): leave refusals out of the daily count, and let the tenant index work

DailyRequests counted refused requests, so a tenant held at its rate limit
used up its daily quota on the refusals. The Postgres and SQLite queries
now add the tenant clause only when there is a tenant, so a prepared plan
can use the tenant index." -- store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/memory_usage.go usage/usage.go store/storetest/enforcement_test.go
git show --stat HEAD
```

---

### Task 6: The limiter interface and the memory limiter

**Files:**
- Create: `ratelimit/ratelimit.go`, `ratelimit/memory.go`, `ratelimit/memory_test.go`

**Interfaces:**
- Produces:

```go
type Decision struct {
	Allowed    bool          // the window was within limit before the charge
	Count      int64         // the window's count after the charge
	RetryAfter time.Duration // until the window ends
}
type Limiter interface {
	Allow(ctx context.Context, key string, n, limit int64, window time.Duration) (Decision, error)
	Kind() string // "memory" | "redis"
}
func NewMemory(opts ...MemoryOption) *Memory
func WithClock(now func() time.Time) MemoryOption
```

- [ ] **Step 1: Write the failing tests.** `ratelimit/memory_test.go`:

```go
package ratelimit_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/xraph/nexus/ratelimit"
)

func TestFixedWindowAllowsUpToTheLimitThenRefuses(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 10, 0, time.UTC)
	l := ratelimit.NewMemory(ratelimit.WithClock(func() time.Time { return now }))
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		d, err := l.Allow(ctx, "rpm:t", 1, 3, time.Minute)
		if err != nil || !d.Allowed {
			t.Fatalf("request %d = %+v, %v", i+1, d, err)
		}
	}
	d, _ := l.Allow(ctx, "rpm:t", 1, 3, time.Minute)
	if d.Allowed || d.RetryAfter != 50*time.Second {
		t.Fatalf("fourth = %+v, want refused with 50s left in the window", d)
	}
	now = now.Add(50 * time.Second) // the next window
	if d, _ := l.Allow(ctx, "rpm:t", 1, 3, time.Minute); !d.Allowed || d.Count != 1 {
		t.Fatalf("new window = %+v", d)
	}
}

func TestAZeroChargeChecksWithoutCounting(t *testing.T) {
	l := ratelimit.NewMemory()
	ctx := context.Background()
	if d, _ := l.Allow(ctx, "tpm:t", 0, 100, time.Minute); !d.Allowed || d.Count != 0 {
		t.Fatalf("check = %+v", d)
	}
	_, _ = l.Allow(ctx, "tpm:t", 150, 100, time.Minute) // a big request finishing
	if d, _ := l.Allow(ctx, "tpm:t", 0, 100, time.Minute); d.Allowed {
		t.Fatalf("after 150 of 100 tokens, check = %+v; want refused", d)
	}
}

func TestKeysAreIndependentAndSafeConcurrently(t *testing.T) {
	l := ratelimit.NewMemory()
	ctx := context.Background()
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d, _ := l.Allow(ctx, "rpm:a", 1, 50, time.Minute); d.Allowed {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if allowed != 50 {
		t.Fatalf("allowed %d of 200 against a limit of 50", allowed)
	}
	if d, _ := l.Allow(ctx, "rpm:b", 1, 50, time.Minute); !d.Allowed {
		t.Fatal("another key must have its own window")
	}
	if l.Kind() != "memory" {
		t.Fatal(l.Kind())
	}
}
```

- [ ] **Step 2: Run them and watch them fail** (`go test -race ./ratelimit/`).

- [ ] **Step 3: Implement.** `ratelimit/ratelimit.go`:

```go
// Package ratelimit counts requests and tokens in fixed windows for the
// quota stage's RPM and TPM checks.
package ratelimit

import (
	"context"
	"time"
)

// Decision is what Allow decided.
type Decision struct {
	// Allowed reports whether the window was within limit before this
	// charge. A charge of 0 checks without counting.
	Allowed bool
	// Count is the window's count after the charge.
	Count int64
	// RetryAfter is the time left in the window.
	RetryAfter time.Duration
}

// Limiter charges n against key's current fixed window of the given size.
// It always charges, even when it refuses, so a client that keeps retrying
// inside a window stays refused until the window ends.
type Limiter interface {
	Allow(ctx context.Context, key string, n, limit int64, window time.Duration) (Decision, error)
	Kind() string
}
```

`ratelimit/memory.go`:

```go
package ratelimit

import (
	"context"
	"sync"
	"time"
)

// Memory is the default limiter. Its windows live in this process, so with
// several replicas each one allows the full limit.
type Memory struct {
	mu      sync.Mutex
	now     func() time.Time
	windows map[string]*memWindow
}

type memWindow struct {
	start time.Time
	count int64
}

// MemoryOption configures Memory.
type MemoryOption func(*Memory)

// WithClock replaces time.Now, for tests.
func WithClock(now func() time.Time) MemoryOption { return func(m *Memory) { m.now = now } }

// NewMemory returns an in-process limiter.
func NewMemory(opts ...MemoryOption) *Memory {
	m := &Memory{now: time.Now, windows: map[string]*memWindow{}}
	for _, o := range opts {
		o(m)
	}
	return m
}

// sweepAt is how many windows Memory holds before it drops ended ones.
const sweepAt = 10000

func (m *Memory) Allow(_ context.Context, key string, n, limit int64, window time.Duration) (Decision, error) {
	now := m.now()
	start := now.Truncate(window)
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.windows) >= sweepAt {
		for k, w := range m.windows {
			if w.start.Add(window).Before(now) {
				delete(m.windows, k)
			}
		}
	}
	w := m.windows[key]
	if w == nil || !w.start.Equal(start) {
		w = &memWindow{start: start}
		m.windows[key] = w
	}
	before := w.count
	w.count += n
	return Decision{Allowed: before < limit, Count: w.count, RetryAfter: start.Add(window).Sub(now)}, nil
}

func (m *Memory) Kind() string { return "memory" }

var _ Limiter = (*Memory)(nil)
```

- [ ] **Step 4: Run** `go test -race ./ratelimit/`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add ratelimit/ratelimit.go ratelimit/memory.go ratelimit/memory_test.go
git commit --only -m "feat(ratelimit): a fixed-window limiter interface and an in-process limiter" -- ratelimit/ratelimit.go ratelimit/memory.go ratelimit/memory_test.go
git show --stat HEAD
```

---

### Task 7: The Redis limiter

**Files:**
- Create: `ratelimit/redislimit/redis.go`, `ratelimit/redislimit/redis_test.go`
- Modify: `go.mod` (go-redis from indirect to direct), plus a `GOWORK=off go mod tidy` chore in any nested module that needs it

**Interfaces:**
- Produces: `redislimit.New(c redis.UniversalClient, opts ...Option) *Limiter`, `redislimit.WithPrefix(p string) Option` (default `"nexus:rl:"`), `redislimit.WithClock(func() time.Time) Option`. `Kind()` returns `"redis"`.

- [ ] **Step 1: Write the failing test** (skips without `NEXUS_TEST_REDIS_ADDR`, like the other store tests):

```go
package redislimit_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/ratelimit/redislimit"
)

func client(t *testing.T) redis.UniversalClient {
	t.Helper()
	addr := os.Getenv("NEXUS_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("NEXUS_TEST_REDIS_ADDR not set")
	}
	c := redis.NewClient(&redis.Options{Addr: addr})
	t.Cleanup(func() { _ = c.Close() })
	if err := c.Ping(context.Background()).Err(); err != nil {
		t.Fatalf("redis at %s: %v", addr, err)
	}
	return c
}

func TestRedisWindowMatchesTheMemoryOne(t *testing.T) {
	c := client(t)
	now := time.Date(2026, 10, 7, 12, 0, 10, 0, time.UTC)
	prefix := "nexus:test:" + id.NewRequestID().String() + ":"
	l := redislimit.New(c, redislimit.WithPrefix(prefix), redislimit.WithClock(func() time.Time { return now }))
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if d, err := l.Allow(ctx, "rpm:t", 1, 3, time.Minute); err != nil || !d.Allowed {
			t.Fatalf("request %d = %+v, %v", i+1, d, err)
		}
	}
	d, err := l.Allow(ctx, "rpm:t", 1, 3, time.Minute)
	if err != nil || d.Allowed || d.RetryAfter != 50*time.Second || d.Count != 4 {
		t.Fatalf("fourth = %+v, %v", d, err)
	}
	ttl, err := c.PTTL(ctx, prefix+"rpm:t:"+"1791460800000").Result()
	if err != nil || ttl <= 0 {
		t.Fatalf("window key ttl = %v, %v; every window key must expire", ttl, err)
	}
	now = now.Add(50 * time.Second)
	if d, _ := l.Allow(ctx, "rpm:t", 1, 3, time.Minute); !d.Allowed || d.Count != 1 {
		t.Fatalf("new window = %+v", d)
	}
	if l.Kind() != "redis" {
		t.Fatal(l.Kind())
	}
}

func TestAnUnreachableRedisIsAnError(t *testing.T) {
	c := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", DialTimeout: 100 * time.Millisecond, MaxRetries: -1})
	t.Cleanup(func() { _ = c.Close() })
	if _, err := redislimit.New(c).Allow(context.Background(), "k", 1, 1, time.Minute); err == nil {
		t.Fatal("Allow against an unreachable redis must return an error, so the quota stage can let the request through and count it")
	}
}
```

`1791460800000` is `time.Date(2026,10,7,12,0,0,0,UTC).UnixMilli()`. Compute it in the test with `now.Truncate(time.Minute).UnixMilli()` rather than trusting the literal.

- [ ] **Step 2: Make go-redis direct and watch the test fail.** `go get github.com/redis/go-redis/v9@v9.21.0`, then `go test ./ratelimit/redislimit/` with `NEXUS_TEST_REDIS_ADDR` inline. It fails: package not found.

- [ ] **Step 3: Implement** `ratelimit/redislimit/redis.go`:

```go
// Package redislimit is a ratelimit.Limiter whose windows live in Redis, so
// every replica shares them.
package redislimit

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/xraph/nexus/ratelimit"
)

// allow adds ARGV[1] to the window key, sets its expiry the first time, and
// returns the new count.
var allow = redis.NewScript(`
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return n
`)

// Limiter is a Redis-backed fixed-window limiter.
type Limiter struct {
	c      redis.UniversalClient
	prefix string
	now    func() time.Time
}

// Option configures the limiter.
type Option func(*Limiter)

// WithPrefix sets the key prefix (default "nexus:rl:").
func WithPrefix(p string) Option { return func(l *Limiter) { l.prefix = p } }

// WithClock replaces time.Now, for tests.
func WithClock(now func() time.Time) Option { return func(l *Limiter) { l.now = now } }

// New returns a limiter on c. Windows are aligned to the clock of the replica
// that charges them, so keep replica clocks in sync.
func New(c redis.UniversalClient, opts ...Option) *Limiter {
	l := &Limiter{c: c, prefix: "nexus:rl:", now: time.Now}
	for _, o := range opts {
		o(l)
	}
	return l
}

func (l *Limiter) Allow(ctx context.Context, key string, n, limit int64, window time.Duration) (ratelimit.Decision, error) {
	now := l.now()
	start := now.Truncate(window)
	k := l.prefix + key + ":" + strconv.FormatInt(start.UnixMilli(), 10)
	count, err := allow.Run(ctx, l.c, []string{k}, n, window.Milliseconds()+1000).Int64()
	if err != nil {
		return ratelimit.Decision{}, err
	}
	return ratelimit.Decision{Allowed: count-n < limit, Count: count, RetryAfter: start.Add(window).Sub(now)}, nil
}

func (l *Limiter) Kind() string { return "redis" }

var _ ratelimit.Limiter = (*Limiter)(nil)
```

- [ ] **Step 4: Run** with the Redis container: `NEXUS_TEST_REDIS_ADDR=localhost:56379 go test -race ./ratelimit/...`. Expected: PASS, not skipped. Then run the `GOWORK=off go vet ./...` loop over `providers/*/`, `grpcsrv` and `_examples/grpc`. If any fails with a missing go.sum entry, run `GOWORK=off go mod tidy` in that module and commit it separately (`chore: tidy nested modules for go-redis`).

- [ ] **Step 5: Commit.**

```bash
git add ratelimit/redislimit/redis.go ratelimit/redislimit/redis_test.go
git commit --only -m "feat(ratelimit): a Redis limiter so replicas share RPM and TPM windows" -- go.mod go.sum ratelimit/redislimit/redis.go ratelimit/redislimit/redis_test.go
git show --stat HEAD
```

---

### Task 8: The access stage (priority 40)

**Files:**
- Modify: `pipeline/context.go`
- Create: `pipeline/middlewares/access.go`, `pipeline/middlewares/access_test.go`

**Interfaces:**
- Consumes: `tenant.Service.Get`, `key.Service.Get` (Task 4), `pipeline.RefusalError` (Task 2).
- Produces:
  - `pipeline.WithScopes(ctx context.Context, scopes []string) context.Context`, `pipeline.Scopes(ctx context.Context) ([]string, bool)`.
  - `middlewares.NewAccess(tenants TenantGetter, keys KeyGetter) *AccessMiddleware` (name "access", priority 40), with `TenantGetter interface{ Get(ctx, id string) (*tenant.Tenant, error) }` and `KeyGetter interface{ Get(ctx, id string) (*key.APIKey, error) }`.
  - `middlewares.TenantFromContext(ctx context.Context) (*tenant.Tenant, bool)`.

- [ ] **Step 1: Write the failing tests.** `pipeline/middlewares/access_test.go` (package `middlewares_test`; reuse `runOnce` if its signature fits, otherwise call `Process` directly with a `next` that records the context it got):

```go
package middlewares_test

import (
	"context"
	"testing"

	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/tenant"
)

type accessFixture struct {
	mw      *middlewares.AccessMiddleware
	tenants tenant.Service
	keys    key.Service
	active  *tenant.Tenant
}

func newAccessFixture(t *testing.T) *accessFixture {
	t.Helper()
	s := store.NewMemory()
	ts := tenant.NewService(s.Tenants())
	ks := key.NewService(s.Keys(), key.WithTenants(s.Tenants()))
	tn, err := ts.Create(context.Background(), &tenant.CreateInput{Name: "Acme", Slug: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	return &accessFixture{mw: middlewares.NewAccess(ts, ks), tenants: ts, keys: ks, active: tn}
}

func (f *accessFixture) run(ctx context.Context, typ pipeline.RequestType) (context.Context, error) {
	var seen context.Context
	req := &pipeline.Request{Type: typ, Completion: &provider.CompletionRequest{Model: "m"}, State: map[string]any{}}
	if typ == pipeline.RequestEmbedding {
		req.Completion, req.Embedding = nil, &provider.EmbeddingRequest{Model: "e"}
	}
	_, err := f.mw.Process(ctx, req, func(c context.Context) (*pipeline.Response, error) {
		seen = c
		return &pipeline.Response{}, nil
	})
	return seen, err
}

func code(err error) string { _, c := pipeline.HTTPStatus(err); return c }

func TestAnActiveTenantPassesAndIsPublished(t *testing.T) {
	f := newAccessFixture(t)
	seen, err := f.run(pipeline.WithTenantID(context.Background(), f.active.ID.String()), pipeline.RequestCompletion)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := middlewares.TenantFromContext(seen)
	if !ok || got.ID != f.active.ID {
		t.Fatal("the tenant must be in the context for the quota stage")
	}
}

func TestADisabledOrUnknownTenantIsForbidden(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	_ = f.tenants.SetStatus(ctx, f.active.ID.String(), tenant.StatusSuspended)
	if _, err := f.run(pipeline.WithTenantID(ctx, f.active.ID.String()), pipeline.RequestCompletion); code(err) != pipeline.CodeForbidden {
		t.Fatalf("suspended = %v", err)
	}
	_, err := f.run(pipeline.WithTenantID(ctx, "tenant_01jz0000000000000000000000"), pipeline.RequestCompletion)
	var re *pipeline.RefusalError
	if !errorsAs(err, &re) || re.Code != pipeline.CodeForbidden || !re.Unattributed {
		t.Fatalf("unknown tenant = %v; want forbidden and unattributed", err)
	}
}

func TestScopesComeFromTheEdgeOrTheKey(t *testing.T) {
	f := newAccessFixture(t)
	ctx := pipeline.WithTenantID(context.Background(), f.active.ID.String())
	k, _, err := f.keys.Create(ctx, &key.CreateInput{TenantID: f.active.ID.String(), Name: "embed-only", Scopes: []string{"embeddings"}})
	if err != nil {
		t.Fatal(err)
	}
	withKey := pipeline.WithKeyID(ctx, k.ID.String())
	if _, err := f.run(withKey, pipeline.RequestCompletion); code(err) != pipeline.CodeForbidden {
		t.Fatalf("completion with an embeddings-only key = %v", err)
	}
	if _, err := f.run(withKey, pipeline.RequestEmbedding); err != nil {
		t.Fatalf("embedding = %v", err)
	}
	if _, err := f.run(pipeline.WithScopes(withKey, []string{"completions"}), pipeline.RequestStream); err != nil {
		t.Fatalf("edge scopes win: %v", err)
	}
	_ = f.keys.Revoke(ctx, k.ID.String())
	if _, err := f.run(withKey, pipeline.RequestEmbedding); code(err) != pipeline.CodeUnauthenticated {
		t.Fatalf("revoked key named in process = %v", err)
	}
}

func TestAnUnattributedRequestIsNotChecked(t *testing.T) {
	f := newAccessFixture(t)
	if _, err := f.run(context.Background(), pipeline.RequestCompletion); err != nil {
		t.Fatal(err)
	}
}
```

Add `errorsAs` as a one-line wrapper around `errors.As`, or import `errors`. For the unknown-tenant id, use `id.NewTenantID().String()`. The literal above is only illustrative.

- [ ] **Step 2: Run and watch them fail** (`go test ./pipeline/middlewares/ -run 'Access|Tenant|Scopes|Unattributed'`).

- [ ] **Step 3: Implement.** `pipeline/context.go`:

```go
const ctxScopes ctxKey = "nexus.scopes"

// WithScopes records the scopes of the key the edge authenticated.
func WithScopes(ctx context.Context, scopes []string) context.Context {
	return context.WithValue(ctx, ctxScopes, scopes)
}

// Scopes returns the authenticated key's scopes, and false when no edge set
// them (an in-process caller).
func Scopes(ctx context.Context) ([]string, bool) {
	s, ok := ctx.Value(ctxScopes).([]string)
	return s, ok
}
```

Match the existing `ctxKey` type and constant style in the file.

`pipeline/middlewares/access.go`:

```go
package middlewares

import (
	"context"
	"errors"
	"slices"

	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/tenant"
)

// TenantGetter and KeyGetter are the reads the access stage needs.
// tenant.Service and key.Service satisfy them.
type TenantGetter interface {
	Get(ctx context.Context, id string) (*tenant.Tenant, error)
}
type KeyGetter interface {
	Get(ctx context.Context, id string) (*key.APIKey, error)
}

// AccessMiddleware refuses a request whose tenant is not active or whose key
// lacks the scope the request needs. It runs inside identity, so the tenant
// and key are in the context, and publishes the tenant for the quota stage.
// A request that names no tenant is not checked.
type AccessMiddleware struct {
	tenants TenantGetter
	keys    KeyGetter
}

func NewAccess(tenants TenantGetter, keys KeyGetter) *AccessMiddleware {
	return &AccessMiddleware{tenants: tenants, keys: keys}
}

func (*AccessMiddleware) Name() string  { return "access" }
func (*AccessMiddleware) Priority() int { return 40 }

type tenantCtxKey struct{}

// TenantFromContext returns the tenant the access stage loaded.
func TenantFromContext(ctx context.Context) (*tenant.Tenant, bool) {
	t, ok := ctx.Value(tenantCtxKey{}).(*tenant.Tenant)
	return t, ok && t != nil
}

func refuse(code string, status int, msg string) *pipeline.RefusalError {
	return &pipeline.RefusalError{Code: code, Status: status, Message: msg}
}

func (m *AccessMiddleware) Process(ctx context.Context, req *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	tenantID := pipeline.TenantID(ctx)
	if tenantID == "" {
		return next(ctx)
	}
	t, err := m.tenants.Get(ctx, tenantID)
	switch {
	case errors.Is(err, tenant.ErrNotFound):
		r := refuse(pipeline.CodeForbidden, 403, "unknown tenant")
		r.Unattributed = true
		return nil, r
	case err != nil:
		r := refuse(pipeline.CodeUnavailable, 503, "tenant lookup failed")
		r.Cause = err
		return nil, r
	case t.Status != tenant.StatusActive:
		return nil, refuse(pipeline.CodeForbidden, 403, "tenant is "+string(t.Status))
	}
	if keyID := pipeline.KeyID(ctx); keyID != "" {
		scopes, ok := pipeline.Scopes(ctx)
		if !ok {
			k, err := m.keys.Get(ctx, keyID)
			switch {
			case errors.Is(err, key.ErrNotFound):
				return nil, refuse(pipeline.CodeUnauthenticated, 401, "unknown api key")
			case err != nil:
				r := refuse(pipeline.CodeUnavailable, 503, "key lookup failed")
				r.Cause = err
				return nil, r
			case k.TenantID.String() != tenantID:
				return nil, refuse(pipeline.CodeForbidden, 403, "the key belongs to another tenant")
			case k.Status != key.KeyActive:
				return nil, refuse(pipeline.CodeUnauthenticated, 401, "api key "+string(k.Status))
			}
			scopes = k.Scopes
		}
		need := "completions"
		if req.Type == pipeline.RequestEmbedding {
			need = "embeddings"
		}
		if !slices.Contains(scopes, need) {
			return nil, refuse(pipeline.CodeForbidden, 403, "the key lacks the "+need+" scope")
		}
	}
	return next(context.WithValue(ctx, tenantCtxKey{}, t))
}
```

- [ ] **Step 4: Run** `go test -race ./pipeline/...`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add pipeline/middlewares/access.go pipeline/middlewares/access_test.go
git commit --only -m "feat(nexus): refuse inactive tenants and keys without the right scope

The access stage runs after identity. It refuses a tenant that is disabled,
suspended or unknown (an unknown one is recorded under no tenant), and a
key that lacks the scope the request needs, whether the edge authenticated
it or an in-process caller named it." -- pipeline/context.go pipeline/middlewares/access.go pipeline/middlewares/access_test.go
git show --stat HEAD
```

---

### Task 9: The quota stage (priority 50)

**Files:**
- Modify: `money/money.go`, `money/money_test.go`
- Create: `pipeline/middlewares/quota.go`, `pipeline/middlewares/quota_test.go`

**Interfaces:**
- Consumes: `TenantFromContext` (Task 8), `ratelimit.Limiter` (Task 6), `usage.Service.DailyRequests/MonthlySpend` (Task 5).
- Produces:
  - `money.USD.Ratio(of USD) float64`: u/of for display, 0 when `of` is zero.
  - `middlewares.NewQuota(cfg QuotaConfig) *QuotaMiddleware` (name "quota", priority 50), with `QuotaConfig{Usage UsageCounter; Limiter ratelimit.Limiter; Events BudgetEvents; GlobalRPM int; Log UsageLogger; Now func() time.Time}`, `UsageCounter interface{ DailyRequests(ctx, tenantID string) (int, error); MonthlySpend(ctx, tenantID string) (money.USD, error) }` and `BudgetEvents interface{ EmitBudgetWarning(ctx, id.TenantID, float64); EmitBudgetExceeded(ctx, id.TenantID) }`.
  - `(*QuotaMiddleware).LimiterErrors() int64`.

- [ ] **Step 1: Write the failing tests.** `money/money_test.go`: `MustParse("8").Ratio(MustParse("10")) == 0.8` and `MustParse("1").Ratio(money.Zero) == 0`.

`pipeline/middlewares/quota_test.go`. Build the context with `context.WithValue` through a test-only exported hook. Add to `access.go` an exported `func WithTenantForTest(ctx context.Context, t *tenant.Tenant) context.Context` in a file named `export_test.go` in package `middlewares`, the Go idiom for test access:

```go
// pipeline/middlewares/export_test.go
package middlewares

import (
	"context"

	"github.com/xraph/nexus/tenant"
)

func WithTenantForTest(ctx context.Context, t *tenant.Tenant) context.Context {
	return context.WithValue(ctx, tenantCtxKey{}, t)
}
```

The tests:

```go
package middlewares_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/ratelimit"
	"github.com/xraph/nexus/tenant"
)

type counter struct {
	daily int
	spend money.USD
	err   error
}

func (c *counter) DailyRequests(context.Context, string) (int, error)      { return c.daily, c.err }
func (c *counter) MonthlySpend(context.Context, string) (money.USD, error) { return c.spend, c.err }

type budgetEvents struct {
	mu       sync.Mutex
	warned   int
	exceeded int
}

func (b *budgetEvents) EmitBudgetWarning(context.Context, id.TenantID, float64) { b.mu.Lock(); b.warned++; b.mu.Unlock() }
func (b *budgetEvents) EmitBudgetExceeded(context.Context, id.TenantID)         { b.mu.Lock(); b.exceeded++; b.mu.Unlock() }

type brokenLimiter struct{}

func (brokenLimiter) Allow(context.Context, string, int64, int64, time.Duration) (ratelimit.Decision, error) {
	return ratelimit.Decision{}, errors.New("redis: connection refused")
}
func (brokenLimiter) Kind() string { return "redis" }

func quotaTenant(q tenant.Quota) *tenant.Tenant {
	return &tenant.Tenant{ID: id.NewTenantID(), Status: tenant.StatusActive, Quota: q}
}

func runQuota(t *testing.T, mw *middlewares.QuotaMiddleware, tn *tenant.Tenant, req *provider.CompletionRequest) error {
	t.Helper()
	ctx := middlewares.WithTenantForTest(context.Background(), tn)
	_, err := mw.Process(ctx, &pipeline.Request{Type: pipeline.RequestCompletion, Completion: req, State: map[string]any{}},
		func(context.Context) (*pipeline.Response, error) {
			return &pipeline.Response{Completion: &provider.CompletionResponse{Usage: provider.Usage{TotalTokens: 100}}}, nil
		})
	return err
}

func TestMaxTokensIsCappedAndFilledIn(t *testing.T) {
	mw := middlewares.NewQuota(middlewares.QuotaConfig{Usage: &counter{}, Limiter: ratelimit.NewMemory()})
	tn := quotaTenant(tenant.Quota{MaxTokensPerReq: 500})
	if err := runQuota(t, mw, tn, &provider.CompletionRequest{MaxTokens: 501}); code(err) != pipeline.CodeInvalidRequest {
		t.Fatalf("over the cap = %v", err)
	}
	req := &provider.CompletionRequest{}
	if err := runQuota(t, mw, tn, req); err != nil || req.MaxTokens != 500 {
		t.Fatalf("unset max_tokens = %d, %v; want the cap filled in", req.MaxTokens, err)
	}
}

func TestDailyRequestsAndTheBudgetComeFromTheStore(t *testing.T) {
	ev := &budgetEvents{}
	c := &counter{daily: 10}
	mw := middlewares.NewQuota(middlewares.QuotaConfig{Usage: c, Limiter: ratelimit.NewMemory(), Events: ev})
	tn := quotaTenant(tenant.Quota{DailyRequests: 10, MonthlyBudgetUSD: money.MustParse("10")})
	if err := runQuota(t, mw, tn, &provider.CompletionRequest{}); code(err) != pipeline.CodeQuotaExceeded || pipeline.RetryAfter(err) <= 0 {
		t.Fatalf("at the daily limit = %v", err)
	}
	c.daily = 0
	c.spend = money.MustParse("8")
	for i := 0; i < 3; i++ {
		if err := runQuota(t, mw, tn, &provider.CompletionRequest{}); err != nil {
			t.Fatalf("at 80%% of budget = %v", err)
		}
	}
	c.spend = money.MustParse("10")
	for i := 0; i < 3; i++ {
		if err := runQuota(t, mw, tn, &provider.CompletionRequest{}); code(err) != pipeline.CodeBudgetExceeded {
			t.Fatalf("at the budget = %v", err)
		}
	}
	if ev.warned != 1 || ev.exceeded != 1 {
		t.Fatalf("warned %d exceeded %d; each fires once per tenant per month", ev.warned, ev.exceeded)
	}
}

func TestAStoreFailureRefusesTheMoneyCheck(t *testing.T) {
	mw := middlewares.NewQuota(middlewares.QuotaConfig{Usage: &counter{err: errors.New("pg down")}, Limiter: ratelimit.NewMemory()})
	err := runQuota(t, mw, quotaTenant(tenant.Quota{MonthlyBudgetUSD: money.MustParse("1")}), &provider.CompletionRequest{})
	if status, c := pipeline.HTTPStatus(err); status != 503 || c != pipeline.CodeUnavailable {
		t.Fatalf("budget check with the store down = %v", err)
	}
}

func TestRPMAndTPMRefuseWithAWait(t *testing.T) {
	mw := middlewares.NewQuota(middlewares.QuotaConfig{Usage: &counter{}, Limiter: ratelimit.NewMemory()})
	tn := quotaTenant(tenant.Quota{RPM: 2})
	_ = runQuota(t, mw, tn, &provider.CompletionRequest{})
	_ = runQuota(t, mw, tn, &provider.CompletionRequest{})
	err := runQuota(t, mw, tn, &provider.CompletionRequest{})
	if code(err) != pipeline.CodeRateLimited || pipeline.RetryAfter(err) <= 0 {
		t.Fatalf("third request at 2 RPM = %v", err)
	}
	tp := quotaTenant(tenant.Quota{TPM: 150})
	_ = runQuota(t, mw, tp, &provider.CompletionRequest{}) // charges 100
	_ = runQuota(t, mw, tp, &provider.CompletionRequest{}) // 100 < 150 before: allowed, charges to 200
	if err := runQuota(t, mw, tp, &provider.CompletionRequest{}); code(err) != pipeline.CodeRateLimited {
		t.Fatalf("over TPM = %v", err)
	}
}

func TestALimiterFailureLetsTheRequestThrough(t *testing.T) {
	mw := middlewares.NewQuota(middlewares.QuotaConfig{Usage: &counter{}, Limiter: brokenLimiter{}, GlobalRPM: 1})
	for i := 0; i < 3; i++ {
		if err := runQuota(t, mw, quotaTenant(tenant.Quota{RPM: 1, TPM: 1}), &provider.CompletionRequest{}); err != nil {
			t.Fatalf("limiter down = %v; want allowed", err)
		}
	}
	if mw.LimiterErrors() == 0 {
		t.Fatal("limiter errors must be counted")
	}
}

func TestTheGlobalLimitAppliesWithoutATenant(t *testing.T) {
	mw := middlewares.NewQuota(middlewares.QuotaConfig{Usage: &counter{}, Limiter: ratelimit.NewMemory(), GlobalRPM: 1})
	next := func(context.Context) (*pipeline.Response, error) { return &pipeline.Response{}, nil }
	req := &pipeline.Request{Type: pipeline.RequestCompletion, Completion: &provider.CompletionRequest{}, State: map[string]any{}}
	if _, err := mw.Process(context.Background(), req, next); err != nil {
		t.Fatal(err)
	}
	if _, err := mw.Process(context.Background(), req, next); code(err) != pipeline.CodeRateLimited {
		t.Fatalf("second unattributed request at a global 1 RPM = %v", err)
	}
}
```

Add one more test for a stream: TPM is charged at `Close` from the usage chunk the stream carried. Use a stream double from the package's existing test files (`fakes_test.go`/`usage_stream_test.go`). After closing a stream that reported 120 tokens, a `0`-charge check on `tpm:<tenant>` against a limit of 100 is refused.

- [ ] **Step 2: Run them and watch them fail** (`go test ./money/ ./pipeline/middlewares/ -run 'Ratio|Quota|MaxTokens|Daily|Store|RPM|Limiter|Global'`).

- [ ] **Step 3: Implement.** `money/money.go`:

```go
// Ratio is u divided by of, as a float64 for display (a percentage on a
// dashboard, a hook argument). It is never used to compute money. It is 0
// when of is zero.
func (u USD) Ratio(of USD) float64 {
	if of.d.IsZero() {
		return 0
	}
	f, _ := u.d.Div(of.d).Float64()
	return f
}
```

`pipeline/middlewares/quota.go`:

```go
package middlewares

import (
	"context"
	"io"
	"errors"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/ratelimit"
)

// UsageCounter is the store-of-record read the money checks need.
// usage.Service satisfies it.
type UsageCounter interface {
	DailyRequests(ctx context.Context, tenantID string) (int, error)
	MonthlySpend(ctx context.Context, tenantID string) (money.USD, error)
}

// BudgetEvents receives budget events. *plugin.Registry satisfies it.
type BudgetEvents interface {
	EmitBudgetWarning(ctx context.Context, tenantID id.TenantID, usedPct float64)
	EmitBudgetExceeded(ctx context.Context, tenantID id.TenantID)
}

// QuotaConfig configures the quota stage.
type QuotaConfig struct {
	Usage     UsageCounter
	Limiter   ratelimit.Limiter
	Events    BudgetEvents
	GlobalRPM int
	Log       UsageLogger
	Now       func() time.Time
}

// QuotaMiddleware enforces the tenant's per-request token cap, its daily
// requests and monthly budget (read from the store of record, failing
// closed), and its RPM and TPM (through the limiter, failing open). It
// also enforces the gateway-wide GlobalRPM for every request.
type QuotaMiddleware struct {
	cfg           QuotaConfig
	limiterErrors atomic.Int64
	mu            sync.Mutex
	warned        map[string]string // tenant -> month already warned
	exceeded      map[string]string // tenant -> month already reported
}

func NewQuota(cfg QuotaConfig) *QuotaMiddleware {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &QuotaMiddleware{cfg: cfg, warned: map[string]string{}, exceeded: map[string]string{}}
}

func (*QuotaMiddleware) Name() string  { return "quota" }
func (*QuotaMiddleware) Priority() int { return 50 }

// LimiterErrors counts limiter failures that let a request through.
func (m *QuotaMiddleware) LimiterErrors() int64 { return m.limiterErrors.Load() }

func (m *QuotaMiddleware) Process(ctx context.Context, req *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	if m.cfg.GlobalRPM > 0 {
		if r := m.allow(ctx, "global:rpm", 1, int64(m.cfg.GlobalRPM), "requests a minute across the gateway"); r != nil {
			return nil, r
		}
	}
	t, ok := TenantFromContext(ctx)
	if !ok {
		return next(ctx)
	}
	tid, q := t.ID.String(), t.Quota

	if q.MaxTokensPerReq > 0 && req.Completion != nil {
		switch {
		case req.Completion.MaxTokens > q.MaxTokensPerReq:
			return nil, &pipeline.RefusalError{Code: pipeline.CodeInvalidRequest, Status: 400,
				Message: "max_tokens is above the tenant's cap of " + strconv.Itoa(q.MaxTokensPerReq), Limit: strconv.Itoa(q.MaxTokensPerReq)}
		case req.Completion.MaxTokens == 0:
			req.Completion.MaxTokens = q.MaxTokensPerReq
		}
	}

	now := m.cfg.Now().UTC()
	if q.DailyRequests > 0 {
		n, err := m.cfg.Usage.DailyRequests(ctx, tid)
		if err != nil {
			return nil, unavailable("daily request count", err)
		}
		if n >= q.DailyRequests {
			tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
			return nil, &pipeline.RefusalError{Code: pipeline.CodeQuotaExceeded, Status: 429,
				Message: "daily request quota reached", Limit: strconv.Itoa(q.DailyRequests), RetryAfter: tomorrow.Sub(now)}
		}
	}

	if q.MonthlyBudgetUSD.IsPositive() {
		spend, err := m.cfg.Usage.MonthlySpend(ctx, tid)
		if err != nil {
			return nil, unavailable("monthly spend", err)
		}
		month := now.Format("2006-01")
		// Soft limit: the request that crosses the budget completes, the
		// next one is refused. Cost is only known after a request ends.
		if spend.Cmp(q.MonthlyBudgetUSD) >= 0 {
			if m.once(m.exceeded, tid, month) && m.cfg.Events != nil {
				m.cfg.Events.EmitBudgetExceeded(ctx, t.ID)
			}
			nextMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
			return nil, &pipeline.RefusalError{Code: pipeline.CodeBudgetExceeded, Status: 429,
				Message: "monthly budget reached", Limit: q.MonthlyBudgetUSD.String(), RetryAfter: nextMonth.Sub(now)}
		}
		// 80%: spend × 5 ≥ budget × 4, in exact decimals.
		if spend.Mul(5).Cmp(q.MonthlyBudgetUSD.Mul(4)) >= 0 && m.once(m.warned, tid, month) && m.cfg.Events != nil {
			m.cfg.Events.EmitBudgetWarning(ctx, t.ID, spend.Ratio(q.MonthlyBudgetUSD)*100)
		}
	}

	if q.RPM > 0 {
		if r := m.allow(ctx, "rpm:"+tid, 1, int64(q.RPM), "requests a minute"); r != nil {
			return nil, r
		}
	}
	tpmKey := "tpm:" + tid
	if q.TPM > 0 {
		if r := m.allow(ctx, tpmKey, 0, int64(q.TPM), "tokens a minute"); r != nil {
			return nil, r
		}
	}

	resp, err := next(ctx)
	if q.TPM > 0 && err == nil && resp != nil {
		switch {
		case resp.Stream != nil:
			resp.Stream = &tpmStream{inner: resp.Stream, charge: func(n int) { m.charge(tpmKey, n, int64(q.TPM)) }}
		case stateBool(req, pipeline.StateCacheHit):
			// A cache hit called no provider: it uses no tokens a minute.
		case resp.Completion != nil:
			m.charge(tpmKey, resp.Completion.Usage.TotalTokens, int64(q.TPM))
		case resp.Embedding != nil:
			m.charge(tpmKey, resp.Embedding.Usage.TotalTokens, int64(q.TPM))
		}
	}
	return resp, err
}

func unavailable(what string, err error) *pipeline.RefusalError {
	return &pipeline.RefusalError{Code: pipeline.CodeUnavailable, Status: 503, Message: what + " is unavailable", Cause: err}
}

// once reports whether tenant has not been seen in seen for month, and
// records it.
func (m *QuotaMiddleware) once(seen map[string]string, tenant, month string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if seen[tenant] == month {
		return false
	}
	seen[tenant] = month
	return true
}

// allow charges n and refuses when the window was already at limit. A
// limiter failure lets the request through and is counted.
func (m *QuotaMiddleware) allow(ctx context.Context, key string, n, limit int64, what string) *pipeline.RefusalError {
	d, err := m.cfg.Limiter.Allow(ctx, key, n, limit, time.Minute)
	if err != nil {
		m.limiterErrors.Add(1)
		if m.cfg.Log != nil {
			m.cfg.Log.Error("nexus: rate limiter failed, request allowed", "limiter", m.cfg.Limiter.Kind(), "error", err)
		}
		return nil
	}
	if d.Allowed {
		return nil
	}
	l := strconv.FormatInt(limit, 10)
	return &pipeline.RefusalError{Code: pipeline.CodeRateLimited, Status: 429, Message: l + " " + what, Limit: l, RetryAfter: d.RetryAfter}
}

// charge records tokens a request used. It runs after the request, on a
// fresh context: the request's may already be done.
func (m *QuotaMiddleware) charge(key string, tokens int, limit int64) {
	if tokens <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = m.allow(ctx, key, int64(tokens), limit, "tokens a minute")
}

// tpmStream charges the tokens a stream reported, once, when it is closed.
type tpmStream struct {
	inner  provider.Stream
	charge func(int)
	mu     sync.Mutex
	tokens int
	once   sync.Once
}

func (s *tpmStream) Next(ctx context.Context) (*provider.StreamChunk, error) {
	chunk, err := s.inner.Next(ctx)
	if chunk != nil && chunk.Usage != nil {
		s.mu.Lock()
		s.tokens = chunk.Usage.TotalTokens
		s.mu.Unlock()
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return chunk, err
	}
	return chunk, err
}

func (s *tpmStream) Close() error {
	err := s.inner.Close()
	s.once.Do(func() {
		s.mu.Lock()
		n := s.tokens
		s.mu.Unlock()
		if n == 0 {
			if u := s.inner.Usage(); u != nil {
				n = u.TotalTokens
			}
		}
		s.charge(n)
	})
	return err
}

func (s *tpmStream) Usage() *provider.Usage { return s.inner.Usage() }
```

Remove the pointless `errors.Is(err, io.EOF)` branch in `Next` if lint flags it. It is only there to make the EOF handling explicit; returning `chunk, err` unconditionally is the same. `stateBool` already exists in `usage.go`. `UsageLogger` is the logger interface the usage stage takes; reuse it.

- [ ] **Step 4: Run** `go test -race ./money/ ./pipeline/...`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add pipeline/middlewares/quota.go pipeline/middlewares/quota_test.go pipeline/middlewares/export_test.go
git commit --only -m "feat(nexus): enforce token caps, daily requests, the budget, RPM and TPM

The quota stage reads daily requests and monthly spend from the store of
record and refuses with 503 when the store is down. The budget is a soft
limit: the request that crosses it completes and the next one is refused.
RPM and TPM go through the limiter, which lets a request through when it
fails and counts that. The budget hooks fire once per tenant per month." -- money/money.go money/money_test.go pipeline/middlewares/quota.go pipeline/middlewares/quota_test.go pipeline/middlewares/export_test.go
git show --stat HEAD
```

---

### Task 10: Stream limits come from the tenant

**Files:**
- Modify: `pipeline/middlewares/stream_lifecycle.go` (`QuotaError` ~235), `pipeline/middlewares/usage.go` (`usageRecordingStream`)
- Test: `pipeline/middlewares/stream_quota_test.go`, `pipeline/middlewares/usage_stream_test.go`

**Interfaces:**
- Produces:
  - `middlewares.TenantStreamQuota(ctx context.Context) StreamQuota`: the tenant's `MaxStreamDuration`/`MaxStreamTokens` from `TenantFromContext`, zero without a tenant.
  - `QuotaError` gains `RefusalCode() string` ("quota_exceeded") and `StatusCode() int` (429).
  - A stream cut by `QuotaError` is recorded `error`, status 429, `RefusalCode` "quota_exceeded", priced from the tokens seen (unknown when none).

- [ ] **Step 1: Write the failing tests.**
  - In `stream_quota_test.go`: `TenantStreamQuota` returns `{MaxDuration: 2s, MaxTokens: 50}` for a context carrying a tenant with those quotas (use `WithTenantForTest`), and the zero value without one.
  - In `usage_stream_test.go`: a stream whose `Next` returns `errQuotaExceeded("output_tokens")` after a usage chunk of 60 tokens records `Outcome error`, `StatusCode 429`, `RefusalCode "quota_exceeded"`, and is priced. The same with no usage chunk is `unknown`. Use the file's existing stream doubles and `recordingUsage`. `errQuotaExceeded` is unexported, so construct `&middlewares.QuotaError{What: "output_tokens"}`, or use the exported constructor if one exists.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement.** In `stream_lifecycle.go`:

```go
// RefusalCode and StatusCode report a stream cut by its tenant's limit as
// quota_exceeded, 429. The stream was served in part, so the usage stage
// still prices the tokens it saw.
func (e *QuotaError) RefusalCode() string { return "quota_exceeded" }
func (e *QuotaError) StatusCode() int     { return 429 }

// TenantStreamQuota is the default QuotaResolver: the stream limits of the
// tenant the access stage loaded, or none.
func TenantStreamQuota(ctx context.Context) StreamQuota {
	t, ok := TenantFromContext(ctx)
	if !ok {
		return StreamQuota{}
	}
	return StreamQuota{MaxDuration: t.Quota.MaxStreamDuration, MaxTokens: t.Quota.MaxStreamTokens}
}
```

Check whether `QuotaError`'s methods have value or pointer receivers, and match `errQuotaExceeded`'s return type, so `errors.As(err, &qe)` keeps working.

In `usageRecordingStream`: add `quotaCut bool` beside `failed`. In `Next`, when `err` is not EOF and `errors.As(err, new(*QuotaError))` (or `IsQuotaExceeded(err)`), set `quotaCut = true`. In `Close`, take `quotaCut` with the other fields, and in the two `failed` branches set `rec.StatusCode = 429; rec.RefusalCode = "quota_exceeded"` when `quotaCut`, keeping `Outcome error` and the pricing as is.

- [ ] **Step 4: Run** `go test -race ./pipeline/...`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit --only -m "feat(nexus): hold streams to the tenant's duration and token limits

The stream lifecycle stage had a quota resolver nobody set. The default now
reads the tenant the access stage loaded. A stream cut by its limit is
recorded with status 429 and quota_exceeded, and still priced from the
tokens it used." -- pipeline/middlewares/stream_lifecycle.go pipeline/middlewares/usage.go pipeline/middlewares/stream_quota_test.go pipeline/middlewares/usage_stream_test.go
git show --stat HEAD
```

---

### Task 11: Wire enforcement into the gateway

**Files:**
- Modify: `config.go`, `options.go`, `nexus.go` (`Initialize`, `buildDefaultPipeline`, accessors, `Shutdown` unchanged), `engine.go`, `extension/config.go`, `extension/extension.go` (`applyConfigToGatewayOpts`, `mergeWithDefaults`, `mergeConfigurations`), `wiring_test.go`, `gateway_usage_test.go`, `extension/config_passthrough_test.go`
- Create: `gateway_enforcement_test.go`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `Config.RequireAPIKey bool` (`DefaultConfig`: true), `nexus.WithRequireAPIKey(on bool) Option`.
  - `nexus.WithLimiter(l ratelimit.Limiter) Option`.
  - `(*Gateway).Limiter() ratelimit.Limiter`, `(*Gateway).LimiterErrors() int64`, `(*Gateway).FlushUsage(ctx context.Context) error` (waits for pending inserts without closing the stage), `(*Engine).Gateway() *Gateway`.
  - Extension config `RequireAPIKey *bool` (`require_api_key`, default true), passed through like `enable_usage`.
  - Default stage list: `request_id, usage, timeout, identity, access, quota, stream_lifecycle, retry, provider_call` (tracing, guardrail, transform, alias and cache appear only when configured).

- [ ] **Step 1: Write the failing tests.** In `wiring_test.go`, update the expected default stage list to include `access` and `quota` after `identity`, and add `RequireAPIKey` defaulting to true. In `extension/config_passthrough_test.go`, add `require_api_key: false` reaching `gw.Config().RequireAPIKey`, and an explicit `WithGatewayOption(nexus.WithRequireAPIKey(true))` beating config false.

`gateway_enforcement_test.go` (package `nexus_test`; reuse `fakeProvider`, `listPrice`, `gatewayOn` from `gateway_usage_test.go`):

```go
package nexus_test

import (
	"context"
	"errors"
	"testing"
	"time"

	nexus "github.com/xraph/nexus"
	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/ratelimit"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/tenant"
	"github.com/xraph/nexus/usage"
)

// enforced builds a gateway over s with one fake provider, creates a tenant
// with quota q and a key for it, and returns them.
func enforced(t *testing.T, s store.Store, q tenant.Quota, opts ...nexus.Option) (*nexus.Gateway, *tenant.Tenant, *key.APIKey) {
	t.Helper()
	gw := nexus.New(append([]nexus.Option{nexus.WithDatabase(s), nexus.WithProvider(&fakeProvider{name: "openai", price: listPrice})}, opts...)...)
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = gw.Shutdown(context.Background()) })
	tn, err := gw.Tenants().Create(context.Background(), &tenant.CreateInput{Name: "Acme", Slug: "acme-" + t.Name(), Quota: &q})
	if err != nil {
		t.Fatal(err)
	}
	k, _, err := gw.Keys().Create(context.Background(), &key.CreateInput{TenantID: tn.ID.String(), Name: "k"})
	if err != nil {
		t.Fatal(err)
	}
	return gw, tn, k
}

func complete(gw *nexus.Gateway, tn *tenant.Tenant, k *key.APIKey) error {
	_, err := gw.Engine().Complete(context.Background(), &provider.CompletionRequest{
		Model: "gpt-4o", TenantID: tn.ID.String(), KeyID: k.ID.String(),
		Messages: []provider.Message{{Role: "user", Content: "hi"}},
	})
	return err
}

func refusedCode(err error) string { _, c := pipeline.HTTPStatus(err); return c }

func TestTheBudgetIsASoftLimit(t *testing.T) {
	s := store.NewMemory()
	// One completion costs 0.008755. A 0.01 budget lets two through: the
	// second crosses it and completes; the third is refused.
	gw, tn, k := enforced(t, s, tenant.Quota{MonthlyBudgetUSD: money.MustParse("0.01")})
	for i := 1; i <= 2; i++ {
		if err := complete(gw, tn, k); err != nil {
			t.Fatalf("request %d = %v", i, err)
		}
		if err := gw.FlushUsage(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if err := complete(gw, tn, k); refusedCode(err) != pipeline.CodeBudgetExceeded {
		t.Fatalf("third request = %v; want budget_exceeded", err)
	}
	_ = gw.FlushUsage(context.Background())
	res, _ := s.Usage().Query(context.Background(), &usage.QueryOptions{Limit: 10})
	var refused int
	for _, r := range res.Items {
		if r.Outcome == usage.OutcomeRefused {
			refused++
			if r.RefusalCode != pipeline.CodeBudgetExceeded || r.CostUSD == nil || !r.CostUSD.IsZero() || r.TenantID != tn.ID {
				t.Fatalf("refusal record = %+v", r)
			}
		}
	}
	if refused != 1 {
		t.Fatalf("refused records = %d", refused)
	}
}

func TestADisabledTenantIsRefusedAndRecorded(t *testing.T) {
	s := store.NewMemory()
	gw, tn, k := enforced(t, s, tenant.Quota{})
	if err := gw.Tenants().SetStatus(context.Background(), tn.ID.String(), tenant.StatusDisabled); err != nil {
		t.Fatal(err)
	}
	if err := complete(gw, tn, k); refusedCode(err) != pipeline.CodeForbidden {
		t.Fatalf("disabled tenant = %v", err)
	}
}

func TestRateLimitRefusalsDoNotUseUpTheDailyQuota(t *testing.T) {
	s := store.NewMemory()
	gw, tn, k := enforced(t, s, tenant.Quota{RPM: 1, DailyRequests: 2})
	_ = complete(gw, tn, k)
	for i := 0; i < 5; i++ {
		if err := complete(gw, tn, k); refusedCode(err) != pipeline.CodeRateLimited {
			t.Fatalf("over RPM = %v", err)
		}
	}
	_ = gw.FlushUsage(context.Background())
	n, err := gw.Usage().DailyRequests(context.Background(), tn.ID.String())
	if err != nil || n != 1 {
		t.Fatalf("daily requests = %d, %v; five rate-limit refusals must not count", n, err)
	}
}

func TestAnUnknownTenantIsRefusedAndChargedToNoOne(t *testing.T) {
	s := store.NewMemory()
	gw, _, _ := enforced(t, s, tenant.Quota{})
	ghost := "tenant_" + "01jz9z9z9z9z9z9z9z9z9z9z9z"
	_, err := gw.Engine().Complete(context.Background(), &provider.CompletionRequest{Model: "gpt-4o", TenantID: ghost})
	if refusedCode(err) != pipeline.CodeForbidden {
		t.Fatalf("unknown tenant = %v", err)
	}
	_ = gw.FlushUsage(context.Background())
	res, _ := s.Usage().Query(context.Background(), &usage.QueryOptions{Limit: 10})
	if len(res.Items) != 1 || !res.Items[0].TenantID.IsNil() {
		t.Fatalf("records = %+v; want one, unattributed", res.Items)
	}
}

type brokenLimiter struct{}

func (brokenLimiter) Allow(context.Context, string, int64, int64, time.Duration) (ratelimit.Decision, error) {
	return ratelimit.Decision{}, errors.New("redis: connection refused")
}
func (brokenLimiter) Kind() string { return "redis" }

func TestTheGatewayCountsLimiterFailuresAndServes(t *testing.T) {
	gw, tn, k := enforced(t, store.NewMemory(), tenant.Quota{RPM: 1}, nexus.WithLimiter(brokenLimiter{}))
	for i := 0; i < 3; i++ {
		if err := complete(gw, tn, k); err != nil {
			t.Fatalf("request %d with the limiter down = %v", i, err)
		}
	}
	if gw.LimiterErrors() != 3 || gw.Limiter().Kind() != "redis" {
		t.Fatalf("limiter errors = %d, kind %s", gw.LimiterErrors(), gw.Limiter().Kind())
	}
}
```

Generate the ghost tenant id with `id.NewTenantID().String()` instead of the literal.

Every existing test in `gateway_usage_test.go` that sends a random `TenantID` or `KeyID` must now create them first, because the access stage refuses unknown tenants and keys. Add a helper `tenantAndKey(t, gw) (tenantID, keyID string)` that creates both through `gw.Tenants()` and `gw.Keys()`, and use it in those tests. Do not change any expected cost or outcome.

- [ ] **Step 2: Run them and watch them fail** (`go test -race . ./extension/`).

- [ ] **Step 3: Implement.**

`config.go`: add

```go
	// RequireAPIKey makes the HTTP edges (api, proxy) refuse a request
	// without a valid nxs_ key. Default true. False keeps an open gateway
	// for local work; a key that is presented is still checked.
	RequireAPIKey bool
```

with `RequireAPIKey: true` in `DefaultConfig()`.

`options.go`:

```go
// WithRequireAPIKey turns key enforcement at the HTTP edges on or off.
func WithRequireAPIKey(on bool) Option { return func(gw *Gateway) { gw.config.RequireAPIKey = on } }

// WithLimiter sets the RPM and TPM limiter. The default is in-process
// (ratelimit.NewMemory), which applies per replica.
func WithLimiter(l ratelimit.Limiter) Option { return func(gw *Gateway) { gw.limiter = l } }
```

`nexus.go`: add `limiter ratelimit.Limiter` and `quotaMW *middlewares.QuotaMiddleware` to `Gateway`. In `Initialize`, before building the pipeline: `if gw.limiter == nil { gw.limiter = ratelimit.NewMemory() }`. In `buildDefaultPipeline`, after identity:

```go
	// Priority 40: tenant status and key scopes
	b.Use(middlewares.NewAccess(gw.tenant, gw.key))

	// Priority 50: token cap, daily requests, budget, RPM and TPM
	var budgetEvents middlewares.BudgetEvents
	if gw.extensions != nil {
		budgetEvents = gw.extensions
	}
	gw.quotaMW = middlewares.NewQuota(middlewares.QuotaConfig{
		Usage: gw.usage, Limiter: gw.limiter, Events: budgetEvents,
		GlobalRPM: gw.config.GlobalRateLimit, Log: gw.logger,
	})
	b.Use(gw.quotaMW)
```

Give the stream lifecycle stage the default resolver:

```go
		cfg := gw.streamLifecycleCfg
		if cfg.QuotaResolver == nil {
			cfg.QuotaResolver = middlewares.TenantStreamQuota
		}
		b.Use(middlewares.NewStreamLifecycle(gw.extensions, cfg))
```

Accessors:

```go
// Limiter is the RPM and TPM limiter in use.
func (gw *Gateway) Limiter() ratelimit.Limiter { return gw.limiter }

// LimiterErrors counts limiter failures that let a request through.
func (gw *Gateway) LimiterErrors() int64 {
	if gw.quotaMW == nil {
		return 0
	}
	return gw.quotaMW.LimiterErrors()
}

// FlushUsage waits until every usage record taken so far is stored, without
// closing the stage. Shutdown flushes on its own.
func (gw *Gateway) FlushUsage(ctx context.Context) error {
	if gw.usageMW == nil {
		return nil
	}
	return gw.usageMW.Flush(ctx)
}
```

`engine.go`:

```go
// Gateway returns the gateway this engine runs on, for HTTP edges that need
// its key service and config.
func (e *Engine) Gateway() *Gateway { return e.gw }
```

Extension: add `RequireAPIKey *bool` with tags `json:"require_api_key" mapstructure:"require_api_key" yaml:"require_api_key"`, default `&true` in `DefaultConfig`, fill it in `mergeWithDefaults` and `mergeConfigurations` exactly as `EnableUsage` is filled, and in `applyConfigToGatewayOpts` add `nexus.WithRequireAPIKey(*e.config.RequireAPIKey)` to the prepended config options when it is non-nil.

`gw.tenant` and `gw.key` are interfaces built in `Initialize`. `NewAccess` takes them directly: `tenant.Service` has `Get`, and `key.Service` has `Get` since Task 4.

- [ ] **Step 4: Run.**

Run (DB variables inline): `go test -race ./... && go build -o /dev/null ./... && go vet ./_examples/multi-tenant/`
Expected: PASS, with every slice 2 gateway test still asserting its original cost and outcome.

- [ ] **Step 5: Commit.**

```bash
git add gateway_enforcement_test.go
git commit --only -m "feat(nexus): run access and quota checks on every request

The default pipeline now checks tenant status and key scopes, then the
token cap, daily requests, budget, RPM and TPM. RequireAPIKey defaults to
true. WithLimiter swaps the in-process limiter for a shared one, and the
gateway reports limiter failures it let through. Stream limits come from
the tenant." -- config.go options.go nexus.go engine.go extension/config.go extension/extension.go wiring_test.go gateway_usage_test.go gateway_enforcement_test.go extension/config_passthrough_test.go
git show --stat HEAD
```

---

### Task 12: Authenticate HTTP requests

**Files:**
- Create: `auth/keyauth.go`, `auth/keyauth_test.go`

**Interfaces:**
- Consumes: `key.Service.Validate` (Task 4), `pipeline.WithTenantID/WithKeyID/WithScopes` (Task 8), `pipeline.RefusalError` (Task 2).
- Produces:
  - `type auth.KeyValidator interface{ Validate(ctx context.Context, rawKey string) (*key.APIKey, error) }`.
  - `auth.RawKey(r *http.Request) string`: `Authorization: Bearer nxs_…` or `x-api-key: nxs_…`.
  - `auth.Authenticate(ctx context.Context, keys KeyValidator, rawKey string) (context.Context, error)`: on success the context carries tenant, key and scopes; on failure a `*pipeline.RefusalError` (`unauthenticated` 401, or `unavailable` 503).
  - `auth.KeyAuth(opts KeyAuthOptions) func(http.Handler) http.Handler`, with `KeyAuthOptions{Keys KeyValidator; Required bool; OnError func(http.ResponseWriter, *http.Request, error)}`.
  - `auth.RequireScope(scope string, onError func(http.ResponseWriter, *http.Request, error)) func(http.Handler) http.Handler`.
  - `auth.WriteError(w http.ResponseWriter, err error)`: the default `OnError`, which writes `{"error":{"message","type","code"}}` with the refusal's status and `Retry-After` when set.

- [ ] **Step 1: Write the failing tests.** `auth/keyauth_test.go`:

```go
package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xraph/nexus/auth"
	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/tenant"
)

func keys(t *testing.T) (key.Service, string, string, *key.APIKey) {
	t.Helper()
	s := store.NewMemory()
	tn, _ := tenant.NewService(s.Tenants()).Create(context.Background(), &tenant.CreateInput{Name: "A", Slug: "a"})
	ks := key.NewService(s.Keys(), key.WithTenants(s.Tenants()))
	k, raw, err := ks.Create(context.Background(), &key.CreateInput{TenantID: tn.ID.String(), Name: "k", Scopes: []string{"completions"}})
	if err != nil {
		t.Fatal(err)
	}
	_, admin, _ := ks.Create(context.Background(), &key.CreateInput{TenantID: tn.ID.String(), Name: "ops", Scopes: []string{"admin"}})
	return ks, raw, admin, k
}

func serve(h http.Handler, header, value string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	if header != "" {
		r.Header.Set(header, value)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestEitherHeaderAuthenticates(t *testing.T) {
	ks, raw, _, k := keys(t)
	var seen context.Context
	h := auth.KeyAuth(auth.KeyAuthOptions{Keys: ks, Required: true})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = r.Context() }))
	for _, hv := range [][2]string{{"Authorization", "Bearer " + raw}, {"x-api-key", raw}} {
		if w := serve(h, hv[0], hv[1]); w.Code != 200 {
			t.Fatalf("%s: %d %s", hv[0], w.Code, w.Body)
		}
		scopes, ok := pipeline.Scopes(seen)
		if pipeline.KeyID(seen) != k.ID.String() || pipeline.TenantID(seen) != k.TenantID.String() || !ok || len(scopes) != 1 {
			t.Fatalf("%s: context not set", hv[0])
		}
	}
}

func TestMissingWrongAndRevokedKeysAre401(t *testing.T) {
	ks, raw, _, k := keys(t)
	h := auth.KeyAuth(auth.KeyAuthOptions{Keys: ks, Required: true})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	if w := serve(h, "", ""); w.Code != 401 {
		t.Fatalf("no key = %d", w.Code)
	}
	if w := serve(h, "Authorization", "Bearer nxs_"+raw[4:10]+"nope"); w.Code != 401 {
		t.Fatalf("wrong key = %d", w.Code)
	}
	_ = ks.Revoke(context.Background(), k.ID.String())
	w := serve(h, "x-api-key", raw)
	if w.Code != 401 {
		t.Fatalf("revoked = %d", w.Code)
	}
	if body := w.Body.String(); contains(body, raw) {
		t.Fatal("a response must never echo the raw key")
	}
}

func TestAnOpenGatewayStillChecksAKeyThatIsPresented(t *testing.T) {
	ks, _, _, _ := keys(t)
	h := auth.KeyAuth(auth.KeyAuthOptions{Keys: ks, Required: false})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	if w := serve(h, "", ""); w.Code != 200 {
		t.Fatalf("open gateway without a key = %d", w.Code)
	}
	if w := serve(h, "x-api-key", "nxs_bogus"); w.Code != 401 {
		t.Fatalf("open gateway with a bad key = %d", w.Code)
	}
}

func TestRequireScope(t *testing.T) {
	ks, raw, admin, _ := keys(t)
	h := auth.KeyAuth(auth.KeyAuthOptions{Keys: ks, Required: true})(auth.RequireScope("admin", nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
	if w := serve(h, "x-api-key", raw); w.Code != 403 {
		t.Fatalf("completions key on an admin route = %d", w.Code)
	}
	if w := serve(h, "x-api-key", admin); w.Code != 200 {
		t.Fatalf("admin key = %d", w.Code)
	}
}
```

Add a small `contains` helper (`strings.Contains`).

- [ ] **Step 2: Run them and watch them fail** (`go test ./auth/`).

- [ ] **Step 3: Implement** `auth/keyauth.go`:

```go
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/pipeline"
)

// KeyValidator checks a raw gateway key. key.Service satisfies it.
type KeyValidator interface {
	Validate(ctx context.Context, rawKey string) (*key.APIKey, error)
}

// RawKey returns the key a request presents, from Authorization: Bearer or
// x-api-key, or "".
func RawKey(r *http.Request) string {
	if v := r.Header.Get("x-api-key"); v != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// Authenticate validates rawKey and returns ctx carrying the key's tenant,
// id and scopes for the pipeline. A gRPC interceptor can call it too.
func Authenticate(ctx context.Context, keys KeyValidator, rawKey string) (context.Context, error) {
	if rawKey == "" {
		return ctx, unauthenticated("an API key is required")
	}
	k, err := keys.Validate(ctx, rawKey)
	switch {
	case errors.Is(err, key.ErrNotFound):
		return ctx, unauthenticated("invalid API key")
	case errors.Is(err, key.ErrRevoked):
		return ctx, unauthenticated("API key revoked")
	case errors.Is(err, key.ErrExpired):
		return ctx, unauthenticated("API key expired")
	case err != nil:
		return ctx, &pipeline.RefusalError{Code: pipeline.CodeUnavailable, Status: 503, Message: "key check is unavailable", Cause: err}
	}
	ctx = pipeline.WithTenantID(ctx, k.TenantID.String())
	ctx = pipeline.WithKeyID(ctx, k.ID.String())
	return pipeline.WithScopes(ctx, slices.Clone(k.Scopes)), nil
}

func unauthenticated(msg string) *pipeline.RefusalError {
	return &pipeline.RefusalError{Code: pipeline.CodeUnauthenticated, Status: 401, Message: msg}
}

// KeyAuthOptions configures KeyAuth.
type KeyAuthOptions struct {
	Keys KeyValidator
	// Required refuses a request without a key. When false, a request
	// without one passes unauthenticated, and a key that is presented is
	// still checked.
	Required bool
	// OnError writes a refusal. The default is WriteError.
	OnError func(http.ResponseWriter, *http.Request, error)
}

// KeyAuth authenticates every request with a gateway key. Its refusals
// happen before the pipeline and are not recorded as usage: they have no
// tenant to charge.
func KeyAuth(o KeyAuthOptions) func(http.Handler) http.Handler {
	onError := o.OnError
	if onError == nil {
		onError = func(w http.ResponseWriter, _ *http.Request, err error) { WriteError(w, err) }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := RawKey(r)
			if raw == "" && !o.Required {
				next.ServeHTTP(w, r)
				return
			}
			ctx, err := Authenticate(r.Context(), o.Keys, raw)
			if err != nil {
				onError(w, r, err)
				return
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireScope refuses an authenticated request whose key lacks scope. A
// request no key authenticated (an open gateway) passes; put it behind
// KeyAuth.
func RequireScope(scope string, onError func(http.ResponseWriter, *http.Request, error)) func(http.Handler) http.Handler {
	if onError == nil {
		onError = func(w http.ResponseWriter, _ *http.Request, err error) { WriteError(w, err) }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if scopes, ok := pipeline.Scopes(r.Context()); ok && !slices.Contains(scopes, scope) {
				onError(w, r, &pipeline.RefusalError{Code: pipeline.CodeForbidden, Status: 403, Message: "the key lacks the " + scope + " scope"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// WriteError writes err as {"error":{"message","type","code"}} with the
// refusal's status, and Retry-After in whole seconds when the refusal says
// how long to wait.
func WriteError(w http.ResponseWriter, err error) {
	status, code := pipeline.HTTPStatus(err)
	if ra := pipeline.RetryAfter(err); ra > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(ra.Seconds()))))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{
		"message": err.Error(), "type": errorType(status), "code": code,
	}})
}

func errorType(status int) string {
	switch status {
	case 400:
		return "invalid_request_error"
	case 401:
		return "authentication_error"
	case 403:
		return "permission_error"
	case 429:
		return "rate_limit_error"
	case 503:
		return "service_unavailable"
	}
	return "internal_error"
}
```

- [ ] **Step 4: Run** `go test -race ./auth/`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add auth/keyauth.go auth/keyauth_test.go
git commit --only -m "feat(auth): authenticate HTTP requests with a gateway key

KeyAuth reads the key from Authorization: Bearer or x-api-key, validates
it, and puts the tenant, key and scopes in the context the pipeline reads.
RequireScope guards admin and model routes. Authenticate is the same check
for callers outside net/http, a gRPC interceptor for one." -- auth/keyauth.go auth/keyauth_test.go
git show --stat HEAD
```

---

### Task 13: Protect the api and proxy routes, and answer with the right status

**Files:**
- Modify: `api/api.go` (`registerRoutes` ~108-145), `api/requests.go`, `api/completion_handler.go`, `api/embedding_handler.go`, `proxy/proxy.go` (routes ~145-155), `proxy/handler.go` (`writeError` ~318-331 and its callers at ~51, ~66, ~125), `httpstream/encoder.go` (`SanitizeError`)
- Create: `api/auth_test.go`, `proxy/auth_test.go`

**Interfaces:**
- Consumes: `auth.KeyAuth`, `auth.RequireScope` (Task 12), `pipeline.HTTPStatus`, `pipeline.RetryAfter` (Task 2), `Gateway.Config().RequireAPIKey`, `Engine.Gateway()` (Task 11).
- Produces:
  - Every `/v1/*` and `/admin/*` route behind `KeyAuth` (required per `Config.RequireAPIKey`); `/health` open.
  - `/admin/*` routes need scope `admin`; `GET /v1/models` and `GET /v1/models/{model}` need `models`. Completions, embeddings and realtime are scope-checked in the pipeline.
  - Pipeline errors answered with `pipeline.HTTPStatus` and `Retry-After`. The error body gains `code` in both shapes.
  - In-band stream errors that are refusals carry `Type: "refused"` and `Code: <refusal code>`.

- [ ] **Step 1: Write the failing tests.** The existing `api/shutdown_test.go` and `proxy/shutdown_test.go` build gateways without keys; once keys are required they get 401. Add `nexus.WithRequireAPIKey(false)` to their `nexus.New`/`nexus.NewEngine` calls, with a comment saying those tests are about shutdown, not auth.

`api/auth_test.go` (package `api_test`), with its own provider:

```go
// okProvider answers every completion with 10 prompt and 5 completion
// tokens, and lists one priced model.
type okProvider struct{}

func (okProvider) Name() string { return "openai" }
func (okProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Chat: true, Streaming: true, Embeddings: true}
}
func (okProvider) Models(context.Context) ([]provider.Model, error) {
	return []provider.Model{{ID: "gpt-4o", Provider: "openai", Pricing: provider.Pricing{InputPerMillion: money.MustParse("2.50"), OutputPerMillion: money.MustParse("10")}}}, nil
}
func (okProvider) Complete(_ context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	return &provider.CompletionResponse{Provider: "openai", Model: req.Model,
		Choices: []provider.Choice{{Message: provider.Message{Role: "assistant", Content: "hi"}}},
		Usage:   provider.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15}}, nil
}
func (okProvider) CompleteStream(context.Context, *provider.CompletionRequest) (provider.Stream, error) {
	return nil, errors.New("not used")
}
func (okProvider) Embed(_ context.Context, req *provider.EmbeddingRequest) (*provider.EmbeddingResponse, error) {
	return &provider.EmbeddingResponse{Provider: "openai", Model: req.Model, Usage: provider.Usage{PromptTokens: 5, TotalTokens: 5}}, nil
}
func (okProvider) Healthy(context.Context) bool { return true }

func newAPI(t *testing.T, opts ...nexus.Option) (*httptest.Server, *nexus.Gateway, string, string, *tenant.Tenant) {
	t.Helper()
	s := store.NewMemory()
	gw := nexus.New(append([]nexus.Option{nexus.WithDatabase(s), nexus.WithProvider(okProvider{})}, opts...)...)
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	tn, _ := gw.Tenants().Create(context.Background(), &tenant.CreateInput{Name: "A", Slug: "a", Quota: &tenant.Quota{RPM: 1}})
	_, user, _ := gw.Keys().Create(context.Background(), &key.CreateInput{TenantID: tn.ID.String(), Name: "u"})
	_, admin, _ := gw.Keys().Create(context.Background(), &key.CreateInput{TenantID: tn.ID.String(), Name: "ops", Scopes: []string{"admin"}})
	srv := httptest.NewServer(api.New(gw).Handler())
	t.Cleanup(srv.Close)
	return srv, gw, user, admin, tn
}
```

Tests, each asserting status, the `error.code` field, and (for 429) the `Retry-After` header:
  - `TestHealthNeedsNoKey`: `GET /health` without a key is 200.
  - `TestAMissingKeyIsRefusedAndNotRecorded`: `POST /v1/chat/completions` without a key is 401 `unauthenticated`. After `gw.FlushUsage`, `gw.Usage().Query` returns zero records.
  - `TestARevokedKeyIsRefusedAtTheEdge`: revoke the user key, then 401.
  - `TestAdminNeedsTheAdminScope`: `GET /admin/providers` with the user key is 403 `forbidden`; with the admin key it is 200.
  - `TestModelsNeedTheModelsScope`: a key with only `completions` gets 403 on `GET /v1/models`.
  - `TestRateLimitedIs429WithRetryAfter`: two completions with the user key; the second is 429 `rate_limited` and `Retry-After` parses as an integer between 1 and 60.
  - `TestAKeyWithoutCompletionsIsRefusedAndRecorded`: a key with only `embeddings` sending a completion gets 403 `forbidden`, and one `refused` record exists for the tenant.
  - `TestAStreamRefusalIsAStatusNotAStream`: the same embeddings-only key with `"stream": true` gets 403 JSON before any SSE.
  - `TestAnOpenGatewayServesWithoutAKey`: `nexus.WithRequireAPIKey(false)`, completion without a key is 200.
  - `TestEveryPipelineRefusalMapsToItsStatus`: a table test, one tenant per row, each asserting status and `error.code`. `max_tokens` above `MaxTokensPerReq` is 400 `invalid_request`. A second request with `DailyRequests: 1` (after `gw.FlushUsage`) is 429 `quota_exceeded` with `Retry-After`. At a `0.00005` budget the first completion (`0.000075`) completes and crosses it, and the second, after `gw.FlushUsage`, is 429 `budget_exceeded`. A tenant set `suspended` is 403 `forbidden`. A usage service whose `MonthlySpend` fails (`nexus.WithUsageService`) gives 503 `unavailable`.

The `okProvider` above and the test-local types are package `api_test`; copy `okProvider` into `proxy/auth_test.go` for the proxy cases.

`proxy/auth_test.go`: the same cases through `proxy.New(gw.Engine())`, minus the admin case (the proxy has no admin routes), asserting the OpenAI error shape `{"error":{"message","type","code"}}`.

- [ ] **Step 2: Run them and watch them fail** (`go test ./api/ ./proxy/`).

- [ ] **Step 3: Implement.**

`api/requests.go`: add

```go
// writePipelineError answers a pipeline error with the refusal's status and
// code, or 500, and Retry-After when the refusal says how long to wait.
func writePipelineError(w http.ResponseWriter, err error) {
	auth.WriteError(w, err)
}
```

and give `writeError` a `code` in its body (`"code": mapStatusToCode(status)`, or simply leave `code` out of non-refusal errors). Replace the three `writeError(w, http.StatusInternalServerError, err.Error())` calls after `Engine().Complete`, `.CompleteStream` and `.Embed` with `writePipelineError(w, err)`.

`api/api.go` `registerRoutes`:

```go
	ka := auth.KeyAuth(auth.KeyAuthOptions{Keys: a.gw.Keys(), Required: a.gw.Config().RequireAPIKey})
	protect := func(h http.HandlerFunc, scope string) http.Handler {
		var hh http.Handler = h
		if scope != "" {
			hh = auth.RequireScope(scope, nil)(hh)
		}
		return ka(hh)
	}
```

Register each `/v1/*` route as `a.mux.Handle(pattern, protect(a.handleX, ""))`, the two model routes with `"models"`, every `/admin/*` route with `"admin"`, the realtime handler as `ka(<ws handler>)`, and `/health` unchanged. `a.gw.Keys()` is non-nil after `Initialize`; if it can be nil (a gateway the caller did not initialize), refuse to start the API with a clear panic message in `New`, or treat nil keys as `Required` with every request 503. Pick the first and document it on `New`.

`proxy/proxy.go`: the same with `p.engine.Gateway().Keys()` and `p.engine.Gateway().Config().RequireAPIKey`. The proxy's own OpenAI error shape goes through an `OnError` that writes its `openAIError` with `Code` set, `Retry-After` set, and `Type` from the status. Replace the three 500 sites in `proxy/handler.go` with that writer.

`httpstream/encoder.go` `SanitizeError`, a new case before `default`:

```go
	case errors.As(err, &refused):
		we.Type = "refused"
		we.Code = refused.RefusalCode()
		we.Message = err.Error()
		we.Retryable = refused.StatusCode() == 429
```

with `var refused pipeline.Refusal` declared above the switch. Check that `httpstream` may import `pipeline` without a cycle (`go list -deps ./pipeline | grep httpstream` must print nothing). If it would cycle, define a local `interface{ RefusalCode() string; StatusCode() int }`.

- [ ] **Step 4: Run.**

Run: `go test -race ./api/ ./proxy/ ./httpstream/ ./auth/ . && go build -o /dev/null ./... && (cd grpcsrv && go vet ./...)`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add api/auth_test.go proxy/auth_test.go
git commit --only -m "feat(nexus): require a gateway key on the api and proxy routes

Every /v1 and /admin route needs a valid nxs_ key unless RequireAPIKey is
off, admin routes need the admin scope and the model list needs models.
Refusals answer with their own status (401, 403, 400, 429 with
Retry-After, 503) instead of 500, and a refused stream says so in its
error event." -- api/api.go api/requests.go api/completion_handler.go api/embedding_handler.go api/auth_test.go proxy/proxy.go proxy/handler.go proxy/auth_test.go httpstream/encoder.go
git show --stat HEAD
```

---

### Task 14: Docs, the full gate, and the hand-off to slice 4

**Files:**
- Modify: `docs/content/docs/api-reference/http-api.mdx`, `docs/content/docs/configuration.mdx` (or wherever `global_rate_limit` is documented: `grep -rln global_rate_limit docs/`), `docs/content/docs/errors.mdx`, `docs/content/docs/multi-tenancy.mdx`, `docs/content/docs/architecture.mdx` (stage list)
- Modify (forge-dashboard): `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`

- [ ] **Step 1: Docs.** In the docs site, in plain prose, no em dashes:
  - **Authentication** (http-api.mdx): `Authorization: Bearer nxs_…` or `x-api-key`; `/health` is open; admin routes need the `admin` scope; the model list needs `models`.
  - **Your first admin key:** with `RequireAPIKey` on, no HTTP route can create one, so create it in Go with `gw.Keys().Create(ctx, &key.CreateInput{TenantID: ..., Name: "ops", Scopes: []string{"admin"}})` or from the dashboard. An `admin` key administers every tenant.
  - **Configuration:** `require_api_key` (default true), `global_rate_limit` (now enforced), and `WithLimiter(redislimit.New(client))` for replicas that should share windows.
  - **Errors:** the refusal codes table with statuses, the `code` field in the error body, `Retry-After` on 429, and which refusals are recorded (pipeline) and which are not (edge 401 and route-scope 403).
  - **Multi-tenancy:** what each quota field enforces, the soft budget, the daily count leaving out refusals, limiter fail-open and store fail-closed, and budget hooks firing once per tenant per month per replica.
  - **Architecture:** the stage list with access 40 and quota 50.

- [ ] **Step 2: The full gate.**

```bash
NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable" NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test" NEXUS_TEST_REDIS_ADDR="localhost:56379" go test -race ./...
fail=0; for d in providers/*/ grpcsrv config _examples/live _examples/realtime; do (cd "$d" && go vet ./... && go test ./...) >/dev/null 2>&1 || { echo "FAIL $d"; fail=1; }; done; echo "nested fail=$fail"
(cd _examples/grpc && go vet ./... && go build -o /dev/null ./...) && echo "grpc example ok"
for d in providers/*/ grpcsrv _examples/grpc; do (cd "$d" && GOWORK=off go vet ./... >/dev/null 2>&1) || echo "GOWORK=off FAIL $d"; done
go vet ./_examples/multi-tenant/ ./_examples/proxy/
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git status --short
```

Expected: all green, `nested fail=0`, no `GOWORK=off FAIL` line, no Redis or store test skipped, a clean tree. `_examples/proxy/main.go` and `_examples/multi-tenant/main.go` now face `RequireAPIKey`. If an example only works open, set `nexus.WithRequireAPIKey(false)` there with a comment saying why, or create a key and print how to use it.

- [ ] **Step 3: Commit the docs.**

```bash
git commit --only -m "docs: explain gateway keys, refusal codes and quota enforcement" -- <the docs files you changed>
git show --stat HEAD
```

- [ ] **Step 4: Hand off to slice 4.** In forge-dashboard, append `## What slice 3 found that slice 4 must know` to the spec with the Edit tool only (other sessions have uncommitted files there). Write it with the `rex-voice` skill, then `humanizer` in embedded mode, no em dashes. Cover:
  - the refusal codes and statuses, which refusals are recorded and which are not (Ruling 2);
  - `DailyRequests` leaving out refusals;
  - the stage order with access 40 and quota 50;
  - what the contract can read for posture: `Config().RequireAPIKey`, `Limiter().Kind()`, `LimiterErrors()`, `UsageInsertErrors()`;
  - `key.Service.Get` and derived expiry, `key.ErrInvalid` for 400 mapping, `key.ErrRevoked`/`ErrExpired`, `TouchLastUsed`;
  - `Rotate`'s rollback, and the hooks now emitted;
  - the first-admin-key bootstrap;
  - a negative budget is ignored by enforcement (only a positive budget limits) and the slice 4 contract must still refuse saving one;
  - what was deferred (M4, M6, M8, M11, Vertex token count, gRPC auth, WebSocket browser auth) and anything the tests turned up.

  Commit that one path: `git add -f <path>` and `git commit --only -m "docs: record what nexus slice 3 found" -- docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`.
