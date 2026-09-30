import { definePlugin } from "@forge-go/dashboard-plugin"
import type { ContextDimension } from "@forge-go/dashboard-plugin"
import {
  AppWindowIcon,
  ClipboardListIcon,
  ClockIcon,
  HomeIcon,
  KeyIcon,
  LayersIcon,
  PuzzleIcon,
  SettingsIcon,
  ShieldIcon,
  SmartphoneIcon,
  ToggleLeftIcon,
  UserCogIcon,
  UsersIcon,
  WebhookIcon,
} from "@forge-go/dashboard-kit/icons"
import { AuthAppCreatePage } from "./pages/app-create"
import { AuthAppDetailPage } from "./pages/app-detail"
import { AuthAppPicker } from "./pages/app-picker"
import { AuthAppsPage } from "./pages/apps"
import { AuthCredentialsPage } from "./pages/credentials"
import { AuthDeviceDetailPage } from "./pages/device-detail"
import { AuthDevicesPage } from "./pages/devices"
import { AuthEnvironmentDetailPage } from "./pages/environment-detail"
import { AuthEnvironmentsPage } from "./pages/environments"
import { AuthFeaturesPage } from "./pages/features"
import { AuthOverviewPage } from "./pages/overview"
import { AuthPluginsPage } from "./pages/plugins"
import { AuthRoleDetailPage } from "./pages/role-detail"
import { AuthRolesPage } from "./pages/roles"
import { AuthSessionDetailPage } from "./pages/session-detail"
import { AuthSessionsPage } from "./pages/sessions"
import { AuthDynamicClientsPage } from "./pages/dynamic-clients"
import { AuthSettingsNamespacePage } from "./pages/settings-namespace"
import { AuthSettingsPage } from "./pages/settings"
import { AuthSignupFormEditorPage } from "./pages/signup-form-editor"
import { AuthSignupFormsPage } from "./pages/signup-forms"
import { AuthUserCreatePage } from "./pages/user-create"
import { AuthUserDetailPage } from "./pages/user-detail"
import { AuthUsersPage } from "./pages/users"
import { AuthWebhooksPage } from "./pages/webhooks"
import { authsomeSubPlugins } from "./sub"

export type {
  AuthConfig,
  LoginResult,
  LogoutResult,
  SocialProvider,
} from "@forge-go/dashboard-plugin"
export type {
  AckResponse,
  UserSummary,
  UsersList,
} from "./pages/users"
export { displayName } from "./pages/users"
export type { UserDetail } from "./pages/user-detail"
export type {
  RevokeResult,
  SessionSummary,
  SessionsList,
} from "./pages/sessions"
export type { SessionDetail } from "./pages/session-detail"
export type { DeviceSummary, DevicesList } from "./pages/devices"
export { deviceLabel } from "./pages/devices"
export type {
  PermissionRecord,
  RoleDetail,
  RoleSummary,
  RolesList,
} from "./pages/roles"
export type { AppSummary, AppsList } from "./pages/apps"
export type { AppDetail } from "./pages/app-detail"
export type { EnvSummary, EnvironmentsList } from "./pages/environments"
export type { EnvDetail } from "./pages/environment-detail"
export type { WebhookDetail, WebhookSummary, WebhooksList } from "./pages/webhooks"
export type {
  FormConfigSummary,
  FormConfigsList,
} from "./pages/signup-forms"
export type {
  FormField,
  SelectOption,
  SignupFormResponse,
} from "./pages/signup-form-editor"
export type { NamespaceSummary, NamespacesList } from "./pages/settings"
export { AuthDynamicClientsPage } from "./pages/dynamic-clients"
export type { CredentialsDetail } from "./pages/credentials"
export type { FeatureToggle, FeatureTogglesResponse } from "./pages/features"
export type { OverviewStats, RecentSignups } from "./pages/overview"
export {
  AuthAppCreatePage,
  AuthAppDetailPage,
  AuthAppsPage,
  AuthCredentialsPage,
  AuthDeviceDetailPage,
  AuthDevicesPage,
  AuthEnvironmentDetailPage,
  AuthEnvironmentsPage,
  AuthFeaturesPage,
  AuthOverviewPage,
  AuthPluginsPage,
  AuthRoleDetailPage,
  AuthRolesPage,
  AuthSessionDetailPage,
  AuthSessionsPage,
  AuthSettingsNamespacePage,
  AuthSettingsPage,
  AuthSignupFormEditorPage,
  AuthSignupFormsPage,
  AuthUserCreatePage,
  AuthUserDetailPage,
  AuthUsersPage,
  AuthWebhooksPage,
}

/**
 * The two scope-wide selectors the sidebar renders: which app, and which
 * environment within it. Neither payload builder uses a shared `{ id }`
 * shape, because the contract does not use one: `apps.switch` takes
 * `{ appId }` and `environments.switch` takes `{ envId }`. A hardcoded field
 * name would send something the server ignores, and the switch would appear
 * to work while changing nothing.
 *
 * Both dimensions read the same `apps.context` query on purpose - the store
 * dedups on the key, so two switchers cost one request rather than two.
 */
const APP_DIMENSION: ContextDimension = {
  id: "app",
  label: "App",
  query: "apps.context",
  switchCommand: "apps.switch",
  select: (data) => {
    const d = data as {
      currentApp?: { id: string; name: string; slug: string }
      availableApps?: { id: string; name: string; slug: string }[]
    }
    return {
      current: d.currentApp
        ? { id: d.currentApp.id, label: d.currentApp.name, slug: d.currentApp.slug }
        : undefined,
      options: (d.availableApps ?? []).map((a) => ({ id: a.id, label: a.name, slug: a.slug })),
    }
  },
  payload: (appId) => ({ appId }),
  // App is a path segment under this plugin's own namespace root, not just
  // a cookie: picking "acme" lands on this namespace's "acme" segment. With
  // no segment in the URL at all, AuthAppPicker renders in place of every
  // page this plugin has, rather than thirty-seven links that would each
  // answer about an app nobody picked.
  routed: { placement: "path", param: "app", by: "slug", picker: AuthAppPicker },
}

const ENV_DIMENSION: ContextDimension = {
  id: "environment",
  label: "Environment",
  query: "apps.context",
  switchCommand: "environments.switch",
  select: (data) => {
    const d = data as {
      currentEnv?: { id: string; name: string; slug: string }
      availableEnvs?: { id: string; name: string; slug: string }[]
    }
    return {
      current: d.currentEnv
        ? { id: d.currentEnv.id, label: d.currentEnv.name, slug: d.currentEnv.slug }
        : undefined,
      options: (d.availableEnvs ?? []).map((e) => ({ id: e.id, label: e.name, slug: e.slug })),
    }
  },
  payload: (envId) => ({ envId }),
  // Environment is a query param: `?env=prod`. Absent means "whatever the
  // server already has" rather than "nothing", so it stays out of the path.
  routed: { placement: "query", param: "env", by: "slug" },
}

/**
 * The first-party UI for authsome.
 *
 * `extension` is "authsome": the extension's name, its app slug, and the Go
 * contributor name in authsome's `extension/contract/manifest.yaml`, which is
 * the join key the host looks up in the capabilities response. It is also
 * what `packages/runtime/src/config.tsx` defaults `loginContributor` to.
 * Authsome before the rename called that contributor "auth"; the intents kept
 * their `auth.` prefix, which is why `auth.login` still signs you in.
 *
 * Get it wrong and `resolvePluginState` reports `hidden`: no routes mount, no
 * nav appears, and nothing is logged, because a contributor the server never
 * mentioned is an ordinary thing for a shell to encounter. That silence is
 * why `test/plugin.test.tsx` resolves this plugin against a capabilities
 * document instead of comparing the string to itself.
 *
 * No `requires` range, for the same reason as the streaming plugin: authsome's
 * contributor does not report a version, and a range against a contributor
 * that answers no version is skipped by the resolver anyway. Adding one would
 * be a claim we cannot check.
 *
 * Twenty-three routes across four nav groups - Identity, Configuration,
 * Security, System - the same grouping the Go manifests declare. Every
 * detail, create and edit route is deliberately absent from `nav`: a sidebar
 * link to "a user" with no user chosen points nowhere, and it is reached
 * instead from its list page.
 *
 * `/login` stays out of `routes` on purpose. The dashboard host owns that
 * page now: it renders its own sign-in screen, wired to whichever intent
 * names this plugin declares below, so a "Sign in" row sitting in the nav
 * for somebody already signed in would have nothing to mean either way.
 */
export const authsomePlugin = definePlugin({
  extension: "authsome",
  namespace: "authsome",
  label: "Authsome",
  icon: <ShieldIcon />,
  auth: {
    intents: {
      config: "auth.config",
      signIn: "auth.login",
      signOut: "auth.logout",
      forgotPassword: "auth.forgotPassword",
      resetPassword: "auth.resetPassword",
      signUp: "auth.signup",
      setupStatus: "auth.setupStatus",
      completeSetup: "auth.setup",
    },
  },
  nav: [
    // Identity
    { label: "Users", to: "/users", priority: 10, icon: <UsersIcon />, group: "Identity" },
    { label: "Sessions", to: "/sessions", priority: 20, icon: <ClockIcon />, group: "Identity" },
    { label: "Devices", to: "/devices", priority: 30, icon: <SmartphoneIcon />, group: "Identity" },
    { label: "Roles", to: "/roles", priority: 40, icon: <UserCogIcon />, group: "Identity" },
    // Configuration
    { label: "Apps", to: "/apps", priority: 10, icon: <AppWindowIcon />, group: "Configuration" },
    {
      label: "Environments",
      to: "/environments",
      priority: 20,
      icon: <LayersIcon />,
      group: "Configuration",
    },
    { label: "Webhooks", to: "/webhooks", priority: 30, icon: <WebhookIcon />, group: "Configuration" },
    {
      label: "Signup forms",
      to: "/signup-forms",
      priority: 40,
      icon: <ClipboardListIcon />,
      group: "Configuration",
    },
    { label: "Settings", to: "/settings", priority: 50, icon: <SettingsIcon />, group: "Configuration" },
    // Security
    { label: "Credentials", to: "/credentials", priority: 10, icon: <KeyIcon />, group: "Security" },
    { label: "Features", to: "/features", priority: 20, icon: <ToggleLeftIcon />, group: "Security" },
    // System
    { label: "Overview", to: "/", priority: 10, icon: <HomeIcon />, group: "System" },
    { label: "Plugins", to: "/plugins", priority: 20, icon: <PuzzleIcon />, group: "System" },
  ],
  routes: [
    { path: "/", element: AuthOverviewPage },
    { path: "/apps", element: AuthAppsPage },
    { path: "/apps/create", element: AuthAppCreatePage },
    { path: "/apps/:id", element: AuthAppDetailPage },
    { path: "/credentials", element: AuthCredentialsPage },
    { path: "/devices", element: AuthDevicesPage },
    { path: "/devices/:id", element: AuthDeviceDetailPage },
    { path: "/environments", element: AuthEnvironmentsPage },
    { path: "/environments/:id", element: AuthEnvironmentDetailPage },
    { path: "/features", element: AuthFeaturesPage },
    { path: "/plugins", element: AuthPluginsPage },
    { path: "/roles", element: AuthRolesPage },
    { path: "/roles/:id", element: AuthRoleDetailPage },
    { path: "/sessions", element: AuthSessionsPage },
    { path: "/sessions/:id", element: AuthSessionDetailPage },
    { path: "/settings", element: AuthSettingsPage },
    { path: "/settings/:namespace", element: AuthSettingsNamespacePage },
    { path: "/signup-forms", element: AuthSignupFormsPage },
    { path: "/signup-forms/edit", element: AuthSignupFormEditorPage },
    // Reached from the signup form editor, not from the sidebar, so it
    // declares no nav entry. It sits under /signup-forms rather than under
    // /settings, where the spec first put it, because /settings/:namespace
    // already owns every second segment there: a static sibling works today
    // only because react-router ranks static above dynamic, and it would
    // shadow a real settings namespace the day somebody names one after it.
    { path: "/signup-forms/dynamic", element: AuthDynamicClientsPage },
    { path: "/users", element: AuthUsersPage },
    { path: "/users/create", element: AuthUserCreatePage },
    { path: "/users/:id", element: AuthUserDetailPage },
    { path: "/webhooks", element: AuthWebhooksPage },
  ],
  context: [APP_DIMENSION, ENV_DIMENSION],
})

export default authsomePlugin

export { authsomeSubPlugins }
