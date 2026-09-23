# Relay ListEndpoints agreement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ListEndpoints` behave the same on all five backends: an empty tenant lists every tenant, and `ListOpts.Enabled` filters. Leave `Resolve` exactly as literal as it is today.

**Architecture:** Each backend's `ListEndpoints` guards its tenant filter with `tenantID != ""`, matching how `ListDLQ` already works everywhere. Postgres and sqlite gain the `Enabled` filter they silently ignore. Redis gains a cross-tenant endpoint index, backfilled once from `Migrate`, because it only indexes per tenant today. A conformance suite pins all of it on real databases.

**Tech Stack:** Go, grove, go-redis, testcontainers.

**Spec:** Not covered by the dashboard spec directly. It unblocks the endpoints slice (`2026-09-23-relay-endpoints-slice.md`, the OPEN DECISION in Task 3, which Rex resolved as option 1).

**Repository:** `/Users/rexraphael/Work/xraph/forgery/relay`.

## What is wrong today

Three things, all checked against every backend:

| | postgres | sqlite | mongo | redis | memory |
|---|---|---|---|---|---|
| `ListEndpoints("")` | literal | literal | literal | literal | literal |
| `ListOpts.Enabled` | **ignored** | **ignored** | honoured | honoured | honoured |
| `ListDLQ(TenantID: "")` | all | all | all | all | all |

`ListDLQ` and `ListEndpoints` disagree about what an empty tenant means. `dashboard/data.go:fetchAllEndpoints` passes `""` and assumes the `ListDLQ` meaning, so the templ overview count, endpoints page, deliveries page and both widgets render empty. On postgres and sqlite, filtering endpoints to "disabled" returns every endpoint.

## Global Constraints

- **`Resolve` does not change.** It is the delivery hot path and must keep matching the tenant literally. An event with no tenant must never fan out to other tenants' endpoints. A conformance subtest guards this, and it must pass before and after.
- An empty tenant on `ListEndpoints` means every tenant, on every backend. A non-empty tenant still matches exactly.
- The redis backfill runs once and is idempotent. It must not SCAN the keyspace on every boot.
- Every regression test is watched failing against unfixed code before it is trusted.
- Completion for every task is `go vet ./...`, `go test ./...` over the whole repo, and `golangci-lint run ./...` checked by exit code, never through a pipe.
- No `Co-Authored-By` trailer on any commit.

## Review Focus

1. `Resolve(ctx, "", eventType)` must return no endpoint belonging to a real tenant. Covered in Task 1, and it must pass before and after.
2. Postgres positional arguments: making the tenant filter conditional must not shift `$N` numbering for any other bound argument. Task 2.
3. A redis endpoint created before the upgrade must appear in the every-tenant list. That requires the backfill, and a test that seeds without the index. Task 2.
4. Deleting an endpoint must remove it from the redis global index, or the every-tenant list returns a stale ID that then fails to load. Task 2.
5. `ListUnsigned("")` must audit every tenant once this lands, and its docs must stop saying you need one call per tenant. Task 3.

---

### Task 1: A conformance suite for ListEndpoints and Resolve

**Files:**
- Create: `store/storetest/endpoints.go`
- Modify: `store/{memory,postgres,sqlite,redis,mongo}/conformance_test.go` (add `TestEndpointConformance` beside `TestReplayConformance`)

**Interfaces:**
- Produces: `storetest.EndpointBackend` and `storetest.RunEndpointSuite(t, newStore func(t *testing.T) EndpointBackend)`.

Subtests, each scoped to unique tenants so one container serves the whole run:

1. `empty tenant lists every tenant`: create one endpoint in each of two unique tenants, `ListEndpoints(ctx, "", {Limit: 10000})`, assert **both IDs are present** (identity).
2. `a tenant lists only its own`: two tenants, list one, assert exactly its endpoint.
3. `Enabled filters`: one enabled and one disabled endpoint in a unique tenant. `Enabled: &false` returns only the disabled one, `Enabled: &true` only the enabled one.
4. `Resolve stays literal for an empty tenant` (guard): an enabled endpoint in a real tenant subscribed to `*`, `Resolve(ctx, "", "invoice.created")` returns none of the real tenant's endpoints.
5. `Resolve returns a tenant's matching enabled endpoints`: guard that the hot path is unchanged.

- [ ] **Step 1:** Write the suite and wire it into all five backends.
- [ ] **Step 2:** Run `go test -count=1 -run TestEndpointConformance ./store/... -v`. Expected RED matrix: subtest 1 fails on all five, subtest 3 fails on postgres and sqlite, subtests 2, 4 and 5 pass everywhere. **Record the actual matrix in the ledger.** If it differs from this, the plan's premise is wrong somewhere: stop and investigate before fixing anything.
- [ ] **Step 3:** Do not commit a red suite. Task 2 commits it together with the fixes.

---

### Task 2: Every backend agrees

**Files:**
- Modify: `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/endpoint.go`, `store/memory/store.go` (`ListEndpoints`)
- Modify: `store/redis/keys.go`, `store/redis/endpoint.go` (create, delete, list), `store/redis/store.go` (`Migrate`)

- [ ] **Step 1: memory.** `if tenantID != "" && ep.TenantID != tenantID { continue }`.
- [ ] **Step 2: mongo.** Build `filter := bson.M{}` and set `filter["tenant_id"]` only when non-empty.
- [ ] **Step 3: postgres and sqlite.** Guard the tenant `Where` with `if tenantID != ""`, and add `if opts.Enabled != nil { q = q.Where("enabled = ?", *opts.Enabled) }`. On postgres, number the placeholders from a counter as `ListDLQ` does (`argIdx`), so a conditional filter cannot shift another argument's position.
- [ ] **Step 4: redis.** Add `zEndpointAll = "relay:z:ep:all"` to `keys.go`. `CreateEndpoint` adds to it and `DeleteEndpoint` removes from it, in the same pipelines that maintain `zEndpointTenant`. `ListEndpoints` reads `zEndpointAll` when the tenant is empty.
- [ ] **Step 5: redis backfill.** `Migrate` checks a marker key `relay:migrated:ep_all:v1`. If it is absent, SCAN `relay:ep:*`, `ZADD` each endpoint into `zEndpointAll` scored by its `CreatedAt`, then set the marker. `ZADD` is idempotent, so a crash halfway through is safe to rerun. Add a redis-only test that writes an endpoint entity and its per-tenant index directly, with no global index entry, as a pre-upgrade row would look, runs `Migrate`, and asserts the every-tenant list includes it. Run `Migrate` twice and assert it does not duplicate anything.
- [ ] **Step 6:** Confirm `Migrate` is actually called at startup for redis. Grep for the call site. If nothing calls it, the backfill never runs, so say so in the ledger and in the README.
- [ ] **Step 7:** The full RED matrix from Task 1 is now GREEN on all five real backends. Prove the guards still bite: make memory's `Resolve` ignore the tenant and watch subtest 4 fail.
- [ ] **Step 8:** Commit the suite and the fixes together.

---

### Task 3: ListUnsigned audits every tenant

The signature fix made `ListUnsigned` require a tenant, only because `ListEndpoints("")` returned nothing. That reason is gone.

**Files:** `endpoint/service.go`, `endpoint/service_test.go`, `README.md`, `docs/content/docs/subsystems/signatures.mdx`, `docs/content/docs/subsystems/endpoints.mdx`

- [ ] **Step 1:** Replace `TestListUnsignedRefusesAnEmptyTenant` with `TestListUnsignedAuditsEveryTenant`: unsigned endpoints in two tenants, `ListUnsigned(ctx, "")` returns both by identity. Watch it fail on the current tenant guard.
- [ ] **Step 2:** Drop the guard. An empty tenant now means "every tenant", which is a real answer, not a blind one.
- [ ] **Step 3:** Flip `TestListEndpointsTreatsAnEmptyTenantLiterally` into `TestListEndpointsListsEveryTenantForAnEmptyTenant`.
- [ ] **Step 4:** Update the three docs pages. They currently tell you to audit one tenant at a time.
- [ ] **Step 5:** Commit.

---

### Task 4: Record what this fixed

- [ ] Note in the ledger that `fetchAllEndpoints`'s comment is now true, so the templ overview, endpoints page, deliveries page and widgets start rendering until templ is retired. Record it in `relay/MIGRATION.md` when that file exists.
- [ ] Update the endpoints-slice plan: the OPEN DECISION is resolved as option 1, the fixture returns every endpoint for an empty tenant, and the Task 9 checklist expects all three seeded endpoints.
