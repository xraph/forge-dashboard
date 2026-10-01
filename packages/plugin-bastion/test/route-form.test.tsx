import { describe, expect, it } from "vitest"
import { EMPTY_ROUTE, fieldsFromValues, valuesFromDetail } from "../src/components/route-form"
import type { RouteDetail } from "../src/types"

const DETAIL: RouteDetail = {
  id: "manual-/users", path: "/gw/users", methods: ["GET"], protocol: "http", source: "manual", serviceName: "",
  priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
  updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
  stripPrefix: true, addPrefix: "", rewritePath: "", headers: {},
  rateLimit: { enabled: true, requestsPerSec: 5, burst: 10, perClient: true, keyHeader: "X-Client" },
  metadataKeys: [], version: 1, createdAt: "2026-09-29T10:00:00Z",
  targets: [{ id: "t0", url: "http://u:xxxxx@users:8080", weight: 2, tags: ["blue"], healthy: true, circuitState: "closed",
    stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [] }],
}

describe("route form values", () => {
  it("prefills path and priority as entered, never the effective ones", () => {
    const v = valuesFromDetail(DETAIL)
    expect(v.path).toBe("/users")
    expect(v.priority).toBe("10")
  })

  it("round-trips a detail into fields, keeping the masked URL for the server to map back", () => {
    const f = fieldsFromValues(valuesFromDetail(DETAIL))
    expect(f).toEqual({
      path: "/users", methods: ["GET"], priority: 10, enabled: true, protocol: "http",
      stripPrefix: true, addPrefix: "", rewritePath: "",
      targets: [{ url: "http://u:xxxxx@users:8080", weight: 2, tags: ["blue"] }],
      rateLimit: { enabled: true, requestsPerSec: 5, burst: 10, perClient: true, keyHeader: "X-Client" },
      auth: null,
    })
  })

  it("drops blank upstream rows, splits tags, and sends null for an unticked override", () => {
    const f = fieldsFromValues({
      ...EMPTY_ROUTE,
      path: " /billing ",
      priority: "",
      targets: [{ url: " http://billing:9000 ", weight: "", tags: "a, b ,," }, { url: "  ", weight: "3", tags: "" }],
    })
    expect(f.path).toBe("/billing")
    expect(f.priority).toBe(0)
    expect(f.targets).toEqual([{ url: "http://billing:9000", weight: 1, tags: ["a", "b"] }])
    expect(f.rateLimit).toBeNull()
    expect(f.auth).toBeNull()
  })
})
