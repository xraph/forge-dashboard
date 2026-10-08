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
   * Emphasis for the card: a ring and a coloured value, from the kit's own
   * tone tokens. Defaults to `"default"`, which adds nothing. Reach for
   * `"danger"` or `"warning"` only when the number is the thing to act on.
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
            "font-mono text-[1.7rem] tracking-tight tabular-nums group-data-[size=sm]/card:text-[1.7rem]",
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

export interface StatGridProps {
  items: StatItem[]
  className?: string
}

/**
 * The counter row every overview page opens with.
 *
 * The `@xl/main` and `@5xl/main` variants are container queries scoped to a
 * container named `main`, which the host declares on its content wrapper.
 * Render this outside that wrapper and the cards stack in one column at every
 * width. That is a layout bug, not a crash, so nothing warns about it.
 */
export function StatGrid({ items, className }: StatGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4",
        className
      )}
    >
      {items.map((item) => (
        <Stat key={item.label} {...item} />
      ))}
    </div>
  )
}
