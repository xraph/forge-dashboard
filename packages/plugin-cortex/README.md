# Cortex dashboard

You can configure agents and their composition, run them, review approvals, inspect conversation memory and follow orchestration and messaging activity from the Forge dashboard.

The plugin uses the `cortex` contract contributor in `github.com/xraph/cortex/extension/contract`. Add `cortexPlugin` to your host's plugin list and register Cortex with `WithDashboard` on the Go side. The host supplies a durable command audit recorder and resolves scope from the authenticated principal. The contract refuses empty or malformed scope and never takes tenant identity from a form.

Configuration forms preserve omitted fields. Clearing a list sends an empty list; an unchanged nested object stays out of the update patch. Names are stable references, so you clone a configuration when you need a new name. Reference choices use the saved owner's exact scope.

## Try the persistent demo

From `forge-dashboard/demo`:

```sh
PORT=8096 DEMO_CORTEX=true DEMO_CORTEX_DB=/tmp/cortex-review/cortex.db go run .
```

From the dashboard root, in another terminal:

```sh
FORGE_DASHBOARD_BACKEND=http://localhost:8096 pnpm --filter @forge-go/dashboard-shell dev --host 127.0.0.1 --port 5176
```

Open [Cortex](http://127.0.0.1:5176/@cortex). The demo seeds two separate tenants and retains their IDs and nested configuration when you restart it. Runs, sessions, memory, checkpoints and tool calls use the real engine and SQLite store. Command and lifecycle audit events go to the adjacent `.audit.jsonl` file.

The completion provider is a labelled local simulation. A message containing `approval` requests the local lookup tool and pauses for review. `fail-demo` produces a provider failure. Other messages stream a deterministic response. None of these paths calls a remote model.

`DEMO_CORTEX_ROLE` accepts `operator`, `reader` or `denied`. `DEMO_CORTEX_TENANT=isolated` selects the second seeded scope. Keep these switches in local development.

You can exercise the HTTP workflows against a disposable demo database:

```sh
python3 demo/verify-cortex.py
CORTEX_URL=http://127.0.0.1:8106 CORTEX_ROLE=reader python3 demo/verify-cortex.py
```

The operator check creates named test resources, verifies them and removes those configurations on success. Run it on a disposable database: run and audit history remain, and a failed check retains its records for inspection.

## Connect catalogs

The Go contract exports `NexusCatalogs`, `WeaveCatalogs` and `ShieldCatalogs`. Each adapter requires a host `CatalogAccess` callback that maps the current authorized Cortex context to nonempty external app and tenant IDs. You must check access to that external system in the callback. Empty filters are refused.

Merge the returned callbacks into `Deps.Catalogs` before registering Cortex. Without a callback, the dashboard shows the integration as unavailable. Store and provider errors remain visible with retry controls. Catalog metadata does not establish remote completion availability.

Weave and Shield summaries walk the complete authorized result before paging. Nexus prices arrive as decimal strings, including adapters for older numeric provider metadata. External credentials and live provider access are not configured by this plugin.

## Runtime boundaries

ReAct is the implemented reasoning loop. Persona identity, inline skill prompt fragments and inline trait prompt injections apply on this path. Persona assignments, cognitive phases, communication preferences, perception and behavior rules remain stored configuration. Sentinel automatic evaluation is still unimplemented.

Runtime settings are read-only because the engine's update service changes unsynchronized process memory. Those settings do not claim to persist. Host overlays require `cortex.overlay`; ordinary configuration management does not grant that permission.

Live events use a bounded cursor feed. Saved run and conversation records survive feed expiry and server restart. Cancelling a live run persists the domain cancellation and stops its provider context. Approval and resume commands retain the engine's suspension claim and authorization checks.

## Extension points

You can contribute to `cortex.overview.widgets`, `cortex.settings.tabs`, agent/persona/run detail sections, the chat toolbar and message actions, and playground panels or tabs through the shared plugin registry. Prompts and structured JSON use a lazy CodeMirror editor with the dashboard theme tokens.

## Validation

Run the plugin's `test`, `typecheck` and `lint` scripts with pnpm. The workflow tests cover omission versus clearing, immutable names, nested JSON validation, permission controls, delete retry and unavailable versus failed providers. The Go extension tests cover real SQLite persistence and scope boundaries; the demo has seed and restart tests plus the HTTP verification script above.

See Cortex's `MIGRATION.md` for the legacy inventory, implementation evidence and remaining qualification limits.
