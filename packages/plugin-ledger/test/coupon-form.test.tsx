import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerCouponCreatePage } from "../src/pages/coupon-create"
import { LedgerCouponEditPage } from "../src/pages/coupon-edit"
import {
  couponToForm,
  createCouponPayload,
  emptyCouponForm,
  updateCouponPayload,
} from "../src/pages/coupon-form"
import { renderWithNavigation, scriptedClient } from "./harness"
import { aCoupon, usd } from "./fixtures"

describe("createCouponPayload", () => {
  // Deviation from the brief, on the controller's ruling: the engine accepts a percentage coupon with no
  // currency and applies it to a plan in any currency, so the form sends "" unless one is chosen.
  it("sends an unrestricted percentage coupon with its percentage, no amount and an empty currency", () => {
    const v = {
      ...emptyCouponForm(),
      code: " LAUNCH20 ",
      name: "Launch",
      type: "percentage" as const,
      percentage: "20",
      max: "100",
    }
    const out = createCouponPayload(v)
    expect(out).toEqual({
      ok: true,
      value: {
        code: "LAUNCH20",
        name: "Launch",
        type: "percentage",
        percentage: 20,
        currency: "",
        max_redemptions: 100,
      },
    })
  })

  it("restricts a percentage coupon to one currency when one is given", () => {
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "EU",
        percentage: "10",
        currency: "EUR",
      })
    ).toMatchObject({ ok: true, value: { currency: "eur" } })
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "EU",
        percentage: "10",
        currency: "eu",
      })
    ).toEqual({
      ok: false,
      errors: [
        "Currency must be a three-letter code such as usd, or empty for any currency.",
      ],
    })
  })

  it("requires a currency for an amount coupon", () => {
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "TEN",
        type: "amount",
        amount: "10",
      })
    ).toEqual({
      ok: false,
      errors: ["An amount coupon needs a currency, such as usd."],
    })
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "TEN",
        type: "amount",
        amount: "10",
        currency: "us",
      })
    ).toEqual({
      ok: false,
      errors: ["Currency must be a three-letter code such as usd."],
    })
  })

  it("sends an amount coupon in minor units of its own currency", () => {
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "TEN",
        type: "amount",
        amount: "10.50",
        currency: "usd",
      })
    ).toMatchObject({
      ok: true,
      value: {
        type: "amount",
        amount: { amount: 1050, currency: "usd" },
        currency: "usd",
        max_redemptions: 0,
      },
    })
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "YEN",
        type: "amount",
        amount: "500",
        currency: "jpy",
      })
    ).toMatchObject({
      ok: true,
      value: { amount: { amount: 500, currency: "jpy" }, currency: "jpy" },
    })
  })

  it("lowercases the currency, which the engine does too, and keeps the code's case because lookups are exact", () => {
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "Welcome",
        percentage: "5",
        currency: " EUR ",
      })
    ).toMatchObject({
      ok: true,
      value: { code: "Welcome", currency: "eur" },
    })
  })

  it("refuses an amount it cannot represent exactly, a percentage over 100, and a backwards window", () => {
    const bad = createCouponPayload({
      ...emptyCouponForm(),
      code: "X",
      type: "amount",
      amount: "12.345",
      currency: "usd",
      valid_from: "2026-10-10T00:00",
      valid_until: "2026-10-01T00:00",
    })
    expect(bad).toEqual({
      ok: false,
      errors: [
        "The amount must be an amount in USD with at most 2 decimals.",
        "Valid until is before valid from.",
      ],
    })
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "X",
        percentage: "101",
      })
    ).toEqual({
      ok: false,
      errors: ["The percentage must be a whole number from 0 to 100."],
    })
  })

  it("words the amount error for a currency with no decimals without counting zero decimals", () => {
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "Y",
        type: "amount",
        amount: "5.5",
        currency: "jpy",
      })
    ).toEqual({
      ok: false,
      errors: [
        "The amount must be a whole number of JPY, which has no decimals.",
      ],
    })
  })

  it("refuses a max redemptions the engine's integer cannot hold", () => {
    expect(
      createCouponPayload({
        ...emptyCouponForm(),
        code: "X",
        percentage: "5",
        max: "99999999999999999999",
      })
    ).toEqual({
      ok: false,
      errors: ["Max redemptions must be a whole number, 0 for no cap."],
    })
  })

  it("sends the window as RFC3339 when set", () => {
    const out = createCouponPayload({
      ...emptyCouponForm(),
      code: "W",
      percentage: "5",
      valid_until: "2026-12-31T23:59",
    })
    expect(out.ok && out.value.valid_until).toBe(
      new Date("2026-12-31T23:59").toISOString()
    )
    expect(out.ok && "valid_from" in out.value).toBe(false)
  })
})

describe("updateCouponPayload", () => {
  const original = aCoupon({
    valid_from: "2026-09-01T10:00:00Z",
    valid_until: "2026-12-01T10:00:00Z",
  })

  it("sends only the id when nothing changed", () => {
    expect(updateCouponPayload(couponToForm(original), original)).toEqual({
      ok: true,
      value: { id: "cpn_launch20" },
    })
  })

  it("sends null to clear a bound and the new value to change one", () => {
    const v = {
      ...couponToForm(original),
      valid_until: "",
      valid_from: "2026-09-15T08:00",
      name: "Relaunch",
      max: "0",
    }
    expect(updateCouponPayload(v, original)).toEqual({
      ok: true,
      value: {
        id: "cpn_launch20",
        name: "Relaunch",
        max_redemptions: 0,
        valid_from: new Date("2026-09-15T08:00").toISOString(),
        valid_until: null,
      },
    })
  })

  it("never sends null for a bound that was never set", () => {
    const bare = aCoupon()
    expect(
      updateCouponPayload({ ...couponToForm(bare), valid_until: "" }, bare)
    ).toEqual({ ok: true, value: { id: "cpn_launch20" } })
  })

  it("never sends the fields the engine fixes after create, nor metadata", () => {
    const stored = aCoupon({ metadata: { campaign: "spring" } })
    const out = updateCouponPayload(
      {
        ...couponToForm(stored),
        name: "Other",
        code: "CHANGED",
        percentage: "50",
        currency: "eur",
      },
      stored
    )
    expect(out).toEqual({
      ok: true,
      value: { id: "cpn_launch20", name: "Other" },
    })
  })

  it("reads a stored uncapped coupon of zero or less as 0, so an edit is not refused over a number the operator never typed", () => {
    const uncapped = aCoupon({ max_redemptions: -1 })
    expect(couponToForm(uncapped).max).toBe("0")
    expect(
      updateCouponPayload(
        { ...couponToForm(uncapped), name: "Renamed" },
        uncapped
      )
    ).toEqual({ ok: true, value: { id: "cpn_launch20", name: "Renamed" } })
    // Setting a cap is still a change.
    expect(
      updateCouponPayload({ ...couponToForm(uncapped), max: "5" }, uncapped)
    ).toEqual({ ok: true, value: { id: "cpn_launch20", max_redemptions: 5 } })
  })

  it("does not rename a coupon whose stored name only differs by the whitespace the engine trims", () => {
    const padded = aCoupon({ name: "Launch offer " })
    expect(updateCouponPayload(couponToForm(padded), padded)).toEqual({
      ok: true,
      value: { id: "cpn_launch20" },
    })
  })

  it("omits a stored window that has seconds when it is untouched, since the input cannot show them", () => {
    const withSeconds = aCoupon({
      valid_from: "2026-09-01T10:00:37Z",
      valid_until: "2026-12-01T10:00:59.500Z",
    })
    expect(
      updateCouponPayload(
        { ...couponToForm(withSeconds), name: "Renamed" },
        withSeconds
      )
    ).toEqual({ ok: true, value: { id: "cpn_launch20", name: "Renamed" } })
  })

  it("refuses a window that runs backwards once one bound is changed", () => {
    const v = { ...couponToForm(original), valid_from: "2027-01-01T00:00" }
    expect(updateCouponPayload(v, original)).toEqual({
      ok: false,
      errors: ["Valid until is before valid from."],
    })
  })
})

describe("coupon pages", () => {
  const fill = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } })

  it("creates and lands on the new coupon", async () => {
    const { client, sent } = scriptedClient(
      {},
      { "coupons.create": aCoupon({ id: "cpn_new" }) }
    )
    const { navigate } = renderWithNavigation(LedgerCouponCreatePage, client)
    fill("Code", "WELCOME")
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "amount" },
    })
    fill("Amount", "10")
    fireEvent.click(screen.getByRole("button", { name: "Create coupon" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/coupons/cpn_new")
    )
    expect(sent[0].payload).toEqual({
      code: "WELCOME",
      name: "",
      type: "amount",
      amount: { amount: 1000, currency: "usd" },
      currency: "usd",
      max_redemptions: 0,
    })
  })

  it("does not style the code as uppercase, because what the input shows is what is sent", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerCouponCreatePage, client)
    expect(screen.getByLabelText("Code").className).not.toMatch(/\buppercase\b/)
  })

  it("ties each input to its help text, and focuses the problems after a failed submit", async () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerCouponCreatePage, client)
    const describedBy = (label: string) =>
      document.getElementById(
        screen.getByLabelText(label).getAttribute("aria-describedby") ?? ""
      )?.textContent
    expect(describedBy("Code")).toMatch(/unique within this app/i)
    expect(describedBy("Currency")).toMatch(
      /applies to a plan in any currency/i
    )
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "amount" },
    })
    expect(describedBy("Currency")).toMatch(
      /only be applied to plans billed in this currency/i
    )
    expect(describedBy("Max redemptions")).toMatch(/0 means no cap/)
    expect(describedBy("Valid from")).toMatch(/your own time zone/)
    expect(describedBy("Valid until")).toMatch(/your own time zone/)
    fireEvent.click(screen.getByRole("button", { name: "Create coupon" }))
    const alert = await screen.findByText("Code is required.")
    await waitFor(() =>
      expect(document.activeElement).toBe(alert.closest('[role="alert"]'))
    )
  })

  it("leaves the currency empty for a percentage coupon, fills usd for an amount coupon, and clears only what it filled", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerCouponCreatePage, client)
    const currency = () =>
      (screen.getByLabelText("Currency") as HTMLInputElement).value
    expect(currency()).toBe("")
    expect(screen.getByLabelText("Currency").getAttribute("placeholder")).toBe(
      "Any currency"
    )
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "amount" },
    })
    expect(currency()).toBe("usd")
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "percentage" },
    })
    expect(currency()).toBe("")
    // A currency the operator typed is theirs, and stays.
    fill("Currency", "eur")
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "amount" },
    })
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "percentage" },
    })
    expect(currency()).toBe("eur")
  })

  it("creates an unrestricted percentage coupon with an empty currency", async () => {
    const { client, sent } = scriptedClient(
      {},
      { "coupons.create": aCoupon({ id: "cpn_any", currency: "" }) }
    )
    const { navigate } = renderWithNavigation(LedgerCouponCreatePage, client)
    fill("Code", "ANY")
    fill("Percentage", "15")
    fireEvent.click(screen.getByRole("button", { name: "Create coupon" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/coupons/cpn_any")
    )
    expect(sent[0].payload).toEqual({
      code: "ANY",
      name: "",
      type: "percentage",
      percentage: 15,
      currency: "",
      max_redemptions: 0,
    })
  })

  it("shows a refused create and keeps what was typed", async () => {
    const { client } = scriptedClient(
      {},
      {
        "coupons.create": new ContractError(
          "CONFLICT",
          'coupon code "WELCOME" already exists in this app'
        ),
      }
    )
    const { navigate } = renderWithNavigation(LedgerCouponCreatePage, client)
    fill("Code", "WELCOME")
    fill("Percentage", "10")
    fireEvent.click(screen.getByRole("button", { name: "Create coupon" }))
    expect(await screen.findByText(/already exists in this app/)).toBeTruthy()
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe(
      "WELCOME"
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it("edits without offering the fields that cannot change", async () => {
    const { client, sent } = scriptedClient(
      { "coupons.detail": aCoupon() },
      { "coupons.update": aCoupon({ name: "Renamed" }) }
    )
    const { navigate } = renderWithNavigation(LedgerCouponEditPage, client, {
      id: "cpn_launch20",
    })
    await screen.findByDisplayValue("Launch offer")
    expect(screen.queryByLabelText("Code")).toBeNull()
    expect(screen.queryByLabelText("Amount")).toBeNull()
    expect(screen.getByText("LAUNCH20")).toBeTruthy()
    fill("Name", "Renamed")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/coupons/cpn_launch20")
    )
    expect(sent[0].payload).toEqual({ id: "cpn_launch20", name: "Renamed" })
  })

  it("clears a bound the operator emptied by sending null", async () => {
    const stored = aCoupon({ valid_until: "2026-12-01T10:00:00Z" })
    const { client, sent } = scriptedClient(
      { "coupons.detail": stored },
      { "coupons.update": aCoupon() }
    )
    renderWithNavigation(LedgerCouponEditPage, client, { id: stored.id })
    await screen.findByDisplayValue("Launch offer")
    fill("Valid until", "")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ id: "cpn_launch20", valid_until: null })
  })

  it("shows a refused save and keeps the form", async () => {
    const { client } = scriptedClient(
      { "coupons.detail": aCoupon() },
      {
        "coupons.update": new ContractError(
          "BAD_REQUEST",
          "coupon is valid until before it is valid from"
        ),
      }
    )
    renderWithNavigation(LedgerCouponEditPage, client, { id: "cpn_launch20" })
    await screen.findByDisplayValue("Launch offer")
    fill("Name", "Mine")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(
      await screen.findByText(/valid until before it is valid from/)
    ).toBeTruthy()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Mine"
    )
  })

  it("says so when the coupon does not exist", async () => {
    const { client } = scriptedClient({
      "coupons.detail": new ContractError("NOT_FOUND", "coupon not found"),
    })
    renderWithNavigation(LedgerCouponEditPage, client, { id: "cpn_gone" })
    expect(
      await screen.findByText("No coupon with the id cpn_gone.")
    ).toBeTruthy()
  })

  it("names a missing id rather than fetching", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerCouponEditPage, client, {})
    expect(screen.getByRole("status").textContent).toMatch(
      /No coupon id in the address/
    )
  })

  it("says an unrestricted coupon applies in any currency", async () => {
    const stored = aCoupon({ currency: "" })
    const { client } = scriptedClient({ "coupons.detail": stored })
    renderWithNavigation(LedgerCouponEditPage, client, { id: stored.id })
    await screen.findByDisplayValue("Launch offer")
    expect(screen.getByText(/20% off in any currency\./)).toBeTruthy()
  })

  it("keeps an amount coupon's discount in the summary without a money input", async () => {
    const stored = aCoupon({
      type: "amount",
      amount: usd(1000),
      percentage: undefined,
      code: "TEN",
    })
    const { client } = scriptedClient({ "coupons.detail": stored })
    renderWithNavigation(LedgerCouponEditPage, client, { id: stored.id })
    await screen.findByDisplayValue("Launch offer")
    expect(screen.getByText(/10\.00 off in USD/)).toBeTruthy()
    expect(screen.queryByLabelText("Amount")).toBeNull()
  })
})
