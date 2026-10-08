import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  ActivityIcon,
  CodeIcon,
  HeartPulseIcon,
  HouseIcon,
  NetworkIcon,
  RouteIcon,
  ServerIcon,
  SettingsIcon,
  ShieldIcon,
  ToggleLeftIcon,
} from "@forge-go/dashboard-kit/icons"
import { BastionApiExplorerPage } from "./pages/api-explorer"
import { BastionCircuitsPage } from "./pages/circuits"
import { BastionConfigPage } from "./pages/config"
import { BastionHealthPage } from "./pages/health"
import { BastionOverviewPage } from "./pages/overview"
import { BastionRouteCreatePage } from "./pages/route-create"
import { BastionRouteDetailPage } from "./pages/route-detail"
import { BastionRouteEditPage } from "./pages/route-edit"
import { BastionRoutesPage } from "./pages/routes"
import { BastionServicesPage } from "./pages/services"
import { BastionTrafficPage } from "./pages/traffic"
import { BastionUpstreamsPage } from "./pages/upstreams"

export {
  BastionApiExplorerPage,
  BastionCircuitsPage,
  BastionConfigPage,
  BastionHealthPage,
  BastionOverviewPage,
  BastionRouteCreatePage,
  BastionRouteDetailPage,
  BastionRouteEditPage,
  BastionRoutesPage,
  BastionServicesPage,
  BastionTrafficPage,
  BastionUpstreamsPage,
}
export {
  CircuitBadge,
  EnabledBadge,
  HealthBadge,
  ProtocolBadge,
  SourceBadge,
} from "./badges"
export { routeEditPath, routePath } from "./keys"
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
    {
      label: "Overview",
      to: "/",
      priority: 0,
      icon: <HouseIcon />,
      group: "Gateway",
    },
    {
      label: "Routes",
      to: "/routes",
      priority: 10,
      icon: <RouteIcon />,
      group: "Routing",
    },
    {
      label: "Upstreams",
      to: "/upstreams",
      priority: 11,
      icon: <ServerIcon />,
      group: "Routing",
    },
    {
      label: "Services",
      to: "/services",
      priority: 12,
      icon: <NetworkIcon />,
      group: "Routing",
    },
    {
      label: "Traffic",
      to: "/traffic",
      priority: 20,
      icon: <ActivityIcon />,
      group: "Traffic",
    },
    {
      label: "Health",
      to: "/health",
      priority: 30,
      icon: <HeartPulseIcon />,
      group: "Resilience",
    },
    {
      label: "Circuits",
      to: "/circuits",
      priority: 31,
      icon: <ToggleLeftIcon />,
      group: "Resilience",
    },
    {
      label: "API explorer",
      to: "/api-explorer",
      priority: 40,
      icon: <CodeIcon />,
      group: "API",
    },
    {
      label: "Config",
      to: "/config",
      priority: 50,
      icon: <SettingsIcon />,
      group: "Settings",
    },
  ],
  routes: [
    { path: "/", element: BastionOverviewPage },
    { path: "/routes", element: BastionRoutesPage },
    // /new-route, not /routes/new: no route id can shadow it.
    { path: "/new-route", element: BastionRouteCreatePage },
    // No nav entry: a sidebar link to "a route" with none chosen points nowhere.
    { path: "/routes/:id", element: BastionRouteDetailPage },
    { path: "/routes/:id/edit", element: BastionRouteEditPage },
    { path: "/upstreams", element: BastionUpstreamsPage },
    { path: "/services", element: BastionServicesPage },
    { path: "/traffic", element: BastionTrafficPage },
    { path: "/health", element: BastionHealthPage },
    { path: "/circuits", element: BastionCircuitsPage },
    { path: "/api-explorer", element: BastionApiExplorerPage },
    { path: "/config", element: BastionConfigPage },
  ],
})

export default bastionPlugin
