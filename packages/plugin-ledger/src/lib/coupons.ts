import type { Coupon } from "../types"
import { formatMoney } from "./money"

export type CouponState = "active" | "scheduled" | "expired" | "exhausted"

/**
 * A coupon's state now, from its validity window and its redemption cap. The
 * contract stores no state field; this is the same reading the engine makes
 * before it applies one. A cap of 0 means no cap.
 */
export function couponState(c: Coupon, nowMs: number = Date.now()): CouponState {
  if (c.valid_from && Date.parse(c.valid_from) > nowMs) return "scheduled"
  if (c.valid_until && Date.parse(c.valid_until) < nowMs) return "expired"
  if (c.max_redemptions > 0 && c.times_redeemed >= c.max_redemptions) return "exhausted"
  return "active"
}

export function describeDiscount(c: Coupon): string {
  return c.type === "percentage" ? `${c.percentage ?? 0}% off` : `${formatMoney(c.amount)} off`
}
