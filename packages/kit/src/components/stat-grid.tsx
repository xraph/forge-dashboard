import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"

export interface StatItem {
  label: string
  /** Formatted by the caller. This block does no unit or date formatting. */
  value: string | number
  hint?: string
  /**
   * Emphasis for the card: a coloured value and a ring (a top bar in
   * `StatGrid`), from the kit's own tone tokens. Defaults to `"default"`, which
   * adds nothing. Reach for `"danger"` or `"warning"` only when the number is
   * the thing to act on.
   */
  tone?: StatTone
}

export type StatTone = "default" | "warning" | "danger" | "success"

// Written out in full, not built from a variable: Tailwind finds classes by
// reading this file.
const TONE_CARD: Record<StatTone, string | undefined> = {
  default: undefined,
  warning: "ring-warning/50",
  danger: "ring-destructive/50",
  success: "ring-success/50",
}

const TONE_VALUE: Record<StatTone, string | undefined> = {
  default: undefined,
  warning: "text-warning-foreground",
  danger: "text-destructive",
  success: "text-success-foreground",
}

export function Stat({ label, value, hint, tone = "default" }: StatItem) {
  return (
    <Card size="sm" data-tone={tone} className={TONE_CARD[tone]}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "font-sans text-2xl font-medium tracking-tight tabular-nums group-data-[size=sm]/card:text-2xl",
            TONE_VALUE[tone]
          )}
        >
          {value}
        </CardTitle>
        {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
      </CardHeader>
    </Card>
  )
}

// The strip's emphasis: a 2px bar along the top of the cell. A ring would
// fight the rules between cells.
const TONE_BAR: Record<StatTone, string | undefined> = {
  default: undefined,
  warning:
    "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-warning",
  danger:
    "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-destructive",
  success:
    "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-success",
}

/** One cell of the strip. Draws only its right and bottom rules. */
function StatCell({ label, value, hint, tone = "default" }: StatItem) {
  return (
    <div
      data-slot="stat"
      data-tone={tone}
      className={cn(
        "relative flex min-w-0 flex-col gap-1 border-r border-b px-4 py-3",
        TONE_BAR[tone]
      )}
    >
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span
        data-slot="stat-value"
        className={cn(
          "text-2xl font-medium tracking-tight tabular-nums",
          TONE_VALUE[tone]
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export interface StatGridProps {
  items: StatItem[]
  className?: string
  /** Names the strip as a group, e.g. "Instance counters". */
  "aria-label"?: string
}

/**
 * The counter strip every overview page opens with: one panel, cells split
 * by rules. Each cell draws its right and bottom edges and the grid hangs 1px
 * past the clipping wrapper, so the outer edges vanish and the inner rules
 * meet the panel even when the last row is short.
 *
 * The `@xl/main`-style variants are container queries scoped to the host's
 * content wrapper. Render this outside it and the strip stays two across.
 */
export function StatGrid({
  items,
  className,
  "aria-label": ariaLabel,
}: StatGridProps) {
  // Five across only when it fills every row; 7 or 9 would leave a ragged end.
  const fives = items.length > 0 && items.length % 5 === 0
  return (
    <div
      data-slot="stat-grid"
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn("overflow-hidden rounded-lg border bg-card", className)}
    >
      <div
        className={cn(
          "-mr-px -mb-px grid grid-cols-2 @2xl/main:grid-cols-4",
          fives && "@5xl/main:grid-cols-5"
        )}
      >
        {items.map((item) => (
          <StatCell key={item.label} {...item} />
        ))}
      </div>
    </div>
  )
}
