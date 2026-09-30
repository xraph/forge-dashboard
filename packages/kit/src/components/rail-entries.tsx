import type { ReactElement, ReactNode } from "react"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

/** One entry in a rail. Presentational: no plugin, no router. */
export interface RailItem {
  id: string
  label: string
  /** Absolute path the entry links to. The host computes it. */
  href: string
  icon?: ReactNode
}

export type RenderRailLink = (node: NavNode, href: string) => ReactElement

// Spread, not index: a label that opens with an emoji is one code point and
// two UTF-16 units, and `label[0]` would hand back half a surrogate pair.
function initial(label: string): string {
  const first = [...label.trim()][0]
  return first ? first.toUpperCase() : "?"
}

/** The tile an entry's icon sits in, with an initial when there is no icon. */
export function RailGlyph({
  icon,
  label,
  className,
}: {
  icon?: ReactNode
  label: string
  className?: string
}) {
  return (
    <span
      data-slot="rail-glyph"
      aria-hidden="true"
      className={cn(
        "grid size-4 shrink-0 place-items-center text-xs font-medium [&>svg]:size-4",
        className,
      )}
    >
      {icon ?? initial(label)}
    </span>
  )
}

/**
 * What the host's `renderLink` draws: `{icon}<span>{label}</span>`. The glyph
 * goes in as the icon because the element `renderLink` returns keeps its own
 * children through `useRender`; there is no way to inject different ones
 * from this side.
 */
function nodeFor(item: RailItem): NavNode {
  return {
    label: item.label,
    href: item.href,
    icon: <RailGlyph icon={item.icon} label={item.label} />,
  }
}

const RAIL_LINK =
  "flex h-8 items-center overflow-hidden rounded-md text-sm text-sidebar-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
// `>span:last-child` is the label span the host's renderLink renders after the
// glyph. Collapsed it is read but not seen; expanded it is a normal label.
// Sized like a SidebarMenuButton (h-8, p-2, a 16px icon) so the rail and the
// secondary sidebar read at the same density.
const RAIL_LINK_ICON = "w-8 justify-center [&>span:last-child]:sr-only"
const RAIL_LINK_LABELLED = "w-full justify-start gap-2 px-2 [&>span:last-child]:truncate"

function RailEntry({
  item,
  active,
  expanded,
  search,
  renderLink,
}: {
  item: RailItem
  active: boolean
  expanded: boolean
  search: string
  renderLink: RenderRailLink
}) {
  // Same shape SidebarMenuButton uses for its tooltip: the host's link element
  // becomes the tooltip trigger, and this component's classes and aria are
  // merged onto it. The element's own props win where they are set.
  const element = useRender({
    defaultTagName: "a",
    render: <TooltipTrigger render={renderLink(nodeFor(item), `${item.href}${search}`)} />,
    props: {
      className: cn(RAIL_LINK, expanded ? RAIL_LINK_LABELLED : RAIL_LINK_ICON),
      "aria-current": active ? "page" : undefined,
    },
    state: { slot: "rail-link", active },
  })
  return (
    <Tooltip>
      {element}
      <TooltipContent side="right" hidden={expanded}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

export interface RailEntriesProps {
  items: RailItem[]
  activeId?: string
  renderLink: RenderRailLink
  /** Appended to every href, so a rail inside one scope keeps its query dimensions. */
  search?: string
  /** Labels are visible when true and screen-reader-only when false. */
  expanded?: boolean
  /** Accessible name for the list, so a screen reader hears the group it belongs to. */
  label?: string
}

export function RailEntries({
  items,
  activeId,
  renderLink,
  search = "",
  expanded = false,
  label,
}: RailEntriesProps) {
  return (
    <ul
      data-slot="rail-entries"
      aria-label={label}
      className={cn("flex flex-col gap-1", expanded ? "items-stretch" : "items-center")}
    >
      {items.map((item) => (
        <li key={item.id} className={expanded ? "w-full" : undefined}>
          <RailEntry
            item={item}
            active={item.id === activeId}
            expanded={expanded}
            search={search}
            renderLink={renderLink}
          />
        </li>
      ))}
    </ul>
  )
}
