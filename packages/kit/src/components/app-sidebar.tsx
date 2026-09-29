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
