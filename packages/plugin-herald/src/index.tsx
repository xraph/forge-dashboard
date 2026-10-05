import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon, ServerIcon } from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"
import { ProviderDetailPage } from "./pages/provider-detail"
import { ProvidersPage } from "./pages/providers"

export { OverviewPage, ProviderDetailPage, ProvidersPage }
export { DanglingBadge, DisabledProviderBadge, EnabledBadge, MessageStatusBadge, ProtectionBadge, VersionBadge } from "./badges"
export { HeraldHeader, useEngineInfo } from "./components/herald-header"
export type * from "./wire"

/**
 * The first-party UI for the `herald` extension.
 *
 * `extension` is "herald", the Go contributor name from
 * herald/extension/contract/manifest.yaml, and the join key the host looks
 * up in the capabilities response. The label must spell the extension, so it
 * is "Herald"; "Notifications" names the nav group and the overview page.
 *
 * No `requires` range: a range the host skips for a contributor that reports
 * no version reads as a guarantee and enforces nothing.
 */
export const heraldPlugin = definePlugin({
  extension: "herald",
  namespace: "herald",
  label: "Herald",
  nav: [
    { label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "Notifications" },
    { label: "Providers", to: "/providers", priority: 30, icon: <ServerIcon />, group: "Notifications" },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/providers", element: ProvidersPage },
    { path: "/providers/:id", element: ProviderDetailPage },
  ],
})

export default heraldPlugin
