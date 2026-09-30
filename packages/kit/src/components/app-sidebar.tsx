import * as React from "react"
import { Fragment } from "react"
import type { ReactElement, ReactNode } from "react"

import { NavTree } from "@forge-go/dashboard-kit/components/nav-tree"
import { NavMain } from "@forge-go/dashboard-kit/components/nav-main"
import type { NavArea, NavGroup, NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import { SectionLabel } from "@forge-go/dashboard-kit/components/section-label"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  /** The rail's entries. The sidebar shows the active one's pages. */
  areas?: NavArea[]
  activeAreaId?: string
  /** Shown when there are no areas. */
  groups: NavGroup[]
  /** Shown when the scope has nothing to list and there is a reason to say so. */
  empty?: { message: string; href?: string; label?: string }
  currentPath: string
  search?: string
  renderLink: (node: NavNode, href: string) => ReactElement
  navigationLayout?: "tree" | "collapsible"
  /** Mobile only: what the rail holds on desktop, above the pages. */
  mobileHeader?: ReactNode
  /** Mobile only: the account menu. */
  mobileFooter?: ReactNode
}

/**
 * Every area as one list of groups, for the mobile sheet, where there is no
 * rail to pick an area with. A labelled group reads "Billing · Catalog"; an
 * area's unlabelled first group takes the area's name.
 */
export function stackAreas(areas: NavArea[]): NavGroup[] {
  return areas.flatMap((area) =>
    area.groups.map((group, index) => ({
      ...group,
      label: group.label
        ? `${area.label} · ${group.label}`
        : index === 0
          ? area.label
          : undefined,
    })),
  )
}

function nodesOf(group: NavGroup): NavNode[] {
  return group.items.flatMap((item) => [item, ...(item.children ?? [])])
}

/**
 * The one href that owns the current path across every section, by the rule
 * NavMain uses within a section: an exact match or a path prefix, longest wins.
 */
function activeHref(groups: NavGroup[], currentPath: string): string | undefined {
  return groups
    .flatMap(nodesOf)
    .filter(
      (node) =>
        node.href === currentPath ||
        (node.href !== "/" && currentPath.startsWith(`${node.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
}

function holdsHref(group: NavGroup, href: string | undefined): boolean {
  return href !== undefined && nodesOf(group).some((node) => node.href === href)
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
 * The secondary sidebar: the pages of the rail entry you are in, one section
 * per group. A section's label stays on screen as vertical text when the
 * sidebar collapses to icons. NavMain draws each section's rows; it is handed
 * one unlabelled group at a time so the label here is the only one.
 */
export function AppSidebar({
  areas,
  activeAreaId,
  groups,
  empty,
  currentPath,
  search,
  renderLink,
  navigationLayout = "tree",
  mobileHeader,
  mobileFooter,
  ...props
}: AppSidebarProps) {
  const { isMobile } = useSidebar()
  const Navigation = navigationLayout === "collapsible" ? NavMain : NavTree
  const active =
    areas && areas.length > 0
      ? (areas.find((area) => area.id === activeAreaId) ?? areas[0])
      : undefined
  const shown = areas && areas.length > 0
    ? isMobile
      ? stackAreas(areas)
      : active!.groups
    : groups

  const winner = activeHref(shown, currentPath)

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {isMobile ? mobileHeader : null}
        {!isMobile && active ? (
          <div
            data-slot="area-title"
            className="truncate px-2 py-1 font-semibold group-data-[collapsible=icon]:hidden"
          >
            {active.label}
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        {empty ? <EmptyNotice {...empty} search={search} renderLink={renderLink} /> : null}
        {shown.map((group, index) => (
          <Fragment key={`${group.label ?? ""}:${index}`}>
            {group.label ? (
              <div className="px-2 pt-2">
                <SectionLabel>{group.label}</SectionLabel>
              </div>
            ) : null}
            <Navigation
              groups={[{ ...group, label: undefined }]}
              currentPath={holdsHref(group, winner) ? currentPath : ""}
              search={search}
              renderLink={renderLink}
            />
          </Fragment>
        ))}
      </SidebarContent>
      {isMobile && mobileFooter ? <SidebarFooter>{mobileFooter}</SidebarFooter> : null}
      {navigationLayout === "collapsible" && <SidebarRail />}
    </Sidebar>
  )
}
