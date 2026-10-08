import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import trovePlugin, { trovePlugin as named } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({
      name,
      envelopes: ["v1"],
      configured: true,
    })),
  }
}

describe("trovePlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(trovePlugin).toBe(named)
  })

  // The join key, checked against what the host does with it rather than
  // compared to itself: trove/extension/contract/manifest.yaml registers the
  // contributor as "trove".
  it("resolves to ready against a host reporting trove's contributor", () => {
    expect(resolvePluginState(trovePlugin, capabilities("trove"))).toEqual({
      kind: "ready",
    })
  })

  it("is hidden when the host does not report trove", () => {
    expect(resolvePluginState(trovePlugin, capabilities("vault")).kind).toBe(
      "hidden"
    )
  })

  it("mounts under the trove namespace with the extension's own label", () => {
    expect(trovePlugin.namespace).toBe("trove")
    expect(trovePlugin.label).toBe("Trove")
  })

  it("puts Overview first in the Storage group at /", () => {
    const overview = trovePlugin.nav?.find((n) => n.label === "Overview")
    expect(overview?.to).toBe("/")
    expect(overview?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/")
  })

  it("puts Buckets in the Storage group at /buckets", () => {
    const buckets = trovePlugin.nav?.find((n) => n.label === "Buckets")
    expect(buckets?.to).toBe("/buckets")
    expect(buckets?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/buckets")
  })

  it("puts Middleware in the Storage group at /middleware", () => {
    const middleware = trovePlugin.nav?.find((n) => n.label === "Middleware")
    expect(middleware?.to).toBe("/middleware")
    expect(middleware?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/middleware")
  })

  it("puts CAS in the Storage group at /cas", () => {
    const cas = trovePlugin.nav?.find((n) => n.label === "CAS")
    expect(cas?.to).toBe("/cas")
    expect(cas?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/cas")
  })

  it("puts Transfers in the Storage group at /transfers", () => {
    const transfers = trovePlugin.nav?.find((n) => n.label === "Transfers")
    expect(transfers?.to).toBe("/transfers")
    expect(transfers?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/transfers")
  })

  it("serves the browser at /buckets/:bucket as a lazy route with no nav entry", () => {
    const route = trovePlugin.routes.find((r) => r.path === "/buckets/:bucket")
    expect(route).toBeDefined()
    expect((route!.element as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.lazy")
    )
    expect(trovePlugin.nav.some((n) => n.to.startsWith("/buckets/"))).toBe(
      false
    )
  })
})
