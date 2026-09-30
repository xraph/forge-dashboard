/*
 * The ledger contract's wire shapes. Each mirrors a Go struct and its field
 * names are that struct's JSON tags, snake_case, from
 * forgery/ledger/extension/contract and the domain packages behind it.
 * Optional fields are the ones Go marks omitempty.
 */

/** types.Money: amount in minor units, lowercase ISO 4217 currency. */
export interface Money {
  amount: number
  currency: string
  /** Go's own rendering. Pages format with lib/money instead, for the operator's locale. */
  display?: string
}

/** The contract's Page[T]: offset paging with no total. */
export interface Page<T> {
  items: T[]
  limit: number
  offset: number
  has_more: boolean
}

/** contract.Ack */
export interface Ack {
  ok: boolean
}

export type FeatureType = "metered" | "boolean" | "seat"
export type Period = "monthly" | "yearly" | "none"
export type TierType = "graduated" | "volume" | "flat"
export type PlanStatus = "active" | "draft" | "archived"
export type CatalogFeatureStatus = "active" | "draft" | "archived"
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "expired" | "paused"
export type InvoiceStatus = "draft" | "pending" | "paid" | "past_due" | "voided"
export type LineItemType = "base" | "usage" | "overage" | "seat" | "discount" | "tax"
export type CouponType = "percentage" | "amount"

/** plan.Feature: a feature as one plan grants it. `limit` -1 is unlimited. */
export interface PlanFeature {
  id: string
  catalog_id?: string
  key: string
  name: string
  type: FeatureType
  limit: number
  period: Period
  soft_limit: boolean
  metadata?: Record<string, string>
  created_at: string
  updated_at: string
}

/** plan.PriceTier. `up_to` -1 has no upper bound. */
export interface PriceTier {
  feature_key: string
  type: TierType
  up_to: number
  unit_amount: Money
  flat_amount: Money
  priority: number
}

/** plan.Pricing */
export interface Pricing {
  id: string
  plan_id: string
  base_amount: Money
  billing_period: Period
  tiers?: PriceTier[]
  created_at: string
  updated_at: string
}

/** plan.Plan */
export interface Plan {
  id: string
  name: string
  slug: string
  description: string
  currency: string
  status: PlanStatus
  trial_days: number
  features: PlanFeature[]
  pricing?: Pricing
  app_id: string
  provider_id?: string
  provider_name?: string
  metadata?: Record<string, string>
  created_at: string
  updated_at: string
}

/** feature.Feature: the reusable catalog. An empty app_id is shared by every app. */
export interface CatalogFeature {
  id: string
  key: string
  name: string
  description: string
  type: FeatureType
  default_limit: number
  period: Period
  soft_limit: boolean
  status: CatalogFeatureStatus
  app_id: string
  provider_id?: string
  provider_name?: string
  metadata?: Record<string, string>
  created_at: string
  updated_at: string
}

/** subscription.Subscription */
export interface Subscription {
  id: string
  tenant_id: string
  plan_id: string
  status: SubscriptionStatus
  current_period_start: string
  current_period_end: string
  trial_start?: string
  trial_end?: string
  canceled_at?: string
  cancel_at?: string
  ended_at?: string
  quantity?: Record<string, number>
  app_id: string
  provider_id?: string
  provider_name?: string
  metadata?: Record<string, string>
  created_at: string
  updated_at: string
}

/** coupon.Coupon. A percentage coupon still carries a zero `amount`. */
export interface Coupon {
  id: string
  code: string
  name: string
  type: CouponType
  amount: Money
  percentage?: number
  currency: string
  max_redemptions: number
  times_redeemed: number
  valid_from?: string
  valid_until?: string
  app_id: string
  metadata?: Record<string, string>
  created_at: string
  updated_at: string
}

/** contract.SubscriptionDetail */
export interface SubscriptionDetail {
  subscription: Subscription
  plan: Plan
  applied_coupons: Coupon[]
}

/** contract.FeatureUsage. `remaining` is -1 for unlimited and boolean features. */
export interface FeatureUsage {
  key: string
  name: string
  type: FeatureType
  period: Period
  limit: number
  used: number
  remaining: number
  soft_limit: boolean
  over_limit: boolean
  enabled: boolean
}

/** contract.SubscriptionUsage */
export interface SubscriptionUsage {
  features: FeatureUsage[]
}

/** invoice.LineItem. A discount line's amount is negative. */
export interface LineItem {
  id: string
  invoice_id: string
  feature_key?: string
  description: string
  quantity: number
  unit_amount: Money
  amount: Money
  type: LineItemType
  metadata?: Record<string, string>
}

/** invoice.Invoice. `discount_amount` is positive; the total subtracts it. */
export interface Invoice {
  id: string
  tenant_id: string
  subscription_id: string
  status: InvoiceStatus
  currency: string
  subtotal: Money
  tax_amount: Money
  discount_amount: Money
  total: Money
  line_items: LineItem[]
  period_start: string
  period_end: string
  due_date?: string
  paid_at?: string
  voided_at?: string
  void_reason?: string
  payment_ref?: string
  provider_id?: string
  provider_name?: string
  app_id: string
  metadata?: Record<string, string>
  created_at: string
  updated_at: string
}

/** contract.InvoiceDetail */
export interface InvoiceDetail {
  invoice: Invoice
  subscription: Subscription
  export_formats: string[]
}

/** contract.InvoiceExport. `content` is base64, as Go encodes a []byte. */
export interface InvoiceExport {
  format: string
  filename: string
  content: string
}

/** meter.UsageEvent */
export interface UsageEvent {
  id: string
  tenant_id: string
  app_id: string
  feature_key: string
  quantity: number
  timestamp: string
  idempotency_key?: string
  metadata?: Record<string, string>
}

/** contract.UsageTotals */
export interface UsageTotals {
  period: Period
  totals: Record<string, number>
}

/** entitlement.Result */
export interface EntitlementResult {
  allowed: boolean
  feature: string
  used: number
  limit: number
  remaining: number
  soft_limit: boolean
  reason?: string
}

/** provider.PaymentMethod */
export interface PaymentMethod {
  id: string
  type: string
  last4: string
  brand: string
  expiry_month: number
  expiry_year: number
  is_default: boolean
  provider_name: string
  provider_id: string
}

/** contract.PaymentMethods */
export interface PaymentMethods {
  configured: boolean
  methods: PaymentMethod[]
}

/** provider.SyncResult. A refusal is success false with the provider's message in error. */
export interface SyncResult {
  provider_name: string
  provider_id: string
  entity_type: string
  entity_id: string
  direction: string
  success: boolean
  error?: string
}

/** contract.OverviewStats. When capped, every count is a lower bound. */
export interface OverviewStats {
  plans: number
  active_plans: number
  subscriptions_by_status: Partial<Record<SubscriptionStatus, number>>
  pending_invoices: number
  /** Invoices the lifecycle clock marked past due; they no longer count as pending. */
  past_due_invoices: number
  coupons: number
  capped: boolean
}

/** contract.SettingsDetail: SettingsView embedded, so the JSON is flat. */
export interface SettingsDetail {
  meter_batch_size: number
  meter_flush_interval: string
  entitlement_cache_ttl: string
  /** How often the lifecycle clock runs, as a Go duration ("1m0s"), or "off". A ledger older than the clock does not send it. */
  lifecycle_interval?: string
  app_id: string
  require_app_claim: boolean
  providers: string[]
  invoice_formats: string[]
}
