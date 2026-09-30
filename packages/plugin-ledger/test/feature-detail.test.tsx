import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerFeatureDetailPage } from "../src/pages/feature-detail"
import { renderWithNavigation, scriptedClient } from "./harness"
import { aCatalogFeature } from "./fixtures"

function open(feature = aCatalogFeature(), commands: Record<string, unknown> = {}) {
  const { client, sent } = scriptedClient({ "features.detail": feature }, commands)
  return { ...renderWithNavigation(LedgerFeatureDetailPage, client, { id: feature.id }), sent }
}

describe("LedgerFeatureDetailPage", () => {
  it("shows the feature's fields", async () => {
    open()
    await screen.findByRole("heading", { name: "API calls" })
    expect(screen.getByText("api_calls").className).toMatch(/font-mono/)
    expect(screen.getByText("10,000")).toBeTruthy()
    expect(screen.getByText("Requests to the public API.")).toBeTruthy()
    expect((screen.getByRole("link", { name: "Edit" }) as HTMLAnchorElement).getAttribute("href")).toBe("/features/feat_api_calls/edit")
  })

  it("offers the provider sync, and words the archive dialog as the engine behaves", async () => {
    open()
    expect(await screen.findByRole("button", { name: "Sync to provider" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/marked archived in the catalog/)).toBeTruthy()
    expect(within(dialog).queryByText(/no longer pick/)).toBeNull()
  })

  it("explains who can change a shared feature", async () => {
    open(aCatalogFeature({ app_id: "" }))
    await screen.findByRole("heading", { name: "API calls" })
    expect(screen.getByText(/Shared by every app on this server/)).toBeTruthy()
  })

  it("archives, and hides Archive on an archived feature", async () => {
    const { sent, unmount } = open(aCatalogFeature(), { "features.archive": { ok: true } })
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Archive feature" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "features.archive", payload: { id: "feat_api_calls" } }]))
    unmount()

    open(aCatalogFeature({ status: "archived" }))
    await screen.findByRole("heading", { name: "API calls" })
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
  })

  it("shows a refused delete inside its dialog, and leaves after a delete", async () => {
    const refused = open(aCatalogFeature(), { "features.delete": new ContractError("NOT_FOUND", "feature not found") })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete feature" }))
    expect(await within(dialog).findByText("feature not found")).toBeTruthy()
    refused.unmount()

    const { navigate } = open(aCatalogFeature(), { "features.delete": { ok: true } })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete feature" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/features"))
  })

  it("says so when the feature does not exist", async () => {
    const { client } = scriptedClient({ "features.detail": new ContractError("NOT_FOUND", "feature not found") })
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_gone" })
    expect(await screen.findByText("No feature with the id feat_gone.")).toBeTruthy()
  })
})
