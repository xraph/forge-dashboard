import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { isNotFound, NotFoundState } from "../components/not-found"
import { useInFlight } from "../lib/in-flight"
import { couponPath } from "../lib/paths"
import type { Coupon } from "../types"
import { CouponForm, couponToForm } from "./coupon-form"

export function LedgerCouponEditPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No coupon id in the address, so there is nothing to edit.
      </p>
    )
  }
  return <CouponEditBody id={id} />
}

function CouponEditBody({ id }: { id: string }) {
  const detail = useQuery<Coupon>("coupons.detail", { id })
  const update = useCommand<Coupon>("coupons.update")
  const navigate = useNavigateTo()
  const once = useInFlight()

  async function submit(payload: Record<string, unknown>) {
    const result = await once(() => update.execute(payload))
    if (result === undefined) return
    navigate(couponPath(id))
  }

  const form = (c: Coupon) => (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title={`Edit ${c.code}`} />
      <CouponForm
        key={c.id}
        mode="edit"
        initial={couponToForm(c)}
        original={c}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        pending={update.loading}
        error={update.error}
        errorTitle="Could not save the coupon"
        cancelTo={couponPath(id)}
        onSubmit={(p) => void submit(p)}
      />
    </section>
  )

  // Data already on screen stays up while a write's invalidation refetches, so the form keeps what was typed.
  if (detail.data !== undefined) return form(detail.data)
  if (isNotFound(detail.error, "coupon"))
    return (
      <NotFoundState
        noun="coupon"
        id={id}
        backTo="/coupons"
        backLabel="Back to coupons"
      />
    )
  return (
    <QueryBoundary title="Coupon" query={detail} skeletonRows={4}>
      {form}
    </QueryBoundary>
  )
}
