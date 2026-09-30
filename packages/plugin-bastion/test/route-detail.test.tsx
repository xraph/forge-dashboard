import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionRouteDetailPage } from "../src/pages/route-detail"
import type { RouteDetail } from "../src/types"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

function detail(over: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "manual-/users", path: "/gw/users", methods: ["GET"], protocol: "http", source: "manual", serviceName: "",
    priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
    updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
    stripPrefix: true, addPrefix: "", rewritePath: "",
    headers: { set: { "X-Env": "prod" } },
    transform: { requestHeaders: { set: { "X-Api-Key": "[redacted]" } }, responseHeaders: {} },
    metadataKeys: [], version: 2, createdAt: "2026-09-29T10:00:00Z",
    targets: [{
      id: "t0", url: "http://users:8080", weight: 1, tags: [], healthy: true, circuitState: "half_open",
      stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [],
    }],
    ...over,
  }
}

describe("BastionRouteDetailPage", () => {
  it("asks for the decoded id, slash included", async () => {
    const { client, sent } = recordingQueryClient({ "routes.detail": detail() })
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    await screen.findByRole("heading", { name: "/gw/users" })
    expect(sent[0]).toEqual({ intent: "routes.detail", params: { id: "manual-/users" } })
  })

  it("shows the entered priority beside the effective one and warns about config routes", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    await screen.findByText("110 (entered as 10)")
    expect(screen.getByText(/lasts until the gateway restarts/)).toBeTruthy()
  })

  it("marks a redacted header rather than printing its placeholder as a value", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    const row = (await screen.findByText("X-Api-Key")).closest("tr") as HTMLElement
    expect(within(row).getByText("Redacted")).toBeTruthy()
    expect(within(row).getByText("Request transform")).toBeTruthy()
    expect(screen.getByText("2 headers")).toBeTruthy()
  })

  it("says discovery owns a FARP route", async () => {
    renderPage(
      BastionRouteDetailPage,
      stubClient({ "routes.detail": detail({ source: "farp", editable: false, config: false, input: undefined }) }),
      { id: "farp-x" },
    )
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByText(/entered as/)).toBeNull()
  })

  it("shows no latency for a target that has served nothing", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    await screen.findByText("http://users:8080")
    expect(screen.getByLabelText("no latency")).toBeTruthy()
    expect(screen.getByText("Half-open")).toBeTruthy()
  })

  it("renders a status line and asks nothing when the address has no id", () => {
    const { client, sent } = recordingQueryClient({})
    renderPage(BastionRouteDetailPage, client, {})
    expect(screen.getByRole("status").textContent).toBe("No route in the address, so there is nothing to show.")
    expect(sent).toHaveLength(0)
  })
})
