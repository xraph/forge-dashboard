import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  HostAccessProvider,
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
import { SETTINGS_INTENTS, settingsPanelFor } from "../src/sub/settings-panel"
import {
  APIKeyCreatePage,
  APIKeyDetailPage,
  APIKeyListPage,
} from "../src/sub/apikey"
import {
  BillingFeaturesPage,
  CouponsPage,
  InvoiceDetailPage,
  InvoicesPage,
  PlanCreatePage,
  PlanEditPage,
  SubscriptionDetailPage,
  SubscriptionsPage,
} from "../src/sub/billing"
import { ConsentsPage, consentSubPlugin } from "../src/sub/consent"
import {
  NotificationCreatePage,
  NotificationDetailPage,
  NotificationSendPage,
  NotificationsPage,
} from "../src/sub/notification"
import {
  OrgCreatePage,
  OrgDetailPage,
  OrgListPage,
  organizationSubPlugin,
} from "../src/sub/organization"
import { PasswordPolicyPage } from "../src/sub/password"
import {
  PlanDetailPage,
  PlansPage,
  subscriptionSubPlugin,
} from "../src/sub/subscription"
import { WaitlistPage, waitlistSubPlugin } from "../src/sub/waitlist"
import { renderPage, stubClient } from "./harness"
import { renderSubPage, subStubClient } from "./sub/harness"

// Every core page, rendered with data the way its own test renders it, must
// follow the shared layout: one h1, every h2 and table inside a kit Section,
// no Section inside a Section. The sub-plugin pages follow the core ones.

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

  it("User detail with installed plugin sections follows the shared layout", async () => {
    const { client } = stubClient({
      "users.detail": USER,
      "sessions.list": { sessions: [SESSION] },
      "devices.list": { devices: [DEVICE] },
    })
    const sections = defineSubPlugin({
      extension: "sections",
      host: "authsome",
      hostIntents: [],
      contributions: {
        "user.detail.sections": [
          { id: "note", render: () => <p>Guest section</p> },
        ],
      },
    })
    const { container } = render(
      <SubPluginProvider
        entries={[{ subPlugin: sections, client, hostClient: client }]}
      >
        <PluginProvider client={client}>
          <AuthUserDetailPage params={{ id: "usr_1" }} />
        </PluginProvider>
      </SubPluginProvider>
    )
    await h1()
    await screen.findByText("Guest section")
    await screen.findByText("10.0.0.1")
    await screen.findByText("Firefox")
    expect(
      screen.getByRole("heading", { level: 3, name: "From installed plugins" })
    ).toBeTruthy()
    expectLayout(container, ["Details", "Sessions", "Devices", "Edit"])
  })

  it("Settings with an embedded sub settings panel follows the shared layout", async () => {
    // A sub-plugin's panel is a tab inside the "Plugin settings" section, so
    // its groups must not be sections of their own.
    const host = stubClient({
      "settings.namespaces": { namespaces: [] },
      "settings.namespace": NAMESPACE,
    })
    const sub = defineSubPlugin({
      extension: "password",
      host: "authsome",
      hostIntents: [...SETTINGS_INTENTS],
      contributions: {
        "settings.tabs": [
          {
            id: "password",
            label: "Password",
            render: settingsPanelFor("password"),
          },
        ],
      },
    })
    const { container } = render(
      <PluginProvider client={host.client}>
        <SubPluginProvider
          entries={[
            {
              subPlugin: sub,
              client: stubClient({}).client,
              hostClient: host.client,
            },
          ]}
        >
          <AuthSettingsPage />
        </SubPluginProvider>
      </PluginProvider>
    )
    await h1()
    await screen.findByLabelText("Minimum length")
    expectLayout(container, ["Configuration namespaces", "Plugin settings"])
  })
})

describe("sub-plugin pages follow the shared layout", () => {
  const nobody = () => subStubClient({}).client

  function sub(
    Page: Parameters<typeof renderSubPage>[0],
    queries: Record<string, unknown>,
    params: Record<string, string | undefined> = {},
    commands: Record<string, unknown> = {}
  ) {
    return renderSubPage(Page, {
      client: subStubClient(queries, commands).client,
      hostClient: nobody(),
      allowed: [],
      params,
    })
  }

  const KEY = {
    id: "key_1",
    name: "CI key",
    keyPrefix: "ak_live_1",
    scopes: ["read"],
    revoked: false,
    createdAt: START,
  }

  const PLAN = {
    id: "p1",
    name: "Pro",
    slug: "pro",
    status: "active",
    currency: "usd",
    trialDays: 14,
    baseAmount: 2900,
    billingPeriod: "monthly",
    features: [
      {
        key: "seats",
        name: "Seats",
        type: "seat",
        limit: 5,
        period: "none",
      },
    ],
    tiers: [
      {
        featureKey: "seats",
        type: "graduated",
        upTo: 10,
        unitAmount: 100,
        flatAmount: 0,
      },
    ],
  }

  const SUBSCRIPTION = {
    id: "sub_1",
    tenantId: "ten_1",
    planId: "p1",
    status: "active",
    currentPeriodStart: START,
    currentPeriodEnd: START,
  }

  const INVOICE = {
    id: "inv_1",
    tenantId: "ten_1",
    subscriptionId: "sub_1",
    status: "open",
    currency: "usd",
    total: 2900,
  }

  const ORG = {
    id: "o1",
    name: "Acme Inc",
    slug: "acme",
    createdAt: START,
    updatedAt: START,
    appId: "app_1",
    metadata: { plan: "gold" },
  }

  const TEMPLATE = {
    id: "tpl_1",
    slug: "welcome",
    name: "Welcome",
    channel: "email",
    category: "auth",
    enabled: true,
    is_system: false,
    versions: [
      {
        id: "ver_1",
        template_id: "tpl_1",
        locale: "en",
        subject: "Hello",
        active: true,
      },
    ],
  }

  it("API keys follows the shared layout", async () => {
    const { container } = sub(APIKeyListPage, {
      "apikeys.list": { apiKeys: [KEY] },
    })
    await h1()
    await screen.findByText("ak_live_1...")
    expectLayout(container, ["API key list"])
  })

  it("API key detail follows the shared layout", async () => {
    const { container } = sub(
      APIKeyDetailPage,
      {
        "apikeys.detail": {
          ...KEY,
          publicKey: "pub_123",
          userId: "usr_1",
          updatedAt: START,
        },
      },
      { id: "key_1" }
    )
    await h1()
    await screen.findByText("pub_123")
    expectLayout(container, ["Details"])
  })

  it("New API key follows the shared layout", async () => {
    const { container } = sub(APIKeyCreatePage, {})
    await h1()
    expectLayout(container, ["Key details"])
  })

  it("New API key secret reveal follows the shared layout", async () => {
    const { container } = sub(
      APIKeyCreatePage,
      { "apikeys.detail": { ...KEY, publicKey: "pub_123", updatedAt: START } },
      {},
      {
        "apikeys.create": {
          ok: true,
          id: "key_1",
          keyPrefix: "ak_live_1",
          secret: "sk_secret_value",
        },
      }
    )
    await h1()
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "CI key" },
    })
    fireEvent.change(screen.getByLabelText("User ID"), {
      target: { value: "usr_1" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create key" }))
    await screen.findByText("sk_secret_value")
    await screen.findByText("pub_123")
    expectLayout(container, ["API key created"])
  })

  it("Consent follows the shared layout", async () => {
    const { container } = sub(ConsentsPage, {
      "consent.list": {
        items: [
          {
            id: "c1",
            userId: "usr_1",
            purpose: "marketing",
            granted: true,
            version: "v1",
            grantedAt: START,
            createdAt: START,
          },
        ],
      },
    })
    await h1()
    await screen.findByRole("button", { name: "Revoke marketing for usr_1" })
    expectLayout(container, ["Consent list"])
  })

  it("Waitlist follows the shared layout", async () => {
    const { container } = sub(WaitlistPage, {
      "waitlist.list": {
        entries: [
          {
            id: "w1",
            email: "wait@example.com",
            status: "pending",
            createdAt: START,
          },
        ],
        total: 1,
      },
    })
    await h1()
    await screen.findByText("wait@example.com")
    expectLayout(container, ["Waitlist entry list"])
  })

  it("Organizations follows the shared layout", async () => {
    const { container } = sub(OrgListPage, {
      "orgs.list": {
        organizations: [
          { id: "o1", name: "Acme Inc", slug: "acme", createdAt: START },
        ],
      },
    })
    await h1()
    await screen.findByText("Acme Inc")
    expectLayout(container, ["Organization list"])
  })

  it("New organization follows the shared layout", async () => {
    const { container } = sub(OrgCreatePage, {})
    await h1()
    expectLayout(container, ["Organization details"])
  })

  it("Organization detail follows the shared layout", async () => {
    const { container } = sub(
      OrgDetailPage,
      {
        "orgs.detail": ORG,
        "orgs.members": {
          members: [
            { id: "m1", userId: "usr_1", role: "owner", createdAt: START },
          ],
        },
        "orgs.invitations": {
          invitations: [
            {
              id: "i1",
              email: "new@example.com",
              role: "member",
              status: "pending",
              createdAt: START,
              expiresAt: START,
            },
          ],
        },
      },
      { id: "o1" }
    )
    await h1()
    await screen.findByText("gold", { exact: false })
    await screen.findByText(/members? in this organization/)
    expectLayout(container, ["Organization details", "People"])

    // The Members tab holds the member and invitation tables.
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    await screen.findAllByText("usr_1")
    await screen.findAllByText("new@example.com")
    expectLayout(container, ["Members", "Invitations"])
  })

  it("Organization detail with billing contributions follows the shared layout", async () => {
    const orgClient = subStubClient({
      "orgs.detail": ORG,
      "orgs.members": { members: [] },
    }).client
    const billing = subStubClient({
      "subscriptions.list": { subscriptions: [SUBSCRIPTION] },
      "plans.list": { plans: [PLAN] },
    }).client
    const { container } = render(
      <SubPluginProvider
        entries={[
          {
            subPlugin: subscriptionSubPlugin,
            client: billing,
            hostClient: orgClient,
          },
        ]}
      >
        <HostAccessProvider
          value={{
            client: orgClient,
            allowed: [],
            subExtension: "organization",
          }}
        >
          <PluginProvider client={orgClient}>
            <OrgDetailPage params={{ id: "o1" }} />
          </PluginProvider>
        </HostAccessProvider>
      </SubPluginProvider>
    )
    await h1()
    // The summary on the overview tab, then the contributed tab.
    await screen.findByText("1 subscription")
    expectLayout(container, ["Organization details", "People", "Billing"])

    fireEvent.click(screen.getByRole("tab", { name: "Billing" }))
    await screen.findByText("Period ends", { exact: false })
    expectLayout(container, ["Subscriptions"])
  })

  it("Plans follows the shared layout", async () => {
    const { container } = sub(PlansPage, { "plans.list": { plans: [PLAN] } })
    await h1()
    await screen.findByText("Pro")
    expectLayout(container, ["Plan list"])
  })

  it("Plan detail follows the shared layout", async () => {
    const { container } = sub(
      PlanDetailPage,
      { "plans.detail": PLAN },
      { id: "p1" }
    )
    await h1()
    await screen.findByText("Seats")
    await screen.findByText("graduated")
    expectLayout(container, ["Details", "Features", "Pricing tiers"])
  })

  it("New plan follows the shared layout", async () => {
    const { container } = sub(PlanCreatePage, {
      "features.list": { features: [] },
    })
    await h1()
    expectLayout(container, [
      "Plan details",
      "Pricing",
      "Entitlements",
      "Usage pricing tiers",
    ])
  })

  it("Edit plan follows the shared layout", async () => {
    const { container } = sub(
      PlanEditPage,
      { "plans.detail": PLAN, "features.list": { features: [] } },
      { id: "p1" }
    )
    await h1()
    await screen.findByDisplayValue("Pro")
    expectLayout(container, ["Plan details", "Entitlements"])
  })

  it("Subscriptions follows the shared layout", async () => {
    const { container } = sub(SubscriptionsPage, {
      "subscriptions.all": { subscriptions: [SUBSCRIPTION] },
      "plans.list": { plans: [PLAN] },
    })
    await h1()
    await screen.findByText("ten_1")
    expectLayout(container, ["Create subscription", "Subscription list"])

    // The inline plan change opens a section of its own.
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }))
    await screen.findByRole("button", { name: "Apply plan" })
    expectLayout(container, ["Change plan"])
  })

  it("Subscription detail follows the shared layout", async () => {
    const { container } = sub(
      SubscriptionDetailPage,
      {
        "subscriptions.detail": {
          ...SUBSCRIPTION,
          planName: "Pro",
          usage: [
            {
              featureKey: "seats",
              featureName: "Seats",
              featureType: "seat",
              used: 2,
              limit: 5,
              remaining: 3,
              period: "none",
            },
          ],
          invoices: [INVOICE],
        },
        "plans.list": { plans: [PLAN] },
      },
      { id: "sub_1" }
    )
    await h1()
    await screen.findByText("Seats")
    await screen.findByText("inv_1")
    expectLayout(container, [
      "Overview",
      "Manage subscription",
      "Usage",
      "Invoices",
    ])
  })

  it("Invoices follows the shared layout", async () => {
    const { container } = sub(InvoicesPage, {
      "invoices.list": { invoices: [INVOICE] },
      "subscriptions.all": { subscriptions: [SUBSCRIPTION] },
    })
    await h1()
    await screen.findByText("inv_1")
    expectLayout(container, ["Generate invoice", "Invoice list"])

    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }))
    await screen.findByRole("button", { name: "Confirm" })
    expectLayout(container, ["Mark paid inv_1"])
  })

  it("Invoice detail follows the shared layout", async () => {
    const { container } = sub(
      InvoiceDetailPage,
      {
        "invoices.detail": {
          ...INVOICE,
          subtotal: 2900,
          taxAmount: 0,
          discountAmount: 0,
          periodStart: "2026-09-01",
          periodEnd: "2026-10-01",
          lineItems: [
            {
              description: "Pro plan",
              type: "base",
              quantity: 1,
              unitAmount: 2900,
              amount: 2900,
            },
          ],
        },
      },
      { id: "inv_1" }
    )
    await h1()
    await screen.findByText("Pro plan")
    expectLayout(container, ["Invoice details", "Line items", "Record outcome"])
  })

  it("Coupons follows the shared layout", async () => {
    const { container } = sub(CouponsPage, {
      "coupons.list": {
        coupons: [
          {
            id: "cp1",
            code: "SAVE10",
            name: "Ten off",
            type: "percentage",
            amount: 0,
            percentage: 10,
            currency: "usd",
            maxRedemptions: 5,
            timesRedeemed: 1,
          },
        ],
      },
    })
    await h1()
    await screen.findByText("SAVE10")
    expectLayout(container, ["Create coupon", "Coupon list"])
  })

  it("Feature catalog follows the shared layout", async () => {
    const { container } = sub(BillingFeaturesPage, {
      "features.list": {
        features: [
          {
            id: "f1",
            key: "seats",
            name: "Seats",
            description: "",
            type: "seat",
            defaultLimit: 5,
            period: "none",
            softLimit: false,
            status: "active",
          },
        ],
      },
    })
    await h1()
    await screen.findByText("seats")
    expectLayout(container, ["New catalog feature", "Feature list"])
  })

  it("Notifications follows the shared layout", async () => {
    const { container } = sub(NotificationsPage, {
      "notification.templates.list": { templates: [TEMPLATE] },
      "notification.mappings.list": {
        mappings: [
          {
            action: "auth.signup",
            template: "welcome",
            channels: ["email"],
            enabled: true,
          },
        ],
      },
    })
    await h1()
    await screen.findByRole("link", { name: "Welcome" })
    expectLayout(container, ["Template list"])
    // The captions name the tables for screen readers only.
    const templatesCaption = screen.getByText("Notification templates")
    expect(templatesCaption.tagName).toBe("CAPTION")
    expect(
      templatesCaption.closest('[data-slot="resource-table"]')?.className
    ).toContain("[&_caption]:sr-only")

    fireEvent.click(screen.getByRole("tab", { name: /Event mappings/ }))
    await screen.findByText("auth.signup")
    expectLayout(container, ["Event mapping list"])
    const mappingsCaption = screen.getByText("Notification event mappings")
    expect(mappingsCaption.tagName).toBe("CAPTION")
    expect(
      mappingsCaption.closest('[data-slot="resource-table"]')?.className
    ).toContain("[&_caption]:sr-only")
  })

  it("New notification template follows the shared layout", async () => {
    const { container } = sub(NotificationCreatePage, {})
    await h1()
    expectLayout(container, ["Template content"])
  })

  it("Notification template follows the shared layout", async () => {
    const { container } = sub(
      NotificationDetailPage,
      {
        "notification.templates.detail": TEMPLATE,
        "notification.templates.preview": { subject: "Hello", text: "Hi" },
      },
      { id: "tpl_1" }
    )
    await h1()
    await screen.findByText("Hi")
    expectLayout(container, ["Template", "Locale versions"])
  })

  it("Send notification follows the shared layout", async () => {
    const { container } = sub(NotificationSendPage, {
      "notification.templates.list": { templates: [TEMPLATE] },
    })
    await h1()
    await screen.findByLabelText("Template")
    expectLayout(container, ["Message"])
  })

  it("Password follows the shared layout", async () => {
    const own = subStubClient({
      "password.policy": {
        minLength: 12,
        requireSpecial: true,
        hashAlgorithm: "argon2id",
      },
    })
    const host = subStubClient({
      "settings.namespace": NAMESPACE,
    })
    const { container } = renderSubPage(PasswordPolicyPage, {
      client: own.client,
      hostClient: host.client,
      allowed: [...SETTINGS_INTENTS],
      params: {},
    })
    await h1()
    await screen.findByText("argon2id")
    await screen.findByLabelText("Minimum length")
    expectLayout(container, ["Password policy", "Strength", "Hashing"])
  })

  it("A routed sub settings panel follows the shared layout", async () => {
    const Panel = settingsPanelFor("password", "Risk engine")
    const host = subStubClient({ "settings.namespace": NAMESPACE })
    const { container } = renderSubPage(Panel, {
      client: nobody(),
      hostClient: host.client,
      allowed: [...SETTINGS_INTENTS],
      params: {},
    })
    await h1()
    await screen.findByLabelText("Minimum length")
    expectLayout(container, ["Strength", "Hashing"])
  })

  it("User detail with the consent and subscription sections follows the shared layout", async () => {
    const { client } = stubClient({
      "users.detail": USER,
      "sessions.list": { sessions: [SESSION] },
      "devices.list": { devices: [DEVICE] },
    })
    const consent = subStubClient({
      "consent.userConsents": {
        items: [
          {
            id: "c1",
            userId: "usr_1",
            purpose: "marketing",
            granted: true,
            createdAt: START,
          },
        ],
      },
    }).client
    const billing = subStubClient({
      "subscriptions.list": { subscriptions: [SUBSCRIPTION] },
      "plans.list": { plans: [PLAN] },
    }).client
    const { container } = render(
      <SubPluginProvider
        entries={[
          {
            subPlugin: consentSubPlugin,
            client: consent,
            hostClient: client,
          },
          {
            subPlugin: subscriptionSubPlugin,
            client: billing,
            hostClient: client,
          },
        ]}
      >
        <PluginProvider client={client}>
          <AuthUserDetailPage params={{ id: "usr_1" }} />
        </PluginProvider>
      </SubPluginProvider>
    )
    await h1()
    await screen.findByText("marketing")
    await screen.findByText("Pro")
    await screen.findByText("10.0.0.1")
    expect(
      screen.getByRole("heading", { level: 3, name: "From installed plugins" })
    ).toBeTruthy()
    expectLayout(container, ["Details", "Consent", "Subscriptions"])
  })

  it("Overview with the waitlist and organization widgets follows the shared layout", async () => {
    const { client } = stubClient({
      "overview.stats": { users: 42, sessions: 7, devices: 3, plugins: 2 },
      "overview.recentSignups": { users: [USER] },
    })
    const waitlist = subStubClient({
      "waitlist.counts": { pending: 4, approved: 2, rejected: 1 },
    }).client
    const orgs = subStubClient({
      "orgs.list": { organizations: [{ id: "o1" }, { id: "o2" }] },
    }).client
    const { container } = render(
      <SubPluginProvider
        entries={[
          {
            subPlugin: waitlistSubPlugin,
            client: waitlist,
            hostClient: client,
          },
          {
            subPlugin: organizationSubPlugin,
            client: orgs,
            hostClient: client,
          },
        ]}
      >
        <PluginProvider client={client}>
          <AuthOverviewPage />
        </PluginProvider>
      </SubPluginProvider>
    )
    await h1()
    await screen.findByText("ada@example.com")
    await screen.findByText("Pending")
    await screen.findByText("Organizations")
    expectLayout(container, ["More from your plugins"])
  })
})
