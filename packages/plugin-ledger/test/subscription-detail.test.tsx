import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { legalActions, LedgerSubscriptionDetailPage } from "../src/pages/subscription-detail"
import { failingClient, renderPage, renderWithNavigation, scriptedClient } from "./harness"
import { aCoupon, anInvoice, aPage, aPlan, aSubscription } from "./fixtures"

const USAGE = {
  features: [
    { key: "api_calls", name: "API calls", type: "metered", period: "monthly", limit: 100000, used: 112000, remaining: 0, soft_limit: true, over_limit: true, enabled: false },
    { key: "seats", name: "Seats", type: "seat", period: "none", limit: 10, used: 6, remaining: 4, soft_limit: false, over_limit: false, enabled: false },
    { key: "sso", name: "Single sign-on", type: "boolean", period: "none", limit: 1, used: 0, remaining: -1, soft_limit: false, over_limit: false, enabled: true },
  ],
}

const STARTER = aPlan({ id: "plan_starter", name: "Starter", slug: "starter" })
// A plan with no seat feature, so the seat counts a subscription carries have nowhere to go.
const BASIC = aPlan({ id: "plan_basic", name: "Basic", slug: "basic", features: aPlan().features.filter((f) => f.type !== "seat") })

function answers(sub = aSubscription(), over: Record<string, unknown> = {}) {
  return {
    "subscriptions.detail": { subscription: sub, plan: aPlan(), applied_coupons: [aCoupon()] },
    "subscriptions.usage": USAGE,
    "invoices.list": aPage([anInvoice(), anInvoice({ id: "inv_other", subscription_id: "sub_old" })]),
    "plans.list": aPage([aPlan(), STARTER]),
    ...over,
  }
}

// Pinned so what "past" and "future" mean here does not drift with the calendar.
// Only Date is faked: timers, and so waitFor, keep running.
const NOW = "2026-09-30T12:00:00Z"
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * A dialog's description is a paragraph, so nothing block-level may sit inside
 * it. React reports that on the console only once per process, so a console
 * spy cannot tell one test from the next; the structure can.
 */
function expectPhrasingOnly(dialog: HTMLElement) {
  const description = dialog.querySelector("[data-slot=alert-dialog-description]")
  expect(description).not.toBeNull()
  expect(description?.querySelector("div, p, ul, ol, table, section, h1, h2, h3")).toBeNull()
}

function open(sub = aSubscription(), commands: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  const { client, sent } = scriptedClient(answers(sub, over), commands)
  return { ...renderWithNavigation(LedgerSubscriptionDetailPage, client, { id: sub.id }), sent }
}

describe("legalActions", () => {
  // Checked against ledger's ChangePlan, PauseSubscription, ResumeSubscription
  // and CancelSubscription: pause takes active and trialing, resume takes
  // paused, cancel and change-plan refuse only canceled and expired. The engine
  // puts no status rule on generating an invoice or applying a coupon. The page
  // still withholds both from a paused or finished subscription, so an operator
  // is not invited to discount one that is not running or to bill a paused one.
  // Generate stays for canceled and expired, so the last period can be billed.
  it("offers only what the engine allows from each state", () => {
    expect(legalActions("active")).toEqual(["generate", "changePlan", "applyCoupon", "pause", "cancel"])
    expect(legalActions("trialing")).toEqual(["generate", "changePlan", "applyCoupon", "pause", "cancel"])
    expect(legalActions("past_due")).toEqual(["generate", "changePlan", "applyCoupon", "cancel"])
    expect(legalActions("paused")).toEqual(["changePlan", "resume", "cancel"])
    // A finished subscription can still be invoiced: an immediate cancel would
    // otherwise strand the final period's overage and seats.
    expect(legalActions("canceled")).toEqual(["generate"])
    expect(legalActions("expired")).toEqual(["generate"])
  })
})

describe("LedgerSubscriptionDetailPage", () => {
  it("leads with usage against limits", async () => {
    open()
    const panel = await screen.findByRole("region", { name: "Usage against limits" })
    expect(within(panel).getByText("12,000 over the soft limit. Use is not blocked")).toBeTruthy()
    expect(within(panel).getByText("6 of 10")).toBeTruthy()
    expect(within(panel).getByText("Included")).toBeTruthy()
  })

  it("shows only this subscription's invoices", async () => {
    open()
    await screen.findByText("inv_1")
    expect(screen.queryByText("inv_other")).toBeNull()
    expect(screen.getByText("1 invoice for this subscription")).toBeTruthy()
  })

  it("says when the tenant has more invoices than one read holds", async () => {
    open(aSubscription(), {}, { "invoices.list": aPage([anInvoice()], { has_more: true }) })
    expect(await screen.findByText(/200 most recent invoices/)).toBeTruthy()
  })

  it("does not claim there are none when the read was cut short and none matched", async () => {
    open(aSubscription(), {}, { "invoices.list": aPage([anInvoice({ id: "inv_other", subscription_id: "sub_old" })], { has_more: true }) })
    expect(await screen.findByText("0 invoices for this subscription")).toBeTruthy()
    expect(screen.queryByText("No invoices for this subscription yet.")).toBeNull()
    expect(screen.getByText(/None of the tenant's 200 most recent invoices/)).toBeTruthy()
  })

  it("describes the subscription in the aside", async () => {
    open(aSubscription({ cancel_at: "2026-10-20T00:00:00Z" }))
    await screen.findByText("inv_1")
    const aside = screen.getByRole("complementary")
    expect(within(aside).getByRole("link", { name: "Pro" }).getAttribute("href")).toBe("/plans/plan_pro")
    expect(within(aside).getByRole("link", { name: "LAUNCH20" }).getAttribute("href")).toBe("/coupons/cpn_launch20")
    expect(within(aside).getByText("20% off")).toBeTruthy()
    expect(within(aside).getByText("seats: 6")).toBeTruthy()
    expect(within(aside).getByLabelText("no trial")).toBeTruthy()
    expect(within(aside).queryByLabelText("no scheduled cancellation")).toBeNull()
    expect(within(aside).getByText("Scheduled to cancel", { selector: "dt" })).toBeTruthy()
    expect(within(aside).queryByText(/Date passed/)).toBeNull()
  })

  it("reads a canceled subscription's end from canceled_at, which is what the engine writes", async () => {
    // The engine never writes ended_at, so a page reading it would show nothing.
    open(aSubscription({ status: "canceled", canceled_at: "2026-09-25T12:00:00Z", cancel_at: "2026-09-25T12:00:00Z" }))
    await screen.findByText("inv_1")
    const aside = screen.getByRole("complementary")
    expect(within(aside).getByText("Canceled", { selector: "dt" })).toBeTruthy()
    expect(within(aside).queryByText("Scheduled to cancel", { selector: "dt" })).toBeNull()
    expect(within(aside).queryByLabelText("no scheduled cancellation")).toBeNull()
  })

  it("says so when nothing is scheduled and no coupon is applied", async () => {
    open(aSubscription(), {}, { "subscriptions.detail": { subscription: aSubscription(), plan: aPlan(), applied_coupons: null } })
    await screen.findByText("inv_1")
    const aside = screen.getByRole("complementary")
    expect(within(aside).getByLabelText("no scheduled cancellation")).toBeTruthy()
    expect(within(aside).getByLabelText("no applied coupons")).toBeTruthy()
  })

  it("offers only invoicing on a canceled subscription", async () => {
    open(aSubscription({ status: "canceled" }))
    await screen.findByText("inv_1")
    for (const name of ["Pause", "Resume", "Cancel subscription", "Change plan", "Apply coupon"]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
    expect(screen.getByRole("button", { name: "Generate invoice" })).toBeTruthy()
  })

  it("offers only invoicing on an expired subscription, and shows the engine's refusal of a duplicate", async () => {
    open(aSubscription({ status: "expired" }), { "invoices.generate": new ContractError("CONFLICT", "ledger: already exists: invoice inv_1 already covers this billing period") })
    fireEvent.click(await screen.findByRole("button", { name: "Generate invoice" }))
    expect(await screen.findByText(/already covers this billing period/)).toBeTruthy()
    for (const name of ["Pause", "Resume", "Cancel subscription", "Change plan", "Apply coupon"]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
  })

  it("offers no invoicing on a paused subscription", async () => {
    open(aSubscription({ status: "paused" }))
    await screen.findByText("inv_1")
    expect(screen.queryByRole("button", { name: "Generate invoice" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply coupon" })).toBeNull()
  })

  it("says a scheduled cancellation whose date has passed ends on the clock's next run", async () => {
    open(aSubscription({ cancel_at: "2026-09-01T00:00:00Z" }), {}, { "settings.detail": { lifecycle_interval: "1m0s" } })
    await screen.findByText("inv_1")
    const aside = screen.getByRole("complementary")
    expect(within(aside).getByText("Scheduled to cancel", { selector: "dt" })).toBeTruthy()
    expect(await within(aside).findByText("Date passed, ends on the next lifecycle clock run (every 1m0s)")).toBeTruthy()
  })

  it("says nothing ends a passed cancellation while the lifecycle clock is off", async () => {
    open(aSubscription({ cancel_at: "2026-09-01T00:00:00Z" }), {}, { "settings.detail": { lifecycle_interval: "off" } })
    await screen.findByText("inv_1")
    const aside = screen.getByRole("complementary")
    expect(await within(aside).findByText("Date passed, but the lifecycle clock is off. It ends only when something else runs it.")).toBeTruthy()
    expect(within(aside).queryByText(/next lifecycle clock run/)).toBeNull()
  })

  it("claims only that the date passed when the settings cannot be read or carry no interval", async () => {
    // No settings.detail answer: the scripted client refuses it.
    open(aSubscription({ cancel_at: "2026-09-01T00:00:00Z" }))
    await screen.findByText("inv_1")
    expect(await within(screen.getByRole("complementary")).findByText("Date passed, not yet ended")).toBeTruthy()
    cleanup()
    queryStore.clear()
    open(aSubscription({ cancel_at: "2026-09-01T00:00:00Z" }), {}, { "settings.detail": {} })
    await screen.findByText("inv_1")
    expect(await within(screen.getByRole("complementary")).findByText("Date passed, not yet ended")).toBeTruthy()
  })

  it("does not say the date passed for a canceled or expired subscription", async () => {
    for (const status of ["canceled", "expired"] as const) {
      open(aSubscription({ status, canceled_at: "2026-09-01T00:00:00Z", cancel_at: "2026-09-01T00:00:00Z" }), {}, { "settings.detail": { lifecycle_interval: "1m0s" } })
      await screen.findByText("inv_1")
      expect(screen.queryByText(/Date passed/)).toBeNull()
      cleanup()
      queryStore.clear()
    }
  })

  it("shows the cancel_at date for a canceled subscription that has no canceled_at", async () => {
    open(aSubscription({ status: "canceled", cancel_at: "2026-09-25T12:00:00Z" }))
    await screen.findByText("inv_1")
    const aside = screen.getByRole("complementary")
    expect(within(aside).queryByLabelText("no scheduled cancellation")).toBeNull()
    expect(within(aside).getByText("Canceled", { selector: "dt" })).toBeTruthy()
  })

  it("cancels at the end of the period unless told otherwise", async () => {
    const { sent } = open(aSubscription(), { "subscriptions.cancel": aSubscription({ cancel_at: "2026-10-20T00:00:00Z" }) })
    fireEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel it" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "subscriptions.cancel", payload: { id: "sub_acme", immediately: false } }]))
  })

  it("says a period-end cancellation keeps its current status until the date", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByLabelText("Schedule the cancellation for the end of the period, Oct 20, 2026. It keeps its current status until then.")).toBeTruthy()
    expect(within(dialog).getByRole("radiogroup", { name: "When to cancel" })).toBeTruthy()
  })

  it("says so when the period has already ended: the cancellation is only dated then, and End it now stops it today", async () => {
    open(aSubscription({ current_period_end: "2026-09-20T00:00:00Z" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByLabelText(
        "The period ended on Sep 20, 2026, so the cancellation is dated then. The subscription keeps its current status until the ledger ends it. Choose End it now to stop it today.",
      ),
    ).toBeTruthy()
    expect(within(dialog).queryByLabelText(/Schedule the cancellation/)).toBeNull()
  })

  it("does not call a paused subscription active in either cancel branch", async () => {
    // A paused subscription stays paused until the cancellation is enacted, so
    // neither the scheduled branch nor the period-ended branch may say "active".
    for (const periodEnd of ["2026-10-20T00:00:00Z", "2026-09-20T00:00:00Z"]) {
      const { unmount } = open(aSubscription({ status: "paused", current_period_end: periodEnd }))
      fireEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }))
      const dialog = await screen.findByRole("alertdialog")
      const label = within(dialog).getByRole("radiogroup", { name: "When to cancel" }).querySelector("label") as HTMLElement
      expect(label.textContent).toMatch(/keeps its current status until/)
      expect(dialog.textContent).not.toMatch(/active/i)
      unmount()
    }
  })

  it("cancels now when asked, and keeps a refusal inside the dialog", async () => {
    const { sent } = open(aSubscription(), { "subscriptions.cancel": new ContractError("CONFLICT", "subscription is already canceled") })
    fireEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByLabelText("End it now"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel it" }))
    expect(await within(dialog).findByText("subscription is already canceled")).toBeTruthy()
    expect(sent[0].payload).toEqual({ id: "sub_acme", immediately: true })
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  // A dialog's description is a paragraph, so anything block-level inside it
  // (the kit's NativeSelect wraps its select in a div) is invalid markup that
  // React reports on the console.
  it("opens every dialog as valid markup", async () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      open(aSubscription({ status: "active" }), {}, { "plans.list": aPage([aPlan(), STARTER, BASIC]) })
      for (const [button, dialogTitle] of [
        ["Change plan", /Move acme to another plan/],
        ["Apply coupon", /Apply a coupon to acme/],
        ["Pause", /Pause acme/],
        ["Cancel subscription", /Cancel acme/],
      ] as const) {
        fireEvent.click(await screen.findByRole("button", { name: button }))
        const dialog = await screen.findByRole("alertdialog")
        expect(within(dialog).getByText(dialogTitle)).toBeTruthy()
        expectPhrasingOnly(dialog)
        if (button === "Change plan") {
          fireEvent.change(await within(dialog).findByLabelText("New plan"), { target: { value: "plan_basic" } })
          expectPhrasingOnly(dialog)
        }
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      }
      expect(complaints).not.toHaveBeenCalled()
    } finally {
      complaints.mockRestore()
    }
  })

  it("judges the period against the moment the cancel dialog opens, not the page load", async () => {
    // The period ends a minute after the pinned clock; the page loads before it and the dialog opens after.
    open(aSubscription({ current_period_end: "2026-09-30T12:01:00Z" }))
    const cancelButton = await screen.findByRole("button", { name: "Cancel subscription" })
    vi.setSystemTime(new Date("2026-09-30T12:05:00Z"))
    fireEvent.click(cancelButton)
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByLabelText(/^The period ended on Sep 30, 2026, so the cancellation is dated then\./)).toBeTruthy()
  })

  it("starts clean when the address moves to another subscription in place", async () => {
    const subs = { sub_one: aSubscription({ id: "sub_one", tenant_id: "one" }), sub_two: aSubscription({ id: "sub_two", tenant_id: "two" }) }
    const client = {
      extension: "ledger",
      query: async (intent: string, params?: { id?: string }) => {
        if (intent === "subscriptions.detail") return { subscription: subs[params?.id as keyof typeof subs], plan: aPlan(), applied_coupons: [] }
        return answers()[intent as keyof ReturnType<typeof answers>]
      },
      command: async () => aCoupon(),
    } as unknown as ScopedClient
    const page = (id: string) => (
      <PluginProvider client={client}>
        <LedgerSubscriptionDetailPage params={{ id }} />
      </PluginProvider>
    )
    // Visit sub_two first so its detail is cached: the move back is then instant,
    // the view never unmounts on a skeleton, and only the key can reset it.
    const view = render(page("sub_two"))
    await screen.findByText("two on Pro")
    view.rerender(page("sub_one"))
    await screen.findByText("one on Pro")
    fireEvent.click(await screen.findByRole("button", { name: "Apply coupon" }))
    fireEvent.change(within(await screen.findByRole("alertdialog")).getByLabelText("Coupon code"), { target: { value: "KEEP" } })
    view.rerender(page("sub_two"))
    await screen.findByText("two on Pro")
    expect(screen.queryByRole("alertdialog")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Apply coupon" }))
    expect((within(await screen.findByRole("alertdialog")).getByLabelText("Coupon code") as HTMLInputElement).value).toBe("")
  })

  it("does not carry one attempt's refusal or choice into the next", async () => {
    open(aSubscription(), { "subscriptions.cancel": new ContractError("CONFLICT", "subscription is already canceled") })
    fireEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }))
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByLabelText("End it now"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel it" }))
    await within(dialog).findByText("subscription is already canceled")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }))
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByText("subscription is already canceled")).toBeNull()
    expect((within(dialog).getByLabelText("End it now") as HTMLInputElement).checked).toBe(false)
  })

  it("pauses an active subscription and resumes a paused one", async () => {
    const first = open(aSubscription(), { "subscriptions.pause": aSubscription({ status: "paused" }) })
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Pause subscription" }))
    await waitFor(() => expect(first.sent[0]).toEqual({ intent: "subscriptions.pause", payload: { id: "sub_acme" } }))
    first.unmount()
    queryStore.clear()

    const second = open(aSubscription({ status: "paused" }), { "subscriptions.resume": aSubscription() })
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Resume subscription" }))
    await waitFor(() => expect(second.sent[0]).toEqual({ intent: "subscriptions.resume", payload: { id: "sub_acme" } }))
  })

  it("does not offer to pause a subscription the engine would refuse to pause", async () => {
    open(aSubscription({ status: "past_due" }))
    await screen.findByText("inv_1")
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy()
  })

  it("changes plan to another active plan, keeping seat counts", async () => {
    const { sent } = open(aSubscription(), { "subscriptions.changePlan": aSubscription({ plan_id: "plan_starter" }) })
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Change plan" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(await within(dialog).findByLabelText("New plan"), { target: { value: "plan_starter" } })
    expect(within(dialog).queryByRole("option", { name: "Pro" })).toBeNull()
    // Nothing to ask about: the counts carry over, so no quantity is sent and the engine keeps them.
    expect(within(dialog).queryByLabelText(/Clear the seat counts/)).toBeNull()
    fireEvent.click(confirm)
    await waitFor(() => expect(sent).toEqual([{ intent: "subscriptions.changePlan", payload: { id: "sub_acme", plan_id: "plan_starter" } }]))
  })

  // With no quantity the engine validates the subscription's current counts
  // against the new plan and refuses a count for a feature the plan has no seat
  // feature for. The page says so before it is asked, and clearing is a choice.
  it("asks before dropping seat counts the new plan has no seat feature for", async () => {
    const { sent } = open(aSubscription(), { "subscriptions.changePlan": aSubscription({ plan_id: "plan_basic", quantity: {} }) }, { "plans.list": aPage([aPlan(), STARTER, BASIC]) })
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(await within(dialog).findByLabelText("New plan"), { target: { value: "plan_basic" } })
    expect(within(dialog).getByText(/Basic has no seat feature for seats/)).toBeTruthy()
    const confirm = within(dialog).getByRole("button", { name: "Change plan" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(within(dialog).getByLabelText("Clear the seat counts for seats"))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(sent).toEqual([{ intent: "subscriptions.changePlan", payload: { id: "sub_acme", plan_id: "plan_basic", quantity: {} } }]))
  })

  it("keeps the seat counts the new plan can hold when it clears the others", async () => {
    const sub = aSubscription({ quantity: { seats: 6, editors: 2 } })
    const { sent } = open(sub, { "subscriptions.changePlan": aSubscription() }, { "plans.list": aPage([aPlan(), STARTER]) })
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(await within(dialog).findByLabelText("New plan"), { target: { value: "plan_starter" } })
    fireEvent.click(within(dialog).getByLabelText("Clear the seat counts for editors"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Change plan" }))
    await waitFor(() => expect(sent[0].payload).toEqual({ id: "sub_acme", plan_id: "plan_starter", quantity: { seats: 6 } }))
  })

  it("forgets the clear choice when another plan is picked", async () => {
    open(aSubscription(), {}, { "plans.list": aPage([aPlan(), STARTER, BASIC]) })
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
    const dialog = await screen.findByRole("alertdialog")
    const select = await within(dialog).findByLabelText("New plan")
    fireEvent.change(select, { target: { value: "plan_basic" } })
    fireEvent.click(within(dialog).getByLabelText("Clear the seat counts for seats"))
    fireEvent.change(select, { target: { value: "plan_starter" } })
    fireEvent.change(select, { target: { value: "plan_basic" } })
    expect((within(dialog).getByLabelText("Clear the seat counts for seats") as HTMLInputElement).checked).toBe(false)
    expect((within(dialog).getByRole("button", { name: "Change plan" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the engine's refusal of a plan change inside the dialog", async () => {
    open(aSubscription(), { "subscriptions.changePlan": new ContractError("NOT_FOUND", "plan not found") })
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(await within(dialog).findByLabelText("New plan"), { target: { value: "plan_starter" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Change plan" }))
    expect(await within(dialog).findByText("plan not found")).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("links the plan picker to its help text", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
    const dialog = await screen.findByRole("alertdialog")
    const select = await within(dialog).findByLabelText("New plan")
    const help = document.getElementById(select.getAttribute("aria-describedby") ?? "")
    expect(help?.textContent).toMatch(/not prorated/)
  })

  it("says so when the plan list cannot be read, and sends nothing", async () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      open(aSubscription(), {}, { "plans.list": new ContractError("INTERNAL", "internal error") })
      fireEvent.click(await screen.findByRole("button", { name: "Change plan" }))
      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByText("internal error")).toBeTruthy()
      expect((within(dialog).getByRole("button", { name: "Change plan" }) as HTMLButtonElement).disabled).toBe(true)
      // The select offers nothing to pick, so the button is disabled for that reason and no other.
      const options = within(within(dialog).getByLabelText("New plan")).getAllByRole("option")
      expect(options.map((o) => o.textContent)).toEqual(["Choose a plan"])
      expectPhrasingOnly(dialog)
      expect(complaints.mock.calls.some((c) => String(c[0]).includes("cannot be a descendant"))).toBe(false)
    } finally {
      complaints.mockRestore()
    }
  })

  it("applies a coupon by code and shows a refusal in the dialog", async () => {
    const { sent } = open(aSubscription(), { "coupons.apply": new ContractError("BAD_REQUEST", "coupon has expired") })
    fireEvent.click(await screen.findByRole("button", { name: "Apply coupon" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(within(dialog).getByLabelText("Coupon code"), { target: { value: " SUMMER50 " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }))
    expect(await within(dialog).findByText("coupon has expired")).toBeTruthy()
    expect(sent[0]).toEqual({ intent: "coupons.apply", payload: { subscription_id: "sub_acme", code: "SUMMER50" } })
  })

  // The engine matches a coupon code exactly, so what is sent must be what was
  // typed. A style that only displays capitals would make "summer50" look like
  // SUMMER50 while asking for something else.
  it("sends the code as typed and does not restyle it", async () => {
    const { sent } = open(aSubscription(), { "coupons.apply": aCoupon() })
    fireEvent.click(await screen.findByRole("button", { name: "Apply coupon" }))
    const dialog = await screen.findByRole("alertdialog")
    const input = within(dialog).getByLabelText("Coupon code") as HTMLInputElement
    expect(input.className).not.toMatch(/uppercase/)
    fireEvent.change(input, { target: { value: "Summer50" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(sent[0].payload).toEqual({ subscription_id: "sub_acme", code: "Summer50" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("holds Apply back until there is a code, and links the code to its help", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Apply coupon" }))
    const dialog = await screen.findByRole("alertdialog")
    const apply = within(dialog).getByRole("button", { name: "Apply" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Coupon code"), { target: { value: "   " } })
    expect(apply.disabled).toBe(true)
    const help = document.getElementById(within(dialog).getByLabelText("Coupon code").getAttribute("aria-describedby") ?? "")
    expect(help?.textContent).toMatch(/next invoice/)
  })

  it("generates an invoice and opens it", async () => {
    const { navigate, sent } = open(aSubscription(), { "invoices.generate": anInvoice({ id: "inv_new", status: "draft" }) })
    fireEvent.click(await screen.findByRole("button", { name: "Generate invoice" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/invoices/inv_new"))
    expect(sent[0]).toEqual({ intent: "invoices.generate", payload: { subscription_id: "sub_acme" } })
  })

  it("shows why an invoice could not be generated", async () => {
    open(aSubscription(), { "invoices.generate": new ContractError("CONFLICT", "ledger: already exists: invoice inv_1 already covers this billing period") })
    fireEvent.click(await screen.findByRole("button", { name: "Generate invoice" }))
    expect(await screen.findByText("ledger: already exists: invoice inv_1 already covers this billing period")).toBeTruthy()
  })

  it("says so when the subscription does not exist", async () => {
    const { client } = scriptedClient({ "subscriptions.detail": new ContractError("NOT_FOUND", "subscription not found") })
    renderWithNavigation(LedgerSubscriptionDetailPage, client, { id: "sub_gone" })
    expect(await screen.findByText("No subscription with the id sub_gone.")).toBeTruthy()
  })

  it("says so for the engine's own not-found wording too", async () => {
    const { client } = scriptedClient({ "subscriptions.detail": new ContractError("NOT_FOUND", "ledger: subscription not found") })
    renderWithNavigation(LedgerSubscriptionDetailPage, client, { id: "sub_gone" })
    expect(await screen.findByText("No subscription with the id sub_gone.")).toBeTruthy()
  })

  it("shows the engine's refusal, such as no app selected, never a missing subscription", async () => {
    renderPage(LedgerSubscriptionDetailPage, failingClient(new ContractError("PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")), { id: "sub_acme" })
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText(/No subscription with the id/)).toBeNull()
  })

  it("says so when the address carries no id", () => {
    const { client } = scriptedClient({})
    renderPage(LedgerSubscriptionDetailPage, client, {})
    expect(screen.getByText("No subscription id in the address, so there is nothing to show.")).toBeTruthy()
  })
})
