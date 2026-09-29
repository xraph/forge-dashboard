import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { NavUser } from "@forge-go/dashboard-kit/components/nav-user"
import { ScopeEntries } from "@forge-go/dashboard-kit/components/scope-entries"
import type {
  RenderScopeLink,
  ScopeOption,
} from "@forge-go/dashboard-kit/components/scope-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"

export interface ScopeRailProps {
  home?: ScopeOption
  scopes: ScopeOption[]
  activeScopeId?: string
  renderLink: RenderScopeLink
  expanded: boolean
  onToggle: () => void
  user: { name: string; email: string; avatar?: string }
  onSignOut?: () => void
}

/**
 * The rail's right border, made clickable. A 16px strip straddling the
 * border with a 2px line down its middle that shows on hover and focus. It is
 * a real button in the tab order because it is the rail's only affordance;
 * the resize cursor says which way the column will move.
 */
function RailEdgeToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? "Collapse scopes" : "Expand scopes"
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
 * The icon column of scopes. A plain `nav`, not a second shadcn `Sidebar`:
 * that component is `position: fixed` and two of them overlap. It carries the
 * same `group` class and `data-collapsible` attribute the sidebar sets when it
 * is an icon column, so `NavUser` at the foot collapses to its avatar with the
 * styles it already has.
 *
 * Below the mobile breakpoint the pane's sheet lists the scopes instead, so
 * this renders nothing there.
 */
export function ScopeRail({
  home,
  scopes,
  activeScopeId,
  renderLink,
  expanded,
  onToggle,
  user,
  onSignOut,
}: ScopeRailProps) {
  const { isMobile } = useSidebar()
  if (isMobile) return null
  return (
    <nav
      aria-label="Scopes"
      data-slot="scope-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      data-collapsible={expanded ? "" : "icon"}
      className={cn(
        "group sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-linear",
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
        <ScopeEntries
          presentation="rail"
          home={home}
          scopes={scopes}
          activeScopeId={activeScopeId}
          renderLink={renderLink}
          expanded={expanded}
        />
      </div>
      <div data-slot="scope-rail-user" className={expanded ? "w-full" : "w-10"}>
        <NavUser user={user} onSignOut={onSignOut} />
      </div>
    </nav>
  )
}
