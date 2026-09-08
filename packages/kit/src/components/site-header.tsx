import { Separator } from "@forge-go/dashboard-kit/components/separator"
import { SidebarTrigger } from "@forge-go/dashboard-kit/components/sidebar"

export interface SiteHeaderProps {
  /**
   * The current page's title. Omit it and no <h1> renders at all -- there is
   * no fallback string, because a fallback is exactly how this component
   * ended up hardcoding "Documents" on every page regardless of scope.
   */
  title?: string
}

export function SiteHeader({ title }: SiteHeaderProps) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        {title ? <h1 className="text-base font-medium">{title}</h1> : null}
      </div>
    </header>
  )
}
