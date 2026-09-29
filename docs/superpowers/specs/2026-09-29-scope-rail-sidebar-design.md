# Scope rail: a two-column sidebar for the dashboard shell

> **Superseded** by `2026-09-29-section-rail-design.md`. The rail belongs inside a scope, for its own sections and sub-plugins, not across scopes.

Design for replacing the scope dropdown in the dashboard sidebar with an icon
rail of scopes beside a pane that holds the active scope's pages. The pattern is
the "rail" mode of TwinOS Studio's navigation
(`twinos-app/apps/studio/app/(authenticated)/components/nav/chrome/rail.tsx`),
adapted to this repo's plugin host.

- Kit: `packages/kit`, which owns the sidebar primitives and `AppSidebar`
- Host: `packages/host`, which computes scopes and nav and renders the shell
- Shell app: `apps/shell`, checked in the browser against `packages/fixture-server`

## What this is for

You open the dashboard to administer one extension at a time: authsome, warden,
vault, relay, or the core pages. Today the sidebar shows the active scope's nav
and hides every other scope behind a dropdown at the top. That works with three
scopes and eight pages. It does not work for authsome, which contributes 35 nav
entries across 8 groups once its sub-plugins mount, with five of those entries
folded into collapsed cluster rows ("Threat detection", "Location security",
"Passwordless", "Federation", "Billing"). The OAuth2 provider and social login
pages live inside "Federation", two clicks from anywhere, and the report that
started this work was "I guess it was missing".

The person this is for runs a Forge deployment with several extensions and
switches between them many times a day. Success is: every scope is one click
away from every page, authsome's nav has a full column to itself, the shell
says something when a scope has nothing to show instead of going blank, and the
playground app keeps working without changes.

## What the investigation found

These were read from source or reproduced against the fixture server.

### The nav renders; it is the arrangement that fails

Against `packages/fixture-server`, `/@auth` redirects to
`/@auth/platform/users` within a second and the sidebar shows all 35 entries.
The sub-plugins (organization, apikey, waitlist, consent, subscription,
notification, password, and the 18 settings-only ones) all mount because the
fixture lists all 30 contributors as `configured=true`. So "not visible" was
not a missing plugin. It was a 35-row list in a 256px column with the
interesting rows collapsed.

### Two cases empty the nav on purpose, and say nothing

`PluginHost.tsx` around line 770 empties `groups` when the active scope has a
path-routed context dimension and the URL carries no segment (bare `/@auth`).
The plan that introduced it (`plans/2026-09-22-routed-context.md`, Task 4)
says a scope with no app picked contributes no nav items, which is right. The
pane still renders nothing in that state, and nothing tells you why.

The second case is `resolvePluginState` in `packages/plugin/src/resolve.ts`
returning `hidden` when capabilities has no contributor with the plugin's
`extension` name. `PluginHost` filters those scopes out silently. A typo in
`extension`, or a server that does not ship a contributor, gives you a scope
that never appears and no log line.

### The shadcn `Sidebar` is `position: fixed`

`packages/kit/src/components/sidebar.tsx` renders a `sidebar-gap` div in flow
and a `sidebar-container` div at `fixed inset-y-0 left-0`. Two of them overlap.
TwinOS hit this first: its rail is a plain `nav` and its pane is the design
system's `Sidebar` pushed right with `!left-12`, and their own notes call that
offset the thing to get rid of (ruling R31 in the studio nav ledger). This repo
owns its copy of `sidebar.tsx`, so we can fix it at the source instead of
overriding it from the host.

### `NavMain` already handles the collapsed pane

`nav-main.tsx` renders folded clusters as `Collapsible` rows when the sidebar
is open and as a `DropdownMenu` flyout when `useSidebar().state` is
`collapsed`. The host runs the sidebar with `collapsible="icon"` so that branch
is live today. Nothing in the pane's nav needs to change.

### The "incomplete" pages are a backend gap, not a React one

The OAuth2 provider, SSO, SCIM and social pages under `/@auth/platform/auth/*`
and `/enterprise/*` are the generic `settingsPanelFor` component from
`packages/plugin-authsome/src/sub/settings-only.tsx`. Against the fixture they
render "This plugin has nothing to configure." In the authsome Go repo, all
four plugins have a `contract/manifest.yaml` and all four declare
`intents: []`. Their templ dashboards still render real screens (OAuth2 client
create and edit, an SSO providers list, SCIM tokens and logs) but expose none
of it through the dashboard contract. Real React pages for them need intents
added on the Go side first. That is a separate piece of work in
`forgery/authsome` and this design does not touch it.

## Decisions taken

1. Two columns: a 48px icon rail listing the scopes, and a pane holding the
   active scope's context switchers and nav. The scope dropdown goes away.
2. The rail widens to show labels when you click its edge, the same edge
   strip Studio uses. The state is per browser, in `localStorage`, and
   defaults to collapsed.
3. The arrangement lives in the kit, not the host. A new `DashboardShell`
   owns rail, pane and inset; `PluginHost` passes it the props it already
   computes.
4. The pane keeps `collapsible="icon"`. The sidebar trigger and ⌘B shrink it to
   an icon column beside the rail, and `NavMain`'s flyouts keep working.
5. The user menu moves to the foot of the rail. Search stays in the pane
   header, and ⌘K keeps opening it whichever state the pane is in.
6. Nav groups are unchanged. No regrouping by sub-plugin; the pane shows
   `navGroups()` output as it stands, clusters and all.
7. The two silent-empty cases get a short message in the pane, and hidden
   plugins get a development-only warning in the console.

## Components

All new files go in `packages/kit/src/components/`, exported through the
existing `./components/*` entry in `packages/kit/package.json`, so you import
them the way you import `AppSidebar` today.

### `dashboard-shell.tsx`

```tsx
export interface DashboardShellProps extends AppSidebarProps {
  title?: string
  scope?: string
  actions?: ReactNode
  children: ReactNode
}
```

Renders, in order:

```tsx
<SidebarProvider style={{ "--sidebar-offset": railWidth }}>
  <ScopeRail scopes home activeScopeId user onSignOut renderLink />
  <AppSidebar variant="sidebar" collapsible="icon" navigationLayout="collapsible" {...pane} />
  <SidebarInset>
    <SiteHeader title scope actions />
    <div id="dashboard-main" className="@container/main ...">{children}</div>
  </SidebarInset>
</SidebarProvider>
```

`railWidth` is the rail's current width as a CSS length: `var(--sidebar-width-icon)`
collapsed, `var(--sidebar-width)` expanded. The `@container/main` div and
its comment move here from `HostShell`; that container name is load bearing for
the stat cards and must not be lost in the move.

`HostShell` in `PluginHost.tsx` becomes a wrapper that renders `DashboardShell`
and keeps `SidebarRouteSync` inside the provider. Nothing about how the host
builds its `sidebar` object changes.

### `scope-rail.tsx`

A plain `<nav aria-label="Scopes">`, `sticky top-0 h-svh shrink-0`, with the
same `group` class and `data-collapsible="icon"` attribute the shadcn sidebar
sets when collapsed, so `NavUser`'s existing `group-data-[collapsible=icon]:`
styles work unchanged inside it. Width is `w-(--sidebar-width-icon)` collapsed
and `w-(--sidebar-width)` expanded, with the same 200ms width transition the
pane uses.

Top to bottom:

- the root plugin as a pinned home entry, when there is one
- one entry per scope, in the order the host passes them
- a spacer
- `NavUser` at the foot

Each entry is a link, rendered through the same `renderLink` the pane uses, so
you can middle-click a scope into a new tab and tab through the rail with the
keyboard like any other nav link.
The entry shows the scope icon (or a rounded square with the label's first
letter, which is `ScopeGlyph` moved here from `scope-switcher.tsx`) and a label
that is visible when expanded and `sr-only` when collapsed. A tooltip on the
right repeats the label, with `hidden` set while the rail is expanded. The
active entry carries `aria-current="page"` and the active background.

A scope whose `badge` is `setup` or `mismatch` gets a small dot on its glyph,
and its tooltip and `sr-only` text read "Authsome (needs setup)" or
"Authsome (version mismatch)".

The edge toggle is a `<button aria-expanded>` absolutely positioned over the
rail's right border, 16px wide, straddling it, with a 2px line that shows on
hover and focus. It is in the tab order. Clicking it flips the state and writes
`forge-dashboard.rail=expanded|collapsed` to `localStorage`, inside try/catch
so a private window or blocked storage never throws.

Below the `md` breakpoint the rail returns `null`. The mobile path is in the
pane, below.

### `AppSidebar` becomes the pane

It loses the `ScopeSwitcher` and the `NavUser` footer, and its props change:

```ts
export interface AppSidebarProps {
  scopes: ScopeOption[]          // still needed: the mobile sheet lists them
  home?: ScopeOption
  activeScopeId?: string
  heading?: { label: string; namespace?: string; icon?: ReactNode }
  empty?: { message: string; href?: string; label?: string }
  groups: NavGroup[]
  currentPath: string
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
  header?: ReactNode
  navigationLayout?: "tree" | "collapsible"
  user: { name: string; email: string; avatar?: string }
  onSignOut?: () => void
}
```

`user` and `onSignOut` stay on the props because `DashboardShell` spreads one
object into both columns; the pane ignores them on desktop and the rail ignores
`groups`.

The header renders, in order: the mobile scope list (only when
`useSidebar().isMobile`), the heading, then `header`. The heading is a
non-interactive row: glyph, label, and `@namespace` in muted text, the same
layout the switcher trigger drew, minus the chevron. Icon-collapsed, the label
and namespace hide and the glyph stays, so the column is never headless.

When `empty` is set the content area shows its message in muted text under
the header, with an optional link below it. `groups` still render if there
are any; in practice the host sends one or the other.

`back` is removed. The host never passed it and the rail is now the way out of a
scope.

### `sidebar.tsx` gains one variable

`sidebar-container`'s `left` becomes `var(--sidebar-offset, 0px)`, and the
offcanvas hidden position becomes
`calc(var(--sidebar-offset, 0px) - var(--sidebar-width))`. The variable is
read from the nearest ancestor, which is the `SidebarProvider` wrapper
`DashboardShell` sets it on. A `SidebarProvider` with no shell around it
resolves to `0px` and behaves exactly as today, which is what keeps the
playground and the kit's own tests untouched. Nothing else in the file changes.

### `ScopeSwitcher` is deleted

Once `AppSidebar` no longer imports it, `scope-switcher.tsx` and
`scope-switcher.test.tsx` go. `ScopeGlyph` moves to `scope-rail.tsx` first.
Grep for other importers before you delete it; the search palette in the host
uses its own scope list and does not import the switcher.

## Props and data flow

`ScopeOption` gains `href: string`. `PluginHost` already computes
`homePathFor(scope.plugin)` for the search palette and for `selectScope`, so
`scopeOptions` gets it as one more field and `scopeHome` becomes a
`ScopeOption` with `href` too. `onScopeSelect` and `scopeHome.onSelect` are
removed; navigation is the link.

The host computes `heading` from `navOwner` (label, namespace, icon) and
`empty` from the two cases below. Everything else in the `sidebar` object is
already there.

## Empty states

Two cases, both decided in `PluginHost` where the information already is:

- Routed scope with no segment (`ownerDimension && !ownerSegment`):
  `{ message: "Pick an app to see its pages." }`. The context switchers above
  it still render, so you can pick one without leaving the page.
- Scope in `setup` or `mismatch`: `{ message, href: homePathFor(plugin), label: "Open setup" }`,
  where `message` is the state's own message when it has one and otherwise
  "This extension needs configuring." or "This extension needs a newer server."

A ready scope with a segment and an empty `navGroups()` result stays silent, as
today. That is a plugin with no nav, which is legal.

## Diagnostics for hidden plugins

When `resolvePluginState` returns `hidden` for a plugin or sub-plugin,
`PluginHost` calls `console.warn` once per extension name per capabilities
document, guarded by `process.env.NODE_ENV !== "production"`:

```
[forge-dashboard] plugin "auth" is hidden: capabilities lists no contributor
named "auth". Contributors: core-contract, streaming-contract, warden, vault
```

A `useRef<Set<string>>` keyed on the capabilities object keeps it to one line
per name, so you don't get the same warning on every re-render. Production builds log nothing. The existing test that a hidden
sub-plugin is "not an error" still holds; a warning is not an error.

## Mobile

Below `md` the rail is not rendered and the pane's `Sheet` is the whole
navigation you get. `AppSidebar`'s header renders `ScopeEntries` as `SidebarMenu`
rows above the heading: home first, then each scope, each a link with the same
glyph, label, namespace and badge dot the rail draws. Selecting one navigates
and closes the sheet, through `useSidebar().setOpenMobile(false)` on click, the
same call `NavigationSearch` makes.

`ScopeEntries` is the one component that renders the list; the rail and the
sheet pass it a `presentation` of `"rail"` or `"rows"`.

## Testing

Kit, under `packages/kit/test/`:

- `scope-rail.test.tsx`: entries render as links with `href`; the active entry
  has `aria-current="page"`; a `setup` badge renders a dot and the tooltip text
  names the state; the edge toggle flips `aria-expanded` and writes the storage
  key; a throwing `localStorage` does not break rendering; labels are `sr-only`
  when collapsed and visible when expanded; the rail renders nothing when
  `useSidebar().isMobile` is true.
- `dashboard-shell.test.tsx`: sets `--sidebar-offset` on the provider wrapper
  to the icon width by default and the full width after expanding; renders
  `#dashboard-main` with the `@container/main` class; renders `SiteHeader` with
  the title.
- `app-sidebar.test.tsx`: updated for the heading, the `empty` message and
  link, the mobile scope rows, and the removal of the switcher and footer.
- `scope-switcher.test.tsx`: deleted with the component.
- `smoke.test.tsx`: a `SidebarProvider` with no shell still positions the
  sidebar at `left: 0`.

Host, under `packages/host/test/`:

- `host.test.tsx` and `nav-groups.test.tsx`: updated for `DashboardShell` and
  the new `sidebar` fields; existing assertions about groups and links are
  unchanged.
- A new case that bare `/@auth` renders "Pick an app to see its pages." and a
  scope in `setup` renders its message with an "Open setup" link.
- A new case that a plugin missing from capabilities produces one `console.warn`
  naming it, and none in production.
- `host-playground.test.tsx`: unchanged and passing, which is the proof the
  playground needs no edits.

Browser, against `fixture-server` and `dashboard-shell` from
`.claude/launch.json`:

- desktop at the auth scope, rail collapsed and expanded
- pane icon-collapsed beside the rail, with a cluster flyout open
- bare `/@auth` with the empty message (reachable by stopping the fixture's
  `apps.context` from returning a current app)
- mobile width with the sheet open and the scope rows visible

Screenshots of each go in the final report. Run `pnpm test` from the repo root
for the unit side; turbo runs kit and host together.

## Out of scope

- Real pages for OAuth2 provider, SSO, SCIM and social. Blocked on intents in
  `forgery/authsome`; scope them against the templ pages that already exist
  there.
- The `apps.switch` cookie the host never reads back
  (`RoutedScope.tsx` around line 182).
- Any change to `navGroups()`, cluster folding, or the routed-context rules.
- A rail that widens on hover, or that remembers its state per scope.
