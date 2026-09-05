import { describe, expect, it } from "vitest"
import { resolvePluginState } from "../src/resolve"
import type { Capabilities } from "../src/resolve"
import type { ForgePlugin } from "../src/types"

function plugin(overrides: Partial<ForgePlugin> = {}): ForgePlugin {
  return {
    extension: "billing",
    nav: [],
    routes: [],
    ...overrides,
  }
}

function capabilities(contributors: Capabilities["contributors"]): Capabilities {
  return { shellEnvelopes: ["v1"], contributors }
}

describe("resolvePluginState", () => {
  it("hides the plugin when no contributor matches its extension name", () => {
    const caps = capabilities([{ name: "other", envelopes: ["v1"], configured: true }])

    expect(resolvePluginState(plugin({ extension: "billing" }), caps)).toEqual({ kind: "hidden" })
  })

  it("does not mismatch when the plugin declares no requires, even though the contributor reports a version", () => {
    const caps = capabilities([
      { name: "billing", envelopes: ["v1"], configured: true, version: "1.9.0" },
    ])

    const state = resolvePluginState(plugin({ extension: "billing", requires: undefined }), caps)

    expect(state.kind).not.toBe("mismatch")
    expect(state).toEqual({ kind: "ready" })
  })

  it("reports mismatch, carrying both versions, when the reported version is out of the required range", () => {
    const caps = capabilities([
      { name: "billing", envelopes: ["v1"], configured: true, version: "1.9.0" },
    ])

    const state = resolvePluginState(
      plugin({ extension: "billing", requires: "^2.0.0" }),
      caps,
    )

    expect(state).toEqual({ kind: "mismatch", required: "^2.0.0", reported: "1.9.0" })
  })

  it("does not mismatch when the contributor's version is unreported, even with a requires range", () => {
    const caps = capabilities([
      { name: "billing", envelopes: ["v1"], configured: true, version: "" },
    ])

    const state = resolvePluginState(
      plugin({ extension: "billing", requires: "^2.0.0" }),
      caps,
    )

    expect(state.kind).not.toBe("mismatch")
    expect(state).toEqual({ kind: "ready" })
  })

  it("shows the setup panel with the reported message when the version is fine but the contributor is unconfigured", () => {
    const caps = capabilities([
      {
        name: "billing",
        envelopes: ["v1"],
        configured: false,
        version: "2.1.0",
        message: "connect a Stripe account",
      },
    ])

    const state = resolvePluginState(plugin({ extension: "billing", requires: "^2.0.0" }), caps)

    expect(state).toEqual({ kind: "setup", message: "connect a Stripe account" })
  })

  it("is ready when the version is fine and the contributor is configured", () => {
    const caps = capabilities([
      { name: "billing", envelopes: ["v1"], configured: true, version: "2.1.0" },
    ])

    const state = resolvePluginState(plugin({ extension: "billing", requires: "^2.0.0" }), caps)

    expect(state).toEqual({ kind: "ready" })
  })
})
