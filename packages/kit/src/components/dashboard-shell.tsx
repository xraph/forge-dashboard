import type { CSSProperties, ReactNode } from "react"

import { SidebarBrand } from "@forge-go/dashboard-kit/components/sidebar-brand"

import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import type { AppSidebarProps } from "@forge-go/dashboard-kit/components/app-sidebar"
import { ContentHeader } from "@forge-go/dashboard-kit/components/content-header"
import { NavRail } from "@forge-go/dashboard-kit/components/nav-rail"
import type { RailGroup } from "@forge-go/dashboard-kit/components/nav-rail"
import type { NavArea } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeGridSwitcher } from "@forge-go/dashboard-kit/components/scope-grid-switcher"
import type {
  ScopeOption,
  ScopeSwitcherProps,
} from "@forge-go/dashboard-kit/components/scope-switcher"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"
import { useIsMobile } from "@forge-go/dashboard-kit/hooks/use-mobile"
import { useRailExpanded } from "@forge-go/dashboard-kit/hooks/use-rail-expanded"

export interface DashboardShellProps extends Omit<
  AppSidebarProps,
  | "children"
  | "variant"
  | "collapsible"
  | "navigationLayout"
  | "mobileHeader"
  | "mobileFooter"
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
 * The scope's own pages as rail groups. A node that still carries `children`
 * becomes one entry per child, so no page is reachable only through another.
 */
export function railGroupsFor(area: NavArea | undefined): RailGroup[] {
  if (!area) return []
  return area.groups.map((group) => ({
    label: group.label,
    items: group.items.flatMap((node) =>
      node.children?.length
        ? node.children.map((child) => ({
            id: child.href,
            label: child.label,
            href: child.href,
            icon: child.icon ?? node.icon,
          }))
        : [
            {
              id: node.href,
              label: node.label,
              href: node.href,
              icon: node.icon,
            },
          ]
    ),
  }))
}

/** Every page an area lists, counting a folded cluster's children. */
export function pageCount(area: NavArea): number {
  return area.groups.reduce(
    (sum, group) =>
      sum +
      group.items.reduce((n, node) => n + (node.children?.length || 1), 0),
    0
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
  currentPath: string
): string | undefined {
  if (
    activeArea?.kind === "plugin" &&
    plugins.some((p) => p.id === activeArea.id)
  )
    return activeArea.id
  let best: { id: string; length: number } | undefined
  for (const group of groups) {
    for (const item of group.items) {
      for (const href of new Set([item.id, item.href])) {
        const matches =
          href === currentPath ||
          (href !== "/" && currentPath.startsWith(`${href}/`))
        if (matches && (!best || href.length > best.length))
          best = { id: item.id, length: href.length }
      }
    }
  }
  return best?.id
}

function MobileBrand() {
  const { toggleSidebar } = useSidebar()
  return (
    <SidebarBrand onToggle={toggleSidebar} toggleLabel="Close navigation" />
  )
}

/**
 * The dashboard's chrome, after TwinOS Studio: a rail with the scope switcher,
 * the context control, search, the scope's own pages and its plugins, and the
 * account menu; a secondary sidebar only when you are in a plugin with more
 * than one page; then the page, in a rounded card headed by a breadcrumb. On
 * mobile the rail's contents move into the sheet, so each piece of chrome
 * renders once whatever the viewport.
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
      <ScopeGridSwitcher
        scopes={scopes}
        activeId={activeScopeId}
        onSelect={onScopeSelect}
        home={scopeHome}
        menuSide="right"
        compact
      />
    ) : null
  const account = <NavUser user={user} onSignOut={onSignOut} compact />
  const isMobile = useIsMobile()
  const areas = pane.areas ?? []
  const scopeArea = areas.find((area) => area.kind === "scope")
  const pluginAreas = areas.filter((area) => area.kind === "plugin")
  const activeArea = areas.find((area) => area.id === pane.activeAreaId)
  // A scope with no areas lists its plain groups as its own pages.
  const groups: RailGroup[] = scopeArea
    ? railGroupsFor(scopeArea)
    : areas.length === 0
      ? railGroupsFor({
          id: "",
          label: "",
          href: "",
          kind: "scope",
          groups: pane.groups,
        })
      : []
  const plugins = pluginAreas.map((area) => ({
    id: area.id,
    label: area.label,
    href: area.href,
    icon: area.icon,
  }))
  const activeId = railActiveId(
    groups,
    pluginAreas,
    activeArea,
    pane.currentPath
  )
  const secondary =
    activeArea?.kind === "plugin" && pageCount(activeArea) > 1
      ? activeArea
      : undefined
  const crumbs = [
    secondary?.label ??
      (activeArea?.kind === "plugin" ? activeArea.label : scope),
    title,
  ]
    .filter((crumb): crumb is string => Boolean(crumb))
    .filter((crumb, i, all) => i === 0 || crumb.trim() !== all[i - 1].trim())

  return (
    <SidebarProvider
      className="bg-sidebar"
      style={
        {
          "--sidebar-width": "14.5rem",
          "--sidebar-offset": expanded
            ? "var(--sidebar-width)"
            : "var(--sidebar-width-icon)",
        } as CSSProperties
      }
    >
      <NavRail
        switcher={switcher}
        context={context}
        searchControl={searchControl}
        account={account}
        groups={groups}
        plugins={plugins}
        activeId={activeId}
        renderLink={pane.renderLink}
        search={pane.search}
        expanded={expanded}
        onToggle={toggle}
      />
      {isMobile || secondary ? (
        <AppSidebar
          {...pane}
          activeAreaId={secondary?.id ?? pane.activeAreaId}
          mobileHeader={
            <>
              <MobileBrand />
              <div className="flex flex-col gap-1 px-3 pt-[18px] pb-[9px] [&_button[data-slot=button]]:mx-0 [&_button[data-slot=button]]:h-8 [&_button[data-slot=button]]:w-full [&_button[data-slot=button]]:border-transparent [&_button[data-slot=button]]:bg-transparent [&_button[data-slot=button]]:px-2 [&_button[data-slot=button]]:shadow-none [&_kbd]:rounded-[3px] [&_kbd]:border [&_kbd]:border-sidebar-border [&_kbd]:px-1">
                {context}
                {searchControl}
              </div>
            </>
          }
          mobileFooter={
            <>
              {switcher}
              {account}
            </>
          }
          variant="sidebar"
          collapsible="icon"
          navigationLayout="collapsible"
        />
      ) : null}
      <SidebarInset>
        <ContentHeader
          crumbs={crumbs}
          showTrigger={Boolean(isMobile || secondary)}
          actions={actions}
        />
        {/*
          `@container/main` is load-bearing, not decoration. dashboard-01's
          SectionCards sizes itself with container queries scoped to a container
          named `main` (@xl/main:grid-cols-2, @5xl/main:grid-cols-4). Without
          this declaration those variants never match and the cards stack in a
          single column at every width.
        */}
        <div
          id="dashboard-main"
          className="@container/main flex min-w-0 flex-1 flex-col gap-4 p-4"
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
