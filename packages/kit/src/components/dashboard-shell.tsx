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
