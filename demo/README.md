# forge-dashboard demo server

A real Forge application. It imports `github.com/xraph/forge` as an ordinary
dependency, registers the dashboard extension, and by default registers the
real `github.com/xraph/forge/extensions/streaming` extension and the real
`github.com/xraph/authsome` engine as its other two contract contributors,
so the React shell has more than one scope to switch between. Nothing here
is a fixture: every response comes from forge's (or authsome's) actual
contract registry and dispatcher, the same code path a production Forge app
uses. Hand-written synthetic contributors (`streaming.go` / `auth.go`) still
exist and are still wired up, but only as a fallback -- see "Real vs
synthetic contributors" below for exactly when each one is used.

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

## Real vs synthetic contributors

Default behaviour, no env vars set:

- **`streaming-contract`** is meant to come from the real
  `forge/extensions/streaming` extension, registered unconditionally in
  `main.go`. But its own bundled `contract/manifest.yaml` fails the
  dashboard's contract validator -- see "A defect in the real streaming
  extension's manifest" below -- so this demo pre-flights that manifest at
  startup (`streamingcheck.go`) and falls back to the synthetic
  `streaming-contract` contributor (`streaming.go`) automatically, with a
  loud startup banner explaining why. Set `DEMO_STREAMING_FORCE_REAL=true`
  to register the real extension anyway and watch it fail for yourself (the
  dashboard logs the error and the contributor is simply absent from
  `/capabilities`).
- **`auth`** comes from a real `github.com/xraph/authsome` engine
  (`authsome.go`), built directly with `authsome.NewEngine` against
  in-memory stores (both authsome's own and an in-memory warden engine) and
  `authsome.WithBootstrap()`, which seeds a "Platform" app + dev/staging/
  production environments. No database, no network calls, no migrations.
  If engine construction or startup ever fails, main.go catches the error
  and falls back to the synthetic `auth` contributor (`auth.go`) instead of
  refusing to boot, logging exactly why.

`DEMO_SYNTHETIC=true` forces both back to the hand-written contributors
regardless of whether the real ones would have worked -- the blanket escape
hatch for when you specifically want the old fixture behaviour. Per
contributor, `DEMO_<PREFIX>_OMIT` / `DEMO_<PREFIX>_UNAVAILABLE` (see
"Exercising non-ready states" below) also force the synthetic contributor
even without `DEMO_SYNTHETIC`: a real extension that's actually running and
healthy has no "I'm not registered" or "I'm registered but broken" mode to
trigger, so those two states can only come from the fixture.

### A defect in the real streaming extension's manifest

While wiring the real streaming extension up to this demo,
`extensions/streaming/contract/manifest.yaml`'s `/playground` route turned
out to nest five `form.edit` widgets directly inside a `dashboard.grid`
node's `widgets` slot. `extensions/dashboard/contract/slots.go` -- checked
across its entire git history, back to the commit that introduced the slot
catalog -- has never allowed `form.edit` there; `widgets` only ever accepted
`metric.counter`, `metric.gauge`, `audit.tail`, `dashboard.stat`,
`dashboard.recentlist`, `molecule.stat-card`, the three `organism.*` chart
kinds, and `custom`. This is not a version-skew artifact of the forge
checkout this demo happens to be built against: it has been wrong on every
commit since slot validation existed, on every branch and every released
tag, and nobody had run the real streaming extension's own
`RegisterContractContributor` against the real dashboard registry until
this demo did. `loader.Validate`/the registry's own `Register` fail fast on
the first bad node, so the entire `streaming-contract` manifest is rejected
-- not just the `/playground` route -- and the dashboard extension only
logs the failure and carries on (see its `ContractContributorAware` loop in
`extensions/dashboard/extension.go`), so `streaming-contract` would
otherwise just silently be missing from `/capabilities` with no other
signal. `streamingcheck.go` exists to make that loud instead of silent and
to substitute a working contributor automatically. This demo cannot fix
`manifest.yaml` itself (forge is read-only from here); it's a real defect
worth fixing upstream.

## Which forge checkout you need

Read this before you assume a green build means anything. `go.mod` replaces
`github.com/xraph/forge` with `../../forge` on disk (see "The replace
directive" below), with no version pin. That means this demo's behaviour is
a live dependency on whatever commit someone else last left that checkout
on, and it can change under you with no error, because nothing here forces
a version.

Concretely: `extensions/dashboard/contract/transport/capabilities.go` gained
a `Configured bool` field on `ContributorCapability` via PR #99
(`fix/dashboard-collector-rss`, merged into `main` on 2026-09-08). That
field is what lets the shell's `resolvePluginState`
(`packages/plugin/src/resolve.ts`) tell a contributor apart as `ready`
instead of stuck on `setup`. **It's on `origin/main` now**, so building
from source works. The constraint that actually lasts is about released
tags, not branches: the field is **absent from every `v1.11.0` tag**
(`v1.11.0` and its per-extension siblings), which sit three commits behind
`main`. If you, or a real downstream consumer, pin a released forge
version instead of building from `main`, you won't have this field until a
new tag ships. That's the human's call, not something this demo can route
around.

Check what you're actually building against:

```bash
git -C ../../forge branch --show-current
```

A checkout on `main` (or any branch that has merged past PR #99) has the
field. A checkout on an older branch, or one that branched off before the
merge and hasn't rebased, might not, the same way `feat/devtools-causal-panel`
didn't while this was being verified, despite being an active, unrelated
feature branch rather than something stale. If it's missing, the demo
still starts and serves real data, it just can't get you the `ready`
state, and it says so loudly: a startup check in `startupcheck.go`
inspects the compiled `ContributorCapability` struct (no network call,
just `encoding/json` on a zero value) and prints an impossible-to-miss
warning naming the actual branch it found, right after the startup
banner, every time this is true.

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

Three contract contributors, all reachable through the genuine dispatcher:

- **`core-contract`**, wired in automatically by the dashboard extension
  itself (`extensions/dashboard/contract/pilot`). You get this for free just
  by registering the extension. Always real.
- **`streaming-contract`**. In practice this is currently always the
  synthetic contributor from `streaming.go` (three read-only query intents:
  `stats`, `rooms.list`, `connections.list`, static data, no persistence) --
  see "A defect in the real streaming extension's manifest" above for why
  the real one doesn't currently register.
- **`auth`**. By default the real `github.com/xraph/authsome` engine
  (`authsome.go`): 68 intents covering login/logout, users, apps,
  environments, sessions, devices, credentials, roles, settings, webhooks,
  and form configs -- everything `extension/contract/contract.go` registers
  in authsome's own manifest. Falls back to the synthetic 9-intent
  contributor in `auth.go` (`auth.config`, `auth.login`, `auth.logout`,
  `users.list`, `users.detail`, `users.ban`, `users.unban`,
  `sessions.list`, `sessions.revoke`, backed by an in-memory store seeded
  with three users and two sessions) if the real engine can't be built, or
  under the toggles described below.

Both names (`streaming-contract` and `auth`) are exactly what those two
plugin packages look up in the capabilities response, not guesses -- true
of both the real and synthetic contributors, since they're registering
under the same contributor name either way. Read the doc comments at the
top of `packages/plugin-streaming/src/index.tsx` and
`packages/plugin-authsome/src/index.tsx` if you want the reasoning.

## Exercising non-ready states

Two env vars per contributor, checked at process-start (they select which
contributor gets registered, so unlike the underlying `demoUnavailable`
check they do need a restart to take effect):

- `DEMO_STREAMING_OMIT=true` / `DEMO_AUTH_OMIT=true`: don't register the
  contributor at all. It disappears from capabilities entirely, and the
  shell's `resolvePluginState` reports the matching plugin as `hidden`.
- `DEMO_STREAMING_UNAVAILABLE=true` / `DEMO_AUTH_UNAVAILABLE=true`: register
  the contributor normally (it stays in capabilities, scope switcher entry
  and all), but every one of its intents returns a real
  `contract.Error{Code: CodeUnavailable}`. The shell's `QueryView` renders
  its error card with a retry button, and that's a genuine dispatcher error,
  not a hand-rolled one.

Both toggles work by substituting the synthetic contributor for the real
one (see "Real vs synthetic contributors" above) -- a real, healthy
extension has no lever to make it hide itself or fail every request, so
that's the only way to keep exercising these two shell states now that the
default is real data.

```bash
DEMO_AUTH_OMIT=true PORT=8099 go run .
DEMO_STREAMING_UNAVAILABLE=true PORT=8099 go run .
```

There's no third toggle for `configured: false` (the `setup` state) on
purpose. See "Which forge checkout you need" above: whether the real
transport can send `configured` at all depends on whether `../../forge` has
merged PR #99, not on anything this demo controls, and it's absent from
every released tag regardless of branch. Even on a checkout that has the
field, `DEMO_*_UNAVAILABLE` still isn't the same signal as
`configured: false`, since it fails per request rather than reporting
readiness up front, and this demo doesn't attempt to fake the field
directly; that would mean hand-rolling part of the wire response instead of
using forge's real transport, which defeats the point of the whole
exercise. See the report referenced from this repo's `w8-scoped-sidebar`
design doc for the full writeup.

## The replace directives

`go.mod` points three modules at on-disk checkouts instead of published
versions:

- `github.com/xraph/forge => ../../forge`
- `github.com/xraph/forge/extensions/streaming => ../../forge/extensions/streaming`
  (a separate Go module inside the forge repo, same rationale)
- `github.com/xraph/authsome => ../../authsome` (a private sibling repo with
  no tag covering the commit this demo needs -- see "Version skew: authsome
  pins forge v1.11.0" below)

That's there so day-to-day dashboard work doesn't need a forge (or authsome)
release cut every time the contract package changes underneath it, and it's
exactly why you shouldn't trust a green build here as proof of anything
beyond "this compiles against whatever's currently checked out in
`../../forge` and `../../authsome`". Before this demo is evidence about the
real, published, external-consumer path, remove the replace lines or pin
them to tagged versions and rebuild. With the replaces in place, `go build`
here proves nothing about what `go get github.com/xraph/forge` (or
`github.com/xraph/authsome`) would actually hand you.

## Version skew: authsome pins forge v1.11.0

`authsome`'s own `go.mod` requires `github.com/xraph/forge v1.11.0` (and
`github.com/xraph/forge/extensions/auth v1.9.11`). This demo's `go.mod`
replaces the root `github.com/xraph/forge` module with the on-disk checkout
at `../../forge`, and Go replace directives apply build-wide to every
importer of that exact module path -- so authsome's copy of the forge SDK
gets compiled against whatever `../../forge` actually contains, not against
v1.11.0, regardless of what authsome's own `go.mod` says. In theory that's
exactly the skew this demo needs forge's `main` (or later) for anyway (see
"Which forge checkout you need"), so it should be strictly newer and
backward compatible.

In practice: `go build ./...` and `go vet ./...` both succeed cleanly with
zero changes needed to authsome or its dependency versions, and the real
`auth` contributor registers, starts, and answers real queries (curl
`auth.config` and it returns the real bootstrapped "Platform" app's name
as `brand`). No incompatibility surfaced. The one thing worth
flagging is unrelated to version skew: the `authsome` checkout at
`../../authsome` currently has uncommitted local modifications (`git status`
there shows changes to `engine.go`, several `plugins/*`, and others) --
this demo built and ran against whatever was on disk there, the same way it
already treats `../../forge`, so if the shell behaves differently for you,
check what that checkout's working tree actually contains.

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

- `main.go`: builds the Forge app, registers the dashboard extension, then
  decides real vs synthetic for each of the other two contributors (see
  "Real vs synthetic contributors" above), reads `PORT`.
- `streaming.go`: the synthetic `streaming-contract` contributor (manifest +
  handlers) -- currently always the one actually serving traffic, see
  `streamingcheck.go`.
- `streamingcheck.go`: pre-flight validates the real streaming extension's
  bundled manifest against the real dashboard loader/registry before
  deciding whether to register it, and prints a loud warning + falls back
  to the synthetic contributor when that fails (which it currently always
  does -- see "A defect in the real streaming extension's manifest" above).
- `auth.go`: the synthetic `auth` contributor (manifest, handlers, and the
  in-memory store) -- the fallback if the real authsome engine can't be
  built or started.
- `authsome.go`: builds a real `authsome.Engine` against in-memory stores
  (authsome's own + an in-memory warden engine) and wraps it as the real
  `auth` contract contributor.
- `env.go`: the `DEMO_SYNTHETIC` / `DEMO_*_OMIT` / `DEMO_*_UNAVAILABLE`
  helpers.
- `startupcheck.go`: the in-process check that warns loudly at startup if
  the compiled forge checkout is missing `ContributorCapability.Configured`
  (see "Which forge checkout you need" above).

## Shield administration

Set `DEMO_SHIELD=true` to register the real Shield extension. Startup fails if
its SQLite database or audit file cannot open. Shield has no synthetic fallback.
You can run a persistent local review with:

```sh
PORT=8201 DEMO_SHIELD=true \
  DEMO_SHIELD_DB=/tmp/forge-dashboard-shield-review.db \
  DEMO_SHIELD_AUDIT=/tmp/forge-dashboard-shield-review.audit.jsonl \
  GOWORK=off go run -mod=readonly .
```

Start the shell from the dashboard root:

```sh
FORGE_DASHBOARD_BACKEND=http://127.0.0.1:8201 \
  pnpm --filter @forge-go/dashboard-shell dev --host 127.0.0.1 --port 5201
```

Open `http://127.0.0.1:5201/@shield`. The local development identity maps to the
fixed `shield-demo` tenant and `shield-console` app. `DEMO_SHIELD_ROLE` accepts
`admin`, `reader` or `denied`; it defaults to `admin`. This identity is for a
loopback development server. Production hosts must supply authenticated scope
and permission claims or their own trusted actor resolver.

Seed configuration is persistent and idempotent. Historical scans and reports
are labelled examples. Shield's six evaluation layers are unfinished, report
generation is unavailable, and settings are read-only. Saving a configuration
does not establish protection. PII responses contain metadata only.

Retention requires a sensitive administrator and the configured audit adapter.
The server reviews at most 100 expired token IDs with an immutable cutoff and a
five-minute preview. Confirmation deletes only that selection. It records a
synchronous audit entry before deletion and a completion entry afterward.

Run `node demo/shield-verify.mjs http://127.0.0.1:8201` from the dashboard root
for real HTTP acceptance. It creates and removes only configuration named for
that run and leaves seeded PII intact. The separate
`node packages/fixture-server/shield-verify.mjs` starts its own synthetic server
and exercises all 67 intents; that is development contract coverage, not live
Shield qualification.

## Ctrlplane persistence

Set `DEMO_CTRLPLANE=true` and `DEMO_CTRLPLANE_DATABASE_URL` to a dedicated local
PostgreSQL database before starting the demo. Startup migrates that database and
seeds the review data. Provider operations remain simulated.

```sh
PORT=8202 DEMO_CTRLPLANE=true \
  DEMO_CTRLPLANE_DATABASE_URL='postgres://demo:demo@127.0.0.1:55432/ctrlplane_demo?sslmode=disable' \
  GOWORK=off go run -mod=readonly .
```

Create the database first and replace the example connection settings with yours.
Use a database reserved for this demo. Workloads, instances and deployments share
the PostgreSQL store and one authorization policy object, as required by
Ctrlplane's managed-ownership guards.

The old Badger store does not support those guards. If you used
`DEMO_CTRLPLANE_PATH`, preserve that directory and unset the variable before
configuring PostgreSQL. Startup rejects the old setting even when a database URL
is also present. There is no automatic Badger data migration.

With Docker running, you can run the full demo Go suite from `demo/`:

```sh
GOWORK=off go test -race -count=1 -timeout 20m ./...
```

The Ctrlplane restart test starts its own disposable PostgreSQL container. It
checks that reseeding preserves edits and that tenants cannot read each other's
workloads. This test skips when Docker is unavailable; use verbose test output
to distinguish a passing persistence check from a skip.

## Cortex with a local model

You can run Cortex against an installed Ollama model through the real Nexus
adapter. You'll need Go 1.26.9 and Ollama listening on `127.0.0.1:11434`.

```sh
ollama pull qwen3:4b
PORT=8937 DEMO_CORTEX=true DEMO_CORTEX_PROVIDER=ollama \
  DEMO_CORTEX_DB=/tmp/cortex-local.db \
  GOWORK=off GOTOOLCHAIN=go1.26.9 go run .
```

The model identity is pinned to
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.
Startup and each request check the installed digest. A missing or changed model
fails the request. You won't get a deterministic answer as a fallback.
Leaving `DEMO_CORTEX_PROVIDER` unset keeps the deterministic demo provider.

This host uses the explicit `local-publication-1` rule policy: private key
headers and credential patterns are blocked, email addresses are redacted, and
buffered streaming releases content only after the publication gate approves it.
You can inspect the patterns in `cortex_provider.go`. These patterns do not
qualify arbitrary secret detection, semantic safety, prompt injection resistance
or factual accuracy. A model answer remains unchecked until independent
verification succeeds.

From this directory, qualify the installed model and HTTP transport with:

```sh
CORTEX_QUALIFY_OLLAMA=1 GOWORK=off GOTOOLCHAIN=go1.26.9 \
  go test -race -count=1 -run TestCortexInstalledOllama .
python3 verify-cortex-live.py
```

The HTTP check creates a fresh agent and retained runs in your configured demo
database. It checks model output, publication redaction, credential denial, tool approval
and resume, last-step exhaustion, truncated generation and cancellation.
Use a disposable database for qualification. Set `CORTEX_URL` if you choose a
port other than 8937. This local demo keeps the development identity and contract
security settings described above; these checks do not qualify production
identity, the Linux sandbox or a published dependency installation.

For the additional principal checks, start two copies of the demo against the
same disposable database, one with `DEMO_CORTEX_ROLE=reader` on port 8938 and
one with `DEMO_CORTEX_TENANT=isolated` on port 8939. Pass
`CORTEX_READER_URL=http://127.0.0.1:8938` and
`CORTEX_ISOLATED_URL=http://127.0.0.1:8939` to the Python check. It verifies that
the reader can read the original agent but cannot update it, and the isolated
tenant cannot read that agent. Without both endpoints this part reports not run.

### Verify a captured record before publication

Set `DEMO_CORTEX_VERIFICATION=true` with the Ollama provider to install the
bounded warehouse-record workflow. It accepts the two qualification inputs in
`verify-cortex-verified.py`, captures the original candidate privately, checks
its JSON schema, compares the record with a separately captured expected value,
and checks the source and authority revisions before committing the result.
General demo tools are not registered in this mode.

```sh
PORT=8937 DEMO_CORTEX=true DEMO_CORTEX_PROVIDER=ollama \
  DEMO_CORTEX_VERIFICATION=true DEMO_CORTEX_DB=/tmp/cortex-verified.db \
  GOWORK=off go run .
```

Run `python3 verify-cortex-verified.py` from this directory. Use
`CORTEX_VERIFY_RECEIPT=/tmp/cortex-verified-receipt.json` to retain the run and
result identities. The script checks guarded content reads, metadata replay,
lesson acceptance and revocation, and rejection of a deliberately wrong answer.
Supply the two principal URLs above to run the reader and foreign-scope checks.
Those hosts also need verification enabled. Keep the isolated tenant on its own
disposable database.

The host keeps a private authority file beside the database. All copies serving
the same scope share its file lock. To test source rotation, stop the operator
host and restart it with `DEMO_CORTEX_RECORD_REVISION=demo-record-v2`. Run the
script with `CORTEX_VERIFY_REVOKED_RESULT=/tmp/cortex-verified-receipt.json`.
The old content must be denied. `DEMO_CORTEX_AUTHORITY_REVISION` provides a
separate grant-revision check. Do not edit authority files while hosts are running.
A deployment with other source or grant writers must include those writers in
its own fence.

You can inspect the checked result on its run page, open the decision history,
and review lesson publications under Governed lessons. Historical verification
and current recall eligibility are separate. The improvement-review page uses
host-provided catalog, evaluation and activation commands; an absent optimizer
or missing grant produces an explicit error, never a simulated experiment.

The local record checks passed with the pinned installed Qwen3 model. They also
rejected a real model response with the wrong unit count. This is evidence for
the configured workflow, not a general accuracy measurement. Source observations
expire after fifteen minutes. Recovery reopens the original retained evaluation
report and cannot repeat generation. The demo does not qualify Linux sandbox
isolation, a production identity service or published dependency installation.

### Review a local team and improvement experiment

Enable `DEMO_CORTEX_PLANNING=true` alongside verification to install the bounded
warehouse team. The Team plans page shows the retained graph, ownership, budget
and current acceptance. Propose a planner revision, review it, then explicitly
accept it before claiming the producer task. Reconcile the completed task to run
its independent review. Acknowledgments alone do not mark the task accepted.
The fixed host exposes initial claims; retry and reassignment remain unavailable
until a host installs those capabilities.

The private `.team` directory beside the database retains agent identities and
prepared work before dispatch. Restart uses those identities. It cannot repeat an
uncertain call or refresh an expired plan's budget. Use a fresh disposable database
for a new qualification session. The `local-warehouse-team/v2` host requests
structural JSON output for each role. It still checks the generated plan, record
and review independently. The schema cannot force a correct unit count or a
supporting review. Earlier team journals require a fresh session instead of
silently adopting the new output policy.

Enable `DEMO_CORTEX_OPTIMIZATION=true` to install the Improvement review catalog.
The fixed synthetic benchmark has two discovery records and twenty separate
held-out records. Create and start an experiment from the approved catalog, then
inspect its comparison before making a routing decision. The default statistical
requirements remain in force. An inconclusive comparison keeps activation blocked.
These arithmetic records do not establish general model quality. Baseline and
candidate runs use the same structural JSON constraints and output budget. The
controller receives bounded discovery excerpts with original evidence references,
digests and explicit truncation metadata. The full records stay retained. An empty
edit is rejected as a candidate and cannot become a claimed improvement.

The optimizer retains dispatch intent, captured output and usage evidence in a
private `.optimization` directory beside the database. Unknown provider outcomes
keep their full reservation and are not dispatched again. Tool-less local
execution and model-context bounds do not establish Linux process isolation.

Run the opt-in real-model qualification separately from ordinary fixture tests:

```sh
CORTEX_QUALIFY_OPTIMIZATION=1 \
  CORTEX_QUALIFY_OPTIMIZATION_DB=/tmp/cortex-optimizer-qualification.db \
  GOWORK=off go test -v -run '^TestCortexOptimizationInstalledOllama$' -timeout 20m ./...
```

The selected database path must be fresh. Retain it to inspect the same comparison
in the dashboard afterward. The test uses the actual installed model and only
invokes an active version when the retained decision qualifies. Fixture lifecycle
tests separately cover activation, next-run version pins, rollback and denial.
