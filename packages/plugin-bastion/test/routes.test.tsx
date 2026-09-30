import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { BastionRoutesPage } from "../src/pages/routes"
import type { RouteSummary } from "../src/types"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

function route(over: Partial<RouteSummary> = {}): RouteSummary {
  return {
    id: "manual-/users", path: "/gw/users", methods: [], protocol: "http", source: "manual", serviceName: "",
    priority: 110, enabled: true, targetCount: 2, healthyTargets: 1, editable: true, config: true,
    updatedAt: "2026-09-30T07:30:00Z", ...over,
  }
}

function rowFor(text: string) {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("BastionRoutesPage", () => {
  it("lists routes with an encoded link, Any for no methods, and a live count", async () => {
    renderPage(BastionRoutesPage, stubClient({ "routes.list": { routes: [route()], total: 1 } }))
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
    expect(link.closest("td")?.className).toMatch(/font-mono/)
    expect(within(rowFor("/gw/users")).getByText("Any")).toBeTruthy()
    expect(within(rowFor("/gw/users")).getByText("1/2 healthy")).toBeTruthy()
    expect(screen.getByText("1 route")).toBeTruthy()
  })

  it("sends a filter only when one is chosen", async () => {
    const { client, sent } = recordingQueryClient({ "routes.list": { routes: [], total: 0 } })
    renderPage(BastionRoutesPage, client)
    await screen.findByText("No routes. Add one in config, or let discovery find your services.")
    expect(sent.find((s) => s.intent === "routes.list")?.params).toEqual({})

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "farp" } })
    await screen.findByText("No routes match these filters.")
    expect(sent.at(-1)?.params).toEqual({ source: "farp" })
    expect(screen.getByText("0 routes")).toBeTruthy()
  })
})
