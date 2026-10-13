import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { LedgerCouponCreatePage } from "../src/pages/coupon-create"
import { LedgerCouponDetailPage } from "../src/pages/coupon-detail"
import { LedgerCouponEditPage } from "../src/pages/coupon-edit"
import { LedgerCouponsPage } from "../src/pages/coupons"
import { LedgerFeatureCreatePage } from "../src/pages/feature-create"
import { LedgerFeatureDetailPage } from "../src/pages/feature-detail"
import { LedgerFeatureEditPage } from "../src/pages/feature-edit"
import { LedgerFeaturesPage } from "../src/pages/features"
import { LedgerInvoiceDetailPage } from "../src/pages/invoice-detail"
import { LedgerInvoicesPage } from "../src/pages/invoices"
import { LedgerOverviewPage } from "../src/pages/overview"
import { LedgerPaymentMethodsPage } from "../src/pages/payment-methods"
import { LedgerPlanCreatePage } from "../src/pages/plan-create"
import { LedgerPlanDetailPage } from "../src/pages/plan-detail"
import { LedgerPlanEditPage } from "../src/pages/plan-edit"
import { LedgerPlansPage } from "../src/pages/plans"
import { LedgerSettingsPage } from "../src/pages/settings"
import { LedgerSubscriptionCreatePage } from "../src/pages/subscription-create"
import { LedgerSubscriptionDetailPage } from "../src/pages/subscription-detail"
import { LedgerSubscriptionsPage } from "../src/pages/subscriptions"
import { LedgerUsagePage } from "../src/pages/usage"
import { renderPage, renderWithNavigation, scriptedClient } from "./harness"
import {
  aCatalogFeature,
  aCoupon,
  aLineItem,
  anInvoice,
  aPage,
  aPlan,
  aSubscription,
  usd,
} from "./fixtures"

afterEach(cleanup)

/**
 * The shared rules (one h1, every h2 and table in a section, no section in a
 * section), then the section regions the page is expected to have. A page with
 * no h2 or table (a form, a facts page) would pass the first check unconverted,
 * so the regions are what make it fail first.
 */
function expectLayout(container: HTMLElement, regions: string[] = []) {
  expect(layoutViolations(container)).toEqual([])
  for (const name of regions)
    expect(screen.getByRole("region", { name })).toBeTruthy()
}

const STATS = {
  plans: 6,
  active_plans: 2,
  subscriptions_by_status: {
    active: 3,
    trialing: 1,
    past_due: 1,
    paused: 1,
    canceled: 1,
  },
  pending_invoices: 2,
  past_due_invoices: 3,
  coupons: 5,
  capped: false,
}

const USAGE = {
  features: [
    {
      key: "api_calls",
      name: "API calls",
      type: "metered",
      period: "monthly",
      limit: 100000,
      used: 112000,
      remaining: 0,
      soft_limit: true,
      over_limit: true,
      enabled: false,
    },
  ],
}

const SETTINGS = {
  meter_batch_size: 100,
  meter_flush_interval: "5s",
  entitlement_cache_ttl: "1m0s",
  lifecycle_interval: "1m0s",
  app_id: "app_ledger",
  require_app_claim: false,
  providers: ["stripe"],
  invoice_formats: ["csv", "json"],
}

const EVENTS = aPage([
  {
    id: "evt_1",
    tenant_id: "acme",
    app_id: "app_ledger",
    feature_key: "api_calls",
    quantity: 400,
    timestamp: new Date().toISOString(),
  },
])

const METHODS = {
  configured: true,
  methods: [
    {
      id: "pm_1",
      type: "card",
      last4: "4242",
      brand: "visa",
      expiry_month: 12,
      expiry_year: 2028,
      is_default: true,
      provider_name: "stripe",
      provider_id: "pm_1Nf",
    },
  ],
}

describe("Ledger pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { client } = scriptedClient({
      "overview.stats": STATS,
      "invoices.pending": [anInvoice({ id: "inv_p1" })],
      "invoices.list": aPage([anInvoice({ id: "inv_d1", status: "past_due" })]),
      "overview.recentInvoices": [anInvoice({ id: "inv_r1", status: "paid" })],
    })
    const { container } = renderPage(LedgerOverviewPage, client)
    await screen.findByText("inv_r1")
    await screen.findByText("inv_p1")
    await screen.findByText("inv_d1")
    expectLayout(container, [
      "Pending invoices",
      "Past-due invoices",
      "Recent invoices",
    ])
  })

  it("Usage follows the shared layout", async () => {
    const { client } = scriptedClient({ "usage.events": EVENTS })
    const { container } = renderPage(LedgerUsagePage, client)
    await screen.findAllByText("evt_1")
    await screen.findByRole("group", { name: /Units per UTC day/ })
    expectLayout(container, [
      "Filters",
      "Units per day",
      "Events",
      "Entitlements",
    ])
  })

  it("Usage with a month total keeps the counter outside any section", async () => {
    const { client } = scriptedClient({
      "usage.events": EVENTS,
      "usage.aggregate": { totals: { api_calls: 450 } },
      "settings.detail": SETTINGS,
    })
    const { container } = renderPage(LedgerUsagePage, client)
    fireEvent.change(screen.getByLabelText("Tenant ID"), {
      target: { value: "acme" },
    })
    fireEvent.change(screen.getByLabelText("Feature key"), {
      target: { value: "api_calls" },
    })
    await screen.findByText("450")
    await screen.findAllByText("evt_1")
    expectLayout(container, ["Filters", "Units per day", "Events"])
  })

  it("Plans follows the shared layout", async () => {
    const { client } = scriptedClient({ "plans.list": aPage([aPlan()]) })
    const { container } = renderPage(LedgerPlansPage, client)
    await screen.findByText("Pro")
    expectLayout(container, ["Plan list"])
  })

  it("Coupons follows the shared layout", async () => {
    const { client } = scriptedClient({ "coupons.list": aPage([aCoupon()]) })
    const { container } = renderPage(LedgerCouponsPage, client)
    await screen.findByText("LAUNCH20")
    expectLayout(container, ["Coupon list"])
  })

  it("Features follows the shared layout", async () => {
    const { client } = scriptedClient({
      "features.list": aPage([aCatalogFeature()]),
    })
    const { container } = renderPage(LedgerFeaturesPage, client)
    await screen.findByText("API calls")
    expectLayout(container, ["Feature list"])
  })

  it("Invoices follows the shared layout", async () => {
    const { client } = scriptedClient({
      "invoices.list": aPage([anInvoice()], { has_more: true }),
    })
    const { container } = renderPage(LedgerInvoicesPage, client)
    await screen.findByText("inv_1")
    expectLayout(container, ["Invoice list"])
  })

  it("Subscriptions follows the shared layout", async () => {
    const { client } = scriptedClient({
      "subscriptions.list": aPage([aSubscription()]),
      "plans.list": aPage([aPlan()]),
    })
    const { container } = renderPage(LedgerSubscriptionsPage, client)
    await screen.findByText("acme")
    expectLayout(container, ["Subscription list"])
  })

  it("Payment methods follows the shared layout", async () => {
    const { client } = scriptedClient({ "paymentMethods.list": METHODS })
    const { container } = renderPage(LedgerPaymentMethodsPage, client)
    fireEvent.change(screen.getByLabelText("Tenant ID"), {
      target: { value: "acme" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Look up" }))
    await screen.findByText("4242")
    expectLayout(container, ["Tenant lookup", "Payment method list"])
  })

  it("Settings follows the shared layout", async () => {
    const { client } = scriptedClient({ "settings.detail": SETTINGS })
    const { container } = renderPage(LedgerSettingsPage, client)
    await screen.findByText("app_ledger")
    expectLayout(container, ["Configuration"])
  })

  it("Coupon detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "coupons.detail": aCoupon() })
    const { container } = renderWithNavigation(LedgerCouponDetailPage, client, {
      id: "cpn_launch20",
    })
    await screen.findByRole("heading", { level: 1, name: "LAUNCH20" })
    expectLayout(container, ["Details"])
  })

  it("Coupon create follows the shared layout", () => {
    const { client } = scriptedClient({})
    const { container } = renderWithNavigation(LedgerCouponCreatePage, client)
    expectLayout(container, ["Coupon details"])
  })

  it("Coupon edit follows the shared layout", async () => {
    const { client } = scriptedClient({ "coupons.detail": aCoupon() })
    const { container } = renderWithNavigation(LedgerCouponEditPage, client, {
      id: "cpn_launch20",
    })
    await screen.findByLabelText("Name")
    expectLayout(container, ["Coupon details"])
  })

  it("Feature detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "features.detail": aCatalogFeature() })
    const { container } = renderWithNavigation(
      LedgerFeatureDetailPage,
      client,
      { id: "feat_api_calls" }
    )
    await screen.findByRole("button", { name: "Sync to provider" })
    expectLayout(container, ["Details", "Payment provider"])
  })

  it("Feature create follows the shared layout", () => {
    const { client } = scriptedClient({})
    const { container } = renderWithNavigation(LedgerFeatureCreatePage, client)
    expectLayout(container, ["Feature details"])
  })

  it("Feature edit follows the shared layout", async () => {
    const { client } = scriptedClient({ "features.detail": aCatalogFeature() })
    const { container } = renderWithNavigation(LedgerFeatureEditPage, client, {
      id: "feat_api_calls",
    })
    await screen.findByLabelText("Name")
    expectLayout(container, ["Feature details"])
  })

  it("Plan detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "plans.detail": aPlan() })
    const { container } = renderWithNavigation(LedgerPlanDetailPage, client, {
      id: "plan_pro",
    })
    await screen.findByText("Single sign-on")
    await screen.findAllByText("Graduated")
    expectLayout(container, [
      "Features",
      "Usage pricing",
      "Price",
      "Payment provider",
    ])
  })

  it("Plan detail with no usage pricing keeps its note inside the section", async () => {
    const plan = aPlan()
    const { client } = scriptedClient({
      "plans.detail": { ...plan, pricing: { ...plan.pricing!, tiers: [] } },
    })
    const { container } = renderWithNavigation(LedgerPlanDetailPage, client, {
      id: "plan_pro",
    })
    await screen.findByText(/No usage pricing/)
    expectLayout(container, ["Features", "Usage pricing", "Price"])
  })

  it("Plan create follows the shared layout", () => {
    const { client } = scriptedClient({})
    const { container } = renderWithNavigation(LedgerPlanCreatePage, client)
    expectLayout(container, ["Plan", "Price", "Features", "Usage pricing"])
  })

  it("Plan edit follows the shared layout", async () => {
    const { client } = scriptedClient({ "plans.detail": aPlan() })
    const { container } = renderWithNavigation(LedgerPlanEditPage, client, {
      id: "plan_pro",
    })
    await screen.findByLabelText("Name")
    expectLayout(container, ["Plan", "Price", "Features", "Usage pricing"])
  })

  it("Invoice detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "invoices.detail": {
        invoice: anInvoice(),
        subscription: aSubscription(),
        export_formats: ["csv", "json"],
      },
    })
    const { container } = renderWithNavigation(
      LedgerInvoiceDetailPage,
      client,
      { id: "inv_1" }
    )
    await screen.findByText("Sales tax (8%)")
    expectLayout(container, [
      "Totals",
      "Base",
      "Seats",
      "Discounts",
      "Tax",
      "Status",
      "Details",
      "Export",
      "Payment provider",
    ])
  })

  it("Invoice detail with no line items keeps its note inside a section", async () => {
    const { client } = scriptedClient({
      "invoices.detail": {
        invoice: anInvoice({ line_items: [] }),
        subscription: aSubscription(),
        export_formats: [],
      },
    })
    const { container } = renderWithNavigation(
      LedgerInvoiceDetailPage,
      client,
      { id: "inv_1" }
    )
    await screen.findByText("This invoice has no line items.")
    expectLayout(container, ["Totals", "Line items", "Export"])
  })

  it("Subscription detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "subscriptions.detail": {
        subscription: aSubscription(),
        plan: aPlan(),
        applied_coupons: [aCoupon()],
      },
      "subscriptions.usage": USAGE,
      "invoices.list": aPage([anInvoice()], { has_more: true }),
    })
    const { container } = renderWithNavigation(
      LedgerSubscriptionDetailPage,
      client,
      { id: "sub_acme" }
    )
    await screen.findByText("inv_1")
    await screen.findByText("API calls")
    expectLayout(container, [
      "Usage against limits",
      "Invoices",
      "Details",
      "Coupons",
      "Payment provider",
    ])
  })

  it("Subscription create follows the shared layout", async () => {
    const { client } = scriptedClient({
      "plans.list": aPage([aPlan()]),
    })
    const { container } = renderWithNavigation(
      LedgerSubscriptionCreatePage,
      client
    )
    await screen.findByRole("option", { name: "Pro" })
    expectLayout(container, ["Subscription details"])
  })

  it("Invoice detail groups every line type in its own section", async () => {
    const { client } = scriptedClient({
      "invoices.detail": {
        invoice: anInvoice({
          line_items: [
            aLineItem(),
            aLineItem({
              id: "li_x",
              description: "Custom",
              type: "custom" as never,
              amount: usd(100),
            }),
          ],
        }),
        subscription: aSubscription(),
        export_formats: [],
      },
    })
    const { container } = renderWithNavigation(
      LedgerInvoiceDetailPage,
      client,
      { id: "inv_1" }
    )
    await screen.findByText("Custom")
    expectLayout(container, ["Base", "Other"])
  })
})
