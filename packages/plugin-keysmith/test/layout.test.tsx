import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { KeysPage } from "../src/pages/keys"
import { OverviewPage } from "../src/pages/overview"
import { PoliciesPage } from "../src/pages/policies"
import { PolicyDetailPage } from "../src/pages/policy-detail"
import { RotationsPage } from "../src/pages/rotations"
import { ScopesPage } from "../src/pages/scopes"
import { SettingsPage } from "../src/pages/settings"
import { UsagePage } from "../src/pages/usage"
import type {
  EnforcementRow,
  KeySummary,
  Overview,
  PolicyDetail,
  PolicySummary,
  RotationItem,
  Settings,
  UsageSeries,
} from "../src/types"
import { renderPage, stubClient } from "./harness"

// Every page, rendered with data the way its own test renders it, must follow
// the shared layout: one h1, every h2 and table inside a kit Section.

function key(over: Partial<KeySummary> = {}): KeySummary {
  return {
    id: "akey_billing",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    policyId: "kpol_standard",
    scopes: ["billing:read"],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  }
}

function rotation(over: Partial<RotationItem> = {}): RotationItem {
  return {
    id: "krot_1",
    keyId: "akey_billing",
    keyName: "Billing service",
    prefix: "sk",
    environment: "live",
    oldHint: "9c1e",
    newHint: "a3f8",
    reason: "manual",
    graceSeconds: 86400,
    graceEnds: "2026-10-06T12:00:00Z",
    windowOpen: true,
    rotatedBy: "user_ops",
    rotatedAt: "2026-10-05T12:00:00Z",
    ...over,
  }
}

const POLICY: PolicySummary = {
  id: "kpol_standard",
  name: "Standard",
  maxKeyLifetimeSeconds: 90 * 86400,
  graceSeconds: 86400,
  allowedScopes: ["billing:read"],
}

const POLICIES = {
  policies: [POLICY],
  hasMore: false,
  rateLimiterConfigured: false,
}

const KEYS = { keys: [key()], total: 1 }

function overview(): Overview {
  return {
    counts: { active: 3, suspended: 1, revoked: 2, expired: 1 },
    openGraceWindows: 2,
    expiringWithin7Days: 1,
    requestsLast24h: 1234,
    recentKeys: [key()],
    recentRotations: [rotation()],
    enforcedFields: 3,
    policyFields: 13,
  }
}

const POLICY_DETAIL: PolicyDetail = {
  ...POLICY,
  description: "For services",
  rateLimit: 100,
  rateLimitWindowSeconds: 60,
  burstLimit: 20,
  allowedIps: ["10.0.0.0/8"],
  allowedOrigins: ["https://example.com"],
  allowedMethods: ["GET"],
  allowedPaths: ["/v1/billing"],
  rotationPeriodSeconds: 30 * 86400,
  dailyQuota: 1000,
  monthlyQuota: 20000,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
}

const ENFORCEMENT: EnforcementRow[] = [
  {
    field: "maxKeyLifetimeSeconds",
    label: "Max key lifetime",
    group: "keysmith",
    when: "when a key is created",
    enforced: true,
  },
  {
    field: "rateLimit",
    label: "Rate limit",
    group: "rateLimiter",
    when: "",
    enforced: false,
  },
  {
    field: "burstLimit",
    label: "Burst limit",
    group: "application",
    when: "",
    enforced: false,
  },
  // A group the page does not know is shown under its own name.
  {
    field: "futureField",
    label: "Future field",
    group: "future-group",
    when: "",
    enforced: false,
  },
]

const SETTINGS: Settings = {
  plugins: ["audit"],
  storeHealthy: true,
  storeMessage: "The store answered.",
  rateLimiterConfigured: false,
  tenantSource: "config",
  tenant: "acme",
  enforcement: ENFORCEMENT,
  enforcedFields: 1,
  defaultGraceSeconds: 86400,
}

const SERIES: UsageSeries = {
  period: "hourly",
  recorded: true,
  buckets: [
    {
      start: "2026-10-05T12:00:00Z",
      requests: 10,
      succeeded: 7,
      clientErrors: 2,
      serverErrors: 1,
      avgLatencyMs: 12,
    },
  ],
}

const RECORDS = {
  items: [
    {
      id: "kusg_1",
      keyId: "akey_billing",
      method: "GET",
      endpoint: "/v1/invoices",
      statusCode: 200,
      latencyMs: 12,
      ipAddress: "203.0.113.7",
      at: "2026-10-05T14:10:00Z",
    },
  ],
  total: 1,
}

describe("keysmith pages follow the shared layout", () => {
  it("API keys follows the shared layout", async () => {
    const { container } = renderPage(
      KeysPage,
      stubClient({ "keys.list": KEYS, "policies.list": POLICIES })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("Billing service")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Overview follows the shared layout", async () => {
    const { container } = renderPage(
      OverviewPage,
      stubClient({ overview: overview() })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("Recent keys")
    // The recent keys table and the recent rotations table both name it.
    expect(await screen.findAllByText("Billing service")).toHaveLength(2)
    expect(layoutViolations(container)).toEqual([])
  })

  it("Policies follows the shared layout", async () => {
    const { container } = renderPage(
      PoliciesPage,
      stubClient({ "policies.list": POLICIES })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("Standard")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Policy detail follows the shared layout", async () => {
    const client = stubClient({
      "policies.detail": {
        policy: POLICY_DETAIL,
        keysUsing: 1,
        keysBlockingDelete: 1,
        rateLimiterConfigured: false,
      },
      "keys.list": KEYS,
      "scopes.list": { scopes: [], hasMore: false },
    })
    const { container } = render(
      <PluginProvider client={client}>
        <NavigationProvider
          value={{
            navigate: () => {},
            Link: ({ to, children, ...rest }) => (
              <a href={to} {...rest}>
                {children}
              </a>
            ),
          }}
        >
          <PolicyDetailPage params={{ id: POLICY_DETAIL.id }} />
        </NavigationProvider>
      </PluginProvider>
    )
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    await screen.findByText("Billing service")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Rotations follows the shared layout", async () => {
    const { container } = renderPage(
      RotationsPage,
      stubClient({
        "rotations.list": { items: [rotation()], hasMore: true },
      })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("Billing service")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Scopes follows the shared layout", async () => {
    const { container } = renderPage(
      ScopesPage,
      stubClient({
        "scopes.list": {
          scopes: [{ id: "kscp_read", name: "read", description: "Read" }],
          hasMore: false,
        },
      })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("Read")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Settings follows the shared layout", async () => {
    const { container } = renderPage(
      SettingsPage,
      stubClient({ settings: SETTINGS })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("Max key lifetime")
    await screen.findByText("Future field")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Usage follows the shared layout", async () => {
    const { container } = renderPage(
      UsagePage,
      stubClient({
        "usage.series": SERIES,
        "usage.records": RECORDS,
        "keys.list": KEYS,
      })
    )
    await screen.findByRole("heading", { level: 1 })
    await screen.findByText("/v1/invoices")
    expect(layoutViolations(container)).toEqual([])
    // The bucket table is a second table on the page.
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    await screen.findByText("Bucket start")
    expect(layoutViolations(container)).toEqual([])
  })
})
