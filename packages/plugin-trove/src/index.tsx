import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon } from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"

export { OverviewPage }

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
 * own name. The "Storage" heading belongs to the nav items' `group`, which
 * Tasks 2 to 6 set.
 */
export const trovePlugin = definePlugin({
  extension: "trove",
  namespace: "trove",
  label: "Trove",
  nav: [{ label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "Storage" }],
  routes: [{ path: "/", element: OverviewPage }],
})

export default trovePlugin
