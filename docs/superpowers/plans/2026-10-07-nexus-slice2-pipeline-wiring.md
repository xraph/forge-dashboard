# Nexus slice 2: pipeline and wiring, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every request that goes through a Nexus gateway produce exactly one honest usage record: attributed to its tenant, key and request, priced exactly at the provider that served it, and saying plainly what happened (served, cached, blocked by a named guard, refused, failed) and whether its cost is known.

**Architecture:** The provider call becomes the pipeline's terminal stage by construction, so the observers that wrap it (usage, tracing, retry, custom middleware) can no longer be sorted behind it and silently skipped. The usage middleware moves to the outer band, prices requests through a `model.PriceBook` keyed by provider and model, and classifies every outcome with two new pricing statuses. `Gateway.Initialize` builds the tenant, key and usage services the library always declared and never constructed.

**Tech Stack:** Go 1.26, the slice 1 `money`, `usage`, `paging` and `store/storetest` packages, grove v1.6.3, forge v1.10.0 (the extension), Docker for the Postgres 17 and Mongo 7 conformance containers.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md` (forge-dashboard repo), section "Slice 2: pipeline and wiring", and the section "What slice 1 found that slice 2 must know", which this slice must act on.

All paths are relative to `/Users/rexraphael/Work/xraph/forgery/nexus` unless they start with `docs/superpowers/`, which is the forge-dashboard repo.

## Global Constraints

- Work on `main` in both repos. No worktrees, no branches.
- Commit only your own paths: `git add <exact new files>`, then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .` or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.
- Commit messages carry no `Co-Authored-By` trailer and no Claude or Anthropic attribution, and no em dashes.
- Nothing is pushed.
- Money is `money.USD`. No `float64` holds a price, a cost, a spend or a budget.
- An unknown cost is `nil` with a `PricingStatus` that says why. It is never `$0`. A known zero (cache hit, local model, no provider called) is exactly `money.Zero` with a status that says why.
- Local inference (ollama, lmstudio) costs exactly `$0`, decided by Rex on 2026-10-07, for every model those providers serve, listed or not.
- A price is only meaningful at the provider that served the request. Never price by model ID alone.
- Every request is recorded once, after retries, including cache hits, guard blocks, refusals and failures.
- `dashboard/` keeps compiling; edit `.templ` only with `templ generate -f <file>` per edited file.
- Never `go build` without `-o /dev/null` inside `_examples/grpc`, `_examples/live` or `_examples/realtime`, and never loop `go build` over workspace modules.
- `go test ./providers/...` from the root matches nothing; loop over `providers/*/`.
- After any change to the root module's requires, `GOWORK=off go mod tidy` every module that replaces `nexus` with the root (`grpcsrv`, `_examples/grpc`, `providers/*`), as a separate `chore` commit.
- Lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- Store conformance tests run on all four backends with the containers from slice 1 on 55632 and 57632, never 5432 or 27017.

## Review Focus

1. **A request whose provider call failed after the provider started work** (non-stream timeout, or a stream that broke mid-way) must not read as free. Expect `Outcome: error` with `PricingStatus: unknown` and a nil cost, or a priced partial cost when the stream reported tokens before failing. Pinned in Task 7.
2. **The same model ID sold by two providers at different prices** must be priced at the provider that served it. Pinned in Task 2 (`PriceBook`) and Task 9 (through the gateway).
3. **A cache hit replayed from the stream cache** must record as `cached` at `$0`, not as a fresh priced request (today it records priced). Pinned in Task 6 and Task 9.
4. **An output-phase guard block** happens after the provider charged: it must record `blocked` with the guard's name and the cost of what the refused response consumed, not `$0`. Pinned in Task 5 and Task 9.
5. **A request attributed to a tenant in context and a different tenant in the request fields** must be refused, not silently recorded under either. Pinned in Task 6.

---

### Task 1: Computed amounts never exceed 18 places (slice 1 Ruling 25)

**Files:**
- Modify: `money/money.go` (`PerMillion`, the `USD` doc comment)
- Modify: `money/money_test.go`
- Modify: `store/storetest/usage_test.go`

**Interfaces:**
- Consumes: `money.USD`, `money.MaxPlaces = 18` (slice 1).
- Produces: `USD.PerMillion(n int64) USD` returns a value rounded to `MaxPlaces` decimal places, half away from zero. Every amount the library computes is now storable and readable on every backend.

- [ ] **Step 1: Write the failing tests**

Append to `money/money_test.go`:

```go
func TestPerMillionRoundsToMaxPlaces(t *testing.T) {
	cases := []struct {
		price  string
		tokens int64
		want   string
	}{
		{"0.000000000000000001", 3, "0"},                       // 3e-24 rounds to 0
		{"0.000000000000000009", 500_000, "0.000000000000000005"}, // 4.5e-18 rounds half away from zero
		{"0.000000000000000009", 400_000, "0.000000000000000004"}, // 3.6e-18
		{"0.075", 333, "0.000024975"},                           // unaffected
	}
	for _, c := range cases {
		got := money.MustParse(c.price).PerMillion(c.tokens)
		if got.String() != c.want {
			t.Errorf("%s per million × %d = %s, want %s", c.price, c.tokens, got, c.want)
		}
		if _, err := money.Parse(got.String()); err != nil {
			t.Errorf("computed %s does not parse back: %v", got, err)
		}
	}
}
```

Append to `store/storetest/usage_test.go` (add the `money` import if missing):

```go
// A cost the library computes must be readable on every backend, so a
// computed amount past 18 places cannot become a row that breaks Query.
func TestComputedCostIsReadableEverywhere(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		tn := storetest.InsertTenant(t, s)
		r := storetest.Record(tn.ID, "")
		c := money.MustParse("0.000000000000000009").PerMillion(500_000)
		r.CostUSD, r.PricingStatus = &c, usage.PricingPriced
		storetest.InsertRecord(t, s, r)
		got := storetest.FindRecord(t, s, r.ID)
		if got.CostUSD == nil || got.CostUSD.String() != "0.000000000000000005" {
			t.Fatalf("computed cost came back as %v", got.CostUSD)
		}
	})
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./money/ -run PerMillionRounds -v`
Expected: FAIL, `3e-24` prints as `0.000000000000000000000003` and does not parse back.

- [ ] **Step 3: Round in `PerMillion`**

In `money/money.go` replace `PerMillion`:

```go
// PerMillion is the cost of n units at u per million units: u × n / 10⁶,
// rounded to MaxPlaces decimal places, half away from zero. It is the one
// operation that adds decimal places, so it is where the bound is kept: an
// amount the library computes is always one every store can hold and read.
func (u USD) PerMillion(n int64) USD {
	return USD{d: u.d.Mul(decimal.NewFromInt(n)).Shift(-6).Round(MaxPlaces)}
}
```

Extend the `USD` type comment's precision paragraph with one sentence: `Computed amounts are rounded to MaxPlaces in PerMillion, the only operation that adds places.`

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./money/ -v
NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable" NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test" go test ./store/storetest/ -run ComputedCost -v
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git commit --only -m "fix(money): round computed amounts to 18 places

PerMillion is the one operation that adds decimal places, so a price with
more than twelve places times a token count could produce a cost no store
can read back. It now rounds to MaxPlaces, half away from zero." -- money/money.go money/money_test.go store/storetest/usage_test.go
git show --stat HEAD
```

Expected: all green; the conformance test ran on memory, sqlite, postgres and mongo.

---

### Task 2: Free local models, and prices looked up by provider and model

**Files:**
- Modify: `provider/model.go` (`Pricing.Free`, the `FreeOfCharge` interface)
- Modify: `model/cost.go`, `model/cost_test.go`
- Create: `model/pricebook.go`, `model/pricebook_test.go`
- Modify: `providers/ollama/models.go`, `providers/ollama/provider.go`
- Modify: `providers/lmstudio/models.go`, `providers/lmstudio/provider.go`
- Modify: `providertest/conformance.go`

**Interfaces:**
- Consumes: `model.Cost` (slice 1), `provider.Registry` (`Get(name) (Provider, bool)`).
- Produces:
  - `provider.Pricing.Free bool` (`json:"free,omitempty"`): the model costs exactly $0.
  - `provider.FreeOfCharge` interface `{ FreeOfCharge() bool }`: a provider whose every model, listed or not, costs exactly $0.
  - `model.Cost` returns `&money.Zero, usage.PricingPriced` when `Pricing.Free`.
  - `type model.PriceBook`; `func model.NewPriceBook(providers provider.Registry) *PriceBook`; `func (b *PriceBook) Price(ctx context.Context, providerName string, modelIDs ...string) (provider.Pricing, bool)`.

- [ ] **Step 1: Write the failing tests**

Append to `model/cost_test.go`:

```go
func TestFreeModelsCostExactlyZero(t *testing.T) {
	for _, embedding := range []bool{false, true} {
		cost, status := model.Cost(provider.Usage{PromptTokens: 5000, CompletionTokens: 7000}, provider.Pricing{Free: true}, embedding)
		if status != usage.PricingPriced || cost == nil || !cost.IsZero() {
			t.Fatalf("embedding=%v: cost %v, status %s; want exactly 0, priced", embedding, cost, status)
		}
	}
}
```

`model/pricebook_test.go`:

```go
package model_test

import (
	"context"
	"testing"

	"github.com/xraph/nexus/model"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/provider"
)

type listedProvider struct {
	name   string
	models []provider.Model
	free   bool
	calls  int
}

func (p *listedProvider) Name() string                        { return p.name }
func (p *listedProvider) Capabilities() provider.Capabilities { return provider.Capabilities{Chat: true} }
func (p *listedProvider) Models(context.Context) ([]provider.Model, error) {
	p.calls++
	return p.models, nil
}
func (p *listedProvider) Complete(context.Context, *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	return nil, nil //nolint:nilnil // unused
}
func (p *listedProvider) CompleteStream(context.Context, *provider.CompletionRequest) (provider.Stream, error) {
	return nil, nil //nolint:nilnil // unused
}
func (p *listedProvider) Embed(context.Context, *provider.EmbeddingRequest) (*provider.EmbeddingResponse, error) {
	return nil, nil //nolint:nilnil // unused
}
func (p *listedProvider) Healthy(context.Context) bool { return true }

type freeProvider struct{ listedProvider }

func (*freeProvider) FreeOfCharge() bool { return true }

func TestPriceBookPricesAtTheProviderThatServed(t *testing.T) {
	reg := provider.NewRegistry()
	openai := &listedProvider{name: "openai", models: []provider.Model{{ID: "gpt-4o", Pricing: provider.Pricing{InputPerMillion: money.MustParse("2.50"), OutputPerMillion: money.MustParse("10")}}}}
	router := &listedProvider{name: "openrouter", models: []provider.Model{{ID: "gpt-4o", Pricing: provider.Pricing{InputPerMillion: money.MustParse("3"), OutputPerMillion: money.MustParse("12")}}}}
	local := &freeProvider{listedProvider{name: "ollama"}}
	reg.Register(openai)
	reg.Register(router)
	reg.Register(local)
	book := model.NewPriceBook(reg)
	ctx := context.Background()

	if p, ok := book.Price(ctx, "openrouter", "gpt-4o"); !ok || p.InputPerMillion.String() != "3" {
		t.Fatalf("openrouter gpt-4o = %+v, %v", p, ok)
	}
	if p, ok := book.Price(ctx, "openai", "gpt-4o"); !ok || p.InputPerMillion.String() != "2.5" {
		t.Fatalf("openai gpt-4o = %+v, %v", p, ok)
	}
	// The first listed ID wins; a dated response model falls back to the
	// requested one.
	if p, ok := book.Price(ctx, "openai", "gpt-4o-2024-08-06", "gpt-4o"); !ok || p.OutputPerMillion.String() != "10" {
		t.Fatalf("fallback ID = %+v, %v", p, ok)
	}
	if _, ok := book.Price(ctx, "openai", "o9"); ok {
		t.Fatalf("a model the provider does not list must not be priced")
	}
	if _, ok := book.Price(ctx, "nobody", "gpt-4o"); ok {
		t.Fatalf("an unknown provider must not be priced")
	}
	if p, ok := book.Price(ctx, "ollama", "llama3:70b"); !ok || !p.Free {
		t.Fatalf("a free-of-charge provider prices any model at $0, got %+v, %v", p, ok)
	}
	book.Price(ctx, "openai", "gpt-4o")
	if openai.calls != 1 {
		t.Fatalf("Models called %d times; the price list should be read once", openai.calls)
	}
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./model/`
Expected: FAIL to compile, `unknown field Free` and `undefined: model.NewPriceBook`.

- [ ] **Step 3: Add `Free` and `FreeOfCharge`**

In `provider/model.go`, replace the `Pricing` comment and type:

```go
// Pricing is a model's list price per million tokens. When Free is set the
// model costs exactly $0. Otherwise a model with both InputPerMillion and
// OutputPerMillion at zero is unpriced (its cost is unknown, never $0); when
// only one of them is set, the other kind of token is charged at $0.
// Embeddings use EmbeddingPerMillion.
type Pricing struct {
	InputPerMillion     money.USD `json:"input_per_million"`
	OutputPerMillion    money.USD `json:"output_per_million"`
	EmbeddingPerMillion money.USD `json:"embedding_per_million,omitzero"`
	Free                bool      `json:"free,omitempty"`
}

// FreeOfCharge is implemented by a provider whose every model, listed or
// not, costs exactly $0, such as local inference.
type FreeOfCharge interface {
	FreeOfCharge() bool
}
```

In `model/cost.go`, at the top of `Cost`:

```go
	if p.Free {
		zero := money.Zero
		return &zero, usage.PricingPriced
	}
```

and add one sentence to its doc comment: `A Free price list costs exactly $0.`

- [ ] **Step 4: Write `PriceBook`**

`model/pricebook.go`:

```go
package model

import (
	"context"
	"sync"

	"github.com/xraph/nexus/provider"
)

// PriceBook looks up list prices by provider and model. The same model ID
// can be sold by several providers at different prices (gpt-4o through
// openai, azureopenai and openrouter), so a price is only meaningful at the
// provider that served the request. Each provider's price list is read once
// and kept.
type PriceBook struct {
	providers provider.Registry

	mu    sync.RWMutex
	lists map[string]map[string]provider.Pricing
}

// NewPriceBook creates a price book over the given providers.
func NewPriceBook(providers provider.Registry) *PriceBook {
	return &PriceBook{providers: providers, lists: make(map[string]map[string]provider.Pricing)}
}

// Price returns the list price at providerName of the first of modelIDs the
// provider lists. A provider that implements provider.FreeOfCharge prices
// every model at exactly $0. ok is false when the provider is unknown, its
// list cannot be read, or it lists none of the models.
func (b *PriceBook) Price(ctx context.Context, providerName string, modelIDs ...string) (provider.Pricing, bool) {
	p, ok := b.providers.Get(providerName)
	if !ok {
		return provider.Pricing{}, false
	}
	if f, ok := p.(provider.FreeOfCharge); ok && f.FreeOfCharge() {
		return provider.Pricing{Free: true}, true
	}
	list, ok := b.list(ctx, p)
	if !ok {
		return provider.Pricing{}, false
	}
	for _, id := range modelIDs {
		if id == "" {
			continue
		}
		if price, ok := list[id]; ok {
			return price, true
		}
	}
	return provider.Pricing{}, false
}

func (b *PriceBook) list(ctx context.Context, p provider.Provider) (map[string]provider.Pricing, bool) {
	b.mu.RLock()
	list, ok := b.lists[p.Name()]
	b.mu.RUnlock()
	if ok {
		return list, true
	}
	models, err := p.Models(ctx)
	if err != nil {
		return nil, false
	}
	list = make(map[string]provider.Pricing, len(models))
	for _, m := range models {
		list[m.ID] = m.Pricing
	}
	b.mu.Lock()
	b.lists[p.Name()] = list
	b.mu.Unlock()
	return list, true
}
```

- [ ] **Step 5: Make the local providers free**

In `providers/ollama/models.go` and `providers/lmstudio/models.go`, replace every `Pricing: provider.Pricing{InputPerMillion: money.MustParse("0.00001"), OutputPerMillion: money.MustParse("0.00001")}` and every `Pricing: provider.Pricing{EmbeddingPerMillion: money.MustParse("0.00001")}` with `Pricing: provider.Pricing{Free: true}`, then run `goimports -w` on both files so the unused `money` import goes.

Add to `providers/ollama/provider.go` and `providers/lmstudio/provider.go`:

```go
// FreeOfCharge reports that local inference costs nothing per token, for
// every model the server runs, listed or not.
func (p *Provider) FreeOfCharge() bool { return true }
```

In `providertest/conformance.go`, the pricing check accepts a free model:

```go
			hasChatPricing := m.Pricing.InputPerMillion.IsPositive() || m.Pricing.OutputPerMillion.IsPositive()
			hasEmbedPricing := m.Pricing.EmbeddingPerMillion.IsPositive()
			if !hasChatPricing && !hasEmbedPricing && !m.Pricing.Free {
				t.Errorf("model %q must have pricing set", m.ID)
			}
```

Run: `grep -rn '0.00001' providers/ollama providers/lmstudio` and expect no output.

- [ ] **Step 6: Run, lint, commit**

```bash
go test ./model/ ./provider/ ./providertest/ -v
for d in providers/*/; do (cd "$d" && go vet ./... && go test ./...) >/dev/null 2>&1 || echo "FAIL $d"; done
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add model/pricebook.go model/pricebook_test.go
git commit --only -m "feat(model): price at the provider that served, and make local models free

The same model ID is sold by several providers at different prices, so
PriceBook looks a price up by provider and model. Ollama and LM Studio
priced their models at a 0.00001 placeholder; local inference now costs
exactly \$0, for listed models through Pricing.Free and for any other model
the server runs through FreeOfCharge." -- provider/model.go model/cost.go model/cost_test.go model/pricebook.go model/pricebook_test.go providers/ollama/models.go providers/ollama/provider.go providers/lmstudio/models.go providers/lmstudio/provider.go providertest/conformance.go
git show --stat HEAD
```

Expected: no `FAIL` line.

---

### Task 3: Two more pricing statuses: not charged, and unknown

**Files:**
- Modify: `usage/pricing.go`, `usage/service_impl.go`, `usage/summary.go`
- Modify: `usage/service_test.go`, `usage/summary_test.go`
- Modify: `store/postgres/models.go`, `store/sqlite/models.go`, `store/mongo/models.go`
- Modify: `store/storetest/usage_test.go`

**Interfaces:**
- Consumes: `usage.PricingStatus`, `normalise`, `BuildSummary`, the store read rules (slice 1).
- Produces:
  - `usage.PricingNotCharged = "not_charged"`: no provider was called (refused, blocked before the call, failed before reaching one); cost exactly $0.
  - `usage.PricingUnknown = "unknown"`: a provider was called but the request failed, so whether and what it charged is unknown; cost nil.
  - `func (s PricingStatus) CostUnknown() bool`: true for `unpriced_model` and `unknown`.
  - `Summary.UnpricedRequests` counts every status whose cost is unknown.

- [ ] **Step 1: Write the failing tests**

Add rows to the `cases` table in `TestNormaliseEnforcesTheRecordInvariant` (`usage/service_test.go`):

```go
		{"not charged, no cost", usage.Record{PricingStatus: usage.PricingNotCharged, Outcome: usage.OutcomeBlocked}, false, cost("0"), usage.PricingNotCharged, usage.OutcomeBlocked},
		{"not charged with a cost", usage.Record{PricingStatus: usage.PricingNotCharged, CostUSD: cost("0.10")}, true, nil, "", ""},
		{"unknown, no cost", usage.Record{PricingStatus: usage.PricingUnknown, Outcome: usage.OutcomeError}, false, nil, usage.PricingUnknown, usage.OutcomeError},
		{"unknown with a cost", usage.Record{PricingStatus: usage.PricingUnknown, CostUSD: cost("0.10")}, true, nil, "", ""},
```

Append to `usage/summary_test.go`:

```go
func TestUnknownCostsAreCountedNotPriced(t *testing.T) {
	s := usage.BuildSummary("", "day", []usage.SummaryRow{
		{Provider: "openai", Model: "gpt-4o", Outcome: usage.OutcomeError, PricingStatus: usage.PricingUnknown, Requests: 2},
		{Provider: "openai", Model: "gpt-4o", Outcome: usage.OutcomeBlocked, PricingStatus: usage.PricingNotCharged, Requests: 3},
		{Provider: "openai", Model: "gpt-4o", Outcome: usage.OutcomeOK, PricingStatus: usage.PricingPriced, Requests: 1, Cost: money.MustParse("0.5")},
	})
	if s.UnpricedRequests != 2 || s.TotalCostUSD.String() != "0.5" || s.ByModel["gpt-4o"].Unpriced != 2 {
		t.Fatalf("unpriced %d, total %s, model unpriced %d", s.UnpricedRequests, s.TotalCostUSD, s.ByModel["gpt-4o"].Unpriced)
	}
}
```

Append to `store/storetest/usage_test.go`:

```go
func TestUnknownAndNotChargedRoundTrip(t *testing.T) {
	storetest.Each(t, func(t *testing.T, s store.Store) {
		tn := storetest.InsertTenant(t, s)
		unknown := storetest.Record(tn.ID, "")
		unknown.PricingStatus, unknown.Outcome, unknown.StatusCode = usage.PricingUnknown, usage.OutcomeError, 500
		notCharged := storetest.Record(tn.ID, "0")
		notCharged.PricingStatus, notCharged.Outcome, notCharged.BlockedBy = usage.PricingNotCharged, usage.OutcomeBlocked, "pii"
		storetest.InsertRecord(t, s, unknown)
		storetest.InsertRecord(t, s, notCharged)
		storetest.SameRecord(t, storetest.FindRecord(t, s, unknown.ID), unknown)
		storetest.SameRecord(t, storetest.FindRecord(t, s, notCharged.ID), notCharged)
		sum, err := s.Usage().Summary(context.Background(), tn.ID.String(), "day")
		if err != nil || sum.UnpricedRequests != 1 || !sum.TotalCostUSD.IsZero() {
			t.Fatalf("summary = %+v, %v", sum, err)
		}
	})
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `go test ./usage/`
Expected: FAIL to compile, `undefined: usage.PricingNotCharged`.

- [ ] **Step 3: Add the statuses**

Append to the `const` block in `usage/pricing.go`:

```go
	// PricingNotCharged: no provider was called (the request was refused,
	// blocked before the call, or failed before reaching one), so the cost
	// is exactly $0.
	PricingNotCharged PricingStatus = "not_charged"
	// PricingUnknown: a provider was called but the request failed, so
	// whether and what it charged is unknown. The cost is nil, never $0.
	PricingUnknown PricingStatus = "unknown"
)

// CostUnknown reports whether a record with this status has no known cost.
func (s PricingStatus) CostUnknown() bool {
	return s == PricingUnpricedModel || s == PricingUnknown
}
```

(The existing closing `)` of the const block moves below the two new constants.)

- [ ] **Step 4: Teach `normalise`, `BuildSummary` and the stores**

In `usage/service_impl.go`, replace the `switch` in `normalise` and update its doc comment's bullet list to match:

```go
	switch {
	case r.Cached:
		zero := money.Zero
		r.CostUSD, r.PricingStatus = &zero, PricingCached
	case r.PricingStatus == PricingNotCharged:
		if r.CostUSD != nil && !r.CostUSD.IsZero() {
			return nil, errors.New("usage: record is not_charged but carries a non-zero cost")
		}
		zero := money.Zero
		r.CostUSD = &zero
	case r.PricingStatus.CostUnknown() && r.CostUSD != nil:
		return nil, fmt.Errorf("usage: record has a cost but its pricing status is %s", r.PricingStatus)
	case r.CostUSD == nil && r.PricingStatus != PricingUnknown:
		r.PricingStatus = PricingUnpricedModel
	case r.PricingStatus == "":
		r.PricingStatus = PricingPriced
	}
```

(add `"fmt"` to its imports).

In `usage/summary.go`, change `if r.PricingStatus == PricingUnpricedModel {` to `if r.PricingStatus.CostUnknown() {`.

In `store/postgres/models.go` and `store/sqlite/models.go`, change `if m.PricingStatus == string(usage.PricingUnpricedModel) {` to `if usage.PricingStatus(m.PricingStatus).CostUnknown() {`. In `store/mongo/models.go`, change `case status == usage.PricingUnpricedModel:` to `case status.CostUnknown():`.

- [ ] **Step 5: Run, lint, commit**

```bash
go test ./usage/ -v
NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable" NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test" go test ./store/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git commit --only -m "feat(usage): say when no provider was called, and when a failed call's cost is unknown

not_charged is exactly \$0 because no provider was called. unknown means a
provider was called and the request failed, so the cost is nil and the
summary counts it with the unpriced requests instead of as free." -- usage/pricing.go usage/service_impl.go usage/summary.go usage/service_test.go usage/summary_test.go store/postgres/models.go store/sqlite/models.go store/mongo/models.go store/storetest/usage_test.go
git show --stat HEAD
```

---

### Task 4: The provider call is the terminal stage by construction

**Files:**
- Modify: `pipeline/middleware.go` (`Terminal`, `Stage`, `Inspector`, errors)
- Modify: `pipeline/builder.go`
- Create: `pipeline/builder_test.go`
- Modify: `pipeline/middlewares/provider_call.go` (`Terminal()`)
- Modify: `nexus.go` (`buildDefaultPipeline` returns an error; `Initialize` propagates it)

**Interfaces:**
- Produces:
  - `type pipeline.Terminal interface { Terminal() }`
  - `type pipeline.Stage struct { Name string; Priority int; Terminal bool }` (JSON `name`, `priority`, `terminal`)
  - `type pipeline.Inspector interface { Stages() []Stage }`
  - `pipeline.ErrNoTerminal`, `pipeline.ErrManyTerminals`
  - `func (b *Builder) Build() (Service, error)`: sorts non-terminal middleware by priority (stable), appends the one terminal last; errors on none or more than one. The built service implements `Inspector`.
  - `(*middlewares.ProviderCallMiddleware).Terminal()`

- [ ] **Step 1: Write the failing test**

`pipeline/builder_test.go`:

```go
package pipeline_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/provider"
)

type stage struct {
	name     string
	priority int
	log      *[]string
}

func (s stage) Name() string  { return s.name }
func (s stage) Priority() int { return s.priority }
func (s stage) Process(ctx context.Context, _ *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	*s.log = append(*s.log, s.name)
	return next(ctx)
}

type terminal struct{ stage }

func (terminal) Terminal() {}
func (t terminal) Process(_ context.Context, _ *pipeline.Request, _ pipeline.NextFunc) (*pipeline.Response, error) {
	*t.log = append(*t.log, t.name)
	return &pipeline.Response{Completion: &provider.CompletionResponse{}}, nil
}

func TestTheTerminalRunsLastWhateverItsPriority(t *testing.T) {
	var log []string
	svc, err := pipeline.NewBuilder().Use(
		terminal{stage{"call", 350, &log}},
		stage{"usage", 550, &log},
		stage{"custom", 400, &log},
		stage{"timeout", 20, &log},
		stage{"also-20", 20, &log},
	).Build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if _, err := svc.Execute(context.Background(), &provider.CompletionRequest{}); err != nil {
		t.Fatalf("execute: %v", err)
	}
	want := []string{"timeout", "also-20", "custom", "usage", "call"}
	if !slices.Equal(log, want) {
		t.Fatalf("ran %v, want %v", log, want)
	}
	stages := svc.(pipeline.Inspector).Stages()
	if len(stages) != 5 || stages[4] != (pipeline.Stage{Name: "call", Priority: 350, Terminal: true}) || stages[0].Terminal {
		t.Fatalf("stages = %+v", stages)
	}
}

func TestAPipelineNeedsExactlyOneTerminal(t *testing.T) {
	var log []string
	if _, err := pipeline.NewBuilder().Use(stage{"a", 1, &log}).Build(); !errors.Is(err, pipeline.ErrNoTerminal) {
		t.Fatalf("no terminal = %v", err)
	}
	two := pipeline.NewBuilder().Use(terminal{stage{"x", 1, &log}}, terminal{stage{"y", 2, &log}})
	if _, err := two.Build(); !errors.Is(err, pipeline.ErrManyTerminals) {
		t.Fatalf("two terminals = %v", err)
	}
}
```

Run: `go test ./pipeline/`
Expected: FAIL to compile, `undefined: pipeline.Inspector` and `assignment mismatch` on `Build()`.

- [ ] **Step 2: Add the types**

Append to `pipeline/middleware.go` (add `"errors"` to its imports), and replace the priority bands comment in `Middleware` with one that matches the new order:

```go
// Terminal marks the middleware that ends the chain by calling a provider.
// A pipeline has exactly one, and it always runs last whatever its
// priority, so a stage that wraps the call (usage, tracing, retry, custom
// middleware) can never be sorted behind it and silently skipped.
type Terminal interface {
	Terminal()
}

// Stage describes one stage of a built pipeline.
type Stage struct {
	Name     string `json:"name"`
	Priority int    `json:"priority"`
	Terminal bool   `json:"terminal"`
}

// Inspector is implemented by a pipeline that can list its stages in the
// order they run.
type Inspector interface {
	Stages() []Stage
}

var (
	// ErrNoTerminal reports a pipeline with nothing that calls a provider.
	ErrNoTerminal = errors.New("nexus: pipeline has no terminal stage")
	// ErrManyTerminals reports a pipeline with more than one terminal stage.
	ErrManyTerminals = errors.New("nexus: pipeline has more than one terminal stage")
)
```

New priority comment for `Priority()`:

```go
	// Priority returns execution order among non-terminal middleware
	// (lower = earlier = further out). The terminal always runs last.
	// Built-in bands:
	//   0-19:    request id, tracing, usage (they wrap everything)
	//   20-99:   timeout, identity, access, quota, stream lifecycle
	//   100-199: guardrails
	//   200-299: transform, alias, cache
	//   300-399: retry; custom middleware here runs once per attempt
```

- [ ] **Step 3: Build with the terminal last**

Replace `Build` and add `Stages` in `pipeline/builder.go`:

```go
// Build creates a pipeline Service. Non-terminal middleware runs in
// priority order (lower = earlier, ties keep the order they were added);
// the one Terminal runs last.
func (b *Builder) Build() (Service, error) {
	var rest []Middleware
	var term Middleware
	for _, m := range b.middlewares {
		if _, ok := m.(Terminal); ok {
			if term != nil {
				return nil, ErrManyTerminals
			}
			term = m
			continue
		}
		rest = append(rest, m)
	}
	if term == nil {
		return nil, ErrNoTerminal
	}
	sort.SliceStable(rest, func(i, j int) bool { return rest[i].Priority() < rest[j].Priority() })
	return &pipelineImpl{middlewares: append(rest, term)}, nil
}

// Stages lists the stages in the order they run.
func (p *pipelineImpl) Stages() []Stage {
	out := make([]Stage, len(p.middlewares))
	for i, m := range p.middlewares {
		_, term := m.(Terminal)
		out[i] = Stage{Name: m.Name(), Priority: m.Priority(), Terminal: term}
	}
	return out
}
```

In `pipeline/middlewares/provider_call.go`, below `Priority()`:

```go
// Terminal marks the provider call as the end of the chain.
func (m *ProviderCallMiddleware) Terminal() {}
```

and change its type comment's "It sits at priority 350" sentence to: `It is the pipeline's terminal stage and always runs last.`

- [ ] **Step 4: Propagate the error**

In `nexus.go`, change `buildDefaultPipeline` to return `(pipeline.Service, error)` and end with `return b.Build()`, and in `Initialize`:

```go
	if gw.pipeline == nil {
		p, err := gw.buildDefaultPipeline()
		if err != nil {
			return err
		}
		gw.pipeline = p
	}
```

Run: `grep -rn 'NewBuilder()' --include='*.go' . | grep -v '_test.go'` and expect only `nexus.go`. Update any test that calls `Build()` to take two results.

- [ ] **Step 5: Run, lint, commit**

```bash
go test ./pipeline/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add pipeline/builder_test.go
git commit --only -m "fix(pipeline)!: run the provider call last by construction

The builder sorted the provider call into the middle of the chain at
priority 350, and the call never calls next, so every stage above it
(usage at 550, headers, stream lifecycle, any custom middleware) was
registered and never ran. The call is now a Terminal the builder always
places last, a pipeline with none or two is an error, and a built pipeline
can list its stages." -- pipeline/middleware.go pipeline/builder.go pipeline/builder_test.go pipeline/middlewares/provider_call.go nexus.go
git show --stat HEAD
```

---

### Task 5: A guard block names the guard

**Files:**
- Create: `guard/errors.go`, `guard/errors_test.go`
- Modify: `guard/guard.go` (`CheckResult.Guard`; `Check` and `CheckPhase` set it)
- Modify: `pipeline/middlewares/guardrail.go`
- Create: `pipeline/middlewares/guardrail_test.go`

**Interfaces:**
- Produces:
  - `guard.CheckResult.Guard string`: the name of the guard that blocked.
  - `type guard.BlockedError struct { Guard string; Phase Phase; Reason string; Usage *provider.Usage; Model, Provider string }` with `Error() string`. `Usage`, `Model` and `Provider` are set only for an output block (the provider already answered and charged).
  - The guardrail middleware returns `*guard.BlockedError` for input and output blocks.

- [ ] **Step 1: Write the failing tests**

`guard/errors_test.go`:

```go
package guard_test

import (
	"context"
	"testing"

	"github.com/xraph/nexus/guard"
	"github.com/xraph/nexus/provider"
)

type blocker struct{ name string }

func (b blocker) Name() string       { return b.name }
func (b blocker) Phase() guard.Phase { return guard.PhaseInput }
func (b blocker) Check(context.Context, *guard.CheckInput) (*guard.CheckResult, error) {
	return &guard.CheckResult{Blocked: true, Action: guard.ActionBlock, Reason: "nope"}, nil
}

func TestABlockNamesItsGuard(t *testing.T) {
	svc := guard.NewService()
	svc.Register(blocker{"pii"})
	r, err := svc.CheckPhase(context.Background(), guard.PhaseInput, &guard.CheckInput{Messages: []provider.Message{{Role: "user", Content: "x"}}})
	if err != nil || !r.Blocked || r.Guard != "pii" {
		t.Fatalf("result %+v, %v", r, err)
	}
	r, err = svc.Check(context.Background(), &guard.CheckInput{})
	if err != nil || r.Guard != "pii" {
		t.Fatalf("Check result %+v, %v", r, err)
	}
	e := &guard.BlockedError{Guard: "pii", Phase: guard.PhaseInput, Reason: "nope"}
	if e.Error() != "nexus: blocked by guard pii: nope" {
		t.Fatalf("Error() = %q", e.Error())
	}
}
```

`pipeline/middlewares/guardrail_test.go`:

```go
package middlewares_test

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/nexus/guard"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
	"github.com/xraph/nexus/provider"
)

type phaseBlocker struct {
	name  string
	phase guard.Phase
}

func (b phaseBlocker) Name() string       { return b.name }
func (b phaseBlocker) Phase() guard.Phase { return b.phase }
func (b phaseBlocker) Check(context.Context, *guard.CheckInput) (*guard.CheckResult, error) {
	return &guard.CheckResult{Blocked: true, Action: guard.ActionBlock, Reason: "refused"}, nil
}

func TestGuardrailReturnsABlockedError(t *testing.T) {
	answer := &provider.CompletionResponse{
		Provider: "openai", Model: "gpt-4o",
		Choices: []provider.Choice{{Message: provider.Message{Role: "assistant", Content: "secret"}}},
		Usage:   provider.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	}
	for _, phase := range []guard.Phase{guard.PhaseInput, guard.PhaseOutput} {
		svc := guard.NewService()
		svc.Register(phaseBlocker{"leak-check", phase})
		mw := middlewares.NewGuardrail(svc)
		req := &pipeline.Request{Completion: &provider.CompletionRequest{Messages: []provider.Message{{Role: "user", Content: "hi"}}}, State: map[string]any{}}
		_, err := mw.Process(context.Background(), req, func(context.Context) (*pipeline.Response, error) {
			return &pipeline.Response{Completion: answer}, nil
		})
		var blocked *guard.BlockedError
		if !errors.As(err, &blocked) || blocked.Guard != "leak-check" || blocked.Phase != phase {
			t.Fatalf("%s: err = %v", phase, err)
		}
		if phase == guard.PhaseOutput && (blocked.Usage == nil || blocked.Usage.TotalTokens != 15 || blocked.Model != "gpt-4o" || blocked.Provider != "openai") {
			t.Fatalf("output block must carry what the refused response consumed: %+v", blocked)
		}
		if phase == guard.PhaseInput && blocked.Usage != nil {
			t.Fatalf("an input block has no usage: %+v", blocked)
		}
	}
}
```

Run: `go test ./guard/ ./pipeline/middlewares/ -run 'Block' -v`
Expected: FAIL to compile, `r.Guard undefined` and `undefined: guard.BlockedError`.

- [ ] **Step 2: Name the guard and add the error**

In `guard/guard.go`, add the field to `CheckResult`:

```go
	Guard    string             // name of the guard that blocked (set by Service when Blocked)
```

and in both `Check` and `CheckPhase`, replace `if r.Blocked { return r, nil }` with:

```go
		if r.Blocked {
			blocked := *r
			blocked.Guard = g.Name()
			return &blocked, nil
		}
```

`guard/errors.go`:

```go
package guard

import "github.com/xraph/nexus/provider"

// BlockedError reports that a guard refused a request. Guard names the guard
// that blocked it. An output-phase block happens after the provider answered
// and charged for it, so Usage, Model and Provider carry what the refused
// response consumed; they are empty for an input block.
type BlockedError struct {
	Guard    string
	Phase    Phase
	Reason   string
	Usage    *provider.Usage
	Model    string
	Provider string
}

func (e *BlockedError) Error() string {
	return "nexus: blocked by guard " + e.Guard + ": " + e.Reason
}
```

- [ ] **Step 3: Return it from the guardrail**

In `pipeline/middlewares/guardrail.go`, remove the `errors` import, and replace the input block return with:

```go
	if result.Blocked {
		return nil, &guard.BlockedError{Guard: result.Guard, Phase: guard.PhaseInput, Reason: result.Reason}
	}
```

and the output block return with:

```go
		if outputResult.Blocked {
			u := resp.Completion.Usage
			return nil, &guard.BlockedError{
				Guard: outputResult.Guard, Phase: guard.PhaseOutput, Reason: outputResult.Reason,
				Usage: &u, Model: resp.Completion.Model, Provider: resp.Completion.Provider,
			}
		}
```

Run: `grep -rn '"nexus: output blocked\|nexus: " + result.Reason' --include='*.go' .` and expect nothing; update any test that matched the old error text to use `errors.As`.

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./guard/... ./pipeline/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add guard/errors.go guard/errors_test.go pipeline/middlewares/guardrail_test.go
git commit --only -m "feat(guard): name the guard that blocked a request

A block was an error string, so nothing downstream could say which guard
refused the request. It is now a BlockedError naming the guard and phase,
and an output block carries the usage of the response it refused, because
the provider already charged for it." -- guard/guard.go guard/errors.go guard/errors_test.go pipeline/middlewares/guardrail.go pipeline/middlewares/guardrail_test.go
git show --stat HEAD
```

---

### Task 6: Request ids, identity, provider attribution and tenant-isolated cache

**Files:**
- Create: `pipeline/state.go`
- Create: `pipeline/middlewares/request_id.go`, `pipeline/middlewares/identity.go`
- Create: `pipeline/middlewares/identity_test.go`
- Modify: `pipeline/middlewares/provider_call.go` (attribution before the call; the embeddings capability name)
- Create: `pipeline/middlewares/provider_call_test.go`
- Modify: `provider/request.go` (`EmbeddingRequest.KeyID`)
- Modify: `cache/key.go`, `pipeline/middlewares/cache.go`
- Create: `cache/key_test.go` (or extend an existing one)
- Modify: `pipeline/middlewares/cache_stream_test.go`

**Interfaces:**
- Produces:
  - `pipeline.StateProviderName = "provider_name"` and `pipeline.StateCacheHit = "cache_hit"`: shared `Request.State` keys.
  - `middlewares.NewRequestID() *RequestIDMiddleware` (priority 5): sets a `req_…` id in context when absent.
  - `middlewares.NewIdentity() *IdentityMiddleware` (priority 30); `middlewares.ErrInvalidIdentity`.
  - Provider call sets `State[StateProviderName]` before calling the provider, for every request type.
  - `provider.EmbeddingRequest.KeyID string` (`json:"-"`).
  - `cache.Key` hashes `req.TenantID`.
  - The cache middleware sets `State[StateCacheHit] = true` on a hit, stream replays included.

- [ ] **Step 1: Write the failing tests**

`pipeline/middlewares/identity_test.go`:

```go
package middlewares_test

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
	"github.com/xraph/nexus/provider"
)

func runOnce(t *testing.T, mw pipeline.Middleware, ctx context.Context, req *pipeline.Request) (context.Context, error) {
	t.Helper()
	var seen context.Context
	_, err := mw.Process(ctx, req, func(c context.Context) (*pipeline.Response, error) {
		seen = c
		return &pipeline.Response{}, nil
	})
	return seen, err
}

func TestRequestIDIsSetOnce(t *testing.T) {
	req := &pipeline.Request{State: map[string]any{}}
	seen, _ := runOnce(t, middlewares.NewRequestID(), context.Background(), req)
	if _, err := id.ParseRequestID(pipeline.RequestID(seen)); err != nil {
		t.Fatalf("request id %q: %v", pipeline.RequestID(seen), err)
	}
	given := id.NewRequestID().String()
	seen, _ = runOnce(t, middlewares.NewRequestID(), pipeline.WithRequestID(context.Background(), given), req)
	if pipeline.RequestID(seen) != given {
		t.Fatalf("an existing request id must be kept")
	}
}

func TestIdentityReconcilesContextAndRequest(t *testing.T) {
	tenant, other, key := id.NewTenantID().String(), id.NewTenantID().String(), id.NewKeyID().String()
	completion := func(t, k string) *pipeline.Request {
		return &pipeline.Request{Completion: &provider.CompletionRequest{TenantID: t, KeyID: k}, State: map[string]any{}}
	}
	cases := []struct {
		name    string
		ctx     context.Context
		req     *pipeline.Request
		want    string
		wantErr bool
	}{
		{"request fields only", context.Background(), completion(tenant, key), tenant, false},
		{"context only", pipeline.WithTenantID(context.Background(), tenant), completion("", ""), tenant, false},
		{"both agree", pipeline.WithTenantID(context.Background(), tenant), completion(tenant, ""), tenant, false},
		{"neither", context.Background(), completion("", ""), "", false},
		{"they disagree", pipeline.WithTenantID(context.Background(), tenant), completion(other, ""), "", true},
		{"tenant id does not parse", context.Background(), completion("acme", ""), "", true},
		{"key id does not parse", context.Background(), completion("", "nxs_abc"), "", true},
		{"embedding fields", context.Background(), &pipeline.Request{Embedding: &provider.EmbeddingRequest{TenantID: tenant}, State: map[string]any{}}, tenant, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			seen, err := runOnce(t, middlewares.NewIdentity(), c.ctx, c.req)
			if c.wantErr {
				if !errors.Is(err, middlewares.ErrInvalidIdentity) {
					t.Fatalf("err = %v, want ErrInvalidIdentity", err)
				}
				return
			}
			if err != nil || pipeline.TenantID(seen) != c.want {
				t.Fatalf("tenant in context = %q, %v; want %q", pipeline.TenantID(seen), err, c.want)
			}
			var inReq string
			if c.req.Completion != nil {
				inReq = c.req.Completion.TenantID
			} else {
				inReq = c.req.Embedding.TenantID
			}
			if inReq != c.want {
				t.Fatalf("tenant in request = %q, want %q (later stages read the request)", inReq, c.want)
			}
		})
	}
}
```

`pipeline/middlewares/provider_call_test.go`:

```go
package middlewares_test

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
	"github.com/xraph/nexus/provider"
)

type failing struct{ listedFake }

func (failing) Complete(context.Context, *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	return nil, errors.New("upstream 502")
}

func TestProviderCallAttributesBeforeTheCall(t *testing.T) {
	reg := provider.NewRegistry()
	reg.Register(failing{listedFake{name: "openai"}})
	mw := middlewares.NewProviderCall(nil, reg)
	req := &pipeline.Request{Type: pipeline.RequestCompletion, Completion: &provider.CompletionRequest{Model: "gpt-4o"}, State: map[string]any{}}
	if _, err := mw.Process(context.Background(), req, nil); err == nil {
		t.Fatalf("want the provider's error")
	}
	if req.State[pipeline.StateProviderName] != "openai" {
		t.Fatalf("a failed call must still say which provider was called, got %v", req.State[pipeline.StateProviderName])
	}
}
```

`listedFake` is a minimal `provider.Provider` used by several tests in this package. Create `pipeline/middlewares/fakes_test.go`:

```go
package middlewares_test

import (
	"context"

	"github.com/xraph/nexus/provider"
)

// listedFake is a provider with a fixed name, model list and answers. Tests
// embed it and override the methods they need.
type listedFake struct {
	name   string
	models []provider.Model
	resp   *provider.CompletionResponse
	emb    *provider.EmbeddingResponse
}

func (f listedFake) Name() string { return f.name }
func (f listedFake) Capabilities() provider.Capabilities {
	return provider.Capabilities{Chat: true, Streaming: true, Embeddings: true}
}
func (f listedFake) Models(context.Context) ([]provider.Model, error) { return f.models, nil }
func (f listedFake) Complete(context.Context, *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	return f.resp, nil
}
func (f listedFake) CompleteStream(context.Context, *provider.CompletionRequest) (provider.Stream, error) {
	return nil, nil //nolint:nilnil // not used by these tests
}
func (f listedFake) Embed(context.Context, *provider.EmbeddingRequest) (*provider.EmbeddingResponse, error) {
	return f.emb, nil
}
func (f listedFake) Healthy(context.Context) bool { return true }
```

Cache key test (in `cache/key_test.go`, package `cache_test`):

```go
func TestTenantsDoNotShareCacheKeys(t *testing.T) {
	a := &provider.CompletionRequest{Model: "gpt-4o", TenantID: "tenant_a", Messages: []provider.Message{{Role: "user", Content: "hi"}}}
	b := *a
	b.TenantID = "tenant_b"
	if cache.Key(a) == cache.Key(&b) {
		t.Fatalf("two tenants got the same cache key")
	}
	if cache.StreamKey(a) == cache.StreamKey(&b) {
		t.Fatalf("two tenants got the same stream cache key")
	}
}
```

In `pipeline/middlewares/cache_stream_test.go`, extend the existing replay test (the one that asserts a second identical stream request is replayed from the stream cache): after the replay, assert `req.State[pipeline.StateCacheHit] == true` on the second request. Add an equivalent assertion for a non-stream hit in a new small test using `cache.NewService(stores.NewMemory())`, two identical `RequestCompletion` requests through `middlewares.NewCache(...)`, and a `next` that returns a fixed completion.

Run: `go test ./pipeline/... ./cache/...`
Expected: FAIL to compile (`undefined: middlewares.NewIdentity`, `undefined: pipeline.StateProviderName`).

- [ ] **Step 2: Shared state keys**

`pipeline/state.go`:

```go
package pipeline

// Request.State keys more than one stage reads.
const (
	// StateProviderName is the name of the provider the terminal stage
	// called, set before the call so a failed call is still attributed.
	StateProviderName = "provider_name"
	// StateCacheHit is true when the response came from the response cache
	// or the stream cache.
	StateCacheHit = "cache_hit"
)
```

- [ ] **Step 3: Request id and identity middleware**

`pipeline/middlewares/request_id.go`:

```go
package middlewares

import (
	"context"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/pipeline"
)

// RequestIDMiddleware gives every request a req_ id in context, unless the
// caller set one, so every later stage and the usage record can name it.
type RequestIDMiddleware struct{}

// NewRequestID creates the request id middleware.
func NewRequestID() *RequestIDMiddleware { return &RequestIDMiddleware{} }

func (*RequestIDMiddleware) Name() string  { return "request_id" }
func (*RequestIDMiddleware) Priority() int { return 5 }

func (*RequestIDMiddleware) Process(ctx context.Context, _ *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	if pipeline.RequestID(ctx) == "" {
		ctx = pipeline.WithRequestID(ctx, id.NewRequestID().String())
	}
	return next(ctx)
}
```

`pipeline/middlewares/identity.go`:

```go
package middlewares

import (
	"context"
	"errors"
	"fmt"

	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/pipeline"
)

// ErrInvalidIdentity reports a tenant or key id that does not parse, or a
// request whose context and fields name different tenants or keys.
var ErrInvalidIdentity = errors.New("nexus: invalid tenant or key id")

// IdentityMiddleware makes the tenant and key a request is attributed to
// agree in both places later stages read them: the pipeline context (set by
// an authenticating HTTP edge) and the request's TenantID/KeyID fields (set
// by an in-process Go caller). Stages that wrap it, such as usage, read the
// request fields after the call returns, because a context set here is not
// visible to them. Both may be empty: an unattributed request is allowed.
type IdentityMiddleware struct{}

// NewIdentity creates the identity middleware.
func NewIdentity() *IdentityMiddleware { return &IdentityMiddleware{} }

func (*IdentityMiddleware) Name() string  { return "identity" }
func (*IdentityMiddleware) Priority() int { return 30 }

func (*IdentityMiddleware) Process(ctx context.Context, req *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	reqTenant, reqKey := requestIdentity(req)
	tenant, err := reconcile("tenant", pipeline.TenantID(ctx), reqTenant)
	if err != nil {
		return nil, err
	}
	key, err := reconcile("key", pipeline.KeyID(ctx), reqKey)
	if err != nil {
		return nil, err
	}
	if tenant != "" {
		if _, err := id.ParseTenantID(tenant); err != nil {
			return nil, fmt.Errorf("%w: tenant %q", ErrInvalidIdentity, tenant)
		}
	}
	if key != "" {
		if _, err := id.ParseKeyID(key); err != nil {
			return nil, fmt.Errorf("%w: key %q", ErrInvalidIdentity, key)
		}
	}
	setRequestIdentity(req, tenant, key)
	ctx = pipeline.WithTenantID(pipeline.WithKeyID(ctx, key), tenant)
	return next(ctx)
}

func reconcile(what, fromCtx, fromReq string) (string, error) {
	switch {
	case fromCtx == "":
		return fromReq, nil
	case fromReq == "" || fromReq == fromCtx:
		return fromCtx, nil
	}
	return "", fmt.Errorf("%w: %s is %q in context but %q on the request", ErrInvalidIdentity, what, fromCtx, fromReq)
}

func requestIdentity(req *pipeline.Request) (tenant, key string) {
	switch {
	case req.Completion != nil:
		return req.Completion.TenantID, req.Completion.KeyID
	case req.Embedding != nil:
		return req.Embedding.TenantID, req.Embedding.KeyID
	}
	return "", ""
}

func setRequestIdentity(req *pipeline.Request, tenant, key string) {
	switch {
	case req.Completion != nil:
		req.Completion.TenantID, req.Completion.KeyID = tenant, key
	case req.Embedding != nil:
		req.Embedding.TenantID, req.Embedding.KeyID = tenant, key
	}
}
```

In `provider/request.go`, add to `EmbeddingRequest`: `KeyID string \`json:"-"\``.

- [ ] **Step 4: Attribute before the call; fix the embeddings capability**

In `pipeline/middlewares/provider_call.go`:
- In `handleCompletion`, move the provider name into state before the call, so it reads:

```go
	ctx = pipeline.WithProviderName(ctx, p.Name())
	req.State[pipeline.StateProviderName] = p.Name()
	start := time.Now()

	resp, err := p.Complete(ctx, req.Completion)
	if err != nil {
		return nil, fmt.Errorf("nexus: provider %s: %w", p.Name(), err)
	}

	req.State["provider_latency"] = time.Since(start)
	return &pipeline.Response{Completion: resp}, nil
```

- In `handleStream` and `handleEmbedding`, replace `req.State["provider_name"]` with `req.State[pipeline.StateProviderName]`.
- In `handleEmbedding`, change `m.providers.WithCapability("embed")` to `m.providers.WithCapability("embeddings")`. `Capabilities.Supports` knows `embeddings`, not `embed`, so every pipeline embedding failed with "no providers support embeddings". This was a raised-not-fixed finding; the usage record cannot price embeddings without it.

In `pipeline/middlewares/usage.go` and `observability/tracing.go`, replace the literal `"provider_name"` with `pipeline.StateProviderName` (Task 7 rewrites usage.go anyway; do tracing here).

- [ ] **Step 5: Tenant-isolated cache, and the hit flag**

In `cache/key.go`, make the tenant the first thing hashed:

```go
	// Tenant: one tenant must never be served another's cached completion.
	_, _ = fmt.Fprintf(h, "tenant:%s\n", req.TenantID)
```

and add to `Key`'s doc comment: `The tenant is part of the key, so tenants never share entries.`

In `pipeline/middlewares/cache.go`, set the hit flag on both hit paths:

```go
	cached, err := m.cache.Get(ctx, key)
	if err == nil && cached != nil {
		cached.Cached = true
		req.State[pipeline.StateCacheHit] = true
		return &pipeline.Response{Completion: cached}, nil
	}
```

```go
	if frames, err := m.streamCache.GetStream(ctx, key); err == nil && len(frames) > 0 {
		req.State[pipeline.StateCacheHit] = true
		return &pipeline.Response{Stream: newReplayStream(frames, m.streamOpts)}, nil
	}
```

The cache stage (280) runs after identity (30), so `req.Completion.TenantID` is already reconciled when the key is computed.

- [ ] **Step 6: Run, lint, commit**

```bash
go test ./pipeline/... ./cache/... ./observability/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add pipeline/state.go pipeline/middlewares/request_id.go pipeline/middlewares/identity.go pipeline/middlewares/identity_test.go pipeline/middlewares/provider_call_test.go pipeline/middlewares/fakes_test.go cache/key_test.go
git commit --only -m "feat(pipeline): give every request an id, an identity and a tenant-isolated cache

Requests get a req_ id. The identity stage makes the tenant and key in
context and on the request agree, and refuses ids that do not parse or that
disagree. The provider call records which provider it called before calling
it, so a failed call is still attributed, and embeddings look up the
capability Supports actually knows. The cache key includes the tenant, and
a hit, stream replays included, is flagged for the usage record." -- pipeline/state.go pipeline/middlewares/request_id.go pipeline/middlewares/identity.go pipeline/middlewares/identity_test.go pipeline/middlewares/provider_call.go pipeline/middlewares/provider_call_test.go pipeline/middlewares/fakes_test.go pipeline/middlewares/cache.go pipeline/middlewares/cache_stream_test.go provider/request.go cache/key.go cache/key_test.go observability/tracing.go
git show --stat HEAD
```

If `cache/key_test.go` already existed, it is a modified path, not a new one: drop it from `git add`.

---

### Task 7: The usage record says what happened and what it cost

**Files:**
- Modify: `pipeline/middlewares/usage.go` (rewrite)
- Modify: `pipeline/refusal.go` (create)
- Modify: `pipeline/middlewares/usage_outcome_test.go`, `pipeline/middlewares/usage_stream_test.go`

**Interfaces:**
- Consumes: `model.Cost`, `provider.Pricing` (Task 2), `usage.PricingNotCharged`, `usage.PricingUnknown` (Task 3), `guard.BlockedError` (Task 5), `pipeline.StateProviderName`, `pipeline.StateCacheHit`, request identity fields (Task 6).
- Produces:
  - `type pipeline.Refusal interface { error; RefusalCode() string; StatusCode() int }`: slice 3's refusals implement it; the usage stage records them as `refused`, `not_charged`.
  - `type middlewares.PriceLookup interface { Price(ctx context.Context, providerName string, modelIDs ...string) (provider.Pricing, bool) }` (`*model.PriceBook` satisfies it).
  - `type middlewares.UsageLogger interface { Error(msg string, args ...any) }`.
  - `func middlewares.NewUsage(u usage.Service, prices PriceLookup, log UsageLogger) *UsageMiddleware` (`prices` and `log` may be nil), priority 15.
  - `func (m *UsageMiddleware) Flush(ctx context.Context) error`: waits for in-flight inserts.
  - `func (m *UsageMiddleware) InsertErrors() int64`.

The classification every record gets:

| Situation | Outcome | PricingStatus | Cost |
|---|---|---|---|
| served, model priced | `ok` | `priced` | exact |
| served, model has no price | `ok` | `unpriced_model` | nil |
| cache hit (response or stream cache) | `cached` | `cached` | 0 |
| guard input block | `blocked` (+`BlockedBy`) | `not_charged` | 0 |
| guard output block | `blocked` (+`BlockedBy`) | priced from the blocked response's usage | exact or nil |
| refusal (`pipeline.Refusal`) | `refused` (+`RefusalCode`) | `not_charged` | 0 |
| error before any provider was called | `error` | `not_charged` | 0 |
| error after a provider was called | `error` | `unknown` | nil |
| stream that failed after reporting tokens | `error` | priced from the reported tokens | exact |
| stream that failed with no tokens | `error` | `unknown` | nil |

Insert-error counting lives in the usage stage, not on `usage.Service`, as the spec suggested: the stage is where asynchronous inserts fail, and adding a method to the `usage.Service` interface would break every implementer. Task 9 records this.

- [ ] **Step 1: Write the failing tests**

Replace `pipeline/middlewares/usage_outcome_test.go` with:

```go
package middlewares_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/nexus/guard"
	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/pipeline/middlewares"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/usage"
)

type prices map[string]provider.Pricing // "provider/model"

func (p prices) Price(_ context.Context, prov string, models ...string) (provider.Pricing, bool) {
	for _, m := range models {
		if price, ok := p[prov+"/"+m]; ok {
			return price, true
		}
	}
	return provider.Pricing{}, false
}

var gpt4o = prices{"openai/gpt-4o": {InputPerMillion: money.MustParse("2.50"), OutputPerMillion: money.MustParse("10")}}

type refusal struct{}

func (refusal) Error() string       { return "budget exceeded" }
func (refusal) RefusalCode() string { return "budget_exceeded" }
func (refusal) StatusCode() int     { return 429 }

func TestUsageClassifiesEveryOutcome(t *testing.T) {
	served := &provider.CompletionResponse{Model: "gpt-4o", Usage: provider.Usage{PromptTokens: 1234, CompletionTokens: 567, TotalTokens: 1801}}
	tenant, key := id.NewTenantID().String(), id.NewKeyID().String()
	cases := []struct {
		name        string
		called      bool // the provider name is in State
		cacheHit    bool
		resp        *pipeline.Response
		err         error
		model       string
		wantOutcome usage.Outcome
		wantStatus  usage.PricingStatus
		wantCost    string // "" means nil
		wantBy      string
		wantCode    string
	}{
		{"served and priced", true, false, &pipeline.Response{Completion: served}, nil, "gpt-4o", usage.OutcomeOK, usage.PricingPriced, "0.008755", "", ""},
		{"served, no price", true, false, &pipeline.Response{Completion: &provider.CompletionResponse{Model: "o9", Usage: served.Usage}}, nil, "o9", usage.OutcomeOK, usage.PricingUnpricedModel, "", "", ""},
		{"cache hit", false, true, &pipeline.Response{Completion: &provider.CompletionResponse{Cached: true, Usage: served.Usage}}, nil, "gpt-4o", usage.OutcomeCached, usage.PricingCached, "0", "", ""},
		{"input block", false, false, nil, &guard.BlockedError{Guard: "pii", Phase: guard.PhaseInput, Reason: "ssn"}, "gpt-4o", usage.OutcomeBlocked, usage.PricingNotCharged, "0", "pii", ""},
		{"output block", true, false, nil, &guard.BlockedError{Guard: "leak", Phase: guard.PhaseOutput, Usage: &served.Usage, Model: "gpt-4o", Provider: "openai"}, "gpt-4o", usage.OutcomeBlocked, usage.PricingPriced, "0.008755", "leak", ""},
		{"refused", false, false, nil, refusal{}, "gpt-4o", usage.OutcomeRefused, usage.PricingNotCharged, "0", "", "budget_exceeded"},
		{"failed before a provider", false, false, nil, errors.New("no providers registered"), "gpt-4o", usage.OutcomeError, usage.PricingNotCharged, "0", "", ""},
		{"provider failed", true, false, nil, errors.New("upstream 502"), "gpt-4o", usage.OutcomeError, usage.PricingUnknown, "", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := newRecordingUsage()
			mw := middlewares.NewUsage(rec, gpt4o, nil)
			req := &pipeline.Request{Type: pipeline.RequestCompletion, Completion: &provider.CompletionRequest{Model: c.model, TenantID: tenant, KeyID: key}, State: map[string]any{}}
			ctx := pipeline.WithRequestID(context.Background(), id.NewRequestID().String())
			_, _ = mw.Process(ctx, req, func(context.Context) (*pipeline.Response, error) {
				if c.called {
					req.State[pipeline.StateProviderName] = "openai"
				}
				if c.cacheHit {
					req.State[pipeline.StateCacheHit] = true
				}
				return c.resp, c.err
			})
			if err := mw.Flush(context.Background()); err != nil {
				t.Fatalf("flush: %v", err)
			}
			got := rec.only(t)
			if got.Outcome != c.wantOutcome || got.PricingStatus != c.wantStatus || got.BlockedBy != c.wantBy || got.RefusalCode != c.wantCode {
				t.Fatalf("outcome %s/%s by %q code %q", got.Outcome, got.PricingStatus, got.BlockedBy, got.RefusalCode)
			}
			switch {
			case c.wantCost == "" && got.CostUSD != nil:
				t.Fatalf("cost = %s, want nil", got.CostUSD)
			case c.wantCost != "" && (got.CostUSD == nil || got.CostUSD.String() != c.wantCost):
				t.Fatalf("cost = %v, want %s", got.CostUSD, c.wantCost)
			}
			if got.TenantID.String() != tenant || got.KeyID.String() != key || got.RequestID.IsNil() {
				t.Fatalf("attribution = %s / %s / %s", got.TenantID, got.KeyID, got.RequestID)
			}
			if got.Latency <= 0 || time.Since(got.CreatedAt) > time.Minute {
				t.Fatalf("latency %s, created %s", got.Latency, got.CreatedAt)
			}
		})
	}
}

func TestUsageRecordsEmbeddings(t *testing.T) {
	rec := newRecordingUsage()
	mw := middlewares.NewUsage(rec, prices{"openai/text-embedding-3-small": {EmbeddingPerMillion: money.MustParse("0.02")}}, nil)
	req := &pipeline.Request{Type: pipeline.RequestEmbedding, Embedding: &provider.EmbeddingRequest{Model: "text-embedding-3-small"}, State: map[string]any{}}
	_, _ = mw.Process(context.Background(), req, func(context.Context) (*pipeline.Response, error) {
		req.State[pipeline.StateProviderName] = "openai"
		return &pipeline.Response{Embedding: &provider.EmbeddingResponse{Model: "text-embedding-3-small", Usage: provider.Usage{PromptTokens: 5000, TotalTokens: 5000}}}, nil
	})
	_ = mw.Flush(context.Background())
	got := rec.only(t)
	if got.Outcome != usage.OutcomeOK || got.CostUSD == nil || got.CostUSD.String() != "0.0001" || got.TotalTokens != 5000 {
		t.Fatalf("embedding record = %+v", got)
	}
}

func TestUsageCountsFailedInserts(t *testing.T) {
	rec := newRecordingUsage()
	rec.fail = errors.New("database down")
	log := &errLog{}
	mw := middlewares.NewUsage(rec, gpt4o, log)
	req := &pipeline.Request{Type: pipeline.RequestCompletion, Completion: &provider.CompletionRequest{Model: "gpt-4o"}, State: map[string]any{}}
	_, _ = mw.Process(context.Background(), req, func(context.Context) (*pipeline.Response, error) {
		return &pipeline.Response{Completion: &provider.CompletionResponse{}}, nil
	})
	_ = mw.Flush(context.Background())
	if mw.InsertErrors() != 1 || log.n != 1 {
		t.Fatalf("insert errors %d, logged %d; want 1 and 1", mw.InsertErrors(), log.n)
	}
}

type errLog struct{ n int }

func (l *errLog) Error(string, ...any) { l.n++ }
```

In `pipeline/middlewares/usage_stream_test.go`:
- give `recordingUsage` a `fail error` field returned from `Record` when set, and a helper:

```go
func (r *recordingUsage) only(t *testing.T) *usage.Record {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.records) != 1 {
		t.Fatalf("got %d records, want exactly 1", len(r.records))
	}
	return r.records[0]
}
```

  (keep the existing `done` channel; tests may use either it or `Flush`).
- change `middlewares.NewUsage(rec)` to `middlewares.NewUsage(rec, gpt4o, nil)`, set `req.State[pipeline.StateProviderName] = "openai"` and the request model to `gpt-4o` in the existing stream test, and assert the recorded stream is priced (`PricingPriced`, a non-nil cost computed from the stream's usage).
- add `TestUsageRecordsAFailedStream`: a `testutil.FakeStream` whose `Next` returns one chunk with `Usage{PromptTokens: 100, CompletionTokens: 20, TotalTokens: 120}` and then a non-EOF error (`errors.New("connection reset")`); the consumer reads until the error, then closes. Expect one record, `OutcomeError`, `PricingPriced`, cost `0.00045` (100 × 2.50/1e6 + 20 × 10/1e6). A second case with no usage chunk before the error expects `OutcomeError`, `PricingUnknown`, nil cost. If `testutil.FakeStream` cannot return an error from `Next`, write a tiny `erroringStream` in the test file implementing `provider.Stream`.
- add `TestUsageRecordsAStreamCacheReplay`: `State[StateCacheHit] = true` set by `next`, a stream that reports usage; expect `OutcomeCached`, `PricingCached`, cost 0.

Run: `go test ./pipeline/middlewares/`
Expected: FAIL to compile, `too many arguments in call to middlewares.NewUsage`.

- [ ] **Step 2: The refusal interface**

`pipeline/refusal.go`:

```go
package pipeline

// Refusal is an error a stage returns when it refuses a request before any
// provider is called: authentication, scopes, quotas, budgets. The usage
// stage records it as refused, at exactly $0, under RefusalCode.
type Refusal interface {
	error
	RefusalCode() string
	StatusCode() int
}
```

- [ ] **Step 3: Rewrite the usage middleware**

Replace `pipeline/middlewares/usage.go` with:

```go
package middlewares

import (
	"context"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xraph/nexus/guard"
	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/model"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/usage"
)

// PriceLookup finds a model's list price at the provider that served it.
// *model.PriceBook implements it.
type PriceLookup interface {
	Price(ctx context.Context, providerName string, modelIDs ...string) (provider.Pricing, bool)
}

// UsageLogger receives insert failures. nexus.Logger implements it.
type UsageLogger interface {
	Error(msg string, args ...any)
}

// UsageMiddleware records exactly one usage record per request. It sits at
// priority 15, outside everything but the request id and tracing, so it
// sees cache hits, guard blocks, refusals, the final result after retries
// and the request's total latency. It prices the request at the provider
// that served it and says what happened and whether the cost is known.
//
// Records are stored asynchronously. A failed insert is logged and counted
// (InsertErrors), and Flush waits for the inserts still in flight.
type UsageMiddleware struct {
	usage  usage.Service
	prices PriceLookup
	log    UsageLogger

	inflight     sync.WaitGroup
	insertErrors atomic.Int64
}

// NewUsage creates the usage middleware. prices and log may be nil: without
// prices every request is unpriced; without log failures are only counted.
func NewUsage(u usage.Service, prices PriceLookup, log UsageLogger) *UsageMiddleware {
	return &UsageMiddleware{usage: u, prices: prices, log: log}
}

func (m *UsageMiddleware) Name() string  { return "usage" }
func (m *UsageMiddleware) Priority() int { return 15 }

// InsertErrors is how many records failed to store since start.
func (m *UsageMiddleware) InsertErrors() int64 { return m.insertErrors.Load() }

// Flush waits for in-flight inserts, or until ctx is done.
func (m *UsageMiddleware) Flush(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		m.inflight.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *UsageMiddleware) Process(ctx context.Context, req *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	if m.usage == nil {
		return next(ctx)
	}
	start := time.Now()
	resp, err := next(ctx)

	rec := m.newRecord(ctx, req, start)
	if err == nil && resp != nil && resp.Stream != nil {
		resp.Stream = &usageRecordingStream{inner: resp.Stream, mw: m, ctx: ctx, rec: rec, req: req, start: start}
		return resp, nil
	}
	rec.Latency = time.Since(start)
	m.classify(ctx, rec, req, resp, err)
	m.record(rec)
	return resp, err
}

func (m *UsageMiddleware) newRecord(ctx context.Context, req *pipeline.Request, start time.Time) *usage.Record {
	rec := &usage.Record{ID: id.NewUsageID(), CreatedAt: start.UTC()}
	if rid, err := id.ParseRequestID(pipeline.RequestID(ctx)); err == nil {
		rec.RequestID = rid
	}
	tenant, key := requestIdentity(req)
	if tid, err := id.ParseTenantID(tenant); err == nil {
		rec.TenantID = tid
	}
	if kid, err := id.ParseKeyID(key); err == nil {
		rec.KeyID = kid
	}
	return rec
}

// classify fills a non-stream record from the request's outcome.
func (m *UsageMiddleware) classify(ctx context.Context, rec *usage.Record, req *pipeline.Request, resp *pipeline.Response, err error) {
	rec.Provider, _ = req.State[pipeline.StateProviderName].(string)
	rec.Model = requestModel(req)
	cacheHit, _ := req.State[pipeline.StateCacheHit].(bool)

	var blocked *guard.BlockedError
	var refused pipeline.Refusal
	switch {
	case errors.As(err, &blocked):
		rec.Outcome, rec.BlockedBy, rec.StatusCode = usage.OutcomeBlocked, blocked.Guard, 400
		if blocked.Usage == nil {
			notCharged(rec)
			return
		}
		if blocked.Provider != "" {
			rec.Provider = blocked.Provider
		}
		setTokens(rec, *blocked.Usage)
		m.price(ctx, rec, *blocked.Usage, false, blocked.Model)
	case errors.As(err, &refused):
		rec.Outcome, rec.RefusalCode, rec.StatusCode = usage.OutcomeRefused, refused.RefusalCode(), refused.StatusCode()
		notCharged(rec)
	case err != nil:
		rec.Outcome, rec.StatusCode = usage.OutcomeError, 500
		if rec.Provider == "" {
			notCharged(rec)
		} else {
			rec.PricingStatus = usage.PricingUnknown
		}
	case resp != nil && resp.Embedding != nil:
		rec.Outcome, rec.StatusCode = usage.OutcomeOK, 200
		setTokens(rec, resp.Embedding.Usage)
		m.price(ctx, rec, resp.Embedding.Usage, true, resp.Embedding.Model)
	case resp != nil && resp.Completion != nil && (cacheHit || resp.Completion.Cached):
		rec.Outcome, rec.StatusCode = usage.OutcomeCached, 200
		setTokens(rec, resp.Completion.Usage)
		cached(rec)
	case resp != nil && resp.Completion != nil:
		rec.Outcome, rec.StatusCode = usage.OutcomeOK, 200
		setTokens(rec, resp.Completion.Usage)
		m.price(ctx, rec, resp.Completion.Usage, false, resp.Completion.Model)
	default:
		rec.Outcome, rec.StatusCode = usage.OutcomeOK, 200
		rec.PricingStatus = usage.PricingUnpricedModel
	}
}

// price sets the cost from the list price at the provider that served the
// request: the requested model first (aliases already resolved), then the
// model the provider reported.
func (m *UsageMiddleware) price(ctx context.Context, rec *usage.Record, u provider.Usage, embedding bool, respModel string) {
	if m.prices == nil {
		rec.CostUSD, rec.PricingStatus = nil, usage.PricingUnpricedModel
		return
	}
	p, ok := m.prices.Price(ctx, rec.Provider, rec.Model, respModel)
	if !ok {
		rec.CostUSD, rec.PricingStatus = nil, usage.PricingUnpricedModel
		return
	}
	rec.CostUSD, rec.PricingStatus = model.Cost(u, p, embedding)
}

func (m *UsageMiddleware) record(rec *usage.Record) {
	m.inflight.Add(1)
	go func() {
		defer m.inflight.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := m.usage.Record(ctx, rec); err != nil {
			m.insertErrors.Add(1)
			if m.log != nil {
				m.log.Error("nexus: storing a usage record failed", "request_id", rec.RequestID.String(), "error", err)
			}
		}
	}()
}

func requestModel(req *pipeline.Request) string {
	switch {
	case req.Completion != nil:
		return req.Completion.Model
	case req.Embedding != nil:
		return req.Embedding.Model
	}
	return ""
}

func setTokens(rec *usage.Record, u provider.Usage) {
	rec.PromptTokens, rec.CompletionTokens, rec.TotalTokens = u.PromptTokens, u.CompletionTokens, u.TotalTokens
	if rec.TotalTokens == 0 {
		rec.TotalTokens = rec.PromptTokens + rec.CompletionTokens
	}
}

func notCharged(rec *usage.Record) {
	zero := money.Zero
	rec.CostUSD, rec.PricingStatus = &zero, usage.PricingNotCharged
}

func cached(rec *usage.Record) {
	zero := money.Zero
	rec.Cached, rec.CostUSD, rec.PricingStatus = true, &zero, usage.PricingCached
}

// usageRecordingStream records the stream's usage once, when it is closed.
// It captures token counts from usage chunks as they pass, falls back to the
// merged final response the stream lifecycle stage publishes and to the
// stream's own Usage, and remembers the first error that was not io.EOF so
// a broken stream is recorded as an error.
type usageRecordingStream struct {
	inner provider.Stream
	mw    *UsageMiddleware
	ctx   context.Context
	rec   *usage.Record
	req   *pipeline.Request
	start time.Time

	mu       sync.Mutex
	usage    provider.Usage
	failed   bool
	recorded bool
}

func (s *usageRecordingStream) Next(ctx context.Context) (*provider.StreamChunk, error) {
	chunk, err := s.inner.Next(ctx)
	s.mu.Lock()
	if chunk != nil && chunk.Usage != nil {
		s.usage = *chunk.Usage
	}
	if err != nil && !errors.Is(err, io.EOF) {
		s.failed = true
	}
	s.mu.Unlock()
	return chunk, err
}

func (s *usageRecordingStream) Close() error {
	s.mu.Lock()
	already := s.recorded
	s.recorded = true
	s.mu.Unlock()

	closeErr := s.inner.Close()
	if already {
		return closeErr
	}

	s.mu.Lock()
	u, failed := s.usage, s.failed
	s.mu.Unlock()
	respModel := ""
	if v, ok := s.req.State[StateKeyStreamFinalResponse].(*provider.CompletionResponse); ok && v != nil {
		if u.TotalTokens == 0 && u.PromptTokens == 0 && u.CompletionTokens == 0 {
			u = v.Usage
		}
		respModel = v.Model
	}
	if u.TotalTokens == 0 && u.PromptTokens == 0 && u.CompletionTokens == 0 {
		if iu := s.inner.Usage(); iu != nil {
			u = *iu
		}
	}

	rec := s.rec
	rec.Latency = time.Since(s.start)
	rec.Provider, _ = s.req.State[pipeline.StateProviderName].(string)
	rec.Model = requestModel(s.req)
	setTokens(rec, u)
	cacheHit, _ := s.req.State[pipeline.StateCacheHit].(bool)
	hasTokens := rec.TotalTokens > 0
	switch {
	case cacheHit:
		rec.Outcome, rec.StatusCode = usage.OutcomeCached, 200
		cached(rec)
	case failed && !hasTokens:
		rec.Outcome, rec.StatusCode, rec.PricingStatus = usage.OutcomeError, 500, usage.PricingUnknown
	case failed:
		rec.Outcome, rec.StatusCode = usage.OutcomeError, 500
		s.mw.price(s.ctx, rec, u, false, respModel)
	default:
		rec.Outcome, rec.StatusCode = usage.OutcomeOK, 200
		s.mw.price(s.ctx, rec, u, false, respModel)
	}
	s.mw.record(rec)
	return closeErr
}

func (s *usageRecordingStream) Usage() *provider.Usage { return s.inner.Usage() }
```

`requestIdentity` is defined in `identity.go` (Task 6) in the same package.

- [ ] **Step 4: Run, lint, commit**

```bash
go test -race ./pipeline/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add pipeline/refusal.go
git commit --only -m "feat(usage): record what happened to every request and what it cost

The usage stage now prices each request at the provider that served it and
says what happened: served, cached, blocked by a named guard, refused, or
failed. A failure before any provider was called is not charged; a failure
after one was called has an unknown cost, not \$0. Embeddings are recorded,
a stream that broke is recorded as an error, and a stream-cache replay is a
cache hit. Failed inserts are logged and counted, and Flush waits for the
ones in flight." -- pipeline/refusal.go pipeline/middlewares/usage.go pipeline/middlewares/usage_outcome_test.go pipeline/middlewares/usage_stream_test.go
git show --stat HEAD
```

---

### Task 8: The gateway builds what it declares, and the extension passes its settings through

**Files:**
- Modify: `nexus.go` (fields, `Initialize`, `buildDefaultPipeline`, `Shutdown`, accessors)
- Modify: `options.go` (`WithRouter` records the strategy name; new options)
- Modify: `logger.go` (`NewLevelLogger`)
- Delete: `pipeline/middlewares/headers.go`
- Modify: `pipeline/middlewares/stream_lifecycle.go` (priority 60, comments)
- Create: `wiring_test.go` (package `nexus_test`)
- Modify: `extension/extension.go` (`applyConfigToGatewayOpts`)
- Create: `extension/config_passthrough_test.go`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - Options: `WithTenantService(tenant.Service)`, `WithKeyService(key.Service)`, `WithUsageService(usage.Service)`, `WithUsageEnabled(bool)`, `WithCacheEnabled(bool)`.
  - `Initialize` builds `tenant.NewService(store.Tenants())`, `key.NewService(store.Keys())`, `usage.NewService(store.Usage())` unless supplied; builds an in-memory response cache when `EnableCache` is true and no cache was given; adds the usage stage only when `EnableUsage`.
  - Accessors: `RoutingStrategy() string`, `Aliases() []model.Alias`, `Transforms() *transform.Registry`, `PipelineStages() []pipeline.Stage`, `UsageInsertErrors() int64`, `PriceBook() *model.PriceBook`.
  - `Shutdown` flushes in-flight usage inserts before closing the store.
  - `func NewLevelLogger(l Logger, level string) Logger`.
  - Default pipeline order: `request_id` 5, tracing 10, usage 15, timeout 20, identity 30, stream lifecycle 60, guardrail 150, transform 200, alias 250, cache 280, retry 340, custom middleware by priority, provider call last.

- [ ] **Step 1: Write the failing tests**

`wiring_test.go`:

```go
package nexus_test

import (
	"context"
	"slices"
	"testing"

	nexus "github.com/xraph/nexus"
	"github.com/xraph/nexus/model"
	"github.com/xraph/nexus/router/strategies"
	"github.com/xraph/nexus/store"
)

func stageNames(gw *nexus.Gateway) []string {
	var names []string
	for _, s := range gw.PipelineStages() {
		names = append(names, s.Name)
	}
	return names
}

func TestInitializeBuildsTheDeclaredServices(t *testing.T) {
	gw := nexus.New(nexus.WithDatabase(store.NewMemory()))
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if gw.Tenants() == nil || gw.Keys() == nil || gw.Usage() == nil {
		t.Fatalf("tenant %v, key %v, usage %v: all must be built", gw.Tenants(), gw.Keys(), gw.Usage())
	}
	want := []string{"request_id", "usage", "timeout", "identity", "stream_lifecycle", "retry", "provider_call"}
	if got := stageNames(gw); !slices.Equal(got, want) {
		t.Fatalf("stages %v, want %v", got, want)
	}
	if gw.RoutingStrategy() != "priority" || gw.PriceBook() == nil {
		t.Fatalf("strategy %q, price book %v", gw.RoutingStrategy(), gw.PriceBook())
	}
}

func TestUsageCanBeTurnedOff(t *testing.T) {
	gw := nexus.New(nexus.WithUsageEnabled(false))
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if slices.Contains(stageNames(gw), "usage") {
		t.Fatalf("usage stage present with usage disabled: %v", stageNames(gw))
	}
	if gw.Usage() == nil {
		t.Fatalf("the usage service is still built for reading")
	}
}

func TestEnableCacheBuildsAMemoryCacheAndAccessorsReport(t *testing.T) {
	gw := nexus.New(
		nexus.WithCacheEnabled(true),
		nexus.WithRouter(strategies.NewRoundRobin()),
		nexus.WithAlias("fast", model.AliasTarget{Provider: "openai", Model: "gpt-4o-mini"}),
	)
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if gw.Cache() == nil || !slices.Contains(stageNames(gw), "cache") {
		t.Fatalf("enable_cache must build a cache stage: %v", stageNames(gw))
	}
	if gw.RoutingStrategy() != strategies.NewRoundRobin().Name() {
		t.Fatalf("strategy = %q", gw.RoutingStrategy())
	}
	if len(gw.Aliases()) != 1 || gw.Aliases()[0].Name != "fast" {
		t.Fatalf("aliases = %+v", gw.Aliases())
	}
}

func TestLevelLoggerDropsBelowItsLevel(t *testing.T) {
	var got []string
	l := nexus.NewLevelLogger(recordLogger{&got}, "warn")
	l.Debug("d")
	l.Info("i")
	l.Warn("w")
	l.Error("e")
	if !slices.Equal(got, []string{"w", "e"}) {
		t.Fatalf("logged %v", got)
	}
}

type recordLogger struct{ got *[]string }

func (r recordLogger) Debug(m string, _ ...any) { *r.got = append(*r.got, m) }
func (r recordLogger) Info(m string, _ ...any)  { *r.got = append(*r.got, m) }
func (r recordLogger) Warn(m string, _ ...any)  { *r.got = append(*r.got, m) }
func (r recordLogger) Error(m string, _ ...any) { *r.got = append(*r.got, m) }
```

The stage list in `TestInitializeBuildsTheDeclaredServices` assumes a gateway with no tracer, guards, transforms, aliases or cache, default timeout and retries, and the extension registry present (it always is). If `nexus.New` does not create the extension registry when no extension is given, check `New` and adjust the expected list to what `buildDefaultPipeline` adds unconditionally; the order is what matters.

`extension/config_passthrough_test.go` (package `extension`, internal test so it can call `applyConfigToGatewayOpts`):

```go
package extension

import (
	"context"
	"slices"
	"testing"

	nexus "github.com/xraph/nexus"
)

func TestConfigReachesTheGateway(t *testing.T) {
	off := false
	e := &Extension{config: Config{EnableUsage: &off, EnableCache: true, LogLevel: "warn"}}
	e.applyConfigToGatewayOpts()
	gw := nexus.New(e.gatewayOpts...)
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	var names []string
	for _, s := range gw.PipelineStages() {
		names = append(names, s.Name)
	}
	if slices.Contains(names, "usage") || !slices.Contains(names, "cache") {
		t.Fatalf("enable_usage=false and enable_cache=true must reach the gateway: %v", names)
	}
	if gw.Config().LogLevel != "warn" {
		t.Fatalf("log level = %q", gw.Config().LogLevel)
	}
}
```

If constructing `Extension` without `BaseExtension` panics inside `applyConfigToGatewayOpts` (it calls `e.Logger()` after Step 5), build it with `New()` and set `e.config` before calling.

Run: `go test . ./extension/`
Expected: FAIL to compile, `undefined: nexus.WithUsageEnabled`.

- [ ] **Step 2: Options and the level logger**

Append to `options.go`:

```go
// WithTenantService replaces the tenant service Initialize would build.
func WithTenantService(s tenant.Service) Option { return func(gw *Gateway) { gw.tenant = s } }

// WithKeyService replaces the API key service Initialize would build.
func WithKeyService(s key.Service) Option { return func(gw *Gateway) { gw.key = s } }

// WithUsageService replaces the usage service Initialize would build.
func WithUsageService(s usage.Service) Option { return func(gw *Gateway) { gw.usage = s } }

// WithUsageEnabled turns usage recording on or off (default on). Off is the
// one way to stop recording; the usage service is still built for reads.
func WithUsageEnabled(on bool) Option { return func(gw *Gateway) { gw.config.EnableUsage = on } }

// WithCacheEnabled turns the response cache on. Without WithCache it is an
// in-memory cache with the default size and TTL.
func WithCacheEnabled(on bool) Option { return func(gw *Gateway) { gw.config.EnableCache = on } }
```

and change `WithRouter` to record the strategy's name:

```go
func WithRouter(r router.Strategy) Option {
	return func(gw *Gateway) {
		gw.router = router.NewService(r)
		gw.routerStrategy = r.Name()
	}
}
```

Add the imports `key`, `tenant`, `usage` as needed.

Append to `logger.go`:

```go
// NewLevelLogger drops messages below level: "debug", "info", "warn" or
// "error". Any other value means "info".
func NewLevelLogger(l Logger, level string) Logger {
	levels := map[string]int{"debug": 0, "info": 1, "warn": 2, "error": 3}
	floor, ok := levels[level]
	if !ok {
		floor = levels["info"]
	}
	return &levelLogger{l: l, floor: floor}
}

type levelLogger struct {
	l     Logger
	floor int
}

func (g *levelLogger) Debug(msg string, args ...any) {
	if g.floor <= 0 {
		g.l.Debug(msg, args...)
	}
}
func (g *levelLogger) Info(msg string, args ...any) {
	if g.floor <= 1 {
		g.l.Info(msg, args...)
	}
}
func (g *levelLogger) Warn(msg string, args ...any) {
	if g.floor <= 2 {
		g.l.Warn(msg, args...)
	}
}
func (g *levelLogger) Error(msg string, args ...any) { g.l.Error(msg, args...) }
```

- [ ] **Step 3: Build what the gateway declares**

In `nexus.go`:
- add fields: `routerStrategy string`, `priceBook *model.PriceBook`, `usageMW *middlewares.UsageMiddleware`;
- in `Initialize`, after the store and logger defaults:

```go
	if gw.tenant == nil {
		gw.tenant = tenant.NewService(gw.store.Tenants())
	}
	if gw.key == nil {
		gw.key = key.NewService(gw.store.Keys())
	}
	if gw.usage == nil {
		gw.usage = usage.NewService(gw.store.Usage())
	}
	if gw.config.EnableCache && gw.cache == nil && gw.streamCache == nil {
		gw.cache = cache.NewService(stores.NewMemory())
	}
	gw.priceBook = model.NewPriceBook(gw.providers)
```

  and in the default-router branch set `gw.routerStrategy = "priority"` from the strategy: `s := strategies.NewPriority(); gw.router = router.NewService(s); gw.routerStrategy = s.Name()`.
- rewrite `buildDefaultPipeline`:

```go
func (gw *Gateway) buildDefaultPipeline() (pipeline.Service, error) {
	b := pipeline.NewBuilder()
	b.Use(middlewares.NewRequestID())
	if gw.tracer != nil {
		b.Use(observability.NewTracingMiddleware(gw.tracer))
	}
	if gw.config.EnableUsage && gw.usage != nil {
		gw.usageMW = middlewares.NewUsage(gw.usage, gw.priceBook, gw.logger)
		b.Use(gw.usageMW)
	}
	if gw.config.DefaultTimeout > 0 {
		b.Use(middlewares.NewTimeout(gw.config.DefaultTimeout))
	}
	b.Use(middlewares.NewIdentity())
	if gw.extensions != nil {
		b.Use(middlewares.NewStreamLifecycle(gw.extensions, gw.streamLifecycleCfg))
	}
	if gw.guard != nil {
		b.Use(middlewares.NewGuardrail(gw.guard))
	}
	if gw.transforms != nil {
		b.Use(middlewares.NewTransform(gw.transforms))
	}
	if gw.aliasRegistry != nil {
		b.Use(middlewares.NewAlias(gw.aliasRegistry))
	}
	if gw.cache != nil || gw.streamCache != nil {
		mw := middlewares.NewCache(gw.cache)
		if gw.streamCache != nil {
			mw = mw.WithStreamCache(gw.streamCache, gw.streamCacheCfg)
		}
		b.Use(mw)
	}
	if gw.config.DefaultMaxRetries > 0 {
		b.Use(middlewares.NewRetry(gw.config.DefaultMaxRetries, 500*time.Millisecond, 2.0))
	}
	for _, m := range gw.customMiddleware {
		b.Use(m)
	}
	b.Use(middlewares.NewProviderCall(gw.router, gw.providers))
	return b.Build()
}
```

  (The `cache.NewService` call needs `"github.com/xraph/nexus/cache/stores"`; check whether `cache.NewService` takes a `cache.Cache` and `stores.NewMemory()` returns one, as `WithCache` already does.)
- `Shutdown`:

```go
func (gw *Gateway) Shutdown(ctx context.Context) error {
	gw.logger.Info("nexus gateway shutting down")
	if gw.usageMW != nil {
		if err := gw.usageMW.Flush(ctx); err != nil {
			gw.logger.Warn("nexus: usage records still in flight at shutdown", "error", err)
		}
	}
	if gw.store != nil {
		return gw.store.Close()
	}
	return nil
}
```

- accessors:

```go
// RoutingStrategy is the name of the routing strategy in use.
func (gw *Gateway) RoutingStrategy() string { return gw.routerStrategy }

// Aliases lists the configured model aliases, or nil when there are none.
func (gw *Gateway) Aliases() []model.Alias {
	if gw.aliasRegistry == nil {
		return nil
	}
	return gw.aliasRegistry.List()
}

// Transforms returns the transform registry, or nil when none is configured.
func (gw *Gateway) Transforms() *transform.Registry { return gw.transforms }

// PipelineStages lists the pipeline's stages in the order they run, or nil
// for a custom pipeline that cannot list them.
func (gw *Gateway) PipelineStages() []pipeline.Stage {
	if in, ok := gw.pipeline.(pipeline.Inspector); ok {
		return in.Stages()
	}
	return nil
}

// UsageInsertErrors is how many usage records failed to store since start.
func (gw *Gateway) UsageInsertErrors() int64 {
	if gw.usageMW == nil {
		return 0
	}
	return gw.usageMW.InsertErrors()
}

// PriceBook returns the price book the usage stage prices requests with.
func (gw *Gateway) PriceBook() *model.PriceBook { return gw.priceBook }
```

Delete `pipeline/middlewares/headers.go` (`git rm` is not allowed by the shared-checkout rules; delete the file with `rm` and include the path in the commit's `--only` list). Search for other users: `grep -rn 'NewHeaders' --include='*.go' .` must print nothing after the deletion.

In `pipeline/middlewares/stream_lifecycle.go`, change `Priority()` to return `60`, and update the type comment's "Position: priority 545" paragraph to: `Position: priority 60, inside the usage stage (15), so the usage stage's stream wrapper closes it first and reads the merged final response it publishes.`

- [ ] **Step 4: Pass the extension's settings through**

In `extension/extension.go`, append to `applyConfigToGatewayOpts`:

```go
	if e.config.EnableUsage != nil {
		e.gatewayOpts = append(e.gatewayOpts, nexus.WithUsageEnabled(*e.config.EnableUsage))
	}
	if e.config.EnableCache {
		e.gatewayOpts = append(e.gatewayOpts, nexus.WithCacheEnabled(true))
	}
	if e.config.LogLevel != "" {
		lvl := e.config.LogLevel
		e.gatewayOpts = append(e.gatewayOpts,
			func(gw *nexus.Gateway) { gw.Config().LogLevel = lvl },
			nexus.WithLogger(nexus.NewLevelLogger(nexus.NewLogger(e.Logger()), lvl)),
		)
	}
```

First run `go doc github.com/xraph/forge Logger` and `go doc github.com/xraph/nexus NewLogger`. If `forge.Logger` is not assignable to the `golog.Logger` that `nexus.NewLogger` takes, add this adapter to `extension/extension.go` instead and use `nexus.NewLevelLogger(forgeLogger{e.Logger()}, lvl)`:

```go
// forgeLogger adapts the extension's forge logger to nexus.Logger. Arguments
// come in key/value pairs.
type forgeLogger struct{ l forge.Logger }

func (f forgeLogger) fields(args []any) []forge.Field {
	var out []forge.Field
	for i := 0; i+1 < len(args); i += 2 {
		if k, ok := args[i].(string); ok {
			out = append(out, forge.F(k, args[i+1]))
		}
	}
	return out
}

func (f forgeLogger) Debug(msg string, args ...any) { f.l.Debug(msg, f.fields(args)...) }
func (f forgeLogger) Info(msg string, args ...any)  { f.l.Info(msg, f.fields(args)...) }
func (f forgeLogger) Warn(msg string, args ...any)  { f.l.Warn(msg, f.fields(args)...) }
func (f forgeLogger) Error(msg string, args ...any) { f.l.Error(msg, f.fields(args)...) }
```

(and check `forge.F`'s return type name with `go doc github.com/xraph/forge F`; use that type in place of `forge.Field`.)

The anonymous `func(gw *nexus.Gateway)` option works because `nexus.Option` is `func(*Gateway)`; if lint objects, add a `nexus.WithLogLevel(level string) Option` that sets `gw.config.LogLevel` and use it.

- [ ] **Step 5: Run, lint, commit**

```bash
go test . ./extension/ ./pipeline/... -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go build -o /dev/null ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add wiring_test.go extension/config_passthrough_test.go
git commit --only -m "feat(nexus)!: build the services the gateway declares and wire the pipeline in order

Initialize now builds the tenant, key and usage services from the store, so
Tenants, Keys and Usage stop returning nil and the admin API stops
answering 501. The default pipeline runs request id, tracing, usage,
timeout, identity and stream lifecycle outside the guards, cache and retry,
with the provider call last. The headers stage is gone: it only wrote to
State, which nothing read. enable_usage, enable_cache and log_level reach
the gateway, Shutdown waits for usage records in flight, and the gateway
reports its strategy, aliases, transforms, stages and insert failures." -- nexus.go options.go logger.go wiring_test.go pipeline/middlewares/headers.go pipeline/middlewares/stream_lifecycle.go extension/extension.go extension/config_passthrough_test.go
git show --stat HEAD
```

---

### Task 9: One request through the whole gateway, the docs, and the gate

**Files:**
- Create: `gateway_usage_test.go` (package `nexus_test`)
- Modify: `docs/content/docs/api-reference/http-api.mdx`, `docs/content/docs/infrastructure/observability.mdx`, `docs/content/docs/architecture.mdx` (nexus repo docs site)
- Modify: `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md` (forge-dashboard)

**Interfaces:**
- Consumes: the whole slice.
- Produces: the test that would have caught the dead pipeline; corrected docs; the hand-off section for slice 3.

- [ ] **Step 1: Write the gateway-level tests**

`gateway_usage_test.go`. One fake provider in the file, configurable per test:

```go
package nexus_test

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	nexus "github.com/xraph/nexus"
	"github.com/xraph/nexus/cache"
	"github.com/xraph/nexus/cache/stores"
	"github.com/xraph/nexus/guard"
	"github.com/xraph/nexus/id"
	"github.com/xraph/nexus/money"
	"github.com/xraph/nexus/pipeline"
	"github.com/xraph/nexus/provider"
	"github.com/xraph/nexus/store"
	"github.com/xraph/nexus/usage"
)

type fakeProvider struct {
	name     string
	price    provider.Pricing
	failures int // fail this many Complete calls first
	calls    int
	stream   []*provider.StreamChunk
}

func (f *fakeProvider) Name() string { return f.name }
func (f *fakeProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Chat: true, Streaming: true, Embeddings: true}
}
func (f *fakeProvider) Models(context.Context) ([]provider.Model, error) {
	return []provider.Model{{ID: "gpt-4o", Provider: f.name, Pricing: f.price}, {ID: "embed-small", Provider: f.name, Pricing: provider.Pricing{EmbeddingPerMillion: money.MustParse("0.02")}}}, nil
}
func (f *fakeProvider) Complete(_ context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	f.calls++
	if f.calls <= f.failures {
		return nil, errors.New("upstream 502")
	}
	return &provider.CompletionResponse{Provider: f.name, Model: req.Model,
		Choices: []provider.Choice{{Message: provider.Message{Role: "assistant", Content: "hello"}}},
		Usage:   provider.Usage{PromptTokens: 1234, CompletionTokens: 567, TotalTokens: 1801}}, nil
}
func (f *fakeProvider) CompleteStream(context.Context, *provider.CompletionRequest) (provider.Stream, error) {
	return &sliceStream{chunks: f.stream}, nil
}
func (f *fakeProvider) Embed(_ context.Context, req *provider.EmbeddingRequest) (*provider.EmbeddingResponse, error) {
	return &provider.EmbeddingResponse{Provider: f.name, Model: req.Model, Usage: provider.Usage{PromptTokens: 5000, TotalTokens: 5000}}, nil
}
func (f *fakeProvider) Healthy(context.Context) bool { return true }

type sliceStream struct {
	chunks []*provider.StreamChunk
	i      int
}

func (s *sliceStream) Next(context.Context) (*provider.StreamChunk, error) {
	if s.i >= len(s.chunks) {
		return nil, io.EOF
	}
	s.i++
	return s.chunks[s.i-1], nil
}
func (s *sliceStream) Close() error           { return nil }
func (s *sliceStream) Usage() *provider.Usage { return nil }

var listPrice = provider.Pricing{InputPerMillion: money.MustParse("2.50"), OutputPerMillion: money.MustParse("10")}

// gateway builds a real gateway over a memory store, runs fn, shuts it down
// (which flushes usage) and returns every stored record.
func gateway(t *testing.T, fn func(ctx context.Context, gw *nexus.Gateway), opts ...nexus.Option) []*usage.Record {
	t.Helper()
	s := store.NewMemory()
	gw := nexus.New(append([]nexus.Option{nexus.WithDatabase(s)}, opts...)...)
	if err := gw.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	fn(context.Background(), gw)
	if err := gw.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	res, err := s.Usage().Query(context.Background(), &usage.QueryOptions{Limit: 100})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	return res.Items
}

func TestACompletionIsRecordedPricedAndAttributed(t *testing.T) {
	tenant, key := id.NewTenantID().String(), id.NewKeyID().String()
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		_, err := gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o", TenantID: tenant, KeyID: key,
			Messages: []provider.Message{{Role: "user", Content: "hi"}}})
		if err != nil {
			t.Fatalf("complete: %v", err)
		}
	}, nexus.WithProvider(&fakeProvider{name: "openai", price: listPrice}))
	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}
	r := recs[0]
	if r.CostUSD == nil || r.CostUSD.String() != "0.008755" || r.PricingStatus != usage.PricingPriced || r.Outcome != usage.OutcomeOK {
		t.Fatalf("record = cost %v status %s outcome %s", r.CostUSD, r.PricingStatus, r.Outcome)
	}
	if r.TenantID.String() != tenant || r.KeyID.String() != key || r.RequestID.IsNil() || r.Provider != "openai" || r.Model != "gpt-4o" || r.Latency <= 0 {
		t.Fatalf("attribution = %+v", r)
	}
}

func TestTheSameModelIsPricedAtTheProviderThatServedIt(t *testing.T) {
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		_, _ = gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o", Messages: []provider.Message{{Role: "user", Content: "hi"}}})
	}, nexus.WithProvider(&fakeProvider{name: "openrouter", price: provider.Pricing{InputPerMillion: money.MustParse("3"), OutputPerMillion: money.MustParse("12")}}))
	// 1234 × 3 / 1e6 + 567 × 12 / 1e6
	if len(recs) != 1 || recs[0].CostUSD == nil || recs[0].CostUSD.String() != "0.010506" {
		t.Fatalf("records = %+v", recs)
	}
}

func TestACacheHitIsRecordedAndTenantsDoNotShare(t *testing.T) {
	a, b := id.NewTenantID().String(), id.NewTenantID().String()
	p := &fakeProvider{name: "openai", price: listPrice}
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		for _, tenant := range []string{a, a, b} {
			_, err := gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o", TenantID: tenant, Messages: []provider.Message{{Role: "user", Content: "same"}}})
			if err != nil {
				t.Fatalf("complete: %v", err)
			}
		}
	}, nexus.WithProvider(p), nexus.WithCache(stores.NewMemory()))
	if p.calls != 2 {
		t.Fatalf("provider called %d times; tenant A's second request should hit the cache and tenant B's should not", p.calls)
	}
	var hits int
	for _, r := range recs {
		if r.Outcome == usage.OutcomeCached {
			hits++
			if r.CostUSD == nil || !r.CostUSD.IsZero() || r.TenantID.String() != a {
				t.Fatalf("cache hit record = %+v", r)
			}
		}
	}
	if len(recs) != 3 || hits != 1 {
		t.Fatalf("records %d, cache hits %d", len(recs), hits)
	}
}

type blockAll struct{ phase guard.Phase }

func (b blockAll) Name() string       { return "policy" }
func (b blockAll) Phase() guard.Phase { return b.phase }
func (b blockAll) Check(context.Context, *guard.CheckInput) (*guard.CheckResult, error) {
	return &guard.CheckResult{Blocked: true, Action: guard.ActionBlock, Reason: "not allowed"}, nil
}

func TestGuardBlocksAreRecordedWithTheGuardsName(t *testing.T) {
	for _, c := range []struct {
		phase    guard.Phase
		status   usage.PricingStatus
		wantCost string
	}{
		{guard.PhaseInput, usage.PricingNotCharged, "0"},
		{guard.PhaseOutput, usage.PricingPriced, "0.008755"},
	} {
		recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
			_, err := gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o", Messages: []provider.Message{{Role: "user", Content: "hi"}}})
			var blocked *guard.BlockedError
			if !errors.As(err, &blocked) {
				t.Fatalf("%s: err = %v", c.phase, err)
			}
		}, nexus.WithProvider(&fakeProvider{name: "openai", price: listPrice}), nexus.WithGuard(blockAll{c.phase}))
		if len(recs) != 1 || recs[0].Outcome != usage.OutcomeBlocked || recs[0].BlockedBy != "policy" || recs[0].PricingStatus != c.status || recs[0].CostUSD == nil || recs[0].CostUSD.String() != c.wantCost {
			t.Fatalf("%s: records = %+v", c.phase, recs)
		}
	}
}

func TestARetriedRequestIsRecordedOnce(t *testing.T) {
	p := &fakeProvider{name: "openai", price: listPrice, failures: 2}
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		if _, err := gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o", Messages: []provider.Message{{Role: "user", Content: "hi"}}}); err != nil {
			t.Fatalf("complete after retries: %v", err)
		}
	}, nexus.WithProvider(p), nexus.WithMaxRetries(2))
	if p.calls != 3 || len(recs) != 1 || recs[0].Outcome != usage.OutcomeOK {
		t.Fatalf("calls %d, records %+v", p.calls, recs)
	}
}

func TestFailuresSayWhetherAProviderWasCalled(t *testing.T) {
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		_, _ = gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o"})
	}, nexus.WithProvider(&fakeProvider{name: "openai", price: listPrice, failures: 99}), nexus.WithMaxRetries(0))
	if len(recs) != 1 || recs[0].Outcome != usage.OutcomeError || recs[0].PricingStatus != usage.PricingUnknown || recs[0].CostUSD != nil {
		t.Fatalf("provider failure = %+v", recs)
	}
	recs = gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		_, _ = gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o"})
	})
	if len(recs) != 1 || recs[0].PricingStatus != usage.PricingNotCharged || recs[0].CostUSD == nil || !recs[0].CostUSD.IsZero() {
		t.Fatalf("no provider registered = %+v", recs)
	}
}

func TestAStreamIsRecordedWhenClosed(t *testing.T) {
	u := &provider.Usage{PromptTokens: 100, CompletionTokens: 20, TotalTokens: 120}
	p := &fakeProvider{name: "openai", price: listPrice, stream: []*provider.StreamChunk{
		{Delta: provider.Delta{Content: "he"}}, {Delta: provider.Delta{Content: "llo"}}, {Kind: provider.EventUsage, Usage: u},
	}}
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		st, err := gw.Engine().CompleteStream(ctx, &provider.CompletionRequest{Model: "gpt-4o", Stream: true})
		if err != nil {
			t.Fatalf("stream: %v", err)
		}
		for {
			if _, err := st.Next(ctx); err != nil {
				break
			}
		}
		_ = st.Close()
	}, nexus.WithProvider(p))
	if len(recs) != 1 || recs[0].CostUSD == nil || recs[0].CostUSD.String() != "0.00045" || recs[0].TotalTokens != 120 {
		t.Fatalf("stream record = %+v", recs)
	}
}

func TestAnEmbeddingIsRecorded(t *testing.T) {
	recs := gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		if _, err := gw.Engine().Embed(ctx, &provider.EmbeddingRequest{Model: "embed-small", Input: []string{"x"}}); err != nil {
			t.Fatalf("embed: %v", err)
		}
	}, nexus.WithProvider(&fakeProvider{name: "openai", price: listPrice}))
	if len(recs) != 1 || recs[0].CostUSD == nil || recs[0].CostUSD.String() != "0.0001" {
		t.Fatalf("embedding record = %+v", recs)
	}
}

type countingMW struct{ n *int }

func (countingMW) Name() string  { return "custom" }
func (countingMW) Priority() int { return 400 }
func (c countingMW) Process(ctx context.Context, _ *pipeline.Request, next pipeline.NextFunc) (*pipeline.Response, error) {
	*c.n++
	return next(ctx)
}

func TestCustomMiddlewareAboveTheCallRunsPerAttempt(t *testing.T) {
	var n int
	gateway(t, func(ctx context.Context, gw *nexus.Gateway) {
		_, _ = gw.Engine().Complete(ctx, &provider.CompletionRequest{Model: "gpt-4o"})
	}, nexus.WithProvider(&fakeProvider{name: "openai", price: listPrice, failures: 1}), nexus.WithMaxRetries(1), nexus.WithMiddleware(countingMW{&n}))
	if n != 2 {
		t.Fatalf("custom middleware at 400 ran %d times; it must run once per attempt (it was dead before)", n)
	}
}

var _ = time.Second // keep the import if a test above stops using it
var _ = cache.Key
```

Remove the two `var _` lines if `time` and `cache` end up used or unused in a way lint dislikes; they are only a guard against an unused import while editing.

Run: `go test -race . -run 'Recorded|Priced|Cache|Guard|Retried|Failures|Stream|Embedding|Custom' -v`
Expected: PASS. If a test fails, the slice has a real gap: fix it in the task that owns the code (do not change the expectation) and note it in the hand-off.

The retry delay is 500 ms with backoff 2, so `TestARetriedRequestIsRecordedOnce` takes about 1.5 s. That is acceptable.

- [ ] **Step 2: Correct the docs**

In the nexus docs site:
- `docs/content/docs/api-reference/http-api.mdx` lines ~70 to 76 and `docs/content/docs/infrastructure/observability.mdx` lines ~41 to 47 promise `X-Nexus-Request-ID`, `X-Nexus-Provider`, `X-Nexus-Cache` and `X-Nexus-Latency` response headers. No handler ever set them. Replace each block with a short paragraph saying the gateway records the request id, provider, cache hit and latency on the usage record, and does not set response headers.
- `docs/content/docs/architecture.mdx` line ~43 lists "Headers (500)". Replace the pipeline list there with the order from Task 8's Interfaces section.

Do not touch the `X-Nexus-Stream-Format` request header lines; that header is real.

- [ ] **Step 3: The full gate**

```bash
export_vars='NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable" NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test"'
NEXUS_TEST_POSTGRES_DSN="postgres://postgres:nexus@localhost:55632/nexus?sslmode=disable" NEXUS_TEST_MONGO_URI="mongodb://localhost:57632/nexus_test" go test -race ./...
fail=0; for d in providers/*/ grpcsrv config _examples/live _examples/realtime; do (cd "$d" && go vet ./... && go test ./...) >/dev/null 2>&1 || { echo "FAIL $d"; fail=1; }; done; echo "nested fail=$fail"
(cd _examples/grpc && go vet ./... && go build -o /dev/null ./...) && echo "grpc example ok"
for d in providers/*/ grpcsrv _examples/grpc; do (cd "$d" && GOWORK=off go vet ./... >/dev/null 2>&1) || echo "GOWORK=off FAIL $d"; done
go vet ./_examples/multi-tenant/
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git status --short
```

Expected: all green, `nested fail=0`, no `GOWORK=off FAIL` line. A `GOWORK=off` failure means a nested module needs `GOWORK=off go mod tidy`: do it as its own `chore` commit, as slice 1 did.

- [ ] **Step 4: Commit the tests and docs**

```bash
git add gateway_usage_test.go
git commit --only -m "test(nexus): send real requests through the gateway and check what was recorded

Every usage test before drove a middleware in isolation, which is how a
pipeline that never ran its usage stage passed. These send completions,
streams, embeddings, cache hits, guard blocks, retries and failures through
Engine and a memory store and check the stored records. The docs stop
promising X-Nexus response headers that were never set." -- gateway_usage_test.go docs/content/docs/api-reference/http-api.mdx docs/content/docs/infrastructure/observability.mdx docs/content/docs/architecture.mdx
git show --stat HEAD
```

- [ ] **Step 5: Hand off to slice 3**

In forge-dashboard, in the spec:
1. Correct the slice 1 hand-off's "Amount precision" bullet: computed amounts are now rounded to 18 places in `PerMillion` (slice 2 Task 1), so the bound holds for every amount, parsed or computed.
2. Append `## What slice 2 found that slice 3 must know`, written with the `rex-voice` skill and then `humanizer` in embedded mode, no em dashes. Cover:
   - the new statuses `not_charged` and `unknown`, and the classification table from Task 7;
   - `pipeline.Refusal` is the interface slice 3's refusals implement, so the usage stage records them as `refused` at `$0`;
   - insert-error counting lives on the usage stage (`Gateway.UsageInsertErrors`), not on `usage.Service`, and why;
   - the identity stage refuses disagreeing or unparseable ids, and stages that wrap it read the request fields, not context;
   - the embeddings capability fix (`embed` to `embeddings`);
   - `Builder.Build` now returns an error and `NewHeaders` is gone (v1 breaks for `MIGRATION.md`);
   - local models cost exactly `$0` through `Pricing.Free` and `provider.FreeOfCharge`;
   - the stream lifecycle `QuotaResolver` is still unwired (slice 3);
   - anything the gateway-level tests in Task 9 turned up.

Commit that one path with `git add -f` and `git commit --only -m "docs: record what nexus slice 2 found" -- docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`.
