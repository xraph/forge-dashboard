import { useId, type ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface SectionProps {
  /** The section's `<h2>`. Leave it out when the page title already says it. */
  title?: string
  description?: ReactNode
  /** Controls for this section: a View all link, a filter bar, a window switch. */
  actions?: ReactNode
  /** Pads the content. For prose, description lists and forms; tables stay flush. */
  inset?: boolean
  /** Names an untitled section, so it is still a region. */
  "aria-label"?: string
  className?: string
  children?: ReactNode
}

/*
 * Flush content: a table meets the panel edges, its outer cells line up with
 * the header's px-4, and anything that brings its own frame (the empty state,
 * QueryBoundary's error card) drops it, since the panel already is one.
 * Arbitrary variants, not a stylesheet, so Tailwind finds them in this file.
 */
const FLUSH = [
  "[&_th:first-child]:pl-4",
  "[&_td:first-child]:pl-4",
  "[&_th:last-child]:pr-4",
  "[&_td:last-child]:pr-4",
  "[&_caption]:px-4",
  "[&_caption]:pb-3",
  "[&_[data-slot=resource-table]>nav]:px-4",
  "[&_[data-slot=resource-table]>nav]:pb-3",
  "[&_[data-slot=zero-state]]:rounded-none",
  "[&_[data-slot=zero-state]]:border-0",
  "[&_[data-slot=zero-state]]:bg-transparent",
  "[&_[aria-busy=true][role=status]]:p-4",
  "[&_[data-slot=card]]:rounded-none",
  "[&_[data-slot=card]]:shadow-none",
  "[&_[data-slot=card]]:ring-0",
].join(" ")

/**
 * The frame every block on a plugin page sits in: a bordered panel with a
 * header strip and a rule under it. Content runs edge to edge unless `inset`.
 *
 * A `<section>` named by its `<h2>` (or by `aria-label` when untitled), so it
 * is a region landmark a screen reader can jump between.
 */
export function Section({
  title,
  description,
  actions,
  inset = false,
  "aria-label": ariaLabel,
  className,
  children,
}: SectionProps) {
  const headingId = useId()
  const hasHeader = Boolean(title || description || actions)
  return (
    <section
      data-slot="section"
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : ariaLabel}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground",
        className
      )}
    >
      {hasHeader && (
        <div
          data-slot="section-header"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3"
        >
          {(title || description) && (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {title && (
                <h2 id={headingId} className="text-sm font-medium">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        data-slot="section-content"
        data-inset={inset || undefined}
        className={cn("min-w-0", inset ? "p-4" : FLUSH)}
      >
        {children}
      </div>
    </section>
  )
}
