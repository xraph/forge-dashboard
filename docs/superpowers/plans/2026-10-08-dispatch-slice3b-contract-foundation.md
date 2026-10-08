# Dispatch Slice 3b: contract foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the contract's request bounds, actor propagation, wire primitives and error mapping.

**Architecture:** A single wrapper adds query or command deadlines and maps errors. Domain handlers consume typed helpers for payloads, timestamps and cursor pages. The manifest and extension registration follow once their domain bindings exist, so this slice registers no incomplete contributor.

**Tech Stack:** Go, Forge dashboard contract subpackages, Dispatch engine/store interfaces.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Main checkout only, exact-path local commits, no pushes or worktrees.
- Preserve concurrent dependency updates. Forge >= v1.12.0 and Grove >= v1.7.0.
- Operator-wide reads with explicit filters. Never derive scope from principal claims.
- Every list/count request is bounded. Earlier caller deadlines remain in force.
- camelCase wire fields; missing values null; timestamps UTC; opaque payloads are never decoded as text.
- No root Forge dashboard import in production code.
- Use rex-voice and humanizer for shipped prose, no em dashes or attribution.
- Native execution is already authorized; proceed after self-review.

## Review focus

1. JSON integers larger than JavaScript's safe range must remain unchanged in the envelope (payload test).
2. Internal driver errors must be logged and redacted, while expected refusals keep canonical codes (error test).
3. A completed search may still have another cursor page (cursor test).
4. An earlier caller deadline must survive the wrapper; a background query must gain one (request test).
5. Actor identity comes from the authenticated user, not a similarly named claim (request test).

## Files and interfaces

All paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
Create `extension/contract/deps.go`, `wire.go`, `errors.go`, `handler.go` and
`foundation_test.go`. `Deps` consumes the built engine, aggregate store and logger.
Later bindings use `handle[I,O]`; domain projections use `Payload`, `Duration`,
`Page[T]`, `nullable`, `timestamp`, `timestampPtr` and `pageLimit`.
State-changing handlers attach the current state through `stateConflict` after
reading it when the engine refuses a transition. Bulk errors must pass through
this redaction boundary, never forward engine diagnostic strings directly.

### Task 1: Build the contract request and wire primitives

- [ ] Write the failing tests:

`extension/contract/foundation_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "strings"
 "testing"
 "time"

 "github.com/xraph/forge"
 dashauth "github.com/xraph/forge/extensions/dashboard/auth"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/ext"
 "github.com/xraph/dispatch/paging"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

func TestDependenciesRequireEngineAndStore(t *testing.T) {
 if (Deps{}).validate() == nil { t.Fatal("accepted missing engine") }
 d, err := dispatch.New(dispatch.WithStore(memory.New()))
 if err != nil { t.Fatal(err) }
 eng, err := engine.Build(d)
 if err != nil { t.Fatal(err) }
 if (Deps{Engine: eng}).validate() == nil { t.Fatal("accepted missing store") }
 if err := (Deps{Engine: eng, Store: memory.New()}).validate(); err != nil { t.Fatal(err) }
}

func TestWirePayloadsPreserveJSONAndDistinguishGob(t *testing.T) {
 source := []byte(`{"id":9007199254740993}`)
 payload := projectPayload(source, false)
 source[0] = '['
 encoded, err := json.Marshal(payload)
 if err != nil { t.Fatal(err) }
 if string(encoded) != `{"kind":"json","json":{"id":9007199254740993}}` { t.Fatalf("payload = %s", encoded) }
 for _, checkpoint := range []bool{false, true} {
  p := projectPayload([]byte{0, 255}, checkpoint)
  want := "binary"; if checkpoint { want = "gob" }
  if p.Kind != want || p.Bytes == nil || *p.Bytes != 2 || p.JSON != nil { t.Fatalf("opaque = %+v", p) }
 }
 empty, err := json.Marshal(projectPayload(nil, false))
 if err != nil || string(empty) != `{"kind":"binary","bytes":0}` { t.Fatalf("empty = %s, %v", empty, err) }
}

func TestWireNullsUTCAndCursorCoverage(t *testing.T) {
 if nullable("") != nil || timestamp(time.Time{}) != nil || timestampPtr(nil) != nil { t.Fatal("absent values are not null") }
 local := time.Date(2026, 10, 8, 9, 0, 0, 0, time.FixedZone("offset", -5*3600))
 if got := *timestamp(local); got != "2026-10-08T14:00:00Z" { t.Fatal(got) }
 d := duration(90*time.Second)
 if d.Text != "1m30s" || d.MS != 90000 { t.Fatalf("duration = %+v", d) }
 page := newPage[string](nil, "next", true, local)
 if page.Items == nil || page.NextCursor == nil || !page.Complete { t.Fatalf("page = %+v", page) }
 // Complete is search coverage. It does not consume a nonempty cursor.
 if *page.NextCursor != "next" { t.Fatal("lost next cursor") }
 for limit, want := range map[int]int{0:50, 1:1, 200:200, 201:200} {
  got, err := pageLimit(limit); if err != nil || got != want { t.Fatalf("limit %d = %d, %v", limit, got, err) }
 }
 if _, err := pageLimit(-1); !errors.Is(err, fc.ErrBadRequest) { t.Fatalf("negative limit = %v", err) }
}

type errorRecorder struct { forge.Logger; calls int }
func (l *errorRecorder) Error(string, ...forge.Field) { l.calls++ }

func TestErrorMappingRedactsInternalAndLogsIntent(t *testing.T) {
 conflict := stateConflict("completed")
 encoded, marshalErr := json.Marshal(conflict)
 if marshalErr != nil || !strings.Contains(string(encoded), `"details":{"state":"completed"}`) || !errors.Is(conflict, fc.ErrConflict) {
  t.Fatalf("state conflict = %s, %v", encoded, marshalErr)
 }
 logger := &errorRecorder{Logger: forge.NewNoopLogger()}
 deps := Deps{Logger: logger}
 internal := deps.mapError("jobs.list", errors.New("secret-database-password"))
 if !errors.Is(internal, fc.ErrInternal) || strings.Contains(internal.Error(), "secret") || logger.calls != 1 { t.Fatalf("internal = %v, logs=%d", internal, logger.calls) }
 cases := []struct{ err, want error }{
  {dispatch.ErrJobNotFound, fc.ErrNotFound}, {dispatch.ErrRunNotFound, fc.ErrNotFound},
  {dispatch.ErrDLQNotFound, fc.ErrNotFound}, {dispatch.ErrCronNotFound, fc.ErrNotFound},
  {dispatch.ErrWorkerNotFound, fc.ErrNotFound}, {paging.ErrInvalidCursor, fc.ErrBadRequest},
  {dispatch.ErrInvalidState, fc.ErrConflict}, {dispatch.ErrDLQAlreadyReplayed, fc.ErrConflict},
  {resource.ErrUnschedulable, fc.ErrConflict}, {workflow.ErrRunnerShutdown, fc.ErrUnavailable},
  {context.Canceled, fc.ErrUnavailable}, {context.DeadlineExceeded, fc.ErrUnavailable},
 }
 for _, tc := range cases {
  if got := deps.mapError("test", fmt.Errorf("driver detail: %w", tc.err)); !errors.Is(got, tc.want) || strings.Contains(got.Error(), "driver detail") { t.Fatalf("%v mapped to %v", tc.err, got) }
 }
 if logger.calls != 1 { t.Fatalf("expected refusals logged as internal: %d", logger.calls) }
}

func TestHandleBoundsRequestsPreservesEarlierDeadlineAndSetsActor(t *testing.T) {
 parent, cancel := context.WithTimeout(context.Background(), time.Second)
 defer cancel()
 deadline, _ := parent.Deadline()
 principal := fc.Principal{User: &dashauth.UserInfo{Subject:"operator"}, Claims:map[string]any{"sub":"not-the-actor", "scope_app_id":"not-a-filter"}}
 fn := handle(Deps{}, "test", true, func(ctx context.Context, _ struct{}, _ fc.Principal) (string,error) {
  got, ok := ctx.Deadline()
  if !ok || !got.Equal(deadline) { t.Fatalf("deadline = %v", got) }
  return ext.ActorFrom(ctx), nil
 })
 got, err := fn(parent, struct{}{}, principal)
 if err != nil || got != "operator" { t.Fatalf("actor = %q, %v", got, err) }
 query := handle(Deps{}, "query", false, func(ctx context.Context, _ struct{}, _ fc.Principal) (bool,error) {
  until, ok := ctx.Deadline()
  return ok && time.Until(until) <= queryTimeout, nil
 })
 if bounded, err := query(context.Background(), struct{}{}, fc.Principal{}); err != nil || !bounded { t.Fatalf("unbounded query: %v", err) }
}
```

- [ ] Run `go test -race ./extension/contract -count=1`. Expect missing Deps and helper symbols.
- [ ] Add these implementations:

`extension/contract/deps.go`

```go
// Package contract serves the operator-wide Dispatch dashboard.
package contract

import (
 "fmt"

 "github.com/xraph/forge"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/store"
)

// Deps contains the running engine and the stores its intents inspect.
type Deps struct {
 Engine *engine.Engine
 Store store.Store
 Logger forge.Logger
}

func (d Deps) validate() error {
 if d.Engine == nil { return fmt.Errorf("dispatch/contract: Engine is required") }
 if d.Store == nil { return fmt.Errorf("dispatch/contract: Store is required") }
 return nil
}
```

`extension/contract/wire.go`

```go
package contract

import (
 "bytes"
 "encoding/json"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
)

type Duration struct {
 Text string `json:"text"`
 MS int64 `json:"ms"`
}

func duration(d time.Duration) Duration { return Duration{Text:d.String(), MS:d.Milliseconds()} }

func nullable(s string) *string {
 if s == "" { return nil }; return &s
}

func timestamp(t time.Time) *string {
 if t.IsZero() { return nil }
 s := t.UTC().Format(time.RFC3339Nano)
 return &s
}

func timestampPtr(t *time.Time) *string {
 if t == nil { return nil }; return timestamp(*t)
}

// Payload exposes JSON as JSON and opaque content only as a size.
type Payload struct {
 Kind string `json:"kind"`
 JSON json.RawMessage `json:"json,omitempty"`
 Bytes *int `json:"bytes,omitempty"`
}

func projectPayload(data []byte, checkpoint bool) Payload {
 if json.Valid(data) { return Payload{Kind:"json", JSON:bytes.Clone(data)} }
 kind := "binary"
 if checkpoint { kind = "gob" }
 n := len(data)
 return Payload{Kind:kind, Bytes:&n}
}

type Page[T any] struct {
 Items []T `json:"items"`
 NextCursor *string `json:"nextCursor"`
 Complete bool `json:"complete"`
 AsOf string `json:"asOf"`
}

func newPage[T any](items []T, cursor string, complete bool, asOf time.Time) Page[T] {
 if items == nil { items = []T{} }
 return Page[T]{Items:items, NextCursor:nullable(cursor), Complete:complete, AsOf:asOf.UTC().Format(time.RFC3339Nano)}
}

func pageLimit(limit int) (int,error) {
 if limit < 0 { return 0, &fc.Error{Code:fc.CodeBadRequest, Message:"limit must not be negative"} }
 if limit == 0 { return 50,nil }
 return min(limit,200),nil
}
```

`extension/contract/errors.go`

```go
package contract

import (
 "context"
 "errors"

 "github.com/xraph/forge"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/paging"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/workflow"
)

func badRequest(message string) error { return &fc.Error{Code:fc.CodeBadRequest, Message:message} }
func notFound(message string) error { return &fc.Error{Code:fc.CodeNotFound, Message:message} }
func stateConflict(state string) error {
 return &fc.Error{Code:fc.CodeConflict, Message:"the current state does not allow this action", Details:map[string]any{"state":nullable(state)}}
}

func mapError(err error) error {
 if err == nil { return nil }
 var known *fc.Error
 if errors.As(err,&known) { return known }
 switch {
 case errors.Is(err,dispatch.ErrJobNotFound), errors.Is(err,dispatch.ErrRunNotFound),
  errors.Is(err,dispatch.ErrWorkflowNotFound), errors.Is(err,dispatch.ErrCronNotFound),
  errors.Is(err,dispatch.ErrDLQNotFound), errors.Is(err,dispatch.ErrWorkerNotFound),
  errors.Is(err,artifact.ErrNotFound):
  return notFound("resource not found")
 case errors.Is(err,paging.ErrInvalidCursor):
  return badRequest("cursor is not valid for this list")
 case errors.Is(err,dispatch.ErrInvalidState), errors.Is(err,dispatch.ErrDLQAlreadyReplayed),
  errors.Is(err,resource.ErrUnschedulable), errors.Is(err,dispatch.ErrDuplicateCron):
  return &fc.Error{Code:fc.CodeConflict, Message:"the resource changed or cannot run with its current configuration"}
 case errors.Is(err,workflow.ErrRunnerShutdown), errors.Is(err,context.Canceled), errors.Is(err,context.DeadlineExceeded):
  return &fc.Error{Code:fc.CodeUnavailable, Message:"the operation is unavailable or timed out", Retryable:true}
 case errors.Is(err,artifact.ErrPermissionDenied):
  return &fc.Error{Code:fc.CodePermissionDenied, Message:"the artifact backend refused access"}
 default:
  return &fc.Error{Code:fc.CodeInternal, Message:"an internal error occurred"}
 }
}

func (d Deps) mapError(intent string, err error) error {
 mapped := mapError(err)
 if d.Logger != nil && errors.Is(mapped,fc.ErrInternal) {
  d.Logger.Error("dispatch/contract: internal error answering intent", forge.F("intent",intent), forge.F("error",err))
 }
 return mapped
}
```

`extension/contract/handler.go`

```go
package contract

import (
 "context"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/ext"
)

const queryTimeout = 10*time.Second
const commandTimeout = 30*time.Second

// handle bounds store work and maps errors at the contract boundary.
// Commands carry the authenticated subject to engine operator hooks.
func handle[I,O any](deps Deps, intent string, command bool, fn func(context.Context,I,fc.Principal)(O,error)) func(context.Context,I,fc.Principal)(O,error) {
 return func(ctx context.Context, input I, principal fc.Principal)(O,error) {
  timeout := queryTimeout
  if command {
   timeout = commandTimeout
   actor := ""
   if principal.User != nil { actor = principal.User.Subject }
   ctx = ext.WithActor(ctx,actor)
  }
  ctx,cancel := context.WithTimeout(ctx,timeout)
  defer cancel()
  output,err := fn(ctx,input,principal)
  return output,deps.mapError(intent,err)
 }
}
```

- [ ] Run `goimports -local github.com/xraph/dispatch -w extension/contract/foundation_test.go extension/contract/deps.go extension/contract/wire.go extension/contract/errors.go extension/contract/handler.go`.
- [ ] Run `go test -race ./extension/contract -count=1`, `go build ./...`, `go test ./...` and fresh-cache lint. Expect success.
- [ ] Inspect branch, status, staged diff and diff whitespace. Stage these exact files and commit:

```sh
git add extension/contract/foundation_test.go extension/contract/deps.go extension/contract/wire.go extension/contract/errors.go extension/contract/handler.go
git commit --only -m 'feat(contract): add bounded requests and safe wire primitives' -- extension/contract/foundation_test.go extension/contract/deps.go extension/contract/wire.go extension/contract/errors.go extension/contract/handler.go
git show --stat HEAD
```

## Final review

- [ ] Request the native workflow's fresh review; resolve actionable findings.
- [ ] Record the actual checks and commit. No manifest binding, UI or browser result is claimed by this foundation.

## Self-review

Completed 2026-10-08 in Dispatch commit `10f4f90`. Missing-symbol tests failed
before implementation. Focused race tests, full build/unit and fresh-cache ordinary
lint passed. The final reviewer found no actionable introduced issues and approved
the foundation. Domain bindings, transport and browser verification remain pending.

Every introduced helper is defined here and exercised. No handler is registered before its implementation exists.
The five review concerns have explicit test cases. Domain projections, manifest invalidation maps, transport,
contributor discovery and browser parity remain in subsequent plans under the same approved spec.
