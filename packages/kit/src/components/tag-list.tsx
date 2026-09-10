import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface TagListProps {
  values: string[]
  /**
   * What the values are, as a noun phrase. Used for the empty case's
   * accessible label: "rooms" becomes "no rooms".
   */
  label: string
  /** Identifier-shaped values render monospaced. Default true. */
  mono?: boolean
  className?: string
}

/**
 * A cell holding a short list of short values, usually identifiers.
 *
 * Empty is the case that matters and the case that keeps getting lost. A cell
 * mapping over an array renders nothing for an empty one, which reads as a
 * failure rather than as an absence, so this falls through to `NoneCell`
 * instead.
 *
 * Deliberately not paginated, truncated or collapsed. A row with forty room ids
 * in it is a real thing to see rather than a layout problem to hide, and a
 * "+37 more" control in a table cell is a control nobody clicks.
 */
export function TagList({ values, label, mono = true, className }: TagListProps) {
  if (values.length === 0) return <NoneCell label={label} />

  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {values.map((value) => (
        <Badge key={value} variant="outline" className={cn(mono && "font-mono text-xs")}>
          {value}
        </Badge>
      ))}
    </span>
  )
}
