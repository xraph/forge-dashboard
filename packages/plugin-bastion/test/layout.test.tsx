import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { BastionApiExplorerPage } from "../src/pages/api-explorer"
import { BastionCircuitsPage } from "../src/pages/circuits"
import { BastionConfigPage } from "../src/pages/config"
import { BastionHealthPage } from "../src/pages/health"
import { BastionOverviewPage } from "../src/pages/overview"
import { BastionRouteCreatePage } from "../src/pages/route-create"
import { BastionRouteDetailPage } from "../src/pages/route-detail"
import { BastionRouteEditPage } from "../src/pages/route-edit"
import { BastionRoutesPage } from "../src/pages/routes"
import { BastionServicesPage } from "../src/pages/services"
import { BastionTrafficPage } from "../src/pages/traffic"
import { BastionUpstreamsPage } from "../src/pages/upstreams"
import type {
  CircuitsList,
  ConfigDetail,
  OpenAPISummary,
  OverviewStats,
  RouteDetail,
  RouteSummary,
  ServiceView,
  TrafficStats,
  Upstream,
} from "../src/types"
import { renderPage, stubClient } from "./harness"

// Base UI checkboxes and dialogs read PointerEvent, which jsdom lacks.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const upstream: Upstream = {
  url: "http://orders:8080",
  healthy: false,
  circuitState: "open",
  activeConns: 2,
  totalRequests: 2150,
  totalErrors: 56,
  avgLatencyMs: 62.1,
  routes: [{ routeId: "manual-/users", path: "/gw/users", targetId: "t1" }],
}

const config: ConfigDetail = {
  sections: [
    {
      id: "healthCheck",
      title: "Health checks",
      enabled: true,
      settings: [{ key: "Interval", value: "10s" }],
    },
    {
      id: "retry",
      title: "Retry",
      enabled: true,
      note: "Nothing in the proxy calls the retry policy.",
      settings: [{ key: "Max attempts", value: "3" }],
    },
    { id: "empty", title: "Empty", enabled: null, settings: [] },
  ],
}

const route: RouteSummary = {
  id: "manual-/users",
  path: "/gw/users",
  methods: [],
  protocol: "http",
  source: "manual",
  serviceName: "",
  priority: 110,
  enabled: true,
  targetCount: 2,
  healthyTargets: 1,
  editable: true,
  config: true,
  updatedAt: "2026-09-30T07:30:00Z",
}

const detail: RouteDetail = {
  ...route,
  input: { path: "/users", priority: 10 },
  stripPrefix: true,
  addPrefix: "",
  rewritePath: "",
  headers: { set: { "X-Env": "prod" } },
  transform: {
    requestHeaders: { set: { "X-Api-Key": "[redacted]" } },
    responseHeaders: {},
  },
  metadataKeys: [],
  version: 2,
  createdAt: "2026-09-29T10:00:00Z",
  targets: [
    {
      id: "t0",
      url: "http://users:8080",
      weight: 1,
      tags: [],
      healthy: true,
      circuitState: "half_open",
      stats: {
        activeConns: 0,
        totalRequests: 0,
        totalErrors: 0,
        avgLatencyMs: 0,
      },
      tls: false,
      metadataKeys: [],
    },
  ],
}

const service: ServiceView = {
  name: "billing",
  version: "2.4.1",
  address: "10.0.4.12",
  port: 9000,
  protocols: ["http"],
  healthy: false,
  routeCount: 1,
  discoveredAt: "2026-09-30T08:01:00Z",
  metadataKeys: ["team"],
}

const traffic: TrafficStats = {
  totalRequests: 3131,
  totalErrors: 114,
  rateLimited: 14,
  circuitBreaks: 37,
  cacheHits: 0,
  cacheMisses: 0,
  retriesMeasured: false,
  avgLatencyMs: 48.3,
  p99LatencyMs: 212,
  latencySamples: 4096,
  routes: [
    {
      routeId: "manual-/users",
      path: "/gw/users",
      totalRequests: 923,
      totalErrors: 3,
      errorRate: 0.325,
      avgLatencyMs: 18.1,
      p99LatencyMs: 40,
      latencySamples: 923,
    },
  ],
  total: 1,
}

const overview: OverviewStats = {
  totalRequests: 1840,
  totalErrors: 46,
  errorRate: 2.5,
  avgLatencyMs: 48.3,
  p99LatencyMs: 212,
  latencySamples: 1024,
  cacheLookups: 0,
  cacheHitRate: null,
  rateLimited: 0,
  circuitBreaks: 3,
  totalRoutes: 4,
  enabledRoutes: 3,
  healthyUpstreams: 4,
  totalUpstreams: 5,
  openCircuits: 1,
  halfOpenCircuits: 1,
  circuitBreakerEnabled: true,
  discoveryEnabled: true,
  startedAt: "2026-09-30T08:00:00Z",
  uptimeSeconds: 7500,
  topRoutes: [
    {
      routeId: "manual-/users",
      path: "/gw/users",
      totalRequests: 920,
      totalErrors: 3,
    },
  ],
}

const circuits: CircuitsList = {
  enabled: true,
  failureThreshold: 5,
  resetTimeoutSeconds: 30,
  halfOpenMax: 3,
  circuits: [
    {
      targetId: "9b2f/1",
      url: "http://orders-b:8080",
      routes: [
        { routeId: "manual-/users", path: "/gw/users", targetId: "9b2f/1" },
      ],
      tracked: true,
      state: "open",
      failureCount: 5,
      lastFailure: "2026-09-30T09:41:00Z",
      lastStateChange: "2026-09-30T09:41:00Z",
    },
  ],
  total: 1,
}

const openapi: OpenAPISummary = {
  enabled: true,
  running: true,
  specPath: "/gateway/openapi.json",
  lastRefresh: "2026-09-30T09:00:00Z",
  totalPaths: 14,
  services: [
    {
      serviceName: "orders",
      version: "3.1.0",
      specUrl: "http://orders-a:8080/openapi.json",
      healthy: true,
      pathCount: 14,
      fetchedAt: "2026-09-30T09:00:00Z",
    },
  ],
  total: 1,
}

describe("Bastion pages follow the shared layout", () => {
  it("API explorer follows the shared layout", async () => {
    const { container } = renderPage(
      BastionApiExplorerPage,
      stubClient({ "openapi.summary": openapi })
    )
    await screen.findByText("orders")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Circuits follows the shared layout", async () => {
    const { container } = renderPage(
      BastionCircuitsPage,
      stubClient({ "circuits.list": circuits })
    )
    await screen.findByText("http://orders-b:8080")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Config follows the shared layout", async () => {
    const { container } = renderPage(
      BastionConfigPage,
      stubClient({ "config.detail": config })
    )
    await screen.findByText("Max attempts")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Health follows the shared layout", async () => {
    const { container } = renderPage(
      BastionHealthPage,
      stubClient({
        "upstreams.list": { upstreams: [upstream], total: 1 },
        "config.detail": config,
      })
    )
    await screen.findByText("http://orders:8080")
    await screen.findByText("10s")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Overview follows the shared layout", async () => {
    const { container } = renderPage(
      BastionOverviewPage,
      stubClient({ "overview.stats": overview })
    )
    await screen.findByRole("link", { name: "/gw/users" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("New route follows the shared layout", async () => {
    const { container } = renderPage(BastionRouteCreatePage, stubClient({}))
    await screen.findByLabelText("Path")
    expect(layoutViolations(container)).toEqual([])
    // The form's field groups are sections, not bare fieldsets.
    expect(screen.getByRole("region", { name: "Match" })).toBeTruthy()
  })

  it("Route detail follows the shared layout", async () => {
    const { container } = renderPage(
      BastionRouteDetailPage,
      stubClient({ "routes.detail": detail }),
      { id: "manual-/users" }
    )
    await screen.findByText("http://users:8080")
    await screen.findByText("X-Env")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Edit route follows the shared layout", async () => {
    const { container } = renderPage(
      BastionRouteEditPage,
      stubClient({ "routes.detail": detail }),
      { id: "manual-/users" }
    )
    await screen.findByLabelText("Path")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Match" })).toBeTruthy()
  })

  it("Routes follows the shared layout", async () => {
    const { container } = renderPage(
      BastionRoutesPage,
      stubClient({ "routes.list": { routes: [route], total: 1 } })
    )
    await screen.findByRole("link", { name: "/gw/users" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Services follows the shared layout", async () => {
    const { container } = renderPage(
      BastionServicesPage,
      stubClient({
        "services.list": {
          discoveryEnabled: true,
          services: [service],
          total: 1,
        },
      })
    )
    await screen.findByText("billing")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Traffic follows the shared layout", async () => {
    const { container } = renderPage(
      BastionTrafficPage,
      stubClient({ "traffic.stats": traffic })
    )
    await screen.findByRole("link", { name: "/gw/users" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Upstreams follows the shared layout", async () => {
    const { container } = renderPage(
      BastionUpstreamsPage,
      stubClient({ "upstreams.list": { upstreams: [upstream], total: 1 } })
    )
    await screen.findByText("http://orders:8080")
    expect(layoutViolations(container)).toEqual([])
  })
})
