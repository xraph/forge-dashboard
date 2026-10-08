# Nexus Slice 4 Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the React dashboard an operator-wide contract backed by Nexus services, with exact money, explicit scope and safe key projections.

**Architecture:** `extension/contract` owns the wire types, validation and intent handlers. A lazy gateway resolver keeps registration independent of startup. Reads use paged services and explicit projections; writes merge optional fields into the existing tenant before calling its service.

**Tech Stack:** Go 1.26, Forge v1.12.3 (explicitly requested on 2026-10-08), Nexus services and the existing four-store test harness.

**Execution update:** Rex requested Forge v1.12.3 immediately after this plan
was committed. This supersedes the original interim dependency gate. Register all
18 intents now, with `dispatcher.SecretResponse()` for key create/rotate,
and test tombstone replay and transport invalidation in this slice. Retain
the three disconnected legacy contributor, manifest and data files as build-ignored
migration reference because Forge removed their API. The templ pages still
compile and remain until browser verification and separate retirement.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`, including the verified Slice 3 follow-ups.

Paths below are relative to `/Users/rexraphael/Work/xraph/forgery/nexus`. This plan lives in forge-dashboard.

## Global Constraints

- Work on `main` in both primary checkouts. No branches or worktrees.
- Inspect branch, staged diff and concurrent changes before each exact-path `git commit --only`. Never broad-stage, amend, stash, clean or reset. Never push or merge.
- `ContributorName`, manifest contributor and React identity are `nexus`.
- Do not read `Principal.Claims`. Absent tenantId means all; present blank, null, wrong-type or malformed values are BAD_REQUEST; unknown valid IDs are NOT_FOUND.
- Money is a string or null. Latency and duration fields explicitly name milliseconds. Times are UTC RFC3339. Collections are arrays even when empty.
- Every command declares invalidates. Updates preserve unspecified quota, config and metadata fields.
- A raw key appears only in a successful create or rotate response. Never put it in logs, assertions, read DTOs or fixture state.
- Keep the templ pages compiling until browser verification and their separate retirement commit. Forge is pinned to v1.12.3 now; the disconnected legacy adapter is retained with build-ignore tags.
- Register key create/rotate with `dispatcher.SecretResponse()` on Forge v1.12.3. Verify tombstones and concurrent replay through the actual transport.
- No production import of `forge/extensions/dashboard`; interface assertions belong in `_test.go`.
- Use rex-voice followed by humanizer embedded mode for shipped prose.

## Review Focus

1. Null or wrong-type scope must not become an all-tenant query. Exercise raw JSON through dispatcher bindings in Task 1 and each scoped query in Task 3.
2. Editing RPM must retain stream caps, cache inheritance and both metadata maps. Exercise populated updates on memory and SQLite in Task 2.
3. A read must never expose a hash, bootstrap key or raw key, even after create and rotate. Task 4 marshals every read response and checks with boolean assertions that never print a secret.
4. Usage disabled must yield unavailable financial figures, with the daily limiter still described as active. Tasks 1 and 3 assert explicit null figures and a posture scope limited to HTTP api/proxy.
5. Repeated key create/rotate commands must not replay a secret. Task 4 tests SecretResponse tombstones, concurrent retries and invalidates over the real Forge transport.

## Task 1: Registration, readiness and settings

**Files:** create `extension/contract/{contract.go,errors.go,scope.go,handlers_settings.go,manifest.yaml,contract_test.go}`, `extension/dashboard_contract.go`, `extension/dashboard_aware_test.go`.

**Interfaces:**

```go
type Deps struct {
    Gateway func() *nexus.Gateway
    Logger nexus.Logger
}
func Register(d *dispatcher.Dispatcher, reg dashcontract.Registry, wreg dashcontract.WardenRegistry, deps Deps) error
func gateway(deps Deps) (*nexus.Gateway, error)
func tenantScope(ctx context.Context, gw *nexus.Gateway, raw json.RawMessage) (string, error)
func mapError(err error) error
```

- [x] Write tests that dispatch `settings.get` before and after changing the resolver from nil to an initialized gateway. Before startup expect retryable UNAVAILABLE. Afterwards assert effective config in milliseconds, without bootstrap values or extension config serialization.

```go
data, _, err := d.Dispatch(ctx, dashcontract.Request{
    Contributor: "nexus", Intent: "settings.get", IntentVersion: 1,
    Kind: dashcontract.KindQuery, Payload: json.RawMessage(`{}`),
}, dashcontract.Principal{})
if codeOf(err) != dashcontract.CodeUnavailable { t.Fatal("startup must be unavailable") }
_ = data
```

- [x] Run `go test ./extension/contract ./extension`; expect missing contract implementation.
- [x] Add generic query/command binders, validate manifest/binding names and kinds in both directions, sanitize internal errors, and register settings only. Register the extension resolver using `IsStarted()` so a failed migration never exposes a ready gateway.
- [x] Map domain not-found, invalid input, invalid period/cursor and cancelled requests. Log unknown errors with intent and cause; return fixed INTERNAL text.
- [x] Test explicit tenant scope against two populated tenants and malformed/null/wrong-type values. No principal field participates in resolution.
- [x] Run `go test -race ./extension/...`, `go build ./...`, fresh-cache lint. Commit exact new files with subject `feat(nexus): register the dashboard contract after startup`.

## Task 2: Tenant reads and partial writes

**Files:** create `extension/contract/{project.go,handlers_tenants.go,handlers_tenants_test.go}`; extend `contract.go` and `manifest.yaml`. Add `tenant.ErrDuplicate` and map duplicate-slug errors in all stores if required by the tests.

**Interfaces:** `tenantRow`, `quotaView`, `tenantConfigView` are explicit camelCase DTOs. `tenantsListRequest` carries status/search/cursor/limit. `tenantUpdateRequest` has `ID string`, optional Name, nested quota and config patches, and an optional metadata map. Each nested field is optional. Cache inheritance uses a presence-aware nullable boolean so absent preserves and null resets.

- [x] Write tests using `storetest.Each`: create two tenants, list by status/search and page with limit one, read exact budgets, reject malformed/unknown ids, and confirm operator-wide visibility despite arbitrary claims.

```go
before := tenant.Quota{RPM: 10, MaxStreamTokens: 900, MaxStreamDuration: time.Minute}
// Create through the service, dispatch an update containing only quota.rpm,
// then read from the store. The stream fields must still match before.
patch := json.RawMessage(`{"quota":{"rpm":25}}`)
_ = before
_ = patch
```

- [x] Run `go test ./extension/contract`; expect absent tenant intents.
- [x] Implement `tenants.list`, `tenants.get`, `tenants.create`, `tenants.update`, `tenants.setStatus`. Read spend only when usage is enabled. Refuse whitespace-only names, negative limits/budgets, overflowing duration conversion, invalid statuses and overlapping model lists.
- [x] Preserve stored routing strategy and guard policy, and return their enforced=false descriptors. Merge dirty fields into the existing entity before calling Update. Never replace a populated quota with a zero-valued partial patch.
- [x] Bind exact invalidates from the spec. Add `tenants.get` invalidation to create only if a real dependent read requires it; avoid unrelated invalidations.
- [x] Verify duplicate slug gives CONFLICT on every backend, including concurrent memory inserts; correct the persistence boundary rather than relying on a racy preflight read.
- [x] Run contract/store/tenant tests with the DB variables, root tests and fresh-cache lint. Commit the store correction separately from the tenant contract.

## Task 3: Usage, overview and gateway reads

**Files:** create `extension/contract/{handlers_usage.go,handlers_overview.go,handlers_gateway.go,handlers_usage_test.go,handlers_gateway_test.go}`; extend project/bindings/manifest. Add read-only cache kind inspection in `cache` and `nexus` if no supported accessor exists.

**Interfaces:** `usageSummaryRequest{TenantID json.RawMessage; Period string}`, `usageRecordsRequest` includes tenantId/keyId/provider/model/outcome/from/to/cursor/limit; `usageSeriesRequest` adds bucket. Responses use nullable exact cost strings and `usageEnabled`. Provider and model aggregates are arrays ordered by decimal cost, with name as tie-break.

- [x] Seed hand-computed records under two tenants: priced `0.1` and `0.2`, unpriced, cached and refused. Add an out-of-window record. Assert identity isolation, exact `0.3`, null unknown cost, unpriced count, millisecond latency and real cursor continuation.
- [x] Run contract tests and observe missing usage intents.
- [x] Implement `usage.summary`, `usage.series`, `usage.records`. Validate period/bucket, time bounds, outcome, optional tenant and key IDs before store calls. Validate key ownership when both key and tenant are supplied.
- [x] Implement `overview.get` from complete cursor traversal of tenant status counts, key Count(active), current period summaries and posture. No page length is called a total. Usage off gives null spend/counts and empty chart data with usageEnabled=false.
- [x] Implement `models.list`, `providers.list`, `gateway.get`. Never ping providers. Read traffic for the last 15 minutes through cursor paging, with requests/errors null when usage is off. Free models have known zero pricing; absent prices remain unknown. Return configured guards and coverage caveats, never a pass verdict. No fabricated route explanation or cache size.

```go
// Exact sorting, also used for deterministic fixtures.
slices.SortFunc(rows, func(a, b aggregateRow) int {
    if n := b.cost.Cmp(a.cost); n != 0 { return n }
    return strings.Compare(a.Name, b.Name)
})
```

- [x] Assert settings and gateway lists are deterministic and empty arrays, missing capability statistics remain null, custom cache kind is unknown rather than guessed, and provider health methods are never called.
- [x] Run root race tests with DB variables and fresh-cache lint. Commit usage/overview and gateway/catalog changes as separate coherent commits if their gates pass independently.

## Task 4: Key lifecycle and one-time results

**Files:** create `extension/contract/{handlers_keys.go,handlers_keys_test.go}`; extend projections/bindings/manifest.

**Interfaces:** `keys.list` uses `key.Service.ListPage`; `keys.get` uses Get; `keys.revoke` calls Revoke and returns the projected key. Direct create/rotate handlers return `{key, rawKey, revokedKeyId?}`. No read type has a Hash or RawKey field.

- [x] Write read/write tests against memory and SQLite with active, expired and revoked keys. Seed two tenants, page with limit one, filter effective status, and assert unknown/blank/wrong-type tenant filters refuse as specified.
- [x] Run tests and observe missing key intents.
- [x] Implement reads and revoke, including tenant names without exposing hashes. Validate all scopes and expiry strings on create; refuse an explicitly empty scope list rather than silently granting default scopes. Directly test create and rotate, checking persistence and old-key revocation with boolean assertions for sensitive values.

```go
wire, err := json.Marshal(read)
if err != nil { t.Fatal("marshal read") }
if bytes.Contains(wire, []byte(raw)) || bytes.Contains(wire, []byte(hash)) {
    t.Fatal("read exposed key material")
}
```

- [x] Register all key intents, with SecretResponse on create/rotate. Verify CSRF, wire invalidation, tombstones and concurrent retries using the Forge transport and idempotency adapter.
- [x] Run contract race tests, root tests and fresh-cache lint; commit with subject `feat(nexus): expose key administration without retaining secrets`.

## Task 5: Contract gate and next-slice record

**Files:** update this plan's progress and the approved spec; create `extension/contract/README.md` describing secret-command handling and wire conventions.

- [x] Test the complete registered intent set, exact invalidation lists and all read responses for secret leakage. The manifest has all 18 intents, including protected secret registration.
- [x] Run `go build ./...`, the root race suite with all three DB variables, `GOWORK=off go vet ./...` and `go test ./...` in all nested modules, and lint with a new cache directory.
- [x] Obtain a fresh final review of this slice, fix important findings with reproducing tests, and record any deferred minor findings with their impact.
- [x] Record verified backends and remaining gates in the spec. Slice 5 can develop against all 18 intents. React fixtures, installed-host browser checks and templ retirement remain later gates.

## Self-review

The plan covers all 18 intents on Forge v1.12.3. Tasks 2 and 4 share explicit
DTOs, Task 3 reuses scope and error mapping, and all binders resolve the gateway
lazily. The five review-focus conditions have tests in their owning tasks.

## Execution status

Tasks 1 through 4 are committed in Nexus through `3b4c7f0`. Root race tests
passed with memory, SQLite, Postgres, Mongo and Redis coverage, and fresh-cache
lint reported zero issues. SQLite service timestamps required two regression
fixes so records created with Go's monotonic clock can be read. Existing
legacy timestamps remain readable.

The Forge transport returns dispatcher errors with HTTP 500, including the
`CONFLICT` envelope on secret replay. Tests check the envelope code, one-time
secret behavior and exact invalidations; the React client reads that code.
Task 5's complete query leak gate passed. The final review found a tenant rename
invalidation dependency, now covered by a red-to-green transport test. The
post-review root race suite and contract lint both passed. Slice 4 is complete.
