# Vault Go Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the service layer Vault advertises but never had, so a contract contributor has something to call.

**Architecture:** Break the import cycle that blocks `vault.Vault` by moving `Entity` and the sentinel errors to a leaf package. Then write the real `vault.New`, which composes the encryptor, the six subsystem services and the audit logger from a store and a config. Add two domain capabilities the dashboard needs (`EvaluateDetail`, `RotatorKeys`) and row counts on all six store interfaces.

**Tech Stack:** Go 1.26, grove ORM (pg/sqlite/mongo drivers v1.6.3), `go.jetify.com/typeid` via `vault/id`, stdlib `testing`.

**Spec:** `docs/superpowers/specs/2026-09-23-vault-dashboard-migration-design.md` (in the `forge-dashboard` repo; this plan's code all lands in `/Users/rexraphael/Work/xraph/forgery/vault`)

**Slice:** This is slice 1 of 6. Slices 2 to 6 (the contract, the React plugin, templ retirement) get their own plans once this one's interfaces land.

## Global Constraints

- All work happens in `/Users/rexraphael/Work/xraph/forgery/vault`. Paths below are relative to that.
- `go build ./... && go test ./...` must pass at the end of every task. Not a partial run.
- `golangci-lint run ./...` must pass. The repo config is `.golangci.yml`.
- No public API may break. `vault.Entity`, `vault.NewEntity` and every `vault.Err*` must keep working for callers outside this repo.
- Domain JSON tags stay snake_case. The contract's camelCase projection is slice 2's job, not this one's.
- Error strings are lowercase and prefixed with the package name, matching the existing style: `fmt.Errorf("vault: ...")`, `fmt.Errorf("rotation: ...")`.
- Commit after every task. Never squash two tasks into one commit.

## Review Focus

Six things the spec implies, that no task's happy-path tests would catch, ordered by how likely they are to bite. Each has its test pinned to the task that owns the code.

1. `New()` with no encryption key configured must return a working Vault that stores plaintext, not a nil-pointer panic on the first `Secrets().Set`. The spec calls this the documented fallback. Test lives in Task 5.
2. `New()` with a key that is present but malformed (wrong length, undecodable) must return an error, never fall back to plaintext. Absent and broken are different, and conflating them stores secrets in the clear while the operator believes otherwise. Test lives in Task 5.
3. `EvaluateDetail` on a disabled flag that also has a tenant override must report `disabled` and must not consult the override, matching `Evaluate`. A trace showing the override being checked would be a lie about what the engine does. Test lives in Task 1.
4. `EvaluateDetail` on an enabled flag with zero rules must return reason `default` with an empty trace and a nil `MatchedRule`, and callers must not deref it. Test lives in Task 1.
5. A secret written while no key was configured must never be presentable as encrypted. `EncryptedValue` holds literal plaintext in that case and `EncryptionAlg` is empty, and because a key added later does not re-encrypt old rows, one app can hold both kinds at once. Test lives in Task 5.
6. `Count*` for an appID with no rows must return `(0, nil)`, never an error and never a driver-specific "no rows" sentinel. Test lives in Task 4.

---

### Task 1: `EvaluateDetail` on the flag engine

**Files:**
- Modify: `flag/engine.go`
- Test: `flag/engine_detail_test.go` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `flag.Detail{Value any, Reason string, MatchedRule *flag.Rule, Trace []flag.TraceStep}`, `flag.TraceStep{Priority int, Type flag.RuleType, Matched bool, Reached bool, Note string}`, the reason constants `flag.ReasonDisabled`, `flag.ReasonTenantOverride`, `flag.ReasonRule`, `flag.ReasonDefault`, and the method `(*flag.Engine).EvaluateDetail(ctx context.Context, key, appID string) (Detail, error)`. Slice 2's `flags.evaluate` handler projects `Detail` onto the wire.

**Design note the implementer must not get wrong:** `Evaluate` does NOT simply call `EvaluateDetail`. `Evaluate` is the hot path used by every SDK flag read and it keeps its 30 second cache; `EvaluateDetail` always bypasses the cache because it exists to debug. Both delegate to one unexported `evaluate` that holds the precedence, which is the actual "precedence lives in one place" the spec asks for. If `Evaluate` delegated to `EvaluateDetail` directly, every flag read in every application would lose its cache and hit the store.

- [ ] **Step 1: Write the failing tests**

Create `flag/engine_detail_test.go`:

```go
package flag_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/xraph/vault/flag"
	"github.com/xraph/vault/store/memory"
)

// setRules is a local helper; engine_test.go's helpers are in the same
// package so defineFlag/bg/withTenant are already available.
func setRules(t *testing.T, s *memory.Store, key string, rules ...*flag.Rule) {
	t.Helper()
	for _, r := range rules {
		r.FlagKey = key
		r.AppID = testApp
	}
	if err := s.SetFlagRules(bg(), key, testApp, rules); err != nil {
		t.Fatalf("SetFlagRules(%q): %v", key, err)
	}
}

func TestDetailReasonDefaultNoRules(t *testing.T) {
	s := memory.New()
	defineFlag(t, s, "f", false, true)
	e := flag.NewEngine(s)

	d, err := e.EvaluateDetail(bg(), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if d.Reason != flag.ReasonDefault {
		t.Errorf("reason: got %q, want %q", d.Reason, flag.ReasonDefault)
	}
	if d.Value != false {
		t.Errorf("value: got %v, want false", d.Value)
	}
	if d.MatchedRule != nil {
		t.Errorf("MatchedRule: got %v, want nil", d.MatchedRule)
	}
	if len(d.Trace) != 0 {
		t.Errorf("trace: got %d steps, want 0", len(d.Trace))
	}
}

func TestDetailReasonDisabledIgnoresTenantOverride(t *testing.T) {
	s := memory.New()
	defineFlag(t, s, "f", false, false) // disabled, default false
	if err := s.SetFlagTenantOverride(bg(), "f", testApp, "t-1", true); err != nil {
		t.Fatal(err)
	}
	e := flag.NewEngine(s)

	d, err := e.EvaluateDetail(withTenant("t-1"), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if d.Reason != flag.ReasonDisabled {
		t.Errorf("reason: got %q, want %q", d.Reason, flag.ReasonDisabled)
	}
	if d.Value != false {
		t.Errorf("value: got %v, want false (the default, not the override)", d.Value)
	}
	if len(d.Trace) != 0 {
		t.Errorf("trace: got %d steps, want 0; a disabled flag consults nothing", len(d.Trace))
	}
}

func TestDetailReasonTenantOverride(t *testing.T) {
	s := memory.New()
	defineFlag(t, s, "f", false, true)
	if err := s.SetFlagTenantOverride(bg(), "f", testApp, "t-1", true); err != nil {
		t.Fatal(err)
	}
	e := flag.NewEngine(s)

	d, err := e.EvaluateDetail(withTenant("t-1"), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if d.Reason != flag.ReasonTenantOverride {
		t.Errorf("reason: got %q, want %q", d.Reason, flag.ReasonTenantOverride)
	}
	if d.Value != true {
		t.Errorf("value: got %v, want true", d.Value)
	}
}

func TestDetailReasonRuleMarksLaterRulesUnreached(t *testing.T) {
	s := memory.New()
	defineFlag(t, s, "f", false, true)
	// WhenTenant and Rollout already assign Entity and ID.
	first := flag.WhenTenant("t-1").Return(true)
	first.Priority = 0
	second := flag.Rollout(100).Return(true)
	second.Priority = 1
	setRules(t, s, "f", first, second)
	e := flag.NewEngine(s)

	d, err := e.EvaluateDetail(withTenant("t-1"), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if d.Reason != flag.ReasonRule {
		t.Fatalf("reason: got %q, want %q", d.Reason, flag.ReasonRule)
	}
	if d.MatchedRule == nil || d.MatchedRule.Type != flag.RuleWhenTenant {
		t.Fatalf("MatchedRule: got %v, want the when_tenant rule", d.MatchedRule)
	}
	if len(d.Trace) != 2 {
		t.Fatalf("trace: got %d steps, want 2", len(d.Trace))
	}
	if !d.Trace[0].Reached || !d.Trace[0].Matched {
		t.Errorf("trace[0]: got reached=%v matched=%v, want both true", d.Trace[0].Reached, d.Trace[0].Matched)
	}
	if d.Trace[1].Reached {
		t.Errorf("trace[1]: got reached=true, want false; the engine stopped at the first match")
	}
}

func TestDetailRolloutNoteReportsBucket(t *testing.T) {
	s := memory.New()
	defineFlag(t, s, "f", false, true)
	r := flag.Rollout(0).Return(true) // 0% so it never matches and we reach the note
	r.Priority = 0
	setRules(t, s, "f", r)
	e := flag.NewEngine(s)

	d, err := e.EvaluateDetail(withTenant("t-acme"), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Trace) != 1 {
		t.Fatalf("trace: got %d steps, want 1", len(d.Trace))
	}
	// The note must quote the same bucket the verdict used, so the page
	// cannot disagree with the engine.
	want := "bucket " + itoa(int(flag.RolloutBucket("t-acme", "f"))) + " of 100, threshold 0"
	if d.Trace[0].Note != want {
		t.Errorf("note: got %q, want %q", d.Trace[0].Note, want)
	}
}

func TestDetailBypassesCacheWhileEvaluateUsesIt(t *testing.T) {
	s := memory.New()
	defineFlag(t, s, "f", false, true)
	e := flag.NewEngine(s, flag.WithCacheTTL(time.Hour))

	// Prime the cache through the hot path.
	if _, err := e.Evaluate(bg(), "f", testApp); err != nil {
		t.Fatal(err)
	}
	// Change the default underneath it.
	defineFlag(t, s, "f", true, true)

	cached, err := e.Evaluate(bg(), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if cached != false {
		t.Errorf("Evaluate: got %v, want false (still cached)", cached)
	}

	d, err := e.EvaluateDetail(bg(), "f", testApp)
	if err != nil {
		t.Fatal(err)
	}
	if d.Value != true {
		t.Errorf("EvaluateDetail: got %v, want true (cache bypassed)", d.Value)
	}
}

func itoa(i int) string { return strconv.Itoa(i) }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./flag/ -run 'TestDetail' -v`
Expected: FAIL to compile, with `e.EvaluateDetail undefined`, `flag.ReasonDefault undefined`, `flag.RolloutBucket undefined`.

- [ ] **Step 3: Add the types and the reason constants**

In `flag/engine.go`, after the `ContextKey` block:

```go
// Reasons a flag evaluated the way it did. These are the four outcomes
// the engine can reach, in the order it reaches them.
const (
	ReasonDisabled       = "disabled"
	ReasonTenantOverride = "tenantOverride"
	ReasonRule           = "rule"
	ReasonDefault        = "default"
)

// TraceStep records one targeting rule the engine considered.
// Reached is false for rules after the one that matched: the engine stops
// at the first match, and a trace that hid that would misreport precedence.
type TraceStep struct {
	Priority int      `json:"priority"`
	Type     RuleType `json:"type"`
	Matched  bool     `json:"matched"`
	Reached  bool     `json:"reached"`
	Note     string   `json:"note,omitempty"`
}

// Detail is an explained evaluation: the value, why it was chosen, the rule
// that chose it when one did, and every rule considered on the way.
// MatchedRule is nil unless Reason is ReasonRule.
type Detail struct {
	Value       any         `json:"value"`
	Reason      string      `json:"reason"`
	MatchedRule *Rule       `json:"matched_rule,omitempty"`
	Trace       []TraceStep `json:"trace"`
}
```

- [ ] **Step 4: Extract the rollout bucket so the note cannot drift from the verdict**

In `flag/engine.go`, add the exported helper and rewrite `evalRollout` to use it:

```go
// RolloutBucket returns the deterministic 0-99 bucket a tenant falls into for
// a flag. A rollout rule matches when the bucket is below its percentage.
// Exported so an explained evaluation can report the same number the verdict
// used; two copies of this arithmetic would eventually disagree.
func RolloutBucket(tenantID, flagKey string) uint32 {
	hash := sha256.Sum256([]byte(tenantID + ":" + flagKey))
	return binary.BigEndian.Uint32(hash[:4]) % 100
}

// evalRollout uses a deterministic hash of (tenantID + flagKey) to decide.
func (e *Engine) evalRollout(rule *Rule, flagKey, tenantID string) bool {
	if tenantID == "" {
		return false
	}
	pct := rule.Config.Percentage
	if pct <= 0 {
		return false
	}
	if pct >= 100 {
		return true
	}
	return RolloutBucket(tenantID, flagKey) < uint32(pct)
}
```

- [ ] **Step 5: Add the shared core and rewrite the two entry points**

Replace the existing `Evaluate` in `flag/engine.go` with these three functions:

```go
// Evaluate returns the value for a flag key and app ID.
// Evaluation order: disabled -> tenant override -> rules (by priority) -> default.
//
// This is the hot path every SDK flag read goes through, so it keeps the
// evaluation cache. EvaluateDetail deliberately does not.
func (e *Engine) Evaluate(ctx context.Context, key, appID string) (any, error) {
	tenantID := contextString(ctx, ContextKeyTenantID)

	if e.cache != nil {
		if val, ok := e.cache.get(key, tenantID); ok {
			return val, nil
		}
	}

	d, err := e.evaluate(ctx, key, appID, false)
	if err != nil {
		return nil, err
	}
	// A disabled flag was never cached before, and still is not: flipping
	// Enabled must take effect immediately rather than after the TTL.
	if d.Reason != ReasonDisabled {
		e.cacheSet(key, tenantID, d.Value)
	}
	return d.Value, nil
}

// EvaluateDetail returns the value together with why it was chosen and every
// rule considered. It always bypasses the evaluation cache, because it exists
// to answer "why is this tenant seeing this right now" and a cached answer is
// the wrong answer to that question.
func (e *Engine) EvaluateDetail(ctx context.Context, key, appID string) (Detail, error) {
	return e.evaluate(ctx, key, appID, true)
}

// evaluate holds the precedence. Both entry points go through it so the
// explained path and the hot path can never disagree about the order.
func (e *Engine) evaluate(ctx context.Context, key, appID string, withTrace bool) (Detail, error) {
	tenantID := contextString(ctx, ContextKeyTenantID)
	userID := contextString(ctx, ContextKeyUserID)

	def, err := e.store.GetFlagDefinition(ctx, key, appID)
	if err != nil {
		return Detail{}, err
	}

	// Disabled: the default, and nothing below is consulted at all.
	if !def.Enabled {
		return Detail{Value: def.DefaultValue, Reason: ReasonDisabled}, nil
	}

	if tenantID != "" {
		overrideVal, oErr := e.store.GetFlagTenantOverride(ctx, key, appID, tenantID)
		if oErr == nil {
			return Detail{Value: overrideVal, Reason: ReasonTenantOverride}, nil
		}
		if !errors.Is(oErr, vault.ErrOverrideNotFound) {
			return Detail{}, oErr
		}
	}

	rules, err := e.store.GetFlagRules(ctx, key, appID)
	if err != nil {
		return Detail{}, err
	}

	var trace []TraceStep
	if withTrace {
		trace = make([]TraceStep, 0, len(rules))
	}

	for i, rule := range rules {
		matched := e.evaluateRule(rule, key, tenantID, userID)
		if withTrace {
			trace = append(trace, TraceStep{
				Priority: rule.Priority,
				Type:     rule.Type,
				Matched:  matched,
				Reached:  true,
				Note:     ruleNote(rule, key, tenantID, userID),
			})
		}
		if !matched {
			continue
		}
		if withTrace {
			for _, rest := range rules[i+1:] {
				trace = append(trace, TraceStep{
					Priority: rest.Priority,
					Type:     rest.Type,
					Reached:  false,
				})
			}
		}
		return Detail{Value: rule.ReturnValue, Reason: ReasonRule, MatchedRule: rule, Trace: trace}, nil
	}

	return Detail{Value: def.DefaultValue, Reason: ReasonDefault, Trace: trace}, nil
}

// ruleNote explains one rule's verdict in a line an operator can act on.
// It never re-derives a verdict: the rollout case calls the same
// RolloutBucket the evaluator used.
func ruleNote(rule *Rule, flagKey, tenantID, userID string) string {
	switch rule.Type {
	case RuleWhenTenant:
		if tenantID == "" {
			return "no tenant in context"
		}
		return "tenant " + tenantID
	case RuleWhenUser:
		if userID == "" {
			return "no user in context"
		}
		return "user " + userID
	case RuleRollout:
		if tenantID == "" {
			return "no tenant in context, a rollout cannot match"
		}
		return fmt.Sprintf("bucket %d of 100, threshold %d",
			RolloutBucket(tenantID, flagKey), rule.Config.Percentage)
	case RuleSchedule:
		now := time.Now().UTC()
		if rule.Config.StartAt != nil && now.Before(*rule.Config.StartAt) {
			return "the window has not started"
		}
		if rule.Config.EndAt != nil && now.After(*rule.Config.EndAt) {
			return "the window has ended"
		}
		return "inside the window"
	case RuleWhenTenantTag, RuleCustom:
		return "this rule type is not implemented and never matches"
	default:
		return ""
	}
}
```

Add `"fmt"` to `flag/engine.go`'s imports.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `go test ./flag/ -v`
Expected: PASS, including every pre-existing test in `engine_test.go` and `cache_test.go`. The cache tests are the ones that prove `Evaluate` kept its behaviour.

- [ ] **Step 7: Run the full build and suite**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add flag/engine.go flag/engine_detail_test.go
git commit -m "feat(flag): explain an evaluation with EvaluateDetail

Evaluate returned a bare value, so nothing could answer why a flag came
out the way it did for one tenant. EvaluateDetail returns the value with
a reason, the rule that matched, and every rule considered including the
ones the engine never reached.

Both entry points now go through one unexported evaluate, so the
explained path and the hot path cannot disagree about precedence.
Evaluate keeps its cache because every SDK flag read goes through it.
EvaluateDetail always bypasses the cache, since a cached answer is the
wrong answer to a debugging question.

RolloutBucket is exported so a trace can quote the same bucket the
verdict used instead of recomputing it."
```

---

### Task 2: `RotatorKeys` on the rotation manager

**Files:**
- Modify: `rotation/manager.go`
- Test: `rotation/manager_test.go:1` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `(*rotation.Manager).RotatorKeys() []string`, sorted. Slice 2's `rotation.policies` handler uses it to set `rotatable` per row.

- [ ] **Step 1: Write the failing test**

Append to `rotation/manager_test.go`:

```go
func TestRotatorKeysListsRegisteredRotatorsSorted(t *testing.T) {
	s := memory.New()
	m := rotation.NewManager(s, nil)

	if got := m.RotatorKeys(); len(got) != 0 {
		t.Errorf("with nothing registered: got %v, want empty", got)
	}

	noop := func(_ context.Context, cur []byte) ([]byte, error) { return cur, nil }
	m.RegisterRotator("zeta", noop)
	m.RegisterRotator("alpha", noop)

	got := m.RotatorKeys()
	want := []string{"alpha", "zeta"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v (sorted)", got, want)
		}
	}
}
```

`rotation/manager_test.go` already imports `context` and `store/memory` and already declares `testApp`, so this test needs no new imports and must not redeclare that constant.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./rotation/ -run TestRotatorKeys -v`
Expected: FAIL to compile, with `m.RotatorKeys undefined`.

- [ ] **Step 3: Implement it**

In `rotation/manager.go`, after `RegisterRotator`:

```go
// RotatorKeys returns the secret keys that have a registered rotator, sorted.
//
// RotateNow fails for any key not in this list, because a rotator is Go code
// an application registers and nothing outside the process can supply one. A
// caller that offers rotation as an action should gate on this rather than
// offering a button that always fails.
func (m *Manager) RotatorKeys() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	keys := make([]string, 0, len(m.rotators))
	for k := range m.rotators {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
```

Add `"sort"` to `rotation/manager.go`'s imports.

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./rotation/ -v`
Expected: PASS.

- [ ] **Step 5: Run the full build and suite**

Run: `go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add rotation/manager.go rotation/manager_test.go
git commit -m "feat(rotation): expose which secrets have a registered rotator

RotateNow fails with 'no rotator registered' unless an application
called RegisterRotator for that key in Go. The registry was an
unexported map with no accessor, so a dashboard could not tell an
executable policy from one that will always fail.

RotatorKeys returns the registered keys sorted, so a caller can gate the
action instead of offering it everywhere."
```

---

### Task 3: Move `Entity` and the errors to `vault/core`

**Files:**
- Create: `core/entity.go`, `core/errors.go`, `core/doc.go`
- Delete: `entity.go`, `errors.go`
- Create: `aliases.go`
- Modify: `secret/secret.go`, `secret/service.go`, `flag/engine.go`, `flag/definition.go`, `flag/rule.go`, `config/entry.go`, `config/service.go`, `override/override.go`, `override/resolver.go`, `rotation/policy.go`
- Test: `aliases_test.go` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks. Task 1 edited `flag/engine.go` and this task edits it again; do Task 1 first.
- Produces: package `github.com/xraph/vault/core` exporting `Entity`, `NewEntity()` and every `Err*` sentinel. Root `vault` keeps exporting all of them as aliases. Task 5 depends on this task: without it, `vault.go` cannot import the subsystem packages.

**Why:** package `vault` cannot import `secret`, `flag`, `config`, `override` or `rotation`, because all five import `vault`. Four symbols are the whole entanglement. Moving them to a leaf package lets root `vault` import everything, which is what `vault.New` needs.

- [ ] **Step 1: Write the failing test**

Create `aliases_test.go`:

```go
package vault_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/xraph/vault"
	"github.com/xraph/vault/core"
	"github.com/xraph/vault/secret"
)

// The alias must be a true alias, not a defined type: external callers embed
// vault.Entity and pass it where core.Entity is expected, and a defined type
// would break both.
func TestEntityAliasIsIdentical(t *testing.T) {
	var fromRoot vault.Entity = core.NewEntity()
	var fromCore core.Entity = vault.NewEntity()
	_ = fromRoot
	_ = fromCore

	// Embedding through the alias still promotes the fields.
	s := secret.Secret{Entity: vault.NewEntity(), Key: "k"}
	if s.CreatedAt.IsZero() {
		t.Error("CreatedAt is zero; NewEntity did not populate through the alias")
	}
}

// The sentinels must be the same values, or errors.Is stops matching for
// every caller that wrapped the old ones.
func TestErrorSentinelsAreTheSameValues(t *testing.T) {
	cases := []struct {
		name       string
		root, leaf error
	}{
		{"ErrSecretNotFound", vault.ErrSecretNotFound, core.ErrSecretNotFound},
		{"ErrOverrideNotFound", vault.ErrOverrideNotFound, core.ErrOverrideNotFound},
		{"ErrFlagNotFound", vault.ErrFlagNotFound, core.ErrFlagNotFound},
		{"ErrConfigNotFound", vault.ErrConfigNotFound, core.ErrConfigNotFound},
	}
	for _, tc := range cases {
		if tc.root != tc.leaf {
			t.Errorf("%s: root and core are different values", tc.name)
		}
		wrapped := fmt.Errorf("wrapped: %w", tc.leaf)
		if !errors.Is(wrapped, tc.root) {
			t.Errorf("%s: errors.Is failed against the root alias", tc.name)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test . -run 'TestEntityAlias|TestErrorSentinels' -v`
Expected: FAIL to compile, with `no required module provides package github.com/xraph/vault/core`.

- [ ] **Step 3: Create the leaf package**

Create `core/doc.go`:

```go
// Package core holds the types every Vault subsystem needs and that none of
// them may reach the root package for.
//
// The subsystem packages (secret, flag, config, override, rotation) embed
// Entity and compare against the sentinel errors. If those lived in the root
// package, the root could not import the subsystems, and the composed Vault
// in vault.go could not exist. This package is a leaf: it imports nothing
// from Vault.
//
// The root package re-exports everything here, so vault.Entity and
// vault.ErrSecretNotFound continue to work unchanged.
package core
```

Create `core/entity.go` with the exact contents of the current `entity.go`, changing only the package clause from `package vault` to `package core`.

Create `core/errors.go` with the exact contents of the current `errors.go`, changing only the package clause from `package vault` to `package core`.

- [ ] **Step 4: Delete the originals and add the aliases**

```bash
git rm entity.go errors.go
```

Create `aliases.go`:

```go
package vault

import "github.com/xraph/vault/core"

// Entity is the base type embedded by all Vault entities.
//
// This is a type alias, not a defined type: callers embed vault.Entity and
// pass it where core.Entity is expected, and both must keep working.
type Entity = core.Entity

// NewEntity creates a new Entity with both timestamps set to now (UTC).
func NewEntity() Entity { return core.NewEntity() }

// Sentinel errors for Vault operations.
//
// These are the same values as their core counterparts, not copies, so
// errors.Is keeps matching for every caller that wrapped one.
var (
	// Store errors.
	ErrNoStore = core.ErrNoStore

	// Key/entity not found errors.
	ErrKeyNotFound      = core.ErrKeyNotFound
	ErrSecretNotFound   = core.ErrSecretNotFound
	ErrFlagNotFound     = core.ErrFlagNotFound
	ErrConfigNotFound   = core.ErrConfigNotFound
	ErrOverrideNotFound = core.ErrOverrideNotFound
	ErrRotationNotFound = core.ErrRotationNotFound
	ErrAuditNotFound    = core.ErrAuditNotFound
	ErrRunNotFound      = core.ErrRunNotFound
	ErrDLQNotFound      = core.ErrDLQNotFound
	ErrCronNotFound     = core.ErrCronNotFound
	ErrEventNotFound    = core.ErrEventNotFound
	ErrWorkflowNotFound = core.ErrWorkflowNotFound

	// Crypto errors.
	ErrDecryptionFailed = core.ErrDecryptionFailed
	ErrEncryptionFailed = core.ErrEncryptionFailed
	ErrInvalidKey       = core.ErrInvalidKey

	// Feature flag errors.
	ErrFlagDisabled   = core.ErrFlagDisabled
	ErrFlagExists     = core.ErrFlagExists
	ErrInvalidFlagKey = core.ErrInvalidFlagKey

	// Rotation errors.
	ErrRotationFailed = core.ErrRotationFailed

	// Auth errors.
	ErrUnauthorized = core.ErrUnauthorized

	// Secret errors.
	ErrSecretExists = core.ErrSecretExists

	// Config errors.
	ErrConfigExists = core.ErrConfigExists
)
```

- [ ] **Step 5: Repoint the five subsystem packages**

In each of these ten files, change the import `"github.com/xraph/vault"` to `"github.com/xraph/vault/core"` and rewrite the four symbol references:

- `secret/secret.go`: `vault.Entity` becomes `core.Entity`.
- `secret/service.go`: `vault.NewEntity()` becomes `core.NewEntity()`.
- `flag/definition.go`: `vault.Entity` becomes `core.Entity`.
- `flag/rule.go`: `vault.Entity` becomes `core.Entity`, `vault.NewEntity()` becomes `core.NewEntity()`.
- `flag/engine.go`: `vault.ErrOverrideNotFound` becomes `core.ErrOverrideNotFound`.
- `config/entry.go`: `vault.Entity` becomes `core.Entity`.
- `config/service.go`: `vault.NewEntity()` becomes `core.NewEntity()`.
- `override/override.go`: `vault.Entity` becomes `core.Entity`.
- `override/resolver.go`: `vault.ErrOverrideNotFound` becomes `core.ErrOverrideNotFound`.
- `rotation/policy.go`: `vault.Entity` becomes `core.Entity`.

Then confirm nothing was missed:

```bash
grep -rn '"github.com/xraph/vault"$' secret/ flag/ config/ override/ rotation/ --include='*.go' | grep -v _test
```

Expected: no output. Test files may still import the root package, and should: they are exercising the public surface.

The four store backends and `store/store.go` import the subsystem packages and the root package. They keep importing the root package and need no change, because `vault.ErrSecretNotFound` still resolves. Confirm with the build in step 6.

- [ ] **Step 6: Run the test and the full suite**

Run: `go build ./... && go test ./...`
Expected: PASS. Every existing test, including `store/memory/store_test.go` and `store/postgres/store_test.go`, must pass untouched. That they compile against the root package unchanged is the proof the aliases hold.

- [ ] **Step 7: Run the linter**

Run: `golangci-lint run ./...`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add core/ aliases.go aliases_test.go secret/ flag/ config/ override/ rotation/
git add -u
git commit -m "refactor: move Entity and the sentinel errors to vault/core

Package vault could not import secret, flag, config, override or
rotation, because all five import vault. That cycle is why vault.go was
never written and why the Vault type is still a stub in options.go.

Four symbols were the whole entanglement: Entity, NewEntity,
ErrSecretNotFound and ErrOverrideNotFound. entity.go and errors.go move
to a new leaf package and the subsystems import that instead.

The root package re-exports all of it. Entity is a type alias so embeds
and composite literals are unchanged, and the sentinels are the same
values so errors.Is still matches. No caller inside or outside this repo
has to change, which the store tests demonstrate by passing untouched."
```

---

### Task 4: Row counts on the six store interfaces

**Files:**
- Modify: `secret/store.go`, `flag/store.go`, `config/store.go`, `override/store.go`, `rotation/store.go`, `audit/store.go`
- Modify: `store/memory/store.go`, `store/postgres/secret.go`, `store/postgres/flag.go`, `store/postgres/config.go`, `store/postgres/override.go`, `store/postgres/rotation.go`, `store/postgres/audit.go`, `store/sqlite/store.go`, `store/mongo/store.go`
- Test: `store/memory/count_test.go` (create)

**Interfaces:**
- Consumes: Task 3's `core` package must already exist, because these files are in packages that Task 3 repointed.
- Produces: six methods, each `(ctx context.Context, appID string) (int64, error)`: `CountSecrets`, `CountFlagDefinitions`, `CountConfig`, `CountOverrides`, `CountRotationPolicies`, `CountAudit`. Slice 2's `overview.stats` handler calls all six; every `*.list` handler calls one for its `total`.

**Why one task and not six:** adding a method to `secret.Store` breaks the `var _ secret.Store = (*Store)(nil)` assertion in all four backends at once, so the repo does not build until every backend has it. Splitting by subsystem would leave the tree red between tasks.

- [ ] **Step 1: Write the failing test**

Create `store/memory/count_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/vault/core"
	"github.com/xraph/vault/flag"
	"github.com/xraph/vault/id"
	"github.com/xraph/vault/secret"
	"github.com/xraph/vault/store/memory"
)

// store_test.go in this package already declares bg(); reuse it rather than
// adding a second context helper to the same package.

// An app with nothing in it counts zero and does not error. Every list
// handler calls these for its caption, so an error here would break a page
// that is merely empty.
func TestCountsAreZeroForAnEmptyApp(t *testing.T) {
	s := memory.New()
	checks := map[string]func() (int64, error){
		"secrets":   func() (int64, error) { return s.CountSecrets(bg(), "nobody") },
		"flags":     func() (int64, error) { return s.CountFlagDefinitions(bg(), "nobody") },
		"config":    func() (int64, error) { return s.CountConfig(bg(), "nobody") },
		"overrides": func() (int64, error) { return s.CountOverrides(bg(), "nobody") },
		"rotation":  func() (int64, error) { return s.CountRotationPolicies(bg(), "nobody") },
		"audit":     func() (int64, error) { return s.CountAudit(bg(), "nobody") },
	}
	for name, fn := range checks {
		got, err := fn()
		if err != nil {
			t.Errorf("%s: unexpected error %v", name, err)
		}
		if got != 0 {
			t.Errorf("%s: got %d, want 0", name, got)
		}
	}
}

// Counts are per app and must not leak rows from another one.
func TestCountsAreScopedToTheApp(t *testing.T) {
	s := memory.New()
	for _, app := range []string{"a", "a", "b"} {
		if err := s.SetSecret(bg(), &secret.Secret{
			Entity: core.NewEntity(), ID: id.NewSecretID(),
			Key: app + "-" + id.NewSecretID().String(), AppID: app,
			EncryptedValue: []byte("x"),
		}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.CountSecrets(bg(), "a")
	if err != nil {
		t.Fatal(err)
	}
	if got != 2 {
		t.Errorf("app a: got %d, want 2", got)
	}
	got, err = s.CountSecrets(bg(), "b")
	if err != nil {
		t.Fatal(err)
	}
	if got != 1 {
		t.Errorf("app b: got %d, want 1", got)
	}
}

// An empty appID must match only rows whose app_id is literally empty, never
// every row. This is pinned rather than assumed: if a backend ever answers a
// blank scope with the whole table, a list handler that fails to resolve a
// tenant would hand one caller every tenant's secrets. Assert on identity,
// because a count assertion passes when the wrong rows arrive in the right
// quantity.
func TestEmptyAppIDMatchesOnlyEmptyScopedRows(t *testing.T) {
	s := memory.New()
	for _, app := range []string{"a", "b"} {
		if err := s.SetSecret(bg(), &secret.Secret{
			Entity: core.NewEntity(), ID: id.NewSecretID(),
			Key: "k-" + app, AppID: app, EncryptedValue: []byte("x"),
		}); err != nil {
			t.Fatal(err)
		}
	}

	n, err := s.CountSecrets(bg(), "")
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("empty appID counted %d rows, want 0; a blank scope must not match every row", n)
	}

	list, err := s.ListSecrets(bg(), "", secret.ListOpts{})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range list {
		if m.AppID != "" {
			t.Errorf("empty appID returned a row scoped to %q", m.AppID)
		}
	}
}

// A count is the whole set, not one page. Paging must not change it, or the
// caption would report the page size forever.
func TestCountIgnoresPaging(t *testing.T) {
	s := memory.New()
	for i := 0; i < 5; i++ {
		if err := s.DefineFlag(bg(), &flag.Definition{
			Entity: core.NewEntity(), ID: id.NewFlagID(),
			Key: id.NewFlagID().String(), Type: flag.TypeBool, AppID: "a",
		}); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.ListFlagDefinitions(bg(), "a", flag.ListOpts{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 2 {
		t.Fatalf("page: got %d, want 2", len(page))
	}
	count, err := s.CountFlagDefinitions(bg(), "a")
	if err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Errorf("count: got %d, want 5", count)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./store/memory/ -run TestCount -v`
Expected: FAIL to compile, with `s.CountSecrets undefined` and the same for the other five.

- [ ] **Step 3: Add the six interface methods**

In `secret/store.go`, inside `type Store interface`:

```go
	// CountSecrets returns the total number of secrets for an app,
	// independent of any paging.
	CountSecrets(ctx context.Context, appID string) (int64, error)
```

In `flag/store.go`:

```go
	// CountFlagDefinitions returns the total number of flag definitions for
	// an app, independent of any paging.
	CountFlagDefinitions(ctx context.Context, appID string) (int64, error)
```

In `config/store.go`:

```go
	// CountConfig returns the total number of config entries for an app,
	// independent of any paging.
	CountConfig(ctx context.Context, appID string) (int64, error)
```

In `override/store.go`:

```go
	// CountOverrides returns the total number of tenant overrides for an app,
	// across every key and tenant.
	CountOverrides(ctx context.Context, appID string) (int64, error)
```

In `rotation/store.go`:

```go
	// CountRotationPolicies returns the total number of rotation policies for
	// an app, independent of any paging.
	CountRotationPolicies(ctx context.Context, appID string) (int64, error)
```

In `audit/store.go`:

```go
	// CountAudit returns the total number of audit entries for an app,
	// independent of any paging.
	CountAudit(ctx context.Context, appID string) (int64, error)
```

- [ ] **Step 4: Implement them in the memory backend**

Append to `store/memory/store.go`:

```go
// ──────────────────────────────────────────────────
// Counts
// ──────────────────────────────────────────────────

// CountSecrets returns the number of secrets belonging to appID.
func (m *Store) CountSecrets(_ context.Context, appID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, s := range m.secrets {
		if s.AppID == appID {
			n++
		}
	}
	return n, nil
}

// CountFlagDefinitions returns the number of flag definitions belonging to appID.
func (m *Store) CountFlagDefinitions(_ context.Context, appID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, f := range m.flags {
		if f.AppID == appID {
			n++
		}
	}
	return n, nil
}

// CountConfig returns the number of config entries belonging to appID.
func (m *Store) CountConfig(_ context.Context, appID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, e := range m.configs {
		if e.AppID == appID {
			n++
		}
	}
	return n, nil
}

// CountOverrides returns the number of tenant overrides belonging to appID,
// across every key and tenant.
func (m *Store) CountOverrides(_ context.Context, appID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, o := range m.overrides {
		if o.AppID == appID {
			n++
		}
	}
	return n, nil
}

// CountRotationPolicies returns the number of rotation policies belonging to appID.
func (m *Store) CountRotationPolicies(_ context.Context, appID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, p := range m.rotationPolicies {
		if p.AppID == appID {
			n++
		}
	}
	return n, nil
}

// CountAudit returns the number of audit entries belonging to appID.
func (m *Store) CountAudit(_ context.Context, appID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var n int64
	for _, e := range m.auditEntries {
		if e.AppID == appID {
			n++
		}
	}
	return n, nil
}
```

- [ ] **Step 5: Implement them in the postgres backend**

`grove`'s `SelectQuery` has `Count(ctx context.Context) (int64, error)`, which issues a `SELECT count(*)` and does not need a destination slice.

Append `CountSecrets` to `store/postgres/secret.go`:

```go
// CountSecrets returns the number of secrets belonging to appID.
func (s *Store) CountSecrets(ctx context.Context, appID string) (int64, error) {
	return s.pgdb().NewSelect((*SecretModel)(nil)).
		Where("app_id = ?", appID).
		Count(ctx)
}
```

Append `CountFlagDefinitions` to `store/postgres/flag.go`:

```go
// CountFlagDefinitions returns the number of flag definitions belonging to appID.
func (s *Store) CountFlagDefinitions(ctx context.Context, appID string) (int64, error) {
	return s.pgdb().NewSelect((*FlagModel)(nil)).
		Where("app_id = ?", appID).
		Count(ctx)
}
```

Append `CountConfig` to `store/postgres/config.go`:

```go
// CountConfig returns the number of config entries belonging to appID.
func (s *Store) CountConfig(ctx context.Context, appID string) (int64, error) {
	return s.pgdb().NewSelect((*ConfigModel)(nil)).
		Where("app_id = ?", appID).
		Count(ctx)
}
```

Append `CountOverrides` to `store/postgres/override.go`:

```go
// CountOverrides returns the number of tenant overrides belonging to appID.
func (s *Store) CountOverrides(ctx context.Context, appID string) (int64, error) {
	return s.pgdb().NewSelect((*OverrideModel)(nil)).
		Where("app_id = ?", appID).
		Count(ctx)
}
```

Append `CountRotationPolicies` to `store/postgres/rotation.go`:

```go
// CountRotationPolicies returns the number of rotation policies belonging to appID.
func (s *Store) CountRotationPolicies(ctx context.Context, appID string) (int64, error) {
	return s.pgdb().NewSelect((*RotationPolicyModel)(nil)).
		Where("app_id = ?", appID).
		Count(ctx)
}
```

Append `CountAudit` to `store/postgres/audit.go`:

```go
// CountAudit returns the number of audit entries belonging to appID.
func (s *Store) CountAudit(ctx context.Context, appID string) (int64, error) {
	return s.pgdb().NewSelect((*AuditModel)(nil)).
		Where("app_id = ?", appID).
		Count(ctx)
}
```

Before writing these, open `store/postgres/models.go` and use the model type names exactly as declared there. `SecretModel` is confirmed; check the other five and correct the names above if they differ.

- [ ] **Step 6: Implement them in the sqlite backend**

The sqlite driver's `SelectQuery` has the same `Count(ctx) (int64, error)`. The sqlite backend keeps everything in one file, so append all six to `store/sqlite/store.go`:

```go
// ──────────────────────────────────────────────────
// Counts
// ──────────────────────────────────────────────────

// CountSecrets returns the number of secrets belonging to appID.
func (s *Store) CountSecrets(ctx context.Context, appID string) (int64, error) {
	return s.sdb.NewSelect((*SecretModel)(nil)).Where("app_id = ?", appID).Count(ctx)
}

// CountFlagDefinitions returns the number of flag definitions belonging to appID.
func (s *Store) CountFlagDefinitions(ctx context.Context, appID string) (int64, error) {
	return s.sdb.NewSelect((*FlagModel)(nil)).Where("app_id = ?", appID).Count(ctx)
}

// CountConfig returns the number of config entries belonging to appID.
func (s *Store) CountConfig(ctx context.Context, appID string) (int64, error) {
	return s.sdb.NewSelect((*ConfigModel)(nil)).Where("app_id = ?", appID).Count(ctx)
}

// CountOverrides returns the number of tenant overrides belonging to appID.
func (s *Store) CountOverrides(ctx context.Context, appID string) (int64, error) {
	return s.sdb.NewSelect((*OverrideModel)(nil)).Where("app_id = ?", appID).Count(ctx)
}

// CountRotationPolicies returns the number of rotation policies belonging to appID.
func (s *Store) CountRotationPolicies(ctx context.Context, appID string) (int64, error) {
	return s.sdb.NewSelect((*RotationPolicyModel)(nil)).Where("app_id = ?", appID).Count(ctx)
}

// CountAudit returns the number of audit entries belonging to appID.
func (s *Store) CountAudit(ctx context.Context, appID string) (int64, error) {
	return s.sdb.NewSelect((*AuditModel)(nil)).Where("app_id = ?", appID).Count(ctx)
}
```

Check `store/sqlite/models.go` for the real model type names and correct the six above if they differ. Check that the receiver field is `s.sdb`; `store/sqlite/store.go:210` (`ListSecrets`) shows the accessor this backend uses.

- [ ] **Step 7: Implement them in the mongo backend**

The mongo driver's `FindQuery` has `Count(ctx) (int64, error)`. Append all six to `store/mongo/store.go`:

```go
// ──────────────────────────────────────────────────
// Counts
// ──────────────────────────────────────────────────

// CountSecrets returns the number of secrets belonging to appID.
func (s *Store) CountSecrets(ctx context.Context, appID string) (int64, error) {
	return s.mdb.NewFind((*SecretModel)(nil)).Filter(bson.M{"app_id": appID}).Count(ctx)
}

// CountFlagDefinitions returns the number of flag definitions belonging to appID.
func (s *Store) CountFlagDefinitions(ctx context.Context, appID string) (int64, error) {
	return s.mdb.NewFind((*FlagModel)(nil)).Filter(bson.M{"app_id": appID}).Count(ctx)
}

// CountConfig returns the number of config entries belonging to appID.
func (s *Store) CountConfig(ctx context.Context, appID string) (int64, error) {
	return s.mdb.NewFind((*ConfigModel)(nil)).Filter(bson.M{"app_id": appID}).Count(ctx)
}

// CountOverrides returns the number of tenant overrides belonging to appID.
func (s *Store) CountOverrides(ctx context.Context, appID string) (int64, error) {
	return s.mdb.NewFind((*OverrideModel)(nil)).Filter(bson.M{"app_id": appID}).Count(ctx)
}

// CountRotationPolicies returns the number of rotation policies belonging to appID.
func (s *Store) CountRotationPolicies(ctx context.Context, appID string) (int64, error) {
	return s.mdb.NewFind((*RotationPolicyModel)(nil)).Filter(bson.M{"app_id": appID}).Count(ctx)
}

// CountAudit returns the number of audit entries belonging to appID.
func (s *Store) CountAudit(ctx context.Context, appID string) (int64, error) {
	return s.mdb.NewFind((*AuditModel)(nil)).Filter(bson.M{"app_id": appID}).Count(ctx)
}
```

`NewFind` in this backend is called with a destination slice elsewhere (`store/mongo/store.go:267`). If it rejects a typed nil, pass an empty slice of the model type instead and discard it. Check the model type names in `store/mongo/models.go` and the bson field name for the app column; `store/mongo/store.go:268` shows `bson.M{"app_id": appID}` in use, so `app_id` is confirmed.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `go test ./store/... -v`
Expected: PASS. The memory count tests are the behavioural ones; the other three backends are covered by the interface assertions compiling, plus whatever integration tests the repo already runs for them.

- [ ] **Step 9: Run the full build, suite and linter**

Run: `go build ./... && go test ./... && golangci-lint run ./...`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add secret/store.go flag/store.go config/store.go override/store.go rotation/store.go audit/store.go store/
git commit -m "feat(store): count rows per app on every subsystem store

Nothing could answer how many secrets or flags an app has without
listing them. The dashboard counted by listing ten thousand rows and
taking the length, which is wrong above ten thousand and expensive
below it.

Six Count methods, one per subsystem interface, implemented across all
four backends. They return the whole set and ignore paging, so a list
page can report a real total next to the page it is showing."
```

---

### Task 5: Carry the encryption algorithm onto secret metadata

**Files:**
- Modify: `secret/secret.go` (the `Meta` struct and `ToMeta`)
- Modify: `store/postgres/models.go:72`, `store/sqlite/models.go:72`, `store/mongo/models.go:67`
- Test: `secret/meta_test.go` (create)

**Interfaces:**
- Consumes: Task 3's `core` package, since `secret/secret.go` was repointed by it.
- Produces: `secret.Meta.EncryptionAlg string` with JSON tag `encryption_alg`. Slice 2's `SecretSummary` projects it as `encryptionAlg`, and the secrets list uses it per row.

**Why this exists:** with no encryptor configured, `secret.Service.Set` stores the plaintext directly in `EncryptedValue` and leaves `EncryptionAlg` empty (`secret/service.go:152`). That fallback is documented and fine. What is not fine is that `Meta` has no `EncryptionAlg` field, so `ListSecrets` returns rows a caller cannot tell apart: an AES-256-GCM secret and a plaintext one look identical. A secrets page built on that would show every row the same way and imply protection that half of them may not have.

It has to be per row, not per Vault. `EncryptionEnabled()` reports the key configured right now. A secret written before a key was added stays plaintext forever, because nothing re-encrypts on read. So a Vault with a valid key can still be holding plaintext rows, and only the row knows.

- [ ] **Step 1: Write the failing test**

Create `secret/meta_test.go`:

```go
package secret_test

import (
	"context"
	"testing"

	"github.com/xraph/vault/crypto"
	"github.com/xraph/vault/secret"
	"github.com/xraph/vault/store/memory"
)

// A secret written with no encryptor is plaintext in EncryptedValue, and the
// metadata must say so. Anything less lets a page call it encrypted.
func TestMetaReportsNoAlgorithmWhenNothingEncrypted(t *testing.T) {
	s := memory.New()
	svc := secret.NewService(s, nil, secret.WithAppID("app1"))

	meta, err := svc.Set(context.Background(), "k", []byte("plain"), "app1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.EncryptionAlg != "" {
		t.Errorf("Set returned alg %q, want empty", meta.EncryptionAlg)
	}

	list, err := svc.List(context.Background(), "app1", secret.ListOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("list: got %d, want 1", len(list))
	}
	if list[0].EncryptionAlg != "" {
		t.Errorf("listed alg %q, want empty; an unencrypted row must not look encrypted", list[0].EncryptionAlg)
	}
}

func TestMetaReportsTheAlgorithmWhenEncrypted(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	enc, err := crypto.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}
	s := memory.New()
	svc := secret.NewService(s, enc, secret.WithAppID("app1"))

	if _, err := svc.Set(context.Background(), "k", []byte("secret"), "app1"); err != nil {
		t.Fatal(err)
	}
	list, err := svc.List(context.Background(), "app1", secret.ListOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if list[0].EncryptionAlg != "AES-256-GCM" {
		t.Errorf("listed alg %q, want AES-256-GCM", list[0].EncryptionAlg)
	}
}

// The two can coexist: a key added later does not re-encrypt what is already
// stored, so one app can hold rows of both kinds. This is why the field has
// to be per row and EncryptionEnabled() on the Vault is not enough.
func TestMetaDistinguishesRowsWrittenUnderDifferentConfig(t *testing.T) {
	s := memory.New()

	plain := secret.NewService(s, nil, secret.WithAppID("app1"))
	if _, err := plain.Set(context.Background(), "before", []byte("v"), "app1"); err != nil {
		t.Fatal(err)
	}

	key := make([]byte, 32)
	enc, err := crypto.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}
	encrypted := secret.NewService(s, enc, secret.WithAppID("app1"))
	if _, err := encrypted.Set(context.Background(), "after", []byte("v"), "app1"); err != nil {
		t.Fatal(err)
	}

	list, err := encrypted.List(context.Background(), "app1", secret.ListOpts{})
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]string{}
	for _, m := range list {
		byKey[m.Key] = m.EncryptionAlg
	}
	if byKey["before"] != "" {
		t.Errorf("before: got %q, want empty", byKey["before"])
	}
	if byKey["after"] != "AES-256-GCM" {
		t.Errorf("after: got %q, want AES-256-GCM", byKey["after"])
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./secret/ -run TestMeta -v`
Expected: FAIL to compile, with `meta.EncryptionAlg undefined`.

- [ ] **Step 3: Add the field and carry it in `ToMeta`**

In `secret/secret.go`, add to the `Meta` struct after `Version`:

```go
	// EncryptionAlg names the algorithm the stored value was encrypted with.
	// Empty means the value is NOT encrypted: it was written while no
	// encryption key was configured and is stored as given. A caller that
	// displays secrets must treat empty as "not encrypted" rather than as
	// "unknown", because it is the state every unconfigured Vault produces.
	EncryptionAlg string `json:"encryption_alg,omitempty"`
```

In `ToMeta`, add the field to the returned literal:

```go
		EncryptionAlg: s.EncryptionAlg,
```

- [ ] **Step 4: Carry it in the three SQL and document backends**

In `store/postgres/models.go:72`, `store/sqlite/models.go:72` and `store/mongo/models.go:67`, add to each `toMeta`'s returned literal:

```go
		EncryptionAlg: m.EncryptionAlg,
```

The memory backend needs no change: `store/memory/store.go:164` calls `s.ToMeta()`, which Step 3 already fixed.

Confirm each `SecretModel` actually has an `EncryptionAlg` field before editing; `store/postgres/models.go:50` shows it being written, so postgres is certain. Check sqlite and mongo, and if either omits the column, add it to the model and its migration rather than dropping the field from `toMeta`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./secret/ ./store/... -v`
Expected: PASS.

- [ ] **Step 6: Run the full build, suite and linter**

Run: `go build ./... && go test ./... && golangci-lint run ./...`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add secret/secret.go secret/meta_test.go store/postgres/models.go store/sqlite/models.go store/mongo/models.go
git commit -m "feat(secret): say on the metadata whether a value is encrypted

With no encryption key configured, Set stores the plaintext directly in
EncryptedValue and leaves EncryptionAlg empty. That fallback is
documented. What was not safe is that Meta carried no algorithm field,
so ListSecrets returned encrypted and plaintext rows that no caller
could tell apart.

It has to be per row. A key added later does not re-encrypt what is
already stored, so one app can hold both kinds at once and only the row
knows which it is. Meta now carries EncryptionAlg, and empty means not
encrypted rather than unknown."
```

---

### Task 6: `vault.go`, the composed Vault

**Files:**
- Create: `vault.go`
- Modify: `options.go`
- Test: `vault_test.go` (create)

**Interfaces:**
- Consumes: Task 3's `core` package (without it this file cannot compile). Task 1's, Task 2's and Task 5's additions are not used here; they are for slice 2.
- Produces: `vault.New(opts ...Option) (*Vault, error)` and the accessors `(*Vault).Secrets() *secret.Service`, `.Flags() *flag.Service`, `.FlagEngine() *flag.Engine`, `.Config() *config.Service`, `.Overrides() *override.Resolver`, `.Rotation() *rotation.Manager`, `.Audit() *audit.Logger`, `.Store() store.Store`, `.EncryptionEnabled() bool`. Slice 2's `contract.Deps` holds a `*vault.Vault` and calls all of these.

**Two things the implementer must get right:**

An absent encryption key is not an error. `secret.Service` already handles a nil encryptor by storing plaintext, which is the documented fallback, so `New` passes nil and carries on. A key that is present but malformed IS an error: falling back to plaintext there would store secrets in the clear while the operator believes they are encrypted.

`WithStore` does not exist yet. `Config` has no store field and the current `NewVault` takes no store. Add `WithStore(s store.Store) Option`, since `New` cannot compose anything without one.

- [ ] **Step 1: Write the failing test**

Create `vault_test.go`:

```go
package vault_test

import (
	"context"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/xraph/vault"
	"github.com/xraph/vault/store/memory"
)

const testKeyHex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func TestNewRequiresAStore(t *testing.T) {
	_, err := vault.New()
	if err == nil {
		t.Fatal("expected an error with no store configured")
	}
	if !strings.Contains(err.Error(), "store") {
		t.Errorf("error should name the missing store, got %q", err)
	}
}

func TestNewWiresEverySubsystem(t *testing.T) {
	key, _ := hex.DecodeString(testKeyHex)
	v, err := vault.New(
		vault.WithStore(memory.New()),
		vault.WithAppID("app1"),
		vault.WithEncryptionKey(key),
	)
	if err != nil {
		t.Fatal(err)
	}
	if v.Secrets() == nil {
		t.Error("Secrets() is nil")
	}
	if v.Flags() == nil {
		t.Error("Flags() is nil")
	}
	if v.FlagEngine() == nil {
		t.Error("FlagEngine() is nil")
	}
	if v.Config() == nil {
		t.Error("Config() is nil")
	}
	if v.Overrides() == nil {
		t.Error("Overrides() is nil")
	}
	if v.Rotation() == nil {
		t.Error("Rotation() is nil")
	}
	if v.Audit() == nil {
		t.Error("Audit() is nil")
	}
	if v.Store() == nil {
		t.Error("Store() is nil")
	}
	if !v.EncryptionEnabled() {
		t.Error("EncryptionEnabled() is false with a valid key")
	}
}

// Review Focus 1: no key at all is the documented fallback, not a panic.
func TestNewWithNoKeyStoresPlaintextAndDoesNotPanic(t *testing.T) {
	v, err := vault.New(vault.WithStore(memory.New()), vault.WithAppID("app1"))
	if err != nil {
		t.Fatalf("no key should not be an error: %v", err)
	}
	if v.EncryptionEnabled() {
		t.Error("EncryptionEnabled() is true with no key configured")
	}
	// The real risk is a nil encryptor dereference on the first write.
	if _, err := v.Secrets().Set(context.Background(), "k", []byte("v"), "app1"); err != nil {
		t.Fatalf("Set with no encryptor: %v", err)
	}
}

// Review Focus 2: a broken key must fail loudly. Falling back to plaintext
// here would store secrets in the clear while the operator believes
// otherwise, which is worse than refusing to start.
func TestNewWithAMalformedKeyIsAnError(t *testing.T) {
	cases := map[string][]byte{
		"too short": []byte("short"),
		"too long":  make([]byte, 64),
	}
	for name, key := range cases {
		if _, err := vault.New(vault.WithStore(memory.New()), vault.WithEncryptionKey(key)); err == nil {
			t.Errorf("%s: expected an error, got nil", name)
		}
	}
}

func TestNewWithAnUndecodableKeyEnvIsAnError(t *testing.T) {
	t.Setenv("VAULT_TEST_KEY", "not-a-key")
	if _, err := vault.New(
		vault.WithStore(memory.New()),
		vault.WithEncryptionKeyEnv("VAULT_TEST_KEY"),
	); err == nil {
		t.Error("expected an error for an undecodable key env, got nil")
	}
}

// An env var that is not set at all is the same case as no key: fall back.
func TestNewWithAnUnsetKeyEnvFallsBack(t *testing.T) {
	v, err := vault.New(
		vault.WithStore(memory.New()),
		vault.WithEncryptionKeyEnv("VAULT_TEST_KEY_DEFINITELY_UNSET"),
	)
	if err != nil {
		t.Fatalf("an unset env var should fall back, not error: %v", err)
	}
	if v.EncryptionEnabled() {
		t.Error("EncryptionEnabled() is true with an unset env var")
	}
}

// A secret written through the service round-trips, which is the thing the
// templ dashboard got wrong by writing Value and never EncryptedValue.
func TestSecretsRoundTripThroughTheService(t *testing.T) {
	key, _ := hex.DecodeString(testKeyHex)
	v, err := vault.New(
		vault.WithStore(memory.New()),
		vault.WithAppID("app1"),
		vault.WithEncryptionKey(key),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	meta, err := v.Secrets().Set(ctx, "api_key", []byte("s3cret"), "app1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.ID.String() == "" {
		t.Error("Set returned a meta with an empty ID")
	}
	got, err := v.Secrets().Get(ctx, "api_key", "app1")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.Value) != "s3cret" {
		t.Errorf("round trip: got %q, want %q", got.Value, "s3cret")
	}
}

// The audit hooks exist for this and nothing has ever passed them, which is
// why every audit surface in the templ dashboard read an empty table.
func TestSecretMutationsWriteAnAuditEntry(t *testing.T) {
	key, _ := hex.DecodeString(testKeyHex)
	s := memory.New()
	v, err := vault.New(
		vault.WithStore(s),
		vault.WithAppID("app1"),
		vault.WithEncryptionKey(key),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := v.Secrets().Set(ctx, "api_key", []byte("s3cret"), "app1"); err != nil {
		t.Fatal(err)
	}
	n, err := s.CountAudit(ctx, "app1")
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Error("no audit entry was written for a secret mutation")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test . -run 'TestNew|TestSecret' -v`
Expected: FAIL to compile, with `vault.New undefined` and `vault.WithStore undefined`.

- [ ] **Step 3: Strip the stub out of options.go**

Delete from `options.go` the `Storer` interface, the `Vault` struct, the `Health` method and `NewVault`. The file keeps its `Option` type and the six `With*` functions, and adds one:

```go
// WithStore sets the store backend. Required: New cannot compose the
// subsystem services without one.
func WithStore(s store.Store) Option {
	return func(v *Vault) { v.store = s }
}
```

Add `"github.com/xraph/vault/store"` to `options.go`'s imports. This is legal now that Task 3 has landed: `store` imports the subsystem packages, which import `core` rather than `vault`.

Change the receiver expectations in the existing options: they already write to `v.config` and `v.logger`, and `Vault` keeps both fields, so no other edit is needed.

- [ ] **Step 4: Write vault.go**

Create `vault.go`:

```go
package vault

import (
	"context"
	"errors"
	"fmt"

	log "github.com/xraph/go-utils/log"

	"github.com/xraph/vault/audit"
	"github.com/xraph/vault/config"
	"github.com/xraph/vault/crypto"
	"github.com/xraph/vault/flag"
	"github.com/xraph/vault/override"
	"github.com/xraph/vault/rotation"
	"github.com/xraph/vault/secret"
	"github.com/xraph/vault/store"
)

// Vault is the central type. It composes one store into the six subsystem
// services, wires the audit logger into secret mutations, and hands the
// whole thing out through accessors.
type Vault struct {
	config Config
	logger log.Logger
	store  store.Store

	encryptor *crypto.Encryptor

	secrets   *secret.Service
	engine    *flag.Engine
	flags     *flag.Service
	resolver  *override.Resolver
	configSvc *config.Service
	rotation  *rotation.Manager
	auditLog  *audit.Logger
}

// New creates a Vault from a store and options.
//
// An absent encryption key is not an error: secrets fall back to being stored
// as given, which is the documented behaviour for development. A key that is
// present but cannot be decoded IS an error, because silently falling back
// there would store secrets in the clear while the caller believes they are
// encrypted.
func New(opts ...Option) (*Vault, error) {
	v := &Vault{
		config: DefaultConfig(),
		logger: log.NewNoopLogger(),
	}
	for _, opt := range opts {
		opt(v)
	}

	if v.store == nil {
		return nil, ErrNoStore
	}

	enc, err := buildEncryptor(v.config)
	if err != nil {
		return nil, err
	}
	v.encryptor = enc

	// The audit logger first: the secret service's hooks take it.
	v.auditLog = audit.NewLogger(v.store, audit.WithLogger(v.logger))

	v.secrets = secret.NewService(v.store, v.encryptor,
		secret.WithAppID(v.config.AppID),
		secret.WithOnAccess(func(ctx context.Context, key, appID string) {
			v.auditLog.LogAccess(ctx, key, "secret.get", "secret")
		}),
		secret.WithOnMutate(func(ctx context.Context, action, key, appID string) {
			v.auditLog.LogAccess(ctx, key, action, "secret")
		}),
	)

	v.engine = flag.NewEngine(v.store, flag.WithCacheTTL(v.config.FlagCacheTTL))
	v.flags = flag.NewService(v.engine, flag.WithAppID(v.config.AppID))

	v.resolver = override.NewResolver(v.store, v.store,
		override.WithLogger(v.logger),
	)
	v.configSvc = config.NewService(v.store,
		config.WithAppID(v.config.AppID),
	)

	v.rotation = rotation.NewManager(v.store, v.secrets,
		rotation.WithAppID(v.config.AppID),
		rotation.WithLogger(v.logger),
	)

	return v, nil
}

// buildEncryptor resolves the encryption key from the config.
// It returns (nil, nil) when no key is configured at all.
func buildEncryptor(cfg Config) (*crypto.Encryptor, error) {
	key := cfg.EncryptionKey

	if len(key) == 0 && cfg.EncryptionKeyEnv != "" {
		provider := crypto.NewEnvKeyProvider(cfg.EncryptionKeyEnv)
		fromEnv, err := provider.GetKey(context.Background())
		if err != nil {
			// An unset variable means "no key configured", which is the
			// fallback. Anything else means the operator meant to configure
			// one and it is broken, which must not be silent.
			if isUnsetEnv(err) {
				return nil, nil
			}
			return nil, fmt.Errorf("vault: encryption key from %s: %w", cfg.EncryptionKeyEnv, err)
		}
		key = fromEnv
	}

	if len(key) == 0 {
		return nil, nil
	}

	enc, err := crypto.NewEncryptor(key)
	if err != nil {
		return nil, fmt.Errorf("vault: encryption key: %w", err)
	}
	return enc, nil
}

// isUnsetEnv reports whether err is EnvKeyProvider's "empty or not set".
// The provider returns a formatted error rather than a sentinel, so this
// matches on the text it produces.
func isUnsetEnv(err error) bool {
	return err != nil && strings.Contains(err.Error(), "is empty or not set")
}

// EncryptionEnabled reports whether secrets are encrypted at rest.
// False means a key was not configured and values are stored as given.
func (v *Vault) EncryptionEnabled() bool { return v.encryptor != nil }

// Secrets returns the secret service.
func (v *Vault) Secrets() *secret.Service { return v.secrets }

// Flags returns the type-safe flag evaluation service.
func (v *Vault) Flags() *flag.Service { return v.flags }

// FlagEngine returns the underlying flag engine, which is what a caller
// needs for EvaluateDetail. Flags() covers the typed read path.
func (v *Vault) FlagEngine() *flag.Engine { return v.engine }

// Config returns the runtime config service.
func (v *Vault) Config() *config.Service { return v.configSvc }

// Overrides returns the per-tenant config resolver.
func (v *Vault) Overrides() *override.Resolver { return v.resolver }

// Rotation returns the rotation manager.
func (v *Vault) Rotation() *rotation.Manager { return v.rotation }

// Audit returns the audit logger.
func (v *Vault) Audit() *audit.Logger { return v.auditLog }

// Store returns the configured store backend.
func (v *Vault) Store() store.Store { return v.store }

// Health checks the health of the Vault by pinging its store.
func (v *Vault) Health(ctx context.Context) error {
	if v.store == nil {
		return ErrNoStore
	}
	return v.store.Ping(ctx)
}

var _ = errors.Is // retained for future error mapping
```

Add `"strings"` to the imports and delete the `var _ = errors.Is` line together with the `"errors"` import if nothing else in the file needs them. Before writing, check the real signatures of `config.NewService` and `override.NewResolver` in `config/service.go` and `override/resolver.go`: `config.NewService` may take the resolver as an argument or via an option, and this code must match what is actually declared rather than what this plan guesses. Check `audit.NewLogger`'s option names in `audit/logger.go` the same way, and check whether `LogAccess` takes the argument order `(ctx, key, action, resource)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test . -v`
Expected: PASS, all eight tests including the two Review Focus cases and the audit-entry test.

- [ ] **Step 6: Run the full build, suite and linter**

Run: `go build ./... && go test ./... && golangci-lint run ./...`
Expected: all clean. `extension/extension.go` still calls `vault.NewVault`, which Step 3 deleted, so the build will fail there. That is Task 7's job; if you want a green tree at this commit, do Task 7 before committing and combine the two. Otherwise expect this one failure and only this one.

- [ ] **Step 7: Commit**

```bash
git add vault.go options.go vault_test.go
git commit -m "feat: build the Vault the package has always documented

doc.go has described vault.New with Secrets, Flags and Config accessors
since the package was written. options.go carried a stub with a comment
saying the real thing would arrive in a later phase, and it never did,
so every consumer got a bare store and built nothing on top of it.

New composes the store into all six subsystem services and wires the
audit logger into the secret service's OnAccess and OnMutate hooks.
Those hooks existed for exactly this and nothing had ever passed them,
which is why every audit surface read an empty table.

An absent encryption key stays the documented plaintext fallback. A key
that is present and malformed is now an error, because falling back
there stores secrets in the clear while the operator believes they are
encrypted."
```

---

### Task 7: Rewire the extension onto `vault.New`

**Files:**
- Modify: `extension/extension.go`
- Test: `extension/extension_test.go` (create)

**Interfaces:**
- Consumes: Task 6's `vault.New`, `WithStore` and the accessors.
- Produces: nothing new. `*vault.Vault` in the DI container is now a real composed Vault rather than a stub, which is what slice 2's `contract.Deps` resolves.

- [ ] **Step 1: Write the failing test**

Create `extension/extension_test.go`:

```go
package extension_test

import (
	"testing"

	"github.com/xraph/vault"
	"github.com/xraph/vault/store/memory"
)

// The extension's job is to hand a composed Vault to the DI container. This
// pins the composition it performs, without standing up a whole forge app.
func TestComposedVaultFromAStoreHasEverySubsystem(t *testing.T) {
	v, err := vault.New(
		vault.WithStore(memory.New()),
		vault.WithAppID("app1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if v.Secrets() == nil || v.Flags() == nil || v.Config() == nil {
		t.Error("a composed vault is missing a subsystem")
	}
	if v.Store() == nil {
		t.Error("Store() is nil; the extension provides this to the container")
	}
}
```

- [ ] **Step 2: Run the build to see the real failure**

Run: `go build ./...`
Expected: FAIL in `extension/extension.go` with `undefined: vault.NewVault`, because Task 6 deleted it.

- [ ] **Step 3: Rewire the constructor**

In `extension/extension.go`, find the block that reads:

```go
	v := vault.NewVault(e.vaultOpts...)
	e.v = v
```

Replace it with:

```go
	// The store has to reach New as an option now: a Vault composes its
	// services at construction and cannot do that without one.
	if e.store != nil {
		e.vaultOpts = append(e.vaultOpts, vault.WithStore(e.store))
	}

	v, err := vault.New(e.vaultOpts...)
	if err != nil {
		return fmt.Errorf("vault: %w", err)
	}
	e.v = v

	if !v.EncryptionEnabled() {
		e.Logger().Warn("vault: no encryption key configured; secrets are stored unencrypted",
			forge.F("encryption_key_env", e.config.EncryptionKeyEnv),
		)
	}
```

`fmt` is already imported in that file.

The `vault.WithConfig(...)` option that the surrounding code appends when `FlagCacheTTL != 0` overwrites the whole `Config`, including any `EncryptionKey` set earlier. Move the `WithStore` append to after every other option so a later `WithConfig` cannot clobber it, and check whether that `WithConfig` branch should be setting individual fields instead. If it should, change it to append `WithAppID`, `WithEncryptionKeyEnv` and a new option per duration rather than replacing `Config` wholesale.

- [ ] **Step 4: Run the test and build**

Run: `go build ./... && go test ./extension/ -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite and linter**

Run: `go build ./... && go test ./... && golangci-lint run ./...`
Expected: all clean. This is the gate for the whole slice.

- [ ] **Step 6: Commit**

```bash
git add extension/extension.go extension/extension_test.go
git commit -m "feat(extension): provide a composed Vault to the container

The extension called NewVault, which returned a stub holding a config
and a logger, then provided that to the DI container. Anything that
injected a *vault.Vault got something with no methods on it and had to
reach for the raw store instead.

It now calls vault.New with the store as an option and surfaces the
error, so the container holds a Vault with all six services on it. A
missing encryption key logs a warning at startup, because storing
secrets unencrypted should be visible to whoever reads the logs rather
than only to whoever reads the config."
```

---

## Done when

- `go build ./... && go test ./... && golangci-lint run ./...` is clean.
- `vault.New` returns a Vault whose six accessors are all non-nil.
- A secret written through `v.Secrets().Set` round-trips through `Get` and leaves an audit entry behind.
- `EvaluateDetail` reports all four reasons and marks unreached rules.
- All four store backends implement the six `Count*` methods.
- Nothing outside this repo had to change: `vault.Entity` and every `vault.Err*` still resolve.

Slice 2 (the contract package and the first React pages) gets its own plan.
