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
    expect(parsed.value.pricing.base_amount).toEqual({ amount: 4999, currency: "usd" })
    expect(parsed.value.features[0].limit).toBe(-1)
    expect(parsed.value.features[1].limit).toBe(10)
    expect(parsed.value.pricing.tiers[0]).toEqual({
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
