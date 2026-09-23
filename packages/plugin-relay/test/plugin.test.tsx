import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import relayPlugin, { relayPlugin as named } from "../src/index"

function capabilities(
  ...contributors: { name: string; configured?: boolean; message?: string }[]
): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
      ...(c.message ? { message: c.message } : {}),
    })),
  }
}

describe("relayPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(relayPlugin).toBe(named)
  })

  /**
   * The join key, checked the way the host uses it rather than against a
   * literal (which would compare this file's source to itself). "relay" is
   * what relay/extension/contract/manifest.yaml registers.
   */
  it("resolves to ready against a host reporting relay's contributor", () => {
    expect(resolvePluginState(relayPlugin, capabilities({ name: "relay" }))).toEqual({ kind: "ready" })
  })

  // Streaming's contributor is "streaming-contract", so the tempting wrong
  // value here is the same suffix. Relay's contributor has none, and a host
  // reporting "relay-contract" is not reporting relay.
  it("is hidden when the host reports a different contributor name", () => {
    expect(resolvePluginState(relayPlugin, capabilities({ name: "relay-contract" }))).toEqual({ kind: "hidden" })
  })

  it("asks for setup when the contributor is present but unconfigured", () => {
    expect(
      resolvePluginState(
        relayPlugin,
        capabilities({ name: "relay", configured: false, message: "Configure a store for relay" }),
      ),
    ).toEqual({ kind: "setup", message: "Configure a store for relay" })
  })

  // Scope-relative: the host mounts these under /@relay itself.
  it("declares the routes it serves, scope-relative", () => {
    expect(relayPlugin.routes.map((r) => r.path)).toEqual(["/endpoints"])
  })

  it("puts Endpoints in the nav", () => {
    expect(relayPlugin.nav?.map((n) => [n.label, n.to])).toEqual([["Endpoints", "/endpoints"]])
  })
})
