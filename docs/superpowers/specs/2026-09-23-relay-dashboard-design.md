# Relay dashboard on the React shell

**Date:** 2026-09-23

**Status:** Approved in conversation, pending written review

## Goal

Move Relay's dashboard off server-rendered templ and onto the React shell, as
`packages/plugin-relay` in forge-dashboard reading a new contract contributor
in the relay repo. When it is done, the templ dashboard is deleted, not left
running alongside.

Relay is the webhook delivery engine. Endpoints subscribe to event types with
glob patterns, events fan out to matching endpoints, deliveries retry on a
backoff schedule, and whatever never succeeds lands in a dead letter queue you
can replay from.

## Where this starts

Relay implements `contributor.LocalContributor` and renders templ. There is no
contract contributor, no intents, no envelope, so a React plugin has nothing to
call. The Go contract comes first and everything else waits on it.

Read `packages/plugin/PLAYBOOK.md` before working on this. It is the method,
and it names the mistakes that shipped during the authsome migration.

## What the domain can actually do

The templ pages are a checklist of what exists. They are not the feature list,
and in three places they are actively misleading.

### There is no delivery log

`delivery.Store` has no global list. It has `ListByEndpoint(epID, opts)` and
`ListByEvent(evtID)`, and `ListOpts` is `{Offset, Limit, State}`. That is every
filter: no time range, no status code, no event type, no tenant, no search, and
no count beyond `CountPending()`.

`dashboard/contributor.go:renderDeliveries` fakes a global list by looping
endpoints and concatenating until it has fifty, which means each store call
sorts `created_at DESC` on its own and the page you end up looking at is
per-endpoint-sorted and then appended, so a delivery that failed two minutes
ago on the fourth endpoint sits below an hour-old success on the first. The
recent-deliveries widget is worse. It is not sorted by recency at all, just
whatever the first few endpoints happened to return.

So the page you live in is the one page the domain cannot serve.

### A delivery has no attempt history

There is no attempts table. Five tables, and `relay_deliveries` carries
`attempt_count` plus four `last_*` columns that `delivery/engine.go` overwrites
on every attempt. Attempt three's status code destroys attempt two's.

### Replay is not idempotent and every backend disagrees

`dlq.Service.Replay` delegates straight to the store. Each one reads the entry,
enqueues a new delivery, and removes the entry, with no transaction and no
idempotency key. Two concurrent replays both read and both enqueue, and the
receiver gets the webhook twice.

The backends then diverge on what a replayed delivery is:

| Backend | `MaxAttempts` on the new delivery | DLQ row | `ReplayedAt` |
|---|---|---|---|
| postgres, sqlite, redis | 0, never set | deleted | never written |
| mongo | `entry.AttemptCount` | deleted | never written |
| memory | 5, hardcoded | kept | written |

`MaxAttempts: 0` means `retrier.retryOrDLQ` evaluates `1 < 0` and returns
`DLQ`, so on postgres a replayed delivery gets exactly one attempt and goes
straight back to the dead letter queue you just replayed it out of, which is
the opposite of what anybody clicking replay expects and it happens silently.
No retries at all. And the templ DLQ table's "Replayed" column is permanently
a dash on every real backend, because nothing outside the in-memory store
writes `replayed_at`.

### Capabilities the templ dashboard never surfaced

- `endpoint.Store.Resolve(tenant, eventType)` answers which endpoints an event
  would actually reach.
- `catalog.MatchTypes(pattern)` tells you what a glob matches, which is what
  the endpoint create form asks for blind today.
- `catalog.WebhookDefinition` carries `Schema`, `Example`, `SchemaVersion` and
  `Group`.
- `relay.Send` can publish an event, so you can test the whole path.
- Endpoint update and delete do not exist in templ at all. Only create.
- `dlq.Purge` and `catalog.DeleteType` are unexposed.

## Decisions

- Add the Go domain work rather than designing around the gaps. A delivery log
  you cannot filter and a retry sequence you cannot see are the two things this
  dashboard is for.
- Fix replay's divergence as part of this. The confirm dialog has to say what
  will happen, and right now that answer depends on which store you deployed.
- Cursor paging on the three lists that grow without bound: deliveries, events,
  DLQ. No paging on endpoints and event types, which stay small. Cursor and
  page numbers in one dashboard costs a translation layer, so this uses one.
- Write attempts synchronously in the delivery path. It already makes an
  outbound HTTP call, so one insert is noise, and going async only buys a way
  to lose attempts.
- Denormalise `event_type` and `tenant_id` onto the delivery row. They live on
  events and endpoints today, SQL backends could join, and redis cannot.
- Keep the DLQ row after a replay and mark it. The dead letter queue becomes a
  log with a replayed marker instead of a queue that empties, which is what the
  unused `replayed_at` column was always reaching for. It also makes replay
  idempotent, because a marked row can be refused on a second call instead of
  having already vanished.
- Take one surface end to end before going wide. Endpoints first, because it
  needs no domain change.
- Delete `relay/dashboard/` at the end, in its own commit.

## Sequence

Endpoints go end to end first: contract skeleton, manifest, five endpoint
intents, the React package, one page, fixture server, and then run it. That
proves the join key, the envelope and `invalidates` while only five handlers
are exposed to a wrong assumption, which is a much cheaper place to discover
that the contributor name is wrong than twenty intents later. Everything
learned from authsome says the tests stay green while the pages are broken, so
the point is to look at it early.

After that the work goes in layers, riskiest domain change in the middle rather
than first:

1. Endpoints, end to end.
2. Go domain: `ListDeliveries`, the attempts table, the replay fix, across all
   five backends.
3. The rest of the contract, roughly twenty intents.
4. The rest of the React pages.
5. Retire templ.

## The Go domain

### Attempts

```go
type Attempt struct {
    ID            id.ID      `json:"id"`
    DeliveryID    id.ID      `json:"delivery_id"`
    AttemptNum    int        `json:"attempt_num"`
    StatusCode    int        `json:"status_code,omitempty"`
    Error         string     `json:"error,omitempty"`
    Response      string     `json:"response,omitempty"`
    LatencyMs     int        `json:"latency_ms"`
    Outcome       Outcome    `json:"outcome"`
    NextAttemptAt *time.Time `json:"next_attempt_at,omitempty"`
    AttemptedAt   time.Time  `json:"attempted_at"`
}
```

`Outcome` is the `Decision` enum from `delivery/retrier.go` persisted:
`delivered`, `retry`, `dlq`, `endpoint_disabled`. It is the field that makes
the detail page worth building, because without it you can render a run of
failures but you cannot tell somebody which one was the give-up, or that
attempt four stopped because the receiver returned 410 and disabled the
endpoint rather than because the retry budget ran out. Those are three
different problems and they have three different fixes.

`NextAttemptAt` is set only when `Outcome` is `retry`.

The store gets `RecordAttempt`, `ListAttempts(delID)` and
`PurgeAttempts(before)`. Listing is unpaged because the row count is bounded by
`max_attempts`. The write goes in `delivery/engine.go`, inside the switch that
already knows the decision, next to the existing `UpdateDelivery`.

An attempts table grows without limit, so `PurgeAttempts` is a sibling of
`dlq.Purge` and not an afterthought.

### Listing deliveries

`ListDeliveries(ctx, opts)`, with `ListOpts` growing to `{Cursor, Limit, State,
EndpointID, EventID, EventType, TenantID, StatusClass, From, To}`.

`StatusClass` filters on the delivery's `last_status_code` by hundreds: `2xx`,
`4xx`, `5xx`, plus `none` for the zero that a connection error or a timeout
leaves behind. Zero is not an HTTP status and it is the most common value you
see on an endpoint that has gone away, so it gets its own name rather than
falling quietly into one of the other buckets. Every field is optional, and a
call with none of them set returns the whole log newest first.

Postgres, sqlite, mongo and memory serve all of it. Redis does not, and
pretending otherwise would hand you a filter that silently returns the wrong
page. It indexes deliveries by endpoint, by event and by pending, so it needs a
new global time-ordered set before it can list anything at all, and even with
that it can only serve `EndpointID`, `EventID`, `State` and the time range from
its indexes, leaving the rest to a best-effort pass over the scan window. You
get told about that limit where you pick a backend.

### Replay

One shared implementation of the semantics instead of five: take `MaxAttempts`
from `config.MaxRetries`, write `ReplayedAt`, keep the row, and refuse a second
replay of a row already marked.

## The contract

Contributor `relay`, matching `extension.ExtensionName`. Get this wrong and the
plugin is hidden with nothing logged anywhere, because that is what an
uninstalled extension looks like. Capabilities `relay.read` and `relay.write`.

Twenty-five intents, fourteen queries and eleven commands.

### Catalog

`eventTypes.list` (group, includeDeprecated), `eventTypes.detail`
(by name, carrying schema, example, schemaVersion, version, group),
`eventTypes.match` (glob in, matching types out). Commands
`eventTypes.register`, an upsert because `catalog.RegisterType` already is one,
and `eventTypes.deprecate`. Both invalidate `eventTypes.list` and
`eventTypes.detail`.

### Endpoints

`endpoints.list` (tenantId, enabled, unpaged),
`endpoints.detail`, `endpoints.resolve`. Commands `endpoints.create`,
`endpoints.update`, `endpoints.delete`, `endpoints.setEnabled` and
`endpoints.rotateSecret`. The first three invalidate `endpoints.list`, and the
last two invalidate both `endpoints.list` and `endpoints.detail`.

`endpoints.update` takes pointer fields and writes the store directly instead
of calling `endpoint.Service.Update`. That method guards every field with
`if in.X != ""` and cannot clear a description or a header map, so routing
through it would quietly keep values you cleared.

`endpoints.rotateSecret` returns the secret once, in a response type that says so.
`Endpoint.Secret` is already `json:"-"`, so no read path can repeat it.

### Events

`events.list` (type, from, to, cursor), `events.detail` with its
deliveries, `events.send`. Sending goes through `relay.Send`, so it validates
against the type's JSON Schema on the way, and it invalidates `events.list`,
`deliveries.list` and `overview.stats`.

### Deliveries

`deliveries.list` with the full filter set above, and
`deliveries.detail` returning the delivery with its attempts inline. Attempts
are bounded, so a second round trip buys nothing. No commands. A delivery is
not something you edit, and re-sending one is what replay is for.

### Dead letter queue

`dlq.list` (cursor, tenantId, endpointId, from, to, replayed),
`dlq.detail`. Commands `dlq.replay`, `dlq.replayBulk` and `dlq.purge`, all
three invalidating
`dlq.list`, `dlq.detail`, `deliveries.list` and `overview.stats`, because a
replay creates a delivery and moves two counters.

### Overview and settings

`overview.stats` for the four counters, and
`settings.config` read-only. `relay.Config` is built at boot with no setter, so
a settings write intent would be a lie.

Field names come from the Go struct JSON tags, not from this document.

### Left out on purpose

`signature.preview` would return the expected signature header so you can debug
a receiver that rejects one. It is the only intent that derives a value from a
signing secret and it is left out. Rotate the secret and test directly.

Delivery-health charts need a time-series aggregation the domain does not have.
That is separate work, recorded in `relay/MIGRATION.md`.

## The React plugin

`packages/plugin-relay`, extension `relay`, namespace `relay`. Pages are plain
components, no react-router dependency, route params arrive as a `params` prop,
and links go through `PluginLink` with scope-relative paths.

### Status vocabulary

The domain has three states, not four. There is no `exhausted`, because
`failed` already means retries ran out, and the distinction lives in an
attempt's `Outcome`.

The playbook's fifth convention is `outline` for normal and `secondary` for
false, which is a binary and cannot carry this. So all four badge variants get
mapped, and colour alone is the scan signal:

| Shown as | Condition | Variant |
|---|---|---|
| Delivered | `state == delivered` | `outline` |
| Queued | `state == pending`, no attempts | `secondary` |
| Retrying | `state == pending`, one or more attempts | `default` |
| Failed | `state == failed` | `destructive` |

`destructive` is rare and it is what you are looking for at 2am.

### The delivery log

Cursor-paged and virtualised with `@tanstack/react-virtual`, which is already
in kit. Not `ResourceTable` with page numbers: `PaginationState` wants a
`total` this domain cannot cheaply produce, and page numbers mean nothing on an
append-mostly log.

Filters lead the page rather than decorating it. You arrive holding an
identifier, or a time and a type, so the bar opens with those.

Playbook conventions hold: identifiers in `font-mono text-xs`, the column you
read in `font-medium`, a live count on the caption including at zero rows, and
`NoneCell` or `Timestamp` wherever a value can be absent.

### The retry sequence

A vertical timeline, one node per attempt. Not a nested table.

The data argues for it. A table forces a multi-line JSON response body into a
cell it does not fit, and it has nowhere at all to put the thing that happened
between two attempts, which on a backoff schedule running from five seconds out
to two hours is most of what you want to know when you are working out whether
a receiver was down or just slow. The timeline has somewhere to put it. The
connector between two nodes carries the gap, so `RetrySchedule` stops being a
config value and becomes something you can see, and each node expands to hold
its own response body.

The terminal node reads differently from the rest and says why it stopped.
"Gave up after 5 attempts", or "Receiver returned 410 Gone, endpoint disabled",
or "Client error, not retried". This is where `Outcome` earns its place.

This lives in `plugin-relay` for now. If a second extension needs a timeline of
timed outcomes it moves to kit then, not before.

### Reading structured data

CodeMirror, read-only, with folding and search. Not Monaco: read-only JSON is
CodeMirror's sweet spot and it is an order of magnitude smaller, which matters
when `BASELINE.md` records the shell at 632.69 KB raw and 187.64 KB gzip with
nothing lazy.

Lazy at the route. `PluginHost` wraps every page in `Suspense`, so a lazy
element is legal and shows a spinner where the page goes. One chunk covers the
four places structured data appears: delivery response bodies, event payloads,
DLQ payloads, and an event type's JSON Schema and example.

Two obligations that come with it. Confirm the chunk actually splits in
`pnpm build` output, because one stray static import anywhere pulls it back
into the entry. Then write the new numbers into `BASELINE.md`.

### Replay

`ConfirmDialog` with `pending` bound to the command, every time. It does not
debounce, and without it a double-click sends twice.

The error renders inside the dialog. Base UI marks everything outside an open
dialog inert and `aria-hidden`, so an error on the page body is invisible to
the person who caused it. If a test needs `hidden: true` to find something, the
markup is wrong and not the test.

The copy names the consequence instead of hedging it: "Relay will send this
event to `<url>` again now. The receiver gets a real webhook and cannot tell it
apart from the original." The button says Replay, and the toast that follows
says Replayed, because an action that changes its name halfway through a flow
makes you wonder whether it was the same action.

`replayBulk` is sharper and templ handled it worst: one "replay all" link, no
confirmation, a hardcoded 365-day window. The React version shows the matched
count before you confirm and makes the window explicit. That is a deliberate
behaviour change and it goes in `MIGRATION.md` as one.

## Retiring templ

The migration is not finished when the React pages work. It is finished when
`relay/dashboard/` is gone.

`relay/MIGRATION.md` gets written as the work happens, not reconstructed at the
end, because once the directory is gone there is no reference left and whatever
you failed to write down is a feature you deleted by accident. Every page,
every column, every action, every filter, every badge and every empty state,
each one accounted for as migrated, dropped with a reason, or blocked on work
nobody has done.

Some are already known. The DLQ table's "Replayed" column never shows anything
on a real backend. The deliveries page's cross-endpoint fan-out is wrong rather
than limited. The overview's recent-deliveries list is not sorted by recency.

Before deleting: grep for other importers of the dashboard package, since it
exports widgets and a manifest as well as pages, then confirm `go build ./...`
and `go test ./...` pass with it gone. The delete is its own commit. A commit
that adds a contract, adds a React plugin and removes several thousand lines of
templ is one nobody can review or revert.

If a page turns out to have no contract equivalent and no way to build one, it
does not get deleted and it does not get quietly dropped. It gets recorded and
reported.

## Testing

Per package, `test`, `typecheck` and `lint` clean, and `pnpm -r test` across
the workspace. Scoping to one package has twice let a stale assertion in
another sit for days.

A plugin package's tsconfig carries no Node types, so a test importing
`node:fs` passes vitest and fails typecheck. Use `import.meta.glob` with
`{ query: "?raw", eager: true }` instead. Run both, because only `tsc` sees the
barrel, and a renamed export breaks the build while every test stays green.

Watch for the failure test that never runs the failure path. `execute()`
resolves `undefined` only when the client throws a `ContractError`. A stub
answering `{ ok: false }` resolves normally.

On the Go side the replay change needs a test per backend asserting the same
semantics, since that divergence is what this is fixing.

Then run it. Start the fixture server and the shell and click through. Every
serious bug in the authsome migration was found that way and not by a test.
