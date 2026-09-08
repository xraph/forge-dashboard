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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@forge-go/dashboard-kit/components/sidebar"
import { ChevronLeftIcon } from "lucide-react"

export interface AppSidebarProps
  extends React.ComponentProps<typeof Sidebar> {
  /**
   * The way out of the active scope, rendered above the switcher.
   *
   * Present only when there is somewhere to go back to, which means only
   * inside a scope. The root plugin's own nav is not this: at the root it is
   * the sidebar's ordinary nav, in `groups`, because that is where you are
   * rather than one context among several. This is the single row that gets
   * you there from inside an extension.
   */
  back?: NavNode
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
  onSignOut?: () => void
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
  back,
  scopes,
  activeScopeId,
  onScopeSelect,
  groups,
  currentPath,
  search,
  renderLink,
  header,
  user,
  onSignOut,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {back ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={renderLink(back, `${back.href}${search ?? ""}`)}
              >
                <ChevronLeftIcon aria-hidden="true" />
                <span>{back.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
        {scopes.length > 0 ? (
          <ScopeSwitcher
            scopes={scopes}
            activeId={activeScopeId}
            onSelect={onScopeSelect}
          />
        ) : null}
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
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
    </Sidebar>
  )
}
