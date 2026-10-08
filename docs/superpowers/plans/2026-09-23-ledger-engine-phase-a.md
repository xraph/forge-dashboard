# Ledger Engine (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ledger's billing engine actually bill: redeem coupons, price tiered overage, charge seats, calculate tax, and invoke the plugin hooks that are registered today and never called.

**Architecture:** Three layers, bottom up. A pure pricing package (`invoice/pricing.go`) that does integer arithmetic with no store and no context. A persistence layer for coupon redemption across four store backends. An orchestration layer in `GenerateInvoice` that assembles base, overage, seat, discount and tax line items in that order. Nothing in this phase touches the dashboard.

**Tech Stack:** Go 1.26, standard library `testing` only (the repository has no testify and no testcontainers), `github.com/xraph/grove/migrate` for migrations, `modernc.org/sqlite` for in-process SQLite tests, `github.com/uptrace/bun` models for the SQL backends.

**Spec:** `docs/superpowers/specs/2026-09-23-ledger-dashboard-design.md` (in the `forge-dashboard` repository; this plan's code all lands in `forgery/ledger`)

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forgery/ledger`. Module `github.com/xraph/ledger`.
- All money arithmetic is integer. No `float64` anywhere in this phase, including in tests.
- Tests use the standard library only. No testify. Table-driven, matching `types/money_test.go`.
- `types.Money.Add` and `Subtract` **panic** on currency mismatch via `assertSameCurrency`. Any code path that combines two `Money` values from different sources must check currency first and return an error, never rely on the panic.
- `MaxRedemptions == 0` means unlimited redemptions.
- `PriceTier.UpTo <= 0` means unbounded. `-1` is the form the repository documents (README, docs/API.md, docs_test.go); `0` is accepted too. (Corrected during Tasks 2+3 review: the first draft said only `0`.)
- Tier positions count TOTAL period usage. `ComputeOverage(tiers, usage, included, ...)` honours the allowance without giving it twice: graduated is `price(usage) - price(included)`. A ladder with no unbounded tier extends its last tier. `included < 0` means unlimited. Callers must run `invoice.ValidateTiers` first. Full rules: ledger rulings R1-R7.
- Coupon stacking order: percentage coupons compute against subtotal first, then amount coupons subtract, then clamp at zero.
- Migration versions continue the existing series. Next free: `20240101000009` for postgres and sqlite, `20240101000008` for mongo (mongo has no `add_provider_columns`).
- Run `go build ./... && go test ./...` before every commit. Both must be clean.
- Commit messages follow the repository's conventional-commit style. No `Co-Authored-By` trailers.
- Tests in the repository root are `package ledger_test`, calling exported names as `ledger.New`, `ledger.WithPlugin`, `ledger.ErrCouponNotFound` and so on. `store/memory` imports `ledger`, so an internal `package ledger` test that imports it is an import cycle. Any code block below written as `package ledger` in a root `_test.go` file must be read with that correction. (Found in Task 7.)
- No em dashes (U+2014) anywhere: code comments, test names, commit messages or prose. The repository owner forbids them. Use a comma, colon, full stop or parentheses. (Added during Task 9.)
- **Never `git add -A` or `git add .`** in this repository. It carries three untracked files that are not part of this work: `IMPLEMENTATION_PLAN.md`, `_project-files/` and `implement_all.sh`. Stage explicit paths, every time. `IMPLEMENTATION_PLAN.md` is committed deliberately, once, by Task 11 and by nothing else.

## Unresolved: sub-cent unit pricing

`_project-files/ledger-design.md:1105` gives the graduated worked example as
`6000 units = (1000 * $0.01) + (4000 * $0.005) + (1000 * $0.002) = $32.00`.

`PriceTier.UnitAmount` is `types.Money`, which is integer minor units, so
`$0.005` and `$0.002` are not representable. Stripe solves this with
`unit_amount_decimal`; Ledger has no equivalent.

**This plan assumes whole minor units** and uses a restated example whose
arithmetic is exact: `6000 units = (1000 * 3c) + (4000 * 2c) + (1000 * 1c) =
$12.00`. The sub-cent limitation is recorded as a documented constraint in
Task 3 rather than worked around.

Adding a scaled unit price is a change to `types.Money` that affects every
price in the system and belongs in its own spec. **Do not invent one here.**

## Review Focus

Five failure modes the spec implies and no single task's happy path exercises. Each has its test assigned to the task that owns the code.

1. **A coupon in a different currency from the invoice.** `Money.Subtract` panics rather than erroring, so a mismatched coupon would take down the caller. Expected: `ApplyCoupon` rejects it with `ErrCouponInvalid` and `GenerateInvoice` never sees it. Test in Task 7.
2. **A discount larger than the subtotal.** Expected: total clamps at zero, never negative, and the discount line item still records the full coupon value. Test in Task 9.
3. **A `TaxCalculator` returning something that is not `types.Money`.** The interface returns `interface{}`, so a broken plugin silently contributes nothing today. Expected: the type assertion fails loudly and invoice generation returns an error naming the plugin. Test in Task 9.
4. **Usage below the included limit.** `ComputeOverage` must return zero, not a negative amount and not the first tier's flat fee. Test in Task 2.
5. **A plan feature with no matching tier.** Expected: zero, and generation continues rather than erroring, because a metered feature with no tier priced is a catalogue gap and not a billing failure. Test in Task 3.

---

### Task 0: A store conformance harness

The repository has three test files and none of them touch persistence. Every
task after this one adds behaviour to four store backends, and without a
harness only the in-memory one can be checked. That is the arrangement where
every developer sees behaviour no production deployment has.

This task builds the harness first, so Tasks 4 through 6 land with real
coverage rather than a compile-time assertion and a note of regret.

**The construction recipe below is verified, not inferred.** It was run
against this repository before this plan was written. The blank import of
`sqlitemigrate` is the part that is not guessable: without it `Migrate`
fails with `no executor registered for driver "sqlite"`.

**Files:**
- Create: `store/storetest/storetest.go`
- Create: `store/storetest/harness.go`
- Create: `store/memory/conformance_test.go`
- Create: `store/sqlite/conformance_test.go`
- Create: `store/postgres/conformance_test.go`
- Create: `store/mongo/conformance_test.go`

**Interfaces:**
- Consumes: `store.Store`, and each backend's constructor.
- Produces:
  - `func storetest.Run(t *testing.T, newStore func(t *testing.T) store.Store)` — runs every conformance subtest against the supplied store.
  - `func storetest.NewSQLite(t *testing.T) store.Store` — an in-process SQLite store, migrated, cleaned up on test end.
  - `func storetest.NewPostgres(t *testing.T) store.Store` — reads `LEDGER_TEST_POSTGRES_DSN`, calls `t.Skip` when unset.
  - `func storetest.NewMongo(t *testing.T) store.Store` — reads `LEDGER_TEST_MONGO_URI`, calls `t.Skip` when unset.

**Coverage policy.** Memory and SQLite run on every `go test ./...` with no
setup. Postgres and Mongo run only when their environment variable names a
server, and skip with a message naming the variable otherwise. No Docker
dependency and no testcontainers: `go test ./...` must stay runnable on a
laptop with nothing installed, which is the property this repository has
today and should keep.

- [ ] **Step 1: Write the harness constructors**

Create `store/storetest/harness.go`:

```go
// Package storetest provides a conformance suite every store.Store
// implementation must pass, plus constructors for each backend.
//
// Memory and SQLite run in process and need no setup. Postgres and Mongo
// read a DSN from the environment and skip when it is absent, so
// `go test ./...` stays runnable with nothing installed.
package storetest

import (
	"context"
	"os"
	"testing"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/mongodriver"
	"github.com/xraph/grove/drivers/pgdriver"
	"github.com/xraph/grove/drivers/sqlitedriver"

	// Registers the migration executor for each driver. Without these
	// blank imports Migrate fails with "no executor registered for
	// driver". This is not discoverable from the driver's own API.
	_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate"

	ledgerstore "github.com/xraph/ledger/store"
	"github.com/xraph/ledger/store/memory"
	"github.com/xraph/ledger/store/mongo"
	"github.com/xraph/ledger/store/postgres"
	"github.com/xraph/ledger/store/sqlite"
)

// NewMemory returns an in-memory store. It never skips.
func NewMemory(t *testing.T) ledgerstore.Store {
	t.Helper()

	return memory.New()
}

// NewSQLite returns a migrated in-process SQLite store.
func NewSQLite(t *testing.T) ledgerstore.Store {
	t.Helper()
	ctx := context.Background()

	sdb := sqlitedriver.New()
	if err := sdb.Open(ctx, ":memory:"); err != nil {
		t.Fatalf("storetest: open sqlite driver: %v", err)
	}
	t.Cleanup(func() { _ = sdb.Close() })

	db, err := grove.Open(sdb)
	if err != nil {
		t.Fatalf("storetest: grove.Open: %v", err)
	}

	s := sqlite.New(db)
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("storetest: migrate sqlite: %v", err)
	}

	return s
}

// NewPostgres returns a migrated PostgreSQL store, or skips the test when
// LEDGER_TEST_POSTGRES_DSN is unset.
//
// The DSN's database is migrated in place and not torn down, so point it at
// a scratch database and not at anything you care about.
func NewPostgres(t *testing.T) ledgerstore.Store {
	t.Helper()

	dsn := os.Getenv("LEDGER_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("storetest: set LEDGER_TEST_POSTGRES_DSN to run the postgres conformance suite")
	}

	ctx := context.Background()

	pg := pgdriver.New()
	if err := pg.Open(ctx, dsn); err != nil {
		t.Fatalf("storetest: open postgres driver: %v", err)
	}
	t.Cleanup(func() { _ = pg.Close() })

	db, err := grove.Open(pg)
	if err != nil {
		t.Fatalf("storetest: grove.Open: %v", err)
	}

	s := postgres.New(db)
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("storetest: migrate postgres: %v", err)
	}

	return s
}

// NewMongo returns a migrated MongoDB store, or skips the test when
// LEDGER_TEST_MONGO_URI is unset.
func NewMongo(t *testing.T) ledgerstore.Store {
	t.Helper()

	uri := os.Getenv("LEDGER_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("storetest: set LEDGER_TEST_MONGO_URI to run the mongo conformance suite")
	}

	ctx := context.Background()

	md := mongodriver.New()
	if err := md.Open(ctx, uri); err != nil {
		t.Fatalf("storetest: open mongo driver: %v", err)
	}
	t.Cleanup(func() { _ = md.Close() })

	db, err := grove.Open(md)
	if err != nil {
		t.Fatalf("storetest: grove.Open: %v", err)
	}

	s := mongo.New(db)
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("storetest: migrate mongo: %v", err)
	}

	return s
}
```

The postgres and mongo driver packages may need their own migrate blank
imports, mirroring `sqlitemigrate`. Check for them:

Run: `ls $(go env GOMODCACHE)/github.com/xraph/grove/drivers/pgdriver@v1.6.3/ $(go env GOMODCACHE)/github.com/xraph/grove/drivers/mongodriver@v1.6.3/`

If a `pgmigrate` or `mongomigrate` subpackage exists, add its blank import
beside `sqlitemigrate`. Also confirm each driver's constructor is `New()` and
each store's is `New(db *grove.DB)`; correct the calls if not.

- [ ] **Step 2: Write the conformance suite**

Create `store/storetest/storetest.go` holding `Run`, which exercises the
behaviour every backend must share. Start with plan and coupon round trips,
because those are what Tasks 4 to 6 extend:

```go
package storetest

import (
	"context"
	"testing"

	"github.com/xraph/ledger/coupon"
	"github.com/xraph/ledger/id"
	ledgerstore "github.com/xraph/ledger/store"
	"github.com/xraph/ledger/plan"
	"github.com/xraph/ledger/types"
)

// Run executes the conformance suite against a store. newStore is called
// once per subtest so each starts from a clean database.
func Run(t *testing.T, newStore func(t *testing.T) ledgerstore.Store) {
	t.Helper()

	t.Run("PlanRoundTrip", func(t *testing.T) { testPlanRoundTrip(t, newStore(t)) })
	t.Run("CouponRoundTrip", func(t *testing.T) { testCouponRoundTrip(t, newStore(t)) })
	t.Run("GetCouponByIDUnknown", func(t *testing.T) { testGetCouponByIDUnknown(t, newStore(t)) })
}

func testPlanRoundTrip(t *testing.T, s ledgerstore.Store) {
	ctx := context.Background()

	p := &plan.Plan{
		Entity: types.NewEntity(), ID: id.NewPlanID(),
		Name: "Pro", Slug: "pro", Currency: "usd",
		Status: plan.StatusActive, AppID: "app_1",
		Pricing: &plan.Pricing{
			ID: id.NewPriceID(), BaseAmount: types.USD(4900),
			BillingPeriod: plan.PeriodMonthly,
		},
	}
	if err := s.CreatePlan(ctx, p); err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}

	got, err := s.GetPlan(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	if got.Slug != "pro" {
		t.Errorf("got slug %q, want pro", got.Slug)
	}
	if got.Pricing == nil {
		t.Fatal("Pricing did not survive the round trip")
	}
	if !got.Pricing.BaseAmount.Equal(types.USD(4900)) {
		t.Errorf("got base amount %v, want $49.00", got.Pricing.BaseAmount)
	}
}

func testCouponRoundTrip(t *testing.T, s ledgerstore.Store) {
	ctx := context.Background()

	c := &coupon.Coupon{
		Entity: types.NewEntity(), ID: id.NewCouponID(),
		Code: "LAUNCH10", Name: "Launch discount",
		Type: coupon.CouponTypePercentage, Percentage: 10,
		Currency: "usd", AppID: "app_1",
	}
	if err := s.CreateCoupon(ctx, c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}

	byID, err := s.GetCouponByID(ctx, c.ID)
	if err != nil {
		t.Fatalf("GetCouponByID: %v", err)
	}
	if byID.Code != "LAUNCH10" {
		t.Errorf("got code %q, want LAUNCH10", byID.Code)
	}

	byCode, err := s.GetCoupon(ctx, "LAUNCH10", "app_1")
	if err != nil {
		t.Fatalf("GetCoupon: %v", err)
	}
	if byCode.ID.String() != c.ID.String() {
		t.Errorf("got id %s, want %s", byCode.ID, c.ID)
	}
}

func testGetCouponByIDUnknown(t *testing.T, s ledgerstore.Store) {
	ctx := context.Background()

	if _, err := s.GetCouponByID(ctx, id.NewCouponID()); err == nil {
		t.Fatal("got nil error for an unknown coupon, want ErrCouponNotFound")
	}
}
```

- [ ] **Step 3: Wire each backend to the suite**

Create four one-line test files. `store/memory/conformance_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/ledger/store/storetest"
)

func TestConformance(t *testing.T) { storetest.Run(t, storetest.NewMemory) }
```

The other three are identical apart from the package name and the
constructor: `sqlite_test` with `storetest.NewSQLite`, `postgres_test` with
`storetest.NewPostgres`, `mongo_test` with `storetest.NewMongo`.

Use the `_test` external package suffix in all four. `storetest` imports
every backend, so an internal test package would import itself through
`storetest` and fail to compile with an import cycle.

- [ ] **Step 4: Run it**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./store/... -v`

Expected: memory and sqlite PASS every subtest. Postgres and mongo SKIP with
the message naming their environment variable.

Then confirm the opt-in path works against the postgres server on this
machine:

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && LEDGER_TEST_POSTGRES_DSN="postgres://localhost:5432/ledger_test?sslmode=disable" go test ./store/postgres/ -v`

If that database does not exist, create it first with `createdb ledger_test`,
or point the DSN at any scratch database. If the postgres run reveals a
divergence from sqlite, that is the harness doing its job: report it as a
finding rather than fixing the test to match.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add store/storetest/ store/memory/conformance_test.go store/sqlite/conformance_test.go store/postgres/conformance_test.go store/mongo/conformance_test.go
git commit -m "test(store): add a conformance harness covering all four backends"
```

---

### Task 1: `Money.Percent`

The discount path needs a percentage primitive. `types.Money` has `Multiply` and `Divide` but nothing that applies a percentage, and doing it inline in the invoice generator would put integer-truncation logic somewhere untested.

**Files:**
- Modify: `types/money.go` (add after `Divide`, around line 71)
- Test: `types/money_test.go` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `func (m Money) Percent(pct int) Money` — returns `pct` percent of `m`, truncating toward zero, preserving currency.

- [ ] **Step 1: Write the failing test**

Append to `types/money_test.go`:

```go
func TestMoneyPercent(t *testing.T) {
	tests := []struct {
		name string
		base Money
		pct  int
		want Money
	}{
		{"ten percent of $49.00", USD(4900), 10, USD(490)},
		{"twenty-five percent of $49.00", USD(4900), 25, USD(1225)},
		{"zero percent", USD(4900), 0, USD(0)},
		{"one hundred percent", USD(4900), 100, USD(4900)},
		{"over one hundred percent", USD(4900), 150, USD(7350)},
		{"truncates rather than rounds", USD(101), 10, USD(10)},
		{"negative percent negates", USD(4900), -10, USD(-490)},
		// These two discriminate toward-zero from floor: a floor
		// implementation returns -11 for both. The case above divides
		// exactly, so on its own it pins no direction at all.
		{"negative percent truncates toward zero", USD(101), -10, USD(-10)},
		{"negative amount truncates toward zero", USD(-101), 10, USD(-10)},
		{"preserves currency", EUR(19900), 50, EUR(9950)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.base.Percent(tt.pct)
			if !got.Equal(tt.want) {
				t.Errorf("Percent(%d): got %v, want %v", tt.pct, got, tt.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./types/ -run TestMoneyPercent -v`

Expected: FAIL to compile, `m.Percent undefined (type Money has no field or method Percent)`.

- [ ] **Step 3: Write minimal implementation**

In `types/money.go`, after `Divide`:

```go
// Percent returns pct percent of the Money value.
//
// Integer-only, truncating toward zero: 10% of 101 cents is 10 cents, and
// 10% of -101 cents is -10 cents, not -11. Magnitude is never rounded up,
// whatever the sign. Callers that need the remainder must compute it
// themselves.
func (m Money) Percent(pct int) Money {
	return Money{Amount: m.Amount * int64(pct) / 100, Currency: m.Currency}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./types/ -run TestMoneyPercent -v`

Expected: PASS, all 10 subtests.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add types/money.go types/money_test.go
git commit -m "feat(types): add Money.Percent for discount arithmetic"
```

---

### Task 2: Tier sorting and graduated pricing

Creates the pricing package with the tier ordering rules and the graduated algorithm. Graduated is the subtle one: each tier charges only for the units that fall inside its own range.

**Files:**
- Create: `invoice/pricing.go`
- Create: `invoice/pricing_test.go`

**Interfaces:**
- Consumes: `plan.PriceTier`, `plan.TierType`, `types.Money`, `types.Zero`.
- Produces:
  - `func SortTiers(tiers []plan.PriceTier) []plan.PriceTier` — returns a new slice ordered by `UpTo` ascending with `UpTo == 0` last, `Priority` ascending breaking ties. Does not mutate the input.
  - `func computeGraduated(tiers []plan.PriceTier, qty int64, currency string) types.Money` — unexported, assumes tiers are already sorted.

**Note on imports:** `invoice` must not import `plan`'s parent. `plan` does not import `invoice`, so `invoice` importing `plan` introduces no cycle. Verify with `go build ./...`.

- [ ] **Step 1: Write the failing test**

Create `invoice/pricing_test.go`:

```go
package invoice

import (
	"testing"

	"github.com/xraph/ledger/plan"
	"github.com/xraph/ledger/types"
)

// tier is a terse constructor so the tables below read as pricing rather
// than as struct literals.
func tier(upTo int64, unitCents int64, priority int) plan.PriceTier {
	return plan.PriceTier{
		FeatureKey: "api_calls",
		Type:       plan.TierGraduated,
		UpTo:       upTo,
		UnitAmount: types.USD(unitCents),
		FlatAmount: types.USD(0),
		Priority:   priority,
	}
}

func TestSortTiers(t *testing.T) {
	t.Run("orders by UpTo ascending", func(t *testing.T) {
		in := []plan.PriceTier{tier(5000, 2, 0), tier(1000, 3, 0)}
		got := SortTiers(in)
		if got[0].UpTo != 1000 || got[1].UpTo != 5000 {
			t.Errorf("got order [%d %d], want [1000 5000]", got[0].UpTo, got[1].UpTo)
		}
	})

	t.Run("UpTo zero sorts last as unbounded", func(t *testing.T) {
		in := []plan.PriceTier{tier(0, 1, 0), tier(1000, 3, 0), tier(5000, 2, 0)}
		got := SortTiers(in)
		if got[2].UpTo != 0 {
			t.Errorf("unbounded tier at index 2: got UpTo %d, want 0", got[2].UpTo)
		}
	})

	t.Run("Priority breaks ties", func(t *testing.T) {
		in := []plan.PriceTier{tier(1000, 3, 5), tier(1000, 9, 1)}
		got := SortTiers(in)
		if got[0].Priority != 1 {
			t.Errorf("got first Priority %d, want 1", got[0].Priority)
		}
	})

	t.Run("does not mutate the input", func(t *testing.T) {
		in := []plan.PriceTier{tier(5000, 2, 0), tier(1000, 3, 0)}
		_ = SortTiers(in)
		if in[0].UpTo != 5000 {
			t.Errorf("input was mutated: got UpTo %d at index 0, want 5000", in[0].UpTo)
		}
	})
}

func TestComputeGraduated(t *testing.T) {
	// Restated from _project-files/ledger-design.md:1105 in whole minor
	// units, because types.Money cannot express the sub-cent rates the
	// original example used. See "Unresolved: sub-cent unit pricing".
	//
	//   first 1000 at 3c  = $30.00
	//   next  4000 at 2c  = $80.00
	//   above 5000 at 1c  = $10.00 for 1000 units
	//   6000 units        = $120.00
	ladder := []plan.PriceTier{tier(1000, 3, 0), tier(5000, 2, 0), tier(0, 1, 0)}

	tests := []struct {
		name string
		qty  int64
		want types.Money
	}{
		{"zero quantity", 0, types.USD(0)},
		{"inside the first tier", 500, types.USD(1500)},
		{"exactly the first tier boundary", 1000, types.USD(3000)},
		{"spanning two tiers", 3000, types.USD(3000 + 4000)},
		{"the worked example", 6000, types.USD(12000)},
		{"deep into the unbounded tier", 10000, types.USD(3000 + 8000 + 5000)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeGraduated(SortTiers(ladder), tt.qty, "usd")
			if !got.Equal(tt.want) {
				t.Errorf("computeGraduated(%d): got %v, want %v", tt.qty, got, tt.want)
			}
		})
	}
}

// Review Focus 4: usage below the included limit must be free.
func TestComputeGraduatedZeroAndNegativeQuantity(t *testing.T) {
	ladder := []plan.PriceTier{tier(1000, 3, 0), tier(0, 1, 0)}

	for _, qty := range []int64{0, -1, -5000} {
		got := computeGraduated(SortTiers(ladder), qty, "usd")
		if !got.IsZero() {
			t.Errorf("computeGraduated(%d): got %v, want zero", qty, got)
		}
		if got.IsNegative() {
			t.Errorf("computeGraduated(%d): returned a negative charge %v", qty, got)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./invoice/ -v`

Expected: FAIL to compile, `undefined: SortTiers` and `undefined: computeGraduated`.

- [ ] **Step 3: Write minimal implementation**

Create `invoice/pricing.go`:

```go
package invoice

import (
	"sort"

	"github.com/xraph/ledger/plan"
	"github.com/xraph/ledger/types"
)

// SortTiers returns tiers ordered for evaluation: by UpTo ascending, with
// an UpTo of zero treated as unbounded and sorted last, and Priority
// breaking ties.
//
// The input is not mutated. Callers hold tiers that belong to a stored
// plan, and reordering that slice in place would rewrite the plan's own
// view of its pricing.
func SortTiers(tiers []plan.PriceTier) []plan.PriceTier {
	out := make([]plan.PriceTier, len(tiers))
	copy(out, tiers)

	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		switch {
		case a.UpTo == 0 && b.UpTo == 0:
			return a.Priority < b.Priority
		case a.UpTo == 0:
			return false
		case b.UpTo == 0:
			return true
		case a.UpTo != b.UpTo:
			return a.UpTo < b.UpTo
		default:
			return a.Priority < b.Priority
		}
	})

	return out
}

// computeGraduated charges each tier for the units that fall inside its own
// range. 6000 units against a 1000/5000/unbounded ladder pays the first
// tier's rate for 1000 units, the second's for 4000, and the third's for
// the remaining 1000.
//
// tiers must already be sorted by SortTiers.
func computeGraduated(tiers []plan.PriceTier, qty int64, currency string) types.Money {
	total := types.Zero(currency)
	if qty <= 0 {
		return total
	}

	var consumed int64
	for _, t := range tiers {
		if consumed >= qty {
			break
		}

		// The number of units this tier can absorb. An UpTo of zero is
		// unbounded, so it takes everything that is left.
		var capacity int64
		if t.UpTo == 0 {
			capacity = qty - consumed
		} else {
			capacity = t.UpTo - consumed
		}
		if capacity <= 0 {
			continue
		}

		units := capacity
		if remaining := qty - consumed; remaining < units {
			units = remaining
		}

		total = total.Add(types.Money{
			Amount:   t.UnitAmount.Amount * units,
			Currency: currency,
		})
		consumed += units
	}

	return total
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./invoice/ -v`

Expected: PASS. `TestSortTiers` 4 subtests, `TestComputeGraduated` 6 subtests, `TestComputeGraduatedZeroAndNegativeQuantity` passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add invoice/pricing.go invoice/pricing_test.go
git commit -m "feat(invoice): add tier ordering and graduated overage pricing"
```

---

### Task 3: Volume, flat, and the `ComputeOverage` dispatcher

Completes the three tier types and adds the public entry point the invoice generator calls. Volume applies one tier's rate to every unit. Flat is a fee for reaching a tier rather than a per-unit rate.

**Files:**
- Modify: `invoice/pricing.go` (append)
- Modify: `invoice/pricing_test.go` (append)

**Interfaces:**
- Consumes: `SortTiers`, `computeGraduated` from Task 2.
- Produces:
  - `func computeVolume(tiers []plan.PriceTier, qty int64, currency string) types.Money`
  - `func computeFlat(tiers []plan.PriceTier, qty int64, currency string) types.Money`
  - `func ComputeOverage(tiers []plan.PriceTier, usage, included int64, currency string) types.Money` — filters to the billable quantity (`usage - included`, floored at zero), dispatches on the first tier's `Type`, and returns zero when `tiers` is empty.

- [ ] **Step 1: Write the failing test**

Append to `invoice/pricing_test.go`:

```go
func volumeTier(upTo, unitCents int64) plan.PriceTier {
	t := tier(upTo, unitCents, 0)
	t.Type = plan.TierVolume
	return t
}

func flatTier(upTo, flatCents int64) plan.PriceTier {
	t := tier(upTo, 0, 0)
	t.Type = plan.TierFlat
	t.FlatAmount = types.USD(flatCents)
	return t
}

func TestComputeVolume(t *testing.T) {
	// The tier covering the total quantity applies to ALL units.
	ladder := []plan.PriceTier{volumeTier(1000, 3), volumeTier(5000, 2), volumeTier(0, 1)}

	tests := []struct {
		name string
		qty  int64
		want types.Money
	}{
		{"zero quantity", 0, types.USD(0)},
		{"lands in the first tier", 500, types.USD(1500)},
		{"lands in the second tier, priced whole", 3000, types.USD(6000)},
		{"boundary belongs to the tier it names", 1000, types.USD(3000)},
		{"lands in the unbounded tier", 10000, types.USD(10000)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeVolume(SortTiers(ladder), tt.qty, "usd")
			if !got.Equal(tt.want) {
				t.Errorf("computeVolume(%d): got %v, want %v", tt.qty, got, tt.want)
			}
		})
	}
}

func TestComputeFlat(t *testing.T) {
	// A fee for reaching a tier, not a per-unit rate.
	ladder := []plan.PriceTier{flatTier(1000, 500), flatTier(5000, 2000), flatTier(0, 9000)}

	tests := []struct {
		name string
		qty  int64
		want types.Money
	}{
		{"zero quantity pays nothing", 0, types.USD(0)},
		{"first tier", 500, types.USD(500)},
		{"second tier", 3000, types.USD(2000)},
		{"unbounded tier", 99999, types.USD(9000)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeFlat(SortTiers(ladder), tt.qty, "usd")
			if !got.Equal(tt.want) {
				t.Errorf("computeFlat(%d): got %v, want %v", tt.qty, got, tt.want)
			}
		})
	}
}

func TestComputeOverage(t *testing.T) {
	ladder := []plan.PriceTier{tier(1000, 3, 0), tier(0, 1, 0)}

	tests := []struct {
		name     string
		tiers    []plan.PriceTier
		usage    int64
		included int64
		want     types.Money
	}{
		{"usage under the included limit is free", ladder, 400, 1000, types.USD(0)},
		{"usage exactly at the limit is free", ladder, 1000, 1000, types.USD(0)},
		{"only the excess is billed", ladder, 1500, 1000, types.USD(1500)},
		{"no included allowance bills everything", ladder, 500, 0, types.USD(1500)},
		// Review Focus 5: a metered feature with no tier priced is a
		// catalogue gap, not a billing failure.
		{"no tiers bills nothing", nil, 9999, 0, types.USD(0)},
		{"empty tier slice bills nothing", []plan.PriceTier{}, 9999, 0, types.USD(0)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ComputeOverage(tt.tiers, tt.usage, tt.included, "usd")
			if !got.Equal(tt.want) {
				t.Errorf("ComputeOverage(usage=%d, included=%d): got %v, want %v",
					tt.usage, tt.included, got, tt.want)
			}
		})
	}
}

func TestComputeOverageDispatchesOnTierType(t *testing.T) {
	// Same ladder shape, three types, three answers. 3000 billable units.
	graduated := []plan.PriceTier{tier(1000, 3, 0), tier(0, 2, 0)}
	volume := []plan.PriceTier{volumeTier(1000, 3), volumeTier(0, 2)}
	flat := []plan.PriceTier{flatTier(1000, 300), flatTier(0, 700)}

	cases := []struct {
		name  string
		tiers []plan.PriceTier
		want  types.Money
	}{
		{"graduated", graduated, types.USD(3000 + 4000)},
		{"volume", volume, types.USD(6000)},
		{"flat", flat, types.USD(700)},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ComputeOverage(c.tiers, 3000, 0, "usd")
			if !got.Equal(c.want) {
				t.Errorf("%s: got %v, want %v", c.name, got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./invoice/ -v`

Expected: FAIL to compile, `undefined: computeVolume`, `undefined: computeFlat`, `undefined: ComputeOverage`.

- [ ] **Step 3: Write minimal implementation**

Append to `invoice/pricing.go`:

```go
// computeVolume applies the rate of the tier covering the total quantity to
// every unit. 3000 units against a tier covering up to 5000 pays 3000 times
// that tier's rate, not a blend.
//
// tiers must already be sorted by SortTiers.
func computeVolume(tiers []plan.PriceTier, qty int64, currency string) types.Money {
	total := types.Zero(currency)
	if qty <= 0 {
		return total
	}

	for _, t := range tiers {
		if t.UpTo == 0 || qty <= t.UpTo {
			return types.Money{Amount: t.UnitAmount.Amount * qty, Currency: currency}
		}
	}

	return total
}

// computeFlat charges the flat fee attached to the tier the quantity reaches.
// It is a fee for being in a band, not a per-unit rate, so the quantity
// selects a tier and is then discarded.
//
// tiers must already be sorted by SortTiers.
func computeFlat(tiers []plan.PriceTier, qty int64, currency string) types.Money {
	total := types.Zero(currency)
	if qty <= 0 {
		return total
	}

	for _, t := range tiers {
		if t.UpTo == 0 || qty <= t.UpTo {
			return types.Money{Amount: t.FlatAmount.Amount, Currency: currency}
		}
	}

	return total
}

// ComputeOverage prices the billable excess of usage over an included
// allowance, using whichever tier model the plan declares.
//
// All arithmetic is integer. UnitAmount and FlatAmount are whole minor
// units, so a rate below one cent per unit cannot be expressed. Plans that
// need sub-cent unit pricing need a scaled money type, which is a change to
// types.Money and out of scope here.
//
// An empty tier slice prices at zero. A metered feature whose plan declares
// no tiers is a gap in the catalogue, and failing invoice generation over it
// would block billing for every other feature on the plan.
func ComputeOverage(tiers []plan.PriceTier, usage, included int64, currency string) types.Money {
	if len(tiers) == 0 {
		return types.Zero(currency)
	}

	billable := usage - included
	if billable <= 0 {
		return types.Zero(currency)
	}

	sorted := SortTiers(tiers)

	switch sorted[0].Type {
	case plan.TierVolume:
		return computeVolume(sorted, billable, currency)
	case plan.TierFlat:
		return computeFlat(sorted, billable, currency)
	case plan.TierGraduated:
		return computeGraduated(sorted, billable, currency)
	default:
		// An unrecognised tier type prices at zero rather than guessing.
		return types.Zero(currency)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./invoice/ -v`

Expected: PASS. All of `TestComputeVolume` (5), `TestComputeFlat` (4), `TestComputeOverage` (6), `TestComputeOverageDispatchesOnTierType` (3).

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add invoice/pricing.go invoice/pricing_test.go
git commit -m "feat(invoice): price volume and flat tiers behind ComputeOverage"
```

---

### Task 4: Coupon application model and the memory store

Introduces the redemption record the design doc specified and nobody built, plus the first of four backends. Memory comes first because it needs no database and gives the conformance suite something to run against immediately.

**Files:**
- Modify: `id/id.go` (add prefix + constructor near the existing ones, lines 27-36 and 155-179)
- Create: `coupon/application.go`
- Modify: `coupon/store.go` (extend the `Store` interface)
- Modify: `store/store.go` (extend the `Store` interface, coupon section around line 72)
- Modify: `store/memory/store.go` (struct field around line 40, `New` around line 54, methods after `DeleteCoupon` around line 521)
- Create: `store/memory/coupon_application_test.go`

**Interfaces:**
- Consumes: `types.Entity`, `id.ID`.
- Produces:
  - `id.PrefixCouponApplication Prefix = "cpna"` and `func NewCouponApplicationID() ID`
  - `type coupon.Application struct` with `ID id.CouponApplicationID`, `CouponID id.CouponID`, `SubscriptionID id.SubscriptionID`, `AppliedAt time.Time`
  - Three store methods, added to both `coupon.Store` and `store.Store`:
    - `ApplyCoupon(ctx context.Context, subID id.SubscriptionID, couponID id.CouponID) error`
    - `ListAppliedCoupons(ctx context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error)`
    - `IncrementCouponRedemptions(ctx context.Context, couponID id.CouponID) error`
  - `ledger.ErrCouponAlreadyApplied` in `errors.go`

**Naming note:** the design doc calls these `Apply` / `ListApplied` / `IncrementRedemptions` on the narrow `coupon.Store`. The unified `store.Store` explicitly declares every method to avoid collisions (see its own header comment), so the unified names carry the `Coupon` qualifier. Use the qualified names everywhere outside `coupon.Store` itself.

- [ ] **Step 1: Write the failing test**

Create `store/memory/coupon_application_test.go`:

```go
package memory

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/ledger/coupon"
	"github.com/xraph/ledger/id"
	"github.com/xraph/ledger/types"
)

func newCoupon(code string, appID string) *coupon.Coupon {
	return &coupon.Coupon{
		Entity:         types.NewEntity(),
		ID:             id.NewCouponID(),
		Code:           code,
		Name:           code,
		Type:           coupon.CouponTypePercentage,
		Percentage:     10,
		Currency:       "usd",
		MaxRedemptions: 0,
		AppID:          appID,
	}
}

func TestApplyCouponRecordsTheRedemption(t *testing.T) {
	ctx := context.Background()
	s := New()

	c := newCoupon("LAUNCH10", "app_1")
	if err := s.CreateCoupon(ctx, c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}

	subID := id.NewSubscriptionID()
	if err := s.ApplyCoupon(ctx, subID, c.ID); err != nil {
		t.Fatalf("ApplyCoupon: %v", err)
	}

	applied, err := s.ListAppliedCoupons(ctx, subID)
	if err != nil {
		t.Fatalf("ListAppliedCoupons: %v", err)
	}
	if len(applied) != 1 {
		t.Fatalf("got %d applied coupons, want 1", len(applied))
	}
	if applied[0].Code != "LAUNCH10" {
		t.Errorf("got code %q, want LAUNCH10", applied[0].Code)
	}
}

func TestApplyCouponIsIdempotentPerSubscription(t *testing.T) {
	ctx := context.Background()
	s := New()

	c := newCoupon("LAUNCH10", "app_1")
	if err := s.CreateCoupon(ctx, c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}

	subID := id.NewSubscriptionID()
	if err := s.ApplyCoupon(ctx, subID, c.ID); err != nil {
		t.Fatalf("first ApplyCoupon: %v", err)
	}

	err := s.ApplyCoupon(ctx, subID, c.ID)
	if err == nil {
		t.Fatal("second ApplyCoupon: got nil error, want a rejection")
	}

	applied, err := s.ListAppliedCoupons(ctx, subID)
	if err != nil {
		t.Fatalf("ListAppliedCoupons: %v", err)
	}
	if len(applied) != 1 {
		t.Errorf("got %d applied coupons after a duplicate apply, want 1", len(applied))
	}
}

func TestListAppliedCouponsIsScopedToOneSubscription(t *testing.T) {
	ctx := context.Background()
	s := New()

	c := newCoupon("LAUNCH10", "app_1")
	if err := s.CreateCoupon(ctx, c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}

	mine, theirs := id.NewSubscriptionID(), id.NewSubscriptionID()
	if err := s.ApplyCoupon(ctx, mine, c.ID); err != nil {
		t.Fatalf("ApplyCoupon: %v", err)
	}

	applied, err := s.ListAppliedCoupons(ctx, theirs)
	if err != nil {
		t.Fatalf("ListAppliedCoupons: %v", err)
	}
	if len(applied) != 0 {
		t.Errorf("got %d applied coupons on an untouched subscription, want 0", len(applied))
	}
}

func TestListAppliedCouponsOnUnknownSubscriptionIsEmptyNotAnError(t *testing.T) {
	ctx := context.Background()
	s := New()

	applied, err := s.ListAppliedCoupons(ctx, id.NewSubscriptionID())
	if err != nil {
		t.Fatalf("ListAppliedCoupons on an unknown subscription: %v", err)
	}
	if applied == nil {
		t.Error("got a nil slice, want an empty one: a caller ranging over nil sees no difference, but a caller checking len(x) == 0 against a nil map entry does")
	}
	if len(applied) != 0 {
		t.Errorf("got %d applied coupons, want 0", len(applied))
	}
}

func TestIncrementCouponRedemptions(t *testing.T) {
	ctx := context.Background()
	s := New()

	c := newCoupon("LAUNCH10", "app_1")
	if err := s.CreateCoupon(ctx, c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}

	for i := 1; i <= 3; i++ {
		if err := s.IncrementCouponRedemptions(ctx, c.ID); err != nil {
			t.Fatalf("IncrementCouponRedemptions call %d: %v", i, err)
		}

		got, err := s.GetCouponByID(ctx, c.ID)
		if err != nil {
			t.Fatalf("GetCouponByID: %v", err)
		}
		if got.TimesRedeemed != i {
			t.Errorf("after %d increments: got TimesRedeemed %d, want %d", i, got.TimesRedeemed, i)
		}
	}
}

func TestIncrementCouponRedemptionsOnUnknownCoupon(t *testing.T) {
	ctx := context.Background()
	s := New()

	err := s.IncrementCouponRedemptions(ctx, id.NewCouponID())
	if err == nil {
		t.Fatal("got nil error for an unknown coupon, want ErrCouponNotFound")
	}
}

func TestApplyCouponStampsAppliedAt(t *testing.T) {
	ctx := context.Background()
	s := New()

	c := newCoupon("LAUNCH10", "app_1")
	if err := s.CreateCoupon(ctx, c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}

	before := time.Now().UTC().Add(-time.Second)
	subID := id.NewSubscriptionID()
	if err := s.ApplyCoupon(ctx, subID, c.ID); err != nil {
		t.Fatalf("ApplyCoupon: %v", err)
	}
	after := time.Now().UTC().Add(time.Second)

	apps := s.couponApplicationsFor(subID)
	if len(apps) != 1 {
		t.Fatalf("got %d applications, want 1", len(apps))
	}
	if apps[0].AppliedAt.Before(before) || apps[0].AppliedAt.After(after) {
		t.Errorf("AppliedAt %v is outside [%v, %v]", apps[0].AppliedAt, before, after)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./store/memory/ -v`

Expected: FAIL to compile, `s.ApplyCoupon undefined`, `s.ListAppliedCoupons undefined`, `s.IncrementCouponRedemptions undefined`, `s.couponApplicationsFor undefined`.

- [ ] **Step 3: Write minimal implementation**

In `id/id.go`, add to the prefix block (after `PrefixPayment`):

```go
	PrefixCouponApplication Prefix = "cpna" // Coupon applied to a subscription
```

and alongside the other constructors:

```go
// NewCouponApplicationID returns a new random CouponApplicationID.
func NewCouponApplicationID() ID { return New(PrefixCouponApplication) }
```

Find the existing `CouponID` type alias near the other ID aliases and add beside it:

```go
// CouponApplicationID identifies one coupon's application to one subscription.
type CouponApplicationID = ID
```

Create `coupon/application.go`:

```go
package coupon

import (
	"time"

	"github.com/xraph/ledger/id"
)

// Application records that a coupon was applied to a subscription.
//
// The pair (CouponID, SubscriptionID) is unique: a coupon applies to a
// subscription once. Redemption counting lives on Coupon.TimesRedeemed and
// is incremented separately, because a store that fails partway through
// must not leave a count that no application row explains.
type Application struct {
	ID             id.CouponApplicationID `json:"id"`
	CouponID       id.CouponID            `json:"coupon_id"`
	SubscriptionID id.SubscriptionID      `json:"subscription_id"`
	AppliedAt      time.Time              `json:"applied_at"`
}
```

In `coupon/store.go`, extend the interface. Nothing in the repository
implements this narrow interface (the backends all implement the unified
`store.Store`), so extending it cannot break a build. It is kept accurate
because it is how the `coupon` package documents its own contract:

```go
	Apply(ctx context.Context, subID id.SubscriptionID, couponID id.CouponID) error
	ListApplied(ctx context.Context, subID id.SubscriptionID) ([]*Coupon, error)
	IncrementRedemptions(ctx context.Context, couponID id.CouponID) error
```

`coupon/store.go` will need `"github.com/xraph/ledger/id"` already imported; it is.

In `store/store.go`, in the coupon section:

```go
	ApplyCoupon(ctx context.Context, subID id.SubscriptionID, couponID id.CouponID) error
	ListAppliedCoupons(ctx context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error)
	IncrementCouponRedemptions(ctx context.Context, couponID id.CouponID) error
```

In `errors.go`, beside the other coupon errors:

```go
	ErrCouponAlreadyApplied = errors.New("ledger: coupon already applied to this subscription")
```

In `store/memory/store.go`, add the field to the struct:

```go
	// Coupon application storage, keyed by subscription ID.
	couponApplications map[string][]*coupon.Application
```

add to `New()`:

```go
		couponApplications: make(map[string][]*coupon.Application),
```

and append the methods after `DeleteCoupon`:

```go
// couponApplicationsFor returns this subscription's applications. Test
// helper and internal reader; callers outside this file use
// ListAppliedCoupons.
func (s *Store) couponApplicationsFor(subID id.SubscriptionID) []*coupon.Application {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.couponApplications[subID.String()]
}

func (s *Store) ApplyCoupon(_ context.Context, subID id.SubscriptionID, couponID id.CouponID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.coupons[couponID.String()]; !ok {
		return ledger.ErrCouponNotFound
	}

	key := subID.String()
	for _, a := range s.couponApplications[key] {
		if a.CouponID.String() == couponID.String() {
			return ledger.ErrCouponAlreadyApplied
		}
	}

	s.couponApplications[key] = append(s.couponApplications[key], &coupon.Application{
		ID:             id.NewCouponApplicationID(),
		CouponID:       couponID,
		SubscriptionID: subID,
		AppliedAt:      time.Now().UTC(),
	})

	return nil
}

func (s *Store) ListAppliedCoupons(_ context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Empty rather than nil: a subscription with no coupons is a valid
	// answer and not a missing one.
	result := make([]*coupon.Coupon, 0)

	for _, a := range s.couponApplications[subID.String()] {
		if c, ok := s.coupons[a.CouponID.String()]; ok {
			result = append(result, c)
		}
	}

	return result, nil
}

func (s *Store) IncrementCouponRedemptions(_ context.Context, couponID id.CouponID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	c, ok := s.coupons[couponID.String()]
	if !ok {
		return ledger.ErrCouponNotFound
	}

	c.TimesRedeemed++
	c.Touch()

	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./store/memory/ -v`

Expected: PASS, 7 tests.

Then run: `go build ./...`

Expected: FAIL. The sqlite, postgres and mongo stores no longer satisfy `store.Store`. That is correct and Tasks 5 and 6 fix it. If `go build ./...` passes here, the interface was not actually extended; go back and check `store/store.go`.

- [ ] **Step 5: Commit**

Do not commit a broken build. Stage the work and carry it into Task 5, committing once the backends compile again:

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
git add id/id.go coupon/application.go coupon/store.go store/store.go errors.go store/memory/
```

---

### Task 5: SQLite and PostgreSQL backends

Both SQL backends together, because their code is character-for-character
identical apart from the receiver's field name and two SQL type names, and
splitting them would mean a reviewer reading the same diff twice.

**Tested through Task 0's harness.** Extend `store/storetest/storetest.go`
with coupon-application subtests mirroring the memory suite from Task 4, and
they run against SQLite in process on every `go test ./...`, and against
PostgreSQL when `LEDGER_TEST_POSTGRES_DSN` is set. Add the subtests to
`Run` so every backend picks them up; do not write them per backend.

**Files:**
- Modify: `store/sqlite/migrations.go` (append after `add_provider_columns`, around line 254)
- Modify: `store/sqlite/models.go` (add a model beside `couponModel`)
- Modify: `store/sqlite/store.go` (add three methods beside `DeleteCoupon`)
- Modify: `store/postgres/migrations.go`, `store/postgres/models.go`, `store/postgres/store.go` identically

**Interfaces:**
- Consumes: `coupon.Application`, `id.NewCouponApplicationID`, `ledger.ErrCouponNotFound`, `ledger.ErrCouponAlreadyApplied` from Task 4.
- Produces: the same three `store.Store` methods, backed by `ledger_coupon_applications`.

**The query API is grove, not raw bun.** The model is an argument to the
builder rather than a `.Model()` call: `s.sdb.NewInsert(m)`,
`s.sdb.NewSelect(m)`, `s.sdb.NewUpdate(m).WherePK()`,
`s.sdb.NewDelete((*couponModel)(nil))`. The receiver field is `s.sdb` in
sqlite and `s.pg` in postgres. Both files already have `now()` and
`isNoRows(err)` helpers; use them rather than `time.Now()` and
`errors.Is(err, sql.ErrNoRows)`.

- [ ] **Step 1: Add the migration**

Append to `store/sqlite/migrations.go`:

```go
		&migrate.Migration{
			Name:    "create_ledger_coupon_applications",
			Version: "20240101000009",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `
CREATE TABLE IF NOT EXISTS ledger_coupon_applications (
    id              TEXT PRIMARY KEY,
    coupon_id       TEXT NOT NULL DEFAULT '',
    subscription_id TEXT NOT NULL DEFAULT '',
    applied_at      TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_coupon_apps_pair
    ON ledger_coupon_applications (coupon_id, subscription_id);
CREATE INDEX IF NOT EXISTS idx_ledger_coupon_apps_sub
    ON ledger_coupon_applications (subscription_id);
`)
				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `DROP TABLE IF EXISTS ledger_coupon_applications`)
				return err
			},
		},
```

Append the same block to `store/postgres/migrations.go` with two changes:
`applied_at TIMESTAMPTZ NOT NULL`, and the referential integrity SQLite goes
without:

```sql
    coupon_id       TEXT NOT NULL REFERENCES ledger_coupons(id) ON DELETE CASCADE,
```

- [ ] **Step 2: Add the model**

Add to `store/sqlite/models.go`, beside `couponModel`:

```go
type couponApplicationModel struct {
	bun.BaseModel `bun:"table:ledger_coupon_applications,alias:ca"`

	ID             string    `bun:"id,pk"`
	CouponID       string    `bun:"coupon_id,notnull"`
	SubscriptionID string    `bun:"subscription_id,notnull"`
	AppliedAt      time.Time `bun:"applied_at,notnull"`
}
```

Add the identical struct to `store/postgres/models.go`. Check the `bun.BaseModel`
embedding style against the neighbouring models in each file and match it; if
those files declare models without the embedded `BaseModel`, follow that
instead.

- [ ] **Step 3: Add the three methods**

Add to `store/sqlite/store.go`, after `DeleteCoupon`:

```go
func (s *Store) ApplyCoupon(ctx context.Context, subID id.SubscriptionID, couponID id.CouponID) error {
	// Confirm the coupon exists before writing a row that references it.
	// SQLite is not enforcing a foreign key here, so this is the only
	// thing between a bad ID and an orphaned application row.
	if _, err := s.GetCouponByID(ctx, couponID); err != nil {
		return err
	}

	existing := new(couponApplicationModel)
	err := s.sdb.NewSelect(existing).
		Where("coupon_id = ?", couponID.String()).
		Where("subscription_id = ?", subID.String()).
		Scan(ctx)
	switch {
	case err == nil:
		return ledger.ErrCouponAlreadyApplied
	case !isNoRows(err):
		return err
	}

	m := &couponApplicationModel{
		ID:             id.NewCouponApplicationID().String(),
		CouponID:       couponID.String(),
		SubscriptionID: subID.String(),
		AppliedAt:      now(),
	}
	_, err = s.sdb.NewInsert(m).Exec(ctx)

	return err
}

func (s *Store) ListAppliedCoupons(ctx context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error) {
	var models []couponApplicationModel
	err := s.sdb.NewSelect(&models).
		Where("subscription_id = ?", subID.String()).
		OrderExpr("applied_at ASC").
		Scan(ctx)
	if err != nil {
		return nil, err
	}

	// Empty rather than nil: a subscription with no coupons is a valid
	// answer, not a missing one.
	result := make([]*coupon.Coupon, 0, len(models))
	for i := range models {
		couponID, parseErr := id.ParseCouponID(models[i].CouponID)
		if parseErr != nil {
			return nil, parseErr
		}

		c, getErr := s.GetCouponByID(ctx, couponID)
		if getErr != nil {
			// A deleted coupon can leave its application row behind.
			// Skip it rather than failing the whole read: the
			// subscription is still valid and the operator needs the
			// rest of its coupons.
			continue
		}
		result = append(result, c)
	}

	return result, nil
}

func (s *Store) IncrementCouponRedemptions(ctx context.Context, couponID id.CouponID) error {
	res, err := s.sdb.NewUpdate((*couponModel)(nil)).
		Set("times_redeemed = times_redeemed + 1").
		Set("updated_at = ?", now()).
		Where("id = ?", couponID.String()).
		Exec(ctx)
	if err != nil {
		return err
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ledger.ErrCouponNotFound
	}

	return nil
}
```

Add the identical three methods to `store/postgres/store.go`, replacing every
`s.sdb` with `s.pg`. Nothing else differs.

If `NewUpdate` on this grove version does not accept a nil typed model with
`Set` clauses, fall back to a read-modify-write: `GetCouponByID`, increment
`TimesRedeemed`, `UpdateCoupon`. Note the fallback in the commit message,
because it is not atomic and two concurrent redemptions of the same coupon
can then both read the same count.

- [ ] **Step 4: Verify the SQL backends compile**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go build ./store/sqlite/ ./store/postgres/`

Expected: clean. The `var _ ledgerstore.Store = (*Store)(nil)` assertion at the
top of each file is what proves the methods match the interface.

Then run: `go build ./...`

Expected: still FAIL, on mongo only. Task 6 closes it.

- [ ] **Step 5: Stage, do not commit**

The build is still broken until mongo lands.

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
git add store/sqlite/ store/postgres/
```

---

### Task 6: MongoDB backend

Closes the interface and lands Tasks 4 through 6 as one commit. Mongo is
schemaless, so there is no column to add, but it does need its collection and
indexes created and it has no `add_provider_columns` migration, which is why
its version numbering is one behind the SQL backends.

**Files:**
- Modify: `store/mongo/migrations.go` (append, version `20240101000008`)
- Modify: `store/mongo/models.go` (add a document type)
- Modify: `store/mongo/store.go` (add three methods beside the coupon methods)

**Interfaces:**
- Consumes: everything from Tasks 4 and 5.
- Produces: no new names. `store/mongo/store.go:40`'s existing
  `var _ ledgerstore.Store = (*Store)(nil)` starts passing again.

- [ ] **Step 1: Read the two things this task must match**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && awk '/func .*CreateCoupon|func .*GetCouponByID|func .*DeleteCoupon/,/^}/' store/mongo/store.go`

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && sed -n '155,200p' store/mongo/migrations.go`

The first shows the collection-access and error-mapping idiom to copy. The
second shows how a mongo migration declares a collection and its indexes.
Write the code below in that idiom rather than in the SQL one.

- [ ] **Step 2: Add the migration**

Append to `store/mongo/migrations.go` a migration named
`create_ledger_coupon_applications` at version `20240101000008`, creating the
`ledger_coupon_applications` collection with a unique compound index on
`coupon_id` and `subscription_id` ascending, and a non-unique index on
`subscription_id`. Its `Down` drops the collection. Follow the exact shape of
`create_ledger_coupons` two entries above it.

- [ ] **Step 3: Add the document type and the three methods**

Add to `store/mongo/models.go`:

```go
type couponApplicationDoc struct {
	ID             string    `bson:"_id"`
	CouponID       string    `bson:"coupon_id"`
	SubscriptionID string    `bson:"subscription_id"`
	AppliedAt      time.Time `bson:"applied_at"`
}
```

Add to `store/mongo/store.go`, beside the other coupon methods. The mongo
builder is `s.mdb`, reads go through `NewFind(&m).Filter(bson.M{...})`, and
the no-rows helper is `isNoDocuments` rather than sqlite's `isNoRows`:

```go
func (s *Store) ApplyCoupon(ctx context.Context, subID id.SubscriptionID, couponID id.CouponID) error {
	if _, err := s.GetCouponByID(ctx, couponID); err != nil {
		return err
	}

	var existing couponApplicationDoc
	err := s.mdb.NewFind(&existing).
		Filter(bson.M{
			"coupon_id":       couponID.String(),
			"subscription_id": subID.String(),
		}).
		Scan(ctx)
	switch {
	case err == nil:
		return ledger.ErrCouponAlreadyApplied
	case !isNoDocuments(err):
		return fmt.Errorf("ledger/mongo: check existing coupon application: %w", err)
	}

	m := &couponApplicationDoc{
		ID:             id.NewCouponApplicationID().String(),
		CouponID:       couponID.String(),
		SubscriptionID: subID.String(),
		AppliedAt:      now(),
	}
	if _, err := s.mdb.NewInsert(m).Exec(ctx); err != nil {
		return fmt.Errorf("ledger/mongo: apply coupon: %w", err)
	}

	return nil
}

func (s *Store) ListAppliedCoupons(ctx context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error) {
	var docs []couponApplicationDoc
	err := s.mdb.NewFind(&docs).
		Filter(bson.M{"subscription_id": subID.String()}).
		Sort(bson.D{{Key: "applied_at", Value: 1}}).
		Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("ledger/mongo: list applied coupons: %w", err)
	}

	// Empty rather than nil: a subscription with no coupons is a valid
	// answer, not a missing one.
	result := make([]*coupon.Coupon, 0, len(docs))
	for i := range docs {
		couponID, parseErr := id.ParseCouponID(docs[i].CouponID)
		if parseErr != nil {
			return nil, parseErr
		}

		c, getErr := s.GetCouponByID(ctx, couponID)
		if getErr != nil {
			// A deleted coupon can leave its application behind. Skip
			// it rather than failing the read.
			continue
		}
		result = append(result, c)
	}

	return result, nil
}

func (s *Store) IncrementCouponRedemptions(ctx context.Context, couponID id.CouponID) error {
	res, err := s.mdb.NewUpdate((*couponModel)(nil)).
		Filter(bson.M{"_id": couponID.String()}).
		Update(bson.M{
			"$inc": bson.M{"times_redeemed": 1},
			"$set": bson.M{"updated_at": now()},
		}).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("ledger/mongo: increment coupon redemptions: %w", err)
	}
	if res.MatchedCount == 0 {
		return ledger.ErrCouponNotFound
	}

	return nil
}
```

The `Sort` and `Update` builder methods are the two calls above that no
existing coupon method in this file demonstrates. Check them against the mongo
methods that do sort and that do a partial update, `ListInvoices` and
`MarkInvoicePaid`, and correct the calls to match what the grove mongo driver
actually exposes. If `NewUpdate` cannot express `$inc`, fall back to
read-modify-write through `GetCouponByID` and `UpdateCoupon`, and say so in the
commit message, because that fallback is not atomic.

- [ ] **Step 4: Verify the whole repository builds and tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go build ./... && go test ./...`

Expected: build clean, all tests pass. Memory and SQLite both run the coupon-
application conformance subtests. Mongo skips unless `LEDGER_TEST_MONGO_URI`
names a server; if you have one, run it once before committing:
`LEDGER_TEST_MONGO_URI="mongodb://localhost:27017/ledger_test" go test ./store/mongo/ -v`.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add id/id.go coupon/ store/ errors.go
git commit -m "feat(store): record coupon redemptions across all four backends"
```

---

### Task 7: `Ledger.ApplyCoupon` and the `CouponValidator` hook

The validation layer. This is where the five `ErrCoupon*` values that have existed since the first commit and been returned from nowhere finally get returned.

**Files:**
- Create: `coupon_apply.go` (repository root, package `ledger`, beside `ledger.go`)
- Create: `coupon_apply_test.go`
- Modify: `plugin/registry.go` (add an accessor beside `GetTaxCalculators`, around line 500)

**Interfaces:**
- Consumes: `store.Store.ApplyCoupon`, `ListAppliedCoupons`, `IncrementCouponRedemptions` from Task 6.
- Produces:
  - `func (l *Ledger) ApplyCoupon(ctx context.Context, subID id.SubscriptionID, code string) (*coupon.Coupon, error)`
  - `func (l *Ledger) ListAppliedCoupons(ctx context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error)`
  - `func (r *Registry) GetCouponValidators() []CouponValidator`

**Validation order, which the tests pin:** resolve the subscription, resolve the coupon by code within the subscription's app, check the validity window, check redemption exhaustion, check currency against the subscription's plan, then run plugin validators, then write. Every check that can fail without a store write happens before any store write.

- [ ] **Step 1: Write the failing test**

Create `coupon_apply_test.go`:

```go
package ledger

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/ledger/coupon"
	"github.com/xraph/ledger/id"
	"github.com/xraph/ledger/plan"
	"github.com/xraph/ledger/store/memory"
	"github.com/xraph/ledger/subscription"
	"github.com/xraph/ledger/types"
)

// fixture builds a ledger over a memory store holding one active plan and
// one active subscription, and returns both plus the subscription's ID.
func fixture(t *testing.T) (*Ledger, *memory.Store, id.SubscriptionID) {
	t.Helper()
	ctx := context.Background()

	s := memory.New()
	l := New(s)

	p := &plan.Plan{
		Entity:   types.NewEntity(),
		ID:       id.NewPlanID(),
		Name:     "Pro",
		Slug:     "pro",
		Currency: "usd",
		Status:   plan.StatusActive,
		AppID:    "app_1",
		Pricing: &plan.Pricing{
			ID:            id.NewPriceID(),
			BaseAmount:    types.USD(4900),
			BillingPeriod: plan.PeriodMonthly,
		},
	}
	if err := s.CreatePlan(ctx, p); err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}

	sub := &subscription.Subscription{
		Entity:             types.NewEntity(),
		ID:                 id.NewSubscriptionID(),
		TenantID:           "tenant_1",
		PlanID:             p.ID,
		Status:             subscription.StatusActive,
		CurrentPeriodStart: time.Now().UTC().Add(-24 * time.Hour),
		CurrentPeriodEnd:   time.Now().UTC().Add(24 * time.Hour),
		AppID:              "app_1",
	}
	if err := s.CreateSubscription(ctx, sub); err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	return l, s, sub.ID
}

func mustCreateCoupon(t *testing.T, s *memory.Store, c *coupon.Coupon) *coupon.Coupon {
	t.Helper()
	if err := s.CreateCoupon(context.Background(), c); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}
	return c
}

func baseCoupon() *coupon.Coupon {
	return &coupon.Coupon{
		Entity:     types.NewEntity(),
		ID:         id.NewCouponID(),
		Code:       "LAUNCH10",
		Name:       "Launch discount",
		Type:       coupon.CouponTypePercentage,
		Percentage: 10,
		Currency:   "usd",
		AppID:      "app_1",
	}
}

func TestApplyCouponHappyPath(t *testing.T) {
	ctx := context.Background()
	l, s, subID := fixture(t)
	c := mustCreateCoupon(t, s, baseCoupon())

	got, err := l.ApplyCoupon(ctx, subID, "LAUNCH10")
	if err != nil {
		t.Fatalf("ApplyCoupon: %v", err)
	}
	if got.ID.String() != c.ID.String() {
		t.Errorf("got coupon %s, want %s", got.ID, c.ID)
	}

	stored, err := s.GetCouponByID(ctx, c.ID)
	if err != nil {
		t.Fatalf("GetCouponByID: %v", err)
	}
	if stored.TimesRedeemed != 1 {
		t.Errorf("got TimesRedeemed %d, want 1", stored.TimesRedeemed)
	}

	applied, err := l.ListAppliedCoupons(ctx, subID)
	if err != nil {
		t.Fatalf("ListAppliedCoupons: %v", err)
	}
	if len(applied) != 1 {
		t.Errorf("got %d applied coupons, want 1", len(applied))
	}
}

func TestApplyCouponRejections(t *testing.T) {
	future := time.Now().UTC().Add(48 * time.Hour)
	past := time.Now().UTC().Add(-48 * time.Hour)

	tests := []struct {
		name    string
		mutate  func(*coupon.Coupon)
		code    string
		wantErr error
	}{
		{
			name:    "unknown code",
			mutate:  func(*coupon.Coupon) {},
			code:    "NOPE",
			wantErr: ErrCouponNotFound,
		},
		{
			name:    "not yet valid",
			mutate:  func(c *coupon.Coupon) { c.ValidFrom = &future },
			code:    "LAUNCH10",
			wantErr: ErrCouponNotStarted,
		},
		{
			name:    "expired",
			mutate:  func(c *coupon.Coupon) { c.ValidUntil = &past },
			code:    "LAUNCH10",
			wantErr: ErrCouponExpired,
		},
		{
			name: "redemptions exhausted",
			mutate: func(c *coupon.Coupon) {
				c.MaxRedemptions = 5
				c.TimesRedeemed = 5
			},
			code:    "LAUNCH10",
			wantErr: ErrCouponExhausted,
		},
		{
			// Review Focus 1. Money.Subtract panics on a currency
			// mismatch, so this must be refused here and never reach
			// invoice generation.
			name:    "currency does not match the plan",
			mutate:  func(c *coupon.Coupon) { c.Currency = "eur" },
			code:    "LAUNCH10",
			wantErr: ErrCouponInvalid,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			l, s, subID := fixture(t)

			c := baseCoupon()
			tt.mutate(c)
			mustCreateCoupon(t, s, c)

			_, err := l.ApplyCoupon(ctx, subID, tt.code)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("got error %v, want %v", err, tt.wantErr)
			}

			// A rejected coupon must leave no trace.
			stored, getErr := s.GetCouponByID(ctx, c.ID)
			if getErr == nil && stored.TimesRedeemed != c.TimesRedeemed {
				t.Errorf("a rejected apply changed TimesRedeemed: got %d, want %d",
					stored.TimesRedeemed, c.TimesRedeemed)
			}

			applied, listErr := l.ListAppliedCoupons(ctx, subID)
			if listErr != nil {
				t.Fatalf("ListAppliedCoupons: %v", listErr)
			}
			if len(applied) != 0 {
				t.Errorf("a rejected apply recorded %d applications, want 0", len(applied))
			}
		})
	}
}

func TestApplyCouponTwiceIsRejected(t *testing.T) {
	ctx := context.Background()
	l, s, subID := fixture(t)
	mustCreateCoupon(t, s, baseCoupon())

	if _, err := l.ApplyCoupon(ctx, subID, "LAUNCH10"); err != nil {
		t.Fatalf("first ApplyCoupon: %v", err)
	}

	_, err := l.ApplyCoupon(ctx, subID, "LAUNCH10")
	if !errors.Is(err, ErrCouponAlreadyApplied) {
		t.Fatalf("second ApplyCoupon: got %v, want ErrCouponAlreadyApplied", err)
	}

	applied, err := l.ListAppliedCoupons(ctx, subID)
	if err != nil {
		t.Fatalf("ListAppliedCoupons: %v", err)
	}
	if len(applied) != 1 {
		t.Errorf("got %d applied coupons, want 1", len(applied))
	}
}

func TestApplyCouponUnlimitedRedemptions(t *testing.T) {
	ctx := context.Background()
	l, s, _ := fixture(t)

	c := baseCoupon()
	c.MaxRedemptions = 0 // unlimited
	c.TimesRedeemed = 9999
	mustCreateCoupon(t, s, c)

	// A second subscription, because the same one cannot take it twice.
	sub2 := &subscription.Subscription{
		Entity:   types.NewEntity(),
		ID:       id.NewSubscriptionID(),
		TenantID: "tenant_2",
		PlanID:   id.Nil,
		Status:   subscription.StatusActive,
		AppID:    "app_1",
	}
	_ = s.CreateSubscription(ctx, sub2)

	if _, err := l.ApplyCoupon(ctx, sub2.ID, "LAUNCH10"); err != nil {
		t.Fatalf("ApplyCoupon with MaxRedemptions 0: %v", err)
	}
}

// stubValidator refuses everything, and records that it was asked.
type stubValidator struct {
	called bool
	err    error
}

func (s *stubValidator) Name() string { return "stub-validator" }
func (s *stubValidator) ValidateCoupon(_ context.Context, _ interface{}, _ interface{}) error {
	s.called = true
	return s.err
}

func TestApplyCouponConsultsPluginValidators(t *testing.T) {
	ctx := context.Background()

	t.Run("a refusing validator blocks the apply", func(t *testing.T) {
		v := &stubValidator{err: errors.New("tenant is on the deny list")}
		s := memory.New()
		l := New(s, WithPlugin(v))

		p := &plan.Plan{
			Entity: types.NewEntity(), ID: id.NewPlanID(), Currency: "usd",
			Status: plan.StatusActive, AppID: "app_1", Slug: "pro",
		}
		_ = s.CreatePlan(ctx, p)
		sub := &subscription.Subscription{
			Entity: types.NewEntity(), ID: id.NewSubscriptionID(),
			TenantID: "tenant_1", PlanID: p.ID,
			Status: subscription.StatusActive, AppID: "app_1",
		}
		_ = s.CreateSubscription(ctx, sub)
		mustCreateCoupon(t, s, baseCoupon())

		_, err := l.ApplyCoupon(ctx, sub.ID, "LAUNCH10")
		if err == nil {
			t.Fatal("got nil error, want the validator's refusal")
		}
		if !v.called {
			t.Error("the validator was never consulted")
		}

		applied, _ := l.ListAppliedCoupons(ctx, sub.ID)
		if len(applied) != 0 {
			t.Errorf("a refused apply recorded %d applications, want 0", len(applied))
		}
	})
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test . -run TestApplyCoupon -v`

Expected: FAIL to compile, `l.ApplyCoupon undefined` and `l.ListAppliedCoupons undefined`.

- [ ] **Step 3: Write minimal implementation**

Add to `plugin/registry.go`, beside `GetTaxCalculators`:

```go
// GetCouponValidators returns every registered coupon validator.
func (r *Registry) GetCouponValidators() []CouponValidator {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]CouponValidator, len(r.couponValidators))
	copy(out, r.couponValidators)

	return out
}
```

Match the mutex field name `GetTaxCalculators` uses; if that method takes no lock, do the same here rather than introducing an inconsistent locking discipline.

Create `coupon_apply.go`:

```go
package ledger

import (
	"context"
	"fmt"
	"time"

	"github.com/xraph/ledger/coupon"
	"github.com/xraph/ledger/id"
)

// ApplyCoupon attaches a coupon to a subscription by code.
//
// Every check that can fail runs before any write, so a rejected coupon
// leaves no application row and no incremented redemption count. The
// redemption count is incremented after the application row lands: a count
// without a row is unexplainable, a row without a count is recoverable.
func (l *Ledger) ApplyCoupon(ctx context.Context, subID id.SubscriptionID, code string) (*coupon.Coupon, error) {
	sub, err := l.store.GetSubscription(ctx, subID)
	if err != nil {
		return nil, fmt.Errorf("ledger: resolve subscription: %w", err)
	}

	c, err := l.store.GetCoupon(ctx, code, sub.AppID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if c.ValidFrom != nil && now.Before(*c.ValidFrom) {
		return nil, ErrCouponNotStarted
	}
	if c.ValidUntil != nil && now.After(*c.ValidUntil) {
		return nil, ErrCouponExpired
	}

	// MaxRedemptions of zero means unlimited.
	if c.MaxRedemptions > 0 && c.TimesRedeemed >= c.MaxRedemptions {
		return nil, ErrCouponExhausted
	}

	// Currency must match the plan the subscription bills in. Money.Add and
	// Subtract panic across currencies, so a mismatch caught here is the
	// difference between an error and a crash during invoice generation.
	if !sub.PlanID.IsNil() {
		p, planErr := l.store.GetPlan(ctx, sub.PlanID)
		if planErr != nil {
			return nil, fmt.Errorf("ledger: resolve plan for coupon currency check: %w", planErr)
		}
		if p.Currency != "" && c.Currency != "" && p.Currency != c.Currency {
			return nil, fmt.Errorf("%w: coupon is in %s, plan bills in %s",
				ErrCouponInvalid, c.Currency, p.Currency)
		}
	}

	for _, v := range l.plugins.GetCouponValidators() {
		if vErr := v.ValidateCoupon(ctx, c, sub); vErr != nil {
			return nil, fmt.Errorf("ledger: coupon validator %q refused: %w", v.Name(), vErr)
		}
	}

	if err := l.store.ApplyCoupon(ctx, subID, c.ID); err != nil {
		return nil, err
	}

	if err := l.store.IncrementCouponRedemptions(ctx, c.ID); err != nil {
		return nil, fmt.Errorf("ledger: coupon applied but redemption count not incremented: %w", err)
	}

	c.TimesRedeemed++

	return c, nil
}

// ListAppliedCoupons returns the coupons attached to a subscription, oldest
// application first.
func (l *Ledger) ListAppliedCoupons(ctx context.Context, subID id.SubscriptionID) ([]*coupon.Coupon, error) {
	return l.store.ListAppliedCoupons(ctx, subID)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test . -v`

Expected: PASS. `TestApplyCouponHappyPath`, `TestApplyCouponRejections` (5 subtests), `TestApplyCouponTwiceIsRejected`, `TestApplyCouponUnlimitedRedemptions`, `TestApplyCouponConsultsPluginValidators`.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add coupon_apply.go coupon_apply_test.go plugin/registry.go
git commit -m "feat(ledger): validate and apply coupons to subscriptions"
```

---

### Task 12: Atomic coupon redemption (executed after Task 7, before Task 8)

Added during execution (ledger ruling R19). Task 7's review reproduced two defects in the
apply path. (a) The redemption cap is checked by reading `TimesRedeemed` before writing,
so concurrent applies near the cap over-redeem: a barrier probe redeemed a coupon capped
at 1 five times. (b) The application row and the increment are two writes, so a failure
between them leaves a discount attached and uncounted. A retry then gets
`ErrCouponAlreadyApplied`, so the count never recovers.

Both are fixed by one store method that redeems as a unit.

**Files:**
- Modify: `store/store.go`, `coupon/store.go` (interfaces)
- Modify: `store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/store.go`, `store/mongo/store.go`
- Modify: `store/storetest/storetest.go` (subtests in `Run`)
- Create: `store/sqlite/redeem_internal_test.go`
- Modify: `coupon_apply.go`, `coupon_apply_test.go`

**Interfaces:**
- Consumes: the Task 4-6 store methods and their error helpers (unique-violation and FK mapping per backend); `Ledger.ApplyCoupon` from Task 7 as fixed.
- Produces:
  - `RedeemCoupon(ctx context.Context, subID id.SubscriptionID, couponID id.CouponID) error` on `store.Store`, and as `Redeem` on the narrow `coupon.Store`.

**Semantics, identical on every backend:**
1. A nil or non-`sub` `subID` → error wrapping `ledger.ErrInvalidInput`, before any storage access.
2. Unknown coupon → `ledger.ErrCouponNotFound`.
3. The pair is already applied → `ledger.ErrCouponAlreadyApplied`, and the count does not move.
4. The coupon is at its cap (`MaxRedemptions > 0 && TimesRedeemed >= MaxRedemptions`) → `ledger.ErrCouponExhausted`, and NO application row is left behind.
5. Success → exactly one application row, and `TimesRedeemed` incremented by exactly one.
6. Any failure after the application insert → no application row remains and the count is unchanged.

The cap is enforced by a CONDITIONAL increment, never by a read followed by a write:
`UPDATE ledger_coupons SET times_redeemed = times_redeemed + 1, updated_at = ? WHERE id = ? AND (max_redemptions = 0 OR times_redeemed < max_redemptions)`.
Zero rows affected, with the coupon known to exist, means exhausted.

**Per backend:**
- memory: the whole operation under one `s.mu.Lock()`.
- sqlite and postgres: one transaction. `tx, err := s.sdb.BeginTxQuery(ctx, nil)` (`s.pg` on postgres) returns a transaction exposing `NewInsert`, `NewUpdate`, `NewSelect`, `Commit` and `Rollback`. Insert the application through `tx`, run the conditional increment through `tx`, commit only if exactly one row was affected, and roll back on every other path. Reuse the Task 4-6 helpers to map a unique violation on the insert to `ErrCouponAlreadyApplied` (and a postgres FK violation to `ErrCouponNotFound`). Defer a rollback guarded so it is a no-op after a successful commit.
- mongo: multi-document transactions need a replica set and the harness cannot assume one. So insert the application (duplicate key → `ErrCouponAlreadyApplied`), then run the conditional increment as a single-document update with filter `{_id: couponID, $or: [{max_redemptions: 0}, {$expr: {$lt: ["$times_redeemed", "$max_redemptions"]}}]}`. On zero matched, delete the application just inserted and return `ErrCouponExhausted`. On an update error, delete it and return the error. If the compensating delete itself fails, return an error that names both failures. Say in the method's doc comment that this is compensating, not transactional, and why.

`ApplyCoupon` and `IncrementCouponRedemptions` stay on the interface as low-level operations. Say in each doc comment that engine code redeems through `RedeemCoupon`.

**Engine change.** `Ledger.ApplyCoupon` keeps every pre-check from Task 7, including the fast-path exhaustion check, and the plugin validators. It replaces its `ApplyCoupon` + `IncrementCouponRedemptions` pair with one `l.store.RedeemCoupon` call, then re-reads the coupon through `GetCouponByID` to return the current count. Rewrite the comment that claimed "a row without a count is recoverable". Review showed it is not.

- [ ] **Step 1: Write the failing tests**

Add to `store/storetest/storetest.go` and register each in `Run`. Use `uniqueSuffix()` for every coupon code and app id, and assert with `errors.Is`:

- `RedeemCouponRecordsAndCounts`: redeem once → `ListAppliedCoupons` returns that coupon; `TimesRedeemed` is 1.
- `RedeemCouponRespectsTheCap`: `MaxRedemptions` 2; redeem on sub1 and sub2 → nil; sub3 → `ErrCouponExhausted`; sub3's list is empty; `TimesRedeemed` is 2.
- `RedeemCouponUnlimited`: `MaxRedemptions` 0 and `TimesRedeemed` created at 5 → redeem → nil, count 6.
- `RedeemCouponDuplicate`: same pair twice → second is `ErrCouponAlreadyApplied`; count 1; list has one.
- `RedeemCouponRejectsBadInput`: unknown coupon → `ErrCouponNotFound`; `id.Nil` → `ErrInvalidInput`; a plan id as the sub id → `ErrInvalidInput`; no rows and no count change in any case.
- `RedeemCouponConcurrentCap`: `MaxRedemptions` 3; 12 goroutines redeem the SAME coupon onto 12 DIFFERENT subscriptions → exactly 3 nil, exactly 9 `ErrCouponExhausted` and no other error, `TimesRedeemed` exactly 3, and the 12 subscriptions' lists hold exactly 3 applications between them.

Create `store/sqlite/redeem_internal_test.go` (internal package) pinning rule 6, the rollback:
open a store the way the harness does, create a coupon, then install a trigger that makes the increment fail inside the transaction,

```sql
CREATE TRIGGER fail_increment BEFORE UPDATE ON ledger_coupons
BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
```

call `RedeemCoupon`, and assert a non-nil error, an EMPTY `ListAppliedCoupons` for that subscription (the insert was rolled back), and an unchanged `TimesRedeemed`. Then drop the trigger and assert a second `RedeemCoupon` succeeds, so the failure left nothing behind that blocks a retry. Do not do this on postgres: its scratch database is shared.

Add to `coupon_apply_test.go` (package `ledger_test`):
- `TestApplyCouponCannotExceedTheCapConcurrently`: a coupon with `MaxRedemptions` 3; 10 subscriptions on the same plan; 10 goroutines call `ApplyCoupon` concurrently → exactly 3 succeed, exactly 7 return `ErrCouponExhausted`, and the stored count is 3.

- [ ] **Step 2: Run them to verify they fail**

`go test ./store/... . -count=1` fails to compile until `RedeemCoupon` exists. After adding only the interface method and stubs, the concurrency tests must fail on behaviour: more than 3 succeed.

- [ ] **Step 3: Implement** per the semantics and per-backend notes above.

- [ ] **Step 4: Verify**

`go build ./... && go vet ./... && go test ./... -count=1`, then `go test -race ./store/... . -count=3`, then postgres twice:
`LEDGER_TEST_POSTGRES_DSN="postgres://twinos:twinos@localhost:5432/ledger_test?sslmode=disable" go test ./store/... -count=1`.
Prove the cap is load-bearing: temporarily drop the `WHERE` condition on one SQL backend and confirm `RedeemCouponConcurrentCap` fails; restore.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add store/ coupon/store.go coupon_apply.go coupon_apply_test.go
git commit -m "fix(ledger): redeem coupons atomically so the cap holds under concurrency"
```

---

### Task 13: Mongo backend conformance fixes (executed after Task 12, before Task 8)

Added during execution (ledger rulings R21, R22). The conformance harness from Task 0,
run against a live mongod, caught two pre-existing mongo bugs that fail identically on the
commit before Phase A. Both were diagnosed in Task 12's report.

**M-A. Plans without `Pricing.PlanID` cannot be read back.** `store/mongo/models.go:178`,
`fromPlanModel`, parses `m.Pricing.PlanID` unconditionally. A `plan.Pricing` built without
a `PlanID`, which is the normal construction, stores `""`, and the read fails. Sqlite and
postgres read the same plan correctly.

**M-B. `IngestBatch` silently drops usage events.** `store/mongo/store.go:330-345` inserts
each event and skips any duplicate-key error "for idempotency". The unique index on
`idempotency_key` is SPARSE. grove's insert path ignores the `omitempty` bson tag
(`models.go:318`), so an event without a key is written with `""`. Sparse indexes still
index a present empty string, so the second keyless event collides and is dropped with no
error. Metered usage goes missing and customers are under-billed. Sqlite and postgres use a
PARTIAL unique index `WHERE idempotency_key != ''` with `ON CONFLICT ... DO NOTHING`, which
is the correct design. Mongo must match it.

**Files:**
- Modify: `store/mongo/models.go`, `store/mongo/store.go`, `store/mongo/migrations.go`
- Modify: `store/storetest/storetest.go` (subtests in `Run`)

**Fixes:**
1. M-A: `fromPlanModel` treats an empty stored `PlanID` as `id.Nil` instead of failing. Audit EVERY `fromXModel` in `store/mongo/models.go` for the same shape: an id field that is legitimately optional (for example `plan.Feature.CatalogID`, `invoice.SubscriptionID` where applicable, provider ids) parsed unconditionally. Fix each the same way, and list them in the report. Do not relax a parse on an id that is genuinely required.
2. M-B: replace the sparse unique index with a PARTIAL unique index on non-empty strings,
   `partialFilterExpression: {idempotency_key: {$gt: ""}}` (`$gt ""` matches only non-empty strings, and type bracketing excludes null and missing). Give it a NEW index name. `store/mongo/Migrate()` builds indexes from `migrationIndexes()`, not from `migrations.go`, so change it there, and ALSO add the change to `migrations.go` so the two do not drift further. Because an index with the same keys and different options cannot be created over the old one, `Migrate` must first drop the old sparse index by its name, treating "index not found" as success, so it is idempotent on fresh and existing databases.
3. M-B: keep the duplicate-skip in `IngestBatch`. It is now correct, because only a genuinely repeated non-empty key can collide.

**Tests** (add to `Run`, so they run on every backend; `uniqueSuffix()` on tenant, app and keys):
- `PlanRoundTripWithoutPricingPlanID`: a plan whose `Pricing.PlanID` is unset round-trips on every backend, and the read-back `Pricing.PlanID` is nil.
- `IngestKeylessEventsAreAllCounted`: ingest 3 events with an EMPTY idempotency key for the same tenant, app and feature, quantities 1, 2 and 4 → `QueryUsage` returns 3 events, and `Aggregate` for the current period returns 7.
- `IngestDuplicateKeyIsCountedOnce`: ingest 2 events sharing one non-empty key → counted once.
- `IngestKeyedAndKeylessMix`: 2 keyless plus 2 events with distinct non-empty keys → all 4 counted.
- The pre-existing `PlanRoundTrip` and `EmptyTenantIDBehavior` must now pass on mongo.
- Mongo `Migrate` is idempotent: calling it twice on the same database succeeds, and after it the old sparse index is absent and the new partial one present (an internal mongo test, skipped without `LEDGER_TEST_MONGO_URI`).

**Verification:**
- `go build ./... && go vet ./... && go test ./... -count=1`
- Postgres twice: `LEDGER_TEST_POSTGRES_DSN="postgres://twinos:twinos@localhost:5432/ledger_test?sslmode=disable" go test ./store/... -count=1`
- Mongo against the live server on localhost:57017, which belongs to another session, ONLY through a uniquely named scratch database that you drop afterwards: `LEDGER_TEST_MONGO_URI="mongodb://localhost:57017/ledger_test_<random>" go test ./store/... -count=1`. The WHOLE mongo conformance suite must pass, including the two formerly failing subtests.
- Prove M-B's test discriminates: revert to the sparse index and confirm `IngestKeylessEventsAreAllCounted` fails on mongo; restore.

**Commit:** stage `store/`, message `fix(mongo): stop dropping keyless usage events and read plans without a pricing id`. No Co-Authored-By trailer.

---

### Task 8: Seat quantities on subscriptions

Gives `plan.FeatureSeat` the count it has never had. A seat count is a level rather than a flow, which is why it lives on the subscription row and not in the usage stream.

**Files:**
- Modify: `subscription/models.go` (add a field)
- Modify: `store/postgres/migrations.go`, `store/sqlite/migrations.go` (a column, version `20240101000010`)
- Modify: `store/postgres/models.go`, `store/sqlite/models.go`, `store/mongo/models.go` (the field in each model and both mapping functions)
- Modify: `store/memory/store.go` only if it copies subscriptions field by field; check first
- Create: `subscription/models_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `Subscription.Quantity map[string]int64` with JSON tag `quantity,omitempty`, keyed by plan feature key.

- [ ] **Step 1: Write the failing test**

Create `subscription/models_test.go`:

```go
package subscription

import (
	"encoding/json"
	"testing"
)

func TestSubscriptionQuantityRoundTrips(t *testing.T) {
	in := Subscription{
		TenantID: "tenant_1",
		Quantity: map[string]int64{"seats": 12, "projects": 3},
	}

	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var out Subscription
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if out.Quantity["seats"] != 12 {
		t.Errorf("got seats %d, want 12", out.Quantity["seats"])
	}
	if out.Quantity["projects"] != 3 {
		t.Errorf("got projects %d, want 3", out.Quantity["projects"])
	}
}

func TestSubscriptionQuantityOmittedWhenEmpty(t *testing.T) {
	raw, err := json.Marshal(Subscription{TenantID: "tenant_1"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var generic map[string]interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if _, present := generic["quantity"]; present {
		t.Error("quantity appears in JSON for a subscription that has none; it should be omitted")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./subscription/ -v`

Expected: FAIL to compile, `unknown field Quantity in struct literal`.

- [ ] **Step 3: Write minimal implementation**

In `subscription/models.go`, add after `Status`:

```go
	// Quantity holds the current count for each quantity-priced plan
	// feature, keyed by feature key. Seats are the usual case.
	//
	// A seat count is a level and not a flow, so it is stored here and set
	// when the subscription is created or changed, rather than derived
	// from usage events. Aggregating a stream would answer "how many seats
	// were added this month", which is a different question.
	Quantity map[string]int64 `json:"quantity,omitempty"`
```

Add a `quantity` column to the postgres and sqlite subscription tables through a new migration at version `20240101000010`:

```sql
ALTER TABLE ledger_subscriptions ADD COLUMN quantity JSONB NOT NULL DEFAULT '{}';
```

Use `TEXT NOT NULL DEFAULT '{}'` for sqlite if the neighbouring JSON columns there are `TEXT`; check what `features` uses in `store/sqlite/migrations.go` and match it. Mongo needs no migration.

Add `Quantity map[string]int64` to each backend's subscription model with the appropriate `bun` or `bson` tag, and map it in both directions in each `toSubscriptionModel` / `fromSubscriptionModel` pair. A nil map marshals to `{}` on the way out; initialise it to an empty map on the way in so callers never index a nil map, matching how `toCouponModel` handles `Metadata`.

Check `store/memory/store.go`'s `CreateSubscription` and `UpdateSubscription`: if they store the pointer directly, nothing changes; if they copy field by field, add the field.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go build ./... && go test ./...`

Expected: build clean, all tests pass including the two new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add subscription/ store/
git commit -m "feat(subscription): carry per-feature quantities for seat pricing"
```

---

### Task 9: Rebuild `GenerateInvoice`

The orchestration. Assembles base, overage, seat, discount and tax in that order, replacing the version whose overage line items are all zero and whose tax is never calculated.

**Files:**
- Modify: `ledger.go:497-573` (`GenerateInvoice`)
- Create: `invoice_generate_test.go` (repository root, package `ledger`)

**Interfaces:**
- Consumes: `invoice.ComputeOverage` (Task 3), `types.Money.Percent` (Task 1), `Ledger.ApplyCoupon` and `l.store.ListAppliedCoupons` (Task 7), `Subscription.Quantity` (Task 8), `l.plugins.GetTaxCalculators()`.
- Produces: no new exported names. `GenerateInvoice` keeps its signature.

**Line item order, which the tests pin:** base, then usage overage per metered feature in plan order, then seats per seat feature in plan order, then one discount per applied coupon, then one tax line.

- [ ] **Step 1: Write the failing test**

Create `invoice_generate_test.go`:

```go
package ledger

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/xraph/ledger/coupon"
	"github.com/xraph/ledger/id"
	"github.com/xraph/ledger/invoice"
	"github.com/xraph/ledger/meter"
	"github.com/xraph/ledger/plan"
	"github.com/xraph/ledger/store/memory"
	"github.com/xraph/ledger/subscription"
	"github.com/xraph/ledger/types"
)

// billingFixture builds a ledger whose single plan charges $49.00 a month,
// includes 1000 api_calls, and prices overage at 3c a call on a graduated
// ladder with no upper bound.
func billingFixture(t *testing.T) (*Ledger, *memory.Store, *subscription.Subscription) {
	t.Helper()
	ctx := context.Background()

	s := memory.New()
	l := New(s)

	p := &plan.Plan{
		Entity:   types.NewEntity(),
		ID:       id.NewPlanID(),
		Name:     "Pro",
		Slug:     "pro",
		Currency: "usd",
		Status:   plan.StatusActive,
		AppID:    "app_1",
		Features: []plan.Feature{
			{
				ID: id.NewFeatureID(), Key: "api_calls", Name: "API calls",
				Type: plan.FeatureMetered, Limit: 1000, Period: plan.PeriodMonthly,
			},
		},
		Pricing: &plan.Pricing{
			ID:            id.NewPriceID(),
			BaseAmount:    types.USD(4900),
			BillingPeriod: plan.PeriodMonthly,
			Tiers: []plan.PriceTier{
				{FeatureKey: "api_calls", Type: plan.TierGraduated, UpTo: 0, UnitAmount: types.USD(3)},
			},
		},
	}
	if err := s.CreatePlan(ctx, p); err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}

	sub := &subscription.Subscription{
		Entity:             types.NewEntity(),
		ID:                 id.NewSubscriptionID(),
		TenantID:           "tenant_1",
		PlanID:             p.ID,
		Status:             subscription.StatusActive,
		CurrentPeriodStart: time.Now().UTC().Add(-24 * time.Hour),
		CurrentPeriodEnd:   time.Now().UTC().Add(24 * time.Hour),
		AppID:              "app_1",
	}
	if err := s.CreateSubscription(ctx, sub); err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	return l, s, sub
}

func ingest(t *testing.T, s *memory.Store, sub *subscription.Subscription, key string, qty int64) {
	t.Helper()
	err := s.IngestBatch(context.Background(), []*meter.UsageEvent{{
		ID: id.NewUsageEventID(), TenantID: sub.TenantID, AppID: sub.AppID,
		FeatureKey: key, Quantity: qty, Timestamp: time.Now().UTC(),
	}})
	if err != nil {
		t.Fatalf("IngestBatch: %v", err)
	}
}

func lineItemsOfType(inv *invoice.Invoice, kind invoice.LineItemType) []invoice.LineItem {
	var out []invoice.LineItem
	for _, li := range inv.LineItems {
		if li.Type == kind {
			out = append(out, li)
		}
	}
	return out
}

func TestGenerateInvoiceChargesTheBaseFee(t *testing.T) {
	l, _, sub := billingFixture(t)

	inv, err := l.GenerateInvoice(context.Background(), sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	base := lineItemsOfType(inv, invoice.LineItemBase)
	if len(base) != 1 {
		t.Fatalf("got %d base line items, want 1", len(base))
	}
	if !base[0].Amount.Equal(types.USD(4900)) {
		t.Errorf("got base %v, want $49.00", base[0].Amount)
	}
	if !inv.Total.Equal(types.USD(4900)) {
		t.Errorf("got total %v, want $49.00", inv.Total)
	}
}

func TestGenerateInvoicePricesOverageFromTiers(t *testing.T) {
	ctx := context.Background()
	l, s, sub := billingFixture(t)

	// 1500 calls against a 1000 allowance: 500 billable at 3c = $15.00.
	ingest(t, s, sub, "api_calls", 1500)

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	over := lineItemsOfType(inv, invoice.LineItemOverage)
	if len(over) != 1 {
		t.Fatalf("got %d overage line items, want 1", len(over))
	}
	if !over[0].Amount.Equal(types.USD(1500)) {
		t.Errorf("got overage %v, want $15.00 (this is the bug this task exists to fix: it used to be zero)", over[0].Amount)
	}
	if over[0].Quantity != 500 {
		t.Errorf("got overage quantity %d, want 500", over[0].Quantity)
	}
	if !inv.Total.Equal(types.USD(4900 + 1500)) {
		t.Errorf("got total %v, want $64.00", inv.Total)
	}
}

func TestGenerateInvoiceChargesSeats(t *testing.T) {
	ctx := context.Background()
	l, s, sub := billingFixture(t)

	p, err := s.GetPlan(ctx, sub.PlanID)
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	p.Features = append(p.Features, plan.Feature{
		ID: id.NewFeatureID(), Key: "seats", Name: "Team members",
		Type: plan.FeatureSeat, Limit: 0, Period: plan.PeriodNone,
	})
	p.Pricing.Tiers = append(p.Pricing.Tiers, plan.PriceTier{
		FeatureKey: "seats", Type: plan.TierGraduated, UpTo: 0, UnitAmount: types.USD(800),
	})
	if err := s.UpdatePlan(ctx, p); err != nil {
		t.Fatalf("UpdatePlan: %v", err)
	}

	sub.Quantity = map[string]int64{"seats": 5}
	if err := s.UpdateSubscription(ctx, sub); err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	seats := lineItemsOfType(inv, invoice.LineItemSeat)
	if len(seats) != 1 {
		t.Fatalf("got %d seat line items, want 1", len(seats))
	}
	if seats[0].Quantity != 5 {
		t.Errorf("got seat quantity %d, want 5", seats[0].Quantity)
	}
	if !seats[0].Amount.Equal(types.USD(4000)) {
		t.Errorf("got seat charge %v, want $40.00", seats[0].Amount)
	}
}

func TestGenerateInvoiceAppliesPercentageCoupon(t *testing.T) {
	ctx := context.Background()
	l, s, sub := billingFixture(t)

	if err := s.CreateCoupon(ctx, &coupon.Coupon{
		Entity: types.NewEntity(), ID: id.NewCouponID(), Code: "LAUNCH10",
		Type: coupon.CouponTypePercentage, Percentage: 10,
		Currency: "usd", AppID: "app_1",
	}); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}
	if _, err := l.ApplyCoupon(ctx, sub.ID, "LAUNCH10"); err != nil {
		t.Fatalf("ApplyCoupon: %v", err)
	}

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	if !inv.DiscountAmount.Equal(types.USD(490)) {
		t.Errorf("got discount %v, want $4.90", inv.DiscountAmount)
	}
	if !inv.Total.Equal(types.USD(4410)) {
		t.Errorf("got total %v, want $44.10", inv.Total)
	}

	disc := lineItemsOfType(inv, invoice.LineItemDiscount)
	if len(disc) != 1 {
		t.Fatalf("got %d discount line items, want 1", len(disc))
	}
	if !strings.Contains(disc[0].Description, "LAUNCH10") {
		t.Errorf("discount line item %q does not name the coupon", disc[0].Description)
	}
}

func TestGenerateInvoiceStacksPercentageBeforeAmount(t *testing.T) {
	ctx := context.Background()
	l, s, sub := billingFixture(t)

	// $49.00, less 10% ($4.90), less $5.00 flat = $39.10.
	for _, c := range []*coupon.Coupon{
		{
			Entity: types.NewEntity(), ID: id.NewCouponID(), Code: "PCT10",
			Type: coupon.CouponTypePercentage, Percentage: 10,
			Currency: "usd", AppID: "app_1",
		},
		{
			Entity: types.NewEntity(), ID: id.NewCouponID(), Code: "FLAT5",
			Type: coupon.CouponTypeAmount, Amount: types.USD(500),
			Currency: "usd", AppID: "app_1",
		},
	} {
		if err := s.CreateCoupon(ctx, c); err != nil {
			t.Fatalf("CreateCoupon %s: %v", c.Code, err)
		}
		if _, err := l.ApplyCoupon(ctx, sub.ID, c.Code); err != nil {
			t.Fatalf("ApplyCoupon %s: %v", c.Code, err)
		}
	}

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	if !inv.DiscountAmount.Equal(types.USD(990)) {
		t.Errorf("got discount %v, want $9.90 (10%% of $49.00 plus $5.00)", inv.DiscountAmount)
	}
	if !inv.Total.Equal(types.USD(3910)) {
		t.Errorf("got total %v, want $39.10", inv.Total)
	}
}

// Review Focus 2.
func TestGenerateInvoiceClampsTotalAtZero(t *testing.T) {
	ctx := context.Background()
	l, s, sub := billingFixture(t)

	if err := s.CreateCoupon(ctx, &coupon.Coupon{
		Entity: types.NewEntity(), ID: id.NewCouponID(), Code: "HUGE",
		Type: coupon.CouponTypeAmount, Amount: types.USD(100000),
		Currency: "usd", AppID: "app_1",
	}); err != nil {
		t.Fatalf("CreateCoupon: %v", err)
	}
	if _, err := l.ApplyCoupon(ctx, sub.ID, "HUGE"); err != nil {
		t.Fatalf("ApplyCoupon: %v", err)
	}

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	if inv.Total.IsNegative() {
		t.Errorf("got a negative total %v; an over-large discount must clamp at zero", inv.Total)
	}
	if !inv.Total.IsZero() {
		t.Errorf("got total %v, want zero", inv.Total)
	}
	if !inv.DiscountAmount.Equal(types.USD(100000)) {
		t.Errorf("got discount %v, want the coupon's full $1000.00 recorded even though it exceeds the subtotal", inv.DiscountAmount)
	}
}

// stubTaxCalculator returns whatever it is given, so a test can hand back
// a wrong type on purpose.
type stubTaxCalculator struct {
	result interface{}
	err    error
}

func (s *stubTaxCalculator) Name() string { return "stub-tax" }
func (s *stubTaxCalculator) CalculateTax(_ context.Context, _ interface{}, _ string) (interface{}, error) {
	return s.result, s.err
}

func TestGenerateInvoiceCalculatesTax(t *testing.T) {
	ctx := context.Background()
	s := memory.New()
	l := New(s, WithPlugin(&stubTaxCalculator{result: types.USD(980)}))

	p := &plan.Plan{
		Entity: types.NewEntity(), ID: id.NewPlanID(), Slug: "pro",
		Currency: "usd", Status: plan.StatusActive, AppID: "app_1",
		Pricing: &plan.Pricing{ID: id.NewPriceID(), BaseAmount: types.USD(4900)},
	}
	_ = s.CreatePlan(ctx, p)
	sub := &subscription.Subscription{
		Entity: types.NewEntity(), ID: id.NewSubscriptionID(),
		TenantID: "tenant_1", PlanID: p.ID,
		Status: subscription.StatusActive, AppID: "app_1",
	}
	_ = s.CreateSubscription(ctx, sub)

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	if !inv.TaxAmount.Equal(types.USD(980)) {
		t.Errorf("got tax %v, want $9.80", inv.TaxAmount)
	}
	if !inv.Total.Equal(types.USD(5880)) {
		t.Errorf("got total %v, want $58.80", inv.Total)
	}
	if len(lineItemsOfType(inv, invoice.LineItemTax)) != 1 {
		t.Error("no tax line item was emitted")
	}
}

// An invalid ladder must fail generation rather than bill $0 (ruling R4).
func TestGenerateInvoiceRejectsAnInvalidTierLadder(t *testing.T) {
	ctx := context.Background()
	l, s, sub := billingFixture(t)
	ingest(t, s, sub, "api_calls", 1500)

	p, err := s.GetPlan(ctx, sub.PlanID)
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	// Mixed tier types on one feature cannot be priced unambiguously.
	p.Pricing.Tiers = append(p.Pricing.Tiers, plan.PriceTier{
		FeatureKey: "api_calls", Type: plan.TierFlat, UpTo: 5000, FlatAmount: types.USD(900),
	})
	if err := s.UpdatePlan(ctx, p); err != nil {
		t.Fatalf("UpdatePlan: %v", err)
	}

	_, err = l.GenerateInvoice(ctx, sub.ID)
	if !errors.Is(err, invoice.ErrInvalidTiers) {
		t.Fatalf("got %v, want an error wrapping invoice.ErrInvalidTiers", err)
	}
}

// Review Focus 3.
func TestGenerateInvoiceRejectsATaxCalculatorReturningTheWrongType(t *testing.T) {
	ctx := context.Background()
	s := memory.New()
	l := New(s, WithPlugin(&stubTaxCalculator{result: "nine dollars eighty"}))

	p := &plan.Plan{
		Entity: types.NewEntity(), ID: id.NewPlanID(), Slug: "pro",
		Currency: "usd", Status: plan.StatusActive, AppID: "app_1",
		Pricing: &plan.Pricing{ID: id.NewPriceID(), BaseAmount: types.USD(4900)},
	}
	_ = s.CreatePlan(ctx, p)
	sub := &subscription.Subscription{
		Entity: types.NewEntity(), ID: id.NewSubscriptionID(),
		TenantID: "tenant_1", PlanID: p.ID,
		Status: subscription.StatusActive, AppID: "app_1",
	}
	_ = s.CreateSubscription(ctx, sub)

	_, err := l.GenerateInvoice(ctx, sub.ID)
	if err == nil {
		t.Fatal("got nil error; a tax plugin returning a non-Money value must fail generation rather than silently contributing nothing")
	}
	if !strings.Contains(err.Error(), "stub-tax") {
		t.Errorf("error %q does not name the offending plugin", err.Error())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test . -run TestGenerateInvoice -v`

Expected: FAIL. `TestGenerateInvoiceChargesTheBaseFee` passes (that part already works). The overage test fails with `got overage $0.00, want $15.00`. The seat, coupon, stacking, clamp and both tax tests fail.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `GenerateInvoice` in `ledger.go` from the metered-usage loop through the total calculation. The base-fee block above it is unchanged. The new body, from after the base fee:

```go
	// 2. Metered usage overage, priced from the plan's tiers.
	var tiers []plan.PriceTier
	if p.Pricing != nil {
		tiers = p.Pricing.Tiers
	}

	for _, pf := range p.Features {
		if pf.Type != plan.FeatureMetered {
			continue
		}

		used, aggErr := l.store.Aggregate(ctx, sub.TenantID, sub.AppID, pf.Key, pf.Period)
		if aggErr != nil {
			return nil, fmt.Errorf("aggregate usage for feature %q: %w", pf.Key, aggErr)
		}

		billable := used - pf.Limit
		if pf.Limit < 0 || billable <= 0 {
			continue
		}

		featureTiers := tiersFor(tiers, pf.Key)
		if vErr := invoice.ValidateTiers(featureTiers, p.Currency); vErr != nil {
			return nil, fmt.Errorf("plan %s feature %q: %w", p.ID, pf.Key, vErr)
		}

		amount := invoice.ComputeOverage(featureTiers, used, pf.Limit, p.Currency)
		if amount.IsZero() {
			continue
		}

		inv.LineItems = append(inv.LineItems, invoice.LineItem{
			ID:          id.NewLineItemID(),
			InvoiceID:   inv.ID,
			FeatureKey:  pf.Key,
			Description: pf.Name + " overage",
			Quantity:    billable,
			UnitAmount:  types.Zero(p.Currency),
			Amount:      amount,
			Type:        invoice.LineItemOverage,
		})
		inv.Subtotal = inv.Subtotal.Add(amount)
	}

	// 3. Seat charges, from the quantities carried on the subscription.
	for _, pf := range p.Features {
		if pf.Type != plan.FeatureSeat {
			continue
		}

		seats := sub.Quantity[pf.Key]
		if seats <= 0 {
			continue
		}

		featureTiers := tiersFor(tiers, pf.Key)
		if vErr := invoice.ValidateTiers(featureTiers, p.Currency); vErr != nil {
			return nil, fmt.Errorf("plan %s feature %q: %w", p.ID, pf.Key, vErr)
		}

		amount := invoice.ComputeOverage(featureTiers, seats, 0, p.Currency)
		if amount.IsZero() {
			continue
		}

		inv.LineItems = append(inv.LineItems, invoice.LineItem{
			ID:          id.NewLineItemID(),
			InvoiceID:   inv.ID,
			FeatureKey:  pf.Key,
			Description: pf.Name,
			Quantity:    seats,
			UnitAmount:  types.Zero(p.Currency),
			Amount:      amount,
			Type:        invoice.LineItemSeat,
		})
		inv.Subtotal = inv.Subtotal.Add(amount)
	}

	// 4. Coupon discounts. Percentage coupons compute against the subtotal
	// as it stands before any discount, so two stacked percentages do not
	// compound. Amount coupons subtract flat. ApplyCoupon has already
	// refused any coupon whose currency differs from the plan's, which is
	// what keeps Money.Add from panicking here.
	applied, couponErr := l.store.ListAppliedCoupons(ctx, sub.ID)
	if couponErr != nil {
		return nil, fmt.Errorf("list applied coupons: %w", couponErr)
	}

	discountBase := inv.Subtotal
	for _, c := range applied {
		var amount types.Money
		switch c.Type {
		case coupon.CouponTypePercentage:
			amount = discountBase.Percent(c.Percentage)
		case coupon.CouponTypeAmount:
			amount = types.Money{Amount: c.Amount.Amount, Currency: p.Currency}
		default:
			continue
		}
		if amount.IsZero() {
			continue
		}

		inv.LineItems = append(inv.LineItems, invoice.LineItem{
			ID:          id.NewLineItemID(),
			InvoiceID:   inv.ID,
			Description: "Discount " + c.Code,
			Quantity:    1,
			UnitAmount:  amount.Negate(),
			Amount:      amount.Negate(),
			Type:        invoice.LineItemDiscount,
		})
		inv.DiscountAmount = inv.DiscountAmount.Add(amount)
	}

	// 5. Tax, from whichever plugins provide it. The interface returns
	// interface{}, so a plugin that hands back the wrong type fails
	// generation rather than silently contributing nothing.
	for _, tc := range l.plugins.GetTaxCalculators() {
		raw, taxErr := tc.CalculateTax(ctx, inv.Subtotal, sub.TenantID)
		if taxErr != nil {
			return nil, fmt.Errorf("tax calculator %q: %w", tc.Name(), taxErr)
		}
		if raw == nil {
			continue
		}

		amount, ok := raw.(types.Money)
		if !ok {
			return nil, fmt.Errorf("tax calculator %q returned %T, want types.Money", tc.Name(), raw)
		}
		if amount.Currency != "" && amount.Currency != p.Currency {
			return nil, fmt.Errorf("tax calculator %q returned %s, want %s",
				tc.Name(), amount.Currency, p.Currency)
		}

		inv.TaxAmount = inv.TaxAmount.Add(types.Money{Amount: amount.Amount, Currency: p.Currency})
	}

	if inv.TaxAmount.IsPositive() {
		inv.LineItems = append(inv.LineItems, invoice.LineItem{
			ID:          id.NewLineItemID(),
			InvoiceID:   inv.ID,
			Description: "Tax",
			Quantity:    1,
			UnitAmount:  inv.TaxAmount,
			Amount:      inv.TaxAmount,
			Type:        invoice.LineItemTax,
		})
	}

	// Total, clamped at zero. A discount larger than the bill produces a
	// free invoice, never a credit: Ledger has no refund path and a
	// negative total would be one by accident.
	inv.Total = inv.Subtotal.Add(inv.TaxAmount).Subtract(inv.DiscountAmount)
	if inv.Total.IsNegative() {
		inv.Total = types.Zero(p.Currency)
	}
```

Add the helper at the bottom of `ledger.go`, beside `extractTenantID`:

```go
// tiersFor returns the tiers belonging to one feature key.
func tiersFor(tiers []plan.PriceTier, featureKey string) []plan.PriceTier {
	out := make([]plan.PriceTier, 0, len(tiers))
	for _, t := range tiers {
		if t.FeatureKey == featureKey {
			out = append(out, t)
		}
	}

	return out
}
```

Add `"github.com/xraph/ledger/coupon"` to `ledger.go`'s imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test . -v`

Expected: PASS, all 9 `TestGenerateInvoice*` tests plus the Task 7 coupon tests.

Then run the whole suite: `go build ./... && go test ./...`

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add ledger.go invoice_generate_test.go
git commit -m "feat(ledger): price overage, seats, discounts and tax when generating invoices"
```

---

### Task 10: The `UsageAggregator` and `PricingStrategy` hooks

The last two registered-but-never-called hooks. Each gets a real call site inside
`GenerateInvoice`, selected by name from metadata, with a fallback to the built-in path
when the named plugin is not registered.

**Rewritten before dispatch.** The first draft of this task added a `ComputeOverageWith`
helper that nothing called, declared a `stubPricingStrategy` no test used, gave its stub
aggregator a signature that does not satisfy the interface, and had the aggregator path
query usage with no time bounds, so a plugin would have billed all-time usage. This
version fixes all four. See ledger ruling R13.

**Files:**
- Modify: `plugin/registry.go` (add `GetUsageAggregator` beside `GetPricingStrategy`)
- Create: `plugin/registry_test.go`
- Modify: `ledger.go` (add `aggregateUsage` and `priceFeature`; route both `GenerateInvoice` loops through them)
- Modify: `invoice_generate_test.go` (append)

Do NOT add `ComputeOverageWith` to `invoice/pricing.go`. `priceFeature` replaces it.

**Interfaces:**
- Consumes: `invoice.ComputeOverage` and `invoice.ValidateTiers` (Tasks 2-3 as fixed), the `GenerateInvoice` body (Task 9), `plugin.Registry.GetPricingStrategy` (exists at `plugin/registry.go:493`).
- Produces:
  - `func (r *Registry) GetUsageAggregator(name string) UsageAggregator`
  - `func (l *Ledger) aggregateUsage(ctx context.Context, sub *subscription.Subscription, pf plan.Feature) (int64, error)` — unexported.
  - `func (l *Ledger) priceFeature(p *plan.Plan, pf plan.Feature, featureTiers []plan.PriceTier, usage, included int64) (types.Money, error)` — unexported.

**Selection rules.**
- Aggregator: `pf.Metadata["aggregator"]`. Empty means the store's `Aggregate`. A name that is not registered logs a warning and falls back to the store.
- Pricing strategy: `pf.Metadata["pricing_strategy"]`, else `p.Metadata["pricing_strategy"]`. Empty means `invoice.ComputeOverage`. A name that is not registered logs a warning and falls back.
- A registered strategy is NOT called when `included < 0` (unlimited) or `usage <= included`; those return zero, exactly as the built-in path does.
- A strategy's result must be a `types.Money` in the plan's currency (case-insensitive) and non-negative. Anything else fails generation with an error naming the strategy.

**Aggregation window.** The aggregator path queries events in the subscription's billing
period, `QueryOpts{FeatureKey: pf.Key, Start: sub.CurrentPeriodStart, End: sub.CurrentPeriodEnd}`.
The store's own `Aggregate` uses the start of the calendar period relative to now, which
is pre-existing behaviour this task does not change. The two agree for calendar-aligned
subscriptions and differ otherwise. Task 11 records that in `MIGRATION.md`.

- [ ] **Step 1: Write the failing tests**

Create `plugin/registry_test.go`:

```go
package plugin

import (
	"context"
	"testing"
)

// stubAggregator satisfies UsageAggregator exactly; see plugin.go:221-225.
type stubAggregator struct{ name string }

func (s *stubAggregator) Name() string           { return s.name }
func (s *stubAggregator) AggregatorName() string { return s.name }
func (s *stubAggregator) Aggregate(_ context.Context, events []interface{}) (int64, error) {
	return int64(len(events)), nil
}

var _ UsageAggregator = (*stubAggregator)(nil)

func TestGetUsageAggregatorByName(t *testing.T) {
	r := NewRegistry()

	if got := r.GetUsageAggregator("absent"); got != nil {
		t.Errorf("got %v for an unregistered name, want nil", got)
	}

	if err := r.Register(&stubAggregator{name: "count"}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if got := r.GetUsageAggregator("count"); got == nil {
		t.Error("got nil for a registered aggregator, want it returned by name")
	}
}
```

Append to `invoice_generate_test.go`. The stubs live in package `ledger`, so they
implement the plugin interfaces structurally:

```go
// countingAggregator returns a fixed total and records how many events it saw.
type countingAggregator struct {
	total int64
	seen  int
}

func (a *countingAggregator) Name() string           { return "stub-agg" }
func (a *countingAggregator) AggregatorName() string { return "stub-agg" }
func (a *countingAggregator) Aggregate(_ context.Context, events []interface{}) (int64, error) {
	a.seen = len(events)
	return a.total, nil
}

type fixedStrategy struct {
	result interface{}
	calls  int
}

func (s *fixedStrategy) Name() string         { return "stub-pricing" }
func (s *fixedStrategy) StrategyName() string { return "stub-pricing" }
func (s *fixedStrategy) Compute(_ []interface{}, _, _ int64, _ string) interface{} {
	s.calls++
	return s.result
}

// hookFixture builds billingFixture's plan and subscription on a ledger that
// carries the given plugins, and lets the caller edit the plan first.
func hookFixture(t *testing.T, edit func(p *plan.Plan), plugins ...plugin.Plugin) (*Ledger, *memory.Store, *subscription.Subscription) {
	t.Helper()
	ctx := context.Background()

	opts := make([]Option, 0, len(plugins))
	for _, pl := range plugins {
		opts = append(opts, WithPlugin(pl))
	}

	// Reuse billingFixture for the plan and subscription, then rebuild the
	// ledger over the same store with the plugins attached.
	_, s, sub := billingFixture(t)
	l := New(s, opts...)

	p, err := s.GetPlan(ctx, sub.PlanID)
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	edit(p)
	if err := s.UpdatePlan(ctx, p); err != nil {
		t.Fatalf("UpdatePlan: %v", err)
	}

	return l, s, sub
}

func setFeatureMeta(key, value string) func(*plan.Plan) {
	return func(p *plan.Plan) {
		if p.Features[0].Metadata == nil {
			p.Features[0].Metadata = map[string]string{}
		}
		p.Features[0].Metadata[key] = value
	}
}

func overageAmount(t *testing.T, inv *invoice.Invoice) types.Money {
	t.Helper()
	over := lineItemsOfType(inv, invoice.LineItemOverage)
	if len(over) == 0 {
		return types.Zero("usd")
	}
	if len(over) != 1 {
		t.Fatalf("got %d overage line items, want at most 1", len(over))
	}
	return over[0].Amount
}

func TestGenerateInvoiceUsesANamedUsageAggregator(t *testing.T) {
	ctx := context.Background()
	agg := &countingAggregator{total: 1500}
	l, s, sub := hookFixture(t, setFeatureMeta("aggregator", "stub-agg"), agg)

	// One event inside the billing period, one before it. The aggregator
	// must see only the first.
	ingest(t, s, sub, "api_calls", 1)
	if err := s.IngestBatch(ctx, []*meter.UsageEvent{{
		ID: id.NewUsageEventID(), TenantID: sub.TenantID, AppID: sub.AppID,
		FeatureKey: "api_calls", Quantity: 1,
		Timestamp: sub.CurrentPeriodStart.Add(-time.Hour),
	}}); err != nil {
		t.Fatalf("IngestBatch: %v", err)
	}

	inv, err := l.GenerateInvoice(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}

	// The aggregator reported 1500 against a 1000 allowance at 3c.
	if got := overageAmount(t, inv); !got.Equal(types.USD(1500)) {
		t.Errorf("got overage %v, want $15.00 priced from the aggregator's total", got)
	}
	if agg.seen != 1 {
		t.Errorf("aggregator saw %d events, want 1: it must be bounded to the billing period", agg.seen)
	}
}

func TestGenerateInvoiceFallsBackWhenTheAggregatorIsNotRegistered(t *testing.T) {
	l, s, sub := hookFixture(t, setFeatureMeta("aggregator", "absent"))
	ingest(t, s, sub, "api_calls", 1500)

	inv, err := l.GenerateInvoice(context.Background(), sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}
	if got := overageAmount(t, inv); !got.Equal(types.USD(1500)) {
		t.Errorf("got overage %v, want the store's $15.00", got)
	}
}

func TestGenerateInvoiceUsesANamedPricingStrategy(t *testing.T) {
	cases := []struct {
		name string
		edit func(*plan.Plan)
	}{
		{"named on the feature", setFeatureMeta("pricing_strategy", "stub-pricing")},
		{"named on the plan", func(p *plan.Plan) {
			p.Metadata = map[string]string{"pricing_strategy": "stub-pricing"}
		}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			strat := &fixedStrategy{result: types.USD(12345)}
			l, s, sub := hookFixture(t, c.edit, strat)
			ingest(t, s, sub, "api_calls", 1500)

			inv, err := l.GenerateInvoice(context.Background(), sub.ID)
			if err != nil {
				t.Fatalf("GenerateInvoice: %v", err)
			}
			if strat.calls != 1 {
				t.Errorf("strategy called %d times, want 1", strat.calls)
			}
			if got := overageAmount(t, inv); !got.Equal(types.USD(12345)) {
				t.Errorf("got overage %v, want the strategy's $123.45", got)
			}
		})
	}
}

func TestGenerateInvoiceDoesNotCallAStrategyWithinTheAllowance(t *testing.T) {
	strat := &fixedStrategy{result: types.USD(12345)}
	l, s, sub := hookFixture(t, setFeatureMeta("pricing_strategy", "stub-pricing"), strat)
	ingest(t, s, sub, "api_calls", 500)

	inv, err := l.GenerateInvoice(context.Background(), sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}
	if strat.calls != 0 {
		t.Errorf("strategy called %d times for usage inside the allowance, want 0", strat.calls)
	}
	if got := overageAmount(t, inv); !got.IsZero() {
		t.Errorf("got overage %v, want none", got)
	}
}

func TestGenerateInvoiceRejectsABadStrategyResult(t *testing.T) {
	cases := []struct {
		name   string
		result interface{}
	}{
		{"wrong type", "one hundred dollars"},
		{"wrong currency", types.EUR(100)},
		{"negative", types.USD(-100)},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			l, s, sub := hookFixture(t, setFeatureMeta("pricing_strategy", "stub-pricing"),
				&fixedStrategy{result: c.result})
			ingest(t, s, sub, "api_calls", 1500)

			_, err := l.GenerateInvoice(context.Background(), sub.ID)
			if err == nil {
				t.Fatal("got nil error; a bad strategy result must fail generation")
			}
			if !strings.Contains(err.Error(), "stub-pricing") {
				t.Errorf("error %q does not name the strategy", err.Error())
			}
		})
	}
}

func TestGenerateInvoiceFallsBackWhenTheStrategyIsNotRegistered(t *testing.T) {
	l, s, sub := hookFixture(t, setFeatureMeta("pricing_strategy", "absent"))
	ingest(t, s, sub, "api_calls", 1500)

	inv, err := l.GenerateInvoice(context.Background(), sub.ID)
	if err != nil {
		t.Fatalf("GenerateInvoice: %v", err)
	}
	if got := overageAmount(t, inv); !got.Equal(types.USD(1500)) {
		t.Errorf("got overage %v, want the built-in $15.00", got)
	}
}
```

Add `"github.com/xraph/ledger/plugin"` to the test file's imports if it is not there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go test ./plugin/ . -v`

Expected: FAIL to compile, `r.GetUsageAggregator undefined`. After adding only the
registry method, the invoice tests should fail on behaviour: the named aggregator and
strategy are ignored, so the aggregator test sees `seen == 0` and the strategy tests see
`calls == 0` and $15.00 rather than $123.45.

- [ ] **Step 3: Implement**

Add to `plugin/registry.go`, beside `GetPricingStrategy`, matching its locking:

```go
// GetUsageAggregator returns the aggregator registered under name, or nil.
func (r *Registry) GetUsageAggregator(name string) UsageAggregator {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.usageAggregators[name]
}
```

Add to `ledger.go`:

```go
// aggregateUsage totals a feature's usage for billing. A feature naming a
// registered aggregator under metadata key "aggregator" is aggregated by the
// plugin over the subscription's billing period; anything else goes through
// the store. An unregistered name falls back to the store rather than
// failing: a plan referring to a plugin that is not installed should still
// bill.
func (l *Ledger) aggregateUsage(ctx context.Context, sub *subscription.Subscription, pf plan.Feature) (int64, error) {
	name := pf.Metadata["aggregator"]
	if name == "" {
		return l.store.Aggregate(ctx, sub.TenantID, sub.AppID, pf.Key, pf.Period)
	}

	agg := l.plugins.GetUsageAggregator(name)
	if agg == nil {
		l.logger.Warn("ledger: feature names an unregistered usage aggregator; using the store")
		return l.store.Aggregate(ctx, sub.TenantID, sub.AppID, pf.Key, pf.Period)
	}

	events, err := l.store.QueryUsage(ctx, sub.TenantID, sub.AppID, meter.QueryOpts{
		FeatureKey: pf.Key,
		Start:      sub.CurrentPeriodStart,
		End:        sub.CurrentPeriodEnd,
	})
	if err != nil {
		return 0, fmt.Errorf("query usage for aggregator %q: %w", name, err)
	}

	boxed := make([]interface{}, len(events))
	for i := range events {
		boxed[i] = events[i]
	}

	return agg.Aggregate(ctx, boxed)
}

// priceFeature prices one feature's billable usage. featureTiers must already
// have passed invoice.ValidateTiers.
//
// A feature naming a registered pricing strategy under metadata key
// "pricing_strategy", or failing that a plan naming one, is priced by the
// plugin. Everything else uses the built-in tier models. The plugin is never
// asked to price usage the allowance covers, and its answer must be a
// non-negative Money in the plan's currency.
func (l *Ledger) priceFeature(p *plan.Plan, pf plan.Feature, featureTiers []plan.PriceTier, usage, included int64) (types.Money, error) {
	currency := strings.ToLower(p.Currency)

	name := pf.Metadata["pricing_strategy"]
	if name == "" {
		name = p.Metadata["pricing_strategy"]
	}
	if name == "" {
		return invoice.ComputeOverage(featureTiers, usage, included, currency), nil
	}

	strategy := l.plugins.GetPricingStrategy(name)
	if strategy == nil {
		l.logger.Warn("ledger: plan names an unregistered pricing strategy; using the built-in tiers")
		return invoice.ComputeOverage(featureTiers, usage, included, currency), nil
	}

	if included < 0 || usage <= included {
		return types.Zero(currency), nil
	}

	boxed := make([]interface{}, len(featureTiers))
	for i := range featureTiers {
		boxed[i] = featureTiers[i]
	}

	raw := strategy.Compute(boxed, usage, included, currency)
	amount, ok := raw.(types.Money)
	if !ok {
		return types.Money{}, fmt.Errorf("pricing strategy %q returned %T, want types.Money", name, raw)
	}
	if amount.Currency != "" && !strings.EqualFold(amount.Currency, currency) {
		return types.Money{}, fmt.Errorf("pricing strategy %q returned %s, want %s", name, amount.Currency, currency)
	}
	if amount.IsNegative() {
		return types.Money{}, fmt.Errorf("pricing strategy %q returned a negative amount %v", name, amount)
	}

	return types.Money{Amount: amount.Amount, Currency: currency}, nil
}
```

Check `l.logger.Warn`'s signature against an existing call in `ledger.go` and match it;
`go-utils/log` may want structured fields rather than a bare message. Add `"strings"` to
`ledger.go`'s imports if absent.

Route `GenerateInvoice` through both. In the metered loop:

```go
		used, aggErr := l.aggregateUsage(ctx, sub, pf)
```

replacing the direct `l.store.Aggregate` call, and in BOTH the metered and seat loops
replace `amount := invoice.ComputeOverage(featureTiers, <qty>, <included>, p.Currency)` with:

```go
		amount, priceErr := l.priceFeature(p, pf, featureTiers, <qty>, <included>)
		if priceErr != nil {
			return nil, fmt.Errorf("price feature %q: %w", pf.Key, priceErr)
		}
```

keeping each loop's own quantity and allowance arguments.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go build ./... && go test ./... -v`

Expected: PASS everywhere. Every Task 9 invoice test must pass unchanged: with no
metadata, both new functions behave exactly like the calls they replaced.

Then prove the aggregator window is load-bearing: temporarily drop `Start` and `End` from
the `QueryOpts` and confirm `TestGenerateInvoiceUsesANamedUsageAggregator` fails with
`seen == 2`. Restore.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
go build ./... && go test ./...
git add plugin/registry.go plugin/registry_test.go ledger.go invoice_generate_test.go
git commit -m "feat(ledger): invoke usage aggregators and pricing strategies when billing"
```

---

### Task 14: Overflow-safe money and half-open usage windows (after Task 10, before Task 11)

Added during execution (ledger ruling R31). Two billing-correctness defects, both
pre-existing, both made reachable or visible by Phase A.

**A. Integer overflow produces nonsense invoices.** `invoice/pricing.go` multiplies a unit
rate by a quantity and sums tiers in plain `int64`, and `GenerateInvoice` sums line items
with `types.Money.Add`. A plugin aggregator returning `MaxInt64/2` produced an overage line
of **-$46,116,860,184,273,909.07**, and the Total was then clamped to $0.00. Every overflow
must become an error. A wrapped value must never become an invoice. This retires the
overflow minors deferred from Task 1 (`Money.Percent`) and Tasks 2+3 (pricing).

**B. Usage windows are closed at both ends on three backends and open at both on one.**
`QueryUsage` on sqlite, postgres and mongo filters `timestamp >= Start AND timestamp <= End`.
Memory filters strictly `After(Start) && Before(End)`. So on the database backends, an
event stamped exactly at a billing-period boundary is billed in two consecutive invoices,
and memory bills it in neither. Every backend moves to the half-open window `[Start, End)`.

**Files:**
- Modify: `types/money.go`, `types/money_test.go`
- Modify: `invoice/pricing.go`, `invoice/pricing_test.go`
- Modify: `ledger.go`, `invoice_generate_test.go`
- Modify: `store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/store.go`, `store/mongo/store.go`
- Modify: `store/storetest/storetest.go`

**Interfaces produced:**
- `var types.ErrOverflow = errors.New("types: money arithmetic overflow")`
- `func (m Money) CheckedAdd(other Money) (Money, error)`: `ErrOverflow` on int64 overflow, and an error (not a panic) on a currency mismatch.
- `func (m Money) CheckedMultiply(qty int64) (Money, error)`
- `func (m Money) CheckedPercent(pct int) (Money, error)`: same truncation as `Percent`, and `ErrOverflow` if `m.Amount * pct` overflows.
- `invoice.ComputeOverage` changes to return `(types.Money, error)`, wrapping `types.ErrOverflow`. Every internal product and sum in `computeGraduated`, `computeVolume`, `computeFlat` and the differential is checked.

Leave the existing panicking `Add`, `Subtract`, `Multiply` and `Percent` unchanged: other code uses them. Only the billing path moves to the checked forms.

**Part A: rules.**
1. Overflow detection is exact: for addition, check the sign of the result against the operands, or compare with `math.MaxInt64 - b`; for multiplication, `a != 0 && (a*b)/a != b`, or `math/bits`. No floats.
2. `GenerateInvoice` uses the checked forms for every sum it builds (subtotal, discount, net, tax, total) and propagates `ComputeOverage`'s error. Every overflow error wraps `types.ErrOverflow` and names the stage or feature.
3. `priceFeature` propagates the error from `ComputeOverage`.

**Part A: tests.**
- `types`: `CheckedAdd` of `USD(math.MaxInt64)` and `USD(1)` gives `ErrOverflow`; `MaxInt64 + 0` is fine; `USD(math.MinInt64)` plus `USD(-1)` gives `ErrOverflow`; a currency mismatch returns an error rather than panicking. `CheckedMultiply` at the boundary, both signs. `CheckedPercent(math.MaxInt64, 2)` gives `ErrOverflow`, and `CheckedPercent` agrees with `Percent` on every existing `TestMoneyPercent` row.
- `invoice`: a graduated unbounded tier at 3c with usage `math.MaxInt64 / 2` gives an error wrapping `types.ErrOverflow`; a volume tier the same; a two-tier graduated ladder whose SUM overflows though each product does not gives an error. Update every existing test call to the new two-value return; no existing expected value changes.
- `ledger_test`: a named aggregator returning `math.MaxInt64 / 2` makes `GenerateInvoice` return an error wrapping `types.ErrOverflow`, and no invoice is stored. A base price plus a seat charge whose sum overflows gives the same.

**Part B: rules.**
1. `QueryUsage` on all four backends: `timestamp >= Start` and `timestamp < End` (mongo `$gte` / `$lt`; memory `!ts.Before(Start) && ts.Before(End)`). A zero Start or End still means unbounded on that side.
2. Memory's `ListCoupons` `Active` filter moves to the rule the database backends and `Ledger.ApplyCoupon` already use: valid on `[ValidFrom, ValidUntil]`, inclusive at both ends (`!now.Before(from) && !now.After(until)`). The instant cannot be tested without an injectable clock. Say so in a comment.
3. Update the UsageAggregator doc comment written in Task 10 to state the half-open window.

**Part B: tests.** A conformance subtest `QueryUsageWindowIsHalfOpen` in `Run`: using second-aligned timestamps (mongo stores milliseconds), ingest events at `Start - 1s`, exactly `Start`, `Start + 1s`, `End - 1s` and exactly `End`, then query `[Start, End)`. Expect exactly the three events at `Start`, `Start + 1s` and `End - 1s`, asserted by id. It must pass on every backend, including postgres and mongo when their env vars are set.

**Verification:**
- `go build ./... && go vet ./... && go test ./... -count=1`
- `go test -race ./... -count=2`
- Postgres: `LEDGER_TEST_POSTGRES_DSN="postgres://twinos:twinos@localhost:5432/ledger_test?sslmode=disable" go test ./store/... -count=1`
- Mongo, if localhost:57017 is still up: only through a uniquely named scratch database you drop afterwards; it belongs to another session.
- Prove A: replace one checked multiply with a plain one and confirm the overflow test fails. Prove B: put `<=` back on one database backend and confirm the conformance subtest fails there.
- `git diff 7fe72a3..HEAD | grep '^+' | grep -c '—'` returns 0.

**Commit:** stage the files above by name, message `fix(ledger): refuse overflowing money and bill usage windows half-open`. No Co-Authored-By trailer.

---

### Task 15: Normalise times on write (after Task 14, before Task 11)

Added during execution (ledger ruling R33). A pre-existing defect that Task 14's review
proved reachable from Ledger's own code.

`Ledger.Meter` stamps `Timestamp: time.Now()` (`ledger.go:323`), and
`Ledger.CreateSubscription` sets `CurrentPeriodStart` and `CurrentPeriodEnd` from
`time.Now()` (`ledger.go:255-256`). A bare `time.Now()` carries the local zone and a
monotonic clock reading. The sqlite store serialises it as, for example,
`"2026-09-29 15:43:04.194044 -0500 CDT m=+0.017196459"`, and cannot parse that back. The
`m=+` suffix is written even on a host whose zone is UTC. On sqlite, then:
- every subscription created through `Ledger.CreateSubscription` fails `GetSubscription`
  and `GenerateInvoice` with a scan error on `current_period_start`;
- metered usage recorded through `Ledger.Meter` fails `QueryUsage`, so a plugin aggregator
  cannot bill it;
- rows stamped in a local zone compare as TEXT against UTC bounds, so an event within the
  UTC offset of a boundary is placed in the wrong period, and silently dropped when it is
  the only row.

The conformance harness missed it because every fixture uses UTC. `types.NewEntity` already
uses `time.Now().UTC()`, and `.UTC()` strips the monotonic reading, so `created_at` and
`updated_at` are safe.

**Files:**
- Modify: `store/sqlite/models.go` (every `toXModel`)
- Modify: `ledger.go` (the engine's own `time.Now()` calls)
- Modify: `store/memory/store.go`, `store/sqlite/store.go`, `store/postgres/store.go`, `store/mongo/store.go` (Part B only)
- Modify: `store/storetest/storetest.go`

**Part A. Normalise at the sqlite boundary.** In every `toXModel` in `store/sqlite/models.go`,
write each `time.Time` as `.UTC()` and each non-nil `*time.Time` as a pointer to its `.UTC()`
value. A zero `time.Time` stays zero (`time.Time{}.UTC()` is still zero, but confirm the
store's zero handling is unchanged). This covers every caller, including SDK code that
calls the store directly. Also change the engine's own `time.Now()` calls in `ledger.go` that
become stored values (`CreateSubscription`, `CancelSubscription`, `Meter`, and any other
you find) to `time.Now().UTC()`, so memory, postgres and mongo hold the same
representation. Leave `time.Now()` used only for elapsed-time measurement alone.

**Part B. Inclusive period start in `Aggregate`.** Store `Aggregate` compares events with the
computed period start using a strict `>` on memory, sqlite and postgres (check mongo). Move
all four to `>=`, matching the half-open `[Start, End)` rule Task 14 set for `QueryUsage`.
The instant cannot be targeted without an injectable clock, because the start is computed
from `time.Now()`. Say so in a comment, and do not invent a clock.

**Tests.** Conformance subtests in `Run`, on every backend:
- `SubscriptionPeriodsRoundTripFromLocalTime`: create a subscription whose
  `CurrentPeriodStart`, `CurrentPeriodEnd` and `CancelAt` are taken from `time.Now()`
  converted `.In(time.FixedZone("CDT", -5*3600))`, KEEPING the monotonic reading (do NOT
  call `.UTC()` or `.Round(0)` in the test). Read it back. Every field must be non-zero and
  `.Equal` to the original to the backend's precision (truncate both sides to the
  millisecond before comparing, since mongo stores milliseconds).
- `UsageEventRoundTripsFromLocalTime`: ingest an event stamped the same way, then
  `QueryUsage` with bounds `[t - 1h, t + 1h)` expressed in UTC, and expect exactly that
  event by id.
- `UsageEventNearABoundaryInALocalZone`: an event stamped at `Start + 30m` expressed in
  UTC-5 must be returned by a query for `[Start, End)` whose bounds are in UTC. This is the
  text-comparison case.

Prove Part A: remove the `.UTC()` normalisation from sqlite's subscription mapping and
confirm `SubscriptionPeriodsRoundTripFromLocalTime` fails on sqlite with the scan error;
restore. Also confirm the new subtests FAIL on sqlite before Part A is written.

**Rows already written.** Existing sqlite rows written in the broken form are not repaired
here. Record in `MIGRATION.md` (Task 11) that a sqlite deployment which used
`Ledger.CreateSubscription` or `Ledger.Meter` before this fix holds rows it cannot read, and
that they need manual repair.

**Verification:** `go build ./... && go vet ./... && go test ./... -count=1`;
`go test -race ./... -count=2`; postgres once; mongo once through a uniquely named scratch
database dropped afterwards (localhost:57017 belongs to another session); em-dash count on
`git diff 7fe72a3..HEAD` stays 0.

**Commit:** stage the files by name, message
`fix(store): write times in UTC so sqlite can read back what Ledger stores`. No
Co-Authored-By trailer.

---

### Task 11: Record the phase in the extension's docs

Phase A changes what the engine does, and the feature inventory the retirement phase depends on starts here, while the templ pages still exist. This task creates `ledger/MIGRATION.md` and seeds it with the engine changes plus the templ inventory.

**Files:**
- Create: `MIGRATION.md` (ledger repository root)
- Modify: `IMPLEMENTATION_PLAN.md` (check off Phase 8, lines 431-435 and 468-472)

**Interfaces:**
- Consumes: everything in Tasks 1 through 10.
- Produces: no code.

- [ ] **Step 1: Inventory the templ dashboard while it still exists**

Read every file under `dashboard/pages/`, `dashboard/components/` and `dashboard/widgets/` and record, per page: its route, its columns, its actions, its filters, its badges and its empty state. Twenty templ files, listed by:

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && find dashboard -name '*.templ' | sort`

This is the only record of what the old dashboard did, and Phase D deletes the source.

- [ ] **Step 2: Write `MIGRATION.md`**

Create `MIGRATION.md` at the ledger repository root with these sections:

- **What this is** — a note that the templ dashboard is being retired and this file is the record, written for whoever switches it off rather than for the people doing the migration.
- **The templ dashboard, as it was** — the per-page inventory from Step 1.
- **What the engine could not do before Phase A** — coupons that nothing redeemed, tier pricing that produced zero-amount line items, tax that was always zero, seats that were a badge label. Name the commits.
- **What Phase A changed** — the ten tasks, one line each.
- **Known constraints** — three things, stated plainly because the next person will otherwise assume otherwise:
  - Sub-cent unit pricing is not representable in `types.Money`. A plan that needs it needs a scaled money type, which is a change to every price in the system and a separate spec.
  - Store coverage is now real but uneven. Memory and SQLite run the conformance suite on every `go test ./...`. PostgreSQL and MongoDB run it only when `LEDGER_TEST_POSTGRES_DSN` or `LEDGER_TEST_MONGO_URI` names a server, and skip otherwise. Say so here, and say which of the two were actually exercised during this phase, because a skipped suite reads exactly like a passing one in `go test` output.
  - `InvoiceFormatter` is still registered and uncalled. It gains its caller in Phase B via the `invoices.export` intent.
  - `store.Aggregate` sums usage from the start of the calendar period relative to now, not from the subscription's `CurrentPeriodStart`. A plugin aggregator is given the subscription's own billing period. The two agree for calendar-aligned subscriptions and disagree otherwise. Pre-existing behaviour across four backends; not changed in Phase A.
  - `provider.Provider.HandleWebhook(ctx, payload)` takes no signature parameter, and `Ledger.HandleWebhook` dispatches to the named provider without verifying anything. This is not a weak verification step, it is the absence of one. Nothing in Ledger signs or hashes today so there is no bug to fix here yet, and the cost lands entirely on whoever writes the first real payment provider. Record it because an interface shaped this way tends to stay this way: the first implementer verifies signatures locally inside its own `HandleWebhook` rather than changing a method every other provider has already implemented, and then the second one forgets to.
- **Status per surface** — a table with one row per templ page and a column for migrated, dropped or blocked. Every row reads "blocked: no contract yet" at the end of Phase A, and the rows fill in as Phases B and C land.

- [ ] **Step 2b: Fix the documented sqlite DSN**

`docs/content/docs/stores/sqlite.mdx:18` shows `sqlitedriver.Open("ledger.db")` with no busy
timeout. With that DSN, concurrent coupon redemptions return a raw `database is locked
(SQLITE_BUSY)` instead of `ErrCouponExhausted`; Task 12's review reproduced it 10 of 10.
Change the documented DSN to carry `?_pragma=busy_timeout(5000)` (the syntax the harness
uses, verified against the modernc version in go.mod), and add one sentence saying why.

- [ ] **Step 3: Check off Phase 8 in the implementation plan**

In `IMPLEMENTATION_PLAN.md`, change the Phase 8 task list and exit criteria from `- [ ]` to `- [x]` for the items this phase completed: tiered pricing computation, coupon discount application, tax calculation hooks, "invoices calculate correctly for all pricing models", "coupons apply correct discounts", "tax calculation via plugin hooks".

Leave "immutable once finalized" unchecked. Nothing in this phase enforces it, and checking it would be a lie in a document the next person will trust.

- [ ] **Step 4: Verify the repository is clean**

Run: `cd /Users/rexraphael/Work/xraph/forgery/ledger && go build ./... && go test ./... && make vet`

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/ledger
git add MIGRATION.md IMPLEMENTATION_PLAN.md
git commit -m "docs: record the templ dashboard inventory and the Phase 8 engine work"
```
