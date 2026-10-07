import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { BastionApiExplorerPage } from "../src/pages/api-explorer"
import type { OpenAPISummary } from "../src/types"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

function summary(over: Partial<OpenAPISummary> = {}): OpenAPISummary {
  const services = over.services ?? [
    { serviceName: "billing", version: "2.4.1", specUrl: "http://billing:9000/openapi.json", healthy: false, pathCount: 0, error: "connection refused", fetchedAt: "2026-09-30T09:00:00Z" },
    { serviceName: "orders", version: "3.1.0", specUrl: "http://orders-a:8080/openapi.json", healthy: true, pathCount: 14, fetchedAt: "2026-09-30T09:00:00Z" },
  ]
  return { enabled: true, running: true, specPath: "/gateway/openapi.json", lastRefresh: "2026-09-30T09:00:00Z", totalPaths: 14, services, total: services.length, ...over }
}

describe("BastionApiExplorerPage", () => {
  it("summarises the merged spec, links it, and lists services", async () => {
    renderPage(BastionApiExplorerPage, stubClient({ "openapi.summary": summary() }))
    const link = await screen.findByRole("link", { name: "Open the merged spec" })
    expect(link.getAttribute("href")).toBe("/gateway/openapi.json")
    const billing = screen.getByText("billing").closest("tr") as HTMLElement
    expect(within(billing).getByText("connection refused")).toBeTruthy()
    expect(within(screen.getByText("orders").closest("tr") as HTMLElement).getByLabelText("no error")).toBeTruthy()
    expect(screen.getByText("2 services")).toBeTruthy()
    expect(within(screen.getByText("1 of 2").closest("[data-slot='card']") as HTMLElement).getByText("Healthy")).toBeTruthy()
  })

  it("starts a refresh and says it runs in the background", async () => {
    const { client, sent } = recordingCommandClient({ "openapi.summary": summary() }, { "openapi.refresh": { started: true } })
    renderPage(BastionApiExplorerPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Refresh specs" }))
    expect(await screen.findByText(/Refresh started/)).toBeTruthy()
    expect(sent[0]?.intent).toBe("openapi.refresh")
  })

  it("tells off apart from configured but not running, with no refresh button in either", async () => {
    const { unmount } = renderPage(BastionApiExplorerPage, stubClient({ "openapi.summary": summary({ enabled: false, running: false, services: [], total: 0 }) }))
    expect(await screen.findByText("OpenAPI aggregation is switched off in the gateway config.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh specs" })).toBeNull()
    unmount()
    renderPage(BastionApiExplorerPage, stubClient({ "openapi.summary": summary({ enabled: true, running: false, services: [], total: 0 }) }))
    expect(await screen.findByText("OpenAPI aggregation is configured but has not started on this gateway.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh specs" })).toBeNull()
  })
})
