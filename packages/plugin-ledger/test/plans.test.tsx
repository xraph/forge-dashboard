import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerPlansPage } from "../src/pages/plans"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"
import { aPage, aPlan } from "./fixtures"

const PLANS = aPage([aPlan(), aPlan({ id: "plan_starter", name: "Starter", slug: "starter", status: "draft", trial_days: 14 })])

describe("LedgerPlansPage", () => {
  it("asks plans.list for the first page with no status filter", async () => {
    const { client, sent } = recordingQueryClient({ "plans.list": PLANS })
    renderPage(LedgerPlansPage, client)
    await screen.findByText("Starter")
    expect(sent[0]).toEqual({ intent: "plans.list", params: { limit: 50, offset: 0 } })
  })

  it("sends the status filter and goes back to page one when it changes", async () => {
    const { client, sent } = recordingQueryClient({ "plans.list": aPage(PLANS.items, { has_more: true }) })
    renderPage(LedgerPlansPage, client)
    await screen.findByText("Starter")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Page 2")
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } })
    await screen.findByText("Starter")
    expect(sent.map((s) => s.params)).toContainEqual({ limit: 50, offset: 50 })
    expect(sent.at(-1)?.params).toEqual({ limit: 50, offset: 0, status: "draft" })
  })

  it("counts exactly when everything fits, and links each plan", async () => {
    renderPage(LedgerPlansPage, stubClient({ "plans.list": PLANS }))
    await screen.findByText("Starter")
    expect(screen.getByText("2 plans")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Pro" })
    expect(link.getAttribute("href")).toBe("/plans/plan_pro")
    expect(link.closest("td")?.className).toMatch(/font-medium/)
    expect(screen.getByText("Active", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })

  it("right-aligns the base price in tabular figures", async () => {
    renderPage(LedgerPlansPage, stubClient({ "plans.list": PLANS }))
    await screen.findByText("Starter")
    const row = screen.getAllByRole("row").find((r) => within(r).queryByText("Pro"))!
    const price = within(row).getByText(/49\.00/)
    expect(price.className).toMatch(/tabular-nums/)
    expect(price.closest("td")?.className).toMatch(/text-right/)
    expect(within(row).getByLabelText("no trial")).toBeTruthy()
  })

  it("has three different empty states", async () => {
    const { unmount } = renderPage(LedgerPlansPage, stubClient({ "plans.list": aPage([]) }))
    expect(await screen.findByText("No plans yet.")).toBeTruthy()
    expect(screen.getByText("0 plans")).toBeTruthy()
    unmount()

    renderPage(LedgerPlansPage, stubClient({ "plans.list": aPage([]) }))
    await screen.findByText("No plans yet.")
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "archived" } })
    expect(await screen.findByText("No archived plans.")).toBeTruthy()
  })

  it("says a page past the end is empty rather than that nothing exists", async () => {
    // Page one claims more; page two, fetched after a delete elsewhere, is empty.
    // Keyed on the offset, not the call count: going back to page one asks again.
    const paging = {
      extension: "ledger",
      query: async (_intent: string, params?: { offset?: number }) =>
        (params?.offset ?? 0) === 0 ? aPage(PLANS.items, { has_more: true }) : aPage([], { offset: 50 }),
      command: async () => undefined,
    } as never
    renderPage(LedgerPlansPage, paging)
    await screen.findByText("Starter")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(await screen.findByText("Nothing on page 2.")).toBeTruthy()
    expect(screen.getByText("No plans on page 2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Back to the first page" }))
    expect(await screen.findByText("Starter")).toBeTruthy()
  })

  it("shows no pager when everything fits on one page", async () => {
    renderPage(LedgerPlansPage, stubClient({ "plans.list": PLANS }))
    await screen.findByText("Starter")
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull()
  })

  it("shows the no-app refusal as an error, not as no plans", async () => {
    renderPage(LedgerPlansPage, failingClient(new ContractError("PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")))
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText("No plans yet.")).toBeNull()
  })

  it("offers New plan", async () => {
    renderPage(LedgerPlansPage, stubClient({ "plans.list": PLANS }))
    await screen.findByText("Starter")
    expect(screen.getByRole("link", { name: "New plan" }).getAttribute("href")).toBe("/plans/new")
  })
})
