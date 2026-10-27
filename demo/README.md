# forge-dashboard demo server

Run the React dashboard against a real Forge application and its contract
transport. The default contributors use the published streaming extension and
an in-memory Authsome engine. Optional Cortex, Shield and Ctrlplane hosts add
their own stores and explicitly labelled demo data.

The Node server in `packages/fixture-server/` remains useful for UI iteration.
This Go demo checks the installed libraries, dispatcher and lifecycle behavior.

## Real vs synthetic contributors

With no environment overrides, `streaming` comes from the real streaming
extension and `authsome` comes from the real Authsome engine. Authsome uses
in-memory identity, Warden and audit stores and bootstraps a Platform app with
development, staging and production environments. Its audit events last only
for the process lifetime. Token encryption uses a random AES-GCM key with the
same lifetime as the identity store. Persistent hosts need durable encryption
key management and a persistent Chronicle adapter.

The streaming preflight registers the compiled extension in a disposable
contract registry. It does not inspect sibling source files. A registration
failure produces a warning and selects the legacy synthetic `streaming-contract`
contributor. `DEMO_STREAMING_FORCE_REAL=true` keeps the real extension selected
so you can inspect its registration error.

If Authsome construction or startup fails, the demo logs the error and selects
the legacy synthetic `auth` contributor. `DEMO_SYNTHETIC=true` selects both
synthetic contributors explicitly. The synthetic contributors keep their legacy
names and do not provide the full current streaming or Authsome plugin workflows.
Per-contributor unavailable and omitted modes are described below.

## Published dependencies

You can build this demo without sibling checkouts. `go.mod` pins Cortex and its
extension, Sentinel adapter and optimization module to v1.9.0. Forge uses
`v1.13.2-0.20261026124101-97dbf04160fd`, the published commit required by
Cortex's command-envelope identity contract. Its auth and streaming modules
use v1.13.1.

The remaining Forge ecosystem dependencies use their current published releases,
including Grove v1.10.0, Nexus and its providers v1.9.0, Shield and Weave v1.8.1,
Authsome v1.8.3, Ctrlplane v1.8.1 and Warden v1.8.1. There are no local
`replace` directives. Keep `GOWORK=off` when checking the installed dependency
path, and use `GOWORK=off go list -m all` to inspect the selected versions.

## Running it

```bash
cd demo
GOWORK=off go build ./...
PORT=8099 GOWORK=off go run .
```

You'll need Go 1.26.9 or later, as pinned in `go.mod`. Default port is 8099, which
is what `apps/shell/vite.config.ts` and the playground both proxy `/dashboard`
to, so most of the time you won't need to set `PORT` at all. Override it if
8099 is already taken on your machine.

Once it's up:

- `http://localhost:8099/dashboard` redirects to the React shell.
- `http://localhost:8099/dashboard/api/dashboard/v1` is the contract
  envelope endpoint (POST only).
- `http://localhost:8099/dashboard/api/dashboard/v1/capabilities` lists the
  registered contributors and their intents.

Stop it with Ctrl+C. The default Authsome stores live in memory. Optional
Cortex, Shield and Ctrlplane hosts persist data in their configured stores.
ForgeUI also generates a CSS cache under `demo/extensions/` on first run;
that directory is gitignored and safe to delete.

## What it reports

The default contributors are `core-contract`, `streaming` and `authsome`.
The first comes from Forge's dashboard extension. The other two register their
published manifests and handlers through the same dispatcher. Cortex, Shield
and Ctrlplane are opt-in and are described below.

`DEMO_SYNTHETIC=true` uses the older `streaming-contract` and `auth` fixtures.
Their names and limited intent sets differ from the real contributors, so use
the default mode when checking the current plugins.

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

There is no environment toggle for `configured: false`. Forge's pinned
transport supplies the `configured` capability field. The startup shape check
warns if a different build lacks it; unavailable contributors remain a separate
state from contributors that need setup.

## Go checks

Run these from `demo/` with Docker available for the Ctrlplane PostgreSQL test:

```sh
gofmt -w *.go
GOWORK=off go vet ./...
GOWORK=off go test -race -count=1 -timeout=15m -v ./...
GOWORK=off go build -o /tmp/forge-dashboard-demo .
```

CI runs these checks against the published dependencies. The two installed
Ollama tests stay opt-in, and Linux sandbox qualification remains deferred.

## Contract security

The demo runs with `dashboard.WithContractSecurity(true)`. Fetch a token from
`GET /dashboard/api/dashboard/v1/csrf` and send its `token` value as `csrf` in
each command envelope. Supply a fresh `idempotencyKey` for each new command,
and reuse it only when retrying that command. `verify-cortex.py` exercises this
path with real tokens, including reader and denied-role checks.

## Files

- `main.go`: builds the app, registers the selected contributors and reads `PORT`.
- `streaming.go`: the legacy synthetic streaming contributor.
- `streamingcheck.go`: validates the compiled streaming contract in a disposable registry.
- `auth.go`: the legacy synthetic auth contributor.
- `authsome.go`: starts and stops the real in-memory Authsome host with Warden and audit adapters.
- `env.go`: reads contributor selection and availability settings.
- `startupcheck.go`: checks the compiled capability shape and reports Forge build metadata if it is incompatible.

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

## Upgrading Cortex to v1.9.0

Read the [release migration notes](https://github.com/xraph/cortex/releases/tag/v1.9.0)
before reusing a persistent demo database. Back up the SQLite database and its
audit and journal files with the writers stopped. Startup runs the ordinary
store migrations; it does not repair scope identities or rewrite prepared work.

The demo binds requests to the exact two-level tenant/app scope after checking
the principal. An ancestor scope can list child resources but cannot update,
delete or execute them. If you have imported older data, inspect its identities
with the store's `ScopeInspector` maintenance API and follow the
[scope migration guide](https://github.com/xraph/cortex/blob/v1.9.0/docs/superpowers/guides/cortex-scope-migration.md).
Do not truncate scope levels or infer ownership from a prefix.

Cortex's Forge extension supplies engine-owned metrics. The demo does not use
the retired observability counters. Its verification host supplies schema-2
capture intents with a separate transcript reservation and a one-MiB bound.

Drain or cancel incompatible prepared runs on their original compatible worker
before upgrading. Create fresh prepared snapshots under v1.9.0, and upgrade all
writers together. Do not relabel serialized schemas, reuse old acceptance
references or delete a journal to make pending work disappear. For a new local
review, choose a fresh `DEMO_CORTEX_DB` path and retain the previous database and
its journals for inspection. Existing compatible runs retain their IDs and
revision checks across restarts.

These migration checks do not qualify Linux process isolation. Live Linux
sandbox qualification remains deferred.

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
