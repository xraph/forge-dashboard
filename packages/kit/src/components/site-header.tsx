import type { ReactNode } from "react"
import { Separator } from "@forge-go/dashboard-kit/components/separator"
import { SidebarTrigger } from "@forge-go/dashboard-kit/components/sidebar"

export interface SiteHeaderProps {
  title?: string
  scope?: string
  actions?: ReactNode
}

export function SiteHeader({ title, scope, actions }: SiteHeaderProps) {
  return (
    <header
      data-slot="site-header"
      className="flex min-h-(--header-height) shrink-0 items-center gap-2 border-b bg-background py-1.5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-2 text-xs"
        >
          {scope && (
            <>
              <span className="shrink-0 text-muted-foreground">{scope}</span>
              <span aria-hidden="true" className="text-muted-foreground/50">
                /
              </span>
            </>
          )}
          {title && (
            <span aria-current="page" className="truncate font-medium">
              {title}
            </span>
          )}
        </nav>
        {actions && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}
