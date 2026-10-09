import { Fragment } from "react"
import type { ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { Separator } from "@forge-go/dashboard-kit/components/separator"
import { SidebarTrigger } from "@forge-go/dashboard-kit/components/sidebar"

/**
 * The first row of the page card: the secondary sidebar's toggle, when there
 * is a sidebar to toggle, and the breadcrumb. It replaces the old top bar,
 * which carried nothing else.
 */
export function ContentHeader({
  crumbs,
  showTrigger,
  actions,
}: {
  crumbs: string[]
  showTrigger: boolean
  actions?: ReactNode
}) {
  return (
    <header
      data-slot="content-header"
      className="flex min-h-(--header-height) shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5"
    >
      {showTrigger ? (
        <>
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-1 h-4 data-vertical:self-auto"
          />
        </>
      ) : null}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-2 text-xs"
      >
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <Fragment key={`${index}:${crumb}`}>
              {index > 0 ? (
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              ) : null}
              <span
                aria-current={last ? "page" : undefined}
                className={
                  last
                    ? "truncate font-normal"
                    : "shrink-0 text-muted-foreground"
                }
              >
                {crumb}
              </span>
            </Fragment>
          )
        })}
      </nav>
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
