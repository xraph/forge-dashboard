import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { EntitlementPanel, EntitlementRow } from "../src/components/entitlement-panel"
import type { FeatureUsage } from "../src/types"
import { scriptedClient } from "./harness"

function feature(over: Partial<FeatureUsage>): FeatureUsage {
  return { key: "api_calls", name: "API calls", type: "metered", period: "monthly", limit: 1000, used: 400, remaining: 600, soft_limit: false, over_limit: false, enabled: false, ...over }
}

function row(f: FeatureUsage) {
  return render(
    <ul>
      <EntitlementRow feature={f} />
    </ul>,
  )
}

describe("EntitlementRow", () => {
  it("reads usage against the limit, with the period", () => {
    row(feature({}))
    expect(screen.getByText("400 of 1,000 this month")).toBeTruthy()
    expect(screen.getByRole("progressbar")).toBeTruthy()
    expect(screen.queryByText(/over/)).toBeNull()
    expect(screen.queryByText(/At the/)).toBeNull()
  })

  it("marks a hard limit that was passed, in words and not only colour", () => {
    const { container } = row(feature({ used: 1200, remaining: 0, over_limit: true }))
    expect(screen.getByText("200 over the limit")).toBeTruthy()
    expect(container.innerHTML).toMatch(/bg-destructive/)
  })

  it("marks a soft limit that was passed as billed overage", () => {
    const { container } = row(feature({ used: 1500, remaining: 0, over_limit: true, soft_limit: true }))
    expect(screen.getByText("500 over the soft limit, billed as overage")).toBeTruthy()
    expect(container.innerHTML).toMatch(/bg-warning/)
  })

  // The engine's entitlement check refuses a hard limit once used reaches it
  // ("quota exceeded", allowed false), not only once it passes it, although
  // subscriptions.usage sets over_limit only for used > limit. A full bar with
  // no words would read as healthy while the engine is refusing the tenant.
  it("says a hard limit that was reached is refusing further use", () => {
    const { container } = row(feature({ used: 1000, remaining: 0, over_limit: false }))
    expect(screen.getByText("At the limit, further use is refused")).toBeTruthy()
    expect(container.innerHTML).toMatch(/bg-destructive/)
  })

  it("says a soft limit that was reached bills what comes after it", () => {
    const { container } = row(feature({ used: 1000, remaining: 0, soft_limit: true }))
    expect(screen.getByText("At the soft limit, use past it is billed as overage")).toBeTruthy()
    expect(container.innerHTML).toMatch(/bg-warning/)
    expect(container.innerHTML).not.toMatch(/bg-destructive/)
  })

  it("treats a metered limit of zero as reached, because the engine refuses it", () => {
    const { container } = row(feature({ limit: 0, used: 0, remaining: 0 }))
    expect(screen.getByText("0 of 0 this month")).toBeTruthy()
    expect(screen.getByText("At the limit, further use is refused")).toBeTruthy()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  // Seats are priced per seat from the subscription's counts and the limit
  // plays no part in billing, so a seat count past a soft limit is not overage.
  it("does not call seats past a soft limit billed overage", () => {
    row(feature({ key: "seats", name: "Seats", type: "seat", period: "none", limit: 10, used: 12, remaining: 0, over_limit: true, soft_limit: true }))
    expect(screen.getByText("2 over the soft limit")).toBeTruthy()
    expect(screen.queryByText(/billed as overage/)).toBeNull()
  })

  it("does not say a full seat count is refusing use", () => {
    row(feature({ key: "seats", name: "Seats", type: "seat", period: "none", limit: 10, used: 10, remaining: 0 }))
    expect(screen.getByText("10 of 10")).toBeTruthy()
    expect(screen.queryByText(/At the/)).toBeNull()
  })

  it("says Unlimited and draws no bar for a limit of -1", () => {
    row(feature({ limit: -1, used: 90000, remaining: -1 }))
    expect(screen.getByText("90,000 this month")).toBeTruthy()
    expect(screen.getByText("Unlimited")).toBeTruthy()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("names a yearly period and leaves out one that does not reset", () => {
    const { unmount } = row(feature({ limit: -1, used: 9, remaining: -1, period: "yearly" }))
    expect(screen.getByText("9 this year")).toBeTruthy()
    unmount()
    row(feature({ key: "seats", name: "Seats", type: "seat", period: "none", limit: -1, used: 6, remaining: -1 }))
    expect(screen.getByText("6")).toBeTruthy()
  })

  it("says Included or Not included for a boolean feature", () => {
    const { unmount } = row(feature({ key: "sso", name: "Single sign-on", type: "boolean", period: "none", limit: 1, used: 0, remaining: -1, enabled: true }))
    expect(screen.getByText("Included")).toBeTruthy()
    unmount()
    row(feature({ key: "sso", name: "Single sign-on", type: "boolean", period: "none", limit: 0, used: 0, remaining: -1, enabled: false }))
    expect(screen.getByText("Not included")).toBeTruthy()
  })

  it("never divides by a zero limit", () => {
    const { container } = row(feature({ key: "seats", name: "Seats", type: "seat", period: "none", limit: 0, used: 0, remaining: 0 }))
    expect(screen.getByText("0 of 0")).toBeTruthy()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it("fills the bar to the top, not past it, when usage is over", () => {
    row(feature({ used: 5000, remaining: 0, over_limit: true }))
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100")
  })
})

function panel(client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <EntitlementPanel subscriptionId="sub_acme" />
    </PluginProvider>,
  )
}

describe("EntitlementPanel", () => {
  it("says so when the plan grants no features", async () => {
    const { client } = scriptedClient({ "subscriptions.usage": { features: [] } })
    panel(client)
    expect(await screen.findByText("This plan grants no features, so there is nothing to measure.")).toBeTruthy()
  })

  it("reads a null feature list as empty", async () => {
    const { client } = scriptedClient({ "subscriptions.usage": { features: null } })
    panel(client)
    expect(await screen.findByText("This plan grants no features, so there is nothing to measure.")).toBeTruthy()
  })

  it("shows the engine's refusal, never an empty list", async () => {
    const { client } = scriptedClient({ "subscriptions.usage": new ContractError("PERMISSION_DENIED", "no app selected") })
    panel(client)
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText(/nothing to measure/)).toBeNull()
  })
})
