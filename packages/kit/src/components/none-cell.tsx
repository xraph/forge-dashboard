import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface NoneCellProps {
  /**
   * What there is none of, as a noun phrase: "rooms", "scopes", "last used".
   * Becomes the accessible label, so write it to read after the word "no".
   */
  label: string
  className?: string
}

/**
 * A table cell that means "none", and says so.
 *
 * An empty cell is ambiguous in a way that costs real time. A sighted operator
 * reads a blank cell as "still loading" or "something is broken", and a screen
 * reader reads it as nothing at all. Neither is what the data says, which is
 * that this row genuinely has none.
 *
 * The en dash carries the meaning visually and the label carries it to
 * assistive technology. Both, not either: a dash alone is silent, and a
 * visually-hidden label alone leaves a blank cell on screen.
 *
 * This exists as a block because it was hand-rolled four times across two
 * plugins and dropped in three separate rewrites, each time because there was
 * nothing to import and nothing to name.
 */
export function NoneCell({ label, className }: NoneCellProps) {
  return (
    <span
      aria-label={`no ${label}`}
      className={cn("text-muted-foreground", className)}
    >
      –
    </span>
  )
}
