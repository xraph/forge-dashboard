# Dashboard design preview

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
log records, and identifiers. The palette uses white (#ffffff), neutral gray (#f7f7f7), graphite (#242424),
and steel blue (#527d9f) for charts. Green and amber indicate service state.
Runtime values and table headers use monospace. Tables have compact rows,
cards use restrained borders and small corners, and details open alongside
the current page.

The shell uses the kit's actual `AppSidebar`, `ScopeSwitcher`, `NavTree`,
`SidebarProvider`, `SidebarInset`, `SidebarRail`, and sidebar trigger.
`NavMain` keeps each page directly accessible, including in the icon rail.
Only items with explicit children become collapsible branches; those branches
use flyouts in the icon rail and reveal an externally selected active route.
The preview's current groups need no folding. Content uses the existing
shadcn-based buttons, cards, card headers, badges, inputs, switches, tables,
native selects, tabs, empty states, stat grids, and sheets. Their built-in styles
provide the control shapes and interaction states.

The kit's `preview.css` export contains opt-in theme tokens and restrained
control styling, activated by
`data-forge-design="next"` on the document root. Page CSS handles composition,
charts, and a few explicit presentation treatments. The approved tokens and control styling also ship in the kit's default global
theme. Vendored primitives retain their interaction behavior.

`AppSidebar.navigationLayout="collapsible"` enables grouped navigation with
optional collapsible branches and the sidebar rail. The preview also passes `collapsible="icon"` and uses the standard
sidebar layout from the reference. The production host uses the same grouped layout. Standalone kit callers keep
the default tree layout unless they select this option.

`ScopeSwitcher.home` and `AppSidebar.scopeHome` add an optional root destination
without adding Forge to the extension scope list. Existing callers retain their
current behavior when they omit it. The preview passes the same scope IDs and
namespace paths used by the Authsome and Streaming plugins.

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
