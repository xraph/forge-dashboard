import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon } from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"

/**
 * The first-party UI for the `weave` extension.
 *
 * `extension` is "weave", the contributor name weave/extension/contract's
 * manifest registers, and test/plugin.test.tsx checks it by resolving against
 * a capabilities document. The dashboard is operator-wide: Weave resolves no
 * tenant on this path, so every page sees every tenant unless it filters.
 */
export const weavePlugin = definePlugin({
  extension: "weave",
  namespace: "weave",
  label: "Weave",
  nav: [{ label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "RAG" }],
  routes: [{ path: "/", element: OverviewPage }],
})

export { OverviewPage }

export default weavePlugin
