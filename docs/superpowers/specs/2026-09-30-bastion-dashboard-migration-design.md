# Bastion dashboard: Go-rendered pages to React shell

Design for moving the Bastion gateway's dashboard onto the React shell, across
two repositories.

- Go: `/Users/rexraphael/Work/xraph/forgery/bastion`
- React: `forge-dashboard`, as a new `packages/plugin-bastion`

The method is `packages/plugin/PLAYBOOK.md`, including its closing section on
retiring the old dashboard.

## What this is for

Bastion is an API gateway: routes match requests and proxy them to upstream
targets, with load balancing, circuit breakers, health checks, rate limits and
caching, and it can pick routes up automatically through FARP and service
discovery. Its dashboard today is nine pages, three widgets and one settings
panel, rendered server-side through `contributor.LocalContributor`. The React
shell cannot consume that.

An operator opens a gateway dashboard to answer three things. Is traffic
getting through, and where is it failing? Which upstreams are down or tripped?
What does this route actually do, and can I change it? The old dashboard
answers the first badly (half its numbers are always zero), the second not at
all (every circuit reads "closed"), and the third read-only.

Success is: every page, widget and field of the old dashboard is migrated or
recorded in `bastion/MIGRATION.md` as dropped or blocked, the operator actions
the admin API already supports are reachable from the React plugin, every
number on screen is one bastion actually measures, and `bastion/dashboard/` no
longer exists.

Scope was set with Rex on 2026-09-30: parity plus operator actions, no live
streaming, and dead stats fixed in Go before any page shows them.

## What the investigation found

Read from the Go source at bastion `402b218`, not inferred. File references are
relative to the bastion repo.

### There is no templ in the templ dashboard

`dashboard/` holds no `.templ` files. Every page is HTML built with
`fmt.Sprintf` and wrapped in `templ.ComponentFunc`, and nothing is escaped.
Route paths, service names, versions, addresses and upstream spec errors go
into the markup raw. FARP push registration (`/_farp/v1/register`) has no auth,
so anyone who can reach the gateway can store markup that the dashboard renders
for an operator. Deleting the directory closes that. `github.com/a-h/templ` is
imported only by `dashboard/contributor.go` and leaves `go.mod` with it.

### Half the numbers are never recorded

`StatsCollector.Snapshot` (`proxy/engine.go:65-109`) never sets
`AvgLatencyMs`, `P99LatencyMs`, `RequestsPerSec`, `ActiveConns`,
`ActiveWSConns` or `ActiveSSEConns`. Per-route latency, cache and rate-limit
counters are never incremented. `RecordCacheHit`, `RecordCacheMiss` and
`RecordRetryAttempt` have no callers, so the overview's cache hit rate is 0%
on every deployment and the stats widget's latency is always 0.0ms.

`Uptime` counts from the collector's construction at Register, not from Start.
`HealthyUpstreams` and `TotalUpstreams` count per-route target entries, so a
target shared by two routes counts twice. `RouteStats` for deleted routes are
never removed.

### Every circuit reads "closed"

`Target.CircuitState` is never assigned anywhere. The Circuits page prints
"closed" when it is empty, which is always, and the load balancer's
`CircuitState != CircuitOpen` filter (`routing/load_balancer.go:32`) is a
no-op. The real state lives in `resilience.CircuitBreaker`, behind a
`cbManager` the gateway has no accessor for.

The breaker itself has a worse bug. `RecordSuccess` is never called, only
`RecordFailure` (`proxy/engine.go:566`). A half-open breaker lets
`HalfOpenMax` probes through and then `Allow()` returns false forever
(`resilience/circuit_breaker.go:70-78`). So once a breaker opens, the target
never comes back without a restart. Two smaller ones: 5xx responses do not
trip it, only transport errors, and the per-route `CircuitBreaker` override is
never read (`GetWithConfig` has no callers).

This is exactly the playbook's "never render an absence as a pass". A page
that says "closed" for a target the proxy has stopped sending to is truthful
about the field and wrong about the gateway.

### The write path drifts on a round trip

`dtoToRoute` (`api/handlers.go:546-594`) adds 100 to the priority and prepends
`Dashboard.BasePath` to the path. GET returns the adjusted values. So an editor
that loads a route and saves it unchanged moves it up another 100 and
double-prefixes its path. Any form built on these handlers as they stand
corrupts every route it touches.

Other traps on the same path:

- Config route IDs are `manual-<path>`, so they contain `/` and cannot sit in
  a URL segment. IDs go in the request body.
- API-created target IDs are `"target-" + url`, so two routes sharing an
  upstream share one health entry and one breaker, and deleting either route
  deregisters the target for both.
- `UpdateRoute` replaces target objects, which resets their counters, and the
  old targets are never deregistered from the health monitor.
- Enable and disable have no source check. On a discovered route the next
  discovery update overwrites `Enabled` (`discovery_compat.go:91`), so the
  toggle silently reverts. On a config route the change is persisted, but
  `loadManualRoutes` runs before `loadPersistedRoutes` on restart, so config
  wins and the change is lost.
- Enable and disable mutate the live route pointer before `UpdateRoute`, which
  races `MatchRoute`.

### Reads race the proxy

`Target.Snapshot()` writes exported fields on shared live targets. The old
dashboard and the REST API both call it while the proxy reads them.
`Target.Healthy` is a plain bool written under the monitor's lock and read
without one. `DiscoveredServices()` returns shared pointers that discovery
later mutates. Handlers here copy, never hand out a live pointer.

### What exists and what does not

The gateway exposes `RouteManager()`, `HealthMonitor()`, `Discovery()`,
`OpenAPI()`, `Config()` (a struct copy), `Snapshot()` and more
(`extension.go:278-326`). It has no stats reset, no circuit list or reset, no
manual health check, and no admin cache clear. `health.History` exists and is
never constructed, so there is no health history to show.

Persistence is optional through grove. Without a store everything is in
memory. With one, route events are persisted for every source, circuit and
health changes are written and never read back, and `auditSink` is set and
never written.

### No tenant, one gateway

Nothing in bastion carries a tenant, app or org id. `*Gateway` is provided by
type and the extension name is fixed, so there is one gateway per process. The
contract never takes a tenant, and there is no resolution path to get wrong.

### The API explorer iframe points at nothing

The explorer page iframes `BasePath + UIPath` (`/gateway/swagger`). That route
is registered only when `EnableGatewayDocs` is true, which is off by default,
and even then it serves the admin API's own spec, not the aggregated upstream
spec (`extension.go:510-517`). By default the iframe is a 404. Separately,
`HandleRefresh` runs `go oa.Refresh(ctx.Request().Context())`, so the refresh
is cancelled as soon as the handler returns.

### Forge

Bastion pins forge v1.10.0. `contract/dispatcher` exists there and is
byte-identical to v1.11.2, and `ContractContributorAware` has the same
signature. The parent `contract` package differs, so we bump to v1.11.2 to
match vault and the shell. `forge/extensions/discovery` needs fetching at the
matching version; the module cache stops at v1.10.0.

## Decisions

| | Decision |
|---|---|
| Scope | Parity plus the operator actions the admin API has. No streaming. |
| Dead stats | Fixed in Go in slice 1, before any page shows them. |
| Write logic | One `bastion/admin` service, called by both the REST handlers and the contract. |
| Transport | Contract intents only. The WS hub stays for REST clients and the plugin does not use it. |
| Liveness | Polling, the `usePoll` pattern from plugin-streaming. |
| Paging | None. The route table is in memory and bounded, so lists return the full set with a count. |
| Tenancy | None. One gateway per process. |
| API explorer | A spec summary with refresh and links. No iframe. |
| Old dashboard | Deleted in its own commit after `MIGRATION.md` is written from it. |

## The Go half

### Slice 1: make the numbers real

In `proxy`, `resilience` and the root package:

- Record per-request duration into the collector, gateway-wide and
  per route. Average from a sum and count. P99 from a fixed-size ring or
  bucket histogram per route, bounded in memory; the choice goes in the plan
  with its error bound written down, because a p99 that is really a p90 is a
  number an operator will act on.
- Cache counters come from the response cache's own hit and miss counts.
  `ResponseCache.Set` has no caller, so the cache never stores a response
  and every lookup misses; the counters will say so. `ShouldRetry` has no
  caller either, so nothing is retried. Neither is wired in under this
  migration. Both go in `MIGRATION.md`, and the contract reports retries as
  not measured.
- Call `RecordSuccess` on a proxied answer below 500. Target selection asks
  each target's breaker and skips open ones; `Target.CircuitState` is filled
  only on copies, because assigning it on live targets from the breaker's
  async callback races the load balancer and can apply transitions out of
  order. Add `Gateway.Circuits()` returning copied snapshots (target id,
  state, failure count, last failure, last change) and
  `Gateway.ResetCircuit(targetID)`.
- Count uptime from Start and upstreams by distinct URL (a URL is healthy
  only if every target entry for it is), and drop a route's `RouteStats`
  once the route is gone.
- Add a read path that copies a target's
  counters into a value without mutating the shared target, used by every new
  handler. `Target.Snapshot()` stays for existing callers.

Whether 5xx should trip a breaker is a behaviour change to proxying, not a
stats fix. It goes in `MIGRATION.md` as an open question, and slice 1 does not
change it. The same goes for the unused per-route breaker override.

Tests: the collector with concurrent writers under `-race`, the histogram's
bound, and a breaker that opens, half-opens, receives a success and closes.

### Slice 2: the admin service and the contract

`bastion/admin` owns every write the REST API does today, with the drift
removed:

- It takes and returns priority and path **as the operator entered them**.
  The +100 manual offset and the BasePath prefix are applied inside the
  service and stripped on the way out, so a load and an unchanged save is a
  no-op. A test does exactly that round trip.
- Target IDs are scoped to the route (`<routeID>/<n>` or a UUID), so no two
  routes share a health entry or a breaker. Replaced targets are deregistered.
- Update, delete and set-enabled check the source, and set-enabled writes a
  copy through `UpdateRoute`, never the live pointer.

`api/handlers.go` is rewired onto it. The REST responses keep their shapes. REST GET still returns effective
priority and path while PUT takes entered ones, so a REST client that
writes back what it read still drifts; the contract carries both values
(`priority` and `input.priority`) and the dashboard never drifts. The REST
drift goes in `MIGRATION.md`.

`bastion/extension/contract` follows vault's layout: `manifest.yaml`,
`contract.go` with `Register(d, reg, wreg, Deps{Gateway, Logger})`,
`ContributorName = "bastion"`, and one handler file per area. The extension
implements `dashboard.ContractContributorAware`.

### The intents

Field names come from the Go JSON tags. Every list returns `{items, total}`.

| Query | Request | Returns |
|---|---|---|
| `overview.stats` | | totals, error rate, latency avg and p99, cache hit rate as `null` when there were no cache operations (never 0%), open circuit count, healthy and unique upstreams, uptime since Start, discovery and circuit breaker enabled flags |
| `routes.list` | `source?`, `protocol?` | id, path, methods, protocol, source, service name, priority, enabled, target count, `editable` (manual only) |
| `routes.detail` | `id` | the full route with overrides, targets with health, circuit state and stats, and headers redacted |
| `upstreams.list` | | unique targets, each with the routes using it, health, circuit state and counters |
| `traffic.stats` | | gateway counters plus per-route stats, most requests first |
| `services.list` | | discovered services, copied, plus `discoveryEnabled` so an empty list says whether discovery is off |
| `circuits.list` | | every live target, with `tracked: false` for targets that have no breaker yet |
| `openapi.summary` | | per-service spec status, path counts, errors, last refresh and spec URLs; `enabled` and `running` flags, with empty lists when either is false |
| `config.detail` | | the gateway config as booleans and tunables, with sensitive values reduced to "set" or a count |

| Command | Request | Invalidates |
|---|---|---|
| `routes.create` | route fields | routes.list, routes.detail, upstreams.list, overview.stats, traffic.stats, circuits.list |
| `routes.update` | `id` plus pointer fields | same |
| `routes.delete` | `id` | same |
| `routes.setEnabled` | `id`, `enabled` | routes.list, routes.detail, overview.stats |
| `discovery.refresh` | | services.list, routes.list, routes.detail, upstreams.list, overview.stats, openapi.summary |
| `openapi.refresh` | | openapi.summary |
| `circuits.reset` | `targetId` | circuits.list, upstreams.list, routes.detail, overview.stats |

Refusals:

- Writing a non-manual route answers `CONFLICT`, naming the source.
- `routes.setEnabled` on a discovered route is refused with a message saying
  the next discovery update would undo it. On a config route it succeeds, and
  the response carries `durable: false` so the page can say the change will
  not survive a restart.
- A duplicate path and method set answers `CONFLICT`.
- `openapi.refresh` runs on a context detached from the request, fixing the
  cancelled refresh. `discovery.refresh` with discovery disabled answers
  `CONFLICT`, not a silent success.
- forge has no FAILED_PRECONDITION code. Source refusals answer CONFLICT
  with `details.reason: "source"` and the route's source; duplicates answer
  CONFLICT with `details.reason: "duplicate"` and the other route's id.

Redaction, in `routes.detail` and `config.detail`:

- Header values in `Headers.Add/Set` and `Transform.*Headers` whose names match
  `authorization`, `cookie`, `proxy-authorization`, or contain `key`, `token`
  or `secret` (case-insensitive) are replaced by `"[redacted]"`. The name
  stays, so the operator can see the header is set.
- TLS file paths on the gateway and on every target show as set or not set.
- IP allow and deny lists show as counts.
- Route and target metadata show keys, not values, with `health_check_path`
  and `openapi` shown in full because the operator needs them and they are not
  secret.

An edit form never receives a redacted value it could save back. For a header
it did not change, `routes.update` leaves the stored value alone, because the
field is a pointer and the form omits it.

## The React half

`packages/plugin-bastion`, `extension: "bastion"`, `namespace: "bastion"`.
Pages are plain components taking `params`, links go through `PluginLink` with
scope-relative paths, reads use `useQuery`, writes use `useCommand`, and
refreshes happen only through `meta.invalidates`.

### Information architecture

| Group | Route | Page |
|---|---|---|
| Overview | `/` | stat grid, top routes by traffic, open circuits |
| Routing | `/routes` | list, source and protocol filters |
| | `/routes/new` | create (manual) |
| | `/routes/:id` | detail: targets, overrides, enable toggle, edit for manual routes |
| | `/upstreams` | unique targets and their routes |
| | `/services` | discovered services, refresh |
| Traffic | `/traffic` | gateway counters, per-route table |
| Resilience | `/health` | target health |
| | `/circuits` | breaker state, reset |
| API | `/api-explorer` | spec summary, refresh, links |
| Settings | `/config` | redacted config |

`/routes/:id` percent-encodes the id in the URL and sends it decoded in the
body, since config route ids contain `/`. Detail and create routes carry no
nav entry.

The old overview's "Recent Routes" was the first five routes by priority, not
by recency. It becomes top routes by request count, which is what somebody
opening the overview wants.

### Liveness

Overview, traffic, health and circuits poll with `usePoll`, which today lives
in `plugin-streaming`. Bastion is its second user, so it moves to
`@forge-go/dashboard-plugin` and streaming imports it from there. Other pages
refresh on invalidation only.

### Badges

Proportion first, per the playbook. Most targets are healthy and most circuits
closed, so both take `outline`. Half-open takes `default`, the one worth a
second look. Unhealthy and open take `destructive`, since those are what
somebody came to the page to find. A disabled route is `secondary`. Sources
(manual, farp, discovery) and protocols are balanced labels and take
`outline`.

### Empty states

Three kinds, per the playbook. No routes at all; no routes matching the
filter; and for services, discovery switched off, which is a different
sentence from "discovery found nothing". The explorer says when OpenAPI is
disabled rather than showing an empty table. The circuits page says when
circuit breaking is disabled, since then every target is ungated and "no open
circuits" would read as good news.

### The route editor

Manual routes only, at `/new-route` and `/routes/:id/edit`. A form over
path, methods, protocol, priority, upstreams (URL, weight, tags),
rewriting, rate limit, auth and enabled. Path and priority are shown and
edited as the operator entered them, and the form says the manual offset
exists.

The editor offers only the overrides the proxy applies: rate limit and
auth. Timeout is never read on the proxy path, retry never runs, the
per-route breaker override is never used and the cache never stores, so
those are kept as stored on every save and marked "Not applied" on the
detail page. Headers, transforms, traffic policy and metadata are kept
as stored too; an edit sends only the fields the form holds, and the
contract merges them over the stored route with `Entry`. A rate limit or
auth override stored as disabled stays disabled when the route is saved.

A target URL the page shows has its password masked. An edit that sends
a masked URL back keeps the stored one.

No editor library is needed. Nothing here has a text form.

### Kit

`ResourceTable`, `PageHeader`, `QueryBoundary`, `CommandAlert`,
`ConfirmDialog`, `FilterBar`, `DetailLayout`, `DescriptionList`, `StatGrid`,
`EmptyState`, `NoneCell`, `TagList`, `Timestamp`, and all five display
conventions. Charts, if any, use kit's recharts, after the `dataviz` skill.

## Fixtures

`packages/fixture-server` gets `bastion-fixtures.mjs`, registered from
`server.mjs` through a `createBastionHandlers(FixtureError)` factory like relay
and vault, so refusals reach the browser with their codes and details.

It models the fixed contract, not deployed behaviour: an unchanged save does
not drift, targets are route-scoped, `setEnabled` refuses discovered routes,
circuits can be open and half-open. Counters advance on each read so polling
visibly changes the page. Every write changes the next read.

## Sequencing

Five slices. Each is runnable before the next begins.

1. Go core: the forge bump, latency, cache and retry recording, circuit state,
   `Circuits()` and `ResetCircuit`, uptime, unique upstreams, the non-writing
   snapshot. `go build ./... && go test -race ./...` clean.
2. Admin service and read path: `bastion/admin`, REST rewired, the
   contract skeleton and all nine queries. The plugin scaffold with overview,
   routes list and detail, and upstreams. Fixtures for all nine queries.
   `usePoll` moved into the plugin package.
3. Operator actions: the seven commands, the route editor, enable toggle,
   discovery refresh.
4. Remaining pages: traffic, health, circuits with reset, services, API
   explorer, config.
5. Retiring the old dashboard, by the procedure below.

Per package, `test`, `typecheck` and `lint` clean, and `pnpm -r test` too.
Bastion: `go build ./... && go test -race ./...` and golangci-lint with a fresh
cache per run.

## Retiring the old dashboard

1. Write `bastion/MIGRATION.md` first, from the live pages: every page, column,
   stat, widget, settings panel, badge and empty state across the nine routes,
   three widgets and one settings panel.
2. Account for every item as migrated, dropped or blocked. Already known:
   - the three widgets are dropped, since the shell's overview replaces them
     and nothing else mounts them;
   - the settings panel is dropped, since `/config` covers it;
   - the API explorer iframe is dropped, with the reason above;
   - the error widget's promised "open circuit count" is migrated, onto the
     overview, for the first time.
3. `grep -rn "bastion/dashboard" --include='*.go'` across the repo. Known
   importers: `extension/extension.go` (the `DashboardAware` assertion and
   `DashboardContributor()`).
4. `go build ./... && go test -race ./...` with the directory gone, then
   `go mod tidy` drops `a-h/templ`.
5. Delete `dashboard/` as its own commit. The dead Makefile templ targets go in
   the same commit. Docs follow separately: `README.md`,
   `docs/content/docs/api-reference/dashboard.mdx`, and the references in
   `admin-api.mdx`, `go-packages.mdx`, `getting-started.mdx`, `index.mdx`,
   `architecture.mdx` and `guides/hooks.mdx`.

`DashboardConfig` stays. `Enabled` also gates the admin REST API and the hub,
and `BasePath` prefixes the OpenAPI endpoints, so removing it is a separate
decision. Its doc comments get corrected to say what it actually gates.

### Open, and recorded in `MIGRATION.md`

Not fixed by this migration, each worth its own follow-up:

- Dashboard writes leave one Info log line each (intent, subject,
  operator) and no audit record: bastion's audit sink is never written.
- Timeout, retry, per-route circuit breaker and cache overrides are stored
  and shown but not applied by the proxy.
- Two operators editing one route: the last save wins.
- The response cache never stores anything: `ResponseCache.Set` has no caller.
- Retries never happen: `RetryPolicy.ShouldRetry` has no caller.
- `Target.Healthy` is a plain bool read without a lock by the load balancer.
- The admin REST API has no auth. `AdminAuthMiddleware` exists and is never
  wired.
- FARP push registration has no auth.
- FARP deregister is a no-op that answers "deregistered".
- The WS hub's `CheckOrigin` returns true, and `Broadcast` blocks when its
  channel fills.
- 5xx does not trip a breaker, and the per-route breaker override is unused.
- Circuit and health state are persisted and never read back. `auditSink` is
  never written.
- Enable and disable on a config route do not survive a restart.
- Traffic policies and transforms are read-only in the new dashboard.
- `health.History` is never constructed, so there is no health history.

## Testing

Go: collector and histogram under `-race`, breaker recovery, the admin
service's round trip (load, unchanged save, no drift), route-scoped target ids,
source refusals, redaction per header name, and each intent through the
dispatcher over the real transport, as vault's `transport_test.go` does.

React: each page renders its intent's data, every write goes out with the
right field names, every refusal is visible (inside the dialog when a dialog
is open), all three empty states, and redacted values never reach an edit
form's submit.

Then run it: fixture server and shell, click every page, every action and
every refusal.
