import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { FlagValue } from "./flag-value"

export interface ConfigValueProps {
  value: unknown
  /** Any string the server holds. Never used to coerce. */
  valueType: string
  className?: string
}

/**
 * One config value, drawn the way `FlagValue` draws a flag's: what the value
 * IS, not what the entry's type says it should be, so the string "true" and
 * the boolean true look different and a wrong-typed value is not hidden.
 *
 * The one difference is `duration`. A duration is a bare Go duration string
 * (`90s`, `1h30m`), and quoting it would make it read as text. So a string
 * value on a duration entry is shown as it is, in mono. A duration entry whose
 * stored value is not a string is drawn as what it is, through `FlagValue`.
 * So is an empty one: the empty string is not a duration, and bare it would be
 * a blank cell that reads as still loading. Quoted, it is visibly empty.
 */
export function ConfigValue({ value, valueType, className }: ConfigValueProps) {
  if (valueType === "duration" && typeof value === "string" && value !== "") {
    return (
      <span className={cn("font-mono text-xs break-all", className)}>
        {value}
      </span>
    )
  }
  return <FlagValue value={value} type={valueType} className={className} />
}
