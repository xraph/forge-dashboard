import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { useInFlight } from "../lib/in-flight"
import { couponPath } from "../lib/paths"
import type { Coupon } from "../types"
import { CouponForm, emptyCouponForm } from "./coupon-form"

export function LedgerCouponCreatePage() {
  const create = useCommand<Coupon>("coupons.create")
  const navigate = useNavigateTo()
  const once = useInFlight()
  async function submit(payload: Record<string, unknown>) {
    const result = await once(() => create.execute(payload))
    if (result === undefined) return
    navigate(couponPath(result.id))
  }
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="New coupon" description="A discount code a subscription can apply to its invoices." />
      <CouponForm
        mode="create"
        initial={emptyCouponForm()}
        submitLabel="Create coupon"
        pendingLabel="Creating…"
        pending={create.loading}
        error={create.error}
        errorTitle="Could not create the coupon"
        cancelTo="/coupons"
        onSubmit={(p) => void submit(p)}
      />
    </section>
  )
}
