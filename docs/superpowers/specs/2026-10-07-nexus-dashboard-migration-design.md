# Nexus dashboard: templ to React shell

Status: design approved in conversation on 2026-10-07, awaiting review of this
written spec.

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
`driver.Valuer`, and marshals to BSON as `Decimal128`.

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
  which removes the panic class in the services at its source.
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

**Errors.** `store.ErrNotFound` maps to `NOT_FOUND`, validation to
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
- The Postgres cursor orders on `id COLLATE "C"`, which can't use a primary key index built with the default collation on a non-C database. Add an `id COLLATE "C"` index, or a column collation, before the request log grows.
- `grpcsrv` and `_examples/grpc` replace `nexus` with the root checkout, so they needed their own `go mod tidy` for `shopspring/decimal` (commit 024ee78). The 32 provider modules replace it the same way and are tidied too (commit 4ff44e2, 30 of them with a new go.sum that holds only the decimal lines). `GOWORK=off go vet` passes in all of them, and it will fail again the next time a module gains a dependency without its own tidy.

Two things from the spec that still stand, and one that we didn't do. The provider token-reporting gaps are real: cost is list price over the tokens a provider reports, so cache, thinking and Gemini embedding tokens are still missing. And the spec asked for a price test in each provider module. We didn't write 29 of them. Task 2 carried every price literal over as the same text and diffed the before and after, 166 lines each way with an empty diff, which proves the same fact. If you want the tests anyway, add them in slice 2.
