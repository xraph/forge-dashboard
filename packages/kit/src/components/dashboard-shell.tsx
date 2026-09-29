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
