# Studio Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy TwinOS Studio's rail layout: a rail holding the scope switcher, one App/Environment control, search, the scope's own entry, one entry per sub-plugin and the account menu, with the selected entry's pages in a secondary sidebar whose section labels turn vertical when it collapses.

**Architecture:** The host turns a scope and its ready sub-plugins into `NavArea[]` with `navAreas()`. The kit's `DashboardShell` renders a `NavRail` (switcher, context, search, entries, account in slots) and an `AppSidebar` that shows the active area's groups under `SectionLabel`s. A new host `ContextControl` puts the existing `ContextSwitchers` in a popover behind one trigger. The earlier `sections` contract and section rail are removed.

**Tech Stack:** React 19, react-router, base-ui (`useRender`, Tooltip, Popover), Tailwind v4, lucide icons via `@forge-go/dashboard-kit/icons`, vitest + @testing-library/react under jsdom, pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-09-30-studio-rail-design.md`

## Global Constraints

- Work directly on `main` in `/Users/rexraphael/Work/xraph/forge-dashboard`. Other sessions share this checkout and index. Commit with `git commit --only -m "<msg>" -- <your paths>` and check `git show --stat HEAD` afterwards. Never `git add -A`, `git add .`, `git stash`, a bare `git reset`, or `git checkout` on other files. To unstage your own mistake use `git restore --staged -- <path>`.
- No Co-Authored-By or any other trailer in commit messages. No em dashes anywhere you write.
- Never edit these files; they carry another session's uncommitted work and are used as they are: `packages/kit/src/components/nav-main.tsx`, `packages/kit/src/components/scope-switcher.tsx`, `packages/kit/src/components/site-header.tsx`, `packages/kit/src/components/brand-marks.tsx`, `packages/host/src/host/NavigationSearch.tsx`, `packages/host/src/ForgeDashboard.tsx`, `packages/host/src/auth/AuthRoutes.tsx`, `packages/host/test/nav-groups.test.tsx`, `packages/host/test/setup-screen.test.tsx`.
- Kit files import each other through `@forge-go/dashboard-kit/...`, never relative paths. Icons come from `@forge-go/dashboard-kit/icons`.
- Run one test file with `pnpm --filter <pkg> exec vitest run test/<file>`. Packages: `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`, `@forge-go/dashboard-host`, `@forge-go/dashboard-plugin-authsome`.
- Baselines, not failures: `packages/host/test/setup-screen.test.tsx` has 8 failing tests; package-wide kit lint has 19 errors in unrelated files. Only your own files must lint clean.
- base-ui state booleans render as a bare `data-active` attribute: use `data-active:` variants and assert with `hasAttribute("data-active")`.
- base-ui `render` merge rule: the render element's own props and children win, `className` strings join, a component prop lands only where the element left it unset.
- Rail: `<nav aria-label="Scope navigation">`; edge toggle named `Expand navigation` / `Collapse navigation`; plugin heading text `Plugins`; storage key stays `forge-dashboard.rail`.
- Section labels: accessible name `Collapse <label>` / `Expand <label>`; icon-mode classes include `group-data-[collapsible=icon]:[writing-mode:vertical-rl]` and `group-data-[collapsible=icon]:rotate-180`.
- Mobile stacked label format: `${area.label} · ${group.label}`.
- Empty notice copy unchanged: `Pick an app to see its pages.`, `This extension needs configuring.`, `This extension needs a newer server.`, `Open setup`.

## Review Focus

1. A rail entry link must keep the query string (`?env=staging`), because it navigates inside the scope and env is a query dimension. Pinned in Task 1 (`RailEntries` already does; `NavRail` passes `search`) and Task 5 (host test).
2. A scope with a routed dimension and no app picked must show a rail with no entries and the pick-an-app notice, never entries linking to an app nobody chose. Pinned in Task 5.
3. The switcher, search and account menu must render once: in the rail on desktop, in the sheet on mobile, never both. Pinned in Task 2.
4. A sub-plugin with no nav items must not appear as an empty rail entry. Pinned in Task 3.
5. The context trigger's accessible name must be the joined current values, so a screen reader hears "Platform / Production" rather than "button". Pinned in Task 4.

---

### Task 1: `NavArea`, `SectionLabel` and `NavRail` in the kit

**Files:**
- Modify: `packages/kit/src/components/nav-tree.tsx` (add `NavArea` after `NavSection`; `NavSection` stays until Task 2)
- Create: `packages/kit/src/components/section-label.tsx`
- Create: `packages/kit/src/components/nav-rail.tsx`
- Test: `packages/kit/test/section-label.test.tsx`
- Test: `packages/kit/test/nav-rail.test.tsx`

**Interfaces:**
- Consumes: `RailEntries`, `RailItem`, `RenderRailLink` from `rail-entries.tsx`; `SidebarGroupLabel`, `useSidebar` from `sidebar.tsx`; `Tooltip*` from `tooltip.tsx`.
- Produces:
  - `export interface NavArea { id: string; label: string; icon?: ReactNode; href: string; kind: "scope" | "plugin"; groups: NavGroup[] }`
  - `export function SectionLabel({ children }: { children: string }): ReactElement`
  - `export interface NavRailProps { switcher?: ReactNode; context?: ReactNode; searchControl?: ReactNode; account?: ReactNode; items: RailItem[]; activeId?: string; renderLink: RenderRailLink; search?: string; expanded: boolean; onToggle: () => void }`
  - `export function NavRail(props: NavRailProps): ReactElement | null`

- [ ] **Step 1: Add `NavArea`**

In `packages/kit/src/components/nav-tree.tsx`, directly after the `NavSection` interface, add:

```ts
/**
 * One entry in the rail and the pages it opens in the secondary sidebar: the
 * scope itself, or one of its sub-plugins. The host builds these; the kit only
 * draws them. `href` is the entry's first page.
 */
export interface NavArea {
  id: string
  label: string
  icon?: ReactNode
  href: string
  kind: "scope" | "plugin"
  groups: NavGroup[]
}
```

- [ ] **Step 2: Write the failing SectionLabel test**

```tsx
// packages/kit/test/section-label.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Sidebar, SidebarProvider } from "../src/components/sidebar"
import { SectionLabel } from "../src/components/section-label"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

function renderLabel() {
  return render(
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SectionLabel>Billing</SectionLabel>
      </Sidebar>
    </SidebarProvider>,
  )
}

describe("SectionLabel", () => {
  it("is a button named for collapsing while the sidebar is open", () => {
    renderLabel()
    const label = screen.getByRole("button", { name: "Collapse Billing" })
    expect(label.getAttribute("aria-expanded")).toBe("true")
    expect(label.textContent).toBe("Billing")
  })

  it("toggles the sidebar and renames itself", () => {
    const { container } = renderLabel()
    fireEvent.click(screen.getByRole("button", { name: "Collapse Billing" }))
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
    expect(screen.getByRole("button", { name: "Expand Billing" }).getAttribute("aria-expanded")).toBe("false")
  })

  it("carries the vertical classes for icon mode", () => {
    renderLabel()
    const cls = screen.getByRole("button", { name: "Collapse Billing" }).className
    expect(cls).toContain("group-data-[collapsible=icon]:[writing-mode:vertical-rl]")
    expect(cls).toContain("group-data-[collapsible=icon]:rotate-180")
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/section-label.test.tsx`
Expected: FAIL, cannot resolve `../src/components/section-label`.

- [ ] **Step 4: Write `section-label.tsx`**

```tsx
// packages/kit/src/components/section-label.tsx
import {
  SidebarGroupLabel,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

/**
 * A section heading in the secondary sidebar, copied from TwinOS Studio's
 * SidebarSectionLabel. Open, it is an ordinary label. Collapsed to icons, it
 * stays on screen as vertical text reading bottom to top, so you can still
 * see which section an icon belongs to. Either way it is a button that
 * toggles the sidebar.
 */
export function SectionLabel({ children }: { children: string }) {
  const { isMobile, openMobile, state, toggleSidebar } = useSidebar()
  const expanded = isMobile ? openMobile : state === "expanded"
  const action = `${expanded ? "Collapse" : "Expand"} ${children}`

  return (
    <SidebarGroupLabel
      aria-expanded={expanded}
      aria-label={action}
      className="w-full cursor-pointer justify-start text-start hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:max-h-48 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:truncate group-data-[collapsible=icon]:rotate-180 group-data-[collapsible=icon]:py-2 group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:[writing-mode:vertical-rl]"
      onClick={toggleSidebar}
      render={<button type="button" />}
      title={action}
    >
      {children}
    </SidebarGroupLabel>
  )
}
```

If the kit's `SidebarGroupLabel` does not accept `render`, read it in `sidebar.tsx` (it is built on `useRender`) and report NEEDS_CONTEXT rather than editing `sidebar.tsx`.

- [ ] **Step 5: Run the SectionLabel test**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/section-label.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing NavRail test**

```tsx
// packages/kit/test/nav-rail.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { NavRail } from "../src/components/nav-rail"
import type { RailItem } from "../src/components/rail-entries"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

const items: RailItem[] = [
  { id: "auth", label: "Authsome", href: "/@auth/p/users" },
  { id: "apikey", label: "API Keys", href: "/@auth/p/apikeys" },
  { id: "subscription", label: "Billing", href: "/@auth/p/plans" },
]

function renderRail(props: Partial<React.ComponentProps<typeof NavRail>> = {}) {
  const onToggle = vi.fn()
  const view = render(
    <SidebarProvider>
      <NavRail
        switcher={<button type="button">Switch scope</button>}
        context={<button type="button">Platform / Production</button>}
        searchControl={<button type="button">Search pages</button>}
        account={<button type="button">Account menu</button>}
        items={items}
        activeId="subscription"
        renderLink={renderLink}
        search="?env=staging"
        expanded={false}
        onToggle={onToggle}
        {...props}
      />
    </SidebarProvider>,
  )
  return { ...view, onToggle }
}

const rail = () => screen.getByRole("navigation", { name: "Scope navigation" })
const originalWidth = window.innerWidth

describe("NavRail", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("puts switcher, context and search above the entries and the account at the foot", () => {
    renderRail()
    const order = within(rail())
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t && !/navigation/.test(t))
    expect(order).toEqual(["Switch scope", "Platform / Production", "Search pages", "Account menu"])
    const account = within(rail()).getByRole("button", { name: "Account menu" })
    const lastLink = within(rail()).getAllByRole("link").at(-1)!
    expect(lastLink.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("links every entry with the query string and marks the active one", () => {
    renderRail()
    const links = within(rail()).getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/@auth/p/users?env=staging",
      "/@auth/p/apikeys?env=staging",
      "/@auth/p/plans?env=staging",
    ])
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
  })

  it("heads the plugin entries with Plugins when wide, and not when narrow", () => {
    const narrow = renderRail()
    expect(within(rail()).queryByText("Plugins")).toBeNull()
    expect(rail().querySelector('[data-slot="rail-divider"]')).toBeTruthy()
    narrow.unmount()
    renderRail({ expanded: true })
    expect(within(rail()).getByText("Plugins")).toBeTruthy()
  })

  it("renders no heading or divider when the scope has no plugins", () => {
    renderRail({ items: items.slice(0, 1), expanded: true })
    expect(within(rail()).queryByText("Plugins")).toBeNull()
    expect(rail().querySelector('[data-slot="rail-divider"]')).toBeNull()
  })

  it("marks itself collapsed so SidebarMenuButton children shrink, and widens", () => {
    const narrow = renderRail()
    expect(rail().getAttribute("data-collapsible")).toBe("icon")
    expect(rail().className).toContain("w-(--sidebar-width-icon)")
    narrow.unmount()
    renderRail({ expanded: true })
    expect(rail().getAttribute("data-collapsible")).toBe("")
    expect(rail().className).toMatch(/(^|\s)w-\(--sidebar-width\)(\s|$)/)
  })

  it("has an edge toggle named for the way it moves", () => {
    const { onToggle } = renderRail()
    const toggle = within(rail()).getByRole("button", { name: "Expand navigation" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("renders nothing below the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderRail()
    expect(screen.queryByRole("navigation", { name: "Scope navigation" })).toBeNull()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/nav-rail.test.tsx`
Expected: FAIL, cannot resolve `../src/components/nav-rail`.

- [ ] **Step 8: Write `nav-rail.tsx`**

```tsx
// packages/kit/src/components/nav-rail.tsx
import type { ReactNode } from "react"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { RailEntries } from "@forge-go/dashboard-kit/components/rail-entries"
import type { RailItem, RenderRailLink } from "@forge-go/dashboard-kit/components/rail-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

export interface NavRailProps {
  /** The scope switcher. */
  switcher?: ReactNode
  /** The scope's context control (App / Environment). Absent for a scope with none. */
  context?: ReactNode
  /** The search trigger. */
  searchControl?: ReactNode
  /** The account menu, pinned to the foot. */
  account?: ReactNode
  /** The scope's own entry first, then one per sub-plugin. */
  items: RailItem[]
  activeId?: string
  renderLink: RenderRailLink
  /** Appended to every entry's href, so the scope's query dimensions survive. */
  search?: string
  expanded: boolean
  onToggle: () => void
}

/**
 * A cell for chrome that is a component, not a link: the switcher, the context
 * control, search, the account menu. It gives the component the hover tooltip
 * the entries have, hidden when the rail is wide and the component names
 * itself. The tooltip hangs on a wrapper because each of these is already a
 * menu or popover trigger, and two triggers on one element fight.
 */
function RailSlot({
  children,
  expanded,
  title,
}: {
  children: ReactNode
  expanded: boolean
  title: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            data-slot="rail-slot"
            className={expanded ? "flex w-full items-center" : "flex w-10 items-center justify-center"}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent hidden={expanded} side="right">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The rail's right border, made clickable: a 16px strip straddling it with a
 * 2px line that shows on hover and focus. A real button in the tab order,
 * because it is the rail's only way to widen.
 */
function RailEdgeToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? "Collapse navigation" : "Expand navigation"
  return (
    <button
      type="button"
      aria-expanded={expanded}
      title={name}
      onClick={onToggle}
      className={cn(
        "absolute inset-y-0 -right-2 z-20 flex w-4 outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring",
        expanded ? "cursor-w-resize" : "cursor-e-resize",
      )}
    >
      <span className="sr-only">{name}</span>
    </button>
  )
}

/**
 * The far-left rail, after TwinOS Studio's AreaRail. A plain `nav`, not a
 * second shadcn `Sidebar`, because that component is `position: fixed` and two
 * would overlap; the secondary sidebar learns this rail's width through
 * `--sidebar-offset`.
 *
 * It carries the `group` class and the `data-collapsible` attribute the
 * sidebar sets in icon mode, so the switcher and account menu, which are
 * SidebarMenuButtons, shrink to their glyphs with the styles they already
 * have.
 *
 * Below the mobile breakpoint the sheet carries all of this, so the rail
 * renders nothing.
 */
export function NavRail({
  switcher,
  context,
  searchControl,
  account,
  items,
  activeId,
  renderLink,
  search,
  expanded,
  onToggle,
}: NavRailProps) {
  const { isMobile } = useSidebar()
  if (isMobile) return null

  const [scopeItem, ...pluginItems] = items
  const column = expanded ? "items-stretch" : "items-center"

  return (
    <nav
      aria-label="Scope navigation"
      data-slot="nav-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      data-collapsible={expanded ? "" : "icon"}
      className={cn(
        "group sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-linear",
        expanded ? "w-(--sidebar-width) px-2" : "w-(--sidebar-width-icon)",
        column,
      )}
    >
      <RailEdgeToggle expanded={expanded} onToggle={onToggle} />
      {switcher ? (
        <RailSlot expanded={expanded} title="Switch scope">
          {switcher}
        </RailSlot>
      ) : null}
      {context ? (
        <RailSlot expanded={expanded} title="App and environment">
          {context}
        </RailSlot>
      ) : null}
      {searchControl ? (
        <RailSlot expanded={expanded} title="Search pages">
          {searchControl}
        </RailSlot>
      ) : null}
      <div className={cn("no-scrollbar mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto", column)}>
        {scopeItem ? (
          <RailEntries
            items={[scopeItem]}
            activeId={activeId}
            renderLink={renderLink}
            search={search}
            expanded={expanded}
          />
        ) : null}
        {pluginItems.length > 0 ? (
          <>
            {expanded ? (
              <span className="px-2 pt-3 pb-0.5 text-[10.5px] font-medium tracking-[0.14em] text-sidebar-foreground/50 uppercase">
                Plugins
              </span>
            ) : (
              <span data-slot="rail-divider" aria-hidden="true" className="my-2 w-5 border-t border-sidebar-border" />
            )}
            <RailEntries
              items={pluginItems}
              activeId={activeId}
              renderLink={renderLink}
              search={search}
              expanded={expanded}
            />
          </>
        ) : null}
      </div>
      {account ? (
        <RailSlot expanded={expanded} title="Account">
          {account}
        </RailSlot>
      ) : null}
    </nav>
  )
}
```

The "Plugins" heading is `uppercase` by CSS only; its text node is `Plugins`, which the test matches.

- [ ] **Step 9: Run the kit suite, typecheck, lint your files**

Run: `pnpm --filter @forge-go/dashboard-kit test && pnpm --filter @forge-go/dashboard-kit typecheck`, then eslint on your five files.
Expected: PASS. If the first NavRail test's button order includes the tooltip wrappers' names, keep the filter and adjust only it; do not change the component.

- [ ] **Step 10: Commit**

```bash
git add packages/kit/src/components/nav-tree.tsx packages/kit/src/components/section-label.tsx packages/kit/src/components/nav-rail.tsx packages/kit/test/section-label.test.tsx packages/kit/test/nav-rail.test.tsx
git commit --only -m "feat(kit): add the Studio-style rail and a section label that turns vertical" -- packages/kit/src/components/nav-tree.tsx packages/kit/src/components/section-label.tsx packages/kit/src/components/nav-rail.tsx packages/kit/test/section-label.test.tsx packages/kit/test/nav-rail.test.tsx
```

---

### Task 2: The secondary sidebar and the shell

**Files:**
- Modify: `packages/kit/src/components/app-sidebar.tsx` (whole file)
- Modify: `packages/kit/src/components/dashboard-shell.tsx` (whole file)
- Modify: `packages/kit/src/components/nav-tree.tsx` (delete `NavSection`)
- Modify: `packages/kit/test/app-sidebar.test.tsx` (whole file)
- Modify: `packages/kit/test/dashboard-shell.test.tsx` (whole file)
- Delete: `packages/kit/src/components/section-rail.tsx`, `packages/kit/test/section-rail.test.tsx`

**Interfaces:**
- Consumes: `NavArea`, `NavRail`, `SectionLabel` (Task 1); `ScopeSwitcher`, `ScopeOption`, `ScopeSwitcherProps` (`scope-switcher.tsx`, unmodified); `NavUser`; `NavMain`, `NavTree` (unmodified); `useRailExpanded`.
- Produces:
  ```ts
  export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    areas?: NavArea[]
    activeAreaId?: string
    groups: NavGroup[]
    empty?: { message: string; href?: string; label?: string }
    currentPath: string
    search?: string
    renderLink: (node: NavNode, href: string) => ReactElement
    navigationLayout?: "tree" | "collapsible"
    mobileHeader?: ReactNode
    mobileFooter?: ReactNode
  }
  export function stackAreas(areas: NavArea[]): NavGroup[]
  export interface DashboardShellProps extends Omit<AppSidebarProps, "children" | "variant" | "collapsible" | "navigationLayout" | "mobileHeader" | "mobileFooter"> {
    scopes: ScopeOption[]
    activeScopeId?: string
    onScopeSelect: (id: string) => void
    scopeHome?: ScopeSwitcherProps["home"]
    context?: ReactNode
    searchControl?: ReactNode
    user: { name: string; email: string; avatar?: string }
    onSignOut?: () => void
    title?: string
    scope?: string
    actions?: ReactNode
    children: ReactNode
  }
  ```
  After this task `packages/host` does not typecheck until Task 5.

- [ ] **Step 1: Replace the AppSidebar test**

```tsx
// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { SidebarProvider, useSidebar } from "../src/components/sidebar"
import { AppSidebar, stackAreas } from "../src/components/app-sidebar"
import type { NavArea } from "../src/components/nav-tree"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

const areas: NavArea[] = [
  {
    id: "auth",
    label: "Authsome",
    href: "/@auth/users",
    kind: "scope",
    groups: [
      { label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] },
      { label: "System", items: [{ label: "Overview", href: "/@auth" }] },
    ],
  },
  {
    id: "subscription",
    label: "Billing",
    href: "/@auth/plans",
    kind: "plugin",
    groups: [
      { label: "Catalog", items: [{ label: "Plans", href: "/@auth/plans" }] },
      { label: "Revenue", items: [{ label: "Invoices", href: "/@auth/invoices" }] },
    ],
  },
]

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        collapsible="icon"
        navigationLayout="collapsible"
        areas={areas}
        activeAreaId="subscription"
        groups={[]}
        currentPath="/@auth/plans"
        renderLink={renderLink}
        {...overrides}
      />
    </SidebarProvider>,
  )
}

const header = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-header"]') as HTMLElement
const content = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-content"]') as HTMLElement

describe("AppSidebar", () => {
  it("names the active area and shows only its pages, under section labels", () => {
    const { container } = renderSidebar()
    expect(within(header(container)).getByText("Billing")).toBeTruthy()
    const c = content(container)
    expect(within(c).getByRole("button", { name: "Collapse Catalog" })).toBeTruthy()
    expect(within(c).getByRole("button", { name: "Collapse Revenue" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Plans" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Invoices" })).toBeTruthy()
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()
  })

  it("falls back to the first area when the active id matches none", () => {
    const { container } = renderSidebar({ activeAreaId: "nope" })
    expect(within(content(container)).getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("renders plain groups when there are no areas", () => {
    const { container } = renderSidebar({
      areas: undefined,
      groups: [{ label: "Authorization", items: [{ label: "Roles", href: "/@warden/roles" }] }],
      currentPath: "/@warden/roles",
    })
    const c = content(container)
    expect(within(c).getByRole("button", { name: "Collapse Authorization" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Roles" })).toBeTruthy()
    expect(header(container).textContent).toBe("")
  })

  it("renders no label for an unlabelled group", () => {
    const { container } = renderSidebar({
      areas: undefined,
      groups: [{ items: [{ label: "Rooms", href: "/@streaming/rooms" }] }],
      currentPath: "/@streaming/rooms",
    })
    expect(within(content(container)).queryByRole("button")).toBeNull()
  })

  it("renders the empty notice with a link that keeps the query string", () => {
    const { container } = renderSidebar({
      areas: [],
      search: "?env=staging",
      empty: { message: "This extension needs configuring.", href: "/@auth", label: "Open setup" },
    })
    const c = content(container)
    expect(within(c).getByText("This extension needs configuring.")).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Open setup" }).getAttribute("href")).toBe("/@auth?env=staging")
  })

  it("keeps mobile chrome out of the desktop sidebar", () => {
    renderSidebar({
      mobileHeader: <button type="button">Switch scope</button>,
      mobileFooter: <button type="button">Account menu</button>,
    })
    expect(screen.queryByRole("button", { name: "Switch scope" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull()
  })

  it("stacks every area in the mobile sheet with its chrome", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    try {
      function OpenSheet() {
        const { setOpenMobile } = useSidebar()
        useEffect(() => setOpenMobile(true), [setOpenMobile])
        return null
      }
      render(
        <SidebarProvider>
          <OpenSheet />
          <AppSidebar
            navigationLayout="collapsible"
            areas={areas}
            activeAreaId="subscription"
            groups={[]}
            currentPath="/@auth/plans"
            renderLink={renderLink}
            mobileHeader={<button type="button">Switch scope</button>}
            mobileFooter={<button type="button">Account menu</button>}
          />
        </SidebarProvider>,
      )
      const sheet = await screen.findByRole("dialog")
      expect(within(sheet).getByRole("button", { name: "Switch scope" })).toBeTruthy()
      expect(within(sheet).getByRole("button", { name: "Account menu" })).toBeTruthy()
      expect(within(sheet).getByRole("link", { name: "Users" })).toBeTruthy()
      expect(within(sheet).getByRole("link", { name: "Invoices" })).toBeTruthy()
      expect(within(sheet).getByRole("button", { name: "Collapse Billing · Catalog" })).toBeTruthy()
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true })
    }
  })
})

describe("stackAreas", () => {
  it("prefixes every labelled group with its area, and labels an area's unlabelled first group with the area", () => {
    const withLoose: NavArea[] = [
      { id: "x", label: "Streaming", href: "/r", kind: "scope", groups: [{ items: [{ label: "Rooms", href: "/r" }] }] },
      ...areas,
    ]
    expect(stackAreas(withLoose).map((g) => g.label)).toEqual([
      "Streaming",
      "Authsome · Identity",
      "Authsome · System",
      "Billing · Catalog",
      "Billing · Revenue",
    ])
  })
})
```

Note on the mobile test: the sheet's `SectionLabel` name reads "Collapse ..." because on mobile `expanded` follows `openMobile`, which is true while the sheet is open.

- [ ] **Step 2: Replace the DashboardShell test**

```tsx
// packages/kit/test/dashboard-shell.test.tsx
import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DashboardShell } from "../src/components/dashboard-shell"
import type { NavArea } from "../src/components/nav-tree"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

const areas: NavArea[] = [
  { id: "auth", label: "Authsome", href: "/@auth/users", kind: "scope", groups: [{ items: [{ label: "Users", href: "/@auth/users" }] }] },
  { id: "subscription", label: "Billing", href: "/@auth/plans", kind: "plugin", groups: [{ items: [{ label: "Plans", href: "/@auth/plans" }] }] },
]

function renderShell(props: Partial<React.ComponentProps<typeof DashboardShell>> = {}) {
  return render(
    <DashboardShell
      title="Plans"
      scope="Authsome"
      scopes={[{ id: "auth", label: "Authsome", namespace: "auth" }]}
      activeScopeId="auth"
      onScopeSelect={() => {}}
      context={<button type="button">Platform / Production</button>}
      searchControl={<button type="button">Search pages</button>}
      areas={areas}
      activeAreaId="subscription"
      groups={[]}
      currentPath="/@auth/plans"
      search="?env=staging"
      renderLink={renderLink}
      user={{ name: "Ada Lovelace", email: "ada@example.com" }}
      {...props}
    >
      <p>page body</p>
    </DashboardShell>,
  )
}

const rail = () => screen.getByRole("navigation", { name: "Scope navigation" })
const wrapperStyle = (c: HTMLElement) =>
  (c.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement).getAttribute("style") ?? ""

describe("DashboardShell", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("puts the switcher, context, search, entries and account in the rail, once", () => {
    renderShell()
    expect(within(rail()).getByRole("button", { name: /Authsome/ })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Platform / Production" })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Search pages" })).toBeTruthy()
    expect(within(rail()).getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Search pages" })).toHaveLength(1)
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/plans?env=staging")
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
  })

  it("shows the active area's pages in the secondary sidebar and the page in main", () => {
    const { container } = renderShell()
    const content = container.querySelector('[data-slot="sidebar-content"]') as HTMLElement
    expect(within(content).getByRole("link", { name: "Plans" })).toBeTruthy()
    expect(within(content).queryByRole("link", { name: "Users" })).toBeNull()
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
  })

  it("offsets the secondary sidebar by the rail and follows it when it widens", () => {
    const { container } = renderShell()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width-icon)")
    fireEvent.click(within(rail()).getByRole("button", { name: "Expand navigation" }))
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width)")
    expect(window.localStorage.getItem("forge-dashboard.rail")).toBe("expanded")
  })

  it("keeps the rail and its chrome for a scope with no areas", () => {
    renderShell({ areas: [], empty: { message: "Pick an app to see its pages." } })
    expect(within(rail()).queryAllByRole("link")).toHaveLength(0)
    expect(within(rail()).getByRole("button", { name: "Search pages" })).toBeTruthy()
    expect(screen.getByText("Pick an app to see its pages.")).toBeTruthy()
  })

  it("keeps the secondary sidebar icon-collapsible", () => {
    const { container } = renderShell()
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-collapsible")).toBe("")
    fireEvent.click(within(container.querySelector("header") as HTMLElement).getByRole("button", { name: "Toggle Sidebar" }))
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/app-sidebar.test.tsx test/dashboard-shell.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Rewrite `app-sidebar.tsx`**

```tsx
import * as React from "react"
import { Fragment } from "react"
import type { ReactElement, ReactNode } from "react"

import { NavTree } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavMain } from "@forge-go/dashboard-kit/components/nav-main"
import type { NavArea, NavGroup, NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import { SectionLabel } from "@forge-go/dashboard-kit/components/section-label"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  /** The rail's entries. The sidebar shows the active one's pages. */
  areas?: NavArea[]
  activeAreaId?: string
  /** Shown when there are no areas. */
  groups: NavGroup[]
  /** Shown when the scope has nothing to list and there is a reason to say so. */
  empty?: { message: string; href?: string; label?: string }
  currentPath: string
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
  navigationLayout?: "tree" | "collapsible"
  /** Mobile only: what the rail holds on desktop, above the pages. */
  mobileHeader?: ReactNode
  /** Mobile only: the account menu. */
  mobileFooter?: ReactNode
}

/**
 * Every area as one list of groups, for the mobile sheet, where there is no
 * rail to pick an area with. A labelled group reads "Billing · Catalog"; an
 * area's unlabelled first group takes the area's name.
 */
export function stackAreas(areas: NavArea[]): NavGroup[] {
  return areas.flatMap((area) =>
    area.groups.map((group, index) => ({
      ...group,
      label: group.label
        ? `${area.label} · ${group.label}`
        : index === 0
          ? area.label
          : undefined,
    })),
  )
}

function EmptyNotice({
  message,
  href,
  label,
  search,
  renderLink,
}: NonNullable<AppSidebarProps["empty"]> & Pick<AppSidebarProps, "search" | "renderLink">) {
  return (
    <div
      data-slot="scope-empty"
      className="px-3 py-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden"
    >
      <p>{message}</p>
      {href && label ? (
        <p className="mt-1 [&_a]:text-foreground [&_a]:underline">
          {renderLink({ label, href }, `${href}${search ?? ""}`)}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The secondary sidebar: the pages of the rail entry you are in, one section
 * per group. A section's label stays on screen as vertical text when the
 * sidebar collapses to icons. NavMain draws each section's rows; it is handed
 * one unlabelled group at a time so the label here is the only one.
 */
export function AppSidebar({
  areas,
  activeAreaId,
  groups,
  empty,
  currentPath,
  search,
  renderLink,
  navigationLayout = "tree",
  mobileHeader,
  mobileFooter,
  ...props
}: AppSidebarProps) {
  const { isMobile } = useSidebar()
  const Navigation = navigationLayout === "collapsible" ? NavMain : NavTree
  const active =
    areas && areas.length > 0
      ? (areas.find((area) => area.id === activeAreaId) ?? areas[0])
      : undefined
  const shown = areas && areas.length > 0
    ? isMobile
      ? stackAreas(areas)
      : active!.groups
    : groups

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {isMobile ? mobileHeader : null}
        {!isMobile && active ? (
          <div
            data-slot="area-title"
            className="truncate px-2 py-1 font-semibold group-data-[collapsible=icon]:hidden"
          >
            {active.label}
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        {empty ? <EmptyNotice {...empty} search={search} renderLink={renderLink} /> : null}
        {shown.map((group, index) => (
          <Fragment key={`${group.label ?? ""}:${index}`}>
            {group.label ? (
              <div className="px-2 pt-2">
                <SectionLabel>{group.label}</SectionLabel>
              </div>
            ) : null}
            <Navigation
              groups={[{ ...group, label: undefined }]}
              currentPath={currentPath}
              search={search}
              renderLink={renderLink}
            />
          </Fragment>
        ))}
      </SidebarContent>
      {isMobile && mobileFooter ? <SidebarFooter>{mobileFooter}</SidebarFooter> : null}
      {navigationLayout === "collapsible" && <SidebarRail />}
    </Sidebar>
  )
}
```

- [ ] **Step 5: Rewrite `dashboard-shell.tsx`**

```tsx
import type { CSSProperties, ReactNode } from "react"

import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import type { AppSidebarProps } from "@forge-go/dashboard-kit/components/app-sidebar"
import { NavRail } from "@forge-go/dashboard-kit/components/nav-rail"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeSwitcher } from "@forge-go/dashboard-kit/components/scope-switcher"
import type {
  ScopeOption,
  ScopeSwitcherProps,
} from "@forge-go/dashboard-kit/components/scope-switcher"
import { SidebarInset, SidebarProvider } from "@forge-go/dashboard-kit/components/sidebar"
import { SiteHeader } from "@forge-go/dashboard-kit/components/site-header"
import { useRailExpanded } from "@forge-go/dashboard-kit/hooks/use-rail-expanded"

export interface DashboardShellProps
  extends Omit<
    AppSidebarProps,
    "children" | "variant" | "collapsible" | "navigationLayout" | "mobileHeader" | "mobileFooter"
  > {
  scopes: ScopeOption[]
  activeScopeId?: string
  onScopeSelect: (id: string) => void
  scopeHome?: ScopeSwitcherProps["home"]
  /** The scope's App / Environment control. */
  context?: ReactNode
  /** The search trigger. */
  searchControl?: ReactNode
  user: { name: string; email: string; avatar?: string }
  onSignOut?: () => void
  title?: string
  scope?: string
  actions?: ReactNode
  children: ReactNode
}

/**
 * The dashboard's chrome, after TwinOS Studio: a rail with the scope switcher,
 * the context control, search, the scope's entry and its plugins, and the
 * account menu; the secondary sidebar with the active entry's pages; then the
 * page. On mobile the rail's contents move into the sheet, so each piece of
 * chrome renders once whatever the viewport.
 */
export function DashboardShell({
  title,
  scope,
  actions,
  children,
  scopes,
  activeScopeId,
  onScopeSelect,
  scopeHome,
  context,
  searchControl,
  user,
  onSignOut,
  ...pane
}: DashboardShellProps) {
  const { expanded, toggle } = useRailExpanded()
  const switcher =
    scopes.length > 0 || scopeHome ? (
      <ScopeSwitcher
        scopes={scopes}
        activeId={activeScopeId}
        onSelect={onScopeSelect}
        home={scopeHome}
        menuSide="right"
      />
    ) : null
  const account = <NavUser user={user} onSignOut={onSignOut} />
  const items = (pane.areas ?? []).map((area) => ({
    id: area.id,
    label: area.label,
    href: area.href,
    icon: area.icon,
  }))

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-offset": expanded ? "var(--sidebar-width)" : "var(--sidebar-width-icon)",
        } as CSSProperties
      }
    >
      <NavRail
        switcher={switcher}
        context={context}
        searchControl={searchControl}
        account={account}
        items={items}
        activeId={pane.activeAreaId ?? items[0]?.id}
        renderLink={pane.renderLink}
        search={pane.search}
        expanded={expanded}
        onToggle={toggle}
      />
      <AppSidebar
        {...pane}
        mobileHeader={
          <>
            {switcher}
            {context}
            {searchControl}
          </>
        }
        mobileFooter={account}
        variant="sidebar"
        collapsible="icon"
        navigationLayout="collapsible"
      />
      <SidebarInset>
        <SiteHeader title={title} scope={scope} actions={actions} />
        {/*
          `@container/main` is load-bearing, not decoration. dashboard-01's
          SectionCards sizes itself with container queries scoped to a container
          named `main` (@xl/main:grid-cols-2, @5xl/main:grid-cols-4). Without
          this declaration those variants never match and the cards stack in a
          single column at every width.
        */}
        <div
          id="dashboard-main"
          className="@container/main flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6 xl:p-8"
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 6: Remove the section rail**

Delete the `NavSection` interface and its comment from `packages/kit/src/components/nav-tree.tsx`, then:

```bash
git rm packages/kit/src/components/section-rail.tsx packages/kit/test/section-rail.test.tsx
grep -rn "section-rail\|SectionRail\|NavSection\|stackSections" packages/kit/src packages/kit/test
```

The grep must print nothing. (`packages/host` still references `NavSection`; Task 5 fixes that.)

- [ ] **Step 7: Run the kit suite, typecheck, lint your files**

Run: `pnpm --filter @forge-go/dashboard-kit test && pnpm --filter @forge-go/dashboard-kit typecheck`, then eslint on your changed files.
Expected: PASS. If the switcher button's name in the shell test is not matched by `/Authsome/`, read `scope-switcher.tsx` and adjust only that regex.

- [ ] **Step 8: Commit**

```bash
git commit --only -m "feat(kit): move scope chrome into the rail and show one entry's pages beside it" -- packages/kit/src/components/app-sidebar.tsx packages/kit/src/components/dashboard-shell.tsx packages/kit/src/components/nav-tree.tsx packages/kit/test/app-sidebar.test.tsx packages/kit/test/dashboard-shell.test.tsx packages/kit/src/components/section-rail.tsx packages/kit/test/section-rail.test.tsx
```

---

### Task 3: `navAreas` and `activeAreaId` in the host

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (add after `activeSectionId`; `navSections` stays until Task 5)
- Test: `packages/host/test/nav-areas.test.tsx`

**Interfaces:**
- Consumes: `NavArea` (Task 1), existing `navGroups`, `foldClusters`, `toNodes`, `sortByPriority`, `labelOf`, `UNGROUPED`.
- Produces:
  - `export function navAreas(plugin: ForgePlugin, subPlugins: ForgeSubPlugin[], segment?: string): NavArea[]`
  - `export function activeAreaId(areas: NavArea[], pathname: string): string | undefined`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/host/test/nav-areas.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { activeAreaId, navAreas } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  label: "Authsome",
  icon: "A",
  nav: [
    { label: "Users", to: "/users", group: "Identity", priority: 10 },
    { label: "Sessions", to: "/sessions", group: "Identity", priority: 20 },
    { label: "Overview", to: "/", group: "System" },
  ],
  routes: [{ path: "/users", element: Noop }],
})

const billing = defineSubPlugin({
  extension: "subscription",
  host: "auth",
  label: "Billing",
  icon: "B",
  nav: [
    { label: "Invoices", to: "/invoices", group: "Revenue", priority: 2 },
    { label: "Plans", to: "/plans", group: "Catalog", priority: 1 },
  ],
  routes: [{ path: "/plans", element: Noop }],
})

const apikey = defineSubPlugin({
  extension: "apikey",
  host: "auth",
  nav: [{ label: "API Keys", to: "/apikeys", icon: "K" }],
  routes: [{ path: "/apikeys", element: Noop }],
})

const risk = defineSubPlugin({
  extension: "riskengine",
  host: "auth",
  nav: [
    { label: "Risk Engine", to: "/security/risk", priority: 0, cluster: { label: "Threat detection" } },
    { label: "Risk Rules", to: "/security/rules", priority: 1, cluster: { label: "Threat detection" } },
  ],
  routes: [],
})

const silent = defineSubPlugin({ extension: "waitlist", host: "auth", nav: [], routes: [] })

describe("navAreas", () => {
  it("puts the scope first with its own grouped nav, and no sub-plugin pages in it", () => {
    const [scope] = navAreas(auth, [billing, apikey])
    expect(scope).toMatchObject({ id: "auth", label: "Authsome", kind: "scope", href: "/@auth/users" })
    expect(scope.icon).toBe("A")
    expect(scope.groups.map((g) => g.label)).toEqual(["Identity", "System"])
    expect(scope.groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(["Users", "Sessions", "Overview"])
  })

  it("adds one plugin area per sub-plugin with nav, sorted by label, and skips those with none", () => {
    const areas = navAreas(auth, [risk, billing, silent, apikey])
    expect(areas.map((a) => a.label)).toEqual(["Authsome", "API Keys", "Billing", "Risk Engine"])
    expect(areas.slice(1).every((a) => a.kind === "plugin")).toBe(true)
  })

  it("falls back to the first nav item's label and icon, then the extension", () => {
    const areas = navAreas(auth, [apikey])
    expect(areas[1]).toMatchObject({ id: "apikey", label: "API Keys", icon: "K" })
    const bare = defineSubPlugin({ extension: "geoip", host: "auth", nav: [{ label: "", to: "/geo" }], routes: [] })
    expect(navAreas(auth, [bare])[1].label).toBe("geoip")
  })

  it("splits a plugin's pages into sections by group, in first-appearance order after a priority sort", () => {
    const area = navAreas(auth, [billing]).find((a) => a.id === "subscription")!
    expect(area.groups.map((g) => g.label)).toEqual(["Catalog", "Revenue"])
    expect(area.href).toBe("/@auth/plans")
  })

  it("folds a cluster inside a plugin and links the area to its first real page", () => {
    const area = navAreas(auth, [risk]).find((a) => a.id === "riskengine")!
    const cluster = area.groups[0].items[0]
    expect(cluster.label).toBe("Threat detection")
    expect(cluster.children?.map((c) => c.label)).toEqual(["Risk Engine", "Risk Rules"])
    expect(area.href).toBe("/@auth/security/risk")
  })

  it("returns only plugin areas when the scope itself has no nav", () => {
    const empty = definePlugin({ extension: "auth", namespace: "auth", routes: [] })
    expect(navAreas(empty, [apikey]).map((a) => a.id)).toEqual(["apikey"])
  })
})

describe("activeAreaId", () => {
  const areas = navAreas(auth, [billing, apikey])

  it("picks the area holding the current page", () => {
    expect(activeAreaId(areas, "/@auth/invoices")).toBe("subscription")
    expect(activeAreaId(areas, "/@auth/apikeys")).toBe("apikey")
  })

  it("picks by longest prefix, so a scope Overview at the root does not swallow plugin pages", () => {
    expect(activeAreaId(areas, "/@auth/plans/plan_1")).toBe("subscription")
    expect(activeAreaId(areas, "/@auth/users/usr_1")).toBe("auth")
  })

  it("falls back to the first area, and to undefined for none", () => {
    expect(activeAreaId(areas, "/@warden")).toBe("auth")
    expect(activeAreaId([], "/@auth")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/nav-areas.test.tsx`
Expected: FAIL, `navAreas` is not exported.

- [ ] **Step 3: Implement**

In `packages/host/src/host/PluginHost.tsx`, add `NavArea` to the `nav-tree` type import. Then, directly after the closing brace of `activeSectionId`, add:

```tsx
/**
 * A list of nav items bucketed by `group`, ungrouped first, then groups in
 * first-appearance order after a priority sort: the rule `navGroups` applies
 * to a scope, applied to one sub-plugin's items.
 */
function groupItems(plugin: ForgePlugin, items: PluginNavItem[], segment?: string): NavGroup[] {
  const buckets = new Map<string | typeof UNGROUPED, PluginNavItem[]>()
  for (const item of sortByPriority(items)) {
    const key = item.group ?? UNGROUPED
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === UNGROUPED ? -1 : b === UNGROUPED ? 1 : 0))
    .map(([key, list]) => ({
      label: key === UNGROUPED ? undefined : key,
      items: toNodes(plugin, foldClusters(list), segment),
    }))
}

function firstHref(node: NavNode): string {
  return node.children?.[0]?.href ?? node.href
}

/**
 * The rail's entries for one scope: the scope itself, then one per ready
 * sub-plugin that has nav, sorted by label. Each carries the pages the
 * secondary sidebar shows when you are in it, split into sections by `group`.
 * Sub-plugin pages are NOT merged into the scope's own entry; that merging is
 * what made authsome's sidebar a 35-row list.
 */
export function navAreas(
  plugin: ForgePlugin,
  subPlugins: ForgeSubPlugin[],
  segment?: string,
): NavArea[] {
  const areas: NavArea[] = []

  const own = navGroups(plugin, [], segment)
  const ownFirst = own[0]?.items[0]
  if (ownFirst) {
    areas.push({
      id: plugin.extension,
      label: labelOf(plugin),
      icon: plugin.icon,
      href: firstHref(ownFirst),
      kind: "scope",
      groups: own,
    })
  }

  const plugins: NavArea[] = []
  for (const sub of subPlugins) {
    if (sub.nav.length === 0) continue
    const groups = groupItems(plugin, sub.nav, segment)
    const first = groups[0]?.items[0]
    if (!first) continue
    const lead = sortByPriority(sub.nav)[0]
    plugins.push({
      id: sub.extension,
      label: sub.label || lead?.label || sub.extension,
      icon: sub.icon ?? lead?.icon,
      href: firstHref(first),
      kind: "plugin",
      groups,
    })
  }
  plugins.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))

  return [...areas, ...plugins]
}

/**
 * The rail entry holding the current page: the node whose href is the pathname
 * or its longest prefix, the rule `pageTitle` uses. A route no nav item names
 * lands on the first entry.
 */
export function activeAreaId(areas: NavArea[], pathname: string): string | undefined {
  let best: { id: string; length: number } | undefined
  for (const area of areas) {
    for (const group of area.groups) {
      for (const node of group.items) {
        for (const candidate of [node, ...(node.children ?? [])]) {
          const matches =
            candidate.href === pathname ||
            (candidate.href !== "/" && pathname.startsWith(`${candidate.href}/`))
          if (matches && (!best || candidate.href.length > best.length)) {
            best = { id: area.id, length: candidate.href.length }
          }
        }
      }
    }
  }
  return best?.id ?? areas[0]?.id
}
```

`sortByPriority`, `labelOf`, `UNGROUPED`, `foldClusters` and `toNodes` already exist in the file. `UNGROUPED` is declared above `navGroups`; if it is declared after the point where you insert, move nothing, just place the new code below `UNGROUPED`'s declaration.

- [ ] **Step 4: Run the new test**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/nav-areas.test.tsx`
Expected: PASS. Host typecheck is broken elsewhere until Task 5 (kit props changed in Task 2); check only that `tsc --noEmit` reports nothing mentioning `navAreas`, `activeAreaId`, `groupItems`, `firstHref` or `NavArea`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "feat(host): build rail entries from a scope and its sub-plugins" -- packages/host/src/host/PluginHost.tsx packages/host/test/nav-areas.test.tsx
```

(`git add packages/host/test/nav-areas.test.tsx` first; it is a new file.)

---

### Task 4: `ContextControl`

**Files:**
- Create: `packages/host/src/host/ContextControl.tsx`
- Test: `packages/host/test/routed-context.test.tsx` (append a describe block)

**Interfaces:**
- Consumes: `ContextSwitchers` (`./ContextSwitchers`, unchanged); `useQuery` and `ContextDimension`, `ForgePlugin` from `@forge-go/dashboard-plugin`; kit `Popover`, `PopoverTrigger`, `PopoverContent` from `@forge-go/dashboard-kit/components/popover`; `AppWindowIcon`, `ChevronDownIcon` from `@forge-go/dashboard-kit/icons`.
- Produces: `export function ContextControl({ dimensions, plugin }: { dimensions: ContextDimension[]; plugin?: ForgePlugin }): ReactElement | null`

This task only creates the component and tests it in isolation inside a `PluginProvider`. Task 5 wires it into the rail.

- [ ] **Step 1: Write the failing tests**

Read `packages/host/test/routed-context.test.tsx` first: it has `fixtureServer()`, `appDimension`, `envDimension`, `routedAuthPlugin()` and a `renderAt` helper. Append:

```tsx
describe("ContextControl", () => {
  function renderControl(fetchImpl: typeof fetch, dimensions = [appDimension, envDimension]) {
    const client = createScopedClient({ contractBase: "/dashboard/api/dashboard/v1", extension: "auth", fetchImpl })
    return render(
      <MemoryRouter initialEntries={["/@auth/platform/users"]}>
        <PluginProvider client={client}>
          <ContextControl dimensions={dimensions} plugin={routedAuthPlugin()} />
        </PluginProvider>
      </MemoryRouter>,
    )
  }

  it("names itself with every dimension's current value, joined", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    renderControl(server.fetchImpl)
    expect(await screen.findByRole("button", { name: /^Platform \/ / })).toBeTruthy()
  })

  it("opens a popover holding the App and Environment selects", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    renderControl(server.fetchImpl)
    fireEvent.click(await screen.findByRole("button", { name: /^Platform \/ / }))
    expect(await screen.findByLabelText("App")).toBeTruthy()
    expect(screen.getByLabelText("Environment")).toBeTruthy()
  })

  it("renders nothing for a scope with no dimensions", () => {
    queryStore.clear()
    const server = fixtureServer()
    const { container } = renderControl(server.fetchImpl, [])
    expect(container.textContent).toBe("")
  })
})
```

Match `createScopedClient`'s real signature and the contract base this file's other tests use (read how `PluginHost` or this file builds a client; if `createScopedClient` takes different arguments, use them and note it). Add the imports this block needs (`ContextControl` from `../src/host/ContextControl`, `PluginProvider`, `createScopedClient` from `@forge-go/dashboard-plugin`, `fireEvent` from testing-library) next to the existing imports.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/routed-context.test.tsx -t ContextControl`
Expected: FAIL, cannot resolve `../src/host/ContextControl`.

- [ ] **Step 3: Write `ContextControl.tsx`**

```tsx
import { Fragment } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { ContextDimension, ForgePlugin } from "@forge-go/dashboard-plugin"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@forge-go/dashboard-kit/components/popover"
import { AppWindowIcon, ChevronDownIcon } from "@forge-go/dashboard-kit/icons"
import { ContextSwitchers } from "./ContextSwitchers"

/**
 * One dimension's current value, read through the same query and projection
 * the dropdown uses. Until the read lands, or when nothing is current, it
 * shows the dimension's own label, so the trigger reads "App / Environment"
 * rather than an empty button.
 */
function CurrentValue({ dimension }: { dimension: ContextDimension }) {
  const read = useQuery(dimension.query)
  const label = read.data ? dimension.select(read.data).current?.label : undefined
  return <>{label ?? dimension.label}</>
}

/**
 * Every context dimension a scope declares, behind one rail button. The
 * trigger reads "Platform / Production"; clicking it opens a popover holding
 * the same App and Environment dropdowns the sidebar used to show. On a
 * narrow rail only the icon shows, and the text stays in the button's name.
 */
export function ContextControl({
  dimensions,
  plugin,
}: {
  dimensions: ContextDimension[]
  plugin?: ForgePlugin
}) {
  if (dimensions.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-slot="context-control"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-sidebar-border px-2 text-left text-sm outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          />
        }
      >
        <AppWindowIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:sr-only">
          {dimensions.map((dimension, index) => (
            <Fragment key={dimension.id}>
              {index > 0 ? " / " : null}
              <CurrentValue dimension={dimension} />
            </Fragment>
          ))}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
        />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72">
        <ContextSwitchers dimensions={dimensions} plugin={plugin} />
      </PopoverContent>
    </Popover>
  )
}
```

If `PopoverContent` in `packages/kit/src/components/popover.tsx` does not take `side`/`align`, read it and pass whatever its positioning props are called.

- [ ] **Step 4: Run the tests, typecheck just this file, lint**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/routed-context.test.tsx`
Expected: PASS (the rest of routed-context.test.tsx is untouched and may fail only where it references the old `Sections` rail; those tests are Task 5's, so if they fail, confirm they are the two "Sections" tests and note it). eslint your two files.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host/ContextControl.tsx
git commit --only -m "feat(host): put App and Environment behind one rail control" -- packages/host/src/host/ContextControl.tsx packages/host/test/routed-context.test.tsx
```

---

### Task 5: The host renders the Studio rail

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx`
- Modify: `packages/host/test/host.test.tsx`
- Modify: `packages/host/test/routed-context.test.tsx`
- Delete: `packages/host/test/nav-sections.test.tsx`

**Interfaces:**
- Consumes: `navAreas`, `activeAreaId` (Task 3), `ContextControl` (Task 4), `DashboardShell` props (Task 2).
- Produces: the `sidebar` object satisfies `HostSidebar` with `scopeHome`, `scopes`, `activeScopeId`, `onScopeSelect`, `areas`, `activeAreaId`, `empty`, `groups`, `currentPath`, `search`, `renderLink`, `context`, `searchControl`, `user`, `onSignOut`. `navSections`, `activeSectionId`, `MORE_SECTION`, `withoutRepeatedCluster`, `MoreHorizontalIcon` and `NavSection` leave `PluginHost.tsx`.

Find every edit by its quoted text; line numbers drift.

- [ ] **Step 1: Rewrite the tests that assume the old layout**

In `packages/host/test/host.test.tsx`:

(a) Add `defineSubPlugin` to the `@forge-go/dashboard-plugin` import, and below the `header`/`content` helpers add:

```tsx
const rail = () => screen.getByRole("navigation", { name: "Scope navigation" })
```

(b) Replace `"keeps root navigation in the scope switcher inside a scope"` and `"returns to the root from the scope switcher"` with:

```tsx
  it("puts the scope switcher in the rail, not the secondary sidebar", async () => {
    const { container } = renderHost(
      [rootPlugin(), authScopePlugin()],
      bothReady(),
      "/@auth/users",
    )
    await screen.findByText("auth users body")

    expect(within(rail()).getByRole("button", { name: "Auth @auth" })).toBeTruthy()
    expect(within(header(container)).queryByRole("button", { name: "Auth @auth" })).toBeNull()
    expect(within(rail()).getByRole("link", { name: "Auth" }).getAttribute("aria-current")).toBe("page")
    expect(within(rail()).queryByText("Plugins")).toBeNull()
  })

  it("returns to the root from the switcher in the rail", async () => {
    renderHost([rootPlugin(), authScopePlugin()], bothReady(), "/@auth/users")
    await screen.findByText("auth users body")
    fireEvent.click(within(rail()).getByRole("button", { name: "Auth @auth" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "System" }))
    expect(await screen.findByText("root overview body")).toBeTruthy()
  })
```

If the switcher's accessible name is not exactly `"Auth @auth"`, read `scope-switcher.tsx` and match it.

(c) Replace the two tests `"gives a scope with sections a Sections rail and shows only the active section"` and `"lets search find a page in a section that is not showing"` with:

```tsx
  function renderWithSubPlugins(route: string) {
    const auth = definePlugin({
      extension: "auth",
      namespace: "auth",
      label: "Auth",
      nav: [{ label: "Users", to: "/users", group: "Identity" }],
      routes: [{ path: "/users", element: () => <p>auth users body</p> }],
    })
    const billing = defineSubPlugin({
      extension: "subscription",
      host: "auth",
      label: "Billing",
      nav: [
        { label: "Plans", to: "/plans", group: "Catalog", priority: 1 },
        { label: "Invoices", to: "/invoices", group: "Revenue", priority: 2 },
      ],
      routes: [
        { path: "/plans", element: () => <p>billing plans body</p> },
        { path: "/invoices", element: () => <p>billing invoices body</p> },
      ],
    })
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "auth", envelopes: ["v1"], configured: true },
      { name: "subscription", envelopes: ["v1"], configured: true },
    ])
    return render(
      <MemoryRouter initialEntries={[route]}>
        <ForgeDashboardProvider config={config}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost plugins={[rootPlugin(), auth]} subPlugins={[billing]} fetchImpl={fetchImpl} />
          </SessionProvider>
        </ForgeDashboardProvider>
      </MemoryRouter>,
    )
  }

  it("lists a sub-plugin in the rail and shows only its pages when you are in it", async () => {
    const { container } = renderWithSubPlugins("/@auth/plans")
    await screen.findByText("billing plans body")

    expect(within(rail()).getByText("Plugins")).toBeTruthy()
    const billing = within(rail()).getByRole("link", { name: "Billing" })
    expect(billing.getAttribute("aria-current")).toBe("page")
    expect(within(rail()).getByRole("link", { name: "Auth" }).getAttribute("href")).toBe("/@auth/users")

    expect(within(header(container)).getByText("Billing")).toBeTruthy()
    const c = content(container)
    expect(within(c).getByRole("button", { name: "Collapse Catalog" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Invoices" })).toBeTruthy()
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()

    fireEvent.click(within(rail()).getByRole("link", { name: "Auth" }))
    expect(await screen.findByText("auth users body")).toBeTruthy()
    expect(within(content(container)).getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("lets search find a plugin page from the scope's own entry", async () => {
    renderWithSubPlugins("/@auth/users")
    await screen.findByText("auth users body")
    fireEvent.click(within(rail()).getByRole("button", { name: "Search pages" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("link", { name: /Invoices/ })).toBeTruthy()
  })

  it("keeps the query string on rail entries", async () => {
    renderWithSubPlugins("/@auth/users?env=staging")
    await screen.findByText("auth users body")
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/plans?env=staging")
  })
```

(d) Around the old test that asserted `"Streaming @streaming"`, replace
`expect(screen.getByRole("button", { name: "Streaming @streaming" })).toBeTruthy()`
with
`expect(within(rail()).getByRole("button", { name: "Streaming @streaming" })).toBeTruthy()`.

(e) Around the test that opens the switcher with `/core-contract/` and picks `/gateway-contract/`, scope the first query to the rail: `within(rail()).getByRole("button", { name: /core-contract/ })` (keep the `menuitem` query on `screen`, since the menu renders in a portal). Wrap it in `await waitFor(...)` if the rail is not there on the first render.

In `packages/host/test/routed-context.test.tsx`, delete `sectionedRoutedAuthPlugin()` and replace the two tests `"renders no Sections rail for a sectioned scope when the URL names no app"` and `"mounts the Sections rail under the URL's segment and marks the active section"` with:

```tsx
  it("shows a rail with no entries when the URL names no app", async () => {
    queryStore.clear()
    const server = fixtureServer()

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth")

    await waitFor(() => expect(screen.getByText("choose an app")).toBeTruthy())
    const rail = screen.getByRole("navigation", { name: "Scope navigation" })
    expect(within(rail).queryAllByRole("link")).toHaveLength(0)
    expect(screen.getByText("Pick an app to see its pages.")).toBeTruthy()
  })

  it("mounts the scope entry under the URL's segment, marks it, and shows the context control", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/platform/users")

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    const rail = screen.getByRole("navigation", { name: "Scope navigation" })
    const auth = within(rail).getByRole("link", { name: "Auth" })
    expect(auth.getAttribute("href")?.startsWith("/@auth/platform/")).toBe(true)
    expect(auth.getAttribute("aria-current")).toBe("page")
    expect(await within(rail).findByRole("button", { name: /^Platform \/ / })).toBeTruthy()
  })
```

Any other test in these two files that looked for the App/Environment selects in the sidebar (search both files for `getByLabelText("App")`, `"Environment"`, `combobox`) must now open the context control first: click `within(screen.getByRole("navigation", { name: "Scope navigation" })).getByRole("button", { name: /\// })`, then query the select. List every test you changed this way in your report.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/host.test.tsx test/routed-context.test.tsx`
Expected: FAIL (no "Scope navigation" rail yet).

- [ ] **Step 3: Rewire `PluginHost.tsx`**

1. Imports: add `import { ContextControl } from "./ContextControl"`. Remove `NavSection` from the `nav-tree` type import. Change `import { MoreHorizontalIcon, TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"` to `import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"`. Remove `import { ContextSwitchers } from "./ContextSwitchers"` only if nothing else in the file uses it after step 5.
2. Delete `MORE_SECTION`, `withoutRepeatedCluster`, `navSections` and `activeSectionId` with their comments.
3. Replace the `sections`, `currentSectionId` and `allGroups` declarations with:

```tsx
  // The rail's entries: the scope, then its sub-plugins. Same readiness and
  // no-segment rules as `groups`, so a scope with no app picked has no
  // entries, only the pick-an-app notice.
  const areas: NavArea[] =
    navOwner && navOwner.state.kind === "ready" && !(ownerDimension && !ownerSegment)
      ? navAreas(navOwner.plugin, readySubPluginsFor(navOwner.plugin), ownerSegment)
      : []
  const currentAreaId = areas.length > 0 ? activeAreaId(areas, pathname) : undefined

  // Every page the scope offers, whichever entry it sits in. Search and the
  // page title look across all of them.
  const allGroups: NavGroup[] =
    areas.length > 0 ? areas.flatMap((area) => area.groups) : groups
```

4. In the `sidebar` object, replace `sections,` and `activeSectionId: currentSectionId,` with `areas,` and `activeAreaId: currentAreaId,`. Update the `renderLink` comment's "section rail" to "rail".
5. Replace the whole `header: <>...</>,` entry with:

```tsx
    context:
      panelSource && panelSource.state.kind === "ready" && panelSource.plugin.context.length > 0 ? (
        <PluginErrorBoundary key={panelSource.id} plugin={panelSource.id}>
          <PluginProvider client={clients.get(panelSource.plugin.extension)!}>
            <ContextControl dimensions={panelSource.plugin.context} plugin={panelSource.plugin} />
          </PluginProvider>
        </PluginErrorBoundary>
      ) : undefined,
    searchControl: (
      <NavigationSearch groups={allGroups} search={search} scopes={[
        ...(root ? [{ label: root.label, href: homePathFor(root.plugin) }] : []),
        ...scopes.map(scope => ({ label: scope.label, href: homePathFor(scope.plugin) })),
      ]} />
    ),
```

6. Update the comment above `navOwner` that says "No group label: the switcher above already names the active scope" so it reads: "No group label for a scope with one group: the rail already names the active scope."

- [ ] **Step 4: Delete the old tests**

```bash
git rm packages/host/test/nav-sections.test.tsx
grep -rn "navSections\|activeSectionId\|MORE_SECTION\|NavSection\|\"Sections\"" packages/host/src packages/host/test
```

The grep must print nothing.

- [ ] **Step 5: Run the host suite, typecheck, lint**

Run: `pnpm --filter @forge-go/dashboard-host test && pnpm --filter @forge-go/dashboard-host typecheck`, eslint on your changed files, and `pnpm --filter @forge-go/dashboard-kit test` once.
Expected: only the 8 known setup-screen failures. `host-playground.test.tsx` passes unchanged.

- [ ] **Step 6: Commit**

```bash
git commit --only -m "feat(host): render the Studio rail with the scope's plugins and its context" -- packages/host/src/host/PluginHost.tsx packages/host/test/host.test.tsx packages/host/test/routed-context.test.tsx packages/host/test/nav-sections.test.tsx
```

---

### Task 6: Remove the `sections` contract

**Files:**
- Modify: `packages/plugin/src/types.ts` (delete `PluginSection` and `ForgePlugin.sections`)
- Modify: `packages/plugin/src/define.ts` (delete the sections validation block)
- Modify: `packages/plugin/test/define.test.ts` (delete the `describe("definePlugin sections", ...)` block)
- Modify: `packages/plugin-authsome/src/index.tsx` (delete the `sections: [...]` block and the icon imports only it used)
- Delete: `packages/plugin-authsome/test/sections.test.ts`

**Interfaces:** removes `PluginSection` and `ForgePlugin.sections`. Nothing else may reference them after Task 5.

`packages/plugin-authsome/src/index.tsx` carries another session's uncommitted edits (an `AuthsomeMark` import, formatting, icon imports). Your commit must contain ONLY the removal, applied to HEAD's version of that file, and the working tree must keep the other session's edits.

- [ ] **Step 1: Edit the plugin package and run its tests**

Delete from `packages/plugin/src/types.ts` the `PluginSection` interface with its doc comment, and the `sections?: PluginSection[]` field with its comment. Delete from `packages/plugin/src/define.ts` the block that starts `const seenSections = new Set<string>()` through its closing `}` of the `for` loop. Delete the `describe("definePlugin sections", ...)` block from `packages/plugin/test/define.test.ts`.

Run: `pnpm --filter @forge-go/dashboard-plugin test && pnpm --filter @forge-go/dashboard-plugin typecheck`
Expected: PASS.

- [ ] **Step 2: Edit authsome in the working tree and run its tests**

In the working-tree `packages/plugin-authsome/src/index.tsx`, delete the `sections: [...]` block and its comment, and remove from the icons import any of `Building2Icon`, `CreditCardIcon`, `KeyRoundIcon`, `ScaleIcon`, `ServerIcon`, `ShieldIcon` that are no longer used anywhere in the file (check each with grep). `git rm packages/plugin-authsome/test/sections.test.ts`.

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test && pnpm --filter @forge-go/dashboard-plugin-authsome typecheck`
Expected: PASS.

- [ ] **Step 3: Build the authsome change against HEAD's copy**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
SCR=/private/tmp/claude-501/-Users-rexraphael-Work-xraph-forge-dashboard/b8bb634d-c21d-4bba-b00e-240f226898fa/scratchpad/studio-t6
mkdir -p "$SCR"
git show HEAD:packages/plugin-authsome/src/index.tsx > "$SCR/index.head.tsx"
```

Edit `$SCR/index.head.tsx`: delete the same `sections: [...]` block and comment, and remove from its icons import only the icons that were added for sections and are now unused in THAT copy (HEAD's copy also imports `ShieldIcon` for the plugin's own icon; keep it if it is still used). Confirm with `diff <(git show HEAD:packages/plugin-authsome/src/index.tsx) "$SCR/index.head.tsx"` that only those lines differ.

- [ ] **Step 4: Commit everything through a private index**

```bash
OLD=$(git rev-parse HEAD)
TMPIDX="$SCR/index"; rm -f "$TMPIDX"
GIT_INDEX_FILE="$TMPIDX" git read-tree "$OLD"
for f in packages/plugin/src/types.ts packages/plugin/src/define.ts packages/plugin/test/define.test.ts; do
  GIT_INDEX_FILE="$TMPIDX" git update-index --add --cacheinfo 100644,"$(git hash-object -w "$f")","$f"
done
B=$(git hash-object -w "$SCR/index.head.tsx")
GIT_INDEX_FILE="$TMPIDX" git update-index --add --cacheinfo 100644,"$B",packages/plugin-authsome/src/index.tsx
GIT_INDEX_FILE="$TMPIDX" git update-index --force-remove packages/plugin-authsome/test/sections.test.ts
TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
NEW=$(git commit-tree "$TREE" -p "$OLD" -m "refactor: drop plugin sections now the rail is built from sub-plugins")
git update-ref refs/heads/main "$NEW" "$OLD"
```

If `update-ref` fails because main moved, redo from `OLD=`. Before running this, check `git status --short` on `packages/plugin/src/types.ts packages/plugin/src/define.ts packages/plugin/test/define.test.ts`: if any carries changes you did not make, stop and report NEEDS_CONTEXT.

Then sync the shared index for your paths so it matches the new HEAD:

```bash
for f in packages/plugin/src/types.ts packages/plugin/src/define.ts packages/plugin/test/define.test.ts; do
  git update-index --cacheinfo 100644,"$(git rev-parse HEAD:$f)","$f"
done
git update-index --cacheinfo 100644,"$B",packages/plugin-authsome/src/index.tsx
git update-index --force-remove packages/plugin-authsome/test/sections.test.ts 2>/dev/null || true
```

- [ ] **Step 5: Verify**

- `git show --stat HEAD` lists only those five paths, no trailer.
- `git diff --cached -- packages/plugin packages/plugin-authsome` prints nothing.
- `git diff HEAD -- packages/plugin-authsome/src/index.tsx` shows only the other session's hunks.
- `grep -rn "PluginSection\|sections:" packages/plugin/src packages/plugin-authsome/src packages/host/src` prints nothing.
- `pnpm typecheck` passes.

Never use `git add`, porcelain `git commit`, `git stash`, `git reset` or `git checkout` in this task.

---

### Task 7: Browser pass

**Files:** none expected. A fix goes back to the task that owns the file, with its test.

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @forge-go/dashboard-plugin test
pnpm --filter @forge-go/dashboard-kit test
pnpm --filter @forge-go/dashboard-host test
pnpm --filter @forge-go/dashboard-plugin-authsome test
pnpm typecheck
```

Expected: all green except the 8 known setup-screen failures.

- [ ] **Step 2: Look at it**

Against `fixture-server` and `dashboard-shell` from `.claude/launch.json`, screenshot and check:
- `/@auth/platform/users`: the rail shows the switcher glyph, the context icon, search, Authsome, a hairline, the plugin icons, and the account avatar at the foot. The secondary sidebar names "Authsome" and shows Identity, Configuration, Security, System sections.
- Click the Billing plugin: the URL moves to its first page, the secondary sidebar names "Billing" and lists its five pages.
- Click the context icon: a popover with App and Environment selects. Pick Demo App, then Staging; the rail entries keep `?env=`.
- Widen the rail on its edge: the switcher, the context control ("Demo App / Staging"), search, entry names, a Plugins heading, and the account name all show.
- Collapse the secondary sidebar with the header trigger: section labels turn vertical; clicking one reopens it.
- `/@warden`: the rail shows the switcher, search, Warden, and the account; no Plugins heading.
- Mobile preset: no rail; the sheet holds the switcher, context control, search, every entry's pages stacked, and the account menu.
