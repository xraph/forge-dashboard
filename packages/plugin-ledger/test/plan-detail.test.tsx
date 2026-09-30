import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerPlanDetailPage } from "../src/pages/plan-detail"
import { renderWithNavigation, scriptedClient } from "./harness"
import { aPlan, usd } from "./fixtures"

const OK = { ok: true }
const SYNCED = { provider_name: "stripe", provider_id: "stripe_plan_pro", entity_type: "plan", entity_id: "plan_pro", direction: "push", success: true }

function open(plan = aPlan(), commands: Record<string, unknown> = {}) {
  const { client, sent } = scriptedClient({ "plans.detail": plan }, commands)
  const view = renderWithNavigation(LedgerPlanDetailPage, client, { id: plan.id })
  return { ...view, sent }
}

describe("LedgerPlanDetailPage", () => {
  it("lists the plan's features with readable limits", async () => {
    open()
    await screen.findByRole("heading", { name: "Pro" })
    expect(screen.getByText("3 features")).toBeTruthy()
    const features = screen.getByRole("region", { name: "3 features" })
    const sso = within(features).getAllByRole("row").find((r) => within(r).queryByText("Single sign-on"))!
    expect(within(sso).getByText("Included")).toBeTruthy()
    const api = within(features).getAllByRole("row").find((r) => within(r).queryByText("API calls"))!
    expect(within(api).getByText("100,000")).toBeTruthy()
    expect(within(api).getByText("Soft")).toBeTruthy()
  })

  it("says Unlimited for a limit of -1 and Not included for a disabled boolean", async () => {
    open(
      aPlan({
        features: [
          { ...aPlan().features[0], limit: -1 },
          { ...aPlan().features[2], limit: 0 },
        ],
      }),
    )
    await screen.findByRole("heading", { name: "Pro" })
    expect(screen.getByText("Unlimited")).toBeTruthy()
    expect(screen.getByText("Not included")).toBeTruthy()
  })

  it("groups price tiers by feature and states where each starts", async () => {
    open()
    const group = await screen.findByRole("region", { name: "2 tiers for api_calls" })
    const rows = within(group).getAllByRole("row").slice(1)
    expect(within(rows[0]).getByText("1")).toBeTruthy()
    expect(within(rows[0]).getByText("100,000")).toBeTruthy()
    expect(within(rows[1]).getByText("100,001")).toBeTruthy()
    expect(within(rows[1]).getByText("No limit")).toBeTruthy()
    expect(within(rows[1]).getByText(/0\.02/).className).toMatch(/tabular-nums/)
  })

  it("summarises the price in the aside", async () => {
    open()
    await screen.findByRole("heading", { name: "Pro" })
    const aside = screen.getByRole("complementary")
    expect(within(aside).getByText(/49\.00/)).toBeTruthy()
    expect(within(aside).getByText("per month")).toBeTruthy()
    expect(within(aside).getByText("USD")).toBeTruthy()
    expect(within(aside).getByLabelText("no trial")).toBeTruthy()
  })

  it("archives an active plan through a confirmation", async () => {
    const { sent } = open(aPlan(), { "plans.archive": OK })
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive plan" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "plans.archive", payload: { id: "plan_pro" } }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("offers Activate, not Archive, on a draft", async () => {
    open(aPlan({ status: "draft" }), { "plans.activate": OK })
    await screen.findByRole("heading", { name: "Pro" })
    expect(screen.getByRole("button", { name: "Activate" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
  })

  it("keeps a refused delete inside the dialog, as valid markup", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { navigate } = open(aPlan(), { "plans.delete": new ContractError("CONFLICT", "plan is in use by 1 subscription; archive it instead") })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete plan" }))
    expect(await within(dialog).findByText("plan is in use by 1 subscription; archive it instead")).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(within(dialog).getByText("Could not delete plan")).toBeTruthy()
    expect(within(dialog).getByText("CONFLICT")).toBeTruthy()
    // React warns about a div inside the dialog's description paragraph.
    const nesting = spy.mock.calls.filter((c) => /cannot be a descendant|cannot contain a nested/.test(String(c[0])))
    spy.mockRestore()
    expect(nesting).toEqual([])
  })

  it("goes back to the list after a delete", async () => {
    const { navigate } = open(aPlan(), { "plans.delete": OK })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete plan" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/plans"))
  })

  it("links Edit to the edit page", async () => {
    open()
    expect((await screen.findByRole("link", { name: "Edit" })).getAttribute("href")).toBe("/plans/plan_pro/edit")
  })

  it("reports a sync, a refusal, and no provider, each differently", async () => {
    const first = open(aPlan(), { "plans.syncToProvider": SYNCED })
    fireEvent.click(await screen.findByRole("button", { name: "Sync to provider" }))
    expect(await screen.findByText("Synced to stripe.")).toBeTruthy()
    first.unmount()

    const second = open(aPlan(), { "plans.syncToProvider": { ...SYNCED, success: false, error: "stripe refused the sync: the plan is archived" } })
    fireEvent.click(await screen.findByRole("button", { name: "Sync to provider" }))
    expect(await screen.findByText("Sync failed: stripe refused the sync: the plan is archived")).toBeTruthy()
    second.unmount()

    open(aPlan(), { "plans.syncToProvider": new ContractError("UNAVAILABLE", "no payment provider is configured") })
    fireEvent.click(await screen.findByRole("button", { name: "Sync to provider" }))
    expect(await screen.findByText("No payment provider is configured, so there is nothing to sync to.")).toBeTruthy()
  })

  it("activates a draft through a confirmation", async () => {
    const { sent } = open(aPlan({ status: "draft" }), { "plans.activate": OK })
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate plan" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "plans.activate", payload: { id: "plan_pro" } }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("offers Activate on an archived plan", async () => {
    open(aPlan({ status: "archived" }), { "plans.activate": OK })
    await screen.findByRole("heading", { name: "Pro" })
    expect(screen.getByRole("button", { name: "Activate" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
  })

  it("orders tiers as the engine prices them: up_to ascending, unbounded last", async () => {
    const base = aPlan()
    const tier = (up_to: number, priority: number) => ({ feature_key: "api_calls", type: "graduated" as const, up_to, unit_amount: usd(1), flat_amount: usd(0), priority })
    const plan = aPlan({ pricing: { ...base.pricing!, tiers: [tier(1000, 0), tier(100, 1), tier(-1, 2)] } })
    open(plan)
    const group = await screen.findByRole("region", { name: "3 tiers for api_calls" })
    const rows = within(group).getAllByRole("row").slice(1)
    const cells = rows.map((r) => within(r).getAllByRole("cell").slice(1, 3).map((c) => c.textContent))
    expect(cells).toEqual([
      ["1", "100"],
      ["101", "1,000"],
      ["1,001", "No limit"],
    ])
    // The plan's own array is not reordered.
    expect(plan.pricing!.tiers!.map((t) => t.up_to)).toEqual([1000, 100, -1])
  })

  it("reads an up_to of 0 as no limit", async () => {
    const base = aPlan()
    const plan = aPlan({ pricing: { ...base.pricing!, tiers: [{ feature_key: "api_calls", type: "flat", up_to: 0, unit_amount: usd(1), flat_amount: usd(0), priority: 0 }] } })
    open(plan)
    const group = await screen.findByRole("region", { name: "1 tier for api_calls" })
    expect(within(group).getByText("No limit")).toBeTruthy()
    expect(within(group).queryByText(/^0$/)).toBeNull()
  })

  it("right-aligns the tier money cells", async () => {
    open()
    const group = await screen.findByRole("region", { name: "2 tiers for api_calls" })
    const cell = within(group).getByText(/0\.02/).closest("td")!
    expect(cell.className).toMatch(/text-right/)
  })

  it("shows the server's message beside the no-provider sentence, and no generic alert", async () => {
    open(aPlan(), { "plans.syncToProvider": new ContractError("UNAVAILABLE", "stored provider stripe is not registered") })
    fireEvent.click(await screen.findByRole("button", { name: "Sync to provider" }))
    expect(await screen.findByText("No payment provider is configured, so there is nothing to sync to.")).toBeTruthy()
    expect(screen.getByText("stored provider stripe is not registered")).toBeTruthy()
    expect(screen.queryByText("Could not sync")).toBeNull()
  })

  it("shows any other sync failure as a Could not sync alert with its code", async () => {
    open(aPlan(), { "plans.syncToProvider": new ContractError("INTERNAL", "boom") })
    fireEvent.click(await screen.findByRole("button", { name: "Sync to provider" }))
    expect(await screen.findByText("Could not sync")).toBeTruthy()
    expect(screen.getByText("boom")).toBeTruthy()
    expect(screen.getByText("INTERNAL")).toBeTruthy()
    expect(screen.queryByText("No payment provider is configured, so there is nothing to sync to.")).toBeNull()
  })

  it("announces sync outcomes inside one always-present live region", async () => {
    open(aPlan(), { "plans.syncToProvider": SYNCED })
    const panel = await screen.findByRole("region", { name: "Payment provider" })
    const live = panel.querySelector('[aria-live="polite"]')!
    expect(live).toBeTruthy()
    fireEvent.click(within(panel).getByRole("button", { name: "Sync to provider" }))
    await within(panel).findByText("Synced to stripe.")
    expect(panel.querySelector('[aria-live="polite"]')).toBe(live)
    expect(live.textContent).toContain("Synced to stripe.")
  })

  it("says so when the plan does not exist", async () => {
    const { client } = scriptedClient({ "plans.detail": new ContractError("NOT_FOUND", "plan not found") })
    renderWithNavigation(LedgerPlanDetailPage, client, { id: "plan_gone" })
    expect(await screen.findByText("No plan with the id plan_gone.")).toBeTruthy()
  })
})
