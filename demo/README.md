# forge-dashboard demo server

A real Forge application. It imports `github.com/xraph/forge` as an ordinary
dependency, registers the dashboard extension, and adds two extra contract
contributors so the React shell has more than one scope to switch between.
Nothing here is a fixture: every response comes from forge's actual contract
registry and dispatcher, the same code path a production Forge app uses.

## Why this exists

Before this, the only way to run a real server against the shell was one of
the illustrative stubs in `extensions/dashboard/examples/` inside the forge
repo, which meant checking out forge to work on dashboard UI at all. This
module breaks that: it lives next to forge-dashboard, depends on forge like
any other consumer would, and you can run it on its own.

The Node fixture at `packages/fixture-server/` is still there and still
useful for fast iteration, but it fakes the wire shape by hand, so it can't
catch drift between forge's real transport and what the shell expects. This
demo can, because it's forge.

## Running it

```bash
cd demo
go build ./...
PORT=8099 go run .
```

You'll need Go 1.26+, the same as forge itself. Default port is 8099, which
is what `apps/shell/vite.config.ts` and the playground both proxy `/dashboard`
to, so most of the time you won't need to set `PORT` at all. Override it if
8099 is already taken on your machine.

Once it's up:

- `http://localhost:8099/dashboard` redirects to the React shell.
- `http://localhost:8099/dashboard/api/dashboard/v1` is the contract
  envelope endpoint (POST only).
- `http://localhost:8099/dashboard/api/dashboard/v1/capabilities` lists the
  registered contributors and their intents.

Stop it with Ctrl+C. It doesn't write anything outside its own process
except a generated CSS cache under `demo/extensions/` on first run
(ForgeUI's tailwind build); that directory is gitignored and safe to delete.

## What it reports

Three contract contributors, all real, all reachable through the genuine
dispatcher:

- **`core-contract`**, wired in automatically by the dashboard extension
  itself (`extensions/dashboard/contract/pilot`). You get this for free just
  by registering the extension.
- **`streaming-contract`**, in `streaming.go`. Read-only, matching
  `packages/plugin-streaming`'s three query intents: `stats`, `rooms.list`,
  `connections.list`. Static synthetic data, no persistence.
- **`auth`**, in `auth.go`. Matches `packages/plugin-authsome`: `auth.config`,
  `auth.login`, `auth.logout`, `users.list`, `users.detail`, `users.ban`,
  `users.unban`, `sessions.list`, `sessions.revoke`. Backed by an in-memory
  store seeded with three users and two sessions, so ban/unban/revoke
  actually mutate state you can read back on the next query. Restart the
  server and it reseeds.

Both names (`streaming-contract` and `auth`) are exactly what those two
plugin packages look up in the capabilities response, not guesses. Read the
doc comments at the top of `packages/plugin-streaming/src/index.tsx` and
`packages/plugin-authsome/src/index.tsx` if you want the reasoning.

## Exercising non-ready states

Two env vars per contributor, checked at request time so you don't need to
restart between tests except for the omit case:

- `DEMO_STREAMING_OMIT=true` / `DEMO_AUTH_OMIT=true`: don't register the
  contributor at all. It disappears from capabilities entirely, and the
  shell's `resolvePluginState` reports the matching plugin as `hidden`.
- `DEMO_STREAMING_UNAVAILABLE=true` / `DEMO_AUTH_UNAVAILABLE=true`: register
  the contributor normally (it stays in capabilities, scope switcher entry
  and all), but every one of its intents returns a real
  `contract.Error{Code: CodeUnavailable}`. The shell's `QueryView` renders
  its error card with a retry button, and that's a genuine dispatcher error,
  not a hand-rolled one.

```bash
DEMO_AUTH_OMIT=true PORT=8099 go run .
DEMO_STREAMING_UNAVAILABLE=true PORT=8099 go run .
```

What you can't get out of the real server, and why: the fixture's
`buildCapabilities()` in `packages/fixture-server/server.mjs` attaches a
`configured` boolean to every contributor entry, and
`packages/plugin/src/resolve.ts` reads `!contributor.configured` to decide
the plugin's `setup` state. Forge's actual capabilities handler
(`extensions/dashboard/contract/transport/capabilities.go`) has no such
field on `ContributorCapability`. It never did. That's not something this
demo can route around; it's a real gap between what the fixture promises and
what the current forge transport ships. `DEMO_*_UNAVAILABLE` gets you close,
a real per-request failure, but it isn't the same as an up-front "not
configured yet" flag, and today nothing wired to the real transport can
produce that flag. See the report referenced from this repo's
`w8-scoped-sidebar` design doc for the full writeup.

## The replace directive

`go.mod` points `github.com/xraph/forge` at `../../forge` on disk. That's
there so day-to-day dashboard work doesn't need a forge release cut every
time the contract package changes underneath it, and it's exactly why you
shouldn't trust a green build here as proof of anything beyond "this compiles
against whatever's currently checked out in `../../forge`". Before this demo
is evidence about the real, published, external-consumer path, remove the
replace line or pin it to a tagged forge version and rebuild. With the
replace in place, `go build` here proves nothing about what `go get
github.com/xraph/forge` would actually hand you.

## Contract security

The demo runs with `dashboard.WithContractSecurity(false)`, so CSRF tokens
aren't cryptographically checked. You still have to send non-empty `csrf`
and `idempotencyKey` strings on every command; the transport
(`extensions/dashboard/contract/transport/http.go`) requires both fields to
be present unconditionally, security enabled or not, and only skips
validating the CSRF value when it's off. Any string works when security is
disabled. Don't ship a real deployment with this flag off; it's here purely
so you can curl a command without minting a real token first.

## Files

- `main.go`: builds the Forge app, registers the dashboard extension and
  both contributor extensions, reads `PORT`.
- `streaming.go`: the `streaming-contract` contributor, manifest and
  handlers.
- `auth.go`: the `auth` contributor, manifest, handlers, and the in-memory
  store.
- `env.go`: the `DEMO_*_OMIT` / `DEMO_*_UNAVAILABLE` helpers shared by both.
