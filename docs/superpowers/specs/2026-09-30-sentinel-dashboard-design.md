# Sentinel dashboard: templ to React shell

Design for moving the Sentinel extension's dashboard off server-rendered templ
and onto the React shell, across two repositories.

- Go: `/Users/rexraphael/Work/xraph/forgery/sentinel`
- React: `forge-dashboard`, as a new `packages/plugin-sentinel`

Method is `packages/plugin/PLAYBOOK.md`. Read it first if you haven't; several
decisions below exist because a section of it says so.

## What this is for

Sentinel evaluates LLM and agent behaviour. You write suites of test cases,
run them against a target, score each output with a set of scorers, save a
known-good run as a baseline, and find out whether the next run regressed. The
value is in numbers across runs, not in the rows themselves, which makes this
the first results-analysis dashboard in the batch.

The operator this is for changes a prompt or a model and needs three answers:
did it get worse, where exactly, and what did the model actually say. The templ
dashboard answers none of the three. It lists runs and shows a pass rate.

Success is: every capability Sentinel offers is reachable from the React
dashboard or recorded in `sentinel/MIGRATION.md` as deliberately dropped, every
number the dashboard shows is one the library actually computed and persisted,
and `sentinel/dashboard/` no longer exists.

## What the investigation found

Three read-only audits ran on 2026-09-30: the templ pages, the unsurfaced
packages, and parity across the four store backends. The short version is that
Sentinel does a good deal less than its API surface suggests, and a dashboard
built on it as it stands would report confident numbers about things that
never ran.

### Nothing is tested

The only test file in the repo is `id/id_test.go`. The engine, every scorer,
regression detection and all four stores have no tests. The playbook's section
on inheriting the extension's correctness applies in full: whatever we add gets
tested properly, and `MIGRATION.md` says in plain words what still isn't.

### The engine ignores its configuration

`extension.go` loads and merges `pass_threshold`, `concurrency`, `temperature`
and `default_model`, then builds the engine without `engine.WithConfig`. The
engine starts from `sentinel.DefaultConfig()`, so every deployment scores at
0.7 whatever it configured, and the templ settings panel faithfully displays
those defaults as though they were the configuration.

### A run cannot be started over the wire

There is no registry of targets and none of scorers. `scorer.NewRegistry`
exists and is never called; targets exist only as Go values. So the REST
`POST /suites/:id/runs` always fails with `ErrNoTarget`, and the compare,
run-with-baseline and both red-team routes are stubs that answer 400.

### A run in progress is invisible

`RunEval` is synchronous. It evaluates every case, then writes all results in
one batch after `wg.Wait()`. Until then the store holds a `running` row with
`total_cases` and zeros, which is why the templ "Active Runs" column reads
`0/N` for the entire run and its red 0% bar makes a running run look like a
failed one. `StateCancelled` is defined and never assigned. A cancelled context
still ends `completed`, full of errored cases. A crashed process leaves the run
`running` forever. The run row has no `errored` count, and the pass threshold a
run was scored with is recorded nowhere.

### Scoring hides absences

A scorer that returns an error is appended as a result with score 0 and no
dimension. It pulls the case average down as though it had scored zero, while
its dimension silently disappears from the case, and possibly from the run.
Separately, the engine never reads `tc.Scorers`, so per-case scorer
configuration does nothing at all. That includes the `not_contains` check red
team's leakage generator relies on.

### Regression detection is written and never called

`baseline.DetectRegression(stats, results, baseline, threshold)` computes
`current − baseline` for pass rate, average score, each baseline dimension and
each case matched by `case_id`, and sets `HasRegression` if any delta is below
`−threshold`. One absolute threshold covers a pass rate fraction and a mean
score alike, and lower is always worse. A baseline case missing from the run is
skipped without a word. New cases and new dimensions are never compared. A
dimension missing from the run reads as zero and so shows up as a large
regression, which is a true alarm with a false number attached.

Nothing calls it. There is no threshold setting, the `RegressionDetected` hook
never fires, and "the current baseline" is `is_current = true` with no
ordering, with nothing promoted when the current one is deleted.

### Red team produces test cases, not findings

The five generators (injection, jailbreak, leakage, hallucination, off-topic)
each return up to five hardcoded `testcase.Case` templates tagged
`["redteam", <type>]` with `context.attack_type`. `redteam.Report`, with bypass
counts per type, is never built and nothing imports the package. Leakage
detection is a whole-prompt substring match carried in a scorer config the
engine ignores, so even if it ran, a partial leak would pass. The hostile
content that does exist lives in `Result.Output` (the raw model response) and,
for leakage cases, in the case's scorer config, which holds the entire system
prompt.

### Writes that look complete and are not

- `ImportCases` is a stub returning `(0, nil)` in all four stores. The parsers
  in `testcase/import.go` are never called.
- Nothing assigns a prompt version's `Version`. It is always 0, so the second
  version created for a suite fails `UNIQUE(suite_id, version)` on postgres,
  sqlite and mongo, and succeeds on memory.
- `SetCurrentPromptVersion` on the three real backends is two statements with no
  transaction, and the second filters by id only. A version from another suite
  becomes current there and leaves this suite with none.
- `DeleteSuite` cascades on postgres, depends on which pooled connection ran the
  foreign-key pragma on sqlite, and orphans every child row on memory and mongo.
- Unverified: an audit read that pgx encodes a nil map as SQL NULL, and several
  jsonb columns are `NOT NULL`. The engine creates runs with a nil `Config`. If
  that reading is right, every engine-created run fails on postgres. Phase 1
  starts by running it.

### Tenancy

`Suite` and `Run` carry `app_id`. Cases, results, baselines and prompt versions
are reachable only through a suite or a run. An empty `AppID` in a list filter
matches every app in all four stores, and no get-by-id checks the app at all.
`engine.CreateSuite` stamps `AppFromContext(ctx)`, which is empty on the
dashboard path. Nothing populates `Principal.Claims`.

### The templ dashboard

Eighteen pages, two widgets and a settings panel. It reads about a third of the
library and writes almost nothing successfully: every form posts to a
hard-coded `/sentinel/v1/...`, case edit, case delete, prompt create and
baseline delete hit paths the API never registers, case create sends the wrong
body shape, and suite create and update send form-encoded bodies the binder
rejects, because `hx-ext="json-enc"` is set and the extension is never loaded.
Three pages pass `StatCard` arguments in the wrong order, run detail panics when
stats fail to load, and every `?page=` link re-renders whatever route happens to
be in the address bar. The full inventory, page by page, is the source for
`MIGRATION.md`.

## Decisions

Settled with Rex on 2026-09-30, one at a time.

1. Fix what the dashboard stands on, including runs. Config wiring,
   scoring, prompt versions, import, cascade, regression, a target and scorer
   registry, and asynchronous runs with results persisted per case and a
   cross-replica cancel.
2. Regression threshold: one config value, overridable per view. A new
   `regression_threshold`, default `0.05`, recorded on each run. `runs.regression`
   accepts an optional override. The library's single-threshold semantics stay.
3. Tenancy: claim, then config, then refuse. Detailed below. A present but
   unusable claim refuses; it never falls through to the config value.
4. Red team content: inputs and verdicts open, outputs collapsed. A result
   from a red-team case shows its output only after an explicit reveal, per
   result, forgotten on reload. Leakage configs show the prompt's length, never
   the prompt.
5. Line charts through the kit. A one-line commit adds the recharts line
   parts to `packages/kit/src/components/chart.tsx`, following the policy
   Chronicle set there. This is the only file outside the plugin, its wiring and
   the fixture entries that this work touches.

## The Go half

Everything in this half is test-first. Engine tests run on the memory store
with `target.FromFunc` and `scorer.FromFunc`. Store tests run on sqlite always
and on postgres and mongo in Docker, and they populate the jsonb fields,
because a suite that only builds empty structs tests the absence of the thing
it claims to cover.

### Phase 1 opens by checking the postgres claim

Write a postgres test that creates a run with a nil `Config` and a result with
nil `ScorerResults`. If it fails, `store/postgres/models.go` normalises nil maps
and slices to empty ones on the way in, and the test stays. If it passes, the
test stays anyway and the claim is recorded as wrong.

### Configuration reaches the engine

`extension.go` passes `engine.WithConfig(sentinel.Config{...})` built from the
merged extension config. Both `sentinel.Config` and `extension.Config` gain
`RegressionThreshold` (`regression_threshold`, default `0.05`), and
`extension.Config` gains `DashboardAppID` (`dashboard_app_id`, no default).

Each run records the settings it was scored with in its existing `Config`
jsonb, as flat keys so mongo's decoding of nested maps into `bson.D` never
comes up:

| key | type |
|---|---|
| `pass_threshold` | number |
| `regression_threshold` | number |
| `concurrency` | number |
| `target` | string |
| `scorers` | array of strings |
| `model` | string |
| `prompt_version_id` | string, empty when the suite had no current version |

A run written before this change has none of these keys. That is not the same
as today's config and the dashboard never pretends it is: it says "not
recorded".

### Scoring

A scorer that errors makes the case `error`, with `Error` naming the scorer and
its message. `Score` is the mean over the scorers that did return, or 0 if none
did. An errored case never counts as a pass, and its missing dimension is
missing, not zero. The pass rate denominator is unchanged: errored cases were
always in it.

The engine evaluates each case with the run's scorers plus the case's own
`Scorers`, each resolved through the registry by name with its config. An
unknown name is a scorer error under the same rule, so a case that asks for a
scorer nobody registered is visibly unscored.

### Named targets and scorers

- `engine.WithTarget(name, description string, t target.Target)`, surfaced as
  `extension.WithTarget`.
- `scorer.Registry` gains `Names()` and a `Descriptor{Name, Description,
  Dimension string; UsesLLM bool}` per entry. The built-ins register with
  descriptors. `extension.WithScorer(desc, factory)` adds more, which is how an
  application registers the LLM scorers, since only it holds an `LLMClient`.
- The engine owns one registry, built at `New`.

### Asynchronous runs

`Engine.StartRun(ctx, *StartConfig) (*evalrun.Run, error)`, where
`StartConfig{SuiteID; Target string; Scorers []string; Model string}`.

1. Validate: the suite exists, it has cases, the target and every scorer name
   resolve. Failures return before anything is written.
2. Resolve the prompt: the suite's current prompt version if it has one,
   otherwise `suite.SystemPrompt`. Record which.
3. Create the run row with its recorded settings and return it.
4. Evaluate on a context the engine owns (`context.WithoutCancel` plus an
   engine cancel), so the dashboard request returning does not cancel the run.

Each result is written with `CreateResult` as soon as its case finishes. That
count against `total_cases` is the progress a page polls. When the last case
finishes, the counters are computed from the persisted results and written by
`FinalizeRun`. A result that cannot be written is logged and counted, and a run
with any unwritten result finalises `failed` with the count in `Error`.

`RunEval` stays synchronous for Go and CI callers, built on the same core.

Two store methods, implemented and tested in all four backends:

- `CancelRun(ctx, runID, at time.Time) (bool, error)` sets `cancelled` and
  `completed_at` only where the state is still `running`, and reports whether
  it did.
- `FinalizeRun(ctx, run *evalrun.Run) (evalrun.RunState, error)` writes the
  counters and `completed_at` always, and the state only if the stored state is
  still `running`. It returns the state actually stored, so a run cancelled a
  moment before it finished stays `cancelled` with honest partial counts.

The runner reads the run's state before starting each case and stops
scheduling when it reads `cancelled`. In-flight cases finish and are stored.
The signal lives in the store, so cancel works from any replica, which matters
because with more than one the dashboard request usually lands on a replica
that is not running the work.

A crashed process still leaves its run `running`. We deliberately do not sweep
those at startup: on a multi-replica deployment that sweep would fail another
replica's live run. The dashboard shows the time of the newest result instead,
and cancel works on a stalled run as the way to close it. `Stop` cancels this
process's active runs and waits up to `ShutdownTimeout`.

### Regression

`DetectRegression` keeps its signature and verdict and gains fields:

```go
Threshold         float64       `json:"threshold"`
MissingCases      []CaseRef     `json:"missing_cases,omitempty"`
NewCases          []CaseRef     `json:"new_cases,omitempty"`
MissingDimensions []string      `json:"missing_dimensions,omitempty"`
```

with `CaseRef{CaseID, CaseName}`. A dimension in the baseline and absent from
the run still sets `HasRegression`, which is the conservative answer for CI,
and is listed in `MissingDimensions` so a page can say "not measured" where it
would otherwise print −0.82. Missing and new cases do not set it. The engine
calls it at completion against the suite's current baseline and emits
`RegressionDetected` with the worst delta.

### Prompt versions

- `CreatePromptVersion` assigns `Version` as the suite's highest plus one, and
  retries once on a unique violation from a concurrent create.
- `SetCurrentPromptVersion` checks the version belongs to the suite and returns
  `ErrPromptVersionNotFound` otherwise, before touching anything. On postgres and
  sqlite it runs in a transaction; on mongo it filters the second write by suite
  as well as id.
- Runs use the current version's prompt, per step 2 above. `suite.SystemPrompt`
  is the prompt only for a suite with no current version, and suite detail
  shows which applies.
- `PromptVersion.RunID`, `PassRate` and `AvgScore` are never written. They stay
  in the struct, documented as unused. Per-version results come from runs,
  through `prompt_version_id`.

### The remaining fixes

- `engine.ImportCases` parses JSON, CSV and JSONL with the existing
  `testcase.Import*` functions and writes through `CreateCaseBatch`. It stops
  calling the store's `ImportCases`, which stays on the interface, documented
  as unused, so custom stores keep compiling.
- `DeleteSuite` deletes cases, results, runs, baselines and prompt versions
  explicitly in memory, mongo and sqlite, matching postgres's cascade.
- `engine.GenerateRedTeam(ctx, suiteID, types []redteam.AttackType, count int)`
  runs the generators against the suite's effective prompt and writes the cases.
- Forge moves from v1.10.0 to v1.11.2. v1.10.0 drops a manifest's `invalidates`
  on the way to the client, so no write would refresh any page.

## The contract

`sentinel/extension/contract`, the same shape as Vault's: an embedded
`manifest.yaml`, `Register(d, reg, wreg, Deps)`, one handler file per area, and
one `errors.go` mapping domain errors to contract codes and logging every
`INTERNAL` with its cause. The extension implements `ContractContributorAware`.
The contributor name is `sentinel`, the join key with the plugin's `extension`
field.

```go
type Deps struct {
    Engine *engine.Engine   // required
    Config extension.Config // for dashboard_app_id and the effective thresholds
    Logger forge.Logger     // optional
}
```

Wire types are projections with camelCase tags, defined in the contract
package. Domain structs never go on the wire directly. Timestamps are RFC3339.
Scores and rates are numbers from 0 to 1; the client formats them.

### Tenancy

`resolveApp(ctx) (string, error)`:

1. The principal has an `app_id` claim that is a non-empty string: use it.
2. The claim is present and anything else (empty, a number, nil): refuse with
   `PERMISSION_DENIED`. This is a tenant whose resolution failed, and a default
   must never answer for it.
3. The claim is absent and `dashboard_app_id` is set: use that. This is the
   path every deployment takes today, because nothing populates claims.
4. Otherwise refuse with `PERMISSION_DENIED`, naming the setting.

Rules 2 and 3 are separate on purpose. The fallback is for "no claim", and
conflating it with "a claim we could not read" is how empty-matches-everything
comes back while following the spec.

Every get-by-id loads the row and compares its app, directly for suites and
runs, through the parent for everything else. A mismatch answers `NOT_FOUND`,
so a probe cannot tell another tenant's id from a missing one. Every list
passes the resolved app, which keeps the store's empty filter unreachable.
Every create stamps the resolved app.

Rows already stored with an empty `app_id` are unreachable from the dashboard.
`MIGRATION.md` gives the one-line backfill.

### Paging

`runs.list` is offset paged: `limit` (default 25, at most 100) and `offset` in,
`items` and `hasMore` out, from a read of `limit + 1`. There is no total, since
`ListRuns` has no count and runs only grow. Suites, cases, baselines and
prompt versions are bounded per suite and come back whole, with the count the
caption needs.

### Wire types

```ts
Suite        { id, name, description, model, temperature, personaRef?, systemPrompt,
               promptSource: "version" | "suite", currentPromptVersion?: {id, version},
               currentBaseline?: {id, name}, caseCount, createdAt, updatedAt }
Case         { id, suiteId, name, input, expected?, scenarioType, tags[], scorers: ScorerConfig[],
               context?, metadata?, redTeam?: { attackType }, createdAt, updatedAt }
ScorerConfig { name, config?, redacted?: { key, length } }   // leakage substring, decision 4
PromptVersion{ id, suiteId, version, systemPrompt, changelog?, isCurrent,
               runCount, latestPassRate?, createdAt }
RunSettings  { passThreshold?, regressionThreshold?, concurrency?, target?, scorers?, model?,
               promptVersionId? }                               // absent = not recorded
Run          { id, suiteId, suiteName, model, state, totalCases, completedCases, passed, failed,
               errored, passRate, avgScore, avgLatencyMs, totalTokens, totalCost,
               dimensionScores, settings: RunSettings, error?, createdAt, completedAt?,
               lastProgressAt? }
ResultRow    { id, caseId, caseName, status, score, latencyMs, tokensUsed, cost,
               dimensionScores, redTeam?: { attackType }, error? }
Result       { ...ResultRow, output, outputLength, scorerResults: {scorerName, score, passed,
               reason, dimension?, details?}[], runTrace? }
Baseline     { id, suiteId, suiteName, runId, name, passRate, avgScore, dimensionScores,
               caseCount, isCurrent, createdAt }
```

`completedCases` and `errored` come from the persisted results while a run is
running and from the finalised counters after. `lastProgressAt` is the newest
result's `createdAt`.

### Queries

| intent | request | answers |
|---|---|---|
| `overview.stats` | nothing | suite, case and run counts; up to 10 recent runs; active runs; regressions among the last 20 completed runs; `targetsRegistered` |
| `config.get` | nothing | effective engine config; targets `{name, description}`; scorers `{name, description, dimension?, usesLlm}` |
| `suites.list` | nothing | `{items: Suite[]}` |
| `suites.detail` | `suiteId` | `Suite` |
| `cases.list` | `suiteId` | `{items: Case[]}` |
| `cases.detail` | `caseId` | `Case` |
| `prompts.list` | `suiteId` | `{items: PromptVersion[]}`, version ascending |
| `prompts.detail` | `versionId` | `PromptVersion`, plus `previous?: PromptVersion` for the diff |
| `runs.list` | `suiteId?`, `state?`, `limit?`, `offset?` | `{items: Run[], hasMore}`, newest first |
| `runs.detail` | `runId` | `{run: Run, regression: Regression}`, the regression against the current baseline |
| `runs.results` | `runId`, `status?` | `{items: ResultRow[], counts: {pass, fail, error}}`, no outputs |
| `results.detail` | `runId`, `resultId` | `Result` |
| `runs.trend` | `suiteId`, `limit?` (default 30, at most 100) | `{points: {runId, createdAt, passRate, avgScore, dimensionScores, totalCost, settings, promptVersion?}[], baseline?: {id, name, passRate}}`, completed runs oldest first |
| `runs.regression` | `runId`, `baselineId?`, `threshold?` | `Regression` |
| `runs.compare` | `runId`, `otherRunId` | `{a: Run, b: Run, deltas: {metric, a, b, delta}[], dimensionDeltas, cases: {caseId, caseName, a?: ResultRow, b?: ResultRow}[]}` |
| `baselines.list` | `suiteId?` | `{items: Baseline[]}` |
| `baselines.detail` | `baselineId` | `Baseline` plus `results: {caseId, caseName, score, status, dimensionScores}[]` |
| `redteam.report` | `runId` | `null`, or `{judgedBy: string[], byType: {attackType, total, bypassed, unscored}[], total, bypassed}` |

`Regression` is an explicit state machine, so no page ever has to infer one:

```ts
Regression =
  | { state: "running" }
  | { state: "notComparable", reason: "runFailed" | "runCancelled" | "otherSuite" }
  | { state: "noBaseline" }
  | { state: "compared", baseline: {id, name}, threshold: number,
      thresholdSource: "override" | "run" | "config",
      hasRegression, passRateDelta, avgScoreDelta, dimensionDeltas,
      regressedCases: {caseId, caseName, oldScore, newScore, delta}[],
      missingCases: {caseId, caseName}[], newCases: {caseId, caseName}[],
      missingDimensions: string[] }
```

The threshold comes from the override if given, else the run's recorded
`regression_threshold`, else config, and the answer names which.

In `redteam.report`, a case is bypassed when its result is `fail`, and
`unscored` counts results that are `error`. `judgedBy` lists the scorers the
run recorded, because three of the five generators attach no scorer of their
own, and a bypass rate judged by `exact` alone means something quite different
from one judged by an LLM.

### Commands

| intent | request | invalidates |
|---|---|---|
| `suites.create` | `name`, `description?`, `model?`, `temperature?`, `personaRef?`, `systemPrompt?` | `suites.list`, `overview.stats` |
| `suites.update` | `suiteId` plus every field above as optional pointers | `suites.list`, `suites.detail`, `runs.list` |
| `suites.delete` | `suiteId` | `suites.list`, `suites.detail`, `cases.list`, `cases.detail`, `prompts.list`, `prompts.detail`, `runs.list`, `runs.detail`, `runs.results`, `runs.trend`, `baselines.list`, `baselines.detail`, `overview.stats` |
| `cases.create` | `suiteId`, `name`, `input`, `expected?`, `scenarioType?`, `tags?`, `scorers?` | `cases.list`, `suites.detail`, `suites.list`, `overview.stats` |
| `cases.update` | `caseId` plus optional pointers | `cases.list`, `cases.detail` |
| `cases.delete` | `caseId` | `cases.list`, `suites.detail`, `suites.list`, `overview.stats` |
| `cases.import` | `suiteId`, `format: "json" \| "csv" \| "jsonl"`, `data` (at most 1 MiB) | as `cases.create`; answers `{imported}` |
| `prompts.create` | `suiteId`, `systemPrompt`, `changelog?`, `makeCurrent?` | `prompts.list`, `suites.detail`, `suites.list` |
| `prompts.setCurrent` | `suiteId`, `versionId` | `prompts.list`, `prompts.detail`, `suites.detail`, `suites.list` |
| `baselines.save` | `runId`, `name`; refuses a run that is not `completed` | `baselines.list`, `baselines.detail`, `suites.detail`, `runs.detail`, `runs.regression`, `runs.trend`, `overview.stats` |
| `baselines.delete` | `baselineId` | as `baselines.save` |
| `runs.start` | `suiteId`, `target`, `scorers[]`, `model?`; answers the new `Run` | `runs.list`, `overview.stats`, `suites.detail` |
| `runs.cancel` | `runId`; `FAILED_PRECONDITION` unless running | `runs.list`, `runs.detail`, `runs.results`, `overview.stats` |
| `redteam.generate` | `suiteId`, `attackTypes[]`, `count` (1 to 5); answers `{created, cap: 5}` | as `cases.create` |

`runs.start` answers `FAILED_PRECONDITION` for a suite with no cases, an
unknown target or an unknown scorer, each with a message that says which.

That makes 18 queries and 14 commands.

### Fixture server

The `sentinel` entries in `packages/fixture-server/server.mjs` model the
contract as it stands after phase 1, which differs from the library as it
stands today in ways that are deliberate: prompt versions number themselves,
import imports, set-current refuses a foreign version, and a started run
advances a few cases per read until it completes, so a page polling it can be
watched filling in. Anyone reading the fixture later against today's library
will see those as disagreements; they are the fixes, and this paragraph is the
record of that.

Writes change the next read, every time. Seed data includes a suite with a
current baseline and a regressed latest run, a suite with no baseline, a run
with red-team cases and a leakage output, a running run, and a cancelled one.
`verify.mjs` walks all 32 intents over HTTP.

## The React half

`packages/plugin-sentinel`, shaped like `plugin-vault`. The shell's design
system decides palette and type. The decisions here are form, hierarchy and
what each surface is allowed to claim.

### Routes and nav

| nav | route | page |
|---|---|---|
| Overview | `/` | counts, active runs with progress, recent regressions, a notice when no target is registered |
| Suites | `/suites`, `/suites/:id` | detail tabs: Cases, Runs, Prompts, Baselines, Red team |
| | `/suites/:id/cases/:caseId` | case detail and edit |
| | `/suites/:id/prompts/:versionId` | prompt version with a diff against the previous version (lazy) |
| Runs | `/runs`, `/runs/:id` | run list with suite and state filters; run detail |
| | `/runs/:id/results/:resultId` | one case: output, scorer reasons and details, dimensions, trace |
| | `/runs/:id/compare/:otherId` | comparison (lazy) |
| Baselines | `/baselines`, `/baselines/:id` | |
| Setup | `/setup` | targets, scorers and effective config; how to register a target when none are |

### Run detail

The verdict band is the one memorable element in the plugin. It states the
answer in a sentence, with its evidence, before any number or chart.

```
Run run_01j8…                             [Save as baseline] [Compare with…] [Cancel run]
Support bot · target llm:gpt-5 · prompt v3 · started 30 Sep 14:02 · took 4m 12s

┌─────────────────────────────────────────────────────────────────────────────┐
│ Regressed against "release-2" (current baseline), threshold 0.05 from run   │
│ Pass rate 0.82 to 0.74 (−0.08) · 3 cases regressed · trait not measured     │
└─────────────────────────────────────────────────────────────────────────────┘
 Pass rate │ Avg score │ Errored │ Tokens │ Cost reported by target

 Change from baseline (diverging bars)     Dimension scores (bars, fixed order)

 Results   [Pass 41] [Fail 7] [Error 2]                                50 results
 Case · Status · Score · Change vs baseline · Latency · Tokens · Cost

 Red team        bypass rate by attack type, when the run has red-team cases
 Scored with     pass threshold 0.7 · regression 0.05 · concurrency 4 · 3 scorers
```

- Running: the band becomes a progress meter, "23 of 50 cases scored, last
  progress 8 s ago", the stats say partial, the results table fills on a 3 s
  poll that pauses while the tab is hidden, and there is no verdict.
- No baseline: the band says so and offers "Save as baseline" on a completed
  run. It never says passed.
- Not comparable: the band names the reason.
- Settings not recorded: "Scored with" says so, and the regression threshold
  comes from config with that source shown.

### Starting a run

A confirm dialog names the suite, its case count, the target and its
description, the model and the scorers, and flags every scorer that calls an
LLM. It shows the last completed run's cost for this suite with the caveat
that the figure is what the target reported and LLM-judge calls are not
metered. The button reads "Start run on 50 cases". With no target registered,
there is no button: the suite page says why and links to Setup.

### Comparison

```
Compare  run_01j8… (A)  with  run_01j7… (B)                                  [Swap]
 Aggregate: one dumbbell per metric, A to B
 Cases   [Changed only]    Case · A · B · Change · Status A/B     (also "only in A/B")
   expanded row: side-by-side output diff, CodeMirror merge, loaded lazily;
   red-team outputs collapsed until revealed
```

### Charts

No surface needs a categorical palette. Data wears `--foreground`,
de-emphasis wears `--muted-foreground`, and `--destructive` marks a regression,
always beside an icon and a label. Contrast is validated in both modes with the
dataviz validator during implementation.

| surface | form | why |
|---|---|---|
| Runs tab trend | line over run order, x labelled by date; pass rate in ink, avg score muted and labelled at its end; reference line at the current baseline's pass rate; markers of at least 8 px link to the run | change over time, one series is the point |
| Dimensions over runs | seven small multiples, one sparkline each, shared 0 to 1 scale, canonical order; a missing point is a gap | seven lines on one plot is past the ceiling |
| Dimensions in one run | horizontal bars in the fixed order skill, trait, behavior, cognition, communication, perception, persona; pass-threshold line; "not measured" as text | magnitude across nominal categories, learnable across runs |
| Change from baseline | diverging bars around zero with the band beyond −threshold shaded; regressed bars destructive and labelled; values at the bar ends | a delta against a threshold is the question |
| Comparison aggregate | dumbbells | before and after per item |
| Red team | horizontal bars of bypass rate labelled "3 of 5" | magnitude |

Run order, not time, on the trend's x axis: runs are irregular, and a time
axis compresses a burst of ten runs into an unreadable cluster. The trade is
that a quiet month disappears, and the dated tick labels are how you see it.

Every chart has a table view and a tooltip, and the tooltip is never the only
way to read a value. A refetch holds the previous render.

### Badges

By proportion first, per the playbook.

| badge | outline | secondary | default | destructive |
|---|---|---|---|---|
| run state | completed | cancelled | running | failed |
| result status | pass | | error | fail |
| verdict | within threshold | no baseline, not comparable, pending | | regressed |
| scenario | standard | the other seven | | |
| markers | | | Current, Red team | |

Result status has no knowable majority (a suite can sit at a 30% pass rate),
so it takes a fixed semantic mapping and the work goes into the status filter
chips with their counts. Error takes default because it means the case could
not be judged, which is worth a second look and is a different thing from
failing. No surface says passed, healthy or safe without the evidence on that
row.

### Hostile content

Every output, input, reason and trace field renders as text in a `<pre>` with
wrapping. Nothing goes through markdown, `dangerouslySetInnerHTML` or link
detection. A result whose case is tagged `redteam` shows its attack type,
input and verdict, with the output collapsed behind "Show output (1,284
characters, leakage)". The reveal is per result and forgotten on reload.

### Loading

CodeMirror's merge view comes from the versions `plugin-vault` already pins,
imported only by the comparison page and the prompt diff, both lazy routes.
Outputs are plain text, not an editor. `BASELINE.md` gets re-measured and the
split confirmed in `pnpm build`.

## Sequencing

Both repos stay on `main`. Every commit names its exact paths with
`--only`, and `git show --stat HEAD` follows each one.

1. Library (`sentinel`): the postgres check, then config, scoring, prompt
   versions, import, cascade, regression, registries, async runs and cancel,
   red-team generation. Tests land with each fix.
2. Contract (`sentinel/extension/contract`) and the forge bump. The templ
   `DashboardAware` stays registered until phase 5, so nothing goes dark.
3. Fixture entries and `verify.mjs`.
4. Plugin: the kit line-parts commit, the scaffold and its wiring in
   `apps/shell` and `apps/example-next`, then suites and cases, prompts, runs
   list and detail, results, baselines and regression, trend and dimension
   charts, comparison, red team, overview and setup.
5. Retirement, below.

## Retiring the templ dashboard

After every surface has been clicked through in the browser against the
fixture: write `sentinel/MIGRATION.md` from the templ inventory, marking every
page, column, action, filter, badge, empty state, widget and setting as
migrated, dropped with a reason, or replaced. Then, as its own commit, delete
`sentinel/dashboard/`, the `DashboardContributor` method and the
`DashboardAware` assertion, every `*_templ.go`, and the templ and forgeui
requirements `go.mod` no longer needs. Check first with
`grep -rn "sentinel/dashboard" --include='*.go'`. Prove it with
`find . -name '*.templ'` returning nothing and `go build ./... && go test ./...`
passing.

Known dispositions, so `MIGRATION.md` starts from a list and not a memory:

| templ | goes to |
|---|---|
| Overview, both widgets | Overview |
| Suites list, form, detail | Suites, create and edit dialogs, suite detail |
| Cases list, form, detail | the Cases tab, case detail with edit; tags and scorers become editable |
| Prompts list, form, detail | the Prompts tab and version detail with diff; set-current added |
| Runs list | Runs, with the "Cases" column replaced by progress and a separate pass count |
| Run detail, report | run detail; the report page folds in, its content was a subset |
| Result detail | result detail, now with scorer details and a full trace |
| Baselines list, detail | Baselines; delete now works; save added |
| Scorers reference | Setup, listing what is registered, not a hardcoded ten |
| Settings panel | Setup, showing the effective config, not the defaults |
| Topbar "API Docs", `searchable` | dropped: the shell owns chrome, and search was declared and never implemented |
| Fake pagination on cases and baselines | dropped: both lists are bounded per suite and come back whole |

## Testing

- Go: unit tests for the engine, `DetectRegression` and the registry; store
  tests for every changed or new method on sqlite, postgres and mongo, with
  populated jsonb; `go test -race` over the engine; contract handler tests
  covering the two-tenant identity assertion, the three bad-claim cases, and a
  recorded fact per backend of what an empty app filter returns. Lint with a
  fresh cache every run.
- React: per-page vitest, including failure paths driven by a thrown
  `ContractError`, errors rendered inside open dialogs, `reset()` when a dialog
  opens, and `pending` on every confirm. `test`, `typecheck` and `lint` for the
  package, then `pnpm -r test`. `packages/host/test/setup-screen.test.tsx` fails
  for reasons unrelated to this work and is left alone.
- Browser: every surface, including a run started on the fixture and watched to
  completion, a cancel, a regression, a no-baseline run, a revealed red-team
  output and a comparison diff.

`MIGRATION.md` states what stays uncovered: the LLM scorers and the scenario
and dataset generators, which need real models; mongo returning nested maps as
`bson.D`; and postgres storing scores in 4-byte `REAL` columns. We also raise
the one-test-file finding with Sentinel's owner directly, since a dashboard
this well tested sitting on an engine with no tests looks trustworthy for the
wrong reasons.
