import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon, RouteIcon, ServerIcon, ShieldIcon } from "@forge-go/dashboard-kit/icons"
import { BastionOverviewPage } from "./pages/overview"
import { BastionRouteDetailPage } from "./pages/route-detail"
import { BastionRoutesPage } from "./pages/routes"
import { BastionUpstreamsPage } from "./pages/upstreams"

export { BastionOverviewPage, BastionRouteDetailPage, BastionRoutesPage, BastionUpstreamsPage }
export { CircuitBadge, EnabledBadge, HealthBadge, ProtocolBadge, SourceBadge } from "./badges"
export { routePath } from "./keys"
export type * from "./types"

/**
 * The first-party UI for the `bastion` gateway extension.
 *
 * `extension` is the Go contributor name from
 * bastion/extension/contract/manifest.yaml, the join key the host looks up in
 * the capabilities response. test/plugin.test.tsx checks it by resolving
 * against a capabilities document.
 */
export const bastionPlugin = definePlugin({
  extension: "bastion",
  namespace: "bastion",
  label: "Bastion",
  icon: <ShieldIcon />,
  nav: [
    { label: "Overview", to: "/", priority: 0, icon: <HouseIcon />, group: "Gateway" },
    { label: "Routes", to: "/routes", priority: 10, icon: <RouteIcon />, group: "Routing" },
    { label: "Upstreams", to: "/upstreams", priority: 11, icon: <ServerIcon />, group: "Routing" },
  ],
  routes: [
    { path: "/", element: BastionOverviewPage },
    { path: "/routes", element: BastionRoutesPage },
    // No nav entry: a sidebar link to "a route" with none chosen points nowhere.
    { path: "/routes/:id", element: BastionRouteDetailPage },
    { path: "/upstreams", element: BastionUpstreamsPage },
  ],
})

export default bastionPlugin
