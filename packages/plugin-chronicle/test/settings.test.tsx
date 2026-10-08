import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SettingsPage } from "../src/pages/settings"
import { failingClient, renderPage, stubClient } from "./harness"
import type { SettingsDetail } from "../src/types"

const defaults: SettingsDetail = {
  batchSize: 100,
  flushInterval: "1s",
  retentionInterval: "24h0m0s",
  enableCryptoErasure: false,
  digestScheme: "chronicle/v4",
  keyed: false,
  checkpointingConfigured: false,
  backendName: "sqlite",
  backendHoldsCheckpoints: true,
}

describe("SettingsPage", () => {
  it("says what the default deployment cannot see, in words", async () => {
    renderPage(SettingsPage, stubClient({ "settings.detail": defaults }))
    await waitFor(() => expect(screen.getByText("chronicle/v4")).toBeTruthy())
    expect(
      screen.getByText(
        /unkeyed digests detect accidental corruption, not deliberate alteration/i
      )
    ).toBeTruthy()
    expect(screen.getByText(/no checkpoints are taken/i)).toBeTruthy()
    expect(screen.queryByText(/secure|protected|tamper-proof/i)).toBeNull()
  })

  it("says what keyed digests and signed checkpoints add", async () => {
    renderPage(
      SettingsPage,
      stubClient({
        "settings.detail": {
          ...defaults,
          digestScheme: "chronicle/v5",
          keyed: true,
          checkpointingConfigured: true,
        },
      })
    )
    await waitFor(() => expect(screen.getByText("chronicle/v5")).toBeTruthy())
    expect(
      screen.getByText(/keyed digests detect deliberate alteration/i)
    ).toBeTruthy()
    expect(screen.getByText(/signed checkpoints/i)).toBeTruthy()
  })

  it("names the backend and says when it holds no checkpoints", async () => {
    renderPage(
      SettingsPage,
      stubClient({
        "settings.detail": {
          ...defaults,
          backendName: "redis",
          backendHoldsCheckpoints: false,
        },
      })
    )
    await waitFor(() => expect(screen.getByText("redis")).toBeTruthy())
    expect(
      screen.getByText(/this backend cannot store checkpoints/i)
    ).toBeTruthy()
  })

  it("shows a failed read as an error, not as an empty page", async () => {
    renderPage(
      SettingsPage,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "an app-wide view needs the chronicle.admin scope"
        )
      )
    )
    await waitFor(() =>
      expect(screen.getByText(/chronicle.admin/)).toBeTruthy()
    )
  })

  it("says the digest scheme applies to new events and points to each chain's pin", async () => {
    renderPage(SettingsPage, stubClient({ "settings.detail": defaults }))
    expect(
      await screen.findByText(
        "The digest scheme applies to new events only: events already recorded keep the scheme they were written with, and the Chain page shows where each chain's current scheme begins."
      )
    ).toBeTruthy()
  })
})
