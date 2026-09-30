import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerSubscriptionCreatePage } from "../src/pages/subscription-create"
import { failingClient, recordingQueryClient, renderWithNavigation, scriptedClient } from "./harness"
import { aPage, aPlan, aSubscription } from "./fixtures"

const ACTIVE = aPage([aPlan(), aPlan({ id: "plan_starter", name: "Starter", slug: "starter", features: [] })])

describe("LedgerSubscriptionCreatePage", () => {
  it("offers only active plans", async () => {
    const { client, sent } = recordingQueryClient({ "plans.list": ACTIVE })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Starter" })
    expect(sent[0]).toEqual({ intent: "plans.list", params: { status: "active", limit: 200, offset: 0 } })
  })

  it("asks for seat counts only for the chosen plan's seat features, and sends only the ones given", async () => {
    const { client, sent } = scriptedClient({ "plans.list": ACTIVE }, { "subscriptions.create": aSubscription({ id: "sub_new" }) })
    const { navigate } = renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Pro" })
    expect((screen.getByRole("button", { name: "Create subscription" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: " acme " } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    fireEvent.change(await screen.findByLabelText("Seats"), { target: { value: "6" } })
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/subscriptions/sub_new"))
    expect(sent[0]).toEqual({ intent: "subscriptions.create", payload: { tenant_id: "acme", plan_id: "plan_pro", quantity: { seats: 6 } } })
  })

  it("leaves quantity out when no seat count is given", async () => {
    const { client, sent } = scriptedClient({ "plans.list": ACTIVE }, { "subscriptions.create": aSubscription({ id: "sub_new" }) })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Starter" })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "globex" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_starter" } })
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ tenant_id: "globex", plan_id: "plan_starter" })
  })

  it("refuses a seat count that is not a whole number without sending", async () => {
    const { client, sent } = scriptedClient({ "plans.list": ACTIVE }, { "subscriptions.create": aSubscription() })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Pro" })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    fireEvent.change(await screen.findByLabelText("Seats"), { target: { value: "2.5" } })
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }))
    expect(await screen.findByText("Seats must be a whole number, 0 or more.")).toBeTruthy()
    expect(sent).toHaveLength(0)
  })

  it("refuses a seat count past what the engine can hold, and moves focus to the alert", async () => {
    const { client, sent } = scriptedClient({ "plans.list": ACTIVE }, { "subscriptions.create": aSubscription() })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Pro" })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    fireEvent.change(await screen.findByLabelText("Seats"), { target: { value: "99999999999999999999" } })
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Seats must be a whole number, 0 or more.")
    expect(document.activeElement).toBe(alert)
    expect(sent).toHaveLength(0)
  })

  it("does not send a seat count typed for another plan's seat feature", async () => {
    const other = aPlan({
      id: "plan_team",
      name: "Team",
      slug: "team",
      features: [{ id: "pf_members", key: "members", name: "Members", type: "seat", limit: 5, period: "none", soft_limit: false, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z" }],
    })
    const { client, sent } = scriptedClient({ "plans.list": aPage([aPlan(), other]) }, { "subscriptions.create": aSubscription({ id: "sub_new" }) })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Team" })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    fireEvent.change(await screen.findByLabelText("Seats"), { target: { value: "6" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_team" } })
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ tenant_id: "acme", plan_id: "plan_team" })
  })

  it("says what the plan starts with, and links that text to the select", async () => {
    const trial = aPlan({ id: "plan_trial", name: "Trial", slug: "trial", trial_days: 14 })
    const { client } = scriptedClient({ "plans.list": aPage([aPlan(), trial]) })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Trial" })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_trial" } })
    const help = await screen.findByText(/Starts with a 14-day trial\./)
    expect(screen.getByLabelText("Plan").getAttribute("aria-describedby")).toBe(help.id)
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    expect(await screen.findByText(/Starts active, with no trial\./)).toBeTruthy()
  })

  it("shows the refusal when the plan stopped being active meanwhile", async () => {
    const { client } = scriptedClient({ "plans.list": ACTIVE }, { "subscriptions.create": new ContractError("BAD_REQUEST", 'invalid input: plan "starter" is archived, not active') })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Starter" })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_starter" } })
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }))
    expect(await screen.findByText('invalid input: plan "starter" is archived, not active')).toBeTruthy()
  })

  it("says so when there is no active plan to subscribe to", async () => {
    const { client } = scriptedClient({ "plans.list": aPage([]) })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    expect(await screen.findByText("There is no active plan to subscribe to.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Go to plans" }).getAttribute("href")).toBe("/plans")
  })

  it("shows the no-app refusal as an error, not as no active plans", async () => {
    renderWithNavigation(LedgerSubscriptionCreatePage, failingClient(new ContractError("PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")))
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText("There is no active plan to subscribe to.")).toBeNull()
  })

  it("prints no price period for a plan whose billing period is none", async () => {
    const free = aPlan({ id: "plan_free", name: "Free", slug: "free", pricing: { ...aPlan().pricing!, billing_period: "none" } })
    const { client } = scriptedClient({ "plans.list": aPage([aPlan(), free]) })
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Free" })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_free" } })
    const help = await screen.findByText(/Starts active, with no trial\./)
    expect(help.textContent).not.toMatch(/a month|a year/)
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    expect((await screen.findByText(/Starts active, with no trial\./)).textContent).toMatch(/\$49\.00 a month/)
  })
})
