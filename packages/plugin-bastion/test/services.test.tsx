import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionServicesPage } from "../src/pages/services"
import type { ServiceView } from "../src/types"
import { renderPage, stubClient } from "./harness"

function svc(over: Partial<ServiceView> = {}): ServiceView {
  return {
    name: "billing", version: "2.4.1", address: "10.0.4.12", port: 9000, protocols: ["http"],
    healthy: false, routeCount: 1, discoveredAt: "2026-09-30T08:01:00Z", metadataKeys: ["team"], ...over,
  }
}

describe("BastionServicesPage", () => {
  it("lists services with address, health and a refresh button", async () => {
    renderPage(BastionServicesPage, stubClient({ "services.list": { discoveryEnabled: true, services: [svc()], total: 1 } }))
    const row = (await screen.findByText("billing")).closest("tr") as HTMLElement
    expect(within(row).getByText("10.0.4.12:9000")).toBeTruthy()
    expect(within(row).getByText("Unhealthy")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Refresh discovery" })).toBeTruthy()
    expect(screen.getByText("1 service")).toBeTruthy()
  })

  it("renders none for empty protocols, a missing version and an unknown discovery time", async () => {
    renderPage(BastionServicesPage, stubClient({
      "services.list": { discoveryEnabled: true, services: [svc({ protocols: [], version: "", discoveredAt: null, metadataKeys: [] })], total: 1 },
    }))
    const row = (await screen.findByText("billing")).closest("tr") as HTMLElement
    expect(within(row).getByLabelText("no protocols")).toBeTruthy()
    expect(within(row).getByLabelText("no version")).toBeTruthy()
    expect(within(row).getByLabelText("no discovery time")).toBeTruthy()
  })

  it("tells discovery off apart from discovery that found nothing", async () => {
    const { unmount } = renderPage(BastionServicesPage, stubClient({ "services.list": { discoveryEnabled: false, services: [], total: 0 } }))
    expect(await screen.findByText("Discovery is switched off in the gateway config, so no services are found.")).toBeTruthy()
    unmount()
    renderPage(BastionServicesPage, stubClient({ "services.list": { discoveryEnabled: true, services: [], total: 0 } }))
    expect(await screen.findByText(/Discovery found no services/)).toBeTruthy()
    expect(screen.getByText("0 services")).toBeTruthy()
  })
})
