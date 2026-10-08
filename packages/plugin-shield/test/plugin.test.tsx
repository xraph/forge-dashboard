import { expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import shield from "../src/index"
it("joins Shield and covers all configuration and record routes", () => {
  expect(
    resolvePluginState(shield, { shellEnvelopes: ["v1"], contributors: [] })
      .kind
  ).toBe("hidden")
  expect(
    resolvePluginState(shield, {
      shellEnvelopes: ["v1"],
      contributors: [{ name: "shield", envelopes: ["v1"], configured: true }],
    }).kind
  ).toBe("ready")
  const paths = new Set(shield.routes.map((r) => r.path))
  for (const collection of [
    "instincts",
    "awareness",
    "boundaries",
    "values",
    "judgments",
    "reflexes",
    "profiles",
    "policies",
  ]) {
    for (const suffix of ["", "/new", "/:id", "/:id/edit"])
      expect(paths.has(`/${collection}${suffix}`)).toBe(true)
  }
  for (const route of [
    "/",
    "/scans",
    "/scans/:id",
    "/pii",
    "/compliance",
    "/compliance/:id",
    "/settings",
  ])
    expect(paths.has(route)).toBe(true)
})
