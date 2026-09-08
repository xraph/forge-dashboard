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
}

export function Stat({ label, value, hint }: StatItem) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
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
        "grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <Stat key={item.label} {...item} />
      ))}
    </div>
  )
}
