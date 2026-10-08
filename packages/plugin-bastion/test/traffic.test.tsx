import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { BastionTrafficPage } from "../src/pages/traffic"
import type { TrafficStats } from "../src/types"
import { failingClient, renderPage, stubClient } from "./harness"

function stats(over: Partial<TrafficStats> = {}): TrafficStats {
  return {
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
      {
        routeId: "farp-billing-http",
        path: "/billing/*",
        totalRequests: 55,
        totalErrors: 55,
        errorRate: 100,
        avgLatencyMs: null,
        p99LatencyMs: null,
        latencySamples: 0,
      },
    ],
    total: 2,
    ...over,
  }
}

function card(label: string): HTMLElement {
  return screen.getByText(label).closest("[data-slot='card']") as HTMLElement
}

describe("BastionTrafficPage", () => {
  it("shows gateway counters and says what is not measured", async () => {
    renderPage(BastionTrafficPage, stubClient({ "traffic.stats": stats() }))
    await screen.findByText("3,131")
    expect(within(card("Retries")).getByText("Not measured")).toBeTruthy()
    expect(
      within(card("Retries")).getByText("Nothing in the proxy retries")
    ).toBeTruthy()
    expect(within(card("Cache")).getByText("No lookups")).toBeTruthy()
    expect(within(card("Latency")).getByText("48.3 ms")).toBeTruthy()
  })

  it("lists routes busiest first with encoded links and none for unmeasured latency", async () => {
    renderPage(BastionTrafficPage, stubClient({ "traffic.stats": stats() }))
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
    const billing = screen.getByText("/billing/*").closest("tr") as HTMLElement
    expect(within(billing).getByText("100.0%")).toBeTruthy()
    expect(within(billing).getAllByLabelText("no latency").length).toBe(2)
    expect(screen.getByText("2 routes")).toBeTruthy()
  })

  it("says not measured for latency on an idle gateway and counts zero routes", async () => {
    renderPage(
      BastionTrafficPage,
      stubClient({
        "traffic.stats": stats({
          totalRequests: 0,
          totalErrors: 0,
          avgLatencyMs: null,
          p99LatencyMs: null,
          latencySamples: 0,
          routes: [],
          total: 0,
        }),
      })
    )
    await screen.findByText("No route has served traffic yet.")
    expect(within(card("Latency")).getByText("Not measured")).toBeTruthy()
    expect(screen.getByText("0 routes")).toBeTruthy()
  })

  it("shows cache hits and misses when there were lookups", async () => {
    renderPage(
      BastionTrafficPage,
      stubClient({ "traffic.stats": stats({ cacheHits: 3, cacheMisses: 7 }) })
    )
    expect(
      await within(
        await screen
          .findByText("Cache")
          .then((el) => el.closest("[data-slot='card']") as HTMLElement)
      ).findByText("3 hits, 7 misses")
    ).toBeTruthy()
  })

  it("says 1 error, not 1 errors, in the Requests hint", async () => {
    renderPage(
      BastionTrafficPage,
      stubClient({ "traffic.stats": stats({ totalErrors: 1 }) })
    )
    await screen.findByText("3,131")
    expect(within(card("1 error")).getByText("Requests")).toBeTruthy()
  })

  it("renders the error card when the query fails", async () => {
    renderPage(
      BastionTrafficPage,
      failingClient(new ContractError("INTERNAL", "down"))
    )
    expect(await screen.findByText(/Traffic unavailable/)).toBeTruthy()
  })
})
