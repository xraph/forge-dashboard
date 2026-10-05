import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import heraldPlugin, { heraldPlugin as named } from "../src/index"

function capabilities(...contributors: { name: string; configured?: boolean }[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({ name: c.name, envelopes: ["v1"], configured: c.configured ?? true })),
  }
}

/** Every route, scope-relative. Each task that adds a page adds it here. */
const ROUTES = ["/", "/providers", "/providers/:id"]

/** Every nav entry's target. */
const NAV = ["/", "/providers"]

describe("heraldPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(heraldPlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything: against a
   * capabilities document naming the contributor herald's manifest registers.
   * A wrong name resolves to hidden, silently.
   */
  it("resolves to ready against a host reporting herald's contributor", () => {
    expect(resolvePluginState(heraldPlugin, capabilities({ name: "herald" }))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report herald", () => {
    expect(resolvePluginState(heraldPlugin, capabilities({ name: "warden" })).kind).toBe("hidden")
  })

  it("is labelled with the extension's own name", () => {
    expect(heraldPlugin.label).toBe("Herald")
    expect(heraldPlugin.namespace).toBe("herald")
  })

  it("declares exactly its routes, scope-relative", () => {
    expect(heraldPlugin.routes.map((r) => r.path)).toEqual(ROUTES)
  })

  it("names a route for every nav entry, all under the Notifications group", () => {
    const paths = new Set(heraldPlugin.routes.map((r) => r.path))
    expect(heraldPlugin.nav.map((n) => n.to)).toEqual(NAV)
    for (const item of heraldPlugin.nav) {
      expect(paths.has(item.to)).toBe(true)
      expect(item.group).toBe("Notifications")
    }
  })
})
