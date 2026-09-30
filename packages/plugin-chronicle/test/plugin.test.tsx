import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import chroniclePlugin, { chroniclePlugin as named } from "../src/index"

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

describe("chroniclePlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(chroniclePlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything.
   *
   * Comparing `plugin.extension` to the literal "chronicle" would compare the
   * source line to itself. What matters is what the host does with the name,
   * so this resolves the plugin against a capabilities response carrying the
   * contributor chronicle's manifest really registers
   * (`chronicle/extension/contract/manifest.yaml`, contributor.name).
   *
   * A wrong name here resolves to `hidden`: no routes, no nav, nothing
   * logged, because a contributor the server never mentioned is an ordinary
   * thing for a shell to meet. That silence is why this test exists.
   */
  it("resolves to ready against a host reporting chronicle's contributor", () => {
    expect(
      resolvePluginState(chroniclePlugin, capabilities({ name: "chronicle" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report chronicle at all", () => {
    expect(
      resolvePluginState(chroniclePlugin, capabilities({ name: "warden" })).kind
    ).toBe("hidden")
  })

  it("names a route for every nav entry", () => {
    // A nav link pointing at a path no route serves is a dead link that no
    // other test would catch, because nav and routes are independent lists.
    const paths = new Set(chroniclePlugin.routes.map((r) => r.path))
    for (const item of chroniclePlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })

  it("serves retention's four pages, with policies and archives under their own section", () => {
    const paths = chroniclePlugin.routes.map((r) => r.path)
    expect(paths).toEqual(expect.arrayContaining(["/retention", "/new-policy", "/retention/:id", "/archives"]))
    const retention = (chroniclePlugin.nav ?? []).filter((n) => n.group === "Retention")
    expect(retention.map((n) => [n.label, n.to, n.priority])).toEqual([
      ["Policies", "/retention", 60],
      ["Archives", "/archives", 70],
    ])
  })

  it("groups every nav entry under one of the five sections", () => {
    const allowed = ["Integrity", "Log", "Compliance", "Retention", "Settings"]
    for (const item of chroniclePlugin.nav ?? []) {
      expect(item.group, `nav "${item.label}" has no group`).toBeTruthy()
      expect(allowed, `nav "${item.label}" is in group "${item.group}"`).toContain(item.group)
    }
  })
})
