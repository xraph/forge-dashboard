# Section rail: a secondary sidebar for a scope's own sections

> **Superseded** by `2026-09-30-studio-rail-design.md`: the rail holds the scope, its context and its plugins, not nav groups.

Design for giving a scope with many pages, authsome first, an icon rail of its
sections beside the pane, so its sub-plugins get room instead of being merged
into one 35-row list. It replaces the top-level scope rail in
`2026-09-29-scope-rail-sidebar-design.md`, which put the wrong thing in the
rail. Scopes stay in the dropdown at the top of the pane, where they were.

- Plugin contract: `packages/plugin` (a new optional `sections` field)
- Kit: `packages/kit`, which owns the rail, the pane and the shell
- Host: `packages/host`, which turns a plugin's nav into sections
- Authsome: `packages/plugin-authsome`, the first plugin to declare sections

## What this is for

You open authsome to do one kind of job at a time: manage users, look at
billing, configure SSO. Today its sidebar holds 35 entries in 8 groups, because
every sub-plugin's pages (organization, apikey, subscription, the 18
settings-only ones) are merged into authsome's own groups. Five entries are
folded into collapsed cluster rows, and the OAuth2 provider page sits two clicks
deep inside "Federation".

Success is: authsome's sections are one click away as icons, the pane shows
only the section you are in, each sub-plugin's pages sit under that sub-plugin's
name, and every other scope (core, warden, vault, relay) looks exactly as it
does today.

## Where this starts from

Seven commits on main built a top-level scope rail (`da5ee13` through
`6f34966`). We keep the parts that are not scope specific and rework the rest.

| Piece | Commit | Fate |
|---|---|---|
| `--sidebar-offset` on the sidebar container | `da5ee13` | kept as is |
| `ScopeEntries` in `scope-entries.tsx` | `b92697a`, `0bdc23a` | becomes `RailEntries` in `rail-entries.tsx`; rows presentation removed |
| `ScopeRail` and `useRailExpanded` | `1cac136` | `ScopeRail` becomes `SectionRail` without the user menu; the hook is kept |
| `AppSidebar` as a pane with a heading | `ad2df17` | scope switcher and user footer come back; heading and mobile scope rows go; the empty notice stays |
| `DashboardShell` | `2bb469a` | kept; renders the rail only when there are sections |
| host wiring and empty notices | `6f34966` | switcher wiring comes back; empty notices stay; sections are added |

The `ScopeSwitcher` component and its test were never deleted, so the dropdown
comes back by wiring alone.

## The plugin contract

`ForgePlugin` gains one optional field:

```ts
interface PluginSection {
  /** The nav `group` this section collects. Matches `PluginNavItem.group` exactly. */
  group: string
  /** Rail and heading label. Defaults to `group`. */
  label?: string
  icon: ReactNode
}

interface ForgePlugin {
  // ...existing fields
  sections?: PluginSection[]
}
```

A plugin without `sections` gets no rail and the pane it has today. Nothing
else in the contract changes: nav items keep using `group`, and sub-plugins
need no edits at all, because their items already name a group.

`definePlugin` validates at import time, the same way it already checks nav:
section groups must be non-empty and unique, and a section needs an `icon`.

## How the host builds sections

A new pure function sits beside `navGroups` in `PluginHost.tsx`:

```ts
export interface NavSection {
  id: string          // the group name
  label: string
  icon: ReactNode
  href: string        // the first page in the section
  groups: NavGroup[]  // what the pane shows for this section
}

export function navSections(
  plugin: ForgePlugin,
  subPlugins: ForgeSubPlugin[],
  segment?: string,
): NavSection[]
```

For each declared section, in declared order:

1. Collect the host plugin's items whose `group` is the section's group.
2. Collect each ready sub-plugin's items in that group. A sub-plugin with one
   item there joins the host's list. A sub-plugin with two or more gets its own
   headed group, labelled with the sub-plugin's `label` (falling back to its
   `extension`).
3. The host's list, with those single items folded in, goes through the
   existing `foldClusters` and `toNodes`, so "Threat detection" and the other
   clusters fold exactly as they do today. It is the first group, unlabelled.
4. The headed sub-plugin groups follow, in the order the sub-plugins were
   passed, each through `foldClusters` and `toNodes` as well. When every item
   in a headed group shares one cluster, the heading already groups them, so
   the cluster is dropped and the items render as plain rows.
5. `href` is the first node's `href`, or its first child's when the first node
   is a folded cluster. A section with no items is dropped.

Items whose `group` matches no declared section, and items with no `group`,
collect into one trailing section with `id` `"__more"`, label "More", and a
`MoreHorizontalIcon`. That way a sub-plugin somebody writes next year with a
new group name still shows up somewhere.

The active section is the one containing the node whose `href` matches the
current pathname, longest match first, the same rule `pageTitle` already uses.
With no match (the scope's bare root, or a detail page no nav item names) it
is the first section.

When the scope has a path-routed dimension and no segment (bare `/@auth`),
`navSections` is not called. There are no sections and no rail, and the pane
shows "Pick an app to see its pages." as it does since `6f34966`.

## Layout

Desktop, for a scope with sections:

- The rail sits on the far left: `<nav aria-label="Sections">`, one link per
  section with its icon, the label visible when widened and read by screen
  readers when not. Clicking goes to the section's `href`. The active section
  has `aria-current="page"` and the active background.
- The rail keeps its click-to-widen edge and the width remembered under
  `forge-dashboard.rail`.
- The pane is the sidebar, offset by the rail's width. Its header holds the
  scope dropdown, the context switchers and search, as before any of this work.
  Its content is the active section's `groups`, rendered by `NavMain` as today,
  which draws each headed group with its label. Its footer holds the user menu.

Desktop, for a scope without sections: no rail, offset `0px`, and the pane is
exactly the pane from before `da5ee13`.

Mobile: no rail. The sheet shows every section in order. Each section's first
group takes the section's label, and each headed sub-plugin group reads
"Billing · Plans" so it still says where it belongs. Everything else in the
sheet is as today.

## Kit changes

- `scope-entries.tsx` becomes `rail-entries.tsx`: `RailItem { id, label, href, icon? }`,
  `RailGlyph`, and `RailEntries({ items, activeId, renderLink, expanded })`,
  keeping the measured `useRender` merge, the tooltip hidden when widened, and
  the bare `data-active` attribute. The `rows` presentation, `badge`, and
  `scopeDescription` go, since the rail no longer lists scopes.
- `scope-rail.tsx` becomes `section-rail.tsx`: `SectionRail({ items, activeId, renderLink, expanded, onToggle })`,
  labelled "Sections", without `NavUser`, and with its edge toggle named
  "Expand sections" / "Collapse sections".
- `AppSidebar` gets back `onScopeSelect`, `scopeHome` and the `ScopeSwitcher`
  in its header, and `NavUser` in its footer on every viewport. It loses
  `heading`, `home`, and the mobile scope rows. It keeps `empty`. It gains
  `sections?: NavSection[]` and `activeSectionId?`: when `sections` is present
  it renders the active section's groups on desktop and every section, labelled
  as above, on mobile; `groups` is used only when `sections` is absent.
- `DashboardShell` takes `sections?` and `activeSectionId?`, renders
  `SectionRail` only when `sections` has at least one entry, and sets
  `--sidebar-offset` to `0px` when it does not.
- `NavSection` lives in the kit's `nav-tree.tsx` beside `NavGroup`, since the
  kit renders it and the host only builds it.

## Host changes

- `ScopeOption` goes back to the switcher's shape, imported from
  `scope-switcher.tsx`, and `selectScope` and `scopeHome` come back as they
  were before `6f34966`.
- The `sidebar` object gains `sections` and `activeSectionId`, computed with
  `navSections` for a ready scope that declares sections and has its segment.
- The empty notices from `6f34966` stay. The planned development-only warning
  for plugins that capabilities hides still ships.

## Authsome

`authsomePlugin` declares, in this order:

| group | icon |
|---|---|
| Identity | `UsersIcon` |
| Authentication | `KeyRoundIcon` |
| Security | `ShieldIcon` |
| Billing | `CreditCardIcon` |
| Compliance | `ScaleIcon` |
| Enterprise | `Building2Icon` |
| Configuration | `SettingsIcon` |
| System | `ServerIcon` |

Check each group name against the nav as it stands when you implement this,
because sub-plugins declare their own group strings. Icons come from the kit's
`icons` entry if it re-exports them, otherwise from `lucide-react` directly,
matching what `index.tsx` already imports.

## Testing

Unit:

- `packages/plugin`: `definePlugin` rejects a duplicate section group, an empty
  one, and one with no icon.
- `packages/host`, `nav-sections.test.tsx`: sections come out in declared
  order; a single-item sub-plugin joins the host's list and a multi-item one
  gets a headed group with its label; clusters still fold inside a section;
  unknown and missing groups land in "More"; an empty section is dropped;
  `href` is the first node, or the first child of a folded cluster; the active
  section follows the pathname, and defaults to the first.
- `packages/kit`: `RailEntries` and `SectionRail` as their predecessors were
  tested, minus scopes and badges; `AppSidebar` renders the switcher and
  footer again, the active section's groups on desktop, and every section on
  mobile; `DashboardShell` renders no rail and a `0px` offset without sections.
- `packages/host`, `host.test.tsx`: the switcher tests go back to the dropdown;
  a scope with sections renders a "Sections" rail and the active section's
  pages; a scope without sections renders no rail.

Browser, against the fixture server: authsome with the rail collapsed and
widened, Billing selected showing "Plans" as a heading over its five pages,
Security selected with the Threat detection cluster, a scope without sections
(warden) with no rail, bare `/@auth` with the pick-an-app notice, and mobile.

## Out of scope

- Real pages for OAuth2 provider, SSO, SCIM and social. They still need
  intents in `forgery/authsome` first.
- Sections for warden, vault or relay. Any of them can opt in later with one
  field.
- The uncommitted `NavigationSearch.tsx`, `site-header.tsx` and
  `ForgeDashboard.tsx` in the working tree, which committed code already
  depends on. Whoever owns them should commit them.
