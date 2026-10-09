# Conduit dashboard

The first-party dashboard for Forge's `conduit` extension. You can inspect broker state, service instances, subscription delivery policies and hook outcomes, then replay a dead letter into its original subscription.

Register `conduitPlugin` with your dashboard host. Its contributor name, namespace and extension are all `conduit`; the shared shell already includes it and hides it when the backend has no Conduit contributor.

The four pages use the typed Go contract in `forge/extensions/conduit/contract`. Replay confirms its original message ID and subscription, keeps errors inside the dialog and invalidates the dead letter listing after success. Query failures stay distinct from empty results. Payloads, headers and handler error text are excluded from listings.

```sh
pnpm --filter @forge-go/dashboard-plugin-conduit format
pnpm --filter @forge-go/dashboard-plugin-conduit lint
pnpm --filter @forge-go/dashboard-plugin-conduit typecheck
pnpm --filter @forge-go/dashboard-plugin-conduit test
```

For live checks, run `GOWORK=off go run ./cmd/demo` from the Forge Conduit module, then start the dashboard shell with `FORGE_DASHBOARD_BACKEND=http://127.0.0.1:8098`. Open `/@conduit/`. The default demo uses real process-local memory deliveries; set `CONDUIT_DEMO_NATS` to connect it to JetStream.

The development fixture implements the same five intents. Run `node packages/fixture-server/conduit-verify.mjs http://127.0.0.1:8097` against a running fixture to check replica identity, replay, invalidation and payload privacy over HTTP.
