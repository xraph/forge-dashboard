import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import {
  createScopedClient,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ContractEnvelopeRequest } from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { ServicesPage } from "../src/services"
import { TracesPage, MetricsPage, LogsPage } from "../src/observability"
import {
  ConfigurationPage,
  ExtensionsPage,
  RoutesPage,
} from "../src/management"
import { OverviewPage } from "../src/overview"

beforeEach(() => queryStore.clear())

function mount(page: ReactNode, answers: Record<string, unknown>) {
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as ContractEnvelopeRequest
      const answer = answers[request.intent]
      return {
        ok: answer !== undefined,
        status: answer === undefined ? 403 : 200,
        json: async () =>
          answer === undefined
            ? {
                envelope: "v1",
                error: { code: "PERMISSION_DENIED", message: "Denied" },
              }
            : { envelope: "v1", ok: true, data: answer },
      } as Response
    }
  )
  const client = createScopedClient(
    "/dashboard/api/dashboard/v1",
    "core-contract",
    fetchImpl
  )
  return render(<PluginProvider client={client}>{page}</PluginProvider>)
}

const services = {
  "services.list": {
    services: [
      { name: "redis", type: "Cache", status: "degraded" },
      { name: "postgres", type: "Database", status: "healthy" },
    ],
  },
}
const overview = {
  overallHealth: "degraded",
  totalServices: 2,
  healthyServices: 1,
  totalMetrics: 7,
  uptimeSeconds: 3600,
  version: "v1",
  environment: "test",
}
const audit = {
  "audit.list": {
    total: 1,
    records: [
      {
        time: "2026-09-22T14:00:00Z",
        contributor: "auth",
        intent: "session.create",
        result: "success",
        latencyMs: 12,
        correlationID: "req-001",
      },
    ],
  },
}

describe("core pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { container } = mount(<OverviewPage />, {
      ...services,
      overview,
      ...audit,
    })
    await screen.findByRole("button", { name: "redis" })
    await screen.findByRole("button", { name: "session.create" })
    await waitFor(() => expect(screen.getByText("50%")).toBeTruthy())
    expect(layoutViolations(container)).toEqual([])
  })
  it("Services & health follows the shared layout", async () => {
    const { container } = mount(<ServicesPage />, {
      ...services,
      health: {
        overallStatus: "degraded",
        total: 2,
        healthySummary: 1,
        services: [
          {
            name: "redis",
            status: "degraded",
            durationMs: 148,
            critical: false,
          },
        ],
      },
    })
    await screen.findByRole("button", { name: "redis" })
    await screen.findByText("148 ms")
    expect(layoutViolations(container)).toEqual([])
  })
  it("Extensions follows the shared layout", async () => {
    const { container } = mount(<ExtensionsPage />, {
      "extensions.list": {
        extensions: [
          { name: "relay", displayName: "Relay", version: "v1.0.0" },
        ],
      },
    })
    await screen.findByText("Relay")
    expect(layoutViolations(container)).toEqual([])
  })
  it("Configuration follows the shared layout", async () => {
    const { container } = mount(<ConfigurationPage />, { overview })
    await screen.findByText("Read only")
    expect(layoutViolations(container)).toEqual([])
  })
  it("Routes follows the shared layout", () => {
    const { container } = mount(<RoutesPage />, {})
    expect(screen.getByText("Route inventory unavailable")).toBeTruthy()
    expect(layoutViolations(container)).toEqual([])
  })
  it("Metrics follows the shared layout", async () => {
    const { container } = mount(<MetricsPage />, {
      "metrics-report": {
        totalMetrics: 1,
        metricsByType: { histogram: 1 },
        collectors: [
          {
            name: "runtime",
            type: "go",
            metricsCount: 1,
            status: "ok",
            lastCollection: "2026-09-22T14:00:00Z",
          },
        ],
        topMetrics: [{ name: "latency", type: "histogram", value: 4 }],
      },
    })
    await screen.findByText("runtime")
    await screen.findByText("latency")
    expect(layoutViolations(container)).toEqual([])
  })
  it("Traces follows the shared layout", async () => {
    const { container } = mount(<TracesPage />, {
      "traces.list": {
        total: 1,
        traces: [
          {
            traceID: "trace-id",
            rootSpanName: "GET /users",
            spanCount: 1,
            durationMs: 42,
            status: "ok",
            startTime: "2026-09-22T14:00:00Z",
            protocol: "REST",
          },
        ],
      },
    })
    await screen.findByRole("button", { name: "GET /users" })
    expect(layoutViolations(container)).toEqual([])
  })
  it("Logs & activity follows the shared layout", async () => {
    const { container } = mount(<LogsPage />, audit)
    await screen.findByRole("button", { name: "session.create" })
    expect(layoutViolations(container)).toEqual([])
  })
})
