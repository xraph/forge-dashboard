import { definePlugin } from "@forge-go/dashboard-plugin"
import { ArrowLeftRightIcon, DatabaseIcon, FingerprintIcon, HouseIcon, LayersIcon } from "@forge-go/dashboard-kit/icons"
import { BucketsPage } from "./pages/buckets"
import { CasPage } from "./pages/cas"
import { MiddlewarePage } from "./pages/middleware"
import { OverviewPage } from "./pages/overview"
import { TransfersPage } from "./pages/transfers"

export { BucketsPage, CasPage, MiddlewarePage, OverviewPage, TransfersPage }

/**
 * The first-party UI for the `trove` extension.
 *
 * `extension` is "trove", the contributor name trove/extension/contract's
 * manifest registers, and test/plugin.test.tsx checks it by resolving against
 * a capabilities document. Every page reads the drivers through the contract;
 * nothing here reads the extension's metadata store, which normal operation
 * never writes.
 *
 * `label` is "Trove": definePlugin requires the label to spell the extension's
 * own name. The "Storage" heading belongs to each nav item's `group`.
 */
export const trovePlugin = definePlugin({
  extension: "trove",
  namespace: "trove",
  label: "Trove",
  nav: [
    { label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "Storage" },
    { label: "Buckets", to: "/buckets", priority: 0, icon: <DatabaseIcon />, group: "Storage" },
    { label: "Middleware", to: "/middleware", priority: 10, icon: <LayersIcon />, group: "Storage" },
    { label: "CAS", to: "/cas", priority: 20, icon: <FingerprintIcon />, group: "Storage" },
    { label: "Transfers", to: "/transfers", priority: 30, icon: <ArrowLeftRightIcon />, group: "Storage" },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/buckets", element: BucketsPage },
    { path: "/middleware", element: MiddlewarePage },
    { path: "/cas", element: CasPage },
    { path: "/transfers", element: TransfersPage },
  ],
})

export default trovePlugin
