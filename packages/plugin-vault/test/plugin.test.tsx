import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import vaultPlugin, { vaultPlugin as named } from "../src/index"

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

describe("vaultPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(vaultPlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything.
   *
   * Comparing `plugin.extension` to the literal "vault" would compare the
   * source line to itself. What matters is what the host does with the name,
   * so this resolves the plugin against a capabilities response carrying the
   * contributor vault's manifest really registers
   * (`vault/extension/contract/manifest.yaml`, contributor.name).
   *
   * A wrong name here resolves to `hidden`: no routes, no nav, nothing
   * logged, because a contributor the server never mentioned is an ordinary
   * thing for a shell to meet. That silence is why this test exists.
   */
  it("resolves to ready against a host reporting vault's contributor", () => {
    expect(
      resolvePluginState(vaultPlugin, capabilities({ name: "vault" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report vault at all", () => {
    expect(
      resolvePluginState(vaultPlugin, capabilities({ name: "warden" })).kind
    ).toBe("hidden")
  })

  it("puts Flags in the nav at /flags with priority 20, and routes its pages", () => {
    const flags = vaultPlugin.nav?.find((n) => n.label === "Flags")
    expect(flags?.to).toBe("/flags")
    expect(flags?.priority).toBe(20)
    const paths = vaultPlugin.routes.map((r) => r.path)
    expect(paths).toContain("/flags")
    expect(paths).toContain("/new-flag")
    expect(paths).toContain("/flags/:key")
  })

  it("puts Config and Overrides in the Config group with their priorities, and routes them", () => {
    const config = vaultPlugin.nav?.find((n) => n.label === "Config")
    expect(config?.to).toBe("/config")
    expect(config?.priority).toBe(30)
    expect(config?.group).toBe("Config")
    const overrides = vaultPlugin.nav?.find((n) => n.label === "Overrides")
    expect(overrides?.to).toBe("/overrides")
    expect(overrides?.priority).toBe(40)
    expect(overrides?.group).toBe("Config")
    const paths = vaultPlugin.routes.map((r) => r.path)
    for (const p of ["/config", "/new-config", "/config/:key", "/overrides"]) {
      expect(paths).toContain(p)
    }
  })

  it("names a route for every nav entry", () => {
    // A nav link pointing at a path no route serves is a dead link that no
    // other test would catch, because nav and routes are independent lists.
    const paths = new Set(vaultPlugin.routes.map((r) => r.path))
    for (const item of vaultPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
