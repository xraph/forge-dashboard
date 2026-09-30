import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import ledgerPlugin, { ledgerPlugin as named } from "../src/index"

function capabilities(...contributors: { name: string; configured?: boolean }[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({ name: c.name, envelopes: ["v1"], configured: c.configured ?? true })),
  }
}

describe("ledgerPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(ledgerPlugin).toBe(named)
  })

  // The join key, checked by what the host does with it: the Go manifest's
  // contributor.name is "ledger" (forgery/ledger/extension/contract/manifest.yaml).
  it("resolves to ready against a host reporting ledger's contributor", () => {
    expect(resolvePluginState(ledgerPlugin, capabilities({ name: "ledger" }))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report ledger", () => {
    expect(resolvePluginState(ledgerPlugin, capabilities({ name: "vault" })).kind).toBe("hidden")
  })

  it("mounts under /@ledger and is labelled Billing", () => {
    expect(ledgerPlugin.namespace).toBe("ledger")
    expect(ledgerPlugin.label).toBe("Billing")
  })

  it("names a route for every nav entry", () => {
    const paths = new Set(ledgerPlugin.routes.map((r) => r.path))
    for (const item of ledgerPlugin.nav) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })

  it("orders sidebar groups Overview, Catalog, Billing, Configuration", () => {
    const order = ["Overview", "Catalog", "Billing", "Configuration"]
    const seen = ledgerPlugin.nav.map((n) => n.group as string).filter((g, i, all) => all.indexOf(g) === i)
    expect(seen).toEqual(order.filter((g) => seen.includes(g)))
  })
})
