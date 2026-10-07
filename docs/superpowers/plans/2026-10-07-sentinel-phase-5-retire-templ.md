# Sentinel phase 5: retire the templ dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record everything Sentinel's templ dashboard did in `sentinel/MIGRATION.md`, delete `sentinel/dashboard/` in its own commit, move Sentinel to forge v1.12.0, and prove nothing templ is left.

**Architecture:** The extension already stopped registering the templ dashboard (sentinel 21dca4b). It implements only `ContractContributorAware`, and nothing outside `dashboard/` imports the package; the one remaining mention of `sentinel/dashboard` is a comment in `extension/contract/contract.go`. So the work is: write the record from the sources while they still exist, delete the directory (68 tracked files: 31 `.templ`, 31 generated `*_templ.go`, `contributor.go`, `data.go`, `manifest.go`, `pages/form_helpers.go`, `shared/pagination.go`, `shared/types.go`), correct the three comments that describe the old state, tidy, then bump forge. Every step's end state was run in a scratch copy of sentinel HEAD (51f6ffd) before this plan was written.

**Tech Stack:** Go 1.26, forge v1.11.2 then v1.12.0, golangci-lint, git.

**Spec:** `/Users/rexraphael/Work/xraph/forge-dashboard/docs/superpowers/specs/2026-09-30-sentinel-dashboard-design.md`, section "Retiring the templ dashboard" (the dispositions table there is the starting list `MIGRATION.md` expands).

## Global Constraints

- All work happens in `/Users/rexraphael/Work/xraph/forgery/sentinel`, on branch `main`. No worktrees. Nothing in forge-dashboard changes.
- Other sessions may keep uncommitted files in this repo. Commit only your own paths: `git add <explicit paths>` (or `git rm -r` for the deletion), then `git commit --only -m "<subject>" -m "<body>" -- <explicit paths>`, then `git show --stat HEAD` straight after.
- NEVER run `git add -A`, `git add .`, a bare-directory `git add`, `git checkout -- .`, `git restore .`, `git reset` (any form), `git stash`, `git clean` or `--amend`. To undo a mistake, back up and restore the single file.
- Leave the untracked `_project_files/` alone.
- Commit messages: no `Co-Authored-By` trailer, no AI attribution of any kind, no em or en dashes. Body: plain prose, "you" where natural, 2 to 5 lines. Use the exact messages given in each task.
- Prose that ships in the repo (`MIGRATION.md`) is written in Rex's voice and has already been through `rex-voice` and `humanizer`. Copy it exactly; do not reword it. Zero em dashes, zero en dashes.
- Go lint runs on a fresh cache only: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. At HEAD 51f6ffd it reports `0 issues.`; it must still say that after every task.
- Use `GOFLAGS=-mod=mod` for `go mod tidy` and `go get`, as in the pre-run.
- Do not dispatch subagents.

## Review Focus

1. A `MIGRATION.md` claim the React plugin does not back. Every "now" statement names a page or control in `packages/plugin-sentinel/src`; the text was fact-checked against both codebases before it went into this plan, and Task 1's coverage check confirms each templ source file is accounted for.
2. A templ element missing from the record because it lived in a component, widget, settings panel or `manifest.go` rather than a page. Task 1 Step 3 walks every one of the 31 `.templ` files and the manifest.
3. `go mod tidy` keeping `github.com/a-h/templ` or `github.com/xraph/forgeui` as a direct requirement after the deletion. On forge v1.11.2 they stay as `// indirect` (forge itself still needs them); on v1.12.0 they leave `go.mod` entirely. Tasks 2 and 3 check both states.
4. A comment that still describes the templ dashboard as alive or pending (`extension/extension.go:165-167`, `extension/contract/contract.go:1-4`, `extension/dashboard_aware_test.go:5-7`). Tasks 2 and 3 replace each one with exact text.
5. A proof that passes only because of something on this disk and not in git. Task 4 runs every proof again in a fresh clone.

---

### Task 1: Write MIGRATION.md

**Files:**
- Create: `MIGRATION.md` (repo root)

The record is written now, while `dashboard/` still exists to check it against. Once Task 2 deletes the directory, nothing is left to compare with.

- [ ] **Step 1: Write the file**

Create `/Users/rexraphael/Work/xraph/forgery/sentinel/MIGRATION.md` with exactly this content (the outer `~~~~` fence is not part of the file):

~~~~markdown
# Dashboard migration: templ to React shell

Sentinel's dashboard used to render server-side with templ and ForgeUI, from
`dashboard/`. It now lives in the Forge dashboard's React shell as
`@forge-go/dashboard-plugin-sentinel`, reading the `sentinel` contract
contributor in `extension/contract`. The commit after this file deletes the
templ package.

This file is the record of that move. We wrote it from an inventory of every
templ source, taken before anything changed: 31 `.templ` files (17 pages, a
helpers file, 10 components, 2 widgets and a settings panel), plus
`contributor.go`, `data.go`, `manifest.go`, `pages/form_helpers.go` and the
`shared` package. Once the directory is gone there's nothing left to check
against, so anything missing from here is a feature that went missing by
accident. Every page, column, action, form field, filter, badge, empty state,
widget and setting is listed below, and each one says whether it moved,
changed, or was dropped, and why.

The cut happened in two steps. Commit 21dca4b stopped the extension from
registering the templ dashboard, so nothing has served those pages since. The
commit that follows this file deletes `dashboard/` and the templ and ForgeUI
requirements with it.

## What you need to do

If you ran the templ dashboard through `DashboardAware`, you don't need to
change anything in Sentinel's code. The extension no longer implements
`DashboardAware` and has no `DashboardContributor()` method. It registers its
contract contributor through `ContractContributorAware`, and the shell finds
it. If your own code imports `github.com/xraph/sentinel/dashboard` (its
widgets, say), that import has to go: the package no longer exists.

Add the plugin to your shell:

```tsx
import sentinelPlugin from "@forge-go/dashboard-plugin-sentinel"

const plugins = [corePlugin, sentinelPlugin]
```

The pages mount at `/@sentinel`, under a nav group called Evaluation. They use
Tailwind classes of their own, so the shell's stylesheet has to scan the
package. If your shell declares its sources with `@source`, add
`@source "<path to>/packages/plugin-sentinel/src";` next to the others.

Tell Sentinel which app the dashboard works in:

```yaml
extensions:
  sentinel:
    dashboard_app_id: app_yourapp
```

The dashboard reads and writes inside one app. It takes the app from the
signed-in principal's `app_id` claim first, and nothing sets that claim yet, so
today it comes from `dashboard_app_id`. There's no default. With neither, every
dashboard request is refused, because an empty app id matches every app in
every store, and a dashboard that can see every tenant's suites is worse than
one that can't start.

Register at least one target if you want to start runs from the dashboard:

```go
sentinelext.New(
    sentinelext.WithTarget("support-bot", "The support assistant under test", myTarget),
)
```

A run sends each case to a target and scores the answer. The dashboard lists
what you registered, and with none it says so and links to Setup instead of
offering a button. Scorers you write yourself go in the same way, with
`WithScorer`, so the run dialog can offer them.

Sentinel needs forge v1.11.2 or later, because that's the first forge whose
dashboard transport passes a manifest's `invalidates` to the client, so a
write refreshes the pages that read what it changed. We build against v1.12.0,
which also stops pulling in templ and ForgeUI. The REST API under `base_path` is unchanged and
still mounts unless you set `disable_routes`.

## What changed underneath

The templ pages sat on an engine that had several bugs of its own, and the new
pages would have shown them faithfully. We fixed them first, in the library,
before writing a single page. If you use the engine directly, these matter more
than the UI does.

- Your config is applied. The extension merged YAML and code config and
  then never passed it to the engine, so every engine ran on the defaults
  (model "smart", temperature 0, pass threshold 0.7, concurrency 4). It passes
  the merged config now.
- Runs start asynchronously and store results per case. A run used to hold
  the request open and write every result at the end, so a running run looked
  like a 0% failure until it finished. Results land as each case is scored,
  and a run in flight can be cancelled, from any replica.
- A run records the settings it was scored with: pass threshold,
  regression threshold, concurrency, target, scorers, model and prompt
  version. Comparing two runs compares like with like, and a run's verdict
  does not move when you change the config later.
- Regression is checked when a run completes, against the suite's current
  baseline, with one `regression_threshold` (default 0.05) recorded on the run.
  It reports missing and new cases and dimensions, and an unmeasured dimension
  counts as a drop.
- Deleting a suite deletes its cases, runs, results, baselines and prompt
  versions on every backend. The old delete dialog promised this. Memory and
  Mongo removed only the suite row, and the cascade on Postgres and SQLite
  was not reliable.
- Prompt versions get numbers, and making one current stays inside its
  suite.
- Case import imports. It was a stub returning zero in all four stores.
- Red-team generation writes cases into a suite, and a run's red-team
  report counts bypasses by attack type.
- Targets and scorers are registered by name, so a run can name them, and
  a scorer that needs config refuses to build without it.
- Targets get the run's prompt, model and temperature, not the ones the
  target was built with.
- SQLite no longer loses concurrent writes, and Postgres and Mongo store
  empty JSON for nil maps instead of failing.

## Where each surface went

Every route below sits under `/@sentinel` in the shell. The intents are the
contract calls the page makes.

| templ surface | templ route | Now | Intents |
|---|---|---|---|
| Overview | `/` | Overview, `/` | `overview.stats` |
| Suites list | `/suites` | Suites, `/suites` | `suites.list`, `suites.create` |
| Suite form | `/suites/create`, `/suites/edit` | Create and Edit dialogs on the list and detail pages | `suites.create`, `suites.update` |
| Suite detail | `/suites/detail` | Suite detail, `/suites/:id`, with tabs | `suites.detail`, `suites.update`, `suites.delete` |
| Cases list | `/suites/cases` | The suite's Cases tab, `/suites/:id` | `cases.list`, `cases.create`, `cases.import` |
| Case form | `/suites/cases/create`, `/suites/cases/edit` | Add and Edit dialogs | `cases.create`, `cases.update`, `config.get` |
| Case detail | `/suites/cases/detail` | Case detail, `/suites/:id/cases/:caseId` | `cases.detail`, `cases.update`, `cases.delete` |
| Prompt versions list | `/prompts` | The suite's Prompts tab, `/suites/:id/prompts` | `prompts.list`, `prompts.create`, `prompts.setCurrent` |
| Prompt version form | `/prompts/create` | New version dialog | `prompts.create` |
| Prompt version detail | `/prompts/detail` | Version page with a diff, `/suites/:id/prompts/:versionId` | `prompts.detail`, `prompts.setCurrent` |
| Runs list | `/runs` | Runs, `/runs` | `runs.list`, `suites.list` |
| (none) | | The suite's Runs tab, `/suites/:id/runs`, with the trend and Start run | `runs.list`, `runs.trend`, `runs.start`, `config.get` |
| Run detail | `/runs/detail` | Run detail, `/runs/:id` | `runs.detail`, `runs.results`, `runs.regression`, `runs.cancel`, `baselines.save`, `baselines.detail`, `baselines.list`, `runs.list`, `redteam.report` |
| Run report | `/runs/report` | Folded into run detail | as run detail |
| Result detail | `/runs/results/detail` | Result detail, `/runs/:id/results/:resultId` | `results.detail`, `runs.detail`, `cases.detail` |
| (none) | | Comparison, `/runs/:id/compare/:otherId` | `runs.compare`, `results.detail` |
| Baselines list | `/baselines` | Baselines, `/baselines`, and the suite's Baselines tab | `baselines.list`, `baselines.delete` |
| Baseline detail | `/baselines/detail` | Baseline detail, `/baselines/:id` | `baselines.detail`, `baselines.delete` |
| Scorers reference | `/scorers` | Setup, `/setup` | `config.get` |
| (none) | | The suite's Red team tab, `/suites/:id/redteam` | `redteam.generate`, `redteam.report`, `cases.list` |
| `sentinel-stats` widget | | Overview counts | `overview.stats` |
| `sentinel-recent-runs` widget | | Overview recent runs | `overview.stats` |
| `sentinel-config` settings panel | | Setup | `config.get` |

## Page by page

### Overview

- The four stat cards become three counts: Suites, Cases and Runs.
- Avg Pass Rate is dropped. It was the unweighted mean of every completed
  run in history, and it showed "0.0%" when there were none, which reads as a
  failure. A number averaged across unrelated suites does not answer a question
  anyone asks, and the overview leads with the ones they do: is a target
  registered, what is running, and what regressed.
- New: a notice when no target is registered, with a link to Setup, above
  everything else. Without a target no run can start.
- Recent Runs keeps suite, state and pass rate, and adds the run id, cases
  scored, passed, errored, the cost the target reported and the start time.
  Model moved to the run page. Times are local and include the date.
- Active Runs shows a progress meter and "X of Y" from the cases actually
  scored. The old Progress column was always "0/N cases", because results only
  existed at the end.
- New: Recent regressions. Regressed runs among the twenty newest
  completed ones, with the baseline they fell against and their worst drop.
- The page refreshes every three seconds while a run is active.
- The "View All Suites" and "View All Runs" buttons are gone; the nav has
  both, and the recent runs table has "Every run".

### Suites list

- Name and Model stay. Model says "Engine default" when the suite sets
  none. Description, Temperature and Persona left the list; they are on the
  suite page.
- New columns: the case count, the prompt in use (the suite's own, or the
  current version by number), the current baseline's name, and when the suite
  last changed.
- Search is dropped. It filtered only the page it was on and left the count
  unfiltered. The list comes back whole, oldest first.
- Pagination is dropped. It was done in memory over the full list anyway.
- New Suite opens a dialog instead of a page. View and Edit become the row's
  name link and the detail page's Edit.
- Delete moved to the suite page, behind a confirm that lists what goes with
  the suite. That is now true; it was not before (see What changed underneath).

### Suite form

- Name, Description, Model, Temperature, Persona and System prompt stay, in a
  dialog. Edit prefills every field and sends every field, so nothing you
  did not touch changes.
- Temperature keeps its value. The old edit form rounded it to one decimal
  on prefill, so saving 0.75 quietly stored 0.8. An empty temperature now means
  "use the engine's".
- The form refuses a blank name and an out-of-range temperature before
  sending, in the server's words, and shows a refusal inside the dialog
  instead of swapping JSON into an error div.

### Suite detail

- The header keeps the name, description and Edit, and gains Delete.
- The stat cards become facts: model, temperature, persona, prompt, current
  baseline with its pass rate, case count, created and updated. Temperature
  says "Engine default" when the suite sets none, which is what the engine now
  does with 0.
- Tabs replace the stacked cards: Cases, Runs, Prompts, Baselines and Red
  team. The tab is in the address, so a link can land on a suite's runs.
- The suite's own system prompt is edited in the Edit dialog. Each version's
  prompt is on its version page.
- New: a Start run button on the Runs tab, with a confirm that names the
  suite, case count, target, model and scorers before anything runs. The old
  page had no way to start a run.
- The page shows no tabs for a suite that never loaded, and keeps its tabs and
  any open dialog if a later refresh fails.

### Cases list

- Now the suite's Cases tab. Name, Scenario, Tags and the case's own scorers
  stay. The scorer count became the scorer names.
- New columns: a one-line input, and Red team with the attack type.
- New: Import cases from JSON, JSONL or CSV, with the count imported.
- Pagination is dropped. It was fake: every case rendered and Next
  reloaded the same list.
- Edit and Delete moved to the case page.

### Case form

- Name, Scenario type, Input and Expected output stay, in a dialog.
- Tags and scorers are editable now. The old form could not touch them.
  Scorers are a list of rows, each a registered scorer with its config.
  Context still is not editable; the case page shows it.
- A red-team case's leakage substring is never shown, only its length, and
  editing the case without retyping it keeps the stored one. The substring is
  the system prompt the case checks for.
- The old create form posted flat fields where the API expected a list, and
  the old edit form had no route at all. Both now work through the contract.

### Case detail

- Scenario, Tags, Input, Expected output and Context stay. Suite ID and Case
  ID give way to a link back to the suite, with created and updated times.
- Metadata is not shown. The contract still sends it, so this is a gap we
  have not closed yet, not a decision.
- Scorers show each one's config as text, with a withheld substring shown as
  "The substring, N characters".
- Delete is new, and Edit now works.

### Prompt versions list

- Now the suite's Prompts tab. Version, Changelog, Current and Created stay,
  with Runs (how many runs used the version).
- Pass rate and Avg score, averaged over every run of the version, become the
  latest completed run's pass rate. Runs of one version can use different
  scorers and thresholds, and an average over them mixes unlike things.
- New: Make current, behind a confirm. The API always had it and nothing
  called it.
- New version opens a dialog. The old `?page=` links meant this list was
  effectively unreachable.

### Prompt version form

- System prompt and Changelog stay. "Set as current version" now works, as
  "Make it current", ticked by default. The old form posted to a path with no
  handler, and the API had no such field.
- The prompt starts as the one runs use today, so you edit it rather than
  retype it.

### Prompt version detail

- The prompt and changelog stay. The stat cards rendered their arguments in
  the wrong slots; the facts are plain now: number, created, runs, latest pass
  rate.
- New: a diff against the version before, loaded only when you open a
  version. The linked run is dropped; a version is used by many runs, and the
  Runs count says how many.

### Runs list

- Suite, State, Pass rate and Started stay, with the run id first.
- The "Cases" column is replaced. It showed passed over total and read like
  progress. Now there is "Cases scored" (X of Y, with a meter while running) and
  a separate Passed column.
- New columns: Errored and the cost the target reported. Model, Avg score
  and Tokens moved to the run page.
- The state and suite filters stay, and paging is now newer and older runs.
- The list refreshes every three seconds while a run on the page is running.
- The Report action folded into the run page.

### Run detail and run report

- The report page folds into run detail: its content was a subset, and its
  stat cards were in the wrong slots.
- New: a verdict band that answers first: regressed against which baseline,
  within threshold, no baseline yet, or why the run is not compared (cancelled,
  failed, another suite). It names the evidence: the pass rate change, regressed
  cases, average score and dimension drops, unmeasured dimensions, missing and
  new cases.
- Pass rate (with passed of scored under it), Avg score, Errored, Tokens and
  Cost stay as stats, from the run's own counters. Failed is the Fail count on
  the results filter. The old page read them from the results and
  showed "of 0 total" for a run that had not stored any yet.
- Latency moved to each result. An average latency across cases with very
  different inputs says little.
- Dimension scores keep their bars, now in a fixed order with the pass
  threshold drawn and unmeasured dimensions named. They used to come out in a
  random order on every render.
- New: change from baseline, each case's score against the baseline the run
  was compared with, worst first, with the stretch past the threshold shaded.
- New: View against. Compare a completed run against another of the
  suite's baselines, or at another threshold, for that view only.
- Results keep Case, Status, Score, Latency, Tokens and Cost, add Change vs
  baseline, and filter by status with a count on each.
- New: Save as baseline, Cancel run and Compare with… The old page had none
  of them.
- New: a red-team section with the bypass rate by attack type and the
  scorers that judged it.
- The run's error, settings (thresholds, concurrency, target, scorers, model,
  prompt version) and duration are on the page. A running run shows a progress
  meter and refreshes every three seconds; there is no verdict until it ends.
- The page used to panic when the result stats failed to load. It does not.

### Result detail

- Score, Latency, Tokens, Cost, the output and the scorer table stay.
- Scorer details are shown. The old page dropped them, and kept only each
  scorer's reason.
- The trace shows every step and tool call in full, not one CSS-truncated
  line per field.
- New: the case's input, read from the case, with a note if the case has
  been deleted since.
- A red-team result keeps its output, trace, tool calls, scorer reasons and
  error collapsed until you ask for them, per result. The output may repeat
  the system prompt or carry the attack.
- Every output, reason and trace field renders as text. Nothing is read as
  markup.

### Comparison (new)

Compare with… on a run opens the comparison, with the older run as A. Scores
come first as dumbbells on one scale (pass rate, average score and each shared
dimension), then latency and cost in words, then every case with its change and
a Changed only filter. Any case's outputs open as a diff; a red-team case's only
after you ask.

### Baselines list

- Name, Suite, Pass rate, Avg score and Cases stay, now across every suite
  and on each suite's Baselines tab. Current is a badge beside the name, and
  Created is called Saved.
- New: From run, a link to the run the baseline was saved from.
- Delete works. The API had no delete route, so the old dialog failed, and
  then could not close itself either. Deleting the current baseline now says
  plainly that nothing takes its place.
- Save is new, from a completed run's page.
- The suite filter is the suite's own tab now. The old filter only worked by
  accident.
- Pagination is dropped. It was fake here too.

### Baseline detail

- Name, Current, the per-case results with status and score, the run's
  dimension scores and the run it came from stay. The run is a link now.
- Each case's own dimension badges are dropped; the case's score stays.
- The stat cards rendered their arguments in the wrong slots; the facts are
  plain now.
- New: Delete, which then returns to the suite's Baselines tab.

### Scorers reference

- Replaced by Setup, which lists the scorers the engine actually has registered,
  with each one's dimension, whether it calls an LLM, and whether it needs
  config of its own. The old page was a hard-coded list of ten, one of which
  (`custom`) was never a registered scorer, and it did not mention the eleven
  programmatic scorers at all. Setup lists the nine built-ins plus whatever
  you register with `WithScorer`.

### Widgets and settings

- The two widgets are the Overview's counts and recent runs. The React shell has
  no widget slots for an extension, and the Overview shows more than both did.
- The settings panel is Setup, showing the effective config: default
  model, temperature, pass threshold, regression threshold and concurrency,
  plus the registered targets. The old panel always showed the defaults,
  because the config never reached the engine, and called itself "Configure
  Sentinel engine behavior" though it was read-only. Setup is read-only too and
  says how to register a target when there are none.

## Dropped, and why

| What | Why |
|---|---|
| Topbar "API Docs" action and sidebar footer link | The shell owns the chrome. |
| `searchable` capability | Declared and never implemented. |
| Suites search | It filtered only the current page and left the count wrong. |
| Pagination on suites, cases and baselines | Suites paged in memory; cases and baselines were fake. Each list comes back whole. Runs page for real. |
| Avg Pass Rate stat | An unweighted all-history mean across unrelated suites, "0.0%" with no data. |
| Run report page | Its content was a subset of run detail. |
| Run detail's average latency card | Latency is per result now. |
| The linked run on a prompt version | A version is used by many runs; the Runs count replaces it. |
| Widgets as widgets | No widget slots in the shell; the Overview covers both. |
| Avg score on the prompt versions list | It averaged runs scored with different settings. |
| Per-case dimension badges on a baseline | The run's dimension scores stay. |
| Case metadata on the case page | Not a decision: the contract sends it and the page does not show it yet. |

## What the templ dashboard got wrong

The inventory found these, and they are the reason some surfaces changed rather
than moved:

1. Every write would have failed. Forms set `json-enc` but the shell never
   loaded it, so bodies went out form-encoded, which the API's binder very
   likely refused. Case edit, case delete, prompt version create and baseline
   delete went to paths with no handler, and case create sent the wrong body
   shape.
2. There was no way to start a run, save a baseline, make a prompt current,
   compare runs, import cases or generate red-team cases.
3. The settings panel showed the engine's defaults, never your config.
4. Three pages passed stat card arguments in the wrong order.
5. Run detail panicked when result stats failed to load.
6. Delete dialogs called `.close()` on a div and never closed.
7. A running run looked like a 0% failure on the runs list, the overview and
   the run page.
8. Every `?page=` link re-rendered the current page, so the prompts list was
   unreachable and the baseline filter worked by accident.
9. Write paths were hard-coded to `/sentinel/v1` and broke under a custom
   `base_path`.
10. A raw `suite_id` from the query string went into inline JavaScript, a
    possible reflected XSS.
11. Dimension scores came out in random order, score bar colours ignored the
    pass threshold, and timestamps in lists and the overview had no year.
12. Store errors became empty lists, so a database failure read as "No suites
    found".
13. Text was truncated by bytes, which could split a character.

## Badges

| Badge | templ | Now | Why |
|---|---|---|---|
| Run state: completed | grey | outline | Most runs are complete; it recedes. |
| Run state: running | primary | primary | Worth a look while it runs. |
| Run state: cancelled | outline | grey | |
| Run state: failed | destructive | destructive | |
| Result: pass | primary | outline | A pass is the common case. |
| Result: fail | destructive | destructive | |
| Result: error | destructive | primary | It means the case could not be judged, which is different from failing. |
| Verdict | (none) | regressed destructive, within threshold outline, the rest grey | Only a regression is loud, and always with an icon and a word. |
| Scenario | colours per type, cognitive stress red | standard outline, the rest grey | A scenario is not a severity. |
| Current | primary | primary | A marker worth finding. |
| Red team, Calls an LLM | (none) | primary | Markers worth finding. |
| Needs config | (none) | grey | |
| Scorer verdict | (none) | passed outline, failed destructive | The same rule as a result. |

## What stays uncovered

The tests do not reach four things, and you should know which:

- The LLM scorers and the scenario and dataset generators need real models, so
  nothing here runs them.
- The Mongo store reads nested values in a case's context and metadata, and
  in scorer config, back as `bson.D`, not as Go maps.
- Postgres stores scores and costs in 4-byte `REAL` columns, so a score read
  back can differ from the one written in the last few digits.
~~~~

- [ ] **Step 2: Check it for dashes and bold lead-ins**

Run:

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
grep -c '—\|–' MIGRATION.md
grep -c '\*\*' MIGRATION.md
```

Expected: `0` and `0`.

- [ ] **Step 3: Check every templ source is accounted for**

Run:

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
find dashboard -name '*.templ' | wc -l
find dashboard/pages -name '*.templ' | wc -l
find dashboard/components -name '*.templ' | wc -l
find dashboard/widgets dashboard/settings -name '*.templ' | wc -l
```

Expected: `31`, `18`, `10`, `3`. These match the intro's count (17 pages plus `helpers.templ`, 10 components, 2 widgets, 1 settings panel).

Then confirm by reading, not by grep, that each page file has a section or table row: `overview`, `suites`, `suite_form`, `suite_detail`, `cases`, `case_form`, `case_detail`, `prompts`, `prompt_form`, `prompt_detail`, `runs`, `run_detail`, `report`, `result_detail`, `baselines`, `baseline_detail`, `scorers` (17). The widgets `stats` and `recent_runs` and the settings `config` are under "Widgets and settings". The components (`confirm_dialog`, `dialog_helpers`, `empty_state`, `footer_links`, `json_viewer`, `page_header`, `path_rewriter`, `score_bar`, `stat_card`, `state_badge`) are covered where their behaviour shows: badges in "Badges", the footer link in "Dropped, and why", the dialog bugs, stat card order and path rewriting in "What the templ dashboard got wrong". `manifest.go`'s nav, topbar action, `searchable` capability, widgets and settings are in the table and "Dropped, and why". If any is missing, stop and report it; do not write new prose.

- [ ] **Step 4: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
git add MIGRATION.md
git commit --only -m "docs: record what the templ dashboard did and where it went" -m "MIGRATION.md lists every page, column, action, filter, badge, widget and setting the templ dashboard had, and says for each whether it moved to the React plugin, changed, or was dropped and why. It also covers what you need to change in your app, and the bugs the old pages had. We wrote it before deleting the directory, so it was checked against the real sources." -- MIGRATION.md
git show --stat HEAD
```

Expected: one file, `MIGRATION.md`, added.

---

### Task 2: Delete the templ dashboard

**Files:**
- Delete: `dashboard/` (68 tracked files)
- Modify: `extension/extension.go:165-167` (comment only)
- Modify: `extension/contract/contract.go:1-4` (comment only)
- Modify: `go.mod` (tidy)

The spec asks for this as its own commit, so a revert of it brings the directory back and touches nothing else.

- [ ] **Step 1: Confirm nothing imports the package**

Run:

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
grep -rn "sentinel/dashboard" --include='*.go' --exclude-dir=dashboard --exclude-dir=_project_files .
grep -rn "DashboardContributor\|DashboardAware\b" --include='*.go' --exclude-dir=dashboard --exclude-dir=_project_files .
```

Expected: the first prints exactly one line, the comment at `extension/contract/contract.go:4`. The second prints nothing. Any import line means something still uses the package: stop and report it.

- [ ] **Step 2: Remove the directory**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
git rm -r -q dashboard
git status --short dashboard | wc -l
ls dashboard 2>&1
```

Expected: `68`, then `ls: dashboard: No such file or directory`. If `ls` lists anything, it is an untracked file inside `dashboard/` that is not yours: stop and report it, do not delete it.

- [ ] **Step 3: Correct the extension comment**

In `extension/extension.go`, replace:

```go
// RegisterContractContributor implements dashboard.ContractContributorAware:
// it registers the sentinel contract contributor the React shell reads.
// The templ dashboard is no longer registered; its dashboard/ directory remains until the React pages replace it.
```

with:

```go
// RegisterContractContributor implements dashboard.ContractContributorAware:
// it registers the sentinel contract contributor the React shell reads.
```

- [ ] **Step 4: Correct the contract package comment**

In `extension/contract/contract.go`, replace:

```go
// Package contract wires Sentinel into the Forge dashboard's contract path.
// It registers the `sentinel` contributor and answers its intents from the
// engine. This is the surface the React shell reads; the templ dashboard in
// sentinel/dashboard is retired once every surface has an equivalent here.
```

with:

```go
// Package contract wires Sentinel into the Forge dashboard's contract path.
// It registers the `sentinel` contributor and answers its intents from the
// engine. This is the only dashboard surface Sentinel has: the React shell
// reads it through @forge-go/dashboard-plugin-sentinel.
```

- [ ] **Step 5: Tidy**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
GOFLAGS=-mod=mod go mod tidy
git diff go.mod
git diff --stat go.sum
```

Expected `go.mod` diff: `github.com/a-h/templ v0.3.1001` and `github.com/xraph/forgeui v1.4.1` leave the direct `require` block and reappear in the indirect block as `// indirect` (forge v1.11.2 itself still requires them). No other line changes. `go.sum` is unchanged.

- [ ] **Step 6: Prove it**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
find . -name '*.templ' -not -path './_project_files/*' | wc -l
find . -name '*_templ.go' -not -path './_project_files/*' | wc -l
go build ./... && go vet ./... && go test ./... >/dev/null; echo exit=$?
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
```

Expected: `0`, `0`, `exit=0`, `0 issues.`

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
git add extension/extension.go extension/contract/contract.go go.mod
git commit --only -m "refactor: delete the templ dashboard" -m "Nothing has registered dashboard/ since 21dca4b, and MIGRATION.md says where each of its surfaces went, including the one gap left (case metadata). templ and forgeui are no longer direct requirements. forge v1.11.2 still pulls them in, so they stay as indirect until the forge bump." -- dashboard extension/extension.go extension/contract/contract.go go.mod
git show --stat HEAD | tail -3
git status --short | grep -v '^?? _project_files/'
```

Expected: `71 files changed` (68 deletions plus the three edited files), and the status line prints nothing.

---

### Task 3: Move to forge v1.12.0

**Files:**
- Modify: `go.mod`, `go.sum`
- Modify: `extension/dashboard_aware_test.go:5-7` (comment only)

Sentinel already works on forge v1.11.2, the first forge that passes a manifest's `invalidates` to the client. v1.12.0 is the forge the other migrated extensions build against, and it no longer pulls templ or forgeui at all.

- [ ] **Step 1: Bump**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
GOFLAGS=-mod=mod go get github.com/xraph/forge@v1.12.0
GOFLAGS=-mod=mod go mod tidy
git diff go.mod
grep -c "a-h/templ\|xraph/forgeui" go.mod go.sum
```

Expected: `go: upgraded github.com/xraph/forge v1.11.2 => v1.12.0`. The `go.mod` diff changes forge to `v1.12.0` and removes `github.com/a-h/templ`, `github.com/xraph/forgeui`, `github.com/Oudwins/tailwind-merge-go` and `nhooyr.io/websocket` from the indirect block. The grep prints `go.mod:0` and `go.sum:0`.

- [ ] **Step 2: Correct the assertion comment**

forge v1.12.0's dashboard root package no longer imports templ, so the reason in `extension/dashboard_aware_test.go` is out of date, though the rule still holds (the root package adds about 140 packages, its handlers, collector and discovery among them, that the extension never calls). Replace:

```go
// The dashboard finds contributors by type assertion at runtime. The check
// lives here so the production build never imports the dashboard's root
// package, which would pull forge's templ UI into it.
```

with:

```go
// The dashboard finds contributors by type assertion at runtime. The check
// lives here so the production build never imports the dashboard's root
// package, which would pull the dashboard's own server (its handlers,
// collector and discovery) into it.
```

- [ ] **Step 3: Prove it**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
go build ./... && go vet ./... && go test ./... >/dev/null; echo exit=$?
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
go list -deps ./... | grep -c "forge/extensions/dashboard$"
```

Expected: `exit=0`, `0 issues.`, `0` (the production build still does not import the dashboard root).

- [ ] **Step 4: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/sentinel
git add go.mod go.sum extension/dashboard_aware_test.go
git commit --only -m "build: move to forge v1.12.0" -m "This is the forge the other migrated extensions build on. It no longer pulls templ or forgeui, so both leave go.mod and go.sum. Nothing in Sentinel's code changes; a comment in the dashboard assertion test gets a reason that is still true." -- go.mod go.sum extension/dashboard_aware_test.go
git show --stat HEAD
```

Expected: three files changed.

---

### Task 4: Prove it from a clean clone

**Files:** none changed.

The repo has untracked files (`_project_files/`) and possibly other sessions' work. The proof has to hold for what is committed.

- [ ] **Step 1: Clone and run every proof**

```bash
D=$(mktemp -d)
git clone -q /Users/rexraphael/Work/xraph/forgery/sentinel "$D/sentinel"
cd "$D/sentinel"
git log --oneline -3
find . -name '*.templ' | wc -l
test -d dashboard && echo "dashboard still here" || echo "no dashboard"
grep -rn "sentinel/dashboard" --include='*.go' . | wc -l
grep -n "forge \|a-h/templ\|forgeui" go.mod
go build ./... && go vet ./... && go test ./... >/dev/null; echo exit=$?
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
cd / && rm -rf "$D"
```

Expected: the three commits from Tasks 1 to 3 on top; `0`; `no dashboard`; `0`; one line, `github.com/xraph/forge v1.12.0`; `exit=0`; `0 issues.`

- [ ] **Step 2: Report**

Nothing is pushed. Report the three commit hashes and the proof output.
