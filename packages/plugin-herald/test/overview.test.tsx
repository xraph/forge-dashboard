import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import type { OverviewStatsResponse } from "../src/wire"
import { engine, templateSummary } from "./data"
import { invalidatingClient, recordingQueryClient, renderPage, scriptedClient, stubClient } from "./harness"

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

  it("keeps the success message and shows the new posture when the refetch lands", async () => {
    const { client, queried } = invalidatingClient(
      {
        "engine.info": engine(),
        "overview.stats": (_input, call) => (call === 0 ? stats() : stats({ credentials: { plaintext: 0, encrypted: 7 } })),
      },
      {
        "providers.encryptStored": {
          answer: { providers: 2, valuesEncrypted: 3, alreadyEncrypted: 4 },
          invalidates: ["providers.list", "providers.detail", "overview.stats"],
        },
      },
    )
    renderPage(OverviewPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Encrypt stored credentials" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Encrypt" }))
    expect(await screen.findByText("Encrypted 3 values across 2 providers.")).toBeTruthy()
    await waitFor(() => expect(queried.filter((q) => q.intent === "overview.stats").length).toBeGreaterThan(1))
    expect(await screen.findByText(/All 7 stored values carry the encryption marker/)).toBeTruthy()
    expect(screen.getByText("Encrypted 3 values across 2 providers.")).toBeTruthy()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("keeps the success note mounted and empty until the encrypt lands, so a screen reader announces it", async () => {
    const { client } = scriptedClient({ "engine.info": engine(), "overview.stats": stats() }, { "providers.encryptStored": { providers: 2, valuesEncrypted: 3, alreadyEncrypted: 4 } })
    const { container } = renderPage(OverviewPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Encrypt stored credentials" }))
    const note = container.querySelector('p[role="status"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toBe("")
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Encrypt" }))
    await screen.findByText("Encrypted 3 values across 2 providers.")
    expect(container.querySelector('p[role="status"]')).toBe(note)
  })

  it("explains how to set a key when none is configured, and offers no button", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ encryption: { configured: false } }), "overview.stats": stats() }))
    expect(await screen.findByText(/No credential key is configured/)).toBeTruthy()
    expect(screen.getByText(/credentials_key/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Encrypt stored credentials" })).toBeNull()
  })

  it("says how many are plaintext and that the rest are under a key this server lacks", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ encryption: { configured: false } }), "overview.stats": stats() }))
    expect(await screen.findByText(/3 values are stored in plaintext and 4 are encrypted under a key this server no longer has/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/plaintext \(3 values\)/)
  })

  it("leaves out the key clause when no key ID is reported", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine({ encryption: { configured: true } }), "overview.stats": stats() }))
    fireEvent.click(await screen.findByRole("button", { name: "Encrypt stored credentials" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("3 plaintext values")
    expect(dialog.textContent).not.toMatch(/under key/)
    expect(screen.getByText("A credential key is configured.", { exact: false })).toBeTruthy()
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

  it("says an app with no templates has none, rather than that every one has a fallback", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ templatesWithoutFallback: [] }), "templates.list": { templates: [] } }))
    expect(await screen.findByText("This app has no templates yet.")).toBeTruthy()
    expect(screen.queryByText("Every template has a fallback version.")).toBeNull()
  })

  it("says every template has a fallback when there are templates and none is missing one", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ templatesWithoutFallback: [] }), "templates.list": { templates: [templateSummary()] } }))
    expect(await screen.findByText("Every template has a fallback version.")).toBeTruthy()
  })

  it("claims nothing about coverage it could not count", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ templatesWithoutFallback: [] }) }))
    expect(await screen.findByText("No template is missing a fallback version.")).toBeTruthy()
  })

  it("says plainly that nothing can send when no provider is enabled", async () => {
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ providers: { total: 2, enabled: 0 } }) }))
    expect(await screen.findByText("0 of 2 providers enabled.")).toBeTruthy()
    expect(screen.getByText("Nothing can send until you enable one.")).toBeTruthy()
  })

  it("says to add a provider when there are none, and leaves the warning out when one is enabled", async () => {
    const view = renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats({ providers: { total: 0, enabled: 0 } }) }))
    expect(await screen.findByText("Nothing can send until you add one.")).toBeTruthy()
    view.unmount()
    renderPage(OverviewPage, stubClient({ "engine.info": engine(), "overview.stats": stats() }))
    expect(await screen.findByText("4 of 5 providers enabled.")).toBeTruthy()
    expect(screen.queryByText(/Nothing can send/)).toBeNull()
  })

  it("shows the error card when the stats fail, not an empty table", async () => {
    renderPage(OverviewPage, scriptedClient({ "engine.info": engine(), "overview.stats": () => new ContractError("INTERNAL", "an internal error occurred") }).client)
    expect(await screen.findByText(/Message counts unavailable/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
