# Core Pages In The Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the scope's own pages in the rail, open the secondary sidebar only for a plugin with several pages, drop the top bar for a breadcrumb row inside an inset content card, and move the theme switcher into the account menu.

**Architecture:** `DashboardShell` derives rail groups (the scope area's groups) and plugin entries from the `areas` it already receives, works out the active rail entry, and renders `AppSidebar` on desktop only when the active area is a plugin with more than one page. A new `ContentHeader` replaces `SiteHeader` inside a rounded `SidebarInset`. `NavUser` reads `useTheme` for a Theme submenu. The host stops folding clusters inside plugin areas.

**Tech Stack:** React 19, base-ui, Tailwind v4, next-themes (through `@forge-go/dashboard-kit/components/theme-provider`), vitest + testing-library, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-30-studio-rail-design.md`, section "Revision, 2026-09-30".

## Global Constraints

- Work on `main` in `/Users/rexraphael/Work/xraph/forge-dashboard`. Other sessions share the checkout and index. Commit with `git commit --only -m "<msg>" -- <paths>` (`git add` new files first); check `git show --stat HEAD`. Never `git add -A`, `git add .`, `git stash`, a bare `git reset`, or `git checkout` on other files. No trailer. No em dashes.
- Never edit (use as they are): `packages/kit/src/components/nav-main.tsx`, `scope-switcher.tsx`, `site-header.tsx`, `theme-provider.tsx`, `brand-marks.tsx`; `packages/host/src/host/NavigationSearch.tsx`, `packages/host/src/ForgeDashboard.tsx`, `packages/host/src/auth/AuthRoutes.tsx`; `packages/host/test/nav-groups.test.tsx`, `setup-screen.test.tsx`; everything under `packages/plugin-authsome/src/sub/`.
- Before staging, `git status --short` each file you will commit; if it shows changes you did not make, stop and report NEEDS_CONTEXT.
- Baselines: host `setup-screen.test.tsx` has 8 failing tests; kit package lint has 19 errors elsewhere.
- Rail: `<nav aria-label="Scope navigation">`; toggle `Expand navigation` / `Collapse navigation`; plugin heading text `Plugins`; storage key `forge-dashboard.rail`.
- Breadcrumb: `<nav aria-label="Breadcrumb">`, the last crumb carries `aria-current="page"`.
- Theme submenu trigger text `Theme`; radio items `Light`, `Dark`, `System` with values `light`, `dark`, `system`.
- base-ui state booleans render as a bare `data-active` attribute.

## Review Focus

1. On mobile the sheet must still open: the header toggle must render on mobile even when there is no secondary sidebar. Pinned in Task 2.
2. A core item with children (a folded cluster in the scope's own nav) must link to its first child, not a synthetic parent. Pinned in Task 2.
3. A page no rail entry names must still mark the nearest core entry by longest prefix, and never mark two. Pinned in Task 2.
4. Without a theme provider (tests, playground) the account menu must render with no Theme submenu and no crash. Pinned in Task 1.
5. A scope with no areas (setup, no app picked) must still show the rail chrome and the page card. Pinned in Task 2.

---

### Task 1: Theme submenu and ContentHeader

**Files:**
- Modify: `packages/kit/src/components/nav-user.tsx`
- Create: `packages/kit/src/components/content-header.tsx`
- Test: `packages/kit/test/nav-user.test.tsx` (append), `packages/kit/test/content-header.test.tsx`

**Interfaces:**
- Produces: `NavUser` unchanged props, plus a Theme submenu when `useTheme().themes.length > 0`. `export function ContentHeader({ crumbs, showTrigger, actions }: { crumbs: string[]; showTrigger: boolean; actions?: ReactNode }): ReactElement`.

- [ ] **Step 1: Failing tests**

Append to `packages/kit/test/nav-user.test.tsx` (read it first; reuse its render helper and matchMedia stub if present):

```tsx
import { ThemeProvider } from "../src/components/theme-provider"

describe("NavUser theme submenu", () => {
  it("offers Light, Dark and System when a theme provider is mounted", async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <SidebarProvider>
          <NavUser user={{ name: "Ada Lovelace", email: "ada@example.com" }} />
        </SidebarProvider>
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /Theme/ }))
    expect(await screen.findByRole("menuitemradio", { name: "Light" })).toBeTruthy()
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeTruthy()
    expect(screen.getByRole("menuitemradio", { name: "System" }).getAttribute("aria-checked")).toBe("true")
  })

  it("shows no Theme item without a theme provider", async () => {
    render(
      <SidebarProvider>
        <NavUser user={{ name: "Ada Lovelace", email: "ada@example.com" }} />
      </SidebarProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }))
    await screen.findByText("ada@example.com", { selector: "span" })
    expect(screen.queryByRole("menuitem", { name: /Theme/ })).toBeNull()
  })
})
```

If the kit's `ThemeProvider` takes different props, read it and pass what it needs. If the submenu trigger's role is not `menuitem` in base-ui, read `dropdown-menu.tsx` and use the real role.

Create `packages/kit/test/content-header.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ContentHeader } from "../src/components/content-header"

window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

describe("ContentHeader", () => {
  it("renders the crumbs with the last one current", () => {
    render(<SidebarProvider><ContentHeader crumbs={["Billing", "Plans"]} showTrigger /></SidebarProvider>)
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(nav).getByText("Billing")).toBeTruthy()
    expect(within(nav).getByText("Plans").getAttribute("aria-current")).toBe("page")
  })

  it("shows the sidebar toggle only when asked", () => {
    const { unmount } = render(<SidebarProvider><ContentHeader crumbs={["Users"]} showTrigger /></SidebarProvider>)
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy()
    unmount()
    render(<SidebarProvider><ContentHeader crumbs={["Users"]} showTrigger={false} /></SidebarProvider>)
    expect(screen.queryByRole("button", { name: "Toggle Sidebar" })).toBeNull()
  })

  it("renders actions at the end", () => {
    render(<SidebarProvider><ContentHeader crumbs={["Users"]} showTrigger={false} actions={<button type="button">Refresh</button>} /></SidebarProvider>)
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail**

`pnpm --filter @forge-go/dashboard-kit exec vitest run test/nav-user.test.tsx test/content-header.test.tsx`

- [ ] **Step 3: Implement**

In `nav-user.tsx`: import `useTheme` from `@forge-go/dashboard-kit/components/theme-provider`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem` from `dropdown-menu`, and `SunMoonIcon` from `lucide-react` (already imported from there). Inside `NavUser`, read `const { theme, setTheme, themes } = useTheme()`. Directly before the `onSignOut` block, render when `themes && themes.length > 0`:

```tsx
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SunMoonIcon />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(String(value))}>
                    <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
```

Match the kit's `DropdownMenuRadioGroup` value-change prop name if it differs.

Create `content-header.tsx`:

```tsx
import { Fragment } from "react"
import type { ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { Separator } from "@forge-go/dashboard-kit/components/separator"
import { SidebarTrigger } from "@forge-go/dashboard-kit/components/sidebar"

/**
 * The first row of the page card: the secondary sidebar's toggle, when there
 * is a sidebar to toggle, and the breadcrumb. It replaces the old top bar,
 * which carried nothing else.
 */
export function ContentHeader({
  crumbs,
  showTrigger,
  actions,
}: {
  crumbs: string[]
  showTrigger: boolean
  actions?: ReactNode
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4 lg:px-6">
      {showTrigger ? (
        <>
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-auto" />
        </>
      ) : null}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <Fragment key={`${index}:${crumb}`}>
              {index > 0 ? <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
              <span
                aria-current={last ? "page" : undefined}
                className={last ? "truncate font-medium" : "shrink-0 text-muted-foreground"}
              >
                {crumb}
              </span>
            </Fragment>
          )
        })}
      </nav>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
```

- [ ] **Step 4: Run the kit suite, typecheck, lint your files; commit**

```bash
git add packages/kit/src/components/content-header.tsx packages/kit/test/content-header.test.tsx
git commit --only -m "feat(kit): add a breadcrumb row for the page card and a theme submenu" -- packages/kit/src/components/nav-user.tsx packages/kit/src/components/content-header.tsx packages/kit/test/nav-user.test.tsx packages/kit/test/content-header.test.tsx
```

---

### Task 2: Core pages in the rail, secondary sidebar only for multi-page plugins, inset card

**Files:**
- Modify: `packages/kit/src/components/nav-rail.tsx`, `dashboard-shell.tsx`
- Modify: `packages/kit/test/nav-rail.test.tsx`, `dashboard-shell.test.tsx`

**Interfaces:**
- Consumes: `ContentHeader` (Task 1), `NavArea`, `RailEntries`, `useIsMobile` from `@forge-go/dashboard-kit/hooks/use-mobile`.
- Produces:
  - `export interface RailGroup { label?: string; items: RailItem[] }`
  - `NavRailProps`: `items` is replaced by `groups: RailGroup[]` and `plugins: RailItem[]`; everything else unchanged.
  - `export function railGroupsFor(area: NavArea | undefined): RailGroup[]`, `export function railActiveId(groups: RailGroup[], plugins: NavArea[], activeArea: NavArea | undefined, currentPath: string): string | undefined`, `export function pageCount(area: NavArea): number`, all exported from `dashboard-shell.tsx` for tests.

- [ ] **Step 1: NavRail**

Change `NavRailProps.items` to `groups: RailGroup[]` and `plugins: RailItem[]`. Render the groups in order in place of the single scope entry: for each group, when `expanded` and the group has a label, a heading span with the same classes as the Plugins heading (text = the label); when narrow and it is not the first group, `<span data-slot="rail-gap" aria-hidden="true" className="h-3" />`; then `<RailEntries items={group.items} activeId={activeId} renderLink={renderLink} search={search} expanded={expanded} />`. Then the plugins block exactly as it is today, using `plugins` in place of `pluginItems`, shown only when `plugins.length > 0`.

Update `nav-rail.test.tsx`: build `groups = [{ label: "Identity", items: [users, sessions] }, { label: "System", items: [overview] }]` and `plugins = [apikeys, billing]`, and change each test: order test unchanged in intent; hrefs test lists all five links with `?env=staging`; a new test "labels core groups when wide and separates them with a gap when narrow" asserts `getByText("Identity")` wide, and `querySelector('[data-slot="rail-gap"]')` narrow; the no-plugins test passes `plugins: []`.

- [ ] **Step 2: DashboardShell**

Add these helpers above the component:

```tsx
/** The scope's own pages as rail groups. A folded cluster links to its first page. */
export function railGroupsFor(area: NavArea | undefined): RailGroup[] {
  if (!area) return []
  return area.groups.map((group) => ({
    label: group.label,
    items: group.items.map((node) => ({
      id: node.href,
      label: node.label,
      href: node.children?.[0]?.href ?? node.href,
      icon: node.icon,
    })),
  }))
}

/** Every page an area lists, counting a folded cluster's children. */
export function pageCount(area: NavArea): number {
  return area.groups.reduce(
    (sum, group) => sum + group.items.reduce((n, node) => n + (node.children?.length || 1), 0),
    0,
  )
}

/**
 * Which rail entry is lit: the plugin you are in, or else the core page whose
 * href is the path or its longest prefix. One answer, never two.
 */
export function railActiveId(
  groups: RailGroup[],
  plugins: NavArea[],
  activeArea: NavArea | undefined,
  currentPath: string,
): string | undefined {
  if (activeArea?.kind === "plugin" && plugins.some((p) => p.id === activeArea.id)) return activeArea.id
  let best: { id: string; length: number } | undefined
  for (const group of groups) {
    for (const item of group.items) {
      for (const href of new Set([item.id, item.href])) {
        const matches = href === currentPath || (href !== "/" && currentPath.startsWith(`${href}/`))
        if (matches && (!best || href.length > best.length)) best = { id: item.id, length: href.length }
      }
    }
  }
  return best?.id
}
```

In `DashboardShell`:

```tsx
  const isMobile = useIsMobile()
  const areas = pane.areas ?? []
  const scopeArea = areas.find((area) => area.kind === "scope")
  const pluginAreas = areas.filter((area) => area.kind === "plugin")
  const activeArea = areas.find((area) => area.id === pane.activeAreaId)
  const groups: RailGroup[] = scopeArea
    ? railGroupsFor(scopeArea)
    : areas.length === 0
      ? railGroupsFor({ id: "", label: "", href: "", kind: "scope", groups: pane.groups })
      : []
  const plugins = pluginAreas.map((area) => ({ id: area.id, label: area.label, href: area.href, icon: area.icon }))
  const activeId = railActiveId(groups, pluginAreas, activeArea, pane.currentPath)
  const secondary = activeArea?.kind === "plugin" && pageCount(activeArea) > 1 ? activeArea : undefined
  const crumbs = [secondary?.label ?? (activeArea?.kind === "plugin" ? activeArea.label : scope), title].filter(
    (crumb): crumb is string => Boolean(crumb),
  )
```

Render:

```tsx
    <SidebarProvider className="bg-sidebar" style={{ "--sidebar-offset": expanded ? "var(--sidebar-width)" : "var(--sidebar-width-icon)" } as CSSProperties}>
      <NavRail switcher={switcher} context={context} searchControl={searchControl} account={account}
        groups={groups} plugins={plugins} activeId={activeId}
        renderLink={pane.renderLink} search={pane.search} expanded={expanded} onToggle={toggle} />
      {isMobile || secondary ? (
        <AppSidebar {...pane} activeAreaId={secondary?.id ?? pane.activeAreaId}
          mobileHeader={<>{switcher}{context}{searchControl}</>} mobileFooter={account}
          variant="sidebar" collapsible="icon" navigationLayout="collapsible" />
      ) : null}
      <SidebarInset className="md:my-2 md:mr-2 md:ml-2 md:overflow-hidden md:rounded-xl md:border md:border-sidebar-border md:shadow-sm">
        <ContentHeader crumbs={crumbs} showTrigger={Boolean(isMobile || secondary)} actions={actions} />
        <div id="dashboard-main" className="@container/main flex min-w-0 flex-1 flex-col gap-6 px-4 pb-4 md:px-6 md:pb-6 xl:px-8 xl:pb-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
```

Keep the `@container/main` comment above the `#dashboard-main` div. Remove the `SiteHeader` import. Drop `activeAreaId` from what NavRail receives (it now takes the computed `activeId`).

- [ ] **Step 3: Rewrite `dashboard-shell.test.tsx`**

Use areas: scope `auth` with groups Identity [Users `/@auth/users`], System [Overview `/@auth`]; plugin `subscription` "Billing" with two pages [Plans `/@auth/plans`, Invoices `/@auth/invoices`]; plugin `apikey` "API Keys" with one page [`/@auth/apikeys`]. Tests:
- on `/@auth/users` (activeAreaId `auth`): the rail has links Users, Overview, API Keys, Billing; Users has `aria-current="page"` and Overview does not; there is no `[data-slot="sidebar"]` (no secondary sidebar); the Breadcrumb reads `Authsome` then the title; there is no "Toggle Sidebar" button; `#dashboard-main` holds the children and keeps `@container/main`.
- on `/@auth/users/usr_1` the Users entry is still the one lit.
- on `/@auth/plans` (activeAreaId `subscription`): the rail's Billing link is current; a secondary sidebar exists and lists Plans and Invoices; the Breadcrumb starts with `Billing`; "Toggle Sidebar" exists and toggling it sets the sidebar's `data-collapsible` to `icon`.
- on `/@auth/apikeys` (activeAreaId `apikey`): API Keys is current and there is no secondary sidebar.
- the rail still shows switcher, context, search and account once each; `--sidebar-offset` follows the rail's width on expand.
- no areas and `empty` set: the rail has no links, the chrome is there, and the empty notice text is on screen (it now renders in the rail-less page only on mobile; assert it in a mobile render with the sheet open, or move the assertion to `app-sidebar.test.tsx` where it already exists; say which you did).
- mobile (innerWidth 500): no rail, a "Toggle Sidebar" button exists even on a core page.

- [ ] **Step 4: Run the kit suite, typecheck, lint; commit**

```bash
git commit --only -m "feat(kit): put the scope's pages in the rail and open a sidebar only for multi-page plugins" -- packages/kit/src/components/nav-rail.tsx packages/kit/src/components/dashboard-shell.tsx packages/kit/test/nav-rail.test.tsx packages/kit/test/dashboard-shell.test.tsx
```

---

### Task 3: Host follows, clusters stop folding inside plugins, shell drops its header button

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (`groupItems` only), `packages/host/test/nav-areas.test.tsx`, `packages/host/test/host.test.tsx`, `packages/host/test/routed-context.test.tsx`, `packages/host/test/host-playground.test.tsx` as needed
- Modify: `apps/shell/src/App.tsx`
- Modify: `docs/superpowers/specs/2026-09-30-studio-rail-design.md` (one sentence)

- [ ] **Step 1: Plugin areas stop folding clusters**

In `groupItems`, map items to `{ ...item, cluster: undefined }` before sorting and bucketing, and say why in its doc comment: the area is the grouping; clusters only mattered when plugins shared one list. In `nav-areas.test.tsx` replace "folds a cluster inside a plugin and links the area to its first real page" with "does not fold clusters inside a plugin's own area" (the `risk` fixture's first group holds the two plain pages `["Risk Engine", "Risk Rules"]` with no `children`; `href` is `/@auth/security/risk`), and add a test that a scope's own nav with two items sharing a cluster still folds. RED before, GREEN after. In the spec's "The model" section, change the sub-plugin bullet's "through the same `foldClusters` and `toNodes`" to say clusters are dropped because the area is the grouping.

- [ ] **Step 2: Host tests follow the layout**

Run `pnpm --filter @forge-go/dashboard-host test`. Core nav links now live in the "Scope navigation" rail, not in `[data-slot="sidebar-content"]`, and there is no secondary sidebar on core pages or single-page plugins. Adapt every failing assertion that looked for a core link or the scope heading in `content(container)` or `header(container)` to look in the rail instead; the sub-plugin test's Billing plugin has two pages, so its secondary sidebar assertions stay. The empty notices render in the secondary sidebar, which is not mounted on desktop without a multi-page plugin: move the host's empty-notice assertions to check the notice is absent from the page and that the rail has no links, OR, if the notice must stay visible on desktop, report NEEDS_CONTEXT instead of guessing. List every test you changed and why.

- [ ] **Step 3: The shell app drops its header button**

In `apps/shell/src/App.tsx`, remove the `headerActions` prop and the `Button`, `MoonIcon`, `SunIcon` and `useTheme` imports and the `dark` computation it needed; the account menu now carries the theme.

- [ ] **Step 4: Verify and commit**

Run the host suite (only the 8 setup-screen failures), `pnpm typecheck`, eslint on changed files. Commit:

```bash
git commit --only -m "feat(host): follow the rail layout, and stop folding clusters inside a plugin" -- packages/host/src/host/PluginHost.tsx packages/host/test/nav-areas.test.tsx packages/host/test/host.test.tsx packages/host/test/routed-context.test.tsx packages/host/test/host-playground.test.tsx apps/shell/src/App.tsx docs/superpowers/specs/2026-09-30-studio-rail-design.md
```

(Leave out any listed path you did not change.)

---

### Task 4: Browser pass

Against the fixture: `/@auth/platform/users` shows core icons in the rail with gaps, no secondary sidebar, the page in a rounded card whose first row reads "Authsome > Users"; Billing opens the secondary sidebar with five plain rows and the row reads "Billing > Plans"; API Keys opens no sidebar; widen the rail to see Identity/Configuration/Security/System labels and the Plugins heading; the account menu has Theme with Light/Dark/System and switching works; mobile sheet opens from the row's toggle on a core page.
