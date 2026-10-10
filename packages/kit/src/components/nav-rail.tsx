import { Fragment } from "react"
import { SidebarBrand } from "@forge-go/dashboard-kit/components/sidebar-brand"
import { NavigationSection } from "@forge-go/dashboard-kit/components/navigation-section"
import type { ReactNode } from "react"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { RailEntries } from "@forge-go/dashboard-kit/components/rail-entries"
import type {
  RailItem,
  RenderRailLink,
} from "@forge-go/dashboard-kit/components/rail-entries"
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
  /** The scope switcher in the compact brand header. */
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
              expanded
                ? "flex w-full items-center"
                : "flex w-8 items-center justify-center",
              className
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
 * Fits the host's search trigger to the reference's flat navigation row.
 * Wide, it fills the row. Narrow, it keeps its own 32px square.
 */
const SEARCH_SLOT =
  "[&>button]:mx-0 [&>button]:border-transparent [&>button]:bg-transparent [&>button]:shadow-none [&>button]:text-sidebar-foreground/70 [&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-accent-foreground [&_kbd]:rounded-[3px] [&_kbd]:border [&_kbd]:border-sidebar-border [&_kbd]:px-1"

/** Wide rail only: the trigger fills the row at the context control's height. */
const SEARCH_SLOT_WIDE = "[&>button]:h-8 [&>button]:w-full [&>button]:px-2"

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
        "group sticky top-0 z-20 flex h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear",
        expanded ? "w-(--sidebar-width)" : "w-(--sidebar-width-icon)",
        column
      )}
    >
      <SidebarBrand
        expanded={expanded}
        onToggle={onToggle}
        switcher={switcher}
      />
      <div
        className={cn(
          "flex shrink-0 flex-col gap-1",
          expanded ? "px-3 pt-[18px] pb-[9px]" : "items-center px-2 py-2"
        )}
      >
        {!expanded && switcher ? (
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
          <RailSlot
            expanded={expanded}
            title="Search pages"
            className={cn(SEARCH_SLOT, expanded && SEARCH_SLOT_WIDE)}
          >
            {searchControl}
          </RailSlot>
        ) : null}
      </div>
      <div
        className={cn(
          "relative no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto",
          expanded && "px-3",
          column
        )}
      >
        {groups.map((group, index) => (
          <Fragment key={`${group.label ?? ""}:${index}`}>
            {!expanded && index > 0 ? (
              <span data-slot="rail-gap" aria-hidden="true" className="h-3" />
            ) : null}
            {expanded ? (
              <NavigationSection label={group.label} navigationKey={activeId}>
                <RailEntries
                  items={group.items}
                  label={group.label}
                  activeId={activeId}
                  renderLink={renderLink}
                  search={search}
                  expanded
                />
              </NavigationSection>
            ) : (
              <RailEntries
                items={group.items}
                label={group.label}
                activeId={activeId}
                renderLink={renderLink}
                search={search}
                expanded={expanded}
              />
            )}
          </Fragment>
        ))}
        {plugins.length > 0 ? (
          <>
            {!expanded ? (
              <span
                data-slot="rail-divider"
                aria-hidden="true"
                className="my-2 w-5 border-t border-sidebar-border"
              />
            ) : null}
            {expanded ? (
              <NavigationSection label="Plugins" navigationKey={activeId}>
                <RailEntries
                  items={plugins}
                  label="Plugins"
                  activeId={activeId}
                  renderLink={renderLink}
                  search={search}
                  expanded
                />
              </NavigationSection>
            ) : (
              <RailEntries
                items={plugins}
                label="Plugins"
                activeId={activeId}
                renderLink={renderLink}
                search={search}
                expanded={expanded}
              />
            )}
          </>
        ) : null}
      </div>
      {account ? (
        <div
          className={cn(
            "flex shrink-0 flex-col gap-px border-t border-sidebar-border py-3",
            expanded ? "mx-3" : "mx-2"
          )}
        >
          {account ? (
            <RailSlot expanded={expanded} title="Account">
              {account}
            </RailSlot>
          ) : null}
        </div>
      ) : null}
    </nav>
  )
}
