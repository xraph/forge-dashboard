import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { BastionOverviewPage } from "../src/pages/overview"
import type { OverviewStats } from "../src/types"
import { failingClient, renderPage, stubClient } from "./harness"

function stats(over: Partial<OverviewStats> = {}): OverviewStats {
  return {
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
    ...over,
  }
}

function stat(label: string): HTMLElement {
  return screen.getByText(label).closest("[data-slot='card']") as HTMLElement
}

describe("BastionOverviewPage", () => {
  it("shows measured values", async () => {
    renderPage(BastionOverviewPage, stubClient({ "overview.stats": stats() }))
    await screen.findByText("1,840")
    expect(screen.getByText("2.5%")).toBeTruthy()
    expect(screen.getByText("48.3 ms")).toBeTruthy()
    expect(screen.getByText("4 of 5")).toBeTruthy()
    expect(screen.getByText("2h 5m")).toBeTruthy()
  })

  it("says not measured, never 0, on an idle gateway", async () => {
    renderPage(
      BastionOverviewPage,
      stubClient({
        "overview.stats": stats({
          totalRequests: 0,
          totalErrors: 0,
          errorRate: null,
          avgLatencyMs: null,
          p99LatencyMs: null,
          latencySamples: 0,
          startedAt: null,
          uptimeSeconds: 0,
          topRoutes: [],
        }),
      })
    )
    await screen.findByText("No requests yet")
    expect(screen.getAllByText("Not measured").length).toBe(3)
    expect(screen.getByText("Not started")).toBeTruthy()
    expect(screen.queryByText("0.0%")).toBeNull()
    expect(screen.getByText("No route has served traffic yet.")).toBeTruthy()
    expect(screen.getByText("0 routes")).toBeTruthy()
  })

  it("says circuit breaking is off rather than reporting no open circuits", async () => {
    renderPage(
      BastionOverviewPage,
      stubClient({
        "overview.stats": stats({
          circuitBreakerEnabled: false,
          openCircuits: 0,
        }),
      })
    )
    await screen.findByText("Circuit breaking is disabled")
    expect(within(stat("Open circuits")).getByText("Off")).toBeTruthy()
  })

  it("links busiest routes with the id encoded", async () => {
    renderPage(BastionOverviewPage, stubClient({ "overview.stats": stats() }))
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
  })

  it("renders the error card when the query fails", async () => {
    renderPage(
      BastionOverviewPage,
      failingClient(new ContractError("INTERNAL", "gateway down"))
    )
    expect(await screen.findByText(/Gateway overview unavailable/)).toBeTruthy()
  })
})
