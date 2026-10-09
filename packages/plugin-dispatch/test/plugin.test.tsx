import { expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import dispatchPlugin, { dispatchPlugin as named } from "../src/index"
it("resolves the Dispatch contributor in its own namespace", () => {
  expect(dispatchPlugin).toBe(named)
  expect(dispatchPlugin.namespace).toBe("dispatch")
  expect(dispatchPlugin.label).toBe("Dispatch")
  expect(
    resolvePluginState(dispatchPlugin, {
      shellEnvelopes: ["v1"],
      contributors: [{ name: "dispatch", configured: true, envelopes: ["v1"] }],
    })
  ).toEqual({ kind: "ready" })
  expect(
    resolvePluginState(dispatchPlugin, {
      shellEnvelopes: ["v1"],
      contributors: [],
    }).kind
  ).toBe("hidden")
})
it("registers the implemented operational routes with the approved groups", () => {
  expect(dispatchPlugin.nav.map((item) => [item.to, item.group])).toEqual([
    ["/durable", "Monitoring"],
    ["/", "Dispatch"],
    ["/queues", "Monitoring"],
    ["/workers", "Monitoring"],
    ["/handlers", "Configuration"],
    ["/config", "Configuration"],
  ])
  expect(dispatchPlugin.routes.map((route) => route.path)).toEqual([
    "/durable",
    "/durable/:namespace/:workflow/:run",
    "/",
    "/queues",
    "/queues/:name",
    "/workers",
    "/workers/:id",
    "/handlers",
    "/handlers/jobs/:name",
    "/handlers/workflows/:name",
    "/config",
  ])
})
