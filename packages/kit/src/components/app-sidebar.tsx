import * as React from "react"
import type { ReactElement, ReactNode } from "react"

import { NavTree } from "@forge-go/dashboard-kit/components/nav-tree"
import type { NavGroup, NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeSwitcher } from "@forge-go/dashboard-kit/components/scope-switcher"
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@forge-go/dashboard-kit/components/sidebar"

export interface AppSidebarProps
  extends React.ComponentProps<typeof Sidebar> {
  scopes: ScopeOption[]
  activeScopeId?: string
  onScopeSelect: (id: string) => void
  groups: NavGroup[]
  currentPath: string
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
  /**
   * Rendered under the switcher. Reserved for the per-scope context selectors
   * (organisation, app, environment), which are a later wave. Nothing passes
   * it today.
   */
  header?: ReactNode
  user: { name: string; email: string; avatar?: string }
}

/**
 * The dashboard sidebar.
 *
 * Every item it draws arrives as a prop. The previous version held a `data`
 * object lifted from the shadcn dashboard-01 template, so the sidebar showed
 * twelve entries that belonged to a demo and pointed at "#", while real
 * contributed navigation rendered as a row of pills above the content because
 * there was no way in here.
 */
export function AppSidebar({
  scopes,
  activeScopeId,
  onScopeSelect,
  groups,
  currentPath,
  search,
  renderLink,
  header,
  user,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <ScopeSwitcher
          scopes={scopes}
          activeId={activeScopeId}
          onSelect={onScopeSelect}
        />
        {header}
      </SidebarHeader>
      <SidebarContent>
        <NavTree
          groups={groups}
          currentPath={currentPath}
          search={search}
          renderLink={renderLink}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
