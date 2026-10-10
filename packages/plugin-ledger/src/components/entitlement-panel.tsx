import { useId } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Progress } from "@forge-go/dashboard-kit/components/progress"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { FeatureUsage, SubscriptionUsage } from "../types"

const number = new Intl.NumberFormat()
const PERIOD: Record<string, string> = {
  monthly: " this month",
  yearly: " this year",
  none: "",
}

/**
 * One feature's usage against its limit.
 *
 * The meter's fill carries the state: the plain primary fill under the
 * limit, the warning fill at or past a soft limit (use is not blocked; it is
 * billed as overage only if the plan's usage pricing prices it), the destructive fill at or past a hard one (use is refused). The
 * over-limit states also say so in words beside an icon, because the warning
 * fill is under 3:1 against a white card and colour alone would fail anybody
 * who cannot see it. A limit of -1 is unlimited and draws no bar; a boolean
 * feature is included or not and has nothing to measure.
 *
 * "Reached" is read the way the engine's entitlement check reads it: a metered
 * feature is allowed without a reason only while used is under the limit, so a
 * hard limit refuses once used equals it ("quota exceeded") and a soft one
 * carries "over soft limit", although subscriptions.usage sets over_limit
 * only for used above the limit. Seats are a level held on the subscription,
 * not a stream of events, and the engine's check does not measure them, so a
 * full seat count is not called refused and a seat count past a soft limit is
 * not called unblocked.
 */
export function EntitlementRow({ feature: f }: { feature: FeatureUsage }) {
  const noteId = useId()
  const name = (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium">{f.name}</span>
      <span className="font-mono text-xs text-muted-foreground">{f.key}</span>
    </span>
  )

  if (f.type === "boolean") {
    return (
      <li className="flex items-center justify-between gap-4 px-4 py-3">
        {name}
        <span className={cn("text-sm", !f.enabled && "text-muted-foreground")}>
          {f.enabled ? "Included" : "Not included"}
        </span>
      </li>
    )
  }

  const period = PERIOD[f.period] ?? ""
  if (f.limit === -1) {
    return (
      <li className="flex items-center justify-between gap-4 px-4 py-3">
        {name}
        <span className="flex min-w-0 flex-col items-end text-sm">
          <span className="tabular-nums">{`${number.format(f.used)}${period}`}</span>
          <span className="text-muted-foreground">Unlimited</span>
        </span>
      </li>
    )
  }

  // A limit of 0 is a real limit ("none included"), not a divisor.
  const percent =
    f.limit > 0 ? Math.min(100, (f.used / f.limit) * 100) : f.used > 0 ? 100 : 0
  const over = f.over_limit ? f.used - f.limit : 0
  const reached = over === 0 && f.type === "metered" && f.used >= f.limit
  const flagged = over > 0 || reached
  // The fill class is chosen here and spelled out literally below: Tailwind
  // generates only class names it can read in the source, so a name assembled
  // at runtime would never exist in the stylesheet.
  const fill = flagged
    ? f.soft_limit
      ? "bg-warning"
      : "bg-destructive"
    : "bg-primary"
  // Whether overage is priced is not in the result, so the copy says only what
  // is always true: a soft limit does not block use. Seats are not measured by
  // the engine's check, so theirs says how far over and nothing more.
  const unblocked = f.type === "metered" ? ". Use is not blocked" : ""

  let note: string | undefined
  if (over > 0)
    note = f.soft_limit
      ? `${number.format(over)} over the soft limit${unblocked}`
      : `${number.format(over)} over the limit`
  else if (reached)
    note = f.soft_limit
      ? "At the soft limit. Use past it is not blocked"
      : "At the limit, further use is refused"

  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        {name}
        <span className="text-sm tabular-nums">{`${number.format(f.used)} of ${number.format(f.limit)}${period}`}</span>
      </div>
      <Progress
        value={percent}
        aria-label={`${f.name}: ${number.format(f.used)} of ${number.format(f.limit)} used`}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          fill === "bg-destructive" &&
            "[&_[data-slot=progress-indicator]]:bg-destructive",
          fill === "bg-warning" &&
            "[&_[data-slot=progress-indicator]]:bg-warning"
        )}
      />
      {note && (
        <p
          id={noteId}
          className={cn(
            "flex items-center gap-1.5 text-sm",
            f.soft_limit ? "text-warning-foreground" : "text-destructive"
          )}
        >
          <TriangleAlertIcon className="size-4" aria-hidden="true" />
          {note}
        </p>
      )}
    </li>
  )
}

/**
 * The subscription page's lead: every plan feature, read against its limit
 * from one subscriptions.usage call. Metered usage counts the store's
 * calendar period, which the rows name ("this month") rather than implying
 * the billing period.
 */
export function EntitlementPanel({
  subscriptionId,
}: {
  subscriptionId: string
}) {
  const usage = useQuery<SubscriptionUsage>("subscriptions.usage", {
    id: subscriptionId,
  })
  return (
    <section
      aria-label="Usage against limits"
      className="flex min-w-0 flex-col gap-3"
    >
      <h2 className="text-base font-medium">Usage against limits</h2>
      <QueryBoundary title="Usage" query={usage} skeletonRows={3}>
        {(data) => {
          const features = data.features ?? []
          return features.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This plan grants no features, so there is nothing to measure.
            </p>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y rounded-md border">
              {features.map((f) => (
                <EntitlementRow key={f.key} feature={f} />
              ))}
            </ul>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
