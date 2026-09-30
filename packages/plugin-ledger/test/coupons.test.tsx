import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerCouponDetailPage } from "../src/pages/coupon-detail"
import { LedgerCouponsPage } from "../src/pages/coupons"
import { formatDay } from "../src/lib/datetime"
import { redemptionsText, validityText } from "../src/lib/coupons"
import { failingClient, recordingQueryClient, renderPage, renderWithNavigation, scriptedClient, stubClient } from "./harness"
import { aCoupon, aPage, usd } from "./fixtures"

const LIST = aPage([
  aCoupon(),
  aCoupon({ id: "cpn_welcome10", code: "WELCOME10", name: "Welcome credit", type: "amount", amount: usd(1000), percentage: undefined, max_redemptions: 0, times_redeemed: 3 }),
  aCoupon({ id: "cpn_old", code: "SUMMER50", name: "Summer", valid_until: "2020-01-01T00:00:00Z" }),
])

describe("validityText and redemptionsText", () => {
  it("reads both bounds, one bound, or none", () => {
    const from = "2026-09-01T10:00:00Z"
    const until = "2026-12-01T10:00:00Z"
    expect(validityText(aCoupon({ valid_from: from, valid_until: until }))).toBe(`${formatDay(from)} – ${formatDay(until)}`)
    expect(validityText(aCoupon({ valid_from: from }))).toBe(`From ${formatDay(from)}`)
    expect(validityText(aCoupon({ valid_until: until }))).toBe(`Until ${formatDay(until)}`)
    expect(validityText(aCoupon())).toBeUndefined()
  })

  it("reads a cap of zero or less as no cap", () => {
    expect(redemptionsText(aCoupon())).toBe("1 of 100")
    expect(redemptionsText(aCoupon({ max_redemptions: 0, times_redeemed: 3 }))).toBe("3, no cap")
    expect(redemptionsText(aCoupon({ max_redemptions: -1, times_redeemed: 0 }))).toBe("0, no cap")
  })
})

describe("LedgerCouponsPage", () => {
  it("lists coupons, and can narrow to the ones active now", async () => {
    const { client, sent } = recordingQueryClient({ "coupons.list": LIST })
    renderPage(LedgerCouponsPage, client)
    await screen.findByText("WELCOME10")
    expect(sent[0].params).toEqual({ limit: 50, offset: 0 })
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "active" } })
    await waitFor(() => expect(sent.at(-1)?.params).toEqual({ limit: 50, offset: 0, active: true }))
  })

  it("reads discount, redemptions and state per row", async () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": LIST }))
    await screen.findByText("WELCOME10")
    const row = (code: string) => screen.getAllByRole("row").find((r) => within(r).queryByText(code))!
    expect(within(row("LAUNCH20")).getByText("20% off")).toBeTruthy()
    expect(within(row("LAUNCH20")).getByText("1 of 100")).toBeTruthy()
    expect(within(row("WELCOME10")).getByText(/10\.00 off/)).toBeTruthy()
    expect(within(row("WELCOME10")).getByText("3, no cap")).toBeTruthy()
    expect(within(row("SUMMER50")).getByText("Expired", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(row("WELCOME10")).getByLabelText("no validity window")).toBeTruthy()
    expect(screen.getByRole("link", { name: "LAUNCH20" }).getAttribute("href")).toBe("/coupons/cpn_launch20")
  })

  it("carries a live row count in the caption", async () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": LIST }))
    await screen.findByText("WELCOME10")
    expect(screen.getByText("3 coupons")).toBeTruthy()
  })

  it("says nothing exists when nothing does, and offers the way to add one", async () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": aPage([]) }))
    expect(await screen.findByText("No coupons yet.")).toBeTruthy()
    expect(screen.getAllByRole("link", { name: "New coupon" }).length).toBeGreaterThan(0)
  })

  it("says a filter matched nothing rather than that nothing exists", async () => {
    const { client } = recordingQueryClient({ "coupons.list": aPage([]) })
    renderPage(LedgerCouponsPage, client)
    await screen.findByText("No coupons yet.")
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "active" } })
    expect(await screen.findByText("No active coupons.")).toBeTruthy()
  })

  it("shows the engine's refusal, such as no app selected, never an empty table", async () => {
    renderPage(LedgerCouponsPage, failingClient(new ContractError("PERMISSION_DENIED", "no app selected: set the extension's app_id or send an app_id claim")))
    expect(await screen.findByText(/PERMISSION_DENIED: no app selected/)).toBeTruthy()
    expect(screen.queryByText("No coupons yet.")).toBeNull()
  })
})

describe("LedgerCouponDetailPage", () => {
  it("shows the coupon and deletes it through a confirmation", async () => {
    const { client, sent } = scriptedClient({ "coupons.detail": aCoupon() }, { "coupons.delete": { ok: true } })
    const { navigate } = renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_launch20" })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    expect(screen.getByText("20% off")).toBeTruthy()
    expect(screen.getByText("1 of 100")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete coupon" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/coupons"))
    expect(sent).toEqual([{ intent: "coupons.delete", payload: { id: "cpn_launch20" } }])
  })

  it("shows a refused delete inside the open dialog and keeps it open", async () => {
    const { client, sent } = scriptedClient(
      { "coupons.detail": aCoupon() },
      { "coupons.delete": new ContractError("INTERNAL", "store unavailable") },
    )
    const { navigate } = renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_launch20" })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete coupon" }))
    expect(await within(dialog).findByText("store unavailable")).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
  })

  it("shows no validity window as none, and the window when there is one", async () => {
    const { client } = scriptedClient({ "coupons.detail": aCoupon() })
    const { unmount } = renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_launch20" })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    expect(screen.getByLabelText("no validity window")).toBeTruthy()
    unmount()
    const until = "2026-12-01T10:00:00Z"
    const windowed = scriptedClient({ "coupons.detail": aCoupon({ valid_until: until }) })
    renderWithNavigation(LedgerCouponDetailPage, windowed.client, { id: "cpn_launch20" })
    expect(await screen.findByText(`Until ${formatDay(until)}`)).toBeTruthy()
  })

  it("says so when the coupon does not exist", async () => {
    const { client } = scriptedClient({ "coupons.detail": new ContractError("NOT_FOUND", "coupon not found") })
    renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_gone" })
    expect(await screen.findByText("No coupon with the id cpn_gone.")).toBeTruthy()
  })

  it("names a missing id rather than fetching", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerCouponDetailPage, client, {})
    expect(screen.getByRole("status").textContent).toMatch(/No coupon id in the address/)
  })
})
