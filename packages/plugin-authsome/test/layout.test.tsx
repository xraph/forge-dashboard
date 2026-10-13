import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  PluginProvider,
  SubPluginProvider,
  defineSubPlugin,
} from "@forge-go/dashboard-plugin"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { AuthAppCreatePage } from "../src/pages/app-create"
import { AuthAppDetailPage } from "../src/pages/app-detail"
import { AuthAppPicker } from "../src/pages/app-picker"
import { AuthAppsPage } from "../src/pages/apps"
import { AuthCredentialsPage } from "../src/pages/credentials"
import { AuthDeviceDetailPage } from "../src/pages/device-detail"
import { AuthDevicesPage } from "../src/pages/devices"
import { AuthDynamicClientsPage } from "../src/pages/dynamic-clients"
import { AuthEnvironmentDetailPage } from "../src/pages/environment-detail"
import { AuthEnvironmentsPage } from "../src/pages/environments"
import { AuthFeaturesPage } from "../src/pages/features"
import { AuthOverviewPage } from "../src/pages/overview"
import { AuthPluginsPage } from "../src/pages/plugins"
import { AuthRoleDetailPage } from "../src/pages/role-detail"
import { AuthRolesPage } from "../src/pages/roles"
import { AuthSessionDetailPage } from "../src/pages/session-detail"
import { AuthSessionsPage } from "../src/pages/sessions"
import { AuthSettingsNamespacePage } from "../src/pages/settings-namespace"
import { AuthSettingsPage } from "../src/pages/settings"
import { AuthSignupFormEditorPage } from "../src/pages/signup-form-editor"
import { AuthSignupFormsPage } from "../src/pages/signup-forms"
import { AuthUserCreatePage } from "../src/pages/user-create"
import { AuthUserDetailPage } from "../src/pages/user-detail"
import { AuthUsersPage } from "../src/pages/users"
import { AuthWebhooksPage } from "../src/pages/webhooks"
import { renderPage, stubClient } from "./harness"

// Every core page, rendered with data the way its own test renders it, must
// follow the shared layout: one h1, every h2 and table inside a kit Section,
// no Section inside a Section. Task 22 appends the sub-plugin pages.

const START = "2026-09-06T09:00:00.000Z"

const USER = {
  id: "usr_1",
  email: "ada@example.com",
  emailVerified: true,
  firstName: "Ada",
  lastName: "Lovelace",
  banned: false,
  createdAt: START,
  updatedAt: START,
}

const APP = {
  id: "app_1",
  name: "Acme",
  slug: "acme",
  isPlatform: false,
  createdAt: START,
  updatedAt: START,
  publishableKey: "pk_live_123",
  metadata: { tier: "gold" },
}

const ENV = {
  id: "env_1",
  name: "Production",
  slug: "prod",
  type: "production",
  isDefault: true,
  createdAt: START,
  updatedAt: START,
  appId: "app_1",
  description: "Live traffic",
  color: "green",
  metadata: { region: "eu" },
}

const SESSION = {
  id: "ses_1",
  userId: "usr_1",
  ipAddress: "10.0.0.1",
  userAgent: "Mozilla/5.0",
  lastActivityAt: START,
  expiresAt: START,
  createdAt: START,
  appId: "app_1",
}

const DEVICE = {
  id: "dev_1",
  userId: "usr_1",
  name: "Ada's laptop",
  type: "laptop",
  browser: "Firefox",
  os: "Linux",
  ipAddress: "10.0.0.2",
  trusted: false,
  lastSeenAt: START,
  createdAt: START,
}

const ROLE = {
  id: "role_1",
  name: "Admin",
  slug: "admin",
  description: "Everything",
  createdAt: START,
  updatedAt: START,
  permissions: [{ id: "perm_1", action: "read", resource: "users" }],
}

const WEBHOOK = {
  id: "wh_1",
  url: "https://example.com/hook",
  events: ["user.created"],
  active: true,
  createdAt: START,
}

const NAMESPACE = {
  namespace: "password",
  displayName: "Password",
  scope: "app",
  categories: [
    {
      name: "Strength",
      settings: [
        {
          key: "min_length",
          displayName: "Minimum length",
          type: "int",
          effectiveValue: 12,
          isOverridden: true,
          isEnforced: false,
          canOverride: true,
          order: 1,
        },
      ],
    },
    {
      name: "Hashing",
      settings: [
        {
          key: "algorithm",
          displayName: "Algorithm",
          type: "string",
          effectiveValue: "argon2",
          isOverridden: false,
          isEnforced: true,
          canOverride: false,
          order: 2,
        },
      ],
    },
  ],
}

/** The page's own h1 has arrived, so the sections after it can be checked. */
async function h1() {
  await screen.findByRole("heading", { level: 1 })
}

/**
 * The shared-layout guard first, then the regions the page is expected to
 * expose by name. The regions matter for a page with no h2 or table, where
 * the guard alone has nothing to flag.
 */
function expectLayout(container: HTMLElement, regions: string[] = []) {
  expect(layoutViolations(container)).toEqual([])
  for (const name of regions) {
    expect(screen.getByRole("region", { name })).toBeTruthy()
  }
}

describe("core pages follow the shared layout", () => {
  it("App overview follows the shared layout", async () => {
    const { client } = stubClient({
      "overview.stats": { users: 42, sessions: 7, devices: 3, plugins: 2 },
      "overview.recentSignups": { users: [USER] },
    })
    const { container } = renderPage(AuthOverviewPage, client)
    await h1()
    await screen.findByText("42")
    await screen.findByText("ada@example.com")
    expectLayout(container, ["Recent signups"])
  })

  it("App overview with plugin widgets follows the shared layout", async () => {
    const { client } = stubClient({
      "overview.stats": { users: 42, sessions: 7, devices: 3, plugins: 2 },
      "overview.recentSignups": { users: [USER] },
    })
    const widgets = defineSubPlugin({
      extension: "widgets",
      host: "authsome",
      hostIntents: [],
      contributions: {
        "overview.widgets": [
          {
            id: "counts",
            render: () => (
              <StatGrid items={[{ label: "Pending", value: "9" }]} />
            ),
          },
        ],
      },
    })
    const { container } = render(
      <SubPluginProvider
        entries={[{ subPlugin: widgets, client, hostClient: client }]}
      >
        <PluginProvider client={client}>
          <AuthOverviewPage />
        </PluginProvider>
      </SubPluginProvider>
    )
    await h1()
    await screen.findByText("ada@example.com")
    expect(
      await screen.findByRole("region", { name: "More from your plugins" })
    ).toBeTruthy()
    expectLayout(container)
  })

  it("Users follows the shared layout", async () => {
    const { client } = stubClient({
      "users.list": { users: [USER], total: 1 },
    })
    const { container } = renderPage(AuthUsersPage, client)
    await h1()
    await screen.findByText("ada@example.com")
    expectLayout(container, ["User list"])
  })

  it("User detail follows the shared layout", async () => {
    const { client } = stubClient({
      "users.detail": USER,
      "sessions.list": { sessions: [SESSION] },
      "devices.list": { devices: [DEVICE] },
    })
    const { container } = renderPage(AuthUserDetailPage, client, {
      id: "usr_1",
    })
    await h1()
    await screen.findByText("10.0.0.1")
    await screen.findByText("Firefox")
    await screen.findByRole("button", { name: "Save changes" })
    expectLayout(container, ["Details", "Sessions", "Devices", "Edit"])
  })

  it("New user follows the shared layout", async () => {
    const { client } = stubClient({})
    const { container } = renderPage(AuthUserCreatePage, client)
    await h1()
    expectLayout(container, ["Account details"])
  })

  it("Apps follows the shared layout", async () => {
    const { client } = stubClient({ "apps.list": { apps: [APP] } })
    const { container } = renderPage(AuthAppsPage, client)
    await h1()
    await screen.findByText("acme")
    expectLayout(container, ["App list"])
  })

  it("App picker follows the shared layout", async () => {
    const { client } = stubClient({
      "apps.context": { availableApps: [APP] },
    })
    const { container } = renderPage(AuthAppPicker, client)
    await h1()
    await screen.findByText("Acme")
    expectLayout(container, ["App list"])
  })

  it("App detail follows the shared layout", async () => {
    const { client } = stubClient({ "apps.detail": APP })
    const { container } = renderPage(AuthAppDetailPage, client, {
      id: "app_1",
    })
    await h1()
    await screen.findByRole("button", { name: "Save changes" })
    expectLayout(container, ["Details", "Edit"])
  })

  it("New app follows the shared layout", async () => {
    const { client } = stubClient({})
    const { container } = renderPage(AuthAppCreatePage, client)
    await h1()
    expectLayout(container, ["Application details"])
  })

  it("Credentials follows the shared layout", async () => {
    const { client } = stubClient({
      "credentials.detail": {
        appId: "app_1",
        appName: "Acme",
        appSlug: "acme",
        publishableKey: "pk_live_123",
        envName: "Production",
        envSlug: "prod",
        isPlatform: false,
      },
    })
    const { container } = renderPage(AuthCredentialsPage, client)
    await h1()
    await screen.findByText("pk_live_123")
    expectLayout(container, ["Details"])
  })

  it("Environments follows the shared layout", async () => {
    const { client } = stubClient({
      "environments.list": { environments: [ENV] },
    })
    const { container } = renderPage(AuthEnvironmentsPage, client)
    await h1()
    await screen.findByText("prod")
    expectLayout(container, ["Environment list"])

    // The inline create form is a section too.
    fireEvent.click(screen.getByRole("button", { name: "New environment" }))
    await screen.findByRole("button", { name: "Create environment" })
    expectLayout(container, ["New environment"])
  })

  it("Environment detail follows the shared layout", async () => {
    const { client } = stubClient({ "environments.detail": ENV })
    const { container } = renderPage(AuthEnvironmentDetailPage, client, {
      id: "env_1",
    })
    await h1()
    await screen.findByRole("button", { name: "Save changes" })
    expectLayout(container, ["Details", "Edit"])
  })

  it("Roles follows the shared layout", async () => {
    const { client } = stubClient({
      "roles.list": { roles: [ROLE] },
    })
    const { container } = renderPage(AuthRolesPage, client)
    await h1()
    await screen.findByText("admin")
    expectLayout(container, ["Role list"])

    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    await screen.findByRole("button", { name: "Create role" })
    expectLayout(container, ["New role"])
  })

  it("Role detail follows the shared layout", async () => {
    const { client } = stubClient({ "roles.detail": ROLE })
    const { container } = renderPage(AuthRoleDetailPage, client, {
      id: "role_1",
    })
    await h1()
    await screen.findByText("users")
    await screen.findByRole("button", { name: "Assign" })
    expectLayout(container, [
      "Details",
      "Permissions",
      "Edit",
      "Assign to a user",
      "Remove from a user",
    ])
  })

  it("Sessions follows the shared layout", async () => {
    const { client } = stubClient({ "sessions.list": { sessions: [SESSION] } })
    const { container } = renderPage(AuthSessionsPage, client)
    await h1()
    await screen.findByText("ses_1")
    expectLayout(container, ["Session list"])
  })

  it("Session detail follows the shared layout", async () => {
    const { client } = stubClient({ "sessions.detail": SESSION })
    const { container } = renderPage(AuthSessionDetailPage, client, {
      id: "ses_1",
    })
    await h1()
    await screen.findByText("Mozilla/5.0")
    expectLayout(container, ["Details"])
  })

  it("Devices follows the shared layout", async () => {
    const { client } = stubClient({ "devices.list": { devices: [DEVICE] } })
    const { container } = renderPage(AuthDevicesPage, client)
    await h1()
    await screen.findByText("Firefox")
    expectLayout(container, ["Device list"])
  })

  it("Device detail follows the shared layout", async () => {
    const { client } = stubClient({ "devices.detail": DEVICE })
    const { container } = renderPage(AuthDeviceDetailPage, client, {
      id: "dev_1",
    })
    await h1()
    await screen.findByText("Firefox")
    await screen.findByRole("button", { name: /^Forget/ })
    expectLayout(container, ["Details", "Actions"])
  })

  it("Dynamic signup form follows the shared layout", async () => {
    const { client } = stubClient({
      "auth.dynamicConfig": {
        title: "Create your account",
        description: "Tell us a bit about your team.",
        active: true,
        fields: [{ key: "email", label: "Email", type: "email", order: 1 }],
      },
    })
    const { container } = renderPage(AuthDynamicClientsPage, client)
    await h1()
    await screen.findByText("Create your account")
    await screen.findByText("1 field")
    expectLayout(container, ["Create your account"])
  })

  it("Features follows the shared layout", async () => {
    const { client } = stubClient({
      "auth.featureToggles": {
        toggles: [
          {
            key: "mfa",
            label: "Multi-factor",
            description: "Second factor",
            enabled: true,
            available: true,
          },
        ],
      },
    })
    const { container } = renderPage(AuthFeaturesPage, client)
    await h1()
    await screen.findByText("Multi-factor")
    expectLayout(container, ["Sign-in methods"])
  })

  it("Extensions follows the shared layout", async () => {
    const { client } = stubClient({
      "plugins.list": { plugins: [{ name: "password", settingCount: 3 }] },
    })
    const { container } = renderPage(AuthPluginsPage, client)
    await h1()
    await screen.findByText("password")
    expectLayout(container, ["Extension list"])
  })

  it("Settings follows the shared layout", async () => {
    const { client } = stubClient({
      "settings.namespaces": {
        namespaces: [
          {
            name: "password",
            displayName: "Password",
            description: "Password rules",
            settingCount: 2,
          },
        ],
      },
      "settings.namespace": NAMESPACE,
    })
    const { container } = renderPage(AuthSettingsPage, client)
    await h1()
    await screen.findByText("Password rules")
    // The first namespace's form is mounted in the plugin settings tabs.
    await screen.findByLabelText("Minimum length")
    expectLayout(container, ["Configuration namespaces", "Plugin settings"])
  })

  it("Settings namespace follows the shared layout", async () => {
    const { client } = stubClient({ "settings.namespace": NAMESPACE })
    const { container } = renderPage(AuthSettingsNamespacePage, client, {
      namespace: "password",
    })
    await h1()
    await screen.findByLabelText("Minimum length")
    expectLayout(container, ["Strength", "Hashing"])
  })

  it("Signup forms follows the shared layout", async () => {
    const { client } = stubClient({
      "formConfigs.list": {
        formConfigs: [
          {
            id: "fc_1",
            formType: "signup",
            version: 3,
            active: true,
            createdAt: START,
          },
        ],
      },
    })
    const { container } = renderPage(AuthSignupFormsPage, client)
    await h1()
    await screen.findByText("signup")
    expectLayout(container, ["Signup form list"])
  })

  it("Edit signup form follows the shared layout", async () => {
    // An outlier: the page is a field editor, not a table. It keeps its own
    // body and only the field block gets a section.
    const { client } = stubClient({
      "formConfigs.signup": {
        fields: [
          { key: "email", label: "Email", type: "text", order: 1 },
          { key: "name", label: "Name", type: "text", order: 2 },
        ],
        updatedAt: START,
      },
    })
    const { container } = renderPage(AuthSignupFormEditorPage, client)
    await h1()
    await screen.findByDisplayValue("email")
    expectLayout(container, ["Fields"])
  })

  it("Webhooks follows the shared layout", async () => {
    const { client } = stubClient({
      "webhooks.list": { webhooks: [WEBHOOK] },
    })
    const { container } = renderPage(AuthWebhooksPage, client)
    await h1()
    await screen.findByText("https://example.com/hook")
    expectLayout(container, ["Webhook list"])

    // The inline create and edit panels are sections too.
    fireEvent.click(screen.getByRole("button", { name: "New webhook" }))
    await screen.findByRole("button", { name: "Create webhook" })
    expectLayout(container, ["New webhook"])

    fireEvent.click(
      screen.getByRole("button", { name: "Edit https://example.com/hook" })
    )
    await screen.findByRole("button", { name: "Save changes" })
    expectLayout(container, ["Edit webhook"])
  })
})
