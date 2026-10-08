# Core dashboard

The core plugin mounts at the dashboard root. You can inspect services, health
checks, metrics, traces, audit activity, extensions, and deployment information.
The host puts these pages under Workspace, Observe, and Manage labels. Use the
application switcher to enter an extension or return to Forge.

All page reads use the plugin's scoped client and the existing Go contract:

| Page | Queries |
| --- | --- |
| Overview | `overview`, `services.list`, `audit.list` |
| Services & health | `services.list`, `services.detail`, `health` |
| Metrics | `metrics-report` |
| Traces | `traces.list`, `traces.detail` |
| Logs & activity | `audit.list` |
| Extensions | `extensions.list` |
| Configuration | `overview` |

Service and trace details open in sheets. Search filters loaded records; tables
paginate locally in groups of 25. The trace endpoint supplies up to 200 recent
traces, and the audit page requests the latest 200 events. Refresh reads the
server again. Export downloads the current page's loaded data as JSON.

Configuration is read-only. Route inventory, application log streaming, and
historical traffic are not exposed by these contracts. The UI states those
limits and never substitutes sample values. The standalone design preview
remains available for comparison.

## Local verification

Run the development fixture in one terminal:

```sh
FIXTURE_PORT=4311 pnpm --filter @forge-go/fixture-server start
```

Then run the shell against it:

```sh
FORGE_DASHBOARD_BACKEND=http://127.0.0.1:4311 pnpm --filter @forge-go/dashboard-shell dev --port 5181
```

Open `/overview`. This uses the production React entry with development data;
the fixture is not included in the shell bundle. Omit the backend override to
use the existing Go server proxy on port 8099.

Run `pnpm --filter @forge-go/dashboard-plugin-core test` for the contract-mapping
and page-state tests. Run `pnpm --filter @forge-go/dashboard-shell build` to
check types and build the production shell.
