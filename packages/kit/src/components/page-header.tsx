import type { ReactNode } from "react"
import "../styles/density.css"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface PageHeaderProps {
  title: string
  description?: string
  /** Buttons for this page as a whole. Row actions belong in the table. */
  actions?: ReactNode
  /** Identity and status under the description: badges, the app, an ID. */
  meta?: ReactNode
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
  meta,
  className,
  density = "compact",
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      data-density={density}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h1
          className={
            density === "compact"
              ? "text-lg font-medium tracking-tight"
              : "text-xl font-medium"
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
        {meta && (
          <div
            data-slot="page-header-meta"
            className="flex flex-wrap items-center gap-2 pt-1 text-sm"
          >
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </div>
  )
}
