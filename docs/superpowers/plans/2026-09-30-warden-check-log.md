# Warden check log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give warden's check log a dashboard surface an operator can hunt with at 3am: a filtered, paged list, a detail page that says what decided each check and links to it, and a page that never lets an empty table pass for an idle system.

**Architecture:** One warden store change (a `Cached` predicate on `checklog.QueryFilter`, on all four backends, proven by the conformance suite) and one engine change (the check-log writer counts what it failed to record). Two contract intents sit on those, `checkLogs.list` and `checkLogs.detail`. Two React pages render them, and the overview's recent checks gain links into them.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0` (dashboard contract, dispatcher), `github.com/xraph/grove v1.6.3`, testcontainers (postgres:16-alpine, mongo:7), React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, slice 10. The sections "The check log cannot have a fixed colour mapping", "What the check log cannot be filtered by" and "Three absences this dashboard could render as answers" are the design authority for Tasks 5 and 6.

**Predecessors:** plans `2026-09-23-warden-spine.md`, `2026-09-23-warden-roles-permissions.md`, `2026-09-29-warden-assignments-relations-resourcetypes.md` and `2026-09-29-warden-policies.md`. This plan assumes all four: the contract package and its three self-checking guards, the paging envelope, `tenantFrom`, the plugin package, the namespace filter, `warden-fixtures.mjs`, and the `/roles/:id` and `/policies/:id` detail routes the check detail links to.

**Scope note:** this is plan 3b, the second half of the spec's "plan 3". Two things the spec puts in slice 10 wait for plan 4, because what they link to does not exist yet: the detail page's "Open in playground" (the playground is plan 4) and subject links to `/subjects/:kind/:id` (the subject view is plan 4). Plan 4 adds both to these pages.

## Global Constraints

- Contributor name is exactly `warden`. The plugin's `extension` field must match it.
- Contract DTOs are camelCase. Never return a warden domain struct (snake_case) on the wire.
- Every handler resolves its tenant with `tenantFrom(p, deps)`, never from the request context. An empty tenant id in a store filter matches every tenant's rows rather than none.
- Every intent that pages a stored collection embeds `PageRequest` and returns `PageMeta` beside `items`. No cursors.
- Namespace filter fields are `*string`: `nil` means every namespace, `""` means the tenant root, a path means that namespace.
- Every new handler is added to **three** self-checking guards, all sized against registrations parsed from `contract.go`'s source: `handlers_tenant_test.go`'s table, `manifest_test.go`'s `wantKind` map, and `authz.go`'s `intentPolicies` with its mirror `wantPolicies` in `authz_test.go`. An intent absent from `intentPolicies` is **denied** by the engine delegate. Extend them; never loosen an assertion.
- Every manifest intent line carries `requires: { warden: warden.engine }`.
- Check log authz is `read_audit` on `warden:check_log`, matching `api/checklog_handler.go:22` and `overview.recentChecks`.
- **Every sentence a page shows about a check must be true for every row it can appear on.** Verify against `engine.go` and `checklog_writer.go`, never against a comment. The facts below are verified; a task that needs another one reads the code.
- Decision badges: `outline` for `allow`, `secondary` for every deny, `destructive` for `error`. Never computed from the rows on screen (spec, "The check log cannot have a fixed colour mapping").
- Identifier values carry `font-mono text-xs`. The column an operator reads carries `font-medium`. Captions count the server's `total`. Empty states say which kind of empty. The tenant root renders as `/`. Filter changes reset paging.
- Tests: every exposed list filter and the paging are asserted, on the Go side against a real store and on the React side against the request the page sends. React tests use `fireEvent`, `toBeTruthy()` and `.textContent`; no `user-event`, no `jest-dom`.
- No em dashes anywhere, including comments, JSX text and commit messages. No `Co-Authored-By` trailers and no Claude or Anthropic attribution.
- Both trees are shared with other live sessions holding over a hundred uncommitted files. Commit by explicit path; stage new files with `git add <path>` first; never `git add -A`, `git commit -a` or `--amend`; verify by SHA, never HEAD. Restore a mutated file only from its own backup or `git checkout -- <exact path>`; never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. Delete only files you created, by exact name, never with a glob. Never point anything at local port 5432.

## What the engine actually does

Verified against `warden/engine.go`, `warden/evaluator.go` and `warden/checklog_writer.go` for this plan. Tasks rely on every line.

- **Exactly one writer.** `checkLogWriter.writeBatch` (`checklog_writer.go:111`) is the only non-test caller of `CreateCheckLog`. Every row was built by `buildCheckLogEntry` (`engine.go:395`).
- **`decision` is `"error"` exactly when the check failed.** `buildCheckLogEntry` sets `decision = "error"` when `result` is nil or `evalErr` is non-empty. The only caller passing an error is `failCheck` (`engine.go:343`), which passes a nil result. So every row with a non-empty `error` has `decision "error"`, and the decision filter already finds every failure.
- **A failed check returned no decision.** `failCheck` returns `(nil, err)`: the caller got an error, not an allow or a deny.
- **The decisions are** `allow`, `deny`, `deny_explicit`, `deny_default`, `deny_no_roles`, `deny_no_perms`, `deny_condition`, `deny_relation` (`warden.go:92-113`), plus `error`.
- **A cached row skipped evaluation.** On a cache hit (`engine.go:244-252`) the engine reuses a stored result, writes `cached: true`, and overwrites `EvalTimeNs` with the time since the check started, which is a cache lookup, not an evaluation.
- **What `matchedBy` holds.** RBAC writes `{source: "rbac", ruleId: <role id>, detail: "role grants <perm>"}` (`engine.go:595`). ABAC writes `{source: "abac", ruleId: <policy id>, detail: "policy \"<name>\" (<effect>)"}` (`evaluator.go:112`), for an allow and for an explicit deny. ReBAC writes `source: "rebac"` with **no** `ruleId` (`engine.go:619,636,658`). The other denials (`deny_default`, `deny_no_roles` and the rest) usually carry no `matchedBy` at all.
- **Rule ids point at rules as they are now.** A role or policy can be edited or deleted after the check ran; `matchedBy.detail` is the text recorded at check time.
- **Obligations** come from every matched policy, allow or deny, regardless of which decision won (`mergeDecisions`, `engine.go:696`).
- **`metadata` is never set** by `buildCheckLogEntry`. Nothing renders it.
- **Logging off means no writer.** With `EnableCheckLog` false, `NewEngine` builds no writer (`engine.go:100`) and `writeCheckLog` returns early (`engine.go:389`). `config.detail` reports this as `checkLogEnabled`.
- **Two ways a decided check leaves no row.** `Enqueue` drops the entry when the bounded queue is full or the writer has stopped (`checklog_writer.go:62-73`), and `writeBatch` logs and discards an entry whose `CreateCheckLog` fails (`checklog_writer.go:111-114`). Today neither is counted anywhere the dashboard can read; `Metrics.CheckLogDropped` covers only the first and goes to the metrics backend.
- **Stores list newest first** (`created_at DESC, id DESC`), and the `after` and `before` bounds are **inclusive** on all four backends.
- **On mongo, a check log written before `cached` existed has no `cached` field.** Postgres and sqlite added the column `NOT NULL DEFAULT` false/0 (`check_logs_v2`), so every row has it; mongo has no backfill.
- **`PurgeCheckLogs(ctx, before)` takes no tenant id.** It deletes every tenant's rows older than `before`.

## Deviations from the spec

The spec is the binding authority. Each deviation below corrects a fact in it; the spec is corrected in the same commit as this plan.

1. **No `checkLogs.purge`.** The spec's intent table lists it. `PurgeCheckLogs` has no tenant parameter, so a dashboard purge would let one tenant delete every tenant's audit trail. Retention already runs through `maintenance.run` (`CheckLogRetention`), which is the operator's control. A tenant-scoped purge needs a new store method on four backends and is not worth it here. The intent surface is 47, not 48.
2. **No `HasError` filter.** The spec says "you cannot ask for evaluation failures" and proposes `HasError *bool`. You can: `decision "error"` is set on exactly the rows that carry an error (see above), so the decision filter answers it, and it also catches a failure whose error message was empty. Only `Cached *bool` is added. `MatchedRuleID` stays deferred, as the spec recommends.
3. **The lost-row count is counted by the writer, not read from metrics.** The spec says to surface the dropped counter "when the metrics backend can answer for it". `forgeMetrics` counters can answer (`Counter.Value()`), but `NoopMetrics` cannot, and the metrics counter misses write failures. The writer counts both itself, so the page can always answer.
4. **The list shows neither `matchedBy` nor `obligations` as columns.** The spec says the list renders them. A column needs a Go list DTO change plus the fixture and the page, and that is more than this slice is worth. Instead each row links to the detail page, which shows both, and the filter bar says checks cannot be filtered by the rule that decided them. The cost is one click to see which rule decided an allow. A `deny_explicit`'s reason already names its policy.

## Review Focus

1. **A mongo row with no `cached` field.** Written before the field existed, it must match `cached: false`, not vanish from both filters. A filter of `{cached: false}` misses it; `{cached: {$ne: true}}` does not. Test in Task 1.
2. **List and count drifting apart.** If the `cached` predicate reaches `ListCheckLogs` but not `CountCheckLogs`, the pager promises pages that come back empty. Every backend builds both from one helper, and the conformance case asserts both. Task 1.
3. **A filter that silently matches nothing.** A misspelt decision such as `denied`, or an unparseable time, would return an empty page that reads as "nothing happened". Both are refused with `BAD_REQUEST` in Task 3, and the page's empty states tell filtered, unfiltered and logging-off apart in Task 5.
4. **Another tenant's check by id.** `checkLogs.detail` with a valid id from another tenant must return `NOT_FOUND`, never the row. Task 3.
5. **A cached row read as an evaluation.** Its `evalTimeNs` is a cache lookup, and its `matchedBy` is the stored result's, not a fresh evaluation. The detail page labels the time "lookup time" and says the engine evaluated no rule. Task 6.

## Design

The kit's visual language is fixed, as in plan 3a.

- **The filter bar is the instrument.** The spec moves the scan off colour and onto filters. So the bar carries every filter the store can answer: namespace, decision, cached, time window, and exact subject, action and resource. It also says in words the one question it cannot answer yet: which rule decided a check.
- **The decision badge is weak on purpose.** Allow `outline`, deny `secondary`, error `destructive`. The raw decision string is shown, because it is the value an operator filters by and greps for.
- **Absence says which absence.** Three different empties: logging is off, nothing recorded yet, and nothing matches the filters. Lost checks are counted above the table when there are any.
- **Detail reads as a sentence, then evidence.** The request as a line of identifiers, the decision and its reason, then "decided by" as a list of links to the rules, then obligations. Correlation ids go in the aside.

```
Check log                                              12,408 checks
namespace [all v]  decision [all v]  cached [any v]  time [any time v]
subject [kind v][id      ]  action [      ]  resource [type    ][id    ]  Apply  Clear
Checks cannot be filtered by the rule that decided them yet.

This server failed to record 3 checks since it started 2 hours ago: ...

When            Subject      Action  Resource          Namespace  Decision      Cached
09:14:02  ->    user:alice   read    document:readme   /          allow         not cached
```

```
user:alice   read   document:readme   in /                 (aside)
deny_explicit                                              check id   chk_01...
denied by policy "contractor-lockout"                      namespace  /
                                                           app        app_01...
decided by   policy "contractor-lockout" (deny)            request    req_7f...
emits        notify-security                               trace      4bf9...
evaluation time  0.90 ms                                   ip         10.0.4.7
                                                           when       09:14:02
```

---

## File Structure

**warden repository** (`/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`)

| File | Responsibility |
|---|---|
| `checklog/checklog.go` (modify) | `QueryFilter.Cached *bool` |
| `store/{memory,postgres,sqlite,mongo}/store.go` (modify) | One filter helper per backend, used by list and count, with the `cached` predicate |
| `store/contract/list_filters.go` (modify) | Conformance: `Cached` on list and count, alone and combined |
| `store/mongo/list_filters_integration_test.go` (modify) | A row with no `cached` field matches `Cached: false` |
| `checklog_writer.go`, `engine.go` (modify) | Count queue-full drops and failed writes; `Engine.CheckLogLoss` |
| `checklog_writer_test.go`, `checklog_loss_test.go` (modify, create) | Counter tests |
| `extension/contract/handlers_checklogs.go` (create) | DTOs, input validation, `checkLogs.list`, `checkLogs.detail` |
| `extension/contract/handlers_checklogs_test.go` (create) | Handler tests |
| `extension/contract/{contract.go,manifest.yaml,authz.go}` and the three guard tests (modify) | Registration and guards |

**forge-dashboard repository** (`/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`)

| File | Responsibility |
|---|---|
| `packages/fixture-server/warden-fixtures.mjs` (modify) | Two handlers mirroring the Go validation, seed covering every decision, source and absence |
| `packages/plugin-warden/src/components/check-log.tsx` (create) | Shared types, `DECISIONS`, `decisionVariant`, `CheckRequestLine` |
| `packages/plugin-warden/src/pages/check-log.tsx` (create) | List |
| `packages/plugin-warden/src/pages/check-log-detail.tsx` (create) | Detail |
| `packages/plugin-warden/src/pages/overview.tsx` (modify) | Import the shared pieces; link rows and the panel into the check log |
| `packages/plugin-warden/src/index.tsx` (modify) | Routes and nav |

---

## Task 1: Filter check logs by `cached` on all four backends

**Files:**
- Modify: `checklog/checklog.go` (the `QueryFilter` struct)
- Modify: `store/memory/store.go` (`filterCheckLogs`, near line 1280)
- Modify: `store/postgres/store.go` (`ListCheckLogs`/`CountCheckLogs`, lines 1705-1800)
- Modify: `store/sqlite/store.go` (`ListCheckLogs`/`CountCheckLogs`, lines 1881-1980)
- Modify: `store/mongo/store.go` (`ListCheckLogs`/`CountCheckLogs`, lines 1787-1880)
- Modify: `store/contract/list_filters.go` (`runListFilterCheckLogs`, line 230)
- Modify: `store/mongo/list_filters_integration_test.go`

**Interfaces:**
- Produces: `checklog.QueryFilter.Cached *bool` (`json:"cached,omitempty"`). `nil` means either, `true` only cached rows, `false` only rows that were evaluated. Task 3 consumes it.

- [ ] **Step 1: Add the field**

In `checklog/checklog.go`, add to `QueryFilter` after `Decision`:

```go
	// Cached narrows to rows served from the result cache (true) or rows
	// the engine evaluated (false). Nil means either.
	Cached *bool `json:"cached,omitempty"`
```

- [ ] **Step 2: Write the failing conformance case**

Replace `runListFilterCheckLogs` in `store/contract/list_filters.go` with a version that keeps the existing `ResourceID` assertion and adds `Cached`. Every assertion checks list **and** count, because a predicate added to one and not the other is the likeliest bug (Review Focus 2):

```go
func runListFilterCheckLogs(t *testing.T, mk MakeStore) {
	s, cleanup := mk(t)
	defer cleanup()
	ctx := context.Background()

	mkLog := func(resourceID, decision string, cached bool) {
		e := &checklog.Entry{
			ID: id.NewCheckLogID(), TenantID: "t1",
			SubjectKind: "user", SubjectID: "alice", Action: "read",
			ResourceType: "doc", ResourceID: resourceID, Decision: decision,
			Cached: cached,
		}
		if err := s.CreateCheckLog(ctx, e); err != nil {
			t.Fatalf("seed check log (resource_id=%q): %v", resourceID, err)
		}
	}
	mkLog("d1", "allow", false)
	mkLog("d2", "allow", true)
	mkLog("d3", "deny_default", true)
	mkLog("d4", "deny_default", false)

	resources := func(label string, f *checklog.QueryFilter, want ...string) {
		t.Helper()
		got, err := s.ListCheckLogs(ctx, f)
		if err != nil {
			t.Fatalf("%s: ListCheckLogs: %v", label, err)
		}
		gotIDs := make([]string, 0, len(got))
		for _, e := range got {
			gotIDs = append(gotIDs, e.ResourceID)
		}
		sort.Strings(gotIDs)
		if !equalStrings(gotIDs, want) {
			t.Errorf("%s: list want %v, got %v", label, want, gotIDs)
		}
		n, err := s.CountCheckLogs(ctx, f)
		if err != nil {
			t.Fatalf("%s: CountCheckLogs: %v", label, err)
		}
		if n != int64(len(want)) {
			t.Errorf("%s: count want %d, got %d", label, len(want), n)
		}
	}

	yes, no := true, false
	resources("ResourceID=d1", &checklog.QueryFilter{TenantID: "t1", ResourceID: "d1"}, "d1")
	resources("Cached=nil", &checklog.QueryFilter{TenantID: "t1"}, "d1", "d2", "d3", "d4")
	resources("Cached=true", &checklog.QueryFilter{TenantID: "t1", Cached: &yes}, "d2", "d3")
	resources("Cached=false", &checklog.QueryFilter{TenantID: "t1", Cached: &no}, "d1", "d4")
	resources("Cached=true+Decision", &checklog.QueryFilter{TenantID: "t1", Cached: &yes, Decision: "deny_default"}, "d3")
	resources("Cached=false+Decision", &checklog.QueryFilter{TenantID: "t1", Cached: &no, Decision: "allow"}, "d1")
}
```

Add `"sort"` to the file's imports if it is not there.

- [ ] **Step 3: Run it to see it fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./store/memory/ ./store/sqlite/ -run 'ListFilters/CheckLogs' -v`
Expected: FAIL on `Cached=true` and `Cached=false` (the predicate is ignored, so four rows come back).

- [ ] **Step 4: Memory**

In `store/memory/store.go` `filterCheckLogs`, after the `Decision` check:

```go
			if filter.Cached != nil && e.Cached != *filter.Cached {
				continue
			}
```

- [ ] **Step 5: Postgres, one helper for list and count**

In `store/postgres/store.go`, extract the duplicated `if filter != nil { ... }` block from `ListCheckLogs` and `CountCheckLogs` into one function, add the `cached` predicate there, and call it from both:

```go
// whereCheckLogs applies a QueryFilter's predicates. ListCheckLogs and
// CountCheckLogs both build from it, so a pager's total always counts the
// rows the list would return.
func whereCheckLogs(q *pgdriver.SelectQuery, filter *checklog.QueryFilter) *pgdriver.SelectQuery {
	if filter == nil {
		return q
	}
	// ... every existing predicate, moved here unchanged ...
	if filter.Cached != nil {
		if *filter.Cached {
			q = q.Where("cached = TRUE")
		} else {
			q = q.Where("cached = FALSE")
		}
	}
	return q
}
```

`ListCheckLogs` becomes `q := whereCheckLogs(s.pgdb.NewSelect(&models).OrderExpr("created_at DESC, id DESC"), filter)`, and `CountCheckLogs` becomes `q := whereCheckLogs(s.pgdb.NewSelect((*checkLogModel)(nil)), filter)`. Move the predicates byte for byte; do not change any of them.

- [ ] **Step 6: Sqlite, the same shape**

The same extraction in `store/sqlite/store.go` with `*sqlitedriver.SelectQuery`. The column is `INTEGER NOT NULL DEFAULT 0` (`check_logs_v2`), so the predicate is a literal, not a bound bool:

```go
	if filter.Cached != nil {
		if *filter.Cached {
			q = q.Where("cached = 1")
		} else {
			q = q.Where("cached = 0")
		}
	}
```

- [ ] **Step 7: Mongo, the same shape, and the missing field**

In `store/mongo/store.go`, extract the duplicated `bson.M` building into `func checkLogFilter(filter *checklog.QueryFilter) bson.M`, used by both, and add:

```go
		// A document written before the cached field existed has none, and
		// it was evaluated, not served from cache. {$ne: true} matches it;
		// {cached: false} would drop it from both answers.
		if filter.Cached != nil {
			if *filter.Cached {
				f["cached"] = true
			} else {
				f["cached"] = bson.M{"$ne": true}
			}
		}
```

- [ ] **Step 8: The mongo missing-field test**

In `store/mongo/list_filters_integration_test.go`, add:

```go
func TestMongoCheckLogWithoutCachedFieldCountsAsNotCached(t *testing.T) {
	s, cleanup := setupMongoStore(t)
	defer cleanup()
	ctx := context.Background()

	e := &checklog.Entry{
		ID: id.NewCheckLogID(), TenantID: "t1",
		SubjectKind: "user", SubjectID: "alice", Action: "read",
		ResourceType: "doc", ResourceID: "old", Decision: "allow",
	}
	if err := s.CreateCheckLog(ctx, e); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Make it look like a row written before the field existed.
	res, err := s.mdb.Collection(colCheckLogs).UpdateOne(ctx,
		bson.M{"_id": e.ID.String()}, bson.M{"$unset": bson.M{"cached": ""}})
	if err != nil || res.ModifiedCount != 1 {
		t.Fatalf("unset cached: modified=%v err=%v", res, err)
	}

	no, yes := false, true
	got, err := s.ListCheckLogs(ctx, &checklog.QueryFilter{TenantID: "t1", Cached: &no})
	if err != nil || len(got) != 1 {
		t.Fatalf("Cached=false: want the old row, got %d (err %v)", len(got), err)
	}
	if n, err := s.CountCheckLogs(ctx, &checklog.QueryFilter{TenantID: "t1", Cached: &no}); err != nil || n != 1 {
		t.Fatalf("Cached=false count: want 1, got %d (err %v)", n, err)
	}
	if got, _ := s.ListCheckLogs(ctx, &checklog.QueryFilter{TenantID: "t1", Cached: &yes}); len(got) != 0 {
		t.Fatalf("Cached=true: want no rows, got %d", len(got))
	}
}
```

If `_id` is not the stored id's string form in this store, read `byID` in `store/mongo/store.go` and match it. Do not guess.

- [ ] **Step 9: Run every backend**

Run: `go test ./store/memory/ ./store/sqlite/ -run 'ListFilters' -v`, then the integration suites the way their `testharness_test.go` files describe (they start their own postgres:16-alpine and mongo:7 containers; never point them at local port 5432): `go test -tags integration ./store/postgres/ ./store/mongo/ -run 'ListFilters|CheckLogWithoutCached' -v`. Read each harness first for the exact tag and environment it needs.
Expected: PASS on all four. Then mutate: delete the `cached` predicate from **count only** in one backend's helper call path (for example call the pre-extraction count code) and confirm `Cached=true` fails on count; restore from your own backup.

- [ ] **Step 10: Commit**

```bash
git add checklog/checklog.go store/memory/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/contract/list_filters.go store/mongo/list_filters_integration_test.go
git commit -m "feat(checklog): filter check logs by whether the cache served them" -- checklog/checklog.go store/memory/store.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/contract/list_filters.go store/mongo/list_filters_integration_test.go
```

---

## Task 2: Count the checks the log failed to record

**Files:**
- Modify: `checklog_writer.go`
- Modify: `engine.go` (add the accessor beside `Store()` and `Config()`, near line 108)
- Modify: `checklog_writer_test.go`
- Create: `checklog_loss_test.go`

**Interfaces:**
- Produces:

```go
// CheckLogLoss counts the checks this engine decided but did not record.
type CheckLogLoss struct {
	// QueueFull counts entries dropped because the writer's bounded queue
	// was full, or because the writer had already stopped.
	QueueFull uint64
	// WriteFailed counts entries the store refused to write.
	WriteFailed uint64
	// Since is when the writer started counting: engine construction.
	Since time.Time
}

// CheckLogLoss reports how many decided checks left no check log row since
// this engine started. ok is false when check logging is off, since then
// nothing is recorded at all and there is nothing to lose.
func (e *Engine) CheckLogLoss() (loss CheckLogLoss, ok bool)
```

Task 3 consumes it.

- [ ] **Step 1: Write the failing writer tests**

In `checklog_writer_test.go`, extend the two existing tests rather than adding parallel ones:

- `TestCheckLogWriter_DropsWhenQueueFull`: after the metrics poll succeeds, assert `w.loss().QueueFull >= 1`, and that it equals the metrics `dropped` count read after `Stop` (both count the same events).
- `TestCheckLogWriter_EnqueueAfterStopIsDropped`: assert `w.loss().QueueFull == 1`.
- `TestCheckLogWriter_WriteErrorDoesNotBlockOtherEntries`: after `Stop`, assert `w.loss().WriteFailed == 3` and `w.loss().QueueFull == 0`.

And add:

```go
func TestCheckLogWriter_LossStartsAtZeroWithAStartTime(t *testing.T) {
	before := time.Now()
	w := newCheckLogWriter(&recordingCheckLogStore{}, 10, log.NewNoopLogger(), &fakeWriterMetrics{})
	defer func() { _ = w.Stop(context.Background()) }()
	got := w.loss()
	if got.QueueFull != 0 || got.WriteFailed != 0 {
		t.Fatalf("fresh writer: want zero loss, got %+v", got)
	}
	if got.Since.Before(before) || got.Since.After(time.Now()) {
		t.Fatalf("Since %v is not when the writer started", got.Since)
	}
}
```

- [ ] **Step 2: Run to see them fail**

Run: `go test . -run 'CheckLogWriter' -v`
Expected: FAIL to compile (`w.loss` undefined).

- [ ] **Step 3: Implement the counters**

In `checklog_writer.go`, add fields to `checkLogWriter`:

```go
	// queueFull and writeFailed count entries that never became a row,
	// so a reader can tell an idle log from a lossy one. They count the
	// same drops Metrics.CheckLogDropped reports, plus failed writes,
	// which that metric does not cover.
	queueFull   atomic.Uint64
	writeFailed atomic.Uint64
	startedAt   time.Time
```

Set `startedAt: time.Now()` in `newCheckLogWriter`. In `Enqueue`, call `w.queueFull.Add(1)` beside each of the two `w.metrics.CheckLogDropped()` calls. In `writeBatch`, call `w.writeFailed.Add(1)` in the error branch. Add:

```go
func (w *checkLogWriter) loss() CheckLogLoss {
	return CheckLogLoss{
		QueueFull:   w.queueFull.Load(),
		WriteFailed: w.writeFailed.Load(),
		Since:       w.startedAt,
	}
}
```

Put `CheckLogLoss` (the type, doc comments as in Interfaces) in `checklog_writer.go`. Import `sync/atomic`.

- [ ] **Step 4: The engine accessor and its test**

In `engine.go`, beside `Config()`:

```go
// CheckLogLoss reports how many decided checks left no check log row since
// this engine started. ok is false when check logging is off.
func (e *Engine) CheckLogLoss() (CheckLogLoss, bool) {
	if e.checkLogWriter == nil {
		return CheckLogLoss{}, false
	}
	return e.checkLogWriter.loss(), true
}
```

Create `checklog_loss_test.go` (package `warden`):

```go
func TestEngineCheckLogLossIsUnavailableWhenLoggingIsOff(t *testing.T) {
	off := false
	eng, err := NewEngine(WithStore(memory.New()), WithConfig(Config{EnableCheckLog: &off}))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	if _, ok := eng.CheckLogLoss(); ok {
		t.Fatal("want ok=false with check logging off")
	}
}

func TestEngineCheckLogLossStartsAtZeroWhenLoggingIsOn(t *testing.T) {
	eng, err := NewEngine(WithStore(memory.New()))
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	defer func() { _ = eng.Stop(context.Background()) }()
	loss, ok := eng.CheckLogLoss()
	if !ok {
		t.Fatal("want ok=true with check logging on by default")
	}
	if loss.QueueFull != 0 || loss.WriteFailed != 0 || loss.Since.IsZero() {
		t.Fatalf("want zero loss with a start time, got %+v", loss)
	}
}
```

`Engine.Stop(ctx)` is at `engine.go:149`. Package `warden`'s tests already import `store/memory` (`engine_test.go:15`), so there is no cycle.

- [ ] **Step 5: Run and race**

Run: `go test . -run 'CheckLog' -race -v` and then `go test ./... ` for the whole module.
Expected: PASS, no race reports.

- [ ] **Step 6: Commit**

```bash
git add checklog_loss_test.go
git commit -m "feat(checklog): count the checks the log failed to record" -- checklog_writer.go engine.go checklog_writer_test.go checklog_loss_test.go
```

---

## Task 3: `checkLogs.list` and `checkLogs.detail`

**Files:**
- Create: `extension/contract/handlers_checklogs.go`
- Create: `extension/contract/handlers_checklogs_test.go`
- Modify: `extension/contract/handlers_overview.go` (only the comment on `projectCheckLog`, which says "in a later plan")
- Modify: `extension/contract/contract.go`, `manifest.yaml`, `authz.go`
- Modify: `extension/contract/handlers_tenant_test.go`, `manifest_test.go`, `authz_test.go`

**Interfaces:**
- Consumes: `checklog.QueryFilter.Cached` (Task 1), `warden.Engine.CheckLogLoss()` (Task 2), `CheckLogSummary` and `projectCheckLog` (`handlers_overview.go`), `PageRequest`, `PageMeta`, `newPageMeta`, `tenantFrom`, `requireEngine`, `mapWardenError`, `badRequest`.
- Produces (the wire contract Tasks 4 to 6 mirror):

```go
type CheckLogsListInput struct {
	PageRequest
	NamespacePath *string `json:"namespacePath,omitempty"`
	SubjectKind   string  `json:"subjectKind,omitempty"`
	SubjectID     string  `json:"subjectId,omitempty"`
	Action        string  `json:"action,omitempty"`
	ResourceType  string  `json:"resourceType,omitempty"`
	ResourceID    string  `json:"resourceId,omitempty"`
	Decision      string  `json:"decision,omitempty"`
	Cached        *bool   `json:"cached,omitempty"`
	// After and Before are RFC 3339 instants, both inclusive. Empty means
	// unbounded.
	After  string `json:"after,omitempty"`
	Before string `json:"before,omitempty"`
}

// CheckLogLossView is the engine's count of decided checks that left no
// row. It is per server process and covers every tenant that process
// serves, because the writer's queue is shared.
type CheckLogLossView struct {
	QueueFull   uint64 `json:"queueFull"`
	WriteFailed uint64 `json:"writeFailed"`
	Since       string `json:"since"`
}

type CheckLogsListResponse struct {
	PageMeta
	Items []CheckLogSummary `json:"items"`
	// NotRecorded is absent when check logging is off.
	NotRecorded *CheckLogLossView `json:"notRecorded,omitempty"`
}

type CheckLogDetailInput struct {
	ID string `json:"id"`
}

type CheckLogMatch struct {
	Source string `json:"source"`
	RuleID string `json:"ruleId,omitempty"`
	Detail string `json:"detail,omitempty"`
}

type CheckLogDetail struct {
	CheckLogSummary
	AppID       string          `json:"appId,omitempty"`
	MatchedBy   []CheckLogMatch `json:"matchedBy"`
	Obligations []string        `json:"obligations"`
	RequestIP   string          `json:"requestIp,omitempty"`
	RequestID   string          `json:"requestId,omitempty"`
	TraceID     string          `json:"traceId,omitempty"`
}
```

`matchedBy` and `obligations` are always arrays, never `null`, so the page never has to tell "none" from "not sent".

- [ ] **Step 1: Write the failing handler tests**

In `handlers_checklogs_test.go`, seed a memory store directly with `CreateCheckLog` (never through `Check`, whose writer is asynchronous) and cover:

1. **Every filter, one at a time**, against a seed where each filter has exactly one matching row and at least one non-matching row: `namespacePath` (nil, `""` for root, `"eng"`), `subjectKind`, `subjectId`, `action`, `resourceType`, `resourceId`, `decision`, `cached` (true and false), `after`, `before`. For each, assert the returned ids **and** `total`.
2. **Paging**: seed 30 rows; `{limit: 10, offset: 20}` returns 10 rows, `total` 30, `limit` 10, `offset` 20, newest first.
3. **Refusals, each `BAD_REQUEST`**: `decision: "denied"`; `after: "yesterday"`; `before: "2026-13-40T00:00:00Z"`; `after` later than `before`. Assert the message names the field.
4. **Tenant isolation**: a row in tenant `t2` never appears in a `t1` list; `checkLogs.detail` for that row's id as `t1` returns `NOT_FOUND`.
5. **Detail**: an ABAC deny row with `matchedBy` `[{abac, pol_..., "policy \"x\" (deny)"}]`, obligations `["notify"]`, request ip, request id, trace id, app id. Assert every field of the reply. Then a row with no `matchedBy` and no obligations: assert both are empty **arrays** in the JSON (marshal the reply and check for `"matchedBy":[]` and `"obligations":[]`).
6. **Not an id**: `checkLogs.detail` with `id: "pol_123"` returns `BAD_REQUEST`; a well-formed unknown check log id returns `NOT_FOUND`.
7. **Loss**: with the default config, `notRecorded` is present with zeros and a parseable `since`; with `EnableCheckLog` false, `notRecorded` is absent (marshal and assert the key is missing).

Use `testEngine` (`handlers_config_test.go:15`) and `principalFor` (`handlers_overview_test.go:28`). To seed rows into the engine's store, build the engine over a `memory.New()` you keep a handle to, as `testEngine` does.

- [ ] **Step 2: Run to see them fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/ -run 'CheckLog' -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

`handlers_checklogs.go`:

```go
// handlers_checklogs.go: the check log list and one check's detail.
//
// There is no purge. PurgeCheckLogs takes no tenant id, so a dashboard
// purge would let one tenant delete every tenant's audit trail. Retention
// runs through maintenance.run.
package contract

// knownDecisions is every value buildCheckLogEntry can write. A decision
// filter outside it can only match nothing, and an empty page that reads
// as "nothing happened" is worse than a refusal.
var knownDecisions = map[string]bool{
	string(warden.DecisionAllow):         true,
	string(warden.DecisionDeny):          true,
	string(warden.DecisionDenyExplicit):  true,
	string(warden.DecisionDenyDefault):   true,
	string(warden.DecisionDenyNoRoles):   true,
	string(warden.DecisionDenyNoPerms):   true,
	string(warden.DecisionDenyCondition): true,
	string(warden.DecisionDenyRelation):  true,
	"error":                              true,
}

func parseInstant(field, raw string) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, badRequest(field + " is not an RFC 3339 time: " + raw)
	}
	return &t, nil
}
```

`checkLogsListHandler(deps)`: `requireEngine`, `tenantFrom`; refuse an unknown `decision` with `badRequest("decision is not one warden records: " + in.Decision)`; parse `after` and `before`; refuse `after` later than `before` with `badRequest("after is later than before")`; `limit, offset := in.Clamp()`; build one `checklog.QueryFilter` with every field, `TenantID: tenantID`; call `ListCheckLogs` with `Limit`/`Offset` and `CountCheckLogs` with the same filter minus paging; project rows with `projectCheckLog`; set `NotRecorded` from `deps.Engine.CheckLogLoss()` when `ok`, with `Since` as `rfc3339`. `Items` is `make([]CheckLogSummary, 0, len(entries))` so an empty page is `[]`.

`checkLogsDetailHandler(deps)`: parse with `id.ParseCheckLogID`, refusing with `badRequest("not a check log id: " + raw)`; `GetCheckLog(ctx, tenantID, logID)` through `mapWardenError` (its `ErrCheckLogNotFound` wraps `ErrNotFound`, which maps to `NOT_FOUND`); project `MatchedBy` and `Obligations` into non-nil slices.

Update the comment on `projectCheckLog` in `handlers_overview.go` to say it is shared with `checkLogs.list`.

- [ ] **Step 4: Register and guard**

- `contract.go`: `dispatcher.RegisterQuery(d, contributorName, "checkLogs.list", 1, checkLogsListHandler(deps))` and the same for `checkLogs.detail`, each with the file's existing error-wrapping shape.
- `manifest.yaml`, after `overview.recentChecks`:

```yaml
  - { name: checkLogs.list,   kind: query, version: 1, requires: { warden: warden.engine }, capability: read }
  - { name: checkLogs.detail, kind: query, version: 1, requires: { warden: warden.engine }, capability: read }
```

  and under `queries:`

```yaml
  # Checks arrive continuously, so a short stale time: an operator hunting
  # a denial is waiting for the next one.
  checkLogList:
    intent: checkLogs.list
    cache: { staleTime: 10s }
  checkLogDetail:
    intent: checkLogs.detail
    cache: { staleTime: 60s }
```

  `maintenance.run` purges check logs past retention, so add `checkLogs.list` and `checkLogs.detail` to its `invalidates`, and update the comment above it.
- `authz.go` `intentPolicies`: both `{"read_audit", "warden:check_log"}`. Mirror in `authz_test.go` `wantPolicies`.
- `manifest_test.go`: both in `wantKind` as `IntentKindQuery`; add both to the target list of `TestManifest_MaintenanceRunInvalidatesEverythingItPurges` and fix its comment ("the only view of them is overview.recentChecks" is no longer true); add `TestManifest_CheckLogQueriesAreDeclared` asserting the two queries, their intents and stale times.
- `handlers_tenant_test.go`: add both handlers to `tenantEnforcedHandlers`.

- [ ] **Step 5: Run the package and the guards**

Run: `go test ./extension/contract/ -v -run 'CheckLog|Manifest|Authz|Tenant'`, then `go test ./...`.
Expected: PASS. Then mutate twice and restore from your backup each time: drop `checkLogs.list` from `intentPolicies` (the authz guard must fail), and drop the `knownDecisions` check (the `denied` refusal test must fail).

- [ ] **Step 6: Commit**

```bash
git add extension/contract/handlers_checklogs.go extension/contract/handlers_checklogs_test.go
git commit -m "feat(contract): list and read check logs from the dashboard" -- extension/contract/handlers_checklogs.go extension/contract/handlers_checklogs_test.go extension/contract/handlers_overview.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/authz.go extension/contract/handlers_tenant_test.go extension/contract/manifest_test.go extension/contract/authz_test.go
```

---

## Task 4: Fixture handlers

**Files:**
- Modify: `packages/fixture-server/warden-fixtures.mjs`

**Interfaces:**
- Consumes: the wire contract in Task 3's Interfaces, exactly.
- Produces: `checkLogs.list` and `checkLogs.detail` handlers, and a seed Tasks 5 and 6 are checked against by hand.

- [ ] **Step 1: Extend the seed**

The existing `checkLogs` array (line 160) feeds `overview.recentChecks`, which slices it; keep it newest first. Extend each existing row with `appId`, `matchedBy`, `obligations`, `requestIp`, `requestId`, `traceId` (arrays always present), and add rows so that the seed holds at least: an RBAC allow whose `matchedBy` names a role id that exists in the fixture's `roles`; an ABAC allow and an ABAC `deny_explicit` naming policy ids that exist in the fixture's `policies`, one with obligations; a ReBAC allow with no `ruleId`; a `deny_no_roles` and a `deny_default` with empty `matchedBy`; a cached allow; an `error` row; a row in `eng/platform`; and a row naming a role id that exists nowhere (a deleted rule, to check the detail page's link still reads honestly). About 30 rows in total, so the list pages at 25. Keep `recentChecks` returning the first ten.

- [ ] **Step 2: The handlers**

Mirror Task 3 exactly: the same `knownDecisions` set, the same refusals and messages (throw the file's existing `FixtureError`-style refusal with code `BAD_REQUEST`, as the policy handlers do), `after`/`before` parsed with `Date.parse` and refused when `NaN`, inclusive bounds compared on the row's `createdAt`, exact-match string filters, `namespacePath` `undefined`/`""`/path, `cached` true/false/absent, paging clamped like `PageRequest.Clamp` (default 25, cap 200, negative offset 0). `notRecorded` is present only when `warden.config.checkLogEnabled` is true; seed it at `{ queueFull: 3, writeFailed: 1, since: <two hours before the newest row> }` so the page's loss line can be seen. `checkLogs.detail` returns `NOT_FOUND` for an unknown id and `BAD_REQUEST` for one that does not start with `chk_`.

The summary rows `checkLogs.list` returns must **not** carry the detail-only fields; project them to `CheckLogSummary`'s keys, as the Go does.

- [ ] **Step 3: Check it by hand against the Go**

Start the fixture server the way `packages/fixture-server/package.json` does and send, through `curl` or a short node script, the same refusal cases as Task 3 Step 1 item 3, plus one filtered list per filter. Confirm each answer matches the Go handler's for the same input. Record the table in your report.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fixture): serve the warden check log" -- packages/fixture-server/warden-fixtures.mjs
```

---

## Task 5: The check log list

**Files:**
- Create: `packages/plugin-warden/src/components/check-log.tsx`
- Create: `packages/plugin-warden/src/pages/check-log.tsx`
- Create: `packages/plugin-warden/test/check-log.test.tsx`
- Modify: `packages/plugin-warden/src/pages/overview.tsx`, `packages/plugin-warden/test/overview.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`, `packages/plugin-warden/test/plugin.test.tsx`

**Interfaces:**
- Consumes: `checkLogs.list` (Task 3), `config.detail`'s `checkLogEnabled` (plan 1), `useNamespaceFilter`, `NamespaceCell` (`components/namespace-filter.tsx`).
- Produces, in `components/check-log.tsx`, for Task 6:

```ts
export interface CheckSummary { /* moved unchanged from overview.tsx */ }
export interface CheckMatch { source: string; ruleId?: string; detail?: string }
export interface CheckDetail extends CheckSummary {
  appId?: string
  matchedBy: CheckMatch[]
  obligations: string[]
  requestIp?: string
  requestId?: string
  traceId?: string
}
export interface CheckLogList {
  items: CheckSummary[]
  total: number
  limit: number
  offset: number
  notRecorded?: { queueFull: number; writeFailed: number; since: string }
}
/** Every decision the engine records, in the order the filter lists them. */
export const DECISIONS: readonly string[]
export function decisionVariant(decision: string): "outline" | "secondary" | "destructive"
/** `user:alice  read  document:readme`, identifiers mono, never an arrow. */
export function CheckRequestLine(props: { check: CheckSummary }): JSX.Element
/** A duration in nanoseconds as milliseconds, two decimals: "0.41 ms". */
export function formatEvalTime(ns: number): string
```

- [ ] **Step 1: Move the shared pieces**

Move `CheckSummary` and `decisionVariant` (with its doc comment) from `overview.tsx` to `components/check-log.tsx` unchanged, and keep `index.tsx`'s public type exports working: `OverviewStats` and `RecentChecks` still come from `./pages/overview`, `CheckSummary` now comes from `./components/check-log`. `overview.tsx` imports them. `DECISIONS` is:

```ts
export const DECISIONS = [
  "allow",
  "deny",
  "deny_explicit",
  "deny_default",
  "deny_no_roles",
  "deny_no_perms",
  "deny_condition",
  "deny_relation",
  "error",
] as const
```

- [ ] **Step 2: Write the failing page tests**

In `test/check-log.test.tsx`, using `renderPage` and `stubClient` from `test/harness.tsx`, with a stub that records every `checkLogs.list` request:

1. **Rows**: each row shows the timestamp as a link to `/check-log/<id>`, the subject in `font-medium`, the resource in `font-mono text-xs`, the namespace (root as `/`), the decision badge and the cached badge. Caption is `<total> checks` from the server's `total`, singular at 1, and `0 checks` at zero.
2. **Each filter sends its parameter and resets to page 1**: namespace; decision (every option in `DECISIONS` plus "any"); cached (any / cached / not cached, sending `cached: true`, `cached: false`, or no key); time window (any time / last hour / last 24 hours / last 7 days / last 30 days, sending `after` as an ISO instant within a second of the expected one, and no key for any time). Assert with `Object.keys` that an unset filter sends **no key**, not an empty string.
3. **Exact-match fields apply on Apply, not on typing**: typing a subject id sends nothing; Apply sends `subjectKind`, `subjectId`, `action`, `resourceType`, `resourceId` for the fields that are filled, and no key for blank ones; Clear removes all five and resets to page 1.
4. **Paging** sends `offset: 25` for page 2.
5. **Three empties**:
   - `checkLogEnabled: false` shows "Check logging is off, so warden is not recording checks." whether or not rows exist; with rows it adds "These rows were recorded before it was turned off."
   - Logging on, no filters, zero rows: "No checks have been recorded yet."
   - Logging on, any filter set, zero rows: "No checks match these filters."
   - `config.detail` failing: no logging-off sentence at all (the page must not guess).
6. **Loss line**: with `notRecorded` `{queueFull: 3, writeFailed: 1}` the page shows "This server failed to record 4 checks since it started" with a `Timestamp` of `since`, "3 because the log queue was full, 1 because the store refused the write", and "Those checks were decided, and they have no row here. The count covers every tenant this server handles." With both zero, no loss line. With `notRecorded` absent, no loss line. With only one kind non-zero, only that clause.
7. **The unfilterable question**: the sentence "Checks cannot be filtered by the rule that decided them yet." is present.
8. **Error rows**: an `error` row's badge is `destructive` and the row shows its error text.

- [ ] **Step 3: Run to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-warden test -- check-log`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the page**

`WardenCheckLogPage` in `pages/check-log.tsx`:

- State: `page`; `useNamespaceFilter(() => setPage(1))`; `decision` (`""` for any); `cached` (`"" | "cached" | "evaluated"`); `window` (`"" | "1h" | "24h" | "7d" | "30d"`) plus the `after` instant computed **when the option is chosen** (`new Date(Date.now() - ms).toISOString()`), so the query key is stable and a refetch does not slide the window; `draft` and `applied` for the five exact-match fields. Every setter resets `page` to 1.
- Query: `useQuery<CheckLogList>("checkLogs.list", params)` where `params` includes only set keys. `useQuery<ConfigDetail>("config.detail")` for `checkLogEnabled`; `ConfigDetail` is exported from `./config` (line 14).
- `FilterBar` with namespace, decision, cached and time selects. Below it, a small form row for the exact-match fields: a subject kind `NativeSelect` (blank plus the four kinds the assignments page uses; move `SUBJECT_KINDS` from `pages/assignments.tsx` into `components/check-log.tsx` only if doing so is a one-line import change, otherwise duplicate the four literals with a comment naming the other copy), subject id, action, resource type, resource id `Input`s each with a visible `Label`, and Apply (type submit) and Clear buttons. Under the form, muted: "Checks cannot be filtered by the rule that decided them yet."
- When a time window is set, the caption reads `<total> checks since <Timestamp value={after} />`.
- The logging-off `Alert` sits above the table, only when `config.data?.checkLogEnabled === false`.
- The loss line sits above the table as muted text, only when `notRecorded` is present and its sum is above zero.
- Columns: When (a `PluginLink` to `/check-log/<id>` wrapping `Timestamp`), Subject (`font-medium`, `kind:id` as plain text; plan 4 links it), Action, Resource (`font-mono text-xs`), Namespace (`NamespaceCell`), Decision (badge from `decisionVariant`), Detail (error in `text-destructive`, else reason muted, else `NoneCell`, exactly as the overview does), Cached (the overview's badge). Reuse the overview's column definitions by moving them into `components/check-log.tsx` as `checkColumns(): Column<CheckSummary>[]` if that keeps both pages identical; the overview then gains the When link too.

- [ ] **Step 5: The overview links**

In `overview.tsx`, give the "Recent checks" panel a `PluginLink` to `/check-log` reading "View the check log", and use the shared columns so each row links to its detail. Update `test/overview.test.tsx` to assert the panel link and a row link.

- [ ] **Step 6: Route and nav**

In `index.tsx`: route `{ path: "/check-log", element: WardenCheckLogPage }`; nav `{ label: "Check log", to: "/check-log", priority: 20, icon: <ListChecksIcon />, group: "Operations" }`, importing `ListChecksIcon` from `lucide-react` beside the others (it exists in the installed 1.40.0). Extend `test/plugin.test.tsx` for the new route and nav entry the way it covers the others.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint`
Expected: PASS, clean. Mutate twice and restore from your backup: make the cached filter send `cached: ""` for "any" (test 2 must fail), and show the logging-off sentence when `config.detail` errors (test 5 must fail).

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-warden/src/components/check-log.tsx packages/plugin-warden/src/pages/check-log.tsx packages/plugin-warden/test/check-log.test.tsx
git commit -m "feat(warden): add the check log page" -- packages/plugin-warden/src/components/check-log.tsx packages/plugin-warden/src/pages/check-log.tsx packages/plugin-warden/test/check-log.test.tsx packages/plugin-warden/src/pages/overview.tsx packages/plugin-warden/test/overview.test.tsx packages/plugin-warden/src/index.tsx packages/plugin-warden/test/plugin.test.tsx
```

If `pages/assignments.tsx` changed for `SUBJECT_KINDS`, add it to the path list.

---

## Task 6: One check's detail

**Files:**
- Create: `packages/plugin-warden/src/pages/check-log-detail.tsx`
- Create: `packages/plugin-warden/test/check-log-detail.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`, `packages/plugin-warden/test/plugin.test.tsx`

**Interfaces:**
- Consumes: `checkLogs.detail` (Task 3); `CheckDetail`, `decisionVariant`, `CheckRequestLine`, `formatEvalTime` (Task 5); `DetailLayout` and `DescriptionList` from the kit, as `policy-detail.tsx` uses them.
- Produces: `WardenCheckLogDetailPage`, route `/check-log/:id`, no nav entry.

- [ ] **Step 1: Write the failing tests**

In `test/check-log-detail.test.tsx`, one test per row shape, each asserting the exact sentences:

1. **RBAC allow**: header shows the request line and `in /`; the `allow` badge is `outline`; "decided by" lists "role" with the recorded detail "role grants document:read" as a `PluginLink` to `/roles/<ruleId>`.
2. **ABAC deny_explicit with obligations**: badge `secondary`; reason shown; "decided by" links "policy" with detail to `/policies/<ruleId>`; "emits" lists each obligation in mono.
3. **ReBAC allow with no ruleId**: "relation" with the detail as plain text, no link.
4. **deny_no_roles with no matchedBy**: "No rule is recorded for this decision." and no "decided by" list.
5. **Cached allow**: "Served from the result cache. The engine reused a decision it made earlier and evaluated no rule for this check." and the time row labelled "lookup time", not "evaluation time".
6. **Evaluated row**: time row labelled "evaluation time" with `formatEvalTime` output (412000 ns reads "0.41 ms").
7. **error row**: badge `destructive`; the error text in `text-destructive`; "The check failed with this error, so no decision was returned."; no "decided by" section and no time row.
8. **Links note**: whenever at least one match has a `ruleId`, "Each link opens the rule as it is now, which may differ from when this check ran." is shown; with none, it is not.
9. **Aside**: check id, namespace (root `/`), app id, request ip, request id, trace id, and when; an absent optional value renders `NoneCell`, never blank.
10. **Not found**: the `NOT_FOUND` refusal renders the `QueryBoundary` error card, not an empty layout.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-warden test -- check-log-detail`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`WardenCheckLogDetailPage({ params })` reads `params.id`, queries `checkLogs.detail` with `{ id }` inside a `QueryBoundary`, and renders `DetailLayout` with:

- Header: `CheckRequestLine` and the namespace; a `PageHeader` title of "Check" (the request line carries the identity; a check has no name).
- Main: the decision badge and, beside it, `reason` or, for `error`, the error text and the no-decision sentence. Then "decided by": each match as a row with a lowercase source word (`rbac` reads "role", `abac` reads "policy", `rebac` reads "relation", anything else shows its raw source in mono) and the recorded `detail`, linked when `ruleId` is present and the source is `rbac` or `abac`. Then "emits" for obligations when any. Then the cached sentence when cached. Then the time row. Labels follow plan 3a's rule block convention: a lowercase, aligned column.
- Aside: a `DescriptionList` of the correlation fields.

The source-word mapping is a `Record<string, { word: string; href?: (id: string) => string }>`, so an unknown source never gets a guessed link.

- [ ] **Step 4: Route**

`{ path: "/check-log/:id", element: WardenCheckLogDetailPage }` in `index.tsx`, with the same "No nav entry" comment the other detail routes carry. Extend `test/plugin.test.tsx`.

- [ ] **Step 5: Verify**

Run the package's test, typecheck and lint. Mutate twice and restore from your backup: link `rebac` matches (test 3 must fail), and label a cached row "evaluation time" (test 5 must fail).

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-warden/src/pages/check-log-detail.tsx packages/plugin-warden/test/check-log-detail.test.tsx
git commit -m "feat(warden): show what decided one check" -- packages/plugin-warden/src/pages/check-log-detail.tsx packages/plugin-warden/test/check-log-detail.test.tsx packages/plugin-warden/src/index.tsx packages/plugin-warden/test/plugin.test.tsx
```

---

## Carried forward

- **To plan 4:** "Open in playground" on the detail page, prefilling subject, action, resource and namespace. Subject cells on both pages link to `/subjects/:kind/:id`.
- **Warden follow-ups, not this plan:** a tenant-scoped `PurgeCheckLogs`; a `MatchedRuleID` filter (JSON containment on three storage shapes); the loss counters are per process, so a fleet behind a load balancer shows each replica's own count on each request.
