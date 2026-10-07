import { useId, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"

/**
 * A chart with its table beside it. Every chart here has a table view, so no
 * value is only readable by hovering or by seeing colour; the toggle swaps one
 * for the other in place. The choice is this chart's and is not stored.
 */
export function ChartFrame({
  title,
  description,
  table,
  children,
}: {
  title: string
  description?: ReactNode
  /** The same numbers as a table. */
  table: ReactNode
  /** The chart. */
  children: ReactNode
}) {
  const id = useId()
  const [asTable, setAsTable] = useState(false)
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="text-sm font-medium">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((on) => !on)}>
          {asTable ? `Show ${title.toLowerCase()} as a chart` : `Show ${title.toLowerCase()} as a table`}
        </Button>
      </div>
      {asTable ? table : children}
    </section>
  )
}

/**
 * A short stroke in a series' colour, the way a legend keys a line: 2px for a
 * data line, 1px for a reference line, as each is drawn.
 */
export function LineKey({ color, label, thin = false }: { color: string; label: string; thin?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={`inline-block w-4 ${thin ? "h-px" : "h-0.5 rounded-full"}`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
