import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import relayPlugin, { relayPlugin as named } from "../src/index"
import { screen } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"

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
    expect(
      resolvePluginState(relayPlugin, capabilities({ name: "relay" }))
    ).toEqual({ kind: "ready" })
  })

  // Streaming's contributor is "streaming-contract", so the tempting wrong
  // value here is the same suffix. Relay's contributor has none, and a host
  // reporting "relay-contract" is not reporting relay.
  it("is hidden when the host reports a different contributor name", () => {
    expect(
      resolvePluginState(relayPlugin, capabilities({ name: "relay-contract" }))
    ).toEqual({ kind: "hidden" })
  })

  it("asks for setup when the contributor is present but unconfigured", () => {
    expect(
      resolvePluginState(
        relayPlugin,
        capabilities({
          name: "relay",
          configured: false,
          message: "Configure a store for relay",
        })
      )
    ).toEqual({ kind: "setup", message: "Configure a store for relay" })
  })

  // Scope-relative: the host mounts these under /@relay itself.
  it("declares the routes it serves, scope-relative", () => {
    expect(relayPlugin.routes.map((r) => r.path)).toEqual([
      "/endpoints",
      "/endpoints/new",
      "/endpoints/:id",
    ])
  })

  // Each route mounted with no params, as a stray link would reach it. What
  // renders proves the path is wired to the page meant for it.
  it("mounts the right page on each route", async () => {
    const expected: Record<string, string> = {
      "/endpoints":
        "No endpoints yet. Create one to start delivering webhooks.",
      "/endpoints/new": "New endpoint",
      "/endpoints/:id": "No endpoint selected.",
    }
    for (const route of relayPlugin.routes) {
      const { unmount } = renderPage(
        route.element,
        stubClient({ "endpoints.list": { endpoints: [] } })
      )
      expect(await screen.findByText(expected[route.path])).toBeDefined()
      unmount()
    }
  })

  it("puts Endpoints in the nav", () => {
    expect(relayPlugin.nav?.map((n) => [n.label, n.to])).toEqual([
      ["Endpoints", "/endpoints"],
    ])
  })
})
