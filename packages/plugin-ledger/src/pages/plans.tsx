import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PlanStatusBadge } from "../badges"
import { MoneyText } from "../components/money"
import { OffsetPager } from "../components/offset-pager"
import { listEmptyMessage, pageCaption, pageParams } from "../lib/paging"
import { planPath } from "../lib/paths"
import type { Page, Plan, PlanStatus } from "../types"

const PERIOD_SUFFIX: Record<string, string> = { monthly: "/ month", yearly: "/ year" }

const columns: Column<Plan>[] = [
  { id: "name", header: "Plan", className: "font-medium", cell: (p) => <PluginLink to={planPath(p.id)}>{p.name}</PluginLink> },
  { id: "slug", header: "Slug", className: "font-mono text-xs", cell: (p) => p.slug },
  { id: "status", header: "Status", cell: (p) => <PlanStatusBadge status={p.status} /> },
  {
    id: "price",
    header: "Base price",
    align: "end",
    cell: (p) =>
      p.pricing ? (
        <span className="whitespace-nowrap">
          <MoneyText value={p.pricing.base_amount} />{" "}
          <span className="text-muted-foreground">{PERIOD_SUFFIX[p.pricing.billing_period] ?? ""}</span>
        </span>
      ) : (
        <NoneCell label="price" />
      ),
  },
  { id: "features", header: "Features", align: "end", className: "tabular-nums", cell: (p) => (p.features ?? []).length },
  {
    id: "trial",
    header: "Trial",
    align: "end",
    className: "tabular-nums",
    cell: (p) => (p.trial_days > 0 ? `${p.trial_days} days` : <NoneCell label="trial" />),
  },
  { id: "updated", header: "Updated", cell: (p) => <Timestamp value={p.updated_at} label="update" /> },
]

const STATUS_OPTIONS = [
  { label: "All", value: "" },
  { label: "Active", value: "active" },
  { label: "Draft", value: "draft" },
  { label: "Archived", value: "archived" },
]

function NewPlanLink() {
  return (
    <PluginLink to="/plans/new" className={buttonVariants()}>
      New plan
    </PluginLink>
  )
}

export function LedgerPlansPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<PlanStatus | "">("")
  const list = useQuery<Page<Plan>>("plans.list", { ...pageParams(page), status: status || undefined })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Plans" description="What a subscription can be on, and what it costs." actions={<NewPlanLink />} />
      <FilterBar
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            options: STATUS_OPTIONS,
            onChange: (next) => {
              setStatus(next as PlanStatus | "")
              setPage(1)
            },
          },
        ]}
      />
      <QueryBoundary title="Plans" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<Plan>
                columns={columns}
                rows={rows}
                rowKey={(p) => p.id}
                caption={pageCaption({ page, shown: rows.length, hasMore: data.has_more, singular: "plan", plural: "plans" })}
                emptyMessage={listEmptyMessage("plans", page, status || undefined)}
                emptyAction={
                  page > 1 ? (
                    <Button variant="outline" onClick={() => setPage(1)}>
                      Back to the first page
                    </Button>
                  ) : status ? undefined : (
                    <NewPlanLink />
                  )
                }
              />
              <OffsetPager page={page} hasMore={data.has_more} onPageChange={setPage} />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
