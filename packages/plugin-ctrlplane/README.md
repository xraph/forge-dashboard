# Ctrlplane dashboard

You can manage workloads, their replicas and deployment history from `/@ctrlplane`. Register this plugin in your Forge dashboard shell and register the Ctrlplane Go extension before the dashboard extension so its contract contributor is discovered.

```tsx
import ctrlplanePlugin from "@forge-go/dashboard-plugin-ctrlplane"

;<ForgeDashboard plugins={[ctrlplanePlugin]} config={config} />
```

The Go contributor requires a trusted dashboard principal with `ctrlplane:read` or `ctrlplane:write` and a nonempty `tenant_id` claim. It also calls your configured Ctrlplane authorization provider. Global administration requires `system:admin`; requests cannot choose another tenant through input fields. Secret values and database URLs never appear in query results.

## Run the local demo

You need the sibling `controlplane`, `forge` and `forgery` checkouts referenced by `demo/go.mod`. Local replacements exercise those sources, so this demo does not establish compatibility with published dependency versions.

Create a dedicated local PostgreSQL database, then run from `demo/` with your
connection settings:

```sh
PORT=8097 DEMO_CTRLPLANE=true DEMO_SYNTHETIC=true \
  DEMO_CTRLPLANE_DATABASE_URL='postgres://demo:demo@127.0.0.1:55432/ctrlplane_demo?sslmode=disable' \
  GOWORK=off go run .
```

From the dashboard repository root:

```sh
pnpm install
FORGE_DASHBOARD_BACKEND=http://localhost:8097 pnpm --filter @forge-go/dashboard-shell dev --host 127.0.0.1 --port 5177
```

For an isolated review while other plugins are being edited, add `--config vite.ctrlplane.config.ts` to the Vite command. That configuration loads only Ctrlplane into the same host and keeps the normal backend proxy.

Open `http://127.0.0.1:5177/@ctrlplane`. You get two isolated tenants, multi-service templates, workloads, replicas, health results, networking, secret metadata and a failed bootstrap record. PostgreSQL saves the records. Startup preserves saved workload and template edits.

Badger does not support the current managed-ownership guards. If you previously
set `DEMO_CTRLPLANE_PATH`, preserve that directory and unset the variable before
configuring PostgreSQL. Startup rejects the old setting; it does not migrate or
delete Badger data.

The development identity is fixed by server configuration. `DEMO_CTRLPLANE_ROLE` accepts `admin` (default), `tenant`, `reader` or `denied`. Restart the Go server to change it. Headers and command payloads cannot elevate that identity. The server binds to loopback and enables the dashboard's CSRF and idempotency checks.

Provider operations are simulated. No containers or cloud resources are created. An image containing `fail-demo` exercises a provider failure. Telemetry and remote exec are unavailable. Secret metadata persists, but the default vault keeps values in memory. The event window also clears on restart. Domain verification and certificate commands record the current service's metadata behavior; they do not establish external DNS ownership or ACME issuance.

## Review limits

Lists disclose bounded windows and use real cursors where the service provides them. Missing health stays unknown. System statistics show only counters the backend computes. You can inspect the complete legacy inventory, contract security tests and migration evidence in the Ctrlplane repository's `MIGRATION.md`.

Run `pnpm --filter @forge-go/dashboard-plugin-ctrlplane typecheck`, `lint` and `test` for package checks. With Docker running, the demo's Go test starts a disposable PostgreSQL container, closes and reopens the store, checks tenant isolation and verifies that startup preserves edits without duplicating seed records. The persistence test skips when Docker is unavailable.
