# Nexus Slice 5: React reads and fixtures

> Use `superpowers:executing-plans` for implementation. Keep the Slice 4 review
> gate ahead of code that depends on it.

**Goal:** You can inspect the Nexus gateway, tenants, keys and usage through the
shared React dashboard, backed by fixtures that implement every shipped intent.
The next slice adds tenant write forms, protected key dialogs and usage charts.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`.
The Slice 4 contract in `/Users/rexraphael/Work/xraph/forgery/nexus/extension/contract`
is the wire authority. It runs on Forge v1.12.3 and registers all 18 intents.

## Scope and ownership

- Work on `main` in the two primary checkouts. No branches or worktrees.
- Own `packages/plugin-nexus/**`, `packages/fixture-server/nexus-fixtures.mjs`
  and `packages/fixture-server/nexus-fixtures.test.mjs`.
- Shared integration files receive targeted patches only: shell and example-next
  package/config/style files, fixture server import/registry/reset/inventory,
  fixture verifier and lockfile. Inspect concurrent edits immediately before
  each patch and use a temporary Git index to commit only owned hunks.
- Never stage another session's changes. Commit coherent verified work locally.
- Apply rex-voice and humanizer to repo prose. No em dashes or attribution.
- Do not add chart code in this slice. The required `dataviz` skill was not found
  in the available skill roots or plugin cache; settle the chart guidance before
  Slice 6, when charts are introduced.

## Design direction

Use the existing kit palette, fonts and density. No new theme. The gateway is
an operator tool: posture and failures above the working data, controls in one
wrapping row, and compact tables with actions next to the resource they affect.
The visual emphasis is exact spend: the reconciled cents are followed by the
unrounded sub-cent digits in quieter text. Nothing else needs a special treatment.

```
Title / scope                                      Refresh
Authentication and collection posture / alerts
Month spend | requests today | active keys | tenants
Working table or configuration sections
```

Use the shared `ZeroState` with a relevant kit icon, explanation and next action.
Distinguish failed, denied, loading, unavailable collection and empty results.
There is no registered Nexus walkthrough, so no tour control is added.

## Review focus

1. No monetary display, sum or comparison passes through a JavaScript number.
   Exact decimal helpers and fixture aggregation have edge-case tests.
2. Empty selection omits `tenantId`; malformed or explicit empty scope never
   broadens a fixture query. Tenant and key selectors page through all results.
3. Old cursor and accumulated rows reset when filters change. Late responses
   cannot mix two scopes or append duplicate records.
4. Fixtures store only key summaries, never raw keys or hashes. Writes alter
   later reads and mirror the final contract's invalidations and replay rules.
5. Every read surface has distinct loading/error/empty/populated states and a
   visible recovery action. Desktop and narrow-width checks remain required.

## Task 1: Package, wire types and exact display primitives

Create `packages/plugin-nexus/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts}`
using the established plugin package settings. Create `src/{types.ts,money.ts,badges.tsx}`,
`src/components/{money.tsx,cursor-pager.tsx,tenant-filter.tsx}` and test harness files.

- [ ] Write exact-money tests for zero, negative sign handling, large integers,
  sub-cent values and long fractional tails. Test grouping and split cents without
  `Number`, `parseFloat` or implicit numeric coercion of an amount.
- [ ] Define explicit camelCase types from the shipped DTOs. Nullable metrics stay
  nullable, arrays stay arrays and key types have no raw/hash field except the
  separate command result type reserved for Slice 6.
- [ ] Implement exact formatting with string operations. Use BigInt scale alignment
  for comparison/share math only when needed; never round a displayed amount.
- [ ] Implement the spec's status/outcome badge mappings using kit variants.
- [ ] Add local cursor controls with previous/next semantics and no invented total.
  The package does not import another plugin's components.
- [ ] Build a tenant selector that can search and load more than the first page.
  Its all-tenant choice omits the request field. Keep hooks unconditional and use
  query `enabled` for reads that need a validated route identifier.
- [ ] Verify focused tests, typecheck and lint. Commit the package foundation.

## Task 2: Stateful fixtures for the complete contract

Create `nexus-fixtures.mjs` and standalone Node tests before touching the shared server.
Export `createNexusHandlers(FixtureError)` and `resetNexus()`.

- [ ] Seed active, suspended and disabled tenants; active, expired and revoked keys;
  priced, cached, refused, blocked and unpriced usage; exact sub-cent prices; and a
  tenant consuming 85 percent of its budget. All amounts are strings.
- [ ] Implement all 12 queries with the real DTO shapes, stable ordering and cursors.
  Apply every supplied filter before paging. Validate tenant/key identities, key
  ownership, periods, buckets, outcomes and time bounds like the Go contract.
- [ ] Implement all six writes. Tenant updates merge dirty nested fields and preserve
  both metadata maps. Cache null resets inheritance. Reject duplicate slugs, negative
  limits/budgets, bad scopes and past expiry. Rotate revokes the old key immediately.
- [ ] Return a generated raw key only in create/rotate results. Persist only a display
  prefix, never the raw value or hash. Verify reads and exported fixture state cannot
  recover a generated secret. Use the shared fixture server's replay protection where
  available, and model the shipped secret conflict behavior explicitly if needed.
- [ ] Keep accounting exact through BigInt-based decimal arithmetic. Unknown costs
  remain null; free/cached/not-charged records use known zero; sum only priced values.
- [ ] Honor `FIXTURE_NEXUS_USAGE_OFF=1` and `FIXTURE_NEXUS_OPEN_GATEWAY=1` with explicit
  unavailable metrics and posture. Fixtures must not present disabled collection as
  zero traffic.
- [ ] Run Node tests covering write-then-read, all validation branches, pagination,
  scope isolation, field preservation, secret nonretention and exact aggregation.
  Commit the standalone fixture files.

## Task 3: Overview, gateway, model and settings reads

Create `src/pages/{overview.tsx,gateway.tsx,models.tsx,settings.tsx}` and their tests.

- [ ] Overview shows HTTP authentication posture, limiter kind, collection, configured
  guards/cache and compact alerts for open access, usage-off, insert errors and limiter
  errors. Counts use the server's totals and unpriced requests remain beside spend.
- [ ] Gateway shows actual stages with the terminal marked, inspection unavailability,
  routing strategy/caveats, guards, cache completion/stream kinds and untracked size,
  aliases, transforms and enforcement limits. Preserve execution order where it matters.
- [ ] Models/providers expose exact price strings, free/unpriced distinction, capabilities,
  context/output limits, and the observed 15-minute traffic window. Zero traffic differs
  from collection-off. Queries never request health pings.
- [ ] Settings show only the projected effective configuration. No bootstrap credentials
  or editable controls for an unsupported command.
- [ ] Use QueryBoundary and ZeroState with retry/next actions. Test real query calls and
  rendered domain values under populated, empty, error and usage-off fixtures.
- [ ] Run package checks and commit these read pages.

## Task 4: Tenant, key and usage reads

Create `src/pages/{tenants.tsx,tenant-detail.tsx,keys.tsx,key-detail.tsx,usage.tsx,records.tsx}`
and their tests. Usage remains lazy and has exact tables in this slice.

- [ ] Tenant list has status/search controls, stable cursor navigation, exact spend and
  budget, and clear unlimited quotas. Detail shows consumption and limits, config with
  stored-but-unenforced labels, metadata and tenant-scoped keys.
- [ ] Key list defaults to active, scopes by tenant and shows prefix, tenant name, scopes,
  effective status, expiry and last use. Detail supports expired and revoked resources.
  Preserve the difference between missing resource and denied access.
- [ ] Usage has tenant and period filters above its summary and exact series/aggregate
  tables. Outcome counts retain all five states. Keep the previous successful scope
  visible while the next loads, labelled busy; errors must not masquerade as new data.
- [ ] Request log scopes tenant/key/provider/model/outcome/time, with cursor load-more and
  no fake total. Show exact or unavailable cost, outcome reason and milliseconds. Reset
  accumulated rows and cursor when any filter changes.
- [ ] Test filter-to-request mapping, late responses, pagination, zero vs null, missing IDs,
  and every empty-state explanation. Render action controls only when their flow exists;
  Slice 6 will add creation/edit/reveal routes and commands.
- [ ] Run package checks and commit read flows.

## Task 5: Plugin and host wiring

Create `src/index.tsx` with `extension: "nexus"`, namespace/label Nexus and the spec's
Gateway, Customers and Spend nav groups. Keep usage lazy and avoid importing its module
elsewhere. Only implemented routes are declared at this stage.

- [ ] Test plugin resolution for installed, absent and unconfigured contributors, plus
  route ownership and lazy usage loading. Exercise pages through the shared host harness.
- [ ] Wire shell package/import/plugins/styles, then example-next dependency/config/style/
  transpilePackages using targeted patches. Install with pnpm without rewriting unrelated
  lockfile changes into the commit.
- [ ] Register fixtures in the shared server's import, contributor list, reset and inventory.
  Add Nexus HTTP verification without changing other contributor behavior.
- [ ] Run package tests/typecheck/lint, fixture tests and HTTP verification, shell build and
  example-next checks. Measure the eager/lazy chunks and record them in BASELINE.md with
  the current command and environment.
- [ ] Check every read route at desktop and narrow widths against the fixture host. Save
  screenshots and record loading/error/empty/usage-off results, not just navigation success.
- [ ] Obtain one independent final review, fix important findings with regression tests and
  update the spec with the Slice 6 handoff. Full migration remains open until write flows,
  chart verification, both key dialogs and separate templ retirement pass their gates.
