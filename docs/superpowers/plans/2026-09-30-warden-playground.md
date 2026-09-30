# Warden playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give warden a playground that runs one check without side effects and shows, lane by lane, why it came out as it did, and let an operator open any check log row in it.

**Architecture:** A core `Engine.Explain` runs the same model pipeline as `Check`, as a dry run, and returns each model's own result beside the merged one. `Check` and `Explain` share one extracted pipeline, so the explanation cannot drift from the decision. One contract intent, `playground.explain`, projects it. One React page, reachable empty at `/playground` and prefilled at `/playground/check/:checkId`, renders the builder, the verdict, three lanes and the sentence that says why.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0` (dashboard contract, dispatcher), React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, slice 11. The sections "`CheckResult` cannot explain a denial", "`Check` is not safe to re-run", "The playground" and "Honesty about the reconstruction" are the design authority.

**Predecessors:** plans `2026-09-23-warden-spine.md` (which added `WithCallDryRun`), `2026-09-29-warden-policies.md` and `2026-09-30-warden-check-log.md`. This plan assumes the contract package and its three guards, `tenantFrom`, `validateNamespace`, `validSubjectKinds`, the plugin package, `warden-fixtures.mjs`, the `/roles/:id` and `/policies/:id` routes, and the check log's `checkLogs.detail` and `components/check-log.tsx`.

**Scope note:** the spec's plan 4 was "playground plus subject view". It is split, as plans 2 and 3 were. This is 4a. Plan 4b carries the subject access view (`subjects.detail`), `playground.batchCheck`, subject links from the check log, assignments and playground, and a namespace filter that can pick leaf namespaces.

## Global Constraints

- Contributor name is exactly `warden`. The plugin's `extension` field must match it.
- Contract DTOs are camelCase. Never return a warden domain struct (snake_case) on the wire.
- Every handler resolves its tenant with `tenantFrom(p, deps)`, never from the request context or the request body. The playground passes that tenant to the engine with `warden.WithCallTenantID`, which outranks any tenant inside the `CheckRequest`.
- Every new handler is added to **three** self-checking guards, all sized against registrations parsed from `contract.go`'s source: `handlers_tenant_test.go`'s table, `manifest_test.go`'s `wantKind` map, and `authz.go`'s `intentPolicies` with its mirror `wantPolicies` in `authz_test.go`. An intent absent from `intentPolicies` is **denied**. Extend them; never loosen an assertion.
- Every manifest intent line carries `requires: { warden: warden.engine }`.
- `playground.explain` authz is `check` on `warden:authz`, matching `api/check_handler.go`.
- **Every sentence a page shows about a check must be true for every case it can appear in.** Verify against `engine.go` and `evaluator.go`, never against a comment. The facts below are verified; a task that needs another one reads the code.
- `Check`'s observable behaviour does not change. Every existing root-package test passes unmodified.
- Identifier values carry `font-mono text-xs`. The tenant root renders as `/`. Errors render beside the control or form that can fail.
- React tests use `fireEvent`, `toBeTruthy()` and `.textContent`; no `user-event`, no `jest-dom`. Failure tests stub a thrown `ContractError`, never `{ok: false}`.
- No em dashes anywhere, including comments, JSX text and commit messages. No `Co-Authored-By` trailers and no Claude or Anthropic attribution.
- Both trees are shared with other live sessions holding over a hundred uncommitted files. Commit by explicit path; stage new files with `git add <path>` first; never `git add -A`, `git commit -a` or `--amend`; verify by SHA, never HEAD. Restore a mutated file only from its own backup or `git checkout -- <exact path>`; never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. Delete only files you created, by exact name. Never point anything at local port 5432.

## What the engine actually does

Verified against `warden/engine.go` and `warden/evaluator.go` for this plan. Tasks rely on every line.

- **`Check` validates first**: an empty subject id, action name or resource type returns a plain error (`engine.go:201-209`), before any scope work. With `RequireTenant` on, an empty tenant returns `ErrTenantRequired`.
- **Scope precedence**: context, then `CheckRequest.TenantID`/`NamespacePath`, then call options (`engine.go:211-231`). `WithCallNamespacePath("")` explicitly selects the tenant root.
- **The pipeline**, in order:
  - RBAC runs when enabled.
  - ReBAC runs when enabled and RBAC did not allow, or when `EvaluateAllModels` is on.
  - ABAC runs whenever it is enabled, even after an allow.
  - A store error in any model makes `Check` return `(nil, err)` through `failCheck`, and no later model runs (`engine.go:266-297`).
- **Merge** (`mergeDecisions`, `engine.go:696`):
  - ABAC `deny_explicit` wins outright.
  - Otherwise the first allow among RBAC, ReBAC, ABAC, in that order, wins.
  - Otherwise the first non-empty reason among them wins.
  - Otherwise `deny_default`.
  - Obligations merge from every model regardless of which won.
- **Only ABAC can deny.** RBAC returns `allow`, `deny_no_roles` or `deny_no_perms`; ReBAC returns `allow` or `deny_relation`. Both of those "denials" mean "this model granted nothing". ABAC returns `allow`, `deny_explicit`, or **nil** when no policy matched (`evaluator.go:141-152`).
- **ABAC reports one policy.** The first deny by priority wins over any allow; otherwise the first allow. Its `MatchedBy` names that one policy. An allow policy whose condition throws is skipped with a warning log, and nothing reaches the result.
- **ReBAC swallows two things.**
  - A graph walk that stops at `MaxGraphDepth` or `MaxGraphVisited` sets the unexported `CheckResult.truncated`. `Check` folds that into the merged reason as `truncatedWalkNote` only when the merged result is a denial.
  - A resource-type expression that errors is logged and treated as no match (`engine.go:640-644`).
- **A dry run** (`WithCallDryRun`) skips the `BeforeCheck` hook, the cache read and write, the `AfterCheck` and obligation hooks, and the check log write, including `failCheck`'s (`engine.go:236,255,317,322,327,343`).
- **What a check log row does not record**: the request's `Context`, `Subject.Attributes` and `Resource.Attributes`. `buildCheckLogEntry` stores subject, action, resource and namespace only.

## Deviations from the spec

The spec is the binding authority. Each deviation below corrects a fact in it or changes a decision it recorded; the spec is corrected in the same commit as this plan.

1. **`Engine.Explain` goes into core now, not after a contract-side reconstruction.** The spec's first "decision taken" puts the explain logic in the contract first, reconstructing each lane by re-reading the store, with a `consistent` flag for when the reconstruction disagrees with the real verdict. That has two costs: duplicated evaluator logic, and the race the flag exists to admit. Warden's `soc2-hardening` branch already carries this migration's core changes (`WithCallDryRun`, `CheckLogLoss`, the `Cached` filter), so the spec's reason to wait on core no longer applies. `Explain` shares `Check`'s pipeline, so the lanes and the verdict come from one evaluation. The `consistent` flag does not exist, and a truncated walk and a failed expression are reported as facts, not guessed.
2. **Lane states split the spec's `deny`.** The spec's `deny` state means "evaluated, nothing matched". Only ABAC can deny. RBAC and ReBAC can only fail to allow, and ABAC with no matching policy contributes nothing. So the states are:
   - `allow`;
   - `deny` (ABAC only: a deny policy matched);
   - `noMatch` (evaluated and granted nothing, with the model's reason when it gave one);
   - `skipped` (ReBAC only);
   - `disabled`;
   - `error`;
   - `notEvaluated` (an earlier model's store error stopped the pipeline, exactly as it stops `Check`).
3. **No `playground.check`.** `playground.explain` returns the verdict too, so a second intent would be a second path to the same answer. The intent surface loses one.
4. **`playground.batchCheck` moves to plan 4b** with the subject view.
5. **Obligations read "would emit".** A dry run fires no obligation hook, so the spec's `emits` label would claim something that did not happen.
6. **Context and attributes are builder fields.** The spec's builder shows `context json` only. ABAC resolves `subject.<x>` and `resource.<x>` from the request's attributes, so a playground without them cannot reproduce a check that carried them. They sit behind a disclosure, empty by default.

## Review Focus

1. **A playground run leaving a trace.** A cache write, a hook or a check log row from the playground would put playground traffic in the audit trail the check log page shows. Task 1 asserts all three are absent, and Task 2 asserts the handler passes `WithCallDryRun`.
2. **`Check` changing under the refactor.** Extracting the pipeline could alter an error message, the truncation note, or which model runs after an allow. Task 1 keeps every existing test untouched and adds an equivalence test: `Explain(...).Result` equals a dry-run `Check` across a matrix of seeds and configs.
3. **A tenant from the request body.** A `tenantId` in the playground input, or a `CheckRequest.TenantID` passed through, would let a tenant check another tenant's access. Task 2 accepts no tenant field and passes the principal's tenant as a call option, which outranks the request.
4. **A missing field answered anyway.** `Check` refuses an empty subject id, action or resource type. A fixture or handler that answers regardless lets the page ship without sending one. Tasks 2 and 3 refuse each with a field-named `BAD_REQUEST`.
5. **A prefilled run implying it reproduces the original.** "Open in playground" from a check log row cannot restore context or attributes, which the log never recorded. Task 5 says so on the prefilled page.

## Design

- **The verdict is one line, and the lane that decided it carries the weight.** No 2xl ALLOWED or DENIED. The verdict line is the decision badge (same variants as the check log), the reason, and the evaluation time.
- **Three lanes in pipeline order**, RBAC, ReBAC, ABAC, each a row: a lowercase model name, a state word, then the lane's evidence. The deciding lane carries a left rule in the foreground colour and the words "decided it". Only an ABAC `deny` takes the destructive colour, as on the policy page, because an explicit deny overrides every other model.
- **Evidence** is the lane's reason, or its matched rule as a link (a role to `/roles/:id`, a policy to `/policies/:id`), plus the lane's own note: a truncated walk, a failed expression, an error message.
- **The sentence under the lanes** names why this beat that. It is computed from the lanes and the verdict by one pure function with a test per case.
- **The builder** is a form in the left column. Its footer says what the run does not touch.

```
Build a check                    allow  (no reason)  evaluated in 1.20 ms
subject  [user v] [alice   ]
action   [read    ]              rbac   allow   role grants document:read   decided it
resource [document] [readme]     rebac  skipped RBAC already allowed, so ReBAC did not run.
namespace [/          ]          abac   no match  No policy matched.
> attributes and context
[ Run check ]                    RBAC allowed this check, and no deny policy matched.
Runs as a dry run: writes
nothing to the check log, fires
no hooks, and neither reads nor
fills the result cache.
```

---

## File Structure

**warden repository** (`/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`)

| File | Responsibility |
|---|---|
| `explain.go` (create) | `LaneState`, `Lane`, `Explanation`, `Engine.Explain` |
| `engine.go` (modify) | Extract `prepareCheck` and `runModels` from `Check`; record a swallowed expression error |
| `warden.go` (modify) | Unexported `exprErr` on `CheckResult`, beside `truncated` |
| `explain_test.go` (create) | Lane states, dry-run guarantees, equivalence with `Check` |
| `extension/contract/handlers_playground.go` (create) | DTOs, validation, `playground.explain` |
| `extension/contract/handlers_playground_test.go` (create) | Handler tests |
| `extension/contract/{contract.go,manifest.yaml,authz.go}` and the three guard tests (modify) | Registration and guards |

**forge-dashboard repository** (`/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`)

| File | Responsibility |
|---|---|
| `packages/fixture-server/warden-fixtures.mjs` (modify) | `playground.explain`: Go-identical validation, scenario table, fallback |
| `packages/plugin-warden/src/components/playground-lanes.tsx` (create) | Types, `LANE_ORDER`, `verdictSentence`, `LaneRow` |
| `packages/plugin-warden/src/pages/playground.tsx` (create) | Builder, result, prefill from a check log row |
| `packages/plugin-warden/src/pages/check-log-detail.tsx` (modify) | "Open in playground" |
| `packages/plugin-warden/src/index.tsx` (modify) | Routes and nav |

---

## Task 1: `Engine.Explain` in core

**Files:**
- Create: `explain.go`, `explain_test.go`
- Modify: `engine.go` (`Check`, lines 197-345; `evaluateReBAC`, lines 619-680), `warden.go` (`CheckResult`, lines 72-85)

**Interfaces:**
- Produces:

```go
// LaneState is what one authorization model did during an explained check.
type LaneState string

const (
	// LaneAllow: the model granted the request.
	LaneAllow LaneState = "allow"
	// LaneDeny: an explicit deny policy matched. ABAC only.
	LaneDeny LaneState = "deny"
	// LaneNoMatch: the model ran and granted nothing. Result carries its
	// reason when it gave one (RBAC and ReBAC always do; ABAC with no
	// matching policy has no result at all).
	LaneNoMatch LaneState = "noMatch"
	// LaneSkipped: ReBAC only. RBAC already allowed and EvaluateAllModels
	// is off, so the graph walk did not run.
	LaneSkipped LaneState = "skipped"
	// LaneDisabled: the model is turned off in Config.
	LaneDisabled LaneState = "disabled"
	// LaneError: the model's store read failed. Check returns an error here.
	LaneError LaneState = "error"
	// LaneNotEvaluated: an earlier model failed, so this one never ran, as
	// in Check.
	LaneNotEvaluated LaneState = "notEvaluated"
)

// Lane is one model's part in an explained check.
type Lane struct {
	State LaneState
	// Result is the model's own result: set for LaneAllow and LaneDeny, and
	// for LaneNoMatch when the model returned one.
	Result *CheckResult
	// Err is the store error, for LaneError.
	Err string
	// WalkTruncated is set on the ReBAC lane when the graph walk stopped at
	// MaxGraphDepth or MaxGraphVisited before it could answer.
	WalkTruncated bool
	// ExpressionErr is set on the ReBAC lane when the resource type's
	// permission expression failed and was treated as no match.
	ExpressionErr string
}

// Explanation is an explained check: the merged result Check would return,
// and each model's own part in it, from one evaluation.
type Explanation struct {
	// Result is what Check would have returned. Nil when a model failed.
	Result *CheckResult
	// Err is the error Check would have returned when a model failed.
	Err string
	RBAC, ReBAC, ABAC Lane
}

// Explain evaluates req exactly as Check does, as a dry run, and reports
// each model's part. It never reads or fills the cache, fires no hooks and
// writes no check log. A request Check would refuse before evaluating
// (a missing field, a missing tenant) returns that error; a model's store
// failure is reported in the Explanation instead.
func (e *Engine) Explain(ctx context.Context, req *CheckRequest, opts ...CallOption) (*Explanation, error)
```

- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

`explain_test.go`, package `warden`, using `store/memory` and the root package's existing seed helpers where they fit (read `dryrun_test.go` and `engine_test.go` first):

1. **States**, one test each:
   - an RBAC allow gives RBAC `allow` with the role's `MatchedBy`, ReBAC `skipped`, and ABAC `noMatch` with a nil `Result`;
   - the same with `EvaluateAllModels` on gives ReBAC `noMatch` with its `deny_relation` reason;
   - an explicit deny policy over an RBAC allow gives ABAC `deny`, `Result.Decision` `deny_explicit`, and RBAC still `allow`;
   - a subject with no roles gives RBAC `noMatch` whose `Result.Reason` is the engine's `deny_no_roles` sentence;
   - `EnableReBAC` off gives ReBAC `disabled`;
   - a store whose `ListRolePermissionsForRoles` fails (wrap `memory.Store` in a small failing decorator) gives RBAC `error` with the message, ReBAC and ABAC `notEvaluated`, `Result` nil and `Err` equal to the error `Check` returns for the same request;
   - a graph walker that returns `ErrGraphBudgetExceeded` (install one with `WithGraphWalker`) gives ReBAC `noMatch` with `WalkTruncated` true;
   - an `ExpressionEvaluator` that errors (install one with `WithExpressionEvaluator`) gives ReBAC `ExpressionErr` equal to its message.
2. **Dry-run guarantees**:
   - with a warm cache (a prior real `Check`), `Explain` still evaluates, which you can show by changing the store between the two calls and seeing the new answer;
   - after `Explain`, the check log writer received nothing (use a recording store as `checklog_writer_test.go` does, and `Stop` the engine to flush);
   - a registered plugin saw no `BeforeCheck` or `AfterCheck` call;
   - the cache holds no entry for the request afterwards.
3. **Equivalence**: for a table of at least eight seeds and configs (each of the state cases above that produces a result, plus `RequireTenant` off with no tenant, plus a namespaced check whose policy sits at an ancestor), `Explain(ctx, req, opts...).Result` equals `Check(ctx, req, append(opts, WithCallDryRun())...)` in every field except `EvalTimeNs`. When `Check` errors, `Explain.Err` equals that error's message.
4. **Refusals**: `Explain` with an empty subject id, action or resource type returns the same error `Check` returns, and a nil `Explanation`.

- [ ] **Step 2: Run to see them fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/warden && go test . -run 'Explain' -v`
Expected: FAIL to compile.

- [ ] **Step 3: Record the swallowed expression error**

In `warden.go`, beside `truncated`:

```go
	// exprErr is set by the ReBAC evaluator when the resource type's
	// permission expression failed and was treated as no match. Explain
	// reports it; Check keeps its behaviour. Unexported, so it never
	// reaches the wire or the cache.
	exprErr string
```

In `evaluateReBAC`, keep the existing `Warn` and remember the message in a local, then set `exprErr` on every result the function returns after that point (the allow results from the graph walk and the final `deny_relation`).

- [ ] **Step 4: Extract the pipeline**

In `engine.go`, split `Check` into three pieces without changing what it does:

```go
// prepareCheck validates req and resolves its scope and call options, as
// the first part of Check. Explain shares it.
func (e *Engine) prepareCheck(ctx context.Context, req *CheckRequest, opts []CallOption) (tenantScope, callOptions, error)

// modelRun is one pass through the models, in Check's order.
type modelRun struct {
	rbac, rebac, abac *CheckResult
	rbacRoles         []*role.Role
	// failed names the model whose store read failed ("rbac", "rebac",
	// "abac"); err is the wrapped error Check returns. Empty on success.
	failed string
	err    error
}

// runModels runs RBAC, ReBAC and ABAC exactly as Check always has: ReBAC
// only when RBAC did not allow or EvaluateAllModels is on, ABAC whenever
// enabled, and nothing after a failure.
func (e *Engine) runModels(ctx context.Context, scope tenantScope, req *CheckRequest) modelRun
```

`prepareCheck` holds the current lines 201-233 (validation, scope, call options, `ErrTenantRequired`, `scope.namespaces`). `runModels` holds the current steps 2 to 4 and wraps errors exactly as today (`"warden rbac: %w"`, `"warden rebac: %w"`, `"warden abac: %w"`). `Check` becomes: `prepareCheck`; the debug log and `BeforeCheck` hook; the cache step; `runModels`; on `run.err`, `return e.failCheck(ctx, scope, req, run.err, co.dryRun)`; then merge, the truncation note, and steps 6 to 8 unchanged. Move code; do not rewrite it.

- [ ] **Step 5: Implement `Explain`**

`explain.go`:

```go
func (e *Engine) Explain(ctx context.Context, req *CheckRequest, opts ...CallOption) (*Explanation, error) {
	start := time.Now()
	scope, _, err := e.prepareCheck(ctx, req, opts)
	if err != nil {
		return nil, err
	}
	run := e.runModels(ctx, scope, req)

	out := &Explanation{
		RBAC:  e.lane(e.config.rbacEnabled(), "rbac", run.failed, run.rbac),
		ReBAC: e.rebacLane(run),
		ABAC:  e.lane(e.config.abacEnabled(), "abac", run.failed, run.abac),
	}
	if run.err != nil {
		out.Err = run.err.Error()
		return out, nil
	}
	result := e.mergeDecisions(req, run.rbac, run.rebac, run.abac)
	if !result.Allowed && run.rebac != nil && run.rebac.truncated {
		result.Reason = truncatedWalkNote + joinReason(result.Reason)
	}
	result.EvalTimeNs = time.Since(start).Nanoseconds()
	out.Result = result
	return out, nil
}
```

`lane` maps one model to its state:
- `disabled` when the model is off;
- `error` (with `Err` from `run.err`) when `failed` names it;
- `notEvaluated` when an earlier model failed, in the order rbac, rebac, abac;
- `allow` when the result allowed;
- `deny` when the result is `deny_explicit`;
- otherwise `noMatch`, with the result, which may be nil.

`rebacLane` adds two things:
- `skipped` when ReBAC is enabled, nothing failed, and `run.rebac` is nil;
- `WalkTruncated` and `ExpressionErr` read from `run.rebac.truncated` and `run.rebac.exprErr`.

`mergeDecisions` copies the winning model's result (`out := *r`), so `Explanation.Result` never aliases a lane's `Result`. Keep it that way.

- [ ] **Step 6: Run everything**

Run: `go test . -run 'Explain' -race -v`, then `go build ./... && go test ./...`.
Expected: PASS, and every pre-existing test passes unmodified.

Then mutate twice, restoring from your backup each time:
- make `runModels` run ReBAC even after an RBAC allow; an existing `Check` test or the equivalence test must fail;
- drop the truncation note from `Explain`; the equivalence test must fail.

- [ ] **Step 7: Commit**

```bash
git add explain.go explain_test.go
git commit -m "feat(engine): explain a check lane by lane from the same evaluation" -- explain.go explain_test.go engine.go warden.go
```

---

## Task 2: `playground.explain`

**Files:**
- Create: `extension/contract/handlers_playground.go`, `extension/contract/handlers_playground_test.go`
- Modify: `extension/contract/contract.go`, `manifest.yaml`, `authz.go`, `handlers_tenant_test.go`, `manifest_test.go`, `authz_test.go`

**Interfaces:**
- Consumes: `warden.Engine.Explain`, `warden.Lane`, `warden.LaneState` (Task 1); `validSubjectKinds` (`handlers_assignments.go:110`); `validateNamespace` (`handlers_roles.go:273`); `CheckLogMatch` (`handlers_checklogs.go`).
- Produces (the wire contract Tasks 3 to 5 mirror):

```go
type PlaygroundExplainInput struct {
	SubjectKind  string `json:"subjectKind"`
	SubjectID    string `json:"subjectId"`
	Action       string `json:"action"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId,omitempty"`
	// NamespacePath is where the check runs. "" is the tenant root. Always
	// explicit: a playground check is at a namespace, never "any".
	NamespacePath      string         `json:"namespacePath"`
	Context            map[string]any `json:"context,omitempty"`
	SubjectAttributes  map[string]any `json:"subjectAttributes,omitempty"`
	ResourceAttributes map[string]any `json:"resourceAttributes,omitempty"`
}

type PlaygroundLane struct {
	// Model is "rbac", "rebac" or "abac".
	Model string `json:"model"`
	// State is one of warden.LaneState's values.
	State           string          `json:"state"`
	Decision        string          `json:"decision,omitempty"`
	Reason          string          `json:"reason,omitempty"`
	MatchedBy       []CheckLogMatch `json:"matchedBy"`
	WalkTruncated   bool            `json:"walkTruncated,omitempty"`
	ExpressionError string          `json:"expressionError,omitempty"`
	Error           string          `json:"error,omitempty"`
}

type PlaygroundExplainResponse struct {
	// Decision is "error" when a model failed, with Error set; otherwise
	// the merged decision.
	Decision    string          `json:"decision"`
	Allowed     bool            `json:"allowed"`
	Reason      string          `json:"reason,omitempty"`
	Error       string          `json:"error,omitempty"`
	MatchedBy   []CheckLogMatch `json:"matchedBy"`
	Obligations []string        `json:"obligations"`
	EvalTimeNs  int64           `json:"evalTimeNs"`
	// Lanes is always three, in pipeline order: rbac, rebac, abac.
	Lanes []PlaygroundLane `json:"lanes"`
}
```

Arrays are never `null`.

- [ ] **Step 1: Write the failing tests**

`handlers_playground_test.go`, seeding through `deps.Engine.Store()`:

1. **Refusals**, each `BAD_REQUEST` naming the field, and none reaching the engine:
   - `subjectKind` outside the four kinds, including `""`;
   - empty `subjectId`;
   - empty `action`;
   - empty `resourceType`;
   - an invalid `namespacePath` (for example `"a//b"`), whose message comes from `validateNamespace`.
2. **Tenant**:
   - a principal for `t1` explaining a check on a subject that only `t2` grants gets `noMatch` on RBAC;
   - the input type has no tenant field, which a compile-level test can't show, so assert it by marshalling a zero input and checking there is no `tenant` key;
   - a `Deps` with no resolvable tenant refuses as the other handlers do.
3. **Projection**: an RBAC allow with ReBAC skipped and ABAC `noMatch` projects to three lanes in order, with `matchedBy` `[]` on the lanes that have none, the role's `ruleId` on RBAC, and `obligations` `[]`. An explicit deny over an RBAC allow projects ABAC `deny` with the policy's `ruleId`, verdict `deny_explicit`, and obligations from the policy.
4. **Namespace**: a policy at `eng` denies a check at `eng/platform` and does not deny the same check at `""`.
5. **Attributes and context reach the engine**: a deny policy conditioned on `subject.mfa eq false` denies when `subjectAttributes` is `{"mfa": false}` and does not when it is absent. A `context.ip` condition likewise.
6. **No trace**: after an explain, the engine's store holds no check log row (list with `CountCheckLogs` after stopping the engine's writer, or build the test engine with check logging on and a recording store).
7. **A failed model**: a failing store decorator gives decision `"error"`, `error` set, the failed lane `error`, and later lanes `notEvaluated`.

- [ ] **Step 2: Run to see them fail**

Run: `go test ./extension/contract/ -run 'Playground' -v`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

`playgroundExplainHandler(deps)`:
1. `requireEngine`, then `tenantFrom`.
2. Validate, in the order of test 1:
   - `subjectKind` must be in `validSubjectKinds`, with message `subjectKind must be one of user, api_key, service, service_acct`;
   - `subjectId is required`;
   - `action is required`;
   - `resourceType is required`;
   - then `validateNamespace(in.NamespacePath)`.
3. Build `warden.CheckRequest{Subject: {Kind, ID, Attributes}, Action: {Name}, Resource: {Type, ID, Attributes}, Context}`, leaving `TenantID` and `NamespacePath` empty.
4. Call `deps.Engine.Explain(ctx, req, warden.WithCallTenantID(tenantID), warden.WithCallNamespacePath(in.NamespacePath), warden.WithCallDryRun())`. `Explain` is always a dry run; pass the option anyway, so the intent reads as what it does.
5. Map a returned error through `mapWardenError`.
6. Project the lanes and the merged result into the DTO.

- [ ] **Step 4: Register and guard**

- `contract.go`: `dispatcher.RegisterQuery(d, contributorName, "playground.explain", 1, playgroundExplainHandler(deps))`, with the file's error-wrapping shape.
- `manifest.yaml`: the intent is a query (it writes nothing):

```yaml
  # A dry run: no check log row, no hooks, no cache. It writes nothing, so it
  # is a query, and a viewer who may run checks may run it.
  - { name: playground.explain, kind: query, version: 1, requires: { warden: warden.engine }, capability: read }
```

  and under `queries:`

```yaml
  # Every run must evaluate against the store as it is now.
  playgroundExplain:
    intent: playground.explain
    cache: { staleTime: 0s }
```

- `authz.go` `intentPolicies`: `{"check", "warden:authz"}`. Mirror it in `authz_test.go`.
- `manifest_test.go`: add `wantKind` as `IntentKindQuery`, and a test asserting the query and its `0s` stale time.
- `handlers_tenant_test.go`: add the handler to `tenantEnforcedHandlers`.

- [ ] **Step 5: Run and mutate**

Run: `go test ./extension/contract/ -v -run 'Playground|Manifest|Authz|Tenant'`, then `go test ./...`.
Expected: PASS.

Mutate twice, restoring from your backup each time:
- drop `WithCallTenantID`; test 2 must fail;
- drop the `subjectId` check; test 1 must fail.

- [ ] **Step 6: Commit**

```bash
git add extension/contract/handlers_playground.go extension/contract/handlers_playground_test.go
git commit -m "feat(contract): explain one check from the dashboard" -- extension/contract/handlers_playground.go extension/contract/handlers_playground_test.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/authz.go extension/contract/handlers_tenant_test.go extension/contract/manifest_test.go extension/contract/authz_test.go
```

---

## Task 3: Fixture

**Files:**
- Modify: `packages/fixture-server/warden-fixtures.mjs`

**Interfaces:**
- Consumes: Task 2's wire contract, exactly, including every refusal message.
- Produces: `playground.explain`, answering from a scenario table.

- [ ] **Step 1: The handler**

Validate exactly as Task 2 does, in the same order and with the same messages. Reuse the file's namespace validation if it mirrors `validateNamespace`; otherwise port it. Then answer from a scenario table keyed on `subjectKind`, `subjectId`, `action`, `resourceType` and `namespacePath`. Each scenario is a complete response built from the fixture's own roles, policies and relations, so every `ruleId` exists. The table holds at least:

| scenario | lanes | verdict |
|---|---|---|
| RBAC allow | rbac `allow` (a role that grants it), rebac `skipped`, abac `noMatch` | `allow` |
| explicit deny over an RBAC allow, with an obligation | rbac `allow`, rebac `skipped`, abac `deny` (a fixture deny policy) | `deny_explicit`, obligations set |
| ReBAC transitive allow | rbac `noMatch` (`deny_no_perms` reason), rebac `allow` with `transitive: ...`, abac `noMatch` | `allow` |
| truncated walk | rbac `noMatch`, rebac `noMatch` with `walkTruncated`, abac `noMatch` | `deny_no_perms` with the truncation note prefixed to the reason |
| no roles | rbac `noMatch` (`deny_no_roles`), rebac `noMatch` (`deny_relation`), abac `noMatch` | `deny_no_roles` |
| ABAC allow only | rbac `noMatch`, rebac `noMatch`, abac `allow` (a fixture allow policy) | `allow` |
| a failed model | rbac `error` ("store unavailable"), rebac and abac `notEvaluated` | `error` |
| expression failed | rbac `noMatch`, rebac `noMatch` with `expressionError`, abac `noMatch` | `deny_no_perms` |

Every reason string is the engine's exact format, as the check log seed uses. The truncation note is the engine's `truncatedWalkNote`, copied exactly. A request matching no scenario gets the "no roles" shape for that request's own subject, action and resource. Record the table in a comment above the handler, naming the request that reaches each row, so a person clicking through can find them.

- [ ] **Step 2: Check by hand**

Start the fixture server as `packages/fixture-server/package.json` describes, on a free port, and stop it by PID when done. Send each refusal and each scenario, and confirm every refusal message matches the Go handler's. Record the table in your report.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(fixture): explain warden checks from a scenario table" -- packages/fixture-server/warden-fixtures.mjs
```

---

## Task 4: The playground page

**Files:**
- Create: `packages/plugin-warden/src/components/playground-lanes.tsx`
- Create: `packages/plugin-warden/src/pages/playground.tsx`
- Create: `packages/plugin-warden/test/playground.test.tsx`, `packages/plugin-warden/test/playground-lanes.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`, `packages/plugin-warden/test/plugin.test.tsx`

**Interfaces:**
- Consumes: `playground.explain` (Task 2); `decisionVariant`, `formatEvalTime`, `CheckMatch` (`components/check-log.tsx`); `namespaces.list` for the namespace suggestions.
- Produces, in `components/playground-lanes.tsx`:

```ts
export type LaneState = "allow" | "deny" | "noMatch" | "skipped" | "disabled" | "error" | "notEvaluated"
export interface PlaygroundLane { model: "rbac" | "rebac" | "abac"; state: LaneState; decision?: string; reason?: string; matchedBy: CheckMatch[]; walkTruncated?: boolean; expressionError?: string; error?: string }
export interface PlaygroundResult { decision: string; allowed: boolean; reason?: string; error?: string; matchedBy: CheckMatch[]; obligations: string[]; evalTimeNs: number; lanes: PlaygroundLane[] }
export interface PlaygroundInput { subjectKind: string; subjectId: string; action: string; resourceType: string; resourceId?: string; namespacePath: string; context?: Record<string, unknown>; subjectAttributes?: Record<string, unknown>; resourceAttributes?: Record<string, unknown> }
/** The lane whose result the engine's merge chose, or null. */
export function decidingLane(result: PlaygroundResult): PlaygroundLane["model"] | null
/** Why this beat that, in one or two sentences. */
export function verdictSentence(result: PlaygroundResult): string
export function LaneRow(props: { lane: PlaygroundLane; deciding: boolean }): JSX.Element
```

- [ ] **Step 1: Write the failing unit tests**

`test/playground-lanes.test.tsx`. `decidingLane` mirrors `mergeDecisions`:
- `deny_explicit` gives `abac`;
- an allow gives the first `allow` lane in order rbac, rebac, abac;
- any other denial gives the first lane in that order whose `reason` is non-empty;
- `error` gives null;
- a denial with no reason on any lane gives null (`deny_default`).

Assert each case.

`verdictSentence`, exact text per case:

| case | sentence |
|---|---|
| `error` | "The {MODEL} model failed, so no decision was returned." (MODEL is the lane in state `error`, uppercased: RBAC, ReBAC, ABAC) |
| `deny_explicit`, and RBAC or ReBAC allowed | "An explicit deny overrides the {MODEL} allow." (the first allowing lane) |
| `deny_explicit`, nothing else allowed | "A deny policy matched." |
| `allow`, ABAC lane not `disabled` | "{MODEL} allowed this check, and no deny policy matched." |
| `allow`, ABAC lane `disabled` | "{MODEL} allowed this check. Policy evaluation is off, so no deny policy could override it." |
| any other denial | "No model allowed this check." |

When the ReBAC lane has `walkTruncated`, append "The relation walk stopped at its limit, so a relation may exist beyond it." When it has `expressionError`, append "The resource type's permission expression failed, so it was treated as no match." Test every row and both appendices.

`LaneRow` covers every state:

| state | text | also |
|---|---|---|
| `allow` | "allow" | its match: a `PluginLink` to `/roles/<ruleId>` for rbac, `/policies/<ruleId>` for abac, plain text for rebac |
| `deny` | "deny" | destructive text, and the policy link |
| `noMatch` | "no match" | the reason when present; for ABAC with none, "No policy matched." |
| `skipped` | "skipped" | "RBAC already allowed, so ReBAC did not run." |
| `disabled` | "disabled" | "Turned off in warden's config." |
| `error` | "error" | the error in destructive text |
| `notEvaluated` | "not evaluated" | "An earlier model failed, so this one did not run." |

A deciding lane shows "decided it". Test each row.

- [ ] **Step 2: Write the failing page tests**

`test/playground.test.tsx`:
1. **Validation before sending**:
   - Run is disabled until subject id, action and resource type are filled.
   - Invalid JSON in any of the three JSON fields shows "This is not valid JSON." under that field and sends nothing.
   - A JSON value that is not an object shows "This must be a JSON object." and sends nothing.
2. **The request**: filling every field sends exactly Task 2's keys. Blank optional fields and empty JSON fields send no key, which you assert with `Object.keys`. `namespacePath` is always sent, and `""` means the root.
3. **The result**:
   - The decision badge (the check log variants), the reason, and "evaluated in {formatEvalTime}".
   - Three `LaneRow`s in order, with "decided it" on `decidingLane`, then `verdictSentence`.
   - When `obligations` is non-empty, "would emit" followed by each obligation in mono.
4. **A refusal** (a thrown `ContractError` `BAD_REQUEST`) renders inside the builder, and the previous result is cleared.
5. **The footer** reads "Runs as a dry run: writes nothing to the check log, fires no hooks, and neither reads nor fills the result cache."
6. **Namespace suggestions** come from `namespaces.list` as a `datalist`, and the input accepts any path. When `namespaces.list` fails, the input still works.
7. **Re-run**: pressing Run again with the same input sends a second request, because `staleTime` is 0.

- [ ] **Step 3: Run to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-warden test -- playground`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

`WardenPlaygroundPage` in `pages/playground.tsx`. The builder is a form in the left column, the result in the right, stacked below 768px.
- Subject kind is a `NativeSelect` of the four kinds.
- The text inputs each carry a visible `Label`.
- Namespace is an `Input` with a `datalist` built from `namespaces.list`, whose root shows as `/` and is sent as `""`.
- A disclosure labelled "attributes and context" holds three `textarea`s: subject attributes, resource attributes and context, each JSON.

Run the query with `useQuery("playground.explain", input, { enabled })` if the plugin's hook supports manual triggering. Otherwise use `useCommand`-style imperative execution, whichever the plugin package offers for a read that runs on demand; read `@forge-go/dashboard-plugin`'s exports first, and say in your report which you used and why.

- [ ] **Step 5: Route and nav**

In `index.tsx`:
- Route `{ path: "/playground", element: WardenPlaygroundPage }`.
- Nav `{ label: "Playground", to: "/playground", priority: 10, icon: <FlaskConicalIcon />, group: "Operations" }`, importing the icon from `@forge-go/dashboard-kit/icons` as the other entries do. If that export lacks it, pick one it has and say which.

Extend `test/plugin.test.tsx`.

- [ ] **Step 6: Verify**

Run the package's `test`, `typecheck` and `lint`. Mutate twice, restoring from your backup each time:
- make `decidingLane` pick the last allow; its test must fail;
- send `namespacePath` only when non-empty; test 2 must fail.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-warden/src/components/playground-lanes.tsx packages/plugin-warden/src/pages/playground.tsx packages/plugin-warden/test/playground.test.tsx packages/plugin-warden/test/playground-lanes.test.tsx
git commit -m "feat(warden): add the playground" -- packages/plugin-warden/src/components/playground-lanes.tsx packages/plugin-warden/src/pages/playground.tsx packages/plugin-warden/test/playground.test.tsx packages/plugin-warden/test/playground-lanes.test.tsx packages/plugin-warden/src/index.tsx packages/plugin-warden/test/plugin.test.tsx
```

---

## Task 5: Open a check log row in the playground

**Files:**
- Modify: `packages/plugin-warden/src/pages/playground.tsx`, `packages/plugin-warden/src/pages/check-log-detail.tsx`, `packages/plugin-warden/src/index.tsx`
- Modify: `packages/plugin-warden/test/playground.test.tsx`, `packages/plugin-warden/test/check-log-detail.test.tsx`, `packages/plugin-warden/test/plugin.test.tsx`

**Interfaces:**
- Consumes: `checkLogs.detail` (plan 3b), `CheckDetail`.
- Produces: route `/playground/check/:checkId`. A plugin cannot read a query string, so the prefill travels as a route param, as `/policies/:id/edit` does.

- [ ] **Step 1: Write the failing tests**

1. **Prefill**: at `/playground/check/<id>`, the page reads `checkLogs.detail` and fills subject kind, subject id, action, resource type, resource id and namespace, with the root shown as `/`. It does **not** run automatically. The operator presses Run.
2. **The missing parts**: a prefilled page shows "Prefilled from a check logged at {Timestamp}. The check log does not record context or attributes, so add any the original check carried." above the form.
3. **Not found**: an unknown id renders the `QueryBoundary` error card with the empty builder still usable below it.
4. **The link**: the check detail page shows an "Open in playground" `PluginLink` to `/playground/check/<id>` on every row except `error` rows. Assert it is absent on an `error` row.

- [ ] **Step 2: Implement**

One component serves both routes. `params.checkId` present means prefill once, when the detail arrives, without overwriting fields the operator has since edited. In `index.tsx`, add `{ path: "/playground/check/:checkId", element: WardenPlaygroundPage }` with the "No nav entry" comment the other parameterised routes carry.

- [ ] **Step 3: Verify**

Run the package's `test`, `typecheck` and `lint`. Mutate once, restoring from your backup: make the prefilled page run on load; test 1 must fail.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(warden): open any check log row in the playground" -- packages/plugin-warden/src/pages/playground.tsx packages/plugin-warden/src/pages/check-log-detail.tsx packages/plugin-warden/src/index.tsx packages/plugin-warden/test/playground.test.tsx packages/plugin-warden/test/check-log-detail.test.tsx packages/plugin-warden/test/plugin.test.tsx
```

---

## Carried forward

- **To plan 4b:**
  - `subjects.detail` and `/subjects/:kind/:id`;
  - `playground.batchCheck`;
  - subject links from the check log, the assignments list and the playground's subject field;
  - a namespace filter that can pick leaf namespaces where checks run.
- **Warden follow-ups, not this plan:**
  - ABAC skips an allow policy whose condition throws, with only a log line, so `Explain` cannot yet name it. Surfacing it means threading a skipped list out of `Evaluator.Evaluate`, which is a public interface.
  - ABAC reports one policy per lane, not every policy that matched.
