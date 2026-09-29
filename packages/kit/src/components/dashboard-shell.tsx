import type { CSSProperties, ReactNode } from "react"

import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import type { AppSidebarProps } from "@forge-go/dashboard-kit/components/app-sidebar"
import { SectionRail } from "@forge-go/dashboard-kit/components/section-rail"
import { SidebarInset, SidebarProvider } from "@forge-go/dashboard-kit/components/sidebar"
import { SiteHeader } from "@forge-go/dashboard-kit/components/site-header"
import { useRailExpanded } from "@forge-go/dashboard-kit/hooks/use-rail-expanded"

export interface DashboardShellProps extends Omit<
  AppSidebarProps,
  "children" | "variant" | "collapsible" | "navigationLayout"
> {
  title?: string
  scope?: string
  actions?: ReactNode
  children: ReactNode
}

/**
 * The dashboard's chrome: the active scope's section rail when it declares
 * sections, the pane, and the content with its header. The only thing the
 * pane needs to know about the rail is how wide it is, and it learns that
 * through `--sidebar-offset` on the provider: 0 when there is no rail.
 */
export function DashboardShell({
  title,
  scope,
  actions,
  children,
  sections,
  activeSectionId,
  ...pane
}: DashboardShellProps) {
  const { expanded, toggle } = useRailExpanded()
  const hasRail = !!sections && sections.length > 0
  const offset = !hasRail
    ? "0px"
    : expanded
      ? "var(--sidebar-width)"
      : "var(--sidebar-width-icon)"
  return (
    <SidebarProvider style={{ "--sidebar-offset": offset } as CSSProperties}>
      {hasRail ? (
        <SectionRail
          items={sections.map((section) => ({
            id: section.id,
            label: section.label,
            href: section.href,
            icon: section.icon,
          }))}
          activeId={activeSectionId ?? sections[0].id}
          renderLink={pane.renderLink}
          search={pane.search}
          expanded={expanded}
          onToggle={toggle}
        />
      ) : null}
      <AppSidebar
        {...pane}
        sections={sections}
        activeSectionId={activeSectionId}
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
