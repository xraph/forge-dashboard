# Nexus Slice 4 Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the React dashboard an operator-wide contract backed by Nexus services, with exact money, explicit scope and safe key projections.

**Architecture:** `extension/contract` owns the wire types, validation and intent handlers. A lazy gateway resolver keeps registration independent of startup. Reads use paged services and explicit projections; writes merge optional fields into the existing tenant before calling its service.

**Tech Stack:** Go 1.26, Forge v1.10.0 during direct-handler development, Nexus services and the existing four-store test harness. Final integration requires Forge v1.12.3 for `dispatcher.SecretResponse()`.

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
- Keep templ compiling until browser verification and its separate retirement commit. Keep Forge v1.10.0 until then.
- Forge v1.10.0 and v1.12.0 cache command bodies. Implement and directly test key create/rotate now, but do not advertise or register them until Slice 7 pins released v1.12.3 and binds them with SecretResponse. That gate is required, not a completed integration.
- No production import of `forge/extensions/dashboard`; interface assertions belong in `_test.go`.
- Use rex-voice followed by humanizer embedded mode for shipped prose.

## Review Focus

1. Null or wrong-type scope must not become an all-tenant query. Exercise raw JSON through dispatcher bindings in Task 1 and each scoped query in Task 3.
2. Editing RPM must retain stream caps, cache inheritance and both metadata maps. Exercise populated updates on memory and SQLite in Task 2.
3. A read must never expose a hash, bootstrap key or raw key, even after create and rotate. Task 4 marshals every read response and checks with boolean assertions that never print a secret.
4. Usage disabled must yield unavailable financial figures, with the daily limiter still described as active. Tasks 1 and 3 assert explicit null figures and a posture scope limited to HTTP api/proxy.
5. Repeated key create/rotate commands must not replay a secret. Task 4 verifies these are absent from the interim manifest. Slice 7 must test SecretResponse tombstones and invalidates over the real transport before registering them.

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

- [ ] Write tests that dispatch `settings.get` before and after changing the resolver from nil to an initialized gateway. Before startup expect retryable UNAVAILABLE. Afterwards assert effective config in milliseconds, without bootstrap values or extension config serialization.

```go
data, _, err := d.Dispatch(ctx, dashcontract.Request{
    Contributor: "nexus", Intent: "settings.get", IntentVersion: 1,
    Kind: dashcontract.KindQuery, Payload: json.RawMessage(`{}`),
}, dashcontract.Principal{})
if codeOf(err) != dashcontract.CodeUnavailable { t.Fatal("startup must be unavailable") }
_ = data
```

- [ ] Run `go test ./extension/contract ./extension`; expect missing contract implementation.
- [ ] Add generic query/command binders, validate manifest/binding names and kinds in both directions, sanitize internal errors, and register settings only. Register the extension resolver using `IsStarted()` so a failed migration never exposes a ready gateway.
- [ ] Map domain not-found, invalid input, invalid period/cursor and cancelled requests. Log unknown errors with intent and cause; return fixed INTERNAL text.
- [ ] Test explicit tenant scope against two populated tenants and malformed/null/wrong-type values. No principal field participates in resolution.
- [ ] Run `go test -race ./extension/...`, `go build ./...`, fresh-cache lint. Commit exact new files with subject `feat(nexus): register the dashboard contract after startup`.

## Task 2: Tenant reads and partial writes

**Files:** create `extension/contract/{project.go,handlers_tenants.go,handlers_tenants_test.go}`; extend `contract.go` and `manifest.yaml`. Add `tenant.ErrDuplicate` and map duplicate-slug errors in all stores if required by the tests.

**Interfaces:** `tenantRow`, `quotaView`, `tenantConfigView` are explicit camelCase DTOs. `tenantsListRequest` carries status/search/cursor/limit. `tenantUpdateRequest` has `ID string`, optional Name, nested quota and config patches, and an optional metadata map. Each nested field is optional. Cache inheritance uses a presence-aware nullable boolean so absent preserves and null resets.

- [ ] Write tests using `storetest.Each`: create two tenants, list by status/search and page with limit one, read exact budgets, reject malformed/unknown ids, and confirm operator-wide visibility despite arbitrary claims.

```go
before := tenant.Quota{RPM: 10, MaxStreamTokens: 900, MaxStreamDuration: time.Minute}
// Create through the service, dispatch an update containing only quota.rpm,
// then read from the store. The stream fields must still match before.
patch := json.RawMessage(`{"quota":{"rpm":25}}`)
_ = before
_ = patch
```

- [ ] Run `go test ./extension/contract`; expect absent tenant intents.
- [ ] Implement `tenants.list`, `tenants.get`, `tenants.create`, `tenants.update`, `tenants.setStatus`. Read spend only when usage is enabled. Refuse whitespace-only names, negative limits/budgets, overflowing duration conversion, invalid statuses and overlapping model lists.
- [ ] Preserve stored routing strategy and guard policy, and return their enforced=false descriptors. Merge dirty fields into the existing entity before calling Update. Never replace a populated quota with a zero-valued partial patch.
- [ ] Bind exact invalidates from the spec. Add `tenants.get` invalidation to create only if a real dependent read requires it; avoid unrelated invalidations.
- [ ] Verify duplicate slug gives CONFLICT on every backend, including concurrent memory inserts; correct the persistence boundary rather than relying on a racy preflight read.
- [ ] Run contract/store/tenant tests with the DB variables, root tests and fresh-cache lint. Commit the store correction separately from the tenant contract.

## Task 3: Usage, overview and gateway reads

**Files:** create `extension/contract/{handlers_usage.go,handlers_overview.go,handlers_gateway.go,handlers_usage_test.go,handlers_gateway_test.go}`; extend project/bindings/manifest. Add read-only cache kind inspection in `cache` and `nexus` if no supported accessor exists.

**Interfaces:** `usageSummaryRequest{TenantID json.RawMessage; Period string}`, `usageRecordsRequest` includes tenantId/keyId/provider/model/outcome/from/to/cursor/limit; `usageSeriesRequest` adds bucket. Responses use nullable exact cost strings and `usageEnabled`. Provider and model aggregates are arrays ordered by decimal cost, with name as tie-break.

- [ ] Seed hand-computed records under two tenants: priced `0.1` and `0.2`, unpriced, cached and refused. Add an out-of-window record. Assert identity isolation, exact `0.3`, null unknown cost, unpriced count, millisecond latency and real cursor continuation.
- [ ] Run contract tests and observe missing usage intents.
- [ ] Implement `usage.summary`, `usage.series`, `usage.records`. Validate period/bucket, time bounds, outcome, optional tenant and key IDs before store calls. Validate key ownership when both key and tenant are supplied.
- [ ] Implement `overview.get` from complete cursor traversal of tenant status counts, key Count(active), current period summaries and posture. No page length is called a total. Usage off gives null spend/counts and empty chart data with usageEnabled=false.
- [ ] Implement `models.list`, `providers.list`, `gateway.get`. Never ping providers. Read traffic for the last 15 minutes through cursor paging, with requests/errors null when usage is off. Free models have known zero pricing; absent prices remain unknown. Return configured guards and coverage caveats, never a pass verdict. No fabricated route explanation or cache size.

```go
// Exact sorting, also used for deterministic fixtures.
slices.SortFunc(rows, func(a, b aggregateRow) int {
    if n := b.cost.Cmp(a.cost); n != 0 { return n }
    return strings.Compare(a.Name, b.Name)
})
```

- [ ] Assert settings and gateway lists are deterministic and empty arrays, missing capability statistics remain null, custom cache kind is unknown rather than guessed, and provider health methods are never called.
- [ ] Run root race tests with DB variables and fresh-cache lint. Commit usage/overview and gateway/catalog changes as separate coherent commits if their gates pass independently.

## Task 4: Key lifecycle and one-time results

**Files:** create `extension/contract/{handlers_keys.go,handlers_keys_test.go}`; extend projections/bindings/manifest.

**Interfaces:** `keys.list` uses `key.Service.ListPage`; `keys.get` uses Get; `keys.revoke` calls Revoke and returns the projected key. Direct create/rotate handlers return `{key, rawKey, revokedKeyId?}`. No read type has a Hash or RawKey field.

- [ ] Write read/write tests against memory and SQLite with active, expired and revoked keys. Seed two tenants, page with limit one, filter effective status, and assert unknown/blank/wrong-type tenant filters refuse as specified.
- [ ] Run tests and observe missing key intents.
- [ ] Implement reads and revoke, including tenant names without exposing hashes. Validate all scopes and expiry strings on create; refuse an explicitly empty scope list rather than silently granting default scopes. Directly test create and rotate, checking persistence and old-key revocation with boolean assertions for sensitive values.

```go
wire, err := json.Marshal(read)
if err != nil { t.Fatal("marshal read") }
if bytes.Contains(wire, []byte(raw)) || bytes.Contains(wire, []byte(hash)) {
    t.Fatal("read exposed key material")
}
```

- [ ] Register only key reads and revoke on the interim Forge pin. Assert create/rotate are absent from capabilities and dispatcher. Document exactly why; don't return a successful stub.
- [ ] Run contract race tests, root tests and fresh-cache lint; commit with subject `feat(nexus): expose key administration without retaining secrets`.

## Task 5: Contract gate and next-slice record

**Files:** update this plan's progress and the approved spec; create `extension/contract/README.md` describing the interim secret-command gate and wire conventions.

- [ ] Test the complete registered intent set, exact invalidation lists and all read responses for secret leakage. The interim manifest has 16 intents; the final manifest must have 18 after protected secret registration.
- [ ] Run `go build ./...`, the root race suite with all three DB variables, `GOWORK=off go vet ./...` and `go test ./...` in all nested modules, and lint with a new cache directory.
- [ ] Obtain a fresh final review of this slice, fix important findings with reproducing tests, and record any deferred minor findings with their impact.
- [ ] Record verified backends and remaining gates in the spec. Slice 5 can develop against all 18 fixture intents, but production key create/rotate remain unavailable until Slice 7's protected dispatcher registration and transport tests pass.

## Self-review

The plan covers the 18 specified intents. Sixteen register before retirement;
the two secret responses have a deliberate dependency gate. Tasks 2 and 4
share explicit DTOs, Task 3 reuses scope and error mapping, and all binders
resolve the gateway lazily. The five review-focus conditions have tests in
their owning tasks. No user design choice is reopened: the later Forge patch
is required to uphold the already-approved prohibition on caching raw keys.
