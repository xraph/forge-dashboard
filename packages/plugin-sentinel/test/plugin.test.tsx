import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import sentinelPlugin, {
  sentinelPlugin as named,
  SetupPage,
  SuitesPage,
} from "../src/index"

function capabilities(...contributors: { name: string; configured?: boolean }[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
    })),
  }
}

describe("sentinelPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(sentinelPlugin).toBe(named)
  })

  /**
   * The join key, checked by what the host does with it rather than by
   * comparing the literal to itself. A wrong name resolves to `hidden`
   * silently, which is why this test exists.
   */
  it("resolves to ready against a host reporting sentinel's contributor", () => {
    expect(resolvePluginState(sentinelPlugin, capabilities({ name: "sentinel" }))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host reports only vault", () => {
    expect(resolvePluginState(sentinelPlugin, capabilities({ name: "vault" })).kind).toBe("hidden")
  })

  it("puts Suites and Setup in the Evaluation group, Suites first", () => {
    const nav = sentinelPlugin.nav ?? []
    const suites = nav.find((n) => n.label === "Suites")
    const setup = nav.find((n) => n.label === "Setup")
    expect(suites?.to).toBe("/suites")
    expect(setup?.to).toBe("/setup")
    expect(suites?.group).toBe("Evaluation")
    expect(setup?.group).toBe("Evaluation")
    expect((suites?.priority ?? 0) < (setup?.priority ?? 0)).toBe(true)
  })

  it("mounts each page at its route", () => {
    const element = (path: string) => sentinelPlugin.routes.find((r) => r.path === path)?.element
    expect(element("/suites")).toBe(SuitesPage)
    expect(element("/setup")).toBe(SetupPage)
  })

  it("gives every nav entry an icon and a route", () => {
    const paths = new Set(sentinelPlugin.routes.map((r) => r.path))
    for (const item of sentinelPlugin.nav ?? []) {
      expect(item.icon, `nav "${item.label}" has no icon`).toBeTruthy()
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
