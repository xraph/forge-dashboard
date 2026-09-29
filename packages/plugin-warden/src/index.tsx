import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  HouseIcon,
  KeyIcon,
  LinkIcon,
  SettingsIcon,
  UserCogIcon,
  UsersIcon,
} from "@forge-go/dashboard-kit/icons"
import { WardenAssignmentsPage } from "./pages/assignments"
import { WardenConfigPage } from "./pages/config"
import { WardenOverviewPage } from "./pages/overview"
import { WardenPermissionsPage } from "./pages/permissions"
import { WardenRelationsPage } from "./pages/relations"
import { WardenRoleDetailPage } from "./pages/role-detail"
import { WardenRolesPage } from "./pages/roles"

export type { ConfigDetail } from "./pages/config"
export type { OverviewStats, RecentChecks, CheckSummary } from "./pages/overview"
export type { AssignmentSummary, AssignmentsList } from "./pages/assignments"
export type { RoleSummary, RolesList, AckResponse } from "./pages/roles"
export type { RoleDetail, PermissionSummary } from "./pages/role-detail"
export type { PermissionsList } from "./pages/permissions"
export type { RelationSummary, RelationsList } from "./pages/relations"
export {
  WardenAssignmentsPage,
  WardenConfigPage,
  WardenOverviewPage,
  WardenPermissionsPage,
  WardenRelationsPage,
  WardenRolesPage,
  WardenRoleDetailPage,
}
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
      label: "Permissions",
      to: "/permissions",
      priority: 20,
      icon: <KeyIcon />,
      group: "Authorization",
    },
    {
      label: "Assignments",
      to: "/assignments",
      priority: 30,
      icon: <UsersIcon />,
      group: "Authorization",
    },
    {
      label: "Relations",
      to: "/relations",
      priority: 20,
      icon: <LinkIcon />,
      group: "Relationships",
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
    // No nav entry: a sidebar link to "a role" with no role chosen points
    // nowhere. This route is reached only from a row's Details link.
    { path: "/roles/:id", element: WardenRoleDetailPage },
    { path: "/permissions", element: WardenPermissionsPage },
    { path: "/assignments", element: WardenAssignmentsPage },
    { path: "/relations", element: WardenRelationsPage },
    { path: "/config", element: WardenConfigPage },
  ],
})

export default wardenPlugin
