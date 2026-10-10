import type { ReactNode } from "react"
import { CheckIcon, ChevronsUpDownIcon, LayersIcon } from "lucide-react"

import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
        active
          ? "bg-primary text-primary-foreground"
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

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
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
            className="w-80 max-w-[calc(100vw-8px)]"
            align="start"
            side={isMobile ? "bottom" : menuSide}
          >
            {home ? (
              <>
                <DropdownMenuItem
                  onClick={home.onSelect}
                  aria-current={!active ? "true" : undefined}
                >
                  <ScopeTile
                    icon={home.icon}
                    label={home.label}
                    active={!active}
                  />
                  <span className="flex-1">{home.label}</span>
                  {!active ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {/* base-ui's GroupLabel needs a Menu.Group ancestor. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Scopes
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <div data-slot="scope-grid" className="grid grid-cols-3 gap-1 p-1">
              {scopes.map((scope: ScopeOption) => {
                const isActive = scope.id === activeId
                return (
                  <DropdownMenuItem
                    key={scope.id}
                    onClick={() => onSelect(scope.id)}
                    data-active={isActive || undefined}
                    aria-current={isActive ? "true" : undefined}
                    className="relative flex-col items-center gap-1 px-1 py-2 text-center data-active:bg-accent"
                  >
                    <ScopeTile
                      icon={scope.icon}
                      label={scope.label}
                      active={isActive}
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
                        className="absolute top-1 right-1 size-2 rounded-full bg-destructive"
                        title={scope.badge}
                      >
                        <span className="sr-only"> ({scope.badge})</span>
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
