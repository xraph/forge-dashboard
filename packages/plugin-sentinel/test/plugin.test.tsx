import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import sentinelPlugin, {
  BaselineDetailPage,
  BaselinesPage,
  CaseDetailPage,
  OverviewPage,
  ResultDetailPage,
  RunDetailPage,
  RunsPage,
  sentinelPlugin as named,
  SetupPage,
  SuiteDetailPage,
  SuitesPage,
} from "../src/index"

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
    expect(
      resolvePluginState(sentinelPlugin, capabilities({ name: "sentinel" }))
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host reports only vault", () => {
    expect(
      resolvePluginState(sentinelPlugin, capabilities({ name: "vault" })).kind
    ).toBe("hidden")
  })

  it("orders the Evaluation group Overview, Suites, Runs, Baselines, then Setup last", () => {
    const nav = [...(sentinelPlugin.nav ?? [])].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
    )
    expect(nav.map((n) => [n.label, n.to])).toEqual([
      ["Overview", "/"],
      ["Suites", "/suites"],
      ["Runs", "/runs"],
      ["Baselines", "/baselines"],
      ["Setup", "/setup"],
    ])
    for (const item of nav) expect(item.group).toBe("Evaluation")
  })

  it("mounts each page at its route", () => {
    const element = (path: string) =>
      sentinelPlugin.routes.find((r) => r.path === path)?.element
    expect(element("/suites")).toBe(SuitesPage)
    expect(element("/suites/:id")).toBe(SuiteDetailPage)
    expect(element("/suites/:id/cases/:caseId")).toBe(CaseDetailPage)
    expect(element("/setup")).toBe(SetupPage)
    expect(element("/suites/:id/prompts/:versionId")).toBeTruthy()
    expect(element("/")).toBe(OverviewPage)
    expect(element("/suites/:id/:tab")).toBe(SuiteDetailPage)
    expect(element("/runs")).toBe(RunsPage)
    expect(element("/runs/:id")).toBe(RunDetailPage)
    expect(element("/runs/:id/results/:resultId")).toBe(ResultDetailPage)
    expect(element("/baselines")).toBe(BaselinesPage)
    expect(element("/baselines/:id")).toBe(BaselineDetailPage)
  })

  it("gives the detail routes no nav entry", () => {
    const targets = (sentinelPlugin.nav ?? []).map((n) => n.to)
    for (const path of [
      "/suites/:id",
      "/suites/:id/:tab",
      "/suites/:id/cases/:caseId",
      "/suites/:id/prompts/:versionId",
      "/runs/:id",
      "/runs/:id/results/:resultId",
      "/baselines/:id",
    ]) {
      expect(targets).not.toContain(path)
    }
  })

  it("gives every nav entry an icon and a route", () => {
    const paths = new Set(sentinelPlugin.routes.map((r) => r.path))
    for (const item of sentinelPlugin.nav ?? []) {
      expect(item.icon, `nav "${item.label}" has no icon`).toBeTruthy()
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(
        item.to
      )
    }
  })
})
