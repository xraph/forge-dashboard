import type { ReactNode } from "react"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { formatDelta, formatThreshold } from "../format"

// Bars drawn as plain elements, not as an SVG chart: each row is a label, a
// bar and its value as text, so a screen reader reads the row and nothing is
// drawn that the text does not also say. The marks follow the dataviz specs:
// 16px thick, a 4px rounded data end, square at the baseline, no strokes.

export interface ScaleRow {
  key: string
  label: ReactNode
  value: number
  /** The value as printed at the bar's end. */
  valueLabel: string
}

/**
 * Magnitudes on one 0-to-max scale, one ink, with an optional reference line
 * (a pass threshold, say) named in words above the bars. A short value sits at
 * the bar's tip; a long one ("2 of 2 bypassed, 1 not scored") gets a column of
 * its own, where it can never run past the edge.
 */
export function ScaleBars({
  rows,
  max = 1,
  reference,
  label,
  valueColumn = false,
}: {
  rows: ScaleRow[]
  max?: number
  reference?: { value: number; label: string }
  /** Names the list for a screen reader. */
  label: string
  /** Print each value in a column after the bars instead of at the tip. */
  valueColumn?: boolean
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v / max)) * 100}%`
  return (
    <div className="flex flex-col gap-1">
      {reference && (
        <p className="text-xs text-muted-foreground">
          <span
            aria-hidden
            className="mr-1.5 inline-block h-3 w-px translate-y-0.5 bg-muted-foreground"
          />
          {reference.label}
        </p>
      )}
      <ul aria-label={label} className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.key}
            className={cn(
              "grid items-center gap-3 py-1 text-sm",
              valueColumn
                ? "grid-cols-[minmax(6rem,10rem)_1fr_auto]"
                : "grid-cols-[minmax(6rem,10rem)_1fr]"
            )}
          >
            <span className="truncate">{row.label}</span>
            <span className={cn("relative h-6", !valueColumn && "mr-14")}>
              {reference && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-muted-foreground"
                  style={{ left: pct(reference.value) }}
                />
              )}
              <span
                aria-hidden
                className="absolute top-1 left-0 h-4 rounded-r-[4px] bg-foreground"
                style={{ width: pct(row.value) }}
              />
              {!valueColumn && (
                <span
                  className="absolute top-0.5 ml-2 font-mono text-xs tabular-nums"
                  style={{ left: pct(row.value) }}
                >
                  {row.valueLabel}
                </span>
              )}
            </span>
            {valueColumn && (
              <span className="font-mono text-xs tabular-nums">
                {row.valueLabel}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface DeltaRow {
  key: string
  label: ReactNode
  /** Change against the baseline, on the 0 to 1 scale. */
  value: number
  regressed: boolean
}

/**
 * Changes around zero. The stretch beyond minus the threshold is shaded, so a
 * bar reaching into it reads as past the line without a legend lookup; a
 * regressed bar also wears the destructive colour, an icon and the word, never
 * the colour alone.
 */
export function DeltaBars({
  rows,
  threshold,
  label,
}: {
  rows: DeltaRow[]
  threshold: number
  label: string
}) {
  const extent = Math.min(
    1,
    Math.max(0.1, threshold * 2, ...rows.map((r) => Math.abs(r.value)))
  )
  const half = (v: number) =>
    `${(Math.min(Math.abs(v), extent) / extent) * 50}%`
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        <span
          aria-hidden
          className="mr-1.5 inline-block h-3 w-3 translate-y-0.5 rounded-sm bg-destructive/15"
        />
        {`Shaded: more than ${formatThreshold(threshold)} below the baseline`}
      </p>
      <ul aria-label={label} className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(6rem,12rem)_1fr] items-center gap-3 py-1 text-sm"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{row.label}</span>
              {row.regressed && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive">
                  <TriangleAlertIcon aria-hidden className="size-3.5" />
                  regressed
                </span>
              )}
            </span>
            <span className="relative mx-12 h-6">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-destructive/15"
                style={{ right: `calc(50% + ${half(threshold)})` }}
              />
              <span
                aria-hidden
                className="absolute inset-y-0 left-1/2 w-px bg-border"
              />
              <span
                aria-hidden
                className={cn(
                  "absolute top-1 h-4",
                  row.value < 0 ? "rounded-l-[4px]" : "rounded-r-[4px]",
                  row.regressed ? "bg-destructive" : "bg-foreground"
                )}
                style={
                  row.value < 0
                    ? { right: "50%", width: half(row.value) }
                    : { left: "50%", width: half(row.value) }
                }
              />
              <span
                className="absolute top-0.5 font-mono text-xs tabular-nums"
                style={
                  row.value < 0
                    ? { right: `calc(50% + ${half(row.value)} + 0.5rem)` }
                    : { left: `calc(50% + ${half(row.value)} + 0.5rem)` }
                }
              >
                {formatDelta(row.value)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
