import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerPlanDetailPage } from "../src/pages/plan-detail"
import { renderWithNavigation, scriptedClient } from "./harness"
import { aPlan } from "./fixtures"

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

  it("keeps a refused delete inside the dialog", async () => {
    const { navigate } = open(aPlan(), { "plans.delete": new ContractError("CONFLICT", "plan is in use by 1 subscription; archive it instead") })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete plan" }))
    expect(await within(dialog).findByText("plan is in use by 1 subscription; archive it instead")).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
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

  it("says so when the plan does not exist", async () => {
    const { client } = scriptedClient({ "plans.detail": new ContractError("NOT_FOUND", "plan not found") })
    renderWithNavigation(LedgerPlanDetailPage, client, { id: "plan_gone" })
    expect(await screen.findByText("No plan with the id plan_gone.")).toBeTruthy()
  })
})
