import type { ReactNode } from "react"
import { PanelLeftIcon } from "lucide-react"
import { ForgeMark } from "@forge-go/dashboard-kit/components/brand-marks"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/** The compact brand row shared by desktop navigation and the mobile sheet. */
export function SidebarBrand({
  expanded = true,
  onToggle,
  toggleLabel,
  switcher,
}: {
  switcher?: ReactNode
  expanded?: boolean
  onToggle: () => void
  toggleLabel?: string
}) {
  const name =
    toggleLabel ?? (expanded ? "Collapse navigation" : "Expand navigation")
  return (
    <div
      data-slot="sidebar-brand"
      className={cn(
        "flex h-(--header-height) w-full shrink-0 items-center gap-2.5 border-b border-sidebar-border",
        expanded ? "px-3" : "justify-center"
      )}
    >
      {expanded && switcher ? (
        <div className="min-w-0 flex-1">{switcher}</div>
      ) : expanded ? (
        <>
          <ForgeMark className="ml-[11px] size-6 shrink-0 text-sidebar-foreground" />
          <span className="text-[25px] font-semibold tracking-[-1.1px] text-foreground">
            forge
          </span>
        </>
      ) : null}
      <button
        type="button"
        aria-label={name}
        aria-expanded={expanded}
        title={name}
        onClick={onToggle}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
          expanded && "ml-auto"
        )}
      >
        <PanelLeftIcon className="size-3.5 stroke-[1.5]" />
      </button>
    </div>
  )
}
