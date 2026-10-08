import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProvidersPage } from "../src/pages/providers"
import { engine, providerSummary } from "./data"
import { renderPage, scriptedClient, stubClient } from "./harness"

const LIST = {
  providers: [
    providerSummary(),
    providerSummary({
      id: "hpvd_01j00000000000000000000002",
      name: "Twilio",
      channel: "sms",
      driver: "twilio",
      credentials: [
        { key: "account_sid", protection: "plaintext" },
        { key: "auth_token", protection: "plaintext" },
        { key: "sid2", protection: "aes-256-gcm", keyId: "k1" },
      ],
    }),
    providerSummary({
      id: "hpvd_01j00000000000000000000004",
      name: "inapp (default)",
      channel: "inapp",
      driver: "inapp",
      credentials: [],
      enabled: false,
      priority: 10,
    }),
  ],
}

describe("ProvidersPage", () => {
  it("counts providers in the caption and links each by name", async () => {
    renderPage(
      ProvidersPage,
      stubClient({ "engine.info": engine(), "providers.list": LIST })
    )
    expect(await screen.findByText("3 providers")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Twilio" })
    expect(link.getAttribute("href")).toBe(
      "/providers/hpvd_01j00000000000000000000002"
    )
    expect(link.closest("td")?.className).toMatch(/font-medium/)
  })

  it("puts the driver in mono and summarises credentials without values", async () => {
    renderPage(
      ProvidersPage,
      stubClient({ "engine.info": engine(), "providers.list": LIST })
    )
    const row = (await screen.findAllByRole("row")).find((r) =>
      within(r).queryByText("Twilio")
    )!
    expect(within(row).getByText("twilio").closest("td")?.className).toMatch(
      /font-mono text-xs/
    )
    expect(within(row).getByText("2 plaintext, 1 encrypted")).toBeTruthy()
    const inapp = screen
      .getAllByRole("row")
      .find((r) => within(r).queryByText("inapp (default)"))!
    expect(within(inapp).getByLabelText("no credentials")).toBeTruthy()
    expect(
      within(inapp).getByText("Disabled", { selector: '[data-slot="badge"]' })
    ).toBeTruthy()
  })

  it("warns once, above the table, when no credential key is configured", async () => {
    renderPage(
      ProvidersPage,
      stubClient({
        "engine.info": engine({ encryption: { configured: false } }),
        "providers.list": LIST,
      })
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/stored unencrypted/)
    expect(alert.textContent).toMatch(/credentials_key/)
  })

  it("does not warn when a key is configured", async () => {
    renderPage(
      ProvidersPage,
      stubClient({ "engine.info": engine(), "providers.list": LIST })
    )
    await screen.findByText("3 providers")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says so when there are none, counts zero, and offers New provider", async () => {
    renderPage(
      ProvidersPage,
      stubClient({
        "engine.info": engine(),
        "providers.list": { providers: [] },
      })
    )
    expect(await screen.findByText(/No providers yet/)).toBeTruthy()
    expect(screen.getByText("0 providers")).toBeTruthy()
    for (const l of screen.getAllByRole("link", { name: "New provider" }))
      expect(l.getAttribute("href")).toBe("/new-provider")
  })

  it("shows the error card when the list fails", async () => {
    renderPage(
      ProvidersPage,
      scriptedClient({
        "engine.info": engine(),
        "providers.list": () =>
          new ContractError("INTERNAL", "an internal error occurred"),
      }).client
    )
    expect(await screen.findByText(/Providers unavailable/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
