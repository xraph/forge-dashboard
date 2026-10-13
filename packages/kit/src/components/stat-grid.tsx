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
   * Emphasis for the card: a coloured value and a ring (a tint over the
   * cell in `StatGrid`), from the kit's own tone tokens. Defaults to `"default"`, which
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

// The strip's emphasis: a tint over the whole cell. A bar along the top would
// sit on the rule between rows and read as an underline of the cell above.
const TONE_TINT: Record<StatTone, string | undefined> = {
  default: undefined,
  warning: "bg-warning/10",
  danger: "bg-destructive/5",
  success: "bg-success/10",
}

/** One cell of the strip. Draws only its right and bottom rules. */
function StatCell({ label, value, hint, tone = "default" }: StatItem) {
  return (
    <div
      data-slot="stat"
      data-tone={tone}
      className={cn(
        "flex min-w-0 flex-col gap-1 border-r border-b px-4 py-3",
        TONE_TINT[tone]
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

// Written out in full for the same reason as the tone maps above.
const NARROW: Record<number, string> = { 1: "grid-cols-1" }
const WIDE: Record<1 | 2 | 3 | 4, string> = {
  1: "@2xl/main:grid-cols-1",
  2: "@2xl/main:grid-cols-2",
  3: "@2xl/main:grid-cols-3",
  4: "@2xl/main:grid-cols-4",
}

/**
 * The column classes that leave no empty cell on the last row where the count
 * allows it: one row of up to four, else five or four across (five only past
 * `@5xl`), else three, else four with a short last row.
 */
function columnsFor(count: number): string {
  const narrow = NARROW[count] ?? "grid-cols-2"
  if (count >= 1 && count <= 4) {
    return cn(narrow, WIDE[count as 1 | 2 | 3 | 4])
  }
  if (count % 5 === 0) return cn(narrow, WIDE[4], "@5xl/main:grid-cols-5")
  if (count % 4 === 0) return cn(narrow, WIDE[4])
  if (count % 3 === 0) return cn(narrow, WIDE[3])
  return cn(narrow, WIDE[4])
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
  return (
    <div
      data-slot="stat-grid"
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn("overflow-hidden rounded-lg border bg-card", className)}
    >
      <div className={cn("-mr-px -mb-px grid", columnsFor(items.length))}>
        {items.map((item) => (
          <StatCell key={item.label} {...item} />
        ))}
      </div>
    </div>
  )
}
