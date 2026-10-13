import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { useState } from "react"
import type { ReactNode } from "react"

/**
 * A chart with its table beside it. Every chart here has a table view, so no
 * value is only readable by hovering or by seeing colour; the toggle swaps one
 * for the other in place. The choice is this chart's and is not stored. The
 * chart is padded into its panel; the table runs edge to edge.
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
  const [asTable, setAsTable] = useState(false)
  return (
    <Section
      title={title}
      description={description}
      inset={!asTable}
      actions={
        <IconButton
          variant="ghost"
          onClick={() => setAsTable((on) => !on)}
          label={
            asTable
              ? `Show ${title.toLowerCase()} as a chart`
              : `Show ${title.toLowerCase()} as a table`
          }
        />
      }
    >
      {asTable ? table : children}
    </Section>
  )
}

/**
 * A short stroke in a series' colour, the way a legend keys a line: 2px for a
 * data line, 1px for a reference line, as each is drawn.
 */
export function LineKey({
  color,
  label,
  thin = false,
}: {
  color: string
  label: string
  thin?: boolean
}) {
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
