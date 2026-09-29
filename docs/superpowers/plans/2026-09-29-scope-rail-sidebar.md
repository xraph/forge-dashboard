# Scope Rail Sidebar Implementation Plan

> **Superseded** by `2026-09-29-section-rail.md` after Task 6. Tasks 7 to 9 were not run; the section-rail plan reworks what Tasks 1 to 6 committed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's scope dropdown with an icon rail of scopes beside a pane that holds the active scope's context switchers and nav, so every scope is one click away and authsome's 35 entries get a full column.

**Architecture:** The kit gains a `DashboardShell` that owns the arrangement (rail, pane, inset) and sets one CSS variable, `--sidebar-offset`, that the shadcn `Sidebar` container reads for its `left`. `AppSidebar` becomes the pane (heading, context switchers, nav, empty notice). `PluginHost` keeps computing the same `sidebar` object and hands it to `DashboardShell` instead of `AppSidebar`; it also gains `href` per scope, a heading, an empty notice, and a dev-only warning for plugins capabilities hides.

**Tech Stack:** React 19, react-router, base-ui (`useRender`, Tooltip), Tailwind v4, vitest + @testing-library/react under jsdom, pnpm workspaces with turbo.

**Spec:** `docs/superpowers/specs/2026-09-29-scope-rail-sidebar-design.md`

## Global Constraints

- Kit components live in `packages/kit/src/components/*.tsx` and hooks in `packages/kit/src/hooks/*.ts`; both are exported by the wildcard entries in `packages/kit/package.json` (`./components/*`, `./hooks/*`). Import across kit files with the `@forge-go/dashboard-kit/...` alias, never a relative path.
- Kit tests live in `packages/kit/test/*.test.tsx`, host tests in `packages/host/test/*.test.tsx`. Run one file with `pnpm --filter @forge-go/dashboard-kit exec vitest run test/<file>` (or `@forge-go/dashboard-host`).
- The rail's storage key is exactly `forge-dashboard.rail`, values `expanded` or `collapsed`. Every read and write is inside try/catch.
- The rail is `<nav aria-label="Scopes">`. Collapsed width is `var(--sidebar-width-icon)` (3rem), expanded is `var(--sidebar-width)` (16rem). Default is collapsed.
- The pane stays `collapsible="icon"`, `navigationLayout="collapsible"`, `variant="sidebar"`.
- Empty notice copy, verbatim: `Pick an app to see its pages.`, `This extension needs configuring.`, `This extension needs a newer server.`, link label `Open setup`.
- Hidden-plugin warning is gated by `process.env.NODE_ENV !== "production"` and fires once per extension name.
- The `#dashboard-main` container keeps the class `@container/main`; the stat cards' container queries depend on it.
- Commit messages: plain conventional prefix (`feat(kit): ...`, `feat(host): ...`, `test: ...`), no Co-Authored-By trailer, no em dashes.
- Every base-ui `render` merge follows the measured rule: the render element's own props and children win, `className` strings are joined, and a prop from the component only lands when the element did not set it. Never pass `children` through `useRender` props expecting them to replace the element's.

## Review Focus

1. A scope whose `label` starts with an astral character (an emoji) must still get a one-glyph fallback initial and not a broken surrogate. Pinned in Task 2 (`initial` spreads the string).
2. `localStorage.getItem` throwing (private window, blocked storage) must leave the rail collapsed and still toggleable. Pinned in Task 3.
3. A `renderLink` that already sets `aria-current="page"` on the scope's home path (the host does, when you are on that exact page) must not double up or clash with the rail's own `aria-current`. Pinned in Task 6 (the host only spreads it when true, and the rail test asserts `page` once).
4. A `setup` scope with no server message must still show a readable notice and an `Open setup` link, not `undefined`. Pinned in Task 6.
5. The playground (`apps/playground`) mounts `PluginHost` with one root plugin and no scopes; the rail must render with just the home entry and the pane heading must not show a namespace there. Pinned in Task 6 (host-playground test stays green) and Task 9 (browser check at `/`).

---

### Task 1: `--sidebar-offset` on the shadcn Sidebar

**Files:**
- Modify: `packages/kit/src/components/sidebar.tsx:129-137` (provider style) and `:214-220` (container class)
- Test: `packages/kit/test/sidebar-offset.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the `SidebarProvider` wrapper always carries `--sidebar-offset` (default `0px`); `sidebar-container` positions with `left-(--sidebar-offset)` and, when offcanvas-hidden, `left-[calc(var(--sidebar-offset)-var(--sidebar-width))]`. `DashboardShell` (Task 5) overrides the variable through the provider's `style` prop.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/sidebar-offset.test.tsx
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import type { CSSProperties } from "react"
import { Sidebar, SidebarProvider } from "../src/components/sidebar"

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

describe("Sidebar offset", () => {
  it("defaults the offset to zero so a bare provider keeps the sidebar at the left edge", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>body</Sidebar>
      </SidebarProvider>,
    )
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement
    expect(wrapper.getAttribute("style")).toContain("--sidebar-offset: 0px")
    const sidebar = container.querySelector('[data-slot="sidebar-container"]') as HTMLElement
    expect(sidebar.className).toContain("data-[side=left]:left-(--sidebar-offset)")
    expect(sidebar.className).toContain(
      "data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-offset)-var(--sidebar-width))]",
    )
    expect(sidebar.className).not.toContain("data-[side=left]:left-0 ")
  })

  it("takes an offset from the provider's style", () => {
    const { container } = render(
      <SidebarProvider style={{ "--sidebar-offset": "3rem" } as CSSProperties}>
        <Sidebar>body</Sidebar>
      </SidebarProvider>,
    )
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement
    expect(wrapper.getAttribute("style")).toContain("--sidebar-offset: 3rem")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/sidebar-offset.test.tsx`
Expected: FAIL on the first assertion (`style` attribute has no `--sidebar-offset`).

- [ ] **Step 3: Add the variable and the class**

In `packages/kit/src/components/sidebar.tsx`, inside `SidebarProvider`, change the wrapper style to:

```tsx
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            // Where the sidebar's fixed container starts. 0 on its own; a
            // shell that puts a rail before the sidebar sets it to the rail's
            // width, and the container and its offcanvas hiding both follow.
            "--sidebar-offset": "0px",
            ...style,
          } as React.CSSProperties
        }
```

In `Sidebar`, in the `sidebar-container` `className`, replace

```
data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]
```

with

```
data-[side=left]:left-(--sidebar-offset) data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-offset)-var(--sidebar-width))]
```

Leave the `data-[side=right]` classes exactly as they are.

- [ ] **Step 4: Run the kit suite**

Run: `pnpm --filter @forge-go/dashboard-kit test`
Expected: PASS, including the new file and the untouched `app-sidebar.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/sidebar.tsx packages/kit/test/sidebar-offset.test.tsx
git commit -m "feat(kit): let a shell offset the sidebar with --sidebar-offset"
```

---

### Task 2: `ScopeOption`, `ScopeGlyph` and `ScopeEntries`

**Files:**
- Create: `packages/kit/src/components/scope-entries.tsx`
- Test: `packages/kit/test/scope-entries.test.tsx`

**Interfaces:**
- Consumes: `NavNode` from `nav-tree.tsx`; `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuItem` from `sidebar.tsx`; `Tooltip`, `TooltipContent`, `TooltipTrigger` from `tooltip.tsx`; `useRender` and `mergeProps` from base-ui.
- Produces:
  - `interface ScopeOption { id: string; label: string; namespace: string; href: string; icon?: ReactNode; badge?: string }`
  - `type RenderScopeLink = (node: NavNode, href: string) => ReactElement`
  - `function scopeDescription(scope: Pick<ScopeOption, "label" | "badge">): string`
  - `function ScopeGlyph(props: { icon?: ReactNode; label: string; badge?: string; className?: string }): ReactElement`
  - `function ScopeEntries(props: { home?: ScopeOption; scopes: ScopeOption[]; activeScopeId?: string; renderLink: RenderScopeLink; presentation: "rail" | "rows"; expanded?: boolean }): ReactElement`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/scope-entries.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeEntries, scopeDescription } from "../src/components/scope-entries"
import type { ScopeOption } from "../src/components/scope-entries"

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

// The same shape the host's renderLink produces: icon first, label in a span.
const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

const home: ScopeOption = { id: "core-contract", label: "System", namespace: "core", href: "/overview" }
const scopes: ScopeOption[] = [
  { id: "auth", label: "Auth", namespace: "auth", href: "/@auth" },
  { id: "gateway-contract", label: "Gateway", namespace: "gateway", href: "/@gateway/first", badge: "setup" },
]

describe("scopeDescription", () => {
  it("names the state after the label", () => {
    expect(scopeDescription({ label: "Auth" })).toBe("Auth")
    expect(scopeDescription({ label: "Gateway", badge: "setup" })).toBe("Gateway (needs setup)")
    expect(scopeDescription({ label: "Gateway", badge: "mismatch" })).toBe("Gateway (version mismatch)")
  })
})

describe("ScopeEntries rail", () => {
  function renderRail(activeScopeId?: string, expanded = false) {
    return render(
      <SidebarProvider>
        <ScopeEntries
          presentation="rail"
          home={home}
          scopes={scopes}
          activeScopeId={activeScopeId}
          renderLink={renderLink}
          expanded={expanded}
        />
      </SidebarProvider>,
    )
  }

  it("renders home first, then every scope, each as a link to its href", () => {
    renderRail("auth")
    const links = screen.getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/overview", "/@auth", "/@gateway/first"])
  })

  it("marks the active scope and nothing else", () => {
    renderRail("auth")
    const active = screen.getByRole("link", { name: "Auth" })
    expect(active.getAttribute("aria-current")).toBe("page")
    expect(active.getAttribute("data-active")).toBe("true")
    expect(screen.getByRole("link", { name: "System" }).getAttribute("aria-current")).toBeNull()
  })

  it("marks home when no scope is active", () => {
    renderRail(undefined)
    expect(screen.getByRole("link", { name: "System" }).getAttribute("aria-current")).toBe("page")
  })

  it("puts the state in the accessible name and a dot on the glyph", () => {
    renderRail("auth")
    const gateway = screen.getByRole("link", { name: "Gateway (needs setup)" })
    const dot = gateway.querySelector('[data-slot="scope-badge"]') as HTMLElement
    expect(dot.getAttribute("data-badge")).toBe("setup")
    expect(screen.getByRole("link", { name: "Auth" }).querySelector('[data-slot="scope-badge"]')).toBeNull()
  })

  it("draws an initial when a scope has no icon, by code point", () => {
    render(
      <SidebarProvider>
        <ScopeEntries
          presentation="rail"
          scopes={[{ id: "x", label: "🚀 Rockets", namespace: "x", href: "/@x" }]}
          renderLink={renderLink}
        />
      </SidebarProvider>,
    )
    const glyph = screen.getByRole("link").querySelector('[data-slot="scope-glyph"]') as HTMLElement
    expect(glyph.textContent).toBe("🚀")
  })

  it("hides labels from sight when collapsed and shows them when expanded", () => {
    const collapsed = renderRail("auth")
    expect(screen.getByRole("link", { name: "Auth" }).className).toContain("[&>span:last-child]:sr-only")
    collapsed.unmount()
    renderRail("auth", true)
    expect(screen.getByRole("link", { name: "Auth" }).className).toContain("[&>span:last-child]:truncate")
    expect(screen.getByRole("link", { name: "Auth" }).className).not.toContain("sr-only")
  })
})

describe("ScopeEntries rows", () => {
  it("renders the same entries as sidebar menu rows", () => {
    const { container } = render(
      <SidebarProvider>
        <ScopeEntries presentation="rows" home={home} scopes={scopes} activeScopeId="gateway-contract" renderLink={renderLink} />
      </SidebarProvider>,
    )
    const menu = container.querySelector('[data-slot="scope-rows"]') as HTMLElement
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "SSystem",
      "AAuth",
      "GGateway (needs setup)",
    ])
    expect(within(menu).getByRole("link", { name: "Gateway (needs setup)" }).getAttribute("data-active")).toBe("true")
  })
})
```

The `"SSystem"` strings are the glyph initial followed by the label; the initial is `aria-hidden`, so the accessible name stays `System`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/scope-entries.test.tsx`
Expected: FAIL, cannot resolve `../src/components/scope-entries`.

- [ ] **Step 3: Write the component**

```tsx
// packages/kit/src/components/scope-entries.tsx
import type { ReactElement, ReactNode } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@forge-go/dashboard-kit/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

/** One selectable scope. Presentational: no plugin, no router, no capabilities. */
export interface ScopeOption {
  id: string
  label: string
  /** Shown under the label in the pane heading and the mobile rows. */
  namespace: string
  /** Absolute path of the scope's home page. The host computes it; the kit only links to it. */
  href: string
  icon?: ReactNode
  /** Short state marker for a scope that is not ready: "setup" or "mismatch". */
  badge?: string
}

export type RenderScopeLink = (node: NavNode, href: string) => ReactElement

/** The label with its state, which is what tooltips and screen readers get. */
export function scopeDescription(scope: Pick<ScopeOption, "label" | "badge">): string {
  switch (scope.badge) {
    case "setup":
      return `${scope.label} (needs setup)`
    case "mismatch":
      return `${scope.label} (version mismatch)`
    default:
      return scope.label
  }
}

// Spread, not index: a label that opens with an emoji is one code point and
// two UTF-16 units, and `label[0]` would hand back half a surrogate pair.
function initial(label: string): string {
  const first = [...label.trim()][0]
  return first ? first.toUpperCase() : "?"
}

/**
 * The accent tile a scope's icon sits in, with an initial when there is no
 * icon and a dot when the scope is not ready. The dot is aria-hidden because
 * the state is already in the link's name (see `scopeDescription`).
 */
export function ScopeGlyph({
  icon,
  label,
  badge,
  className,
}: {
  icon?: ReactNode
  label: string
  badge?: string
  className?: string
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        data-slot="scope-glyph"
        aria-hidden="true"
        className={cn(
          "grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground [&>svg]:size-5",
          className,
        )}
      >
        {icon ?? initial(label)}
      </span>
      {badge ? (
        <span
          data-slot="scope-badge"
          data-badge={badge}
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive ring-2 ring-sidebar"
        />
      ) : null}
    </span>
  )
}

/**
 * What the host's `renderLink` draws: `{icon}<span>{label}</span>`. The glyph
 * goes in as the icon and the description as the label, because the element
 * `renderLink` returns keeps its own children through `useRender`; there is no
 * way to inject different ones from this side.
 */
function nodeFor(scope: ScopeOption): NavNode {
  return {
    label: scopeDescription(scope),
    href: scope.href,
    icon: <ScopeGlyph icon={scope.icon} label={scope.label} badge={scope.badge} />,
  }
}

const RAIL_LINK =
  "flex h-10 items-center overflow-hidden rounded-md text-sm text-sidebar-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
// `>span:last-child` is the label span the host's renderLink renders after the
// glyph. Collapsed it is read but not seen; expanded it is a normal label.
const RAIL_LINK_ICON = "w-10 justify-center [&>span:last-child]:sr-only"
const RAIL_LINK_LABELLED = "w-full justify-start gap-2 px-1 [&>span:last-child]:truncate"

function RailEntry({
  scope,
  active,
  expanded,
  renderLink,
}: {
  scope: ScopeOption
  active: boolean
  expanded: boolean
  renderLink: RenderScopeLink
}) {
  const description = scopeDescription(scope)
  // Same shape SidebarMenuButton uses for its tooltip: the host's link element
  // becomes the tooltip trigger, and this component's classes and aria are
  // merged onto it. The element's own props win where they are set.
  const element = useRender({
    defaultTagName: "a",
    render: <TooltipTrigger render={renderLink(nodeFor(scope), scope.href)} />,
    props: mergeProps<"a">(
      {
        className: cn(RAIL_LINK, expanded ? RAIL_LINK_LABELLED : RAIL_LINK_ICON),
        "aria-current": active ? "page" : undefined,
      },
      {},
    ),
    state: { slot: "scope-rail-link", active },
  })
  return (
    <Tooltip>
      {element}
      <TooltipContent side="right" hidden={expanded}>
        {description}
      </TooltipContent>
    </Tooltip>
  )
}

export interface ScopeEntriesProps {
  home?: ScopeOption
  scopes: ScopeOption[]
  activeScopeId?: string
  renderLink: RenderScopeLink
  /** "rail" is the icon column; "rows" is the list the mobile sheet shows. */
  presentation: "rail" | "rows"
  /** Rail only. Labels are visible when true and screen-reader-only when false. */
  expanded?: boolean
}

/**
 * The one list of scopes, drawn two ways. Home comes first and is the active
 * entry whenever no scope is, which is every root-plugin page.
 */
export function ScopeEntries({
  home,
  scopes,
  activeScopeId,
  renderLink,
  presentation,
  expanded = false,
}: ScopeEntriesProps) {
  const entries = home ? [home, ...scopes] : scopes
  const isActive = (scope: ScopeOption) =>
    activeScopeId ? scope.id === activeScopeId : scope === home

  if (presentation === "rows") {
    return (
      <SidebarMenu data-slot="scope-rows">
        {entries.map((scope) => (
          <SidebarMenuItem key={scope.id}>
            <SidebarMenuButton
              size="lg"
              isActive={isActive(scope)}
              render={renderLink(nodeFor(scope), scope.href)}
            />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    )
  }

  return (
    <ul
      data-slot="scope-rail-entries"
      className={cn("flex flex-col gap-1", expanded ? "items-stretch" : "items-center")}
    >
      {entries.map((scope) => (
        <li key={scope.id} className={expanded ? "w-full" : undefined}>
          <RailEntry
            scope={scope}
            active={isActive(scope)}
            expanded={expanded}
            renderLink={renderLink}
          />
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/scope-entries.test.tsx`
Expected: PASS, 8 tests. If the `"SSystem"` text assertion fails because `SidebarMenuButton` puts the glyph after the label, read the DOM it printed and fix the expected strings, not the component; the order comes from `renderLink`.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/scope-entries.tsx packages/kit/test/scope-entries.test.tsx
git commit -m "feat(kit): add ScopeEntries, the scope list drawn as a rail or as rows"
```

---

### Task 3: `useRailExpanded` and `ScopeRail`

**Files:**
- Create: `packages/kit/src/hooks/use-rail-expanded.ts`
- Create: `packages/kit/src/components/scope-rail.tsx`
- Test: `packages/kit/test/use-rail-expanded.test.ts`
- Test: `packages/kit/test/scope-rail.test.tsx`

**Interfaces:**
- Consumes: `ScopeEntries`, `ScopeOption`, `RenderScopeLink` from Task 2; `NavUser` from `nav-user.tsx`; `useSidebar` from `sidebar.tsx`.
- Produces:
  - `const RAIL_STORAGE_KEY = "forge-dashboard.rail"`
  - `function useRailExpanded(): { expanded: boolean; toggle: () => void }`
  - `function ScopeRail(props: { home?: ScopeOption; scopes: ScopeOption[]; activeScopeId?: string; renderLink: RenderScopeLink; expanded: boolean; onToggle: () => void; user: { name: string; email: string; avatar?: string }; onSignOut?: () => void }): ReactElement | null`

- [ ] **Step 1: Write the failing hook test**

```ts
// packages/kit/test/use-rail-expanded.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { RAIL_STORAGE_KEY, useRailExpanded } from "../src/hooks/use-rail-expanded"

describe("useRailExpanded", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("starts collapsed with nothing stored", () => {
    const { result } = renderHook(() => useRailExpanded())
    expect(result.current.expanded).toBe(false)
  })

  it("starts expanded when that is what was stored", () => {
    window.localStorage.setItem(RAIL_STORAGE_KEY, "expanded")
    const { result } = renderHook(() => useRailExpanded())
    expect(result.current.expanded).toBe(true)
  })

  it("toggles and writes the new state", () => {
    const { result } = renderHook(() => useRailExpanded())
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(true)
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("expanded")
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(false)
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed")
  })

  it("still toggles when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    const { result } = renderHook(() => useRailExpanded())
    expect(result.current.expanded).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/use-rail-expanded.test.ts`
Expected: FAIL, cannot resolve `../src/hooks/use-rail-expanded`.

- [ ] **Step 3: Write the hook**

```ts
// packages/kit/src/hooks/use-rail-expanded.ts
import * as React from "react"

export const RAIL_STORAGE_KEY = "forge-dashboard.rail"

function readStored(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "expanded"
  } catch {
    return false
  }
}

/**
 * Whether the scope rail shows labels. Per browser, not per scope, and
 * collapsed until somebody widens it. Storage that throws (private windows,
 * blocked site data) leaves the rail working and merely forgetful.
 */
export function useRailExpanded(): { expanded: boolean; toggle: () => void } {
  const [expanded, setExpanded] = React.useState(readStored)
  const toggle = React.useCallback(() => {
    setExpanded((value) => {
      const next = !value
      try {
        window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "expanded" : "collapsed")
      } catch {
        // Nothing to do: the state still flips, it just will not survive a reload.
      }
      return next
    })
  }, [])
  return { expanded, toggle }
}
```

- [ ] **Step 4: Run the hook test**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/use-rail-expanded.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing rail test**

```tsx
// packages/kit/test/scope-rail.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeRail } from "../src/components/scope-rail"
import type { ScopeOption } from "../src/components/scope-entries"

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

const home: ScopeOption = { id: "core-contract", label: "System", namespace: "core", href: "/overview" }
const scopes: ScopeOption[] = [{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]
const user = { name: "Ada Lovelace", email: "ada@example.com" }

function renderRail(expanded: boolean, onToggle = vi.fn()) {
  const view = render(
    <SidebarProvider>
      <ScopeRail
        home={home}
        scopes={scopes}
        activeScopeId="auth"
        renderLink={renderLink}
        expanded={expanded}
        onToggle={onToggle}
        user={user}
      />
    </SidebarProvider>,
  )
  return { ...view, onToggle }
}

const originalWidth = window.innerWidth

describe("ScopeRail", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("is a navigation landmark named Scopes with the entries and the user menu", () => {
    renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(within(rail).getByRole("link", { name: "System" })).toBeTruthy()
    expect(within(rail).getByRole("link", { name: "Auth" }).getAttribute("aria-current")).toBe("page")
    expect(within(rail).getByText("Ada Lovelace")).toBeTruthy()
  })

  it("exposes the collapsed state the way the sidebar does, so NavUser shrinks to its avatar", () => {
    renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(rail.getAttribute("data-collapsible")).toBe("icon")
    expect(rail.getAttribute("data-state")).toBe("collapsed")
    expect(rail.className).toContain("w-(--sidebar-width-icon)")
  })

  it("widens when expanded", () => {
    renderRail(true)
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(rail.getAttribute("data-collapsible")).toBe("")
    expect(rail.getAttribute("data-state")).toBe("expanded")
    expect(rail.className).toContain("w-(--sidebar-width)")
  })

  it("has an edge toggle that reports its state and calls back", () => {
    const { onToggle } = renderRail(false)
    const toggle = screen.getByRole("button", { name: "Expand scopes" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("names the toggle for the other direction when expanded", () => {
    renderRail(true)
    expect(screen.getByRole("button", { name: "Collapse scopes" }).getAttribute("aria-expanded")).toBe("true")
  })

  it("renders nothing below the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderRail(false)
    expect(screen.queryByRole("navigation", { name: "Scopes" })).toBeNull()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/scope-rail.test.tsx`
Expected: FAIL, cannot resolve `../src/components/scope-rail`.

- [ ] **Step 7: Write the rail**

```tsx
// packages/kit/src/components/scope-rail.tsx
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeEntries } from "@forge-go/dashboard-kit/components/scope-entries"
import type {
  RenderScopeLink,
  ScopeOption,
} from "@forge-go/dashboard-kit/components/scope-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"

export interface ScopeRailProps {
  home?: ScopeOption
  scopes: ScopeOption[]
  activeScopeId?: string
  renderLink: RenderScopeLink
  expanded: boolean
  onToggle: () => void
  user: { name: string; email: string; avatar?: string }
  onSignOut?: () => void
}

/**
 * The rail's right border, made clickable. A 16px strip straddling the
 * border with a 2px line down its middle that shows on hover and focus. It is
 * a real button in the tab order because it is the rail's only affordance;
 * the resize cursor says which way the column will move.
 */
function RailEdgeToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? "Collapse scopes" : "Expand scopes"
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
 * The icon column of scopes. A plain `nav`, not a second shadcn `Sidebar`:
 * that component is `position: fixed` and two of them overlap. It carries the
 * same `group` class and `data-collapsible` attribute the sidebar sets when it
 * is an icon column, so `NavUser` at the foot collapses to its avatar with the
 * styles it already has.
 *
 * Below the mobile breakpoint the pane's sheet lists the scopes instead, so
 * this renders nothing there.
 */
export function ScopeRail({
  home,
  scopes,
  activeScopeId,
  renderLink,
  expanded,
  onToggle,
  user,
  onSignOut,
}: ScopeRailProps) {
  const { isMobile } = useSidebar()
  if (isMobile) return null
  return (
    <nav
      aria-label="Scopes"
      data-slot="scope-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      data-collapsible={expanded ? "" : "icon"}
      className={cn(
        "group sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-linear",
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
        <ScopeEntries
          presentation="rail"
          home={home}
          scopes={scopes}
          activeScopeId={activeScopeId}
          renderLink={renderLink}
          expanded={expanded}
        />
      </div>
      <div data-slot="scope-rail-user" className={expanded ? "w-full" : "w-10"}>
        <NavUser user={user} onSignOut={onSignOut} />
      </div>
    </nav>
  )
}
```

- [ ] **Step 8: Run both new tests and the kit suite**

Run: `pnpm --filter @forge-go/dashboard-kit test`
Expected: PASS. If `getByText("Ada Lovelace")` finds two nodes (NavUser renders the name in the trigger and in the closed menu), change the assertion to `getAllByText("Ada Lovelace").length > 0`.

- [ ] **Step 9: Commit**

```bash
git add packages/kit/src/hooks/use-rail-expanded.ts packages/kit/src/components/scope-rail.tsx packages/kit/test/use-rail-expanded.test.ts packages/kit/test/scope-rail.test.tsx
git commit -m "feat(kit): add the scope rail with a click-to-widen edge"
```

---

### Task 4: `AppSidebar` becomes the pane

**Files:**
- Modify: `packages/kit/src/components/app-sidebar.tsx` (whole file)
- Modify: `packages/kit/test/app-sidebar.test.tsx` (whole file)

**Interfaces:**
- Consumes: `ScopeEntries`, `ScopeGlyph`, `ScopeOption` from Task 2; `NavUser`; `useSidebar`.
- Produces:
  ```ts
  export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    scopes: ScopeOption[]
    home?: ScopeOption
    activeScopeId?: string
    heading?: { label: string; namespace?: string; icon?: ReactNode }
    empty?: { message: string; href?: string; label?: string }
    navigationLayout?: "tree" | "collapsible"
    groups: NavGroup[]
    currentPath: string
    search?: string
    renderLink: (node: NavNode, href: string) => ReactElement
    header?: ReactNode
    user: { name: string; email: string; avatar?: string }
    onSignOut?: () => void
  }
  ```
  `back`, `onScopeSelect` and `scopeHome` are gone. On desktop the pane ignores `user`, `onSignOut`, `scopes`, `home` and `activeScopeId`; on mobile it renders the scope rows at the top and `NavUser` in the footer, since the rail is absent there.

- [ ] **Step 1: Replace the test file**

```tsx
// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { SidebarProvider, useSidebar } from "../src/components/sidebar"
import { AppSidebar } from "../src/components/app-sidebar"

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

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        scopes={[{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]}
        home={{ id: "core-contract", label: "System", namespace: "core", href: "/overview" }}
        activeScopeId="auth"
        heading={{ label: "Auth", namespace: "auth" }}
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

  it("names the active scope in a heading that is not a control", () => {
    const { container } = renderSidebar()
    const h = header(container)
    const heading = h.querySelector('[data-slot="scope-heading"]') as HTMLElement
    expect(within(heading).getByText("Auth")).toBeTruthy()
    expect(within(heading).getByText("@auth")).toBeTruthy()
    expect(within(h).queryByRole("button")).toBeNull()
    expect(within(h).queryByRole("link")).toBeNull()
  })

  it("renders no heading and no namespace line when none is given", () => {
    const { container } = renderSidebar({ heading: undefined })
    expect(header(container).querySelector('[data-slot="scope-heading"]')).toBeNull()
    const withoutNamespace = renderSidebar({ heading: { label: "System" } })
    expect(within(header(withoutNamespace.container)).queryByText(/^@/)).toBeNull()
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

  it("keeps scope rows and the user menu out of the desktop pane", () => {
    const { container } = renderSidebar()
    expect(container.querySelector('[data-slot="scope-rows"]')).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-footer"]')).toBeNull()
    expect(screen.queryByText("Dashboard user")).toBeNull()
  })

  it("lists the scopes and the user menu in the mobile sheet", async () => {
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
            scopes={[{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]}
            home={{ id: "core-contract", label: "System", namespace: "core", href: "/overview" }}
            activeScopeId="auth"
            heading={{ label: "Auth", namespace: "auth" }}
            groups={[{ label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] }]}
            currentPath="/@auth/users"
            renderLink={renderLink}
            user={{ name: "Dashboard user", email: "user@example.com" }}
          />
        </SidebarProvider>,
      )
      const rows = (await screen.findByRole("dialog")).querySelector('[data-slot="scope-rows"]') as HTMLElement
      expect(within(rows).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/overview", "/@auth"])
      expect(screen.getAllByText("Dashboard user").length).toBeGreaterThan(0)
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true })
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/app-sidebar.test.tsx`
Expected: FAIL. TypeScript-wise the old props are gone; at runtime the heading test fails first because the switcher renders a button.

- [ ] **Step 3: Rewrite the component**

```tsx
// packages/kit/src/components/app-sidebar.tsx
import * as React from "react"
import type { ReactElement, ReactNode } from "react"

import { NavTree } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavMain } from "@forge-go/dashboard-kit/components/nav-main"
import type { NavGroup, NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeEntries, ScopeGlyph } from "@forge-go/dashboard-kit/components/scope-entries"
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-entries"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  /** Still needed here: the mobile sheet lists them, because the rail is absent there. */
  scopes: ScopeOption[]
  home?: ScopeOption
  activeScopeId?: string
  /** The scope whose pages this pane shows. A label, not a control; the rail is the control. */
  heading?: { label: string; namespace?: string; icon?: ReactNode }
  /** Shown when the scope has no pages to list and there is a reason to say so. */
  empty?: { message: string; href?: string; label?: string }
  navigationLayout?: "tree" | "collapsible"
  groups: NavGroup[]
  currentPath: string
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
  /** Rendered under the heading. The host puts the context switchers and search here. */
  header?: ReactNode
  /** Used by the mobile footer only; the rail carries the user menu on desktop. */
  user: { name: string; email: string; avatar?: string }
  onSignOut?: () => void
}

function ScopeHeading({ label, namespace, icon }: NonNullable<AppSidebarProps["heading"]>) {
  return (
    <div data-slot="scope-heading" className="flex items-center gap-2 px-1 py-1">
      <ScopeGlyph icon={icon} label={label} />
      <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-semibold">{label}</span>
        {namespace ? (
          <span className="truncate text-xs text-muted-foreground">@{namespace}</span>
        ) : null}
      </div>
    </div>
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
 * The pane: the active scope's heading, its context switchers and search
 * (through `header`), and its nav. Scope switching lives in the rail beside
 * it, except on mobile, where this sheet is all the navigation there is and
 * so lists the scopes and the user menu itself.
 */
export function AppSidebar({
  scopes,
  home,
  activeScopeId,
  heading,
  empty,
  navigationLayout = "tree",
  groups,
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
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {isMobile ? (
          <ScopeEntries
            presentation="rows"
            home={home}
            scopes={scopes}
            activeScopeId={activeScopeId}
            renderLink={renderLink}
          />
        ) : null}
        {heading ? <ScopeHeading {...heading} /> : null}
        {header}
      </SidebarHeader>
      <SidebarContent>
        {empty ? <EmptyNotice {...empty} search={search} renderLink={renderLink} /> : null}
        <Navigation
          groups={groups}
          currentPath={currentPath}
          search={search}
          renderLink={renderLink}
        />
      </SidebarContent>
      {isMobile ? (
        <SidebarFooter>
          <NavUser user={user} onSignOut={onSignOut} />
        </SidebarFooter>
      ) : null}
      {navigationLayout === "collapsible" && <SidebarRail />}
    </Sidebar>
  )
}
```

- [ ] **Step 4: Run the kit suite**

Run: `pnpm --filter @forge-go/dashboard-kit test`
Expected: `app-sidebar.test.tsx` PASS (9 tests). `scope-switcher.test.tsx` still passes because the file still exists; it goes in Task 7. If the mobile test cannot find the dialog, check that `SheetContent` renders with `role="dialog"` (base-ui Dialog does) and that `OpenSheet` mounted before `AppSidebar`.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/app-sidebar.tsx packages/kit/test/app-sidebar.test.tsx
git commit -m "feat(kit): make AppSidebar the scope pane with a heading and an empty notice"
```

---

### Task 5: `DashboardShell`

**Files:**
- Create: `packages/kit/src/components/dashboard-shell.tsx`
- Test: `packages/kit/test/dashboard-shell.test.tsx`

**Interfaces:**
- Consumes: `AppSidebar`/`AppSidebarProps` (Task 4), `ScopeRail` (Task 3), `useRailExpanded` (Task 3), `SidebarInset`, `SidebarProvider`, `SiteHeader`.
- Produces:
  ```ts
  export interface DashboardShellProps extends Omit<AppSidebarProps, "children"> {
    title?: string
    scope?: string
    actions?: ReactNode
    children: ReactNode
  }
  export function DashboardShell(props: DashboardShellProps): ReactElement
  ```
  `children` render inside `<div id="dashboard-main" className="@container/main ...">`. Anything that needs the sidebar context but no layout (the host's `SidebarRouteSync`) can be passed as the first child; it renders inside the provider.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/dashboard-shell.test.tsx
import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DashboardShell } from "../src/components/dashboard-shell"

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

function renderShell() {
  return render(
    <DashboardShell
      title="Users"
      scope="Auth"
      scopes={[{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]}
      home={{ id: "core-contract", label: "System", namespace: "core", href: "/overview" }}
      activeScopeId="auth"
      heading={{ label: "Auth", namespace: "auth" }}
      groups={[{ label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] }]}
      currentPath="/@auth/users"
      renderLink={renderLink}
      user={{ name: "Dashboard user", email: "user@example.com" }}
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

  it("arranges rail, pane and content", () => {
    const { container } = renderShell()
    expect(screen.getByRole("navigation", { name: "Scopes" })).toBeTruthy()
    expect(container.querySelector('[data-slot="sidebar-content"]')).toBeTruthy()
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Users")).toBeTruthy()
  })

  it("offsets the pane by the rail's width, and follows the rail when it widens", () => {
    const { container } = renderShell()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width-icon)")
    fireEvent.click(screen.getByRole("button", { name: "Expand scopes" }))
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width)")
    expect(window.localStorage.getItem("forge-dashboard.rail")).toBe("expanded")
  })

  it("runs the pane as an icon-collapsible sidebar", () => {
    const { container } = renderShell()
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-variant")).toBe("sidebar")
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit exec vitest run test/dashboard-shell.test.tsx`
Expected: FAIL, cannot resolve `../src/components/dashboard-shell`.

- [ ] **Step 3: Write the shell**

```tsx
// packages/kit/src/components/dashboard-shell.tsx
import type { CSSProperties, ReactNode } from "react"

import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import type { AppSidebarProps } from "@forge-go/dashboard-kit/components/app-sidebar"
import { ScopeRail } from "@forge-go/dashboard-kit/components/scope-rail"
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
 * The dashboard's chrome: a rail of scopes, the active scope's pane, and the
 * content with its header. The shell owns the arrangement, so the only thing
 * the pane needs to know about the rail is how wide it is, and it learns that
 * through `--sidebar-offset` on the provider.
 */
export function DashboardShell({
  title,
  scope,
  actions,
  children,
  home,
  scopes,
  activeScopeId,
  renderLink,
  user,
  onSignOut,
  ...pane
}: DashboardShellProps) {
  const { expanded, toggle } = useRailExpanded()
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-offset": expanded ? "var(--sidebar-width)" : "var(--sidebar-width-icon)",
        } as CSSProperties
      }
    >
      <ScopeRail
        home={home}
        scopes={scopes}
        activeScopeId={activeScopeId}
        renderLink={renderLink}
        expanded={expanded}
        onToggle={toggle}
        user={user}
        onSignOut={onSignOut}
      />
      <AppSidebar
        variant="sidebar"
        collapsible="icon"
        navigationLayout="collapsible"
        home={home}
        scopes={scopes}
        activeScopeId={activeScopeId}
        renderLink={renderLink}
        user={user}
        onSignOut={onSignOut}
        {...pane}
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

- [ ] **Step 4: Run the kit suite, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-kit test && pnpm --filter @forge-go/dashboard-kit typecheck && pnpm --filter @forge-go/dashboard-kit lint`
Expected: all PASS. If the "Toggle Sidebar" button name differs, read `SidebarTrigger` in `sidebar.tsx` for its `sr-only` text and use that.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/dashboard-shell.tsx packages/kit/test/dashboard-shell.test.tsx
git commit -m "feat(kit): add DashboardShell, which owns rail, pane and content"
```

---

### Task 6: The host renders `DashboardShell`

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (imports at 48-70, `HostShell` at 83-115, `scopeOptions` at 742-749, `selectScope` at 810-824, `sidebar` at 850-882)
- Modify: `packages/host/test/host.test.tsx` (the four tests that open the switcher, plus new cases)
- Modify: `packages/host/test/routed-context.test.tsx` (one new assertion)

**Interfaces:**
- Consumes: `DashboardShell` (Task 5), `ScopeOption` from `scope-entries` (Task 2).
- Produces: `sidebar` now satisfies `Omit<React.ComponentProps<typeof DashboardShell>, "children" | "title" | "scope" | "actions">`, with `home`, `heading`, `empty` and per-scope `href`. `navGroups`, `homePathFor` and every other export are unchanged.

- [ ] **Step 1: Rewrite the switcher tests to the rail**

In `packages/host/test/host.test.tsx`:

Around line 486, replace

```tsx
    fireEvent.click(
      await screen.findByRole("button", { name: /core-contract/ })
    )
    fireEvent.click(
      screen.getByRole("menuitem", { name: /gateway-contract/ })
    )
```

with

```tsx
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Scopes" })).getByRole("link", {
        name: /gateway-contract/,
      }),
    )
```

Around line 936, replace

```tsx
    expect(screen.getByRole("button", { name: "Streaming @streaming" })).toBeTruthy()
```

with

```tsx
    expect(
      within(screen.getByRole("navigation", { name: "Scopes" })).getByRole("link", { name: "Streaming" }),
    ).toBeTruthy()
```

Replace the two tests at lines 1149-1173 with:

```tsx
  it("puts the root in the scope rail inside a scope, and names the scope in the pane heading", async () => {
    const { container } = renderHost(
      [rootPlugin(), authScopePlugin()],
      bothReady(),
      "/@auth/users",
    )
    await screen.findByText("auth users body")

    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(within(rail).getByRole("link", { name: "System" }).getAttribute("href")).toBe("/overview")
    expect(within(rail).getByRole("link", { name: "Auth" }).getAttribute("aria-current")).toBe("page")
    expect(within(rail).getByRole("link", { name: "System" }).getAttribute("aria-current")).toBeNull()

    const h = header(container)
    expect(within(h).queryByRole("link", { name: "Overview" })).toBeNull()
    expect(within(h).getByText("Auth")).toBeTruthy()
    expect(within(h).getByText("@auth")).toBeTruthy()
    // The heading is a label. Every control for changing scope is in the rail.
    expect(within(h).queryByRole("button")).toBeNull()
    expect(h.querySelector('[data-slot="sidebar-group"]')).toBeNull()
  })

  it("returns to the root from the scope rail", async () => {
    renderHost([rootPlugin(), authScopePlugin()], bothReady(), "/@auth/users")
    await screen.findByText("auth users body")
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Scopes" })).getByRole("link", { name: "System" }),
    )
    expect(await screen.findByText("root overview body")).toBeTruthy()
  })

  it("marks home in the rail on the root's own pages, with no namespace in the heading", async () => {
    const { container } = renderHost([rootPlugin(), authScopePlugin()], bothReady(), "/overview")
    await screen.findByText("root overview body")
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(within(rail).getByRole("link", { name: "System" }).getAttribute("aria-current")).toBe("page")
    expect(within(header(container)).getByText("System")).toBeTruthy()
    expect(within(header(container)).queryByText(/^@/)).toBeNull()
  })
```

Leave the tests at lines 1175-1200 ("shows no back row at the root" and "shows no back row inside a scope when no root plugin is mounted") as they are; both still hold.

Add these two cases at the end of the `describe("PluginHost root destination", ...)` block:

```tsx
  it("says a setup scope needs configuring in the pane, with a link to its setup", async () => {
    const { container } = renderHost(
      [rootPlugin(), authScopePlugin()],
      capabilitiesFetch([
        { name: "core-contract", envelopes: ["v1"], configured: true },
        { name: "auth", envelopes: ["v1"], configured: false, message: "Set AUTH_SECRET first." },
      ]),
      "/@auth/users",
    )
    await waitFor(() =>
      expect(within(content(container)).getByText("Set AUTH_SECRET first.")).toBeTruthy(),
    )
    const c = content(container)
    expect(within(c).getByRole("link", { name: "Open setup" }).getAttribute("href")).toBe("/@auth/users")
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()
  })

  it("falls back to a fixed sentence when the setup scope has no message", async () => {
    const { container } = renderHost(
      [rootPlugin(), authScopePlugin()],
      capabilitiesFetch([
        { name: "core-contract", envelopes: ["v1"], configured: true },
        { name: "auth", envelopes: ["v1"], configured: false },
      ]),
      "/@auth/users",
    )
    await waitFor(() =>
      expect(within(content(container)).getByText("This extension needs configuring.")).toBeTruthy(),
    )
  })
```

In `packages/host/test/routed-context.test.tsx`, in the test at line 300 ("renders the picker and no nav items when the URL names no app at all"), add after the last `expect`:

```tsx
    expect(screen.getByText("Pick an app to see its pages.")).toBeTruthy()
```

- [ ] **Step 2: Run the host suite to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-host test`
Expected: FAIL on the rewritten tests (no navigation named Scopes) and on typecheck-style prop errors once vitest transpiles; the untouched tests still pass.

- [ ] **Step 3: Change the imports**

In `packages/host/src/host/PluginHost.tsx`:

Replace
```tsx
import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
```
with
```tsx
import { DashboardShell } from "@forge-go/dashboard-kit/components/dashboard-shell"
```

Replace
```tsx
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-switcher"
import { SiteHeader } from "@forge-go/dashboard-kit/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"
```
with
```tsx
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"
```

- [ ] **Step 4: Replace `HostShell`**

Replace the whole `HostShell` function (its doc comment stays) with:

```tsx
type HostSidebar = Omit<
  React.ComponentProps<typeof DashboardShell>,
  "children" | "title" | "scope" | "actions"
>

function HostShell({
  children,
  sidebar,
  title,
  scope,
  actions,
}: {
  children: ReactNode
  sidebar: HostSidebar
  title?: string
  scope?: string
  actions?: ReactNode
}) {
  return (
    <DashboardShell {...sidebar} title={title} scope={scope} actions={actions}>
      {/* Renders nothing; it only needs the sidebar context the shell provides. */}
      <SidebarRouteSync />
      {children}
    </DashboardShell>
  )
}
```

- [ ] **Step 5: Give each scope its `href`, and build `home`, `heading` and `empty`**

Replace the `scopeOptions` block with:

```tsx
  const scopeOptions: ScopeOption[] = scopes.map((scope) => ({
    id: scope.id,
    label: scope.label,
    namespace: scope.namespace,
    icon: scope.icon,
    badge: scope.state.kind === "ready" ? undefined : scope.state.kind,
    // homePathFor, not a bare first-nav-item mountPath: a scope with a
    // `path`-routed dimension has no route at its unscoped first item, so
    // landing there would be a dead route. homePathFor sends that case to
    // the namespace root, where RoutedPicker resolves it the rest of the way.
    href: homePathFor(scope.plugin),
  }))

  const home: ScopeOption | undefined = root
    ? {
        id: root.id,
        label: root.label,
        namespace: root.namespace,
        icon: root.icon,
        href: homePathFor(root.plugin),
      }
    : undefined
```

Delete the whole `selectScope` function and its comment (the block starting "Switching scope is a navigation, never a state write").

Directly after the `groups` computation, add:

```tsx
  // The pane's heading names the place you are. Namespace only for a scope:
  // the root is the dashboard's home, not "@core".
  const heading = navOwner
    ? {
        label: navOwner.label,
        namespace: activeScope ? activeScope.namespace : undefined,
        icon: navOwner.icon,
      }
    : undefined

  // The two cases that used to leave the pane silently blank. A ready scope
  // with a segment and no nav is a plugin with no nav, which is legal and
  // stays quiet.
  const empty = (() => {
    if (!navOwner) return undefined
    if (navOwner.state.kind === "setup") {
      return {
        message: navOwner.state.message ?? "This extension needs configuring.",
        href: homePathFor(navOwner.plugin),
        label: "Open setup",
      }
    }
    if (navOwner.state.kind === "mismatch") {
      return {
        message: "This extension needs a newer server.",
        href: homePathFor(navOwner.plugin),
        label: "Open setup",
      }
    }
    if (ownerDimension && !ownerSegment) {
      return { message: "Pick an app to see its pages." }
    }
    return undefined
  })()
```

- [ ] **Step 6: Rebuild the `sidebar` object**

Replace the `sidebar` object from `const sidebar = {` through `} satisfies React.ComponentProps<typeof AppSidebar>` with:

```tsx
  const sidebar = {
    home,
    scopes: scopeOptions,
    activeScopeId: activeScope?.id,
    heading,
    empty,
    groups,
    currentPath: pathname,
    search,
    // aria-current only when true. The rail merges its own aria-current onto
    // this element through base-ui's render prop, and an explicit undefined
    // here would win over it and strip the active scope's marker.
    renderLink: (node: NavNode, href: string) => (
      <Link to={href} {...(node.href === pathname ? { "aria-current": "page" as const } : {})}>
        {node.icon}
        <span>{node.label}</span>
      </Link>
    ),
    header: <>
      {panelSource && panelSource.state.kind === "ready" && (
        <div className="group-data-[collapsible=icon]:hidden">
          <PluginErrorBoundary key={panelSource.id} plugin={panelSource.id}>
            <PluginProvider client={clients.get(panelSource.plugin.extension)!}>
              <ContextSwitchers dimensions={panelSource.plugin.context} plugin={panelSource.plugin} />
            </PluginProvider>
          </PluginErrorBoundary>
        </div>
      )}
      <NavigationSearch groups={groups} search={search} scopes={[
        ...(root ? [{ label: root.label, href: homePathFor(root.plugin) }] : []),
        ...scopes.map(scope => ({ label: scope.label, href: homePathFor(scope.plugin) })),
      ]} />
    </>,
    user:
      session.state.status === "signedIn"
        ? {
            name:
              session.state.principal.displayName ??
              session.state.principal.subject ??
              "Signed in",
            email: session.state.principal.email ?? "",
          }
        : { name: "Dashboard user", email: "" },
    onSignOut,
  } satisfies HostSidebar
```

`navigate` is still used by other code in the component (`SignedInRedirect` and the routed picker paths); if `tsc` reports it unused after deleting `selectScope`, remove the `useNavigate()` line and its import too.

- [ ] **Step 7: Run the host suite, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-host test && pnpm --filter @forge-go/dashboard-host typecheck && pnpm --filter @forge-go/dashboard-host lint`
Expected: all PASS, including `host-playground.test.tsx` untouched. Two likely failures and their fixes:
- A test that queried `getByRole("link", { name: "Overview" })` without scoping now finds one in the pane only; the rail has no "Overview". If a test finds two links with the same name, scope it with `within(content(container))`.
- `routed-context.test.tsx:300` expecting no "Overview" link still holds because the rail lists scopes by label ("Auth"), not pages.

- [ ] **Step 8: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/test/host.test.tsx packages/host/test/routed-context.test.tsx
git commit -m "feat(host): render the scope rail shell and say why a pane is empty"
```

---

### Task 7: Delete `ScopeSwitcher`

**Files:**
- Delete: `packages/kit/src/components/scope-switcher.tsx`
- Delete: `packages/kit/test/scope-switcher.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. After Task 6 no file imports the switcher.

- [ ] **Step 1: Prove nothing imports it**

Run: `grep -rn "scope-switcher\|ScopeSwitcher" packages apps --include='*.ts' --include='*.tsx' --include='*.md' -l | grep -v node_modules`
Expected: only the two files being deleted, and possibly docs under `docs/superpowers`. Docs are history and stay.

- [ ] **Step 2: Delete and run the workspace tests**

```bash
git rm packages/kit/src/components/scope-switcher.tsx packages/kit/test/scope-switcher.test.tsx
pnpm test
pnpm typecheck
```
Expected: PASS across kit, host, shell and playground.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(kit): remove ScopeSwitcher, replaced by the scope rail"
```

---

### Task 8: Warn when capabilities hides a plugin

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx` (after the `resolvedSubs` block, around line 640)
- Test: `packages/host/test/host.test.tsx`

**Interfaces:**
- Consumes: `state` (`CapabilitiesState`), `plugins`, `subPlugins`.
- Produces: a `console.warn` line of the exact form `[forge-dashboard] plugin "<extension>" is hidden: capabilities lists no contributor named "<extension>". Contributors: a, b, c`, once per extension name per capabilities document, only when `process.env.NODE_ENV !== "production"`.

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

  it("warns once, naming the plugin and the contributors that did arrive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { rerender } = renderHost(
        [demoPlugin(), ghostPlugin()],
        capabilitiesFetch([{ name: "core-contract", envelopes: ["v1"], configured: true }]),
      )
      await screen.findByText("overview page body")
      const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("[forge-dashboard]"))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toBe(
        '[forge-dashboard] plugin "ghost" is hidden: capabilities lists no contributor named "ghost". Contributors: core-contract',
      )
      // A re-render is not a new capabilities document.
      rerender(
        <MemoryRouter initialEntries={["/@core/overview"]}>
          <ForgeDashboardProvider config={config}>
            <SessionProvider fetchImpl={capabilitiesFetch([{ name: "core-contract", envelopes: ["v1"], configured: true }])}>
              <PluginHost plugins={[demoPlugin(), ghostPlugin()]} fetchImpl={capabilitiesFetch([{ name: "core-contract", envelopes: ["v1"], configured: true }])} />
            </SessionProvider>
          </ForgeDashboardProvider>
        </MemoryRouter>,
      )
      expect(warn.mock.calls.filter((call) => String(call[0]).includes("[forge-dashboard]"))).toHaveLength(1)
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
      expect(warn.mock.calls.filter((call) => String(call[0]).includes("[forge-dashboard]"))).toHaveLength(0)
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
      expect(warn.mock.calls.filter((call) => String(call[0]).includes("[forge-dashboard]"))).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })
})
```

The `rerender` in the first test re-creates the fetch, which makes the host fetch capabilities again and produce a new document. If the second assertion fails with two lines because of that, keep the `rerender` but pass the same `fetchImpl` instance it used the first time (hoist it into a `const fetchImpl = capabilitiesFetch(...)` above `renderHost`), so the effect's dependencies do not change. The point being pinned is "one line per name per document", and the test must construct exactly one document.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-host exec vitest run test/host.test.tsx -t "hidden-plugin"`
Expected: the first test FAILS with 0 lines.

- [ ] **Step 3: Add the warning**

In `PluginHost.tsx`, after the `resolvedSubs` block, add:

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
    if (process.env.NODE_ENV === "production" || state.status !== "ready") return
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

`Capabilities`, `useEffect` and `useRef` are already imported at the top of the file.

- [ ] **Step 4: Run the host suite**

Run: `pnpm --filter @forge-go/dashboard-host test`
Expected: PASS. The existing "a hidden sub-plugin is not an error" test still passes; a warning is not an error.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host/PluginHost.tsx packages/host/test/host.test.tsx
git commit -m "feat(host): warn in development when capabilities hides a plugin"
```

---

### Task 9: Whole-workspace checks and the browser pass

**Files:**
- No source changes expected. Fixes found here go back into the task that owns the file, with its test.

**Interfaces:**
- Consumes: everything above; `.claude/launch.json` configurations `fixture-server` (port 8099) and `dashboard-shell` (port 5173).
- Produces: screenshots for the final report.

- [ ] **Step 1: Run everything**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: exit 0 for every package. `apps/playground` and `apps/shell` compile against the new kit and host with no edits.

- [ ] **Step 2: Desktop, auth scope, rail collapsed**

Start both preview servers from `.claude/launch.json` (`fixture-server`, then `dashboard-shell`). Open `http://localhost:5173/@auth`; it redirects to `/@auth/platform/users`. Check:
- a navigation landmark named "Scopes" on the far left with five entries (System, Authsome, Warden, Vault, Relay) as icons, Authsome active;
- the pane beside it with the heading "Authsome / @auth", the App and Environment switchers, search, then the eight groups;
- no scope dropdown anywhere;
- the user avatar at the foot of the rail, opening a menu on click.
Screenshot.

- [ ] **Step 3: Rail expanded**

Click the rail's right edge. The rail widens to 256px with labels, the pane slides right, and a reload keeps it expanded. Screenshot. Click the edge again to collapse.

- [ ] **Step 4: Pane icon-collapsed**

Click the sidebar trigger in the header (or press ⌘B). The pane shrinks to an icon column beside the rail; click "Federation" in the pane and confirm the flyout lists Social Login and OAuth2 Provider. Screenshot. Restore the pane.

- [ ] **Step 5: Empty state at the bare namespace root**

Stop the fixture server and restart it so `apps.context` reports no current app: run `FIXTURE_PORT=8099 FIXTURE_AUTH_NO_CURRENT_APP=1 node packages/fixture-server/server.mjs` if that flag exists (`grep -n "NO_CURRENT_APP\|currentAppId = " packages/fixture-server/server.mjs`); if there is no such flag, edit `currentAppId`'s initialiser and `platformAppId()` fallback locally without committing, so `apps.context` returns no `currentApp`. Open `http://localhost:5173/@auth`. The content shows the app picker and the pane shows "Pick an app to see its pages." under the switchers. Screenshot. Revert any local edit.

- [ ] **Step 6: Mobile**

Resize the preview to the mobile preset and reload `/@auth/platform/users`. There is no rail. Open the sheet with the header's trigger: scope rows (System, Authsome, Warden, Vault, Relay) at the top, then the heading and nav, and the user menu at the foot. Tap "Warden" and confirm the sheet closes and the URL is under `/@warden`. Screenshot. Reset the preset to desktop.

- [ ] **Step 7: Playground**

Open the playground (`pnpm --filter @forge-go/dashboard-playground dev`, or its launch config if one exists) at `/`. The rail shows the single home entry, active; the pane heading shows the root's label with no `@` line. No console errors.

- [ ] **Step 8: Report**

Attach the screenshots from steps 2 to 6 and the output of step 1 to the final message. No commit in this task unless a fix was needed, in which case it was committed under the owning task's message.
