import type { FeatureType } from "../types"

const number = new Intl.NumberFormat()

/** How a reset period reads. `none` is "Never": every page and both forms use this one word. */
export const PERIOD_LABEL: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  none: "Never",
}

/** How a feature type reads. */
export const TYPE_LABEL: Record<string, string> = {
  metered: "Metered",
  seat: "Seats",
  boolean: "On or off",
}

/**
 * A reset period for display, or undefined when there is none to show.
 *
 * The engine accepts an empty period on a plan feature and on a catalog
 * feature, so a record can carry one. The caller renders undefined as a none
 * marker rather than a blank cell. A value this map does not know shows as
 * stored.
 */
export function periodLabel(period: string): string | undefined {
  return period === "" ? undefined : (PERIOD_LABEL[period] ?? period)
}

/**
 * A limit as a person reads it, for a plan feature and a catalog feature
 * alike. An on-or-off feature is included only above zero: the engine reads
 * -1 there as off, not as unlimited, so it never reads "Unlimited".
 */
export function limitText(type: FeatureType | string, limit: number): string {
  if (type === "boolean") return limit > 0 ? "Included" : "Not included"
  if (limit === -1) return "Unlimited"
  return number.format(limit)
}
