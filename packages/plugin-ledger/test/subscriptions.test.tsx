import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { LedgerSubscriptionsPage } from "../src/pages/subscriptions"
import { recordingQueryClient, renderPage, stubClient } from "./harness"
import { aPage, aPlan, aSubscription } from "./fixtures"

const SUBS = aPage([
  aSubscription(),
  aSubscription({ id: "sub_globex", tenant_id: "globex", plan_id: "plan_starter", status: "trialing", trial_end: "2026-10-08T00:00:00Z" }),
  aSubscription({ id: "sub_wayne", tenant_id: "wayne", status: "active", cancel_at: "2026-10-20T00:00:00Z" }),
])
const PLANS = aPage([aPlan(), aPlan({ id: "plan_starter", name: "Starter", slug: "starter" })])

describe("LedgerSubscriptionsPage", () => {
  it("lists subscriptions with plan names from the plan list", async () => {
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": SUBS, "plans.list": PLANS }))
    await screen.findByText("globex")
    const row = (tenant: string) => screen.getAllByRole("row").find((r) => within(r).queryByText(tenant))!
    expect(within(row("globex")).getByText("Starter")).toBeTruthy()
    expect(within(row("globex")).getByText("Trialing", { selector: '[data-slot="badge"]' }).className).toMatch(/secondary/)
    expect(within(row("acme")).getByLabelText("no scheduled cancellation")).toBeTruthy()
    expect(within(row("wayne")).queryByLabelText("no scheduled cancellation")).toBeNull()
    expect(screen.getByRole("link", { name: "acme" }).getAttribute("href")).toBe("/subscriptions/sub_acme")
    expect(screen.getByText("3 subscriptions")).toBeTruthy()
  })

  it("falls back to the plan id when the plan list does not name it", async () => {
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": aPage([aSubscription({ plan_id: "plan_gone" })]), "plans.list": PLANS }))
    expect((await screen.findByText("plan_gone")).className).toMatch(/font-mono/)
  })

  it("falls back to the plan id when the plan has no name", async () => {
    const nameless = aPage([aPlan({ name: "" })])
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": aPage([aSubscription()]), "plans.list": nameless }))
    expect((await screen.findByText("plan_pro")).className).toMatch(/font-mono/)
  })

  it("still lists subscriptions, by plan id, when the plan list fails", async () => {
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": aPage([aSubscription()]) }))
    expect((await screen.findByText("plan_pro")).className).toMatch(/font-mono/)
  })

  it("filters by tenant and status, back on page one", async () => {
    const { client, sent } = recordingQueryClient({ "subscriptions.list": SUBS, "plans.list": PLANS })
    renderPage(LedgerSubscriptionsPage, client)
    await screen.findByText("globex")
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: " acme " } })
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "past_due" } })
    await waitFor(() =>
      expect(sent.filter((s) => s.intent === "subscriptions.list").at(-1)?.params).toEqual({ limit: 50, offset: 0, tenant_id: "acme", status: "past_due" }),
    )
    expect(sent.find((s) => s.intent === "plans.list")?.params).toEqual({ limit: 200, offset: 0 })
  })

  it("names the filter in the empty state", async () => {
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": aPage([]), "plans.list": PLANS }))
    expect(await screen.findByText("No subscriptions yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "initech" } })
    expect(await screen.findByText("No subscriptions for initech.")).toBeTruthy()
  })
})
