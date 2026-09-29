import { Badge } from "@forge-go/dashboard-kit/components/badge"

/**
 * The domain has pending, delivering, delivered and failed. The page splits
 * pending in two, because a delivery nobody has tried yet and one that has
 * already failed twice are different things to be looking at.
 *
 * The variants ramp by proportion (PLAYBOOK, fifth convention). Delivered is
 * most of any healthy log, so it takes the quietest variant; failed is what a
 * person opens this page to find, so it is the only destructive one.
 */
export function deliveryState(
  state: string,
  attemptCount: number
): {
  label: string
  variant: "outline" | "secondary" | "default" | "destructive"
} {
  switch (state) {
    case "delivered":
      return { label: "Delivered", variant: "outline" }
    case "failed":
      return { label: "Failed", variant: "destructive" }
    case "delivering":
      return { label: "Sending", variant: "secondary" }
    case "pending":
      return attemptCount > 0
        ? { label: "Retrying", variant: "default" }
        : { label: "Queued", variant: "secondary" }
    default:
      return { label: state, variant: "secondary" }
  }
}

export function DeliveryStateBadge({
  state,
  attemptCount,
}: {
  state: string
  attemptCount: number
}) {
  const { label, variant } = deliveryState(state, attemptCount)
  return <Badge variant={variant}>{label}</Badge>
}
