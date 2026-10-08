import type {
  CatalogFeature,
  Coupon,
  Invoice,
  LineItem,
  Money,
  Page,
  Plan,
  Subscription,
} from "../src/types"

/*
 * Test data in the contract's own shapes. Every builder answers a complete,
 * valid record, and a test overrides only what it is about.
 */

export const usd = (amount: number): Money => ({
  amount,
  currency: "usd",
  display: `$${(amount / 100).toFixed(2)}`,
})

const STAMP = "2026-09-01T10:00:00Z"

export function aPlan(over: Partial<Plan> = {}): Plan {
  return {
    id: "plan_pro",
    name: "Pro",
    slug: "pro",
    description: "For growing teams.",
    currency: "usd",
    status: "active",
    trial_days: 0,
    features: [
      {
        id: "pf_api",
        key: "api_calls",
        name: "API calls",
        type: "metered",
        limit: 100000,
        period: "monthly",
        soft_limit: true,
        created_at: STAMP,
        updated_at: STAMP,
      },
      {
        id: "pf_seats",
        key: "seats",
        name: "Seats",
        type: "seat",
        limit: 10,
        period: "none",
        soft_limit: false,
        created_at: STAMP,
        updated_at: STAMP,
      },
      {
        id: "pf_sso",
        key: "sso",
        name: "Single sign-on",
        type: "boolean",
        limit: 1,
        period: "none",
        soft_limit: false,
        created_at: STAMP,
        updated_at: STAMP,
      },
    ],
    pricing: {
      id: "price_pro",
      plan_id: "plan_pro",
      base_amount: usd(4900),
      billing_period: "monthly",
      tiers: [
        {
          feature_key: "api_calls",
          type: "graduated",
          up_to: 100000,
          unit_amount: usd(0),
          flat_amount: usd(0),
          priority: 0,
        },
        {
          feature_key: "api_calls",
          type: "graduated",
          up_to: -1,
          unit_amount: usd(2),
          flat_amount: usd(0),
          priority: 1,
        },
      ],
      created_at: STAMP,
      updated_at: STAMP,
    },
    app_id: "app_ledger",
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

export function aCatalogFeature(
  over: Partial<CatalogFeature> = {}
): CatalogFeature {
  return {
    id: "feat_api_calls",
    key: "api_calls",
    name: "API calls",
    description: "Requests to the public API.",
    type: "metered",
    default_limit: 10000,
    period: "monthly",
    soft_limit: false,
    status: "active",
    app_id: "app_ledger",
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

export function aSubscription(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_acme",
    tenant_id: "acme",
    plan_id: "plan_pro",
    status: "active",
    current_period_start: "2026-09-20T00:00:00Z",
    current_period_end: "2026-10-20T00:00:00Z",
    quantity: { seats: 6 },
    app_id: "app_ledger",
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

export function aLineItem(over: Partial<LineItem> = {}): LineItem {
  return {
    id: "li_1",
    invoice_id: "inv_1",
    description: "Pro plan",
    quantity: 1,
    unit_amount: usd(4900),
    amount: usd(4900),
    type: "base",
    ...over,
  }
}

export function anInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    tenant_id: "acme",
    subscription_id: "sub_acme",
    status: "pending",
    currency: "usd",
    subtotal: usd(13900),
    tax_amount: usd(890),
    discount_amount: usd(2780),
    total: usd(12010),
    line_items: [
      aLineItem(),
      aLineItem({
        id: "li_2",
        description: "Seats",
        quantity: 6,
        unit_amount: usd(1500),
        amount: usd(9000),
        type: "seat",
        feature_key: "seats",
      }),
      aLineItem({
        id: "li_3",
        description: "LAUNCH20 (20% off)",
        quantity: 1,
        unit_amount: usd(-2780),
        amount: usd(-2780),
        type: "discount",
      }),
      aLineItem({
        id: "li_4",
        description: "Sales tax (8%)",
        quantity: 1,
        unit_amount: usd(890),
        amount: usd(890),
        type: "tax",
      }),
    ],
    period_start: "2026-08-20T00:00:00Z",
    period_end: "2026-09-20T00:00:00Z",
    due_date: "2026-10-04T00:00:00Z",
    app_id: "app_ledger",
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

export function aCoupon(over: Partial<Coupon> = {}): Coupon {
  return {
    id: "cpn_launch20",
    code: "LAUNCH20",
    name: "Launch offer",
    type: "percentage",
    amount: usd(0),
    percentage: 20,
    currency: "usd",
    max_redemptions: 100,
    times_redeemed: 1,
    app_id: "app_ledger",
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

export function aPage<T>(items: T[], over: Partial<Page<T>> = {}): Page<T> {
  return { items, limit: 50, offset: 0, has_more: false, ...over }
}
