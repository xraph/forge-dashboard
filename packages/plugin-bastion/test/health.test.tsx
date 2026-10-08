import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionHealthPage } from "../src/pages/health"
import type { ConfigDetail, Upstream } from "../src/types"
import { renderPage, stubClient } from "./harness"

function up(over: Partial<Upstream> = {}): Upstream {
  return {
    url: "http://users:8080",
    healthy: true,
    circuitState: "closed",
    activeConns: 2,
    totalRequests: 923,
    totalErrors: 3,
    avgLatencyMs: 18.1,
    routes: [{ routeId: "manual-/users", path: "/gw/users", targetId: "t1" }],
    ...over,
  }
}

const CONFIG: ConfigDetail = {
  sections: [
    {
      id: "healthCheck",
      title: "Health checks",
      enabled: true,
      settings: [
        { key: "Interval", value: "10s" },
        { key: "Path", value: "/health" },
      ],
    },
  ],
}

describe("BastionHealthPage", () => {
  it("puts unhealthy upstreams first and counts them in the caption", async () => {
    renderPage(
      BastionHealthPage,
      stubClient({
        "upstreams.list": {
          upstreams: [up(), up({ url: "http://billing:9000", healthy: false })],
          total: 2,
        },
        "config.detail": CONFIG,
      })
    )
    await screen.findByText("2 upstreams (1 unhealthy)")
    const rows = screen.getAllByRole("row").slice(1)
    expect(
      within(rows[0] as HTMLElement).getByText("http://billing:9000")
    ).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText("Unhealthy")).toBeTruthy()
  })

  it("shows the health check settings", async () => {
    renderPage(
      BastionHealthPage,
      stubClient({
        "upstreams.list": { upstreams: [up()], total: 1 },
        "config.detail": CONFIG,
      })
    )
    expect(await screen.findByText("10s")).toBeTruthy()
    expect(screen.getByText("/health")).toBeTruthy()
  })

  it("says when active checks are off", async () => {
    renderPage(
      BastionHealthPage,
      stubClient({
        "upstreams.list": { upstreams: [up()], total: 1 },
        "config.detail": {
          sections: [{ ...CONFIG.sections[0]!, enabled: false }],
        },
      })
    )
    expect(
      await screen.findByText(/Active health checks are switched off/)
    ).toBeTruthy()
  })

  it("counts zero upstreams", async () => {
    renderPage(
      BastionHealthPage,
      stubClient({
        "upstreams.list": { upstreams: [], total: 0 },
        "config.detail": CONFIG,
      })
    )
    expect(await screen.findByText("0 upstreams")).toBeTruthy()
  })
})
