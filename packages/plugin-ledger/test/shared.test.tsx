import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  CouponStateBadge,
  FeatureStatusBadge,
  InvoiceStatusBadge,
  PlanStatusBadge,
  SharedBadge,
  SubscriptionStatusBadge,
} from "../src/badges"
import { MoneyText } from "../src/components/money"
import { OffsetPager } from "../src/components/offset-pager"
import { isNotFound, NotFoundState } from "../src/components/not-found"
import { usd } from "./fixtures"

// The kit's Badge base class carries `aria-invalid:border-destructive` (and two
// more aria-invalid tokens) on every variant, so matching /destructive/ against
// the whole className would hit a paid badge. Drop those tokens and what is
// left is the variant's own classes.
function variantOf(text: string) {
  const badge = screen.getByText(text, { selector: '[data-slot="badge"]' })
  return badge.className
    .split(/\s+/)
    .filter((token) => !token.includes("aria-invalid"))
    .join(" ")
}

describe("badges", () => {
  it("maps invoice states by proportion: paid recedes, past due interrupts", () => {
    render(
      <>
        <InvoiceStatusBadge status="paid" />
        <InvoiceStatusBadge status="pending" />
        <InvoiceStatusBadge status="past_due" />
        <InvoiceStatusBadge status="draft" />
        <InvoiceStatusBadge status="voided" />
      </>,
    )
    expect(variantOf("Paid")).not.toMatch(/destructive|secondary/)
    expect(variantOf("Pending")).toMatch(/secondary/)
    expect(variantOf("Draft")).toMatch(/secondary/)
    expect(variantOf("Past due")).toMatch(/destructive/)
    expect(variantOf("Voided")).not.toMatch(/destructive|secondary/)
  })

  it("maps subscription states the same way", () => {
    render(
      <>
        <SubscriptionStatusBadge status="active" />
        <SubscriptionStatusBadge status="trialing" />
        <SubscriptionStatusBadge status="past_due" />
        <SubscriptionStatusBadge status="paused" />
        <SubscriptionStatusBadge status="canceled" />
      </>,
    )
    expect(variantOf("Active")).not.toMatch(/destructive|secondary/)
    expect(variantOf("Trialing")).toMatch(/secondary/)
    expect(variantOf("Paused")).toMatch(/secondary/)
    expect(variantOf("Past due")).toMatch(/destructive/)
    expect(variantOf("Canceled")).not.toMatch(/destructive|secondary/)
  })

  it("maps plans semantically: active is the one default", () => {
    render(
      <>
        <PlanStatusBadge status="active" />
        <PlanStatusBadge status="draft" />
        <PlanStatusBadge status="archived" />
      </>,
    )
    expect(variantOf("Active")).toMatch(/bg-primary/)
    expect(variantOf("Draft")).toMatch(/secondary/)
    expect(variantOf("Archived")).not.toMatch(/bg-primary|secondary|destructive/)
  })

  it("labels catalog, coupon and shared states", () => {
    render(
      <>
        <FeatureStatusBadge status="draft" />
        <CouponStateBadge state="exhausted" />
        <SharedBadge />
      </>,
    )
    expect(variantOf("Draft")).toMatch(/secondary/)
    expect(variantOf("Exhausted")).toMatch(/secondary/)
    expect(screen.getByText("Shared", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })
})

describe("MoneyText", () => {
  it("renders tabular figures", () => {
    render(<MoneyText value={usd(4999)} />)
    const el = screen.getByText(/49\.99/)
    expect(el.className).toMatch(/tabular-nums/)
  })
})

describe("OffsetPager", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(<OffsetPager page={1} hasMore={false} onPageChange={() => {}} />)
    expect(container.innerHTML).toBe("")
  })

  it("disables Next on the last page and Previous on the first", () => {
    const onPage = vi.fn()
    const { rerender } = render(<OffsetPager page={1} hasMore onPageChange={onPage} />)
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onPage).toHaveBeenCalledWith(2)
    rerender(<OffsetPager page={2} hasMore={false} onPageChange={onPage} />)
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(onPage).toHaveBeenCalledWith(1)
  })
})

describe("NotFoundState", () => {
  it("matches the contract's not-found message, not just the code", () => {
    expect(isNotFound({ code: "NOT_FOUND", message: "plan not found" }, "plan")).toBe(true)
    expect(isNotFound({ code: "NOT_FOUND", message: 'intent plans.detial not registered' }, "plan")).toBe(false)
    expect(isNotFound({ code: "CONFLICT", message: "plan not found" }, "plan")).toBe(false)
    expect(isNotFound(undefined, "plan")).toBe(false)
  })

  it("also matches the engine's own sentinel errors for a missing id", () => {
    const nf = (message: string) => ({ code: "NOT_FOUND", message })
    expect(isNotFound(nf("ledger: coupon not found"), "coupon")).toBe(true)
    expect(isNotFound(nf("get coupon: ledger: coupon not found"), "coupon")).toBe(true)
    expect(isNotFound(nf("ledger: not found"), "coupon")).toBe(true)
    expect(isNotFound(nf("ledger: not found"), "plan")).toBe(true)
  })

  it("never reads another noun's not-found as this one", () => {
    const nf = (message: string) => ({ code: "NOT_FOUND", message })
    expect(isNotFound(nf("provider not found"), "tenant")).toBe(false)
    expect(isNotFound(nf("ledger: plan not found"), "coupon")).toBe(false)
    expect(isNotFound(nf("get plan: ledger: plan not found"), "coupon")).toBe(false)
    expect(isNotFound({ code: "INTERNAL", message: "ledger: coupon not found" }, "coupon")).toBe(false)
  })

  it("says what is missing and links back", () => {
    render(<NotFoundState noun="plan" id="plan_x" backTo="/plans" backLabel="Back to plans" />)
    expect(screen.getByText("No plan with the id plan_x.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Back to plans" }).getAttribute("href")).toBe("/plans")
  })
})
