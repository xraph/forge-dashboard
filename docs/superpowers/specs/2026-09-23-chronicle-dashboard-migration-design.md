# Chronicle dashboard: templ to React shell

Chronicle is a production audit-trail library. Every event lands in a SHA-256
hash chain, keyed with HMAC so the chain cannot be recomputed without material
the database never holds. It exists for SOC2, HIPAA and GDPR compliance in
multi-tenant SaaS.

This spec moves its dashboard off server-rendered templ and onto the React
shell, in two repositories. Read `packages/plugin/PLAYBOOK.md` first. Nothing
here repeats it.

## What this is for

Every other dashboard in this ecosystem lists things and edits them. Chronicle's
job is different: it has to let somebody establish that a record has not been
altered, and show it convincingly enough to put in front of an auditor.

That one sentence drives most of what follows. Verification is the landing
surface here and not a detail page hung off a list, which is backwards from
every other extension in this ecosystem and is the right way round for this one.
A broken chain gets a location and a kind. An audit log is a search problem
before it is a table problem, so the log page is built for finding one event and
not for browsing all of them. And a passing result is always qualified by what
the check could actually see, because the library's own test suite is explicit
that a green tick on an unkeyed chain would be claiming something Chronicle does
not claim.

## What the investigation found

### The templ dashboard shows about half the library

295 non-test Go files against 13 templ pages, 2 widgets and 8 components. Here
is what the dashboard reaches, per subsystem store:

| Subsystem | Operations available | Reached by templ |
|---|---|---|
| audit | Get, Query, Aggregate, ByUser, Count, LastSequence, LastHash | Get, Query, Count |
| stream | GetStream, GetStreamByScope, ListStreams | GetStream, as a scope check inside verify |
| checkpoint | Latest, InRange, Get, List, Append, plus `Checkpointer.CheckpointStream` | none |
| erasure | GetErasure, ListErasures, CountErasures, CountBySubject, plus `Service.Erase` | GetErasure, ListErasures, CountErasures |
| retention | Save/Get/List/DeletePolicy, ListArchives, EventsOlderThan, plus `Enforcer.EnforceScope` | everything but EventsOlderThan |
| compliance | List/GetReport, SOC2, HIPAA, EUAIAct, Custom, Export | List/Get, SOC2, HIPAA, EUAIAct |

The gap is not evenly spread. Checkpoints have no surface at all, and they are
the only thing that lifts assurance above `keyed`. There is no stream list
anywhere, not even in the HTTP API, so the verify page asks an operator to
paste an ID they have no way to look up. Report export in json, csv, markdown
and html is missing, which for an auditor-facing tool is close to the point of
the product. `CountBySubject` and `EventsOlderThan` are both "show me what this
destructive action would do" calls, and neither is wired to the action it
guards.

### There is exactly one stream per app and tenant

`Chronicle.resolveStream` calls `GetStreamByScope(appID, tenantID)` and creates
a stream when there isn't one. So a scoped operator has one chain, not a list
of them. `stream.ListOpts` carries `Limit` and `Offset` and no scope at all,
which makes `ListStreams` a cross-tenant read.

This is the finding that set the information architecture. A stream picker
would be the wrong shape and a stream list would leak.

### What a failed verification can actually report

`verify.Report` is much richer than a boolean. A failure has both a location
and a kind:

| Field | What a failure means |
|---|---|
| `Gaps []uint64` | sequences absent from the store, so events were deleted from the middle |
| `Tampered []uint64` | recomputed digest differs from the stored one, or `PrevHash` does not match the previous event's `Hash` |
| `Downgrades []uint64` | the event claims a weaker digest scheme than the stream pins at that point |
| `Tolerant []uint64` | the scheme was not recorded and had to be guessed, which is a caveat and not a failure |
| `HeadMatch`, `HeadChecked` | the tail was truncated, which no internal linkage can reveal |
| `CheckpointHeadOK`, `CheckpointHeadChecked` | a signed checkpoint says the chain once reached past the claimed head |
| `Coverage []Coverage` | assurance graded per span: unkeyed, keyed, signed, anchored |
| `Checkpoints []CheckpointResult` | per checkpoint: signature, hash match, continuity, each with its own checked flag and a prose note |
| `Partial` | the caller bounded the range, so the result does not speak for the whole chain |

Two rules fall out of that table and they shape the whole verification surface.

**Every `*Checked` field is a third state.** The Go source says so directly, and
the comment on `CheckpointsChecked` is the clearest statement of it: without that
flag "an auditor cannot tell 'this stream has no checkpoints' from 'nothing
looked'". The same pairing appears on `HeadChecked`, `HashChecked`,
`ContinuityChecked` and `CheckpointHeadChecked`, and in each case the reason is
identical, which is that the false zero value of a Go bool is indistinguishable
from a real negative finding unless something else carries the distinction.
Render any of those as two states and you turn "we did not look" into "we looked
and it failed", or worse the other way round. Six fields need this on one page.

**`Valid: true` is not "untampered".** `TestPlainChainDoesNotDetectARewrite`
asserts that the default configuration passes a rewrite, deliberately and with a
comment saying so, so that anyone who later makes the plain chain detect it finds
out by breaking that test.
`TestFullStreamDowngradeIsNotDetectedWithoutSignedCheckpoints` and
`TestTruncationBeyondADeletedCheckpointIsNotDetected` pin two more blind spots in
the same style. So a result has to carry its assurance level. Without one it is
claiming something the library does not.

### The templ verify page is good and still drops three things

It renders most of `Report`, which is more than any other templ page manages.
It leaves out `HeadMatch` and `HeadChecked`, so the truncation evidence never
appears. It leaves out `Partial`, so a bounded check reads as if it spoke for
the whole chain. And it leaves out `CheckpointsChecked`, which is the exact
distinction that field exists for.

### What the event store can filter and page on

`audit.Query` and nothing else: `After`, `Before`, `AppID`, `TenantID`,
`UserID`, `Categories[]`, `Actions[]`, `Resources[]`, `Severity[]`,
`Outcome[]`, plus `Limit`, `Offset` and `Order`. It returns
`{Events, Total, HasMore}`.

That settles paging as offset, since nothing in the library offers a cursor,
and `Total` gives a real count for table captions.

The templ events page exposes three single-value filters, hard-codes `Limit: 50`
and has no paging control.

### The default deployment is at the weakest setting

`TamperEvidenceConfig.Digest` defaults to `"plain"`. `CheckpointConfig.Enabled`
defaults to false, and `buildCheckpointer` returns nothing at all when it is.
So a Chronicle deployment that nobody has configured verifies at `LevelUnkeyed`
with zero checkpoints, and the doc comment on that level is blunt about what it
buys: "Detects corruption, not tampering."

This inverts the obvious assumption about which case is common. The happy path
on a first open is not a signed chain, it is the weakest one the library
supports, and that is the case a green tick would misrepresent. For most
deployments the coverage ceiling is not a detail on the Integrity page. It is
the page's main content, because the most useful thing you can tell that
operator is what is switched off and what switching it on would buy them.

### What verification guarantees depends on the backend

Only postgres and sqlite hold a `hash.Chain`. They re-derive sequence and
`prev_hash` under a row lock inside the append transaction, and they carry
`UNIQUE(stream_id, sequence)`. Mongo stores exactly what `Chronicle.Record`
handed it, but it carries the same unique index, so a racing append from a
second replica is rejected by the database rather than forking the chain. That
is a lost audit event and a loud error, which is bad, but it is not silent
corruption.

Redis is the weak one. It neither recomputes nor constrains uniqueness, and it
returns `ErrUnsupported` for every checkpoint call, which `verify` already
treats as "no opinion". `Chronicle.lockStream` is a `sync.Mutex` held in
process, so it does nothing across replicas.

None of that blocks this migration, but it does mean a verification result
means measurably different things on different deployments, and an operator
reading the result deserves to know which one they are on. `settings.detail`
carries the backend and what it supports, alongside the digest scheme and
checkpoint configuration.

### Aggregate cannot bucket by time

`audit/aggregate.go` whitelists five group-by fields: category, action, outcome,
severity and resource. No time bucket. So event volume over time cannot be
served by one call, and a gap where nothing was recorded is itself an audit
finding. This spec adds the capability. See "Two domain additions".

## Decisions

1. Full parity with the Go layer. 29 intents. Everything the domain packages
   expose gets a surface.
2. The operator's own chain is the spine and it is singular. No stream picker.
3. `streams.list` exists for platform callers and stays off tenant nav.
4. Verification defaults to a bounded range. Whole-chain is explicit.
5. Writes are governed by capability. `AllowMutations` is not carried onto the
   contract path.
6. Offset paging throughout.
7. `verify.run`, `verify.event`, `retention.preview` and `erasures.preview` are
   queries, which needs an `enabled` option on `useQuery`.
8. Day and hour bucketing gets added to `Aggregate`.
9. The events table carries no per-row integrity column. See "Badges, and the
   column that isn't there".
10. The fixture server serves a deliberately broken chain from day one.

## The Go half

### Phase 0, the version bump

Chronicle is on `forge v1.9.13` and authsome is on `v1.11.1`.

This was written up as a gate and it is not one. Checking the module cache
rather than inferring from the version numbers, v1.9.13 already ships
`extensions/dashboard/contract` along with its `dispatcher` and `loader`
subpackages, and `RegisterQuery` has a byte-identical signature in both. So
the contract package would compile against the version chronicle already has.

Bump anyway, for a different and smaller reason. `extensions/auth` is a
separate module with its own version line, it shares types with the main
module, and running it a release behind gives you two versions of the same
types in one build. Moving both to v1.11.1 also puts chronicle on the version
authsome's contract contributor is known to work against, which is worth
having when something later misbehaves and you want one less variable.

Do it on its own commit regardless. Two minors across a 295-file module can
ripple, and finding that out with nothing else in flight is cheaper than
finding it out tangled up with a new package.

### Two domain additions

**Time bucketing on Aggregate.** `groupByColumns` and `ResolveGroupBy` gain
`day` and `hour`. `audit.AggregateGroup` gains a `Bucket string` field carrying
an RFC3339 date or hour. Four backends implement it: postgres and sqlite through
`date_trunc` and its sqlite equivalent, mongo through `$dateTrunc`, redis
through its existing scan. Each gets a test asserting that a period with no
events yields no group, because that absence is the finding the chart exists to
show.

**Nothing else.** `UpdateStreamScheme` deliberately gets no intent. Moving a
stream's digest pin happens automatically in `reconcileStreamPin` when an event
is written. Exposing it as an operator action would let somebody move a pin
without writing an event, which is the shape of the downgrade attack `verify`
exists to catch.

### The contract package

`chronicle/extension/contract/`, copying the shape of
`authsome/extension/contract/`: an embedded `manifest.yaml`, a `contract.go`
holding `Register`, and handler files split by group. Registered alongside the
existing `LocalContributor`, so both dashboards run until phase 7 removes one.

Contributor name is `chronicle`. Field names on the wire are camelCase, matching
authsome's contract DTOs rather than the Go domain's snake_case.

**Scope comes from the Principal's claims and is never read from the request.**
No request DTO in this contract carries an `appId` or `tenantId` field.
`contributor.go` already carries the comment explaining why, on policy creation:
a policy with an empty `AppID` "matches every app in the purge query", so an
unscoped policy "would delete every tenant's audit history on the next
enforcement run". The same hazard applies to reports, erasures and enforcement.

The mechanism needs stating precisely, because it is not the one the templ path
uses. Templ resolves scope from the request context through `forge.ScopeFrom`.
Nothing in the dispatcher, server or transport propagates a forge scope, so a
contract handler's context does not carry one. The convention on this path is
`Principal.Claims`, which `AppIDFromPrincipal` in authsome documents as "the
canonical surface for per-request scoping", keyed `app_id`.

So chronicle reads `app_id` from claims for `AppID`, and `tenant_id` for
`TenantID`, falling back to `org_id` for the latter.

**An unresolvable `app_id` is refused, not defaulted.** This is the single most
important line in the contract package. An empty `AppID` does not mean "this
app", it means every app belonging to every operator, and the handlers below it
will happily list another customer's audit events or purge their history. So
`scopeFromPrincipal` returns `CodePermissionDenied` when `app_id` is missing or
unparseable, and every handler calls it before touching the store.

An absent `tenant_id` is different and is allowed. The dashboard operator is
app-scoped, which is what authsome's own handlers assume in having no tenant
dimension at all, and `TenantID` is a dimension inside their own app. An empty
tenant means an app-wide view, which is the view an app operator is entitled
to. It never widens past the app, because `AppID` is already required.

**Capability is binary, and "admin" is a predicate rather than a capability.**
This was specified wrongly and is corrected here from the forge source.
`contract.Capability` has exactly two values, `read` and `write`, and
`loader.Validate` hard-enforces the pairing through `validateKindCapability`:
a query must be `read`, a command must be `write`. A manifest declaring
`capability: admin` does not degrade gracefully, it fails to load.

Finer-grained authorization is a separate field. `Intent.Requires` is a
`Predicate{All, Any, Not []string, Warden string}`, evaluated by
`Predicate.Allow` against tokens of the form `role:X`, `scope:X` or
`claim:K=V`.

So the three operations that permanently destroy audit history, which
`handler/guard.go` classifies as admin, are declared as commands with
capability `write` plus `requires: { all: [scope:chronicle.admin] }`. Those
three are `erasures.request`, `retention.deletePolicy` and
`retention.enforce`.

`all` with a single explicit scope, rather than `any` with a global admin
role alongside it. Purging a tenant's audit history should take a grant
somebody made on purpose, and accepting whoever already holds a general admin
role is the kind of quiet widening the rest of this document refuses.

### The 29 intents

`streams.mine` (query, read). No input. Returns the viewer's chain: `id`,
`headSeq`, `headHash`, `scheme`, `schemeSince`, a `latestCheckpoint` summary,
and a derived `coverageCeiling` naming the best assurance level this deployment
could report. An operator on a plain chain with no checkpoints learns before
running anything that the best answer available is "corruption, not tampering".

`streams.list` (query, read). `{limit, offset}`. Cross-tenant, platform callers
only, absent from tenant nav.

`verify.run` (query, read, lazy). `{fromSeq?, toSeq?}`. The stream resolves from
scope. Returns the full `Report` projection: `valid`, `verified`, `firstEvent`,
`lastEvent`, `headSeq`, `partial`, `gaps[]`, `tampered[]`, `downgrades[]`,
`tolerant[]`, `headMatch`, `headChecked`, `checkpointHeadOk`,
`checkpointHeadChecked`, `checkpointsChecked`, `coverage[]` and `checkpoints[]`.
Every checked flag crosses the wire. None of them is collapsed server-side.

`verify.event` (query, read, lazy). `{eventId}` onto `Chronicle.VerifyEvent`.

`checkpoints.list` (query, read). `{limit, offset}`, newest first.
`checkpoints.detail` (query, read). `{id}`.
`checkpoints.take` (command, write). Invalidates `checkpoints.list` and
`streams.mine`.

`events.list` (query, read). The whole of `audit.Query` plus `limit`, `offset`
and `order`. Returns `{events, total, hasMore}`.
`events.detail` (query, read). `{id}`.
`events.aggregate` (query, read). `{after, before, groupBy[]}`, now including
`day` and `hour`.
`events.byUser` (query, read). `{userId, after, before, limit}`, on the distinct
store method with its own `TimeRange`.

`overview.stats` (query, read). Counts and breakdowns through `Aggregate`.

`erasures.list`, `erasures.detail` (query, read).
`erasures.preview` (query, read, lazy). `{subjectId}` onto `CountBySubject`.
`erasures.request` (command, write, requires `scope:chronicle.admin`). `{subjectId, reason}`. `requestedBy` comes
from the Principal. Invalidates `erasures.list`, `overview.stats`,
`events.list`.

`retention.policies`, `retention.policyDetail` (query, read).
`retention.savePolicy` (command, write). Optional fields are pointers, because a
policy is unique per app, tenant and category, and an update that cannot tell
"leave alone" from "set empty" will silently clear `Archive`. Invalidates
`retention.policies` and `retention.policyDetail`.
`retention.deletePolicy` (command, write, requires `scope:chronicle.admin`). Invalidates `retention.policies`.
`retention.preview` (query, read, lazy). Onto `EventsOlderThan`. What
enforcement would purge, before it purges it.
`retention.enforce` (command, write, requires `scope:chronicle.admin`). Invalidates `retention.policies`,
`retention.archives`, `events.list`, `overview.stats`, `streams.mine`.
`retention.archives` (query, read).

`reports.list`, `reports.detail` (query, read).
`reports.generate` (command, write). `{type: soc2|hipaa|euaiact, period}`. The
three share an identical input shape, so they share an intent. Invalidates
`reports.list`.
`reports.generateCustom` (command, write). `CustomInput` adds `title` and
`sections[]`, so it does not. Invalidates `reports.list`.
`reports.export` (query, read, lazy). `{id, format: json|csv|markdown|html}`.

`settings.detail` (query, read). The config the templ page shows, plus the
digest scheme in force, whether checkpointing is configured, and what the
viewer's capability allows. That last group is the "can this dashboard prove
anything" panel, and it is new.

### Tests

Handler tests per group. A `manifest_test.go` asserting every registered intent
is declared in the manifest and every declared intent is registered, copied from
authsome. Scope tests proving a handler ignores a scope field in the request
body if one is ever added.

## The React half

`packages/plugin-chronicle`. `extension: "chronicle"`, `namespace: "chronicle"`.

### Information architecture

Integrity is the landing page and it is about your chain, resolved from scope
and never typed. It carries the posture that needs no chain walk: head sequence
and hash, digest scheme and the sequence it applies from, latest checkpoint and
how far behind head it sits, and the coverage ceiling. Verification runs from
there.

Nav groups: Integrity (chain, checkpoints), Log (events, search), Compliance
(reports, erasures), Retention (policies, archives), and Settings.

### The verification surface

The metaphor is a certificate of analysis, not a dashboard. What Chronicle
produces is evidence somebody puts in front of an auditor: a statement of what
was examined, by what method, over what range, what was found, and what the
method cannot see. That is a document and it reads in that order. No card grid,
because cards chop one continuous argument into unrelated tiles.

Three rules, each encoding information in structure rather than decoration.

Saturated colour means failure. The kit is near-monochrome, greys from `#ffffff`
to `#242424` with one slate accent and one muted red, and there is no success
green token. Don't add one. A passing check is entirely monochrome and red
appears only when something is wrong, which makes a bad result unmissable
without the common good result having to shout.

A badge means an opinion was formed. Checked states get badge chrome. "Not
checked" is plain `muted-foreground` text with no chrome at all, so an absence
looks like an absence. That is how the six tri-state fields stay three-state.

The verdict is a sentence, not a badge. A qualified truth is a sentence, and
`Valid: true` at `unkeyed` cannot compress into a tick without lying. The
verdict is the page's one bold element: headline scale, normal weight, with
sequence numbers in mono at the headline's own size so it reads as a finding.

Three cases the page has to get right that the templ page cannot:

- Passing on an unkeyed chain reads "No corruption detected in sequences 1 to
  12,431. This chain uses unkeyed digests: they detect accidental corruption,
  not deliberate alteration." The limits section is the loudest thing on screen.
- Passing on a bounded range reads "This check does not speak for the rest of
  the chain." `Partial` qualifies the verdict, it is not a footnote.
- No checkpoint store renders as "Not checked, this deployment stores no
  checkpoints", never as "No".
- A mixed-level chain names its boundary: "No alteration detected in sequences
  1 to 61,004. Keyed from 48,201 onward, and everything below that predates the
  key and rests on an unkeyed digest."

### A chain is not one level, and the page must not claim it is

`gradeCoverage` returns spans rather than a level, and that is the most
important thing about the shape of `Report`. A deployment that turns HMAC on
after running for a year does not rebuild its chain, since rebuilding would
invalidate every hash already written. `reconcileStreamPin` moves the stream's
pin up and stamps `SchemeSince`, so everything below that sequence stays
unkeyed forever and everything above it is keyed.

Chronicle already models that properly and the page has to carry it through.
`Event.HashScheme` records the scheme each event was written under, so
verification reproduces what was written rather than what today's config would
write. `upgradeCoverage` refuses to lift a span below the pin to `signed` even
when a checkpoint covers it, because a signature over an unkeyed digest proves
only that the digest has not changed since, not that it was ever tamper-evident.
`ErrSchemeWeakeningRefused` stops a pin moving down at all.

So the verdict never states one level for a chain that has two. It names the
boundary. The oldest events are usually the ones an investigation cares about,
and they are exactly the ones a single-level summary would misdescribe.

The same caution applies to a bounded range, and the two compound. Verifying
from the last checkpoint forward can honestly report `signed` for a window that
sits entirely above the pin while everything beneath it is unkeyed. Both
statements are true and the pair is misleading, which is why the verdict always
carries its range and its `Partial` flag alongside its level rather than any one
of the three alone.

### The span ribbon

A hash chain is strictly linear, one edge per node, which makes it a degenerate
case of the thing a graph canvas is built for. Reaching for React Flow here would
cost you a large dependency and give you a worse picture, so this is a
purpose-built positional ribbon instead. Coverage bands are the base layer.
Checkpoint boundaries are notches. Breaks are markers at their exact sequence
positions, they are focusable, and each one jumps to its row in the break table
below, which is how somebody working through a failure gets from "where" to
"what" without losing their place.

Five break kinds, each with a row and plain language: altered (`Tampered`),
missing (`Gaps`), relabelled (`Downgrades`), truncated (`HeadMatch` false), and
head contradicted by checkpoint (`CheckpointHeadOK` false).

The only motion on the page is the ribbon drawing once when a result arrives,
and it respects reduced motion.

### Verification is bounded by default

`VerifyChain` calls `EventRange(from, to)` and holds every event it fetches in
memory at once. On a chain with millions of events an unbounded walk is an
out-of-memory crash, and the templ page has that bug today: it will happily
accept an empty range on a stream large enough to take the process down with it.
So the default is a recent bounded window. That sets `Partial`, and the verdict
says so. Whole-chain stays available as an explicit choice.

This is how the library is meant to work. Bounded verification with intact
signed checkpoints is a stronger claim than an unbounded walk on an unkeyed
chain.

### The event log

Search first. `events.list` returns `total`, so captions read "50 of 12,431
events" rather than counting the rows on screen. The full filter set goes in
`FilterBar` and every filter is server-side. Filtering in the browser is the
failure mode that makes audit UIs useless at the scale that matters.

Two empty states, never one. You need both because they are completely different
answers to give somebody who came looking for a specific record:

- No filters and no rows: "This chain holds no events yet."
- Filters set and no rows: "No events match these filters", listing the active
  filters, with a clear action. An auditor who searches for a record and finds
  nothing has to be able to tell whether the record is absent or the query was
  wrong, and a single shared empty state hides exactly that distinction.

Rows virtualise through `@tanstack/react-virtual`, which is already in kit, over
server-paged windows.

### Event detail

Lazy at the route, because this is where the weight is.

```tsx
const EventDetail = lazy(() => import("./pages/event-detail"))
```

It carries a read-only CodeMirror for `Metadata`, with folding and search inside
the payload, because searching a payload is a real auditor task and it beats a
`<pre>`. CodeMirror rather than Monaco: roughly a fifth the weight for a
read-only viewer with folding and search, and the entry chunk is already 632 KB
raw.

The page also carries per-event verification and the event's position in the
chain, its sequence and `prevHash`, with a link to run a bounded chain check
around it. That is the "prove this record" path an auditor arrives on.

### Charts

Form first, colour last. The overview's four counts are a `StatGrid`, since a
magnitude with no comparison is a stat tile and not a chart. Category, severity
and outcome breakdowns are single-series horizontal bars sorted by count, in one
ink, direct-labelled. No categorical palette: identity comes from the axis
labels and position, so there are no hues to validate and nothing to fail a
colour-vision check. That is the honest answer in a system with no categorical
ramp.

Event volume over time is bars, not a line, and the reason is specific to this
brief. A line interpolates across a missing bucket and erases exactly the
finding the chart exists for.

### Kit and conventions

All five display conventions hold. Identifier values carry `font-mono text-xs`:
event ids, stream ids, hashes, sequence numbers, checkpoint ids, sign key ids.
`action` is the column an operator reads, so it carries `font-medium`. Every
caption carries a live count including at zero. `NoneCell` for absent `userId`,
`ip`, `resourceId` and `reason`. `Timestamp` for every possibly-absent time.
Badges are `outline` for normal and `secondary` for false, with `destructive`
reserved for a genuine break.

Errors inside dialogs, `reset()` on dialog open, `pending` on every
`ConfirmDialog`. Both destructive commands, `retention.enforce` and
`erasures.request`, run their preview query inside the dialog before the confirm
button does anything.

### Badges, and the column that isn't there

The playbook asks for a written mapping whenever the default one does not fit,
and it decides variant by proportion: whatever state holds most of the rows
takes `outline` whatever it means, because a filled badge on almost every row
has stopped signalling anything.

An audit log is the most skewed dataset here. Intact is not merely the majority
state, it is very nearly every row, and a break is rare by construction.

So the events table gets no integrity column at all. A column whose every cell
says the same word is a redundant column, and integrity is a property of the
chain rather than of a row: one event cannot be "verified" on its own, only its
position in a chain can be. The page states the chain's condition once, at the
top, and marks only the rows that break it. That also keeps the design honest,
since a per-row green tick would be claiming something per-row verification
does not actually establish.

The mapping for the badges that remain:

| variant | Chronicle states | why |
|---|---|---|
| `outline` | event outcome success, severity info, checkpoint signature verifies, coverage `keyed` | the ordinary state, and most rows are in it |
| `default` | coverage `signed` and `anchored` | the affirmative outcome, rare enough to stay a signal |
| `secondary` | severity warning, erased events, tolerant sequences, coverage `unkeyed` | notable but not wrong. An erasure is a lawful GDPR action, not a fault |
| `destructive` | event outcome failure or denied, severity critical, a failed checkpoint signature or continuity break | what somebody came to the page to find |

A chain break is not in that table on purpose. It is not one state among
several, it is the finding, and a red pill in a table cell is too small a device
for it. It gets the verdict sentence and the ribbon.

### The platform change

`useQuery` fires on mount and has no way to defer. Four Chronicle intents are
expensive, operator-triggered and side-effect-free, and making them commands
would misdeclare four reads as writes. So `packages/plugin` gains an options
argument with `enabled`, in its own commit with its own tests. Preview before a
destructive action is a shape that will recur in every extension.

## Sequencing

| Phase | Repo | What |
|---|---|---|
| 0 | chronicle | Bump forge to v1.11.1+. Gate on this. |
| 1 | chronicle | Time bucketing on `Aggregate`, four backends, tests. |
| 2 | chronicle | The contract package, manifest, handlers, tests. |
| 3 | forge-dashboard | `enabled` on `useQuery`. |
| 4 | forge-dashboard | `packages/plugin-chronicle`. Integrity and verification first. |
| 5 | both | Run it. Fixture server and shell, click every page. |
| 6 | chronicle | `MIGRATION.md`, while the templ pages still exist. |
| 7 | chronicle | Delete `dashboard/`. Its own commit. |

Phase 5 is not optional and it is not a formality. Every serious bug in the
authsome migration was found by running it and not by a test, and the tests were
green through all of them.

After phase 4, re-measure and write the new numbers into `BASELINE.md`. Then
check the chunk actually split by reading the `pnpm build` output instead of
assuming it did, because one stray static import of CodeMirror anywhere in the
workspace pulls the whole thing back into the eager entry and you will not notice
until an operator who never opens an event detail page waits on it.

## Retiring the templ dashboard

Phase 6 and 7, in that order, and 6 has to happen while the pages still exist.

Write `chronicle/MIGRATION.md` with every page, column, action, filter, badge
and empty state from all 13 templ pages, 2 widgets and 8 components, and do it
while you can still open the files, because after deletion there is no reference
to go back to. Mark each item migrated, deliberately dropped with a reason, or
blocked with the shape of the fix. An item nobody can account for is an item you
are deleting by accident.

Then run `grep -rn "chronicle/dashboard" --include='*.go'` across the extension.
The dashboard package exports more than pages, and removing it can break
compilation somewhere you were not looking.

Finally `go build ./... && go test ./...` with the directory gone, not a partial
run, and delete it as its own commit.

### Already known for `MIGRATION.md`

**Deliberately dropped.** `Config.AllowMutations`, which exists because templ
pages render through a route Chronicle cannot authenticate; the contract path
has a Principal and capability guards, so the flag goes when templ does. The
settings panel duplicate: `RenderSettings("chronicle-config")` and
`RenderPage("/settings")` return the identical component, so one of them is not
a feature. `UpdateStreamScheme`, for the reason under "Two domain additions".

**Blocked on Go work.** A before-and-after diff view for events, because
`audit.Event` has no such representation and `Metadata` is freeform; building
one would mean inventing a metadata convention the library does not have.
External anchoring, because `LevelAnchored` is in the enum and nothing emits it;
the coverage ladder renders it as an unreached level rather than pretending it
does not exist.

Also deliberately not exposed: `compliance.ReportStore.DeleteReport`. Deleting
compliance evidence shouldn't be one click in a dashboard, and neither the HTTP
API nor the templ dashboard ever offered it, so record it as a choice and not
an oversight. `erasures.request` is held until the library scopes its keys (see
the amendments below). The templ dashboard never offered an erasure request
either, so nothing regresses.

**Bugs the templ dashboard had, closed by the migration.** Record these as
fixed in passing, so nobody reads their absence as a lost feature:

- `renderErasureDetail` did no scope check at all, unlike every other detail
  renderer in `contributor.go`. `erasures.detail` checks ownership.
- Detail pages let a tenant viewer open app-level records by ID that its own
  lists hid. Strict ownership closes that.
- The retention page fired enforcement from a bare query-param link, with no
  preview and no confirmation, and it accepted any duration including zero.
- On every sqlite deployment the overview's critical and failed counts read 0,
  because a filter error was swallowed as a zero count.

**New, not migrated.** Checkpoints as a surface, the coverage ceiling, both
destructive-action previews, report export, custom reports, per-event
verification, aggregation, by-user, and the three `Report` fields the templ
verify page drops.

## Amendments from implementation

Everything above is the design as approved. This section records where
building Plan A changed it, taken from the code and its reviews rather than
from intent. Where this section and the text above disagree, this section is
right. Plan B is written against it.

**Scope rules, tightened.** A tenant claim that is present with an empty, nil
or non-string value is refused, not widened. Only a claim missing from the map
reads as an app-wide operator, since an empty value means an upstream wrote a
tenant and its value was lost. If either `tenant_id` or `org_id` is present
and unusable, the request is refused even when the other is good.

**A tenant operator does not own app-level records.** An app-wide viewer owns
everything in its app, including records with no tenant. A tenant viewer owns
a record only if its tenant matches exactly. The earlier rule let a tenant
viewer open an app-level record by ID while every list hid it, which is an
inconsistency the templ dashboard had too. Detail handlers answer not-found on
an ownership failure, so nobody can probe which IDs exist in other tenants.

**`streams.list` is scoped to the viewer**, not cross-tenant. A tenant viewer
gets its one chain directly. An app-wide viewer gets every tenant chain in its
own app. A genuinely cross-tenant platform list would need a platform-scope
predicate that nobody has defined.

**The coverage ceiling follows the verifier.** A checkpointed plain chain
verifies as `signed`, because an attacker can recompute plain digests but
cannot re-sign a checkpoint, so the checkpoint still proves the range up to it
was not rewritten. chronicle's own `TestIntactCheckpointedChainReportsSigned`
asserts this. The ceiling is capped at `unkeyed` when the head sits below the
scheme pin, which covers an empty stream and a pin move with no append since.

**Coverage describes the pin, not what verified.** A span whose every event is
a downgrade still grades `keyed`, because coverage is computed from the
stream's pin. The page must never render coverage on its own. It always sits
beside `valid` and `downgrades`, and a failed result outranks the level.

**`verify.run` caps its span at 100,000 events per call.** Verification holds
every event in the range in memory at once, so without a cap one read-capable
request could crash the process. Over the cap is a bad request naming the cap
and the chain head, and the page offers a bounded window. A reversed range is
refused only when the caller supplied it explicitly. A chain wiped to head
zero still runs, because that is exactly the case where a surviving signed
checkpoint contradicting the head is the evidence.

**`verify.event` returns `{valid, hashScheme, keyed}` and nothing more.** The
library returns a bare boolean and checks only the event's own digest against
its claimed predecessor, not its place in the chain. On an unkeyed chain
somebody who rewrites an event can recompute its digest, so `valid` there does
not rule out a rewrite. A downgrade shows up only as `valid: false`, looking
the same as edited content. The page says both, and links to a chain check
around the event.

**`valid: true` with `verified: 0` is not a pass.** On a deployment without
checkpoints, a chain wiped to head zero verifies as valid, with nothing
verified and every checked flag false. That is the library's rule that an
empty stream is vacuously valid, and it is legitimate, since a stream sits at
head zero before its first event. The page renders it as "no events
verified", with the ceiling beside it, and never as a pass. With checkpoints
the same wipe is caught, because a surviving signed checkpoint contradicts the
head.

**Never cache a verification result on the client.** A verdict cached by range
keeps saying valid after a row is rewritten. `verify.run` and `verify.event`
are queries because they have no side effects, not because their answers
last.

**`erasures.request` is held out of the dashboard.** Rex's decision, after a
probe confirmed that an erasure destroys other apps' and tenants' data.
`crypto.KeyStore` is keyed by subject ID alone, so every scope using the same
subject ID shares one key, and `erasure.Service.Erase` deletes it unscoped
while scoping everything else. Erasing `user-42` in one app made another app's
event for `user-42` read `[ERASED]`, with `Erased` false, no erasure ID and no
erasure record in its own scope. The list, detail and preview intents ship.
The command returns once the library scopes its keys, which puts the manifest
at 28 intents instead of 29.

**Not every `[ERASED]` has an erasure behind it.** Until that fix lands, and on
any data written before it, an event can read `[ERASED]` with `Erased` false
and no `ErasureID`. That is the victim side of the bug above. The page renders
it as destroyed with no recorded erasure in this scope, and never implies an
erasure was requested here.

**Found in the library while building, fixed or raised separately:**
three of the four production backends had no tests; the redis backend lets
two tenants share one hash chain when their IDs contain a colon; sqlite
compares timestamps as strings, so a time-range search can drop or include
events within a second of its edges; and a sqlite store wired directly,
outside the extension, silently writes plain digests under an HMAC
configuration, caught only when verification later reports every event as a
downgrade; and a GDPR erasure in one scope destroys every other scope's data
for the same subject ID, because encryption keys are keyed by subject alone.

### Changed by the final review

"Your chain, singular" holds for a tenant viewer and nobody else. An app-wide
operator has one chain per tenant in the app, and before this change they could
list those chains but not verify or checkpoint any of them. Verify told them
they had no chain while the event log showed events. `verify.run`,
`checkpoints.list`, `checkpoints.take` and `streams.mine` now take an optional
`streamId`. Leave it empty and you get the viewer's own scope, as before. Pass
one and the contract fetches that stream, checks the viewer owns it under the
strict rule, and then re-resolves it by its own scope so the redis collision
guard still runs. A tenant viewer can only ever select its own chain, and a
foreign or garbled ID is not-found. Everything downstream uses the selected
chain's scope, including the retention-policy count. `checkpoints.detail`
re-resolves the stream from the checkpoint's own scope, which is how
`verify.event` already worked. For Plan B, the verify page for an app-wide
operator starts from `streams.list` and passes the chosen chain's ID.

A tenant viewer used to get contradictory retention answers. Verify said one
policy could purge the chain, and the policy list and preview both said none,
because the purging policy was app-level. `retention.policies` now returns the
app-level policies that govern the tenant as well, each row carrying
`editable`, which is false for those. `retention.policyDetail` opens a
governing row too, also with `editable` false, so a row you can see in the list
never answers not-found when you click it. Saving or deleting one is still
not-found for a tenant viewer. `retention.preview` still counts only what
`retention.enforce` would purge for this viewer, since enforce runs the
viewer's own policies, and adds `governingAppPolicies` so the dialog can say
the scheduler also purges this tenant under app-level policies.

`failedEvents` counts `failure` outcomes only, on the overview and on reports
alike. Before, the overview counted failures plus denials, and the same key
disagreed between two pages for the same data. `deniedEvents` is separate, and
the page adds the two for its "failed or denied" tile.

`reports.generate`, `reports.generateCustom` and `checkpoints.take` require
`scope:chronicle.write` or `scope:chronicle.admin`. Without that, any read-only
viewer could store reports and checkpoints under their own name. The custom
report's title is capped at 200 characters. Each section's title is capped at
200, its notes at 4,000, each filter list at 50 values and each value at 128. Every command in the manifest now has a `requires`, and a test
enforces it.

A report's embedded verification carries `retentionPolicies: -1`, meaning
unknown, since nothing on the report path counts policies. Zero would claim
that no policy can purge the chain.

If `tenant_id` and `org_id` are both present and disagree, the request is
refused. Before, `tenant_id` silently won.

Every list pages the same way now. A negative limit or offset is a bad
request, zero means the default, and each list documents its own maximum (200
for streams and checkpoints, 1,000 for the rest).

### Running before authsome sends claims

Nothing populates claims today, so without configuration every intent is
denied. A single-app deployment can set `chronicle.dashboard.app_id`, and
optionally `chronicle.dashboard.tenant_id`, and the dashboard works now. This
is the same shape Warden uses. Each dimension resolves on its own: a claim
that's present and readable wins, a claim that's present but unreadable is
refused and never falls back to the config, and only an absent claim takes the
configured value. The tenant counts as absent only when both `tenant_id` and
`org_id` are missing. The configured tenant applies only inside the configured
app, so a session whose claim names a different app is never narrowed to a
tenant from somebody else's app. A tenant with no app is refused at startup,
and so is a value with edge whitespace or control characters. The two
settings are one unit: if YAML sets either of them, YAML's whole section wins,
so a tenant from code never ends up paired with an app from YAML. A request
with no signed-in user is refused before any claim or setting is read. A tenant
claim that arrives without an app claim is refused too, because an upstream
that wrote the tenant and lost the app has failed to resolve the scope.

### What authsome has to produce

When authsome starts filling claims in, these shapes decide whether the
contract is safe:

- An org-bound user must always carry `org_id`. The contract treats a missing
  tenant key as an app-wide operator, so a user whose org claim is only written
  while an org is selected would see every tenant in the app the moment they
  deselect it. The safer alternative is to make app-wide access an explicit
  grant.
- Scopes have to be resolved for the active app only, and switching apps has to
  check membership. `scope:chronicle.admin` matches a flat list of scopes, while
  `app_id` follows the app switcher, so an admin in one app who can switch into
  another would carry admin there too.
- The environment dimension needs settling before anything is wired. Neither
  forge's scope nor chronicle has one, so if authsome's `app_id` is per app and
  sessions are per environment, an operator scoped to one environment reads
  every environment's audit log.
- `app_id` travels with every tenant claim. A session carrying `org_id` or
  `tenant_id` without `app_id` is refused, even in a deployment with
  `chronicle.dashboard.app_id` set, and there's no setting that works around
  it. If authsome sends `org_id` alone, every org-bound user is locked out
  while app-wide operators get in.
- A request with no signed-in user answers UNAUTHENTICATED, not
  PERMISSION_DENIED. forge sends it as an HTTP 500 with the code in the body,
  so the dashboard client neither retries it nor redirects to login.
- Claims are plain non-empty strings, and "no org" means the key is absent.
  `"org_id": null` locks out every app-wide operator, and a typed ID or a
  padded string fails closed.
- The write and admin scopes are matched as the bare names `chronicle.write`
  and `chronicle.admin`.

### What the React plugin has to get right

These came out of the Plan A reviews. In each case the contract gives an honest
answer that a careless page could still turn into a misleading one.

- `retention.enforce` can come back with `failed: true` and non-zero purged
  counts. That's a run that stopped part-way, so render it that way, never as
  success. `moreRemain` means "run it again".
- When `verify.run` reports `retentionPolicies` above zero, the verdict has to
  say that gaps and tampered sequences may be authorised retention purges,
  which chronicle can't currently tell apart from deletion. A value of -1 means
  nobody knows, and the page says unknown. The enforce confirm dialog says the
  same thing from the other side: once you enforce, verification will report
  the purged events as gaps and the events after them as tampered.
- Preview counts are "eligible", not "will be deleted". One enforce pass purges
  at most 5,000 events per policy, while the preview counts up to 10,000.
- A category of `*` means every category. It isn't a default, and a short
  wildcard overrides a longer specific policy for its category. The policy page
  spells that out.
- A policy an app-wide operator saves has no tenant, and it purges every tenant
  in the app. The save form and the policy row both say so.
- A report whose verification is null says "this report contains no integrity
  verification". Don't drop the section silently. Today that's every report,
  because the library never fills the field in.
- The HTML export goes out as a download or inside a sandboxed iframe, never
  injected into the page. `html/template` already escapes it; this is defence in
  depth.
- The markdown export doesn't escape event fields, so a `|` in an action or a
  resource breaks the table, and markup in one gets rendered. Offer it as a
  download or show it as plain text. Never render it as markdown.

Plan B also has a precondition that has nothing to do with the contract.
forge-dashboard's HEAD doesn't build on its own, because the working tree
imports files that were never committed (two fixture-server modules and four kit
components, one of which `plugin-authsome` needs for its brand mark). A worktree
cut from HEAD would be a broken checkout. Either that foundation gets committed
before Plan B starts, or Plan B runs in the shared tree and lives with the risk
of colliding with the other sessions working there.

## Testing

Per package: `test`, `typecheck` and `lint` clean, and `pnpm -r test` across the
workspace. Scoping to one package has twice let a stale assertion elsewhere sit
for days.

Don't read a source file from a test with `node:fs`. A plugin package's tsconfig
carries no Node types, so a test that does it passes vitest and fails typecheck,
and you will only see it when the build runs. Use `import.meta.glob` with
`{ query: "?raw", eager: true }`.

Stub failure paths with a throwing `ContractError` and not a resolving
`{ ok: false }`. `execute()` resolves `undefined` only when the client throws, so
a failure test built on a resolving stub passes without ever running the failure
path it was written for.

The verification surface gets tests for all three of the tri-state renderings,
not two: checked and passing, checked and failing, and not checked. A test that
only covers two of them cannot catch the bug this whole design exists to avoid.

### The fixture needs a broken chain

Build one into the fixture server from the start, alongside an intact one. A
fixture whose chain always verifies cannot demonstrate the single surface this
dashboard exists for, and you would be reasoning about the failure path instead
of looking at it.

Seed at least four conditions, because they render differently and three of them
are easy to get wrong: an intact keyed chain with signed checkpoints, an intact
plain chain with no checkpoints (the default deployment, where a pass must not
read as a pass), a chain with a gap and a tampered event in a known range, and a
truncated chain whose surviving checkpoint contradicts its head. That last one is
the only way to see `CheckpointHeadOK` render at all.
