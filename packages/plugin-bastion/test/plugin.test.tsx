import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import bastionPlugin, { bastionPlugin as named, BastionOverviewPage } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({ name, envelopes: ["v1"], configured: true })),
  }
}

describe("bastionPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(bastionPlugin).toBe(named)
  })

  // The join key, checked by resolving against the contributor name that
  // bastion/extension/contract/manifest.yaml registers.
  it("resolves to ready against a host reporting bastion", () => {
    expect(resolvePluginState(bastionPlugin, capabilities("bastion"))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report bastion", () => {
    expect(resolvePluginState(bastionPlugin, capabilities("vault")).kind).toBe("hidden")
  })

  it("routes / to the overview and lists every page", () => {
    const paths = bastionPlugin.routes.map((r) => r.path)
    expect(paths).toEqual([
      "/", "/routes", "/new-route", "/routes/:id", "/routes/:id/edit", "/upstreams",
      "/services", "/traffic", "/health", "/circuits", "/api-explorer", "/config",
    ])
    expect(bastionPlugin.routes[0]?.element).toBe(BastionOverviewPage)
  })

  it("groups the nav as the spec lays it out", () => {
    const groups = Object.fromEntries((bastionPlugin.nav ?? []).map((n) => [n.label, n.group]))
    expect(groups).toEqual({
      Overview: "Gateway",
      Routes: "Routing", Upstreams: "Routing", Services: "Routing",
      Traffic: "Traffic",
      Health: "Resilience", Circuits: "Resilience",
      "API explorer": "API",
      Config: "Settings",
    })
  })

  it("names a route for every nav entry", () => {
    const paths = new Set(bastionPlugin.routes.map((r) => r.path))
    for (const item of bastionPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
