import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionUpstreamsPage } from "../src/pages/upstreams"
import type { Upstream } from "../src/types"
import { renderPage, stubClient } from "./harness"

const ORDERS: Upstream = {
  url: "http://orders:8080", healthy: false, circuitState: "open", activeConns: 2,
  totalRequests: 2150, totalErrors: 56, avgLatencyMs: 62.1,
  routes: [
    { routeId: "manual-/users", path: "/gw/users", targetId: "t1" },
    { routeId: "9b2f", path: "/gw/orders", targetId: "t2" },
  ],
}

describe("BastionUpstreamsPage", () => {
  it("lists each upstream once with links to every route using it", async () => {
    renderPage(BastionUpstreamsPage, stubClient({ "upstreams.list": { upstreams: [ORDERS], total: 1 } }))
    const row = (await screen.findByText("http://orders:8080")).closest("tr") as HTMLElement
    expect(within(row).getByText("Unhealthy")).toBeTruthy()
    expect(within(row).getByText("Open")).toBeTruthy()
    expect(within(row).getByRole("link", { name: "/gw/users" }).getAttribute("href")).toBe("/routes/manual-%2Fusers")
    expect(within(row).getByRole("link", { name: "/gw/orders" })).toBeTruthy()
    expect(screen.getByText("1 upstream")).toBeTruthy()
  })

  it("counts zero and says what to do", async () => {
    renderPage(BastionUpstreamsPage, stubClient({ "upstreams.list": { upstreams: [], total: 0 } }))
    await screen.findByText("No upstreams. Add a route to give the gateway somewhere to send traffic.")
    expect(screen.getByText("0 upstreams")).toBeTruthy()
  })
})
