import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface PageHeaderProps {
  title: string
  description?: string
  /** Buttons for this page as a whole. Row actions belong in the table. */
  actions?: ReactNode
  density?: "compact" | "comfortable"
  className?: string
}

/**
 * The top of every plugin page.
 *
 * An `<h1>` and not an `<h2>`: the host's SiteHeader shows the page name in
 * chrome, not in a heading, so each page owns the document's single level-one
 * heading and the heading order stays legal.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  density = "compact",
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-start justify-between gap-2",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h1
          className={
            density === "compact"
              ? "text-base font-semibold tracking-tight"
              : "text-lg font-medium"
          }
        >
          {title}
        </h1>
        {description && (
          <p
            className={cn(
              "text-muted-foreground",
              density === "compact" ? "text-xs" : "text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </div>
  )
}
