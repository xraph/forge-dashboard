// ledger-fixtures.mjs: in-memory state and intent handlers for the ledger
// contributor (packages/plugin-ledger), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors forgery/ledger/extension/contract (plans.go, features.go,
// subscriptions.go, invoices.go, coupons.go, usage.go, overview.go and
// imports.go, with ../../provider_import.go for the import rules). Field names
// are the Go JSON tags, snake_case. Lists answer
// {items, limit, offset, has_more} and never a total. Money is
// {amount, currency, display} with amount in minor units.
//
// The module imports nothing from server.mjs. It needs server.mjs's
// FixtureError class so `err instanceof FixtureError` holds in the dispatcher
// and NOT_FOUND, CONFLICT and PERMISSION_DENIED reach the wire with their own
// codes; createLedgerHandlers takes it as an argument for that reason.
//
// There is no lifecycle clock. Periods never roll, trials never end, a
// scheduled cancel is never enacted and an unpaid invoice never becomes past
// due on its own (the seed has some that already are). settings.detail reports
// lifecycle_interval "off" for that reason. The engine's rules for the periods
// invoices.generate may bill (billedPeriod below) are ported, the clock's work
// is not. The commands' own work is ported: a pause records paused_at and
// leaves the period alone, and a resume restarts the cycle and moves a
// running trial's end on by the pause (resumeOf below).
//
// Two switches, read on every call so a running server can be flipped:
//   LEDGER_FIXTURE_NO_APP=1       no app is selected. Every intent except the
//                                 feature catalog and settings.detail answers
//                                 PERMISSION_DENIED, as the Go binder does.
//   LEDGER_FIXTURE_NO_PROVIDER=1  no payment provider is registered: every
//                                 syncToProvider and importFromProvider
//                                 answers UNAVAILABLE.

const APP_ID = "app_ledger"
const PROVIDER = "stripe"
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const RECENT_DEFAULT = 10
const RECENT_MAX = 50
const EXPORT_FORMATS = ["csv", "json"]
const FEATURE_TYPES = ["metered", "boolean", "seat"]
const PERIODS = ["monthly", "yearly", "none"]
const TIER_TYPES = ["graduated", "volume", "flat"]
const PLAN_STATUSES = ["active", "draft", "archived"]
const FEATURE_STATUSES = ["active", "draft", "archived"]
const DAY = 86_400_000

/** RFC3339 in UTC without fractional seconds, like Go's time.Time encoding. */
export function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
}

function currencyDigits(currency) {
  try {
    return (
      new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** types.Money as it marshals: amount in minor units, lowercase currency, display. */
export function money(amount, currency = "usd") {
  const code = (currency || "usd").toLowerCase()
  let display
  try {
    display = new Intl.NumberFormat("en-US", { style: "currency", currency: code.toUpperCase() }).format(
      amount / 10 ** currencyDigits(code),
    )
  } catch {
    display = `${amount} ${code}`
  }
  return { amount, currency: code, display }
}

const clone = (value) => structuredClone(value)

/** Go's %q for the plain strings a provider sends. */
const q = (value) => JSON.stringify(String(value ?? ""))

const MONEY_SYMBOLS = { usd: "$", eur: "\u20ac", gbp: "\u00a3", jpy: "\u00a5", cad: "C$", aud: "A$", chf: "CHF ", cny: "\u00a5", sek: "kr ", nzd: "NZ$" }
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd"])

/** types.Money's String(): the symbol, then the major units, as `%v` prints it in the engine's messages. */
function goMoney(m) {
  const code = String(m?.currency ?? "").toLowerCase()
  const amount = Number(m?.amount ?? 0)
  const symbol = MONEY_SYMBOLS[code] ?? `${code.toUpperCase()} `
  if (ZERO_DECIMAL.has(code)) return `${symbol}${amount}`
  const abs = Math.abs(amount)
  return `${symbol}${amount < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}

/** created_at ascending, id ascending: plans and catalog features. */
function oldestFirst(a, b) {
  return a.created_at.localeCompare(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** created_at descending, id descending: subscriptions, invoices, coupons. */
function newestFirst(a, b) {
  return b.created_at.localeCompare(a.created_at) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0)
}

/** The state a coupon is in right now, from its window and its redemption cap. */
export function couponState(c, nowMs = Date.now()) {
  if (c.valid_from && Date.parse(c.valid_from) > nowMs) return "scheduled"
  if (c.valid_until && Date.parse(c.valid_until) < nowMs) return "expired"
  if (c.max_redemptions > 0 && c.times_redeemed >= c.max_redemptions) return "exhausted"
  return "active"
}

/**
 * Whether a coupon's validity window holds now, inclusive at both ends: the
 * rule ListCoupons' Active filter and ApplyCoupon share. It ignores the
 * redemption cap, so an exhausted coupon inside its window still lists.
 */
export function inValidityWindow(c, nowMs = Date.now()) {
  return !(c.valid_from && Date.parse(c.valid_from) > nowMs) && !(c.valid_until && Date.parse(c.valid_until) < nowMs)
}

/**
 * An invoice the way GenerateInvoice builds one: base, seats, overage, then a
 * discount on the subtotal and 8% tax on the net. Lines carry their own
 * signed amounts; the invoice carries discount_amount as a positive number.
 */
export function buildInvoice({ id, sub, plan, periodStartMs, periodEndMs, status, overageQty = 0, discountPercent = 0, discountLabel = "", createdMs, extra = {} }) {
  const currency = plan.currency
  const lines = []
  const push = (type, description, quantity, unit, featureKey) => {
    const line = {
      id: `${id}_li${lines.length + 1}`,
      invoice_id: id,
      description,
      quantity,
      unit_amount: money(unit, currency),
      amount: money(quantity * unit, currency),
      type,
    }
    if (featureKey) line.feature_key = featureKey
    lines.push(line)
  }
  push("base", `${plan.name} plan`, 1, plan.pricing?.base_amount.amount ?? 0)
  const seats = sub.quantity?.seats ?? 0
  if (seats > 0) push("seat", "Seats", seats, 1500, "seats")
  if (overageQty > 0) push("overage", "API calls over the included amount", overageQty, 2, "api_calls")
  const subtotal = lines.reduce((sum, l) => sum + l.amount.amount, 0)
  const discount = Math.round((subtotal * discountPercent) / 100)
  if (discount > 0) push("discount", discountLabel || `Discount (${discountPercent}% off)`, 1, -discount)
  const tax = Math.round((subtotal - discount) * 0.08)
  if (tax > 0) push("tax", "Sales tax (8%)", 1, tax)
  return {
    id,
    tenant_id: sub.tenant_id,
    subscription_id: sub.id,
    status,
    currency,
    subtotal: money(subtotal, currency),
    tax_amount: money(tax, currency),
    discount_amount: money(discount, currency),
    total: money(subtotal - discount + tax, currency),
    line_items: lines,
    period_start: iso(periodStartMs),
    period_end: iso(periodEndMs),
    app_id: APP_ID,
    created_at: iso(createdMs),
    updated_at: iso(createdMs),
    ...extra,
  }
}

function seedLedgerState() {
  const now = Date.now()
  const ago = (days) => iso(now - days * DAY)
  let counter = 0
  const state = {
    nextId: (prefix) => `${prefix}_${String(++counter).padStart(6, "0")}`,
    plans: [],
    features: [],
    subscriptions: [],
    invoices: [],
    coupons: [],
    applied: [],
    events: [],
    paymentMethods: {},
  }

  const tier = (feature_key, type, up_to, unit, flat, priority) => ({
    feature_key,
    type,
    up_to,
    unit_amount: money(unit),
    flat_amount: money(flat),
    priority,
  })
  const plan = ({ id, slug, name, description, status, base, trialDays, features, tiers = [], createdDays }) => {
    const created = ago(createdDays)
    const p = {
      id,
      name,
      slug,
      description,
      currency: "usd",
      status,
      trial_days: trialDays,
      features: features.map(([key, fname, type, limit, period, soft]) => ({
        id: `pf_${slug}_${key}`,
        key,
        name: fname,
        type,
        limit,
        period,
        soft_limit: soft === true,
        created_at: created,
        updated_at: created,
      })),
      pricing: {
        id: `price_${slug}`,
        plan_id: id,
        base_amount: money(base),
        billing_period: "monthly",
        ...(tiers.length ? { tiers } : {}),
        created_at: created,
        updated_at: created,
      },
      app_id: APP_ID,
      created_at: created,
      updated_at: created,
    }
    state.plans.push(p)
    return p
  }

  const starter = plan({
    id: "plan_starter", slug: "starter", name: "Starter", description: "For small teams getting started.",
    status: "active", base: 1900, trialDays: 14, createdDays: 120,
    features: [["api_calls", "API calls", "metered", 10000, "monthly"], ["seats", "Seats", "seat", 3, "none"], ["sso", "Single sign-on", "boolean", 0, "none"]],
  })
  const pro = plan({
    id: "plan_pro", slug: "pro", name: "Pro", description: "For growing teams.",
    status: "active", base: 4900, trialDays: 0, createdDays: 110,
    features: [["api_calls", "API calls", "metered", 100000, "monthly", true], ["seats", "Seats", "seat", 10, "none"], ["sso", "Single sign-on", "boolean", 1, "none"]],
    tiers: [tier("api_calls", "graduated", 100000, 0, 0, 0), tier("api_calls", "graduated", -1, 2, 0, 1), tier("seats", "volume", -1, 1500, 0, 0)],
  })
  plan({
    id: "plan_enterprise", slug: "enterprise", name: "Enterprise", description: "Negotiated contracts.",
    status: "draft", base: 49900, trialDays: 30, createdDays: 20,
    features: [["api_calls", "API calls", "metered", -1, "monthly"], ["seats", "Seats", "seat", -1, "none"], ["sso", "Single sign-on", "boolean", 1, "none"]],
  })
  plan({
    id: "plan_legacy", slug: "legacy", name: "Legacy", description: "Retired in favour of Starter.",
    status: "archived", base: 990, trialDays: 0, createdDays: 300,
    features: [["api_calls", "API calls", "metered", 5000, "monthly"]],
  })

  const catalog = (id, key, name, description, type, default_limit, period, status, app_id, createdDays, soft_limit = false) => {
    const created = ago(createdDays)
    state.features.push({ id, key, name, description, type, default_limit, period, soft_limit, status, app_id, created_at: created, updated_at: created })
  }
  catalog("feat_api_calls", "api_calls", "API calls", "Requests to the public API.", "metered", 10000, "monthly", "active", APP_ID, 130)
  catalog("feat_seats", "seats", "Seats", "People who can sign in.", "seat", 3, "none", "active", APP_ID, 130)
  catalog("feat_sso", "sso", "Single sign-on", "SAML and OIDC sign-in.", "boolean", 0, "none", "active", APP_ID, 125)
  catalog("feat_support_hours", "support_hours", "Support hours", "Shared by every app on this server.", "metered", 10, "monthly", "active", "", 200)
  catalog("feat_legacy_exports", "legacy_exports", "Legacy exports", "The old CSV export.", "boolean", 1, "none", "archived", APP_ID, 400)

  const periodStart = now - 10 * DAY
  const periodEnd = now + 20 * DAY
  const sub = (id, tenant_id, p, status, createdDays, extra = {}) => {
    const created = ago(createdDays)
    const s = {
      id,
      tenant_id,
      plan_id: p.id,
      status,
      current_period_start: iso(periodStart),
      current_period_end: iso(periodEnd),
      app_id: APP_ID,
      created_at: created,
      updated_at: created,
      ...extra,
    }
    state.subscriptions.push(s)
    return s
  }
  const acme = sub("sub_acme", "acme", pro, "active", 100, { quantity: { seats: 6 } })
  const globex = sub("sub_globex", "globex", starter, "trialing", 5, { trial_start: ago(5), trial_end: iso(now + 9 * DAY) })
  const initech = sub("sub_initech", "initech", pro, "past_due", 90)
  const hooli = sub("sub_hooli", "hooli", starter, "paused", 60)
  const umbrella = sub("sub_umbrella", "umbrella", starter, "canceled", 200, { canceled_at: ago(40), cancel_at: ago(40) })
  sub("sub_wayne", "wayne", starter, "active", 30, { cancel_at: iso(periodEnd) })

  for (const k of [3, 2, 1]) {
    const startMs = now - (10 + 30 * (k + 1)) * DAY
    const endMs = startMs + 30 * DAY
    state.invoices.push(
      buildInvoice({
        id: `inv_acme_${4 - k}`, sub: acme, plan: pro, periodStartMs: startMs, periodEndMs: endMs, status: "paid",
        overageQty: 4000 * k, discountPercent: 20, discountLabel: "LAUNCH20 (20% off)", createdMs: endMs,
        extra: { due_date: iso(endMs + 14 * DAY), paid_at: iso(endMs + 2 * DAY), payment_ref: `ch_acme_${4 - k}`, updated_at: iso(endMs + 2 * DAY) },
      }),
    )
  }
  // Rows another app owns. No request from app_ledger can read or change them,
  // so each answers NOT_FOUND exactly as an unknown id does (a shared feature is
  // the one exception: it is readable from every app).
  const OTHER_APP = "app_other"
  const outsiderPlan = plan({
    id: "plan_other", slug: "other", name: "Other app's plan", description: "Belongs to another app on this server.",
    status: "active", base: 2500, trialDays: 0, createdDays: 80,
    features: [["api_calls", "API calls", "metered", 1000, "monthly"]],
  })
  outsiderPlan.app_id = OTHER_APP
  const outsider = sub("sub_outsider", "outsider", outsiderPlan, "active", 40, { app_id: OTHER_APP })
  state.features.push({ id: "feat_other_exports", key: "exports", name: "Exports", description: "Belongs to another app on this server.", type: "metered", default_limit: 50, period: "monthly", soft_limit: false, status: "active", app_id: OTHER_APP, created_at: ago(60), updated_at: ago(60) })

  const lastStart = now - 40 * DAY
  const lastEnd = now - 10 * DAY
  state.invoices.push(
    buildInvoice({ id: "inv_acme_4", sub: acme, plan: pro, periodStartMs: lastStart, periodEndMs: lastEnd, status: "pending", overageQty: 12000, discountPercent: 20, discountLabel: "LAUNCH20 (20% off)", createdMs: lastEnd, extra: { due_date: iso(now + 4 * DAY) } }),
    buildInvoice({ id: "inv_initech_1", sub: initech, plan: pro, periodStartMs: lastStart, periodEndMs: lastEnd, status: "past_due", createdMs: lastEnd + 1000, extra: { due_date: iso(now - 2 * DAY) } }),
    buildInvoice({ id: "inv_globex_1", sub: globex, plan: starter, periodStartMs: periodStart, periodEndMs: periodEnd, status: "draft", createdMs: now - DAY }),
    buildInvoice({ id: "inv_umbrella_1", sub: umbrella, plan: starter, periodStartMs: now - 70 * DAY, periodEndMs: now - 40 * DAY, status: "voided", createdMs: now - 40 * DAY, extra: { voided_at: ago(39), void_reason: "Customer left during the trial" } }),
    buildInvoice({ id: "inv_hooli_1", sub: hooli, plan: starter, periodStartMs: lastStart, periodEndMs: lastEnd, status: "paid", createdMs: lastEnd + 2000, extra: { due_date: iso(lastEnd + 14 * DAY), paid_at: ago(8), payment_ref: "ch_hooli_1" } }),
  )

  state.invoices.push(
    buildInvoice({ id: "inv_outsider_1", sub: outsider, plan: outsiderPlan, periodStartMs: lastStart, periodEndMs: lastEnd, status: "pending", createdMs: lastEnd, extra: { app_id: OTHER_APP, due_date: iso(now + 4 * DAY) } }),
  )

  const coupon = (id, code, name, type, value, extra, createdDays) => {
    const created = ago(createdDays)
    const c = {
      id,
      code,
      name,
      type,
      amount: type === "amount" ? money(value) : money(0),
      currency: "usd",
      max_redemptions: 0,
      times_redeemed: 0,
      app_id: APP_ID,
      created_at: created,
      updated_at: created,
      ...extra,
    }
    if (type === "percentage") c.percentage = value
    state.coupons.push(c)
  }
  coupon("cpn_launch20", "LAUNCH20", "Launch offer", "percentage", 20, { max_redemptions: 100, times_redeemed: 1, valid_from: ago(120), valid_until: iso(now + 60 * DAY) }, 120)
  coupon("cpn_welcome10", "WELCOME10", "Welcome credit", "amount", 1000, {}, 90)
  coupon("cpn_summer50", "SUMMER50", "Summer sale", "percentage", 50, { times_redeemed: 12, valid_from: ago(100), valid_until: ago(10) }, 100)
  coupon("cpn_spring15", "SPRING15", "Spring promotion", "percentage", 15, { valid_from: iso(now + 10 * DAY) }, 3)
  coupon("cpn_beta100", "BETA100", "Beta testers", "percentage", 100, { max_redemptions: 5, times_redeemed: 5 }, 250)
  state.applied.push({ subscription_id: "sub_acme", coupon_id: "cpn_launch20", applied_at: ago(100) })

  for (let d = 0; d < 30; d++) {
    const ts = iso(now - d * DAY - 6 * 3600_000)
    state.events.push({ id: `evt_acme_${d}`, tenant_id: "acme", app_id: APP_ID, feature_key: "api_calls", quantity: 3000 + ((d * 997) % 2500), timestamp: ts })
  }
  for (let d = 0; d < 14; d++) {
    const ts = iso(now - d * DAY - 9 * 3600_000)
    state.events.push({ id: `evt_globex_${d}`, tenant_id: "globex", app_id: APP_ID, feature_key: "api_calls", quantity: 120 + ((d * 53) % 200), timestamp: ts })
  }
  // One batch ingested at a single instant: three events share a timestamp,
  // which is what the store's id tie-break exists for.
  const batch = iso(now - 2 * 3600_000)
  for (const [n, q] of [[1, 10], [2, 20], [3, 30]]) {
    state.events.push({ id: `evt_batch_${n}`, tenant_id: "acme", app_id: APP_ID, feature_key: "api_calls", quantity: q, timestamp: batch })
  }

  state.paymentMethods = {
    acme: [
      { id: "pm_acme_1", type: "card", last4: "4242", brand: "visa", expiry_month: 12, expiry_year: 2028, is_default: true, provider_name: PROVIDER, provider_id: "pm_1Nf4242" },
      { id: "pm_acme_2", type: "card", last4: "5555", brand: "mastercard", expiry_month: 3, expiry_year: 2027, is_default: false, provider_name: PROVIDER, provider_id: "pm_1Nf5555" },
    ],
    initech: [{ id: "pm_initech_1", type: "bank_account", last4: "6789", brand: "", expiry_month: 0, expiry_year: 0, is_default: true, provider_name: PROVIDER, provider_id: "ba_1Nf6789" }],
  }

  // What the payment provider holds that this ledger does not, keyed by
  // provider id, so every importFromProvider has something to import. Each
  // record is what the provider answers: no local id, and an app_id only where
  // the provider files it under an app.
  const providerPlan = (slug, name, base, trialDays, extra = {}) => ({
    name,
    slug,
    description: `${name}, as the payment provider holds it.`,
    currency: "usd",
    status: "active",
    trial_days: trialDays,
    features: [
      { key: "api_calls", name: "API calls", type: "metered", limit: 50000, period: "monthly", soft_limit: false },
      { key: "seats", name: "Seats", type: "seat", limit: 5, period: "none", soft_limit: false },
    ],
    pricing: { base_amount: money(base), billing_period: "monthly" },
    ...extra,
  })
  const providerInvoice = (startDays, endDays, extra = {}) => {
    const built = buildInvoice({
      id: "inv_provider", sub: acme, plan: pro, periodStartMs: now - startDays * DAY, periodEndMs: now - endDays * DAY,
      status: "paid", createdMs: now - endDays * DAY, extra: { paid_at: ago(endDays - 2) },
    })
    const { id: _id, app_id: _app, created_at: _created, updated_at: _updated, ...rest } = built
    return { ...rest, line_items: rest.line_items.map(({ id: _line, invoice_id: _invoice, ...line }) => line), ...extra }
  }
  // The lines providerInvoice carries, mapped one by one, for a record that needs a line changed.
  const providerLines = (change) => providerInvoice(190, 160).line_items.map(change)
  const providerSub = (tenant_id, plan_id, extra = {}) => ({
    tenant_id, plan_id, status: "active", current_period_start: iso(periodStart), current_period_end: iso(periodEnd), ...extra,
  })
  state.provider = {
    plans: {
      prod_growth: providerPlan("growth", "Growth", 9900, 7),
      prod_scale: providerPlan("scale", "Scale", 19900, 0),
      prod_starter: providerPlan("starter", "Starter", 1900, 14),
      prod_partner: providerPlan("partner", "Partner", 2900, 0, { app_id: "app_partner" }),
    },
    features: {
      mtr_exports: { key: "exports", name: "Exports", description: "Scheduled CSV exports.", type: "metered", default_limit: 100, period: "monthly", soft_limit: false, status: "active" },
      mtr_webhooks: { key: "webhooks", name: "Webhooks", description: "Outbound event delivery.", type: "boolean", default_limit: 1, period: "none", soft_limit: false, status: "active" },
      mtr_draft: { key: "draft_feature", name: "Draft feature", description: "A provider feature that is still a draft.", type: "boolean", default_limit: 1, period: "none", soft_limit: false, status: "draft" },
      mtr_api_calls: { key: "api_calls", name: "API calls", description: "The provider's copy of a key this app uses.", type: "metered", default_limit: 10000, period: "monthly", soft_limit: false, status: "active" },
    },
    subscriptions: {
      sub_1Stark: providerSub("stark", "plan_starter"),
      sub_1Wonka: providerSub("wonka", "plan_pro", { quantity: { seats: 2 } }),
      sub_1Orphan: providerSub("stark", "plan_retired"),
      sub_1Retired: providerSub("stark", "plan_enterprise"),
      // Half a period, and a period that runs backwards: both refused, never defaulted.
      sub_1NoEnd: providerSub("stark", "plan_starter", { current_period_end: undefined }),
      sub_1Backwards: providerSub("stark", "plan_starter", { current_period_start: iso(periodEnd), current_period_end: iso(periodStart) }),
    },
    invoices: {
      in_1AcmeA: providerInvoice(190, 160),
      in_1AcmeB: providerInvoice(220, 190),
      in_1Orphan: providerInvoice(250, 220, { subscription_id: "sub_retired" }),
      in_1BadTotals: providerInvoice(280, 250, { total: money(100) }),
      // A line of a type the engine never writes is refused: the dashboard groups lines by six types, so it would count toward the subtotal and appear on no page.
      in_1OddLine: providerInvoice(310, 280, { line_items: providerLines((l, i) => (i === 1 ? { ...l, type: "subscription" } : l)) }),
      in_1BlankLine: providerInvoice(340, 310, { line_items: providerLines((l, i) => (i === 0 ? { ...l, type: "" } : l)) }),
    },
  }

  return state
}

let ledger = seedLedgerState()

/** Restores the seed. server.mjs calls this from its _fixture/reset. */
export function resetLedger() {
  ledger = seedLedgerState()
}

/** The helpers every handler group shares. Built once per createLedgerHandlers. */
export function makeHelpers(FixtureError) {
  const badRequest = (message) => new FixtureError(400, "BAD_REQUEST", message)
  const notFound = (what) => new FixtureError(404, "NOT_FOUND", `${what} not found`)
  const conflict = (message) => new FixtureError(409, "CONFLICT", message)
  const permissionDenied = (message) => new FixtureError(403, "PERMISSION_DENIED", message)
  const unavailable = (message) => new FixtureError(503, "UNAVAILABLE", message)

  /** The resolved app: APP_ID, or "" when the no-app switch is on. */
  const currentApp = () => (process.env.LEDGER_FIXTURE_NO_APP === "1" ? "" : APP_ID)
  const providerConfigured = () => process.env.LEDGER_FIXTURE_NO_PROVIDER !== "1"

  /** The binder's refusal for an app-scoped intent reached with no app. */
  function requireApp() {
    const app = currentApp()
    if (app === "") {
      throw permissionDenied("no app selected: set the extension's app_id or send an app_id claim")
    }
    return app
  }

  const text = (raw) => (typeof raw === "string" ? raw.trim() : "")
  function requireText(raw, field) {
    const value = text(raw)
    if (value === "") throw badRequest(`${field} is required`)
    return value
  }
  const wholeNumber = (raw) => (typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0)

  /** PageInput.window plus pageFrom: default 50, max 200, offset < 0 is 0. */
  function page(rows, input) {
    let limit = wholeNumber(input?.limit)
    if (limit <= 0) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT
    let offset = wholeNumber(input?.offset)
    if (offset < 0) offset = 0
    const window = rows.slice(offset, offset + limit + 1)
    return { items: window.slice(0, limit).map(clone), limit, offset, has_more: window.length > limit }
  }

  /** The prefix each entity's id carries (ledger/id/id.go). */
  const ID_PREFIX = { plan: "plan", subscription: "sub", invoice: "inv", coupon: "cpn", feature: "feat" }

  /**
   * A required id field, as the contract's parseID reads it: BAD_REQUEST
   * naming the field when it is missing, truncated or carries another entity's
   * prefix. Go also parses the typeid suffix; the fixture's seeded ids are
   * short, so it checks the prefix and that something follows it.
   */
  function parseId(rawId, field, what) {
    const id = requireText(rawId, field)
    const prefix = ID_PREFIX[what]
    if (!id.startsWith(`${prefix}_`) || id.length === prefix.length + 1) throw badRequest(`${field} is not a valid id: ${id}`)
    return id
  }

  /** Loads a row the app owns, or answers NOT_FOUND exactly as for an unknown id. */
  function owned(list, rawId, field, what) {
    const app = requireApp()
    const id = parseId(rawId, field, what)
    const row = list.find((r) => r.id === id)
    if (!row || row.app_id !== app) throw notFound(what)
    return row
  }

  /** An optional RFC3339 instant, as milliseconds, or undefined when absent. */
  function optionalTime(raw, field) {
    if (raw === undefined || raw === null || raw === "") return undefined
    const ms = typeof raw === "string" ? Date.parse(raw) : Number.NaN
    if (Number.isNaN(ms)) throw badRequest(`${field} must be an RFC3339 timestamp`)
    return ms
  }

  /** A money input {amount, currency} in the given currency. */
  function moneyInput(raw, currency, field) {
    if (raw === undefined || raw === null) return money(0, currency)
    const amount = raw.amount
    if (typeof amount !== "number" || !Number.isInteger(amount)) throw badRequest(`${field} must be a whole number of minor units`)
    const given = text(raw.currency).toLowerCase()
    if (given !== "" && given !== currency.toLowerCase()) throw badRequest(`${field} must be in ${currency}`)
    return money(amount, currency)
  }

  /**
   * The sync every syncToProvider shares. No provider is UNAVAILABLE; a refusal
   * is a normal answer with success false and the provider's message, which
   * is how the contract hands it back.
   */
  function syncRow(row, entityType, refusal) {
    if (!providerConfigured()) throw unavailable("no payment provider is configured")
    const base = { provider_name: PROVIDER, provider_id: row.provider_id ?? "", entity_type: entityType, entity_id: row.id, direction: "push", success: true }
    if (refusal) return { ...base, success: false, error: `${PROVIDER} refused the sync: ${refusal}` }
    row.provider_name = PROVIDER
    row.provider_id = row.provider_id || `${PROVIDER}_${row.id}`
    row.updated_at = iso(Date.now())
    return { ...base, provider_id: row.provider_id }
  }

  /**
   * The provider half every importFromProvider shares, in the order Go runs
   * it: the handler refuses a blank provider_id, the engine refuses no
   * provider or an unknown provider name (UNAVAILABLE), the provider refuses
   * an id it does not hold (ErrProviderSync, also UNAVAILABLE, in the
   * provider's words), and ImportInto refuses a record the provider files under
   * another app as not found. Answers the provider id and a fresh copy of the
   * provider's record.
   */
  function fromProvider(input, noun, catalog, app) {
    const pid = requireText(input?.provider_id, "provider_id")
    if (!providerConfigured()) throw unavailable("ledger: provider not configured")
    const name = text(input?.provider_name)
    if (name !== "" && name !== PROVIDER) throw unavailable(`ledger: provider not found: ${name}`)
    const record = catalog[pid]
    if (!record) throw unavailable(`ledger: provider sync failed: import ${noun}: ${PROVIDER} has no ${noun} ${pid}`)
    if (record.app_id && record.app_id !== app) throw new FixtureError(404, "NOT_FOUND", `ledger: ${noun} not found: provider id "${pid}"`)
    return { pid, record: clone(record) }
  }

  return {
    badRequest, notFound, conflict, permissionDenied, unavailable, currentApp, providerConfigured, requireApp,
    text, requireText, parseId, wholeNumber, page, owned, optionalTime, moneyInput, syncRow, fromProvider,
  }
}

function catalogHandlers(h) {
  const { badRequest, notFound, conflict, permissionDenied, currentApp, providerConfigured, requireApp, text, requireText, parseId, wholeNumber, page, owned, optionalTime, moneyInput, syncRow, fromProvider } = h

  function planFeatures(raw, stamp) {
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw)) throw badRequest("features must be a list")
    const seen = new Set()
    return raw.map((f) => {
      const key = requireText(f?.key, "feature key")
      if (seen.has(key)) throw badRequest(`duplicate feature key "${key}"`)
      seen.add(key)
      const type = text(f?.type)
      if (!FEATURE_TYPES.includes(type)) throw badRequest(`feature ${key}: unknown type "${f?.type ?? ""}"`)
      const limit = wholeNumber(f?.limit)
      if (limit < -1) throw badRequest(`feature ${key}: limit must be -1 for unlimited, or 0 and above`)
      const period = text(f?.period) || "none"
      if (!PERIODS.includes(period)) throw badRequest(`feature ${key}: unknown period "${period}"`)
      return { id: text(f?.id) || ledger.nextId("pfeat"), key, name: text(f?.name) || key, type, limit, period, soft_limit: f?.soft_limit === true, created_at: stamp, updated_at: stamp }
    })
  }

  function planPricing(raw, planId, currency, features, stamp) {
    if (raw === undefined || raw === null) return undefined
    const base = moneyInput(raw.base_amount, currency, "base amount")
    if (base.amount < 0) throw badRequest("base amount must not be negative")
    const period = text(raw.billing_period) || "monthly"
    if (!PERIODS.includes(period) || period === "none") throw badRequest(`unknown billing period "${period}"`)
    const tiers = (Array.isArray(raw.tiers) ? raw.tiers : []).map((t) => {
      const featureKey = requireText(t?.feature_key, "tier feature")
      if (!features.some((f) => f.key === featureKey)) throw badRequest(`a tier names "${featureKey}", which is not one of this plan's features`)
      const type = text(t?.type)
      if (!TIER_TYPES.includes(type)) throw badRequest(`tier for ${featureKey}: unknown type "${t?.type ?? ""}"`)
      const upTo = wholeNumber(t?.up_to)
      if (upTo < -1 || upTo === 0) throw badRequest(`tier for ${featureKey}: up_to must be -1 for no upper bound, or 1 and above`)
      return { feature_key: featureKey, type, up_to: upTo, unit_amount: moneyInput(t?.unit_amount, currency, "unit amount"), flat_amount: moneyInput(t?.flat_amount, currency, "flat amount"), priority: wholeNumber(t?.priority) }
    })
    return { id: text(raw.id) || ledger.nextId("price"), plan_id: planId, base_amount: base, billing_period: period, ...(tiers.length ? { tiers } : {}), created_at: stamp, updated_at: stamp }
  }

  const invalid = (message) => badRequest(`ledger: invalid input: ${message}`)

  /**
   * normalisePlan then validatePlan (plan_write.go), as CreatePlan runs them on
   * an import. Answers the normalised copy of the provider's plan.
   */
  function importedPlan(record) {
    const p = { ...record, name: text(record.name), slug: text(record.slug), currency: text(record.currency).toLowerCase() }
    p.status = text(record.status) || "draft"
    p.features = Array.isArray(record.features) ? record.features : []
    if (record.pricing) {
      const base = record.pricing.base_amount ?? { amount: 0 }
      const code = text(base.currency).toLowerCase() || p.currency
      p.pricing = { ...record.pricing, base_amount: { ...base, currency: code } }
    }
    if (p.name === "") throw invalid("a plan needs a name")
    if (p.slug === "") throw invalid("a plan needs a slug")
    if (p.currency === "") throw invalid("a plan needs a currency")
    if (!PLAN_STATUSES.includes(p.status)) throw invalid(`unknown plan status ${q(p.status)}`)
    if (wholeNumber(p.trial_days) < 0) throw invalid("trial days cannot be negative")
    const keys = new Set()
    for (const f of p.features) {
      if (text(f.key) === "") throw invalid("every plan feature needs a key")
      if (keys.has(f.key)) throw badRequest(`ledger: duplicate feature key: ${q(f.key)}`)
      keys.add(f.key)
      if (!FEATURE_TYPES.includes(f.type)) throw invalid(`feature ${q(f.key)} has unknown type ${q(f.type)}`)
      const period = f.period ?? ""
      if (period !== "" && !PERIODS.includes(period)) throw invalid(`feature ${q(f.key)} has unknown period ${q(period)}`)
      if (wholeNumber(f.limit) < -1) throw invalid(`feature ${q(f.key)} has limit ${wholeNumber(f.limit)}; use -1 for unlimited`)
    }
    if (!p.pricing) return p
    const pricingError = (message) => badRequest(`ledger: invalid pricing configuration: ${message}`)
    const base = p.pricing.base_amount
    if (wholeNumber(base.amount) < 0) throw pricingError("the base price cannot be negative")
    if (base.currency !== p.currency) throw pricingError(`the base price is in ${base.currency} but the plan bills in ${p.currency}`)
    const byFeature = new Map()
    for (const t of p.pricing.tiers ?? []) {
      if (!keys.has(t.feature_key)) throw pricingError(`a tier prices feature ${q(t.feature_key)}, which the plan does not have`)
      byFeature.set(t.feature_key, [...(byFeature.get(t.feature_key) ?? []), t])
    }
    for (const [key, tiers] of byFeature) validateTiers(key, tiers, p.currency)
    return p
  }

  /** invoice.ValidateTiers, for one feature's ladder. */
  function validateTiers(featureKey, tiers, currency) {
    const wantType = tiers[0].type
    const wantKey = tiers[0].feature_key
    const seen = new Set()
    tiers.forEach((t, idx) => {
      const at = `tier ${idx} (UpTo ${wholeNumber(t.up_to)}, feature ${q(t.feature_key)})`
      const fail = (message) => badRequest(`feature ${q(featureKey)}: invoice: invalid price tiers: ${at} ${message}`)
      if (t.type !== wantType) throw fail(`mixes types ${q(wantType)} and ${q(t.type)}`)
      if (!TIER_TYPES.includes(t.type)) throw fail(`has invalid type ${q(t.type)}`)
      const unit = t.unit_amount ?? { amount: 0, currency: "" }
      const flat = t.flat_amount ?? { amount: 0, currency: "" }
      if (text(unit.currency) !== "" && text(unit.currency).toLowerCase() !== currency) throw fail(`unit amount currency ${q(unit.currency)} does not match ${q(currency)}`)
      if (text(flat.currency) !== "" && text(flat.currency).toLowerCase() !== currency) throw fail(`flat amount currency ${q(flat.currency)} does not match ${q(currency)}`)
      if (wholeNumber(unit.amount) < 0) throw fail(`has a negative unit amount ${wholeNumber(unit.amount)}`)
      if (wholeNumber(flat.amount) < 0) throw fail(`has a negative flat amount ${wholeNumber(flat.amount)}`)
      if (t.feature_key !== wantKey) throw fail(`does not match feature key ${q(wantKey)}`)
      const upTo = wholeNumber(t.up_to)
      const bucket = upTo <= 0 ? 0 : upTo
      if (seen.has(bucket)) throw fail("duplicates another tier's UpTo")
      seen.add(bucket)
      if (t.type !== "flat" && wholeNumber(flat.amount) !== 0) throw fail(`is ${t.type} but carries a non-zero flat amount`)
      if (t.type === "flat" && wholeNumber(unit.amount) !== 0) throw fail("is flat but carries a non-zero unit amount")
    })
  }

  const slugTaken = (app, slug, exceptId) => ledger.plans.some((p) => p.app_id === app && p.slug === slug && p.id !== exceptId)

  const canRead = (row) => row.app_id === currentApp() || row.app_id === ""
  function readableFeature(rawId) {
    const id = parseId(rawId, "id", "feature")
    const row = ledger.features.find((f) => f.id === id)
    if (!row || !canRead(row)) throw notFound("feature")
    return row
  }
  function writableFeature(rawId) {
    const id = parseId(rawId, "id", "feature")
    const row = ledger.features.find((f) => f.id === id)
    if (!row) throw notFound("feature")
    if (row.app_id !== currentApp()) {
      // A shared feature is readable from an app, so its existence is no secret: the refusal says why.
      // Another app's feature stays NOT_FOUND.
      if (row.app_id === "") throw permissionDenied("shared features can be changed only with no app selected")
      throw notFound("feature")
    }
    return row
  }

  function couponWindow(fromMs, untilMs) {
    if (fromMs !== undefined && untilMs !== undefined && untilMs < fromMs) throw badRequest("valid_until is before valid_from")
  }

  return {
    "plans.list": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const status = text(input?.status)
        if (status !== "" && !PLAN_STATUSES.includes(status)) throw badRequest(`unknown plan status "${status}"`)
        const rows = ledger.plans.filter((p) => p.app_id === app && (status === "" || p.status === status)).sort(oldestFirst)
        return page(rows, input)
      },
    },

    "plans.detail": {
      kind: "query",
      handler: (input) => clone(owned(ledger.plans, input?.id, "id", "plan")),
    },

    "plans.create": {
      kind: "command",
      invalidates: ["plans.list", "overview.stats"],
      handler: (input) => {
        const app = requireApp()
        const name = requireText(input?.name, "name")
        const slug = requireText(input?.slug, "slug")
        const currency = requireText(input?.currency, "currency").toLowerCase()
        const trialDays = wholeNumber(input?.trial_days)
        if (trialDays < 0) throw badRequest("trial_days must not be negative")
        if (slugTaken(app, slug)) throw conflict(`a plan with the slug "${slug}" already exists`)
        const stamp = iso(Date.now())
        const id = ledger.nextId("plan")
        const features = planFeatures(input?.features, stamp)
        const pricing = planPricing(input?.pricing, id, currency, features, stamp)
        const row = { id, name, slug, description: text(input?.description), currency, status: "draft", trial_days: trialDays, features, ...(pricing ? { pricing } : {}), app_id: app, created_at: stamp, updated_at: stamp }
        if (input?.metadata && typeof input.metadata === "object") row.metadata = { ...input.metadata }
        ledger.plans.push(row)
        return clone(row)
      },
    },

    "plans.update": {
      kind: "command",
      invalidates: ["plans.list", "plans.detail", "subscriptions.detail", "subscriptions.usage", "entitlements.check"],
      handler: (input) => {
        const row = owned(ledger.plans, input?.id, "id", "plan")
        const stamp = iso(Date.now())
        // A JSON null is "leave alone" for every field, as Go's pointer fields
        // decode it, so presence is `!= null` throughout.
        // Everything is checked before anything is written, so a refusal
        // leaves the stored plan exactly as it was.
        const next = { ...row }
        if (input.name != null) next.name = requireText(input.name, "name")
        if (input.slug != null) {
          next.slug = requireText(input.slug, "slug")
          if (slugTaken(row.app_id, next.slug, row.id)) throw conflict(`a plan with the slug "${next.slug}" already exists`)
        }
        if (input.description != null) next.description = text(input.description)
        if (input.currency != null && text(input.currency).toLowerCase() !== row.currency) throw badRequest("a plan's currency cannot change")
        if (input.trial_days != null) {
          next.trial_days = wholeNumber(input.trial_days)
          if (next.trial_days < 0) throw badRequest("trial_days must not be negative")
        }
        if (input.features != null) next.features = planFeatures(input.features, stamp)
        if (input.pricing != null) {
          const pricing = planPricing(input.pricing, row.id, row.currency, next.features, stamp)
          next.pricing = pricing
        }
        if (input.metadata != null) next.metadata = { ...input.metadata }
        next.updated_at = stamp
        Object.assign(row, next)
        return clone(row)
      },
    },

    "plans.archive": {
      kind: "command",
      invalidates: ["plans.list", "plans.detail", "overview.stats", "subscriptions.detail"],
      handler: (input) => {
        const row = owned(ledger.plans, input?.id, "id", "plan")
        row.status = "archived"
        row.updated_at = iso(Date.now())
        return { ok: true }
      },
    },

    "plans.activate": {
      kind: "command",
      invalidates: ["plans.list", "plans.detail", "overview.stats", "subscriptions.detail"],
      handler: (input) => {
        const row = owned(ledger.plans, input?.id, "id", "plan")
        row.status = "active"
        row.updated_at = iso(Date.now())
        return { ok: true }
      },
    },

    "plans.delete": {
      kind: "command",
      invalidates: ["plans.list", "overview.stats"],
      handler: (input) => {
        const row = owned(ledger.plans, input?.id, "id", "plan")
        const inUse = ledger.subscriptions.filter((s) => s.plan_id === row.id).length
        if (inUse > 0) throw conflict(`plan is in use by ${inUse} subscription${inUse === 1 ? "" : "s"}; archive it instead`)
        ledger.plans = ledger.plans.filter((p) => p.id !== row.id)
        return { ok: true }
      },
    },

    "plans.syncToProvider": {
      kind: "command",
      invalidates: ["plans.detail"],
      handler: (input) => {
        const row = owned(ledger.plans, input?.id, "id", "plan")
        return syncRow(row, "plan", row.status === "archived" ? "the plan is archived" : undefined)
      },
    },

    "plans.importFromProvider": {
      kind: "command",
      invalidates: ["plans.list", "overview.stats"],
      handler: (input) => {
        const app = requireApp()
        const { pid, record } = fromProvider(input, "plan", ledger.provider.plans, app)
        // Go imports through CreatePlan: it normalises and validates the plan,
        // then refuses a slug the app uses.
        const normal = importedPlan(record)
        if (slugTaken(app, normal.slug)) throw conflict(`ledger: already exists: slug ${q(normal.slug)} is already used in this app`)
        const stamp = iso(Date.now())
        const id = ledger.nextId("plan")
        const row = { ...normal, id, app_id: app, provider_id: pid, provider_name: PROVIDER, created_at: stamp, updated_at: stamp }
        row.features = normal.features.map((f, i) => ({ ...f, id: f.id || `pf_${id}_${i + 1}`, created_at: stamp, updated_at: stamp }))
        if (normal.pricing) {
          const base = normal.pricing.base_amount
          row.pricing = { ...normal.pricing, base_amount: money(wholeNumber(base.amount), base.currency), id: normal.pricing.id || `price_${id}`, plan_id: id, created_at: stamp, updated_at: stamp }
        }
        ledger.plans.push(row)
        return clone(row)
      },
    },

    "features.list": {
      kind: "query",
      handler: (input) => {
        const app = currentApp()
        const status = text(input?.status)
        if (status !== "" && !FEATURE_STATUSES.includes(status)) throw badRequest(`unknown feature status "${status}"`)
        // From an empty scope only the shared catalog exists.
        const global = input?.global === true || app === ""
        const rows = ledger.features
          .filter((f) => (global ? f.app_id === "" : f.app_id === app) && (status === "" || f.status === status))
          .sort(oldestFirst)
        return page(rows, input)
      },
    },

    "features.detail": {
      kind: "query",
      handler: (input) => clone(readableFeature(input?.id)),
    },

    "features.create": {
      kind: "command",
      invalidates: ["features.list"],
      handler: (input) => {
        const app = currentApp()
        const key = requireText(input?.key, "key")
        const type = text(input?.type)
        if (!FEATURE_TYPES.includes(type)) throw badRequest(`unknown feature type "${input?.type ?? ""}"`)
        const defaultLimit = wholeNumber(input?.default_limit)
        if (defaultLimit < -1) throw badRequest("default_limit must be -1 for unlimited, or 0 and above")
        const period = text(input?.period) || "none"
        if (!PERIODS.includes(period)) throw badRequest(`unknown period "${period}"`)
        if (ledger.features.some((f) => f.app_id === app && f.key === key)) throw conflict(`a feature with the key "${key}" already exists`)
        const stamp = iso(Date.now())
        const row = { id: ledger.nextId("feat"), key, name: text(input?.name) || key, description: text(input?.description), type, default_limit: defaultLimit, period, soft_limit: input?.soft_limit === true, status: "active", app_id: app, created_at: stamp, updated_at: stamp }
        if (input?.metadata && typeof input.metadata === "object") row.metadata = { ...input.metadata }
        ledger.features.push(row)
        return clone(row)
      },
    },

    "features.update": {
      kind: "command",
      invalidates: ["features.list", "features.detail"],
      handler: (input) => {
        const row = writableFeature(input?.id)
        const next = { ...row }
        if (input.name != null) next.name = requireText(input.name, "name")
        if (input.description != null) next.description = text(input.description)
        if (input.default_limit != null) {
          next.default_limit = wholeNumber(input.default_limit)
          if (next.default_limit < -1) throw badRequest("default_limit must be -1 for unlimited, or 0 and above")
        }
        if (input.period != null) {
          next.period = text(input.period)
          if (!PERIODS.includes(next.period)) throw badRequest(`unknown period "${next.period}"`)
        }
        if (input.soft_limit != null) next.soft_limit = input.soft_limit === true
        if (input.metadata != null) next.metadata = { ...input.metadata }
        next.updated_at = iso(Date.now())
        Object.assign(row, next)
        return clone(row)
      },
    },

    "features.archive": {
      kind: "command",
      invalidates: ["features.list", "features.detail"],
      handler: (input) => {
        const row = writableFeature(input?.id)
        row.status = "archived"
        row.updated_at = iso(Date.now())
        return { ok: true }
      },
    },

    "features.delete": {
      kind: "command",
      invalidates: ["features.list"],
      handler: (input) => {
        const row = writableFeature(input?.id)
        ledger.features = ledger.features.filter((f) => f.id !== row.id)
        return { ok: true }
      },
    },

    "features.syncToProvider": {
      kind: "command",
      invalidates: ["features.detail"],
      handler: (input) => {
        const row = writableFeature(input?.id)
        return syncRow(row, "feature", row.status === "archived" ? "the feature is archived" : undefined)
      },
    },

    "features.importFromProvider": {
      kind: "command",
      invalidates: ["features.list"],
      handler: (input) => {
        // As features.create: the empty scope imports into the shared catalog.
        const app = currentApp()
        const { pid, record } = fromProvider(input, "feature", ledger.provider.features, app)
        // ledger.ValidateFeature, then the import's own status rule.
        const key = text(record.key)
        if (key === "") throw invalid("a feature needs a key")
        if (!FEATURE_TYPES.includes(record.type)) throw invalid(`unknown feature type ${q(record.type)}`)
        const period = record.period ?? ""
        if (period !== "" && !PERIODS.includes(period)) throw invalid(`unknown feature period ${q(period)}`)
        if (wholeNumber(record.default_limit) < -1) throw invalid(`default_limit ${wholeNumber(record.default_limit)} is below -1; use -1 for unlimited`)
        const status = text(record.status) === "" ? "active" : record.status
        if (status !== "active" && status !== "archived") throw invalid(`a feature imports as active or archived, not ${q(status)}`)
        const existing = ledger.features.find((f) => f.app_id === app && f.key === key)
        if (existing) throw conflict(`ledger: already exists: feature key ${q(key)} is already used by ${existing.id}`)
        const stamp = iso(Date.now())
        const row = { ...record, key, id: ledger.nextId("feat"), status, app_id: app, provider_id: pid, provider_name: PROVIDER, created_at: stamp, updated_at: stamp }
        ledger.features.push(row)
        return clone(row)
      },
    },

    "coupons.list": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const nowMs = Date.now()
        const rows = ledger.coupons
          .filter((c) => c.app_id === app && (input?.active !== true || inValidityWindow(c, nowMs)))
          .sort(newestFirst)
        return page(rows, input)
      },
    },

    "coupons.detail": {
      kind: "query",
      handler: (input) => clone(owned(ledger.coupons, input?.id, "id", "coupon")),
    },

    "coupons.create": {
      kind: "command",
      invalidates: ["coupons.list", "overview.stats"],
      handler: (input) => {
        const app = requireApp()
        const code = requireText(input?.code, "code")
        const type = text(input?.type)
        if (type !== "percentage" && type !== "amount") throw badRequest(`unknown coupon type "${input?.type ?? ""}"`)
        // A percentage coupon may carry no currency and then applies to a plan in any currency; an amount coupon's money needs one.
        const currency = type === "amount" ? requireText(input?.currency, "currency").toLowerCase() : text(input?.currency).toLowerCase()
        // Zero or less means unlimited, the same rule the engine's ApplyCoupon applies; it is stored as sent.
        const maxRedemptions = wholeNumber(input?.max_redemptions)
        const fromMs = optionalTime(input?.valid_from, "valid_from")
        const untilMs = optionalTime(input?.valid_until, "valid_until")
        couponWindow(fromMs, untilMs)
        let amount = money(0, currency)
        let percentage
        if (type === "percentage") {
          percentage = wholeNumber(input?.percentage)
          if (percentage < 0 || percentage > 100) throw badRequest("percentage must be between 0 and 100")
        } else {
          amount = moneyInput(input?.amount, currency, "amount")
          if (amount.amount < 0) throw badRequest("amount must not be negative")
        }
        if (ledger.coupons.some((c) => c.app_id === app && c.code === code)) throw conflict(`a coupon with the code "${code}" already exists`)
        const stamp = iso(Date.now())
        const row = { id: ledger.nextId("cpn"), code, name: text(input?.name), type, amount, currency, max_redemptions: maxRedemptions, times_redeemed: 0, app_id: app, created_at: stamp, updated_at: stamp }
        if (percentage !== undefined) row.percentage = percentage
        if (fromMs !== undefined) row.valid_from = iso(fromMs)
        if (untilMs !== undefined) row.valid_until = iso(untilMs)
        if (input?.metadata && typeof input.metadata === "object") row.metadata = { ...input.metadata }
        ledger.coupons.push(row)
        return clone(row)
      },
    },

    "coupons.update": {
      kind: "command",
      invalidates: ["coupons.list", "coupons.detail", "subscriptions.detail"],
      handler: (input) => {
        const row = owned(ledger.coupons, input?.id, "id", "coupon")
        const next = { ...row }
        if (input.name != null) next.name = text(input.name)
        if (input.max_redemptions != null) {
          // Zero or less means unlimited, as on create.
          next.max_redemptions = wholeNumber(input.max_redemptions)
        }
        // Nullable: an absent key leaves the bound alone, null clears it, a
        // value sets it. `in` is the only way to tell absent from null.
        for (const field of ["valid_from", "valid_until"]) {
          if (!(field in input)) continue
          if (input[field] === null) delete next[field]
          else next[field] = iso(optionalTime(input[field], field))
        }
        couponWindow(next.valid_from ? Date.parse(next.valid_from) : undefined, next.valid_until ? Date.parse(next.valid_until) : undefined)
        if (input.metadata != null) next.metadata = { ...input.metadata }
        next.updated_at = iso(Date.now())
        for (const key of Object.keys(row)) delete row[key]
        Object.assign(row, next)
        return clone(row)
      },
    },

    "coupons.delete": {
      kind: "command",
      invalidates: ["coupons.list", "subscriptions.detail", "overview.stats"],
      handler: (input) => {
        const row = owned(ledger.coupons, input?.id, "id", "coupon")
        ledger.coupons = ledger.coupons.filter((c) => c.id !== row.id)
        ledger.applied = ledger.applied.filter((a) => a.coupon_id !== row.id)
        return { ok: true }
      },
    },

    "coupons.apply": {
      kind: "command",
      invalidates: ["coupons.list", "coupons.detail", "subscriptions.detail"],
      handler: (input) => {
        const sub = owned(ledger.subscriptions, input?.subscription_id, "subscription_id", "subscription")
        const code = requireText(input?.code, "code")
        const coupon = ledger.coupons.find((c) => c.app_id === sub.app_id && c.code === code)
        if (!coupon) throw notFound("coupon")
        const state = couponState(coupon)
        if (state === "scheduled") throw badRequest("coupon is not valid yet")
        if (state === "expired") throw badRequest("coupon has expired")
        if (state === "exhausted") throw conflict("coupon has reached its redemption limit")
        if (ledger.applied.some((a) => a.subscription_id === sub.id && a.coupon_id === coupon.id)) throw conflict("coupon is already applied to this subscription")
        coupon.times_redeemed += 1
        coupon.updated_at = iso(Date.now())
        ledger.applied.push({ subscription_id: sub.id, coupon_id: coupon.id, applied_at: iso(Date.now()) })
        return clone(coupon)
      },
    },

    "overview.stats": {
      kind: "query",
      handler: () => {
        const app = requireApp()
        const plans = ledger.plans.filter((p) => p.app_id === app)
        const byStatus = {}
        for (const s of ledger.subscriptions.filter((s) => s.app_id === app)) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1
        return {
          plans: plans.length,
          active_plans: plans.filter((p) => p.status === "active").length,
          subscriptions_by_status: byStatus,
          pending_invoices: ledger.invoices.filter((i) => i.app_id === app && i.status === "pending").length,
          past_due_invoices: ledger.invoices.filter((i) => i.app_id === app && i.status === "past_due").length,
          coupons: ledger.coupons.filter((c) => c.app_id === app).length,
          capped: false,
        }
      },
    },

    "overview.recentInvoices": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        let limit = wholeNumber(input?.limit)
        if (limit <= 0) limit = RECENT_DEFAULT
        if (limit > RECENT_MAX) limit = RECENT_MAX
        return ledger.invoices.filter((i) => i.app_id === app).sort(newestFirst).slice(0, limit).map(clone)
      },
    },

    "settings.detail": {
      kind: "query",
      handler: () => ({
        meter_batch_size: 100,
        meter_flush_interval: "5s",
        entitlement_cache_ttl: "1m0s",
        // The fixture has no lifecycle clock: nothing here advances a period,
        // ends a trial, enacts a cancel or marks an invoice past due. Say so,
        // as the engine does for a clock that is disabled. Reporting an
        // interval would tell the dashboard a clock is coming that never will.
        lifecycle_interval: "off",
        app_id: currentApp(),
        require_app_claim: false,
        providers: providerConfigured() ? [PROVIDER] : [],
        invoice_formats: [...EXPORT_FORMATS],
      }),
    },
  }
}

/** Days in a UTC month. */
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/**
 * As the engine's shiftMonths in lifecycle.go: the time months after ms
 * (before it, when negative), on day, clamped to that month's last day, at
 * the same time of day, in UTC.
 */
function shiftMonths(ms, months, day) {
  const d = new Date(ms)
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const y = first.getUTCFullYear()
  const m = first.getUTCMonth()
  return Date.UTC(y, m, Math.min(day, daysIn(y, m)), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
}

/** As the engine's anchorDay: the end's day, unless a short month clamped it. */
function anchorDay(startMs, endMs) {
  const s = new Date(startMs)
  const e = new Date(endMs)
  const d = e.getUTCDate()
  return d === daysIn(e.getUTCFullYear(), e.getUTCMonth()) && s.getUTCDate() > d ? s.getUTCDate() : d
}

/** As the engine's firstPeriodEnd: one month on (twelve for yearly), on the start's day. */
function firstPeriodEnd(startMs, billingPeriod) {
  return shiftMonths(startMs, billingPeriod === "yearly" ? 12 : 1, new Date(startMs).getUTCDate())
}

/**
 * As the engine's clampedFirstStart: where a subscription's first period
 * started when it began on a day the month it ended in does not have, a yearly
 * subscription created on 29 February whose first period ends on the 28th.
 * Undefined unless endMs falls on a month's last day and the creation day is
 * later than it. The start is the creation day one period before the end, and
 * it must land on the creation date.
 */
function clampedFirstStart(sub, months, endMs) {
  // The cycle began at creation, or at the last resume, which restarted it.
  const created = new Date(sub.resumed_at ?? sub.created_at)
  const end = new Date(endMs)
  if (end.getUTCDate() !== daysIn(end.getUTCFullYear(), end.getUTCMonth()) || created.getUTCDate() <= end.getUTCDate()) return undefined
  const first = shiftMonths(endMs, -months, created.getUTCDate())
  const f = new Date(first)
  const sameDay = f.getUTCFullYear() === created.getUTCFullYear() && f.getUTCMonth() === created.getUTCMonth() && f.getUTCDate() === created.getUTCDate()
  return first < endMs && sameDay ? first : undefined
}

/**
 * As the engine's resumeOf in subscription_write.go: what resuming sub at nowMs
 * writes. The cycle restarts, so the period runs from now for one billing
 * period of the plan, on the arithmetic of a new subscription's first period.
 * The subscription resumes trialing if trial_end is after paused_at (after now
 * when there is no paused_at), otherwise active, and a trialing resume moves
 * trial_end on by now minus paused_at. resumed_at is now. The caller clears
 * paused_at. Times are the whole-second stamps the fixture writes, so the
 * period start, resumed_at and the shifted trial end agree with each other.
 */
function resumeOf(sub, p, nowMs) {
  const now = Date.parse(iso(nowMs))
  const out = {
    status: "active",
    current_period_start: iso(now),
    current_period_end: iso(firstPeriodEnd(now, p.pricing?.billing_period)),
    resumed_at: iso(now),
  }
  if (!sub.trial_end) return out
  const pauseStart = sub.paused_at ? Date.parse(sub.paused_at) : now
  const trialEnd = Date.parse(sub.trial_end)
  if (!(trialEnd > pauseStart)) return out
  out.status = "trialing"
  if (now > pauseStart) out.trial_end = iso(trialEnd + (now - pauseStart))
  return out
}

function billingHandlers(h) {
  const { badRequest, notFound, conflict, providerConfigured, requireApp, text, requireText, parseId, page, owned, optionalTime, syncRow, fromProvider } = h
  const SUB_STATUSES = ["active", "trialing", "past_due", "canceled", "expired", "paused"]
  const INVOICE_STATUSES = ["draft", "pending", "paid", "past_due", "voided"]
  const ENDED = new Set(["canceled", "expired"])

  function subscribablePlan(rawId, app) {
    const id = parseId(rawId, "plan_id", "plan")
    const p = ledger.plans.find((x) => x.id === id)
    if (!p) throw notFound("plan")
    // The contract's loadPlan refuses another app's plan as not found before the engine's active check runs.
    if (p.app_id !== app) throw notFound("plan")
    if (p.status !== "active") throw badRequest(`plan "${p.slug}" is ${p.status}, not active`)
    return p
  }

  /** quantity: an object of seat-feature keys to whole, non-negative counts. */
  function checkQuantity(raw, p) {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("quantity must map feature keys to counts")
    const out = {}
    for (const [key, value] of Object.entries(raw)) {
      const feature = p.features.find((f) => f.key === key)
      if (!feature || feature.type !== "seat") throw badRequest(`quantity names "${key}", which is not a seat feature of this plan`)
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw badRequest(`quantity for ${key} must be a whole number, 0 or more`)
      out[key] = value
    }
    return out
  }

  /** The store's calendar window for a period: this UTC month, this UTC year, or all time. */
  function periodStart(period, nowMs) {
    const d = new Date(nowMs)
    if (period === "monthly") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    if (period === "yearly") return Date.UTC(d.getUTCFullYear(), 0, 1)
    return 0
  }
  /**
   * A period's usage from its own events, as the engine's usageWindow and
   * usageInPeriod: [start, min(end, now)). A period that has ended counts to
   * its end, the running one to now, and a window that is empty counts nothing.
   * The current period and a named one take this same path.
   */
  function billedUsage(sub, key, startMs, endMs) {
    const to = Math.min(endMs, Date.now())
    if (!(to > startMs)) return 0
    return ledger.events
      .filter((e) => e.tenant_id === sub.tenant_id && e.app_id === sub.app_id && e.feature_key === key)
      .filter((e) => {
        const t = Date.parse(e.timestamp)
        return t >= startMs && t < to
      })
      .reduce((sum, e) => sum + e.quantity, 0)
  }

  /**
   * The period invoices.generate bills, as the engine's namedPeriod and
   * periodBelongsTo in invoice_period.go: the current period, unless
   * period_start and period_end both name one the subscription had, including
   * the engine's yearly 29 February branch (clampedFirstStart and reproduces),
   * so a yearly plan anchored on 29 February accepts its real first period and
   * refuses the phantom one.
   */
  function billedPeriod(sub, p, input) {
    const current = { startMs: Date.parse(sub.current_period_start), endMs: Date.parse(sub.current_period_end), named: false }
    const hasStart = input?.period_start != null
    const hasEnd = input?.period_end != null
    if (!hasStart && !hasEnd) return current
    if (!hasStart || !hasEnd) throw badRequest("period_start and period_end go together")
    const startMs = Date.parse(input.period_start)
    const endMs = Date.parse(input.period_end)
    if (Number.isNaN(startMs)) throw badRequest("period_start must be an RFC3339 timestamp")
    if (Number.isNaN(endMs)) throw badRequest("period_end must be an RFC3339 timestamp")
    if (startMs === current.startMs && endMs === current.endMs) return current
    const refuse = () => badRequest(`ledger: invalid input: subscription ${sub.id} had no billing period from ${iso(startMs)} to ${iso(endMs)}`)
    if (!(startMs < endMs) || startMs > Date.now() || !(endMs > Date.parse(sub.created_at))) throw refuse()
    // A resume restarted the cycle: a period starting before it was spent
    // paused, or belongs to the cycle the pause ended.
    if (sub.resumed_at && startMs < Date.parse(sub.resumed_at)) throw refuse()
    const period = p.pricing?.billing_period || "monthly"
    if (period !== "monthly" && period !== "yearly") throw refuse()
    const months = period === "yearly" ? 12 : 1
    const day = anchorDay(current.startMs, current.endMs)
    let start = current.startMs
    let end = current.endMs
    for (let i = 0; i < 1200; i++) {
      if (start < endMs) throw refuse()
      if (start === endMs) {
        // A yearly plan loses its anchor where a year from 29 February lands
        // on the 28th, so the walk back cannot tell 29 February to 28 February
        // from 28 to 28. The creation day settles it: want is the first period
        // or it is not a period at all. A monthly plan recovers the anchor from
        // the period itself, so its walk is exact.
        const first = period === "yearly" ? clampedFirstStart(sub, months, endMs) : undefined
        if (first !== undefined) {
          // The period after want must be the one the walk is standing on.
          const reproduces = shiftMonths(endMs, months, anchorDay(startMs, endMs)) === end
          if (startMs === first && reproduces) return { startMs, endMs, named: true }
          throw refuse()
        }
        if (shiftMonths(start, -months, day) === startMs) return { startMs, endMs, named: true }
        throw refuse()
      }
      end = start
      start = shiftMonths(start, -months, day)
    }
    throw refuse()
  }

  function usedFor(tenant, app, key, period) {
    const nowMs = Date.now()
    const from = periodStart(period, nowMs)
    return ledger.events
      .filter((e) => e.tenant_id === tenant && e.app_id === app && e.feature_key === key)
      .filter((e) => {
        const t = Date.parse(e.timestamp)
        return t >= from && t <= nowMs
      })
      .reduce((sum, e) => sum + e.quantity, 0)
  }

  /** subscriptionsUsage: one row per plan feature, remaining -1 for unlimited or boolean. */
  function featureUsage(sub, p) {
    return p.features.map((f) => {
      const u = { key: f.key, name: f.name, type: f.type, period: f.period, limit: f.limit, used: 0, remaining: -1, soft_limit: f.soft_limit, over_limit: false, enabled: false }
      if (f.type === "metered") u.used = usedFor(sub.tenant_id, sub.app_id, f.key, f.period)
      if (f.type === "seat") u.used = sub.quantity?.[f.key] ?? 0
      if (f.type === "boolean") u.enabled = f.limit > 0
      if (f.type !== "boolean" && f.limit !== -1) {
        u.remaining = Math.max(0, f.limit - u.used)
        u.over_limit = u.used > f.limit
      }
      return u
    })
  }

  /** GetActiveSubscription: active or trialing, newest first. */
  function activeSubscription(tenant, app) {
    return ledger.subscriptions
      .filter((s) => s.tenant_id === tenant && s.app_id === app && (s.status === "active" || s.status === "trialing"))
      .sort(newestFirst)[0]
  }

  /** computeEntitlement, with no cache and no events. */
  function entitlement(tenant, app, key) {
    const refused = (reason) => ({ allowed: false, feature: key, used: 0, limit: 0, remaining: 0, soft_limit: false, reason })
    const sub = activeSubscription(tenant, app)
    if (!sub) return refused("no active subscription")
    const p = ledger.plans.find((x) => x.id === sub.plan_id)
    if (!p) return refused("plan not found")
    const f = p.features.find((x) => x.key === key)
    if (!f) return refused("feature not in plan")
    if (f.type === "boolean") {
      return { allowed: f.limit > 0, feature: key, used: 0, limit: f.limit, remaining: 0, soft_limit: false }
    }
    const used = f.type === "seat" ? sub.quantity?.[key] ?? 0 : usedFor(tenant, app, key, f.period)
    if (f.limit === -1) return { allowed: true, feature: key, used, limit: -1, remaining: -1, soft_limit: f.soft_limit }
    return {
      allowed: used < f.limit || f.soft_limit,
      feature: key,
      used,
      limit: f.limit,
      remaining: Math.max(0, f.limit - used),
      soft_limit: f.soft_limit,
      ...(used >= f.limit ? { reason: f.soft_limit ? "over soft limit" : "quota exceeded" } : {}),
    }
  }

  const loadSub = (raw, field = "id") => owned(ledger.subscriptions, raw, field, "subscription")
  const loadInvoice = (raw) => owned(ledger.invoices, raw, "id", "invoice")
  const withLines = (inv) => ({ ...clone(inv), line_items: clone(inv.line_items ?? []) })

  /** subscriptions.detail's answer for a stored subscription. */
  function subscriptionDetail(sub) {
    const p = ledger.plans.find((x) => x.id === sub.plan_id)
    if (!p) throw notFound("plan")
    const coupons = ledger.applied
      .filter((a) => a.subscription_id === sub.id)
      .map((a) => ledger.coupons.find((c) => c.id === a.coupon_id))
      .filter(Boolean)
      .map(clone)
    return { subscription: clone(sub), plan: { ...clone(p), features: clone(p.features ?? []) }, applied_coupons: coupons }
  }

  /**
   * validateImportedInvoice (provider_import.go): a figure the engine would never
   * have written is refused before anything is stored. Charge lines sum to the
   * subtotal, discount lines to minus the discount, tax lines to the tax, and the
   * total is the net amount clamped at zero, plus tax.
   */
  function validateImportedInvoice(inv, p) {
    const bad = (message) => badRequest(`ledger: invalid input: the provider's invoice ${message}`)
    const currency = String(p.currency).toLowerCase()
    if (inv.currency !== currency) throw bad(`is in ${q(inv.currency)}, but plan ${q(p.slug)} bills in lowercase ${q(currency)}`)
    const fields = [["subtotal", inv.subtotal], ["tax amount", inv.tax_amount], ["discount amount", inv.discount_amount], ["total", inv.total]]
    for (const [name, m] of fields) {
      if (String(m?.currency ?? "") !== currency) throw bad(`has its ${name} in ${q(m?.currency)}, want ${q(currency)}`)
      if (m.amount < 0) throw bad(`has a negative ${name} ${goMoney(m)}`)
    }
    let charges = 0
    let discounts = 0
    let taxes = 0
    let hasDiscount = false
    let hasTax = false
    ;(inv.line_items ?? []).forEach((li, i) => {
      if (li.amount?.currency !== currency || li.unit_amount?.currency !== currency) {
        throw bad(`has line item ${i + 1} in ${q(li.amount?.currency)} and ${q(li.unit_amount?.currency)}, want ${q(currency)}`)
      }
      if (li.type === "discount") {
        hasDiscount = true
        discounts += li.amount.amount
      } else if (li.type === "tax") {
        hasTax = true
        taxes += li.amount.amount
      } else if (["base", "usage", "overage", "seat"].includes(li.type)) {
        charges += li.amount.amount
      } else {
        // The dashboard groups lines by these six types, so a line outside them would count toward the subtotal and appear on no page.
        throw bad(`has line item ${i + 1} of unknown type ${q(li.type)}`)
      }
    })
    const as = (amount) => goMoney({ amount, currency })
    if (charges !== inv.subtotal.amount) throw bad(`has line items charging ${as(charges)} but a subtotal of ${goMoney(inv.subtotal)}`)
    if (hasDiscount && -discounts !== inv.discount_amount.amount) throw bad(`has discount lines of ${as(-discounts)} but a discount amount of ${goMoney(inv.discount_amount)}`)
    if (hasTax && taxes !== inv.tax_amount.amount) throw bad(`has tax lines of ${as(taxes)} but a tax amount of ${goMoney(inv.tax_amount)}`)
    const want = Math.max(inv.subtotal.amount - inv.discount_amount.amount, 0) + inv.tax_amount.amount
    if (want !== inv.total.amount) throw bad(`has a total of ${goMoney(inv.total)}, but its subtotal, discount and tax make ${as(want)}`)
    const startMs = Date.parse(inv.period_start ?? "")
    const endMs = Date.parse(inv.period_end ?? "")
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) throw bad("needs both a period start and a period end")
    if (!(endMs > startMs)) throw bad("ends its period before it starts")
    if (inv.status === "paid" && !inv.paid_at) throw bad("is paid but has no paid-at time")
    if ((inv.status === "pending" || inv.status === "past_due") && !inv.due_date) throw bad(`is ${inv.status} but has no due date`)
  }

  /** invoices.detail's answer for a stored invoice. */
  function invoiceDetail(inv) {
    const sub = ledger.subscriptions.find((s) => s.id === inv.subscription_id)
    if (!sub) throw notFound("subscription")
    return { invoice: withLines(inv), subscription: clone(sub), export_formats: [...EXPORT_FORMATS] }
  }

  function exportText(inv, format) {
    if (format === "json") return JSON.stringify(inv, null, 2)
    const rows = ["description,quantity,unit_amount,amount,type"]
    for (const l of inv.line_items ?? []) rows.push([JSON.stringify(l.description), l.quantity, l.unit_amount.amount, l.amount.amount, l.type].join(","))
    rows.push(`"Total",,,${inv.total.amount},total`)
    return rows.join("\n") + "\n"
  }

  return {
    "subscriptions.list": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const status = text(input?.status)
        if (status !== "" && !SUB_STATUSES.includes(status)) throw badRequest(`unknown subscription status "${status}"`)
        const tenant = text(input?.tenant_id)
        const rows = ledger.subscriptions
          .filter((s) => s.app_id === app && (tenant === "" || s.tenant_id === tenant) && (status === "" || s.status === status))
          .sort(newestFirst)
        return page(rows, input)
      },
    },

    "subscriptions.detail": {
      kind: "query",
      handler: (input) => subscriptionDetail(loadSub(input?.id)),
    },

    "subscriptions.usage": {
      kind: "query",
      handler: (input) => {
        const sub = loadSub(input?.id)
        const p = ledger.plans.find((x) => x.id === sub.plan_id)
        if (!p) throw notFound("plan")
        return { features: featureUsage(sub, p) }
      },
    },

    "subscriptions.create": {
      kind: "command",
      invalidates: ["subscriptions.list", "overview.stats", "entitlements.check", "paymentMethods.list"],
      handler: (input) => {
        const app = requireApp()
        const tenant = requireText(input?.tenant_id, "tenant_id")
        const p = subscribablePlan(input?.plan_id, app)
        const quantity = checkQuantity(input?.quantity, p)
        const nowMs = Date.now()
        const stamp = iso(nowMs)
        const row = { id: ledger.nextId("sub"), tenant_id: tenant, plan_id: p.id, status: p.trial_days > 0 ? "trialing" : "active", current_period_start: stamp, current_period_end: iso(firstPeriodEnd(nowMs, p.pricing?.billing_period)), app_id: app, created_at: stamp, updated_at: stamp }
        if (p.trial_days > 0) {
          row.trial_start = stamp
          row.trial_end = iso(nowMs + p.trial_days * DAY)
        }
        if (quantity && Object.keys(quantity).length > 0) row.quantity = quantity
        ledger.subscriptions.push(row)
        return clone(row)
      },
    },

    "subscriptions.changePlan": {
      kind: "command",
      invalidates: ["subscriptions.list", "subscriptions.detail", "subscriptions.usage", "entitlements.check"],
      handler: (input) => {
        const sub = loadSub(input?.id)
        if (ENDED.has(sub.status)) throw conflict(`subscription is ${sub.status}`)
        const p = subscribablePlan(input?.plan_id, sub.app_id)
        // An absent or null quantity keeps the current seat counts, and the kept
        // counts are checked against the new plan as Go's ChangePlan does.
        const given = checkQuantity(input?.quantity, p)
        const quantity = given ?? sub.quantity ?? {}
        if (given === undefined) checkQuantity(quantity, p)
        sub.plan_id = p.id
        if (Object.keys(quantity).length > 0) sub.quantity = { ...quantity }
        else delete sub.quantity
        sub.updated_at = iso(Date.now())
        return clone(sub)
      },
    },

    "subscriptions.pause": {
      kind: "command",
      invalidates: ["subscriptions.list", "subscriptions.detail", "overview.stats", "entitlements.check"],
      handler: (input) => {
        const sub = loadSub(input?.id)
        if (sub.status !== "active" && sub.status !== "trialing") throw badRequest(`a ${sub.status} subscription cannot be paused`)
        // As the engine's PauseSubscription: paused_at is now, the period and
        // the trial stay where they are.
        const stamp = iso(Date.now())
        sub.status = "paused"
        sub.paused_at = stamp
        sub.updated_at = stamp
        return clone(sub)
      },
    },

    "subscriptions.resume": {
      kind: "command",
      invalidates: ["subscriptions.list", "subscriptions.detail", "overview.stats", "entitlements.check"],
      handler: (input) => {
        const sub = loadSub(input?.id)
        if (sub.status !== "paused") throw badRequest(`a ${sub.status} subscription cannot be resumed`)
        const p = ledger.plans.find((x) => x.id === sub.plan_id)
        if (!p) throw notFound("plan")
        Object.assign(sub, resumeOf(sub, p, Date.now()))
        delete sub.paused_at
        sub.updated_at = sub.resumed_at
        return clone(sub)
      },
    },

    "subscriptions.cancel": {
      kind: "command",
      invalidates: ["subscriptions.list", "subscriptions.detail", "overview.stats", "entitlements.check"],
      handler: (input) => {
        const sub = loadSub(input?.id)
        if (ENDED.has(sub.status)) throw conflict(`subscription is already ${sub.status}`)
        // As the engine's CancelSubscription: an immediate cancel ends the
        // subscription now, with cancel_at and canceled_at both that moment.
        // Otherwise only cancel_at is recorded, at the period end, and the
        // status stays as it is: the engine's lifecycle clock enacts it on its
        // first run after the date, and this fixture has no clock. ended_at is
        // never written.
        const nowMs = Date.now()
        if (input?.immediately === true) {
          sub.cancel_at = iso(nowMs)
          sub.status = "canceled"
          sub.canceled_at = iso(nowMs)
        } else {
          sub.cancel_at = sub.current_period_end
        }
        return clone(sub)
      },
    },

    "subscriptions.syncToProvider": {
      kind: "command",
      invalidates: ["subscriptions.detail"],
      handler: (input) => {
        const sub = loadSub(input?.id)
        return syncRow(sub, "subscription", ENDED.has(sub.status) ? `the subscription is ${sub.status}` : undefined)
      },
    },

    "subscriptions.importFromProvider": {
      kind: "command",
      invalidates: ["subscriptions.list", "overview.stats", "entitlements.check", "paymentMethods.list"],
      handler: (input) => {
        const app = requireApp()
        const { pid, record } = fromProvider(input, "subscription", ledger.provider.subscriptions, app)
        // The engine's checks, in its order (provider_import.go).
        const status = text(record.status)
        if (status !== "" && !SUB_STATUSES.includes(status)) throw badRequest(`ledger: invalid input: unknown subscription status ${q(status)}`)
        const tenant = text(record.tenant_id)
        if (tenant === "") throw badRequest(`ledger: invalid input: the provider's subscription ${q(pid)} has no tenant id`)
        if (!record.plan_id) throw badRequest("ledger: invalid input: the provider's subscription names no plan")
        // validateImportedSubscriptionPeriod: no period at all is fine (the import opens one), half of one or one that runs backwards is not.
        const periodStart = text(record.current_period_start)
        const periodEnd = text(record.current_period_end)
        if (periodStart !== "" || periodEnd !== "") {
          if (periodStart === "" || periodEnd === "") throw badRequest(`ledger: invalid input: the provider's subscription ${q(pid)} needs both a period start and a period end`)
          if (!(Date.parse(periodEnd) > Date.parse(periodStart))) throw badRequest(`ledger: invalid input: the provider's subscription ${q(pid)} ends its period before it starts`)
        }
        const p = ledger.plans.find((x) => x.id === record.plan_id)
        if (!p || p.app_id !== app) {
          throw badRequest(`ledger: invalid input: the provider's subscription is on plan ${record.plan_id}, which is not a plan in this app; import the plan first`)
        }
        // importedPlanInApp words the inactive plan for an import, before the duplicate scan.
        if (p.status !== "active") {
          throw badRequest(`ledger: invalid input: plan ${q(p.slug)} is ${p.status}, not active; activate plan ${p.slug} before importing its subscriptions`)
        }
        const dup = ledger.subscriptions.find((s) => s.app_id === app && s.tenant_id === tenant && s.provider_name === PROVIDER && s.provider_id === pid)
        if (dup) throw conflict(`ledger: already exists: provider subscription ${q(pid)} is already stored as ${dup.id}`)
        const quantity = checkQuantity(record.quantity, p)
        const nowMs = Date.now()
        const stamp = iso(nowMs)
        const row = {
          id: ledger.nextId("sub"),
          tenant_id: tenant,
          plan_id: p.id,
          status: status || (p.trial_days > 0 ? "trialing" : "active"),
          current_period_start: record.current_period_start || stamp,
          current_period_end: record.current_period_end || iso(nowMs + 30 * DAY),
          app_id: app,
          provider_id: pid,
          provider_name: PROVIDER,
          created_at: stamp,
          updated_at: stamp,
        }
        if (status === "" && p.trial_days > 0) {
          row.trial_start = row.current_period_start
          row.trial_end = iso(Date.parse(row.current_period_start) + p.trial_days * DAY)
        }
        if (quantity && Object.keys(quantity).length > 0) row.quantity = quantity
        ledger.subscriptions.push(row)
        return subscriptionDetail(row)
      },
    },

    "invoices.list": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const status = text(input?.status)
        if (status !== "" && !INVOICE_STATUSES.includes(status)) throw badRequest(`unknown invoice status "${status}"`)
        const tenant = text(input?.tenant_id)
        const startMs = optionalTime(input?.start, "start")
        const endMs = optionalTime(input?.end, "end")
        const rows = ledger.invoices
          .filter((i) => i.app_id === app && (tenant === "" || i.tenant_id === tenant) && (status === "" || i.status === status))
          .filter((i) => (startMs === undefined || Date.parse(i.period_start) >= startMs) && (endMs === undefined || Date.parse(i.period_end) <= endMs))
          .sort(newestFirst)
        const answer = page(rows, input)
        return { ...answer, items: answer.items.map((i) => ({ ...i, line_items: i.line_items ?? [] })) }
      },
    },

    "invoices.detail": {
      kind: "query",
      handler: (input) => invoiceDetail(loadInvoice(input?.id)),
    },

    "invoices.pending": {
      kind: "query",
      handler: () => {
        const app = requireApp()
        return ledger.invoices.filter((i) => i.app_id === app && i.status === "pending").sort(newestFirst).map(withLines)
      },
    },

    "invoices.export": {
      kind: "query",
      handler: (input) => {
        const format = text(input?.format)
        const inv = loadInvoice(input?.id)
        if (!EXPORT_FORMATS.includes(format)) throw badRequest(`no invoice formatter for format "${format}"`)
        return { format, filename: `invoice-${inv.id}.${format}`, content: Buffer.from(exportText(inv, format), "utf8").toString("base64") }
      },
    },

    "invoices.generate": {
      kind: "command",
      invalidates: ["invoices.list", "invoices.pending", "subscriptions.detail", "overview.stats", "overview.recentInvoices"],
      handler: (input) => {
        const sub = loadSub(input?.subscription_id, "subscription_id")
        const p = ledger.plans.find((x) => x.id === sub.plan_id)
        if (!p) throw notFound("plan")
        const period = billedPeriod(sub, p, input)
        const live = ledger.invoices.find(
          (i) => i.subscription_id === sub.id && Date.parse(i.period_start) === period.startMs && Date.parse(i.period_end) === period.endMs && i.status !== "voided",
        )
        if (live) throw conflict(`ledger: already exists: invoice ${live.id} already covers this billing period`)
        const metered = p.features.find((f) => f.key === "api_calls" && f.type === "metered")
        const used = !metered ? 0 : billedUsage(sub, "api_calls", period.startMs, period.endMs)
        const overageQty = metered && metered.limit > 0 && used > metered.limit ? used - metered.limit : 0
        const percentCoupon = ledger.applied
          .filter((a) => a.subscription_id === sub.id)
          .map((a) => ledger.coupons.find((c) => c.id === a.coupon_id))
          .find((c) => c && c.type === "percentage")
        const nowMs = Date.now()
        const inv = buildInvoice({
          id: ledger.nextId("inv"),
          sub,
          plan: p,
          periodStartMs: period.startMs,
          periodEndMs: period.endMs,
          status: "draft",
          overageQty,
          discountPercent: percentCoupon?.percentage ?? 0,
          discountLabel: percentCoupon ? `${percentCoupon.code} (${percentCoupon.percentage}% off)` : "",
          createdMs: nowMs,
        })
        ledger.invoices.push(inv)
        return withLines(inv)
      },
    },

    "invoices.finalize": {
      kind: "command",
      invalidates: ["invoices.list", "invoices.detail", "invoices.pending", "overview.stats", "overview.recentInvoices"],
      handler: (input) => {
        const inv = loadInvoice(input?.id)
        if (inv.status !== "draft") throw conflict("invoice is already finalized")
        const nowMs = Date.now()
        inv.status = "pending"
        inv.due_date = iso(nowMs + 30 * DAY)
        inv.updated_at = iso(nowMs)
        return withLines(inv)
      },
    },

    "invoices.markPaid": {
      kind: "command",
      invalidates: ["invoices.list", "invoices.detail", "invoices.pending", "overview.stats", "overview.recentInvoices"],
      handler: (input) => {
        const inv = loadInvoice(input?.id)
        if (inv.status === "paid") throw conflict("invoice is already paid")
        if (inv.status === "voided") throw conflict("invoice is voided")
        const paidMs = optionalTime(input?.paid_at, "paid_at") ?? Date.now()
        inv.status = "paid"
        inv.paid_at = iso(paidMs)
        const ref = text(input?.payment_ref)
        if (ref !== "") inv.payment_ref = ref
        else delete inv.payment_ref
        inv.updated_at = iso(Date.now())
        return withLines(inv)
      },
    },

    "invoices.void": {
      kind: "command",
      invalidates: ["invoices.list", "invoices.detail", "invoices.pending", "overview.stats", "overview.recentInvoices"],
      handler: (input) => {
        // The reason is checked before the invoice is loaded, as the Go handler does.
        const reason = text(input?.reason)
        if (reason === "") throw badRequest("a reason is required to void an invoice")
        const inv = loadInvoice(input?.id)
        if (inv.status === "paid") throw conflict("a paid invoice cannot be voided")
        if (inv.status === "voided") throw conflict("invoice is already voided")
        const stamp = iso(Date.now())
        inv.status = "voided"
        inv.voided_at = stamp
        inv.void_reason = reason
        inv.updated_at = stamp
        return withLines(inv)
      },
    },

    "invoices.syncToProvider": {
      kind: "command",
      invalidates: ["invoices.detail"],
      handler: (input) => {
        const inv = loadInvoice(input?.id)
        return syncRow(inv, "invoice", inv.status === "voided" ? "the invoice is voided" : undefined)
      },
    },

    "invoices.importFromProvider": {
      kind: "command",
      invalidates: ["invoices.list", "invoices.pending", "subscriptions.detail", "overview.stats", "overview.recentInvoices"],
      handler: (input) => {
        const app = requireApp()
        const { pid, record } = fromProvider(input, "invoice", ledger.provider.invoices, app)
        const status = text(record.status) || "draft"
        if (!INVOICE_STATUSES.includes(status)) throw badRequest(`ledger: invalid input: unknown invoice status ${q(status)}`)
        const tenant = text(record.tenant_id)
        if (tenant === "") throw badRequest(`ledger: invalid input: the provider's invoice ${q(pid)} has no tenant id`)
        if (!record.subscription_id) throw badRequest("ledger: invalid input: the provider's invoice names no subscription")
        const sub = ledger.subscriptions.find((s) => s.id === record.subscription_id)
        if (!sub || sub.app_id !== app || sub.tenant_id !== tenant) {
          throw badRequest(`ledger: invalid input: the provider's invoice is for subscription ${record.subscription_id}, which is not this app's subscription for tenant "${tenant}"; import the subscription first`)
        }
        const invPlan = ledger.plans.find((x) => x.id === sub.plan_id)
        if (!invPlan) throw notFound("ledger: plan")
        validateImportedInvoice({ ...record, status }, invPlan)
        // Go lists the tenant's invoices whose period lies inside the imported one.
        const startMs = Date.parse(record.period_start)
        const endMs = Date.parse(record.period_end)
        const inPeriod = ledger.invoices.filter(
          (i) => i.app_id === app && i.tenant_id === tenant && Date.parse(i.period_start) >= startMs && Date.parse(i.period_end) <= endMs,
        )
        for (const stored of inPeriod) {
          if (stored.provider_name === PROVIDER && stored.provider_id === pid) {
            throw conflict(`ledger: already exists: provider invoice ${q(pid)} is already stored as ${stored.id}`)
          }
          const live = stored.status !== "voided" && status !== "voided"
          if (live && stored.subscription_id === sub.id && stored.period_start === record.period_start && stored.period_end === record.period_end) {
            throw conflict(`ledger: already exists: subscription ${sub.id} already has invoice ${stored.id} for this period`)
          }
        }
        const stamp = iso(Date.now())
        const id = ledger.nextId("inv")
        const row = { ...record, id, status, tenant_id: tenant, app_id: app, provider_id: pid, provider_name: PROVIDER, created_at: stamp, updated_at: stamp }
        row.line_items = (record.line_items ?? []).map((line, i) => ({ ...line, id: line.id || `${id}_li${i + 1}`, invoice_id: id }))
        ledger.invoices.push(row)
        return invoiceDetail(row)
      },
    },

    "usage.events": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const tenant = text(input?.tenant_id)
        const key = text(input?.feature_key)
        const startMs = optionalTime(input?.start, "start")
        const endMs = optionalTime(input?.end, "end")
        const rows = ledger.events
          .filter((e) => e.app_id === app && (tenant === "" || e.tenant_id === tenant) && (key === "" || e.feature_key === key))
          .filter((e) => {
            const t = Date.parse(e.timestamp)
            // Half-open, as QueryUsage is: start included, end excluded.
            return (startMs === undefined || t >= startMs) && (endMs === undefined || t < endMs)
          })
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))
        return page(rows, input)
      },
    },

    "usage.aggregate": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const tenant = requireText(input?.tenant_id, "tenant_id")
        const keys = Array.isArray(input?.feature_keys) ? input.feature_keys.map(text).filter((k) => k !== "") : []
        if (keys.length === 0) throw badRequest("feature_keys needs at least one key")
        const period = text(input?.period)
        if (!PERIODS.includes(period)) throw badRequest(`unknown period "${input?.period ?? ""}"`)
        const totals = {}
        for (const key of keys) totals[key] = usedFor(tenant, app, key, period)
        return { period, totals }
      },
    },

    "entitlements.check": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const tenant = requireText(input?.tenant_id, "tenant_id")
        const key = requireText(input?.feature_key, "feature_key")
        return entitlement(tenant, app, key)
      },
    },

    "entitlements.invalidate": {
      kind: "command",
      invalidates: ["entitlements.check", "subscriptions.usage"],
      handler: (input) => {
        requireApp()
        requireText(input?.tenant_id, "tenant_id")
        return { ok: true }
      },
    },

    "paymentMethods.list": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const tenant = requireText(input?.tenant_id, "tenant_id")
        // The provider's namespace is tenant-only, so the contract answers only
        // for a tenant subscribed in the caller's app.
        if (!ledger.subscriptions.some((s) => s.tenant_id === tenant && s.app_id === app)) throw notFound("tenant")
        if (!providerConfigured()) return { configured: false, methods: [] }
        return { configured: true, methods: clone(ledger.paymentMethods[tenant] ?? []) }
      },
    },
  }
}

export function createLedgerHandlers(FixtureError) {
  const h = makeHelpers(FixtureError)
  return { ...catalogHandlers(h), ...billingHandlers(h) }
}

// Exported for Task 2's billing handlers, which live in this same module.
export { APP_ID, PROVIDER, EXPORT_FORMATS, PERIODS, DAY, clone, oldestFirst, newestFirst }
export const ledgerState = () => ledger
