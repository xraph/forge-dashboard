import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerCouponDetailPage } from "../src/pages/coupon-detail"
import { LedgerCouponsPage } from "../src/pages/coupons"
import { formatLocalDay } from "../src/lib/datetime"
import { redemptionsText, validityText } from "../src/lib/coupons"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  renderWithNavigation,
  scriptedClient,
  stubClient,
} from "./harness"
import { aCoupon, aPage, usd } from "./fixtures"

const LIST = aPage([
  aCoupon(),
  aCoupon({
    id: "cpn_welcome10",
    code: "WELCOME10",
    name: "Welcome credit",
    type: "amount",
    amount: usd(1000),
    percentage: undefined,
    max_redemptions: 0,
    times_redeemed: 3,
  }),
  aCoupon({
    id: "cpn_old",
    code: "SUMMER50",
    name: "Summer",
    valid_until: "2020-01-01T00:00:00Z",
  }),
])

describe("validityText and redemptionsText", () => {
  it("reads both bounds, one bound, or none", () => {
    const from = "2026-09-01T10:00:00Z"
    const until = "2026-12-01T10:00:00Z"
    expect(
      validityText(aCoupon({ valid_from: from, valid_until: until }))
    ).toBe(`${formatLocalDay(from)} – ${formatLocalDay(until)}`)
    expect(validityText(aCoupon({ valid_from: from }))).toBe(
      `From ${formatLocalDay(from)}`
    )
    expect(validityText(aCoupon({ valid_until: until }))).toBe(
      `Until ${formatLocalDay(until)}`
    )
    expect(validityText(aCoupon())).toBeUndefined()
  })

  it("shows a window in the operator's own zone, the one the form edits it in", () => {
    // Built from local parts, so the assertion holds in any TZ: 23:59 on Dec 31 there is Dec 31 to the operator, never Jan 1.
    const until = new Date(2026, 11, 31, 23, 59).toISOString()
    const from = new Date(2026, 0, 1, 0, 0).toISOString()
    expect(validityText(aCoupon({ valid_until: until }))).toContain("Dec 31")
    expect(validityText(aCoupon({ valid_from: from }))).toContain("Jan 1")
    expect(validityText(aCoupon({ valid_from: from }))).not.toContain("Dec 31")
  })

  it("reads a cap of zero or less as no cap", () => {
    expect(redemptionsText(aCoupon())).toBe("1 of 100")
    expect(
      redemptionsText(aCoupon({ max_redemptions: 0, times_redeemed: 3 }))
    ).toBe("3, no cap")
    expect(
      redemptionsText(aCoupon({ max_redemptions: -1, times_redeemed: 0 }))
    ).toBe("0, no cap")
  })
})

describe("LedgerCouponsPage", () => {
  it("lists coupons, and can narrow to the ones active now", async () => {
    const { client, sent } = recordingQueryClient({ "coupons.list": LIST })
    renderPage(LedgerCouponsPage, client)
    await screen.findByText("WELCOME10")
    expect(sent[0].params).toEqual({ limit: 50, offset: 0 })
    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "active" },
    })
    await waitFor(() =>
      expect(sent.at(-1)?.params).toEqual({
        limit: 50,
        offset: 0,
        active: true,
      })
    )
  })

  it("reads discount, redemptions and state per row", async () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": LIST }))
    await screen.findByText("WELCOME10")
    const row = (code: string) =>
      screen.getAllByRole("row").find((r) => within(r).queryByText(code))!
    expect(within(row("LAUNCH20")).getByText("20% off")).toBeTruthy()
    expect(within(row("LAUNCH20")).getByText("1 of 100")).toBeTruthy()
    expect(within(row("WELCOME10")).getByText(/10\.00 off/)).toBeTruthy()
    expect(within(row("WELCOME10")).getByText("3, no cap")).toBeTruthy()
    expect(
      within(row("SUMMER50")).getByText("Expired", {
        selector: '[data-slot="badge"]',
      })
    ).toBeTruthy()
    expect(
      within(row("WELCOME10")).getByLabelText("no validity window")
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "LAUNCH20" }).getAttribute("href")
    ).toBe("/coupons/cpn_launch20")
  })

  it("carries a live row count in the caption", async () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": LIST }))
    await screen.findByText("WELCOME10")
    expect(screen.getByText("3 coupons")).toBeTruthy()
  })

  it("says nothing exists when nothing does, and offers the way to add one", async () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": aPage([]) }))
    expect(await screen.findByText("No coupons yet.")).toBeTruthy()
    expect(
      screen.getAllByRole("link", { name: "New coupon" }).length
    ).toBeGreaterThan(0)
  })

  it("says a filter matched nothing rather than that nothing exists", async () => {
    const { client } = recordingQueryClient({ "coupons.list": aPage([]) })
    renderPage(LedgerCouponsPage, client)
    await screen.findByText("No coupons yet.")
    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "active" },
    })
    expect(
      await screen.findByText("No coupons are within their validity window.")
    ).toBeTruthy()
  })

  it("labels the filter for what it does: the validity window only, so an exhausted coupon still shows", () => {
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": LIST }))
    const options = Array.from(
      screen.getByLabelText("Show").querySelectorAll("option")
    ).map((o) => o.textContent)
    expect(options).toEqual(["All coupons", "Within validity window"])
  })

  it("reads scheduled, exhausted and active states on their rows, quietly", async () => {
    const list = aPage([
      aCoupon(),
      aCoupon({
        id: "cpn_soon",
        code: "SOON",
        valid_from: "2999-01-01T00:00:00Z",
      }),
      aCoupon({
        id: "cpn_full",
        code: "FULL",
        max_redemptions: 5,
        times_redeemed: 5,
      }),
    ])
    renderPage(LedgerCouponsPage, stubClient({ "coupons.list": list }))
    await screen.findByText("FULL")
    const row = (code: string) =>
      screen.getAllByRole("row").find((r) => within(r).queryByText(code))!
    const variant = (code: string, label: string) =>
      within(row(code))
        .getByText(label, { selector: '[data-slot="badge"]' })
        .className.split(/\s+/)
        .filter((t) => !t.includes("aria-invalid"))
        .join(" ")
    expect(variant("LAUNCH20", "Active")).not.toMatch(/destructive|secondary/)
    expect(variant("SOON", "Scheduled")).toMatch(/secondary/)
    expect(variant("FULL", "Exhausted")).toMatch(/secondary/)
    expect(within(row("FULL")).getByText("5 of 5")).toBeTruthy()
  })

  it("pages forward and back, and says a page past the end is empty", async () => {
    const paging = {
      extension: "ledger",
      query: async (_intent: string, params?: { offset?: number }) =>
        (params?.offset ?? 0) === 0
          ? aPage(LIST.items, { has_more: true })
          : aPage([], { offset: 50 }),
      command: async () => undefined,
    } as never
    renderPage(LedgerCouponsPage, paging)
    await screen.findByText("WELCOME10")
    expect(
      (
        screen.getByRole("button", {
          name: "Previous page",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(await screen.findByText("Nothing on page 2.")).toBeTruthy()
    expect(screen.getByText("No coupons on page 2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(await screen.findByText("WELCOME10")).toBeTruthy()
  })

  it("shows the engine's refusal, such as no app selected, never an empty table", async () => {
    renderPage(
      LedgerCouponsPage,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "no app selected: set the extension's app_id or send an app_id claim"
        )
      )
    )
    expect(
      await screen.findByText(/PERMISSION_DENIED: no app selected/)
    ).toBeTruthy()
    expect(screen.queryByText("No coupons yet.")).toBeNull()
  })
})

describe("LedgerCouponDetailPage", () => {
  it("shows the coupon and deletes it through a confirmation", async () => {
    const { client, sent } = scriptedClient(
      { "coupons.detail": aCoupon() },
      { "coupons.delete": { ok: true } }
    )
    const { navigate } = renderWithNavigation(LedgerCouponDetailPage, client, {
      id: "cpn_launch20",
    })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    expect(screen.getByText("20% off")).toBeTruthy()
    expect(screen.getByText("1 of 100")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete coupon",
      })
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/coupons"))
    expect(sent).toEqual([
      { intent: "coupons.delete", payload: { id: "cpn_launch20" } },
    ])
  })

  it("shows a refused delete inside the open dialog and keeps it open", async () => {
    const { client, sent } = scriptedClient(
      { "coupons.detail": aCoupon() },
      { "coupons.delete": new ContractError("INTERNAL", "store unavailable") }
    )
    const { navigate } = renderWithNavigation(LedgerCouponDetailPage, client, {
      id: "cpn_launch20",
    })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete coupon" })
    )
    expect(await within(dialog).findByText("store unavailable")).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
  })

  it("shows no stale refusal after a failed delete is closed and the dialog is opened again", async () => {
    const { client } = scriptedClient(
      { "coupons.detail": aCoupon() },
      { "coupons.delete": new ContractError("INTERNAL", "store unavailable") }
    )
    renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_launch20" })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete coupon" })
    )
    expect(await within(dialog).findByText("store unavailable")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByText("store unavailable")).toBeNull()
  })

  it("says any currency for an unrestricted coupon", async () => {
    const { client } = scriptedClient({
      "coupons.detail": aCoupon({ currency: "" }),
    })
    renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_launch20" })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    expect(screen.getByText("Any currency")).toBeTruthy()
  })

  it("shows no validity window as none, and the window when there is one", async () => {
    const { client } = scriptedClient({ "coupons.detail": aCoupon() })
    const { unmount } = renderWithNavigation(LedgerCouponDetailPage, client, {
      id: "cpn_launch20",
    })
    await screen.findByRole("heading", { name: "LAUNCH20" })
    expect(screen.getByLabelText("no validity window")).toBeTruthy()
    unmount()
    const until = "2026-12-01T10:00:00Z"
    const windowed = scriptedClient({
      "coupons.detail": aCoupon({ valid_until: until }),
    })
    renderWithNavigation(LedgerCouponDetailPage, windowed.client, {
      id: "cpn_launch20",
    })
    expect(
      await screen.findByText(`Until ${formatLocalDay(until)}`)
    ).toBeTruthy()
  })

  it("says so when the coupon does not exist", async () => {
    const { client } = scriptedClient({
      "coupons.detail": new ContractError("NOT_FOUND", "coupon not found"),
    })
    renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_gone" })
    expect(
      await screen.findByText("No coupon with the id cpn_gone.")
    ).toBeTruthy()
  })

  it("says so for the engine's own message for an id that was never there", async () => {
    const { client } = scriptedClient({
      "coupons.detail": new ContractError(
        "NOT_FOUND",
        "ledger: coupon not found"
      ),
    })
    renderWithNavigation(LedgerCouponDetailPage, client, { id: "cpn_gone" })
    expect(
      await screen.findByText("No coupon with the id cpn_gone.")
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Back to coupons" }).getAttribute("href")
    ).toBe("/coupons")
  })

  it("names a missing id rather than fetching", () => {
    const { client } = scriptedClient({})
    renderWithNavigation(LedgerCouponDetailPage, client, {})
    expect(screen.getByRole("status").textContent).toMatch(
      /No coupon id in the address/
    )
  })
})
