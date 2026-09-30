import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerFeatureCreatePage } from "../src/pages/feature-create"
import { LedgerFeatureEditPage } from "../src/pages/feature-edit"
import { emptyFeatureForm, featureToForm, parseFeatureForm } from "../src/pages/feature-form"
import { renderWithNavigation, scriptedClient } from "./harness"
import { aCatalogFeature } from "./fixtures"

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("LedgerFeatureCreatePage", () => {
  it("sends the contract's fields and lands on the new feature", async () => {
    const { client, sent } = scriptedClient({}, { "features.create": aCatalogFeature({ id: "feat_new" }) })
    const { navigate } = renderWithNavigation(LedgerFeatureCreatePage, client)
    fill("Key", " exports ")
    fill("Name", "Exports")
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "boolean" } })
    fill("Default limit", "1")
    fireEvent.change(screen.getByLabelText("Resets"), { target: { value: "none" } })
    fireEvent.click(screen.getByRole("button", { name: "Create feature" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/features/feat_new"))
    expect(sent[0]).toEqual({
      intent: "features.create",
      payload: { key: "exports", name: "Exports", description: "", type: "boolean", default_limit: 1, period: "none", soft_limit: false },
    })
  })

  it("sends -1 for an unlimited default", async () => {
    const { client, sent } = scriptedClient({}, { "features.create": aCatalogFeature({ id: "feat_new" }) })
    renderWithNavigation(LedgerFeatureCreatePage, client)
    fill("Key", "seats")
    fireEvent.click(screen.getByLabelText("Unlimited"))
    fireEvent.click(screen.getByRole("button", { name: "Create feature" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as { default_limit: number }).default_limit).toBe(-1)
  })

  it("keeps the input when the key is taken", async () => {
    const message = 'feature key "seats" already exists in this app'
    const { client } = scriptedClient({}, { "features.create": new ContractError("CONFLICT", message) })
    renderWithNavigation(LedgerFeatureCreatePage, client)
    fill("Key", "seats")
    fireEvent.click(screen.getByRole("button", { name: "Create feature" }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("seats")
  })

  it("refuses a missing key and a bad limit before sending anything", async () => {
    const { client, sent } = scriptedClient({}, { "features.create": aCatalogFeature() })
    renderWithNavigation(LedgerFeatureCreatePage, client)
    fireEvent.click(screen.getByRole("button", { name: "Create feature" }))
    expect(await screen.findByText("Key is required.")).toBeTruthy()
    fill("Key", "k")
    fill("Default limit", "-2")
    fireEvent.click(screen.getByRole("button", { name: "Create feature" }))
    expect(await screen.findByText(/must be a whole number/)).toBeTruthy()
    expect(sent).toHaveLength(0)
  })

  it("never offers unlimited for an on-or-off feature, because the engine reads -1 there as off", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerFeatureCreatePage, client)
    expect(screen.getByLabelText("Unlimited")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "boolean" } })
    expect(screen.queryByLabelText("Unlimited")).toBeNull()
    // Switching to on-or-off starts it included, as the engine's own dashboard does.
    expect((screen.getByLabelText("Default limit") as HTMLInputElement).value).toBe("1")
  })
})

describe("parseFeatureForm", () => {
  it("drops unlimited for a boolean feature and keeps the typed limit", () => {
    const v = { ...emptyFeatureForm(), key: "sso", type: "boolean" as const, unlimited: true, limit: "0" }
    const parsed = parseFeatureForm(v, "create")
    expect(parsed.ok && parsed.value.default_limit).toBe(0)
  })

  it("reads a stored -1 on a boolean feature as not included rather than unlimited", () => {
    const form = featureToForm(aCatalogFeature({ type: "boolean", default_limit: -1 }))
    expect(form.unlimited).toBe(false)
    expect(form.limit).toBe("0")
  })
})

describe("LedgerFeatureEditPage", () => {
  it("sends only the fields that may change", async () => {
    const { client, sent } = scriptedClient({ "features.detail": aCatalogFeature() }, { "features.update": aCatalogFeature() })
    const { navigate } = renderWithNavigation(LedgerFeatureEditPage, client, { id: "feat_api_calls" })
    await screen.findByDisplayValue("API calls")
    expect(screen.queryByLabelText("Key")).toBeNull()
    expect(screen.getByText("api_calls")).toBeTruthy()
    fill("Default limit", "20000")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/features/feat_api_calls"))
    expect(sent[0].payload).toEqual({
      id: "feat_api_calls",
      name: "API calls",
      description: "Requests to the public API.",
      default_limit: 20000,
      period: "monthly",
      soft_limit: false,
    })
  })

  it("leaves metadata alone: the update binder keeps what an omitted field does not name", async () => {
    const stored = aCatalogFeature({ metadata: { tier: "gold" } })
    const { client, sent } = scriptedClient({ "features.detail": stored }, { "features.update": stored })
    renderWithNavigation(LedgerFeatureEditPage, client, { id: stored.id })
    await screen.findByDisplayValue("API calls")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0].payload as Record<string, unknown>
    // Omitted, never null and never {}: Go's *map binder treats null as "leave alone" but {} as "wipe".
    expect("metadata" in payload).toBe(false)
    expect("key" in payload).toBe(false)
    expect("type" in payload).toBe(false)
    expect(Object.values(payload).every((v) => v !== null)).toBe(true)
  })

  it("shows a refused save and keeps the form", async () => {
    const { client } = scriptedClient(
      { "features.detail": aCatalogFeature() },
      { "features.update": new ContractError("BAD_REQUEST", "default_limit -2 is below -1; use -1 for unlimited") },
    )
    renderWithNavigation(LedgerFeatureEditPage, client, { id: "feat_api_calls" })
    await screen.findByDisplayValue("API calls")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(await screen.findByText(/below -1/)).toBeTruthy()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("API calls")
  })
})
