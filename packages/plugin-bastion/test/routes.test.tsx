import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { BastionRoutesPage } from "../src/pages/routes"
import type { RouteSummary } from "../src/types"
import {
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function route(over: Partial<RouteSummary> = {}): RouteSummary {
  return {
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
    ...over,
  }
}

function rowFor(text: string) {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("BastionRoutesPage", () => {
  it("lists routes with an encoded link, Any for no methods, and a live count", async () => {
    renderPage(
      BastionRoutesPage,
      stubClient({ "routes.list": { routes: [route()], total: 1 } })
    )
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
    expect(link.closest("td")?.className).toMatch(/font-mono/)
    expect(within(rowFor("/gw/users")).getByText("Any")).toBeTruthy()
    expect(within(rowFor("/gw/users")).getByText("1/2 healthy")).toBeTruthy()
    expect(screen.getByText("1 route")).toBeTruthy()
  })

  it("sends a filter only when one is chosen", async () => {
    const { client, sent } = recordingQueryClient({
      "routes.list": { routes: [], total: 0 },
    })
    renderPage(BastionRoutesPage, client)
    await screen.findByText(
      "No routes. Create one, or let discovery find your services."
    )
    expect(sent.find((s) => s.intent === "routes.list")?.params).toEqual({})

    fireEvent.change(screen.getByLabelText("Source"), {
      target: { value: "farp" },
    })
    await screen.findByText("No routes match these filters.")
    expect(sent.at(-1)?.params).toEqual({ source: "farp" })
    expect(screen.getByText("0 routes")).toBeTruthy()
  })
})

describe("BastionRoutesPage actions", () => {
  it("links New route to /new-route", async () => {
    renderPage(
      BastionRoutesPage,
      stubClient({ "routes.list": { routes: [], total: 0 } })
    )
    const links = await screen.findAllByRole("link", { name: "New route" })
    expect(links[0]?.getAttribute("href")).toBe("/new-route")
  })

  it("refreshes discovery and says so", async () => {
    const { client, sent } = recordingCommandClient(
      { "routes.list": { routes: [], total: 0 } },
      { "discovery.refresh": { ok: true } }
    )
    renderPage(BastionRoutesPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh discovery" })
    )
    expect(await screen.findByText("Discovery refreshed.")).toBeTruthy()
    expect(sent).toEqual([{ intent: "discovery.refresh", payload: undefined }])
  })

  it("explains a refresh refused because discovery is off", async () => {
    const client = {
      extension: "bastion",
      query: async () => ({ routes: [], total: 0 }),
      command: async () => {
        throw new ContractError(
          "CONFLICT",
          "discovery is switched off in the gateway config, so there is nothing to refresh",
          { reason: "discoveryOff" }
        )
      },
    } as never
    renderPage(BastionRoutesPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh discovery" })
    )
    expect(
      await screen.findByText(
        "Discovery is switched off in the gateway config, so there is nothing to refresh."
      )
    ).toBeTruthy()
  })
})
