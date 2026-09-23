import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  HouseIcon,
  SettingsIcon,
  UserCogIcon,
} from "@forge-go/dashboard-kit/icons"
import { WardenConfigPage } from "./pages/config"
import { WardenOverviewPage } from "./pages/overview"
import { WardenRolesPage } from "./pages/roles"

export type { ConfigDetail } from "./pages/config"
export type { OverviewStats, RecentChecks, CheckSummary } from "./pages/overview"
export type { RoleSummary, RolesList, AckResponse } from "./pages/roles"
export { WardenConfigPage, WardenOverviewPage, WardenRolesPage }
export { NamespaceCell, useNamespaceFilter, namespaceParam } from "./components/namespace-filter"
export type { NamespaceValue } from "./components/namespace-filter"

/**
 * The first-party UI for the `warden` extension.
 *
 * `extension` is "warden", the Go contributor name from
 * `warden/extension/contract/manifest.yaml`. It is the join key the host
 * looks up in the capabilities response, and it is checked in
 * `test/plugin.test.tsx` by resolving against a capabilities document rather
 * than by comparing the string to itself.
 *
 * No `requires` range. Warden's contributor reports no version, and
 * `resolvePluginState` skips the range check entirely for a contributor that
 * answers none, so a range would read as a guarantee and enforce nothing.
 *
 * Note that warden's roles are the same rows authsome's /roles page shows,
 * through `authsome/rbac/warden_store.go`. This page is the canonical one and
 * shows every field; authsome's is scoped to one app and drops namespace,
 * parent-slug inheritance, the system and default flags and member caps.
 */
export const wardenPlugin = definePlugin({
  extension: "warden",
  namespace: "warden",
  label: "Warden",
  nav: [
    {
      label: "Overview",
      to: "/",
      priority: 0,
      icon: <HouseIcon />,
      group: "Overview",
    },
    {
      label: "Roles",
      to: "/roles",
      priority: 10,
      icon: <UserCogIcon />,
      group: "Authorization",
    },
    {
      label: "Config",
      to: "/config",
      priority: 40,
      icon: <SettingsIcon />,
      group: "Operations",
    },
  ],
  routes: [
    { path: "/", element: WardenOverviewPage },
    { path: "/roles", element: WardenRolesPage },
    { path: "/config", element: WardenConfigPage },
  ],
})

export default wardenPlugin
