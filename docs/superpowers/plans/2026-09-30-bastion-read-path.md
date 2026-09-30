# Bastion Read Path (slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put bastion on the React shell's read path: a shared `bastion/admin` service that owns route writes and read models, a `bastion` contract contributor answering nine query intents, fixtures for all nine, and a `plugin-bastion` package with the overview, routes, route detail and upstreams pages.

**Architecture:** `bastion/admin` takes a route registry, an optional health monitor and circuit control, and the gateway's proxy base path. It returns read models (summaries, details with redacted headers, upstreams by URL) and performs manual-route writes with the offsets applied once. The REST handlers and the new `bastion/extension/contract` package both call it. The contract follows `forgery/vault/extension/contract`: an embedded manifest, typed handlers bound through `dispatcher.RegisterQuery`, and errors built as `*contract.Error`. The React package follows `packages/plugin-vault`: plain page components, `useQuery`, kit blocks, a stub-client harness. `usePoll` moves from plugin-streaming into `@forge-go/dashboard-plugin` because bastion is its second user.

**Tech Stack:** Go 1.26, forge v1.11.2 (`extensions/dashboard/contract`, `dispatcher`, `loader`, `transport`); React 19, TypeScript 6, vitest 5, `@forge-go/dashboard-kit`, `@forge-go/dashboard-plugin`; Node fixture server.

**Spec:** `docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md`, sections "Slice 2", "The intents", "The React half", "Fixtures".

**Repos:**
- Go: `/Users/rexraphael/Work/xraph/forgery/bastion` (Tasks 1 to 8)
- React and fixtures: `/Users/rexraphael/Work/xraph/forge-dashboard` (Tasks 9 to 15)

Both on `main`, no worktree.

## Global Constraints

- Contributor name and plugin `extension`: `bastion`. Plugin `namespace`: `bastion`.
- No request carries a tenant or app id. One gateway per process.
- Lists return the full set: `{ items, total }` or a named array plus `total`. No paging.
- Every handler reads target counters through `Target.Stats()`, never `Target.Snapshot()`.
- Errors are `&contract.Error{Code, Message, Details}`. There is no FAILED_PRECONDITION code in forge; refusals that are about the route's source use `CodeConflict` with `Details: {"reason": "source", "source": <source>}`.
- Header values whose names are `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, or contain `key`, `token` or `secret` (case-insensitive) are replaced with `"[redacted]"`. TLS file paths show only as set or not set. IP lists show only as counts.
- Go gates: `go build ./... && go test -race ./...`; lint with `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run --allow-parallel-runners ./...; rm -rf $C`.
- React gates per package: `pnpm --filter <pkg> test`, `typecheck`, `lint`; and `pnpm -r test` before the last commit.
- Commit with `git add <new files>` then `git commit --only <paths>`. Never `git add -A`, never `git checkout -- .`. `docs/` in forge-dashboard is globally ignored: plans and specs need `git add -f`.
- Commit messages: no `Co-Authored-By`, no Claude attribution, no em dashes. Comments and UI copy: no em dashes.
- The production code in `bastion/extension` must not newly import `github.com/xraph/forge/extensions/dashboard` (the root package pulls forge's templ UI). The `ContractContributorAware` assertion goes in a `_test.go` file. The existing `DashboardAware` import stays until slice 5 deletes it.
- UI conventions: identifiers `font-mono text-xs`; the column an operator reads `font-medium`; every table caption has a live count including zero; "none" is `NoneCell` or `TagList`, never blank; badges are proportion first (healthy and closed `outline`, half-open `default`, unhealthy and open `destructive`, disabled `secondary`, sources and protocols `outline`).

## Decisions this plan makes against the spec

Each is recorded in the spec by Task 8.

1. **REST read shapes stay as they are.** The spec said REST priority and path "stop drifting". They cannot without changing what GET means, since GET returns the effective values and PUT takes the entered ones. The contract carries both (`priority` and `input.priority`), so the dashboard never drifts. A REST client that PUTs back what it GETs still drifts; that goes in `MIGRATION.md`.
2. **Manual routes may shadow discovered ones.** A duplicate path and method set is a conflict only against another manual route, because the +100 offset exists precisely so an operator can override a FARP route at the same path.
3. **`openapi.summary` answers `{enabled: false, running: false, ...}` when disabled,** not `null`, so the page reads one shape.
4. **An update keeps a target object only when nothing about it changed.** Mutating a live target's weight races the load balancer. A target whose URL stays but whose weight, tags, metadata or TLS changed gets a new object with the same id, so its health entry and breaker carry over and its counters restart.
5. **`circuits.list` lists every live target,** with `tracked: false` for targets that have no breaker yet, since breakers are created on first selection and the page is where an operator checks all of them.

## Review Focus

- A config route id contains `/` (`manual-/users`). It must round-trip through the React route `/routes/:id` and the `routes.detail` body. Pinned in Tasks 7 and 13.
- A route whose only target is shared by URL with another route: deleting one route must not deregister the target the other still uses. Pinned in Task 3.
- A header named `X-Api-Key` in `transform.requestHeaders.set` must come back redacted from `routes.detail`. Pinned in Tasks 1 and 7.
- An idle gateway (no requests, no cache lookups, not started) must report `null` error rate, latency, hit rate and start time, never `0`. Pinned in Tasks 6 and 12.
- A breaker left over from a deleted route must not show on the overview's open-circuit count or the circuits list. Pinned in Task 6.

---

### Task 1: The admin package: errors and redaction

**Files:**
- Create: `admin/admin.go`, `admin/errors.go`, `admin/redact.go`
- Create: `admin/redact_test.go`
- Modify: `extension.go` (add `RoutesPersisted`)

**Interfaces:**
- Produces:

```go
package admin

const ManualPriorityOffset = 100
const Redacted = "[redacted]"

type Deps struct {
	Routes    bastion.RouteRegistry  // required
	Health    *health.Monitor        // optional
	Breakers  bastion.CircuitControl // optional
	BasePath  string                 // bastion Config.BasePath, the proxy prefix
	Persisted func() bool            // optional; nil means nothing is persisted
}
type Service struct{ d Deps }
func New(d Deps) (*Service, error)

var ErrNotFound, ErrNotManual, ErrConflict error
type ValidationError struct{ Field, Message string }
type SourceError struct{ ID string; Source bastion.RouteSource }   // Unwrap -> ErrNotManual
type ConflictError struct{ Path, OtherID string }                  // Unwrap -> ErrConflict

func SensitiveHeader(name string) bool
func RedactHeaders(p bastion.HeaderPolicy) bastion.HeaderPolicy
func RedactTransform(t *bastion.TransformConfig) *bastion.TransformConfig
```

and in the root package `func (e *Gateway) RoutesPersisted() bool`.

- [ ] **Step 1: Write the failing tests**

`admin/redact_test.go`:

```go
package admin_test

import (
	"testing"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/admin"
)

func TestSensitiveHeader(t *testing.T) {
	for name, want := range map[string]bool{
		"Authorization":       true,
		"proxy-authorization": true,
		"Cookie":              true,
		"Set-Cookie":          true,
		"X-Api-Key":           true,
		"X-Auth-Token":        true,
		"X-Client-Secret":     true,
		"X-Request-Id":        false,
		"Accept":              false,
	} {
		if got := admin.SensitiveHeader(name); got != want {
			t.Errorf("SensitiveHeader(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestRedactHeadersKeepsNamesAndCopies(t *testing.T) {
	in := bastion.HeaderPolicy{
		Set:    map[string]string{"X-Api-Key": "k-123", "X-Env": "prod"},
		Add:    map[string]string{"Authorization": "Bearer abc"},
		Remove: []string{"X-Debug"},
	}
	out := admin.RedactHeaders(in)

	if out.Set["X-Api-Key"] != admin.Redacted || out.Add["Authorization"] != admin.Redacted {
		t.Errorf("sensitive values leaked: %+v", out)
	}
	if out.Set["X-Env"] != "prod" || len(out.Remove) != 1 {
		t.Errorf("plain values lost: %+v", out)
	}
	if in.Set["X-Api-Key"] != "k-123" {
		t.Error("RedactHeaders modified its input")
	}
}

func TestRedactTransformNilAndNested(t *testing.T) {
	if admin.RedactTransform(nil) != nil {
		t.Error("nil transform must stay nil")
	}
	out := admin.RedactTransform(&bastion.TransformConfig{
		RequestHeaders: bastion.HeaderPolicy{Set: map[string]string{"X-Api-Key": "k"}},
	})
	if out.RequestHeaders.Set["X-Api-Key"] != admin.Redacted {
		t.Errorf("request header leaked: %+v", out)
	}
}

func TestNewRequiresRoutes(t *testing.T) {
	if _, err := admin.New(admin.Deps{}); err == nil {
		t.Error("New without Routes returned no error")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./admin/ 2>&1 | head -5`
Expected: FAIL, `package github.com/xraph/bastion/admin` not found or undefined symbols.

- [ ] **Step 3: Implement**

`admin/admin.go`:

```go
// Package admin owns the gateway's operator writes and the read models that
// the REST API and the dashboard contract share. Both callers go through it,
// so the manual-route priority offset and the proxy base path are applied in
// one place, and a route loaded and saved unchanged is left unchanged.
package admin

import (
	"errors"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/health"
)

// ManualPriorityOffset is added to every manual route's priority so manual
// routes sort above discovered ones at the same specificity. Operators never
// see it: the service adds it on the way in and removes it on the way out.
const ManualPriorityOffset = 100

// Deps is what the service needs from the gateway.
type Deps struct {
	// Routes is the live route table. Required.
	Routes bastion.RouteRegistry
	// Health, when set, has targets a write removes deregistered from it.
	Health *health.Monitor
	// Breakers, when set, supplies circuit state for read models and has the
	// breakers of removed targets dropped.
	Breakers bastion.CircuitControl
	// BasePath is bastion's Config.BasePath: the prefix every manual route's
	// path is served under.
	BasePath string
	// Persisted reports whether a route store is wired. Nil means nothing
	// written through the service survives a restart.
	Persisted func() bool
}

// Service answers operator reads and performs operator writes.
type Service struct {
	d Deps
}

// New builds a Service.
func New(d Deps) (*Service, error) {
	if d.Routes == nil {
		return nil, errors.New("admin: Routes is required")
	}

	return &Service{d: d}, nil
}

func (s *Service) persisted() bool {
	return s.d.Persisted != nil && s.d.Persisted()
}
```

`admin/errors.go`:

```go
package admin

import (
	"errors"
	"fmt"

	bastion "github.com/xraph/bastion"
)

var (
	// ErrNotFound is returned for a route id the table does not hold.
	ErrNotFound = errors.New("route not found")
	// ErrNotManual is wrapped by SourceError.
	ErrNotManual = errors.New("route is not manual")
	// ErrConflict is wrapped by ConflictError.
	ErrConflict = errors.New("route conflicts with an existing route")
)

// ValidationError describes bad operator input. Field names the input it is
// about, so a form can put the message beside it.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

// SourceError refuses a write to a route the service does not manage: FARP
// and discovery rebuild their routes on every update, so a change made here
// would silently revert.
type SourceError struct {
	ID     string
	Source bastion.RouteSource
}

func (e *SourceError) Error() string {
	return fmt.Sprintf("route %q comes from %s; its next update would undo any change made here", e.ID, e.Source)
}

func (e *SourceError) Unwrap() error { return ErrNotManual }

// ConflictError refuses a manual route that would serve the same path and an
// overlapping method as another manual route.
type ConflictError struct {
	Path    string
	OtherID string
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("route %q already serves %s for an overlapping method", e.OtherID, e.Path)
}

func (e *ConflictError) Unwrap() error { return ErrConflict }
```

`admin/redact.go`:

```go
package admin

import (
	"maps"
	"slices"
	"strings"

	bastion "github.com/xraph/bastion"
)

// Redacted replaces a sensitive header value. The header's name stays, so an
// operator can see that it is set.
const Redacted = "[redacted]"

// SensitiveHeader reports whether a header's value may carry a credential.
func SensitiveHeader(name string) bool {
	n := strings.ToLower(name)
	switch n {
	case "authorization", "proxy-authorization", "cookie", "set-cookie":
		return true
	}

	return strings.Contains(n, "key") || strings.Contains(n, "token") || strings.Contains(n, "secret")
}

// RedactHeaders returns a copy of p with sensitive values replaced.
func RedactHeaders(p bastion.HeaderPolicy) bastion.HeaderPolicy {
	return bastion.HeaderPolicy{
		Add:    redactMap(p.Add),
		Set:    redactMap(p.Set),
		Remove: slices.Clone(p.Remove),
	}
}

// RedactTransform returns a copy of t with sensitive values replaced.
func RedactTransform(t *bastion.TransformConfig) *bastion.TransformConfig {
	if t == nil {
		return nil
	}

	return &bastion.TransformConfig{
		RequestHeaders:  RedactHeaders(t.RequestHeaders),
		ResponseHeaders: RedactHeaders(t.ResponseHeaders),
	}
}

func redactMap(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}

	out := maps.Clone(m)
	for k := range out {
		if SensitiveHeader(k) {
			out[k] = Redacted
		}
	}

	return out
}

// sortedKeys returns m's keys in order, never nil.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	slices.Sort(keys)

	return keys
}
```

In the root `extension.go`, beside `Circuits`:

```go
// RoutesPersisted reports whether a route store is wired, so a route created
// through the admin API survives a restart.
func (e *Gateway) RoutesPersisted() bool { return e.routeStore != nil }
```

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./admin/ -v 2>&1 | grep -E "^(---|ok|FAIL)"`
Expected: four PASS lines and `ok`.

- [ ] **Step 5: Commit**

```bash
git add admin/admin.go admin/errors.go admin/redact.go admin/redact_test.go
git commit --only admin/admin.go admin/errors.go admin/redact.go admin/redact_test.go extension.go -m "feat(admin): add the admin service's errors and header redaction"
```

---

### Task 2: Admin read models

**Files:**
- Create: `admin/views.go`, `admin/views_test.go`

**Interfaces:**
- Consumes: Task 1's `Service`, `RedactHeaders`, `RedactTransform`, `sortedKeys`; slice 1's `Target.Stats()` and `CircuitControl.Snapshots()`.
- Produces (JSON tags are the contract field names React mirrors):

```go
type RouteFilter struct{ Source, Protocol string }

type RouteSummary struct {
	ID             string                `json:"id"`
	Path           string                `json:"path"`
	Methods        []string              `json:"methods"`        // empty = any method
	Protocol       bastion.RouteProtocol `json:"protocol"`
	Source         bastion.RouteSource   `json:"source"`
	ServiceName    string                `json:"serviceName"`
	Priority       int                   `json:"priority"`       // effective, as sorted
	Enabled        bool                  `json:"enabled"`
	TargetCount    int                   `json:"targetCount"`
	HealthyTargets int                   `json:"healthyTargets"`
	Editable       bool                  `json:"editable"`       // manual
	Config         bool                  `json:"config"`         // from the config file
	UpdatedAt      time.Time             `json:"updatedAt"`
}

type RouteInput struct {
	Path     string `json:"path"`     // without BasePath
	Priority int    `json:"priority"` // without ManualPriorityOffset
}

type TargetView struct {
	ID              string               `json:"id"`
	URL             string               `json:"url"`
	Weight          int                  `json:"weight"`
	Tags            []string             `json:"tags"`
	Healthy         bool                 `json:"healthy"`
	CircuitState    bastion.CircuitState `json:"circuitState"`
	Stats           bastion.TargetStats  `json:"stats"`
	TLS             bool                 `json:"tls"`
	HealthCheckPath string               `json:"healthCheckPath,omitempty"`
	OpenAPI         string               `json:"openapi,omitempty"`
	MetadataKeys    []string             `json:"metadataKeys"`
}

type RouteDetail struct {
	RouteSummary
	Input          *RouteInput               `json:"input,omitempty"` // manual routes only
	StripPrefix    bool                      `json:"stripPrefix"`
	AddPrefix      string                    `json:"addPrefix"`
	RewritePath    string                    `json:"rewritePath"`
	Headers        bastion.HeaderPolicy      `json:"headers"`
	Retry          *bastion.RetryConfig      `json:"retry,omitempty"`
	Timeout        *bastion.TimeoutConfig    `json:"timeout,omitempty"`
	RateLimit      *bastion.RateLimitConfig  `json:"rateLimit,omitempty"`
	Auth           *bastion.RouteAuthConfig  `json:"auth,omitempty"`
	CircuitBreaker *bastion.CBConfig         `json:"circuitBreaker,omitempty"`
	Cache          *bastion.RouteCacheConfig `json:"cache,omitempty"`
	TrafficPolicy  *bastion.TrafficPolicy    `json:"trafficPolicy,omitempty"`
	Transform      *bastion.TransformConfig  `json:"transform,omitempty"`
	MetadataKeys   []string                  `json:"metadataKeys"`
	Version        int64                     `json:"version"`
	CreatedAt      time.Time                 `json:"createdAt"`
	Targets        []TargetView              `json:"targets"`
}

type UpstreamRoute struct {
	RouteID  string `json:"routeId"`
	Path     string `json:"path"`
	TargetID string `json:"targetId"`
}

type Upstream struct {
	URL           string               `json:"url"`
	Healthy       bool                 `json:"healthy"`      // every entry healthy
	CircuitState  bastion.CircuitState `json:"circuitState"` // worst entry
	ActiveConns   int64                `json:"activeConns"`
	TotalRequests int64                `json:"totalRequests"`
	TotalErrors   int64                `json:"totalErrors"`
	AvgLatencyMs  float64              `json:"avgLatencyMs"` // request-weighted
	Routes        []UpstreamRoute      `json:"routes"`
}

type TargetRef struct {
	URL    string
	Routes []UpstreamRoute
}

func (s *Service) ListRoutes(f RouteFilter) []RouteSummary
func (s *Service) GetRoute(id string) (RouteDetail, error) // ErrNotFound
func (s *Service) Upstreams() []Upstream                   // sorted by URL
func (s *Service) Targets() map[string]TargetRef           // live target ids
```

- [ ] **Step 1: Write the failing tests**

`admin/views_test.go`:

```go
package admin_test

import (
	"errors"
	"testing"
	"time"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/admin"
	"github.com/xraph/bastion/resilience"
	"github.com/xraph/bastion/routing"
)

type fixture struct {
	svc *admin.Service
	rm  *routing.Manager
	cbm *resilience.CBManager
}

func newFixture(t *testing.T) fixture {
	t.Helper()

	rm := routing.NewManager()
	cbm := resilience.NewCBManager(bastion.CircuitBreakerConfig{
		Enabled: true, FailureThreshold: 1, ResetTimeout: time.Hour, HalfOpenMax: 1,
	})
	svc, err := admin.New(admin.Deps{Routes: rm, Breakers: cbm, BasePath: "/gw"})
	if err != nil {
		t.Fatal(err)
	}

	return fixture{svc: svc, rm: rm, cbm: cbm}
}

func (f fixture) add(t *testing.T, r *bastion.Route) {
	t.Helper()
	if err := f.rm.AddRoute(r); err != nil {
		t.Fatal(err)
	}
}

func TestListRoutesFiltersAndMarksEditable(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual, Protocol: bastion.ProtocolHTTP, Priority: 110, Enabled: true,
		Targets: []*bastion.Target{{ID: "t1", URL: "http://users:8080", Healthy: true}, {ID: "t2", URL: "http://users2:8080", Healthy: false}}})
	f.add(t, &bastion.Route{ID: "farp-billing-http", Path: "/billing/*", Source: bastion.SourceFARP, Protocol: bastion.ProtocolHTTP, Enabled: true})

	all := f.svc.ListRoutes(admin.RouteFilter{})
	if len(all) != 2 {
		t.Fatalf("routes = %d, want 2", len(all))
	}

	farp := f.svc.ListRoutes(admin.RouteFilter{Source: "farp"})
	if len(farp) != 1 || farp[0].ID != "farp-billing-http" || farp[0].Editable {
		t.Errorf("farp filter = %+v", farp)
	}

	users := f.svc.ListRoutes(admin.RouteFilter{Source: "manual"})[0]
	if !users.Editable || !users.Config || users.TargetCount != 2 || users.HealthyTargets != 1 {
		t.Errorf("users = %+v", users)
	}
	if users.Methods == nil {
		t.Error("methods must be an empty list, not null")
	}
}

func TestGetRouteGivesInputRedactsAndReportsCircuit(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{
		ID: "r1", Path: "/gw/orders", Source: bastion.SourceManual, Priority: 105, Enabled: true,
		Transform: &bastion.TransformConfig{RequestHeaders: bastion.HeaderPolicy{Set: map[string]string{"X-Api-Key": "k-1"}}},
		Metadata:  map[string]any{"owner": "team-a"},
		Targets: []*bastion.Target{{ID: "r1/0", URL: "http://orders:8080", Healthy: true,
			Metadata: map[string]string{"health_check_path": "/healthz", "internal": "x"}}},
	})
	f.cbm.Get("r1/0").RecordFailure() // threshold 1: open

	d, err := f.svc.GetRoute("r1")
	if err != nil {
		t.Fatal(err)
	}
	if d.Input == nil || d.Input.Path != "/orders" || d.Input.Priority != 5 {
		t.Errorf("input = %+v, want /orders at 5", d.Input)
	}
	if d.Transform.RequestHeaders.Set["X-Api-Key"] != admin.Redacted {
		t.Errorf("transform header leaked: %+v", d.Transform)
	}
	if len(d.MetadataKeys) != 1 || d.MetadataKeys[0] != "owner" {
		t.Errorf("metadata keys = %v", d.MetadataKeys)
	}
	tv := d.Targets[0]
	if tv.CircuitState != bastion.CircuitOpen || tv.HealthCheckPath != "/healthz" {
		t.Errorf("target = %+v", tv)
	}
}

func TestGetRouteDiscoveredHasNoInput(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{ID: "farp-x", Path: "/x", Source: bastion.SourceFARP})

	d, err := f.svc.GetRoute("farp-x")
	if err != nil || d.Input != nil {
		t.Errorf("detail = %+v, err = %v; want no input for a FARP route", d, err)
	}
}

func TestGetRouteUnknown(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.GetRoute("nope"); !errors.Is(err, admin.ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestUpstreamsGroupByURL(t *testing.T) {
	f := newFixture(t)
	shared := "http://orders:8080"
	f.add(t, &bastion.Route{ID: "a", Path: "/a", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "a/0", URL: shared, Healthy: true}}})
	f.add(t, &bastion.Route{ID: "b", Path: "/b", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "b/0", URL: shared, Healthy: false}, {ID: "b/1", URL: "http://users:8080", Healthy: true}}})
	f.cbm.Get("b/0").RecordFailure()

	ups := f.svc.Upstreams()
	if len(ups) != 2 || ups[0].URL != shared {
		t.Fatalf("upstreams = %+v", ups)
	}
	if ups[0].Healthy || ups[0].CircuitState != bastion.CircuitOpen || len(ups[0].Routes) != 2 {
		t.Errorf("orders = %+v, want unhealthy, open, used by 2 routes", ups[0])
	}

	refs := f.svc.Targets()
	if refs["b/1"].URL != "http://users:8080" || len(refs) != 3 {
		t.Errorf("targets = %+v", refs)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./admin/ 2>&1 | head -5`
Expected: FAIL to compile, `f.svc.ListRoutes undefined`.

- [ ] **Step 3: Implement**

`admin/views.go`: the types from the Interfaces block above verbatim, then:

```go
func isConfigRoute(r *bastion.Route) bool {
	return r.Source == bastion.SourceManual && strings.HasPrefix(r.ID, "manual-")
}

func (s *Service) circuitStates() map[string]bastion.CircuitState {
	out := map[string]bastion.CircuitState{}
	if s.d.Breakers == nil {
		return out
	}

	for _, c := range s.d.Breakers.Snapshots() {
		out[c.TargetID] = c.State
	}

	return out
}

// stateOf reports a target's breaker state. A target with no breaker has
// never been selected, and a new breaker starts closed.
func stateOf(states map[string]bastion.CircuitState, id string) bastion.CircuitState {
	if st, ok := states[id]; ok {
		return st
	}

	return bastion.CircuitClosed
}

var circuitRank = map[bastion.CircuitState]int{
	bastion.CircuitClosed:   0,
	bastion.CircuitHalfOpen: 1,
	bastion.CircuitOpen:     2,
}

func worse(a, b bastion.CircuitState) bastion.CircuitState {
	if circuitRank[b] > circuitRank[a] {
		return b
	}

	return a
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}

	return slices.Clone(s)
}

func summarize(r *bastion.Route) RouteSummary {
	healthy := 0
	for _, t := range r.Targets {
		if t.Healthy {
			healthy++
		}
	}

	return RouteSummary{
		ID:             r.ID,
		Path:           r.Path,
		Methods:        nonNil(r.Methods),
		Protocol:       r.Protocol,
		Source:         r.Source,
		ServiceName:    r.ServiceName,
		Priority:       r.Priority,
		Enabled:        r.Enabled,
		TargetCount:    len(r.Targets),
		HealthyTargets: healthy,
		Editable:       r.Source == bastion.SourceManual,
		Config:         isConfigRoute(r),
		UpdatedAt:      r.UpdatedAt,
	}
}

// ListRoutes returns the routes in match order, filtered by source and
// protocol when either is set.
func (s *Service) ListRoutes(f RouteFilter) []RouteSummary {
	routes := s.d.Routes.ListRoutes()
	out := make([]RouteSummary, 0, len(routes))

	for _, r := range routes {
		if f.Source != "" && string(r.Source) != f.Source {
			continue
		}

		if f.Protocol != "" && string(r.Protocol) != f.Protocol {
			continue
		}

		out = append(out, summarize(r))
	}

	return out
}

// input reports a manual route's path and priority as the operator entered
// them.
func (s *Service) input(r *bastion.Route) RouteInput {
	return RouteInput{
		Path:     strings.TrimPrefix(r.Path, strings.TrimRight(s.d.BasePath, "/")),
		Priority: r.Priority - ManualPriorityOffset,
	}
}

func targetView(t *bastion.Target, states map[string]bastion.CircuitState) TargetView {
	return TargetView{
		ID:              t.ID,
		URL:             t.URL,
		Weight:          t.Weight,
		Tags:            nonNil(t.Tags),
		Healthy:         t.Healthy,
		CircuitState:    stateOf(states, t.ID),
		Stats:           t.Stats(),
		TLS:             t.TLS != nil && t.TLS.Enabled,
		HealthCheckPath: t.Metadata["health_check_path"],
		OpenAPI:         t.Metadata["openapi"],
		MetadataKeys:    sortedKeys(t.Metadata),
	}
}

// GetRoute returns one route with its targets. Header values that may carry
// credentials are redacted, and metadata is reduced to its keys.
func (s *Service) GetRoute(id string) (RouteDetail, error) {
	r, ok := s.d.Routes.GetRoute(id)
	if !ok {
		return RouteDetail{}, ErrNotFound
	}

	states := s.circuitStates()
	d := RouteDetail{
		RouteSummary:   summarize(r),
		StripPrefix:    r.StripPrefix,
		AddPrefix:      r.AddPrefix,
		RewritePath:    r.RewritePath,
		Headers:        RedactHeaders(r.Headers),
		Retry:          r.Retry,
		Timeout:        r.Timeout,
		RateLimit:      r.RateLimit,
		Auth:           r.Auth,
		CircuitBreaker: r.CircuitBreaker,
		Cache:          r.Cache,
		TrafficPolicy:  r.TrafficPolicy,
		Transform:      RedactTransform(r.Transform),
		MetadataKeys:   sortedKeys(r.Metadata),
		Version:        r.Version,
		CreatedAt:      r.CreatedAt,
		Targets:        make([]TargetView, 0, len(r.Targets)),
	}

	if r.Source == bastion.SourceManual {
		in := s.input(r)
		d.Input = &in
	}

	for _, t := range r.Targets {
		d.Targets = append(d.Targets, targetView(t, states))
	}

	return d, nil
}

// Upstreams groups every live target by URL. An upstream is healthy only
// when every entry for it is, and reports its worst breaker state.
func (s *Service) Upstreams() []Upstream {
	states := s.circuitStates()
	byURL := map[string]*Upstream{}
	weighted := map[string]float64{}

	for _, r := range s.d.Routes.ListRoutes() {
		for _, t := range r.Targets {
			u, ok := byURL[t.URL]
			if !ok {
				u = &Upstream{URL: t.URL, Healthy: true, CircuitState: bastion.CircuitClosed, Routes: []UpstreamRoute{}}
				byURL[t.URL] = u
			}

			st := t.Stats()
			u.Healthy = u.Healthy && t.Healthy
			u.CircuitState = worse(u.CircuitState, stateOf(states, t.ID))
			u.ActiveConns += st.ActiveConns
			u.TotalRequests += st.TotalRequests
			u.TotalErrors += st.TotalErrors
			weighted[t.URL] += st.AvgLatencyMs * float64(st.TotalRequests)
			u.Routes = append(u.Routes, UpstreamRoute{RouteID: r.ID, Path: r.Path, TargetID: t.ID})
		}
	}

	out := make([]Upstream, 0, len(byURL))
	for url, u := range byURL {
		if u.TotalRequests > 0 {
			u.AvgLatencyMs = weighted[url] / float64(u.TotalRequests)
		}

		out = append(out, *u)
	}

	slices.SortFunc(out, func(a, b Upstream) int { return strings.Compare(a.URL, b.URL) })

	return out
}

// Targets indexes every live target id. A breaker whose id is not here
// belongs to a target no route uses any more.
func (s *Service) Targets() map[string]TargetRef {
	out := map[string]TargetRef{}

	for _, r := range s.d.Routes.ListRoutes() {
		for _, t := range r.Targets {
			ref := out[t.ID]
			ref.URL = t.URL
			ref.Routes = append(ref.Routes, UpstreamRoute{RouteID: r.ID, Path: r.Path, TargetID: t.ID})
			out[t.ID] = ref
		}
	}

	return out
}
```

Imports: `slices`, `strings`, `time`, `bastion`.

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./admin/ -v 2>&1 | grep -E "^(---|ok|FAIL)"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/views.go admin/views_test.go
git commit --only admin/views.go admin/views_test.go -m "feat(admin): read models for routes, targets and upstreams"
```

---

### Task 3: Admin writes

**Files:**
- Create: `admin/writes.go`, `admin/writes_test.go`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:

```go
func (s *Service) CreateRoute(dto bastion.RouteDTO) (*bastion.Route, error)
func (s *Service) UpdateRoute(id string, dto bastion.RouteDTO) (*bastion.Route, error)
func (s *Service) DeleteRoute(id string) error
// SetEnabled reports durable=false when the change will not survive a
// restart: a config-file route, or no route store.
func (s *Service) SetEnabled(id string, enabled bool) (durable bool, err error)
```

`dto.Path` and `dto.Priority` are always as entered. Target ids are `<routeID>/<n>`.

- [ ] **Step 1: Write the failing tests**

`admin/writes_test.go`:

```go
package admin_test

import (
	"errors"
	"testing"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/admin"
)

func ordersDTO() bastion.RouteDTO {
	return bastion.RouteDTO{
		Path:     "/orders",
		Methods:  []string{"GET"},
		Priority: 5,
		Enabled:  true,
		Targets:  []bastion.TargetDTO{{URL: "http://orders:8080", Weight: 2}},
	}
}

func TestCreateAppliesOffsetsOnce(t *testing.T) {
	f := newFixture(t)
	r, err := f.svc.CreateRoute(ordersDTO())
	if err != nil {
		t.Fatal(err)
	}
	if r.Path != "/gw/orders" || r.Priority != 105 || r.Source != bastion.SourceManual {
		t.Errorf("route = %+v", r)
	}
	if r.Targets[0].ID != r.ID+"/0" {
		t.Errorf("target id = %q, want %q", r.Targets[0].ID, r.ID+"/0")
	}
}

func TestLoadAndSaveUnchangedIsANoOp(t *testing.T) {
	f := newFixture(t)
	r, _ := f.svc.CreateRoute(ordersDTO())
	before := r.Targets[0]

	d, _ := f.svc.GetRoute(r.ID)
	// What an editor sends back: the input values, not the effective ones.
	dto := ordersDTO()
	dto.Path, dto.Priority = d.Input.Path, d.Input.Priority

	if _, err := f.svc.UpdateRoute(r.ID, dto); err != nil {
		t.Fatal(err)
	}
	after, _ := f.rm.GetRoute(r.ID)
	if after.Path != "/gw/orders" || after.Priority != 105 {
		t.Errorf("after save: path %q priority %d, want /gw/orders 105", after.Path, after.Priority)
	}
	if after.Targets[0] != before {
		t.Error("an unchanged target was replaced; its counters would restart")
	}
}

func TestUpdateChangedWeightKeepsTargetID(t *testing.T) {
	f := newFixture(t)
	r, _ := f.svc.CreateRoute(ordersDTO())
	dto := ordersDTO()
	dto.Targets[0].Weight = 9

	up, err := f.svc.UpdateRoute(r.ID, dto)
	if err != nil {
		t.Fatal(err)
	}
	if up.Targets[0].ID != r.Targets[0].ID || up.Targets[0].Weight != 9 {
		t.Errorf("target = %+v", up.Targets[0])
	}
}

func TestUpdateDropsBreakerOfRemovedTarget(t *testing.T) {
	f := newFixture(t)
	r, _ := f.svc.CreateRoute(ordersDTO())
	f.cbm.Get(r.Targets[0].ID).RecordFailure()

	dto := ordersDTO()
	dto.Targets = []bastion.TargetDTO{{URL: "http://orders-v2:8080"}}
	if _, err := f.svc.UpdateRoute(r.ID, dto); err != nil {
		t.Fatal(err)
	}
	for _, s := range f.cbm.Snapshots() {
		if s.TargetID == r.Targets[0].ID {
			t.Error("breaker of the removed target survived")
		}
	}
}

func TestDeleteKeepsBreakerOfTargetAnotherRouteUses(t *testing.T) {
	f := newFixture(t)
	// A legacy REST route and a config route sharing one target id.
	f.add(t, &bastion.Route{ID: "a", Path: "/gw/a", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "target-http-orders:8080", URL: "http://orders:8080"}}})
	f.add(t, &bastion.Route{ID: "b", Path: "/gw/b", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "target-http-orders:8080", URL: "http://orders:8080"}}})
	f.cbm.Get("target-http-orders:8080")

	if err := f.svc.DeleteRoute("a"); err != nil {
		t.Fatal(err)
	}
	if len(f.cbm.Snapshots()) != 1 {
		t.Error("deleting route a removed the breaker route b still uses")
	}
}

func TestWritesRefuseDiscoveredRoutes(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{ID: "farp-x", Path: "/x", Source: bastion.SourceFARP})

	var se *admin.SourceError
	if _, err := f.svc.UpdateRoute("farp-x", ordersDTO()); !errors.As(err, &se) || se.Source != bastion.SourceFARP {
		t.Errorf("update err = %v", err)
	}
	if err := f.svc.DeleteRoute("farp-x"); !errors.Is(err, admin.ErrNotManual) {
		t.Errorf("delete err = %v", err)
	}
	if _, err := f.svc.SetEnabled("farp-x", false); !errors.Is(err, admin.ErrNotManual) {
		t.Errorf("setEnabled err = %v", err)
	}
}

func TestConflictOnlyAgainstManualRoutes(t *testing.T) {
	f := newFixture(t)
	f.add(t, &bastion.Route{ID: "farp-o", Path: "/gw/orders", Source: bastion.SourceFARP})
	if _, err := f.svc.CreateRoute(ordersDTO()); err != nil {
		t.Fatalf("a manual route may shadow a FARP route: %v", err)
	}

	dup := ordersDTO()
	dup.Methods = nil // any method overlaps GET
	if _, err := f.svc.CreateRoute(dup); !errors.Is(err, admin.ErrConflict) {
		t.Errorf("err = %v, want ErrConflict", err)
	}

	post := ordersDTO()
	post.Methods = []string{"POST"}
	if _, err := f.svc.CreateRoute(post); err != nil {
		t.Errorf("disjoint methods must not conflict: %v", err)
	}
}

func TestValidation(t *testing.T) {
	f := newFixture(t)
	for name, mutate := range map[string]func(*bastion.RouteDTO){
		"path":      func(d *bastion.RouteDTO) { d.Path = "orders" },
		"targets":   func(d *bastion.RouteDTO) { d.Targets = nil },
		"scheme":    func(d *bastion.RouteDTO) { d.Targets[0].URL = "ftp://x" },
		"duplicate": func(d *bastion.RouteDTO) { d.Targets = append(d.Targets, d.Targets[0]) },
		"weight":    func(d *bastion.RouteDTO) { d.Targets[0].Weight = -1 },
		"protocol":  func(d *bastion.RouteDTO) { d.Protocol = "smtp" },
		"method":    func(d *bastion.RouteDTO) { d.Methods = []string{"FETCH"} },
	} {
		dto := ordersDTO()
		mutate(&dto)
		var ve *admin.ValidationError
		if _, err := f.svc.CreateRoute(dto); !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
}

func TestSetEnabledDurability(t *testing.T) {
	f := newFixture(t)
	r, _ := f.svc.CreateRoute(ordersDTO())
	f.add(t, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual})

	durable, err := f.svc.SetEnabled(r.ID, false)
	if err != nil || durable {
		t.Errorf("no store: durable=%v err=%v, want false nil", durable, err)
	}
	got, _ := f.rm.GetRoute(r.ID)
	if got.Enabled {
		t.Error("route still enabled")
	}
	if got == r {
		t.Error("SetEnabled wrote the live route pointer instead of a copy")
	}

	svc, _ := admin.New(admin.Deps{Routes: f.rm, BasePath: "/gw", Persisted: func() bool { return true }})
	if durable, _ := svc.SetEnabled(r.ID, true); !durable {
		t.Error("with a store an API route change is durable")
	}
	if durable, _ := svc.SetEnabled("manual-/users", false); durable {
		t.Error("a config-file route change is never durable")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./admin/ 2>&1 | head -5`
Expected: FAIL to compile, `f.svc.CreateRoute undefined`.

- [ ] **Step 3: Implement**

`admin/writes.go`:

```go
package admin

import (
	"fmt"
	"maps"
	"net/url"
	"reflect"
	"slices"
	"strings"

	"github.com/google/uuid"

	bastion "github.com/xraph/bastion"
)

var validSchemes = map[string]bool{"http": true, "https": true, "ws": true, "wss": true}

var validProtocols = map[bastion.RouteProtocol]bool{
	bastion.ProtocolHTTP: true, bastion.ProtocolWebSocket: true, bastion.ProtocolSSE: true,
	bastion.ProtocolGRPC: true, bastion.ProtocolGraphQL: true,
}

var validMethods = map[string]bool{
	"GET": true, "HEAD": true, "POST": true, "PUT": true, "PATCH": true,
	"DELETE": true, "OPTIONS": true, "CONNECT": true, "TRACE": true,
}

func validate(dto bastion.RouteDTO) error {
	if !strings.HasPrefix(dto.Path, "/") {
		return &ValidationError{Field: "path", Message: "must start with /"}
	}

	if len(dto.Targets) == 0 {
		return &ValidationError{Field: "targets", Message: "at least one upstream is required"}
	}

	seen := map[string]bool{}

	for i, t := range dto.Targets {
		u, err := url.Parse(t.URL)
		if err != nil || u.Host == "" || !validSchemes[u.Scheme] {
			return &ValidationError{Field: "targets", Message: fmt.Sprintf("upstream %d: %q is not an http, https, ws or wss URL", i+1, t.URL)}
		}

		if seen[t.URL] {
			return &ValidationError{Field: "targets", Message: fmt.Sprintf("upstream %d: %s is listed twice", i+1, t.URL)}
		}

		seen[t.URL] = true

		if t.Weight < 0 {
			return &ValidationError{Field: "targets", Message: fmt.Sprintf("upstream %d: weight cannot be negative", i+1)}
		}
	}

	if dto.Protocol != "" && !validProtocols[dto.Protocol] {
		return &ValidationError{Field: "protocol", Message: fmt.Sprintf("%q is not a protocol bastion proxies", dto.Protocol)}
	}

	for _, m := range dto.Methods {
		if !validMethods[strings.ToUpper(m)] {
			return &ValidationError{Field: "methods", Message: fmt.Sprintf("%q is not an HTTP method", m)}
		}
	}

	return nil
}

func upper(ms []string) []string {
	if len(ms) == 0 {
		return nil
	}

	out := make([]string, len(ms))
	for i, m := range ms {
		out[i] = strings.ToUpper(m)
	}

	return out
}

func methodsOverlap(a, b []string) bool {
	if len(a) == 0 || len(b) == 0 {
		return true
	}

	for _, m := range a {
		if slices.ContainsFunc(b, func(x string) bool { return strings.EqualFold(x, m) }) {
			return true
		}
	}

	return false
}

// checkConflict refuses a second manual route on the same path and an
// overlapping method. Discovered routes are not checked: shadowing one is
// what the manual priority offset is for.
func (s *Service) checkConflict(r *bastion.Route) error {
	for _, o := range s.d.Routes.ListRoutes() {
		if o.ID == r.ID || o.Source != bastion.SourceManual || o.Path != r.Path {
			continue
		}

		if methodsOverlap(o.Methods, r.Methods) {
			return &ConflictError{Path: r.Path, OtherID: o.ID}
		}
	}

	return nil
}

func sameTarget(t *bastion.Target, td bastion.TargetDTO, weight int) bool {
	return t.Weight == weight &&
		slices.Equal(t.Tags, td.Tags) &&
		maps.Equal(t.Metadata, td.Metadata) &&
		reflect.DeepEqual(t.TLS, td.TLS)
}

func newTarget(id string, td bastion.TargetDTO, weight int) *bastion.Target {
	return &bastion.Target{
		ID:       id,
		URL:      td.URL,
		Weight:   weight,
		Healthy:  true,
		Tags:     slices.Clone(td.Tags),
		Metadata: maps.Clone(td.Metadata),
		TLS:      td.TLS,
	}
}

// build turns entered values into a route. Against an existing route, a
// target whose URL is unchanged keeps its id, so its health entry and breaker
// carry over; if nothing else about it changed it keeps its object too, and
// its counters with it. A changed target is a new object because writing a
// live target's fields races the load balancer.
func (s *Service) build(id string, dto bastion.RouteDTO, existing *bastion.Route) *bastion.Route {
	prior := map[string]*bastion.Target{}
	used := map[string]bool{}

	if existing != nil {
		for _, t := range existing.Targets {
			prior[t.URL] = t
			used[t.ID] = true
		}
	}

	targets := make([]*bastion.Target, 0, len(dto.Targets))
	next := 0

	for _, td := range dto.Targets {
		weight := td.Weight
		if weight <= 0 {
			weight = 1
		}

		if t, ok := prior[td.URL]; ok {
			if sameTarget(t, td, weight) {
				targets = append(targets, t)
			} else {
				targets = append(targets, newTarget(t.ID, td, weight))
			}

			continue
		}

		for used[fmt.Sprintf("%s/%d", id, next)] {
			next++
		}

		tid := fmt.Sprintf("%s/%d", id, next)
		used[tid] = true
		targets = append(targets, newTarget(tid, td, weight))
	}

	protocol := dto.Protocol
	if protocol == "" {
		protocol = bastion.ProtocolHTTP
	}

	return &bastion.Route{
		ID:             id,
		Path:           strings.TrimRight(s.d.BasePath, "/") + dto.Path,
		Methods:        upper(dto.Methods),
		Targets:        targets,
		StripPrefix:    dto.StripPrefix,
		AddPrefix:      dto.AddPrefix,
		RewritePath:    dto.RewritePath,
		Headers:        dto.Headers,
		Protocol:       protocol,
		Source:         bastion.SourceManual,
		Priority:       dto.Priority + ManualPriorityOffset,
		Enabled:        dto.Enabled,
		Retry:          dto.Retry,
		Timeout:        dto.Timeout,
		RateLimit:      dto.RateLimit,
		Auth:           dto.Auth,
		CircuitBreaker: dto.CircuitBreaker,
		Cache:          dto.Cache,
		TrafficPolicy:  dto.TrafficPolicy,
		Transform:      dto.Transform,
		Metadata:       dto.Metadata,
	}
}

// forget drops health entries and breakers for targets that no route uses
// after a write. Ids still used elsewhere are kept: legacy REST routes share
// target ids by URL.
func (s *Service) forget(removed []*bastion.Target) {
	if len(removed) == 0 {
		return
	}

	live := s.Targets()

	for _, t := range removed {
		if _, ok := live[t.ID]; ok {
			continue
		}

		if s.d.Health != nil {
			s.d.Health.Deregister(t.ID)
		}

		if s.d.Breakers != nil {
			s.d.Breakers.Remove(t.ID)
		}
	}
}

func (s *Service) manual(id string) (*bastion.Route, error) {
	r, ok := s.d.Routes.GetRoute(id)
	if !ok {
		return nil, ErrNotFound
	}

	if r.Source != bastion.SourceManual {
		return nil, &SourceError{ID: id, Source: r.Source}
	}

	return r, nil
}

// CreateRoute adds a manual route from entered values.
func (s *Service) CreateRoute(dto bastion.RouteDTO) (*bastion.Route, error) {
	if err := validate(dto); err != nil {
		return nil, err
	}

	r := s.build(uuid.NewString(), dto, nil)
	if err := s.checkConflict(r); err != nil {
		return nil, err
	}

	if err := s.d.Routes.AddRoute(r); err != nil {
		return nil, err
	}

	return r, nil
}

// UpdateRoute replaces a manual route from entered values.
func (s *Service) UpdateRoute(id string, dto bastion.RouteDTO) (*bastion.Route, error) {
	existing, err := s.manual(id)
	if err != nil {
		return nil, err
	}

	if err := validate(dto); err != nil {
		return nil, err
	}

	r := s.build(id, dto, existing)
	if err := s.checkConflict(r); err != nil {
		return nil, err
	}

	if err := s.d.Routes.UpdateRoute(r); err != nil {
		return nil, err
	}

	kept := map[string]bool{}
	for _, t := range r.Targets {
		kept[t.ID] = true
	}

	var removed []*bastion.Target
	for _, t := range existing.Targets {
		if !kept[t.ID] {
			removed = append(removed, t)
		}
	}

	s.forget(removed)

	return r, nil
}

// DeleteRoute removes a manual route.
func (s *Service) DeleteRoute(id string) error {
	existing, err := s.manual(id)
	if err != nil {
		return err
	}

	if err := s.d.Routes.RemoveRoute(id); err != nil {
		return err
	}

	s.forget(existing.Targets)

	return nil
}

// SetEnabled turns a manual route on or off. It writes a copy: the live route
// is read by the proxy without a lock.
func (s *Service) SetEnabled(id string, enabled bool) (bool, error) {
	existing, err := s.manual(id)
	if err != nil {
		return false, err
	}

	cp := *existing
	cp.Enabled = enabled

	if err := s.d.Routes.UpdateRoute(&cp); err != nil {
		return false, err
	}

	return !isConfigRoute(existing) && s.persisted(), nil
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./admin/ -v 2>&1 | grep -E "^(---|ok|FAIL)"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/writes.go admin/writes_test.go
git commit --only admin/writes.go admin/writes_test.go -m "feat(admin): manual route writes with offsets applied once

A route loaded and saved unchanged is now a no-op: the service takes path
and priority as entered and applies the base path and the +100 manual
offset itself. Targets are scoped to their route, an unchanged target keeps
its object and counters, and removed targets drop their health entry and
breaker unless another route still uses them. Writes refuse FARP and
discovery routes, which their next update would overwrite, and a second
manual route on the same path and an overlapping method."
```

---

### Task 4: REST handlers onto the admin service

**Files:**
- Modify: `api/handlers.go` (struct, `NewHandlers`, the seven route handlers, delete `dtoToRoute`)
- Modify: `extension/extension.go` (build the service, keep it on `Extension`)

**Interfaces:**
- Consumes: Task 3.
- Produces: `func NewHandlers(gw Gateway, hub *Hub, svc *admin.Service) *Handlers`; `Extension.admin *admin.Service`, set in `Register`.

REST behaviour after this task: create answers 400 on a validation error (previously a validation error could not happen), 409 on a conflict; enable and disable answer 400 on a FARP or discovery route with the message `cannot change auto-discovered routes: the next discovery update would undo it`. Response bodies are otherwise unchanged. This is a refactor with a behaviour change already covered by Task 3's tests, so there is no new test here; the gate is the build and the full suite.

- [ ] **Step 1: Rewire `api/handlers.go`**

Change the struct and constructor:

```go
type Handlers struct {
	gw  Gateway
	hub *Hub
	svc *admin.Service
}

// NewHandlers creates new admin API handlers.
func NewHandlers(gw Gateway, hub *Hub, svc *admin.Service) *Handlers {
	return &Handlers{gw: gw, hub: hub, svc: svc}
}
```

Add a shared error writer:

```go
// writeAdminError maps an admin service error to the REST status and body
// the handlers have always used.
func writeAdminError(ctx forge.Context, err error, discovered string) error {
	var ve *admin.ValidationError
	switch {
	case errors.As(err, &ve):
		return ctx.JSON(http.StatusBadRequest, map[string]string{"error": ve.Error(), "field": ve.Field})
	case errors.Is(err, admin.ErrNotFound):
		return ctx.JSON(http.StatusNotFound, map[string]string{"error": "route not found"})
	case errors.Is(err, admin.ErrNotManual):
		return ctx.JSON(http.StatusBadRequest, map[string]string{"error": discovered})
	case errors.Is(err, admin.ErrConflict):
		return ctx.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		return ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
```

Replace the bodies of the write handlers:

```go
func (h *Handlers) HandleCreateRoute(ctx forge.Context) error {
	var dto bastion.RouteDTO
	if err := json.NewDecoder(ctx.Request().Body).Decode(&dto); err != nil {
		return ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
	}

	route, err := h.svc.CreateRoute(dto)
	if err != nil {
		return writeAdminError(ctx, err, "")
	}

	h.gw.AccessLog().LogAdminAction("create_route", route.ID, "success", ctx.Request())

	return ctx.JSON(http.StatusCreated, route)
}

func (h *Handlers) HandleUpdateRoute(ctx forge.Context) error {
	id := ctx.Param("id")

	var dto bastion.RouteDTO
	if err := json.NewDecoder(ctx.Request().Body).Decode(&dto); err != nil {
		return ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
	}

	updated, err := h.svc.UpdateRoute(id, dto)
	if err != nil {
		return writeAdminError(ctx, err, "cannot update auto-discovered routes")
	}

	h.gw.AccessLog().LogAdminAction("update_route", id, "success", ctx.Request())

	return ctx.JSON(http.StatusOK, updated)
}

func (h *Handlers) HandleDeleteRoute(ctx forge.Context) error {
	id := ctx.Param("id")

	if err := h.svc.DeleteRoute(id); err != nil {
		return writeAdminError(ctx, err, "cannot delete auto-discovered routes")
	}

	h.gw.AccessLog().LogAdminAction("delete_route", id, "success", ctx.Request())

	return ctx.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) HandleEnableRoute(ctx forge.Context) error {
	return h.setEnabled(ctx, true, "enabled")
}

func (h *Handlers) HandleDisableRoute(ctx forge.Context) error {
	return h.setEnabled(ctx, false, "disabled")
}

func (h *Handlers) setEnabled(ctx forge.Context, enabled bool, status string) error {
	id := ctx.Param("id")

	if _, err := h.svc.SetEnabled(id, enabled); err != nil {
		return writeAdminError(ctx, err, "cannot change auto-discovered routes: the next discovery update would undo it")
	}

	h.gw.AccessLog().LogAdminAction(status+"_route", id, "success", ctx.Request())

	return ctx.JSON(http.StatusOK, map[string]string{"status": status})
}
```

Delete `dtoToRoute` (the admin service owns the conversion now) and the explicit `HealthMonitor().Register` calls it fed: the gateway's route-change listener registers targets for every source. Add imports `errors` and `github.com/xraph/bastion/admin`; drop `strings` if nothing else uses it.

`HandleGetRoute` and `HandleListUpstreams` call `t.Snapshot()` on live targets. Leave them: their response shape depends on the exported fields that `Snapshot` fills, and changing REST read shapes is decision 1's territory. Record it in the ledger as a known race kept for REST compatibility.

- [ ] **Step 2: Wire the service in `extension/extension.go`**

Add the field to `Extension`:

```go
	gw    *bastion.Gateway
	admin *admin.Service
	opts  []bastion.ConfigOption
```

In `Register`, after `gw.SetStatsRecorder(stats)` and before the admin handler setup:

```go
	svc, err := admin.New(admin.Deps{
		Routes:    rm,
		Health:    gw.HealthMonitor(),
		Breakers:  cbm,
		BasePath:  cfg.BasePath,
		Persisted: gw.RoutesPersisted,
	})
	if err != nil {
		return fmt.Errorf("bastion: build admin service: %w", err)
	}
	e.admin = svc
```

and change the handler construction to `h := api.NewHandlers(gw, hub, svc)`. Add the `admin` import (and `fmt` if missing).

- [ ] **Step 3: Gate**

Run: `gofmt -l . && go vet ./... && go build ./... && go test -race ./...`
Expected: no gofmt output, PASS.

- [ ] **Step 4: Commit**

```bash
git commit --only api/handlers.go extension/extension.go -m "refactor(api): route writes go through the admin service

REST create now answers 400 with the field on bad input and 409 on a
second manual route for the same path and methods. Enable and disable
refuse FARP and discovery routes, whose next update used to undo the
change silently."
```

---

### Task 5: Contract skeleton

**Files:**
- Create: `extension/contract/manifest.yaml`, `extension/contract/contract.go`, `extension/contract/errors.go`
- Create: `extension/contract/manifest_test.go`, `extension/contract/contract_test.go`, `extension/contract/helpers_test.go`
- Create: `extension/contract/handlers_stats.go`, `extension/contract/handlers_routes.go`, `extension/contract/handlers_platform.go` (stubs that Tasks 6 to 8 fill)
- Modify: `extension/extension.go` (`RegisterContractContributor`)
- Create: `extension/dashboard_aware_test.go`

**Interfaces:**
- Consumes: Task 4's `Extension.admin`.
- Produces:

```go
package contract
const ContributorName = "bastion"
type Deps struct {
	Gateway *bastion.Gateway // required
	Admin   *admin.Service   // required
	Logger  forge.Logger     // optional
}
func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error
func mapError(err error) error
func (d Deps) mapError(intent string, err error) error
```

Test helper `newTestDeps(t) (Deps, *routing.Manager, *resilience.CBManager, *proxy.StatsCollector)` in `helpers_test.go`.

- [ ] **Step 1: Write the manifest**

`extension/contract/manifest.yaml`:

```yaml
schemaVersion: 1
contributor:
  name: bastion
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [bastion.read, bastion.write]

# No app block and no graph: the React plugin owns routes, this manifest only
# declares intents and their cache hints. One gateway per process, so no
# intent takes a tenant or app id. Commands arrive in slice 3.
intents:
  - { name: overview.stats,  kind: query, version: 1, capability: read }
  - { name: traffic.stats,   kind: query, version: 1, capability: read }
  - { name: circuits.list,   kind: query, version: 1, capability: read }
  - { name: routes.list,     kind: query, version: 1, capability: read }
  - { name: routes.detail,   kind: query, version: 1, capability: read }
  - { name: upstreams.list,  kind: query, version: 1, capability: read }
  - { name: services.list,   kind: query, version: 1, capability: read }
  - { name: openapi.summary, kind: query, version: 1, capability: read }
  - { name: config.detail,   kind: query, version: 1, capability: read }

queries:
  overviewStats:
    intent: overview.stats
    cache: { staleTime: 5s }
  trafficStats:
    intent: traffic.stats
    cache: { staleTime: 5s }
  circuitsList:
    intent: circuits.list
    cache: { staleTime: 5s }
  routesList:
    intent: routes.list
    cache: { staleTime: 30s }
  routesDetail:
    intent: routes.detail
    cache: { staleTime: 30s }
  upstreamsList:
    intent: upstreams.list
    cache: { staleTime: 15s }
  servicesList:
    intent: services.list
    cache: { staleTime: 30s }
  openapiSummary:
    intent: openapi.summary
    cache: { staleTime: 30s }
  configDetail:
    intent: config.detail
    cache: { staleTime: 60s }
```

- [ ] **Step 2: Write the failing tests**

`extension/contract/helpers_test.go`:

```go
package contract

import (
	"testing"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/admin"
	"github.com/xraph/bastion/proxy"
	"github.com/xraph/bastion/resilience"
	"github.com/xraph/bastion/routing"
)

// newTestDeps wires a gateway the way extension/ does, without starting it.
func newTestDeps(t *testing.T) (Deps, *routing.Manager, *resilience.CBManager, *proxy.StatsCollector) {
	t.Helper()

	gw, ok := bastion.New(bastion.WithEnabled(true), bastion.WithBasePath("/gw")).(*bastion.Gateway)
	if !ok {
		t.Fatal("expected *bastion.Gateway")
	}

	rm := routing.NewManager()
	cbm := resilience.NewCBManager(gw.Config().CircuitBreaker)
	stats := proxy.NewStatsCollector()
	gw.SetRouteRegistry(rm)
	gw.SetCircuitControl(cbm)
	gw.SetStatsRecorder(stats)

	svc, err := admin.New(admin.Deps{Routes: rm, Breakers: cbm, BasePath: "/gw"})
	if err != nil {
		t.Fatal(err)
	}

	return Deps{Gateway: gw, Admin: svc}, rm, cbm, stats
}

func addRoute(t *testing.T, rm *routing.Manager, r *bastion.Route) {
	t.Helper()
	if err := rm.AddRoute(r); err != nil {
		t.Fatal(err)
	}
}
```

`extension/contract/manifest_test.go`:

```go
package contract

import (
	"bytes"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

func loadManifest(t *testing.T) *dashcontract.ContractManifest {
	t.Helper()
	m, err := loader.Load(bytes.NewReader(manifestYAML), "bastion/contract/manifest.yaml")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return m
}

func TestManifest_NineQueriesNamedBastion(t *testing.T) {
	m := loadManifest(t)
	if m.Contributor.Name != ContributorName {
		t.Errorf("contributor = %q, want %q", m.Contributor.Name, ContributorName)
	}
	if len(m.Intents) != 9 {
		t.Errorf("intents = %d, want 9", len(m.Intents))
	}
	for _, in := range m.Intents {
		if in.Kind != dashcontract.IntentKindQuery {
			t.Errorf("%s kind = %q, want query", in.Name, in.Kind)
		}
	}
}

func TestManifest_EveryIntentHasACacheHint(t *testing.T) {
	m := loadManifest(t)
	cached := map[string]bool{}
	for _, q := range m.Queries {
		if q.Cache == nil || q.Cache.StaleTime == "" {
			t.Errorf("query for %s has no staleTime", q.Intent)
			continue
		}
		cached[q.Intent] = true
	}
	for _, in := range m.Intents {
		if !cached[in.Name] {
			t.Errorf("%s has no queries entry", in.Name)
		}
	}
}

func TestManifest_ValidatesAndRegisters(t *testing.T) {
	m := loadManifest(t)
	if err := loader.Validate(m, dashcontract.NewWardenRegistry()); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if err := dashcontract.NewRegistry().Register(m); err != nil {
		t.Fatalf("register: %v", err)
	}
}
```

`extension/contract/contract_test.go`:

```go
package contract

import (
	"context"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
)

func TestRegister_RequiresGatewayAndAdmin(t *testing.T) {
	d := dispatcher.New(nil)
	if err := Register(d, dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(), Deps{}); err == nil {
		t.Error("Register with no deps returned no error")
	}
}

func TestEveryDeclaredIntentIsRegistered(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	d := dispatcher.New(nil)
	if err := Register(d, dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(), deps); err != nil {
		t.Fatalf("Register: %v", err)
	}

	for _, intent := range loadManifest(t).Intents {
		req := dashcontract.Request{
			Envelope:      "v1",
			Kind:          dashcontract.KindQuery,
			Contributor:   ContributorName,
			Intent:        intent.Name,
			IntentVersion: 1,
			Params:        map[string]any{},
		}
		_, _, err := d.Dispatch(context.Background(), req, dashcontract.Principal{})
		if err != nil && strings.Contains(strings.ToLower(err.Error()), "not registered") {
			t.Errorf("%s is not registered: %v", intent.Name, err)
		}
	}
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `go test ./extension/contract/ 2>&1 | head -5`
Expected: FAIL to compile, `undefined: manifestYAML` / `Register`.

- [ ] **Step 4: Implement the skeleton**

`extension/contract/contract.go`:

```go
// Package contract wires Bastion into the Forge dashboard's contract path. It
// registers the `bastion` contributor and answers its intents from the live
// gateway and the admin service.
package contract

import (
	"bytes"
	_ "embed"
	"fmt"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/admin"
)

//go:embed manifest.yaml
var manifestYAML []byte

// ContributorName is the join key with packages/plugin-bastion's `extension`
// field. A mismatch hides the React plugin with no error anywhere, because
// that is what an uninstalled extension looks like.
const ContributorName = "bastion"

// Deps bundles what the handlers need.
type Deps struct {
	// Gateway answers stats, circuits, discovery, OpenAPI and config. Required.
	Gateway *bastion.Gateway
	// Admin answers route reads and performs route writes. Required.
	Admin *admin.Service
	// Logger receives an Error entry for every error mapped to CodeInternal.
	// Optional.
	Logger forge.Logger
}

// Register loads the embedded manifest, validates and registers it, and binds
// the handlers.
func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error {
	if deps.Gateway == nil || deps.Admin == nil {
		return fmt.Errorf("bastion/contract: Gateway and Admin are required")
	}

	m, err := loader.Load(bytes.NewReader(manifestYAML), "bastion/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("bastion/contract: load manifest: %w", err)
	}

	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("bastion/contract: validate manifest: %w", err)
	}

	if err := reg.Register(m); err != nil {
		return fmt.Errorf("bastion/contract: register manifest: %w", err)
	}

	c := ContributorName

	for _, bind := range []struct {
		intent string
		fn     func() error
	}{
		{"overview.stats", func() error { return dispatcher.RegisterQuery(d, c, "overview.stats", 1, overviewStatsHandler(deps)) }},
		{"traffic.stats", func() error { return dispatcher.RegisterQuery(d, c, "traffic.stats", 1, trafficStatsHandler(deps)) }},
		{"circuits.list", func() error { return dispatcher.RegisterQuery(d, c, "circuits.list", 1, circuitsListHandler(deps)) }},
		{"routes.list", func() error { return dispatcher.RegisterQuery(d, c, "routes.list", 1, routesListHandler(deps)) }},
		{"routes.detail", func() error { return dispatcher.RegisterQuery(d, c, "routes.detail", 1, routesDetailHandler(deps)) }},
		{"upstreams.list", func() error { return dispatcher.RegisterQuery(d, c, "upstreams.list", 1, upstreamsListHandler(deps)) }},
		{"services.list", func() error { return dispatcher.RegisterQuery(d, c, "services.list", 1, servicesListHandler(deps)) }},
		{"openapi.summary", func() error { return dispatcher.RegisterQuery(d, c, "openapi.summary", 1, openapiSummaryHandler(deps)) }},
		{"config.detail", func() error { return dispatcher.RegisterQuery(d, c, "config.detail", 1, configDetailHandler(deps)) }},
	} {
		if err := bind.fn(); err != nil {
			return fmt.Errorf("bastion/contract: register %s: %w", bind.intent, err)
		}
	}

	return nil
}
```

`extension/contract/errors.go`:

```go
package contract

import (
	"errors"
	"strings"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/bastion/admin"
)

// mapError turns an admin error into a *contract.Error. Anything unknown is
// CodeInternal with a generic message; its own text never reaches the client.
func mapError(err error) error {
	if err == nil {
		return nil
	}

	var (
		ve *admin.ValidationError
		se *admin.SourceError
		ce *admin.ConflictError
	)

	switch {
	case errors.As(err, &ve):
		return &contract.Error{Code: contract.CodeBadRequest, Message: ve.Message, Details: map[string]any{"field": ve.Field}}
	case errors.Is(err, admin.ErrNotFound):
		return &contract.Error{Code: contract.CodeNotFound, Message: "route not found"}
	case errors.As(err, &se):
		// forge has no FAILED_PRECONDITION. CONFLICT with a reason lets the
		// page tell "not yours to change" from "clashes with another route".
		return &contract.Error{Code: contract.CodeConflict, Message: se.Error(), Details: map[string]any{"reason": "source", "source": string(se.Source)}}
	case errors.As(err, &ce):
		return &contract.Error{Code: contract.CodeConflict, Message: ce.Error(), Details: map[string]any{"reason": "duplicate", "routeId": ce.OtherID}}
	default:
		return &contract.Error{Code: contract.CodeInternal, Message: "an internal error occurred"}
	}
}

// mapError maps like the package-level one and logs the CodeInternal case.
func (d Deps) mapError(intent string, err error) error {
	mapped := mapError(err)
	if d.Logger == nil || mapped == nil {
		return mapped
	}

	var ce *contract.Error
	if errors.As(mapped, &ce) && ce.Code == contract.CodeInternal {
		d.Logger.Error("bastion/contract: internal error answering intent", forge.F("intent", intent), forge.F("error", err))
	}

	return mapped
}

func badRequest(msg string) error {
	return &contract.Error{Code: contract.CodeBadRequest, Message: msg}
}

// requireID trims an id and refuses an empty one.
func requireID(id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", badRequest("id is required")
	}

	return id, nil
}
```

Stub handler files so the package compiles. `handlers_stats.go`:

```go
package contract

import (
	"context"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

type overviewStatsRequest struct{}
type overviewStatsResponse struct{}

func overviewStatsHandler(_ Deps) func(context.Context, overviewStatsRequest, contract.Principal) (overviewStatsResponse, error) {
	return func(context.Context, overviewStatsRequest, contract.Principal) (overviewStatsResponse, error) {
		return overviewStatsResponse{}, nil
	}
}
```

with the same three-line pattern for `trafficStats` and `circuitsList`; `handlers_routes.go` for `routesList`, `routesDetail`, `upstreamsList`; `handlers_platform.go` for `servicesList`, `openapiSummary`, `configDetail`. Each type pair is `<name>Request struct{}` and `<name>Response struct{}`. Tasks 6 to 8 replace every stub.

In `extension/extension.go`:

```go
// RegisterContractContributor implements dashboard.ContractContributorAware.
// It registers the bastion contract contributor, which is what the React
// shell reads.
func (e *Extension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
) error {
	if e.gw == nil || e.admin == nil {
		// Register never ran, or the gateway is disabled: nothing to answer.
		if e.gw != nil {
			e.gw.Logger().Warn("bastion: not initialised; skipping contract contributor registration")
		}

		return nil
	}

	deps := bastioncontract.Deps{Gateway: e.gw, Admin: e.admin, Logger: e.gw.Logger()}
	if err := bastioncontract.Register(disp, reg, wreg, deps); err != nil {
		return fmt.Errorf("bastion: register contract contributor: %w", err)
	}

	return nil
}
```

Imports: `dashcontract "github.com/xraph/forge/extensions/dashboard/contract"`, `"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"`, `bastioncontract "github.com/xraph/bastion/extension/contract"`. Check `e.gw.Logger()` is safe on a gateway that never registered; if it can be nil, guard it.

`extension/dashboard_aware_test.go`:

```go
package extension

import (
	dashboard "github.com/xraph/forge/extensions/dashboard"
)

// The dashboard finds bastion's contract contributor by runtime type
// assertion, so production code need not import forge's dashboard root. This
// keeps the method checked against the real interface anyway.
var _ dashboard.ContractContributorAware = (*Extension)(nil)
```

- [ ] **Step 5: Run to verify they pass**

Run: `go test -race ./extension/... -v 2>&1 | grep -E "^(---|ok|FAIL)"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/contract extension/dashboard_aware_test.go
git commit --only extension/contract extension/dashboard_aware_test.go extension/extension.go -m "feat(contract): register the bastion contract contributor with nine queries"
```

---

### Task 6: Stats intents: overview.stats, traffic.stats, circuits.list

**Files:**
- Modify: `extension/contract/handlers_stats.go`
- Create: `extension/contract/handlers_stats_test.go`

**Interfaces:**
- Consumes: slice 1's `Gateway.Snapshot()`, `Gateway.Circuits()`; Task 2's `Admin.ListRoutes`, `Admin.Targets`.
- Produces, JSON exactly:

```go
type topRoute struct {
	RouteID       string `json:"routeId"`
	Path          string `json:"path"`
	TotalRequests int64  `json:"totalRequests"`
	TotalErrors   int64  `json:"totalErrors"`
}

type overviewStatsResponse struct {
	TotalRequests         int64      `json:"totalRequests"`
	TotalErrors           int64      `json:"totalErrors"`
	ErrorRate             *float64   `json:"errorRate"`    // percent; null before any request
	AvgLatencyMs          *float64   `json:"avgLatencyMs"` // null with no samples
	P99LatencyMs          *float64   `json:"p99LatencyMs"`
	LatencySamples        int        `json:"latencySamples"`
	CacheLookups          int64      `json:"cacheLookups"`
	CacheHitRate          *float64   `json:"cacheHitRate"` // percent; null with no lookups
	RateLimited           int64      `json:"rateLimited"`
	CircuitBreaks         int64      `json:"circuitBreaks"`
	TotalRoutes           int        `json:"totalRoutes"`
	EnabledRoutes         int        `json:"enabledRoutes"`
	HealthyUpstreams      int        `json:"healthyUpstreams"`
	TotalUpstreams        int        `json:"totalUpstreams"`
	OpenCircuits          int        `json:"openCircuits"`
	HalfOpenCircuits      int        `json:"halfOpenCircuits"`
	CircuitBreakerEnabled bool       `json:"circuitBreakerEnabled"`
	DiscoveryEnabled      bool       `json:"discoveryEnabled"`
	StartedAt             *time.Time `json:"startedAt"` // null before Start
	UptimeSeconds         int64      `json:"uptimeSeconds"`
	TopRoutes             []topRoute `json:"topRoutes"` // at most 5, busiest first
}

type routeTraffic struct {
	RouteID        string   `json:"routeId"`
	Path           string   `json:"path"`
	TotalRequests  int64    `json:"totalRequests"`
	TotalErrors    int64    `json:"totalErrors"`
	ErrorRate      *float64 `json:"errorRate"`
	AvgLatencyMs   *float64 `json:"avgLatencyMs"`
	P99LatencyMs   *float64 `json:"p99LatencyMs"`
	LatencySamples int      `json:"latencySamples"`
}

type trafficStatsResponse struct {
	TotalRequests   int64          `json:"totalRequests"`
	TotalErrors     int64          `json:"totalErrors"`
	RateLimited     int64          `json:"rateLimited"`
	CircuitBreaks   int64          `json:"circuitBreaks"`
	CacheHits       int64          `json:"cacheHits"`
	CacheMisses     int64          `json:"cacheMisses"`
	RetriesMeasured bool           `json:"retriesMeasured"` // false: nothing retries
	AvgLatencyMs    *float64       `json:"avgLatencyMs"`
	P99LatencyMs    *float64       `json:"p99LatencyMs"`
	LatencySamples  int            `json:"latencySamples"`
	Routes          []routeTraffic `json:"routes"` // busiest first
	Total           int            `json:"total"`
}

type circuitView struct {
	TargetID        string                `json:"targetId"`
	URL             string                `json:"url"`
	Routes          []admin.UpstreamRoute `json:"routes"`
	Tracked         bool                  `json:"tracked"` // false: never selected, no breaker yet
	State           bastion.CircuitState  `json:"state"`
	FailureCount    int                   `json:"failureCount"`
	LastFailure     *time.Time            `json:"lastFailure"`
	LastStateChange *time.Time            `json:"lastStateChange"`
}

type circuitsListResponse struct {
	Enabled             bool          `json:"enabled"`
	FailureThreshold    int           `json:"failureThreshold"`
	ResetTimeoutSeconds float64       `json:"resetTimeoutSeconds"`
	HalfOpenMax         int           `json:"halfOpenMax"`
	Circuits            []circuitView `json:"circuits"` // by target id
	Total               int           `json:"total"`
}
```

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_stats_test.go`:

```go
package contract

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"

	bastion "github.com/xraph/bastion"
)

func TestOverviewStats_IdleGatewayReportsNullsNotZeros(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	out, err := overviewStatsHandler(deps)(context.Background(), overviewStatsRequest{}, contract.Principal{})
	if err != nil {
		t.Fatal(err)
	}
	if out.ErrorRate != nil || out.AvgLatencyMs != nil || out.P99LatencyMs != nil || out.CacheHitRate != nil || out.StartedAt != nil {
		t.Errorf("idle gateway reported a measured value: %+v", out)
	}
	if out.TopRoutes == nil {
		t.Error("topRoutes must be an empty list, not null")
	}
}

func TestOverviewStats_CountsAndRatesAndLiveCircuitsOnly(t *testing.T) {
	deps, rm, cbm, stats := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "a", Path: "/gw/a", Source: bastion.SourceManual, Enabled: true,
		Targets: []*bastion.Target{{ID: "a/0", URL: "http://a:1", Healthy: true}}})
	addRoute(t, rm, &bastion.Route{ID: "b", Path: "/gw/b", Source: bastion.SourceManual, Enabled: false})
	for i := 0; i < 4; i++ {
		stats.RecordRequest("a", "/gw/a")
		stats.RecordLatency("a", 10*time.Millisecond)
	}
	stats.RecordError("a")

	for i := 0; i < deps.Gateway.Config().CircuitBreaker.FailureThreshold; i++ {
		cbm.Get("a/0").RecordFailure()
		cbm.Get("gone/0").RecordFailure() // a breaker whose target no route has
	}

	out, _ := overviewStatsHandler(deps)(context.Background(), overviewStatsRequest{}, contract.Principal{})
	if out.ErrorRate == nil || *out.ErrorRate != 25 {
		t.Errorf("error rate = %v, want 25", out.ErrorRate)
	}
	if out.AvgLatencyMs == nil || *out.AvgLatencyMs != 10 {
		t.Errorf("avg latency = %v, want 10", out.AvgLatencyMs)
	}
	if out.TotalRoutes != 2 || out.EnabledRoutes != 1 {
		t.Errorf("routes = %d/%d, want 1 of 2 enabled", out.EnabledRoutes, out.TotalRoutes)
	}
	if out.OpenCircuits != 1 {
		t.Errorf("open circuits = %d, want 1 (the orphan breaker must not count)", out.OpenCircuits)
	}
	if len(out.TopRoutes) != 1 || out.TopRoutes[0].RouteID != "a" || out.TopRoutes[0].TotalRequests != 4 {
		t.Errorf("top routes = %+v", out.TopRoutes)
	}
}

func TestTrafficStats_BusiestFirstAndRetriesNotMeasured(t *testing.T) {
	deps, rm, _, stats := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "a", Path: "/gw/a", Source: bastion.SourceManual})
	addRoute(t, rm, &bastion.Route{ID: "b", Path: "/gw/b", Source: bastion.SourceManual})
	stats.RecordRequest("a", "/gw/a")
	for i := 0; i < 3; i++ {
		stats.RecordRequest("b", "/gw/b")
	}

	out, _ := trafficStatsHandler(deps)(context.Background(), trafficStatsRequest{}, contract.Principal{})
	if out.RetriesMeasured {
		t.Error("retries are never executed, so they are not measured")
	}
	if out.Total != 2 || out.Routes[0].RouteID != "b" {
		t.Errorf("routes = %+v, want b first", out.Routes)
	}
	if out.Routes[1].AvgLatencyMs != nil {
		t.Error("a route with no latency samples must report null latency")
	}
}

func TestCircuitsList_EveryLiveTargetWithTracking(t *testing.T) {
	deps, rm, cbm, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "a", Path: "/gw/a", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "a/0", URL: "http://a:1"}, {ID: "a/1", URL: "http://a:2"}}})
	for i := 0; i < deps.Gateway.Config().CircuitBreaker.FailureThreshold; i++ {
		cbm.Get("a/0").RecordFailure()
	}
	cbm.Get("orphan")

	out, _ := circuitsListHandler(deps)(context.Background(), circuitsListRequest{}, contract.Principal{})
	if out.Total != 2 {
		t.Fatalf("circuits = %+v, want the 2 live targets", out.Circuits)
	}
	c0, c1 := out.Circuits[0], out.Circuits[1]
	if !c0.Tracked || c0.State != bastion.CircuitOpen || c0.LastFailure == nil || len(c0.Routes) != 1 {
		t.Errorf("a/0 = %+v", c0)
	}
	if c1.Tracked || c1.State != bastion.CircuitClosed || c1.LastStateChange != nil {
		t.Errorf("a/1 = %+v, want untracked and closed", c1)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./extension/contract/ -run 'Overview|Traffic|Circuits' 2>&1 | head -5`
Expected: FAIL to compile, unknown fields on the stub response types.

- [ ] **Step 3: Implement**

Replace `handlers_stats.go` with the types above plus:

```go
type overviewStatsRequest struct{}
type trafficStatsRequest struct{}
type circuitsListRequest struct{}

// percent is n/d as a percentage, or nil when d is zero: a rate over nothing
// is unknown, not 0%, and a 0 reads as "nothing wrong".
func percent(n, d int64) *float64 {
	if d == 0 {
		return nil
	}

	v := float64(n) / float64(d) * 100

	return &v
}

func ptr[T any](v T) *T { return &v }

func nonZeroTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}

	return &t
}

func topRoutes(s *bastion.GatewayStats, n int) []topRoute {
	out := make([]topRoute, 0, len(s.RouteStats))
	for _, rs := range s.RouteStats {
		if rs.TotalRequests > 0 {
			out = append(out, topRoute{RouteID: rs.RouteID, Path: rs.Path, TotalRequests: rs.TotalRequests, TotalErrors: rs.TotalErrors})
		}
	}

	slices.SortFunc(out, func(a, b topRoute) int {
		if c := cmp.Compare(b.TotalRequests, a.TotalRequests); c != 0 {
			return c
		}

		return strings.Compare(a.Path, b.Path)
	})

	if len(out) > n {
		out = out[:n]
	}

	return out
}

func overviewStatsHandler(deps Deps) func(context.Context, overviewStatsRequest, contract.Principal) (overviewStatsResponse, error) {
	return func(context.Context, overviewStatsRequest, contract.Principal) (overviewStatsResponse, error) {
		s := deps.Gateway.Snapshot()
		cfg := deps.Gateway.Config()

		out := overviewStatsResponse{
			TotalRequests:         s.TotalRequests,
			TotalErrors:           s.TotalErrors,
			ErrorRate:             percent(s.TotalErrors, s.TotalRequests),
			LatencySamples:        s.LatencySamples,
			CacheLookups:          s.CacheHits + s.CacheMisses,
			CacheHitRate:          percent(s.CacheHits, s.CacheHits+s.CacheMisses),
			RateLimited:           s.RateLimited,
			CircuitBreaks:         s.CircuitBreaks,
			HealthyUpstreams:      s.HealthyUpstreams,
			TotalUpstreams:        s.TotalUpstreams,
			CircuitBreakerEnabled: cfg.CircuitBreaker.Enabled,
			DiscoveryEnabled:      cfg.Discovery.Enabled,
			StartedAt:             nonZeroTime(s.StartedAt),
			UptimeSeconds:         s.Uptime,
			TopRoutes:             topRoutes(s, 5),
		}

		if s.LatencySamples > 0 {
			out.AvgLatencyMs = ptr(s.AvgLatencyMs)
			out.P99LatencyMs = ptr(s.P99LatencyMs)
		}

		for _, r := range deps.Admin.ListRoutes(admin.RouteFilter{}) {
			out.TotalRoutes++
			if r.Enabled {
				out.EnabledRoutes++
			}
		}

		live := deps.Admin.Targets()
		for _, c := range deps.Gateway.Circuits() {
			if _, ok := live[c.TargetID]; !ok {
				continue
			}

			switch c.State {
			case bastion.CircuitOpen:
				out.OpenCircuits++
			case bastion.CircuitHalfOpen:
				out.HalfOpenCircuits++
			}
		}

		return out, nil
	}
}

func trafficStatsHandler(deps Deps) func(context.Context, trafficStatsRequest, contract.Principal) (trafficStatsResponse, error) {
	return func(context.Context, trafficStatsRequest, contract.Principal) (trafficStatsResponse, error) {
		s := deps.Gateway.Snapshot()

		out := trafficStatsResponse{
			TotalRequests:  s.TotalRequests,
			TotalErrors:    s.TotalErrors,
			RateLimited:    s.RateLimited,
			CircuitBreaks:  s.CircuitBreaks,
			CacheHits:      s.CacheHits,
			CacheMisses:    s.CacheMisses,
			LatencySamples: s.LatencySamples,
			Routes:         make([]routeTraffic, 0, len(s.RouteStats)),
		}

		if s.LatencySamples > 0 {
			out.AvgLatencyMs = ptr(s.AvgLatencyMs)
			out.P99LatencyMs = ptr(s.P99LatencyMs)
		}

		for _, rs := range s.RouteStats {
			rt := routeTraffic{
				RouteID:        rs.RouteID,
				Path:           rs.Path,
				TotalRequests:  rs.TotalRequests,
				TotalErrors:    rs.TotalErrors,
				ErrorRate:      percent(rs.TotalErrors, rs.TotalRequests),
				LatencySamples: rs.LatencySamples,
			}
			if rs.LatencySamples > 0 {
				rt.AvgLatencyMs = ptr(rs.AvgLatencyMs)
				rt.P99LatencyMs = ptr(rs.P99LatencyMs)
			}

			out.Routes = append(out.Routes, rt)
		}

		slices.SortFunc(out.Routes, func(a, b routeTraffic) int {
			if c := cmp.Compare(b.TotalRequests, a.TotalRequests); c != 0 {
				return c
			}

			return strings.Compare(a.Path, b.Path)
		})

		out.Total = len(out.Routes)

		return out, nil
	}
}

func circuitsListHandler(deps Deps) func(context.Context, circuitsListRequest, contract.Principal) (circuitsListResponse, error) {
	return func(context.Context, circuitsListRequest, contract.Principal) (circuitsListResponse, error) {
		cfg := deps.Gateway.Config().CircuitBreaker
		live := deps.Admin.Targets()

		snaps := map[string]bastion.CircuitBreakerSnapshot{}
		for _, c := range deps.Gateway.Circuits() {
			snaps[c.TargetID] = c
		}

		out := circuitsListResponse{
			Enabled:             cfg.Enabled,
			FailureThreshold:    cfg.FailureThreshold,
			ResetTimeoutSeconds: cfg.ResetTimeout.Seconds(),
			HalfOpenMax:         cfg.HalfOpenMax,
			Circuits:            make([]circuitView, 0, len(live)),
		}

		for id, ref := range live {
			v := circuitView{TargetID: id, URL: ref.URL, Routes: ref.Routes, State: bastion.CircuitClosed}
			if s, ok := snaps[id]; ok {
				v.Tracked = true
				v.State = s.State
				v.FailureCount = s.FailureCount
				v.LastFailure = nonZeroTime(s.LastFailure)
				v.LastStateChange = nonZeroTime(s.LastStateChange)
			}

			out.Circuits = append(out.Circuits, v)
		}

		slices.SortFunc(out.Circuits, func(a, b circuitView) int { return strings.Compare(a.TargetID, b.TargetID) })
		out.Total = len(out.Circuits)

		return out, nil
	}
}
```

Imports: `cmp`, `context`, `slices`, `strings`, `time`, `contract`, `bastion`, `admin`.

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./extension/contract/ -run 'Overview|Traffic|Circuits' -v 2>&1 | grep -E "^(---|ok|FAIL)"`
Expected: PASS. If `CircuitBreaker.FailureThreshold` defaults to 0 in `bastion.New`, set it in `newTestDeps` via an option (grep `func WithCircuitBreaker` in `config.go`) rather than hardcoding a count.

- [ ] **Step 5: Commit**

```bash
git commit --only extension/contract/handlers_stats.go extension/contract/handlers_stats_test.go -m "feat(contract): overview, traffic and circuit queries"
```

---

### Task 7: Route intents: routes.list, routes.detail, upstreams.list

**Files:**
- Modify: `extension/contract/handlers_routes.go`
- Create: `extension/contract/handlers_routes_test.go`

**Interfaces:**
- Consumes: Task 2.
- Produces:

```go
type routesListRequest struct {
	Source   string `json:"source,omitempty"`
	Protocol string `json:"protocol,omitempty"`
}
type routesListResponse struct {
	Routes []admin.RouteSummary `json:"routes"`
	Total  int                  `json:"total"`
}
type routesDetailRequest struct {
	ID string `json:"id"`
}
type routesDetailResponse = admin.RouteDetail
type upstreamsListRequest struct{}
type upstreamsListResponse struct {
	Upstreams []admin.Upstream `json:"upstreams"`
	Total     int              `json:"total"`
}
```

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_routes_test.go`:

```go
package contract

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/forge/extensions/dashboard/contract"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/admin"
)

func TestRoutesList_Filter(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual, Protocol: bastion.ProtocolHTTP})
	addRoute(t, rm, &bastion.Route{ID: "farp-x", Path: "/x", Source: bastion.SourceFARP, Protocol: bastion.ProtocolGRPC})

	out, _ := routesListHandler(deps)(context.Background(), routesListRequest{Protocol: "grpc"}, contract.Principal{})
	if out.Total != 1 || out.Routes[0].ID != "farp-x" {
		t.Errorf("out = %+v", out)
	}
}

func TestRoutesDetail_ConfigRouteIDWithSlash(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual, Priority: 100,
		Headers: bastion.HeaderPolicy{Set: map[string]string{"Authorization": "Bearer x"}}})

	out, err := routesDetailHandler(deps)(context.Background(), routesDetailRequest{ID: " manual-/users "}, contract.Principal{})
	if err != nil {
		t.Fatal(err)
	}
	if out.ID != "manual-/users" || out.Input == nil || out.Input.Path != "/users" {
		t.Errorf("detail = %+v", out)
	}
	if out.Headers.Set["Authorization"] != admin.Redacted {
		t.Errorf("header leaked: %+v", out.Headers)
	}
}

func TestRoutesDetail_Errors(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	h := routesDetailHandler(deps)

	var ce *contract.Error
	if _, err := h(context.Background(), routesDetailRequest{}, contract.Principal{}); !errors.As(err, &ce) || ce.Code != contract.CodeBadRequest {
		t.Errorf("empty id err = %v, want BAD_REQUEST", err)
	}
	if _, err := h(context.Background(), routesDetailRequest{ID: "nope"}, contract.Principal{}); !errors.As(err, &ce) || ce.Code != contract.CodeNotFound {
		t.Errorf("unknown id err = %v, want NOT_FOUND", err)
	}
}

func TestUpstreamsList(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "a", Path: "/gw/a", Source: bastion.SourceManual,
		Targets: []*bastion.Target{{ID: "a/0", URL: "http://a:1", Healthy: true}}})

	out, _ := upstreamsListHandler(deps)(context.Background(), upstreamsListRequest{}, contract.Principal{})
	if out.Total != 1 || out.Upstreams[0].URL != "http://a:1" {
		t.Errorf("out = %+v", out)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./extension/contract/ -run 'Routes|Upstreams' 2>&1 | head -5`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Replace `handlers_routes.go` with the types above and:

```go
func routesListHandler(deps Deps) func(context.Context, routesListRequest, contract.Principal) (routesListResponse, error) {
	return func(_ context.Context, in routesListRequest, _ contract.Principal) (routesListResponse, error) {
		routes := deps.Admin.ListRoutes(admin.RouteFilter{Source: in.Source, Protocol: in.Protocol})

		return routesListResponse{Routes: routes, Total: len(routes)}, nil
	}
}

// routesDetailHandler takes the id in the body: config route ids contain a
// slash ("manual-/users") and cannot sit in a URL segment.
func routesDetailHandler(deps Deps) func(context.Context, routesDetailRequest, contract.Principal) (routesDetailResponse, error) {
	return func(_ context.Context, in routesDetailRequest, _ contract.Principal) (routesDetailResponse, error) {
		id, err := requireID(in.ID)
		if err != nil {
			return routesDetailResponse{}, err
		}

		d, err := deps.Admin.GetRoute(id)
		if err != nil {
			return routesDetailResponse{}, deps.mapError("routes.detail", err)
		}

		return d, nil
	}
}

func upstreamsListHandler(deps Deps) func(context.Context, upstreamsListRequest, contract.Principal) (upstreamsListResponse, error) {
	return func(context.Context, upstreamsListRequest, contract.Principal) (upstreamsListResponse, error) {
		ups := deps.Admin.Upstreams()

		return upstreamsListResponse{Upstreams: ups, Total: len(ups)}, nil
	}
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./extension/contract/ -run 'Routes|Upstreams' -v 2>&1 | grep -E "^(---|ok|FAIL)"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only extension/contract/handlers_routes.go extension/contract/handlers_routes_test.go -m "feat(contract): route and upstream queries"
```

---

### Task 8: Platform intents, a transport test, and the spec update

**Files:**
- Modify: `extension/contract/handlers_platform.go`
- Create: `extension/contract/handlers_platform_test.go`, `extension/contract/transport_test.go`
- Modify: `forge-dashboard/docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md`

**Interfaces:**
- Consumes: `Gateway.Discovery()`, `Gateway.OpenAPI()`, `Gateway.Config()`.
- Produces:

```go
type serviceView struct {
	Name         string    `json:"name"`
	Version      string    `json:"version"`
	Address      string    `json:"address"`
	Port         int       `json:"port"`
	Protocols    []string  `json:"protocols"`
	Healthy      bool      `json:"healthy"`
	RouteCount   int       `json:"routeCount"`
	DiscoveredAt time.Time `json:"discoveredAt"`
	MetadataKeys []string  `json:"metadataKeys"`
}
type servicesListResponse struct {
	DiscoveryEnabled bool          `json:"discoveryEnabled"`
	Services         []serviceView `json:"services"` // by name
	Total            int           `json:"total"`
}

type specView struct {
	ServiceName string     `json:"serviceName"`
	Version     string     `json:"version"`
	SpecURL     string     `json:"specUrl"`
	Healthy     bool       `json:"healthy"`
	PathCount   int        `json:"pathCount"`
	Error       string     `json:"error,omitempty"`
	FetchedAt   *time.Time `json:"fetchedAt"`
}
type openapiSummaryResponse struct {
	Enabled     bool       `json:"enabled"` // configured
	Running     bool       `json:"running"` // aggregator started
	SpecPath    string     `json:"specPath"`
	LastRefresh *time.Time `json:"lastRefresh"`
	TotalPaths  int        `json:"totalPaths"`
	Services    []specView `json:"services"`
	Total       int        `json:"total"`
}

type configSetting struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}
type configSection struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	Enabled  *bool           `json:"enabled"` // null: the section has no switch
	Note     string          `json:"note,omitempty"`
	Settings []configSetting `json:"settings"`
}
type configDetailResponse struct {
	Sections []configSection `json:"sections"`
}
func configSections(cfg bastion.Config) []configSection
```

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_platform_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/xraph/forge/extensions/dashboard/contract"

	bastion "github.com/xraph/bastion"
)

func TestServicesList_NoDiscoveryIsEmptyAndSaysSo(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	out, err := servicesListHandler(deps)(context.Background(), servicesListRequest{}, contract.Principal{})
	if err != nil {
		t.Fatal(err)
	}
	if out.Services == nil || out.Total != 0 {
		t.Errorf("out = %+v, want an empty list", out)
	}
	if out.DiscoveryEnabled != deps.Gateway.Config().Discovery.Enabled {
		t.Error("discoveryEnabled must come from config")
	}
}

func TestOpenAPISummary_NotRunning(t *testing.T) {
	deps, _, _, _ := newTestDeps(t)
	out, _ := openapiSummaryHandler(deps)(context.Background(), openapiSummaryRequest{}, contract.Principal{})
	if out.Running || out.Services == nil || out.LastRefresh != nil {
		t.Errorf("out = %+v, want not running with an empty list", out)
	}
}

func TestConfigSections_NeverLeakTLSPathsOrIPs(t *testing.T) {
	var cfg bastion.Config
	cfg.TLS.Enabled = true
	cfg.TLS.ClientKeyFile = "/etc/bastion/secret/client.key"
	cfg.TLS.CACertFile = "/etc/bastion/ca.pem"
	cfg.IPFilter.Enabled = true
	cfg.IPFilter.AllowIPs = []string{"10.0.0.1", "10.0.0.2"}

	raw, _ := json.Marshal(configSections(cfg))
	body := string(raw)
	for _, leaked := range []string{"client.key", "ca.pem", "10.0.0.1"} {
		if strings.Contains(body, leaked) {
			t.Errorf("config detail leaked %q", leaked)
		}
	}
	if !strings.Contains(body, `"2 addresses"`) {
		t.Errorf("allow list count missing: %s", body)
	}
}

func TestConfigSections_RetryAndCacheSayTheyDoNothing(t *testing.T) {
	var cfg bastion.Config
	cfg.Retry.Enabled = true
	cfg.Caching.Enabled = true

	notes := map[string]string{}
	for _, s := range configSections(cfg) {
		notes[s.ID] = s.Note
	}
	if notes["retry"] == "" || notes["caching"] == "" {
		t.Errorf("retry and caching must carry a note: %+v", notes)
	}
}
```

`extension/contract/transport_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/transport"

	bastion "github.com/xraph/bastion"
)

// TestQueriesOverTheWire posts real envelopes through forge's transport, so
// the JSON field names and the id-in-params path are what a browser sees.
func TestQueriesOverTheWire(t *testing.T) {
	deps, rm, _, _ := newTestDeps(t)
	addRoute(t, rm, &bastion.Route{ID: "manual-/users", Path: "/gw/users", Source: bastion.SourceManual, Priority: 100})

	reg := dashcontract.NewRegistry()
	wreg := dashcontract.NewWardenRegistry()
	d := dispatcher.New(nil)
	if err := Register(d, reg, wreg, deps); err != nil {
		t.Fatal(err)
	}
	h := transport.NewHandler(reg, wreg, d, nil)

	post := func(intent, params string) map[string]any {
		body := `{"envelope":"v1","kind":"query","contributor":"bastion","intent":"` + intent + `","params":` + params + `}`
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/dashboard/v1", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		var resp struct {
			OK   bool           `json:"ok"`
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || !resp.OK {
			t.Fatalf("%s: %s", intent, rec.Body)
		}
		return resp.Data
	}

	detail := post("routes.detail", `{"id":"manual-/users"}`)
	input, _ := detail["input"].(map[string]any)
	if detail["id"] != "manual-/users" || input["path"] != "/users" || input["priority"] != float64(0) {
		t.Errorf("routes.detail = %v", detail)
	}

	overview := post("overview.stats", `{}`)
	if _, ok := overview["errorRate"]; !ok || overview["errorRate"] != nil {
		t.Errorf("overview.errorRate must be present and null on an idle gateway: %v", overview)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./extension/contract/ -run 'Services|OpenAPI|ConfigSections|OverTheWire' 2>&1 | head -5`
Expected: FAIL to compile (unknown fields, undefined `configSections`).

- [ ] **Step 3: Implement**

Replace `handlers_platform.go` with the types above and:

```go
type servicesListRequest struct{}
type openapiSummaryRequest struct{}
type configDetailRequest struct{}

func servicesListHandler(deps Deps) func(context.Context, servicesListRequest, contract.Principal) (servicesListResponse, error) {
	return func(context.Context, servicesListRequest, contract.Principal) (servicesListResponse, error) {
		out := servicesListResponse{
			DiscoveryEnabled: deps.Gateway.Config().Discovery.Enabled,
			Services:         []serviceView{},
		}

		if disc := deps.Gateway.Discovery(); disc != nil {
			for _, s := range disc.DiscoveredServices() {
				// Copied field by field: discovery mutates these pointers later.
				out.Services = append(out.Services, serviceView{
					Name: s.Name, Version: s.Version, Address: s.Address, Port: s.Port,
					Protocols: slices.Clone(s.Protocols), Healthy: s.Healthy, RouteCount: s.RouteCount,
					DiscoveredAt: s.DiscoveredAt, MetadataKeys: sortedKeys(s.Metadata),
				})
			}
		}

		slices.SortFunc(out.Services, func(a, b serviceView) int { return strings.Compare(a.Name, b.Name) })
		out.Total = len(out.Services)

		return out, nil
	}
}

func openapiSummaryHandler(deps Deps) func(context.Context, openapiSummaryRequest, contract.Principal) (openapiSummaryResponse, error) {
	return func(context.Context, openapiSummaryRequest, contract.Principal) (openapiSummaryResponse, error) {
		cfg := deps.Gateway.Config()
		out := openapiSummaryResponse{Enabled: cfg.OpenAPI.Enabled, Services: []specView{}}

		oa := deps.Gateway.OpenAPI()
		if oa == nil {
			return out, nil
		}

		out.Running = true
		out.SpecPath = cfg.Dashboard.BasePath + oa.SpecPath()
		out.LastRefresh = nonZeroTime(oa.LastRefresh())

		if paths, ok := oa.MergedSpecMap()["paths"].(map[string]any); ok {
			out.TotalPaths = len(paths)
		}

		for _, s := range oa.ServiceSpecs() {
			out.Services = append(out.Services, specView{
				ServiceName: s.ServiceName, Version: s.Version, SpecURL: s.SpecURL, Healthy: s.Healthy,
				PathCount: s.PathCount, Error: s.Error, FetchedAt: nonZeroTime(s.FetchedAt),
			})
		}

		slices.SortFunc(out.Services, func(a, b specView) int { return strings.Compare(a.ServiceName, b.ServiceName) })
		out.Total = len(out.Services)

		return out, nil
	}
}

func configDetailHandler(deps Deps) func(context.Context, configDetailRequest, contract.Principal) (configDetailResponse, error) {
	return func(context.Context, configDetailRequest, contract.Principal) (configDetailResponse, error) {
		return configDetailResponse{Sections: configSections(deps.Gateway.Config())}, nil
	}
}

func boolPtr(b bool) *bool { return &b }

func setting(k string, v any) configSetting { return configSetting{Key: k, Value: fmt.Sprint(v)} }

// isSet reports a file path's presence without the path: a key's location is
// a map for anyone who reads the page.
func isSet(path string) string {
	if path == "" {
		return "not set"
	}

	return "set"
}

func count(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}

	return fmt.Sprintf("%d %ses", n, noun)
}

func list(v []string) string {
	if len(v) == 0 {
		return "none"
	}

	return strings.Join(v, ", ")
}

// configSections renders the gateway config for reading. Nothing that
// locates a secret leaves: TLS paths show as set or not set, IP lists as
// counts.
func configSections(cfg bastion.Config) []configSection {
	hc := cfg.HealthCheck

	return []configSection{
		{ID: "gateway", Title: "Gateway", Enabled: boolPtr(cfg.Enabled), Settings: []configSetting{
			setting("Base path", cfg.BasePath), setting("Routes in config", len(cfg.Routes)),
		}},
		{ID: "timeouts", Title: "Timeouts", Settings: []configSetting{
			setting("Connect", cfg.Timeouts.Connect), setting("Read", cfg.Timeouts.Read),
			setting("Write", cfg.Timeouts.Write), setting("Idle", cfg.Timeouts.Idle),
		}},
		{ID: "loadBalancing", Title: "Load balancing", Settings: []configSetting{
			setting("Strategy", cfg.LoadBalancing.Strategy), setting("Consistent hash key", cfg.LoadBalancing.ConsistentKey),
		}},
		{ID: "circuitBreaker", Title: "Circuit breaker", Enabled: boolPtr(cfg.CircuitBreaker.Enabled), Settings: []configSetting{
			setting("Failure threshold", cfg.CircuitBreaker.FailureThreshold), setting("Failure window", cfg.CircuitBreaker.FailureWindow),
			setting("Reset timeout", cfg.CircuitBreaker.ResetTimeout), setting("Half-open probes", cfg.CircuitBreaker.HalfOpenMax),
		}},
		{ID: "retry", Title: "Retry", Enabled: boolPtr(cfg.Retry.Enabled),
			Note: "Nothing in the proxy calls the retry policy, so no request is retried whatever this says.",
			Settings: []configSetting{
				setting("Max attempts", cfg.Retry.MaxAttempts), setting("Backoff", cfg.Retry.Backoff),
				setting("Initial delay", cfg.Retry.InitialDelay), setting("Max delay", cfg.Retry.MaxDelay),
			}},
		{ID: "rateLimiting", Title: "Rate limiting", Enabled: boolPtr(cfg.RateLimiting.Enabled), Settings: []configSetting{
			setting("Requests per second", cfg.RateLimiting.RequestsPerSec), setting("Burst", cfg.RateLimiting.Burst),
			setting("Per client", cfg.RateLimiting.PerClient),
		}},
		{ID: "healthCheck", Title: "Health checks", Enabled: boolPtr(hc.Enabled), Settings: []configSetting{
			setting("Interval", hc.Interval), setting("Timeout", hc.Timeout), setting("Path", hc.Path),
			setting("Failure threshold", hc.FailureThreshold), setting("Success threshold", hc.SuccessThreshold),
			setting("Passive checks", hc.EnablePassive),
		}},
		{ID: "caching", Title: "Response cache", Enabled: boolPtr(cfg.Caching.Enabled),
			Note: "Nothing writes to the cache, so every lookup misses whatever this says.",
			Settings: []configSetting{
				setting("Default TTL", cfg.Caching.DefaultTTL), setting("Max size", cfg.Caching.MaxSize),
				setting("Methods", list(cfg.Caching.Methods)),
			}},
		{ID: "auth", Title: "Authentication", Enabled: boolPtr(cfg.Auth.Enabled), Settings: []configSetting{
			setting("Default policy", cfg.Auth.DefaultPolicy), setting("Providers", list(cfg.Auth.Providers)),
			setting("Forward headers", cfg.Auth.ForwardHeaders),
		}},
		{ID: "tls", Title: "Upstream TLS", Enabled: boolPtr(cfg.TLS.Enabled), Settings: []configSetting{
			setting("CA certificate", isSet(cfg.TLS.CACertFile)), setting("Client certificate", isSet(cfg.TLS.ClientCertFile)),
			setting("Client key", isSet(cfg.TLS.ClientKeyFile)), setting("Skip verification", cfg.TLS.InsecureSkipVerify),
			setting("Minimum version", cfg.TLS.MinVersion),
		}},
		{ID: "ipFilter", Title: "IP filter", Enabled: boolPtr(cfg.IPFilter.Enabled), Settings: []configSetting{
			setting("Allow list", count(len(cfg.IPFilter.AllowIPs), "address")),
			setting("Deny list", count(len(cfg.IPFilter.DenyIPs), "address")),
		}},
		{ID: "cors", Title: "CORS", Enabled: boolPtr(cfg.CORS.Enabled), Settings: []configSetting{
			setting("Allowed origins", list(cfg.CORS.AllowOrigins)), setting("Credentials", cfg.CORS.AllowCreds),
			setting("Max age", cfg.CORS.MaxAge),
		}},
		{ID: "discovery", Title: "Discovery", Enabled: boolPtr(cfg.Discovery.Enabled), Settings: []configSetting{
			setting("Poll interval", cfg.Discovery.PollInterval), setting("Watch mode", cfg.Discovery.WatchMode),
			setting("Auto prefix", cfg.Discovery.AutoPrefix),
		}},
		{ID: "openapi", Title: "OpenAPI aggregation", Enabled: boolPtr(cfg.OpenAPI.Enabled), Settings: []configSetting{
			setting("Spec path", cfg.OpenAPI.Path), setting("UI path", cfg.OpenAPI.UIPath),
		}},
		{ID: "metrics", Title: "Metrics", Enabled: boolPtr(cfg.Metrics.Enabled), Settings: []configSetting{
			setting("Prefix", cfg.Metrics.Prefix),
		}},
		{ID: "accessLog", Title: "Access log", Enabled: boolPtr(cfg.AccessLog.Enabled), Settings: []configSetting{
			setting("Include body", cfg.AccessLog.IncludeBody),
		}},
	}
}
```

`count` produces `2 addresses`, `1 address`, `0 addresses`. `sortedKeys` is not exported from `admin`: add a local copy in this file:

```go
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	slices.Sort(keys)

	return keys
}
```

Imports: `context`, `fmt`, `slices`, `strings`, `time`, `contract`, `bastion`.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `go test -race ./extension/contract/ -v 2>&1 | grep -E "^(---|ok|FAIL)"` then `go build ./... && go test -race ./...` and lint.
Expected: PASS, 0 lint issues in touched files.

- [ ] **Step 5: Commit (bastion)**

```bash
git add extension/contract/handlers_platform_test.go extension/contract/transport_test.go
git commit --only extension/contract/handlers_platform.go extension/contract/handlers_platform_test.go extension/contract/transport_test.go -m "feat(contract): services, OpenAPI and redacted config queries"
```

- [ ] **Step 6: Update the spec (forge-dashboard)**

In the spec's "Refusals" list under "The intents", replace every `FAILED_PRECONDITION` with `CONFLICT` and append to the list:

```
- forge has no FAILED_PRECONDITION code. Source refusals answer CONFLICT
  with `details.reason: "source"` and the route's source; duplicates answer
  CONFLICT with `details.reason: "duplicate"` and the other route's id.
```

Under "Slice 2: the admin service and the contract", replace the sentence "The REST responses keep their shapes, except that priority and path stop drifting, which is a fix." with:

```
The REST responses keep their shapes. REST GET still returns effective
priority and path while PUT takes entered ones, so a REST client that
writes back what it read still drifts; the contract carries both values
(`priority` and `input.priority`) and the dashboard never drifts. The REST
drift goes in `MIGRATION.md`.
```

Change the `openapi.summary` row's "`null` when OpenAPI is disabled" to "`enabled` and `running` flags, with empty lists when either is false". Change `circuits.list` to "every live target, with `tracked: false` for targets that have no breaker yet". Grep the file for `—` and expect 0.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git commit --only docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md -m "docs(bastion): record slice 2's contract decisions"
```

---

### Task 9: Move usePoll into the plugin package

**Files (forge-dashboard):**
- Create: `packages/plugin/src/poll.ts` (moved from `packages/plugin-streaming/src/use-poll.ts`)
- Create: `packages/plugin/test/use-poll.test.tsx` (moved from `packages/plugin-streaming/test/use-poll.test.tsx`)
- Modify: `packages/plugin/src/index.ts`
- Modify: `packages/plugin-streaming/src/pages/{connections,presence,overview}.tsx`
- Delete: `packages/plugin-streaming/src/use-poll.ts`, `packages/plugin-streaming/test/use-poll.test.tsx`

**Interfaces:**
- Produces: `usePoll(refetch: () => void, intervalMs?: number): void` exported from `@forge-go/dashboard-plugin`.

This is a move. The existing test is the gate: it must pass in its new home, and streaming's tests must stay green.

- [ ] **Step 1: Move the files**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git mv packages/plugin-streaming/src/use-poll.ts packages/plugin/src/poll.ts
git mv packages/plugin-streaming/test/use-poll.test.tsx packages/plugin/test/use-poll.test.tsx
sed -i '' 's#from "../src/use-poll"#from "../src/poll"#' packages/plugin/test/use-poll.test.tsx
echo 'export * from "./poll"' >> packages/plugin/src/index.ts
for f in connections presence overview; do
  sed -i '' 's#import { usePoll } from "../use-poll"#import { usePoll } from "@forge-go/dashboard-plugin"#' packages/plugin-streaming/src/pages/$f.tsx
done
grep -rn "use-poll" packages/plugin-streaming/src packages/plugin/src packages/plugin/test
```

Expected: the last grep prints nothing. If a streaming page already imports from `@forge-go/dashboard-plugin`, merge `usePoll` into that import line so eslint does not flag a duplicate import.

In `poll.ts`, replace the doc comment's first paragraph after the summary line ("Streaming counts move continuously...") with a sentence that is not streaming-specific: `Live counts move continuously, so a stale one is worse than none.` Keep the rest.

- [ ] **Step 2: Gate**

Run: `pnpm --filter @forge-go/dashboard-plugin test && pnpm --filter @forge-go/dashboard-plugin typecheck && pnpm --filter @forge-go/dashboard-plugin lint && pnpm --filter @forge-go/dashboard-plugin-streaming test && pnpm --filter @forge-go/dashboard-plugin-streaming typecheck && pnpm --filter @forge-go/dashboard-plugin-streaming lint`
Expected: all green; the use-poll test runs under `packages/plugin`.

- [ ] **Step 3: Commit**

```bash
git commit --only packages/plugin/src/poll.ts packages/plugin/src/index.ts packages/plugin/test/use-poll.test.tsx packages/plugin-streaming/src/use-poll.ts packages/plugin-streaming/test/use-poll.test.tsx packages/plugin-streaming/src/pages/connections.tsx packages/plugin-streaming/src/pages/presence.tsx packages/plugin-streaming/src/pages/overview.tsx -m "refactor(plugin): move usePoll into the plugin package for its second user"
```

---

### Task 10: Fixtures for the nine queries

**Files (forge-dashboard):**
- Create: `packages/fixture-server/bastion-fixtures.mjs`
- Modify: `packages/fixture-server/server.mjs` (import, header inventory line, `CONTRIBUTORS`, `handleReset`)
- Modify: `packages/fixture-server/verify.mjs` (INPUT entries and a spot-check block)

**Interfaces:**
- Produces: `createBastionHandlers(FixtureError)` returning the handler table `{ [intent]: { kind: "query", handler(params) } }`, and `resetBastion()`.
- Field names are exactly the Go JSON tags from Tasks 2, 6, 7 and 8.

The fixture models the contract, not a live gateway: counters advance on every `overview.stats` and `traffic.stats` read, so a polling page visibly changes. Seed:

| id | path | source | notes |
|---|---|---|---|
| `9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36` | `/gw/orders` | manual (API) | 2 targets, one open circuit; `X-Api-Key` in transform request headers |
| `manual-/users` | `/gw/users` | manual (config) | 1 target, half-open circuit |
| `farp-billing-http` | `/billing/*` | farp | service `billing`, 1 unhealthy target |
| `discovery-search` | `/search/*` | discovery | disabled, grpc |

- [ ] **Step 1: Write the fixture module**

`packages/fixture-server/bastion-fixtures.mjs`:

```js
// bastion-fixtures.mjs: in-memory state and intent handlers for the bastion
// contributor (packages/plugin-bastion). Mirrors
// forgery/bastion/extension/contract; field names are the Go JSON tags.
//
// Self-contained: it imports nothing from server.mjs. server.mjs hands over
// its FixtureError class so refusals keep their status and code.
//
// Deliberate differences from a live gateway: counters advance on every
// overview.stats and traffic.stats read, so a polling page visibly moves.

const ORDERS = "9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36"
const STARTED_AT = "2026-09-30T08:00:00Z"

function seed() {
  const t = (id, url, healthy, circuitState, stats, extra = {}) => ({
    id, url, weight: 1, tags: [], healthy, circuitState,
    stats: { activeConns: 0, avgLatencyMs: 0, ...stats },
    tls: false, metadataKeys: [], ...extra,
  })
  const route = (r) => ({
    methods: [], protocol: "http", serviceName: "", enabled: true, config: false,
    stripPrefix: false, addPrefix: "", rewritePath: "",
    headers: {}, metadataKeys: [], version: 1,
    createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-30T07:30:00Z",
    ...r,
  })
  return {
    tick: 0,
    routes: [
      route({
        id: ORDERS, path: "/gw/orders", methods: ["GET", "POST"], source: "manual", priority: 105,
        editable: true, input: { path: "/orders", priority: 5 }, stripPrefix: true,
        transform: { requestHeaders: { set: { "X-Api-Key": "[redacted]", "X-Env": "prod" } }, responseHeaders: {} },
        retry: { enabled: true, maxAttempts: 3 },
        targets: [
          t(`${ORDERS}/0`, "http://orders-a:8080", true, "closed", { totalRequests: 1840, totalErrors: 12, avgLatencyMs: 42.5 }, { healthCheckPath: "/healthz", metadataKeys: ["health_check_path"] }),
          t(`${ORDERS}/1`, "http://orders-b:8080", true, "open", { totalRequests: 310, totalErrors: 44, avgLatencyMs: 180.2 }),
        ],
      }),
      route({
        id: "manual-/users", path: "/gw/users", source: "manual", priority: 110, editable: true, config: true,
        input: { path: "/users", priority: 10 },
        targets: [t("target-/users-http://users:8080", "http://users:8080", true, "half_open", { totalRequests: 920, totalErrors: 3, avgLatencyMs: 18.1 })],
      }),
      route({
        id: "farp-billing-http", path: "/billing/*", source: "farp", serviceName: "billing", priority: 0, editable: false,
        targets: [t("farp-billing-0", "http://billing:9000", false, "closed", { totalRequests: 55, totalErrors: 55, avgLatencyMs: 0 })],
      }),
      route({
        id: "discovery-search", path: "/search/*", source: "discovery", serviceName: "search", protocol: "grpc",
        priority: 0, editable: false, enabled: false,
        targets: [t("discovery-search-0", "http://search:50051", true, "closed", { totalRequests: 0, totalErrors: 0 })],
      }),
    ],
  }
}

let bastion = seed()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetBastion() {
  bastion = seed()
}

const pct = (n, d) => (d === 0 ? null : (n / d) * 100)

function summary(r) {
  return {
    id: r.id, path: r.path, methods: r.methods, protocol: r.protocol, source: r.source,
    serviceName: r.serviceName, priority: r.priority, enabled: r.enabled,
    targetCount: r.targets.length, healthyTargets: r.targets.filter((t) => t.healthy).length,
    editable: r.editable, config: r.config, updatedAt: r.updatedAt,
  }
}

function routeTotals(r) {
  return r.targets.reduce(
    (a, t) => ({ req: a.req + t.stats.totalRequests, err: a.err + t.stats.totalErrors }),
    { req: 0, err: 0 },
  )
}

/** Moves every answered route forward a little, so polling shows movement. */
function advance() {
  bastion.tick += 1
  for (const r of bastion.routes) {
    if (!r.enabled) continue
    for (const t of r.targets) {
      if (t.circuitState === "open" || !t.healthy) continue
      t.stats.totalRequests += 3
      if (bastion.tick % 5 === 0) t.stats.totalErrors += 1
    }
  }
}

function upstreams() {
  const byUrl = new Map()
  const rank = { closed: 0, half_open: 1, open: 2 }
  for (const r of bastion.routes) {
    for (const t of r.targets) {
      const u = byUrl.get(t.url) ?? {
        url: t.url, healthy: true, circuitState: "closed", activeConns: 0,
        totalRequests: 0, totalErrors: 0, avgLatencyMs: 0, routes: [], _w: 0,
      }
      u.healthy = u.healthy && t.healthy
      if (rank[t.circuitState] > rank[u.circuitState]) u.circuitState = t.circuitState
      u.totalRequests += t.stats.totalRequests
      u.totalErrors += t.stats.totalErrors
      u._w += t.stats.avgLatencyMs * t.stats.totalRequests
      u.routes.push({ routeId: r.id, path: r.path, targetId: t.id })
      byUrl.set(t.url, u)
    }
  }
  return [...byUrl.values()]
    .map(({ _w, ...u }) => ({ ...u, avgLatencyMs: u.totalRequests ? _w / u.totalRequests : 0 }))
    .sort((a, b) => a.url.localeCompare(b.url))
}

/**
 * @param {new (status: number, code: string, message: string, details?: unknown) => Error} FixtureError
 */
export function createBastionHandlers(FixtureError) {
  return {
    "overview.stats": {
      kind: "query",
      handler: () => {
        advance()
        const totals = bastion.routes.map(routeTotals).reduce((a, b) => ({ req: a.req + b.req, err: a.err + b.err }), { req: 0, err: 0 })
        const ups = upstreams()
        const targets = bastion.routes.flatMap((r) => r.targets)
        const top = bastion.routes
          .map((r) => ({ routeId: r.id, path: r.path, totalRequests: routeTotals(r).req, totalErrors: routeTotals(r).err }))
          .filter((r) => r.totalRequests > 0)
          .sort((a, b) => b.totalRequests - a.totalRequests)
          .slice(0, 5)
        return {
          totalRequests: totals.req, totalErrors: totals.err, errorRate: pct(totals.err, totals.req),
          avgLatencyMs: 48.3, p99LatencyMs: 212.0, latencySamples: 4096,
          // The cache never stores, so a real gateway with caching on shows lookups and no hits.
          cacheLookups: 0, cacheHitRate: null,
          rateLimited: 14, circuitBreaks: 37,
          totalRoutes: bastion.routes.length, enabledRoutes: bastion.routes.filter((r) => r.enabled).length,
          healthyUpstreams: ups.filter((u) => u.healthy).length, totalUpstreams: ups.length,
          openCircuits: targets.filter((t) => t.circuitState === "open").length,
          halfOpenCircuits: targets.filter((t) => t.circuitState === "half_open").length,
          circuitBreakerEnabled: true, discoveryEnabled: true,
          startedAt: STARTED_AT, uptimeSeconds: 7200 + bastion.tick * 10,
          topRoutes: top,
        }
      },
    },
    "traffic.stats": {
      kind: "query",
      handler: () => {
        advance()
        const routes = bastion.routes
          .map((r) => {
            const { req, err } = routeTotals(r)
            return {
              routeId: r.id, path: r.path, totalRequests: req, totalErrors: err, errorRate: pct(err, req),
              avgLatencyMs: req ? 40 : null, p99LatencyMs: req ? 190 : null, latencySamples: req ? Math.min(req, 1024) : 0,
            }
          })
          .filter((r) => r.totalRequests > 0)
          .sort((a, b) => b.totalRequests - a.totalRequests)
        const totalRequests = routes.reduce((a, r) => a + r.totalRequests, 0)
        const totalErrors = routes.reduce((a, r) => a + r.totalErrors, 0)
        return {
          totalRequests, totalErrors, rateLimited: 14, circuitBreaks: 37, cacheHits: 0, cacheMisses: 0,
          retriesMeasured: false, avgLatencyMs: 48.3, p99LatencyMs: 212.0, latencySamples: 4096,
          routes, total: routes.length,
        }
      },
    },
    "circuits.list": {
      kind: "query",
      handler: () => {
        const circuits = bastion.routes
          .flatMap((r) => r.targets.map((t) => ({ r, t })))
          .map(({ r, t }) => ({
            targetId: t.id, url: t.url, routes: [{ routeId: r.id, path: r.path, targetId: t.id }],
            tracked: t.stats.totalRequests > 0, state: t.circuitState,
            failureCount: t.circuitState === "closed" ? 0 : 5,
            lastFailure: t.circuitState === "closed" ? null : "2026-09-30T09:41:00Z",
            lastStateChange: t.stats.totalRequests > 0 ? "2026-09-30T09:41:00Z" : null,
          }))
          .sort((a, b) => a.targetId.localeCompare(b.targetId))
        return { enabled: true, failureThreshold: 5, resetTimeoutSeconds: 30, halfOpenMax: 3, circuits, total: circuits.length }
      },
    },
    "routes.list": {
      kind: "query",
      handler: (params) => {
        const routes = bastion.routes
          .filter((r) => !params?.source || r.source === params.source)
          .filter((r) => !params?.protocol || r.protocol === params.protocol)
          .map(summary)
        return { routes, total: routes.length }
      },
    },
    "routes.detail": {
      kind: "query",
      handler: (params) => {
        const id = typeof params?.id === "string" ? params.id.trim() : ""
        if (!id) throw new FixtureError(400, "BAD_REQUEST", "id is required")
        const r = bastion.routes.find((x) => x.id === id)
        if (!r) throw new FixtureError(404, "NOT_FOUND", "route not found")
        const { targets, input, ...rest } = r
        return { ...summary(r), ...rest, ...(input ? { input } : {}), targets }
      },
    },
    "upstreams.list": {
      kind: "query",
      handler: () => {
        const ups = upstreams()
        return { upstreams: ups, total: ups.length }
      },
    },
    "services.list": {
      kind: "query",
      handler: () => {
        const services = [
          { name: "billing", version: "2.4.1", address: "10.0.4.12", port: 9000, protocols: ["http"], healthy: false, routeCount: 1, discoveredAt: "2026-09-30T08:01:00Z", metadataKeys: ["team"] },
          { name: "search", version: "1.0.0", address: "10.0.4.20", port: 50051, protocols: ["grpc"], healthy: true, routeCount: 1, discoveredAt: "2026-09-30T08:01:05Z", metadataKeys: [] },
        ]
        return { discoveryEnabled: true, services, total: services.length }
      },
    },
    "openapi.summary": {
      kind: "query",
      handler: () => {
        const services = [
          { serviceName: "billing", version: "2.4.1", specUrl: "http://billing:9000/openapi.json", healthy: false, pathCount: 0, error: "GET http://billing:9000/openapi.json: connection refused", fetchedAt: "2026-09-30T09:00:00Z" },
          { serviceName: "orders", version: "3.1.0", specUrl: "http://orders-a:8080/openapi.json", healthy: true, pathCount: 14, fetchedAt: "2026-09-30T09:00:00Z" },
        ]
        return { enabled: true, running: true, specPath: "/gateway/openapi.json", lastRefresh: "2026-09-30T09:00:00Z", totalPaths: 14, services, total: services.length }
      },
    },
    "config.detail": {
      kind: "query",
      handler: () => ({
        sections: [
          { id: "gateway", title: "Gateway", enabled: true, settings: [{ key: "Base path", value: "/gw" }, { key: "Routes in config", value: "1" }] },
          { id: "circuitBreaker", title: "Circuit breaker", enabled: true, settings: [{ key: "Failure threshold", value: "5" }, { key: "Reset timeout", value: "30s" }, { key: "Half-open probes", value: "3" }] },
          { id: "retry", title: "Retry", enabled: true, note: "Nothing in the proxy calls the retry policy, so no request is retried whatever this says.", settings: [{ key: "Max attempts", value: "3" }] },
          { id: "caching", title: "Response cache", enabled: false, note: "Nothing writes to the cache, so every lookup misses whatever this says.", settings: [{ key: "Default TTL", value: "5m0s" }] },
          { id: "tls", title: "Upstream TLS", enabled: true, settings: [{ key: "Client key", value: "set" }, { key: "CA certificate", value: "not set" }] },
          { id: "ipFilter", title: "IP filter", enabled: true, settings: [{ key: "Allow list", value: "2 addresses" }, { key: "Deny list", value: "0 addresses" }] },
          { id: "timeouts", title: "Timeouts", enabled: null, settings: [{ key: "Connect", value: "5s" }, { key: "Read", value: "30s" }] },
        ],
      }),
    },
  }
}
```

- [ ] **Step 2: Register it in `server.mjs`**

Add beside the other imports: `import { createBastionHandlers, resetBastion } from "./bastion-fixtures.mjs"`. Add to the header inventory: `//   - bastion             (packages/plugin-bastion)          9 queries`. Add to `CONTRIBUTORS` after chronicle: `{ name: "bastion", envPrefix: "BASTION", handlers: createBastionHandlers(FixtureError) },`. Add `resetBastion()` to `handleReset` after `resetChronicle()`.

- [ ] **Step 3: Add verify inputs and a spot check**

In `verify.mjs`'s `INPUT` table add `"bastion::routes.detail": { id: "manual-/users" },`. After the vault spot-check block add:

```js
  // bastion: the rules the Go handlers enforce, not just "answered".
  {
    const call = (intent, input) => dispatch("bastion", intent, "query", input, csrf)
    const check = (name, ok, detail) => {
      console.log(`  bastion ${name}: ${ok}`)
      if (!ok) failures.push({ key: `spot-check::bastion ${name}`, reason: detail })
    }
    const missing = await call("routes.detail", { id: "nope" })
    check("unknown route is NOT_FOUND", missing.body?.error?.code === "NOT_FOUND", JSON.stringify(missing.body))
    const blank = await call("routes.detail", {})
    check("missing id is BAD_REQUEST", blank.body?.error?.code === "BAD_REQUEST", JSON.stringify(blank.body))
    const orders = await call("routes.detail", { id: "9b2f6c1e-4d3a-4f7b-8c21-5e0a7d9f1b36" })
    const leaked = JSON.stringify(orders.body).includes("k-")
    check("transform api key is redacted", orders.body?.data?.transform?.requestHeaders?.set?.["X-Api-Key"] === "[redacted]" && !leaked, JSON.stringify(orders.body?.data?.transform))
    const first = (await call("overview.stats", {})).body?.data?.totalRequests
    const second = (await call("overview.stats", {})).body?.data?.totalRequests
    check("overview counters advance between reads", second > first, `${first} then ${second}`)
  }
```

- [ ] **Step 4: Run it over HTTP**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
(FIXTURE_PORT=8299 node packages/fixture-server/server.mjs > /tmp/bastion-fixture.log 2>&1 &) ; sleep 1
node packages/fixture-server/verify.mjs http://localhost:8299 | grep -E "bastion|FAIL|failures" | head -30
pkill -f "FIXTURE_PORT=8299" || lsof -ti tcp:8299 | xargs kill
```

Expected: each of the nine bastion intents answered, the four `bastion ...: true` spot-check lines, exit status 0. Use the scratchpad directory instead of `/tmp` for the log if the session provides one.

- [ ] **Step 5: Commit**

```bash
git add packages/fixture-server/bastion-fixtures.mjs
git commit --only packages/fixture-server/bastion-fixtures.mjs packages/fixture-server/server.mjs packages/fixture-server/verify.mjs -m "feat(fixture): serve bastion's nine queries"
```

`server.mjs` and `verify.mjs` carry uncommitted changes from other sessions (see `git status`). `--only` commits the whole file, theirs included. Before committing, run `git diff packages/fixture-server/server.mjs packages/fixture-server/verify.mjs` and check that every hunk is yours. If a foreign hunk is there, stage only your hunks with `git add -p` and commit with plain `git commit` (not `--only`), then confirm with `git show --stat HEAD`. Record which way you went in the ledger.

---

### Task 11: plugin-bastion scaffold and shell registration

**Files (forge-dashboard):**
- Create: `packages/plugin-bastion/{package.json,tsconfig.json,vitest.config.ts,eslint.config.js}`
- Create: `packages/plugin-bastion/src/{index.tsx,types.ts,keys.ts,format.ts,badges.tsx}`
- Create: `packages/plugin-bastion/src/pages/{overview,routes,route-detail,upstreams}.tsx` (placeholder components Tasks 12 to 14 replace)
- Create: `packages/plugin-bastion/test/{harness.tsx,plugin.test.tsx,format.test.ts,badges.test.tsx}`
- Modify: `apps/shell/src/App.tsx`, `apps/shell/package.json`
- Modify (untracked, do not commit): `apps/shell/src/styles.css`

**Interfaces:**
- Produces:
  - `bastionPlugin` (default and named export), `extension: "bastion"`, `namespace: "bastion"`, label `Bastion`.
  - `types.ts`: TypeScript mirrors of every Go response type in Tasks 2, 6, 7 and 8, field for field.
  - `keys.ts`: `routePath(id: string): string` returning `/routes/${encodeURIComponent(id)}`.
  - `format.ts`: `formatPercent(v: number | null | undefined): string | null` (one decimal, `null` for null), `formatMs(v: number | null | undefined): string | null` (`12.3 ms`, `1.20 s` at or above 1000), `formatCount(n: number): string` (`toLocaleString("en-US")`), `formatUptime(seconds: number): string` (`2h 5m`, `3d 4h`, `45s`).
  - `badges.tsx`: `HealthBadge({healthy})`, `CircuitBadge({state})`, `EnabledBadge({enabled})`, `SourceBadge({source})`, `ProtocolBadge({protocol})`.

- [ ] **Step 1: Package files**

`package.json`: copy `packages/plugin-vault/package.json` with `name` `@forge-go/dashboard-plugin-bastion` and no `dependencies` block (no CodeMirror, no dnd-kit). `tsconfig.json`, `vitest.config.ts` and `eslint.config.js`: copy plugin-vault's verbatim.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
mkdir -p packages/plugin-bastion/src/pages packages/plugin-bastion/test
cp packages/plugin-vault/tsconfig.json packages/plugin-vault/vitest.config.ts packages/plugin-vault/eslint.config.js packages/plugin-bastion/
node -e '
const p=require("./packages/plugin-vault/package.json");
p.name="@forge-go/dashboard-plugin-bastion"; delete p.dependencies;
require("fs").writeFileSync("packages/plugin-bastion/package.json", JSON.stringify(p,null,2)+"\n")'
```

- [ ] **Step 2: Write the failing tests**

`test/harness.tsx`: copy `packages/plugin-vault/test/harness.tsx` and replace every `extension: "vault"` with `extension: "bastion"`.

`test/plugin.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import bastionPlugin, { bastionPlugin as named, BastionOverviewPage } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({ name, envelopes: ["v1"], configured: true })),
  }
}

describe("bastionPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(bastionPlugin).toBe(named)
  })

  // The join key, checked by resolving against the contributor name that
  // bastion/extension/contract/manifest.yaml registers.
  it("resolves to ready against a host reporting bastion", () => {
    expect(resolvePluginState(bastionPlugin, capabilities("bastion"))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report bastion", () => {
    expect(resolvePluginState(bastionPlugin, capabilities("vault")).kind).toBe("hidden")
  })

  it("routes / to the overview and lists the slice 2 pages", () => {
    const paths = bastionPlugin.routes.map((r) => r.path)
    expect(paths).toEqual(["/", "/routes", "/routes/:id", "/upstreams"])
    expect(bastionPlugin.routes[0]?.element).toBe(BastionOverviewPage)
  })

  it("names a route for every nav entry", () => {
    const paths = new Set(bastionPlugin.routes.map((r) => r.path))
    for (const item of bastionPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
```

`test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { formatCount, formatMs, formatPercent, formatUptime } from "../src/format"
import { routePath } from "../src/keys"

describe("format", () => {
  it("renders null as null so the page can say not measured", () => {
    expect(formatPercent(null)).toBeNull()
    expect(formatMs(undefined)).toBeNull()
  })
  it("keeps a real zero", () => {
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatMs(0)).toBe("0.0 ms")
  })
  it("switches to seconds at a thousand milliseconds", () => {
    expect(formatMs(212)).toBe("212.0 ms")
    expect(formatMs(1200)).toBe("1.20 s")
  })
  it("groups counts and reads uptime in its two largest units", () => {
    expect(formatCount(1840)).toBe("1,840")
    expect(formatUptime(45)).toBe("45s")
    expect(formatUptime(7500)).toBe("2h 5m")
    expect(formatUptime(273600)).toBe("3d 4h")
  })
  it("encodes a config route id's slash into one path segment", () => {
    expect(routePath("manual-/users")).toBe("/routes/manual-%2Fusers")
  })
})
```

`test/badges.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CircuitBadge, EnabledBadge, HealthBadge } from "../src/badges"

function variantOf(text: string) {
  return screen.getByText(text).getAttribute("data-variant")
}

describe("badges", () => {
  it("lets the ordinary state recede and the broken one stand out", () => {
    render(
      <>
        <HealthBadge healthy />
        <HealthBadge healthy={false} />
        <CircuitBadge state="closed" />
        <CircuitBadge state="half_open" />
        <CircuitBadge state="open" />
        <EnabledBadge enabled={false} />
      </>,
    )
    expect(variantOf("Healthy")).toBe("outline")
    expect(variantOf("Unhealthy")).toBe("destructive")
    expect(variantOf("Closed")).toBe("outline")
    expect(variantOf("Half-open")).toBe("default")
    expect(variantOf("Open")).toBe("destructive")
    expect(variantOf("Disabled")).toBe("secondary")
  })
})
```

Check `packages/kit/src/components/badge.tsx` renders `data-variant`. If it does not, assert on the class name the variant produces instead (read the file for the exact class), and note which in the ledger.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm install && pnpm --filter @forge-go/dashboard-plugin-bastion test 2>&1 | tail -15`
Expected: FAIL, cannot resolve `../src/index`, `../src/format`, `../src/badges`.

- [ ] **Step 4: Implement**

`src/types.ts` mirrors the Go types exactly. Every Go `*T` is `T | null`, every `omitempty` string is optional:

```ts
export type RouteSource = "manual" | "farp" | "discovery"
export type RouteProtocol = "http" | "websocket" | "sse" | "grpc" | "graphql"
export type CircuitState = "closed" | "open" | "half_open"

export interface RouteSummary {
  id: string
  path: string
  /** Empty means any method. */
  methods: string[]
  protocol: RouteProtocol
  source: RouteSource
  serviceName: string
  /** Effective priority, as the route table sorts it. */
  priority: number
  enabled: boolean
  targetCount: number
  healthyTargets: number
  editable: boolean
  /** Defined in the gateway's config file. */
  config: boolean
  updatedAt: string
}

export interface RoutesList {
  routes: RouteSummary[]
  total: number
}

export interface TargetStats {
  activeConns: number
  totalRequests: number
  totalErrors: number
  avgLatencyMs: number
}

export interface TargetView {
  id: string
  url: string
  weight: number
  tags: string[]
  healthy: boolean
  circuitState: CircuitState
  stats: TargetStats
  tls: boolean
  healthCheckPath?: string
  openapi?: string
  metadataKeys: string[]
}

export interface HeaderPolicy {
  add?: Record<string, string>
  set?: Record<string, string>
  remove?: string[]
}

export interface RouteDetail extends RouteSummary {
  /** Manual routes only: path and priority as the operator entered them. */
  input?: { path: string; priority: number }
  stripPrefix: boolean
  addPrefix: string
  rewritePath: string
  headers: HeaderPolicy
  retry?: Record<string, unknown>
  timeout?: Record<string, unknown>
  rateLimit?: Record<string, unknown>
  auth?: Record<string, unknown>
  circuitBreaker?: Record<string, unknown>
  cache?: Record<string, unknown>
  trafficPolicy?: Record<string, unknown>
  transform?: { requestHeaders: HeaderPolicy; responseHeaders: HeaderPolicy }
  metadataKeys: string[]
  version: number
  createdAt: string
  targets: TargetView[]
}

export interface UpstreamRoute {
  routeId: string
  path: string
  targetId: string
}

export interface Upstream {
  url: string
  healthy: boolean
  circuitState: CircuitState
  activeConns: number
  totalRequests: number
  totalErrors: number
  avgLatencyMs: number
  routes: UpstreamRoute[]
}

export interface UpstreamsList {
  upstreams: Upstream[]
  total: number
}

export interface TopRoute {
  routeId: string
  path: string
  totalRequests: number
  totalErrors: number
}

export interface OverviewStats {
  totalRequests: number
  totalErrors: number
  errorRate: number | null
  avgLatencyMs: number | null
  p99LatencyMs: number | null
  latencySamples: number
  cacheLookups: number
  cacheHitRate: number | null
  rateLimited: number
  circuitBreaks: number
  totalRoutes: number
  enabledRoutes: number
  healthyUpstreams: number
  totalUpstreams: number
  openCircuits: number
  halfOpenCircuits: number
  circuitBreakerEnabled: boolean
  discoveryEnabled: boolean
  startedAt: string | null
  uptimeSeconds: number
  topRoutes: TopRoute[]
}
```

Add `RouteTraffic`, `TrafficStats`, `CircuitView`, `CircuitsList`, `ServiceView`, `ServicesList`, `SpecView`, `OpenAPISummary`, `ConfigSetting`, `ConfigSection`, `ConfigDetail` the same way from Tasks 6 and 8's Go blocks. Slice 4 uses them; defining them now keeps one file mirroring the contract.

`src/keys.ts`:

```ts
/** A route's page. Config route ids contain "/", so the id is one encoded segment. */
export function routePath(id: string): string {
  return `/routes/${encodeURIComponent(id)}`
}
```

`src/format.ts`:

```ts
/** One decimal and a percent sign, or null when nothing was measured. */
export function formatPercent(v: number | null | undefined): string | null {
  return v == null ? null : `${v.toFixed(1)}%`
}

/** Milliseconds below a second, seconds from there up, or null. */
export function formatMs(v: number | null | undefined): string | null {
  if (v == null) return null
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(1)} ms`
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}

/** The two largest units: "3d 4h", "2h 5m", "45s". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${seconds % 60}s`
  return `${seconds}s`
}
```

`src/badges.tsx`:

```tsx
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { CircuitState, RouteProtocol, RouteSource } from "./types"

/*
 * Proportion first. On a working gateway most targets are healthy and most
 * breakers closed, so those take outline and recede. Half-open is the one
 * worth a second look (default); unhealthy and open are what somebody came
 * to find (destructive). A disabled route is notable, not wrong (secondary).
 * Sources and protocols are balanced labels, so outline.
 */

export function HealthBadge({ healthy }: { healthy: boolean }) {
  return <Badge variant={healthy ? "outline" : "destructive"}>{healthy ? "Healthy" : "Unhealthy"}</Badge>
}

const CIRCUIT: Record<CircuitState, { label: string; variant: "outline" | "default" | "destructive" }> = {
  closed: { label: "Closed", variant: "outline" },
  half_open: { label: "Half-open", variant: "default" },
  open: { label: "Open", variant: "destructive" },
}

export function CircuitBadge({ state }: { state: CircuitState }) {
  const c = CIRCUIT[state] ?? CIRCUIT.closed
  return <Badge variant={c.variant}>{c.label}</Badge>
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return <Badge variant={enabled ? "outline" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
}

const SOURCE: Record<RouteSource, string> = { manual: "Manual", farp: "FARP", discovery: "Discovery" }

export function SourceBadge({ source }: { source: RouteSource }) {
  return <Badge variant="outline">{SOURCE[source] ?? source}</Badge>
}

export function ProtocolBadge({ protocol }: { protocol: RouteProtocol }) {
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {protocol}
    </Badge>
  )
}
```

Placeholder pages so the index compiles (Tasks 12 to 14 replace each body). `src/pages/overview.tsx`:

```tsx
import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"

export const BastionOverviewPage: ComponentType<PluginPageProps> = () => null
```

and the same shape for `BastionRoutesPage` (`routes.tsx`), `BastionRouteDetailPage` (`route-detail.tsx`), `BastionUpstreamsPage` (`upstreams.tsx`).

`src/index.tsx`:

```tsx
import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon, RouteIcon, ServerIcon, ShieldIcon } from "@forge-go/dashboard-kit/icons"
import { BastionOverviewPage } from "./pages/overview"
import { BastionRouteDetailPage } from "./pages/route-detail"
import { BastionRoutesPage } from "./pages/routes"
import { BastionUpstreamsPage } from "./pages/upstreams"

export { BastionOverviewPage, BastionRouteDetailPage, BastionRoutesPage, BastionUpstreamsPage }
export { CircuitBadge, EnabledBadge, HealthBadge, ProtocolBadge, SourceBadge } from "./badges"
export { routePath } from "./keys"
export type * from "./types"

/**
 * The first-party UI for the `bastion` gateway extension.
 *
 * `extension` is the Go contributor name from
 * bastion/extension/contract/manifest.yaml, the join key the host looks up in
 * the capabilities response. test/plugin.test.tsx checks it by resolving
 * against a capabilities document.
 */
export const bastionPlugin = definePlugin({
  extension: "bastion",
  namespace: "bastion",
  label: "Bastion",
  icon: <ShieldIcon />,
  nav: [
    { label: "Overview", to: "/", priority: 0, icon: <HouseIcon />, group: "Gateway" },
    { label: "Routes", to: "/routes", priority: 10, icon: <RouteIcon />, group: "Routing" },
    { label: "Upstreams", to: "/upstreams", priority: 11, icon: <ServerIcon />, group: "Routing" },
  ],
  routes: [
    { path: "/", element: BastionOverviewPage },
    { path: "/routes", element: BastionRoutesPage },
    // No nav entry: a sidebar link to "a route" with none chosen points nowhere.
    { path: "/routes/:id", element: BastionRouteDetailPage },
    { path: "/upstreams", element: BastionUpstreamsPage },
  ],
})

export default bastionPlugin
```

Check `packages/kit/src/icons.ts` exports `RouteIcon`, `ServerIcon` and `ShieldIcon`. If one is missing, pick the nearest exported lucide icon and say which in the ledger; do not add icons to kit for this.

Shell registration. `apps/shell/package.json` dependencies: add `"@forge-go/dashboard-plugin-bastion": "workspace:*",` in alphabetical order. `apps/shell/src/App.tsx`: `import bastionPlugin from "@forge-go/dashboard-plugin-bastion"` and add `bastionPlugin` to the `plugins` array after `ledgerPlugin`. `apps/shell/src/styles.css`: add `@source "../../../packages/plugin-bastion/src";`. That file is untracked in the shared tree and belongs to the working tree, not to any commit; edit it and leave it out of the commit.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm install && pnpm --filter @forge-go/dashboard-plugin-bastion test && pnpm --filter @forge-go/dashboard-plugin-bastion typecheck && pnpm --filter @forge-go/dashboard-plugin-bastion lint && pnpm --filter @forge-go/dashboard-shell typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-bastion
git commit --only packages/plugin-bastion apps/shell/src/App.tsx apps/shell/package.json pnpm-lock.yaml -m "feat(bastion): scaffold the bastion plugin and mount it in the shell"
```

Check `git diff --cached --stat` shows only these paths. `pnpm-lock.yaml` may carry another session's changes; if its diff has hunks unrelated to plugin-bastion, leave it out and note it in the ledger.

---

### Task 12: Overview page

**Files:**
- Modify: `packages/plugin-bastion/src/pages/overview.tsx`
- Create: `packages/plugin-bastion/test/overview.test.tsx`

**Interfaces:**
- Consumes: `OverviewStats`, `formatPercent`, `formatMs`, `formatCount`, `formatUptime`, `routePath`, `usePoll`.

Behaviour:
- `useQuery<OverviewStats>("overview.stats")` inside a `QueryBoundary` titled `Gateway overview`, polled with `usePoll(query.refetch)`.
- `StatGrid` items, in order: `Requests` (count; hint `N errors`), `Error rate` (percent, or `Not measured` with hint `No requests yet`), `Latency` (avg ms, hint `p99 X over the last N responses`, or `Not measured` with hint `No upstream has answered yet`), `Upstreams` (`healthy of total`), `Open circuits` (count; hint `N half-open`; when breakers are disabled the value is `Off` with hint `Circuit breaking is disabled`), `Cache hit rate` (percent with hint `N lookups`, or `Not measured` with hint `No cache lookups`), `Routes` (`enabled of total`), `Uptime` (`formatUptime`, or `Not started` when `startedAt` is null).
- A `Busiest routes` table: Path (mono, `font-medium`, link via `routePath`), Requests, Errors. Caption `N routes`. Empty message: `No route has served traffic yet.`

- [ ] **Step 1: Write the failing test**

`test/overview.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { BastionOverviewPage } from "../src/pages/overview"
import type { OverviewStats } from "../src/types"
import { failingClient, renderPage, stubClient } from "./harness"

function stats(over: Partial<OverviewStats> = {}): OverviewStats {
  return {
    totalRequests: 1840, totalErrors: 46, errorRate: 2.5, avgLatencyMs: 48.3, p99LatencyMs: 212,
    latencySamples: 1024, cacheLookups: 0, cacheHitRate: null, rateLimited: 0, circuitBreaks: 3,
    totalRoutes: 4, enabledRoutes: 3, healthyUpstreams: 4, totalUpstreams: 5,
    openCircuits: 1, halfOpenCircuits: 1, circuitBreakerEnabled: true, discoveryEnabled: true,
    startedAt: "2026-09-30T08:00:00Z", uptimeSeconds: 7500,
    topRoutes: [{ routeId: "manual-/users", path: "/gw/users", totalRequests: 920, totalErrors: 3 }],
    ...over,
  }
}

function stat(label: string): HTMLElement {
  return screen.getByText(label).closest("[data-slot='card']") as HTMLElement
}

describe("BastionOverviewPage", () => {
  it("shows measured values", async () => {
    renderPage(BastionOverviewPage, stubClient({ "overview.stats": stats() }))
    await screen.findByText("1,840")
    expect(screen.getByText("2.5%")).toBeTruthy()
    expect(screen.getByText("48.3 ms")).toBeTruthy()
    expect(screen.getByText("4 of 5")).toBeTruthy()
    expect(screen.getByText("2h 5m")).toBeTruthy()
  })

  it("says not measured, never 0, on an idle gateway", async () => {
    renderPage(
      BastionOverviewPage,
      stubClient({
        "overview.stats": stats({
          totalRequests: 0, totalErrors: 0, errorRate: null, avgLatencyMs: null, p99LatencyMs: null,
          latencySamples: 0, startedAt: null, uptimeSeconds: 0, topRoutes: [],
        }),
      }),
    )
    await screen.findByText("No requests yet")
    expect(screen.getAllByText("Not measured").length).toBe(3)
    expect(screen.getByText("Not started")).toBeTruthy()
    expect(screen.queryByText("0.0%")).toBeNull()
    expect(screen.getByText("No route has served traffic yet.")).toBeTruthy()
    expect(screen.getByText("0 routes")).toBeTruthy()
  })

  it("says circuit breaking is off rather than reporting no open circuits", async () => {
    renderPage(BastionOverviewPage, stubClient({ "overview.stats": stats({ circuitBreakerEnabled: false, openCircuits: 0 }) }))
    await screen.findByText("Circuit breaking is disabled")
    expect(within(stat("Open circuits")).getByText("Off")).toBeTruthy()
  })

  it("links busiest routes with the id encoded", async () => {
    renderPage(BastionOverviewPage, stubClient({ "overview.stats": stats() }))
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
  })

  it("renders the error card when the query fails", async () => {
    renderPage(BastionOverviewPage, failingClient(new ContractError("INTERNAL", "gateway down")))
    expect(await screen.findByText(/Gateway overview unavailable/)).toBeTruthy()
  })
})
```

`stat()` assumes `StatGrid` renders each item in an element with `data-slot="card"`. Read `packages/kit/src/components/stat-grid.tsx` first and use whatever wraps one item.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- overview`
Expected: FAIL, nothing rendered by the placeholder.

- [ ] **Step 3: Implement**

`src/pages/overview.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatCount, formatMs, formatPercent, formatUptime } from "../format"
import { routePath } from "../keys"
import type { OverviewStats, TopRoute } from "../types"

const NOT_MEASURED = "Not measured"

const topColumns: Column<TopRoute>[] = [
  {
    id: "path",
    header: "Path",
    className: "font-mono text-xs font-medium",
    cell: (r) => <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>,
  },
  { id: "requests", header: "Requests", align: "end", cell: (r) => formatCount(r.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (r) => formatCount(r.totalErrors) },
]

function items(s: OverviewStats) {
  const latency = formatMs(s.avgLatencyMs)
  return [
    { label: "Requests", value: formatCount(s.totalRequests), hint: `${formatCount(s.totalErrors)} errors` },
    s.errorRate == null
      ? { label: "Error rate", value: NOT_MEASURED, hint: "No requests yet" }
      : { label: "Error rate", value: formatPercent(s.errorRate) ?? NOT_MEASURED },
    latency == null
      ? { label: "Latency", value: NOT_MEASURED, hint: "No upstream has answered yet" }
      : {
          label: "Latency",
          value: latency,
          hint: `p99 ${formatMs(s.p99LatencyMs)} over the last ${formatCount(s.latencySamples)} responses`,
        },
    { label: "Upstreams", value: `${s.healthyUpstreams} of ${s.totalUpstreams}`, hint: "healthy" },
    s.circuitBreakerEnabled
      ? { label: "Open circuits", value: s.openCircuits, hint: `${s.halfOpenCircuits} half-open` }
      : { label: "Open circuits", value: "Off", hint: "Circuit breaking is disabled" },
    s.cacheHitRate == null
      ? { label: "Cache hit rate", value: NOT_MEASURED, hint: "No cache lookups" }
      : { label: "Cache hit rate", value: formatPercent(s.cacheHitRate) ?? NOT_MEASURED, hint: `${formatCount(s.cacheLookups)} lookups` },
    { label: "Routes", value: `${s.enabledRoutes} of ${s.totalRoutes}`, hint: "enabled" },
    { label: "Uptime", value: s.startedAt == null ? "Not started" : formatUptime(s.uptimeSeconds) },
  ]
}

export const BastionOverviewPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<OverviewStats>("overview.stats")
  usePoll(query.refetch)

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Gateway" description="Traffic, upstream health and circuit state for this gateway process." />
      <QueryBoundary title="Gateway overview" query={query} skeletonRows={4}>
        {(s) => (
          <>
            <StatGrid items={items(s)} />
            <section aria-labelledby="busiest-heading" className="flex flex-col gap-2">
              <h2 id="busiest-heading" className="text-sm font-medium">
                Busiest routes
              </h2>
              <ResourceTable<TopRoute>
                columns={topColumns}
                rows={s.topRoutes}
                rowKey={(r) => r.routeId}
                caption={`${s.topRoutes.length} ${s.topRoutes.length === 1 ? "route" : "routes"}`}
                emptyMessage="No route has served traffic yet."
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test && pnpm --filter @forge-go/dashboard-plugin-bastion typecheck && pnpm --filter @forge-go/dashboard-plugin-bastion lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/test/overview.test.tsx
git commit --only packages/plugin-bastion/src/pages/overview.tsx packages/plugin-bastion/test/overview.test.tsx -m "feat(bastion): overview page that says not measured instead of zero"
```

---

### Task 13: Routes list and route detail

**Files:**
- Modify: `packages/plugin-bastion/src/pages/routes.tsx`, `packages/plugin-bastion/src/pages/route-detail.tsx`
- Create: `packages/plugin-bastion/test/routes.test.tsx`, `packages/plugin-bastion/test/route-detail.test.tsx`

**Interfaces:**
- Consumes: `RoutesList`, `RouteDetail`, badges, `routePath`, format helpers.
- Exports `routeColumns: Column<RouteSummary>[]` from `routes.tsx` (slice 3 reuses it).

Routes list behaviour:
- `FilterBar` outside the boundary with two filters, `Source` (All, Manual, FARP, Discovery) and `Protocol` (All, http, websocket, sse, grpc, graphql). The query sends `source` and `protocol` only when set (absent, not empty).
- Columns: Path (mono, `font-medium`, link), Methods (`TagList` with label `methods`; an empty list renders the text `Any`), Protocol badge, Source badge, Priority (mono), Upstreams (`healthy/total healthy`), Status (`EnabledBadge`).
- Caption `N routes`. Empty messages: no filter set `No routes. Add one in config, or let discovery find your services.`; a filter set `No routes match these filters.`

Route detail behaviour:
- `params.id` split from the body like vault's `rotation-detail.tsx`: no id renders `No route in the address, so there is nothing to show.` with `role="status"`.
- `useQuery<RouteDetail>("routes.detail", { id })`, boundary title `Route`.
- `PageHeader` title = path, description = `Served by N upstream(s).`
- A `DescriptionList`: Route ID (mono), Source (badge, plus `from the config file` when `config`), Service (mono or `NoneCell label="service"`), Protocol, Methods (TagList or `Any`), Priority (effective; when `input` is present, `105 (entered as 5)`), Status, Strip prefix (`Yes`/`No`), Add prefix and Rewrite path (mono or NoneCell), Updated (`Timestamp`).
- When `config` is true, a line: `This route comes from the gateway's config file. A change made here lasts until the gateway restarts.`
- When the source is farp or discovery, a line: `Discovery manages this route. Its next update replaces any change, so it cannot be edited here.`
- A `Targets` table: URL (mono, `font-medium`), Weight, Health badge, Circuit badge, Requests, Errors, Avg latency (`formatMs`, `NoneCell label="latency"` when 0 requests). Caption `N targets`.
- A `Headers` section: one row per header across `headers.set`, `headers.add` and `transform.requestHeaders.set`, `transform.responseHeaders.set`, showing where (`Set`, `Add`, `Request transform`, `Response transform`), name (mono) and value (mono; `[redacted]` rendered as a `secondary` badge `Redacted`). Caption `N headers`, empty `No header changes.`
- An `Overrides` DescriptionList listing whichever of retry, timeout, rateLimit, auth, circuitBreaker, cache, trafficPolicy is present as a JSON one-liner (`font-mono text-xs`); none present renders `<NoneCell label="overrides" />`.
- `metadataKeys` as a `TagList` labelled `metadata`.

- [ ] **Step 1: Write the failing tests**

`test/routes.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { BastionRoutesPage } from "../src/pages/routes"
import type { RouteSummary } from "../src/types"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

function route(over: Partial<RouteSummary> = {}): RouteSummary {
  return {
    id: "manual-/users", path: "/gw/users", methods: [], protocol: "http", source: "manual", serviceName: "",
    priority: 110, enabled: true, targetCount: 2, healthyTargets: 1, editable: true, config: true,
    updatedAt: "2026-09-30T07:30:00Z", ...over,
  }
}

function rowFor(text: string) {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("BastionRoutesPage", () => {
  it("lists routes with an encoded link, Any for no methods, and a live count", async () => {
    renderPage(BastionRoutesPage, stubClient({ "routes.list": { routes: [route()], total: 1 } }))
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
    expect(link.closest("td")?.className).toMatch(/font-mono/)
    expect(within(rowFor("/gw/users")).getByText("Any")).toBeTruthy()
    expect(within(rowFor("/gw/users")).getByText("1/2 healthy")).toBeTruthy()
    expect(screen.getByText("1 route")).toBeTruthy()
  })

  it("sends a filter only when one is chosen", async () => {
    const { client, sent } = recordingQueryClient({ "routes.list": { routes: [], total: 0 } })
    renderPage(BastionRoutesPage, client)
    await screen.findByText("No routes. Add one in config, or let discovery find your services.")
    expect(sent.find((s) => s.intent === "routes.list")?.params).toEqual({})

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "farp" } })
    await screen.findByText("No routes match these filters.")
    expect(sent.at(-1)?.params).toEqual({ source: "farp" })
    expect(screen.getByText("0 routes")).toBeTruthy()
  })
})
```

`FilterBar` may render its selects as a custom component rather than a native `<select>`. Read `packages/kit/src/components/filter-bar.tsx` and drive it the way `packages/plugin-vault/test/audit.test.tsx` does; keep the two assertions.

`test/route-detail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionRouteDetailPage } from "../src/pages/route-detail"
import type { RouteDetail } from "../src/types"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

function detail(over: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "manual-/users", path: "/gw/users", methods: ["GET"], protocol: "http", source: "manual", serviceName: "",
    priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
    updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
    stripPrefix: true, addPrefix: "", rewritePath: "",
    headers: { set: { "X-Env": "prod" } },
    transform: { requestHeaders: { set: { "X-Api-Key": "[redacted]" } }, responseHeaders: {} },
    metadataKeys: [], version: 2, createdAt: "2026-09-29T10:00:00Z",
    targets: [{
      id: "t0", url: "http://users:8080", weight: 1, tags: [], healthy: true, circuitState: "half_open",
      stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [],
    }],
    ...over,
  }
}

describe("BastionRouteDetailPage", () => {
  it("asks for the decoded id, slash included", async () => {
    const { client, sent } = recordingQueryClient({ "routes.detail": detail() })
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    await screen.findByRole("heading", { name: "/gw/users" })
    expect(sent[0]).toEqual({ intent: "routes.detail", params: { id: "manual-/users" } })
  })

  it("shows the entered priority beside the effective one and warns about config routes", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    await screen.findByText("110 (entered as 10)")
    expect(screen.getByText(/lasts until the gateway restarts/)).toBeTruthy()
  })

  it("marks a redacted header rather than printing its placeholder as a value", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    const row = (await screen.findByText("X-Api-Key")).closest("tr") as HTMLElement
    expect(within(row).getByText("Redacted")).toBeTruthy()
    expect(within(row).getByText("Request transform")).toBeTruthy()
    expect(screen.getByText("2 headers")).toBeTruthy()
  })

  it("says discovery owns a FARP route", async () => {
    renderPage(
      BastionRouteDetailPage,
      stubClient({ "routes.detail": detail({ source: "farp", editable: false, config: false, input: undefined }) }),
      { id: "farp-x" },
    )
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByText(/entered as/)).toBeNull()
  })

  it("shows no latency for a target that has served nothing", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    await screen.findByText("http://users:8080")
    expect(screen.getByLabelText("no latency")).toBeTruthy()
    expect(screen.getByText("Half-open")).toBeTruthy()
  })

  it("renders a status line and asks nothing when the address has no id", () => {
    const { client, sent } = recordingQueryClient({})
    renderPage(BastionRouteDetailPage, client, {})
    expect(screen.getByRole("status").textContent).toBe("No route in the address, so there is nothing to show.")
    expect(sent).toHaveLength(0)
  })
})
```

`getByLabelText("no latency")` assumes `NoneCell` renders an aria-label `no <label>`, as `Timestamp` does. Read `none-cell.tsx` and match its real accessible name.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- routes route-detail`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/routes.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { EnabledBadge, ProtocolBadge, SourceBadge } from "../badges"
import { routePath } from "../keys"
import type { RouteSummary, RoutesList } from "../types"

const SOURCE_OPTIONS = [
  { label: "All", value: "" },
  { label: "Manual", value: "manual" },
  { label: "FARP", value: "farp" },
  { label: "Discovery", value: "discovery" },
]

const PROTOCOL_OPTIONS = [
  { label: "All", value: "" },
  ...["http", "websocket", "sse", "grpc", "graphql"].map((p) => ({ label: p, value: p })),
]

/** Methods as tags, or "Any": an empty list means the route matches every method. */
export function Methods({ methods }: { methods: string[] }) {
  if (methods.length === 0) return <span className="text-muted-foreground">Any</span>
  return <TagList values={methods} label="methods" />
}

export const routeColumns: Column<RouteSummary>[] = [
  {
    id: "path",
    header: "Path",
    className: "font-mono text-xs font-medium",
    cell: (r) => <PluginLink to={routePath(r.id)}>{r.path}</PluginLink>,
  },
  { id: "methods", header: "Methods", cell: (r) => <Methods methods={r.methods} /> },
  { id: "protocol", header: "Protocol", cell: (r) => <ProtocolBadge protocol={r.protocol} /> },
  { id: "source", header: "Source", cell: (r) => <SourceBadge source={r.source} /> },
  { id: "priority", header: "Priority", align: "end", className: "font-mono text-xs", cell: (r) => r.priority },
  { id: "upstreams", header: "Upstreams", cell: (r) => `${r.healthyTargets}/${r.targetCount} healthy` },
  { id: "status", header: "Status", cell: (r) => <EnabledBadge enabled={r.enabled} /> },
]

export const BastionRoutesPage: ComponentType<PluginPageProps> = () => {
  const [source, setSource] = useState("")
  const [protocol, setProtocol] = useState("")
  const filtered = source !== "" || protocol !== ""

  const list = useQuery<RoutesList>("routes.list", {
    // Absent, not empty, when a filter is not set.
    ...(source === "" ? {} : { source }),
    ...(protocol === "" ? {} : { protocol }),
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Routes" description="Every route in match order: manual routes from config or this dashboard, and routes discovery found." />
      <FilterBar
        filters={[
          { id: "source", label: "Source", value: source, options: SOURCE_OPTIONS, onChange: setSource },
          { id: "protocol", label: "Protocol", value: protocol, options: PROTOCOL_OPTIONS, onChange: setProtocol },
        ]}
      />
      <QueryBoundary title="Routes" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<RouteSummary>
            columns={routeColumns}
            rows={data.routes}
            rowKey={(r) => r.id}
            caption={`${data.total} ${data.total === 1 ? "route" : "routes"}`}
            emptyMessage={
              filtered
                ? "No routes match these filters."
                : "No routes. Add one in config, or let discovery find your services."
            }
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

`src/pages/route-detail.tsx`:

```tsx
import type { ComponentType, ReactNode } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CircuitBadge, EnabledBadge, HealthBadge, ProtocolBadge, SourceBadge } from "../badges"
import { formatCount, formatMs } from "../format"
import type { HeaderPolicy, RouteDetail, TargetView } from "../types"
import { Methods } from "./routes"

const REDACTED = "[redacted]"

interface HeaderRow {
  where: string
  name: string
  value: string
}

function headerRows(d: RouteDetail): HeaderRow[] {
  const rows: HeaderRow[] = []
  const push = (where: string, m?: Record<string, string>) => {
    for (const [name, value] of Object.entries(m ?? {})) rows.push({ where, name, value })
  }
  const policy = (where: string, p?: HeaderPolicy) => push(where, p?.set)
  policy("Set", d.headers)
  push("Add", d.headers.add)
  policy("Request transform", d.transform?.requestHeaders)
  policy("Response transform", d.transform?.responseHeaders)
  return rows
}

const headerColumns: Column<HeaderRow>[] = [
  { id: "where", header: "Where", cell: (h) => h.where },
  { id: "name", header: "Header", className: "font-mono text-xs font-medium", cell: (h) => h.name },
  {
    id: "value",
    header: "Value",
    className: "font-mono text-xs",
    cell: (h) => (h.value === REDACTED ? <Badge variant="secondary">Redacted</Badge> : h.value),
  },
]

const targetColumns: Column<TargetView>[] = [
  { id: "url", header: "URL", className: "font-mono text-xs font-medium", cell: (t) => t.url },
  { id: "weight", header: "Weight", align: "end", cell: (t) => t.weight },
  { id: "health", header: "Health", cell: (t) => <HealthBadge healthy={t.healthy} /> },
  { id: "circuit", header: "Circuit", cell: (t) => <CircuitBadge state={t.circuitState} /> },
  { id: "requests", header: "Requests", align: "end", cell: (t) => formatCount(t.stats.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (t) => formatCount(t.stats.totalErrors) },
  {
    id: "latency",
    header: "Avg latency",
    align: "end",
    cell: (t) => (t.stats.totalRequests === 0 ? <NoneCell label="latency" /> : formatMs(t.stats.avgLatencyMs)),
  },
]

const OVERRIDES = ["retry", "timeout", "rateLimit", "auth", "circuitBreaker", "cache", "trafficPolicy"] as const

function mono(v: string, none: string): ReactNode {
  return v ? <span className="font-mono text-xs">{v}</span> : <NoneCell label={none} />
}

export const BastionRouteDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No route in the address, so there is nothing to show.
      </p>
    )
  }
  return <RouteDetailBody id={id} />
}

function RouteDetailBody({ id }: { id: string }) {
  const query = useQuery<RouteDetail>("routes.detail", { id })

  return (
    <section className="flex flex-col gap-6">
      <QueryBoundary title="Route" query={query} skeletonRows={6}>
        {(d) => {
          const headers = headerRows(d)
          const overrides = OVERRIDES.filter((k) => d[k] != null)
          const discovered = d.source !== "manual"
          return (
            <>
              <PageHeader
                title={d.path}
                description={`Served by ${d.targets.length} ${d.targets.length === 1 ? "upstream" : "upstreams"}.`}
              />
              {d.config && (
                <p className="text-sm text-muted-foreground">
                  This route comes from the gateway's config file. A change made here lasts until the gateway restarts.
                </p>
              )}
              {discovered && (
                <p className="text-sm text-muted-foreground">
                  Discovery manages this route. Its next update replaces any change, so it cannot be edited here.
                </p>
              )}
              <DescriptionList
                items={[
                  { term: "Route ID", value: <span className="font-mono text-xs">{d.id}</span> },
                  {
                    term: "Source",
                    value: (
                      <span className="flex items-center gap-2">
                        <SourceBadge source={d.source} />
                        {d.config && <span className="text-sm text-muted-foreground">from the config file</span>}
                      </span>
                    ),
                  },
                  { term: "Service", value: mono(d.serviceName, "service") },
                  { term: "Protocol", value: <ProtocolBadge protocol={d.protocol} /> },
                  { term: "Methods", value: <Methods methods={d.methods} /> },
                  {
                    term: "Priority",
                    value: (
                      <span className="font-mono text-xs">
                        {d.input ? `${d.priority} (entered as ${d.input.priority})` : d.priority}
                      </span>
                    ),
                  },
                  { term: "Status", value: <EnabledBadge enabled={d.enabled} /> },
                  { term: "Strip prefix", value: d.stripPrefix ? "Yes" : "No" },
                  { term: "Add prefix", value: mono(d.addPrefix, "added prefix") },
                  { term: "Rewrite path", value: mono(d.rewritePath, "rewrite") },
                  { term: "Metadata", value: <TagList values={d.metadataKeys} label="metadata" /> },
                  { term: "Updated", value: <Timestamp value={d.updatedAt} label="update" /> },
                ]}
              />
              <section aria-labelledby="targets-heading" className="flex flex-col gap-2">
                <h2 id="targets-heading" className="text-sm font-medium">Targets</h2>
                <ResourceTable<TargetView>
                  columns={targetColumns}
                  rows={d.targets}
                  rowKey={(t) => t.id}
                  caption={`${d.targets.length} ${d.targets.length === 1 ? "target" : "targets"}`}
                  emptyMessage="This route has no upstream, so every request to it fails."
                />
              </section>
              <section aria-labelledby="headers-heading" className="flex flex-col gap-2">
                <h2 id="headers-heading" className="text-sm font-medium">Headers</h2>
                <ResourceTable<HeaderRow>
                  columns={headerColumns}
                  rows={headers}
                  rowKey={(h) => `${h.where}:${h.name}`}
                  caption={`${headers.length} ${headers.length === 1 ? "header" : "headers"}`}
                  emptyMessage="No header changes."
                />
              </section>
              <section aria-labelledby="overrides-heading" className="flex flex-col gap-2">
                <h2 id="overrides-heading" className="text-sm font-medium">Overrides</h2>
                {overrides.length === 0 ? (
                  <NoneCell label="overrides" />
                ) : (
                  <DescriptionList
                    items={overrides.map((k) => ({
                      term: k,
                      value: <span className="font-mono text-xs">{JSON.stringify(d[k])}</span>,
                    }))}
                  />
                )}
              </section>
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test && pnpm --filter @forge-go/dashboard-plugin-bastion typecheck && pnpm --filter @forge-go/dashboard-plugin-bastion lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/test/routes.test.tsx packages/plugin-bastion/test/route-detail.test.tsx
git commit --only packages/plugin-bastion/src/pages/routes.tsx packages/plugin-bastion/src/pages/route-detail.tsx packages/plugin-bastion/test/routes.test.tsx packages/plugin-bastion/test/route-detail.test.tsx -m "feat(bastion): routes list and route detail pages"
```

---

### Task 14: Upstreams page

**Files:**
- Modify: `packages/plugin-bastion/src/pages/upstreams.tsx`
- Create: `packages/plugin-bastion/test/upstreams.test.tsx`

Behaviour: `useQuery<UpstreamsList>("upstreams.list")`, boundary title `Upstreams`. Header description: `Each upstream once, however many routes use it. An upstream is healthy only when every route's entry for it is.` Columns: URL (mono, `font-medium`), Health, Circuit, Routes (a comma list of links to each route's page, path as text), Requests, Errors, Avg latency (NoneCell `latency` at 0 requests). Caption `N upstreams`; empty `No upstreams. Add a route to give the gateway somewhere to send traffic.`

- [ ] **Step 1: Write the failing test**

`test/upstreams.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionUpstreamsPage } from "../src/pages/upstreams"
import type { Upstream } from "../src/types"
import { renderPage, stubClient } from "./harness"

const ORDERS: Upstream = {
  url: "http://orders:8080", healthy: false, circuitState: "open", activeConns: 2,
  totalRequests: 2150, totalErrors: 56, avgLatencyMs: 62.1,
  routes: [
    { routeId: "manual-/users", path: "/gw/users", targetId: "t1" },
    { routeId: "9b2f", path: "/gw/orders", targetId: "t2" },
  ],
}

describe("BastionUpstreamsPage", () => {
  it("lists each upstream once with links to every route using it", async () => {
    renderPage(BastionUpstreamsPage, stubClient({ "upstreams.list": { upstreams: [ORDERS], total: 1 } }))
    const row = (await screen.findByText("http://orders:8080")).closest("tr") as HTMLElement
    expect(within(row).getByText("Unhealthy")).toBeTruthy()
    expect(within(row).getByText("Open")).toBeTruthy()
    expect(within(row).getByRole("link", { name: "/gw/users" }).getAttribute("href")).toBe("/routes/manual-%2Fusers")
    expect(within(row).getByRole("link", { name: "/gw/orders" })).toBeTruthy()
    expect(screen.getByText("1 upstream")).toBeTruthy()
  })

  it("counts zero and says what to do", async () => {
    renderPage(BastionUpstreamsPage, stubClient({ "upstreams.list": { upstreams: [], total: 0 } }))
    await screen.findByText("No upstreams. Add a route to give the gateway somewhere to send traffic.")
    expect(screen.getByText("0 upstreams")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- upstreams`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/upstreams.tsx`:

```tsx
import { Fragment } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { CircuitBadge, HealthBadge } from "../badges"
import { formatCount, formatMs } from "../format"
import { routePath } from "../keys"
import type { Upstream, UpstreamsList } from "../types"

const columns: Column<Upstream>[] = [
  { id: "url", header: "URL", className: "font-mono text-xs font-medium", cell: (u) => u.url },
  { id: "health", header: "Health", cell: (u) => <HealthBadge healthy={u.healthy} /> },
  { id: "circuit", header: "Circuit", cell: (u) => <CircuitBadge state={u.circuitState} /> },
  {
    id: "routes",
    header: "Routes",
    className: "font-mono text-xs",
    cell: (u) =>
      u.routes.map((r, i) => (
        <Fragment key={r.targetId}>
          {i > 0 && ", "}
          <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>
        </Fragment>
      )),
  },
  { id: "requests", header: "Requests", align: "end", cell: (u) => formatCount(u.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (u) => formatCount(u.totalErrors) },
  {
    id: "latency",
    header: "Avg latency",
    align: "end",
    cell: (u) => (u.totalRequests === 0 ? <NoneCell label="latency" /> : formatMs(u.avgLatencyMs)),
  },
]

export const BastionUpstreamsPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<UpstreamsList>("upstreams.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Upstreams"
        description="Each upstream once, however many routes use it. An upstream is healthy only when every route's entry for it is."
      />
      <QueryBoundary title="Upstreams" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<Upstream>
            columns={columns}
            rows={data.upstreams}
            rowKey={(u) => u.url}
            caption={`${data.total} ${data.total === 1 ? "upstream" : "upstreams"}`}
            emptyMessage="No upstreams. Add a route to give the gateway somewhere to send traffic."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test && pnpm --filter @forge-go/dashboard-plugin-bastion typecheck && pnpm --filter @forge-go/dashboard-plugin-bastion lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/test/upstreams.test.tsx
git commit --only packages/plugin-bastion/src/pages/upstreams.tsx packages/plugin-bastion/test/upstreams.test.tsx -m "feat(bastion): upstreams page"
```

---

### Task 15: Run it

**Files:** none new unless something breaks.

- [ ] **Step 1: Whole-workspace gates**

Run: `pnpm -r test 2>&1 | tail -20 && pnpm -r typecheck 2>&1 | tail -10`
Expected: green. A failure in a package this plan did not touch is reported by name, not fixed here.

- [ ] **Step 2: Start the fixture server and the shell**

Use the preview tools, not Bash: `preview_start` with `{name: "fixture-server"}` (port 8099), then `{name: "dashboard-shell"}` (port 5173). The shell proxies the contract to `http://localhost:8099` by default.

- [ ] **Step 3: Click through**

In the shell tab, navigate to `/dashboard/ui/@bastion/` and check with `read_page`:
- The sidebar shows Bastion with Overview, Routes and Upstreams.
- Overview: the stat grid shows `Cache hit rate` as `Not measured`, `Open circuits` 1 with `1 half-open`, and after about ten seconds `Requests` has grown (polling).
- Routes: four rows, the discovery route `Disabled`; filtering Source to FARP leaves one row and the caption says `1 route`.
- Clicking `/gw/users` lands on `/@bastion/routes/manual-%2Fusers`, shows `110 (entered as 10)` and the config-file line.
- The orders route shows `X-Api-Key` as `Redacted`, one target Open.
- Upstreams: five rows, `http://billing:9000` Unhealthy.
- `read_console_messages` with `onlyErrors: true` is empty.

Take one screenshot of the overview and one of the orders route as proof.

- [ ] **Step 4: Final gates and ledger**

Bastion: `go build ./... && go test -race ./...` and the lint gate. Record in the ledger: the commit ranges in both repos, and any ruling made along the way.
