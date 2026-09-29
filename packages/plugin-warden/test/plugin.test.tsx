import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import wardenPlugin, { wardenPlugin as named } from "../src/index"

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

describe("wardenPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(wardenPlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything.
   *
   * Comparing `plugin.extension` to the literal "warden" would compare the
   * source line to itself. What matters is what the host does with the name,
   * so this resolves the plugin against a capabilities response carrying the
   * contributor warden's manifest really registers
   * (`warden/extension/contract/manifest.yaml`, contributor.name).
   *
   * A wrong name here resolves to `hidden`: no routes, no nav, nothing
   * logged, because a contributor the server never mentioned is an ordinary
   * thing for a shell to meet. That silence is why this test exists.
   */
  it("resolves to ready against a host reporting warden's contributor", () => {
    expect(
      resolvePluginState(wardenPlugin, capabilities({ name: "warden" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report warden at all", () => {
    expect(
      resolvePluginState(wardenPlugin, capabilities({ name: "auth" })).kind
    ).toBe("hidden")
  })

  it("names a route for every nav entry", () => {
    // A nav link pointing at a path no route serves is a dead link that no
    // other test would catch, because nav and routes are independent lists.
    const paths = new Set(wardenPlugin.routes.map((r) => r.path))
    for (const item of wardenPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })

  it("puts Assignments in the Authorization group after Roles and Permissions", () => {
    const nav = wardenPlugin.nav ?? []
    const at = (label: string) => nav.find((n) => n.label === label)
    expect(at("Assignments")).toMatchObject({
      to: "/assignments",
      priority: 30,
      group: "Authorization",
    })
    expect(at("Roles")?.priority).toBeLessThan(30)
    expect(at("Permissions")?.priority).toBeLessThan(30)
  })

  it("puts Relations in a Relationships group of its own", () => {
    // Its own group, not Authorization: tuples are a different model from
    // roles and assignments. Resource types join it at priority 10.
    const nav = wardenPlugin.nav ?? []
    expect(nav.find((n) => n.label === "Relations")).toMatchObject({
      to: "/relations",
      priority: 20,
      group: "Relationships",
    })
  })
})
