# Shield dashboard migration design

You should be able to manage Shield's safety configuration and inspect stored
scan records from the React dashboard. The dashboard must also tell you what
Shield actually evaluates. Those are separate facts today: the configuration
stores exist, but all six evaluation layers in `engine/engine.go` are unfinished.

This is a proposed design, grounded in the checkouts inspected on October 8,
2026. Implementation has not started. The companion plan is
`../plans/2026-10-08-shield-dashboard-migration.md`.

## Checkouts and ownership

- Shield: `/Users/rexraphael/Work/xraph/forgery/shield`, module
  `github.com/xraph/shield`, Go 1.26.0.
- Dashboard: `/Users/rexraphael/Work/xraph/forge-dashboard`.
- Forge contracts: `/Users/rexraphael/Work/xraph/forge`.
- Work directly on `main` in the primary checkouts. No branches or worktrees.
- Commit each coherent verified change with exact paths. Preserve concurrent
  edits, and do not push or merge to a remote.
- The separate Ctrlplane chat owns Ctrlplane. Coordinate additive changes to
  `demo/main.go`, `demo/go.mod`, shell registration and the lockfile; do not
  replace those files from an earlier snapshot.

After fetching origin, Shield's `main` and `origin/main` both pointed at
`9dbcac4`. There was no other local branch or worktree. Its existing dirty
`go.mod` dependency upgrade and untracked `_project_files/` belong to concurrent
work. The dashboard's `w7/first-release` was already included in `main` and had
no unpublished commits. Existing unpublished dashboard commits were on `main`.
There is no Shield branch to consolidate.

## What the source actually supports

| Source | Finding | Design consequence |
| --- | --- | --- |
| `engine/engine.go` | Six placeholder evaluation layers; result starts as `allow`; persistence failures are logged and not returned | Show evaluation as unavailable. Do not offer a scan runner or describe an allowed stored result as proof of protection |
| `extension/extension.go` | Legacy contributor wiring was removed in `9dbcac4`; no contract contributor replaces it | Register a new contract contributor through Forge's discovery interface |
| `extension/extension.go` | `Start` does not call store migrations; `Health` always returns nil; loaded extension settings are not passed through `engine.WithConfig` | Test and repair lifecycle/config propagation needed by the dashboard before exposing readiness |
| `store/store.go` | Composite stores cover all six primitives, profiles, scans, policies, PII and reports | Build administration on these concrete stores through a validated application service |
| `store/postgres`, `store/sqlite`, `store/mongo` | Three actual store backends; no memory backend in this checkout | Use a file-backed SQLite demo. Run the same conformance cases on PostgreSQL and MongoDB when available |
| List filters | Empty app/tenant/scope fields omit the corresponding predicate | Resolve and authorize scope before any read. Never use empty as an operator-wide shortcut |
| Detail/update/delete stores | Many operations accept only an ID | Add scoped store operations for contract access, including mutations with scope in the database predicate |
| `dashboard/data.go` | Totals read whole collections; errors sometimes become zero counts or empty rows | Add bounded paging and database counts. Preserve failures and unavailable sections |
| `profile/profile.go` | Assignments refer to primitive names and carry sensitivity/threshold overrides | Keep canonical TypeIDs in routes; validate profile references within authorized scope. Do not rename referenced primitives silently |
| `policy/policy.go` | Tenant assignment writes exist, but no assignment read API exists | Add authorized assignment list/read operations before exposing assignment controls |
| `pii/store.go` | Token rows serialize `encrypted_value`; token reads/deletes are not all tenant scoped | Use explicit metadata DTOs. Never send ciphertext, plaintext or decrypted PII to the dashboard |
| `compliance/compliance.go` | Report storage exists; no report generator is implemented | Provide stored-report review, with provenance limitations. No Generate or certification claim |
| `dashboard/settings/engine_config.templ` | Hardcoded concurrency is 4 while actual defaults use 10; Save calls an absent config route | Read effective server configuration; no save affordance without a working persistent configuration service |
| Test files | Only `id/id_test.go` exists | Budget for store, lifecycle and contract test harnesses; UI tests do not establish engine correctness |

The untracked architecture files describe a broader intended safety system.
Use them for vocabulary and direction. They are not evidence that detectors,
assessment providers, encryption or report generation are implemented.

## Scope and authorization

The default view is one authorized tenant and app. An app selector selects from
server-authorized scope choices; it does not turn arbitrary request parameters
into access grants. Tenant and app come from a host-provided scope resolver
validated against the contract principal. Missing identity, missing scope and
malformed claims fail explicitly. Do not read Shield context helpers and assume
the contract transport populated them.

An installation may supply an explicit server-side default when the caller's
claims are absent and its authorization policy permits that scope. Present but
empty, nil or wrongly typed claims must refuse. A future operator-wide view
needs a separate permission and explicit scoped store semantics. It is not part
of this migration's default reads.

Policy `scope_key` and `scope_level` need their own authorization mapping. An org
policy does not become readable merely because its key matches a request value.
The service authorizes the selected app/org, the policy, and tenant assignment
targets before reading or writing. PII statistics remain tenant scoped, with no
cross-tenant aggregate returned to ordinary viewers.

Use Forge's predicate and Warden passes, then enforce resource ownership in the
application service and scoped database operations. A hidden button is not
authorization. View and manage permissions are separate. Sensitive PII retention
commands need a further explicit permission, affected-row preview and audit.
Audit must use the real configured adapter; no adapter means commands requiring
an audit trail are unavailable.

## Contract and UI

The contributor, React plugin extension and namespace all use `shield`. The
label is `Shield`; URLs start at `/@shield` and internal links stay scope
relative. Follow the current `packages/plugin/PLAYBOOK.md` and sibling contract
registration code, including the contributor argument to dispatcher bindings.

| Area | Queries | Commands and limits |
| --- | --- | --- |
| Overview | `capabilities`, `overview`, `layers.summary` | None; configured primitive counts are not active detector counts |
| Six primitive collections | `<collection>.list`, `<collection>.detail` | `<collection>.create`, `.update`, `.delete`, `.setEnabled` for `instincts`, `awareness`, `boundaries`, `values`, `judgments`, `reflexes` |
| Profiles | `profiles.list`, `.detail`, `.references` | `.create`, `.update`, `.delete`, `.setEnabled`; validate all six assignment kinds and report referencing profiles before deletion |
| Scans | `scans.list`, `.detail`, `.stats` | No execution command while evaluation is unfinished |
| Policies | `policies.list`, `.detail`, `.assignments` | `.create`, `.update`, `.delete`, `.setEnabled`, `.assign`, `.unassign`; assignment changes persist but must not claim enforcement |
| PII vault | `pii.stats`, `pii.byScan`, `pii.retentionPreview` | `pii.deleteTokens`, `pii.deleteTenant`, `pii.purge` only after tenant scoping, preview and audit are implemented; metadata only |
| Compliance | `compliance.list`, `.detail` | Stored reports only; generation unavailable |
| Settings | `config.detail` | Effective, read-only settings. Runtime editing needs a separate persistent settings design |

Use the existing snake_case domain JSON names. Wrap collections in
`{items, total, limit, offset, has_more}`. The initial design uses bounded offset
paging because all three stores already expose limit/offset. Default limit is
25, maximum is 100; reject negative offset, invalid enums and oversized requests.
Use stable ordering with an ID tie-breaker and counts with the identical scope
and filters. Scan records sort newest first; configuration collections sort by
creation time then ID. Do not compute totals by reading all rows.

Preserve optional-update semantics with pointers or explicit presence wrappers.
Name and scope are immutable for configuration rows in this migration; changing
either requires an explicit future reference migration. An omitted array keeps
its old value, and an explicit empty array clears it. Reject unsupported rule
values with field errors, and retain existing unknown stored values visibly
until an operator chooses a supported replacement.

Every successful command declares `meta.invalidates`, including the relevant
list, detail, reference usage, overview and summaries. Commands use the shared
CSRF/idempotency handshake. Polling handles external changes through `usePoll`;
it does not replace command invalidation. Show last successful refresh and stale
or failed refresh state. Do not claim subscriptions exist.

## Page composition and inventory

The old dashboard has 12 navigation entries, 37 route cases, 30 page templates
(including one helper), 45 templ files in total, four widgets and one settings
panel. The implementation starts by recording their columns, filters, actions,
badges, empty states and contributed sections in Shield's `MIGRATION.md`.

| Old surface | New surface | Treatment |
| --- | --- | --- |
| Overview; scan stats, recent scans, PII stats, layer-summary widgets | `/`, compact coverage notice, inline metrics and recent records | Preserve data, replace errors-as-zero and unscoped reads |
| Instinct list/detail/create/edit | `/instincts`, `/:id`, `/new`, `/:id/edit` | Category, sensitivity, strategies with weights/config, action, enabled, metadata and usage |
| Awareness list/detail/create/edit | `/awareness`, matching detail/editor routes | Focus, detectors, patterns/config, PII action, enabled, metadata and usage |
| Boundary list/detail/create/edit | `/boundaries`, matching detail/editor routes | Deny/allow lists, scope, response, enabled, metadata and usage |
| Values list/detail/create/edit | `/values`, matching detail/editor routes | Principle rules, thresholds, categories, guidelines/config, severity, action and usage |
| Judgment list/detail/create/edit | `/judgments`, matching detail/editor routes | Domain, assessors, context requirement, thresholds, action and usage |
| Reflex list/detail/create/edit | `/reflexes`, matching detail/editor routes | Trigger pattern/threshold/window, actions/target/value/fallback, priority and usage |
| Profile list/detail/create/edit | `/profiles`, matching detail/editor routes | All six assignment types, overrides, enabled and metadata; scoped searchable pickers |
| Scan list/detail | `/scans`, `/scans/:id` | Direction/decision filters, findings, PII metadata, duration with explicit units and timestamps |
| Policy list/detail/create/edit | `/policies`, matching detail/editor routes | Scope, structured rules, priority, enabled, metadata; add truthful assignment management |
| PII vault totals/type/tenant breakdown | `/pii` | Preserve authorized totals/types; remove exposure of other tenants; add guarded retention administration |
| Compliance list with expandable summary/details | `/compliance`, `/compliance/:id` | Compact table plus report review; original framework, period, scope and generation timestamp |
| Engine settings | `/settings` | Effective read-only settings and precise unavailable explanation |
| Plugin widget/page/scan-detail/profile-detail interfaces | Registered contract contributions plus React sub-plugins/slots | Inventory actual consumers before removal; no server-rendered component contract |
| Duplicate API Docs links and templ shell chrome | Shared shell documentation affordance where configured | Deliberately remove duplicate chrome, record in inventory |

Use compact kit variants and horizontal filters. Put the engine coverage notice
above the working table as a short summary. Phone layouts wrap controls and use
the shared table overflow behavior; avoid stacking large statistic cards ahead
of the work. Use structured editors for profiles and rules. Code/config JSON
uses the existing shared editor if available, with a lazy route if an editor
dependency is needed. Do not add a graph canvas for six fixed layers.

Empty results use shared `ZeroState` with a relevant illustration, explanation
and next action. Loading, denied, failed, absent-resource and filtered-empty
states stay distinct. Do not show a tour button without a registered walkthrough.
Errors inside an open dialog render inside it, and pending commands disable
confirmation. Scan badges describe recorded decisions, never protection status.

## Demo review and evidence

On October 8 the ordinary `GOWORK=off go run -mod=readonly .` in `demo/` failed
because `replace github.com/xraph/authsome => ../../authsome` points to a missing
directory. A temporary modfile redirected it to `../../forgery/authsome`, then
exposed the old Warden API pin. Redirecting Warden to its current checkout
exposed removed `dashboard.WithTitle` and `dashboard.WithRealtime` calls.

A temporary Go overlay removing those two calls, plus the two temporary module
replacements, allowed the actual demo to start on port 8199. No checked-in demo
source or module file was changed for this investigation. Its capabilities
listed `streaming`, synthetic `auth`, and `core-contract`; Shield was absent.
Authsome fell back because its engine now requires `WithChronicle`.

The shell ran on port 5199 through `FORGE_DASHBOARD_BACKEND` and was reviewed in
the browser at its default desktop size (1280x720) and 390x844. Navigation became
a mobile sidebar; the overview's stacked statistic cards pushed its working
table below the initial phone viewport. Shield should use denser summaries.
This establishes the review setup only. No Shield UI, writes or integration
have been browser verified.

The finished demo must register the real Shield extension with persistent
SQLite storage, explicit authorized scope, a real audit adapter for sensitive
commands, and idempotent source-labelled seed records. Seeded historical scans
and reports must say they are examples; they are not detector or report-generator
output. Startup must fail visibly if real Shield registration fails. Never fall
back to a synthetic Shield contributor in the acceptance run.

Review create/edit/disable/delete, profile references, policy assignments,
retention preview/cancel/confirm, reload and process restart, external writes,
scope changes, direct foreign IDs, denied commands, server errors and retry.
Run both secure/authenticated and convenience read-only demo modes. A demo with
contract security disabled cannot establish CSRF or authorization correctness.

## Completion gates

1. Store, lifecycle and contract tests pass on SQLite. PostgreSQL and MongoDB
   results are recorded separately; unavailable services remain unverified.
2. Plugin tests, typecheck, lint and shell build pass. Run the workspace tests
   once after integration and distinguish concurrent baseline failures.
3. The real Go demo serves Shield, and the complete review matrix passes at
   desktop and narrow widths with persistent writes and visible error states.
4. Each legacy inventory item has a disposition and supporting evidence. Any
   unresolved contributed UI prevents deletion of that interface.
5. Delete the legacy `dashboard/` package only as a separate Shield commit after
   import audit, full build and full tests. Remove now-unused dependencies only
   when no remaining consumer needs them.

Administrative migration completion does not mean Shield's safety engine is
production ready. Evaluation, encryption guarantees, report generation and
runtime settings persistence remain separately named engine capabilities until
they are implemented and verified. The dashboard must keep that distinction
visible even after the templ package is retired.
