# Chronicle Dashboard Migration, Plan A: the Go contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Chronicle a contract contributor the React shell can talk to, declaring 29 intents over its existing domain packages, plus the one domain addition those intents need.

**Architecture:** Three pieces in sequence. Bump `forge` so the contract packages resolve. Add day and hour bucketing to `audit.Aggregate` across four backends, because nothing else in the library can answer "volume over time" and a gap in that series is an audit finding. Then build `extension/contract/`, copying the shape of `authsome/extension/contract/`: an embedded manifest, a `Register` that wires handlers into the dispatcher, and handler files grouped by domain.

**Tech Stack:** Go 1.26, `github.com/xraph/forge` v1.11.1+, `forge/extensions/dashboard/contract` and its `dispatcher` and `loader` subpackages, grove for sqlite and postgres, the mongo and redis drivers already vendored.

**Spec:** `docs/superpowers/specs/2026-09-23-chronicle-dashboard-migration-design.md` (in the `forge-dashboard` repo; this plan's work happens in `/Users/rexraphael/Work/xraph/forgery/chronicle`)

**Plans B and C follow this one.** B builds `packages/plugin-chronicle` and the `enabled` option on `useQuery`. C writes `MIGRATION.md` and deletes `dashboard/`. B is deliberately not written yet: its page code names the exact DTO field names this plan produces, and writing it first invites a type mismatch nobody catches until runtime.

## Global Constraints

- All work in this plan happens in `/Users/rexraphael/Work/xraph/forgery/chronicle`. Nothing here touches `forge-dashboard`.
- Contributor name is exactly `chronicle`. It is the join key to the React plugin and a typo makes the plugin render nothing, silently.
- Wire field names are camelCase (`streamId`, `headSeq`, `fromSeq`). Go domain types stay snake_case. The contract layer projects between them.
- No request DTO carries `appId` or `tenantId`. Scope comes from `Principal.Claims` only.
- Intent version is `1` everywhere in this plan.
- Every command declares `invalidates` in the manifest, naming the query intents its write affects.
- Paging is offset-based: `limit` and `offset` in, `total` and `hasMore` out. No cursors.
- Optional update fields are pointers (`*string`, `*bool`), so "leave alone" is distinguishable from "set to empty".
- Run `go build ./... && go test ./...` before every commit, not a partial run.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has its test named in the task that owns the code.

1. **A Principal with no `app_id` claim.** An empty `AppID` matches every app in every store query, so a missing claim must be refused rather than defaulted. Pinned in Task 7.
2. **A detail intent asked for another tenant's record by ID.** Detail handlers bypass every list filter, so each must re-check ownership after fetching. Pinned in Tasks 9, 10, 12, 13, 14.
3. **A time bucket in a period where nothing was recorded.** The bucket must be absent from the result rather than present with count zero, and the UI reads that absence as the finding. Pinned in Tasks 3 through 6.
4. **A verify request against a stream the caller does not own.** `verify.run` resolves the stream from scope, so this is really "the scope resolves to a stream that does not exist yet". It must answer "no chain yet", not a nil dereference. Pinned in Task 8.
5. **A checkpoint intent on a store that refuses checkpoints.** Redis returns `checkpoint.ErrUnsupported` for every call, and that is "no opinion", not an error page. Pinned in Task 9.

---

## File Structure

**Created in `extension/contract/`:**

| File | Responsibility |
|---|---|
| `manifest.yaml` | Declares the contributor, its 29 intents, kinds, capabilities and invalidations |
| `contract.go` | `Deps`, `Register`, manifest load and validate |
| `scope.go` | `scopeFromPrincipal` and `inScope`. The security boundary, alone in its own file |
| `project.go` | Domain type to wire DTO projections, shared across handler files |
| `handlers_streams.go` | `streams.mine`, `streams.list` |
| `handlers_verify.go` | `verify.run`, `verify.event` |
| `handlers_checkpoints.go` | `checkpoints.list`, `.detail`, `.take` |
| `handlers_events.go` | `events.list`, `.detail`, `.aggregate`, `.byUser` |
| `handlers_overview.go` | `overview.stats` |
| `handlers_erasures.go` | `erasures.list`, `.detail`, `.preview`, `.request` |
| `handlers_retention.go` | the seven retention intents |
| `handlers_reports.go` | `reports.list`, `.detail`, `.generate`, `.generateCustom`, `.export` |
| `handlers_settings.go` | `settings.detail` |

**Modified:**

| File | Change |
|---|---|
| `go.mod` | forge version floor |
| `audit/query.go` | `Bucket` field on `AggregateGroup` |
| `audit/aggregate.go` | `day` and `hour` in the group-by whitelist |
| `store/postgres/audit.go` | bucket expression |
| `store/sqlite/audit.go` | bucket expression |
| `store/mongo/audit.go` | bucket expression |
| `store/redis/audit.go` | bucket expression |
| `extension/extension.go` | register the contract contributor |

---

### Task 1: Bump forge so the contract packages resolve

**Files:**
- Modify: `go.mod`
- Create: `extension/contract/doc.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `github.com/xraph/forge/extensions/dashboard/contract`, `.../contract/dispatcher` and `.../contract/loader` are importable from this module.

- [ ] **Step 1: Write the failing test**

This one is a compile-time assertion, which is the only kind that means anything for a dependency bump. Create `extension/contract/doc.go`:

```go
// Package contract wires chronicle into the Forge dashboard's contract path.
// It registers the `chronicle` contributor, declares the intents the React
// dashboard reads, and answers them from chronicle's own domain packages.
//
// The templ dashboard in chronicle/dashboard/ continues to run alongside this
// package until it is retired. Both read the same store.
package contract

import (
	_ "github.com/xraph/forge/extensions/dashboard/contract"
	_ "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	_ "github.com/xraph/forge/extensions/dashboard/contract/loader"
)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go build ./extension/contract/`
Expected: FAIL, `no required module provides package github.com/xraph/forge/extensions/dashboard/contract` (forge is at v1.9.13, which predates it).

- [ ] **Step 3: Bump forge**

```bash
go get github.com/xraph/forge@v1.11.1
go get github.com/xraph/forge/extensions/auth@v1.11.1
go mod tidy
```

Both lines matter. `extensions/auth` is a separate module pinned alongside `forge` and leaving it at v1.10.0 gives you two versions of the same shared types.

- [ ] **Step 4: Run the build and the full suite**

Run: `go build ./... && go test ./...`
Expected: PASS. Two minors can ripple. If something outside `extension/contract/` fails to compile, fix it here, in this commit, because every later task assumes a green tree.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum extension/contract/doc.go
git commit -m "chore: bump forge to v1.11.1 for the dashboard contract packages"
```

---

### Task 2: Accept day and hour as group-by fields

**Files:**
- Modify: `audit/query.go`
- Modify: `audit/aggregate.go`
- Test: `audit/aggregate_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `audit.AggregateGroup.Bucket string`; `audit.ResolveGroupBy` accepts `"day"` and `"hour"`; `audit.BucketFields = []string{"day", "hour"}` for backends to test membership against.

- [ ] **Step 1: Write the failing test**

Append to `audit/aggregate_test.go`:

```go
func TestResolveGroupByAcceptsTimeBuckets(t *testing.T) {
	for _, field := range []string{"day", "hour"} {
		cols, err := ResolveGroupBy([]string{field})
		if err != nil {
			t.Fatalf("ResolveGroupBy(%q): %v", field, err)
		}
		if len(cols) != 1 {
			t.Fatalf("ResolveGroupBy(%q) returned %d columns, want 1", field, len(cols))
		}
	}
}

func TestResolveGroupByStillRejectsUnknownFields(t *testing.T) {
	// "week" is deliberately not supported. The whitelist is what keeps
	// group_by out of the SQL string, so widening it by accident is a
	// injection surface and not merely a feature.
	if _, err := ResolveGroupBy([]string{"week"}); !errors.Is(err, ErrUnsupportedGroupBy) {
		t.Fatalf("ResolveGroupBy(week) error = %v, want ErrUnsupportedGroupBy", err)
	}
}

func TestResolveGroupByRejectsDuplicateBucket(t *testing.T) {
	if _, err := ResolveGroupBy([]string{"day", "day"}); !errors.Is(err, ErrDuplicateGroupBy) {
		t.Fatalf("ResolveGroupBy(day,day) error = %v, want ErrDuplicateGroupBy", err)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./audit/ -run TestResolveGroupBy -v`
Expected: FAIL on the first test with `unsupported group_by field: "day"`.

- [ ] **Step 3: Implement**

In `audit/query.go`, add to `AggregateGroup`:

```go
	// Bucket is the time bucket this group covers, when the query grouped by
	// "day" or "hour". It is RFC3339, truncated to the bucket: "2026-09-23"
	// for a day, "2026-09-23T14:00:00Z" for an hour.
	//
	// A period in which nothing was recorded produces NO group at all rather
	// than a group with Count 0. That absence is the point: a gap in an audit
	// series is itself a finding, and the dashboard renders it as one.
	Bucket string `json:"bucket,omitempty"`
```

In `audit/aggregate.go`, extend the whitelist. `groupByColumns` maps a field to a physical column, and a bucket is an expression rather than a column, so backends need to know which is which:

```go
// BucketFields are the group_by fields that select a time bucket rather than a
// column. Each backend renders these as its own truncation expression, so
// groupByColumns maps them to the timestamp column they truncate.
var BucketFields = []string{"day", "hour"}

// IsBucketField reports whether a group_by field is a time bucket.
func IsBucketField(field string) bool {
	for _, f := range BucketFields {
		if f == field {
			return true
		}
	}
	return false
}
```

and add both to `groupByColumns`, mapping to the timestamp column:

```go
	"day":  "timestamp",
	"hour": "timestamp",
```

Then extend the `switch` around line 84 so a resolved bucket field assigns to `Bucket`:

```go
	case "day", "hour":
		// The backend has already truncated; this only routes the value.
		return func(g *AggregateGroup, v string) { g.Bucket = v }, nil
```

Match the surrounding cases' exact shape when you write this; read lines 80 to 96 first, because the existing cases' signature is what yours has to match.

- [ ] **Step 4: Run the tests**

Run: `go test ./audit/ -v`
Expected: PASS, all three new tests plus the existing ones.

- [ ] **Step 5: Commit**

```bash
git add audit/query.go audit/aggregate.go audit/aggregate_test.go
git commit -m "feat(audit): accept day and hour as aggregate group-by fields"
```

---

### Task 3: Bucket by day and hour on postgres

**Files:**
- Modify: `store/postgres/audit.go:188` (the `Aggregate` method)
- Test: `store/postgres/audit_test.go`

**Interfaces:**
- Consumes: `audit.IsBucketField`, `audit.AggregateGroup.Bucket` from Task 2.
- Produces: postgres `Aggregate` honours `day` and `hour`.

- [ ] **Step 1: Write the failing test**

Read the existing postgres test file first for its harness: these tests need a live postgres and the package already has a skip-if-unavailable helper. Use it, don't invent one.

```go
func TestAggregateBucketsByDayAndOmitsEmptyDays(t *testing.T) {
	s := newTestStore(t) // existing helper; skips when no database is configured
	ctx := context.Background()

	// Two events on one day, one event two days later, nothing between.
	day1 := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	day3 := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	seedEvent(t, s, "app-1", day1)
	seedEvent(t, s, "app-1", day1.Add(time.Hour))
	seedEvent(t, s, "app-1", day3)

	res, err := s.Aggregate(ctx, &audit.AggregateQuery{
		After:   day1.Add(-time.Hour),
		Before:  day3.Add(time.Hour),
		AppID:   "app-1",
		GroupBy: []string{"day"},
	})
	if err != nil {
		t.Fatalf("Aggregate: %v", err)
	}

	// Two groups, not three. The empty day is absent, and that absence is
	// what the dashboard renders as a gap.
	if len(res.Groups) != 2 {
		t.Fatalf("got %d groups, want 2 (the empty day must be absent, not zero): %+v",
			len(res.Groups), res.Groups)
	}
	if res.Groups[0].Bucket != "2026-09-20" {
		t.Errorf("first bucket = %q, want 2026-09-20", res.Groups[0].Bucket)
	}
	if res.Groups[0].Count != 2 {
		t.Errorf("first bucket count = %d, want 2", res.Groups[0].Count)
	}
	if res.Groups[1].Bucket != "2026-09-22" {
		t.Errorf("second bucket = %q, want 2026-09-22", res.Groups[1].Bucket)
	}
}
```

If `seedEvent` does not exist in that package, write it as a helper that builds an `audit.Event` with the given app and timestamp and calls `s.Append`. Give it a unique `StreamID` and an increasing `Sequence` per call, because `UNIQUE(stream_id, sequence)` will reject duplicates.

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./store/postgres/ -run TestAggregateBucketsByDay -v`
Expected: FAIL with an error from `ResolveGroupBy` or a SQL error, depending on how far the query gets.

- [ ] **Step 3: Implement**

In `Aggregate`, where the resolved group-by columns are interpolated into the SELECT and GROUP BY, render a bucket field as a truncation instead of a bare column:

```go
// selectExpr renders one group_by field for the SELECT and GROUP BY clauses.
// Bucket fields become a date_trunc, everything else is the whitelisted
// column. Both come from ResolveGroupBy, so neither is caller input.
func selectExpr(field, column string) string {
	switch field {
	case "day":
		return "to_char(date_trunc('day', " + column + "), 'YYYY-MM-DD')"
	case "hour":
		return `to_char(date_trunc('hour', ` + column + `), 'YYYY-MM-DD"T"HH24:00:00"Z"')`
	default:
		return column
	}
}
```

Use the same expression in SELECT and in GROUP BY. Do not `GROUP BY 1`, because the existing code paths group by name and mixing the two is how someone later adds a field and silently groups by the wrong one.

- [ ] **Step 4: Run the tests**

Run: `go test ./store/postgres/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add store/postgres/audit.go store/postgres/audit_test.go
git commit -m "feat(store/postgres): bucket aggregates by day and hour"
```

---

### Task 4: Bucket by day and hour on sqlite

**Files:**
- Modify: `store/sqlite/audit.go:197` (the `Aggregate` method)
- Test: `store/sqlite/audit_test.go`

**Interfaces:**
- Consumes: `audit.IsBucketField`, `audit.AggregateGroup.Bucket` from Task 2.
- Produces: sqlite `Aggregate` honours `day` and `hour`.

- [ ] **Step 1: Write the failing test**

The same test as Task 3, adapted to this package's harness. sqlite has no external dependency, so it will actually run in CI, which makes this the one that catches regressions. Copy the test body from Task 3 verbatim, changing only `newTestStore` to this package's helper (read the file; `store/sqlite` opens a grove DB over a temp file, and `:memory:` is wrong here because grove pools connections and each pooled connection gets its own empty database).

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./store/sqlite/ -run TestAggregateBucketsByDay -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

sqlite has no `date_trunc`, so use `strftime`:

```go
func selectExpr(field, column string) string {
	switch field {
	case "day":
		return "strftime('%Y-%m-%d', " + column + ")"
	case "hour":
		return "strftime('%Y-%m-%dT%H:00:00Z', " + column + ")"
	default:
		return column
	}
}
```

Check how this package stores timestamps before trusting that. If they are stored as unix integers rather than text, `strftime` needs the `'unixepoch'` modifier: `strftime('%Y-%m-%d', timestamp, 'unixepoch')`. Read an existing timestamp comparison in the same file to see which it is, and make the test prove you got it right rather than assuming.

- [ ] **Step 4: Run the tests**

Run: `go test ./store/sqlite/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add store/sqlite/audit.go store/sqlite/audit_test.go
git commit -m "feat(store/sqlite): bucket aggregates by day and hour"
```

---

### Task 5: Bucket by day and hour on mongo

**Files:**
- Modify: `store/mongo/audit.go:104` (the `Aggregate` method)
- Test: `store/mongo/audit_test.go`

**Interfaces:**
- Consumes: `audit.IsBucketField`, `audit.AggregateGroup.Bucket` from Task 2.
- Produces: mongo `Aggregate` honours `day` and `hour`.

- [ ] **Step 1: Write the failing test**

Same test body as Task 3, against this package's harness (it skips when no mongo is reachable).

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./store/mongo/ -run TestAggregateBucketsByDay -v`
Expected: FAIL, or SKIP if no mongo is available. A skip is not a pass. Start one before continuing, because shipping this backend untested is how the four implementations drift apart.

- [ ] **Step 3: Implement**

Mongo groups through an aggregation pipeline, so the bucket is a `$dateTrunc` inside the `$group` `_id`:

```go
// bucketExpr returns the $group _id expression for a time bucket field.
func bucketExpr(field string) bson.M {
	unit := "day"
	format := "%Y-%m-%d"
	if field == "hour" {
		unit = "hour"
		format = "%Y-%m-%dT%H:00:00Z"
	}
	return bson.M{"$dateToString": bson.M{
		"format": format,
		"date":   bson.M{"$dateTrunc": bson.M{"date": "$timestamp", "unit": unit}},
	}}
}
```

`$dateToString` after `$dateTrunc` rather than returning the truncated date itself, so every backend hands back the same string shape and the contract layer needs no per-backend branch.

- [ ] **Step 4: Run the tests**

Run: `go test ./store/mongo/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add store/mongo/audit.go store/mongo/audit_test.go
git commit -m "feat(store/mongo): bucket aggregates by day and hour"
```

---

### Task 6: Bucket by day and hour on redis

**Files:**
- Modify: `store/redis/audit.go:257` (the `Aggregate` method)
- Test: `store/redis/audit_test.go`

**Interfaces:**
- Consumes: `audit.IsBucketField`, `audit.AggregateGroup.Bucket` from Task 2.
- Produces: redis `Aggregate` honours `day` and `hour`.

- [ ] **Step 1: Write the failing test**

Same test body as Task 3, against this package's harness.

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./store/redis/ -run TestAggregateBucketsByDay -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Redis has no aggregation engine. Read how this `Aggregate` already works before writing anything: it scans events and counts in Go. So bucketing is a formatting step on each scanned event, not a query change:

```go
// bucketKey formats an event's timestamp into the bucket string the other
// backends produce through their own date truncation. Keeping the format
// identical across all four is what lets the contract layer stay
// backend-agnostic.
func bucketKey(field string, ts time.Time) string {
	if field == "hour" {
		return ts.UTC().Format("2006-01-02T15:00:00Z")
	}
	return ts.UTC().Format("2006-01-02")
}
```

Group on that string alongside whatever dimensions the query also names. Because this counts only events it actually scanned, an empty bucket produces no entry for free, which is the behaviour the test asserts.

- [ ] **Step 4: Run the tests**

Run: `go test ./store/redis/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add store/redis/audit.go store/redis/audit_test.go
git commit -m "feat(store/redis): bucket aggregates by day and hour"
```

---

### Task 7: The contract skeleton, the scope boundary, and the streams group

This is the task that matters most. `scope.go` is the security boundary for every handler in every later task, and getting it wrong leaks one customer's audit log to another.

**Files:**
- Create: `extension/contract/manifest.yaml`
- Create: `extension/contract/contract.go`
- Create: `extension/contract/scope.go`
- Create: `extension/contract/project.go`
- Create: `extension/contract/handlers_streams.go`
- Test: `extension/contract/scope_test.go`
- Test: `extension/contract/manifest_test.go`
- Test: `extension/contract/handlers_streams_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Deps{Store store.Store, Chronicle *chronicle.Chronicle, Engine *compliance.Engine, Enforcer *retention.Enforcer, Erasure *erasure.Service, Checkpointer *checkpoint.Checkpointer, CheckpointStore checkpoint.Store, CheckpointSigner checkpoint.Signer, HashChain *hash.Chain, Config SurfaceConfig}`
  - `Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error`
  - `viewScope{AppID, TenantID string}`
  - `scopeFromPrincipal(p contract.Principal) (viewScope, error)`
  - `(viewScope) owns(appID, tenantID string) bool`
  - `StreamSummary{ID, AppID, TenantID, HeadHash string; HeadSeq uint64; Scheme string; SchemeSince uint64; CoverageCeiling string; LatestCheckpoint *CheckpointSummary}`

- [ ] **Step 1: Write the failing scope test**

`extension/contract/scope_test.go`:

```go
package contract

import (
	"testing"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	fcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func principalWith(claims map[string]any) fcontract.Principal {
	return fcontract.Principal{
		User:   &dashauth.UserInfo{Subject: "operator-1", Claims: claims},
		Claims: claims,
	}
}

// An absent app_id must be refused. An empty AppID does not mean "this app",
// it means every app every operator owns: chronicle's store queries treat an
// empty scope as matching everything, so defaulting here would list another
// customer's audit events and let retention enforcement purge their history.
func TestScopeFromPrincipalRefusesMissingAppID(t *testing.T) {
	for name, claims := range map[string]map[string]any{
		"no claims":     nil,
		"empty app_id":  {"app_id": ""},
		"wrong type":    {"app_id": 42},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := scopeFromPrincipal(principalWith(claims)); err == nil {
				t.Fatal("scopeFromPrincipal accepted a principal with no usable app_id")
			}
		})
	}
}

func TestScopeFromPrincipalReadsAppAndTenant(t *testing.T) {
	v, err := scopeFromPrincipal(principalWith(map[string]any{
		"app_id":    "app-1",
		"tenant_id": "tenant-a",
	}))
	if err != nil {
		t.Fatalf("scopeFromPrincipal: %v", err)
	}
	if v.AppID != "app-1" || v.TenantID != "tenant-a" {
		t.Fatalf("got %+v, want app-1/tenant-a", v)
	}
}

// org_id is authsome's spelling for the same dimension. Accepting it keeps a
// deployment that already sets it working without a second convention.
func TestScopeFromPrincipalFallsBackToOrgID(t *testing.T) {
	v, err := scopeFromPrincipal(principalWith(map[string]any{
		"app_id": "app-1",
		"org_id": "tenant-b",
	}))
	if err != nil {
		t.Fatalf("scopeFromPrincipal: %v", err)
	}
	if v.TenantID != "tenant-b" {
		t.Fatalf("TenantID = %q, want tenant-b", v.TenantID)
	}
}

// An absent tenant is allowed and means an app-wide view. The dashboard
// operator is app-scoped, and TenantID is a dimension inside their own app.
// It cannot widen past the app because AppID is already required.
func TestScopeFromPrincipalAllowsAbsentTenant(t *testing.T) {
	v, err := scopeFromPrincipal(principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("scopeFromPrincipal: %v", err)
	}
	if v.TenantID != "" {
		t.Fatalf("TenantID = %q, want empty", v.TenantID)
	}
}

func TestOwnsRejectsAnotherApp(t *testing.T) {
	v := viewScope{AppID: "app-1", TenantID: "tenant-a"}
	if v.owns("app-2", "tenant-a") {
		t.Error("owns accepted a record from another app")
	}
	if v.owns("app-1", "tenant-b") {
		t.Error("owns accepted a record from another tenant")
	}
	if !v.owns("app-1", "tenant-a") {
		t.Error("owns rejected the viewer's own record")
	}
	if !v.owns("app-1", "") {
		t.Error("owns rejected an app-level record with no tenant")
	}
}

func TestAppWideScopeOwnsEveryTenantInItsApp(t *testing.T) {
	v := viewScope{AppID: "app-1"}
	if !v.owns("app-1", "tenant-a") || !v.owns("app-1", "tenant-b") {
		t.Error("an app-wide viewer should own every tenant in its own app")
	}
	if v.owns("app-2", "tenant-a") {
		t.Error("an app-wide viewer must not reach another app")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./extension/contract/ -run TestScope -v`
Expected: FAIL to compile, `undefined: scopeFromPrincipal`.

- [ ] **Step 3: Write scope.go**

```go
package contract

import (
	fcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// viewScope is the app and tenant every handler confines itself to.
//
// It is derived from the principal's claims and never from the request body.
// A request that could name its own scope is a request that can read another
// customer's audit log.
type viewScope struct {
	AppID    string
	TenantID string
}

// scopeFromPrincipal resolves the viewer's scope, refusing a principal that
// carries no usable app.
//
// The refusal is the important half. Chronicle's stores treat an empty AppID
// as matching every app: audit.Query with no AppID returns every tenant's
// events, and retention.PurgeQuery with no AppID deletes them. So a missing
// claim cannot default to "the current app", because there is no such thing
// here. It has to be an error.
//
// Claims is the contract path's scoping surface, the same one authsome's
// AppIDFromPrincipal documents, keyed "app_id". The templ dashboard's
// forge.ScopeFrom(ctx) is NOT available on this path: nothing in the
// dispatcher, server or transport puts a forge scope into the handler's
// context.
func scopeFromPrincipal(p fcontract.Principal) (viewScope, error) {
	appID, _ := p.Claims["app_id"].(string)
	if appID == "" {
		return viewScope{}, &fcontract.Error{
			Code:    fcontract.CodePermissionDenied,
			Message: "no app scope on this session",
		}
	}

	tenantID, _ := p.Claims["tenant_id"].(string)
	if tenantID == "" {
		// authsome's spelling for the same dimension.
		tenantID, _ = p.Claims["org_id"].(string)
	}

	return viewScope{AppID: appID, TenantID: tenantID}, nil
}

// owns reports whether a record fetched by ID belongs to this viewer.
//
// Every detail handler calls it after fetching and before returning. A detail
// intent resolves a record by ID, which bypasses every list filter, so without
// this check any caller could read another tenant's event by guessing an ID.
//
// An empty TenantID on the VIEWER means an app-wide operator, who owns every
// tenant inside their own app. An empty TenantID on the RECORD means a record
// held at app level, which an app operator also owns. Neither ever reaches
// past AppID, which is compared first and unconditionally.
func (v viewScope) owns(appID, tenantID string) bool {
	if appID != v.AppID {
		return false
	}
	if v.TenantID != "" && tenantID != "" && tenantID != v.TenantID {
		return false
	}
	return true
}

// applyQuery stamps the viewer's scope onto an event query.
func (v viewScope) applyQuery(q *audit.Query) *audit.Query {
	q.AppID = v.AppID
	q.TenantID = v.TenantID
	return q
}
```

Add the `audit` import for `applyQuery`.

- [ ] **Step 4: Run the scope tests**

Run: `go test ./extension/contract/ -run "TestScope|TestOwns|TestAppWide" -v`
Expected: PASS, all six.

- [ ] **Step 5: Write the manifest with the streams intents only**

`extension/contract/manifest.yaml`. Declare only what Task 7 registers; later tasks add their own intents as they register them, so the parity test in Step 7 passes at every commit.

```yaml
schemaVersion: 1
contributor:
  name: chronicle
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [chronicle.read, chronicle.write, chronicle.admin]

intents:
  # The viewer's own chain. There is exactly one per app and tenant, so this
  # takes no input: the stream resolves from scope.
  - { name: streams.mine, kind: query, version: 1, capability: read }
  # Cross-tenant listing for platform operators. Deliberately absent from the
  # React plugin's nav.
  - { name: streams.list, kind: query, version: 1, capability: read }
```

- [ ] **Step 6: Write contract.go**

```go
package contract

import (
	"bytes"
	_ "embed"
	"fmt"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"

	"github.com/xraph/chronicle"
	"github.com/xraph/chronicle/checkpoint"
	"github.com/xraph/chronicle/compliance"
	"github.com/xraph/chronicle/erasure"
	"github.com/xraph/chronicle/hash"
	"github.com/xraph/chronicle/retention"
	"github.com/xraph/chronicle/store"
)

//go:embed manifest.yaml
var manifestYAML []byte

// contributorName is the join key to the React plugin's `extension` field.
// A mismatch makes the plugin render nothing at all, with nothing logged,
// because that is what an uninstalled extension looks like.
const contributorName = "chronicle"

// SurfaceConfig is what settings.detail reports about this deployment.
type SurfaceConfig struct {
	BatchSize           int
	FlushInterval       string
	RetentionInterval   string
	EnableCryptoErasure bool
	BackendName         string
}

// Deps is what the handlers need. Store and Chronicle are required; the rest
// reflect what this deployment configured, and a nil one means the intents
// that need it answer CodeUnavailable rather than panicking.
type Deps struct {
	Store      store.Store
	Chronicle  *chronicle.Chronicle
	Engine     *compliance.Engine
	Enforcer   *retention.Enforcer
	Erasure    *erasure.Service

	// Checkpointer, CheckpointStore and CheckpointSigner are nil unless
	// checkpoints.enabled is true. They travel as a set: a checkpoint store
	// without a signer proves nothing, since anyone who could write the row
	// could write a fabricated one.
	Checkpointer     *checkpoint.Checkpointer
	CheckpointStore  checkpoint.Store
	CheckpointSigner checkpoint.Signer

	// HashChain is what verification recomputes digests under. A nil value
	// leaves an unkeyed chain, which cannot check an HMAC deployment at all,
	// so an HMAC deployment must pass its keyed chain here.
	HashChain *hash.Chain

	Config SurfaceConfig
}

// Register loads the manifest, registers the contributor, and binds handlers.
func Register(
	d *dispatcher.Dispatcher,
	reg contract.Registry,
	wreg contract.WardenRegistry,
	deps Deps,
) error {
	if deps.Store == nil {
		return fmt.Errorf("chronicle/contract: Store is required")
	}

	m, err := loader.Load(bytes.NewReader(manifestYAML), "chronicle/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("chronicle/contract: load manifest: %w", err)
	}
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("chronicle/contract: validate manifest: %w", err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("chronicle/contract: register manifest: %w", err)
	}

	return registerAll(d, deps)
}

// registerAll binds every handler. Each group lives in its own file and adds
// its registrations to this list as it lands.
func registerAll(d *dispatcher.Dispatcher, deps Deps) error {
	if err := registerStreams(d, deps); err != nil {
		return err
	}
	return nil
}
```

- [ ] **Step 7: Write the manifest parity test**

`extension/contract/manifest_test.go`:

```go
package contract

import (
	"bytes"
	"testing"

	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

// Every intent the manifest declares must have a handler, and every handler
// must be declared. A declared intent with no handler is a page that fails at
// runtime with no compile-time warning; a registered handler with no manifest
// entry is unreachable code nobody notices is dead.
func TestManifestAndHandlersAgree(t *testing.T) {
	m, err := loader.Load(bytes.NewReader(manifestYAML), "manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}

	declared := map[string]bool{}
	for _, in := range m.Intents {
		declared[in.Name] = true
	}

	d := newTestDispatcher(t)
	if err := registerAll(d, Deps{Store: newStubStore()}); err != nil {
		t.Fatalf("registerAll: %v", err)
	}
	registered := dispatcherIntents(t, d, contributorName)

	for name := range declared {
		if !registered[name] {
			t.Errorf("intent %q is declared in the manifest but no handler registers it", name)
		}
	}
	for name := range registered {
		if !declared[name] {
			t.Errorf("intent %q has a handler but is not declared in the manifest", name)
		}
	}
}

// Every command must name the queries its write affects. The React client
// refreshes through meta.invalidates and through nothing else, so a command
// that invalidates nothing looks to an operator like a write that silently
// failed.
func TestEveryCommandDeclaresInvalidations(t *testing.T) {
	m, err := loader.Load(bytes.NewReader(manifestYAML), "manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	for _, in := range m.Intents {
		if in.Kind != "command" {
			continue
		}
		if len(in.Invalidates) == 0 {
			t.Errorf("command %q declares no invalidates", in.Name)
		}
	}
}
```

`newTestDispatcher`, `dispatcherIntents` and `newStubStore` do not exist yet. Write them in `extension/contract/helpers_test.go`. For `dispatcherIntents`, read the `dispatcher` package to find how to enumerate what is registered; if it exposes nothing, track registrations through a small test double instead of reaching into its internals. `newStubStore` returns a `store.Store` whose methods return zero values, which is enough for registration.

- [ ] **Step 8: Write the streams handlers**

`extension/contract/handlers_streams.go`:

```go
package contract

import (
	"context"
	"errors"

	fcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/chronicle"
	"github.com/xraph/chronicle/checkpoint"
	"github.com/xraph/chronicle/hash"
	"github.com/xraph/chronicle/stream"
	"github.com/xraph/chronicle/verify"
)

// StreamSummary is one chain as the dashboard reads it.
type StreamSummary struct {
	ID       string `json:"id"`
	AppID    string `json:"appId"`
	TenantID string `json:"tenantId,omitempty"`
	HeadHash string `json:"headHash"`
	HeadSeq  uint64 `json:"headSeq"`

	Scheme      string `json:"scheme"`
	SchemeSince uint64 `json:"schemeSince"`

	// CoverageCeiling is the best assurance level this deployment could
	// report for this chain, before any verification runs. It is what lets
	// the page tell an operator what is switched off without walking the
	// chain first, which for a default deployment is the most useful thing
	// it can say.
	CoverageCeiling string `json:"coverageCeiling"`

	// LatestCheckpoint is nil when this deployment takes no checkpoints, or
	// when this chain has none yet. The two are different and the page says
	// which: CheckpointingConfigured distinguishes them.
	LatestCheckpoint        *CheckpointSummary `json:"latestCheckpoint,omitempty"`
	CheckpointingConfigured bool               `json:"checkpointingConfigured"`
}

// MineInput is empty: there is exactly one stream per app and tenant, so the
// chain resolves from scope and cannot be named by the caller.
type MineInput struct{}

// MineResponse carries a nil Stream when this scope has never recorded an
// event, which is a real and common state rather than an error. Chronicle
// creates a stream lazily on the first Record.
type MineResponse struct {
	Stream *StreamSummary `json:"stream,omitempty"`
}

func registerStreams(d *dispatcher.Dispatcher, deps Deps) error {
	if err := dispatcher.RegisterQuery(d, contributorName, "streams.mine", 1, streamsMineHandler(deps)); err != nil {
		return err
	}
	if err := dispatcher.RegisterQuery(d, contributorName, "streams.list", 1, streamsListHandler(deps)); err != nil {
		return err
	}
	return nil
}

func streamsMineHandler(deps Deps) func(context.Context, MineInput, fcontract.Principal) (MineResponse, error) {
	return func(ctx context.Context, _ MineInput, p fcontract.Principal) (MineResponse, error) {
		v, err := scopeFromPrincipal(p)
		if err != nil {
			return MineResponse{}, err
		}

		st, err := deps.Store.GetStreamByScope(ctx, v.AppID, v.TenantID)
		if err != nil {
			if errors.Is(err, chronicle.ErrStreamNotFound) {
				// No events recorded yet in this scope. Not an error.
				return MineResponse{}, nil
			}
			return MineResponse{}, mapStoreError(err)
		}

		return MineResponse{Stream: projectStream(ctx, deps, st)}, nil
	}
}

// coverageCeiling is the best level verification could report for this chain
// without walking it: keyed if the chain is pinned to a keyed scheme, signed
// if this deployment also holds checkpoints and a signer to check them under.
//
// It never returns anchored. Nothing in chronicle emits LevelAnchored yet;
// external anchoring is the next piece of work, and claiming it here would be
// the exact overstatement this field exists to prevent.
func coverageCeiling(deps Deps, st *stream.Stream) string {
	level := verify.LevelUnkeyed
	if hash.Keyed(hash.Scheme(st.Scheme)) {
		level = verify.LevelKeyed
	}
	if deps.CheckpointStore != nil && deps.CheckpointSigner != nil && level == verify.LevelKeyed {
		level = verify.LevelSigned
	}
	return string(level)
}
```

Write `projectStream` in `project.go`, and `streamsListHandler` mapping `ListStreams` through `stream.ListOpts{Limit, Offset}` into `[]StreamSummary`. Write `mapStoreError` in `project.go` too: it maps `chronicle.ErrEventNotFound`, `ErrStreamNotFound`, `ErrReportNotFound` and friends to `fcontract.CodeNotFound`, and anything else to `CodeInternal`, so a store failure never leaks a driver error string to the browser.

- [ ] **Step 9: Write the streams handler tests**

`extension/contract/handlers_streams_test.go`. Cover three things:

```go
// A scope with no events yet is a normal state, not an error. Chronicle
// creates a stream on the first Record, so a fresh app has none.
func TestStreamsMineAnswersEmptyForAScopeWithNoChain(t *testing.T) {
	h := streamsMineHandler(Deps{Store: storeReturning(chronicle.ErrStreamNotFound)})
	out, err := h(context.Background(), MineInput{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("handler returned an error for a scope with no chain: %v", err)
	}
	if out.Stream != nil {
		t.Fatal("expected no stream")
	}
}

func TestStreamsMineRefusesAPrincipalWithNoApp(t *testing.T) {
	h := streamsMineHandler(Deps{Store: newStubStore()})
	if _, err := h(context.Background(), MineInput{}, principalWith(nil)); err == nil {
		t.Fatal("handler served a principal with no app scope")
	}
}

// The default deployment: a plain chain and no checkpoints. The ceiling has
// to say unkeyed, because that is the level at which verification detects
// corruption but not deliberate alteration.
func TestCoverageCeilingIsUnkeyedForADefaultDeployment(t *testing.T) {
	got := coverageCeiling(Deps{}, &stream.Stream{Scheme: string(hash.SchemePlainV4)})
	if got != string(verify.LevelUnkeyed) {
		t.Fatalf("ceiling = %q, want unkeyed", got)
	}
}

func TestCoverageCeilingIsKeyedWithoutCheckpoints(t *testing.T) {
	got := coverageCeiling(Deps{}, &stream.Stream{Scheme: string(hash.SchemeHMACV5)})
	if got != string(verify.LevelKeyed) {
		t.Fatalf("ceiling = %q, want keyed", got)
	}
}

func TestCoverageCeilingNeverReachesAnchored(t *testing.T) {
	// Nothing emits LevelAnchored. A ceiling that claimed it would be
	// promising external anchoring this deployment does not have.
	got := coverageCeiling(Deps{
		CheckpointStore:  stubCheckpointStore{},
		CheckpointSigner: stubSigner{},
	}, &stream.Stream{Scheme: string(hash.SchemeHMACV5)})
	if got == string(verify.LevelAnchored) {
		t.Fatal("ceiling claimed anchored")
	}
	if got != string(verify.LevelSigned) {
		t.Fatalf("ceiling = %q, want signed", got)
	}
}
```

- [ ] **Step 10: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the chronicle contributor, scope boundary and streams intents"
```

---

### Tasks 8 through 15: the remaining intent groups

Each follows Task 7's shape exactly: add the group's intents to `manifest.yaml`, write `handlers_<group>.go` with a `register<Group>` function, add that function to `registerAll`, write the tests, run the full suite, commit. The parity test from Task 7 Step 7 keeps the manifest and the handlers honest at every commit.

They are listed here with their intents, their Review Focus obligations and the traps specific to each. Write each task's detailed steps when you reach it, from the spec's intent table and the shape above. Do not start a group before the one before it is committed and green.

**Task 8: verify** (`verify.run`, `verify.event`). Both queries. Build the verifier exactly as `dashboard/contributor.go`'s `newVerifier` does, checkpoints and signer together or neither, because the page and the admin API must not disagree about what evidence they consulted. Project every `*Checked` field onto the wire unchanged; collapsing one server-side is the bug the whole design exists to avoid. **Review Focus 4:** a scope whose stream does not exist answers "no chain yet", not a nil dereference.

**Task 9: checkpoints** (`checkpoints.list`, `.detail`, `.take`). `.take` is a command, capability write, invalidating `checkpoints.list` and `streams.mine`. **Review Focus 5:** every handler treats `checkpoint.ErrUnsupported` as "this backend holds none", answering an empty list rather than an error, because redis implements the interface and refuses every call. **Review Focus 2:** `.detail` checks `owns` after fetching.

**Task 10: events** (`events.list`, `.detail`, `.aggregate`, `.byUser`). `.list` carries the whole of `audit.Query` plus limit, offset and order, and returns `total` and `hasMore` from `QueryResult` so the UI can caption a true count. **Review Focus 2:** `.detail` checks `owns` after fetching, which is the check `contributor.go` calls security-critical.

**Task 11: overview** (`overview.stats`). Counts plus category, severity and outcome breakdowns through `Aggregate`. One call, not four.

**Task 12: erasures** (`.list`, `.detail`, `.preview`, `.request`). `.preview` wraps `CountBySubject` and is the query the confirm dialog runs before the command fires. `.request` is a command, capability admin, taking `subjectId` and `reason` only: `requestedBy` comes from `p.User.Subject` and is never read from the request. **Review Focus 2** on `.detail`.

**Task 13: retention** (`.policies`, `.policyDetail`, `.savePolicy`, `.deletePolicy`, `.preview`, `.enforce`, `.archives`). `.savePolicy` takes `*string` and `*bool` for optional fields. `.enforce` is admin and calls `EnforceScope` with the viewer's scope, never `Enforce`, which covers every app and belongs to the background scheduler. `.preview` wraps `EventsOlderThan`. **Review Focus 2** on `.policyDetail` and on `.deletePolicy`, which must confirm ownership before deleting or any caller can disable another tenant's retention by guessing an ID.

**Task 14: reports** (`.list`, `.detail`, `.generate`, `.generateCustom`, `.export`). `.generate` takes `type` as one of `soc2`, `hipaa`, `euaiact` and rejects anything else with `CodeBadRequest`. The engine persists the report itself, so do not save it again: doing that stored every dashboard-generated report twice in the templ path. `generatedBy` comes from the principal. **Review Focus 2** on `.detail` and `.export`.

**Task 15: settings** (`settings.detail`). Reports the config fields the templ page showed, plus three the spec adds: the digest scheme in force, whether checkpointing is configured, and the backend name with whether it supports checkpoints. That last one is how an operator learns their verification result means less on redis than on postgres.

---

### Task 16: Register the contract contributor from the extension

**Files:**
- Modify: `extension/extension.go`
- Test: `extension/contract_registration_test.go`

**Interfaces:**
- Consumes: `contract.Register` and `contract.Deps` from Tasks 7 through 15.
- Produces: a running extension serves all 29 intents over the wire.

- [ ] **Step 1: Write the failing test**

Mirror `extension/checkpoint_verify_test.go`'s `TestDashboardVerifyPageReportsARewriteOfCheckpointedEvents`, which already drives a real `Register`-wired extension. Assert that after `Register`, dispatching `streams.mine` with an app-scoped principal answers without error. That is the test that catches a `Deps` field left nil in the wiring, which is the bug `checkpoint_verify_test.go` was written for on the templ side: every other test constructs handlers directly and would stay green.

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./extension/ -run TestContractContributorIsRegistered -v`
Expected: FAIL, the contributor is not registered.

- [ ] **Step 3: Wire it**

Find where `extension.go` builds `chronicledash.Config` and registers the templ `DashboardContributor` (near line 370, where `handler.Dependencies` is assembled). Add a `RegisterContractContributor` alongside it, passing a `contract.Deps` built from the same fields. Pass `e.hashChain` explicitly: the templ path's equivalent literal is the exact line `checkpoint_verify_test.go` exists to protect, and the contract path now has the same hazard.

Leave the templ contributor registered. Both dashboards run until Plan C deletes one.

- [ ] **Step 4: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/extension.go extension/contract_registration_test.go
git commit -m "feat(extension): register the chronicle contract contributor"
```

---

## Done when

`go build ./... && go test ./...` passes, all 29 intents are declared and registered with the parity test proving it, every command names its invalidations, and a `Register`-wired extension answers `streams.mine` for an app-scoped principal and refuses one with no app claim.

Plan B then builds `packages/plugin-chronicle` against the DTO names this plan produced.
