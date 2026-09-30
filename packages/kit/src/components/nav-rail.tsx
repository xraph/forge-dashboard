import { Fragment } from "react"
import type { ReactNode } from "react"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { RailEntries } from "@forge-go/dashboard-kit/components/rail-entries"
import type { RailItem, RenderRailLink } from "@forge-go/dashboard-kit/components/rail-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

/** A labelled run of the scope's own pages. */
export interface RailGroup {
  label?: string
  items: RailItem[]
}

export interface NavRailProps {
  /** The scope switcher. */
  switcher?: ReactNode
  /** The scope's context control (App / Environment). Absent for a scope with none. */
  context?: ReactNode
  /** The search trigger. */
  searchControl?: ReactNode
  /** The account menu, pinned to the foot. */
  account?: ReactNode
  /** The scope's own pages, group by group. */
  groups: RailGroup[]
  /** One entry per sub-plugin, under the Plugins heading. */
  plugins: RailItem[]
  activeId?: string
  renderLink: RenderRailLink
  /** Appended to every entry's href, so the scope's query dimensions survive. */
  search?: string
  expanded: boolean
  onToggle: () => void
}

/**
 * A cell for chrome that is a component, not a link: the switcher, the context
 * control, search, the account menu. It gives the component the hover tooltip
 * the entries have, hidden when the rail is wide and the component names
 * itself. The tooltip hangs on a wrapper because each of these is already a
 * menu or popover trigger, and two triggers on one element fight.
 */
function RailSlot({
  children,
  className,
  expanded,
  title,
}: {
  children: ReactNode
  /** Extra classes for the cell, used to fit a child the rail does not own. */
  className?: string
  expanded: boolean
  title: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            data-slot="rail-slot"
            className={cn(
              expanded ? "flex w-full items-center" : "flex w-8 items-center justify-center",
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent hidden={expanded} side="right">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Fits the host's search trigger to the rail. That trigger is an outline
 * Button built for the old sidebar header: indented, 36px tall, white with a
 * shadow. Here it should read like the context control above it: full width,
 * 32px, sidebar-toned, no shadow. Narrow, it keeps its own 32px square.
 */
const SEARCH_SLOT =
  "[&>button]:mx-0 [&>button]:border-sidebar-border [&>button]:bg-transparent [&>button]:shadow-none [&>button]:text-sidebar-foreground/70 [&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-accent-foreground"

/** Wide rail only: the trigger fills the row at the context control's height. */
const SEARCH_SLOT_WIDE = "[&>button]:h-8 [&>button]:w-full [&>button]:px-2"

/**
 * The rail's right border, made clickable: a 16px strip straddling it with a
 * 2px line that shows on hover and focus. A real button in the tab order,
 * because it is the rail's only way to widen.
 */
function RailEdgeToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? "Collapse navigation" : "Expand navigation"
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
 * The far-left rail, after TwinOS Studio's AreaRail. A plain `nav`, not a
 * second shadcn `Sidebar`, because that component is `position: fixed` and two
 * would overlap; the secondary sidebar learns this rail's width through
 * `--sidebar-offset`.
 *
 * It carries the `group` class and the `data-collapsible` attribute the
 * sidebar sets in icon mode, so the switcher and account menu, which are
 * SidebarMenuButtons, shrink to their glyphs with the styles they already
 * have.
 *
 * Below the mobile breakpoint the sheet carries all of this, so the rail
 * renders nothing.
 */
export function NavRail({
  switcher,
  context,
  searchControl,
  account,
  groups,
  plugins,
  activeId,
  renderLink,
  search,
  expanded,
  onToggle,
}: NavRailProps) {
  const { isMobile } = useSidebar()
  if (isMobile) return null

  const column = expanded ? "items-stretch" : "items-center"

  return (
    <nav
      aria-label="Scope navigation"
      data-slot="nav-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      data-collapsible={expanded ? "" : "icon"}
      className={cn(
        "group sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground transition-[width] duration-200 ease-linear",
        expanded ? "w-(--sidebar-width) px-2" : "w-(--sidebar-width-icon)",
        column,
      )}
    >
      <RailEdgeToggle expanded={expanded} onToggle={onToggle} />
      {switcher ? (
        <RailSlot expanded={expanded} title="Switch scope">
          {switcher}
        </RailSlot>
      ) : null}
      {context ? (
        <RailSlot expanded={expanded} title="App and environment">
          {context}
        </RailSlot>
      ) : null}
      {searchControl ? (
        <RailSlot expanded={expanded} title="Search pages" className={cn(SEARCH_SLOT, expanded && SEARCH_SLOT_WIDE)}>
          {searchControl}
        </RailSlot>
      ) : null}
      <div className={cn("no-scrollbar relative mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto", column)}>
        {groups.map((group, index) => (
          <Fragment key={`${group.label ?? ""}:${index}`}>
            {expanded && group.label ? (
              <span className="px-2 pt-3 pb-0.5 text-[10.5px] font-medium tracking-[0.14em] text-sidebar-foreground/50 uppercase">
                {group.label}
              </span>
            ) : null}
            {!expanded && index > 0 ? <span data-slot="rail-gap" aria-hidden="true" className="h-3" /> : null}
            <RailEntries
              items={group.items}
              label={group.label}
              activeId={activeId}
              renderLink={renderLink}
              search={search}
              expanded={expanded}
            />
          </Fragment>
        ))}
        {plugins.length > 0 ? (
          <>
            {expanded ? (
              <span className="px-2 pt-3 pb-0.5 text-[10.5px] font-medium tracking-[0.14em] text-sidebar-foreground/50 uppercase">
                Plugins
              </span>
            ) : (
              <span data-slot="rail-divider" aria-hidden="true" className="my-2 w-5 border-t border-sidebar-border" />
            )}
            <RailEntries
              items={plugins}
              label="Plugins"
              activeId={activeId}
              renderLink={renderLink}
              search={search}
              expanded={expanded}
            />
          </>
        ) : null}
      </div>
      {account ? (
        <RailSlot expanded={expanded} title="Account">
          {account}
        </RailSlot>
      ) : null}
    </nav>
  )
}
