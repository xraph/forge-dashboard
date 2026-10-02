import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import trovePlugin, { trovePlugin as named } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({ name, envelopes: ["v1"], configured: true })),
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
    expect(resolvePluginState(trovePlugin, capabilities("trove"))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report trove", () => {
    expect(resolvePluginState(trovePlugin, capabilities("vault")).kind).toBe("hidden")
  })

  it("mounts under the trove namespace with the extension's own label", () => {
    expect(trovePlugin.namespace).toBe("trove")
    expect(trovePlugin.label).toBe("Trove")
  })
})
