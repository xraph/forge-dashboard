import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import keysmithPlugin, { keysmithPlugin as named } from "../src/index"

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

describe("keysmithPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(keysmithPlugin).toBe(named)
  })

  /**
   * The join key, checked by what the host does with it rather than by
   * comparing the literal to itself. A wrong name resolves to `hidden`
   * silently, which is why this test exists.
   */
  it("resolves to ready against a host reporting keysmith's contributor", () => {
    expect(
      resolvePluginState(keysmithPlugin, capabilities({ name: "keysmith" })),
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host reports only vault", () => {
    expect(
      resolvePluginState(keysmithPlugin, capabilities({ name: "vault" })).kind,
    ).toBe("hidden")
  })

  it("puts Keys in the nav at /keys, in the API keys group", () => {
    const keys = keysmithPlugin.nav?.find((n) => n.label === "Keys")
    expect(keys?.to).toBe("/keys")
    expect(keys?.group).toBe("API keys")
  })

  it("routes the list and the detail page", () => {
    const paths = keysmithPlugin.routes.map((r) => r.path)
    expect(paths).toContain("/keys")
    expect(paths).toContain("/keys/:id")
  })

  it("names a route for every nav entry", () => {
    const paths = new Set(keysmithPlugin.routes.map((r) => r.path))
    for (const item of keysmithPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
