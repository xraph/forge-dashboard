import { cn } from "@forge-go/dashboard-kit/lib/utils"

/**
 * How many of a run's cases have been scored. Progress is not a severity, so
 * the fill wears the ink colour and the track a lighter step of it; nothing
 * here turns amber or red. The words beside it carry the numbers, so the bar
 * is never the only way to read them.
 */
export function ProgressMeter({
  done,
  total,
  label,
  className,
}: {
  done: number
  total: number
  /** Names the meter for a screen reader: "Cases scored". */
  label: string
  className?: string
}) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total}`}
      className={cn(
        "h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-foreground/10",
        className
      )}
    >
      <div
        className="h-full rounded-full bg-foreground"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}
