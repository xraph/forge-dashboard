# Conduit dashboard

The first-party dashboard for Forge's `conduit` extension. You can inspect broker state, service instances, subscription delivery policies and hook outcomes, then replay a dead letter into its original subscription.

Register `conduitPlugin` with your dashboard host. Its contributor name, namespace and extension are all `conduit`; the shared shell already includes it and hides it when the backend has no Conduit contributor.

The five pages use the typed Go contract in `forge/extensions/conduit/contract`. Replay confirms its original message ID and subscription, keeps errors inside the dialog and invalidates the dead letter listing after success. The Consumers page reads broker lag, shows instance latency, and confirms pause or resume with the affected replica scope. Backfill keeps a stable operation ID, limits the inclusive range to 100 sequences, and exposes saved progress and recovery. The overview includes RPC counters, and delivery hooks include attempt duration. Query failures stay distinct from empty results. Payloads, headers and handler error text are excluded from listings.

```sh
pnpm --filter @forge-go/dashboard-plugin-conduit format
pnpm --filter @forge-go/dashboard-plugin-conduit lint
pnpm --filter @forge-go/dashboard-plugin-conduit typecheck
pnpm --filter @forge-go/dashboard-plugin-conduit test
```

For live checks, run `GOWORK=off go run ./cmd/demo` from the Forge Conduit module, then start the dashboard shell with `FORGE_DASHBOARD_BACKEND=http://127.0.0.1:8098`. Open `/@conduit/`. The default demo uses real process-local memory deliveries; set `CONDUIT_DEMO_NATS` to connect it to JetStream.

The development fixture implements the same ten intents. Run `node packages/fixture-server/conduit-verify.mjs http://127.0.0.1:8097` against a running fixture to check replica identity, replay, pause/resume, bounded backfill, invalidation and payload privacy over HTTP.
