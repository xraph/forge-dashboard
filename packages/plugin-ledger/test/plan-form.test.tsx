import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerPlanCreatePage } from "../src/pages/plan-create"
import { LedgerPlanEditPage } from "../src/pages/plan-edit"
import { emptyPlanForm, parsePlanForm, planToForm } from "../src/pages/plan-form"
import { failingClient, recordingCommandClient, renderWithNavigation, stubClient } from "./harness"
import { aPlan } from "./fixtures"

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe("parsePlanForm", () => {
  it("turns major-unit text into minor units and -1 for unlimited", () => {
    const v = emptyPlanForm()
    v.name = "Pro"
    v.slug = "pro"
    v.base = "49.99"
    v.features = [
      { key: "api_calls", name: "API calls", type: "metered", limit: "", unlimited: true, period: "monthly", soft_limit: false },
      { key: "seats", name: "Seats", type: "seat", limit: "10", unlimited: false, period: "none", soft_limit: false },
    ]
    v.tiers = [{ feature_key: "api_calls", type: "graduated", up_to: "", unbounded: true, unit: "0.02", flat: "0" }]
    const parsed = parsePlanForm(v, "create")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.pricing?.base_amount).toEqual({ amount: 4999, currency: "usd" })
    expect(parsed.value.features[0].limit).toBe(-1)
    expect(parsed.value.features[1].limit).toBe(10)
    expect(parsed.value.pricing?.tiers[0]).toEqual({
      feature_key: "api_calls",
      type: "graduated",
      up_to: -1,
      unit_amount: { amount: 2, currency: "usd" },
      flat_amount: { amount: 0, currency: "usd" },
      priority: 0,
    })
  })

  it("refuses what the contract would refuse, and says why", () => {
    const v = emptyPlanForm()
    v.base = "12.345"
    v.features = [
      { key: "api_calls", name: "", type: "metered", limit: "-5", unlimited: false, period: "monthly", soft_limit: false },
      { key: "api_calls", name: "", type: "metered", limit: "1", unlimited: false, period: "monthly", soft_limit: false },
    ]
    v.tiers = [{ feature_key: "missing", type: "flat", up_to: "0", unbounded: false, unit: "1", flat: "0" }]
    const parsed = parsePlanForm(v, "create")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toEqual([
      "Name is required.",
      "Slug is required.",
      "The base price must be an amount in USD with at most 2 decimals.",
      "Feature 1: the limit must be a whole number, 0 or more, or unlimited.",
      "Feature 2: the key api_calls is already used.",
      "Tier 1: missing is not one of this plan's features.",
      "Tier 1: up to must be a whole number above 0, or no limit.",
    ])
  })

  it("refuses a number too large to hold exactly, rather than rounding it", () => {
    const v = emptyPlanForm()
    v.name = "Pro"
    v.slug = "pro"
    v.trial_days = "99999999999999999999"
    v.features = [{ key: "api_calls", name: "", type: "metered", limit: "99999999999999999999", unlimited: false, period: "monthly", soft_limit: false }]
    v.tiers = [{ feature_key: "api_calls", type: "flat", up_to: "99999999999999999999", unbounded: false, unit: "1", flat: "0" }]
    const parsed = parsePlanForm(v, "create")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toEqual([
      "Trial days must be a whole number, 0 or more.",
      "Feature 1: the limit must be a whole number, 0 or more, or unlimited.",
      "Tier 1: up to must be a whole number above 0, or no limit.",
    ])
  })

  it("round-trips a stored plan, keeping feature ids", () => {
    const form = planToForm(aPlan())
    expect(form.base).toBe("49.00")
    expect(form.features[0]).toMatchObject({ id: "pf_api", key: "api_calls", limit: "100000", unlimited: false, soft_limit: true })
    expect(form.tiers[1]).toMatchObject({ up_to: "", unbounded: true, unit: "0.02" })
    const parsed = parsePlanForm(form, "edit")
    expect(parsed.ok && parsed.value.features[0].id).toBe("pf_api")
  })
})

describe("LedgerPlanCreatePage", () => {
  const CREATED = aPlan({ id: "plan_new", status: "draft" })

  it("sends exactly the contract's fields and lands on the new plan", async () => {
    const { client, sent } = recordingCommandClient({}, { "plans.create": CREATED })
    const { navigate } = renderWithNavigation(LedgerPlanCreatePage, client)
    fill("Name", "Team")
    fill("Slug", "team")
    fill("Base price", "19")
    fireEvent.click(screen.getByRole("button", { name: "Add feature" }))
    fill("Feature 1 key", "seats")
    fill("Feature 1 name", "Seats")
    fireEvent.change(screen.getByLabelText("Feature 1 type"), { target: { value: "seat" } })
    fill("Feature 1 limit", "5")
    fireEvent.change(screen.getByLabelText("Feature 1 resets"), { target: { value: "none" } })
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/plans/plan_new"))
    expect(sent).toHaveLength(1)
    expect(sent[0].intent).toBe("plans.create")
    expect(sent[0].payload).toEqual({
      name: "Team",
      slug: "team",
      description: "",
      currency: "usd",
      trial_days: 0,
      features: [{ key: "seats", name: "Seats", type: "seat", limit: 5, period: "none", soft_limit: false }],
      pricing: { base_amount: { amount: 1900, currency: "usd" }, billing_period: "monthly", tiers: [] },
    })
  })

  it("keeps what was typed and shows the refusal when the slug is taken", async () => {
    const { navigate } = renderWithNavigation(LedgerPlanCreatePage, failingClient(new ContractError("CONFLICT", 'a plan with the slug "team" already exists')))
    fill("Name", "Team")
    fill("Slug", "team")
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain('a plan with the slug "team" already exists')
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("team")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("defaults a boolean feature to on, with a hint, once its type is chosen", () => {
    renderWithNavigation(LedgerPlanCreatePage, stubClient({}))
    fireEvent.click(screen.getByRole("button", { name: "Add feature" }))
    expect(screen.queryByText("1 means on, 0 means off")).toBeNull()
    fireEvent.change(screen.getByLabelText("Feature 1 type"), { target: { value: "boolean" } })
    expect((screen.getByLabelText("Feature 1 limit") as HTMLInputElement).value).toBe("1")
    expect(screen.getByText("1 means on, 0 means off")).toBeTruthy()
  })

  it("gives each row's checkboxes a name of their own", () => {
    renderWithNavigation(LedgerPlanCreatePage, stubClient({}))
    fireEvent.click(screen.getByRole("button", { name: "Add feature" }))
    fireEvent.click(screen.getByRole("button", { name: "Add feature" }))
    fill("Feature 1 key", "a")
    fireEvent.click(screen.getByRole("button", { name: "Add tier" }))
    const boxes = screen.getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"))
    expect(boxes).toEqual([
      "Feature 1: unlimited",
      "Feature 1: soft limit",
      "Feature 2: unlimited",
      "Feature 2: soft limit",
      "Tier 1: no limit",
    ])
  })

  it("lists the form's problems and sends nothing", async () => {
    const { client, sent } = recordingCommandClient({}, { "plans.create": CREATED })
    renderWithNavigation(LedgerPlanCreatePage, client)
    fill("Base price", "abc")
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }))
    expect(await screen.findByText("Name is required.")).toBeTruthy()
    expect(screen.getByText("The base price must be an amount in USD with at most 2 decimals.")).toBeTruthy()
    expect(sent).toHaveLength(0)
  })
})

describe("LedgerPlanEditPage", () => {
  it("prefills from plans.detail and sends an update without the currency", async () => {
    const { client, sent } = recordingCommandClient({ "plans.detail": aPlan() }, { "plans.update": aPlan({ name: "Pro Plus" }) })
    const { navigate } = renderWithNavigation(LedgerPlanEditPage, client, { id: "plan_pro" })
    expect(((await screen.findByLabelText("Name")) as HTMLInputElement).value).toBe("Pro")
    expect((screen.getByLabelText("Currency") as HTMLInputElement).disabled).toBe(true)
    fill("Name", "Pro Plus")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/plans/plan_pro"))
    const payload = sent[0].payload as Record<string, unknown>
    expect(sent[0].intent).toBe("plans.update")
    expect(payload.id).toBe("plan_pro")
    expect(payload.name).toBe("Pro Plus")
    expect("currency" in payload).toBe(false)
    expect((payload.features as { id?: string }[])[0].id).toBe("pf_api")
  })

  it("sends the whole plan back: catalog links, metadata and the price id survive an edit", async () => {
    const stored = aPlan()
    stored.features[0] = { ...stored.features[0], catalog_id: "feat_api_calls", metadata: { tier: "core" } }
    const { client, sent } = recordingCommandClient({ "plans.detail": stored }, { "plans.update": stored })
    const { navigate } = renderWithNavigation(LedgerPlanEditPage, client, { id: "plan_pro" })
    await screen.findByLabelText("Name")
    fill("Description", "For teams.")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/plans/plan_pro"))
    expect(sent[0].payload).toEqual({
      id: "plan_pro",
      name: "Pro",
      slug: "pro",
      description: "For teams.",
      trial_days: 0,
      features: [
        { id: "pf_api", catalog_id: "feat_api_calls", metadata: { tier: "core" }, key: "api_calls", name: "API calls", type: "metered", limit: 100000, period: "monthly", soft_limit: true },
        { id: "pf_seats", key: "seats", name: "Seats", type: "seat", limit: 10, period: "none", soft_limit: false },
        { id: "pf_sso", key: "sso", name: "Single sign-on", type: "boolean", limit: 1, period: "none", soft_limit: false },
      ],
      pricing: {
        id: "price_pro",
        base_amount: { amount: 4900, currency: "usd" },
        billing_period: "monthly",
        tiers: [
          { feature_key: "api_calls", type: "graduated", up_to: 100000, unit_amount: { amount: 0, currency: "usd" }, flat_amount: { amount: 0, currency: "usd" }, priority: 0 },
          { feature_key: "api_calls", type: "graduated", up_to: -1, unit_amount: { amount: 2, currency: "usd" }, flat_amount: { amount: 0, currency: "usd" }, priority: 1 },
        ],
      },
    })
  })

  it("sends no pricing for a plan that has none until a base price or tier is set", async () => {
    const unpriced = aPlan({ pricing: null as never, features: [] })
    const { client, sent } = recordingCommandClient({ "plans.detail": unpriced }, { "plans.update": unpriced })
    const { navigate } = renderWithNavigation(LedgerPlanEditPage, client, { id: "plan_pro" })
    await screen.findByLabelText("Name")
    fill("Name", "Pro Plus")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect("pricing" in (sent[0].payload as object)).toBe(false)

    fill("Base price", "5")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect((sent[1].payload as { pricing: unknown }).pricing).toEqual({
      base_amount: { amount: 500, currency: "usd" },
      billing_period: "monthly",
      tiers: [],
    })
  })

  it("shows the refusal with its code and keeps what was typed when the update conflicts", async () => {
    const client = recordingCommandClient({ "plans.detail": aPlan() }).client
    const failing = {
      ...client,
      command: async () => {
        throw new ContractError("CONFLICT", 'a plan with the slug "team" already exists')
      },
    } as never
    const { navigate } = renderWithNavigation(LedgerPlanEditPage, failing, { id: "plan_pro" })
    await screen.findByLabelText("Name")
    fill("Slug", "team")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain('a plan with the slug "team" already exists')
    expect(alert.textContent).toContain("CONFLICT")
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("team")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("says so when the plan does not exist", async () => {
    const client = {
      extension: "ledger",
      query: async () => {
        throw new ContractError("NOT_FOUND", "plan not found")
      },
      command: async () => undefined,
    } as never
    renderWithNavigation(LedgerPlanEditPage, client, { id: "plan_gone" })
    expect(await screen.findByText("No plan with the id plan_gone.")).toBeTruthy()
  })

  it("loads nothing without an id", () => {
    renderWithNavigation(LedgerPlanEditPage, stubClient({}), {})
    expect(screen.getByText("No plan id in the address, so there is nothing to edit.")).toBeTruthy()
  })
})
