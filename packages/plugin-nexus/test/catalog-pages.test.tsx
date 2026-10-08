import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import { GatewayPage } from "../src/pages/gateway"
import { ModelsPage } from "../src/pages/models"
import { SettingsPage } from "../src/pages/settings"
import type { Gateway, Overview } from "../src/types"
import { answer, fixtureClient } from "./fixtures"
import { renderWithClient } from "./harness"

describe("Nexus catalog pages", () => {
  it("shows posture before exact spend, with five outcomes and no health query", async () => {
    const { client, sent } = fixtureClient()
    renderWithClient(<OverviewPage />, client)
    expect(await screen.findByText("Keys required")).toBeTruthy()
    expect(screen.getByText("HTTP api and proxy routes")).toBeTruthy()
    expect(
      screen.getByText(answer<Overview>("overview.get").monthSpendUsd!, {
        exact: false,
      })
    ).toBeTruthy()
    expect(screen.getByText("refused")).toBeTruthy()
    expect(sent.map((x) => x.intent)).toEqual(["overview.get"])
  })
  it("shows open access and disabled collection without pretending traffic is zero", async () => {
    const value = answer<Overview>("overview.get")
    Object.assign(value, {
      monthSpendUsd: null,
      requestsToday: null,
      unpricedRequests: null,
      byOutcome: null,
      insertErrors: 3,
      limiterErrors: 2,
    })
    Object.assign(value.posture, { requireApiKey: false, usageEnabled: false })
    renderWithClient(
      <OverviewPage />,
      fixtureClient({ "overview.get": value }).client
    )
    expect(await screen.findByText(/requests without a key/)).toBeTruthy()
    expect(screen.getByText(/Monthly budgets are not enforced/)).toBeTruthy()
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0)
    expect(screen.getByText(/3 usage records failed/)).toBeTruthy()
    expect(screen.getByText(/2 limiter failures/)).toBeTruthy()
  })
  it("preserves pipeline order and marks unavailable inspection and cache size", async () => {
    const value = answer<Gateway>("gateway.get")
    value.stagesAvailable = false
    value.stages = []
    renderWithClient(
      <GatewayPage />,
      fixtureClient({ "gateway.get": value }).client
    )
    expect(
      await screen.findByText("Pipeline inspection unavailable")
    ).toBeTruthy()
    expect(screen.getByText(/first healthy provider/)).toBeTruthy()
    expect(screen.getByText(/does not guard streamed output/)).toBeTruthy()
    expect(screen.getAllByText("Not tracked").length).toBe(2)
  })
  it("shows free, unpriced and exact sub-cent model prices", async () => {
    const { client, sent } = fixtureClient()
    renderWithClient(<ModelsPage />, client)
    expect(await screen.findByText("Preview model")).toBeTruthy()
    expect(screen.getByText("Free")).toBeTruthy()
    expect(screen.getAllByText("Unpriced").length).toBeGreaterThan(0)
    expect(screen.getByText("$0.150000001")).toBeTruthy()
    expect(screen.getByText(/Observed traffic/)).toBeTruthy()
    expect(sent.map((x) => x.intent).sort()).toEqual([
      "models.list",
      "providers.list",
    ])
  })
  it("offers recovery on empty catalog and failed reads", async () => {
    let fail = true
    const { client } = fixtureClient({
      "models.list": () => {
        if (fail)
          throw new ContractError("PERMISSION_DENIED", "Catalog access denied")
        return { items: [] }
      },
    })
    renderWithClient(<ModelsPage />, client)
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "PERMISSION_DENIED: Catalog access denied"
    )
    fail = false
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("No registered models")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Refresh catalog" })).toBeTruthy()
  })
  it("loads settings with the projected configuration only", async () => {
    renderWithClient(<SettingsPage />, fixtureClient().client)
    expect(await screen.findByText("/nexus")).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
    await waitFor(() => expect(screen.getByText("60,000 ms")).toBeTruthy())
  })
})
