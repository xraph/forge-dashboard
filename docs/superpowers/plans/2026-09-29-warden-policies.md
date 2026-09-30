# Warden policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give warden's ABAC policies a dashboard surface that reads each rule's logic correctly, and refuses on write the policy shapes that store fine but cannot behave the way they read.

**Architecture:** A store conformance case proves a fully populated policy round-trips on all four backends before anything is built on it. A policy analysis in `warden/extension/contract` classifies every condition whose outcome is fixed before any check runs, and it is tested against warden's real evaluator rather than against a reading of it. Seven intents sit on that analysis. Three React pages render the rule block the spec designs: a list, a read view, and an editor that is the same block edited in place.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0` (dashboard contract, dispatcher), testcontainers (postgres:16-alpine, mongo:7), React 19.2, Vitest 5, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, slice 9. The spec section "The policy rule surface" is the design authority for Tasks 6 to 8.

**Predecessors:** plans `2026-09-23-warden-spine.md`, `2026-09-23-warden-roles-permissions.md` and `2026-09-29-warden-assignments-relations-resourcetypes.md`. This plan assumes all three: the contract package and its three self-checking guards, the paging envelope, `tenantFrom`, `withActor`, `emitAudit`, the plugin package, the namespace filter, and `warden-fixtures.mjs`.

**Scope note:** the spec's slice 9 (policies) and slice 10 (check log) were planned together as "plan 3". They are split, as plan 2 was. This is plan 3a. The check log is plan 3b, which waits on two decisions recorded under "Carried forward".

## Global Constraints

- Contributor name is exactly `warden`. The plugin's `extension` field must match it.
- Contract DTOs are camelCase. Never return a warden domain struct (snake_case) on the wire.
- Every handler resolves its tenant with `tenantFrom(p, deps)`, never from the request context. An empty tenant id in a store `ListFilter` matches every tenant's rows rather than none.
- Every intent that pages a stored collection embeds `PageRequest` and returns `PageMeta` beside `items`. No cursors.
- Namespace filter fields are `*string`: `nil` means every namespace, `""` means the tenant root, a path means that namespace.
- Optional update fields are pointers, including `*[]T` for lists that can be emptied: nil means leave alone, a pointer to an empty slice means remove them all.
- Every new handler is added to **three** self-checking guards, all sized against registrations parsed from `contract.go`'s source: `handlers_tenant_test.go`'s table, `manifest_test.go`'s `wantKind` map, and `authz.go`'s `intentPolicies` with its mirror `wantPolicies` in `authz_test.go`. An intent absent from `intentPolicies` is **denied** by the engine delegate. Extend them; never loosen an assertion.
- Every manifest intent line carries `requires: { warden: warden.engine }`. Every command declares `invalidates`.
- `namespaces.list` scans six collections, policies among them. Every command that creates or deletes a policy invalidates `namespaces.list`.
- Policy authz resource is `warden:policy`: `read` for queries, `manage` for commands, matching `api/policy_handler.go`.
- Policy writes emit the typed hook (`EmitPolicyCreated`, `EmitPolicyUpdated`, `EmitPolicyDeleted`) and `emitAudit`, after `withActor`. The audit event is what drives tenant cache invalidation.
- **Every sentence a page shows about access must be true for every case it can appear in.** Verify behaviour against the engine code (`evaluator.go`, `engine.go`), never against a comment or a list filter. A stale comment caused plan 2b's worst defect.
- Identifier values carry `font-mono text-xs`. The column an operator reads carries `font-medium`. Captions count the server's `total`. Empty states say which kind of empty. The tenant root renders as `/`. Errors render inside the dialog or form that can fail. Every `ConfirmDialog` gets `pending`. `execute()` resolving `undefined` is the success check. `reset()` runs when a dialog opens. Filter changes reset paging.
- Tests: create and update tests read the stored row back and assert every field, and assert omitted fields are absent with `Object.keys` or its Go equivalent. Every exposed list filter and the paging are asserted. Every dialog's `pending` state is tested. React tests use `fireEvent`, `toBeTruthy()` and `.textContent`; no `user-event`, no `jest-dom`.
- No em dashes anywhere, including comments, JSX text and commit messages. No `Co-Authored-By` trailers and no Claude or Anthropic attribution.
- Both trees are shared with other live sessions holding over a hundred uncommitted files. Commit by explicit path; stage new files with `git add <path>` first; never `git add -A`, `git commit -a` or `--amend`; verify by SHA, never HEAD. Restore a mutated file only from its own backup or `git checkout -- <exact path>`; never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.

## What the engine actually does

Verified against `warden/evaluator.go` and `warden/engine.go` for this plan. Tasks rely on every line.

- Policies at namespace N apply to checks in N and every descendant: `evaluateABAC` loads `ListActivePolicies(..., scope.namespaces)` with the ancestor chain (`engine.go:688`).
- ABAC runs even after RBAC or ReBAC has allowed, so a deny can override them, but **only when ABAC is enabled** (`engine.go:278-286`). With ABAC off, no policy is evaluated at all.
- An explicit deny from ABAC beats every allow from every model. Any allow from any model grants (`mergeDecisions`, `engine.go:696`).
- An empty `Subjects`, `Actions` or `Resources` list matches everything (`evaluator.go:199,219,231`). Lists are OR-ed. Conditions are AND-ed and stop at the first false or first error.
- Inside one subject matcher, `kind`, `id` and `role` are AND-ed, and **an empty matcher `{}` matches every subject**, so a list containing one is unrestricted.
- `"*"` in `Actions` or `Resources` matches everything.
- Role matchers compare against roles RBAC resolved. With RBAC off, `rbacRoles` is empty and every role matcher is dead (`engine.go:256-264`).
- Priority sorts descending, ties by name, and decides which policy is **cited**, not which effect wins.
- A policy is skipped unless `IsActive` and inside `NotBefore`/`NotAfter` (`EffectiveAt`).
- Anything whose effect is not exactly `"allow"` is a deny.
- **Only two conditions throw at evaluation: an unknown operator, and a `regex` whose pattern does not compile.** A throwing condition makes a deny apply as if met (fail closed) and makes an allow skip. `ipInCIDR` and `timeCompare` never return an error: a bad CIDR is skipped and an unparseable time is false.
- `resolveField` resolves only `subject.<x>`, `resource.<x>`, `action.name` and `context.<x>`. Anything else, including bare `action` and `action.<x>` for any other `x`, resolves to `nil`. With `nil`, `neq`, `not_in` and `not_exists` are true, and most other operators are false.
- `in` and `not_in` need a list (`[]string` or `[]any`); for anything else `in` is false and `not_in` is true.
- Numeric comparisons (`gt`, `lt`, `gte`, `lte`) against a non-numeric value are false, never an error.
- **Nothing validates a policy on write.** `policy.Validate` and `policy.ValidateCondition` have no non-test caller; the REST create at `api/policy_handler.go:77-126` stores whatever it is sent. And `ValidateCondition` accepts bare `action` and `action.<x>`, which the evaluator can never resolve.

## Deviations from the spec

The spec is the binding authority. Each deviation below corrects a fact in it or adds a case it did not see; the spec is corrected in the same commit as this plan.

1. **17 operators, not 18.** `policy/policy.go` defines 17. The editor carries exactly those.
2. **Five states, not three.** The spec names inactive, outside its window, and fails closed. The evaluator adds two more that look identical to an active policy on a table: an allow with a throwing condition **never applies**, and any policy whose first certain-outcome condition is always false **never applies**. And "outside its window" is really two facts with different fixes, not yet in effect and expired, plus a window whose end precedes its start, which is never in effect.
3. **"Fails closed" is narrower than the spec says.** Only an unknown operator or an uncompilable regex throws. A bad CIDR or an unparseable time makes the condition silently false, which makes the policy never apply, the opposite direction.
4. **The window row is labelled `in effect`,** not `active`, so the schedule cannot be confused with the on/off switch.
5. **Create always stores the policy inactive.** A new policy with no matchers matches every check in its namespace and below. Storing it active would make an empty allow grant everything, or an empty deny lock everyone out, the moment it is saved. Activation is an explicit `policies.setActive`, whose confirm dialog says what activating will do. REST honours `isActive` on create; the contract deliberately does not.

## Review Focus

1. **An unrestricted matcher rendered as a restriction.** An empty list, a list containing an empty subject matcher `{}`, or `"*"` all match everything. A page that renders an empty list blank, or `{}` as an empty chip, tells an operator "nobody" when the truth is "everybody". Tests in Tasks 3 and 7.
2. **A condition that is silently always true or always false.** `not_in` given a string instead of a list is always true, so `context.ip not_in "10.0.0.0/8"` on a deny denies everyone. `gt` against a non-number is always false. `neq` on the unresolvable field `action.verb` is always true. Refused on write in Task 2, flagged per row on stored policies in Tasks 3 and 7.
3. **A broken policy rendered with the wrong weight.** A deny that fails closed is stronger than it looks and must not be dimmed; an allow that never applies is weaker than it looks and must not look active. Task 2 derives both, order-aware; Task 7 renders them.
4. **A numeric condition value that changes meaning after a round-trip.** An integer beyond 2^53 does not survive float64 through postgres and sqlite, and `eq` compares through `fmt.Sprint`, so `1234567890123456789` stored may read back as `1.2345678901234568e+18` and stop matching. Refused on write in Task 2.
5. **A policy saved empty and active.** Create stores inactive (Task 4); activating an unrestricted or fail-closed policy confirms what it will do (Task 7).

## Design (from the frontend-design pass)

The kit's visual language is fixed. This is information design inside it.

- **Visual weight tracks real effect.** Inactive, not yet in effect, expired, never in effect, and never-applies policies render the rule block dimmed. A fail-closed deny is never dimmed; it gets a callout naming the condition that throws.
- **Colour means "this overrides".** On the detail page only the Deny heading takes colour (the destructive token), because an explicit deny beats every other model. Allow stays in the foreground colour.
- **The logic in words.** OR chips read across with a muted `or` between them. AND conditions stack, the first row labelled `when`, each continuation row labelled `and`. No middle-dot joins.
- **Labels** are a lowercase, aligned column: `subject`, `action`, `resource`, `when` / `and`, `in effect`, `emits`. Ranges read `from 1 Jun 2026 until 30 Jun 2026`. No arrows, no all-caps eyebrows.
- **Unrestricted** reads `anyone`, `any action`, `any resource` in muted plain text, never a chip and never monospace, so it cannot be mistaken for a value.

```
Deny                                             Edit
subject    role: contractor  or  user: usr_2f8a
action     document:delete
resource   document:*
when       context.ip   not in   10.0.0.0/8
      and  subject.mfa  exists
in effect  from 1 Jun 2026 until 30 Jun 2026
emits      notify-security
```

---

## File Structure

**warden repository** (`/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`)

| File | Responsibility |
|---|---|
| `store/contract/policy_roundtrip.go` (create) | `RunPolicyRoundTripContract`: a populated policy survives create, update and all three read paths |
| `store/memory/policy_roundtrip_test.go`, `store/sqlite/policy_roundtrip_test.go` (create) | Wire the contract into the always-run suites |
| `store/postgres/policy_roundtrip_integration_test.go`, `store/mongo/policy_roundtrip_integration_test.go` (create) | Wire it into the integration suites |
| `extension/contract/policy_analysis.go` (create) | Condition problems, policy state, fail-closed and never-applies, unrestricted matchers |
| `extension/contract/policy_validate.go` (create) | Write-time validation and `policies.validate` |
| `extension/contract/handlers_policies.go` (create) | DTOs, projection, and the six CRUD intents |
| `extension/contract/{contract.go,manifest.yaml,authz.go}` and the three guard tests (modify) | Registration and guards |

**forge-dashboard repository** (`/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`)

| File | Responsibility |
|---|---|
| `packages/fixture-server/warden-fixtures.mjs` (modify) | Seven handlers, the analysis and validation mirrored, seed covering every state |
| `packages/plugin-warden/src/components/policy-rule.tsx` (create) | The rule block, read mode: shared by the detail page and the editor |
| `packages/plugin-warden/src/pages/policies.tsx` (create) | List |
| `packages/plugin-warden/src/pages/policy-detail.tsx` (create) | Read view, activation, delete |
| `packages/plugin-warden/src/components/policy-editor.tsx` (create) | The rule block, edit mode |
| `packages/plugin-warden/src/index.tsx` (modify) | Routes and nav |

---

## Task 1: Prove a populated policy round-trips on all four backends

The spec requires this before any policy surface is built: every existing conformance case constructs policies with all five sub-entity fields empty, so the round-trip the editor depends on is proven on no backend.

**Files:**
- Create: `store/contract/policy_roundtrip.go`
- Create: `store/memory/policy_roundtrip_test.go`, `store/sqlite/policy_roundtrip_test.go`
- Create: `store/postgres/policy_roundtrip_integration_test.go`, `store/mongo/policy_roundtrip_integration_test.go`

**Interfaces:**
- Consumes: `contract.MakeStore func(t *testing.T) (store.Store, func())` (`store/contract/autoid.go:28`); `setupPostgres` (`store/postgres/testharness_test.go`), `setupMongoStore` (`store/mongo/parity_integration_test.go:34`).
- Produces: `contract.RunPolicyRoundTripContract(t *testing.T, mk MakeStore)`. Nothing else consumes it.

- [ ] **Step 1: Write the contract**

```go
// policy_roundtrip.go: a fully populated policy survives every write and
// read path.
//
// Policy.Subjects, Actions, Resources, Conditions and Obligations are all
// db:"-", and each backend persists them its own way: postgres jsonb, sqlite
// JSON strings, mongo native arrays, memory deep copies. Every other case in
// this package builds policies with those five fields empty, so until this
// case the round-trip the dashboard's policy editor writes and reads back was
// proven on no backend.
//
// Numbers are chosen to be exact in float64, because a JSON round-trip
// returns them as float64. Integers beyond 2^53 are refused on write by the
// dashboard contract rather than tested here.
package contract

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/xraph/warden/id"
	"github.com/xraph/warden/policy"
)

const roundTripTenant = "rt-tenant"

func populatedPolicy() *policy.Policy {
	notBefore := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	notAfter := time.Date(2026, 6, 30, 23, 59, 59, 0, time.UTC)
	return &policy.Policy{
		TenantID:      roundTripTenant,
		NamespacePath: "eng",
		Name:          "contractor-lockout",
		Description:   "every sub-entity populated",
		Effect:        policy.EffectDeny,
		Priority:      50,
		IsActive:      true,
		NotBefore:     &notBefore,
		NotAfter:      &notAfter,
		Version:       3,
		Subjects: []policy.SubjectMatch{
			{Role: "contractor"},
			{Kind: "user", ID: "usr_2f8a"},
			{Kind: "api_key"},
			{}, // an empty matcher is a real, stored shape: it matches everyone
		},
		Actions:   []string{"document:delete", "*"},
		Resources: []string{"document:*", "folder:root"},
		Conditions: []policy.Condition{
			{ID: id.NewConditionID(), Field: "context.ip", Operator: policy.OpNotIn, Value: []any{"10.0.0.1", "10.0.0.2"}},
			{ID: id.NewConditionID(), Field: "subject.mfa", Operator: policy.OpExists},
			{ID: id.NewConditionID(), Field: "resource.size", Operator: policy.OpGreaterThan, Value: 1024.5},
			{ID: id.NewConditionID(), Field: "subject.level", Operator: policy.OpGTE, Value: 9007199254740992.0},
			{ID: id.NewConditionID(), Field: "context.ip", Operator: policy.OpIPInCIDR, Value: []any{"10.0.0.0/8", "192.168.0.0/16"}},
			{ID: id.NewConditionID(), Field: "context.at", Operator: policy.OpTimeAfter, Value: "2026-06-01T09:00:00Z"},
			{ID: id.NewConditionID(), Field: "subject.email", Operator: policy.OpRegex, Value: `^[a-z]+@example\.com$`},
			{ID: id.NewConditionID(), Field: "action.name", Operator: policy.OpEquals, Value: "delete"},
		},
		Obligations: []string{"notify-security", "require-mfa"},
		Metadata:    map[string]any{"owner": "security", "ticket": 4412.0, "nested": map[string]any{"a": []any{"x", "y"}}},
		CreatedBy:   "usr_creator",
		UpdatedBy:   "usr_updater",
	}
}

// canonical renders a policy as the JSON value a reader sees, after
// normalising what backends legitimately differ on: timestamps the store
// assigns, time zones, and sub-second precision below a millisecond (mongo
// keeps milliseconds). Everything else must survive exactly.
func canonical(t *testing.T, p *policy.Policy) map[string]any {
	t.Helper()
	c := *p
	c.CreatedAt, c.UpdatedAt = time.Time{}, time.Time{}
	if c.NotBefore != nil {
		v := c.NotBefore.UTC().Truncate(time.Millisecond)
		c.NotBefore = &v
	}
	if c.NotAfter != nil {
		v := c.NotAfter.UTC().Truncate(time.Millisecond)
		c.NotAfter = &v
	}
	raw, err := json.Marshal(&c)
	if err != nil {
		t.Fatalf("marshal policy: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal policy: %v", err)
	}
	return out
}

func requireSamePolicy(t *testing.T, path string, want, got *policy.Policy) {
	t.Helper()
	w, g := canonical(t, want), canonical(t, got)
	if !reflect.DeepEqual(w, g) {
		for k, wv := range w {
			if gv := g[k]; !reflect.DeepEqual(wv, gv) {
				t.Errorf("%s: field %q\n want %#v\n  got %#v", path, k, wv, gv)
			}
		}
		for k := range g {
			if _, ok := w[k]; !ok {
				t.Errorf("%s: unexpected field %q = %#v", path, k, g[k])
			}
		}
	}
}

// RunPolicyRoundTripContract proves a populated policy survives create,
// update, and every read path the dashboard or the engine uses.
func RunPolicyRoundTripContract(t *testing.T, mk MakeStore) {
	t.Run("create then read through every path", func(t *testing.T) {
		s, cleanup := mk(t)
		defer cleanup()
		ctx := context.Background()
		want := populatedPolicy()
		if err := s.CreatePolicy(ctx, want); err != nil {
			t.Fatalf("CreatePolicy: %v", err)
		}

		got, err := s.GetPolicy(ctx, roundTripTenant, want.ID)
		if err != nil {
			t.Fatalf("GetPolicy: %v", err)
		}
		requireSamePolicy(t, "GetPolicy", want, got)

		ns := "eng"
		listed, err := s.ListPolicies(ctx, &policy.ListFilter{TenantID: roundTripTenant, NamespacePath: &ns})
		if err != nil || len(listed) != 1 {
			t.Fatalf("ListPolicies: %d rows, err %v", len(listed), err)
		}
		requireSamePolicy(t, "ListPolicies", want, listed[0])

		// The engine's own read path. If this one drops a field the
		// dashboard would show a rule the engine never evaluates.
		active, err := s.ListActivePolicies(ctx, roundTripTenant, []string{"eng", ""})
		if err != nil || len(active) != 1 {
			t.Fatalf("ListActivePolicies: %d rows, err %v", len(active), err)
		}
		requireSamePolicy(t, "ListActivePolicies", want, active[0])
	})

	t.Run("update replaces every sub-entity and reads back", func(t *testing.T) {
		s, cleanup := mk(t)
		defer cleanup()
		ctx := context.Background()
		p := &policy.Policy{TenantID: roundTripTenant, NamespacePath: "eng", Name: "contractor-lockout", Effect: policy.EffectAllow, IsActive: true, Version: 1}
		if err := s.CreatePolicy(ctx, p); err != nil {
			t.Fatalf("CreatePolicy: %v", err)
		}
		want := populatedPolicy()
		want.ID = p.ID
		if err := s.UpdatePolicy(ctx, want); err != nil {
			t.Fatalf("UpdatePolicy: %v", err)
		}
		// created_by is immutable on update in every backend (memory keeps
		// existing.CreatedBy; sqlite and postgres write policyUpdateColumns),
		// so the read-back carries the ORIGINAL creator, not want's.
		want.CreatedBy = p.CreatedBy
		got, err := s.GetPolicy(ctx, roundTripTenant, p.ID)
		if err != nil {
			t.Fatalf("GetPolicy: %v", err)
		}
		requireSamePolicy(t, "GetPolicy after UpdatePolicy", want, got)
	})

	t.Run("update can empty every sub-entity", func(t *testing.T) {
		s, cleanup := mk(t)
		defer cleanup()
		ctx := context.Background()
		p := populatedPolicy()
		if err := s.CreatePolicy(ctx, p); err != nil {
			t.Fatalf("CreatePolicy: %v", err)
		}
		p.Subjects, p.Actions, p.Resources, p.Conditions, p.Obligations = nil, nil, nil, nil, nil
		if err := s.UpdatePolicy(ctx, p); err != nil {
			t.Fatalf("UpdatePolicy: %v", err)
		}
		got, err := s.GetPolicy(ctx, roundTripTenant, p.ID)
		if err != nil {
			t.Fatalf("GetPolicy: %v", err)
		}
		// An emptied list must read back as empty, not as the old values.
		// Whether it reads back nil or [] is backend-specific and both
		// mean "matches everything", so only the length is asserted.
		if len(got.Subjects)+len(got.Actions)+len(got.Resources)+len(got.Conditions)+len(got.Obligations) != 0 {
			t.Fatalf("emptied sub-entities came back: %+v", got)
		}
	})
}
```

If `canonical`'s JSON comparison treats a backend's `nil` versus `[]` as different for a list that was **non-empty** when written, that is a real round-trip failure, not a normalisation gap. Do not normalise it away. The third subtest is the only place an empty list is written, and it deliberately asserts length only.

- [ ] **Step 2: Wire it into the four backends**

`store/memory/policy_roundtrip_test.go`:

```go
package memory

import (
	"testing"

	"github.com/xraph/warden/store"
	"github.com/xraph/warden/store/contract"
)

func TestMemory_PolicyRoundTripContract(t *testing.T) {
	contract.RunPolicyRoundTripContract(t, func(_ *testing.T) (store.Store, func()) {
		return New(), func() {}
	})
}
```

For sqlite, read `store/sqlite/list_filters_test.go` and copy its store construction exactly. For postgres and mongo, follow `store/postgres/uniqueness_integration_test.go` and `store/mongo/uniqueness_integration_test.go`: the file starts with `//go:build integration` and passes `setupPostgres` or the mongo equivalent as the `MakeStore`.

- [ ] **Step 3: Run it on all four, and prove the integration runs did not skip**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./store/memory/ ./store/sqlite/ -run PolicyRoundTrip -v -count=1
```

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go test -tags integration ./store/postgres/ ./store/mongo/ -run PolicyRoundTrip -v -count=1 2>&1 | tee /tmp/warden-roundtrip.log | tail -30
```

**Leave `WARDEN_TEST_DSN` and `WARDEN_TEST_MONGO_URI` unset.** The harness then starts its own postgres:16-alpine and mongo:7 containers. Docker is running on this machine. The postgres on local port 5432 belongs to someone else, and the harness creates and drops databases, so do not point it there.

Both harnesses call `t.Skipf` when their container cannot start, and a skipped test reads as passing. Prove all four ran:

```bash
grep -c -- '--- SKIP' /tmp/warden-roundtrip.log
```

Expected: `0`. And `--- PASS: TestPostgres_PolicyRoundTripContract` and `--- PASS: TestMongo_PolicyRoundTripContract` both present.

**If a backend fails, that is the finding this task exists to surface.** Report exactly which field and which backend, with the want and got values the helper prints, and stop with status DONE_WITH_CONCERNS. Do not change `canonical` to make a real difference disappear, and do not fix the backend in this task; the controller rules on it.

- [ ] **Step 4: Run the whole repo and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go vet ./store/... && go test ./...
```

```bash
git add store/contract/policy_roundtrip.go store/memory/policy_roundtrip_test.go store/sqlite/policy_roundtrip_test.go store/postgres/policy_roundtrip_integration_test.go store/mongo/policy_roundtrip_integration_test.go
git commit -m "test(store): prove a fully populated policy round-trips on every backend" -- store/contract/policy_roundtrip.go store/memory/policy_roundtrip_test.go store/sqlite/policy_roundtrip_test.go store/postgres/policy_roundtrip_integration_test.go store/mongo/policy_roundtrip_integration_test.go
```

---

## Task 2: The policy analysis and write-time validation

The heart of the plan. One analysis classifies every condition whose outcome is fixed before any check runs. Stored policies are flagged with it (Task 3) and new or edited ones are refused with it (Task 4). It is tested against warden's real evaluator, so if the engine changes, the analysis test fails instead of the page quietly lying.

**Files:**
- Create: `extension/contract/policy_analysis.go`, `extension/contract/policy_analysis_test.go`
- Create: `extension/contract/policy_validate.go`, `extension/contract/policy_validate_test.go`
- Modify: `contract.go`, `manifest.yaml`, `authz.go`, and the three guard tests

**Interfaces:**
- Consumes: `policy.Condition`, `policy.Operator` and its 17 constants, `policy.ValidateCondition`, `policy.Effect*`; `warden.NewConditionEvaluator`, `warden.CheckRequest` (tests only); `validateNamespace`, `badRequest`, `requireEngine`, `tenantFrom`.
- Produces, for Tasks 3 and 4: `ConditionProblem` (`""`, `"throws"`, `"alwaysFalse"`, `"alwaysTrue"`), `ConditionReason` (`""`, `"unknownOperator"`, `"invalidRegex"`, `"unresolvableField"`, `"notAList"`, `"emptyList"`, `"notANumber"`, `"noValidCIDR"`, `"notATime"`), `classifyCondition(c policy.Condition) (ConditionProblem, ConditionReason)`, `policyAnalysis`, `analysePolicy(p *policy.Policy, now time.Time) policyAnalysis`, the wire types `PolicySubject`, `PolicyCondition`, `PolicyDraft`, `PolicyIssues`, `ConditionIssue`, and `collectPolicyIssues(d PolicyDraft, parts draftParts) PolicyIssues`, `issuesError(PolicyIssues) error`, `toPolicyConditions([]PolicyCondition) []policy.Condition`.

- [ ] **Step 1: Write the analysis**

```go
// policy_analysis.go: what a policy will actually do, decided before any
// check runs.
//
// Every rule here mirrors warden's evaluator (evaluator.go) and is tested
// against it in policy_analysis_test.go by running each case through
// warden.NewConditionEvaluator. If the engine changes, that test fails,
// rather than a page quietly describing behaviour the engine no longer has.
//
// Why this exists: nothing validates a policy on write (policy.Validate has
// no non-test caller, and the REST create stores whatever it is sent), and
// several shapes store fine while doing something other than what they read
// as. `context.ip not_in "10.0.0.0/8"` with a string instead of a list is
// always true, so on a deny it denies everyone. `gt` against a non-number is
// always false. `action.verb` never resolves, so `neq` on it is always true.
package contract

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xraph/warden/policy"
)

// ConditionProblem is a condition's outcome when it does not depend on the
// check being made.
type ConditionProblem string

const (
	ProblemNone        ConditionProblem = ""
	ProblemThrows      ConditionProblem = "throws"      // evaluation errors: a deny fails closed, an allow is skipped
	ProblemAlwaysFalse ConditionProblem = "alwaysFalse" // the policy can never apply
	ProblemAlwaysTrue  ConditionProblem = "alwaysTrue"  // the condition restricts nothing
)

// ConditionReason says why a condition's outcome is fixed.
type ConditionReason string

const (
	ReasonNone              ConditionReason = ""
	ReasonUnknownOperator   ConditionReason = "unknownOperator"
	ReasonInvalidRegex      ConditionReason = "invalidRegex"
	ReasonUnresolvableField ConditionReason = "unresolvableField"
	ReasonNotAList          ConditionReason = "notAList"
	ReasonEmptyList         ConditionReason = "emptyList"
	ReasonNotANumber        ConditionReason = "notANumber"
	ReasonNoValidCIDR       ConditionReason = "noValidCIDR"
	ReasonNotATime          ConditionReason = "notATime"
)

// knownOperators is the evaluator's switch in evaluateCondition. Anything
// else falls to its default case, which returns an error.
var knownOperators = map[policy.Operator]struct{}{
	policy.OpEquals: {}, policy.OpNotEquals: {}, policy.OpIn: {}, policy.OpNotIn: {},
	policy.OpContains: {}, policy.OpStartsWith: {}, policy.OpEndsWith: {},
	policy.OpGreaterThan: {}, policy.OpLessThan: {}, policy.OpGTE: {}, policy.OpLTE: {},
	policy.OpExists: {}, policy.OpNotExists: {}, policy.OpIPInCIDR: {},
	policy.OpTimeAfter: {}, policy.OpTimeBefore: {}, policy.OpRegex: {},
}

// fieldResolves mirrors resolveField: only subject.<x>, resource.<x>,
// action.name and context.<x> ever produce a value. Bare "action" and
// "action.<anything but name>" pass policy.ValidateCondition and never
// resolve, which is a disagreement inside warden this contract compensates
// for. An empty suffix ("context.") is treated as unresolvable too: it would
// look up the attribute named "", which nothing sets.
func fieldResolves(field string) bool {
	prefix, suffix, ok := strings.Cut(field, ".")
	if !ok || suffix == "" {
		return false
	}
	switch prefix {
	case "subject", "resource", "context":
		return true
	case "action":
		return suffix == "name"
	}
	return false
}

// listOf mirrors inSlice's accepted shapes: []string and []any, nothing
// else.
func listOf(v any) (items []string, isList bool) {
	switch t := v.(type) {
	case []string:
		return t, true
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			out = append(out, fmt.Sprint(item))
		}
		return out, true
	}
	return nil, false
}

// asNumber mirrors toFloat64 exactly, including the integer widths it does
// NOT accept (uint8, uint16).
func asNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int8:
		return float64(n), true
	case int16:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint:
		return float64(n), true
	case uint32:
		return float64(n), true
	case uint64:
		return float64(n), true
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	}
	return 0, false
}

// anyCIDRParses mirrors ipInCIDR: a string or list is accepted, an
// unparseable CIDR is skipped, and if none parse nothing can match.
func anyCIDRParses(v any) bool {
	var cidrs []string
	switch t := v.(type) {
	case string:
		cidrs = []string{t}
	default:
		items, ok := listOf(v)
		if !ok {
			return false
		}
		cidrs = items
	}
	for _, c := range cidrs {
		if _, _, err := net.ParseCIDR(c); err == nil {
			return true
		}
	}
	return false
}

// timeParses mirrors parseTime: a time.Time, or an RFC3339 string.
func timeParses(v any) bool {
	switch t := v.(type) {
	case time.Time:
		return true
	case string:
		_, err := time.Parse(time.RFC3339, t)
		return err == nil
	}
	return false
}

// nilOutcome is what evaluateCondition returns when the field resolved to
// nil, for the operators whose result then depends only on the stored
// value. It mirrors each case of evaluateCondition with actual = nil, where
// fmt.Sprint(nil) is "<nil>".
func nilOutcome(c policy.Condition) bool {
	actual := fmt.Sprint(nil)
	expected := fmt.Sprint(c.Value)
	switch c.Operator {
	case policy.OpEquals:
		return actual == expected
	case policy.OpNotEquals:
		return actual != expected
	case policy.OpIn, policy.OpNotIn:
		items, _ := listOf(c.Value)
		found := false
		for _, item := range items {
			if item == actual {
				found = true
			}
		}
		if c.Operator == policy.OpIn {
			return found
		}
		return !found
	case policy.OpContains:
		return strings.Contains(actual, expected)
	case policy.OpStartsWith:
		return strings.HasPrefix(actual, expected)
	case policy.OpEndsWith:
		return strings.HasSuffix(actual, expected)
	case policy.OpNotExists:
		return true
	case policy.OpRegex:
		re := regexp.MustCompile(expected) // callers check it compiles first
		return re.MatchString(actual)
	}
	// exists, gt, lt, gte, lte, ip_in_cidr, time_after, time_before are all
	// false for a nil actual.
	return false
}

// classifyCondition reports whether a condition's outcome is fixed, and why.
// The order matters: an unknown operator or an uncompilable regex throws
// regardless of the field, so those are checked first.
func classifyCondition(c policy.Condition) (ConditionProblem, ConditionReason) {
	if _, ok := knownOperators[c.Operator]; !ok {
		return ProblemThrows, ReasonUnknownOperator
	}
	if c.Operator == policy.OpRegex {
		if _, err := regexp.Compile(fmt.Sprint(c.Value)); err != nil {
			return ProblemThrows, ReasonInvalidRegex
		}
	}
	if !fieldResolves(c.Field) {
		if nilOutcome(c) {
			return ProblemAlwaysTrue, ReasonUnresolvableField
		}
		return ProblemAlwaysFalse, ReasonUnresolvableField
	}
	switch c.Operator {
	case policy.OpIn, policy.OpNotIn:
		items, isList := listOf(c.Value)
		reason := ReasonNotAList
		if isList {
			if len(items) > 0 {
				return ProblemNone, ReasonNone
			}
			reason = ReasonEmptyList
		}
		if c.Operator == policy.OpIn {
			return ProblemAlwaysFalse, reason
		}
		return ProblemAlwaysTrue, reason
	case policy.OpGreaterThan, policy.OpLessThan, policy.OpGTE, policy.OpLTE:
		if _, ok := asNumber(c.Value); !ok {
			return ProblemAlwaysFalse, ReasonNotANumber
		}
	case policy.OpIPInCIDR:
		if !anyCIDRParses(c.Value) {
			return ProblemAlwaysFalse, ReasonNoValidCIDR
		}
	case policy.OpTimeAfter, policy.OpTimeBefore:
		if !timeParses(c.Value) {
			return ProblemAlwaysFalse, ReasonNotATime
		}
	}
	return ProblemNone, ReasonNone
}

// Policy states. "never" is a window whose end precedes its start: under
// EffectiveAt it cannot be in effect at any instant.
const (
	StateActive    = "active"
	StateInactive  = "inactive"
	StateScheduled = "scheduled"
	StateExpired   = "expired"
	StateNever     = "never"
)

func policyState(p *policy.Policy, now time.Time) string {
	switch {
	case !p.IsActive:
		return StateInactive
	case p.NotBefore != nil && p.NotAfter != nil && p.NotAfter.Before(*p.NotBefore):
		return StateNever
	case p.NotBefore != nil && now.Before(*p.NotBefore):
		return StateScheduled
	case p.NotAfter != nil && now.After(*p.NotAfter):
		return StateExpired
	}
	return StateActive
}

// policyAnalysis is everything the dashboard shows about a policy that the
// stored fields do not say directly.
type policyAnalysis struct {
	State        string
	FailsClosed  bool // a deny that applies as if its conditions from DecidingCondition on were met
	NeverApplies bool
	// DecidingCondition is the index of the condition that makes the policy
	// fail closed or never apply, or -1.
	DecidingCondition     int
	Problems              []ConditionProblem
	Reasons               []ConditionReason
	SubjectsUnrestricted  bool
	ActionsUnrestricted   bool
	ResourcesUnrestricted bool
	MatchesEverything     bool
	HasRoleMatcher        bool
}

// analysePolicy walks the conditions in evaluation order.
// evaluateConditions stops at the first false and at the first error, so
// the FIRST condition with a fixed false or error outcome decides, and a
// condition that merely depends on the check cannot rescue a later one.
func analysePolicy(p *policy.Policy, now time.Time) policyAnalysis {
	a := policyAnalysis{
		State:             policyState(p, now),
		DecidingCondition: -1,
		Problems:          make([]ConditionProblem, len(p.Conditions)),
		Reasons:           make([]ConditionReason, len(p.Conditions)),
	}
	for i, c := range p.Conditions {
		a.Problems[i], a.Reasons[i] = classifyCondition(c)
	}
	for i, pr := range a.Problems {
		if pr == ProblemThrows {
			a.DecidingCondition = i
			if p.Effect == policy.EffectAllow {
				a.NeverApplies = true
			} else {
				a.FailsClosed = true // anything but exactly "allow" is a deny
			}
			break
		}
		if pr == ProblemAlwaysFalse {
			a.DecidingCondition = i
			a.NeverApplies = true
			break
		}
	}

	a.SubjectsUnrestricted = len(p.Subjects) == 0
	for _, s := range p.Subjects {
		if s.Kind == "" && s.ID == "" && s.Role == "" {
			a.SubjectsUnrestricted = true
		}
		if s.Role != "" {
			a.HasRoleMatcher = true
		}
	}
	a.ActionsUnrestricted = len(p.Actions) == 0 || containsString(p.Actions, "*")
	a.ResourcesUnrestricted = len(p.Resources) == 0 || containsString(p.Resources, "*")
	a.MatchesEverything = a.SubjectsUnrestricted && a.ActionsUnrestricted && a.ResourcesUnrestricted
	return a
}

func containsString(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
```

`nilOutcome` covers the operator families that remain after `classifyCondition`'s earlier returns; `regexp.MustCompile` is safe there only because the uncompilable case returned first. Confirm `containsString` does not collide with an existing helper in the package; if one exists with the same behaviour, use it.

- [ ] **Step 2: Test the analysis against the real evaluator**

This is the test that keeps the analysis honest. Each case builds a one-condition policy with empty matchers, runs it through `warden.NewConditionEvaluator` as both an allow and a deny, and asserts the outcome the classification claims.

```go
package contract

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/warden"
	"github.com/xraph/warden/policy"
)

var fixedNow = time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

// probe runs one condition through warden's real evaluator. It returns the
// outcome as the evaluator sees it: "true", "false" or "throws". It uses
// two policies because each alone is ambiguous: an allow is skipped both
// when its condition is false and when it throws, and a deny applies both
// when its condition is true and when it throws.
func probe(t *testing.T, c policy.Condition, req *warden.CheckRequest) string {
	t.Helper()
	eval := warden.NewConditionEvaluator(func() time.Time { return fixedNow })
	run := func(effect policy.Effect) *warden.CheckResult {
		p := &policy.Policy{Name: "probe", Effect: effect, IsActive: true, Conditions: []policy.Condition{c}}
		res, err := eval.Evaluate(context.Background(), []*policy.Policy{p}, req, nil)
		if err != nil {
			t.Fatalf("Evaluate: %v", err)
		}
		return res
	}
	allow, deny := run(policy.EffectAllow), run(policy.EffectDeny)
	switch {
	case allow != nil && allow.Allowed:
		return "true"
	case deny != nil:
		return "throws" // deny applied although the allow was skipped
	}
	return "false"
}

// requests covers the ways a check can populate the fields the cases use,
// including values that would make a well-formed version of each condition
// true. A classification that claims a fixed outcome must hold for all.
func requests() []*warden.CheckRequest {
	return []*warden.CheckRequest{
		{Subject: warden.Subject{Kind: "user", ID: "u1"}, Action: warden.Action{Name: "read"}, Resource: warden.Resource{Type: "document", ID: "d1"}},
		{
			Subject:  warden.Subject{Kind: "user", ID: "u2", Attributes: map[string]any{"level": 5, "mfa": true}},
			Action:   warden.Action{Name: "delete"},
			Resource: warden.Resource{Type: "document", ID: "d2", Attributes: map[string]any{"size": 10}},
			Context:  map[string]any{"ip": "10.1.2.3", "at": "2026-06-10T00:00:00Z"},
		},
	}
}

func TestClassifyConditionMatchesTheEvaluator(t *testing.T) {
	cases := []struct {
		name    string
		c       policy.Condition
		problem ConditionProblem
		reason  ConditionReason
	}{
		{"unknown operator throws", policy.Condition{Field: "context.ip", Operator: "approximately", Value: "x"}, ProblemThrows, ReasonUnknownOperator},
		{"uncompilable regex throws", policy.Condition{Field: "subject.id", Operator: policy.OpRegex, Value: "(unclosed"}, ProblemThrows, ReasonInvalidRegex},
		{"uncompilable regex throws even on an unresolvable field", policy.Condition{Field: "action.verb", Operator: policy.OpRegex, Value: "(unclosed"}, ProblemThrows, ReasonInvalidRegex},
		{"not_in given a string is always true", policy.Condition{Field: "context.ip", Operator: policy.OpNotIn, Value: "10.1.2.3"}, ProblemAlwaysTrue, ReasonNotAList},
		{"in given a string is always false", policy.Condition{Field: "context.ip", Operator: policy.OpIn, Value: "10.1.2.3"}, ProblemAlwaysFalse, ReasonNotAList},
		{"in given an empty list is always false", policy.Condition{Field: "context.ip", Operator: policy.OpIn, Value: []any{}}, ProblemAlwaysFalse, ReasonEmptyList},
		{"not_in given an empty list is always true", policy.Condition{Field: "context.ip", Operator: policy.OpNotIn, Value: []any{}}, ProblemAlwaysTrue, ReasonEmptyList},
		{"gt against a non-number is always false", policy.Condition{Field: "subject.level", Operator: policy.OpGreaterThan, Value: "high"}, ProblemAlwaysFalse, ReasonNotANumber},
		{"ip_in_cidr with no valid CIDR is always false", policy.Condition{Field: "context.ip", Operator: policy.OpIPInCIDR, Value: []any{"10.0.0.0/99", "nope"}}, ProblemAlwaysFalse, ReasonNoValidCIDR},
		{"time_after with an unparseable time is always false", policy.Condition{Field: "context.at", Operator: policy.OpTimeAfter, Value: "last tuesday"}, ProblemAlwaysFalse, ReasonNotATime},
		{"neq on action.verb is always true", policy.Condition{Field: "action.verb", Operator: policy.OpNotEquals, Value: "read"}, ProblemAlwaysTrue, ReasonUnresolvableField},
		{"eq on bare action is always false", policy.Condition{Field: "action", Operator: policy.OpEquals, Value: "read"}, ProblemAlwaysFalse, ReasonUnresolvableField},
		{"not_exists on an unresolvable field is always true", policy.Condition{Field: "action.verb", Operator: policy.OpNotExists}, ProblemAlwaysTrue, ReasonUnresolvableField},
		{"exists on an unresolvable field is always false", policy.Condition{Field: "nodot", Operator: policy.OpExists}, ProblemAlwaysFalse, ReasonUnresolvableField},
		{"contains on an unresolvable field compares against <nil>", policy.Condition{Field: "action.verb", Operator: policy.OpContains, Value: "nil"}, ProblemAlwaysTrue, ReasonUnresolvableField},
		{"a well-formed ip_in_cidr is not fixed", policy.Condition{Field: "context.ip", Operator: policy.OpIPInCIDR, Value: []any{"10.0.0.0/8"}}, ProblemNone, ReasonNone},
		{"a well-formed in is not fixed", policy.Condition{Field: "context.ip", Operator: policy.OpIn, Value: []any{"10.1.2.3"}}, ProblemNone, ReasonNone},
		{"action.name resolves", policy.Condition{Field: "action.name", Operator: policy.OpEquals, Value: "read"}, ProblemNone, ReasonNone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problem, reason := classifyCondition(tc.c)
			if problem != tc.problem || reason != tc.reason {
				t.Fatalf("classified (%q, %q), want (%q, %q)", problem, reason, tc.problem, tc.reason)
			}
			for i, req := range requests() {
				got := probe(t, tc.c, req)
				switch problem {
				case ProblemThrows:
					if got != "throws" {
						t.Errorf("request %d: evaluator says %s, classification says throws", i, got)
					}
				case ProblemAlwaysTrue:
					if got != "true" {
						t.Errorf("request %d: evaluator says %s, classification says always true", i, got)
					}
				case ProblemAlwaysFalse:
					if got != "false" {
						t.Errorf("request %d: evaluator says %s, classification says always false", i, got)
					}
				}
			}
		})
	}
	// A well-formed condition must actually vary, or the probe is broken.
	c := policy.Condition{Field: "context.ip", Operator: policy.OpIPInCIDR, Value: []any{"10.0.0.0/8"}}
	if probe(t, c, requests()[0]) != "false" || probe(t, c, requests()[1]) != "true" {
		t.Fatal("the probe cannot tell a varying condition from a fixed one")
	}
}

func TestAnalysePolicyIsOrderAware(t *testing.T) {
	throws := policy.Condition{Field: "subject.id", Operator: policy.OpRegex, Value: "(unclosed"}
	never := policy.Condition{Field: "context.ip", Operator: policy.OpIPInCIDR, Value: "nope"}
	varies := policy.Condition{Field: "context.ip", Operator: policy.OpIPInCIDR, Value: "10.0.0.0/8"}

	cases := []struct {
		name         string
		effect       policy.Effect
		conds        []policy.Condition
		failsClosed  bool
		neverApplies bool
		deciding     int
	}{
		{"a deny whose first condition throws fails closed", policy.EffectDeny, []policy.Condition{throws}, true, false, 0},
		{"an allow whose condition throws never applies", policy.EffectAllow, []policy.Condition{throws}, false, true, 0},
		{"an always-false condition means never applies, for a deny too", policy.EffectDeny, []policy.Condition{never}, false, true, 0},
		{"the first fixed outcome decides: always-false before a throw", policy.EffectDeny, []policy.Condition{never, throws}, false, true, 0},
		{"the first fixed outcome decides: a throw before always-false", policy.EffectDeny, []policy.Condition{throws, never}, true, false, 0},
		{"a varying condition before a throw does not change the classification", policy.EffectDeny, []policy.Condition{varies, throws}, true, false, 1},
		{"an effect that is not exactly allow is a deny", policy.Effect("DENY"), []policy.Condition{throws}, true, false, 0},
		{"a clean policy is neither", policy.EffectDeny, []policy.Condition{varies}, false, false, -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := analysePolicy(&policy.Policy{Effect: tc.effect, IsActive: true, Conditions: tc.conds}, fixedNow)
			if a.FailsClosed != tc.failsClosed || a.NeverApplies != tc.neverApplies || a.DecidingCondition != tc.deciding {
				t.Fatalf("got failsClosed=%v neverApplies=%v deciding=%d, want %v %v %d",
					a.FailsClosed, a.NeverApplies, a.DecidingCondition, tc.failsClosed, tc.neverApplies, tc.deciding)
			}
		})
	}
}

func TestAnalysePolicySeesEveryUnrestrictedShape(t *testing.T) {
	for name, p := range map[string]*policy.Policy{
		"empty lists":                         {},
		"an empty subject matcher in a list":  {Subjects: []policy.SubjectMatch{{Kind: "user", ID: "u1"}, {}}, Actions: []string{"*"}, Resources: []string{"*"}},
	} {
		t.Run(name, func(t *testing.T) {
			if !analysePolicy(p, fixedNow).MatchesEverything {
				t.Fatal("not recognised as matching every check")
			}
		})
	}
	restricted := &policy.Policy{Subjects: []policy.SubjectMatch{{Kind: "user"}}}
	if analysePolicy(restricted, fixedNow).SubjectsUnrestricted {
		t.Fatal("a kind-only matcher restricts to that kind")
	}
}

func TestPolicyState(t *testing.T) {
	before, after := fixedNow.Add(-time.Hour), fixedNow.Add(time.Hour)
	cases := map[string]struct {
		p    policy.Policy
		want string
	}{
		"inactive wins over the window": {policy.Policy{IsActive: false, NotAfter: &before}, StateInactive},
		"end before start is never":     {policy.Policy{IsActive: true, NotBefore: &after, NotAfter: &before}, StateNever},
		"not started is scheduled":      {policy.Policy{IsActive: true, NotBefore: &after}, StateScheduled},
		"ended is expired":              {policy.Policy{IsActive: true, NotAfter: &before}, StateExpired},
		"inside the window is active":   {policy.Policy{IsActive: true, NotBefore: &before, NotAfter: &after}, StateActive},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			p := tc.p
			if got := policyState(&p, fixedNow); got != tc.want {
				t.Fatalf("state %q, want %q", got, tc.want)
			}
			// The analysis must agree with the engine's own gate.
			if (policyState(&p, fixedNow) == StateActive) != p.EffectiveAt(fixedNow) {
				t.Fatal("policyState disagrees with EffectiveAt")
			}
		})
	}
}
```

Run: `cd /Users/rexraphael/Work/xraph/forgery/warden && go test ./extension/contract/ -run 'Classify|AnalysePolicy|PolicyState' -v`. Expected first: compile failure. After Step 1: PASS. If `TestClassifyConditionMatchesTheEvaluator` fails for any case, **the analysis is wrong, not the test**: read the relevant branch of `evaluator.go` and fix the classification, and say so in your report.

- [ ] **Step 3: Write the validation**

```go
// policy_validate.go: refuse, on write, the policy shapes that store fine
// but cannot behave the way they read.
//
// Nothing below the contract does this: policy.Validate has no non-test
// caller. And policy.ValidateCondition on its own is not enough, because it
// accepts fields the evaluator never resolves (bare "action", "action.x")
// and says nothing about the always-true and always-false shapes
// classifyCondition finds.
package contract

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/xraph/warden/id"
	"github.com/xraph/warden/policy"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

// PolicySubject mirrors policy.SubjectMatch. Its three fields are AND-ed.
type PolicySubject struct {
	Kind string `json:"kind,omitempty"`
	ID   string `json:"id,omitempty"`
	Role string `json:"role,omitempty"`
}

// PolicyCondition is one condition on the wire. Value's JSON type follows
// the operator: a list for in, not_in and ip_in_cidr (ip_in_cidr also
// accepts one string), a number for gt, lt, gte and lte, an RFC3339 string
// for time_after and time_before, absent for exists and not_exists, and a
// string otherwise.
type PolicyCondition struct {
	ID       string `json:"id,omitempty"`
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value,omitempty"`
}

// PolicyDraft is the editable body of a policy.
type PolicyDraft struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Effect      string            `json:"effect"`
	Priority    int               `json:"priority"`
	NotBefore   string            `json:"notBefore,omitempty"`
	NotAfter    string            `json:"notAfter,omitempty"`
	Subjects    []PolicySubject   `json:"subjects"`
	Actions     []string          `json:"actions"`
	Resources   []string          `json:"resources"`
	Conditions  []PolicyCondition `json:"conditions"`
	Obligations []string          `json:"obligations"`
}

// ConditionIssue marks one condition row.
type ConditionIssue struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
}

// PolicyIssues is every reason a draft cannot be saved. Fields is keyed by
// wire name: name, effect, window, subjects, actions, resources,
// obligations. Conditions carries one entry per bad row, so a page can mark
// the exact row.
type PolicyIssues struct {
	Fields     map[string]string `json:"fields"`
	Conditions []ConditionIssue  `json:"conditions"`
}

func (i PolicyIssues) empty() bool { return len(i.Fields) == 0 && len(i.Conditions) == 0 }

// draftParts says which parts of a draft are being written. An update
// validates only what it changes, so a policy stored with a bad condition
// before this validation existed can still have its description edited.
type draftParts struct {
	name, effect, window, subjects, actions, resources, conditions, obligations bool
}

var allParts = draftParts{true, true, true, true, true, true, true, true}

// maxExactInteger is the largest magnitude float64 holds exactly. A number
// past it does not survive a JSON round-trip through postgres or sqlite,
// and eq compares through fmt.Sprint, so the stored condition would
// silently stop matching.
const maxExactInteger = 1 << 53

// validSubjectKinds is already declared in handlers_assignments.go (plan
// 2b) with exactly warden's closed set. Reuse it; do not redeclare it.

func collectPolicyIssues(d PolicyDraft, parts draftParts) PolicyIssues {
	issues := PolicyIssues{Fields: map[string]string{}, Conditions: []ConditionIssue{}}
	if parts.name && strings.TrimSpace(d.Name) == "" {
		issues.Fields["name"] = "A policy needs a name."
	}
	if parts.effect && d.Effect != string(policy.EffectAllow) && d.Effect != string(policy.EffectDeny) {
		issues.Fields["effect"] = `Effect must be "allow" or "deny".`
	}
	if parts.window {
		if msg := windowIssue(d.NotBefore, d.NotAfter); msg != "" {
			issues.Fields["window"] = msg
		}
	}
	if parts.subjects {
		for _, s := range d.Subjects {
			if s.Kind == "" && s.ID == "" && s.Role == "" {
				issues.Fields["subjects"] = "An empty subject matcher matches everyone. To mean everyone, remove every subject instead."
				break
			}
			if _, ok := validSubjectKinds[s.Kind]; s.Kind != "" && !ok {
				issues.Fields["subjects"] = fmt.Sprintf("Subject kind %q is not one warden checks. Use user, api_key, service or service_acct.", s.Kind)
				break
			}
		}
	}
	for part, list := range map[string][]string{"actions": d.Actions, "resources": d.Resources, "obligations": d.Obligations} {
		if !map[string]bool{"actions": parts.actions, "resources": parts.resources, "obligations": parts.obligations}[part] {
			continue
		}
		for _, v := range list {
			if strings.TrimSpace(v) == "" {
				issues.Fields[part] = "An entry is empty."
				break
			}
		}
	}
	if parts.conditions {
		for i, c := range d.Conditions {
			if msg := conditionIssue(c); msg != "" {
				issues.Conditions = append(issues.Conditions, ConditionIssue{Index: i, Message: msg})
			}
		}
	}
	return issues
}

func windowIssue(notBefore, notAfter string) string {
	var nb, na time.Time
	var err error
	if notBefore != "" {
		if nb, err = time.Parse(time.RFC3339, notBefore); err != nil {
			return "The start is not an RFC3339 time."
		}
	}
	if notAfter != "" {
		if na, err = time.Parse(time.RFC3339, notAfter); err != nil {
			return "The end is not an RFC3339 time."
		}
	}
	if notBefore != "" && notAfter != "" && !na.After(nb) {
		return "The end must be after the start, or the policy is never in effect."
	}
	return ""
}

// conditionIssue returns why one condition cannot be saved, or "".
func conditionIssue(c PolicyCondition) string {
	pc := policy.Condition{Field: c.Field, Operator: policy.Operator(c.Operator), Value: c.Value}
	// classifyCondition first: its messages say what the condition would DO,
	// which is the useful thing to tell an operator.
	switch problem, reason := classifyCondition(pc); {
	case reason == ReasonUnknownOperator:
		return fmt.Sprintf("%q is not an operator warden knows, so this condition would fail every check.", c.Operator)
	case reason == ReasonInvalidRegex:
		return "This pattern does not compile, so this condition would fail every check."
	case reason == ReasonUnresolvableField:
		return fmt.Sprintf("Warden never gives %q a value, so this condition would always be %t. Use subject., resource., context., or action.name.", c.Field, problem == ProblemAlwaysTrue)
	case reason == ReasonNotAList:
		return "This operator needs a list of values."
	case reason == ReasonEmptyList:
		return "The list is empty, so this condition would never restrict anything."
	case reason == ReasonNotANumber:
		return "This operator compares numbers, and the value is not one."
	case reason == ReasonNoValidCIDR:
		return "None of these parse as a network like 10.0.0.0/8."
	case reason == ReasonNotATime:
		return "The value must be an RFC3339 time, like 2026-06-01T09:00:00Z."
	}
	if err := policy.ValidateCondition(pc); err != nil {
		return strings.TrimPrefix(err.Error(), "policy: ")
	}
	if n, ok := largestMagnitude(c.Value); ok && n > maxExactInteger {
		return "Numbers above 9007199254740992 lose precision when stored. Store it as a string instead."
	}
	return ""
}

// largestMagnitude finds the largest absolute numeric value in a value or
// a list of values.
func largestMagnitude(v any) (float64, bool) {
	if items, ok := v.([]any); ok {
		var best float64
		found := false
		for _, item := range items {
			if n, ok := largestMagnitude(item); ok {
				found = true
				best = math.Max(best, n)
			}
		}
		return best, found
	}
	switch n := v.(type) {
	case float64:
		return math.Abs(n), true
	case float32:
		return math.Abs(float64(n)), true
	case int:
		return math.Abs(float64(n)), true
	case int64:
		return math.Abs(float64(n)), true
	}
	return 0, false
}

// issuesError turns issues into the BAD_REQUEST a page renders row by row.
func issuesError(i PolicyIssues) error {
	if i.empty() {
		return nil
	}
	return &dashcontract.Error{
		Code:    dashcontract.CodeBadRequest,
		Message: fmt.Sprintf("This policy cannot be saved: %d condition(s) and %d field(s) need fixing.", len(i.Conditions), len(i.Fields)),
		Details: map[string]any{"fields": i.Fields, "conditions": i.Conditions},
	}
}

// toPolicyConditions keeps a condition id the caller sent, and gives every
// other condition a fresh one, as the REST create does.
func toPolicyConditions(in []PolicyCondition) []policy.Condition {
	out := make([]policy.Condition, 0, len(in))
	for _, c := range in {
		cid, err := id.ParseConditionID(c.ID)
		if err != nil {
			cid = id.NewConditionID()
		}
		out = append(out, policy.Condition{ID: cid, Field: strings.TrimSpace(c.Field), Operator: policy.Operator(c.Operator), Value: c.Value})
	}
	return out
}

// PolicyValidateResponse is policies.validate's reply.
type PolicyValidateResponse struct {
	Valid bool `json:"valid"`
	PolicyIssues
}

func policiesValidateHandler(deps Deps) func(ctx context.Context, in PolicyDraft, p dashcontract.Principal) (PolicyValidateResponse, error) {
	return func(ctx context.Context, in PolicyDraft, p dashcontract.Principal) (PolicyValidateResponse, error) {
		if err := requireEngine(deps); err != nil {
			return PolicyValidateResponse{}, err
		}
		if _, err := tenantFrom(p, deps); err != nil {
			return PolicyValidateResponse{}, err
		}
		issues := collectPolicyIssues(in, allParts)
		return PolicyValidateResponse{Valid: issues.empty(), PolicyIssues: issues}, nil
	}
}
```

Add `"context"` to the imports. `validSubjectKinds` already exists in this package (`handlers_assignments.go`), so the code above uses it without declaring it; a second declaration will not compile. The `for part, list := range map...` block is compact but awkward; if a clearer form reads better, write that instead and keep the behaviour.

- [ ] **Step 4: Test the validation**

Cover, each asserting the issue lands under the right key or index, with `valid: false`:
- a missing name, a bad effect (`"DENY"`), an end before the start, an unparseable start;
- an empty subject matcher, and a subject kind `"usr"`;
- an empty action entry;
- one condition per `ConditionReason`, each asserting its `Index` is the position it was sent at, including a bad row at index 2 of three so the index is not accidentally always 0;
- a regex over 512 characters that compiles (caught by `policy.ValidateCondition`, not by `classifyCondition`);
- a number `1e16` in a `gt` condition and inside an `in` list, both refused;
- **several bad rows at once all reported**, so the page can mark every row in one pass, not only the first;
- a clean draft returns `valid: true` with empty `fields` and `conditions`;
- `draftParts`: a draft with a bad condition validated with `conditions: false` passes.

- [ ] **Step 5: Register `policies.validate`**

A query: it has no side effect. In `contract.go` register it with the established pattern. In `manifest.yaml`:

```yaml
  - { name: policies.validate, kind: query, version: 1, requires: { warden: warden.engine }, capability: read }
```

and under `queries:` a `policyValidation` entry with `staleTime: 0s`, following the file's existing query entries. In `authz.go`'s `intentPolicies` and `authz_test.go`'s `wantPolicies`: `read` on `warden:policy`. Add it to `handlers_tenant_test.go` and `manifest_test.go`'s `wantKind`.

- [ ] **Step 6: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go vet ./extension/contract && go test ./...
```

```bash
git add extension/contract/policy_analysis.go extension/contract/policy_analysis_test.go extension/contract/policy_validate.go extension/contract/policy_validate_test.go
git commit -m "feat(contract): classify the policy conditions that cannot behave the way they read" -- extension/contract
```

---

## Task 3: Read the policies

**Files:**
- Create: `extension/contract/handlers_policies.go`, `extension/contract/handlers_policies_test.go`
- Modify: `contract.go`, `manifest.yaml`, `authz.go`, the three guard tests

**Interfaces:**
- Consumes: Task 2's `analysePolicy`, `PolicySubject`, `PolicyCondition`, `ConditionProblem`, `ConditionReason`; `PageRequest`, `PageMeta`, `newPageMeta`.
- Produces, for Tasks 4 to 8: `PolicySummary`, `PolicyDetail`, `PolicyConditionView`, `PoliciesListInput`, `PoliciesListResponse`, `PolicyDetailInput`, `parsePolicyID`, `projectPolicySummary`, `projectPolicyDetail`.

- [ ] **Step 1: Write the DTOs and projection**

```go
// PolicySummary is one row of the policies list.
//
// State, FailsClosed, NeverApplies and MatchesEverything are computed by
// analysePolicy, because the stored fields do not say them and a page that
// guessed would guess wrong: an allow whose condition throws looks exactly
// like a working allow.
type PolicySummary struct {
	ID                string `json:"id"`
	NamespacePath     string `json:"namespacePath"`
	Name              string `json:"name"`
	Description       string `json:"description,omitempty"`
	Effect            string `json:"effect"`
	Priority          int    `json:"priority"`
	IsActive          bool   `json:"isActive"`
	State             string `json:"state"`
	FailsClosed       bool   `json:"failsClosed"`
	NeverApplies      bool   `json:"neverApplies"`
	MatchesEverything bool   `json:"matchesEverything"`
	Version           int    `json:"version"`
	UpdatedAt         string `json:"updatedAt"`
}

// PolicyConditionView is a stored condition plus what it will do.
type PolicyConditionView struct {
	PolicyCondition
	Problem string `json:"problem,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// PolicyDetail is one policy, everything the rule block renders.
type PolicyDetail struct {
	PolicySummary
	Subjects              []PolicySubject       `json:"subjects"`
	Actions               []string              `json:"actions"`
	Resources             []string              `json:"resources"`
	Conditions            []PolicyConditionView `json:"conditions"`
	Obligations           []string              `json:"obligations"`
	NotBefore             string                `json:"notBefore,omitempty"`
	NotAfter              string                `json:"notAfter,omitempty"`
	SubjectsUnrestricted  bool                  `json:"subjectsUnrestricted"`
	ActionsUnrestricted   bool                  `json:"actionsUnrestricted"`
	ResourcesUnrestricted bool                  `json:"resourcesUnrestricted"`
	HasRoleMatcher        bool                  `json:"hasRoleMatcher"`
	// DecidingCondition is the index of the condition that makes the
	// policy fail closed or never apply. Absent when neither.
	DecidingCondition *int   `json:"decidingCondition,omitempty"`
	CreatedBy         string `json:"createdBy,omitempty"`
	UpdatedBy         string `json:"updatedBy,omitempty"`
	CreatedAt         string `json:"createdAt"`
}
```

Every slice in `PolicyDetail` is initialised non-nil so the JSON carries `[]`, never `null`. Times render as RFC3339 in UTC. `PoliciesListInput` embeds `PageRequest` and carries `NamespacePath *string`, `Effect string`, `IsActive *bool`, `Search string`, mapped straight onto `policy.ListFilter`. `PolicyDetailInput` is `{ id }`.

`parsePolicyID(raw)` returns `badRequest("not a policy id: " + raw)` on failure, following `parseRoleID`.

- [ ] **Step 2: Write the tests**

- The list pages (5 rows, limit 2: pages of 2, 2, 1; `total` 5 on every page) and asserts every filter reaches the store: `namespacePath` nil, `""` and a path; `effect`; `isActive` true and false; `search`. Assert `total` equals the filtered count, so a count that ignores the filter fails.
- The list is tenant-scoped, asserted by identity (another tenant's policy never appears), not by count.
- Each list row's `state`, `failsClosed`, `neverApplies` and `matchesEverything` match `analysePolicy` for a seeded policy of each kind: active, inactive, scheduled, expired, never, fail-closed deny, never-applies allow, matches-everything.
- The detail carries every field, `[]` for empty lists (assert the JSON contains `"subjects":[]`), per-condition `problem` and `reason`, and `decidingCondition` only when set.
- Detail of another tenant's policy is NOT_FOUND.

- [ ] **Step 3: Implement the two handlers, register, and guard**

Both open with `requireEngine` then `tenantFrom`. The list uses one `policy.ListFilter` for both `ListPolicies` and `CountPolicies`. Analysis runs with `time.Now()`.

`manifest.yaml`:

```yaml
  - { name: policies.list,   kind: query, version: 1, requires: { warden: warden.engine }, capability: read }
  - { name: policies.detail, kind: query, version: 1, requires: { warden: warden.engine }, capability: read }
```

plus `policyList` and `policyDetail` query entries at `staleTime: 30s`. Authz `read` on `warden:policy`. All three guards.

- [ ] **Step 4: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go vet ./extension/contract && go test ./...
```

```bash
git add extension/contract/handlers_policies.go extension/contract/handlers_policies_test.go
git commit -m "feat(contract): list and read policies with what each will actually do" -- extension/contract
```

---

## Task 4: Write the policies

**Files:**
- Modify: `extension/contract/handlers_policies.go`, `extension/contract/handlers_policies_test.go`, `contract.go`, `manifest.yaml`, `authz.go`, the three guard tests

**Interfaces:**
- Consumes: Task 2's `collectPolicyIssues`, `draftParts`, `allParts`, `issuesError`, `toPolicyConditions`; Task 3's `parsePolicyID`.
- Produces: `PolicyCreateInput`, `PolicyUpdateInput`, `PolicySetActiveInput`, `PolicyDeleteInput`, and four command handlers.

- [ ] **Step 1: The inputs**

```go
// PolicyCreateInput creates a policy. It is always stored INACTIVE: a new
// policy with no matchers matches every check in its namespace and below,
// so storing it active would make an empty allow grant everything, or an
// empty deny lock everyone out, the moment it is saved. Activation is an
// explicit policies.setActive. The REST create honours isActive; this
// contract deliberately does not.
type PolicyCreateInput struct {
	PolicyDraft
	NamespacePath string `json:"namespacePath,omitempty"`
}

// PolicyUpdateInput patches a policy. Namespace is not patchable. An empty
// string on NotBefore or NotAfter clears that bound.
type PolicyUpdateInput struct {
	ID          string             `json:"id"`
	Name        *string            `json:"name,omitempty"`
	Description *string            `json:"description,omitempty"`
	Effect      *string            `json:"effect,omitempty"`
	Priority    *int               `json:"priority,omitempty"`
	NotBefore   *string            `json:"notBefore,omitempty"`
	NotAfter    *string            `json:"notAfter,omitempty"`
	Subjects    *[]PolicySubject   `json:"subjects,omitempty"`
	Actions     *[]string          `json:"actions,omitempty"`
	Resources   *[]string          `json:"resources,omitempty"`
	Conditions  *[]PolicyCondition `json:"conditions,omitempty"`
	Obligations *[]string          `json:"obligations,omitempty"`
}

type PolicySetActiveInput struct {
	ID     string `json:"id"`
	Active bool   `json:"active"`
}

type PolicyDeleteInput struct {
	ID string `json:"id"`
}
```

- [ ] **Step 2: Write the tests first**

Each create or update test reads the stored policy back with `GetPolicy` and asserts every field.
- **Create stores inactive even when the input would make it active**, and with `Version: 1`, a fresh id for every condition, trimmed fields, and `CreatedBy` from the principal.
- Create refuses each draft issue with BAD_REQUEST whose `Details` carries `fields` and `conditions`; assert the index of a bad condition at position 2. Nothing is stored.
- Create refuses a duplicate name in the same namespace with CONFLICT; the same name in another namespace succeeds.
- Create refuses an invalid namespace.
- Update patches only present fields and leaves the rest byte-identical. Bumps `Version` by 1, as REST does.
- Update validates only the parts it changes: a policy stored with a throwing condition (write it directly through the store) can have its description updated; updating its conditions to another bad set is refused and leaves the stored conditions unchanged.
- Update with `notBefore` alone is checked against the stored `notAfter`, so a start after the stored end is refused.
- `conditions: []` clears; absent leaves alone.
- setActive toggles `IsActive`, bumps `Version`, and changes nothing else.
- Delete removes it; deleting another tenant's policy is NOT_FOUND.
- Each command emits its typed hook and an audit event. For update and delete, the audit `before` is the stored policy. A refused write emits nothing.

- [ ] **Step 3: Implement**

Create returns `AckResponse{ID: <new policy id>}`, which Task 6 navigates to; update, setActive and delete return `AckResponse{}`.

Create: `validateNamespace`, `collectPolicyIssues(in.PolicyDraft, allParts)`, `issuesError`; build the `policy.Policy` with `IsActive: false`, `Version: 1`, `Effect` as sent, times parsed, `toPolicyConditions`, trimmed lists, `CreatedBy` from `withActor`'s context; `CreatePolicy`; `EmitPolicyCreated` and `emitAudit(..., "policy.created", ...)`. Read `api/policy_handler.go` for the exact audit action names REST uses and match them.

Update: `GetPolicy` (NOT_FOUND for another tenant); build the merged draft and the `draftParts` of what is present, where `window` is present if either bound is; `collectPolicyIssues` on the merged draft; apply the present fields to a copy; `Version++`; `UpdatePolicy`; `EmitPolicyUpdated` and audit with `before`. **Read-patch-write only**: `UpdatePolicy` persists the whole struct.

setActive: read, set, `Version++`, `UpdatePolicy`, emit updated and audit.

Delete: read first (for NOT_FOUND and the audit `before`), `DeletePolicy`, `EmitPolicyDeleted(ctx, id)`, audit.

Manifest:

```yaml
  - { name: policies.create, kind: command, version: 1, requires: { warden: warden.engine }, capability: write,
      invalidates: [policies.list, overview.stats, namespaces.list] }
  - { name: policies.update, kind: command, version: 1, requires: { warden: warden.engine }, capability: write,
      invalidates: [policies.list, policies.detail] }
  - { name: policies.setActive, kind: command, version: 1, requires: { warden: warden.engine }, capability: write,
      invalidates: [policies.list, policies.detail] }
  - { name: policies.delete, kind: command, version: 1, requires: { warden: warden.engine }, capability: write,
      invalidates: [policies.list, policies.detail, overview.stats, namespaces.list] }
```

Authz `manage` on `warden:policy` for all four. All three guards. Add `policies.create` and `policies.delete` to `TestManifest_EveryCommandThatFeedsTheNamespaceListRefreshesIt`'s list.

- [ ] **Step 4: Run and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go vet ./extension/contract && go test ./...
```

```bash
git commit -m "feat(contract): write policies, stored inactive and validated" -- extension/contract
```

---

## Task 5: The fixture

**Files:**
- Modify: `packages/fixture-server/warden-fixtures.mjs` only. Do not commit `server.mjs`.

**Interfaces:**
- Consumes: the committed Go DTOs, json tag by json tag, from Tasks 2 to 4.
- Produces: seven handlers.

- [ ] **Step 1: Mirror the analysis and validation**

Port `classifyCondition`, `policyState`, `analysePolicy` and `collectPolicyIssues` from the committed Go, not from this plan. The fixture is an independent double of the server: a fixture that forgives what Go refuses hides the bug it exists to expose.

- [ ] **Step 2: Seed one policy for every state the pages render**

An active deny with a two-row condition list and a role matcher; an allow; an inactive policy; a scheduled one; an expired one; a window that ends before it starts; a deny whose first condition is an uncompilable regex (fails closed); an allow with an unknown operator (never applies); a policy whose first certain condition is an `ip_in_cidr` with no valid CIDR (never applies); a policy with all three matcher lists empty; one whose subjects contain an empty matcher; one with a `not_in` given a string; one with obligations and a window.

- [ ] **Step 3: The seven handlers**

`policies.list`, `policies.detail`, `policies.validate`, `policies.create` (stores inactive, whatever the input says), `policies.update`, `policies.setActive`, `policies.delete`. Mirror every refusal and the `details` shape exactly. Refusals reach the browser as BAD_REQUEST with `details` dropped until `server.mjs` registers warden through a `FixtureError` factory, a known gap in another session's file; match the message and details anyway.

- [ ] **Step 4: Verify without touching server.mjs**

Import the module in a throwaway script under your scratchpad and assert, for each seeded state, the list row's flags, plus every refusal. Delete the script. Then commit:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git commit -m "feat(fixture): answer warden's policy intents" -- packages/fixture-server/warden-fixtures.mjs
```

---

## Task 6: The policies list

**Files:**
- Create: `packages/plugin-warden/src/pages/policies.tsx`, `packages/plugin-warden/test/policies.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`, `packages/plugin-warden/test/plugin.test.tsx`

**Interfaces:**
- Consumes: `policies.list`, `policies.create`, `config.detail` (`abacEnabled`); the namespace filter; the harness.
- Produces: `WardenPoliciesPage`, `PolicySummary`, `PoliciesList`.

- [ ] **Step 1: The design**

Columns: name (`font-medium`, links to `/policies/:id`), effect (plain lowercase text, `allow` or `deny`, no colour: the list is a scan and the status column carries the exceptions), status, namespace (`NamespaceCell`), priority, updated (`Timestamp`).

Status by proportion: an active policy shows nothing. Deliberate states take `secondary`: `inactive`, `not yet in effect`, `expired`. Broken states take `destructive`, because they are what an operator came to find: `fails closed`, `never applies`, `never in effect`. `matchesEverything` adds `secondary` `matches every check`. Several can show at once.

Filters in the kit's `FilterBar`: namespace, effect, active, search. Each resets paging.

When `config.detail` reports `abacEnabled: false`, the page leads with an `Alert`: "Policy evaluation is turned off in this deployment, so none of these policies take effect." It is true regardless of any row.

"New policy" opens a dialog collecting name, effect and namespace. Its description says: "It starts inactive, so it takes no effect until you activate it." On success it navigates to the new policy's detail page with the editor open. Before building this, read `packages/plugin/src` and an existing page that navigates after a command (for example `permission-detail.tsx`, which navigates after delete) to learn how a plugin page navigates and whether it can carry a query string. Use `?edit=1` if it can; if it cannot, carry the flag in navigation state and say which you used in your report. Tasks 7 and 8 read the same mechanism.

Route `/policies`; nav in "Authorization" at priority 40 with lucide's `ScrollTextIcon`. Pin it in `plugin.test.tsx`, additively.

- [ ] **Step 2: Tests**

- Each status badge appears for its seeded state and none for an active policy.
- Effect renders as plain text with no badge.
- The ABAC-off alert renders when `abacEnabled` is false, and not otherwise.
- Every filter reaches the wire and resets `offset` to 0; empty filters are absent from the request.
- Caption counts `total` at zero rows; empty state says which kind of empty.
- The create payload is exact (`toEqual` and `Object.keys`): `{ name, effect, namespacePath }` and nothing else.
- The create dialog's refusal renders inside it; its `pending` is tested; `reset()` on open.
- On success the page navigates to the new policy's detail page with the edit flag set, by whichever mechanism Step 1 settled on.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint
```

```bash
git add packages/plugin-warden/src/pages/policies.tsx packages/plugin-warden/test/policies.test.tsx
git commit -m "feat(warden): list policies with what each will actually do" -- packages/plugin-warden
```

---

## Task 7: The policy detail page and its rule block

**Files:**
- Create: `packages/plugin-warden/src/components/policy-rule.tsx`, `packages/plugin-warden/test/policy-rule.test.tsx`
- Create: `packages/plugin-warden/src/pages/policy-detail.tsx`, `packages/plugin-warden/test/policy-detail.test.tsx`
- Modify: `packages/plugin-warden/src/index.tsx`

**Interfaces:**
- Consumes: `policies.detail`, `policies.setActive`, `policies.delete`, `config.detail` (`abacEnabled`, `rbacEnabled`).
- Produces: `PolicyRule` (read mode, `{ policy: PolicyDetail }`), `WardenPolicyDetailPage`, `PolicyDetail`, `PolicyConditionView`, and `conditionNote(problem, reason, field)`, which Task 8 reuses.

- [ ] **Step 1: The rule block**

`PolicyRule` renders the block in the Design section. A CSS grid with a fixed label column and a value column, labels lowercase and muted.

- **Heading:** `Deny` in the destructive text token, `Allow` in the foreground colour. The only colour on the page.
- **subject / action / resource:** chips (`font-mono text-xs`) with a muted `or` between them. Unrestricted reads `anyone`, `any action`, `any resource` in muted plain text, never a chip. A subject list that contains an empty matcher reads `anyone`, with the note "One of its subject matchers is empty, which matches every subject." A subject chip renders its AND-ed parts: `{kind: user, id: u1}` as `user: u1`, `{kind: user}` as `any user`, `{role: editor}` as `role: editor`, `{kind: user, role: editor}` as `user with role editor`.
- **when / and:** one row per condition, the first labelled `when`, the rest `and`. Field and value in monospace, the operator in words: equals, does not equal, in, not in, contains, starts with, ends with, greater than, less than, at least, at most, exists, does not exist, in network, after, before, matches. `exists` and `does not exist` render no value.
- **Per-row notes** from `conditionNote`, rendered under the row:
  - `throws`, `unknownOperator`: "This is not an operator warden knows, so it cannot be evaluated."
  - `throws`, `invalidRegex`: "This pattern does not compile, so it cannot be evaluated."
  - `alwaysTrue`: "This is always true, so it restricts nothing." followed by the reason.
  - `alwaysFalse`: "This is always false." followed by the reason.
  - Reasons: `unresolvableField` "Warden never gives {field} a value.", `notAList` "It needs a list of values, not one.", `emptyList` "The list is empty.", `notANumber` "It compares numbers, and the value is not one.", `noValidCIDR` "None of these parse as a network.", `notATime` "The value is not an RFC3339 time."
- **in effect:** "from X until Y", "from X", or "until Y". Omitted when there is no window.
- **emits:** obligation chips. Omitted when there are none.

- [ ] **Step 2: The page**

`DetailLayout` with the rule block in the main column and a quiet `DescriptionList` in the aside: priority with the help text "Decides which policy is cited when several match, not which one wins.", version, namespace, created by, updated by, created, updated.

**Visual weight tracks real effect.** The rule block is dimmed for `inactive`, `scheduled`, `expired`, `never` and `neverApplies`. It is **never** dimmed for a fail-closed deny.

Above the block, one state line or callout, whichever applies:
- `inactive`: "Inactive. It takes no effect until you activate it." with an Activate action.
- `scheduled`: "Not yet in effect. It starts on {date}."
- `expired`: "No longer in effect. It ended on {date}."
- `never`: "Never in effect. Its end is before its start."
- `failsClosed`: "Condition {n} cannot be evaluated, so warden treats it, and every condition after it, as met." then, when `decidingCondition` is 0, "This deny applies to every check its subjects, actions and resources select." and otherwise "This deny applies whenever the conditions before it hold."
- `neverApplies` from a throw (an allow): "Condition {n} cannot be evaluated, so this allow never grants anything."
- `neverApplies` from an always-false row: "Condition {n} is always false, so this policy never applies."
- `matchesEverything`: "It matches every check in its namespace and below."

The row named by `decidingCondition` is marked in the block.

When `config.detail` reports `abacEnabled: false`, an alert says: "Policy evaluation is turned off in this deployment, so this policy takes no effect." When `rbacEnabled` is false and `hasRoleMatcher`: "Role-based access is turned off, so role subjects never match." When every subject matcher has a role, add "This policy never applies." instead.

**Activate / Deactivate** through `policies.setActive`, in a `ConfirmDialog` with `pending`. Activating a policy that `failsClosed` or `matchesEverything` states in the dialog what activating will do, using the callout's own sentence. **Delete** through `policies.delete`, confirm dialog with `pending`, then navigate to `/policies`.

Route `/policies/:id`, no nav entry. When the URL carries `?edit=1`, open the editor (Task 8) on load; until Task 8 lands, ignore the parameter.

- [ ] **Step 3: Tests**

- Each empty matcher list renders its `any` word and no chip; a subject list with `{}` renders `anyone` with the note; each subject-chip shape renders its text.
- `or` sits between chips; conditions render `when` then `and`; each of the 17 operators renders its word; `exists` renders no value.
- Each `problem`/`reason` pair renders its exact note.
- The heading is destructive for deny and not for allow, and **no other element on the page carries a destructive class** (query by class).
- The block is dimmed for each inert state and **not dimmed for a fail-closed deny**.
- Each callout's exact text, including both fail-closed variants and both never-applies variants, and the deciding row is marked.
- The ABAC-off and RBAC-off alerts render only under their conditions, including the "never applies" variant.
- Activate and deactivate payloads are exact; the confirm dialog for a fail-closed or matches-everything policy contains the callout text; `pending` is tested on both dialogs; delete navigates.
- Mutate before committing, and name the test that catches each: dim a fail-closed deny; render an empty action list as blank; drop the `or` between chips; colour the Allow heading.

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint
```

```bash
git add packages/plugin-warden/src/components/policy-rule.tsx packages/plugin-warden/test/policy-rule.test.tsx packages/plugin-warden/src/pages/policy-detail.tsx packages/plugin-warden/test/policy-detail.test.tsx
git commit -m "feat(warden): render a policy's rule by what it will actually do" -- packages/plugin-warden
```

---

## Task 8: The policy editor

**Files:**
- Create: `packages/plugin-warden/src/components/policy-editor.tsx`, `packages/plugin-warden/test/policy-editor.test.tsx`
- Modify: `packages/plugin-warden/src/pages/policy-detail.tsx`, `packages/plugin-warden/test/policy-detail.test.tsx`

**Interfaces:**
- Consumes: `policies.validate`, `policies.update`; Task 7's `PolicyRule`, `conditionNote` and types.
- Produces: `PolicyEditor`.

- [ ] **Step 1: The editor**

The same block, each clause editable in place. An Edit button on the detail page swaps `PolicyRule` for `PolicyEditor`.

- **Heading:** a two-option toggle, `Allow` / `Deny`.
- **OR rows:** chips with a remove button, plus an input to add one. Subjects add through three small inputs (kind select, id, role), refusing an all-empty matcher client-side with the same sentence the server uses. Removing every chip shows the `any` word, so it is visible that an empty list means everything.
- **Condition rows:** a field input, an operator `NativeSelect` carrying exactly the 17 operators by their words, and a value input whose type follows the operator: a list editor for `in` and `not_in`, one or more CIDRs for `in network`, an RFC3339 datetime for `after` and `before`, a number for the four comparisons, a pattern for `matches`, nothing for `exists` and `does not exist`, text otherwise. Changing the operator clears a value of the wrong type. Numbers are sent as JSON numbers and lists as JSON arrays.
- **in effect:** two datetime inputs, each clearable.
- **emits:** chips.
- **Aside:** name, description and priority are edited here.

As the draft changes, debounced by 400 ms, the editor queries `policies.validate` with the whole draft and marks each field and each condition row from the response, using the server's messages. Rows keep their marks until the draft changes.

**Save** sends `policies.update` with only the parts that differ from the loaded policy, as pointer fields: an untouched part is absent, a cleared list is `[]`, a cleared bound is `""`. On refusal, the form stays open, keeps what was typed, and marks the rows from `details.conditions` and `details.fields`. Cancel restores the read view.

- [ ] **Step 2: Tests**

- The update payload for each part in three states: untouched is absent, changed carries the value, cleared is `[]` or `""`. Assert with `toEqual` and `Object.keys`.
- A number is sent as a number, a list as an array, `exists` with no `value` key.
- Changing an operator from `in` to `greater than` clears a list value.
- A validate response marks the exact rows, by index, including two bad rows at once.
- A refused save marks rows from `details`, keeps the form open, and keeps every typed value.
- Save's `pending` is tested.
- The debounce: several quick edits send one validate request with the final draft (use fake timers).
- Removing every action chip shows `any action`.
- Mutate before committing: send the whole policy on save; send a number as a string; drop the row marking; name the test that catches each.

- [ ] **Step 3: Wire `?edit=1`, verify and commit**

Replace Task 7's placeholder so `?edit=1` opens the editor on load, and test it.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-warden test && pnpm --filter @forge-go/dashboard-plugin-warden typecheck && pnpm --filter @forge-go/dashboard-plugin-warden lint
```

```bash
git add packages/plugin-warden/src/components/policy-editor.tsx packages/plugin-warden/test/policy-editor.test.tsx
git commit -m "feat(warden): edit a policy's rule in place" -- packages/plugin-warden
```

---

## Done when

- The populated round-trip passes on memory, sqlite, postgres and mongo, and the integration log shows zero skips.
- `classifyCondition` agrees with warden's real evaluator for every case in its test.
- `go build ./... && go test ./...` clean in warden; plugin-warden `test`, `typecheck` and `lint` clean.
- Every intent this plan registers has a caller in `packages/plugin-warden/src`.
- A policy cannot be stored with a condition that throws, is always true, or is always false, through the dashboard.
- Every state the analysis computes renders distinctly, and a fail-closed deny is never dimmed.

## Carried forward, and not this plan's to fix

- **Plan 3b, the check log, waits on two decisions:**
  1. **`checkLogs.purge`.** `PurgeCheckLogs(ctx, before)` takes no tenant id, so a tenant-scoped purge cannot be built on it: an operator-chosen cutoff would delete every tenant's audit trail. Either add a tenant-scoped purge to all four stores and the conformance suite, or drop the intent and leave retention to `CheckLogRetention`.
  2. **`QueryFilter`.** The spec recommends adding `Cached *bool` and `HasError *bool` to all four stores and deferring `MatchedRuleID`, and flags it as a decision rather than taken.
- **`maintenance.run` lets any tenant trigger engine-wide maintenance.** It resolves the caller's tenant only to label the audit event, then calls `RunMaintenance`, which purges every tenant's expired assignments and old check logs and flushes the whole cache. Bounded by the configured retention, so it deletes nothing retention would not, but it is a cross-tenant effect from a tenant principal. Plan 1's code. Another session is working on this class ("Stop tenant callers acting on app-level records").
- **Warden follow-ups:** `policy.ValidateCondition` accepts bare `action` and `action.<x>`, which the evaluator never resolves, and its comment claims otherwise; the REST create and update validate nothing; a bad CIDR or time is silently false rather than refused anywhere in core.
- `ListCheckLogs` has no defined order across backends (plan 3b).
- `assignments.expiring` and `permissions.update` still have no caller (plans 2b and 2a).
