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

### Phase 0, the version gate

Chronicle is on `forge v1.9.13`. Authsome is on `v1.11.1`, and
`extensions/dashboard/contract` lives in the main forge module, so you cannot
import the dispatcher or the loader until chronicle catches up. Bump it to
v1.11.1 or later before anything else. Two minors is enough to ripple through a
295-file module, and if it does, you want to find that out on its own commit
with nothing else in flight rather than tangled up with a new contract package.

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

**Capability follows `handler/guard.go`.** That file already classifies the HTTP
API into read, write and admin, and the contract uses the same split. Erasure
requests, policy deletion and retention enforcement are admin. Policy save,
checkpoint take and report generation are write. Everything else is read.

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
`erasures.request` (command, admin). `{subjectId, reason}`. `requestedBy` comes
from the Principal. Invalidates `erasures.list`, `overview.stats`,
`events.list`.

`retention.policies`, `retention.policyDetail` (query, read).
`retention.savePolicy` (command, write). Optional fields are pointers, because a
policy is unique per app, tenant and category, and an update that cannot tell
"leave alone" from "set empty" will silently clear `Archive`. Invalidates
`retention.policies` and `retention.policyDetail`.
`retention.deletePolicy` (command, admin). Invalidates `retention.policies`.
`retention.preview` (query, read, lazy). Onto `EventsOlderThan`. What
enforcement would purge, before it purges it.
`retention.enforce` (command, admin). Invalidates `retention.policies`,
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

**New, not migrated.** Checkpoints as a surface, the coverage ceiling, both
destructive-action previews, report export, custom reports, per-event
verification, aggregation, by-user, and the three `Report` fields the templ
verify page drops.

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
