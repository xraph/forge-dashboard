# Durable execution inspection

You can inspect persisted Dispatch executions at `/@dispatch/durable`. Select an authorized namespace or enter its exact name. Discovery scans a bounded catalog and may return no visible namespaces while `complete` is false. Continue that scan before treating it as finished. Discovery grants do not imply execution access.

The execution list filters workflow ID, workflow type, build and raw state. Runs link through three independently encoded identity parts: namespace, workflow ID and run ID. Filter and target changes restart pagination. A continuation keeps its opaque cursor; Restart pagination asks for a fresh first page. Totals stay unavailable. Detail pages expose persisted history, task attempts and deadlines, authorized run chains and children, and separate Chronicle/Relay source delivery facts. Secondary execution metadata and direct run links sit in an accessible disclosure.

Counters stay decimal strings. The types mirror the exact JSON tags in Dispatch's `operator/testdata/durable-wire.json`, copied unchanged into `test/durable-wire.json`. History pages report their captured high water. Task pages report the observed run revision; they have no invented creation time. Partial run/child access remains explicit. Metadata inspection works when the exact historical build runtime is unavailable, and these pages offer no execution queries or commands.

Each explicit payload reveal calls `durable.payload` directly through the scoped client. It requires the server's payload grant and durable audit acceptance. Base64 bytes decode as original UTF-8 text without parsing or reserializing numbers. The existing lazy JSON viewer displays that text; invalid UTF-8 remains a binary payload. Reveals stay in component memory, outside QueryStore, URLs, browser storage and telemetry. Hide, a hidden tab, a target change, client replacement or loss of metadata access removes the reveal.

Metadata uses the existing Read/useDispatchQuery, query invalidation and cursor helpers. The shared query client/store accept cancellation for opted-in reads. When the last reader unmounts or pauses, HTTP aborts and generation fencing excludes late results even if the transport ignores abort. Polling refreshes visible first pages every ten seconds and pauses hidden tabs. Continuation pages keep their cursor and offer explicit refresh. Transient same-scope failures retain an observed timestamp and stale label; denied, missing or switched scope data disappears.

Execution and task states use a stable semantic display mapping. Ordinary states use quiet outline badges. Failed executions and blocked delivery sources use destructive badges because they require attention; filters let you find them without relying on the current page's distribution. Source pending includes blocked. Sink accepted proves verified durable source acceptance. It does not establish Relay endpoint delivery or Chronicle external anchoring, both unavailable through this contract.

## Real Go browser qualification

Build and start the reviewed host using Dispatch `qualification/README.md`. Its private mode-0600 state file contains real Authsome sessions. Keep it outside the repository. From this dashboard root:

```sh
DISPATCH_OPERATOR_STATE=/absolute/private/state.json \
  pnpm --filter @forge-go/dashboard-shell exec vite \
  --config vite.dispatch.config.ts --port 5291 --strictPort
```

The qualification config binds numeric loopback. `DISPATCH_OPERATOR_ROLE` selects reader (default), payload, denied or anonymous on the server. Use separately configured ports for these checks. Incoming cookies, authorization and authority/forwarding headers are stripped; the proxy applies its configured real session. Every domain POST forwards unchanged to the Go host. It has no success fallback or response rewriting. Unsupported dashboard methods/routes are refused.

The Go fixture mounts contract POST only. The qualification config supplies fixture-only shell principal/capabilities documents and restricts the shell to Dispatch. Those documents establish no namespace grants and do not qualify real dashboard login, principal or capability bootstrap. The domain HTTP uses actual Forge transport, stock Authsome-issued sessions, real Warden policies and injected memory or PostgreSQL Dispatch storage. Authsome/Warden fixture stores remain memory; production identity deployment, TLS, runtime execution, recovery and remote sinks need their own qualification.

The Go fixture seeds unfinished discovery, production/foreign scope, invoice continuation and deliberate source conflicts. Exact large counters and restricted-link fixtures are verified in component tests from the Go wire examples. Boundary-value PostgreSQL row injection was attempted separately and rejected by the required durable delivery intent guard, with its transaction rolled back. No guard was weakened. That artificial high-integer browser boundary remains unverified and establishes no runtime history or recovery claim.

This surface does not complete the separate legacy dashboard migration. The archived `_dashboard` inventory and its remaining fixture/SQLite parity gates stay governed by Dispatch `MIGRATION.md`. There is no registered Dispatch walkthrough, so these pages offer no tour button.

Run `pnpm --filter @forge-go/dashboard-plugin-dispatch format`, `lint`, `typecheck` and `test`; these are this workspace's equivalents for formatting and lint, with no make targets. Shared client/store checks live in `@forge-go/dashboard-plugin`. The playbook's full workspace gate is `pnpm -r --workspace-concurrency=2 test`. Production builds require the example Next app's `FORGE_DASHBOARD_URL`. New lazy-route measurements belong in root `BASELINE.md`.
