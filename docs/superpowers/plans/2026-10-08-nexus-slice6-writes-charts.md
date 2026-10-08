# Nexus Slice 6: tenant writes, key dialogs and usage charts

> Use `superpowers:executing-plans` inline. Finish the Slice 5 review gate before
> editing its UI. Work on `main` in the primary checkout and preserve concurrent work.

**Goal:** You can create and edit tenant limits, manage tenant access, issue and
rotate gateway keys safely, and inspect exact spend alongside request volume.

**Spec:** `docs/superpowers/specs/2026-10-07-nexus-dashboard-migration-design.md`.
Go's `extension/contract` is the wire authority, running on Forge v1.12.3.

## Scope and constraints

Own `packages/plugin-nexus/**`, Nexus fixtures and this migration's documentation.
Patch shared dependency and baseline files by owned hunks only. Keep money as
strings for display, validation, comparison and payloads. Only chart geometry
converts cost strings to numbers. Retain shared compact controls and ZeroState.

The prescribed `dataviz` skill is absent from local skill roots, the plugin cache
and the plugin-directory search. Use the approved chart design, the existing kit
chart components and Recharts's primary documentation. Record this substitution
in the ledger. No new charting library or visual language is needed.

Tenant settings that the gateway stores but doesn't enforce must keep that
qualification in the form. A partial edit must preserve every untouched field,
including streaming quotas, cache inheritance and both metadata maps.

## Review focus

1. Dirty tenant patches preserve fields; explicit zero, false, empty lists,
   metadata replacement and cache null have distinct meanings.
2. A lost response to key creation or rotation must not issue a second command.
   Reuse the idempotency key and payload for retries, handle running/replayed
   secret commands from their typed reason, and refresh potentially changed reads.
3. Raw keys stay in component state only. Reset useCommand immediately, prohibit
   dismissal before storage acknowledgement, guard unload, and never announce a
   secret or include it in test failures, logs or persistent browser state.
4. Failed commands remain visible inside the active dialog. Pending and uncertain
   operations cannot silently disappear or be replayed as a fresh operation.
5. Spend geometry may approximate; every visible amount and tooltip stays exact.
   Charts load only through the lazy usage route, have zero baselines, and offer
   an accessible table view. A delayed filter read preserves its labelled scope.

## Task 1: tenant form model and command test harness

**Files:** create `packages/plugin-nexus/src/tenant-form.ts` and
`test/tenant-form.test.ts`; extend `src/types.ts` and `test/fixtures.ts`.
**Interfaces:** `tenantDraft(tenant?: Tenant): TenantDraft` snapshots editable values;
`tenantPayload(draft: TenantDraft, original?: Tenant): TenantCreate | TenantUpdate`
validates and builds the wire payload. `commandClient(overrides?)` returns the
recording fixture client plus command payloads/options, without retaining secrets.

Core regression:

```ts
const tenant = answer<Tenant>("tenants.get", { id: TENANT_ID })
const draft = tenantDraft(tenant)
draft.quota.rpm = { unlimited: false, value: "240" }
expect(tenantPayload(draft, tenant)).toEqual({ id: tenant.id, quota: { rpm: 240 } })
```

Run `pnpm --filter @forge-go/dashboard-plugin-nexus exec vitest run test/tenant-form.test.ts`
first expecting the absent helper to fail, then expecting all cases to pass.
All tasks finish with package `test`, `typecheck` and `lint` commands, expected exit 0.

- [ ] Add a command-capable fixture client that records payloads and options without
  logging raw results. Invalidate the same intents as the shared client.
- [ ] Write failing tests for create payloads and dirty updates: exact budget tails,
  no-limit zero, explicit false/null, empty lists, metadata replacement, unchanged
  nested values and invalid numeric input. Run them before implementing helpers.
- [ ] Add typed create/update payloads and pure validation/diff helpers. Numeric quota
  inputs must be nonnegative safe integers within Go duration bounds. Budget stays
  an unsigned decimal string. Validate metadata as string-to-string objects.
- [ ] Run package tests, typecheck and lint; commit the model and harness.

## Task 2: tenant creation, editing and status actions

**Files:** create `src/components/tenant-editor.tsx`, `src/components/metadata-fields.tsx`,
`src/components/tenant-status.tsx`, `src/pages/tenant-form.tsx`, and
`test/tenant-writes.test.tsx`; modify `src/index.tsx`, `src/pages/tenants.tsx`,
`src/pages/tenant-detail.tsx`. All paths are under `packages/plugin-nexus`.
**Interfaces:** `TenantEditor({ tenant?: Tenant })` consumes Task 1's model;
`TenantStatusActions({ tenant: Tenant })` consumes `tenants.setStatus`.
The form's saved success links to `tenantPath(result.id)`. Slug is immutable on edit.
Add the specified daily consumption meter and per-replica limiter qualification to
read detail while integrating its action row.

Core UI regression: render an editor for a seeded tenant with `commandClient`, change
only the RPM textbox to 240, submit Save changes, then assert the last command payload
is exactly `{ id, quota: { rpm: 240 } }` and the seeded stream/token/config fields survive.
Run `vitest run test/tenant-writes.test.tsx` through the package exec command before
and after implementing the form; expect missing-component failure then passing tests.

- [ ] Add `/tenants/new` and `/tenants/:id/edit`, with shared form controls and explicit
  no-limit switches. Required fields are name and slug. Edit submits only changes.
- [ ] Cover every quota and config field, including streaming limits, model allow/block
  lists, default model, routing/guard policy, cache inheritance and both metadata
  maps. Keep configuration caveats visible and avoid invented selectors.
- [ ] Preserve a populated draft across a background refetch. Reset when tenant identity
  changes. Loading, missing, denied and failed reads keep distinct recovery states.
- [ ] Add create/edit links and tenant status ConfirmDialogs. Hold the dialog open during
  pending/error, name the affected tenant and show command errors inside the dialog.
- [ ] First write tests for command payloads, invalid form errors, save failure, unchanged
  nested fields, no-op saves and status confirmation; watch red, then implement.
- [ ] Run package checks and commit the tenant flows.

## Task 3: gateway key commands and one-time reveal

**Files:** create `src/attempt.ts`, `src/components/one-time-key.tsx`,
`src/components/key-dialog.tsx`, `src/components/key-actions.tsx`, and
`test/key-writes.test.tsx`; modify `src/pages/keys.tsx`, `src/pages/key-detail.tsx`,
`src/pages/tenant-detail.tsx`, `src/components/key-list.tsx` and fixture harness tests.
**Interfaces:** `KeyDialog({ open, onOpenChange, tenantId?, rotating?: APIKey })`
uses `SecretKeyResult`; `OneTimeKey({ result, onDone })` holds display interactions.
`KeyActions({ apiKey: APIKey })` owns revoke/rotate dialog state outside read boundaries.
`useAttemptKey().keyFor(payload)` is stable for one unresolved command; `end()` clears it.

Core UI regression: submit create, reject with a transport error, retry with the same
payload and assert identical command-option idempotency keys. Resolve with a test-only
secret, assert Done is disabled until acknowledged and all aria-live text excludes it.
Use boolean assertions for secret checks so a failing test cannot print a secret.
Run `vitest run test/key-writes.test.tsx` through package exec, expecting red then green.

- [ ] Implement local command-attempt handling from the shared client's documented
  contract. Don't import another plugin's private helpers. Test retained retry IDs,
  changed payloads, running claims, unknown transport outcomes and spent tombstones.
- [ ] Add a two-step create dialog from global keys and tenant detail. Include tenant,
  name, every checked scope, distinct admin warning, and never/30/90/365/custom expiry.
  Preserve the absolute expiry for retries so an unchanged form stays one command.
- [ ] Add rotate with an immediate-revocation warning and revoke through ConfirmDialog.
  No grace-period control: Nexus revokes the previous key immediately.
- [ ] Move successful create/rotate results into local reveal state, then reset the hook.
  Keep the parent dialog mounted across invalidated key reads. Reveal offers copy,
  select-and-copy fallback, hide/show, the stored-prefix hint and acknowledgement.
  Done remains disabled until acknowledged. Escape, backdrop and close cannot dismiss
  an unacknowledged reveal; beforeunload remains guarded until Done.
- [ ] Write tests before implementing for all scopes/expiry, command errors inside the
  dialog, double submission, transport uncertainty, replay recovery, secret reset,
  copy fallback and announcements, dismissal and acknowledgement.
- [ ] Run package and fixture checks and commit key flows.

## Task 4: lazy exact-value usage charts

**Files:** create `src/charts/usage-charts.tsx`, `src/charts/geometry.ts`,
`test/charts.test.tsx`, `test/architecture.test.ts`; modify `src/pages/usage.tsx`
and the Nexus section of `BASELINE.md`.
**Interfaces:** `UsageCharts({ items: SeriesPoint[] })` is imported only by usage;
`chartGeometry(items)` preserves each original cost string alongside numeric heights.
The kit already re-exports BarChart/Bar/axes, so no direct dependency is expected.

Core regression: render the exact tooltip for `9007199254740993.000000150`, then assert
its text retains every digit. A source test rejects numeric money coercion outside
`src/charts`; an import graph test permits chart reachability only from `pages/usage`.
Run `vitest run test/charts.test.tsx test/architecture.test.ts` before implementation
and after it. Inspect actual Vite static imports in the production build as well.

- [ ] Read the existing kit chart API and primary Recharts documentation. Add two separate
  column charts, spend and requests, with a table toggle and exact spend tooltips.
  Use a single series per chart and no redundant legends or dual axis.
- [ ] Build data adapters under `src/charts/`. Guard non-finite geometry and make an
  unrenderable range visible with access to exact table values, never silent zeros.
- [ ] Write failing tests for sub-cent and huge values, exact tooltip rendering, table
  access, zero baselines, stale-scope display, float restrictions outside charts and
  static import reachability. Only the lazy usage route may import charts.
- [ ] Add direct Recharts dependency only if the kit's API requires it, using the existing
  workspace version. Update scoped lockfile entries. Build Vite and record chunk sizes
  and the entry's static dependency closure in BASELINE.md.
- [ ] Run package checks and commit charts.

## Task 5: browser write verification and review

**Files:** browser evidence under `output/playwright/nexus-slice6/`, verification
logs in this plan's `.superpowers/sdd/` workspace, updated `BASELINE.md` and spec.
**Interfaces:** fixture HTTP endpoint on a task-owned port, the shell's normal Nexus
routes, and the installed Playwright CLI. This task consumes all prior UI and commands.
Expected: every owned package and fixture check passes, every actionable browser flow
updates a subsequent read, and unrelated workspace failures are identified by file.

- [ ] Start fresh fixture state. Verify every route at desktop and narrow widths, including
  the new tenant forms, and click create/edit/status and create/rotate/revoke flows.
- [ ] Capture both key dialogs and reveals. Use fixture-only keys and avoid logging raw
  values. Check dismissal protection, acknowledgement, copy fallback and errors in
  dialogs. Verify writes refresh affected lists and detail projections.
- [ ] Exercise changed tenant/period with delayed responses, usage-off and empty charts.
  Check exact tooltip and table amounts and narrow layout. Record console failures.
- [ ] Run package test/typecheck/lint, fixture tests, Nexus HTTP checks, recursive workspace
  tests, shell and Next builds. Qualify unrelated concurrent failures explicitly.
- [ ] Obtain one fresh independent final review. Fix Critical/Important findings in one
  red-to-green pass, record deferred minors and rulings, and append the Slice 7 handoff.
  Templ retirement begins only when all browser prerequisites are met.
