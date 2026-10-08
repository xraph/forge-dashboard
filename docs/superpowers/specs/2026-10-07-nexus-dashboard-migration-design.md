# Nexus dashboard: templ to React shell

Status: written design approved on 2026-10-07. Slices 1 to 3 and the Slice 3
follow-ups are implemented. Slice 4, the Go dashboard contract, is next.

Two repositories, both worked on `main`, no worktrees:

- Go: `/Users/rexraphael/Work/xraph/forgery/nexus`, a single root module
  (`github.com/xraph/nexus`) plus nested modules listed in a tracked
  `go.work`: every provider under `providers/*`, `grpcsrv`, `config` and three
  `_examples`. The extension lives in the root module at `extension/`.
- React: this repo, as a new `packages/plugin-nexus`.

Read `packages/plugin/PLAYBOOK.md` before touching either half. This spec
assumes you have.

## What this is for

Nexus is the money path for AI traffic: every completion that goes through it
costs somebody something. You'd expect its dashboard to tell you who spent
what, on which model, under which key. Today it can't, and the reason is not
the dashboard. Nexus records no usage, computes no cost, authenticates no
caller and enforces no quota. The templ pages hid all of that behind nil-to-zero
fallbacks, so an operator saw a confident `$0.00` where the honest answer was
"nothing here is being measured".

So this migration fixes the money path first and builds the dashboard on top
of it. When it's done you can:

- see spend per tenant, per key, per model and per provider in exact decimal
  dollars, with requests on unpriced models counted separately instead of
  folded in as free;
- issue, rotate and revoke gateway keys, with the raw key shown exactly once;
- set per-tenant quotas and a monthly budget that the gateway actually
  enforces, and see consumption against each limit;
- read a request log that says what happened to every request: served, served
  from cache, blocked by a named guard, refused by a quota, or failed;
- see what the gateway is configured to do (pipeline, routing, guards, cache,
  enforcement) without being told anything it can't back up.

And the templ dashboard is gone from the extension.

Since Nexus will start authenticating, metering and refusing traffic, this is a
behaviour change for every deployment that upgrades. `MIGRATION.md` says so in
its first section.

## What the investigation found

Three read-only passes on 2026-10-07, at nexus `517333b`. The load-bearing
claims (the first three below) were re-checked by hand against the source.

### The pipeline stops at the provider call

`pipeline/builder.go:28-34` sorts middleware by ascending priority and
`run()` (`:88-100`) calls them outermost first. `ProviderCallMiddleware`
(priority 350) names its `next` parameter `_` and never calls it
(`pipeline/middlewares/provider_call.go:33`). So every stage above 350 is
registered and never runs: headers (500), stream lifecycle (545) and usage
(550), plus any custom middleware a host adds above 350.

The observers are written as wrappers. `UsageMiddleware.Process` calls
`next(ctx)` and then reads the response (`usage.go:33-60`), and so does
headers (`headers.go:24-39`). They need to sit *outside* the provider call. The
bug is not a missing `next` call. The terminal stage is sorted into the middle
of the chain.

Every usage and lifecycle test drives its middleware in isolation
(`usage_stream_test.go:62`, `stream_lifecycle_test.go:94-97`). There is no
gateway-level test, which is why nothing caught it.

### The tenant, key and usage services are never built

`Gateway` declares `tenant`, `key` and `usage` (`nexus.go:56-58`) and nothing
in the library assigns them. There is no `With*` option for any of the three.
`Tenants()`, `Keys()` and `Usage()` (`nexus.go:248-254`) always return nil, so
every `/admin/*` route answers 501 and every templ action handler would have
panicked on a nil interface. Only `_examples/multi-tenant/main.go:56,73` builds
them, by hand.

`Config.EnableUsage` defaults to true (`config.go:35`) and nothing reads it.
The extension's `enable_usage`, `enable_cache` and `log_level` are loaded and
go nowhere (`extension/extension.go:157-170` passes only base path, timeout,
retries and rate limit).

### Cost is never computed, and money is a float everywhere

`model.EstimateCost` and `EstimateCostFromTokens` (`model/cost.go:15,28`) have
no callers. No provider sets `CompletionResponse.Cost`. So even with recording
fixed, every cost would be 0.

Money is `float64` from price to storage: `provider.Pricing`
(`provider/model.go:15-19`), `CompletionResponse.Cost`, `usage.Record.CostUSD`,
`Summary.TotalCostUSD`, `ProviderUsage` and `ModelUsage`, `MonthlySpend`,
`tenant.Quota.MonthlyBudgetUSD`. Postgres stores `cost_usd DOUBLE PRECISION`,
SQLite `REAL`, Mongo a BSON double.

Every price literal in the 29 `providers/*/models.go` files is a short decimal
(smallest `0.00001`, at most five places), which matters for the decision
below.

### Providers under-report the tokens that cost money

`provider.Usage` has `ThinkingTokens`, `CacheReadTokens` and
`CacheWriteTokens` (`provider/response.go:39-46`). No provider fills any of
them. Anthropic and Bedrock report `InputTokens`, which excludes cached input,
so cache reads and writes are not counted at all. OpenAI's `prompt_tokens`
includes cached tokens, which bill at a discount. Gemini embeddings set
`PromptTokens: len(req.Input)`, a count of inputs rather than tokens
(`providers/gemini/client.go:231`). `Pricing` has no cache prices to apply even
if the counts arrived.

### Nothing authenticates, nothing is enforced

`auth.Provider` (`auth/auth.go:7-14`) is stored on the gateway, defaults to a
noop that grants admin, and is never called. `CompletionRequest.TenantID` and
`KeyID` exist (`provider/request.go:31-32`, `json:"-"`) and nothing reads
them. `pipeline.WithTenantID`, `WithKeyID` and `WithRequestID` have no
non-test callers, so `RequestID(ctx)` is always empty. The `/admin/*` routes
have no auth at all.

Tenant quotas (`RPM`, `TPM`, `DailyRequests`, `MonthlyBudgetUSD`,
`MaxTokensPerReq`, `MaxStreamDuration`, `MaxStreamTokens`), tenant status, key
scopes and `GlobalRateLimit` are all stored and enforced nowhere.
`ErrRateLimited`, `ErrQuotaExceeded` and `ErrBudgetExceeded` are never
returned. Every gateway error becomes HTTP 500
(`api/completion_handler.go:42-44`).

### Keys

`key.APIKey` keeps `Hash string json:"-"`, and the raw key (`nxs_` plus 64 hex)
comes back only from `Create` and `Rotate`. That part is sound. Around it:

- the hash is unsalted SHA-256 (`key/service_impl.go:142-146`) while the
  struct comment says bcrypt. With 256 random bits, SHA-256 is fine; the comment
  is wrong;
- `Prefix` is `nxs_` plus 8 hex, not unique-indexed, and `FindByPrefix`
  returns the first match, so a prefix collision rejects a valid key;
- every finder returns `(nil, nil)` when not found, so `Validate`, `Revoke`,
  `Rotate`, `Update`, `UpdateQuota` and `SetStatus` dereference nil and panic;
- `id.MustParseTenantID` panics on a malformed tenant id in `Create`;
- SQL and Mongo `FindByPrefix` filter `status = 'active'`, so a revoked key
  panics there instead of reporting revoked;
- `KeyExpired` is never assigned; `LastUsedAt` is only written by `Validate`,
  which nothing calls;
- `Rotate` revokes the old key best-effort with the error dropped, and its
  " (rotated)" name suffix stacks.

### Tenancy and empty values

| Method | memory | postgres | sqlite | mongo |
|---|---|---|---|---|
| `usage.Query` with `TenantID == ""` | ignores every filter and paging, returns the internal slice | no tenant filter: every row | every row | every row |
| `MonthlySpend` / `DailyRequests` / `Summary` with `""` | nil-tenant rows, all time (no period bounds); `Summary` is a stub | `tenant_id = ''` | `tenant_id = ''` | `tenant_id: ""` |

Postgres usage rows have a foreign key to tenants, so a nil-tenant insert
fails, and the async insert drops the error (`usage.go:89-93`). There are no
tenant isolation tests and no store tests of any kind.

### Coverage

No tests for `key`, `tenant`, `usage`, `store` or any store backend, none for
the admin API, none on cost. `providertest` covers providers only. A
dashboard sitting on this would display numbers nobody has verified, which is
the playbook's "inherits the extension's correctness" case at its sharpest.

### Everything without a page

| Subsystem | Readable | Mutable | Per-request record | Absence vs pass |
|---|---|---|---|---|
| Routing | strategy unexported | construction only | candidates and reasons discarded | no |
| Cost and latency strategies | | | candidates carry zero cost and latency, so both pick the first provider | |
| Retry | | | no attempt record | |
| Fallback, circuits | package exists, not wired | | | unknown circuit reports `closed` |
| Guards | `Guard().List()`: name and phase | append only | none; a block is a 500 error string | no guards, phase skip, non-string content and warn all look like a pass |
| Cache | hits and misses (racy); size and bytes never filled | `Clear`, `Delete`; Redis `Clear` is a no-op returning nil | `Cached` on the response | key omits the tenant, so tenants share entries |
| Transforms | no accessor | construction only | none | RAG failures swallowed |
| Hooks | `Extensions()` | | only stream hooks are emitted, from the dead middleware | zero events looks like a quiet system |
| Health tracker | no accessor, never fed | | | no data reads as healthy |
| Batch, MCP | not wired | | | |

The library cannot explain a routing decision after the fact. So there is no
graph view of routes in this migration, and `@xyflow/react` stays out.

### What the 12 templ pages expose

`dashboard/` has 25 `.templ` files: overview, tenants, tenant detail, tenant
form, keys, key detail, key form, usage, usage records, models, settings, a
helpers file, components and three widgets. Nothing outside the package
imports it; `8401f4c` (on nexus main as `517333b`) removed the extension's
wiring. The full checklist goes into `MIGRATION.md` in slice 7. Bugs in it
worth knowing now: the tenant edit form replaces quota and config wholesale,
wiping `MaxStreamDuration`, `MaxStreamTokens`, `CacheEnabled` and config
metadata; the key form saves only the first checked scope (forge
`formDataFromCtx` keeps `v[0]`); "recent usage for this key" is really
filtered by tenant; state-changing actions are GETs; every "total" is a page
length.

## Decisions

Settled in conversation on 2026-10-07.

1. **Fix the money path in this migration.** The dashboard is built on a
   Nexus that records usage, computes cost and enforces limits, not on one
   that pretends to.
2. **Break the money types now, inside v1.** No `/v2` module path. `Pricing`
   and every cost field change type to an exact decimal. All 29 provider
   modules change in the same work and need a lockstep release; the release
   note says so.
3. **Enforce gateway keys.** HTTP traffic needs a valid `nxs_` key.
4. **Enforce per-tenant quotas and budget**, not just identity.
5. **Money checks run against the store of record; rate checks go through a
   pluggable limiter.** Daily requests and monthly budget read usage records,
   exactly. RPM and TPM go through a `Limiter` with memory and Redis
   implementations.
6. **The dashboard is operator-wide.** Nexus tenants are customers the
   operator administers, not the operator's own scope. No handler reads
   `Principal.Claims`.
7. **Cursor paging, no totals, money as decimal strings, absent as `null`.**
8. **Templ is deleted after browser verification**, then forge moves to
   `v1.12.0` in the commit after. No forge release has both `contributor`
   (which `dashboard/` needs) and a transport that delivers
   `meta.invalidates` (`v1.10.0` through `v1.11.1` drop it; `v1.12.0` drops
   `contributor`). So the contract is built and unit-tested on `v1.10.0`, the
   React side is verified against fixtures, and the bump lands last.

## The Go half

### Slice 1: exact money and the store harness

**The type.** A new package `money`:

```go
// USD is an exact decimal amount of US dollars. Nothing in this package
// rounds; rounding is a display decision.
type USD struct{ d decimal.Decimal } // github.com/shopspring/decimal

func MustParse(s string) USD
func Parse(s string) (USD, error)
var Zero USD
func (u USD) Add(v USD) USD
func (u USD) MulTokens(tokens int64) USD // exact
func (u USD) DivMillion() USD           // exact
func (u USD) String() string            // full precision, no exponent
```

It marshals to JSON as a string (`"0.000123"`), implements `sql.Scanner` and
`driver.Valuer`, and marshals to BSON as `Decimal128`. (superseded: see "What slice 1 found")

**The breaking change.** These change type to `money.USD`, keeping their JSON
names (the values become strings):

- `provider.Pricing.InputPerMillion`, `OutputPerMillion`,
  `EmbeddingPerMillion`;
- `provider.CompletionResponse.Cost`;
- `usage.Record.CostUSD` (becomes `*money.USD`, see below),
  `Summary.TotalCostUSD`, `ProviderUsage.CostUSD`, `ModelUsage.CostUSD`;
- `usage.Service.MonthlySpend` and the matching store method;
- `tenant.Quota.MonthlyBudgetUSD`;
- `model.CostEstimate` fields.

Every `providers/*/models.go` changes from `InputPerMillion: 0.15` to
`InputPerMillion: money.MustParse("0.15")`. A test in each provider module
compares every model's prices against the old literals, written out as
strings, so the conversion can't drift. `router.Candidate.Cost` stays
`float64`: it is a routing weight, not money, and it is never shown.

**Computing cost.** `model.Cost(usage provider.Usage, p provider.Pricing)`
returns `(money.USD, PricingStatus)`: prompt tokens times the input price plus
completion tokens times the output price, divided by a million, exactly.
Embeddings use `EmbeddingPerMillion`. A model with no pricing entry returns
`unpriced_model`. The usage middleware calls it, looking pricing up through
`model.Service`.

**Never `$0` for "we don't know".** `Record.CostUSD` becomes `*money.USD`.
`nil` means unpriced, not free. `Record.PricingStatus` is `priced`,
`unpriced_model` or `cached` (a cache hit, exactly zero because no provider
was called). `Summary` gains `UnpricedRequests int`.

**Storage.** One new migration per backend, after `20240101000003`:

- Postgres: `cost_usd NUMERIC(38,18)` (converted with `::numeric`; existing
  rows were 0), `pricing_status TEXT`, the slice 2 columns (`outcome`,
  `blocked_by`, `refusal_code`), and `tenant_id`, `key_id`, `request_id` made
  nullable. The tenant foreign key stays, so a non-null tenant must exist.
  Sums in SQL.
- SQLite: `cost_usd TEXT`, same new columns. Sums in Go, never with `SUM()`,
  which would coerce to `REAL`.
- Mongo: `Decimal128`, and the same fields. `$sum` is exact on `Decimal128`.
- Memory: sums `money.USD`.

**Store fixes.**

- Every finder returns a typed `store.ErrNotFound` instead of `(nil, nil)`,
  which removes the panic class in the services at its source. (superseded: see "What slice 1 found")
- Memory: `Summary` computed for real, `Query` honours every filter and the
  cursor, `MonthlySpend` and `DailyRequests` bounded to the period, and no
  method hands out its internal slice.
- Every backend: `CacheHitRate`, `AvgLatency` and `UnpricedRequests` computed
  (Postgres and SQLite compute a cached count today and throw it away).
- Lists move to cursors: `cursor` in, `nextCursor` out, no total. The `int`
  that every backend returns as "total" is the page length today; it goes.
- New store surface the contract needs: `usage.QueryOptions` gains `KeyID` and
  `Outcome`; `key.Store` gains a cross-tenant `List(opts)` (the templ page did
  an N+1 over tenants); `usage.Store` gains `Series(opts)` returning requests,
  tokens and cost per hour or day bucket.
- Period bounds use UTC on every backend, stated in one place.

**The harness: `store/storetest`.** Shaped like Keysmith's `storetest.Each`.
It runs on memory and SQLite always, and on Postgres and Mongo when
`NEXUS_TEST_POSTGRES_DSN` and `NEXUS_TEST_MONGO_URI` are set, against
throwaway containers on non-default ports. Every struct it builds fills every
field, money and the new columns included. It covers:

- decimal round-trips and sums (`0.000000150` per token times a million
  tokens, tails past twelve places, a sum of many sub-cent rows);
- what an empty tenant does on each backend, pinned as an observed fact with a
  comment saying which it is;
- isolation: rows under two tenants, list under one, assert on identity;
- period boundaries for day, week and month;
- unpriced rows excluded from totals and counted in `UnpricedRequests`;
- cursor paging that neither skips nor repeats a row across pages.

### Slice 2: pipeline and wiring

**The terminal stage goes last by construction.** A `pipeline.Terminal`
marker interface. `Builder.Build` sorts the rest by priority, appends the
terminal at the end, and returns an error for two terminals or none. Custom
middleware above 350, dead today, then runs inside retry, once per attempt.
`MIGRATION.md` calls that out.

**The order, outermost first:**

| Pri | Stage | Notes |
|---|---|---|
| 5 | `request_id` (new) | sets `req_…` in context |
| 10 | tracing | unchanged |
| 15 | usage (was 550) | sees each request once: cache hits, blocks, refusals, the final result after retries, total latency |
| 20 | timeout | unchanged |
| 30 | `identity` (new) | copies request `TenantID` / `KeyID` into context when the HTTP edge has not set them; refuses ids that don't parse |
| 40 | `access` (slice 3) | tenant status, scopes |
| 50 | `quota` (slice 3) | max tokens, daily, budget, RPM, TPM |
| 60 | stream lifecycle (was 545) | `QuotaResolver` wired from the tenant |
| 150 to 340 | guardrail, transform, alias, cache, retry | unchanged |
| last | provider_call | terminal |

Headers (500) is removed. It only wrote to `State`, which `Execute`
discards, and no handler read it. The docs that promise `X-Nexus-*` headers
are corrected rather than the feature built.

**The usage record.** Existing fields, now populated: `TenantID`, `KeyID` and
`RequestID` (nullable when unattributed), `Provider`, `Model`, tokens,
`CostUSD`, `Latency`, `Cached`, `StatusCode`. New:

```go
Outcome       Outcome `json:"outcome"`        // ok | error | blocked | refused | cached
BlockedBy     string  `json:"blocked_by,omitempty"`
RefusalCode   string  `json:"refusal_code,omitempty"`
PricingStatus string  `json:"pricing_status"`
```

A guard block becomes `guard.BlockedError{Guard, Reason}` so the record can
name the guard. That is the one guard outcome we can state positively.

**Recording.** Still asynchronous, but insert errors are logged and counted
(`usage.Service.Stats()` exposes the count), and `Gateway.Shutdown` waits for
in-flight inserts.

**Wiring.** `Initialize` builds the three services from the store unless
`WithTenantService`, `WithKeyService` or `WithUsageService` supply them.
`Config.EnableUsage = false` is the one way to turn recording off. The
extension passes `enable_usage`, `enable_cache` and `log_level` through.

**Cache isolation.** `cache.Key` hashes the tenant ID in. With keys enforced,
leaving it out would let one tenant read another's cached completions.

**Read accessors for the dashboard**, none of which exist: `Pipeline().Stages()`
(name, priority, terminal), the routing strategy name, the alias list, and the
transform registry.

### Slice 3: enforcement

**At the HTTP edge.** `auth.KeyAuth`, one `http.Handler` wrapper used by
`api.New` and `proxy`. It accepts `Authorization: Bearer nxs_…` and
`x-api-key: nxs_…`, validates through `key.Service`, and puts tenant and key in
context. Missing, unknown, revoked or expired keys get 401. `/admin/*` needs a
key with the `admin` scope; `GET /v1/models` needs `models`.

`Config.RequireAPIKey` defaults to `true`. `false` keeps today's open gateway
for local work, and the dashboard makes that its loudest warning.

**Keys.**

- `FindByPrefix` returns every key sharing the prefix; `Validate` compares the
  hash in constant time across all of them.
- `ErrKeyNotFound`, `ErrKeyRevoked`, `ErrKeyExpired`. Expiry is derived from
  `ExpiresAt` when a key is read, so `expired` shows without a background job.
  SQL and Mongo stop filtering prefix lookups to active keys.
- `LastUsedAt` is written at most once a minute per key.
- `CreateInput` gains `ExpiresAt`; `Create` parses the tenant id with an error
  and checks the tenant exists.
- `Rotate` creates the new key, revokes the old one, and returns an error if
  the revoke fails. It's still not atomic across backends, and the doc comment
  says so. The name suffix no longer stacks.
- The "bcrypt" comment is corrected.

**In the pipeline**, so in-process Go callers who name a tenant are bound too:

| Pri | Check | Refusal |
|---|---|---|
| 40 | tenant `disabled` or `suspended` | 403 `forbidden` |
| 40 | scope: completion and stream need `completions`, embedding needs `embeddings` | 403 `forbidden` |
| 50 | `MaxTokensPerReq`: more is refused; unset `max_tokens` gets the cap filled in | 400 `invalid_request` |
| 50 | `DailyRequests`, `MonthlyBudgetUSD` from the store | 429 `quota_exceeded`, `budget_exceeded` |
| 50 | RPM charges 1 up front; TPM checks the window up front and charges actual tokens when the request finishes | 429 `rate_limited`, `Retry-After` |
| 60 | `MaxStreamDuration`, `MaxStreamTokens` | stream ends |

The budget is a soft limit: the request that crosses it completes, the next
one is refused. Cost is only known afterwards, so that's the honest
semantics, and the dashboard copy uses it.

**The limiter.**

```go
type Limiter interface {
	// Allow charges n against key's window and reports whether the
	// window was within limit before the charge.
	Allow(ctx context.Context, key string, n, limit int64, window time.Duration) (Decision, error)
	Kind() string // "memory" | "redis"
}
```

Fixed one-minute windows. The memory implementation is the default and applies
per replica. The Redis one takes a `redis.UniversalClient`.

**Failure modes differ on purpose.** An unreachable limiter lets the request
through and is counted ("limiter errors, requests allowed"). An unreachable
store on a budget or daily check refuses with 503. Failing the money check
closed costs one request; failing it open can cost a tenant's budget.

**Typed refusals.** `nexus.RefusalError{Code, Limit, RetryAfter}` with codes
`unauthenticated`, `forbidden`, `invalid_request`, `rate_limited`,
`quota_exceeded`, `budget_exceeded`, mapped in `api` and `proxy` to 401, 403,
400 and 429. A guard block maps to 400. Every refusal still writes a usage
record with `Outcome: refused`.

**Hooks on the paths this slice touches:** `KeyCreated`, `KeyRevoked`,
`TenantCreated`, `TenantDisabled`, `BudgetWarning` at 80% and
`BudgetExceeded`.

### Slice 4: the contract

**Layout.** `extension/contract/`, copying Trove: `contract.go` with generic
`query` / `command` binding helpers checked against the manifest,
`manifest.yaml` embedded, `errors.go`, `project.go`, one `handlers_*.go` per
area, tests per area. `ContributorName = "nexus"`.

The extension gains `RegisterContractContributor`. Production code imports
only `forge/extensions/dashboard/contract` and its `dispatcher` and `loader`.
The `_ dashboard.ContractContributorAware = (*Extension)(nil)` assertion lives
in `extension/dashboard_aware_test.go`.

**Deps resolve the gateway lazily.** The extension provides the gateway only
after `Start`. Before then, handlers answer `UNAVAILABLE`, retryable, "Nexus is
starting".

**Tenancy, said once in the manifest's header comment.** Operator-wide.
`tenantId` is always explicit:

- absent: every tenant, a deliberate operator view;
- present but blank, or malformed: `BAD_REQUEST`;
- well formed and unknown: `NOT_FOUND`;
- wrong JSON type: `BAD_REQUEST`.

An empty string never reaches a store filter. Handler tests pin all four.

**Wire rules.** Money is a decimal string or `null`, never a number, never
`"0"` standing in for absent. Latency is integer milliseconds. Times are
RFC3339 UTC. Lists are never `null`. Every list filter is applied by the store
at its index, so there is no post-filtering and no "search incomplete" state
to render.

**The intents**, all version 1:

| Intent | Kind | Request | Response | Invalidates |
|---|---|---|---|---|
| `overview.get` | query | | tenants by status, active keys, month spend, unpriced count, requests today, outcome counts, posture (`requireApiKey`, `limiterKind`, `usageEnabled`, `guardCount`, `cacheKind`), `insertErrors`, `limiterErrors` | |
| `tenants.list` | query | `status?`, `search?`, `cursor?` | `items`, `nextCursor` | |
| `tenants.get` | query | `id` | tenant, quota, config, metadata, month spend, requests today | |
| `keys.list` | query | `tenantId?`, `status?`, `cursor?` | key summaries with tenant name | |
| `keys.get` | query | `id` | one key, never a hash | |
| `usage.summary` | query | `tenantId?`, `period` | totals, unpriced, cache hit rate, average latency, outcomes, `byProvider` and `byModel` as arrays sorted by cost | |
| `usage.series` | query | `tenantId?`, `period`, `bucket` | buckets of requests, tokens, cost | |
| `usage.records` | query | `tenantId?`, `keyId?`, `provider?`, `model?`, `outcome?`, `from?`, `to?`, `cursor?` | `items`, `nextCursor` | |
| `models.list` | query | | models with price strings, priced flag, capabilities, context window, max output | |
| `providers.list` | query | | capabilities, model count, requests and errors in the last 15 minutes | |
| `gateway.get` | query | | stages, strategy, guards with caveats, cache kind and stats, aliases, transforms, limiter kind | |
| `settings.get` | query | | effective extension config | |
| `tenants.create` | command | `name`, `slug`, `quota?`, `config?`, `metadata?` | tenant | `tenants.list`, `overview.get` |
| `tenants.update` | command | `id`, then every name, quota and config field as its own optional pointer | tenant | `tenants.list`, `tenants.get`, `overview.get` |
| `tenants.setStatus` | command | `id`, `status` | tenant | `tenants.list`, `tenants.get`, `overview.get` |
| `keys.create` | command | `tenantId`, `name`, `scopes`, `expiresAt?` | `{key, rawKey}` | `keys.list`, `tenants.get`, `overview.get` |
| `keys.rotate` | command | `id` | `{key, rawKey, revokedKeyId}` | `keys.list`, `keys.get`, `tenants.get` |
| `keys.revoke` | command | `id` | key | `keys.list`, `keys.get`, `tenants.get`, `overview.get` |

`tenants.update` merges into the stored tenant field by field, so editing RPM
can't wipe `MaxStreamTokens` or `CacheEnabled`. `keys.create` and
`keys.rotate` carry `# Answers a raw key, once` in the manifest.

`providers.list` never pings. A ping can't be trusted (Anthropic reports a 401
as healthy, `providers/anthropic/client.go:198-201`) and it hits every
provider on every page load. Traffic health comes from usage records, and no
traffic says "no traffic in the last 15 minutes".

**Deliberately absent:** tenant delete (the templ dashboard never had it, and
Postgres foreign keys block it once keys or usage exist) and cache clear
(Redis `Clear` is a no-op). Both are recorded with their reasons.

**Errors.** `store.ErrNotFound` (superseded: see "What slice 1 found") maps to `NOT_FOUND`, validation to
`BAD_REQUEST`, a slug clash to `CONFLICT`, cancellation to retryable
`UNAVAILABLE`. Anything else is logged with its intent and answered as
`INTERNAL` with "an internal error occurred". Raw error text never reaches
the client.

## The React half

### Identity and routes

`extension: "nexus"`, namespace `nexus`, label "Nexus". Nav groups describe
content.

| Route | Page | Nav |
|---|---|---|
| `/` | Overview | Gateway |
| `/gateway` | Gateway configuration | Gateway |
| `/models` | Models and providers | Gateway |
| `/tenants` | Tenants | Customers |
| `/tenants/new` | Create tenant | |
| `/tenants/:id` | Tenant detail | |
| `/tenants/:id/edit` | Edit tenant | |
| `/keys` | API keys | Customers |
| `/keys/:id` | Key detail | |
| `/usage` | Spend and requests (lazy) | Spend |
| `/usage/records` | Request log | Spend |
| `/settings` | Settings | |

Tenant ids are `tenant_…` TypeIDs, so `/tenants/new` can't collide with one.

### Exact money, visibly exact

This is the one place the design spends its boldness. Spend renders as
`$1,284.37` with the sub-cent tail (`0219…`) right behind it in muted, smaller
ink. You see the cents you reconcile against, and you see that nothing was
rounded away. `src/money.ts` does it with string operations only: split at the
point, group the integer part, cut at two decimals. It never calls `Number()`
or `parseFloat()`.

Everything else stays quiet and uses the kit as it is.

### Overview

It leads with what's actually enforced, then the numbers.

- A posture strip: keys required, the limiter kind ("applies per replica" for
  memory), usage recording, guards configured, cache.
- An open gateway gets a destructive `Alert`: "Anyone who can reach this
  gateway can call it, and their spend isn't attributed to a tenant."
- Usage off gets: "This deployment doesn't record usage, so spend and request
  counts below are not available." The figures show as unavailable, not zero.
- A KPI row: month spend as the hero figure, requests today, active keys,
  tenants by status.
- Unpriced requests sit beside spend: "12 requests on models without a price
  aren't in this total."
- Non-zero insert or limiter error counts get an inline alert saying what they
  mean.

### Usage

One filter row above everything it scopes: tenant, then period.

- **Spend per bucket:** a column chart, one series, no legend (the title names
  it). The hover tooltip shows the exact string. A table-view toggle lists
  every bucket's exact value.
- **Requests per bucket:** a second column chart, never a second axis.
- **Outcome mix:** a table with outcome badges and counts. Five states that
  each mean something read better as numbers than as five hues.
- **Spend by model, spend by provider:** `ResourceTable`s with exact cost,
  requests, tokens and a thin share meter.

Recharts needs a number for a bar's height, so the chart adapter calls
`Number(cost)` for geometry. That is the only float in the plugin. Every
displayed, compared or summed value stays a string, and a source-scan test
bans `Number(` and `parseFloat(` on money fields outside `src/charts/`.

The previous render stays on screen at reduced opacity while a new period
loads, so the charts don't flash a skeleton.

### Request log

Filters: tenant, key, provider, model, outcome, time range. Columns: time,
request id (mono), tenant, key prefix (mono), model (mono), tokens, cost
(exact, or an "Unpriced" tag), outcome badge (with the guard or refusal code
in its label), latency. "Load more" on the cursor, no total. The empty states
say which empty: "No requests recorded yet", "No requests match these
filters", or the usage-off message.

### Tenants

The list has a status filter and a search box. Columns: name (`font-medium`),
slug (mono), status badge, month spend, RPM, budget ("No limit" when unset),
created. The caption carries a live count.

The detail page shows quotas as consumption against the limit: a daily
requests meter, a month spend meter against the budget (exact strings on both
ends), RPM and TPM caps with the limiter note. Then config, metadata, the
tenant's keys with a create button, and status actions (activate, disable,
suspend) through `ConfirmDialog` with `pending`.

The form gives each quota an explicit "No limit" switch rather than a magic
zero (the library's zero still goes on the wire). It sends only dirty fields.
The budget input accepts a decimal string checked by a regex and is never
parsed to a float.

### Keys

The list has tenant and status filters, defaulting to active. Columns: name
(`font-medium`), prefix (mono), tenant, scopes (`TagList`), status, expires,
last used (`Timestamp`, "Never").

**Create** is a two-step dialog.

1. Tenant (a combobox over `tenants.list`), name, scopes as checkboxes,
   expiry (never, 30, 90, 365 days, or a date). `admin` sits apart with its
   own warning: "Can manage every tenant through /admin."
2. The reveal. The command's result is copied out of the hook, then
   `reset()`, so the raw key lives in one component's state and nowhere else.
   It offers copy, with a select-and-copy fallback announced through
   `aria-live` (the announcement never contains the key), a hide toggle, and
   "You'll recognise it later as `nxs_1a2b3c4d`". "Done" stays disabled until
   "I've stored this key somewhere safe" is ticked. A `beforeunload` guard is
   active, and the dialog can't be dismissed until Done.

**Rotate** says plainly that the old key stops working immediately, with no
grace period, then shows the same reveal. **Revoke** is a `ConfirmDialog`.

The reveal component lives in `src/components/one-time-key.tsx`. It belongs in
kit next to Keysmith's, but kit is outside this migration's paths, so the
report flags it for promotion.

### Gateway

- **Pipeline:** the stages actually built, in order, the terminal marked.
- **Routing:** the strategy. When it's `cost_optimized` or
  `latency_optimized`, it says "picks the first provider until cost data
  exists", because candidates carry no cost or latency.
- **Guards:** name and phase, with the standing caveats: streamed output is
  not guarded, non-text content is skipped. With none configured: "No guards
  configured. Requests reach providers unchecked." Never "passed".
- **Cache:** kind, hits and misses, size "not tracked".
- **Aliases** and **transforms**.
- **Enforcement:** keys required, limiter kind and its failure mode, the
  budget's soft-limit semantics.

### Models and providers

Models show exact prices per million tokens, with "Unpriced" for a missing
entry. Providers show capabilities, model count and traffic health over the
last 15 minutes, or "No traffic in the last 15 minutes".

### Badges

Proportion first, per the playbook.

| Field | outline | secondary | default | destructive |
|---|---|---|---|---|
| Tenant status | active | disabled | | suspended |
| Key status | active | revoked | expired | |
| Outcome | ok | cached | refused, blocked | error |

Revoked keys pile up over time, one per rotation. That's why revoked takes
`secondary` and the key list defaults to active. `admin` in a scope list
takes `default`.

### Lazy loading and dependencies

`/usage` is a lazy route because it carries the recharts code through the
kit's `chart.tsx`. Nothing else is heavy. No CodeMirror, no `@xyflow/react`.
`BASELINE.md` gets a Nexus section with the measured chunk, and a lazy-chunk
test checks that only `pages/usage` reaches `charts/`.

### Wiring

`apps/shell`: the dependency, the import, appended to `plugins`, and an
`@source` line in `styles.css`. `apps/example-next`: the dependency,
`forge.config.ts`, `@source` in `app/globals.css`, and `transpilePackages`.

## Fixtures

`packages/fixture-server/nexus-fixtures.mjs` exports
`createNexusHandlers(FixtureError)` and `resetNexus()`. `server.mjs` changes
in exactly four places (import, `CONTRIBUTORS`, `handleReset`, the inventory
comment), with the Edit tool only, committed through a temporary index,
because the file carries other sessions' uncommitted work.

- Writes change reads: create a tenant and the list grows; revoke a key and
  its status flips; rotate and the old key shows revoked beside the new one.
- `tenants.update` merges by field; the seed's `maxStreamTokens` survives an
  RPM edit.
- No raw key and no hash is ever stored or returned by a read. Create and
  rotate return `rawKey` once and keep only the prefix.
- Every amount is a string. The seed has unpriced requests, a tenant at 85% of
  its budget, a suspended tenant, an expired key, and sub-cent tails.
- **The fixture models the shipped contract, not today's Nexus.** Blank
  `tenantId` answers 400 and unknown answers 404. `FIXTURE_NEXUS_USAGE_OFF=1`
  and `FIXTURE_NEXUS_OPEN_GATEWAY=1` make those two states reachable. Today's
  Nexus would answer a 501 or a panic; somebody reading the fixture later
  should not "fix" it back.
- `verify.mjs` walks every intent over HTTP, then spot-checks write-then-read
  and every refusal code.

## Sequencing

Seven slices, each its own plan in `docs/superpowers/plans/`, each landing on
`main` in its repo, nothing pushed without asking.

1. Exact money and the store harness (nexus).
2. Pipeline and wiring (nexus).
3. Enforcement (nexus).
4. The contract (nexus, forge `v1.10.0`).
5. Plugin read surfaces and fixtures (forge-dashboard).
6. Plugin write flows and usage charts (forge-dashboard, plus any contract
   gaps in nexus).
7. Retire templ (nexus). It starts only after a browser click-through of every
   page and both key dialogs against the fixture server, with screenshots.

Each slice appends a "What slice N found that slice N+1 must know" section to
this file.

## Retiring the templ dashboard

In the playbook's order:

1. Write the inventory into `nexus/MIGRATION.md` while the pages exist: every
   page, column, action, filter, badge and empty state from the checklist
   above.
2. Account for every item: migrated, dropped with a reason, or blocked. Known
   drops: the three widgets (the shell has no widget slot; the overview
   carries their content) and "recent usage for this key" in its templ form
   (it was a tenant filter; the request log's real key filter replaces it).
3. Grep for importers of `github.com/xraph/nexus/dashboard` across every
   module. None exist today.
4. Delete `dashboard/`, every generated `*_templ.go` and the stray
   `.DS_Store`, as its own commit.
5. In the next commit, bump forge to `v1.12.0`, run `go mod tidy` (templ and
   forgeui drop out; nothing else needs them), and add the transport test that
   posts a command envelope and asserts `meta.invalidates` reaches the client.
6. Prove it: `find . -name '*.templ'` returns nothing; `go build ./... && go
   test ./...` pass in the workspace; every nested module builds and vets with
   `GOWORK=off`; golangci-lint on a fresh cache reports nothing.

| Templ item | Outcome |
|---|---|
| Overview stats and recent usage | Overview, with posture, exact spend and unpriced count |
| Tenants list, search, status param | Tenants, with a real status filter and store-side search |
| Tenant detail, quotas, config, metadata, keys, usage summary | Tenant detail, with consumption against limits |
| Tenant enable, disable, suspend (GETs) | `tenants.setStatus` commands with confirmation |
| Tenant create and edit | Tenant form, field-level merge |
| Keys list, tenant filter | Keys, cross-tenant list with filters |
| Key detail, rotate, revoke (GETs) | Key detail with rotate and revoke commands |
| Key form, scopes | Create dialog, every checked scope saved |
| One-time raw key card | The reveal step |
| Usage period buttons, stats, by provider and by model | Usage page |
| Usage records with three filters | Request log with seven filters and paging |
| Models and provider health cards | Models and providers, traffic health |
| Settings (config intent) | Settings (effective config) and the Gateway page |
| Three widgets | Dropped: no widget slot; content lives on the overview |
| Topbar "API Docs" link | Dropped: points at a docs route Nexus never mounts |

## Testing

**Go.**

- Slice 1: `storetest` as above; `money` unit tests; every provider's prices
  against the old literals; `model.Cost` across priced, unpriced and embedding.
- Slice 2: a gateway-level test that sends a real completion through
  `Engine.Complete` with a fake provider and asserts on a stored usage record.
  That one test would have caught the dead pipeline. Also: a cache hit
  recorded as `cached`, a guard block recorded with the guard's name, a retried
  request recorded once, two tenants not sharing a cache entry, a builder with
  two terminals refused.
- Slice 3: every refusal code end to end through `api` and `proxy`; a prefix
  collision; expiry; `/admin` without the admin scope; the budget soft limit;
  limiter fail-open and store fail-closed; the Redis limiter against a
  container.
- Slice 4: manifest load and intent count, every declared intent registered,
  every command's exact invalidates, handlers on memory and SQLite, the four
  tenant cases, and a test that marshals every read response and asserts no
  `rawKey`, hash or `nxs_` value appears (with `assert.False`, so a failure
  never prints the secret).

**React.** The harness from Trove and Vault (`stubClient`, `failingClient`
with a real `ContractError`, `pendingClient`, recording clients). Per page:
it renders, reads the right intent, every write goes out with the right field
names, every failure is visible inside its dialog, and every empty state says
which kind. Also: the money formatter against tails like `0.000000150` and
values past `Number.MAX_SAFE_INTEGER`; the reveal never puts the key in an
announcement; the float ban; the lazy chunk. `test`, `typecheck` and `lint`
clean for the package, then `pnpm -r test`.

**What the Go tests won't cover.** The Postgres and Mongo suites run only
where the DSNs are set, so CI coverage of those two depends on CI providing
them. `MIGRATION.md` says which backends a given run covered.

## Findings for MIGRATION.md

Recorded and raised as follow-ups, not fixed here:

- Routing can't explain a decision; candidates carry no cost or latency, so
  the cost and latency strategies pick the first provider.
- Guard outcomes other than a block are discarded; the streaming
  `passthrough` strategy does nothing.
- Redis cache `Clear` is a no-op that returns nil; cache hit and miss counters
  race; size and bytes are never filled.
- Fallback, circuit breakers, batch and MCP are not wired into the gateway.
- `/v1/models` returns the human name as the id; embeddings look up the
  `embed` capability while `Supports` only knows `embeddings`;
  `CompletionRequest.Provider` is ignored; alias target providers are ignored.
- Providers don't report cache, thinking or (for Gemini embeddings) real
  token counts, so cost is list price over reported tokens.
- The health tracker's "P99" indexes an unsorted slice, and the tracker is
  never fed.
- Batch job ids collide within one second.
- The docs promise `X-Nexus-*` headers and `/admin/usage/summary`, neither of
  which exists.

## What slice 1 found that slice 2 must know

Slice 1 is done on nexus `main` and unpushed. Money is exact everywhere, and all four store backends (memory, SQLite, Postgres, Mongo) pass one conformance suite. The final run had both containers up, `go test -race ./...` was green with no skipped store tests, and the lint came back clean. Postgres 17 and Mongo 7 ran in Docker on 55632 and 57632. If CI doesn't provide `NEXUS_TEST_POSTGRES_DSN` and `NEXUS_TEST_MONGO_URI`, those two backends are skipped there, so say which ones a run covered when you write `MIGRATION.md`.

Where the plan departed from this spec, you need to know before you start slice 2.

The not-found sentinels are `tenant.ErrNotFound` and `key.ErrNotFound`. This spec said `store.ErrNotFound`, but `store` imports `tenant` and `key`, so that name would be an import cycle. The 404 mapping in the API follows the real names.

The `money` package does not implement `sql.Scanner`, `driver.Valuer` or the BSON interfaces. Each backend converts at its own model boundary (`numeric` for the SQL stores, `conv.CostText`, `decimalOf` for Mongo). The reason is that every provider module imports `provider`, and `provider` imports `money`, so a driver import in `money` would land in 32 modules that never touch a database. If the scattered conversions start to hurt, centralise them then.

The usage middleware now fills `Outcome` and `PricingStatus`, but it still copies `CompletionResponse.Cost`, which nothing sets. Until slice 2 every non-cached row is unpriced. We left `model.Cost` unwired on purpose, because slice 2 moves and rewrites that middleware and wiring it twice is waste. When you move it, call `model.Cost` there. It treats a model as unpriced only when both prices are zero, a rule Rex was offered and kept.

SQLite usage times are `conv.TimeText` strings. Postgres orders and pages IDs with `COLLATE "C"`. The `/admin/tenants` response lost its `total`, because the old number was the length of the page and never a real count. Lists are cursor paged, newest first by ID, and have no totals.

What the suite turned up, backend by backend:

- SQLite never ran its migrations in production. `store/sqlite/store.go` never imported grove's `sqlitemigrate`, so `Migrate()` failed with "no executor registered for driver sqlite" unless the host happened to import it. Task 3 added the blank import to the store, which is the right place for it.
- Grove's Postgres migrator takes a server-wide, non-waiting `pg_try_advisory_lock(1)`. Two Nexus replicas starting together can fail migration on that lock instead of waiting. The test harness now holds its own blocking lock per test to serialise packages. The product hazard is untouched and belongs in `MIGRATION.md`.
- The old SQLite code wrote usage times as Go `time.String()` values, monotonic suffix and all, which `strftime` can't parse. `Migrate` now rewrites any `created_at` that isn't already in `conv.TimeText` form, and a value it can't parse fails startup with the row id.
- Task 3 Step 7 found no field-mapping failures. The sqlite import above was the only thing it made us fix.
- Memory `FindByPrefix` ignores key status, while Postgres, SQLite and Mongo filter to `active`. `Validate` also tells an unknown prefix (`ErrNotFound`) apart from a wrong hash. Unify both when slice 3 wires key auth, so a caller can't probe which prefixes exist.
- `Series` now filters from the aligned bucket start, not the raw `Start`, on every backend. Each point covers its whole bucket and its label is true. A caller who wants a strict window will see data from up to one bucket early. An unaligned `End` leaves the last bucket covering "up to End".

Carry-forward items for the later slices:

- Prices are JSON strings on the wire now, such as `"2.5"`, where they used to be numbers. That is a break for any API consumer, so record it in `MIGRATION.md`.
- `ollama` and `lmstudio` list a placeholder price of `0.00001` ("effectively zero"), so local models come out priced at a tiny amount instead of unpriced. That is a product question for Rex.
- `money.Parse` accepts negative amounts, so a negative budget can be saved. The slice 4 contract must refuse one: `tenants.update` rejects a budget below zero.
- `($1 = '' OR tenant_id = $1)` in the Postgres and SQLite aggregates can't use the tenant index under a generic or prepared plan. When `MonthlySpend` and `DailyRequests` back per-request budget checks (slice 3), build the `WHERE` clause conditionally, the way Mongo's `tenantMatch` already does.
- The Postgres cursor orders on `id COLLATE "C"`, which can't use a primary key index built with the default collation on a non-C database. The slice 1 migration now creates an `id COLLATE "C"` index on the usage, tenant and key tables, so this one is done.
- `grpcsrv` and `_examples/grpc` replace `nexus` with the root checkout, so they needed their own `go mod tidy` for `shopspring/decimal` (commit 024ee78). The 32 provider modules replace it the same way and are tidied too (commit 4ff44e2, 30 of them with a new go.sum that holds only the decimal lines). `GOWORK=off go vet` passes in all of them, and it will fail again the next time a module gains a dependency without its own tidy.

The final review of the whole slice found a few more things. We fixed the ones that were code (nexus commits 18394fd, 3aacda8 and 8ba3759). The rest are for the release and for slice 2.

- Release checklist. All 32 `providers/*/go.mod` files still require nexus `v1.6.2`, which has no `money` package. Tag nexus first, then bump every provider's require to that tag, then tag the providers. Tag them in the other order and `go get` breaks for anyone who uses a provider on its own.
- Stop the old replicas first. An old binary keeps inserting rows after the new one has migrated. We made those rows read as unpriced (the Postgres and SQLite default, and the Mongo read rule), but a cache hit written by an old binary reads as unpriced too, not as cached $0. Before the first new replica migrates, stop the old ones.
- Minimum versions. MongoDB 5.0 or later, because `Series` uses `$dateTrunc` (the pipeline update that normalises old documents needs 4.2). PostgreSQL 12 or later, for `date_trunc` with a time zone.
- Migration locks. The Postgres migration rewrites `nexus_usage_records` under an ACCESS EXCLUSIVE lock, and builds three more indexes on top. On a large table that means downtime, so plan for it.
- Removed API. `model.CostEstimate`, `EstimateCost` and `EstimateCostFromTokens` are gone. Use `model.Cost`.
- Amount precision. Amounts are bounded to 18 decimal places, which is what Postgres `NUMERIC(38,18)` keeps. `money.Parse` and `ParseLenient` refuse a 19th place instead of letting a backend round it. Computed amounts are rounded to 18 places in `PerMillion` since slice 2 (Task 1), so the bound holds for every amount, parsed or computed.
- Writer guarantee. `usage.Service.Record` now normalises every record before the store sees it, and unknown costs stay unknown even for a writer that leaves the status out. A record that says `unpriced_model` and carries a cost is refused.
- Carry to slice 2: `settle` labels errors `unpriced_model` and marks a failed stream `ok`. Slice 2 has to define the status for error, blocked and refused rows.
- Carry to slice 2: the `ollama` and `lmstudio` placeholder price of `0.00001` has to be decided before `model.Cost` is wired in. Wire it first and local models come out priced.

Two things from the spec that still stand, and one that we didn't do. The provider token-reporting gaps are real: cost is list price over the tokens a provider reports, so cache, thinking and Gemini embedding tokens are still missing. And the spec asked for a price test in each provider module. We didn't write 29 of them. Task 2 carried every price literal over as the same text and diffed the before and after, 166 lines each way with an empty diff, which proves the same fact. If you want the tests anyway, add them in slice 2.

## What slice 2 found that slice 3 must know

Slice 2 made the gateway record, price and attribute every request. It also found that the default pipeline never ran its usage stage at all, which no test noticed because each one drove a middleware on its own. Everything below is what you need before you plan enforcement (gateway keys, per-tenant quotas, budgets, a pluggable Limiter).

The gateway-level tests in `gateway_usage_test.go` send real requests through `Engine` and a memory store, and they passed on the first run. They found no new gap in the slice. Two of them are worth knowing by name, because they would have caught the dead pipeline: `TestACompletionIsRecordedPricedAndAttributed` and `TestCustomMiddlewareAboveTheCallRunsPerAttempt`.

How a request is classified. The usage stage decides this once, after the request has finished, so you can read it as a table.

| What happened | Outcome | Pricing status | Cost |
|---|---|---|---|
| Served, tokens reported, model listed | `ok` | `priced` | list price over the tokens |
| Served, model not in the price book | `ok` | `unpriced_model` | nil |
| Served, no tokens of the kinds the price applies to, price is not Free (a completion that reports only a total counts) | `ok` | `unknown` | nil |
| Embedding that reports only a total (Voyage) | `ok` | `priced` | embedding price over the total |
| Served by a Free model | `ok` | `priced` | exactly `$0` |
| Cache hit, or stream replayed from the cache | `cached` | `cached` | `$0` |
| Output guard block of a cache hit (non-stream) | `blocked` | `cached` | `$0` |
| Failed stream during a cache replay | `cached` | `cached` | `$0` |
| Input guard block | `blocked` | `not_charged` | `$0` |
| Stream guard block, some tokens seen | `blocked` | `priced` | from the tokens seen so far |
| Stream guard block, no tokens seen | `blocked` | `unknown` | nil |
| Stream guard block during a cache replay | `blocked` | `cached` | `$0` |
| Output guard block with usage (non-stream) | `blocked` | `priced` | from the blocked response's tokens |
| Output guard block without usage (non-stream) | `blocked` | `unknown` | nil |
| A block with an empty or unknown phase | `blocked` | treated as output | charged or unknown, never assumed free |
| Failed stream, some tokens seen | `error` | `priced` | from the tokens seen so far |
| Failed stream, no tokens seen | `error` | `unknown` | nil |
| Refusal (`pipeline.Refusal`) | `refused` | `not_charged` | `$0` |
| Identity refusal (`ErrInvalidIdentity`: `invalid_request`, 400) | `refused` | `not_charged` | `$0`, recorded with no tenant and no key |
| Error after a provider was chosen | `error` | `unknown` | nil |
| Error before any provider was chosen | `error` | `not_charged` | `$0` |

`not_charged` and `unknown` are new statuses. The rule behind the table is the one from the constraints: an unknown cost is nil, never `$0`. A block that happened after the provider answered was paid for, so it must not read as free.

What your enforcement code plugs into:

- `pipeline.Refusal` is the interface your refusals implement (`RefusalCode()` and `StatusCode()`). Return one from any stage below usage and the usage stage records it as `refused` at `$0` under that code. You don't touch usage to get a row.
- Insert errors are counted on the usage stage, `Gateway.UsageInsertErrors()`, not on `usage.Service` as the spec said. Inserts are async and fail inside the stage, and a new method on `usage.Service` would break every implementer. If you want a `Stats` method on the service later, add it then.
- The identity stage (priority 30) refuses ids that disagree or don't parse, and puts the tenant and key on the request. Its error is a `pipeline.Refusal` now. Stages that wrap it can't see the context it sets, so usage reads the tenant and key from the context it was given first and falls back to the request fields.
- Stage order is request_id 5, tracing 10, usage 15, timeout 20, identity 30, stream_lifecycle 60, guardrail 150, transform 200, alias 250, cache 280, retry 340, custom middleware by priority, then provider_call, which is always last. Put an enforcement stage after identity (it needs the tenant) and before cache, or a cache hit skips your quota check. A custom stage below retry runs once per attempt, and retry retries every error, a refusal included.
- The stream lifecycle `QuotaResolver` is still unwired. Wire it in slice 3.

Things that changed under you:

- Pipeline embeddings always failed, because the capability was spelled `embed` where the check wanted `embeddings`. Fixed, so embeddings are recorded and priced now.
- `Builder.Build` returns `(Service, error)` now, and `NewHeaders` is gone along with its middleware. Both are v1 breaks for `MIGRATION.md`. The gateway sets no `X-Nexus-*` response headers and never did; the docs that promised them are corrected.
- Local models (`ollama`, `lmstudio`) cost exactly `$0` through `Pricing.Free` and the `provider.FreeOfCharge` interface. The `0.00001` placeholder is gone. The `models.list` contract and the React page must read `free` first, because a free model still serializes its per-million prices as `0` and would read as unpriced.
- Explicit `WithGatewayOption`s now beat the extension config. The extension used to append config-derived options after yours, so `WithUsageEnabled(false)` and `WithLogger` were silently overridden, and so were `BasePath`, `Timeout`, `MaxRetries` and `RateLimit`.
- A hand-built `Config{}` passed to `WithConfig` has `EnableUsage` false, so that gateway records nothing. `WithConfig` replaces the whole config; start from `DefaultConfig()`. If this keeps biting, make it a `*bool` in slice 4 with the contract.

Loose ends we left on purpose:

- The end of the pipeline chain still returns an empty response with a nil error if a third-party Terminal calls `next`. A Terminal shouldn't, but nothing stops it.
- A `Shutdown` that times out leaves the flush waiter parked until pending inserts drain. That is bounded by the 10 second insert timeout.
- A stream the client abandons can still be recorded as `ok`, because the race between `Next` and `Close` decides. The cost is right (unknown when no tokens arrived).
- Guard block rows hardcode status 400.
- Retry has no idea which errors are worth retrying. A request with no provider registered waits out the full 1.5 seconds of backoff before it fails. Two gateway tests take about 1.5 seconds for that reason: the retry test, where two failures are retried on purpose, and the failures test, where the no-provider case is retried by default.
- Stream cache tests reuse one request for the miss and the replay, and the identity tests don't cover key disagreement or an embedding with the id only in context.
- `Series.Unpriced` counts `unknown` as unpriced now, to agree with `Summary`. Memory `FindByPrefix` and the other backends still disagree on key status, as noted in the slice 1 section.
- `WithGatewayOption(WithConfig(...))` replaces config-derived values too. Worth a line in the extension docs in slice 7.

What the final review changed. The gateway tests passed, but the final review still found three paths that recorded the wrong amount, plus a shutdown that could lose records and two tenant gaps. All of them are fixed on nexus main, and each fix has a test that failed without it:

- A cache hit is known only from `StateCacheHit`. The cache copies a response on a hit and before it stores one, so a hit can no longer mark a charged miss as cached, and an output guard's redaction never reaches the stored entry.
- `Shutdown` closes the usage stage, then flushes, and returns the flush error joined with the store's close error. It also logs how many records were still pending. A stream counts as pending from the moment it opens, so a stream still open at shutdown is waited for (until your context ends). A record that would start after the stage closed is dropped, counted in `UsageInsertErrors` and logged with its request id. With nothing pending, `Shutdown` returns nil even on an expired context.
- The cache key uses the request's tenant and falls back to the context's. When the two disagree, the request bypasses the cache entirely. `NewCache` says tenant isolation depends on this.
- Gemini and Vertex embeddings report zero tokens now, since the number of inputs was never a token count. They record as `unknown` until those providers decode real counts.

Deferred to slice 3 or `MIGRATION.md`:

- M4: a caller-supplied request id that isn't a `req_` TypeID stays in the context but isn't recorded.
- M6: the tracing span (priority 10) reads the tenant from the context before identity runs, so in-process callers who set it on the request get spans with no tenant.
- M8: the auto-discovered `WithDatabase` is appended after your `WithGatewayOption`s, so it beats an explicit one.
- M9: Postgres usage rows keep the tenant foreign key, so a well-formed but unknown tenant is served and then its record is lost. Slice 3's unknown-tenant refusals should record unattributed.
- M10: `Engine.Complete` with `Stream: true` drops the stream without closing it, so there's no record and the stream counts as pending until shutdown gives up on it.
- M11: every insert gets its own goroutine. During a store outage those pile up without a bound on their number; a worker queue with a drop counter would cap it.
- N1, and slice 3's first task: a non-stream request reserves its insert only after `next` returns. So a completion still in flight when `Shutdown` starts loses its record while `Shutdown` returns nil. It is counted and logged, not silent, but it breaks the promise above. Move `reserve()` to the top of `Process`, before `next`, and add a gateway test with a completion in flight during shutdown.
- Vertex's embed response carries `statistics.token_count`, which the client doesn't decode yet. Decode it and Vertex embeddings price again instead of reading `unknown`.

## What slice 3 found that slice 4 must know

Slice 3 made the gateway say no. Keys are checked at the HTTP edge, tenants and quotas are enforced in the pipeline, and every refusal carries a code. The work ran on nexus main from 9301ea4 to 95c9ff7, then the docs and two example fixes on top. Below is what the contract and the React pages have to be built around. Where this section and the "Slice 3: enforcement" plan above disagree, this section is what the code does.

### Refusals

| Code | Status | Raised by |
|---|---|---|
| `unauthenticated` | 401 | the edge (no key, unknown key, malformed key), or the access stage for a named key that is unknown, revoked or expired |
| `forbidden` | 403 | tenant not active or unknown (at the edge for a keyed request, in the access stage for an in-process one), key on another tenant, key without the scope, route scope at the edge |
| `invalid_request` | 400 | `max_tokens` over the tenant cap or negative, tenant and key ids that do not parse or disagree, a key id with no tenant id, a stream sent to `Engine.Complete` |
| `rate_limited` | 429 | RPM, TPM, or `GlobalRateLimit` |
| `quota_exceeded` | 429 | daily requests, or a stream cut at `MaxStreamDuration` or `MaxStreamTokens` |
| `budget_exceeded` | 429 | monthly budget |
| `unavailable` | 503 | tenant, key, daily count or monthly spend could not be read (the tenant read happens at the edge too) |
| `content_blocked` | 400 | a guard block (recorded as `blocked`, not `refused`, see below) |

Over HTTP the body is `{"error":{"message","type","code"}}`. A 429 with a known wait carries `Retry-After` in whole seconds, rounded up. A 401 carries `WWW-Authenticate: Bearer`. Every `/v1` and `/admin` response carries `X-Request-Id`, the same id as the usage record, and a client-supplied one is ignored. A 500 says only `internal error`; the cause goes to the gateway log. A stream error that is not a refusal says `upstream error` in-band, and a refusal in-band has `type: refused` and `code` set to the refusal code.

Which refusals become usage rows matters for what the pages can show. A refusal inside the pipeline (access, quota, identity) writes a row with outcome `refused`, $0, under its code. A guard block is not a refusal: it is recorded as outcome `blocked`, with `BlockedBy` set and status 400. An input block costs $0, but an output block happens after the provider answered, so its row can carry cost (or `unknown` when the provider reported no tokens). Four things are not recorded at all: the edge 401, the route-scope 401 or 403 (`admin`, `models`), the edge 403 for a key whose tenant is not active or no longer exists, and the edge 503 when the key or its tenant cannot be read. They happen before the pipeline, with no tenant to charge, and recording them would let anyone write rows. So does a streaming request sent to `Engine.Complete`, which is refused `invalid_request` before the chain runs. The edge case is Ruling 3 below, and it contradicts the spec line "every refusal still writes a usage record". The gateway page cannot show a count of failed logins. If you want one, add an unattributed edge record with a rate cap, as a deliberate change. Since the final-review fixes (Ruling 18), the same goes for a disabled or suspended tenant's keyed traffic: it is refused at the edge, so it no longer writes `refused` rows, and the tenant page cannot show how much of it there was.

An unknown tenant is refused `forbidden` and recorded unattributed, because the Postgres foreign key would lose the row otherwise (M9, fixed).

A stream cut by a stream limit is recorded `error`, status 429, code `quota_exceeded`, and priced from the tokens it used. It is not a `refused` row, because the client got part of it.

### Counting and the budget

`DailyRequests` counts every recorded request except `refused` ones. Without that, a tenant held at its RPM burns its daily quota on the refusals. `blocked` rows do count, and so do `cached` and `error` rows. `usage.Service.DailyRequests` is what the quota stage reads, and the templ "requests today" figure (`dashboard/data.go`) now leaves refusals out too. The contract's `requestsToday` should say "not counting refusals" in its label, and `overview.get` has the outcome counts if you want the refused ones beside it.

The daily cap is hard (Ruling 17). Besides the store count, the quota stage charges each request to a UTC-day window in the limiter (`daily:<tenant>`) as its last check, and refuses when either says the day is full, so 50 requests sent at once to a 5-a-day tenant serve exactly 5. With the memory limiter that holds per replica; with Redis, across replicas.

The budget is soft, and softer than "the next one is refused". Nothing is reserved before a request runs, so every request admitted while the stored spend is under the budget is served: the overshoot can reach every request in flight times its cost. The review's probe served 100 parallel requests on a $0.01 budget and spent $0.8755. A stream's cost lands at `Close`, so a long session is invisible to the budget until it ends. A model with no price records no cost, so a budget never binds a tenant using only unpriced models. A failed insert adds nothing, and only `UsageInsertErrors` shows it. The docs tell operators to pair a budget with `RPM` and `MaxTokensPerReq`. Slice 4's tenant form should warn when a budget is set without RPM, and `usage.summary` should show the unpriced count beside the budget. Budget and daily are checked once, when a stream starts, and `MaxStreamDuration` counts from the first chunk, so a realtime session on a tenant without one runs unbounded. Only a positive budget limits. A negative `MonthlyBudgetUSD` is ignored by enforcement, so a tenant saved with one runs unlimited and nothing says so. The store accepts it, so `tenants.create` and `tenants.update` must refuse a negative budget with `BAD_REQUEST`.

The limiter fails open and counts each failure in `LimiterErrors`. Each limiter call made before a request runs is bounded at 250ms, so a hung Redis costs at most that per check and counts as a failure. The store fails closed with 503. The budget hooks (`BudgetWarning` at 80%, `BudgetExceeded` at 100%) fire once per tenant per month per replica, and a request that jumps a tenant from under 80% straight over 100% fires `BudgetExceeded` only. TPM is charged when a response ends or a stream closes, so a request that crosses the line completes. Cache hits are never charged to TPM. Failed requests are not charged either, though RPM still counts them.

`GlobalRateLimit` is enforced now, through the limiter under the key `global:rpm`, for every request including unattributed ones. It was stored and displayed before and never did anything. The memory limiter applies per replica; `WithLimiter(redislimit.New(client))` shares windows across replicas.

### Stage order

request_id 5, tracing 10, usage 15, timeout 20, identity 30, access 40, quota 50, stream_lifecycle 60, guardrail 150, transform 200, alias 250, cache 280, retry 340, custom by priority, provider_call last. The `gateway.get` stage list comes from `Gateway.PipelineStages()` and now has access and quota in it. Retry stops on a refusal, a guard block, a dead request context and a `pipeline.Permanent` error, so a refused request is no longer retried (Ruling 4 below).

### What the contract can read for posture

- `Gateway.Config().RequireAPIKey`. When it is false the dashboard says so loudest, and the copy must say what it opens: only the `/v1` routes (see Ruling 14). Either way the readout covers the HTTP `api` and `proxy` routes only (Ruling 21). A gRPC listener is anonymous unless the host installed `grpcsrv.KeyAuth`, and the gateway cannot see whether it did, so the posture copy says "HTTP api and proxy routes", not "the gateway".
- `Gateway.Limiter().Kind()`, `"memory"` or `"redis"`. It is nil before `Initialize`; the handlers already answer `UNAVAILABLE` until Start.
- `Gateway.LimiterErrors()`, requests let through because the limiter failed.
- `Gateway.UsageInsertErrors()`, records that failed to store.

Show the limiter kind next to the replica count, if the host knows it: `memory` with several replicas means each one counts on its own.

Ruling 16, corrected by the follow-ups: with `EnableUsage` false, no usage rows are written, so the monthly budget cannot apply. The daily cap still applies through the limiter, alongside RPM, TPM and token caps. The posture readout should say "usage off: the monthly budget is inert". Memory windows reset on restart and apply per replica; Redis shares them. `Initialize` logs the corrected warning too.

### Keys

- Keys have one shape: `nxs_` plus 64 lowercase hex. `key.Validate` returns `key.ErrNotFound` for anything else without a store call, so a malformed or non-UTF-8 value cannot reach Postgres (Ruling 13). A raw key is never logged, never in an error and never echoed except by `Create` and `Rotate`.
- `key.Service.Get` derives expiry: an active key past `ExpiresAt` reads `expired`. So do `Validate` and `key.Service.List(tenantID)`. The store's paged `key.Store.List(ListOptions{Status, Cursor})`, which `keys.list` (`status?`, `cursor?`) has to page through, does not: it compares the stored status, which never becomes `expired`. Used as it is, `status=expired` returns nothing, `status=active` includes expired keys, and the `overview.get` active-key count includes them too. Slice 4 must fix this before `keys.list` ships (Ruling 19): either add a paged `List` to `key.Service` that derives expiry, or push the derivation into each store's `List` and count queries (`active` means `status = 'active' AND (expires_at IS NULL OR expires_at > now)`; `expired` means the stored status is `expired`, or it is `active` with `expires_at <= now`), with conformance tests on all four backends. The contract's rule that every list filter is applied by the store at its index points at the second. The sentinels are `key.ErrNotFound`, `key.ErrRevoked`, `key.ErrExpired` and `key.ErrInvalid` (not the spec's `ErrKeyNotFound` and friends, Ruling 2). Revoked and expired are reported only after the hash matches, so an unknown prefix and a wrong hash look the same to a caller.
- `FindByPrefix` returns every key with the prefix in any status. `TouchLastUsed` writes `LastUsedAt` with a single-column update, at most once a minute per key, so it can no longer write a revoked key back as active.
- `Create` returns `key.ErrInvalid` for a missing name, a tenant id that does not parse, an `expiresAt` in the past or a scope it does not know, and wraps the store's not-found for a tenant that does not exist. `Rotate` on a key that is not active returns `ErrInvalid`.
- `Rotate` makes the new key, revokes the old one, and on a failed revoke revokes the new one too. If that rollback fails as well, the returned error names the replacement key id, which is still live and which nobody holds (Ruling 5). A failed rotation therefore emits `KeyCreated` and `KeyRevoked` for the same replacement. Revoking an already revoked key is a no-op and emits nothing.
- The scopes are constants: `key.ScopeCompletions`, `key.ScopeEmbeddings`, `key.ScopeModels`, `key.ScopeAdmin`, with `key.KnownScope`. The contract's scope picker should offer exactly these four.
- A key whose tenant is disabled, suspended or deleted is refused at the edge, 403, admin keys included (Ruling 18). `KeyAuthOptions.Tenants` does it; `auth.AuthenticateWithTenants` is the call, and `auth.Authenticate` still checks the key alone.
- `tenant.Service.Create` returns `tenant.ErrInvalid` (new) for a missing name or slug.
- Hooks now emitted: `KeyCreated`, `KeyRevoked`, `TenantCreated`, and `TenantDisabled` (when an active tenant becomes disabled or suspended). `BudgetWarning` and `BudgetExceeded` come from the quota stage.

### The first admin key

With keys required, no HTTP route can make the first admin key, because making one needs an admin key. The contract runs in-process and calls `gw.Keys().Create` directly, so `keys.create` works without one. For a fresh install the answer is Go: `gw.Keys().Create(ctx, &key.CreateInput{TenantID: ..., Name: "ops", Scopes: []string{"admin"}})`, printed once. An `admin` key administers every tenant, whichever tenant it belongs to. The docs site says this on the HTTP API page. `keys.create` should let an operator pick the `admin` scope and warn that it is cross-tenant.

### Controller rulings that change what slice 4 sees

| # | Ruling |
|---|---|
| 1 | Test Redis ran on 56479 because another project held 56379. Test setup only. |
| 2 | Key sentinels are `key.ErrNotFound`, `ErrRevoked`, `ErrExpired`. `RefusalError` lives in `pipeline` and the root re-exports it. |
| 3 | Edge refusals before the pipeline are not recorded as usage. The spec said every refusal is. |
| 4 | Retry stops on the live request context, not on the error type, so a provider HTTP timeout is still retried. |
| 5 | A failed `Rotate` rollback is joined into the error with the new key id. |
| 6 | The memory limiter sweeps at most once a minute, each window keeps its own end, and `Allow` refuses a window of zero or less and a negative charge with an error (the quota stage then fails open). |
| 7 | A cache hit is tested before the stream case, so a replayed stream is never charged to TPM. |
| 8 | A single request over 100% of budget from under 80% fires `BudgetExceeded` only. |
| 9 | Failed requests (output guard refusal, retried attempts) are not charged to TPM. |
| 10 | The TPM charge is synchronous with a 2 second timeout, so a hung Redis adds up to 2 seconds to a response or a stream Close. |
| 11 | A watchdog cut of a stream returns the quota error from `Next`, not the close error or a clean EOF. |
| 12 | `auth.WriteError` writes a refusal's own text and `internal error` for anything else. |
| 13 | The key shape check in `Validate`. |
| 14 | Admin routes always need an authenticated key with the `admin` scope. Needs Rex's confirmation, below. |
| 15 | A stream error that is not a refusal says `upstream error` in-band, with the cause logged. |
| 16 | With `EnableUsage` false no rows are written, so the daily and budget limits never trip while the rest of the quota stage runs. Docs and the posture readout say so. |
| 17 | The daily cap is a hard cap: a UTC-day limiter charge as the last check, refused at the larger of the store and limiter counts. The budget stays a soft store-of-record check, and the docs and this hand-off state its true bound. |
| 18 | A key whose tenant is not active is refused at every edge (403, 503 when the tenant cannot be read), through `KeyAuthOptions.Tenants`, not only on `/admin`. |
| 19 | I7 (`tenant.Config` is enforced nowhere) and I8 (the store's paged key `List` does not derive expiry) go to slice 4 as decisions, not fixes. I8 is in "Keys" above; I7 is Rex's call, below. |
| 20 | Postgres and SQLite get a `(tenant_id, created_at)` usage index (migration 20261007000002). The short-lived spend cache goes on the pre-production list. |
| 21 | `grpcsrv.KeyAuth` ships as a one-call interceptor, gRPC stays opt-in (`Register` unchanged), and the posture copy says "HTTP api and proxy routes". |

Ruling 14 needs Rex's yes. The plan let `RequireScope` pass an unauthenticated request, which meant `require_api_key: false` also opened `/admin/*` to anyone, including key creation, so anyone could mint an admin key. We decided toward fail-closed: `RequireScope` refuses with 401 when `KeyAuth` has not run on the request, and `require_api_key: false` opens only `/v1`. The cost is that local work with an open gateway still needs one Go call to make an admin key before the admin API answers. If Rex wants the other behaviour, it is a change to `api/api.go` (the `adminKeys` wrapper and `RequireScope`) and to the HTTP API docs page. The final review agreed with Ruling 14 and asked for two refinements: a bootstrap that does not need Go (on the pre-production list below), and tying it to tenant status, which Ruling 18 did.

I7 needs Rex's decision too (Ruling 19). `tenant.Config` is read nowhere outside the stores and the templ dashboard: `AllowedModels`, `BlockedModels`, `DefaultModel`, `RoutingStrategy`, `GuardrailPolicy` and `CacheEnabled` do nothing. The templ dashboard edits them today, and slice 4's `tenants.update` would expose every config field, so an operator who blocks `o1` for a tenant would reasonably expect `o1` to be refused. It is a money control that does nothing. Two routes:

- enforce `AllowedModels` and `BlockedModels` in the access stage as 403 `forbidden`, recorded, deciding whether to match the requested name or the alias target (alias resolution runs later, at 250), and add the `tenants.update` validation;
- or leave the config fields out of the contract, or label them "stored, not enforced", and record the gap.

Slice 4 should not start `tenants.update` until Rex picks one.

Do not trust the message of commit 13ff919. It says `/admin` is open when `RequireAPIKey` is off. The code and its tests follow Ruling 14, and the admin API is closed. Nobody amended the commit, so the message stays wrong; this paragraph is the correction.

Two more edge behaviours the posture copy has to match. Any non-empty `Authorization` header counts as a presented key, so on an open gateway a forwarded Bearer JWT or a Basic credential from an auth proxy gets a 401. When both headers are present `x-api-key` wins, and `Bearer` is case-insensitive. A missing or bad key on `/v1/realtime` gets a 401 at the handshake, before the upgrade. Close code 1008 applies only to a pipeline refusal after the session has started.

### What the slice 4 contract must map

- `key.ErrInvalid` and `tenant.ErrInvalid` to `BAD_REQUEST`. The HTTP admin handlers in `api/` now do this (400, 404, or a fixed 500 with the cause logged); the templ handlers in `dashboard/contributor.go` still answer every `Create` error as a 500 or raw text, and slice 7 retires them.
- `tenant.ErrNotFound` (and the not-found wrapped by `key.Create` for an unknown tenant) to `NOT_FOUND`.
- `key.ErrNotFound` to `NOT_FOUND`. `Rotate` on a revoked or expired key returns `key.ErrInvalid` (with the status in the message), so it is `BAD_REQUEST`; `key.ErrRevoked` and `key.ErrExpired` come from `Validate` only, which the contract does not call.
- A negative `MonthlyBudgetUSD` to `BAD_REQUEST` on save, as above.
- The contract's own rule stands: log the cause, answer `INTERNAL`. The `api/` admin handlers follow it now, through `writeAdminError`.
- The proxy answers an unknown model with `not_found_error` and the api with `not_found`. The contract does not call either, but the fixtures should not copy one into the other.

### Deferred, with the reason

- M4: a caller-supplied request id that is not a `req_` TypeID is still dropped from the record. The edge now makes its own `X-Request-Id` and ignores the client's, which covers HTTP; in-process callers still have the gap.
- M6: the tracing span still reads the tenant before identity runs.
- M8: the auto-discovered `WithDatabase` is still appended after `WithGatewayOption`s.
- M11: inserts still get one goroutine each, unbounded during a store outage.
- Vertex `statistics.token_count` is still not decoded.
- gRPC authentication by default. `grpcsrv.KeyAuth(gw.Keys(), gw.Tenants())` is a one-call stream interceptor running the same check as the HTTP edge, tenant status included, and the gRPC example installs it. `Register` still does not authenticate (Ruling 21), and the package doc says so. The posture consequence: `requireApiKey: true` says nothing about a gRPC listener, which is anonymous without the interceptor, every call unattributed, with only `GlobalRateLimit` applying.
- WebSocket browser auth. Headers only, so a browser client needs a proxy that adds the key.

What the slice 2 hand-off asked slice 3 to do and it did: N1 (usage reserves before `next`), M9, M10, wiring the stream `QuotaResolver` (a default resolver reads the tenant's stream limits), the retry-on-refusal gap. Still open from slice 2: a Terminal that calls `next` gets an empty response, a timed-out `Shutdown` leaves the flush waiter parked, an abandoned stream can record `ok`, and guard block rows still hardcode status 400 even though `guard.BlockedError` carries its own now.

### Minor findings carried forward

Each of these was found in review, judged too small to hold a task, and is written down so the next person does not rediscover it.

- Posture and numbers: the posture readouts above are the only operator-facing signals for limiter and insert health. There is no per-tenant refusal count by code except through `usage.records`: filter `outcome=refused` for quota, budget, access and identity refusals, and `outcome=blocked` for guard blocks, which are a separate outcome and can carry cost.
- Redis limiter: a charge of zero has no test for the TTL; the key TTL is the window plus one second from creation, so replica clock skew over about a second can reset a window; the unreachable-Redis test prints a dial failure to stderr.
- Memory limiter: `RetryAfter` uses the stored window's end, so one key used with two window sizes sharing a start gets the first window's end (keys are per limit, so unlikely); the sweep clock is a package variable used as a test seam.
- Quota stage: no test for the embedding TPM charge; the warned and exceeded maps are never pruned (one entry per tenant per replica); the `gw.usage != nil` guard before `NewQuota` is dead.
- Access stage: edge scopes trust the edge and do not re-check the key's tenant or status, by design. `pipeline.WithScopes` is exported, so a component between `KeyAuth` and `RequireScope` could grant scopes; keep that wiring trusted.
- Stream: with cumulative usage on several chunks, a cap tripped by a later chunk prices the earlier smaller usage; the duration watchdog goroutine lives until `Close` after a normal end; `Close` before a queued quota error is read emits `StreamCompleted`.
- Usage: `Flush` leaves its waiter parked after a context timeout, so repeated timed-out `FlushUsage` calls accumulate goroutines; the SQL `DailyRequests` hard-codes `'refused'` while Mongo and memory use `usage.OutcomeRefused`; the recover and re-panic defer misses `runtime.Goexit`.
- Retry and errors: no test that `RefusalError.Unwrap` reaches `Cause` through nested wraps; `ErrInvalidIdentity` is an exported mutable pointer; a refused `Execute` with `Stream: true` is refused before the chain, so it is not recorded; `guard.BlockedError.Reason` reaches the client verbatim, which exposes a third-party rule's text.
- Edge: no test pins the api and proxy WebSocket `OnError` wiring; `WSOptions.OnError` overrides one the caller supplied; model-route 500s are untested because the fake `ListModels` never fails. Fixed in the final-review wave: client disconnects no longer log at error level (`httpstream.ClientGone`), Gemini sends its key in a header and `LogServerError` redacts credential query values, and the proxy exposes `X-Request-Id` to browsers.
- Tenant service: `Delete` emits no event, so a hook consumer tracking tenant availability misses deletions (review M9). Consider `TenantDeleted`, or emitting `TenantDisabled`.
- Docs: the errors page used to map `ErrBudgetExceeded` to 402 and `ErrTokenOverflow` to 413, and the HTTP API page listed `PUT` and a `/admin/usage/summary` route that do not exist. Both are corrected, and the errors page now lists the sentinels that really exist in `errors.go` (the old list named eight that were never defined). Of those, only `ErrProviderNotFound` is returned by any code (`Engine`, when it has no pipeline). Every other one, for example `ErrBudgetExceeded`, `ErrRateLimited`, `ErrUnauthorized`, `ErrQuotaExceeded` and `ErrContentBlocked`, is exported and unused, and the HTTP status comes from refusals, not from sentinels. Remove them in the v1 break or wire them, and note it in `MIGRATION.md`.
- Task 1: no test for the panic path leaving `Pending()` at zero; the `usage.go` docs for the type, `pending`, `Pending()` and `Flush` still say "open streams and inserts" when requests with the provider count too; the gateway test leaves its `Complete` goroutine blocked if the negative check fails (needs a `t.Cleanup`).
- Task 2: the builder's stream refusal message names `Engine.CompleteStream`, which means little to someone using `pipeline.Service` directly.
- Task 4: `Revoke`'s full-row `Update` can overwrite a concurrent `TouchLastUsed` timestamp (a lost timestamp, nothing worse); `Rotate` reuses `old.ExpiresAt`, so rotating a key that expires within moments fails with `key.ErrInvalid` ("expires_at is in the past"), and the contract must map that to `BAD_REQUEST` with a message that says to create a new key; the events fake reads without its mutex in single-goroutine tests.
- Task 5: `TestDailyRequestsLeaveOutRefusals` has no unattributed row for the empty-tenant ("every tenant") case.

### What the final review changed

The whole-slice review found no critical issue and nine important ones. The fixes landed on nexus main after 3928ba4, one commit per concern, under Rulings 17 to 21. What they change for slice 4 is written into the sections above. In short:

- the daily cap is hard under concurrency, and the budget's real bound is stated (Ruling 17);
- Postgres and SQLite index usage by `(tenant_id, created_at)` (Ruling 20);
- a key whose tenant is not active is refused at every edge, admin keys included (Ruling 18);
- Gemini sends its key in a header, the gateway log redacts credential query values, and gRPC errors are sanitized and carry real status codes;
- `grpcsrv.KeyAuth` is the one-call gRPC interceptor, and the package says gRPC is anonymous without it (Ruling 21);
- the admin handlers map their errors (400, 404, fixed 500), a client that hits stop is no longer logged as an error, and the proxy exposes `X-Request-Id` to browsers;
- a key id without a tenant and a negative `max_tokens` are refused, each limiter check before a request is bounded at 250ms, unknown scopes are refused, and `Initialize` warns when usage is off;
- the Identity & Auth page is rewritten, `auth.Provider`, `nexus.WithAuth`, `auth.NewNoop` and `auth/authsome` are deprecated, and the tenancy, store and HTTP API pages are corrected.

I7 and I8 were resolved in the 2026-10-08 follow-ups below. The earlier decision paragraphs record the review history; they no longer block Slice 4.

### v1 breaking changes from slice 3

These ship together in one v1 release. Nexus has no `MIGRATION.md` yet; open one before the tag and carry this table into it.

| Change | Documented where | Safe? |
|---|---|---|
| `RequireAPIKey` defaults to true | configuration, http-api, forge-extension, getting-started | Yes. Fail-closed is right. |
| `/admin` always needs a key with the `admin` scope | http-api, this hand-off | Yes (Ruling 14). |
| `Engine.Complete` with `Stream: true` is refused `invalid_request` | the refusals table above | Yes. It used to leak a pending stream. |
| `api.New` and `proxy.New` panic before `Initialize` | godoc | Mostly. Calling `New` before `Initialize` was legal, because handlers resolved the engine lazily. `NewEngine` returns nil on an `Initialize` error, so `proxy.New(nil)` is a nil dereference with no message. |
| `key.Store.FindByPrefix` returns a slice, and `key.Store` gains `TouchLastUsed` | this hand-off, guides/custom-store | Compile-time break for custom stores, which is acceptable. |
| `key.Service` gains `Get` | nowhere before this table | Compile-time break for `WithKeyService` implementers. |
| `usage.Store.DailyRequests` must exclude `refused` rows | interface godoc, guides/custom-store | Silent semantic break: a custom store that keeps counting refusals compiles and lets RPM refusals burn the daily quota. |
| `key.NewService` and `tenant.NewService` take options | godoc | Yes. Variadic, so source compatible. |
| Any non-empty `Authorization` header is a 401 on an open gateway | http-api, identity | Yes, but an Authsome Bearer token now gets a 401 (see the deprecation row). |
| `Builder.Build` returns an error (slice 2) | slice 2 hand-off | Yes. |
| Examples | fixed (b609d72, and the gRPC example in the final-review wave) | Yes. |
| A key whose tenant is disabled, suspended or deleted is refused 403 at the edge, and that traffic writes no usage rows | identity, http-api | Yes. It was the operator's kill switch and did not stop admin keys. |
| `key.Create` refuses unknown scope names with `key.ErrInvalid` | identity, http-api | Mostly. A caller that stored a made-up scope now gets an error on create; keys already stored are not touched. |
| `tenant.Service.Create` errors wrap `tenant.ErrInvalid`, and their text starts "nexus: invalid tenant input" | godoc | Yes, unless a caller matched the old strings. |
| Admin HTTP errors: 400 and 404 where they were 500, and a fixed `internal error` 500 instead of raw text | http-api | Yes. |
| A request naming a key id with no tenant id, and a negative `max_tokens`, are refused `invalid_request` | multi-tenancy | Yes. |
| `grpcsrv.NewServer` and `Register` take options; gRPC errors carry mapped status codes and fixed text instead of raw error text | grpcsrv godoc | Source compatible. A client that parsed the raw error text sees "internal error" now. |
| `auth.Provider`, `nexus.WithAuth`, `auth.NewNoop` and `auth/authsome` are deprecated and were never consulted | identity, godoc | Yes. Remove them in v1, or wire `auth.Provider` as an alternative validator in `KeyAuthOptions` (Rex's call). |
| The exported error sentinels other than `ErrProviderNotFound` are unused | errors page | Remove or wire them in v1 (see "Docs" above). |

### Before production load

Not needed for slice 4, but needed before a busy gateway runs on this:

- Cache the spend for a few seconds. Every request of a capped tenant still reads the month's spend and the day's count from the store, plus a key and a tenant lookup (two, now that the edge reads the tenant). The new index keeps that from scanning, but a per-replica cache of spend and count for one to five seconds, or running counters, would take the store off the hot path. The budget is soft already, so a cache changes nothing a client can see beyond the bound above (review I2).
- Rate-limit the limiter's error log. During a Redis outage every limiter call logs at Error, up to four per request plus one per TPM charge. Log the first failure and then once a minute with a count. The Redis limiter also counts a cancelled client context as a limiter error, which inflates `LimiterErrors` (review M4).
- Make the first admin key without Go. Today it can only be made from Go. Something like `nexus.WithBootstrapAdminKey(raw)`, or an environment variable the forge extension reads once and applies idempotently by hash, or a CLI subcommand, so an operator running the extension from config can get started (review, on Ruling 14).

## Slice 3 follow-ups, verified on 2026-10-08

The takeover checked Nexus `main` at `43b8a2d`. Slices 1 to 3 were already
implemented, despite the older chat handoff saying Slice 1 had not started.
The remaining follow-up work was documentation and verification.

Rex confirmed Ruling 14 on 2026-10-08 and asked for the long-term fixes.
Admin routes always require an admin key. The extension now accepts
`bootstrap_admin_key`, falling back to `NEXUS_BOOTSTRAP_ADMIN_KEY`, and applies
it after migration. Only its hash is stored. A revoked key stays revoked;
the key hash is unique in every store, and `Ensure` re-reads after a concurrent
insert. An existing inactive operator tenant fails startup. Use random key
material, as shown in the HTTP API guide.

I7 is implemented. `DefaultModel` fills an omitted model; `model_policy` at
priority 260 checks both the requested name and the chosen alias target;
blocks win over allows. `CacheEnabled: false` bypasses cache reads and writes,
including stream replay. `RoutingStrategy` and `GuardrailPolicy` remain
stored, not enforced. The contract must describe those two fields that way.

I8 is implemented in all four stores. `key.Service.ListPage` and `Count`
derive expiry through store filters using the service clock. Use these for
`keys.list` and the active-key count; do not bind the store's `Now` field
from client input.

The tenant service now refuses deletion when keys or usage history exist,
with `tenant.ErrInUse`. The HTTP API maps it to 409. The contract still has no
tenant-delete command. Disable a tenant to stop traffic and keep its history.

The stream lifecycle now protects its accumulator and watchdog state during
concurrent `Next` and `Close`. This verifies the wrapper's state, not the
concurrency safety of every provider stream. The independent final review
found no important introduced defect and noted a pre-existing OpenAI stream
`done` race outside this change's scope. It also noted that extension config
serialization can include the bootstrap value, so dashboard settings must
use an explicit safe projection rather than serialize extension config.

Fresh verification passed: root `go test -race ./...` with Postgres on 55632,
Mongo on 57632 and Redis on 56479; standalone `GOWORK=off go vet ./...` and
`go test ./...` in all 37 nested modules; fresh-cache lint with zero issues.
The existing test containers were reused. Browser verification has not begun.

Upgrade with a maintenance window. The composite usage index migration builds
while blocking writes on a large table. On Postgres you can create the exact
index with `CONCURRENTLY` before upgrading, outside a transaction; the
migration's `IF NOT EXISTS` then skips it. SQLite time normalization remains
in `Store.Migrate`, so external migration orchestrators must also call it.
Stop old writers before migration to avoid reintroducing legacy time strings.
