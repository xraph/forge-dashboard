import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { LedgerSettingsPage } from "../src/pages/settings"
import { renderPage, stubClient } from "./harness"

const SETTINGS = {
  meter_batch_size: 100,
  meter_flush_interval: "5s",
  entitlement_cache_ttl: "1m0s",
  lifecycle_interval: "1m0s",
  app_id: "app_ledger",
  require_app_claim: false,
  providers: ["stripe"],
  invoice_formats: ["csv", "json"],
}

describe("LedgerSettingsPage", () => {
  it("shows the running configuration, read-only", async () => {
    renderPage(LedgerSettingsPage, stubClient({ "settings.detail": SETTINGS }))
    expect(await screen.findByText("app_ledger")).toBeTruthy()
    expect(screen.getByText("100")).toBeTruthy()
    expect(screen.getByText("5s")).toBeTruthy()
    expect(screen.getByText("1m0s")).toBeTruthy()
    expect(screen.getByText("stripe", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(screen.getByText("csv", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(screen.getByText(/comes from the extension's configuration/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull()
  })

  it("says what an empty app and an empty provider list mean", async () => {
    renderPage(LedgerSettingsPage, stubClient({ "settings.detail": { ...SETTINGS, app_id: "", providers: [] } }))
    expect(await screen.findByLabelText("no configured app")).toBeTruthy()
    expect(screen.getByLabelText("no payment providers")).toBeTruthy()
    expect(screen.getByText(/Every billing page needs an app/)).toBeTruthy()
  })

  it("says how often the lifecycle clock runs", async () => {
    renderPage(LedgerSettingsPage, stubClient({ "settings.detail": SETTINGS }))
    expect(await screen.findByText("Every 1m0s")).toBeTruthy()
  })

  it("says when the lifecycle clock is off", async () => {
    renderPage(LedgerSettingsPage, stubClient({ "settings.detail": { ...SETTINGS, lifecycle_interval: "off" } }))
    const term = await screen.findByText("Lifecycle clock", { selector: "dt" })
    expect(within(term.parentElement as HTMLElement).getByText("Off (built-in clock)")).toBeTruthy()
  })

  it("marks the clock missing on a ledger that predates it", async () => {
    const older: Record<string, unknown> = { ...SETTINGS }
    delete older.lifecycle_interval
    renderPage(LedgerSettingsPage, stubClient({ "settings.detail": older }))
    expect(await screen.findByLabelText("no lifecycle clock")).toBeTruthy()
  })
})
