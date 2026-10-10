# Dashboard design preview

You can try the reference design on one page at `/reference-preview.html`.
Run `pnpm --filter @forge-go/dashboard-shell dev:reference` to open it, or
`pnpm --filter @forge-go/dashboard-shell build:reference` to check and bundle it.
The page uses the Kit's shared sidebar, cards, buttons, badges, select, sheets,
and ZeroState with the default Kit theme. You can adjust the request
count, choose an endpoint, and send sample requests to update the diagram.
All data is illustrative. No server requests are sent.

This trial follows the supplied reference: pale neutral surfaces, fine borders,
compact controls, a green capacity chart, and violet request activity. Its
entry and build are separate from the older multi-page preview and the
production dashboard. The approved theme now ships as the Kit default across the dashboard.

Run `pnpm --filter @forge-go/dashboard-shell dev:preview` and open
`/design-preview.html`. You can also run `build:preview` on the same package
to typecheck and bundle the mock into `apps/shell/dist-preview`.
The regular shell entry and build don't load this prototype.

You can explore eight core pages and a component library, filter records,
inspect services and traces, switch themes, and search pages with Cmd/Ctrl+K.
The application switcher changes between Forge, Authsome, and Streaming. Each
extension gets its own navigation and sample pages under its existing namespace.
Forge remains the root dashboard, with a separate home destination in the menu.
All application data is illustrative. Export downloads a sample JSON snapshot;
configuration changes live only in the mounted preview form and reset when you
leave that page or reload. No server commands run.

## Design

The layout keeps the application context visible while you inspect services,
requests, and administrative activity. Pages are direct links under visible
Workspace, Observe, and Manage labels. Developer tools sit in a separate group.
Switching scope replaces these groups with the extension's own navigation.
Extension management stays in core.

Inter remains the interface typeface. Monospace is reserved for route paths,
log records, and identifiers. The approved palette uses pale neutral surfaces,
fine borders, black primary actions, violet chart lines, and green capacity
and success indicators. You get the same theme in light and dark modes.

The preview uses the shared `DashboardShell`, including its scope switcher,
navigation rail, mobile sidebar and compact breadcrumb header. Controls,
cards, tables and sheets use the same Kit defaults as the production host.
You can close mobile navigation by choosing a page. Search remains available
from the rail and through Cmd/Ctrl+K.

The header is 44px tall. Standard inputs, selects and buttons are 32px tall;
page gaps are 16px, panel padding is 12px vertically and 16px horizontally,
and table rows use compact spacing. Narrow layouts wrap controls and keep
wide tables scrollable within their panel. The `preview.css` and
`reference.css` Kit exports remain available for existing imports; their
shared tokens are now in `globals.css`.

See [the Kit design guidelines](../../../../packages/kit/DESIGN.md) when you
add or update a page.

## Core capabilities inspected

The current React core plugin has one overview route. The sibling Forge
repository registers these intents in
`extensions/dashboard/contract/pilot/pilot.go`:

| Preview page      | Existing contract foundation                  | Follow-up work                                                |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Overview          | `overview`, `health`, `metrics.summary`       | Define historical throughput and availability data.           |
| Services & health | `services.list`, `services.detail`, `health`  | Match available detail fields and health history.             |
| Metrics           | `metrics-report`, `metrics.summary`           | Bind metric types and determine historical retention.         |
| Traces            | `traces.list`, `traces.detail`                | Map real spans to the waterfall.                              |
| Logs & activity   | `audit.list`, `audit.tail`                    | Add an application log provider separately from audit events. |
| Extensions        | `extensions.list`, `apps.list`                | Use capability state and the host's scoped navigation.        |
| Routes            | No route inventory intent found in core       | Define route inventory and per-route metric contracts.        |
| Configuration     | No general configuration intent found in core | Define allowed fields, validation, and command permissions.   |

These intents establish page ownership, not parity with every field in the
mock. Production integration must retain capability checks, query boundaries,
scoped clients, and the existing host-owned authentication flow.
