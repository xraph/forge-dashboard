import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

export interface TimestampProps {
  value?: string
  /**
   * What did not happen, as a noun phrase: "expiry", "last activity". Used
   * only for the absent case, where it becomes "no expiry".
   */
  label: string
  className?: string
}

/**
 * A timestamp cell, including the case where there isn't one.
 *
 * `formatTimestamp` returns an en dash for an absent value, which is right for
 * a string and wrong for a cell: a caller has no way to attach a label to a
 * character inside a string, so every "never happened" timestamp in the
 * product was rendering silently to assistive technology. There is nothing
 * wrong with the formatter; it just cannot be the last word.
 *
 * So reach for this in a table or a description list, and for
 * `formatTimestamp` only where a plain string is genuinely what is needed.
 */
export function Timestamp({ value, label, className }: TimestampProps) {
  if (!value) return <NoneCell label={label} className={className} />
  return <span className={className}>{formatTimestamp(value)}</span>
}
