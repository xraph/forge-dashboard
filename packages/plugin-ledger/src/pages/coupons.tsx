import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { CouponStateBadge } from "../badges"
import { BackToFirstPage, OffsetPager } from "../components/offset-pager"
import { couponState, describeDiscount, redemptionsText, validityText } from "../lib/coupons"
import { listEmptyMessage, pageCaption, pageParams } from "../lib/paging"
import { couponPath } from "../lib/paths"
import type { Coupon, Page } from "../types"

const columns: Column<Coupon>[] = [
  { id: "code", header: "Code", className: "font-mono text-xs font-medium", cell: (c) => <PluginLink to={couponPath(c.id)}>{c.code}</PluginLink> },
  { id: "name", header: "Name", cell: (c) => c.name || <NoneCell label="name" /> },
  { id: "discount", header: "Discount", align: "end", className: "tabular-nums", cell: (c) => describeDiscount(c) },
  { id: "redemptions", header: "Redemptions", align: "end", className: "tabular-nums", cell: (c) => redemptionsText(c) },
  { id: "valid", header: "Valid", cell: (c) => validityText(c) ?? <NoneCell label="validity window" /> },
  { id: "state", header: "State", cell: (c) => <CouponStateBadge state={couponState(c)} /> },
]

function NewCouponLink() {
  return (
    <PluginLink to="/coupons/new" className={buttonVariants()}>
      New coupon
    </PluginLink>
  )
}

export function LedgerCouponsPage() {
  const [page, setPage] = useState(1)
  const [show, setShow] = useState<"all" | "active">("all")
  const list = useQuery<Page<Coupon>>("coupons.list", { ...pageParams(page), active: show === "active" ? true : undefined })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Coupons" description="Discounts a subscription can carry into its invoices." actions={<NewCouponLink />} />
      <FilterBar
        filters={[
          {
            id: "show",
            label: "Show",
            value: show,
            options: [
              { label: "All coupons", value: "all" },
              { label: "Within validity window", value: "active" },
            ],
            onChange: (next) => {
              setShow(next as "all" | "active")
              setPage(1)
            },
          },
        ]}
      />
      <QueryBoundary title="Coupons" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<Coupon>
                columns={columns}
                rows={rows}
                rowKey={(c) => c.id}
                caption={pageCaption({ page, shown: rows.length, hasMore: data.has_more, singular: "coupon", plural: "coupons" })}
                emptyMessage={page === 1 && show === "active" ? "No coupons are within their validity window." : listEmptyMessage("coupons", page, undefined)}
                emptyAction={page > 1 ? <BackToFirstPage onClick={() => setPage(1)} /> : show === "all" ? <NewCouponLink /> : undefined}
              />
              <OffsetPager page={page} hasMore={data.has_more} onPageChange={setPage} />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
