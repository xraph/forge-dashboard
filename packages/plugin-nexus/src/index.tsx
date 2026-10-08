import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  ActivityIcon,
  BoxIcon,
  ChartColumnIcon,
  HouseIcon,
  KeyRoundIcon,
  NetworkIcon,
  SettingsIcon,
  UsersIcon,
} from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"
import { GatewayPage } from "./pages/gateway"
import { ModelsPage } from "./pages/models"
import { TenantsPage } from "./pages/tenants"
import { TenantDetailPage } from "./pages/tenant-detail"
import { KeysPage } from "./pages/keys"
import { KeyDetailPage } from "./pages/key-detail"
import { RecordsPage } from "./pages/records"
import { SettingsPage } from "./pages/settings"

const UsagePage = lazy(() => import("./pages/usage"))

export const nexusPlugin = definePlugin({
  extension: "nexus",
  namespace: "nexus",
  label: "Nexus",
  icon: <NetworkIcon />,
  nav: [
    {
      label: "Overview",
      to: "/",
      icon: <HouseIcon />,
      group: "Gateway",
      priority: -1,
    },
    {
      label: "Gateway",
      to: "/gateway",
      icon: <NetworkIcon />,
      group: "Gateway",
      priority: 0,
    },
    {
      label: "Models",
      to: "/models",
      icon: <BoxIcon />,
      group: "Gateway",
      priority: 1,
    },
    {
      label: "Tenants",
      to: "/tenants",
      icon: <UsersIcon />,
      group: "Customers",
      priority: 2,
    },
    {
      label: "API keys",
      to: "/keys",
      icon: <KeyRoundIcon />,
      group: "Customers",
      priority: 3,
    },
    {
      label: "Usage",
      to: "/usage",
      icon: <ChartColumnIcon />,
      group: "Spend",
      priority: 4,
    },
    {
      label: "Request log",
      to: "/usage/records",
      icon: <ActivityIcon />,
      group: "Spend",
      priority: 5,
    },
    { label: "Settings", to: "/settings", icon: <SettingsIcon />, priority: 6 },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/gateway", element: GatewayPage },
    { path: "/models", element: ModelsPage },
    { path: "/tenants", element: TenantsPage },
    { path: "/tenants/:id", element: TenantDetailPage },
    { path: "/keys", element: KeysPage },
    { path: "/keys/:id", element: KeyDetailPage },
    { path: "/usage", element: UsagePage },
    { path: "/usage/records", element: RecordsPage },
    { path: "/settings", element: SettingsPage },
  ],
})
export default nexusPlugin
export {
  OverviewPage,
  GatewayPage,
  ModelsPage,
  TenantsPage,
  TenantDetailPage,
  KeysPage,
  KeyDetailPage,
  RecordsPage,
  SettingsPage,
}
export { Money } from "./components/money"
export { KeyBadge, TenantBadge, OutcomeBadge } from "./badges"
export type * from "./types"
