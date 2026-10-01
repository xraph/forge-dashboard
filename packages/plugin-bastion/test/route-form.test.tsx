import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { NavigationProvider } from "@forge-go/dashboard-plugin"
import { EMPTY_ROUTE, RouteForm, fieldsFromValues, valuesFromDetail } from "../src/components/route-form"
import type { RouteDetail } from "../src/types"

// jsdom 25 has no PointerEvent, and Base UI's checkbox dispatches through it.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const onSubmit = vi.fn()

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

  it("keeps a disabled rate limit off and sends it back disabled with its numbers", () => {
    const d: RouteDetail = { ...DETAIL, rateLimit: { enabled: false, requestsPerSec: 5, burst: 10, perClient: true } }
    const v = valuesFromDetail(d)
    expect(v.rateLimit.on).toBe(false)
    expect(fieldsFromValues(v).rateLimit).toEqual({ enabled: false, requestsPerSec: 5, burst: 10, perClient: true })
  })

  it("keeps a disabled auth override off and sends it back disabled with its lists", () => {
    const d: RouteDetail = { ...DETAIL, auth: { enabled: false, providers: ["jwt"], scopes: ["read"], skipAuth: true, forwardAuth: false } }
    const v = valuesFromDetail(d)
    expect(v.auth.on).toBe(false)
    expect(fieldsFromValues(v).auth).toEqual({ enabled: false, providers: ["jwt"], scopes: ["read"], skipAuth: true, forwardAuth: false })
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

  it("defaults a blank burst to the rate rounded up, and at least 1", () => {
    const on = { ...EMPTY_ROUTE.rateLimit, on: true }
    expect(fieldsFromValues({ ...EMPTY_ROUTE, rateLimit: { ...on, requestsPerSec: "2.5", burst: "" } }).rateLimit?.burst).toBe(3)
    expect(fieldsFromValues({ ...EMPTY_ROUTE, rateLimit: { ...on, requestsPerSec: "0.2", burst: "" } }).rateLimit?.burst).toBe(1)
    expect(fieldsFromValues({ ...EMPTY_ROUTE, rateLimit: { ...on, requestsPerSec: "5", burst: "20" } }).rateLimit?.burst).toBe(20)
  })

  it("upper-cases stored methods so lowercase config methods show ticked", () => {
    expect(valuesFromDetail({ ...DETAIL, methods: ["get", "Post"] }).methods).toEqual(["GET", "POST"])
  })

  it("shows a stored method outside the usual list as a ticked box that can be removed", () => {
    const initial = valuesFromDetail({ ...DETAIL, methods: ["GET", "trace"] })
    render(
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate: vi.fn() }}>
        <RouteForm initial={initial} submitLabel="Save" pendingLabel="Saving" pending={false} errorTitle="Failed" cancelTo="/routes" onSubmit={onSubmit} />
      </NavigationProvider>,
    )
    expect(screen.getByLabelText("GET").getAttribute("aria-checked")).toBe("true")
    const trace = screen.getByLabelText("TRACE")
    expect(trace.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(trace)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].methods).toEqual(["GET"])
  })
})
