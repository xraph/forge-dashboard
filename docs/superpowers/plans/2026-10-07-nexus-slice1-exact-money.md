# Nexus slice 1: exact money and the store harness, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every amount of money in Nexus an exact decimal from list price to storage, give every store backend the same honest behaviour, and prove it with a conformance suite that runs against memory, SQLite, PostgreSQL and MongoDB.

**Architecture:** A new `money` package wraps `shopspring/decimal` and is the only money type in the library. Prices, costs and budgets change type to it inside v1. Each store backend converts at its model boundary (Postgres `NUMERIC` through a small `numeric` scanner, SQLite `TEXT`, Mongo `Decimal128`), and every aggregate is built by one shared function in `usage` so the four backends cannot disagree. `store/storetest.Each` runs one test body against every backend.

**Tech Stack:** Go 1.26, `github.com/shopspring/decimal`, grove v1.6.3 (pgdriver on pgx v5, sqlitedriver on modernc, mongodriver on mongo-driver v2), templ v0.3.1001 (only to keep the retiring dashboard compiling), Docker for throwaway Postgres 17 and Mongo 7.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md` (forge-dashboard repo), sections "Slice 1: exact money and the store harness" and "Decisions" 2 and 7.

All paths below are relative to `/Users/rexraphael/Work/xraph/forgery/nexus` unless they start with `docs/`, which is the forge-dashboard repo.

## Global Constraints

- Work on `main` in both repos. No worktrees, no branches.
- Commit only your own paths: `git add <exact new files>`, then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .` or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.
- Commit messages carry no `Co-Authored-By` trailer and no Claude or Anthropic attribution.
- Nothing is pushed. Pushing needs Rex's yes.
- Money is `money.USD` everywhere it is money. No `float64` holds a price, a cost, a spend or a budget. `router.Candidate.Cost` is a routing weight and stays `float64`.
- An unknown cost is `nil` with `PricingStatus` saying why, never `$0`.
- An empty tenant id passed to a usage aggregate or query means every tenant, including unattributed requests. That rule is written on the interface and tested on every backend.
- Lists are cursor paged, newest first by ID, with no totals: `Limit` (default 50, max 500) and `Cursor` in, `NextCursor` out.
- Time windows are computed in Go, in UTC, by `usage.PeriodStart`. No backend computes "now".
- `dashboard/` must keep compiling until slice 7 deletes it. Edit `.templ` sources, never `*_templ.go`, and regenerate with `templ generate -path dashboard` (the installed CLI is v0.3.1001, the version that generated them).
- `_examples/grpc` has a committed binary at `_examples/grpc/grpc`. Never run `go build` inside `_examples/grpc` without `-o /dev/null`.
- `go test ./providers/...` from the root matches nothing: every provider is its own module in `go.work`. Loop over `providers/*/` instead.
- Lint with a fresh cache every time: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- Test containers run on ports 55632 (Postgres) and 57632 (Mongo), never 5432 or 27017, and are removed when the slice ends.

## Review Focus

1. **Existing Postgres and SQLite tenants whose quota JSON holds `"monthly_budget_usd": 12.5` as a number** must still load after the type change, as exactly `12.5`. Pinned in Task 6 by inserting a legacy row with raw SQL and reading it through the store.
2. **Existing Mongo tenant documents** use the driver's lowercased keys (`monthlybudgetusd`) with a double. They must still load, budget and all. Pinned in Task 6 with a raw BSON insert.
3. **Usage rows written before this slice** carry `cost_usd = 0` because nothing ever computed a cost. After migration they must read as unpriced (`nil` cost, `unpriced_model`), not as free. Pinned per backend in Task 5 with a legacy row inserted before `Migrate`.
4. **A cursor that is garbage, empty-looking or from another list** (a `tenant_` id handed to the usage log) must be refused with `paging.ErrInvalidCursor`, never treated as "first page". Pinned in Task 8.
5. **Summing many sub-cent costs on SQLite** must give the exact decimal (`1000 × 0.000000150 = 0.00015`), not float drift from SQLite's `SUM`, which coerces `TEXT` to `REAL`. Pinned in Task 7 on every backend.

---

### Task 1: The `money` package

**Files:**
- Create: `money/money.go`
- Create: `money/money_test.go`
- Modify: `go.mod`, `go.sum` (add `github.com/shopspring/decimal`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type USD struct{ /* unexported */ }`, zero value is $0
  - `var Zero USD`, `var ErrInvalid error`
  - `func Parse(s string) (USD, error)`: plain decimals only, refuses exponents, `NaN`, `Inf`, `+`, separators, spaces, empty
  - `func ParseLenient(s string) (USD, error)`: also accepts exponent notation, for values a database prints that way
  - `func MustParse(s string) USD`
  - `func Sum(vs ...USD) USD`
  - methods `Add(USD) USD`, `Sub(USD) USD`, `Mul(n int64) USD`, `PerMillion(n int64) USD`, `Cmp(USD) int`, `Equal(USD) bool`, `IsZero() bool`, `IsPositive() bool`, `IsNegative() bool`, `String() string`
  - JSON: marshals as a string (`"0.15"`); unmarshals a string strictly, a bare JSON number leniently and exactly from its text, and `null` as a no-op

- [ ] **Step 1: Add the dependency**

Run: `go get github.com/shopspring/decimal@v1.4.0`
Expected: `go.mod` gains `github.com/shopspring/decimal v1.4.0`.

- [ ] **Step 2: Write the failing tests**

`money/money_test.go`:

```go
package money_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/xraph/nexus/money"
)

func TestParseRefusesAnythingButAPlainDecimal(t *testing.T) {
	for _, s := range []string{"", "-", ".", "1e-7", "1E3", "NaN", "Inf", "+1", "1,000", " 1", "1 ", "0x10", "1.2.3", "$1"} {
		if _, err := money.Parse(s); !errors.Is(err, money.ErrInvalid) {
			t.Errorf("Parse(%q) err = %v, want ErrInvalid", s, err)
		}
	}
}

func TestStringIsExactAndCanonical(t *testing.T) {
	cases := map[string]string{
		"0.15":            "0.15",
		"10.00":           "10",
		"0.000000150":     "0.00000015",
		"-3":              "-3",
		"0":               "0",
		".5":              "0.5",
		"1284.3702190000": "1284.370219",
	}
	for in, want := range cases {
		if got := money.MustParse(in).String(); got != want {
			t.Errorf("MustParse(%q).String() = %q, want %q", in, got, want)
		}
	}
}

func TestPerMillionIsExact(t *testing.T) {
	cases := []struct {
		price  string
		tokens int64
		want   string
	}{
		{"0.15", 1, "0.00000015"},
		{"2.50", 1_000_000, "2.5"},
		{"0.075", 333, "0.000024975"},
		{"0.00001", 7, "0.00000000007"},
	}
	for _, c := range cases {
		if got := money.MustParse(c.price).PerMillion(c.tokens).String(); got != c.want {
			t.Errorf("%s per million × %d = %s, want %s", c.price, c.tokens, got, c.want)
		}
	}
}

func TestManySubCentAmountsSumWithoutDrift(t *testing.T) {
	total := money.Zero
	for range 1000 {
		total = total.Add(money.MustParse("0.000000150"))
	}
	if total.String() != "0.00015" {
		t.Fatalf("1000 × 0.000000150 = %s, want 0.00015", total)
	}
	if got := money.Sum(money.MustParse("0.1"), money.MustParse("0.2")).String(); got != "0.3" {
		t.Fatalf("0.1 + 0.2 = %s, want 0.3", got)
	}
}

func TestComparisons(t *testing.T) {
	a, b := money.MustParse("1.10"), money.MustParse("1.1")
	if !a.Equal(b) || a.Cmp(b) != 0 {
		t.Fatalf("1.10 and 1.1 should be equal")
	}
	if !money.MustParse("0.01").IsPositive() || !money.MustParse("-0.01").IsNegative() || !money.Zero.IsZero() {
		t.Fatalf("sign predicates are wrong")
	}
	if got := money.MustParse("0.03").Mul(3).Sub(money.MustParse("0.09")); !got.IsZero() {
		t.Fatalf("0.03 × 3 - 0.09 = %s, want 0", got)
	}
}

func TestParseLenientReadsExponentsExactly(t *testing.T) {
	got, err := money.ParseLenient("1.50E-7")
	if err != nil || got.String() != "0.00000015" {
		t.Fatalf("ParseLenient(1.50E-7) = %s, %v", got, err)
	}
	if _, err := money.ParseLenient("NaN"); !errors.Is(err, money.ErrInvalid) {
		t.Fatalf("ParseLenient(NaN) err = %v, want ErrInvalid", err)
	}
}

func TestJSON(t *testing.T) {
	type doc struct {
		Price money.USD  `json:"price"`
		Cost  *money.USD `json:"cost"`
	}
	b, err := json.Marshal(doc{Price: money.MustParse("0.15")})
	if err != nil || string(b) != `{"price":"0.15","cost":null}` {
		t.Fatalf("marshal = %s, %v", b, err)
	}

	var d doc
	if err := json.Unmarshal([]byte(`{"price":12.5,"cost":"0.000024975"}`), &d); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if d.Price.String() != "12.5" || d.Cost == nil || d.Cost.String() != "0.000024975" {
		t.Fatalf("unmarshal = %s, %v", d.Price, d.Cost)
	}

	// A legacy float written by encoding/json comes back exactly from its text.
	if err := json.Unmarshal([]byte(`{"price":1e-07}`), &d); err != nil || d.Price.String() != "0.0000001" {
		t.Fatalf("bare exponent number = %s, %v", d.Price, err)
	}

	// A string must be a plain decimal.
	if err := json.Unmarshal([]byte(`{"price":"1e-7"}`), &d); err == nil {
		t.Fatalf("a string in exponent form should be refused")
	}

	// null leaves the value alone.
	d.Price = money.MustParse("3")
	if err := json.Unmarshal([]byte(`{"price":null}`), &d); err != nil || d.Price.String() != "3" {
		t.Fatalf("null = %s, %v", d.Price, err)
	}
}
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `go test ./money/`
Expected: FAIL to compile: `no required module provides package github.com/xraph/nexus/money` or `undefined: money.Parse`.

- [ ] **Step 4: Write the package**

`money/money.go`:

```go
// Package money holds exact amounts of US dollars. Nothing in it rounds:
// rounding is a display decision, made where an amount is shown.
package money

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/shopspring/decimal"
)

// USD is an exact decimal amount of US dollars. The zero value is $0.
type USD struct{ d decimal.Decimal }

// Zero is $0.
var Zero USD

// ErrInvalid reports a string that is not an amount.
var ErrInvalid = errors.New("money: invalid amount")

// Parse reads a plain decimal such as "0.15", ".5" or "-3". It refuses
// exponents, NaN, Inf, a leading plus sign, separators and spaces, so an
// amount someone typed is read the way they typed it.
func Parse(s string) (USD, error) {
	if !plainDecimal(s) {
		return Zero, fmt.Errorf("%w: %q", ErrInvalid, s)
	}
	return parse(s)
}

// ParseLenient also accepts exponent notation ("1.50E-7"). It exists for
// values read back from a database or an old JSON document that prints
// decimals that way. The result is still exact.
func ParseLenient(s string) (USD, error) {
	return parse(s)
}

// MustParse is Parse for literals. It panics on a malformed amount.
func MustParse(s string) USD {
	u, err := Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}

func parse(s string) (USD, error) {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return Zero, fmt.Errorf("%w: %q", ErrInvalid, s)
	}
	return USD{d: d}, nil
}

func plainDecimal(s string) bool {
	if s == "" {
		return false
	}
	i, digits, dot := 0, 0, false
	if s[0] == '-' {
		i = 1
	}
	for ; i < len(s); i++ {
		switch c := s[i]; {
		case c >= '0' && c <= '9':
			digits++
		case c == '.' && !dot:
			dot = true
		default:
			return false
		}
	}
	return digits > 0
}

// Sum adds amounts exactly.
func Sum(vs ...USD) USD {
	total := Zero
	for _, v := range vs {
		total = total.Add(v)
	}
	return total
}

// Add returns u + v.
func (u USD) Add(v USD) USD { return USD{d: u.d.Add(v.d)} }

// Sub returns u - v.
func (u USD) Sub(v USD) USD { return USD{d: u.d.Sub(v.d)} }

// Mul multiplies by a whole count.
func (u USD) Mul(n int64) USD { return USD{d: u.d.Mul(decimal.NewFromInt(n))} }

// PerMillion is the cost of n units at u per million units: u × n / 10⁶.
func (u USD) PerMillion(n int64) USD {
	return USD{d: u.d.Mul(decimal.NewFromInt(n)).Shift(-6)}
}

// Cmp returns -1, 0 or +1 as u is less than, equal to or greater than v.
func (u USD) Cmp(v USD) int { return u.d.Cmp(v.d) }

// Equal reports whether u and v are the same amount (1.10 equals 1.1).
func (u USD) Equal(v USD) bool { return u.d.Equal(v.d) }

// IsZero reports whether u is $0.
func (u USD) IsZero() bool { return u.d.IsZero() }

// IsPositive reports whether u is more than $0.
func (u USD) IsPositive() bool { return u.d.IsPositive() }

// IsNegative reports whether u is less than $0.
func (u USD) IsNegative() bool { return u.d.IsNegative() }

// String is the exact amount in plain decimal notation with no trailing
// zeros: "0.15", "1284.370219", "0".
func (u USD) String() string { return u.d.String() }

// MarshalJSON writes the amount as a JSON string, so no reader can turn it
// into a float on the way in.
func (u USD) MarshalJSON() ([]byte, error) { return json.Marshal(u.String()) }

// UnmarshalJSON reads a JSON string strictly, a bare JSON number leniently
// and exactly from its text (budgets were stored as numbers before amounts
// were strings), and treats null as "leave the value alone".
func (u *USD) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if bytes.Equal(b, []byte("null")) {
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		v, err := Parse(s)
		if err != nil {
			return err
		}
		*u = v
		return nil
	}
	v, err := ParseLenient(string(b))
	if err != nil {
		return err
	}
	*u = v
	return nil
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `go test ./money/ -v`
Expected: PASS, all seven tests.

If `TestStringIsExactAndCanonical` fails on `".5"`, shopspring rejects a leading dot: prefix a `0` in `parse` when `s` starts with `.` or `-.`, and re-run.

- [ ] **Step 6: Lint and commit**

Run: `go vet ./money/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./money/...; rm -rf $C`
Expected: no issues.

```bash
git add money/money.go money/money_test.go
git commit --only -m "feat(money): add an exact decimal dollar type" -- money/money.go money/money_test.go go.mod go.sum
git show --stat HEAD
```

---

### Task 2: Prices in `money.USD`, and an exact `model.Cost`

**Files:**
- Modify: `provider/model.go` (Pricing fields)
- Create: `usage/pricing.go` (`PricingStatus`)
- Modify: `model/cost.go` (replace the float estimators with `Cost`)
- Create: `model/cost_test.go`
- Modify: all 29 `providers/*/models.go`
- Modify: `providers/anthropic/models_test.go`, `providers/openai/models_test.go`, `providertest/conformance.go`, and any other file the Step 7 grep finds
- Modify: `dashboard/components/model_table.templ` (+ regenerated `model_table_templ.go`)

**Interfaces:**
- Consumes: `money.USD`, `money.MustParse`, `USD.PerMillion`, `USD.IsZero` (Task 1).
- Produces:
  - `provider.Pricing{InputPerMillion, OutputPerMillion, EmbeddingPerMillion money.USD}`, JSON names unchanged, `embedding_per_million` uses `omitzero`
  - `usage.PricingStatus` with `usage.PricingPriced = "priced"`, `usage.PricingUnpricedModel = "unpriced_model"`, `usage.PricingCached = "cached"`
  - `func model.Cost(u provider.Usage, p provider.Pricing, embedding bool) (*money.USD, usage.PricingStatus)`
  - `model.CostEstimate`, `model.EstimateCost` and `model.EstimateCostFromTokens` are deleted (they had no callers)

- [ ] **Step 1: Write the failing test**

`model/cost_test.go`:

```go
package model_test

import (
	"testing"

	"github.com/xraph/nexus/model"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/usage"
)

func TestCostIsExactListPriceOverReportedTokens(t *testing.T) {
	p := provider.Pricing{InputPerMillion: money.MustParse("2.50"), OutputPerMillion: money.MustParse("10.00")}
	cost, status := model.Cost(provider.Usage{PromptTokens: 1234, CompletionTokens: 567}, p, false)
	if status != usage.PricingPriced || cost == nil {
		t.Fatalf("status = %s, cost = %v", status, cost)
	}
	// 1234 × 2.50 / 1e6 + 567 × 10 / 1e6 = 0.003085 + 0.00567
	if cost.String() != "0.008755" {
		t.Fatalf("cost = %s, want 0.008755", cost)
	}
}

func TestCostOfAModelWithNoPriceIsUnknownNotFree(t *testing.T) {
	cost, status := model.Cost(provider.Usage{PromptTokens: 10, CompletionTokens: 10}, provider.Pricing{}, false)
	if cost != nil || status != usage.PricingUnpricedModel {
		t.Fatalf("cost = %v, status = %s; want nil and unpriced_model", cost, status)
	}
}

func TestEmbeddingCostUsesTheEmbeddingPrice(t *testing.T) {
	p := provider.Pricing{EmbeddingPerMillion: money.MustParse("0.02")}
	cost, status := model.Cost(provider.Usage{PromptTokens: 5000}, p, true)
	if status != usage.PricingPriced || cost == nil || cost.String() != "0.0001" {
		t.Fatalf("cost = %v, status = %s; want 0.0001 priced", cost, status)
	}
	if cost, status := model.Cost(provider.Usage{PromptTokens: 5000}, provider.Pricing{InputPerMillion: money.MustParse("1")}, true); cost != nil || status != usage.PricingUnpricedModel {
		t.Fatalf("an embedding on a chat-only price list should be unpriced, got %v %s", cost, status)
	}
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `go test ./model/`
Expected: FAIL to compile: `undefined: model.Cost` and `undefined: usage.PricingPriced`.

- [ ] **Step 3: Add `PricingStatus`**

`usage/pricing.go`:

```go
package usage

// PricingStatus says whether a request's cost is known, and if not, why.
type PricingStatus string

const (
	// PricingPriced: the cost is the model's list price over the tokens the
	// provider reported.
	PricingPriced PricingStatus = "priced"
	// PricingUnpricedModel: the model has no price for the tokens used, so
	// the cost is unknown. It is never reported as $0.
	PricingUnpricedModel PricingStatus = "unpriced_model"
	// PricingCached: served from the response cache, so no provider was
	// called and the cost is exactly $0.
	PricingCached PricingStatus = "cached"
)
```

- [ ] **Step 4: Change `Pricing` and replace the estimators**

`provider/model.go`, replace the `Pricing` type and add the import:

```go
package provider

import "github.com/xraph/nexus/money"

// Model describes an available LLM model.
type Model struct {
	ID            string       `json:"id"`       // e.g., "gpt-4o"
	Provider      string       `json:"provider"` // e.g., "openai"
	Name          string       `json:"name"`     // human-readable
	Capabilities  Capabilities `json:"capabilities"`
	ContextWindow int          `json:"context_window"`
	MaxOutput     int          `json:"max_output"`
	Pricing       Pricing      `json:"pricing"`
}

// Pricing is a model's list price per million tokens. A zero price means the
// model has no price for that kind of token, not that the tokens are free.
type Pricing struct {
	InputPerMillion     money.USD `json:"input_per_million"`
	OutputPerMillion    money.USD `json:"output_per_million"`
	EmbeddingPerMillion money.USD `json:"embedding_per_million,omitzero"`
}
```

`model/cost.go`, replace the whole file:

```go
package model

import (
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/usage"
)

// Cost prices usage at a model's list prices, exactly: prompt tokens at the
// input price plus completion tokens at the output price, or prompt tokens
// at the embedding price for an embedding. When the model has no price for
// the tokens used it returns nil and PricingUnpricedModel, so an unknown
// cost is never reported as $0.
//
// The result is only as good as the token counts the provider reported.
// Providers do not report cache or thinking tokens today, so those are not
// priced.
func Cost(u provider.Usage, p provider.Pricing, embedding bool) (*money.USD, usage.PricingStatus) {
	if embedding {
		if p.EmbeddingPerMillion.IsZero() {
			return nil, usage.PricingUnpricedModel
		}
		c := p.EmbeddingPerMillion.PerMillion(int64(u.PromptTokens))
		return &c, usage.PricingPriced
	}
	if p.InputPerMillion.IsZero() && p.OutputPerMillion.IsZero() {
		return nil, usage.PricingUnpricedModel
	}
	c := p.InputPerMillion.PerMillion(int64(u.PromptTokens)).
		Add(p.OutputPerMillion.PerMillion(int64(u.CompletionTokens)))
	return &c, usage.PricingPriced
}
```

- [ ] **Step 5: Run the model tests**

Run: `go test ./model/ ./money/ ./provider/`
Expected: PASS.

- [ ] **Step 6: Convert every provider's price literals, verbatim**

Record the literals first, then rewrite them so the text of each number is carried into the string unchanged:

```bash
grep -hoE '(Input|Output|Embedding)PerMillion:[[:space:]]*[0-9]+(\.[0-9]+)?' providers/*/models.go \
  | sed -E 's/:[[:space:]]*/=/' | sort > /tmp/nexus-prices-before.txt
wc -l /tmp/nexus-prices-before.txt
for f in providers/*/models.go; do
  perl -pi -e 's/\b((?:Input|Output|Embedding)PerMillion):\s*([0-9]+(?:\.[0-9]+)?)/$1: money.MustParse("$2")/g' "$f"
done
goimports -w providers/*/models.go
grep -hoE '(Input|Output|Embedding)PerMillion: money\.MustParse\("[0-9.]+"\)' providers/*/models.go \
  | sed -E 's/: money\.MustParse\("([0-9.]+)"\)/=\1/' | sort > /tmp/nexus-prices-after.txt
diff /tmp/nexus-prices-before.txt /tmp/nexus-prices-after.txt && echo "prices carried over verbatim"
grep -nE 'PerMillion:[[:space:]]*[0-9]' providers/*/models.go || echo "no float literal left"
```

Expected: the same line count before and after, `prices carried over verbatim`, `no float literal left`. A `MustParse` on a literal that `Parse` refuses would panic at init, and Step 8's tests load every model list, so the conversion cannot slip through.

If `goimports` did not add `"github.com/xraph/nexus/money"` to a file (it resolves the workspace module), add it by hand next to the existing `provider` import.

- [ ] **Step 7: Fix the float comparisons on prices**

Find every remaining use:

Run: `grep -rn 'PerMillion' --include='*.go' . | grep -v '/models.go:' | grep -v '^./money/'`

Change each comparison to the `money.USD` predicates. The known ones:

`providers/anthropic/models_test.go` (around line 97):

```go
		if !m.Pricing.InputPerMillion.IsPositive() {
			t.Errorf("model %q Pricing.InputPerMillion = %s, want > 0", m.ID, m.Pricing.InputPerMillion)
		}
		if !m.Pricing.OutputPerMillion.IsPositive() {
			t.Errorf("model %q Pricing.OutputPerMillion = %s, want > 0", m.ID, m.Pricing.OutputPerMillion)
		}
```

`providers/openai/models_test.go` (around lines 50 to 65 and 118):

```go
			hasChatPricing := m.Pricing.InputPerMillion.IsPositive() || m.Pricing.OutputPerMillion.IsPositive()
			hasEmbedPricing := m.Pricing.EmbeddingPerMillion.IsPositive()
			// …unchanged lines between…
			if m.Pricing.InputPerMillion.IsNegative() {
				t.Errorf("model %q InputPerMillion = %s, must not be negative", m.ID, m.Pricing.InputPerMillion)
			}
			if m.Pricing.OutputPerMillion.IsNegative() {
				t.Errorf("model %q OutputPerMillion = %s, must not be negative", m.ID, m.Pricing.OutputPerMillion)
			}
			if m.Pricing.EmbeddingPerMillion.IsNegative() {
				t.Errorf("model %q EmbeddingPerMillion = %s, must not be negative", m.ID, m.Pricing.EmbeddingPerMillion)
			}
```

and at line 118:

```go
				if !m.Pricing.EmbeddingPerMillion.IsPositive() {
```

`providertest/conformance.go` (lines 58 to 59):

```go
			hasChatPricing := m.Pricing.InputPerMillion.IsPositive() || m.Pricing.OutputPerMillion.IsPositive()
			hasEmbedPricing := m.Pricing.EmbeddingPerMillion.IsPositive()
```

Any other hit from the grep gets the same treatment: `> 0` becomes `.IsPositive()`, `< 0` becomes `.IsNegative()`, `== 0` becomes `.IsZero()`, and a `%f` verb on a price becomes `%s`.

- [ ] **Step 8: Keep the retiring dashboard compiling**

`dashboard/components/model_table.templ`: add `"github.com/xraph/nexus/money"` to the file's Go import block and replace `formatPricing`:

```go
func formatPricing(v money.USD) string {
	if v.IsZero() {
		return "-"
	}
	return "$" + v.String()
}
```

Run: `templ generate -path dashboard && gofmt -l dashboard`
Expected: templ reports the files it generated; `gofmt -l` prints nothing.

- [ ] **Step 9: Run everything the change touches**

```bash
go build ./... && go test ./...
fail=0; for d in providers/*/; do (cd "$d" && go vet ./... && go test ./...) >/dev/null 2>&1 || { echo "FAIL $d"; fail=1; }; done; echo "providers fail=$fail"
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
```

Expected: root build and tests pass, `providers fail=0`, lint 0 issues. For a failing provider, run its tests verbosely, fix the float comparison it still has, and re-run.

- [ ] **Step 10: Commit**

```bash
git add usage/pricing.go model/cost_test.go
git commit --only -m "feat(model)!: price models in exact decimals and compute cost exactly

Pricing fields are money.USD now, so every provider's price list moves from
float literals to money.MustParse with the same digits. model.Cost replaces
the float estimators nothing called, and a model with no price comes back as
unpriced rather than free." -- provider/model.go usage/pricing.go model/cost.go model/cost_test.go providers/*/models.go providers/anthropic/models_test.go providers/openai/models_test.go providertest/conformance.go dashboard/components/model_table.templ dashboard/components/model_table_templ.go
git show --stat HEAD
```

If Step 7's grep touched other files, add them to the path list.

---

### Task 3: The conformance harness

**Files:**
- Create: `paging/paging.go`, `paging/paging_test.go`
- Create: `store/storetest/storetest.go` (backend openers and `Each`)
- Create: `store/storetest/fixtures.go` (`Now`, `Tenant`, `Key`, `InsertTenant`, `SameTenant`, `SameKey`)
- Create: `store/storetest/conformance_test.go`
- Modify: `go.mod` (pgx and mongo-driver become direct requires through `go mod tidy`)

**Interfaces:**
- Consumes: `store.Store`, `store.NewMemory`, `sqlite.New`, `postgres.New`, `mongo.New` (existing).
- Produces:
  - `paging.DefaultLimit = 50`, `paging.MaxLimit = 500`, `paging.ErrInvalidCursor`
  - `func paging.Limit(n int) int`
  - `func paging.CheckCursor(cursor string, prefix id.Prefix) error`
  - `func paging.Trim[T any](rows []T, limit int, idOf func(T) string) ([]T, string)`
  - `func storetest.Each(t *testing.T, fn func(t *testing.T, s store.Store))`
  - `func storetest.OpenSQLiteDB(t *testing.T) *grove.DB` (unmigrated, for legacy tests)
  - `func storetest.OpenPostgresDB(t *testing.T) *grove.DB` (skips without `NEXUS_TEST_POSTGRES_DSN`; own schema)
  - `func storetest.OpenMongoDB(t *testing.T) (*grove.DB, string)` (skips without `NEXUS_TEST_MONGO_URI`; returns the per-test database name)
  - `func storetest.Now() time.Time`, `func storetest.Tenant(slug string) *tenant.Tenant`, `func storetest.Key(tenantID id.TenantID, name string) *key.APIKey`, `func storetest.InsertTenant(t *testing.T, s store.Store) *tenant.Tenant`, `func storetest.SameTenant(t *testing.T, got, want *tenant.Tenant)`, `func storetest.SameKey(t *testing.T, got, want *key.APIKey)`

- [ ] **Step 1: Start the throwaway containers**

```bash
docker run -d --rm --name nexus-test-pg -e POSTGRES_PASSWORD=nexus -e POSTGRES_DB=nexus -p 55632:5432 postgres:17-alpine
docker run -d --rm --name nexus-test-mongo -p 57632:27017 mongo:7
export NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable"
export NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test"
```

Every later step that says "run the conformance suite" assumes these two variables are exported. Without them the Postgres and Mongo subtests skip, which is fine for a quick loop but not for finishing a task.

- [ ] **Step 2: Write the failing paging test**

`paging/paging_test.go`:

```go
package paging_test

import (
	"errors"
	"testing"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/paging"
)

func TestLimit(t *testing.T) {
	for in, want := range map[int]int{-1: 50, 0: 50, 1: 1, 500: 500, 501: 500} {
		if got := paging.Limit(in); got != want {
			t.Errorf("Limit(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestCheckCursor(t *testing.T) {
	if err := paging.CheckCursor("", id.PrefixUsage); err != nil {
		t.Fatalf("empty cursor is the first page, got %v", err)
	}
	if err := paging.CheckCursor(id.NewUsageID().String(), id.PrefixUsage); err != nil {
		t.Fatalf("a usage id is a usage cursor, got %v", err)
	}
	for _, bad := range []string{"x", " ", id.NewTenantID().String(), "usage_"} {
		if err := paging.CheckCursor(bad, id.PrefixUsage); !errors.Is(err, paging.ErrInvalidCursor) {
			t.Errorf("CheckCursor(%q) = %v, want ErrInvalidCursor", bad, err)
		}
	}
}

func TestTrim(t *testing.T) {
	ids := func(s string) string { return s }
	page, next := paging.Trim([]string{"c", "b", "a"}, 2, ids)
	if len(page) != 2 || next != "b" {
		t.Fatalf("Trim over limit = %v, %q", page, next)
	}
	page, next = paging.Trim([]string{"c", "b"}, 2, ids)
	if len(page) != 2 || next != "" {
		t.Fatalf("Trim at limit = %v, %q", page, next)
	}
}
```

Run: `go test ./paging/`
Expected: FAIL to compile, `undefined: paging.Limit`.

- [ ] **Step 3: Write `paging`**

`paging/paging.go`:

```go
// Package paging holds the cursor rules every Nexus list shares. Lists are
// ordered newest first by ID (IDs are UUIDv7 TypeIDs, so their text sorts in
// creation order), and a page is continued from the last ID it returned.
// There are no totals: a total on a growing list is expensive and usually
// an estimate.
package paging

import (
	"errors"
	"fmt"

	"github.com/xraph/nexus/id"
)

const (
	// DefaultLimit is the page size when none is asked for.
	DefaultLimit = 50
	// MaxLimit is the largest page a store returns.
	MaxLimit = 500
)

// ErrInvalidCursor reports a cursor that is not an ID from the list it was
// handed to. It is never treated as "start again from the top".
var ErrInvalidCursor = errors.New("nexus: invalid cursor")

// Limit clamps a requested page size.
func Limit(n int) int {
	if n <= 0 {
		return DefaultLimit
	}
	if n > MaxLimit {
		return MaxLimit
	}
	return n
}

// CheckCursor accepts "" (the first page) or an ID of the given kind.
func CheckCursor(cursor string, prefix id.Prefix) error {
	if cursor == "" {
		return nil
	}
	if _, err := id.ParseWithPrefix(cursor, prefix); err != nil {
		return fmt.Errorf("%w: %q", ErrInvalidCursor, cursor)
	}
	return nil
}

// Trim takes the limit+1 rows a store fetched and returns the page and the
// cursor for the next one, or "" when this is the last page.
func Trim[T any](rows []T, limit int, idOf func(T) string) ([]T, string) {
	if len(rows) <= limit {
		return rows, ""
	}
	page := rows[:limit]
	return page, idOf(page[limit-1])
}
```

Run: `go test ./paging/`
Expected: PASS.

- [ ] **Step 4: Write the backend openers**

`store/storetest/storetest.go`:

```go
// Package storetest runs one conformance test body against every Nexus
// store backend: memory and SQLite always, PostgreSQL when
// NEXUS_TEST_POSTGRES_DSN is set and MongoDB when NEXUS_TEST_MONGO_URI is
// set. Each subtest gets a database nothing else touches.
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	mongodrv "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/mongodriver"
	"github.com/xraph/grove/drivers/pgdriver"
	"github.com/xraph/grove/drivers/sqlitedriver"

	"github.com/xraph/nexus/store"
	mongostore "github.com/xraph/nexus/store/mongo"
	pgstore "github.com/xraph/nexus/store/postgres"
	sqlitestore "github.com/xraph/nexus/store/sqlite"
)

const (
	envPostgres = "NEXUS_TEST_POSTGRES_DSN"
	envMongo    = "NEXUS_TEST_MONGO_URI"
)

// Each runs fn once per backend, as a subtest named after it, against a
// migrated store of that backend.
func Each(t *testing.T, fn func(t *testing.T, s store.Store)) {
	t.Helper()
	backends := []struct {
		name string
		open func(t *testing.T) store.Store
	}{
		{"memory", func(*testing.T) store.Store { return store.NewMemory() }},
		{"sqlite", func(t *testing.T) store.Store { return migrated(t, sqlitestore.New(OpenSQLiteDB(t))) }},
		{"postgres", func(t *testing.T) store.Store { return migrated(t, pgstore.New(OpenPostgresDB(t))) }},
		{"mongo", func(t *testing.T) store.Store { db, _ := OpenMongoDB(t); return migrated(t, mongostore.New(db)) }},
	}
	for _, b := range backends {
		t.Run(b.name, func(t *testing.T) { fn(t, b.open(t)) })
	}
}

func migrated(t *testing.T, s store.Store) store.Store {
	t.Helper()
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return s
}

// OpenSQLiteDB opens an empty SQLite database in the test's temp dir. It is
// not migrated, so a test can lay down a legacy schema first.
func OpenSQLiteDB(t *testing.T) *grove.DB {
	t.Helper()
	drv := sqlitedriver.New()
	if err := drv.Open(context.Background(), filepath.Join(t.TempDir(), "nexus.db")); err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return groveOpen(t, drv)
}

// OpenPostgresDB opens the database NEXUS_TEST_POSTGRES_DSN names, confined
// to a schema of this test's own that is dropped when the test ends. It
// skips when the variable is unset and refuses the default port.
func OpenPostgresDB(t *testing.T) *grove.DB {
	t.Helper()
	dsn := os.Getenv(envPostgres)
	if dsn == "" {
		t.Skipf("%s is not set", envPostgres)
	}
	if strings.Contains(dsn, ":5432") {
		t.Fatalf("%s points at the default port; refusing to write to what may be a live database", envPostgres)
	}
	schema := "nexus_test_" + randomHex(t)
	quoted := pgx.Identifier{schema}.Sanitize()
	pgExec(t, dsn, "CREATE SCHEMA "+quoted)
	t.Cleanup(func() { pgExec(t, dsn, "DROP SCHEMA IF EXISTS "+quoted+" CASCADE") })

	scoped, err := pinSearchPath(dsn, schema)
	if err != nil {
		t.Fatalf("pin search_path: %v", err)
	}
	drv := pgdriver.New()
	if err := drv.Open(context.Background(), scoped); err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	return groveOpen(t, drv)
}

// OpenMongoDB opens a database of this test's own on the server
// NEXUS_TEST_MONGO_URI names and drops it when the test ends. It returns the
// database name so a test can write raw documents. It skips when the
// variable is unset and refuses the default port.
func OpenMongoDB(t *testing.T) (*grove.DB, string) {
	t.Helper()
	uri := os.Getenv(envMongo)
	if uri == "" {
		t.Skipf("%s is not set", envMongo)
	}
	if strings.Contains(uri, ":27017") {
		t.Fatalf("%s points at the default port; refusing to write to what may be a live database", envMongo)
	}
	u, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse %s: %v", envMongo, err)
	}
	name := "nexus_test_" + randomHex(t)
	u.Path = "/" + name
	scoped := u.String()

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		client, err := mongodrv.Connect(options.Client().ApplyURI(scoped))
		if err != nil {
			t.Errorf("connect to drop %s: %v", name, err)
			return
		}
		defer func() { _ = client.Disconnect(ctx) }()
		if err := client.Database(name).Drop(ctx); err != nil {
			t.Errorf("drop %s: %v", name, err)
		}
	})

	drv := mongodriver.New()
	if err := drv.Open(context.Background(), scoped); err != nil {
		t.Fatalf("open mongo: %v", err)
	}
	return groveOpen(t, drv), name
}

// MongoClient connects to the server NEXUS_TEST_MONGO_URI names, for tests
// that write raw documents. It is closed when the test ends.
func MongoClient(t *testing.T) *mongodrv.Client {
	t.Helper()
	client, err := mongodrv.Connect(options.Client().ApplyURI(os.Getenv(envMongo)))
	if err != nil {
		t.Fatalf("connect mongo: %v", err)
	}
	t.Cleanup(func() { _ = client.Disconnect(context.Background()) })
	return client
}

func groveOpen(t *testing.T, drv grove.Driver) *grove.DB {
	t.Helper()
	db, err := grove.Open(drv)
	if err != nil {
		t.Fatalf("grove open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func randomHex(t *testing.T) string {
	t.Helper()
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("random suffix: %v", err)
	}
	return hex.EncodeToString(b[:])
}

func pgExec(t *testing.T, dsn, stmt string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err := conn.Exec(ctx, stmt); err != nil {
		t.Fatalf("%s: %v", stmt, err)
	}
}

// pinSearchPath sets search_path in either DSN spelling. The migrations
// create unqualified tables, so they land in the test's schema.
func pinSearchPath(dsn, schema string) (string, error) {
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return dsn + " search_path=" + schema, nil
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String(), nil
}
```

Check the type `grove.Open` accepts before compiling: run `go doc github.com/xraph/grove Open`. If its parameter is not `grove.Driver`, change `groveOpen`'s parameter to that type.

- [ ] **Step 5: Write the fixtures**

`store/storetest/fixtures.go`:

```go
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"reflect"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/tenant"
)

// Now is a timestamp every backend stores exactly: UTC, whole seconds.
// SQLite keeps tenant and key times as RFC3339 text with no fraction, and
// Mongo keeps milliseconds.
func Now() time.Time { return time.Now().UTC().Truncate(time.Second) }

// Tenant builds a tenant with every field filled, so a backend that drops a
// field fails the round trip instead of passing it by omission.
func Tenant(slug string) *tenant.Tenant {
	now := Now()
	cache := true
	return &tenant.Tenant{
		ID:     id.NewTenantID(),
		Name:   "Tenant " + slug,
		Slug:   slug,
		Status: tenant.StatusActive,
		Quota: tenant.Quota{
			RPM:               60,
			TPM:               90_000,
			DailyRequests:     1_000,
			MaxTokensPerReq:   4_096,
			MaxStreamDuration: 90 * time.Second,
			MaxStreamTokens:   8_192,
		},
		Config: tenant.Config{
			AllowedModels:   []string{"gpt-4o", "claude-sonnet-4-5"},
			BlockedModels:   []string{"o1"},
			DefaultModel:    "gpt-4o-mini",
			RoutingStrategy: "priority",
			GuardrailPolicy: "strict",
			CacheEnabled:    &cache,
			Metadata:        map[string]string{"tier": "gold"},
		},
		Metadata:  map[string]string{"owner": "billing"},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// Key builds a key with every field filled.
func Key(tenantID id.TenantID, name string) *key.APIKey {
	now := Now()
	expires, used := now.Add(30*24*time.Hour), now.Add(-time.Hour)
	return &key.APIKey{
		ID:         id.NewKeyID(),
		TenantID:   tenantID,
		Name:       name,
		Prefix:     "nxs_" + randomHex8(),
		Hash:       "hash-of-" + name,
		Scopes:     []string{"completions", "models"},
		Status:     key.KeyActive,
		ExpiresAt:  &expires,
		LastUsedAt: &used,
		Metadata:   map[string]string{"team": "search"},
		CreatedAt:  now,
	}
}

// InsertTenant stores a fresh tenant with a unique slug and returns it.
func InsertTenant(t *testing.T, s store.Store) *tenant.Tenant {
	t.Helper()
	tn := Tenant("t-" + randomHex8())
	if err := s.Tenants().Insert(context.Background(), tn); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	return tn
}

// SameTenant fails the test unless got and want match field by field.
func SameTenant(t *testing.T, got, want *tenant.Tenant) {
	t.Helper()
	if got == nil {
		t.Fatalf("tenant is nil")
	}
	g, w := *got, *want
	if g.ID.String() != w.ID.String() {
		t.Errorf("tenant id = %s, want %s", g.ID, w.ID)
	}
	if !g.CreatedAt.Equal(w.CreatedAt) || !g.UpdatedAt.Equal(w.UpdatedAt) {
		t.Errorf("tenant times = %s/%s, want %s/%s", g.CreatedAt, g.UpdatedAt, w.CreatedAt, w.UpdatedAt)
	}
	g.ID, w.ID = id.Nil, id.Nil
	g.CreatedAt, w.CreatedAt, g.UpdatedAt, w.UpdatedAt = time.Time{}, time.Time{}, time.Time{}, time.Time{}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("tenant round trip:\n got %+v\nwant %+v", g, w)
	}
}

// SameKey fails the test unless got and want match field by field.
func SameKey(t *testing.T, got, want *key.APIKey) {
	t.Helper()
	if got == nil {
		t.Fatalf("key is nil")
	}
	g, w := *got, *want
	if g.ID.String() != w.ID.String() || g.TenantID.String() != w.TenantID.String() {
		t.Errorf("key ids = %s/%s, want %s/%s", g.ID, g.TenantID, w.ID, w.TenantID)
	}
	sameTimePtr(t, "expires_at", g.ExpiresAt, w.ExpiresAt)
	sameTimePtr(t, "last_used_at", g.LastUsedAt, w.LastUsedAt)
	if !g.CreatedAt.Equal(w.CreatedAt) {
		t.Errorf("key created_at = %s, want %s", g.CreatedAt, w.CreatedAt)
	}
	g.ID, w.ID, g.TenantID, w.TenantID = id.Nil, id.Nil, id.Nil, id.Nil
	g.ExpiresAt, w.ExpiresAt, g.LastUsedAt, w.LastUsedAt = nil, nil, nil, nil
	g.CreatedAt, w.CreatedAt = time.Time{}, time.Time{}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("key round trip:\n got %+v\nwant %+v", g, w)
	}
}

func sameTimePtr(t *testing.T, field string, got, want *time.Time) {
	t.Helper()
	switch {
	case got == nil && want == nil:
	case got == nil || want == nil:
		t.Errorf("%s = %v, want %v", field, got, want)
	case !got.Equal(*want):
		t.Errorf("%s = %s, want %s", field, got, want)
	}
}

func randomHex8() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
```

- [ ] **Step 6: Write the first conformance tests**

`store/storetest/conformance_test.go`:

```go
package storetest_test

import (
	"context"
	"testing"

	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
)

func TestTenantRoundTripsEveryField(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		want := storetest.InsertTenant(t, s)
		got, err := s.Tenants().FindByID(context.Background(), want.ID.String())
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		storetest.SameTenant(t, got, want)

		bySlug, err := s.Tenants().FindBySlug(context.Background(), want.Slug)
		if err != nil {
			t.Fatalf("find by slug: %v", err)
		}
		storetest.SameTenant(t, bySlug, want)
	})
}

func TestKeyRoundTripsEveryField(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		want := storetest.Key(tn.ID, "search-indexer")
		if err := s.Keys().Insert(ctx, want); err != nil {
			t.Fatalf("insert key: %v", err)
		}
		got, err := s.Keys().FindByID(ctx, want.ID.String())
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		storetest.SameKey(t, got, want)
	})
}
```

- [ ] **Step 7: Run the suite and record what each backend does**

```bash
go mod tidy
go test ./store/... -run 'RoundTrip' -v 2>&1 | grep -E '^(=== RUN|--- |    |ok|FAIL)'
```

Expected: `memory`, `sqlite`, `postgres` and `mongo` subtests all run (none skip) and pass.

These tests pin behaviour the stores already claim to have. If a backend fails, that is a finding: read the failure, fix the backend's model mapping in this task, and write the fix into the slice's "What slice 1 found" notes (Task 10). Do not weaken the fixture to make it pass.

- [ ] **Step 8: Lint and commit**

```bash
go build ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add paging/paging.go paging/paging_test.go store/storetest/storetest.go store/storetest/fixtures.go store/storetest/conformance_test.go
git commit --only -m "test(store): run one conformance suite against every backend

storetest.Each runs a test body on memory and SQLite always, and on Postgres
and Mongo when NEXUS_TEST_POSTGRES_DSN and NEXUS_TEST_MONGO_URI are set, each
in a schema or database of its own. The first tests round-trip a tenant and a
key with every field filled. paging holds the cursor rules the lists move to." -- paging/paging.go paging/paging_test.go store/storetest/storetest.go store/storetest/fixtures.go store/storetest/conformance_test.go go.mod go.sum
git show --stat HEAD
```

---

### Task 4: Not found is an error, and memory stops sharing its rows

**Files:**
- Create: `tenant/errors.go`, `key/errors.go`
- Modify: `tenant/tenant.go`, `key/key.go` (doc comments on `Store`)
- Modify: `store/memory.go` (split into the files below)
- Create: `store/memory_tenant.go`, `store/memory_key.go`, `store/memory_usage.go`
- Modify: `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go`
- Modify: `api/tenant_handler.go`, `api/key_handler.go` (404 on not found)
- Modify: `store/storetest/conformance_test.go`

**Interfaces:**
- Consumes: `storetest.Each`, `storetest.InsertTenant`, `storetest.Key` (Task 3).
- Produces:
  - `tenant.ErrNotFound`, `key.ErrNotFound`
  - `tenant.Store.FindByID`, `FindBySlug` and `Update` return `tenant.ErrNotFound` when no tenant matches; `Delete` of an unknown id stays a no-op
  - `key.Store.FindByID`, `FindByPrefix` and `Update` return `key.ErrNotFound`
  - The memory store stores and returns copies

The sentinels live in `tenant` and `key`, not `store`, because `store` imports both and `tenant` importing `store` would be a cycle. The spec said `store.ErrNotFound`; Task 10 records the change.

- [ ] **Step 1: Write the failing tests**

Append to `store/storetest/conformance_test.go`, adding `"errors"`, `"github.com/xraph/nexus/id"`, `"github.com/xraph/nexus/key"` and `"github.com/xraph/nexus/tenant"` to its imports:

```go
func TestMissingRowsAreErrNotFound(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		if _, err := s.Tenants().FindByID(ctx, id.NewTenantID().String()); !errors.Is(err, tenant.ErrNotFound) {
			t.Errorf("tenant FindByID = %v, want tenant.ErrNotFound", err)
		}
		if _, err := s.Tenants().FindBySlug(ctx, "no-such-slug"); !errors.Is(err, tenant.ErrNotFound) {
			t.Errorf("tenant FindBySlug = %v, want tenant.ErrNotFound", err)
		}
		if err := s.Tenants().Update(ctx, storetest.Tenant("ghost")); !errors.Is(err, tenant.ErrNotFound) {
			t.Errorf("tenant Update of a missing tenant = %v, want tenant.ErrNotFound", err)
		}
		if _, err := s.Keys().FindByID(ctx, id.NewKeyID().String()); !errors.Is(err, key.ErrNotFound) {
			t.Errorf("key FindByID = %v, want key.ErrNotFound", err)
		}
		if _, err := s.Keys().FindByPrefix(ctx, "nxs_00000000"); !errors.Is(err, key.ErrNotFound) {
			t.Errorf("key FindByPrefix = %v, want key.ErrNotFound", err)
		}
		tn := storetest.InsertTenant(t, s)
		if err := s.Keys().Update(ctx, storetest.Key(tn.ID, "ghost")); !errors.Is(err, key.ErrNotFound) {
			t.Errorf("key Update of a missing key = %v, want key.ErrNotFound", err)
		}
	})
}

func TestChangingAReturnedRowDoesNotChangeTheStore(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		want := storetest.InsertTenant(t, s)
		got, err := s.Tenants().FindByID(ctx, want.ID.String())
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		got.Name = "changed without Update"
		got.Config.AllowedModels[0] = "changed"
		got.Metadata["owner"] = "changed"

		again, err := s.Tenants().FindByID(ctx, want.ID.String())
		if err != nil {
			t.Fatalf("find again: %v", err)
		}
		// A fresh fixture with the stored identity is what the row should
		// still hold.
		fresh := storetest.Tenant(want.Slug)
		fresh.ID, fresh.CreatedAt, fresh.UpdatedAt = want.ID, want.CreatedAt, want.UpdatedAt
		storetest.SameTenant(t, again, fresh)
	})
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./store/storetest/ -run 'ErrNotFound|DoesNotChange' -v`
Expected: FAIL to compile, `undefined: tenant.ErrNotFound`.

- [ ] **Step 3: Add the sentinels**

`tenant/errors.go`:

```go
package tenant

import "errors"

// ErrNotFound reports that no tenant matched. Stores return it from
// FindByID, FindBySlug and Update, never a nil tenant with a nil error.
var ErrNotFound = errors.New("nexus: tenant not found")
```

`key/errors.go`:

```go
package key

import "errors"

// ErrNotFound reports that no API key matched. Stores return it from
// FindByID, FindByPrefix and Update, never a nil key with a nil error.
var ErrNotFound = errors.New("nexus: api key not found")
```

Add one line to each `Store` doc comment: in `tenant/tenant.go` above `type Store interface`, `// Finders and Update return ErrNotFound when no tenant matches; Delete of an unknown id is a no-op.`; in `key/key.go`, `// Finders and Update return ErrNotFound when no key matches; Delete of an unknown id is a no-op.`

- [ ] **Step 4: Split and fix the memory store**

Replace `store/memory.go` with the aggregate and the clone helpers:

```go
package store

import (
	"maps"
	"slices"

	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/tenant"
	"github.com/xraph/nexus/usage"
)

// memoryStore is an in-memory Store for development and tests. It stores
// and returns copies, so a caller changing a row it was handed cannot change
// the store behind Update's back, which no database backend allows either.
type memoryStore struct {
	tenants *memoryTenantStore
	keys    *memoryKeyStore
	usage   *memoryUsageStore
}

// NewMemory creates an in-memory store.
func NewMemory() Store {
	return &memoryStore{
		tenants: &memoryTenantStore{data: make(map[string]*tenant.Tenant)},
		keys:    &memoryKeyStore{data: make(map[string]*key.APIKey)},
		usage:   &memoryUsageStore{},
	}
}

func (s *memoryStore) Tenants() tenant.Store { return s.tenants }
func (s *memoryStore) Keys() key.Store       { return s.keys }
func (s *memoryStore) Usage() usage.Store    { return s.usage }
func (s *memoryStore) Migrate() error        { return nil }
func (s *memoryStore) Close() error          { return nil }

func cloneTenant(t *tenant.Tenant) *tenant.Tenant {
	c := *t
	c.Metadata = maps.Clone(t.Metadata)
	c.Config.AllowedModels = slices.Clone(t.Config.AllowedModels)
	c.Config.BlockedModels = slices.Clone(t.Config.BlockedModels)
	c.Config.Metadata = maps.Clone(t.Config.Metadata)
	if t.Config.CacheEnabled != nil {
		v := *t.Config.CacheEnabled
		c.Config.CacheEnabled = &v
	}
	return &c
}

func cloneKey(k *key.APIKey) *key.APIKey {
	c := *k
	c.Scopes = slices.Clone(k.Scopes)
	c.Metadata = maps.Clone(k.Metadata)
	if k.ExpiresAt != nil {
		v := *k.ExpiresAt
		c.ExpiresAt = &v
	}
	if k.LastUsedAt != nil {
		v := *k.LastUsedAt
		c.LastUsedAt = &v
	}
	return &c
}
```

`store/memory_tenant.go`:

```go
package store

import (
	"context"
	"sync"

	"github.com/xraph/nexus/tenant"
)

type memoryTenantStore struct {
	mu   sync.RWMutex
	data map[string]*tenant.Tenant
}

func (s *memoryTenantStore) Insert(_ context.Context, t *tenant.Tenant) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[t.ID.String()] = cloneTenant(t)
	return nil
}

func (s *memoryTenantStore) FindByID(_ context.Context, id string) (*tenant.Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.data[id]
	if !ok {
		return nil, tenant.ErrNotFound
	}
	return cloneTenant(t), nil
}

func (s *memoryTenantStore) FindBySlug(_ context.Context, slug string) (*tenant.Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, t := range s.data {
		if t.Slug == slug {
			return cloneTenant(t), nil
		}
	}
	return nil, tenant.ErrNotFound
}

func (s *memoryTenantStore) Update(_ context.Context, t *tenant.Tenant) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data[t.ID.String()]; !ok {
		return tenant.ErrNotFound
	}
	s.data[t.ID.String()] = cloneTenant(t)
	return nil
}

func (s *memoryTenantStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
	return nil
}

func (s *memoryTenantStore) List(_ context.Context, opts *tenant.ListOptions) ([]*tenant.Tenant, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*tenant.Tenant
	for _, t := range s.data {
		if opts != nil && opts.Status != "" && string(t.Status) != opts.Status {
			continue
		}
		result = append(result, cloneTenant(t))
	}
	return result, len(result), nil
}
```

`store/memory_key.go`:

```go
package store

import (
	"context"
	"sync"

	"github.com/xraph/nexus/key"
)

type memoryKeyStore struct {
	mu   sync.RWMutex
	data map[string]*key.APIKey
}

func (s *memoryKeyStore) Insert(_ context.Context, k *key.APIKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[k.ID.String()] = cloneKey(k)
	return nil
}

func (s *memoryKeyStore) FindByID(_ context.Context, id string) (*key.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k, ok := s.data[id]
	if !ok {
		return nil, key.ErrNotFound
	}
	return cloneKey(k), nil
}

func (s *memoryKeyStore) FindByPrefix(_ context.Context, prefix string) (*key.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, k := range s.data {
		if k.Prefix == prefix {
			return cloneKey(k), nil
		}
	}
	return nil, key.ErrNotFound
}

func (s *memoryKeyStore) Update(_ context.Context, k *key.APIKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data[k.ID.String()]; !ok {
		return key.ErrNotFound
	}
	s.data[k.ID.String()] = cloneKey(k)
	return nil
}

func (s *memoryKeyStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
	return nil
}

func (s *memoryKeyStore) ListByTenant(_ context.Context, tenantID string) ([]*key.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*key.APIKey
	for _, k := range s.data {
		if k.TenantID.String() == tenantID {
			result = append(result, cloneKey(k))
		}
	}
	return result, nil
}
```

`store/memory_usage.go` holds the usage store unchanged for now (Tasks 5, 7, 8 and 9 rewrite it). Move lines 155 to 200 of the old `store/memory.go` (the `memoryUsageStore` type and its five methods) into it, with `package store` and imports `context`, `sync` and `github.com/xraph/nexus/usage`.

- [ ] **Step 5: Return the sentinels from the database backends**

`store/postgres/store.go` and `store/sqlite/store.go`: in tenant `FindByID` and `FindBySlug`, change the not-found branch from `return nil, nil` to `return nil, tenant.ErrNotFound`. In key `FindByID` and `FindByPrefix`, to `return nil, key.ErrNotFound`. Postgres checks `errors.Is(err, sql.ErrNoRows)`; SQLite checks `isNoRows(err)`; keep each file's own check.

Replace tenant `Update` in `store/postgres/store.go` with:

```go
func (s *tenantStore) Update(ctx context.Context, t *tenant.Tenant) error {
	m := tenantToModel(t)
	res, err := s.pgdb.NewUpdate(m).WherePK().Exec(ctx)
	if err != nil {
		return fmt.Errorf("nexus/postgres: update tenant: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return tenant.ErrNotFound
	}
	return nil
}
```

and key `Update` with the same shape, `apiKeyToModel(k)`, the message `"nexus/postgres: update key: %w"` and `key.ErrNotFound`. In `store/sqlite/store.go` make the same two changes with `s.sdb` and the `nexus/sqlite:` prefix.

`store/mongo/store.go`: in tenant and key `FindByID`, `FindBySlug` and `FindByPrefix`, change `return nil, nil` inside `if isNoDocuments(err)` to the matching sentinel. In tenant `Update` replace `return fmt.Errorf("nexus/mongo: tenant not found")` with `return tenant.ErrNotFound`, and in key `Update` make the matching change to `key.ErrNotFound`.

- [ ] **Step 6: Map not found to 404 at the API**

In `api/tenant_handler.go`, `handleGetTenant` writes the tenant even when it is nil today. Replace its error branch so a missing tenant is a 404 (add `"errors"` and `"github.com/xraph/nexus/tenant"` to the imports):

```go
	t, err := a.gw.Tenants().Get(r.Context(), id)
	if errors.Is(err, tenant.ErrNotFound) {
		writeError(w, http.StatusNotFound, "tenant not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
```

Make the same change in `handleUpdateTenant` around its `Update` call. In `api/key_handler.go`, around the `Revoke` call, map `key.ErrNotFound` to 404 the same way.

- [ ] **Step 7: Run the suite**

```bash
go build ./... && go test ./...
go test ./store/... -v -run 'ErrNotFound|DoesNotChange|RoundTrip' 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: every subtest on every backend passes.

- [ ] **Step 8: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add tenant/errors.go key/errors.go store/memory_tenant.go store/memory_key.go store/memory_usage.go
git commit --only -m "fix(store): report a missing tenant or key as ErrNotFound

Every finder returned (nil, nil) for a missing row, so the services
dereferenced nil on revoke, rotate, update, quota and status changes. The
memory store also handed out its own rows, so a caller could change one
without Update." -- tenant/errors.go key/errors.go tenant/tenant.go key/key.go store/memory.go store/memory_tenant.go store/memory_key.go store/memory_usage.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go api/tenant_handler.go api/key_handler.go store/storetest/conformance_test.go
git show --stat HEAD
```

---

### Task 5: Usage records carry exact cost, an outcome and nullable attribution

**Files:**
- Create: `usage/outcome.go`
- Modify: `usage/usage.go` (`Record`)
- Modify: `provider/response.go` (`CompletionResponse.Cost`)
- Modify: `pipeline/middlewares/usage.go` (cost, pricing status, outcome)
- Create: `store/internal/conv/conv.go`, `store/internal/conv/conv_test.go`
- Modify: `store/memory_usage.go`
- Create: `store/postgres/numeric.go`
- Modify: `store/postgres/models.go`, `store/postgres/migrations.go`
- Modify: `store/sqlite/models.go`, `store/sqlite/migrations.go`
- Modify: `store/mongo/models.go`, `store/mongo/store.go` (`Migrate` normalises legacy documents)
- Create: `store/storetest/usage.go` (record fixtures)
- Create: `store/storetest/usage_test.go`
- Create: `store/sqlite/legacy_test.go`, `store/postgres/legacy_test.go`, `store/mongo/legacy_test.go`
- Modify: `dashboard/components/helpers.go`, `dashboard/components/usage_table.templ` (+ regenerated)

**Interfaces:**
- Consumes: `money.USD`, `money.ParseLenient` (Task 1); `usage.PricingStatus` (Task 2); `storetest.Each`, `storetest.InsertTenant`, `storetest.Now`, `storetest.OpenSQLiteDB`, `storetest.OpenPostgresDB`, `storetest.OpenMongoDB`, `storetest.MongoClient` (Task 3).
- Produces:
  - `usage.Outcome` with `OutcomeOK`, `OutcomeCached`, `OutcomeBlocked`, `OutcomeRefused`, `OutcomeError`
  - `usage.Record` gains `CostUSD *money.USD`, `PricingStatus`, `Outcome`, `BlockedBy`, `RefusalCode`; `TenantID`, `KeyID`, `RequestID` are `id.Nil` when unattributed
  - `provider.CompletionResponse.Cost *money.USD` (`json:"cost,omitempty"`)
  - `conv.OptionalID(id.ID) *string`, `conv.ParseOptional(s *string, parse func(string) (id.ID, error)) (id.ID, error)`, `conv.CostText(*money.USD) *string`, `conv.ParseCost(*string) (*money.USD, error)`, `conv.TimeText(time.Time) string`, `conv.ParseTimeText(string) (time.Time, error)`, `conv.LikePattern(string) string`
  - `storetest.Record(tenantID id.TenantID, cost string) *usage.Record` (empty `cost` builds an unpriced record), `storetest.InsertRecord(t, s, r)`, `storetest.SameRecord(t, got, want)`
  - SQLite `usage_records.created_at` holds `conv.TimeText`: fixed-width UTC with nanoseconds, so text order is time order

- [ ] **Step 1: Write the failing tests**

`store/storetest/usage.go`:

```go
package storetest

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/usage"
)

// Record builds a usage record with every field filled. An empty cost
// builds an unpriced record (nil cost, unpriced_model).
func Record(tenantID id.TenantID, cost string) *usage.Record {
	r := &usage.Record{
		ID:               id.NewUsageID(),
		TenantID:         tenantID,
		KeyID:            id.NewKeyID(),
		RequestID:        id.NewRequestID(),
		Provider:         "openai",
		Model:            "gpt-4o",
		PromptTokens:     120,
		CompletionTokens: 30,
		TotalTokens:      150,
		PricingStatus:    usage.PricingPriced,
		Outcome:          usage.OutcomeOK,
		Latency:          1500 * time.Millisecond,
		StatusCode:       200,
		CreatedAt:        Now(),
	}
	if cost == "" {
		r.PricingStatus = usage.PricingUnpricedModel
	} else {
		c := money.MustParse(cost)
		r.CostUSD = &c
	}
	return r
}

// InsertRecord stores r.
func InsertRecord(t *testing.T, s store.Store, r *usage.Record) {
	t.Helper()
	if err := s.Usage().Insert(context.Background(), r); err != nil {
		t.Fatalf("insert usage: %v", err)
	}
}

// SameRecord fails the test unless got and want match field by field. Cost
// is compared as an amount, so 0.150 and 0.15 are the same.
func SameRecord(t *testing.T, got, want *usage.Record) {
	t.Helper()
	if got == nil {
		t.Fatalf("record is nil")
	}
	g, w := *got, *want
	for _, p := range [][2]id.ID{{g.ID, w.ID}, {g.TenantID, w.TenantID}, {g.KeyID, w.KeyID}, {g.RequestID, w.RequestID}} {
		if p[0].String() != p[1].String() {
			t.Errorf("record id = %q, want %q", p[0], p[1])
		}
	}
	switch {
	case g.CostUSD == nil && w.CostUSD == nil:
	case g.CostUSD == nil || w.CostUSD == nil || !g.CostUSD.Equal(*w.CostUSD):
		t.Errorf("cost = %v, want %v", g.CostUSD, w.CostUSD)
	}
	if !g.CreatedAt.Equal(w.CreatedAt) {
		t.Errorf("created_at = %s, want %s", g.CreatedAt, w.CreatedAt)
	}
	g.ID, w.ID, g.TenantID, w.TenantID, g.KeyID, w.KeyID, g.RequestID, w.RequestID = id.Nil, id.Nil, id.Nil, id.Nil, id.Nil, id.Nil, id.Nil, id.Nil
	g.CostUSD, w.CostUSD = nil, nil
	g.CreatedAt, w.CreatedAt = time.Time{}, time.Time{}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("record round trip:\n got %+v\nwant %+v", g, w)
	}
}

// FindRecord returns the record with the given id from an unfiltered query.
func FindRecord(t *testing.T, s store.Store, rid id.UsageID) *usage.Record {
	t.Helper()
	records, _, err := s.Usage().Query(context.Background(), &usage.QueryOptions{Limit: 500})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	for _, r := range records {
		if r.ID.String() == rid.String() {
			return r
		}
	}
	t.Fatalf("record %s not found", rid)
	return nil
}
```

`FindRecord` uses today's `Query` signature. Task 8 changes it to the paged result and updates this helper.

`store/storetest/usage_test.go`:

```go
package storetest_test

import (
	"testing"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

func TestUsageRecordRoundTripsEveryField(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		tn := storetest.InsertTenant(t, s)
		want := storetest.Record(tn.ID, "0.000024975")
		want.Outcome, want.BlockedBy, want.StatusCode = usage.OutcomeBlocked, "pii", 400
		storetest.InsertRecord(t, s, want)
		storetest.SameRecord(t, storetest.FindRecord(t, s, want.ID), want)

		refused := storetest.Record(tn.ID, "")
		refused.Outcome, refused.RefusalCode, refused.StatusCode = usage.OutcomeRefused, "budget_exceeded", 429
		storetest.InsertRecord(t, s, refused)
		storetest.SameRecord(t, storetest.FindRecord(t, s, refused.ID), refused)
	})
}

func TestUnpricedCostStaysUnknown(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		tn := storetest.InsertTenant(t, s)
		r := storetest.Record(tn.ID, "")
		storetest.InsertRecord(t, s, r)
		got := storetest.FindRecord(t, s, r.ID)
		if got.CostUSD != nil || got.PricingStatus != usage.PricingUnpricedModel {
			t.Fatalf("unpriced record came back as cost %v, status %s", got.CostUSD, got.PricingStatus)
		}
	})
}

func TestUnattributedRecordRoundTrips(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		r := storetest.Record(id.Nil, "0.01")
		r.KeyID, r.RequestID = id.Nil, id.Nil
		storetest.InsertRecord(t, s, r)
		got := storetest.FindRecord(t, s, r.ID)
		if !got.TenantID.IsNil() || !got.KeyID.IsNil() || !got.RequestID.IsNil() {
			t.Fatalf("unattributed record came back attributed: %+v", got)
		}
		storetest.SameRecord(t, got, r)
	})
}
```

`store/internal/conv/conv_test.go`:

```go
package conv_test

import (
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/store/internal/conv"
)

func TestOptionalIDs(t *testing.T) {
	if conv.OptionalID(id.Nil) != nil {
		t.Fatalf("a nil id should store as NULL")
	}
	tid := id.NewTenantID()
	s := conv.OptionalID(tid)
	got, err := conv.ParseOptional(s, id.ParseTenantID)
	if err != nil || got.String() != tid.String() {
		t.Fatalf("round trip = %s, %v", got, err)
	}
	for _, empty := range []*string{nil, new(string)} {
		if got, err := conv.ParseOptional(empty, id.ParseTenantID); err != nil || !got.IsNil() {
			t.Fatalf("empty = %s, %v", got, err)
		}
	}
}

func TestCostText(t *testing.T) {
	if conv.CostText(nil) != nil {
		t.Fatalf("an unknown cost should store as NULL")
	}
	c := money.MustParse("0.000000150")
	got, err := conv.ParseCost(conv.CostText(&c))
	if err != nil || got == nil || got.String() != "0.00000015" {
		t.Fatalf("round trip = %v, %v", got, err)
	}
	padded := "0.000000150000000000"
	if got, err := conv.ParseCost(&padded); err != nil || got.String() != "0.00000015" {
		t.Fatalf("a NUMERIC(38,18) text = %v, %v", got, err)
	}
}

func TestTimeTextSortsAsTime(t *testing.T) {
	a := time.Date(2026, 10, 7, 9, 0, 0, 5, time.FixedZone("x", -5*3600))
	b := a.Add(time.Nanosecond)
	if conv.TimeText(a) >= conv.TimeText(b) {
		t.Fatalf("%s should sort before %s", conv.TimeText(a), conv.TimeText(b))
	}
	got, err := conv.ParseTimeText(conv.TimeText(a))
	if err != nil || !got.Equal(a) {
		t.Fatalf("round trip = %s, %v", got, err)
	}
}

func TestLikePatternEscapesWildcards(t *testing.T) {
	if got := conv.LikePattern(`50%_off\`); got != `%50\%\_off\\%` {
		t.Fatalf("LikePattern = %q", got)
	}
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./store/...`
Expected: FAIL to compile, `undefined: usage.OutcomeBlocked` and `no required module provides package .../store/internal/conv`.

- [ ] **Step 3: Add the outcome and change the record**

`usage/outcome.go`:

```go
package usage

// Outcome says what happened to a request.
type Outcome string

const (
	// OutcomeOK: a provider answered.
	OutcomeOK Outcome = "ok"
	// OutcomeCached: served from the response cache; no provider was called.
	OutcomeCached Outcome = "cached"
	// OutcomeBlocked: a guard refused the request; BlockedBy names the guard.
	OutcomeBlocked Outcome = "blocked"
	// OutcomeRefused: authentication or a quota refused the request;
	// RefusalCode says which.
	OutcomeRefused Outcome = "refused"
	// OutcomeError: the provider call failed.
	OutcomeError Outcome = "error"
)
```

In `usage/usage.go`, replace `Record` (add the `money` import):

```go
// Record captures a single API call's usage.
type Record struct {
	ID id.UsageID `json:"id"`
	// TenantID, KeyID and RequestID are id.Nil when the request was not
	// attributed to them.
	TenantID         id.TenantID  `json:"tenant_id"`
	KeyID            id.KeyID     `json:"key_id"`
	RequestID        id.RequestID `json:"request_id"`
	Provider         string       `json:"provider"`
	Model            string       `json:"model"`
	PromptTokens     int          `json:"prompt_tokens"`
	CompletionTokens int          `json:"completion_tokens"`
	TotalTokens      int          `json:"total_tokens"`
	// CostUSD is nil when the request could not be priced. It is never $0
	// standing in for "unknown"; PricingStatus says why it is missing.
	CostUSD       *money.USD    `json:"cost_usd"`
	PricingStatus PricingStatus `json:"pricing_status"`
	Outcome       Outcome       `json:"outcome"`
	BlockedBy     string        `json:"blocked_by,omitempty"`
	RefusalCode   string        `json:"refusal_code,omitempty"`
	Latency       time.Duration `json:"latency"`
	Cached        bool          `json:"cached"`
	StatusCode    int           `json:"status_code"`
	CreatedAt     time.Time     `json:"created_at"`
}
```

Leave `Summary`, `ProviderUsage`, `ModelUsage` and the interfaces alone in this task. Their `float64` costs still compile against the store aggregates; Task 7 replaces them, and the aggregates on SQL backends sum a column that is now `NUMERIC` or `TEXT`. To keep them compiling, the next steps make the SQL aggregates read `cost_usd` through the conversions too.

In `provider/response.go`, replace the `Cost` line and add the `money` import:

```go
	Cost    *money.USD    `json:"cost,omitempty"` // exact; nil until something prices the request
```

- [ ] **Step 4: Fill the new fields in the usage middleware**

`pipeline/middlewares/usage.go`: line 79 already reads `rec.CostUSD = resp.Completion.Cost`, which now compiles as a pointer copy. Replace the streaming check at lines 157 to 158 with:

```go
				if s.rec.CostUSD == nil {
					s.rec.CostUSD = final.Cost
				}
```

Then, wherever the middleware builds `rec` (it is created once at line 42), set the outcome and pricing status just before each `recordAsync` call. Add this helper to the file:

```go
// settle fills the fields every record needs before it is stored: what
// happened, and whether its cost is known.
func settle(rec *usage.Record, err error) {
	switch {
	case err != nil:
		rec.Outcome = usage.OutcomeError
	case rec.Cached:
		rec.Outcome = usage.OutcomeCached
	default:
		rec.Outcome = usage.OutcomeOK
	}
	switch {
	case rec.Cached:
		zero := money.Zero
		rec.CostUSD, rec.PricingStatus = &zero, usage.PricingCached
	case rec.CostUSD == nil:
		rec.PricingStatus = usage.PricingUnpricedModel
	default:
		rec.PricingStatus = usage.PricingPriced
	}
}
```

and call `settle(rec, err)` before `m.recordAsync(rec)` in the error branch, `settle(rec, nil)` before it in the non-stream success branch, and `settle(s.rec, nil)` before it in the stream's `Close`. Slice 2 moves this middleware and computes the cost itself; this keeps the fields honest until then.

Run: `go test ./pipeline/...`
Expected: PASS (`usage_stream_test.go` drives the middleware in isolation and does not assert on cost).

- [ ] **Step 5: Write the shared conversions**

`store/internal/conv/conv.go`:

```go
// Package conv holds the conversions every database backend uses at its
// model boundary, so the backends cannot each invent their own.
package conv

import (
	"strings"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
)

// OptionalID stores id.Nil as NULL.
func OptionalID(i id.ID) *string {
	if i.IsNil() {
		return nil
	}
	s := i.String()
	return &s
}

// ParseOptional reads NULL and "" as id.Nil. Rows written before attribution
// was nullable hold "" for "nobody".
func ParseOptional(s *string, parse func(string) (id.ID, error)) (id.ID, error) {
	if s == nil || *s == "" {
		return id.Nil, nil
	}
	return parse(*s)
}

// CostText stores an unknown cost as NULL and a known one as its exact text.
func CostText(c *money.USD) *string {
	if c == nil {
		return nil
	}
	s := c.String()
	return &s
}

// ParseCost reads NULL as an unknown cost. It accepts exponent notation
// because some databases print decimals that way.
func ParseCost(s *string) (*money.USD, error) {
	if s == nil {
		return nil, nil
	}
	u, err := money.ParseLenient(*s)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// timeLayout is fixed width with nanoseconds, so comparing two values as
// text compares them as times.
const timeLayout = "2006-01-02T15:04:05.000000000Z"

// TimeText formats t in UTC for a text column that is compared and ordered.
func TimeText(t time.Time) string { return t.UTC().Format(timeLayout) }

// ParseTimeText reads TimeText's format.
func ParseTimeText(s string) (time.Time, error) { return time.Parse(timeLayout, s) }

// LikePattern turns a search term into a LIKE / ILIKE pattern matching it
// anywhere, with the wildcards in the term escaped by a backslash.
func LikePattern(term string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(term) + "%"
}
```

Run: `go test ./store/internal/conv/`
Expected: PASS.

- [ ] **Step 6: Memory**

Add to `store/memory.go`:

```go
func cloneRecord(r *usage.Record) *usage.Record {
	c := *r
	if r.CostUSD != nil {
		v := *r.CostUSD
		c.CostUSD = &v
	}
	return &c
}
```

In `store/memory_usage.go`, store a clone on `Insert` (`s.records = append(s.records, cloneRecord(rec))`), make `Query` return clones of every record, and make `MonthlySpend` add `r.CostUSD` only when it is non-nil. `MonthlySpend` still returns `float64` until Task 7, so convert at the end, temporarily, through the string: `f, _ := strconv.ParseFloat(total.String(), 64); return f, nil`, where `total` is a `money.USD` you accumulate with `Add`. Task 7 deletes this conversion.

- [ ] **Step 7: Postgres: the numeric adapter, the model and the migration**

`store/postgres/numeric.go`:

```go
package postgres

import (
	"database/sql/driver"
	"fmt"

	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/store/internal/conv"
)

// numeric carries an exact decimal to and from a NUMERIC column as text.
// pgx hands a NUMERIC to an sql.Scanner as its decimal text, so no float is
// ever involved. The zero value is NULL.
type numeric struct {
	text  string
	valid bool
}

func numericOf(c *money.USD) numeric {
	if s := conv.CostText(c); s != nil {
		return numeric{text: *s, valid: true}
	}
	return numeric{}
}

// Value implements driver.Valuer.
func (n numeric) Value() (driver.Value, error) {
	if !n.valid {
		return nil, nil
	}
	return n.text, nil
}

// Scan implements sql.Scanner.
func (n *numeric) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*n = numeric{}
	case string:
		*n = numeric{text: v, valid: true}
	case []byte:
		*n = numeric{text: string(v), valid: true}
	default:
		return fmt.Errorf("nexus/postgres: scan numeric from %T", src)
	}
	return nil
}

func (n numeric) usd() (*money.USD, error) {
	if !n.valid {
		return nil, nil
	}
	return conv.ParseCost(&n.text)
}
```

In `store/postgres/models.go`, replace `usageModel`, `usageToModel` and `usageFromModel` (add imports `github.com/xraph/nexus/store/internal/conv`):

```go
type usageModel struct {
	grove.BaseModel  `grove:"table:nexus_usage_records"`
	ID               string    `grove:"id,pk"`
	TenantID         *string   `grove:"tenant_id"`
	KeyID            *string   `grove:"key_id"`
	RequestID        *string   `grove:"request_id"`
	Provider         string    `grove:"provider,notnull"`
	Model            string    `grove:"model,notnull"`
	PromptTokens     int       `grove:"prompt_tokens"`
	CompletionTokens int       `grove:"completion_tokens"`
	TotalTokens      int       `grove:"total_tokens"`
	CostUSD          numeric   `grove:"cost_usd"`
	PricingStatus    string    `grove:"pricing_status,notnull"`
	Outcome          string    `grove:"outcome,notnull"`
	BlockedBy        string    `grove:"blocked_by,notnull"`
	RefusalCode      string    `grove:"refusal_code,notnull"`
	LatencyNs        int64     `grove:"latency_ns"`
	Cached           bool      `grove:"cached"`
	StatusCode       int       `grove:"status_code"`
	CreatedAt        time.Time `grove:"created_at,notnull,default:current_timestamp"`
}

func usageToModel(rec *usage.Record) *usageModel {
	return &usageModel{
		ID:               rec.ID.String(),
		TenantID:         conv.OptionalID(rec.TenantID),
		KeyID:            conv.OptionalID(rec.KeyID),
		RequestID:        conv.OptionalID(rec.RequestID),
		Provider:         rec.Provider,
		Model:            rec.Model,
		PromptTokens:     rec.PromptTokens,
		CompletionTokens: rec.CompletionTokens,
		TotalTokens:      rec.TotalTokens,
		CostUSD:          numericOf(rec.CostUSD),
		PricingStatus:    string(rec.PricingStatus),
		Outcome:          string(rec.Outcome),
		BlockedBy:        rec.BlockedBy,
		RefusalCode:      rec.RefusalCode,
		LatencyNs:        rec.Latency.Nanoseconds(),
		Cached:           rec.Cached,
		StatusCode:       rec.StatusCode,
		CreatedAt:        rec.CreatedAt.UTC(),
	}
}

func usageFromModel(m *usageModel) (*usage.Record, error) {
	uid, err := id.ParseUsageID(m.ID)
	if err != nil {
		return nil, err
	}
	tid, err := conv.ParseOptional(m.TenantID, id.ParseTenantID)
	if err != nil {
		return nil, err
	}
	kid, err := conv.ParseOptional(m.KeyID, id.ParseKeyID)
	if err != nil {
		return nil, err
	}
	rid, err := conv.ParseOptional(m.RequestID, id.ParseRequestID)
	if err != nil {
		return nil, err
	}
	cost, err := m.CostUSD.usd()
	if err != nil {
		return nil, err
	}
	return &usage.Record{
		ID:               uid,
		TenantID:         tid,
		KeyID:            kid,
		RequestID:        rid,
		Provider:         m.Provider,
		Model:            m.Model,
		PromptTokens:     m.PromptTokens,
		CompletionTokens: m.CompletionTokens,
		TotalTokens:      m.TotalTokens,
		CostUSD:          cost,
		PricingStatus:    usage.PricingStatus(m.PricingStatus),
		Outcome:          usage.Outcome(m.Outcome),
		BlockedBy:        m.BlockedBy,
		RefusalCode:      m.RefusalCode,
		Latency:          time.Duration(m.LatencyNs),
		Cached:           m.Cached,
		StatusCode:       m.StatusCode,
		CreatedAt:        m.CreatedAt,
	}, nil
}
```

Append this migration to the `g.MustRegister(` list in `store/postgres/migrations.go`, after `create_usage_records`:

```go
		&migrate.Migration{
			Name:    "exact_money_and_outcomes",
			Version: "20261007000001",
			Comment: "Store usage cost as exact NUMERIC, add outcome fields, allow unattributed rows",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `
ALTER TABLE nexus_usage_records
    ALTER COLUMN cost_usd DROP DEFAULT,
    ALTER COLUMN cost_usd DROP NOT NULL,
    ALTER COLUMN cost_usd TYPE NUMERIC(38,18) USING cost_usd::numeric,
    ALTER COLUMN tenant_id DROP NOT NULL,
    ALTER COLUMN key_id DROP NOT NULL,
    ALTER COLUMN request_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS pricing_status TEXT NOT NULL DEFAULT 'priced',
    ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'ok',
    ADD COLUMN IF NOT EXISTS blocked_by TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS refusal_code TEXT NOT NULL DEFAULT '';

-- Nothing computed a cost before this migration, so a stored 0 meant
-- "unknown", not "free".
UPDATE nexus_usage_records
   SET cost_usd = NULL, pricing_status = 'unpriced_model'
 WHERE cost_usd = 0;

UPDATE nexus_usage_records
   SET outcome = CASE WHEN cached THEN 'cached'
                      WHEN status_code >= 400 THEN 'error'
                      ELSE 'ok' END;

UPDATE nexus_usage_records SET key_id = NULL WHERE key_id = '';
UPDATE nexus_usage_records SET request_id = NULL WHERE request_id = '';

CREATE INDEX IF NOT EXISTS idx_nexus_usage_key ON nexus_usage_records(key_id);
`)
				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `
DROP INDEX IF EXISTS idx_nexus_usage_key;
ALTER TABLE nexus_usage_records
    DROP COLUMN IF EXISTS refusal_code,
    DROP COLUMN IF EXISTS blocked_by,
    DROP COLUMN IF EXISTS outcome,
    DROP COLUMN IF EXISTS pricing_status,
    ALTER COLUMN cost_usd TYPE DOUBLE PRECISION USING COALESCE(cost_usd, 0)::double precision,
    ALTER COLUMN cost_usd SET DEFAULT 0,
    ALTER COLUMN cost_usd SET NOT NULL;
`)
				return err
			},
		},
```

The Postgres `Summary` and `MonthlySpend` scan `SUM(cost_usd)` into a `float64`. pgx can scan a `NUMERIC` sum into `float64`, so they keep compiling and working until Task 7 rewrites them. Confirm that by running the suite in Step 11.

- [ ] **Step 8: SQLite: the model and a table rebuild**

In `store/sqlite/models.go`, replace the usage model and conversions:

```go
type usageModel struct {
	grove.BaseModel  `grove:"table:usage_records"`
	ID               string  `grove:"id,pk"`
	TenantID         *string `grove:"tenant_id"`
	KeyID            *string `grove:"key_id"`
	RequestID        *string `grove:"request_id"`
	Provider         string  `grove:"provider,notnull"`
	Model            string  `grove:"model,notnull"`
	PromptTokens     int     `grove:"prompt_tokens"`
	CompletionTokens int     `grove:"completion_tokens"`
	TotalTokens      int     `grove:"total_tokens"`
	CostUSD          *string `grove:"cost_usd"`
	PricingStatus    string  `grove:"pricing_status,notnull"`
	Outcome          string  `grove:"outcome,notnull"`
	BlockedBy        string  `grove:"blocked_by,notnull"`
	RefusalCode      string  `grove:"refusal_code,notnull"`
	LatencyNs        int64   `grove:"latency_ns"`
	Cached           bool    `grove:"cached"`
	StatusCode       int     `grove:"status_code"`
	// CreatedAt is conv.TimeText: fixed-width UTC with nanoseconds, so a
	// window compares as text exactly as it would as time.
	CreatedAt string `grove:"created_at,notnull"`
}

func usageToModel(rec *usage.Record) *usageModel {
	return &usageModel{
		ID:               rec.ID.String(),
		TenantID:         conv.OptionalID(rec.TenantID),
		KeyID:            conv.OptionalID(rec.KeyID),
		RequestID:        conv.OptionalID(rec.RequestID),
		Provider:         rec.Provider,
		Model:            rec.Model,
		PromptTokens:     rec.PromptTokens,
		CompletionTokens: rec.CompletionTokens,
		TotalTokens:      rec.TotalTokens,
		CostUSD:          conv.CostText(rec.CostUSD),
		PricingStatus:    string(rec.PricingStatus),
		Outcome:          string(rec.Outcome),
		BlockedBy:        rec.BlockedBy,
		RefusalCode:      rec.RefusalCode,
		LatencyNs:        rec.Latency.Nanoseconds(),
		Cached:           rec.Cached,
		StatusCode:       rec.StatusCode,
		CreatedAt:        conv.TimeText(rec.CreatedAt),
	}
}

func usageFromModel(m *usageModel) (*usage.Record, error) {
	uid, err := id.ParseUsageID(m.ID)
	if err != nil {
		return nil, err
	}
	tid, err := conv.ParseOptional(m.TenantID, id.ParseTenantID)
	if err != nil {
		return nil, err
	}
	kid, err := conv.ParseOptional(m.KeyID, id.ParseKeyID)
	if err != nil {
		return nil, err
	}
	rid, err := conv.ParseOptional(m.RequestID, id.ParseRequestID)
	if err != nil {
		return nil, err
	}
	cost, err := conv.ParseCost(m.CostUSD)
	if err != nil {
		return nil, err
	}
	created, err := conv.ParseTimeText(m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &usage.Record{
		ID:               uid,
		TenantID:         tid,
		KeyID:            kid,
		RequestID:        rid,
		Provider:         m.Provider,
		Model:            m.Model,
		PromptTokens:     m.PromptTokens,
		CompletionTokens: m.CompletionTokens,
		TotalTokens:      m.TotalTokens,
		CostUSD:          cost,
		PricingStatus:    usage.PricingStatus(m.PricingStatus),
		Outcome:          usage.Outcome(m.Outcome),
		BlockedBy:        m.BlockedBy,
		RefusalCode:      m.RefusalCode,
		Latency:          time.Duration(m.LatencyNs),
		Cached:           m.Cached,
		StatusCode:       m.StatusCode,
		CreatedAt:        created,
	}, nil
}
```

SQLite cannot change a column's type, and a column declared `REAL` would turn the text `"0.000123"` back into a float on insert. So the migration rebuilds the table. Append to `store/sqlite/migrations.go`:

```go
		&migrate.Migration{
			Name:    "exact_money_and_outcomes",
			Version: "20261007000001",
			Comment: "Rebuild usage_records with TEXT cost, outcome fields, nullable attribution and sortable times",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `
CREATE TABLE usage_records_next (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT,
    key_id            TEXT,
    request_id        TEXT,
    provider          TEXT NOT NULL DEFAULT '',
    model             TEXT NOT NULL DEFAULT '',
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    cost_usd          TEXT,
    pricing_status    TEXT NOT NULL DEFAULT 'priced',
    outcome           TEXT NOT NULL DEFAULT 'ok',
    blocked_by        TEXT NOT NULL DEFAULT '',
    refusal_code      TEXT NOT NULL DEFAULT '',
    latency_ns        INTEGER NOT NULL DEFAULT 0,
    cached            INTEGER NOT NULL DEFAULT 0,
    status_code       INTEGER NOT NULL DEFAULT 200,
    created_at        TEXT NOT NULL
);

-- Nothing computed a cost before this migration, so a stored 0 meant
-- "unknown", not "free". Times move to fixed-width UTC text.
INSERT INTO usage_records_next
    (id, tenant_id, key_id, request_id, provider, model, prompt_tokens,
     completion_tokens, total_tokens, cost_usd, pricing_status, outcome,
     latency_ns, cached, status_code, created_at)
SELECT id, NULLIF(tenant_id, ''), NULLIF(key_id, ''), NULLIF(request_id, ''),
       provider, model, prompt_tokens, completion_tokens, total_tokens,
       CASE WHEN cost_usd = 0 THEN NULL ELSE printf('%.18f', cost_usd) END,
       CASE WHEN cost_usd = 0 THEN 'unpriced_model' ELSE 'priced' END,
       CASE WHEN cached = 1 THEN 'cached' WHEN status_code >= 400 THEN 'error' ELSE 'ok' END,
       latency_ns, cached, status_code,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%S', created_at) || '.000000000Z', created_at)
  FROM usage_records;

DROP TABLE usage_records;
ALTER TABLE usage_records_next RENAME TO usage_records;

CREATE INDEX IF NOT EXISTS idx_usage_tenant ON usage_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_key ON usage_records(key_id);
`)
				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `
UPDATE usage_records SET cost_usd = '0' WHERE cost_usd IS NULL;
ALTER TABLE usage_records DROP COLUMN refusal_code;
ALTER TABLE usage_records DROP COLUMN blocked_by;
ALTER TABLE usage_records DROP COLUMN outcome;
ALTER TABLE usage_records DROP COLUMN pricing_status;
`)
				return err
			},
		},
```

SQLite's `SUM(cost_usd)` over `TEXT` coerces to `REAL`. Until Task 7 rewrites the SQLite aggregates to sum in Go, they keep compiling and return a float total. The suite does not assert on aggregates yet.

Its date windows also compare `created_at` with `date('now')` and `strftime('%Y-%m-01', 'now')`, which still order correctly against the new `YYYY-MM-DDTHH…` text. Task 7 replaces them with Go-computed bounds.

- [ ] **Step 9: Mongo: the model and legacy normalisation**

In `store/mongo/models.go`, replace the usage model and conversions (imports: `github.com/xraph/nexus/store/internal/conv`, `github.com/xraph/nexus/money`, `go.mongodb.org/mongo-driver/v2/bson`, `strconv`):

```go
type usageModel struct {
	grove.BaseModel  `grove:"table:nexus_usage_records"`
	ID               string  `grove:"id,pk"             bson:"_id"`
	TenantID         *string `grove:"tenant_id"         bson:"tenant_id"`
	KeyID            *string `grove:"key_id"            bson:"key_id"`
	RequestID        *string `grove:"request_id"        bson:"request_id"`
	Provider         string  `grove:"provider"          bson:"provider"`
	Model            string  `grove:"model"             bson:"model"`
	PromptTokens     int     `grove:"prompt_tokens"     bson:"prompt_tokens"`
	CompletionTokens int     `grove:"completion_tokens" bson:"completion_tokens"`
	TotalTokens      int     `grove:"total_tokens"      bson:"total_tokens"`
	// CostUSD is a Decimal128 or null when written; a legacy document may
	// still hold a double, which usdFromBSON reads.
	CostUSD       any       `grove:"cost_usd"          bson:"cost_usd"`
	PricingStatus string    `grove:"pricing_status"    bson:"pricing_status"`
	Outcome       string    `grove:"outcome"           bson:"outcome"`
	BlockedBy     string    `grove:"blocked_by"        bson:"blocked_by"`
	RefusalCode   string    `grove:"refusal_code"      bson:"refusal_code"`
	LatencyNs     int64     `grove:"latency_ns"        bson:"latency_ns"`
	Cached        bool      `grove:"cached"            bson:"cached"`
	StatusCode    int       `grove:"status_code"       bson:"status_code"`
	CreatedAt     time.Time `grove:"created_at"        bson:"created_at"`
}

// decimalOf writes an exact amount as Decimal128, or null when unknown.
func decimalOf(c *money.USD) (any, error) {
	if c == nil {
		return nil, nil
	}
	d, err := bson.ParseDecimal128(c.String())
	if err != nil {
		return nil, fmt.Errorf("nexus/mongo: decimal128 of %s: %w", c, err)
	}
	return d, nil
}

// usdFromBSON reads what a cost or budget field may hold: Decimal128 (what
// this package writes), null, a double or an integer (legacy documents and
// $sum over nothing), or a string.
func usdFromBSON(v any) (*money.USD, error) {
	var s string
	switch x := v.(type) {
	case nil:
		return nil, nil
	case bson.Decimal128:
		s = x.String()
	case float64:
		s = strconv.FormatFloat(x, 'f', -1, 64)
	case int32:
		s = strconv.FormatInt(int64(x), 10)
	case int64:
		s = strconv.FormatInt(x, 10)
	case string:
		s = x
	default:
		return nil, fmt.Errorf("nexus/mongo: amount of type %T", v)
	}
	u, err := money.ParseLenient(s)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func usageToModel(rec *usage.Record) (*usageModel, error) {
	cost, err := decimalOf(rec.CostUSD)
	if err != nil {
		return nil, err
	}
	return &usageModel{
		ID:               rec.ID.String(),
		TenantID:         conv.OptionalID(rec.TenantID),
		KeyID:            conv.OptionalID(rec.KeyID),
		RequestID:        conv.OptionalID(rec.RequestID),
		Provider:         rec.Provider,
		Model:            rec.Model,
		PromptTokens:     rec.PromptTokens,
		CompletionTokens: rec.CompletionTokens,
		TotalTokens:      rec.TotalTokens,
		CostUSD:          cost,
		PricingStatus:    string(rec.PricingStatus),
		Outcome:          string(rec.Outcome),
		BlockedBy:        rec.BlockedBy,
		RefusalCode:      rec.RefusalCode,
		LatencyNs:        rec.Latency.Nanoseconds(),
		Cached:           rec.Cached,
		StatusCode:       rec.StatusCode,
		CreatedAt:        rec.CreatedAt.UTC(),
	}, nil
}

func usageFromModel(m *usageModel) (*usage.Record, error) {
	uid, err := id.ParseUsageID(m.ID)
	if err != nil {
		return nil, err
	}
	tid, err := conv.ParseOptional(m.TenantID, id.ParseTenantID)
	if err != nil {
		return nil, err
	}
	kid, err := conv.ParseOptional(m.KeyID, id.ParseKeyID)
	if err != nil {
		return nil, err
	}
	rid, err := conv.ParseOptional(m.RequestID, id.ParseRequestID)
	if err != nil {
		return nil, err
	}
	cost, err := usdFromBSON(m.CostUSD)
	if err != nil {
		return nil, err
	}
	return &usage.Record{
		ID:               uid,
		TenantID:         tid,
		KeyID:            kid,
		RequestID:        rid,
		Provider:         m.Provider,
		Model:            m.Model,
		PromptTokens:     m.PromptTokens,
		CompletionTokens: m.CompletionTokens,
		TotalTokens:      m.TotalTokens,
		CostUSD:          cost,
		PricingStatus:    usage.PricingStatus(m.PricingStatus),
		Outcome:          usage.Outcome(m.Outcome),
		BlockedBy:        m.BlockedBy,
		RefusalCode:      m.RefusalCode,
		Latency:          time.Duration(m.LatencyNs),
		Cached:           m.Cached,
		StatusCode:       m.StatusCode,
		CreatedAt:        m.CreatedAt,
	}, nil
}
```

In `store/mongo/store.go`, `usageStore.Insert` now handles the error from `usageToModel`:

```go
func (s *usageStore) Insert(ctx context.Context, rec *usage.Record) error {
	m, err := usageToModel(rec)
	if err != nil {
		return err
	}
	if _, err := s.mdb.NewInsert(m).Exec(ctx); err != nil {
		return fmt.Errorf("nexus/mongo: insert usage: %w", err)
	}
	return nil
}
```

Legacy documents need the same correction the SQL migrations make. At the end of `Store.Migrate` in `store/mongo/store.go`, after the indexes are created and before `return nil`, add:

```go
	// Documents written before exact money have no pricing_status. Nothing
	// computed a cost then, so their stored 0 means "unknown", not "free".
	_, err = s.mdb.Collection(colUsage).UpdateMany(ctx,
		bson.M{"pricing_status": bson.M{"$exists": false}},
		bson.A{bson.M{"$set": bson.M{
			"pricing_status": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$cost_usd", 0}}, "unpriced_model", "priced"}},
			"cost_usd":       bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$cost_usd", 0}}, nil, bson.M{"$toDecimal": "$cost_usd"}}},
			"outcome": bson.M{"$cond": bson.A{"$cached", "cached",
				bson.M{"$cond": bson.A{bson.M{"$gte": bson.A{"$status_code", 400}}, "error", "ok"}}}},
			"blocked_by":   "",
			"refusal_code": "",
		}}},
	)
	if err != nil {
		return fmt.Errorf("nexus/mongo: normalise legacy usage: %w", err)
	}
```

Adapt the variable names to `Migrate`'s existing body (read it first; if it uses a different `ctx` or error variable, use those).

The Mongo `MonthlySpend` decodes `total` into a `float64`. `$sum` over `Decimal128` returns `Decimal128`, which no longer decodes into `float64`. Change its result struct to `Total any \`bson:"total"\`` and convert with `usdFromBSON`, then to `float64` through `strconv.ParseFloat(u.String(), 64)` (nil means 0). Task 7 deletes the float. Make the same change to the cost field in `Summary`'s decode struct.

- [ ] **Step 10: The legacy tests**

`store/sqlite/legacy_test.go`:

```go
package sqlite_test

import (
	"context"
	"testing"

	"github.com/xraph/grove/drivers/sqlitedriver"

	"github.com/xraph/nexus/id"
	sqlitestore "github.com/xraph/nexus/store/sqlite"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

// A row written before exact money stored cost 0 because nothing priced
// it. After migrating it must read as unknown, not as free.
func TestLegacyUsageRowMigratesToUnpriced(t *testing.T) {
	ctx := context.Background()
	db := storetest.OpenSQLiteDB(t)
	raw := sqlitedriver.Unwrap(db)
	legacyID := id.NewUsageID().String()
	for _, stmt := range []string{
		`CREATE TABLE usage_records (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', key_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
    prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    latency_ns INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL DEFAULT 200, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`INSERT INTO usage_records (id, provider, model, total_tokens, cost_usd, created_at)
         VALUES ('` + legacyID + `', 'openai', 'gpt-4o', 10, 0, '2026-10-01T10:00:00Z')`,
	} {
		if _, err := raw.Exec(ctx, stmt); err != nil {
			t.Fatalf("legacy schema: %v", err)
		}
	}

	s := sqlitestore.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	got := storetest.FindRecord(t, s, id.MustParseUsageID(legacyID))
	if got.CostUSD != nil || got.PricingStatus != usage.PricingUnpricedModel {
		t.Fatalf("legacy row = cost %v, status %s; want unknown and unpriced_model", got.CostUSD, got.PricingStatus)
	}
	if !got.TenantID.IsNil() || got.Outcome != usage.OutcomeOK || got.CreatedAt.Format("2006-01-02T15:04:05Z") != "2026-10-01T10:00:00Z" {
		t.Fatalf("legacy row = %+v", got)
	}
}
```

`store/postgres/legacy_test.go`:

```go
package postgres_test

import (
	"context"
	"testing"

	"github.com/xraph/grove/drivers/pgdriver"

	"github.com/xraph/nexus/id"
	pgstore "github.com/xraph/nexus/store/postgres"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

func TestLegacyUsageRowMigratesToUnpriced(t *testing.T) {
	ctx := context.Background()
	db := storetest.OpenPostgresDB(t)
	raw := pgdriver.Unwrap(db)
	tenantID, usageID := id.NewTenantID().String(), id.NewUsageID().String()
	for _, stmt := range []string{
		`CREATE TABLE nexus_tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', quota JSONB NOT NULL DEFAULT '{}', config JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
		`CREATE TABLE nexus_usage_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES nexus_tenants(id),
    key_id TEXT NOT NULL, request_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0, cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    latency_ns BIGINT NOT NULL DEFAULT 0, cached BOOLEAN NOT NULL DEFAULT FALSE,
    status_code INTEGER NOT NULL DEFAULT 200, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
		`INSERT INTO nexus_tenants (id, name, slug) VALUES ('` + tenantID + `', 'Legacy', 'legacy')`,
		`INSERT INTO nexus_usage_records (id, tenant_id, key_id, request_id, provider, model, total_tokens, cost_usd, cached)
         VALUES ('` + usageID + `', '` + tenantID + `', '', '', 'openai', 'gpt-4o', 10, 0, TRUE)`,
	} {
		if _, err := raw.Exec(ctx, stmt); err != nil {
			t.Fatalf("legacy schema: %v", err)
		}
	}

	s := pgstore.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	got := storetest.FindRecord(t, s, id.MustParseUsageID(usageID))
	if got.CostUSD != nil || got.PricingStatus != usage.PricingUnpricedModel || got.Outcome != usage.OutcomeCached {
		t.Fatalf("legacy row = cost %v, status %s, outcome %s", got.CostUSD, got.PricingStatus, got.Outcome)
	}
	if !got.KeyID.IsNil() || !got.RequestID.IsNil() {
		t.Fatalf("legacy empty attribution should read as nil, got %+v", got)
	}
}
```

The legacy `CREATE TABLE` statements copy only the columns migration 1 and 3 create that this test needs. Before writing the test, check them against `store/postgres/migrations.go` and add any `NOT NULL` column without a default that migration 1 creates, or the insert fails for a reason unrelated to the test.

`store/mongo/legacy_test.go`:

```go
package mongo_test

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/xraph/nexus/id"
	mongostore "github.com/xraph/nexus/store/mongo"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

func TestLegacyUsageDocumentMigratesToUnpriced(t *testing.T) {
	ctx := context.Background()
	db, name := storetest.OpenMongoDB(t)
	usageID := id.NewUsageID().String()
	_, err := storetest.MongoClient(t).Database(name).Collection("nexus_usage_records").InsertOne(ctx, bson.M{
		"_id": usageID, "tenant_id": "", "key_id": "", "request_id": "",
		"provider": "openai", "model": "gpt-4o", "total_tokens": 10,
		"cost_usd": 0.0, "latency_ns": int64(0), "cached": false, "status_code": 502,
		"created_at": time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("insert legacy document: %v", err)
	}

	s := mongostore.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	got := storetest.FindRecord(t, s, id.MustParseUsageID(usageID))
	if got.CostUSD != nil || got.PricingStatus != usage.PricingUnpricedModel || got.Outcome != usage.OutcomeError {
		t.Fatalf("legacy document = cost %v, status %s, outcome %s", got.CostUSD, got.PricingStatus, got.Outcome)
	}
	if !got.TenantID.IsNil() {
		t.Fatalf("legacy empty tenant should read as nil, got %s", got.TenantID)
	}
}
```

- [ ] **Step 11: Keep the retiring dashboard compiling, then run everything**

`dashboard/components/helpers.go`: add the `money` import and replace `formatCost`:

```go
// formatCost formats an exact USD amount for the legacy dashboard.
func formatCost(cost money.USD) string { return "$" + cost.String() }

// formatCostPtr formats a cost that may be unknown.
func formatCostPtr(cost *money.USD) string {
	if cost == nil {
		return "unpriced"
	}
	return formatCost(*cost)
}
```

`dashboard/components/usage_table.templ`: change `{ formatCost(r.CostUSD) }` to `{ formatCostPtr(r.CostUSD) }`.

```bash
templ generate -path dashboard && gofmt -l dashboard
go build ./... && go test ./...
go test ./store/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: build and tests pass; every usage, legacy and earlier conformance subtest passes on all four backends (Postgres and Mongo need the Task 3 variables exported).

If Postgres fails to scan `cost_usd` into `numeric`, grove is not passing the field's address to pgx. Then select through a raw query in `FindRecord`'s path instead: that is a real finding, so stop and report it rather than reaching for a float.

- [ ] **Step 12: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add usage/outcome.go store/internal/conv/conv.go store/internal/conv/conv_test.go store/postgres/numeric.go store/storetest/usage.go store/storetest/usage_test.go store/sqlite/legacy_test.go store/postgres/legacy_test.go store/mongo/legacy_test.go
git commit --only -m "feat(usage)!: store exact cost, an outcome and nullable attribution

A usage record's cost is a *money.USD now: nil when the request could not be
priced, never \$0 standing in for unknown. Postgres stores NUMERIC(38,18),
SQLite rebuilds its table with TEXT cost and sortable time text, and Mongo
writes Decimal128. Rows written before this had cost 0 because nothing priced
them, so every backend's migration marks them unpriced." -- usage/outcome.go usage/usage.go provider/response.go pipeline/middlewares/usage.go store/internal/conv/conv.go store/internal/conv/conv_test.go store/memory.go store/memory_usage.go store/postgres/numeric.go store/postgres/models.go store/postgres/migrations.go store/postgres/legacy_test.go store/sqlite/models.go store/sqlite/migrations.go store/sqlite/legacy_test.go store/mongo/models.go store/mongo/store.go store/mongo/legacy_test.go store/storetest/usage.go store/storetest/usage_test.go dashboard/components/helpers.go dashboard/components/usage_table.templ dashboard/components/usage_table_templ.go
git show --stat HEAD
```

If `templ generate` rewrote other `*_templ.go` files (it should not; their sources did not change), check `git status dashboard` and add only those whose `.templ` you edited.

---

### Task 6: Tenant budgets in exact decimals

**Files:**
- Modify: `tenant/tenant.go` (`Quota.MonthlyBudgetUSD`)
- Modify: `store/mongo/models.go` (a quota document type)
- Modify: `store/storetest/fixtures.go` (budget in the tenant fixture)
- Create: `store/sqlite/legacy_tenant_test.go`, `store/postgres/legacy_tenant_test.go`, `store/mongo/legacy_tenant_test.go`
- Modify: `dashboard/components/helpers.go`, `dashboard/pages/helpers.templ`, `dashboard/pages/tenant_form.templ` (+ regenerated), `dashboard/contributor.go`
- Modify: `_examples/multi-tenant/main.go`

**Interfaces:**
- Consumes: `money.USD`, its JSON behaviour (Task 1); `usdFromBSON`, `decimalOf` (Task 5); `storetest.OpenSQLiteDB`, `OpenPostgresDB`, `OpenMongoDB`, `MongoClient` (Task 3).
- Produces: `tenant.Quota.MonthlyBudgetUSD money.USD` (`json:"monthly_budget_usd"`, zero means no budget). Postgres and SQLite keep storing the quota as JSON; the budget is now a JSON string there, and a legacy JSON number still reads exactly.

- [ ] **Step 1: Write the failing tests**

In `store/storetest/fixtures.go`, set the budget in `Tenant` (add the `money` import): `MonthlyBudgetUSD: money.MustParse("1234.567891"),` inside `tenant.Quota{…}`. `TestTenantRoundTripsEveryField` now checks the budget on every backend.

`store/sqlite/legacy_tenant_test.go`:

```go
package sqlite_test

import (
	"context"
	"testing"

	"github.com/xraph/grove/drivers/sqlitedriver"

	"github.com/xraph/nexus/id"
	sqlitestore "github.com/xraph/nexus/store/sqlite"
	"github.com/xraph/nexus/store/storetest"
)

// Budgets were float JSON numbers before they were exact strings. A tenant
// stored then must still load, with the budget exactly as written.
func TestLegacyTenantBudgetReadsExactly(t *testing.T) {
	ctx := context.Background()
	db := storetest.OpenSQLiteDB(t)
	s := sqlitestore.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tid := id.NewTenantID().String()
	_, err := sqlitedriver.Unwrap(db).Exec(ctx,
		`INSERT INTO tenants (id, name, slug, status, quota, config, metadata, created_at, updated_at)
         VALUES (?, 'Legacy', 'legacy', 'active', '{"rpm":60,"monthly_budget_usd":12.5}', '{}', '{}', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')`, tid)
	if err != nil {
		t.Fatalf("insert legacy tenant: %v", err)
	}
	got, err := s.Tenants().FindByID(ctx, tid)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.Quota.MonthlyBudgetUSD.String() != "12.5" || got.Quota.RPM != 60 {
		t.Fatalf("legacy quota = %+v", got.Quota)
	}
}
```

Read `store/sqlite/migrations.go` migration 1 before running: if the tenants table's columns differ from this insert, match them.

`store/postgres/legacy_tenant_test.go`:

```go
package postgres_test

import (
	"context"
	"testing"

	"github.com/xraph/grove/drivers/pgdriver"

	"github.com/xraph/nexus/id"
	pgstore "github.com/xraph/nexus/store/postgres"
	"github.com/xraph/nexus/store/storetest"
)

func TestLegacyTenantBudgetReadsExactly(t *testing.T) {
	ctx := context.Background()
	db := storetest.OpenPostgresDB(t)
	s := pgstore.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tid := id.NewTenantID().String()
	_, err := pgdriver.Unwrap(db).Exec(ctx,
		`INSERT INTO nexus_tenants (id, name, slug, status, quota, config, metadata)
         VALUES ($1, 'Legacy', 'legacy', 'active', '{"rpm":60,"monthly_budget_usd":12.5}'::jsonb, '{}'::jsonb, '{}'::jsonb)`, tid)
	if err != nil {
		t.Fatalf("insert legacy tenant: %v", err)
	}
	got, err := s.Tenants().FindByID(ctx, tid)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.Quota.MonthlyBudgetUSD.String() != "12.5" || got.Quota.RPM != 60 {
		t.Fatalf("legacy quota = %+v", got.Quota)
	}
}
```

Read `store/postgres/migrations.go` migration 1 first: if `nexus_tenants` has another `NOT NULL` column without a default, add it to the insert.

`store/mongo/legacy_tenant_test.go`:

```go
package mongo_test

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/xraph/nexus/id"
	mongostore "github.com/xraph/nexus/store/mongo"
	"github.com/xraph/nexus/store/storetest"
)

// The driver wrote tenant.Quota with its default codec: lowercased field
// names and the budget as a double. Those documents must still load.
func TestLegacyTenantDocumentReadsExactly(t *testing.T) {
	ctx := context.Background()
	db, name := storetest.OpenMongoDB(t)
	s := mongostore.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tid := id.NewTenantID().String()
	now := time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC)
	_, err := storetest.MongoClient(t).Database(name).Collection("nexus_tenants").InsertOne(ctx, bson.M{
		"_id": tid, "name": "Legacy", "slug": "legacy", "status": "active",
		"quota":  bson.M{"rpm": 60, "tpm": 0, "dailyrequests": 0, "monthlybudgetusd": 12.5, "maxtokensperreq": 0},
		"config": bson.M{}, "created_at": now, "updated_at": now,
	})
	if err != nil {
		t.Fatalf("insert legacy tenant: %v", err)
	}
	got, err := s.Tenants().FindByID(ctx, tid)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.Quota.MonthlyBudgetUSD.String() != "12.5" || got.Quota.RPM != 60 {
		t.Fatalf("legacy quota = %+v", got.Quota)
	}
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./store/...`
Expected: FAIL to compile: `cannot use money.MustParse("1234.567891") (value of struct type money.USD) as float64 value`.

- [ ] **Step 3: Change the quota type**

In `tenant/tenant.go` (add the `money` import), replace the budget line:

```go
	MonthlyBudgetUSD money.USD `json:"monthly_budget_usd"` // max spend per month, exact; zero means no budget
```

- [ ] **Step 4: Give Mongo a quota document it controls**

Embedding `tenant.Quota` would hand `money.USD`'s unexported field to the BSON codec, which writes an empty document: the budget would vanish silently. In `store/mongo/models.go` add:

```go
// quotaDoc is tenant.Quota as stored. Its keys are the lowercased names the
// driver's default codec wrote before this type existed, so old documents
// still read.
type quotaDoc struct {
	RPM               int           `bson:"rpm"`
	TPM               int           `bson:"tpm"`
	DailyRequests     int           `bson:"dailyrequests"`
	MonthlyBudgetUSD  any           `bson:"monthlybudgetusd"`
	MaxTokensPerReq   int           `bson:"maxtokensperreq"`
	MaxStreamDuration time.Duration `bson:"maxstreamduration"`
	MaxStreamTokens   int           `bson:"maxstreamtokens"`
}

func quotaToDoc(q tenant.Quota) (quotaDoc, error) {
	var budget any
	if !q.MonthlyBudgetUSD.IsZero() {
		b, err := decimalOf(&q.MonthlyBudgetUSD)
		if err != nil {
			return quotaDoc{}, err
		}
		budget = b
	}
	return quotaDoc{
		RPM: q.RPM, TPM: q.TPM, DailyRequests: q.DailyRequests, MonthlyBudgetUSD: budget,
		MaxTokensPerReq: q.MaxTokensPerReq, MaxStreamDuration: q.MaxStreamDuration, MaxStreamTokens: q.MaxStreamTokens,
	}, nil
}

func quotaFromDoc(d quotaDoc) (tenant.Quota, error) {
	q := tenant.Quota{
		RPM: d.RPM, TPM: d.TPM, DailyRequests: d.DailyRequests, MaxTokensPerReq: d.MaxTokensPerReq,
		MaxStreamDuration: d.MaxStreamDuration, MaxStreamTokens: d.MaxStreamTokens,
	}
	budget, err := usdFromBSON(d.MonthlyBudgetUSD)
	if err != nil {
		return tenant.Quota{}, err
	}
	if budget != nil {
		q.MonthlyBudgetUSD = *budget
	}
	return q, nil
}
```

Change `tenantModel.Quota` to `Quota quotaDoc \`grove:"quota" bson:"quota"\``. Make `tenantToModel` return `(*tenantModel, error)` using `quotaToDoc`, set `Quota` in `tenantFromModel` from `quotaFromDoc`, and update the two callers in `store/mongo/store.go` (tenant `Insert` and `Update`) to handle the error the way `usageStore.Insert` does in Task 5.

Postgres and SQLite need no model change: they marshal `tenant.Quota` to JSON, and `money.USD` already writes a string and reads a legacy number.

- [ ] **Step 5: Keep the retiring dashboard and the example compiling**

`dashboard/components/helpers.go` and `dashboard/pages/helpers.templ` each have a `formatBudget(v float64)`. Replace both with:

```go
// formatBudget formats a monthly budget; zero means no budget.
func formatBudget(v money.USD) string {
	if v.IsZero() {
		return "Unlimited"
	}
	return "$" + v.String()
}
```

adding the `money` import to each file's import block.

`dashboard/pages/tenant_form.templ`: replace `floatToStr` with

```go
func usdToStr(v money.USD) string {
	if v.IsZero() {
		return ""
	}
	return v.String()
}
```

and change its one caller to `return usdToStr(t.Quota.MonthlyBudgetUSD)`. Add the `money` import; remove `strconv` only if nothing else in the file uses it.

`dashboard/contributor.go`: replace `safeParseFloat` with

```go
// parseBudget reads a budget field; anything that is not an amount means
// no budget, as an empty field always did.
func parseBudget(s string) money.USD {
	v, err := money.Parse(s)
	if err != nil {
		return money.Zero
	}
	return v
}
```

and change lines 248 and 319 to `quota.MonthlyBudgetUSD = parseBudget(v)`.

`_examples/multi-tenant/main.go` line 64: `MonthlyBudgetUSD: money.MustParse("100"),` with the import added. Directories starting with `_` are outside `./...`, so build it explicitly.

```bash
templ generate -path dashboard && gofmt -l dashboard
go build ./... && go vet ./_examples/multi-tenant/
```

Expected: no output from `gofmt -l`; build and vet succeed.

- [ ] **Step 6: Run the suite**

```bash
go test ./...
go test ./store/... -v -run 'RoundTrip|Legacy' 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: the tenant round trip passes with the budget on all four backends, and the three legacy-tenant tests pass.

- [ ] **Step 7: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add store/sqlite/legacy_tenant_test.go store/postgres/legacy_tenant_test.go store/mongo/legacy_tenant_test.go
git commit --only -m "feat(tenant)!: hold a tenant's monthly budget as an exact decimal

The budget was a float in every backend. It is money.USD now, written as a
JSON string by Postgres and SQLite and as Decimal128 by Mongo, which gets a
quota document of its own so the codec cannot drop it. Budgets stored as
float numbers before still read, exactly as written." -- tenant/tenant.go store/mongo/models.go store/mongo/store.go store/storetest/fixtures.go store/sqlite/legacy_tenant_test.go store/postgres/legacy_tenant_test.go store/mongo/legacy_tenant_test.go dashboard/components/helpers.go dashboard/pages/helpers.templ dashboard/pages/helpers_templ.go dashboard/pages/tenant_form.templ dashboard/pages/tenant_form_templ.go dashboard/contributor.go _examples/multi-tenant/main.go
git show --stat HEAD
```

---

### Task 7: Exact aggregates, one set of rules on every backend

**Files:**
- Create: `usage/period.go`, `usage/summary.go`, `usage/summary_test.go`
- Modify: `usage/usage.go` (`Summary`, `ProviderUsage`, `ModelUsage`, the interfaces)
- Modify: `usage/service_impl.go`
- Modify: `store/memory_usage.go`, `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go`
- Create: `store/storetest/aggregate_test.go`
- Modify: `api/usage_handler.go`
- Modify: `dashboard/data.go`, `dashboard/pages/overview.templ`, `dashboard/pages/usage.templ`, `dashboard/pages/helpers.templ`, `dashboard/widgets/stats.templ`, `dashboard/widgets/monthly_spend.templ` (+ regenerated)

**Interfaces:**
- Consumes: `usage.Record` fields, `usage.Outcome`, `usage.PricingStatus` (Tasks 2, 5); `conv.TimeText`, `conv.ParseCost` (Task 5); `numeric` (Task 5); `usdFromBSON` (Task 5).
- Produces:
  - `usage.ErrInvalidPeriod`; `func usage.PeriodStart(period string, now time.Time) (time.Time, error)`
  - `usage.Summary{TenantID, Period string; TotalRequests, TotalTokens int; TotalCostUSD money.USD; UnpricedRequests int; CacheHitRate float64; AvgLatency time.Duration; ByProvider map[string]*ProviderUsage; ByModel map[string]*ModelUsage; ByOutcome map[Outcome]int}`
  - `usage.ProviderUsage` and `usage.ModelUsage`: `{Requests, Tokens int; CostUSD money.USD; Unpriced int}`
  - `usage.SummaryRow{Provider, Model string; Outcome Outcome; PricingStatus PricingStatus; Cached bool; Requests, Tokens int; LatencyNs int64; Cost money.USD}`; `func usage.BuildSummary(tenantID, period string, rows []SummaryRow) *Summary`
  - `usage.Store` / `usage.Service`: `MonthlySpend(ctx, tenantID string) (money.USD, error)`, `DailyRequests(ctx, tenantID string) (int, error)`, `Summary(ctx, tenantID, period string) (*Summary, error)`. **`tenantID == ""` means every tenant, including unattributed requests.** An unknown period returns `ErrInvalidPeriod`.

- [ ] **Step 1: Write the failing unit tests**

`usage/summary_test.go`:

```go
package usage_test

import (
	"errors"
	"testing"
	"time"

	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/usage"
)

func TestPeriodStart(t *testing.T) {
	now := time.Date(2026, 10, 7, 15, 4, 5, 0, time.FixedZone("CDT", -5*3600)) // 20:04:05 UTC
	cases := map[string]time.Time{
		"day":   time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC),
		"week":  time.Date(2026, 9, 30, 20, 4, 5, 0, time.UTC),
		"month": time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
	}
	for period, want := range cases {
		got, err := usage.PeriodStart(period, now)
		if err != nil || !got.Equal(want) || got.Location() != time.UTC {
			t.Errorf("PeriodStart(%s) = %s, %v; want %s UTC", period, got, err, want)
		}
	}
	if _, err := usage.PeriodStart("year", now); !errors.Is(err, usage.ErrInvalidPeriod) {
		t.Fatalf("an unknown period should be ErrInvalidPeriod, got %v", err)
	}
}

func TestBuildSummary(t *testing.T) {
	rows := []usage.SummaryRow{
		{Provider: "openai", Model: "gpt-4o", Outcome: usage.OutcomeOK, PricingStatus: usage.PricingPriced, Requests: 3, Tokens: 300, LatencyNs: int64(3 * time.Second), Cost: money.MustParse("0.00000045")},
		{Provider: "openai", Model: "gpt-4o", Outcome: usage.OutcomeCached, PricingStatus: usage.PricingCached, Cached: true, Requests: 1, Tokens: 100, LatencyNs: int64(time.Second)},
		{Provider: "local", Model: "llama", Outcome: usage.OutcomeOK, PricingStatus: usage.PricingUnpricedModel, Requests: 1, Tokens: 50, LatencyNs: int64(time.Second)},
	}
	s := usage.BuildSummary("", "month", rows)
	if s.TotalRequests != 5 || s.TotalTokens != 450 || s.UnpricedRequests != 1 {
		t.Fatalf("totals = %+v", s)
	}
	if s.TotalCostUSD.String() != "0.00000045" {
		t.Fatalf("total cost = %s", s.TotalCostUSD)
	}
	if s.CacheHitRate != 0.2 || s.AvgLatency != time.Second {
		t.Fatalf("cache hit rate %v, avg latency %s", s.CacheHitRate, s.AvgLatency)
	}
	if s.ByOutcome[usage.OutcomeOK] != 4 || s.ByOutcome[usage.OutcomeCached] != 1 {
		t.Fatalf("by outcome = %v", s.ByOutcome)
	}
	if m := s.ByModel["llama"]; m == nil || m.Unpriced != 1 || !m.CostUSD.IsZero() {
		t.Fatalf("llama = %+v", m)
	}
	if p := s.ByProvider["openai"]; p == nil || p.Requests != 4 || p.CostUSD.String() != "0.00000045" {
		t.Fatalf("openai = %+v", p)
	}
	if empty := usage.BuildSummary("t", "day", nil); empty.CacheHitRate != 0 || empty.AvgLatency != 0 || empty.ByModel == nil {
		t.Fatalf("an empty summary should have zero rates and non-nil maps, got %+v", empty)
	}
}
```

Run: `go test ./usage/`
Expected: FAIL to compile, `undefined: usage.PeriodStart`.

- [ ] **Step 2: Write `PeriodStart` and `BuildSummary`, and change the types**

`usage/period.go`:

```go
package usage

import (
	"errors"
	"fmt"
	"time"
)

// ErrInvalidPeriod reports a period other than day, week or month.
var ErrInvalidPeriod = errors.New("nexus: period must be day, week or month")

// PeriodStart is the UTC instant a period began as of now: midnight UTC for
// "day", seven days before now for "week", the first of the month at
// midnight UTC for "month". Every backend uses it, so none computes "now"
// in its own time zone.
func PeriodStart(period string, now time.Time) (time.Time, error) {
	now = now.UTC()
	switch period {
	case "day":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), nil
	case "week":
		return now.Add(-7 * 24 * time.Hour), nil
	case "month":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), nil
	}
	return time.Time{}, fmt.Errorf("%w: %q", ErrInvalidPeriod, period)
}
```

In `usage/usage.go`, replace `Summary`, `ProviderUsage`, `ModelUsage`, `Service` and `Store` (keep `QueryOptions` and `Query` as they are until Task 8):

```go
// Summary aggregates usage over a period.
type Summary struct {
	// TenantID is "" when the summary covers every tenant, unattributed
	// requests included.
	TenantID      string `json:"tenant_id"`
	Period        string `json:"period"`
	TotalRequests int    `json:"total_requests"`
	TotalTokens   int    `json:"total_tokens"`
	// TotalCostUSD sums priced requests only. UnpricedRequests counts the
	// requests it leaves out because their cost is unknown.
	TotalCostUSD     money.USD                 `json:"total_cost_usd"`
	UnpricedRequests int                       `json:"unpriced_requests"`
	CacheHitRate     float64                   `json:"cache_hit_rate"` // share of requests served from cache, 0 to 1
	AvgLatency       time.Duration             `json:"avg_latency"`
	ByProvider       map[string]*ProviderUsage `json:"by_provider"`
	ByModel          map[string]*ModelUsage    `json:"by_model"`
	ByOutcome        map[Outcome]int           `json:"by_outcome"`
}

// ProviderUsage is usage aggregated by provider.
type ProviderUsage struct {
	Requests int       `json:"requests"`
	Tokens   int       `json:"tokens"`
	CostUSD  money.USD `json:"cost_usd"`
	Unpriced int       `json:"unpriced"`
}

// ModelUsage is usage aggregated by model.
type ModelUsage struct {
	Requests int       `json:"requests"`
	Tokens   int       `json:"tokens"`
	CostUSD  money.USD `json:"cost_usd"`
	Unpriced int       `json:"unpriced"`
}

// Service tracks and queries usage data. Wherever a method takes a tenant
// id, "" means every tenant, including requests attributed to none.
type Service interface {
	Record(ctx context.Context, rec *Record) error
	MonthlySpend(ctx context.Context, tenantID string) (money.USD, error)
	DailyRequests(ctx context.Context, tenantID string) (int, error)
	Summary(ctx context.Context, tenantID string, period string) (*Summary, error)
	Query(ctx context.Context, opts *QueryOptions) ([]*Record, int, error)
}

// Store is the persistence interface for usage records. Wherever a method
// takes a tenant id, "" means every tenant, including requests attributed
// to none. Summary returns ErrInvalidPeriod for a period other than day,
// week or month.
type Store interface {
	Insert(ctx context.Context, rec *Record) error
	MonthlySpend(ctx context.Context, tenantID string) (money.USD, error)
	DailyRequests(ctx context.Context, tenantID string) (int, error)
	Summary(ctx context.Context, tenantID string, period string) (*Summary, error)
	Query(ctx context.Context, opts *QueryOptions) ([]*Record, int, error)
}
```

`usage/summary.go`:

```go
package usage

import (
	"time"

	"github.com/xraph/nexus/money"
)

// SummaryRow is one group of records a backend aggregated: requests sharing
// provider, model, outcome, pricing status and cache flag. A backend that
// cannot group (SQLite, memory) passes one row per record with Requests 1.
// Cost sums priced records only; it is zero for an unpriced group.
type SummaryRow struct {
	Provider      string
	Model         string
	Outcome       Outcome
	PricingStatus PricingStatus
	Cached        bool
	Requests      int
	Tokens        int
	LatencyNs     int64
	Cost          money.USD
}

// BuildSummary turns grouped rows into a Summary. Every backend calls it, so
// the rules for what counts as unpriced, cached or average live in one place.
func BuildSummary(tenantID, period string, rows []SummaryRow) *Summary {
	s := &Summary{
		TenantID:   tenantID,
		Period:     period,
		ByProvider: make(map[string]*ProviderUsage),
		ByModel:    make(map[string]*ModelUsage),
		ByOutcome:  make(map[Outcome]int),
	}
	var latency int64
	var cached int
	for _, r := range rows {
		s.TotalRequests += r.Requests
		s.TotalTokens += r.Tokens
		s.TotalCostUSD = s.TotalCostUSD.Add(r.Cost)
		s.ByOutcome[r.Outcome] += r.Requests
		latency += r.LatencyNs
		unpriced := 0
		if r.PricingStatus == PricingUnpricedModel {
			unpriced = r.Requests
			s.UnpricedRequests += r.Requests
		}
		if r.Cached {
			cached += r.Requests
		}

		p := s.ByProvider[r.Provider]
		if p == nil {
			p = &ProviderUsage{}
			s.ByProvider[r.Provider] = p
		}
		p.Requests += r.Requests
		p.Tokens += r.Tokens
		p.CostUSD = p.CostUSD.Add(r.Cost)
		p.Unpriced += unpriced

		m := s.ByModel[r.Model]
		if m == nil {
			m = &ModelUsage{}
			s.ByModel[r.Model] = m
		}
		m.Requests += r.Requests
		m.Tokens += r.Tokens
		m.CostUSD = m.CostUSD.Add(r.Cost)
		m.Unpriced += unpriced
	}
	if s.TotalRequests > 0 {
		s.CacheHitRate = float64(cached) / float64(s.TotalRequests)
		s.AvgLatency = time.Duration(latency / int64(s.TotalRequests))
	}
	return s
}
```

`usage/service_impl.go`: change `MonthlySpend`'s return type to `(money.USD, error)` and add the import.

Run: `go test ./usage/`
Expected: PASS. (`go build ./...` fails until the stores follow in Steps 4 to 7.)

- [ ] **Step 3: Write the failing conformance tests**

`store/storetest/aggregate_test.go`:

```go
package storetest_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

func TestSummaryIsExactAndCountsWhatItLeavesOut(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		for range 3 {
			storetest.InsertRecord(t, s, storetest.Record(tn.ID, "0.000000150"))
		}
		unpriced := storetest.Record(tn.ID, "")
		unpriced.Provider, unpriced.Model = "local", "llama"
		storetest.InsertRecord(t, s, unpriced)
		hit := storetest.Record(tn.ID, "0")
		hit.Cached, hit.Outcome, hit.PricingStatus = true, usage.OutcomeCached, usage.PricingCached
		storetest.InsertRecord(t, s, hit)

		sum, err := s.Usage().Summary(ctx, tn.ID.String(), "month")
		if err != nil {
			t.Fatalf("summary: %v", err)
		}
		if sum.TotalRequests != 5 || sum.UnpricedRequests != 1 || sum.TotalCostUSD.String() != "0.00000045" {
			t.Fatalf("summary = requests %d, unpriced %d, cost %s", sum.TotalRequests, sum.UnpricedRequests, sum.TotalCostUSD)
		}
		if sum.CacheHitRate != 0.2 || sum.ByOutcome[usage.OutcomeCached] != 1 || sum.ByOutcome[usage.OutcomeOK] != 4 {
			t.Fatalf("cache %v, outcomes %v", sum.CacheHitRate, sum.ByOutcome)
		}
		if sum.AvgLatency != 1500*time.Millisecond {
			t.Fatalf("avg latency = %s", sum.AvgLatency)
		}
		if m := sum.ByModel["llama"]; m == nil || m.Unpriced != 1 {
			t.Fatalf("llama = %+v", m)
		}
	})
}

func TestEmptyTenantMeansEveryTenantAndNoOneElse(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		a, b := storetest.InsertTenant(t, s), storetest.InsertTenant(t, s)
		storetest.InsertRecord(t, s, storetest.Record(a.ID, "1.10"))
		storetest.InsertRecord(t, s, storetest.Record(b.ID, "2.20"))
		storetest.InsertRecord(t, s, storetest.Record(id.Nil, "3.30"))

		all, err := s.Usage().MonthlySpend(ctx, "")
		if err != nil || all.String() != "6.6" {
			t.Fatalf("every tenant spend = %s, %v; want 6.6", all, err)
		}
		onlyA, err := s.Usage().MonthlySpend(ctx, a.ID.String())
		if err != nil || onlyA.String() != "1.1" {
			t.Fatalf("tenant A spend = %s, %v; want 1.1", onlyA, err)
		}
		sumAll, err := s.Usage().Summary(ctx, "", "day")
		if err != nil || sumAll.TotalRequests != 3 {
			t.Fatalf("every tenant summary = %v, %v", sumAll, err)
		}
		reqA, err := s.Usage().DailyRequests(ctx, a.ID.String())
		if err != nil || reqA != 1 {
			t.Fatalf("tenant A daily requests = %d, %v", reqA, err)
		}
	})
}

func TestPeriodsStartWhereTheyShould(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		now := time.Now()
		dayStart, _ := usage.PeriodStart("day", now)
		monthStart, _ := usage.PeriodStart("month", now)

		before := storetest.Record(tn.ID, "5")
		before.CreatedAt = dayStart.Add(-time.Second)
		at := storetest.Record(tn.ID, "7")
		at.CreatedAt = dayStart
		old := storetest.Record(tn.ID, "11")
		old.CreatedAt = monthStart.Add(-time.Second)
		for _, r := range []*usage.Record{before, at, old} {
			storetest.InsertRecord(t, s, r)
		}

		reqs, err := s.Usage().DailyRequests(ctx, tn.ID.String())
		if err != nil || reqs != 1 {
			t.Fatalf("daily requests = %d, %v; want only the record at midnight", reqs, err)
		}
		spend, err := s.Usage().MonthlySpend(ctx, tn.ID.String())
		want := money.MustParse("7")
		if !before.CreatedAt.Before(monthStart) {
			want = want.Add(money.MustParse("5")) // yesterday is still this month
		}
		if err != nil || !spend.Equal(want) {
			t.Fatalf("month spend = %s, %v; want %s", spend, err, want)
		}
	})
}

func TestManySubCentCostsSumExactly(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		tn := storetest.InsertTenant(t, s)
		for range 1000 {
			storetest.InsertRecord(t, s, storetest.Record(tn.ID, "0.000000150"))
		}
		spend, err := s.Usage().MonthlySpend(context.Background(), tn.ID.String())
		if err != nil || spend.String() != "0.00015" {
			t.Fatalf("1000 × 0.000000150 = %s, %v; want exactly 0.00015", spend, err)
		}
	})
}

func TestAnUnknownPeriodIsRefused(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		if _, err := s.Usage().Summary(context.Background(), "", "year"); !errors.Is(err, usage.ErrInvalidPeriod) {
			t.Fatalf("summary over a year = %v, want ErrInvalidPeriod", err)
		}
	})
}
```

`TestPeriodsStartWhereTheyShould` relies on `storetest.Record` not truncating `CreatedAt` further than seconds; `dayStart` is already whole seconds.

- [ ] **Step 4: Memory**

Replace the aggregates in `store/memory_usage.go` (imports: `context`, `strconv` removed, `sync`, `time`, `money`, `usage`):

```go
func (s *memoryUsageStore) inWindow(tenantID string, since time.Time) []*usage.Record {
	var out []*usage.Record
	for _, r := range s.records {
		if tenantID != "" && r.TenantID.String() != tenantID {
			continue
		}
		if r.CreatedAt.Before(since) {
			continue
		}
		out = append(out, r)
	}
	return out
}

func (s *memoryUsageStore) MonthlySpend(_ context.Context, tenantID string) (money.USD, error) {
	since, err := usage.PeriodStart("month", time.Now())
	if err != nil {
		return money.Zero, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	total := money.Zero
	for _, r := range s.inWindow(tenantID, since) {
		if r.CostUSD != nil {
			total = total.Add(*r.CostUSD)
		}
	}
	return total, nil
}

func (s *memoryUsageStore) DailyRequests(_ context.Context, tenantID string) (int, error) {
	since, err := usage.PeriodStart("day", time.Now())
	if err != nil {
		return 0, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.inWindow(tenantID, since)), nil
}

func (s *memoryUsageStore) Summary(_ context.Context, tenantID, period string) (*usage.Summary, error) {
	since, err := usage.PeriodStart(period, time.Now())
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	records := s.inWindow(tenantID, since)
	rows := make([]usage.SummaryRow, 0, len(records))
	for _, r := range records {
		rows = append(rows, rowOf(r))
	}
	return usage.BuildSummary(tenantID, period, rows), nil
}

// rowOf is one record as a summary row, for backends that cannot group.
func rowOf(r *usage.Record) usage.SummaryRow {
	row := usage.SummaryRow{
		Provider: r.Provider, Model: r.Model, Outcome: r.Outcome, PricingStatus: r.PricingStatus,
		Cached: r.Cached, Requests: 1, Tokens: r.TotalTokens, LatencyNs: r.Latency.Nanoseconds(),
	}
	if r.CostUSD != nil {
		row.Cost = *r.CostUSD
	}
	return row
}
```

- [ ] **Step 5: Postgres, aggregated in SQL**

Replace `MonthlySpend`, `DailyRequests` and `Summary` in `store/postgres/store.go` (add the `time` and `money` imports):

```go
func (s *usageStore) MonthlySpend(ctx context.Context, tenantID string) (money.USD, error) {
	since, err := usage.PeriodStart("month", time.Now())
	if err != nil {
		return money.Zero, err
	}
	var total numeric
	err = s.pgdb.QueryRow(ctx,
		`SELECT SUM(cost_usd) FROM nexus_usage_records
		  WHERE ($1 = '' OR tenant_id = $1) AND created_at >= $2`,
		tenantID, since).Scan(&total)
	if err != nil {
		return money.Zero, fmt.Errorf("nexus/postgres: monthly spend: %w", err)
	}
	u, err := total.usd()
	if err != nil || u == nil {
		return money.Zero, err
	}
	return *u, nil
}

func (s *usageStore) DailyRequests(ctx context.Context, tenantID string) (int, error) {
	since, err := usage.PeriodStart("day", time.Now())
	if err != nil {
		return 0, err
	}
	var count int
	err = s.pgdb.QueryRow(ctx,
		`SELECT COUNT(*) FROM nexus_usage_records
		  WHERE ($1 = '' OR tenant_id = $1) AND created_at >= $2`,
		tenantID, since).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("nexus/postgres: daily requests: %w", err)
	}
	return count, nil
}

func (s *usageStore) Summary(ctx context.Context, tenantID, period string) (*usage.Summary, error) {
	since, err := usage.PeriodStart(period, time.Now())
	if err != nil {
		return nil, err
	}
	rows, err := s.pgdb.Query(ctx,
		`SELECT provider, model, outcome, pricing_status, cached, COUNT(*),
		        COALESCE(SUM(total_tokens), 0)::bigint, COALESCE(SUM(latency_ns), 0)::bigint,
		        SUM(cost_usd)
		   FROM nexus_usage_records
		  WHERE ($1 = '' OR tenant_id = $1) AND created_at >= $2
		  GROUP BY provider, model, outcome, pricing_status, cached`,
		tenantID, since)
	if err != nil {
		return nil, fmt.Errorf("nexus/postgres: summary: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []usage.SummaryRow
	for rows.Next() {
		var r usage.SummaryRow
		var outcome, status string
		var tokens, latency int64
		var cost numeric
		if err := rows.Scan(&r.Provider, &r.Model, &outcome, &status, &r.Cached, &r.Requests, &tokens, &latency, &cost); err != nil {
			return nil, fmt.Errorf("nexus/postgres: summary scan: %w", err)
		}
		r.Outcome, r.PricingStatus, r.Tokens, r.LatencyNs = usage.Outcome(outcome), usage.PricingStatus(status), int(tokens), latency
		c, err := cost.usd()
		if err != nil {
			return nil, err
		}
		if c != nil {
			r.Cost = *c
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return usage.BuildSummary(tenantID, period, out), nil
}
```

`SUM` over `NUMERIC` stays `NUMERIC`, so the total arrives as exact text.

- [ ] **Step 6: SQLite, summed in Go**

Replace the three methods in `store/sqlite/store.go` (imports `time`, `money`, `conv`). SQLite's `SUM` would turn `TEXT` cost into `REAL`, so these read rows and add in Go:

```go
func (s *usageStore) MonthlySpend(ctx context.Context, tenantID string) (money.USD, error) {
	since, err := usage.PeriodStart("month", time.Now())
	if err != nil {
		return money.Zero, err
	}
	rows, err := s.sdb.Query(ctx,
		`SELECT cost_usd FROM usage_records
		  WHERE (? = '' OR tenant_id = ?) AND created_at >= ? AND cost_usd IS NOT NULL`,
		tenantID, tenantID, conv.TimeText(since))
	if err != nil {
		return money.Zero, fmt.Errorf("nexus/sqlite: monthly spend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	total := money.Zero
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return money.Zero, fmt.Errorf("nexus/sqlite: monthly spend scan: %w", err)
		}
		c, err := conv.ParseCost(&text)
		if err != nil {
			return money.Zero, err
		}
		total = total.Add(*c)
	}
	return total, rows.Err()
}

func (s *usageStore) DailyRequests(ctx context.Context, tenantID string) (int, error) {
	since, err := usage.PeriodStart("day", time.Now())
	if err != nil {
		return 0, err
	}
	var count int
	err = s.sdb.QueryRow(ctx,
		`SELECT COUNT(*) FROM usage_records WHERE (? = '' OR tenant_id = ?) AND created_at >= ?`,
		tenantID, tenantID, conv.TimeText(since)).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("nexus/sqlite: daily requests: %w", err)
	}
	return count, nil
}

func (s *usageStore) Summary(ctx context.Context, tenantID, period string) (*usage.Summary, error) {
	since, err := usage.PeriodStart(period, time.Now())
	if err != nil {
		return nil, err
	}
	rows, err := s.sdb.Query(ctx,
		`SELECT provider, model, outcome, pricing_status, cached, total_tokens, latency_ns, cost_usd
		   FROM usage_records WHERE (? = '' OR tenant_id = ?) AND created_at >= ?`,
		tenantID, tenantID, conv.TimeText(since))
	if err != nil {
		return nil, fmt.Errorf("nexus/sqlite: summary: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []usage.SummaryRow
	for rows.Next() {
		r := usage.SummaryRow{Requests: 1}
		var outcome, status string
		var cost *string
		if err := rows.Scan(&r.Provider, &r.Model, &outcome, &status, &r.Cached, &r.Tokens, &r.LatencyNs, &cost); err != nil {
			return nil, fmt.Errorf("nexus/sqlite: summary scan: %w", err)
		}
		r.Outcome, r.PricingStatus = usage.Outcome(outcome), usage.PricingStatus(status)
		c, err := conv.ParseCost(cost)
		if err != nil {
			return nil, err
		}
		if c != nil {
			r.Cost = *c
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return usage.BuildSummary(tenantID, period, out), nil
}
```

If the modernc driver will not scan the `cached` integer straight into a `bool`, scan it into an `int` and set `r.Cached = cached != 0`.

- [ ] **Step 7: Mongo, aggregated in the pipeline**

Replace the three methods in `store/mongo/store.go`:

```go
func tenantMatch(tenantID string, since time.Time) bson.M {
	m := bson.M{"created_at": bson.M{"$gte": since}}
	if tenantID != "" {
		m["tenant_id"] = tenantID
	}
	return m
}

func (s *usageStore) MonthlySpend(ctx context.Context, tenantID string) (money.USD, error) {
	since, err := usage.PeriodStart("month", time.Now())
	if err != nil {
		return money.Zero, err
	}
	cursor, err := s.mdb.Collection(colUsage).Aggregate(ctx, bson.A{
		bson.M{"$match": tenantMatch(tenantID, since)},
		bson.M{"$group": bson.M{"_id": nil, "total": bson.M{"$sum": "$cost_usd"}}},
	})
	if err != nil {
		return money.Zero, fmt.Errorf("nexus/mongo: monthly spend: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()
	var result struct {
		Total any `bson:"total"`
	}
	if cursor.Next(ctx) {
		if err := cursor.Decode(&result); err != nil {
			return money.Zero, fmt.Errorf("nexus/mongo: monthly spend decode: %w", err)
		}
	}
	u, err := usdFromBSON(result.Total)
	if err != nil || u == nil {
		return money.Zero, err
	}
	return *u, nil
}

func (s *usageStore) DailyRequests(ctx context.Context, tenantID string) (int, error) {
	since, err := usage.PeriodStart("day", time.Now())
	if err != nil {
		return 0, err
	}
	n, err := s.mdb.Collection(colUsage).CountDocuments(ctx, tenantMatch(tenantID, since))
	if err != nil {
		return 0, fmt.Errorf("nexus/mongo: daily requests: %w", err)
	}
	return int(n), nil
}

func (s *usageStore) Summary(ctx context.Context, tenantID, period string) (*usage.Summary, error) {
	since, err := usage.PeriodStart(period, time.Now())
	if err != nil {
		return nil, err
	}
	cursor, err := s.mdb.Collection(colUsage).Aggregate(ctx, bson.A{
		bson.M{"$match": tenantMatch(tenantID, since)},
		bson.M{"$group": bson.M{
			"_id": bson.M{
				"provider": "$provider", "model": "$model", "outcome": "$outcome",
				"pricing_status": "$pricing_status", "cached": "$cached",
			},
			"requests": bson.M{"$sum": 1},
			"tokens":   bson.M{"$sum": "$total_tokens"},
			"latency":  bson.M{"$sum": "$latency_ns"},
			"cost":     bson.M{"$sum": "$cost_usd"},
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("nexus/mongo: summary: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()
	var out []usage.SummaryRow
	for cursor.Next(ctx) {
		var g struct {
			ID struct {
				Provider      string `bson:"provider"`
				Model         string `bson:"model"`
				Outcome       string `bson:"outcome"`
				PricingStatus string `bson:"pricing_status"`
				Cached        bool   `bson:"cached"`
			} `bson:"_id"`
			Requests int   `bson:"requests"`
			Tokens   int   `bson:"tokens"`
			Latency  int64 `bson:"latency"`
			Cost     any   `bson:"cost"`
		}
		if err := cursor.Decode(&g); err != nil {
			return nil, fmt.Errorf("nexus/mongo: summary decode: %w", err)
		}
		r := usage.SummaryRow{
			Provider: g.ID.Provider, Model: g.ID.Model, Outcome: usage.Outcome(g.ID.Outcome),
			PricingStatus: usage.PricingStatus(g.ID.PricingStatus), Cached: g.ID.Cached,
			Requests: g.Requests, Tokens: g.Tokens, LatencyNs: g.Latency,
		}
		c, err := usdFromBSON(g.Cost)
		if err != nil {
			return nil, err
		}
		if c != nil {
			r.Cost = *c
		}
		out = append(out, r)
	}
	if err := cursor.Err(); err != nil {
		return nil, err
	}
	return usage.BuildSummary(tenantID, period, out), nil
}
```

`$sum` skips nulls, and over `Decimal128` it is exact. A group of only unpriced records sums to integer `0`, which `usdFromBSON` reads.

If `s.mdb.Collection(colUsage)` has no `CountDocuments`, replace `DailyRequests`'s body with an aggregation of `$match` then `{"$count": "count"}` as the old code did.

- [ ] **Step 8: The API and the retiring dashboard**

`api/usage_handler.go`: the handler requires `tenant_id` today. Keep that, and map an unknown period to 400 (add the `errors` and `usage` imports):

```go
		summary, err := a.gw.Usage().Summary(r.Context(), tenantID, period)
		if errors.Is(err, usage.ErrInvalidPeriod) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err != nil {
```

Dashboard, all to compile against the new types:

- `dashboard/data.go`: `fetchMonthlySpend` returns `money.USD` (`money.Zero` where it returned 0).
- `dashboard/pages/overview.templ` and `dashboard/pages/usage.templ`: the `MonthlySpend float64` fields become `money.USD`, with the import.
- `dashboard/widgets/stats.templ`: `MonthlySpend money.USD`, and its `formatCost` becomes `func formatCost(cost money.USD) string { return "$" + cost.String() }`, with the `money` import (drop `strconv` only if unused).
- `dashboard/widgets/monthly_spend.templ`: `Spend money.USD`, with the import.
- `dashboard/pages/helpers.templ`: `formatCost` becomes the same one-line `money.USD` form.

```bash
templ generate -path dashboard && gofmt -l dashboard
go build ./... && go test ./...
go test ./store/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: build and tests pass; all aggregate tests pass on all four backends.

- [ ] **Step 9: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add usage/period.go usage/summary.go usage/summary_test.go store/storetest/aggregate_test.go
git commit --only -m "feat(usage)!: exact spend and summaries, the same on every backend

MonthlySpend and the summary totals are money.USD now. Postgres sums NUMERIC,
Mongo sums Decimal128 and SQLite reads rows and adds in Go, because its SUM
would turn text back into a float. Every backend builds its summary through
BuildSummary and takes its window from PeriodStart in UTC, so the memory
store's empty Summary and all-time daily counts are gone. An empty tenant id
now means every tenant on every backend, unattributed requests included, and
the summary counts the requests it could not price." -- usage/usage.go usage/period.go usage/summary.go usage/summary_test.go usage/service_impl.go store/memory_usage.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/storetest/aggregate_test.go api/usage_handler.go dashboard/data.go dashboard/pages/overview.templ dashboard/pages/overview_templ.go dashboard/pages/usage.templ dashboard/pages/usage_templ.go dashboard/pages/helpers.templ dashboard/pages/helpers_templ.go dashboard/widgets/stats.templ dashboard/widgets/stats_templ.go dashboard/widgets/monthly_spend.templ dashboard/widgets/monthly_spend_templ.go
git show --stat HEAD
```

---

### Task 8: Cursor paging and store-side filters

**Files:**
- Modify: `tenant/tenant.go`, `tenant/service_impl.go`
- Modify: `key/key.go`
- Modify: `usage/usage.go`, `usage/service_impl.go`
- Modify: `store/memory_tenant.go`, `store/memory_key.go`, `store/memory_usage.go`
- Modify: `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go`
- Modify: `store/storetest/usage.go` (`FindRecord`)
- Create: `store/storetest/paging_test.go`
- Modify: `api/tenant_handler.go`, `dashboard/data.go`

**Interfaces:**
- Consumes: `paging.Limit`, `paging.CheckCursor`, `paging.Trim`, `paging.ErrInvalidCursor` (Task 3); `conv.LikePattern`, `conv.TimeText` (Task 5).
- Produces:
  - `tenant.ListOptions{Status, Search string; Limit int; Cursor string}`, `tenant.ListResult{Items []*Tenant \`json:"items"\`; NextCursor string \`json:"next_cursor"\`}`; `tenant.Store.List` and `tenant.Service.List` return `(*ListResult, error)`
  - `key.ListOptions{TenantID string; Status Status; Limit int; Cursor string}`, `key.ListResult{Items []*APIKey; NextCursor string}`; `key.Store.List(ctx, *ListOptions) (*ListResult, error)` (new; `ListByTenant` stays)
  - `usage.QueryOptions{TenantID, KeyID, Provider, Model string; Outcome Outcome; StartTime, EndTime time.Time; Limit int; Cursor string}` (Offset gone; `EndTime` is exclusive); `usage.QueryResult{Items []*Record; NextCursor string}`; `Query` returns `(*QueryResult, error)` on `Store` and `Service`
  - Order everywhere: newest first by ID. Postgres compares IDs with `COLLATE "C"`, so a non-C database collation cannot reorder them.

- [ ] **Step 1: Write the failing tests**

Update `FindRecord` in `store/storetest/usage.go` to the paged form:

```go
func FindRecord(t *testing.T, s store.Store, rid id.UsageID) *usage.Record {
	t.Helper()
	cursor := ""
	for {
		res, err := s.Usage().Query(context.Background(), &usage.QueryOptions{Limit: 500, Cursor: cursor})
		if err != nil {
			t.Fatalf("query: %v", err)
		}
		for _, r := range res.Items {
			if r.ID.String() == rid.String() {
				return r
			}
		}
		if res.NextCursor == "" {
			t.Fatalf("record %s not found", rid)
		}
		cursor = res.NextCursor
	}
}
```

`store/storetest/paging_test.go`:

```go
package storetest_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/key"
	"github.com/xraph/nexus/paging"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/tenant"
	"github.com/xraph/nexus/usage"
)

func TestUsagePagesNeitherSkipNorRepeat(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		tn := storetest.InsertTenant(t, s)
		var want []string
		for range 7 {
			r := storetest.Record(tn.ID, "0.01")
			storetest.InsertRecord(t, s, r)
			want = append(want, r.ID.String())
		}
		slices.Sort(want)
		slices.Reverse(want) // newest first by id

		var got []string
		cursor := ""
		for {
			res, err := s.Usage().Query(ctx, &usage.QueryOptions{TenantID: tn.ID.String(), Limit: 3, Cursor: cursor})
			if err != nil {
				t.Fatalf("query: %v", err)
			}
			if len(res.Items) > 3 {
				t.Fatalf("page of %d over a limit of 3", len(res.Items))
			}
			for _, r := range res.Items {
				got = append(got, r.ID.String())
			}
			if res.NextCursor == "" {
				break
			}
			cursor = res.NextCursor
		}
		if !slices.Equal(got, want) {
			t.Fatalf("paged ids:\n got %v\nwant %v", got, want)
		}
	})
}

func TestUsageFiltersRunAtTheStore(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		a, b := storetest.InsertTenant(t, s), storetest.InsertTenant(t, s)
		match := storetest.Record(a.ID, "0.01")
		match.Provider, match.Model, match.Outcome, match.RefusalCode = "anthropic", "claude-sonnet-4-5", usage.OutcomeRefused, "rate_limited"
		match.CreatedAt = storetest.Now().Add(-time.Hour)
		decoys := []*usage.Record{
			storetest.Record(b.ID, "0.01"),       // other tenant
			storetest.Record(a.ID, "0.01"),       // other provider and outcome
			func() *usage.Record { r := *match; r.ID, r.KeyID = id.NewUsageID(), id.NewKeyID(); return &r }(), // other key
			func() *usage.Record { r := *match; r.ID = id.NewUsageID(); r.CreatedAt = storetest.Now().Add(-48 * time.Hour); return &r }(), // too old
		}
		for _, r := range append([]*usage.Record{match}, decoys...) {
			storetest.InsertRecord(t, s, r)
		}
		res, err := s.Usage().Query(ctx, &usage.QueryOptions{
			TenantID: a.ID.String(), KeyID: match.KeyID.String(), Provider: "anthropic",
			Model: "claude-sonnet-4-5", Outcome: usage.OutcomeRefused,
			StartTime: storetest.Now().Add(-2 * time.Hour), EndTime: storetest.Now(),
		})
		if err != nil {
			t.Fatalf("query: %v", err)
		}
		if len(res.Items) != 1 || res.Items[0].ID.String() != match.ID.String() {
			ids := make([]string, len(res.Items))
			for i, r := range res.Items {
				ids[i] = r.ID.String()
			}
			t.Fatalf("filtered = %v, want only %s", ids, match.ID)
		}
	})
}

func TestTenantListPagesAndSearches(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		var all []string
		for _, slug := range []string{"acme-search", "acme_billing", "globex", "100%-off"} {
			tn := storetest.Tenant(slug)
			if err := s.Tenants().Insert(ctx, tn); err != nil {
				t.Fatalf("insert: %v", err)
			}
			all = append(all, tn.ID.String())
		}
		suspended := storetest.Tenant("initech")
		suspended.Status = tenant.StatusSuspended
		if err := s.Tenants().Insert(ctx, suspended); err != nil {
			t.Fatalf("insert: %v", err)
		}

		first, err := s.Tenants().List(ctx, &tenant.ListOptions{Limit: 2})
		if err != nil || len(first.Items) != 2 || first.NextCursor == "" {
			t.Fatalf("first page = %v, %v", first, err)
		}
		rest, err := s.Tenants().List(ctx, &tenant.ListOptions{Limit: 10, Cursor: first.NextCursor})
		if err != nil || len(rest.Items) != 3 || rest.NextCursor != "" {
			t.Fatalf("second page = %v, %v", rest, err)
		}

		search := func(term string) []string {
			res, err := s.Tenants().List(ctx, &tenant.ListOptions{Search: term})
			if err != nil {
				t.Fatalf("search %q: %v", term, err)
			}
			var slugs []string
			for _, tn := range res.Items {
				slugs = append(slugs, tn.Slug)
			}
			slices.Sort(slugs)
			return slugs
		}
		if got := search("ACME"); !slices.Equal(got, []string{"acme-search", "acme_billing"}) {
			t.Fatalf("search ACME = %v", got)
		}
		// A wildcard in the term is a literal, not a pattern.
		if got := search("_"); !slices.Equal(got, []string{"acme_billing"}) {
			t.Fatalf("search _ = %v", got)
		}
		if got := search("%"); !slices.Equal(got, []string{"100%-off"}) {
			t.Fatalf("search %% = %v", got)
		}

		res, err := s.Tenants().List(ctx, &tenant.ListOptions{Status: string(tenant.StatusSuspended)})
		if err != nil || len(res.Items) != 1 || res.Items[0].Slug != "initech" {
			t.Fatalf("status filter = %v, %v", res, err)
		}
	})
}

func TestKeyListAcrossAndWithinTenants(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		a, b := storetest.InsertTenant(t, s), storetest.InsertTenant(t, s)
		ka, kb := storetest.Key(a.ID, "a-key"), storetest.Key(b.ID, "b-key")
		revoked := storetest.Key(a.ID, "a-old")
		revoked.Status = key.KeyRevoked
		for _, k := range []*key.APIKey{ka, kb, revoked} {
			if err := s.Keys().Insert(ctx, k); err != nil {
				t.Fatalf("insert: %v", err)
			}
		}
		all, err := s.Keys().List(ctx, &key.ListOptions{})
		if err != nil || len(all.Items) != 3 {
			t.Fatalf("every key = %v, %v", all, err)
		}
		active, err := s.Keys().List(ctx, &key.ListOptions{TenantID: a.ID.String(), Status: key.KeyActive})
		if err != nil || len(active.Items) != 1 || active.Items[0].ID.String() != ka.ID.String() {
			t.Fatalf("tenant A active = %v, %v", active, err)
		}
	})
}

func TestACursorFromAnotherListIsRefused(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		ctx := context.Background()
		for _, bad := range []string{"garbage", " ", id.NewTenantID().String()} {
			if _, err := s.Usage().Query(ctx, &usage.QueryOptions{Cursor: bad}); !errors.Is(err, paging.ErrInvalidCursor) {
				t.Errorf("usage cursor %q = %v, want ErrInvalidCursor", bad, err)
			}
		}
		if _, err := s.Tenants().List(ctx, &tenant.ListOptions{Cursor: id.NewUsageID().String()}); !errors.Is(err, paging.ErrInvalidCursor) {
			t.Errorf("tenant list with a usage cursor = %v, want ErrInvalidCursor", err)
		}
		if _, err := s.Keys().List(ctx, &key.ListOptions{Cursor: strings.Repeat("x", 30)}); !errors.Is(err, paging.ErrInvalidCursor) {
			t.Errorf("key list with garbage = %v, want ErrInvalidCursor", err)
		}
	})
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./store/storetest/`
Expected: FAIL to compile: `res.Items undefined (type []*usage.Record has no field or method Items)`.

- [ ] **Step 3: Change the types**

`tenant/tenant.go`, replace `ListOptions` and both `List` signatures:

```go
// ListOptions configures tenant listing. Search matches name or slug,
// anywhere, ignoring case. Lists are newest first and cursor paged.
type ListOptions struct {
	Status string `json:"status,omitempty"`
	Search string `json:"search,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	Cursor string `json:"cursor,omitempty"`
}

// ListResult is one page of tenants. NextCursor is "" on the last page.
type ListResult struct {
	Items      []*Tenant `json:"items"`
	NextCursor string    `json:"next_cursor"`
}
```

and in both interfaces `List(ctx context.Context, opts *ListOptions) (*ListResult, error)`.

`tenant/service_impl.go`:

```go
func (s *service) List(ctx context.Context, opts *ListOptions) (*ListResult, error) {
	if opts == nil {
		opts = &ListOptions{}
	}
	return s.store.List(ctx, opts)
}
```

`key/key.go`, add and extend the `Store` interface:

```go
// ListOptions configures key listing. An empty TenantID lists every
// tenant's keys. Lists are newest first and cursor paged.
type ListOptions struct {
	TenantID string `json:"tenant_id,omitempty"`
	Status   Status `json:"status,omitempty"`
	Limit    int    `json:"limit,omitempty"`
	Cursor   string `json:"cursor,omitempty"`
}

// ListResult is one page of keys. NextCursor is "" on the last page.
type ListResult struct {
	Items      []*APIKey `json:"items"`
	NextCursor string    `json:"next_cursor"`
}
```

and in `Store`: `List(ctx context.Context, opts *ListOptions) (*ListResult, error)`.

`usage/usage.go`, replace `QueryOptions` and the two `Query` signatures:

```go
// QueryOptions filters the request log. Every filter is applied by the
// store, never after reading a window, so an empty page means nothing
// matched. An empty TenantID means every tenant. EndTime is exclusive.
type QueryOptions struct {
	TenantID  string    `json:"tenant_id,omitempty"`
	KeyID     string    `json:"key_id,omitempty"`
	Provider  string    `json:"provider,omitempty"`
	Model     string    `json:"model,omitempty"`
	Outcome   Outcome   `json:"outcome,omitempty"`
	StartTime time.Time `json:"start_time,omitzero"`
	EndTime   time.Time `json:"end_time,omitzero"`
	Limit     int       `json:"limit,omitempty"`
	Cursor    string    `json:"cursor,omitempty"`
}

// QueryResult is one page of records. NextCursor is "" on the last page.
type QueryResult struct {
	Items      []*Record `json:"items"`
	NextCursor string    `json:"next_cursor"`
}
```

`Query(ctx context.Context, opts *QueryOptions) (*QueryResult, error)` in `Service` and `Store`, and the same in `usage/service_impl.go`.

- [ ] **Step 4: Memory**

`store/memory_tenant.go`, replace `List` (imports `slices`, `strings`, `id`, `paging`):

```go
func (s *memoryTenantStore) List(_ context.Context, opts *tenant.ListOptions) (*tenant.ListResult, error) {
	if opts == nil {
		opts = &tenant.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixTenant); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	term := strings.ToLower(opts.Search)
	s.mu.RLock()
	var rows []*tenant.Tenant
	for _, t := range s.data {
		switch {
		case opts.Status != "" && string(t.Status) != opts.Status:
		case term != "" && !strings.Contains(strings.ToLower(t.Name), term) && !strings.Contains(strings.ToLower(t.Slug), term):
		case opts.Cursor != "" && t.ID.String() >= opts.Cursor:
		default:
			rows = append(rows, cloneTenant(t))
		}
	}
	s.mu.RUnlock()
	slices.SortFunc(rows, func(a, b *tenant.Tenant) int { return strings.Compare(b.ID.String(), a.ID.String()) })
	if len(rows) > limit+1 {
		rows = rows[:limit+1]
	}
	page, next := paging.Trim(rows, limit, func(t *tenant.Tenant) string { return t.ID.String() })
	return &tenant.ListResult{Items: page, NextCursor: next}, nil
}
```

`store/memory_key.go`, add `List` (imports `slices`, `strings`, `id`, `paging`):

```go
func (s *memoryKeyStore) List(_ context.Context, opts *key.ListOptions) (*key.ListResult, error) {
	if opts == nil {
		opts = &key.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixKey); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	s.mu.RLock()
	var rows []*key.APIKey
	for _, k := range s.data {
		switch {
		case opts.TenantID != "" && k.TenantID.String() != opts.TenantID:
		case opts.Status != "" && k.Status != opts.Status:
		case opts.Cursor != "" && k.ID.String() >= opts.Cursor:
		default:
			rows = append(rows, cloneKey(k))
		}
	}
	s.mu.RUnlock()
	slices.SortFunc(rows, func(a, b *key.APIKey) int { return strings.Compare(b.ID.String(), a.ID.String()) })
	if len(rows) > limit+1 {
		rows = rows[:limit+1]
	}
	page, next := paging.Trim(rows, limit, func(k *key.APIKey) string { return k.ID.String() })
	return &key.ListResult{Items: page, NextCursor: next}, nil
}
```

`store/memory_usage.go`, replace `Query`:

```go
func (s *memoryUsageStore) Query(_ context.Context, opts *usage.QueryOptions) (*usage.QueryResult, error) {
	if opts == nil {
		opts = &usage.QueryOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixUsage); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	s.mu.RLock()
	var rows []*usage.Record
	for _, r := range s.records {
		switch {
		case opts.TenantID != "" && r.TenantID.String() != opts.TenantID:
		case opts.KeyID != "" && r.KeyID.String() != opts.KeyID:
		case opts.Provider != "" && r.Provider != opts.Provider:
		case opts.Model != "" && r.Model != opts.Model:
		case opts.Outcome != "" && r.Outcome != opts.Outcome:
		case !opts.StartTime.IsZero() && r.CreatedAt.Before(opts.StartTime):
		case !opts.EndTime.IsZero() && !r.CreatedAt.Before(opts.EndTime):
		case opts.Cursor != "" && r.ID.String() >= opts.Cursor:
		default:
			rows = append(rows, cloneRecord(r))
		}
	}
	s.mu.RUnlock()
	slices.SortFunc(rows, func(a, b *usage.Record) int { return strings.Compare(b.ID.String(), a.ID.String()) })
	if len(rows) > limit+1 {
		rows = rows[:limit+1]
	}
	page, next := paging.Trim(rows, limit, func(r *usage.Record) string { return r.ID.String() })
	return &usage.QueryResult{Items: page, NextCursor: next}, nil
}
```

- [ ] **Step 5: Postgres**

Replace tenant `List` and usage `Query`, and add key `List`, in `store/postgres/store.go` (imports `paging`, `id`, `conv`):

```go
func (s *tenantStore) List(ctx context.Context, opts *tenant.ListOptions) (*tenant.ListResult, error) {
	if opts == nil {
		opts = &tenant.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixTenant); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	var models []tenantModel
	q := s.pgdb.NewSelect(&models).OrderExpr(`id COLLATE "C" DESC`).Limit(limit + 1)
	if opts.Status != "" {
		q = q.Where("status = ?", opts.Status)
	}
	if opts.Search != "" {
		p := conv.LikePattern(opts.Search)
		q = q.Where("(name ILIKE ? OR slug ILIKE ?)", p, p)
	}
	if opts.Cursor != "" {
		q = q.Where(`id COLLATE "C" < ?`, opts.Cursor)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/postgres: list tenants: %w", err)
	}
	rows := make([]*tenant.Tenant, 0, len(models))
	for i := range models {
		t, err := tenantFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/postgres: convert tenant model: %w", err)
		}
		rows = append(rows, t)
	}
	page, next := paging.Trim(rows, limit, func(t *tenant.Tenant) string { return t.ID.String() })
	return &tenant.ListResult{Items: page, NextCursor: next}, nil
}

func (s *keyStore) List(ctx context.Context, opts *key.ListOptions) (*key.ListResult, error) {
	if opts == nil {
		opts = &key.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixKey); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	var models []apiKeyModel
	q := s.pgdb.NewSelect(&models).OrderExpr(`id COLLATE "C" DESC`).Limit(limit + 1)
	if opts.TenantID != "" {
		q = q.Where("tenant_id = ?", opts.TenantID)
	}
	if opts.Status != "" {
		q = q.Where("status = ?", string(opts.Status))
	}
	if opts.Cursor != "" {
		q = q.Where(`id COLLATE "C" < ?`, opts.Cursor)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/postgres: list keys: %w", err)
	}
	rows := make([]*key.APIKey, 0, len(models))
	for i := range models {
		k, err := apiKeyFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/postgres: convert key model: %w", err)
		}
		rows = append(rows, k)
	}
	page, next := paging.Trim(rows, limit, func(k *key.APIKey) string { return k.ID.String() })
	return &key.ListResult{Items: page, NextCursor: next}, nil
}

func (s *usageStore) Query(ctx context.Context, opts *usage.QueryOptions) (*usage.QueryResult, error) {
	if opts == nil {
		opts = &usage.QueryOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixUsage); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	var models []usageModel
	q := s.pgdb.NewSelect(&models).OrderExpr(`id COLLATE "C" DESC`).Limit(limit + 1)
	for col, v := range map[string]string{
		"tenant_id": opts.TenantID, "key_id": opts.KeyID, "provider": opts.Provider,
		"model": opts.Model, "outcome": string(opts.Outcome),
	} {
		if v != "" {
			q = q.Where(col+" = ?", v)
		}
	}
	if !opts.StartTime.IsZero() {
		q = q.Where("created_at >= ?", opts.StartTime.UTC())
	}
	if !opts.EndTime.IsZero() {
		q = q.Where("created_at < ?", opts.EndTime.UTC())
	}
	if opts.Cursor != "" {
		q = q.Where(`id COLLATE "C" < ?`, opts.Cursor)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/postgres: query usage: %w", err)
	}
	rows := make([]*usage.Record, 0, len(models))
	for i := range models {
		rec, err := usageFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/postgres: convert usage model: %w", err)
		}
		rows = append(rows, rec)
	}
	page, next := paging.Trim(rows, limit, func(r *usage.Record) string { return r.ID.String() })
	return &usage.QueryResult{Items: page, NextCursor: next}, nil
}
```

The map iteration order varies, but `WHERE` clauses joined by `AND` do not care.

- [ ] **Step 6: SQLite**

SQLite compares text bytewise by default, so it needs no collation. Its `LIKE` already ignores ASCII case. Usage times are `conv.TimeText`, so the window compares text. Replace tenant `List` and usage `Query`, and add key `List`, in `store/sqlite/store.go` (imports `paging`, `id`, `conv`):

```go
func (s *tenantStore) List(ctx context.Context, opts *tenant.ListOptions) (*tenant.ListResult, error) {
	if opts == nil {
		opts = &tenant.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixTenant); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	var models []tenantModel
	q := s.sdb.NewSelect(&models).OrderExpr("id DESC").Limit(limit + 1)
	if opts.Status != "" {
		q = q.Where("status = ?", opts.Status)
	}
	if opts.Search != "" {
		p := conv.LikePattern(opts.Search)
		q = q.Where(`(name LIKE ? ESCAPE '\' OR slug LIKE ? ESCAPE '\')`, p, p)
	}
	if opts.Cursor != "" {
		q = q.Where("id < ?", opts.Cursor)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/sqlite: list tenants: %w", err)
	}
	rows := make([]*tenant.Tenant, 0, len(models))
	for i := range models {
		t, err := tenantFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/sqlite: convert tenant model: %w", err)
		}
		rows = append(rows, t)
	}
	page, next := paging.Trim(rows, limit, func(t *tenant.Tenant) string { return t.ID.String() })
	return &tenant.ListResult{Items: page, NextCursor: next}, nil
}

func (s *keyStore) List(ctx context.Context, opts *key.ListOptions) (*key.ListResult, error) {
	if opts == nil {
		opts = &key.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixKey); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	var models []apiKeyModel
	q := s.sdb.NewSelect(&models).OrderExpr("id DESC").Limit(limit + 1)
	if opts.TenantID != "" {
		q = q.Where("tenant_id = ?", opts.TenantID)
	}
	if opts.Status != "" {
		q = q.Where("status = ?", string(opts.Status))
	}
	if opts.Cursor != "" {
		q = q.Where("id < ?", opts.Cursor)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/sqlite: list keys: %w", err)
	}
	rows := make([]*key.APIKey, 0, len(models))
	for i := range models {
		k, err := apiKeyFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/sqlite: convert key model: %w", err)
		}
		rows = append(rows, k)
	}
	page, next := paging.Trim(rows, limit, func(k *key.APIKey) string { return k.ID.String() })
	return &key.ListResult{Items: page, NextCursor: next}, nil
}

func (s *usageStore) Query(ctx context.Context, opts *usage.QueryOptions) (*usage.QueryResult, error) {
	if opts == nil {
		opts = &usage.QueryOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixUsage); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	var models []usageModel
	q := s.sdb.NewSelect(&models).OrderExpr("id DESC").Limit(limit + 1)
	for col, v := range map[string]string{
		"tenant_id": opts.TenantID, "key_id": opts.KeyID, "provider": opts.Provider,
		"model": opts.Model, "outcome": string(opts.Outcome),
	} {
		if v != "" {
			q = q.Where(col+" = ?", v)
		}
	}
	if !opts.StartTime.IsZero() {
		q = q.Where("created_at >= ?", conv.TimeText(opts.StartTime))
	}
	if !opts.EndTime.IsZero() {
		q = q.Where("created_at < ?", conv.TimeText(opts.EndTime))
	}
	if opts.Cursor != "" {
		q = q.Where("id < ?", opts.Cursor)
	}
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("nexus/sqlite: query usage: %w", err)
	}
	rows := make([]*usage.Record, 0, len(models))
	for i := range models {
		rec, err := usageFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/sqlite: convert usage model: %w", err)
		}
		rows = append(rows, rec)
	}
	page, next := paging.Trim(rows, limit, func(r *usage.Record) string { return r.ID.String() })
	return &usage.QueryResult{Items: page, NextCursor: next}, nil
}
```

If grove's SQLite builder rewrites the backslash in the `ESCAPE` clause, use `ESCAPE '!'` here and give `conv.LikePattern` an escape-character parameter; the search tests in Step 1 tell you which.

- [ ] **Step 7: Mongo**

The same three methods in `store/mongo/store.go` (imports `regexp`, `paging`, `id`):

```go
func (s *tenantStore) List(ctx context.Context, opts *tenant.ListOptions) (*tenant.ListResult, error) {
	if opts == nil {
		opts = &tenant.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixTenant); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	filter := bson.M{}
	if opts.Status != "" {
		filter["status"] = opts.Status
	}
	if opts.Search != "" {
		re := bson.M{"$regex": regexp.QuoteMeta(opts.Search), "$options": "i"}
		filter["$or"] = bson.A{bson.M{"name": re}, bson.M{"slug": re}}
	}
	if opts.Cursor != "" {
		filter["_id"] = bson.M{"$lt": opts.Cursor}
	}
	var models []tenantModel
	err := s.mdb.NewFind(&models).Filter(filter).Sort(bson.D{{Key: "_id", Value: -1}}).Limit(int64(limit + 1)).Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("nexus/mongo: list tenants: %w", err)
	}
	rows := make([]*tenant.Tenant, 0, len(models))
	for i := range models {
		t, err := tenantFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/mongo: convert tenant model: %w", err)
		}
		rows = append(rows, t)
	}
	page, next := paging.Trim(rows, limit, func(t *tenant.Tenant) string { return t.ID.String() })
	return &tenant.ListResult{Items: page, NextCursor: next}, nil
}
```

```go
func (s *keyStore) List(ctx context.Context, opts *key.ListOptions) (*key.ListResult, error) {
	if opts == nil {
		opts = &key.ListOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixKey); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	filter := bson.M{}
	if opts.TenantID != "" {
		filter["tenant_id"] = opts.TenantID
	}
	if opts.Status != "" {
		filter["status"] = string(opts.Status)
	}
	if opts.Cursor != "" {
		filter["_id"] = bson.M{"$lt": opts.Cursor}
	}
	var models []apiKeyModel
	err := s.mdb.NewFind(&models).Filter(filter).Sort(bson.D{{Key: "_id", Value: -1}}).Limit(int64(limit + 1)).Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("nexus/mongo: list keys: %w", err)
	}
	rows := make([]*key.APIKey, 0, len(models))
	for i := range models {
		k, err := apiKeyFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/mongo: convert key model: %w", err)
		}
		rows = append(rows, k)
	}
	page, next := paging.Trim(rows, limit, func(k *key.APIKey) string { return k.ID.String() })
	return &key.ListResult{Items: page, NextCursor: next}, nil
}

func (s *usageStore) Query(ctx context.Context, opts *usage.QueryOptions) (*usage.QueryResult, error) {
	if opts == nil {
		opts = &usage.QueryOptions{}
	}
	if err := paging.CheckCursor(opts.Cursor, id.PrefixUsage); err != nil {
		return nil, err
	}
	limit := paging.Limit(opts.Limit)
	filter := bson.M{}
	for field, v := range map[string]string{
		"tenant_id": opts.TenantID, "key_id": opts.KeyID, "provider": opts.Provider,
		"model": opts.Model, "outcome": string(opts.Outcome),
	} {
		if v != "" {
			filter[field] = v
		}
	}
	if !opts.StartTime.IsZero() || !opts.EndTime.IsZero() {
		window := bson.M{}
		if !opts.StartTime.IsZero() {
			window["$gte"] = opts.StartTime.UTC()
		}
		if !opts.EndTime.IsZero() {
			window["$lt"] = opts.EndTime.UTC()
		}
		filter["created_at"] = window
	}
	if opts.Cursor != "" {
		filter["_id"] = bson.M{"$lt": opts.Cursor}
	}
	var models []usageModel
	err := s.mdb.NewFind(&models).Filter(filter).Sort(bson.D{{Key: "_id", Value: -1}}).Limit(int64(limit + 1)).Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("nexus/mongo: query usage: %w", err)
	}
	rows := make([]*usage.Record, 0, len(models))
	for i := range models {
		rec, err := usageFromModel(&models[i])
		if err != nil {
			return nil, fmt.Errorf("nexus/mongo: convert usage model: %w", err)
		}
		rows = append(rows, rec)
	}
	page, next := paging.Trim(rows, limit, func(r *usage.Record) string { return r.ID.String() })
	return &usage.QueryResult{Items: page, NextCursor: next}, nil
}
```

- [ ] **Step 8: Callers**

`api/tenant_handler.go`, `handleListTenants`:

```go
	res, err := a.gw.Tenants().List(r.Context(), &tenant.ListOptions{
		Status: r.URL.Query().Get("status"),
		Search: r.URL.Query().Get("search"),
		Cursor: r.URL.Query().Get("cursor"),
	})
	if errors.Is(err, paging.ErrInvalidCursor) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data":        res.Items,
		"next_cursor": res.NextCursor,
	})
```

The `total` field is gone from this response; it was the page length. `MIGRATION.md` (slice 7) records it.

`dashboard/data.go`: keep the dashboard helpers' signatures and adapt inside them.

```go
func fetchTenants(ctx context.Context, gw *nexus.Gateway, opts *tenant.ListOptions) ([]*tenant.Tenant, int, error) {
	if gw == nil || gw.Tenants() == nil {
		return nil, 0, nil
	}
	res, err := gw.Tenants().List(ctx, opts)
	if err != nil {
		return nil, 0, err
	}
	return res.Items, len(res.Items), nil
}
```

Change `fetchTenantCount` and `fetchAllKeys` to read `res.Items` the same way, and `fetchUsageRecords` / `fetchRecentUsage` to call `Query` and return `res.Items` (and `len(res.Items)` where a count was returned).

- [ ] **Step 9: Run everything**

```bash
go build ./... && go test ./...
go test ./store/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: build and tests pass; every paging, filter, search and cursor test passes on all four backends.

- [ ] **Step 10: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add store/storetest/paging_test.go
git commit --only -m "feat(store)!: page every list by cursor and filter at the store

Tenants, keys and the request log are newest first by id and continue from a
cursor; a cursor from another list is refused, never read as the first page.
The totals every backend returned were page lengths, so they are gone. The
request log filters by key and outcome as well, tenants can be searched by
name or slug, and keys can be listed across tenants without a query per
tenant." -- tenant/tenant.go tenant/service_impl.go key/key.go usage/usage.go usage/service_impl.go store/memory_tenant.go store/memory_key.go store/memory_usage.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/storetest/usage.go store/storetest/paging_test.go api/tenant_handler.go dashboard/data.go
git show --stat HEAD
```

---

### Task 9: Usage over time

**Files:**
- Create: `usage/series.go`, `usage/series_test.go`
- Modify: `usage/usage.go` (`Series` on `Store` and `Service`), `usage/service_impl.go`
- Modify: `store/memory_usage.go`, `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go`
- Create: `store/storetest/series_test.go`

**Interfaces:**
- Consumes: `conv.TimeText`, `conv.ParseCost`, `conv.ParseTimeText` (Task 5); `numeric`, `usdFromBSON` (Task 5).
- Produces:
  - `usage.Bucket` with `usage.BucketHour = "hour"`, `usage.BucketDay = "day"`; `usage.ErrInvalidSeries`
  - `usage.SeriesOptions{TenantID string; Start, End time.Time; Bucket Bucket}` (`End` exclusive; at most 1000 buckets)
  - `usage.SeriesPoint{Start time.Time; Requests, Tokens int; CostUSD money.USD; Unpriced int}`
  - `func usage.BucketStart(t time.Time, b Bucket) time.Time`; `func usage.FillSeries(opts *SeriesOptions, points []SeriesPoint) ([]SeriesPoint, error)` (validates, merges points sharing a bucket, zero-fills, orders oldest first)
  - `Series(ctx context.Context, opts *SeriesOptions) ([]SeriesPoint, error)` on `usage.Store` and `usage.Service`

- [ ] **Step 1: Write the failing tests**

`usage/series_test.go`:

```go
package usage_test

import (
	"errors"
	"testing"
	"time"

	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/usage"
)

func TestFillSeriesMergesAndZeroFills(t *testing.T) {
	start := time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)
	opts := &usage.SeriesOptions{Start: start, End: start.Add(3 * time.Hour), Bucket: usage.BucketHour}
	got, err := usage.FillSeries(opts, []usage.SeriesPoint{
		{Start: start.Add(2 * time.Hour), Requests: 1, Tokens: 10, CostUSD: money.MustParse("0.1")},
		{Start: start, Requests: 1, Tokens: 5, CostUSD: money.MustParse("0.2"), Unpriced: 0},
		{Start: start, Requests: 1, Tokens: 5, Unpriced: 1},
	})
	if err != nil || len(got) != 3 {
		t.Fatalf("FillSeries = %v, %v", got, err)
	}
	if got[0].Requests != 2 || got[0].Tokens != 10 || got[0].CostUSD.String() != "0.2" || got[0].Unpriced != 1 {
		t.Fatalf("first bucket = %+v", got[0])
	}
	if !got[1].Start.Equal(start.Add(time.Hour)) || got[1].Requests != 0 || !got[1].CostUSD.IsZero() {
		t.Fatalf("empty bucket = %+v", got[1])
	}
	if got[2].CostUSD.String() != "0.1" {
		t.Fatalf("last bucket = %+v", got[2])
	}
}

func TestSeriesOptionsAreChecked(t *testing.T) {
	start := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)
	for _, o := range []*usage.SeriesOptions{
		{Start: start, End: start, Bucket: usage.BucketHour},
		{Start: start, End: start.Add(time.Hour), Bucket: "minute"},
		{Start: start, End: start.Add(1001 * time.Hour), Bucket: usage.BucketHour},
	} {
		if _, err := usage.FillSeries(o, nil); !errors.Is(err, usage.ErrInvalidSeries) {
			t.Errorf("%+v = %v, want ErrInvalidSeries", o, err)
		}
	}
	if got := usage.BucketStart(start.Add(90*time.Minute+5*time.Second), usage.BucketHour); !got.Equal(start.Add(time.Hour)) {
		t.Fatalf("BucketStart hour = %s", got)
	}
}
```

`store/storetest/series_test.go`:

```go
package storetest_test

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/store/storetest"
	"github.com/xraph/nexus/usage"
)

func TestSeriesBucketsExactlyAndFillsGaps(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		tn := storetest.InsertTenant(t, s)
		start := usage.BucketStart(time.Now().Add(-5*time.Hour), usage.BucketHour)
		for _, r := range []struct {
			at   time.Duration
			cost string
		}{{10 * time.Minute, "0.000000150"}, {50 * time.Minute, "0.000000150"}, {3*time.Hour + time.Minute, ""}} {
			rec := storetest.Record(tn.ID, r.cost)
			rec.CreatedAt = start.Add(r.at)
			storetest.InsertRecord(t, s, rec)
		}
		other := storetest.Record(storetest.InsertTenant(t, s).ID, "9")
		other.CreatedAt = start.Add(10 * time.Minute)
		storetest.InsertRecord(t, s, other)

		got, err := s.Usage().Series(context.Background(), &usage.SeriesOptions{
			TenantID: tn.ID.String(), Start: start, End: start.Add(4 * time.Hour), Bucket: usage.BucketHour,
		})
		if err != nil || len(got) != 4 {
			t.Fatalf("series = %v, %v", got, err)
		}
		if got[0].Requests != 2 || got[0].CostUSD.String() != "0.0000003" {
			t.Fatalf("first hour = %+v", got[0])
		}
		if got[1].Requests != 0 || got[2].Requests != 0 {
			t.Fatalf("gap hours = %+v, %+v", got[1], got[2])
		}
		if got[3].Requests != 1 || got[3].Unpriced != 1 || !got[3].CostUSD.IsZero() {
			t.Fatalf("fourth hour = %+v", got[3])
		}
	})
}
```

Run: `go test ./usage/ ./store/storetest/`
Expected: FAIL to compile, `undefined: usage.FillSeries`.

- [ ] **Step 2: Write `series.go` and extend the interfaces**

`usage/series.go`:

```go
package usage

import (
	"errors"
	"fmt"
	"time"

	"github.com/xraph/nexus/money"
)

// Bucket is the width of one point in a series.
type Bucket string

const (
	BucketHour Bucket = "hour"
	BucketDay  Bucket = "day"
)

// maxBuckets bounds a series so a careless range cannot ask a store for
// months of hourly points.
const maxBuckets = 1000

// ErrInvalidSeries reports a range or bucket a series cannot be built for.
var ErrInvalidSeries = errors.New("nexus: invalid series")

// SeriesOptions asks for usage between Start and End (exclusive), one point
// per bucket. An empty TenantID means every tenant.
type SeriesOptions struct {
	TenantID string    `json:"tenant_id,omitempty"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
	Bucket   Bucket    `json:"bucket"`
}

// SeriesPoint is usage within one bucket. CostUSD sums priced requests;
// Unpriced counts the requests it leaves out.
type SeriesPoint struct {
	Start    time.Time `json:"start"`
	Requests int       `json:"requests"`
	Tokens   int       `json:"tokens"`
	CostUSD  money.USD `json:"cost_usd"`
	Unpriced int       `json:"unpriced"`
}

// BucketStart truncates t, in UTC, to the start of its bucket.
func BucketStart(t time.Time, b Bucket) time.Time {
	t = t.UTC()
	if b == BucketDay {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}
	return t.Truncate(time.Hour)
}

func step(b Bucket) time.Duration {
	if b == BucketDay {
		return 24 * time.Hour
	}
	return time.Hour
}

// FillSeries merges the points a store found (possibly one per record) into
// one point per bucket from Start to End, oldest first, with empty buckets
// present as zeros.
func FillSeries(opts *SeriesOptions, points []SeriesPoint) ([]SeriesPoint, error) {
	if opts.Bucket != BucketHour && opts.Bucket != BucketDay {
		return nil, fmt.Errorf("%w: bucket %q", ErrInvalidSeries, opts.Bucket)
	}
	first, end := BucketStart(opts.Start, opts.Bucket), opts.End.UTC()
	if !end.After(first) {
		return nil, fmt.Errorf("%w: end must be after start", ErrInvalidSeries)
	}
	n := int((end.Sub(first) + step(opts.Bucket) - 1) / step(opts.Bucket))
	if n > maxBuckets {
		return nil, fmt.Errorf("%w: %d buckets, at most %d", ErrInvalidSeries, n, maxBuckets)
	}
	out := make([]SeriesPoint, n)
	for i := range out {
		out[i].Start = first.Add(time.Duration(i) * step(opts.Bucket))
	}
	for _, p := range points {
		i := int(BucketStart(p.Start, opts.Bucket).Sub(first) / step(opts.Bucket))
		if i < 0 || i >= n {
			continue
		}
		out[i].Requests += p.Requests
		out[i].Tokens += p.Tokens
		out[i].CostUSD = out[i].CostUSD.Add(p.CostUSD)
		out[i].Unpriced += p.Unpriced
	}
	return out, nil
}
```

Add `Series(ctx context.Context, opts *SeriesOptions) ([]SeriesPoint, error)` to `usage.Service` and `usage.Store`, and to `usage/service_impl.go` as a pass-through.

Run: `go test ./usage/`
Expected: PASS.

- [ ] **Step 3: The four backends**

Each backend checks options first by calling `usage.FillSeries(opts, nil)` and returning its error, then reads, then returns `usage.FillSeries(opts, points)`.

Memory (`store/memory_usage.go`):

```go
func (s *memoryUsageStore) Series(_ context.Context, opts *usage.SeriesOptions) ([]usage.SeriesPoint, error) {
	if _, err := usage.FillSeries(opts, nil); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var points []usage.SeriesPoint
	for _, r := range s.records {
		if opts.TenantID != "" && r.TenantID.String() != opts.TenantID {
			continue
		}
		if r.CreatedAt.Before(opts.Start) || !r.CreatedAt.Before(opts.End) {
			continue
		}
		points = append(points, pointOf(r))
	}
	return usage.FillSeries(opts, points)
}

func pointOf(r *usage.Record) usage.SeriesPoint {
	p := usage.SeriesPoint{Start: r.CreatedAt, Requests: 1, Tokens: r.TotalTokens}
	if r.CostUSD != nil {
		p.CostUSD = *r.CostUSD
	}
	if r.PricingStatus == usage.PricingUnpricedModel {
		p.Unpriced = 1
	}
	return p
}
```

Postgres (`date_trunc` with a time zone argument needs PostgreSQL 12 or later):

```go
func (s *usageStore) Series(ctx context.Context, opts *usage.SeriesOptions) ([]usage.SeriesPoint, error) {
	if _, err := usage.FillSeries(opts, nil); err != nil {
		return nil, err
	}
	rows, err := s.pgdb.Query(ctx,
		`SELECT date_trunc($2, created_at, 'UTC'), COUNT(*), COALESCE(SUM(total_tokens), 0)::bigint,
		        SUM(cost_usd), COUNT(*) FILTER (WHERE pricing_status = 'unpriced_model')
		   FROM nexus_usage_records
		  WHERE ($1 = '' OR tenant_id = $1) AND created_at >= $3 AND created_at < $4
		  GROUP BY 1`,
		opts.TenantID, string(opts.Bucket), opts.Start.UTC(), opts.End.UTC())
	if err != nil {
		return nil, fmt.Errorf("nexus/postgres: series: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var points []usage.SeriesPoint
	for rows.Next() {
		var p usage.SeriesPoint
		var tokens int64
		var cost numeric
		if err := rows.Scan(&p.Start, &p.Requests, &tokens, &cost, &p.Unpriced); err != nil {
			return nil, fmt.Errorf("nexus/postgres: series scan: %w", err)
		}
		p.Tokens = int(tokens)
		c, err := cost.usd()
		if err != nil {
			return nil, err
		}
		if c != nil {
			p.CostUSD = *c
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return usage.FillSeries(opts, points)
}
```

SQLite reads one row per record and lets `FillSeries` bucket them:

```go
func (s *usageStore) Series(ctx context.Context, opts *usage.SeriesOptions) ([]usage.SeriesPoint, error) {
	if _, err := usage.FillSeries(opts, nil); err != nil {
		return nil, err
	}
	rows, err := s.sdb.Query(ctx,
		`SELECT created_at, total_tokens, cost_usd, pricing_status FROM usage_records
		  WHERE (? = '' OR tenant_id = ?) AND created_at >= ? AND created_at < ?`,
		opts.TenantID, opts.TenantID, conv.TimeText(opts.Start), conv.TimeText(opts.End))
	if err != nil {
		return nil, fmt.Errorf("nexus/sqlite: series: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var points []usage.SeriesPoint
	for rows.Next() {
		var created, status string
		var cost *string
		p := usage.SeriesPoint{Requests: 1}
		if err := rows.Scan(&created, &p.Tokens, &cost, &status); err != nil {
			return nil, fmt.Errorf("nexus/sqlite: series scan: %w", err)
		}
		if p.Start, err = conv.ParseTimeText(created); err != nil {
			return nil, err
		}
		c, err := conv.ParseCost(cost)
		if err != nil {
			return nil, err
		}
		if c != nil {
			p.CostUSD = *c
		}
		if usage.PricingStatus(status) == usage.PricingUnpricedModel {
			p.Unpriced = 1
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return usage.FillSeries(opts, points)
}
```

Mongo (`$dateTrunc` needs MongoDB 5.0 or later):

```go
func (s *usageStore) Series(ctx context.Context, opts *usage.SeriesOptions) ([]usage.SeriesPoint, error) {
	if _, err := usage.FillSeries(opts, nil); err != nil {
		return nil, err
	}
	match := bson.M{"created_at": bson.M{"$gte": opts.Start.UTC(), "$lt": opts.End.UTC()}}
	if opts.TenantID != "" {
		match["tenant_id"] = opts.TenantID
	}
	cursor, err := s.mdb.Collection(colUsage).Aggregate(ctx, bson.A{
		bson.M{"$match": match},
		bson.M{"$group": bson.M{
			"_id":      bson.M{"$dateTrunc": bson.M{"date": "$created_at", "unit": string(opts.Bucket), "timezone": "UTC"}},
			"requests": bson.M{"$sum": 1},
			"tokens":   bson.M{"$sum": "$total_tokens"},
			"cost":     bson.M{"$sum": "$cost_usd"},
			"unpriced": bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$pricing_status", "unpriced_model"}}, 1, 0}}},
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("nexus/mongo: series: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()
	var points []usage.SeriesPoint
	for cursor.Next(ctx) {
		var g struct {
			Start    time.Time `bson:"_id"`
			Requests int       `bson:"requests"`
			Tokens   int       `bson:"tokens"`
			Cost     any       `bson:"cost"`
			Unpriced int       `bson:"unpriced"`
		}
		if err := cursor.Decode(&g); err != nil {
			return nil, fmt.Errorf("nexus/mongo: series decode: %w", err)
		}
		p := usage.SeriesPoint{Start: g.Start, Requests: g.Requests, Tokens: g.Tokens, Unpriced: g.Unpriced}
		c, err := usdFromBSON(g.Cost)
		if err != nil {
			return nil, err
		}
		if c != nil {
			p.CostUSD = *c
		}
		points = append(points, p)
	}
	if err := cursor.Err(); err != nil {
		return nil, err
	}
	return usage.FillSeries(opts, points)
}
```

- [ ] **Step 4: Run, lint, commit**

```bash
go build ./... && go test ./...
go test ./store/... -v -run Series 2>&1 | grep -E '^(--- |ok|FAIL)'
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add usage/series.go usage/series_test.go store/storetest/series_test.go
git commit --only -m "feat(usage): report requests, tokens and exact cost per hour or day

Series answers one point per bucket over a range, with empty buckets present
as zeros, so a chart never has to guess whether a gap means nothing happened.
Postgres and Mongo group in the database; SQLite and memory group in Go." -- usage/series.go usage/series_test.go usage/usage.go usage/service_impl.go store/memory_usage.go store/postgres/store.go store/sqlite/store.go store/mongo/store.go store/storetest/series_test.go
git show --stat HEAD
```

---

### Task 10: The gate, and what slice 2 needs to know

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md` (forge-dashboard; append a section)
- Modify: `/Users/rexraphael/.claude/projects/-Users-rexraphael-Work-xraph-forge-dashboard/memory/nexus-dashboard-migration.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a green slice on `main`, unpushed, and the notes slice 2's plan starts from.

- [ ] **Step 1: Run the full gate**

With the two test variables still exported:

```bash
go build ./... && go test -race ./...
fail=0; for d in providers/*/ grpcsrv config _examples/live _examples/realtime; do (cd "$d" && go vet ./... && go test ./...) >/dev/null 2>&1 || { echo "FAIL $d"; fail=1; }; done; echo "nested fail=$fail"
(cd _examples/grpc && go vet ./... && go build -o /dev/null ./...) && echo "grpc example ok"
for d in providers/*/ grpcsrv _examples/grpc; do (cd "$d" && GOWORK=off go vet ./... >/dev/null 2>&1) || echo "GOWORK=off FAIL $d"; done
go vet ./_examples/multi-tenant/
find . -name '*.templ' | wc -l
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git status --short
```

Expected: all green, `nested fail=0`, no `GOWORK=off FAIL` line, the `.templ` count unchanged (25; the dashboard is still here), lint 0 issues, and `git status --short` empty apart from files other sessions own. If `GOWORK=off` fails for `grpcsrv` or `_examples/grpc`, they need `GOWORK=off go mod tidy` because they replace `nexus` with the root, exactly as the PR #21 otel bump did; tidy them and commit that as its own `chore` commit.

- [ ] **Step 2: Stop the containers**

```bash
docker rm -f nexus-test-pg nexus-test-mongo
```

- [ ] **Step 3: Append what slice 1 found to the spec**

Append a section `## What slice 1 found that slice 2 must know` to the spec in forge-dashboard. It covers, in Rex's voice (invoke `rex-voice`, then `humanizer` in embedded mode; no em dashes):

- the not-found sentinels are `tenant.ErrNotFound` and `key.ErrNotFound`, not `store.ErrNotFound`, because of the import cycle;
- `money` does not implement `sql.Scanner` / `driver.Valuer` or BSON interfaces; each backend converts at its model boundary (`numeric`, `conv.CostText`, `decimalOf`), so the money package stays free of driver imports;
- the usage middleware fills `Outcome` and `PricingStatus` but still copies `CompletionResponse.Cost`, which nothing sets: slice 2 computes the cost with `model.Cost` when it moves the middleware;
- SQLite usage times are `conv.TimeText`, and Postgres orders IDs with `COLLATE "C"`;
- the `/admin/tenants` response lost its `total`, which was the page length;
- every backend difference the suite turned up, and anything Task 3 Step 7 had to fix;
- the spec asked for a price test in each provider module; the plan converted the literals by carrying their text verbatim and diffing before and after (Task 2 Step 6), so a test per module would only restate that diff. Say so, and say whether the diff passed;
- the provider token-reporting gaps from the spec still stand (cost is list price over reported tokens);
- which backends the final run covered.

Commit it on forge-dashboard `main` with `git add -f` (the docs directory is ignored) and `git commit --only -m "docs: record what nexus slice 1 found" -- docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`.

- [ ] **Step 4: Update the memory note**

Set the Nexus memory file's description and body to: slice 1 done on nexus `main` (list the commit range), unpushed; slice 2 plan next. Update its `MEMORY.md` line to match.
