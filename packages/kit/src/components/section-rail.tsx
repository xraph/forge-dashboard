import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { RailEntries } from "@forge-go/dashboard-kit/components/rail-entries"
import type { RailItem, RenderRailLink } from "@forge-go/dashboard-kit/components/rail-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"

export interface SectionRailProps {
  items: RailItem[]
  activeId?: string
  renderLink: RenderRailLink
  search?: string
  expanded: boolean
  onToggle: () => void
}

/**
 * The rail's right border, made clickable. A 16px strip straddling the
 * border with a 2px line down its middle that shows on hover and focus. It is
 * a real button in the tab order because it is the rail's only affordance;
 * the resize cursor says which way the column will move.
 */
function RailEdgeToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? "Collapse sections" : "Expand sections"
  return (
    <button
      type="button"
      aria-expanded={expanded}
      title={name}
      onClick={onToggle}
      className={cn(
        "absolute inset-y-0 -right-2 z-20 flex w-4 outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring",
        expanded ? "cursor-w-resize" : "cursor-e-resize",
      )}
    >
      <span className="sr-only">{name}</span>
    </button>
  )
}

/**
 * The icon column of one scope's sections. A plain `nav`, not a second shadcn
 * `Sidebar`: that component is `position: fixed` and two of them overlap. The
 * pane beside it learns the rail's width through `--sidebar-offset`, which
 * `DashboardShell` sets.
 *
 * Below the mobile breakpoint the pane's sheet stacks every section instead,
 * so this renders nothing there.
 */
export function SectionRail({
  items,
  activeId,
  renderLink,
  search,
  expanded,
  onToggle,
}: SectionRailProps) {
  const { isMobile } = useSidebar()
  if (isMobile) return null
  return (
    <nav
      aria-label="Sections"
      data-slot="section-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      className={cn(
        "sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-linear",
        expanded ? "w-(--sidebar-width) items-stretch px-2" : "w-(--sidebar-width-icon) items-center",
      )}
    >
      <RailEdgeToggle expanded={expanded} onToggle={onToggle} />
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          expanded ? "items-stretch" : "items-center",
        )}
      >
        <RailEntries
          items={items}
          activeId={activeId}
          renderLink={renderLink}
          search={search}
          expanded={expanded}
        />
      </div>
    </nav>
  )
}
