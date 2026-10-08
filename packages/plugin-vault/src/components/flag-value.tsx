import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/** JSON longer than this is cut, with the whole of it kept in a title. */
export const JSON_DISPLAY_LIMIT = 60

export interface FlagValueProps {
  value: unknown
  /** Carried on the element only, never used to coerce. */
  type: string
  className?: string
}

/**
 * One flag value, drawn the same way everywhere a value appears.
 *
 * It draws what the value IS, not what the flag's type says it should be. A
 * string flag whose stored default is the boolean true shows `true`, and a
 * string flag whose default is "true" shows `"true"`, so the two are visibly
 * different. The old server-rendered page printed both as true and hid exactly
 * the mistake an operator needs to see. The `type` is carried on the element
 * as `data-flag-type` for styling and for tests, and never used to coerce.
 *
 * - boolean: `true` or `false`.
 * - string: quoted, so an empty string is visible and `"true"` is not `true`.
 * - number: mono with tabular figures, so a column of them lines up.
 * - null: `NoneCell`.
 * - anything else (an object or an array, only ever the value of a json flag):
 *   compact JSON, cut at 60 characters with the full text in a `title`.
 *
 * Everything is monospaced: a value is a raw thing you might copy.
 */
export function FlagValue({ value, type, className }: FlagValueProps) {
  if (value === null || value === undefined) {
    return <NoneCell label="value" className={className} />
  }

  const base = "font-mono text-xs"

  if (typeof value === "boolean") {
    return (
      <span data-flag-type={type} className={cn(base, className)}>
        {value ? "true" : "false"}
      </span>
    )
  }

  if (typeof value === "number") {
    return (
      <span
        data-flag-type={type}
        className={cn(base, "tabular-nums", className)}
      >
        {String(value)}
      </span>
    )
  }

  if (typeof value === "string") {
    return (
      <span data-flag-type={type} className={cn(base, "break-all", className)}>
        {JSON.stringify(value)}
      </span>
    )
  }

  const compact = JSON.stringify(value) ?? String(value)
  const cut =
    compact.length > JSON_DISPLAY_LIMIT
      ? `${compact.slice(0, JSON_DISPLAY_LIMIT - 1)}…`
      : compact
  return (
    <span
      data-flag-type={type}
      title={compact}
      className={cn(base, "break-all", className)}
    >
      {cut}
    </span>
  )
}
