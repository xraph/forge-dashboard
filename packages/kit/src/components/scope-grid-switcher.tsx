import { useMemo, useRef, type ReactNode } from "react"
import { CheckIcon, ChevronsUpDownIcon, LayersIcon } from "lucide-react"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@forge-go/dashboard-kit/components/dropdown-menu"
import type {
  ScopeOption,
  ScopeSwitcherProps,
} from "@forge-go/dashboard-kit/components/scope-switcher"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

// Spread, not index: a label that opens with an emoji is one code point and
// two UTF-16 units, and `label[0]` would hand back half a surrogate pair.
function initial(label: string): string {
  const first = [...label.trim()][0]
  return first ? first.toUpperCase() : "?"
}

/**
 * A scope's tile. Always draws something: the scope's icon, or its initial
 * when the plugin declares none, so no row or tile ever reads as missing.
 */
export function ScopeTile({
  icon,
  label,
  active = false,
  className,
}: {
  icon?: ReactNode
  label: string
  active?: boolean
  className?: string
}) {
  return (
    <span
      data-slot="scope-tile"
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold [&>svg]:size-4",
        // Important: a focused menu item recolours every descendant with
        // `focus:**:text-accent-foreground`, which would paint the icon
        // dark on the dark active tile.
        active
          ? "bg-primary text-primary-foreground!"
          : "border bg-sidebar-accent text-muted-foreground",
        className
      )}
    >
      {icon ?? initial(label)}
    </span>
  )
}

/**
 * The scope switcher, with the scopes laid out three to a row so the menu
 * stays short as extensions are added. The home destination keeps its own
 * full-width row above them.
 */
export function ScopeGridSwitcher({
  scopes,
  activeId,
  onSelect,
  home,
  menuSide = "bottom",
  fallbackLabel = "Dashboard",
  compact = false,
  header = false,
}: ScopeSwitcherProps & { compact?: boolean; header?: boolean }) {
  const { isMobile } = useSidebar()
  const active = scopes.find((scope) => scope.id === activeId)
  const label = active?.label ?? home?.label ?? fallbackLabel
  const side = isMobile ? "bottom" : menuSide
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Opening to the side, the menu measures from the rail's border rather
  // than the trigger's, so it sits beside the sidebar instead of over it.
  // The trigger stays the context element so scrolling and resizing still
  // reposition it.
  const railEdge = useMemo(
    () => ({
      getBoundingClientRect() {
        const trigger = triggerRef.current
        const rect = trigger?.getBoundingClientRect() ?? new DOMRect()
        const edge =
          trigger?.closest('[data-slot="nav-rail"]')?.getBoundingClientRect()
            .right ?? rect.right
        return new DOMRect(rect.x, rect.y, edge - rect.x, rect.height)
      },
      get contextElement() {
        return triggerRef.current ?? undefined
      },
    }),
    []
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            ref={triggerRef}
            aria-label={`${label}${active ? ` @${active.namespace}` : home ? " Application dashboard" : ""}`}
            render={
              header ? (
                <button
                  type="button"
                  disabled={scopes.length === 0 && !home}
                  className="flex h-8 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-md px-2 text-left text-sidebar-foreground outline-none group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-2 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50"
                />
              ) : (
                <SidebarMenuButton
                  size={compact ? "default" : "lg"}
                  disabled={scopes.length === 0 && !home}
                />
              )
            }
          >
            <ScopeTile
              icon={
                (active ? active.icon : home?.icon) ??
                (compact ? <LayersIcon /> : undefined)
              }
              label={label}
              active={!compact && !header}
              className={
                header
                  ? "size-6 rounded-sm border-0 bg-transparent text-sidebar-foreground group-data-[collapsible=icon]:size-4 [&>svg]:size-6 [&>svg]:stroke-[1.5] group-data-[collapsible=icon]:[&>svg]:size-4"
                  : compact
                    ? "size-4 rounded-sm border-0 bg-transparent text-[11px] text-muted-foreground [&_svg]:stroke-[1.5]"
                    : undefined
              }
            />
            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span
                className={
                  header
                    ? "truncate text-lg font-semibold tracking-tight"
                    : compact
                      ? "truncate font-normal"
                      : "truncate font-semibold"
                }
              >
                {label}
              </span>
              {active ? (
                <span
                  className={
                    compact || header
                      ? "sr-only"
                      : "truncate text-xs text-muted-foreground"
                  }
                >
                  @{active.namespace}
                </span>
              ) : home ? (
                <span
                  className={
                    compact || header
                      ? "sr-only"
                      : "truncate text-xs text-muted-foreground"
                  }
                >
                  Application dashboard
                </span>
              ) : null}
            </div>
            <ChevronsUpDownIcon className="ml-auto size-3.5 shrink-0 stroke-[1.5] group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-72 max-w-[calc(100vw-8px)] rounded-lg p-0"
            align="start"
            side={side}
            sideOffset={8}
            anchor={side === "right" ? railEdge : undefined}
          >
            {home ? (
              <DropdownMenuItem
                onClick={home.onSelect}
                aria-current={!active ? "true" : undefined}
                className="rounded-none border-b px-3 py-2"
              >
                <ScopeTile
                  icon={home.icon}
                  label={home.label}
                  active={!active}
                  className="size-6 [&>svg]:size-3.5"
                />
                <span className="flex-1 font-medium">{home.label}</span>
                {!active ? (
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ) : null}
            {/* base-ui's GroupLabel needs a Menu.Group ancestor. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="border-b px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Scopes
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {/* Each cell rules only its right and bottom edges. The grid
                hangs 1px past the wrapper on both sides, so the clip drops
                the outer edges and the inner lines meet the popup's edge,
                even when the last row is short. */}
            <div className="overflow-hidden">
              <div
                data-slot="scope-grid"
                className="-mr-px -mb-px grid grid-cols-3"
              >
                {scopes.map((scope: ScopeOption) => {
                  const isActive = scope.id === activeId
                  return (
                    <DropdownMenuItem
                      key={scope.id}
                      onClick={() => onSelect(scope.id)}
                      data-active={isActive || undefined}
                      aria-current={isActive ? "true" : undefined}
                      className="relative min-w-0 flex-col items-center gap-0.5 rounded-none border-r border-b px-1.5 py-3 text-center data-active:bg-accent"
                    >
                      <ScopeTile
                        icon={scope.icon}
                        label={scope.label}
                        active={isActive}
                        className={cn(
                          "mb-1 size-7 [&>svg]:size-3.5",
                          !isActive && "border-0 bg-muted"
                        )}
                      />
                      <span className="w-full truncate text-xs font-medium">
                        {scope.label}
                      </span>
                      <span className="w-full truncate text-[10px] text-muted-foreground">
                        @{scope.namespace}
                      </span>
                      {scope.badge ? (
                        <span
                          data-slot="scope-badge"
                          className="absolute top-2 right-2 size-1.5 rounded-full bg-destructive"
                          title={scope.badge}
                        >
                          <span className="sr-only"> ({scope.badge})</span>
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  )
                })}
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
