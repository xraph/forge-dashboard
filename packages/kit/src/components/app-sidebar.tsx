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
