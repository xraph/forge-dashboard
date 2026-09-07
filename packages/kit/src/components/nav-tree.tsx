import type { ReactElement, ReactNode } from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@forge-go/dashboard-kit/components/sidebar"

/**
 * One rendered nav entry.
 *
 * Deliberately not `PluginNavItem`. A scope's nav is a merge of the plugin's
 * own entries and, later, entries contributed by its sub-plugins. A kit that
 * only spoke the plugin contract would force the host to fabricate plugin
 * objects to express that merge, and would need changing the day sub-plugins
 * arrive. `href` is already absolute: the host applies the namespace prefix.
 */
export interface NavNode {
  label: string
  href: string
  icon?: ReactNode
  children?: NavNode[]
}

export interface NavGroup {
  label?: string
  /** Marks a group whose items came from a sub-plugin rather than the scope itself. */
  contributed?: boolean
  items: NavNode[]
}

export interface NavTreeProps {
  groups: NavGroup[]
  /** Pathname only, without the search string. */
  currentPath: string
  /** Search string including the leading "?", or empty. Appended to every href. */
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
}

/**
 * Renders contributed navigation.
 *
 * This component never imports a router. `renderLink` is how the host supplies
 * one, which is what keeps `@forge-go/dashboard-kit` installable by consumers
 * who do not use react-router. The base-ui `render` prop on the sidebar
 * primitives takes the element it returns.
 */
export function NavTree({
  groups,
  currentPath,
  search = "",
  renderLink,
}: NavTreeProps) {
  const href = (node: NavNode) => `${node.href}${search}`

  return (
    <>
      {groups.map((group, index) => (
        <SidebarGroup key={group.label ?? `group-${index}`}>
          {group.label ? (
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={item.href === currentPath}
                    render={renderLink(item, href(item))}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.children?.length ? (
                    <SidebarMenuSub>
                      {item.children.map((child) => (
                        <SidebarMenuSubItem key={child.href}>
                          <SidebarMenuSubButton
                            isActive={child.href === currentPath}
                            render={renderLink(child, href(child))}
                          >
                            <span>{child.label}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
