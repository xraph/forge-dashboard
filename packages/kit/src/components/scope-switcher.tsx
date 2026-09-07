import type { ReactNode } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@forge-go/dashboard-kit/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@forge-go/dashboard-kit/components/sidebar"
import { ChevronsUpDownIcon } from "lucide-react"

/** One selectable scope. Presentational: no plugin, no router, no capabilities. */
export interface ScopeOption {
  id: string
  label: string
  /** Rendered with the sigil so the namespace is visible without reading the URL. */
  namespace: string
  icon?: ReactNode
  /** Short state marker for a scope that is not ready, e.g. "setup". */
  badge?: string
}

export interface ScopeSwitcherProps {
  scopes: ScopeOption[]
  activeId?: string
  onSelect: (id: string) => void
  /** Shown before capabilities resolve, when there is no scope to name. */
  fallbackLabel?: string
}

export function ScopeSwitcher({
  scopes,
  activeId,
  onSelect,
  fallbackLabel = "Dashboard",
}: ScopeSwitcherProps) {
  const active = scopes.find((s) => s.id === activeId)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          {/*
            Trigger shape copied from nav-user.tsx:83-88. base-ui's `render`
            prop takes a bare element and the content goes to the trigger's
            own children. Nesting the content inside the render element
            instead loses it.
          */}
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" disabled={scopes.length === 0} />
            }
          >
            {active?.icon}
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate font-semibold">
                {active?.label ?? fallbackLabel}
              </span>
              {active ? (
                <span className="truncate text-xs text-muted-foreground">
                  @{active.namespace}
                </span>
              ) : null}
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          {/* No Radix trigger-width var: this kit is @base-ui and defines none. */}
          <DropdownMenuContent className="min-w-56" align="start">
            {/*
              base-ui's GroupLabel throws "MenuGroupContext is missing"
              without a <Menu.Group> ancestor, same as nav-user.tsx's label.
            */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Scopes
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {scopes.map((scope) => (
              <DropdownMenuItem
                key={scope.id}
                onClick={() => onSelect(scope.id)}
              >
                {scope.icon}
                <div className="grid flex-1 leading-tight">
                  <span className="truncate">{scope.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    @{scope.namespace}
                  </span>
                </div>
                {scope.badge ? (
                  <span className="ml-auto rounded-full border px-2 text-[10px] uppercase">
                    {scope.badge}
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
