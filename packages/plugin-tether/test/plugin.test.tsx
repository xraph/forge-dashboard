import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import tetherPlugin, {
  OverviewPage,
  TenantDetailPage,
  TenantsPage,
  tetherPlugin as named,
} from "../src/index"

function capabilities(
  ...contributors: { name: string; configured?: boolean }[]
): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
    })),
  }
}

describe("tetherPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(tetherPlugin).toBe(named)
  })

  it("is named tether everywhere", () => {
    expect(tetherPlugin.extension).toBe("tether")
    expect(tetherPlugin.namespace).toBe("tether")
    expect(tetherPlugin.label).toBe("Tether")
  })

  // The join key, checked by what the host does with it. A wrong name
  // resolves to `hidden` and nothing is logged.
  it("resolves to ready against a host reporting tether's contributor", () => {
    expect(
      resolvePluginState(tetherPlugin, capabilities({ name: "tether" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host reports only keysmith", () => {
    expect(
      resolvePluginState(tetherPlugin, capabilities({ name: "keysmith" })).kind
    ).toBe("hidden")
  })

  it("is hidden when the host reports no contributors at all", () => {
    expect(resolvePluginState(tetherPlugin, capabilities()).kind).toBe("hidden")
  })

  it("puts Overview at / and Tenants at /tenants, in that order", () => {
    const nav = [...(tetherPlugin.nav ?? [])].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
    )
    expect(nav.map((n) => [n.label, n.to])).toEqual([
      ["Overview", "/"],
      ["Tenants", "/tenants"],
    ])
  })

  it("gives every nav entry an icon and a route", () => {
    const paths = tetherPlugin.routes.map((r) => r.path)
    for (const item of tetherPlugin.nav ?? []) {
      expect(item.icon, `nav "${item.label}" has no icon`).toBeTruthy()
      expect(paths).toContain(item.to)
    }
  })

  it("mounts each page at its route", () => {
    const element = (path: string) =>
      tetherPlugin.routes.find((r) => r.path === path)?.element
    expect(element("/")).toBe(OverviewPage)
    expect(element("/tenants")).toBe(TenantsPage)
    expect(element("/tenants/:tenantId")).toBe(TenantDetailPage)
  })

  it("keeps the tenant page out of the nav", () => {
    expect((tetherPlugin.nav ?? []).map((n) => n.to)).not.toContain(
      "/tenants/:tenantId"
    )
  })
})
