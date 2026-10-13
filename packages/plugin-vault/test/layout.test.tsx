import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { PluginPageProps, ScopedClient } from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import type { ComponentType } from "react"
import { AuditPage } from "../src/pages/audit"
import { ConfigCreatePage } from "../src/pages/config-create"
import ConfigDetailPage from "../src/pages/config-detail"
import { ConfigPage } from "../src/pages/config"
import { FlagCreatePage } from "../src/pages/flag-create"
import { FlagDetailPage } from "../src/pages/flag-detail"
import { FlagsPage } from "../src/pages/flags"
import { OverridesPage } from "../src/pages/overrides"
import { OverviewPage } from "../src/pages/overview"
import { RotationDetailPage } from "../src/pages/rotation-detail"
import { RotationPage } from "../src/pages/rotation"
import { SecretCreatePage } from "../src/pages/secret-create"
import { SecretDetailPage } from "../src/pages/secret-detail"
import { SecretsPage } from "../src/pages/secrets"
import { stubClient } from "./harness"

afterEach(cleanup)

/**
 * The shared rules (one h1, every h2 and table in a section, no section in a
 * section), then the section regions the page is expected to have. A form or a
 * facts page has no h2 or table, so it would pass the first check unconverted;
 * the regions are what make it fail first.
 */
function expectLayout(
  container: HTMLElement,
  regions: string[] = [],
  groups: string[] = []
) {
  expect(layoutViolations(container)).toEqual([])
  for (const name of regions)
    expect(screen.getByRole("region", { name })).toBeTruthy()
  for (const name of groups)
    expect(screen.getByRole("group", { name })).toBeTruthy()
}

/** Renders a page inside the plugin and navigation providers, the way the host does. */
function show(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"] = {}
) {
  return render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate: vi.fn(),
        }}
      >
        <Page params={params} />
      </NavigationProvider>
    </PluginProvider>
  )
}

const SECRET_KEY = "db/primary.password"
const FLAG_KEY = "checkout/new-flow"
const CONFIG_KEY = "app/http.timeout"

const AUDIT_ROW = {
  id: "aud_01",
  action: "secret.set",
  resource: "secret",
  key: SECRET_KEY,
  outcome: "success",
  userId: "u_rex",
  createdAt: "2026-09-23T10:00:00Z",
}

const SECRET = {
  id: "sec_01",
  key: SECRET_KEY,
  version: 3,
  encryptionAlg: "AES-256-GCM",
  appId: "app_1",
  metadata: { team: "payments" },
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}

const POLICY = {
  id: "pol_01",
  secretKey: SECRET_KEY,
  intervalSeconds: 86400,
  enabled: true,
  rotatable: true,
  lastRotatedAt: "2026-09-22T04:00:00Z",
  nextRotationAt: "2026-10-01T04:00:00Z",
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-22T04:00:00Z",
}

const FLAG = {
  id: "flg_01",
  key: FLAG_KEY,
  type: "bool",
  defaultValue: false,
  defaultMatchesType: true,
  description: "The new checkout flow",
  tags: ["checkout"],
  enabled: true,
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}

const CONFIG_ENTRY = {
  id: "cfg_01",
  key: CONFIG_KEY,
  value: "30s",
  valueType: "duration",
  knownType: true,
  valueMatchesType: true,
  version: 3,
  description: "How long a request may take",
  metadata: { owner: "platform" },
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}

const CONFIG_OVERRIDE = {
  key: CONFIG_KEY,
  tenantId: "acme",
  value: "5s",
  valueMatchesType: true,
  keyExists: true,
  updatedAt: "2026-09-22T10:00:00Z",
}

describe("Vault pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { container } = show(
      OverviewPage,
      stubClient({
        "overview.stats": {
          secrets: 12,
          unencryptedSecrets: 2,
          flags: 5,
          configEntries: 7,
          configOverrides: 3,
          rotationPolicies: 4,
          rotationEnabled: 3,
          rotationOverdue: 0,
          rotationWithoutRotator: 0,
          rotationFailures24h: 0,
          plaintextVersions: 0,
          unrecordedVersions: 0,
          expiredSecrets: 0,
          expiringSecrets: 0,
          encryptionEnabled: true,
          encryptionAlgorithm: "AES-256-GCM",
          recentActivity: [AUDIT_ROW],
        },
      })
    )
    await screen.findByText("secret.set")
    expectLayout(
      container,
      ["Needs attention", "Recent activity"],
      ["Vault counters"]
    )
  })

  it("Secrets follows the shared layout", async () => {
    const { container } = show(
      SecretsPage,
      stubClient({
        "secrets.list": {
          secrets: [
            SECRET,
            { ...SECRET, id: "sec_02", key: "legacy", encryptionAlg: "" },
          ],
          total: 2,
        },
      })
    )
    await screen.findByText("legacy")
    expectLayout(container, ["Secret list"])
  })

  it("New secret follows the shared layout", () => {
    const { container } = show(SecretCreatePage, stubClient({}))
    expectLayout(container, ["Secret details"])
  })

  it("Secret detail follows the shared layout", async () => {
    const { container } = show(
      SecretDetailPage,
      stubClient({
        "secrets.detail": {
          secret: SECRET,
          rotation: POLICY,
          recentAudit: [AUDIT_ROW],
        },
        "secrets.versions": {
          versions: [
            {
              id: "v3",
              version: 3,
              createdBy: "usr_1",
              createdAt: "2026-09-23T10:00:00Z",
              encryption: "encrypted",
            },
          ],
        },
      }),
      { key: SECRET_KEY }
    )
    await screen.findByText(/Versions \(1\)/)
    await screen.findByText("secret.set")
    expectLayout(container, [
      "Details",
      "Versions (1)",
      "Rotation",
      "Recent activity",
    ])
  })

  it("Flags follows the shared layout", async () => {
    const { container } = show(
      FlagsPage,
      stubClient({ "flags.list": { flags: [FLAG], total: 1 } })
    )
    await screen.findByText(FLAG_KEY)
    expectLayout(container, ["Flag list"])
  })

  it("New flag follows the shared layout", () => {
    const { container } = show(FlagCreatePage, stubClient({}))
    expectLayout(container, ["Flag details"])
  })

  it("Flag detail follows the shared layout", async () => {
    const { container } = show(
      FlagDetailPage,
      stubClient({
        "flags.detail": {
          flag: FLAG,
          variants: [],
          metadata: {},
          rules: [
            {
              id: "rul_1",
              priority: 0,
              type: "when_tenant",
              implemented: true,
              tenantIds: ["t-beta"],
              userIds: [],
              percentage: 0,
              returnValue: true,
              returnMatchesType: true,
            },
          ],
          overrides: [
            {
              tenantId: "t-acme",
              value: true,
              valueMatchesType: true,
              updatedAt: "2026-09-22T10:00:00Z",
            },
          ],
          recentAudit: [{ ...AUDIT_ROW, action: "flag.update" }],
          cacheTtlSeconds: 30,
        },
      }),
      { key: FLAG_KEY }
    )
    await screen.findByText("t-acme")
    await screen.findByText("flag.update")
    expectLayout(container, [
      "Definition",
      "Evaluation",
      "Enabled",
      "Tenant overrides",
      "Rules",
      "Default",
      "Recent activity",
    ])
  })

  it("Config follows the shared layout", async () => {
    const { container } = show(
      ConfigPage,
      stubClient({ "config.list": { entries: [CONFIG_ENTRY], total: 1 } })
    )
    await screen.findByText(CONFIG_KEY)
    expectLayout(container, ["Config entry list"])
  })

  it("New config entry follows the shared layout", () => {
    const { container } = show(ConfigCreatePage, stubClient({}))
    expectLayout(container, ["Config entry details"])
  })

  it("Config detail follows the shared layout", async () => {
    const { container } = show(
      ConfigDetailPage,
      stubClient({
        "config.detail": {
          entry: CONFIG_ENTRY,
          overrides: [CONFIG_OVERRIDE],
          recentAudit: [{ ...AUDIT_ROW, action: "config.update" }],
        },
        "config.versions": {
          versions: [
            {
              version: 3,
              value: "30s",
              valueMatchesType: true,
              createdAt: "2026-09-23T10:00:00Z",
              current: true,
            },
            {
              version: 2,
              value: "20s",
              valueMatchesType: true,
              createdAt: "2026-09-22T10:00:00Z",
              current: false,
            },
          ],
        },
      }),
      { key: CONFIG_KEY }
    )
    await screen.findByText("v2")
    await screen.findByText("config.update")
    expectLayout(container, [
      "Definition",
      "Value",
      "Overrides",
      "Resolve",
      "Versions",
      "Recent activity",
    ])
  })

  it("Overrides follows the shared layout", async () => {
    const { container } = show(
      OverridesPage,
      stubClient({
        "overrides.list": { overrides: [CONFIG_OVERRIDE], total: 1 },
      })
    )
    // Before a choice there is a lookup and a prompt, no rows.
    expectLayout(container, ["Override lookup", "Override list"])
    fireEvent.change(screen.getByLabelText("Tenant id"), {
      target: { value: "acme" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Show overrides for a tenant" })
    )
    await screen.findByText(CONFIG_KEY)
    expectLayout(container, ["Override lookup", "Override list"])
  })

  it("Rotation follows the shared layout", async () => {
    const { container } = show(
      RotationPage,
      stubClient({ "rotation.policies": { policies: [POLICY], total: 1 } })
    )
    await screen.findByText(SECRET_KEY)
    expectLayout(container, ["Rotation policy list"])
  })

  it("Rotation detail follows the shared layout", async () => {
    const { container } = show(
      RotationDetailPage,
      stubClient({
        "rotation.detail": {
          policy: POLICY,
          rotatable: true,
          records: [
            {
              id: "rec_1",
              oldVersion: 2,
              newVersion: 3,
              rotatedBy: "usr_1",
              rotatedAt: "2026-09-22T04:00:00Z",
            },
          ],
        },
      }),
      { key: SECRET_KEY }
    )
    await screen.findByText("v2 → v3")
    expectLayout(container, ["Policy", "Rotate now", "Rotation history"])
  })

  it("Audit follows the shared layout", async () => {
    const { container } = show(
      AuditPage,
      stubClient({ "audit.list": { entries: [AUDIT_ROW], total: 1 } })
    )
    await screen.findByText("secret.set")
    expectLayout(container, ["Audit log"])
  })
})
