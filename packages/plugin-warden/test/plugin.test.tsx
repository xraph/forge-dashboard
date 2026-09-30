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

  it("puts Policies in the Authorization group after Assignments", () => {
    const nav = wardenPlugin.nav ?? []
    const at = (label: string) => nav.find((n) => n.label === label)
    expect(at("Policies")).toMatchObject({
      to: "/policies",
      priority: 40,
      group: "Authorization",
    })
    expect(at("Policies")?.icon).toBeTruthy()
    expect(at("Policies")?.priority).toBeGreaterThan(at("Assignments")?.priority ?? 0)
    expect(wardenPlugin.routes.map((r) => r.path)).toContain("/policies")
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

  it("puts Resource types in Relationships ahead of Relations, with no nav entry for the detail page", () => {
    const nav = wardenPlugin.nav ?? []
    const at = (label: string) => nav.find((n) => n.label === label)
    expect(at("Resource types")).toMatchObject({
      to: "/resource-types",
      priority: 10,
      group: "Relationships",
    })
    expect(at("Resource types")?.priority).toBeLessThan(at("Relations")?.priority ?? 0)
    // The detail route exists, but a sidebar link to "a resource type" with
    // none chosen would point nowhere.
    expect(wardenPlugin.routes.map((r) => r.path)).toContain("/resource-types/:id")
    expect(nav.map((n) => n.to)).not.toContain("/resource-types/:id")
  })

  it("routes a permission's own page, with no nav entry for it", () => {
    // A sidebar link to "a permission" with none chosen would point nowhere.
    const nav = wardenPlugin.nav ?? []
    expect(wardenPlugin.routes.map((r) => r.path)).toContain("/permissions/:id")
    expect(nav.map((n) => n.to)).not.toContain("/permissions/:id")
    expect(nav.find((n) => n.label === "Permissions")?.to).toBe("/permissions")
  })

  it("puts the Check log in Operations ahead of Config, and routes it", () => {
    const nav = wardenPlugin.nav ?? []
    const at = (label: string) => nav.find((n) => n.label === label)
    expect(at("Check log")).toMatchObject({
      to: "/check-log",
      priority: 20,
      group: "Operations",
    })
    expect(at("Check log")?.icon).toBeTruthy()
    expect(at("Check log")?.priority).toBeLessThan(at("Config")?.priority ?? 0)
    expect(at("Config")?.group).toBe("Operations")
    expect(wardenPlugin.routes.map((r) => r.path)).toContain("/check-log")
  })

  it("routes one check's own page, with no nav entry for it", () => {
    // A sidebar link to "a check" with none chosen would point nowhere.
    const nav = wardenPlugin.nav ?? []
    expect(wardenPlugin.routes.map((r) => r.path)).toContain("/check-log/:id")
    expect(nav.map((n) => n.to)).not.toContain("/check-log/:id")
    expect(nav.find((n) => n.label === "Check log")?.to).toBe("/check-log")
  })

  it("puts the Playground in Operations ahead of the Check log, and routes it", () => {
    const nav = wardenPlugin.nav ?? []
    const at = (label: string) => nav.find((n) => n.label === label)
    expect(at("Playground")).toMatchObject({
      to: "/playground",
      priority: 10,
      group: "Operations",
    })
    expect(at("Playground")?.icon).toBeTruthy()
    expect(at("Playground")?.priority).toBeLessThan(at("Check log")?.priority ?? 0)
    expect(wardenPlugin.routes.map((r) => r.path)).toContain("/playground")
  })
})
