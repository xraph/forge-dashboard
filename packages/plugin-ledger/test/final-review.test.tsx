import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, queryStore } from "@forge-go/dashboard-plugin"
import { DefaultMethodBadge, FEATURE_STATUS_OPTIONS, INVOICE_STATUS_OPTIONS, PLAN_STATUS_OPTIONS, SUBSCRIPTION_STATUS_OPTIONS } from "../src/badges"
import { isNotFound } from "../src/components/not-found"
import { limitText, periodLabel, PERIOD_LABEL, TYPE_LABEL } from "../src/lib/features"
import { LedgerFeatureDetailPage } from "../src/pages/feature-detail"
import { LedgerFeatureEditPage } from "../src/pages/feature-edit"
import { LedgerFeaturesPage } from "../src/pages/features"
import { lineGroups, LedgerInvoiceDetailPage } from "../src/pages/invoice-detail"
import { LedgerPlanCreatePage } from "../src/pages/plan-create"
import { LedgerPlanDetailPage } from "../src/pages/plan-detail"
import { LedgerPlanEditPage } from "../src/pages/plan-edit"
import { planToForm } from "../src/pages/plan-form"
import { LedgerSubscriptionCreatePage } from "../src/pages/subscription-create"
import { LedgerSubscriptionDetailPage } from "../src/pages/subscription-detail"
import { LedgerSubscriptionsPage } from "../src/pages/subscriptions"
import { render } from "@testing-library/react"
import { renderPage, renderWithNavigation, scriptedClient, stubClient } from "./harness"
import { aCatalogFeature, aLineItem, anInvoice, aPage, aPlan, aSubscription, usd } from "./fixtures"

/*
 * The final whole-branch review's fixes, one describe per finding. The review
 * is .superpowers/sdd/2026-09-29-ledger-react-phase-c/final-review.md.
 */

const APP = { app_id: "app_ledger", providers: ["stripe"] }
const PLATFORM = { app_id: "", providers: [] }

/** A command that never settles until released, so a test can act while it is pending. */
function slowCommands(base: ReturnType<typeof scriptedClient>) {
  const releases: ((value: unknown) => void)[] = []
  const client = {
    ...base.client,
    command: (intent: string, payload?: unknown) => {
      base.sent.push({ intent, payload })
      return new Promise((resolve) => releases.push(resolve as (value: unknown) => void))
    },
  } as typeof base.client
  return { client, sent: base.sent, releases }
}

describe("I1: an invoice line of a type the page does not group", () => {
  const odd = aLineItem({ id: "li_odd", description: "Provider line", type: "subscription" as never })
  const blank = aLineItem({ id: "li_blank", description: "Untyped line", type: "" as never })

  it("groups the six known types in order and puts every other line under Other", () => {
    const groups = lineGroups([odd, aLineItem(), blank, aLineItem({ id: "li_tax", type: "tax" })])
    expect(groups.map((g) => g.label)).toEqual(["Base", "Tax", "Other"])
    expect(groups.at(-1)?.rows.map((l) => l.id)).toEqual(["li_odd", "li_blank"])
    expect(lineGroups([aLineItem()]).map((g) => g.key)).toEqual(["base"])
  })

  it("renders a line of an unknown or empty type in an Other group, and never says there are no lines", async () => {
    const { client } = scriptedClient({ "invoices.detail": { invoice: anInvoice({ line_items: [aLineItem(), odd, blank] }), subscription: aSubscription(), export_formats: [] } })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" })
    const other = await screen.findByRole("region", { name: "2 other lines" })
    expect(within(other).getByText("Provider line")).toBeTruthy()
    expect(within(other).getByText("Untyped line")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Other" })).toBeTruthy()
    expect(screen.queryByText("This invoice has no line items.")).toBeNull()
  })

  it("adds no Other group when every line is a known type", async () => {
    const { client } = scriptedClient({ "invoices.detail": { invoice: anInvoice(), subscription: aSubscription(), export_formats: [] } })
    renderWithNavigation(LedgerInvoiceDetailPage, client, { id: "inv_1" })
    await screen.findByRole("heading", { name: "Base" })
    expect(screen.queryByRole("heading", { name: "Other" })).toBeNull()
  })
})

describe("I2: a shared feature from an app", () => {
  const shared = aCatalogFeature({ app_id: "" })

  function openDetail(feature = shared, settings: unknown = APP) {
    const { client, sent } = scriptedClient({ "features.detail": feature, "settings.detail": settings })
    return { ...renderWithNavigation(LedgerFeatureDetailPage, client, { id: feature.id }), sent }
  }

  it("shows the note and no Edit, Archive, Delete or Sync when an app is selected", async () => {
    openDetail()
    expect(await screen.findByText(/It can be changed only with no app selected/)).toBeTruthy()
    // Settings has to answer before the controls are decided, so wait for the sync block, which is always there.
    await screen.findByRole("region", { name: "Payment provider" })
    await waitFor(() => expect(screen.queryByRole("link", { name: "Edit" })).toBeNull())
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Sync to provider" })).toBeNull()
  })

  it("keeps every control on a shared feature when no app is selected", async () => {
    openDetail(shared, PLATFORM)
    expect(await screen.findByRole("link", { name: "Edit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sync to provider" })).toBeTruthy()
  })

  it("keeps every control on an app's own feature, and never reads settings for it", async () => {
    const { client, sent } = scriptedClient({ "features.detail": aCatalogFeature() })
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_api_calls" })
    expect(await screen.findByRole("link", { name: "Edit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sync to provider" })).toBeTruthy()
    expect(sent).toHaveLength(0)
  })

  it("leaves the controls for the server to decide when settings cannot be read", async () => {
    openDetail(shared, new ContractError("UNAVAILABLE", "the ledger engine is not running"))
    expect(await screen.findByRole("link", { name: "Edit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("shows the note in place of the form on the edit page, from an app", async () => {
    const { client } = scriptedClient({ "features.detail": shared, "settings.detail": APP })
    renderWithNavigation(LedgerFeatureEditPage, client, { id: shared.id })
    expect(await screen.findByText(/It can be changed only with no app selected/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    expect(screen.queryByLabelText("Name")).toBeNull()
    expect((screen.getByRole("link", { name: "Back to the feature" }) as HTMLAnchorElement).getAttribute("href")).toBe("/features/feat_api_calls")
  })

  it("shows the form on the edit page when no app is selected", async () => {
    const { client } = scriptedClient({ "features.detail": shared, "settings.detail": PLATFORM })
    renderWithNavigation(LedgerFeatureEditPage, client, { id: shared.id })
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeTruthy()
    expect(screen.queryByText(/It can be changed only with no app selected/)).toBeNull()
  })
})

describe("I3: soft limits are not promised as billed overage", () => {
  it("words the detail page's over-the-limit row by what the engine does", async () => {
    const { client } = scriptedClient({ "features.detail": aCatalogFeature({ soft_limit: true }) })
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_api_calls" })
    expect(await screen.findByText("Soft: use past the limit is not blocked")).toBeTruthy()
    expect(screen.queryByText(/billed as overage/)).toBeNull()
  })

  it("words a hard limit as refusing use past it", async () => {
    const { client } = scriptedClient({ "features.detail": aCatalogFeature({ soft_limit: false }) })
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_api_calls" })
    expect(await screen.findByText("Hard: use past the limit is refused")).toBeTruthy()
  })

  it("words the form's soft-limit box without promising revenue", async () => {
    const { client } = scriptedClient({}, {})
    const { LedgerFeatureCreatePage } = await import("../src/pages/feature-create")
    renderWithNavigation(LedgerFeatureCreatePage, client)
    expect(await screen.findByText("Soft limit: allow use past the limit. Overage is billed only if the plan's usage pricing prices it.")).toBeTruthy()
    expect(screen.queryByText(/bill it as overage/)).toBeNull()
  })
})

describe("M1: a same-tick double submit sends one write", () => {
  it("creates one subscription when two submits arrive before React re-renders", async () => {
    const base = scriptedClient({ "plans.list": aPage([aPlan()]) })
    const { client, sent, releases } = slowCommands(base)
    renderWithNavigation(LedgerSubscriptionCreatePage, client)
    await screen.findByRole("option", { name: "Pro" })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "plan_pro" } })
    const button = screen.getByRole("button", { name: "Create subscription" })
    const form = button.closest("form")!
    act(() => {
      button.click()
      button.click()
      form.requestSubmit()
    })
    expect(sent).toHaveLength(1)
    await act(async () => releases[0](aSubscription({ id: "sub_once" })))
    expect(sent).toHaveLength(1)
  })

  it("creates one plan, one feature and one coupon the same way", async () => {
    for (const [load, name] of [
      [async () => (await import("../src/pages/plan-create")).LedgerPlanCreatePage, "Create plan"],
      [async () => (await import("../src/pages/feature-create")).LedgerFeatureCreatePage, "Create feature"],
      [async () => (await import("../src/pages/coupon-create")).LedgerCouponCreatePage, "Create coupon"],
    ] as const) {
      const Page = await load()
      const { client, sent } = slowCommands(scriptedClient({}))
      const view = renderWithNavigation(Page, client)
      const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
      if (name === "Create plan") {
        fill("Name", "Pro")
        fill("Slug", "pro")
        fill("Base price", "10")
      } else if (name === "Create feature") {
        fill("Key", "api_calls")
      } else {
        fill("Code", "LAUNCH")
        fill("Percentage", "10")
      }
      const button = screen.getByRole("button", { name })
      act(() => {
        button.click()
        button.click()
      })
      expect(sent, name).toHaveLength(1)
      view.unmount()
    }
  })
})

describe("M2: plan-edit keeps the form through a refetch", () => {
  it("does not swap the form for a skeleton while plans.detail reloads", async () => {
    let calls = 0
    const base = scriptedClient({})
    const client = {
      ...base.client,
      query: (intent: string) => {
        if (intent !== "plans.detail") return Promise.reject(new ContractError("NOT_FOUND", "no handler"))
        calls += 1
        return calls === 1 ? Promise.resolve(aPlan()) : new Promise(() => {})
      },
    } as typeof base.client
    renderWithNavigation(LedgerPlanEditPage, client, { id: "plan_pro" })
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement
    fireEvent.change(name, { target: { value: "Pro Plus" } })
    act(() => queryStore.invalidate("ledger", ["plans.detail"]))
    await waitFor(() => expect(calls).toBe(2))
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Pro Plus")
  })
})

describe("M3: a stored tier with up_to 0 is unbounded in the form", () => {
  it("loads up_to 0 and anything below as no ceiling, and saves without refusing it", () => {
    const plan = aPlan()
    plan.pricing!.tiers = [
      { feature_key: "api_calls", type: "graduated", up_to: 0, unit_amount: usd(2), flat_amount: usd(0), priority: 0 },
      { feature_key: "api_calls", type: "graduated", up_to: -3, unit_amount: usd(2), flat_amount: usd(0), priority: 1 },
      { feature_key: "api_calls", type: "graduated", up_to: 500, unit_amount: usd(1), flat_amount: usd(0), priority: 2 },
    ]
    const form = planToForm(plan)
    expect(form.tiers.map((t) => [t.up_to, t.unbounded])).toEqual([
      ["", true],
      ["", true],
      ["500", false],
    ])
  })

  it("shows the unbounded box ticked on the edit page, with no refusal on save", async () => {
    const plan = aPlan()
    plan.pricing!.tiers = [{ feature_key: "api_calls", type: "graduated", up_to: 0, unit_amount: usd(2), flat_amount: usd(0), priority: 0 }]
    const { client, sent } = scriptedClient({ "plans.detail": plan }, { "plans.update": plan })
    const { navigate } = renderWithNavigation(LedgerPlanEditPage, client, { id: "plan_pro" })
    await screen.findByLabelText("Name")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/plans/plan_pro"))
    expect(screen.queryByText(/up to must be a whole number/)).toBeNull()
    const tiers = (sent[0].payload as { pricing: { tiers: { up_to: number }[] } }).pricing.tiers
    expect(tiers[0].up_to).toBe(-1)
  })
})

describe("M6: the subscription import help covers a plan that is not active yet", () => {
  it("says to activate a plan that is not active yet, not only an archived one", () => {
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": aPage([]), "plans.list": aPage([]) }))
    fireEvent.click(screen.getByRole("button", { name: "Import from provider" }))
    return screen.findByText(/activate it if it is not active yet/).then((el) => expect(el).toBeTruthy())
  })
})

describe("M8: an empty reset period is a none marker, never a blank cell", () => {
  it("shows one on the plan's feature table, the feature list and the feature detail", async () => {
    const plan = aPlan()
    plan.features = [{ ...plan.features[0], period: "" as never }]
    renderWithNavigation(LedgerPlanDetailPage, scriptedClient({ "plans.detail": plan }).client, { id: "plan_pro" })
    const table = await screen.findByRole("region", { name: "1 feature" })
    expect(within(table).getByLabelText("no reset period")).toBeTruthy()
  })

  it("on the feature list", async () => {
    renderPage(LedgerFeaturesPage, stubClient({ "features.list": aPage([aCatalogFeature({ period: "" as never })]) }))
    const row = (await screen.findByRole("link", { name: "API calls" })).closest("tr")!
    expect(within(row).getByLabelText("no reset period")).toBeTruthy()
  })

  it("on the feature detail", async () => {
    const { client } = scriptedClient({ "features.detail": aCatalogFeature({ period: "" as never }) })
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_api_calls" })
    expect(await screen.findByLabelText("no reset period")).toBeTruthy()
  })
})

describe("M9: a confirmation cannot be dismissed while its command is pending", () => {
  it("keeps the dialog open on Escape until the command settles", async () => {
    const { client, releases } = slowCommands(scriptedClient({ "features.detail": aCatalogFeature() }))
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_api_calls" })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete feature" }))
    await waitFor(() => expect(releases).toHaveLength(1))
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.queryByRole("alertdialog")).not.toBeNull()
    await act(async () => releases[0]({ ok: true }))
  })

  it("still closes on Escape when nothing is pending", async () => {
    const { client } = scriptedClient({ "features.detail": aCatalogFeature() })
    renderWithNavigation(LedgerFeatureDetailPage, client, { id: "feat_api_calls" })
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})

describe("M10: the passed-date note does not claim a paused subscription is active", () => {
  it("says the date passed without calling the subscription active", async () => {
    const { client } = scriptedClient({
      "subscriptions.detail": { subscription: aSubscription({ status: "paused", cancel_at: "2026-09-01T00:00:00Z" }), plan: aPlan(), applied_coupons: [] },
      "subscriptions.usage": { features: [], providers: [] },
      "invoices.list": aPage([]),
      "plans.list": aPage([aPlan()]),
    })
    renderWithNavigation(LedgerSubscriptionDetailPage, client, { id: "sub_acme" })
    expect(await screen.findByText("Date passed, not yet ended")).toBeTruthy()
    expect(screen.queryByText(/still active/)).toBeNull()
  })
})

describe("M12: an empty first page offers to create", () => {
  it("offers New feature on an empty, unfiltered feature list, and not once filtered or past page one", async () => {
    const empty = aPage([])
    renderPage(LedgerFeaturesPage, stubClient({ "features.list": empty }))
    expect(await screen.findByText("No features yet.")).toBeTruthy()
    expect(screen.getAllByRole("link", { name: "New feature" })).toHaveLength(2)
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } })
    await screen.findByText(/No draft features/)
    expect(screen.getAllByRole("link", { name: "New feature" })).toHaveLength(1)
  })

  it("offers New subscription on an empty, unfiltered subscription list", async () => {
    renderPage(LedgerSubscriptionsPage, stubClient({ "subscriptions.list": aPage([]), "plans.list": aPage([]) }))
    expect(await screen.findByText("No subscriptions yet.")).toBeTruthy()
    expect(screen.getAllByRole("link", { name: "New subscription" })).toHaveLength(2)
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "paused" } })
    await screen.findByText(/No paused subscriptions/)
    expect(screen.getAllByRole("link", { name: "New subscription" })).toHaveLength(1)
  })

})

describe("M13: the default payment method badge lives with the other badges", () => {
  it("renders a secondary Default badge", () => {
    render(<DefaultMethodBadge />)
    const badge = screen.getByText("Default")
    expect(badge.getAttribute("data-slot")).toBe("badge")
    expect(badge.className).toMatch(/secondary/)
  })
})

describe("M14: one set of feature labels", () => {
  it("reads a period and a type the same way everywhere, and none as Never", () => {
    expect(PERIOD_LABEL).toEqual({ monthly: "Monthly", yearly: "Yearly", none: "Never" })
    expect(TYPE_LABEL).toEqual({ metered: "Metered", seat: "Seats", boolean: "On or off" })
    expect(periodLabel("none")).toBe("Never")
    expect(periodLabel("")).toBeUndefined()
    expect(periodLabel("weekly")).toBe("weekly")
  })

  it("reads a limit the same for a plan feature and a catalog feature", () => {
    expect(limitText("boolean", 1)).toBe("Included")
    expect(limitText("boolean", 0)).toBe("Not included")
    expect(limitText("boolean", -1)).toBe("Not included")
    expect(limitText("metered", -1)).toBe("Unlimited")
    expect(limitText("seat", 10000)).toBe("10,000")
  })

  it("offers Never, not No reset, in the plan form's feature period", async () => {
    renderWithNavigation(LedgerPlanCreatePage, stubClient({}))
    fireEvent.click(await screen.findByRole("button", { name: /Add feature/ }))
    expect(screen.getAllByRole("option", { name: "Never" }).length).toBeGreaterThan(0)
    expect(screen.queryByRole("option", { name: "No reset" })).toBeNull()
  })
})

describe("M15: one source for status labels, and one problems alert", () => {
  it("builds every status filter from the badge maps", () => {
    expect(INVOICE_STATUS_OPTIONS.map((o) => o.label)).toEqual(["Draft", "Pending", "Past due", "Paid", "Voided"])
    expect(SUBSCRIPTION_STATUS_OPTIONS.map((o) => o.value)).toEqual(["active", "trialing", "past_due", "paused", "canceled", "expired"])
    expect(PLAN_STATUS_OPTIONS.map((o) => o.label)).toEqual(["Active", "Draft", "Archived"])
    expect(FEATURE_STATUS_OPTIONS.map((o) => o.label)).toEqual(["Active", "Draft", "Archived"])
  })

  it("moves focus to the plan form's problems, as the other forms do", async () => {
    renderWithNavigation(LedgerPlanCreatePage, stubClient({}))
    fireEvent.click(await screen.findByRole("button", { name: "Create plan" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Fix these before saving")
    await waitFor(() => expect(document.activeElement).toBe(alert))
  })
})

describe("M17: a malformed id reads as a missing record", () => {
  it("accepts the contract's invalid-id refusal for any noun, and nothing else under BAD_REQUEST", () => {
    expect(isNotFound({ code: "BAD_REQUEST", message: "id is not a valid id: sub_x" }, "plan")).toBe(true)
    expect(isNotFound({ code: "BAD_REQUEST", message: "plan_id is not a valid id: x" }, "plan")).toBe(false)
    expect(isNotFound({ code: "BAD_REQUEST", message: "unknown plan status" }, "plan")).toBe(false)
    expect(isNotFound({ code: "NOT_FOUND", message: "plan not found" }, "plan")).toBe(true)
    expect(isNotFound(undefined, "plan")).toBe(false)
  })

  it("shows the friendly state on a detail page for a malformed id", async () => {
    const { client } = scriptedClient({ "plans.detail": new ContractError("BAD_REQUEST", "id is not a valid id: sub_acme") })
    renderWithNavigation(LedgerPlanDetailPage, client, { id: "sub_acme" })
    expect(await screen.findByText("No plan with the id sub_acme.")).toBeTruthy()
  })
})
