import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ImportFromProviderAction } from "../src/components/import-from-provider"
import { planPath } from "../src/lib/paths"
import { LedgerFeaturesPage } from "../src/pages/features"
import { LedgerInvoicesPage } from "../src/pages/invoices"
import { LedgerPlansPage } from "../src/pages/plans"
import { LedgerSubscriptionsPage } from "../src/pages/subscriptions"
import type { Plan, SettingsDetail } from "../src/types"
import {
  recordingClient,
  renderWithNavigation,
  scriptedClient,
} from "./harness"
import {
  aCatalogFeature,
  anInvoice,
  aPage,
  aPlan,
  aSubscription,
} from "./fixtures"

const SETTINGS: SettingsDetail = {
  meter_batch_size: 100,
  meter_flush_interval: "5s",
  entitlement_cache_ttl: "30s",
  app_id: "app_ledger",
  require_app_claim: false,
  providers: ["stripe"],
  invoice_formats: [],
}
const withProviders = (providers: string[]): SettingsDetail => ({
  ...SETTINGS,
  providers,
})

function PlanImport() {
  return (
    <ImportFromProviderAction<Plan>
      intent="plans.importFromProvider"
      noun="plan"
      description="Copies one plan."
      pathOf={(p) => planPath(p.id)}
    />
  )
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Import from provider" }))
  return await screen.findByRole("dialog")
}

describe("ImportFromProviderAction", () => {
  it("reads settings.detail only once the dialog opens", async () => {
    const { client, intents } = recordingClient({ "settings.detail": SETTINGS })
    renderWithNavigation(PlanImport, client)
    expect(intents).toEqual([])
    const dialog = await openDialog()
    await within(dialog).findByLabelText("Provider ID")
    expect(intents).toEqual(["settings.detail"])
  })

  it("uses the only provider, trims the ID, and opens the imported record", async () => {
    const { client, sent } = scriptedClient(
      { "settings.detail": SETTINGS },
      { "plans.importFromProvider": aPlan({ id: "plan_growth" }) }
    )
    const { navigate } = renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    const idField = await within(dialog).findByLabelText("Provider ID")
    expect(
      (within(dialog).getByLabelText("Provider") as HTMLSelectElement).value
    ).toBe("stripe")
    fireEvent.change(idField, { target: { value: "  prod_growth " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import plan" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/plans/plan_growth")
    )
    expect(sent).toEqual([
      {
        intent: "plans.importFromProvider",
        payload: { provider_name: "stripe", provider_id: "prod_growth" },
      },
    ])
  })

  it("makes the operator choose when there are several providers", async () => {
    const { client, sent } = scriptedClient(
      { "settings.detail": withProviders(["braintree", "stripe"]) },
      { "plans.importFromProvider": aPlan() }
    )
    renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_1" },
    })
    const importButton = within(dialog).getByRole("button", {
      name: "Import plan",
    }) as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Provider"), {
      target: { value: "braintree" },
    })
    expect(importButton.disabled).toBe(false)
    fireEvent.click(importButton)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({
      provider_name: "braintree",
      provider_id: "prod_1",
    })
  })

  it("will not send a blank provider ID, even on Enter", async () => {
    const { client, sent } = scriptedClient(
      { "settings.detail": SETTINGS },
      { "plans.importFromProvider": aPlan() }
    )
    renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "   " },
    })
    const importButton = within(dialog).getByRole("button", {
      name: "Import plan",
    }) as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    fireEvent.submit(importButton.closest("form")!)
    expect(sent).toEqual([])
  })

  it("explains, and offers no form, when no provider is configured", async () => {
    renderWithNavigation(
      PlanImport,
      scriptedClient({ "settings.detail": withProviders([]) }).client
    )
    const dialog = await openDialog()
    expect(
      await within(dialog).findByText(/No payment provider is configured/)
    ).toBeTruthy()
    expect(within(dialog).queryByLabelText("Provider ID")).toBeNull()
    expect(
      within(dialog).queryByRole("button", { name: "Import plan" })
    ).toBeNull()
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy()
  })

  it("titles the dialog with the right article for the noun", async () => {
    const { client } = scriptedClient({ "settings.detail": SETTINGS })
    renderWithNavigation(
      () => (
        <ImportFromProviderAction<Plan>
          intent="invoices.importFromProvider"
          noun="invoice"
          description="Copies one."
          pathOf={() => "/"}
        />
      ),
      client
    )
    const dialog = await openDialog()
    expect(
      within(dialog).getByText("Import an invoice from the payment provider")
    ).toBeTruthy()
  })

  it("keeps the dialog open on a refusal and shows it there", async () => {
    const refusal = new ContractError(
      "CONFLICT",
      'ledger: already exists: slug "pro" is already used in this app'
    )
    const { client } = scriptedClient(
      { "settings.detail": SETTINGS },
      { "plans.importFromProvider": refusal }
    )
    const { navigate } = renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_pro" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import plan" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("Could not import the plan")
    expect(alert.textContent).toContain('slug "pro" is already used')
    expect(alert.textContent).toContain("CONFLICT")
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("says so when the providers cannot be read", async () => {
    const { client } = scriptedClient({
      "settings.detail": new ContractError(
        "UNAVAILABLE",
        "the ledger engine is not running"
      ),
    })
    renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("Could not read the payment providers")
    expect(alert.textContent).toContain("the ledger engine is not running")
  })
})

describe("ImportFromProviderAction: dialog behaviour", () => {
  // The real invariant: a refusal is never rendered inside the description,
  // which the kit renders as a <p>. The description itself stays text only.
  function expectAlertsOutsideDescription(dialog: HTMLElement) {
    const description = dialog.querySelector("[data-slot=dialog-description]")
    expect(description).not.toBeNull()
    expect(
      description?.querySelector(
        "div, p, ul, ol, table, section, h1, h2, h3, [role=alert]"
      )
    ).toBeNull()
    for (const alert of dialog.querySelectorAll("[role=alert]")) {
      expect(alert.closest("[data-slot=dialog-description]")).toBeNull()
    }
  }

  it("never renders an error inside the description, in any state", async () => {
    const refusal = new ContractError("CONFLICT", "slug already used")
    const { client } = scriptedClient(
      { "settings.detail": SETTINGS },
      { "plans.importFromProvider": refusal }
    )
    renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    expectAlertsOutsideDescription(dialog)
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_pro" },
    })
    expectAlertsOutsideDescription(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Import plan" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.closest("[data-slot=dialog-description]")).toBeNull()
    expectAlertsOutsideDescription(dialog)
  })

  it("links the help text to the field and names the provider in it", async () => {
    renderWithNavigation(
      PlanImport,
      scriptedClient({ "settings.detail": SETTINGS }).client
    )
    const dialog = await openDialog()
    const field = await within(dialog).findByLabelText("Provider ID")
    const hint = document.getElementById(
      field.getAttribute("aria-describedby") ?? ""
    )
    expect(hint?.textContent).toContain("plan's ID at stripe")
  })

  it("disables the buttons while the import is pending, so a second click sends nothing", async () => {
    let release: (value: unknown) => void = () => {}
    const { client, sent } = scriptedClient({ "settings.detail": SETTINGS })
    const slow = {
      ...client,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return new Promise((resolve) => {
          release = resolve as (value: unknown) => void
        })
      },
    } as typeof client
    const { navigate } = renderWithNavigation(PlanImport, slow)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_1" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import plan" }))
    const pending = await within(dialog).findByRole("button", {
      name: "Importing…",
    })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Cancel",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.submit(pending.closest("form")!)
    expect(sent).toHaveLength(1)
    release(aPlan({ id: "plan_slow" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/plans/plan_slow")
    )
  })

  it("sends once when two submits arrive in the same tick", async () => {
    let release: (value: unknown) => void = () => {}
    const { client, sent } = scriptedClient({ "settings.detail": SETTINGS })
    const slow = {
      ...client,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return new Promise((resolve) => {
          release = resolve as (value: unknown) => void
        })
      },
    } as typeof client
    const { navigate } = renderWithNavigation(PlanImport, slow)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_1" },
    })
    const button = within(dialog).getByRole("button", { name: "Import plan" })
    const form = button.closest("form")!
    // One act: React has not re-rendered, so the button is still enabled for both.
    act(() => {
      button.click()
      button.click()
      form.requestSubmit()
    })
    expect(sent).toHaveLength(1)
    release(aPlan({ id: "plan_once" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/plans/plan_once")
    )
    expect(sent).toHaveLength(1)
  })

  it("moves focus to the refusal after a failed submit", async () => {
    const refusal = new ContractError("NOT_FOUND", "stripe has no plan prod_x")
    const { client } = scriptedClient(
      { "settings.detail": SETTINGS },
      { "plans.importFromProvider": refusal }
    )
    renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_x" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import plan" }))
    const alert = await within(dialog).findByRole("alert")
    await waitFor(() =>
      expect(alert.parentElement).toBe(document.activeElement)
    )
  })

  it("keeps the ID while the dialog stays open, and starts clean when it is reopened", async () => {
    const refusal = new ContractError("NOT_FOUND", "stripe has no plan prod_x")
    const { client } = scriptedClient(
      { "settings.detail": SETTINGS },
      { "plans.importFromProvider": refusal }
    )
    renderWithNavigation(PlanImport, client)
    const dialog = await openDialog()
    fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
      target: { value: "prod_x" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import plan" }))
    await within(dialog).findByRole("alert")
    // While the dialog stays open on its refusal, the ID is kept for correction.
    expect(
      (within(dialog).getByLabelText("Provider ID") as HTMLInputElement).value
    ).toBe("prod_x")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // Reopened: no stale error, and an empty field.
    const reopened = await openDialog()
    const field = (await within(reopened).findByLabelText(
      "Provider ID"
    )) as HTMLInputElement
    expect(field.value).toBe("")
    expect(within(reopened).queryByRole("alert")).toBeNull()
  })
})

describe("the import action on each list page", () => {
  const cases = [
    {
      name: "plans",
      Page: LedgerPlansPage,
      answers: { "plans.list": aPage([aPlan()]) },
      intent: "plans.importFromProvider",
      noun: "plan",
      answer: aPlan({ id: "plan_new" }),
      path: "/plans/plan_new",
    },
    {
      name: "features",
      Page: LedgerFeaturesPage,
      answers: { "features.list": aPage([aCatalogFeature()]) },
      intent: "features.importFromProvider",
      noun: "feature",
      answer: aCatalogFeature({ id: "feat_new" }),
      path: "/features/feat_new",
    },
    {
      name: "subscriptions",
      Page: LedgerSubscriptionsPage,
      answers: {
        "subscriptions.list": aPage([aSubscription()]),
        "plans.list": aPage([aPlan()]),
      },
      intent: "subscriptions.importFromProvider",
      noun: "subscription",
      answer: {
        subscription: aSubscription({ id: "sub_new" }),
        plan: aPlan(),
        applied_coupons: [],
      },
      path: "/subscriptions/sub_new",
    },
    {
      name: "invoices",
      Page: LedgerInvoicesPage,
      answers: { "invoices.list": aPage([anInvoice()]) },
      intent: "invoices.importFromProvider",
      noun: "invoice",
      answer: {
        invoice: anInvoice({ id: "inv_new" }),
        subscription: aSubscription(),
        export_formats: [],
      },
      path: "/invoices/inv_new",
    },
  ]
  for (const c of cases) {
    it(`${c.name}: sends ${c.intent} and opens the imported record`, async () => {
      const { client, sent } = scriptedClient(
        { ...c.answers, "settings.detail": SETTINGS },
        { [c.intent]: c.answer }
      )
      const { navigate } = renderWithNavigation(c.Page, client)
      const dialog = await openDialog()
      fireEvent.change(await within(dialog).findByLabelText("Provider ID"), {
        target: { value: "ext_1" },
      })
      fireEvent.click(
        within(dialog).getByRole("button", { name: `Import ${c.noun}` })
      )
      await waitFor(() => expect(navigate).toHaveBeenCalledWith(c.path))
      expect(sent).toEqual([
        {
          intent: c.intent,
          payload: { provider_name: "stripe", provider_id: "ext_1" },
        },
      ])
    })
  }
})
