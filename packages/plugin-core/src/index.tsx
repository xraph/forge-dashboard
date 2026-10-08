import { definePlugin } from "@forge-go/dashboard-plugin"
import { ForgeMark } from "@forge-go/dashboard-kit/components/brand-marks"
import {
  ActivityIcon,
  BlocksIcon,
  GaugeIcon,
  LayersIcon,
  RouteIcon,
  ServerIcon,
  Settings2Icon,
  TerminalIcon,
} from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./overview"
import { ServicesPage } from "./services"
import { LogsPage, MetricsPage, TracesPage } from "./observability"
import { ConfigurationPage, ExtensionsPage, RoutesPage } from "./management"

export const corePlugin = definePlugin({
  extension: "core-contract",
  root: true,
  label: "Forge",
  icon: <ForgeMark />,
  nav: [
    {
      label: "Overview",
      to: "/overview",
      group: "Workspace",
      icon: <GaugeIcon />,
    },
    {
      label: "Services & health",
      to: "/services",
      group: "Workspace",
      icon: <ServerIcon />,
    },
    { label: "Routes", to: "/routes", group: "Workspace", icon: <RouteIcon /> },
    {
      label: "Metrics",
      to: "/metrics",
      group: "Observe",
      icon: <ActivityIcon />,
    },
    { label: "Traces", to: "/traces", group: "Observe", icon: <LayersIcon /> },
    {
      label: "Logs & activity",
      to: "/logs",
      group: "Observe",
      icon: <TerminalIcon />,
    },
    {
      label: "Extensions",
      to: "/extensions",
      group: "Manage",
      icon: <BlocksIcon />,
    },
    {
      label: "Configuration",
      to: "/configuration",
      group: "Manage",
      icon: <Settings2Icon />,
    },
  ],
  routes: [
    { path: "/overview", element: OverviewPage },
    { path: "/services", element: ServicesPage },
    { path: "/routes", element: RoutesPage },
    { path: "/metrics", element: MetricsPage },
    { path: "/traces", element: TracesPage },
    { path: "/logs", element: LogsPage },
    { path: "/extensions", element: ExtensionsPage },
    { path: "/configuration", element: ConfigurationPage },
  ],
})
export default corePlugin
