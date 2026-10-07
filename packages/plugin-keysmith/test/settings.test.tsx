import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SettingsPage } from "../src/pages/settings"
import type { EnforcementRow, Settings } from "../src/types"
import { failingClient, recordingClient, renderPage, stubClient } from "./harness"

/** enforcement.go's table, in the editor's order, for a deployment with or without a limiter. */
function enforcement(limiter: boolean): EnforcementRow[] {
  const rows: Omit<EnforcementRow, "enforced">[] = [
    { field: "maxKeyLifetimeSeconds", label: "Max key lifetime", group: "keysmith", when: "when a key is created" },
    { field: "graceSeconds", label: "Grace on rotation", group: "keysmith", when: "when a key is rotated" },
    { field: "allowedScopes", label: "Allowed scopes", group: "keysmith", when: "when a key is created or its scopes are assigned" },
    { field: "rateLimit", label: "Rate limit", group: "rateLimiter", when: "when a key is validated" },
    { field: "rateLimitWindowSeconds", label: "Window", group: "rateLimiter", when: "when a key is validated" },
    { field: "burstLimit", label: "Burst limit", group: "application", when: "" },
    { field: "rotationPeriodSeconds", label: "Rotation period", group: "application", when: "" },
    { field: "dailyQuota", label: "Daily quota", group: "application", when: "" },
    { field: "monthlyQuota", label: "Monthly quota", group: "application", when: "" },
    { field: "allowedIps", label: "Allowed IPs", group: "application", when: "" },
    { field: "allowedOrigins", label: "Allowed origins", group: "application", when: "" },
    { field: "allowedPaths", label: "Allowed paths", group: "application", when: "" },
    { field: "allowedMethods", label: "Allowed methods", group: "application", when: "" },
  ]
  return rows.map((r) => {
    const enforced =
      r.group === "keysmith" || (r.group === "rateLimiter" && limiter)
    return { ...r, enforced, when: enforced ? r.when : "" }
  })
}

function settings(over: Partial<Settings> = {}): Settings {
  const limiter = over.rateLimiterConfigured ?? false
  return {
    plugins: ["audit", "warden"],
    storeHealthy: true,
    storeMessage: "The store answered.",
    rateLimiterConfigured: limiter,
    tenantSource: "config",
    tenant: "acme",
    enforcement: enforcement(limiter),
    enforcedFields: limiter ? 5 : 3,
    defaultGraceSeconds: 86400,
    ...over,
  }
}

function renderSettings(data: Settings = settings()) {
  return renderPage(SettingsPage, stubClient({ settings: data }))
}

/** The section under the heading `name`. */
function section(name: string): HTMLElement {
  return screen.getByRole("region", { name })
}

const GROUPS = [
  "Enforced by Keysmith",
  "Enforced only with a rate limiter",
  "Stored for your application",
]

/** The enforcement table's rows under one group heading, as [field, enforced, when]. */
function groupRows(heading: string): string[][] {
  const table = within(section(heading)).getByRole("table")
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent ?? ""),
    )
}

describe("SettingsPage", () => {
  it("asks for the settings and nothing else", async () => {
    const { client, intents } = recordingClient({ settings: settings() })
    renderPage(SettingsPage, client)
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy()
    await screen.findByText("Healthy")
    expect(intents).toEqual(["settings"])
  })

  it("is read-only: no buttons, no inputs", async () => {
    renderSettings()
    await screen.findByText("Healthy")
    expect(screen.queryAllByRole("button")).toEqual([])
    expect(screen.queryAllByRole("textbox")).toEqual([])
    expect(screen.queryAllByRole("checkbox")).toEqual([])
  })

  describe("store", () => {
    it("says Healthy with the server's sentence when the store answered", async () => {
      renderSettings()
      await screen.findByText("Healthy")
      const store = section("Store")
      expect(within(store).getByText("Healthy")).toBeTruthy()
      expect(within(store).getByText("The store answered.")).toBeTruthy()
      expect(within(store).queryByText("Not answering")).toBeNull()
    })

    it("says Not answering with the server's sentence when the store did not answer", async () => {
      renderSettings(
        settings({
          storeHealthy: false,
          storeMessage: "The store did not answer. The error is in the server log.",
        }),
      )
      await screen.findByText("Not answering")
      const store = section("Store")
      expect(
        within(store).getByText(
          "The store did not answer. The error is in the server log.",
        ),
      ).toBeTruthy()
      expect(within(store).queryByText("Healthy")).toBeNull()
      // The rest of the page still answers: a down store is reported, not fatal.
      expect(section("Tenant")).toBeTruthy()
      expect(section("Enforced by Keysmith")).toBeTruthy()
    })
  })

  describe("rate limiter", () => {
    it("says Configured, and that the two rate-limit fields are enforced", async () => {
      renderSettings(settings({ rateLimiterConfigured: true }))
      await screen.findByText("Configured")
      const limiter = section("Rate limiter")
      expect(within(limiter).queryByText("Not configured")).toBeNull()
      expect(
        within(limiter).getByText(
          "Keysmith enforces a policy's Rate limit and Window when a key is validated.",
        ),
      ).toBeTruthy()
    })

    it("says Not configured, and that the two rate-limit fields are stored but not enforced", async () => {
      renderSettings(settings({ rateLimiterConfigured: false }))
      await screen.findByText("Not configured")
      const limiter = section("Rate limiter")
      expect(within(limiter).queryByText("Configured")).toBeNull()
      expect(
        within(limiter).getByText(
          "A policy's Rate limit and Window are stored, but not enforced here.",
        ),
      ).toBeTruthy()
    })
  })

  describe("tenant", () => {
    it("names the tenant claim when the request carried one", async () => {
      renderSettings(settings({ tenantSource: "claim", tenant: "t_claimed" }))
      await screen.findByText("Healthy")
      const tenant = section("Tenant")
      expect(
        within(tenant).getByText("Taken from the tenant claim your session carries."),
      ).toBeTruthy()
      expect(within(tenant).queryByText(/extensions\.keysmith/)).toBeNull()
      const id = within(tenant).getByText("t_claimed")
      expect(id.className).toContain("font-mono")
      expect(id.className).toContain("text-xs")
    })

    it("names the session's organization when the tenant came from the scope", async () => {
      renderSettings(settings({ tenantSource: "scope", tenant: "org_acme" }))
      await screen.findByText("Healthy")
      const tenant = section("Tenant")
      expect(
        within(tenant).getByText("Taken from your session's organization."),
      ).toBeTruthy()
      expect(within(tenant).queryByText(/extensions\.keysmith/)).toBeNull()
      expect(within(tenant).queryByText(/tenant claim/)).toBeNull()
      const id = within(tenant).getByText("org_acme")
      expect(id.className).toContain("font-mono")
    })

    it("falls back to the config sentence for a source it does not know", async () => {
      // A newer server may add a source. It reads as config, as every
      // non-claim source did before "scope".
      renderSettings(
        settings({ tenantSource: "header" as unknown as Settings["tenantSource"], tenant: "acme" }),
      )
      await screen.findByText("Healthy")
      const tenant = section("Tenant")
      expect(tenant.textContent).toContain(
        "Taken from extensions.keysmith.dashboard.tenant_id in the server's configuration.",
      )
    })

    it("names the config key when the tenant came from config", async () => {
      renderSettings(settings({ tenantSource: "config", tenant: "acme" }))
      await screen.findByText("Healthy")
      const tenant = section("Tenant")
      expect(tenant.textContent).toContain(
        "Taken from extensions.keysmith.dashboard.tenant_id in the server's configuration.",
      )
      const key = within(tenant).getByText(
        "extensions.keysmith.dashboard.tenant_id",
      )
      expect(key.className).toContain("font-mono")
      expect(key.className).toContain("text-xs")
      expect(within(tenant).queryByText(/tenant claim/)).toBeNull()
      expect(within(tenant).queryByText(/organization/)).toBeNull()
      const id = within(tenant).getByText("acme")
      expect(id.className).toContain("font-mono")
      expect(id.className).toContain("text-xs")
    })
  })

  describe("default grace", () => {
    it("says 24 hours, the way the policy editor says it", async () => {
      renderSettings()
      await screen.findByText("Healthy")
      expect(within(section("Default grace")).getByText("24 hours")).toBeTruthy()
    })

    it("takes the value from the response", async () => {
      renderSettings(settings({ defaultGraceSeconds: 90 * 60 }))
      await screen.findByText("Healthy")
      expect(within(section("Default grace")).getByText("90 minutes")).toBeTruthy()
    })
  })

  describe("plugins", () => {
    it("lists each hook plugin in mono, in the order the server sent", async () => {
      renderSettings(settings({ plugins: ["audit", "warden"] }))
      await screen.findByText("Healthy")
      const plugins = section("Plugins")
      const audit = within(plugins).getByText("audit")
      const warden = within(plugins).getByText("warden")
      for (const el of [audit, warden]) {
        expect(el.className).toContain("font-mono")
        expect(el.className).toContain("text-xs")
      }
      expect(
        audit.compareDocumentPosition(warden) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(within(plugins).queryByText("No hook plugins registered.")).toBeNull()
    })

    it("says so when no hook plugins are registered", async () => {
      renderSettings(settings({ plugins: [] }))
      await screen.findByText("Healthy")
      const plugins = section("Plugins")
      expect(within(plugins).getByText("No hook plugins registered.")).toBeTruthy()
      // Not a bare dash: the sentence is the whole answer.
      expect(within(plugins).queryByLabelText("no plugins")).toBeNull()
    })
  })

  describe("enforcement", () => {
    it("says how many policy fields this deployment enforces", async () => {
      renderSettings()
      expect(
        await screen.findByText("This deployment enforces 3 of 13 policy fields."),
      ).toBeTruthy()
    })

    it("counts 5 of 13 with a limiter", async () => {
      renderSettings(settings({ rateLimiterConfigured: true }))
      expect(
        await screen.findByText("This deployment enforces 5 of 13 policy fields."),
      ).toBeTruthy()
    })

    it("groups the fields under the policy editor's three headings, in its order", async () => {
      renderSettings()
      await screen.findByText("Healthy")
      const headings = within(section("Policy enforcement"))
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent)
      expect(headings).toEqual(GROUPS)
    })

    it("words each group the way the policy editor does", async () => {
      renderSettings(settings({ rateLimiterConfigured: false }))
      await screen.findByText("Healthy")
      expect(
        within(section("Enforced by Keysmith")).getByText(
          "Keysmith checks these: the lifetime when a key is created, scopes when they are assigned, and the grace when a key is rotated.",
        ),
      ).toBeTruthy()
      expect(
        within(section("Enforced only with a rate limiter")).getByText(
          "This deployment has no rate limiter. These are stored, but not enforced here.",
        ),
      ).toBeTruthy()
      const app = section("Stored for your application")
      expect(app.textContent).toContain(
        "Keysmith does not check these. Your application can read them from ValidationResult.Policy.",
      )
      expect(within(app).getByText("ValidationResult.Policy").className).toContain(
        "font-mono",
      )
    })

    it("says the rate limiter group is enforced when one is configured", async () => {
      renderSettings(settings({ rateLimiterConfigured: true }))
      await screen.findByText("Configured")
      expect(
        within(section("Enforced only with a rate limiter")).getByText(
          "This deployment has a rate limiter, so Keysmith enforces these.",
        ),
      ).toBeTruthy()
    })

    it("has Field, Enforced and When columns", async () => {
      renderSettings()
      await screen.findByText("Healthy")
      for (const heading of GROUPS) {
        const table = within(section(heading)).getByRole("table")
        expect(
          within(table)
            .getAllByRole("columnheader")
            .map((h) => h.textContent),
        ).toEqual(["Field", "Enforced", "When"])
      }
    })

    it("lists every row under its group without a limiter", async () => {
      renderSettings(settings({ rateLimiterConfigured: false }))
      await screen.findByText("Healthy")
      expect(groupRows("Enforced by Keysmith")).toEqual([
        ["Max key lifetime", "Yes", "When a key is created"],
        ["Grace on rotation", "Yes", "When a key is rotated"],
        ["Allowed scopes", "Yes", "When a key is created or its scopes are assigned"],
      ])
      expect(groupRows("Enforced only with a rate limiter")).toEqual([
        ["Rate limit", "No", "–"],
        ["Window", "No", "–"],
      ])
      expect(groupRows("Stored for your application")).toEqual([
        ["Burst limit", "No", "–"],
        ["Rotation period", "No", "–"],
        ["Daily quota", "No", "–"],
        ["Monthly quota", "No", "–"],
        ["Allowed IPs", "No", "–"],
        ["Allowed origins", "No", "–"],
        ["Allowed paths", "No", "–"],
        ["Allowed methods", "No", "–"],
      ])
    })

    it("marks the rate-limit rows enforced, with when, given a limiter", async () => {
      renderSettings(settings({ rateLimiterConfigured: true }))
      await screen.findByText("Configured")
      expect(groupRows("Enforced only with a rate limiter")).toEqual([
        ["Rate limit", "Yes", "When a key is validated"],
        ["Window", "Yes", "When a key is validated"],
      ])
    })

    it("labels a row that is not checked for a screen reader, not just with a dash", async () => {
      renderSettings()
      await screen.findByText("Healthy")
      const app = section("Stored for your application")
      expect(within(app).getAllByLabelText("no check here")).toHaveLength(8)
    })

    it("takes the rows from the response, in its order, not from a copy here", async () => {
      renderSettings(
        settings({
          enforcement: [
            { field: "graceSeconds", label: "Grace on rotation", group: "keysmith", enforced: true, when: "when a key is rotated" },
            { field: "maxKeyLifetimeSeconds", label: "Max key lifetime", group: "keysmith", enforced: true, when: "when a key is created" },
          ],
          enforcedFields: 2,
        }),
      )
      await screen.findByText("Healthy")
      expect(groupRows("Enforced by Keysmith").map((r) => r[0])).toEqual([
        "Grace on rotation",
        "Max key lifetime",
      ])
      expect(
        screen.getByText("This deployment enforces 2 of 2 policy fields."),
      ).toBeTruthy()
    })

    it("still shows a row whose group this page does not know, under that group's name", async () => {
      renderSettings(
        settings({
          enforcement: [
            ...enforcement(false),
            { field: "ttl", label: "Time to live", group: "edge", enforced: true, when: "when a key is cached" },
          ],
          enforcedFields: 4,
        }),
      )
      await screen.findByText("Healthy")
      const headings = within(section("Policy enforcement"))
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent)
      expect(headings).toEqual([...GROUPS, "edge"])
      expect(groupRows("edge")).toEqual([
        ["Time to live", "Yes", "When a key is cached"],
      ])
      expect(
        within(section("edge")).getByRole("heading", { name: "edge" }).className,
      ).toContain("font-mono")
    })
  })

  it("shows the error state with the message when settings fail", async () => {
    renderPage(
      SettingsPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant for this request")),
    )
    expect(await screen.findByText(/no tenant for this request/)).toBeTruthy()
    expect(screen.queryByText("Healthy")).toBeNull()
    expect(screen.queryByRole("region", { name: "Store" })).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
