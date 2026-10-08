import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ReactNode } from "react"
import {
  createScopedClient,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ContractEnvelopeRequest } from "@forge-go/dashboard-plugin"
import { ServicesPage } from "../src/services"
import { TracesPage, MetricsPage, LogsPage } from "../src/observability"
import { ConfigurationPage, RoutesPage } from "../src/management"
import { OverviewPage } from "../src/overview"

beforeEach(() => queryStore.clear())
function mount(page: ReactNode, answers: Record<string, unknown>) {
  const requests: ContractEnvelopeRequest[] = []
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as ContractEnvelopeRequest
      requests.push(request)
      const answer = answers[request.intent]
      return {
        ok: answer !== undefined,
        status: answer === undefined ? 403 : 200,
        json: async () =>
          answer === undefined
            ? {
                envelope: "v1",
                error: {
                  code: "PERMISSION_DENIED",
                  message: "You cannot read this resource",
                },
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
  render(<PluginProvider client={client}>{page}</PluginProvider>)
  return { requests, fetchImpl }
}
const serviceAnswers = {
  "services.list": {
    services: [
      { name: "redis", type: "Cache", status: "degraded" },
      { name: "postgres", type: "Database", status: "healthy" },
    ],
  },
  health: {
    overallStatus: "degraded",
    total: 2,
    healthySummary: 1,
    services: [
      { name: "redis", status: "degraded", durationMs: 148, critical: false },
    ],
  },
  "services.detail": {
    name: "redis",
    type: "Cache",
    status: "degraded",
    uptime: 90000000000,
    dependencies: ["configuration"],
    metrics: { connections: 18 },
    last_health_check: "2026-09-22T14:50:00Z",
    health: {
      status: "degraded",
      message: "Slow response",
      duration: 148000000,
      critical: false,
    },
  },
}

describe("connected core pages", () => {
  it("filters services locally and queries selected details with Go duration units", async () => {
    const { requests } = mount(<ServicesPage />, serviceAnswers)
    await screen.findByRole("button", { name: "redis" })
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "redis" },
    })
    expect(screen.queryByRole("button", { name: "postgres" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "redis" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Slow response")
    expect(within(dialog).getByText("1m 30s")).toBeTruthy()
    expect(within(dialog).getByText("148")).toBeTruthy()
    expect(
      requests.find((request) => request.intent === "services.detail")?.params
    ).toEqual({ name: "redis" })
    expect(
      requests.every(
        (request) =>
          request.contributor === "core-contract" && request.kind === "query"
      )
    ).toBe(true)
  })
  it("uses snake-case span details and converts nanoseconds to milliseconds", async () => {
    const { requests } = mount(<TracesPage />, {
      "traces.list": {
        total: 301,
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
      "traces.detail": {
        trace_id: "trace-id",
        duration: 42000000,
        spans: [
          {
            span_id: "span-id",
            name: "SQL query",
            status: 2,
            duration: 12000000,
            depth: 1,
            offset_percent: 20,
            width_percent: 28,
            attributes: { "db.system": "postgres" },
            http: {
              request: {
                headers: {
                  Accept: "application/json",
                  Authorization: "Bearer hidden",
                },
                body: '{"filter":"active"}',
              },
              response: {
                headers: { "Content-Type": "application/json" },
                body: '{"count":2}',
              },
            },
          },
        ],
      },
    })
    fireEvent.click(await screen.findByRole("button", { name: "GET /users" }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("12.00 ms")).toBeTruthy()
    expect(within(dialog).getByText("Accept")).toBeTruthy()
    expect(within(dialog).getByText("application/json")).toBeTruthy()
    expect(within(dialog).getByText(/filter/)).toBeTruthy()
    expect(within(dialog).queryByText("Bearer hidden")).toBeNull()
    fireEvent.click(within(dialog).getByRole("tab", { name: "Response" }))
    expect(within(dialog).getByText("Content-Type")).toBeTruthy()
    expect(within(dialog).getByText(/count/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("tab", { name: "Attributes" }))
    expect(within(dialog).getByText("postgres")).toBeTruthy()
    expect(
      requests.find((request) => request.intent === "traces.detail")?.params
    ).toEqual({ id: "trace-id" })
  })
  it("renders empty Go slices and maps as empty states", async () => {
    mount(<MetricsPage />, {
      "metrics-report": {
        totalMetrics: 0,
        metricsByType: null,
        collectors: null,
        topMetrics: null,
      },
    })
    expect(await screen.findByText("No metrics yet")).toBeTruthy()
    expect(screen.getByText("No collectors yet")).toBeTruthy()
    expect(screen.getByText("No metric types reported.")).toBeTruthy()
  })
  it("renders structured metric values without coercing them to object strings", async () => {
    mount(<MetricsPage />, {
      "metrics-report": {
        totalMetrics: 1,
        metricsByType: { histogram: 1 },
        collectors: [],
        topMetrics: [
          { name: "latency", type: "histogram", value: { count: 4, sum: 120 } },
        ],
      },
    })
    expect(await screen.findByText('{"count":4,"sum":120}')).toBeTruthy()
  })
  it("shows a permission error and retries only on request", async () => {
    const answers: Record<string, unknown> = {}
    const { requests } = mount(<MetricsPage />, answers)
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(requests).toHaveLength(1)
    answers["metrics-report"] = {
      totalMetrics: 0,
      metricsByType: {},
      collectors: [],
      topMetrics: [],
    }
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("No metrics yet")
    expect(requests).toHaveLength(2)
  })
  it("loads bounded audit records and opens correlation details", async () => {
    const { requests } = mount(<LogsPage />, {
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
    })
    fireEvent.click(
      await screen.findByRole("button", { name: "session.create" })
    )
    expect(
      await within(screen.getByRole("dialog")).findByText("req-001")
    ).toBeTruthy()
    expect(requests[0].params).toEqual({ limit: 200 })
  })
  it("retains the server's unknown deployment values and exposes no save action", async () => {
    const { requests } = mount(<ConfigurationPage />, {
      overview: { version: "unknown", environment: "unknown" },
    })
    expect(await screen.findByText("Read only")).toBeTruthy()
    expect(screen.getAllByText("unknown")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull()
    expect(requests.every((request) => request.kind === "query")).toBe(true)
  })
  it("does not query an invented route inventory intent", () => {
    const { requests } = mount(<RoutesPage />, {})
    expect(screen.getByText("Route inventory unavailable")).toBeTruthy()
    expect(requests).toHaveLength(0)
  })
  it("shows overview counts without inventing historical traffic", async () => {
    mount(<OverviewPage />, {
      ...serviceAnswers,
      overview: {
        overallHealth: "degraded",
        totalServices: 2,
        healthyServices: 1,
        totalMetrics: 7,
        uptimeSeconds: 3600,
        version: "v1",
        environment: "test",
      },
      "audit.list": { total: 0, records: null },
    })
    await waitFor(() => expect(screen.getByText("50%")).toBeTruthy())
    expect(
      screen
        .getByRole("link", { name: "1 of 2 services healthy" })
        .getAttribute("href")
    ).toBe("/services")
    expect(screen.queryByText("Request traffic")).toBeNull()
  })
})
