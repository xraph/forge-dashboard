# Bastion Go Core (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every number the new bastion dashboard will show one that bastion actually measures: latency, cache lookups, circuit state, uptime and upstream counts, and let a half-open breaker recover.

**Architecture:** All changes are in the bastion Go repo. The proxy's `StatsCollector` gains latency recording with a bounded per-route sample window. The gateway snapshot reads cache counters from the response cache, counts upstreams by URL, drops stats for removed routes and measures uptime from Start. The proxy calls `RecordSuccess` on non-5xx responses and skips targets whose breaker is open when it selects one. `CBManager` gains snapshots and reset, surfaced as `Gateway.Circuits()` and `Gateway.ResetCircuit()`. `Target.Stats()` gives a copy without writing to the shared target.

**Tech Stack:** Go 1.26 (toolchain go1.26.6), forge v1.11.2, standard `testing` and `net/http/httptest`.

**Spec:** `forge-dashboard/docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md`, section "Slice 1: make the numbers real".

**Repo:** `/Users/rexraphael/Work/xraph/forgery/bastion`, branch `main`, work directly on it (no worktree). Every `git` and `go` command below runs from that directory.

## Global Constraints

- Forge pins: `github.com/xraph/forge v1.11.2` and `github.com/xraph/forge/extensions/discovery v1.11.2`.
- Gate per task: `go build ./... && go test -race ./...` clean.
- Lint gate: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. A shared lint cache reports phantom issues from other checkouts; always use a fresh one.
- Commit with `git commit --only <paths>`. Other sessions may have staged files in shared repos. Never `git add -A`, never `git checkout -- .`.
- Commit messages: no `Co-Authored-By` trailer and no Claude attribution of any kind. No em dashes in commit messages, comments or docs.
- Do not change proxying behaviour beyond what a task names. In particular 5xx responses still do not trip a breaker, the unused per-route breaker override stays unused, and no retry or response caching is wired in.
- JSON field names are camelCase, matching the existing tags in `types.go`.

## Review Focus

- A breaker left half-open by a burst of probes that all succeed must close; one that gets a failure must reopen. Pinned in Task 4.
- A 5xx response must neither trip nor heal a breaker, since that is today's behaviour and the spec leaves it. Pinned in Task 4 (`TestEngine_5xxLeavesBreakerAlone`).
- Every target on a route open-circuited must still produce a 503, never a panic or a request to an open target. Pinned in Task 4.
- Two routes pointing at the same upstream URL count as one upstream. Pinned in Task 3.
- Concurrent requests and snapshots must be race-free under `-race`. Pinned in Tasks 2 and 5.

## Findings this plan records but does not fix

These go into the spec in Task 6 and later into `bastion/MIGRATION.md`:

- `ResponseCache.Set` has no caller, so the cache never stores anything and every lookup misses. Slice 1 reports the real counters, which will show zero hits.
- `RetryPolicy.ShouldRetry` has no caller, so no request is ever retried. `RetryAttempts` stays zero because nothing retries, and the contract (slice 2) reports retries as not measured.
- `Target.Healthy` is a plain bool written by the health monitor and read unlocked by the load balancer and the snapshot. Changing that touches every route constructor and is left for a follow-up.
- The spec said to assign `Target.CircuitState` on every transition. That writes a plain field on shared targets from an async callback, which races the load balancer and can apply transitions out of order. Task 4 instead has the proxy ask the breaker directly and fills `CircuitState` only on copies. The effect the spec wanted (open targets skipped by selection) is the same.

---

### Task 1: Bump forge to v1.11.2

**Files:**
- Modify: `go.mod`, `go.sum`
- Modify: any file that fails to compile against v1.11.2 (unknown until built)

**Interfaces:**
- Consumes: nothing.
- Produces: a module on forge v1.11.2 that later tasks build on.

- [ ] **Step 1: Record the baseline**

Run: `go build ./... && go test ./... 2>&1 | tail -30`
Expected: builds; note any test already failing on v1.10.0 in your report so it is not blamed on the bump.

- [ ] **Step 2: Bump**

```bash
go get github.com/xraph/forge@v1.11.2 github.com/xraph/forge/extensions/discovery@v1.11.2
go mod tidy
```

- [ ] **Step 3: Build and test**

Run: `go build ./... && go test ./...`
Expected: PASS. If compilation fails, the fix is a mechanical API adjustment in the file named by the error. Compare against how `forgery/vault` (already on v1.11.2) calls the same forge API. Do not change behaviour to make it compile; if a fix needs a behaviour change, stop and report it.

- [ ] **Step 4: Commit**

```bash
git commit --only go.mod go.sum <any files fixed in step 3> -m "chore: bump forge to v1.11.2"
```

---

### Task 2: Record latency

**Files:**
- Create: `proxy/latency.go`
- Create: `proxy/stats_test.go`
- Modify: `proxy/engine.go` (StatsCollector fields, `Snapshot`, `modifyResponse`)
- Modify: `interfaces.go:69-78` (`StatsRecorder`)
- Modify: `types.go` (`GatewayStats`, `RouteStats`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `func (sc *StatsCollector) RecordLatency(routeID string, d time.Duration)`, added to `bastion.StatsRecorder`.
  - `GatewayStats.LatencySamples int \`json:"latencySamples"\`` and `RouteStats.LatencySamples int \`json:"latencySamples"\``: how many samples the p99 was computed from.
  - Constants `proxy.RouteLatencyWindow = 1024`, `proxy.GatewayLatencyWindow = 4096`.
  - Semantics, stated in the doc comments: `AvgLatencyMs` is over every recorded response since start. `P99LatencyMs` is nearest-rank p99 over the most recent `LatencySamples` responses (at most the window). Both cover HTTP requests that an upstream answered; cache hits, transport errors, WebSocket, SSE and gRPC are not included.

The window is exact within its span, so the p99 has no bucket error; the trade is that it describes recent traffic, which is what an operator looking at a dashboard wants. Memory is 8 KiB per route plus 32 KiB for the gateway.

- [ ] **Step 1: Write the failing tests**

`proxy/stats_test.go`:

```go
package proxy

import (
	"sync"
	"testing"
	"time"

	bastion "github.com/xraph/bastion"
)

func routes(ids ...string) []*bastion.Route {
	out := make([]*bastion.Route, 0, len(ids))
	for _, id := range ids {
		out = append(out, &bastion.Route{ID: id, Path: "/" + id})
	}
	return out
}

func TestStatsCollector_LatencyAverageAndP99(t *testing.T) {
	sc := NewStatsCollector()
	sc.RecordRequest("r1", "/r1")
	for i := 1; i <= 100; i++ {
		sc.RecordLatency("r1", time.Duration(i)*time.Millisecond)
	}

	s := sc.Snapshot(routes("r1"))

	if got, want := s.AvgLatencyMs, 50.5; got != want {
		t.Errorf("gateway avg = %v, want %v", got, want)
	}
	// Nearest rank: ceil(0.99 * 100) = 99th smallest = 99ms.
	if got, want := s.P99LatencyMs, 99.0; got != want {
		t.Errorf("gateway p99 = %v, want %v", got, want)
	}
	if s.LatencySamples != 100 {
		t.Errorf("gateway samples = %d, want 100", s.LatencySamples)
	}

	rs := s.RouteStats["r1"]
	if rs.AvgLatencyMs != 50.5 || rs.P99LatencyMs != 99 || rs.LatencySamples != 100 {
		t.Errorf("route stats = %+v", rs)
	}
}

func TestStatsCollector_P99WindowEvictsOldest(t *testing.T) {
	sc := NewStatsCollector()
	sc.RecordRequest("r1", "/r1")
	// A slow burst that falls out of the window...
	for i := 0; i < RouteLatencyWindow; i++ {
		sc.RecordLatency("r1", time.Second)
	}
	// ...then a full window of fast responses.
	for i := 0; i < RouteLatencyWindow; i++ {
		sc.RecordLatency("r1", time.Millisecond)
	}

	rs := sc.Snapshot(routes("r1")).RouteStats["r1"]
	if rs.P99LatencyMs != 1 {
		t.Errorf("p99 = %v, want 1 (slow burst should have left the window)", rs.P99LatencyMs)
	}
	if rs.LatencySamples != RouteLatencyWindow {
		t.Errorf("samples = %d, want %d", rs.LatencySamples, RouteLatencyWindow)
	}
	// The average is lifetime, so it still carries the slow burst.
	if rs.AvgLatencyMs <= 1 {
		t.Errorf("avg = %v, want lifetime average above 1ms", rs.AvgLatencyMs)
	}
}

func TestStatsCollector_NoSamplesMeansZeroAndZeroCount(t *testing.T) {
	sc := NewStatsCollector()
	sc.RecordRequest("r1", "/r1")

	s := sc.Snapshot(routes("r1"))
	if s.LatencySamples != 0 || s.P99LatencyMs != 0 || s.AvgLatencyMs != 0 {
		t.Errorf("empty latency = %+v", s)
	}
}

func TestStatsCollector_ConcurrentRecordAndSnapshot(t *testing.T) {
	sc := NewStatsCollector()
	rs := routes("r1", "r2")

	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			id := rs[w%2].ID
			for i := 0; i < 500; i++ {
				sc.RecordRequest(id, "/"+id)
				sc.RecordLatency(id, time.Duration(i)*time.Microsecond)
				sc.RecordError(id)
			}
		}(w)
	}
	for i := 0; i < 50; i++ {
		_ = sc.Snapshot(rs)
	}
	wg.Wait()

	s := sc.Snapshot(rs)
	if s.TotalRequests != 4000 {
		t.Errorf("total requests = %d, want 4000", s.TotalRequests)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test -race ./proxy/ -run 'TestStatsCollector' -v`
Expected: FAIL to compile, `sc.RecordLatency undefined` and `LatencySamples` unknown.

- [ ] **Step 3: Implement**

`proxy/latency.go`:

```go
package proxy

import (
	"math"
	"slices"
	"time"
)

// RouteLatencyWindow is how many recent responses a route's p99 covers.
const RouteLatencyWindow = 1024

// GatewayLatencyWindow is how many recent responses the gateway-wide p99
// covers.
const GatewayLatencyWindow = 4096

// latencyTrack keeps a lifetime average and a fixed window of recent samples
// for an exact nearest-rank p99. It is not safe for concurrent use; the
// StatsCollector's lock guards it.
type latencyTrack struct {
	sumNs int64
	count int64
	ring  []int64
	next  int
	full  bool
}

func newLatencyTrack(window int) *latencyTrack {
	return &latencyTrack{ring: make([]int64, window)}
}

func (lt *latencyTrack) record(d time.Duration) {
	ns := d.Nanoseconds()
	lt.sumNs += ns
	lt.count++
	lt.ring[lt.next] = ns
	lt.next++
	if lt.next == len(lt.ring) {
		lt.next = 0
		lt.full = true
	}
}

// samples reports how many values the window currently holds.
func (lt *latencyTrack) samples() int {
	if lt.full {
		return len(lt.ring)
	}
	return lt.next
}

// avgMs is the lifetime mean in milliseconds, 0 with no samples.
func (lt *latencyTrack) avgMs() float64 {
	if lt.count == 0 {
		return 0
	}
	return float64(lt.sumNs) / float64(lt.count) / 1e6
}

// p99Ms is the nearest-rank 99th percentile of the window in milliseconds,
// 0 with no samples.
func (lt *latencyTrack) p99Ms() float64 {
	n := lt.samples()
	if n == 0 {
		return 0
	}
	sorted := slices.Clone(lt.ring[:n])
	slices.Sort(sorted)
	rank := int(math.Ceil(0.99 * float64(n)))
	return float64(sorted[rank-1]) / 1e6
}
```

In `proxy/engine.go`, add to `StatsCollector`:

```go
	latency      *latencyTrack
	routeLatency map[string]*latencyTrack
```

initialise both in `NewStatsCollector`:

```go
		latency:      newLatencyTrack(GatewayLatencyWindow),
		routeLatency: make(map[string]*latencyTrack),
```

add the method:

```go
// RecordLatency records how long an upstream took to answer a proxied HTTP
// request. Cache hits, transport errors and streaming protocols are not
// recorded, so latency describes answered upstream requests only.
func (sc *StatsCollector) RecordLatency(routeID string, d time.Duration) {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	sc.latency.record(d)

	lt, ok := sc.routeLatency[routeID]
	if !ok {
		lt = newLatencyTrack(RouteLatencyWindow)
		sc.routeLatency[routeID] = lt
	}
	lt.record(d)
}
```

`Snapshot` takes the read lock and `p99Ms` does not mutate, so the existing `RLock` is correct. In `Snapshot`, set on `stats`:

```go
		AvgLatencyMs:   sc.latency.avgMs(),
		P99LatencyMs:   sc.latency.p99Ms(),
		LatencySamples: sc.latency.samples(),
```

and inside the route-stats copy loop, replace `AvgLatencyMs: v.AvgLatencyMs,` with values from the track:

```go
		rs := &bastion.RouteStats{
			RouteID:       v.RouteID,
			Path:          v.Path,
			TotalRequests: v.TotalRequests,
			TotalErrors:   v.TotalErrors,
			CacheHits:     v.CacheHits,
			CacheMisses:   v.CacheMisses,
			RateLimited:   v.RateLimited,
		}
		if lt, ok := sc.routeLatency[k]; ok {
			rs.AvgLatencyMs = lt.avgMs()
			rs.P99LatencyMs = lt.p99Ms()
			rs.LatencySamples = lt.samples()
		}
		stats.RouteStats[k] = rs
```

In `types.go` add after `P99LatencyMs` in `GatewayStats`:

```go
	// LatencySamples is how many recent responses P99LatencyMs covers.
	// AvgLatencyMs covers every response since start.
	LatencySamples int `json:"latencySamples"`
```

and the same field after `P99LatencyMs` in `RouteStats`. Update the doc comments on both `AvgLatencyMs` fields to say "mean over every answered upstream request since start" and on both `P99LatencyMs` fields "nearest-rank p99 over the most recent LatencySamples responses".

In `interfaces.go`, add to `StatsRecorder`:

```go
	RecordLatency(routeID string, d time.Duration)
```

In `modifyResponse` (`proxy/engine.go`), right after `target.RecordRequest(latency, isError)`:

```go
		pe.stats.RecordLatency(route.ID, latency)
```

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./proxy/ -run 'TestStatsCollector' -v`
Expected: PASS, no race report.

- [ ] **Step 5: Full gate**

Run: `go build ./... && go test -race ./...`
Expected: PASS. A compile error elsewhere means another `StatsRecorder` implementer exists (a test mock); add a no-op `RecordLatency` to it.

- [ ] **Step 6: Commit**

```bash
git commit --only proxy/latency.go proxy/stats_test.go proxy/engine.go interfaces.go types.go -m "feat(stats): record upstream latency with a lifetime mean and a windowed p99"
```

---

### Task 3: Snapshot counts that mean something

**Files:**
- Modify: `proxy/engine.go` (`StatsCollector.Snapshot`)
- Modify: `extension.go` (`Gateway` struct, `Start`, `Snapshot`)
- Modify: `proxy/stats_test.go`
- Create: `snapshot_test.go` (root package)

**Interfaces:**
- Consumes: `StatsCollector.Snapshot` from Task 2.
- Produces:
  - `StatsCollector.Snapshot(routes)` returns `RouteStats` only for route ids present in `routes`, and counts `TotalUpstreams`/`HealthyUpstreams` by distinct target URL. A URL is healthy only if every target entry with that URL is healthy.
  - `Gateway.Snapshot()` sets `StartedAt` and `Uptime` from the moment `Start` completed (zero `Uptime` before Start), and `CacheHits`/`CacheMisses` from `ResponseCache.Stats()`.

- [ ] **Step 1: Write the failing tests**

Append to `proxy/stats_test.go`:

```go
func TestStatsCollector_DropsStatsForRemovedRoutes(t *testing.T) {
	sc := NewStatsCollector()
	sc.RecordRequest("gone", "/gone")
	sc.RecordRequest("live", "/live")

	s := sc.Snapshot(routes("live"))
	if _, ok := s.RouteStats["gone"]; ok {
		t.Error("stats for a removed route were reported")
	}
	if _, ok := s.RouteStats["live"]; !ok {
		t.Error("stats for a live route are missing")
	}
	// Gateway totals still include traffic the removed route served.
	if s.TotalRequests != 2 {
		t.Errorf("total requests = %d, want 2", s.TotalRequests)
	}
}

func TestStatsCollector_CountsUpstreamsByURL(t *testing.T) {
	sc := NewStatsCollector()
	shared := "http://orders:8080"
	rs := []*bastion.Route{
		{ID: "a", Targets: []*bastion.Target{
			{ID: "a/0", URL: shared, Healthy: true},
			{ID: "a/1", URL: "http://users:8080", Healthy: true},
		}},
		{ID: "b", Targets: []*bastion.Target{
			{ID: "b/0", URL: shared, Healthy: false},
		}},
	}

	s := sc.Snapshot(rs)
	if s.TotalUpstreams != 2 {
		t.Errorf("total upstreams = %d, want 2 distinct URLs", s.TotalUpstreams)
	}
	// orders is unhealthy on route b, so it is not counted healthy.
	if s.HealthyUpstreams != 1 {
		t.Errorf("healthy upstreams = %d, want 1", s.HealthyUpstreams)
	}
}
```

`snapshot_test.go`:

```go
package bastion

import "testing"

func TestGateway_SnapshotUptimeIsZeroBeforeStart(t *testing.T) {
	gw := New()
	s := gw.Snapshot()
	if s.Uptime != 0 || !s.StartedAt.IsZero() {
		t.Errorf("before Start: uptime=%d startedAt=%v, want zero", s.Uptime, s.StartedAt)
	}
}
```

Check `gateway_test.go:11` (`TestNew`) for the exact constructor and its arguments before writing this; use whatever it uses. If `Snapshot` returns early because `stats` is nil on an unregistered gateway, the test still holds, and that is fine: it pins the "no uptime before Start" rule either way.

- [ ] **Step 2: Run to verify they fail**

Run: `go test -race ./proxy/ ./ -run 'DropsStats|CountsUpstreams|SnapshotUptime' -v`
Expected: `DropsStats` and `CountsUpstreams` FAIL (removed route reported; totals 3 and 2). `SnapshotUptime` may already pass; that is expected, it guards Step 3.

- [ ] **Step 3: Implement**

In `StatsCollector.Snapshot`, build a set of live ids first and skip others in the copy loop:

```go
	live := make(map[string]struct{}, len(routes))
	for _, r := range routes {
		live[r.ID] = struct{}{}
	}

	for k, v := range sc.routeStats {
		if _, ok := live[k]; !ok {
			continue
		}
		// ... existing copy, as changed in Task 2
	}
```

Replace the upstream counting block:

```go
	// Count upstreams by URL. Two routes proxying to one service are one
	// upstream. A URL counts healthy only if every entry for it is healthy.
	urlHealthy := make(map[string]bool)
	for _, route := range routes {
		for _, t := range route.Targets {
			prev, seen := urlHealthy[t.URL]
			urlHealthy[t.URL] = t.Healthy && (!seen || prev)
		}
	}
	stats.TotalUpstreams = len(urlHealthy)
	for _, ok := range urlHealthy {
		if ok {
			stats.HealthyUpstreams++
		}
	}
```

In `extension.go`, add to the `Gateway` struct's lifecycle block:

```go
	startedAt atomic.Int64 // unix nanoseconds when Start completed; 0 before
```

In `Start`, immediately before `e.MarkStarted()`:

```go
	e.startedAt.Store(time.Now().UnixNano())
```

Replace `Gateway.Snapshot`:

```go
// Snapshot returns current gateway statistics. Uptime counts from the
// moment Start completed and is zero before it. Cache counters come from
// the response cache, so they count real lookups only.
func (e *Gateway) Snapshot() *GatewayStats {
	if e.stats == nil || e.routeManager == nil {
		return &GatewayStats{}
	}

	s := e.stats.Snapshot(e.routeManager.ListRoutes())

	s.StartedAt = time.Time{}
	s.Uptime = 0
	if ns := e.startedAt.Load(); ns != 0 {
		s.StartedAt = time.Unix(0, ns)
		s.Uptime = int64(time.Since(s.StartedAt).Seconds())
	}

	if e.respCache != nil {
		cs := e.respCache.Stats()
		s.CacheHits = cs.Hits()
		s.CacheMisses = cs.Misses()
	}

	return s
}
```

`time` and `sync/atomic` are already imported in `extension.go` (the struct uses `atomic.Bool`); confirm and add if not.

- [ ] **Step 4: Run to verify they pass**

Run: `go test -race ./proxy/ ./ -run 'DropsStats|CountsUpstreams|SnapshotUptime' -v`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `go build ./... && go test -race ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit --only proxy/engine.go proxy/stats_test.go extension.go snapshot_test.go -m "fix(stats): count upstreams by URL, uptime from Start, real cache lookups"
```

---

### Task 4: Circuits that report and recover

**Files:**
- Modify: `resilience/circuit_breaker.go` (breaker `Snapshot`, manager `Snapshots` and `Reset`)
- Modify: `resilience/circuit_breaker_test.go`
- Modify: `interfaces.go:53-59` (`CircuitControl`)
- Modify: `proxy/engine.go` (`modifyResponse`, `selectTarget`)
- Create: `proxy/engine_circuit_test.go`
- Modify: `extension.go` (`Circuits`, `ResetCircuit`, `ErrCircuitNotFound`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `func (cb *CircuitBreaker) Snapshot() bastion.CircuitBreakerSnapshot`. `State` uses the same reset-timeout rule as `State()`, so an open breaker past its timeout reports `half_open`. `UpdatedAt` is the time of the call.
  - `func (m *CBManager) Snapshots() []bastion.CircuitBreakerSnapshot`, sorted by `TargetID`.
  - `func (m *CBManager) Reset(targetID string) bool`, false when no breaker exists for the id.
  - Both added to `bastion.CircuitControl`.
  - `var ErrCircuitNotFound = errors.New("bastion: no circuit breaker for target")`.
  - `func (e *Gateway) Circuits() []CircuitBreakerSnapshot` (nil when circuit control is not wired).
  - `func (e *Gateway) ResetCircuit(targetID string) error` returning `ErrCircuitNotFound` for an unknown id.
  - Proxy behaviour: a response with status below 500 calls `RecordSuccess`. A 5xx calls neither `RecordSuccess` nor `RecordFailure`. Target selection skips targets whose breaker state is `open`.

`RecordSuccess` on a closed breaker resets its failure count. That makes the threshold count consecutive transport failures, which is what the breaker's own code intends and what `FailureThreshold` reads as. Say so in the commit message.

- [ ] **Step 1: Write the failing breaker tests**

Append to `resilience/circuit_breaker_test.go`:

```go
func recoverCfg() bastion.CircuitBreakerConfig {
	return bastion.CircuitBreakerConfig{
		Enabled:          true,
		FailureThreshold: 2,
		ResetTimeout:     10 * time.Millisecond,
		HalfOpenMax:      2,
	}
}

func TestCircuitBreaker_HalfOpenClosesAfterSuccessfulProbes(t *testing.T) {
	cb := NewCircuitBreaker("t1", recoverCfg())
	cb.RecordFailure()
	cb.RecordFailure()
	if cb.State() != bastion.CircuitOpen {
		t.Fatalf("state = %s, want open", cb.State())
	}

	time.Sleep(20 * time.Millisecond)

	for i := 0; i < 2; i++ {
		if !cb.Allow() {
			t.Fatalf("probe %d refused", i)
		}
		cb.RecordSuccess()
	}
	if cb.State() != bastion.CircuitClosed {
		t.Errorf("state = %s, want closed after %d successful probes", cb.State(), 2)
	}
	if !cb.Allow() {
		t.Error("closed breaker refused a request")
	}
}

func TestCircuitBreaker_HalfOpenFailureReopens(t *testing.T) {
	cb := NewCircuitBreaker("t1", recoverCfg())
	cb.RecordFailure()
	cb.RecordFailure()
	time.Sleep(20 * time.Millisecond)

	if !cb.Allow() {
		t.Fatal("first probe refused")
	}
	cb.RecordFailure()

	snap := cb.Snapshot()
	if snap.State != bastion.CircuitOpen {
		t.Errorf("state = %s, want open", snap.State)
	}
	if snap.LastFailure.IsZero() {
		t.Error("last failure not recorded")
	}
}

func TestCBManager_SnapshotsAndReset(t *testing.T) {
	m := NewCBManager(recoverCfg())
	m.Get("b").RecordFailure()
	m.Get("b").RecordFailure()
	m.Get("a")

	snaps := m.Snapshots()
	if len(snaps) != 2 || snaps[0].TargetID != "a" || snaps[1].TargetID != "b" {
		t.Fatalf("snapshots = %+v, want a then b", snaps)
	}
	if snaps[1].State != bastion.CircuitOpen || snaps[1].FailureCount != 2 {
		t.Errorf("b = %+v, want open with 2 failures", snaps[1])
	}

	if !m.Reset("b") {
		t.Fatal("reset of a known breaker returned false")
	}
	if got := m.Get("b").State(); got != bastion.CircuitClosed {
		t.Errorf("after reset state = %s, want closed", got)
	}
	if m.Reset("nope") {
		t.Error("reset of an unknown breaker returned true")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test -race ./resilience/ -run 'HalfOpen|SnapshotsAndReset' -v`
Expected: FAIL to compile (`cb.Snapshot`, `m.Snapshots`, `m.Reset` undefined). `HalfOpenClosesAfterSuccessfulProbes` would pass on its own, since the breaker logic is sound and only its caller never calls `RecordSuccess`; it pins that the proxy change in Step 7 has something correct to call.

- [ ] **Step 3: Implement the breaker side**

In `resilience/circuit_breaker.go`:

```go
// Snapshot returns a copy of the breaker's state. An open breaker whose
// reset timeout has elapsed reports half_open, matching State().
func (cb *CircuitBreaker) Snapshot() bastion.CircuitBreakerSnapshot {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	state := cb.state
	if state == bastion.CircuitOpen && time.Since(cb.lastStateChange) > cb.config.ResetTimeout {
		state = bastion.CircuitHalfOpen
	}

	return bastion.CircuitBreakerSnapshot{
		TargetID:        cb.targetID,
		State:           state,
		FailureCount:    cb.failureCount,
		SuccessCount:    cb.successCount,
		LastFailure:     cb.lastFailure,
		LastStateChange: cb.lastStateChange,
		UpdatedAt:       time.Now(),
	}
}

// Snapshots returns every breaker's state, sorted by target id.
func (m *CBManager) Snapshots() []bastion.CircuitBreakerSnapshot {
	m.mu.RLock()
	breakers := make([]*CircuitBreaker, 0, len(m.breakers))
	for _, cb := range m.breakers {
		breakers = append(breakers, cb)
	}
	m.mu.RUnlock()

	out := make([]bastion.CircuitBreakerSnapshot, 0, len(breakers))
	for _, cb := range breakers {
		out = append(out, cb.Snapshot())
	}
	slices.SortFunc(out, func(a, b bastion.CircuitBreakerSnapshot) int {
		return strings.Compare(a.TargetID, b.TargetID)
	})

	return out
}

// Reset closes the breaker for targetID. It reports false when no breaker
// exists for that id, so a caller can tell a reset from a typo.
func (m *CBManager) Reset(targetID string) bool {
	m.mu.RLock()
	cb, ok := m.breakers[targetID]
	m.mu.RUnlock()

	if !ok {
		return false
	}

	cb.Reset()

	return true
}
```

Add `"slices"` and `"strings"` to the imports. Add to `CircuitControl` in `interfaces.go`:

```go
	Snapshots() []CircuitBreakerSnapshot
	Reset(targetID string) bool
```

- [ ] **Step 4: Run the breaker tests**

Run: `go test -race ./resilience/ -v`
Expected: PASS. Then `go build ./...`; a failure names another `CircuitControl` implementer (a test mock). Give it both methods returning `nil` and `false`.

- [ ] **Step 5: Write the failing proxy tests**

`proxy/engine_circuit_test.go`:

```go
package proxy_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/xraph/forge"

	bastion "github.com/xraph/bastion"
	"github.com/xraph/bastion/health"
	"github.com/xraph/bastion/proxy"
	"github.com/xraph/bastion/resilience"
	"github.com/xraph/bastion/routing"
)

type rig struct {
	engine *proxy.Engine
	cbm    *resilience.CBManager
	stats  *proxy.StatsCollector
}

func newRig(t *testing.T, targets ...*bastion.Target) rig {
	t.Helper()

	cfg := bastion.Config{}
	cbCfg := bastion.CircuitBreakerConfig{
		Enabled:          true,
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		HalfOpenMax:      1,
	}
	logger := forge.NewNoopLogger()
	rm := routing.NewManager()
	if err := rm.AddRoute(&bastion.Route{
		ID:       "r1",
		Path:     "/ok",
		Methods:  []string{http.MethodGet},
		Targets:  targets,
		Protocol: bastion.ProtocolHTTP,
		Source:   bastion.SourceManual,
		Enabled:  true,
	}); err != nil {
		t.Fatal(err)
	}

	cbm := resilience.NewCBManager(cbCfg)
	stats := proxy.NewStatsCollector()
	e := proxy.NewEngine(cfg, logger, rm, health.NewMonitor(health.Config{}, logger),
		cbm, bastion.NewRateLimiter(bastion.RateLimitConfig{}), stats,
		bastion.NewHookEngine(), routing.NewLoadBalancer(bastion.LBRoundRobin))

	return rig{engine: e, cbm: cbm, stats: stats}
}

func upstream(t *testing.T, status int) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	t.Cleanup(s.Close)
	return s
}

func get(r rig) int {
	rec := httptest.NewRecorder()
	r.engine.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ok", nil))
	return rec.Code
}

func TestEngine_SkipsTargetWithOpenCircuit(t *testing.T) {
	good := upstream(t, http.StatusOK)
	r := newRig(t,
		&bastion.Target{ID: "bad", URL: "http://127.0.0.1:1", Weight: 1, Healthy: true},
		&bastion.Target{ID: "good", URL: good.URL, Weight: 1, Healthy: true},
	)
	r.cbm.Get("bad").RecordFailure() // threshold 1: now open

	for i := 0; i < 4; i++ {
		if code := get(r); code != http.StatusOK {
			t.Fatalf("request %d = %d, want 200 from the target whose circuit is closed", i, code)
		}
	}
}

func TestEngine_AllCircuitsOpenIs503(t *testing.T) {
	r := newRig(t, &bastion.Target{ID: "bad", URL: "http://127.0.0.1:1", Weight: 1, Healthy: true})
	r.cbm.Get("bad").RecordFailure()

	if code := get(r); code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", code)
	}
}

func TestEngine_SuccessResetsConsecutiveFailures(t *testing.T) {
	good := upstream(t, http.StatusOK)
	r := newRig(t, &bastion.Target{ID: "t", URL: good.URL, Weight: 1, Healthy: true})

	if code := get(r); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	snaps := r.cbm.Snapshots()
	if len(snaps) != 1 || snaps[0].State != bastion.CircuitClosed || snaps[0].FailureCount != 0 {
		t.Errorf("snapshots = %+v, want one closed breaker with no failures", snaps)
	}
}

func TestEngine_5xxLeavesBreakerAlone(t *testing.T) {
	bad := upstream(t, http.StatusInternalServerError)
	r := newRig(t, &bastion.Target{ID: "t", URL: bad.URL, Weight: 1, Healthy: true})

	for i := 0; i < 3; i++ {
		if code := get(r); code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want the upstream's 500 passed through", code)
		}
	}
	if s := r.cbm.Snapshots()[0]; s.State != bastion.CircuitClosed || s.FailureCount != 0 {
		t.Errorf("breaker = %+v, want closed and untouched by 5xx", s)
	}
}

func TestEngine_RecordsLatencyForAnsweredRequests(t *testing.T) {
	good := upstream(t, http.StatusOK)
	r := newRig(t, &bastion.Target{ID: "t", URL: good.URL, Weight: 1, Healthy: true})
	get(r)

	rs := r.stats.Snapshot([]*bastion.Route{{ID: "r1"}}).RouteStats["r1"]
	if rs == nil || rs.LatencySamples != 1 {
		t.Errorf("route stats = %+v, want one latency sample", rs)
	}
}
```

Check before running: the exact constant names `bastion.LBRoundRobin`, `bastion.ProtocolHTTP` and `bastion.SourceManual` (grep `types.go`), and that `health.Monitor.RecordPassiveSuccess` tolerates a target that was never registered (read `health/monitor.go:98-140`). If it does not, register the targets with `hm.Register("r1", target)` in `newRig`. If `forge.NewNoopLogger` is not exported at v1.11.2, use `log.NewNoopLogger()` from `github.com/xraph/go-utils/log`.

- [ ] **Step 6: Run to verify they fail**

Run: `go test -race ./proxy/ -run 'TestEngine_' -v`
Expected: `SkipsTargetWithOpenCircuit` FAILS (round robin picks `bad` and answers 503). `SuccessResetsConsecutiveFailures` passes trivially since no failure was recorded; `5xxLeavesBreakerAlone`, `AllCircuitsOpenIs503` and `RecordsLatency` pass and guard Step 7.

- [ ] **Step 7: Implement the proxy side**

In `modifyResponse`, change the error branch:

```go
		if isError {
			pe.stats.RecordError(route.ID)
			pe.hm.RecordPassiveFailure(target.ID)
		} else {
			// A 5xx leaves the breaker alone: only transport errors trip it
			// (see errorHandler). An answer below 500 closes a half-open
			// breaker and resets a closed one's consecutive failure count.
			pe.cbm.Get(target.ID).RecordSuccess()
			pe.hm.RecordPassiveSuccess(target.ID)
		}
```

In `selectTarget`, filter open breakers before the load balancer:

```go
func (pe *Engine) selectTarget(r *http.Request, route *bastion.Route) *bastion.Target {
	candidates := pe.closedCircuits(route.Targets)
	if len(candidates) == 0 {
		return nil
	}

	// ... existing consistent-hash key logic unchanged ...

	return pe.lb.Select(candidates, key)
}

// closedCircuits drops targets whose breaker is open. A breaker past its
// reset timeout reports half_open and stays eligible, so probes still reach
// it. The proxy asks the breaker rather than reading Target.CircuitState,
// which nothing assigns on live targets.
func (pe *Engine) closedCircuits(targets []*bastion.Target) []*bastion.Target {
	out := make([]*bastion.Target, 0, len(targets))
	for _, t := range targets {
		if pe.cbm.Get(t.ID).State() != bastion.CircuitOpen {
			out = append(out, t)
		}
	}
	return out
}
```

With every target open, `selectTarget` returns nil and `ServeHTTP` answers 503 "no healthy upstream". The later `cb.Allow()` check stays, since it is what moves a half-open breaker's probe count.

`selectTarget` is shared with `proxyWebSocket`, SSE and gRPC, so they also skip open targets. That is intended: they never record to the breaker, so their targets only open through HTTP transport errors.

- [ ] **Step 8: Add the gateway surface**

In `extension.go`:

```go
// ErrCircuitNotFound is returned by ResetCircuit for a target id with no
// breaker. Breakers are created on a target's first proxied request, so a
// target that has never served traffic has none.
var ErrCircuitNotFound = errors.New("bastion: no circuit breaker for target")

// Circuits returns a snapshot of every circuit breaker, sorted by target id.
// It is nil when circuit control is not wired.
func (e *Gateway) Circuits() []CircuitBreakerSnapshot {
	if e.cbManager == nil {
		return nil
	}

	return e.cbManager.Snapshots()
}

// ResetCircuit closes the breaker for targetID.
func (e *Gateway) ResetCircuit(targetID string) error {
	if e.cbManager == nil || !e.cbManager.Reset(targetID) {
		return ErrCircuitNotFound
	}

	return nil
}
```

Add `"errors"` to imports if missing. Append to `snapshot_test.go`:

```go
func TestGateway_ResetCircuitUnknownTarget(t *testing.T) {
	gw := New()
	if err := gw.ResetCircuit("nope"); !errors.Is(err, ErrCircuitNotFound) {
		t.Errorf("err = %v, want ErrCircuitNotFound", err)
	}
	if got := gw.Circuits(); got != nil {
		t.Errorf("circuits = %v, want nil with no circuit control", got)
	}
}
```

(import `"errors"`; use the same constructor as Task 3's test.)

- [ ] **Step 9: Run everything**

Run: `go test -race ./proxy/ ./resilience/ ./ -v -run 'TestEngine_|HalfOpen|SnapshotsAndReset|ResetCircuit'` then `go build ./... && go test -race ./...`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git commit --only resilience/circuit_breaker.go resilience/circuit_breaker_test.go interfaces.go proxy/engine.go proxy/engine_circuit_test.go extension.go snapshot_test.go -m "fix(resilience): let half-open breakers recover and skip open targets

The proxy never called RecordSuccess, so a half-open breaker admitted its
probes and then refused every request until a restart. It now records a
success for any answer below 500. On a closed breaker that resets the
failure count, so FailureThreshold counts consecutive transport failures.
A 5xx still neither trips nor heals a breaker.

Target selection now skips targets whose breaker is open, asking the
breaker directly. The load balancer's CircuitState filter read a field
nothing assigned.

CBManager gains Snapshots and Reset, surfaced as Gateway.Circuits and
Gateway.ResetCircuit."
```

---

### Task 5: A target copy that does not write

**Files:**
- Modify: `types.go` (new `TargetStats`, `Target.Stats`)
- Create: `target_stats_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:

```go
// TargetStats is a point-in-time copy of a target's counters.
type TargetStats struct {
	ActiveConns   int64   `json:"activeConns"`
	TotalRequests int64   `json:"totalRequests"`
	TotalErrors   int64   `json:"totalErrors"`
	AvgLatencyMs  float64 `json:"avgLatencyMs"`
}

// Stats reads the target's counters without writing to the target, unlike
// Snapshot, which fills the exported fields in place and races the proxy.
func (t *Target) Stats() TargetStats
```

Slice 2's handlers use `Stats()` and never `Snapshot()`.

- [ ] **Step 1: Write the failing test**

`target_stats_test.go`:

```go
package bastion

import (
	"sync"
	"testing"
	"time"
)

func TestTarget_StatsDoesNotWriteAndIsRaceFree(t *testing.T) {
	tg := &Target{ID: "t", URL: "http://x"}

	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				tg.IncrConns()
				tg.RecordRequest(2*time.Millisecond, i%10 == 0)
				tg.DecrConns()
			}
		}()
	}
	for i := 0; i < 100; i++ {
		_ = tg.Stats()
	}
	wg.Wait()

	s := tg.Stats()
	if s.TotalRequests != 4000 || s.TotalErrors != 400 || s.ActiveConns != 0 {
		t.Errorf("stats = %+v", s)
	}
	if s.AvgLatencyMs != 2 {
		t.Errorf("avg = %v, want 2", s.AvgLatencyMs)
	}
	if tg.TotalRequests != 0 {
		t.Error("Stats wrote to the target's exported fields")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test -race ./ -run TestTarget_Stats -v`
Expected: FAIL to compile, `tg.Stats undefined`.

- [ ] **Step 3: Implement**

In `types.go`, after `Snapshot`:

```go
func (t *Target) Stats() TargetStats {
	s := TargetStats{
		ActiveConns:   t.activeConns.Load(),
		TotalRequests: t.totalReqs.Load(),
		TotalErrors:   t.totalErrs.Load(),
	}
	if s.TotalRequests > 0 {
		s.AvgLatencyMs = float64(t.latencySum.Load()) / float64(s.TotalRequests) / 1e6
	}
	return s
}
```

plus the `TargetStats` type from Interfaces above. Add to `Snapshot`'s doc comment: "Snapshot writes to the shared target and races the proxy; new code uses Stats."

- [ ] **Step 4: Run, gate, commit**

Run: `go test -race ./ -run TestTarget_Stats -v && go build ./... && go test -race ./...`
Expected: PASS.

```bash
git commit --only types.go target_stats_test.go -m "feat: read a target's counters without writing to it"
```

---

### Task 6: Lint, and correct the spec

**Files:**
- Modify: `/Users/rexraphael/Work/xraph/forge-dashboard/docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md`
- Modify: any bastion file the linter flags in code this plan added

- [ ] **Step 1: Lint**

Run: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: no issues in files this plan touched. Fix any that are, and commit with `git commit --only <files> -m "chore: lint"`. Issues in untouched files are pre-existing; list them in your report and leave them.

- [ ] **Step 2: Correct the spec**

In the spec's "Slice 1: make the numbers real" section, replace the circuit state bullet's first two sentences ("Call `RecordSuccess` ... starts working.") with:

```
- Call `RecordSuccess` on a proxied answer below 500. Target selection asks
  each target's breaker and skips open ones; `Target.CircuitState` is filled
  only on copies, because assigning it on live targets from the breaker's
  async callback races the load balancer and can apply transitions out of
  order. Add `Gateway.Circuits()` returning copied snapshots (target id,
  state, failure count, last failure, last change) and
  `Gateway.ResetCircuit(targetID)`.
```

In the same section replace the cache and retry bullet with:

```
- Cache counters come from the response cache's own hit and miss counts.
  `ResponseCache.Set` has no caller, so the cache never stores a response
  and every lookup misses; the counters will say so. `ShouldRetry` has no
  caller either, so nothing is retried. Neither is wired in under this
  migration. Both go in `MIGRATION.md`, and the contract reports retries as
  not measured.
```

Under "Open, and recorded in `MIGRATION.md`" add three bullets:

```
- The response cache never stores anything: `ResponseCache.Set` has no caller.
- Retries never happen: `RetryPolicy.ShouldRetry` has no caller.
- `Target.Healthy` is a plain bool read without a lock by the load balancer.
```

Scan the edited spec for em dashes (`grep -c "—"` must print 0).

- [ ] **Step 3: Commit the spec (forge-dashboard repo)**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git commit --only docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md -m "docs(bastion): record what slice 1 found about cache, retry and circuit state"
```

- [ ] **Step 4: Final gate in bastion**

Run: `go build ./... && go test -race ./...` and `git log --oneline -8`
Expected: PASS, and the commits from Tasks 1 to 6 on `main`, unpushed.
