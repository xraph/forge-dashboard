import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import type { OverviewStatsResponse } from "../src/wire"
import { engine } from "./data"
import { recordingQueryClient, renderPage, scriptedClient, stubClient } from "./harness"

function stats(over: Partial<OverviewStatsResponse> = {}): OverviewStatsResponse {
  return {
    since: "2026-09-27T10:00:00Z",
    counts: [
      { status: "failed", channel: "email", n: 2 },
      { status: "sent", channel: "email", n: 40 },
      { status: "sent", channel: "sms", n: 9 },
    ],
    providers: { total: 5, enabled: 4 },
    credentials: { plaintext: 3, encrypted: 4 },
    templatesWithoutFallback: [{ id: "htpl_01j00000000000000000000011", slug: "auth.welcome", channel: "email" }],
    ...over,
  }
}

describe("OverviewPage", () => {
  it("asks for the last seven days first, then the window you pick", async () => {
    const { client, sent } = recordingQueryClient({ "engine.info": engine(), "overview.stats": stats() })
    renderPage(OverviewPage, client)
    await screen.findByText("51 messages since", { exact: false })
    expect(sent.find((s) => s.intent === "overview.stats")?.params).toEqual({ window: "7d" })
    fireEvent.click(screen.getByRole("button", { name: "24 hours" }))
    await waitFor(() => expect(sent.filter((s) => s.intent === "overview.stats").map((s) => s.params)).toContainEqual({ window: "24h" }))
  })

  it("shows only the statuses that have rows, and calls sent accepted, never delivered", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats() }))
    const table = await screen.findByRole("table")
    expect(within(table).getByRole("columnheader", { name: "Accepted by provider" })).toBeTruthy()
    expect(within(table).getByRole("columnheader", { name: "Failed" })).toBeTruthy()
    expect(within(table).queryByRole("columnheader", { name: "Suppressed" })).toBeNull()
    expect(document.body.textContent).not.toMatch(/delivered/i)
    expect(screen.getByText(/delivery isn't confirmed/)).toBeTruthy()
  })

  it("says nothing was handed over in the window, and still counts zero", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ counts: [] }) }))
    expect(await screen.findByText("No messages in this window.")).toBeTruthy()
    expect(screen.getByText(/0 messages since/)).toBeTruthy()
  })

  it("offers to encrypt the plaintext values when a key exists, naming how many change", async () => {
    const { client, sent } = scriptedClient(
      { "engine.info": engine(), "overview.stats": stats() },
      { "providers.encryptStored": { providers: 2, valuesEncrypted: 3, alreadyEncrypted: 4 } },
    )
    renderPage(OverviewPage, client)
    expect(await screen.findByText(/3 credential values are stored in plaintext/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Encrypt stored credentials" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("3 plaintext values")
    expect(dialog.textContent).toContain("k1")
    fireEvent.click(within(dialog).getByRole("button", { name: "Encrypt" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "providers.encryptStored", payload: {} }]))
    expect(await screen.findByText("Encrypted 3 values across 2 providers.")).toBeTruthy()
  })

  it("explains how to set a key when none is configured, and offers no button", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ encryption: { configured: false } }), "overview.stats": stats() }))
    expect(await screen.findByText(/No credential key is configured/)).toBeTruthy()
    expect(screen.getByText(/credentials_key/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Encrypt stored credentials" })).toBeNull()
  })

  it("does not call an install with no credentials encrypted", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ credentials: { plaintext: 0, encrypted: 0 } }) }))
    expect(await screen.findByText("No credentials are stored.")).toBeTruthy()
    expect(screen.queryByText(/all encrypted/i)).toBeNull()
  })

  it("says plainly that the REST API is open", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ apiProtected: false }), "overview.stats": stats() }))
    expect(await screen.findByText(/no auth middleware/)).toBeTruthy()
  })

  it("counts templates without a fallback and links to them", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats() }))
    expect(await screen.findByText(/1 template has no fallback version/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Show them" }).getAttribute("href")).toBe("/templates-without-fallback")
  })

  it("shows the error card when the stats fail, not an empty table", async () => {
    renderPage(OverviewPage, scriptedClient({ "engine.info": engine(), "overview.stats": () => new ContractError("INTERNAL", "an internal error occurred") }).client)
    expect(await screen.findByText(/Message counts unavailable/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
