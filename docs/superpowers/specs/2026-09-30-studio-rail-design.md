# Studio rail: scope, context and plugins in one rail

Design for the dashboard's navigation, copying the rail layout of TwinOS
Studio (`twinos-app/apps/studio/app/(authenticated)/components/nav/chrome/rail.tsx`
and `shell.tsx`). It replaces `2026-09-29-section-rail-design.md`, which put
authsome's nav groups in the rail. You asked for the plugins there, and for
the scope switcher and the App/Environment switcher to move out of the
sidebar and into the rail as well.

## What you get

The far left is a narrow rail. Top to bottom:

1. The scope switcher (Authsome, Warden, Vault, Relay, the root), as a glyph
   when narrow and glyph plus name when wide.
2. The context control: one button standing for every context dimension the
   scope declares. For authsome it reads "Platform / Production" when wide
   and is an app icon with that text as its tooltip when narrow. Clicking it
   opens a popover holding the App and Environment dropdowns. A scope with no
   dimensions shows nothing here.
3. Search, the existing ⌘K palette's trigger.
4. The scope's own entry (Authsome), then one entry per ready sub-plugin, in
   alphabetical order. When the rail is wide the plugin entries sit under a
   "Plugins" heading; when narrow a hairline and a gap separate them.
5. At the foot, the account menu.

The rail widens on its right edge, remembered per browser, exactly as it
does today.

Beside the rail is the secondary sidebar. It shows the pages of whichever rail
entry you are in: authsome's core pages when you are on one, Billing's five
pages when you are in Billing. Its top line names the entry. The pages are
split into sections by the `group` on each nav item. When the secondary
sidebar collapses to icons, each section label turns vertical and reads
bottom to top, and clicking it opens the sidebar again. That is Studio's
`SidebarSectionLabel`.

Every scope gets this. A scope with no sub-plugins, such as Warden, has a
rail holding the switcher, search, its one entry and the account menu.

On mobile there is no rail. The sheet holds the switcher, the context
control, search, every entry's pages stacked under the entry's name, and the
account menu.

## What goes away

- `ForgePlugin.sections` and its validation, `navSections`,
  `activeSectionId`, `MORE_SECTION`, authsome's `sections` and its test. The
  rail is built from sub-plugins now, so nothing needs declaring.
- `NavSection`, `SectionRail` and `stackSections` in the kit.
- The scope switcher, context switchers, search and user menu in the pane.

`RailEntries`, `RailGlyph`, `useRailExpanded`, `--sidebar-offset`,
`DashboardShell`, the pane's empty notice and the hidden-plugin warning stay.

## The model

The host turns the active scope into rail entries with one pure function:

```ts
export interface NavArea {
  id: string          // the plugin's or sub-plugin's extension
  label: string
  icon?: ReactNode
  href: string        // the entry's first page
  kind: "scope" | "plugin"
  groups: NavGroup[]  // what the secondary sidebar shows
}

export function navAreas(plugin, subPlugins, segment?): NavArea[]
export function activeAreaId(areas, pathname): string | undefined
```

- The scope's own area comes first. Its groups are `navGroups(plugin, [], segment)`,
  so the scope's items bucket by `group` exactly as they do today.
- Each ready sub-plugin with at least one nav item is a plugin area. Its label
  is the sub-plugin's `label`, falling back to its first nav item's label, then
  its `extension`. Its icon is the sub-plugin's `icon`, falling back to its
  first nav item's icon. Its groups bucket its own items by `group`, with the
  same first-appearance order and priority sort `navGroups` uses, through the
  same `foldClusters` and `toNodes`.
- Plugin areas sort by label, case-insensitively.
- `href` is the first node's href, or its first child's for a folded cluster.
- `activeAreaId` is the area holding the longest-prefix match for the
  pathname, the rule `pageTitle` uses, falling back to the scope's own area.

Sub-plugins still name a `group` on each nav item. Today those names are
authsome-wide categories (Security, Billing), so a plugin's pane shows one
section heading until its author splits its pages into real sections. That is
a data change in each sub-plugin, outside this design.

A scope with a path-routed dimension and no segment in the URL has no areas.
The rail then shows only the switcher, the context control, search and the
account menu, and the secondary sidebar shows "Pick an app to see its
pages." as it does now.

## Kit

- `nav-tree.tsx`: `NavArea` replaces `NavSection`.
- `section-label.tsx`, new: `SectionLabel({ children })`, a copy of Studio's
  `SidebarSectionLabel`. It renders `SidebarGroupLabel` as a button whose name
  is "Collapse Billing" or "Expand Billing", toggles the sidebar on click, and
  in icon mode switches to `[writing-mode:vertical-rl]` with `rotate-180`.
- `nav-rail.tsx`, new, replacing `section-rail.tsx`:
  `NavRail({ switcher, context, searchControl, account, items, activeId, renderLink, search, expanded, onToggle })`.
  It is a plain `<nav aria-label="Scope navigation">`, sticky and full height,
  that sets `group` and `data-collapsible="icon"` when narrow so the
  `SidebarMenuButton`-based switcher and user menu collapse with the styles
  they already have. Chrome that is a component rather than a link sits in a
  `RailSlot`, which gives it a tooltip hidden when the rail is wide, as
  Studio's does. `items[0]` is the scope entry; the rest are plugins under the
  heading or the hairline. It keeps the edge toggle, named "Expand navigation"
  and "Collapse navigation".
- `AppSidebar` becomes the secondary sidebar only:
  `{ areas?, activeAreaId?, groups, empty?, currentPath, search?, renderLink, navigationLayout?, mobileHeader?, mobileFooter? }`.
  On desktop it renders the active area's name as its header line, then one
  `SidebarGroup` per group: a `SectionLabel` when the group has a label, and
  `NavMain` over that group's items alone. With no areas it renders `groups`
  the same way. On mobile it renders `mobileHeader`, every area stacked (the
  area name, then its groups), and `mobileFooter`.
  `stackAreas(areas)` does the stacking and is exported for tests.
  `NavMain` itself is not edited.
- `DashboardShell` takes the switcher's props (`scopes`, `activeScopeId`,
  `onScopeSelect`, `scopeHome`), `context?`, `searchControl?`, `user`,
  `onSignOut`, `areas?`, `activeAreaId?` and the pane's props. It renders
  `NavRail` on every viewport it can (desktop), with `ScopeSwitcher` and
  `NavUser` in its slots, sets `--sidebar-offset` to the rail's width, and
  hands `AppSidebar` the same switcher, context, search and account as
  `mobileHeader` and `mobileFooter`.
- `ScopeSwitcher`, `NavUser` and `NavMain` are used as they are.

## Host

- `ContextControl`, new, in `packages/host/src/host/ContextControl.tsx`:
  `ContextControl({ dimensions, plugin })`. The trigger reads each
  dimension's current label through the same `useQuery(dimension.query)` and
  `dimension.select()` that `ContextSwitchers` uses, and joins them with " / ".
  It renders an `AppWindowIcon` and, when the rail is wide, the joined text and
  a chevron. It is a `PopoverTrigger`; the `PopoverContent` (side right,
  align start) holds `ContextSwitchers` unchanged. No dimensions, no control.
  Before the reads land the trigger text is "Choose context".
- `PluginHost` builds `areas` and `activeAreaId` with `navAreas`, passes
  `ContextControl` as `context` and `NavigationSearch` as `searchControl`, and
  passes every other scope and user prop to `DashboardShell` as today. Search
  and the page title look across every area's groups. The empty notices stay.

## Testing

- Host: `navAreas` puts the scope area first, sorts plugin areas by label,
  falls back for label and icon, buckets a plugin's items by `group`, folds
  clusters, links a folded cluster's area to its first child, and drops
  plugins with no nav; `activeAreaId` picks by longest prefix and falls back to
  the scope area. `host.test.tsx` finds the switcher and the plugin entries in
  the "Scope navigation" rail; a scope with sub-plugins shows only the
  selected entry's pages; the routed no-app case has no plugin entries.
- Host: `ContextControl` shows "Platform / Production", opens a popover with
  both selects, and renders nothing without dimensions.
- Kit: `NavRail` slot order, heading and hairline, tooltips hidden when wide,
  edge toggle; `SectionLabel` names and toggles, and carries the vertical
  classes; `AppSidebar` shows one area on desktop and every area on mobile;
  `DashboardShell` offsets the pane by the rail.
- Browser against the fixture: authsome with Billing selected, the context
  popover, the rail widened, the secondary sidebar collapsed with vertical
  labels, Warden, bare `/@auth`, and mobile.

## Out of scope

- Splitting each sub-plugin's pages into real sections. The `group` values
  they carry now were written for the merged sidebar.
- Icons for the settings-only sub-plugins, which show initials until they get
  one.

## Revision, 2026-09-30: core pages in the rail, no top bar

You looked at the first build and asked for three changes. They replace the
parts of this spec they contradict.

**The scope's own pages go in the rail.** Authsome's Users, Sessions, Devices,
Roles, Apps and the rest are rail entries, grouped the way their `group` says
(Identity, Configuration, Security, System). A narrow rail separates the
groups with a gap; a wide one shows each group's label. There is no separate
"Authsome" entry any more. The plugins follow under the Plugins heading as
before.

**Only a plugin with more than one page gets the secondary sidebar.** Billing
has five pages, so picking it opens the secondary sidebar with them. API Keys
and SSO have one each, so their rail entry links straight to the page and
nothing opens. On a core page there is no secondary sidebar either, and the
page sits right beside the rail. On mobile the sheet still lists everything.

A plugin's own area never folds clusters. Clusters grouped rows from different
plugins in the old merged sidebar; inside one plugin they only added a layer.

**The top bar goes.** The page sits in an inset card beside the rail (and the
secondary sidebar, when there is one). The card's first row holds the sidebar
toggle, shown only when there is a secondary sidebar or on mobile, and the
breadcrumb: the plugin's name, or the scope's when you are on a core page,
then the page title. Anything a host passes as header actions sits at the
right of that row. The theme switcher moves into the account menu as a Theme
submenu with Light, Dark and System.

The kit changes: `NavRail` takes `groups` (the core pages, in labelled groups)
and `plugins` in place of `items`. `DashboardShell` derives both from the
areas, computes which rail entry is active, renders `AppSidebar` only for a
multi-page plugin on desktop (always on mobile, where it is the sheet), and
replaces `SiteHeader` with a new `ContentHeader` inside a rounded
`SidebarInset`. `NavUser` reads the kit's own `useTheme` (next-themes) and
shows the Theme submenu only when a theme provider is mounted, so nothing
needs threading through the host. `apps/shell` drops its header button.
