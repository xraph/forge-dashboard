# Keysmith Rotations, Usage, Overview and Settings (slice 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The keysmith dashboard gains its read-only pages: Overview, Rotations, Usage (with the stacked status chart) and Settings, plus rotation history, a small usage chart and a real Warden link on the key page.

**Architecture:** Five new contract queries in keysmith (`rotations.list`, `usage.series`, `usage.records`, `overview`, `settings`), each tenant-scoped and projected into its own camelCase wire type. The fixture models them over a seeded usage history. `plugin-keysmith` adds four pages and three key-page sections using kit components and the kit's Recharts `chart.tsx`.

**Tech Stack:** Go 1.25 (keysmith, forge v1.10.0 dashboard contract, four grove stores), Node ESM fixture, React 19 + Base UI 1.7 via `@forge-go/dashboard-kit` (Recharts through `components/chart`), vitest 5, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-09-30-keysmith-dashboard-migration-design.md` ("The contract" queries table, "Pages", "Badges", "The usage chart", "Libraries", "Fixture"). Prior plans: `2026-09-30-keysmith-domain-fixes.md`, `2026-09-30-keysmith-contract-spine.md`, `2026-10-01-keysmith-key-write-path.md`, `2026-10-04-keysmith-policies-and-scopes.md`.

## Global Constraints

- Repos, both on `main`, no worktrees: Go `/Users/rexraphael/Work/xraph/forgery/keysmith` (leave `_project_files/` and `dashboard/` alone); React and fixture `/Users/rexraphael/Work/xraph/forge-dashboard`.
- In forge-dashboard edit only `packages/plugin-keysmith/**` and `packages/fixture-server/keysmith-fixtures.mjs`. `verify.mjs`, `server.mjs`, `pnpm-lock.yaml` and `apps/shell/src/styles.css` carry other sessions' work: never commit them (Task 5 leaves its `verify.mjs` lines in the working tree for the controller).
- Git: `git add <exact new files>`, `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, a bare directory, `--amend`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean`, `git push`. Undo a mutation by backing up and restoring the single file.
- Commit messages: no `Co-Authored-By` trailer, no Claude or Anthropic attribution, no em or en dashes; plain prose, "we" not "I", "you" where natural.
- Wire JSON is camelCase; timestamps RFC3339 UTC; durations whole seconds; zero durations and counts that mean "unset" go out as `null`; lists are `[]`, never `null`.
- Every query resolves the tenant with `tenantFrom` and filters by it; nothing answers another tenant's rows. Error codes are BAD_REQUEST, UNAUTHENTICATED, PERMISSION_DENIED, NOT_FOUND, CONFLICT, INTERNAL; INTERNAL never echoes engine or store text.
- No query response carries `rawKey`, `raw_key`, `keyHash` or `key_hash`; extend `TestNoQueryResponseCarriesASecret` to every new response.
- Usage buckets are UTC and every bucket in the requested range is present, including empty ones. Percentiles are never shown (the engine leaves them nil).
- Chart colours (spec, dataviz-validated): successful requests neutral `#71717b`, 4xx serious `#ec835a`, 5xx critical `#d03b3b`; stacked columns; a labelled legend, a tooltip per column and a table view of the same buckets.
- Rotation reason badges: `compromise` destructive, `policy` secondary, `manual` and `scheduled` outline.
- Nav group "API keys", label "Keysmith", order: Overview (-1), Keys (0), Policies (1), Scopes (2), Rotations (3), Usage (4), Settings (5). Routes have no `/dashboard` prefix.
- React: kit components only; identifiers in `font-mono text-xs`; every dialog outside its page's `QueryBoundary` (none are expected in this slice); failure tests make the client THROW a `ContractError`.
- Go lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. Four-backend tests: `make test-backends` (known sqlite SQLITE_BUSY flake in `TestTwoRotationsInOneWindowKeepBothPreviousKeys`: rerun and note).
- React checks: `pnpm --filter @forge-go/dashboard-plugin-keysmith test|typecheck|lint`, no warnings.

## Review Focus

1. A tenant with no recorded usage: the overview's 24h count reads "not recorded", not 0, and the Usage page shows the `RecordUsage` empty state rather than a flat chart of zeros. Pinned in Tasks 3, 5, 7 and 8.
2. A usage range whose start or end falls mid-bucket, and a monthly range across a year boundary: every bucket present exactly once, in order, UTC. Pinned in Task 2.
3. A request for a range that would produce thousands of buckets (or an inverted range): refused with a plain BAD_REQUEST, never a giant response. Pinned in Task 2.
4. Rotation records written before hints existed (`oldHint`/`newHint` empty) and records whose key no longer exists: the row still renders, with an honest placeholder. Pinned in Tasks 1 and 6.
5. A store that is down: settings says the store did not answer, without echoing the driver error. Pinned in Task 4.

---

## Phase A: contract (keysmith `extension/contract`)

### Task 1: `rotations.list`

**Files:**
- Create: `handlers_rotations.go`, `handlers_rotations_test.go`
- Modify: `project.go`, `manifest.yaml`, `contract.go`, `handlers_keys_test.go` (secret scan)

**Interfaces:**
- Produces:

```go
type rotationsListRequest struct {
	KeyID  string `json:"keyId"`
	Reason string `json:"reason"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}
// RotationItem is one rotation as the Rotations page and the key page's
// history show it. Masked forms are built on the client from prefix,
// environment and the hints.
type RotationItem struct {
	ID           string  `json:"id"`
	KeyID        string  `json:"keyId"`
	KeyName      *string `json:"keyName"`      // null when the key no longer exists in this tenant
	Prefix       *string `json:"prefix"`       // null with keyName
	Environment  *string `json:"environment"`  // null with keyName
	OldHint      string  `json:"oldHint"`      // "" on records written before hints existed
	NewHint      string  `json:"newHint"`
	Reason       string  `json:"reason"`
	GraceSeconds int64   `json:"graceSeconds"` // 0 is a real zero-grace rotation, not unset
	GraceEnds    string  `json:"graceEnds"`
	WindowOpen   bool    `json:"windowOpen"`   // GraceEnds after now
	RotatedBy    string  `json:"rotatedBy,omitempty"`
	RotatedAt    string  `json:"rotatedAt"`    // record CreatedAt
}
type rotationsListResponse struct {
	Items   []RotationItem `json:"items"`
	HasMore bool           `json:"hasMore"`
}
func projectRotationItem(r *rotation.Record, k *key.Key, now time.Time) RotationItem // k may be nil
```

Behaviour: `tenantFrom`; `keyId` optional (trimmed; malformed → BAD_REQUEST `keyId is not a key id`; a key of another tenant or missing answers an empty list, not NOT_FOUND, because this is a filter); `reason` optional, one of `manual`, `compromise`, `policy`, `scheduled` (else BAD_REQUEST `reason must be one of manual, compromise, policy, scheduled`); limit default 25, cap 100, offset ≥ 0; `ListRotations(TenantID: tenant, KeyID, Reason, Limit: limit+1, Offset)`; newest first (store order: `created_at DESC`); keys loaded once per distinct key ID on the page through `deps.Engine.GetKey`, used only when `k.TenantID == tenant`.

- [ ] **Step 1: Write the failing tests:** tenant scoping by ID (t2 rotations never appear); keyId filter (own key; a foreign key ID answers `[]`; malformed answers BAD_REQUEST); reason filter and its refusal; hasMore via limit+1; limit default and cap; a record with empty hints projects `oldHint: ""`; a record whose key was deleted from the store (write the record straight to `Rotations().Create`) projects `keyName: null, prefix: null, environment: null`; `windowOpen` true for `graceEnds` in the future and false for past and zero-grace; `graceSeconds` exact; no user → UNAUTHENTICATED, no tenant → PERMISSION_DENIED. Add `rotations.list` to `TestNoQueryResponseCarriesASecret`.
- [ ] **Step 2: Run** `go test ./extension/contract/ -run Rotations` — Expected: FAIL (undefined handler).
- [ ] **Step 3: Implement**; manifest: `- { name: rotations.list, kind: query, version: 1, capability: read }` and a `rotationsList` query block (`staleTime: 30s`); bind in `contract.go`.
- [ ] **Step 4: Run** `go test ./...`, lint, `make test-backends` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): list rotations with their windows and keys`.

### Task 2: `usage.series` and `usage.records`

**Files:**
- Create: `handlers_usage.go`, `handlers_usage_test.go`
- Modify: `manifest.yaml`, `contract.go`, `handlers_keys_test.go` (secret scan)

**Interfaces:**
- Produces:

```go
type usageSeriesRequest struct {
	KeyID  string `json:"keyId"`
	Period string `json:"period"` // hourly | daily | monthly
	After  string `json:"after"`  // RFC3339, inclusive
	Before string `json:"before"` // RFC3339, exclusive
}
type UsageBucket struct {
	Start        string `json:"start"`        // RFC3339 UTC bucket start
	Requests     int64  `json:"requests"`
	ClientErrors int64  `json:"clientErrors"` // 400-499 = ErrorCount - ServerErrorCount
	ServerErrors int64  `json:"serverErrors"` // 500+
	Succeeded    int64  `json:"succeeded"`    // Requests - ErrorCount
	AvgLatencyMs *int64 `json:"avgLatencyMs"` // null when Requests is 0
}
type usageSeriesResponse struct {
	Period   string        `json:"period"`
	Buckets  []UsageBucket `json:"buckets"`  // every bucket in [truncate(after), before), ascending
	Recorded bool          `json:"recorded"` // false when the tenant has no usage rows at all (any time, any key)
}
type usageRecordsRequest struct {
	KeyID  string `json:"keyId"`
	After  string `json:"after"`
	Before string `json:"before"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}
type UsageRecordItem struct {
	ID         string `json:"id"`
	KeyID      string `json:"keyId"`
	Method     string `json:"method"`
	Endpoint   string `json:"endpoint"`
	StatusCode int    `json:"statusCode"`
	LatencyMs  int64  `json:"latencyMs"`
	IPAddress  string `json:"ipAddress,omitempty"`
	At         string `json:"at"`
}
type usageRecordsResponse struct {
	Items []UsageRecordItem `json:"items"`
	Total int64             `json:"total"`
}
const maxUsageBuckets = 400
```

Validation for `usage.series`, BAD_REQUEST, in order: `period must be one of hourly, daily, monthly`; `after is required` / `after is not an RFC3339 time`; same for `before`; `before must be after after`; more than 400 buckets → `this range has more than 400 hourly buckets; choose a longer period or a shorter range` (word the period); `keyId is not a key id`. A keyId of another tenant answers empty buckets (all zero) and `recorded` as for the tenant, not NOT_FOUND. Filling: walk from `usage.Truncate(after, period)` stepping by one period (hour, UTC day, UTC calendar month via `AddDate(0,1,0)`) while `< before`; merge `AggregateUsage(TenantID, KeyID, After: truncated after, Before: before, Period)` by `PeriodStart`. `recorded` = `usage Count(TenantID: tenant) > 0` (through `deps.Engine.Store().Usages().Count`).

`usage.records`: same time and key validation (both times optional here; when given, `before` must be after `after`); limit default 25, cap 100; `QueryUsage(TenantID, KeyID, After, Before, Limit, Offset)` newest first; `total` from `Count` with the same filter.

- [ ] **Step 1: Write the failing tests** (seed with `Engine.RecordUsage`, which stamps `CreatedAt` now, or write rows straight to `Usages().Record` with chosen `CreatedAt`): every hourly bucket present across a 24h range starting mid-hour (25 buckets when after is mid-hour), daily across a month end, monthly across a year boundary (Nov to Feb gives 4); counts split into succeeded / 4xx / 5xx correctly (status 200, 404, 503); `avgLatencyMs` null on empty buckets and rounded down otherwise; a t2 row never counted; keyId narrows; `recorded:false` for a tenant with no rows and `true` when rows exist only outside the range; every validation message and its order; 401 buckets refused; records paging and `total`; no secret fields.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; manifest: `usage.series` and `usage.records` as read queries with `usageSeries` / `usageRecords` blocks (`staleTime: 30s`); bind.
- [ ] **Step 4: Run** `go test ./...`, lint, `make test-backends` — Expected: PASS (all four backends aggregate in UTC since slice 1).
- [ ] **Step 5: Commit** `feat(contract): answer usage as complete UTC buckets and as records`.

### Task 3: `overview`

**Files:**
- Create: `handlers_overview.go`, `handlers_overview_test.go`
- Modify: `manifest.yaml`, `contract.go`, `handlers_keys_test.go` (secret scan)

**Interfaces:**
- Consumes: `KeySummary`/`projectKey`, `RotationItem`/`projectRotationItem`, `enforcedPolicyFieldCount` (Task 4 defines it; Task 3 lands first, so define it here in `enforcement.go` and Task 4 reuses it).
- Produces:

```go
type overviewResponse struct {
	Counts              overviewCounts `json:"counts"`
	OpenGraceWindows    int            `json:"openGraceWindows"`
	ExpiringWithin7Days int            `json:"expiringWithin7Days"`
	RequestsLast24h     *int64         `json:"requestsLast24h"` // null when the tenant has no usage rows at all
	RecentKeys          []KeySummary   `json:"recentKeys"`      // 5 newest
	RecentRotations     []RotationItem `json:"recentRotations"` // 5 newest
	EnforcedFields      int            `json:"enforcedFields"`  // policy fields this deployment enforces
	PolicyFields        int            `json:"policyFields"`    // 13
}
type overviewCounts struct {
	Active    int64 `json:"active"`    // stored active, including ones past expiry not yet marked
	Suspended int64 `json:"suspended"`
	Revoked   int64 `json:"revoked"`
	Expired   int64 `json:"expired"`   // stored expired
}
// enforcement.go
type EnforcementRow struct {
	Field    string `json:"field"`    // wire name, e.g. "maxKeyLifetimeSeconds"
	Label    string `json:"label"`    // e.g. "Max key lifetime"
	Group    string `json:"group"`    // "keysmith" | "rateLimiter" | "application"
	Enforced bool   `json:"enforced"`
	When     string `json:"when"`     // e.g. "when a key is created"; "" for application fields
}
func enforcementTable(rateLimiter bool) []EnforcementRow // 13 rows in the editor's order
func enforcedPolicyFieldCount(rateLimiter bool) int      // 3, or 5 with a rate limiter
```

Behaviour: counts via `Keys().Count(TenantID, State)` per state; `expiringWithin7Days` via `Keys().ListExpired(now+7d)` filtered by tenant (spec: the one post-filter, safe because the list is unpaged), counting only keys whose `ExpiresAt` is after now (already-expired-but-unmarked keys are not "expiring"); `openGraceWindows` via `Rotations().ListPendingGrace(now)` filtered by tenant; `requestsLast24h` null when `Usages().Count(TenantID)` is 0, else `Count(TenantID, After: now-24h)`; recent keys `ListKeys(TenantID, Limit 5)` projected with their scopes as `keys.list` does; recent rotations `ListRotations(TenantID, Limit 5)` through `projectRotationItem` with key lookups.

- [ ] **Step 1: Write the failing tests:** counts per state with a t2 key ignored; a key expiring in 3 days counts, one in 8 days does not, one already past expiry does not; an open window in t1 counts and one in t2 does not; `requestsLast24h` null with no rows, `0` with only older rows, exact with recent rows; recent lists newest first, at most 5, t1 only; `enforcedFields` 3 without a limiter and 5 with one (`keysmith.WithRateLimiter`); `enforcementTable` has 13 rows in the editor's order with the groups the spec gives; no secret fields.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; manifest `overview` read query (`staleTime: 30s`); bind.
- [ ] **Step 4: Run** tests, lint, `make test-backends` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): summarise keys, windows and usage for the overview`.

### Task 4: `settings`

**Files:**
- Create: `handlers_settings.go`, `handlers_settings_test.go`
- Modify: `tenant.go` (add `tenantSourceOf`), `manifest.yaml`, `contract.go`, `handlers_keys_test.go`

**Interfaces:**
- Consumes: `enforcementTable`, `enforcedPolicyFieldCount` (Task 3).
- Produces:

```go
type settingsResponse struct {
	Plugins               []string         `json:"plugins"`               // Deps.Plugins sorted, [] when none
	StoreHealthy          bool             `json:"storeHealthy"`
	StoreMessage          string           `json:"storeMessage"`          // "The store answered." / "The store did not answer. The error is in the server log."
	RateLimiterConfigured bool             `json:"rateLimiterConfigured"`
	TenantSource          string           `json:"tenantSource"`          // "claim" | "config"
	Tenant                string           `json:"tenant"`
	Enforcement           []EnforcementRow `json:"enforcement"`
	EnforcedFields        int              `json:"enforcedFields"`
	DefaultGraceSeconds   int64            `json:"defaultGraceSeconds"`   // 86400
}
func tenantSourceOf(p dashcontract.Principal, deps Deps) string // "claim" when tenantFrom would use the claim, else "config"
```

Behaviour: `tenantFrom` first (refusals as everywhere); `Engine.Health(ctx)` with a 2 second timeout; on error log through `deps.Logger` with `intent=settings` and answer `storeHealthy:false` with the fixed message (never the error text); `defaultGraceSeconds` is 86400 (the engine's fallback, `engine.go` `graceTTL := 24 * time.Hour`; add a comment pointing there).

- [ ] **Step 1: Write the failing tests:** plugins sorted and `[]` when nil; health ok; a store wrapper whose `Ping` fails answers `storeHealthy:false` with the fixed message, the error text appears only in the captured log; limiter both ways; tenant source "config" with no claim and "claim" with a `tenant_id` claim; the enforcement table matches Task 3's; refusals.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; manifest `settings` read query (`staleTime: 60s`); bind.
- [ ] **Step 4: Run** tests, lint, `make test-backends` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): report plugins, store health and what is enforced`.

## Phase B: fixture

### Task 5: The fixture models the five queries over a seeded usage history

**Files:**
- Modify: `packages/fixture-server/keysmith-fixtures.mjs`
- Leave uncommitted: `packages/fixture-server/verify.mjs` INPUT lines

Behaviour: copy Go exactly (the Task 1-4 reports list every message and shape). Seed: usage rows for acme over the last 30 days generated deterministically (a fixed pseudo-random sequence, not `Math.random`), relative to fixture start, for the Billing service and Reporting export keys: mostly 200s, some 404s and a handful of 503s, a quiet day with no rows, a busy hour; globex gets no usage rows (so `FIXTURE_KEYSMITH_TENANT=globex` shows "not recorded"). `settings` reads `FIXTURE_KEYSMITH_RATE_LIMITER` like `policies.list`, plugins from `FIXTURE_KEYSMITH_PLUGINS` (comma-separated, default `audit-hook`), and `FIXTURE_KEYSMITH_STORE_DOWN=1` answers `storeHealthy:false`. Tenant source is always "config" (the fixture has no principal).

- [ ] Steps: scratchpad probe first (every validation message, bucket fill across mid-hour/month/year boundaries, 401-bucket refusal, `recorded`, overview numbers, settings both limiter states), red then green; INPUT lines for the five queries in `verify.mjs` (Edit tool, working tree only); verify against a throwaway fixture on a free port, 0 failures; commit only the fixture file: `feat(fixture): model rotations, usage, overview and settings`.

## Phase C: React (`packages/plugin-keysmith`)

### Task 6: Rotations page and reason badges

**Files:**
- Create: `src/pages/rotations.tsx`, `test/rotations.test.tsx`
- Modify: `src/types.ts`, `src/format.ts`, `src/badges.tsx`, `src/index.tsx`, `test/badges.test.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Produces: TS `RotationItem`, `RotationsList`, `RotationReason` (exists; add `scheduled`); `RotationReasonBadge({ reason })`; `rotationMasked(item, which: "old" | "new"): string` (`sk_live_…a3f8`, or `…a3f8` when prefix is null, or "(no hint)" when the hint is empty).

Behaviour: route `/rotations`, nav "Rotations" (priority 3, `RefreshCwIcon`). PageHeader "Rotations", description "Every rotation across keys, newest first." FilterBar: reason (All, Manual, Compromise, Policy, Scheduled). ResourceTable over `rotations.list` `{reason?, limit: 25, offset}` with paging driven by `hasMore` (Next disabled when false, Previous when offset 0): When (Timestamp), Key (PluginLink to `keyPath(keyId)` showing the key name; masked new key in mono beneath; a missing key shows the id in mono and "Key no longer exists"), Reason (badge), Grace ("1 day", or "None" for 0), Window ("Open until <Timestamp>" or "Closed"), Rotated by (mono, NoneCell). Empty: "No rotations yet." / filtered: "No rotations match this reason."

- [ ] Steps: tests first (rows, badges per reason, open/closed window, missing key row, empty hints, reason filter params, paging via hasMore, failure via throwing client, nav and route in plugin.test); run (FAIL); implement; run (PASS); commit `feat(plugin-keysmith): list rotations with reasons and windows`.

### Task 7: Usage page with the status chart

Before writing the chart, invoke the `dataviz` skill (Skill tool) and apply it within the spec's settled choices (colours, stacked columns, legend, tooltip, table view, every bucket present).

**Files:**
- Create: `src/pages/usage.tsx`, `src/components/usage-chart.tsx`, `test/usage.test.tsx`, `test/usage-chart.test.tsx`
- Modify: `src/types.ts`, `src/format.ts`, `src/index.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Produces: TS `UsageBucket`, `UsageSeries`, `UsageRecordItem`, `UsageRecords`; `USAGE_RANGES` = `[{ id: "24h", label: "24 hours", period: "hourly", hours: 24 }, { id: "7d", label: "7 days", period: "daily", days: 7 }, { id: "30d", label: "30 days", period: "daily", days: 30 }, { id: "12m", label: "12 months", period: "monthly", months: 12 }]`; `rangeBounds(id, now): { after: string; before: string; period }` (UTC; `before` is the start of the next bucket after now so the current bucket is included); `UsageChart({ buckets, period, compact? })`.

Behaviour: route `/usage`, nav "Usage" (priority 4, `ChartColumnIcon`). Controls: range (the four), key filter (NativeSelect over `keys.list` limit 100: "All keys" plus each key's name), both reflected in component state (not the URL; the URL carries no key material either way). `usage.series` drives the chart and a "Table" toggle that shows the same buckets as a table (Bucket start, Succeeded, 4xx, 5xx, Requests, Avg latency). When `recorded` is false: EmptyState "No usage recorded yet." with "Usage appears once your application calls RecordUsage." and no chart. When recorded but the range is empty: the chart of zeros with a line "No requests in this range." `usage.records` below: ResourceTable (Time, Key (mono id link), Method, Endpoint (mono), Status, Latency "12 ms", IP (mono)) with total-driven paging, limit 25. `UsageChart`: kit `ChartContainer` with stacked `Bar`s succeeded/4xx/5xx in the three colours, `ChartLegend`, `ChartTooltip`, x-axis labels formatted per period in UTC ("14:00", "3 Oct", "Oct 2026"), `compact` hides axes and legend for the key page. Check the bundle: run `pnpm --filter @forge-go/dashboard-shell build` and confirm Recharts already sits in the eager chunk (search the build output); record the finding in your report and do not add a lazy route unless it does not.

- [ ] Steps: tests first (rangeBounds for each range including the month and year edges, the RecordUsage empty state, zeros line, table view equals buckets, series params per range and key, records paging, chart renders three series with the right colours and a legend — assert on the config passed to ChartContainer rather than SVG pixels, failure via throwing client, nav and route); run (FAIL); implement; run (PASS); commit `feat(plugin-keysmith): show usage as a stacked status chart, a table and records`.

### Task 8: Overview page

**Files:**
- Create: `src/pages/overview.tsx`, `test/overview.test.tsx`
- Modify: `src/types.ts`, `src/index.tsx`, `test/plugin.test.tsx`

Behaviour: route `/overview`, nav "Overview" (priority -1, `HouseIcon`); the plugin's default landing stays as the host decides. StatGrid: Active keys, Open grace windows, Expiring within 7 days (destructive emphasis when above 0), Requests in the last 24h ("Not recorded" when null, with a hint "Usage appears once your application calls RecordUsage."). Below: Recent keys (name link, masked key mono, state badge, created Timestamp), Recent rotations (key link, reason badge, window open/closed, when), each with a "View all" PluginLink; a line "This deployment enforces N of 13 policy fields." linking to `/settings`. Empty states: "No keys yet." / "No rotations yet."

- [ ] Steps: tests first (each stat, the null 24h case, destructive emphasis rule, recent lists and links, enforcement line and link, failure via throwing client, nav); run (FAIL); implement; run (PASS); commit `feat(plugin-keysmith): open on an overview of keys, windows and usage`.

### Task 9: Settings page

**Files:**
- Create: `src/pages/settings.tsx`, `test/settings.test.tsx`
- Modify: `src/types.ts`, `src/index.tsx`, `test/plugin.test.tsx`

Behaviour: route `/settings`, nav "Settings" (priority 5, `SlidersHorizontalIcon`), read-only. Sections: Store ("Healthy" / "Not answering" with `storeMessage`), Rate limiter ("Configured" / "Not configured" and what that means for the two rate-limit fields), Tenant ("Resolved from the request's tenant claim" / "Resolved from extensions.keysmith.dashboard.tenant_id" with the tenant in mono), Default grace ("24 hours" via `formatDuration`), Plugins (TagList mono, or "No hook plugins registered."), and the enforcement table (Field label, Group heading, Enforced yes/no, When) grouped exactly like the policy editor's three groups.

- [ ] Steps: tests first (each section both ways, the enforcement table rows and grouping, plugins empty and full, failure via throwing client, nav); run (FAIL); implement; run (PASS); commit `feat(plugin-keysmith): show what this deployment enforces`.

### Task 10: Key page: rotation history, a small usage chart, and the Warden link

**Files:**
- Modify: `src/pages/key-detail.tsx`, `test/key-detail.test.tsx`

Behaviour:
- Rotation history section: `rotations.list` `{ keyId, limit: 10 }` as a compact list (when, reason badge, old → new masked, window open/closed), "View all" to `/rotations` (filtering by key on that page is not required). Empty: "This key has not been rotated."
- Usage section: `usage.series` for the last 7 days daily with `keyId`, `UsageChart` `compact`, a PluginLink "Open usage" to `/usage`. When `recorded` is false: "Usage appears once your application calls RecordUsage."
- Warden: read `settings`; when `plugins` includes `warden-hook`, render the subject as a PluginLink to `/@warden/subjects/api_key/<id>` (absolute plugin path, so `useNavigateTo` does not prefix it); otherwise keep today's text. While settings loads or fails, keep the text.
- These sections sit inside the existing page body; they open no dialogs.

- [ ] Steps: tests first (history rows and empty, usage section both states, Warden link only with warden-hook, text otherwise and while loading or failing); run (FAIL); implement; run (PASS); commit `feat(plugin-keysmith): show a key's rotations, usage and Warden subject`.

### Task 11: Verify in the browser (controller)

Start the fixture (default; then `FIXTURE_KEYSMITH_TENANT=globex` for the not-recorded states; then `FIXTURE_KEYSMITH_PLUGINS=audit-hook,warden-hook` and `FIXTURE_KEYSMITH_STORE_DOWN=1` for settings and the Warden link) and the shell. Click every new page, every range, the key filter, the table toggle, the reason filter and paging; check the chart's legend, tooltip and colours in light and dark mode; check the key page's new sections. Commit the `verify.mjs` lines via a temporary index, then run the whole-branch review across both repos.
