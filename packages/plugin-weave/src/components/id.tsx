import { PluginLink } from "@forge-go/dashboard-plugin"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/** An identifier: monospace, because it is a raw value you might copy. */
export function Id({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  return (
    <span className={cn("font-mono text-xs break-all", className)}>
      {value}
    </span>
  )
}

/** An identifier that opens its record. `to` is scope-relative. */
export function IdLink({
  to,
  value,
  label,
}: {
  to: string
  value: string
  label?: string
}) {
  return (
    <PluginLink
      to={to}
      className="font-mono text-xs break-all underline-offset-4 hover:underline"
      aria-label={label}
    >
      {value}
    </PluginLink>
  )
}
