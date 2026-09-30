import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import type { PluginNavItem, PluginRoute } from "@forge-go/dashboard-plugin"
import { CreditCardIcon, HouseIcon, ListChecksIcon, PackageIcon, RepeatIcon, SettingsIcon, TicketPercentIcon, WalletIcon } from "@forge-go/dashboard-kit/icons"
import { LedgerCouponCreatePage } from "./pages/coupon-create"
import { LedgerCouponDetailPage } from "./pages/coupon-detail"
import { LedgerCouponEditPage } from "./pages/coupon-edit"
import { LedgerCouponsPage } from "./pages/coupons"
import { LedgerFeatureCreatePage } from "./pages/feature-create"
import { LedgerFeatureDetailPage } from "./pages/feature-detail"
import { LedgerFeatureEditPage } from "./pages/feature-edit"
import { LedgerFeaturesPage } from "./pages/features"
import { LedgerOverviewPage } from "./pages/overview"
import { LedgerPaymentMethodsPage } from "./pages/payment-methods"
import { LedgerPlanCreatePage } from "./pages/plan-create"
import { LedgerPlanEditPage } from "./pages/plan-edit"
import { LedgerPlansPage } from "./pages/plans"
import { LedgerSettingsPage } from "./pages/settings"
import { LedgerSubscriptionCreatePage } from "./pages/subscription-create"
import { LedgerSubscriptionsPage } from "./pages/subscriptions"

// Lazy: its module is imported nowhere else, so the table code loads only here.
const LedgerPlanDetailPage = lazy(() => import("./pages/plan-detail"))

export type * from "./types"
export {
  couponEditPath,
  couponPath,
  featureEditPath,
  featurePath,
  invoicePath,
  planEditPath,
  planPath,
  subscriptionPath,
} from "./lib/paths"

/**
 * Sidebar groups render in the order their first item appears, so the nav is
 * sorted into this order before definePlugin sees it. Page tasks append to
 * navItems in any order and the sidebar still reads Overview, Catalog,
 * Billing, Configuration.
 */
const GROUP_ORDER = ["Overview", "Catalog", "Billing", "Configuration"]

export function inGroupOrder(items: PluginNavItem[]): PluginNavItem[] {
  const rank = (item: PluginNavItem) => GROUP_ORDER.indexOf(item.group ?? "")
  return [...items].sort((a, b) => rank(a) - rank(b))
}

/*
 * Each page task appends its entries here. Detail, create and edit routes get
 * no nav entry: a sidebar link to "a plan" with none chosen points nowhere.
 * /usage, /plans/:id and /invoices/:id are lazy(): their modules are imported
 * nowhere else, so recharts and the table code stay out of the entry chunk.
 */
const navItems: PluginNavItem[] = [
  { label: "Overview", to: "/", priority: 0, icon: <HouseIcon />, group: "Overview" },
  { label: "Plans", to: "/plans", priority: 0, icon: <PackageIcon />, group: "Catalog" },
  { label: "Features", to: "/features", priority: 10, icon: <ListChecksIcon />, group: "Catalog" },
  { label: "Coupons", to: "/coupons", priority: 20, icon: <TicketPercentIcon />, group: "Catalog" },
  { label: "Subscriptions", to: "/subscriptions", priority: 0, icon: <RepeatIcon />, group: "Billing" },
  { label: "Payment methods", to: "/payment-methods", priority: 40, icon: <CreditCardIcon />, group: "Billing" },
  { label: "Settings", to: "/settings", priority: 0, icon: <SettingsIcon />, group: "Configuration" },
]
const routes: PluginRoute[] = [
  { path: "/", element: LedgerOverviewPage },
  { path: "/plans", element: LedgerPlansPage },
  { path: "/plans/new", element: LedgerPlanCreatePage },
  { path: "/plans/:id/edit", element: LedgerPlanEditPage },
  { path: "/plans/:id", element: LedgerPlanDetailPage },
  { path: "/features", element: LedgerFeaturesPage },
  { path: "/features/new", element: LedgerFeatureCreatePage },
  { path: "/features/:id/edit", element: LedgerFeatureEditPage },
  { path: "/features/:id", element: LedgerFeatureDetailPage },
  { path: "/coupons", element: LedgerCouponsPage },
  { path: "/coupons/new", element: LedgerCouponCreatePage },
  { path: "/coupons/:id/edit", element: LedgerCouponEditPage },
  { path: "/coupons/:id", element: LedgerCouponDetailPage },
  { path: "/subscriptions", element: LedgerSubscriptionsPage },
  { path: "/subscriptions/new", element: LedgerSubscriptionCreatePage },
  { path: "/payment-methods", element: LedgerPaymentMethodsPage },
  { path: "/settings", element: LedgerSettingsPage },
]

/**
 * The first-party UI for the `ledger` extension.
 *
 * `extension` is "ledger", the Go contributor name from
 * `ledger/extension/contract/manifest.yaml`, and `test/plugin.test.tsx` checks
 * it by resolving against a capabilities document. No `requires` range, for
 * the reason warden and vault have none.
 */
export const ledgerPlugin = definePlugin({
  extension: "ledger",
  namespace: "ledger",
  label: "Billing",
  icon: <WalletIcon />,
  nav: inGroupOrder(navItems),
  routes,
})

export default ledgerPlugin
