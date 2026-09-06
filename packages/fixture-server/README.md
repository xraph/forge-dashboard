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

It listens on `http://localhost:4310` by default and answers the contract
envelope at `http://localhost:4310/dashboard/api/dashboard/v1`, matching the
default `contractBase` the shell derives from `basePath` (see
`packages/runtime/src/config.tsx`). Point a plugin's dev harness at that base
directly, or proxy `/dashboard` to port 4310 from your app's dev server.

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

The one rule that makes this fixture worth having: **a command missing
`csrf` or `idempotencyKey` is rejected with 400 `BAD_REQUEST`, before the
token is even looked at** — same order as
`extensions/dashboard/contract/transport/http.go`'s `ServeHTTP`. An invalid
or stale token gets **403 `UNAUTHENTICATED`**, not 401; that's the pair
Task 1's refresh-and-retry fires on. A modelled authorisation failure (see
`__forbidden` below) uses 403 `PERMISSION_DENIED`, which must never be
retried.

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
