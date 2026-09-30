import { Fragment } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { ContextDimension, ForgePlugin } from "@forge-go/dashboard-plugin"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@forge-go/dashboard-kit/components/popover"
import { AppWindowIcon, ChevronDownIcon } from "@forge-go/dashboard-kit/icons"
import { ContextSwitchers } from "./ContextSwitchers"

/**
 * One dimension's current value, read through the same query and projection
 * the dropdown uses. Until the read lands, or when nothing is current, it
 * shows the dimension's own label, so the trigger reads "App / Environment"
 * rather than an empty button.
 */
function CurrentValue({ dimension }: { dimension: ContextDimension }) {
  const read = useQuery(dimension.query)
  const label = read.data ? dimension.select(read.data).current?.label : undefined
  return <>{label ?? dimension.label}</>
}

/**
 * Every context dimension a scope declares, behind one rail button. The
 * trigger reads "Platform / Production"; clicking it opens a popover holding
 * the same App and Environment dropdowns the sidebar used to show. On a
 * narrow rail only the icon shows, and the text stays in the button's name.
 */
export function ContextControl({
  dimensions,
  plugin,
}: {
  dimensions: ContextDimension[]
  plugin?: ForgePlugin
}) {
  if (dimensions.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-slot="context-control"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-sidebar-border px-2 text-left text-sm outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          />
        }
      >
        <AppWindowIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:sr-only">
          {dimensions.map((dimension, index) => (
            <Fragment key={dimension.id}>
              {index > 0 ? " / " : null}
              <CurrentValue dimension={dimension} />
            </Fragment>
          ))}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
        />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72" aria-label="App and environment">
        <ContextSwitchers dimensions={dimensions} plugin={plugin} />
      </PopoverContent>
    </Popover>
  )
}
