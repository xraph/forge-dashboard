import type { ReactElement, ReactNode } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@forge-go/dashboard-kit/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

/** One selectable scope. Presentational: no plugin, no router, no capabilities. */
export interface ScopeOption {
  id: string
  label: string
  /** Shown under the label in the pane heading and the mobile rows. */
  namespace: string
  /** Absolute path of the scope's home page. The host computes it; the kit only links to it. */
  href: string
  icon?: ReactNode
  /** Short state marker for a scope that is not ready: "setup" or "mismatch". */
  badge?: string
}

export type RenderScopeLink = (node: NavNode, href: string) => ReactElement

/** The label with its state, which is what tooltips and screen readers get. */
export function scopeDescription(scope: Pick<ScopeOption, "label" | "badge">): string {
  switch (scope.badge) {
    case "setup":
      return `${scope.label} (needs setup)`
    case "mismatch":
      return `${scope.label} (version mismatch)`
    default:
      return scope.label
  }
}

// Spread, not index: a label that opens with an emoji is one code point and
// two UTF-16 units, and `label[0]` would hand back half a surrogate pair.
function initial(label: string): string {
  const first = [...label.trim()][0]
  return first ? first.toUpperCase() : "?"
}

/**
 * The accent tile a scope's icon sits in, with an initial when there is no
 * icon and a dot when the scope is not ready. The dot is aria-hidden because
 * the state is already in the link's name (see `scopeDescription`).
 */
export function ScopeGlyph({
  icon,
  label,
  badge,
  className,
}: {
  icon?: ReactNode
  label: string
  badge?: string
  className?: string
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        data-slot="scope-glyph"
        aria-hidden="true"
        className={cn(
          "grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground [&>svg]:size-5",
          className,
        )}
      >
        {icon ?? initial(label)}
      </span>
      {badge ? (
        <span
          data-slot="scope-badge"
          data-badge={badge}
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive ring-2 ring-sidebar"
        />
      ) : null}
    </span>
  )
}

/**
 * What the host's `renderLink` draws: `{icon}<span>{label}</span>`. The glyph
 * goes in as the icon and the description as the label, because the element
 * `renderLink` returns keeps its own children through `useRender`; there is no
 * way to inject different ones from this side.
 */
function nodeFor(scope: ScopeOption): NavNode {
  return {
    label: scopeDescription(scope),
    href: scope.href,
    icon: <ScopeGlyph icon={scope.icon} label={scope.label} badge={scope.badge} />,
  }
}

const RAIL_LINK =
  "flex h-10 items-center overflow-hidden rounded-md text-sm text-sidebar-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
// `>span:last-child` is the label span the host's renderLink renders after the
// glyph. Collapsed it is read but not seen; expanded it is a normal label.
const RAIL_LINK_ICON = "w-10 justify-center [&>span:last-child]:sr-only"
const RAIL_LINK_LABELLED = "w-full justify-start gap-2 px-1 [&>span:last-child]:truncate"

function RailEntry({
  scope,
  active,
  expanded,
  renderLink,
}: {
  scope: ScopeOption
  active: boolean
  expanded: boolean
  renderLink: RenderScopeLink
}) {
  const description = scopeDescription(scope)
  // Same shape SidebarMenuButton uses for its tooltip: the host's link element
  // becomes the tooltip trigger, and this component's classes and aria are
  // merged onto it. The element's own props win where they are set.
  const element = useRender({
    defaultTagName: "a",
    render: <TooltipTrigger render={renderLink(nodeFor(scope), scope.href)} />,
    props: mergeProps<"a">(
      {
        className: cn(RAIL_LINK, expanded ? RAIL_LINK_LABELLED : RAIL_LINK_ICON),
        "aria-current": active ? "page" : undefined,
      },
      {},
    ),
    state: { slot: "scope-rail-link", active },
  })
  return (
    <Tooltip>
      {element}
      <TooltipContent side="right" hidden={expanded}>
        {description}
      </TooltipContent>
    </Tooltip>
  )
}

export interface ScopeEntriesProps {
  home?: ScopeOption
  scopes: ScopeOption[]
  activeScopeId?: string
  renderLink: RenderScopeLink
  /** "rail" is the icon column; "rows" is the list the mobile sheet shows. */
  presentation: "rail" | "rows"
  /** Rail only. Labels are visible when true and screen-reader-only when false. */
  expanded?: boolean
}

/**
 * The one list of scopes, drawn two ways. Home comes first and is the active
 * entry whenever no scope is, which is every root-plugin page.
 */
export function ScopeEntries({
  home,
  scopes,
  activeScopeId,
  renderLink,
  presentation,
  expanded = false,
}: ScopeEntriesProps) {
  const entries = home ? [home, ...scopes] : scopes
  const isActive = (scope: ScopeOption) =>
    activeScopeId ? scope.id === activeScopeId : scope === home

  if (presentation === "rows") {
    return (
      <SidebarMenu data-slot="scope-rows">
        {entries.map((scope) => (
          <SidebarMenuItem key={scope.id}>
            <SidebarMenuButton
              size="lg"
              isActive={isActive(scope)}
              render={renderLink(nodeFor(scope), scope.href)}
            />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    )
  }

  return (
    <ul
      data-slot="scope-rail-entries"
      className={cn("flex flex-col gap-1", expanded ? "items-stretch" : "items-center")}
    >
      {entries.map((scope) => (
        <li key={scope.id} className={expanded ? "w-full" : undefined}>
          <RailEntry
            scope={scope}
            active={isActive(scope)}
            expanded={expanded}
            renderLink={renderLink}
          />
        </li>
      ))}
    </ul>
  )
}
