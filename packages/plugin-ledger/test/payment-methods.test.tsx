import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { LedgerPaymentMethodsPage } from "../src/pages/payment-methods"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const METHODS = {
  configured: true,
  methods: [
    {
      id: "pm_1",
      type: "card",
      last4: "4242",
      brand: "visa",
      expiry_month: 12,
      expiry_year: 2028,
      is_default: true,
      provider_name: "stripe",
      provider_id: "pm_1Nf",
    },
    {
      id: "pm_2",
      type: "bank_account",
      last4: "6789",
      brand: "",
      expiry_month: 0,
      expiry_year: 0,
      is_default: false,
      provider_name: "stripe",
      provider_id: "ba_1Nf",
    },
  ],
}

function lookUp(tenant: string) {
  fireEvent.change(screen.getByLabelText("Tenant ID"), {
    target: { value: tenant },
  })
  fireEvent.click(screen.getByRole("button", { name: "Look up" }))
}

describe("LedgerPaymentMethodsPage", () => {
  it("reads nothing until a tenant is given, then sends it trimmed", async () => {
    const { client, sent } = recordingQueryClient({
      "paymentMethods.list": METHODS,
    })
    renderPage(LedgerPaymentMethodsPage, client)
    expect(sent).toHaveLength(0)
    expect(
      (screen.getByRole("button", { name: "Look up" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    lookUp("  acme ")
    await screen.findByText("4242")
    expect(sent[0]).toEqual({
      intent: "paymentMethods.list",
      params: { tenant_id: "acme" },
    })
  })

  it("lists the methods with a count, the default marked, and a none for a missing expiry", async () => {
    renderPage(
      LedgerPaymentMethodsPage,
      stubClient({ "paymentMethods.list": METHODS })
    )
    lookUp("acme")
    await screen.findByText("4242")
    expect(screen.getByText("2 payment methods for acme")).toBeTruthy()
    expect(
      screen.getByText("Default", { selector: '[data-slot="badge"]' })
    ).toBeTruthy()
    expect(screen.getByText("12/2028")).toBeTruthy()
    expect(screen.getByLabelText("no expiry")).toBeTruthy()
  })

  it("says when no payment provider is configured", async () => {
    renderPage(
      LedgerPaymentMethodsPage,
      stubClient({ "paymentMethods.list": { configured: false, methods: [] } })
    )
    lookUp("acme")
    expect(
      await screen.findByText("No payment provider is configured.")
    ).toBeTruthy()
  })

  it("explains a tenant with no subscription in this app", async () => {
    const client = {
      extension: "ledger",
      query: async () => {
        throw new ContractError("NOT_FOUND", "tenant not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderPage(LedgerPaymentMethodsPage, client)
    lookUp("nobody")
    expect(
      await screen.findByText(
        "nobody has no subscription in this app, so there are no payment methods to show."
      )
    ).toBeTruthy()
  })

  it("pads a single-digit expiry month", async () => {
    const card = { ...METHODS.methods[0], expiry_month: 3 }
    renderPage(
      LedgerPaymentMethodsPage,
      stubClient({
        "paymentMethods.list": { configured: true, methods: [card] },
      })
    )
    lookUp("acme")
    expect(await screen.findByText("03/2028")).toBeTruthy()
  })

  it("shows the no-app refusal for a lookup, not an empty result", async () => {
    renderPage(
      LedgerPaymentMethodsPage,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "no app selected: set the extension's app_id or send an app_id claim"
        )
      )
    )
    lookUp("acme")
    expect(
      (await screen.findAllByText(/PERMISSION_DENIED: no app selected/)).length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/has no subscription in this app/)).toBeNull()
  })

  it("keeps the no-subscription state for that exact NOT_FOUND only", async () => {
    renderPage(
      LedgerPaymentMethodsPage,
      failingClient(new ContractError("NOT_FOUND", "provider not found"))
    )
    lookUp("acme")
    expect(await screen.findByText("Payment methods unavailable")).toBeTruthy()
    expect(screen.queryByText(/has no subscription in this app/)).toBeNull()
  })

  it("says so when a tenant has none", async () => {
    renderPage(
      LedgerPaymentMethodsPage,
      stubClient({ "paymentMethods.list": { configured: true, methods: [] } })
    )
    lookUp("globex")
    await waitFor(() =>
      expect(
        screen.getByText("globex has no payment methods on file.")
      ).toBeTruthy()
    )
    expect(screen.getByText("0 payment methods for globex")).toBeTruthy()
  })
})
