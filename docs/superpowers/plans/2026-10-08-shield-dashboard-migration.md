# Shield Dashboard Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Shield administration and stored-record review into the React
dashboard, with scoped persistence, truthful capability reporting and real Go
demo verification.

**Architecture:** A new Shield application service validates authorized scope
and domain writes over PostgreSQL, SQLite and MongoDB stores. A Go contract
contributor exposes that service to a React plugin. The existing demo hosts the
real extension with file-backed SQLite; synthetic fixture results are not the
acceptance backend.

**Tech Stack:** Go 1.26.0, Forge dashboard contracts, Grove stores, React 19,
TypeScript 6, pnpm 10.21.0, Vitest and the shared dashboard kit.

**Spec:** `../specs/2026-10-08-shield-dashboard-migration-design.md`.

## Global constraints

- Work directly on `main` in the primary checkouts. No branches or worktrees.
- Commit each coherent verified change with exact paths. Preserve concurrent
  edits, and do not push or merge to a remote.
- The contributor, React plugin extension and namespace all use `shield`.
- Default limit is 25, maximum is 100; negative offsets and invalid enums fail.
- Name and scope are immutable for configuration rows in this migration.
- Use existing snake_case domain JSON names and TypeIDs in detail routes.
- Empty results use shared `ZeroState`. No walkthrough affordance without a
  registered walkthrough.
- No scan runner, report generator or runtime settings Save button over absent
  services. Show the evaluation limitation in the UI.
- Do not return PII ciphertext, plaintext or decrypted values.
- Read all of `packages/plugin/PLAYBOOK.md` before implementation.
- Keep Ctrlplane's concurrent changes. It owns its plugin and backend work;
  reconcile shared demo, shell and dependency edits before committing them.

## Review focus

1. A forged foreign TypeID must not permit detail reads or mutations. Tasks 2
   and 3 test database predicates and the HTTP authorization path.
2. Missing or malformed scope claims must not broaden reads. Task 3 tests
   absent, empty, nil, wrong-type and conflicting claims separately.
3. Empty arrays, omitted updates, disabled rows and nested configuration must
   survive store round trips. Tasks 2, 4 and 5 test populated values.
4. Store errors and unfinished evaluation must never become healthy zeroes or
   successful safety checks. Tasks 1, 3 and 6 pin these states.
5. Duplicate commands, stale dialogs and restart must preserve one intended
   write with visible failures. Tasks 4, 5 and 7 cover the handshake, UI and
   persistent demo lifecycle.

## Repository paths and file responsibilities

`S` below means `/Users/rexraphael/Work/xraph/forgery/shield`.
`D` means `/Users/rexraphael/Work/xraph/forge-dashboard`.
All paths in task lists are relative to the named checkout.

| Unit | Files | Responsibility |
| --- | --- | --- |
| Shield application service | `S/admin/service.go`, `scope.go`, `errors.go`, `capabilities.go`, `primitives.go`, `profiles.go`, `policies.go`, `privacy.go`, `records.go` | Scope enforcement, validation, references, safe DTO projections and domain writes |
| Store contracts | Existing domain `Store` interfaces; `S/store/dashboard.go`, `store/storetest/dashboard.go` | Scoped reads/mutations, counts, reference usage, policy assignment reads and bounded retention |
| Backend implementations | `S/store/postgres/dashboard.go`, `store/sqlite/dashboard.go`, `store/mongo/dashboard.go` and relevant existing model/migration files | Identical filtered persistence semantics |
| Contract contributor | `S/extension/contract/{contract.go,manifest.yaml,scope.go,errors.go,wire.go,handlers_*.go}` | Registry, transport DTOs, principal resolution, query/command bindings and invalidations |
| Extension lifecycle | `S/extension/extension.go`, `config.go`, `options.go`, `S/engine/engine.go` | Effective config, migration, health, dependency injection and capability reporting |
| React plugin | `D/packages/plugin-shield/src/{index.tsx,types.ts,format.ts,badges.tsx,components/,pages/}` | Scoped routes, compact lists, editors, record review and errors |
| Fast fixture | `D/packages/fixture-server/shield-fixtures.mjs` and additive server registration | Mutable contract-shaped development data, clearly distinct from live acceptance |
| Real demo | `D/demo/{shield.go,shield_test.go,main.go,go.mod,go.sum,README.md}` | Persistent real extension, authorized development identities and labelled seed records |
| Evidence and retirement | `S/MIGRATION.md`, `D/docs/reviews/2026-10-08-shield-dashboard.md` | Legacy inventory, implementation/test/live status and deletion gate |

## Task 1: Record the legacy inventory and pin engine/lifecycle behavior

**Files:** Create `S/MIGRATION.md`, `S/engine/engine_test.go`,
`S/engine/capabilities.go`, `S/extension/lifecycle_test.go`. Modify
`S/extension/extension.go` and engine configuration access as needed.

**Interfaces:** Consume `engine.New`, `ScanInput`, `ScanOutput`, `Store` and
`shield.Config`. Produce an effective configuration read and a capability
snapshot that explicitly reports all six evaluation layers unavailable.
Do not add detector execution in this task.

- [ ] Inventory all 37 route cases, 29 substantive page templates, four widgets,
  settings panel and contributed interfaces. Record every column, badge,
  filter, form field and mutation from the original source before deletion.
- [ ] Add a characterization test for current scan behavior. The assertion is
  a recorded limitation, not a desired long-term safety guarantee:

  ```go
  func TestCurrentScanHasNoEvaluationFindings(t *testing.T) {
      eng, err := New()
      if err != nil { t.Fatal(err) }
      got, err := eng.ScanInput(context.Background(), &scan.Input{Text: "example"})
      if err != nil { t.Fatal(err) }
      if got.Decision != scan.DecisionAllow || len(got.Findings) != 0 {
          t.Fatalf("current scan behavior changed: %#v", got)
      }
  }
  ```
- [ ] Run `GOWORK=off go test ./engine` and record the current behavior. Add
  tests for effective config, unavailable evaluation, no store and failed
  store ping; ensure the new capability/lifecycle assertions fail first.
- [ ] Pass loaded settings into the engine, expose their effective values,
  honor `DisableMigrate` in Start, and delegate Health to engine/store health.
  Specify resource ownership: the extension must not close an injected shared
  Grove database. Keep configuration Save unavailable.
- [ ] Check caller-visible persistence failure behavior before introducing any
  future scan command. Keep that command absent from this migration.
- [ ] Run `GOWORK=off go test ./engine ./extension`. Commit only this task's
  files, leaving the pre-existing dependency upgrade out unless reconciled.

## Task 2: Add scoped store operations and conformance tests

**Files:** Create `S/store/dashboard.go`, `S/store/storetest/dashboard.go`,
`S/store/{postgres,sqlite,mongo}/dashboard.go` and each backend's
`dashboard_test.go`. Modify domain filters/interfaces and backend models or
migrations only where these operations require it.

**Interfaces:** Produce `store.Scope{TenantID, AppID string}`, scoped CRUD for
the eight editable collections, filtered Count methods, scoped scan/report
detail reads, metadata-only PII reads, policy assignment listing, and reference
usage. Every new mutation includes scope in its database predicate.

- [ ] Define the shared scope and paging types, with documentation that neither
  scope dimension may be empty on a dashboard operation:

  ```go
  type Scope struct { TenantID, AppID string }
  type Page struct { Limit, Offset int }
  type Counts struct {
      Instincts, Awareness, Boundaries, Values int64
      Judgments, Reflexes, Profiles, Policies int64
  }
  ```
- [ ] Write SQLite cases with two apps and two tenants, including colliding
  names, foreign TypeIDs, empty filters, and identical timestamps. Assert row
  identities, unchanged foreign rows after rejected writes, stable paging and
  Count/list filter agreement. Run them and observe failure before implementation.
- [ ] Add populated nested round trips for strategies, detectors, limits,
  principles, assessors, reflex triggers/actions, profile overrides, policy
  rules, scan findings, report JSON and metadata. Explicit `enabled:false`
  must stay false; explicit zero thresholds must survive.
- [ ] Add scoped operations across PostgreSQL, SQLite and MongoDB. Use database
  counts and ordering tie-breakers; do not fetch all rows for totals or filter
  after a bounded read. Use `created_at DESC, id DESC` for scans and ascending
  creation time plus ID for editable collections.
- [ ] Add policy assignment reads and idempotent assignment writes. Test foreign
  policy and target scope, duplicate assignment and remove-then-read behavior.
- [ ] Add scoped retention preview and bounded delete primitives. Preview and
  delete share an immutable cutoff/filter; recheck scope/permission at execution.
  A retry must not expand to a newer cutoff. Test empty target refusal.
- [ ] Run SQLite conformance. Run PostgreSQL and MongoDB with their own test
  databases if available; list any missing service explicitly in `MIGRATION.md`.
  Compile all three implementations and commit the tested store change.

## Task 3: Establish the authenticated contract read path

**Files:** Create `S/admin/{service.go,scope.go,errors.go,capabilities.go,records.go}`,
`S/extension/contract/{contract.go,manifest.yaml,scope.go,errors.go,wire.go,handlers_reads.go}`,
`S/extension/contract/{manifest_test.go,scope_test.go,transport_test.go}`.
Modify `S/extension/extension.go`, `options.go`, `config.go` for registration.

**Interfaces:** `admin.New` receives the scoped store, engine and authorization
adapter. Contract registration follows the live Forge interface:

```go
func Register(d *dispatcher.Dispatcher, reg contract.Registry,
    wreg contract.WardenRegistry, deps Deps) error
```

`Deps` owns the admin service and a scope resolver:

```go
type ScopeResolver func(context.Context, contract.Principal) (store.Scope, error)
```

The service authorizes action/resource access in addition to resolving scope.
Default scope is permitted only when claims are absent and host authorization
allows it. A request parameter is never the authorization source.

- [ ] Write loader/registry tests proving `shield` appears with configured
  status only when its dependencies work. Register wardens before validating
  the manifest. Test invalid manifests and partial registration errors.
- [ ] Test scope resolution for absent identity, absent claims, empty string,
  nil, wrong type, conflicting app, denied principal and an authorized server
  default. Make each refusal assert `PERMISSION_DENIED` or `UNAUTHENTICATED`.
- [ ] Test all read intents through the actual HTTP transport with two scopes.
  Check foreign detail IDs, scoped policy/report keys, partial overview failures,
  metadata-only PII, and zero rows versus failed queries.
- [ ] Implement the read intent table in the spec. Responses use explicit DTOs,
  `{items,total,limit,offset,has_more}` for collections and per-section availability
  for overview. Durations use `duration_ms`; timestamps carry UTC offsets.
  Scan decisions remain recorded values alongside an unavailable evaluation
  capability, not rewritten safety verdicts.
- [ ] Bind every query under contributor `shield` and version 1. Use the real
  dispatcher signature, for example:

  ```go
  err := dispatcher.RegisterQuery(d, "shield", "scans.list", 1,
      scansListHandler(deps))
  if err != nil { return fmt.Errorf("register scans.list: %w", err) }
  ```
- [ ] Run `GOWORK=off go test ./admin ./extension/contract ./extension`, then
  `GOWORK=off go build ./...`. Record legacy-package failures separately if the
  upgraded Forge no longer contains the old contributor package. Commit reads.

## Task 4: Add validated, audited commands

**Files:** Create `S/admin/{primitives.go,profiles.go,policies.go,privacy.go}` and
their tests. Create `S/extension/contract/{handlers_primitives.go,handlers_profiles.go,handlers_policies.go,handlers_privacy.go,commands_test.go}`;
update the manifest and registration table.

**Interfaces:** The service exposes named create/update/delete/setEnabled
operations for the eight editable collections, plus policy assign/unassign and
scoped retention commands. Contract request types preserve omitted fields.

- [ ] Add failing validation tests for bad TypeID prefix, unknown enum,
  non-finite/out-of-range threshold, malformed pattern, foreign profile
  reference, referenced primitive deletion and attempted name/scope mutation.
  Verify explicit clears and zero values through persisted rereads.
- [ ] Use pointer/presence semantics, including fields such as:

  ```go
  type UpdateProfileRequest struct {
      ID string `json:"id"`
      Description *string `json:"description,omitempty"`
      Enabled *bool `json:"enabled,omitempty"`
      Instincts *[]profile.InstinctAssignment `json:"instincts,omitempty"`
      Judgments *[]profile.JudgmentAssignment `json:"judgments,omitempty"`
  }
  ```

  Add equivalent presence fields for awareness, boundaries, values, reflexes
  and metadata. Reject malformed payloads and oversized nested lists before
  invoking the store. Define concrete per-field limits in the request validator
  and publish them in the manifest schema so the form uses the same limits.
- [ ] Test the real command transport's CSRF and idempotency behavior. Repeat a
  create with one idempotency key and verify one stored row; deny a foreign
  resource and verify no mutation or information leak.
- [ ] Implement domain writes through the service. Reject deletes with profile
  references, show the affected profile identities and require an explicit
  update before deletion. Do not imply saved configuration is evaluated.
- [ ] Implement retention preview/execute with sensitive-command authorization,
  the configured audit adapter and bounded targets. A missing audit adapter
  returns `UNAVAILABLE`; it must not pretend to log the action.
- [ ] Test `meta.invalidates` from the actual HTTP response against the spec's
  affected queries. Re-read storage after each command and after rejected writes.
- [ ] Run the admin, contract and backend suites relevant to these writes.
  Commit commands independently from UI integration.

## Task 5: Build configuration lists and structured editors

**Files:** Create `D/packages/plugin-shield/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts}`,
`src/{index.tsx,types.ts,format.ts,badges.tsx}`, shared components and
`src/pages/{primitives.tsx,primitive-detail.tsx,primitive-editor.tsx,profiles.tsx,profile-detail.tsx,profile-editor.tsx,policies.tsx,policy-detail.tsx,policy-editor.tsx}`.
Create `test/{harness.tsx,plugin.test.tsx,primitives.test.tsx,profiles.test.tsx,policies.test.tsx}`.
Add the dependency/import to `D/apps/shell/{package.json,src/App.tsx}` and update
the lockfile without dropping Ctrlplane's concurrent dependency additions.

**Interfaces:** Export default `shieldPlugin`, with extension/namespace `shield`.
Use `useQuery`, `useCommand`, `PluginLink`, `useNavigateTo` and kit components;
the plugin does not import the router. Types come from actual Go DTO JSON tags.

- [ ] Start with capability-based plugin resolution tests for hidden, setup,
  mismatch and ready. Then test list filters, paging reset, foreign/missing
  detail errors, no manual refetch after commands and shared empty states.
- [ ] Register routes with lazy structured editors where needed:

  ```tsx
  export const shieldPlugin = definePlugin({
    extension: "shield", namespace: "shield", label: "Shield",
    nav: [{ label: "Profiles", to: "/profiles", group: "Composition" }],
    routes: [{ path: "/profiles", element: ProfilesPage }],
  })
  ```

  Extend this route table with every route from the spec, including overview,
  six primitive collections and their create/detail/edit routes. Keep reserved
  `/new` routes ahead of parameterized routes as required by the host matcher.
- [ ] Build six schema-aware primitive editors with domain-specific fields from
  the inventory. Share table/dialog plumbing, not a generic freeform JSON form
  for all six domains. Retain unavailable persisted enum values visibly.
- [ ] Build profiles with scoped searchable pickers, override controls and
  reference validation. Build policies with structured rules and persisted
  assignment readback. Show configuration status separately from enforcement.
- [ ] Test double-click prevention, command reset when another dialog opens,
  errors inside dialogs, denied controls, field errors and successful navigation
  after deletion. Assertions use real thrown `ContractError` instances.
- [ ] Use compact kit variants, live row counts, monospace IDs, `NoneCell`,
  `Timestamp`, `TagList` and shared `ZeroState`. Keep the working table close
  to the page header; wrap filters on narrow screens.
- [ ] Run plugin test/typecheck/lint and shell typecheck/build. Check lazy chunk
  output if an editor dependency was added; update `BASELINE.md` only then.
  Commit the verified configuration UI and exact integration paths.

## Task 6: Add truthful overview, record review, privacy and settings

**Files:** Create `D/packages/plugin-shield/src/pages/{overview.tsx,scans.tsx,scan-detail.tsx,pii.tsx,compliance.tsx,report-detail.tsx,settings.tsx}` and matching tests.
Create `D/packages/fixture-server/shield-fixtures.mjs`; add isolated fixture
registration and HTTP checks to the existing server without rewriting its
concurrent edits.

**Interfaces:** Consume Task 3 reads and Task 4 retention commands. Overview
reports availability per section; each stored scan preserves its recorded
decision and metadata without implying evaluation coverage.

- [ ] Add this explicit product behavior test before the overview component:

  ```tsx
  it("shows unavailable evaluation beside stored records", async () => {
    renderShieldPage(OverviewPage, {
      capabilities: { evaluation_available: false },
      overview: { recent_scans: [], sections: [] },
    })
    expect(await screen.findByText("Safety evaluation is unavailable")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Run scan" })).toBeNull()
  })
  ```

  `renderShieldPage` is the Task 5 harness adapter around `PluginProvider` and
  query answers; match its DTOs to the actual Go response before writing tests.
- [ ] Add tests for failed stats versus zero, direction/decision filters,
  last-successful-refresh age, polling while visible, no ciphertext in scan
  detail, duration conversion, report period/scope and unavailable generation.
- [ ] Build compact overview summaries and record tables. Use `usePoll` for
  external writes, with visible stale/error states. Settings show actual values
  and explain why editing is unavailable.
- [ ] Build scoped PII counts and retention preview, cancel and confirm with
  explicit targets. Test missing permission, missing audit adapter, interrupted
  request, stale preview and idempotent retry. Keep errors within the dialog.
- [ ] Add mutable fast fixtures for every shipped intent. Exercise them over
  HTTP and prove writes change subsequent reads. Mark seeded results as examples.
  These checks supplement the real demo and do not replace it.
- [ ] Run plugin checks, fixture HTTP verification and shell build. Commit the
  review pages and fixture integration with exact file staging.

## Task 7: Integrate the real Go demo and review every workflow

**Files:** Create `D/demo/{shield.go,shield_test.go}` and
`D/docs/reviews/2026-10-08-shield-dashboard.md`. Modify
`D/demo/{main.go,go.mod,go.sum,README.md}` additively with the Ctrlplane chat.
Update `S/MIGRATION.md` with live evidence.

**Interfaces:** `newRealShieldExtension` constructs a real Shield extension
using file-backed SQLite, idempotent seeds, explicit demo scope identities and
the real audit adapter for sensitive commands. Registration failure is fatal
in this mode. `DEMO_SHIELD_DB` selects the database path; `PORT` and
`FORGE_DASHBOARD_BACKEND` already control backend and shell ports.

```go
func newRealShieldExtension(ctx context.Context) (*shieldext.Extension, func() error, error)
```

The cleanup function owns only the demo's SQLite connection and audit resources,
and is called on both startup failure and normal shutdown.

- [ ] Repair the current demo's missing Authsome replace path, incompatible
  Warden pin and removed options in concert with Ctrlplane's changes. Wire
  Authsome's required Chronicle audit trail if real authentication is used.
  Record exactly which contributors are real; reject a synthetic Shield fallback.
- [ ] Add persistent SQLite setup and migration, real Shield registration,
  authorized read/manage demo identities and labelled historical records.
  Seed one disabled primitive and a profile with all six assignment kinds.
- [ ] Test seed idempotency, engine capability reporting, registration through
  the actual registry, persisted writes after restart and refusal of a foreign
  app/tenant ID. Use the current dispatcher envelope and secure command handshake.
- [ ] Run the demo and shell in separate terminals:

  ```bash
  # From D/demo
  PORT=8199 DEMO_SHIELD_DB=/tmp/shield-review.sqlite GOWORK=off go run .
  # From D
  FORGE_DASHBOARD_BACKEND=http://127.0.0.1:8199 pnpm --filter @forge-go/dashboard-shell dev --host 127.0.0.1 --port 5199 --strictPort
  # Read the actual contributor inventory
  curl --fail http://127.0.0.1:8199/dashboard/api/dashboard/v1/capabilities
  ```
- [ ] Open `/@shield` in the browser. Review every navigation target at desktop
  and 390x844: list/detail/create/edit/disable/delete, nested profile edits,
  policy assignment readback, recorded scans, report details and settings.
- [ ] Confirm retention preview, cancel and explicit confirmation against
  disposable demo rows. Exercise denied commands, server error, retry,
  missing detail, filtered empty and genuinely empty resources. Save screenshots
  with viewport, URL and backend commit in the review record.
- [ ] Insert a record through a second authorized client and observe polling.
  Reload, restart the server with the same database and verify the same IDs and
  nested fields remain. Change scope and verify query caches do not leak rows.
- [ ] Run a security-enabled authenticated demo test in addition to any
  convenience mode. Verify missing CSRF, duplicate idempotency keys and direct
  foreign resource requests through HTTP. A security-disabled demo is insufficient.
- [ ] Run `GOWORK=off go test ./...` in demo, Shield build/tests, plugin checks,
  shell build and `pnpm -r test` once after integration. Record concurrent
  baseline failures and unverified PostgreSQL/MongoDB checks separately.
- [ ] Commit demo integration and review evidence after the matrix passes.

## Task 8: Retire templ only after the inventory closes

**Files:** Update `S/MIGRATION.md`; remove `S/dashboard/` only when all required
items have replacements or explicit accepted removal reasons. Update
`S/go.mod` and `go.sum` only for dependencies no longer imported.

**Interfaces:** The Go extension keeps its contract contribution and lifecycle
plugins. Find actual consumers of legacy dashboard plugin interfaces before
removing them; migrate those consumers through contracts and React slots.

- [ ] Audit references using `rg -n 'github.com/xraph/shield/dashboard' S` and
  relevant sibling repositories. Inventory any dynamic plugin contributions.
- [ ] Mark every page field/action/widget/setting migrated, deliberately changed
  or dropped with reason, or blocked. A blocked required UI item prevents
  deletion; recording it alone does not establish completion.
- [ ] Remove the legacy package and unused UI dependencies in one separate
  commit. Re-run `GOWORK=off go build ./...` and `GOWORK=off go test ./...` in
  Shield, then the real demo's tests and a Shield route smoke review.
- [ ] Commit the removal only if those checks pass. Leave the evaluation,
  encryption, report-generation and runtime-settings limitations visible and
  recorded; administrative migration is not engine qualification.

## Verification already performed for this plan

- [x] Read the current playbook, Shield contributor, domain/store contracts,
  engine, extension lifecycle, legacy forms/settings and demo source.
- [x] Fetch and audit Shield branches: only `main`, equal to `origin/main` at
  `9dbcac4`; no additional worktrees or branch work to consolidate.
- [x] Fetch and audit dashboard branches: the old release branch is already in
  `main`; unpublished dashboard work is on `main`. Concurrent edits preserved.
- [x] Attempt `GOWORK=off go test -mod=readonly ./...` in Shield. It fails on
  missing go.sum entries associated with the existing dependency edits. Only
  the ID test package passes; this is not a full green baseline.
- [x] Attempt the unchanged demo. It fails on the stale Authsome replacement.
- [x] Start the actual demo with temporary module and source overlays. The real
  Streaming/core paths respond; Authsome falls back to synthetic auth because
  Chronicle is required. No checked-in demo files changed in this audit.
- [x] Review the existing shell against that demo at 1280x720 and 390x844.
  Shield is absent from capabilities, so Shield flows remain unverified.
- [ ] Implement and live-review Shield. This request produces the design and
  execution plan; the new Shield dashboard does not yet exist.
