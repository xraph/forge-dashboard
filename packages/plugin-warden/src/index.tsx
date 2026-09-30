import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  FileCode2Icon,
  FlaskConicalIcon,
  HouseIcon,
  KeyIcon,
  LayersIcon,
  LinkIcon,
  ListChecksIcon,
  ScrollTextIcon,
  SettingsIcon,
  UserCogIcon,
  UsersIcon,
} from "@forge-go/dashboard-kit/icons"
import { WardenAssignmentsPage } from "./pages/assignments"
import { WardenCheckLogPage } from "./pages/check-log"
import { WardenCheckLogDetailPage } from "./pages/check-log-detail"
import { WardenConfigPage } from "./pages/config"
import { WardenOverviewPage } from "./pages/overview"
import { WardenPermissionDetailPage } from "./pages/permission-detail"
import { WardenPermissionsPage } from "./pages/permissions"
import { WardenPlaygroundPage } from "./pages/playground"
import { WardenPoliciesPage } from "./pages/policies"
import { WardenPolicyDetailPage, WardenPolicyEditPage } from "./pages/policy-detail"
import { WardenRelationsPage } from "./pages/relations"
import { WardenResourceTypeDetailPage } from "./pages/resource-type-detail"
import { WardenResourceTypesPage } from "./pages/resource-types"
import { WardenRoleDetailPage } from "./pages/role-detail"
import { WardenRolesPage } from "./pages/roles"
import { WardenSubjectDetailPage } from "./pages/subject-detail"

// CodeMirror is this page's weight, so it loads when Schema is opened and not
// with the shell.
const WardenSchemaPage = lazy(() => import("./pages/schema"))

export type { ConfigDetail } from "./pages/config"
export type { OverviewStats, RecentChecks } from "./pages/overview"
export type { CheckSummary } from "./components/check-log"
export type { AssignmentSummary, AssignmentsList } from "./pages/assignments"
export type { RoleSummary, RolesList, AckResponse } from "./pages/roles"
export type { RoleDetail, PermissionSummary } from "./pages/role-detail"
export type { PermissionsList } from "./pages/permissions"
export type {
  SubjectAssignment,
  SubjectDetail,
  SubjectPermission,
  SubjectPolicy,
  SubjectRelation,
  SubjectRole,
  WithheldSection,
} from "./pages/subject-detail"
export type {
  LaneState,
  PlaygroundInput,
  PlaygroundLane,
  PlaygroundResult,
} from "./components/playground-lanes"
export type { PermissionDetail } from "./pages/permission-detail"
export type {
  PoliciesList,
  PoliciesListParams,
  PolicyCreatePayload,
  PolicyState,
  PolicySummary,
} from "./pages/policies"
export type {
  ConditionProblem,
  ConditionReason,
  PolicyCondition,
  PolicyConditionView,
  PolicyDetail,
  PolicySubject,
} from "./components/policy-rule"
export { PolicyRule, conditionNote } from "./components/policy-rule"
export type { PolicyPageProps } from "./pages/policy-detail"
export type { RelationSummary, RelationsList } from "./pages/relations"
export type { ResourceTypeSummary, ResourceTypesList } from "./pages/resource-types"
export type {
  ExpressionDiagnostic,
  PermissionDef,
  RelationDef,
  ResourceTypeDetail,
} from "./pages/resource-type-detail"
export {
  WardenAssignmentsPage,
  WardenCheckLogDetailPage,
  WardenCheckLogPage,
  WardenConfigPage,
  WardenOverviewPage,
  WardenPermissionDetailPage,
  WardenPermissionsPage,
  WardenPlaygroundPage,
  WardenPoliciesPage,
  WardenPolicyDetailPage,
  WardenPolicyEditPage,
  WardenRelationsPage,
  WardenResourceTypeDetailPage,
  WardenResourceTypesPage,
  WardenRolesPage,
  WardenRoleDetailPage,
  WardenSubjectDetailPage,
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
      label: "Policies",
      to: "/policies",
      priority: 40,
      icon: <ScrollTextIcon />,
      group: "Authorization",
    },
    {
      label: "Resource types",
      to: "/resource-types",
      priority: 10,
      icon: <LayersIcon />,
      group: "Relationships",
    },
    {
      label: "Relations",
      to: "/relations",
      priority: 20,
      icon: <LinkIcon />,
      group: "Relationships",
    },
    {
      label: "Playground",
      to: "/playground",
      priority: 10,
      icon: <FlaskConicalIcon />,
      group: "Operations",
    },
    {
      label: "Check log",
      to: "/check-log",
      priority: 20,
      icon: <ListChecksIcon />,
      group: "Operations",
    },
    {
      label: "Schema",
      to: "/schema",
      priority: 30,
      icon: <FileCode2Icon />,
      group: "Operations",
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
    // No nav entry: a sidebar link to "a permission" with none chosen points
    // nowhere. This route is reached only from a Details link, on a
    // permissions row and on each grant of a role.
    { path: "/permissions/:id", element: WardenPermissionDetailPage },
    { path: "/assignments", element: WardenAssignmentsPage },
    { path: "/policies", element: WardenPoliciesPage },
    // No nav entry for either: a sidebar link to "a policy" with none chosen
    // points nowhere. The detail is reached from a row's name. The edit route
    // opens the editor, and is where the create flow lands and where the
    // detail page's Edit button goes. Both read the policy from params.id,
    // because a plugin cannot read a query string.
    { path: "/policies/:id", element: WardenPolicyDetailPage },
    { path: "/policies/:id/edit", element: WardenPolicyEditPage },
    { path: "/relations", element: WardenRelationsPage },
    { path: "/resource-types", element: WardenResourceTypesPage },
    // No nav entry: a sidebar link to "a resource type" with none chosen
    // points nowhere. This route is reached only from a row's Details link.
    { path: "/resource-types/:id", element: WardenResourceTypeDetailPage },
    { path: "/check-log", element: WardenCheckLogPage },
    // No nav entry: a sidebar link to "a check" with none chosen points
    // nowhere. This route is reached only from a row's timestamp.
    { path: "/check-log/:id", element: WardenCheckLogDetailPage },
    // No nav entry: a sidebar link to "a subject" with none chosen points
    // nowhere. The route is reached from a subject named on another page. The
    // params arrive URI-decoded and the page sends them as given. A subject
    // with an empty kind cannot reach it, because its links render as plain
    // text.
    { path: "/subjects/:kind/:id", element: WardenSubjectDetailPage },
    { path: "/playground", element: WardenPlaygroundPage },
    // No nav entry: a sidebar link to "a check" with none chosen points
    // nowhere. This route is reached only from a check's own page, and it
    // reads params.checkId because a plugin cannot read a query string.
    { path: "/playground/check/:checkId", element: WardenPlaygroundPage },
    { path: "/schema", element: WardenSchemaPage },
    { path: "/config", element: WardenConfigPage },
  ],
})

export default wardenPlugin
