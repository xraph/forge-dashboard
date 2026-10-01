# Bastion Operator Actions (slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator change the gateway from the dashboard: create, edit, delete and enable or disable manual routes, refresh discovery, refresh the OpenAPI aggregate, and reset a circuit breaker.

**Architecture:** The admin service gains a write mutex, carries a target's health across an edit, stops aliasing caller data, and exposes `Entry(id)`, a route's values as entered, so the contract can apply a partial update without dropping anything the editor does not show. The `bastion` contract gains seven commands with exact `invalidates`. The fixture models them. The React plugin gets a route form (create and edit pages), detail-page actions (edit, enable or disable, delete), and a discovery refresh on the routes page.

**Tech Stack:** Go 1.26, forge v1.11.2 contract; React 19, TypeScript 6, vitest 5, `@forge-go/dashboard-kit`, `@forge-go/dashboard-plugin`; Node fixture server.

**Spec:** `docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md` ("Slice 2: the admin service and the contract" for the commands and refusals, "The route editor", "Sequencing" item 3).

**Repos:**
- Go: `/Users/rexraphael/Work/xraph/forgery/bastion` (Tasks 1 to 3)
- React and fixtures: `/Users/rexraphael/Work/xraph/forge-dashboard` (Tasks 4 to 8)

Both on `main`, no worktree.

## Global Constraints

- Contributor `bastion`. No request carries a tenant or app id.
- Errors are `&contract.Error{Code, Message, Details}`. Source refusals are `CONFLICT` with `details: {reason: "source", source}`; duplicates `CONFLICT` with `{reason: "duplicate", routeId}`; a switched-off subsystem `CONFLICT` with `{reason: "discoveryOff"}` or `{reason: "openapiOff"}`. Validation is `BAD_REQUEST` with `details.field`.
- Every command declares `invalidates` exactly as Task 2 and Task 3 list them.
- Path and priority travel as the operator entered them. The admin service alone applies the base path and the +100 manual offset.
- A target URL the dashboard shows has its userinfo password replaced (`admin.RedactURL`). Any write that receives such a URL back maps it to the stored one; a masked password is never saved.
- Go gates: `gofmt -l .` empty, `go vet ./...`, `go build ./... && go test -race ./...`, `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C` with 0 issues.
- React gates: `pnpm --filter @forge-go/dashboard-plugin-bastion test`, `typecheck`, `lint`.
- Shared checkouts. Edit existing files only with the Edit tool (no `sed -i`, no redirection, no rewrite scripts; read before you write). Never `git add -A`, `git checkout --`, `git stash`, `git reset --hard`, `git clean`. Commit with `git add <new files>` then `git commit --only <paths>`; confirm with `git show --stat HEAD`. `packages/fixture-server/verify.mjs` carries another session's uncommitted edits: commit it only through the temporary-index recipe in Task 4. `docs/` is globally ignored: specs and plans need `git add -f` when new.
- Commit messages: no `Co-Authored-By`, no Claude attribution, no em dashes. No em dashes in comments or UI copy.
- UI conventions: identifiers `font-mono text-xs`; the column an operator reads `font-medium`; captions carry a live count including zero; "none" is `NoneCell` or `TagList`; badges proportion first. Errors shown while a dialog is open render inside the dialog. Every `ConfirmDialog` gets `pending`, and its command's `reset()` runs when it opens.

## Decisions this plan makes against the spec

Each is recorded in the spec by Task 8.

1. **The editor offers only the overrides the proxy applies: rate limit and auth.** `route.RateLimit` is read at `proxy/engine.go:374` and `route.Auth` through `security/auth.go:53`. `route.Timeout` is never read on the proxy path, retry never runs, the per-route breaker override is never used (`GetWithConfig` has no caller), and the cache never stores. Offering those would be offering switches that do nothing. They are kept as stored on every save, and the detail page marks them "Not applied".
2. **Create lives at `/new-route` and edit at `/routes/:id/edit`.** `/new-route` follows vault's `/new-secret`, so no route id can shadow it. A separate edit route keeps the detail page a read page with actions.
3. **Contract writes are logged, not audited.** The REST handlers write an access-log line from the HTTP request; the contract has no request, and bastion's `auditSink` is never written. Each contract write logs one Info line with the intent, the route or target id, and the operator's subject. `MIGRATION.md` records that there is no audit trail.
4. **`openapi.refresh` answers `{started: true}` and runs in the background** on a context detached from the request, with a two-minute bound. The REST refresh handler gets the same detached context, fixing the refresh that was cancelled as soon as the handler returned.

## Review Focus

- A route target whose URL carries `user:secret@` must keep `secret` after an edit that sends back the masked URL. Pinned in Task 2.
- Saving an edit that changes only the priority must keep headers, transforms, traffic policy, metadata, target metadata (`health_check_path`), timeout, retry, breaker and cache overrides exactly. Pinned in Tasks 1 and 2.
- Eight concurrent creates of the same path and method must produce exactly one route. Pinned in Task 1.
- Disabling a config-file route must tell the operator the change ends at restart, and the response must say `durable: false`. Pinned in Tasks 2 and 6.
- The edit form must prefill path and priority as entered (`/users`, `10`), never the effective `/gw/users` and `110`. Pinned in Task 5.

---

### Task 1: Admin write hardening and `Entry`

**Files:**
- Modify: `admin/admin.go` (`Service` gains `mu sync.Mutex`)
- Modify: `admin/writes.go` (lock around writes, carry health, clone input, `Entry`)
- Create: `admin/clone.go`
- Modify: `admin/writes_test.go`

**Interfaces:**
- Produces:

```go
// Entry returns a manual route's values as the operator entered them, with
// nothing redacted. It is for merging a partial update, never for display.
// It answers ErrNotFound or *SourceError like the writes do.
func (s *Service) Entry(id string) (bastion.RouteDTO, error)
```

- Behaviour: `CreateRoute`, `UpdateRoute`, `DeleteRoute` and `SetEnabled` hold `s.mu` for their whole body, so a conflict check and its write see the same table. A target rebuilt because its weight, tags, metadata or TLS changed keeps the prior target's `Healthy`. Everything a write stores from the DTO is a copy: maps, slices and override structs.

- [ ] **Step 1: Write the failing tests**

Append to `admin/writes_test.go` (add `"sync"` to its imports):

```go
func TestConcurrentCreatesOfOnePathMakeOneRoute(t *testing.T) {
	f := newFixture(t)

	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.svc.CreateRoute(ordersDTO())
			results <- err
		}()
	}
	wg.Wait()
	close(results)

	ok := 0
	for err := range results {
		if err == nil {
			ok++
		} else if !errors.Is(err, admin.ErrConflict) {
			t.Errorf("unexpected error: %v", err)
		}
	}
	if ok != 1 {
		t.Errorf("%d creates succeeded, want exactly 1", ok)
	}
}

func TestChangedTargetKeepsItsHealth(t *testing.T) {
	f := newFixture(t)
	r, _ := f.svc.CreateRoute(ordersDTO())
	r.Targets[0].SetHealthy(false)

	dto := ordersDTO()
	dto.Targets[0].Weight = 9
	up, err := f.svc.UpdateRoute(r.ID, dto)
	if err != nil {
		t.Fatal(err)
	}
	if up.Targets[0].Healthy {
		t.Error("a weight edit reported a known-unhealthy upstream healthy")
	}
}

func TestStoredRouteDoesNotAliasTheDTO(t *testing.T) {
	f := newFixture(t)
	dto := ordersDTO()
	dto.Headers = bastion.HeaderPolicy{Set: map[string]string{"X-Env": "prod"}}
	dto.Metadata = map[string]any{"owner": "a"}
	dto.RateLimit = &bastion.RateLimitConfig{Enabled: true, RequestsPerSec: 5, Burst: 10}

	r, err := f.svc.CreateRoute(dto)
	if err != nil {
		t.Fatal(err)
	}
	dto.Headers.Set["X-Env"] = "changed"
	dto.Metadata["owner"] = "b"
	dto.RateLimit.Burst = 99

	got, _ := f.rm.GetRoute(r.ID)
	if got.Headers.Set["X-Env"] != "prod" || got.Metadata["owner"] != "a" || got.RateLimit.Burst != 10 {
		t.Errorf("stored route changed with the caller's DTO: %+v %+v %+v", got.Headers, got.Metadata, got.RateLimit)
	}
}

func TestEntryRoundTripsEverything(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{
		ID: "r1", Path: "/gw/orders", Source: bastion.SourceManual, Priority: 105, Enabled: true,
		Methods:   []string{"GET"},
		Headers:   bastion.HeaderPolicy{Set: map[string]string{"Authorization": "Bearer real"}},
		Transform: &bastion.TransformConfig{RequestHeaders: bastion.HeaderPolicy{Add: map[string]string{"X-A": "1"}}},
		Timeout:   &bastion.TimeoutConfig{Read: 5},
		Metadata:  map[string]any{"owner": "a"},
		Targets: []*bastion.Target{{ID: "r1/0", URL: "http://u:secret@orders:8080", Weight: 2,
			Metadata: map[string]string{"health_check_path": "/healthz"}}},
	})
	before, _ := f.rm.GetRoute("r1")

	dto, err := f.svc.Entry("r1")
	if err != nil {
		t.Fatal(err)
	}
	if dto.Path != "/orders" || dto.Priority != 5 {
		t.Errorf("entry path/priority = %q/%d, want /orders/5", dto.Path, dto.Priority)
	}
	if dto.Headers.Set["Authorization"] != "Bearer real" {
		t.Error("Entry redacted a header; it must not")
	}
	if dto.Targets[0].URL != "http://u:secret@orders:8080" {
		t.Error("Entry masked a URL; it must not")
	}

	if _, err := f.svc.UpdateRoute("r1", dto); err != nil {
		t.Fatal(err)
	}
	after, _ := f.rm.GetRoute("r1")
	if after.Path != before.Path || after.Priority != before.Priority ||
		after.Headers.Set["Authorization"] != "Bearer real" ||
		after.Transform.RequestHeaders.Add["X-A"] != "1" ||
		after.Timeout.Read != 5 || after.Metadata["owner"] != "a" ||
		after.Targets[0] != before.Targets[0] {
		t.Errorf("Entry then UpdateRoute changed the route:\nbefore %+v\nafter  %+v", before, after)
	}
}

func TestEntryRefusesDiscoveredRoutes(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{ID: "farp-x", Path: "/x", Source: bastion.SourceFARP})
	if _, err := f.svc.Entry("farp-x"); !errors.Is(err, admin.ErrNotManual) {
		t.Errorf("err = %v, want ErrNotManual", err)
	}
	if _, err := f.svc.Entry("nope"); !errors.Is(err, admin.ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test -race ./admin/ -run 'Concurrent|ChangedTarget|Alias|Entry' -v 2>&1 | grep -E "^(---|FAIL|ok)|undefined"`
Expected: compile failure on `f.svc.Entry`; with `Entry` stubbed the other three fail (more than one create succeeds or a data race is reported, health lost, aliasing).

- [ ] **Step 3: Implement**

`admin/admin.go`, the `Service` struct:

```go
type Service struct {
	d Deps

	// mu serialises writes. A conflict check and the write it guards must
	// see the same route table, or two concurrent creates both pass.
	mu sync.Mutex
}
```

(add `"sync"` to the imports).

`admin/clone.go`:

```go
package admin

import (
	"maps"
	"slices"

	bastion "github.com/xraph/bastion"
)

// The service stores copies of everything it is handed, so a caller that
// reuses its DTO cannot change a live route behind the proxy's back.

func clonePtr[T any](p *T) *T {
	if p == nil {
		return nil
	}

	v := *p

	return &v
}

func cloneHeaders(p bastion.HeaderPolicy) bastion.HeaderPolicy {
	return bastion.HeaderPolicy{Add: maps.Clone(p.Add), Set: maps.Clone(p.Set), Remove: slices.Clone(p.Remove)}
}

func cloneTransform(t *bastion.TransformConfig) *bastion.TransformConfig {
	if t == nil {
		return nil
	}

	return &bastion.TransformConfig{
		RequestHeaders:  cloneHeaders(t.RequestHeaders),
		ResponseHeaders: cloneHeaders(t.ResponseHeaders),
	}
}

func cloneTraffic(p *bastion.TrafficPolicy) *bastion.TrafficPolicy {
	if p == nil {
		return nil
	}

	cp := *p
	cp.Rules = slices.Clone(p.Rules)

	for i := range cp.Rules {
		cp.Rules[i].TargetTags = slices.Clone(cp.Rules[i].TargetTags)
	}

	return &cp
}

func cloneRateLimit(p *bastion.RateLimitConfig) *bastion.RateLimitConfig { return clonePtr(p) }

func cloneAuth(p *bastion.RouteAuthConfig) *bastion.RouteAuthConfig {
	if p == nil {
		return nil
	}

	cp := *p
	cp.Providers = slices.Clone(p.Providers)
	cp.Scopes = slices.Clone(p.Scopes)

	return &cp
}

func cloneRetry(p *bastion.RetryConfig) *bastion.RetryConfig {
	if p == nil {
		return nil
	}

	cp := *p
	cp.RetryableStatus = slices.Clone(p.RetryableStatus)
	cp.RetryableMethods = slices.Clone(p.RetryableMethods)

	return &cp
}

func cloneCache(p *bastion.RouteCacheConfig) *bastion.RouteCacheConfig {
	if p == nil {
		return nil
	}

	cp := *p
	cp.Methods = slices.Clone(p.Methods)
	cp.VaryBy = slices.Clone(p.VaryBy)

	return &cp
}
```

In `admin/writes.go`:

- In `build`, replace `targets = append(targets, newTarget(t.ID, td, weight))` (the changed-target branch) with:

```go
				nt := newTarget(t.ID, td, weight)
				// What the health checker last learned about this upstream
				// still holds after a weight or tag edit.
				nt.Healthy = t.Healthy
				targets = append(targets, nt)
```

- In `build`'s returned route, replace the stored fields with copies:

```go
		Headers:        cloneHeaders(dto.Headers),
		...
		Retry:          cloneRetry(dto.Retry),
		Timeout:        clonePtr(dto.Timeout),
		RateLimit:      cloneRateLimit(dto.RateLimit),
		Auth:           cloneAuth(dto.Auth),
		CircuitBreaker: clonePtr(dto.CircuitBreaker),
		Cache:          cloneCache(dto.Cache),
		TrafficPolicy:  cloneTraffic(dto.TrafficPolicy),
		Transform:      cloneTransform(dto.Transform),
		Metadata:       maps.Clone(dto.Metadata),
```

and `Methods: upper(dto.Methods)` already copies.

- At the top of `CreateRoute`, `UpdateRoute`, `DeleteRoute` and `SetEnabled`:

```go
	s.mu.Lock()
	defer s.mu.Unlock()
```

`forget` and `manual` are called with the lock held and must not take it.

- Add `Entry`:

```go
// Entry returns a manual route's values as the operator entered them, with
// nothing redacted. It is for merging a partial update, never for display.
func (s *Service) Entry(id string) (bastion.RouteDTO, error) {
	r, err := s.manual(id)
	if err != nil {
		return bastion.RouteDTO{}, err
	}

	in := s.input(r)
	dto := bastion.RouteDTO{
		Path:           in.Path,
		Methods:        slices.Clone(r.Methods),
		StripPrefix:    r.StripPrefix,
		AddPrefix:      r.AddPrefix,
		RewritePath:    r.RewritePath,
		Headers:        cloneHeaders(r.Headers),
		Protocol:       r.Protocol,
		Priority:       in.Priority,
		Enabled:        r.Enabled,
		Retry:          cloneRetry(r.Retry),
		Timeout:        clonePtr(r.Timeout),
		RateLimit:      cloneRateLimit(r.RateLimit),
		Auth:           cloneAuth(r.Auth),
		CircuitBreaker: clonePtr(r.CircuitBreaker),
		Cache:          cloneCache(r.Cache),
		TrafficPolicy:  cloneTraffic(r.TrafficPolicy),
		Transform:      cloneTransform(r.Transform),
		Metadata:       maps.Clone(r.Metadata),
		Targets:        make([]bastion.TargetDTO, 0, len(r.Targets)),
	}

	for _, t := range r.Targets {
		dto.Targets = append(dto.Targets, bastion.TargetDTO{
			URL: t.URL, Weight: t.Weight, Tags: slices.Clone(t.Tags), Metadata: maps.Clone(t.Metadata), TLS: t.TLS,
		})
	}

	return dto, nil
}
```

`Entry` only reads, so it does not take `s.mu`. `TestEntryRoundTripsEverything` asserts the target object is unchanged after the round trip, which needs `sameTarget` to see equal tags (`nil` versus `[]string{}`): `slices.Clone(nil)` is `nil` and `slices.Equal(nil, nil)` is true, so it holds; if the test fails on the target object, check that `Entry` does not turn `nil` tags or metadata into empty values.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `go test -race ./admin/ -v 2>&1 | grep -E "^(---|ok|FAIL)"`, then the Go gates.
Expected: PASS, 0 lint issues.

- [ ] **Step 5: Commit**

```bash
git add admin/clone.go
git commit --only admin/admin.go admin/writes.go admin/clone.go admin/writes_test.go -m "fix(admin): serialise writes, keep health across edits, copy what is stored

A conflict check and its write now hold one lock, so concurrent creates of
one path make one route. A target rebuilt by a weight or tag edit keeps
what the health checker last learned. The service stores copies of the
caller's maps and overrides. Entry returns a manual route as entered, for
merging a partial update."
```

---

### Task 2: Route commands

**Files:**
- Modify: `extension/contract/manifest.yaml` (four intents)
- Modify: `extension/contract/contract.go` (four binds)
- Create: `extension/contract/handlers_route_writes.go`, `extension/contract/handlers_route_writes_test.go`
- Modify: `extension/contract/errors.go` (add `audit`)
- Modify: `extension/contract/contract_test.go` (commands dispatch with a payload)
- Modify: `extension/contract/manifest_test.go` (counts and exact invalidates)

**Interfaces:**
- Consumes: Task 1's `Admin.Entry`, `Admin.CreateRoute/UpdateRoute/DeleteRoute/SetEnabled`; `admin.RedactURL`.
- Produces, JSON exactly:

```go
type targetInput struct {
	URL    string   `json:"url"`
	Weight int      `json:"weight"`
	Tags   []string `json:"tags,omitempty"`
}

// routeFields is what the editor sends on create.
type routeFields struct {
	Path        string                   `json:"path"`
	Methods     []string                 `json:"methods"`
	Priority    int                      `json:"priority"`
	Enabled     bool                     `json:"enabled"`
	Protocol    bastion.RouteProtocol    `json:"protocol"`
	StripPrefix bool                     `json:"stripPrefix"`
	AddPrefix   string                   `json:"addPrefix"`
	RewritePath string                   `json:"rewritePath"`
	Targets     []targetInput            `json:"targets"`
	RateLimit   *bastion.RateLimitConfig `json:"rateLimit"`
	Auth        *bastion.RouteAuthConfig `json:"auth"`
}

type routesCreateRequest = routeFields
type routesCreateResponse struct {
	ID string `json:"id"`
}

// routesUpdateRequest changes only the fields present. rateLimit and auth
// are raw: absent keeps the stored override, null clears it, an object
// replaces it.
type routesUpdateRequest struct {
	ID          string                 `json:"id"`
	Path        *string                `json:"path,omitempty"`
	Methods     *[]string              `json:"methods,omitempty"`
	Priority    *int                   `json:"priority,omitempty"`
	Enabled     *bool                  `json:"enabled,omitempty"`
	Protocol    *bastion.RouteProtocol `json:"protocol,omitempty"`
	StripPrefix *bool                  `json:"stripPrefix,omitempty"`
	AddPrefix   *string                `json:"addPrefix,omitempty"`
	RewritePath *string                `json:"rewritePath,omitempty"`
	Targets     *[]targetInput         `json:"targets,omitempty"`
	RateLimit   json.RawMessage        `json:"rateLimit,omitempty"`
	Auth        json.RawMessage        `json:"auth,omitempty"`
}
type routesUpdateResponse struct {
	ID string `json:"id"`
}

type routesDeleteRequest struct {
	ID string `json:"id"`
}
type routesDeleteResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

type routesSetEnabledRequest struct {
	ID      string `json:"id"`
	Enabled *bool  `json:"enabled"`
}
type routesSetEnabledResponse struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
	// Durable is false when the change ends at the next restart: a route
	// from the config file, or a gateway with no route store.
	Durable bool `json:"durable"`
}
```

Manifest lines (exactly):

```yaml
  - { name: routes.create,     kind: command, version: 1, capability: write, invalidates: [routes.list, routes.detail, upstreams.list, overview.stats, traffic.stats, circuits.list] }
  - { name: routes.update,     kind: command, version: 1, capability: write, invalidates: [routes.list, routes.detail, upstreams.list, overview.stats, traffic.stats, circuits.list] }
  - { name: routes.delete,     kind: command, version: 1, capability: write, invalidates: [routes.list, routes.detail, upstreams.list, overview.stats, traffic.stats, circuits.list] }
  - { name: routes.setEnabled, kind: command, version: 1, capability: write, invalidates: [routes.list, routes.detail, overview.stats] }
```

Update the manifest's header comment ("Commands arrive in slice 3.") to say commands invalidate exactly what they change.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_route_writes_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/xraph/forge/extensions/dashboard/contract"

	bastion "github.com/xraph/bastion"
)

func code(err error) (contract.ErrorCode, map[string]any) {
	var ce *contract.Error
	if errors.As(err, &ce) {
		return ce.Code, ce.Details
	}
	return "", nil
}

func boolp(b bool) *bool { return &b }
func intp(i int) *int    { return &i }

func seedOrders(t *testing.T, rm interface{ AddRoute(*bastion.Route) error }) {
	t.Helper()
	if err := rm.AddRoute(&bastion.Route{
		ID: "r1", Path: "/gw/orders", Source: bastion.SourceManual, Priority: 105, Enabled: true,
		Methods:   []string{"GET"},
		Headers:   bastion.HeaderPolicy{Set: map[string]string{"Authorization": "Bearer real"}},
		Transform: &bastion.TransformConfig{RequestHeaders: bastion.HeaderPolicy{Add: map[string]string{"X-A": "1"}}},
		Timeout:   &bastion.TimeoutConfig{Read: 5},
		RateLimit: &bastion.RateLimitConfig{Enabled: true, RequestsPerSec: 5, Burst: 10},
		Targets: []*bastion.Target{{ID: "r1/0", URL: "http://u:secret@orders:8080", Weight: 1,
			Metadata: map[string]string{"health_check_path": "/healthz"}}},
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRoutesCreate_AppliesInputAndAnswersID(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	out, err := routesCreateHandler(deps)(context.Background(), routesCreateRequest{
		Path: "/billing", Methods: []string{"GET"}, Priority: 3, Enabled: true,
		Targets: []targetInput{{URL: "http://billing:9000", Weight: 1}},
	}, contract.Principal{})
	if err != nil {
		t.Fatal(err)
	}
	d, err := deps.Admin.GetRoute(out.ID)
	if err != nil || d.Path != "/gw/billing" || d.Priority != 103 {
		t.Errorf("created route = %+v, %v", d, err)
	}
}

func TestRoutesCreate_RefusalsCarryDetails(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	seedOrders(t, rm)
	h := routesCreateHandler(deps)

	_, err := h(context.Background(), routesCreateRequest{Path: "/x"}, contract.Principal{})
	if c, d := code(err); c != contract.CodeBadRequest || d["field"] != "targets" {
		t.Errorf("no targets: %v %v", c, d)
	}

	_, err = h(context.Background(), routesCreateRequest{Path: "/orders", Methods: []string{"GET"},
		Targets: []targetInput{{URL: "http://o:1"}}}, contract.Principal{})
	if c, d := code(err); c != contract.CodeConflict || d["reason"] != "duplicate" || d["routeId"] != "r1" {
		t.Errorf("duplicate: %v %v", c, d)
	}
}

func TestRoutesUpdate_PriorityOnlyKeepsEverythingElse(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	seedOrders(t, rm)

	if _, err := routesUpdateHandler(deps)(context.Background(), routesUpdateRequest{ID: "r1", Priority: intp(7)}, contract.Principal{}); err != nil {
		t.Fatal(err)
	}
	r, _ := rm.GetRoute("r1")
	if r.Priority != 107 || r.Path != "/gw/orders" {
		t.Errorf("priority/path = %d/%q", r.Priority, r.Path)
	}
	if r.Headers.Set["Authorization"] != "Bearer real" || r.Transform.RequestHeaders.Add["X-A"] != "1" ||
		r.Timeout == nil || r.RateLimit == nil || r.Targets[0].Metadata["health_check_path"] != "/healthz" ||
		r.Targets[0].URL != "http://u:secret@orders:8080" {
		t.Errorf("a field the editor did not send changed: %+v", r)
	}
}

func TestRoutesUpdate_MaskedURLMapsBackToTheStoredOne(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	seedOrders(t, rm)

	// What the editor sends back after loading routes.detail.
	targets := []targetInput{{URL: "http://u:xxxxx@orders:8080", Weight: 3}}
	if _, err := routesUpdateHandler(deps)(context.Background(), routesUpdateRequest{ID: "r1", Targets: &targets}, contract.Principal{}); err != nil {
		t.Fatal(err)
	}
	r, _ := rm.GetRoute("r1")
	if r.Targets[0].URL != "http://u:secret@orders:8080" {
		t.Errorf("stored URL = %q; the masked password was saved", r.Targets[0].URL)
	}
	if r.Targets[0].Weight != 3 || r.Targets[0].Metadata["health_check_path"] != "/healthz" {
		t.Errorf("target = %+v, want weight 3 and its metadata kept", r.Targets[0])
	}
}

func TestRoutesUpdate_RateLimitAbsentNullObject(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	seedOrders(t, rm)
	h := routesUpdateHandler(deps)

	_, _ = h(context.Background(), routesUpdateRequest{ID: "r1", Enabled: boolp(true)}, contract.Principal{})
	if r, _ := rm.GetRoute("r1"); r.RateLimit == nil {
		t.Fatal("absent rateLimit cleared the override")
	}

	_, _ = h(context.Background(), routesUpdateRequest{ID: "r1", RateLimit: json.RawMessage(`{"enabled":true,"requestsPerSec":1,"burst":2}`)}, contract.Principal{})
	if r, _ := rm.GetRoute("r1"); r.RateLimit == nil || r.RateLimit.Burst != 2 {
		t.Fatalf("object did not replace: %+v", r.RateLimit)
	}

	_, _ = h(context.Background(), routesUpdateRequest{ID: "r1", RateLimit: json.RawMessage(`null`)}, contract.Principal{})
	if r, _ := rm.GetRoute("r1"); r.RateLimit != nil {
		t.Error("null did not clear the override")
	}

	_, err := h(context.Background(), routesUpdateRequest{ID: "r1", RateLimit: json.RawMessage(`"nope"`)}, contract.Principal{})
	if c, d := code(err); c != contract.CodeBadRequest || d["field"] != "rateLimit" {
		t.Errorf("bad rateLimit: %v %v", c, d)
	}
}

func TestRouteWrites_RefuseDiscoveredRoutes(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "farp-x", Path: "/x", Source: bastion.SourceFARP})

	_, err := routesUpdateHandler(deps)(context.Background(), routesUpdateRequest{ID: "farp-x", Priority: intp(1)}, contract.Principal{})
	if c, d := code(err); c != contract.CodeConflict || d["reason"] != "source" || d["source"] != "farp" {
		t.Errorf("update: %v %v", c, d)
	}
	_, err = routesSetEnabledHandler(deps)(context.Background(), routesSetEnabledRequest{ID: "farp-x", Enabled: boolp(false)}, contract.Principal{})
	if c, _ := code(err); c != contract.CodeConflict {
		t.Errorf("setEnabled: %v", c)
	}
}

func TestRoutesSetEnabled_DurabilityAndRequiredField(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual, Enabled: true})
	h := routesSetEnabledHandler(deps)

	if _, err := h(context.Background(), routesSetEnabledRequest{ID: "manual-/users"}, contract.Principal{}); func() bool { c, _ := code(err); return c != contract.CodeBadRequest }() {
		t.Errorf("missing enabled: err = %v, want BAD_REQUEST", err)
	}
	out, err := h(context.Background(), routesSetEnabledRequest{ID: "manual-/users", Enabled: boolp(false)}, contract.Principal{})
	if err != nil || out.Enabled || out.Durable {
		t.Errorf("out = %+v, err = %v; want disabled and not durable", out, err)
	}
}

func TestRoutesDelete(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	seedOrders(t, rm)
	out, err := routesDeleteHandler(deps)(context.Background(), routesDeleteRequest{ID: "r1"}, contract.Principal{})
	if err != nil || !out.OK {
		t.Fatalf("out = %+v, err = %v", out, err)
	}
	_, err = routesDeleteHandler(deps)(context.Background(), routesDeleteRequest{ID: "r1"}, contract.Principal{})
	if c, _ := code(err); c != contract.CodeNotFound {
		t.Errorf("second delete: %v", c)
	}
}
```

`newTestDeps` builds the gateway with `WithBasePath("/gw")` and an admin service with `BasePath: "/gw"`, so `/billing` stores as `/gw/billing`. Check `routing.Manager` satisfies the `AddRoute` interface used by `seedOrders`; if `newTestDeps` returns `*routing.Manager`, it does.

In `contract_test.go`'s `TestEveryDeclaredIntentIsRegistered`, choose the request kind from the manifest:

```go
		kind := dashcontract.KindQuery
		if intent.Kind == dashcontract.IntentKindCommand {
			kind = dashcontract.KindCommand
		}
		req := dashcontract.Request{
			Envelope: "v1", Kind: kind, Contributor: ContributorName, Intent: intent.Name, IntentVersion: 1,
		}
		if kind == dashcontract.KindQuery {
			req.Params = map[string]any{}
		} else {
			req.Payload = json.RawMessage(`{}`)
		}
```

(add `encoding/json` to its imports).

In `manifest_test.go`, replace `TestManifest_NineQueriesNamedBastion` with:

```go
func TestManifest_IntentsNamedBastion(t *testing.T) {
	m := loadManifest(t)
	if m.Contributor.Name != ContributorName {
		t.Errorf("contributor = %q", m.Contributor.Name)
	}
	queries, commands := 0, 0
	for _, in := range m.Intents {
		switch in.Kind {
		case dashcontract.IntentKindQuery:
			queries++
		case dashcontract.IntentKindCommand:
			commands++
		}
	}
	if queries != 9 || commands != 4 {
		t.Errorf("queries/commands = %d/%d, want 9/4", queries, commands)
	}
}

func TestManifest_CommandsInvalidateExactly(t *testing.T) {
	routeWrite := []string{"routes.list", "routes.detail", "upstreams.list", "overview.stats", "traffic.stats", "circuits.list"}
	want := map[string][]string{
		"routes.create":     routeWrite,
		"routes.update":     routeWrite,
		"routes.delete":     routeWrite,
		"routes.setEnabled": {"routes.list", "routes.detail", "overview.stats"},
	}
	seen := 0
	for _, in := range loadManifest(t).Intents {
		if w, ok := want[in.Name]; ok {
			seen++
			if !reflect.DeepEqual(in.Invalidates, w) {
				t.Errorf("%s invalidates %v, want %v", in.Name, in.Invalidates, w)
			}
		}
	}
	if seen != len(want) {
		t.Errorf("found %d of %d commands", seen, len(want))
	}
}
```

(add `reflect`). `TestManifest_EveryIntentHasACacheHint` must skip commands: change its final loop to `if in.Kind == dashcontract.IntentKindQuery && !cached[in.Name]`.

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./extension/contract/ 2>&1 | head -8`
Expected: compile failure, undefined `routesCreateHandler` and friends.

- [ ] **Step 3: Implement**

`extension/contract/errors.go`, add:

```go
// audit records a dashboard write. The contract has no HTTP request for
// the gateway's access log, and bastion's audit sink is never written, so
// one Info line per write is the trail there is.
func (d Deps) audit(intent, subject string, p contract.Principal) {
	if d.Logger == nil {
		return
	}

	operator := ""
	if p.User != nil {
		operator = p.User.Subject
	}

	d.Logger.Info("bastion: dashboard write", forge.F("intent", intent), forge.F("subject", subject), forge.F("operator", operator))
}

// fieldError is a BAD_REQUEST about one input field.
func fieldError(field, msg string) error {
	return &contract.Error{Code: contract.CodeBadRequest, Message: msg, Details: map[string]any{"field": field}}
}
```

`extension/contract/handlers_route_writes.go`: the types from Interfaces, then:

```go
func (f routeFields) dto() bastion.RouteDTO {
	dto := bastion.RouteDTO{
		Path: f.Path, Methods: f.Methods, Priority: f.Priority, Enabled: f.Enabled, Protocol: f.Protocol,
		StripPrefix: f.StripPrefix, AddPrefix: f.AddPrefix, RewritePath: f.RewritePath,
		RateLimit: f.RateLimit, Auth: f.Auth,
		Targets: make([]bastion.TargetDTO, 0, len(f.Targets)),
	}
	for _, t := range f.Targets {
		dto.Targets = append(dto.Targets, bastion.TargetDTO{URL: t.URL, Weight: t.Weight, Tags: t.Tags})
	}

	return dto
}

// targets merges edited targets into the stored ones. A URL the dashboard
// showed masked maps back to the stored URL, so a masked password is never
// saved, and a kept upstream keeps the metadata and TLS the editor does not
// show.
func mergeTargets(stored []bastion.TargetDTO, in []targetInput) []bastion.TargetDTO {
	byShown := make(map[string]bastion.TargetDTO, len(stored))
	for _, s := range stored {
		byShown[admin.RedactURL(s.URL)] = s
	}

	out := make([]bastion.TargetDTO, 0, len(in))
	for _, t := range in {
		td := bastion.TargetDTO{URL: t.URL, Weight: t.Weight, Tags: t.Tags}
		if s, ok := byShown[t.URL]; ok {
			td.URL, td.Metadata, td.TLS = s.URL, s.Metadata, s.TLS
		}

		out = append(out, td)
	}

	return out
}

func (in routesUpdateRequest) apply(dto *bastion.RouteDTO) error {
	if in.Path != nil {
		dto.Path = *in.Path
	}
	if in.Methods != nil {
		dto.Methods = *in.Methods
	}
	if in.Priority != nil {
		dto.Priority = *in.Priority
	}
	if in.Enabled != nil {
		dto.Enabled = *in.Enabled
	}
	if in.Protocol != nil {
		dto.Protocol = *in.Protocol
	}
	if in.StripPrefix != nil {
		dto.StripPrefix = *in.StripPrefix
	}
	if in.AddPrefix != nil {
		dto.AddPrefix = *in.AddPrefix
	}
	if in.RewritePath != nil {
		dto.RewritePath = *in.RewritePath
	}
	if in.Targets != nil {
		dto.Targets = mergeTargets(dto.Targets, *in.Targets)
	}

	if len(in.RateLimit) > 0 {
		var rl *bastion.RateLimitConfig
		if err := json.Unmarshal(in.RateLimit, &rl); err != nil {
			return fieldError("rateLimit", "rate limit must be an object or null")
		}
		dto.RateLimit = rl
	}

	if len(in.Auth) > 0 {
		var a *bastion.RouteAuthConfig
		if err := json.Unmarshal(in.Auth, &a); err != nil {
			return fieldError("auth", "auth must be an object or null")
		}
		dto.Auth = a
	}

	return nil
}

func routesCreateHandler(deps Deps) func(context.Context, routesCreateRequest, contract.Principal) (routesCreateResponse, error) {
	return func(_ context.Context, in routesCreateRequest, p contract.Principal) (routesCreateResponse, error) {
		r, err := deps.Admin.CreateRoute(in.dto())
		if err != nil {
			return routesCreateResponse{}, deps.mapError("routes.create", err)
		}

		deps.audit("routes.create", r.ID, p)

		return routesCreateResponse{ID: r.ID}, nil
	}
}

func routesUpdateHandler(deps Deps) func(context.Context, routesUpdateRequest, contract.Principal) (routesUpdateResponse, error) {
	return func(_ context.Context, in routesUpdateRequest, p contract.Principal) (routesUpdateResponse, error) {
		id, err := requireID(in.ID)
		if err != nil {
			return routesUpdateResponse{}, err
		}

		dto, err := deps.Admin.Entry(id)
		if err != nil {
			return routesUpdateResponse{}, deps.mapError("routes.update", err)
		}

		if err := in.apply(&dto); err != nil {
			return routesUpdateResponse{}, err
		}

		if _, err := deps.Admin.UpdateRoute(id, dto); err != nil {
			return routesUpdateResponse{}, deps.mapError("routes.update", err)
		}

		deps.audit("routes.update", id, p)

		return routesUpdateResponse{ID: id}, nil
	}
}

func routesDeleteHandler(deps Deps) func(context.Context, routesDeleteRequest, contract.Principal) (routesDeleteResponse, error) {
	return func(_ context.Context, in routesDeleteRequest, p contract.Principal) (routesDeleteResponse, error) {
		id, err := requireID(in.ID)
		if err != nil {
			return routesDeleteResponse{}, err
		}

		if err := deps.Admin.DeleteRoute(id); err != nil {
			return routesDeleteResponse{}, deps.mapError("routes.delete", err)
		}

		deps.audit("routes.delete", id, p)

		return routesDeleteResponse{OK: true, ID: id}, nil
	}
}

func routesSetEnabledHandler(deps Deps) func(context.Context, routesSetEnabledRequest, contract.Principal) (routesSetEnabledResponse, error) {
	return func(_ context.Context, in routesSetEnabledRequest, p contract.Principal) (routesSetEnabledResponse, error) {
		id, err := requireID(in.ID)
		if err != nil {
			return routesSetEnabledResponse{}, err
		}

		if in.Enabled == nil {
			return routesSetEnabledResponse{}, fieldError("enabled", "enabled is required")
		}

		durable, err := deps.Admin.SetEnabled(id, *in.Enabled)
		if err != nil {
			return routesSetEnabledResponse{}, deps.mapError("routes.setEnabled", err)
		}

		deps.audit("routes.setEnabled", id, p)

		return routesSetEnabledResponse{ID: id, Enabled: *in.Enabled, Durable: durable}, nil
	}
}
```

Imports: `context`, `encoding/json`, `contract`, `bastion`, `admin`.

Bind the four in `contract.go` with `dispatcher.RegisterCommand`, after the queries, and add the manifest lines.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `go test -race ./extension/contract/ -v 2>&1 | grep -E "^(---|ok|FAIL)"`, then the Go gates.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/contract/handlers_route_writes.go extension/contract/handlers_route_writes_test.go
git commit --only extension/contract/manifest.yaml extension/contract/contract.go extension/contract/errors.go extension/contract/handlers_route_writes.go extension/contract/handlers_route_writes_test.go extension/contract/contract_test.go extension/contract/manifest_test.go -m "feat(contract): create, edit, delete and enable manual routes

An edit changes only the fields it sends and keeps everything the editor
does not show, from headers to target metadata. A masked target URL maps
back to the stored one, so the dashboard never saves a masked password."
```

---

### Task 3: Discovery, OpenAPI and circuit commands

**Files:**
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Create: `extension/contract/handlers_platform_writes.go`, `extension/contract/handlers_platform_writes_test.go`
- Modify: `extension/contract/manifest_test.go`, `extension/contract/transport_test.go`
- Modify: `discovery/openapi.go:1891-1897` (`HandleRefresh` context)

**Interfaces:**
- Produces:

```go
type discoveryRefreshRequest struct{}
type discoveryRefreshResponse struct {
	OK bool `json:"ok"`
}
type openapiRefreshRequest struct{}
type openapiRefreshResponse struct {
	Started bool `json:"started"`
}
type circuitsResetRequest struct {
	TargetID string `json:"targetId"`
}
type circuitsResetResponse struct {
	TargetID string               `json:"targetId"`
	State    bastion.CircuitState `json:"state"`
}
```

Manifest lines (exactly):

```yaml
  - { name: discovery.refresh, kind: command, version: 1, capability: write, invalidates: [services.list, routes.list, routes.detail, upstreams.list, overview.stats, openapi.summary] }
  - { name: openapi.refresh,   kind: command, version: 1, capability: write, invalidates: [openapi.summary] }
  - { name: circuits.reset,    kind: command, version: 1, capability: write, invalidates: [circuits.list, upstreams.list, routes.detail, overview.stats] }
```

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_platform_writes_test.go`:

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/forge/extensions/dashboard/contract"

	bastion "github.com/xraph/bastion"
)

func TestDiscoveryRefresh_OffIsAConflictWithAReason(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	_, err := discoveryRefreshHandler(deps)(context.Background(), discoveryRefreshRequest{}, contract.Principal{})
	if c, d := code(err); c != contract.CodeConflict || d["reason"] != "discoveryOff" {
		t.Errorf("err = %v %v, want CONFLICT discoveryOff", c, d)
	}
}

func TestOpenAPIRefresh_NotRunningIsAConflictWithAReason(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	_, err := openapiRefreshHandler(deps)(context.Background(), openapiRefreshRequest{}, contract.Principal{})
	if c, d := code(err); c != contract.CodeConflict || d["reason"] != "openapiOff" {
		t.Errorf("err = %v %v, want CONFLICT openapiOff", c, d)
	}
}

func TestCircuitsReset(t *testing.T) {
	deps, rm, cbm, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "a", Path: "/gw/a", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "a/0", URL: "http://a:1"}}})
	for i := 0; i < deps.Gateway.Config().CircuitBreaker.FailureThreshold; i++ {
		cbm.Get("a/0").RecordFailure()
	}
	h := circuitsResetHandler(deps)

	out, err := h(context.Background(), circuitsResetRequest{TargetID: "a/0"}, contract.Principal{})
	if err != nil || out.State != bastion.CircuitClosed {
		t.Fatalf("out = %+v, err = %v", out, err)
	}
	if s := cbm.Get("a/0").State(); s != bastion.CircuitClosed {
		t.Errorf("breaker = %s after reset", s)
	}

	if _, err := h(context.Background(), circuitsResetRequest{TargetID: "never-used"}, contract.Principal{}); func() bool { c, _ := code(err); return c != contract.CodeNotFound }() {
		t.Errorf("unknown target: %v, want NOT_FOUND", err)
	}
	if _, err := h(context.Background(), circuitsResetRequest{}, contract.Principal{}); func() bool { c, _ := code(err); return c != contract.CodeBadRequest }() {
		t.Errorf("missing targetId: %v, want BAD_REQUEST", err)
	}
}
```

Check `newTestDeps`'s gateway has discovery switched off by default (`Config().Discovery.Enabled` false or `Discovery()` nil). If the default config enables discovery, the handler still refuses because `Discovery()` is nil without the discovery extension; the test holds either way.

In `manifest_test.go`, change the expected counts to `9/7` and add to the `want` map:

```go
		"discovery.refresh": {"services.list", "routes.list", "routes.detail", "upstreams.list", "overview.stats", "openapi.summary"},
		"openapi.refresh":   {"openapi.summary"},
		"circuits.reset":    {"circuits.list", "upstreams.list", "routes.detail", "overview.stats"},
```

In `transport_test.go`, add a command over the wire:

```go
func TestCommandOverTheWireCarriesInvalidates(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual, Enabled: true})

	reg := dashcontract.NewRegistry()
	wreg := dashcontract.NewWardenRegistry()
	d := dispatcher.New(nil)
	if err := Register(d, reg, wreg, deps); err != nil {
		t.Fatal(err)
	}

	body := `{"envelope":"v1","kind":"command","contributor":"bastion","intent":"routes.setEnabled",` +
		`"csrf":"test","idempotencyKey":"test","payload":{"id":"manual-/users","enabled":false}}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/dashboard/v1", strings.NewReader(body))
	rec := httptest.NewRecorder()
	transport.NewHandler(reg, wreg, d, nil).ServeHTTP(rec, req)

	var resp dashcontract.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || !resp.OK {
		t.Fatalf("response: %s", rec.Body)
	}
	want := []string{"routes.list", "routes.detail", "overview.stats"}
	if !reflect.DeepEqual(resp.Meta.Invalidates, want) {
		t.Errorf("meta.invalidates = %v, want %v", resp.Meta.Invalidates, want)
	}
}
```

(add `reflect` to its imports if missing).

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./extension/contract/ 2>&1 | head -6`
Expected: compile failure on the undefined handlers.

- [ ] **Step 3: Implement**

`extension/contract/handlers_platform_writes.go`: the types, then:

```go
const (
	discoveryRefreshTimeout = 30 * time.Second
	openapiRefreshTimeout   = 2 * time.Minute
)

func discoveryRefreshHandler(deps Deps) func(context.Context, discoveryRefreshRequest, contract.Principal) (discoveryRefreshResponse, error) {
	return func(ctx context.Context, _ discoveryRefreshRequest, p contract.Principal) (discoveryRefreshResponse, error) {
		disc := deps.Gateway.Discovery()
		if !deps.Gateway.Config().Discovery.Enabled || disc == nil {
			return discoveryRefreshResponse{}, &contract.Error{
				Code:    contract.CodeConflict,
				Message: "discovery is switched off in the gateway config, so there is nothing to refresh",
				Details: map[string]any{"reason": "discoveryOff"},
			}
		}

		// Detached from the request: an operator who navigates away should
		// not cancel a scan halfway through rebuilding routes.
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), discoveryRefreshTimeout)
		defer cancel()

		if err := disc.Refresh(rctx); err != nil {
			if deps.Logger != nil {
				deps.Logger.Warn("bastion/contract: discovery refresh failed", forge.F("error", err))
			}

			return discoveryRefreshResponse{}, &contract.Error{
				Code:    contract.CodeUnavailable,
				Message: "the discovery refresh failed; the gateway log has the cause",
			}
		}

		deps.audit("discovery.refresh", "", p)

		return discoveryRefreshResponse{OK: true}, nil
	}
}

func openapiRefreshHandler(deps Deps) func(context.Context, openapiRefreshRequest, contract.Principal) (openapiRefreshResponse, error) {
	return func(_ context.Context, _ openapiRefreshRequest, p contract.Principal) (openapiRefreshResponse, error) {
		oa := deps.Gateway.OpenAPI()
		if oa == nil {
			return openapiRefreshResponse{}, &contract.Error{
				Code:    contract.CodeConflict,
				Message: "OpenAPI aggregation is not running on this gateway",
				Details: map[string]any{"reason": "openapiOff"},
			}
		}

		// Fetching every service's spec can take a while, so it runs in the
		// background with its own bound. The aggregator drops a second
		// refresh while one is in flight.
		go func() {
			rctx, cancel := context.WithTimeout(context.Background(), openapiRefreshTimeout)
			defer cancel()
			oa.Refresh(rctx)
		}()

		deps.audit("openapi.refresh", "", p)

		return openapiRefreshResponse{Started: true}, nil
	}
}

func circuitsResetHandler(deps Deps) func(context.Context, circuitsResetRequest, contract.Principal) (circuitsResetResponse, error) {
	return func(_ context.Context, in circuitsResetRequest, p contract.Principal) (circuitsResetResponse, error) {
		id := strings.TrimSpace(in.TargetID)
		if id == "" {
			return circuitsResetResponse{}, fieldError("targetId", "targetId is required")
		}

		if err := deps.Gateway.ResetCircuit(id); err != nil {
			if errors.Is(err, bastion.ErrCircuitNotFound) {
				return circuitsResetResponse{}, &contract.Error{
					Code:    contract.CodeNotFound,
					Message: "this target has no circuit breaker yet; it gets one on its first proxied request",
				}
			}

			return circuitsResetResponse{}, deps.mapError("circuits.reset", err)
		}

		deps.audit("circuits.reset", id, p)

		return circuitsResetResponse{TargetID: id, State: bastion.CircuitClosed}, nil
	}
}
```

Imports: `context`, `errors`, `strings`, `time`, `forge`, `contract`, `bastion`.

`discovery/openapi.go`, `HandleRefresh`:

```go
func (oa *OpenAPIAggregator) HandleRefresh(ctx forge.Context) error {
	// Detached: the request context ends when this handler returns, which
	// used to cancel the refresh before it fetched anything.
	go oa.Refresh(context.WithoutCancel(ctx.Request().Context()))
```

Confirm `context` is imported in `openapi.go`.

Bind the three in `contract.go` with `RegisterCommand` and add the manifest lines.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `go test -race ./extension/contract/ ./discovery/ -v 2>&1 | grep -E "^(---|ok|FAIL)"`, then the Go gates.
Expected: PASS, lint 0.

- [ ] **Step 5: Commit**

```bash
git add extension/contract/handlers_platform_writes.go extension/contract/handlers_platform_writes_test.go
git commit --only extension/contract/manifest.yaml extension/contract/contract.go extension/contract/handlers_platform_writes.go extension/contract/handlers_platform_writes_test.go extension/contract/manifest_test.go extension/contract/transport_test.go discovery/openapi.go -m "feat(contract): refresh discovery and OpenAPI, reset a circuit

Refreshes run on contexts detached from the request. The REST OpenAPI
refresh used the request context and was cancelled as soon as its handler
returned; it is detached now too."
```

---

### Task 4: Fixture commands

**Files (forge-dashboard):**
- Modify: `packages/fixture-server/bastion-fixtures.mjs`
- Modify: `packages/fixture-server/verify.mjs` (through the recipe below)

**Interfaces:**
- Consumes: the Go shapes from Tasks 2 and 3.
- Produces: seven command entries in the handler table returned by `createBastionHandlers`, each `{ kind: "command", invalidates: [...exactly as the Go manifest], handler }`. Command handlers are defined **after** the query handlers in the table, and in this order: `routes.create`, `routes.update`, `routes.setEnabled`, `routes.delete`, `discovery.refresh`, `openapi.refresh`, `circuits.reset`, because `verify.mjs` walks intents in table order and `routes.delete` deletes what `routes.create` made.

Behaviour, mirroring Go:
- `routes.create`: validate like admin (`path` starts with `/` else `BAD_REQUEST` field `path`; at least one target else field `targets`; each URL `http`, `https`, `ws` or `wss` with a host else field `targets`). Conflict when another **manual** route has the same full path (`"/gw" + path`) and overlapping methods (empty means any): `CONFLICT` `{reason: "duplicate", routeId}`. New ids are `00000000-0000-4000-8000-00000000000N` with N counting from 1 per reset. Stored: `path: "/gw" + path`, `priority: priority + 100`, `input: {path, priority}`, `source: "manual"`, `editable: true`, `config: false`, targets `{id: "<routeId>/<i>", url, weight: weight || 1, tags: tags ?? [], healthy: true, circuitState: "closed", stats: {activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0}, tls: false, metadataKeys: []}`, `headers: {}`, `rateLimit`/`auth` only when non-null. Answers `{id}`.
- `routes.update`: `id` required (`BAD_REQUEST` "id is required"); unknown `NOT_FOUND` "route not found"; non-manual `CONFLICT` `{reason: "source", source}`; applies only present fields; `rateLimit`/`auth` absent keep, `null` deletes the key, object replaces; a target URL equal to a stored target's masked URL keeps the stored one (the seed has none with userinfo, so this is a pass-through here); re-runs validation and the conflict check excluding itself. Answers `{id}`.
- `routes.setEnabled`: `enabled` must be a boolean else `BAD_REQUEST` field `enabled`; non-manual `CONFLICT` source; answers `{id, enabled, durable: false}` (the fixture has no route store).
- `routes.delete`: non-manual `CONFLICT` source; unknown `NOT_FOUND`; answers `{ok: true, id}`.
- `discovery.refresh`: answers `{ok: true}` and sets every seeded service's `discoveredAt` to now.
- `openapi.refresh`: answers `{started: true}` and sets the summary's `lastRefresh` to now (move `lastRefresh` into the mutable state so `openapi.summary` reads it).
- `circuits.reset`: `targetId` required (field `targetId`); unknown target `NOT_FOUND`; sets that target's `circuitState` to `"closed"`; answers `{targetId, state: "closed"}`.

- [ ] **Step 1: Implement the handlers**

Edit `bastion-fixtures.mjs` with the Edit tool only. Keep the existing query handlers byte for byte except where `openapi.summary` reads `lastRefresh` from state. Add helpers inside `createBastionHandlers`:

```js
  const bad = (field, message) => new FixtureError(400, "BAD_REQUEST", message, { field })
  const conflict = (message, details) => new FixtureError(409, "CONFLICT", message, details)
  const notFound = (message) => new FixtureError(404, "NOT_FOUND", message)
  const SCHEMES = new Set(["http:", "https:", "ws:", "wss:"])
  const ROUTE_WRITE = ["routes.list", "routes.detail", "upstreams.list", "overview.stats", "traffic.stats", "circuits.list"]

  function requireId(raw) {
    const id = typeof raw === "string" ? raw.trim() : ""
    if (!id) throw new FixtureError(400, "BAD_REQUEST", "id is required")
    return id
  }
  function find(id) {
    const r = bastion.routes.find((x) => x.id === id)
    if (!r) throw notFound("route not found")
    return r
  }
  function manual(id) {
    const r = find(id)
    if (r.source !== "manual") {
      throw conflict(`route "${id}" comes from ${r.source}; its next update would undo any change made here`, { reason: "source", source: r.source })
    }
    return r
  }
  function validate(f) {
    if (typeof f.path !== "string" || !f.path.startsWith("/")) throw bad("path", "must start with /")
    if (!Array.isArray(f.targets) || f.targets.length === 0) throw bad("targets", "at least one upstream is required")
    f.targets.forEach((t, i) => {
      let u
      try { u = new URL(t.url) } catch { u = null }
      if (!u || !u.host || !SCHEMES.has(u.protocol)) throw bad("targets", `upstream ${i + 1}: "${t.url}" is not an http, https, ws or wss URL`)
    })
  }
  const overlap = (a, b) => a.length === 0 || b.length === 0 || a.some((m) => b.includes(m))
  function checkConflict(id, fullPath, methods) {
    const other = bastion.routes.find((r) => r.id !== id && r.source === "manual" && r.path === fullPath && overlap(r.methods, methods))
    if (other) throw conflict(`route "${other.id}" already serves ${fullPath} for an overlapping method`, { reason: "duplicate", routeId: other.id })
  }
  function targetsFor(id, inputs, prior = []) {
    return inputs.map((t, i) => {
      const kept = prior.find((p) => p.url === t.url)
      return {
        ...(kept ?? { id: `${id}/${i}`, healthy: true, circuitState: "closed", stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [] }),
        url: t.url, weight: t.weight || 1, tags: t.tags ?? [],
      }
    })
  }
```

Track `bastion.nextId` in `seed()` (start at 1) so reset restores it. Then the seven handlers per the behaviour list, using `ROUTE_WRITE` and the other exact `invalidates` arrays. Write each in the shape of the existing query handlers.

- [ ] **Step 2: Add verify inputs and spot checks, and commit through the recipe**

`verify.mjs` holds another session's uncommitted edits. Do not edit it in place with anything but the Edit tool, and do not commit it with `--only`. Make the edits below with the Edit tool, then commit HEAD's version plus only your edits through a temporary index:

```bash
SCR=/Users/rexraphael/Work/xraph/forge-dashboard/.superpowers/sdd/bastion-slice3-scratch
mkdir -p "$SCR"
git show HEAD:packages/fixture-server/verify.mjs > "$SCR/verify.mjs"
# Apply the same two insertions to $SCR/verify.mjs with the Edit tool.
diff <(git show HEAD:packages/fixture-server/verify.mjs) "$SCR/verify.mjs"   # must show only your lines
export GIT_INDEX_FILE="$SCR/index"
git read-tree HEAD
git update-index --add --cacheinfo 100644,$(git hash-object -w packages/fixture-server/bastion-fixtures.mjs),packages/fixture-server/bastion-fixtures.mjs
git update-index --add --cacheinfo 100644,$(git hash-object -w "$SCR/verify.mjs"),packages/fixture-server/verify.mjs
TREE=$(git write-tree); OLD=$(git rev-parse HEAD)
NEW=$(git commit-tree "$TREE" -p "$OLD" -m "feat(fixture): model bastion's operator commands")
unset GIT_INDEX_FILE
git update-ref refs/heads/main "$NEW" "$OLD"
git reset -q -- packages/fixture-server/verify.mjs packages/fixture-server/bastion-fixtures.mjs
git show --stat HEAD
git diff HEAD -- packages/fixture-server/verify.mjs   # only the other session's edits
```

If `bastion-fixtures.mjs` has no foreign edits (`git diff HEAD -- packages/fixture-server/bastion-fixtures.mjs` shows only yours before you start), hashing it from the working tree is correct. If HEAD moves between `OLD` and `update-ref`, stop and report.

The two insertions in `verify.mjs`:

1. In the `INPUT` table, after the existing `"bastion::routes.detail"` line:

```js
  "bastion::routes.create": { path: "/verify", methods: ["GET"], priority: 1, enabled: true, protocol: "http", targets: [{ url: "http://verify:8080", weight: 1 }], rateLimit: null, auth: null },
  "bastion::routes.update": { id: "00000000-0000-4000-8000-000000000001", priority: 2 },
  "bastion::routes.setEnabled": { id: "00000000-0000-4000-8000-000000000001", enabled: false },
  "bastion::routes.delete": { id: "00000000-0000-4000-8000-000000000001" },
  "bastion::circuits.reset": { targetId: "9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36/1" },
```

2. At the end of the existing bastion spot-check block:

```js
    const cmd = (intent, input) => dispatch("bastion", intent, "command", input, csrf)
    const farp = await cmd("routes.update", { id: "farp-billing-http", priority: 1 })
    check("discovered route edit is CONFLICT source", farp.body?.error?.code === "CONFLICT" && farp.body?.error?.details?.reason === "source", JSON.stringify(farp.body))
    const dup = await cmd("routes.create", { path: "/users", methods: [], targets: [{ url: "http://users:8080", weight: 1 }] })
    check("duplicate path is CONFLICT duplicate", dup.body?.error?.details?.reason === "duplicate", JSON.stringify(dup.body))
    const noTargets = await cmd("routes.create", { path: "/empty", methods: [], targets: [] })
    check("no upstream is BAD_REQUEST on targets", noTargets.body?.error?.details?.field === "targets", JSON.stringify(noTargets.body))
    const toggled = await cmd("routes.setEnabled", { id: "manual-/users", enabled: false })
    check("setEnabled answers durable false", toggled.body?.data?.durable === false, JSON.stringify(toggled.body))
```

`check`, `call` and `csrf` are the ones the existing bastion block already defines.

- [ ] **Step 3: Run it over HTTP**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
SCR=/Users/rexraphael/Work/xraph/forge-dashboard/.superpowers/sdd/bastion-slice3-scratch
FIXTURE_PORT=8299 node packages/fixture-server/server.mjs > "$SCR/server.log" 2>&1 & echo $! > "$SCR/pid"
sleep 1
node packages/fixture-server/verify.mjs http://localhost:8299 > "$SCR/verify.log" 2>&1; echo "exit=$?"
grep -E "bastion|failures" "$SCR/verify.log" | tail -20
kill "$(cat "$SCR/pid")"
```

Expected: `exit=0`, every bastion command verified, the eight `bastion ...: true` spot-check lines.

---

### Task 5: Route editor (create and edit)

**Files (forge-dashboard):**
- Create: `packages/plugin-bastion/src/components/route-form.tsx`
- Create: `packages/plugin-bastion/src/pages/route-create.tsx`, `packages/plugin-bastion/src/pages/route-edit.tsx`
- Modify: `packages/plugin-bastion/src/types.ts` (add `RouteFields`, `RouteUpdate`, command responses)
- Modify: `packages/plugin-bastion/src/keys.ts` (`routeEditPath`)
- Modify: `packages/plugin-bastion/src/index.tsx` (two routes)
- Create: `packages/plugin-bastion/test/route-form.test.tsx`, `packages/plugin-bastion/test/route-editor.test.tsx`
- Modify: `packages/plugin-bastion/test/plugin.test.tsx` (route list)

**Interfaces:**
- Produces:

```ts
// types.ts additions, mirroring Task 2's Go types.
export interface TargetInput {
  url: string
  weight: number
  tags?: string[]
}
export interface RateLimit {
  enabled: boolean
  requestsPerSec: number
  burst: number
  perClient: boolean
  keyHeader?: string
}
export interface RouteAuth {
  enabled: boolean
  providers?: string[]
  scopes?: string[]
  skipAuth?: boolean
  forwardAuth?: boolean
}
export interface RouteFields {
  path: string
  methods: string[]
  priority: number
  enabled: boolean
  protocol: RouteProtocol
  stripPrefix: boolean
  addPrefix: string
  rewritePath: string
  targets: TargetInput[]
  rateLimit: RateLimit | null
  auth: RouteAuth | null
}
export interface RouteIdResponse {
  id: string
}
export interface SetEnabledResponse {
  id: string
  enabled: boolean
  durable: boolean
}

// keys.ts
export function routeEditPath(id: string): string  // `${routePath(id)}/edit`

// route-form.tsx
export const METHODS: readonly string[]  // GET POST PUT PATCH DELETE HEAD OPTIONS
export interface RouteFormValues { ... }  // below
export const EMPTY_ROUTE: RouteFormValues
export function valuesFromDetail(d: RouteDetail): RouteFormValues
export function fieldsFromValues(v: RouteFormValues): RouteFields
export function RouteForm(props: RouteFormProps): JSX.Element

// pages
export const BastionRouteCreatePage: ComponentType<PluginPageProps>
export const BastionRouteEditPage: ComponentType<PluginPageProps>
```

`RouteDetail` in `types.ts` types `rateLimit` and `auth` as `Record<string, unknown>`; change those two to `RateLimit` and `RouteAuth` (optional, as now).

- [ ] **Step 1: Write the failing tests**

`test/route-form.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { EMPTY_ROUTE, fieldsFromValues, valuesFromDetail } from "../src/components/route-form"
import type { RouteDetail } from "../src/types"

const DETAIL: RouteDetail = {
  id: "manual-/users", path: "/gw/users", methods: ["GET"], protocol: "http", source: "manual", serviceName: "",
  priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
  updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
  stripPrefix: true, addPrefix: "", rewritePath: "", headers: {},
  rateLimit: { enabled: true, requestsPerSec: 5, burst: 10, perClient: true, keyHeader: "X-Client" },
  metadataKeys: [], version: 1, createdAt: "2026-09-29T10:00:00Z",
  targets: [{ id: "t0", url: "http://u:xxxxx@users:8080", weight: 2, tags: ["blue"], healthy: true, circuitState: "closed",
    stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [] }],
}

describe("route form values", () => {
  it("prefills path and priority as entered, never the effective ones", () => {
    const v = valuesFromDetail(DETAIL)
    expect(v.path).toBe("/users")
    expect(v.priority).toBe("10")
  })

  it("round-trips a detail into fields, keeping the masked URL for the server to map back", () => {
    const f = fieldsFromValues(valuesFromDetail(DETAIL))
    expect(f).toEqual({
      path: "/users", methods: ["GET"], priority: 10, enabled: true, protocol: "http",
      stripPrefix: true, addPrefix: "", rewritePath: "",
      targets: [{ url: "http://u:xxxxx@users:8080", weight: 2, tags: ["blue"] }],
      rateLimit: { enabled: true, requestsPerSec: 5, burst: 10, perClient: true, keyHeader: "X-Client" },
      auth: null,
    })
  })

  it("drops blank upstream rows, splits tags, and sends null for an unticked override", () => {
    const f = fieldsFromValues({
      ...EMPTY_ROUTE,
      path: " /billing ",
      priority: "",
      targets: [{ url: " http://billing:9000 ", weight: "", tags: "a, b ,," }, { url: "  ", weight: "3", tags: "" }],
    })
    expect(f.path).toBe("/billing")
    expect(f.priority).toBe(0)
    expect(f.targets).toEqual([{ url: "http://billing:9000", weight: 1, tags: ["a", "b"] }])
    expect(f.rateLimit).toBeNull()
    expect(f.auth).toBeNull()
  })
})
```

`test/route-editor.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { BastionRouteCreatePage } from "../src/pages/route-create"
import { BastionRouteEditPage } from "../src/pages/route-edit"
import type { RouteDetail } from "../src/types"
import { recordingCommandClient, stubClient } from "./harness"

function renderWith(Page: typeof BastionRouteCreatePage, client: ScopedClient, params: Record<string, string> = {}) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate }}>
        <Page params={params} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

function failingCommandClient(error: ContractError): ScopedClient {
  return { extension: "bastion", query: async () => { throw error }, command: async () => { throw error } } as ScopedClient
}

describe("BastionRouteCreatePage", () => {
  it("sends the entered fields and opens the new route", async () => {
    const { client, sent } = recordingCommandClient({}, { "routes.create": { id: "new-1" } })
    const { navigate } = renderWith(BastionRouteCreatePage, client)
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/billing" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "http://billing:9000" } })
    fireEvent.click(screen.getByLabelText("GET"))
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/routes/new-1"))
    expect(sent).toEqual([{
      intent: "routes.create",
      payload: {
        path: "/billing", methods: ["GET"], priority: 0, enabled: true, protocol: "http",
        stripPrefix: false, addPrefix: "", rewritePath: "",
        targets: [{ url: "http://billing:9000", weight: 1, tags: [] }],
        rateLimit: null, auth: null,
      },
    }])
  })

  it("puts a validation error beside the field it names", async () => {
    renderWith(BastionRouteCreatePage, failingCommandClient(new ContractError("BAD_REQUEST", "upstream 1: \"x\" is not an http, https, ws or wss URL", { field: "targets" })))
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/x" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    const upstreams = (await screen.findByRole("group", { name: "Upstreams" })) as HTMLElement
    expect(within(upstreams).getByRole("alert").textContent).toMatch(/not an http/)
  })

  it("links to the route a duplicate clashes with", async () => {
    renderWith(BastionRouteCreatePage, failingCommandClient(new ContractError("CONFLICT", "route \"manual-/users\" already serves /gw/users", { reason: "duplicate", routeId: "manual-/users" })))
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/users" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "http://u:1" } })
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    const link = await screen.findByRole("link", { name: "Open the route it clashes with" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
  })
})

const DETAIL: RouteDetail = {
  id: "manual-/users", path: "/gw/users", methods: [], protocol: "http", source: "manual", serviceName: "",
  priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
  updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
  stripPrefix: false, addPrefix: "", rewritePath: "", headers: {}, metadataKeys: [], version: 1,
  createdAt: "2026-09-29T10:00:00Z",
  targets: [{ id: "t0", url: "http://users:8080", weight: 1, tags: [], healthy: true, circuitState: "closed",
    stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [] }],
}

describe("BastionRouteEditPage", () => {
  it("prefills as entered and sends an update for this id", async () => {
    const { client, sent } = recordingCommandClient({ "routes.detail": DETAIL }, { "routes.update": { id: "manual-/users" } })
    const { navigate } = renderWith(BastionRouteEditPage, client, { id: "manual-/users" })
    const path = (await screen.findByLabelText("Path")) as HTMLInputElement
    expect(path.value).toBe("/users")
    expect((screen.getByLabelText("Priority") as HTMLInputElement).value).toBe("10")

    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/routes/manual-%2Fusers"))
    expect(sent[0]?.intent).toBe("routes.update")
    expect(sent[0]?.payload).toMatchObject({ id: "manual-/users", path: "/users", priority: 12 })
  })

  it("says why a discovered route has no editor", async () => {
    renderWith(BastionRouteEditPage, stubClient({ "routes.detail": { ...DETAIL, source: "farp", editable: false, config: false, input: undefined } }), { id: "farp-x" })
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
  })
})
```

The tests name controls by label: "Path", "Priority", "Upstream 1 URL", method checkboxes labelled by the method, the fieldset "Upstreams" (`<fieldset>` with `<legend>Upstreams</legend>`, which testing-library exposes as role `group`). Build the form so those names hold.

In `test/plugin.test.tsx`, the routes assertion becomes:

```tsx
    expect(paths).toEqual(["/", "/routes", "/new-route", "/routes/:id", "/routes/:id/edit", "/upstreams"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- route-form route-editor plugin`
Expected: FAIL, unresolved modules and the route list mismatch.

- [ ] **Step 3: Implement**

`src/keys.ts`, add:

```ts
export function routeEditPath(id: string): string {
  return `${routePath(id)}/edit`
}
```

`src/components/route-form.tsx`:

```tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { routePath } from "../keys"
import type { RouteDetail, RouteFields, RouteProtocol } from "../types"

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const
const PROTOCOLS: RouteProtocol[] = ["http", "websocket", "sse", "grpc", "graphql"]

export interface TargetRow {
  url: string
  weight: string
  tags: string
}

/** Form state. Numbers are text so an empty field is representable. */
export interface RouteFormValues {
  path: string
  methods: string[]
  priority: string
  enabled: boolean
  protocol: RouteProtocol
  stripPrefix: boolean
  addPrefix: string
  rewritePath: string
  targets: TargetRow[]
  rateLimit: { on: boolean; requestsPerSec: string; burst: string; perClient: boolean; keyHeader: string }
  auth: { on: boolean; providers: string; scopes: string; skipAuth: boolean; forwardAuth: boolean }
}

export const EMPTY_ROUTE: RouteFormValues = {
  path: "",
  methods: [],
  priority: "",
  enabled: true,
  protocol: "http",
  stripPrefix: false,
  addPrefix: "",
  rewritePath: "",
  targets: [{ url: "", weight: "", tags: "" }],
  rateLimit: { on: false, requestsPerSec: "", burst: "", perClient: false, keyHeader: "" },
  auth: { on: false, providers: "", scopes: "", skipAuth: false, forwardAuth: false },
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x !== "")
const num = (s: string, fallback: number) => (s.trim() === "" || Number.isNaN(Number(s)) ? fallback : Number(s))

/**
 * Form values from a route as the server describes it. Path and priority
 * come from `input`, as the operator entered them: the effective values
 * carry the base path and the +100 manual offset, and saving those back
 * would move the route.
 */
export function valuesFromDetail(d: RouteDetail): RouteFormValues {
  const rl = d.rateLimit
  const auth = d.auth
  return {
    path: d.input?.path ?? d.path,
    methods: [...d.methods],
    priority: String(d.input?.priority ?? d.priority),
    enabled: d.enabled,
    protocol: d.protocol,
    stripPrefix: d.stripPrefix,
    addPrefix: d.addPrefix,
    rewritePath: d.rewritePath,
    // A masked URL goes back as shown. The server maps it to the stored one.
    targets: d.targets.map((t) => ({ url: t.url, weight: String(t.weight), tags: t.tags.join(", ") })),
    rateLimit: rl
      ? { on: true, requestsPerSec: String(rl.requestsPerSec), burst: String(rl.burst), perClient: rl.perClient, keyHeader: rl.keyHeader ?? "" }
      : EMPTY_ROUTE.rateLimit,
    auth: auth
      ? { on: true, providers: (auth.providers ?? []).join(", "), scopes: (auth.scopes ?? []).join(", "), skipAuth: !!auth.skipAuth, forwardAuth: !!auth.forwardAuth }
      : EMPTY_ROUTE.auth,
  }
}

export function fieldsFromValues(v: RouteFormValues): RouteFields {
  return {
    path: v.path.trim(),
    methods: [...v.methods],
    priority: num(v.priority, 0),
    enabled: v.enabled,
    protocol: v.protocol,
    stripPrefix: v.stripPrefix,
    addPrefix: v.addPrefix.trim(),
    rewritePath: v.rewritePath.trim(),
    targets: v.targets
      .filter((t) => t.url.trim() !== "")
      .map((t) => ({ url: t.url.trim(), weight: num(t.weight, 1), tags: list(t.tags) })),
    rateLimit: v.rateLimit.on
      ? {
          enabled: true,
          requestsPerSec: num(v.rateLimit.requestsPerSec, 0),
          burst: num(v.rateLimit.burst, 0),
          perClient: v.rateLimit.perClient,
          ...(v.rateLimit.keyHeader.trim() ? { keyHeader: v.rateLimit.keyHeader.trim() } : {}),
        }
      : null,
    auth: v.auth.on
      ? { enabled: true, providers: list(v.auth.providers), scopes: list(v.auth.scopes), skipAuth: v.auth.skipAuth, forwardAuth: v.auth.forwardAuth }
      : null,
  }
}

export interface RouteFormProps {
  initial: RouteFormValues
  submitLabel: string
  pendingLabel: string
  pending: boolean
  error?: ContractError
  errorTitle: string
  cancelTo: string
  onSubmit: (fields: RouteFields) => void
}

function FieldError({ show, error }: { show: boolean; error?: ContractError }) {
  if (!show || !error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  )
}

export function RouteForm({ initial, submitLabel, pendingLabel, pending, error, errorTitle, cancelTo, onSubmit }: RouteFormProps) {
  const [v, setV] = useState<RouteFormValues>(initial)
  const set = <K extends keyof RouteFormValues>(k: K, value: RouteFormValues[K]) => setV((prev) => ({ ...prev, [k]: value }))
  const field = error?.code === "BAD_REQUEST" ? (error.details?.field as string | undefined) : undefined
  const reason = error?.code === "CONFLICT" ? (error.details?.reason as string | undefined) : undefined
  const clashId = reason === "duplicate" ? (error?.details?.routeId as string | undefined) : undefined

  function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    onSubmit(fieldsFromValues(v))
  }

  const setTarget = (i: number, patch: Partial<TargetRow>) =>
    set("targets", v.targets.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
      {/* A field-level error shows beside its field; anything else here. */}
      {error && !field ? <CommandAlert title={errorTitle} error={error} /> : null}
      {clashId ? (
        <p className="text-sm">
          <PluginLink to={routePath(clashId)} className="underline">
            Open the route it clashes with
          </PluginLink>
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Match</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-path">Path</Label>
          <Input id="route-path" className="font-mono" value={v.path} aria-invalid={field === "path" || undefined}
            onChange={(e) => set("path", e.target.value)} spellCheck={false} autoComplete="off" />
          <p className="text-xs text-muted-foreground">
            Bastion serves this under the gateway's base path. End it with /* to match everything below it.
          </p>
          <FieldError show={field === "path"} error={error} />
        </div>
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby="route-methods-label">
          <span id="route-methods-label" className="text-sm font-medium">Methods</span>
          <div className="flex flex-wrap gap-3">
            {METHODS.map((m) => (
              <label key={m} className="flex items-center gap-1.5 font-mono text-xs">
                <Checkbox
                  aria-label={m}
                  checked={v.methods.includes(m)}
                  onCheckedChange={(on) => set("methods", on ? [...v.methods, m] : v.methods.filter((x) => x !== m))}
                />
                {m}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">None ticked matches every method.</p>
          <FieldError show={field === "methods"} error={error} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-protocol">Protocol</Label>
          <NativeSelect id="route-protocol" value={v.protocol} onChange={(e) => set("protocol", e.target.value as RouteProtocol)}>
            {PROTOCOLS.map((p) => (
              <NativeSelectOption key={p} value={p}>{p}</NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError show={field === "protocol"} error={error} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-priority">Priority</Label>
          <Input id="route-priority" type="number" className="font-mono w-32" value={v.priority}
            onChange={(e) => set("priority", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Higher wins among routes that match. Bastion adds 100 to every manual route so it sorts above discovered ones.
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3" aria-invalid={field === "targets" || undefined}>
        <legend className="text-sm font-medium">Upstreams</legend>
        {v.targets.map((t, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5 grow">
              <Label htmlFor={`target-url-${i}`}>{`Upstream ${i + 1} URL`}</Label>
              <Input id={`target-url-${i}`} className="font-mono" value={t.url} spellCheck={false} autoComplete="off"
                onChange={(e) => setTarget(i, { url: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 w-24">
              <Label htmlFor={`target-weight-${i}`}>{`Upstream ${i + 1} weight`}</Label>
              <Input id={`target-weight-${i}`} type="number" value={t.weight} onChange={(e) => setTarget(i, { weight: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 w-40">
              <Label htmlFor={`target-tags-${i}`}>{`Upstream ${i + 1} tags`}</Label>
              <Input id={`target-tags-${i}`} value={t.tags} onChange={(e) => setTarget(i, { tags: e.target.value })} />
            </div>
            {v.targets.length > 1 ? (
              <Button type="button" variant="outline" onClick={() => set("targets", v.targets.filter((_, j) => j !== i))}>
                {`Remove upstream ${i + 1}`}
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" onClick={() => set("targets", [...v.targets, { url: "", weight: "", tags: "" }])}>
            Add upstream
          </Button>
        </div>
        <FieldError show={field === "targets"} error={error} />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Rewriting</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox aria-label="Strip the matched prefix" checked={v.stripPrefix} onCheckedChange={(on) => set("stripPrefix", on === true)} />
          Strip the matched prefix
        </label>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-add-prefix">Add prefix</Label>
          <Input id="route-add-prefix" className="font-mono" value={v.addPrefix} onChange={(e) => set("addPrefix", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-rewrite">Rewrite path</Label>
          <Input id="route-rewrite" className="font-mono" value={v.rewritePath} onChange={(e) => set("rewritePath", e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Rate limit</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox aria-label="Limit this route" checked={v.rateLimit.on}
            onCheckedChange={(on) => set("rateLimit", { ...v.rateLimit, on: on === true })} />
          Limit this route
        </label>
        {v.rateLimit.on ? (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5 w-40">
              <Label htmlFor="rl-rps">Requests per second</Label>
              <Input id="rl-rps" type="number" value={v.rateLimit.requestsPerSec}
                onChange={(e) => set("rateLimit", { ...v.rateLimit, requestsPerSec: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 w-32">
              <Label htmlFor="rl-burst">Burst</Label>
              <Input id="rl-burst" type="number" value={v.rateLimit.burst}
                onChange={(e) => set("rateLimit", { ...v.rateLimit, burst: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm self-end">
              <Checkbox aria-label="Per client" checked={v.rateLimit.perClient}
                onCheckedChange={(on) => set("rateLimit", { ...v.rateLimit, perClient: on === true })} />
              Per client
            </label>
          </div>
        ) : null}
        <FieldError show={field === "rateLimit"} error={error} />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Authentication</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox aria-label="Set authentication for this route" checked={v.auth.on}
            onCheckedChange={(on) => set("auth", { ...v.auth, on: on === true })} />
          Set authentication for this route
        </label>
        {v.auth.on ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-providers">Providers</Label>
              <Input id="auth-providers" value={v.auth.providers} onChange={(e) => set("auth", { ...v.auth, providers: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-scopes">Scopes</Label>
              <Input id="auth-scopes" value={v.auth.scopes} onChange={(e) => set("auth", { ...v.auth, scopes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox aria-label="Skip gateway authentication" checked={v.auth.skipAuth}
                onCheckedChange={(on) => set("auth", { ...v.auth, skipAuth: on === true })} />
              Skip gateway authentication
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox aria-label="Forward identity headers" checked={v.auth.forwardAuth}
                onCheckedChange={(on) => set("auth", { ...v.auth, forwardAuth: on === true })} />
              Forward identity headers
            </label>
          </div>
        ) : null}
        <FieldError show={field === "auth"} error={error} />
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox aria-label="Enabled" checked={v.enabled} onCheckedChange={(on) => set("enabled", on === true)} />
        Enabled
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
        <PluginLink to={cancelTo} className="text-sm underline self-center">Cancel</PluginLink>
      </div>
    </form>
  )
}
```

The method checkbox test clicks `getByLabelText("GET")`. If kit's `Checkbox` does not expose `aria-label` as the accessible name of a `role="checkbox"` element, use a `<Label htmlFor>` with an `id` on each checkbox instead; keep the accessible names. Read `packages/kit/src/components/checkbox.tsx` first.

`src/pages/route-create.tsx`:

```tsx
import type { ComponentType } from "react"
import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { EMPTY_ROUTE, RouteForm } from "../components/route-form"
import { routePath } from "../keys"
import type { RouteFields, RouteIdResponse } from "../types"

export const BastionRouteCreatePage: ComponentType<PluginPageProps> = () => {
  const create = useCommand<RouteIdResponse>("routes.create")
  const navigateTo = useNavigateTo()

  async function submit(fields: RouteFields) {
    const result = await create.execute(fields)
    // execute resolves undefined only when the command failed.
    if (result === undefined) return
    navigateTo(routePath(result.id))
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="New route" description="A manual route. It stays until you delete it, and survives a restart only when the gateway has a route store." />
      <RouteForm
        initial={EMPTY_ROUTE}
        submitLabel="Create route"
        pendingLabel="Creating…"
        pending={create.loading}
        error={create.error}
        errorTitle="Could not create the route"
        cancelTo="/routes"
        onSubmit={(f) => void submit(f)}
      />
    </section>
  )
}
```

`src/pages/route-edit.tsx`:

```tsx
import type { ComponentType } from "react"
import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { RouteForm, valuesFromDetail } from "../components/route-form"
import { routePath } from "../keys"
import type { RouteDetail, RouteFields, RouteIdResponse } from "../types"

export const BastionRouteEditPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No route in the address, so there is nothing to edit.
      </p>
    )
  }
  return <RouteEditBody id={id} />
}

function RouteEditBody({ id }: { id: string }) {
  const detail = useQuery<RouteDetail>("routes.detail", { id })
  const update = useCommand<RouteIdResponse>("routes.update")
  const navigateTo = useNavigateTo()

  async function submit(fields: RouteFields) {
    const result = await update.execute({ id, ...fields })
    if (result === undefined) return
    navigateTo(routePath(id))
  }

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Route" query={detail} skeletonRows={6}>
        {(d) =>
          !d.editable ? (
            <p role="status" className="text-sm text-muted-foreground">
              Discovery manages this route. Its next update replaces any change, so it cannot be edited here.
            </p>
          ) : (
            <>
              <PageHeader title={`Edit ${d.path}`} description={d.config ? "This route comes from the gateway's config file. A change made here lasts until the gateway restarts." : "Headers, transforms and traffic policy are kept as they are; this form does not change them."} />
              <RouteForm
                initial={valuesFromDetail(d)}
                submitLabel="Save changes"
                pendingLabel="Saving…"
                pending={update.loading}
                error={update.error}
                errorTitle="Could not save the route"
                cancelTo={routePath(id)}
                onSubmit={(f) => void submit(f)}
              />
            </>
          )
        }
      </QueryBoundary>
    </section>
  )
}
```

`src/index.tsx`: import both pages, export them, and set routes to:

```tsx
  routes: [
    { path: "/", element: BastionOverviewPage },
    { path: "/routes", element: BastionRoutesPage },
    // /new-route, not /routes/new: no route id can shadow it.
    { path: "/new-route", element: BastionRouteCreatePage },
    { path: "/routes/:id", element: BastionRouteDetailPage },
    { path: "/routes/:id/edit", element: BastionRouteEditPage },
    { path: "/upstreams", element: BastionUpstreamsPage },
  ],
```

Add `routeEditPath` to the `keys` re-export line.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test && pnpm --filter @forge-go/dashboard-plugin-bastion typecheck && pnpm --filter @forge-go/dashboard-plugin-bastion lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/components/route-form.tsx packages/plugin-bastion/src/pages/route-create.tsx packages/plugin-bastion/src/pages/route-edit.tsx packages/plugin-bastion/test/route-form.test.tsx packages/plugin-bastion/test/route-editor.test.tsx
git commit --only packages/plugin-bastion/src packages/plugin-bastion/test -m "feat(bastion): create and edit manual routes"
```

Check with `git show --stat HEAD` that only `packages/plugin-bastion` paths went in.

---

### Task 6: Detail page actions

**Files:**
- Modify: `packages/plugin-bastion/src/pages/route-detail.tsx`
- Modify: `packages/plugin-bastion/test/route-detail.test.tsx`

**Interfaces:**
- Consumes: `routeEditPath`, `SetEnabledResponse`, `RouteIdResponse`-like delete response `{ok, id}`.

Behaviour:
- `PageHeader` actions, for an `editable` route only: an `Edit` link (`buttonVariants({ variant: "outline" })`) to `routeEditPath(id)`, a `Disable` or `Enable` button, and a `Delete` button. A FARP or discovery route shows no actions.
- Enable sends `routes.setEnabled {id, enabled: true}` straight away. Disable opens a `ConfirmDialog` titled `Disable ${path}?` with description `A disabled route stops matching. Requests fall through to the next matching route, or get a 404.` and confirm label `Disable`; `setEnabled.reset()` runs when it opens; its `CommandAlert` renders inside the description.
- After a successful toggle with `durable: false`, a `role="status"` line: for a config route `Saved. The route comes from the config file, so this change lasts until the gateway restarts.`; otherwise `Saved. The gateway has no route store, so this change lasts until it restarts.`
- Delete opens a destructive `ConfirmDialog` titled `Delete ${path}?`, description `Requests to this path stop reaching its upstreams. This cannot be undone from the dashboard.` plus the `CommandAlert` inside, confirm label `Delete`, `pending` bound, `reset()` on open. Success navigates to `/routes`.
- The Overrides section marks `retry`, `timeout`, `circuitBreaker` and `cache` with a `secondary` badge `Not applied`, and when any of them is present renders under the list: `Bastion stores these overrides but its proxy does not apply them today.`

- [ ] **Step 1: Write the failing tests**

Append to `test/route-detail.test.tsx` (add imports: `fireEvent`, `waitFor`, `vi`, `ContractError`, `NavigationProvider`, `PluginProvider`, `render`, and `recordingCommandClient`):

```tsx
function renderNav(client: Parameters<typeof renderPage>[1], id: string) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate }}>
        <BastionRouteDetailPage params={{ id }} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

describe("BastionRouteDetailPage actions", () => {
  it("links Edit to the encoded edit page", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    const edit = await screen.findByRole("link", { name: "Edit" })
    expect(edit.getAttribute("href")).toBe("/routes/manual-%2Fusers/edit")
  })

  it("offers no actions on a discovered route", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail({ source: "farp", editable: false, config: false, input: undefined }) }), { id: "farp-x" })
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull()
  })

  it("confirms a disable and says a config-route change ends at restart", async () => {
    const { client, sent } = recordingCommandClient(
      { "routes.detail": detail() },
      { "routes.setEnabled": { id: "manual-/users", enabled: false, durable: false } },
    )
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }))
    await screen.findByText(/comes from the config file, so this change lasts until the gateway restarts/)
    expect(sent).toEqual([{ intent: "routes.setEnabled", payload: { id: "manual-/users", enabled: false } }])
  })

  it("shows a delete failure inside the dialog", async () => {
    const client = {
      extension: "bastion",
      query: async () => detail(),
      command: async () => { throw new ContractError("CONFLICT", "route \"manual-/users\" comes from farp", { reason: "source", source: "farp" }) },
    } as never
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByText(/comes from farp/)).toBeTruthy()
  })

  it("goes back to the routes list after a delete", async () => {
    const { client } = recordingCommandClient({ "routes.detail": detail() }, { "routes.delete": { ok: true, id: "manual-/users" } })
    const { navigate } = renderNav(client, "manual-/users")
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/routes"))
  })

  it("marks overrides the proxy does not apply", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail({ timeout: { read: 5 } as never }) }), { id: "manual-/users" })
    await screen.findByText("Not applied")
    expect(screen.getByText(/does not apply them today/)).toBeTruthy()
  })
})
```

`ConfirmDialog` may render as `role="dialog"` rather than `alertdialog`; read `packages/kit/src/components/confirm-dialog.tsx` and use its real role. `detail(over)` is the existing helper in this file; `timeout` is typed as a record so the cast is only for the test.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- route-detail`
Expected: the new tests FAIL; the existing ones still pass.

- [ ] **Step 3: Implement**

In `route-detail.tsx`'s `RouteDetailBody`, add:

```tsx
  const setEnabled = useCommand<SetEnabledResponse>("routes.setEnabled")
  const remove = useCommand<{ ok: boolean; id: string }>("routes.delete")
  const navigateTo = useNavigateTo()
  const [confirming, setConfirming] = useState<"disable" | "delete" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function toggle(d: RouteDetail, enabled: boolean) {
    setNotice(null)
    const r = await setEnabled.execute({ id, enabled })
    if (r === undefined) return
    setConfirming(null)
    if (!r.durable) {
      setNotice(
        d.config
          ? "Saved. The route comes from the config file, so this change lasts until the gateway restarts."
          : "Saved. The gateway has no route store, so this change lasts until it restarts.",
      )
    }
  }

  async function confirmDelete() {
    const r = await remove.execute({ id })
    if (r === undefined) return
    navigateTo("/routes")
  }

  function open(which: "disable" | "delete") {
    // Reset at open: an error from an earlier attempt must not greet the operator.
    if (which === "disable") setEnabled.reset()
    else remove.reset()
    setConfirming(which)
  }
```

Pass `PageHeader` an `actions` prop when `d.editable`:

```tsx
                actions={
                  d.editable ? (
                    <div className="flex gap-2">
                      <PluginLink to={routeEditPath(d.id)} className={buttonVariants({ variant: "outline" })}>Edit</PluginLink>
                      {d.enabled ? (
                        <Button variant="outline" onClick={() => open("disable")}>Disable</Button>
                      ) : (
                        <Button variant="outline" disabled={setEnabled.loading} onClick={() => void toggle(d, true)}>Enable</Button>
                      )}
                      <Button variant="destructive" onClick={() => open("delete")}>Delete</Button>
                    </div>
                  ) : undefined
                }
```

Render `notice` as `<p role="status" className="text-sm text-muted-foreground">{notice}</p>` under the header, and an enable failure (outside a dialog) as `<CommandAlert title="Could not enable the route" error={confirming === null ? setEnabled.error : undefined} />`. Then the two dialogs:

```tsx
              <ConfirmDialog
                open={confirming === "disable"}
                onOpenChange={(o) => !o && !setEnabled.loading && setConfirming(null)}
                title={`Disable ${d.path}?`}
                description={
                  <span className="flex flex-col gap-2">
                    <span>A disabled route stops matching. Requests fall through to the next matching route, or get a 404.</span>
                    <CommandAlert error={setEnabled.error} title="Could not disable the route" />
                  </span>
                }
                confirmLabel="Disable"
                destructive={false}
                pending={setEnabled.loading}
                onConfirm={() => void toggle(d, false)}
              />
              <ConfirmDialog
                open={confirming === "delete"}
                onOpenChange={(o) => !o && !remove.loading && setConfirming(null)}
                title={`Delete ${d.path}?`}
                description={
                  <span className="flex flex-col gap-2">
                    <span>Requests to this path stop reaching its upstreams. This cannot be undone from the dashboard.</span>
                    <CommandAlert error={remove.error} title="Could not delete the route" />
                  </span>
                }
                confirmLabel="Delete"
                destructive
                pending={remove.loading}
                onConfirm={() => void confirmDelete()}
              />
```

Overrides: replace the items mapping with:

```tsx
const NOT_APPLIED = new Set(["retry", "timeout", "circuitBreaker", "cache"])
...
                    items={overrides.map((k) => ({
                      term: k,
                      value: (
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs">{JSON.stringify(d[k])}</span>
                          {NOT_APPLIED.has(k) ? <Badge variant="secondary">Not applied</Badge> : null}
                        </span>
                      ),
                    }))}
```

and after the list, when `overrides.some((k) => NOT_APPLIED.has(k))`:

```tsx
<p className="text-sm text-muted-foreground">Bastion stores these overrides but its proxy does not apply them today.</p>
```

Imports: `useState`, `useCommand`, `useNavigateTo`, `PluginLink`, `Button`, `buttonVariants`, `ConfirmDialog`, `CommandAlert`, `routeEditPath`, `SetEnabledResponse`.

- [ ] **Step 4: Run to verify they pass**

Run: the three React gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git commit --only packages/plugin-bastion/src/pages/route-detail.tsx packages/plugin-bastion/test/route-detail.test.tsx -m "feat(bastion): edit, disable and delete a route from its page"
```

---

### Task 7: Routes page actions

**Files:**
- Modify: `packages/plugin-bastion/src/pages/routes.tsx`
- Modify: `packages/plugin-bastion/test/routes.test.tsx`

Behaviour: `PageHeader` actions are a `New route` link (`buttonVariants()`) to `/new-route` and a `Refresh discovery` button sending `discovery.refresh` with no payload. While pending the button reads `Refreshing…` and is disabled. On success a `role="status"` line `Discovery refreshed.`. On `CONFLICT` with `reason: "discoveryOff"` a `CommandAlert` titled `Could not refresh discovery` whose message is replaced by `Discovery is switched off in the gateway config, so there is nothing to refresh.`; any other failure shows the server's message. The empty message with no filter becomes `No routes. Create one, or let discovery find your services.`, and the empty state carries the `New route` link as `emptyAction`.

- [ ] **Step 1: Write the failing tests**

Append to `test/routes.test.tsx` (add `ContractError` and `recordingCommandClient` imports):

```tsx
describe("BastionRoutesPage actions", () => {
  it("links New route to /new-route", async () => {
    renderPage(BastionRoutesPage, stubClient({ "routes.list": { routes: [], total: 0 } }))
    const links = await screen.findAllByRole("link", { name: "New route" })
    expect(links[0]?.getAttribute("href")).toBe("/new-route")
  })

  it("refreshes discovery and says so", async () => {
    const { client, sent } = recordingCommandClient({ "routes.list": { routes: [], total: 0 } }, { "discovery.refresh": { ok: true } })
    renderPage(BastionRoutesPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Refresh discovery" }))
    expect(await screen.findByText("Discovery refreshed.")).toBeTruthy()
    expect(sent).toEqual([{ intent: "discovery.refresh", payload: undefined }])
  })

  it("explains a refresh refused because discovery is off", async () => {
    const client = {
      extension: "bastion",
      query: async () => ({ routes: [], total: 0 }),
      command: async () => { throw new ContractError("CONFLICT", "discovery is switched off in the gateway config, so there is nothing to refresh", { reason: "discoveryOff" }) },
    } as never
    renderPage(BastionRoutesPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Refresh discovery" }))
    expect(await screen.findByText("Discovery is switched off in the gateway config, so there is nothing to refresh.")).toBeTruthy()
  })
})
```

Update the existing empty-message assertion to `No routes. Create one, or let discovery find your services.`. If the harness's `recordingCommandClient` records `payload: undefined` differently when `execute()` is called with no argument, match what it records and say so in the report.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- routes`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

In `routes.tsx`:

```tsx
function NewRouteLink() {
  return (
    <PluginLink to="/new-route" className={buttonVariants()}>
      New route
    </PluginLink>
  )
}
```

In `BastionRoutesPage`:

```tsx
  const refresh = useCommand<{ ok: boolean }>("discovery.refresh")
  const [refreshed, setRefreshed] = useState(false)

  async function refreshDiscovery() {
    setRefreshed(false)
    const r = await refresh.execute()
    if (r !== undefined) setRefreshed(true)
  }

  const refreshError =
    refresh.error?.code === "CONFLICT" && refresh.error.details?.reason === "discoveryOff"
      ? { code: refresh.error.code, message: "Discovery is switched off in the gateway config, so there is nothing to refresh." }
      : refresh.error
```

`PageHeader` `actions`:

```tsx
        actions={
          <div className="flex gap-2">
            <Button variant="outline" disabled={refresh.loading} onClick={() => void refreshDiscovery()}>
              {refresh.loading ? "Refreshing…" : "Refresh discovery"}
            </Button>
            <NewRouteLink />
          </div>
        }
```

Under the header: `<CommandAlert title="Could not refresh discovery" error={refreshError} />` and `{refreshed ? <p role="status" className="text-sm text-muted-foreground">Discovery refreshed.</p> : null}`. The `ResourceTable` gets `emptyAction={filtered ? undefined : <NewRouteLink />}` and the new unfiltered empty message.

- [ ] **Step 4: Run to verify they pass**

Run: the three React gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git commit --only packages/plugin-bastion/src/pages/routes.tsx packages/plugin-bastion/test/routes.test.tsx -m "feat(bastion): new route and discovery refresh on the routes page"
```

---

### Task 8: Run it, and update the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md`

- [ ] **Step 1: Gates**

Bastion: the Go gates. forge-dashboard: `pnpm --filter @forge-go/dashboard-plugin-bastion test`, `typecheck`, `lint`, and `pnpm -r --no-bail typecheck`. Report any failure outside `plugin-bastion` by name; do not fix other packages.

- [ ] **Step 2: Click through**

`preview_start` `{name: "fixture-server"}` and `{name: "dashboard-shell"}`. The shell serves the app at `http://localhost:5173/` (relative base), so bastion is at `http://localhost:5173/@bastion/`. Check with `read_page` and `get_page_text`:
- Routes: `New route` opens `/@bastion/new-route`. Create `/demo` with upstream `http://demo:8080`, GET ticked and the priority left empty: the page lands on the new route's detail, which shows the path `/gw/demo` and the priority `100 (entered as 0)`.
- On that route: `Edit` shows path `/demo` and priority `0`; change priority to 4 and save; detail shows `104 (entered as 4)`.
- `Disable`, confirm: the badge turns `Disabled` and the status line says the gateway has no route store.
- `Delete`, confirm: back on Routes with the route gone.
- `/@bastion/routes/farp-billing-http` shows no actions.
- `Refresh discovery` shows `Discovery refreshed.`
- `read_console_messages` with `onlyErrors: true` is empty.

Take a screenshot of the editor and one of the delete dialog. Stop both servers.

- [ ] **Step 3: Update the spec**

Under "The route editor", replace the paragraph starting "Manual routes only. A form over the route fields" with:

```
Manual routes only, at `/new-route` and `/routes/:id/edit`. A form over
path, methods, protocol, priority, upstreams (URL, weight, tags),
rewriting, rate limit, auth and enabled. Path and priority are shown and
edited as the operator entered them, and the form says the manual offset
exists.

The editor offers only the overrides the proxy applies: rate limit and
auth. Timeout is never read on the proxy path, retry never runs, the
per-route breaker override is never used and the cache never stores, so
those are kept as stored on every save and marked "Not applied" on the
detail page. Headers, transforms, traffic policy and metadata are kept
as stored too; an edit sends only the fields the form holds, and the
contract merges them over the stored route with `Entry`.

A target URL the page shows has its password masked. An edit that sends
a masked URL back keeps the stored one.
```

In "Open, and recorded in `MIGRATION.md`" add:

```
- Dashboard writes leave one Info log line each (intent, subject,
  operator) and no audit record: bastion's audit sink is never written.
- Timeout, retry, per-route circuit breaker and cache overrides are stored
  and shown but not applied by the proxy.
```

`grep -c "—"` on the spec prints 0. Commit:

```bash
git commit --only docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md -m "docs(bastion): record slice 3's editor decisions"
```
