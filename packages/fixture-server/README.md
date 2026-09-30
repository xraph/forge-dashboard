# @forge-go/fixture-server

This is a development fixture, not a shipped package. It stands in for the
Go dashboard's contract transport (`extensions/dashboard/contract/transport`
in the `forge` repo) so plugins that talk to `streaming-contract` and `auth`
can be built and exercised before either extension is reachable in this
workspace — the demo server only registers `core-contract`, and the
`authsome` repo that owns `auth` is mid-flight in another session.

It is plain `node:http`, zero dependencies, one file. There is no test suite
for it: it's a dev tool, not shipped code, and no discriminator applies here.

## Start it

```bash
pnpm --filter @forge-go/fixture-server dev
# or, from this directory:
node server.mjs
```

Root `pnpm dev` also boots it. It lives in `packages/`, so its `dev` script is
picked up by the workspace's persistent `dev` task in `turbo.json` along with
every other package's. That's expected, not a misconfiguration: if you don't
want it running, filter your dev command to the app you care about.

It binds loopback only (`127.0.0.1`) and listens on `http://localhost:4310` by
default and answers the contract
envelope at `http://localhost:4310/dashboard/api/dashboard/v1`, matching the
default `contractBase` the shell derives from `basePath` (see
`packages/runtime/src/config.tsx`). Point a plugin's dev harness at that base
directly, or proxy `/dashboard` to port 4310 from your app's dev server.

### Pointing a dev harness at it

There is no Go SPA handler here, so nothing injects `window.__FORGE_DASHBOARD__`
the way `extensions/dashboard/shell_handlers.go` does for the real shell.
`packages/runtime/src/config.tsx`'s `configFromWindow()` reads that global, and
a plugin dev harness running on its own (a bare Vite dev server, not the
playground) has to set it itself, before the app mounts:

```ts
// main.tsx, before rendering ForgeDashboardProvider
window.__FORGE_DASHBOARD__ = {
  basePath: "/dashboard",
  contractBase: "http://localhost:4310/dashboard/api/dashboard/v1",
}
```

Set only `basePath` and `contractBase`. Per
`packages/plugin/docs/shell-html-bootstrap.md`, those two plus `shellBase`,
`authEnabled` and `loginPath` are what the real Go side sets; everything else
on `DashboardConfig` (`streamBase`, `loginOp`, `loginContributor`) is defaulted
client-side from `basePath`, and a fixture harness has no reason to override
any of it.

If you'd rather proxy instead of pointing at an absolute URL, proxy
`/dashboard` to port 4310 from your harness's own dev server (the way
`apps/playground`'s Vite config proxies to a real Go server) and set only
`basePath: "/dashboard"` — `contractBase` then defaults to
`${basePath}/api/dashboard/v1`, which resolves through the proxy, same-origin.

Env vars:

| Var | Default | Purpose |
|---|---|---|
| `FIXTURE_PORT` | `4310` | HTTP port |
| `FIXTURE_BASE_PATH` | `/dashboard/api/dashboard/v1` | Contract mount point |
| `FIXTURE_CSRF_TTL_MS` | `300000` (5 min) | How long a normally-issued token stays valid |

## What it imitates

- `POST {base}` — the envelope dispatch. Takes
  `{envelope, kind, contributor, intent, params?, payload?, csrf?, idempotencyKey?}`
  and returns `{ok:true, envelope:"v1", kind, data, meta}` or
  `{ok:false, envelope:"v1", error:{code, message}}`.
- `GET {base}/capabilities` — `{shellEnvelopes, contributors:[{name, envelopes, intents, version?, configured, message?}]}`.
  `configured` is always present, `version`/`message` are omitted when unset,
  matching Go's `omitempty` — the four-state resolver in
  `packages/plugin/src/resolve.ts` depends on telling `false` apart from
  absent.
- `GET {base}/csrf` — `{token, expiresAt}`.

**The status a handler error comes back as is the sharpest divergence here,
and the fixture is the one that's right.** A handler that throws returns at
its own status: 404 `NOT_FOUND` for a `FixtureError` (an unknown room, user or
session), 400 `BAD_REQUEST` for anything else. The real transport does not do
that. `contract/transport/http.go` answers **every** error out of `Dispatch`
with `writeError(w, http.StatusInternalServerError, ...)` — HTTP 500, carrying
the handler's own code in the body, whatever that code is. Task 6 confirmed it
against a live server. Fixing it on the Go side is out of scope for this wave.

So anything status-sensitive written against this fixture passes here and
breaks against the server: assert on `error.code` from the body, never on the
HTTP status, and don't branch on 404 vs 400 vs 500 in plugin code. Only the
pre-dispatch rejections below (missing csrf, bad token, `__forbidden`) carry a
status both sides agree on, because the real transport writes those before it
reaches a handler too.

The one rule that makes this fixture worth having: **a command missing
`csrf` or `idempotencyKey` is rejected with 400 `BAD_REQUEST`, before the
token is even looked at** — same order as
`extensions/dashboard/contract/transport/http.go`'s `ServeHTTP`. An invalid
or stale token gets **403 `UNAUTHENTICATED`**, not 401; that's the pair
Task 1's refresh-and-retry fires on. A modelled authorisation failure (see
`__forbidden` below) uses 403 `PERMISSION_DENIED`, which must never be
retried.

`client.ts` also retries on a bare 401, but that comes from the outer session
auth middleware in the real deployment, not from `contract/transport`. Nothing
in this fixture returns 401 — that's correct scoping, not a gap, so don't go
looking for a 401 case here; there isn't one to model.

### Idempotency

A command's `idempotencyKey` is deduped, matching
`extensions/dashboard/extension.go:365`'s default wiring of
`dispatcher.WithIdempotencyStore` over `contract/dispatcher/dispatcher.go`'s
rule: dedup applies only to `kind === "command"` with a non-empty key —
queries never dedup. The lookup key folds in the **intent**, not the
contributor (matching the real oddity, so the same key on two different
intents does not collide). Only a **successful** dispatch is cached; an
error is never stored, so retrying a failed command runs fresh. A cache hit
returns the stored `data`/`meta` verbatim without re-running the handler.
TTL is 24h, hardcoded, held in an in-memory `Map` — no persistence, nothing
beyond replay.

## Intents served

**`streaming-contract`** — nine queries, no commands this wave:
`stats`, `connections.list`, `rooms.list`, `rooms.detail`, `rooms.members`,
`rooms.moderation`, `channels.list`, `presence.list`, `config`.

**`auth`** — the nine intents this wave scopes to:
`auth.login`, `auth.logout` (commands), `auth.config` (query),
`users.list`, `users.detail` (queries), `users.ban`, `users.unban` (commands),
`sessions.list` (query), `sessions.revoke` (command).

Seeded auth state: three users (`usr_1`/`usr_2`/`usr_3`) and two sessions
(`ses_1`/`ses_2`). `users.detail` only ever returns one of the ids
`users.list` already showed you. Mutations are real, held in memory for the
life of the process:

- `users.ban` / `users.unban` flip the seeded user's `banned` flag — a
  following `users.list` or `users.detail` shows it.
- `sessions.revoke` deletes the session outright — a following
  `sessions.list` no longer has it.

**`relay`**: webhook endpoints, mirroring `relay/extension/contract` in the
relay repo. Three queries (`endpoints.list`, `endpoints.detail`,
`endpoints.resolve`) and five commands (`endpoints.create`, `endpoints.update`,
`endpoints.delete`, `endpoints.setEnabled`, `endpoints.rotateSecret`).

Seeded with three endpoints: two for `acme` (one disabled) and one for
`globex` that has no signing secret, so the list has an unsigned row to show.
The fixture copies the real server's behaviour where a page could otherwise
get away with relying on something the server does not do:

- An empty or missing `tenantId` lists every tenant.
- A validation error carries `details.field` in snake_case (`tenant_id`,
  `event_types`), because that is the Go field name, even though the inputs are
  camelCase. A form has to map one to the other.
- An id without the `ep_` prefix is `BAD_REQUEST`, not `NOT_FOUND`.
- Globs match segment for segment, like relay's `catalog.Match`, so
  `invoice.*` does not match `invoice.created.v2`.
- `rotateSecret` returns the secret once, flips an unsigned endpoint to
  signed, and invalidates the list as well as the detail.

`FixtureError` and `sendError` also forward an optional `details` object now,
as the real server's `contract.Error.Details` does. Nothing else uses it yet.

**`vault`**: secrets and rotation, mirroring `vault/extension/contract` in the
vault repo, with its own module (`vault-fixtures.mjs`). Six secret intents
(`secrets.list`, `secrets.detail`, `secrets.versions`, `secrets.create`,
`secrets.update`, `secrets.delete`) and five rotation ones (`rotation.policies`,
`rotation.detail`, `rotation.savePolicy`, `rotation.deletePolicy`,
`rotation.rotateNow`). The rules are the Go handlers' rules:

- No value is ever stored or returned. `create` and `update` check `value` is
  non-empty and drop it.
- `create` on an existing key is `CONFLICT`, `update` on a missing one is
  `NOT_FOUND`, and `update` keeps `expiresAt` unless it is sent (`""` clears).
- `delete` removes the policy too, and still removes an orphan one before it
  answers `NOT_FOUND`.
- A policy needs an interval of at least 60 seconds. `nextRotationAt` is set
  when the policy is new, its interval changes, or it goes from disabled to
  enabled, and is left out of the answer whenever the policy is disabled.
- The fixture models a keyed vault: `create`, `update` and `rotateNow` stamp
  `AES-256-GCM`, so replacing the legacy unencrypted row encrypts it until the
  next `_fixture/reset`. Deleting a secret leaves its rotation records, as the
  Go store does.
- `rotateNow` is `BAD_REQUEST` for a key with no registered rotator.
  `db/primary.password` and `smtp/relay.password` have one.

Seeded with 33 secrets (two pages at the default limit), including a slashed
and dotted key, an unencrypted one (`encryptionAlg` is `""`, not absent), four
with an expiry (future, soon, passed, and the rotatable one) and two with metadata. Three policies:
enabled with a rotator, enabled without one, and disabled. `_fixture/reset`
restores all of it.

`server.mjs` passes its `FixtureError` class to `createVaultHandlers`. A class
of the same name declared in another module fails the dispatch's `instanceof`
check, which would turn every `NOT_FOUND` and `CONFLICT` into a 400.

**`chronicle`**: the audit trail, mirroring `chronicle/extension/contract` in the
chronicle repo, with its own module (`chronicle-fixtures.mjs`). All 29 intents,
with the Go handlers' messages and the manifest's `invalidates` lists. The
viewer is an app-wide operator of `app_chronicle`, which holds four chains that
verify differently, so a page is always looked at against a real failure:

| stream | tenant | scheme, pinned since | head | verifies as |
|---|---|---|---|---|
| `stream_app` | none | `chronicle/v4`, 1 | 12,431 | intact and plain: every span `unkeyed`, so a pass must not read as a pass |
| `stream_acme` | `acme` | `chronicle/v5`, 48,201 | 61,004 | intact, mixed level: unkeyed below the pin, keyed above it, signed where a checkpoint covers it |
| `stream_globex` | `globex` | `chronicle/v5`, 1 | 5,000 | broken: gaps 2311 and 2312, tampered 2780, downgrade 2901, and a retained range 101 to 400 vouched for by the record at 401 |
| `stream_initech` | `initech` | `chronicle/v5`, 1 | 3,000 | truncated: the last checkpoint reaches 3,400, past the head, so `headMatch` and `checkpointHeadOk` are false |

Env switches, read at start-up and again on `_fixture/reset`:

- `FIXTURE_CHRONICLE_NO_CHECKPOINTS=1`: the deployment takes no checkpoints.
  `checkpoints.list` answers `supported: false` with `checkpoints: null` (the
  shape older servers send, on purpose), `checkpoints.take` is `UNAVAILABLE`,
  no verify run checks a checkpoint, and coverage never reaches `signed`.
- `FIXTURE_CHRONICLE_NO_OWN_CHAIN=1`: the app-level scope has no chain.
  `streams.mine` answers `{}` and `verify.run` without a `streamId` answers
  `noChain`, while `streams.list` still holds the tenants' chains.
- `FIXTURE_CHRONICLE_VIEWER=tenant`: the viewer is a tenant operator of `acme`.
  It sees only acme's chain, events, archives and reports, and the app-level
  retention policies are listed after its own with `editable: false`. Saving or
  deleting one is `NOT_FOUND`.
- `FIXTURE_CHRONICLE_NO_ERASURE=1`: `erasures.request` is `UNAVAILABLE`, and
  settings say crypto erasure is off.

Two deliberate differences from production. Events are a sample, not 81,000
objects: the last 40 of each chain, the events around each break, and the
retention record, plus a stretch from a day back (so the hourly volume chart has
an empty hour to show) and a few old `debug` events (so a retention preview has
something to select). `total` counts the sample. And `retention.enforce` removes
eligible sample events and reports counts without writing retained ranges into
the chain.

A policy created here gets an id built from its scope and category, such as
`retpol_app_fixture`, so a script can delete what it made. `verify.mjs` reads
the mode back from the server (through `settings.detail` and `streams.mine`),
swaps the ids that mode cannot reach, and skips the four-chain checks for a
tenant viewer, saying so in its output.

`auth.login` is not real authentication: any password validates, and an
unknown email still succeeds (falling back to `usr_1`'s id as the subject).
That's an intentional fixture shortcut, not an oversight — modelling
authsome's actual credential checking is out of scope for a wire-shape
fixture.

## The four states

The plugin host resolves each contributor into one of four states
(`hidden`, `mismatch`, `setup`, `ready` — see `resolvePluginState` in
`packages/plugin/src/resolve.ts`). These flags drive all four, per
contributor (`STREAMING` or `AUTH`):

```bash
# "setup" — contributor present but not configured
FIXTURE_STREAMING_CONFIGURED=false pnpm --filter @forge-go/fixture-server dev

# "mismatch" — reports a version that fails a plugin's `requires` range
# (pick any version string a plugin's manifest doesn't accept)
FIXTURE_AUTH_VERSION=0.1.0 pnpm --filter @forge-go/fixture-server dev

# "hidden" — omit the contributor from capabilities and its intents entirely
FIXTURE_STREAMING_OMIT=true pnpm --filter @forge-go/fixture-server dev

# "setup" with a message the UI can render
FIXTURE_AUTH_CONFIGURED=false FIXTURE_AUTH_MESSAGE="Connect an API key to continue" \
  pnpm --filter @forge-go/fixture-server dev
```

Combine as needed, e.g. both contributors at once:
`FIXTURE_STREAMING_CONFIGURED=false FIXTURE_AUTH_OMIT=true node server.mjs`.

`omit` removes the contributor from both `capabilities` and intent dispatch
(a truly absent contributor can't serve intents either); `configured` and
`version` only affect what `capabilities` reports — the intents still run,
because that gate is a shell-side rendering decision, not a registration one.

## Fixture-only control endpoints

Not part of the real contract; exist to make behaviour otherwise gated by
time or server restart reachable from a script.

- `POST {base}/_fixture/expire-csrf` — invalidates every currently-issued
  token. Fetch a token, use it once successfully, call this, then reuse the
  same token: it now gets 403 `UNAUTHENTICATED`, so refresh-and-retry logic
  can be driven without waiting out a real TTL.
- `GET {base}/csrf?stale=1` — hands back a token that was never made valid,
  with `expiresAt` already in the past. Quicker than the endpoint above when
  you just need a bad token on hand.
- `POST {base}/_fixture/reset` — restores all in-memory state (streaming and
  auth) to the seed values and clears issued CSRF tokens.

## Modelling a real denial

Any command or query whose `params`/`payload` object includes
`"__forbidden": true` gets 403 `PERMISSION_DENIED` instead of running its
handler. Use this to prove a client's retry logic does NOT retry a real
denial the way it retries a stale CSRF token.

## Verification

Six curl runs against a fresh `node server.mjs`, output captured verbatim in
`task-2-report.md`:

1. A query returning data (`streaming-contract`/`stats`).
2. A command rejected without CSRF (400 `BAD_REQUEST`).
3. The same command accepted with a token fetched from `/csrf`.
4. A stale token (`?stale=1`) producing 403 `UNAUTHENTICATED`.
5. `capabilities` carrying both contributors, `configured` present on each.
6. `users.ban` followed by `users.list`, showing the mutation.

## ledger

`ledger-fixtures.mjs` answers all 51 intents of the ledger contract at
`forgery/ledger/extension/contract/manifest.yaml`, with the Go handlers'
rules: snake_case fields, money as `{amount, currency, display}` in minor
units, lists as `{items, limit, offset, has_more}` with no total, a
provider's refusal as `success: false` rather than an error.

The seed has four plans (one draft, one archived), a catalog with one shared
feature, six subscriptions in six states, invoices in every status, coupons
that are active, expired, scheduled and exhausted, thirty days of usage for
two tenants and one batch of events sharing a timestamp.

The provider has its own small catalog, so each `importFromProvider` has something to copy. You can import plans `prod_growth` and `prod_scale`, features `mtr_exports` and `mtr_webhooks`, subscriptions `sub_1Stark` and `sub_1Wonka`, and invoices `in_1AcmeA` and `in_1AcmeB`. The rest are there to be refused: `prod_starter` and `mtr_api_calls` collide with a slug or key this app already uses, `prod_partner` is filed under another app, `sub_1Orphan` and `in_1Orphan` point at a plan or subscription that isn't here, `sub_1Retired` is on the Enterprise plan, which isn't active, and `in_1BadTotals` has a total that doesn't add up.

Two switches, read on every call:

```bash
LEDGER_FIXTURE_NO_APP=1 node server.mjs       # no app selected
LEDGER_FIXTURE_NO_PROVIDER=1 node server.mjs  # no payment provider
```

The first makes every intent except the feature catalog and `settings.detail`
answer `PERMISSION_DENIED` "no app selected", which is what an unconfigured
deployment sees. The second makes every `syncToProvider` and `importFromProvider` answer `UNAVAILABLE`.
