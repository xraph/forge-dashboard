// ledger-fixtures.mjs: in-memory state and intent handlers for the ledger
// contributor (packages/plugin-ledger), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors forgery/ledger/extension/contract (plans.go, features.go,
// subscriptions.go, invoices.go, coupons.go, usage.go, overview.go) at commit
// 4a0d838. Field names are the Go JSON tags, snake_case. Lists answer
// {items, limit, offset, has_more} and never a total. Money is
// {amount, currency, display} with amount in minor units.
//
// The module imports nothing from server.mjs. It needs server.mjs's
// FixtureError class so `err instanceof FixtureError` holds in the dispatcher
// and NOT_FOUND, CONFLICT and PERMISSION_DENIED reach the wire with their own
// codes; createLedgerHandlers takes it as an argument for that reason.
//
// Two switches, read on every call so a running server can be flipped:
//   LEDGER_FIXTURE_NO_APP=1       no app is selected. Every intent except the
//                                 feature catalog and settings.detail answers
//                                 PERMISSION_DENIED, as the Go binder does.
//   LEDGER_FIXTURE_NO_PROVIDER=1  no payment provider is registered: every
//                                 syncToProvider answers UNAVAILABLE.

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
  const umbrella = sub("sub_umbrella", "umbrella", starter, "canceled", 200, { canceled_at: ago(40), cancel_at: ago(40), ended_at: ago(40) })
  sub("sub_wayne", "wayne", starter, "active", 30, { cancel_at: iso(periodEnd), canceled_at: ago(2) })

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
  const lastStart = now - 40 * DAY
  const lastEnd = now - 10 * DAY
  state.invoices.push(
    buildInvoice({ id: "inv_acme_4", sub: acme, plan: pro, periodStartMs: lastStart, periodEndMs: lastEnd, status: "pending", overageQty: 12000, discountPercent: 20, discountLabel: "LAUNCH20 (20% off)", createdMs: lastEnd, extra: { due_date: iso(now + 4 * DAY) } }),
    buildInvoice({ id: "inv_initech_1", sub: initech, plan: pro, periodStartMs: lastStart, periodEndMs: lastEnd, status: "past_due", createdMs: lastEnd + 1000, extra: { due_date: iso(now - 2 * DAY) } }),
    buildInvoice({ id: "inv_globex_1", sub: globex, plan: starter, periodStartMs: periodStart, periodEndMs: periodEnd, status: "draft", createdMs: now - DAY }),
    buildInvoice({ id: "inv_umbrella_1", sub: umbrella, plan: starter, periodStartMs: now - 70 * DAY, periodEndMs: now - 40 * DAY, status: "voided", createdMs: now - 40 * DAY, extra: { voided_at: ago(39), void_reason: "Customer left during the trial" } }),
    buildInvoice({ id: "inv_hooli_1", sub: hooli, plan: starter, periodStartMs: lastStart, periodEndMs: lastEnd, status: "paid", createdMs: lastEnd + 2000, extra: { due_date: iso(lastEnd + 14 * DAY), paid_at: ago(8), payment_ref: "ch_hooli_1" } }),
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
  const unavailable = (message) => new FixtureError(503, "UNAVAILABLE", message)

  /** The resolved app: APP_ID, or "" when the no-app switch is on. */
  const currentApp = () => (process.env.LEDGER_FIXTURE_NO_APP === "1" ? "" : APP_ID)
  const providerConfigured = () => process.env.LEDGER_FIXTURE_NO_PROVIDER !== "1"

  /** The binder's refusal for an app-scoped intent reached with no app. */
  function requireApp() {
    const app = currentApp()
    if (app === "") {
      throw new FixtureError(403, "PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")
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

  /** Loads a row the app owns, or answers NOT_FOUND exactly as for an unknown id. */
  function owned(list, rawId, field, what) {
    const app = requireApp()
    const id = requireText(rawId, field)
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

  return {
    badRequest, notFound, conflict, unavailable, currentApp, providerConfigured, requireApp,
    text, requireText, wholeNumber, page, owned, optionalTime, moneyInput, syncRow,
  }
}

function catalogHandlers(h) {
  const { badRequest, notFound, conflict, currentApp, providerConfigured, requireApp, text, requireText, wholeNumber, page, owned, optionalTime, moneyInput, syncRow } = h

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

  const slugTaken = (app, slug, exceptId) => ledger.plans.some((p) => p.app_id === app && p.slug === slug && p.id !== exceptId)

  const canRead = (row) => row.app_id === currentApp() || row.app_id === ""
  function readableFeature(rawId) {
    const id = requireText(rawId, "id")
    const row = ledger.features.find((f) => f.id === id)
    if (!row || !canRead(row)) throw notFound("feature")
    return row
  }
  function writableFeature(rawId) {
    const id = requireText(rawId, "id")
    const row = ledger.features.find((f) => f.id === id)
    if (!row || row.app_id !== currentApp()) throw notFound("feature")
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

    "coupons.list": {
      kind: "query",
      handler: (input) => {
        const app = requireApp()
        const nowMs = Date.now()
        const rows = ledger.coupons
          .filter((c) => c.app_id === app && (input?.active !== true || couponState(c, nowMs) === "active"))
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
        const currency = requireText(input?.currency, "currency").toLowerCase()
        const maxRedemptions = wholeNumber(input?.max_redemptions)
        if (maxRedemptions < 0) throw badRequest("max_redemptions must not be negative")
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
          next.max_redemptions = wholeNumber(input.max_redemptions)
          if (next.max_redemptions < 0) throw badRequest("max_redemptions must not be negative")
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
        app_id: currentApp(),
        require_app_claim: false,
        providers: providerConfigured() ? [PROVIDER] : [],
        invoice_formats: [...EXPORT_FORMATS],
      }),
    },
  }
}

export function createLedgerHandlers(FixtureError) {
  const h = makeHelpers(FixtureError)
  return { ...catalogHandlers(h) }
}

// Exported for Task 2's billing handlers, which live in this same module.
export { APP_ID, PROVIDER, EXPORT_FORMATS, PERIODS, DAY, clone, oldestFirst, newestFirst }
export const ledgerState = () => ledger
