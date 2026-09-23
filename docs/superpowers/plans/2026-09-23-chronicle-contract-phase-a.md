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

**Created outside the contract package:**

| File | Responsibility |
|---|---|
| `store/scope_behaviour_test.go` | Characterization test pinning what an empty scope returns per backend, so the reason for the contract's refusal survives in the repository |

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

- [ ] **Step 2: Run it and record what actually happens**

Run: `go build ./extension/contract/`

This was written expecting a failure and it does not fail. v1.9.13 already
ships all three packages. Record the actual result in your report and carry on
with the bump: it is justified by the `extensions/auth` module sharing types
with the main module, not by resolvability.

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

Both bucket fields map to the SAME column, which creates a problem Tasks 3 to
6 depend on you solving here. `ResolveGroupBy` returns columns, so a backend
handed `["timestamp"]` cannot tell whether `day` or `hour` was asked for.

What saves it is the ordering guarantee already in `ResolveGroupBy`'s doc
comment: it returns columns "in the order requested" and rejects duplicates,
so `fields[i]` and `columns[i]` correspond exactly. Backends recover the field
name by zipping `q.GroupBy[i]` with `columns[i]`.

That promise was prose nobody depended on. It is now load-bearing for four
backends, so pin it:

```go
func TestResolveGroupByPreservesRequestOrder(t *testing.T) {
	// Tasks 3 to 6 zip the returned columns against the requested fields to
	// recover which bucket unit was asked for, because "day" and "hour" share
	// the "timestamp" column. That zip is only valid if order is preserved
	// one-for-one, so this test is what makes it safe to rely on.
	fields := []string{"category", "day", "outcome"}
	cols, err := ResolveGroupBy(fields)
	if err != nil {
		t.Fatalf("ResolveGroupBy: %v", err)
	}
	if len(cols) != len(fields) {
		t.Fatalf("got %d columns for %d fields; the zip in every backend assumes one-for-one",
			len(cols), len(fields))
	}
	if cols[0] != "category" || cols[1] != "timestamp" || cols[2] != "outcome" {
		t.Fatalf("columns = %v, want [category timestamp outcome] in request order", cols)
	}
}
```

Do NOT change `ResolveGroupBy`'s signature to return pairs. It has four
existing backend callers and widening the return type to avoid one zip breaks
all of them for no gain.

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

### Task 2b: Pin what an empty scope actually does, per backend

The contract refuses an unresolvable `app_id` (Task 7). This task records WHY,
in the repository rather than only in the spec, so the reason survives whoever
later decides the refusal is over-strict.

It asserts nothing about what empty SHOULD do. It records what it does, per
backend, with a comment naming which. If the four disagree, that disagreement
is the finding and the test says so rather than weakening until all four pass.

**Files:**
- Test: `store/scope_behaviour_test.go` (new, package `store_test`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. This is a characterization test.

- [ ] **Step 1: Write the test**

```go
package store_test

// An empty AppID on a query is not "the current app". This pins what each
// backend actually returns for one, because extension/contract/scope.go
// refuses an unresolvable app claim on the strength of it, and a future
// contributor who thinks that refusal is over-strict should be able to find
// out here what the alternative does rather than reason about it.
//
// This asserts observed behaviour, not desired behaviour. If a backend
// changes, this test failing is the notification.
func TestEmptyAppIDScopeBehaviour(t *testing.T) {
	for name, open := range backends(t) {
		t.Run(name, func(t *testing.T) {
			s := open(t)
			ctx := context.Background()

			seedEventIn(t, s, "app-1", "tenant-a")
			seedEventIn(t, s, "app-2", "tenant-b")

			res, err := s.Query(ctx, &audit.Query{Limit: 100})
			if err != nil {
				t.Fatalf("Query with empty scope: %v", err)
			}

			apps := map[string]bool{}
			for _, e := range res.Events {
				apps[e.AppID] = true
			}

			// Record the answer plainly. Two apps means an empty AppID
			// matches EVERY app, which is the behaviour the contract's
			// PERMISSION_DENIED exists to prevent reaching.
			if len(apps) == 2 {
				t.Logf("%s: empty AppID returns every app (%d events across %d apps)",
					name, len(res.Events), len(apps))
			} else {
				t.Errorf("%s: empty AppID returned %d apps, not the 2 seeded. "+
					"If this backend now scopes an empty AppID to nothing, that is a "+
					"behaviour change worth knowing about: update this test and check "+
					"whether extension/contract/scope.go's refusal is still needed",
					name, len(apps))
			}

			// The same question for tenant, which is the dimension the
			// contract allows to be empty on purpose.
			res, err = s.Query(ctx, &audit.Query{AppID: "app-1", Limit: 100})
			if err != nil {
				t.Fatalf("Query with empty tenant: %v", err)
			}
			t.Logf("%s: AppID set and TenantID empty returns %d events", name, len(res.Events))
			for _, e := range res.Events {
				if e.AppID != "app-1" {
					t.Errorf("%s: an empty TenantID reached outside its app, to %q. "+
						"That is a cross-app leak, not an app-wide view", name, e.AppID)
				}
			}
		})
	}
}
```

`backends(t)` returns a map of backend name to an opener, skipping any that
needs a service that is not running. sqlite always runs. `seedEventIn` builds
an event in the given scope with a unique stream and sequence. Write both in
the same file.

- [ ] **Step 2: Run it**

Run: `go test ./store/ -run TestEmptyAppIDScopeBehaviour -v`
Expected: PASS, with a `t.Logf` line per available backend recording what it
does. Read those lines. They are the output that matters, not the pass.

- [ ] **Step 3: If the backends disagree, stop and report**

If one backend scopes an empty AppID to nothing while others match everything,
that is a finding about the library and not a test to soften. Record it and
raise it before continuing, because `verify` and retention enforcement both
run scoped queries and a divergence there means enforcement purges a different
set of rows depending on the backend.

- [ ] **Step 4: Commit**

```bash
git add store/scope_behaviour_test.go
git commit -m "test(store): pin what an empty scope returns, per backend"
```

---

### Tasks 3 to 6 run as one batch, against one cross-backend test

**This supersedes the per-backend test instructions in Tasks 3 to 6 below.**
Read it first. The four task sections that follow remain the reference for
each backend's bucket expression, which is still correct, but their test
guidance is not.

Two things the per-backend design got wrong, both found once live databases
were running:

1. `store/postgres`, `store/mongo` and `store/redis` have no test files at all.
   There is no "existing skip-if-unavailable helper" to reuse, whatever the
   text below says. The only DSN convention in the repo is the one Task 2b
   introduced in `store/scope_behaviour_test.go`.
2. Four independent per-package tests cannot enforce the property the spec
   actually requires. The spec says all four backends must produce
   byte-identical bucket strings, so the contract layer needs no per-backend
   branch. Four tests can each pass while disagreeing with each other, since
   each only checks its own backend against a literal.

So implement the bucket expression in all four backends in one change, and
pin it with ONE test in package `store_test`, in a new file
`store/aggregate_bucket_test.go`, reusing `backends(t)` and the per-run
seeding helpers from `store/scope_behaviour_test.go`:

```go
// All four backends must render a bucket as the identical string, because the
// dashboard contract carries it to the browser with no per-backend branch. A
// test per backend could pass four times while the four disagreed; this one
// runs them side by side and compares them to each other as well as to the
// expected value.
func TestAggregateBucketsAgreeAcrossBackends(t *testing.T) {
	day1 := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	day3 := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)

	got := map[string][]string{} // backend -> ordered buckets
	for name, open := range backends(t) {
		t.Run(name, func(t *testing.T) {
			s := open(t)
			app := seedScope(t) // per-run unique app id; see scope_behaviour_test.go
			seedEventAt(t, s, app, day1)
			seedEventAt(t, s, app, day1.Add(time.Hour))
			seedEventAt(t, s, app, day3)

			res, err := s.Aggregate(context.Background(), &audit.AggregateQuery{
				After: day1.Add(-time.Hour), Before: day3.Add(time.Hour),
				AppID: app, GroupBy: []string{"day"},
			})
			if err != nil {
				t.Fatalf("Aggregate: %v", err)
			}
			// Two groups, not three. The empty day is ABSENT rather than
			// present with count zero, because the dashboard renders that
			// absence as the gap it is looking for.
			if len(res.Groups) != 2 {
				t.Fatalf("%s: %d groups, want 2 (the empty day must be absent, not zero): %+v",
					name, len(res.Groups), res.Groups)
			}
			var buckets []string
			for _, g := range res.Groups {
				buckets = append(buckets, g.Bucket)
			}
			sort.Strings(buckets)
			if buckets[0] != "2026-09-20" || buckets[1] != "2026-09-22" {
				t.Errorf("%s: buckets %v, want [2026-09-20 2026-09-22]", name, buckets)
			}
			got[name] = buckets
		})
	}

	// The cross-backend assertion the per-package design could not make.
	var ref string
	var refBuckets []string
	for name, b := range got {
		if ref == "" {
			ref, refBuckets = name, b
			continue
		}
		if !reflect.DeepEqual(b, refBuckets) {
			t.Errorf("backends disagree: %s rendered %v, %s rendered %v", name, b, ref, refBuckets)
		}
	}
}
```

Write the same shape again for `hour`, and a third subtest for a timestamp on
an exact second boundary, because sqlite stores time.RFC3339Nano, which omits
the fraction entirely on an exact second, and both `...:03Z` and
`...:03.123456789Z` must bucket to the same hour.

Run it against all four live backends, using ONLY these DSNs:

```
CHRONICLE_TEST_POSTGRES_DSN=postgres://chronicle:chronicle@localhost:55432/chronicle_test?sslmode=disable
CHRONICLE_TEST_MONGO_DSN=mongodb://localhost:57017/chronicle_test
CHRONICLE_TEST_REDIS_DSN=redis://localhost:56379/0
```

Never localhost:5432 or localhost:6379: those are an unrelated project's live
databases. Run the test twice in a row with no cleanup between, since a
persistent database is exactly where seeding collisions show up.

One commit per backend is still fine and makes the history easier to read, but
the test lands with the first and grows as each backend joins it.

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
  - `registration{name string, kind intentKind, bind func(*dispatcher.Dispatcher, Deps) error}` and `registrations() []registration`. Every later task appends its group's `<group>Registrations()` to `registrations()`. This slice, not the dispatcher, is what the manifest parity test compares against.
  - `viewScope{AppID, TenantID string}`
  - `scopeFromPrincipal(p contract.Principal) (viewScope, error)`
  - `(viewScope) owns(appID, tenantID string) bool`
  - `(viewScope) applyQuery(q *audit.Query) *audit.Query`, which stamps the viewer's scope onto an event query. Task 10 consumes this.
  - `tenantFromClaims(p contract.Principal) (string, error)`
  - `StreamSummary{ID, AppID, TenantID, HeadHash string; HeadSeq uint64; Scheme string; SchemeSince uint64; CoverageCeiling string; LatestCheckpoint *CheckpointSummary; CheckpointingConfigured bool}`
  - `CheckpointSummary{ID string; FromSeq, ToSeq uint64; EventCount int64; CreatedAt string; SignKeyID string}`. Defined HERE, in `project.go`, not in Task 9, because `StreamSummary` embeds it. Task 9 reuses this exact type and must not declare a second one.

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
// The bug this pins: a tenant claim that is PRESENT but unreadable must not
// fall through to app-wide. Absent means an app-wide operator; unreadable
// means a tenant-scoped session whose scoping we failed to parse, and
// widening that one hands them every other tenant in their app.
func TestScopeFromPrincipalRefusesAnUnreadableTenant(t *testing.T) {
	_, err := scopeFromPrincipal(principalWith(map[string]any{
		"app_id":    "app-1",
		"tenant_id": 42,
	}))
	if err == nil {
		t.Fatal("scopeFromPrincipal widened an unreadable tenant claim to app-wide")
	}
}

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

	tenantID, err := tenantFromClaims(p)
	if err != nil {
		return viewScope{}, err
	}

	return viewScope{AppID: appID, TenantID: tenantID}, nil
}

// tenantFromClaims resolves the tenant dimension, distinguishing a claim that
// is ABSENT from one that is PRESENT AND UNUSABLE.
//
// Those two look identical through a bare `v, _ := claims[k].(string)` and
// they mean opposite things. Absent is a legitimate app-wide operator, and
// widening to app-wide is correct for them. Present but unusable is a session
// that was scoped to a tenant by something upstream, whose scoping this
// handler then failed to read: widening THAT to app-wide hands one tenant's
// operator every other tenant's audit events inside the same app.
//
// So an absent claim falls back and an unusable one is refused.
func tenantFromClaims(p fcontract.Principal) (string, error) {
	for _, key := range []string{"tenant_id", "org_id"} {
		raw, present := p.Claims[key]
		if !present || raw == nil {
			continue // absent: try the next spelling, then app-wide
		}
		s, ok := raw.(string)
		if !ok {
			return "", &fcontract.Error{
				Code:    fcontract.CodePermissionDenied,
				Message: "tenant scope on this session is unreadable",
			}
		}
		if s == "" {
			continue // explicitly empty reads as app-wide, same as absent
		}
		return s, nil
	}
	return "", nil
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
  capabilities: [chronicle.read, chronicle.write]

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

	declared := map[string]struct{}{}
	for _, in := range m.Intents {
		declared[in.Name] = struct{}{}
	}

	registered := map[string]intentKind{}
	for _, r := range registrations() {
		if _, dup := registered[r.name]; dup {
			t.Errorf("intent %q is registered twice", r.name)
		}
		registered[r.name] = r.kind
	}

	for name := range declared {
		if _, ok := registered[name]; !ok {
			t.Errorf("intent %q is declared in the manifest but no handler registers it", name)
		}
	}
	for name := range registered {
		if _, ok := declared[name]; !ok {
			t.Errorf("intent %q has a handler but is not declared in the manifest", name)
		}
	}

	// The kinds must agree too. A query registered against an intent the
	// manifest calls a command would pass the name comparison above and then
	// fail the envelope's kind check at runtime, which is a much worse place
	// to find out.
	for _, in := range m.Intents {
		got, ok := registered[in.Name]
		if !ok {
			continue // already reported above
		}
		if string(got) != string(in.Kind) {
			t.Errorf("intent %q: manifest says kind=%s, registration says %s", in.Name, in.Kind, got)
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

Write ALL of the shared test helpers in `extension/contract/helpers_test.go`,
not just the three this test uses. Every later task's tests depend on them and
this is the one place they are defined:

- `newTestDispatcher(t)`: a dispatcher to register against
- `newStubStore()`: a `store.Store` whose methods return zero values
- `storeReturning(err)`: a `store.Store` whose reads return that error, used
  by this task's no-chain test and by Task 8's
- `stubCheckpointStore{}` and `stubSigner{}`: used by this task's coverage
  ceiling test and by Task 9's
- `principalWith(claims)`: move it here from `scope_test.go`, so later tasks
  have one place to look for it

Later tasks add their own spies under task-specific names and must not
redefine any of these. Two definitions of the same helper in one package is a
compile error, so the first `go build` will tell you. `newStubStore` returns a
`store.Store` whose methods return zero values, which is enough for
registration.

`dispatcherIntents` needs a different approach than reading the dispatcher,
and this is settled rather than left to you: `*dispatcher.Dispatcher` exposes
no way to enumerate what has been registered. Its public methods are
`Register`, `RegisterContributor`, `RegisterSubscription`, `SetRemoteDispatcher`,
`Dispatch` and `Subscribe`, and none of them lists anything.

So make the registration table the source of truth instead of the dispatcher.
Restructure `registerAll` around a declarative slice, in `contract.go`:

```go
// intentKind distinguishes a query from a command at registration time. The
// dispatcher's RegisterQuery and RegisterCommand are aliases for each other,
// so this exists for the manifest parity test rather than for dispatch.
type intentKind string

const (
	kindQuery   intentKind = "query"
	kindCommand intentKind = "command"
)

// registration is one intent and the function that binds it.
type registration struct {
	name string
	kind intentKind
	bind func(*dispatcher.Dispatcher, Deps) error
}

// registrations is every intent this contributor answers. It is the single
// source of truth: registerAll walks it to bind handlers, and the manifest
// parity test walks it to compare against the manifest. Adding an intent in
// one place and forgetting the other is what that test exists to catch, and
// it can only catch it if both read from here.
func registrations() []registration {
	var out []registration
	out = append(out, streamsRegistrations()...)
	// Each later task appends its group's function here.
	return out
}

func registerAll(d *dispatcher.Dispatcher, deps Deps) error {
	for _, r := range registrations() {
		if err := r.bind(d, deps); err != nil {
			return fmt.Errorf("chronicle/contract: register %s: %w", r.name, err)
		}
	}
	return nil
}
```

and `handlers_streams.go` supplies its own group:

```go
func streamsRegistrations() []registration {
	return []registration{
		{name: "streams.mine", kind: kindQuery, bind: func(d *dispatcher.Dispatcher, deps Deps) error {
			return dispatcher.RegisterQuery(d, contributorName, "streams.mine", 1, streamsMineHandler(deps))
		}},
		{name: "streams.list", kind: kindQuery, bind: func(d *dispatcher.Dispatcher, deps Deps) error {
			return dispatcher.RegisterQuery(d, contributorName, "streams.list", 1, streamsListHandler(deps))
		}},
	}
}
```

Then `dispatcherIntents` is not needed at all. The parity test reads
`registrations()` directly, and it gains a second assertion for free: that
each intent's declared kind in the manifest matches the kind it registers
under. Write the test against `registrations()` rather than against a
dispatcher, and drop `newTestDispatcher` from the helper list unless another
test needs one.

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

### Conventions Task 7 established, which supersede the code samples below

**Read this before any of Tasks 8 to 16.** Task 7 was built, reviewed and
revised, and its real shapes differ from what the samples in the task sections
below were written against. Where a sample disagrees with this section, this
section wins. It was taken from the committed code, not written from memory.

**Registering a group.** Use the constructors, which take the handler FACTORY
and derive the kind, so each intent name is written exactly once:

```go
func verifyRegistrations() []registration {
	return []registration{
		query("verify.run", verifyRunHandler),
		query("verify.event", verifyEventHandler),
	}
}
```

`command(name, factory)` is the counterpart for commands. Do not hand-write
`registration{...}` literals or call `dispatcher.RegisterQuery` directly;
wherever a sample below does, use the constructor instead. Append the group's
function to `registrations()` in `contract.go`.

**Mapping store errors.** It is a method now, and it takes an operation name so
it can log the cause:

```go
return VerifyResponse{}, deps.mapStoreError("verify.run", err)
```

Known not-found sentinels map to `CodeNotFound`; everything else maps to
`CodeInternal` with a generic message, and the underlying error is logged
through `deps.logger()`, never returned. A contract error passes through
unchanged. Wherever a sample below writes `mapStoreError(err)`, write
`deps.mapStoreError("<intent name>", err)`.

**Resolving the viewer's own chain.** Use the existing helper, never
`GetStreamByScope` directly:

```go
st, err := scopedStream(ctx, deps, "verify.run", v)
```

It carries the post-check that refuses a stream whose AppID or TenantID does
not match the viewer's. That post-check is the dashboard's only defence
against a real bug in `store/redis`, which builds its scope key as
`appID + ":" + tenantID` so that app `a:b`/tenant `c` and app `a`/tenant
`b:c` collide. Calling `GetStreamByScope` directly loses that guard. Handle
`chronicle.ErrStreamNotFound` from it as "no chain yet", never as an error.

**Ownership is strict.** `v.owns(appID, tenantID)` compares AppID first. A
viewer with an empty TenantID (app-wide) owns every record in its app,
including tenantless ones. A viewer with a non-empty TenantID owns a record
only if its TenantID matches exactly, so a tenant operator does NOT own
app-level records. Lists built with `applyQuery` pin the tenant exactly, and
detail handlers must agree with them. Every detail handler fetches, then
checks `owns`, then answers `CodeNotFound` rather than `CodePermissionDenied`
when it fails, so a caller cannot probe which IDs exist in other tenants.

**Test helpers in `helpers_test.go`, which you must reuse and not redefine:**
`principalWith(claims)`, `newStubStore()`, `storeReturning(err)` (every
`store.Store` method returns that error), `newSQLiteStore(t)` (a real migrated
sqlite store on a temp file), and `newTestDispatcher(t)`. `stubStore`
implements the whole `store.Store` interface, so a test double can embed it
and override only the methods it cares about. Name your own spies after your
task so they cannot collide.

**Tests that exercise a store read or an ownership check must use a real,
parseable ID.** Generate one with the `id` package's constructor for that
kind (`id.NewAuditID()`, `id.NewErasureID()`, `id.NewPolicyID()`,
`id.NewReportID()`, `id.NewCheckpointID()`) or take it from a seeded row.
A literal like `"cp_1"` or `"evt_1"` fails ID parsing before the store is
reached, so a test named for an ownership check passes whether or not that
check exists. Tasks 9 and 10 each shipped such a test straight from this
plan's samples. If you also want to test the parse refusal, write it as its
own test, named for what it tests, and assert the store was never touched.

**Also available:** `projectCheckpoint(cp)`, `formatTime(t)` for wire
timestamps, `deps.checkpointingConfigured()` (store AND signer both present),
and `coverageCeiling(deps, st)`.

---

### Task 8: The verify group

The page this feeds is the reason the whole dashboard exists. The rule for
every projection here: copy each field across unchanged, including every
`*Checked` flag. Collapsing one server-side is the exact bug the design
exists to avoid, and it cannot be recovered in the browser.

**Files:**
- Create: `extension/contract/handlers_verify.go`
- Modify: `extension/contract/manifest.yaml`
- Modify: `extension/contract/contract.go` (add `registerVerify` to `registerAll`)
- Test: `extension/contract/handlers_verify_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal`, `mapStoreError` (Task 7).
- Produces: `VerifyInput{FromSeq, ToSeq uint64}`, `VerifyReport`, `CoverageSpan`, `CheckpointResult`, `VerifyEventInput{EventID string}`, `VerifyEventResponse{Valid bool, Checked bool}`.

- [ ] **Step 1: Add the intents to the manifest**

```yaml
  # Both are queries: verification has no side effects and is cacheable per
  # (stream, from, to). They are lazy on the client, which is why plan B adds
  # an `enabled` option to useQuery rather than making these commands.
  - { name: verify.run,   kind: query, version: 1, capability: read }
  - { name: verify.event, kind: query, version: 1, capability: read }
```

- [ ] **Step 2: Write the failing tests**

```go
// Every checked flag has to survive the projection. This is the one test
// that would catch somebody "simplifying" the DTO by dropping a flag whose
// value looked redundant next to its partner.
func TestVerifyReportCarriesEveryCheckedFlag(t *testing.T) {
	src := &verify.Report{
		Valid: false, Verified: 9, FirstEvent: 1, LastEvent: 9, HeadSeq: 12,
		Partial:               true,
		Gaps:                  []uint64{4},
		Tampered:              []uint64{7},
		Downgrades:            []uint64{8},
		Tolerant:              []uint64{2},
		HeadMatch:             false,
		HeadChecked:           true,
		CheckpointsChecked:    true,
		CheckpointHeadOK:      false,
		CheckpointHeadChecked: true,
		Coverage: []verify.Coverage{
			{FromSeq: 1, ToSeq: 5, Level: verify.LevelUnkeyed, Note: "below the pin"},
			{FromSeq: 6, ToSeq: 9, Level: verify.LevelKeyed},
		},
		Checkpoints: []verify.CheckpointResult{{
			ID: "cp_1", FromSeq: 1, ToSeq: 5,
			SignatureValid: true,
			HashMatch:      false, HashChecked: false,
			ContinuityOK:   true,  ContinuityChecked: true,
			Note:           "to_seq falls outside the verified range; hash not re-checked",
		}},
	}

	got := projectReport(src)

	if !got.Partial || !got.HeadChecked || got.HeadMatch {
		t.Error("head fields did not survive projection")
	}
	if !got.CheckpointsChecked || !got.CheckpointHeadChecked || got.CheckpointHeadOK {
		t.Error("checkpoint head fields did not survive projection")
	}
	if len(got.Coverage) != 2 {
		t.Fatalf("coverage spans = %d, want 2: a chain with a pin has more than one level", len(got.Coverage))
	}
	if got.Coverage[0].Note == "" {
		t.Error("the coverage note was dropped; it is what explains a span below the pin")
	}
	cp := got.Checkpoints[0]
	if cp.HashChecked || cp.HashMatch {
		t.Error("an unchecked hash must project as unchecked, not as a mismatch")
	}
	if !cp.ContinuityChecked || !cp.ContinuityOK {
		t.Error("continuity fields did not survive projection")
	}
	if cp.Note == "" {
		t.Error("the checkpoint note was dropped; it is what tells the operator why it was not checked")
	}
}

// Review Focus 4: a scope whose chain does not exist yet. Chronicle creates
// a stream on the first Record, so a fresh app has none, and asking to
// verify it must answer "no chain yet" rather than dereferencing nil.
func TestVerifyRunOnAScopeWithNoChain(t *testing.T) {
	h := verifyRunHandler(Deps{Store: storeReturning(chronicle.ErrStreamNotFound)})
	out, err := h(context.Background(), VerifyInput{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("verify on a scope with no chain errored: %v", err)
	}
	if out.Report != nil {
		t.Error("expected no report for a scope that has never recorded an event")
	}
	if !out.NoChain {
		t.Error("NoChain must say so explicitly; a nil report alone is ambiguous")
	}
}

func TestVerifyRunRefusesAPrincipalWithNoApp(t *testing.T) {
	h := verifyRunHandler(Deps{Store: newStubStore()})
	if _, err := h(context.Background(), VerifyInput{}, principalWith(nil)); err == nil {
		t.Fatal("verify served a principal with no app scope")
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run TestVerify -v`
Expected: FAIL to compile, `undefined: projectReport`.

- [ ] **Step 4: Implement**

```go
package contract

// CoverageSpan is one graded span of a chain. It is a slice on the report
// and not a single level, because a chain that had HMAC turned on later is
// unkeyed below its pin and keyed above it, and flattening that into one
// level misdescribes the oldest events, which are the ones an investigation
// usually cares about.
type CoverageSpan struct {
	FromSeq uint64 `json:"fromSeq"`
	ToSeq   uint64 `json:"toSeq"`
	Level   string `json:"level"`
	Note    string `json:"note,omitempty"`
}

// CheckpointResult mirrors verify.CheckpointResult field for field. Each
// *Checked flag travels with its value because false alone cannot say
// whether the check ran.
type CheckpointResult struct {
	ID      string `json:"id"`
	FromSeq uint64 `json:"fromSeq"`
	ToSeq   uint64 `json:"toSeq"`

	SignatureValid bool `json:"signatureValid"`

	HashMatch   bool `json:"hashMatch"`
	HashChecked bool `json:"hashChecked"`

	ContinuityOK      bool `json:"continuityOk"`
	ContinuityChecked bool `json:"continuityChecked"`

	Note string `json:"note,omitempty"`
}

// VerifyReport is verify.Report on the wire. Nothing is summarised and no
// flag is dropped: the page renders three states from each checked pair and
// cannot reconstruct one that did not cross.
type VerifyReport struct {
	Valid      bool     `json:"valid"`
	Verified   int64    `json:"verified"`
	Gaps       []uint64 `json:"gaps,omitempty"`
	Tampered   []uint64 `json:"tampered,omitempty"`
	Downgrades []uint64 `json:"downgrades,omitempty"`
	Tolerant   []uint64 `json:"tolerant,omitempty"`
	FirstEvent uint64   `json:"firstEvent"`
	LastEvent  uint64   `json:"lastEvent"`
	HeadSeq    uint64   `json:"headSeq"`

	Partial     bool `json:"partial"`
	HeadMatch   bool `json:"headMatch"`
	HeadChecked bool `json:"headChecked"`

	CheckpointsChecked    bool `json:"checkpointsChecked"`
	CheckpointHeadOK      bool `json:"checkpointHeadOk"`
	CheckpointHeadChecked bool `json:"checkpointHeadChecked"`

	Coverage    []CoverageSpan     `json:"coverage,omitempty"`
	Checkpoints []CheckpointResult `json:"checkpoints,omitempty"`
}

// VerifyInput bounds the range. Both zero means genesis to head, which is
// the whole chain. The React page sends an explicit bounded window by
// default, because VerifyChain holds every event in the range in memory at
// once and an unbounded walk on a large chain is an out-of-memory crash.
type VerifyInput struct {
	FromSeq uint64 `json:"fromSeq,omitempty"`
	ToSeq   uint64 `json:"toSeq,omitempty"`
}

// VerifyResponse carries NoChain rather than only a nil Report, because
// "this scope has never recorded an event" and "verification produced
// nothing" are different answers and the page says which.
type VerifyResponse struct {
	Report  *VerifyReport `json:"report,omitempty"`
	NoChain bool          `json:"noChain"`
}

func registerVerify(d *dispatcher.Dispatcher, deps Deps) error {
	if err := dispatcher.RegisterQuery(d, contributorName, "verify.run", 1, verifyRunHandler(deps)); err != nil {
		return err
	}
	return dispatcher.RegisterQuery(d, contributorName, "verify.event", 1, verifyEventHandler(deps))
}

// newVerifier mirrors dashboard/contributor.go's newVerifier deliberately.
// The contract path and the templ page answer the same question and must not
// disagree about what evidence they consulted. Checkpoints and signer travel
// together or not at all: a checkpoint store without a signer proves nothing,
// since whoever could write the row could write a fabricated one.
func newVerifier(deps Deps) *verify.Verifier {
	chain := deps.HashChain
	if chain == nil {
		chain = &hash.Chain{}
	}
	if deps.CheckpointStore == nil || deps.CheckpointSigner == nil {
		return verify.NewVerifierWithChain(deps.Store, chain)
	}
	return verify.NewVerifierWithCheckpoints(deps.Store, chain, deps.CheckpointStore, deps.CheckpointSigner)
}

func verifyRunHandler(deps Deps) func(context.Context, VerifyInput, fcontract.Principal) (VerifyResponse, error) {
	return func(ctx context.Context, in VerifyInput, p fcontract.Principal) (VerifyResponse, error) {
		v, err := scopeFromPrincipal(p)
		if err != nil {
			return VerifyResponse{}, err
		}

		st, err := deps.Store.GetStreamByScope(ctx, v.AppID, v.TenantID)
		if err != nil {
			if errors.Is(err, chronicle.ErrStreamNotFound) {
				return VerifyResponse{NoChain: true}, nil
			}
			return VerifyResponse{}, mapStoreError(err)
		}

		// The pin and the head come off the stream row, never from the
		// request. A caller that could name its own pin could declare a
		// keyed chain plain and walk past every downgrade check.
		report, err := newVerifier(deps).VerifyChain(ctx, &verify.Input{
			StreamID: st.ID,
			FromSeq:  in.FromSeq,
			ToSeq:    in.ToSeq,
			AppID:    v.AppID,
			TenantID: v.TenantID,
			Pin:      hash.Pin{Scheme: hash.Scheme(st.Scheme), Since: st.SchemeSince},
			HeadSeq:  st.HeadSeq,
			HeadHash: st.HeadHash,
		})
		if err != nil {
			return VerifyResponse{}, mapStoreError(err)
		}

		return VerifyResponse{Report: projectReport(report)}, nil
	}
}
```

Write `projectReport` as a field-for-field copy. Do not write it as a loop
over reflected fields, and do not omit a false bool for brevity: `json:"-"`
on nothing here, and no `omitempty` on any of the six checked flags or their
partners, because `omitempty` on a false bool erases the distinction this
whole design protects.

`verifyEventHandler` wraps `Chronicle.VerifyEvent(eventID)`. It fetches the
event first and calls `v.owns(event.AppID, event.TenantID)`, answering
`CodeNotFound` when it does not, because an event must not be verifiable by
ID alone any more than it is readable by ID alone.

- [ ] **Step 5: Add this group to the registration table**

Append the group's own function to `registrations()` in `contract.go`:

```go
	out = append(out, verifyRegistrations()...)
```

and supply `verifyRegistrations()` in this task's handler file, following the
shape `streamsRegistrations()` established in Task 7: one `registration` per
intent, each naming its intent, its kind, and a `bind` closure calling
`dispatcher.RegisterQuery` or `RegisterCommand`. The manifest parity test
reads this table, so an intent added to the manifest without a matching entry
here fails the build.

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS, including the manifest parity test, which now sees two more
declared and two more registered.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the verify intents"
```

---

### Task 9: The checkpoints group

**Files:**
- Create: `extension/contract/handlers_checkpoints.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_checkpoints_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal`, `CheckpointSummary`, `mapStoreError` (Task 7).
- Produces: `CheckpointListInput{Limit, Offset int}`, `CheckpointListResponse{Checkpoints []CheckpointSummary, Supported bool}`, `TakeCheckpointResponse`.

- [ ] **Step 1: Add the intents**

```yaml
  - { name: checkpoints.list,   kind: query, version: 1, capability: read }
  - { name: checkpoints.detail, kind: query, version: 1, capability: read }
  # Write, not admin: taking a checkpoint creates a record and destroys
  # nothing. It is the one write that makes future verification stronger.
  - { name: checkpoints.take, kind: command, version: 1, capability: write,
      invalidates: [checkpoints.list, streams.mine, verify.run] }
```

`verify.run` is in that list on purpose. A new checkpoint changes what a
subsequent verification can prove, so a cached report taken before it is
stale in a way the operator would otherwise not see.

- [ ] **Step 2: Write the failing tests**

```go
// Review Focus 5. Redis implements checkpoint.Store and refuses every call
// with ErrUnsupported. verify treats that as "no opinion" and so must this:
// a backend that holds no checkpoints is a normal deployment, not an error
// page, and the difference from "this chain has none yet" is what Supported
// carries.
func TestCheckpointsListTreatsUnsupportedAsUnsupportedNotAnError(t *testing.T) {
	h := checkpointsListHandler(Deps{
		Store:            newStubStore(),
		CheckpointStore:  storeRefusingCheckpoints(checkpoint.ErrUnsupported),
		CheckpointSigner: stubSigner{},
	})
	out, err := h(context.Background(), CheckpointListInput{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("an unsupported checkpoint store produced an error: %v", err)
	}
	if out.Supported {
		t.Error("Supported must be false so the page can say 'this backend holds none' rather than 'none yet'")
	}
	if len(out.Checkpoints) != 0 {
		t.Error("expected no checkpoints")
	}
}

// A deployment that never configured checkpointing has no store at all.
// Same answer, different cause, same need to distinguish it from empty.
func TestCheckpointsListWithNoStoreConfigured(t *testing.T) {
	h := checkpointsListHandler(Deps{Store: newStubStore()})
	out, err := h(context.Background(), CheckpointListInput{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("unconfigured checkpointing produced an error: %v", err)
	}
	if out.Supported {
		t.Error("Supported must be false when this deployment takes no checkpoints")
	}
}

// Review Focus 2: a checkpoint belonging to another tenant, fetched by ID.
func TestCheckpointsDetailRefusesAnotherTenantsCheckpoint(t *testing.T) {
	h := checkpointsDetailHandler(Deps{
		Store:            newStubStore(),
		CheckpointStore:  checkpointStoreWith(&checkpoint.Checkpoint{AppID: "app-2", TenantID: "tenant-b"}),
		CheckpointSigner: stubSigner{},
	})
	_, err := h(context.Background(), GetCheckpointInput{ID: "cp_1"},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err == nil {
		t.Fatal("served another tenant's checkpoint to a caller who guessed its ID")
	}
}

func TestCheckpointsTakeWithoutACheckpointerIsUnavailable(t *testing.T) {
	h := checkpointsTakeHandler(Deps{Store: newStubStore()})
	_, err := h(context.Background(), struct{}{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err == nil {
		t.Fatal("take succeeded on a deployment that configured no checkpointer")
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run TestCheckpoints -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

Every handler here follows the same three-part shape: resolve scope, resolve
the viewer's stream, then call the checkpoint store treating
`checkpoint.ErrUnsupported` and `checkpoint.ErrNotFound` as "nothing here"
rather than failure.

```go
// checkpointsAvailable reports whether this deployment can answer checkpoint
// questions at all. Nil store or nil signer both mean no: a store without a
// signer cannot prove a checkpoint is genuine, so reporting its rows would
// present unverifiable data as evidence.
func checkpointsAvailable(deps Deps) bool {
	return deps.CheckpointStore != nil && deps.CheckpointSigner != nil
}
```

`checkpointsTakeHandler` resolves the viewer's stream, then calls
`deps.Checkpointer.CheckpointStream(ctx, checkpoint.StreamHead{...})` built
from the stream row. A nil `Checkpointer` answers `CodeUnavailable` with
"this deployment takes no checkpoints", matching how `handler/checkpoints.go`
answers 503 for the same case.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the checkpoint intents"
```

---

### Task 10: The events group

**Files:**
- Create: `extension/contract/handlers_events.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_events_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal`, `applyQuery`, `mapStoreError` (Task 7).
- Produces: `EventSummary`, `EventDetail`, `EventListInput`, `EventListResponse{Events []EventSummary, Total int64, HasMore bool}`, `AggregateInput{After, Before string; GroupBy []string}`, `AggregateResponse{Groups []AggregateGroupDTO, Total int64}`, and
  `AggregateGroupDTO{Bucket, Category, Action, Outcome, Severity, Resource string; Count int64}`. Tasks 11 and 13 consume that last type, so define it here and do not declare a second one.

- [ ] **Step 1: Add the intents**

```yaml
  - { name: events.list,      kind: query, version: 1, capability: read }
  - { name: events.detail,    kind: query, version: 1, capability: read }
  - { name: events.aggregate, kind: query, version: 1, capability: read }
  - { name: events.byUser,    kind: query, version: 1, capability: read }
```

- [ ] **Step 2: Write the failing tests**

```go
// Total comes from the store's own count and not from len(Events). The page
// captions "50 of 12,431 events", and counting the rows on screen would make
// that caption a lie on every page after the first.
func TestEventListReportsTheStoreTotalNotThePageLength(t *testing.T) {
	h := eventsListHandler(Deps{Store: storeQuerying(&audit.QueryResult{
		Events:  make([]*audit.Event, 50),
		Total:   12431,
		HasMore: true,
	})})
	out, err := h(context.Background(), EventListInput{Limit: 50}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("events.list: %v", err)
	}
	if out.Total != 12431 {
		t.Errorf("Total = %d, want 12431", out.Total)
	}
	if !out.HasMore {
		t.Error("HasMore did not survive")
	}
}

// The scope on the outgoing query must come from the principal. A request
// that could set its own AppID could read every tenant's audit log.
func TestEventListStampsTheViewersScope(t *testing.T) {
	spy := &querySpy{}
	h := eventsListHandler(Deps{Store: spy})
	_, _ = h(context.Background(), EventListInput{},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if spy.last.AppID != "app-1" || spy.last.TenantID != "tenant-a" {
		t.Fatalf("outgoing query scope = %q/%q, want app-1/tenant-a", spy.last.AppID, spy.last.TenantID)
	}
}

// Review Focus 2. contributor.go calls this check security-critical, in
// those words, because a detail intent resolves by ID and bypasses every
// list filter.
func TestEventDetailRefusesAnotherTenantsEvent(t *testing.T) {
	h := eventsDetailHandler(Deps{Store: storeWithEvent(&audit.Event{
		AppID: "app-2", TenantID: "tenant-b",
	})})
	_, err := h(context.Background(), GetEventInput{ID: "evt_1"},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err == nil {
		t.Fatal("served another tenant's event to a caller who guessed its ID")
	}
}

func TestEventAggregateRejectsAnUnsupportedGroupBy(t *testing.T) {
	h := eventsAggregateHandler(Deps{Store: newStubStore()})
	_, err := h(context.Background(), AggregateInput{GroupBy: []string{"week"}},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err == nil {
		t.Fatal("accepted an unwhitelisted group_by field")
	}
}

// Task 2's bucketing, reaching the wire.
func TestEventAggregateCarriesTheBucket(t *testing.T) {
	h := eventsAggregateHandler(Deps{Store: storeAggregating(&audit.AggregateResult{
		Groups: []audit.AggregateGroup{{Bucket: "2026-09-20", Count: 2}},
		Total:  2,
	})})
	out, err := h(context.Background(), AggregateInput{GroupBy: []string{"day"}},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("events.aggregate: %v", err)
	}
	if out.Groups[0].Bucket != "2026-09-20" {
		t.Errorf("bucket = %q, want 2026-09-20", out.Groups[0].Bucket)
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run TestEvent -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

```go
// EventSummary is one row of the log. Metadata is deliberately absent: it is
// freeform and can be large, and sending it for every row of a virtualised
// table would dominate the response. events.detail carries it.
type EventSummary struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Sequence   uint64 `json:"sequence"`
	Action     string `json:"action"`
	Resource   string `json:"resource"`
	ResourceID string `json:"resourceId,omitempty"`
	Category   string `json:"category"`
	Outcome    string `json:"outcome"`
	Severity   string `json:"severity"`
	UserID     string `json:"userId,omitempty"`
	IP         string `json:"ip,omitempty"`
	Erased     bool   `json:"erased"`
}

// EventDetail adds what the detail page needs: the payload, the chain
// position, and the scheme provenance that tells an operator which level
// THIS event was written under, which is not necessarily the level the
// chain is pinned to now.
type EventDetail struct {
	EventSummary
	StreamID   string         `json:"streamId"`
	Hash       string         `json:"hash"`
	PrevHash   string         `json:"prevHash"`
	HashScheme string         `json:"hashScheme,omitempty"`
	HashKeyID  string         `json:"hashKeyId,omitempty"`
	Reason     string         `json:"reason,omitempty"`
	SubjectID  string         `json:"subjectId,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	ErasedAt   string         `json:"erasedAt,omitempty"`
	ErasureID  string         `json:"erasureId,omitempty"`
}

// EventListInput is audit.Query's filter set on the wire. Every filter is
// multi-value except the time bounds, matching the Go type: the templ page
// allowed one value each and that was a limitation of the page, not the store.
//
// There is no appId or tenantId field, on purpose. Scope comes from the
// principal.
type EventListInput struct {
	After      string   `json:"after,omitempty"`
	Before     string   `json:"before,omitempty"`
	UserID     string   `json:"userId,omitempty"`
	Categories []string `json:"categories,omitempty"`
	Actions    []string `json:"actions,omitempty"`
	Resources  []string `json:"resources,omitempty"`
	Severity   []string `json:"severity,omitempty"`
	Outcome    []string `json:"outcome,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Offset     int      `json:"offset,omitempty"`
	Order      string   `json:"order,omitempty"`
}
```

Parse `After` and `Before` as RFC3339, answering `CodeBadRequest` on a
malformed value rather than silently treating it as the zero time, which
would widen the query to the beginning of time instead of narrowing it.

Clamp `Limit` the way `handler/requests.go` does: zero or less becomes 50,
above 1000 becomes 1000. Reuse the same numbers so the two paths agree.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the event intents"
```

---

### Task 11: The overview group

**Files:**
- Create: `extension/contract/handlers_overview.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_overview_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal` (Task 7), `AggregateGroupDTO` (Task 10).
- Produces: `OverviewStats{TotalEvents, CriticalEvents, FailedEvents, ErasureCount int64, Categories, Severities, Outcomes []AggregateGroupDTO}`.

- [ ] **Step 1: Add the intent**

```yaml
  - { name: overview.stats, kind: query, version: 1, capability: read }
```

- [ ] **Step 2: Write the failing test**

```go
// The templ overview ran four separate queries and counted criticals by
// fetching them. One Aggregate answers the breakdowns, and Count answers
// the total without loading a row.
func TestOverviewStatsUsesAggregateRatherThanCountingFetchedRows(t *testing.T) {
	spy := &aggregateSpy{result: &audit.AggregateResult{
		Groups: []audit.AggregateGroup{
			{Severity: "critical", Count: 3},
			{Severity: "info", Count: 900},
		},
	}}
	h := overviewStatsHandler(Deps{Store: spy})
	out, err := h(context.Background(), struct{}{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("overview.stats: %v", err)
	}
	if spy.calls == 0 {
		t.Fatal("overview.stats did not call Aggregate")
	}
	if out.CriticalEvents != 3 {
		t.Errorf("CriticalEvents = %d, want 3", out.CriticalEvents)
	}
}

func TestOverviewStatsRefusesAPrincipalWithNoApp(t *testing.T) {
	h := overviewStatsHandler(Deps{Store: newStubStore()})
	if _, err := h(context.Background(), struct{}{}, principalWith(nil)); err == nil {
		t.Fatal("overview served a principal with no app scope")
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `go test ./extension/contract/ -run TestOverview -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

Aggregate once grouping by severity, once by category, once by outcome, and
derive `CriticalEvents` and `FailedEvents` from the severity and outcome
groups rather than running separate filtered queries. `ErasureCount` comes
from `CountErasures`, which exists precisely so callers do not count a list
that is bounded by its own limit.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the overview stats intent"
```

---
### Task 12: The erasures group

This group and the next are the two that destroy audit history. Both get a
preview query the confirm dialog runs before the command fires.

Note the capability shape, which the plan originally got wrong.
`contract.Capability` has only `read` and `write`, and `loader.Validate`
requires a command to be `write`. "Admin" is expressed through the separate
`requires` predicate instead, as `all: [scope:chronicle.admin]`. A manifest
saying `capability: admin` fails to load.

**Files:**
- Create: `extension/contract/handlers_erasures.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_erasures_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal`, `mapStoreError` (Task 7).
- Produces: `ErasureSummary`, `ErasurePreviewInput{SubjectID string}`, `ErasurePreviewResponse{SubjectID string, EventsAffected int64}`, `RequestErasureInput{SubjectID, Reason string}`, `ErasureResult`.

- [ ] **Step 1: Add the intents**

```yaml
  - { name: erasures.list,    kind: query, version: 1, capability: read }
  - { name: erasures.detail,  kind: query, version: 1, capability: read }
  # The count the confirm dialog shows before the command fires. A query, so
  # it is lazy on the client and runs when the dialog opens, not on the list.
  - { name: erasures.preview, kind: query, version: 1, capability: read }
  # Destroys a subject's key and flags their events, so it carries the
  # explicit admin scope on top of the write capability every command has.
  - { name: erasures.request, kind: command, version: 1, capability: write,
      requires: { all: [scope:chronicle.admin] },
      invalidates: [erasures.list, overview.stats, events.list] }
```

`events.list` is invalidated because erasure marks events erased, and a list
rendered before the erasure would still show them unflagged.

- [ ] **Step 2: Write the failing tests**

```go
// requestedBy identifies who ordered a GDPR erasure. It is the one field in
// this contract most tempting to accept from the request, and accepting it
// would let any caller attribute a destruction to somebody else.
func TestErasureRequestTakesRequestedByFromThePrincipal(t *testing.T) {
	spy := &erasureSpy{}
	h := erasuresRequestHandler(Deps{Store: newStubStore(), Erasure: spy.service()})
	_, err := h(context.Background(),
		RequestErasureInput{SubjectID: "subj-1", Reason: "gdpr article 17"},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("erasures.request: %v", err)
	}
	if spy.lastInput.RequestedBy != "operator-1" {
		t.Fatalf("RequestedBy = %q, want the principal's subject", spy.lastInput.RequestedBy)
	}
}

// The erasure must be confined to the viewer's scope. erasure.Scope's own
// doc says a zero scope matches every app and tenant and is only for trusted
// in-process callers; a dashboard request is not one.
func TestErasureRequestIsConfinedToTheViewersScope(t *testing.T) {
	spy := &erasureSpy{}
	h := erasuresRequestHandler(Deps{Store: newStubStore(), Erasure: spy.service()})
	_, _ = h(context.Background(),
		RequestErasureInput{SubjectID: "subj-1", Reason: "r"},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if spy.lastAppID != "app-1" || spy.lastTenantID != "tenant-a" {
		t.Fatalf("erase scope = %q/%q, want app-1/tenant-a", spy.lastAppID, spy.lastTenantID)
	}
}

func TestErasureRequestRequiresASubjectAndReason(t *testing.T) {
	h := erasuresRequestHandler(Deps{Store: newStubStore(), Erasure: stubErasureService()})
	for name, in := range map[string]RequestErasureInput{
		"no subject": {Reason: "r"},
		"no reason":  {SubjectID: "subj-1"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := h(context.Background(), in, principalWith(map[string]any{"app_id": "app-1"})); err == nil {
				t.Fatal("accepted an incomplete erasure request")
			}
		})
	}
}

// The preview is what makes the command safe to offer. It must be scoped
// too: CountBySubject's doc says an unscoped count reveals how much data
// other tenants hold on that subject.
func TestErasurePreviewIsScoped(t *testing.T) {
	spy := &countSpy{}
	h := erasuresPreviewHandler(Deps{Store: spy})
	_, _ = h(context.Background(), ErasurePreviewInput{SubjectID: "subj-1"},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if spy.lastQuery.AppID != "app-1" || spy.lastQuery.TenantID != "tenant-a" {
		t.Fatal("CountBySubject ran outside the viewer's scope")
	}
}

// Review Focus 2.
func TestErasureDetailRefusesAnotherTenantsRecord(t *testing.T) {
	h := erasuresDetailHandler(Deps{Store: storeWithErasure(&erasure.Erasure{
		AppID: "app-2", TenantID: "tenant-b",
	})})
	_, err := h(context.Background(), GetErasureInput{ID: id.NewErasureID().String()},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err == nil {
		t.Fatal("served another tenant's erasure record")
	}
}
```

That last test is worth noting: the templ `renderErasureDetail` does NOT
check scope, unlike every other detail renderer in that file. It is the one
place the templ dashboard forgot, and this contract does not inherit the
omission. Record it in `MIGRATION.md` in Plan C as a bug fixed in passing
rather than a feature migrated.

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run TestErasure -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

`erasuresRequestHandler` validates both fields, resolves scope, then calls
`deps.Erasure.Erase(ctx, &erasure.Input{SubjectID, Reason, RequestedBy}, v.AppID, v.TenantID)`.
A nil `deps.Erasure` answers `CodeUnavailable`: without the service an
erasure only flags events and does not destroy the key, and silently doing
half a GDPR erasure is worse than refusing.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the erasure intents"
```

---

### Task 13: The retention group

Seven intents, and the one that permanently deletes audit history.

**Files:**
- Create: `extension/contract/handlers_retention.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_retention_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal`, `mapStoreError` (Task 7).
- Produces: `PolicySummary`, `SavePolicyInput{ID *string, Category *string, Duration *string, Archive *bool}`, `RetentionPreviewResponse{EventCount int64, Oldest, Newest string, ByCategory []AggregateGroupDTO, NoPolicies bool}`, `EnforceResponse`, `ArchiveSummary`.
  `NoPolicies` exists because zero-because-nothing-is-configured and
  zero-because-nothing-is-old-enough are different answers, and the spec's
  empty-state rule requires the page to tell them apart.

- [ ] **Step 1: Add the intents**

```yaml
  - { name: retention.policies,     kind: query, version: 1, capability: read }
  - { name: retention.policyDetail, kind: query, version: 1, capability: read }
  - { name: retention.savePolicy,   kind: command, version: 1, capability: write,
      invalidates: [retention.policies, retention.policyDetail] }
  - { name: retention.deletePolicy, kind: command, version: 1, capability: write,
      requires: { all: [scope:chronicle.admin] },
      invalidates: [retention.policies] }
  - { name: retention.preview,      kind: query, version: 1, capability: read }
  # Purges audit events permanently, so it carries the explicit admin scope.
  - { name: retention.enforce, kind: command, version: 1, capability: write,
      requires: { all: [scope:chronicle.admin] },
      invalidates: [retention.policies, retention.archives, events.list, overview.stats, streams.mine] }
  - { name: retention.archives,     kind: query, version: 1, capability: read }
```

- [ ] **Step 2: Write the failing tests**

```go
// The single most dangerous call in this contract. Enforce() covers every
// app and belongs to the background scheduler; a dashboard request must use
// EnforceScope with the viewer's own scope. Getting this wrong purges every
// tenant's audit history.
func TestEnforceUsesTheViewersScopeAndNotTheGlobalEnforce(t *testing.T) {
	spy := &enforcerSpy{}
	h := retentionEnforceHandler(Deps{Store: newStubStore(), Enforcer: spy.enforcer()})
	_, err := h(context.Background(), struct{}{},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err != nil {
		t.Fatalf("retention.enforce: %v", err)
	}
	if spy.globalEnforceCalls != 0 {
		t.Fatal("retention.enforce called the global Enforce, which purges every app")
	}
	if spy.lastScope.AppID != "app-1" || spy.lastScope.TenantID != "tenant-a" {
		t.Fatalf("enforced scope = %+v, want app-1/tenant-a", spy.lastScope)
	}
}

// A policy with an empty AppID matches every app in the purge query, so an
// unscoped policy created here would delete every tenant's audit history on
// the next enforcement run. contributor.go carries this warning verbatim.
func TestSavePolicyStampsTheViewersScope(t *testing.T) {
	spy := &policySpy{}
	h := retentionSavePolicyHandler(Deps{Store: spy})
	cat, dur := "auth", "720h"
	_, err := h(context.Background(), SavePolicyInput{Category: &cat, Duration: &dur},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err != nil {
		t.Fatalf("savePolicy: %v", err)
	}
	if spy.saved.AppID != "app-1" || spy.saved.TenantID != "tenant-a" {
		t.Fatalf("saved policy scope = %q/%q, want app-1/tenant-a", spy.saved.AppID, spy.saved.TenantID)
	}
}

// Pointers distinguish "leave alone" from "set to empty". A non-pointer
// Archive would clear the flag on every update that did not mention it.
func TestSavePolicyLeavesUnsuppliedFieldsAlone(t *testing.T) {
	existing := &retention.Policy{
		ID: id.NewPolicyID(), Category: "auth",
		Duration: 720 * time.Hour, Archive: true,
		AppID: "app-1", TenantID: "tenant-a",
	}
	spy := &policySpy{existing: existing}
	h := retentionSavePolicyHandler(Deps{Store: spy})

	id := existing.ID.String()
	dur := "1440h"
	_, err := h(context.Background(), SavePolicyInput{ID: &id, Duration: &dur},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err != nil {
		t.Fatalf("savePolicy: %v", err)
	}
	if !spy.saved.Archive {
		t.Error("Archive was cleared by an update that never mentioned it")
	}
	if spy.saved.Category != "auth" {
		t.Errorf("Category = %q, want auth: an unsupplied field must not be erased", spy.saved.Category)
	}
}

// Review Focus 2, on the delete path. Without this any viewer could disable
// another tenant's retention by guessing an ID.
func TestDeletePolicyRefusesAnotherTenantsPolicy(t *testing.T) {
	spy := &policySpy{existing: &retention.Policy{AppID: "app-2", TenantID: "tenant-b"}}
	h := retentionDeletePolicyHandler(Deps{Store: spy})
	_, err := h(context.Background(), DeletePolicyInput{ID: id.NewPolicyID().String()},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err == nil {
		t.Fatal("deleted another tenant's retention policy")
	}
	if spy.deleteCalls != 0 {
		t.Fatal("DeletePolicy was called before the ownership check")
	}
}

// The preview is what makes enforce offerable. It has to describe the same
// rows enforcement would purge, so it runs the same scoped query.
func TestRetentionPreviewIsScopedAndCounts(t *testing.T) {
	h := retentionPreviewHandler(Deps{Store: storeWithOldEvents(3, "app-1")})
	out, err := h(context.Background(), struct{}{},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("retention.preview: %v", err)
	}
	if out.EventCount != 3 {
		t.Errorf("EventCount = %d, want 3", out.EventCount)
	}
}

// A deployment with no policies would purge nothing, and the preview must
// say that rather than showing an empty list that reads as "still loading".
func TestRetentionPreviewWithNoPoliciesReportsZero(t *testing.T) {
	h := retentionPreviewHandler(Deps{Store: storeWithPolicies()})
	out, err := h(context.Background(), struct{}{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("retention.preview: %v", err)
	}
	if out.EventCount != 0 || !out.NoPolicies {
		t.Error("a scope with no policies must say so, not return an ambiguous empty result")
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run "TestEnforce|TestSavePolicy|TestDeletePolicy|TestRetention" -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

```go
// SavePolicyInput uses pointers for every mutable field so an update can
// leave one alone. ID absent means create; ID present means update, and the
// handler fetches the existing policy, checks ownership, and applies only
// the fields that were supplied.
type SavePolicyInput struct {
	ID       *string `json:"id,omitempty"`
	Category *string `json:"category,omitempty"`
	Duration *string `json:"duration,omitempty"`
	Archive  *bool   `json:"archive,omitempty"`
}
```

Parse `Duration` with `time.ParseDuration`, answering `CodeBadRequest` on a
malformed value. On create, both `Category` and `Duration` are required.

`retentionPreviewHandler` lists the viewer's policies, and for each one calls
`EventsOlderThan` with a `PurgeQuery` carrying the viewer's scope and the
policy's category and cutoff. Sum the counts. Set `NoPolicies` when the
viewer has none, because zero-because-nothing-is-configured and
zero-because-nothing-is-old-enough are different answers.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the retention intents"
```

---

### Task 14: The reports group

**Files:**
- Create: `extension/contract/handlers_reports.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_reports_test.go`

**Interfaces:**
- Consumes: `viewScope`, `scopeFromPrincipal`, `mapStoreError` (Task 7), `VerifyReport` (Task 8).
- Produces: `ReportSummary`, `ReportDetail`, `GenerateReportInput{Type string, From, To string}`, `GenerateCustomInput`, `ExportReportInput{ID, Format string}`, `ExportReportResponse{Filename, ContentType, Content string}`.

- [ ] **Step 1: Add the intents**

```yaml
  - { name: reports.list,   kind: query, version: 1, capability: read }
  - { name: reports.detail, kind: query, version: 1, capability: read }
  - { name: reports.generate, kind: command, version: 1, capability: write,
      invalidates: [reports.list] }
  - { name: reports.generateCustom, kind: command, version: 1, capability: write,
      invalidates: [reports.list] }
  - { name: reports.export, kind: query, version: 1, capability: read }
```

- [ ] **Step 2: Write the failing tests**

```go
// The engine persists the report itself. Saving it again stored every
// dashboard-generated report twice in the templ path, which is a bug that
// file's own comment records. Do not inherit it.
func TestGenerateDoesNotSaveTheReportASecondTime(t *testing.T) {
	spy := &reportStoreSpy{}
	h := reportsGenerateHandler(Deps{Store: spy, Engine: stubEngine()})
	_, err := h(context.Background(), GenerateReportInput{Type: "soc2"},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("reports.generate: %v", err)
	}
	if spy.saveCalls != 0 {
		t.Fatalf("SaveReport called %d times; the engine already persisted it", spy.saveCalls)
	}
}

func TestGenerateRejectsAnUnknownType(t *testing.T) {
	h := reportsGenerateHandler(Deps{Store: newStubStore(), Engine: stubEngine()})
	_, err := h(context.Background(), GenerateReportInput{Type: "pci"},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err == nil {
		t.Fatal("accepted an unknown report type")
	}
}

// The scope confines what the report aggregates. Generating unscoped
// produced a report describing every tenant's events, saved under an empty
// scope so nobody could see it again. contributor.go records that too.
func TestGenerateIsConfinedToTheViewersScope(t *testing.T) {
	spy := &engineSpy{}
	h := reportsGenerateHandler(Deps{Store: newStubStore(), Engine: spy.engine()})
	_, _ = h(context.Background(), GenerateReportInput{Type: "soc2"},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if spy.lastAppID != "app-1" || spy.lastTenantID != "tenant-a" {
		t.Fatalf("report scope = %q/%q, want app-1/tenant-a", spy.lastAppID, spy.lastTenantID)
	}
}

// Review Focus 2, on export. A report is evidence about a tenant's events,
// so exporting one by ID must check ownership exactly as reading it does.
func TestExportRefusesAnotherTenantsReport(t *testing.T) {
	h := reportsExportHandler(Deps{
		Store:  storeWithReport(&compliance.Report{AppID: "app-2", TenantID: "tenant-b"}),
		Engine: stubEngine(),
	})
	_, err := h(context.Background(), ExportReportInput{ID: id.NewReportID().String(), Format: "csv"},
		principalWith(map[string]any{"app_id": "app-1", "tenant_id": "tenant-a"}))
	if err == nil {
		t.Fatal("exported another tenant's compliance report")
	}
}

func TestExportRejectsAnUnknownFormat(t *testing.T) {
	h := reportsExportHandler(Deps{
		Store:  storeWithReport(&compliance.Report{AppID: "app-1"}),
		Engine: stubEngine(),
	})
	_, err := h(context.Background(), ExportReportInput{ID: id.NewReportID().String(), Format: "pdf"},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err == nil {
		t.Fatal("accepted an unsupported export format")
	}
}

// A report can embed a verification. When it does, the detail page renders
// it with the same three-state rules as the verify page, so it has to cross
// the wire in the same shape rather than as a boolean.
func TestReportDetailCarriesAnEmbeddedVerificationInFull(t *testing.T) {
	h := reportsDetailHandler(Deps{Store: storeWithReport(&compliance.Report{
		AppID:        "app-1",
		Verification: &verify.Report{Valid: true, HeadChecked: true, CheckpointsChecked: false},
	})})
	out, err := h(context.Background(), GetReportInput{ID: id.NewReportID().String()},
		principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("reports.detail: %v", err)
	}
	if out.Verification == nil {
		t.Fatal("the embedded verification was dropped")
	}
	if !out.Verification.HeadChecked || out.Verification.CheckpointsChecked {
		t.Error("the embedded verification's checked flags did not survive")
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run TestGenerate -v` and
`go test ./extension/contract/ -run TestExport -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

```go
// GenerateReportInput covers the three fixed frameworks, which share an
// identical input shape: a period plus scope plus who asked. Custom reports
// take a title and section definitions, so they get their own intent rather
// than a partly-ignored field here.
type GenerateReportInput struct {
	Type string `json:"type"` // soc2 | hipaa | euaiact
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}
```

Default the period to the last 90 days when `From` and `To` are empty,
matching what the templ page did, and parse both as RFC3339 otherwise.
`GeneratedBy` comes from `p.User.Subject`, never the request.

Switch on `Type` over exactly `"soc2"`, `"hipaa"`, `"euaiact"` and return
`CodeBadRequest` in the default branch. Do not accept a capitalised variant:
a whitelist that quietly normalises is a whitelist somebody later widens.

`reportsExportHandler` fetches the report, checks `owns`, then calls
`deps.Engine.Export(ctx, r, compliance.Format(in.Format), &buf)` into a
`bytes.Buffer` and returns the bytes as a string with a filename and content
type. Validate `Format` against exactly `json`, `csv`, `markdown`, `html`.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the report intents"
```

---

### Task 15: The settings group

One intent, and it carries three facts the templ settings page never showed.
Those three are what let an operator tell what their verification result is
actually worth on their deployment.

**Files:**
- Create: `extension/contract/handlers_settings.go`
- Modify: `extension/contract/manifest.yaml`, `extension/contract/contract.go`
- Test: `extension/contract/handlers_settings_test.go`

**Interfaces:**
- Consumes: `Deps`, `SurfaceConfig`, `scopeFromPrincipal` (Task 7).
- Produces: `SettingsDetail`.

- [ ] **Step 1: Add the intent**

```yaml
  - { name: settings.detail, kind: query, version: 1, capability: read }
```

- [ ] **Step 2: Write the failing tests**

```go
// The default deployment: plain digest, no checkpoints. The settings panel
// is where an operator finds out, and it must not describe that state with
// a word stronger than it earns.
func TestSettingsReportsADefaultDeploymentHonestly(t *testing.T) {
	h := settingsDetailHandler(Deps{
		Store:  newStubStore(),
		Config: SurfaceConfig{BackendName: "sqlite"},
	})
	out, err := h(context.Background(), struct{}{}, principalWith(map[string]any{"app_id": "app-1"}))
	if err != nil {
		t.Fatalf("settings.detail: %v", err)
	}
	if out.CheckpointingConfigured {
		t.Error("reported checkpointing as configured when no store or signer was supplied")
	}
	if out.DigestScheme != string(hash.SchemePlainV4) {
		t.Errorf("DigestScheme = %q, want the plain default", out.DigestScheme)
	}
}

func TestSettingsReportsCheckpointingOnlyWhenBothStoreAndSignerExist(t *testing.T) {
	// A store without a signer proves nothing: whoever could write the
	// checkpoint row could write a fabricated one. So it is not
	// "configured" until both are present.
	h := settingsDetailHandler(Deps{Store: newStubStore(), CheckpointStore: stubCheckpointStore{}})
	out, _ := h(context.Background(), struct{}{}, principalWith(map[string]any{"app_id": "app-1"}))
	if out.CheckpointingConfigured {
		t.Error("a checkpoint store without a signer was reported as configured")
	}
}

// The backend determines what a verification result is worth. Redis neither
// recomputes the chain under a lock nor holds checkpoints, so an operator
// reading a result there deserves to know it means less than the same result
// on postgres.
func TestSettingsReportsTheBackendAndWhetherItHoldsCheckpoints(t *testing.T) {
	h := settingsDetailHandler(Deps{
		Store:  newStubStore(),
		Config: SurfaceConfig{BackendName: "redis"},
	})
	out, _ := h(context.Background(), struct{}{}, principalWith(map[string]any{"app_id": "app-1"}))
	if out.BackendName != "redis" {
		t.Errorf("BackendName = %q, want redis", out.BackendName)
	}
	if out.BackendHoldsCheckpoints {
		t.Error("redis returns ErrUnsupported for every checkpoint call and must not be reported as holding them")
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./extension/contract/ -run TestSettings -v`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

```go
// SettingsDetail is what this deployment is configured to do, which for
// Chronicle is mostly a statement about how much its verification is worth.
//
// The last four fields are new and are the reason this intent exists. The
// templ settings page showed batch sizes and intervals, which nobody needs,
// and said nothing about the digest scheme, checkpointing or the backend,
// which is everything.
type SettingsDetail struct {
	BatchSize           int    `json:"batchSize"`
	FlushInterval       string `json:"flushInterval"`
	RetentionInterval   string `json:"retentionInterval"`
	EnableCryptoErasure bool   `json:"enableCryptoErasure"`

	// DigestScheme is what this process writes under now. It is not
	// necessarily what existing events were written under: a chain that had
	// HMAC turned on later is unkeyed below its pin forever, which
	// streams.mine reports per span.
	DigestScheme string `json:"digestScheme"`

	// CheckpointingConfigured is true only when a store AND a signer are
	// both present.
	CheckpointingConfigured bool `json:"checkpointingConfigured"`

	BackendName             string `json:"backendName"`
	BackendHoldsCheckpoints bool   `json:"backendHoldsCheckpoints"`
}
```

Derive `DigestScheme` from `deps.HashChain`, defaulting to the plain scheme
when it is nil, because nil is what an unconfigured deployment has and that
is exactly a plain chain.

Determine `BackendHoldsCheckpoints` by probing:
`deps.Store.LatestCheckpoint(ctx, id.Nil)` and treating
`checkpoint.ErrUnsupported` as false and anything else, including
`ErrNotFound`, as true. That is the same probe `buildCheckpointer` uses, so
the two agree.

- [ ] **Step 5: Add this group to the registration table**

- [ ] **Step 6: Run everything, and confirm all 29 intents are present**

Run: `go build ./... && go test ./...`
Expected: PASS, and the parity test from Task 7 now covers all 29.

Add one assertion to `manifest_test.go` while you are here:

```go
func TestManifestDeclaresTwentyNineIntents(t *testing.T) {
	m, err := loader.Load(bytes.NewReader(manifestYAML), "manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	if len(m.Intents) != 29 {
		t.Fatalf("manifest declares %d intents, want 29. If you added or removed one "+
			"deliberately, update this number and the spec's intent table together",
			len(m.Intents))
	}
}
```

- [ ] **Step 7: Commit**

```bash
git add extension/contract/
git commit -m "feat(contract): add the settings intent and complete the 29"
```

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
