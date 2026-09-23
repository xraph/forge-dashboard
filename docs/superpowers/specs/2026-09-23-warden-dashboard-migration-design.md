# Warden dashboard: templ to React shell

Design for moving the Warden extension's dashboard off server-rendered templ
and onto the React shell, across two repositories.

- Go: `/Users/rexraphael/Work/xraph/forgery/warden`
- React: `forge-dashboard`, as a new `packages/plugin-warden`

Method is `packages/plugin/PLAYBOOK.md`, including its closing section on
retiring the templ dashboard.

## What this is for

Warden is the Forge permissions and authorization engine. It does RBAC, ABAC
and ReBAC, individually or all three at once, tenant-scoped and namespaced,
with a check log that records every decision. Its dashboard today is 23 templ
pages plus 8 components rendered server-side through
`contributor.LocalContributor`. The React shell cannot consume that. It speaks
one thing, a POST envelope carrying a contributor name and an intent name, and
Warden has no contract contributor, no intents and no envelope.

The operator this is for administers authorization for a platform. Three
questions matter most to them, and the current dashboard answers none of them
well: why was this request denied, what can this subject actually do, and what
changes if I edit this policy.

Success is: every capability Warden's domain packages offer is reachable from
the React dashboard or is recorded in `warden/MIGRATION.md` as deliberately
dropped or blocked, and `warden/dashboard/` no longer exists.

## What the investigation found

These are the facts the design rests on. Each was read from the Go source.

### Authsome's roles are Warden's roles

`authsome/rbac/warden_store.go` defines `WardenStore`, which implements
`rbac.Store` by delegating to `warden.Engine.Store()`. Authsome's `CreateRole`
writes a `warden.Role`. Its `HasPermission` calls `warden.Engine.Check()`.
There is even a prefix translation layer, `convertToWardenRoleID`, because the
two repositories disagree on typeid prefixes for rows in the same table.

It is the only implementation. `service.go:1871` returns
`rbac.NewWardenStore(e.wardenEng)` and `hasRBACStore()` reports whether the
Warden engine is present at all, which means authsome has no roles without
Warden and these are not two similar things that happen to overlap.

So `/@auth/roles` and `/@warden/roles` will read the same rows through two
projections, and authsome's is strictly lossy: it drops `namespacePath`,
`isSystem`, `isDefault`, `maxMembers` and the whole `parentSlug` inheritance
mechanism, inventing an opaque `parentId` in its place, and it has no paging at
all against a store that offers both `ListRoles` and `CountRoles`.

### `CheckResult` cannot explain a denial

`Engine.mergeDecisions` (engine.go:666) picks the first non-empty `Reason`
among the RBAC, ReBAC and ABAC results and discards the other two. `MatchedBy`
is populated only on an allow. A denied check therefore returns one sentence
and an enum, and the two evaluators that did not produce that sentence leave
no trace.

This is the central problem for the playground, whose entire value is showing
why a decision came out as it did.

### `Check` is not safe to re-run

It writes a check log entry through the batching writer (engine.go:367), sets
the result cache (step 6), and fires `PolicyObligationFired` plus `AfterCheck`
plugin hooks (step 7), which Chronicle audit listens to. So pressing the button
in a playground leaves a trail in the same audit log the check-log page
displays, indistinguishable from production traffic.

A second press of the same check hits the cache, so the evaluators never run,
`EvalTimeNs` reports cache lookup time, and whatever reasoning existed is
whatever was cached.

`buildCheckLogEntry` never sets `Metadata`, and nothing reaches the entry from
context except request IP, request ID and trace ID. A contract handler cannot
mark a playground run as a playground run without changing core.

### Policy semantics are not what a table implies

From `evaluator.go`:

- `Subjects`, `Actions` and `Resources` are OR-ed. `Conditions` are AND-ed.
- An empty matcher list means every subject, every action, every resource. A
  policy with all three empty matches every check in scope.
- `Priority` sorts the scan, but only the first match of each effect is kept
  (`if bestDeny == nil`). Priority decides which policy gets cited, not the
  outcome.
- `EffectiveAt` skips a policy outside its `NotBefore`/`NotAfter` window
  whatever `IsActive` says.
- A deny policy whose condition throws still applies, failing closed
  (evaluator.go:92). An allow policy in the same state is skipped. A broken
  condition makes a deny stronger.
- Anything whose `Effect` is not exactly `"allow"` is treated as deny.

The empty-list rule is the dangerous one for a UI. Rendering an empty
`Actions` list as blank, or as `NoneCell`, tells the operator "no actions" when
the truth is "every action".

### Paging is uniform, and it is offset

Every domain defines `ListX(filter)` and `CountX(filter)`, and every
`ListFilter` carries `Limit` and `Offset`. There is no cursor anywhere. So this
contract has no reason to repeat authsome's split between cursor and
page-number intents, and no translation layer in the UI.

### Namespaces exist everywhere and appear nowhere

Every entity carries `NamespacePath`. Every `ListFilter` has both
`NamespacePath *string` and `NamespacePrefix string`. `AncestorNamespaces`
resolves roles, permissions, policies and resource types up the whole ancestor
chain at check time, and relations deliberately do not cascade.

`dashboard/contributor.go` never passes a namespace filter and no templ page
displays one. An operator looking at two roles both called `admin` cannot see
that they are different roles in different namespaces.

`ValidateNamespacePath` forbids a leading or trailing `/`, and
`namespaceSegmentRegex` permits `root` as an ordinary segment name. Both facts
matter to the display and are used below.

### The DSL is a whole capability with nothing on screen

`dsl.Export` renders the store as Warden source text. `dsl.Apply` with
`DryRun` plans and returns a diff, and with `Prune` reconciles kubectl-style,
deleting entities in scope that the program does not declare. `Apply` refuses
to prune the global scope, because pruning an empty tenant would delete every
tenant-less entity across every caller.

The repository also ships `editor/warden.tmLanguage.json`,
`editor/tree-sitter-warden`, and a working language server in `lsp/` with
completion. `dsl.Diagnostic` carries `Pos{File, Line, Col}`, 1-based. The
keyword set in `dsl/token.go` is 47 flat keywords with no context-sensitive
lexing.

### What the templ pages cannot do

Read against the domain, the 23 pages expose a subset:

- No update anywhere except policies. Roles, permissions and resource types
  have create forms and delete confirms, and no edit.
- No namespace, as above.
- Nothing PBAC. `NotBefore`, `NotAfter`, `Obligations`, `Priority` and
  `Version` are on the struct and `policy_detail.templ` shows effect and
  conditions.
- Nothing subject-centric, though `ListRolesForSubject`,
  `ListPermissionsBySubject`, `ListSubjectsForRole`, `ListRelationObjects` and
  `ListRelationSubjects` all exist.
- No check log detail, though `GetCheckLog` exists. No purge, though
  `PurgeCheckLogs` exists.
- No `ListExpiringAssignments`, no `RunMaintenance`, no `InvalidateTenant` or
  `InvalidateSubject`, no batch check, no AuthZen evaluations.

### Two templ surfaces are not what they look like

The settings panel has no write path. Warden's `Config` comes from Forge
config, not from a store, and `settings/config.templ:84` marks the fields
`Disabled`. There is no settings page to migrate, only a config display.

`policy_form.templ:303` and `resource_type_form.templ:44` fetch `/v1/policies`
and `/v1/resource-types` with no base path, unlike every other form in the
directory. They only work when the API happens to be mounted at root. That is a
bug the migration fixes, and it goes in `MIGRATION.md` as a bug and not as a
feature.

### The check log is genuinely written

Worth stating because a sibling migration found an audit surface reading a
table nothing wrote. Warden does not have that problem. `engine.go:101`
constructs `newCheckLogWriter` whenever check logging is enabled, and
`checklog_writer.go:111` calls `CreateCheckLog` on the flush path, so the
check-log page reads rows something actually produces.

The queue is bounded and drops on overflow, incrementing
`Metrics.CheckLogDropped`. The dashboard has no way to read that counter, so a
busy system silently logs less than it decided. Recorded, not solved.

### Policy sub-entities serialize three different ways

`Policy.Subjects`, `Actions`, `Resources`, `Conditions` and `Obligations` are
all tagged `db:"-"`, and each backend persists them differently: postgres uses
`jsonb` columns, sqlite marshals them to JSON strings, mongo stores native
arrays, and memory deep-copies the Go values.

The shared conformance suite in `store/contract/` runs against all four
backends and covers tenant isolation, uniqueness, junction integrity, namespace
filtering and expiry. But every policy it constructs has those five fields
**empty** (`actor_fields.go:114`, `namespace_filter.go:241`). The populated
round-trip, which is exactly what the policy editor writes and reads back, is
proven on no backend.

The engine is mostly defensive about the consequences. `OpEquals` compares
through `fmt.Sprint`, so an integer that returns as `float64` from a JSON
round-trip still matches, and `toFloat64` covers nine numeric types. That is
evidence somebody has already been bitten by this, not evidence it is solved:
`Condition.Value` is `any`, and int64 values beyond float64 precision will not
survive the postgres and sqlite paths intact.

This is a risk to close with a test, not a bug to fix blind.

### Beware the name collision

`forge/extensions/dashboard/contract/warden.go` defines `contract.Warden`, a
generic per-intent authorization hook, and `contract.WardenRegistry`. Neither
has anything to do with the Warden extension. Do not wire one to the other by
accident. (Making the Warden extension implement that interface, so the
dashboard's own intent authorization runs through the engine the dashboard
displays, is a good idea and is out of scope here.)

## Decisions taken

Four, agreed before design.

The explain path starts in the contract and moves to core later.
`playground.explain` lives in `warden/extension/contract` and reconstructs the
per-model trace by reading the same store the evaluators read, so that it can
ship without waiting on a core release; a follow-up adds `Engine.Explain` to
core and the contract becomes a projection of it. The duplicated logic is a
known cost and the `consistent` flag described below is what keeps it from
being a silent one.

`WithCallDryRun` goes into core now, because it is about fifteen lines and it
is the difference between a playground you can press twice and one you cannot.

Warden's roles page is canonical. The nav entry in `plugin-authsome` becomes
"App roles" and its page carries a line pointing at Warden's editor, which is
two small edits over there, and Warden's page keeps the plain name and shows
every field.

Full scope: everything on the templ checklist, plus the missing updates,
namespaces, the redesigned playground, the DSL surface, the relations graph and
the subject access view. About 48 intents.

## The Go contract

`warden/extension/contract/`, mirroring authsome's layout: `contract.go` with
`Deps` and `Register`, an embedded `manifest.yaml`, `types.go`, `errors.go`,
and one `handlers_*.go` per domain. Contributor name is `warden`. URL namespace
is `/@warden`.

`Extension.RegisterContractContributor(disp, reg, wreg)` wires it, alongside
the existing `DashboardContributor()` until that goes.

### Conventions

DTOs are camelCase projections and never the domain struct. Warden's domain is
snake_case, the dashboard wire is camelCase, and authsome's contract is already
camelCase, so the contract declares its own types and the playbook's rule about
copying field names from JSON tags applies to those rather than to the domain's,
with the TS interfaces mirroring them exactly.

One paging envelope, offset, everywhere. Requests take `limit`, `offset` and
their filters, responses are `{items, total, limit, offset}`, and that maps
directly onto `ResourceTable`'s `PaginationState {page, pageSize, total}`
without a translation layer.

Namespace is `*string` on every request that filters. `nil` means every
namespace, `""` means the tenant root, and a path means that namespace. The
domain's `ListFilter.NamespacePath` is already a pointer and the store treats
`nil` and `""` differently, so a plain string here would silently convert
"everything" into "the root".

Optional update fields are pointers, and that includes slices. Warden's own
HTTP API gets this wrong today: `UpdatePolicyRequest.Obligations` is a plain
`[]string`, so there is no way to say "remove every obligation" as distinct
from "leave them alone". The contract uses `*[]string` for lists that can be
emptied, and `*string`, `*int`, `*bool` for scalars.

### Error mapping

`mapWardenError` matches with `errors.Is` against Warden's sentinels.

| warden | contract code |
|---|---|
| `ErrNotFound` (base of every `ErrXNotFound`) | `NOT_FOUND` |
| `ErrAlreadyExists` (base of every `ErrDuplicateX`) | `CONFLICT` |
| `ErrSystemRoleImmutable`, `ErrSystemPermissionImmutable` | `PERMISSION_DENIED` |
| `ErrCyclicRoleInheritance`, `ErrMaxMembersExceeded`, `ErrInvalidCondition`, namespace validation | `BAD_REQUEST` |
| `ErrTenantRequired` | `BAD_REQUEST`, with its own message |
| anything else | `INTERNAL` |

The two immutability errors are `PERMISSION_DENIED` and not `BAD_REQUEST` on
purpose. Retyping the input will not help, so it is not bad input.

`ErrGraphDepthExceeded` and `ErrGraphBudgetExceeded` never reach a handler from
`Check`, which swallows them. In `explain` they produce a partial lane result,
not a failed intent.

### The core change

In `call_options.go`, add `dryRun bool` to `callOptions` and a
`WithCallDryRun() CallOption`. In `Check`, guard four things: the cache read at
step 1, the cache write at step 6, `emitAfterCheck` at step 7, and
`writeCheckLog` at step 8. `failCheck` must also skip its log write under dry
run.

Three tests: a dry run with a warm cache still evaluates, a dry run leaves the
check log empty, and a dry run fires no plugin hooks.

## Namespace, and why it is not a page

There is no namespace entity: no table, no CRUD, no create. A namespace exists
only as a string on rows, `namespaces.list` derives the set by scanning
distinct values across the entity tables, and a "Namespaces" nav entry would
therefore be a page listing things you cannot act on.

Namespace appears in three places on every surface instead:

1. A filter in every `FilterBar`, with explicit options and no blank default:
   "All namespaces", "Tenant root", then each discovered path. A select whose
   empty option means "all" cannot also express "root", and those are different
   queries.
2. A column in every table, `font-mono text-xs` per convention 1.
3. A field in every create form, defaulting to whatever the filter is set to.

The tenant root renders as `/`. The obvious choice would be the word `root`,
except that `namespaceSegmentRegex` permits `root` as an ordinary segment name,
so a namespace actually called `root` would be indistinguishable from the
tenant root, whereas `ValidateNamespacePath` forbids a leading or trailing `/`
and therefore `/` is a token no real path can produce.

The root is not a "none" value and `NoneCell` is wrong for it. It is a real
place where things live.

## The intent surface

48 intents in 14 groups. Names follow authsome's `noun.verb` convention.

| group | intents |
|---|---|
| roles | `list` `detail` `create` `update` `delete` `attachPermission` `detachPermission` `setPermissions` |
| permissions | `list` `detail` `create` `update` `delete` |
| policies | `list` `detail` `create` `update` `delete` `setActive` `validate` |
| resourceTypes | `list` `detail` `create` `update` `delete` |
| assignments | `list` `create` `delete` `expiring` |
| relations | `list` `create` `delete` |
| checkLogs | `list` `detail` `purge` |
| playground | `check` `explain` `batchCheck` |
| subjects | `detail` |
| overview | `stats` `recentChecks` |
| config | `detail` |
| namespaces | `list` |
| schema | `export` `plan` `apply` |
| maintenance | `run` `cacheInvalidate` |

### Invalidation

Every command declares `meta.invalidates`. The cross-domain ones are the ones
that get missed:

- `roles.delete` cascades through `DeleteAssignmentsByRole`, so it invalidates
  `assignments.list` and `subjects.detail` as well as `roles.list`.
- `permissions.delete` removes role junction rows, so it invalidates
  `roles.detail`.
- `assignments.*` and `relations.*` invalidate `subjects.detail`.
- Anything that changes an entity count invalidates `overview.stats`.

Two commands invalidate nearly the whole surface, and they are declared that
way rather than under-declared: `schema.apply`, which can create, update and
delete every entity type, and `maintenance.run`, which purges assignments and
check logs.

## The policy rule surface

The empty-list rule from the investigation is the design driver. Empty matchers
render as `anyone`, `any action`, `any resource`, visually distinct from a
populated list. A policy with all three empty carries a warning, because a
policy matching every check in scope is nearly always a mistake.

The second driver is that OR and AND must not look alike, because if subjects
and conditions are both rendered as stacked lists they read identically to
somebody scanning the page and they mean opposite things. So the structure
carries the logic: OR lists render inline as chips on one line, read across, as
alternatives, and AND conditions render stacked with each row from the second
prefixed `and`, read down, as accumulation.

Detail page main column is one rule block. Effect is the heading and the only
place colour carries meaning on the page. Labels are lowercase and aligned, not
all-caps eyebrows:

```
  Deny

  subject    role: contractor  ·  user: usr_2f8a
  action     document:delete
  resource   document:*
  when       context.ip    not in   10.0.0.0/8
        and  subject.mfa   exists
  active     1 Jun 2026 → 30 Jun 2026
  emits      notify-security
```

Priority, version, namespace, created and updated by, and timestamps go in a
quiet `DescriptionList` in the `DetailLayout` aside. Priority's label says what
priority does, which is decide which policy gets cited and not which one wins.

The editor is the same block with each clause editable in place. Chips you add
and remove for the OR rows. Stacked condition rows with a field input, an
operator select carrying the 18 real operators, and a value input whose type
follows the operator: CIDR for `ip_in_cidr`, RFC3339 for `time_after` and
`time_before`, a pattern for `regex`, a list for `in` and `not_in`, a number
for the comparisons, and nothing at all for `exists` and `not_exists`.

`policies.validate` runs `policy.Validate` and `policy.ValidateCondition`
server-side and returns errors keyed by condition index, so an invalid CIDR
marks its own row and does not fail the whole save.

Three states the templ page cannot show, each visually distinct:

- inactive, meaning `isActive` is false
- outside its window, which is a different fact with a different fix
- fails closed, meaning a deny whose condition cannot evaluate, which is
  stronger than it looks and not weaker

There is no code editor here. A stored policy has no text form, and inventing
one would mean highlighting something the server never parses.

## The playground

The templ version centres a 2xl bold ALLOWED or DENIED, which spends all of the
page's emphasis on the least informative part of the answer. Here the verdict
is one line and the lane that decided it is the elevated element.

Three lanes, RBAC, ReBAC and ABAC, each in one of five states, because "ReBAC
did not run" and "ReBAC ran and found nothing" are different facts:

| state | means |
|---|---|
| `allow` | matched, with what matched |
| `deny` | evaluated, nothing matched, with the specific reason |
| `skipped` | ReBAC only: RBAC already allowed and `EvaluateAllModels` is off |
| `disabled` | turned off in `Config` |
| `error` | store failure, or graph depth or budget exceeded, so a partial answer |

```
┌─ Build a check ────────┐  ┌─ Result ──────────────────────────────┐
│ subject kind  [user ▾] │  │ Denied · deny_explicit · 1.2 ms       │
│ subject id    [      ] │  │                                        │
│ action        [      ] │  │  ▸ rbac     allowed                    │
│ resource type [      ] │  │      role "editor" grants document:*   │
│ resource id   [      ] │  │  ▸ rebac    skipped                    │
│ namespace     [  /  ▾] │  │      rbac already allowed              │
│ context json  [      ] │  │  ■ abac     denied          ← decided  │
│                        │  │      policy "contractor-lockout"       │
│  [ Run check ]         │  │      role contractor matched           │
│                        │  │      context.ip not in 10.0.0.0/8      │
│ Nothing is written to  │  │                                        │
│ the audit log.         │  │  An explicit deny overrides the rbac    │
└────────────────────────┘  │  allow.                                │
                            │  emits  notify-security                │
                            └────────────────────────────────────────┘
```

The sentence under the lanes is the payoff. It names why this beat that, which
is the thing `CheckResult` cannot currently tell anyone.

Every cited rule is a link. The policy name goes to `/policies/:id`, the role
to `/roles/:id`. The templ page renders `rule_id` as raw mono text you cannot
click.

Namespace is in the builder, which it is not today, and it changes the answer.

Check log detail gets "Open in playground", prefilling every field including
namespace. That is the workflow when somebody asks why a request was denied at
3am, and nothing supports it today.

### Honesty about the reconstruction

The verdict comes from the real `Check`, run with `WithCallDryRun`, while the
lane detail is reconstructed by re-reading the store, and those two can diverge
if somebody writes to the store in between.

So `playground.explain` returns `consistent bool`, true when the
reconstruction's predicted decision matches the real one, and when it is false
the UI says the data changed while explaining and offers a re-run instead of
showing reasoning that contradicts its own verdict. The alternative, which is
to reconstruct quietly and hope, produces a page that is wrong exactly when
somebody is using it to debug a race.

That flag exists only until `Engine.Explain` lands in core, and then it goes.

## The two heavy surfaces

CodeMirror 6, not Monaco. Monaco is roughly 3 to 5 MB raw and `BASELINE.md`
records the entire current shell at 632 KB raw, so choosing it would mean one
lazy chunk five to eight times the size of the whole application, which is not
a reasonable thing to hand an operator even on a route they opted into.
CodeMirror 6 with basic-setup is around 350 to 400 KB, and Warden's language is
47 flat keywords with no context-sensitive lexing, which is about forty lines
of `StreamLanguage`. `editor/warden.tmLanguage.json` is not directly consumable
by either editor without oniguruma WASM, so it saves no weight, but it is the
reference for writing that tokenizer correctly.

Both surfaces mount at lazy routes. `PluginHost.tsx:412` wraps every page in
`Suspense`, so a lazy element is legal and shows a spinner where the page goes.

### The DSL surface, at `/schema`

`schema.export` returns Warden source for the current tenant and namespace
scope. `schema.plan` runs `dsl.Apply` with `DryRun` and returns created,
updated, deleted and no-op counts. `schema.apply` does it for real.

Diagnostics carry `Pos{Line, Col}`, so parse errors are inline gutter markers
on the exact line and not a message above the editor.

Plan before apply is mandatory. You never apply text whose diff you have not
seen.

Prune is a separate control with its own confirm naming the count of entities
about to be deleted. It is never a checkbox beside Apply. `dsl.Apply` already
refuses to prune the global scope; the UI refuses earlier and says why.

### The relations graph

There are two graphs here and they have very different safety profiles.

The schema graph is the default view, on `/resource-types`. Nodes are resource
types, edges are their `RelationDef`s, and permission expressions annotate the
nodes. It is bounded by how many types exist, so it is safe to draw whole.

The instance graph is relation tuples, where nodes are concrete objects and
edges are tuples, and it is unbounded. Drawing it wholesale is a hang and not a
feature, so it is always rooted at one node and expanded outward using the
engine's own budget from `Config`, which is `MaxGraphDepth`, `MaxGraphVisited`
and `MaxGraphFanout`. Borrowing those numbers rather than picking new ones
means the canvas can honestly say "stopped at depth 10, the engine's limit"
instead of quietly truncating, and it means the playground's ReBAC path draws
as a highlighted trail through exactly the same walk the engine performed.

That discipline is the difference between reaching for a graph because the
domain is one and reaching for it because a table felt boring.

## Subject access view

`/subjects/:kind/:id`. One page answering what a subject can do and why.

Assembled in the contract from reads that already exist: `ListRolesForSubject`
then `GetRoles` then `ListRolePermissionsForRoles`, plus `ListAssignments`
filtered by subject, which carries expiry and resource scoping,
`ListRelationObjects`, the active policies whose `matchesSubject` names them,
and recent `ListCheckLogs` for that subject.

It is the inverse of the playground. The playground asks about one check, this
asks about one subject. Every effective permission shows where it came from:
direct role, inherited through `parentSlug`, or a relation. Assignments close
to expiry are marked, because `ExpiresAt` exists and nothing surfaces it.

Reached from a check log row, from an assignment row, and from the playground's
subject field.

## The React plugin

`packages/plugin-warden`, `extension: "warden"`, `namespace: "warden"`.

Nav groups, roughly the shape the domain already has:

- Overview: Overview, at `/`
- Authorization: Roles, Permissions, Assignments
- Policies: Policies
- Relationships: Resource types, Relations
- Operations: Playground, Check log, Schema, Config

Detail, create and edit routes stay out of `nav`. A sidebar link to "a role"
with no role chosen points nowhere. That applies to `/subjects/:kind/:id` too,
which is reached from the rows that name a subject and never from the sidebar.

Two intent groups back no page of their own. `namespaces.list` feeds the
namespace filter on every list, and the two `maintenance` intents are controls
on the config page, since that page is otherwise read-only and they are the only
operational actions Warden exposes.

Pages are plain components. No react-router dependency, route params arrive as
a `params` prop, links go through `PluginLink` with scope-relative paths.

Every list uses `ResourceTable` with its pagination, `FilterBar` for search and
filters, `QueryBoundary` around the query and `CommandAlert` inside whatever
dialog can fail. Identifier columns carry `font-mono text-xs`, the column an
operator reads carries `font-medium`, every caption carries a live row count
including at zero rows, absent values use `NoneCell` or `TagList`, possibly
absent timestamps use `Timestamp`, and badge colour is the scan signal.

The badge vocabulary is the four-variant one, and proportion decides it, not
meaning: whatever state holds most of the rows takes `outline` whatever it
signifies, the rest ramp up by how much a row should interrupt somebody
scanning, and `destructive` is reserved for what they came to find.

### The check log cannot have a fixed colour mapping

This is the one page where applying the rule does not produce an answer.

A deny is not an error. On a working system it is frequently the correct answer
and the page will be full of denials, so colouring deny `destructive` paints
the whole table red and the colour stops carrying anything. But which state
dominates depends on the deployment's posture, not on the domain. A permissive
system logs mostly allows and the denials are the interesting minority. A
restrictive one logs mostly denials and an unexpected allow is what somebody is
hunting. Both are ordinary configurations of the same engine.

So the decision column gets a quiet badge with no fixed semantic mapping, and
the scan signal on this page is carried by two fields that do not vary with
posture. `Error` is a genuine evaluation failure and takes `destructive`.
`Cached` takes `secondary`, because a cached row is the single most common
answer to "why did my permission change not take effect", and nothing surfaces
it today.

Finding a particular decision is then the filters' job, which is the right
device for a distinction the page cannot know in advance. That reasoning is
written here because the playbook asks for it whenever the default mapping does
not fit.

## Testing and verification

Per package in both repositories. `go build ./... && go test ./...` in warden.
`test`, `typecheck` and `lint` here, plus `pnpm -r test`, because only `tsc`
sees the barrel and scoping to one package has twice hidden a stale assertion
somewhere else.

Three traps to design around and not rediscover:

Failure tests stub a thrown `ContractError` and never `{ok: false}`, because
`execute()` resolves `undefined` only when the client throws, so a stub
answering `{ok: false}` resolves normally and the test passes without ever
running the failure path it claims to cover.

No test reads a source file with `node:fs`. A plugin package's tsconfig carries
no Node types, so that passes vitest and fails typecheck. Use `import.meta.glob`
with `{query: "?raw", eager: true}`.

Every `ConfirmDialog` gets `pending`, because it does not debounce and a double
click sends the command twice. Every error renders inside its dialog, because
Base UI marks everything outside an open dialog inert and `aria-hidden`, which
means an alert rendered on the page body is unreachable for as long as the
dialog that can actually fail is open.

Then run it. Fixture server plus shell, click every page. Warden needs a
`warden` section in `packages/fixture-server/server.mjs` with seed state and
handlers for all 48 intents. That is substantial and it is what makes clicking
through possible at all.

The seed data has more work to do here than in most plugins, because a fixture
whose checks always allow, or always deny, cannot exercise the playground at
all and a trace with nothing to trace proves nothing. So the seed carries a
policy set where every interesting answer is reachable: an RBAC allow, an
explicit-deny policy that overrides it, a deny that arrives through a relation
chain two hops deep rather than directly, a policy sitting outside its
`notBefore`/`notAfter` window, one with an obligation attached, and entities in
at least two namespaces so the filter and the ancestor cascade both do
something visible.

The same applies to commands. A fixture that accepts a write and changes
nothing hides the bug it exists to expose, so `schema.plan` returns a diff that
differs from the current state, `maintenance.run` reports non-zero purges
against seeded expired assignments, and a second `relations.create` with the
same tuple conflicts.

Re-measure the bundle after CodeMirror and React Flow land, write the numbers
into `BASELINE.md`, and check `pnpm build` output to confirm both actually
split. One stray static import anywhere pulls them back into the eager entry.

## Retiring the templ dashboard

`warden/MIGRATION.md` is written as each slice starts, not reconstructed at the
end. Every page, column, action, filter, badge and empty state gets recorded
while the templ source still exists, because once the directory is gone there
is no reference to go back to and that file becomes the only record of what the
old dashboard did. The playground gets the most detail, since the templ version
is the only description anywhere of what that reasoning looks like on screen.

Each item is then marked migrated, deliberately dropped with a reason, or
blocked. Two are already expected to be recorded rather than migrated: the
settings panel, which has no write path, and the two forms posting without a
base path, which are recorded as a bug the migration fixes.

Before deleting: `grep -rn "warden/dashboard" --include='*.go'` across the
extension to find other importers, since the dashboard package exports widgets
and nav as well as pages. Then confirm `go build ./... && go test ./...` passes
with the directory gone. Then delete it as its own commit, separate from the
migration, because a commit that adds a contract, adds a React plugin and
removes several thousand lines of templ is one nobody can review or revert
cleanly.

If a templ surface turns out to have no contract equivalent and no way to build
one, it is not deleted and not quietly dropped. It is recorded and reported.

## Sequence

Spine first, then vertical slices.

The spine is the thinnest thing that goes all the way through: the contract
package with a manifest and exactly one intent, `Extension.RegisterContractContributor`,
`packages/plugin-warden` with one page, and the fixture server's `warden`
section seeded. It proves the contributor name lands in the capabilities
response, nav appears, and a query resolves.

That matters because the worst failure mode here is silent: a wrong `extension`
name renders nothing at all with nothing logged anywhere, since that is exactly
what a correctly-handled uninstalled extension looks like, and with 48 intents
and two lazy chunks ahead of you it is much better to meet that silence on the
first intent than on the forty-eighth.

Then, in order, each slice carrying its Go intents, manifest entries with
`invalidates`, fixture handlers, React page and tests:

1. Spine, plus `WithCallDryRun` in core
2. Overview, config, `maintenance.run` and `maintenance.cacheInvalidate`
3. `namespaces.list` and the shared namespace filter the later slices reuse
4. Roles, including the update the templ pages never had
5. Permissions
6. Assignments
7. Relations, table view only
8. Resource types, table view only
9. Policies, the rule surface, preceded by a `store/contract` conformance case
   that round-trips a policy with every sub-entity populated, run against all
   four backends
10. Check log, including detail and replay
11. Playground and explain
12. Subject access view
13. Schema, the CodeMirror surface
14. Relations and resource types, the React Flow surface
15. `plugin-authsome` retitle
16. Bundle re-measure
17. Templ deletion, its own commit

Slice 3 is small and comes early because every list from slice 4 onward carries
the namespace filter, and retrofitting it into nine finished pages costs more
than building it once.

Slices 7 and 8 land as tables first and get their graph in slice 14, so the
graph work cannot block the data work.

Slice 11 depends on slice 9, because the playground links every cited policy to
its detail page and there is no detail page before then.

## Risks

The reconstruction in `playground.explain` duplicates evaluator logic that will
be written a second time when `Engine.Explain` lands, which was accepted
knowingly, and the `consistent` flag is what limits the damage if the two drift
apart before then.

`schema.apply` with prune is the most destructive thing in this dashboard. It
gets the most careful confirm, and it is the one surface where a design review
after implementation is worth scheduling rather than assuming the spec covered
it.

The policy editor is the first thing to write populated sub-entities through
the contract, so it is the first thing that would find a backend serialization
divergence, and it would find it as a policy that silently stops matching. The
conformance case in slice 9 exists to find it earlier and somewhere with a
stack trace. Note that the case needs the postgres and mongo integration
harnesses, which the existing `*_integration_test.go` files already build, so
this is an addition to a suite and not a new suite.

Two heavy dependencies land in a shell that has never split a chunk before, and
slice 16 exists because "it should split" and "it splits" are different claims.
