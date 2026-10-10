import { useId, useState, type ReactNode } from "react"
import { ChevronDownIcon } from "lucide-react"

/** Group headers follow the reference sidebar and control their own destinations. */
export function NavigationSection({
  label,
  navigationKey,
  children,
}: {
  label?: string
  navigationKey?: string
  children: ReactNode
}) {
  const id = useId()
  const [choice, setChoice] = useState<{ key?: string; open: boolean } | null>(
    null
  )
  // A new destination restores the group so route changes cannot hide its active row.
  const open =
    !label || (choice && choice.key === navigationKey ? choice.open : true)
  return (
    <section
      data-slot="navigation-section"
      className="border-b border-sidebar-border pt-[5px] pb-[13px]"
    >
      {label ? (
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setChoice({ key: navigationKey, open: !open })}
          className="flex h-8 w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-[11px] font-normal text-sidebar-foreground uppercase hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          {label}
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-[13px] shrink-0 stroke-[1.5] text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      ) : null}
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  )
}
