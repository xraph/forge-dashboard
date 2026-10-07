# Dispatch dashboard: templ to React shell

Dispatch's operator dashboard moves off server-rendered templ and onto the React
shell. The Go half is a contract contributor in `forgery/dispatch/extension/contract/`
plus the engine fixes the pages need to tell the truth. The React half is a new
`packages/plugin-dispatch` in this repo. When both work in a browser, the templ
dashboard in `dispatch/dashboard/` is recorded in `MIGRATION.md` and deleted.

Read `packages/plugin/PLAYBOOK.md` before you touch any of this. Everything below
assumes it.

## What this is for

Dispatch runs background jobs, workflows and cron for whatever app embeds it. If
you open this dashboard you're probably on call for that app, and something is
stuck, or failed, or a queue is backing up, or a cron didn't fire when you expected
it to. You need to see live state, find the broken thing, and act on it without
making it worse.

So three things decide every page:

- **It has to be current, and say how current it is.** Workers, queues and running
  jobs change by the second. A count that stopped updating must look stopped.
- **Operations with consequences have to be exact.** Retry, cancel, replay and
  purge re-run or remove work. The confirm says what will happen, by ID, and a
  second click can't do it twice.
- **It shows what the engine knows, not what a page computed from a sample.** The
  templ dashboard counted things by loading every row and calling `len()`, merged
  per-state pages with one offset, and labelled the oldest jobs "recent". None of
  that survives.

## Decisions taken with Rex (2026-10-07)

| Question | Decision |
|---|---|
| Engine bugs under the pages | Fix what the pages need, in this migration, each with cross-backend tests. Record the rest in `MIGRATION.md`. |
| Tenancy | Operator-wide, said plainly. Every row shows its app and org scope, and lists can filter by them. No claim-based scoping. |
| Live data | Visible polling now. A generic subscription client is its own spec (sub-project A) after this one, and Dispatch pages upgrade to subscription plus polling when it lands. |
| New operations | Cron run now. DLQ delete one and purge by any cutoff. Cancel a running job. Workflow replay-from-step, made safe first. |
| New reads | Handler registry detail. Artifacts. Engine configuration. Workflow versions and the run tree. |
| List layer | New store read methods: newest first, keyset cursors, a `complete` flag, all five backends, with a conformance suite. |
| Job usage records (PR xraph/dispatch#33) | Build on `main` now. The usage panel on job detail is a later slice once #33 merges. |

## What the investigation found

These come from reading the Go, and the heavy ones were re-checked by hand. They
are why the engine section below exists.

### Worker rows go stale, then get deleted

`cluster.Store.HeartbeatWorker` has no production caller. The engine registers its
row once (`engine/engine.go:590`) and never touches it again, so `LastSeen` is the
registration time forever. Then every instance that starts runs
`DeleteStaleWorkers(5m)` (`extension/extension.go:336`), and because no row has been
refreshed since it was written, a rolling deploy that brings up a new instance after
five minutes removes the rows of every worker still running, the leader included.
A workers page built on that would show you a fleet that is mostly missing. `engine/resource.go:321`
also filters workers by `LastSeen`, so the fleet capacity ceiling decays the same way.

Nothing writes `draining` or `dead` (`engine/engine.go:568` writes `active`, nothing
else does). `Worker.Capacity` round-trips only on the memory store; postgres,
sqlite, mongo and redis drop it.

### You can't list "all jobs", and lists run oldest first

`ListJobsByState(ctx, "", opts)` filters on `state = ''` and returns nothing on all
five backends. Every list orders by `created_at ASC`. Redis builds lists from
`SMembers` and slices offset and limit in Go, so its order is random and offset
paging is not deterministic there. No list filters by name or scope. `CountJobs`
does treat an empty state or queue as "all".

### No `CountRuns`

`workflow.Store` has no count. The templ overview called `ListRuns` with `Limit: 0`
three times and took `len()`.

### DLQ replay is not idempotent, and retry can double it

`dlq.Service.Replay` never checks `ReplayedAt`. Two replays make two jobs. It
enqueues straight through the store, skipping the engine's enqueue path: no binding
validation, no resource resolution, no enqueue event, no local wake. Retrying a
failed job (`api/job_handler.go:86`) leaves its DLQ entry unreplayed, so retry and
then replay runs the work twice. There is no single-entry delete, and purge is
hard-coded to 30 days in the API although the store takes any cutoff.

### A disabled cron can come back

Enable and disable do `GetCron`, flip `Enabled`, then a whole-row `UpdateCronEntry`.
They don't invalidate the leader's 30 second cron cache. When the leader fires from
its cached copy, `fireEntry` writes that copy back with a whole-row update
(`cron/scheduler.go:474`), which can re-enable a cron somebody just disabled. On
enable, a stale `NextRunAt` in the past fires once immediately. Schedules are
5-field robfig/cron v3 with descriptors and no seconds. There is no timezone field;
the scheduler passes UTC, and a `CRON_TZ=Area/City ` prefix in the schedule string
is honoured.

### Workflows are not graphs

A workflow is an imperative Go function. The registry stores name, version and a
runner, nothing else. Per-step persistence is a checkpoint for each completed step.
Failed and in-flight steps exist only as runtime events. So there is no DAG to draw.
What a page can show honestly is the ordered checkpoint timeline, the parent and
child run tree, and the version. `StepWithResult` checkpoints are gob, which a
browser can't decode.

`Runner.ReplayFrom` runs synchronously in the caller, takes no lock and replays on
the latest registered version, not the run's own. `workflow.cancel` and
`workflow.replay` exist as DWP constants with no handler.

### Nothing is tenant-scoped

No list or count method filters by app or org, except `artifact.ListOpts`, where an
empty value matches every tenant on all five backends. Cron entries and cron-fired
jobs never get a scope. The templ dashboard and the REST API are cross-tenant.

### Live data has no path to the browser yet

Forge v1.12.0 serves subscriptions (`GET /api/dashboard/v1/stream`,
`POST /stream/control`, `dispatcher.RegisterSubscription`), but nothing in
`packages/plugin`, `runtime` or `host` consumes them, and the fixture server refuses
the kind. Dispatch's own stream broker sees only hooks fired in its own process,
and its SSE handler never adds credits, so a subscriber goes silent after 1000
events. Even with a working stream, a dashboard connected to one instance can't
hear jobs running on another. Polling stays as the floor either way.

### The templ dashboard itself

`dispatch/dashboard/` is 29 `.templ` files, their generated `*_templ.go`, and
`contributor.go`, `data.go`, `manifest.go`. Nothing outside the directory imports it
since `b064c8c`. It is the only user of templ and forgeui in the repo, so deleting
it lets `go mod tidy` drop both. It will not compile on forge v1.12.0, which removed
`extensions/dashboard/contributor`. The full page-by-page inventory goes into
`MIGRATION.md` before deletion (see the end of this spec).

## The Go half

All of this happens on `main` in `forgery/dispatch`. Commit with
`git commit --only -- <paths>`, check `git show --stat HEAD`, never push without
asking.

### Step 0: forge v1.12.0 and grove v1.7.0

Dispatch pins forge v1.10.0, whose transport drops `meta.invalidates`, so no
dashboard write would refresh a page. Move to forge v1.12.0 (and grove v1.7.0 if
#33 hasn't brought it yet). The templ package stops compiling at that point, so the
same commit excludes `dashboard/` from the build with a `//go:build ignore`
constraint on its Go files. The sources stay on disk as the reference until their
own deletion commit.

Never import the root `github.com/xraph/forge/extensions/dashboard` package in
production code; released forge's `dashboard/auth` still pulls templ. The
`ContractContributorAware` assertion lives in a `_test.go` file.

### Engine fixes

Each fix is its own commit with tests. Where a store gains a method, all five
backends implement it (memory, postgres, sqlite, mongo, redis), and the k8s cluster
provider where it implements `cluster.Store`.

**1. Worker liveness.** The engine heartbeats its own cluster row every
`HeartbeatInterval` from the pool's lifecycle, and stops when the engine stops. The
startup sweep keeps its threshold, which is now meaningful. Postgres, sqlite, mongo
and redis persist `Capacity` (migration for the SQL backends). `GetWorker(ctx, id)`
joins the interface so a detail page doesn't list and scan. We do not start writing
`draining` or `dead`; the page derives "no heartbeat for 2m" from `LastSeen` and the
configured interval and never claims a worker is dead.

Test: a worker's `LastSeen` advances on every backend; a second engine starting
after five minutes leaves a heartbeating worker's row alone.

**2. The list layer.**

```go
// job
type ListJobsOpts struct {
	States     []State   // empty means every state
	Queue      string
	NamePrefix string
	ScopeAppID string
	ScopeOrgID string
	Cursor     string    // opaque, from the previous page
	Limit      int
}
type JobPage struct {
	Jobs       []*Job
	NextCursor string // empty when there is no next page
	Complete   bool   // false when a filter was applied after reading a window
}
ListJobs(ctx context.Context, opts ListJobsOpts) (JobPage, error)
```

Newest first, keyset on `(created_at DESC, id DESC)`. Postgres, sqlite and mongo
filter and order at the query. Redis gains a sorted set per store, `jobs_by_created`
scored by creation time, maintained wherever a job is written or deleted, and
backfilled from `job_ids` the first time it's found missing (guarded by a marker key
so it runs once). Redis applies state, queue, name and scope by reading the index in
windows and filtering, and reports `Complete: false` when it stopped at its scan
budget before filling the page. That flag is the playbook's third empty state.

Workflow runs get the same: `ListRuns` takes `Cursor`, `NamePrefix`, scope, and
orders newest first; `CountRuns(ctx, CountRunsOpts{State, Name})` is added. DLQ
gets `ListDLQ` with `Cursor`, `Replayed *bool`, `NamePrefix` and scope, ordered by
`failed_at DESC`, and `CountDLQ` takes the same filters. Artifacts already order
newest first; `ListArtifacts` gains a cursor so every long list pages the same way.
`ListCrons` stays unpaged; a deployment has tens of crons, not millions.

The existing `ListJobsByState` keeps its signature and behaviour for the engine's
own callers.

A new `store/storetest` suite runs on all five backends. It writes jobs under two
scopes, several queues, all six states and staggered times, then asserts on
identity (not count): newest first, cursor pages join without gaps or repeats,
each filter returns exactly the rows it should, an empty scope filter means "every
scope" and is pinned as such. Same for runs and DLQ.

**3. DLQ replay, retry, delete and purge.**

- `Replay` claims first: a conditional write sets `replayed_at` only where it is
  null. Losing the claim returns `dlq.ErrAlreadyReplayed`. The winner enqueues
  through the engine's enqueue path (validation, resources, enqueue event, local
  wake). If that enqueue fails, the claim is released and the error returned. The
  new job records the entry it came from (`replayed_job_id` on the entry).
- `ReplayAll` takes an optional queue and a batch bound, and returns
  `{replayed, conflicts, errors}`. It is not transactional and says so.
- Retrying a failed job claims its DLQ entry by job ID the same way, so retry and
  replay can't both run the work. If the entry is already claimed, retry refuses
  with the same error.
- `DeleteDLQ(ctx, id)` is added. Purge takes the caller's cutoff, and
  `CountDLQ` with a `FailedBefore` filter backs a dry-run count for the confirm.

Test: two concurrent replays on every backend produce exactly one job; replay then
retry refuses; a replay whose enqueue fails leaves the entry replayable.

**4. Cron.** A `cron.Service` owns enable, disable, delete and run-now, and each
call invalidates the scheduler cache. Enable recomputes `NextRunAt` from now, so it
never fires a catch-up. The scheduler's post-fire write changes only `last_run_at`
and `next_run_at` (a new `UpdateCronSchedule(ctx, id, lastRun, nextRun)` on the
store), so a fire can't overwrite `enabled`. Run-now enqueues the cron's job once
through the engine with its queue and payload, leaves the schedule alone, and emits
the cron-fired event. `cron.NextFires(schedule, from, n)` returns the next fire
times and the evaluation location (UTC, or the `CRON_TZ` zone).

Test: disable during a fire window stays disabled; enable with a past `NextRunAt`
doesn't fire immediately; next fires honour `CRON_TZ`.

**5. Cancel a running job.** Cancel accepts pending, retrying and running. For
running it writes `cancelled` to the row, which is what the lease machinery already
reacts to: the worker's next renewal fails, the pool cancels the handler's context
within one heartbeat, and the worker's terminal write is refused.
`abandonLostLease` reads the row and emits a cancelled event when the row says
`cancelled`, instead of `job.failed`. A handler that ignores its context keeps
running until it next checks; the page says so.

**6. Workflow replay-from-step, made safe.** A conditional write claims the run: it
moves to `running` only if it isn't running already. A running run refuses with
`workflow.ErrRunActive`, which stops a second replay and another instance from
double-executing it. Replay uses the run's stamped version, not the latest, and
refuses if that version is no longer registered. It runs on an engine-owned
goroutine tied to the engine's lifetime, so the request returns once the claim
succeeds. Only a step with a checkpoint can be chosen, and the response lists the
checkpoints that will be deleted and re-run.

Out of scope and recorded: `ResumeAll` running on every instance at start with no
lock, and workflows executing in the caller's goroutine.

**7. Operator actions emit engine events.** Cancel, retry, replay, delete, purge,
cron toggle, cron run-now and workflow replay emit through `ext.Registry`, so audit
and relay hooks see them, and so will the stream later. Forge's contract audit
already records the principal's subject for every command, so we don't add an actor
field.

### The contract package

`extension/contract/`, copied from Trove's shape: embedded `manifest.yaml`,
`const ContributorName = "dispatch"`, generic `query`/`command` binders, a check that
every bound intent is declared, `errors.go` with `mapError` that logs internal
errors and never echoes them, `Deps` with nil guards. The extension implements
`RegisterContractContributor`; if the engine isn't built it logs and skips.

Rules for every intent:

- **Operator-wide.** The manifest says so in a comment. Every row carries
  `scopeAppId` and `scopeOrgId` (null when empty). Job, run, DLQ and artifact lists
  accept them as filters. No claims are read.
- **Paging.** Cursor everywhere a list can grow: `cursor` in, `nextCursor` (null at
  the end) and `complete` out. Default limit 50, maximum 200. Over the maximum is
  capped, negative is `BAD_REQUEST`. No totals on cursor lists; counts come from the
  count intents.
- **Wire shapes.** camelCase JSON. Absent values are null, never `""`. Timestamps are
  RFC 3339 UTC. Durations travel as `{text: "1m30s", ms: 90000}`. A `[]byte` payload
  is decoded server-side to `{kind: "json", json: …}` when it parses, otherwise
  `{kind: "binary", bytes: n}`. Gob checkpoint data is `{kind: "gob", bytes: n}`.
- **Errors.** Not found is `NOT_FOUND`. A refused state transition is `CONFLICT`
  with the current state in `details`. Bad input is `BAD_REQUEST`. Anything else is
  `INTERNAL`, logged with the intent name. A capability the deployment lacks (no
  cluster store, artifact plane off, backend can't presign) is `enabled: false` on
  the response, not an error, so the page can say so.

Queries:

| Intent | Reads |
|---|---|
| `overview.summary` | Job counts per state, run counts per state, unreplayed DLQ count, crons enabled and disabled, workers heartbeating and silent, leader, server `asOf` |
| `jobs.list` | `ListJobs` with states, queue, name prefix, scope, cursor |
| `jobs.counts` | `CountJobs` per state, optional queue |
| `jobs.get` | The job, its DLQ entry ID, lease, resources, artifact links when the plane is on |
| `queues.list` | Queue names from config, workers and the queue manager; per-state counts from the store; rate and concurrency config and active count marked as this process's view |
| `queues.get` | One queue, same fields |
| `handlers.list` | Job handlers and workflow definitions with versions |
| `handlers.get` | One handler: inputs, resource requests, limits and class, lease TTL, exec policy (level, downgrade, image); or one workflow's versions |
| `dlq.list`, `dlq.get` | `ListDLQ` with replayed, queue, name prefix, scope, cursor; one entry |
| `dlq.purgePreview` | Count of entries failed before a cutoff |
| `crons.list`, `crons.get` | Entries with the next five fire times and their location |
| `workflows.list`, `workflows.get` | Runs; one run with its checkpoint timeline, parent, children and version |
| `workers.list`, `workers.get` | Workers with `self`, heartbeat interval and age, leader; for this process, resource capacity and leases |
| `artifacts.list`, `artifacts.get`, `artifacts.forJob` | Artifacts with lifecycle, scope and deleted filters; one artifact; a job's input and output links |
| `artifacts.presign` | A short-lived download URL when the backend supports it. Never cached. |
| `engine.config` | Queue configs, poll, heartbeat, lease and stale timings, exec rungs and subprocess limits, resource model, artifact plane, wake notifier. Per-process values are labelled per-process. |

Commands, each with its `invalidates`:

| Intent | Does | Invalidates |
|---|---|---|
| `jobs.cancel` | Cancel pending, retrying or running | `jobs.list`, `jobs.get`, `jobs.counts`, `queues.list`, `queues.get`, `overview.summary` |
| `jobs.retry` | Retry a failed job, claiming its DLQ entry | the above plus `dlq.list`, `dlq.get` |
| `dlq.replay` | Replay one entry | `dlq.list`, `dlq.get`, `jobs.list`, `jobs.counts`, `queues.list`, `queues.get`, `overview.summary` |
| `dlq.replayAll` | Replay unreplayed entries, optional queue, bounded | same as `dlq.replay` |
| `dlq.delete` | Delete one entry | `dlq.list`, `dlq.get`, `overview.summary` |
| `dlq.purge` | Delete entries failed before a cutoff | `dlq.list`, `dlq.get`, `dlq.purgePreview`, `overview.summary` |
| `crons.enable`, `crons.disable` | Toggle and invalidate the scheduler cache | `crons.list`, `crons.get`, `overview.summary` |
| `crons.delete` | Delete | `crons.list`, `crons.get`, `overview.summary` |
| `crons.runNow` | Enqueue the cron's job once | `crons.get`, `jobs.list`, `jobs.counts`, `queues.list`, `queues.get`, `overview.summary` |
| `workflows.replayFrom` | Replay a run from a checkpointed step | `workflows.list`, `workflows.get`, `overview.summary` |

`manifest_test.go` pins every `invalidates` list against a literal map, and a query
must have none.

Tests: handlers called directly against memory and sqlite; the list intents against
postgres and redis through the existing testcontainer helpers; tenant isolation
with rows under two scopes, filtered, asserted by identity; a test per backend
pinning what an empty scope filter returns; `TestEveryDeclaredIntentIsBound`;
`TestCommandInvalidatesReachTheClient` through `transport.NewHandler`; Chronicle's
runtime `ContractContributorAware` registration test.

## The React half

`packages/plugin-dispatch`, copied from `plugin-trove`'s package setup: package
name `@forge-go/dashboard-plugin-dispatch`, no build step, the same tsconfig,
vitest config, eslint config and harness. `extension`, `namespace` and `label` are
all `dispatch` / "Dispatch".

### Information architecture

| Group | Nav | Routes |
|---|---|---|
| Dispatch | Overview | `/` |
| Operations | Jobs | `/jobs`, `/jobs/:id` |
| Operations | Workflows | `/workflows`, `/workflows/:id` |
| Operations | Dead letters | `/dlq`, `/dlq/:id` |
| Operations | Artifacts | `/artifacts`, `/artifacts/:id` |
| Monitoring | Queues | `/queues`, `/queues/:name` |
| Monitoring | Workers | `/workers`, `/workers/:id` |
| Scheduling | Cron | `/crons`, `/crons/:id` |
| Configuration | Handlers | `/handlers`, `/handlers/jobs/:name`, `/handlers/workflows/:name` |
| Configuration | Engine | `/config` |

Path params replace templ's `?id=` query strings. Links go through `PluginLink`
with scope-relative paths, and IDs pass through `encodeURIComponent`.

### Live data

One hook, `useLive(query, intervalMs)`, wraps `usePoll` and is the only place a page
asks to stay current. When sub-project A lands, this hook swaps to subscription plus
a slower poll and no page changes.

- 5 seconds: overview, jobs, queues, workers, and a job or run detail whose subject
  isn't terminal.
- 30 seconds: DLQ, cron, handlers.
- None: terminal detail pages, artifacts, config.

Polled views keep their data on screen while refetching (Trove's `SettledBoundary`
pattern). A `LiveStamp` component shows the server's `asOf`, "as of 14:02:31". When a
refresh fails it reads "stale since 14:02:31, retrying" in the warning colour, so a
frozen number never looks current. `usePoll` already pauses when the tab is hidden
and refetches on return.

### Pages

Every list carries a live row count in its caption, IDs in `font-mono text-xs`, the
column you read in `font-medium`, `NoneCell` for absent values and `Timestamp` for
possibly absent times. Every list has three empty states: nothing at all, nothing
matching the filter, and nothing found with the search incomplete (`complete:
false`), each with its own text.

**Overview.** State tiles for jobs and runs from the count intents, DLQ unreplayed,
crons, workers heartbeating versus silent, the leader. Links into each filtered
list. No "health" verdict computed from a failure rate: the templ one mixed failed
jobs with DLQ entries and called a quiet system "Healthy". If a chart earns its
place here it is decided under `dataviz`.

**Jobs.** Filters: states (multi), queue, name prefix, app, org. Columns: ID, name,
queue, state, priority, attempts (`retry_count/max_retries`), worker, created, run
at. Row actions: cancel where allowed, retry where failed.

**Job detail.** Designed under `frontend-design`. Lifecycle (created, run at,
started, heartbeat, completed) with the lease epoch and expiry while running; worker
link; resources requested, limits and class; artifacts in and out with download when
presign is available; the DLQ entry link when there is one; last error; payload in a
read-only JSON viewer. A position is kept for the usage section from #33; nothing
renders there until it exists.

**Queues and queue detail.** Per-queue state counts from the store, and the rate,
burst and concurrency config plus active count, captioned as this process's view.
Queue detail lists that queue's jobs through `jobs.list`.

**Workflows and run detail.** Run list with state, name, version, started,
duration. Run detail, designed under `frontend-design`: the checkpoint timeline in
order with each step's data (JSON shown, gob labelled as not viewable), the parent
and child tree as a nested list, input, error, version. Replay-from-step is offered
on checkpointed steps only.

**Dead letters and entry detail.** Default filter is unreplayed. Columns: job name,
queue, error (truncated with the full text on detail), attempts, failed, status.
Actions: replay, delete, replay all (optionally by queue), purge before a date.

**Cron and cron detail.** Schedule raw in mono, its plain-language description, next
five fires in the schedule's location and in your local time, last run, lock holder
and expiry, enabled. Actions: enable, disable, run now, delete.

**Workers and worker detail.** Hostname, ID, queues, concurrency, heartbeat age,
leader. Detail adds capacity and, for the instance serving the page, current
resource leases.

**Handlers and handler detail.** Job handlers and workflow definitions. Detail
shows declared inputs, resources, lease TTL, exec isolation policy, and for
workflows every registered version; it links to that handler's jobs or runs.

**Artifacts and artifact detail.** Filters: lifecycle, app, org, include deleted.
Columns: ID, bucket and key, size, content type, lifecycle, created, expires.
Detail adds the hash and a download when presign is available.

**Engine.** Read-only `engine.config`, grouped as pool and polling, queues,
execution, resources, artifacts. Per-process values say so.

### Confirmations

Every action that re-runs or removes work uses `ConfirmDialog` with `pending` set,
`reset()` on open, and its error inside the dialog. The text names the effect
exactly:

- Retry: "Runs job `job_…` again from the start on queue `emails`. Its dead letter
  entry is marked replayed so it can't run twice."
- Replay: "Creates a new job on queue `emails` from this entry."
- Replay all: "Replays 37 unreplayed entries on queue `emails`." The count comes
  from `dlq.list`/count, not a guess.
- Purge: "Deletes 1,204 entries that failed before 7 Sep 2026." The number comes
  from `dlq.purgePreview`.
- Cancel running: "Marks the job cancelled. Its handler is told to stop within one
  heartbeat, and keeps running until it next checks its context."
- Replay from step: "Deletes the checkpoints after `charge-card` (`ship`, `notify`)
  and runs the workflow again from there on version 3."

### Badges

Proportion first, per the playbook. These are fixed mappings; none is computed from
the page on screen.

| Domain | outline | secondary | default | destructive |
|---|---|---|---|---|
| Job state | completed, cancelled (the bulk of any healthy list) | pending | running, retrying | failed |
| Run state | completed | | running | failed |
| DLQ entry | not replayed (the default filter, so the majority) | replayed | | |
| Cron | enabled | disabled | | |
| Worker | heartbeating | | leader | no heartbeat past 3× the interval |

The DLQ page carries no destructive badge: every row there is already a failure, and
a page where every row shouts says nothing.

### Libraries and chunks

- CodeMirror 6, read-only JSON, lazy, for payloads, run input and checkpoint data.
- `cronstrue` for the plain-language description, loaded with the cron routes.
- No React Flow: workflows aren't graphs.
- Charts, if any, through the kit's `chart.tsx`, after `dataviz`.

A `lazy-chunks` test proves CodeMirror and `cronstrue` stay behind `lazy()`. After
`pnpm build` splits, the new numbers go into `BASELINE.md`.

### Wiring

`apps/shell`: `package.json` dependency, `App.tsx` import and plugin list,
`styles.css` `@source "../../../packages/plugin-dispatch/src";`. `apps/example-next`:
`package.json`, `forge.config.ts`, `app/globals.css` `@source`. Nothing else outside
the package.

## Fixtures

`packages/fixture-server/dispatch-fixtures.mjs` exports `createDispatchHandlers` and
`resetDispatch`; `dispatch-verify.mjs` exports `DISPATCH_INPUT` and
`verifyDispatch`. `server.mjs` and `verify.mjs` each gain one import and one
registration line, added with the Edit tool only and committed from a temporary
index, because both files carry other sessions' uncommitted work.

The fixture models the contract we're shipping, which deliberately differs from
today's engine. Write these down so nobody corrects them back:

- A second replay of the same entry is `CONFLICT`.
- Retry of a job whose DLQ entry is replayed is `CONFLICT`.
- Enabling a cron moves `nextRunAt` forward from now and fires nothing.
- `jobs.list` without states returns every state, newest first.
- Workers heartbeat; one seeded worker is silent past three intervals.

Writes change reads: cancel moves a job's state, replay adds a job and marks the
entry, purge shrinks the list, run-now adds a job. The seed holds enough rows to
page with cursors and one filter combination that returns `complete: false`.
`dispatch-verify.mjs` walks every intent over HTTP and spot-checks writes and
refusals.

## Sequencing

Go, in `forgery/dispatch`:

1. forge v1.12.0, grove v1.7.0, templ excluded from the build.
2. Worker liveness.
3. The list layer and its conformance suite.
4. DLQ replay, retry, delete, purge.
5. Cron service and next fires.
6. Cancel running.
7. Workflow replay-from-step.
8. Contract foundation: manifest, errors, binders, registration, guard tests.
9. Contract intents by domain: jobs, queues and handlers; DLQ; cron; workflows;
   workers; artifacts; engine and overview.

React, here, interleaved once the matching intents exist:

1. Scaffold, harness, types, badges, `useLive`, `LiveStamp`, shell wiring.
2. Jobs, job detail, queues, handlers, then their fixtures.
3. DLQ, then fixtures. Cron, then fixtures. Workflows, then fixtures.
4. Workers, artifacts, engine config, then fixtures.
5. Overview last.
6. Browser walkthrough on the fixture server, then against a real Dispatch on sqlite.

Then the retirement below. Then, separately: the usage panel once #33 merges, and
sub-project A.

## Retiring the templ dashboard

In this order, because after deletion there is no reference.

1. Write `dispatch/MIGRATION.md` in the Trove and Vault format while the templ
   files exist. Every page, column, action, filter, badge, empty state, widget,
   setting and nav item from the inventory is accounted for: migrated, changed,
   dropped with a reason, or blocked. The six widgets are blocked, because the shell
   has no plugin widget surface. The settings panel becomes `/config`. The record
   also lists what the engine still doesn't cover and the templ bugs below.
2. `grep -rn "dispatch/dashboard" --include='*.go'` across the repo: nothing outside
   the directory today. Check again.
3. Delete `dashboard/` and every `*_templ.go` as its own commit.
4. `go mod tidy` drops templ and forgeui. Remove the Makefile's `templ`,
   `templ-watch`, `deps` and `check-deps` templ lines and the `templ` step in `all`.
5. Prove it: `find . -name '*.templ' -not -path './_*'` prints nothing, and
   `go build ./... && go test ./...` pass.

Nothing is pushed without asking.

## Testing

- Plugin: one test file per page; every command with a real failure path through
  `ContractError`; dialog errors found without `hidden: true`; `plugin.test.tsx` for
  the join key, nav and routes; `lazy-chunks`. `pnpm -r test`, `typecheck` and
  `lint` clean across the repo, not just this package.
- Go per slice: `go build ./... && go test ./...`, `-race` on `worker/`, `engine/`
  and `cron/`, `go test -tags integration ./store/...`, fresh-cache lint.
- Browser: fixture server plus shell, every page and every action clicked, with
  screenshots. Then the shell against a real Dispatch on sqlite.

## Findings for MIGRATION.md

The templ dashboard's own bugs, recorded so nobody restores them:

1. The Jobs queue filter never filtered rows; it only changed the count when a state
   was also selected.
2. Without a state filter, Jobs and Queue detail applied one offset to every state
   and merged the results.
3. Workflow and DLQ totals ignored the filters, and name filters ran after paging.
4. "Recent" lists showed the oldest rows (`created_at ASC`).
5. Action responses, a 204 or raw JSON, were swapped into the page: after enable or
   replay you saw JSON, after delete nothing changed.
6. Several icons fell back to Info: server, crown, users, gauge, layers, package.
7. The topbar had search turned on with nothing behind it.
8. Pagination and link URLs weren't escaped.
9. The cluster health widget computed the leader's hostname and never rendered it.

What the engine still doesn't do after this migration: pause or resume a queue,
drain a worker, cancel a workflow run, list or browse events, and run workflows off
the caller's goroutine. `ResumeAll` still runs on every instance at start without a
lock. Queue rate and concurrency config is per process and only visible as the
serving instance's view.
