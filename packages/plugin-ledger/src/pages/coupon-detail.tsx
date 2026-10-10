import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CouponStateBadge } from "../badges"
import { ConfirmAction } from "../components/confirm-action"
import { isNotFound, NotFoundState } from "../components/not-found"
import {
  couponState,
  describeDiscount,
  redemptionsText,
  validityText,
} from "../lib/coupons"
import { couponEditPath } from "../lib/paths"
import type { Ack, Coupon } from "../types"

export function LedgerCouponDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No coupon id in the address, so there is nothing to show.
      </p>
    )
  }
  return <CouponDetailBody id={id} />
}

function CouponDetailBody({ id }: { id: string }) {
  const detail = useQuery<Coupon>("coupons.detail", { id })
  if (detail.data !== undefined)
    return <CouponDetailView coupon={detail.data} />
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
      {(c) => <CouponDetailView coupon={c} />}
    </QueryBoundary>
  )
}

function CouponDetailView({ coupon }: { coupon: Coupon }) {
  const remove = useCommand<Ack>("coupons.delete")
  const navigate = useNavigateTo()
  const [deleting, setDeleting] = useState(false)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={coupon.code}
        description={coupon.name || undefined}
        actions={
          <>
            <IconButton
              label="Edit"
              nativeButton={false}
              role="link"
              render={<PluginLink to={couponEditPath(coupon.id)} />}
            />
            <IconButton
              variant="destructive"
              onClick={() => {
                remove.reset()
                setDeleting(true)
              }}
              label="Delete"
            />
          </>
        }
      />
      <DescriptionList
        className="max-w-2xl"
        items={[
          {
            term: "State",
            value: <CouponStateBadge state={couponState(coupon)} />,
          },
          { term: "Discount", value: describeDiscount(coupon) },
          {
            term: "Currency",
            value:
              coupon.currency === "" ? (
                "Any currency"
              ) : (
                <span className="font-mono text-xs">
                  {coupon.currency.toUpperCase()}
                </span>
              ),
          },
          {
            term: "Redemptions",
            value: (
              <span className="tabular-nums">{redemptionsText(coupon)}</span>
            ),
          },
          {
            term: "Valid",
            value: validityText(coupon) ?? <NoneCell label="validity window" />,
          },
          {
            term: "Created",
            value: <Timestamp value={coupon.created_at} label="creation" />,
          },
          {
            term: "Updated",
            value: <Timestamp value={coupon.updated_at} label="update" />,
          },
        ]}
      />
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${coupon.code}?`}
        description="This cannot be undone. Subscriptions carrying it stop getting its discount from their next invoice."
        confirmLabel="Delete coupon"
        destructive
        command={remove}
        payload={{ id: coupon.id }}
        onDone={() => navigate("/coupons")}
      />
    </section>
  )
}
