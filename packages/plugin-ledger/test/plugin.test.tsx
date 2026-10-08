import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import type { PluginNavItem } from "@forge-go/dashboard-plugin"
import ledgerPlugin, { inGroupOrder, ledgerPlugin as named } from "../src/index"

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

describe("ledgerPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(ledgerPlugin).toBe(named)
  })

  // The join key, checked by what the host does with it: the Go manifest's
  // contributor.name is "ledger" (forgery/ledger/extension/contract/manifest.yaml).
  it("resolves to ready against a host reporting ledger's contributor", () => {
    expect(
      resolvePluginState(ledgerPlugin, capabilities({ name: "ledger" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report ledger", () => {
    expect(
      resolvePluginState(ledgerPlugin, capabilities({ name: "vault" })).kind
    ).toBe("hidden")
  })

  it("mounts under /@ledger and is labelled Billing", () => {
    expect(ledgerPlugin.namespace).toBe("ledger")
    expect(ledgerPlugin.label).toBe("Ledger")
  })

  it("names a route for every nav entry", () => {
    const paths = new Set(ledgerPlugin.routes.map((r) => r.path))
    for (const item of ledgerPlugin.nav) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(
        item.to
      )
    }
  })

  it("loads the heavy routes lazily", () => {
    const lazyPaths = ledgerPlugin.routes
      .filter(
        (r) =>
          (r.element as unknown as { $$typeof?: symbol }).$$typeof ===
          Symbol.for("react.lazy")
      )
      .map((r) => r.path)
      .sort()
    const expected = ["/invoices/:id", "/plans/:id", "/usage"].filter((p) =>
      ledgerPlugin.routes.some((r) => r.path === p)
    )
    expect(lazyPaths).toContain("/plans/:id")
    expect(lazyPaths).toContain("/invoices/:id")
    expect(lazyPaths).toContain("/usage")
    expect(lazyPaths).toEqual(expected.sort())
  })

  it("lists Usage in Billing, between Invoices and Payment methods", () => {
    const billing = ledgerPlugin.nav.filter((n) => n.group === "Billing")
    const order = [...billing]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((n) => n.label)
    expect(order).toEqual([
      "Subscriptions",
      "Invoices",
      "Usage",
      "Payment methods",
    ])
    expect(ledgerPlugin.nav.find((n) => n.label === "Usage")?.to).toBe("/usage")
  })

  it("orders sidebar groups Overview, Catalog, Billing, Configuration", () => {
    const order = ["Overview", "Catalog", "Billing", "Configuration"]
    const seen = ledgerPlugin.nav
      .map((n) => n.group as string)
      .filter((g, i, all) => all.indexOf(g) === i)
    expect(seen).toEqual(order.filter((g) => seen.includes(g)))
  })

  it("sorts out-of-order entries into group order, and puts an unknown group first", () => {
    const item = (label: string, group: string): PluginNavItem => ({
      label,
      to: `/${label}`,
      group,
    })
    const sorted = inGroupOrder([
      item("settings", "Configuration"),
      item("invoices", "Billing"),
      item("mystery", "Elsewhere"),
      item("plans", "Catalog"),
      item("overview", "Overview"),
      item("usage", "Billing"),
    ])
    // The unknown group ranks -1 and so leads the sidebar. It is not dropped,
    // and entries within a group keep the order they were given in.
    expect(sorted.map((n) => n.label)).toEqual([
      "mystery",
      "overview",
      "plans",
      "invoices",
      "usage",
      "settings",
    ])
  })
})
