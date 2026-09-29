# Section Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a scope that declares `sections` (authsome first) an icon rail of its sections beside the pane, with each sub-plugin's pages under that sub-plugin's name, and put the scope dropdown and user menu back in the pane.

**Architecture:** `ForgePlugin` gains optional `sections`, each naming an existing nav `group` and an icon. The host's new `navSections()` turns a plugin's nav plus its ready sub-plugins' nav into `NavSection[]` (host items first, single-item sub-plugins folded in, multi-item sub-plugins as headed groups, unknown groups in "More"). The kit's `DashboardShell` renders a `SectionRail` of section links only when there are sections, offsetting the pane with the existing `--sidebar-offset`; `AppSidebar` shows the active section's groups on desktop and every section stacked on mobile. Scopes without `sections` render exactly as before the rail work.

**Tech Stack:** React 19, react-router, base-ui (`useRender`, Tooltip), Tailwind v4, lucide icons via `@forge-go/dashboard-kit/icons`, vitest + @testing-library/react under jsdom, pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-09-29-section-rail-design.md`

## Global Constraints

- Work directly on `main` in `/Users/rexraphael/Work/xraph/forge-dashboard`. Other sessions share this checkout and index: stage and commit ONLY the files a task names. Never `git add -A`, `git add .`, `git stash`, `git reset`, or `git checkout` other files.
- No Co-Authored-By or any other trailer in commit messages. No em dashes in commit messages.
- Kit components live in `packages/kit/src/components/*.tsx`, hooks in `packages/kit/src/hooks/*.ts`, exported by the wildcard entries in `packages/kit/package.json`. Import across kit files with `@forge-go/dashboard-kit/...`, never a relative path. Icons come from `@forge-go/dashboard-kit/icons` (a star re-export of lucide-react).
- Run one test file with `pnpm --filter <pkg> exec vitest run test/<file>`. Packages: `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`, `@forge-go/dashboard-host`, and the authsome plugin (read its name from `packages/plugin-authsome/package.json`).
- Baselines, not failures: `packages/host/test/setup-screen.test.tsx` has 8 pre-existing failing tests; package-wide kit lint has 19 pre-existing errors in unrelated files (e.g. `reui/data-grid`). Only your own files must lint clean.
- base-ui state booleans render as a bare `data-active` attribute (presence), never `data-active="true"`. Use `data-active:` Tailwind variants and assert with `hasAttribute("data-active")`.
- base-ui `render` merge rule, measured: the render element's own props and children win, `className` strings are joined, and a prop from the component lands only when the element did not set it.
- Rail storage key stays exactly `forge-dashboard.rail` (`expanded` | `collapsed`), read and written in try/catch, default collapsed.
- The section rail is `<nav aria-label="Sections">`; its edge toggle is named `Expand sections` / `Collapse sections`.
- The "More" section has id `__more` and label `More`.
- Mobile headed-group label format is `${section.label} · ${group.label}` (a middle dot with a space either side).
- Empty notice copy, verbatim, unchanged: `Pick an app to see its pages.`, `This extension needs configuring.`, `This extension needs a newer server.`, link label `Open setup`.
- Authsome's section order: Identity, Authentication, Security, Billing, Compliance, Enterprise, Configuration, System.
- These dirty or untracked files belong to other work; never stage them: `packages/host/src/ForgeDashboard.tsx`, `packages/host/src/auth/AuthRoutes.tsx`, `packages/host/src/host/NavigationSearch.tsx`, `packages/host/test/nav-groups.test.tsx`, `packages/host/test/setup-screen.test.tsx`, `packages/kit/src/components/site-header.tsx`.

## Review Focus

1. A section link must keep the current query string (`?env=staging`) because it navigates inside the same scope and the environment is a query dimension. Pinned in Task 2 (`RailEntries` `search` prop) and Task 3 (shell passes `search`).
2. A section whose first node is a folded cluster must link to a real page, not the cluster's synthetic row. Pinned in Task 4.
3. A deep page no nav item names (`/@auth/users/usr_1`) must still light the right section by longest prefix, and a route matching nothing must fall back to the first section, not to none. Pinned in Task 4.
4. A scope without `sections` must render no rail and a `0px` offset, so warden, vault, relay and the playground look exactly as before. Pinned in Task 3 and Task 5 (`host-playground.test.tsx` stays green).
5. A sub-plugin with a group string authsome never declared must still be reachable. Pinned in Task 4 (More section) and Task 6 (authsome declares every group its sub-plugins use).

---

### Task 1: `sections` on the plugin contract

**Files:**
- Modify: `packages/plugin/src/types.ts` (add `PluginSection`, add `sections?` to `ForgePlugin`)
- Modify: `packages/plugin/src/define.ts` (validate sections in `definePlugin`)
- Test: `packages/plugin/test/define.test.ts` (append a describe block)

**Interfaces:**
- Produces: `export interface PluginSection { group: string; label?: string; icon: ReactNode }` and `ForgePlugin.sections?: PluginSection[]`, exported through `packages/plugin/src/index.ts` (`export * from "./types"`, already there). `PluginInput` picks `sections` up automatically because it is `Omit<ForgePlugin, "nav" | "context">`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/define.test.ts`:

```ts
describe("definePlugin sections", () => {
  it("keeps declared sections as given", () => {
    const p = definePlugin({
      extension: "auth",
      routes: [],
      sections: [
        { group: "Identity", icon: "I" },
        { group: "Billing", label: "Money", icon: "B" },
      ],
    })
    expect(p.sections).toEqual([
      { group: "Identity", icon: "I" },
      { group: "Billing", label: "Money", icon: "B" },
    ])
  })

  it("leaves sections undefined when none are declared", () => {
    expect(definePlugin({ extension: "vault", routes: [] }).sections).toBeUndefined()
  })

  it("refuses a section with an empty group", () => {
    expect(() =>
      definePlugin({ extension: "auth", routes: [], sections: [{ group: "", icon: "I" }] }),
    ).toThrow(/needs a `group`/)
  })

  it("refuses two sections collecting the same group", () => {
    expect(() =>
      definePlugin({
        extension: "auth",
        routes: [],
        sections: [
          { group: "Identity", icon: "I" },
          { group: "Identity", icon: "J" },
        ],
      }),
    ).toThrow(/both collect the group "Identity"/)
  })

  it("refuses a section with no icon", () => {
    expect(() =>
      definePlugin({
        extension: "auth",
        routes: [],
        sections: [{ group: "Identity", icon: undefined as unknown as string }],
      }),
    ).toThrow(/section "Identity" needs an `icon`/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin exec vitest run test/define.test.ts`
Expected: the three "refuses" tests FAIL (nothing throws). The first two pass or fail on types only.

- [ ] **Step 3: Add the type**

In `packages/plugin/src/types.ts`, directly above `export interface ForgePlugin {`, add:

```ts
/**
 * One entry in a scope's section rail.
 *
 * A section collects every nav item, the plugin's own and its sub-plugins',
 * whose `group` equals `group`. Nothing else in the contract changes: items
 * keep naming their group, and a plugin that declares no sections renders the
 * single pane it always has.
 */
export interface PluginSection {
  /** The nav `group` this section collects. Matches `PluginNavItem.group` exactly. */
  group: string
  /** Rail and heading label. Defaults to `group`. */
  label?: string
  /** Required: a narrow rail shows nothing else. */
  icon: ReactNode
}
```

Inside `ForgePlugin`, directly after the `context: ContextDimension[]` field and its comment, add:

```ts
  /**
   * Sections for a rail beside the pane, in rail order. Omit it and the scope
   * gets no rail. Items whose group no section names land in a trailing
   * "More" section, so none disappear.
   */
  sections?: PluginSection[]
```

- [ ] **Step 4: Validate in `definePlugin`**

In `packages/plugin/src/define.ts`, inside `definePlugin`, directly before the final `return`, add:

```ts
  const seenSections = new Set<string>()
  for (const section of input.sections ?? []) {
    if (!section.group) {
      throw new Error(
        `definePlugin: a section needs a \`group\` naming the nav group it collects (plugin "${input.extension}")`,
      )
    }
    if (seenSections.has(section.group)) {
      throw new Error(
        `definePlugin: two sections both collect the group "${section.group}", so the rail cannot tell which one owns its items (plugin "${input.extension}")`,
      )
    }
    if (section.icon === undefined || section.icon === null) {
      throw new Error(
        `definePlugin: section "${section.group}" needs an \`icon\`, because a narrow rail shows nothing else (plugin "${input.extension}")`,
      )
    }
    seenSections.add(section.group)
  }
```

- [ ] **Step 5: Run the plugin suite and typecheck**

Run: `pnpm --filter @forge-go/dashboard-plugin test && pnpm --filter @forge-go/dashboard-plugin typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/types.ts packages/plugin/src/define.ts packages/plugin/test/define.test.ts
git commit -m "feat(plugin): let a plugin declare sections for a rail beside its pane"
```

---

### Task 2: `NavSection`, `RailEntries` and `SectionRail` in the kit

**Files:**
- Modify: `packages/kit/src/components/nav-tree.tsx` (add `NavSection` after `NavGroup`)
- Create: `packages/kit/src/components/rail-entries.tsx`
- Create: `packages/kit/src/components/section-rail.tsx`
- Test: `packages/kit/test/rail-entries.test.tsx`
- Test: `packages/kit/test/section-rail.test.tsx`

`scope-entries.tsx`, `scope-rail.tsx` and their tests stay until Task 3, which removes their last importers.

**Interfaces:**
- Consumes: `useRailExpanded` is untouched; `NavNode`, `NavGroup` from `nav-tree.tsx`.
- Produces:
  - `export interface NavSection { id: string; label: string; icon: ReactNode; href: string; groups: NavGroup[] }` in `nav-tree.tsx`
  - `export interface RailItem { id: string; label: string; href: string; icon?: ReactNode }`
  - `export type RenderRailLink = (node: NavNode, href: string) => ReactElement`
  - `export function RailGlyph(props: { icon?: ReactNode; label: string; className?: string }): ReactElement`
  - `export function RailEntries(props: { items: RailItem[]; activeId?: string; renderLink: RenderRailLink; search?: string; expanded?: boolean }): ReactElement`
  - `export function SectionRail(props: { items: RailItem[]; activeId?: string; renderLink: RenderRailLink; search?: string; expanded: boolean; onToggle: () => void }): ReactElement | null`

- [ ] **Step 1: Add `NavSection`**

In `packages/kit/src/components/nav-tree.tsx`, directly after the `NavGroup` interface, add:

```ts
/**
 * One entry in a scope's section rail and the pane it opens. The host builds
 * these; the kit only draws them. `href` is the section's first page, which
 * is where clicking the rail entry goes.
 */
export interface NavSection {
  id: string
  label: string
  icon: ReactNode
  href: string
  groups: NavGroup[]
}
```

`ReactNode` is already imported in that file for `NavNode.icon`; if it is not, add it to the existing `react` type import.

- [ ] **Step 2: Write the failing rail-entries test**

```tsx
// packages/kit/test/rail-entries.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { RailEntries } from "../src/components/rail-entries"
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
  { id: "Identity", label: "Identity", href: "/@auth/p/users", icon: <svg data-testid="identity-icon" /> },
  { id: "Billing", label: "Billing", href: "/@auth/p/plans" },
]

function renderEntries(props: Partial<React.ComponentProps<typeof RailEntries>> = {}) {
  return render(
    <SidebarProvider>
      <RailEntries items={items} activeId="Billing" renderLink={renderLink} {...props} />
    </SidebarProvider>,
  )
}

describe("RailEntries", () => {
  it("renders one link per item, in order, to its href", () => {
    renderEntries()
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/@auth/p/users",
      "/@auth/p/plans",
    ])
  })

  it("keeps the query string on every link", () => {
    renderEntries({ search: "?env=staging" })
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/p/plans?env=staging")
  })

  it("marks the active item and nothing else", () => {
    renderEntries()
    const billing = screen.getByRole("link", { name: "Billing" })
    expect(billing.getAttribute("aria-current")).toBe("page")
    expect(billing.hasAttribute("data-active")).toBe(true)
    const identity = screen.getByRole("link", { name: "Identity" })
    expect(identity.getAttribute("aria-current")).toBeNull()
    expect(identity.hasAttribute("data-active")).toBe(false)
  })

  it("draws the item's icon, or an initial when there is none", () => {
    renderEntries()
    expect(screen.getByTestId("identity-icon")).toBeTruthy()
    const glyph = screen.getByRole("link", { name: "Billing" }).querySelector('[data-slot="rail-glyph"]') as HTMLElement
    expect(glyph.textContent).toBe("B")
  })

  it("hides labels from sight when collapsed and shows them when expanded", () => {
    const collapsed = renderEntries()
    expect(screen.getByRole("link", { name: "Billing" }).className).toContain("[&>span:last-child]:sr-only")
    collapsed.unmount()
    renderEntries({ expanded: true })
    const link = screen.getByRole("link", { name: "Billing" })
    expect(link.className).toContain("[&>span:last-child]:truncate")
    expect(link.className).not.toContain("sr-only")
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/rail-entries.test.tsx`
Expected: FAIL, cannot resolve `../src/components/rail-entries`.

- [ ] **Step 4: Write `rail-entries.tsx`**

```tsx
// packages/kit/src/components/rail-entries.tsx
import type { ReactElement, ReactNode } from "react"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

/** One entry in a rail. Presentational: no plugin, no router. */
export interface RailItem {
  id: string
  label: string
  /** Absolute path the entry links to. The host computes it. */
  href: string
  icon?: ReactNode
}

export type RenderRailLink = (node: NavNode, href: string) => ReactElement

// Spread, not index: a label that opens with an emoji is one code point and
// two UTF-16 units, and `label[0]` would hand back half a surrogate pair.
function initial(label: string): string {
  const first = [...label.trim()][0]
  return first ? first.toUpperCase() : "?"
}

/** The tile an entry's icon sits in, with an initial when there is no icon. */
export function RailGlyph({
  icon,
  label,
  className,
}: {
  icon?: ReactNode
  label: string
  className?: string
}) {
  return (
    <span
      data-slot="rail-glyph"
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold [&>svg]:size-4",
        className,
      )}
    >
      {icon ?? initial(label)}
    </span>
  )
}

/**
 * What the host's `renderLink` draws: `{icon}<span>{label}</span>`. The glyph
 * goes in as the icon because the element `renderLink` returns keeps its own
 * children through `useRender`; there is no way to inject different ones
 * from this side.
 */
function nodeFor(item: RailItem): NavNode {
  return {
    label: item.label,
    href: item.href,
    icon: <RailGlyph icon={item.icon} label={item.label} />,
  }
}

const RAIL_LINK =
  "flex h-10 items-center overflow-hidden rounded-md text-sm text-sidebar-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
// `>span:last-child` is the label span the host's renderLink renders after the
// glyph. Collapsed it is read but not seen; expanded it is a normal label.
const RAIL_LINK_ICON = "w-10 justify-center [&>span:last-child]:sr-only"
const RAIL_LINK_LABELLED = "w-full justify-start gap-2 px-1 [&>span:last-child]:truncate"

function RailEntry({
  item,
  active,
  expanded,
  search,
  renderLink,
}: {
  item: RailItem
  active: boolean
  expanded: boolean
  search: string
  renderLink: RenderRailLink
}) {
  // Same shape SidebarMenuButton uses for its tooltip: the host's link element
  // becomes the tooltip trigger, and this component's classes and aria are
  // merged onto it. The element's own props win where they are set.
  const element = useRender({
    defaultTagName: "a",
    render: <TooltipTrigger render={renderLink(nodeFor(item), `${item.href}${search}`)} />,
    props: {
      className: cn(RAIL_LINK, expanded ? RAIL_LINK_LABELLED : RAIL_LINK_ICON),
      "aria-current": active ? "page" : undefined,
    },
    state: { slot: "rail-link", active },
  })
  return (
    <Tooltip>
      {element}
      <TooltipContent side="right" hidden={expanded}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

export interface RailEntriesProps {
  items: RailItem[]
  activeId?: string
  renderLink: RenderRailLink
  /** Appended to every href, so a rail inside one scope keeps its query dimensions. */
  search?: string
  /** Labels are visible when true and screen-reader-only when false. */
  expanded?: boolean
}

export function RailEntries({
  items,
  activeId,
  renderLink,
  search = "",
  expanded = false,
}: RailEntriesProps) {
  return (
    <ul
      data-slot="rail-entries"
      className={cn("flex flex-col gap-1", expanded ? "items-stretch" : "items-center")}
    >
      {items.map((item) => (
        <li key={item.id} className={expanded ? "w-full" : undefined}>
          <RailEntry
            item={item}
            active={item.id === activeId}
            expanded={expanded}
            search={search}
            renderLink={renderLink}
          />
        </li>
      ))}
    </ul>
  )
}
```

If `useRender` rejects a plain `props` object in its types, wrap it as `mergeProps<"a">({ ... }, {})` from `@base-ui/react/merge-props` exactly as `scope-entries.tsx` does, and say so in your report.

- [ ] **Step 5: Run the rail-entries test**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/rail-entries.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing section-rail test**

```tsx
// packages/kit/test/section-rail.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { SectionRail } from "../src/components/section-rail"
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
  { id: "Identity", label: "Identity", href: "/@auth/p/users" },
  { id: "Billing", label: "Billing", href: "/@auth/p/plans" },
]

function renderRail(expanded: boolean, onToggle = vi.fn()) {
  const view = render(
    <SidebarProvider>
      <SectionRail items={items} activeId="Billing" renderLink={renderLink} search="?env=staging" expanded={expanded} onToggle={onToggle} />
    </SidebarProvider>,
  )
  return { ...view, onToggle }
}

const originalWidth = window.innerWidth

describe("SectionRail", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("is a navigation landmark named Sections with one link per section", () => {
    renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/@auth/p/users?env=staging",
      "/@auth/p/plans?env=staging",
    ])
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
  })

  it("carries no user menu", () => {
    renderRail(false)
    expect(within(screen.getByRole("navigation", { name: "Sections" })).queryByRole("button", { name: /Dashboard user|Ada/ })).toBeNull()
  })

  it("is icon width when collapsed and sidebar width when expanded", () => {
    const collapsed = renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(rail.getAttribute("data-state")).toBe("collapsed")
    expect(rail.className).toContain("w-(--sidebar-width-icon)")
    collapsed.unmount()
    renderRail(true)
    const wide = screen.getByRole("navigation", { name: "Sections" })
    expect(wide.getAttribute("data-state")).toBe("expanded")
    expect(wide.className).toMatch(/(^|\s)w-\(--sidebar-width\)(\s|$)/)
  })

  it("has an edge toggle named for the direction it moves, reporting aria-expanded", () => {
    const { onToggle } = renderRail(false)
    const toggle = screen.getByRole("button", { name: "Expand sections" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("names the toggle the other way when expanded", () => {
    renderRail(true)
    expect(screen.getByRole("button", { name: "Collapse sections" }).getAttribute("aria-expanded")).toBe("true")
  })

  it("renders nothing below the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderRail(false)
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/section-rail.test.tsx`
Expected: FAIL, cannot resolve `../src/components/section-rail`.

- [ ] **Step 8: Write `section-rail.tsx`**

```tsx
// packages/kit/src/components/section-rail.tsx
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { RailEntries } from "@forge-go/dashboard-kit/components/rail-entries"
import type { RailItem, RenderRailLink } from "@forge-go/dashboard-kit/components/rail-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"

export interface SectionRailProps {
  items: RailItem[]
  activeId?: string
  renderLink: RenderRailLink
  search?: string
  expanded: boolean
  onToggle: () => void
}

/**
 * The rail's right border, made clickable. A 16px strip straddling the
 * border with a 2px line down its middle that shows on hover and focus. It is
 * a real button in the tab order because it is the rail's only affordance;
 * the resize cursor says which way the column will move.
 */
function RailEdgeToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? "Collapse sections" : "Expand sections"
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
 * The icon column of one scope's sections. A plain `nav`, not a second shadcn
 * `Sidebar`: that component is `position: fixed` and two of them overlap. The
 * pane beside it learns the rail's width through `--sidebar-offset`, which
 * `DashboardShell` sets.
 *
 * Below the mobile breakpoint the pane's sheet stacks every section instead,
 * so this renders nothing there.
 */
export function SectionRail({
  items,
  activeId,
  renderLink,
  search,
  expanded,
  onToggle,
}: SectionRailProps) {
  const { isMobile } = useSidebar()
  if (isMobile) return null
  return (
    <nav
      aria-label="Sections"
      data-slot="section-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      className={cn(
        "sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-linear",
        expanded ? "w-(--sidebar-width) items-stretch px-2" : "w-(--sidebar-width-icon) items-center",
      )}
    >
      <RailEdgeToggle expanded={expanded} onToggle={onToggle} />
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          expanded ? "items-stretch" : "items-center",
        )}
      >
        <RailEntries
          items={items}
          activeId={activeId}
          renderLink={renderLink}
          search={search}
          expanded={expanded}
        />
      </div>
    </nav>
  )
}
```

- [ ] **Step 9: Run the kit suite, typecheck, and lint your files**

Run: `pnpm --filter @forge-go/dashboard-kit test && pnpm --filter @forge-go/dashboard-kit typecheck`, then `pnpm --filter @forge-go/dashboard-kit exec eslint src/components/rail-entries.tsx src/components/section-rail.tsx src/components/nav-tree.tsx test/rail-entries.test.tsx test/section-rail.test.tsx`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/kit/src/components/nav-tree.tsx packages/kit/src/components/rail-entries.tsx packages/kit/src/components/section-rail.tsx packages/kit/test/rail-entries.test.tsx packages/kit/test/section-rail.test.tsx
git commit -m "feat(kit): add the section rail and the NavSection it draws"
```

---

### Task 3: The pane and the shell take sections

**Files:**
- Modify: `packages/kit/src/components/app-sidebar.tsx` (whole file)
- Modify: `packages/kit/src/components/dashboard-shell.tsx` (whole file)
- Modify: `packages/kit/test/app-sidebar.test.tsx` (whole file)
- Modify: `packages/kit/test/dashboard-shell.test.tsx` (whole file)
- Delete: `packages/kit/src/components/scope-entries.tsx`, `packages/kit/src/components/scope-rail.tsx`, `packages/kit/test/scope-entries.test.tsx`, `packages/kit/test/scope-rail.test.tsx`

**Interfaces:**
- Consumes: `NavSection` (Task 2), `SectionRail` (Task 2), `useRailExpanded` (existing), `ScopeSwitcher`, `ScopeOption` and `ScopeSwitcherProps` from `scope-switcher.tsx` (existing, unchanged).
- Produces:
  ```ts
  export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    scopes: ScopeOption[]              // scope-switcher's ScopeOption: { id, label, namespace, icon?, badge? }
    activeScopeId?: string
    onScopeSelect: (id: string) => void
    scopeHome?: ScopeSwitcherProps["home"]
    navigationLayout?: "tree" | "collapsible"
    groups: NavGroup[]
    sections?: NavSection[]
    activeSectionId?: string
    empty?: { message: string; href?: string; label?: string }
    currentPath: string
    search?: string
    renderLink: (node: NavNode, href: string) => ReactElement
    header?: ReactNode
    user: { name: string; email: string; avatar?: string }
    onSignOut?: () => void
  }
  export function stackSections(sections: NavSection[]): NavGroup[]
  export interface DashboardShellProps extends Omit<AppSidebarProps, "children"> { title?; scope?; actions?; children: ReactNode }
  ```
  After this task `packages/host` does not typecheck until Task 5. That is expected.

- [ ] **Step 1: Replace the AppSidebar test**

```tsx
// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { SidebarProvider, useSidebar } from "../src/components/sidebar"
import { AppSidebar, stackSections } from "../src/components/app-sidebar"
import type { NavSection } from "../src/components/nav-tree"

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

const sections: NavSection[] = [
  {
    id: "Identity",
    label: "Identity",
    icon: null,
    href: "/@auth/users",
    groups: [{ items: [{ label: "Users", href: "/@auth/users" }] }],
  },
  {
    id: "Billing",
    label: "Billing",
    icon: null,
    href: "/@auth/plans",
    groups: [
      { items: [{ label: "Credits", href: "/@auth/credits" }] },
      { label: "Plans", contributed: true, items: [
        { label: "Plans", href: "/@auth/plans" },
        { label: "Invoices", href: "/@auth/invoices" },
      ] },
    ],
  },
]

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
        activeScopeId="auth"
        onScopeSelect={() => {}}
        groups={[{ label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] }]}
        currentPath="/@auth/users"
        renderLink={renderLink}
        user={{ name: "Dashboard user", email: "user@example.com" }}
        {...overrides}
      />
    </SidebarProvider>,
  )
}

const header = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-header"]') as HTMLElement
const content = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-content"]') as HTMLElement

describe("AppSidebar", () => {
  it("renders contributed nav", () => {
    renderSidebar()
    expect(screen.getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("renders the header slot when one is passed", () => {
    renderSidebar({ header: <div>context bar</div> })
    expect(screen.getByText("context bar")).toBeTruthy()
  })

  it("carries no dashboard-01 fixture content", () => {
    renderSidebar()
    expect(screen.queryByText("Word Assistant")).toBeNull()
    expect(screen.queryByText("Acme Inc.")).toBeNull()
    expect(screen.queryByText("Quick Create")).toBeNull()
    expect(screen.queryByText("Data Library")).toBeNull()
  })

  it("puts the scope switcher back in the header", () => {
    const { container } = renderSidebar()
    expect(within(header(container)).getByText("@auth")).toBeTruthy()
    expect(within(header(container)).getByRole("button", { name: /Auth/ })).toBeTruthy()
  })

  it("renders no switcher when there are no scopes and no home", () => {
    const { container } = renderSidebar({ scopes: [] })
    expect(within(header(container)).queryByRole("button")).toBeNull()
  })

  it("puts the user menu in the footer", () => {
    const { container } = renderSidebar()
    const footer = container.querySelector('[data-slot="sidebar-footer"]') as HTMLElement
    expect(within(footer).getByText("Dashboard user")).toBeTruthy()
  })

  it("renders the empty notice with a link that carries the search string", () => {
    const { container } = renderSidebar({
      groups: [],
      search: "?env=staging",
      empty: { message: "This extension needs configuring.", href: "/@auth", label: "Open setup" },
    })
    const c = content(container)
    expect(within(c).getByText("This extension needs configuring.")).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Open setup" }).getAttribute("href")).toBe("/@auth?env=staging")
  })

  it("renders a message-only empty notice without a link", () => {
    const { container } = renderSidebar({ groups: [], empty: { message: "Pick an app to see its pages." } })
    const c = content(container)
    expect(within(c).getByText("Pick an app to see its pages.")).toBeTruthy()
    expect(within(c).queryByRole("link")).toBeNull()
  })

  it("shows only the active section's groups on desktop, with sub-plugin headings", () => {
    const { container } = renderSidebar({ sections, activeSectionId: "Billing", currentPath: "/@auth/plans" })
    const c = content(container)
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()
    expect(within(c).getByRole("link", { name: "Credits" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Invoices" })).toBeTruthy()
    expect(within(c).getAllByText("Plans").length).toBe(2)
  })

  it("falls back to the first section when the active id matches none", () => {
    const { container } = renderSidebar({ sections, activeSectionId: "Nope" })
    expect(within(content(container)).getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("ignores groups when sections are given", () => {
    const { container } = renderSidebar({
      sections,
      activeSectionId: "Identity",
      groups: [{ items: [{ label: "Stale", href: "/stale" }] }],
    })
    expect(within(content(container)).queryByRole("link", { name: "Stale" })).toBeNull()
  })

  it("stacks every section in the mobile sheet", async () => {
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
            scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
            activeScopeId="auth"
            onScopeSelect={() => {}}
            groups={[]}
            sections={sections}
            activeSectionId="Billing"
            currentPath="/@auth/plans"
            renderLink={renderLink}
            user={{ name: "Dashboard user", email: "user@example.com" }}
          />
        </SidebarProvider>,
      )
      const sheet = await screen.findByRole("dialog")
      expect(within(sheet).getByRole("link", { name: "Users" })).toBeTruthy()
      expect(within(sheet).getByRole("link", { name: "Invoices" })).toBeTruthy()
      expect(within(sheet).getByText("Billing · Plans")).toBeTruthy()
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true })
    }
  })
})

describe("stackSections", () => {
  it("labels each section's first unlabelled group with the section, and prefixes headed groups", () => {
    expect(stackSections(sections).map((g) => g.label)).toEqual(["Identity", "Billing", "Billing · Plans"])
  })

  it("labels a section whose first group is headed through the prefix alone", () => {
    const onlyHeaded: NavSection[] = [
      { id: "Billing", label: "Billing", icon: null, href: "/p", groups: [{ label: "Plans", items: [{ label: "Plans", href: "/p" }] }] },
    ]
    expect(stackSections(onlyHeaded).map((g) => g.label)).toEqual(["Billing · Plans"])
  })
})
```

- [ ] **Step 2: Replace the DashboardShell test**

```tsx
// packages/kit/test/dashboard-shell.test.tsx
import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DashboardShell } from "../src/components/dashboard-shell"
import type { NavSection } from "../src/components/nav-tree"

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

const sections: NavSection[] = [
  { id: "Identity", label: "Identity", icon: null, href: "/@auth/users", groups: [{ items: [{ label: "Users", href: "/@auth/users" }] }] },
  { id: "Billing", label: "Billing", icon: null, href: "/@auth/plans", groups: [{ items: [{ label: "Plans", href: "/@auth/plans" }] }] },
]

function renderShell(props: Partial<React.ComponentProps<typeof DashboardShell>> = {}) {
  return render(
    <DashboardShell
      title="Users"
      scope="Auth"
      scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
      activeScopeId="auth"
      onScopeSelect={() => {}}
      groups={[{ items: [{ label: "Users", href: "/@auth/users" }] }]}
      currentPath="/@auth/users"
      renderLink={renderLink}
      user={{ name: "Dashboard user", email: "user@example.com" }}
      {...props}
    >
      <p>page body</p>
    </DashboardShell>,
  )
}

const wrapperStyle = (c: HTMLElement) =>
  (c.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement).getAttribute("style") ?? ""

describe("DashboardShell", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders pane and content, and no rail, without sections", () => {
    const { container } = renderShell()
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: 0px")
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Users")).toBeTruthy()
  })

  it("renders the section rail with sections and offsets the pane by its width", () => {
    const { container } = renderShell({ sections, activeSectionId: "Billing", search: "?env=staging" })
    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/plans?env=staging")
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width-icon)")
    fireEvent.click(screen.getByRole("button", { name: "Expand sections" }))
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width)")
    expect(window.localStorage.getItem("forge-dashboard.rail")).toBe("expanded")
  })

  it("renders no rail for an empty sections list", () => {
    const { container } = renderShell({ sections: [] })
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: 0px")
  })

  it("keeps the pane icon-collapsible, whatever the caller passes", () => {
    const { container } = renderShell({ collapsible: "offcanvas" })
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-variant")).toBe("sidebar")
    expect(sidebar.getAttribute("data-collapsible")).toBe("")
    const siteHeader = container.querySelector("header") as HTMLElement
    fireEvent.click(within(siteHeader).getByRole("button", { name: "Toggle Sidebar" }))
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/app-sidebar.test.tsx test/dashboard-shell.test.tsx`
Expected: FAIL (no `stackSections` export; props mismatch; rail named "Scopes").

- [ ] **Step 4: Rewrite `app-sidebar.tsx`**

```tsx
// packages/kit/src/components/app-sidebar.tsx
import * as React from "react"
import type { ReactElement, ReactNode } from "react"

import { NavTree } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavMain } from "@forge-go/dashboard-kit/components/nav-main"
import type { NavGroup, NavNode, NavSection } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeSwitcher } from "@forge-go/dashboard-kit/components/scope-switcher"
import type {
  ScopeOption,
  ScopeSwitcherProps,
} from "@forge-go/dashboard-kit/components/scope-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  scopes: ScopeOption[]
  activeScopeId?: string
  onScopeSelect: (id: string) => void
  scopeHome?: ScopeSwitcherProps["home"]
  navigationLayout?: "tree" | "collapsible"
  /** The scope's nav when it declares no sections. Ignored when `sections` is given. */
  groups: NavGroup[]
  /** The scope's sections. The pane shows the active one on desktop and all of them on mobile. */
  sections?: NavSection[]
  activeSectionId?: string
  /** Shown when the scope has no pages to list and there is a reason to say so. */
  empty?: { message: string; href?: string; label?: string }
  currentPath: string
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
  /** Rendered under the switcher. The host puts the context switchers and search here. */
  header?: ReactNode
  user: { name: string; email: string; avatar?: string }
  onSignOut?: () => void
}

/**
 * Every section as one list of groups, for the mobile sheet, where there is
 * no rail to pick a section with. A section's own items take the section's
 * name; a sub-plugin's headed group reads "Billing · Plans" so it still says
 * where it belongs.
 */
export function stackSections(sections: NavSection[]): NavGroup[] {
  return sections.flatMap((section) =>
    section.groups.map((group, index) => ({
      ...group,
      label: group.label
        ? `${section.label} · ${group.label}`
        : index === 0
          ? section.label
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
 * The pane: scope switcher, the scope's context switchers and search (through
 * `header`), its nav, and the user menu. A scope that declares sections shows
 * one section at a time here, picked in the rail beside it.
 */
export function AppSidebar({
  scopes,
  activeScopeId,
  onScopeSelect,
  scopeHome,
  navigationLayout = "tree",
  groups,
  sections,
  activeSectionId,
  empty,
  currentPath,
  search,
  renderLink,
  header,
  user,
  onSignOut,
  ...props
}: AppSidebarProps) {
  const { isMobile } = useSidebar()
  const Navigation = navigationLayout === "collapsible" ? NavMain : NavTree
  const shown =
    sections && sections.length > 0
      ? isMobile
        ? stackSections(sections)
        : (sections.find((section) => section.id === activeSectionId) ?? sections[0]).groups
      : groups
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {scopes.length > 0 || scopeHome ? (
          <ScopeSwitcher
            scopes={scopes}
            activeId={activeScopeId}
            onSelect={onScopeSelect}
            home={scopeHome}
            menuSide={navigationLayout === "collapsible" ? "right" : "bottom"}
          />
        ) : null}
        {header}
      </SidebarHeader>
      <SidebarContent>
        {empty ? <EmptyNotice {...empty} search={search} renderLink={renderLink} /> : null}
        <Navigation
          groups={shown}
          currentPath={currentPath}
          search={search}
          renderLink={renderLink}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
      {navigationLayout === "collapsible" && <SidebarRail />}
    </Sidebar>
  )
}
```

- [ ] **Step 5: Rewrite `dashboard-shell.tsx`**

```tsx
// packages/kit/src/components/dashboard-shell.tsx
import type { CSSProperties, ReactNode } from "react"

import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import type { AppSidebarProps } from "@forge-go/dashboard-kit/components/app-sidebar"
import { SectionRail } from "@forge-go/dashboard-kit/components/section-rail"
import { SidebarInset, SidebarProvider } from "@forge-go/dashboard-kit/components/sidebar"
import { SiteHeader } from "@forge-go/dashboard-kit/components/site-header"
import { useRailExpanded } from "@forge-go/dashboard-kit/hooks/use-rail-expanded"

export interface DashboardShellProps extends Omit<AppSidebarProps, "children"> {
  title?: string
  scope?: string
  actions?: ReactNode
  children: ReactNode
}

/**
 * The dashboard's chrome: the active scope's section rail when it declares
 * sections, the pane, and the content with its header. The only thing the
 * pane needs to know about the rail is how wide it is, and it learns that
 * through `--sidebar-offset` on the provider: 0 when there is no rail.
 */
export function DashboardShell({
  title,
  scope,
  actions,
  children,
  sections,
  activeSectionId,
  ...pane
}: DashboardShellProps) {
  const { expanded, toggle } = useRailExpanded()
  const hasRail = !!sections && sections.length > 0
  const offset = !hasRail
    ? "0px"
    : expanded
      ? "var(--sidebar-width)"
      : "var(--sidebar-width-icon)"
  return (
    <SidebarProvider style={{ "--sidebar-offset": offset } as CSSProperties}>
      {hasRail ? (
        <SectionRail
          items={sections.map((section) => ({
            id: section.id,
            label: section.label,
            href: section.href,
            icon: section.icon,
          }))}
          activeId={activeSectionId ?? sections[0].id}
          renderLink={pane.renderLink}
          search={pane.search}
          expanded={expanded}
          onToggle={toggle}
        />
      ) : null}
      <AppSidebar
        {...pane}
        sections={sections}
        activeSectionId={activeSectionId}
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

- [ ] **Step 6: Delete the scope-rail files**

```bash
git rm packages/kit/src/components/scope-entries.tsx packages/kit/src/components/scope-rail.tsx packages/kit/test/scope-entries.test.tsx packages/kit/test/scope-rail.test.tsx
```

Then confirm nothing in the kit still imports them: `grep -rn "scope-entries\|scope-rail\|ScopeRail\|ScopeEntries" packages/kit/src packages/kit/test` must print nothing. (`packages/host` still imports `scope-entries`; Task 5 fixes that.)

- [ ] **Step 7: Run the kit suite, typecheck, lint your files**

Run: `pnpm --filter @forge-go/dashboard-kit test && pnpm --filter @forge-go/dashboard-kit typecheck`, then eslint on the four files you changed.
Expected: PASS. If the switcher button's accessible name is not matched by `/Auth/`, read `scope-switcher.tsx`'s trigger and adjust only that regex.

- [ ] **Step 8: Commit**

```bash
git add packages/kit/src/components/app-sidebar.tsx packages/kit/src/components/dashboard-shell.tsx packages/kit/test/app-sidebar.test.tsx packages/kit/test/dashboard-shell.test.tsx
git commit -m "feat(kit): show one section at a time in the pane, with the scope switcher back"
```

(The `git rm` in Step 6 already staged the deletions; this commit includes them.)

---

### Task 4: `navSections` and `activeSectionId` in the host

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (add two exported pure functions after `navGroups`; add one icon import)
- Test: `packages/host/test/nav-sections.test.tsx`

**Interfaces:**
- Consumes: `PluginSection` (Task 1), `NavSection` (Task 2), existing `foldClusters`, `toNodes`, `PluginNavItem`.
- Produces:
  - `export function navSections(plugin: ForgePlugin, subPlugins: ForgeSubPlugin[], segment?: string): NavSection[]`
  - `export function activeSectionId(sections: NavSection[], pathname: string): string | undefined`
  - `export const MORE_SECTION = "__more"`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/host/test/nav-sections.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { MORE_SECTION, activeSectionId, navSections } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  sections: [
    { group: "Identity", icon: "I" },
    { group: "Billing", icon: "B" },
    { group: "Security", label: "Safety", icon: "S" },
    { group: "Compliance", icon: "C" },
  ],
  nav: [
    { label: "Users", to: "/users", group: "Identity", priority: 10 },
    { label: "Sessions", to: "/sessions", group: "Identity", priority: 20 },
    { label: "Stray", to: "/stray", group: "Nowhere" },
    { label: "Loose", to: "/loose" },
  ],
  routes: [{ path: "/users", element: Noop }],
})

const orgs = defineSubPlugin({
  extension: "organization",
  host: "auth",
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity", priority: 15 }],
  routes: [{ path: "/organizations", element: Noop }],
})

const billing = defineSubPlugin({
  extension: "subscription",
  host: "auth",
  label: "Plans",
  nav: [
    { label: "Plans", to: "/plans", group: "Billing", priority: 1 },
    { label: "Invoices", to: "/invoices", group: "Billing", priority: 2 },
  ],
  routes: [{ path: "/plans", element: Noop }],
})

const risk = defineSubPlugin({
  extension: "riskengine",
  host: "auth",
  nav: [{ label: "Risk Engine", to: "/security/risk", group: "Security", priority: 0, cluster: { label: "Threat detection" } }],
  routes: [{ path: "/security/risk", element: Noop }],
})

const anomaly = defineSubPlugin({
  extension: "anomaly",
  host: "auth",
  nav: [{ label: "Anomaly Detection", to: "/security/anomaly", group: "Security", priority: 1, cluster: { label: "Threat detection" } }],
  routes: [{ path: "/security/anomaly", element: Noop }],
})

const all = [orgs, billing, risk, anomaly]

describe("navSections", () => {
  it("returns nothing for a plugin that declares no sections", () => {
    const plain = definePlugin({ extension: "vault", nav: [{ label: "Secrets", to: "/secrets" }], routes: [] })
    expect(navSections(plain, [])).toEqual([])
  })

  it("keeps declared order, uses a section's label, drops empty sections, and ends with More", () => {
    const sections = navSections(auth, all)
    expect(sections.map((s) => s.id)).toEqual(["Identity", "Billing", "Security", MORE_SECTION])
    expect(sections.map((s) => s.label)).toEqual(["Identity", "Billing", "Safety", "More"])
  })

  it("folds a single-item sub-plugin into the host's list, in priority order", () => {
    const identity = navSections(auth, all).find((s) => s.id === "Identity")!
    expect(identity.groups).toHaveLength(1)
    expect(identity.groups[0].label).toBeUndefined()
    expect(identity.groups[0].items.map((i) => i.label)).toEqual(["Users", "Organizations", "Sessions"])
    expect(identity.href).toBe("/@auth/users")
  })

  it("gives a multi-item sub-plugin its own headed group, labelled with the sub-plugin", () => {
    const section = navSections(auth, all).find((s) => s.id === "Billing")!
    expect(section.groups.map((g) => g.label)).toEqual(["Plans"])
    expect(section.groups[0].items.map((i) => i.label)).toEqual(["Plans", "Invoices"])
    expect(section.groups[0].contributed).toBe(true)
    expect(section.href).toBe("/@auth/plans")
  })

  it("falls back to the sub-plugin's extension when it has no label", () => {
    const unlabelled = defineSubPlugin({
      extension: "ledger",
      host: "auth",
      nav: [
        { label: "Accounts", to: "/accounts", group: "Billing" },
        { label: "Entries", to: "/entries", group: "Billing" },
      ],
      routes: [],
    })
    const section = navSections(auth, [unlabelled]).find((s) => s.id === "Billing")!
    expect(section.groups[0].label).toBe("ledger")
  })

  it("still folds clusters inside a section, and links the section to the cluster's first real page", () => {
    const security = navSections(auth, all).find((s) => s.id === "Security")!
    const cluster = security.groups[0].items[0]
    expect(cluster.label).toBe("Threat detection")
    expect(cluster.children?.map((c) => c.label)).toEqual(["Risk Engine", "Anomaly Detection"])
    expect(security.href).toBe("/@auth/security/risk")
  })

  it("collects items with an unknown group or no group into More", () => {
    const more = navSections(auth, all).find((s) => s.id === MORE_SECTION)!
    expect(more.groups[0].items.map((i) => i.label).sort()).toEqual(["Loose", "Stray"])
  })

  it("mounts hrefs under the app segment when one is given", () => {
    const identity = navSections(auth, all, "platform").find((s) => s.id === "Identity")!
    expect(identity.href).toBe(identity.groups[0].items[0].href)
  })
})

describe("activeSectionId", () => {
  const sections = navSections(auth, all)

  it("picks the section holding the current page", () => {
    expect(activeSectionId(sections, "/@auth/invoices")).toBe("Billing")
  })

  it("picks by longest prefix for a page no nav item names", () => {
    expect(activeSectionId(sections, "/@auth/users/usr_1")).toBe("Identity")
  })

  it("finds pages inside a folded cluster", () => {
    expect(activeSectionId(sections, "/@auth/security/anomaly")).toBe("Security")
  })

  it("falls back to the first section when nothing matches", () => {
    expect(activeSectionId(sections, "/@auth")).toBe("Identity")
  })

  it("returns undefined for no sections", () => {
    expect(activeSectionId([], "/@auth/users")).toBeUndefined()
  })
})
```

The segment test only checks the rule that `href` is the first node's href. `toNodes` already owns segment mounting and `nav-groups.test.tsx` covers it.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/nav-sections.test.tsx`
Expected: FAIL, `navSections` is not exported.

- [ ] **Step 3: Implement**

In `packages/host/src/host/PluginHost.tsx`:

Add `MoreHorizontalIcon` to the existing icons import, so it reads:

```tsx
import { MoreHorizontalIcon, TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"
```

Add `NavSection` to the existing `nav-tree` type import:

```tsx
import type {
  NavGroup,
  NavNode,
  NavSection,
} from "@forge-go/dashboard-kit/components/nav-tree"
```

Directly after the closing brace of `navGroups`, add:

```tsx
/** The id of the trailing section that collects items no declared section names. */
export const MORE_SECTION = "__more"

/**
 * A scope's sections, for the rail beside its pane. Empty for a plugin that
 * declares none, which is what keeps every other scope rendering the single
 * pane it always has.
 *
 * Inside a section the host's own items come first. A sub-plugin with one
 * item there joins that list; one with two or more gets its own group,
 * headed with the sub-plugin's label, so Billing reads "Plans" over its
 * pages. Both lists go through foldClusters and toNodes, so clusters fold
 * exactly as they do in navGroups.
 *
 * Items whose group names no section, and items with no group, go to a
 * trailing "More" section, so a sub-plugin with a group nobody declared is
 * still reachable. A section with no items is dropped.
 */
export function navSections(
  plugin: ForgePlugin,
  subPlugins: ForgeSubPlugin[],
  segment?: string,
): NavSection[] {
  const declared = plugin.sections ?? []
  if (declared.length === 0) return []

  const known = new Set(declared.map((section) => section.group))
  const sectionOf = (item: PluginNavItem) =>
    item.group !== undefined && known.has(item.group) ? item.group : MORE_SECTION

  const specs = [
    ...declared.map((section) => ({
      id: section.group,
      label: section.label ?? section.group,
      icon: section.icon,
    })),
    { id: MORE_SECTION, label: "More", icon: <MoreHorizontalIcon /> },
  ]

  return specs.flatMap((spec) => {
    const own = plugin.nav.filter((item) => sectionOf(item) === spec.id)
    let joined = false
    const headed: NavGroup[] = []
    for (const sub of subPlugins) {
      const items = sub.nav.filter((item) => sectionOf(item) === spec.id)
      if (items.length === 1) {
        own.push(items[0])
        joined = true
      } else if (items.length > 1) {
        headed.push({
          label: sub.label ?? sub.extension,
          contributed: true,
          items: toNodes(plugin, foldClusters(items), segment),
        })
      }
    }

    const groups: NavGroup[] = []
    if (own.length > 0) {
      groups.push({
        contributed: joined || undefined,
        items: toNodes(plugin, foldClusters(own), segment),
      })
    }
    groups.push(...headed)

    const first = groups[0]?.items[0]
    if (!first) return []
    return [{
      id: spec.id,
      label: spec.label,
      icon: spec.icon,
      href: first.children?.[0]?.href ?? first.href,
      groups,
    }]
  })
}

/**
 * The section holding the current page: the node whose href is the pathname
 * or its longest prefix, the rule `pageTitle` uses. A route no nav item names
 * lands on the first section, never on none, so the pane is never blank.
 */
export function activeSectionId(sections: NavSection[], pathname: string): string | undefined {
  let best: { id: string; length: number } | undefined
  for (const section of sections) {
    for (const group of section.groups) {
      for (const node of group.items) {
        for (const candidate of [node, ...(node.children ?? [])]) {
          const matches =
            candidate.href === pathname ||
            (candidate.href !== "/" && pathname.startsWith(`${candidate.href}/`))
          if (matches && (!best || candidate.href.length > best.length)) {
            best = { id: section.id, length: candidate.href.length }
          }
        }
      }
    }
  }
  return best?.id ?? sections[0]?.id
}
```

- [ ] **Step 4: Run the new test**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/nav-sections.test.tsx`
Expected: PASS. The rest of `packages/host` may not typecheck yet (Task 3 changed the kit props); that is Task 5.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/test/nav-sections.test.tsx
git commit -m "feat(host): build a scope's sections from its nav and its sub-plugins' nav"
```

---

### Task 5: The host wires sections and the scope switcher

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (imports, `scopeOptions`, remove `homeScope` and `heading`, restore `selectScope`, compute sections, use all groups for search and title, rebuild `sidebar`)
- Modify: `packages/host/test/host.test.tsx` (switcher tests back; new section tests)

**Interfaces:**
- Consumes: `navSections`, `activeSectionId` (Task 4); `DashboardShell` with `AppSidebarProps` from Task 3; `ScopeOption` from `scope-switcher.tsx`.
- Produces: the `sidebar` object satisfies `HostSidebar` with `scopes`, `activeScopeId`, `onScopeSelect`, `scopeHome`, `groups`, `sections`, `activeSectionId`, `empty`, `currentPath`, `search`, `renderLink`, `header`, `user`, `onSignOut`.

Line numbers drift because other sessions commit to this file's neighbours. Find every edit by its quoted text.

- [ ] **Step 1: Rewrite the host tests that assume the scope rail**

In `packages/host/test/host.test.tsx`:

(a) Find

```tsx
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Scopes" })).getByRole("link", {
        name: /gateway-contract/,
      }),
    )
```

and replace it with

```tsx
    fireEvent.click(
      await screen.findByRole("button", { name: /core-contract/ })
    )
    fireEvent.click(
      screen.getByRole("menuitem", { name: /gateway-contract/ })
    )
```

(b) Find

```tsx
    expect(
      within(screen.getByRole("navigation", { name: "Scopes" })).getByRole("link", { name: "Streaming" }),
    ).toBeTruthy()
```

and replace it with

```tsx
    expect(screen.getByRole("button", { name: "Streaming @streaming" })).toBeTruthy()
```

(c) Replace the three tests named `"puts the root in the scope rail inside a scope, and names the scope in the pane heading"`, `"returns to the root from the scope rail"` and `"marks home in the rail on the root's own pages, with no namespace in the heading"` with:

```tsx
  it("keeps root navigation in the scope switcher inside a scope", async () => {
    const { container } = renderHost(
      [rootPlugin(), authScopePlugin()],
      bothReady(),
      "/@auth/users",
    )
    await screen.findByText("auth users body")

    const h = header(container)
    expect(within(h).queryByRole("link", { name: "Overview" })).toBeNull()
    expect(within(h).getByRole("button", { name: "Auth @auth" })).toBeTruthy()
    expect(h.querySelector('[data-slot="sidebar-group"]')).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
  })

  it("returns to the root from the scope switcher", async () => {
    const { container } = renderHost(
      [rootPlugin(), authScopePlugin()], bothReady(), "/@auth/users",
    )
    await screen.findByText("auth users body")
    fireEvent.click(within(header(container)).getByRole("button", { name: "Auth @auth" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "System" }))
    expect(await screen.findByText("root overview body")).toBeTruthy()
  })
```

If the switcher's trigger name is not exactly `"Auth @auth"`, read `packages/kit/src/components/scope-switcher.tsx` and match what it renders; do not change the component.

(d) Add, at the end of the `describe("PluginHost root destination", ...)` block:

```tsx
  it("gives a scope with sections a Sections rail and shows only the active section", async () => {
    const sectioned = definePlugin({
      extension: "auth",
      namespace: "auth",
      label: "Auth",
      sections: [
        { group: "Identity", icon: "I" },
        { group: "Billing", icon: "B" },
      ],
      nav: [
        { label: "Users", to: "/users", group: "Identity" },
        { label: "Plans", to: "/plans", group: "Billing" },
      ],
      routes: [
        { path: "/users", element: () => <p>auth users body</p> },
        { path: "/plans", element: () => <p>auth plans body</p> },
      ],
    })
    const { container } = renderHost([rootPlugin(), sectioned], bothReady(), "/@auth/plans")
    await screen.findByText("auth plans body")

    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
    expect(within(rail).getByRole("link", { name: "Identity" }).getAttribute("href")).toBe("/@auth/users")
    const c = content(container)
    expect(within(c).getByRole("link", { name: "Plans" })).toBeTruthy()
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()

    fireEvent.click(within(rail).getByRole("link", { name: "Identity" }))
    expect(await screen.findByText("auth users body")).toBeTruthy()
    expect(within(content(container)).getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("lets search find a page in a section that is not showing", async () => {
    const sectioned = definePlugin({
      extension: "auth",
      namespace: "auth",
      label: "Auth",
      sections: [
        { group: "Identity", icon: "I" },
        { group: "Billing", icon: "B" },
      ],
      nav: [
        { label: "Users", to: "/users", group: "Identity" },
        { label: "Plans", to: "/plans", group: "Billing" },
      ],
      routes: [
        { path: "/users", element: () => <p>auth users body</p> },
        { path: "/plans", element: () => <p>auth plans body</p> },
      ],
    })
    renderHost([rootPlugin(), sectioned], bothReady(), "/@auth/users")
    await screen.findByText("auth users body")
    fireEvent.click(screen.getByRole("button", { name: "Search pages" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("link", { name: /Plans/ })).toBeTruthy()
  })
```

Keep the two empty-notice tests (`"says a setup scope needs configuring..."` and `"falls back to a fixed sentence..."`) and every `dashboardMain()` scoping exactly as they are.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/host.test.tsx`
Expected: FAIL (no switcher, no Sections rail).

- [ ] **Step 3: Change imports**

Replace

```tsx
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-entries"
```

with

```tsx
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-switcher"
```

- [ ] **Step 4: Scopes back to the switcher's shape**

Replace the whole `scopeOptions` declaration and the `homeScope` declaration that follows it (with its comment) with:

```tsx
  const scopeOptions: ScopeOption[] = scopes.map((scope) => ({
    id: scope.id,
    label: scope.label,
    namespace: scope.namespace,
    icon: scope.icon,
    badge: scope.state.kind === "ready" ? undefined : scope.state.kind,
  }))
```

- [ ] **Step 5: Sections, and one list of every page**

Delete the `heading` declaration and its comment (`const heading = navOwner ? {...} : undefined`).

Directly after the `groups` declaration, add:

```tsx
  // A scope that declares sections gets them; every other scope gets []. Same
  // readiness and no-segment rules as `groups`, so a scope with no app picked
  // has no sections and no rail, only the pick-an-app notice.
  const sections: NavSection[] =
    navOwner && navOwner.state.kind === "ready" && !(ownerDimension && !ownerSegment)
      ? navSections(navOwner.plugin, readySubPluginsFor(navOwner.plugin), ownerSegment)
      : []
  const currentSectionId = sections.length > 0 ? activeSectionId(sections, pathname) : undefined

  // Every page the scope offers, whichever section it sits in. Search and the
  // page title look across all of them, not just the section on screen.
  const allGroups: NavGroup[] =
    sections.length > 0 ? sections.flatMap((section) => section.groups) : groups
```

In `pageTitle`, change `groups.flatMap(` to `allGroups.flatMap(`.

In the `NavigationSearch` element inside `sidebar.header`, change `groups={groups}` to `groups={allGroups}`.

Update the comment above `navOwner` that begins `// No group label: the pane heading above already names the active scope` so it reads:

```tsx
  // No group label: the switcher above already names the active scope by
  // label and by "@namespace", so a section heading repeating either is text
  // a screen reader (and a test) would find twice.
```

- [ ] **Step 6: Restore `selectScope`**

Directly after the `onSignOut` declaration, add:

```tsx
  // Switching scope is a navigation, never a state write. A scope with no nav
  // (one that needs setup) goes to its bare namespace root, where its panel
  // renders. Search is carried over for now, but that is provisional: no
  // `ctx.` params exist yet, so there is nothing to drop and nothing to prove
  // this against. Per-scope context dimensions belong to the plugin that
  // declares them, so once `ctx.` params land, switching scope should DROP
  // any dimension the new scope never declared, not carry it over blind.
  const selectScope = (id: string) => {
    const target = scopes.find((scope) => scope.id === id)
    if (!target) return
    // homePathFor, not a bare first-nav-item mountPath: a target scope with
    // a `path`-routed dimension has no route mounted at its unscoped first
    // item at all (every real page lives under a segment), so landing there
    // literally would be a dead route. homePathFor already knows to send
    // that case to the namespace root instead, where RoutedPicker resolves
    // it the rest of the way.
    navigate(`${homePathFor(target.plugin)}${search}`)
  }
```

- [ ] **Step 7: Rebuild the `sidebar` object's scope fields**

In `const sidebar = {`, replace

```tsx
    home: homeScope,
    scopes: scopeOptions,
    activeScopeId: activeScope?.id,
    heading,
    empty,
    groups,
```

with

```tsx
    scopeHome: root ? {
      label: root.label,
      icon: root.icon,
      onSelect: () => navigate(`${homePathFor(root.plugin)}${search}`),
    } : undefined,
    scopes: scopeOptions,
    activeScopeId: activeScope?.id,
    onScopeSelect: selectScope,
    sections,
    activeSectionId: currentSectionId,
    empty,
    groups,
```

Update the comment above `renderLink` to say "The section rail merges its own aria-current" in place of "The rail merges its own aria-current". Leave `renderLink` itself as it is.

- [ ] **Step 8: Run the host suite, typecheck, lint**

Run: `pnpm --filter @forge-go/dashboard-host test && pnpm --filter @forge-go/dashboard-host typecheck`, then eslint on `src/host/PluginHost.tsx test/host.test.tsx`.
Expected: everything passes except the 8 known `setup-screen.test.tsx` failures. `host-playground.test.tsx` and `routed-context.test.tsx` pass unchanged. Then `grep -rn "scope-entries\|scope-rail" packages apps --include='*.ts' --include='*.tsx' | grep -v node_modules` must print nothing.

- [ ] **Step 9: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/test/host.test.tsx
git commit -m "feat(host): give a sectioned scope its rail, and put the scope switcher back"
```

---

### Task 6: Authsome declares its sections

**Files:**
- Modify: `packages/plugin-authsome/src/index.tsx` (icon import, `sections`)
- Test: `packages/plugin-authsome/test/sections.test.ts`

**Interfaces:**
- Consumes: `PluginSection` (Task 1).
- Produces: `authsomePlugin.sections` in the Global Constraints order.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin-authsome/test/sections.test.ts
import { describe, expect, it } from "vitest"
import { authsomePlugin } from "../src/index"
import { authsomeSubPlugins } from "../src/sub"

describe("authsome sections", () => {
  it("lists its sections in rail order", () => {
    expect(authsomePlugin.sections?.map((section) => section.group)).toEqual([
      "Identity",
      "Authentication",
      "Security",
      "Billing",
      "Compliance",
      "Enterprise",
      "Configuration",
      "System",
    ])
  })

  it("declares a section for every group it and its sub-plugins use, so nothing lands in More", () => {
    const declared = new Set((authsomePlugin.sections ?? []).map((section) => section.group))
    const used = new Set(
      [...authsomePlugin.nav, ...authsomeSubPlugins.flatMap((sub) => sub.nav)]
        .map((item) => item.group)
        .filter((group): group is string => typeof group === "string"),
    )
    expect([...used].filter((group) => !declared.has(group))).toEqual([])
  })

  it("gives every section an icon", () => {
    for (const section of authsomePlugin.sections ?? []) {
      expect(section.icon).toBeTruthy()
    }
  })
})
```

If `../src/index` does not export `authsomePlugin` under that name, or `../src/sub` does not export `authsomeSubPlugins`, read `packages/plugin-authsome/src/index.tsx` and `src/sub/index.ts` and use their real export names.

- [ ] **Step 2: Run to verify it fails**

Run the authsome package's vitest on `test/sections.test.ts`.
Expected: FAIL, `sections` is undefined.

- [ ] **Step 3: Declare the sections**

In `packages/plugin-authsome/src/index.tsx`, add `Building2Icon`, `CreditCardIcon`, `KeyRoundIcon`, `ScaleIcon`, `ServerIcon` and `ShieldIcon` to the existing `@forge-go/dashboard-kit/icons` import, keeping it alphabetical. `SettingsIcon` and `UsersIcon` are already there.

In `definePlugin({ ... })` for `authsomePlugin`, directly after `icon: <AuthsomeMark />,`, add:

```tsx
  // The rail beside the pane, one icon per group. Sub-plugins keep naming
  // their own group; a group added later without a section here still shows
  // up, in "More".
  sections: [
    { group: "Identity", icon: <UsersIcon /> },
    { group: "Authentication", icon: <KeyRoundIcon /> },
    { group: "Security", icon: <ShieldIcon /> },
    { group: "Billing", icon: <CreditCardIcon /> },
    { group: "Compliance", icon: <ScaleIcon /> },
    { group: "Enterprise", icon: <Building2Icon /> },
    { group: "Configuration", icon: <SettingsIcon /> },
    { group: "System", icon: <ServerIcon /> },
  ],
```

- [ ] **Step 4: Run the authsome suite and typecheck**

Run the authsome package's `test` and `typecheck` scripts.
Expected: PASS. If the "every group" test lists a group, that group is real: add it to `sections` with a fitting icon, and note it in your report.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/index.tsx packages/plugin-authsome/test/sections.test.ts
git commit -m "feat(authsome): declare its sections for the rail"
```

---

### Task 7: Warn when capabilities hides a plugin

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (a module-level helper and one effect)
- Test: `packages/host/test/host.test.tsx` (a new describe block)

**Interfaces:**
- Produces: one `console.warn` of the exact form `[forge-dashboard] plugin "<extension>" is hidden: capabilities lists no contributor named "<extension>". Contributors: a, b, c`, once per extension name per capabilities document, and never in a production build.

`packages/host` has no Node types and its `lib` is DOM only, and the Vite dev build has no `process` global. So the production check goes through a guarded helper. Vite's build still replaces `process.env.NODE_ENV` statically, so a production build reads `"production"`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/host/test/host.test.tsx`, as a new top-level `describe`:

```tsx
describe("PluginHost hidden-plugin diagnostics", () => {
  function ghostPlugin(): ForgePlugin {
    return definePlugin({
      extension: "ghost",
      nav: [{ label: "Ghost", to: "/ghost" }],
      routes: [{ path: "/ghost", element: () => null }],
    })
  }

  const hiddenLines = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("[forge-dashboard]"))

  it("warns once, naming the plugin and the contributors that did arrive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fetchImpl = capabilitiesFetch([{ name: "core-contract", envelopes: ["v1"], configured: true }])
      const plugins = [demoPlugin(), ghostPlugin()]
      const { rerender } = renderHost(plugins, fetchImpl)
      await screen.findByText("overview page body")
      expect(hiddenLines(warn)).toEqual([
        '[forge-dashboard] plugin "ghost" is hidden: capabilities lists no contributor named "ghost". Contributors: core-contract',
      ])
      // A re-render with the same fetch and plugins is not a new capabilities document.
      rerender(
        <MemoryRouter initialEntries={["/@core/overview"]}>
          <ForgeDashboardProvider config={config}>
            <SessionProvider fetchImpl={fetchImpl}>
              <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
            </SessionProvider>
          </ForgeDashboardProvider>
        </MemoryRouter>,
      )
      expect(hiddenLines(warn)).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it("stays silent in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      renderHost(
        [demoPlugin(), ghostPlugin()],
        capabilitiesFetch([{ name: "core-contract", envelopes: ["v1"], configured: true }]),
      )
      await screen.findByText("overview page body")
      expect(hiddenLines(warn)).toHaveLength(0)
    } finally {
      warn.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it("does not warn about a plugin that is present", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      renderHost([demoPlugin()], capabilitiesFetch([{ name: "core-contract", envelopes: ["v1"], configured: true }]))
      await screen.findByText("overview page body")
      expect(hiddenLines(warn)).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })
})
```

If the rerender produces a second line because the host re-fetches capabilities (a new document), keep the assertion and find out why the fetch re-ran; the point being pinned is one line per name per document.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/host.test.tsx -t "hidden-plugin"`
Expected: the first test FAILS with no lines.

- [ ] **Step 3: Add the helper and the effect**

Near the top of `PluginHost.tsx`, after the imports, add:

```tsx
// packages/host has no Node types and the Vite dev build has no `process`
// global. A production build still replaces `process.env.NODE_ENV`
// statically, so this reads "production" there and throws, caught, in dev.
declare const process: { env: { NODE_ENV?: string } }
function isProductionBuild(): boolean {
  try {
    return process.env.NODE_ENV === "production"
  } catch {
    return false
  }
}
```

Inside `PluginHost`, directly after the `resolvedSubs` declaration, add:

```tsx
  // A plugin capabilities does not list is hidden, and that is by design: a
  // deployment without the organization extension has no Organizations page.
  // But a typo in `extension`, or a server that never shipped the
  // contributor, looks exactly the same, and until now nothing said so. One
  // line per name per capabilities document, in development only.
  const warnedHidden = useRef<{ capabilities: Capabilities | undefined; names: Set<string> }>({
    capabilities: undefined,
    names: new Set(),
  })
  useEffect(() => {
    if (isProductionBuild() || state.status !== "ready") return
    if (warnedHidden.current.capabilities !== state.capabilities) {
      warnedHidden.current = { capabilities: state.capabilities, names: new Set() }
    }
    const present = state.capabilities.contributors.map((c) => c.name)
    for (const candidate of [...plugins, ...subPlugins]) {
      if (present.includes(candidate.extension)) continue
      if (warnedHidden.current.names.has(candidate.extension)) continue
      warnedHidden.current.names.add(candidate.extension)
      console.warn(
        `[forge-dashboard] plugin "${candidate.extension}" is hidden: capabilities lists no contributor named "${candidate.extension}". Contributors: ${present.join(", ")}`,
      )
    }
  }, [state, plugins, subPlugins])
```

If `declare const process` conflicts with a global `process` type in this package (it should not; there are no Node types), rename the local declaration's use through `globalThis` and say so in your report.

- [ ] **Step 4: Run the host suite and typecheck**

Run: `pnpm --filter @forge-go/dashboard-host test && pnpm --filter @forge-go/dashboard-host typecheck`
Expected: PASS apart from the 8 known setup-screen failures. The existing test that collects warn messages and expects none (`messages).toEqual([])`, around the alpha/beta collision test) still passes, because both of its plugins are listed in capabilities.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/test/host.test.tsx
git commit -m "feat(host): warn in development when capabilities hides a plugin"
```

---

### Task 8: Whole-workspace checks and the browser pass

**Files:** none expected. A fix found here goes back into the task that owns the file, with its test.

**Interfaces:** consumes everything above, plus `.claude/launch.json` configurations `fixture-server` (port 8099) and `dashboard-shell` (port 5173).

- [ ] **Step 1: Run the affected packages**

```bash
pnpm --filter @forge-go/dashboard-plugin test
pnpm --filter @forge-go/dashboard-kit test
pnpm --filter @forge-go/dashboard-host test
pnpm typecheck
```

Expected: all pass except the 8 known setup-screen failures. Record any other typecheck failure with its package.

- [ ] **Step 2: Authsome, rail collapsed**

Start `fixture-server` and `dashboard-shell`. Open `http://localhost:5173/@auth`, which redirects to `/@auth/platform/users`. Check: a `Sections` rail on the far left with eight icons, Identity active; the pane beside it with the scope switcher reading Authsome, the App and Environment switchers, search, then Identity's pages (Users, Organizations, Sessions, Devices, Roles); the user menu at the pane's foot. Screenshot.

- [ ] **Step 3: Billing, and the query string**

Pick the Staging environment if the fixture offers one for the app, so the URL carries `?env=...`. Click the Billing icon. The URL moves to Billing's first page and keeps `?env=`. The pane shows the "Plans" heading over Plans, Subscriptions, Invoices, Coupons and Feature catalog. Screenshot.

- [ ] **Step 4: Security with a cluster, rail widened**

Click Security. The pane shows the Threat detection and Location security clusters. Click the rail's right edge: the rail widens with labels and the pane moves right. Reload and confirm it stays widened. Screenshot, then collapse it again.

- [ ] **Step 5: A scope without sections**

Switch to Warden with the scope switcher. There is no rail, the pane starts at the left edge, and Warden's nav is as before. Screenshot.

- [ ] **Step 6: Bare `/@auth` with no app**

Make the fixture's `apps.context` report no current app, locally and uncommitted (read `packages/fixture-server/server.mjs` around `currentAppId` and `platformAppId()`), restart it, and open `http://localhost:5173/@auth`. The page shows the app picker, the pane shows "Pick an app to see its pages.", and there is no rail. Screenshot, then revert the local edit.

- [ ] **Step 7: Mobile**

Switch the preview to the mobile preset and reload `/@auth/platform/users`. There is no rail. Open the sheet with the header trigger: every section's pages stacked, with "Billing · Plans" as a heading. Screenshot, then reset to desktop.

- [ ] **Step 8: Report**

Attach the screenshots and the Step 1 output. No commit unless a fix was needed, made under its owning task.
