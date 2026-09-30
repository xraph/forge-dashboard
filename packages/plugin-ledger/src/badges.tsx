import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { CouponState } from "./lib/coupons"
import type { CatalogFeatureStatus, InvoiceStatus, PlanStatus, SubscriptionStatus } from "./types"

/*
 * Badge mapping for the ledger pages, and why (spec, "Badge mapping, per
 * page"). A badge's colour is an attention budget: whatever state holds most
 * of a page's rows takes outline whatever it means, and destructive is kept
 * for what an operator opens the page to find.
 *
 * Invoices. A healthy list is mostly paid, so paid is outline despite being
 * the good outcome. Pending is secondary: notable, and a problem if it sits.
 * Draft is secondary too: an invoice that never left draft is a stalled
 * billing run. Past due is destructive, the reason anybody opens this page
 * with intent. Voided is outline: closed on purpose, nothing to do.
 *
 * Subscriptions. Mostly active, so active is outline. Past due is
 * destructive. Trialing and paused are secondary: temporary, with a date
 * somebody should know. Canceled and expired are outline, because a list
 * filtered to them is mostly them.
 *
 * Plans. A short, roughly balanced list, the one place semantics decides:
 * active is default (one of the only two defaults in the plugin), draft
 * secondary, archived outline.
 *
 * Catalog features. Mostly active: active outline, draft secondary, archived
 * outline.
 *
 * Coupons. Mostly active: active outline. Scheduled and exhausted are
 * secondary, each a coupon that will not apply right now for a reason worth
 * seeing. Expired is outline: over, like voided.
 */

const INVOICE: Record<InvoiceStatus, { label: string; variant: "outline" | "secondary" | "destructive" }> = {
  paid: { label: "Paid", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
  draft: { label: "Draft", variant: "secondary" },
  past_due: { label: "Past due", variant: "destructive" },
  voided: { label: "Voided", variant: "outline" },
}

const SUBSCRIPTION: Record<SubscriptionStatus, { label: string; variant: "outline" | "secondary" | "destructive" }> = {
  active: { label: "Active", variant: "outline" },
  trialing: { label: "Trialing", variant: "secondary" },
  past_due: { label: "Past due", variant: "destructive" },
  paused: { label: "Paused", variant: "secondary" },
  canceled: { label: "Canceled", variant: "outline" },
  expired: { label: "Expired", variant: "outline" },
}

const PLAN: Record<PlanStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  draft: { label: "Draft", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
}

const FEATURE: Record<CatalogFeatureStatus, { label: string; variant: "secondary" | "outline" }> = {
  active: { label: "Active", variant: "outline" },
  draft: { label: "Draft", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
}

const COUPON: Record<CouponState, { label: string; variant: "secondary" | "outline" }> = {
  active: { label: "Active", variant: "outline" },
  scheduled: { label: "Scheduled", variant: "secondary" },
  exhausted: { label: "Exhausted", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const m = INVOICE[status] ?? { label: status, variant: "outline" as const }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const m = SUBSCRIPTION[status] ?? { label: status, variant: "outline" as const }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const m = PLAN[status] ?? { label: status, variant: "outline" as const }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

export function FeatureStatusBadge({ status }: { status: CatalogFeatureStatus }) {
  const m = FEATURE[status] ?? { label: status, variant: "outline" as const }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

export function CouponStateBadge({ state }: { state: CouponState }) {
  const m = COUPON[state]
  return <Badge variant={m.variant}>{m.label}</Badge>
}

/** A catalog feature with an empty app_id: shared by every app on the server. */
export function SharedBadge() {
  return <Badge variant="outline">Shared</Badge>
}
